# world_heads.py — the carved heads: assets/models/heads.glb
#
#   blender -b -t 4 -P tools/blender/world_heads.py            (about a minute; bakes AO)
#   blender -b -t 4 -P tools/blender/world_heads.py -- --fast  (no AO bake, for looking at shape)
#   ... -- --out /some/where.glb                                (write somewhere else)
#
# An original monument: four invented, stylised stone heads carved out of a cliff. They are
# nobody: an elder with a beard, a crowned one, an aviator in cap and goggles, and a helmed
# guard, the same four the procedural fallback in src/world/landmarks.js draws. No real monument
# and no real person is the model for any of them.
#
# What the game expects, and this keeps (landmarks.js places the file unscaled at the statue's
# ground point): origin on the ground at the middle of the monument, +Y up, faces looking down +Z,
# heads 56 m apart at x = -84, -28, 28, 84, everything inside the fallback's box (x +-135,
# z -59 to 33, top under 165), with a skirt under the ground to y = -40. test/assets.mjs holds the exported file to those numbers.
#
# One mesh, built vertex by vertex in the game's own axes and turned into Blender's at the end.
# Stone takes its colour from a vertex colour (linear, so the loader's sRGB fix-up of the white
# base colour changes nothing, #726); the crown and the helm are flat-coloured like every other
# model here. Three materials, so three draws. No random module: the noise is a hash, and the same
# script writes the same file.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy, bmesh
from mathutils import Matrix, Vector

FAST = '--fast' in sys.argv
C.clear_scene()

# ---------------------------------------------------------------- noise and colour
def _h(i, j, s=0):
    n = (i * 374761393 + j * 668265263 + s * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0

def vnoise(x, y, s=0):
    xi, yi = math.floor(x), math.floor(y)
    fx, fy = x - xi, y - yi
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _h(xi, yi, s), _h(xi + 1, yi, s)
    c, d = _h(xi, yi + 1, s), _h(xi + 1, yi + 1, s)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy

def clamp(v, a=0.0, b=1.0): return a if v < a else b if v > b else v
def smooth(a, b, v):
    t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t)
def gauss(v, c, w): return math.exp(-((v - c) / w) ** 2)
def s2l(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def mul(col, k): return (col[0] * k, col[1] * k, col[2] * k)

CLIFF = (0.60, 0.56, 0.49)     # weathered rock
OCHRE = (0.68, 0.56, 0.41)     # the warm bands in it
FACE = (0.84, 0.81, 0.73)      # fresh-cut stone, paler than the cliff it came out of
HAIR = (0.66, 0.63, 0.56)
CAP = (0.60, 0.50, 0.38)
DARK = (0.10, 0.09, 0.08)
WHITE = (1.0, 1.0, 1.0)

def cliff_col(p):
    x, y, z = p
    band = 0.5 + 0.5 * math.sin(y * 0.30 + 4.0 * vnoise(x * 0.018, y * 0.04, 3))
    warm = smooth(0.62, 0.9, vnoise(x * 0.01 + 7, y * 0.09, 5))
    k = 0.80 + 0.18 * band + 0.08 * vnoise(x * 0.11, y * 0.11, 9)
    k *= 0.86 + 0.14 * smooth(-10, 60, y)                    # darker toward the foot
    c = tuple(CLIFF[i] + (OCHRE[i] - CLIFF[i]) * warm for i in range(3))
    return mul(c, k)

# ---------------------------------------------------------------- the one mesh
bm = bmesh.new()
VC = bm.verts.layers.float_vector.new('vc')        # each vertex's sRGB colour, until the end
LAYER = bm.loops.layers.float_color.new('Col')    # both layers exist before any vertex does
MAT_ROCK, MAT_GOLD, MAT_HELM = 0, 1, 2

def paint(verts, col):
    for v in verts:
        v[VC] = col(tuple(v.co)) if callable(col) else col

def set_mat(verts, mat):
    seen = set()
    for v in verts:
        for f in v.link_faces:
            if f not in seen:
                seen.add(f); f.material_index = mat

def prim(kind, M, col, mat=MAT_ROCK, **kw):
    if kind == 'ico':
        r = bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 2), radius=1.0, matrix=M)
    elif kind == 'box':
        r = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    else:   # cone / cylinder standing on the game's Y axis
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=kw.get('seg', 8),
                                  radius1=kw.get('r1', 1.0), radius2=kw.get('r2', 1.0), depth=1.0,
                                  matrix=M @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    vs = r['verts']
    paint(vs, col if mat == MAT_ROCK else WHITE)
    set_mat(vs, mat)
    return vs

