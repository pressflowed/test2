// A little floating display above the left hand: selected item, room and players.
import * as THREE from 'three';

export class WristPanel {
  constructor(scene) {
    this.cv = document.createElement('canvas');
    this.cv.width = 512; this.cv.height = 224;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.sprite.scale.set(0.22, 0.096, 1);
    this.sprite.renderOrder = 10;
    scene.add(this.sprite);
    this.dirty = true;
    this._key = '';
  }

  update(handPos, headPos, info) {
    // sit just above the left hand, nudged toward the face
    this.sprite.position.copy(handPos).lerp(headPos, 0.15);
    this.sprite.position.y += 0.13;
    const key = JSON.stringify(info);
    if (!this.dirty && key === this._key) return;
    this._key = key; this.dirty = false;
    const g = this.cv.getContext('2d');
    g.clearRect(0, 0, 512, 224);
    g.fillStyle = 'rgba(19,36,27,0.88)';
    roundRect(g, 4, 4, 504, 216, 28); g.fill();
    g.fillStyle = '#b9c4a8'; g.font = 'bold 30px sans-serif';
    g.fillText('SPAWN  (A next · trigger)', 28, 52);
    g.fillStyle = '#9be15d'; g.font = 'bold 64px sans-serif';
    g.fillText(info.item, 28, 122);
    g.fillStyle = '#f4eed6'; g.font = 'bold 32px sans-serif';
    const who = info.players > 1 ? `${info.players} players` : '1 player';
    g.fillText(`${info.room} · ${who}${info.lowGravity ? ' · low gravity' : ''}`, 28, 186);
    this.tex.needsUpdate = true;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
