// Canopy Tag: arm-push movement in a breakable voxel world, with a sandbox mode
// (props, arm menu) and a hide and seek mode (one giant, tiny hiders), solo or online.
import * as THREE from 'three';
import { World } from './physics.js';
import { Locomotion } from './locomotion.js';
import { Avatar, BONE, fingertip } from './avatar.js';
import { DesktopInput } from './input-desktop.js';
import { VRInput } from './input-vr.js';
import { initAudio, tap, boom, boing, crunch, jingle } from './audio.js';
import { buildScenery, lightButton } from './sandbox.js';
import { PROP_TYPES, propVisual, propSize, BLAST_RADIUS } from './props.js';
import { Net } from './net.js';
import { Session, GRAVITY, GRAVITY_LABEL } from './session.js';
import { ArmMenu, SIZES, POWERS } from './armmenu.js';
import { Sky, SKIES } from './sky.js';
import { BlobShadows, Blasts, Debris } from './fx.js';
import { VoxelWorld, VOXEL, MATERIALS } from './voxels.js';
import { VoxelRenderer } from './voxelmesh.js';
import { MAPS } from './maps.js';
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

const me = { name: saved.name || randomName(), color: saved.color ?? BONE };
const avatarTemplate = Avatar.loadTemplate('assets/skeleton-rig.glb');
let avatar = null;
avatarTemplate
  .then(t => { avatar = new Avatar(t, scene, { color: me.color }); avatar.firstPerson = true; })
  .catch(err => { console.error(err); status('Could not load the skeleton model. Movement still works.', 'error'); });

const net = new Net();
const session = new Session({ scene, world, net, loco, me, avatarTemplate });
const armMenu = new ArmMenu(scene);

const stats = { speed: 0, best: 0, bodyHeight: loco.cfg.bodyHeight, mode: 'desktop' };
let sizeIdx = SIZES.indexOf(1), powerIdx = POWERS.indexOf(1);
let calib = 0;            // seconds left on the calibrate countdown (0 = not calibrating)
let carry = null;         // the mini item in my right hand: { typeId, mesh }
const lastPunch = [0, 0];

// How hard a hit has to be to break something, in metres per second of real hand speed
// straight into the surface. Hitting downward needs a real slam, so running across the
// top of something does not crater it.
const PUNCH = { hit: 2.6, slam: 4.5, cooldown: 120 };

