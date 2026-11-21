// Body pieces: what is left lying around when an arm comes off, and the parts a dead
// body is made of (see the ragdoll in session.js). They are ordinary physics props
// (see props.js), just drawn with the real body parts. Each piece is one mesh (skin and
// raw flesh are painted on as vertex colours), so a pile of them stays cheap.
//
// A piece's ends are either whole (rounded off with skin, where it is still joined to
// the next piece of a ragdoll) or wounds (raw red, where it was cut or torn). `wounds`
// is a set of bits saying which:
//   head:      1 the neck
//   torso:     1 the neck, 2 the left shoulder, 4 the right shoulder
//   chest:     the same (the top half of a torso cut in two; its underside is always raw)
//   belly:     the bottom half (its top is always raw); guts: what falls out
//   upper arm: 1 the shoulder end, 2 the elbow end
//   forearm:   1 the elbow end          whole arm: 1 the shoulder end
//   and 8 on any arm piece means it is a right arm (the left one, mirrored).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIG } from './bodyrig.js';

let template = null;
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const FLESH = new THREE.Color(0x8c1212), BONE = new THREE.Color(0xe6d9b8), GUT = new THREE.Color(0xd08080), GUT2 = new THREE.Color(0xa85a5a);
const WAIST = -0.5;        // where a torso is cut in two (body space, metres below the eyes)
export const CUT = 16;     // a wounds bit that is always set on halves: their cut side bleeds
const DOWN = new THREE.Vector3(0, -1, 0);
const ballGeo = new THREE.IcosahedronGeometry(1, 1);
export const RIGHT = 8;
/** What a piece looks like when it is simply lying about on its own. */
export const LOOSE = { gib_head: 1, gib_torso: 7, gib_arm: 1, gib_fore: 1, gib_upper: 3, gib_chest: 7 | CUT, gib_belly: CUT, gib_guts: 0 };

/** Give this the loaded body model (assets/body-rig.glb) once it is ready. */
export function setBodyTemplate(t) { template = t; frames.clear(); }

const v3 = a => new THREE.Vector3().fromArray(a);
const part = name => template.getObjectByName(name);

// A part's triangles in body space ("rig space": eyes at the origin), position and normal only.
function bodyGeo(name) {
  const src = part(name);
  if (!src || !src.geometry) return null;
  const g = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.translate(src.position.x, src.position.y, src.position.z);
  return g;
}
// Only the triangles of `geo` whose middle passes `keep`.
function pick(geo, keep) {
  const p = geo.attributes.position, n = geo.attributes.normal, pos = [], nrm = [], c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.x += p.getX(i + k) / 3, c.y += p.getY(i + k) / 3, c.z += p.getZ(i + k) / 3;
    if (!keep(c)) continue;
    for (let k = 0; k < 3; k++) { pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); nrm.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k)); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
// The middle of a patch of triangles.
function middle(g) {
  const p = g.attributes.position, c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) c.x += p.getX(i), c.y += p.getY(i), c.z += p.getZ(i);
  return c.divideScalar(Math.max(p.count, 1));
}
// Cut a part in two at height y. Returns the triangles above and below, and a patch closing each cut.
function sliceY(geo, y) {
  const p = geo.attributes.position, up = [], dn = [], rim = [];
  const V = i => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
  for (let i = 0; i < p.count; i += 3) {
    const t = [V(i), V(i + 1), V(i + 2)], above = t.map(v => v.y >= y), n = above.filter(Boolean).length;
    if (n === 3) up.push(...t);
    else if (n === 0) dn.push(...t);
    else {
      // one corner is alone on its side of the cut: that makes a small triangle and a four-sided piece
      const k = above.findIndex(s => s === (n === 1)), a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
      const ab = a.clone().lerp(b, (y - a.y) / (b.y - a.y)), ac = a.clone().lerp(c, (y - a.y) / (c.y - a.y));
      (n === 1 ? up : dn).push(a, ab, ac);
      (n === 1 ? dn : up).push(ab, b, c, ab, c, ac);
      rim.push(ab, ac);
    }
  }
  // close the cut: a fan from the middle, to points in order round the rim
  const mid = rim.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(Math.max(rim.length, 1));
  const ring = rim.slice().sort((u, v) => Math.atan2(u.z - mid.z, u.x - mid.x) - Math.atan2(v.z - mid.z, v.x - mid.x));
  const under = [], over = [];
  for (let i = 0; i < ring.length; i++) {
    const u = ring[i], v = ring[(i + 1) % ring.length];
    under.push(mid, u, v);          // faces down: closes the top piece
    over.push(mid, v, u);           // faces up: closes the bottom piece
  }
  const soup = pts => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(v => [v.x, v.y, v.z]), 3));
    g.computeVertexNormals();
    return g;
  };
  return { up: soup(up), dn: soup(dn), under: soup(under), over: soup(over), mid };
}
function ball(r, at) {
  const g = ballGeo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (Array.isArray(r)) g.scale(...r); else g.scale(r, r, r);
  return g.translate(at.x, at.y, at.z);
}
function paint(g, color) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// The left arm's joints in body space.
function armJoints() {
  const u = part('UpperArm_L').userData, f = part('Forearm_L').userData, h = part('Hand_L').userData;
  const shoulder = v3(u.from), elbow = v3(u.to), wrist = v3(f.to), tip = v3(h.to);
  return { shoulder, elbow, wrist, tip, top: shoulder.clone().add(elbow.clone().sub(shoulder).setLength(0.09)) };
}