def TRS(loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    m = Matrix.Translation(loc)
    m = m @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z')
    return m @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))

def lumpy(verts, centre, amount, seed):
    c = Vector(centre)
    for v in verts:
        d = v.co - c
        k = 1.0 + amount * (vnoise(v.co.x * 0.13 + seed, v.co.y * 0.13 + v.co.z * 0.17, seed) - 0.5) * 2
        v.co = c + d * k

def quad(a, b, c, d, mat=MAT_ROCK):
    f = bm.faces.new((a, b, c, d)); f.material_index = mat; return f

def tri(a, b, c, mat=MAT_ROCK):
    f = bm.faces.new((a, b, c)); f.material_index = mat; return f

# ---------------------------------------------------------------- the cliff
HEAD_X = [-84.0, -28.0, 28.0, 84.0]
BUTTRESS = [-112.0, -56.0, 0.0, 56.0, 112.0]
NX = 40
FOOT = -40.0     # the skirt goes well under the ground: the hill falls away past the flattened top
XS = [-135.0 + 270.0 * i / NX for i in range(NX + 1)]

def cliff_top(x):
    t = 131 + 13 * math.sin(x * 0.034 + 1.1) + 16 * (vnoise(x * 0.045, 0.5, 21) - 0.5)
    e = smooth(92, 135, abs(x))
    return t + (34 - t) * e * e

def end(x):          # 0 along the monument, 1 at its two ends, where the rock narrows to a spur instead of a slab
    return smooth(96, 135, abs(x)) ** 2

def wall_z(x, y, top):
    butt = max(gauss(x, c, 10.0) for c in BUTTRESS)
    z = -6.0 - 0.06 * (y - 20) + 8.0 * butt * (1 - 0.5 * smooth(70, 130, y))
    z += 5.0 * smooth(96, 108, y)                               # the brow of rock over the heads
    z += 7.0 * (vnoise(x * 0.06, y * 0.07, 11) - 0.5)
    return z + (-22.0 - z) * end(x)

WALL_T = [0.0, 0.13, 0.27, 0.41, 0.55, 0.68, 0.79, 0.90, 1.0]   # share of the way from the ledge to the top
cols = []
for i, x in enumerate(XS):
    top = cliff_top(x)
    jx = 0.0 if i in (0, NX) else 3.0 * (vnoise(x * 0.3, 2.5, 31) - 0.5)
    e = end(x)
    toe = 31.0 - 40.0 * e + 3.0 * (vnoise(x * 0.07, 9.5, 41) - 0.5)
    back = -59.0 + 26.0 * e
    pts = [(x, FOOT, min(33.0, toe + 2.0)), (x + jx, 2.0, toe - 3.0),
           (x + jx, 13.0 + 3.0 * vnoise(x * 0.09, 4.5, 43), 15.0 - 30.0 * e + 4.0 * (vnoise(x * 0.08, 6.5, 47) - 0.5))]
    for t in WALL_T:
        y = 20.0 + (top - 20.0) * t
        jy = 0.0 if t in (0.0, 1.0) else 3.0 * (vnoise(x * 0.21, y * 0.2, 51) - 0.5)
        pts.append((x + jx, y + jy, wall_z(x, y, top)))
    pts.append((x + jx, top + 3.0 * vnoise(x * 0.1, 1.5, 53), -34.0 + 6.0 * e))
    pts.append((x, top - 9.0, back))
    pts.append((x, FOOT, back))
    cols.append([bm.verts.new(p) for p in pts])
cliff_faces = []
for i in range(NX):
    a, b = cols[i], cols[i + 1]
    for j in range(len(a) - 1):
        cliff_faces.append(quad(a[j], a[j + 1], b[j + 1], b[j]))
cliff_faces.append(bm.faces.new(cols[0]))
cliff_faces.append(bm.faces.new(list(reversed(cols[NX]))))
bmesh.ops.recalc_face_normals(bm, faces=cliff_faces)
paint([v for c in cols for v in c], cliff_col)

# crags along the crest and the flanks, boulders at the foot
for k, (x, dy, r, sy) in enumerate([(-112, -6, 13, 2.0), (-74, 2, 11, 1.7), (-40, -2, 15, 1.5), (6, 4, 12, 2.0),
                                    (47, -3, 16, 1.4), (88, 3, 12, 1.9), (114, -8, 14, 1.9)]):
    top = cliff_top(x)
    vs = prim('ico', TRS((x, top + dy - r * 0.2, -30 + 6 * (k % 3 - 1)), (r * 1.25, r * sy * 0.6, r)), cliff_col)
    lumpy(vs, (x, top + dy, -30), 0.22, 60 + k)
    paint(vs, cliff_col)
