// The horror mode's rules (caves.js), the cave itself, and digging that only takes ore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld, MAT, MATERIALS } from '../src/voxels.js';
import { Mine, ORES, UPGRADES, DEEP, campNear } from '../src/caves.js';
import { CAVE } from '../src/maps.js';

const ORE_ONLY = m => !!MATERIALS[m].ore;

test('ore becomes lumps, lumps fill the bag, the crusher pays for them', () => {
  const m = new Mine();
  assert.equal(m.dug('a', 'copper', ORES.copper.per - 1), 0, 'not quite a lump');
  assert.equal(m.dug('a', 'copper', 1), 1, 'the odd bits add up');
  for (let i = 0; i < DEEP.bag[0]; i++) assert.ok(m.stow('a', 'gold'));
  assert.equal(m.stow('a', 'gold'), false, 'the bag is full');
  assert.equal(m.sell('a'), DEEP.bag[0] * ORES.gold.value);
  assert.equal(m.carrying('a'), 0);
  assert.equal(m.public().pl.a[0], DEEP.bag[0] * ORES.gold.value);
});

test('the shop: you need the money, and some things come in order', () => {
  const m = new Mine();
  assert.equal(m.buy('a', 'tracker').ok, false);
  m.player('a').money = 2000;
  assert.equal(m.buy('a', 'pick3').ok, false, 'steel before diamond');
  assert.ok(m.buy('a', 'pick2').ok);
  assert.ok(m.buy('a', 'pick3').ok);
  assert.equal(m.buy('a', 'pick3').ok, false, 'once is enough');
  assert.equal(m.pick('a'), 2);
  assert.ok(m.buy('a', 'bag2').ok);
  assert.equal(m.cap('a'), DEEP.bag[1]);
  assert.equal(m.player('a').money, 2000 - UPGRADES.pick2.cost - UPGRADES.pick3.cost - UPGRADES.bag2.cost);
  assert.ok(m.buy('a', 'pick').ok && m.buy('a', 'pick').ok, 'a spare pickaxe is always there');
});

test('dying empties the bag but not the purse', () => {
  const m = new Mine();
  m.player('a').money = 50; m.stow('a', 'iron'); m.stow('a', 'crystal');
  assert.equal(m.died('a'), 2);
  assert.equal(m.carrying('a'), 0);
  assert.equal(m.player('a').money, 50);
});

test('a pickaxe takes ore and leaves the rock', () => {
  const v = new VoxelWorld(32, 32, 32, -4, 0, -4);
  v.fill(-2, 0, -2, 2, 3, 2, 'rock');
  v.fill(-0.25, 1, -0.25, 0.25, 1.5, 0.25, 'gold');
  v.finalize();
  assert.equal(v.carve(1.5, 2, 1.5, 0.5, ORE_ONLY), null, 'plain rock does not break');
  assert.equal(v.matAt(1.5, 2, 1.5), MAT.rock);
  assert.ok(v.carve(0, 1.25, 0, 0.6, ORE_ONLY), 'the ore does');
  assert.equal(v.matAt(0.1, 1.1, 0.1), 0);
  assert.equal(v.matAt(0.4, 1.1, 0.1), MAT.rock, 'and the rock beside it stays');
});

test('the cave: a camp, caverns you can stand in, and a sign for everything the shop sells', () => {
  const camp = CAVE.at(CAVE.camp.x, CAVE.camp.z);
  assert.ok(camp && camp.depth === 0 && camp.top - camp.floor > 2);
  for (const { x, z } of CAVE.nodes) { const c = CAVE.at(x, z); assert.ok(c && c.top - c.floor >= 2.5, `cavern at ${x}, ${z}`); }
  assert.equal(CAVE.at(34.5, 34.5), null, 'solid rock at the edge');
  assert.deepEqual(CAVE.shops.map(s => s.id).sort(), Object.keys(UPGRADES).sort());
  const s = CAVE.shops[0], hand = { x: s.pos[0], y: s.pos[1], z: s.pos[2] - 0.1 };
  const near = campNear(CAVE, [0, 0, 0, 8], [hand], { x: 0, y: 1.8, z: 27 }, { x: 0, y: 0, z: -1 });
  assert.equal(near.what, s.id);
});
