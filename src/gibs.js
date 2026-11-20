// Body pieces lying around after an arm comes off or someone dies. They are ordinary
// physics props (see props.js), just drawn with the real body parts. Each piece is one
// mesh (skin and raw flesh are painted on as vertex colours), so a pile of them stays cheap.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let template = null;
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const FLESH = new THREE.Color(0x8c1212);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Give this the loaded body model (assets/body-rig.glb) once it is ready. */
export function setBodyTemplate(t) { template = t; }

// which body parts make up each piece
const PIECES = {
  gib_head: ['Head', 'Head_cap'],
  gib_torso: ['Torso', 'Torso_cap'],
  gib_arm: ['UpperArm_L', 'UpperArm_L_cap', 'Forearm_L', 'Hand_L'],
  gib_fore: ['Forearm_L', 'Forearm_L_cap', 'Hand_L'],
  gib_upper: ['UpperArm_L', 'UpperArm_L_cap'],
};

/**
 * A model for one body piece in the given skin colour, centred on itself, or null if
 * the body model is not loaded (then the prop falls back to a plain shape).
 */
export function makeGib(typeId, color) {
  if (!template || !PIECES[typeId]) return null;
  const skin = new THREE.Color(color), parts = [];
  for (const name of PIECES[typeId]) {
    const src = template.getObjectByName(name);
    if (!src || !src.geometry) continue;
    const g = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.translate(src.position.x, src.position.y, src.position.z);       // where the part sits on a whole body
    const c = name.endsWith('_cap') ? FLESH : skin, n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  if (!parts.length) return null;
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  // centre it, and lay arms along the prop's long (Y) axis
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  if (typeId !== 'gib_head' && typeId !== 'gib_torso') {
    const a = new THREE.Vector3().fromArray(template.getObjectByName(PIECES[typeId][0]).userData.from);
    const b = new THREE.Vector3().fromArray(template.getObjectByName(PIECES[typeId].find(n => n.startsWith('Hand')) || PIECES[typeId][0]).userData.to);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), DOWN));
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.dispose = () => geo.dispose();
  return mesh;
}
