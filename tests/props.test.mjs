// Headless checks of the physics props. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/physics.js';
import { PropWorld } from '../src/props.js';
import { Locomotion } from '../src/locomotion.js';
import { VoxelWorld } from '../src/voxels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DT = 1 / 72;

function setup(simulate = true) {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  const scene = new THREE.Scene();
  return { world, scene, props: new PropWorld(scene, world, simulate) };
}
const steps = (props, n) => { for (let i = 0; i < n; i++) props.step(DT); };

test('a spawned crate falls and comes to rest on the ground', () => {
  const { props } = setup();
  const p = props.spawn('crate', V(0, 2, 0));
  steps(props, 240);
  assert.ok(Math.abs(p.mesh.position.y - 0.275) < 0.02, `crate y ${p.mesh.position.y}`);
});

test('platforms and trampolines stay where you put them', () => {
  const { props } = setup();
  const p = props.spawn('platform', V(0, 3, 0));
  const t = props.spawn('trampoline', V(3, 2, 0));
  steps(props, 120);
  assert.equal(p.mesh.position.y, 3);
  assert.equal(t.mesh.position.y, 2);
});

test('a hand swiping through a ball knocks it away', () => {
  const { props } = setup();
  const ball = props.spawn('ball', V(0, 0.2, 0));
  steps(props, 60);
  // hand sweeps along +x through the ball at 4 m/s
  for (let i = 0; i < 30; i++) {
    props.setHand('h:1', V(-0.6 + i * 4 * DT, 0.2, 0), 0.07, DT);
    props.step(DT);
  }
  assert.ok(ball.body.velocity.x > 1 || ball.mesh.position.x > 0.5, `ball x ${ball.mesh.position.x}, vx ${ball.body.velocity.x}`);
});

test('grabbing holds a prop to the hand; letting go throws it', () => {
  const { props } = setup();
  const p = props.spawn('crate', V(0, 0.3, 0));
  steps(props, 60);
  const hand = { key: 'h:1', pos: p.mesh.position.clone().add(V(0, 0.3, 0)), quat: new THREE.Quaternion() };
  assert.ok(props.grab(p.id, hand));
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  for (let i = 0; i < 20; i++) {
    hand.pos.y += 0.02;
    props.heldPose(p, hand.pos, hand.quat, pos, quat);
    props.moveHeld(p, pos, quat, DT);
    props.step(DT);
  }
  assert.ok(Math.abs(p.mesh.position.y - (hand.pos.y - 0.3)) < 0.05, 'follows the hand');
  props.release(p.id, V(0, 0, -6));
  steps(props, 30);
  assert.ok(p.mesh.position.z < -1.5, `thrown to z ${p.mesh.position.z}`);
});

test('players can stand on a big crate and bounce off a trampoline', () => {
  const { world, props } = setup();
  const crate = props.spawn('bigcrate', V(0, 0.6, 0));
  steps(props, 60);
  const loco = new Locomotion(world);
  const head = V(0, 1.5, 0), hands = [V(-0.25, 0.85, -0.3), V(0.25, 0.85, -0.3)];
  loco.teleport(V(0, 1.5, 0));
  for (let i = 0; i < 150; i++) {
    world.colliders = world.colliders.filter(c => !c.prop).concat(props.colliders());
    loco.update(DT, head, hands, [false, false]);
  }
  assert.ok(Math.abs(loco.head.y - (crate.col.max.y + loco.cfg.bodyHeight)) < 0.05, `standing at ${loco.head.y}`);

  // drop onto a trampoline
  const tramp = props.spawn('trampoline', V(5, 0.15, 0));
  world.colliders = world.colliders.filter(c => !c.prop).concat(props.colliders());
  loco.teleport(V(5, 2.5, 0));
  let peakAfterBounce = -Infinity, bounced = false;
  for (let i = 0; i < 200; i++) {
    loco.update(DT, head, hands, [false, false]);
    if (loco.vel.y > 2) bounced = true;
    if (bounced) peakAfterBounce = Math.max(peakAfterBounce, loco.head.y);
  }
  assert.ok(bounced, 'bounced up');
  assert.ok(peakAfterBounce > tramp.col.max.y + loco.cfg.bodyHeight + 0.8, `bounce height ${peakAfterBounce}`);
});

