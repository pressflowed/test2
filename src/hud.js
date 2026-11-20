// Words in front of your eyes: a big message that fades (round start, caught...), a
// small status line (role and timer), and the blackout the giant gets while hiders hide.
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

  update(dt, headPos, headQuat, scale) {
    const now = performance.now();
    const showing = now < this.until;
    const fade = showing ? Math.min(1, (this.until - now) / 400) : 0;
    const key = [showing ? this.title + '|' + this.sub + '|' + this.color : '', this.status].join('~');
    if (key !== this._key) { this._key = key; this._draw(showing); }
    this.sprite.visible = showing || !!this.status;
    this.sprite.material.opacity = showing ? Math.max(fade, this.status ? 1 : 0) : 1;

    // float a little way in front of the face, following it lazily so it is comfortable to read
    this._want.set(0, -0.02, -1.15).multiplyScalar(scale).applyQuaternion(headQuat).add(headPos);
    if (this._first || this._pos.distanceTo(this._want) > 3 * scale) { this._pos.copy(this._want); this._first = false; }
    else this._pos.lerp(this._want, 1 - Math.exp(-7 * dt));
    this.sprite.position.copy(this._pos);
    this.sprite.scale.set(1.3 * scale, 0.65 * scale, 1);

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
    if (showing) {
      text(this.title, 260, this.title.length > 16 ? 84 : 118, this.color);
      if (this.sub) text(this.sub, 380, this.sub.length > 40 ? 40 : 50, '#f4eed6');
    }
    this.tex.needsUpdate = true;
  }
}
