// Headless checks of the zombies game: its rules, the map, finding the way, and how bots get about. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Horde, ZOMBIES, KINDS, TONICS, pickKind, within } from '../src/zombies.js';
import { PRIORY, MAPS } from '../src/maps.js';
import { Nav } from '../src/nav.js';
import { Bot, GAITS } from '../src/bots.js';
import { World } from '../src/physics.js';
import { VoxelWorld } from '../src/voxels.js';
import { Body, BODY } from '../src/body.js';
import { Arrows } from '../src/arrows.js';
import { WEAPONS, ARMS } from '../src/weapons.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const types = ev => ev.map(e => e.type);
const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// run the rules for a while with one player standing in the chapel
const play = (h, seconds, info = { a: { dead: false, x: 0, z: 19 } }, dt = 0.1) => { const all = []; for (let t = 0; t < seconds; t += dt) all.push(...h.update(dt, Object.keys(info), info)); return all; };
const flat = () => { const w = new World(); w.addBox(0, -1, 0, 200, 1, 200, 'grass'); return w; };
const priory = () => { const w = new World(); w.voxels = new VoxelWorld(); w.addBox(0, -1, 0, 72, 1, 72, 'grass'); MAPS.zombies.build(w.voxels); w.voxels.finalize(); return w; };
const walk = (bot, seconds, each) => { for (let i = 0; i < seconds * 72; i++) { if (each) each(i / 72); bot.update(1 / 72, null); } };

test('the game starts by itself, and the first round sends the dead in through the chapel windows', () => {
  const h = new Horde(PRIORY, seeded(5));
  assert.equal(h.state.phase, 'waiting');
  assert.deepEqual(types(h.update(0.1, ['a'], { a: { dead: false, x: 0, z: 19 } })), ['intro']);
  assert.equal(h.player('a').pts, ZOMBIES.points.start);
  const ev = play(h, ZOMBIES.intro + 30);
  assert.ok(ev.some(e => e.type === 'round' && e.n === 1));
  const spawns = ev.filter(e => e.type === 'spawn');
  assert.ok(spawns.length >= 4, `the dead arrive: ${spawns.length}`);
  // only the chapel is open, so they can only come from its four windows
  assert.ok(spawns.every(s => s.window >= 0 && PRIORY.windows[s.window].zone === 'chapel'), JSON.stringify(spawns.map(s => s.window)));
  assert.ok(spawns.every(s => s.kind === 'walker' || s.kind === 'lurcher'), 'slow ones to begin with');
  // never more on their feet at once than the round allows
  assert.ok(h.state.alive <= ZOMBIES.maxAlive(1, 1));
  assert.equal(h.public().left, h.state.left + h.state.alive);
});

test('a round ends when every one of them is down, and the next is harder', () => {
  const h = new Horde(PRIORY, seeded(9));
  let rounds = [], spawned = 0;
  for (let t = 0; t < 400 && rounds.length < 3; t += 0.1) {
    for (const e of h.update(0.1, ['a'], { a: { dead: false, x: 0, z: 19 } })) {
      if (e.type === 'spawn') { spawned++; h.killed('a', false, e.x, e.z); }       // each is put down as soon as it appears
      if (e.type === 'round') rounds.push(e.n);
      if (e.type === 'break') assert.equal(h.state.alive, 0);
    }
  }
  assert.deepEqual(rounds, [1, 2, 3]);
  assert.equal(spawned, ZOMBIES.count(1, 1) + ZOMBIES.count(2, 1));
  assert.ok(ZOMBIES.count(5, 1) > ZOMBIES.count(1, 1) && ZOMBIES.count(3, 2) > ZOMBIES.count(3, 1), 'more each round, and more for more players');
  assert.ok(ZOMBIES.tough(10) > ZOMBIES.tough(1) * 3 && ZOMBIES.every(10) < ZOMBIES.every(1), 'tougher and quicker to arrive');
  assert.equal(h.player('a').kills, spawned);
  assert.equal(h.player('a').pts, ZOMBIES.points.start + spawned * ZOMBIES.points.kill);
});

