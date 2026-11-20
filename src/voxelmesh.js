// Draws the voxel world: one mesh per 8 m chunk, rebuilt when its blocks change.
// Flat areas are merged into big rectangles, every material comes from one array
// texture (so a chunk is a single draw call), and faces with something overhead are
// drawn darker, which makes rooms and caves look shaded inside.
import * as THREE from 'three';
import { VOXEL, MATERIALS } from './voxels.js';
import { textureArray } from './textures.js';

export const RCHUNK = 32;   // chunk size in blocks

// brightness by which way a face points: [-x, +x], [-y, +y], [-z, +z]
const FACE_SHADE = [[0.84, 0.88], [0.55, 1.0], [0.74, 0.78]];
const SHADED = 0.38;        // multiplier for faces with a roof over them
const LIT = 128;

export class VoxelRenderer {
  constructor(scene, voxels) {
    this.scene = scene;
    this.v = voxels;
    this.ncx = Math.ceil(voxels.nx / RCHUNK); this.ncy = Math.ceil(voxels.ny / RCHUNK); this.ncz = Math.ceil(voxels.nz / RCHUNK);
    this.meshes = new Map();
    this.dirty = new Set();
    this.mask = new Uint8Array(RCHUNK * RCHUNK);
    this.tints = MATERIALS.map(m => (m ? new THREE.Color(m.tint) : new THREE.Color(1, 1, 1)));

    const tex = textureArray(MATERIALS.slice(1).map(m => m.tex));
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = shader => {
      shader.uniforms.voxMap = { value: tex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float layer;\nvarying vec3 vVox;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVox = vec3(uv, layer);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray voxMap;\nvarying vec3 vVox;')
        .replace('#include <map_fragment>', 'diffuseColor *= texture(voxMap, vVox);');
    };
    voxels.onDirty = (i0, j0, k0, i1, j1, k1) => this.markRange(i0, j0, k0, i1, j1, k1);
  }

  /** Blocks in this index range changed: queue the chunks that need redrawing. */
  markRange(i0, j0, k0, i1, j1, k1) {
    // one block of margin: a neighbouring chunk's faces show when a border block goes.
    // Every chunk above and below is included too, because shading depends on what is overhead.
    const x0 = Math.max(0, Math.floor((i0 - 1) / RCHUNK)), x1 = Math.min(this.ncx - 1, Math.floor(i1 / RCHUNK));
    const z0 = Math.max(0, Math.floor((k0 - 1) / RCHUNK)), z1 = Math.min(this.ncz - 1, Math.floor(k1 / RCHUNK));
    for (let cy = 0; cy < this.ncy; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++)
      this.dirty.add(cx + this.ncx * (cz + this.ncz * cy));
  }

  /** Redraw up to `budget` queued chunks (nearest to `near` first). Returns how many were done. */
  update(budget = 2, near = null) {
    if (!this.dirty.size) return 0;
    let list = [...this.dirty];
    if (near && list.length > budget) {
      const s = RCHUNK * VOXEL, d = c => {
        const cx = c % this.ncx, cz = Math.floor(c / this.ncx) % this.ncz;
        return Math.abs((cx + 0.5) * s + this.v.ox - near.x) + Math.abs((cz + 0.5) * s + this.v.oz - near.z);
      };
      list.sort((a, b) => d(a) - d(b));
    }
    list = list.slice(0, budget);
    for (const c of list) { this.dirty.delete(c); this._rebuild(c); }
    return list.length;
  }

  rebuildAll() { while (this.dirty.size) this.update(64); }

  _rebuild(ci) {
    const v = this.v, { nx, ny, nz, data, top } = v;
    const cx = ci % this.ncx, cz = Math.floor(ci / this.ncx) % this.ncz, cy = Math.floor(ci / (this.ncx * this.ncz));
    const lo = [cx * RCHUNK, cy * RCHUNK, cz * RCHUNK];
    const hi = [Math.min(lo[0] + RCHUNK, nx), Math.min(lo[1] + RCHUNK, ny), Math.min(lo[2] + RCHUNK, nz)];
    const dims = [nx, ny, nz], org = [v.ox, v.oy, v.oz];
    const pos = [], nrm = [], uv = [], col = [], lay = [], index = [];
    const mask = this.mask, p = [0, 0, 0], q = [0, 0, 0];
    const at = (x, y, z) => data[x + nx * (z + nz * y)] & 0x7f;

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, w = (d + 2) % 3, su = hi[u] - lo[u], sw = hi[w] - lo[w];
      for (let side = 0; side < 2; side++) {
        const dir = side ? 1 : -1;
        for (let s = lo[d]; s < hi[d]; s++) {
          // which faces of this slice are visible, and what they look like
          let any = false;
          p[d] = s;
          for (let b = 0; b < sw; b++) for (let a = 0; a < su; a++) {
            p[u] = lo[u] + a; p[w] = lo[w] + b;
            let key = 0;
            const m = at(p[0], p[1], p[2]);
            if (m) {
              q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[d] += dir;
              const out = q[d] < 0 || q[d] >= dims[d];
              if (out || !at(q[0], q[1], q[2])) {
                const open = q[0] < 0 || q[2] < 0 || q[0] >= nx || q[2] >= nz || q[1] >= top[q[0] + nx * q[2]];
                key = m | (open ? LIT : 0);
                any = true;
              }
            }
            mask[a + b * su] = key;
          }
          if (!any) continue;
          // merge equal neighbours into rectangles
          for (let b = 0; b < sw; b++) for (let a = 0; a < su; a++) {
            const key = mask[a + b * su];
            if (!key) continue;
            let w2 = 1, h2 = 1;
            while (a + w2 < su && mask[a + w2 + b * su] === key) w2++;
            grow: while (b + h2 < sw) {
              for (let e = 0; e < w2; e++) if (mask[a + e + (b + h2) * su] !== key) break grow;
              h2++;
            }
            for (let f = 0; f < h2; f++) for (let e = 0; e < w2; e++) mask[a + e + (b + f) * su] = 0;

            const mat = key & 0x7f, M = MATERIALS[mat], tint = this.tints[mat];
            const shade = FACE_SHADE[d][side] * (key & LIT ? 1 : SHADED);
            const plane = org[d] + (s + side) * VOXEL;
            const u0 = org[u] + (lo[u] + a) * VOXEL, u1 = u0 + w2 * VOXEL, w0 = org[w] + (lo[w] + b) * VOXEL, w1 = w0 + h2 * VOXEL;
            const base = pos.length / 3;
            const corners = side ? [[u0, w0], [u1, w0], [u1, w1], [u0, w1]] : [[u0, w0], [u0, w1], [u1, w1], [u1, w0]];
            for (const [cu, cw] of corners) {
              const P = [0, 0, 0]; P[d] = plane; P[u] = cu; P[w] = cw;
              pos.push(P[0], P[1], P[2]);
              nrm.push(d === 0 ? dir : 0, d === 1 ? dir : 0, d === 2 ? dir : 0);
              // texture follows world position, so it keeps its scale on every face
              if (d === 0) uv.push(P[2] / M.tile, P[1] / M.tile);
              else if (d === 1) uv.push(P[0] / M.tile, P[2] / M.tile);
              else uv.push(P[0] / M.tile, P[1] / M.tile);
              col.push(tint.r * shade, tint.g * shade, tint.b * shade);
              lay.push(mat);
            }
            index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }

    let mesh = this.meshes.get(ci);
    if (!pos.length) {
      if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(ci); }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('layer', new THREE.Float32BufferAttribute(lay, 1));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
    else { mesh = new THREE.Mesh(geo, this.material); this.scene.add(mesh); this.meshes.set(ci, mesh); }
  }

  /** Totals for checking performance. */
  stats() {
    let tris = 0;
    for (const m of this.meshes.values()) tris += m.geometry.index.count / 3;
    return { chunks: this.meshes.size, triangles: tris };
  }
}
