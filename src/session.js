// Ties the game together for solo and multiplayer play: the map, breaking it, props,
// other players and bots, bodies and fighting, hide and seek rounds, the arena
// tournament, and shared settings.
//
// The host (or a solo player) owns the truth: it runs the prop physics and the round
// rules, applies everyone's requests and sends snapshots 20 times a second. Joined
// players send their own head and hand poses and draw what the host says.
//
// Broken blocks are the one thing each player works out for themselves: a punch is
// just "a ball of this size at this spot", and the voxel world gives the same result
// for the same punches on every machine, in any order.
import * as THREE from 'three';
import { PropWorld, SPAWNABLE, TYPE, MAX_GIBS, weaponHold } from './props.js';
import { WEAPONS, ARMS, guardOf, guardStops } from './weapons.js';
import { ARMOUR, SLOTS } from './armour.js';
import { Tournament } from './arena.js';
import { gibFrame, LOOSE, RIGHT, CUT } from './gibs.js';
import { Avatar } from './avatar.js';
import { MAPS, COLOSSEUM } from './maps.js';
import { Rounds } from './rounds.js';
import { Body, BODY } from './body.js';
import { RIG, solveRig, makeRig, grabArm, stumpOf } from './bodyrig.js';
import { Bot, MAX_BOTS, GLADIATORS } from './bots.js';
import { Nav } from './nav.js';
import { PRIORY } from './maps.js';
import { Horde, ZOMBIES, KINDS } from './zombies.js';
import { Arrows } from './arrows.js';
import { hitPart } from './bodyrig.js';

const SEND_EVERY = 0.05;     // 20 Hz
const STATE_LEN = 22;        // head pos+quat (7), two hands pos+quat (14), size (1)
export const GRAVITY = { normal: -9.8, low: -3.2, high: -19 };
export const GRAVITY_LABEL = { normal: 'Normal', low: 'Low', high: 'Heavy' };
const GRAVITY_ORDER = ['normal', 'low', 'high'];
const SKY_ORDER = ['day', 'sunset', 'night'];
const MAX_PUNCH = 1.5;       // biggest dent a player may ask for, metres
const BLAST_DENT = 1.6;      // crater from TNT
const BODY_PARTS = ['head', 'torso', 'upperL', 'foreL', 'upperR', 'foreR'];
const r3 = v => Math.round(v * 1000) / 1000;
const DOWN = new THREE.Vector3(0, -1, 0);
const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // the body model faces +Z, a camera looks down -Z

export class Session {
  /**
   * @param opts.scene, opts.world (World with .voxels), opts.net (Net), opts.loco (local Locomotion)
   * @param opts.me  { name, color }
   * @param opts.avatarTemplate  Promise of the skeleton model
   */
  constructor({ scene, world, net, loco, me, avatarTemplate }) {
    this.scene = scene;
    this.world = world;
    this.voxels = world.voxels;
    this.net = net;
    this.loco = loco;
    this.me = me;
    this.settings = { gravity: 'normal', sky: 'day', smash: true, pvp: true, mode: 'sandbox' };
    this.mode = null;           // the map that is loaded
    this.carveLog = [];         // every dent since the map was fresh, for players who join later
    this.rounds = new Rounds();
    this.round = this.rounds.public();
    this.tournament = new Tournament();
    this.arena = this.tournament.public();   // the arena tournament, as everyone sees it
    this.onArena = () => {};    // (arena, previousArena) the tournament moved on
    this.horde = new Horde();
    this.zombies = this.horde.public();      // the zombies game, as everyone sees it
    this.onZombies = () => {};  // (zombies, previousZombies) it moved on
    this.arrows = new Arrows(scene);
    this._arrowN = 0; this._zField = null; this._zFieldT = 0; this._zDead = []; this._repairAt = new Map();
    this._zBarricades = PRIORY.windows.map((w, i) => ({ id: i, pos: new THREE.Vector3(w.x, PRIORY.floor + 1, w.z), nx: w.nx, nz: w.nz, boards: ZOMBIES.boards }));
    this.players = new Map();   // id -> { name, color, state: Float32 array, avatar, cur }
    this.template = null;
    avatarTemplate.then(t => { this.template = t; for (const p of this.players.values()) this._ensureAvatar(p); });
    this.props = new PropWorld(scene, world, true);
    this.held = [null, null];   // prop id held by my left / right hand
    this.selected = 0;          // index into SPAWNABLE
    this.onChange = () => {};   // roster / room / settings changed
    this.onButton = () => {};   // (buttonId, on) for panel lights
    this.onBoom = () => {};     // (THREE.Vector3) an explosion went off
    this.onSettings = () => {}; // (settings) gravity, sky or smash changed
    this.onMap = () => {};      // (mode) a different map is about to be built: swap the scenery
    this.onCarve = () => {};    // (THREE.Vector3, radius, result) blocks broke: debris, sound
    this.onRound = () => {};    // (round, previousRound) the hide and seek state changed
    this.onThump = () => {};    // (THREE.Vector3, strength 0..1) something huge shook the ground
    this.peers = new Map();     // other players: id -> PeerJS id, for voice calls
    this.onBodyFx = () => {};   // ({ k: 'hit'|'sever'|'die'|'respawn'|'grab', id, ... }) something happened to a body
    this.onBleed = () => {};    // (pos, dir | null, spurt, scale) a wound dripped, or a stump spurted, here
    this._dir = new THREE.Vector3();
    this.bodies = new Map();    // id -> Body, for me, every other player and every bot
    this.poses = new Map();     // id -> { head, hands, scale } this frame
    this.rigs = new Map();      // id -> joints (see bodyrig.js)
    this.hands = new Map();     // id -> hands as drawn (a held arm follows whoever holds it)
    this.botKit = 0.4;          // the chance an arena bot is given each of a shield, a helmet and a chest plate
    this.nav = null;            // the grid bots find their way by (host only; see _getNav)
    this._navFor = null; this._navDirty = false; this._navT = 0;
    this._swing = new Map();    // id -> how fast their hands are going
    this._zctx = {};            // what zombies know this frame
    this.onNav = () => {};
    this.bots = new Map();      // id -> Bot (host only)
    this._botN = 0;
    this._drip = new Map();
    this._sendT = 0;
    this._buttonT = {};
    this._headTmp = new THREE.Vector3();
    this._building = false;
    this.voxels.onCells = cells => { if (!this._building) this.props.syncCells(cells); };

    net.onMessage = (from, msg) => this._onMessage(from, msg);
    net.onJoin = id => { this.players.set(id, { id, name: 'Player', color: 0xe0ac86, state: null }); this._broadcastRoster(); };
    net.onLeave = id => {
      if (id === 'h' && this.net.role !== 'host') { this._backToSolo(); return; }
      this._dropPlayer(id);
      for (const p of this.props.props.values()) if (p.held && p.held.key.startsWith(id + ':')) this.props.release(p.id);
      this._broadcastRoster();
    };
  }

