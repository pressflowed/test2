// The skeleton body. The head follows the headset, hands follow the hands, and the
// elbows are solved with simple two-bone IK between shoulder and wrist.
// Uses assets/skeleton-rig.glb made by tools/split_skeleton.py.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// How the open skeleton hand sits on a controller grip: fingers point forward (grip -Z),
// tilted down a little; palms roll from facing each other (0) toward facing down (PI/2).
// If the palms face outward on the headset, flip palmSign.
export const HAND_FIT = { fingerTilt: -0.45, palmRoll: 1.05, palmSign: 1, palmOffset: 0.08 };

export class Avatar {
  static async load(url, scene) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Avatar(gltf.scene, scene);
  }

  constructor(rigScene, scene) {
    const parts = {};
    rigScene.traverse(o => { if (o.isMesh) parts[o.name] = o; });
    const mat = new THREE.MeshLambertMaterial({ color: 0xdcd1a8, side: THREE.DoubleSide });
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
  }

  set firstPerson(on) { this.head.visible = !on; }

  setColor(hex) { this.material.color.setHex(hex); }

  /**
   * @param headPos   world position of the eyes
   * @param headQuat  world rotation of the headset/camera
   * @param hands     [{pos, quat}] world grip position and rotation, left then right
   */
  update(headPos, headQuat, hands) {
    const [fwd, shoulder, wrist, d, elbow, pole] = this._v;
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
      const fingers = d.set(0, 0, -1).applyQuaternion(hnd.quat);
      wrist.copy(hnd.pos).addScaledVector(fingers, -HAND_FIT.palmOffset);
      arm.hand.position.copy(wrist);

      shoulder.copy(arm.shoulder).applyMatrix4(this.root.matrixWorld);
      const a = arm.upperLen, b = arm.foreLen;
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
  // in grip space: fingers forward (-Z) tilted down, palm toward the other hand
  const tilt = HAND_FIT.fingerTilt;
  const F2 = new THREE.Vector3(0, Math.sin(tilt), -Math.cos(tilt));
  const roll = HAND_FIT.palmRoll;
  const P2 = new THREE.Vector3(side * HAND_FIT.palmSign * Math.cos(roll), -Math.sin(roll), 0);
  P2.addScaledVector(F2, -P2.dot(F2)).normalize();
  const S2 = new THREE.Vector3().crossVectors(F2, P2);
  const gripBasis = new THREE.Matrix4().makeBasis(F2, P2, S2);
  const m = gripBasis.multiply(restBasis.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