test('a joined player sees the same props as the host', () => {
  const host = setup().props, client = setup(false).props;
  host.spawn('crate', V(0, 2, 0), null, { owner: 'h' });
  host.spawn('plank', V(2, 1, 0), null, { owner: 'p2' });
  steps(host, 100);
  client.applySnapshot(host.snapshot());
  for (let i = 0; i < 60; i++) client.interpolate(DT);
  assert.equal(client.props.size, 2);
  for (const [id, p] of host.props) {
    const c = client.props.get(id);
    assert.ok(c.mesh.position.distanceTo(p.mesh.position) < 0.01);
    assert.equal(c.type.id, p.type.id);
  }
  host.remove(1);
  client.applySnapshot(host.snapshot());
  assert.equal(client.props.size, 1);
});

test('a thrown seed flies, lands and grows into the real prop', () => {
  const { props } = setup();
  props.throwSeed('crate', V(0, 1.5, 0), V(0, 2, -5), 'h');
  assert.equal(props.seeds.size, 1);
  let frames = 0;
  while (props.seeds.size && frames++ < 400) props.step(DT);
  assert.equal(props.seeds.size, 0, 'seed landed');
  const crate = [...props.props.values()].find(p => p.type.id === 'crate');
  assert.ok(crate, 'crate appeared');
  assert.ok(crate.mesh.position.z < -2, `landed down range at z ${crate.mesh.position.z}`);
  assert.equal(crate.owner, 'h');
  steps(props, 200);
  assert.ok(Math.abs(crate.mesh.position.y - 0.275) < 0.03, `resting on the ground at y ${crate.mesh.position.y}`);
  assert.ok(Math.abs(crate.mesh.scale.x - 1) < 1e-6, 'grown to full size');
});

test('a seed thrown at a wall puts the prop in front of it, not inside', () => {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  world.addBox(0, 0, -5, 10, 6, 1, 'stone');   // wall face at z = -4.5
  const props = new PropWorld(new THREE.Scene(), world, true);
  props.throwSeed('bigcrate', V(0, 1.5, 0), V(0, 3, -12), 'h');
  let frames = 0;
  while (props.seeds.size && frames++ < 400) props.step(DT);
  const crate = [...props.props.values()][0];
  assert.ok(crate.mesh.position.z > -4.5 + 0.6 - 0.01, `crate centre z ${crate.mesh.position.z}`);
});

test('TNT explodes after its fuse and throws nearby props', () => {
  const { props } = setup();
  const crate = props.spawn('crate', V(1.2, 0.3, 0));
  steps(props, 60);
  props.spawn('tnt', V(0, 0.3, 0));
  let boom = null;
  for (let i = 0; i < 72 * 5 && !boom; i++) { props.step(DT); boom = props.events.find(e => e.type === 'boom'); }
  assert.ok(boom, 'boom event');
  assert.ok(![...props.props.values()].some(p => p.type.id === 'tnt'), 'TNT is gone');
  steps(props, 20);
  assert.ok(crate.mesh.position.x > 1.6 || crate.mesh.position.y > 0.8, `crate was thrown: ${crate.mesh.position.toArray()}`);
});

test('balloons float up; launch pads fling the player', () => {
  const { world, props } = setup();
  const b = props.spawn('balloon', V(0, 1, 0));
  steps(props, 150);
  assert.ok(b.mesh.position.y > 2, `balloon rose to ${b.mesh.position.y}`);

  props.spawn('launchpad', V(6, 0.125, 0));
  world.colliders = world.colliders.concat(props.colliders());
  const loco = new Locomotion(world);
  const head = V(0, 1.5, 0), hands = [V(-0.25, 0.85, -0.3), V(0.25, 0.85, -0.3)];
  loco.teleport(V(6, 0.5, 0));
  let peak = 0, padEvent = false;
  for (let i = 0; i < 200; i++) {
    loco.update(DT, head, hands, [false, false]);
    if (loco.events.some(e => e.type === 'pad')) padEvent = true;
    peak = Math.max(peak, loco.head.y);
  }
  assert.ok(padEvent, 'pad fired');
  assert.ok(peak > 6, `launched to ${peak} m`);
});

test('fixed props stay square to the world so you stand where you see them', () => {
  const { props } = setup();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, 0.2));
  const p = props.spawn('wall', V(0, 1, 0), q);
  const size = p.col.max.clone().sub(p.col.min);
  assert.ok(Math.abs(size.y - 2) < 1e-6 && Math.min(size.x, size.z) < 0.31, `wall box ${size.toArray()}`);
});