  get myId() { return this.net.myId; }
  get isAuthority() { return this.net.role !== 'client'; }
  get selectedType() { return SPAWNABLE[this.selected]; }
  /** People in the room (bots do not count). */
  get playerCount() { let n = 1; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  get botCount() { let n = 0; for (const p of this.players.values()) if (p.bot) n++; return n; }
  /** The body of a player or bot (mine if no id is given). */
  body(id = this.myId) {
    let b = this.bodies.get(id);
    if (!b) { b = new Body(); this.bodies.set(id, b); }
    return b;
  }
  colorOf(id) { return id === this.myId ? this.me.color : (this.players.get(id)?.color || 0xe0ac86); }
  isBot(id) { return !!this.players.get(id)?.bot; }
  isZombie(id) { return !!this.players.get(id)?.z; }
  nameOf(id) { return id === this.myId ? this.me.name : (this.players.get(id)?.name || 'Someone'); }

  /**
   * What I am right now: 'free' (no round), 'giant', 'hider' or 'ghost' (caught) in hide
   * and seek; 'fighter' (in the match being fought) or 'spectator' in the arena.
   */
  role(id = this.myId) {
    if (this.settings.mode === 'arena') {
      const a = this.arena;
      if (a.phase === 'waiting') return 'free';
      return (a.phase === 'prep' || a.phase === 'fight') && (a.a === id || a.b === id) ? 'fighter' : 'spectator';
    }
    if (this.settings.mode === 'zombies') { const p = this.zombies.pl[id]; return p && p[3] ? 'fallen' : 'survivor'; }
    const r = this.round;
    if (this.settings.mode !== 'hideseek' || r.phase === 'waiting') return 'free';
    if (r.giant === id) return 'giant';
    return r.out.includes(id) ? 'ghost' : 'hider';
  }

  // ---- rooms
  async host() {
    const code = await this.net.host();
    for (const id of [...this.players.keys()]) if (!this.bots.has(id)) this._dropPlayer(id);    // my bots stay
    this.onChange();
    return code;
  }

  async join(code) {
    this._clearBots();
    for (const id of [...this.players.keys()]) this._dropPlayer(id);
    this.bodies.clear();
    this._newProps(false);
    this._setRound(new Rounds().public());
    this._setArena(new Tournament().public());
    try {
      await this.net.join(code);
    } catch (e) {
      this._backToSolo();
      throw e;
    }
    this.net.send({ t: 'hello', name: this.me.name, color: this.me.color });
    this.onChange();
  }

  leave() { this.net.leave(); this._backToSolo(); }

  // On my own again: start from a fresh copy of the current map.
  _backToSolo() {
    for (const id of [...this.players.keys()]) this._dropPlayer(id);
    this.peers.clear();
    this.bodies.clear();
    this.rounds.stop();
    this.tournament.stop();
    this.loadMap(this.settings.mode);
    this._applySettings({ ...this.settings, gravity: 'normal', sky: 'day' });
    this._setRound(this.rounds.public());
    this._setArena(this.tournament.public());
    this.onChange();
  }

  setMe(name, color) {
    this.me.name = name; this.me.color = color;
    if (this.net.role === 'client') this.net.send({ t: 'hello', name, color });
    if (this.net.role === 'host') this._broadcastRoster();
  }

  // ---- the map
  /** Build a map from scratch (host / solo), or because the host said so (joined players). */
  loadMap(mode) {
    if (!MAPS[mode]) mode = 'sandbox';
    this._building = true;
    this.voxels.clear();
    MAPS[mode].build(this.voxels);
    this.mode = this.settings.mode = mode;
    this.onMap(mode);            // the unbreakable scenery changes first: props are built on top of it
    this.voxels.finalize();
    this._building = false;
    this.carveLog = [];
    this._newProps(this.isAuthority);
    // a new map is a fresh start: everyone whole again, and the bots go home
    for (const b of this.bodies.values()) b.reset();
    this._clearBots();
    this.onChange();
  }

  _newProps(simulate) {
    this.props.clear();
    for (const h of this.props.hands.values()) this.props.world.removeBody(h);
    this.props = new PropWorld(this.scene, this.world, simulate);
    this.props.setGravity(GRAVITY[this.settings.gravity]);
    this.held = [null, null];
  }

  /** Switch between sandbox and hide and seek (for everyone in the room). */
  setMode(mode) { this.request({ t: 'mode', mode }); }
  /** Repair everything that was broken. */
  resetMap() { this.request({ t: 'resetmap' }); }
  /** End this hide and seek round and start another; in the arena, draw a new bracket. */
  skipRound() { this.request({ t: 'round', cmd: 'skip' }); }

  _hostSetMode(mode) {
    if (!MAPS[mode] || mode === this.mode) return;
    this.rounds.stop();
    this.tournament.stop();
    this.horde.reset();
    this.arrows.clear();
    this.loadMap(mode);
    this._applySettings({ ...this.settings, gravity: 'normal', sky: mode === 'zombies' ? 'night' : this.settings.sky === 'night' && this._wasZ ? 'day' : this.settings.sky });
    this._wasZ = mode === 'zombies';
    this.net.broadcast({ t: 'map', mode, carves: [] });
  }

  _hostResetMap() {
    this.voxels.reset();
    this.carveLog = [];
    this.net.broadcast({ t: 'map', mode: this.mode, carves: [], reset: true });
  }

  // joined players: the host says which map, and every dent made in it so far
  _applyMap(msg) {
    if (msg.mode !== this.mode) this.loadMap(msg.mode);
    else this.voxels.reset();
    for (const c of msg.carves || []) this.voxels.carve(c[0], c[1], c[2], c[3]);
  }

  // ---- breaking things
  /** May this player break blocks right now? */
  canBreak(id = this.myId) {
    if (this.settings.mode === 'hideseek') return this.round.phase === 'waiting' || (this.round.phase === 'hunt' && this.round.giant === id);
    if (this.settings.mode === 'arena' || this.settings.mode === 'zombies') return false;       // the colosseum and the priory stay standing
    return this.settings.smash;
  }

  /** The local player hit something: break a ball of blocks there. Returns true if anything broke. */
  punch(pos, radius) {
    if (!this.canBreak()) return false;
    const c = [r3(pos.x), r3(pos.y), r3(pos.z), r3(Math.min(radius, MAX_PUNCH))];
    if (!this._carve(c, true)) return false;         // shown at once, without waiting for the host
    if (this.isAuthority) { this.carveLog.push(c); this.net.broadcast({ t: 'carve', c }); }
    else this.net.send({ t: 'break', c });
    return true;
  }

  _carve(c, fx) {
    const res = this.voxels.carve(c[0], c[1], c[2], c[3]);
    if (res) this._navDirty = true;       // the bots' map of where they can go is out of date
    if (res && fx) this.onCarve(new THREE.Vector3(c[0], c[1], c[2]), c[3], res);
    return res;
  }

  _hostCarve(c, except = null) {
    if (!this._carve(c, true)) return;
    this.carveLog.push(c);
    this.net.broadcast({ t: 'carve', c }, except);
  }

  // ---- players
  _dropPlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.avatar) p.avatar.dispose();
    this.players.delete(id);
    this.bots.delete(id);
    this.bodies.delete(id); this.rigs.delete(id); this.poses.delete(id); this.hands.delete(id); this._drip.delete(id);
    // let go of anything they were holding
    for (const b of this.bodies.values()) for (let a = 0; a < 2; a++) if (b.held[a] && b.held[a].startsWith(id + ':')) b.held[a] = null;
  }

  // ---- bots (host only): to everyone else they are just more players
  // kit: a sandbox dummy in a helmet and a chest plate, holding a shield up, to try blows on
  _addBot(near, kit = false) {
    const mode = this.settings.mode;
    if (this.bots.size >= MAX_BOTS || mode === 'hideseek') return;
    const id = 'b' + (++this._botN);
    let pos, name;
    if (mode === 'arena') {
      // a gladiator: it takes a seat until it is its turn
      const seat = COLOSSEUM.seat(this.bots.size * 2 + 1);
      pos = new THREE.Vector3().fromArray(seat.pos);
      name = GLADIATORS[(this._botN - 1) % GLADIATORS.length];
    } else {
      pos = near ? near.clone() : new THREE.Vector3(0, 0, 3);
      pos.y = Math.max(pos.y - 0.6, 0) + 0.3;
    }
    if (kit && mode === 'sandbox') name = `Knight ${this._botN}`;
    const bot = new Bot(id, this._botN, this.world, pos, { name, brain: mode === 'arena' ? 'still' : 'dummy' });
    if (mode === 'arena') bot.place(pos, COLOSSEUM.seat(this.bots.size * 2 + 1).yaw);
    this.bots.set(id, bot);
    const p = { id, name: bot.name, color: bot.color, state: packState(bot.pose), bot: true };
    this.players.set(id, p);
    this._ensureAvatar(p);
    if (kit && mode === 'sandbox') { bot.kit = { prop: null }; this._kitOut(id); }
    this._broadcastRoster();
  }
  _clearBots() {
    if (!this.bots.size) return;
    for (const id of [...this.bots.keys()]) this._dropPlayer(id);
    this._broadcastRoster();
  }

  _ensureAvatar(p) {
    if (p.avatar || !this.template) return;
    p.avatar = new Avatar(this.template, this.scene, { color: p.color, name: p.name });
    p.avatar.root.visible = false;
  }

  _broadcastRoster() {
    if (this.net.role !== 'host') { this.peers.clear(); this.onChange(); return; }
    const list = [{ id: 'h', name: this.me.name, color: this.me.color, peer: this.net.peer ? this.net.peer.id : null }];
    this.peers.clear();
    for (const p of this.players.values()) {
      const peer = this.net.peerIdOf(p.id);
      list.push({ id: p.id, name: p.name, color: p.color, peer, bot: p.bot ? 1 : 0, z: p.z || 0 });
      if (peer) this.peers.set(p.id, peer);
    }
    this.net.broadcast({ t: 'roster', list });
    this.onChange();
  }

  _applyRoster(list) {
    const ids = new Set();
    this.peers.clear();
    for (const r of list) {
      if (r.id === this.myId) continue;
      ids.add(r.id);
      if (r.peer) this.peers.set(r.id, String(r.peer));
      let p = this.players.get(r.id);
      if (!p) { p = { id: r.id, state: null }; this.players.set(r.id, p); }
      const changed = p.name !== r.name || p.color !== r.color;
      p.name = r.name; p.color = r.color; p.bot = !!r.bot; p.z = r.z || 0;
      if (changed && p.avatar) { p.avatar.setName(r.name); p.avatar.setColor(r.color); }
      this._ensureAvatar(p);
    }
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this._dropPlayer(id);
    this.onChange();
  }

  // ---- messages
  _onMessage(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.net.role === 'host') {
      const p = this.players.get(from);
      if (!p) return;
      if (msg.t === 'hello') {
        p.name = String(msg.name || 'Player').slice(0, 16);
        p.color = Number(msg.color) || 0xe0ac86;
        this._ensureAvatar(p);
        if (p.avatar) { p.avatar.setName(p.name); p.avatar.setColor(p.color); }
        this._broadcastRoster();
        if (!p.greeted) { p.greeted = true; this.net.sendTo(from, { t: 'map', mode: this.mode, carves: this.carveLog }); }
      } else if (msg.t === 'state' && Array.isArray(msg.s) && msg.s.length === STATE_LEN) {
        p.state = msg.s;
      } else {
        this._handleRequest(from, msg);
      }
    } else if (this.net.role === 'client') {
      if (msg.t === 'roster') this._applyRoster(msg.list);
      else if (msg.t === 'map') this._applyMap(msg);
      else if (msg.t === 'carve' && Array.isArray(msg.c)) this._carve(msg.c, true);
      else if (msg.t === 'thump' && Array.isArray(msg.p)) this.onThump(new THREE.Vector3().fromArray(msg.p), Number(msg.s) || 0);
      else if (msg.t === 'snap') {
        for (const [id, ...s] of msg.players) {
          if (id === this.myId) continue;
          const p = this.players.get(id);
          if (p) p.state = s;
        }
        this.props.applySnapshot(msg);
        // drop holds the host didn't confirm
        for (let i = 0; i < 2; i++) {
          const id = this.held[i];
          if (id == null) continue;
          const pr = this.props.props.get(id);
          if (!pr || (pr.heldKey && pr.heldKey !== `${this.myId}:${i}`)) this.held[i] = null;
        }
        const s = msg.settings;
        if (s && (s.gravity !== this.settings.gravity || s.sky !== this.settings.sky || s.smash !== this.settings.smash || s.pvp !== this.settings.pvp)) this._applySettings(s);
        if (msg.round) this._setRound(msg.round);
        if (msg.arena) this._setArena(msg.arena);
        if (msg.zombies) this._setZombies(msg.zombies);
        for (const b of msg.bodies || []) this.body(b[0]).apply(b.slice(1));
      } else if (msg.t === 'bfx') {
        this.onBodyFx(msg);
      } else if (msg.t === 'given') {
        this.held[msg.hand ? 1 : 0] = msg.id;      // an arm came off in my hand
      } else if (msg.t === 'boom' && Array.isArray(msg.pos)) {
        this.onBoom(new THREE.Vector3().fromArray(msg.pos));
      }
    }
  }

  /** Something the local player wants to do. */
  request(msg) {
    if (this.isAuthority) this._handleRequest(this.myId, msg);
    else this.net.send(msg);
  }

  _handleRequest(from, msg) {
    const props = this.props;
    // outside the sandbox there is no spawning, deleting or undoing
    if (this.settings.mode !== 'sandbox' && ['spawn', 'throw', 'del', 'undo'].includes(msg.t)) return;
    // the fallen (zombies) can only watch
    if (this.settings.mode === 'zombies' && this.body(from).dead && ['grab', 'wear', 'buy', 'repair', 'shoot', 'hit'].includes(msg.t)) return;
    // and in the arena only the two fighters may pick things up
    if (this.settings.mode === 'arena' && (msg.t === 'grab' || msg.t === 'wear') && this.role(from) !== 'fighter') return;
    switch (msg.t) {
      case 'spawn': {
        if (!TYPE[msg.type] || TYPE[msg.type].gib || !Array.isArray(msg.pos)) return;
        const q = Array.isArray(msg.quat) ? new THREE.Quaternion().fromArray(msg.quat) : null;
        props.spawn(msg.type, new THREE.Vector3().fromArray(msg.pos), q, { owner: from });
        break;
      }
      case 'throw': {
        if (!TYPE[msg.type] || TYPE[msg.type].gib || !Array.isArray(msg.pos) || !Array.isArray(msg.vel)) return;
        const vel = new THREE.Vector3().fromArray(msg.vel);
        if (vel.length() > 30) vel.setLength(30);
        props.throwSeed(msg.type, new THREE.Vector3().fromArray(msg.pos), vel, from);
        break;
      }
      case 'del': props.remove(msg.id); break;
      case 'undo': { const p = props.lastOwnedBy(from); if (p) props.remove(p.id); break; }
      case 'grab': {
        const hand = this._handPose(from, msg.hand), p = props.props.get(msg.id);
        if (hand && props.grab(msg.id, { key: `${from}:${msg.hand}`, pos: hand.pos, quat: hand.quat }) && p && p.owner === 'chest') { p.owner = 'rack'; p.life = Infinity; this.horde.took(); }
        break;
      }
      case 'buy': this._hostBuy(from, msg); break;
      case 'repair': this._hostRepair(from, msg); break;
      case 'shoot': this._hostShoot(from, msg); break;
      case 'wear': {
        // picking up a piece of armour puts it on
        const p = props.props.get(msg.id), body = this.body(from), pose = this.poses.get(from);
        if (!p || !p.type.armour || p.wounds || p.held || !pose || pose.head.pos.distanceTo(p.mesh.position) > 3 * pose.scale + 1) break;
        if (!body.wear(p.type.armour.slot)) break;
        props.remove(p.id);
        this._fx({ k: 'wear', id: from, slot: p.type.armour.slot });
        break;
      }
      case 'block': this._hostBlock(from, msg); break;
      case 'release': {
        const p = props.props.get(msg.id);
        if (p && p.held && p.held.key === `${from}:${msg.hand}`) {
          props.release(msg.id, msg.vel ? new THREE.Vector3().fromArray(msg.vel) : null);
          if (this.settings.mode === 'zombies') p.life = 30;        // what is dropped in the priory does not lie about for ever
        }
        break;
      }
      case 'button': this._pressButton(msg.id); break;
      case 'break': {
        const c = msg.c;
        if (Array.isArray(c) && c.length === 4 && c.every(Number.isFinite) && c[3] <= MAX_PUNCH && this.canBreak(from)) this._hostCarve(c.map(r3), from);
        break;
      }
      case 'thump': {
        // only big players shake the ground; everyone else gets to feel it
        const sc = from === this.myId ? (this._local && this._local.scale) || 1 : (this.players.get(from)?.state || [])[21] || 1;
        if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite) || sc < 1.5) break;
        const m = { t: 'thump', p: msg.p.map(r3), s: Math.min(Math.max(Number(msg.s) || 0, 0), 1) };
        this.net.broadcast(m, from);
        if (from !== this.myId) this.onThump(new THREE.Vector3().fromArray(m.p), m.s);
        break;
      }
      case 'hit': this._hostHit(from, msg); break;
      case 'hold': this._hostHold(from, msg); break;
      case 'unhold': {
        const key = `${from}:${msg.hand ? 1 : 0}`;
        for (const b of this.bodies.values()) for (let a = 0; a < 2; a++) if (b.held[a] === key) b.held[a] = null;
        break;
      }
      case 'rip':      // a shortcut for mouse players, and only against bots
        if (this.isBot(msg.id) && this.settings.mode === 'sandbox' && !this.body(msg.id).dead) this._rip(msg.id, msg.arm ? 1 : 0, from, msg.hand ? 1 : 0);
        break;
      case 'bot':
        if (msg.cmd === 'add') {
          const pose = this.poses.get(from);
          this._addBot(pose ? pose.head.pos.clone().add(new THREE.Vector3(0, 0, -2.5).applyQuaternion(pose.head.quat).setY(0)) : null, !!msg.kit);
        } else if (msg.cmd === 'clear') this._clearBots();
        break;
      case 'mode': this._hostSetMode(msg.mode); break;
      case 'resetmap': if (this.settings.mode === 'sandbox') this._hostResetMap(); break;
      case 'round': if (msg.cmd === 'skip') { if (this.settings.mode === 'arena') this.tournament.restart(); else if (this.settings.mode === 'zombies') this._zRestart(); else this.rounds.skip(); } break;
    }
  }

  _pressButton(id) {
    const now = performance.now();
    if (now - (this._buttonT[id] || 0) < 500) return;
    if (this.settings.mode !== 'sandbox' && id !== 'sky') return;   // the world is left alone outside the sandbox
    this._buttonT[id] = now;
    const cycle = (order, cur) => order[(order.indexOf(cur) + 1) % order.length];
    if (id === 'lowgrav') this._applySettings({ ...this.settings, gravity: this.settings.gravity === 'low' ? 'normal' : 'low' });
    else if (id === 'gravity') this._applySettings({ ...this.settings, gravity: cycle(GRAVITY_ORDER, this.settings.gravity) });
    else if (id === 'sky') this._applySettings({ ...this.settings, sky: cycle(SKY_ORDER, this.settings.sky) });
    else if (id === 'smash') this._applySettings({ ...this.settings, smash: !this.settings.smash });
    else if (id === 'pvp') this._applySettings({ ...this.settings, pvp: !this.settings.pvp });
    else if (id === 'clear') this.props.clear();
    else if (id === 'rain' || id === 'balloons') {
      const kinds = id === 'balloons' ? [TYPE.balloon] : SPAWNABLE.filter(t => !t.fixed && !t.fuse && !t.float && t.mass < 100);
      const c = this._local ? this._local.head.pos : new THREE.Vector3();
      for (let i = 0; i < (id === 'balloons' ? 12 : 16); i++) {
        const t = kinds[Math.floor(Math.random() * kinds.length)];
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0));
        const y = id === 'balloons' ? 0.5 + Math.random() * 1.5 : 8 + Math.random() * 6;
        this.props.spawn(t.id, new THREE.Vector3(c.x + Math.cos(a) * r, c.y + y, c.z + Math.sin(a) * r), q, { owner: id });
      }
    }
    this.onButton(id, id === 'lowgrav' ? this.settings.gravity === 'low' : true);
  }

  _applySettings(s) {
    this.settings = {
      gravity: GRAVITY[s.gravity] ? s.gravity : 'normal',
      sky: SKY_ORDER.includes(s.sky) ? s.sky : 'day',
      smash: s.smash !== false,
      pvp: s.pvp !== false,
      mode: this.mode || 'sandbox',
    };
    const g = GRAVITY[this.settings.gravity];
    this.loco.cfg.gravity = g;
    this.props.setGravity(g);
    this.onButton('lowgrav', this.settings.gravity === 'low');
    this.onSettings(this.settings);
    this.onChange();
  }

  // ---- the arena
  _setArena(st) {
    const key = JSON.stringify(st);
    if (key === this._arenaKey) return;
    const prev = this.arena;
    this._arenaKey = key;
    this.arena = st;
    this.onArena(st, prev);
  }

  // Host: the tournament moved on.
  _arenaEvent(e) {
    const props = this.props;
    if (e.type === 'start' || e.type === 'waiting') {
      props.clear();
      for (const b of this.bodies.values()) b.reset();
      this._seatBots();
    } else if (e.type === 'match') {
      // a clean floor, two whole fighters, and a full rack of weapons in each room
      props.clear();
      this.held = [null, null];
      for (const id of [e.a, e.b]) this.body(id).reset();
      for (const b of this.bodies.values()) b.armour = [0, 0];      // whatever anyone still had on from an earlier fight is back on the wall
      const yawQ = yaw => new THREE.Quaternion().setFromAxisAngle(DOWN, -yaw);
      const hang = (type, pos, yaw) => { const p = props.spawn(type, pos, yawQ(yaw), { owner: 'rack' }); if (p && p.body) p.body.sleep(); };   // they hang there until someone takes one
      COLOSSEUM.racks.forEach(rack => rack.forEach(([x, y, z, yaw], k) => {
        const type = ARMS[k % ARMS.length];
        hang(type, new THREE.Vector3(x, y + WEAPONS[type].size[1] / 2, z), yaw);
      }));
      COLOSSEUM.kit.forEach(kit => kit.forEach(k => hang(k.type, new THREE.Vector3().fromArray(k.pos), k.yaw)));
      this._seatBots(e);
      // a bot fighter goes to its room and is handed something at random; some get a shield or armour too
      [e.a, e.b].forEach((id, side) => {
        const bot = this.bots.get(id);
        if (!bot) return;
        const room = COLOSSEUM.rooms[side];
        bot.place(new THREE.Vector3().fromArray(room.spawn), room.yaw);
        this._arm(id, ARMS[Math.floor(Math.random() * ARMS.length)], 1);
        if (Math.random() < this.botKit) this._arm(id, 'shield', 0);
        for (let slot = 0; slot < 2; slot++) if (Math.random() < this.botKit) this.body(id).wear(slot);
      });
    } else if (e.type === 'result' || e.type === 'champion') {
      for (const bot of this.bots.values()) bot.cheer();
    }
  }

  // a sandbox dummy puts on what it was made with (again, each time it comes back from the dead)
  _kitOut(id) {
    const bot = this.bots.get(id), kit = bot && bot.kit;
    if (!kit) return;
    this.body(id).wear(0); this.body(id).wear(1);
    const old = kit.prop != null ? this.props.props.get(kit.prop) : null;
    if (old && !old.held) this.props.remove(old.id);          // the shield it dropped when it died
    bot.shieldHand = 0;
    const p = this._arm(id, 'shield', 0);
    kit.prop = p ? p.id : null;
  }

  // ------------------------------------------------------------------ zombies (host)
  _setZombies(st) {
    const key = JSON.stringify(st);
    if (key === this._zKey) return;
    const prev = this.zombies;
    this._zKey = key;
    this.zombies = st;
    this.onZombies(st, prev);
  }

  /** Buy something: a shop's id, or 'door:3'. `hand` is the hand that reached for it. */
  buy(what, hand) { this.request({ t: 'buy', what, hand }); }
  /** Put a board back on window i. */
  repair(i) { this.request({ t: 'repair', i }); }
  /** Loose an arrow from the bow in `hand`. */
  shoot(hand, origin, vel, power = 1) { this.request({ t: 'shoot', hand, o: origin.toArray().map(r3), v: vel.toArray().map(r3), w: r3(power) }); }
  /** How many arrows I have (any number, outside the zombies game). */
  get quiver() { const p = this.zombies.pl[this.myId]; return this.settings.mode === 'zombies' ? (p ? p[4] : 0) : Infinity; }

  // Every frame of the zombies game: the rules move on, the dead are told where the living are.
  _stepZombies(dt) {
    const H = this.horde, poses = this.poses, ids = [], info = {}, foes = [];
    for (const [id, pose] of poses) {
      if (this.isBot(id)) continue;
      const b = this.body(id);
      ids.push(id);
      info[id] = { dead: b.dead, x: pose.head.pos.x, z: pose.head.pos.z };
      if (!b.dead) foes.push({ id, pos: pose.head.pos });
    }
    let alive = 0;
    for (const id of this.bots.keys()) if (this.isZombie(id) && !this.body(id).dead) alive++;
    H.state.alive = alive;
    for (const e of H.update(dt, ids, info)) this._zEvent(e);
    const st = H.state;
    // the way to the nearest of the living, worked out a few times a second
    const nav = this._getNav();
    this._zFieldT -= dt;
    if (this._zFieldT <= 0 && foes.length) { this._zField = nav.field(foes.map(f => f.pos), this._zField || undefined); this._zFieldT = 0.4; }
    this._zBarricades.forEach((b, i) => { b.boards = st.boards[i]; });
    this._zctx = { field: foes.length ? this._zField : null, foes, barricades: this._zBarricades };
    // the spikes
    if (st.trap.on > 0) {
      const [x0, z0, x1, z1] = PRIORY.trap;
      for (const [id, bot] of this.bots) {
        const at = bot.loco.head, body = this.body(id);
        if (!this.isZombie(id) || body.dead || at.x < x0 || at.x > x1 || at.z < z0 || at.z > z1 || at.y > PRIORY.floor + 1.3 * bot.loco.scale) continue;
        bot.lastBy = null;
        this._bodyEvents(id, body.hit('torso', 1e5, { sharp: true, pierce: true }), { dir: new THREE.Vector3(0, 1, 0), push: 1 });
      }
    }
    // walking into what the dead left behind picks it up
    for (const f of foes) {
      const got = H.grab(f.id, f.pos.x, f.pos.z);
      if (got) this._zPower(got.kind, f.id);
    }
  }

  _zEvent(e) {
    const H = this.horde;
    if (e.type === 'intro' || e.type === 'restart' || e.type === 'waiting') {
      // a fresh start: nobody about, every door shut, everyone whole and back in the chapel
      this.props.clear(); this.arrows.clear(); this.held = [null, null];
      for (const id of [...this.bots.keys()]) this._dropPlayer(id);
      this._broadcastRoster();
      for (const [id, b] of this.bodies) { b.reset(); this._fx({ k: 'respawn', id }); }
      this._zDoors();
    } else if (e.type === 'spawn') this._zSpawn(e.kind, e.x, e.z);
    else if (e.type === 'break') {
      // a breather: the living are made whole (their armour stays as it is)
      for (const [id, b] of this.bodies) if (!this.isBot(id) && !b.dead) b.heal();
    } else if (e.type === 'up') { this.body(e.id).reset(); this._fx({ k: 'respawn', id: e.id }); }
    else if (e.type === 'chest') {
      const sh = PRIORY.shops.find(x => x.kind === 'chest'), w = WEAPONS[e.item];
      const p = this.props.spawn(e.item, new THREE.Vector3(sh.pos[0], PRIORY.floor + 0.95 + w.size[1] / 2, sh.pos[2]), new THREE.Quaternion().setFromAxisAngle(DOWN, -Math.PI / 2), { owner: 'rack', color: e.forged ? 1 : 0 });
      if (p) { p.owner = 'chest'; if (p.body) p.body.sleep(); }
    } else if (e.type === 'chest-gone') { for (const p of [...this.props.props.values()]) if (p.owner === 'chest' && !p.held) this.props.remove(p.id); }
    else if (e.type === 'drop') this._fx({ k: 'drop', kind: e.kind, p: [e.x, PRIORY.floor + 0.8, e.z] });
  }

  // shut and open doors in the grid the dead find their way by
  _zDoors() {
    if (this.settings.mode !== 'zombies') return;
    const nav = this._getNav(), hw = PRIORY.door.w / 2;
    PRIORY.doors.forEach((d, i) => {
      const min = d.nz ? { x: d.x - hw, z: d.z - 0.2 } : { x: d.x - 0.2, z: d.z - hw }, max = d.nz ? { x: d.x + hw, z: d.z + 0.2 } : { x: d.x + 0.2, z: d.z + hw };
      nav.block(min, max, !this.horde.state.doors[i]);
    });
    this._zFieldT = 0;
  }

  /** Start the zombies game again from the first round. */
  _zRestart() { this.horde.reset(); this._zEvent({ type: 'restart' }); }

  // one of the dead climbs out of the ground
  _zSpawn(kind, x, z) {
    const K = KINDS[kind], id = 'z' + (++this._botN), round = this.horde.state.round;
    const c = new THREE.Color(K.color).offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.08);
    const bot = new Bot(id, this._botN, this.world, new THREE.Vector3(x + (Math.random() - 0.5) * 1.2, PRIORY.floor - 0.6, z + (Math.random() - 0.5) * 1.2),
      { name: '', color: c.getHex(), brain: 'zombie', pace: K.pace, reach: K.reach, hitEvery: K.hitEvery, scale: K.scale, tag: kind });
    bot.dmg = K.dmg; bot.bomb = !!K.bomb; bot.tough = ZOMBIES.tough(round) * K.tough;
    bot.cool = 0.8;
    this.bots.set(id, bot);
    const p = { id, name: '', color: bot.color, state: packState(bot.pose), bot: true, z: kind };
    this.players.set(id, p);
    this._ensureAvatar(p);
    if (K.armour) { this.body(id).wear(0); this.body(id).wear(1); }
    this._broadcastRoster();
    this._fx({ k: 'rise', id, kind, p: [r3(x), PRIORY.floor, r3(z)] });
    return bot;
  }

  // one of the dead is down for good: points, perhaps something left behind, and its body is cleared away
  _zKilled(id, ctx, rig, head) {
    const bot = this.bots.get(id), by = ctx.by && !this.isBot(ctx.by) ? ctx.by : bot && bot.lastBy;
    const at = rig.head;
    for (const e of this.horde.killed(by || null, head, r3(at.x), r3(at.z), bot ? bot.tag : 'walker')) this._zEvent(e);
    if (!this._zDead.includes(id)) this._zDead.push(id);
    if (bot && bot.bomb && !bot.blown) this._zExplode(id, true);
    // Bodies do not lie about for long here, or there would soon be no room for the living (nor,
    // on a headset, the time to draw them): three at once at most, and each for a few seconds.
    const rags = [];
    for (const p of this.props.props.values()) { if (!p.type.gib) continue; if (p.life > 12) p.life = 12; if (p.rag && !rags.includes(p.rag)) rags.push(p.rag); }
    while (rags.length > 2) this.props.removeGroup(rags.shift());
  }

  // a bomber goes off: everyone near it is hurt, the dead as well as the living
  _zExplode(id, dying = false) {
    const bot = this.bots.get(id), pose = this.poses.get(id);
    if (!bot || bot.blown || !pose) return;
    bot.blown = true;
    const at = pose.head.pos.clone(), R = 3.6;
    if (this.net.role === 'host') this.net.broadcast({ t: 'boom', pos: at.toArray().map(r3) });
    this.onBoom(at);
    for (const [oid, op] of this.poses) {
      const body = this.body(oid);
      if (body.dead || oid === id) continue;
      const d = op.head.pos.distanceTo(at);
      if (d > R) continue;
      const dir = op.head.pos.clone().sub(at).setY(0.3).normalize(), k = 1 - d / R;
      const dmg = this.isZombie(oid) ? 1e4 : 55 * k * this.horde.armour(oid);
      if (this.isZombie(oid)) { const ob = this.bots.get(oid); if (ob) ob.lastBy = bot.lastBy || null; }
      if (dmg > 0) this._bodyEvents(oid, body.hit('torso', dmg, { pierce: true }), { dir, push: 4 * k, blast: this.isZombie(oid) });
    }
    if (!dying) { const body = this.body(id); this._bodyEvents(id, body.hit('torso', 1e5, { pierce: true }), { dir: new THREE.Vector3(0, 1, 0), push: 3, blast: true }); }
  }

  // something the dead left behind has been picked up
  _zPower(kind, by) {
    if (kind === 'fire') {
      for (const [id, bot] of this.bots) {
        const body = this.body(id), rig = this.rigs.get(id);
        if (!this.isZombie(id) || body.dead || !rig) continue;
        bot.lastBy = null; bot.blown = true;
        this._fx({ k: 'ash', id, p: rig.torsoTop.toArray().map(r3) });
        body.dead = true; body.respawn = 1e9;
        this.horde.killed(null, false, rig.head.x, rig.head.z, 'walker');
        if (!this._zDead.includes(id)) this._zDead.push(id);
      }
    } else if (kind === 'mend') {
      for (const [id, b] of this.bodies) if (!this.isBot(id) && !b.dead) { b.heal(); for (let slot = 0; slot < 2; slot++) if (b.armour[slot] > 0) b.armour[slot] = BODY.armour[slot]; }
    }
    this._fx({ k: 'power', kind, by });
  }

  _hostBuy(from, msg) {
    if (this.settings.mode !== 'zombies' || typeof msg.what !== 'string') return;
    const pose = this.poses.get(from), body = this.body(from), hand = msg.hand ? 1 : 0;
    if (!pose || body.dead) return;
    // it has to be within reach
    const door = msg.what.startsWith('door:') ? PRIORY.doors[Number(msg.what.slice(5))] : null, shop = PRIORY.shops.find(x => x.id === msg.what);
    const at = door ? [door.x, 1, door.z] : shop ? shop.pos : null;
    if (!at || Math.hypot(pose.head.pos.x - at[0], pose.head.pos.z - at[2]) > 3.2) return;
    const held = this.weaponIn(from, hand) || this.weaponIn(from, 1 - hand);
    const res = this.horde.buy(from, msg.what, held ? { weapon: true, forged: !!held.color } : null, body.armour);
    const tell = e => { if (from === this.myId) this.onBodyFx(e); else this.net.sendTo(from, { t: 'bfx', ...e }); };
    if (!res.ok) return tell({ k: 'nobuy', why: res.why });
    if (res.kind === 'door') this._zDoors();
    else if (res.kind === 'weapon') {
      // it goes straight into the hand that reached for it (whatever was in that hand is put away)
      const old = this.weaponIn(from, hand);
      if (old) this.props.remove(old.id);
      const h = pose.hands[hand];
      const p = this.props.spawn(res.item, h.pos.clone(), null, { owner: 'rack' });
      if (p && this.props.grab(p.id, { key: `${from}:${hand}`, pos: h.pos, quat: h.quat })) {
        if (from === this.myId) this.held[hand] = p.id; else this.net.sendTo(from, { t: 'given', hand, id: p.id });
      }
    } else if (res.kind === 'armour') body.wear(res.slot);
    else if (res.kind === 'forge') this.props.forge(held);
    this._fx({ k: 'buy', by: from, what: msg.what, kind: res.kind, item: res.item || null, cost: res.cost, hand, p: at });
  }

  _hostRepair(from, msg) {
    const i = Number(msg.i), w = PRIORY.windows[i], pose = this.poses.get(from), now = performance.now();
    if (this.settings.mode !== 'zombies' || !w || !pose || Math.hypot(pose.head.pos.x - w.x, pose.head.pos.z - w.z) > 2.6) return;
    if (now - (this._repairAt.get(from) || 0) < ZOMBIES.repair * 900) return;
    // not while one of them is at it
    for (const [id, bot] of this.bots) if (this.isZombie(id) && !this.body(id).dead && Math.hypot(bot.loco.head.x - w.x, bot.loco.head.z - w.z) < 1.3) return;
    const got = this.horde.repair(from, i);
    if (got < 0) return;
    this._repairAt.set(from, now);
    this._fx({ k: 'board', i, n: this.horde.state.boards[i], by: from, pts: got, p: [w.x, PRIORY.floor + 1, w.z] });
  }

  _hostShoot(from, msg) {
    const hand = msg.hand ? 1 : 0, held = this.weaponIn(from, hand), body = this.body(from);
    if (!held || !held.type.weapon.bow || body.dead || !Array.isArray(msg.o) || !Array.isArray(msg.v) || msg.o.length !== 3 || msg.v.length !== 3 || ![...msg.o, ...msg.v].every(Number.isFinite)) return;
    const pose = this.poses.get(from), o = new THREE.Vector3().fromArray(msg.o), v = new THREE.Vector3().fromArray(msg.v), bow = held.type.weapon.bow;
    if (!pose || o.distanceTo(pose.head.pos) > 2.5 * pose.scale || v.length() < 3) return;
    if (v.length() > bow.speed) v.setLength(bow.speed);
    if (this.settings.mode === 'zombies') {
      const p = this.horde.state.pl[from];
      if (!p || p.arrows <= 0) return;
      p.arrows--;
    }
    const id = ++this._arrowN, power = v.length() / bow.speed;
    const a = this.arrows.shoot(id, o, v, from, power);
    a.forged = !!held.color; a.dmg = bow.dmg;
    this._fx({ k: 'arrow', a: id, by: from, o: msg.o, v: v.toArray().map(r3), p: msg.o });
  }

  // Has an arrow met somebody between these two points? (The host asks this for every arrow in the air.)
  _arrowHit(from, to, a) {
    const len = from.distanceTo(to), steps = Math.max(1, Math.ceil(len / 0.1)), pt = new THREE.Vector3();
    for (const [id, rg] of this.rigs) {
      if (id === a.by || !this.mayHurt(a.by, id) || rg.head.distanceTo(from) > len + 2 * rg.scale) continue;
      for (let k = 1; k <= steps; k++) {
        pt.lerpVectors(from, to, k / steps);
        const part = hitPart(rg, this.body(id).cut, pt, 0.06);
        if (!part) continue;
        const dir = a.v.clone().setY(0).normalize(), tp = this.poses.get(id);
        const dmg = (a.dmg || 40) * (0.35 + 0.65 * a.power) / Math.pow(tp ? tp.scale : 1, 1.5);
        this._fx({ k: 'arrowhit', a: a.id, id, p: pt.toArray().map(r3) });
        this._harm(a.by, id, part, dmg, { sharp: true }, { dir, knock: 0.6 }, a.forged);
        return true;
      }
    }
    return false;
  }

  // put a weapon (or a shield) straight into a bot's hand
  _arm(id, type, hand) {
    const bot = this.bots.get(id);
    if (!bot) return null;
    const h = bot.pose.hands[hand];
    const p = this.props.spawn(type, h.pos.clone(), null, { owner: 'rack' });
    if (p) this.props.grab(p.id, { key: `${id}:${hand}`, pos: h.pos, quat: h.quat });
    return p;
  }

  // bots that are not fighting sit in the seats (all of them, or just `only`)
  _seatBots(match = null, only = null) {
    let k = 0;
    for (const [id, bot] of this.bots) {
      k++;
      if ((match && (match.a === id || match.b === id)) || (only && only !== id)) continue;
      const seat = COLOSSEUM.seat(k * 2 - 1);
      bot.place(new THREE.Vector3().fromArray(seat.pos), seat.yaw);
    }
  }

  // How much is someone swinging at whoever is at `at`? 0 to 1.
  _threat(id, at) {
    const pose = this.poses.get(id);
    if (!pose || pose.head.pos.distanceTo(at) > 2.8 * pose.scale) return 0;
    const bot = this.bots.get(id);
    if (bot) return bot.swing > 0 ? 1 : 0;
    const rec = this._swing.get(id);
    return rec ? Math.min(Math.max((rec.v - 1.8) / 2.2, 0), 1) : 0;
  }

  // the grid the bots find their way by, worked out again when the map has changed
  _getNav() {
    if (!this.nav) this.nav = new Nav(this.world);
    if (this._navFor !== this.mode || (this._navDirty && this._navT <= 0)) {
      this.nav.build();
      this._navFor = this.mode; this._navDirty = false; this._navT = 8;
      this.onNav(this.nav);
    }
    return this.nav;
  }

  // something a bot did, other than land a blow
  _botEvent(id, bot, e) {
    if (e.type === 'tear') {
      const left = this.horde.tear(e.id), w = PRIORY.windows[e.id];
      this._fx({ k: 'tear', i: e.id, n: left, p: [w.x, PRIORY.floor + 1, w.z] });
      return;
    }
    if (e.type === 'lost' && this.isZombie(id)) {
      // one of the dead that cannot find a way: it comes up again somewhere it can
      const sp = this.horde.spawns(), at = sp[Math.floor(Math.random() * sp.length)];
      if (at) bot.place(new THREE.Vector3(at.x, PRIORY.floor - 0.6, at.z));
      return;
    }
    if (e.type === 'lost' && this.nav) {
      // it cannot get where it is going: put it back somewhere it can walk
      const c = this.nav.nearest(bot.home.x, bot.home.z, 6);
      if (c >= 0) { const p = this.nav.pos(c); p.y += 0.3 - 0.7; bot.loco.teleport(p, bot.yaw); }
    }
  }

  // by how much a blow from `by` to `id` is scaled (zombies mode changes this)
  _hurtScale(by, id) { return this.settings.mode === 'zombies' ? this.horde.armour(id) : 1; }

  // how far a bot can hit from: an arm, plus whatever it is holding
  _reach(held) {
    const w = held && held.type.weapon;
    return 0.85 + (w ? w.hits[w.hits.length - 1][1] - w.hilt : 0);
  }

  // A bot's blow has landed: if its opponent is still within reach, it hurts.
  _botStrike(id, held, foe) {
    const ap = this.poses.get(id), tp = this.poses.get(foe), tb = this.bodies.get(foe), body = this.body(id);
    if (!this.mayHurt(id, foe) || !ap || !tp || !(body.canUse(0) || body.canUse(1))) return;
    const zb = this.bots.get(id), far = zb && zb.brain === 'zombie' ? zb.reach * ap.scale : this._reach(held);
    if (ap.head.pos.distanceTo(tp.head.pos) > far + 0.3) return;        // they got away
    const w = held && held.type.weapon;
    const hand = Number(held ? held.held.key.split(':')[1] : body.canUse(1) ? 1 : 0);
    // (the dead mostly go for the body; a fighter is as likely to go for an arm)
    const roll = Math.random() - (zb && zb.brain === 'zombie' ? 0.17 : 0), aim = roll < 0.45 ? 'torso' : roll < 0.6 ? 'head' : ['upperL', 'foreL', 'upperR', 'foreR'][Math.floor(Math.random() * 4)];
    const arm = aim.endsWith('L') ? 0 : 1, gone = aim !== 'torso' && aim !== 'head' && tb.cut[arm] >= (aim.startsWith('fore') ? 1 : 2);
    const part = gone ? 'torso' : aim;
    // Caught on what they are holding? Either the weapon ran into it (at some point in the swing, or
    // where it has ended up), or it is in the way: it hides the part the blow was meant for from
    // the shoulder that threw it. So a shield held between you and a bot covers what is behind it.
    const bot = this.bots.get(id), hp = ap.hands[hand].pos, rig = this.rigs.get(id), tr = this.rigs.get(foe);
    const target = !tr ? null : part === 'head' ? tr.head : part === 'torso' ? tr.torsoTop.clone().lerp(tr.torsoBottom, 0.4) : (part.startsWith('fore') ? tr.wrist : tr.elbow)[arm];
    const caught = (bot && bot.caught)
      || this._caught(foe, hp, w ? held.mesh.position.clone().add(new THREE.Vector3(0, w.hits[w.hits.length - 1][1], 0).applyQuaternion(held.mesh.quaternion)) : hp, w ? w.r : RIG.handR)
      || (rig && target ? this._caught(foe, rig.shoulder[hand], target, 0.08) : null);
    if (caught) return this._fx({ k: 'block', id: foe, dh: caught.hand, by: id, hand, p: caught.at.toArray().map(r3), v: 5 });
    const dmg = (w ? w.dmg * 0.65 : (bot && bot.dmg) || 13) * (0.8 + Math.random() * 0.4) * this._hurtScale(id, foe);
    const dir = tp.head.pos.clone().sub(ap.head.pos).setY(0).normalize();
    const sharp = !!(w && w.sharp), blunt = !!(w && !w.sharp);
    const events = tb.hit(part, dmg, { sharp, blunt });
    if (w && events.some(e => e.type === 'hit')) this.props.bloody(held);
    this._bodyEvents(foe, events, { by: id, hand, dir, push: Math.min(dmg / 10, 4.5) * (w ? w.knock : 1), sharp, blunt });
  }

  _setRound(round) {
    const prev = this.round;
    if (prev.phase === round.phase && prev.t === round.t && prev.giant === round.giant && prev.n === round.n && prev.out.length === round.out.length && prev.winner === round.winner) return;
    this.round = round;
    this.onRound(round, prev);
  }

  // Hand pose of any player, from the local player or the last state they sent.
  _handPose(id, i) {
    if (id === this.myId) return this._local ? this._local.hands[i] : null;
    const s = this.players.get(id)?.state;
    if (!s) return null;
    const o = 7 + i * 7;
    return { pos: new THREE.Vector3(s[o], s[o + 1], s[o + 2]), quat: new THREE.Quaternion(s[o + 3], s[o + 4], s[o + 5], s[o + 6]) };
  }

  // ---- local player actions
  select(typeId) { const i = SPAWNABLE.findIndex(t => t.id === typeId); if (i >= 0) this.selected = i; }

  /** Spawn the selected item right in front of a hand (dir = which way the fingers point). */
  spawnSelected(handPos, dir, scale = 1) {
    const t = this.selectedType;
    const reach = t.shape === 'sphere' ? t.r : Math.max(...(t.size || [t.r * 2, t.h, t.r * 2])) / 2;
    const pos = handPos.clone().addScaledVector(dir, 0.25 * scale + reach);
    if (!t.fixed) pos.y += 0.1;
    const yaw = Math.atan2(-dir.x, -dir.z);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.request({ t: 'spawn', type: t.id, pos: pos.toArray(), quat: quat.toArray() });
  }

  /** Throw a mini item; it grows to full size where it lands. */
  throwItem(typeId, pos, vel) {
    this.request({ t: 'throw', type: typeId, pos: pos.toArray().map(r3), vel: vel.toArray().map(r3) });
  }

  deleteNear(handPos, scale = 1) {
    const p = this.props.nearest(handPos, 0.3 * scale);
    if (p) this.request({ t: 'del', id: p.id });
    return !!p;
  }

  undo() { this.request({ t: 'undo' }); }

  grab(i, handPos, scale = 1) {
    if (this.held[i] != null) return false;
    const p = this.props.nearest(handPos, 0.18 * scale, pr => !pr.held && !pr.heldKey);
    if (!p) return false;
    // armour you are not already wearing goes straight on (a dented piece is only scrap, to hold or throw)
    if (p.type.armour && !p.wounds && this.body().armour[p.type.armour.slot] === 0) { this.request({ t: 'wear', id: p.id }); return true; }
    this.held[i] = p.id;
    this.request({ t: 'grab', id: p.id, hand: i });
    return true;
  }

  release(i, vel) {
    const id = this.held[i];
    if (id == null) return;
    this.held[i] = null;
    this.request({ t: 'release', id, hand: i, vel: vel ? vel.toArray().map(v => Math.round(v * 100) / 100) : null });
  }

  pressButton(id) { this.request({ t: 'button', id }); }

  // ---- bodies: hitting, grabbing and ripping
  /**
   * May `by` hurt `id` right now? In the sandbox: bots always, people only while fighting
   * is on. In the arena: only the two in the ring, and only once the gates are open.
   */
  mayHurt(by, id) {
    const b = this.bodies.get(id);
    if (by === id || !b || b.dead) return false;
    if (this.settings.mode === 'sandbox') return this.isBot(id) || this.settings.pvp;
    if (this.settings.mode === 'arena') { const a = this.arena; return a.phase === 'fight' && ((a.a === by && a.b === id) || (a.b === by && a.a === id)); }
    // zombies: the living and the dead hurt each other, and nobody hurts their own side
    if (this.settings.mode === 'zombies') return this.isZombie(by) !== this.isZombie(id) && this.zombies.phase !== 'over';
    return false;
  }
  canHurt(id) { return this.mayHurt(this.myId, id); }
  /** My fist (or the weapon `prop` in it) landed on someone. power is roughly the damage at equal size. */
  hit(id, part, power, hand, prop = null) { this.request({ t: 'hit', id, part, power: r3(power), hand, prop }); }
  /** The weapon in one of a player's hands, or null: { prop, weapon }. */
  weaponIn(id, hand) {
    const key = `${id}:${hand}`;
    for (const p of this.props.props.values()) if (p.type.weapon && ((p.held && p.held.key === key) || p.heldKey === key)) return p;
    return null;
  }
  /**
   * What a player is holding that would stop a blow: [{ hand, prop, g }] (g as guardOf() gives it),
   * taken from where those things are drawn, so a blow that looks caught is caught.
   */
  guards(id) {
    const out = [];
    for (const p of this.props.props.values()) {
      if (!p.type.weapon) continue;
      const key = p.held ? p.held.key : p.heldKey;
      if (key !== `${id}:0` && key !== `${id}:1`) continue;
      out.push({ hand: key.endsWith('1') ? 1 : 0, prop: p, g: guardOf(p.type.weapon, p.mesh.position, p.mesh.quaternion) });
    }
    return out;
  }
  /** My blow (from `hand`) was caught on what `id` holds in their hand `dh`, at point p, going v m/s. */
  block(id, dh, hand, p, v) { this.request({ t: 'block', id, dh, hand, p: p.toArray().map(r3), v: r3(v) }); }
  /** Take hold of someone's arm with one of my hands; pull far enough and it comes off. */
  holdArm(id, arm, hand) { this.request({ t: 'hold', id, arm, hand }); }
  letGoArm(hand) { this.request({ t: 'unhold', hand }); }
  /** Mouse players cannot pull, so they get to take a bot's arm straight off. */
  ripArm(id, arm, hand) { this.request({ t: 'rip', id, arm, hand }); }
  /** Add a bot. kit: (sandbox) one in armour with a shield. */
  addBot(kit = false) { this.request({ t: 'bot', cmd: 'add', kit: kit ? 1 : 0 }); }
  clearBots() { this.request({ t: 'bot', cmd: 'clear' }); }
  /** Whose arm, if any, this hand of mine has hold of: { id, arm } or null. */
  holding(hand) {
    const key = `${this.myId}:${hand}`;
    for (const [id, b] of this.bodies) for (let a = 0; a < 2; a++) if (b.held[a] === key) return { id, arm: a };
    return null;
  }

  _hostHit(from, msg) {
    const hand = msg.hand ? 1 : 0;
    const tb = this.bodies.get(msg.id), tp = this.poses.get(msg.id), ap = this.poses.get(from);
    if (!this.mayHurt(from, msg.id) || !tp || !ap || !BODY_PARTS.includes(msg.part) || !this.body(from).canUse(hand)) return;
    if (ap.hands[hand].pos.distanceTo(tp.head.pos) > 2.5 * (ap.scale + tp.scale)) return;      // has to be within arm's reach
    // a weapon counts only if it really is in that hand
    const held = msg.prop != null ? this.props.props.get(msg.prop) : null;
    const w = held && held.type.weapon && held.held && held.held.key === `${from}:${hand}` ? held.type.weapon : null;
    const dmg = Math.min(Math.max(Number(msg.power) || 0, 0), 250) / Math.pow(tp.scale, 1.5);  // bigger bodies shrug more off
    const dir = tp.head.pos.clone().sub(ap.head.pos).setY(0).normalize();
    const sharp = !!(w && w.sharp), blunt = !!(w && !w.sharp);
    // the one who swung judged that it landed; if from here it is plainly lying on their guard, it did not
    const from0 = ap.hands[hand].pos, to = w ? held.mesh.position.clone().add(new THREE.Vector3(0, w.hits[w.hits.length - 1][1], 0).applyQuaternion(held.mesh.quaternion)) : from0;
    const caught = this._caught(msg.id, from0, to, w ? w.r : RIG.handR * ap.scale);
    if (caught) return this._fx({ k: 'block', id: msg.id, dh: caught.hand, by: from, hand, p: caught.at.toArray().map(r3), v: 4 });
    const events = this._harm(from, msg.id, msg.part, dmg, { sharp, blunt }, { hand, dir, knock: w ? w.knock : 1 }, !!(held && held.color));
    if (w && events.some(e => e.type === 'hit')) this.props.bloody(held);
  }

  // Somebody's blow (fist, weapon or arrow) lands on a body. In the zombies game the dead are tougher
  // by the round, the living hit harder with tonics and forged weapons, and it all earns points.
  _harm(from, id, part, dmg, kind, ctx, forged = false) {
    const tb = this.body(id), zombie = this.settings.mode === 'zombies' && this.isZombie(id), bot = this.bots.get(id);
    if (zombie && bot) { dmg *= this.horde.power(from, forged) / (bot.tough || 1); bot.lastBy = from; }
    const events = tb.hit(part, dmg, kind);
    if (zombie && events.length) this.horde.hit(from);
    this._bodyEvents(id, events, { by: from, hand: ctx.hand ?? -1, dir: ctx.dir, push: Math.min(dmg / 10, 4.5) * (ctx.knock || 1), sharp: kind.sharp, blunt: kind.blunt });
    return events;
  }

  // Is something along the line from p0 to p1 (radius r) on one of this player's guards? { hand, at } or null.
  _caught(id, p0, p1, r) {
    for (const gd of this.guards(id)) {
      const at = guardStops(gd.g, p0, p1, r);
      if (at) return { hand: gd.hand, at };
    }
    return null;
  }

  // A player says their blow was caught on someone's weapon or shield: everyone hears it, and the two of them feel it.
  _hostBlock(from, msg) {
    const hand = msg.hand ? 1 : 0, dh = msg.dh ? 1 : 0;
    const tp = this.poses.get(msg.id), ap = this.poses.get(from);
    if (!this.mayHurt(from, msg.id) || !tp || !ap || !Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return;
    if (!this.weaponIn(msg.id, dh) || ap.hands[hand].pos.distanceTo(tp.head.pos) > 2.5 * (ap.scale + tp.scale)) return;
    this._fx({ k: 'block', id: msg.id, dh, by: from, hand, p: msg.p.map(r3), v: r3(Math.min(Math.max(Number(msg.v) || 0, 0), 20)) });
  }

  _hostHold(from, msg) {
    const hand = msg.hand ? 1 : 0, arm = msg.arm ? 1 : 0;
    const tb = this.bodies.get(msg.id), tp = this.poses.get(msg.id), ap = this.poses.get(from), rig = this.rigs.get(msg.id);
    if (!this.mayHurt(from, msg.id) || !tp || !ap || !rig || !this.body(from).canUse(hand)) return;
    if (tb.cut[arm] >= 2 || tb.held[arm] || ap.scale < 0.5 * tp.scale) return;                 // nothing to hold, or far too small to hold it
    if (grabArm(rig, tb.cut, ap.hands[hand].pos, 0.25 * ap.scale) !== arm) return;
    tb.held[arm] = `${from}:${hand}`; tb.holdT[arm] = 0;
    this._fx({ k: 'grab', id: msg.id, arm, by: from, p: ap.hands[hand].pos.toArray().map(r3) });
  }

  // an arm comes off at the shoulder in someone's hand
  _rip(id, arm, who, hand) {
    this._bodyEvents(id, this.body(id).sever(arm, 2), { by: who, hand, ripped: true });
  }

  // Turn what Body reports into things in the world: blood, loose pieces, corpses, messages to everyone.
  _bodyEvents(id, events, ctx = {}) {
    if (!events.length) return;
    const rig = this.rigs.get(id), pose = this.poses.get(id), color = this.colorOf(id);
    if (!rig || !pose) return;
    const s = pose.scale, arr = v => v.toArray().map(r3);
    const fling = () => new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3);
    const along = dir => new THREE.Quaternion().setFromUnitVectors(DOWN, dir);     // arm pieces lie along their own -Y
    // a loose piece of this body: in its skin colour, and its size
    const loose = (type, pos, quat, vel, wounds = null, rag = 0) => {
      const lying = [...this.props.props.values()].filter(p => p.type.gib && !p.held);
      if (lying.length >= MAX_GIBS) { if (lying[0].rag && lying[0].rag !== rag) this.props.removeGroup(lying[0].rag); else this.props.remove(lying[0].id); }
      return this.props.spawn(type, pos, quat, { owner: 'gib', color, vel, scale: s, wounds, rag });
    };
    // where the pieces of an arm are: each one's middle, and the way it points
    const arm = a => {
      const S = rig.shoulder[a], d1 = rig.elbow[a].clone().sub(S).normalize(), E = S.clone().addScaledVector(d1, RIG.upper * s);
      const d2 = rig.wrist[a].clone().sub(rig.elbow[a]).normalize(), dAll = rig.wrist[a].clone().sub(S).normalize(), side = a ? RIGHT : 0;
      return {
        S, E, d1, d2, dAll, side,
        upper: S.clone().addScaledVector(d1, RIG.upper * s / 2),
        fore: E.clone().addScaledVector(d2, (RIG.fore + RIG.hand) * s / 2),
        whole: S.clone().addScaledVector(dAll, (RIG.upper + RIG.fore + RIG.hand) * s / 2),
      };
    };
    if (this.settings.mode === 'zombies' && events.some(e => e.type === 'die')) {
      const body = this.body(id);
      if (this.isZombie(id)) this._zKilled(id, ctx, rig, events.some(e => e.type === 'behead'));
      else if (this.horde.died(id) === 'saved') {
        // Nine Lives: they are not dead after all
        body.revive();
        this._fx({ k: 'saved', id, p: arr(rig.head) });
        return;
      } else body.respawn = 1e9;        // out until the round is over (see _stepZombies)
    }
    for (const e of events) {
      if (e.type === 'armour') {
        // the blow rang off a helmet or a chest plate; the last one it can take knocks it off, bent
        const at = e.slot ? rig.torsoTop.clone().lerp(rig.torsoBottom, 0.4) : rig.head;
        if (e.left === 0) this._shed(id, e.slot, pose, rig, ctx.dir, 3 + Math.min(ctx.push || 0, 3));
        this._fx({ k: 'armour', id, slot: e.slot, left: e.left, p: arr(at), by: ctx.by || 0, hand: ctx.hand ?? -1 });
        const bot = this.bots.get(id);
        if (bot && ctx.dir) bot.knock(ctx.dir, Math.min(ctx.push || 1, 1.5));
      } else if (e.type === 'hit') {
        const at = e.part === 'head' ? rig.head : e.part === 'torso' ? rig.torsoTop : (e.part.startsWith('fore') ? rig.wrist : rig.elbow)[e.part.endsWith('L') ? 0 : 1];
        this._fx({ k: 'hit', id, part: e.part, dmg: Math.round(e.dmg), p: arr(at), d: ctx.dir ? arr(ctx.dir) : [0, 0, 0], push: r3(ctx.push || 0), by: ctx.by || 0, hand: ctx.hand ?? -1, sharp: ctx.sharp ? 1 : 0, blunt: ctx.blunt ? 1 : 0 });
        const bot = this.bots.get(id);
        if (bot && ctx.dir) bot.knock(ctx.dir, ctx.push || 1);
        if (this.settings.mode === 'arena') for (const [bid, b] of this.bots) if (bid !== id && bid !== ctx.by) b.cheer();     // the crowd likes that
      } else if (e.type === 'sever') {
        const A = arm(e.arm);
        // which piece came off: the whole arm, just the forearm, or the stump that was left
        const [type, pos, dir] = e.level === 1 ? ['gib_fore', A.fore, A.d2] : e.was === 1 ? ['gib_upper', A.upper, A.d1] : ['gib_arm', A.whole, A.dAll];
        // torn off by hand, it stays in that hand (if the hand is empty); otherwise it flies off
        const key = `${ctx.by}:${ctx.hand}`, hp = ctx.ripped ? this.poses.get(ctx.by)?.hands[ctx.hand] : null;
        const keep = !!hp && ![...this.props.props.values()].some(p => p.held && p.held.key === key);
        const gib = loose(type, pos, along(dir), keep ? null : fling(), LOOSE[type] | A.side);
        if (keep && gib && this.props.grab(gib.id, { key, pos: hp.pos, quat: hp.quat })) {
          if (ctx.by === this.myId) this.held[ctx.hand] = gib.id; else this.net.sendTo(ctx.by, { t: 'given', hand: ctx.hand, id: gib.id });
        }
        this._fx({ k: 'sever', id, arm: e.arm, level: e.level, p: arr(e.level === 1 ? rig.elbow[e.arm] : A.S), ripped: ctx.ripped ? 1 : 0, by: ctx.by || 0 });
      } else if (e.type === 'behead') {
        if (e.crushed) {
          // burst by something heavy: there is no head left to fly off, only bits of it
          this._fx({ k: 'pop', id, p: arr(rig.head), d: ctx.dir ? arr(ctx.dir) : [0, 0, 0], by: ctx.by || 0 });
        } else {
          // the head goes flying the way it was hit
          const v = fling().multiplyScalar(0.6);
          if (ctx.dir) v.addScaledVector(ctx.dir, 3 + Math.min(ctx.push || 0, 4));
          v.y += 2.5;
          loose('gib_head', this._headAt(pose), pose.head.quat.clone().multiply(Y_FLIP), v, 1);
        }
        this._fx({ k: 'behead', id, p: arr(rig.torsoTop), by: ctx.by || 0 });
      } else if (e.type === 'bisect') {
        this._fx({ k: 'bisect', id, p: arr(rig.torsoTop.clone().lerp(rig.torsoBottom, 0.55)), d: ctx.dir ? arr(ctx.dir) : [0, 0, 0], by: ctx.by || 0 });
      } else if (e.type === 'die') {
        const body = this.body(id);
        for (let slot = 0; slot < 2; slot++) if (body.armour[slot] > 0) { body.armour[slot] = 0; this._shed(id, slot, pose, rig, ctx.dir, 1.5); }   // the dead have no use for armour
        if (ctx.blast) {
          // blown to bits: every piece goes its own way
          const out = () => fling().addScaledVector(ctx.dir || DOWN, ctx.dir ? 4 : 0);
          if (!body.headOff) loose('gib_head', this._headAt(pose), pose.head.quat.clone().multiply(Y_FLIP), out(), 1);
          loose('gib_chest', this._pieceAt('gib_chest', pose, rig), rig.rootQuat.clone(), out().multiplyScalar(0.7), 7 | CUT);
          loose('gib_belly', this._pieceAt('gib_belly', pose, rig), rig.rootQuat.clone(), out().multiplyScalar(0.7), CUT);
          loose('gib_guts', this._pieceAt('gib_guts', pose, rig), rig.rootQuat.clone(), out(), 0);
          for (let a = 0; a < 2; a++) {
            const A = arm(a);
            if (body.cut[a] < 2) loose('gib_upper', A.upper, along(A.d1), out(), 3 | A.side);
            if (body.cut[a] === 0) loose('gib_fore', A.fore, along(A.d2), out(), 1 | A.side);
          }
        } else this._corpse(id, pose, rig, body, ctx, loose, arm, along);
        this._fx({ k: 'die', id, p: arr(rig.head), by: ctx.by || 0, blast: ctx.blast ? 1 : 0 });
      } else if (e.type === 'respawn') {
        const bot = this.bots.get(id);
        if (bot && this.settings.mode === 'arena') {
          // back from the dead: to the seats, unless it is up again already
          const T = this.tournament.state;
          this._seatBots(T.phase === 'prep' || T.phase === 'fight' ? T : null, id);
        } else if (bot) { bot.respawn(); this._kitOut(id); }
        this._fx({ k: 'respawn', id });
      }
    }
  }

  // A piece of armour comes off this body and lands as scrap.
  _shed(id, slot, pose, rig, dir, speed) {
    const type = SLOTS[slot], s = pose.scale;
    const quat = (slot ? rig.rootQuat.clone() : pose.head.quat.clone().multiply(Y_FLIP));
    const pos = new THREE.Vector3().fromArray(ARMOUR[type].worn).multiplyScalar(s).applyQuaternion(quat).add(pose.head.pos);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 2);
    if (dir) vel.addScaledVector(dir, speed);
    this.props.spawn(type, pos, quat, { owner: 'scrap', vel, wounds: 1 });
  }

  // where the head and torso pieces sit for a body in this pose
  _headAt(pose) {
    const f = gibFrame('gib_head');
    return f ? f.centre.clone().multiplyScalar(pose.scale).applyQuaternion(pose.head.quat.clone().multiply(Y_FLIP)).add(pose.head.pos) : pose.head.pos.clone();
  }
  _torsoAt(pose, rig) { return this._pieceAt('gib_torso', pose, rig); }
  // a piece of the torso (the whole of it, either half, or what was inside)
  _pieceAt(type, pose, rig) {
    const f = gibFrame(type);
    return f ? f.centre.clone().multiplyScalar(pose.scale).applyQuaternion(rig.rootQuat).add(pose.head.pos)
      : rig.torsoTop.clone().lerp(rig.torsoBottom, type === 'gib_chest' ? 0.25 : type === 'gib_torso' ? 0.5 : 0.8);
  }

  // A dead body: what is left of it, jointed together at the neck, shoulders and elbows,
  // dropped where it stood and left to flop.
  _corpse(id, pose, rig, body, ctx, loose, arm, along) {
    const s = pose.scale, props = this.props, rag = this._ragN = (this._ragN || 0) + 1;
    // it keeps going the way it was moving, and the way the last blow sent it
    const base = new THREE.Vector3(0, 0.6, 0);
    const bot = this.bots.get(id);
    if (bot) base.add(bot.loco.vel);           // (a bot has already been knocked back by the blow)
    else if (ctx.dir) base.addScaledVector(ctx.dir, 1 + (ctx.push || 0));
    const flat = Math.hypot(base.x, base.z);
    if (flat > 4) { base.x *= 4 / flat; base.z *= 4 / flat; }          // a hard shove, not a cannon
    base.y = Math.min(Math.max(base.y, -3), 3);
    const vel = () => base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
    const wounds = (body.headOff ? 1 : 0) | (body.cut[0] === 2 ? 2 : 0) | (body.cut[1] === 2 ? 4 : 0);
    let torso;
    if (body.halved) {
      // cut in two: the top half keeps the head and arms; the bottom half and what was inside go their own way
      torso = loose('gib_chest', this._pieceAt('gib_chest', pose, rig), rig.rootQuat.clone(), vel().add(new THREE.Vector3(0, 1.2, 0)), wounds | CUT, rag);
      const side = ctx.dir ? new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x) : new THREE.Vector3(1, 0, 0);
      loose('gib_belly', this._pieceAt('gib_belly', pose, rig), rig.rootQuat.clone(), base.clone().multiplyScalar(0.4).addScaledVector(side, 0.6), CUT);
      loose('gib_guts', this._pieceAt('gib_guts', pose, rig), rig.rootQuat.clone(), base.clone().multiplyScalar(0.6).addScaledVector(side, -0.8).add(new THREE.Vector3(0, 0.8, 0)), 0);
    } else torso = loose('gib_torso', this._torsoAt(pose, rig), rig.rootQuat.clone(), vel(), wounds, rag);
    if (!torso) return;
    if (!body.headOff) {
      const head = loose('gib_head', this._headAt(pose), pose.head.quat.clone().multiply(Y_FLIP), vel(), 0, rag);
      props.joint(torso, head, new THREE.Vector3(0, -0.13, -0.05).multiplyScalar(s).applyQuaternion(rig.rootQuat).add(pose.head.pos), 1.1);
    }
    for (let a = 0; a < 2; a++) {
      if (body.cut[a] === 2) continue;
      const A = arm(a);
      const upper = loose('gib_upper', A.upper, along(A.d1), vel(), (body.cut[a] === 1 ? 2 : 0) | A.side, rag);
      props.joint(torso, upper, A.S);
      if (body.cut[a] === 0) props.joint(upper, loose('gib_fore', A.fore, along(A.d2), vel(), A.side, rag), A.E);
    }
  }

  _fx(msg) {
    this.net.broadcast({ t: 'bfx', ...msg });
    this.onBodyFx(msg);
  }

  // who has hold of one of this body's arms, as a world position (for bots to pull away from)
  _pullerOf(id) {
    const b = this.bodies.get(id);
    if (!b) return null;
    for (let a = 0; a < 2; a++) {
      if (!b.held[a]) continue;
      const [who, h] = b.held[a].split(':');
      const pose = this.poses.get(who);
      if (pose) return pose.hands[Number(h)].pos;
    }
    return null;
  }

  // Host, every frame: held arms (and whether they rip), bleeding, dying, coming back.
  _stepBodies(dt) {
    const reach = RIG.upper + RIG.fore + RIG.palmOffset;
    for (const [id, pose] of this.poses) {
      const body = this.body(id), rig = this.rigs.get(id);
      for (let a = 0; a < 2; a++) {
        const key = body.held[a];
        if (!key) continue;
        const [who, hs] = key.split(':'), h = Number(hs);
        const ap = this.poses.get(who), ab = this.bodies.get(who);
        body.holdT[a] += dt;
        if (!ap || !ab || !rig || ab.dead || ab.cut[h] !== 0 || body.holdT[a] > BODY.holdTime) { body.held[a] = null; continue; }
        // pulled further than the arm can reach: it tears off
        if (ap.hands[h].pos.distanceTo(rig.shoulder[a]) > reach * pose.scale * BODY.ripStretch) this._rip(id, a, who, h);
      }
      this._bodyEvents(id, body.update(dt));
    }
  }

  // An explosion hurts everybody near it, and can take arms off.
  _blastBodies(at) {
    if (this.settings.mode !== 'sandbox') return;
    for (const [id, pose] of this.poses) {
      const body = this.body(id);
      if (body.dead || (!this.isBot(id) && !this.settings.pvp)) continue;
      const d = pose.head.pos.distanceTo(at) / Math.max(pose.scale, 0.5);
      if (d > 6) continue;
      const dir = pose.head.pos.clone().sub(at).setY(0.3).normalize(), ctx = { by: 0, dir, push: 3 * (1 - d / 6) };
      if (d < 3.5 && Math.random() < (d < 1.6 ? 1 : 0.5)) this._bodyEvents(id, body.sever(Math.random() < 0.5 ? 0 : 1, Math.random() < 0.5 ? 1 : 2), ctx);
      this._bodyEvents(id, body.hit('torso', d < 1.6 ? 400 : 60 * (1 - d / 6), { pierce: true }), { ...ctx, blast: d < 3 });
    }
  }

  /** Tell everyone the ground just shook here (big players only). strength 0..1 */
  thump(pos, strength) { this.request({ t: 'thump', p: pos.toArray().map(r3), s: r3(strength) }); }

  /** Where another player's head is right now, or null. */
  headOf(id) {
    const p = this.players.get(id);
    return p && p.cur ? this._headTmp.set(p.cur[0], p.cur[1], p.cur[2]) : null;
  }

  /** Blob-shadow casters for the other players. */
  playerCasters(out) {
    for (const p of this.players.values()) {
      if (!p.cur || this.bodies.get(p.id)?.dead) continue;
      const sc = p.cur[21] || 1;
      out.push({ x: p.cur[0], y: p.cur[1] - 0.8 * sc, z: p.cur[2], r: 0.36 * sc });
    }
    return out;
  }

  /** Climbable props as boxes for the local movement code (not the ones I'm holding). */
  propColliders() { return this.props.colliders(`${this.myId}:`); }

  // ---- per frame
  /**
   * @param local { head: {pos, quat}, hands: [{pos, quat}], scale } my pose in world space
   */
  update(dt, local) {
    this._local = local;
    const props = this.props, poses = this.poses;
    // what a dead hand or a missing arm was holding has been dropped
    const mine = this.body();
    for (let i = 0; i < 2; i++) if (this.held[i] != null && (mine.dead || mine.cut[i] !== 0)) this.held[i] = null;
    const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

    // 1. bots think and move (host); to everything below they are ordinary players
    this._navT -= dt;
    if (this.isAuthority && this.bots.size) {
      const arena = this.settings.mode === 'arena', T = this.tournament.state, nav = this._getNav();
      const heads = [...this.bots.values()].map(b => b.loco.head);
      for (const [id, bot] of this.bots) {
        const body = this.body(id);
        // what it has: a shield goes on the left arm and stays up; anything else it swings
        const inHand = [this.weaponIn(id, 0), this.weaponIn(id, 1)];
        const sh = inHand[0] && inHand[0].type.weapon.shield ? inHand[0] : null;
        const held = inHand[1] || (sh ? null : inHand[0]);
        bot.weaponHand = held ? Number(held.held.key.split(':')[1]) : -1;
        bot.shieldHand = sh ? 0 : -1;
        // what it knows about the world this frame
        const ctx = { nav, crowd: heads.filter(h => h !== bot.loco.head) };
        let foeId = null;
        if (bot.brain === 'zombie') Object.assign(ctx, this._zctx);
        else if (arena) {
          foeId = T.phase === 'fight' && (T.a === id || T.b === id) ? (T.a === id ? T.b : T.a) : null;
          const foe = foeId ? poses.get(foeId) : null;
          bot.brain = foe ? 'fight' : 'still';
          if (foe) {
            // the way to its opponent, looked up again a couple of times a second
            bot._fieldT = (bot._fieldT || 0) - dt;
            if (!bot._field || bot._fieldT <= 0) { bot._field = nav.field([foe.head.pos], bot._field); bot._fieldT = 0.4; }
            ctx.foe = { pos: foe.head.pos, threat: this._threat(foeId, bot.loco.head), blood: this.body(foeId).blood };
            ctx.field = bot._field; ctx.reach = this._reach(held);
          }
        } else {
          bot.brain = 'dummy';
          let bd = Infinity;
          for (const [pid, pose] of poses) { if (this.isBot(pid) || this.body(pid).dead) continue; const d = pose.head.pos.distanceTo(bot.loco.head); if (d < bd) { bd = d; ctx.near = pose.head.pos; } }
        }
        bot.step(dt, body, this._pullerOf(id), ctx);
        const target = bot.brain === 'zombie' ? bot.target : foeId;
        // while it swings, see whether the blow runs into what its target is holding
        if (bot.swing > 0 && !bot.caught && target && this.rigs.has(id)) {
          const w = held && held.type.weapon, hp = bot.pose.hands[bot.weaponHand >= 0 ? bot.weaponHand : 1].pos;
          const tip = w ? held.mesh.position.clone().add(new THREE.Vector3(0, w.hits[w.hits.length - 1][1], 0).applyQuaternion(held.mesh.quaternion)) : hp.clone();
          bot.caught = this._caught(target, hp, tip, w ? w.r : RIG.handR) || (bot.lastTip ? this._caught(target, bot.lastTip, tip, w ? w.r : RIG.handR) : null);
          bot.lastTip = tip;
        }
        if (bot.strike && target) { if (bot.bomb) this._zExplode(id); else this._botStrike(id, held, target); }
        if (bot.swing <= 0) { bot.caught = null; bot.lastTip = null; }
        for (const e of bot.events) this._botEvent(id, bot, e);
        const p = this.players.get(id);
        if (p) p.state = packState(bot.pose);
      }
    }

    // 2. where everyone is: me, and every other player gliding toward their latest pose
    poses.clear();
    poses.set(this.myId, local);
    const a = 1 - Math.exp(-20 * dt);
    for (const p of this.players.values()) {
      if (!p.state) continue;
      if (!p.cur) p.cur = p.state.slice();
      for (let k = 0; k < STATE_LEN; k++) p.cur[k] += (p.state[k] - p.cur[k]) * a;
      const c = p.cur;
      if (!p.pose) p.pose = { head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })), scale: 1 };
      p.pose.head.pos.set(c[0], c[1], c[2]); p.pose.head.quat.set(c[3], c[4], c[5], c[6]).normalize();
      for (let i = 0; i < 2; i++) { const o = 7 + i * 7; p.pose.hands[i].pos.set(c[o], c[o + 1], c[o + 2]); p.pose.hands[i].quat.set(c[o + 3], c[o + 4], c[o + 5], c[o + 6]).normalize(); }
      p.pose.scale = c[21] || 1;
      poses.set(p.id, p.pose);
    }

    if (this.isAuthority && this.bots.size) {
      // how fast everyone's hands are going (a fighting bot gets its guard up when its opponent swings)
      for (const [id, pose] of poses) {
        let rec = this._swing.get(id);
        if (!rec) this._swing.set(id, rec = { p: [new THREE.Vector3(), new THREE.Vector3()], v: 0 });
        let v = 0;
        pose.hands.forEach((h, i) => { tmpP.copy(h.pos).sub(pose.head.pos); v = Math.max(v, rec.p[i].distanceTo(tmpP) / Math.max(dt, 1e-3)); rec.p[i].copy(tmpP); });
        rec.v += (Math.min(v, 12) - rec.v) * 0.5;
      }
    }

    if (this.isAuthority) {
      // 3. everyone's hands and bodies knock light props around (not the dead, and not missing hands)
      for (const [id, pose] of poses) {
        const body = this.body(id);
        if (body.dead || this.isZombie(id)) continue;        // (a crowd of the dead would be a crowd of things for the physics to keep track of, to no purpose)
        pose.hands.forEach((h, i) => { if (body.cut[i] === 0) props.setHand(`${id}:${i}`, h.pos, 0.08 * pose.scale, dt); });
        tmpP.copy(pose.head.pos); tmpP.y -= 0.45 * pose.scale;
        props.setHand(`${id}:body`, tmpP, 0.28 * pose.scale, dt);
      }
      props.pruneHands();
      // held props follow their hands
      for (const p of props.props.values()) {
        if (!p.held) continue;
        const [who, i] = p.held.key.split(':');
        const hand = poses.get(who)?.hands[Number(i)];
        const holder = this.body(who);
        if (!hand || holder.dead || holder.cut[Number(i)] !== 0) { props.release(p.id); continue; }   // the dead and the armless drop things
        props.heldPose(p, hand.pos, hand.quat, tmpP, tmpQ);
        props.moveHeld(p, tmpP, tmpQ, dt);
      }
      props.step(dt);
      for (const e of props.events) {
        if (e.type !== 'boom') continue;
        const at = new THREE.Vector3().fromArray(e.pos);
        if (this.net.role === 'host') this.net.broadcast({ t: 'boom', pos: e.pos });
        this.onBoom(at);
        this._hostCarve([r3(e.pos[0]), r3(e.pos[1]), r3(e.pos[2]), BLAST_DENT]);   // explosions leave craters
        this._blastBodies(at);
      }
      props.events.length = 0;

      // hide and seek rounds (bots never play)
      if (this.settings.mode === 'hideseek') {
        const ids = [], rp = {};
        for (const [id, pose] of poses) {
          if (this.isBot(id)) continue;
          ids.push(id);
          // catching uses the newest position a player sent, not the smoothed one that is drawn, so nobody slips through
          const st = this.players.get(id)?.state;
          rp[id] = st ? { head: { x: st[0], y: st[1], z: st[2] }, hands: [{ x: st[7], y: st[8], z: st[9] }, { x: st[14], y: st[15], z: st[16] }], scale: st[21] || 1 }
            : { head: pose.head.pos, hands: pose.hands.map(h => h.pos), scale: pose.scale };
        }
        for (const e of this.rounds.update(dt, ids, rp)) if (e.type === 'start') this._hostResetMap();   // every round starts on a repaired map
      }
      this._setRound(this.rounds.public());
      // the arena tournament: everyone here is in it, bots too
      if (this.settings.mode === 'arena') {
        if (this.playerCount + this.bots.size < 2) this._addBot();          // nobody has to wait alone
        const ids = [], info = {};
        for (const [id, pose] of poses) {
          const b = this.body(id);
          ids.push(id);
          info[id] = { dead: b.dead, blood: b.blood, inside: Math.hypot(pose.head.pos.x, pose.head.pos.z) < COLOSSEUM.radius + 0.6 };
        }
        for (const e of this.tournament.update(dt, ids, info)) this._arenaEvent(e);
      }
      this._setArena(this.tournament.public());
      if (this.settings.mode === 'zombies') this._stepZombies(dt);
      this._setZombies(this.horde.public());
      this.arrows.update(dt, this.world, (from, to, a) => this._arrowHit(from, to, a));
      this._stepBodies(dt);
      // the dead that have been put down are cleared away once their bodies have dropped
      if (this._zDead.length) { for (const id of this._zDead) this._dropPlayer(id); this._zDead.length = 0; this._broadcastRoster(); }
    } else {
      this.arrows.update(dt, this.world);
      props.interpolate(dt);
      // draw what I'm holding at my own hand, without waiting for the host
      for (let i = 0; i < 2; i++) {
        const p = this.held[i] != null && props.props.get(this.held[i]);
        if (!p) continue;
        if (!p.localHold) {
          const inv = local.hands[i].quat.clone().invert();
          p.localHold = p.type.weapon ? weaponHold(p.type.weapon)
            : { offset: p.mesh.position.clone().sub(local.hands[i].pos).applyQuaternion(inv), rot: inv.multiply(p.mesh.quaternion) };
        }
        p.mesh.position.copy(p.localHold.offset).applyQuaternion(local.hands[i].quat).add(local.hands[i].pos);
        p.mesh.quaternion.copy(local.hands[i].quat).multiply(p.localHold.rot);
      }
      for (const p of props.props.values()) if (p.localHold && !this.held.includes(p.id)) p.localHold = null;
    }

    // 4. everyone's joints. An arm that someone has hold of follows the hand holding it.
    for (const [id, pose] of poses) {
      const body = this.body(id);
      let hands = pose.hands;
      if (body.held[0] || body.held[1]) {
        hands = pose.hands.map((own, i) => {
          if (!body.held[i]) return own;
          const [who, h] = body.held[i].split(':');
          const by = poses.get(who)?.hands[Number(h)];
          return by ? { pos: by.pos, quat: own.quat } : own;
        });
      }
      this.hands.set(id, hands);
      let rig = this.rigs.get(id);
      if (!rig) this.rigs.set(id, rig = makeRig());
      solveRig(pose.head.pos, pose.head.quat, hands, pose.scale, rig);
    }
    for (const id of [...this.rigs.keys()]) if (!poses.has(id)) { this.rigs.delete(id); this.hands.delete(id); }

    // 5. draw the other players and bots
    const inRound = this.settings.mode === 'hideseek' && this.round.phase !== 'waiting';
    for (const p of this.players.values()) {
      if (!p.pose || !p.avatar) continue;
      const view = this.body(p.id).view;
      p.avatar.setBody(view);
      p.avatar.root.visible = !view.dead;
      if (view.dead) continue;
      p.avatar.update(p.pose.head.pos, p.pose.head.quat, this.hands.get(p.id), p.pose.scale);
      // a name tag over a hider would give them away; caught players fade to ghosts
      const role = inRound ? this.role(p.id) : 'free';
      if (p.avatar.label) p.avatar.label.visible = role !== 'hider';
      p.avatar.setGhost(role === 'ghost');
    }

    // 6. wounds bleed: a steady drip, and from a stump a spurt with every heartbeat
    this._beat = (this._beat || 0) + dt;
    const pulse = this._beat > 0.8;
    if (pulse) this._beat = 0;
    for (const [id, rig] of this.rigs) {
      const view = this.body(id).view;
      if (view.dead || !view.bleeding) { this._drip.delete(id); continue; }
      const out = a => this._dir.copy(stumpOf(rig, a, view.cut[a])).sub(rig.torsoTop).setY(0.15 * rig.scale).normalize();     // out from the body, and up a little
      if (pulse) {
        if (view.bleeding & 1 && view.cut[0]) this.onBleed(stumpOf(rig, 0, view.cut[0]), out(0), true, rig.scale);
        if (view.bleeding & 2 && view.cut[1]) this.onBleed(stumpOf(rig, 1, view.cut[1]), out(1), true, rig.scale);
      }
      const t = (this._drip.get(id) || 0) - dt;
      if (t > 0) { this._drip.set(id, t); continue; }
      this._drip.set(id, (view.bleeding & 3) === 3 ? 0.05 : 0.11);
      if (view.bleeding & 1 && view.cut[0]) this.onBleed(stumpOf(rig, 0, view.cut[0]), null, false, rig.scale);
      if (view.bleeding & 2 && view.cut[1]) this.onBleed(stumpOf(rig, 1, view.cut[1]), null, false, rig.scale);
      if (view.bleeding & 4) this.onBleed(this._dir.copy(rig.torsoTop).lerp(rig.torsoBottom, Math.random() * 0.7), null, false, rig.scale);
    }

    // 7. network send
    this._sendT -= dt;
    if (this._sendT <= 0 && this.net.online) {
      this._sendT = SEND_EVERY;
      const mine = packState(local);
      if (this.net.role === 'host') {
        const players = [['h', ...mine]];
        for (const p of this.players.values()) if (p.state) players.push([p.id, ...p.state]);
        const bodies = [];
        for (const id of poses.keys()) bodies.push([id, ...this.body(id).pack()]);
        this.net.broadcast({ t: 'snap', players, ...props.snapshot(), settings: this.settings, round: this.round, arena: this.arena, zombies: this.settings.mode === 'zombies' ? this.zombies : null, bodies });
      } else {
        this.net.send({ t: 'state', s: mine });
      }
    }
  }
}

function packState(local) {
  const out = [...local.head.pos.toArray(), ...local.head.quat.toArray()];
  for (const h of local.hands) out.push(...h.pos.toArray(), ...h.quat.toArray());
  out.push(local.scale || 1);
  return out.map(r3);
}