test('the kinds of dead: slow ones first, runners and bombers later, a brute every fifth round', () => {
  const count = round => { const r = seeded(round * 7 + 1), c = {}; for (let i = 0; i < 400; i++) { const k = pickKind(round, r); c[k] = (c[k] || 0) + 1; } return c; };
  const one = count(1), eight = count(8);
  assert.ok(!one.runner && !one.bomber && one.walker > 300);
  assert.ok(eight.runner > 100 && eight.bomber > 5 && eight.bomber < 60, JSON.stringify(eight));
  for (const k of Object.values(KINDS)) assert.ok(GAITS[k.pace] && k.reach > 0.5 && k.tough > 0, k.label);
  const h = new Horde(PRIORY, seeded(3));
  h.update(0.1, ['a'], { a: { dead: false, x: 0, z: 19 } });
  h.state.round = 4; h.state.phase = 'break'; h.state.t = 0;
  const kinds = [];
  for (let t = 0; t < 300 && h.state.round <= 5; t += 0.1) for (const e of h.update(0.1, ['a'], { a: { dead: false, x: 0, z: 19 } })) if (e.type === 'spawn' && h.state.round === 5) { kinds.push(e.kind); h.killed('a', false, e.x, e.z, e.kind); }
  assert.equal(kinds.filter(k => k === 'brute').length, 1, 'round 5 brings one brute');
});

test('points buy doors, and a door opens more of the map to you and to them', () => {
  const h = new Horde(PRIORY, seeded(2));
  play(h, 1);
  assert.deepEqual([...h.open()], ['chapel']);
  assert.equal(h.buy('a', 'door:0').ok, false, 'not with 500 points');
  h.player('a').pts = 2000;
  // the tavern's door cannot be reached before the graveyard is open
  assert.equal(h.buy('a', 'door:1').ok, false);
  assert.equal(h.buy('a', 'sword').ok, false, 'nor can the sword on the graveyard wall');
  const res = h.buy('a', 'door:0');
  assert.ok(res.ok && res.kind === 'door' && res.opens === 'yard');
  assert.equal(h.player('a').pts, 2000 - PRIORY.doors[0].cost);
  assert.equal(h.buy('a', 'door:0').ok, false, 'it is open already');
  assert.deepEqual([...h.open()].sort(), ['chapel', 'yard']);
  assert.ok(h.spawns().some(s => s.window < 0), 'graves count now');
  assert.ok(h.spawns().every(s => s.zone === 'chapel' || s.zone === 'yard'));
  assert.equal(h.public().doors[0], 1);
});

test('weapons, armour, tonics and the forge', () => {
  const h = new Horde(PRIORY, seeded(4));
  play(h, 1);
  const p = h.player('a');
  p.pts = 60000;
  for (let i = 0; i < PRIORY.doors.length; i++) assert.ok(h.buy('a', 'door:' + i).ok, 'door ' + i);
  assert.equal(h.open().size, 7);
  // every weapon for sale exists, and costs what its sign says
  for (const s of PRIORY.shops.filter(x => x.kind === 'weapon')) {
    const before = p.pts, res = h.buy('a', s.id);
    assert.ok(res.ok && WEAPONS[res.item], s.id);
    assert.equal(before - p.pts, s.cost);
  }
  assert.equal(p.arrows, ZOMBIES.arrows, 'the bow comes with a quiver');
  p.arrows = 3;
  const more = h.buy('a', 'bow');
  assert.ok(more.ok && more.kind === 'arrows' && more.cost < PRIORY.shops.find(s => s.id === 'bow').cost && p.arrows === ZOMBIES.arrows, 'buying it again fills the quiver for less');
  // armour: one of each
  assert.ok(h.buy('a', 'helmet', null, [0, 0]).ok);
  assert.equal(h.buy('a', 'helmet', null, [6, 0]).ok, false);
  // tonics: once each, and they do what they say
  assert.equal(h.armour('a'), 1); assert.equal(h.power('a'), 1);
  for (const id of Object.keys(TONICS)) { assert.ok(h.buy('a', id).ok, id); assert.equal(h.buy('a', id).ok, false); }
  assert.equal(h.armour('a'), 0.5);
  assert.equal(h.power('a'), 1.75);
  assert.equal(h.power('a', true), 3.5, 'a forged weapon doubles it again');
  // the forge wants a weapon that has not been through it
  assert.equal(h.buy('a', 'forge', null).ok, false);
  assert.ok(h.buy('a', 'forge', { weapon: true, forged: false }).ok);
  assert.equal(h.buy('a', 'forge', { weapon: true, forged: true }).ok, false);
  assert.equal(h.public().pl.a[1], 15, 'all four tonics show');
});

