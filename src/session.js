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
import { PropWorld, PROP_TYPES, TYPE } from './props.js';
import { Avatar } from './avatar.js';
import { MAPS } from './maps.js';
import { Rounds } from './rounds.js';

const SEND_EVERY = 0.05;     // 20 Hz
const STATE_LEN = 22;        // head pos+quat (7), two hands pos+quat (14), size (1)
export const GRAVITY = { normal: -9.8, low: -3.2, high: -19 };
export const GRAVITY_LABEL = { normal: 'Normal', low: 'Low', high: 'Heavy' };
const GRAVITY_ORDER = ['normal', 'low', 'high'];
const SKY_ORDER = ['day', 'sunset', 'night'];
const MAX_PUNCH = 1.5;       // biggest dent a player may ask for, metres
const BLAST_DENT = 1.6;      // crater from TNT
const r3 = v => Math.round(v * 1000) / 1000;

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
    this.settings = { gravity: 'normal', sky: 'day', smash: true, mode: 'sandbox' };
    this.mode = null;           // the map that is loaded
    this.carveLog = [];         // every dent since the map was fresh, for players who join later
    this.rounds = new Rounds();
    this.round = this.rounds.public();
    this.players = new Map();   // id -> { name, color, state: Float32 array, avatar, cur }
    this.template = null;
    avatarTemplate.then(t => { this.template = t; for (const p of this.players.values()) this._ensureAvatar(p); });
    this.props = new PropWorld(scene, world, true);
    this.held = [null, null];   // prop id held by my left / right hand
    this.selected = 0;          // index into PROP_TYPES
    this.onChange = () => {};   // roster / room / settings changed
    this.onButton = () => {};   // (buttonId, on) for panel lights
    this.onBoom = () => {};     // (THREE.Vector3) an explosion went off
    this.onSettings = () => {}; // (settings) gravity, sky or smash changed
    this.onMap = () => {};      // (mode) a different map is about to be built: swap the scenery
    this.onCarve = () => {};    // (THREE.Vector3, radius, result) blocks broke: debris, sound
    this.onRound = () => {};    // (round, previousRound) the hide and seek state changed
    this.onThump = () => {};    // (THREE.Vector3, strength 0..1) something huge shook the ground
    this.peers = new Map();     // other players: id -> PeerJS id, for voice calls
    this._sendT = 0;
    this._buttonT = {};
    this._headTmp = new THREE.Vector3();
    this._building = false;
    this.voxels.onCells = cells => { if (!this._building) this.props.syncCells(cells); };

    net.onMessage = (from, msg) => this._onMessage(from, msg);
    net.onJoin = id => { this.players.set(id, { id, name: 'Player', color: 0xdcd1a8, state: null }); this._broadcastRoster(); };
    net.onLeave = id => {
      if (id === 'h' && this.net.role !== 'host') { this._backToSolo(); return; }
      this._dropPlayer(id);
      for (const p of this.props.props.values()) if (p.held && p.held.key.startsWith(id + ':')) this.props.release(p.id);
      this._broadcastRoster();
    };
  }

  get myId() { return this.net.myId; }
  get isAuthority() { return this.net.role !== 'client'; }
  get selectedType() { return PROP_TYPES[this.selected]; }
  get playerCount() { return this.players.size + 1; }
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
    for (const id of [...this.players.keys()]) this._dropPlayer(id);
    this.onChange();
    return code;
  }

  async join(code) {
    for (const id of [...this.players.keys()]) this._dropPlayer(id);
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
      list.push({ id: p.id, name: p.name, color: p.color, peer });
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
      p.name = r.name; p.color = r.color;
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
        p.color = Number(msg.color) || 0xdcd1a8;
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
        if (s && (s.gravity !== this.settings.gravity || s.sky !== this.settings.sky || s.smash !== this.settings.smash)) this._applySettings(s);
        if (msg.round) this._setRound(msg.round);
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
        if (!TYPE[msg.type] || !Array.isArray(msg.pos)) return;
        const q = Array.isArray(msg.quat) ? new THREE.Quaternion().fromArray(msg.quat) : null;
        props.spawn(msg.type, new THREE.Vector3().fromArray(msg.pos), q, { owner: from });
        break;
      }
      case 'throw': {
        if (!TYPE[msg.type] || !Array.isArray(msg.pos) || !Array.isArray(msg.vel)) return;
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
    else if (id === 'clear') this.props.clear();
    else if (id === 'rain' || id === 'balloons') {
      const kinds = id === 'balloons' ? [TYPE.balloon] : PROP_TYPES.filter(t => !t.fixed && !t.fuse && !t.float && t.mass < 100);
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
  select(typeId) { const i = PROP_TYPES.findIndex(t => t.id === typeId); if (i >= 0) this.selected = i; }

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
      if (!p.cur) continue;
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
    const props = this.props;
    const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

    if (this.isAuthority) {
      // everyone's hands and bodies knock light props around
      const bodies = [[this.myId, local.head.pos, local.hands, local.scale || 1]];
      for (const p of this.players.values()) {
        if (!p.state) continue;
        const s = p.state;
        bodies.push([p.id, new THREE.Vector3(s[0], s[1], s[2]), [0, 1].map(i => this._handPose(p.id, i)), s[21] || 1]);
      }
      for (const [id, head, hands, sc] of bodies) {
        hands.forEach((h, i) => { if (h) props.setHand(`${id}:${i}`, h.pos, 0.08 * sc, dt); });
        tmpP.copy(head); tmpP.y -= 0.45 * sc;
        props.setHand(`${id}:body`, tmpP, 0.28 * sc, dt);
      }
      props.pruneHands();
      // held props follow their hands
      for (const p of props.props.values()) {
        if (!p.held) continue;
        const [who, i] = p.held.key.split(':');
        const hand = this._handPose(who, Number(i));
        if (!hand) { props.release(p.id); continue; }
        props.heldPose(p, hand.pos, hand.quat, tmpP, tmpQ);
        props.moveHeld(p, tmpP, tmpQ, dt);
      }
      props.step(dt);
      for (const e of props.events) {
        if (e.type !== 'boom') continue;
        if (this.net.role === 'host') this.net.broadcast({ t: 'boom', pos: e.pos });
        this.onBoom(new THREE.Vector3().fromArray(e.pos));
        this._hostCarve([r3(e.pos[0]), r3(e.pos[1]), r3(e.pos[2]), BLAST_DENT]);   // explosions leave craters
      }
      props.events.length = 0;

      // hide and seek rounds
      if (this.settings.mode === 'hideseek') {
        const ids = [], poses = {};
        for (const [id, head, hands, sc] of bodies) { ids.push(id); poses[id] = { head, hands: hands.map(h => h.pos), scale: sc }; }
        for (const e of this.rounds.update(dt, ids, poses)) if (e.type === 'start') this._hostResetMap();   // every round starts on a repaired map
      }
      this._setRound(this.rounds.public());
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

    // other players' skeletons glide toward their latest pose
    const a = 1 - Math.exp(-20 * dt);
    const inRound = this.settings.mode === 'hideseek' && this.round.phase !== 'waiting';
    for (const p of this.players.values()) {
      if (!p.state || !p.avatar) continue;
      if (!p.cur) p.cur = p.state.slice();
      for (let k = 0; k < STATE_LEN; k++) p.cur[k] += (p.state[k] - p.cur[k]) * a;
      const c = p.cur;
      const head = { pos: new THREE.Vector3(c[0], c[1], c[2]), quat: new THREE.Quaternion(c[3], c[4], c[5], c[6]).normalize() };
      const hands = [0, 1].map(i => { const o = 7 + i * 7; return { pos: new THREE.Vector3(c[o], c[o + 1], c[o + 2]), quat: new THREE.Quaternion(c[o + 3], c[o + 4], c[o + 5], c[o + 6]).normalize() }; });
      p.avatar.root.visible = true;
      p.avatar.update(head.pos, head.quat, hands, c[21] || 1);
      // a name tag over a hider would give them away; caught players fade to ghosts
      const role = inRound ? this.role(p.id) : 'free';
      if (p.avatar.label) p.avatar.label.visible = role !== 'hider';
      p.avatar.setGhost(role === 'ghost');
    }

    // network send
    this._sendT -= dt;
    if (this._sendT <= 0 && this.net.online) {
      this._sendT = SEND_EVERY;
      const mine = packState(local);
      if (this.net.role === 'host') {
        const players = [['h', ...mine]];
        for (const p of this.players.values()) if (p.state) players.push([p.id, ...p.state]);
        this.net.broadcast({ t: 'snap', players, ...props.snapshot(), settings: this.settings, round: this.round });
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
