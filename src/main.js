// Canopy Tag sandbox: arm-push movement, physics props, the arm menu and multiplayer.
import * as THREE from 'three';
import { World } from './physics.js';
import { Locomotion } from './locomotion.js';
import { Avatar, BONE, fingertip } from './avatar.js';
import { DesktopInput } from './input-desktop.js';
import { VRInput } from './input-vr.js';
import { initAudio, tap, boom, boing } from './audio.js';
import { buildSandbox, lightButton } from './sandbox.js';
import { PROP_TYPES, propVisual, propSize, BLAST_RADIUS } from './props.js';
import { Net } from './net.js';
import { Session, GRAVITY_LABEL } from './session.js';
import { ArmMenu, SIZES, POWERS } from './armmenu.js';
import { Sky, SKIES } from './sky.js';
import { BlobShadows, Blasts } from './fx.js';

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
const armMenu = new ArmMenu(scene);

const stats = { speed: 0, best: 0, bodyHeight: loco.cfg.bodyHeight, mode: 'desktop' };
let sizeIdx = SIZES.indexOf(1), powerIdx = POWERS.indexOf(1);
let calib = 0;            // seconds left on the calibrate countdown (0 = not calibrating)
let carry = null;         // the mini item in my right hand: { typeId, mesh }
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

// ---- size, power and the things that depend on them
function applyView() {
  const s = loco.scale, p = SKIES[session.settings.sky] || SKIES.day;
  rig.scale.setScalar(s);
  // fog and draw distance are measured in "player units", so adjust them for size
  scene.fog.near = 35 / s; scene.fog.far = p.fogFar / s;
  camera.far = 260 / Math.min(s, 1);
  camera.updateProjectionMatrix();
}
function setSize(i) {
  sizeIdx = Math.min(Math.max(i, 0), SIZES.length - 1);
  loco.setScale(SIZES[sizeIdx], headLocal);
  applyView();
}
function setPower(i) {
  powerIdx = Math.min(Math.max(i, 0), POWERS.length - 1);
  loco.power = POWERS[powerIdx];
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
}
session.onChange = renderRoom;
session.onSettings = s => { sky.set(s.sky); applyView(); };
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
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) { codeInput.value = roomParam.toUpperCase(); joinRoom(roomParam); }
renderRoom();

// ---- arm menu actions (poked in VR, or keys on desktop)
function menuAction(id) {
  if (id.startsWith('item:')) { session.select(id.slice(5)); return; }
  switch (id) {
    case 'size-': setSize(sizeIdx - 1); break;
    case 'size+': setSize(sizeIdx + 1); break;
    case 'power-': setPower(powerIdx - 1); break;
    case 'power+': setPower(powerIdx + 1); break;
    case 'calibrate': calib = 3.99; break;   // counts down so you can put your arms down first
    case 'home': respawn(); break;
    case 'undo': session.undo(); break;
    case 'gravity': case 'sky': case 'rain': case 'balloons': case 'clear': session.pressButton(id); break;
  }
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
  const act = { spawn: false, throw: false, next: 0, slot: null, undo: false, del: [false, false], grab: [false, false], grabStart: false, respawn: false, menu: [] };

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
        ['KeyL', 'gravity'], ['KeyN', 'sky'], ['KeyP', 'rain'], ['KeyB', 'balloons'], ['KeyC', 'clear']]) if (k(code)) act.menu.push(id);
    }
    headLocal.copy(desktop.headLocal); headQuatLocal.copy(desktop.headQuat);
    for (let i = 0; i < 2; i++) { handLocals[i].copy(desktop.hands[i].local); handQuatsLocal[i].copy(desktop.hands[i].quat); }
    active = desktop.active;
  }

  if (playing) {
    if (act.respawn) respawn();
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
    world.colliders = levelColliders.concat(session.propColliders());
    loco.update(dt, headLocal, handLocals, active);
    for (const e of loco.events) {
      if (e.type === 'touch') {
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
    gravity: GRAVITY_LABEL[session.settings.gravity], sky: SKIES[session.settings.sky].label,
    room: net.role === 'solo' ? 'Solo' : `Room ${net.code}`, players: session.playerCount,
    calib: calib > 0 ? Math.ceil(calib) : 0,
  });
  if (pressedIds.length && inVR) vr.pulse(1, 0.5, 30);
  for (const id of pressedIds.concat(act.menu)) menuAction(id);

  // sandbox actions
  if (playing) {
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
  shadows.update(casters, world.colliders);
  blasts.update(dt);
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
};
