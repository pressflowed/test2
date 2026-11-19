// Mouse and keyboard stand-in for a headset, for testing without VR.
// Mouse looks around. Hold left/right click to take control of that hand and move the
// mouse to swing it; hold Space for both hands. Q/E or arrow keys turn.
import * as THREE from 'three';
import { restGrip } from './avatar.js';

const ARM = 0.95, DEPTH = 0.85, HAND_SENS = 0.0027, LOOK_SENS = 0.0022;

export class DesktopInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;
    this.yaw = 0; this.pitch = -0.35;
    this.headLocal = new THREE.Vector3(0, 1.5, 0);
    this.headQuat = new THREE.Quaternion();
    this.hands = [-1, 1].map(side => ({
      grip: restGrip(-side),
      rest: new THREE.Vector2(0.27 * side, -0.25), off: new THREE.Vector2(0.27 * side, -0.25), held: 0, spent: false,
      local: new THREE.Vector3(), quat: new THREE.Quaternion(),
    }));
    this.keys = {};
    this.pressed = new Set();   // keys pressed since the last frame
    this.wheel = 0;
    this.dx = 0; this.dy = 0;
    this.onRespawn = () => {};
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');

    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 250 || Math.abs(my) > 250) return; // browsers sometimes send one huge jump around pointer lock
      this.dx += mx; this.dy += my;
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) this.lock();
      if (e.button === 0) this.grab(0, 1);
      if (e.button === 2) this.grab(1, 1);
      e.preventDefault();
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.hands[0].held &= ~1;
      if (e.button === 2) this.hands[1].held &= ~1;
    });
    addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    addEventListener('wheel', e => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (!this.enabled) return;
      if (!e.repeat) this.pressed.add(e.code);
      if (e.code === 'Space') { if (!e.repeat) { this.grab(0, 2); this.grab(1, 2); } e.preventDefault(); }
      if (e.code === 'KeyR' && !e.repeat) this.onRespawn();
    });
    addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Space') for (const h of this.hands) h.held &= ~2;
    });
    addEventListener('blur', () => { for (const h of this.hands) h.held = 0; this.keys = {}; });
  }

  /** Keys pressed since the last call, and mouse wheel steps. */
  takeInput() {
    const out = { pressed: this.pressed, wheel: this.wheel };
    this.pressed = new Set();
    this.wheel = 0;
    return out;
  }

  lock() {
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ }
  }

  grab(i, bit) {
    const h = this.hands[i];
    if (!h.held) h.spent = false;
    h.held |= bit;
  }

  // A held hand that runs out of reach lets go by itself, so the stroke ends in a launch
  // instead of the body stopping while you still hold the button.
  get active() { return this.hands.map(h => h.held !== 0 && !h.spent); }

  update(dt) {
    const held = this.hands.some(h => h.held);
    if (held) {
      for (const h of this.hands) if (h.held) {
        h.off.x += this.dx * HAND_SENS; h.off.y -= this.dy * HAND_SENS;
        const r = h.off.length(), max = ARM * 0.97;
        if (r > max) { h.off.multiplyScalar(max / r); h.spent = true; }
      }
    } else {
      this.yaw -= this.dx * LOOK_SENS;
      this.pitch -= this.dy * LOOK_SENS;
    }
    this.dx = this.dy = 0;
    const k = this.keys;
    this.yaw += ((k.KeyQ || k.ArrowLeft ? 1 : 0) - (k.KeyE || k.ArrowRight ? 1 : 0)) * 2.4 * dt;
    this.pitch += ((k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0)) * 1.6 * dt;
    this.pitch = Math.max(-1.5, Math.min(1.45, this.pitch));
    this.headQuat.setFromEuler(this._e.set(this.pitch, this.yaw, 0));

    const relax = 1 - Math.exp(-14 * dt);
    for (const h of this.hands) {
      if (!h.held || h.spent) h.off.lerp(h.rest, relax);
      const r = h.off.length();
      const z = Math.sqrt(Math.max(ARM * ARM - r * r, 0)) * DEPTH;
      h.local.set(h.off.x, h.off.y, -z).applyQuaternion(this.headQuat).add(this.headLocal);
      h.quat.copy(this.headQuat).multiply(h.grip);
    }
  }
}