test('the chest gives something after a moment, and takes it back if it is left', () => {
  const h = new Horde(PRIORY, seeded(11));
  play(h, 1);
  h.player('a').pts = 30000;
  for (let i = 0; i < PRIORY.doors.length; i++) h.buy('a', 'door:' + i);
  assert.ok(h.buy('a', 'chest').ok);
  assert.equal(h.buy('a', 'chest').ok, false, 'one at a time');
  let ev = play(h, ZOMBIES.chest.roll + 0.5);
  const got = ev.find(e => e.type === 'chest');
  assert.ok(got && WEAPONS[got.item]);
  assert.equal(h.public().chest[0], 'ready');
  h.took();
  assert.equal(h.public().chest[0], 'shut');
  assert.ok(h.buy('a', 'chest').ok);
  ev = play(h, ZOMBIES.chest.roll + ZOMBIES.chest.wait + 1);
  assert.ok(types(ev).includes('chest-gone'), 'left too long, it goes back in');
});

test('windows: the dead pull the boards off, players put them back for points (so many a round)', () => {
  const h = new Horde(PRIORY, seeded(6));
  play(h, 1);
  for (let i = 0; i < ZOMBIES.boards; i++) h.tear(2);
  assert.equal(h.state.boards[2], 0);
  assert.equal(h.tear(2), 0, 'no fewer than none');
  const before = h.player('a').pts;
  for (let i = 0; i < ZOMBIES.boards; i++) assert.equal(h.repair('a', 2), ZOMBIES.points.board);
  assert.equal(h.state.boards[2], ZOMBIES.boards);
  assert.equal(h.repair('a', 2), -1, 'nothing to mend');
  assert.equal(h.player('a').pts, before + ZOMBIES.boards * ZOMBIES.points.board);
  // after the round's allowance, mending still works but pays nothing
  for (let i = 0; i < 8; i++) { h.tear(3); h.repair('a', 3); }
  assert.equal(h.repair('a', 0), -1);
  h.tear(0);
  assert.equal(h.repair('a', 0), 0);
});

test('what the dead leave behind', () => {
  const h = new Horde(PRIORY, () => 0.01);      // every kill leaves something
  play(h, ZOMBIES.intro + 1);
  const ev = h.killed('a', true, 2, 15);
  assert.equal(h.player('a').pts, ZOMBIES.points.start + ZOMBIES.points.head, 'a head earns more');
  assert.deepEqual(types(ev), ['drop']);
  assert.equal(h.public().drops.length, 1);
  assert.equal(h.grab('a', 10, 10), null, 'not from over there');
  const got = h.grab('a', 2.3, 15.2);
  assert.ok(got && got.kind === ev[0].kind);
  assert.equal(h.public().drops.length, 0);
  // each kind does its thing
  const set = kind => { h.state.drops.push({ k: 99, kind, x: 0, z: 0, t: 9 }); return h.grab('a', 0, 0); };
  set('insta'); assert.equal(h.power('a'), 1000);
  set('double'); const pts = h.player('a').pts; h.hit('a'); assert.equal(h.player('a').pts, pts + 2 * ZOMBIES.points.hit);
  h.tear(1); h.tear(1); set('nails'); assert.equal(h.state.boards[1], ZOMBIES.boards);
  // they do not last for ever
  h.state.drops.push({ k: 100, kind: 'fire', x: 5, z: 5, t: 1 });
  play(h, 2);
  assert.equal(h.public().drops.length, 0);
});

