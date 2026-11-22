// Finding the way. The map is cut into half-metre squares; for each one we work out
// whether a body can be there and how high its floor is. A "field" then gives, for every
// square at once, how far it is from the nearest of some targets, so that any number of
// bots can ask "which way from here?" for almost nothing.
//
// It knows one floor per square (the lowest one a body fits on), which suits maps that
// are walked on the ground. Bots get up and down small steps; they do not plan routes
// over rooftops.
import * as THREE from 'three';

const FAR = 0xffff;
const STEP_UP = 0.55, DROP = 2.5;      // how far up a bot will hop between squares, and how far down it will let itself fall
// the eight neighbours: [di, dk, cost]. Costs 2 and 3 stand for 1 and about 1.41.
const NEIGH = [[1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2], [1, 1, 3], [1, -1, 3], [-1, 1, 3], [-1, -1, 3]];
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DK = [0, 0, 1, -1, 1, -1, 1, -1], COST = [2, 2, 2, 2, 3, 3, 3, 3];

export class Nav {
  /** @param world the physics World (its voxels and its fixed boxes) */
  constructor(world, { cell = 0.5, half = 35 } = {}) {
    this.world = world;
    this.cell = cell;
    this.half = half;
    this.n = Math.ceil(half * 2 / cell);
    const N = this.n * this.n;
    this.open = new Uint8Array(N);       // 1: a body can be here
    this.floor = new Float32Array(N);    // how high its floor is
    this.shut = new Uint8Array(N);       // 1: closed off for now (a door)
    this.edge = new Uint8Array(N);       // 1: right beside a wall (bots keep off these when they can, so as not to scrape along)
    this.turn = 1;                       // set by dir(): how straight the way goes on past where it pointed (1 straight .. -1 doubling back)
    this._path = new Int32Array(16);
    this.version = 0;                    // goes up whenever the map or the doors change
    this._queue = [0, 1, 2, 3, 4, 5, 6, 7].map(() => []);
  }

  index(x, z) {
    const i = Math.floor((x + this.half) / this.cell), k = Math.floor((z + this.half) / this.cell);
    return i < 0 || k < 0 || i >= this.n || k >= this.n ? -1 : i + this.n * k;
  }
  /** The middle of a square, on its floor. */
  pos(c, out = new THREE.Vector3()) {
    return out.set((c % this.n + 0.5) * this.cell - this.half, this.floor[c], (Math.floor(c / this.n) + 0.5) * this.cell - this.half);
  }

