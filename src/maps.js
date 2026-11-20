// The two maps, built out of voxels. Each build(v) fills a VoxelWorld; the floor and
// the border walls are added separately and cannot be broken.
//
// Sizes are in metres. Blocks are 0.25 m, so numbers here are mostly multiples of 0.25.
//
// Hide and seek is built for players of two sizes: hiders are about 0.25 m tall and
// fit through any gap of 0.5 m; the giant is about 2 m tall and 0.9 m wide.

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// ------------------------------------------------------------------ sandbox
function buildSandbox(v) {
  const box = (cx, by, cz, w, h, d, m) => v.box(cx, by, cz, w, h, d, m);

  // centre: the original test course
  for (let i = 0; i < 5; i++) box(-6, 0, -1 - i * 1.2, 3, 0.35 * (i + 1), 1.2, 'wood');  // stairs
  box(-6, 0, -8.2, 3, 1.75, 3.2, 'wood');                                               // deck
  box(0, 0, -3.2, 2, 0.9, 2, 'plank');                                                  // gap jump
  box(0, 0, -7.2, 2, 1.2, 2, 'plank');
  box(4.5, 0, -5, 1, 5, 1, 'rock');                                                     // pillar
  box(4.5, 5, -5, 1.8, 0.2, 1.8, 'plank');
  box(8.6, 0, 1, 2.8, 3.4, 4, 'rock');                                                  // climbing wall
  box(6.95, 1.6, 1, 0.5, 0.2, 3, 'plank');
  box(4, 0, 4, 0.4, 2.6, 0.4, 'wood');                                                  // posts
  box(5.6, 0, 2.6, 0.4, 2.6, 0.4, 'wood');
  box(4, 0, 1.2, 0.4, 2.6, 0.4, 'wood');
  box(-8.6, 0, 4.5, 0.3, 1.2, 3.2, 'wood');                                             // tunnel
  box(-6.9, 0, 4.5, 0.3, 1.2, 3.2, 'wood');
  box(-7.75, 1.2, 4.5, 2.0, 0.2, 3.2, 'plank');

  // north-east: tall trees with decks and bridges
  for (const [x, z] of [[18, -18], [28, -18], [18, -28], [28, -28]]) {
    box(x, 0, z, 1.3, 14, 1.3, 'wood');
    box(x, 13.4, z, 6, 2.4, 6, 'leaf');
    box(x, 4, z, 4, 0.3, 4, 'plank');
    box(x, 8, z, 3.4, 0.3, 3.4, 'plank');
    box(x, 11.5, z, 3, 0.3, 3, 'plank');
  }
  box(23, 8, -18, 6.6, 0.25, 1.2, 'plank');
  box(23, 8, -28, 6.6, 0.25, 1.2, 'plank');
  box(18, 11.5, -23, 1.2, 0.25, 7, 'plank');
  for (let i = 0; i < 4; i++) box(10.5 + i * 1.5, 0, -18, 1.2, 1 + i * 0.9, 1.2, 'crate');

  // north-west: a tower with ledges spiralling up
  const tx = -24, tz = -24;
  box(tx, 0, tz, 5, 14, 5, 'stone');
  box(tx, 14, tz, 7.5, 0.4, 7.5, 'plank');
  const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let k = 0; k < 7; k++) {
    const [sx, sz] = sides[k % 4], y = 1.4 + k * 1.8;
    if (sx) box(tx + sx * 3.2, y, tz, 1.4, 0.3, 4.2, 'plank');
    else box(tx, y, tz + sz * 3.2, 4.2, 0.3, 1.4, 'plank');
  }

  // south-east: posts to climb, then floating stepping stones up to a high perch
  for (let i = 0; i < 5; i++) box(15 + i * 2.6, 0, 16, 1, 1 + i, 1, 'wood');
  for (let i = 0; i < 8; i++) box(15 + i * 2.2, 1.2 + i * 0.9, 22 + i * 1.1, 2, 0.3, 2, 'plank');
  box(32, 0, 32.5, 3, 8.5, 3, 'rock');

  // south-west: a terraced hill
  for (const [w, h] of [[16, 1.2], [12, 2.4], [8, 3.6], [4.5, 4.8], [2, 6]]) box(-24, 0, 24, w, h, w, 'grass');

  // south: a channel between two walls, for pushing off side to side
  box(-3.2, 0, 24, 0.8, 4, 16, 'rock');
  box(3.2, 0, 24, 0.8, 4, 16, 'rock');

  // east: tall blocks with gaps to leap across
  [15, 19.5, 24.5, 30].forEach((x, i) => box(x, 0, 0, 2.6, 2.5 + i * 0.5, 2.6, 'rock'));

  // west: a field of crates and boulders (fixed layout)
  const rnd = rng(7);
  for (let i = 0; i < 18; i++) {
    const w = 1 + rnd() * 2.2, h = 0.6 + rnd() * 2.6;
    box(-15 - rnd() * 17, 0, -9 + rnd() * 18, w, h, 1 + rnd() * 2.2, rnd() < 0.5 ? 'crate' : 'rock');
  }

  // north wall: an uneven cliff to climb
  for (let i = 0; i < 9; i++) box(-12 + i * 3, 0, -33.5, 3, 3 + ((i * 5) % 7), 2 + (i % 3) * 0.6, 'rock');
}

// ------------------------------------------------------------------ hide and seek: "Hollow Hamlet"

