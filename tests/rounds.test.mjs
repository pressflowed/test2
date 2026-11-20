// Headless checks of the hide and seek round rules. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rounds, ROUND, isCaught } from '../src/rounds.js';

const P = (x, y, z) => ({ x, y, z });
// a giant standing at the origin with its hands out in front, and a hider somewhere
const giantAt = (x, z) => ({ head: P(x, 1.6, z), hands: [P(x - 0.5, 1.0, z - 1), P(x + 0.5, 1.0, z - 1)], scale: 2 });
const hiderAt = (x, y, z) => ({ head: P(x, y, z), hands: [P(x, y, z), P(x, y, z)], scale: 0.25 });
const run = (r, seconds, ids, poses, dt = 0.05) => { const all = []; for (let t = 0; t < seconds; t += dt) all.push(...r.update(dt, ids, poses)); return all; };

test('nothing starts until there are two players', () => {
  const r = new Rounds(() => 0);
  assert.deepEqual(r.update(1, ['h'], {}), []);
  assert.equal(r.public().phase, 'waiting');
  const ev = r.update(0.05, ['h', 'p2'], {});
  assert.deepEqual(ev, [{ type: 'start', giant: 'h' }]);
  assert.equal(r.public().phase, 'hide');
  assert.equal(r.public().t, ROUND.hide);
});

test('hiders get their head start, and nobody can be caught during it', () => {
  const r = new Rounds(() => 0);
  const ids = ['h', 'p2'], poses = { h: giantAt(0, 0), p2: hiderAt(0, 1.6, 0) };   // hider right on top of the giant
  r.update(0.05, ids, poses);
  const ev = run(r, ROUND.hide - 1, ids, poses);
  assert.deepEqual(ev, [], 'no catches while hiding');
  assert.equal(r.public().phase, 'hide');
  const ev2 = run(r, 1.5, ids, poses);
  assert.equal(ev2[0].type, 'hunt');
  assert.deepEqual(ev2.slice(1, 3), [{ type: 'caught', id: 'p2' }, { type: 'end', winner: 'giant' }]);
});

test('the giant wins by catching everyone; touching means a hand or the body', () => {
  const g = giantAt(0, 0);
  assert.ok(isCaught(g, hiderAt(0.5, 1.0, -1.1)), 'hand on the hider');
  assert.ok(isCaught(g, hiderAt(0.3, 0.3, 0.2)), 'hider at the giant\'s feet');
  assert.ok(!isCaught(g, hiderAt(0.5, 1.0, -1.6)), 'half a metre past the hand is safe');
  assert.ok(!isCaught(g, hiderAt(1.2, 0.3, 0)), 'a metre to the side is safe');
  assert.ok(!isCaught(g, hiderAt(0, 3.2, 0)), 'well above the giant is safe');

  const r = new Rounds(() => 0);
  const ids = ['h', 'p2', 'p3'];
  const poses = { h: g, p2: hiderAt(10, 0.2, 10), p3: hiderAt(-10, 0.2, 5) };
  r.update(0.05, ids, poses);
  run(r, ROUND.hide + 0.1, ids, poses);
  assert.equal(r.public().phase, 'hunt');
  poses.p2 = hiderAt(0.5, 1.0, -1.05);
  assert.deepEqual(r.update(0.05, ids, poses), [{ type: 'caught', id: 'p2' }]);
  assert.deepEqual(r.public().out, ['p2']);
  assert.equal(r.public().phase, 'hunt', 'one hider is still out there');
  poses.p3 = hiderAt(-0.5, 1.0, -1.05);
  assert.deepEqual(r.update(0.05, ids, poses), [{ type: 'caught', id: 'p3' }, { type: 'end', winner: 'giant' }]);
});

test('hiders win if any of them last until the clock runs out', () => {
  const r = new Rounds(() => 0);
  const ids = ['h', 'p2'], poses = { h: giantAt(0, 0), p2: hiderAt(20, 0.2, 20) };
  r.update(0.05, ids, poses);
  const ev = run(r, ROUND.hide + ROUND.hunt + 0.5, ids, poses, 0.1);
  assert.deepEqual(ev.map(e => e.type), ['hunt', 'end']);
  assert.equal(ev[1].winner, 'hiders');
});

test('the giant changes every round', () => {
  const r = new Rounds(() => 0);
  const ids = ['h', 'p2', 'p3'], poses = { h: giantAt(0, 0), p2: hiderAt(20, 0.2, 20), p3: hiderAt(-20, 0.2, 20) };
  const giants = [];
  for (let n = 0; n < 4; n++) {
    const ev = run(r, n ? ROUND.hide + ROUND.hunt + ROUND.over + 1 : 0.05, ids, poses, 0.1);
    giants.push(ev.find(e => e.type === 'start').giant);
  }
  assert.deepEqual(giants, ['h', 'p2', 'p3', 'h']);
  assert.equal(r.public().n, 4);
});

test('if the giant leaves, the hiders win; if everyone else leaves, it goes back to waiting', () => {
  const r = new Rounds(() => 0);
  const poses = { h: giantAt(0, 0), p2: hiderAt(20, 0.2, 20), p3: hiderAt(-20, 0.2, 20) };
  r.update(0.05, ['h', 'p2', 'p3'], poses);
  assert.deepEqual(r.update(0.05, ['p2', 'p3'], poses), [{ type: 'end', winner: 'hiders' }]);
  assert.deepEqual(r.update(0.05, ['p2'], poses), [{ type: 'waiting' }]);
  assert.equal(r.public().phase, 'waiting');
});

test('skip ends the round and starts the next one', () => {
  const r = new Rounds(() => 0);
  const ids = ['h', 'p2'], poses = { h: giantAt(0, 0), p2: hiderAt(20, 0.2, 20) };
  r.update(0.05, ids, poses);
  r.skip();
  const ev = r.update(0.05, ids, poses);
  assert.deepEqual(ev, [{ type: 'start', giant: 'p2' }]);
});
