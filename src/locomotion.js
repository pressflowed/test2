// Arm-push locomotion. No legs: you move only by pushing off surfaces with your hands.
//
// The player is a "rig" (origin + yaw) that holds the head and both hands. Inputs
// are the head and hand positions in rig space (from the headset and controllers in
// VR, or from the mouse on desktop). Every frame:
//   1. Gravity pulls the rig down and the body collides with the world.
//   2. Each hand sweeps toward its target. If it hits a surface, it stays pinned
//      there until the real hand lifts off that surface.
//   3. Pinned hands push the rig by (pinned point - target), so moving a pinned
//      hand down and back moves your body up and forward.
//   4. When the last hand lets go, the rig keeps the average velocity of the last
//      few frames, with a small boost. That is what turns fast strokes into leaps.
import * as THREE from 'three';
import { sdBox, near, pushOut } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);

export const DEFAULTS = {
  gravity: -9.8,
  bodyHeight: 0.8,     // from the head centre down to the bottom of the body
  headR: 0.2,
  bodyR: 0.22,
  handR: 0.07,
  maxReach: 1.15,      // a pinned hand lets go if it ends up this far from the head
  stickTol: 0.02,      // how far a hand may lift off a surface before it lets go
  maxPush: 0.25,       // max distance hands can move the body in one frame
  jumpMult: 1.1,       // boost applied to the release velocity
  multThreshold: 1.0,  // only boost releases faster than this (m/s)
  maxJump: 6.5,        // m/s
  groundFriction: 10,
  historyFrames: 5,
};

