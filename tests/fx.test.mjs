// Headless checks of the blood: where it lands, what it leaves, and that it tidies up. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Blood, MEAT } from '../src/fx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// flat ground at y = 0, with a wall filling everything beyond x = 2 (blocks of 0.25 m)
const world = { grid: 0.25, groundAt: () => 0, solidAt: (x, y) => x >= 2 && y >= 0 && y < 3 };
const run = (b, seconds, w = world) => { for (let t = 0; t < seconds; t += 1 / 60) b.update(1 / 60, -9.8, w); };
const marks = b => b.splats.filter(Boolean);

test('droplets fall and leave marks on the ground', () => {
  const b = new Blood(new THREE.Scene());
  b.spray(V(0, 1, 0), null, 40, 2);
  assert.equal(b.count().drops, 40);
  run(b, 2);
  const m = marks(b);
  assert.equal(b.count().drops, 0, 'all landed');
  assert.ok(m.length >= 35 && m.every(s => !s.wall && s.ny === 1 && Math.abs(s.y) < 0.03), `${m.length} marks, flat on the ground`);
  assert.ok(m.every(s => Math.hypot(s.x, s.z) < 3), 'near where it was sprayed');
});

test('blood sprayed at a wall sticks to the face it hit, and runs down', () => {
  const b = new Blood(new THREE.Scene());
  b.spray(V(1, 1.5, 0), V(1, 0.2, 0).normalize(), 50, 6, 0.02, 0.2);
  run(b, 1.5);
  const wall = marks(b).filter(s => s.wall);
  assert.ok(wall.length >= 40, `${wall.length} on the wall`);
  assert.ok(wall.every(s => s.nx === -1 && Math.abs(s.x - (2 - 0.012)) < 1e-6), 'on the face of the wall, facing back out of it');
  assert.ok(wall.every(s => s.y > 0.2 && s.y < 3), 'up the wall, not on the floor');
  // it runs: the mark is drawn longer and lower as it ages
  const m = new THREE.Matrix4(), i = b.splats.indexOf(wall[0]), p0 = V(0, 0, 0), s0 = V(0, 0, 0), q = new THREE.Quaternion();
  b.splatMesh.getMatrixAt(i, m); m.decompose(p0, q, s0);
  run(b, 2.5);
  const p1 = V(0, 0, 0), s1 = V(0, 0, 0);
  b.splatMesh.getMatrixAt(i, m); m.decompose(p1, q, s1);
  assert.ok(p1.y < p0.y - 0.005 && s1.z > s0.z * 1.2, `ran down: ${p0.y.toFixed(3)} -> ${p1.y.toFixed(3)}`);
});

test('a pool spreads, and is not wiped out by the next lot of blood', () => {
  const b = new Blood(new THREE.Scene(), 100, 60);
  b.pool(V(0, 0.2, 0), 0, 0.5, 4);
  const pool = marks(b)[0], i = b.splats.indexOf(pool), m = new THREE.Matrix4(), s = V(0, 0, 0), p = V(0, 0, 0), q = new THREE.Quaternion();
  const size = () => { b.splatMesh.getMatrixAt(i, m); m.decompose(p, q, s); return s.x; };
  run(b, 0.5); const early = size();
  run(b, 5); const late = size();
  assert.ok(early < 0.4 && late > 0.49 && late <= 0.5 + 1e-6, `it grew from ${early.toFixed(2)} to ${late.toFixed(2)} m`);
  // far more marks than there is room for: old ones go, the pool stays
  for (let k = 0; k < 400; k++) b.splat(k * 0.01, 0.01, 1, 0.05);
  assert.ok(b.splats.includes(pool), 'the pool is still there');
  assert.equal(marks(b).length, 60, 'and never more marks than there is room for');
});

test('chunks bounce, come to rest, mark the ground and are cleared away in the end', () => {
  const b = new Blood(new THREE.Scene());
  b.chunks(V(0, 1, 0), V(1, 0, 0), 20, 3, [MEAT.red, MEAT.bone]);
  assert.equal(b.count().bits, 20);
  run(b, 4);
  assert.ok(b.bitsList.every(c => c.rest && c.y < 0.2), 'all lying on the ground');
  assert.ok(marks(b).length > 0, 'the meat left marks where it landed (bone does not)');
  run(b, 40);
  assert.equal(b.count().bits, 0, 'gone after a while');
  b.spray(V(0, 1, 0), null, 10); b.pool(V(0, 0, 0), 0);
  b.clear();
  assert.deepEqual(b.count(), { drops: 0, splats: 0, bits: 0 });
});

test('there is a limit to how much blood is in the air at once', () => {
  const b = new Blood(new THREE.Scene(), 50, 50, 10);
  b.spray(V(0, 5, 0), null, 500);
  b.chunks(V(0, 5, 0), null, 100);
  assert.deepEqual([b.count().drops, b.count().bits], [50, 10]);
});
