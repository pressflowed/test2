// Physics props you can spawn, push, grab, throw and stand on.
//
// The host (or a solo player) runs the physics with cannon-es. Other players only
// draw the props where the host says they are (see applySnapshot).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// size: box [x, y, z]; sphere r; cylinder r, h (cone: rTop small)
// climb: players' hands and bodies collide with it (you can stand on it). Otherwise
//        it is "light": hands knock it around instead.
// fixed: does not fall; stays where you put it (you can still grab and move it)
export const PROP_TYPES = [
  { id: 'crate', label: 'Crate', shape: 'box', size: [0.55, 0.55, 0.55], mass: 6, color: 0xc58b4a },
  { id: 'ball', label: 'Ball', shape: 'sphere', r: 0.2, mass: 1.5, color: 0xe0523a, bounce: 0.6 },
  { id: 'beachball', label: 'Beach ball', shape: 'sphere', r: 0.45, mass: 0.3, color: 0x4fb3ff, bounce: 0.75 },
  { id: 'barrel', label: 'Barrel', shape: 'cylinder', r: 0.3, h: 0.85, mass: 12, color: 0x7a4a2a },
  { id: 'cone', label: 'Cone', shape: 'cylinder', rTop: 0.03, r: 0.24, h: 0.6, mass: 1.2, color: 0xff8a1e },
  { id: 'bigcrate', label: 'Big crate', shape: 'box', size: [1.2, 1.2, 1.2], mass: 60, color: 0xa66f3a, climb: true },
  { id: 'plank', label: 'Plank', shape: 'box', size: [2.6, 0.15, 0.5], mass: 15, color: 0xd2a26a, climb: true },
  { id: 'platform', label: 'Platform', shape: 'box', size: [2, 0.2, 2], mass: 0, color: 0x9aa7b0, climb: true, fixed: true },
  { id: 'trampoline', label: 'Trampoline', shape: 'box', size: [2, 0.3, 2], mass: 0, color: 0x2fbf71, climb: true, fixed: true, bouncy: 0.85 },
];
export const TYPE = Object.fromEntries(PROP_TYPES.map(t => [t.id, t]));

export const MAX_PROPS = 80;

const G_STATIC = 1, G_LIGHT = 2, G_HEAVY = 4, G_HAND = 8;

function halfExtents(t) {
  if (t.shape === 'box') return new THREE.Vector3(t.size[0] / 2, t.size[1] / 2, t.size[2] / 2);
  if (t.shape === 'sphere') return new THREE.Vector3(t.r, t.r, t.r);
  return new THREE.Vector3(t.r, t.h / 2, t.r);
}

function makeGeometry(t) {
  if (t.shape === 'box') return new THREE.BoxGeometry(...t.size);
  if (t.shape === 'sphere') return new THREE.IcosahedronGeometry(t.r, 2);
  return new THREE.CylinderGeometry(t.rTop ?? t.r, t.r, t.h, 14);
}

function makeShape(t) {
  if (t.shape === 'box') return new CANNON.Box(new CANNON.Vec3(t.size[0] / 2, t.size[1] / 2, t.size[2] / 2));
  if (t.shape === 'sphere') return new CANNON.Sphere(t.r);
  return new CANNON.Cylinder(t.rTop ?? t.r, t.r, t.h, 12);
}