export class Locomotion {
  constructor(world, opts = {}) {
    this.world = world;
    this.cfg = { ...DEFAULTS, ...opts };
    this.origin = new THREE.Vector3();
    this.yaw = 0;
    this.vel = new THREE.Vector3();
    this.head = new THREE.Vector3();
    this.grounded = false;
    this.groundKind = null;
    this.touching = false;
    this.history = [];
    this.events = [];
    this.hands = [0, 1].map(i => ({
      index: i,
      pos: new THREE.Vector3(),     // where the hand really is (pinned point when pinned)
      target: new THREE.Vector3(),  // where the controller says it is
      pinned: false,
      col: null,
      normal: new THREE.Vector3(),
      ready: false,
    }));
    this._start = new THREE.Vector3();
    this._push = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  toWorld(local, out) {
    return out.copy(local).applyAxisAngle(UP, this.yaw).add(this.origin);
  }

  /** Put the rig at `pos` (rig origin, i.e. the floor under the play space centre). */
  teleport(pos, yaw = this.yaw) {
    this.origin.copy(pos);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.history.length = 0;
    this.touching = false;
    for (const h of this.hands) { h.pinned = false; h.ready = false; }
  }

  /** Snap turn around the head, so the view turns in place. */
  turn(angle, headLocal) {
    const head = this.toWorld(headLocal, this._tmp);
    this.yaw += angle;
    const offset = this._tmp2.copy(headLocal).applyAxisAngle(UP, this.yaw);
    this.origin.copy(head).sub(offset);
    for (const h of this.hands) { h.pinned = false; h.ready = false; }
  }

  _bodySpheres() {
    const c = this.cfg;
    return [
      [0, c.headR],
      [-(c.bodyHeight - c.bodyR) * 0.5, c.bodyR],
      [-(c.bodyHeight - c.bodyR), c.bodyR],
    ];
  }

  _collideBody(fixVel) {
    const s = this._tmp2;
    const spheres = this._bodySpheres();
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const [dy, r] of spheres) {
        for (const col of this.world.colliders) {
          s.set(this.head.x, this.head.y + dy, this.head.z);
          if (!pushOut(s, r, col, this._n)) continue;
          moved = true;
          const ddx = s.x - this.head.x, ddy = s.y - (this.head.y + dy), ddz = s.z - this.head.z;
          this.origin.x += ddx; this.origin.y += ddy; this.origin.z += ddz;
          this.head.x += ddx; this.head.y += ddy; this.head.z += ddz;
          if (fixVel) {
            const vn = this.vel.dot(this._n);
            if (vn < 0) this.vel.addScaledVector(this._n, -vn);
          }
          if (this._n.y > 0.6) { this.grounded = true; this.groundKind = col.kind; }
        }
      }
      if (!moved) break;
    }
  }

  _pushOutAll(p, r) {
    for (const col of this.world.colliders) pushOut(p, r, col, this._n);
  }

  // Sweep a hand from where it was to its target; stop at the first surface.
  _sweep(h) {
    const r = this.cfg.handR;
    const from = this._tmp.copy(h.pos);
    let len = from.distanceTo(h.target);
    if (len > 1.5) { from.copy(this.head); len = from.distanceTo(h.target); }
    const steps = Math.max(1, Math.ceil(len / 0.025));
    const q = this._tmp2;
    for (let i = 1; i <= steps; i++) {
      q.lerpVectors(from, h.target, i / steps);
      for (const col of this.world.colliders) {
        if (!near(q, col, r) || sdBox(q, col) >= r) continue;
        pushOut(q, r, col, h.normal);
        h.pos.copy(q);
        return col;
      }
    }
    h.pos.copy(h.target);
    return null;
  }

  /**
   * @param dt          seconds
   * @param headLocal   head position in rig space
   * @param handLocals  [left, right] hand positions in rig space
   * @param handActive  [left, right] whether each hand can touch things
   */
  update(dt, headLocal, handLocals, handActive = [true, true]) {
    const c = this.cfg;
    this.events.length = 0;
    this._start.copy(this.origin);

    // 1. free motion under gravity. While a hand is pinned the hands are in full
    //    control, so no momentum carries over; it is handed back on release (step 4).
    if (this.touching) this.vel.set(0, 0, 0);
    this.grounded = false;
    const steps = Math.min(8, Math.max(1, Math.ceil(this.vel.length() * dt / 0.08)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.y = Math.max(this.vel.y + c.gravity * sdt, -30);
      this.origin.addScaledVector(this.vel, sdt);
      this.toWorld(headLocal, this.head);
      this._collideBody(true);
    }
    if (this.grounded && !this.touching) {
      const f = Math.exp(-c.groundFriction * dt);
      this.vel.x *= f; this.vel.z *= f;
    }

    // 2. hands
    const push = this._push.set(0, 0, 0);
    let n = 0;
    for (const h of this.hands) {
      this.toWorld(handLocals[h.index], h.target);
      if (!h.ready) {
        h.pos.copy(h.target); this._pushOutAll(h.pos, c.handR);
        h.ready = true;
      }
      if (!handActive[h.index]) {
        h.pinned = false;
        h.pos.copy(h.target); this._pushOutAll(h.pos, c.handR);
        continue;
      }
      if (h.pinned) {
        const lifted = sdBox(h.target, h.col) > c.handR + c.stickTol;
        const tooFar = h.pos.distanceTo(this.head) > c.maxReach;
        if (lifted || tooFar) h.pinned = false;
        else { push.add(this._tmp.subVectors(h.pos, h.target)); n++; continue; }
      }
      const before = this._tmp2.copy(h.pos);
      const speed = before.distanceTo(h.target) / Math.max(dt, 1e-4);
      const hit = this._sweep(h);
      if (hit) {
        h.pinned = true; h.col = hit;
        push.add(this._tmp.subVectors(h.pos, h.target)); n++;
        this.events.push({ type: 'touch', hand: h.index, kind: hit.kind, strength: Math.min(Math.max(speed / 3, 0.1), 1) });
      }
    }

    // 3. pinned hands move the body
    if (n) {
      push.divideScalar(n);
      if (push.length() > c.maxPush) push.setLength(c.maxPush);
      this.origin.add(push);
      this.head.add(push);
      this._collideBody(false);
    }

    // 4. velocity bookkeeping and the release fling
    const frameVel = this._tmp.subVectors(this.origin, this._start).divideScalar(Math.max(dt, 1e-4));
    if (n) {
      this.vel.copy(frameVel);
      this.history.push(frameVel.clone());
      if (this.history.length > c.historyFrames) this.history.shift();
      this.touching = true;
    } else if (this.touching) {
      const v = new THREE.Vector3();
      for (const s of this.history) v.add(s);
      if (this.history.length) v.divideScalar(this.history.length);
      if (v.length() > c.multThreshold) v.multiplyScalar(c.jumpMult);
      if (v.length() > c.maxJump) v.setLength(c.maxJump);
      this.vel.copy(v);
      this.history.length = 0;
      this.touching = false;
      this.events.push({ type: 'launch', speed: v.length() });
    }
  }
}
