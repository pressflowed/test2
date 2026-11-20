// Headless checks of the body: damage rules and where the joints are. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Body, BODY } from '../src/body.js';
import { solveRig, hitPart, grabArm, RIG } from '../src/bodyrig.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const types = ev => ev.map(e => e.type);
const run = (b, seconds, dt = 0.05) => { const all = []; for (let t = 0; t < seconds; t += dt) all.push(...b.update(dt)); return all; };

test('punches to the head and chest cost blood, and enough of them kill', () => {
  const b = new Body();
  assert.deepEqual(types(b.hit('torso', 25)), ['hit']);
  assert.ok(b.blood < 100 && b.blood > 80);
  const before = b.blood;
  b.hit('head', 25);
  assert.ok(before - b.blood > 25, 'head hits hurt more');
  let ev = [];
  for (let i = 0; i < 6 && !b.dead; i++) ev = b.hit('head', 25);
  assert.ok(b.dead && types(ev).includes('die'));
  assert.deepEqual(b.hit('head', 25), [], 'the dead feel nothing');
});

test('an arm takes a couple of hard hits, then comes off where it was hit', () => {
  const b = new Body();
  assert.deepEqual(types(b.hit('foreL', 20)), ['hit']);
  assert.ok(b.stripped & 1, 'flesh is torn off the damaged forearm first');
  assert.deepEqual(types(b.hit('foreL', 20)), ['hit', 'sever']);
  assert.deepEqual(b.cut, [1, 0], 'left arm gone below the elbow');
  assert.ok(!b.canUse(0) && b.canUse(1));
  assert.deepEqual(b.hit('foreL', 50), [], 'what is gone cannot be hit');
  const rest = b.hit('upperL', 50).find(e => e.type === 'sever');
  assert.deepEqual(b.cut, [2, 0], 'the rest of it can still come off at the shoulder');
  assert.equal(rest.was, 1, 'and the event says only the upper arm was left to lose');
  assert.equal(new Body().sever(1, 2)[0].was, 0, 'a whole arm torn off was whole');
});

test('with one arm gone you bleed, it clots, and you live on with a lower blood limit', () => {
  const b = new Body();
  b.sever(1, 2);
  assert.equal(b.bleeding, 2, 'the right stump bleeds');
  const ev = run(b, 20);
  assert.ok(!b.dead && !types(ev).includes('die'));
  assert.equal(b.bleeding, 0, 'clotted');
  assert.ok(b.blood > 45 && b.blood < 75, `blood ${b.blood}`);
  run(b, 40);
  assert.equal(b.blood, b.maxBlood);
  assert.equal(b.maxBlood, BODY.blood - BODY.armBloodCost);
  assert.ok(b.canUse(0) && !b.canUse(1));
});

test('with both arms gone you bleed out quickly', () => {
  const b = new Body();
  b.sever(0, 2); b.sever(1, 1);
  let t = 0, died = false;
  while (t < 30 && !died) { died = types(b.update(0.05)).includes('die'); t += 0.05; }
  assert.ok(died, 'bled out');
  assert.ok(t > 5 && t < 12, `took ${t.toFixed(1)} s`);
});

test('the dead come back whole after a few seconds', () => {
  const b = new Body();
  b.sever(0, 2); b.hit('head', 500);
  assert.ok(b.dead);
  const ev = run(b, BODY.respawn + 0.2);
  assert.deepEqual(types(ev), ['respawn']);
  assert.ok(!b.dead && b.blood === 100 && b.cut[0] === 0 && b.canUse(0));
});

test('a body packs into a few numbers for other players', () => {
  const a = new Body(), b = new Body();
  a.hit('foreR', 25); a.sever(0, 2); a.held[1] = 'p2:0';
  assert.ok(b.apply(a.pack()), 'something visible changed');
  assert.deepEqual(b.view.cut, [2, 0]);
  assert.equal(b.view.bleeding, 1);
  assert.equal(b.view.stripped & 4, 4);
  assert.equal(b.held[1], 'p2:0');
  assert.ok(!b.canUse(1), 'a held arm cannot be used');
  assert.ok(!b.apply(a.pack()), 'nothing new the second time');
});

