"""Plants kit (added in batch 3): trees for wide views, seen far off.
Coconut palm, thorn tree (acacia), baobab, and low scrub. Low detail,
seeded, built to read as silhouettes and masses at a distance."""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix

import common as C
import kit_props as P


def _trunk(name, pts, r0, r1, mat, seg=10):
    """A tapering trunk along a list of points."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = r0 + (r1 - r0) * i / (len(pts) - 1)
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 2
    ob = bpy.data.objects.new(name, cu)
    C.link(ob)
    ob.data.materials.append(C.M(mat) if isinstance(mat, str) else mat)
    return ob


def _frond(name, base, direction, length, droop, width, mat, salt):
    """One palm frond: a drooping strip with leaflets suggested by a
    jagged edge, as a thin mesh."""
    r = C.rng(salt)
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    verts, faces = [], []
    n = 14
    for i in range(n + 1):
        t = i / n
        p = Vector(base) + d * length * t + Vector((0, 0, -droop * length * t * t))
        w = width * math.sin(math.pi * min(1, t * 1.15)) * (0.6 + 0.4 * r.random())
        # leaflets hang down from the midrib: the strip folds into a V
        verts += [p - side * w + Vector((0, 0, -w * 0.5)), p, p + side * w + Vector((0, 0, -w * 0.5))]
    for i in range(n):
        a = i * 3
        faces += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
    return C.mesh_object(name, verts, faces, mat, True)


def coconut_palm(name="Palm", height=14.0, lean=(0.25, 0.0), bend=0.15, salt=0, wind=(0.0, 0.0)):
    """A tall coconut palm: slender curving trunk, crown of drooping
    fronds. wind=(dx, dy) sweeps the fronds downwind."""
    r = C.rng(salt)
    pts = []
    for i in range(9):
        t = i / 8
        pts.append((lean[0] * height * t + bend * height * t * t * (1 if lean[0] >= 0 else -1),
                    lean[1] * height * t, height * t))
    parts = [_trunk(name + "_trunk", pts, 0.22, 0.14, C.M("bark", colour=(0.36, 0.32, 0.27)))]
    top = Vector(pts[-1])
    fol = C.M("foliage", colour=(0.10, 0.17, 0.05))
    for k in range(22):
        a = 2 * math.pi * k / 22 + r.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), r.uniform(0.1, 0.6)))
        d.x += wind[0]
        d.y += wind[1]
        parts.append(_frond("%s_fr%d" % (name, k), top, d, r.uniform(4.0, 5.5), r.uniform(0.3, 0.7),
                            1.0, fol, salt * 31 + k))
    return P.group(name, parts)


def _canopy(name, center, rx, ry, h, mat, salt, lumps=0.35, flat=True):
    """A canopy mass: a flattened lumpy blob."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    ob = C.from_bmesh(name, bm, mat, True)
    ob.scale = (rx, ry, h)
    ob.location = center
    tex = bpy.data.textures.new(name + "_n", "CLOUDS")
    tex.noise_scale = 0.35
    dm = ob.modifiers.new("Lumps", "DISPLACE")
    dm.texture = tex
    dm.strength = lumps
    dm.texture_coords = "OBJECT"
    return ob


def thorn_tree(name="Acacia", height=6.0, spread=7.0, salt=0):
    """Flat-topped thorn tree: a short forked trunk under a wide, thin,
    flat canopy broken into a few masses."""
    r = C.rng(salt)
    bark = C.M("bark", colour=(0.25, 0.20, 0.16))
    fol = C.M("foliage", colour=(0.07, 0.085, 0.035))
    parts = []
    for k in range(3):
        a = 2 * math.pi * k / 3 + r.uniform(-0.4, 0.4)
        tip = (math.cos(a) * spread * 0.3, math.sin(a) * spread * 0.3, height * 0.88)
        parts.append(_trunk("%s_br%d" % (name, k), [(0, 0, 0), (0.1, 0, height * 0.4), tip], 0.22, 0.07, bark))
    for k in range(4):
        a = r.uniform(0, 6.28)
        d = r.uniform(0, spread * 0.25)
        parts.append(_canopy("%s_c%d" % (name, k), (math.cos(a) * d, math.sin(a) * d, height * r.uniform(0.88, 1.0)),
                             spread * r.uniform(0.28, 0.4), spread * r.uniform(0.28, 0.4), height * 0.08,
                             fol, salt * 7 + k, lumps=0.5))
    return P.group(name, parts)


