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
const LOW_GRAVITY = -3.6, NORMAL_GRAVITY = -9.8;

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
    this.settings = { lowGravity: false };
    this.players = new Map();   // id -> { name, color, state: Float32 array, avatar, cur }
    this.template = null;
    avatarTemplate.then(t => { this.template = t; for (const p of this.players.values()) this._ensureAvatar(p); });
    this.props = new PropWorld(scene, this.levelColliders, true);
    this.held = [null, null];   // prop id held by my left / right hand
    this.selected = 0;          // index into PROP_TYPES
    this.onChange = () => {};   // roster / room / settings changed
    this.onButton = () => {};   // (buttonId, on) for panel lights
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
    this._applySettings({ lowGravity: false });
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
      } else if (msg.t === 'state' && Array.isArray(msg.s) && msg.s.length === 21) {
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
        this.props.applySnapshot(msg.props);
        // drop holds the host didn't confirm
        for (let i = 0; i < 2; i++) {
          const id = this.held[i];
          if (id == null) continue;
          const pr = this.props.props.get(id);
          if (!pr || (pr.heldKey && pr.heldKey !== `${this.myId}:${i}`)) this.held[i] = null;
        }
        if (msg.settings && msg.settings.lowGravity !== this.settings.lowGravity) this._applySettings(msg.settings);
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
    if (now - (this._buttonT[id] || 0) < 600) return;
    this._buttonT[id] = now;
    if (id === 'lowgrav') this._applySettings({ ...this.settings, lowGravity: !this.settings.lowGravity });
    else if (id === 'clear') this.props.clear();
    else if (id === 'rain') {
      const kinds = PROP_TYPES.filter(t => !t.fixed);
      for (let i = 0; i < 16; i++) {
        const t = kinds[Math.floor(Math.random() * kinds.length)];
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 6;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0));
        this.props.spawn(t.id, new THREE.Vector3(Math.cos(a) * r, 8 + Math.random() * 6, -2 + Math.sin(a) * r), q, { owner: 'rain' });
      }
    }
    this.onButton(id, id === 'lowgrav' ? this.settings.lowGravity : true);
  }

  _applySettings(s) {
    this.settings = { ...s };
    const g = s.lowGravity ? LOW_GRAVITY : NORMAL_GRAVITY;
    this.loco.cfg.gravity = g;
    this.props.setGravity(g);
    this.onButton('lowgrav', s.lowGravity);
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
  spawnSelected(handPos, handQuat) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(handQuat);
    const t = this.selectedType;
    const reach = t.shape === 'sphere' ? t.r : Math.max(...(t.size || [t.r * 2, t.h, t.r * 2])) / 2;
    const pos = handPos.clone().addScaledVector(fwd, 0.25 + reach);
    if (!t.fixed) pos.y += 0.1;
    // fixed props spawn level; others keep the hand's twist
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.request({ t: 'spawn', type: t.id, pos: pos.toArray(), quat: quat.toArray() });
  }

  deleteNear(handPos) {
    const p = this.props.nearest(handPos, 0.3);
    if (p) this.request({ t: 'del', id: p.id });
    return !!p;
  }

  undo() { this.request({ t: 'undo' }); }

  grab(i, handPos) {
    if (this.held[i] != null) return false;
    const p = this.props.nearest(handPos, 0.18, pr => !pr.held && !pr.heldKey);
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
      const bodies = [[this.myId, local.head.pos, local.hands]];
      for (const p of this.players.values()) {
        if (!p.state) continue;
        const s = p.state;
        bodies.push([p.id, new THREE.Vector3(s[0], s[1], s[2]), [0, 1].map(i => this._handPose(p.id, i))]);
      }
      for (const [id, head, hands] of bodies) {
        hands.forEach((h, i) => { if (h) props.setHand(`${id}:${i}`, h.pos, 0.08, dt); });
        props.setHand(`${id}:body`, tmpP.copy(head).y -= 0.45, 0.28, dt);
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
      for (let k = 0; k < 21; k++) p.cur[k] += (p.state[k] - p.cur[k]) * a;
      const c = p.cur;
      const head = { pos: new THREE.Vector3(c[0], c[1], c[2]), quat: new THREE.Quaternion(c[3], c[4], c[5], c[6]).normalize() };
      const hands = [0, 1].map(i => { const o = 7 + i * 7; return { pos: new THREE.Vector3(c[o], c[o + 1], c[o + 2]), quat: new THREE.Quaternion(c[o + 3], c[o + 4], c[o + 5], c[o + 6]).normalize() }; });
      p.avatar.root.visible = true;
      p.avatar.update(head.pos, head.quat, hands);
    }

    // network send
    this._sendT -= dt;
    if (this._sendT <= 0 && this.net.online) {
      this._sendT = SEND_EVERY;
      const mine = packState(local);
      if (this.net.role === 'host') {
        const players = [['h', ...mine]];
        for (const p of this.players.values()) if (p.state) players.push([p.id, ...p.state]);
        this.net.broadcast({ t: 'snap', players, props: props.snapshot(), settings: this.settings });
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
  return out.map(r);
}
