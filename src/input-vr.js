// Headset and controllers. Positions come out in rig space (the play space),
// which is what the locomotion code wants.
import * as THREE from 'three';

const HANDS = ['left', 'right'];

export class VRInput {
  constructor(renderer, rig) {
    this.renderer = renderer;
    this.headLocal = new THREE.Vector3(0, 1.5, 0);
    this.headQuat = new THREE.Quaternion();
    this.hands = HANDS.map(() => ({ local: new THREE.Vector3(), quat: new THREE.Quaternion(), tracked: false, source: null, grip: null }));
    this.grips = [0, 1].map(i => {
      const grip = renderer.xr.getControllerGrip(i);
      grip.addEventListener('connected', e => { grip.userData.source = e.data; });
      grip.addEventListener('disconnected', () => { grip.userData.source = null; });
      rig.add(grip);
      return grip;
    });
    this.pressed = { calibrate: false, respawn: false, turn: 0 };
    this._prev = { left: [], right: [] };
    this._turnReady = true;
  }

  get active() { return this.hands.map(h => h.tracked); }

  /** Read this frame's poses. Returns false if there is no viewer pose. */
  update(frame) {
    const refSpace = this.renderer.xr.getReferenceSpace();
    const pose = frame && refSpace ? frame.getViewerPose(refSpace) : null;
    if (!pose) return false;
    const p = pose.transform.position, o = pose.transform.orientation;
    this.headLocal.set(p.x, p.y, p.z);
    this.headQuat.set(o.x, o.y, o.z, o.w);

    for (const h of this.hands) { h.tracked = false; h.source = null; h.grip = null; }
    for (const grip of this.grips) {
      const src = grip.userData.source;
      const i = src ? HANDS.indexOf(src.handedness) : -1;
      if (i < 0) continue;
      const h = this.hands[i];
      h.source = src; h.grip = grip;
      h.tracked = grip.visible;
      h.local.copy(grip.position);
      h.quat.copy(grip.quaternion);
    }

    // buttons: A/X = calibrate, B/Y = respawn, right stick = snap turn
    this.pressed.calibrate = this.pressed.respawn = false;
    this.pressed.turn = 0;
    for (const h of this.hands) {
      const gp = h.source && h.source.gamepad;
      if (!gp) continue;
      const hand = h.source.handedness, prev = this._prev[hand];
      const down = j => !!(gp.buttons[j] && gp.buttons[j].pressed);
      if (down(4) && !prev[4]) this.pressed.calibrate = true;
      if (down(5) && !prev[5]) this.pressed.respawn = true;
      prev[4] = down(4); prev[5] = down(5);
      if (hand === 'right') {
        const x = gp.axes[2] || 0;
        if (this._turnReady && Math.abs(x) > 0.7) { this.pressed.turn = Math.sign(x); this._turnReady = false; }
        if (Math.abs(x) < 0.3) this._turnReady = true;
      }
    }
    return true;
  }

  /** Buzz a controller. strength 0..1 */
  pulse(i, strength, ms) {
    const src = this.hands[i].source;
    const act = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (act && act.pulse) { try { act.pulse(strength, ms); } catch (e) { /* not supported */ } }
  }
}
