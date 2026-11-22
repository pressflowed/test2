// A player's body: flesh on the outside, the skeleton's arm bones inside.
// The head follows the headset, hands follow the hands, and the elbows are solved
// with two-bone IK (the same maths as src/bodyrig.js, which works out hits).
// Uses assets/body-rig.glb made by tools/build_body.py.
//
// Damage shows on the body: blood stains it where it is hit (and stains the fists that
// did the hitting), a badly hurt arm segment loses its flesh and shows bone, a lost arm
// leaves a red stump with the bone end showing, and a dead body is not drawn at all
// (it is lying around as props instead).
import * as THREE from 'three';
import { SLOTS, wornArmour } from './armour.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIG } from './bodyrig.js';

const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// How the fist sits on a controller, in WebXR "grip space":
//   -Z runs through the fist from little finger to thumb,
//   +X is the way the left palm faces (and the back of the right hand),
//   -Y is where the knuckles point (along the forearm, away from you).
// So the virtual palm faces wherever your real palm faces.
const FINGERS = new THREE.Vector3(0, -1, 0);

export const SKIN = 0xe0ac86;
const BLOOD = new THREE.Color(0x7a0a0a);
const fleshMat = new THREE.MeshLambertMaterial({ color: 0x8c1212, flatShading: true });
const boneMat = new THREE.MeshLambertMaterial({ color: 0xe6d9b8, side: THREE.DoubleSide });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14100e });
const eyeGeo = new THREE.BoxGeometry(0.022, 0.016, 0.012);
const ballGeo = new THREE.IcosahedronGeometry(1, 1);

// Every separate mesh costs the headset a little each frame, and a room full of bodies adds
// up. So the balls that round off each joint are welded onto the part they belong to, once
// per model, and every body shares the result.
const plain = geo => {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
};
const welded = new Map();
/** geo plus a ball of size r (a number, or [x, y, z]) at `at`. */
function withBall(geo, r, at = null) {
  let out = welded.get(geo);
  if (!out) {
    const ball = plain(ballGeo);
    if (Array.isArray(r)) ball.scale(...r); else ball.scale(r, r, r);
    if (at) ball.translate(at.x, at.y, at.z);
    welded.set(geo, out = mergeGeometries([plain(geo), ball]));
  }
  return out;
}
const eyes = new Map();
function eyesGeo(template) {
  let out = eyes.get(template);
  if (!out) {
    out = mergeGeometries(template.getObjectByName('Head').userData.eyes.map(e => plain(eyeGeo).translate(e[0], e[1], e[2] + 0.004)));
    eyes.set(template, out);
  }
  return out;
}

export class Avatar {
  /** Load the model once; every Avatar is made from a copy of it. */
  static async loadTemplate(url) {
    return (await new GLTFLoader().loadAsync(url)).scene;
  }

