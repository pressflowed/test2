// Textures painted on canvases at startup, so the game needs no image files.
// Everything tiles seamlessly. In Node (tests) there is no canvas, so these return null.
import * as THREE from 'three';

const HAS_DOM = typeof document !== 'undefined';
const cache = {};

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function make(size, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Draw something at (x, y) and at its wrapped copies, so the texture tiles without seams.
function wrap(size, x, y, margin, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = x + ox * size, py = y + oy * size;
    if (px > -margin && px < size + margin && py > -margin && py < size + margin) fn(px, py);
  }
}

function speckle(g, s, r, n, colors, minR, maxR, alpha = 0.5) {
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, rad = minR + r() * (maxR - minR);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    wrap(s, x, y, rad, (px, py) => { g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill(); });
  }
  g.globalAlpha = 1;
}

const PAINT = {
  grass(g, s) {
    const r = rng(11);
    g.fillStyle = '#5a9140'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 60, ['#4c8236', '#69a04a', '#527f38'], 14, 40, 0.35);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = r() * s, y = r() * s, len = 3 + r() * 7, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      g.strokeStyle = ['#3f7a2e', '#77b052', '#4f8f38', '#8cc463', '#356b29'][Math.floor(r() * 5)];
      g.globalAlpha = 0.55 + r() * 0.4; g.lineWidth = 1 + r() * 1.2;
      wrap(s, x, y, 10, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke(); });
    }
    g.globalAlpha = 1;
  },
  wood(g, s) { // bark
    const r = rng(23);
    g.fillStyle = '#6f4a2c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = r() * s, w = 1.5 + r() * 5;
      g.strokeStyle = r() < 0.6 ? '#4f331d' : '#8a6038';
      g.globalAlpha = 0.5 + r() * 0.4; g.lineWidth = w;
      const wob = 3 + r() * 6, ph = r() * 6;
      wrap(s, x, 0, 16, px => {
        g.beginPath();
        for (let y = 0; y <= s; y += 8) { const xx = px + Math.sin(y / s * Math.PI * 2 * 2 + ph) * wob; y ? g.lineTo(xx, y) : g.moveTo(xx, y); }
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  },
  plank(g, s) {
    const r = rng(37), n = 4, h = s / n;
    for (let i = 0; i < n; i++) {
      const l = 58 + r() * 10;
      g.fillStyle = `hsl(32, 42%, ${l}%)`; g.fillRect(0, i * h, s, h);
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = r() < 0.5 ? 'rgba(90,55,25,.35)' : 'rgba(255,225,170,.25)';
        g.lineWidth = 1; const y = i * h + 3 + r() * (h - 6);
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 5, s * 0.7, y + (r() - 0.5) * 5, s, y); g.stroke();
      }
      g.fillStyle = 'rgba(50,28,12,.75)'; g.fillRect(0, i * h, s, 3);
      const seam = r() * s;
      g.fillRect(seam, i * h, 3, h);
      g.fillStyle = 'rgba(40,24,12,.8)';
      for (const dx of [10, -12]) { g.beginPath(); g.arc((seam + dx + s) % s, i * h + h * 0.3, 2.5, 0, 7); g.arc((seam + dx + s) % s, i * h + h * 0.75, 2.5, 0, 7); g.fill(); }
    }
  },
  rock(g, s) {
    const r = rng(41);
    g.fillStyle = '#8b918a'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 140, ['#7b817a', '#9ba19a', '#6f756f', '#a7ada6'], 8, 34, 0.4);
    speckle(g, s, r, 900, ['#5f655f', '#b5bbb4'], 0.6, 2, 0.6);
    g.strokeStyle = 'rgba(50,54,50,.55)'; g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      let x = r() * s, y = r() * s;
      wrap(s, x, y, 80, (px, py) => {
        const rr = rng(100 + i);
        g.beginPath(); g.moveTo(px, py);
        for (let k = 0; k < 6; k++) { px += (rr() - 0.5) * 34; py += (rr() - 0.2) * 22; g.lineTo(px, py); }
        g.stroke();
      });
    }
  },
  stone(g, s) { // wall blocks
    const r = rng(53), rows = 4, h = s / rows;
    g.fillStyle = '#3c423e'; g.fillRect(0, 0, s, s);
    for (let j = 0; j < rows; j++) {
      const cols = 2, w = s / cols, off = (j % 2) * w / 2;
      for (let i = -1; i <= cols; i++) {
        const l = 38 + r() * 12;
        g.fillStyle = `hsl(140, 5%, ${l}%)`;
        g.fillRect(i * w + off + 3, j * h + 3, w - 6, h - 6);
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(i * w + off + 3, j * h + 3, w - 6, 4);
        g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(i * w + off + 3, j * h + h - 8, w - 6, 5);
      }
    }
    speckle(g, s, r, 500, ['#2f3531', '#8a918b'], 0.6, 2.2, 0.35);
  },
  leaf(g, s) {
    const r = rng(67);
    g.fillStyle = '#35803a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 520; i++) {
      const x = r() * s, y = r() * s, a = r() * Math.PI, w = 5 + r() * 7;
      g.fillStyle = ['#2c6e31', '#49a04c', '#3d8f43', '#5fb65c', '#256029'][Math.floor(r() * 5)];
      g.globalAlpha = 0.85;
      wrap(s, x, y, 14, (px, py) => { g.beginPath(); g.ellipse(px, py, w, w * 0.45, a, 0, 7); g.fill(); });
    }
    g.globalAlpha = 1;
  },
  crate(g, s) {
    PAINT.plank(g, s);
    g.fillStyle = 'rgba(120,75,35,.35)'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#6b4322'; g.lineWidth = s * 0.11; g.strokeRect(0, 0, s, s);
    g.lineWidth = s * 0.08; g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.stroke();
    g.strokeStyle = 'rgba(40,22,8,.5)'; g.lineWidth = 2; g.strokeRect(s * 0.055, s * 0.055, s * 0.89, s * 0.89);
    g.fillStyle = '#3a2a1a';
    for (const [x, y] of [[.06, .06], [.94, .06], [.06, .94], [.94, .94]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.018, 0, 7); g.fill(); }
  },
  metal(g, s) {
    const r = rng(71);
    g.fillStyle = '#98a5ae'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 240; i++) { g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(40,50,60,.12)'; const y = r() * s; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    g.strokeStyle = 'rgba(40,50,60,.6)'; g.lineWidth = 4; g.strokeRect(2, 2, s - 4, s - 4);
    g.fillStyle = '#5f6b74';
    for (const [x, y] of [[.1, .1], [.9, .1], [.1, .9], [.9, .9]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.03, 0, 7); g.fill(); }
  },
  brick(g, s) {
    const r = rng(83), rows = 8, h = s / rows, w = s / 4;
    g.fillStyle = '#cdbfae'; g.fillRect(0, 0, s, s);   // mortar
    for (let j = 0; j < rows; j++) for (let i = -1; i < 4; i++) {
      const x = i * w + (j % 2) * w / 2;
      g.fillStyle = `hsl(${10 + r() * 10}, ${42 + r() * 14}%, ${34 + r() * 12}%)`;
      g.fillRect(x + 2, j * h + 2, w - 4, h - 4);
      g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 2, j * h + 2, w - 4, 3);
    }
    speckle(g, s, r, 400, ['#5a2a20', '#d8a090'], 0.6, 1.8, 0.3);
  },
  roof(g, s) { // overlapping tiles
    const r = rng(89), rows = 6, h = s / rows, w = s / 6;
    g.fillStyle = '#5a2a24'; g.fillRect(0, 0, s, s);
    for (let j = 0; j < rows; j++) for (let i = -1; i < 6; i++) {
      const x = i * w + (j % 2) * w / 2, y = j * h;
      g.fillStyle = `hsl(${6 + r() * 8}, ${45 + r() * 10}%, ${30 + r() * 10}%)`;
      g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + w - 2, y); g.lineTo(x + w - 2, y + h * 0.7); g.arc(x + w / 2, y + h * 0.7, w / 2 - 2, 0, Math.PI); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 2, y, w - 4, 3);
    }
  },
  hay(g, s) {
    const r = rng(97);
    g.fillStyle = '#d2ab45'; g.fillRect(0, 0, s, s);
    g.lineCap = 'round';
    for (let i = 0; i < 1800; i++) {
      const x = r() * s, y = r() * s, len = 8 + r() * 22, a = (r() - 0.5) * 0.7;
      g.strokeStyle = ['#b98c2e', '#ecd070', '#c79c38', '#f5e08a', '#a67c26'][Math.floor(r() * 5)];
      g.globalAlpha = 0.7; g.lineWidth = 1 + r() * 1.5;
      wrap(s, x, y, 24, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke(); });
    }
    g.globalAlpha = 1;
  },
  plaster(g, s) {
    const r = rng(101);
    g.fillStyle = '#e4d9c0'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 90, ['#d6c9ad', '#efe6d2', '#cfc0a2'], 10, 36, 0.35);
    speckle(g, s, r, 500, ['#bfae8e', '#f6efe0'], 0.6, 1.6, 0.4);
  },
  dirt(g, s) {
    const r = rng(103);
    g.fillStyle = '#765639'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 120, ['#68492f', '#866545', '#5c4029'], 8, 30, 0.4);
    speckle(g, s, r, 700, ['#4a3320', '#9a7a58', '#8d8478'], 0.8, 2.6, 0.6);
  },
  sand(g, s) {
    const r = rng(107);
    g.fillStyle = '#d6b877'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 110, ['#c9a965', '#e2c98c', '#cdb06f'], 10, 34, 0.35);
    speckle(g, s, r, 1400, ['#b8975a', '#eedaa6', '#a98a52'], 0.5, 1.4, 0.55);
  },
  marble(g, s) { // pale stone blocks with faint veins
    const r = rng(109);
    g.fillStyle = '#d5cdbd'; g.fillRect(0, 0, s, s);
    speckle(g, s, r, 70, ['#c8bfad', '#e1dacb', '#cfc6b3'], 12, 40, 0.35);
    g.strokeStyle = 'rgba(120,110,95,.35)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      let x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += (r() - 0.2) * 34; g.lineTo(x, y); }
      g.stroke();
    }
    // block joints
    g.strokeStyle = 'rgba(90,82,70,.5)'; g.lineWidth = 2;
    for (let row = 0; row < 2; row++) {
      const y = row * s / 2;
      g.beginPath(); g.moveTo(0, y + 1); g.lineTo(s, y + 1); g.stroke();
      for (let c = 0; c < 2; c++) { const x = (c + (row ? 0.5 : 0)) * s / 2; g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + 1, y + s / 2); g.stroke(); }
    }
  },

  // ---- props (not tiled across the world, drawn once per face or wrapped round)
  ball(g, s) {
    g.fillStyle = '#e0523a'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f6efe2'; g.fillRect(0, s * 0.42, s, s * 0.16);
    g.fillStyle = '#b53a26'; g.fillRect(0, s * 0.4, s, s * 0.02); g.fillRect(0, s * 0.58, s, s * 0.02);
  },
  beachball(g, s) {
    const c = ['#ff5a5a', '#ffffff', '#ffd23f', '#ffffff', '#3fa9ff', '#ffffff'];
    c.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * s / 6, 0, s / 6 + 1, s); });
  },
  bouncyball(g, s) {
    g.fillStyle = '#ff5fc0'; g.fillRect(0, 0, s, s);
    const r = rng(5);
    for (let i = 0; i < 40; i++) { g.fillStyle = ['#fff07a', '#7af0ff', '#ffffff'][i % 3]; g.beginPath(); g.arc(r() * s, r() * s, 4 + r() * 7, 0, 7); g.fill(); }
  },
  giantball(g, s) {
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#2a2a2e';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) { g.beginPath(); g.arc((i + (j % 2) * 0.5) * s / 8, (j + 0.5) * s / 4, s * 0.035, 0, 7); g.fill(); }
  },
  balloon(g, s) {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#ff8fa8'); grd.addColorStop(1, '#d93a5e');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.ellipse(s * 0.3, s * 0.3, s * 0.05, s * 0.09, 0.5, 0, 7); g.fill();
  },
  barrel(g, s) {
    const n = 10;
    for (let i = 0; i < n; i++) { g.fillStyle = `hsl(26, 45%, ${28 + (i * 37 % 9)}%)`; g.fillRect(i * s / n, 0, s / n, s); g.fillStyle = 'rgba(30,15,5,.6)'; g.fillRect(i * s / n, 0, 2, s); }
    g.fillStyle = '#4a4f55'; for (const y of [0.12, 0.5, 0.82]) g.fillRect(0, y * s, s, s * 0.06);
  },
  tire(g, s) {
    g.fillStyle = '#222326'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#3a3b40'; g.lineWidth = 6;
    for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(i * s / 16, 0); g.lineTo(i * s / 16 + s / 32, s / 2); g.lineTo(i * s / 16, s); g.stroke(); }
  },
  cone(g, s) {
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffffff'; g.fillRect(0, s * 0.3, s, s * 0.14); g.fillRect(0, s * 0.58, s, s * 0.1);
  },
  pin(g, s) {
    g.fillStyle = '#f7f4ea'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#d83a3a'; g.fillRect(0, s * 0.2, s, s * 0.05); g.fillRect(0, s * 0.29, s, s * 0.05);
  },
  domino(g, s) {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f2efe6'; g.fillRect(s * 0.1, s * 0.49, s * 0.8, s * 0.02);
    for (const [x, y] of [[.3, .2], [.7, .32], [.5, .26], [.3, .68], [.7, .68], [.3, .84], [.7, .84]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.05, 0, 7); g.fill(); }
  },
  dice(g, s) {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#c9c4b4'; g.lineWidth = s * 0.05; g.strokeRect(0, 0, s, s);
    g.fillStyle = '#c92f2f';
    for (const [x, y] of [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.08, 0, 7); g.fill(); }
  },
  anvil(g, s) {
    PAINT.metal(g, s);
    g.fillStyle = 'rgba(15,18,24,.72)'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c9ced4'; g.font = `bold ${s * 0.2}px sans-serif`; g.textAlign = 'center'; g.fillText('150 KG', s / 2, s * 0.58);
  },
  tnt(g, s) {
    g.fillStyle = '#c5281c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#8f1a12'; for (let i = 0; i < 5; i++) g.fillRect(i * s / 4 - 2, 0, 4, s);
    g.fillStyle = '#f4eed6'; g.fillRect(0, s * 0.32, s, s * 0.36);
    g.fillStyle = '#17181c'; g.font = `900 ${s * 0.3}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TNT', s / 2, s * 0.51);
  },
  trampoline(g, s) {
    g.fillStyle = '#1c9c5a'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#12161a'; g.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    for (let i = 0; i <= 16; i++) { const p = s * 0.1 + i * s * 0.05; g.beginPath(); g.moveTo(p, s * 0.1); g.lineTo(p, s * 0.9); g.moveTo(s * 0.1, p); g.lineTo(s * 0.9, p); g.stroke(); }
    g.strokeStyle = '#f4eed6'; g.lineWidth = s * 0.015; g.strokeRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
  },
  launchpad(g, s) {
    g.fillStyle = '#2b2f3a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#ffd23f'; g.lineWidth = s * 0.06; g.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
    g.fillStyle = '#ffd23f';
    for (const y of [0.3, 0.52, 0.74]) { g.beginPath(); g.moveTo(s * 0.5, (y - 0.14) * s); g.lineTo(s * 0.74, y * s); g.lineTo(s * 0.62, y * s); g.lineTo(s * 0.5, (y - 0.06) * s); g.lineTo(s * 0.38, y * s); g.lineTo(s * 0.26, y * s); g.closePath(); g.fill(); }
  },
  block(g, s) {
    g.fillStyle = '#e9c46a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#c79a3a'; g.lineWidth = s * 0.07; g.strokeRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(s * 0.08, s * 0.08, s * 0.84, s * 0.1);
  },
};
// props that reuse a level texture
const ALIAS = { bigcrate: 'crate', platform: 'metal', wall: 'stone', pillar: 'stone', beam: 'wood', table: 'plank', 'grass-dark': 'grass' };

/** A texture by name, or null if there is none (or no canvas, as in tests). */
export function texture(name) {
  if (!HAS_DOM) return null;
  name = ALIAS[name] || name;
  if (!PAINT[name]) return null;
  if (!cache[name]) cache[name] = make(256, PAINT[name]);
  return cache[name];
}

/** Soft round blob (white, fading out): used for shadows, the sun, clouds and flashes. */
export function blobTexture() {
  if (!HAS_DOM) return null;
  if (!cache._blob) {
    cache._blob = make(128, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }, false);
  }
  return cache._blob;
}

/** A puffy cloud. */
export function cloudTexture() {
  if (!HAS_DOM) return null;
  if (!cache._cloud) {
    cache._cloud = make(256, (g, s) => {
      const r = rng(9);
      for (let i = 0; i < 22; i++) {
        const x = s * (0.2 + r() * 0.6), y = s * (0.38 + r() * 0.24), rad = s * (0.1 + r() * 0.14);
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
      }
    }, false);
  }
  return cache._cloud;
}

/**
 * Several textures stacked into one array texture (one layer each), so the whole voxel
 * world can be drawn with a single material. Layer 0 is plain white.
 */
export function textureArray(names, size = 256) {
  if (!HAS_DOM) return null;
  const data = new Uint8Array(size * size * 4 * (names.length + 1));
  data.fill(255, 0, size * size * 4);
  names.forEach((name, n) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d', { willReadFrequently: true });
    (PAINT[ALIAS[name] || name] || PAINT.rock)(g, size);
    data.set(g.getImageData(0, 0, size, size).data, (n + 1) * size * size * 4);
  });
  const tex = new THREE.DataArrayTexture(data, size, size, names.length + 1);
  tex.format = THREE.RGBAFormat;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
