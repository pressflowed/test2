// The parts of the zombies map that are not blocks: doors, the boards on the windows,
// signs and what they sell, the chest, the spikes, the things the dead leave behind, and
// torches. It only draws what the rules say (see zombies.js) and offers the boxes that
// shut doors and windows; it decides nothing.
import * as THREE from 'three';
import { PRIORY } from './maps.js';
import { ZOMBIES, TONICS, POWERUPS } from './zombies.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, weaponVisual, paint } from './weapons.js';
import { ARMOUR, armourVisual } from './armour.js';
import { blobTexture } from './textures.js';

const F = PRIORY.floor;
const HAS_DOM = typeof document !== 'undefined';

// a wooden plaque with words on it
function plaque(lines, w = 0.72, h = 0.36, bg = '#3a2616', ink = '#f1e4c3') {
  let map = null;
  if (HAS_DOM) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = Math.round(512 * h / w);
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#1c120a'; g.lineWidth = 14; g.strokeRect(7, 7, cv.width - 14, cv.height - 14);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach(([text, size, color], i) => {
      g.font = `bold ${size}px sans-serif`; g.fillStyle = color || ink;
      g.fillText(text, cv.width / 2, cv.height * (i + 0.5 + (lines.length === 1 ? 0 : (i ? 0.12 : -0.08))) / lines.length, cv.width - 40);
    });
    map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
  }
  // one flat piece, so that each sign is a single thing to draw
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial(map ? { map, side: THREE.DoubleSide } : { color: 0x2a1a0e, side: THREE.DoubleSide }));
  m.position.z = 0.02;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
const facing = (nx, nz) => Math.atan2(nx, nz);          // turn something that faces +Z to face (nx, nz)

