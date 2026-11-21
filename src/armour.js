// Armour: a helmet and a chest plate. They are ordinary props until somebody picks one
// up, which puts it on. Worn, a piece soaks up blows to the part it covers (see Body in
// body.js) until it has had enough, and then it is knocked off, dented, and is no use
// to anyone.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, box, STEEL, IRON, GOLD, DARK } from './weapons.js';

// slot: which of a body's two armour slots it fills.  part: the body part it covers.
// worn: where its middle sits on the wearer (in the head's own space for the helmet, the
// body's for the chest plate; both face +Z, like the body model).
export const ARMOUR = {
  helmet: { label: 'Helmet', slot: 0, part: 'head', size: [0.32, 0.3, 0.34], mass: 2.5, worn: [0, -0.015, -0.044] },
  chestplate: { label: 'Chest plate', slot: 1, part: 'torso', size: [0.46, 0.44, 0.32], mass: 7, worn: [0, -0.44, -0.045] },
};
/** The piece that goes in each slot. */
export const SLOTS = ['helmet', 'chestplate'];

const BRONZE = 0xb98a3e, CREST = 0xb3261e;
const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const cache = {};

const BUILD = {
  // a gladiator's helmet: a dome, a guard round the back and sides, a nose bar and a crest
  helmet: () => {
    const R = 0.152;
    return [
      paint(new THREE.SphereGeometry(R, 12, 5, 0, Math.PI * 2, 0, 1.25), STEEL),                                  // the dome, down to the brow
      paint(new THREE.SphereGeometry(R, 9, 3, Math.PI * 5 / 6, Math.PI * 4 / 3, 1.25, 0.95), STEEL),              // back and cheeks; the face stays open
      paint(new THREE.TorusGeometry(R * Math.sin(1.25), 0.012, 4, 14).rotateX(Math.PI / 2).translate(0, R * Math.cos(1.25), 0), BRONZE),   // a band round the brow
      box(0.026, 0.11, 0.016, 0, -0.005, R - 0.004, BRONZE),                                                     // nose bar
      paint(new THREE.CylinderGeometry(R + 0.045, R + 0.045, 0.03, 12, 1, false, 0.55, Math.PI - 0.9).rotateZ(Math.PI / 2), CREST),   // the crest: a fin over the top, front to back
    ];
  },
  // a breastplate and a backplate, joined at the sides and over the shoulders
  chestplate: () => {
    const D = 0.14;
    return [
      box(0.38, 0.4, 0.028, 0, 0, D, STEEL), box(0.3, 0.3, 0.02, 0, 0.01, D + 0.02, 0xdde3e8),     // front, with a raised middle
      box(0.38, 0.4, 0.028, 0, 0, -D, STEEL),                                                      // back
      box(0.03, 0.22, D * 2, -0.19, -0.07, 0, IRON), box(0.03, 0.22, D * 2, 0.19, -0.07, 0, IRON),  // sides, under the arms
      box(0.08, 0.03, D * 2 + 0.03, -0.13, 0.2, 0, DARK), box(0.08, 0.03, D * 2 + 0.03, 0.13, 0.2, 0, DARK),   // shoulder straps
      box(0.38, 0.035, 0.036, 0, -0.17, D, BRONZE), box(0.38, 0.035, 0.036, 0, 0.17, D, BRONZE),    // trim
      paint(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 8).rotateX(Math.PI / 2).translate(0, 0.03, D + 0.035), GOLD),   // a boss in the middle
    ];
  },
};

/** { geo, mat } for a piece of armour, shared by every copy. `dented`: one that has been knocked off. */
export function armourVisual(id, dented = false) {
  const key = id + (dented ? ':dented' : '');
  if (!cache[key]) {
    if (!dented) {
      const parts = BUILD[id]();
      cache[key] = { geo: mergeGeometries(parts), mat: material };
      for (const g of parts) g.dispose();
    } else {
      // the same piece, battered: duller, blotchy, and knocked out of shape
      const geo = armourVisual(id).geo.clone(), p = geo.attributes.position, c = geo.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const tri = Math.floor(i / 3), k = 0.45 + 0.3 * (((Math.imul(tri + 3, 2654435761) >>> 0) % 1000) / 1000);
        c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        p.setXYZ(i, x * (1 + 0.5 * y), y * 0.92, z + 0.25 * x * y);
      }
      geo.computeVertexNormals();
      cache[key] = { geo, mat: material };
    }
  }
  return cache[key];
}

/** A mesh of a piece as it is worn, to add to a body's head (helmet) or root (chest plate). */
export function wornArmour(id) {
  const { geo, mat } = armourVisual(id);
  const m = new THREE.Mesh(geo, mat);
  m.position.fromArray(ARMOUR[id].worn);
  m.frustumCulled = false;
  return m;
}