test('dying: alone it is the end; with a friend you sit out the round; Nine Lives saves you once', () => {
  const h = new Horde(PRIORY, seeded(8));
  const two = { a: { dead: false, x: 0, z: 19 }, b: { dead: false, x: 1, z: 19 } };
  play(h, ZOMBIES.intro + 3, two);
  assert.equal(h.died('b'), 'out');
  two.b.dead = true;
  assert.deepEqual(types(play(h, 1, two)).filter(t => t === 'over'), [], 'one is still standing');
  assert.equal(h.public().pl.b[3], 1);
  assert.equal(h.buy('b', 'dagger').ok, false, 'the fallen cannot shop');
  // the round ends: the fallen get back up
  h.state.left = 0; h.state.alive = 0;
  const ev = play(h, 0.2, two);
  assert.ok(ev.some(e => e.type === 'up' && e.id === 'b'));
  two.b.dead = false;
  // Nine Lives
  h.player('a').pts = 5000; h.state.doors = h.state.doors.map(() => 1);
  assert.ok(h.buy('a', 'cat').ok);
  assert.equal(h.died('a'), 'saved');
  assert.equal(h.armour('a'), 0, 'and nothing can touch them for a moment');
  assert.equal(h.died('a'), 'out', 'only the once');
  assert.equal(h.public().pl.a[1], 0, 'tonics do not outlast you');
  // both down at once: over, and then it starts again
  two.a.dead = true; h.died('b'); two.b.dead = true;
  const end = play(h, 1, two);
  assert.ok(end.some(e => e.type === 'over'));
  assert.equal(h.public().phase, 'over');
  assert.ok(play(h, ZOMBIES.over + 1, two).some(e => e.type === 'restart'));
  assert.equal(h.public().round, 0);
  assert.equal(h.public().doors.reduce((a, b) => a + b, 0), 0, 'every door shut again');
});

test('the priory: every area can be walked, and nothing joins them but the doors', () => {
  const world = priory(), nav = new Nav(world);
  nav.build();
  const hw = PRIORY.door.w / 2;
  const doors = open => PRIORY.doors.forEach((d, i) => nav.block(d.nz ? { x: d.x - hw, z: d.z - 0.2 } : { x: d.x - 0.2, z: d.z - hw }, d.nz ? { x: d.x + hw, z: d.z + 0.2 } : { x: d.x + 0.2, z: d.z + hw }, !open.includes(i)));
  const mid = z => ({ x: (z[0] + z[2]) / 2, z: (z[1] + z[3]) / 2 });
  doors([]);
  let f = nav.field([{ x: 0, z: 19 }]);
  // with every door shut: the chapel and its four pits, and nowhere else
  for (const [name, zone] of Object.entries(PRIORY.zones)) assert.equal(Number.isFinite(nav.reach(f, mid(zone).x + 0.3, mid(zone).z + 0.3)), name === 'chapel', name);
  PRIORY.windows.forEach(w => { const [px, pz] = PRIORY.pit(w); assert.equal(Number.isFinite(nav.reach(f, px, pz)), w.zone === 'chapel', `pit of a ${w.zone} window`); });
  // open the lot: everywhere is reachable from the chapel, every pit and every grave
  doors(PRIORY.doors.map((d, i) => i));
  f = nav.field([{ x: 0, z: 19 }]);
  for (const [name, zone] of Object.entries(PRIORY.zones)) assert.ok(Number.isFinite(nav.reach(f, mid(zone).x + 0.3, mid(zone).z + 0.3)), name);
  for (const w of PRIORY.windows) { const [px, pz] = PRIORY.pit(w); assert.ok(Number.isFinite(nav.reach(f, px, pz)), 'a pit'); }
  for (const [gx, gz] of PRIORY.graves) assert.ok(Number.isFinite(nav.reach(f, gx + 1, gz)), 'beside a grave');
  // the two back doors make loops: the crypt is nearer the nave through its own door than the long way round
  const far = nav.reach(f, -18, -16);
  doors([0, 1, 4]);
  assert.ok(nav.reach(nav.field([{ x: 0, z: 19 }]), -18, -16) < far + 30);
  // nothing for sale is walled in, and each sign is in the area it says
  for (const s of PRIORY.shops) {
    assert.equal(PRIORY.zoneOf(s.pos[0] + s.nx * 0.6, s.pos[2] + s.nz * 0.6), s.zone, s.id);
    assert.ok(nav.nearest(s.pos[0] + s.nx * 0.8, s.pos[2] + s.nz * 0.8, 1.2) >= 0, `${s.id} can be walked up to`);
  }
  // where you start is clear floor
  assert.ok(nav.ok(nav.index(PRIORY.spawn[0], PRIORY.spawn[2])) && Math.abs(nav.floor[nav.index(PRIORY.spawn[0], PRIORY.spawn[2])] - PRIORY.floor) < 0.01);
});

