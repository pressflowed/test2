// Weapons: what each one does, and what it looks like. They are ordinary props (see
// props.js) that hurt when the business end is swung into somebody.
//
// A weapon's own frame has +Y running from the handle to the tip. `hilt` is where the
// hand goes (metres along Y from the middle). `hits` are the points that do damage,
// [x, y] in that frame, each a ball of radius `r`.
//
// Anything held also stops blows: catch one on your weapon and it does nothing. A shield
// (`shield` is its radius) is a disc facing the way your knuckles point (+X in its own
// frame), held `fwd` metres in front of the fist. See guardOf() and guardStops().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WEAPONS = {
  sword: { label: 'Sword', size: [0.16, 1.0, 0.05], mass: 2.2, dmg: 34, sharp: true, knock: 1, hilt: -0.38, hits: [[0, 0.02], [0, 0.24], [0, 0.44]], r: 0.05 },
  axe: { label: 'Axe', size: [0.3, 0.85, 0.06], mass: 3.5, dmg: 44, sharp: true, knock: 1.3, hilt: -0.3, hits: [[0.1, 0.26], [0.1, 0.36]], r: 0.09 },
  spear: { label: 'Spear', size: [0.07, 1.9, 0.07], mass: 2.5, dmg: 32, sharp: true, knock: 1, hilt: -0.35, hits: [[0, 0.9], [0, 0.78]], r: 0.05 },
  club: { label: 'Club', size: [0.14, 0.8, 0.14], mass: 3, dmg: 28, sharp: false, knock: 2.2, hilt: -0.3, hits: [[0, 0.08], [0, 0.3]], r: 0.08 },
  hammer: { label: 'War hammer', size: [0.3, 0.95, 0.16], mass: 5.5, dmg: 42, sharp: false, knock: 2.6, hilt: -0.33, hits: [[0, 0.38]], r: 0.13 },
  dagger: { label: 'Dagger', size: [0.1, 0.42, 0.05], mass: 0.8, dmg: 20, sharp: true, knock: 0.7, hilt: -0.13, hits: [[0, 0.04], [0, 0.17]], r: 0.045 },
  shield: { label: 'Shield', size: [0.1, 0.68, 0.68], mass: 3.5, dmg: 16, sharp: false, knock: 2.4, hilt: 0, fwd: 0.07, hits: [[0, 0]], r: 0.26, shield: 0.34 },
  greatsword: { label: 'Greatsword', size: [0.24, 1.5, 0.06], mass: 4.5, dmg: 56, sharp: true, knock: 1.6, hilt: -0.56, hits: [[0, 0.05], [0, 0.36], [0, 0.66]], r: 0.06 },
  // a bow shoots arrows (see arrows.js): `bow` is how fast a full draw sends one (m/s), what it does to
  // whoever it hits, and how far back the string comes (m). It faces the way the knuckles point, like a shield.
  bow: { label: 'Bow', size: [0.2, 1.24, 0.06], mass: 0.9, dmg: 8, sharp: false, knock: 0.5, hilt: 0, fwd: 0, hits: [[0, 0.5]], r: 0.04, bow: { speed: 36, dmg: 48, draw: 0.5 } },
};
/** The ones that hang in the arena: what you hit people with at arm's length. */
export const ARMS = ['sword', 'axe', 'spear', 'club', 'hammer', 'dagger'];
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
// A shield is held square: its face (+X) straight out from the knuckles, with no lean.
const KNUCKLES = new THREE.Vector3(0, -1, 0), THUMB = new THREE.Vector3(0, 0, -1);
const SHIELD_ROT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(KNUCKLES, THUMB, new THREE.Vector3().crossVectors(KNUCKLES, THUMB)));
/** Where a held weapon sits relative to the hand: { offset, rot }. */
export function weaponHold(w) {
  if (w.shield || w.bow) return { offset: KNUCKLES.clone().multiplyScalar(w.fwd || 0), rot: SHIELD_ROT.clone() };
  return { offset: BLADE.clone().multiplyScalar(-w.hilt), rot: HOLD_ROT.clone() };
}

// ---- blocking
/** How blocking is judged. */
export const BLOCK = {
  bar: 0.07,        // how thick a weapon counts as when it is in the way, metres
  slab: 0.06,       // half the thickness of a shield, likewise
  clang: 2,         // a blow slower than this (m/s) meets a guard without a sound
  again: 300,       // ms before the same hand can ring on a guard again
  window: 300,      // ms after meeting a guard during which that blow cannot hurt its owner
};
const _g0 = new THREE.Vector3(), _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3(), _g4 = new THREE.Vector3();

