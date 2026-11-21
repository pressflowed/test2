// Bots. In the sandbox they are really dumb: dummies to test things on, which hop
// around with no plan, flinch when hit, and back away when you grab them. In the arena
// they are gladiators: they wait in their room, then come for you and swing. Still not
// clever. The host runs them; to everyone else they look like any other player.
import * as THREE from 'three';
import { Locomotion } from './locomotion.js';
import { restGrip, ARMED_GRIP } from './avatar.js';

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const COLORS = [0xe0ac86, 0xb97a56, 0x7a4a30, 0x9ec7a0, 0xa9b6d8, 0xd8a9c8];
const HEAD = new THREE.Vector3(0, 1.5, 0);
const GRIP = [restGrip(1), restGrip(-1)];
export const MAX_BOTS = 6;
export const GLADIATORS = ['Brutus', 'Maximus', 'Spartacus', 'Crixus', 'Flamma', 'Priscus', 'Verus', 'Commodus'];
const SWING = 0.3;      // seconds from winding up to landing a blow

export class Bot {
  constructor(id, n, world, pos, name = `Dummy ${n}`) {
    this.id = id;
    this.name = name;
    this.color = COLORS[(n - 1) % COLORS.length];
    this.loco = new Locomotion(world);
    this.loco.teleport(pos);
    this.home = pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.wait = 0.5 + Math.random() * 2;      // seconds until it next decides to do something
    this.flinch = 0;
    this.t = Math.random() * 10;
    this.swing = 0;                           // seconds left of the blow it is throwing
    this.cool = 0;                            // seconds until it may throw another
    this.strike = false;                      // a blow landed this frame (the session works out what it hit)
    this.weaponHand = -1;                     // the hand it holds a weapon in, if any (the session keeps this up to date)
    this.shieldHand = -1;                     // the hand it holds a shield in, likewise: that one stays up in front of it
    this.caught = null;                       // set by the session if the blow it is throwing has run into a guard
    this.lastTip = null;
    this.pose = {
      head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
      scale: 1,
    };
    this._locals = [new THREE.Vector3(), new THREE.Vector3()];
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this.update(0.016, null);
  }

  /** Knocked by a hit: stagger away. */
  knock(dir, strength) {
    this.loco.vel.addScaledVector(dir, strength);
    this.loco.vel.y += strength * 0.6;
    this.flinch = 0.8;
  }

  /** Throw your arms up (the crowd does this when a blow lands). */
  cheer() { this.flinch = Math.max(this.flinch, 0.5 + Math.random() * 0.5); }

  /** Put it somewhere, facing a way, and make that its home. */
  place(pos, yaw = this.yaw) {
    this.loco.teleport(pos);
    this.home.copy(pos);
    this.yaw = yaw;
    this.wait = 0.5; this.swing = 0; this.cool = 0.8; this.strike = false;
  }

