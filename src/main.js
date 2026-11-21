// Canopy Tag: arm-push movement in a breakable voxel world, with a sandbox mode
// (props, arm menu, bodies to fight), a hide and seek mode (one giant, tiny hiders) and
// an arena mode (a knockout tournament with weapons), solo or online.
import * as THREE from 'three';
import { World } from './physics.js';
import { Locomotion } from './locomotion.js';
import { Avatar, SKIN, fingertip } from './avatar.js';
import { DesktopInput } from './input-desktop.js';
import { VRInput } from './input-vr.js';
import { initAudio, tap, boom, boing, crunch, jingle, thump, heartbeat, smack, tear } from './audio.js';
import { Voice } from './voice.js';
import { buildScenery, lightButton } from './sandbox.js';
import { SPAWNABLE, propVisual, propSize, BLAST_RADIUS, weaponHold } from './props.js';
import { SWING, swingPower } from './weapons.js';
import { gibWounds } from './gibs.js';
import { ARENA, roundName } from './arena.js';
import { Net } from './net.js';
import { Session, GRAVITY, GRAVITY_LABEL } from './session.js';
import { ArmMenu, SIZES, POWERS } from './armmenu.js';
import { Sky, SKIES } from './sky.js';
import { BlobShadows, Blasts, Debris, Blood } from './fx.js';
import { setBodyTemplate } from './gibs.js';
import { BODY } from './body.js';
import { RIG, hitPart, grabArm } from './bodyrig.js';
import { MAX_BOTS } from './bots.js';
import { VoxelWorld, VOXEL, MATERIALS } from './voxels.js';
import { VoxelRenderer } from './voxelmesh.js';
import { MAPS, COLOSSEUM } from './maps.js';
import { ROUND } from './rounds.js';
import { Hud } from './hud.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const UP = new THREE.Vector3(0, 1, 0);

// ---- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4e6f7, 35, 120);
const hemi = new THREE.HemisphereLight(0xe8f6ff, 0x4a5a2a, 1.6);
const sun = new THREE.DirectionalLight(0xfff0d2, 1.7);
scene.add(hemi, sun);
const sky = new Sky(scene, hemi, sun);
const shadows = new BlobShadows(scene);
const blasts = new Blasts(scene);
const debris = new Debris(scene);
const blood = new Blood(scene);
const hud = new Hud(scene);

// the rig is the player's play space; camera and controllers live inside it
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, 1, 0.03, 260);
rig.add(camera);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- world, player, inputs
const world = new World();
const voxels = world.voxels = new VoxelWorld();
const level = buildScenery(scene, world);
const voxelView = new VoxelRenderer(scene, voxels);
const saved = readSettings();
const loco = new Locomotion(world, saved.bodyHeight ? { bodyHeight: saved.bodyHeight } : {});

const desktop = new DesktopInput(canvas);
const vr = new VRInput(renderer, rig);
desktop.onRespawn = respawn;

const me = { name: saved.name || randomName(), color: saved.color ?? SKIN };
const avatarTemplate = Avatar.loadTemplate('assets/body-rig.glb');
let avatar = null;
avatarTemplate
  .then(t => { setBodyTemplate(t); avatar = new Avatar(t, scene, { color: me.color }); avatar.firstPerson = true; })
  .catch(err => { console.error(err); status('Could not load the body model. Movement still works.', 'error'); });

const net = new Net();
const session = new Session({ scene, world, net, loco, me, avatarTemplate });
const armMenu = new ArmMenu(scene);
const voice = new Voice(net);

const stats = { speed: 0, best: 0, bodyHeight: loco.cfg.bodyHeight, mode: 'desktop' };
let sizeIdx = SIZES.indexOf(1), powerIdx = POWERS.indexOf(1);
let calib = 0;            // seconds left on the calibrate countdown (0 = not calibrating)
let carry = null;         // the mini item in my right hand: { typeId, mesh }
const lastPunch = [0, 0];
let lastThump = 0;        // when I last shook the ground (ms), to limit how often
let beatT = 0;            // seconds until my next heartbeat while the giant is near

// Big players shake the ground. How far it is felt, and how close the giant must be
// before a hider's heart starts pounding.
const SHAKE = { minScale: 1.5, soundRange: 45, rumbleRange: 22, heartRange: 15, every: 110 };

// How hard a hit has to be to break something, in metres per second of real hand speed
// straight into the surface. Hitting downward needs a real slam, so running across the
// top of something does not crater it.
const PUNCH = { hit: 2.6, slam: 4.5, cooldown: 120 };

// Fighting. A hand moving faster than `speed` (m/s, at normal size) that lands on someone
// is a punch; a slow hand squeezing grip on an arm takes hold of it instead.
const FIGHT = { speed: 2.2, cooldown: 160, grabReach: 0.13, keyPower: 30 };
const RIP_LENGTH = (RIG.upper + RIG.fore + RIG.palmOffset) * BODY.ripStretch;   // pull a held arm this far from its shoulder and it tears off
const touching = [null, null];   // whose body each of my hands is inside right now
const lastHit = [0, 0];
const armHold = [null, null];    // the arm each of my hands took hold of with this squeeze: { id, arm }
let wasDead = false;
// Weapons stay in the hand once picked up. In VR, two quick squeezes of grip let go (one
// squeeze would be too easy to do by accident in a fight); with a keyboard, G again.
const stuck = [false, false];    // this hand's weapon stays put
const latch = [false, false];    // grip has to be let go before this hand grabs again
const lastSqueeze = [0, 0];      // when grip was last squeezed with a weapon in the hand (ms)
const DOUBLE_SQUEEZE = 450;      // ms between the two squeezes
let weaponTips = 2;              // how many more times to explain that
const tipHist = [[], []];        // recent positions of each held weapon's business end
const wTouch = [null, null];     // whose body each weapon is inside right now
const holds = {};                // how each kind of weapon sits in a fist
// when I die I drift up and back out of my body, to watch it fall
const death = { at: new THREE.Vector3(), lift: new THREE.Vector3(), t: 0, headless: false };
let woundT = 0;
const MODES = ['sandbox', 'hideseek', 'arena'];
// How much damage a punch does to someone my own size: harder with speed, much harder if I am big.
const punchPower = (v, s) => Math.min(Math.max((v - 1.5) * 9, 6), 60) * s ** 1.5;

// start near the map's spawn point, spread out a little so friends don't land inside each other
function respawn() {
  const map = MAPS[session.settings.mode] || MAPS.sandbox, role = session.role();
  if (role === 'fighter' || role === 'spectator') {
    // the arena: fighters to their own rooms, everyone else to a seat
    const others = [session.myId, ...[...session.players.values()].filter(p => !p.bot).map(p => p.id)].sort();
    const spot = role === 'fighter' ? COLOSSEUM.rooms[session.arena.a === session.myId ? 0 : 1] : COLOSSEUM.seat(others.indexOf(session.myId) * 2);
    loco.teleport(new THREE.Vector3().fromArray(spot.spawn || spot.pos), spot.yaw);
    desktop.yaw = 0;
    return;
  }
  const at = role === 'giant' ? map.giantSpawn : map.spawn;
  const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.4;
  loco.teleport(new THREE.Vector3(at[0] + Math.cos(a) * r, at[1], at[2] + Math.sin(a) * r * 0.5), 0);
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem('canopy-settings')) || {}; } catch (e) { return {}; }
}
function saveSettings() {
  try { localStorage.setItem('canopy-settings', JSON.stringify({ bodyHeight: loco.cfg.bodyHeight, name: me.name, color: me.color })); } catch (e) { /* private mode */ }
}
function randomName() {
  const a = ['Bony', 'Rattle', 'Skully', 'Dusty', 'Clack', 'Femur', 'Chalky', 'Marrow'];
  return a[Math.floor(Math.random() * a.length)] + Math.floor(10 + Math.random() * 90);
}

