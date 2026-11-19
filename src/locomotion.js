// Arm-push locomotion. No legs: you move only by pushing off surfaces with your hands.
//
// The player is a "rig" (origin + yaw) that holds the head and both hands. Inputs
// are the head and hand positions in rig space (from the headset and controllers in
// VR, or from the mouse on desktop). Every frame:
//   1. Gravity pulls the rig down and the body collides with the world.
//   2. Each hand sweeps toward its target. If it hits a surface, it stays pinned
//      there until the real hand lifts off that surface.
//   3. Pinned hands push the rig by (pinned point - target), so moving a pinned
//      hand down and back moves your body up and forward. A planted hand never
//      slows you down: if it would, it skids along the surface instead (handBrake
//      sets how much grip it keeps against your momentum; 0 = none), so touches
//      keep your speed and hands only ever add to it.
//   4. When the last hand lets go, the rig keeps the average velocity of the last
//      few frames, with a boost. That is what turns fast strokes into leaps.
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
  stickTol: 0.002,     // how far a hand may lift off a surface before it lets go
  handBrake: 0,        // how fast a planted hand can slow you along a surface, m/s per second (0 = never)
  maxPush: 0.25,       // max distance hands can move the body in one frame
  jumpMult: 1.25,      // boost applied to the release velocity
  multThreshold: 1.0,  // only boost releases faster than this (m/s)
  maxJump: 8.5,        // fastest launch, m/s
  maxSpeed: 11,        // overall speed limit, m/s
  groundFriction: 10,
  historyFrames: 5,
};

export class Locomotion {
  constructor(world, opts = {}) {
    this.world = world;
    this.cfg = { ...DEFAULTS, ...opts };   // base settings, for a normal-sized player
    this.scale = 1;                        // player size: 2 = twice as big
    this.power = 1;                        // multiplies launch boost and top speed
    this.c = { ...this.cfg };              // settings in effect (scaled), refreshed every update
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
    this._v0 = new THREE.Vector3();
    this._ct = new THREE.Vector3();
  }

  toWorld(local, out) {
    return out.copy(local).multiplyScalar(this.scale).applyAxisAngle(UP, this.yaw).add(this.origin);
  }

  // The settings in effect for the current size and power.
  _refresh() {
    const b = this.cfg, e = this.c, s = this.scale, p = this.power;
    Object.assign(e, b);
    for (const k of ['bodyHeight', 'headR', 'bodyR', 'handR', 'maxReach', 'stickTol', 'maxPush', 'multThreshold']) e[k] = b[k] * s;
    e.jumpMult = b.jumpMult * p;
    e.maxJump = b.maxJump * p * s;
    e.maxSpeed = b.maxSpeed * p * s;
    return e;
  }

  /** Change the player's size, keeping their feet where they are. */
  setScale(scale, headLocal) {
    const head = this.toWorld(headLocal, this._tmp);
    const feetY = head.y - this.cfg.bodyHeight * this.scale;
    this.scale = scale;
    this._refresh();
    const offset = this._tmp2.copy(headLocal).multiplyScalar(scale).applyAxisAngle(UP, this.yaw);
    this.origin.set(head.x - offset.x, feetY + this.cfg.bodyHeight * scale + 0.02 - offset.y, head.z - offset.z);
    this.history.length = 0;
    this.touching = false;
    for (const h of this.hands) { h.pinned = false; h.ready = false; }
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
    const offset = this._tmp2.copy(headLocal).multiplyScalar(this.scale).applyAxisAngle(UP, this.yaw);
    this.origin.copy(head).sub(offset);
    for (const h of this.hands) { h.pinned = false; h.ready = false; }
  }

