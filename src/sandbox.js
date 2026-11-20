// Scenery that cannot be broken: the lawn, the border walls, the sandbox control panel and board.
import * as THREE from 'three';
import { texture } from './textures.js';

// Per surface: tint over its texture, and how many metres one repeat of the texture covers.
const SURFACE = {
  grass: [0xffffff, 2.2], 'grass-dark': [0xc4dcb6, 2.2], wood: [0xffffff, 1.6], plank: [0xffffff, 1.5],
  rock: [0xffffff, 3], stone: [0xffffff, 2.4], leaf: [0xffffff, 2], crate: [0xffffff, 1.2], metal: [0xffffff, 1],
};

// The map is a square MAP metres on a side.
export const MAP = 70;

/**
 * The parts of the world that never break: the lawn, the border walls, and (in sandbox
 * mode) the control panel and info board. Everything else is voxels, see maps.js.
 */
export function buildScenery(scene, world) {
  const half = MAP / 2, H = 8;
  const walls = [];
  const wall = (cx, cz, w, d) => {
    world.addBox(cx, 0, cz, w, 40, d, 'stone');            // collides far above what you see, so nobody leaps out
    walls.push({ cx, by: 0, cz, w, h: H, d, kind: 'stone' });
  };
  world.addBox(0, -1, 0, MAP + 2, 1, MAP + 2, 'grass');    // the floor
  wall(0, -half - 0.5, MAP + 2, 1); wall(0, half + 0.5, MAP + 2, 1);
  wall(-half - 0.5, 0, 1, MAP); wall(half + 0.5, 0, 1, MAP);
  for (const mesh of mergeBoxes(walls)) scene.add(mesh);
  scene.add(grassFloor(MAP + 2));
  const baseStatics = world.statics.slice();

  // ---- sandbox only: control panel near the start (slap the buttons on top) and the info board
  const extras = new THREE.Group();
  scene.add(extras);
  const stand = [];
  for (const [cx, by, cz, w, h, d] of [[3.2, 0, 4.6, 0.6, 0.45, 2.6], [3.55, 0, 4.6, 0.12, 1.2, 2.6]]) {
    world.addBox(cx, by, cz, w, h, d, 'stone');
    stand.push({ cx, by, cz, w, h, d, kind: 'stone' });
  }
  for (const mesh of mergeBoxes(stand)) extras.add(mesh);
  const buttons = PANEL.map((b, i) => {
    const z = 3.75 + i * 0.85;
    const col = world.addBox(3.15, 0.45, z, 0.34, 0.1, 0.55, 'metal');
    col.button = b.id;
    const mat = new THREE.MeshLambertMaterial({ color: b.color, emissive: 0x000000 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.55), mat);
    mesh.position.set(3.15, 0.5, z);
    extras.add(mesh);
    return { ...b, col, mesh, mat };
  });
  const labels = makePanelLabels();
  labels.position.set(3.48, 0.86, 4.6);
  labels.rotation.y = -Math.PI / 2;
  extras.add(labels);
  const board = makeBoard();
  board.mesh.position.set(-2.4, 1.35, 3.6);
  board.mesh.rotation.y = 0.45;
  extras.add(board.mesh);
  const sandboxStatics = world.statics.slice();

  const tufts = grassTufts();
  scene.add(tufts);

  return {
    board, buttons,
    /** Switch the unbreakable scenery to suit a map, and regrow the grass around it. */
    setMap(mode) {
      const sandbox = mode === 'sandbox';
      extras.visible = sandbox;
      world.statics = sandbox ? sandboxStatics : baseStatics;
      world.colliders = world.statics.slice();
      plantTufts(tufts, MAP, world);
    },
  };
}

export const PANEL = [
  { id: 'lowgrav', label: 'Low gravity', color: 0x6f8cf0 },
  { id: 'clear', label: 'Clear props', color: 0xe0523a },
  { id: 'rain', label: 'Prop rain', color: 0xf0c04b },
];

/** Light a panel button: on = lit, or flash briefly. */
export function lightButton(btn, on) {
  btn.mat.emissive.setHex(on ? 0x555555 : 0x000000);
}

function makePanelLabels() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d3628'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#f4eed6'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
  g.fillText('SLAP A BUTTON', 512, 50);
  g.font = 'bold 54px sans-serif';
  // seen from the start area the sign's left-to-right runs along +Z, the same order as the buttons
  PANEL.forEach((b, i) => {
    g.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
    g.fillText(b.label, 512 + (i - 1) * 330, 170);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: tex }));
}

