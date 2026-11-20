// Headless checks of the destructible voxel world. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld, VOXEL, MAT } from '../src/voxels.js';

// a small world: 16 m x 8 m x 16 m, centred on the origin
const make = build => { const v = new VoxelWorld(64, 32, 64, -8, 0, -8); build(v); v.finalize(); return v; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const inAnyBox = (v, p) => v.near(p, 0.01, []).some(b => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z);

test('collision boxes cover exactly the solid blocks', () => {
  const v = make(w => { w.box(0, 0, 0, 3, 2, 1, 'rock'); w.box(1, 2, 0, 1, 1, 3, 'plank'); w.ball(-4, 2, -4, 1.5, 'leaf'); });
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 4000; n++) {
    const p = V((rnd() - 0.5) * 15, rnd() * 7, (rnd() - 0.5) * 15);
    // nudge off block faces so "inside" is unambiguous
    p.x = Math.floor(p.x / VOXEL) * VOXEL + 0.11; p.y = Math.floor(p.y / VOXEL) * VOXEL + 0.11; p.z = Math.floor(p.z / VOXEL) * VOXEL + 0.11;
    assert.equal(inAnyBox(v, p), v.solidAt(p.x, p.y, p.z), `at ${p.toArray()}`);
  }
  // big flat things should merge into very few boxes
  const boxes = new Set(); for (const c of v.cells) for (const b of c.boxes) boxes.add(b);
  assert.ok(boxes.size < 120, `${boxes.size} boxes`);
});

test('thin things are at least one block thick, and materials stick', () => {
  const v = make(w => w.box(0, 1, 0, 2, 0.1, 2, 'plank'));
  assert.equal(v.matAt(0.1, 1.1, 0.1), MAT.plank);
  assert.equal(v.count(), 8 * 8);
});

test('a punch makes a dent where it lands and nowhere else', () => {
  const v = make(w => w.box(0, 0, 0, 6, 4, 2, 'stone'));   // a thick wall, front face at z = 1
  const before = v.count();
  const res = v.carve(0.1, 2.1, 1.0, 0.6);
  assert.ok(res && res.count > 10 && res.count < 80, `removed ${res && res.count}`);
  assert.equal(res.collapsed, 0);
  assert.equal(v.count(), before - res.count);
  assert.ok(!v.solidAt(0.1, 2.1, 0.9), 'hollow at the punch');
  assert.ok(v.solidAt(0.1, 2.1, -0.9), 'back of the wall is intact');
  assert.ok(v.solidAt(2.5, 2.1, 0.9) && v.solidAt(0.1, 0.3, 0.9) && v.solidAt(0.1, 3.8, 0.9), 'the rest of the face is intact');
  assert.ok(!inAnyBox(v, V(0.1, 2.1, 0.9)), 'you can reach into the dent');
  assert.ok(inAnyBox(v, V(2.5, 2.1, 0.9)));
  assert.ok(res.samples.length > 0 && res.samples.every(s => s[3] === MAT.stone));
});

test('nothing breaks when the punch misses', () => {
  const v = make(w => w.box(0, 0, 0, 2, 2, 2, 'rock'));
  assert.equal(v.carve(5, 5, 5, 0.5), null);
});

test('cutting through a pillar brings down everything above the cut', () => {
  const v = make(w => { w.box(0, 0, 0, 1, 6, 1, 'rock'); w.box(0, 6, 0, 3, 0.25, 3, 'plank'); });
  for (const dx of [-0.4, 0, 0.4]) for (const dz of [-0.4, 0, 0.4]) v.carve(dx, 1.1, dz, 0.45);
  assert.ok(v.solidAt(0.1, 0.1, 0.1), 'the stump is still there');
  assert.ok(!v.solidAt(0.1, 3, 0.1), 'the pillar above the cut fell');
  assert.ok(!v.solidAt(1.2, 6.1, 1.2), 'and so did the cap that sat on it');
  assert.ok(v.groundBelow(0.1, 7, 0.1) <= 1, `only a stump is left: ${v.groundBelow(0.1, 7, 0.1)} m`);
});

test('a dent that does not cut all the way through leaves the top standing', () => {
  const v = make(w => w.box(0, 0, 0, 2, 6, 2, 'rock'));
  const res = v.carve(0, 1.5, 1.0, 0.6);
  assert.equal(res.collapsed, 0);
  assert.ok(v.solidAt(0.1, 5.5, 0.1));
});