for k, (x, r) in enumerate([(-113, 8), (-98, 6), (-58, 7), (-49, 4.5), (-3, 6.5), (9, 4), (53, 7.5), (66, 4), (100, 6), (114, 8)]):
    z = 24 - 30 * end(x) + 3 * (k % 2)
    vs = prim('ico', TRS((x, 3.5, z), (r * 1.3, r * 0.8, r)), cliff_col, sub=1)
    lumpy(vs, (x, 3.5, z), 0.2, 80 + k)
    paint(vs, cliff_col)

# ---------------------------------------------------------------- a head
def keyed(table, h):
    for (h0, v0), (h1, v1) in zip(table, table[1:]):
        if h <= h0 and h >= h1:
            t = (h0 - h) / (h0 - h1) if h0 != h1 else 0.0
            t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return table[-1][1] if h < table[-1][0] else table[0][1]

ROWS = [1.0, 0.94, 0.86, 0.77, 0.69, 0.64, 0.595, 0.55, 0.505, 0.45, 0.385, 0.325, 0.288, 0.255, 0.218,
        0.15, 0.07, 0.0, -0.06, -0.14, -0.30]
PHIS = [-125, -100, -80, -62, -47, -35, -25, -16, -8, 0, 8, 16, 25, 35, 47, 62, 80, 100, 125]

