// Small visual effects: soft blob shadows under things, explosion flashes, and flying rubble.
import * as THREE from 'three';
import { blobTexture } from './textures.js';

/** Dark soft discs on the ground under props and players. One draw call for all of them. */
export class BlobShadows {
  constructor(scene, max = 140) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.max = max;
    this._m = new THREE.Matrix4();
    scene.add(this.mesh);
  }

  /**
   * @param casters   [{ x, y, z, r }] y is the bottom of the thing
   * @param colliders boxes to drop the shadows onto
   * @param voxels    optional VoxelWorld to drop them onto as well
   */
  update(casters, colliders, voxels = null) {
    let n = 0;
    for (const c of casters) {
      if (n >= this.max) break;
      let ground = voxels ? voxels.groundBelow(c.x, c.y + 0.12, c.z) : -Infinity;
      for (const b of colliders) {
        if (c.x < b.min.x || c.x > b.max.x || c.z < b.min.z || c.z > b.max.z) continue;
        if (b.max.y <= c.y + 0.12 && b.max.y > ground) ground = b.max.y;
      }
      if (ground === -Infinity) continue;
      const h = Math.max(c.y - ground, 0);
      if (h > 9) continue;
      const s = c.r * (1.7 - h * 0.1);
      this._m.makeScale(s, 1, s).setPosition(c.x, ground + 0.015, c.z);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Expanding fireballs for explosions. */
export class Blasts {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.geo = new THREE.IcosahedronGeometry(1, 2);
  }
  add(pos, radius) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.live.push({ mesh, t: 0, radius });
  }
  update(dt) {
    for (const b of this.live) {
      b.t += dt;
      const k = Math.min(b.t / 0.45, 1);
      b.mesh.scale.setScalar(0.3 + b.radius * 0.55 * (1 - (1 - k) * (1 - k)));
      b.mesh.material.opacity = 0.9 * (1 - k);
      b.mesh.material.color.setHex(k < 0.3 ? 0xfff2c0 : 0xff7a2a);
    }
    this.live = this.live.filter(b => {
      if (b.t < 0.45) return true;
      this.scene.remove(b.mesh); b.mesh.material.dispose();
      return false;
    });
  }
}

/** Chunks of rubble that fly out when blocks break. Purely for show: one draw call, no physics. */
export class Debris {
  constructor(scene, max = 320) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.bits = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * @param samples [[x, y, z, color], ...] where blocks broke
   * @param from    centre of the hit: rubble flies away from it
   * @param size    block size in metres
   */
  burst(samples, from, size, gravity = -9.8) {
    for (const [x, y, z, color] of samples) {
      if (this.bits.length >= this.max) this.bits.shift();
      const dx = x - from.x, dy = y - from.y, dz = z - from.z, d = Math.hypot(dx, dy, dz) || 1;
      const speed = 1.5 + Math.random() * 3.5;
      this.bits.push({
        x, y, z, vx: dx / d * speed + (Math.random() - 0.5) * 2, vy: dy / d * speed + 1.5 + Math.random() * 2.5, vz: dz / d * speed + (Math.random() - 0.5) * 2,
        rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 12,
        size: size * (0.45 + Math.random() * 0.5), life: 1.3 + Math.random() * 0.9, age: 0, color, gravity,
      });
    }
  }

  update(dt) {
    let n = 0;
    for (const b of this.bits) {
      b.age += dt;
      b.vy += b.gravity * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < b.size / 2) { b.y = b.size / 2; b.vy = -b.vy * 0.35; b.vx *= 0.6; b.vz *= 0.6; b.spin *= 0.5; }
      b.rx += b.spin * dt; b.ry += b.spin * 0.7 * dt;
    }
    this.bits = this.bits.filter(b => b.age < b.life);
    for (const b of this.bits) {
      const k = b.size * Math.min(1, (b.life - b.age) / 0.35);     // shrink away at the end
      this._m.compose(this._p.set(b.x, b.y, b.z), this._q.setFromEuler(this._e.set(b.rx, b.ry, 0)), this._s.set(k, k, k));
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this._c.setHex(b.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