// a body standing at the origin looking down -Z, hands hanging at its sides
const stand = (scale = 1) => {
  const head = V(0, 1.6 * scale, 0), q = new THREE.Quaternion();
  const hands = [-1, 1].map(sx => ({ pos: V(sx * 0.3 * scale, (1.6 - 0.75) * scale, -0.05 * scale), quat: new THREE.Quaternion() }));
  return solveRig(head, q, hands, scale);
};

test('joints land where a body would have them', () => {
  const r = stand();
  // looking down -Z, the left shoulder is on the -X side
  assert.ok(r.shoulder[0].x < -0.15 && r.shoulder[1].x > 0.15, `shoulders ${r.shoulder[0].x}, ${r.shoulder[1].x}`);
  assert.ok(Math.abs(r.shoulder[0].y - (1.6 + RIG.shoulder[1])) < 1e-6);
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(r.shoulder[i].distanceTo(r.elbow[i]) - RIG.upper * r.stretch[i]) < 1e-4, 'upper arm keeps its length');
    assert.ok(Math.abs(r.elbow[i].distanceTo(r.wrist[i]) - RIG.fore * r.stretch[i]) < 1e-4, 'forearm keeps its length');
    assert.ok(r.elbow[i].z > r.shoulder[i].z - 0.3 && r.elbow[i].y < r.shoulder[i].y, 'elbow hangs below the shoulder');
  }
  assert.ok(r.torsoBottom.y < r.torsoTop.y && r.torsoTop.y < r.head.y);
  // twice the size: everything twice as far apart
  const big = stand(2);
  assert.ok(Math.abs(big.shoulder[1].x - 2 * r.shoulder[1].x) < 1e-6);
});

test('arms stretch a little to reach a far hand, but not forever', () => {
  const head = V(0, 1.6, 0), q = new THREE.Quaternion();
  const far = [{ pos: V(-0.3, 0.85, 0), quat: q }, { pos: V(1.6, 1.3, 0), quat: q }];
  const r = solveRig(head, q, far, 1);
  assert.equal(r.stretch[0], 1);
  assert.equal(r.stretch[1], RIG.maxStretch);
  assert.ok(r.wrist[1].distanceTo(r.shoulder[1]) <= (RIG.upper + RIG.fore) * RIG.maxStretch + 1e-6);
});

test('a fist finds the part it lands on, and missing parts cannot be hit', () => {
  const r = stand();
  assert.equal(hitPart(r, [0, 0], r.head.clone().add(V(0, 0, -0.15)), 0.07), 'head');
  assert.equal(hitPart(r, [0, 0], V(0, 1.15, -0.12), 0.07), 'torso');
  const midUpper = r.shoulder[1].clone().lerp(r.elbow[1], 0.5), midFore = r.elbow[1].clone().lerp(r.wrist[1], 0.9);
  assert.equal(hitPart(r, [0, 0], midUpper.clone().add(V(0.08, 0, 0)), 0.07), 'upperR');
  assert.equal(hitPart(r, [0, 0], midFore.clone().add(V(0.08, 0, 0)), 0.07), 'foreR');
  assert.equal(hitPart(r, [0, 0], r.hand[0], 0.07), 'foreL', 'the hand counts as forearm');
  assert.equal(hitPart(r, [0, 0], V(0, 1.6, -1.5), 0.07), null, 'a miss');
  assert.equal(hitPart(r, [0, 1], midFore.clone().add(V(0.08, 0, 0)), 0.07), null, 'forearm gone');
  assert.equal(hitPart(r, [0, 1], midUpper.clone().add(V(0.08, 0, 0)), 0.07), 'upperR', 'stump still there');
  assert.equal(hitPart(r, [0, 2], midUpper.clone().add(V(0.12, 0, 0)), 0.07), null, 'whole arm gone');
});

test('grabbing finds an arm, never the head or chest', () => {
  const r = stand();
  assert.equal(grabArm(r, [0, 0], r.hand[1], 0.1), 1);
  assert.equal(grabArm(r, [0, 0], r.elbow[0], 0.1), 0);
  assert.equal(grabArm(r, [0, 0], r.head, 0.1), -1);
  assert.equal(grabArm(r, [0, 2], r.hand[1], 0.1), -1, 'cannot grab an arm that is gone');
});