// ---- size, power and the things that depend on them
function applyView() {
  const s = loco.scale, p = SKIES[session.settings.sky] || SKIES.day;
  rig.scale.setScalar(s);
  // fog and draw distance are measured in "player units", so adjust them for size
  scene.fog.near = 35 / s; scene.fog.far = p.fogFar / s;
  camera.far = 260 / Math.min(s, 1);
  camera.updateProjectionMatrix();
}
// Your size and power come from the arm menu, unless a hide and seek round gives you a role.
function applySizing() {
  const role = session.role();
  const plain = role === 'ghost' || role === 'fighter' || role === 'spectator';     // everyone is the same size in the arena
  const scale = role === 'giant' ? ROUND.giantScale : role === 'hider' ? ROUND.hiderScale : plain ? 1 : SIZES[sizeIdx];
  loco.power = role === 'giant' ? ROUND.giantPower : role === 'hider' ? ROUND.hiderPower : plain ? 1 : POWERS[powerIdx];
  if (loco.scale !== scale) { loco.setScale(scale, headLocal); applyView(); }
}
function setSize(i) {
  sizeIdx = Math.min(Math.max(i, 0), SIZES.length - 1);
  applySizing();
}
function setPower(i) {
  powerIdx = Math.min(Math.max(i, 0), POWERS.length - 1);
  applySizing();
}

// ---- 2D menu
const menu = $('menu');
function status(text, kind = '') { const el = $('status'); el.textContent = text; el.dataset.kind = kind; }

function playDesktop() {
  initAudio();
  stats.mode = 'desktop';
  desktop.enabled = true;
  menu.hidden = true;
  desktop.lock();
}
$('desktop').addEventListener('click', playDesktop);
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && desktop.enabled && !renderer.xr.isPresenting) {
    desktop.enabled = false;
    $('desktop').textContent = 'Keep playing on desktop';
    menu.hidden = false;
  }
});

const vrBtn = $('vr');
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if (ok) { vrBtn.disabled = false; vrBtn.textContent = 'Enter VR'; }
    else vrBtn.textContent = 'VR not available here';
  }).catch(() => { vrBtn.textContent = 'VR not available here'; });
} else {
  vrBtn.textContent = window.isSecureContext ? 'VR not available here' : 'VR needs an https:// link';
}
vrBtn.addEventListener('click', async () => {
  initAudio();
  try {
    const xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await renderer.xr.setSession(xrSession);
    desktop.enabled = false;
    stats.mode = 'vr';
    menu.hidden = true;
    armMenu.visible = true;
    if (session.role() === 'free') respawn();
    xrSession.addEventListener('end', () => { stats.mode = 'desktop'; menu.hidden = false; });
  } catch (err) {
    console.error(err);
    status('Could not start VR: ' + err.message, 'error');
  }
});

// name and colour
const nameInput = $('name');
nameInput.value = me.name;
nameInput.addEventListener('change', () => {
  me.name = nameInput.value.trim().slice(0, 16) || randomName();
  nameInput.value = me.name;
  session.setMe(me.name, me.color); saveSettings();
});
for (const sw of document.querySelectorAll('.swatch')) {
  const c = parseInt(sw.dataset.color, 16);
  sw.style.background = '#' + sw.dataset.color;
  sw.setAttribute('aria-pressed', String(c === me.color));
  sw.addEventListener('click', () => {
    me.color = c;
    for (const o of document.querySelectorAll('.swatch')) o.setAttribute('aria-pressed', String(o === sw));
    if (avatar) avatar.setColor(c);
    session.setMe(me.name, me.color); saveSettings();
  });
}