def baobab(name="Baobab", height=16.0, girth=3.2, salt=0):
    """Great thick-trunked tree: a swollen barrel trunk and short crooked
    branches, sparse leaves in the dry season."""
    r = C.rng(salt)
    bark = C.M("bark", colour=(0.42, 0.36, 0.31))
    prof = [(0, 0), (girth * 0.55, 0), (girth * 0.6, height * 0.1), (girth * 0.58, height * 0.35),
            (girth * 0.48, height * 0.6), (girth * 0.32, height * 0.72), (0, height * 0.74)]
    parts = [C.lathe(name + "_trunk", prof, 32, bark, True, jitter=0.08, salt=salt)]
    fol = C.M("foliage", colour=(0.07, 0.085, 0.035))
    for k in range(7):
        a = 2 * math.pi * k / 7 + r.uniform(-0.3, 0.3)
        L = r.uniform(3.5, 5.5)
        base = (math.cos(a) * girth * 0.25, math.sin(a) * girth * 0.25, height * 0.7)
        mid = (base[0] + math.cos(a) * L * 0.5, base[1] + math.sin(a) * L * 0.5, base[2] + L * 0.35)
        tip = (base[0] + math.cos(a) * L, base[1] + math.sin(a) * L, base[2] + L * 0.45 + r.uniform(0, 1.5))
        parts.append(_trunk("%s_b%d" % (name, k), [base, mid, tip], 0.55, 0.12, bark))
        parts.append(_canopy("%s_l%d" % (name, k), tip, 1.6, 1.6, 0.9, fol, salt * 11 + k, lumps=0.8))
    return P.group(name, parts)


def scrub(name="Scrub", r=1.2, h=0.8, salt=0, colour=(0.20, 0.20, 0.10)):
    return _canopy(name, (0, 0, h * 0.4), r, r * 0.9, h, C.M("foliage", colour=colour), salt, lumps=0.6)


# --------------------------------------------------------------------------
# rework round: finer palms, and trees dressed with scanned foliage
# --------------------------------------------------------------------------
def _frond_fine(name, base, direction, length, droop, mat, salt, leaflets=34):
    """A pinnate palm frond: a curving midrib with narrow leaflets hanging
    off both sides, each a thin twisted strip. Built as one mesh."""
    r = C.rng(salt)
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    verts, faces = [], []
    n = 20
    rib = []
    for i in range(n + 1):
        t = i / n
        rib.append(Vector(base) + d * length * t + Vector((0, 0, length * (0.18 * t - droop * t * t))))
    # midrib as a thin strip
    for i, p in enumerate(rib):
        w = 0.035 * (1 - i / n) + 0.008
        verts += [tuple(p - side * w), tuple(p + side * w)]
        if i:
            a = 2 * (i - 1)
            faces.append((a, a + 2, a + 3, a + 1))
    for k in range(leaflets):
        t = 0.08 + 0.9 * k / leaflets
        i = int(t * n)
        p = rib[i]
        L = length * 0.32 * math.sin(math.pi * min(1.0, t * 1.05)) * r.uniform(0.85, 1.1)
        for sgn in (-1, 1):
            out = side * sgn
            # leaflets droop and sweep forward a little, ragged and uneven
            tip = p + out * L * 0.75 + d * L * 0.35 + Vector((0, 0, -L * r.uniform(0.35, 0.7)))
            mid = p + out * L * 0.42 + d * L * 0.15 + Vector((0, 0, -L * 0.1))
            wv = d * 0.03
            o = len(verts)
            verts += [tuple(p - wv), tuple(p + wv), tuple(mid + wv * 0.8), tuple(mid - wv * 0.8), tuple(tip)]
            faces += [(o, o + 1, o + 2, o + 3), (o + 3, o + 2, o + 4)]
    ob = C.mesh_object(name, verts, faces, mat, True)
    return ob


def coconut_palm_fine(name="Palm", height=14.0, lean=(0.25, 0.0), bend=0.15, salt=0, wind=(0.0, 0.0), fronds=22):
    """A tall coconut palm with a ringed, curving trunk, a crown of fine
    pinnate fronds (some green, some dead and hanging), a few nuts."""
    r = C.rng(salt)
    pts = []
    for i in range(13):
        t = i / 12
        pts.append((lean[0] * height * t + bend * height * t * t * (1 if lean[0] >= 0 else -1),
                    lean[1] * height * t + bend * height * t * t * (1 if lean[1] >= 0 else -1) * 0.5, height * t))
    trunk = _trunk(name + "_trunk", pts, 0.24, 0.15, C.M("bark", colour=(0.42, 0.37, 0.31)))
    parts = [trunk]
    top = Vector(pts[-1])
    green = C.M("foliage", colour=(0.10, 0.16, 0.05))
    dead = C.M("foliage", colour=(0.36, 0.28, 0.16))
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + r.uniform(-0.15, 0.15)
        up = r.uniform(-0.2, 0.7)
        isdead = r.random() < 0.15
        d = Vector((math.cos(a), math.sin(a), -0.9 if isdead else up))
        d.x += wind[0] * (0.6 if not isdead else 0.3)
        d.y += wind[1] * (0.6 if not isdead else 0.3)
        parts.append(_frond_fine("%s_fr%d" % (name, k), top, d, r.uniform(4.2, 5.6),
                                 0.15 if isdead else r.uniform(0.25, 0.55), dead if isdead else green, salt * 31 + k))
    nut = C.M("bark", colour=(0.30, 0.24, 0.12))
    for k in range(6):
        a = r.uniform(0, 6.28)
        b_ = C.lathe("%s_nut%d" % (name, k), [(0, 0), (0.12, 0.05), (0.14, 0.15), (0.1, 0.27), (0, 0.3)], 10, nut)
        b_.location = (top.x + math.cos(a) * 0.25, top.y + math.sin(a) * 0.25, top.z - 0.6)
        parts.append(b_)
    return P.group(name, parts)


