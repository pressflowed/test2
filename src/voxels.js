// The destructible world: a grid of 25 cm blocks.
//
// Everything you can break lives here (the floor and the border walls do not).
// - carve() scoops a rough ball of blocks out; anything left with no path down to
//   the ground crumbles too.
// - For collisions the grid is cut into 4 m cells, and each cell keeps a short list
//   of boxes that exactly cover its solid blocks (rebuilt when the cell changes).
// - Every operation is deterministic, so players who apply the same carves end up
//   with the same world. Carves can even arrive in a different order.
import * as THREE from 'three';

export const VOXEL = 0.25;   // block size in metres
export const CELL = 16;      // collision cell size in blocks (4 m)

// tex: texture name, tile: metres per texture repeat, hard: dent size multiplier
// (bigger = breaks more easily), kind: tap sound, color: debris colour
export const MATERIALS = [
  null,
  { name: 'grass', tex: 'grass', tile: 2.2, tint: 0xc4dcb6, hard: 1.25, kind: 'grass', color: 0x5a8f3c },
  { name: 'wood', tex: 'wood', tile: 1.6, tint: 0xffffff, hard: 1.0, kind: 'wood', color: 0x6f4a2c },
  { name: 'plank', tex: 'plank', tile: 1.5, tint: 0xffffff, hard: 1.0, kind: 'plank', color: 0xb98a52 },
  { name: 'rock', tex: 'rock', tile: 3, tint: 0xffffff, hard: 0.8, kind: 'rock', color: 0x8b918a },
  { name: 'stone', tex: 'stone', tile: 2.4, tint: 0xffffff, hard: 0.7, kind: 'stone', color: 0x6a716c },
  { name: 'leaf', tex: 'leaf', tile: 2, tint: 0xffffff, hard: 1.6, kind: 'leaf', color: 0x35803a },
  { name: 'crate', tex: 'crate', tile: 1.25, tint: 0xffffff, hard: 1.0, kind: 'crate', color: 0xb5814a },
  { name: 'brick', tex: 'brick', tile: 1.5, tint: 0xffffff, hard: 0.75, kind: 'stone', color: 0x9a4a38 },
  { name: 'roof', tex: 'roof', tile: 1.5, tint: 0xffffff, hard: 0.9, kind: 'rock', color: 0x7a3b30 },
  { name: 'hay', tex: 'hay', tile: 1.5, tint: 0xffffff, hard: 1.6, kind: 'leaf', color: 0xd9b44a },
  { name: 'plaster', tex: 'plaster', tile: 2, tint: 0xffffff, hard: 0.9, kind: 'stone', color: 0xe6dcc4 },
  { name: 'dirt', tex: 'dirt', tile: 2, tint: 0xffffff, hard: 1.3, kind: 'grass', color: 0x7a5a3a },
];
export const MAT = { air: 0 };
MATERIALS.forEach((m, i) => { if (m) MAT[m.name] = i; });

const ANCHOR = 0x80;   // flag on blocks that were built floating: they hold themselves up
const ID = 0x7f;

