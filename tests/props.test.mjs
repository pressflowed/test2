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