// A timber house: brick footing, plaster walls, a tiled roof with an attic, a chimney you
// can climb inside, and furniture to hide under. (x0, z0) is the corner; door is 'n' or 's'.
function house(v, x0, z0, w, d, door = 's', flip = false) {
  const H = 2.75, T = 0.5, x1 = x0 + w, z1 = z0 + d;
  v.shell(x0, 0, z0, x1, H, z1, 'plaster', T, { top: true, bottom: true });
  v.fill(x0, 0, z0, x1, 0.5, z1, 'brick');
  v.fill(x0 + T, 0, z0 + T, x1 - T, 0.5, z1 - T, 'air');
  for (const cx of [x0, x1 - T]) for (const cz of [z0, z1 - T]) v.fill(cx, 0, cz, cx + T, H, cz + T, 'wood');
  v.fill(x0 + T, 0, z0 + T, x1 - T, 0.25, z1 - T, 'plank');                 // floor
  v.fill(x0, H, z0, x1, H + 0.25, z1, 'plank');                              // attic floor

  // roof: steps up to a ridge along x, hollow inside
  for (let s = 0; ; s++) {
    const y = H + 0.25 + s * 0.25, za = z0 - 0.25 + s * 0.25, zb = z1 + 0.25 - s * 0.25;
    if (zb - za <= 0.01) break;
    v.fill(x0 - 0.25, y, za, x1 + 0.25, y + 0.25, zb, 'roof');
    if (zb - za > 1.01) {
      v.fill(x0 + T, y, za + 0.5, x1 - T, y + 0.25, zb - 0.5, 'air');
      v.fill(x0, y, za + 0.5, x0 + T, y + 0.25, zb - 0.5, 'plaster');       // gable ends
      v.fill(x1 - T, y, za + 0.5, x1, y + 0.25, zb - 0.5, 'plaster');
    }
  }
  const ridge = H + 0.25 + Math.ceil((d + 0.5) / 0.5) * 0.25;

  // door, with a little window either side, and windows on the other walls
  const dz = door === 's' ? z1 - T : z0, dx = x0 + (flip ? w - 2.5 : 1.5);
  v.fill(dx, 0.25, dz, dx + 1, 2.0, dz + T, 'air');
  const wz = door === 's' ? z0 : z1 - T;
  for (let x = x0 + 1.25; x + 0.75 <= x1 - 1.25; x += 2) v.fill(x, 1.0, wz, x + 0.75, 1.75, wz + T, 'air');
  const wx = flip ? x1 - T : x0;
  v.fill(wx, 1.0, z0 + d / 2 - 0.5, wx + T, 1.75, z0 + d / 2 + 0.25, 'air');
  v.fill(x0 + w / 2 - 0.25, H + 1, z0 - 0.25, x0 + w / 2 + 0.25, H + 1.5, z1 + 0.25, 'air');   // a small skylight in each roof slope

  // chimney in a back corner: hollow all the way up, open at the fireplace
  const cx = flip ? x0 + T : x1 - T - 1, cz = door === 's' ? z0 + T : z1 - T - 1;
  v.fill(cx, 0, cz, cx + 1, ridge + 0.75, cz + 1, 'brick');
  v.fill(cx + 0.25, 0.25, cz + 0.25, cx + 0.75, ridge + 0.75, cz + 0.75, 'air');
  const fz = door === 's' ? cz + 0.75 : cz;
  v.fill(cx + 0.25, 0.25, fz, cx + 0.75, 0.75, fz + 0.25, 'air');

  // attic hatch above a stack of crates you can hop up
  const hx = flip ? x1 - T - 1 : x0 + T + 0.25, hz = door === 's' ? z0 + T + 0.25 : z1 - T - 1;
  v.fill(hx, H, hz, hx + 0.75, H + 0.25, hz + 0.75, 'air');
  v.fill(hx, 0.25, hz, hx + 0.75, 1.0, hz + 0.75, 'crate');
  v.fill(hx + (flip ? -0.75 : 0.75), 0.25, hz, hx + (flip ? 0 : 1.5), 0.5, hz + 0.75, 'crate');
  v.fill(hx, 1.0, hz, hx + 0.5, 1.75, hz + 0.5, 'crate');

  // bed: you can get underneath
  const bx = flip ? x0 + T + 0.25 : x1 - T - 1.5, bz = door === 's' ? z1 - T - 2.25 : z0 + T + 0.25;
  v.fill(bx, 0.75, bz, bx + 1.25, 1.0, bz + 2, 'plank');
  v.fill(bx, 1.0, bz, bx + 1.25, 1.25, bz + 2, 'hay');
  for (const lx of [bx, bx + 1]) for (const lz of [bz, bz + 1.75]) v.fill(lx, 0.25, lz, lx + 0.25, 0.75, lz + 0.25, 'wood');
  v.fill(bx, 1.25, bz + (door === 's' ? 1.75 : 0), bx + 1.25, 1.75, bz + (door === 's' ? 2 : 0.25), 'plank');   // headboard

  // table in the middle
  const tx = x0 + w / 2 - 0.75, tz = z0 + d / 2 - 0.5;
  v.fill(tx, 1.0, tz, tx + 1.5, 1.25, tz + 1, 'plank');
  for (const lx of [tx, tx + 1.25]) for (const lz of [tz, tz + 0.75]) v.fill(lx, 0.25, lz, lx + 0.25, 1.0, lz + 0.25, 'wood');
  v.fill(tx + 0.5, 0.25, tz - 0.5, tx + 1, 0.75, tz - 0.25, 'plank');   // stool

  // wardrobe: hollow, with a gap at the bottom of the door
  if (w >= 6) {
    const ax = x0 + w / 2 - 0.5, az = door === 's' ? z0 + T : z1 - T - 0.75;
    v.shell(ax, 0.25, az, ax + 1, 2.25, az + 0.75, 'plank', 0.25);
    const front = door === 's' ? az + 0.5 : az;
    v.fill(ax + 0.25, 0.5, front, ax + 0.75, 1.0, front + 0.25, 'air');
  }
}

