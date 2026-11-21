// Weapons: what each one does, and what it looks like. They are ordinary props (see
// props.js) that hurt when the business end is swung into somebody.
//
// A weapon's own frame has +Y running from the handle to the tip. `hilt` is where the
// hand goes (metres along Y from the middle). `hits` are the points that do damage,
// [x, y] in that frame, each a ball of radius `r`.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WEAPONS = {
  sword: { label: 'Sword', size: [0.16, 1.0, 0.05], mass: 2.2, dmg: 34, sharp: true, knock: 1, hilt: -0.38, hits: [[0, 0.02], [0, 0.24], [0, 0.44]], r: 0.05 },
  axe: { label: 'Axe', size: [0.3, 0.85, 0.06], mass: 3.5, dmg: 44, sharp: true, knock: 1.3, hilt: -0.3, hits: [[0.1, 0.26], [0.1, 0.36]], r: 0.09 },
  spear: { label: 'Spear', size: [0.07, 1.9, 0.07], mass: 2.5, dmg: 32, sharp: true, knock: 1, hilt: -0.35, hits: [[0, 0.9], [0, 0.78]], r: 0.05 },
  club: { label: 'Club', size: [0.14, 0.8, 0.14], mass: 3, dmg: 28, sharp: false, knock: 2.2, hilt: -0.3, hits: [[0, 0.08], [0, 0.3]], r: 0.08 },
  hammer: { label: 'War hammer', size: [0.3, 0.95, 0.16], mass: 5.5, dmg: 42, sharp: false, knock: 2.6, hilt: -0.33, hits: [[0, 0.38]], r: 0.13 },
  dagger: { label: 'Dagger', size: [0.1, 0.42, 0.05], mass: 0.8, dmg: 20, sharp: true, knock: 0.7, hilt: -0.13, hits: [[0, 0.04], [0, 0.17]], r: 0.045 },
};
/** How fast (m/s, at normal size) the business end must be moving to hurt. */
export const SWING = { min: 2, full: 6 };
/** Damage for a swing at speed v by a player of size s. */
export function swingPower(w, v, s = 1) { return w.dmg * Math.min(Math.max((v - 1) / (SWING.full - 1), 0.3), 1.3) * s ** 1.5; }

// How a weapon sits in a fist, in the hand's own (grip) space: out of the thumb side,
// leaning a little toward the knuckles, with the edge facing the knuckles.
const TILT = 0.45;
const BLADE = new THREE.Vector3(0, -Math.sin(TILT), -Math.cos(TILT));
const EDGE = new THREE.Vector3(0, -1, 0).addScaledVector(BLADE, -new THREE.Vector3(0, -1, 0).dot(BLADE)).normalize();
const HOLD_ROT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(EDGE, BLADE, new THREE.Vector3().crossVectors(EDGE, BLADE)));
/** Where a held weapon sits relative to the hand: { offset, rot }. */
export function weaponHold(w) {
  return { offset: BLADE.clone().multiplyScalar(-w.hilt), rot: HOLD_ROT.clone() };
}

// ---- looks
const STEEL = 0xcfd6dc, IRON = 0x5d646b, WOOD = 0x7a5230, DARK = 0x4a2f1c, GOLD = 0xd4a73a;
const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const cache = {};

function paint(g, hex) {
  const g2 = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g2.attributes)) if (k !== 'position' && k !== 'normal') g2.deleteAttribute(k);
  const c = new THREE.Color(hex), n = g2.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g2;
}
const box = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
// a rod along Y from y0 to y1
const rod = (r0, r1, y0, y1, c, sides = 8, x = 0) => paint(new THREE.CylinderGeometry(r1, r0, y1 - y0, sides).translate(x, (y0 + y1) / 2, 0), c);

const BUILD = {
  sword: () => [
    rod(0.03, 0.03, -0.5, -0.455, GOLD, 6), rod(0.018, 0.018, -0.46, -0.3, DARK), box(0.16, 0.03, 0.045, 0, -0.285, 0, GOLD),
    box(0.055, 0.7, 0.014, 0, 0.08, 0, STEEL), paint(new THREE.CylinderGeometry(0, 0.039, 0.07, 4).rotateY(Math.PI / 4).scale(1, 1, 0.26).translate(0, 0.465, 0), STEEL),
  ],
  axe: () => [
    rod(0.02, 0.018, -0.425, 0.425, WOOD), rod(0.024, 0.024, -0.425, -0.38, DARK),
    box(0.15, 0.2, 0.02, 0.085, 0.3, 0, STEEL), box(0.03, 0.26, 0.012, 0.17, 0.3, 0, STEEL), box(0.05, 0.1, 0.03, -0.03, 0.3, 0, IRON),
  ],
  spear: () => [
    rod(0.018, 0.016, -0.95, 0.76, WOOD), rod(0.024, 0.02, 0.72, 0.78, IRON, 6),
    paint(new THREE.CylinderGeometry(0, 0.04, 0.2, 4).scale(1, 1, 0.45).translate(0, 0.85, 0), STEEL),
  ],
  club: () => [rod(0.024, 0.07, -0.4, 0.36, WOOD, 7), rod(0.07, 0.05, 0.36, 0.4, WOOD, 7), rod(0.03, 0.026, -0.4, -0.37, DARK, 7)],
  hammer: () => [
    rod(0.022, 0.02, -0.475, 0.44, WOOD), rod(0.027, 0.027, -0.475, -0.42, DARK),
    box(0.28, 0.15, 0.15, 0, 0.385, 0, IRON), box(0.3, 0.11, 0.11, 0, 0.385, 0, STEEL),
  ],
  dagger: () => [
    rod(0.016, 0.016, -0.21, -0.07, DARK), box(0.1, 0.022, 0.035, 0, -0.06, 0, GOLD),
    box(0.04, 0.2, 0.012, 0, 0.05, 0, STEEL), paint(new THREE.CylinderGeometry(0, 0.028, 0.06, 4).rotateY(Math.PI / 4).scale(1, 1, 0.3).translate(0, 0.18, 0), STEEL),
  ],
};

/**
 * { geo, mat } for a weapon, shared by every copy of it. `blood` (0 to 3) is how much of
 * it there is on the business end: a weapon gets redder each time it is used on someone.
 */
export const MAX_BLOOD = 3;
export function weaponVisual(id, blood = 0) {
  blood = Math.min(Math.max(blood | 0, 0), MAX_BLOOD);
  const key = id + ':' + blood;
  if (!cache[key]) {
    if (blood === 0) {
      const parts = BUILD[id]();
      cache[key] = { geo: mergeGeometries(parts), mat: material };
      for (const g of parts) g.dispose();
    } else {
      // the clean one, with red worked into everything from the first striking point outward
      const geo = weaponVisual(id).geo.clone(), p = geo.attributes.position, c = geo.attributes.color, w = WEAPONS[id];
      const from = Math.min(...w.hits.map(h => h[1])) - 0.12, red = new THREE.Color(0x7a0808);
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < from) continue;
        const tri = Math.floor(i / 3), patchy = ((Math.imul(tri + 7, 2654435761) >>> 0) % 1000) / 1000;        // the same blotches every time
        const k = Math.min(1, (blood / MAX_BLOOD) * (0.7 + 0.9 * patchy));
        c.setXYZ(i, c.getX(i) + (red.r - c.getX(i)) * k, c.getY(i) + (red.g - c.getY(i)) * k, c.getZ(i) + (red.b - c.getZ(i)) * k);
      }
      cache[key] = { geo, mat: material };
    }
  }
  return cache[key];
}