test('props rest on voxel blocks and fall when the blocks under them break', () => {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  world.voxels = new VoxelWorld(64, 32, 64, -8, 0, -8);
  world.voxels.box(0, 0, 0, 2, 2, 2, 'rock');
  world.voxels.finalize();
  const props = new PropWorld(new THREE.Scene(), world, true);
  world.voxels.onCells = cells => props.syncCells(cells);
  const crate = props.spawn('crate', V(0, 2.6, 0));
  steps(props, 200);
  assert.ok(Math.abs(crate.mesh.position.y - 2.275) < 0.03, `resting on the block at y ${crate.mesh.position.y}`);
  // smash the block out from under it
  for (const y of [1.8, 1.2, 0.6, 0.2]) world.voxels.carve(0, y, 0, 1.6);
  steps(props, 200);
  assert.ok(crate.mesh.position.y < 0.6, `fell to y ${crate.mesh.position.y}`);
});

test('a thrown seed lands on voxel blocks', () => {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  world.voxels = new VoxelWorld(64, 32, 64, -8, 0, -8);
  world.voxels.box(0, 0, -4, 6, 3, 2, 'stone');   // top at y = 3
  world.voxels.finalize();
  const props = new PropWorld(new THREE.Scene(), world, true);
  props.throwSeed('crate', V(0, 4.5, 0), V(0, 1, -5), 'h');
  let frames = 0;
  while (props.seeds.size && frames++ < 400) props.step(DT);
  steps(props, 200);
  const crate = [...props.props.values()][0];
  assert.ok(Math.abs(crate.mesh.position.y - 3.275) < 0.05 && crate.mesh.position.z < -3, `on top of the wall: ${crate.mesh.position.toArray()}`);
});

test('the pieces of a dead body stay joined, and come apart when one is removed', () => {
  const { props } = setup();
  const opts = { owner: 'gib', rag: 1 };
  const torso = props.spawn('gib_torso', V(0, 1.2, 0), null, opts), head = props.spawn('gib_head', V(0, 1.65, 0), null, opts);
  const upper = props.spawn('gib_upper', V(0.3, 1.3, 0), null, opts), fore = props.spawn('gib_fore', V(0.3, 0.95, 0), null, opts);
  props.joint(torso, head, V(0, 1.5, 0), 1.1);
  props.joint(torso, upper, V(0.25, 1.45, 0));
  props.joint(upper, fore, V(0.3, 1.15, 0));
  assert.equal(props.joints.length, 3);
  steps(props, 300);
  const d = (a, b) => a.mesh.position.distanceTo(b.mesh.position);
  assert.ok(torso.mesh.position.y < 0.5 && torso.mesh.position.y > 0.05, `the body lies on the ground: ${torso.mesh.position.y}`);
  assert.ok(d(torso, head) < 0.6 && d(torso, upper) < 0.6 && d(upper, fore) < 0.5, `still in one piece: ${[d(torso, head), d(torso, upper), d(upper, fore)].map(x => x.toFixed(2))}`);
  for (const p of [torso, head, upper, fore]) assert.ok(Math.hypot(p.body.velocity.x, p.body.velocity.y, p.body.velocity.z) < 0.5, 'and it has come to rest');
  // carried by the forearm, the rest comes too
  const hand = { key: 'h:1', pos: fore.mesh.position.clone(), quat: new THREE.Quaternion() };
  assert.ok(props.grab(fore.id, hand));
  const at = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < 200; i++) {
    hand.pos.x += 0.012; hand.pos.y = Math.min(hand.pos.y + 0.01, 1.4);
    props.heldPose(fore, hand.pos, hand.quat, at, q);
    props.moveHeld(fore, at, q, DT);
    props.step(DT);
  }
  assert.ok(torso.mesh.position.x > 1.6 && d(upper, fore) < 0.55 && d(torso, upper) < 0.7, `dragged along: torso x ${torso.mesh.position.x.toFixed(2)}`);
  props.remove(upper.id);
  assert.equal(props.joints.length, 1, 'removing a piece removes its joints');
  props.removeGroup(1);
  assert.equal(props.props.size, 0);
  assert.equal(props.joints.length, 0);
});

