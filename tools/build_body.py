"""Build the player's body from the low-poly man, with the skeleton's arm bones inside.

Inputs:  assets/man.glb           "Proportional Low Poly Man" by Robin Butler, CC-BY-4.0
         assets/skeleton-rig.glb  made by tools/split_skeleton.py
Output:  assets/body-rig.glb

The man has no bones, so he is cut along his own vertex rings:
  Head, Torso (legs removed at the hips), UpperArm_L/R, Forearm_L/R, Hand_L/R
Every cut is closed with a separate red "X_cap" mesh, which the game shows where a
part has been torn off. The skeleton's arm bones are refitted to lie inside the new
arms as Bone_UpperArm_L etc. (shown when the flesh is stripped).

Like the skeleton rig, the result faces +Z, is in metres, has its root at the eye
point, and the character's left is +X. Each arm part's origin is at its joint and
its node.extras hold the rest joint positions ("from" / "to", hands also "palm").
The joint numbers printed at the end are copied into src/bodyrig.js.
"""
import json, struct, sys
import numpy as np

MAN = 'assets/man.glb'; SKEL = 'assets/skeleton-rig.glb'; DST = 'assets/body-rig.glb'
NECK_Y = 4.97          # head = everything above this (in the man's own units)
LEG_Y = 2.6            # anything reaching below this, that is not an arm, is leg
EYE = np.array([0.0, 5.40, 0.45])
BODY_HEIGHT = 0.8      # eye to the bottom of the body, metres (matches the movement code)

CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def load(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    b = d[20 + jl + 8:]
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride', dt.itemsize * n)
        raw = np.frombuffer(b, np.uint8, stride * (a['count'] - 1) + dt.itemsize * n, off)
        out = np.lib.stride_tricks.as_strided(raw, (a['count'], dt.itemsize * n), (stride, 1)).copy().view(dt)
        return out.reshape(a['count'], n) if n > 1 else out.reshape(-1)
    return j, acc

# ------------------------------------------------------------------ the man
j, acc = load(MAN)
prim = j['meshes'][0]['primitives'][0]
P = acc(prim['attributes']['POSITION']).astype(float)
P = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)            # the file is Z-up; make it Y-up, facing +Z
I = acc(prim['indices']).astype(int).reshape(-1, 3)
U, uid = np.unique(P.round(4), axis=0, return_inverse=True)   # weld: the file repeats vertices per face
T = uid.reshape(-1)[I]                                    # triangles as unique-vertex ids
print(f'man: {len(T)} triangles, {len(U)} vertices, height {U[:, 1].max() - U[:, 1].min():.2f} units')

def arm_rings(sign):
    """Vertex rings down one arm (+1 = the man's left, at +X): shoulder, 3 upper-arm rings, wrist, hand."""
    Q = U * np.array([sign, 1, 1])
    cand = np.where((Q[:, 0] > 0.55) & (Q[:, 1] < 4.8) & (Q[:, 1] > 2.0))[0]
    A = Q[cand]; c = A.mean(0)
    ax = np.linalg.svd(A - c)[2][0]
    if ax[0] < 0: ax = -ax
    t = (A - c) @ ax
    rad = np.linalg.norm((A - c) - np.outer(t, ax), axis=1)
    keep = rad < 0.5                                       # drops a stray thigh vertex
    cand, t = cand[keep], t[keep]
    order = np.argsort(t); cand, t = cand[order], t[order]
    groups = [set(g.tolist()) for g in np.split(cand, np.where(np.diff(t) > 0.12)[0] + 1)]
    # down the arm: shoulder (two clusters), four rings of four, then the fist (two rings of four)
    assert [len(g) for g in groups] == [2, 1, 4, 4, 4, 4, 4, 4], [len(g) for g in groups]
    return [groups[0] | groups[1], groups[2], groups[3], groups[4], groups[5], groups[6] | groups[7]]

