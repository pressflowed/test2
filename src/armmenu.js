// The arm menu: a small panel that floats above your left hand and faces you.
// Poke its tabs and buttons with your right fingertip. The little "Menu" tab under it
// is always there: poke that to open or close the panel. The Items tab shows little
// spinning previews of everything you can spawn; grab one with your right grip, pull
// it out and throw it.
import * as THREE from 'three';
import { PROP_TYPES, propVisual, propSize } from './props.js';

const W = 0.28, H = 0.2;          // panel size in metres (for a normal-sized player)
const CW = 840, CH = 600;         // canvas pixels
const COLS = 4, ROWS = 2, PER_PAGE = COLS * ROWS;
const TABS = ['Items', 'Player', 'World', 'Game'];
const TAB_W = CW / TABS.length;
const TOUCH_NEAR = 0.035, TOUCH_FAR = -0.04, HOVER = 0.1;
const HANDLE_W = 0.1, HANDLE_H = 0.036, HANDLE_Y = -H / 2 - 0.032;   // the open/close tab under the panel
export const SIZES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
export const POWERS = [0.5, 0.75, 1, 1.5, 2, 3];

const C = { bg: '#13241b', panel: '#1d3628', ink: '#f4eed6', muted: '#b9c4a8', moss: '#9be15d', hot: '#2f5a3c', ember: '#ff8a55' };

// button rectangles in canvas pixels: [x, y, w, h]
const cell = i => [20 + (i % COLS) * 200, 100 + Math.floor(i / COLS) * 185, 200, 185];
const LAYOUT = {
  tabs: TABS.map((t, i) => ({ id: 'tab:' + i, rect: [i * TAB_W, 0, TAB_W, 88] })),
  0: [
    { id: 'page-', rect: [20, 480, 150, 110], label: '<' },
    { id: 'page+', rect: [670, 480, 150, 110], label: '>' },
  ],
  1: [
    { id: 'size-', rect: [300, 105, 140, 120], label: '-' },
    { id: 'size+', rect: [680, 105, 140, 120], label: '+' },
    { id: 'power-', rect: [300, 240, 140, 120], label: '-' },
    { id: 'power+', rect: [680, 240, 140, 120], label: '+' },
    { id: 'calibrate', rect: [20, 380, 390, 120], label: 'Calibrate height' },
    { id: 'home', rect: [430, 380, 390, 120], label: 'Back to start' },
  ],
  2: [
    { id: 'gravity', rect: [20, 105, 200, 230] },
    { id: 'sky', rect: [220, 105, 200, 230] },
    { id: 'smash', rect: [420, 105, 200, 230] },
    { id: 'resetmap', rect: [620, 105, 200, 230], label: 'Repair map' },
    { id: 'rain', rect: [20, 350, 200, 230], label: 'Prop rain' },
    { id: 'balloons', rect: [220, 350, 200, 230], label: 'Balloons' },
    { id: 'undo', rect: [420, 350, 200, 230], label: 'Undo last' },
    { id: 'clear', rect: [620, 350, 200, 230], label: 'Clear props', danger: true },
  ],
  3: [
    { id: 'mode:sandbox', rect: [20, 105, 395, 150], label: 'Sandbox' },
    { id: 'mode:hideseek', rect: [425, 105, 395, 150], label: 'Hide and seek' },
    { id: 'skip', rect: [520, 450, 300, 130], label: 'Next round' },
  ],
};

const toLocal = (px, py) => [(px / CW - 0.5) * W, (0.5 - py / CH) * H];
const inRect = (r, px, py) => px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3];

