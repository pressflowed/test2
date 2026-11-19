// Ties the sandbox together for solo and multiplayer play: props, other players,
// grabbing, the control panel buttons and shared settings.
//
// The host (or a solo player) owns the truth: it runs the prop physics, applies
// everyone's requests (spawn, grab, delete, buttons) and sends snapshots 20 times a
// second. Joined players send their own head and hand poses and draw what the host
// says.
import * as THREE from 'three';
import { PropWorld, PROP_TYPES, TYPE } from './props.js';
import { Avatar } from './avatar.js';

const SEND_EVERY = 0.05;     // 20 Hz
const STATE_LEN = 22;        // head pos+quat (7), two hands pos+quat (14), size (1)
export const GRAVITY = { normal: -9.8, low: -3.2, high: -19 };
export const GRAVITY_LABEL = { normal: 'Normal', low: 'Low', high: 'Heavy' };
const GRAVITY_ORDER = ['normal', 'low', 'high'];
const SKY_ORDER = ['day', 'sunset', 'night'];

export class Session {
  /**
   * @param opts.scene, opts.world (level World), opts.net (Net), opts.loco (local Locomotion)
   * @param opts.me  { name, color }
   * @param opts.avatarTemplate  Promise of the skeleton model
   */
  constructor({ scene, world, net, loco, me, avatarTemplate }) {
    this.scene = scene;
    this.world = world;
    this.levelColliders = world.colliders.slice();
    this.net = net;
    this.loco = loco;
    this.me = me;
    this.settings = { gravity: 'normal', sky: 'day' };
    this.players = new Map();   // id -> { name, color, state: Float32 array, avatar, cur }
    this.template = null;
    avatarTemplate.then(t => { this.template = t; for (const p of this.players.values()) this._ensureAvatar(p); });
    this.props = new PropWorld(scene, this.levelColliders, true);
    this.held = [null, null];   // prop id held by my left / right hand
    this.selected = 0;          // index into PROP_TYPES
    this.onChange = () => {};   // roster / room / settings changed
    this.onButton = () => {};   // (buttonId, on) for panel lights
    this.onBoom = () => {};     // (THREE.Vector3) an explosion went off
    this.onSettings = () => {}; // (settings) gravity or sky changed
    this._sendT = 0;
    this._buttonT = {};

    net.onMessage = (from, msg) => this._onMessage(from, msg);
    net.onJoin = id => { this.players.set(id, { id, name: 'Player', color: 0xdcd1a8, state: null }); this._broadcastRoster(); };
    net.onLeave = id => {
      if (id === 'h' && this.net.role !== 'host') { this._resetWorld(true); this.onChange(); return; }
      this._dropPlayer(id);
      for (const p of this.props.props.values()) if (p.held && p.held.key.startsWith(id + ':')) this.props.release(p.id);
      this._broadcastRoster();
    };
  }

  get myId() { return this.net.myId; }
  get isAuthority() { return this.net.role !== 'client'; }
  get selectedType() { return PROP_TYPES[this.selected]; }
  get playerCount() { return this.players.size + 1; }

  // ---- rooms
  async host() {
    const code = await this.net.host();
    this._resetWorld(true);
    this.onChange();
    return code;
  }

  async join(code) {
    this._resetWorld(false);
    try {
      await this.net.join(code);
    } catch (e) {
      this._resetWorld(true);
      throw e;
    }
    this.net.send({ t: 'hello', name: this.me.name, color: this.me.color });
    this.onChange();
  }

  leave() { this.net.leave(); this._resetWorld(true); this.onChange(); }

  setMe(name, color) {
    this.me.name = name; this.me.color = color;
    if (this.net.role === 'client') this.net.send({ t: 'hello', name, color });
    if (this.net.role === 'host') this._broadcastRoster();
  }