export function makePriory(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const P = PRIORY, wood = new THREE.MeshLambertMaterial({ color: 0x4a2f1a }), iron = new THREE.MeshLambertMaterial({ color: 0x2c3035 });
  const box = (min, max, kind) => ({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), kind, noProps: true, nav: false });

  // (a door's planks and its iron bands are one mesh, coloured by vertex)
  const vcol = new THREE.MeshLambertMaterial({ vertexColors: true });
  const doorGeo = mergeGeometries([paint(new THREE.BoxGeometry(P.door.w, P.door.h, 0.2).translate(0, P.door.h / 2, 0), 0x4a2f1a), ...[0.5, 1.25, 2].map(y => paint(new THREE.BoxGeometry(P.door.w, 0.12, 0.24).translate(0, y, 0), 0x2c3035))]);

  // ---- doors: a slab of planks that sinks into the floor when it is bought, and its price
  const doors = P.doors.map((d, i) => {
    const hw = P.door.w / 2, g = new THREE.Group();
    g.add(new THREE.Mesh(doorGeo, vcol));
    // each face says where it leads: the one you see from area a names area b
    const za = P.zones[d.a], aSide = Math.sign(((za[0] + za[2]) / 2 - d.x) * d.nx + ((za[1] + za[3]) / 2 - d.z) * d.nz) || 1;
    for (const side of [-1, 1]) {
      const sign = plaque([[`${P.names[side === aSide ? d.b : d.a]}`.replace(/^the /, 'To the '), 58], [`${d.cost}`, 110, '#ffd76a']], 0.9, 0.5);
      sign.position.set(0, 1.15, side * 0.13); sign.rotation.y = side < 0 ? Math.PI : 0;
      g.add(sign);
    }
    g.position.set(d.x, F, d.z);
    g.rotation.y = d.nz ? 0 : Math.PI / 2;
    group.add(g);
    const col = d.nz ? box([d.x - hw, F, d.z - 0.25], [d.x + hw, F + P.door.h, d.z + 0.25], 'wood') : box([d.x - 0.25, F, d.z - hw], [d.x + 0.25, F + P.door.h, d.z + hw], 'wood');
    return { d, g, col, open: false };
  });

  // ---- windows: six boards each, all drawn in one go
  const BOARDS = ZOMBIES.boards, boardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(P.window.w + 0.3, 0.22, 0.07), new THREE.MeshLambertMaterial({ color: 0xffffff }), P.windows.length * BOARDS);
  boardMesh.frustumCulled = false;
  group.add(boardMesh);
  const windows = P.windows.map((w, i) => {
    const hw = P.window.w / 2;
    const col = w.nz ? box([w.x - hw, F, w.z - 0.25], [w.x + hw, F + P.window.h, w.z + 0.25], 'plank') : box([w.x - 0.25, F, w.z - hw], [w.x + 0.25, F + P.window.h, w.z + hw], 'plank');
    return { w, col, n: -1 };
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), none = new THREE.Vector3(0, 0, 0), col = new THREE.Color();
  const setBoards = (i, n) => {
    const w = P.windows[i];
    for (let b = 0; b < BOARDS; b++) {
      const k = i * BOARDS + b, wob = Math.sin(k * 12.9898) * 43758.5453, tilt = ((wob - Math.floor(wob)) - 0.5) * 0.22;
      // nailed across on the inside, none of them quite straight
      v3.set(w.x + w.nx * 0.3, F + 0.22 + b * (P.window.h - 0.3) / (BOARDS - 1), w.z + w.nz * 0.3);
      q.setFromEuler(e.set(0, facing(w.nx, w.nz), tilt, 'YXZ'));
      boardMesh.setMatrixAt(k, m4.compose(v3, q, b < n ? one : none));
      boardMesh.setColorAt(k, col.setHSL(0.08, 0.5, 0.13 + 0.07 * (wob - Math.floor(wob))));
    }
    boardMesh.instanceMatrix.needsUpdate = true;
    if (boardMesh.instanceColor) boardMesh.instanceColor.needsUpdate = true;
  };

  // ---- things to buy: a plaque with the price, and the thing itself shown above it
  const shops = {}, kegMat = new THREE.MeshBasicMaterial({ vertexColors: true });       // (kegs are unlit, so their colours show in the dark)
  for (const s of P.shops) {
    const g = new THREE.Group(), yaw = facing(s.nx, s.nz);
    g.position.set(s.pos[0], s.pos[1], s.pos[2]); g.rotation.y = yaw;
    const name = s.kind === 'weapon' ? WEAPONS[s.item].label : s.kind === 'armour' ? ARMOUR[s.item].label : s.kind === 'tonic' ? TONICS[s.item].label
      : s.kind === 'chest' ? 'Mystery chest' : s.kind === 'forge' ? 'The forge' : 'Spike trap';
    const sign = plaque([[name, 64], [`${s.cost}`, 110, '#ffd76a']]);
    g.add(sign);
    let show = null;
    if (s.kind === 'weapon') {
      const { geo, mat } = weaponVisual(s.item);
      show = new THREE.Mesh(geo, mat);
      const tall = WEAPONS[s.item].size[1];
      show.position.set(0, 0.3 + tall / 2, 0.06);
      if (s.item === 'shield' || s.item === 'bow') show.rotation.y = -Math.PI / 2;       // face out from the wall
    } else if (s.kind === 'armour') {
      const { geo, mat } = armourVisual(s.item);
      show = new THREE.Mesh(geo, mat);
      show.position.set(0, 0.55, 0.2);
    } else if (s.kind === 'tonic') {
      // a keg on a stand, banded in the tonic's colour
      show = new THREE.Mesh(mergeGeometries([
        paint(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12).rotateX(Math.PI / 2), 0x4a2f1a),
        paint(new THREE.CylinderGeometry(0.212, 0.212, 0.16, 12).rotateX(Math.PI / 2), TONICS[s.item].color),
        paint(new THREE.BoxGeometry(0.6, 0.05, 0.5).translate(0, -0.24, 0), 0x3a2414),
      ]), kegMat);
      show.position.set(0, 0.55, 0.28);
    } else if (s.kind === 'chest') {
      show = new THREE.Group();
      const base = new THREE.Mesh(mergeGeometries([paint(new THREE.BoxGeometry(1, 0.45, 0.6), 0x4a2f1a), ...[-0.42, 0.42].map(x => paint(new THREE.BoxGeometry(0.08, 0.47, 0.62).translate(x, 0, 0), 0x2c3035))]), vcol);
      const lid = new THREE.Group(), top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.6), wood);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
      top.position.set(0, 0.08, 0.3); lid.add(top); lid.position.set(0, 0.225, -0.3);
      glow.position.y = 0.21;
      show.add(base, lid, glow);
      show.position.set(0, -0.175, 0); show.userData = { lid, glow };          // on its dais
      sign.position.set(0, 0.05, 0.42); sign.rotation.x = -0.5;
    } else if (s.kind === 'forge') {
      show = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 1.4), new THREE.MeshBasicMaterial({ color: 0xff6a1e }));       // the coals, glowing
      show.position.set(2.25, 0.53, -2.5);          // (over the forge's hearth, which is blocks: see maps.js)
      show.rotation.y = -yaw;
      sign.position.y = 0.2;
    } else if (s.kind === 'trap') {
      show = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), iron);
      show.position.set(0.5, 0.1, 0.05); show.rotation.z = -0.5;
    }
    if (show) g.add(show);
    group.add(g);
    shops[s.id] = { s, g, sign, show };
  }

  // ---- the spikes in the nave: they come up out of the floor when the trap is sprung
  const [tx0, tz0, tx1, tz1] = P.trap, spikes = new THREE.Group();
  {
    const cone = new THREE.ConeGeometry(0.07, 0.7, 5), mat = new THREE.MeshLambertMaterial({ color: 0x9aa3ab });
    const im = new THREE.InstancedMesh(cone, mat, 120);
    let n = 0;
    for (let x = tx0 + 0.25; x < tx1; x += 0.5) for (let z = tz0 + 0.25; z < tz1 && n < 120; z += 0.5) im.setMatrixAt(n++, m4.compose(v3.set(x + (n % 2) * 0.12, 0.35, z), q.identity(), one));
    im.count = n; im.frustumCulled = false;
    spikes.add(im);
    spikes.position.y = F - 0.75;
    group.add(spikes);
  }

  // ---- what the dead leave behind: a glowing shape that turns, with its name over it
  const dropGeo = new THREE.OctahedronGeometry(0.22), drops = new Map();
  const dropMesh = d => {
    const info = POWERUPS[d[1]], g = new THREE.Group();
    const gem = new THREE.Mesh(dropGeo, new THREE.MeshBasicMaterial({ color: info.color }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: blobTexture(), color: info.color, transparent: true, opacity: 0.55, depthWrite: false }));
    halo.scale.setScalar(1.1);
    const tag = plaque([[info.label, 70, '#fff3c4']], 0.7, 0.16, '#16100a');
    tag.position.y = 0.45;
    g.add(gem, halo, tag);
    g.position.set(d[2], F + 0.75, d[3]);
    g.userData = { gem, tag };
    group.add(g);
    return g;
  };

  // ---- torches on the walls: a bracket and a flame (no light of their own; they are there to be seen)
  const flames = [];
  {
    const spots = [];
    for (const [n, [x0, z0, x1, z1]] of Object.entries(P.zones)) {
      const y = n === 'yard' ? 2.6 : 2.4;
      for (let x = x0 + 2.5; x < x1 - 1; x += 5.5) spots.push([x, y, z0 + 0.12, 0, 1], [x, y, z1 - 0.12, 0, -1]);
      for (let z = z0 + 3; z < z1 - 1; z += 5.5) spots.push([x0 + 0.12, y, z, 1, 0], [x1 - 0.12, y, z, -1, 0]);
    }
    const stick = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), wood, spots.length);
    const fire = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xffa23a }), spots.length);
    spots.forEach(([x, y, z, nx, nz], i) => {
      stick.setMatrixAt(i, m4.compose(v3.set(x + nx * 0.1, y, z + nz * 0.1), q.setFromEuler(e.set(nz * 0.35, 0, -nx * 0.35)), one));
      flames.push(new THREE.Vector3(x + nx * 0.17, y + 0.32, z + nz * 0.17));
    });
    stick.frustumCulled = fire.frustumCulled = false;
    group.add(stick, fire);
    group.userData.fire = fire;
    // a soft glow round each, so they read as lit from across a room
    const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0xff8a2a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }), spots.length);
    spots.forEach(([x, y, z, nx, nz], i) => glow.setMatrixAt(i, m4.compose(v3.set(x + nx * 0.2, y + 0.3, z + nz * 0.2), q.setFromEuler(e.set(0, facing(nx, nz), 0)), one)));
    glow.frustumCulled = false; glow.renderOrder = 2;
    group.add(glow);
  }

  // nobody gets out over the graveyard's walls
  const ceiling = (() => { const [x0, z0, x1, z1] = P.zones.yard; return box([x0 - 1, P.yardCeiling, z0 - 1], [x1 + 1, P.yardCeiling + 1, z1 + 1], 'stone'); })();

  let state = null, time = 0;
  const api = {
    group, doors, windows, shops,
    /** The boxes that are in the way right now: shut doors, windows with boards on them, the lid over the yard. */
    colliders() {
      const out = [ceiling];
      for (const d of doors) if (!d.open) out.push(d.col);
      for (const w of windows) if (w.n !== 0) out.push(w.col);
      return out;
    },
    /** Make it look the way the rules say. Returns true if what is in the way has changed. */
    apply(st) {
      state = st;
      let changed = false;
      doors.forEach((d, i) => { const open = !!st.doors[i]; if (open !== d.open) { d.open = open; d.col.dead = open; changed = true; } });
      windows.forEach((w, i) => {
        const n = st.boards[i];
        if (n === w.n) return;
        if ((n === 0) !== (w.n === 0)) { changed = true; w.col.dead = n === 0; }
        w.n = n; setBoards(i, n);
      });
      // what has been dropped
      const seen = new Set();
      for (const d of st.drops) { seen.add(d[0]); if (!drops.has(d[0])) drops.set(d[0], dropMesh(d)); }
      for (const [k, g] of drops) if (!seen.has(k)) { group.remove(g); drops.delete(k); }
      return changed;
    },
    /** Every frame: doors slide, the chest opens, spikes rise, drops turn, flames flicker. */
    update(dt, camera) {
      if (!group.visible) return;
      time += dt;
      for (const d of doors) {
        const want = d.open ? -(P.door.h + 0.3) : 0, y = d.g.position.y - F;
        if (y !== want) d.g.position.y = F + y + Math.sign(want - y) * Math.min(Math.abs(want - y), dt * 2.2);
      }
      if (state) {
        const c = shops.chest, open = state.chest[0] !== 'shut';
        if (c) { const lid = c.show.userData.lid, want = open ? -1.25 : 0; lid.rotation.x += (want - lid.rotation.x) * Math.min(1, dt * 6); c.show.userData.glow.visible = open; }
        const up = state.trap[0] ? F - 0.05 : F - 0.75;
        spikes.position.y += (up - spikes.position.y) * Math.min(1, dt * 14);
      }
      for (const g of drops.values()) {
        g.userData.gem.rotation.y = time * 2.2; g.position.y = F + 0.75 + Math.sin(time * 2.4 + g.position.x) * 0.08;
        if (camera) g.userData.tag.quaternion.copy(camera.quaternion);
      }
      const fire = group.userData.fire;
      flames.forEach((p, i) => { const k = 0.85 + 0.25 * Math.sin(time * 9 + i * 1.7) + 0.1 * Math.sin(time * 23 + i); fire.setMatrixAt(i, m4.compose(p, q.identity(), v3.set(k, 0.8 + 0.4 * k, k))); });
      fire.instanceMatrix.needsUpdate = true;
    },
  };
  // as it starts: every door shut, every window boarded
  api.apply({ doors: P.doors.map(() => 0), boards: P.windows.map(() => BOARDS), drops: [], chest: ['shut'], trap: [0, 0] });
  return api;
}