// start near the map's spawn point, spread out a little so friends don't land inside each other
function respawn() {
  const map = MAPS[session.settings.mode] || MAPS.sandbox;
  const at = session.role() === 'giant' ? map.giantSpawn : map.spawn;
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
  const scale = role === 'giant' ? ROUND.giantScale : role === 'hider' ? ROUND.hiderScale : role === 'ghost' ? 1 : SIZES[sizeIdx];
  loco.power = role === 'giant' ? ROUND.giantPower : role === 'hider' ? ROUND.hiderPower : role === 'ghost' ? 1 : POWERS[powerIdx];
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
  $('mode-note').textContent = session.settings.mode === 'hideseek'
    ? (session.playerCount < 2 ? 'Hide and seek starts when a second player joins. You can explore the map until then.' : 'Rounds run by themselves: one giant, everyone else hides.')
    : 'Build, spawn props and smash things freely.';
}
session.onChange = renderRoom;
session.onSettings = s => { sky.set(s.sky); applyView(); };
session.onMap = mode => {
  level.setMap(mode);
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
$('leave').addEventListener('click', () => { session.leave(); renderRoom(); });
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
    case 'resetmap': session.resetMap(); break;
    case 'smash': session.pressButton(id); break;
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

// Desktop: punch whatever is within reach of where you are looking.
function punchAhead() {
  const s = loco.scale;
  if (s < 0.7 || !session.canBreak()) return;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(localPose.head.quat);
  const hit = voxels.raycast(localPose.head.pos, dir, 1.7 * s);
  if (hit) { const r = 0.42 * s * MATERIALS[hit.mat].hard; session.punch(hit.point.addScaledVector(hit.normal, -r * 0.45), r); }
}

function mmss(t) { return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

// The small line of text that stays on screen during hide and seek.
function roundStatus() {
  if (session.settings.mode !== 'hideseek') return '';
  const r = session.round, role = session.role();
  if (r.phase === 'waiting') return 'Hide and seek: waiting for another player';
  const left = session.playerCount - 1 - r.out.length;
  if (r.phase === 'hide') return role === 'giant' ? `They are hiding... ${r.t}` : `Hide! Giant in ${r.t}`;
  if (r.phase === 'hunt') return role === 'giant' ? `Find them!  ${mmss(r.t)}  ·  ${left} left` : role === 'ghost' ? `Caught  ·  ${mmss(r.t)}` : `Stay hidden  ${mmss(r.t)}`;
  return '';
}
function gameLines() {
  if (session.settings.mode !== 'hideseek') return ['Sandbox', 'Build, spawn props and smash freely.'];
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
  const act = { spawn: false, throw: false, next: 0, slot: null, undo: false, del: [false, false], grab: [false, false], grabStart: false, respawn: false, punch: false, menu: [] };
  const tools = session.settings.mode === 'sandbox';      // spawning and deleting are sandbox-only
  const role = session.role();
  const frozen = role === 'giant' && session.round.phase === 'hide';   // the giant waits, blind, while they hide

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
      if (k('KeyO')) session.setMode(tools ? 'hideseek' : 'sandbox');
      if (k('KeyK')) session.skipRound();
      act.spawn = k('KeyV');
      act.undo = k('KeyZ');
      act.del[1] = k('KeyX');
      act.next = wheel;
      for (let n = 1; n <= 8; n++) if (k('Digit' + n)) act.slot = n - 1;
      act.grab = [false, !!desktop.keys.KeyG];
      if (k('KeyM')) armMenu.visible = !armMenu.visible;
      if (k('KeyT')) { armMenu.visible = true; armMenu.nextTab(); }
      if (k('Comma')) armMenu.nextPage(-1);
      if (k('Period')) armMenu.nextPage(1);
      for (const [code, id] of [['BracketLeft', 'size-'], ['BracketRight', 'size+'], ['Minus', 'power-'], ['Equal', 'power+'],
        ['KeyL', 'gravity'], ['KeyN', 'sky'], ['KeyP', 'rain'], ['KeyB', 'balloons'], ['KeyC', 'clear'], ['KeyH', 'smash'], ['Backspace', 'resetmap']]) if (k(code)) act.menu.push(id);
    }
    headLocal.copy(desktop.headLocal); headQuatLocal.copy(desktop.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(desktop.hands[i].local); handQuatsLocal[i].copy(desktop.hands[i].quat); }
    active = desktop.active;
  }

  if (playing && frozen) {
    // held in place: no moving, no touching
    loco.vel.set(0, 0, 0);
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
    loco.update(dt, headLocal, handLocals, active);
    for (const e of loco.events) {
      if (e.type === 'touch') {
        if (e.col.voxel && tryPunch(e, now)) continue;
        tap(e.kind, 0.25 + 0.75 * e.strength, e.hand === 0 ? -0.5 : 0.5);
        if (inVR) vr.pulse(e.hand, 0.2 + 0.6 * e.strength, 25 + 40 * e.strength);
        if (e.col && e.col.button) session.pressButton(e.col.button);
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
    mode: session.settings.mode, locked: !tools, roleLocked: role !== 'free', game: gameLines(),
  });
  if (pressedIds.length && inVR) vr.pulse(1, 0.5, 30);
  for (const id of pressedIds.concat(act.menu)) menuAction(id);

  if (playing && act.punch && !frozen) punchAhead();

  // sandbox actions
  if (playing && tools) {
    const n = PROP_TYPES.length;
    if (act.slot != null) { const t = PROP_TYPES[armMenu.page * 8 + act.slot]; if (t) session.select(t.id); }
    if (act.next) { session.selected = (session.selected + act.next + n) % n; armMenu.showItem(session.selectedType.id); }
    const fingers = tmpV.copy(tip).sub(rh.pos).normalize();
    // grabbing an item out of the menu takes priority over grabbing a prop
    const overItem = act.grabStart && !carry && session.held[1] == null ? armMenu.itemAt(tip) : null;
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
    for (let i = 0; i < 2; i++) {
      const hp = localPose.hands[i].pos;
      if (act.del[i] && session.deleteNear(hp, s) && inVR) vr.pulse(i, 0.5, 60);
      const busy = i === 1 && (carry || overItem);
      if (act.grab[i] && !busy && session.held[i] == null && session.grab(i, hp, s) && inVR) vr.pulse(i, 0.5, 50);
      if (!act.grab[i] && session.held[i] != null) session.release(i, handVelocity(i));
    }
  }
  session.update(dt, localPose);

  if (avatar) avatar.update(localPose.head.pos, localPose.head.quat, localPose.hands, s);

  // soft shadows under props and players
  const casters = session.props.shadowCasters([]);
  session.playerCasters(casters);
  casters.push({ x: loco.head.x, y: loco.head.y - loco.cfg.bodyHeight * s, z: loco.head.z, r: 0.36 * s });
  shadows.update(casters, world.colliders, voxels);
  blasts.update(dt);
  debris.update(dt);
  // redraw chunks whose blocks changed: nearest first, one or two per frame (everything after a map change)
  voxelView.update(voxelView.dirty.size > 24 ? 999 : inVR ? 1 : 2, loco.head);
  if (avatar) avatar.setGhost(role === 'ghost');
  hud.status = roundStatus();
  hud.blind = frozen;
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
  voxels, voxelView, world, hud, punchAhead, tryPunch, ROUND,
};
