// Canopy Tag sandbox: arm-push movement, physics props and multiplayer.
import * as THREE from 'three';
import { World } from './physics.js';
import { Locomotion } from './locomotion.js';
import { Avatar, BONE } from './avatar.js';
import { DesktopInput } from './input-desktop.js';
import { VRInput } from './input-vr.js';
import { initAudio, tap } from './audio.js';
import { buildSandbox, lightButton } from './sandbox.js';
import { PROP_TYPES } from './props.js';
import { Net } from './net.js';
import { Session } from './session.js';
import { WristPanel } from './hud.js';

const $ = id => document.getElementById(id);
const canvas = $('view');

// ---- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa8d3e3);
scene.fog = new THREE.Fog(0xa8d3e3, 35, 110);
scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x4a5a2a, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d2, 1.6);
sun.position.set(6, 12, 4);
scene.add(sun);

// the rig is the player's play space; camera and controllers live inside it
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, 1, 0.03, 220);
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
const level = buildSandbox(scene, world);
const levelColliders = world.colliders.slice();
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
const wrist = new WristPanel(scene);

const stats = { speed: 0, best: 0, bodyHeight: loco.cfg.bodyHeight, mode: 'desktop' };
respawn();

// start near the spawn point, spread out a little so friends don't land inside each other
function respawn() {
  const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.4;
  loco.teleport(level.spawn.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.5)), level.spawnYaw);
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

// ---- menu
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
    respawn();
    xrSession.addEventListener('end', () => { stats.mode = 'desktop'; menu.hidden = false; respawn(); });
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
const roomBox = $('room'), codeInput = $('code');
function renderRoom() {
  const role = net.role;
  $('room-solo').hidden = role !== 'solo';
  $('room-on').hidden = role === 'solo';
  if (role !== 'solo') {
    $('room-code').textContent = net.code;
    const link = `${location.origin}${location.pathname}?room=${net.code}`;
    $('room-link').textContent = link;
    $('room-who').textContent = role === 'host'
      ? `You are hosting. ${session.playerCount} player${session.playerCount === 1 ? '' : 's'} in the room.`
      : `You joined. ${session.playerCount} players in the room.`;
  }
}
session.onChange = () => { renderRoom(); wrist.dirty = true; };
session.onButton = (id, on) => {
  const b = level.buttons.find(x => x.id === id);
  if (!b) return;
  lightButton(b, on);
  if (id !== 'lowgrav') setTimeout(() => lightButton(b, false), 250);
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
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) { codeInput.value = roomParam.toUpperCase(); joinRoom(roomParam); }
renderRoom();