test('a weapon lies down when spawned, jumps into the fist when grabbed, and settles there', () => {
  const { props } = setup();
  const spear = props.spawn('spear', V(0, 1.2, 0), null);
  const sword = props.spawn('sword', V(2, 0.6, 0), null);
  steps(props, 300);
  assert.ok(spear.mesh.position.y < 0.2, `a spear does not balance on its end: y ${spear.mesh.position.y}`);
  const hand = { key: 'h:1', pos: V(2, 1.3, 0.5), quat: new THREE.Quaternion() };
  assert.ok(props.grab(sword.id, hand));
  const at = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < 10; i++) { props.heldPose(sword, hand.pos, hand.quat, at, q); props.moveHeld(sword, at, q, DT); props.step(DT); }
  const d = sword.mesh.position.distanceTo(hand.pos), w = sword.type.weapon;
  assert.ok(Math.abs(d - Math.abs(w.hilt)) < 0.01, `held by the hilt: ${d}`);
  assert.ok(Math.hypot(sword.body.velocity.x, sword.body.velocity.y, sword.body.velocity.z) < 0.05, 'and still');
  // the far end of the blade is above the fist (out of the thumb side) and a little forward
  const tip = V(0, w.hits[w.hits.length - 1][1], 0).applyQuaternion(sword.mesh.quaternion).add(sword.mesh.position).sub(hand.pos);
  assert.ok(tip.z < -0.6 && tip.y < -0.2, `the blade runs out of the top of the fist (grip -Z), leaning toward the knuckles (-Y): ${tip.toArray().map(x => x.toFixed(2))}`);
  // a moving hand takes it along without it ringing about
  for (let i = 0; i < 60; i++) { hand.pos.x += 0.02; props.heldPose(sword, hand.pos, hand.quat, at, q); props.moveHeld(sword, at, q, DT); props.step(DT); }
  for (let i = 0; i < 5; i++) { props.heldPose(sword, hand.pos, hand.quat, at, q); props.moveHeld(sword, at, q, DT); props.step(DT); }
  assert.ok(Math.abs(sword.mesh.position.distanceTo(hand.pos) - Math.abs(w.hilt)) < 0.01, 'it follows the hand');
});

test('a weapon hung on a rack stays there until it is taken', () => {
  const { props } = setup();
  const axe = props.spawn('axe', V(0, 1.5, 0), null, { owner: 'rack' });
  axe.body.sleep();
  steps(props, 200);
  assert.ok(Math.abs(axe.mesh.position.y - 1.5) < 1e-6, 'hanging');
  assert.ok(Math.abs(axe.mesh.quaternion.w) > 0.999, 'upright');
  props.grab(axe.id, { key: 'h:0', pos: V(0, 1.2, 0.3), quat: new THREE.Quaternion() });
  props.release(axe.id);
  steps(props, 200);
  assert.ok(axe.mesh.position.y < 0.3, 'dropped, it falls');
});

test('a weapon gets bloodier each time it is used, up to a point, and joined players see that', () => {
  const { props } = setup(), far = setup(false).props;
  const sword = props.spawn('sword', V(0, 1, 0), null), clean = sword.mesh.geometry;
  assert.equal(sword.wounds, 0);
  props.bloody(sword);
  assert.equal(sword.wounds, 1);
  assert.notEqual(sword.mesh.geometry, clean, 'it looks different');
  const red = g => { const c = g.attributes.color; let n = 0; for (let i = 0; i < c.count; i++) n += c.getX(i) - c.getY(i); return n; };     // how much more red than green
  const once = red(sword.mesh.geometry);
  assert.ok(once > red(clean) + 1, 'redder');
  for (let i = 0; i < 6; i++) props.bloody(sword);
  assert.equal(sword.wounds, 3, 'no more than soaked');
  assert.ok(red(sword.mesh.geometry) > once + 1, 'and redder still');
  far.applySnapshot(props.snapshot());
  const copy = [...far.props.values()][0];
  assert.equal(copy.wounds, 3);
  assert.equal(copy.mesh.geometry, sword.mesh.geometry, 'the same bloody sword');
  props.bloody(props.spawn('crate', V(2, 1, 0)));          // (nothing happens to things that are not weapons)
});

test('the halves of a body and its guts are props like any other piece', () => {
  const { props } = setup();
  const chest = props.spawn('gib_chest', V(0, 1, 0), null, { owner: 'gib' }), belly = props.spawn('gib_belly', V(1, 1, 0), null, { owner: 'gib' }), guts = props.spawn('gib_guts', V(2, 1, 0), null, { owner: 'gib' });
  assert.ok(chest.wounds & 16 && belly.wounds & 16, 'cut sides bleed');
  steps(props, 240);
  for (const p of [chest, belly, guts]) assert.ok(p.mesh.position.y < 0.3 && p.mesh.position.y > 0, `${p.type.id} lies on the ground`);
});
