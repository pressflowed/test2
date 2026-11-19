// Headless checks of the arm-push movement. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/physics.js';
import { Locomotion } from '../src/locomotion.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DT = 1 / 72;
const HEAD = V(0, 1.5, 0); // a standing player's head in rig space

function setup(extra = w => {}) {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass'); // floor, top at y = 0
  extra(world);
  const loco = new Locomotion(world);
  loco.teleport(V(0, 0, 0));
  return loco;
}
// hands relaxed at the sides, 0.15 m above the floor once settled
const rest = () => [V(-0.25, -0.65, -0.3), V(0.25, -0.65, -0.3)].map(v => v.add(HEAD));
function run(loco, frames, hands = rest(), active = [true, true]) {
  for (let i = 0; i < frames; i++) loco.update(DT, HEAD, typeof hands === 'function' ? hands(i) : hands, active);
}

test('standing still settles on the floor at body height', () => {
  const loco = setup();
  run(loco, 150);
  assert.ok(loco.grounded, 'grounded');
  assert.ok(Math.abs(loco.head.y - loco.cfg.bodyHeight) < 0.02, `head y ${loco.head.y}`);
  assert.ok(loco.vel.length() < 0.05);
  assert.ok(!loco.hands[0].pinned && !loco.hands[1].pinned, 'relaxed hands do not touch');
});

test('a fast down-and-back stroke on the ground launches the body forward and up', () => {
  const loco = setup();
  run(loco, 150);
  const z0 = loco.head.z;
  // stroke: 12 frames pushing down and back, then lift the hands
  const stroke = i => {
    const t = Math.min(i / 12, 1);
    const y = i <= 12 ? -0.65 - 0.4 * t : -0.4;
    const z = -0.5 + 0.7 * t;
    return [V(-0.25, y, z).add(HEAD), V(0.25, y, z).add(HEAD)];
  };
  let launch = null;
  for (let i = 0; i < 16; i++) {
    loco.update(DT, HEAD, stroke(i), [true, true]);
    for (const e of loco.events) if (e.type === 'launch') launch = e;
  }
  assert.ok(launch, 'released');
  assert.ok(loco.vel.z < -2, `forward speed ${loco.vel.z}`);
  assert.ok(loco.vel.y > 0.5, `upward speed ${loco.vel.y}`);
  assert.ok(loco.vel.length() <= loco.cfg.maxJump + 1e-6, 'capped');
  run(loco, 60, rest(), [false, false]);
  assert.ok(loco.head.z < z0 - 1, `travelled ${z0 - loco.head.z} m`);
});

test('hands only push: you cannot hang from a ceiling', () => {
  const loco = setup(w => w.addBox(0, 1.6, 0, 10, 0.5, 10, 'wood')); // ceiling underside at 1.6, head rests at 0.8
  run(loco, 150);
  // raise both hands until they press into the ceiling
  const up = [V(-0.2, 0.95, -0.2).add(HEAD), V(0.2, 0.95, -0.2).add(HEAD)];
  run(loco, 20, i => up.map((u, k) => rest()[k].lerp(u, Math.min((i + 1) / 15, 1))));
  assert.ok(loco.hands[0].pinned, 'hand touched the ceiling');
  // now hold still: gravity should win, the body stays on the floor and does not get lifted
  run(loco, 100, up);
  assert.ok(loco.head.y < loco.cfg.bodyHeight + 0.15, `head y ${loco.head.y}`);
});

test('pushing down on a wall climbs it', () => {
  const loco = setup(w => w.addBox(0, 0, -1.0, 6, 6, 0.6, 'rock')); // wall face at z = -0.7
  run(loco, 150);
  const y0 = loco.head.y;
  // like climbing a ladder: reach a hand up to the wall, press in, pull it down; alternate hands
  const off = [V(-0.25, -0.65, -0.3), V(0.25, -0.65, -0.3)];   // where each hand is, rig space minus HEAD
  let peak = y0;
  const moveTo = (k, goal, frames) => {
    const from = off[k].clone();
    for (let i = 1; i <= frames; i++) {
      off[k].lerpVectors(from, goal, i / frames);
      loco.update(DT, HEAD, off.map(o => o.clone().add(HEAD)), [true, true]);
      peak = Math.max(peak, loco.head.y);
    }
  };
  for (let stroke = 0; stroke < 4; stroke++) {
    const k = stroke % 2, x = k ? 0.25 : -0.25;
    moveTo(k, V(x, 0.0, -0.45), 10);   // hand up in the air in front of you
    moveTo(k, V(x, 0.0, -0.95), 8);    // press it into the wall
    moveTo(k, V(x, -0.6, -0.95), 14);  // pull down along the wall
    moveTo(k, V(x, -0.6, -0.35), 6);   // take it off the wall
  }
  assert.ok(peak > y0 + 1.0, `climbed ${peak - y0} m`);
});