export class ArmMenu {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cv = document.createElement('canvas');
    this.cv.width = CW; this.cv.height = CH;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // the panel and everything on it; the open/close tab sits outside this so it never hides
    this.body = new THREE.Group();
    this.group.add(this.body);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, fog: false }));
    this.body.add(panel);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.012, H + 0.012), new THREE.MeshBasicMaterial({ color: 0x0b1610, fog: false }));
    back.position.z = -0.004; back.rotation.y = Math.PI;
    this.body.add(back);
    this.handleCv = document.createElement('canvas');
    this.handleCv.width = 320; this.handleCv.height = 116;
    this.handleTex = new THREE.CanvasTexture(this.handleCv);
    this.handleTex.colorSpace = THREE.SRGBColorSpace;
    this.handle = new THREE.Mesh(new THREE.PlaneGeometry(HANDLE_W, HANDLE_H), new THREE.MeshBasicMaterial({ map: this.handleTex, transparent: true, fog: false, side: THREE.DoubleSide }));
    this.handle.position.set(0, HANDLE_Y, 0);
    this.group.add(this.handle);

    // little 3D previews, one per item type
    this.minis = PROP_TYPES.map((t, i) => {
      const { geo, mat } = propVisual(t.id);
      const m = new THREE.Mesh(geo, mat);
      m.userData.base = 0.04 / propSize(t.id);
      m.scale.setScalar(m.userData.base);
      m.rotation.x = 0.35;
      this.body.add(m);
      return m;
    });

    // the dot that shows where your fingertip pokes
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9be15d, fog: false, depthTest: false }));
    this.dot.renderOrder = 20;
    scene.add(this.dot);

    this.tab = 0;
    this.page = 0;
    this.hover = null;         // id of the button / item under the fingertip
    this._touching = null;
    this._cool = 0;
    this._key = '';
    this._local = new THREE.Vector3();
    this._want = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._onHandle = false;
    this.handleHot = false;
    this.visible = true;
  }

  /** Is the panel open? The open/close tab stays on show either way. */
  get visible() { return this.body.visible; }
  set visible(v) { this.body.visible = v; if (!v) { this.dot.visible = false; this.hover = null; } this._drawHandle(); }

  _drawHandle() {
    const g = this.handleCv.getContext('2d');
    g.clearRect(0, 0, 320, 116);
    g.fillStyle = this.handleHot ? C.hot : C.bg; round(g, 3, 3, 314, 110, 40); g.fill();
    g.strokeStyle = C.moss; g.lineWidth = 5; round(g, 5, 5, 310, 106, 38); g.stroke();
    g.fillStyle = C.moss; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(this.body.visible ? 'Close menu' : 'Menu', 160, 60);
    this.handleTex.needsUpdate = true;
  }
  get pages() { return Math.ceil(PROP_TYPES.length / PER_PAGE); }

  nextTab(d = 1) { this.tab = (this.tab + d + TABS.length) % TABS.length; this._key = ''; }
  nextPage(d = 1) { this.page = (this.page + d + this.pages) % this.pages; this._key = ''; }
  showItem(typeId) {
    const i = PROP_TYPES.findIndex(t => t.id === typeId);
    if (i >= 0) { this.page = Math.floor(i / PER_PAGE); this._key = ''; }
  }

  // which control is at canvas pixel (px, py)?
  _pick(px, py) {
    for (const b of LAYOUT.tabs) if (inRect(b.rect, px, py)) return b.id;
    for (const b of LAYOUT[this.tab]) if (inRect(b.rect, px, py)) return b.id;
    if (this.tab === 0 && !this.locked) {
      for (let i = 0; i < PER_PAGE; i++) {
        const t = PROP_TYPES[this.page * PER_PAGE + i];
        if (t && inRect(cell(i), px, py)) return 'item:' + t.id;
      }
    }
    return null;
  }

  /** The item type under a world-space point (for grabbing one out), or null. */
  itemAt(point) {
    if (!this.visible || this.tab !== 0 || this.locked) return null;
    const l = this.group.worldToLocal(this._local.copy(point));
    if (l.z < TOUCH_FAR || l.z > HOVER) return null;
    const id = this._pick((l.x / W + 0.5) * CW, (0.5 - l.y / H) * CH);
    return id && id.startsWith('item:') ? id.slice(5) : null;
  }

  /**
   * @param pose     { pos, quat } where the panel should be (world)
   * @param scale    player size
   * @param pointer  world position of the poking fingertip, or null
   * @param state    { selected, size, power, gravity, sky, smash, room, players, calib, mode, locked, game: [lines] }
   * @returns ids of controls pressed this frame
   */
  update(dt, pose, scale, pointer, state) {
    const pressed = [];
    this.locked = !!state.locked;
    this.group.position.copy(pose.pos);
    this.group.quaternion.slerp(pose.quat, 1 - Math.exp(-14 * dt));
    this.group.scale.setScalar(scale);
    this.group.updateMatrixWorld();
    this._cool -= dt;

    // the open/close tab: poke it to show or hide the panel
    let l = null, onHandle = false, nearHandle = false;
    this.dot.visible = false;
    if (pointer) {
      l = this.group.worldToLocal(this._local.copy(pointer));
      nearHandle = Math.abs(l.x) < HANDLE_W / 2 + 0.015 && Math.abs(l.y - HANDLE_Y) < HANDLE_H / 2 + 0.012 && l.z > TOUCH_FAR && l.z < HOVER;
      onHandle = nearHandle && l.z < TOUCH_NEAR;
      if (nearHandle) { this.dot.visible = true; this.dot.position.copy(pointer); this.dot.scale.setScalar(scale); this.dot.material.color.setHex(onHandle ? 0xffffff : 0x9be15d); }
    }
    if (nearHandle !== this.handleHot) { this.handleHot = nearHandle; this._drawHandle(); }
    if (onHandle && !this._onHandle && this._cool <= 0) { this._cool = 0.5; this.visible = !this.visible; pressed.push('toggle'); }
    this._onHandle = onHandle;
    if (!this.visible) return pressed;

    // fingertip on the panel
    let hover = null, touching = null;
    if (pointer && !nearHandle) {
      const inside = Math.abs(l.x) < W / 2 + 0.03 && Math.abs(l.y) < H / 2 + 0.03;
      if (inside && l.z < 0.25 && l.z > -0.1) {
        this.dot.visible = true;
        this.dot.position.copy(pointer);
        this.dot.scale.setScalar(scale);
      }
      if (inside && l.z < HOVER && l.z > TOUCH_FAR) {
        hover = this._pick((l.x / W + 0.5) * CW, (0.5 - l.y / H) * CH);
        if (l.z < TOUCH_NEAR) touching = hover;
      }
      this.dot.material.color.setHex(touching ? 0xffffff : 0x9be15d);
    }
    if (touching && touching !== this._touching && this._cool <= 0) {
      this._cool = 0.28;
      if (touching.startsWith('tab:')) { this.tab = Number(touching.slice(4)); this._key = ''; }
      else if (touching === 'page-') this.nextPage(-1);
      else if (touching === 'page+') this.nextPage(1);
      pressed.push(touching);
    }
    this._touching = touching;
    this.hover = hover;

    // previews
    for (let i = 0; i < this.minis.length; i++) {
      const m = this.minis[i], t = PROP_TYPES[i];
      const slot = i - this.page * PER_PAGE;
      m.visible = this.tab === 0 && !this.locked && slot >= 0 && slot < PER_PAGE;
      if (!m.visible) continue;
      const r = cell(slot), [x, y] = toLocal(r[0] + r[2] / 2, r[1] + r[3] / 2 - 22);
      const hot = hover === 'item:' + t.id;
      m.position.set(x, y, hot ? 0.04 : 0.028);
      m.rotation.y += dt * (hot ? 2.6 : 0.9);
      m.scale.setScalar(m.userData.base * (hot ? 1.3 : 1));
    }

    const key = JSON.stringify([this.tab, this.page, hover, state]);
    if (key !== this._key) { this._key = key; this._draw(state); }
    return pressed;
  }

  _draw(s) {
    const g = this.cv.getContext('2d');
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = C.bg; round(g, 0, 0, CW, CH, 36); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';

    // tabs
    TABS.forEach((name, i) => {
      const on = i === this.tab, hot = this.hover === 'tab:' + i;
      g.fillStyle = on ? C.panel : hot ? C.hot : C.bg;
      round(g, i * TAB_W + 6, 6, TAB_W - 12, 82, 22); g.fill();
      g.fillStyle = on ? C.moss : C.muted; g.font = 'bold 40px sans-serif';
      g.fillText(name, i * TAB_W + TAB_W / 2, 50);
    });

    const button = (b, label, sub, on = false) => {
      const [x, y, w, h] = b.rect, hot = this.hover === b.id;
      g.fillStyle = hot ? (b.danger ? '#7a2a1e' : C.hot) : C.panel;
      round(g, x + 5, y + 5, w - 10, h - 10, 22); g.fill();
      if (on) { g.strokeStyle = C.moss; g.lineWidth = 7; round(g, x + 9, y + 9, w - 18, h - 18, 18); g.stroke(); }
      g.fillStyle = b.danger ? C.ember : on ? C.moss : C.ink;
      g.font = `bold ${label.length <= 1 ? 84 : label.length > 11 ? 30 : 36}px sans-serif`;
      g.fillText(label, x + w / 2, y + h / 2 - (sub ? 22 : 0) + (label.length <= 1 ? -4 : 0));
      if (sub) { g.fillStyle = C.moss; g.font = 'bold 40px sans-serif'; g.fillText(sub, x + w / 2, y + h / 2 + 30); }
    };

    const note = (lines, y0 = 300) => {
      g.fillStyle = C.muted; g.font = 'bold 38px sans-serif';
      lines.forEach((t, i) => g.fillText(t, CW / 2, y0 + i * 56));
    };
    if (this.tab === 0 && s.locked) {
      note(['Items are for sandbox mode.', 'Hide and seek is bare hands only.']);
    } else if (this.tab === 0) {
      for (let i = 0; i < PER_PAGE; i++) {
        const t = PROP_TYPES[this.page * PER_PAGE + i];
        if (!t) continue;
        const [x, y, w, h] = cell(i), hot = this.hover === 'item:' + t.id, sel = s.selected === t.id;
        g.fillStyle = hot ? C.hot : C.panel;
        round(g, x + 6, y + 6, w - 12, h - 12, 20); g.fill();
        if (sel) { g.strokeStyle = C.moss; g.lineWidth = 6; round(g, x + 9, y + 9, w - 18, h - 18, 18); g.stroke(); }
        g.fillStyle = sel ? C.moss : C.ink; g.font = 'bold 26px sans-serif';
        g.fillText(t.label, x + w / 2, y + h - 26);
      }
      for (const b of LAYOUT[0]) button(b, b.label);
      g.fillStyle = C.muted; g.font = 'bold 30px sans-serif';
      g.fillText('Grab one and throw it', CW / 2, 518);
      g.fillStyle = C.ink; g.font = 'bold 30px sans-serif';
      g.fillText(`Page ${this.page + 1} of ${this.pages}`, CW / 2, 560);
    } else if (this.tab === 1) {
      g.textAlign = 'left'; g.fillStyle = C.ink; g.font = 'bold 54px sans-serif';
      g.fillText('Size', 40, 165); g.fillText('Power', 40, 300);
      g.textAlign = 'center'; g.fillStyle = C.moss; g.font = 'bold 64px sans-serif';
      g.fillText(`${s.size}x`, 560, 165); g.fillText(`${s.power}x`, 560, 300);
      for (const b of LAYOUT[1]) button(b, b.id === 'calibrate' && s.calib ? `Arms down... ${s.calib}` : b.label);
      g.fillStyle = C.muted; g.font = 'bold 32px sans-serif';
      g.fillText(s.roleLocked ? 'Size and power are set by your role this round' : `${s.room} · ${s.players} player${s.players === 1 ? '' : 's'}`, CW / 2, 548);
    } else if (this.tab === 2) {
      for (const b of LAYOUT[2]) {
        if (b.id === 'gravity') button(b, 'Gravity', s.gravity);
        else if (b.id === 'sky') button(b, 'Sky', s.sky);
        else if (b.id === 'smash') button(b, 'Smashing', s.smash ? 'On' : 'Off');
        else button(b, b.label);
      }
    } else {
      button(LAYOUT[3][0], 'Sandbox', null, s.mode === 'sandbox');
      button(LAYOUT[3][1], 'Hide and seek', null, s.mode === 'hideseek');
      g.textAlign = 'left';
      (s.game || []).forEach((t, i) => {
        g.fillStyle = i ? C.ink : C.moss; g.font = `bold ${i ? 34 : 42}px sans-serif`;
        g.fillText(t, 40, 310 + i * 52);
      });
      g.textAlign = 'center';
      if (s.mode === 'hideseek') button(LAYOUT[3][2], 'Next round');
    }
    this.tex.needsUpdate = true;
  }
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
