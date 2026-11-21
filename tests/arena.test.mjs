// Headless checks of the arena tournament rules. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament, ARENA, roundName } from '../src/arena.js';

const rnd = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const fine = ids => Object.fromEntries(ids.map(id => [id, { dead: false, blood: 100, inside: true }]));
// run until the phase changes (or for `max` seconds); returns the events seen
function until(t, ids, info, phase, max = 400) {
  const ev = [];
  for (let s = 0; s < max * 20 && t.state.phase !== phase; s++) ev.push(...t.update(0.05, ids, typeof info === 'function' ? info() : info));
  assert.equal(t.state.phase, phase);
  return ev;
}
// play a whole match: `loser(a, b)` picks who dies
function play(t, ids, loser) {
  until(t, ids, fine(ids), 'prep');
  const { a, b } = t.state;
  until(t, ids, fine(ids), 'fight');
  const info = fine(ids); info[loser(a, b)].dead = true;
  const ev = until(t, ids, info, 'result');
  return { a, b, ...ev.find(e => e.type === 'result') };
}

test('with fewer than two fighters nothing happens', () => {
  const t = new Tournament(rnd(1));
  assert.deepEqual(t.update(1, ['h'], fine(['h'])), []);
  assert.equal(t.public().phase, 'waiting');
});

test('two fighters: rooms, then the fight, then a champion, then it starts again', () => {
  const t = new Tournament(rnd(2)), ids = ['h', 'p2'];
  assert.equal(t.update(0.05, ids, fine(ids))[0].type, 'start');
  assert.equal(t.public().phase, 'intro');
  const m = until(t, ids, fine(ids), 'prep').find(e => e.type === 'match');
  assert.deepEqual([m.a, m.b].sort(), ['h', 'p2']);
  assert.equal(t.public().t, ARENA.prep);
  assert.equal(until(t, ids, fine(ids), 'fight').at(-1).type, 'fight');
  // nothing ends it while both are alive and on the floor
  for (let i = 0; i < 100; i++) assert.deepEqual(t.update(0.05, ids, fine(ids)), []);
  const info = fine(ids); info.p2.dead = true;
  const res = t.update(0.05, ids, info)[0];
  assert.deepEqual([res.type, res.w, res.l, res.why], ['result', 'h', 'p2', 'kill']);
  const champ = until(t, ids, fine(ids), 'champion').at(-1);
  assert.deepEqual([champ.type, champ.id], ['champion', 'h']);
  assert.equal(t.public().champion, 'h');
  assert.equal(until(t, ids, fine(ids), 'intro').at(-1).type, 'start');
  assert.equal(t.public().n, 2);
});

test('four fighters: two semi-finals, then the winners meet in the final', () => {
  const t = new Tournament(rnd(3)), ids = ['h', 'p2', 'p3', 'b1'];
  t.update(0.05, ids, fine(ids));
  assert.equal(t.public().rounds[0].length, 2);
  const s1 = play(t, ids, (a, b) => b), s2 = play(t, ids, (a, b) => a);
  assert.equal(new Set([s1.a, s1.b, s2.a, s2.b]).size, 4, 'everyone fights once in the first round');
  const f = play(t, ids, (a, b) => b);
  assert.deepEqual([f.a, f.b].sort(), [s1.w, s2.w].sort(), 'the final is between the two winners');
  until(t, ids, fine(ids), 'champion');
  const pub = t.public();
  assert.equal(pub.champion, f.w);
  assert.equal(pub.rounds.length, 2);
  assert.deepEqual(pub.rounds[1][0], [f.a, f.b, f.w]);
});

test('odd numbers: someone gets a bye, and still everybody but one is knocked out', () => {
  for (const n of [3, 5, 6, 7]) {
    const t = new Tournament(rnd(10 + n)), ids = Array.from({ length: n }, (_, i) => 'p' + i);
    t.update(0.05, ids, fine(ids));
    const lost = new Set();
    let fights = 0;
    while (t.state.phase !== 'champion') {
      const r = play(t, ids, (a, b) => (fights % 2 ? a : b));
      assert.ok(!lost.has(r.a) && !lost.has(r.b), 'nobody who lost fights again');
      lost.add(r.l); fights++;
      until(t, ids, fine(ids), t.state.rounds.at(-1).length === 1 && t.state.rounds.at(-1)[0].w != null ? 'champion' : 'prep');
    }
    assert.equal(fights, n - 1, `${n} fighters need ${n - 1} fights`);
    assert.ok(!lost.has(t.state.champion));
  }
});

test('staying off the arena floor too long forfeits the fight', () => {
  const t = new Tournament(rnd(4)), ids = ['h', 'p2'];
  t.update(0.05, ids, fine(ids));
  until(t, ids, fine(ids), 'fight');
  const { a, b } = t.state, info = fine(ids);
  info[a].inside = false;
  let ev = [];
  for (let i = 0; i < 20 * (ARENA.away - 2); i++) ev.push(...t.update(0.05, ids, info));
  assert.equal(ev.length, 0, 'not yet');
  assert.ok(t.public().away[0] > 0 && t.public().away[0] <= 3, 'the countdown is shown');
  assert.equal(t.public().away[1], -1);
  // stepping back on resets the clock
  info[a].inside = true; t.update(0.05, ids, info);
  assert.equal(t.public().away[0], -1);
  info[a].inside = false;
  ev = until(t, ids, info, 'result');
  assert.deepEqual([ev.at(-1).w, ev.at(-1).why], [b, 'away']);
});

test('when the clock runs out, whoever has more blood wins', () => {
  const t = new Tournament(rnd(5)), ids = ['h', 'p2'];
  t.update(0.05, ids, fine(ids));
  until(t, ids, fine(ids), 'fight');
  const { a, b } = t.state, info = fine(ids);
  info[a].blood = 40; info[b].blood = 55;
  const ev = until(t, ids, info, 'result');
  assert.deepEqual([ev.at(-1).w, ev.at(-1).why], [b, 'time']);
});

test('a fighter who leaves the room loses; one who left before their match gives a bye', () => {
  const t = new Tournament(rnd(6)), ids = ['h', 'p2', 'p3', 'p4'];
  t.update(0.05, ids, fine(ids));
  until(t, ids, fine(ids), 'fight');
  const { a, b } = t.state;
  let now = ids.filter(id => id !== a);
  const ev = until(t, now, fine(now), 'result');
  assert.deepEqual([ev.at(-1).w, ev.at(-1).why], [b, 'left']);
  // someone from the other semi-final goes home before it starts: the other one goes straight to the final
  const other = t.state.rounds[0].find(m => m.a !== a && m.b !== a);
  now = now.filter(id => id !== other.a);
  const m = until(t, now, fine(now), 'prep').find(e => e.type === 'match');
  assert.deepEqual([m.a, m.b].sort(), [b, other.b].sort());
  assert.equal(t.state.r, 1, 'that is the final');
});

test('down to one fighter, the tournament stops', () => {
  const t = new Tournament(rnd(7)), ids = ['h', 'p2'];
  t.update(0.05, ids, fine(ids));
  until(t, ids, fine(ids), 'fight');
  assert.equal(t.update(0.05, ['h'], fine(['h']))[0].type, 'waiting');
  assert.equal(t.public().phase, 'waiting');
});

test('round names', () => {
  assert.deepEqual([1, 2, 4, 8].map(roundName), ['Final', 'Semi-final', 'Quarter-final', 'Round of 16']);
});