// rooms
const codeInput = $('code');
function renderRoom() {
  const role = net.role;
  $('room-solo').hidden = role !== 'solo';
  $('room-on').hidden = role === 'solo';
  if (role !== 'solo') {
    $('room-code').textContent = net.code;
    $('room-link').textContent = `${location.origin}${location.pathname}?room=${net.code}`;
    $('room-who').textContent = role === 'host'
      ? `You are hosting. ${session.playerCount} player${session.playerCount === 1 ? '' : 's'} in the room.`
      : `You joined. ${session.playerCount} players in the room.`;
  }
  for (const btn of document.querySelectorAll('[data-mode]')) btn.setAttribute('aria-pressed', String(btn.dataset.mode === session.settings.mode));
  $('mic').textContent = !voice.on ? 'Turn on microphone' : voice.muted ? 'Microphone muted (click to unmute)' : 'Microphone on (click to mute)';
  $('mic').setAttribute('aria-pressed', String(voice.speaking));
  $('voice-note').textContent = net.role === 'solo'
    ? 'Voice chat works once you are in a room with someone.'
    : `You can hear ${voice.connected} of ${session.playerCount - 1} other player${session.playerCount === 2 ? '' : 's'}. Voices get quieter with distance.`;
  $('mode-note').textContent = session.settings.mode === 'hideseek'
    ? (session.playerCount < 2 ? 'Hide and seek starts when a second player joins. You can explore the map until then.' : 'Rounds run by themselves: one giant, everyone else hides.')
    : session.settings.mode === 'arena'
      ? 'A knockout tournament in a colosseum. Two fighters at a time pick weapons in their own rooms, then the gates open. Bots fill in if you are alone.'
      : 'Build, spawn props, smash things and fight freely.';
}
session.onChange = () => { renderRoom(); voice.sync(session.peers); };
voice.onChange = renderRoom;
// someone huge hit the ground somewhere: hear it, and feel it if it was close
session.onThump = (pos, strength) => {
  const d = pos.distanceTo(loco.head);
  thump(strength * Math.max(0, 1 - d / SHAKE.soundRange) ** 1.5);
  const near = Math.max(0, 1 - d / SHAKE.rumbleRange);
  if (near > 0) for (let i = 0; i < 2; i++) vr.pulse(i, Math.min(1, 0.15 + strength * near), 60 + 160 * strength * near);
  if (strength > 0.5 && d < 30) debris.burst([0, 1, 2, 3].map(() => [pos.x + (Math.random() - 0.5), pos.y + 0.1, pos.z + (Math.random() - 0.5), 0x8a7a5c]), pos, 0.1, GRAVITY[session.settings.gravity]);
};
session.onSettings = s => { sky.set(s.sky); applyView(); };
// bodies: blood, noise and feeling it when it happens to me
session.onBleed = pos => blood.spray(pos, null, 2, 0.7, 0.016);
session.onBodyFx = e => {
  if (!e.p) return;
  const mine = e.id === session.myId, by = e.by === session.myId;
  const p = new THREE.Vector3().fromArray(e.p);
  const vol = Math.min(1, 4 / (p.distanceTo(loco.head) + 2));
  const sc = session.poses.get(e.id)?.scale || 1;
  const red = '#ff5a4a';
  if (e.k === 'hit') {
    const dir = new THREE.Vector3().fromArray(e.d), hard = Math.min(e.dmg, 45) / 45;
    blood.spray(p, dir, 4 + Math.round(hard * 12), 2.4 * Math.sqrt(sc), 0.019 * sc);
    smack(vol * (0.45 + 0.55 * hard));
    if (mine) {
      hud.hurt(0.35 + 0.6 * hard);
      loco.vel.addScaledVector(dir, e.push); loco.vel.y += e.push * 0.4;       // knocked back
      for (let i = 0; i < 2; i++) vr.pulse(i, 0.5 + 0.5 * hard, 120);
    }
  } else if (e.k === 'sever') {
    blood.spray(p, null, 36, 3 * Math.sqrt(sc), 0.021 * sc);
    tear(vol);
    if (mine) {
      const other = session.body().cut[e.arm ? 0 : 1] > 0;
      hud.hurt(1);
      hud.flash(`Your ${e.arm ? 'right' : 'left'} ${e.level === 1 ? 'forearm' : 'arm'} is gone!`, other ? 'Both arms gone: you are bleeding out' : 'You can still use the other one', 4, red);
      for (let i = 0; i < 2; i++) vr.pulse(i, 1, 350);
    } else if (by) for (let i = 0; i < 2; i++) vr.pulse(i, 0.9, 150);
  } else if (e.k === 'behead') {
    // the neck fountains
    blood.spray(p, UP, 50, 4.2 * Math.sqrt(sc), 0.022 * sc);
    tear(vol);
    if (mine) death.headless = true;
    else if (by) for (let i = 0; i < 2; i++) vr.pulse(i, 1, 200);
  } else if (e.k === 'die') {
    blood.spray(p, null, e.blast ? 90 : 30, (e.blast ? 4.5 : 2.6) * Math.sqrt(sc), 0.025 * sc);
    if (e.blast) tear(vol * 0.7);
    smack(vol);
    if (!mine && (by || !session.isBot(e.id))) hud.flash(by ? `You killed ${session.nameOf(e.id)}` : `${session.nameOf(e.id)} died`, '', 2.5);
  } else if (e.k === 'grab' && mine) {
    hud.flash(`${session.nameOf(e.by)} has your arm!`, 'It tears off if it is pulled too far', 3, red);
    for (let i = 0; i < 2; i++) vr.pulse(i, 0.8, 200);
  }
};
// the arena tournament moved on: gates, the board, where I should be, and what to tell me
function arenaLine(st) {
  const n = id => session.nameOf(id);
  return st.phase === 'intro' ? `Starts in ${st.t}` : st.phase === 'prep' ? `Gates open in ${st.t}` : st.phase === 'fight' ? `FIGHT  ${mmss(st.t)}`
    : st.phase === 'result' ? `${n(st.w)} wins` : st.phase === 'champion' ? `Champion: ${n(st.champion)}` : '';
}
session.onArena = (st, prev) => {
  const me = session.myId, mine = st.a === me || st.b === me, n = id => session.nameOf(id), gold = '#ffd76a';
  level.setGates(st.phase === 'waiting' || st.phase === 'fight');
  level.bracket.draw(st, n, arenaLine(st));
  if (st.phase === prev.phase && st.r === prev.r && st.m === prev.m && st.n === prev.n) return;     // only the clock moved
  applySizing();
  if (session.settings.mode !== 'arena') return;
  const onFloor = Math.hypot(loco.head.x, loco.head.z) < COLOSSEUM.radius + 1 || COLOSSEUM.roomOf(loco.head.x, loco.head.z) >= 0;
  if (st.phase === 'intro') {
    respawn();
    hud.flash(`Tournament ${st.n}`, `${st.rounds[0].reduce((k, m) => k + (m[0] != null) + (m[1] != null), 0)} fighters, one winner`, 5, gold);
    jingle([392, 523, 659, 784]);
  } else if (st.phase === 'prep') {
    if (mine || onFloor) respawn();           // fighters to their rooms; nobody else stays on the sand
    const title = roundName(st.rounds[st.r].length);
    if (mine) hud.flash('You fight next!', `${title} against ${n(st.a === me ? st.b : st.a)}. Take a weapon off the wall`, 6, gold);
    else hud.flash(`${n(st.a)} vs ${n(st.b)}`, title, 4);
    jingle([523, 659]);
  } else if (st.phase === 'fight') {
    if (!mine && onFloor) respawn();          // (someone who has just joined, say)
    hud.flash('FIGHT!', mine ? 'The gate is open' : '', 2.5, '#ff5a4a');
    jingle([659, 523, 392, 262]);
    if (mine) for (let i = 0; i < 2; i++) vr.pulse(i, 1, 250);
  } else if (st.phase === 'result') {
    const lost = st.w === st.a ? st.b : st.a;
    const who = lost === me ? 'You' : n(lost);
    const why = st.why === 'away' ? `${who} stayed off the sand too long` : st.why === 'time' ? 'Time ran out: more blood left wins' : st.why === 'left' ? `${who} left` : '';
    if (mine) hud.flash(st.w === me ? 'You win!' : 'You lose', why, 5, st.w === me ? '#9be15d' : '#ff5a4a');
    else hud.flash(`${n(st.w)} wins`, why, 4);
    jingle(st.w === me ? [523, 659, 784] : [392, 330]);
  } else if (st.phase === 'champion') {
    hud.flash(st.champion === me ? 'YOU ARE THE CHAMPION' : `${n(st.champion)} is the champion`, 'A new tournament starts soon', 8, gold);
    jingle([523, 659, 784, 1047, 784, 1047]);
    // fireworks over the arena
    for (let k = 0; k < 6; k++) setTimeout(() => { if (session.settings.mode === 'arena') blasts.add(new THREE.Vector3((Math.random() - 0.5) * 18, 9 + Math.random() * 5, (Math.random() - 0.5) * 18), 3 + Math.random() * 3); }, k * 450);
  } else if (st.phase === 'waiting' && prev.phase !== 'waiting') hud.flash('Waiting for fighters', 'The arena needs two', 4);
};
session.onMap = mode => {
  level.setMap(mode);
  level.bracket.draw(session.arena, id => session.nameOf(id), '');
  blood.clear();
  if (carry) { scene.remove(carry.mesh); carry = null; }
  applySizing();
  respawn();
};
session.onCarve = (pos, radius, res) => {
  // rubble, noise, and a thump in the hands if it happened close by
  debris.burst(res.samples.map(([x, y, z, m]) => [x, y, z, MATERIALS[m].color]), pos, VOXEL * 0.9, GRAVITY[session.settings.gravity]);
  const d = pos.distanceTo(loco.head), big = res.count + res.collapsed;
  crunch(MATERIALS[res.samples[0] ? res.samples[0][3] : 4].kind, Math.min(1, (0.35 + big / 250) * 5 / (d + 4)));
  if (d < radius + 1.5 * loco.scale) for (let i = 0; i < 2; i++) vr.pulse(i, Math.min(1, 0.4 + big / 300), 60);
};
session.onRound = (r, prev) => {
  const role = session.role(), me = session.myId;
  applySizing();
  if (r.phase === 'waiting') {
    if (prev.phase !== 'waiting') hud.flash('Waiting for players', 'Hide and seek needs two or more');
    return;
  }
  if (r.phase === 'hide' && r.n !== prev.n) {              // a new round
    respawn();
    if (role === 'giant') hud.flash('You are the GIANT', `Wait ${ROUND.hide} seconds while they hide`, 5, '#ff8a55');
    else hud.flash('HIDE!', `${session.nameOf(r.giant)} is the giant. You have ${ROUND.hide} seconds`, 5, '#9be15d');
    jingle([392, 523, 659]);
  } else if (r.phase === 'hunt' && prev.phase === 'hide') {
    if (role === 'giant') hud.flash('GO!', 'Smash things. Touch a hider to catch them', 4, '#ff8a55');
    else hud.flash('The giant is loose', 'Stay out of sight', 4, '#ff8a55');
    jingle([659, 523, 392, 262]);
    for (let i = 0; i < 2; i++) vr.pulse(i, 1, 250);
  }
  for (const id of r.out) {
    if (prev.out.includes(id)) continue;
    if (id === me) {
      // back to normal size, out in the open, so you never grow inside a hiding hole
      respawn();
      hud.flash('Caught!', 'You can watch the rest of the round', 4, '#ff8a55');
      for (let i = 0; i < 2; i++) vr.pulse(i, 1, 300);
    }
    else hud.flash(`${session.nameOf(id)} was caught`, '', 3);
    jingle([330, 262]);
  }
  if (r.phase === 'over' && prev.phase !== 'over' && r.winner) {
    const won = (r.winner === 'giant') === (r.giant === me);
    hud.flash(r.winner === 'giant' ? 'The giant wins' : 'The hiders win', won ? 'Nice one! Next round soon' : 'Next round soon', 7, won ? '#9be15d' : '#f4eed6');
    jingle(won ? [523, 659, 784, 1047] : [392, 330, 262]);
  }
};
session.onButton = (id, on) => {
  const b = level.buttons.find(x => x.id === id);
  if (!b) return;
  lightButton(b, on);
  if (id !== 'lowgrav') setTimeout(() => lightButton(b, false), 250);
};
session.onBoom = pos => {
  blasts.add(pos, BLAST_RADIUS);
  const d = pos.distanceTo(loco.head);
  boom(Math.min(1, 6 / (d + 2)));
  if (d < BLAST_RADIUS * loco.scale + 1) {
    // blown away from the blast, and up
    const k = 1 - d / (BLAST_RADIUS * loco.scale + 1);
    const dir = loco.head.clone().sub(pos); dir.y = Math.max(dir.y, 0); dir.normalize();
    loco.vel.addScaledVector(dir, 11 * k); loco.vel.y += 7 * k;
    for (let i = 0; i < 2; i++) vr.pulse(i, 1, 200);
  }
};
$('host').addEventListener('click', async () => {
  status('Opening a room...');
  try { await session.host(); status(''); } catch (e) { status(e.message, 'error'); }
  renderRoom();
});
async function joinRoom(code) {
  if (!code) { status('Type the room code your friend sees.', 'error'); return; }
  status(`Joining room ${code.toUpperCase()}...`);
  try { await session.join(code); status(''); } catch (e) { status(e.message, 'error'); }
  renderRoom();
}
$('join').addEventListener('click', () => joinRoom(codeInput.value));
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(codeInput.value); });
$('leave').addEventListener('click', () => { session.leave(); voice.reset(); renderRoom(); });
// voice chat: the first click asks for the microphone, later clicks mute and unmute
async function toggleMic() {
  if (voice.on) { voice.setMuted(!voice.muted); return; }
  status('Asking for your microphone...');
  try { await voice.enable(); status('Microphone on. Friends hear you louder when you are close.', 'ok'); }
  catch (e) { status(e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it for this site in the browser, then try again.' : 'Could not use the microphone: ' + e.message, 'error'); }
}
$('mic').addEventListener('click', toggleMic);
function micLabel() { return !voice.on ? 'Mic off' : voice.muted ? 'Mic muted' : 'Mic on'; }
$('copy').addEventListener('click', async () => {
  const text = $('room-link').textContent;
  try { await navigator.clipboard.writeText(text); status('Link copied.', 'ok'); }
  catch (e) { getSelection().selectAllChildren($('room-link')); status('Select the link and copy it.', ''); }
});
// game mode (anyone in the room can switch it)
for (const btn of document.querySelectorAll('[data-mode]')) btn.addEventListener('click', () => session.setMode(btn.dataset.mode));
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) { codeInput.value = roomParam.toUpperCase(); joinRoom(roomParam); }
renderRoom();

// ---- arm menu actions (poked in VR, or keys on desktop)
function menuAction(id) {
  if (id.startsWith('item:')) { session.select(id.slice(5)); return; }
  if (id.startsWith('mode:')) { session.setMode(id.slice(5)); return; }
  const free = session.role() === 'free';
  switch (id) {
    case 'size-': if (free) setSize(sizeIdx - 1); break;
    case 'size+': if (free) setSize(sizeIdx + 1); break;
    case 'power-': if (free) setPower(powerIdx - 1); break;
    case 'power+': if (free) setPower(powerIdx + 1); break;
    case 'skip': session.skipRound(); break;
    case 'mic':
      // the browser can only ask for the microphone from the start menu, not inside VR
      if (voice.on) voice.setMuted(!voice.muted);
      else if (!renderer.xr.isPresenting) toggleMic();
      else hud.flash('Microphone is off', 'Turn it on from the start menu first', 4);
      break;
    case 'resetmap': session.resetMap(); break;
    case 'smash': case 'pvp': session.pressButton(id); break;
    case 'addbot': session.addBot(); break;
    case 'clearbots': session.clearBots(); break;
    case 'calibrate': calib = 3.99; break;   // counts down so you can put your arms down first
    case 'home': if (free) respawn(); break;
    case 'undo': session.undo(); break;
    case 'gravity': case 'sky': case 'rain': case 'balloons': case 'clear': session.pressButton(id); break;
  }
}

// A hand hit a breakable surface: was it hard enough to smash it?
function tryPunch(e, now) {
  const s = loco.scale;
  if (s < 0.7 || !session.canBreak() || now - lastPunch[e.hand] < PUNCH.cooldown) return false;
  const into = -e.vel.dot(e.normal) / s;
  const need = e.normal.y > 0.7 ? PUNCH.slam : PUNCH.hit;
  if (into < need) return false;
  const mat = voxels.matAt(e.point.x - e.normal.x * 0.13 * s, e.point.y - e.normal.y * 0.13 * s, e.point.z - e.normal.z * 0.13 * s);
  const hard = mat ? MATERIALS[mat].hard : 1;
  // harder hits and softer stuff make bigger dents
  const r = s * Math.min(0.26 + (into - need) * 0.06, 0.55) * hard;
  if (!session.punch(e.point.clone().addScaledVector(e.normal, -r * 0.45), r)) return false;
  lastPunch[e.hand] = now;
  vr.pulse(e.hand, 1, 90);
  return true;
}

// Tell everyone the ground shook here (not too often).
function shake(point, strength, now) {
  if (loco.scale < SHAKE.minScale || now - lastThump < SHAKE.every) return;
  lastThump = now;
  session.thump(point, strength);
  thump(strength * 0.6);
}

// A big player came down hard: crack the ground under them and knock a few blocks loose nearby.
function stomp(e, now) {
  const s = loco.scale, hard = e.speed / s;            // metres per second, at normal size
  if (s < SHAKE.minScale || hard < 2.2) return;
  const power = Math.min((hard - 2.2) / 4, 1);
  lastThump = 0;
  shake(e.point, 0.55 + 0.45 * power, now);
  for (let i = 0; i < 2; i++) vr.pulse(i, 0.5 + 0.5 * power, 120);
  if (!session.canBreak() || power < 0.25) return;
  if (e.col && e.col.voxel) session.punch(e.point.clone().setY(e.point.y - 0.1 * s), s * (0.22 + 0.2 * power));
  // loose blocks: chip the ground around the landing, and any walls close by
  const from = new THREE.Vector3(), dir = new THREE.Vector3();
  let chips = 0;
  for (let n = 0; n < 10 && chips < 2 + Math.round(power * 3); n++) {
    const a = Math.random() * Math.PI * 2;
    let hit;
    if (n % 2) {            // straight down onto a spot a little way off
      const d = (0.8 + Math.random() * 1.6) * s;
      hit = voxels.raycast(from.set(e.point.x + Math.cos(a) * d, e.point.y + 2 * s, e.point.z + Math.sin(a) * d), dir.set(0, -1, 0), 5 * s);
    } else {                // sideways at whatever stands nearby
      hit = voxels.raycast(from.copy(e.point).setY(e.point.y + 0.4 * s), dir.set(Math.cos(a), Math.random() * 0.6 - 0.1, Math.sin(a)).normalize(), 1.8 * s);
    }
    if (hit && session.punch(hit.point.addScaledVector(hit.normal, -0.08), 0.2 + Math.random() * 0.12)) chips++;
  }
}

// The weapon in one of my hands, if any (a prop).
function heldWeapon(i) {
  const p = session.held[i] != null ? session.props.props.get(session.held[i]) : null;
  return p && p.type.weapon ? p : null;
}

// My hands against other bodies: a fast hand (or weapon) landing on someone hurts them.
function fight(now) {
  const s = loco.scale, mine = session.body();
  for (let i = 0; i < 2; i++) {
    const hp = localPose.hands[i].pos;
    let on = null, part = null;
    const wp = heldWeapon(i);
    if (wp && mine.canUse(i)) {
      // a weapon: its business end is what counts, and how fast that is moving
      const w = wp.type.weapon, hold = holds[wp.type.id] || (holds[wp.type.id] = weaponHold(w)), hq = localPose.hands[i].quat;
      const q = tmpQ.copy(hq).multiply(hold.rot), base = tmpV.copy(hold.offset).applyQuaternion(hq).add(hp), pt = new THREE.Vector3();
      for (const [x, y] of w.hits) {
        pt.set(x, y, 0).applyQuaternion(q).add(base);
        if (!on) for (const [id, rg] of session.rigs) {
          if (!session.canHurt(id) || rg.head.distanceTo(pt) > 1.3 * rg.scale + 0.5) continue;
          part = hitPart(rg, session.body(id).cut, pt, w.r);
          if (part) { on = id; break; }
        }
      }
      const hist = tipHist[i], last = hist[hist.length - 1];        // pt is now the last point: the far end
      if (last && last.p.distanceTo(pt) > 2 * s) hist.length = 0;   // teleported
      hist.push({ p: pt.clone(), t: now });
      while (hist.length > 5) hist.shift();
      const v = hist.length > 1 ? hist[hist.length - 1].p.distanceTo(hist[0].p) / Math.max((hist[hist.length - 1].t - hist[0].t) / 1000, 1e-3) / s : 0;
      if (on && wTouch[i] !== on && now - lastHit[i] > 250 && v > SWING.min) {
        lastHit[i] = now;
        session.hit(on, part, swingPower(w, v, s), i, wp.id);
        vr.pulse(i, 1, 120);
      }
      wTouch[i] = on; touching[i] = null;
      continue;
    }
    tipHist[i].length = 0; wTouch[i] = null;
    if (mine.canUse(i)) for (const [id, rg] of session.rigs) {
      if (!session.canHurt(id) || rg.head.distanceTo(hp) > 1.3 * (rg.scale + s)) continue;
      part = hitPart(rg, session.body(id).cut, hp, RIG.handR * s);
      if (part) { on = id; break; }
    }
    // only the moment the hand arrives counts, so resting a hand on someone does nothing
    if (on && touching[i] !== on && now - lastHit[i] > FIGHT.cooldown && session.held[i] == null && !armHold[i] && !(i === 1 && carry)) {
      const v = handVelocity(i).length() / s;
      if (v > FIGHT.speed && v < 30) {      // faster than any arm: that was a teleport, not a punch
        lastHit[i] = now;
        session.hit(on, part, punchPower(v, s), i);
        vr.pulse(i, 1, 90);
      }
    }
    touching[i] = on;
  }
}

// Squeezing grip with a slow hand on someone's arm takes hold of it. Returns true if it did.
function tryHoldArm(i) {
  const s = loco.scale, hp = localPose.hands[i].pos;
  if (!session.body().canUse(i) || handVelocity(i).length() / s > FIGHT.speed) return false;
  for (const [id, rg] of session.rigs) {
    if (!session.canHurt(id) || rg.head.distanceTo(hp) > 1.3 * (rg.scale + s)) continue;
    const their = session.body(id), arm = grabArm(rg, their.cut, hp, FIGHT.grabReach * s);
    if (arm < 0 || their.held[arm]) continue;
    session.holdArm(id, arm, i);
    armHold[i] = { id, arm, t: performance.now(), ok: false };
    return true;
  }
  return false;
}

// Desktop: the bot you are looking at loses an arm (there is no way to pull with a mouse).
function ripAhead() {
  const s = loco.scale, dir = new THREE.Vector3(0, 0, -1).applyQuaternion(localPose.head.quat), to = new THREE.Vector3();
  let best = null, bd = 2.4 * s;
  for (const [id, rg] of session.rigs) {
    if (!session.isBot(id) || !session.canHurt(id)) continue;
    const d = to.copy(rg.torsoTop).sub(localPose.head.pos).length();
    if (d < bd && to.dot(dir) / d > 0.6) { bd = d; best = id; }
  }
  if (!best) return false;
  const cut = session.body(best).cut, arm = cut[0] <= cut[1] ? 0 : 1;     // the more whole arm first
  if (cut[arm] >= 2) return false;
  session.ripArm(best, arm, 1);
  return true;
}

// Desktop: punch whoever or whatever is within reach of where you are looking.
function punchAhead() {
  const s = loco.scale;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(localPose.head.quat);
  const mine = session.body();
  // the hand with a weapon in it, if there is one
  const hand = heldWeapon(1) && mine.canUse(1) ? 1 : heldWeapon(0) && mine.canUse(0) ? 0 : mine.canUse(1) ? 1 : mine.canUse(0) ? 0 : -1;
  if (hand < 0) return;
  const wp = heldWeapon(hand), w = wp && wp.type.weapon;
  desktop.swing(hand);
  if (session.settings.mode !== 'hideseek') {
    const p = new THREE.Vector3(), reach = 1.7 * s + (w ? w.hits[w.hits.length - 1][1] - w.hilt : 0);
    for (let d = 0.15; d <= reach; d += 0.1) {
      p.copy(localPose.head.pos).addScaledVector(dir, d);
      for (const [id, rg] of session.rigs) {
        if (!session.canHurt(id)) continue;
        const part = hitPart(rg, session.body(id).cut, p, 0.09 * s);
        if (part) { session.hit(id, part, w ? swingPower(w, 5, s) : FIGHT.keyPower * s ** 1.5, hand, wp ? wp.id : null); return; }
      }
    }
  }
  if (s < 0.7 || !session.canBreak()) return;
  const hit = voxels.raycast(localPose.head.pos, dir, 1.7 * s);
  if (hit) { const r = 0.42 * s * MATERIALS[hit.mat].hard; session.punch(hit.point.addScaledVector(hit.normal, -r * 0.45), r); }
}

function mmss(t) { return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

// The small line of text that stays on screen during hide and seek and in the arena.
function roundStatus() {
  if (session.settings.mode === 'arena') {
    const st = session.arena, me = session.myId, mine = st.a === me || st.b === me, n = id => session.nameOf(id);
    if (st.phase === 'waiting') return 'Arena: waiting for fighters';
    if (st.phase === 'intro') return `Tournament ${st.n} starts in ${st.t}`;
    if (st.phase === 'prep') return mine ? `Pick a weapon!  Gate opens in ${st.t}` : `Next: ${n(st.a)} vs ${n(st.b)}  ·  ${st.t}`;
    if (st.phase === 'fight') {
      const left = mine ? st.away[st.a === me ? 0 : 1] : -1;
      return left >= 0 ? `Get onto the sand!  ${left}` : mine ? `FIGHT  ${mmss(st.t)}` : `${n(st.a)} vs ${n(st.b)}  ${mmss(st.t)}`;
    }
    if (st.phase === 'result') return `${n(st.w)} wins`;
    if (st.phase === 'champion') return `Champion: ${n(st.champion)}  ·  next tournament in ${st.t}`;
    return '';
  }
  if (session.settings.mode !== 'hideseek') return '';
  const r = session.round, role = session.role();
  if (r.phase === 'waiting') return 'Hide and seek: waiting for another player';
  const left = session.playerCount - 1 - r.out.length;
  if (r.phase === 'hide') return role === 'giant' ? `They are hiding... ${r.t}` : `Hide! Giant in ${r.t}`;
  if (r.phase === 'hunt') return role === 'giant' ? `Find them!  ${mmss(r.t)}  ·  ${left} left` : role === 'ghost' ? `Caught  ·  ${mmss(r.t)}` : `Stay hidden  ${mmss(r.t)}`;
  return '';
}
function gameLines() {
  if (session.settings.mode === 'arena') {
    const st = session.arena, n = id => session.nameOf(id);
    if (st.phase === 'waiting') return ['Arena', 'Waiting for fighters.'];
    const title = `Tournament ${st.n}: ${roundName(st.rounds[st.r].length)}`;
    if (st.phase === 'champion') return [title, `Champion: ${n(st.champion)}`];
    if (st.a == null) return [title, `Starts in ${st.t}`];
    return [title, `${n(st.a)} vs ${n(st.b)}`, arenaLine(st)];
  }
  if (session.settings.mode !== 'hideseek') return ['Punch, grab and pull arms. Bots are for practice.'];
  const r = session.round;
  if (r.phase === 'waiting') return ['Hide and seek', 'Waiting for another player.', 'Explore the map until then.'];
  const what = { hide: 'hiding', hunt: 'hunting', over: 'over' }[r.phase];
  return [`Round ${r.n}: ${what} ${r.phase === 'over' ? '' : mmss(r.t)}`, `Giant: ${session.nameOf(r.giant)}`, `Hiders left: ${session.playerCount - 1 - r.out.length}`];
}

function startCarry(typeId) {
  session.select(typeId);
  const { geo, mat } = propVisual(typeId);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(0.09 / propSize(typeId) * loco.scale);
  scene.add(mesh);
  carry = { typeId, mesh };
}
function throwCarry(vel) {
  session.throwItem(carry.typeId, carry.mesh.position, vel);
  scene.remove(carry.mesh);
  carry = null;
}

// ---- main loop
const headLocal = new THREE.Vector3(0, 1.5, 0), headQuatLocal = new THREE.Quaternion();
const handLocals = [new THREE.Vector3(), new THREE.Vector3()];
const handQuatsLocal = [new THREE.Quaternion(), new THREE.Quaternion()];
const rigQuat = new THREE.Quaternion();
const localPose = {
  head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
  hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
  scale: 1,
};
const handHist = [[], []];   // recent hand positions for throwing
const tip = new THREE.Vector3(), menuPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
let last = performance.now(), boardT = 0, gameTime = 0;
session.loadMap('sandbox');
applyView();

function handVelocity(i) {
  const h = handHist[i];
  if (h.length < 2) return new THREE.Vector3();
  const a = h[0], b = h[h.length - 1];
  return b.p.clone().sub(a.p).divideScalar(Math.max((b.t - a.t) / 1000, 1e-3));
}

renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  gameTime += dt;
  const inVR = renderer.xr.isPresenting;
  const playing = inVR || desktop.enabled;
  let active;
  // what the player asked for this frame
  const act = { spawn: false, throw: false, next: 0, slot: null, undo: false, del: [false, false], grab: [false, false], grabEdge: [false, false], grabStart: false, respawn: false, punch: false, rip: false, menu: [] };
  const mode = session.settings.mode;
  const tools = mode === 'sandbox';                       // spawning and deleting are sandbox-only
  const role = session.role();
  const hands = tools || role === 'fighter';              // may pick things up
  const combat = tools || (role === 'fighter' && session.arena.phase === 'fight');
  const waiting = role === 'giant' && session.round.phase === 'hide';   // the giant waits, blind, while they hide
  const myBody = session.body(), dead = myBody.dead;
  const frozen = waiting || dead;
  if (dead !== wasDead) {
    wasDead = dead;
    if (dead) {
      hud.flash(death.headless ? 'You lost your head' : 'You died', `Back in ${BODY.respawn} seconds`, BODY.respawn, '#ff5a4a');
      if (carry) { scene.remove(carry.mesh); carry = null; }
      for (let i = 0; i < 2; i++) vr.pulse(i, 1, 500);
      jingle([262, 196, 131]);
      // drift up and back, out of the body, to watch it fall
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(localPose.head.quat).setY(0);
      if (back.lengthSq() < 0.01) back.set(0, 0, 1);
      death.at.copy(loco.origin); death.t = 0;
      death.lift.copy(back.normalize()).multiplyScalar(1.3 * loco.scale).setY(0.75 * loco.scale);
    } else {
      death.headless = false;
      respawn();
      hud.flash('Back in one piece', '', 2.5, '#9be15d');
    }
  }

  if (inVR) {
    if (!vr.update(frame)) { renderer.render(scene, camera); return; }
    if (vr.turn) loco.turn(-vr.turn * Math.PI / 4, vr.headLocal);
    const [L, R] = vr.hands;
    act.spawn = R.buttons.trigger.pressed;
    act.del[0] = L.buttons.trigger.pressed;
    act.next = R.buttons.primary.pressed ? 1 : 0;
    act.undo = R.buttons.secondary.pressed;
    if (L.buttons.primary.pressed) armMenu.visible = !armMenu.visible;
    act.respawn = L.buttons.secondary.pressed;
    act.grab = [L.buttons.grip.down, R.buttons.grip.down];
    act.grabEdge = [L.buttons.grip.pressed, R.buttons.grip.pressed];
    act.grabStart = R.buttons.grip.pressed;
    headLocal.copy(vr.headLocal); headQuatLocal.copy(vr.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(vr.hands[i].local); handQuatsLocal[i].copy(vr.hands[i].quat); }
    active = vr.active;
  } else {
    if (desktop.enabled) {
      desktop.update(dt);
      const { pressed, wheel } = desktop.takeInput();
      const k = c => pressed.has(c);
      act.throw = k('KeyF');
      act.punch = k('KeyJ');
      act.rip = k('KeyY');
      if (k('KeyO')) session.setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
      if (k('KeyK')) session.skipRound();
      act.spawn = k('KeyV');
      act.undo = k('KeyZ');
      act.del[1] = k('KeyX');
      act.next = wheel;
      for (let n = 1; n <= 8; n++) if (k('Digit' + n)) act.slot = n - 1;
      act.grab = [false, !!desktop.keys.KeyG];
      act.grabEdge = [false, k('KeyG')];
      if (k('KeyM')) armMenu.visible = !armMenu.visible;
      if (k('KeyT')) { armMenu.visible = true; armMenu.nextTab(); }
      if (k('Comma')) armMenu.nextPage(-1);
      if (k('Period')) armMenu.nextPage(1);
      for (const [code, id] of [['BracketLeft', 'size-'], ['BracketRight', 'size+'], ['Minus', 'power-'], ['Equal', 'power+'],
        ['KeyL', 'gravity'], ['KeyN', 'sky'], ['KeyP', 'rain'], ['KeyB', 'balloons'], ['KeyC', 'clear'], ['KeyH', 'smash'], ['Backspace', 'resetmap'],
        ['KeyU', 'addbot'], ['KeyI', 'clearbots'], ['Digit0', 'pvp']]) if (k(code)) act.menu.push(id);
    }
    headLocal.copy(desktop.headLocal); headQuatLocal.copy(desktop.headQuat);
    for (let i = 0; i < 2; i++) {
      desktop.hands[i].armed = !!heldWeapon(i);       // a fist round a weapon is held thumb-up
      handLocals[i].copy(desktop.hands[i].local); handQuatsLocal[i].copy(desktop.hands[i].quat);
    }
    active = desktop.active;
  }

  if (playing && frozen) {
    // held in place: no moving, no touching
    loco.vel.set(0, 0, 0);
    if (dead) {
      death.t += dt;
      const k = Math.min(death.t / 0.9, 1);
      loco.origin.copy(death.at).addScaledVector(death.lift, k * k * (3 - 2 * k));
    }
    loco.toWorld(headLocal, loco.head);
    for (let i = 0; i < 2; i++) { loco.toWorld(handLocals[i], loco.hands[i].pos); loco.hands[i].pinned = false; }
  } else if (playing) {
    if (act.respawn && role === 'free') respawn();
    if (calib > 0) {
      const before = Math.ceil(calib);
      calib -= dt;
      if (Math.ceil(calib) < before && calib > 0) for (let i = 0; i < 2; i++) vr.pulse(i, 0.3, 40);
      if (calib <= 0) {
        calib = 0;
        if (inVR && vr.hands[0].tracked && vr.hands[1].tracked) {
          const handsY = (vr.hands[0].local.y + vr.hands[1].local.y) / 2;
          loco.cfg.bodyHeight = Math.min(Math.max(vr.headLocal.y - handsY + 0.05, 0.45), 1.3);
          saveSettings();
          for (let i = 0; i < 2; i++) vr.pulse(i, 0.7, 150);
        }
      }
    }
    // climbable props are part of the world for the movement code
    world.colliders = world.statics.concat(session.propColliders());
    // a hand that is gone, or that someone has hold of, cannot push off anything
    loco.update(dt, headLocal, handLocals, [active[0] && myBody.canUse(0), active[1] && myBody.canUse(1)]);
    for (const e of loco.events) {
      if (e.type === 'touch') {
        if (e.col.voxel && tryPunch(e, now)) continue;
        tap(e.kind, 0.25 + 0.75 * e.strength, e.hand === 0 ? -0.5 : 0.5);
        if (inVR) vr.pulse(e.hand, 0.2 + 0.6 * e.strength, 25 + 40 * e.strength);
        if (e.col && e.col.button) session.pressButton(e.col.button);
        if (e.strength > 0.45) shake(e.point, 0.2 + 0.3 * e.strength, now);   // a giant's hand slapping down
      } else if (e.type === 'land') {
        stomp(e, now);
      } else if (e.type === 'launch') {
        stats.best = Math.max(stats.best, e.speed);
      } else if (e.type === 'pad') {
        boing(0.8);
        for (let i = 0; i < 2; i++) vr.pulse(i, 0.8, 80);
      }
    }
    if (loco.head.y < -5) respawn();
  }

  // move the rig to where physics put the player
  rig.position.copy(loco.origin);
  rig.rotation.set(0, loco.yaw, 0);
  rig.updateMatrixWorld();
  if (!inVR) { camera.position.copy(desktop.headLocal); camera.quaternion.copy(desktop.headQuat); }

  // my pose in world space
  const s = loco.scale;
  rigQuat.setFromAxisAngle(UP, loco.yaw);
  loco.toWorld(headLocal, localPose.head.pos);
  localPose.head.quat.copy(rigQuat).multiply(headQuatLocal);
  localPose.scale = s;
  for (let i = 0; i < 2; i++) {
    localPose.hands[i].pos.copy(loco.hands[i].pos);
    localPose.hands[i].quat.copy(rigQuat).multiply(handQuatsLocal[i]);
    const prev = handHist[i][handHist[i].length - 1];
    if (prev && prev.p.distanceTo(localPose.hands[i].pos) > 1.2 * s) handHist[i].length = 0;   // teleported: that was not a swing
    handHist[i].push({ p: localPose.hands[i].pos.clone(), t: now });
    while (handHist[i].length > 6) handHist[i].shift();
  }
  const rh = localPose.hands[1];
  fingertip(rh.pos, rh.quat, s, tip);

  // arm menu: floats above the left hand facing you (VR), or sits at the side of the screen (desktop)
  if (inVR) {
    menuPose.pos.copy(localPose.hands[0].pos).lerp(localPose.head.pos, 0.08);
    menuPose.pos.y += 0.17 * s;
    menuPose.quat.setFromRotationMatrix(tmpM.lookAt(localPose.head.pos, menuPose.pos, UP));
  } else {
    menuPose.pos.set(-0.34, -0.05, -0.62).multiplyScalar(s).applyQuaternion(localPose.head.quat).add(localPose.head.pos);
    menuPose.quat.copy(localPose.head.quat).multiply(tmpQ.setFromAxisAngle(UP, 0.4));
  }
  const pressedIds = armMenu.update(dt, menuPose, s, inVR && playing ? tip : null, {
    selected: session.selectedType.id, size: SIZES[sizeIdx], power: POWERS[powerIdx],
    gravity: GRAVITY_LABEL[session.settings.gravity], sky: SKIES[session.settings.sky].label, smash: session.settings.smash,
    room: net.role === 'solo' ? 'Solo' : `Room ${net.code}`, players: session.playerCount,
    calib: calib > 0 ? Math.ceil(calib) : 0,
    mode, locked: !tools, roleLocked: role !== 'free', game: gameLines(), mic: micLabel(),
    bots: session.botCount, maxBots: MAX_BOTS, pvp: session.settings.pvp,
  });
  if (pressedIds.length && inVR) vr.pulse(1, 0.5, 30);
  for (const id of pressedIds.concat(act.menu)) menuAction(id);

  if (playing && act.punch && !frozen) punchAhead();

  // things you do with your hands: fighting, and (in the sandbox) spawning and building
  let overItem = null;
  if (playing && combat && !dead) fight(now);
  if (playing && tools && !dead) {
    if (act.rip) ripAhead();
    const n = SPAWNABLE.length;
    if (act.slot != null) { const t = SPAWNABLE[armMenu.page * 8 + act.slot]; if (t) session.select(t.id); }
    if (act.next) { session.selected = (session.selected + act.next + n) % n; armMenu.showItem(session.selectedType.id); }
    const fingers = tmpV.copy(tip).sub(rh.pos).normalize();
    // grabbing an item out of the menu takes priority over grabbing a prop
    overItem = act.grabStart && !carry && session.held[1] == null ? armMenu.itemAt(tip) : null;
    if (overItem) { startCarry(overItem); vr.pulse(1, 0.6, 50); }
    if (carry) {
      carry.mesh.position.copy(rh.pos).addScaledVector(fingers, 0.07 * s);
      carry.mesh.rotation.y += dt * 3;
      if (!act.grab[1]) throwCarry(handVelocity(1).multiplyScalar(1.2));
    }
    if (act.throw) {
      // desktop: lob the selected item where you are looking
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(localPose.head.quat);
      session.throwItem(session.selectedType.id, rh.pos.clone().addScaledVector(dir, 0.3 * s), dir.multiplyScalar(8 * Math.sqrt(s)).add(new THREE.Vector3(0, 2.5, 0)));
    }
    if (act.spawn && !armMenu.hover) { session.spawnSelected(rh.pos, fingers, s); if (inVR) vr.pulse(1, 0.4, 40); }
    if (act.undo) session.undo();
  }
  if (playing && hands && !dead) {
    for (let i = 0; i < 2; i++) {
      const hp = localPose.hands[i].pos;
      if (tools && act.del[i] && session.deleteNear(hp, s) && inVR) vr.pulse(i, 0.5, 60);
      const busy = i === 1 && (carry || overItem);
      if (session.held[i] == null) stuck[i] = false;
      if (!act.grab[i]) latch[i] = false;
      // a weapon stays in the hand until grip is squeezed twice quickly (or G is pressed again)
      if (stuck[i] && act.grabEdge[i]) {
        if (!inVR || now - lastSqueeze[i] < DOUBLE_SQUEEZE) { session.release(i, handVelocity(i)); stuck[i] = false; latch[i] = true; lastSqueeze[i] = 0; continue; }
        lastSqueeze[i] = now;
      }
      // grip: an arm within reach comes before a prop. One hold per squeeze.
      if (act.grab[i] && !latch[i] && !busy && combat && session.held[i] == null && !armHold[i] && tryHoldArm(i) && inVR) vr.pulse(i, 0.7, 60);
      if (!act.grab[i] && armHold[i]) { session.letGoArm(i); armHold[i] = null; }
      const has = armHold[i] ? session.holding(i) : null;
      if (has) armHold[i].ok = true;
      else if (armHold[i] && !armHold[i].ok && now - armHold[i].t > 600) armHold[i] = null;   // the host never agreed: this squeeze may try again
      if (has && inVR) {
        // feel the arm stretch: the buzz grows until it tears
        const rg = session.rigs.get(has.id);
        if (rg) vr.pulse(i, Math.min(1, 0.1 + 0.9 * (hp.distanceTo(rg.shoulder[has.arm]) / (RIP_LENGTH * rg.scale)) ** 2), 30);
      }
      if (act.grab[i] && !latch[i] && !busy && !armHold[i] && session.held[i] == null && session.grab(i, hp, s)) {
        stuck[i] = !!heldWeapon(i);
        lastSqueeze[i] = 0;
        if (inVR) vr.pulse(i, stuck[i] ? 0.9 : 0.5, stuck[i] ? 90 : 50);
        if (stuck[i] && weaponTips-- > 0) hud.flash(heldWeapon(i).type.label, inVR ? 'It stays in your hand. Squeeze grip twice quickly to drop it' : 'It stays in your hand. Press G again to drop it', 4);
      }
      if (!act.grab[i] && session.held[i] != null && !stuck[i]) session.release(i, handVelocity(i));
    }
  }
  session.update(dt, localPose);

  // voices: louder when close, and from the side they are on
  voice.update(dt, localPose.head.pos, tmpV.set(1, 0, 0).applyQuaternion(localPose.head.quat), id => session.headOf(id));

  // a hider's heart pounds as the giant closes in: faster and harder the nearer it gets
  if (playing && role === 'hider' && session.round.phase === 'hunt') {
    const g = session.headOf(session.round.giant);
    const near = g ? Math.max(0, 1 - g.distanceTo(localPose.head.pos) / SHAKE.heartRange) : 0;
    beatT -= dt;
    if (near > 0 && beatT <= 0) {
      beatT = 1.15 - 0.8 * near;
      stats.beats = (stats.beats || 0) + 1;
      heartbeat(0.25 + 0.75 * near);
      for (let i = 0; i < 2; i++) vr.pulse(i, 0.15 + 0.75 * near, 70);
    }
  }

  // my own body: what is left of it, and an arm someone holds goes where they pull it
  const hurt = myBody.view;
  if (avatar) {
    avatar.setBody(hurt);
    avatar.update(localPose.head.pos, localPose.head.quat, session.hands.get(session.myId) || localPose.hands, s);
  }
  hud.blood = mode !== 'hideseek' && (dead || hurt.bleeding || hurt.cut[0] || hurt.cut[1] || hurt.blood < myBody.maxBlood - 0.5)
    ? { value: hurt.blood, max: myBody.maxBlood, bleeding: !!hurt.bleeding } : null;
  if (dead) hud.hurt(0.8);
  else if (hurt.bleeding) hud.hurt((hurt.bleeding & 3) === 3 ? 0.3 : 0.14);
  // low on blood: your heart hammers
  if (playing && mode !== 'hideseek' && !dead && hurt.blood < 40) {
    beatT -= dt;
    if (beatT <= 0) {
      beatT = 0.4 + hurt.blood / 70;
      heartbeat(0.9 - hurt.blood / 80);
      for (let i = 0; i < 2; i++) vr.pulse(i, 0.5, 60);
    }
  }

  // soft shadows under props and players
  const casters = session.props.shadowCasters([]);
  session.playerCasters(casters);
  if (!dead) casters.push({ x: loco.head.x, y: loco.head.y - loco.cfg.bodyHeight * s, z: loco.head.z, r: 0.36 * s });
  shadows.update(casters, world.colliders, voxels);
  blasts.update(dt);
  debris.update(dt);
  // fresh wounds on the pieces of the dead go on bleeding for a few seconds
  woundT -= dt;
  if (woundT <= 0) {
    woundT = 0.09;
    for (const p of session.props.props.values()) {
      if (!p.type.gib || !(p.wounds & 7) || p.age > 5) continue;
      gibWounds(p.type.id, p.wounds, p.size).forEach((w, k) => {
        const neck = p.type.id === 'gib_torso' && k === 0 && p.wounds & 1;        // a neck spurts; the rest drip
        blood.spray(w.applyQuaternion(p.mesh.quaternion).add(p.mesh.position), neck ? tmpV.set(0, 1, 0).applyQuaternion(p.mesh.quaternion) : null,
          neck ? 2 : 1, (neck ? 2.6 : 0.8) * Math.max(0.2, 1 - p.age / 5), 0.017 * p.size);
      });
    }
  }
  blood.update(dt, GRAVITY[session.settings.gravity], (x, y, z) => Math.max(0, voxels.groundBelow(x, y, z)));
  level.update(dt);
  // redraw chunks whose blocks changed: nearest first, one or two per frame (everything after a map change)
  voxelView.update(voxelView.dirty.size > 24 ? 999 : inVR ? 1 : 2, loco.head);
  if (avatar) avatar.setGhost(role === 'ghost');
  hud.status = roundStatus();
  hud.blind = waiting;
  hud.update(dt, localPose.head.pos, localPose.head.quat, s);
  sky.update(dt, localPose.head.pos);

  boardT -= dt;
  if (boardT <= 0) {
    boardT = 0.25;
    stats.speed = Math.hypot(loco.vel.x, loco.vel.z);
    stats.bodyHeight = loco.cfg.bodyHeight;
    level.board.draw(stats);
  }
  renderer.render(scene, (!inVR && window.game.debugCamera) || camera);
});

// for automated tests and poking around in the console
window.game = {
  THREE, loco, desktop, vr, renderer, scene, camera, get avatar() { return avatar; }, respawn, playDesktop, stats, session, net, level,
  armMenu, sky, menuAction, setSize, setPower, get carry() { return carry; }, get time() { return gameTime; },
  voxels, voxelView, world, hud, punchAhead, tryPunch, ROUND, voice, stomp, SHAKE,
  blood, fight, ripAhead, tryHoldArm, punchPower, BODY, FIGHT, RIG, handHist, ARENA, COLOSSEUM, heldWeapon, stuck,
};