  /** Work the whole map out again (after it is built, or when it has been knocked about). */
  build() {
    const v = this.world.voxels, n = this.n, c = this.cell, R = 0.2;
    const solid = (x, y, z) => !!v && v.solidAt(x, y, z);
    // does a body standing on a floor at height y fit here?
    const fits = (x, y, z) => {
      for (let h = 0.125; h < 1; h += 0.25) {
        if (solid(x, y + h, z) || solid(x - R, y + h, z - R) || solid(x + R, y + h, z - R) || solid(x - R, y + h, z + R) || solid(x + R, y + h, z + R)) return false;
      }
      return true;
    };
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * c - this.half, z = (k + 0.5) * c - this.half, at = i + n * k;
      this.open[at] = 0; this.floor[at] = 0;
      for (let y = 0; y <= 3; y += 0.25) {
        if (y > 0 && !solid(x, y - 0.125, z)) continue;       // nothing to stand on at this height
        if (!fits(x, y, z)) continue;
        this.open[at] = 1; this.floor[at] = y;
        break;
      }
    }
    // fixed boxes that are not blocks: border walls, panels and so on
    for (const b of this.world.statics) {
      if (b.nav === false || b.max.y < 0.05 || b.min.y > 1) continue;
      this._each(b.min, b.max, 0.2, at => { this.open[at] = 0; });
    }
    // which squares are right beside something solid
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const at = i + n * k;
      let beside = 0;
      if (this.open[at]) for (let j = 0; j < 8 && !beside; j++) {
        const ni = i + DI[j], nk = k + DK[j];
        if (ni < 0 || nk < 0 || ni >= n || nk >= n) continue;
        const nb = ni + n * nk;
        if (!this.open[nb] || Math.abs(this.floor[nb] - this.floor[at]) > STEP_UP) beside = 1;
      }
      this.edge[at] = beside;
    }
    this.version++;
  }

  // every square a box covers (grown by `pad` metres)
  _each(min, max, pad, fn) {
    const n = this.n, c = this.cell;
    const i0 = Math.max(0, Math.floor((min.x - pad + this.half) / c)), i1 = Math.min(n - 1, Math.floor((max.x + pad + this.half) / c));
    const k0 = Math.max(0, Math.floor((min.z - pad + this.half) / c)), k1 = Math.min(n - 1, Math.floor((max.z + pad + this.half) / c));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) fn(i + n * k);
  }

  /** Shut or open the squares a box covers (a door closing or opening). */
  block(min, max, shut = true) {
    this._each(min, max, 0, at => { this.shut[at] = shut ? 1 : 0; });
    this.version++;
  }

  ok(c) { return c >= 0 && this.open[c] === 1 && this.shut[c] === 0; }
  /** Can a body go straight from square a to its neighbour b? */
  _edge(a, b) {
    const up = this.floor[b] - this.floor[a];
    return up <= STEP_UP && up >= -DROP;
  }

  /** The nearest square a body can be in to (x, z), within `reach` metres, or -1. */
  nearest(x, z, reach = 3) {
    const c0 = this.index(x, z);
    if (this.ok(c0)) return c0;
    const n = this.n, i0 = Math.floor((x + this.half) / this.cell), k0 = Math.floor((z + this.half) / this.cell), R = Math.ceil(reach / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= R && best < 0; r++) {
      for (let k = k0 - r; k <= k0 + r; k++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(k - k0)) !== r || i < 0 || k < 0 || i >= n || k >= n) continue;
        const c = i + n * k;
        if (!this.ok(c)) continue;
        const d = (i - i0) ** 2 + (k - k0) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }

  /**
   * How far every square is from the nearest of these places ([{x, z}, ...]), going round
   * walls. Returns a Uint16Array of costs (2 per square straight, 3 diagonally; 0xffff where
   * there is no way), to use with dir() and reach().
   */
  field(targets, out = new Uint16Array(this.n * this.n)) {
    out.fill(FAR);
    const n = this.n, q = this._queue;
    for (const b of q) b.length = 0;
    const seed = c => { if (out[c] !== 0) { out[c] = 0; q[0].push(c); } };
    for (const t of targets) {
      const c = this.nearest(t.x, t.z, 4);
      if (c < 0) continue;
      seed(c);
      // Up on a table or a ledge? Then being just below it is as good as there: the squares close
      // by that are lower down count too (whoever gets that far can reach up, or jump).
      const i = c % n, k = (c - i) / n;
      for (let dk = -3; dk <= 3; dk++) for (let di = -3; di <= 3; di++) {
        const ni = i + di, nk = k + dk;
        if (ni < 0 || nk < 0 || ni >= n || nk >= n) continue;
        const nb = ni + n * nk;
        if (this.ok(nb) && this.floor[nb] < this.floor[c] - 0.3) seed(nb);
      }
    }
    // Dial's algorithm: with whole-number costs no bigger than 5, eight buckets taken in turn are a priority queue.
    // (Written out flat, with no helpers: this runs over thousands of squares several times a second.)
    const open = this.open, shut = this.shut, floor = this.floor, edge = this.edge;
    let left = q[0].length, d = 0;
    while (left > 0) {
      const bucket = q[d & 7], len = bucket.length;
      for (let h = 0; h < len; h++) {
        const c = bucket[h];
        if (out[c] !== d) continue;
        const i = c % n, k = (c - i) / n, fc = floor[c];
        for (let j = 0; j < 8; j++) {
          const di = DI[j], dk = DK[j], ni = i + di, nk = k + dk;
          if (ni < 0 || nk < 0 || ni >= n || nk >= n) continue;
          const nb = ni + n * nk;
          if (open[nb] !== 1 || shut[nb] !== 0) continue;
          const nd = d + COST[j] + edge[nb] * 2;            // a square beside a wall counts as further, so the way keeps off walls
          if (out[nb] <= nd) continue;
          const up = fc - floor[nb];                       // stepping from that square onto this one
          if (up > STEP_UP || up < -DROP) continue;
          if (j > 3) {
            // no cutting corners: both squares beside a diagonal step must be free too
            const s1 = ni + n * k, s2 = i + n * nk;
            if (open[s1] !== 1 || shut[s1] !== 0 || open[s2] !== 1 || shut[s2] !== 0) continue;
          }
          out[nb] = nd; q[nd & 7].push(nb); left++;
        }
      }
      left -= len;
      bucket.length = 0;
      d++;
    }
    return out;
  }

  /** Metres of walking from (x, z) to the nearest target of a field, or Infinity. */
  reach(field, x, z) {
    const c = this.nearest(x, z, 2);
    return c < 0 || field[c] === FAR ? Infinity : field[c] * this.cell / 2;
  }

  /** Is the straight line between two points all walkable, with no step too high? */
  clear(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let prev = this.index(x0, z0);
    if (!this.ok(prev)) return false;
    for (let s = 1; s <= steps; s++) {
      const c = this.index(x0 + (x1 - x0) * s / steps, z0 + (z1 - z0) * s / steps);
      if (c === prev) continue;
      if (!this.ok(c) || !this._edge(prev, c)) return false;
      prev = c;
    }
    return true;
  }

  /**
   * Which way to go from (x, z) to get nearer the field's targets: writes a unit vector
   * (on the level) to `out` and returns the square being headed for, or -1 if there is no
   * way. It looks a few squares ahead and cuts the corner when the way is clear, so bots
   * do not zigzag from square to square.
   */
  dir(field, x, z, out, ahead = 6) {
    let c = this.nearest(x, z, 2);
    this.turn = 1;
    if (c < 0 || field[c] === FAR) return -1;
    const n = this.n, path = this._path, total = ahead + 4;
    // follow the way downhill for a few squares
    let len = 0;
    for (; len < total && field[c] > 0; len++) {
      const i = c % n, k = (c - i) / n;
      let best = -1, bd = field[c];
      for (let j = 0; j < 8; j++) {
        const ni = i + DI[j], nk = k + DK[j];
        if (ni < 0 || nk < 0 || ni >= n || nk >= n) continue;
        const nb = ni + n * nk;
        if (field[nb] >= bd || !this._edge(c, nb)) continue;
        if (j > 3 && (!this.ok(ni + n * k) || !this.ok(i + n * nk))) continue;
        bd = field[nb]; best = nb;
      }
      if (best < 0) break;
      path[len] = c = best;
    }
    if (!len) { out.set(0, 0, 0); return this.nearest(x, z, 2); }
    // head for the furthest of the first few that can be seen in a straight line
    const px = c2 => (c2 % n + 0.5) * this.cell - this.half, pz = c2 => (Math.floor(c2 / n) + 0.5) * this.cell - this.half;
    let at = 0;
    for (let s = 1; s < Math.min(len, ahead); s++) { if (this.clear(x, z, px(path[s]), pz(path[s]))) at = s; else break; }
    const aim = path[at], ax = px(aim) - x, az = pz(aim) - z, al = Math.hypot(ax, az);
    if (al < 1e-4) out.set(0, 0, 0); else out.set(ax / al, 0, az / al);
    // and how sharply does the way turn after that?
    const on = path[Math.min(at + 4, len - 1)];
    if (on !== aim && al > 1e-4) {
      const bx = px(on) - px(aim), bz = pz(on) - pz(aim), bl = Math.hypot(bx, bz);
      if (bl > 1e-4) this.turn = (ax * bx + az * bz) / (al * bl);
    }
    return aim;
  }

  /** A random walkable place within `r` metres of (x, z) that can be walked to, or null. */
  wander(x, z, r, random = Math.random) {
    for (let tries = 0; tries < 12; tries++) {
      const a = random() * Math.PI * 2, d = r * (0.3 + 0.7 * random());
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, c = this.index(px, pz);
      if (this.ok(c)) return this.pos(c);
    }
    return null;
  }
}