const frames = new Map();
/**
 * Where a piece's own middle is on a whole body, in body space at normal size: { centre,
 * turn }. A point p on the body is at turn * (p - centre) on the piece. Arm pieces are
 * laid along their own Y axis, shoulder end up. Null until the body model is loaded.
 */
export function gibFrame(typeId) {
  if (!template) return null;
  let f = frames.get(typeId);
  if (!f) {
    const turn = new THREE.Quaternion(), centre = new THREE.Vector3();
    if (typeId === 'gib_head' || typeId === 'gib_torso') {
      const g = bodyGeo(typeId === 'gib_head' ? 'Head' : 'Torso');
      g.computeBoundingBox(); g.boundingBox.getCenter(centre); g.dispose();
    } else if (typeId === 'gib_chest' || typeId === 'gib_belly') {
      const whole = bodyGeo('Torso'), cut = sliceY(whole, WAIST), g = typeId === 'gib_chest' ? cut.up : cut.dn;
      g.computeBoundingBox(); g.boundingBox.getCenter(centre);
      for (const x of [whole, cut.up, cut.dn, cut.under, cut.over]) x.dispose();
    } else if (typeId === 'gib_guts') {
      centre.set(0, WAIST, 0);
    } else {
      const j = armJoints();
      const [a, b] = typeId === 'gib_upper' ? [j.shoulder, j.elbow] : typeId === 'gib_fore' ? [j.elbow, j.tip] : [j.shoulder, j.tip];
      centre.copy(a).lerp(b, 0.5);
      turn.setFromUnitVectors(b.clone().sub(a).normalize(), DOWN);
    }
    frames.set(typeId, f = { centre, turn });
  }
  return f;
}

/** Where a piece's wounds are, as points on the piece (for blood). Works without the model. */
export function gibWounds(typeId, wounds, size = 1) {
  const out = [], P = (x, y, z) => out.push(new THREE.Vector3(x, y, z).multiplyScalar(size));
  if (typeId === 'gib_head') { if (wounds & 1) P(0, -0.1, 0); }
  else if (typeId === 'gib_torso' || typeId === 'gib_chest') {
    const top = typeId === 'gib_chest' ? 0.14 : 0.26;
    if (wounds & 1) P(0, top, 0);
    if (wounds & 2) P(0.23, top - 0.12, 0);
    if (wounds & 4) P(-0.23, top - 0.12, 0);
    if (typeId === 'gib_chest') P(0, -0.15, 0);
  } else if (typeId === 'gib_belly') P(0, 0.11, 0);
  else if (typeId === 'gib_guts') { /* they just lie there */ }
  else {
    const len = typeId === 'gib_upper' ? RIG.upper : typeId === 'gib_fore' ? RIG.fore + RIG.hand : RIG.upper + RIG.fore + RIG.hand;
    if (wounds & 1) P(0, len / 2, 0);
    if (typeId === 'gib_upper' && wounds & 2) P(0, -len / 2, 0);
  }
  return out;
}

/**
 * A model for one body piece in the given skin colour, or null if the body model is not
 * loaded (then the prop falls back to a plain shape).
 */
