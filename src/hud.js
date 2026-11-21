// Words in front of your eyes: a big message that fades (round start, caught...), a
// small status line (role and timer), a blood bar when you are hurt, a red flash when
// you are hit, blood spattered across your view when it happens close up, and the
// blackout for a waiting giant.
import * as THREE from 'three';

export class Hud {
  constructor(scene) {
    this.cv = document.createElement('canvas');
    this.cv.width = 1024; this.cv.height = 512;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.sprite.renderOrder = 60;
    scene.add(this.sprite);
    // blackout: a dark ball around the head, drawn over the whole world
    this.dark = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x05080a, side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true, fog: false }));
    this.dark.renderOrder = 50;
    this.dark.visible = false;
    scene.add(this.dark);
    // a red flash around the head when you get hurt
    this.red = new THREE.Mesh(this.dark.geometry, new THREE.MeshBasicMaterial({ color: 0xb00000, side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0, fog: false }));
    this.red.renderOrder = 49;
    this.red.visible = false;
    scene.add(this.red);
    // blood on your face: blotches round the edge of your view, which fade
    this.goreCv = document.createElement('canvas');
    this.goreCv.width = this.goreCv.height = 512;
    this.goreTex = new THREE.CanvasTexture(this.goreCv);
    this.goreTex.colorSpace = THREE.SRGBColorSpace;
    this.gore = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.goreTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    this.gore.renderOrder = 48;
    this.gore.visible = false;
    scene.add(this.gore);
    this.goreT = 0;           // seconds of it left
    this.pain = 0;
    this.blood = null;        // null hides the bar; otherwise { value, max, bleeding }
    this.title = ''; this.sub = ''; this.until = 0; this.color = '#f4eed6';
    this.status = '';
    this.blind = false;
    this._key = '';
    this._pos = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._first = true;
  }

  /** Show a big message for a few seconds. */
  flash(title, sub = '', seconds = 3.5, color = '#f4eed6') {
    this.title = title; this.sub = sub; this.color = color;
    this.until = performance.now() + seconds * 1000;
  }

  /** Flash red: amount 0..1. */
  hurt(amount) { this.pain = Math.min(1, Math.max(this.pain, amount)); }

  /** Blood hits your face: `n` more blotches round the edge of your view. They fade after a few seconds. */
  splatter(n = 3) {
    const g = this.goreCv.getContext('2d');
    if (this.goreT <= 0) g.clearRect(0, 0, 512, 512);
    for (let i = 0; i < n; i++) {
      // towards the edges, so the middle of your view stays clear
      const a = Math.random() * Math.PI * 2, d = 150 + Math.random() * 95, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d * 0.9, r = 12 + Math.random() * 30;
      g.fillStyle = `rgba(${110 + Math.floor(Math.random() * 40)},6,6,${0.75 + Math.random() * 0.2})`;
      g.beginPath();
      for (let k = 0; k < 9; k++) { const t = k / 9 * Math.PI * 2, rr = r * (0.7 + Math.random() * 0.5); g[k ? 'lineTo' : 'moveTo'](x + Math.cos(t) * rr, y + Math.sin(t) * rr); }
      g.closePath(); g.fill();
      // it runs
      const len = r * (1 + Math.random() * 3.5), w = Math.max(3, r * 0.22);
      g.fillRect(x - w / 2 + (Math.random() - 0.5) * r * 0.6, y, w, len);
      g.beginPath(); g.arc(x, y + len, w * 0.8, 0, 7); g.fill();
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + (Math.random() - 0.5) * r * 4, y + (Math.random() - 0.5) * r * 4, 2 + Math.random() * 5, 0, 7); g.fill(); }
    }
    this.goreTex.needsUpdate = true;
    this.goreT = Math.min(this.goreT + 4 + n * 0.6, 12);
  }

  update(dt, headPos, headQuat, scale) {
    const now = performance.now();
    const showing = now < this.until;
    const fade = showing ? Math.min(1, (this.until - now) / 400) : 0;
    const b = this.blood;
    const key = [showing ? this.title + '|' + this.sub + '|' + this.color : '', this.status, b ? `${Math.round(b.value)}/${b.max}/${b.bleeding ? Math.floor(now / 350) % 2 : 0}` : ''].join('~');
    if (key !== this._key) { this._key = key; this._draw(showing); }
    this.sprite.visible = showing || !!this.status || !!b;
    this.sprite.material.opacity = showing ? Math.max(fade, this.status || b ? 1 : 0) : 1;

    this.pain = Math.max(0, this.pain - dt * 1.8);
    this.red.visible = this.pain > 0.01;
    if (this.red.visible) { this.red.position.copy(headPos); this.red.scale.setScalar(0.85 * scale); this.red.material.opacity = this.pain * 0.55; }

    // float a little way in front of the face, following it lazily so it is comfortable to read
    this._want.set(0, -0.02, -1.15).multiplyScalar(scale).applyQuaternion(headQuat).add(headPos);
    if (this._first || this._pos.distanceTo(this._want) > 3 * scale) { this._pos.copy(this._want); this._first = false; }
    else this._pos.lerp(this._want, 1 - Math.exp(-7 * dt));
    this.sprite.position.copy(this._pos);
    this.sprite.scale.set(1.3 * scale, 0.65 * scale, 1);

    // blood on your face stays right in front of your eyes
    this.goreT = Math.max(0, this.goreT - dt);
    this.gore.visible = this.goreT > 0;
    if (this.gore.visible) {
      this.gore.position.set(0, 0, -0.5).multiplyScalar(scale).applyQuaternion(headQuat).add(headPos);
      this.gore.scale.set(1.15 * scale, 0.95 * scale, 1);
      this.gore.material.opacity = Math.min(1, this.goreT / 3) * 0.85;
    }

    this.dark.visible = this.blind;
    if (this.blind) { this.dark.position.copy(headPos); this.dark.scale.setScalar(0.9 * scale); }
  }

  _draw(showing) {
    const g = this.cv.getContext('2d');
    g.clearRect(0, 0, 1024, 512);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = (t, y, size, color) => {
      g.font = `900 ${size}px system-ui, sans-serif`;
      g.lineWidth = size * 0.16; g.strokeStyle = 'rgba(8,16,11,.9)'; g.lineJoin = 'round';
      g.strokeText(t, 512, y); g.fillStyle = color; g.fillText(t, 512, y);
    };
    if (this.status) text(this.status, 70, 64, '#e7efd6');
    const b = this.blood;
    if (b) {
      // blood bar along the bottom; it blinks while you are bleeding
      const x = 262, y = 440, w = 500, h = 38;
      g.fillStyle = 'rgba(8,16,11,.85)'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
      g.fillStyle = '#3a0a0a'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w * b.max / 100, h);
      g.fillStyle = b.bleeding && Math.floor(performance.now() / 350) % 2 ? '#ff5a4a' : '#c81e1e'; g.fillRect(x, y, w * Math.max(b.value, 0) / 100, h);
      text(b.bleeding ? 'BLEEDING' : 'BLOOD', y + h / 2 + 2, 28, '#f4eed6');      // written on the bar, clear of any message above it
    }
    if (showing) {
      text(this.title, 260, this.title.length > 16 ? 84 : 118, this.color);
      if (this.sub) text(this.sub, 380, this.sub.length > 40 ? 40 : 50, '#f4eed6');
    }
    this.tex.needsUpdate = true;
  }
}
