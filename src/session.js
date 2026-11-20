// Ties the game together for solo and multiplayer play: the map, breaking it, props,
// other players, hide and seek rounds, and shared settings.
//
// The host (or a solo player) owns the truth: it runs the prop physics and the round
// rules, applies everyone's requests and sends snapshots 20 times a second. Joined
// players send their own head and hand poses and draw what the host says.
//
// Broken blocks are the one thing each player works out for themselves: a punch is
// just "a ball of this size at this spot", and the voxel world gives the same result
// for the same punches on every machine, in any order.
import * as THREE from 'three';
import { PropWorld, SPAWNABLE, TYPE, MAX_GIBS } from './props.js';
import { Avatar } from './avatar.js';
import { MAPS } from './maps.js';
import { Rounds } from './rounds.js';
import { Body, BODY } from './body.js';
import { RIG, solveRig, makeRig, grabArm, stumpOf } from './bodyrig.js';
import { Bot, MAX_BOTS } from './bots.js';

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
    this.onBleed = () => {};    // (THREE.Vector3) a wound dripped here
    this.bodies = new Map();    // id -> Body, for me, every other player and every bot
    this.poses = new Map();     // id -> { head, hands, scale } this frame
    this.rigs = new Map();      // id -> joints (see bodyrig.js)
    this.hands = new Map();     // id -> hands as drawn (a held arm follows whoever holds it)
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
  nameOf(id) { return id === this.myId ? this.me.name : (this.players.get(id)?.name || 'Someone'); }

  /** What I am right now: 'free' (no round), 'giant', 'hider', or 'ghost' (caught). */
  role(id = this.myId) {
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
    this.loadMap(this.settings.mode);
    this._applySettings({ ...this.settings, gravity: 'normal', sky: 'day' });
    this._setRound(this.rounds.public());
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
    // a new map is a fresh start: everyone whole again; bots only live in the sandbox
    for (const b of this.bodies.values()) b.reset();
    if (mode !== 'sandbox') this._clearBots();
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
  /** End this hide and seek round and start another. */
  skipRound() { this.request({ t: 'round', cmd: 'skip' }); }

  _hostSetMode(mode) {
    if (!MAPS[mode] || mode === this.mode) return;
    this.rounds.stop();
    this.loadMap(mode);
    this._applySettings({ ...this.settings, gravity: 'normal' });
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
  _addBot(near) {
    if (this.bots.size >= MAX_BOTS || this.settings.mode !== 'sandbox') return;
    const id = 'b' + (++this._botN);
    const pos = near ? near.clone() : new THREE.Vector3(0, 0, 3);
    pos.y = Math.max(pos.y - 0.6, 0) + 0.3;
    const bot = new Bot(id, this._botN, this.world, pos);
    this.bots.set(id, bot);
    const p = { id, name: bot.name, color: bot.color, state: packState(bot.pose), bot: true };
    this.players.set(id, p);
    this._ensureAvatar(p);
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
      list.push({ id: p.id, name: p.name, color: p.color, peer, bot: p.bot ? 1 : 0 });
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
      p.name = r.name; p.color = r.color; p.bot = !!r.bot;
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
    // hide and seek is played with bare hands: no spawning, deleting or undoing
    if (this.settings.mode === 'hideseek' && ['spawn', 'throw', 'del', 'undo'].includes(msg.t)) return;
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
        const hand = this._handPose(from, msg.hand);
        if (hand) props.grab(msg.id, { key: `${from}:${msg.hand}`, pos: hand.pos, quat: hand.quat });
        break;
      }
      case 'release': {
        const p = props.props.get(msg.id);
        if (p && p.held && p.held.key === `${from}:${msg.hand}`) props.release(msg.id, msg.vel ? new THREE.Vector3().fromArray(msg.vel) : null);
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
          this._addBot(pose ? pose.head.pos.clone().add(new THREE.Vector3(0, 0, -2.5).applyQuaternion(pose.head.quat).setY(0)) : null);
        } else if (msg.cmd === 'clear') this._clearBots();
        break;
      case 'mode': this._hostSetMode(msg.mode); break;
      case 'resetmap': if (this.settings.mode === 'sandbox') this._hostResetMap(); break;
      case 'round': if (msg.cmd === 'skip') this.rounds.skip(); break;
    }
  }

  _pressButton(id) {
    const now = performance.now();
    if (now - (this._buttonT[id] || 0) < 500) return;
    if (this.settings.mode === 'hideseek' && id !== 'sky') return;   // the world is left alone during hide and seek
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
  /** May I hurt this player or bot? Bots always (in the sandbox); people only while fighting is on. */
  canHurt(id) {
    if (this.settings.mode !== 'sandbox' || id === this.myId) return false;
    const b = this.bodies.get(id);
    return !!b && !b.dead && (this.isBot(id) || this.settings.pvp);
  }
  /** My fist landed on someone. power is roughly the damage at equal size. */
  hit(id, part, power, hand) { this.request({ t: 'hit', id, part, power: r3(power), hand }); }
  /** Take hold of someone's arm with one of my hands; pull far enough and it comes off. */
  holdArm(id, arm, hand) { this.request({ t: 'hold', id, arm, hand }); }
  letGoArm(hand) { this.request({ t: 'unhold', hand }); }
  /** Mouse players cannot pull, so they get to take a bot's arm straight off. */
  ripArm(id, arm, hand) { this.request({ t: 'rip', id, arm, hand }); }
  addBot() { this.request({ t: 'bot', cmd: 'add' }); }
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
    if (this.settings.mode !== 'sandbox' || !tb || !tp || !ap || tb.dead || msg.id === from || !BODY_PARTS.includes(msg.part)) return;
    if (!this.body(from).canUse(hand) || (!this.isBot(msg.id) && !this.settings.pvp)) return;
    if (ap.hands[hand].pos.distanceTo(tp.head.pos) > 2.5 * (ap.scale + tp.scale)) return;      // has to be within arm's reach
    const dmg = Math.min(Math.max(Number(msg.power) || 0, 0), 250) / Math.pow(tp.scale, 1.5);  // bigger bodies shrug more off
    const dir = tp.head.pos.clone().sub(ap.head.pos).setY(0).normalize();
    this._bodyEvents(msg.id, tb.hit(msg.part, dmg), { by: from, dir, push: Math.min(dmg / 10, 4.5) });
  }

  _hostHold(from, msg) {
    const hand = msg.hand ? 1 : 0, arm = msg.arm ? 1 : 0;
    const tb = this.bodies.get(msg.id), tp = this.poses.get(msg.id), ap = this.poses.get(from), rig = this.rigs.get(msg.id);
    if (this.settings.mode !== 'sandbox' || !tb || !tp || !ap || !rig || tb.dead || msg.id === from) return;
    if (!this.body(from).canUse(hand) || (!this.isBot(msg.id) && !this.settings.pvp)) return;
    if (tb.cut[arm] >= 2 || tb.held[arm] || ap.scale < 0.5 * tp.scale) return;                 // nothing to hold, or far too small to hold it
    if (grabArm(rig, tb.cut, ap.hands[hand].pos, 0.25 * ap.scale) !== arm) return;
    tb.held[arm] = `${from}:${hand}`; tb.holdT[arm] = 0;
    this._fx({ k: 'grab', id: msg.id, arm, by: from, p: ap.hands[hand].pos.toArray().map(r3) });
  }

  // an arm comes off at the shoulder in someone's hand
  _rip(id, arm, who, hand) {
    this._bodyEvents(id, this.body(id).sever(arm, 2), { by: who, hand, ripped: true });
  }

  // Turn what Body reports into things in the world: blood, loose pieces, messages to everyone.
  _bodyEvents(id, events, ctx = {}) {
    if (!events.length) return;
    const rig = this.rigs.get(id), pose = this.poses.get(id), color = this.colorOf(id);
    if (!rig || !pose) return;
    const arr = v => v.toArray().map(r3);
    // a loose piece of this body: in its skin colour, and its size
    const loose = (type, pos, dir, vel) => {
      const lying = [...this.props.props.values()].filter(p => p.type.gib && !p.held);
      if (lying.length >= MAX_GIBS) this.props.remove(lying[0].id);
      return this.props.spawn(type, pos, new THREE.Quaternion().setFromUnitVectors(DOWN, dir), { owner: 'gib', color, vel, scale: pose.scale });
    };
    const fling = () => new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3);
    for (const e of events) {
      if (e.type === 'hit') {
        const at = e.part === 'head' ? rig.head : e.part === 'torso' ? rig.torsoTop : (e.part.startsWith('fore') ? rig.wrist : rig.elbow)[e.part.endsWith('L') ? 0 : 1];
        this._fx({ k: 'hit', id, part: e.part, dmg: Math.round(e.dmg), p: arr(at), d: ctx.dir ? arr(ctx.dir) : [0, 0, 0], push: r3(ctx.push || 0), by: ctx.by || 0 });
        const bot = this.bots.get(id);
        if (bot && ctx.dir) bot.knock(ctx.dir, ctx.push || 1);
      } else if (e.type === 'sever') {
        const a = e.arm, S = rig.shoulder[a], E = rig.elbow[a], W = rig.wrist[a];
        // which piece came off: the whole arm, just the forearm, or the stump that was left
        const [type, from, to] = e.level === 1 ? ['gib_fore', E, W] : e.was === 1 ? ['gib_upper', S, E] : ['gib_arm', S, W];
        const dir = to.clone().sub(from).normalize();
        // torn off by hand, it stays in that hand (if the hand is empty); otherwise it flies off
        const key = `${ctx.by}:${ctx.hand}`, hp = ctx.ripped ? this.poses.get(ctx.by)?.hands[ctx.hand] : null;
        const keep = !!hp && ![...this.props.props.values()].some(p => p.held && p.held.key === key);
        const gib = loose(type, from.clone().lerp(to, 0.5), dir, keep ? null : fling());
        if (keep && gib && this.props.grab(gib.id, { key, pos: hp.pos, quat: hp.quat })) {
          if (ctx.by === this.myId) this.held[ctx.hand] = gib.id; else this.net.sendTo(ctx.by, { t: 'given', hand: ctx.hand, id: gib.id });
        }
        this._fx({ k: 'sever', id, arm: a, level: e.level, p: arr(e.level === 1 ? E : S), ripped: ctx.ripped ? 1 : 0, by: ctx.by || 0 });
      } else if (e.type === 'die') {
        // the body falls apart into what was left of it
        const body = this.body(id);
        loose('gib_head', rig.head.clone(), DOWN, fling());
        loose('gib_torso', rig.torsoTop.clone().lerp(rig.torsoBottom, 0.5), DOWN, fling().multiplyScalar(0.5));
        for (let a = 0; a < 2; a++) {
          if (body.cut[a] === 0) loose('gib_arm', rig.shoulder[a].clone().lerp(rig.wrist[a], 0.5), rig.wrist[a].clone().sub(rig.shoulder[a]).normalize(), fling());
          else if (body.cut[a] === 1) loose('gib_upper', rig.shoulder[a].clone().lerp(rig.elbow[a], 0.5), rig.elbow[a].clone().sub(rig.shoulder[a]).normalize(), fling());
        }
        this._fx({ k: 'die', id, p: arr(rig.head), by: ctx.by || 0 });
      } else if (e.type === 'respawn') {
        const bot = this.bots.get(id);
        if (bot) bot.respawn();
        this._fx({ k: 'respawn', id });
      }
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
      this._bodyEvents(id, body.hit('torso', d < 1.6 ? 400 : 60 * (1 - d / 6)), ctx);
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
    const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

    // 1. bots think and move (host); to everything below they are ordinary players
    if (this.isAuthority) for (const [id, bot] of this.bots) {
      bot.update(dt, this.body(id), this._pullerOf(id));
      const p = this.players.get(id);
      if (p) p.state = packState(bot.pose);
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

    if (this.isAuthority) {
      // 3. everyone's hands and bodies knock light props around (not the dead, and not missing hands)
      for (const [id, pose] of poses) {
        const body = this.body(id);
        if (body.dead) continue;
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
      this._stepBodies(dt);
    } else {
      props.interpolate(dt);
      // draw what I'm holding at my own hand, without waiting for the host
      for (let i = 0; i < 2; i++) {
        const p = this.held[i] != null && props.props.get(this.held[i]);
        if (!p) continue;
        if (!p.localHold) {
          const inv = local.hands[i].quat.clone().invert();
          p.localHold = { offset: p.mesh.position.clone().sub(local.hands[i].pos).applyQuaternion(inv), rot: inv.multiply(p.mesh.quaternion) };
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

    // 6. wounds drip
    for (const [id, rig] of this.rigs) {
      const view = this.body(id).view;
      if (view.dead || !view.bleeding) { this._drip.delete(id); continue; }
      const t = (this._drip.get(id) || 0) - dt;
      if (t > 0) { this._drip.set(id, t); continue; }
      this._drip.set(id, (view.bleeding & 3) === 3 ? 0.05 : 0.14);
      if (view.bleeding & 1 && view.cut[0]) this.onBleed(stumpOf(rig, 0, view.cut[0]));
      if (view.bleeding & 2 && view.cut[1]) this.onBleed(stumpOf(rig, 1, view.cut[1]));
      if (view.bleeding & 4) this.onBleed(rig.torsoTop);
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
        this.net.broadcast({ t: 'snap', players, ...props.snapshot(), settings: this.settings, round: this.round, bodies });
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