// ---- main loop
const headLocal = new THREE.Vector3(), headQuatLocal = new THREE.Quaternion();
const handLocals = [new THREE.Vector3(), new THREE.Vector3()];
const handQuatsLocal = [new THREE.Quaternion(), new THREE.Quaternion()];
const rigQuat = new THREE.Quaternion();
const localPose = {
  head: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
  hands: [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
};
const handHist = [[], []];   // recent hand positions for throwing
let last = performance.now(), boardT = 0;

function handVelocity(i) {
  const h = handHist[i];
  if (h.length < 2) return new THREE.Vector3();
  const a = h[0], b = h[h.length - 1];
  return b.p.clone().sub(a.p).divideScalar(Math.max((b.t - a.t) / 1000, 1e-3));
}

renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  const inVR = renderer.xr.isPresenting;
  const playing = inVR || desktop.enabled;
  let active;
  const act = { spawn: false, next: 0, select: null, undo: false, del: [false, false], grab: [false, false], calibrate: false, respawn: false };

  if (inVR) {
    if (!vr.update(frame)) { renderer.render(scene, camera); return; }
    if (vr.turn) loco.turn(-vr.turn * Math.PI / 4, vr.headLocal);
    const [L, R] = vr.hands;
    act.spawn = R.buttons.trigger.pressed;
    act.del[0] = L.buttons.trigger.pressed;
    act.next = R.buttons.primary.pressed ? 1 : 0;
    act.undo = R.buttons.secondary.pressed;
    act.calibrate = L.buttons.primary.pressed;
    act.respawn = L.buttons.secondary.pressed;
    act.grab = [L.buttons.grip.down, R.buttons.grip.down];
    headLocal.copy(vr.headLocal); headQuatLocal.copy(vr.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(vr.hands[i].local); handQuatsLocal[i].copy(vr.hands[i].quat); }
    active = vr.active;
  } else {
    if (desktop.enabled) {
      desktop.update(dt);
      const { pressed, wheel } = desktop.takeInput();
      act.spawn = pressed.has('KeyF');
      act.undo = pressed.has('KeyZ');
      act.del[1] = pressed.has('KeyX');
      act.next = wheel;
      for (let k = 1; k <= PROP_TYPES.length; k++) if (pressed.has('Digit' + k)) act.select = k - 1;
      act.grab = [false, !!desktop.keys.KeyG];
    }
    headLocal.copy(desktop.headLocal); headQuatLocal.copy(desktop.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(desktop.hands[i].local); handQuatsLocal[i].copy(desktop.hands[i].quat); }
    active = desktop.active;
  }

  if (playing) {
    if (act.respawn) respawn();
    if (act.calibrate && vr.hands[0].tracked && vr.hands[1].tracked) {
      const handsY = (vr.hands[0].local.y + vr.hands[1].local.y) / 2;
      loco.cfg.bodyHeight = Math.min(Math.max(vr.headLocal.y - handsY + 0.05, 0.45), 1.3);
      saveSettings();
      for (let i = 0; i < 2; i++) vr.pulse(i, 0.6, 120);
    }
    // climbable props are part of the world for the movement code
    world.colliders = levelColliders.concat(session.propColliders());
    loco.update(dt, headLocal, handLocals, active);
    for (const e of loco.events) {
      if (e.type === 'touch') {
        tap(e.kind, 0.25 + 0.75 * e.strength, e.hand === 0 ? -0.5 : 0.5);
        if (inVR) vr.pulse(e.hand, 0.2 + 0.6 * e.strength, 25 + 40 * e.strength);
        if (e.col && e.col.button) session.pressButton(e.col.button);
      } else if (e.type === 'launch') {
        stats.best = Math.max(stats.best, e.speed);
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
  rigQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, loco.yaw);
  loco.toWorld(headLocal, localPose.head.pos);
  localPose.head.quat.copy(rigQuat).multiply(headQuatLocal);
  for (let i = 0; i < 2; i++) {
    localPose.hands[i].pos.copy(loco.hands[i].pos);
    localPose.hands[i].quat.copy(rigQuat).multiply(handQuatsLocal[i]);
    handHist[i].push({ p: localPose.hands[i].pos.clone(), t: now });
    while (handHist[i].length > 6) handHist[i].shift();
  }

  // sandbox actions
  if (playing) {
    if (act.select != null) { session.selected = act.select; wrist.dirty = true; }
    if (act.next) { session.selected = (session.selected + act.next + PROP_TYPES.length) % PROP_TYPES.length; wrist.dirty = true; }
    if (act.spawn) { session.spawnSelected(localPose.hands[1].pos, localPose.hands[1].quat); if (inVR) vr.pulse(1, 0.4, 40); }
    if (act.undo) session.undo();
    for (let i = 0; i < 2; i++) {
      if (act.del[i] && session.deleteNear(localPose.hands[i].pos) && inVR) vr.pulse(i, 0.5, 60);
      if (act.grab[i] && session.held[i] == null && session.grab(i, localPose.hands[i].pos) && inVR) vr.pulse(i, 0.5, 50);
      if (!act.grab[i] && session.held[i] != null) session.release(i, handVelocity(i));
    }
  }
  session.update(dt, localPose);

  if (avatar) avatar.update(localPose.head.pos, localPose.head.quat, localPose.hands);
  wrist.update(localPose.hands[0].pos, localPose.head.pos, {
    item: session.selectedType.label,
    room: net.role === 'solo' ? 'Solo' : `Room ${net.code}`,
    players: session.playerCount,
    lowGravity: session.settings.lowGravity,
  });

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
window.game = { THREE, loco, desktop, vr, renderer, scene, camera, get avatar() { return avatar; }, respawn, playDesktop, stats, session, net, level };