// A hedge maze: narrow lanes only a hider fits down, with leafy arches to hide under.
function maze(v, x0, z0, cells, seed) {
  const P = 1.25, WALL = 0.5, LANE = 0.75, Hh = 2.25, r = rng(seed);
  const size = cells * P + WALL;
  v.fill(x0, 0, z0, x0 + size, Hh, z0 + size, 'leaf');
  const lane = (cx, cz) => [x0 + WALL + cx * P, z0 + WALL + cz * P];
  const seen = new Uint8Array(cells * cells), stack = [[Math.floor(cells / 2), 0]];
  seen[stack[0][0]] = 1;
  const open = (ax, az, bx, bz) => {
    const [x, z] = lane(Math.min(ax, bx), Math.min(az, bz));
    if (ax !== bx) v.fill(x + LANE, 0, z, x + P, Hh, z + LANE, 'air'); else v.fill(x, 0, z + LANE, x + LANE, Hh, z + P, 'air');
  };
  for (let cz = 0; cz < cells; cz++) for (let cx = 0; cx < cells; cx++) { const [x, z] = lane(cx, cz); v.fill(x, 0, z, x + LANE, Hh, z + LANE, 'air'); }
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cx + dx, cz + dz]).filter(([a, b]) => a >= 0 && b >= 0 && a < cells && b < cells && !seen[a + b * cells]);
    if (!opts.length) { stack.pop(); continue; }
    const [nx, nz] = opts[Math.floor(r() * opts.length)];
    seen[nx + nz * cells] = 1;
    open(cx, cz, nx, nz);
    stack.push([nx, nz]);
  }
  // some extra gaps so there is more than one way round, and leafy arches over some lanes
  for (let n = 0; n < cells * cells * 0.14; n++) {
    const cx = Math.floor(r() * (cells - 1)), cz = Math.floor(r() * (cells - 1));
    if (r() < 0.5) open(cx, cz, cx + 1, cz); else open(cx, cz, cx, cz + 1);
  }
  for (let cz = 0; cz < cells; cz++) for (let cx = 0; cx < cells; cx++) {
    if (r() < 0.3) { const [x, z] = lane(cx, cz); v.fill(x - 0.25, 1.5, z - 0.25, x + LANE + 0.25, Hh, z + LANE + 0.25, 'leaf'); }
  }
  // ways in on every side
  const mid = Math.floor(cells / 2);
  for (const c of [2, mid, cells - 3]) {
    let [x, z] = lane(c, 0); v.fill(x, 0, z0, x + LANE, Hh, z, 'air');
    [x, z] = lane(c, cells - 1); v.fill(x, 0, z + LANE, x + LANE, Hh, z0 + size, 'air');
    [x, z] = lane(0, c); v.fill(x0, 0, z, x, Hh, z + LANE, 'air');
    [x, z] = lane(cells - 1, c); v.fill(x + LANE, 0, z, x0 + size, Hh, z + LANE, 'air');
  }
  // a clearing in the middle with a little pavilion
  const [mx, mz] = lane(mid - 1, mid - 1), cs = 3 * P - WALL;
  v.fill(mx, 0, mz, mx + cs, Hh, mz + cs, 'air');
  for (const px of [mx + 0.25, mx + cs - 0.5]) for (const pz of [mz + 0.25, mz + cs - 0.5]) v.fill(px, 0, pz, px + 0.25, 1.75, pz + 0.25, 'wood');
  v.fill(mx, 1.75, mz, mx + cs, 2.0, mz + cs, 'roof');
  v.fill(mx + 0.75, 2.0, mz + 0.75, mx + cs - 0.75, 2.25, mz + cs - 0.75, 'roof');
  v.fill(mx + 1, 0, mz + 1, mx + cs - 1, 0.5, mz + cs - 1, 'stone');           // bench block
  v.fill(mx + 1.25, 0, mz + 1.25, mx + cs - 1.25, 0.25, mz + cs - 1.25, 'air'); // ...hollow underneath
  v.fill(mx + 1, 0, mz + 1.5, mx + 1.25, 0.25, mz + 2, 'air');
}

