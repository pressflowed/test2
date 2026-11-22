// Arrows. Each flies in an arc until it meets a wall (and sticks there for a while) or
// somebody (which is the host's business: see hitTest). Every player works out the same
// flight from the same start, so only "this arrow was loosed" and "this arrow hit that"
// need sending.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, WOOD, STEEL } from './weapons.js';

export const ARROW = { gravity: -5.5, life: 4, stuck: 14, len: 0.72, max: 40 };
const FWD = new THREE.Vector3(0, 0, -1);
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();

function arrowGeometry() {
  // pointing along -Z, with its middle at the origin
  const L = ARROW.len, rot = g => g.rotateX(-Math.PI / 2);
  const parts = [
    paint(rot(new THREE.CylinderGeometry(0.008, 0.008, L, 5)), WOOD),
    paint(rot(new THREE.ConeGeometry(0.022, 0.07, 4)).translate(0, 0, -L / 2 - 0.03), STEEL),
    paint(new THREE.BoxGeometry(0.002, 0.06, 0.1).translate(0, 0, L / 2 - 0.06), 0xd9d2c0),
    paint(new THREE.BoxGeometry(0.06, 0.002, 0.1).translate(0, 0, L / 2 - 0.06), 0xb3261e),
  ];
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}

export class Arrows {
  constructor(scene, max = ARROW.max) {
    this.max = max;
    this.list = [];                 // { id, by, p, v, t, stuck, power }
    this.events = [];
    this.mesh = null;
    if (scene) {
      this.mesh = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), max);
      this.mesh.frustumCulled = false; this.mesh.count = 0;
      scene.add(this.mesh);
    }
  }

  /** Loose one: from `o`, at velocity `v`. `power` (0..1) is how far the bow was drawn. */
  shoot(id, o, v, by = null, power = 1) {
    if (this.list.length >= this.max) this.list.shift();
    const a = { id, by, p: o.clone(), v: v.clone(), t: 0, stuck: false, power };
    this.list.push(a);
    return a;
  }
  remove(id) { this.list = this.list.filter(a => a.id !== id); }
  clear() { this.list.length = 0; if (this.mesh) this.mesh.count = 0; }

  /**
   * Fly. `world` is the physics World (walls stop arrows). `hitTest(from, to, arrow)`, if given, says
   * whether the arrow met somebody on this stretch: return truthy to take it out of the air.
   * `events` then holds { type: 'stuck', id, p } for each that hit a wall this frame.
   */
  update(dt, world, hitTest = null) {
    this.events.length = 0;
    const v = world && world.voxels;
    for (const a of this.list) {
      a.t += dt;
      if (a.stuck) continue;
      a.v.y += ARROW.gravity * dt;
      const speed = a.v.length(), step = speed * dt;
      _d.copy(a.v).divideScalar(speed || 1);
      // a wall in the way?
      const hit = v ? v.raycast(a.p, _d, step + 0.05) : null;
      const to = _p.copy(a.p).addScaledVector(_d, hit ? Math.max(hit.point.distanceTo(a.p) - 0.02, 0) : step);
      if (to.y < 0.02) { to.y = 0.02; }
      if (hitTest && hitTest(a.p, to, a)) { a.gone = true; continue; }
      a.p.copy(to);
      if (hit || to.y <= 0.02) { a.stuck = true; a.t = 0; this.events.push({ type: 'stuck', id: a.id, p: a.p.clone() }); }
    }
    this.list = this.list.filter(a => !a.gone && a.t < (a.stuck ? ARROW.stuck : ARROW.life));
    if (!this.mesh) return;
    let n = 0;
    for (const a of this.list) {
      _d.copy(a.v).normalize();
      _q.setFromUnitVectors(FWD, _d);
      // drawn with its head where the arrow is
      this.mesh.setMatrixAt(n++, _m.compose(_p.copy(a.p).addScaledVector(_d, -ARROW.len / 2), _q, _s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