// A repeatable 0..1 number per block, for rough dent edges.
function hash(i, j, k) {
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class VoxelWorld {
  constructor(nx = 288, ny = 64, nz = 288, ox = -36, oy = 0, oz = -36) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.ox = ox; this.oy = oy; this.oz = oz;
    this.layer = nx * nz;
    this.data = new Uint8Array(nx * ny * nz);
    this.pristine = null;                      // the map as built, for quick resets
    this.top = new Uint8Array(nx * nz);        // per column: index of the highest block + 1
    this.pristineTop = null;
    this.marks = new Uint8Array(nx * ny * nz); // scratch for connectivity searches
    this.ncx = Math.ceil(nx / CELL); this.ncy = Math.ceil(ny / CELL); this.ncz = Math.ceil(nz / CELL);
    this.cells = [];
    for (let cy = 0; cy < this.ncy; cy++) for (let cz = 0; cz < this.ncz; cz++) for (let cx = 0; cx < this.ncx; cx++)
      this.cells.push({ index: this.cells.length, cx, cy, cz, boxes: [] });
    this.touched = new Set();                  // cells changed since the map was built
    this.onCells = () => {};                   // (cells) their collision boxes were rebuilt
    this.onDirty = () => {};                   // (i0, j0, k0, i1, j1, k1) blocks in this range changed
    this._vis = new Uint8Array(CELL * CELL * CELL);
  }

  // ---- building a map
  clear() { this.data.fill(0); this.top.fill(0); this.pristine = null; this.touched.clear(); }

  idx(i, j, k) { return i + this.nx * (k + this.nz * j); }
  inside(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz; }
  get(i, j, k) { return this.inside(i, j, k) ? this.data[this.idx(i, j, k)] & ID : 0; }

  /** Fill a block-index range [i0, i1) x [j0, j1) x [k0, k1) with a material (0 = air). */
  fillVox(i0, j0, k0, i1, j1, k1, m) {
    i0 = Math.max(i0, 0); j0 = Math.max(j0, 0); k0 = Math.max(k0, 0);
    i1 = Math.min(i1, this.nx); j1 = Math.min(j1, this.ny); k1 = Math.min(k1, this.nz);
    if (i1 <= i0) return;
    for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) {
      const s = this.idx(i0, j, k);
      this.data.fill(m, s, s + (i1 - i0));
    }
  }

  // world metres -> block index range, at least one block thick
  _range(a, b, o) {
    const i0 = Math.round((a - o) / VOXEL);
    let i1 = Math.round((b - o) / VOXEL);
    if (i1 <= i0) i1 = i0 + 1;
    return [i0, i1];
  }

  /** Fill a box given in world metres. `mat` is a material name or id; 'air' clears. */
  fill(x0, y0, z0, x1, y1, z1, mat) {
    const m = typeof mat === 'string' ? MAT[mat] : mat;
    const [i0, i1] = this._range(x0, x1, this.ox), [j0, j1] = this._range(y0, y1, this.oy), [k0, k1] = this._range(z0, z1, this.oz);
    this.fillVox(i0, j0, k0, i1, j1, k1, m);
  }

  /** Box by centre x/z, bottom y and size, like the old level boxes. */
  box(cx, by, cz, w, h, d, mat) { this.fill(cx - w / 2, by, cz - d / 2, cx + w / 2, by + h, cz + d / 2, mat); }

  /** A hollow box: walls `t` metres thick. `open` can leave the top or bottom off. */
  shell(x0, y0, z0, x1, y1, z1, mat, t = 0.25, open = {}) {
    this.fill(x0, y0, z0, x1, y1, z1, mat);
    this.fill(x0 + t, open.bottom ? y0 : y0 + t, z0 + t, x1 - t, open.top ? y1 : y1 - t, z1 - t, 'air');
  }

  /** A ball of material (or air). */
  ball(cx, cy, cz, r, mat, squashY = 1) {
    const m = typeof mat === 'string' ? MAT[mat] : mat;
    const fx = (cx - this.ox) / VOXEL, fy = (cy - this.oy) / VOXEL, fz = (cz - this.oz) / VOXEL, rv = r / VOXEL;
    for (let j = Math.max(0, Math.floor(fy - rv * squashY)); j < Math.min(this.ny, Math.ceil(fy + rv * squashY)); j++)
      for (let k = Math.max(0, Math.floor(fz - rv)); k < Math.min(this.nz, Math.ceil(fz + rv)); k++)
        for (let i = Math.max(0, Math.floor(fx - rv)); i < Math.min(this.nx, Math.ceil(fx + rv)); i++) {
          const dx = i + 0.5 - fx, dy = (j + 0.5 - fy) / squashY, dz = k + 0.5 - fz;
          if (dx * dx + dy * dy + dz * dz < rv * rv) this.data[this.idx(i, j, k)] = m;
        }
  }

  /** Call once after building: works out heights, floating pieces and collision boxes. */
  finalize() {
    const { nx, ny, nz, data, layer } = this;
    for (let i = 0; i < data.length; i++) data[i] &= ID;
    // anything not connected to the ground was built floating on purpose: it holds itself up
    const marks = this.marks;
    let solids = 0;
    for (let i = 0; i < data.length; i++) if (data[i]) solids++;
    const queue = new Int32Array(solids);
    let head = 0, tail = 0;
    for (let i = 0; i < layer; i++) if (data[i]) { marks[i] = 1; queue[tail++] = i; }
    const visit = n => { if (data[n] && !marks[n]) { marks[n] = 1; queue[tail++] = n; } };
    while (head < tail) {
      const v = queue[head++], i = v % nx, k = Math.floor(v / nx) % nz, j = Math.floor(v / layer);
      if (i > 0) visit(v - 1); if (i < nx - 1) visit(v + 1);
      if (k > 0) visit(v - nx); if (k < nz - 1) visit(v + nx);
      if (j > 0) visit(v - layer); if (j < ny - 1) visit(v + layer);
    }
    for (let i = 0; i < data.length; i++) if (data[i] && !marks[i]) data[i] |= ANCHOR;
    marks.fill(0);
    this._allTops();
    this.pristine = data.slice();
    this.pristineTop = this.top.slice();
    this.touched.clear();
    for (const c of this.cells) this._buildCell(c);
    this.onCells(this.cells);
    this.onDirty(0, 0, 0, nx, ny, nz);
  }

  /** Put the map back the way it was built. */
  reset() {
    if (!this.pristine) return;
    this.data.set(this.pristine);
    this.top.set(this.pristineTop);
    const cells = [...this.touched].map(i => this.cells[i]);
    this.touched.clear();
    for (const c of cells) this._buildCell(c);
    this.onCells(cells);
    for (const c of cells) this.onDirty(c.cx * CELL, c.cy * CELL, c.cz * CELL, (c.cx + 1) * CELL, (c.cy + 1) * CELL, (c.cz + 1) * CELL);
  }

  _allTops() {
    const { nx, ny, nz, data, layer, top } = this;
    top.fill(0);
    for (let j = ny - 1; j >= 0; j--) {
      const base = j * layer;
      for (let c = 0; c < layer; c++) if (!top[c] && data[base + c]) top[c] = j + 1;
    }
  }

  // ---- questions about the world (world metres)
  matAt(x, y, z) {
    return this.get(Math.floor((x - this.ox) / VOXEL), Math.floor((y - this.oy) / VOXEL), Math.floor((z - this.oz) / VOXEL));
  }
  solidAt(x, y, z) { return this.matAt(x, y, z) !== 0; }

  /** Height of the highest surface at or below y in this column, or -Infinity. */
  groundBelow(x, y, z) {
    const i = Math.floor((x - this.ox) / VOXEL), k = Math.floor((z - this.oz) / VOXEL);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return -Infinity;
    let j = Math.min(Math.floor((y - this.oy) / VOXEL), this.top[i + this.nx * k] - 1);
    for (; j >= 0; j--) if (this.data[this.idx(i, j, k)]) return this.oy + (j + 1) * VOXEL;
    return -Infinity;
  }

  /** Collision boxes of every cell that a sphere at p with radius r could touch. */
  near(p, r, out) {
    const s = CELL * VOXEL;
    const x0 = Math.max(0, Math.floor((p.x - r - this.ox) / s)), x1 = Math.min(this.ncx - 1, Math.floor((p.x + r - this.ox) / s));
    const y0 = Math.max(0, Math.floor((p.y - r - this.oy) / s)), y1 = Math.min(this.ncy - 1, Math.floor((p.y + r - this.oy) / s));
    const z0 = Math.max(0, Math.floor((p.z - r - this.oz) / s)), z1 = Math.min(this.ncz - 1, Math.floor((p.z + r - this.oz) / s));
    for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const boxes = this.cells[cx + this.ncx * (cz + this.ncz * cy)].boxes;
      for (let b = 0; b < boxes.length; b++) out.push(boxes[b]);
    }
    return out;
  }

  /** First block hit along a ray: { point, normal, mat } or null. dir must be normalised. */
  raycast(o, dir, maxDist) {
    let i = Math.floor((o.x - this.ox) / VOXEL), j = Math.floor((o.y - this.oy) / VOXEL), k = Math.floor((o.z - this.oz) / VOXEL);
    const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)];
    const d = [dir.x, dir.y, dir.z], pos = [(o.x - this.ox) / VOXEL, (o.y - this.oy) / VOXEL, (o.z - this.oz) / VOXEL], cell = [i, j, k];
    const tMax = [0, 0, 0], tDelta = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      if (d[a] === 0) { tMax[a] = Infinity; tDelta[a] = Infinity; continue; }
      const edge = step[a] > 0 ? cell[a] + 1 : cell[a];
      tMax[a] = (edge - pos[a]) / d[a];
      tDelta[a] = Math.abs(1 / d[a]);
    }
    let t = 0, axis = -1;
    const limit = maxDist / VOXEL;
    while (t <= limit) {
      const m = this.get(cell[0], cell[1], cell[2]);
      if (m) {
        const normal = new THREE.Vector3();
        if (axis >= 0) normal.setComponent(axis, -step[axis]); else normal.copy(dir).negate();
        return { point: new THREE.Vector3(o.x + dir.x * t * VOXEL, o.y + dir.y * t * VOXEL, o.z + dir.z * t * VOXEL), normal, mat: m };
      }
      axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[axis];
      tMax[axis] += tDelta[axis];
      cell[axis] += step[axis];
    }
    return null;
  }

  // ---- collision boxes
  // Cover a cell's solid blocks with as few boxes as a simple greedy merge finds.
  _buildCell(cell) {
    for (const b of cell.boxes) b.dead = true;   // anything still holding an old box lets go
    const boxes = cell.boxes = [];
    const { data, nx, nz } = this, vis = this._vis;
    const x0 = cell.cx * CELL, y0 = cell.cy * CELL, z0 = cell.cz * CELL;
    const x1 = Math.min(x0 + CELL, this.nx), y1 = Math.min(y0 + CELL, this.ny), z1 = Math.min(z0 + CELL, this.nz);
    vis.fill(0);
    const V = (i, j, k) => (i - x0) + CELL * ((k - z0) + CELL * (j - y0));
    const at = (i, j, k) => data[i + nx * (k + nz * j)] & ID;
    for (let j = y0; j < y1; j++) for (let k = z0; k < z1; k++) for (let i = x0; i < x1; i++) {
      const m = at(i, j, k);
      if (!m || vis[V(i, j, k)]) continue;
      let w = 1, d = 1, h = 1;
      while (i + w < x1 && at(i + w, j, k) === m && !vis[V(i + w, j, k)]) w++;
      grow: while (k + d < z1) {
        for (let a = 0; a < w; a++) if (at(i + a, j, k + d) !== m || vis[V(i + a, j, k + d)]) break grow;
        d++;
      }
      rise: while (j + h < y1) {
        for (let c = 0; c < d; c++) for (let a = 0; a < w; a++) if (at(i + a, j + h, k + c) !== m || vis[V(i + a, j + h, k + c)]) break rise;
        h++;
      }
      for (let b = 0; b < h; b++) for (let c = 0; c < d; c++) for (let a = 0; a < w; a++) vis[V(i + a, j + b, k + c)] = 1;
      boxes.push({
        min: new THREE.Vector3(this.ox + i * VOXEL, this.oy + j * VOXEL, this.oz + k * VOXEL),
        max: new THREE.Vector3(this.ox + (i + w) * VOXEL, this.oy + (j + h) * VOXEL, this.oz + (k + d) * VOXEL),
        kind: MATERIALS[m].kind, mat: m, voxel: true, dead: false,
      });
    }
  }

  // ---- destruction
  /**
   * Scoop out a rough ball at a world position. Returns null if nothing broke, else
   * { count, collapsed, samples: [[x, y, z, mat], ...] } where samples are a few of the
   * broken blocks (for debris).
   */
  carve(wx, wy, wz, r) {
    const { nx, ny, nz, data, layer } = this;
    const fx = (wx - this.ox) / VOXEL, fy = (wy - this.oy) / VOXEL, fz = (wz - this.oz) / VOXEL, rv = r / VOXEL;
    const reach = rv * 1.2;
    const i0 = Math.max(0, Math.floor(fx - reach)), i1 = Math.min(nx - 1, Math.floor(fx + reach));
    const j0 = Math.max(0, Math.floor(fy - reach)), j1 = Math.min(ny - 1, Math.floor(fy + reach));
    const k0 = Math.max(0, Math.floor(fz - reach)), k1 = Math.min(nz - 1, Math.floor(fz + reach));
    const removed = [];
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const v = i + nx * (k + nz * j);
      if (!data[v]) continue;
      const dx = i + 0.5 - fx, dy = j + 0.5 - fy, dz = k + 0.5 - fz;
      const rr = rv * (0.82 + 0.36 * hash(i, j, k));     // ragged edge, the same for everyone
      if (dx * dx + dy * dy + dz * dz < rr * rr) removed.push(v);
    }
    if (!removed.length) return null;
    const samples = [];
    const sample = (v, every) => {
      if (samples.length < 60 && hash(v, every, 7) < 1 / every)
        samples.push([this.ox + (v % nx + 0.5) * VOXEL, this.oy + (Math.floor(v / layer) + 0.5) * VOXEL, this.oz + (Math.floor(v / nx) % nz + 0.5) * VOXEL, data[v] & ID]);
    };
    const every = Math.max(1, Math.floor(removed.length / 14));
    for (const v of removed) sample(v, every);
    for (const v of removed) data[v] = 0;
    const fallen = this._collapse(removed);
    const everyFallen = Math.max(1, Math.floor(fallen.length / 40));
    for (const v of fallen) { sample(v, everyFallen); data[v] = 0; }
    this._changed(removed, fallen);
    return { count: removed.length, collapsed: fallen.length, samples };
  }

  // After blocks were removed, find blocks that no longer connect to the ground.
  _collapse(removed) {
    const { nx, ny, nz, data, layer, marks } = this;
    const seen = [], fallen = [], stack = [];
    const nb = [0, 0, 0, 0, 0, 0];
    for (const r of removed) {
      const ri = r % nx, rk = Math.floor(r / nx) % nz, rj = Math.floor(r / layer);
      let n = 0;
      if (rj < ny - 1) nb[n++] = r + layer;
      if (ri > 0) nb[n++] = r - 1; if (ri < nx - 1) nb[n++] = r + 1;
      if (rk > 0) nb[n++] = r - nx; if (rk < nz - 1) nb[n++] = r + nx;
      if (rj > 0) nb[n++] = r - layer;
      for (let q = 0; q < n; q++) {
        const start = nb[q];
        if (!data[start] || marks[start]) continue;
        // search this piece, heading downward first: most things reach the ground in a few steps
        const first = seen.length;
        let supported = false;
        marks[start] = 1; seen.push(start);
        stack.length = 0; stack.push(start);
        search: while (stack.length) {
          const v = stack.pop();
          const j = Math.floor(v / layer);
          if (j === 0 || (data[v] & ANCHOR)) { supported = true; break; }
          const i = v % nx, k = Math.floor(v / nx) % nz;
          // pushed in this order so that "down" is tried first
          for (let side = 0; side < 6; side++) {
            let w;
            if (side === 0) { if (j >= ny - 1) continue; w = v + layer; }
            else if (side === 1) { if (i <= 0) continue; w = v - 1; }
            else if (side === 2) { if (i >= nx - 1) continue; w = v + 1; }
            else if (side === 3) { if (k <= 0) continue; w = v - nx; }
            else if (side === 4) { if (k >= nz - 1) continue; w = v + nx; }
            else { w = v - layer; }
            if (!data[w]) continue;
            const mk = marks[w];
            if (mk === 2) { supported = true; break search; }   // joins a piece already known to stand
            if (mk) continue;
            marks[w] = 1; seen.push(w); stack.push(w);
          }
        }
        if (supported) for (let s = first; s < seen.length; s++) marks[seen[s]] = 2;
        else for (let s = first; s < seen.length; s++) { marks[seen[s]] = 3; fallen.push(seen[s]); }
      }
    }
    for (const v of seen) marks[v] = 0;
    return fallen;
  }

  // Bookkeeping after blocks changed: heights, collision boxes, and what needs redrawing.
  _changed(removed, fallen) {
    const { nx, nz, layer, data, top } = this;
    const cells = new Set();
    let i0 = Infinity, j0 = Infinity, k0 = Infinity, i1 = -1, j1 = -1, k1 = -1;
    const note = v => {
      const i = v % nx, k = Math.floor(v / nx) % nz, j = Math.floor(v / layer);
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
      cells.add(Math.floor(i / CELL) + this.ncx * (Math.floor(k / CELL) + this.ncz * Math.floor(j / CELL)));
      const c = i + nx * k;
      if (top[c] === j + 1) { let t = j; while (t > 0 && !data[c + (t - 1) * layer]) t--; top[c] = t; }
    };
    for (const v of removed) note(v);
    for (const v of fallen) note(v);
    const list = [];
    for (const ci of cells) { this.touched.add(ci); const c = this.cells[ci]; this._buildCell(c); list.push(c); }
    this.onCells(list);
    this.onDirty(i0, j0, k0, i1 + 1, j1 + 1, k1 + 1);
  }

  /** How many solid blocks there are (for tests). */
  count() { let n = 0; for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++; return n; }
}
