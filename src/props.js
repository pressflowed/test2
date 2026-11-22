// Physics props you can spawn, push, grab, throw and stand on.
//
// The host (or a solo player) runs the physics with cannon-es. Other players only
// draw the props where the host says they are (see applySnapshot).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sdBox, near, pushOut } from './physics.js';
import { texture } from './textures.js';
import { makeGib, LOOSE } from './gibs.js';
import { WEAPONS, weaponVisual, weaponHold, MAX_BLOOD } from './weapons.js';
import { ARMOUR, armourVisual } from './armour.js';

// size: box [x, y, z]; sphere r; cylinder r, h (rTop for cones and pins)
// climb:  players' hands and bodies collide with it (you can stand on it). Otherwise
//         it is "light": hands knock it around instead.
// fixed:  does not fall; stays where you put it (you can still grab and move it)
// bouncy: players bounce off it.  launch: flings players up at this speed (m/s).
// float:  rises like a balloon.   fuse: explodes this many seconds after it appears.
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
  { id: 'tnt', label: 'TNT', shape: 'box', size: [0.4, 0.5, 0.4], mass: 5, color: 0xc5281c, fuse: 4 },
  { id: 'balloon', label: 'Balloon', shape: 'sphere', r: 0.3, mass: 0.15, color: 0xe8527a, bounce: 0.5, float: 2.2 },
  { id: 'launchpad', label: 'Launch pad', shape: 'box', size: [1.6, 0.25, 1.6], mass: 0, color: 0xffd23f, climb: true, fixed: true, launch: 13 },
  { id: 'bouncyball', label: 'Super ball', shape: 'sphere', r: 0.14, mass: 0.6, color: 0xff5fc0, bounce: 0.93 },
  { id: 'giantball', label: 'Giant ball', shape: 'sphere', r: 0.9, mass: 9, color: 0xf2f2ee, bounce: 0.55 },
  { id: 'domino', label: 'Domino', shape: 'box', size: [0.3, 0.6, 0.1], mass: 1.5, color: 0x222226 },
  { id: 'pin', label: 'Bowling pin', shape: 'cylinder', rTop: 0.045, r: 0.085, h: 0.45, mass: 0.9, color: 0xf7f4ea },
  { id: 'dice', label: 'Dice', shape: 'box', size: [0.4, 0.4, 0.4], mass: 2.5, color: 0xf4f1e8, bounce: 0.45 },
  { id: 'tire', label: 'Tire', shape: 'cylinder', r: 0.4, h: 0.26, mass: 5, color: 0x222326, bounce: 0.6 },
  { id: 'anvil', label: 'Anvil', shape: 'box', size: [0.55, 0.36, 0.3], mass: 150, color: 0x3a3f46 },
  { id: 'block', label: 'Block', shape: 'box', size: [1, 1, 1], mass: 0, color: 0xe9c46a, climb: true, fixed: true },
  { id: 'wall', label: 'Wall', shape: 'box', size: [3, 2, 0.3], mass: 0, color: 0x7b827c, climb: true, fixed: true },
  { id: 'pillar', label: 'Pillar', shape: 'box', size: [0.6, 3, 0.6], mass: 0, color: 0x7b827c, climb: true, fixed: true },
  { id: 'beam', label: 'Beam', shape: 'box', size: [4, 0.3, 0.4], mass: 0, color: 0x8a5e36, climb: true, fixed: true },
  { id: 'table', label: 'Table', shape: 'box', size: [1.6, 0.75, 0.9], mass: 30, color: 0x9a6a3c, climb: true },
  // weapons: swing the business end into somebody (see weapons.js)
  ...Object.entries(WEAPONS).map(([id, w]) => ({ id, label: w.label, shape: 'box', size: w.size, mass: w.mass, color: 0xcfd6dc, weapon: w })),
  // armour: pick a piece up and it is on (see armour.js). A dented one (wounds: 1) is just scrap.
  ...Object.entries(ARMOUR).map(([id, a]) => ({ id, label: a.label, shape: 'box', size: a.size, mass: a.mass, color: 0xcfd6dc, armour: a })),
  // body pieces: not in the spawn menu; they appear when someone loses a limb or dies, and fade after a while
  { id: 'gib_head', label: 'Head', shape: 'sphere', r: 0.11, mass: 4, color: 0xe0ac86, bounce: 0.35, gib: true },
  { id: 'gib_torso', label: 'Body', shape: 'box', size: [0.42, 0.66, 0.22], mass: 25, color: 0xe0ac86, gib: true },
  { id: 'gib_arm', label: 'Arm', shape: 'box', size: [0.12, 0.64, 0.12], mass: 4, color: 0xe0ac86, gib: true },
  { id: 'gib_fore', label: 'Forearm', shape: 'box', size: [0.1, 0.36, 0.1], mass: 2, color: 0xe0ac86, gib: true },
  { id: 'gib_upper', label: 'Upper arm', shape: 'box', size: [0.12, 0.3, 0.12], mass: 2, color: 0xe0ac86, gib: true },
  { id: 'gib_chest', label: 'Chest', shape: 'box', size: [0.46, 0.34, 0.22], mass: 15, color: 0xe0ac86, gib: true },
  { id: 'gib_belly', label: 'Belly', shape: 'box', size: [0.34, 0.26, 0.2], mass: 10, color: 0xe0ac86, gib: true },
  { id: 'gib_guts', label: 'Guts', shape: 'sphere', r: 0.085, mass: 1.5, color: 0xd08080, gib: true },
];
/** What the spawn menu offers. */
export const SPAWNABLE = PROP_TYPES.filter(t => !t.gib);
export const GIB_LIFE = 80;   // seconds a body piece lies around
export const MAX_GIBS = 56;   // more than this and the oldest goes (a whole body at a time)
export const TYPE = Object.fromEntries(PROP_TYPES.map(t => [t.id, t]));

