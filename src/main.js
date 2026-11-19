// Phase 1: VR movement sandbox.
import * as THREE from 'three';
import { World } from './physics.js';
import { Locomotion } from './locomotion.js';
import { Avatar } from './avatar.js';
import { DesktopInput } from './input-desktop.js';
import { VRInput } from './input-vr.js';
import { initAudio, tap } from './audio.js';
import { buildSandbox } from './sandbox.js';

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
const saved = readSettings();
const loco = new Locomotion(world, saved.bodyHeight ? { bodyHeight: saved.bodyHeight } : {});
loco.teleport(level.spawn, level.spawnYaw);

const desktop = new DesktopInput(canvas);
const vr = new VRInput(renderer, rig);
desktop.onRespawn = respawn;

let avatar = null;
Avatar.load('assets/skeleton-rig.glb', scene)
  .then(a => { avatar = a; a.firstPerson = true; })
  .catch(err => { console.error(err); $('status').textContent = 'Could not load the skeleton model. Movement still works.'; });

const stats = { speed: 0, best: 0, bodyHeight: loco.cfg.bodyHeight, mode: 'desktop' };

function respawn() { loco.teleport(level.spawn, level.spawnYaw); }

function readSettings() {
  try { return JSON.parse(localStorage.getItem('canopy-settings')) || {}; } catch (e) { return {}; }
}
function saveSettings() {
  try { localStorage.setItem('canopy-settings', JSON.stringify({ bodyHeight: loco.cfg.bodyHeight })); } catch (e) { /* private mode */ }
}

// ---- menu
const menu = $('menu');
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
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await renderer.xr.setSession(session);
    desktop.enabled = false;
    stats.mode = 'vr';
    menu.hidden = true;
    respawn();
    session.addEventListener('end', () => { stats.mode = 'desktop'; menu.hidden = false; respawn(); });
  } catch (err) {
    console.error(err);
    $('status').textContent = 'Could not start VR: ' + err.message;
  }
});

// ---- main loop
const headLocal = new THREE.Vector3(), headQuatLocal = new THREE.Quaternion();
const handLocals = [new THREE.Vector3(), new THREE.Vector3()];
const handQuatsLocal = [new THREE.Quaternion(), new THREE.Quaternion()];
const headWorld = new THREE.Vector3(), headQuatWorld = new THREE.Quaternion(), rigQuat = new THREE.Quaternion();
const avatarHands = [{ pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }];
let last = performance.now(), boardT = 0;

renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  const inVR = renderer.xr.isPresenting;
  let active;

  if (inVR) {
    if (!vr.update(frame)) { renderer.render(scene, camera); return; }
    if (vr.pressed.turn) loco.turn(-vr.pressed.turn * Math.PI / 4, vr.headLocal);
    if (vr.pressed.respawn) respawn();
    if (vr.pressed.calibrate && vr.hands[0].tracked && vr.hands[1].tracked) {
      const handsY = (vr.hands[0].local.y + vr.hands[1].local.y) / 2;
      loco.cfg.bodyHeight = Math.min(Math.max(vr.headLocal.y - handsY + 0.05, 0.45), 1.3);
      saveSettings();
      for (let i = 0; i < 2; i++) vr.pulse(i, 0.6, 120);
    }
    headLocal.copy(vr.headLocal); headQuatLocal.copy(vr.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(vr.hands[i].local); handQuatsLocal[i].copy(vr.hands[i].quat); }
    active = vr.active;
  } else {
    if (desktop.enabled) desktop.update(dt);
    headLocal.copy(desktop.headLocal); headQuatLocal.copy(desktop.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(desktop.hands[i].local); handQuatsLocal[i].copy(desktop.hands[i].quat); }
    active = desktop.active;
  }

  if (inVR || desktop.enabled) {
    loco.update(dt, headLocal, handLocals, active);
    for (const e of loco.events) {
      if (e.type === 'touch') {
        tap(e.kind, 0.25 + 0.75 * e.strength, e.hand === 0 ? -0.5 : 0.5);
        if (inVR) vr.pulse(e.hand, 0.2 + 0.6 * e.strength, 25 + 40 * e.strength);
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

  if (avatar) {
    rigQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, loco.yaw);
    loco.toWorld(headLocal, headWorld);
    headQuatWorld.copy(rigQuat).multiply(headQuatLocal);
    for (let i = 0; i < 2; i++) {
      avatarHands[i].pos.copy(loco.hands[i].pos);
      avatarHands[i].quat.copy(rigQuat).multiply(handQuatsLocal[i]);
    }
    avatar.update(headWorld, headQuatWorld, avatarHands);
  }

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
window.game = { THREE, loco, desktop, vr, renderer, scene, camera, get avatar() { return avatar; }, respawn, playDesktop, stats };