/**
 * What a held weapon stops blows with, given where it is (the pose of the prop itself).
 * A shield: a disc { disc: true, c, n, r }. Anything else: its length from just above
 * the hand to the tip { a, b, r }.
 */
export function guardOf(w, pos, quat) {
  if (w.shield) return { disc: true, c: pos.clone(), n: new THREE.Vector3(1, 0, 0).applyQuaternion(quat), r: w.shield };
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  return { a: pos.clone().addScaledVector(up, w.hilt + 0.1), b: pos.clone().addScaledVector(up, w.size[1] / 2), r: BLOCK.bar };
}

/**
 * Does something of radius r, lying along (or travelling along) the line from p0 to p1,
 * meet this guard? Returns where (a new Vector3 on the guard), or null.
 */
export function guardStops(g, p0, p1, r = 0) {
  if (g.disc) {
    const d0 = _g0.copy(p0).sub(g.c).dot(g.n), d1 = _g0.copy(p1).sub(g.c).dot(g.n);
    let t;                                        // the place along the line that is nearest the shield's face
    if ((d0 > 0) !== (d1 > 0)) t = d0 / (d0 - d1);
    else { if (Math.min(Math.abs(d0), Math.abs(d1)) > BLOCK.slab + r) return null; t = Math.abs(d0) < Math.abs(d1) ? 0 : 1; }
    const at = _g0.copy(p0).lerp(p1, t), off = _g1.copy(at).sub(g.c);
    off.addScaledVector(g.n, -off.dot(g.n));      // how far from the middle, across the face
    if (off.length() > g.r + r * 0.3) return null;
    return g.c.clone().add(off);
  }
  // nearest points of two segments (the line p0-p1 and the weapon a-b)
  const d1 = _g0.copy(p1).sub(p0), d2 = _g1.copy(g.b).sub(g.a), w0 = _g2.copy(p0).sub(g.a);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(w0);
  let s, t;
  if (a < 1e-9) { s = 0; t = e > 1e-9 ? Math.min(Math.max(f / e, 0), 1) : 0; }
  else {
    const c = d1.dot(w0);
    if (e < 1e-9) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(Math.max(-c / a, 0), 1); }
      else if (t > 1) { t = 1; s = Math.min(Math.max((b - c) / a, 0), 1); }
    }
  }
  const on = _g3.copy(g.a).addScaledVector(d2, t), mine = _g4.copy(p0).addScaledVector(d1, s);
  return on.distanceTo(mine) <= g.r + r ? on.clone() : null;
}

// ---- looks
export const STEEL = 0xcfd6dc, IRON = 0x5d646b, WOOD = 0x7a5230, DARK = 0x4a2f1c, GOLD = 0xd4a73a;
const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const forgedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x6a3a00 });
const cache = {};

