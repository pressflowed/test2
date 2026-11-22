// The camp at the mouth of the Deep (the horror mode): the shop's signs, the ore crusher,
// lanterns and a fire. It is the one lit place down there. It only draws things: what the
// signs sell and what the crusher pays are in caves.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAVE } from './maps.js';
import { UPGRADES } from './caves.js';
import { paint } from './weapons.js';
import { blobTexture } from './textures.js';

const HAS_DOM = typeof document !== 'undefined';
function sign(lines, w, h) {
  let map = null;
  if (HAS_DOM) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = Math.round(512 * h / w);
    const g = cv.getContext('2d');
    g.fillStyle = '#2b1d10'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#120b05'; g.lineWidth = 14; g.strokeRect(7, 7, cv.width - 14, cv.height - 14);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach(([text, size, color], i) => { g.font = `bold ${size}px sans-serif`; g.fillStyle = color || '#f1e4c3'; g.fillText(text, cv.width / 2, cv.height * (i + 0.5) / lines.length, cv.width - 36); });
    map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial(map ? { map } : { color: 0x2b1d10 }));
}

export function makeCamp(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  // the shop: a sign for each thing, facing out from the board at the back of the camp
  for (const s of CAVE.shops) {
    const u = UPGRADES[s.id], m = sign([[u.label, 62], [u.cost ? `$${u.cost}` : 'free', 96, '#ffd76a']], 1.02, 0.6);
    m.position.set(s.pos[0], s.pos[1], s.pos[2] - 0.04); m.rotation.y = Math.PI;
    group.add(m);
  }
  const title = sign([['SHOP', 120, '#ffd76a']], 2.2, 0.5);
  title.position.set(-2.1, 3.55, 31.7); title.rotation.y = Math.PI;
  group.add(title);

  // the crusher: a hopper on top, two toothed rollers, a chute. It shakes when it is fed.
  const C = CAVE.crusher, crusher = new THREE.Group(), iron = 0x3a3f45, rust = 0x7a4a2c;
  const body = new THREE.Mesh(mergeGeometries([
    paint(new THREE.BoxGeometry(1.3, 0.9, 1.3).translate(0, 0.45, 0), iron),
    paint(new THREE.CylinderGeometry(0.75, 0.35, 0.55, 4, 1, true).rotateY(Math.PI / 4).translate(0, 1.18, 0), rust),
    paint(new THREE.BoxGeometry(0.5, 0.08, 0.7).rotateZ(0.5).translate(-0.85, 0.3, 0), rust),
    paint(new THREE.BoxGeometry(0.16, 1.5, 0.16).translate(0.62, 0.75, 0.62), 0x22262a), paint(new THREE.BoxGeometry(0.16, 1.5, 0.16).translate(-0.62, 0.75, -0.62), 0x22262a),
  ]), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const rollers = [-0.17, 0.17].map(x => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 7).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a9096, flatShading: true })); r.position.set(x, 0.98, 0); crusher.add(r); return r; });
  crusher.add(body);
  crusher.position.set(C.pos[0], 1.5, C.pos[2]);
  group.add(crusher);
  const cs = sign([['ORE CRUSHER', 64], ['ore in, money out', 44, '#ffd76a']], 1.3, 0.5);
  cs.position.set(C.pos[0] - 0.67, C.pos[1], C.pos[2]); cs.rotation.y = -Math.PI / 2;
  group.add(cs);

  // lanterns on the posts, and the fire: the only light of their own down here
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc070 }), halo = new THREE.SpriteMaterial({ map: blobTexture(), color: 0xff9a3a, transparent: true, opacity: 0.5, depthWrite: false });
  for (const [x, z] of CAVE.lamps) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), glowMat); l.position.set(x, 3.1, z); group.add(l);
    const h = new THREE.Sprite(halo); h.position.copy(l.position); h.scale.setScalar(1.6); group.add(h);
  }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
  fire.position.set(CAVE.camp.x, 1.45, CAVE.camp.z - 3);
  group.add(fire);
  const light = new THREE.PointLight(0xffb060, 26, 17, 1.6);
  light.position.set(CAVE.camp.x, 3.4, CAVE.camp.z + 1.5);
  group.add(light);
  const light2 = new THREE.PointLight(0xff8a3a, 10, 9, 1.8);
  light2.position.copy(fire.position).setY(1.9);
  group.add(light2);

  let shake = 0, t = 0;
  return {
    group,
    /** The crusher has just been fed. */
    crunch() { shake = 0.9; },
    update(dt) {
      if (!group.visible) return;
      t += dt;
      shake = Math.max(0, shake - dt);
      crusher.position.x = C.pos[0] + (shake > 0 ? Math.sin(t * 70) * 0.025 : 0);
      rollers.forEach((r, i) => { r.rotation.z += (i ? -1 : 1) * dt * (shake > 0 ? 14 : 0.6); });
      const k = 0.85 + 0.2 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23);
      fire.scale.set(k, 0.8 + 0.4 * k, k);
      light2.intensity = 9 * k; light.intensity = 26 * (0.94 + 0.06 * Math.sin(t * 5));
    },
  };
}
