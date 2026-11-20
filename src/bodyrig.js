// Where a body's joints are, given only its head and hands. Used for drawing (the
// avatar bends its elbows the same way) and for working out what a punch or a grab
// touched. No graphics here, so the host can run it for every player and bot.
//
// The numbers come from tools/build_body.py (the left arm; the right mirrors in x).
// "Rig space" has the eyes at the origin, faces +Z, and the character's left is +X.
import * as THREE from 'three';

export const RIG = {
  shoulder: [0.21907, -0.31108, -0.11502],
  upper: 0.2979, fore: 0.209, hand: 0.1621,
  palmOffset: 0.08,                 // the wrist sits this far behind the controller's grip point
  maxStretch: 1.3,                  // arms may stretch this much to reach a far-away hand
  head: { centre: [0, -0.015, -0.044], r: 0.125 },
  torso: { top: -0.24, bottom: -0.7, z: -0.045, r: 0.17 },
  armR: 0.055, handR: 0.07,         // how thick limbs are, for hits
};
const UP = new THREE.Vector3(0, 1, 0);
const FINGERS = new THREE.Vector3(0, -1, 0);   // in controller grip space, the hand points along -Y
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export function makeRig() {
  const v = () => new THREE.Vector3();
  return {
    scale: 1, rootQuat: new THREE.Quaternion(), head: v(), torsoTop: v(), torsoBottom: v(),
    shoulder: [v(), v()], elbow: [v(), v()], wrist: [v(), v()], hand: [v(), v()], stretch: [1, 1],
  };
}

/**
 * Work out a body's joints.
 * @param headPos, headQuat  the eyes, in world space
 * @param hands  [{ pos, quat }] left then right: the grip point of each hand
 */
export function solveRig(headPos, headQuat, hands, scale, out = makeRig()) {
  out.scale = scale;
  // the body turns with the head, but only around the vertical
  _a.set(0, 0, -1).applyQuaternion(headQuat);
  out.rootQuat.setFromAxisAngle(UP, Math.atan2(-_a.x, -_a.z) + Math.PI);
  out.head.set(RIG.head.centre[0], RIG.head.centre[1], -RIG.head.centre[2]).multiplyScalar(scale).applyQuaternion(headQuat).add(headPos);
  out.torsoTop.set(0, RIG.torso.top, RIG.torso.z).multiplyScalar(scale).applyQuaternion(out.rootQuat).add(headPos);
  out.torsoBottom.set(0, RIG.torso.bottom, RIG.torso.z).multiplyScalar(scale).applyQuaternion(out.rootQuat).add(headPos);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1, hand = hands[i];
    const S = out.shoulder[i].set(side * RIG.shoulder[0], RIG.shoulder[1], RIG.shoulder[2]).multiplyScalar(scale).applyQuaternion(out.rootQuat).add(headPos);
    out.hand[i].copy(hand.pos);
    const W = out.wrist[i].copy(FINGERS).applyQuaternion(hand.quat).multiplyScalar(-RIG.palmOffset * scale).add(hand.pos);
    // two-bone IK: the elbow goes outward, down and back
    const d = _a.subVectors(W, S);
    const dist = d.length() || 1e-6;
    const reach = (RIG.upper + RIG.fore) * scale;
    const k = out.stretch[i] = Math.min(Math.max(dist / (reach * 0.999), 1), RIG.maxStretch);
    const a = RIG.upper * scale * k, b = RIG.fore * scale * k;
    const len = Math.min(Math.max(dist, Math.abs(a - b) + 1e-4), a + b - 1e-5);
    d.divideScalar(dist);
    const pole = _b.set(side * 0.8, -0.5, -0.6).applyQuaternion(out.rootQuat);
    pole.addScaledVector(d, -pole.dot(d)).normalize();
    const x = (a * a - b * b + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(a * a - x * x, 0));
    out.elbow[i].copy(S).addScaledVector(d, x).addScaledVector(pole, h);
    W.copy(S).addScaledVector(d, len);       // where the wrist really ends up if the hand is out of reach
  }
  return out;
}

// distance from point p to the line segment a-b
function segDist(p, a, b) {
  const ab = _c.subVectors(b, a);
  const t = Math.min(Math.max(_a.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1e-9), 0), 1);
  return _a.copy(a).addScaledVector(ab, t).distanceTo(p);
}

/**
 * Which part does a ball at p with radius r touch? Returns 'head', 'torso', 'upperL',
 * 'foreL', 'upperR', 'foreR' or null. Parts that have been cut off (cut = [left, right],
 * 0 whole / 1 below the elbow / 2 at the shoulder) cannot be hit.
 */
export function hitPart(rig, cut, p, r) {
  const s = rig.scale;
  let best = null, depth = 0;
  const test = (name, d, radius) => { const pen = radius * s + r - d; if (pen > depth) { depth = pen; best = name; } };
  test('head', rig.head.distanceTo(p), RIG.head.r);
  test('torso', segDist(p, rig.torsoTop, rig.torsoBottom), RIG.torso.r);
  for (let i = 0; i < 2; i++) {
    const L = i === 0 ? 'L' : 'R';
    if (cut[i] < 2) test('upper' + L, segDist(p, rig.shoulder[i], rig.elbow[i]), RIG.armR);
    if (cut[i] < 1) {
      test('fore' + L, segDist(p, rig.elbow[i], rig.wrist[i]), RIG.armR);
      test('fore' + L, rig.hand[i].distanceTo(p), RIG.handR);
    }
  }
  return best;
}

/** Which arm (0 left, 1 right) is within reach `r` of p, for grabbing? -1 if neither. */
export function grabArm(rig, cut, p, r) {
  const part = hitPart({ ...rig, head: FAR, torsoTop: FAR, torsoBottom: FAR }, cut, p, r);
  return part ? (part.endsWith('L') ? 0 : 1) : -1;
}
const FAR = new THREE.Vector3(1e9, 1e9, 1e9);

/** Where an arm's stump is (for blood): the elbow if cut below it, the shoulder if cut there. */
export function stumpOf(rig, arm, level) { return level === 2 ? rig.shoulder[arm] : rig.elbow[arm]; }