export class PropWorld {
  /**
   * @param scene           three.js scene to draw props in
   * @param levelColliders  the level's static boxes (so props land on them)
   * @param simulate        true on the host / solo; false for joined players
   */
  constructor(scene, levelColliders, simulate = true) {
    this.scene = scene;
    this.simulate = simulate;
    this.props = new Map();
    this.nextId = 1;
    this.meshes = {};
    this.mats = {};
    for (const t of PROP_TYPES) {
      this.meshes[t.id] = makeGeometry(t);
      this.mats[t.id] = new THREE.MeshLambertMaterial({ color: t.color, flatShading: t.shape !== 'sphere' });
    }
    this.halves = Object.fromEntries(PROP_TYPES.map(t => [t.id, halfExtents(t)]));

    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.defaultContactMaterial.friction = 0.45;
    w.defaultContactMaterial.restitution = 0.15;
    this.bouncyMat = new CANNON.Material('bouncy');
    w.addContactMaterial(new CANNON.ContactMaterial(this.bouncyMat, w.defaultMaterial, { friction: 0.3, restitution: 0.9 }));
    for (const t of PROP_TYPES) if (t.bounce) {
      t._mat = new CANNON.Material(t.id);
      w.addContactMaterial(new CANNON.ContactMaterial(t._mat, w.defaultMaterial, { friction: 0.4, restitution: t.bounce }));
      w.addContactMaterial(new CANNON.ContactMaterial(t._mat, this.bouncyMat, { friction: 0.3, restitution: 0.95 }));
    }
    for (const c of levelColliders) {
      const half = new CANNON.Vec3((c.max.x - c.min.x) / 2, (c.max.y - c.min.y) / 2, (c.max.z - c.min.z) / 2);
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G_STATIC, collisionFilterMask: G_LIGHT | G_HEAVY });
      b.addShape(new CANNON.Box(half));
      b.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
      w.addBody(b);
    }
    this.hands = new Map(); // key -> kinematic sphere that knocks light props around
    this._acc = 0;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix3();
  }

  // ---- props
  spawn(typeId, pos, quat, { id, owner = null } = {}) {
    const t = TYPE[typeId];
    if (!t) return null;
    if (id == null) id = this.nextId++;
    else this.nextId = Math.max(this.nextId, id + 1);
    if (this.props.has(id)) return this.props.get(id);

    const mesh = new THREE.Mesh(this.meshes[t.id], this.mats[t.id]);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    this.scene.add(mesh);
    const p = {
      id, type: t, owner, mesh, held: null, body: null,
      col: t.climb ? { min: new THREE.Vector3(), max: new THREE.Vector3(), delta: new THREE.Vector3(), kind: t.bouncy ? 'pad' : 'wood', bouncy: t.bouncy || 0, prop: id } : null,
      target: { pos: mesh.position.clone(), quat: mesh.quaternion.clone() },
    };
    if (this.simulate) {
      const b = new CANNON.Body({
        mass: t.fixed ? 0 : t.mass,
        type: t.fixed ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
        material: t.bouncy ? this.bouncyMat : t._mat,
        collisionFilterGroup: t.climb ? G_HEAVY : G_LIGHT,
        collisionFilterMask: t.climb ? (G_STATIC | G_LIGHT | G_HEAVY) : (G_STATIC | G_LIGHT | G_HEAVY | G_HAND),
        linearDamping: 0.05, angularDamping: 0.1,
        sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6,
      });
      b.addShape(makeShape(t));
      b.position.set(pos.x, pos.y, pos.z);
      if (quat) b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      this.world.addBody(b);
      p.body = b;
    }
    this.props.set(id, p);
    this._updateCol(p, true);
    // keep the count in check: drop the oldest
    if (this.simulate && this.props.size > MAX_PROPS) this.remove(this.props.keys().next().value);
    return p;
  }

  remove(id) {
    const p = this.props.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    if (p.body) this.world.removeBody(p.body);
    this.props.delete(id);
  }

  clear() { for (const id of [...this.props.keys()]) this.remove(id); }

  lastOwnedBy(owner) {
    let last = null;
    for (const p of this.props.values()) if (p.owner === owner) last = p;
    return last;
  }

  /** Closest prop whose surface is within `reach` of `pos`. */
  nearest(pos, reach = 0.25, filter = () => true) {
    let best = null, bd = Infinity;
    for (const p of this.props.values()) {
      if (!filter(p)) continue;
      const h = this.halves[p.type.id];
      // distance to the prop's (rotated) box
      const local = this._v.copy(pos).sub(p.mesh.position).applyQuaternion(this._q.copy(p.mesh.quaternion).invert());
      const dx = Math.max(Math.abs(local.x) - h.x, 0), dy = Math.max(Math.abs(local.y) - h.y, 0), dz = Math.max(Math.abs(local.z) - h.z, 0);
      const d = Math.hypot(dx, dy, dz);
      if (d < reach && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---- holding (grab and throw)
  /** holder: { key, pos, quat } of the hand that grabbed it */
  grab(id, holder) {
    const p = this.props.get(id);
    if (!p || p.held) return false;
    const inv = new THREE.Quaternion().copy(holder.quat).invert();
    p.held = {
      key: holder.key,
      offset: p.mesh.position.clone().sub(holder.pos).applyQuaternion(inv),
      rot: inv.multiply(p.mesh.quaternion),
    };
    if (p.body) {
      p.body.type = CANNON.Body.KINEMATIC;
      p.body.mass = 0; p.body.updateMassProperties();
      p.body.velocity.setZero(); p.body.angularVelocity.setZero();
      p.body.allowSleep = false;
      p.body.wakeUp();
    }
    return true;
  }

  /** Where a held prop should be, given the holding hand's pose. */
  heldPose(p, handPos, handQuat, outPos, outQuat) {
    outPos.copy(p.held.offset).applyQuaternion(handQuat).add(handPos);
    outQuat.copy(handQuat).multiply(p.held.rot);
  }

  release(id, vel) {
    const p = this.props.get(id);
    if (!p || !p.held) return;
    p.held = null;
    if (p.body) {
      p.body.allowSleep = true;
      if (!p.type.fixed) {
        p.body.type = CANNON.Body.DYNAMIC;
        p.body.mass = p.type.mass; p.body.updateMassProperties();
        if (vel) p.body.velocity.set(vel.x, vel.y, vel.z);
      } else {
        p.body.type = CANNON.Body.STATIC;
        p.body.velocity.setZero();
      }
      p.body.wakeUp();
    }
  }

  /** Move a held prop to follow its hand (host / solo). */
  moveHeld(p, pos, quat, dt) {
    const b = p.body;
    if (!b) return;
    b.velocity.set((pos.x - b.position.x) / dt, (pos.y - b.position.y) / dt, (pos.z - b.position.z) / dt);
    b.position.set(pos.x, pos.y, pos.z);
    b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  }

  // ---- players' hands knock light props around (host / solo)
  setHand(key, pos, r, dt) {
    if (!this.simulate) return;
    let h = this.hands.get(key);
    if (!h) {
      h = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: G_HAND, collisionFilterMask: G_LIGHT, allowSleep: false });
      h.addShape(new CANNON.Sphere(r));
      h.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(h);
      this.hands.set(key, h);
    }
    h.seen = true;
    const inv = 1 / Math.max(dt, 1e-3);
    h.velocity.set((pos.x - h.position.x) * inv, (pos.y - h.position.y) * inv, (pos.z - h.position.z) * inv);
    if (h.velocity.length() > 30) h.velocity.setZero(); // teleported (respawn): don't smack things
    h.position.set(pos.x, pos.y, pos.z);
  }
  /** Remove hand bodies that were not set since the last call. */
  pruneHands() {
    for (const [k, h] of this.hands) {
      if (!h.seen) { this.world.removeBody(h); this.hands.delete(k); }
      h.seen = false;
    }
  }

  setGravity(g) { this.world.gravity.set(0, g, 0); for (const p of this.props.values()) p.body && p.body.wakeUp(); }

  // ---- simulation
  step(dt) {
    if (!this.simulate) return;
    this.world.step(1 / 72, dt, 4);
    for (const p of this.props.values()) {
      const b = p.body;
      p.mesh.position.set(b.position.x, b.position.y, b.position.z);
      p.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      if (b.position.y < -20) this.remove(p.id);   // fell out of the world
      else this._updateCol(p);
    }
  }

  /** Climbable props as boxes for the movement code (skips props held by `exceptKey`'s player). */
  colliders(exceptHolder = null) {
    const out = [];
    for (const p of this.props.values()) {
      if (!p.col) continue;
      // skip what that player is holding (host's record, a joined player's snapshot, or a local grab not yet confirmed)
      const key = (p.held && p.held.key) || p.heldKey || (p.localHold ? exceptHolder : '');
      if (exceptHolder && key && key.startsWith(exceptHolder)) continue;
      out.push(p.col);
    }
    return out;
  }

  _updateCol(p, reset = false) {
    if (!p.col) return;
    const h = this.halves[p.type.id], e = this._v;
    // world-space half size of the rotated box: |R| * h
    const m = this._m.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(p.mesh.quaternion)).elements;
    e.set(
      Math.abs(m[0]) * h.x + Math.abs(m[3]) * h.y + Math.abs(m[6]) * h.z,
      Math.abs(m[1]) * h.x + Math.abs(m[4]) * h.y + Math.abs(m[7]) * h.z,
      Math.abs(m[2]) * h.x + Math.abs(m[5]) * h.y + Math.abs(m[8]) * h.z,
    );
    const c = p.mesh.position;
    if (reset) p.col.delta.set(0, 0, 0);
    else p.col.delta.set(c.x - (p.col.min.x + p.col.max.x) / 2, c.y - (p.col.min.y + p.col.max.y) / 2, c.z - (p.col.min.z + p.col.max.z) / 2);
    p.col.min.copy(c).sub(e);
    p.col.max.copy(c).add(e);
  }

  // ---- networking
  /** Compact state of every prop: [id, typeIndex, x, y, z, qx, qy, qz, qw, heldKey|0, owner|0] */
  snapshot() {
    const out = [];
    const r = v => Math.round(v * 1000) / 1000;
    for (const p of this.props.values()) {
      const a = p.mesh.position, q = p.mesh.quaternion;
      out.push([p.id, PROP_TYPES.indexOf(p.type), r(a.x), r(a.y), r(a.z), r(q.x), r(q.y), r(q.z), r(q.w), p.held ? p.held.key : 0, p.owner || 0]);
    }
    return out;
  }

  /** Joined players: make the props match the host's snapshot. */
  applySnapshot(list) {
    const seen = new Set();
    for (const [id, ti, x, y, z, qx, qy, qz, qw, heldKey, owner] of list) {
      seen.add(id);
      let p = this.props.get(id);
      const pos = new THREE.Vector3(x, y, z), quat = new THREE.Quaternion(qx, qy, qz, qw);
      if (!p) p = this.spawn(PROP_TYPES[ti].id, pos, quat, { id, owner: owner || null });
      p.target.pos.copy(pos); p.target.quat.copy(quat);
      p.heldKey = heldKey || null;
    }
    for (const id of [...this.props.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Joined players: glide props toward their latest known pose. */
  interpolate(dt) {
    const a = 1 - Math.exp(-18 * dt);
    for (const p of this.props.values()) {
      if (p.mesh.position.distanceTo(p.target.pos) > 3) p.mesh.position.copy(p.target.pos);
      else p.mesh.position.lerp(p.target.pos, a);
      p.mesh.quaternion.slerp(p.target.quat, a);
      this._updateCol(p);
    }
  }
}
