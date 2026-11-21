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

/**
 * Blood, and bits of meat. Droplets fly and fall and leave splats where they land: on the
 * ground, and on the walls and ceilings of the block world, where they run. Pools spread.
 * Chunks bounce and lie about. Three draw calls for all of it.
 */
const SPLAT_COLORS = [0x6a0909, 0x5a0707, 0x700c0c, 0x4c0505], POOL_COLOR = 0x470404;
const UPSIDE_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
export const MEAT = { red: 0x8c1212, dark: 0x560a0a, pink: 0xd08080, bone: 0xe6d9b8, fat: 0xd9b36a };
export class Blood {
  constructor(scene, maxDrops = 900, maxSplats = 1400, maxBits = 260) {
    this.maxDrops = maxDrops; this.maxSplats = maxSplats; this.maxBits = maxBits;
    this.drops = []; this.bitsList = [];
    this.splats = new Array(maxSplats).fill(null);     // a ring: the oldest is written over
    this.next = 0;
    this.dropMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xa30f0f }), maxDrops);
    const flat = new THREE.CircleGeometry(1, 8); flat.rotateX(-Math.PI / 2);
    // splats are solid colour (no see-through layers piling up), laid a hair above the surface
    this.splatMesh = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), maxSplats);
    this.bitMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), maxBits);
    for (const m of [this.dropMesh, this.splatMesh, this.bitMesh]) { m.frustumCulled = false; scene.add(m); }
    this.dropMesh.count = 0; this.bitMesh.count = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._e = new THREE.Euler(); this._c = new THREE.Color();
    this._bx = new THREE.Vector3(); this._bn = new THREE.Vector3(); this._bt = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxSplats; i++) { this.splatMesh.setMatrixAt(i, this._zero); this.splatMesh.setColorAt(i, this._c.setHex(SPLAT_COLORS[0])); }
  }

  /** Throw `count` droplets from pos, roughly along dir (a unit vector, or null for all round). */
  spray(pos, dir, count, speed = 2.5, size = 0.02, spread = 0.9) {
    for (let n = 0; n < count; n++) {
      if (this.drops.length >= this.maxDrops) this.drops.shift();
      const s = speed * (0.4 + Math.random() * 0.9);
      this.drops.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (dir ? dir.x * s : 0) + (Math.random() - 0.5) * speed * spread,
        vy: (dir ? dir.y * s : 0) + (dir ? Math.random() - 0.3 : Math.random()) * speed * spread * 0.8,
        vz: (dir ? dir.z * s : 0) + (Math.random() - 0.5) * speed * spread,
        size: size * (0.6 + Math.random() * 0.8), age: 0,
      });
    }
  }

  /** Throw `count` chunks of something from pos. colors: what they are made of (see MEAT). */
  chunks(pos, dir, count, speed = 3, colors = [MEAT.red, MEAT.dark], size = 0.035) {
    for (let n = 0; n < count; n++) {
      if (this.bitsList.length >= this.maxBits) this.bitsList.shift();
      const s = speed * (0.3 + Math.random());
      this.bitsList.push({
        x: pos.x + (Math.random() - 0.5) * 0.1, y: pos.y + (Math.random() - 0.5) * 0.1, z: pos.z + (Math.random() - 0.5) * 0.1,
        vx: (dir ? dir.x * s : 0) + (Math.random() - 0.5) * speed, vy: (dir ? dir.y * s : 0) + Math.random() * speed * 0.9, vz: (dir ? dir.z * s : 0) + (Math.random() - 0.5) * speed,
        rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 14,
        sx: size * (0.6 + Math.random() * 0.9), sy: size * (0.4 + Math.random() * 0.6), sz: size * (0.6 + Math.random() * 0.9),
        color: colors[Math.floor(Math.random() * colors.length)], age: 0, life: 22 + Math.random() * 14, rest: false, trail: 0.4 + Math.random() * 0.6,
      });
    }
  }

  /** A mark on a surface. (nx, ny, nz) is the way the surface faces. `grow`: it spreads to this radius over `seconds`. */
  splat(x, y, z, r, nx = 0, ny = 1, nz = 0, grow = 0, seconds = 0) {
    // the oldest mark goes, but a pool that is still fresh is stepped over
    let i = this.next;
    for (let tries = 0; tries < 12 && this.splats[i] && this.splats[i].grow && this.splats[i].age < 40; tries++) i = (i + 1) % this.maxSplats;
    this.next = (i + 1) % this.maxSplats;
    this.splats[i] = { x, y, z, nx, ny, nz, r, a: Math.random() * 6.28, age: 0, life: grow ? 75 : 50 + Math.random() * 20, grow, seconds, wall: Math.abs(ny) < 0.5, live: true };
    this.splatMesh.setColorAt(i, this._c.setHex(grow ? POOL_COLOR : SPLAT_COLORS[Math.floor(Math.random() * SPLAT_COLORS.length)]));
    this.splatMesh.instanceColor.needsUpdate = true;
  }
  /** A pool that spreads on the ground at pos. */
  pool(pos, groundY, r = 0.45, seconds = 7) { this.splat(pos.x, groundY + 0.014 + Math.random() * 0.004, pos.z, r * 0.2, 0, 1, 0, r, seconds); }

  /**
   * @param world { groundAt(x, y, z): height of the ground at or below a point, solidAt(x, y, z): is there a block there, grid: block size }
   */
  update(dt, gravity, world) {
    const G = world.grid || 0.25;
    // droplets
    const alive = [];
    for (const d of this.drops) {
      const px = d.x, py = d.y, pz = d.z;
      d.age += dt;
      d.vy += gravity * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const r = d.size * (2.6 + Math.random() * 3.6);
      if (world.solidAt(d.x, d.y, d.z)) {
        // flew into a block: find the face it came through, and mark that (a wall, a ceiling, or the top)
        if (!world.solidAt(px, d.y, d.z)) { const s = d.vx > 0 ? -1 : 1; this.splat((Math.floor(d.x / G) + (s > 0 ? 1 : 0)) * G + s * 0.012, d.y, d.z, r, s, 0, 0); }
        else if (!world.solidAt(d.x, d.y, pz)) { const s = d.vz > 0 ? -1 : 1; this.splat(d.x, d.y, (Math.floor(d.z / G) + (s > 0 ? 1 : 0)) * G + s * 0.012, r, 0, 0, s); }
        else if (d.vy > 0) this.splat(d.x, Math.floor(d.y / G) * G - 0.012, d.z, r, 0, -1, 0);
        else this.splat(d.x, world.groundAt(d.x, py + 0.02, d.z) + 0.012 + Math.random() * 0.004, d.z, r);
      } else if (d.vy < 0 && d.y <= world.groundAt(d.x, d.y, d.z) + d.size / 2) this.splat(d.x, world.groundAt(d.x, d.y, d.z) + 0.012 + Math.random() * 0.004, d.z, r);      // landed
      else if (d.age < 4) alive.push(d);
    }
    this.drops = alive;
    let n = 0;
    for (const d of this.drops) {
      this._m.compose(this._p.set(d.x, d.y, d.z), this._q.identity(), this._s.setScalar(d.size));
      this.dropMesh.setMatrixAt(n++, this._m);
    }
    this.dropMesh.count = n; this.dropMesh.instanceMatrix.needsUpdate = true;

    // splats: only the ones that are spreading, running or drying away need redrawing
    let changed = false;
    for (let i = 0; i < this.maxSplats; i++) {
      const s = this.splats[i];
      if (!s) continue;
      const was = s.age;
      s.age += dt;
      if (s.age >= s.life) { this.splats[i] = null; this.splatMesh.setMatrixAt(i, this._zero); changed = true; continue; }
      const moving = was < 0.2 || (s.grow && was < s.seconds + 0.1) || (s.wall && was < 3) || s.life - s.age < 4;
      if (!moving) continue;
      changed = true;
      const r = s.grow ? s.r + (s.grow - s.r) * Math.min(1, s.age / s.seconds) ** 0.6 : s.r;
      const k = r * Math.min(1, s.age / 0.15) * Math.min(1, (s.life - s.age) / 4);         // spreads fast, dries away slowly
      if (s.wall) {
        // on a wall it runs: the top stays put and the bottom creeps down
        const run = 1 + 1.4 * Math.min(1, s.age / 3), n3 = this._bn.set(s.nx, 0, s.nz), up = this._bt.set(0, 1, 0), side = this._bx.crossVectors(n3, up);
        this._m.makeBasis(side, n3, up).scale(this._s.set(k * 0.8, 1, k * run)).setPosition(s.x, s.y - k * (run - 1), s.z);
      } else {
        this._q.setFromAxisAngle(this._bt.set(0, 1, 0), s.a);
        if (s.ny < 0) this._q.premultiply(UPSIDE_DOWN);     // a ceiling: face down
        this._m.compose(this._p.set(s.x, s.y, s.z), this._q, this._s.set(k, 1, k * 0.8));
      }
      this.splatMesh.setMatrixAt(i, this._m);
    }
    if (changed) this.splatMesh.instanceMatrix.needsUpdate = true;

    // chunks: they bounce, leave a mark or two, and then lie there
    n = 0;
    const kept = [];
    for (const b of this.bitsList) {
      b.age += dt;
      if (b.age >= b.life) continue;
      kept.push(b);
      if (!b.rest) {
        b.vy += gravity * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.rx += b.spin * dt; b.ry += b.spin * 0.7 * dt;
        const g = world.groundAt(b.x, b.y + 0.3, b.z);
        if (b.y < g + b.sy && b.vy < 0) {
          b.y = g + b.sy;
          if (b.trail > 0 && b.color !== MEAT.bone) { b.trail -= 0.5; this.splat(b.x, g + 0.012 + Math.random() * 0.004, b.z, b.sx * (1.5 + Math.random() * 2)); }
          if (Math.abs(b.vy) < 1 && Math.hypot(b.vx, b.vz) < 0.5) b.rest = true;
          b.vy = -b.vy * 0.3; b.vx *= 0.55; b.vz *= 0.55; b.spin *= 0.5;
        }
      }
      const k = Math.min(1, (b.life - b.age) / 2);
      this._m.compose(this._p.set(b.x, b.y, b.z), this._q.setFromEuler(this._e.set(b.rx, b.ry, 0)), this._s.set(b.sx * k, b.sy * k, b.sz * k));
      this.bitMesh.setMatrixAt(n, this._m);
      this.bitMesh.setColorAt(n, this._c.setHex(b.color));
      n++;
    }
    this.bitsList = kept;
    this.bitMesh.count = n; this.bitMesh.instanceMatrix.needsUpdate = true;
    if (this.bitMesh.instanceColor) this.bitMesh.instanceColor.needsUpdate = true;
  }

  /** How much there is about: { drops, splats, bits }. */
  count() { return { drops: this.drops.length, splats: this.splats.reduce((n, s) => n + (s ? 1 : 0), 0), bits: this.bitsList.length }; }

  clear() {
    this.drops = []; this.bitsList = [];
    for (let i = 0; i < this.maxSplats; i++) { if (this.splats[i]) this.splatMesh.setMatrixAt(i, this._zero); this.splats[i] = null; }
    this.splatMesh.instanceMatrix.needsUpdate = true;
  }
}