  _resetWorld(simulate) {
    for (const id of [...this.players.keys()]) this._dropPlayer(id);
    this.props.clear();
    for (const h of this.props.hands.values()) this.props.world.removeBody(h);
    this.props = new PropWorld(this.scene, this.levelColliders, simulate);
    this.held = [null, null];
    this._applySettings({ gravity: 'normal', sky: 'day' });
  }

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
    if (this.net.role !== 'host') { this.onChange(); return; }
    const list = [{ id: 'h', name: this.me.name, color: this.me.color }];
    for (const p of this.players.values()) list.push({ id: p.id, name: p.name, color: p.color });
    this.net.broadcast({ t: 'roster', list });
    this.onChange();
  }

  _applyRoster(list) {
    const ids = new Set();
    for (const r of list) {
      if (r.id === this.myId) continue;
      ids.add(r.id);
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
      } else if (msg.t === 'state' && Array.isArray(msg.s) && msg.s.length === STATE_LEN) {
        p.state = msg.s;
      } else {
        this._handleRequest(from, msg);
      }
    } else if (this.net.role === 'client') {
      if (msg.t === 'roster') this._applyRoster(msg.list);
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
        if (msg.settings && (msg.settings.gravity !== this.settings.gravity || msg.settings.sky !== this.settings.sky)) this._applySettings(msg.settings);
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
    }
  }

  _pressButton(id) {
    const now = performance.now();
    if (now - (this._buttonT[id] || 0) < 500) return;
    this._buttonT[id] = now;
    const cycle = (order, cur) => order[(order.indexOf(cur) + 1) % order.length];
    if (id === 'lowgrav') this._applySettings({ ...this.settings, gravity: this.settings.gravity === 'low' ? 'normal' : 'low' });
    else if (id === 'gravity') this._applySettings({ ...this.settings, gravity: cycle(GRAVITY_ORDER, this.settings.gravity) });
    else if (id === 'sky') this._applySettings({ ...this.settings, sky: cycle(SKY_ORDER, this.settings.sky) });
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
    this.settings = { gravity: GRAVITY[s.gravity] ? s.gravity : 'normal', sky: SKY_ORDER.includes(s.sky) ? s.sky : 'day' };
    const g = GRAVITY[this.settings.gravity];
    this.loco.cfg.gravity = g;
    this.props.setGravity(g);
    this.onButton('lowgrav', this.settings.gravity === 'low');
    this.onSettings(this.settings);
    this.onChange();
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
    const r = v => Math.round(v * 1000) / 1000;
    this.request({ t: 'throw', type: typeId, pos: pos.toArray().map(r), vel: vel.toArray().map(r) });
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
   * @param local { head: {pos, quat}, hands: [{pos, quat}] } my pose in world space
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
      }
      props.events.length = 0;
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
    for (const p of this.players.values()) {
      if (!p.state || !p.avatar) continue;
      if (!p.cur) p.cur = p.state.slice();
      for (let k = 0; k < STATE_LEN; k++) p.cur[k] += (p.state[k] - p.cur[k]) * a;
      const c = p.cur;
      const head = { pos: new THREE.Vector3(c[0], c[1], c[2]), quat: new THREE.Quaternion(c[3], c[4], c[5], c[6]).normalize() };
      const hands = [0, 1].map(i => { const o = 7 + i * 7; return { pos: new THREE.Vector3(c[o], c[o + 1], c[o + 2]), quat: new THREE.Quaternion(c[o + 3], c[o + 4], c[o + 5], c[o + 6]).normalize() }; });
      p.avatar.root.visible = true;
      p.avatar.update(head.pos, head.quat, hands, c[21] || 1);
    }

    // network send
    this._sendT -= dt;
    if (this._sendT <= 0 && this.net.online) {
      this._sendT = SEND_EVERY;
      const mine = packState(local);
      if (this.net.role === 'host') {
        const players = [['h', ...mine]];
        for (const p of this.players.values()) if (p.state) players.push([p.id, ...p.state]);
        this.net.broadcast({ t: 'snap', players, ...props.snapshot(), settings: this.settings });
      } else {
        this.net.send({ t: 'state', s: mine });
      }
    }
  }
}

function packState(local) {
  const r = v => Math.round(v * 1000) / 1000;
  const out = [...local.head.pos.toArray(), ...local.head.quat.toArray()];
  for (const h of local.hands) out.push(...h.pos.toArray(), ...h.quat.toArray());
  out.push(local.scale || 1);
  return out.map(r);
}