export function paint(g, hex) {
  const g2 = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g2.attributes)) if (k !== 'position' && k !== 'normal') g2.deleteAttribute(k);
  const c = new THREE.Color(hex), n = g2.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g2;
}
export const box = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
// a rod along Y from y0 to y1
export const rod = (r0, r1, y0, y1, c, sides = 8, x = 0) => paint(new THREE.CylinderGeometry(r1, r0, y1 - y0, sides).translate(x, (y0 + y1) / 2, 0), c);

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
  greatsword: () => [
    rod(0.036, 0.036, -0.75, -0.7, GOLD, 6), rod(0.02, 0.02, -0.71, -0.42, DARK), box(0.24, 0.036, 0.05, 0, -0.4, 0, GOLD),
    box(0.075, 1.02, 0.016, 0, 0.13, 0, STEEL), box(0.02, 0.9, 0.022, 0, 0.1, 0, IRON),
    paint(new THREE.CylinderGeometry(0, 0.053, 0.11, 4).rotateY(Math.PI / 4).scale(1, 1, 0.22).translate(0, 0.695, 0), STEEL),
  ],
  // a bow: the grip in the middle, two limbs bending back toward the archer (-X), and the string
  bow: () => {
    const limb = (y0, x0, y1, x1, r, c) => {
      const len = Math.hypot(y1 - y0, x1 - x0);
      return paint(new THREE.CylinderGeometry(r, r, len, 6).rotateZ(-Math.atan2(x1 - x0, y1 - y0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0), c);
    };
    const parts = [rod(0.02, 0.02, -0.09, 0.09, DARK, 6)];
    for (const s of [-1, 1]) parts.push(limb(s * 0.09, 0, s * 0.34, 0.03, 0.016, WOOD), limb(s * 0.34, 0.03, s * 0.54, -0.03, 0.013, WOOD), limb(s * 0.54, -0.03, s * 0.62, -0.1, 0.01, WOOD));
    parts.push(limb(-0.62, -0.1, 0.62, -0.1, 0.004, 0xe8e2cc));
    return parts;
  },
  // a round wooden shield: its face looks along +X, the hand grips a bar behind the boss
  shield: () => {
    const disc = (r, x0, x1, c, sides = 16) => paint(new THREE.CylinderGeometry(r, r, x1 - x0, sides).rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, 0, 0), c);
    const parts = [
      disc(0.34, -0.012, 0.012, 0x8a5a2c), disc(0.3, 0.012, 0.02, 0xa32a22),                       // boards, painted red on the face
      paint(new THREE.TorusGeometry(0.33, 0.016, 5, 16).rotateY(Math.PI / 2), IRON),                // iron rim
      paint(new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(0.018, 0, 0), STEEL),   // the boss
      box(0.012, 0.6, 0.05, 0.022, 0, 0, GOLD), box(0.012, 0.05, 0.6, 0.022, 0, 0, GOLD),           // a cross on the face
      box(0.02, 0.26, 0.028, -0.06, 0, 0, DARK), box(0.05, 0.03, 0.03, -0.035, 0.12, 0, DARK), box(0.05, 0.03, 0.03, -0.035, -0.12, 0, DARK),   // the grip behind
    ];
    return parts;
  },
};

/**
 * { geo, mat } for a weapon, shared by every copy of it. `blood` (0 to 3) is how much of
 * it there is on the business end: a weapon gets redder each time it is used on someone.
 */
export const MAX_BLOOD = 3;
export function weaponVisual(id, blood = 0, forged = false) {
  blood = Math.min(Math.max(blood | 0, 0), MAX_BLOOD);
  const key = id + ':' + blood + (forged ? ':f' : '');
  if (!cache[key] && forged) {
    // the same weapon out of the forge: its steel glows like hot gold
    const geo = weaponVisual(id, blood).geo.clone(), c = geo.attributes.color, hot = new THREE.Color(0xffb020), steel = new THREE.Color(STEEL), iron = new THREE.Color(IRON), col = new THREE.Color();
    for (let i = 0; i < c.count; i++) {
      col.setRGB(c.getX(i), c.getY(i), c.getZ(i));
      const metal = Math.max(0, 1 - Math.min(Math.hypot(col.r - steel.r, col.g - steel.g, col.b - steel.b), Math.hypot(col.r - iron.r, col.g - iron.g, col.b - iron.b)) * 4);
      c.setXYZ(i, col.r + (hot.r - col.r) * metal * 0.8, col.g + (hot.g - col.g) * metal * 0.8, col.b + (hot.b - col.b) * metal * 0.8);
    }
    cache[key] = { geo, mat: forgedMaterial };
  }
  if (!cache[key]) {
    if (blood === 0) {
      const parts = BUILD[id]();
      cache[key] = { geo: mergeGeometries(parts), mat: material };
      for (const g of parts) g.dispose();
    } else {
      // the clean one, with red worked into everything from the first striking point outward
      const geo = weaponVisual(id).geo.clone(), p = geo.attributes.position, c = geo.attributes.color, w = WEAPONS[id];
      const from = w.shield ? -Infinity : Math.min(...w.hits.map(h => h[1])) - 0.12, red = new THREE.Color(0x7a0808);
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < from || (w.shield && p.getX(i) < 0.005)) continue;
        const tri = Math.floor(i / 3), patchy = ((Math.imul(tri + 7, 2654435761) >>> 0) % 1000) / 1000;        // the same blotches every time
        const k = Math.min(1, (blood / MAX_BLOOD) * (0.7 + 0.9 * patchy));
        c.setXYZ(i, c.getX(i) + (red.r - c.getX(i)) * k, c.getY(i) + (red.g - c.getY(i)) * k, c.getZ(i) + (red.b - c.getZ(i)) * k);
      }
      cache[key] = { geo, mat: material };
    }
  }
  return cache[key];
}