test('hands cannot pass through a thin wall', () => {
  const loco = setup(w => w.addBox(0, 0, -0.55, 6, 3, 0.1, 'wood')); // wall z from -0.6 to -0.5
  run(loco, 150);
  // swing a hand from in front of the wall to a target behind it
  run(loco, 1, [V(-0.25, -0.3, -0.2).add(HEAD), V(0.25, -0.3, -0.2).add(HEAD)]);
  run(loco, 1, [V(-0.25, -0.3, -1.0).add(HEAD), V(0.25, -0.3, -0.2).add(HEAD)]);
  const h = loco.hands[0];
  assert.ok(h.pos.z > -0.5, `hand z ${h.pos.z}`);
  assert.ok(h.pinned);
});

test('turning keeps the head in place', () => {
  const loco = setup();
  run(loco, 150);
  const headLocal = V(0.3, 1.5, 0.2);
  const before = loco.toWorld(headLocal, new THREE.Vector3());
  loco.turn(Math.PI / 4, headLocal);
  const after = loco.toWorld(headLocal, new THREE.Vector3());
  assert.ok(after.distanceTo(before) < 1e-9, `head moved ${after.distanceTo(before)}`);
  assert.ok(Math.abs(loco.yaw - Math.PI / 4) < 1e-9);
});

test('a hand brushing the ground mid-flight does not stop you dead', () => {
  const loco = setup();
  run(loco, 150, rest(), [false, false]);
  // flying forward, body clear of the ground
  loco.vel.set(0, 0, -6);
  loco.origin.y += 0.3;
  // hands held still relative to the body, low enough to drag on the floor
  const low = [V(-0.25, -1.08, -0.3).add(HEAD), V(0.25, -1.08, -0.3).add(HEAD)];
  run(loco, 10, low);
  assert.ok(loco.hands[0].pinned || loco.hands[1].pinned, 'hands are on the ground');
  assert.ok(-loco.vel.z > 3, `still moving at ${-loco.vel.z} m/s`);
});

test('hands planted on the ground still hold you steady', () => {
  const loco = setup();
  run(loco, 150, rest(), [false, false]);
  const planted = [V(-0.25, -0.8, -0.3).add(HEAD), V(0.25, -0.8, -0.3).add(HEAD)];
  run(loco, 3, planted);
  const p0 = loco.head.clone();
  run(loco, 150, planted);
  assert.ok(loco.head.distanceTo(p0) < 0.03, `drifted ${loco.head.distanceTo(p0)} m`);
});

test('repeated strokes keep building speed', () => {
  const loco = setup();
  run(loco, 150);
  const z0 = loco.head.z;
  let peak = 0;
  // alternate hands: each stroke pushes the ground back fast, then lifts and swings forward
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i <= 16; i++) {
      const t = i / 10;
      const push = i <= 10 ? [-0.5 + 1.0 * t, -0.95] : [0.5, -0.4];
      const swing = [-0.5, -0.4];
      const a = V(-0.25, push[1], push[0]).add(HEAD), b = V(0.25, swing[1], swing[0]).add(HEAD);
      loco.update(DT, HEAD, s % 2 ? [b, a] : [a, b], [true, true]);
      peak = Math.max(peak, -loco.vel.z);   // speed forward (-Z), not just any speed
    }
  }
  assert.ok(peak > 6, `top forward speed ${peak.toFixed(2)} m/s`);
  assert.ok(loco.head.z < z0 - 10, `went ${(z0 - loco.head.z).toFixed(1)} m forward`);
});

test('a 2x player stands twice as tall and keeps their feet when resizing', () => {
  const loco = setup();
  run(loco, 150, rest(), [false, false]);
  const feet = loco.head.y - loco.cfg.bodyHeight;
  loco.setScale(2, HEAD);
  run(loco, 150, rest(), [false, false]);
  assert.equal(loco.scale, 2);
  assert.ok(Math.abs(loco.head.y - 2 * loco.cfg.bodyHeight) < 0.05, `head at ${loco.head.y}`);
  assert.ok(Math.abs(loco.head.y - 2 * loco.cfg.bodyHeight - feet) < 0.05, 'feet still on the floor');
  assert.ok(Math.abs(loco.head.x) < 0.01 && Math.abs(loco.head.z) < 0.01, 'did not slide sideways');
  loco.setScale(0.5, HEAD);
  run(loco, 150, rest(), [false, false]);
  assert.ok(Math.abs(loco.head.y - 0.5 * loco.cfg.bodyHeight) < 0.05, `small head at ${loco.head.y}`);
});

test('more power means a faster launch from the same stroke', () => {
  const launch = power => {
    const loco = setup();
    loco.power = power;
    run(loco, 150);
    for (let i = 0; i < 16; i++) {
      const t = Math.min(i / 12, 1), y = i <= 12 ? -0.65 - 0.4 * t : -0.4, z = -0.5 + 0.7 * t;
      loco.update(DT, HEAD, [V(-0.25, y, z).add(HEAD), V(0.25, y, z).add(HEAD)], [true, true]);
    }
    return loco.vel.length();
  };
  const normal = launch(1), strong = launch(2);
  assert.ok(strong > normal * 1.5, `power 1: ${normal.toFixed(1)} m/s, power 2: ${strong.toFixed(1)} m/s`);
});