test('finding the way: round walls, the short way, and not through shut doors', () => {
  const world = new World(); world.voxels = new VoxelWorld(); world.addBox(0, -1, 0, 72, 1, 72, 'grass');
  world.voxels.fill(-36, 0, 0, 36, 4, 0.5, 'stone');        // a wall right across, with one gap
  world.voxels.fill(5, 0, 0, 6, 4, 0.5, 'air');
  world.voxels.fill(-3, 0, 6, -2, 1, 7, 'crate');           // and a crate to stand on, on the far side
  world.voxels.finalize();
  const nav = new Nav(world);
  nav.build();
  assert.ok(!nav.ok(nav.index(0, 0.25)) && nav.ok(nav.index(5.5, 0.25)));
  // someone up on the crate can still be found: the way leads to beside it
  const up = nav.field([{ x: -2.5, z: 6.5 }]);
  assert.ok(nav.reach(up, 0, -4) < 30 && nav.reach(up, -2.5, 8) < 2, `to the crate: ${nav.reach(up, 0, -4)}`);
  assert.equal(nav.clear(0, -3, 0, 3), false);
  assert.equal(nav.clear(5.5, -3, 5.5, 3), true);
  const f = nav.field([{ x: 0, z: 4 }]), d = new THREE.Vector3();
  assert.ok(nav.dir(f, 0, -4, d) >= 0);
  assert.ok(d.x > 0.5, `from behind the wall the way is east, to the gap: ${d.toArray()}`);
  assert.ok(nav.reach(f, 0, -4) > 12 && nav.reach(f, 0, -4) < 18, `about 15 m round: ${nav.reach(f, 0, -4)}`);
  // in the open it is a straight line
  nav.dir(f, 3, 8, d);
  assert.ok(d.z < -0.7 && d.x < -0.4);
  // shut the gap: no way
  nav.block({ x: 5, z: 0 }, { x: 6, z: 0.5 }, true);
  assert.equal(nav.reach(nav.field([{ x: 0, z: 4 }]), 0, -4), Infinity);
  assert.equal(nav.dir(nav.field([{ x: 0, z: 4 }]), 0, -4, d), -1);
});

test('bots get about by pulling on the ground with their hands, at a steady pace for each gait', () => {
  const speeds = {};
  for (const gait of ['shuffle', 'walk', 'jog', 'run']) {
    const bot = new Bot('b', 1, flat(), V(0, 0.2, 0), { brain: 'still' });
    walk(bot, 1);
    const from = bot.loco.head.clone();
    let pinned = 0, frames = 0;
    walk(bot, 6, () => { bot.move.set(0, 0, -1); bot.gait = gait; bot.faceYaw = 0; frames++; if (bot.loco.hands[0].pinned || bot.loco.hands[1].pinned) pinned++; });
    speeds[gait] = (from.z - bot.loco.head.z) / 6;
    assert.ok(pinned > frames * 0.25, `${gait}: a hand is on the ground much of the time (${(pinned / frames * 100).toFixed(0)}%)`);
    assert.ok(Math.abs(bot.loco.head.x) < 0.5, `${gait}: in a straight line`);
  }
  assert.ok(speeds.shuffle > 0.6 && speeds.shuffle < 1.3, `shuffle ${speeds.shuffle.toFixed(2)} m/s`);
  assert.ok(speeds.walk > speeds.shuffle * 1.25 && speeds.jog > speeds.walk * 1.25 && speeds.run > speeds.jog * 1.2, JSON.stringify(speeds));
  assert.ok(speeds.run > 2.8 && speeds.run < 4.2, `run ${speeds.run.toFixed(2)} m/s`);
  // standing still, it stays where it is
  const idle = new Bot('b', 1, flat(), V(0, 0.2, 0), { brain: 'still' });
  walk(idle, 3);
  assert.ok(Math.hypot(idle.loco.head.x, idle.loco.head.z) < 0.05);
  // with one arm gone it still gets along, on the other
  const one = new Bot('b', 1, flat(), V(0, 0.2, 0), { brain: 'still' }), body = { dead: false, canUse: i => i === 0 };
  for (let i = 0; i < 72 * 5; i++) { one.move.set(1, 0, 0); one.gait = 'walk'; one.update(1 / 72, body); }
  assert.ok(one.loco.head.x > 4, `one-armed: ${one.loco.head.x.toFixed(1)} m in 5 s`);
  assert.ok(!one.loco.hands[1].pinned);
  // and it can jump
  const hop = new Bot('b', 1, flat(), V(0, 0.2, 0), { brain: 'still' });
  walk(hop, 1);
  let top = 0;
  hop.hop = true;
  walk(hop, 1.5, () => { top = Math.max(top, hop.loco.head.y); });
  assert.ok(top > 1.4, `a jump lifts its head from 0.8 to ${top.toFixed(2)} m`);
});