def head(cx, P):
    W, Hh, D = P['W'], P['H'], P['D']
    chin_y, cz, yaw = P['y'], P.get('z', 3.0), math.radians(P.get('yaw', 0.0))
    jaw, chin = P.get('jaw', 1.0), P.get('chin', 1.0)
    HW = [(1.0, 0.36), (0.94, 0.62), (0.86, 0.83), (0.77, 0.95), (0.69, 0.99), (0.60, 1.0), (0.45, 0.97),
          (0.32, 0.90 * (0.5 + 0.5 * jaw)), (0.20, 0.80 * jaw), (0.10, 0.66 * jaw), (0.03, 0.47 * chin),
          (0.0, 0.38 * chin), (-0.06, 0.47), (-0.14, 0.52), (-0.30, 0.66)]
    DD = [(1.0, 0.40), (0.94, 0.66), (0.86, 0.84), (0.77, 0.94), (0.69, 0.99), (0.60, 1.0), (0.45, 1.0),
          (0.32, 0.98), (0.20, 0.94), (0.10, 0.87), (0.03, 0.74), (0.0, 0.56), (-0.06, 0.36), (-0.14, 0.34), (-0.30, 0.44)]
    frame = Matrix.Translation((cx, chin_y, cz)) @ Matrix.Rotation(yaw, 4, 'Y')
    eye_h, eye_x, mouth_h, mouth_w = P.get('eye_h', 0.55), P.get('eye_x', 0.40), P.get('mouth_h', 0.255), P.get('mouth_w', 0.36)

    def sockets(xn, h):
        return gauss(h, eye_h, 0.05) * (gauss(xn, eye_x, 0.19) + gauss(xn, -eye_x, 0.19))
    def groove(xn, h):
        return gauss(h, mouth_h, 0.02) * math.exp(-(xn / mouth_w) ** 4)
    def relief(xn, h):
        f = P.get('brow', 0.10) * gauss(h, eye_h + 0.085, 0.045) * math.exp(-(xn / 0.78) ** 6)
        f -= P.get('socket', 0.17) * sockets(xn, h)
        f += 0.07 * gauss(h, 0.43, 0.07) * gauss(abs(xn), 0.56, 0.22)                      # cheekbones
        f += 0.05 * gauss(xn, 0, 0.15) * smooth(0.36, 0.42, h) * (1 - smooth(0.58, 0.64, h))  # root of the nose
        f += 0.06 * gauss(h, mouth_h + 0.01, 0.10) * gauss(xn, 0, 0.42)                     # muzzle
        f -= 0.08 * groove(xn, h)
        f += 0.05 * (gauss(h, mouth_h + 0.033, 0.024) + gauss(h, mouth_h - 0.037, 0.03)) * math.exp(-(xn / (mouth_w + 0.02)) ** 4)
        f += P.get('chin_out', 0.08) * gauss(h, 0.08, 0.07) * gauss(xn, 0, 0.3)
        f -= P.get('hollow', 0.0) * gauss(h, 0.30, 0.08) * gauss(abs(xn), 0.62, 0.2)        # hollow cheeks
        return f
    def local(h, phi):
        hw, dd = keyed(HW, h), keyed(DD, h)
        s, c = math.sin(phi), math.cos(phi)
        xn = hw * s
        z = dd * D * c
        if c > 0: z += D * relief(xn, h) * math.sqrt(c)
        return Vector((W * xn, Hh * h, z)), xn
    def surf(xn, h, out=0.0):
        hw = keyed(HW, h)
        p, _ = local(h, math.asin(clamp(xn / hw, -0.999, 0.999)))
        p.z += out * D
        return p
    def face_col(xn, h, front):
        k = 0.84 + 0.16 * clamp(h) + 0.05 * (vnoise(xn * 5 + cx, h * 9, 71) - 0.5)
        if front: k *= 1 - 0.50 * clamp(sockets(xn, h)) - 0.55 * clamp(groove(xn, h))
        return mul(FACE, k)

    grid = []
    for h in ROWS:
        row = []
        for d in PHIS:
            p, xn = local(h, math.radians(d))
            v = bm.verts.new(frame @ p)
            v[VC] = face_col(xn, h, abs(d) < 90)
            row.append(v)
        grid.append(row)
    for j in range(len(ROWS) - 1):
        for i in range(len(PHIS) - 1):
            quad(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1])
    pole = bm.verts.new(frame @ Vector((0, Hh * 1.03, 0))); pole[VC] = mul(FACE, 1.0)
    for i in range(len(PHIS) - 1):
        tri(pole, grid[0][i], grid[0][i + 1])

    def lv(p, col=None):
        v = bm.verts.new(frame @ Vector(p)); v[VC] = col or mul(FACE, 0.96); return v
    def lprim(kind, loc, scale, col, mat=MAT_ROCK, rot=(0, 0, 0), **kw):
        return prim(kind, frame @ TRS(loc, scale, rot), col, mat, **kw)

    # nose: a ridge from the bridge to the tip, with a break in it for the hooked ones
    n_top, n_tip, n_len, n_w = eye_h + 0.045, P.get('nose_h', 0.385), P.get('nose', 0.30), P.get('nose_w', 0.17)
    B = lv(surf(0, n_top, 0.015))
    midh = n_top + (n_tip - n_top) * 0.5
    Mid = lv(surf(0, midh, n_len * P.get('hook', 0.5)))
    T = lv(surf(0, n_tip, n_len), mul(FACE, 1.0))
    U = lv(surf(0, n_tip - 0.035, -0.02), mul(FACE, 0.6))
    side = {}
    for s in (-1, 1):
        side[s] = (lv(surf(s * 0.07, n_top, -0.03)), lv(surf(s * n_w * 0.7, midh, -0.03)),
                   lv(surf(s * n_w, n_tip + 0.01, -0.03), mul(FACE, 0.8)))
    L, R = side[-1], side[1]
    quad(B, Mid, R[1], R[0]); quad(Mid, T, R[2], R[1]); tri(T, U, R[2])
    quad(B, L[0], L[1], Mid); quad(Mid, L[1], L[2], T); tri(T, L[2], U)

    # eyes: blank stone, set back in the sockets under the brow
    for s in (-1, 1):
        p = surf(s * eye_x, eye_h - 0.005, -0.015)
        lprim('ico', p, (0.17 * W, 0.038 * Hh, 0.07 * D), mul(FACE, 1.02), sub=1)
        p = surf(s * eye_x, eye_h + 0.036, 0.02)
        lprim('box', p, (0.36 * W, 0.022 * Hh, 0.12 * D), mul(FACE, 0.9), rot=(0, 0, -s * P.get('lid', 0.0)))
    return dict(frame=frame, W=W, H=Hh, D=D, surf=surf, lprim=lprim, lv=lv, keyed=lambda h: keyed(HW, h))

def ears(Hd, h=0.50):
    for s in (-1, 1):
        Hd['lprim']('ico', (s * Hd['W'] * Hd['keyed'](h) * 1.0, h * Hd['H'], -0.12 * Hd['D']),
                    (0.11 * Hd['W'], 0.085 * Hd['H'], 0.20 * Hd['D']), mul(FACE, 0.92), sub=1)

