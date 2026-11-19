// Headset and controllers. Positions come out in rig space (the play space),
// which is what the locomotion code wants.
import * as THREE from 'three';

const HANDS = ['left', 'right'];
// xr-standard gamepad button indices
const BTN = { trigger: 0, grip: 1, primary: 4, secondary: 5 }; // primary = A / X, secondary = B / Y

function newButtons() {
  const b = {};
  for (const k of Object.keys(BTN)) b[k] = { down: false, pressed: false, released: false };
  return b;
}

export class VRInput {
  constructor(renderer, rig) {
    this.renderer = renderer;
    this.headLocal = new THREE.Vector3(0, 1.5, 0);
    this.headQuat = new THREE.Quaternion();
    this.hands = HANDS.map(() => ({
      local: new THREE.Vector3(), quat: new THREE.Quaternion(), tracked: false, source: null,
      buttons: newButtons(), stick: { x: 0, y: 0 },
    }));
    this.grips = [0, 1].map(i => {
      const grip = renderer.xr.getControllerGrip(i);
      grip.addEventListener('connected', e => { grip.userData.source = e.data; });
      grip.addEventListener('disconnected', () => { grip.userData.source = null; });
      rig.add(grip);
      return grip;
    });
    this.turn = 0;          // -1 / 0 / 1 this frame (right stick flick)
    this._turnReady = true;
  }

  get active() { return this.hands.map(h => h.tracked); }

  /** Read this frame's poses and buttons. Returns false if there is no viewer pose. */
  update(frame) {
    const refSpace = this.renderer.xr.getReferenceSpace();
    const pose = frame && refSpace ? frame.getViewerPose(refSpace) : null;
    if (!pose) return false;
    const p = pose.transform.position, o = pose.transform.orientation;
    this.headLocal.set(p.x, p.y, p.z);
    this.headQuat.set(o.x, o.y, o.z, o.w);

    for (const h of this.hands) { h.tracked = false; h.source = null; }
    for (const grip of this.grips) {
      const src = grip.userData.source;
      const i = src ? HANDS.indexOf(src.handedness) : -1;
      if (i < 0) continue;
      const h = this.hands[i];
      h.source = src;
      h.tracked = grip.visible;
      h.local.copy(grip.position);
      h.quat.copy(grip.quaternion);
    }

    this.turn = 0;
    for (const h of this.hands) {
      const gp = h.source && h.source.gamepad;
      for (const [name, idx] of Object.entries(BTN)) {
        const b = h.buttons[name];
        const now = !!(gp && gp.buttons[idx] && gp.buttons[idx].pressed);
        b.pressed = now && !b.down;
        b.released = !now && b.down;
        b.down = now;
      }
      h.stick.x = gp ? gp.axes[2] || 0 : 0;
      h.stick.y = gp ? gp.axes[3] || 0 : 0;
    }
    const x = this.hands[1].stick.x;
    if (this._turnReady && Math.abs(x) > 0.7) { this.turn = Math.sign(x); this._turnReady = false; }
    if (Math.abs(x) < 0.3) this._turnReady = true;
    return true;
  }

  /** Buzz a controller. strength 0..1 */
  pulse(i, strength, ms) {
    const src = this.hands[i].source;
    const act = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (act && act.pulse) { try { act.pulse(strength, ms); } catch (e) { /* not supported */ } }
  }
}