export const MAX_PROPS = 90;
export const BLAST_RADIUS = 6;

const G_STATIC = 1, G_LIGHT = 2, G_HEAVY = 4, G_HAND = 8;
// The pieces of one dead body are jointed together and must not collide with each other,
// so each body gets one of these groups to itself (they are handed out in turn).
const RAG0 = 16, RAGS = 8, ALL_RAG = ((1 << RAGS) - 1) * RAG0;

function halfExtents(t) {
  if (t.shape === 'box') return new THREE.Vector3(t.size[0] / 2, t.size[1] / 2, t.size[2] / 2);
  if (t.shape === 'sphere') return new THREE.Vector3(t.r, t.r, t.r);
  return new THREE.Vector3(t.r, t.h / 2, t.r);
}
const HALF = Object.fromEntries(PROP_TYPES.map(t => [t.id, halfExtents(t)]));

/** Largest dimension of a prop type, in metres. */
export function propSize(id) { const h = HALF[id]; return Math.max(h.x, h.y, h.z) * 2; }

// Geometry and material for each type, shared by every prop, preview and seed.
const visuals = {};
export function propVisual(id) {
  if (!visuals[id]) {
    const t = TYPE[id];
    if (t.weapon) return (visuals[id] = weaponVisual(id));
    if (t.armour) return (visuals[id] = armourVisual(id));
    let geo;
    if (t.shape === 'box') geo = new THREE.BoxGeometry(...t.size);
    else if (t.shape === 'sphere') geo = new THREE.SphereGeometry(t.r, 20, 14);
    else geo = new THREE.CylinderGeometry(t.rTop ?? t.r, t.r, t.h, 16);
    const map = texture(id);
    const mat = new THREE.MeshLambertMaterial(map ? { map } : { color: t.color });
    if (t.float) { mat.transparent = true; mat.opacity = 0.92; }
    visuals[id] = { geo, mat };
  }
  return visuals[id];
}