# 1. the elder: long narrow face, hooked nose, hair swept back, a beard down to the ledge
Hd = head(HEAD_X[0], dict(W=21.5, H=68, D=22, y=25, yaw=-9, jaw=0.86, chin=0.9, brow=0.13, socket=0.19, hollow=0.06,
                          nose=0.34, hook=0.72, nose_w=0.15, mouth_w=0.30, lid=0.12))
W, Hh, D, lp = Hd['W'], Hd['H'], Hd['D'], Hd['lprim']
ears(Hd)
vs = lp('ico', (0, 0.80 * Hh, -0.22 * D), (1.10 * W, 0.30 * Hh, 1.08 * D), mul(HAIR, 1.0), rot=(-0.30, 0, 0))
for s in (-1, 1):   # hair falling behind the ears
    lp('box', (s * 0.98 * W, 0.42 * Hh, -0.55 * D), (0.34 * W, 0.80 * Hh, 0.7 * D), mul(HAIR, 0.92), rot=(0, 0, s * 0.06))
    lp('box', (s * 0.20 * W, 0.305 * Hh, 0.99 * D), (0.36 * W, 0.035 * Hh, 0.12 * D), mul(HAIR, 1.05), rot=(0, 0, -s * 0.30))   # moustache
lp('cone', (0, -0.10 * Hh, 0.52 * D), (0.60 * W, 0.50 * Hh, 0.40 * D), mul(HAIR, 1.0), seg=6, r1=0.22, r2=1.0)   # beard
lp('cone', (0, 0.17 * Hh, 0.60 * D), (0.66 * W, 0.12 * Hh, 0.42 * D), mul(HAIR, 1.04), seg=6, r1=0.92, r2=0.80)

# 2. the crowned one: broad, level brow, long hair, a gold circlet with five points
Hd = head(HEAD_X[1], dict(W=24.5, H=64, D=22, y=28, yaw=-3, jaw=1.0, chin=1.05, brow=0.08, socket=0.15,
                          nose=0.26, hook=0.45, nose_w=0.19, mouth_w=0.40, chin_out=0.06))
W, Hh, D, lp = Hd['W'], Hd['H'], Hd['D'], Hd['lprim']
vs = lp('ico', (0, 0.84 * Hh, -0.15 * D), (1.07 * W, 0.26 * Hh, 1.04 * D), mul(HAIR, 0.98))
for s in (-1, 1):
    lp('box', (s * 1.0 * W, 0.34 * Hh, -0.25 * D), (0.36 * W, 0.98 * Hh, 1.0 * D), mul(HAIR, 0.92), rot=(0, 0, -s * 0.07))
lp('cone', (0, 0.865 * Hh, -0.02 * D), (1.0 * W, 0.11 * Hh, 1.0 * D), WHITE, MAT_GOLD, seg=10, r1=1.0, r2=1.08)
for k in range(5):
    a = math.radians(-64 + 32 * k)
    lp('cone', (1.02 * W * math.sin(a), 0.98 * Hh, -0.02 * D + 1.02 * D * math.cos(a)), (0.15 * W, 0.16 * Hh, 0.15 * W),
       WHITE, MAT_GOLD, seg=4, r1=1.0, r2=0.02, rot=(0, a + math.pi / 4, 0))

# 3. the aviator: round face, snub nose, flying cap with ear flaps, goggles pushed up, a scarf
Hd = head(HEAD_X[2], dict(W=24, H=61, D=22, y=24, yaw=4, jaw=1.12, chin=1.25, brow=0.07, socket=0.14,
                          nose=0.22, hook=0.30, nose_w=0.20, mouth_w=0.42, chin_out=0.05, eye_h=0.54))
W, Hh, D, lp = Hd['W'], Hd['H'], Hd['D'], Hd['lprim']
lp('ico', (0, 0.76 * Hh, -0.10 * D), (1.09 * W, 0.34 * Hh, 1.10 * D), mul(CAP, 1.0))
for s in (-1, 1):
    lp('box', (s * 0.99 * W, 0.40 * Hh, -0.10 * D), (0.22 * W, 0.62 * Hh, 0.95 * D), mul(CAP, 0.9), rot=(0, 0, -s * 0.05))
    p = Hd['surf'](s * 0.36, 0.80, 0.07)
    lp('cone', p, (0.25 * W, 0.20 * D, 0.25 * W), WHITE, MAT_GOLD, seg=8, rot=(math.pi / 2 - 0.35, 0, 0))
    lp('cone', (p.x, p.y + 0.035 * D, p.z + 0.10 * D), (0.18 * W, 0.06 * D, 0.18 * W), DARK, seg=8, rot=(math.pi / 2 - 0.35, 0, 0))
