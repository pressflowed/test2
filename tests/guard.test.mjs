// Headless checks of blocking, shields and armour. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WEAPONS, ARMS, BLOCK, weaponHold, guardOf, guardStops } from '../src/weapons.js';
import { ARMOUR, SLOTS } from '../src/armour.js';
import { Body, BODY } from '../src/body.js';
import { PROP_TYPES, SPAWNABLE, PropWorld } from '../src/props.js';
import { Bot } from '../src/bots.js';
import { World } from '../src/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q0 = new THREE.Quaternion();
const types = ev => ev.map(e => e.type);

test('a shield is a weapon you can spawn, but it is not handed out as one', () => {
  assert.ok(WEAPONS.shield.shield >= 0.3);
  assert.ok(!ARMS.includes('shield') && !ARMS.includes('bow') && ARMS.length === 6);
  for (const id of ['shield', 'helmet', 'chestplate']) assert.ok(SPAWNABLE.some(t => t.id === id), id);
  assert.ok(PROP_TYPES.find(t => t.id === 'helmet').armour && PROP_TYPES.find(t => t.id === 'shield').weapon);
});

test('a shield sits in front of the fist, facing the way the knuckles point', () => {
  const hold = weaponHold(WEAPONS.shield), knuckles = V(0, -1, 0);
  assert.ok(hold.offset.dot(knuckles) > 0.05, 'in front of the knuckles');
  const face = V(1, 0, 0).applyQuaternion(hold.rot);
  assert.ok(face.dot(knuckles) > 0.85, `its face looks along the knuckles: ${face.toArray()}`);
  // a sword is held by the hilt, with nothing pushed forward
  assert.ok(Math.abs(weaponHold(WEAPONS.sword).offset.dot(V(1, 0, 0).applyQuaternion(weaponHold(WEAPONS.sword).rot))) < 1e-6);
});

test('a blow that crosses a shield is stopped; one that goes round it is not', () => {
  const g = guardOf(WEAPONS.shield, V(0, 1.2, 0), Q0);          // face looking along +X
  assert.ok(g.disc && g.n.x > 0.99);
  assert.ok(guardStops(g, V(1, 1.2, 0), V(-1, 1.2, 0), 0.05), 'straight through the middle');
  assert.ok(guardStops(g, V(1, 1.4, 0.2), V(-1, 1.1, -0.1), 0.05), 'through it at an angle');
  assert.ok(guardStops(g, V(-1, 1.2, 0), V(1, 1.2, 0), 0.05), 'from behind too');
  assert.equal(guardStops(g, V(1, 1.2, 0.6), V(-1, 1.2, 0.6), 0.05), null, 'past its edge');
  assert.equal(guardStops(g, V(1, 2.0, 0), V(-1, 2.0, 0), 0.05), null, 'over the top');
  assert.equal(guardStops(g, V(1, 1.2, 0), V(0.4, 1.2, 0), 0.05), null, 'stopping short of it');
  assert.ok(guardStops(g, V(0.5, 1.2, 0), V(0.08, 1.2, 0), 0.05), 'ending on its face');
  const at = guardStops(g, V(1, 1.3, 0.1), V(-1, 1.3, 0.1), 0.05);
  assert.ok(Math.abs(at.x) < 1e-6 && Math.abs(at.y - 1.3) < 1e-6 && Math.abs(at.z - 0.1) < 1e-6, 'the place it struck is on the shield');
  // turned to face +Z, it stops what comes along Z instead
  const g2 = guardOf(WEAPONS.shield, V(0, 1.2, 0), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.PI / 2));
  assert.ok(g2.n.z > 0.99);
  assert.ok(guardStops(g2, V(0, 1.2, 1), V(0, 1.2, -1), 0.05));
  assert.equal(guardStops(g2, V(1, 1.2, 0.5), V(-1, 1.2, 0.5), 0.05), null, 'a blow passing in front of it, side to side');
});

test('a blade catches a blow that crosses it, along its length only', () => {
  const g = guardOf(WEAPONS.sword, V(0, 1.2, 0), Q0);            // upright: hilt below, tip above
  assert.ok(!g.disc && g.b.y > g.a.y && Math.abs(g.b.y - 1.7) < 1e-6);
  assert.ok(guardStops(g, V(-0.5, 1.4, 0.3), V(0.5, 1.4, -0.3), 0.05), 'a cut across the blade');
  assert.ok(guardStops(g, V(-0.5, 1.4, 0.1), V(0.5, 1.4, 0.1), 0.05), 'passing within a hand of it');
  assert.equal(guardStops(g, V(-0.5, 1.4, 0.4), V(0.5, 1.4, 0.4), 0.05), null, 'passing well clear');
  assert.equal(guardStops(g, V(-0.5, 2.0, 0), V(0.5, 2.0, 0), 0.05), null, 'over the tip');
  assert.equal(guardStops(g, V(-0.5, 0.6, 0), V(0.5, 0.6, 0), 0.05), null, 'under the hand');
  // a blow that has not moved (a fist resting there) still counts if it is on the blade
  assert.ok(guardStops(g, V(0.05, 1.5, 0), V(0.05, 1.5, 0), 0.07));
  assert.equal(guardStops(g, V(0.5, 1.5, 0), V(0.5, 1.5, 0), 0.07), null);
  assert.ok(BLOCK.window > 100 && BLOCK.clang > 0);
});

