// Phase 1 test map: things to run on, jump between and climb.
import * as THREE from 'three';

const COLORS = {
  grass: 0x5f8f3a, 'grass-dark': 0x4f7d32, wood: 0x8a5e36, plank: 0xb98a52, rock: 0x8e948c, stone: 0x66706a,
  leaf: 0x3d8a3f, crate: 0xc08a4c, metal: 0x9aa7b0,
};

// The map is a square MAP metres on a side (70 m: about 12x the area of the first 20 m room).
export const MAP = 70;

export function buildSandbox(scene, world) {
  const boxes = [];
  const box = (cx, by, cz, w, h, d, kind, visible = true) => {
    world.addBox(cx, by, cz, w, h, d, kind);
    if (visible) boxes.push({ cx, by, cz, w, h, d, kind });
  };
  const half = MAP / 2;

  // ground and outer walls
  box(0, -1, 0, MAP + 2, 1, MAP + 2, 'grass', false);   // floor collider (drawn separately with a grid)
  const H = 8;
  box(0, 0, -half - 0.5, MAP + 2, H, 1, 'stone');
  box(0, 0, half + 0.5, MAP + 2, H, 1, 'stone');
  box(-half - 0.5, 0, 0, 1, H, MAP, 'stone');
  box(half + 0.5, 0, 0, 1, H, MAP, 'stone');

  // ---- centre: the original test course
  for (let i = 0; i < 5; i++) box(-6, 0, -1 - i * 1.2, 3, 0.35 * (i + 1), 1.2, 'wood');  // stairs
  box(-6, 0, -8.2, 3, 1.75, 3.2, 'wood');                                               // deck
  box(0, 0, -3.2, 2, 0.9, 2, 'plank');                                                  // gap jump
  box(0, 0, -7.2, 2, 1.2, 2, 'plank');
  box(4.5, 0, -5, 1, 5, 1, 'rock');                                                     // pillar
  box(4.5, 5, -5, 1.8, 0.2, 1.8, 'plank');
  box(8.6, 0, 1, 2.8, 3.4, 4, 'rock');                                                  // climbing wall
  box(6.95, 1.6, 1, 0.5, 0.2, 3, 'plank');
  box(4, 0, 4, 0.4, 2.6, 0.4, 'wood');                                                  // posts
  box(5.6, 0, 2.6, 0.4, 2.6, 0.4, 'wood');
  box(4, 0, 1.2, 0.4, 2.6, 0.4, 'wood');
  box(-8.6, 0, 4.5, 0.3, 1.2, 3.2, 'wood');                                             // tunnel
  box(-6.9, 0, 4.5, 0.3, 1.2, 3.2, 'wood');
  box(-7.75, 1.2, 4.5, 2.0, 0.2, 3.2, 'plank');

  // ---- north-east: tall trees with decks and bridges
  const trees = [[18, -18], [28, -18], [18, -28], [28, -28]];
  for (const [x, z] of trees) {
    box(x, 0, z, 1.3, 14, 1.3, 'wood');
    box(x, 4, z, 4, 0.3, 4, 'plank');
    box(x, 8, z, 3.4, 0.3, 3.4, 'plank');
    box(x, 11.5, z, 3, 0.3, 3, 'plank');
    box(x, 13.4, z, 6, 2.4, 6, 'leaf');
  }
  box(23, 8, -18, 6.6, 0.25, 1.2, 'plank');      // bridges at the middle decks
  box(23, 8, -28, 6.6, 0.25, 1.2, 'plank');
  box(18, 11.5, -23, 1.2, 0.25, 7, 'plank');     // and a high one
  for (let i = 0; i < 4; i++) box(10.5 + i * 1.5, 0, -18, 1.2, 1 + i * 0.9, 1.2, 'crate'); // steps up to the first deck

  // ---- north-west: a tower with ledges spiralling up
  const tx = -24, tz = -24;
  box(tx, 0, tz, 5, 14, 5, 'stone');
  box(tx, 14, tz, 7.5, 0.4, 7.5, 'plank');
  const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let k = 0; k < 7; k++) {
    const [sx, sz] = sides[k % 4], y = 1.4 + k * 1.8;
    if (sx) box(tx + sx * 3.2, y, tz, 1.4, 0.3, 4.2, 'plank');
    else box(tx, y, tz + sz * 3.2, 4.2, 0.3, 1.4, 'plank');
  }

  // ---- south-east: posts to climb, then floating stepping stones up to a high perch
  for (let i = 0; i < 5; i++) box(15 + i * 2.6, 0, 16, 1, 1 + i, 1, 'wood');
  for (let i = 0; i < 8; i++) box(15 + i * 2.2, 1.2 + i * 0.9, 22 + i * 1.1, 2, 0.3, 2, 'plank');
  box(32, 0, 32.5, 3, 8.5, 3, 'rock');

  // ---- south-west: a terraced hill
  for (const [w, h] of [[16, 1.2], [12, 2.4], [8, 3.6], [4.5, 4.8], [2, 6]]) box(-24, 0, 24, w, h, w, 'grass-dark');

  // ---- south: a channel between two walls, for pushing off side to side
  box(-3.2, 0, 24, 0.8, 4, 16, 'rock');
  box(3.2, 0, 24, 0.8, 4, 16, 'rock');

  // ---- east: tall blocks with gaps to leap across
  [15, 19.5, 24.5, 30].forEach((x, i) => box(x, 0, 0, 2.6, 2.5 + i * 0.5, 2.6, 'rock'));

  // ---- west: a field of crates and boulders (fixed layout)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 18; i++) {
    const w = 1 + rnd() * 2.2, h = 0.6 + rnd() * 2.6;
    box(-15 - rnd() * 17, 0, -9 + rnd() * 18, w, h, 1 + rnd() * 2.2, rnd() < 0.5 ? 'crate' : 'rock');
  }

  // ---- north wall: an uneven cliff to climb
  for (let i = 0; i < 9; i++) {
    const x = -12 + i * 3;
    box(x, 0, -half + 1.5, 3, 3 + ((i * 5) % 7), 2 + (i % 3) * 0.6, 'rock');
  }

  scene.add(mergeBoxes(boxes));
  scene.add(gridFloor(MAP));

  // ---- control panel near the start: slap the buttons on top
  box(3.2, 0, 4.6, 0.6, 0.45, 2.6, 'stone');
  box(3.55, 0, 4.6, 0.12, 1.2, 2.6, 'stone');
  const buttons = PANEL.map((b, i) => {
    const z = 3.75 + i * 0.85;
    const col = world.addBox(3.15, 0.45, z, 0.34, 0.1, 0.55, 'metal');
    col.button = b.id;
    const mat = new THREE.MeshLambertMaterial({ color: b.color, emissive: 0x000000 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.55), mat);
    mesh.position.set(3.15, 0.5, z);
    scene.add(mesh);
    return { ...b, col, mesh, mat };
  });
  const labels = makePanelLabels();
  labels.position.set(3.48, 0.86, 4.6);
  labels.rotation.y = -Math.PI / 2;
  scene.add(labels);

  const board = makeBoard();
  board.mesh.position.set(-2.4, 1.35, 3.6);
  board.mesh.rotation.y = 0.45;
  scene.add(board.mesh);

  return { spawn: new THREE.Vector3(0, 0, 6), spawnYaw: 0, board, buttons };
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

// One mesh for all level boxes, coloured per surface, so the headset draws it in one call.
function mergeBoxes(list) {
  const pos = [], nrm = [], col = [];
  const c = new THREE.Color();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of list) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    g.translate(b.cx, b.by + b.h / 2, b.cz);
    c.setHex(COLORS[b.kind] || 0x888888).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      // darken undersides a little so ledges read clearly
      const shade = n.getY(i) < -0.5 ? 0.7 : 1;
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Grass floor with 1 m grid lines, so you can feel how fast you are going.
function gridFloor(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#5f8f3a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6a9b43'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 0, 3, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  return m;
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
      'Right trigger: spawn   A: next item   B: undo',
      'Grip: grab and throw   Left trigger: delete',
      'X: calibrate   Y: back to start   Stick: turn',
    ] : [
      'Hold left / right click and drag down to push.',
      'F: spawn   1-9 / wheel: pick item   Z: undo',
      'G (hold): grab   X: delete   R: back to start',
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