lp('box', (0, 0.80 * Hh, 0.02 * D), (2.10 * W, 0.06 * Hh, 1.9 * D), mul(CAP, 0.7))    # goggle strap
lp('cone', (0, -0.14 * Hh, 0.02 * D), (0.86 * W, 0.20 * Hh, 0.70 * D), mul(HAIR, 1.12), seg=8, r1=1.0, r2=0.82)   # scarf

# 4. the guard: square jaw, heavy brow, a crested helm with a nose bar and cheek plates
Hd = head(HEAD_X[3], dict(W=23, H=66, D=22, y=26, yaw=9, jaw=1.14, chin=1.2, brow=0.14, socket=0.20,
                          nose=0.28, hook=0.55, nose_w=0.18, mouth_w=0.33, chin_out=0.11, lid=-0.14))
W, Hh, D, lp = Hd['W'], Hd['H'], Hd['D'], Hd['lprim']
lp('ico', (0, 0.80 * Hh, -0.06 * D), (1.10 * W, 0.34 * Hh, 1.12 * D), WHITE, MAT_HELM)
lp('cone', (0, 0.70 * Hh, -0.04 * D), (1.13 * W, 0.07 * Hh, 1.15 * D), WHITE, MAT_HELM, seg=10)        # rim
lp('box', (0, 1.10 * Hh, -0.25 * D), (0.12 * W, 0.26 * Hh, 1.7 * D), WHITE, MAT_HELM, rot=(-0.12, 0, 0))  # crest
p = Hd['surf'](0, 0.56, 0.20)
lp('box', (0, 0.56 * Hh, p.z), (0.13 * W, 0.30 * Hh, 0.10 * D), WHITE, MAT_HELM, rot=(0.20, 0, 0))     # nose bar
for s in (-1, 1):
    lp('box', (s * 0.97 * W, 0.44 * Hh, 0.05 * D), (0.16 * W, 0.50 * Hh, 0.95 * D), WHITE, MAT_HELM, rot=(0, 0, -s * 0.06))

# ---------------------------------------------------------------- colour, axes, materials
bm.normal_update()
for f in bm.faces:
    c0 = f.calc_center_median()
    k = 0.97 + 0.06 * _h(int(c0.x * 7.0), int(c0.y * 7.0 + c0.z * 13.0), 91)   # each facet a shade of its own
    for lo in f.loops:
        c = lo.vert[VC]
        if f.material_index != MAT_ROCK: lo[LAYER] = (1, 1, 1, 1)
        else: lo[LAYER] = (s2l(clamp(c[0] * k)), s2l(clamp(c[1] * k)), s2l(clamp(c[2] * k)), 1.0)
for v in bm.verts:   # nothing leaves the fallback's box, whatever the lumps did
    v.co.x, v.co.y, v.co.z = clamp(v.co.x, -135.0, 135.0), min(v.co.y, 160.0), clamp(v.co.z, -59.0, 33.0)
# the game's (x, up, toward the viewer) to Blender's (x, -depth, up): a quarter turn about X
bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi / 2, 4, 'X'), verts=bm.verts)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
bm.normal_update()
bm.verts.layers.float_vector.remove(VC)

mesh = bpy.data.meshes.new('heads')
bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new('heads', mesh)
bpy.context.collection.objects.link(obj)
mesh.color_attributes.active_color = mesh.color_attributes['Col']
mesh.color_attributes.render_color_index = 0

rock = C.mat('Heads_Rock', (1.0, 1.0, 1.0), rough=0.9)
nt = rock.node_tree
attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
mesh.materials.append(rock)
mesh.materials.append(C.mat('Heads_Gold', (0.82, 0.68, 0.22), rough=0.4, metal=0.5))
mesh.materials.append(C.mat('Heads_Helm', (0.36, 0.42, 0.48), rough=0.4, metal=0.4))
C.shade_flat(obj)

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
print('TRIS pre-bake', tris)
if not FAST:
    C.setup_ao_bake_and_wire(obj, size=1024, samples=20)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'heads.glb'))
if '--out' in sys.argv: out = os.path.abspath(sys.argv[sys.argv.index('--out') + 1])
C.export_glb(out, objects=[obj], export_vertex_color='MATERIAL')
C.report_size(out)
print('TRIS', tris)