def scan_tree(name, scan, height, spread, salt, trunk_col=(0.28, 0.22, 0.17), clumps=7, flat=0.35, forks=3):
    """A tree whose foliage is made of scanned shrub instances (real leaf
    textures and silhouettes): a forked trunk carries clumps of the scan,
    flattened into an umbrella (thorn tree) or rounded (flat ~1)."""
    import kit_models as KM
    r = C.rng(salt)
    bark = C.M("bark", colour=trunk_col)
    parts = []
    sz = KM.size(scan)
    base_h = max(sz.z, 0.3)
    base_w = max(sz.x, sz.y, 0.3)
    tips = []
    for k in range(forks):
        a = 2 * math.pi * k / forks + r.uniform(-0.4, 0.4)
        lean = spread * r.uniform(0.2, 0.32)
        mid = (math.cos(a) * lean * 0.35, math.sin(a) * lean * 0.35, height * r.uniform(0.35, 0.5))
        tip = (math.cos(a) * lean, math.sin(a) * lean, height * r.uniform(0.75, 0.85))
        parts.append(_trunk("%s_br%d" % (name, k), [(0, 0, 0), mid, tip], 0.07 * height ** 0.6, 0.02 * height ** 0.6, bark))
        tips.append(tip)
    em = P.group(name, parts)
    for k in range(clumps):
        t = tips[k % len(tips)]
        a = r.uniform(0, 6.28)
        dd = r.uniform(0, spread * 0.2)
        cw = spread * r.uniform(0.6, 0.85)
        sc = cw / base_w
        inst = KM.place(scan, (t[0] + math.cos(a) * dd, t[1] + math.sin(a) * dd, t[2] - base_h * sc * flat * 0.3),
                        r.uniform(0, 6.28), (sc, sc, sc * flat), name="%s_cl%d" % (name, k))
        inst.parent = em
    return em


def baobab_fine(name="Baobab", height=17.0, girth=3.8, salt=0, scan="searsia_burchellii"):
    """Great baobab: a swollen, fluted barrel trunk of smooth grey bark, a
    crown of thick crooked branches, sparse foliage from a scanned shrub."""
    import kit_models as KM
    r = C.rng(salt)
    bark = C.M("bark", colour=(0.30, 0.26, 0.22))
    prof = [(0, 0), (girth * 0.62, 0), (girth * 0.66, height * 0.06), (girth * 0.6, height * 0.25),
            (girth * 0.55, height * 0.45), (girth * 0.46, height * 0.6), (girth * 0.3, height * 0.7), (0, height * 0.72)]
    tr = C.lathe(name + "_trunk", prof, 48, bark, True, jitter=0.06, salt=salt)
    for v in tr.data.vertices:                     # vertical fluting
        a = math.atan2(v.co.y, v.co.x)
        k = 1.0 + 0.05 * math.sin(a * 11 + salt)
        v.co.x *= k
        v.co.y *= k
    C.subsurf(tr, 1)
    parts = [tr]
    tips = []
    for k in range(9):
        a = 2 * math.pi * k / 9 + r.uniform(-0.3, 0.3)
        L = r.uniform(3.0, 5.5)
        b0 = (math.cos(a) * girth * 0.22, math.sin(a) * girth * 0.22, height * 0.68)
        m1 = (b0[0] + math.cos(a) * L * 0.45, b0[1] + math.sin(a) * L * 0.45, b0[2] + L * 0.5)
        m2 = (m1[0] + math.cos(a + 0.5) * L * 0.3, m1[1] + math.sin(a + 0.5) * L * 0.3, m1[2] + L * 0.25)
        tip = (b0[0] + math.cos(a) * L, b0[1] + math.sin(a) * L, b0[2] + L * 0.6 + r.uniform(0, 1.2))
        parts.append(_trunk("%s_b%d" % (name, k), [b0, m1, tip], 0.62, 0.12, bark))
        parts.append(_trunk("%s_s%d" % (name, k), [m1, m2], 0.25, 0.06, bark))
        tips += [tip, m2]
    em = P.group(name, parts)
    sz = KM.size(scan)
    bw = max(sz.x, sz.y, 0.3)
    for k, t in enumerate(tips):
        if r.random() < 0.6:
            sc = r.uniform(4.0, 6.0) / bw
            inst = KM.place(scan, t, r.uniform(0, 6.28), (sc, sc, sc * 0.7), name="%s_lf%d" % (name, k))
            inst.parent = em
    return em