test('armour soaks up blows to what it covers, then is knocked off', () => {
  const b = new Body();
  assert.deepEqual(b.armour, [0, 0]);
  assert.ok(b.wear(0) && b.wear(1));
  assert.deepEqual(b.armour, BODY.armour);
  assert.equal(b.wear(0), false, 'one helmet at a time');
  // sword cuts to the head: the helmet takes three
  for (let i = 0; i < 2; i++) { const ev = b.hit('head', 40, { sharp: true }); assert.deepEqual(types(ev), ['armour']); assert.ok(ev[0].left > 0 && ev[0].slot === 0); }
  const last = b.hit('head', 40, { sharp: true });
  assert.equal(last[0].left, 0, 'the third knocks it off');
  assert.equal(b.blood, BODY.blood, 'and none of them drew blood');
  assert.ok(types(b.hit('head', 40, { sharp: true })).includes('hit'));
  assert.ok(b.blood < BODY.blood, 'a bare head bleeds');
});

test('a hammer wears armour down fastest and a fist slowest; arms are never covered', () => {
  const count = opts => { const b = new Body(); b.wear(1); let n = 0; while (b.armour[1] > 0) { b.hit('torso', 30, opts); n++; } return n; };
  assert.equal(count({ blunt: true }), Math.ceil(BODY.armour[1] / BODY.wear.blunt));
  assert.equal(count({ sharp: true }), Math.ceil(BODY.armour[1] / BODY.wear.sharp));
  assert.equal(count({}), BODY.armour[1]);
  assert.ok(count({ blunt: true }) < count({ sharp: true }) && count({ sharp: true }) < count({}));
  const b = new Body(); b.wear(0); b.wear(1);
  assert.ok(types(b.hit('foreL', 60, { sharp: true })).includes('sever'), 'an arm comes off, armour or no');
  assert.deepEqual(b.armour, BODY.armour);
  // a chest plate does nothing for the head, and a blast goes through everything
  const c = new Body(); c.wear(1);
  assert.ok(types(c.hit('head', 20)).includes('hit'));
  assert.ok(types(c.hit('torso', 20, { pierce: true })).includes('hit'));
  assert.equal(c.armour[1], BODY.armour[1]);
});

test('armour is sent to other players, and gone when you come back from the dead', () => {
  const a = new Body(), b = new Body();
  a.wear(0); a.wear(1); a.hit('torso', 30, { blunt: true });
  assert.equal(b.apply(a.pack()), true, 'something to redraw');
  assert.deepEqual(b.armour, a.armour);
  assert.deepEqual(b.view.armour, a.armour);
  assert.equal(b.apply(a.pack()), false);
  a.hit('head', 500, { pierce: true });
  assert.ok(a.dead);
  for (let t = 0; t < BODY.respawn + 1; t += 0.1) a.update(0.1);
  assert.ok(!a.dead);
  assert.deepEqual(a.armour, [0, 0]);
  assert.deepEqual(SLOTS.map(id => ARMOUR[id].slot), [0, 1]);
  assert.deepEqual(SLOTS.map(id => ARMOUR[id].part), ['head', 'torso']);
});

test('armour and shields are props like any other: they sync, and a dented piece stays dented', () => {
  const ground = () => { const w = new World(); w.addBox(0, -1, 0, 40, 1, 40, 'grass'); return w; };
  const host = new PropWorld(new THREE.Scene(), ground(), true), guest = new PropWorld(new THREE.Scene(), ground(), false);
  host.spawn('helmet', V(0, 1, 0), null, { wounds: 1 });
  host.spawn('chestplate', V(1, 1, 0));
  const sh = host.spawn('shield', V(2, 1, 0));
  host.grab(sh.id, { key: 'p:0', pos: V(2, 1, 0), quat: new THREE.Quaternion() });
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  const got = [...guest.props.values()].map(p => [p.type.id, p.wounds, p.heldKey]);
  assert.deepEqual(got, [['helmet', 1, null], ['chestplate', 0, null], ['shield', 0, 'p:0']]);
});

test('a bot with a shield holds it up in front of its chest, facing forward', () => {
  const world = new World();
  world.addBox(0, -1, 0, 40, 1, 40, 'grass');
  const bot = new Bot('b1', 1, world, V(0, 0.2, 0));
  bot.wait = 1e9; bot.shieldHand = 0;
  for (let i = 0; i < 30; i++) bot.update(1 / 60, null);
  const fwd = V(0, 0, -1).applyQuaternion(bot.pose.head.quat), hand = bot.pose.hands[0];
  const rel = hand.pos.clone().sub(bot.pose.head.pos);
  assert.ok(rel.dot(fwd) > 0.3 && rel.y < -0.2 && rel.y > -0.6, `in front, at chest height: ${rel.toArray().map(v => v.toFixed(2))}`);
  const hold = weaponHold(WEAPONS.shield), face = V(1, 0, 0).applyQuaternion(hand.quat.clone().multiply(hold.rot));
  assert.ok(face.dot(fwd) > 0.8, `the shield faces the way the bot does: ${face.dot(fwd).toFixed(2)}`);
  // and the other arm hangs as usual
  assert.ok(bot.pose.hands[1].pos.y < hand.pos.y);
});
