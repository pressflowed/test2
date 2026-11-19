// Phase 1 test room: things to run on, jump between and climb.
import * as THREE from 'three';

const COLORS = {
  grass: 0x5f8f3a, wood: 0x8a5e36, plank: 0xb98a52, rock: 0x8e948c, stone: 0x66706a, metal: 0x9aa7b0,
};

export function buildSandbox(scene, world) {
  const boxes = [];
  const box = (cx, by, cz, w, h, d, kind, visible = true) => {
    world.addBox(cx, by, cz, w, h, d, kind);
    if (visible) boxes.push({ cx, by, cz, w, h, d, kind });
  };

  // room: 20 x 20 m
  box(0, -1, 0, 20, 1, 20, 'grass', false);   // floor collider (drawn separately with a grid)
  const H = 4.5;
  box(0, 0, -10.25, 21, H, 0.5, 'stone');
  box(0, 0, 10.25, 21, H, 0.5, 'stone');
  box(-10.25, 0, 0, 0.5, H, 20, 'stone');
  box(10.25, 0, 0, 0.5, H, 20, 'stone');

  // stairs up to a high deck (west)
  for (let i = 0; i < 5; i++) box(-6, 0, -1 - i * 1.2, 3, 0.35 * (i + 1), 1.2, 'wood');
  box(-6, 0, -8.2, 3, 1.75, 3.2, 'wood');

  // two blocks with a 2 m gap to leap across (middle)
  box(0, 0, -3.2, 2, 0.9, 2, 'plank');
  box(0, 0, -7.2, 2, 1.2, 2, 'plank');

  // a tall pillar with a little cap to stand on (east)
  box(4.5, 0, -5, 1, 5, 1, 'rock');
  box(4.5, 5, -5, 1.8, 0.2, 1.8, 'plank');

  // a chunky wall to climb, with a ledge halfway (far east)
  box(8.6, 0, 1, 2.8, 3.4, 4, 'rock');
  box(6.95, 1.6, 1, 0.5, 0.2, 3, 'plank');

  // posts to swing around
  box(4, 0, 4, 0.4, 2.6, 0.4, 'wood');
  box(5.6, 0, 2.6, 0.4, 2.6, 0.4, 'wood');
  box(4, 0, 1.2, 0.4, 2.6, 0.4, 'wood');

  // low tunnel (crawl or push through)
  box(-8.6, 0, 4.5, 0.3, 1.2, 3.2, 'wood');
  box(-6.9, 0, 4.5, 0.3, 1.2, 3.2, 'wood');
  box(-7.75, 1.2, 4.5, 2.0, 0.2, 3.2, 'plank');

  scene.add(mergeBoxes(boxes));
  scene.add(gridFloor(20));

  const board = makeBoard();
  board.mesh.position.set(-2.4, 1.35, 3.6);
  board.mesh.rotation.y = 0.45;
  scene.add(board.mesh);

  return { spawn: new THREE.Vector3(0, 0, 6), spawnYaw: 0, board };
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
    g.fillStyle = '#9be15d'; g.font = 'bold 64px sans-serif'; g.fillText('Canopy Tag: test room', 44, 92);
    g.fillStyle = '#f4eed6'; g.font = '36px sans-serif';
    const lines = s.mode === 'vr' ? [
      'Push the ground down and back to move.',
      'Fast strokes, then let go, to leap.',
      'A / X: calibrate (stand tall, arms relaxed)',
      'B / Y: back to start    Right stick: turn',
    ] : [
      'Hold left / right click and drag down to push.',
      'Space: both hands    Q / E: turn',
      'R: back to start    Esc: pause',
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