test('a zombie goes round a wall to reach you, and claws when it gets there', () => {
  const world = new World(); world.voxels = new VoxelWorld(); world.addBox(0, -1, 0, 72, 1, 72, 'grass');
  world.voxels.fill(-36, 0, 0, 36, 4, 0.5, 'stone'); world.voxels.fill(5, 0, 0, 6, 4, 0.5, 'air');
  world.voxels.finalize();
  const nav = new Nav(world);
  nav.build();
  const me = { id: 'a', pos: V(0, 0.8, 4) }, field = nav.field([me.pos]);
  const bot = new Bot('z1', 1, world, V(0, 0.2, -4), { name: '', brain: 'zombie', pace: 'jog', reach: 0.95, hitEvery: 0.8 });
  let east = 0, strikes = 0, t = 0;
  for (; t < 30 && !strikes; t += 1 / 72) {
    bot.step(1 / 72, null, null, { nav, field, foes: [me], barricades: [] });
    east = Math.max(east, bot.loco.head.x);
    if (bot.strike && bot.target === 'a') strikes++;
  }
  assert.ok(east > 4.5, `it went through the gap at the east end (got to x = ${east.toFixed(1)})`);
  assert.ok(strikes && t < 20, `and reached me in ${t.toFixed(1)} s`);
  assert.ok(bot.loco.head.distanceTo(me.pos) < 1.3);
});

test('a zombie at a boarded window stops and pulls the boards off before it comes in', () => {
  const world = flat();
  const bar = { id: 3, pos: V(0, 1, 0), nx: 0, nz: 1, boards: 2 };          // the way in is +z; the zombie starts outside (z < 0)
  const col = world.addBox(0, 0, 0, 3, 2, 0.5, 'plank');
  const me = { id: 'a', pos: V(0, 0.8, 5) };
  const bot = new Bot('z1', 1, world, V(0, 0.2, -2.5), { name: '', brain: 'zombie', pace: 'walk', hitEvery: 0.6 });
  const tears = [];
  let t = 0, inside = false;
  for (; t < 40 && !inside; t += 1 / 72) {
    bot.step(1 / 72, null, null, { nav: null, field: null, foes: [me], barricades: [bar] });
    for (const e of bot.events) if (e.type === 'tear') { tears.push(t); bar.boards--; if (bar.boards === 0) { col.min.y = -5; col.max.y = -4; } }      // the last board gone, the way is open
    assert.ok(!(bot.strike && bot.target), 'a blow at the boards is not a blow at me');
    if (tears.length < 2) assert.ok(bot.loco.head.z < 0.1, 'it does not come through while there are boards');
    inside = bot.loco.head.z > 1.5;
  }
  assert.deepEqual(tears.length, 2, 'one board for each blow');
  assert.ok(tears[0].toFixed && tears[1] - tears[0] > 0.4, 'not all at once');
  assert.ok(inside, `then it comes in (after ${t.toFixed(1)} s)`);
});