rings = {+1: arm_rings(+1), -1: arm_rings(-1)}
part_of = np.full(len(T), '', dtype=object)
for sign, side in ((+1, 'L'), (-1, 'R')):
    sh, r1, r2, r3, r4, hand = rings[sign]
    for n, tri in enumerate(T):
        s = set(tri.tolist())
        if s <= (r4 | hand): part_of[n] = f'Hand_{side}'
        elif s <= (r3 | r4): part_of[n] = f'Forearm_{side}'
        elif s <= (r1 | r2 | r3): part_of[n] = f'UpperArm_{side}'
for n, tri in enumerate(T):
    if part_of[n]: continue
    y = U[tri, 1]
    part_of[n] = 'Head' if y.min() > NECK_Y else 'Legs' if y.min() < LEG_Y else 'Torso'

scale = BODY_HEIGHT / (EYE[1] - min(U[t, 1].min() for n, t in enumerate(T) if part_of[n] == 'Torso'))
rig = lambda v: (np.asarray(v, float) - EYE) * scale       # the man's units -> rig space metres

def joints(sign):
    sh, r1, r2, r3, r4, hand = rings[sign]
    c = lambda s: U[sorted(s)].mean(0)
    c1, c3, c4 = c(r1), c(r3), c(r4)
    shoulder = c1 - (c3 - c1) / np.linalg.norm(c3 - c1) * 0.30   # the real joint sits inside the deltoid, above the first ring
    hv = U[sorted(hand)]
    f = hv.mean(0) - c4; f /= np.linalg.norm(f)
    tip = c4 + f * ((hv - c4) @ f).max()
    palm = np.array([-sign, 0.0, 0.0]); palm -= f * palm.dot(f); palm /= np.linalg.norm(palm)   # palms face the body
    return dict(shoulder=rig(shoulder), elbow=rig(c3), wrist=rig(c4), tip=rig(tip), palm=palm)
J = {'L': joints(+1), 'R': joints(-1)}

# eyes: where a ray from in front of the face meets the head
def eye_point(x, y):
    best = None
    for n, tri in enumerate(T):
        if part_of[n] != 'Head': continue
        a, b, c = U[tri]
        e1, e2 = b - a, c - a; d = np.array([0, 0, -1.0]); o = np.array([x, y, 3.0])
        h = np.cross(d, e2); det = e1.dot(h)
        if abs(det) < 1e-9: continue
        s = o - a; u = s.dot(h) / det; q = np.cross(s, e1); v = d.dot(q) / det
        if u < 0 or v < 0 or u + v > 1: continue
        tt = e2.dot(q) / det
        if tt > 0 and (best is None or tt < best): best = tt
    return rig([x, y, 3.0 - best])
eyes = [eye_point(0.105, 5.41), eye_point(-0.105, 5.41)]

