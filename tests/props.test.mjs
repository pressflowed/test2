// Headless checks of the physics props. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/physics.js';
import { PropWorld } from '../src/props.js';
import { Locomotion } from '../src/locomotion.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DT = 1 / 72;

function setup(simulate = true) {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  const scene = new THREE.Scene();
  return { world, scene, props: new PropWorld(scene, world.colliders, simulate) };
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
  const props = new PropWorld(new THREE.Scene(), world.colliders, true);
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