test('a fighting bot closes in, keeps its distance, strikes, guards and backs off when it is losing', () => {
  const world = flat(), bot = new Bot('g', 1, world, V(0, 0.2, 0), { brain: 'fight', alert: 1 }), body = new Body();
  const foe = { pos: V(0, 0.8, -8), threat: 0, blood: 100 };
  bot.weaponHand = 1; bot.shieldHand = 0;
  let strikes = 0, nearest = Infinity, sum = 0, n = 0;
  for (let t = 0; t < 14; t += 1 / 72) {
    bot.step(1 / 72, body, null, { foe, reach: 1.6 });
    if (bot.strike) strikes++;
    const d = Math.hypot(bot.loco.head.x - foe.pos.x, bot.loco.head.z - foe.pos.z);
    nearest = Math.min(nearest, d);
    if (t > 6) { sum += d; n++; }
  }
  assert.ok(strikes >= 3, `it attacked ${strikes} times`);
  // (it dances in and out; on the whole it is about as far away as it can reach)
  assert.ok(sum / n > 0.8 && sum / n < 2.6 && nearest > 0.2, `it fights from about its reach: ${(sum / n).toFixed(2)} m on average (never nearer than ${nearest.toFixed(2)})`);
  // bring it back to arm's length for what follows
  for (let t = 0; t < 6 && Math.hypot(bot.loco.head.x - foe.pos.x, bot.loco.head.z - foe.pos.z) > 2.2; t += 1 / 72) bot.step(1 / 72, body, null, { foe, reach: 1.6 });
  // facing its opponent
  const fwd = V(0, 0, -1).applyQuaternion(bot.pose.head.quat), to = foe.pos.clone().sub(bot.loco.head).setY(0).normalize();
  assert.ok(fwd.dot(to) > 0.8);
  // they swing: its shield comes up
  const low = bot.pose.hands[0].pos.y;
  foe.threat = 1; bot.cool = 5;
  for (let t = 0; t < 0.5; t += 1 / 72) bot.step(1 / 72, body, null, { foe, reach: 1.6 });
  assert.ok(bot.guard > 0.8 && bot.pose.hands[0].pos.y > low + 0.2, 'shield up');
  // badly hurt against a healthy opponent: it gives ground
  foe.threat = 0; body.blood = 20; bot._retreat = -5;
  let far = 0;
  for (let t = 0; t < 3; t += 1 / 72) { bot.step(1 / 72, body, null, { foe, reach: 1.6 }); far = Math.max(far, Math.hypot(bot.loco.head.x - foe.pos.x, bot.loco.head.z - foe.pos.z)); }
  assert.ok(far > 2.6, `it backed off to ${far.toFixed(1)} m`);
});

test('a sandbox dummy wanders, watches you, runs when it is hit, and stays put when told to', () => {
  const world = flat(), bot = new Bot('d', 1, world, V(0, 0.2, 0));
  assert.equal(bot.brain, 'dummy');
  const me = V(2, 0.8, 0);
  let moved = 0;
  for (let t = 0; t < 30; t += 1 / 72) { bot.step(1 / 72, null, null, { near: me }); moved = Math.max(moved, Math.hypot(bot.loco.head.x, bot.loco.head.z)); }
  assert.ok(moved > 1, `it wandered ${moved.toFixed(1)} m from where it began`);
  // hit: it gets away from whoever is nearest
  const at = bot.loco.head.clone(), near = at.clone().add(V(0.8, 0, 0));
  bot.knock(V(-1, 0, 0), 1);
  for (let t = 0; t < 2.5; t += 1 / 72) { bot.flinch = Math.max(bot.flinch, 0.5); bot.step(1 / 72, null, null, { near }); }
  assert.ok(bot.loco.head.distanceTo(near) > 1.8, `it got ${bot.loco.head.distanceTo(near).toFixed(1)} m away from them (it began at 0.8)`);
  // told to stay
  bot.wait = 1e9; bot.flinch = 0;
  for (let t = 0; t < 1.5; t += 1 / 72) bot.step(1 / 72, null, null, { near: me });       // (it comes to rest first)
  const here = bot.loco.head.clone();
  for (let t = 0; t < 4; t += 1 / 72) bot.step(1 / 72, null, null, { near: me });
  assert.ok(bot.loco.head.distanceTo(here) < 0.4);
});

