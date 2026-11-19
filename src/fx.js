// Small visual effects: soft blob shadows under things, and explosion flashes.
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
   */
  update(casters, colliders) {
    let n = 0;
    for (const c of casters) {
      if (n >= this.max) break;
      let ground = -Infinity;
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