// A rocky hill riddled with tunnels and chambers that only hiders fit into.
function caveHill(v, cx, cz, R, seed) {
  const r = rng(seed);
  v.ball(cx, 0, cz, R, 'rock', 0.62);
  v.ball(cx - 1, R * 0.5, cz + 1, R * 0.45, 'grass', 0.5);
  v.ball(cx + 3, R * 0.35, cz - 3, R * 0.3, 'grass', 0.5);
  const worm = (x, y, z, a, len, rad, climb = 0) => {
    for (let s = 0; s < len / 0.3; s++) {
      v.ball(x, y, z, rad, 'air');
      a += (r() - 0.5) * 0.55;
      x += Math.cos(a) * 0.3; z += Math.sin(a) * 0.3;
      y = Math.min(Math.max(y + climb * 0.3 + (r() - 0.5) * 0.1, 0.5), R * 0.5);
    }
    return [x, y, z];
  };
  // six ways in around the edge, each winding toward the middle
  const ends = [];
  for (let n = 0; n < 6; n++) {
    const a = n / 6 * Math.PI * 2 + 0.3;
    ends.push(worm(cx + Math.cos(a) * (R + 0.3), 0.55, cz + Math.sin(a) * (R + 0.3), a + Math.PI, R * 1.05, 0.5, n % 2 ? 0.12 : 0));
  }
  // chambers where tunnels end, a big one in the middle, and a chimney up to the top
  for (const [x, y, z] of ends) v.ball(x, y + 0.2, z, 1.2, 'air', 0.75);
  v.ball(cx, 1.0, cz, 2.0, 'air', 0.6);
  for (let y = 1.2; y < R * 0.62 + 0.5; y += 0.25) v.ball(cx + Math.sin(y * 1.3) * 0.5, y, cz + Math.cos(y * 1.3) * 0.5, 0.45, 'air');
  // a ring tunnel linking everything, higher up
  for (let a = 0; a < Math.PI * 2; a += 0.06) v.ball(cx + Math.cos(a) * R * 0.45, 2.3 + Math.sin(a * 3) * 0.4, cz + Math.sin(a) * R * 0.45, 0.42, 'air');
  // stalagmites in the main chamber to duck behind
  for (let n = 0; n < 5; n++) { const a = r() * 6.28, d = r() * 1.3; v.fill(cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d, cx + Math.cos(a) * d + 0.25, 0.5 + r() * 0.5, cz + Math.sin(a) * d + 0.25, 'rock'); }
}

// A hollow log lying on the ground: a tunnel for hiders. Runs along x or z.
function logTube(v, x, y, z, len, alongX, S = 1.25) {
  const [w, d] = alongX ? [len, S] : [S, len];
  v.fill(x, y, z, x + w, y + S, z + d, 'wood');
  if (alongX) v.fill(x, y + 0.25, z + 0.25, x + w, y + S - 0.25, z + d - 0.25, 'air');
  else v.fill(x + 0.25, y + 0.25, z, x + w - 0.25, y + S - 0.25, z + d, 'air');
}