test('arrows fly in an arc, stick in walls, and are stopped by whoever they hit', () => {
  const world = new World(); world.voxels = new VoxelWorld(); world.addBox(0, -1, 0, 72, 1, 72, 'grass');
  world.voxels.fill(-3, 0, -10.5, 3, 4, -10, 'stone');
  world.voxels.finalize();
  const arrows = new Arrows(null);
  arrows.shoot(1, V(0, 1.2, 0), V(0, 2, -30), 'a', 1);
  let stuck = null, top = 0;
  for (let t = 0; t < 2 && !stuck; t += 1 / 72) { arrows.update(1 / 72, world); top = Math.max(top, arrows.list[0].p.y); stuck = arrows.events.find(e => e.type === 'stuck'); }
  assert.ok(stuck && Math.abs(stuck.p.z + 10) < 0.1 && stuck.p.y > 1 && stuck.p.y < 2.2, `it stuck in the wall: ${stuck && stuck.p.toArray().map(v => v.toFixed(2))}`);
  assert.ok(top > 1.25, 'having risen and fallen on the way');
  assert.equal(arrows.list.length, 1, 'and it stays there');
  // one that meets somebody is taken out of the air, at the place it met them
  arrows.shoot(2, V(0, 1.2, 0), V(0, 0, 30), 'a', 1);
  let met = null;
  for (let t = 0; t < 1 && !met; t += 1 / 72) arrows.update(1 / 72, world, (from, to, a) => { if (to.z > 5) { met = a.id; return true; } return false; });
  assert.equal(met, 2);
  assert.ok(!arrows.list.some(a => a.id === 2));
  // a bow is a weapon you buy or spawn, not one that hangs in the arena
  assert.ok(WEAPONS.bow.bow.speed > 20 && !ARMS.includes('bow') && !ARMS.includes('greatsword') && WEAPONS.greatsword.dmg > WEAPONS.sword.dmg);
});

test('bodies can be made whole without losing their armour, and brought back from a death', () => {
  const b = new Body();
  b.wear(0); b.wear(1);
  b.hit('head', 10, { sharp: true });
  b.hit('foreL', 80, { sharp: true });
  assert.equal(b.cut[0], 1);
  b.heal();
  assert.deepEqual(b.cut, [0, 0]);
  assert.equal(b.blood, BODY.blood);
  assert.deepEqual(b.armour, [BODY.armour[0] - BODY.wear.sharp, BODY.armour[1]], 'the helmet is still dented');
  b.hit('torso', 9999, { pierce: true });
  assert.ok(b.dead);
  b.revive();
  assert.ok(!b.dead && b.blood === BODY.blood && b.armour[1] === BODY.armour[1]);
});

test('what is in reach to buy: a hand on the sign, or standing looking at it', () => {
  const h = new Horde(PRIORY, seeded(1));
  play(h, 1);
  const st = h.public(), dagger = PRIORY.shops.find(s => s.id === 'dagger');
  const hand = (x, y, z) => [{ x, y, z }, { x: x + 3, y, z }];
  let got = within(PRIORY, st, hand(dagger.pos[0], dagger.pos[1], dagger.pos[2] + 0.2), { x: 0, y: 1, z: 19 }, { x: 1, y: 0, z: 0 });
  assert.ok(got && got.what === 'dagger' && got.cost === 250 && /250/.test(got.label));
  // looking at the door from a step away, hands down
  got = within(PRIORY, st, hand(0, 0.4, 14), { x: 0, y: 1.2, z: 11.4 }, { x: 0, y: 0, z: -1 });
  assert.ok(got && got.what === 'door:0');
  // looking the other way: nothing
  assert.equal(within(PRIORY, st, hand(0, 0.4, 14), { x: 0, y: 1.2, z: 11.4 }, { x: 0, y: 0, z: 1 }), null);
  // an open door is not for sale, and a whole window needs nothing
  h.player('a').pts = 5000; h.buy('a', 'door:0');
  assert.equal(within(PRIORY, h.public(), hand(0, 0.4, 14), { x: 0, y: 1.2, z: 11.4 }, { x: 0, y: 0, z: -1 }), null);
  const w = PRIORY.windows[2];
  assert.equal(within(PRIORY, h.public(), hand(w.x + 0.4, 1.2, w.z), { x: 0, y: 1, z: 19 }, { x: 0, y: 0, z: 1 }), null);
  h.tear(2);
  got = within(PRIORY, h.public(), hand(w.x + 0.4, 1.2, w.z), { x: 0, y: 1, z: 19 }, { x: 0, y: 0, z: 1 });
  assert.ok(got && got.what === 'window:2' && got.cost === 0);
});