export function makeGib(typeId, color, wounds = LOOSE[typeId] || 0) {
  const frame = gibFrame(typeId);
  if (!frame) return null;
  const skin = new THREE.Color(color), parts = [];
  const add = (g, c = skin) => { if (g && g.attributes.position.count) parts.push(paint(g, c)); };
  // a wound: the raw patch, with the end of a bone showing in the middle of it
  const raw = (g, bone = 0.02) => {
    if (!g || !g.attributes.position.count) return;
    const at = middle(g);
    add(ball(bone, at.addScaledVector(at.clone().sub(frame.centre).normalize(), bone * 0.6)), BONE);
    add(g, FLESH);
  };
  if (typeId === 'gib_head') {
    add(bodyGeo('Head'));
    if (wounds & 1) raw(bodyGeo('Head_cap'), 0.024);
  } else if (typeId === 'gib_torso' || typeId === 'gib_chest' || typeId === 'gib_belly') {
    const whole = bodyGeo('Torso'), caps = bodyGeo('Torso_cap'), j = armJoints();
    const cut = typeId === 'gib_torso' ? null : sliceY(whole, WAIST);
    add(typeId === 'gib_torso' ? whole : typeId === 'gib_chest' ? cut.up : cut.dn);
    if (typeId !== 'gib_belly') {
      // the torso's raw inside is one piece: show only the part behind each wound
      if (wounds & 1) raw(pick(caps, c => Math.abs(c.x) < 0.09), 0.027); else add(ball([0.06, 0.05, 0.06], new THREE.Vector3(0, -0.125, -0.07)));
      if (wounds & 2) raw(pick(caps, c => c.x >= 0.09)); else add(ball(0.064, j.top));
      if (wounds & 4) raw(pick(caps, c => c.x <= -0.09)); else add(ball(0.064, j.top.clone().setX(-j.top.x)));
    }
    if (cut) {
      // the cut across the middle: raw, with the spine at the back and a few loops of gut hanging out
      add(typeId === 'gib_chest' ? cut.under : cut.over, FLESH);
      const out = typeId === 'gib_chest' ? -1 : 1;
      add(ball(0.03, cut.mid.clone().add(new THREE.Vector3(0, out * 0.012, -0.06))), BONE);
      for (const [x, z, r] of [[0.06, 0.03, 0.04], [-0.05, 0.05, 0.036], [0.0, -0.01, 0.032]]) add(ball([r, r * 0.8, r], cut.mid.clone().add(new THREE.Vector3(x, out * 0.02, z))), x > 0 ? GUT : GUT2);
    }
    caps.dispose();
  } else if (typeId === 'gib_guts') {
    // what spills out: a tangle of pink loops (this piece needs nothing from the body model)
    const coil = new THREE.TorusKnotGeometry(0.075, 0.021, 44, 5, 2, 3).scale(1, 0.45, 1).translate(0, WAIST, 0).toNonIndexed();
    coil.deleteAttribute('uv');
    add(coil, GUT);
    add(ball([0.05, 0.03, 0.04], new THREE.Vector3(0.03, WAIST + 0.01, -0.02)), GUT2);
    add(ball([0.035, 0.028, 0.035], new THREE.Vector3(-0.06, WAIST, 0.04)), FLESH);
  } else {
    const j = armJoints();
    if (typeId !== 'gib_fore') {
      add(bodyGeo('UpperArm_L'));
      const caps = bodyGeo('UpperArm_L_cap'), nearShoulder = c => c.distanceToSquared(j.shoulder) < c.distanceToSquared(j.elbow);
      if (wounds & 1) raw(pick(caps, nearShoulder)); else add(ball(0.058, j.top));
      if (typeId === 'gib_upper' && wounds & 2) raw(pick(caps, c => !nearShoulder(c)), 0.017); else add(ball(0.047, j.elbow));
      caps.dispose();
    }
    if (typeId !== 'gib_upper') {
      add(bodyGeo('Forearm_L')); add(bodyGeo('Hand_L')); add(ball(0.036, j.wrist));
      if (typeId === 'gib_fore') {
        const caps = bodyGeo('Forearm_L_cap');
        if (wounds & 1) raw(pick(caps, c => c.distanceToSquared(j.elbow) < c.distanceToSquared(j.wrist)), 0.017); else add(ball(0.047, j.elbow));
        caps.dispose();
      }
    }
  }
  if (!parts.length) return null;
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  geo.translate(-frame.centre.x, -frame.centre.y, -frame.centre.z);
  geo.applyQuaternion(frame.turn);
  if (wounds & RIGHT && ['gib_arm', 'gib_fore', 'gib_upper'].includes(typeId)) {
    // a right arm: the left one seen in a mirror (which also turns every triangle inside out, so flip them back)
    geo.scale(-1, 1, 1);
    const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
    for (let i = 0; i < p.count; i += 3) for (const a of [p, n, c]) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x, y, z);
    }
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.dispose = () => geo.dispose();
  return mesh;
}
