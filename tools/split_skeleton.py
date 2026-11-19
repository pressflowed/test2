"""Turn the Blender skeleton export into a VR-ready player rig.

Input:  assets/skeleton.glb  (one-piece export, both arms merged per part)
Output: assets/skeleton-rig.glb with separate, named parts whose origins sit at their joints:
        Head, Torso, UpperArm_L/R, Forearm_L/R, Hand_L/R
The rig faces +Z, is in metres, and its root (0,0,0) is the eye point (camera position).
Each arm part stores its rest joint positions in node.extras so the game can do 2-bone IK.
"""
import json, struct, sys
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/skeleton.glb'
DST = sys.argv[2] if len(sys.argv) > 2 else 'assets/skeleton-rig.glb'
ARM_LENGTH = 0.80  # shoulder -> wrist in metres after scaling

data = open(SRC, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
gj = json.loads(data[20:20 + jlen])
off = 20 + jlen
blen = struct.unpack('<I', data[off:off + 4])[0]
binbuf = data[off + 8:off + 8 + blen]

CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read(ai):
    a = gj['accessors'][ai]; bv = gj['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', dt.itemsize * n)
    raw = np.frombuffer(binbuf, np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, (a['count'], dt.itemsize * n), (stride, 1)).copy()
    return out.view(dt).reshape(a['count'], n) if n > 1 else out.view(dt).reshape(-1)

def trs(n):
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                  [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(n.get('scale', [1, 1, 1])); M[:3, 3] = n.get('translation', [0, 0, 0])
    return M

parts = {}  # name -> (positions Nx3 world, normals Nx3 world, tri indices Mx3)
def walk(i, P):
    n = gj['nodes'][i]; M = P @ trs(n)
    if 'mesh' in n:
        P_, N_, I_ = [], [], []; base = 0
        for prim in gj['meshes'][n['mesh']]['primitives']:
            p = read(prim['attributes']['POSITION']).astype(np.float64)
            nr = read(prim['attributes']['NORMAL']).astype(np.float64)
            idx = read(prim['indices']).astype(np.int64) if 'indices' in prim else np.arange(len(p))
            p = p @ M[:3, :3].T + M[:3, 3]
            nm = nr @ np.linalg.inv(M[:3, :3])  # inverse-transpose
            nm /= np.linalg.norm(nm, axis=1, keepdims=True) + 1e-12
            P_.append(p); N_.append(nm); I_.append(idx.reshape(-1, 3) + base); base += len(p)
        parts[n['name']] = (np.vstack(P_), np.vstack(N_), np.vstack(I_))
    for c in n.get('children', []): walk(c, M)
for r in gj['scenes'][0]['nodes']: walk(r, np.eye(4))
print('source parts:', sorted(parts))

def merge(names):
    P, N, I, b = [], [], [], 0
    for nm in names:
        p, n, i = parts[nm]; P.append(p); N.append(n); I.append(i + b); b += len(p)
    return np.vstack(P), np.vstack(N), np.vstack(I)

def split(mesh, mid):
    """Split a merged left+right mesh by which side of the midline each triangle sits on."""
    p, n, i = mesh
    cx = p[i].mean(axis=1)[:, 0]
    out = {}
    for side, mask in (('L', cx > mid), ('R', cx <= mid)):  # facing +Z, the character's left is +X
        tris = i[mask]; used = np.unique(tris); remap = -np.ones(len(p), np.int64); remap[used] = np.arange(len(used))
        out[side] = (p[used], n[used], remap[tris])
    return out

head = merge(['Skull', 'Teeth Up', 'TeethBack'])
torso = merge(['Rib Cage', 'Clavicle And Shoulder'])
skull_p = parts['Skull'][0]
mid = (skull_p[:, 0].min() + skull_p[:, 0].max()) / 2
upper = split(parts['Humerus'], mid)
fore = split(merge(['Radius', 'Ulna']), mid)
hand = split(parts['Cube'], mid)

def ends(points, toward):
    """Endpoints of a long bone along its main axis; first one is the end nearest `toward`."""
    c = points.mean(axis=0); u = np.linalg.svd(points - c, full_matrices=False)[2][0]
    t = (points - c) @ u
    a = points[t <= np.percentile(t, 2)].mean(axis=0); b = points[t >= np.percentile(t, 98)].mean(axis=0)
    return (a, b) if np.linalg.norm(a - toward) < np.linalg.norm(b - toward) else (b, a)

skull_c = (skull_p.min(axis=0) + skull_p.max(axis=0)) / 2
eye = np.array([mid, skull_c[1], skull_p[:, 2].max() - np.ptp(skull_p[:, 2]) * 0.35])  # a bit behind the face
joints = {}
for s in 'LR':
    sh, el = ends(upper[s][0], skull_c)
    el2, wr = ends(fore[s][0], el)
    elbow = (el + el2) / 2
    hp = hand[s][0]
    tip = hp[np.argmax(np.linalg.norm(hp - wr, axis=1))]
    # palm normal: the hand's thinnest direction, pointed toward the body's midline (palms facing in)
    hc = hp.mean(axis=0); palm = np.linalg.svd(hp - hc, full_matrices=False)[2][2]
    if (palm[0] > 0) == (s == 'L'): palm = -palm
    joints[s] = dict(shoulder=sh, elbow=elbow, wrist=wr, tip=tip, palm=palm)

scale = ARM_LENGTH / np.mean([np.linalg.norm(j['elbow'] - j['shoulder']) + np.linalg.norm(j['wrist'] - j['elbow']) for j in joints.values()])
to_rig = lambda v: (np.asarray(v) - eye) * scale
print(f'scale {scale:.4f}')

# ---- assemble output
out_nodes, out_meshes, accessors, views, chunks = [], [], [], [], []
def add_view(arr, target):
    b = arr.tobytes(); pad = (-len(b)) % 4
    views.append({'buffer': 0, 'byteOffset': sum(len(c) for c in chunks), 'byteLength': len(b), 'target': target})
    chunks.append(b + b'\0' * pad)
    return len(views) - 1
def add_mesh(name, mesh, origin):
    p, n, i = mesh
    p = ((p - eye) * scale - origin).astype(np.float32); n = n.astype(np.float32)
    idx = i.astype(np.uint16 if len(p) < 65536 else np.uint32).reshape(-1)
    pa = len(accessors); accessors.append({'bufferView': add_view(p, 34962), 'componentType': 5126, 'count': len(p), 'type': 'VEC3',
                                           'min': p.min(axis=0).tolist(), 'max': p.max(axis=0).tolist()})
    na = len(accessors); accessors.append({'bufferView': add_view(n, 34962), 'componentType': 5126, 'count': len(n), 'type': 'VEC3'})
    ia = len(accessors); accessors.append({'bufferView': add_view(idx, 34963), 'componentType': 5123 if idx.dtype == np.uint16 else 5125,
                                           'count': len(idx), 'type': 'SCALAR'})
    out_meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': 0}]})
    return len(out_meshes) - 1, len(idx) // 3

r = lambda v: [round(float(x), 5) for x in v]
spec = [('Head', head, to_rig(eye), {}), ('Torso', torso, to_rig([mid, skull_p[:, 1].min(), skull_c[2]]), {})]
for s in 'LR':
    j = {k: to_rig(v) for k, v in joints[s].items() if k != 'palm'}
    spec += [(f'UpperArm_{s}', upper[s], j['shoulder'], {'from': r(j['shoulder']), 'to': r(j['elbow'])}),
             (f'Forearm_{s}', fore[s], j['elbow'], {'from': r(j['elbow']), 'to': r(j['wrist'])}),
             (f'Hand_{s}', hand[s], j['wrist'], {'from': r(j['wrist']), 'to': r(j['tip']), 'palm': r(joints[s]['palm'])})]
total = 0
for name, mesh, origin, extras in spec:
    mi, tris = add_mesh(name, mesh, origin); total += tris
    node = {'name': name, 'mesh': mi, 'translation': r(origin)}
    if extras: node['extras'] = extras
    out_nodes.append(node)
    print(f'{name:12s} tris {tris:5d} origin {r(origin)}' + (f"  ->  {extras['to']}" if extras else ''))
out_nodes.append({'name': 'SkeletonRig', 'children': list(range(len(out_nodes)))})
binary = b''.join(chunks)
gltf = {
    'asset': {'version': '2.0', 'generator': 'canopy-tag split_skeleton.py'},
    'scene': 0, 'scenes': [{'nodes': [len(out_nodes) - 1]}], 'nodes': out_nodes, 'meshes': out_meshes,
    'materials': [{'name': 'Bone', 'doubleSided': True,
                   'pbrMetallicRoughness': {'baseColorFactor': [0.86, 0.82, 0.66, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}}],
    'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(binary)}],
}
js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<I4s', len(js), b'JSON') + js \
    + struct.pack('<I4s', len(binary), b'BIN\0') + binary
open(DST, 'wb').write(glb)
print(f'wrote {DST}: {total} tris, {len(glb)/1024:.0f} KB')
