// Collision world made of axis-aligned boxes, plus sphere-vs-box helpers.
import * as THREE from 'three';

export class World {
  constructor() {
    this.colliders = [];
  }
  /** Add a box by its centre x/z, bottom y and size. Returns the collider. */
  addBox(cx, by, cz, w, h, d, kind = 'wood') {
    const c = {
      min: new THREE.Vector3(cx - w / 2, by, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, by + h, cz + d / 2),
      kind,
    };
    this.colliders.push(c);
    return c;
  }
}

/** Signed distance from point p to box b (negative inside). */
export function sdBox(p, b) {
  const dx = Math.max(b.min.x - p.x, p.x - b.max.x);
  const dy = Math.max(b.min.y - p.y, p.y - b.max.y);
  const dz = Math.max(b.min.z - p.z, p.z - b.max.z);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0);
}

/** Cheap reject: is p within r of the box's bounds? */
export function near(p, b, r) {
  return p.x > b.min.x - r && p.x < b.max.x + r &&
         p.y > b.min.y - r && p.y < b.max.y + r &&
         p.z > b.min.z - r && p.z < b.max.z + r;
}

/**
 * Push sphere (p, r) out of box b. Moves p in place and writes the contact
 * normal to nOut. Returns true if there was contact.
 */
export function pushOut(p, r, b, nOut) {
  if (!near(p, b, r)) return false;
  const cx = Math.min(Math.max(p.x, b.min.x), b.max.x);
  const cy = Math.min(Math.max(p.y, b.min.y), b.max.y);
  const cz = Math.min(Math.max(p.z, b.min.z), b.max.z);
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nOut.set(dx / d, dy / d, dz / d);
    p.set(cx + nOut.x * r, cy + nOut.y * r, cz + nOut.z * r);
  } else {
    // centre is inside the box: leave through the nearest face
    let best = p.x - b.min.x; nOut.set(-1, 0, 0);
    if (b.max.x - p.x < best) { best = b.max.x - p.x; nOut.set(1, 0, 0); }
    if (p.y - b.min.y < best) { best = p.y - b.min.y; nOut.set(0, -1, 0); }
    if (b.max.y - p.y < best) { best = b.max.y - p.y; nOut.set(0, 1, 0); }
    if (p.z - b.min.z < best) { best = p.z - b.min.z; nOut.set(0, 0, -1); }
    if (b.max.z - p.z < best) { best = b.max.z - p.z; nOut.set(0, 0, 1); }
    p.addScaledVector(nOut, best + r);
  }
  return true;
}