def flat(tris_xyz):
    """Positions and flat normals for a list of triangles (N x 3 x 3)."""
    tris_xyz = np.asarray(tris_xyz, float)
    n = np.cross(tris_xyz[:, 1] - tris_xyz[:, 0], tris_xyz[:, 2] - tris_xyz[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    return tris_xyz.reshape(-1, 3), np.repeat(n, 3, axis=0)

def caps(tri_ids, centre):
    """Close the open edges of a part: one fan per loop. Returns [(loop centre, triangles)]."""
    edges = {}
    for tri in tri_ids:
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            edges[(a, b)] = edges.get((a, b), 0) + 1
    border = {a: b for (a, b) in edges if (b, a) not in edges}   # each open edge once, in winding order
    out = []
    while border:
        start = next(iter(border)); loop = [start]; nxt = border.pop(start)
        while nxt != start and nxt in border:
            loop.append(nxt); nxt = border.pop(nxt)
        pts = U[loop]; mid = pts.mean(0)
        tris = [[pts[k], mid, pts[(k + 1) % len(pts)]] for k in range(len(pts))]
        # the cap must face away from the part
        n = np.cross(tris[0][1] - tris[0][0], tris[0][2] - tris[0][0])
        if n.dot(mid - centre) < 0: tris = [[t[0], t[2], t[1]] for t in tris]
        out.append((mid, tris))
    return out

parts = {}     # name -> dict(origin, skin triangles, cap triangles)
for name in ['Head', 'Torso'] + [f'{p}_{s}' for s in 'LR' for p in ('UpperArm', 'Forearm', 'Hand')]:
    ids = T[part_of == name]
    skin = [U[t] for t in ids]
    centre = np.array(skin).reshape(-1, 3).mean(0)
    red = []
    for mid, tris in caps(ids, centre):
        # the torso's underside is skin (that is where the legs were); every other cut is raw
        (skin if name == 'Torso' and mid[1] < 3.5 else red).extend(tris)
    side = name[-1] if name[-2] == '_' else None
    origin = (np.zeros(3) if side is None else J[side]['shoulder' if name.startswith('Upper') else 'elbow' if name.startswith('Fore') else 'wrist'])
    parts[name] = dict(origin=origin, skin=[rig(t) - origin for t in skin], red=[rig(t) - origin for t in red])
    print(f'{name:12s} {len(skin):4d} skin triangles, {len(red):3d} cap triangles')

# ------------------------------------------------------------------ the skeleton's arm bones, refitted
sj, sacc = load(SKEL)
def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = a.dot(b)
    if np.linalg.norm(v) < 1e-9: return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)
bones = {}
for node in sj['nodes']:
    name = node.get('name', '')
    if not name[:-2] in ('UpperArm', 'Forearm', 'Hand') or 'mesh' not in node: continue
    side = name[-1]; jt = J[side]
    pr = sj['meshes'][node['mesh']]['primitives'][0]
    v = sacc(pr['attributes']['POSITION']).astype(float); nrm = sacc(pr['attributes']['NORMAL']).astype(float)
    idx = sacc(pr['indices']).astype(int)
    a, b = np.array(node['extras']['from']), np.array(node['extras']['to'])
    if name.startswith('Hand'):
        # line up fingers and palm, not just the direction
        f0 = (b - a) / np.linalg.norm(b - a); p0 = np.array(node['extras']['palm']); p0 -= f0 * p0.dot(f0); p0 /= np.linalg.norm(p0)
        f1 = (jt['tip'] - jt['wrist']); length = np.linalg.norm(f1); f1 /= length; p1 = jt['palm']
        R = np.column_stack([f1, p1, np.cross(f1, p1)]) @ np.column_stack([f0, p0, np.cross(f0, p0)]).T
        k = length / np.linalg.norm(b - a) * 1.05
        origin = jt['wrist']
    else:
        start, end = (jt['shoulder'], jt['elbow']) if name.startswith('Upper') else (jt['elbow'], jt['wrist'])
        R = rot_between(b - a, end - start)
        k = np.linalg.norm(end - start) / np.linalg.norm(b - a)
        origin = start
    bones[name] = dict(origin=origin, pos=(v @ R.T) * k, nrm=nrm @ R.T, idx=idx)

# ------------------------------------------------------------------ write the GLB
nodes, meshes, accessors, views, chunks = [], [], [], [], []
def view(arr, target):
    data = arr.tobytes(); pad = (-len(data)) % 4
    views.append({'buffer': 0, 'byteOffset': sum(len(c) for c in chunks), 'byteLength': len(data), 'target': target})
    chunks.append(data + b'\0' * pad)
    return len(views) - 1
def mesh(name, pos, nrm, material, idx=None):
    pos = np.asarray(pos, np.float32); nrm = np.asarray(nrm, np.float32)
    attrs = {}
    accessors.append({'bufferView': view(pos, 34962), 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()})
    attrs['POSITION'] = len(accessors) - 1
    accessors.append({'bufferView': view(nrm, 34962), 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'})
    attrs['NORMAL'] = len(accessors) - 1
    p = {'attributes': attrs, 'material': material}
    if idx is not None:
        idx = np.asarray(idx, np.uint16 if len(pos) < 65536 else np.uint32).reshape(-1)
        accessors.append({'bufferView': view(idx, 34963), 'componentType': 5123 if idx.dtype == np.uint16 else 5125, 'count': len(idx), 'type': 'SCALAR'})
        p['indices'] = len(accessors) - 1
    meshes.append({'name': name, 'primitives': [p]})
    return len(meshes) - 1
r5 = lambda v: [round(float(x), 5) for x in v]
total = 0
for name, part in parts.items():
    side = name[-1] if name[-2] == '_' else None
    extras = {}
    if side:
        jt = J[side]
        a, b = (('shoulder', 'elbow') if name.startswith('Upper') else ('elbow', 'wrist') if name.startswith('Fore') else ('wrist', 'tip'))
        extras = {'from': r5(jt[a]), 'to': r5(jt[b])}
        if name.startswith('Hand'): extras['palm'] = r5(jt['palm'])
    if name == 'Head': extras = {'eyes': [r5(e) for e in eyes]}
    pos, nrm = flat(part['skin']); total += len(pos) // 3
    nodes.append({'name': name, 'mesh': mesh(name, pos, nrm, 0), 'translation': r5(part['origin']), **({'extras': extras} if extras else {})})
    if part['red']:
        pos, nrm = flat(part['red']); total += len(pos) // 3
        nodes.append({'name': name + '_cap', 'mesh': mesh(name + '_cap', pos, nrm, 1), 'translation': r5(part['origin'])})
bone_tris = 0
for name, bn in bones.items():
    bone_tris += len(bn['idx']) // 3
    nodes.append({'name': 'Bone_' + name, 'mesh': mesh('Bone_' + name, bn['pos'], bn['nrm'], 2, bn['idx']), 'translation': r5(bn['origin'])})
nodes.append({'name': 'BodyRig', 'children': list(range(len(nodes)))})
binary = b''.join(chunks)
gltf = {
    'asset': {'version': '2.0', 'generator': 'canopy-tag build_body.py',
              'extras': {'credits': 'Body: "Proportional Low Poly Man" by Robin Butler (sketchfab.com/StarTrekGuy), CC-BY-4.0, cut into parts with the legs removed.'}},
    'scene': 0, 'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'meshes': meshes,
    'materials': [
        {'name': 'Skin', 'pbrMetallicRoughness': {'baseColorFactor': [0.86, 0.68, 0.53, 1], 'metallicFactor': 0, 'roughnessFactor': 0.9}},
        {'name': 'Flesh', 'pbrMetallicRoughness': {'baseColorFactor': [0.55, 0.06, 0.06, 1], 'metallicFactor': 0, 'roughnessFactor': 0.7}},
        {'name': 'Bone', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorFactor': [0.86, 0.82, 0.66, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}},
    ],
    'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(binary)}],
}
js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(binary), b'BIN\0') + binary
open(DST, 'wb').write(glb)
print(f'\nwrote {DST}: {total} body triangles + {bone_tris} bone triangles, {len(glb) / 1024:.0f} KB, scale {scale:.4f} m per unit')
print('\n// for src/bodyrig.js (left arm; the right is mirrored in x):')
jt = J['L']
print('shoulder', r5(jt['shoulder']), 'elbow', r5(jt['elbow']), 'wrist', r5(jt['wrist']), 'tip', r5(jt['tip']))
print('upper', round(float(np.linalg.norm(jt['elbow'] - jt['shoulder'])), 4), 'fore', round(float(np.linalg.norm(jt['wrist'] - jt['elbow'])), 4), 'hand', round(float(np.linalg.norm(jt['tip'] - jt['wrist'])), 4))
head = np.array(parts['Head']['skin']).reshape(-1, 3); torso = np.array(parts['Torso']['skin']).reshape(-1, 3)
print('head box', r5(head.min(0)), r5(head.max(0)))
print('torso box', r5(torso.min(0)), r5(torso.max(0)))
print('eyes', [r5(e) for e in eyes])