// One mesh per surface type, so the headset draws the whole level in a handful of calls.
// Texture coordinates come from world positions, so textures keep the same scale on every box.
function mergeBoxes(list) {
  const groups = {};
  const c = new THREE.Color();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of list) {
    const grp = groups[b.kind] || (groups[b.kind] = { pos: [], nrm: [], col: [], uv: [] });
    const [tint, tile] = SURFACE[b.kind] || [0x888888, 2];
    const g = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    g.translate(b.cx, b.by + b.h / 2, b.cz);
    c.setHex(tint).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    const ou = rnd() * 7, ov = rnd() * 7;   // shift each box's texture so neighbours don't line up
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = n.getX(i), ny = n.getY(i);
      grp.pos.push(x, y, z);
      grp.nrm.push(nx, ny, n.getZ(i));
      if (Math.abs(nx) > 0.5) grp.uv.push(z / tile + ou, y / tile + ov);
      else if (Math.abs(ny) > 0.5) grp.uv.push(x / tile + ou, z / tile + ov);
      else grp.uv.push(x / tile + ou, y / tile + ov);
      // darken undersides so ledges read clearly, and fade walls a little toward the ground
      const shade = ny < -0.5 ? 0.6 : ny > 0.5 ? 1.06 : 0.82 + 0.18 * Math.min((y - b.by) / 1.5, 1);
      grp.col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  return Object.entries(groups).map(([kind, grp]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(grp.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(grp.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(grp.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(grp.uv, 2));
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: texture(kind) }));
  });
}

// The lawn: grass texture, with big soft light and dark patches so it doesn't look tiled.
function grassFloor(size) {
  const seg = 28;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.setXY(i, x / 2.2, z / 2.2);
    const n = Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) + Math.sin((x + z) * 0.09) * 0.7 + Math.sin(x * 0.53 - z * 0.47) * 0.35;
    const k = 0.9 + n * 0.09;
    col.push(k, k * (1 + n * 0.02), k * 0.96);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture('grass'), vertexColors: true }));
}

// Little grass blades scattered over open ground, all in one draw call.
const TUFTS = 2400;
function grassTufts() {
  const blade = new THREE.ConeGeometry(0.022, 0.16, 3);
  blade.translate(0, 0.08, 0);
  const mesh = new THREE.InstancedMesh(blade, new THREE.MeshLambertMaterial({ color: 0xffffff }), TUFTS);
  mesh.count = 0;
  return mesh;
}
function plantTufts(mesh, size, world) {
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < TUFTS && tries < TUFTS * 5; tries++) {
    p.set((rnd() - 0.5) * (size - 1), 0, (rnd() - 0.5) * (size - 1));
    // not where something stands on the ground
    if (world.voxels && world.voxels.solidAt(p.x, 0.1, p.z)) continue;
    if (world.statics.some(b => b.max.y > 0.05 && b.min.y < 0.3 && p.x > b.min.x - 0.1 && p.x < b.max.x + 0.1 && p.z > b.min.z - 0.1 && p.z < b.max.z + 0.1)) continue;
    q.setFromEuler(e.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5));
    const k = 0.5 + rnd() * 1.1;
    mesh.setMatrixAt(n, m.compose(p, q, sc.set(k, k * (0.7 + rnd() * 0.8), k)));
    mesh.setColorAt(n, c.setHSL(0.27 + rnd() * 0.05, 0.45 + rnd() * 0.15, 0.2 + rnd() * 0.12));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// A sign with controls and live numbers for tuning the feel.
function makeBoard() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 640;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: tex }));
  const g = cv.getContext('2d');
  let lastKey = '';
  function draw(s) {
    const key = [s.speed.toFixed(1), s.best.toFixed(1), s.bodyHeight.toFixed(2), s.mode].join('|');
    if (key === lastKey) return;
    lastKey = key;
    g.fillStyle = '#13241b'; g.fillRect(0, 0, 1024, 640);
    g.fillStyle = '#9be15d'; g.font = 'bold 64px sans-serif'; g.fillText('Canopy Tag sandbox', 44, 92);
    g.fillStyle = '#f4eed6'; g.font = '36px sans-serif';
    const lines = s.mode === 'vr' ? [
      'Push the ground down and back to move.',
      'Punch hard to smash things. Arm menu: X.',
      'Grab an item from the menu and throw it.',
      'Grip: grab   Left trigger: delete   Y: start',
    ] : [
      'Hold left / right click and drag down to push.',
      'J: punch   F: throw item   M: menu   T: tab',
      'G (hold): grab   X: delete   Z: undo   R: start',
    ];
    lines.forEach((t, i) => g.fillText(t, 44, 170 + i * 56));
    g.fillStyle = '#1d3628'; g.fillRect(44, 420, 936, 170);
    g.font = 'bold 30px sans-serif'; g.fillStyle = '#b9c4a8';
    ['SPEED', 'BEST LAUNCH', 'BODY HEIGHT'].forEach((t, i) => g.fillText(t, 74 + i * 310, 470));
    g.font = 'bold 64px sans-serif'; g.fillStyle = '#f4eed6';
    [`${s.speed.toFixed(1)} m/s`, `${s.best.toFixed(1)} m/s`, `${s.bodyHeight.toFixed(2)} m`].forEach((t, i) => g.fillText(t, 74 + i * 310, 552));
    tex.needsUpdate = true;
  }
  return { mesh, draw };
}