  respawn() {
    const a = Math.random() * Math.PI * 2;
    this.loco.teleport(this.home.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5)));
    this.wait = 1;
  }

  /**
   * @param body       this bot's Body (or null): the dead do not move
   * @param pulledFrom where a hand has hold of one of its arms (THREE.Vector3), or null
   * @param brain      what it is up to: null for a sandbox dummy; { kind: 'still' } to stand and
   *                   watch; { kind: 'fight', target, goal, reach } to go for whoever is at `target`
   *                   (by way of `goal` first, if given) and swing when within `reach` metres
   */
  update(dt, body, pulledFrom = null, brain = null) {
    const lo = this.loco, alive = !body || !body.dead;
    const hop = (dx, dz, speed, up) => { const d = Math.hypot(dx, dz) || 1; lo.vel.set(dx / d * speed, up, dz / d * speed); };
    this.t += dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.wait -= dt;
    this.cool -= dt;
    this.strike = false;
    if (this.swing > 0 && (this.swing -= dt) <= 0) this.strike = alive;
    if (pulledFrom && this.wait > 0.3) this.wait = 0.3;     // startled: it will not stand there for long
    const ready = alive && lo.grounded && this.wait <= 0;
    if (ready && pulledFrom) {
      // someone has its arm: hop straight away from them (which is how arms come off)
      const dx = lo.head.x - pulledFrom.x, dz = lo.head.z - pulledFrom.z;
      this.yaw = Math.atan2(dx, dz);
      hop(dx, dz, 2.4, 2.2);
      this.wait = 0.7;
    } else if (brain && brain.kind === 'fight' && alive) {
      const to = brain.goal || brain.target;
      if (to) {
        const dx = to.x - lo.head.x, dz = to.z - lo.head.z, d = Math.hypot(dx, dz);
        if (this.swing <= 0) this.yaw = Math.atan2(-dx, -dz);                       // keep facing them
        if (ready && this.swing <= 0) {
          if (brain.goal || d > brain.reach * 0.8) { hop(dx, dz, Math.min(3.4, 1.4 + d), 1.9 + Math.random() * 0.5); this.wait = 0.4 + Math.random() * 0.3; }
          else if (this.cool <= 0) { this.swing = SWING; this.cool = 0.9 + Math.random() * 0.8; }
          else if (Math.random() < dt * 1.2) { const side = Math.random() < 0.5 ? -1 : 1; hop(-dz * side, dx * side, 2.2, 1.8); this.wait = 0.5; }   // circle them
        }
      }
    } else if (ready && !brain) {
      if (Math.random() < 0.75) {
        // wander: pick a way to face (homeward if it has strayed) and hop
        const far = Math.hypot(lo.head.x - this.home.x, lo.head.z - this.home.z) > 7;
        this.yaw = far ? Math.atan2(-(this.home.x - lo.head.x), -(this.home.z - lo.head.z)) : this.yaw + (Math.random() - 0.5) * 2.6;
        const s = 1.2 + Math.random() * 1.2;
        lo.vel.set(-Math.sin(this.yaw) * s, 2.2 + Math.random(), -Math.cos(this.yaw) * s);
        this.wait = 1.2 + Math.random() * 2.5;
      } else this.wait = 1 + Math.random() * 2;   // or just stand there
    }

    // arms: hanging and swaying a little; thrown up when startled; one of them swings
    const q = this._q.setFromAxisAngle(UP, this.yaw);
    const striker = this.weaponHand >= 0 ? this.weaponHand : !body || body.canUse(1) ? 1 : 0;
    const blow = this.swing > 0 ? 1 - this.swing / SWING : -1;      // 0 wound up .. 1 landed
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, sway = Math.sin(this.t * 1.3 + i * 2) * 0.05;
      const local = this._locals[i];
      if (blow >= 0 && i === striker) local.set(side * (0.32 - 0.2 * blow), 0.05 - 0.4 * blow, 0.05 - 0.75 * blow);
      else if (i === this.shieldHand) local.set(side * 0.1, -0.5 + sway * 0.3, -0.42);         // shield up, in front of the chest (the head shows over it)
      else if (this.flinch > 0) local.set(side * 0.22, -0.12 + sway, -0.3);
      else if (i === this.weaponHand) local.set(side * 0.3, -0.38 + sway * 0.4, -0.32);       // weapon held up, ready
      else if (!lo.grounded) local.set(side * 0.45, -0.25, -0.1);
      else local.set(side * 0.3, -0.62 + sway * 0.4, -0.12 + sway);
      local.applyQuaternion(q).add(HEAD);
    }
    if (alive) lo.update(Math.min(dt, 0.05), HEAD, this._locals, [false, false]);
    this.pose.head.pos.copy(lo.head);
    this.pose.head.quat.copy(q);
    for (let i = 0; i < 2; i++) {
      lo.toWorld(this._locals[i], this.pose.hands[i].pos);
      const hq = this.pose.hands[i].quat.copy(q);
      if (i === this.weaponHand) hq.multiply(this._q2.setFromAxisAngle(X, blow >= 0 && i === striker ? 0.5 - 1.7 * blow : 0)).multiply(ARMED_GRIP);   // the blade comes over and down
      else if (i === this.shieldHand) hq.multiply(ARMED_GRIP);       // knuckles forward: so is the face of the shield
      else hq.multiply(GRIP[i]);
    }
  }
}