function buildHideSeek(v) {
  const r = rng(2024);
  const fill = (...a) => v.fill(...a);

  // ---- the plaza: a fountain and market stalls
  v.ball(0, 0, 0, 2.5, 'stone', 0.3);
  v.ball(0, 0.25, 0, 2.0, 'air', 0.3);
  fill(-0.5, 0, -0.5, 0.5, 2.25, 0.5, 'stone');
  fill(-1, 2.25, -1, 1, 2.5, 1, 'stone');
  fill(-0.25, 0, -0.25, 0.25, 2.0, 0.25, 'air');            // the column is hollow
  fill(-0.25, 0, 0.25, 0.25, 0.5, 0.5, 'air');              // ...with a way in at the bottom
  const stall = (x, z, roofMat) => {
    for (const px of [x, x + 2.75]) for (const pz of [z, z + 1.75]) fill(px, 0, pz, px + 0.25, 2.25, pz + 0.25, 'wood');
    fill(x - 0.25, 2.25, z - 0.25, x + 3.25, 2.5, z + 2.25, roofMat);
    fill(x, 0.75, z, x + 3, 1.0, z + 0.75, 'plank');                               // counter
    fill(x, 0, z, x + 3, 0.75, z + 0.25, 'plank');                                 // front panel
    fill(x + 1.25, 0, z, x + 1.75, 0.5, z + 0.25, 'air');                          // mouse hole
    fill(x + 0.5, 0, z + 1.0, x + 1.25, 0.75, z + 1.75, 'crate');
    fill(x + 1.5, 0, z + 1.0, x + 2.0, 0.5, z + 1.5, 'crate');
    fill(x + 2.25, 0, z + 0.5, x + 2.75, 1.25, z + 1.0, 'wood');                   // barrel
  };
  stall(-9, -6.5, 'hay'); stall(6, -6.5, 'roof'); stall(-9, 5, 'roof'); stall(6, 5, 'hay');
  // a cart
  fill(3.5, 0.5, 9, 6.5, 0.75, 10.75, 'plank'); fill(3.5, 0.75, 9, 6.5, 1.5, 9.25, 'plank'); fill(3.5, 0.75, 10.5, 6.5, 1.5, 10.75, 'plank');
  fill(3.5, 0.75, 9, 3.75, 1.5, 10.75, 'plank'); fill(4, 0.75, 9.25, 6, 1.25, 10.5, 'hay');
  for (const wx of [3.75, 5.75]) for (const wz of [8.75, 10.75]) fill(wx, 0, wz, wx + 0.75, 0.75, wz + 0.25, 'wood');

  // ---- north-west: the village
  house(v, -31, -31, 7, 5.5, 's');
  house(v, -21, -32, 6, 5, 's', true);
  house(v, -32, -21, 6, 5, 's', true);
  house(v, -22.5, -22, 7.5, 5.5, 'n');
  house(v, -13, -24, 5.5, 5, 's');
  // low garden walls and a well
  fill(-33, 0, -14.5, -19, 0.75, -14, 'stone'); fill(-25.5, 0, -14.5, -24, 0.75, -14, 'air');
  fill(-14.5, 0, -33, -14, 0.75, -26, 'stone');
  v.shell(-17.5, 0, -17.5, -15.5, 1.0, -15.5, 'stone', 0.5, { top: true, bottom: true });
  for (const px of [-17.5, -15.75]) fill(px, 1.0, -16.75, px + 0.25, 2.5, -16.5, 'wood');
  fill(-17.75, 2.5, -17.5, -15.25, 2.75, -15.5, 'roof');
  fill(-17.25, 0, -17.5, -16.75, 0.5, -17, 'air');          // a gap at the foot of the well

  // ---- north: the brick clock tower, with a floor every 3 m
  {
    const x0 = -3, z0 = -30, x1 = 3, z1 = -24, top = 11.5;
    v.shell(x0, 0, z0, x1, top, z1, 'brick', 0.75, { top: true, bottom: true });
    for (let y = 3; y < top; y += 3) {
      fill(x0 + 0.75, y, z0 + 0.75, x1 - 0.75, y + 0.25, z1 - 0.75, 'plank');
      const hole = (y / 3) % 2 ? x0 + 0.75 : x1 - 1.75;
      fill(hole, y, z0 + 0.75, hole + 1, y + 0.25, z0 + 1.75, 'air');
      // crate steps under each hole
      const base = y - 3 + (y > 3 ? 0.25 : 0);
      for (let s = 0; s < 4; s++) fill(hole + (hole < 0 ? 0 : 0.25), base, z0 + 1.75 + s * 0.75, hole + 0.75 + (hole < 0 ? 0 : 0.25), y - 3 + 2.25 - s * 0.5, z0 + 2.5 + s * 0.75, 'crate');
      for (const wx of [x0, x1 - 0.75]) fill(wx, y - 1.75, -27.25, wx + 0.75, y - 0.75, -26.75, 'air');   // slit windows
    }
    fill(x0 - 0.5, top, z0 - 0.5, x1 + 0.5, top + 0.25, z1 + 0.5, 'stone');
    for (let s = 0; s < 7; s++) fill(x0 - 0.25 + s * 0.5, top + 0.25 + s * 0.5, z0 - 0.25 + s * 0.5, x1 + 0.25 - s * 0.5, top + 0.75 + s * 0.5, z1 + 0.25 - s * 0.5, 'roof');
    fill(-0.5, 0, z1 - 0.75, 0.5, 1.75, z1, 'air');                                 // door
    fill(-0.75, 9.5, z1 - 0.25, 0.75, 11, z1, 'plaster');                           // clock face
  }
  house(v, 5.5, -31, 6, 5, 's');

  // ---- north-east: the castle
  {
    const x0 = 13, z0 = -34, x1 = 34, z1 = -13, Hw = 4.5;
    fill(x0, 0, z0, x1, Hw, z1, 'stone');
    fill(x0 + 1, 0, z0 + 1, x1 - 1, Hw, z1 - 1, 'air');
    // battlements
    for (let p = x0; p < x1; p += 1) {
      fill(p, Hw, z0, p + 0.5, Hw + 0.5, z0 + 0.25, 'stone'); fill(p, Hw, z1 - 0.25, p + 0.5, Hw + 0.5, z1, 'stone');
      fill(x0, Hw, p - x0 + z0, x0 + 0.25, Hw + 0.5, p - x0 + z0 + 0.5, 'stone'); fill(x1 - 0.25, Hw, p - x0 + z0, x1, Hw + 0.5, p - x0 + z0 + 0.5, 'stone');
    }
    fill(x0, 0, -25, x0 + 1, 3.25, -22, 'air');                                      // the gate, facing the plaza
    for (let p = z0 + 3; p < z1 - 2; p += 4) { fill(x1 - 1, 1.25, p, x1, 2.5, p + 0.25, 'air'); fill(p - z0 + x0, 1.25, z0, p - z0 + x0 + 0.25, 2.5, z0 + 1, 'air'); }   // arrow slits
    // corner towers: hollow, with floors and ladders of blocks
    for (const [tx, tz] of [[x0 - 1, z0 - 1], [x1 - 3.5, z0 - 1], [x0 - 1, z1 - 3.5], [x1 - 3.5, z1 - 3.5]]) {
      const ax = Math.max(tx, -35.75), az = Math.max(tz, -35.75);
      v.shell(ax, 0, az, tx + 4.5, 8, tz + 4.5, 'stone', 0.75, { top: true, bottom: true });
      for (const y of [2.75, 5.5]) { fill(ax + 0.75, y, az + 0.75, tx + 3.75, y + 0.25, tz + 3.75, 'plank'); fill(ax + 0.75, y, az + 0.75, ax + 1.5, y + 0.25, az + 1.5, 'air'); }
      for (let s = 0; s < 3; s++) for (const y of [0, 2.75, 5.5]) fill(ax + 0.75, y + (y ? 0.25 : 0), az + 1.5 + s * 0.5, ax + 1.25, y + 2.0 - s * 0.5, az + 2.0 + s * 0.5, 'crate');
      fill(tx + 4.5 - 0.75, 0, tz + 1.75, tx + 4.5, 1.25, tz + 2.5, 'air');        // little door into the yard or out
      fill(tx + 1.75, 0, tz + 4.5 - 0.75, tx + 2.5, 1.25, tz + 4.5, 'air');
      for (let p = 0; p < 4.5; p += 1) { fill(tx + p, 8, tz, tx + p + 0.5, 8.5, tz + 0.25, 'stone'); fill(tx + p, 8, tz + 4.25, tx + p + 0.5, 8.5, tz + 4.5, 'stone'); }
      fill(ax, 7.75, az, tx + 4.5, 8, tz + 4.5, 'stone'); fill(ax + 1.5, 7.75, az + 1.5, ax + 2.25, 8, az + 2.25, 'air');
    }
    // the keep: three floors, a cellar-like store room, a hall with a long table
    const kx = 21, kz = -28, kw = 8, kh = 9;
    v.shell(kx, 0, kz, kx + kw, kh, kz + kw, 'stone', 0.75, { bottom: true });
    for (const y of [3, 6]) { fill(kx + 0.75, y, kz + 0.75, kx + kw - 0.75, y + 0.25, kz + kw - 0.75, 'plank'); fill(kx + kw - 2, y, kz + 0.75, kx + kw - 0.75, y + 0.25, kz + 2, 'air'); }
    for (const y of [0, 3, 6]) for (let s = 0; s < 4; s++) fill(kx + kw - 1.5, y + (y ? 0.25 : 0), kz + 2 + s * 0.75, kx + kw - 0.75, y + 2.5 - s * 0.6, kz + 2.75 + s * 0.75, 'crate');
    fill(kx + 3.5, 0, kz + kw - 0.75, kx + 4.5, 1.75, kz + kw, 'air');              // keep door
    for (const y of [1.5, 4.5, 7.5]) for (const p of [1.5, 4, 6.25]) { fill(kx, y, kz + p, kx + 0.75, y + 1, kz + p + 0.25, 'air'); fill(kx + p, y, kz, kx + p + 0.25, y + 1, kz + 0.75, 'air'); }
    fill(kx + 1.5, 1.0, kz + 3, kx + 5.5, 1.25, kz + 4.25, 'plank');                // hall table
    for (const lx of [kx + 1.5, kx + 5.25]) for (const lz of [kz + 3, kz + 4]) fill(lx, 0, lz, lx + 0.25, 1.0, lz + 0.25, 'wood');
    fill(kx + 0.75, 0, kz + 0.75, kx + 2.75, 1.5, kz + 1.5, 'crate'); fill(kx + 1.25, 0.25, kz + 0.75, kx + 2.25, 1.0, kz + 1.25, 'air');   // a crate fort
    fill(kx + 1, 3.25, kz + 1, kx + 3, 4.0, kz + 2.25, 'hay'); fill(kx + 1.25, 3.25, kz + 1.25, kx + 2.75, 3.75, kz + 2, 'air'); fill(kx + 1.75, 3.25, kz + 2, kx + 2.25, 3.75, kz + 2.25, 'air');
    for (let p = 0; p < kw; p += 1) for (const e of [0, kw - 0.25]) { fill(kx + p, kh, kz + e, kx + p + 0.5, kh + 0.5, kz + e + 0.25, 'stone'); fill(kx + e, kh, kz + p, kx + e + 0.25, kh + 0.5, kz + p + 0.5, 'stone'); }
    fill(kx + 1, kh - 0.75, kz + 1, kx + 1.75, kh, kz + 1.75, 'air');                // hatch to the roof
    // yard clutter
    fill(15, 0, -18, 17, 1.0, -16.5, 'hay'); fill(15.25, 0, -17.75, 16.75, 0.5, -16.75, 'air'); fill(15.75, 0, -16.75, 16.25, 0.5, -16.5, 'air');
    fill(30.5, 0, -17.5, 32.5, 0.75, -15.5, 'crate'); fill(31, 0.75, -17, 32, 1.5, -16, 'crate'); fill(30.75, 0, -16.25, 31.25, 0.5, -15.5, 'air');
    fill(16, 0, -31.5, 16.75, 1.25, -30.75, 'wood'); fill(17, 0, -31.5, 17.75, 1.25, -30.75, 'wood'); fill(16.5, 0, -30.5, 17.25, 1.25, -29.75, 'wood');
  }

  // ---- east: the great hollow tree
  {
    const tx = 25, tz = 2;
    fill(tx - 2.25, 0, tz - 2.25, tx + 2.25, 11, tz + 2.25, 'wood');
    fill(tx - 1.5, 0, tz - 1.5, tx + 1.5, 10.5, tz + 1.5, 'air');
    // roots
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let s = 0; s < 4; s++)
      fill(tx + dx * (2.25 + s * 0.5) - 0.5, 0, tz + dz * (2.25 + s * 0.5) - 0.5, tx + dx * (2.25 + s * 0.5) + 0.5, 1.25 - s * 0.25, tz + dz * (2.25 + s * 0.5) + 0.5, 'wood');
    // knot holes: two at the ground, one higher up
    fill(tx - 0.25, 0, tz + 1.5, tx + 0.5, 0.75, tz + 2.25, 'air'); fill(tx - 2.25, 0, tz - 0.5, tx - 1.5, 0.75, tz + 0.25, 'air');
    fill(tx + 1.5, 4.5, tz - 0.25, tx + 2.25, 5.5, tz + 0.5, 'air');
    // ledges spiralling up inside
    const ring = [[-1.5, -1.5, 1.5, 1], [0.5, -1.5, 1, 1.5], [0, 0.5, 1.5, 1], [-1.5, 0, 1, 1.5]];
    for (let s = 0; s < 12; s++) { const [ox, oz, w, d] = ring[s % 4], y = 0.75 + s * 0.75; fill(tx + ox, y, tz + oz, tx + ox + w, y + 0.25, tz + oz + d, 'plank'); }
    fill(tx - 1.5, 10.5, tz - 1.5, tx + 1.5, 11, tz + 1.5, 'wood'); fill(tx - 0.5, 10.5, tz - 0.5, tx + 0.25, 11, tz + 0.25, 'air');
    // the crown: leafy, with hollows to sit in
    v.ball(tx, 12.5, tz, 5.5, 'leaf', 0.55);
    v.ball(tx + 3.5, 11, tz - 2, 3, 'leaf', 0.6); v.ball(tx - 3, 11.2, tz + 2.5, 3.2, 'leaf', 0.6);
    v.ball(tx, 12.2, tz, 2.2, 'air', 0.55); v.ball(tx + 3.2, 11.2, tz - 1.8, 1.2, 'air', 0.7); v.ball(tx - 2.8, 11.4, tz + 2.3, 1.3, 'air', 0.7);
    for (let s = 0; s < 8; s++) { v.ball(tx + 0.5 + s * 0.4, 12 - s * 0.05, tz - 0.3 - s * 0.22, 0.45, 'air'); v.ball(tx - 0.5 - s * 0.35, 12, tz + 0.4 + s * 0.3, 0.45, 'air'); }
    // branches
    fill(tx + 2.25, 7, tz - 0.5, tx + 6, 7.75, tz + 0.25, 'wood'); v.ball(tx + 6.5, 7.8, tz, 1.8, 'leaf', 0.7); v.ball(tx + 6.5, 7.8, tz, 0.9, 'air', 0.7);
    fill(tx - 0.5, 6, tz - 6, tx + 0.25, 6.75, tz - 2.25, 'wood'); v.ball(tx, 6.8, tz - 6.5, 1.8, 'leaf', 0.7); v.ball(tx, 6.8, tz - 6.5, 0.9, 'air', 0.7);
  }

  // ---- south-east: cave hill
  caveHill(v, 23, 23, 10, 77);

  // ---- south: the barn
  {
    const x0 = -7, z0 = 16, x1 = 7, z1 = 27.5, Hb = 4.5;
    v.shell(x0, 0, z0, x1, Hb, z1, 'plank', 0.5, { top: true, bottom: true });
    for (let px = x0; px <= x1 - 0.5; px += 3.375) { fill(px, 0, z0, px + 0.5, Hb, z0 + 0.5, 'wood'); fill(px, 0, z1 - 0.5, px + 0.5, Hb, z1, 'wood'); }
    for (let s = 0; ; s++) {
      const y = Hb + s * 0.25, xa = x0 - 0.25 + s * 0.5, xb = x1 + 0.25 - s * 0.5;
      if (xb - xa <= 0.01) break;
      fill(xa, y, z0 - 0.25, xb, y + 0.25, z1 + 0.25, 'roof');
      if (xb - xa > 2.01) { fill(xa + 1, y, z0 + 0.5, xb - 1, y + 0.25, z1 - 0.5, 'air'); fill(xa + 1, y, z0, xb - 1, y + 0.25, z0 + 0.5, 'plank'); fill(xa + 1, y, z1 - 0.5, xb - 1, y + 0.25, z1, 'plank'); }
    }
    fill(-1.5, 0, z0, 1.5, 3.5, z0 + 0.5, 'air');                                    // the big door
    fill(-0.5, 5.25, z0, 0.5, 6.25, z0 + 0.5, 'air');                                // hay door up top
    fill(x0 + 0.5, 2.75, z0 + 5, x1 - 0.5, 3.0, z1 - 0.5, 'plank');                  // the loft
    fill(4, 2.75, z0 + 5, 5.5, 3.0, z0 + 6.5, 'air');
    for (let s = 0; s < 5; s++) fill(4.25, 0, z0 + 1.25 + s * 0.75, 5.25, 2.5 - (4 - s) * 0.5, z0 + 2.0 + s * 0.75, 'hay');   // hay steps up to the loft
    // stalls along one side
    for (let s = 0; s < 3; s++) { fill(x0 + 0.5, 0, z0 + 2 + s * 2.75, x0 + 3.5, 1.5, z0 + 2.25 + s * 2.75, 'plank'); fill(x0 + 2.5, 0, z0 + 2 + s * 2.75, x0 + 3, 0.5, z0 + 2.25 + s * 2.75, 'air'); }
    fill(x0 + 3.5, 0, z0 + 2, x0 + 3.75, 1.5, z0 + 7.75, 'plank'); fill(x0 + 3.5, 0, z0 + 3, x0 + 3.75, 1.0, z0 + 4, 'air'); fill(x0 + 3.5, 0, z0 + 5.75, x0 + 3.75, 1.0, z0 + 6.75, 'air');
    // hay stacks with burrows
    const hay = (x, y, z, w, h, d) => { fill(x, y, z, x + w, y + h, z + d, 'hay'); fill(x + 0.5, y, z + 0.5, x + w - 0.5, y + 0.75, z + d - 0.5, 'air'); fill(x + w / 2 - 0.25, y, z + d - 0.5, x + w / 2 + 0.25, y + 0.5, z + d, 'air'); };
    hay(x0 + 0.75, 0, z1 - 3.5, 3, 1.5, 2.75); hay(-2, 0, z1 - 3, 3.5, 2, 2.25); hay(2.5, 0, z1 - 3.25, 3.5, 1.25, 2.5);
    hay(-5.5, 3.0, z1 - 3.5, 3, 1.25, 2.5); hay(0.5, 3.0, z0 + 7, 3, 1.5, 2.5);
    fill(1.5, 0, z0 + 2, 2.5, 1.0, z0 + 3, 'crate'); fill(2.5, 0, z0 + 2, 3.25, 0.75, z0 + 2.75, 'crate'); fill(1.75, 1.0, z0 + 2.25, 2.25, 1.5, z0 + 2.75, 'crate');
  }

  // ---- south-west: the hedge maze
  maze(v, -34, 13, 16, 31);

  // ---- west: the lumber yard
  {
    logTube(v, -33, 0, -6, 9, true); logTube(v, -33, 0, -4.5, 9, true); logTube(v, -32.25, 1.25, -5.25, 7.5, true);
    logTube(v, -21, 0, -8, 8, false); logTube(v, -19.5, 0, -7, 6.5, false);
    logTube(v, -31, 0, 2, 10, true, 1.5);
    // plank piles: layers with gaps
    for (let s = 0; s < 5; s++) { const y = s * 0.5; if (s % 2) { fill(-26, y, 5.5, -22, y + 0.25, 6, 'plank'); fill(-26, y, 6.75, -22, y + 0.25, 7.25, 'plank'); fill(-26, y, 8, -22, y + 0.25, 8.5, 'plank'); } else { fill(-26, y, 5.5, -25.5, y + 0.25, 8.5, 'plank'); fill(-24.25, y, 5.5, -23.75, y + 0.25, 8.5, 'plank'); fill(-22.5, y, 5.5, -22, y + 0.25, 8.5, 'plank'); } }
    fill(-26, 2.5, 5.5, -22, 2.75, 8.5, 'plank');
    // the saw shed
    for (const px of [-17, -13.25]) for (const pz of [0.5, 4.25]) fill(px, 0, pz, px + 0.25, 2.5, pz + 0.25, 'wood');
    fill(-17.5, 2.5, 0, -12.5, 2.75, 5, 'roof'); fill(-17, 2.75, 0.5, -13, 3.0, 4.5, 'roof');
    fill(-17, 0, 0.5, -13, 2.0, 0.75, 'plank'); fill(-15.5, 0, 0.5, -14.75, 0.5, 0.75, 'air');
    fill(-16.5, 0.75, 2, -14, 1.0, 3.5, 'plank'); for (const lx of [-16.5, -14.25]) for (const lz of [2, 3.25]) fill(lx, 0, lz, lx + 0.25, 0.75, lz + 0.25, 'wood');
    fill(-16.75, 0, 0.75, -16, 1.5, 1.5, 'crate'); fill(-13.75, 0, 0.75, -13.25, 0.75, 1.25, 'crate');
    // stumps
    for (const [sx, sz] of [[-28, 9], [-30.5, 6.5], [-19, 9.5], [-24, -1.5]]) { fill(sx, 0, sz, sx + 1.25, 0.75, sz + 1.25, 'wood'); fill(sx + 0.25, 0, sz + 0.25, sx + 1, 0.5, sz + 1, 'air'); fill(sx + 0.5, 0, sz, sx + 0.75, 0.25, sz + 0.25, 'air'); }
  }

  // ---- loose cover everywhere else: bushes you can crawl into, boulders with crevices, crates
  const free = (x, z, rad) => {
    if (Math.hypot(x, z) < 6.5 || Math.abs(x) > 33.5 - rad || Math.abs(z) > 33.5 - rad) return false;
    for (let a = -rad; a <= rad; a += 0.5) for (let b = -rad; b <= rad; b += 0.5) for (const y of [0.1, 1.1, 2.6]) if (v.solidAt(x + a, y, z + b)) return false;
    return true;
  };
  let placed = 0;
  for (let n = 0; n < 900 && placed < 70; n++) {
    const x = Math.round((r() - 0.5) * 66 * 4) / 4, z = Math.round((r() - 0.5) * 66 * 4) / 4, kind = r();
    if (!free(x, z, 1.75)) continue;
    placed++;
    if (kind < 0.42) {                                   // bush with a hollow middle and a way in
      const rad = 0.9 + r() * 0.5;
      v.ball(x, 0.2, z, rad, 'leaf', 0.8); v.ball(x, 0.2, z, rad - 0.5, 'air', 0.8);
      const a = r() * 6.28; for (let s = 0; s < 6; s++) v.ball(x + Math.cos(a) * s * 0.25, 0.3, z + Math.sin(a) * s * 0.25, 0.3, 'air');
    } else if (kind < 0.7) {                             // boulder, sometimes split by a crevice
      const rad = 0.7 + r() * 0.7;
      v.ball(x, rad * 0.3, z, rad, 'rock', 0.75);
      if (r() < 0.6) fill(x - 0.125, 0, z - rad, x + 0.375, rad * 0.9, z + rad, 'air');
    } else if (kind < 0.88) {                            // crates, one of them open at the side
      fill(x - 0.5, 0, z - 0.5, x + 0.5, 1, z + 0.5, 'crate'); fill(x - 0.25, 0, z - 0.25, x + 0.25, 0.75, z + 0.25, 'air'); fill(x - 0.25, 0, z + 0.25, x + 0.25, 0.5, z + 0.5, 'air');
      if (r() < 0.6) fill(x + 0.5, 0, z - 0.25, x + 1.25, 0.75, z + 0.5, 'crate');
    } else {                                             // a short hollow log
      logTube(v, x - 1.5, 0, z - 0.5, 3, true, 1);
    }
  }
}

export const MAPS = {
  sandbox: { label: 'Sandbox', spawn: [0, 0, 6], giantSpawn: [0, 0, 6], build: buildSandbox },
  hideseek: { label: 'Hide and seek', spawn: [0, 0, 5], giantSpawn: [0, 0, -5.5], build: buildHideSeek },
};