  _bodySpheres() {
    const c = this.c;
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
            if (vn < 0) {
              // bouncy surfaces (trampolines) throw you back off them
              const bounce = col.bouncy && vn < -1 ? col.bouncy : 0;
              this.vel.addScaledVector(this._n, -vn * (1 + bounce));
            }
          }
          if (this._n.y > 0.6) {
            this.grounded = true; this.groundKind = col.kind;
            // launch pads fling you straight up
            if (fixVel && col.launch && this.vel.y < col.launch) { this.vel.y = col.launch; this.events.push({ type: 'pad', col }); }
          }
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
    const r = this.c.handR;
    const from = this._tmp.copy(h.pos);
    let len = from.distanceTo(h.target);
    if (len > 1.5 * this.scale) { from.copy(this.head); len = from.distanceTo(h.target); }
    const steps = Math.max(1, Math.ceil(len / (0.025 * this.scale)));
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

  // How far a pinned hand moves the body. Pushes always apply in full. The only thing
  // limited is a planted hand cancelling the momentum you already had: that can slow
  // you by at most handBrake (m/s per second), and the hand skids along for the rest.
  _correction(h, dt) {
    const c = this._tmp.subVectors(h.pos, h.target);
    // momentum along this surface
    const mom = this._ct.copy(this._v0).addScaledVector(h.normal, -this._v0.dot(h.normal));
    const speed = mom.length();
    if (speed > 1e-6) {
      mom.divideScalar(speed);
      const braking = -c.dot(mom);                      // how much of c opposes the momentum
      if (braking > 0) {
        const cancel = Math.min(braking, speed * dt);   // beyond this the hand is actively pushing
        const skid = cancel - Math.min(cancel, this.cfg.handBrake * dt * dt);
        if (skid > 0) { c.addScaledVector(mom, skid); h.pos.addScaledVector(mom, skid); }
      }
    }
    return c;
  }

  /**
   * @param dt          seconds
   * @param headLocal   head position in rig space
   * @param handLocals  [left, right] hand positions in rig space
   * @param handActive  [left, right] whether each hand can touch things
   */
  update(dt, headLocal, handLocals, handActive = [true, true]) {
    const c = this._refresh();
    this.events.length = 0;
    this._start.copy(this.origin);

    // 1. free motion under gravity (momentum carries through hand contacts)
    this._v0.copy(this.vel);
    this.grounded = false;
    const steps = Math.min(8, Math.max(1, Math.ceil(this.vel.length() * dt / (0.08 * this.scale))));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.y = Math.max(this.vel.y + c.gravity * sdt, -30);
      this.origin.addScaledVector(this.vel, sdt);
      this.toWorld(headLocal, this.head);
      this._collideBody(true);
    }
    if (this.grounded) {
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
      if (h.pinned && h.col.delta) h.pos.add(h.col.delta);   // ride along with moving props
      if (h.pinned) {
        const lifted = sdBox(h.target, h.col) > c.handR + c.stickTol;
        const tooFar = h.pos.distanceTo(this.head) > c.maxReach;
        if (lifted || tooFar) h.pinned = false;
        else { push.add(this._correction(h, dt)); n++; continue; }
      }
      const before = this._tmp2.copy(h.pos);
      const speed = before.distanceTo(h.target) / Math.max(dt, 1e-4);
      const hit = this._sweep(h);
      if (hit) {
        h.pinned = true; h.col = hit;
        push.add(this._correction(h, dt)); n++;
        this.events.push({ type: 'touch', hand: h.index, kind: hit.kind, col: hit, strength: Math.min(Math.max(speed / 3, 0.1), 1) });
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
      this.history.push(frameVel.clone());
      if (this.history.length > c.historyFrames) this.history.shift();
      // Keep the momentum you already had (it may turn with your hands), but a planted
      // hand never adds sliding speed of its own: pushes move you directly and fling
      // you on release. Motion away from the touched surfaces isn't kept either, so
      // pressing into a wall doesn't bounce you off it.
      const keep = Math.min(this._v0.length(), c.maxSpeed);
      this.vel.copy(frameVel);
      for (const h of this.hands) {
        if (!h.pinned) continue;
        const vn = this.vel.dot(h.normal);
        if (vn > 0) this.vel.addScaledVector(h.normal, -vn);
      }
      if (this.vel.length() > keep) this.vel.setLength(keep);
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
