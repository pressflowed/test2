// Really dumb bots: dummies to test things on. They hop around with no plan, flinch
// when hit, back away when you grab them, and that is all. The host runs them; to
// everyone else they look like any other player.
import * as THREE from 'three';
import { Locomotion } from './locomotion.js';
import { restGrip } from './avatar.js';

const UP = new THREE.Vector3(0, 1, 0);
const COLORS = [0xe0ac86, 0xb97a56, 0x7a4a30, 0x9ec7a0, 0xa9b6d8, 0xd8a9c8];
const HEAD = new THREE.Vector3(0, 1.5, 0);
const GRIP = [restGrip(1), restGrip(-1)];
export const MAX_BOTS = 6;

export class Bot {
  constructor(id, n, world, pos) {
    this.id = id;
    this.name = `Dummy ${n}`;
    this.color = COLORS[(n - 1) % COLORS.length];
    this.loco = new Locomotion(world);
    this.loco.teleport(pos);
    this.home = pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.wait = 0.5 + Math.random() * 2;      // seconds until it next decides to do something
    this.flinch = 0;
    this.t = Math.random() * 10;
    this.pose = {
      head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
      scale: 1,
    };
    this._locals = [new THREE.Vector3(), new THREE.Vector3()];
    this._q = new THREE.Quaternion();
    this.update(0.016, null);
  }

  /** Knocked by a hit: stagger away. */
  knock(dir, strength) {
    this.loco.vel.addScaledVector(dir, strength);
    this.loco.vel.y += strength * 0.6;
    this.flinch = 0.8;
  }

  respawn() {
    const a = Math.random() * Math.PI * 2;
    this.loco.teleport(this.home.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5)));
    this.wait = 1;
  }

  /**
   * @param body       this bot's Body (or null): the dead do not move
   * @param pulledFrom where a hand has hold of one of its arms (THREE.Vector3), or null
   */
  update(dt, body, pulledFrom = null) {
    const lo = this.loco, alive = !body || !body.dead;
    this.t += dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.wait -= dt;
    if (pulledFrom && this.wait > 0.3) this.wait = 0.3;     // startled: it will not stand there for long
    if (alive && lo.grounded && this.wait <= 0) {
      if (pulledFrom) {
        // someone has its arm: hop straight away from them (which is how arms come off)
        const dx = lo.head.x - pulledFrom.x, dz = lo.head.z - pulledFrom.z, d = Math.hypot(dx, dz) || 1;
        this.yaw = Math.atan2(-dx / d, -dz / d) + Math.PI;
        lo.vel.set(dx / d * 2.4, 2.2, dz / d * 2.4);
        this.wait = 0.7;
      } else if (Math.random() < 0.75) {
        // wander: pick a way to face (homeward if it has strayed) and hop
        const far = Math.hypot(lo.head.x - this.home.x, lo.head.z - this.home.z) > 7;
        this.yaw = far ? Math.atan2(-(this.home.x - lo.head.x), -(this.home.z - lo.head.z)) : this.yaw + (Math.random() - 0.5) * 2.6;
        const s = 1.2 + Math.random() * 1.2;
        lo.vel.set(-Math.sin(this.yaw) * s, 2.2 + Math.random(), -Math.cos(this.yaw) * s);
        this.wait = 1.2 + Math.random() * 2.5;
      } else this.wait = 1 + Math.random() * 2;   // or just stand there
    }
    // arms: hanging and swaying a little; thrown up when startled
    const q = this._q.setFromAxisAngle(UP, this.yaw);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, sway = Math.sin(this.t * 1.3 + i * 2) * 0.05;
      const local = this._locals[i];
      if (this.flinch > 0) local.set(side * 0.22, -0.12 + sway, -0.3);
      else if (!lo.grounded) local.set(side * 0.45, -0.25, -0.1);
      else local.set(side * 0.3, -0.62 + sway * 0.4, -0.12 + sway);
      local.applyQuaternion(q).add(HEAD);
    }
    if (alive) lo.update(Math.min(dt, 0.05), HEAD, this._locals, [false, false]);
    this.pose.head.pos.copy(lo.head);
    this.pose.head.quat.copy(q);
    for (let i = 0; i < 2; i++) {
      lo.toWorld(this._locals[i], this.pose.hands[i].pos);
      this.pose.hands[i].quat.copy(q).multiply(GRIP[i]);
    }
  }
}