  constructor(template, scene, { color = SKIN, name = null } = {}) {
    const src = template.clone(true);
    this.scene = scene;
    const mesh = {};
    src.traverse(o => { if (o.isMesh) mesh[o.name] = o; });
    this.skin = new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: true });      // vertex colours carry the bloodstains
    for (const [n, m] of Object.entries(mesh)) {
      m.material = n.startsWith('Bone_') ? boneMat : n.endsWith('_cap') ? fleshMat : this.skin;
      m.frustumCulled = false;
      m.position.set(0, 0, 0);          // every part sits at its own pivot, placed below
    }
    const v = a => new THREE.Vector3().fromArray(a);
    const ball = r => { const b = new THREE.Mesh(ballGeo, this.plainSkin || (this.plainSkin = new THREE.MeshLambertMaterial({ color, flatShading: true }))); b.scale.setScalar(r); b.frustumCulled = false; return b; };
    const nub = r => { const b = new THREE.Mesh(ballGeo, boneMat); b.scale.setScalar(r); b.frustumCulled = false; b.visible = false; return b; };

    // root: follows the head position and turns with the view (yaw only). Holds the torso.
    this.root = new THREE.Group();
    scene.add(this.root);
    this.armour = [null, null];       // the helmet and chest plate meshes, once worn (see setBody)
    this.torso = mesh.Torso; this.torsoCap = mesh.Torso_cap;
    this.root.add(this.torso, this.torsoCap);
    // head: turns freely with the headset
    this.head = new THREE.Group();
    this.head.add(mesh.Head, mesh.Head_cap);
    const eye = new THREE.Mesh(eyesGeo(template), eyeMat);
    eye.frustumCulled = false;
    this.head.add(eye);
    this.eyes = eye;
    mesh.Head_cap.visible = false;
    this.root.add(this.head);
    // a neck piece joins head and body, and closes the hole you would otherwise see looking down in first person
    this.torso.geometry = withBall(this.torso.geometry, [0.06, 0.05, 0.06], new THREE.Vector3(0, -0.125, -0.07));

    this.arms = ['L', 'R'].map((s, i) => {
      const part = n => {
        const g = new THREE.Group();
        const flesh = mesh[`${n}_${s}`], cap = mesh[`${n}_${s}_cap`], bone = mesh[`Bone_${n}_${s}`];
        g.add(flesh, cap, bone);
        cap.visible = false; bone.visible = false;
        scene.add(g);
        return { g, flesh, cap, bone };
      };
      const upper = part('UpperArm'), fore = part('Forearm'), hand = part('Hand');
      const ud = upper.flesh.userData, fd = fore.flesh.userData, hd = hand.flesh.userData;
      const shoulder = v(ud.from), elbow = v(ud.to), wrist = v(fd.to), tip = v(hd.to);
      // Balls at the joints hide the gaps that open when an arm bends. The arm's flesh starts a
      // little below the shoulder joint, so the shoulder gets two: one closing the top of the
      // arm, one closing the end of the torso's stub.
      const top = elbow.clone().sub(shoulder).setLength(0.09);
      upper.flesh.geometry = withBall(upper.flesh.geometry, 0.058, top);
      const stub = ball(0.064); stub.position.copy(shoulder).add(top); this.root.add(stub);
      // the ends of the bones that show in a stump: at the elbow, and at the shoulder
      upper.nub = nub(0.019); upper.nub.position.copy(elbow).sub(shoulder).multiplyScalar(1.02); upper.g.add(upper.nub);
      const socket = nub(0.024); socket.position.copy(shoulder).addScaledVector(top, 0.98); this.root.add(socket);
      // the raw end of a torn-off shoulder, for your own view of yourself (see setBody)
      const wound = new THREE.Mesh(ballGeo, fleshMat);
      wound.scale.setScalar(0.066); wound.position.copy(stub.position); wound.frustumCulled = false; wound.visible = false;
      this.root.add(wound);
      fore.flesh.geometry = withBall(fore.flesh.geometry, 0.047);
      hand.flesh.geometry = withBall(hand.flesh.geometry, 0.036);
      return {
        side: i === 0 ? 1 : -1,   // the character's left is +X in avatar space
        upper, fore, hand, shoulder, stub, wound, socket,
        upperLen: shoulder.distanceTo(elbow), foreLen: elbow.distanceTo(wrist),
        upperDir: elbow.clone().sub(shoulder).normalize(),
        foreDir: wrist.clone().sub(elbow).normalize(),
        handFit: fitHand(tip.clone().sub(wrist).normalize(), v(hd.palm), i === 0 ? 1 : -1),
      };
    });
    // Each body gets its own copy of the skin (a few hundred triangles), so it can be stained.
    mesh.Head.geometry = plain(mesh.Head.geometry);
    const A = this.arms;
    this.parts = {
      head: [mesh.Head], torso: [this.torso],
      upperL: [A[0].upper.flesh], foreL: [A[0].fore.flesh, A[0].hand.flesh], upperR: [A[1].upper.flesh], foreR: [A[1].fore.flesh, A[1].hand.flesh],
    };
    for (const list of Object.values(this.parts)) for (const m of list) {
      if (m !== mesh.Head) m.geometry = m.geometry.clone();
      m.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count * 3).fill(1), 3));
    }
    this._stained = false;
    this._gen = 0;
    this._q = new THREE.Quaternion();
    this._v = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
    this._first = false;
    this._look = '';
    this.label = null;
    if (name) this.setName(name);
    this.setBody(null);
  }

  set firstPerson(on) { this._first = on; this.head.visible = !on; this.setBody(this._view); }

  setColor(hex) { this.skin.color.setHex(hex); if (this.plainSkin) this.plainSkin.color.setHex(hex); }

  /**
   * Blood on the skin. part: 'head', 'torso', 'upperL', 'foreL', 'upperR' or 'foreR'; point: where
   * (world space); radius in metres; amount 0..1. It stays until the body is whole again.
   */
  stain(part, point, radius = 0.12, amount = 0.7) {
    const skin = this.skin.color, to = [Math.min(1, BLOOD.r / skin.r), Math.min(1, BLOOD.g / skin.g), Math.min(1, BLOOD.b / skin.b)];
    for (const m of this.parts[part] || []) {
      m.updateWorldMatrix(true, false);
      const at = m.worldToLocal(this._v[5].copy(point)), r = radius / (m.getWorldScale(this._v[4]).x || 1);
      const p = m.geometry.attributes.position, c = m.geometry.attributes.color;
      const paint = (i, k) => c.setXYZ(i, c.getX(i) + (to[0] - c.getX(i)) * k, c.getY(i) + (to[1] - c.getY(i)) * k, c.getZ(i) + (to[2] - c.getZ(i)) * k);
      let nearest = -1, best = r * 2.5;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - at.x, p.getY(i) - at.y, p.getZ(i) - at.z);
        if (d < best) { best = d; nearest = i; }
        if (d <= r) paint(i, amount * (1 - 0.55 * d / r));
      }
      // the body has few, big triangles: whatever else, the one that was hit gets it
      if (nearest >= 0) { const t = nearest - nearest % 3; for (let k = 0; k < 3; k++) paint(t + k, amount * 0.85); c.needsUpdate = true; this._stained = true; }
    }
  }
  /** Wash it all off. */
  clean() {
    if (!this._stained) return;
    this._stained = false;
    for (const list of Object.values(this.parts)) for (const m of list) { m.geometry.attributes.color.array.fill(1); m.geometry.attributes.color.needsUpdate = true; }
  }

  /** Caught players fade to see-through ghosts. */
  setGhost(on) {
    if (this._ghost === on) return;
    this._ghost = on;
    for (const m of [this.skin, this.plainSkin]) {
      if (!m) continue;
      m.transparent = on;
      m.opacity = on ? 0.28 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  /** Floating name tag above the head. */
  setName(name) {
    if (this.label) { this.root.remove(this.label); this.label.material.map.dispose(); this.label.material.dispose(); }
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const g = cv.getContext('2d');
    g.font = 'bold 56px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(10,20,14,.85)'; g.strokeText(name, 256, 50);
    g.fillStyle = '#f4eed6'; g.fillText(name, 256, 50);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.label.scale.set(0.7, 0.13, 1);
    this.label.position.set(0, 0.24, 0);
    this.root.add(this.label);
  }

  dispose() {
    this.scene.remove(this.root);
    for (const a of this.arms) this.scene.remove(a.upper.g, a.fore.g, a.hand.g);
    for (const list of Object.values(this.parts)) for (const m of list) m.geometry.dispose();
    this.skin.dispose();
    if (this.plainSkin) this.plainSkin.dispose();
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); }
  }

  /**
   * Show what has happened to the body.
   * @param view  { cut: [left, right], dead, stripped } from Body.view, or null for an unharmed body
   */
  setBody(view) {
    const cut = view ? view.cut : [0, 0], dead = !!(view && view.dead), strip = view ? view.stripped : 0;
    // made whole again since last time: the blood is gone too
    if (view && view.gen !== this._gen) { this._gen = view.gen; this.clean(); }
    const worn = view && view.armour ? view.armour : [0, 0];
    const key = `${cut[0]}${cut[1]}${dead ? 1 : 0}${strip}${this._first ? 1 : 0}${worn[0] > 0 ? 1 : 0}${worn[1] > 0 ? 1 : 0}`;
    this._view = view;
    if (key === this._look) return;
    this._look = key;
    this.root.visible = !dead;
    // armour is only made for those who wear it
    SLOTS.forEach((id, slot) => {
      const on = worn[slot] > 0 && !dead;
      if (on && !this.armour[slot]) (slot ? this.root : this.head).add(this.armour[slot] = wornArmour(id));
      if (this.armour[slot]) this.armour[slot].visible = on;
    });
    // A torn shoulder shows what is inside. The torso's inside is one piece that also closes the
    // neck, which would fill your view when you look down at yourself: your own body gets a
    // raw lump at the shoulder instead.
    this.torsoCap.visible = !this._first && (cut[0] === 2 || cut[1] === 2);
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i], c = cut[i];
      a.upper.g.visible = !dead && c < 2;
      a.fore.g.visible = a.hand.g.visible = !dead && c < 1;
      a.stub.visible = c < 2;
      a.wound.visible = this._first && c === 2;
      // flesh torn off a segment: show the bone inside it instead
      const foreBare = !!(strip & (i ? 4 : 1)), upperBare = !!(strip & (i ? 8 : 2));
      a.fore.flesh.visible = !foreBare; a.fore.bone.visible = foreBare;
      a.upper.flesh.visible = !upperBare; a.upper.bone.visible = upperBare;
      a.hand.flesh.visible = !foreBare; a.hand.bone.visible = foreBare;
      a.upper.cap.visible = c === 1 && !upperBare;              // the stump below a lost forearm...
      a.upper.nub.visible = c === 1;                            // ...with the end of the bone in it
      a.socket.visible = c === 2;
    }
  }

  /** Eyes that glow in the dark (the things in the Deep have them): they show through fog and shadow. */
  setEyes(hex) {
    this.eyes.material = new THREE.MeshBasicMaterial({ color: hex, fog: false });
    this.eyes.scale.setScalar(1.5);
  }

  /**
   * @param headPos   world position of the eyes
   * @param headQuat  world rotation of the headset/camera
   * @param hands     [{pos, quat}] world grip position and rotation, left then right
   */
  update(headPos, headQuat, hands, scale = 1) {
    const [fwd, shoulder, wrist, d, elbow, pole] = this._v;
    this.root.scale.setScalar(scale);
    // body faces where you look, but only turns around Y
    fwd.set(0, 0, -1).applyQuaternion(headQuat);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.root.position.copy(headPos);
    this.root.rotation.set(0, yaw + Math.PI, 0);
    this.root.updateMatrixWorld();
    // head turns freely; the model faces +Z, the camera looks down -Z
    this.head.quaternion.copy(this.root.quaternion).invert().multiply(headQuat).multiply(Y_FLIP);

    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i], hnd = hands[i];
      if (!arm.upper.g.visible) continue;
      shoulder.copy(arm.shoulder).applyMatrix4(this.root.matrixWorld);
      // hand orientation from the controller, wrist set back from the palm
      arm.hand.g.quaternion.copy(hnd.quat).multiply(arm.handFit);
      const fingers = d.copy(FINGERS).applyQuaternion(hnd.quat);
      wrist.copy(hnd.pos).addScaledVector(fingers, -RIG.palmOffset * scale);

      d.subVectors(wrist, shoulder);
      const dist = d.length() || 1e-6;
      // arms stretch a little rather than leave the hand floating free
      const k = Math.min(Math.max(dist / ((arm.upperLen + arm.foreLen) * scale * 0.999), 1), RIG.maxStretch);
      const a = arm.upperLen * scale * k, b = arm.foreLen * scale * k;
      const len = Math.min(Math.max(dist, Math.abs(a - b) + 1e-4), a + b - 1e-5);
      d.divideScalar(dist);
      // elbows bend outward, down and back
      pole.set(arm.side * 0.8, -0.5, -0.6).applyQuaternion(this.root.quaternion);
      pole.addScaledVector(d, -pole.dot(d)).normalize();
      const x = (a * a - b * b + len * len) / (2 * len);
      const h = Math.sqrt(Math.max(a * a - x * x, 0));
      elbow.copy(shoulder).addScaledVector(d, x).addScaledVector(pole, h);
      const reachedWrist = d.multiplyScalar(len).add(shoulder); // wrist clamped to arm length

      aim(arm.upper.g, shoulder, elbow, arm.upperDir, this.root.quaternion, this._q);
      arm.upper.g.scale.setScalar(scale * k);
      aim(arm.fore.g, elbow, reachedWrist, arm.foreDir, this.root.quaternion, this._q);
      arm.fore.g.scale.setScalar(scale * k);
      arm.hand.g.position.copy(reachedWrist);
      arm.hand.g.scale.setScalar(scale);
    }
  }
}