test('things built floating hold themselves up, even when broken in two', () => {
  const v = make(w => w.box(0, 3, 0, 4, 0.25, 1, 'plank'));   // a floating plank
  assert.ok(v.solidAt(1.8, 3.1, 0));
  const res = v.carve(0, 3.1, 0, 0.7);
  assert.ok(res.count > 0);
  assert.equal(res.collapsed, 0);
  assert.ok(v.solidAt(-1.8, 3.1, 0.1) && v.solidAt(1.8, 3.1, 0.1), 'both halves still float');
});

test('a bridge stands while one end holds, and falls when both are cut', () => {
  const build = w => { w.box(-3, 0, 0, 1, 3, 1, 'rock'); w.box(3, 0, 0, 1, 3, 1, 'rock'); w.box(0, 3, 0, 7, 0.25, 1, 'plank'); };
  const v = make(build);
  const cut = x => { for (const dz of [-0.3, 0.3]) v.carve(x, 3.1, dz, 0.45); };
  cut(-1.8);
  assert.ok(v.solidAt(0, 3.1, 0.1), 'still hangs from the far end');
  cut(1.8);
  assert.ok(!v.solidAt(0, 3.1, 0.1), 'the middle fell');
  assert.ok(v.solidAt(-3, 3.1, 0.1) && v.solidAt(3, 3.1, 0.1), 'the ends resting on the pillars stay');
});

test('the same punches in a different order give the same world', () => {
  const build = w => { w.box(0, 0, 0, 5, 5, 5, 'rock'); w.box(0, 5, 0, 1, 2, 1, 'wood'); w.box(4, 0, 0, 0.5, 4, 0.5, 'wood'); w.box(2.5, 4, 0, 3, 0.25, 1, 'plank'); };
  const punches = [[0, 5.2, 0.4, 0.7], [2.4, 2, 2.4, 0.9], [4, 1, 0, 0.6], [0.3, 5.3, -0.3, 0.6], [-2.5, 4.9, 0, 1.0], [3, 4.1, 0, 0.5]];
  const a = make(build), b = make(build);
  for (const p of punches) a.carve(...p);
  for (const p of punches.slice().reverse()) b.carve(...p);
  assert.deepEqual(a.data, b.data);
  assert.ok(a.count() < make(build).count());
});

test('reset puts the map back, including its collision boxes', () => {
  const v = make(w => w.box(0, 0, 0, 2, 4, 2, 'rock'));
  const before = v.data.slice();
  v.carve(0, 2, 1, 0.8); v.carve(0, 0.3, 0, 1.2);
  assert.notDeepEqual(v.data, before);
  let cellsRebuilt = 0; v.onCells = cells => { cellsRebuilt += cells.length; };
  v.reset();
  assert.deepEqual(v.data, before);
  assert.ok(cellsRebuilt > 0);
  assert.ok(inAnyBox(v, V(0.1, 2.1, 0.9)));
  assert.equal(v.groundBelow(0.1, 9, 0.1), 4);
});

test('boxes from before a change are marked dead so hands let go of them', () => {
  const v = make(w => w.box(0, 0, 0, 2, 2, 2, 'rock'));
  const old = v.near(V(0, 1, 0), 0.5, []);
  assert.ok(old.length > 0 && old.every(b => !b.dead && b.voxel));
  v.carve(0, 2, 0, 0.5);
  assert.ok(old.every(b => b.dead));
  assert.ok(v.near(V(0, 1, 0), 0.5, []).every(b => !b.dead));
});

test('raycast finds the first block and which face was hit', () => {
  const v = make(w => w.box(0, 0, -3, 4, 4, 1, 'brick'));   // front face at z = -2.5
  const hit = v.raycast(V(0.1, 1.1, 2), V(0, 0, -1), 10);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.z + 2.5) < 1e-6, `hit at z ${hit.point.z}`);
  assert.deepEqual(hit.normal.toArray(), [0, 0, 1]);
  assert.equal(hit.mat, MAT.brick);
  assert.equal(v.raycast(V(0.1, 1.1, 2), V(0, 0, -1), 3), null, 'out of reach');
  assert.equal(v.raycast(V(0.1, 1.1, 2), V(0, 0, 1), 10), null, 'nothing that way');
});