function makeShape(t, k = 1) {
  if (t.shape === 'box') return new CANNON.Box(new CANNON.Vec3(t.size[0] * k / 2, t.size[1] * k / 2, t.size[2] * k / 2));
  if (t.shape === 'sphere') return new CANNON.Sphere(t.r * k);
  return new CANNON.Cylinder((t.rTop ?? t.r) * k, t.r * k, t.h * k, 12);
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4();

export class PropWorld {
  /**
   * @param scene     three.js scene to draw props in
   * @param level     the World: its permanent boxes and (if any) its voxels are what props land on
   * @param simulate  true on the host / solo; false for joined players
   */
  constructor(scene, level, simulate = true) {
    this.scene = scene;
    this.simulate = simulate;
    this.level = level;
    this.props = new Map();
    this.seeds = new Map();     // thrown minis that turn into props where they land
    this.events = [];           // { type: 'boom', pos: [x, y, z] } for the session to pick up
    this.nextId = 1;
    this.nextSeed = 1;
    this.gravity = -9.8;

    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, this.gravity, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.defaultContactMaterial.friction = 0.45;
    w.defaultContactMaterial.restitution = 0.15;
    this.bouncyMat = new CANNON.Material('bouncy');
    w.addContactMaterial(new CANNON.ContactMaterial(this.bouncyMat, w.defaultMaterial, { friction: 0.3, restitution: 0.9 }));
    this.mats = {};
    for (const t of PROP_TYPES) if (t.bounce) {
      const m = this.mats[t.id] = new CANNON.Material(t.id);
      w.addContactMaterial(new CANNON.ContactMaterial(m, w.defaultMaterial, { friction: 0.4, restitution: t.bounce }));
      w.addContactMaterial(new CANNON.ContactMaterial(m, this.bouncyMat, { friction: 0.3, restitution: 0.95 }));
    }
    this.joints = [];           // { c: constraint, a: prop id, b: prop id } holding dead bodies together
    for (const c of level.statics) {
      if (c.noProps) continue;  // gates and the like: only players are stopped by them
      const half = new CANNON.Vec3((c.max.x - c.min.x) / 2, (c.max.y - c.min.y) / 2, (c.max.z - c.min.z) / 2);
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G_STATIC, collisionFilterMask: G_LIGHT | G_HEAVY | ALL_RAG });
      b.addShape(new CANNON.Box(half));
      b.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
      w.addBody(b);
    }
    this.cellBodies = new Map();   // voxel cell index -> one static body holding that cell's boxes
    this._seedCols = [];
    if (level.voxels && simulate) this.syncCells(level.voxels.cells);
    // balloons: lift that beats gravity, applied on every physics substep
    w.addEventListener('preStep', () => {
      for (const p of this.props.values()) {
        if (p.type.float && p.body && !p.held) p.body.force.y += p.body.mass * (-this.gravity + p.type.float);
      }
    });
    this.hands = new Map(); // key -> kinematic sphere that knocks light props around
  }

  // ---- the voxel world
  /** Rebuild the physics for voxel cells whose blocks changed, and wake props so they can fall. */
  syncCells(cells) {
    if (!this.simulate) return;
    for (const cell of cells) {
      const old = this.cellBodies.get(cell.index);
      if (old) { this.world.removeBody(old); this.cellBodies.delete(cell.index); }
      if (!cell.boxes.length) continue;
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G_STATIC, collisionFilterMask: G_LIGHT | G_HEAVY | ALL_RAG });
      const o = cell.boxes[0].min;
      body.position.set(o.x, o.y, o.z);
      for (const b of cell.boxes) {
        const hx = (b.max.x - b.min.x) / 2, hy = (b.max.y - b.min.y) / 2, hz = (b.max.z - b.min.z) / 2;
        body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(b.min.x + hx - o.x, b.min.y + hy - o.y, b.min.z + hz - o.z));
      }
      this.world.addBody(body);
      this.cellBodies.set(cell.index, body);
    }
    for (const p of this.props.values()) if (p.body && !p.type.fixed) p.body.wakeUp();
  }

  // ---- props
  /**
   * scale, wounds and rag only apply to body pieces: a giant's arm is a giant arm; wounds
   * says which ends are raw (see gibs.js); rag is the number of the dead body it belongs to.
   */
  spawn(typeId, pos, quat, { id, owner = null, vel = null, color = 0, scale = 1, wounds = null, rag = 0 } = {}) {
    const t = TYPE[typeId];
    if (!t) return null;
    if (id == null) id = this.nextId++;
    else this.nextId = Math.max(this.nextId, id + 1);
    if (this.props.has(id)) return this.props.get(id);

    const { geo, mat } = propVisual(t.id);
    if (t.gib && wounds == null) wounds = LOOSE[t.id] || 0;
    const gib = t.gib ? makeGib(t.id, color || t.color, wounds) : null;       // a real body piece, in its owner's skin colour
    const forged = t.weapon && color ? weaponVisual(t.id, wounds || 0, true) : null;
    const mesh = gib || new THREE.Mesh(forged ? forged.geo : t.weapon && wounds ? weaponVisual(t.id, wounds).geo : t.armour && wounds ? armourVisual(t.id, true).geo : geo, forged ? forged.mat : t.fuse ? mat.clone() : mat);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    if (t.weapon && owner !== 'rack') mesh.quaternion.multiply(_q.setFromAxisAngle(_n.set(0, 0, 1), 1.35));   // weapons come out lying down, not balanced on end
    if (t.fixed) snapYaw(mesh.quaternion);   // keeps the box you stand on matching what you see
    const size = t.gib ? Math.min(Math.max(scale || 1, 0.2), 4) : 1;
    mesh.scale.setScalar(t.gib ? size : 0.15);
    this.scene.add(mesh);
    const p = {
      id, type: t, owner, mesh, held: null, body: null, grow: t.gib ? 1 : 0, fuse: t.fuse || 0, color, size, life: t.gib ? GIB_LIFE : Infinity,
      wounds: wounds || 0, rag, age: 0, shy: rag ? 0.35 : 0,   // shy: seconds before hands can shove a fresh corpse (the fist that killed it is still inside it)
      col: t.climb ? { min: new THREE.Vector3(), max: new THREE.Vector3(), delta: new THREE.Vector3(), kind: t.bouncy || t.launch ? 'pad' : 'wood', bouncy: t.bouncy || 0, launch: t.launch || 0, prop: id } : null,
      target: { pos: mesh.position.clone(), quat: mesh.quaternion.clone() },
    };
    if (this.simulate) {
      const b = new CANNON.Body({
        mass: t.fixed ? 0 : t.mass * size ** 3,
        type: t.fixed ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
        material: t.bouncy ? this.bouncyMat : this.mats[t.id],
        collisionFilterGroup: rag ? RAG0 << (rag % RAGS) : t.climb ? G_HEAVY : G_LIGHT,
        collisionFilterMask: rag ? (G_STATIC | G_LIGHT | G_HEAVY | (ALL_RAG & ~(RAG0 << (rag % RAGS))))
          : t.climb ? (G_STATIC | G_LIGHT | G_HEAVY | ALL_RAG) : (G_STATIC | G_LIGHT | G_HEAVY | G_HAND | ALL_RAG),
        linearDamping: t.float ? 0.7 : rag ? 0.12 : 0.05, angularDamping: t.float ? 0.7 : rag ? 0.5 : 0.1,
        sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6,
        allowSleep: !t.float && !t.fuse,
      });
      b.addShape(makeShape(t, size));
      b.position.set(pos.x, pos.y, pos.z);
      b.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
      if (vel && !t.fixed) b.velocity.set(vel.x, vel.y, vel.z);
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
    if (p.type.fuse) p.mesh.material.dispose();
    if (p.mesh.userData.dispose) p.mesh.userData.dispose();
    if (p.body) this.world.removeBody(p.body);
    this.props.delete(id);
    if (this.joints.length) this.joints = this.joints.filter(j => {
      if (j.a !== id && j.b !== id) return true;
      this.world.removeConstraint(j.c);
      return false;
    });
  }

  /** A weapon has been used on someone: it gets bloodier (up to a point). */
  bloody(p) { if (p && p.type.weapon && p.wounds < MAX_BLOOD) this._stain(p, p.wounds + 1); }
  _stain(p, level) {
    p.wounds = level;
    const vis = weaponVisual(p.type.id, level, !!p.color);
    p.mesh.geometry = vis.geo; p.mesh.material = vis.mat;
  }
  /** A weapon comes out of the forge: it glows, and (see the session) does more. Kept in `color`, which weapons do not otherwise use. */
  forge(p) { if (p && p.type.weapon && !p.color) { p.color = 1; this._stain(p, p.wounds); } }

  /** Remove every piece of one dead body. */
  removeGroup(rag) {
    for (const p of [...this.props.values()]) if (p.rag === rag) this.remove(p.id);
  }

  /**
   * Join two props at a point in the world, like a ball-and-socket (host / solo). With
   * `swing` (radians) the second may only lean that far from how it sits on the first now.
   */
  joint(a, b, at, swing = 0) {
    if (!a || !b || !a.body || !b.body) return;
    const local = (p, v) => { const l = v.clone().sub(p.mesh.position).applyQuaternion(p.mesh.quaternion.clone().invert()); return new CANNON.Vec3(l.x, l.y, l.z); };
    const add = c => { c.collideConnected = false; this.world.addConstraint(c); this.joints.push({ c, a: a.id, b: b.id }); };
    if (!swing) { add(new CANNON.PointToPointConstraint(a.body, local(a, at), b.body, local(b, at))); return; }
    // the line from the joint to the second prop's middle, as each of them sees it now
    const axis = b.mesh.position.clone().sub(at).normalize();
    const ax = p => { const l = axis.clone().applyQuaternion(p.mesh.quaternion.clone().invert()); return new CANNON.Vec3(l.x, l.y, l.z); };
    add(new CANNON.ConeTwistConstraint(a.body, b.body, { pivotA: local(a, at), pivotB: local(b, at), axisA: ax(a), axisB: ax(b), angle: swing, twistAngle: swing }));
  }

  clear() {
    for (const id of [...this.props.keys()]) this.remove(id);
    for (const id of [...this.seeds.keys()]) this._removeSeed(id);
  }

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
      const h = HALF[p.type.id];
      // distance to the prop's (rotated) box
      const local = _v.copy(pos).sub(p.mesh.position).applyQuaternion(_q.copy(p.mesh.quaternion).invert());
      const k = p.size;
      const dx = Math.max(Math.abs(local.x) - h.x * k, 0), dy = Math.max(Math.abs(local.y) - h.y * k, 0), dz = Math.max(Math.abs(local.z) - h.z * k, 0);
      const d = Math.hypot(dx, dy, dz);
      if (d < reach && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---- thrown seeds: a mini version flies through the air and grows where it lands
  throwSeed(typeId, pos, vel, owner = null, id = null) {
    if (!TYPE[typeId]) return null;
    if (id == null) id = this.nextSeed++;
    const { geo, mat } = propVisual(typeId);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(0.09 / propSize(typeId));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const seed = { id, type: TYPE[typeId], pos: mesh.position, vel: vel.clone(), owner, age: 0, mesh, target: pos.clone() };
    this.seeds.set(id, seed);
    return seed;
  }

  _removeSeed(id) {
    const s = this.seeds.get(id);
    if (!s) return;
    this.scene.remove(s.mesh);
    this.seeds.delete(id);
  }

  _stepSeeds(dt) {
    const R = 0.05;
    for (const s of [...this.seeds.values()]) {
      s.age += dt;
      s.vel.y += this.gravity * dt;
      s.mesh.rotation.x += dt * 9; s.mesh.rotation.y += dt * 6;
      const dist = s.vel.length() * dt, steps = Math.max(1, Math.ceil(dist / 0.08));
      let hit = false;
      for (let i = 0; i < steps && !hit; i++) {
        s.pos.addScaledVector(s.vel, dt / steps);
        const solids = this.level.query(s.pos, R, this._seedCols);
        for (const p of this.props.values()) if (p.col) solids.push(p.col);
        for (const c of solids) {
          if (!near(s.pos, c, R) || sdBox(s.pos, c) >= R) continue;
          pushOut(s.pos, R, c, _n);
          hit = true;
          break;
        }
      }
      if (!hit && s.age < 6 && s.pos.y > -10) continue;
      if (!hit) _n.set(0, 1, 0);
      // grow into the real thing, clear of the surface it hit
      const h = HALF[s.type.id];
      const clear = Math.abs(_n.x) * h.x + Math.abs(_n.y) * h.y + Math.abs(_n.z) * h.z;
      const pos = s.pos.clone().addScaledVector(_n, clear + 0.02);
      const yaw = Math.atan2(-s.vel.x, -s.vel.z);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      // keep a little of the throw, sliding along the surface
      const vel = s.vel.clone().addScaledVector(_n, -s.vel.dot(_n)).multiplyScalar(0.25);
      this.spawn(s.type.id, pos, quat, { owner: s.owner, vel });
      this._removeSeed(s.id);
    }
  }

  // ---- holding (grab and throw)
  /** holder: { key, pos, quat } of the hand that grabbed it */
  grab(id, holder) {
    const p = this.props.get(id);
    if (!p || p.held) return false;
    const inv = new THREE.Quaternion().copy(holder.quat).invert();
    p.held = p.type.weapon ? { key: holder.key, ...weaponHold(p.type.weapon) }      // a weapon jumps into the fist the right way round
      : { key: holder.key, offset: p.mesh.position.clone().sub(holder.pos).applyQuaternion(inv), rot: inv.multiply(p.mesh.quaternion) };
    if (p.body) {
      p.body.type = CANNON.Body.KINEMATIC;
      p.body.mass = 0; p.body.updateMassProperties();
      p.body.velocity.setZero(); p.body.angularVelocity.setZero();
      p.body.allowSleep = false;
      p.body.wakeUp();
      if (p.type.weapon) {
        // straight into the fist, rather than flying there and batting things aside on the way
        this.heldPose(p, holder.pos, holder.quat, _v, _q);
        p.body.position.set(_v.x, _v.y, _v.z);
        p.body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
      }
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
      p.body.allowSleep = !p.type.float && !p.type.fuse;
      if (!p.type.fixed) {
        p.body.type = CANNON.Body.DYNAMIC;
        p.body.mass = p.type.mass * p.size ** 3; p.body.updateMassProperties();
        if (vel) p.body.velocity.set(vel.x, vel.y, vel.z);
      } else {
        p.body.type = CANNON.Body.STATIC;
        p.body.velocity.setZero();
        // fixed props stay level and square to the world once you let go
        snapYaw(p.mesh.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w));
        p.body.quaternion.set(p.mesh.quaternion.x, p.mesh.quaternion.y, p.mesh.quaternion.z, p.mesh.quaternion.w);
      }
      p.body.wakeUp();
    }
  }

  /**
   * Move a held prop to follow its hand (host / solo). It is given the speed that takes it
   * there in this step, and the physics moves it: so what it bumps into is pushed properly,
   * and it settles on the hand instead of overshooting back and forth.
   */
  moveHeld(p, pos, quat, dt) {
    const b = p.body;
    if (!b) return;
    const dx = pos.x - b.position.x, dy = pos.y - b.position.y, dz = pos.z - b.position.z, inv = 1 / Math.max(dt, 1e-3);
    if (dx * dx + dy * dy + dz * dz > 2.25) { b.position.set(pos.x, pos.y, pos.z); b.velocity.setZero(); }   // its holder teleported
    else b.velocity.set(dx * inv, dy * inv, dz * inv);
    b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    // the rest of a dead body must be awake to be dragged
    if (p.rag) for (const o of this.props.values()) if (o.rag === p.rag && o.body) o.body.wakeUp();
  }

  // ---- players' hands knock light props around (host / solo)
  setHand(key, pos, r, dt) {
    if (!this.simulate) return;
    let h = this.hands.get(key);
    if (h && Math.abs(h.r - r) > 1e-3) { this.world.removeBody(h); this.hands.delete(key); h = null; } // player changed size
    if (!h) {
      h = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: G_HAND, collisionFilterMask: G_LIGHT | ALL_RAG, allowSleep: false });
      h.addShape(new CANNON.Sphere(r));
      h.r = r;
      h.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(h);
      this.hands.set(key, h);
    }
    h.seen = true;
    // the speed that takes it to where the hand is now; the physics moves it there
    const inv = 1 / Math.max(dt, 1e-3);
    h.velocity.set((pos.x - h.position.x) * inv, (pos.y - h.position.y) * inv, (pos.z - h.position.z) * inv);
    if (h.velocity.length() > 40) { h.velocity.setZero(); h.position.set(pos.x, pos.y, pos.z); }   // teleported (respawn): don't smack things
  }
  /** Remove hand bodies that were not set since the last call. */
  pruneHands() {
    for (const [k, h] of this.hands) {
      if (!h.seen) { this.world.removeBody(h); this.hands.delete(k); }
      h.seen = false;
    }
  }

  setGravity(g) {
    this.gravity = g;
    this.world.gravity.set(0, g, 0);
    for (const p of this.props.values()) p.body && p.body.wakeUp();
  }

  // ---- explosions
  explode(pos, radius = BLAST_RADIUS, power = 13) {
    for (const p of this.props.values()) {
      const b = p.body;
      if (!b || p.held) continue;
      const dx = b.position.x - pos.x, dy = b.position.y - pos.y, dz = b.position.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      if (p.type.fuse) { p.fuse = Math.min(p.fuse, 0.12 + d * 0.04); continue; } // chain reaction
      if (p.type.fixed) continue;
      const k = (1 - d / radius) * power / Math.max(d, 0.3);
      b.wakeUp();
      b.velocity.x += dx * k; b.velocity.y += dy * k + (1 - d / radius) * power * 0.45; b.velocity.z += dz * k;
      b.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    }
    this.events.push({ type: 'boom', pos: [pos.x, pos.y, pos.z] });
  }

  // ---- simulation
  step(dt) {
    if (!this.simulate) return;
    this._stepSeeds(dt);
    this.world.step(1 / 72, dt, 4);
    for (const p of [...this.props.values()]) {
      const b = p.body;
      p.mesh.position.set(b.position.x, b.position.y, b.position.z);
      p.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      this._animate(p, dt);
      p.age += dt;
      if (p.shy > 0 && (p.shy -= dt) <= 0) b.collisionFilterMask |= G_HAND;
      if (p.type.fuse) {
        p.fuse -= dt;
        if (p.fuse <= 0) { const at = p.mesh.position.clone(); this.remove(p.id); this.explode(at); continue; }
      }
      if (!p.held) p.life -= dt;
      if (b.position.y < -20 || b.position.y > 90 || p.life <= 0) this.remove(p.id);   // fell out of the world, floated away, or (body pieces) had its time
      else this._updateCol(p);
    }
  }

  // growing in after a spawn, and the TNT warning blink
  _animate(p, dt) {
    if (p.grow < 1) {
      p.grow = Math.min(1, p.grow + dt / 0.22);
      const k = 1 - (1 - p.grow) * (1 - p.grow);
      p.mesh.scale.setScalar(0.15 + 0.85 * k);
    }
    if (p.type.fuse) {
      const rate = p.fuse < 1.2 ? 14 : 5;
      p.mesh.material.emissive.setHex(Math.sin(p.fuse * rate * Math.PI) > 0 ? 0x661100 : 0x000000);
    }
  }

  /** Climbable props as boxes for the movement code (skips what `exceptHolder` is holding). */
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

  /** Things that cast a blob shadow: { x, y (bottom), z, r }. */
  shadowCasters(out) {
    for (const p of this.props.values()) {
      const h = HALF[p.type.id], c = p.mesh.position;
      out.push({ x: c.x, y: c.y - (p.col ? (p.col.max.y - p.col.min.y) / 2 : Math.min(h.x, h.y, h.z) * p.size), z: c.z, r: Math.max(h.x, h.z) * p.size * (p.type.shape === 'box' ? 1.25 : 1.05) });
    }
    return out;
  }

  _updateCol(p, reset = false) {
    if (!p.col) return;
    const h = HALF[p.type.id], e = _v;
    // world-space half size of the rotated box: |R| * h
    const m = _m3.setFromMatrix4(_m4.makeRotationFromQuaternion(p.mesh.quaternion)).elements;
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
  /** Compact state: props as [id, typeIndex, x, y, z, qx, qy, qz, qw, heldKey|0, owner|0, fuse, colour, size, wounds], seeds as [id, typeIndex, x, y, z]. */
  snapshot() {
    const r = v => Math.round(v * 1000) / 1000;
    const props = [], seeds = [];
    for (const p of this.props.values()) {
      const a = p.mesh.position, q = p.mesh.quaternion;
      props.push([p.id, PROP_TYPES.indexOf(p.type), r(a.x), r(a.y), r(a.z), r(q.x), r(q.y), r(q.z), r(q.w), p.held ? p.held.key : 0, p.owner || 0, r(p.fuse), p.color || 0, p.size, p.wounds]);
    }
    for (const s of this.seeds.values()) seeds.push([s.id, PROP_TYPES.indexOf(s.type), r(s.pos.x), r(s.pos.y), r(s.pos.z)]);
    return { props, seeds };
  }

  /** Joined players: make the props match the host's snapshot. */
  applySnapshot(snap) {
    const seen = new Set();
    for (const [id, ti, x, y, z, qx, qy, qz, qw, heldKey, owner, fuse, color, size, wounds] of snap.props) {
      seen.add(id);
      let p = this.props.get(id);
      const pos = new THREE.Vector3(x, y, z), quat = new THREE.Quaternion(qx, qy, qz, qw);
      if (!p) p = this.spawn(PROP_TYPES[ti].id, pos, quat, { id, owner: owner || null, color: color || 0, scale: size || 1, wounds: wounds || 0 });
      p.target.pos.copy(pos); p.target.quat.copy(quat);
      if (p.type.weapon && (p.wounds !== (wounds || 0) || (p.color || 0) !== (color || 0))) { p.color = color || 0; this._stain(p, wounds || 0); }
      p.heldKey = heldKey || null;
      p.fuse = fuse || 0;
    }
    for (const id of [...this.props.keys()]) if (!seen.has(id)) this.remove(id);
    const seenSeeds = new Set();
    for (const [id, ti, x, y, z] of snap.seeds || []) {
      seenSeeds.add(id);
      let s = this.seeds.get(id);
      if (!s) s = this.throwSeed(PROP_TYPES[ti].id, new THREE.Vector3(x, y, z), new THREE.Vector3(), null, id);
      s.target.set(x, y, z);
    }
    for (const id of [...this.seeds.keys()]) if (!seenSeeds.has(id)) this._removeSeed(id);
  }

  /** Joined players: glide props toward their latest known pose. */
  interpolate(dt) {
    const a = 1 - Math.exp(-18 * dt);
    for (const p of this.props.values()) {
      if (p.mesh.position.distanceTo(p.target.pos) > 3) p.mesh.position.copy(p.target.pos);
      else p.mesh.position.lerp(p.target.pos, a);
      p.mesh.quaternion.slerp(p.target.quat, a);
      p.age += dt;
      this._animate(p, dt);
      this._updateCol(p);
    }
    for (const s of this.seeds.values()) {
      s.pos.lerp(s.target, 1 - Math.exp(-30 * dt));
      s.mesh.rotation.x += dt * 9; s.mesh.rotation.y += dt * 6;
    }
  }
}

// Level a rotation and snap its turn to the nearest quarter, in place.
function snapYaw(q) {
  const f = _v.set(0, 0, 1).applyQuaternion(q);
  const yaw = Math.round(Math.atan2(f.x, f.z) / (Math.PI / 2)) * (Math.PI / 2);
  return q.setFromAxisAngle(_n.set(0, 1, 0), yaw);
}

export { weaponHold };