// Place a part at `from`, rotated so its rest direction points at `to`.
const _dir = new THREE.Vector3(), _rest = new THREE.Vector3();
function aim(group, from, to, restDir, rootQuat, q) {
  group.position.copy(from);
  _rest.copy(restDir).applyQuaternion(rootQuat);
  _dir.subVectors(to, from).normalize();
  q.setFromUnitVectors(_rest, _dir);
  group.quaternion.copy(rootQuat).premultiply(q);
}

// Rotation that takes the hand model (knuckles along `finger`, palm along `palm`) into grip space.
function fitHand(finger, palm, side) {
  const F = finger.clone().normalize();
  const P = palm.clone().addScaledVector(F, -palm.dot(F)).normalize();
  const S = new THREE.Vector3().crossVectors(F, P);
  const restBasis = new THREE.Matrix4().makeBasis(F, P, S);
  // in grip space: the left palm faces +X, the right palm faces -X; knuckles along -Y
  const F2 = FINGERS.clone(), P2 = new THREE.Vector3(side, 0, 0);
  const S2 = new THREE.Vector3().crossVectors(F2, P2);
  const gripBasis = new THREE.Matrix4().makeBasis(F2, P2, S2);
  return new THREE.Quaternion().setFromRotationMatrix(gripBasis.multiply(restBasis.transpose()));
}

/** Where the knuckles are, for poking things: a point out in front of the fist. */
export function fingertip(handPos, handQuat, scale, out) {
  return out.copy(FINGERS).applyQuaternion(handQuat).multiplyScalar(0.1 * scale).add(handPos);
}

/**
 * How a fist holding a weapon sits, relative to the camera, for mouse players and bots:
 * thumb up, knuckles forward (so the blade stands up, leaning a little away from you).
 */
export const ARMED_GRIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/**
 * A made-up grip rotation for mouse players, relative to the camera: fists forward and a
 * little down, palms facing the ground. `side` is +1 for the left hand, -1 for the right.
 */
export function restGrip(side) {
  const t = 0.35;
  const fingers = new THREE.Vector3(0, -Math.sin(t), -Math.cos(t));
  const palm = new THREE.Vector3(side * 0.25, -Math.cos(t), Math.sin(t));
  palm.addScaledVector(fingers, -palm.dot(fingers)).normalize();
  const x = palm.clone().multiplyScalar(side);      // grip +X: left palm / back of right hand
  const y = fingers.clone().negate();               // grip -Y is along the fingers
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
