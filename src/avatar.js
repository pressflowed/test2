// The skeleton body. The head follows the headset, hands follow the hands, and the
// elbows are solved with simple two-bone IK between shoulder and wrist.
// Uses assets/skeleton-rig.glb made by tools/split_skeleton.py.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// How the open skeleton hand sits on a controller, in WebXR "grip space":
//   -Z runs through the fist from little finger to thumb,
//   +X is the way the left palm faces (and the back of the right hand),
//   -Y is where straightened fingers point (along the forearm, away from you).
// So the virtual palm faces wherever your real palm faces.
// fingerTilt curls the fingers toward the palm a little (radians).
export const HAND_FIT = { fingerTilt: 0.25, palmOffset: 0.08 };
const FINGERS = new THREE.Vector3(0, -1, 0);

export const BONE = 0xdcd1a8;

export class Avatar {
  /** Load the model once; every Avatar is made from a copy of it. */
  static async loadTemplate(url) {
    return (await new GLTFLoader().loadAsync(url)).scene;
  }

  constructor(template, scene, { color = BONE, name = null } = {}) {
    const rigScene = template.clone(true);
    this.scene = scene;
    const parts = {};
    rigScene.traverse(o => { if (o.isMesh) parts[o.name] = o; });
    const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    for (const p of Object.values(parts)) { p.material = mat; p.frustumCulled = false; }
    this.material = mat;

    // root follows the head position and turns with the view (yaw only)
    this.root = new THREE.Group();
    scene.add(this.root);
    this.head = parts.Head;
    this.torso = parts.Torso;
    this.root.add(this.head, this.torso);

    this.arms = ['L', 'R'].map((s, i) => {
      const upper = parts[`UpperArm_${s}`], fore = parts[`Forearm_${s}`], hand = parts[`Hand_${s}`];
      for (const m of [upper, fore, hand]) { scene.add(m); m.matrixAutoUpdate = true; }
      const v = a => new THREE.Vector3().fromArray(a);
      const shoulder = v(upper.userData.from), elbow = v(upper.userData.to), wrist = v(fore.userData.to);
      const tip = v(hand.userData.to), palm = v(hand.userData.palm);
      return {
        side: i === 0 ? 1 : -1,   // character's left is +X in avatar space
        upper, fore, hand,
        shoulder,
        upperLen: shoulder.distanceTo(elbow),
        foreLen: elbow.distanceTo(wrist),
        upperDir: elbow.clone().sub(shoulder).normalize(),
        foreDir: wrist.clone().sub(elbow).normalize(),
        handFit: fitHand(tip.clone().sub(v(hand.userData.from)).normalize(), palm, i === 0 ? 1 : -1),
      };
    });
    this._q = new THREE.Quaternion();
    this._v = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
    this.label = null;
    if (name) this.setName(name);
  }

  set firstPerson(on) { this.head.visible = !on; }

  setColor(hex) { this.material.color.setHex(hex); }

  /** Caught players fade to see-through ghosts. */
  setGhost(on) {
    if (this._ghost === on) return;
    this._ghost = on;
    this.material.transparent = on;
    this.material.opacity = on ? 0.28 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
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
    this.label.scale.set(0.8, 0.15, 1);
    this.label.position.set(0, 0.32, 0);
    this.root.add(this.label);
  }

  dispose() {
    this.scene.remove(this.root);
    for (const a of this.arms) this.scene.remove(a.upper, a.fore, a.hand);
    this.material.dispose();
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); }
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
      // hand orientation from the controller, wrist set back from the palm
      arm.hand.quaternion.copy(hnd.quat).multiply(arm.handFit);
      const fingers = d.copy(FINGERS).applyQuaternion(hnd.quat);
      wrist.copy(hnd.pos).addScaledVector(fingers, -HAND_FIT.palmOffset * scale);
      arm.hand.position.copy(wrist);
      arm.hand.scale.setScalar(scale); arm.upper.scale.setScalar(scale); arm.fore.scale.setScalar(scale);

      shoulder.copy(arm.shoulder).applyMatrix4(this.root.matrixWorld);
      const a = arm.upperLen * scale, b = arm.foreLen * scale;
      d.subVectors(wrist, shoulder);
      let len = d.length();
      len = Math.min(Math.max(len, Math.abs(a - b) + 1e-3), a + b - 1e-4);
      d.normalize();
      // elbows bend outward, down and back
      pole.set(arm.side * 0.8, -0.5, -0.6).applyQuaternion(this.root.quaternion);
      pole.addScaledVector(d, -pole.dot(d)).normalize();
      const x = (a * a - b * b + len * len) / (2 * len);
      const h = Math.sqrt(Math.max(a * a - x * x, 0));
      elbow.copy(shoulder).addScaledVector(d, x).addScaledVector(pole, h);
      const reachedWrist = d.multiplyScalar(len).add(shoulder); // wrist clamped to arm length

      aim(arm.upper, shoulder, elbow, arm.upperDir, this.root.quaternion, this._q);
      aim(arm.fore, elbow, reachedWrist, arm.foreDir, this.root.quaternion, this._q);
    }
  }
}

// Place a bone at `from`, rotated so its rest direction points at `to`.
const _dir = new THREE.Vector3(), _rest = new THREE.Vector3();
function aim(mesh, from, to, restDir, rootQuat, q) {
  mesh.position.copy(from);
  _rest.copy(restDir).applyQuaternion(rootQuat);
  _dir.subVectors(to, from).normalize();
  q.setFromUnitVectors(_rest, _dir);
  mesh.quaternion.copy(rootQuat).premultiply(q);
}

// Rotation that takes the hand model (fingers along `finger`, palm along `palm`) into grip space.
function fitHand(finger, palm, side) {
  const F = finger.clone().normalize();
  const P = palm.clone().addScaledVector(F, -palm.dot(F)).normalize();
  const S = new THREE.Vector3().crossVectors(F, P);
  const restBasis = new THREE.Matrix4().makeBasis(F, P, S);
  // in grip space: the left palm faces +X, the right palm faces -X; fingers along -Y
  const P0 = new THREE.Vector3(side, 0, 0);
  const t = HAND_FIT.fingerTilt;
  const F2 = FINGERS.clone().multiplyScalar(Math.cos(t)).addScaledVector(P0, Math.sin(t));
  const P2 = P0.clone().multiplyScalar(Math.cos(t)).addScaledVector(FINGERS, -Math.sin(t));
  const S2 = new THREE.Vector3().crossVectors(F2, P2);
  const gripBasis = new THREE.Matrix4().makeBasis(F2, P2, S2);
  const m = gripBasis.multiply(restBasis.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Where the fingertips are, for poking things: a point out along the fingers from the grip. */
export function fingertip(handPos, handQuat, scale, out) {
  return out.copy(FINGERS).applyQuaternion(handQuat).multiplyScalar(0.16 * scale).add(handPos);
}

/**
 * A made-up grip rotation for mouse players, relative to the camera: fingers forward and a
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
