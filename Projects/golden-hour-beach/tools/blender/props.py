# Golden Hour's beach prop pack, built from code into assets/models/props/.
#
#   blender -b --factory-startup -P tools/blender/props.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class and
# reference entry, and `node tools/blender/validate.mjs` checks what this
# writes (BACKLOG.md "Golden Hour: Blender assets" B5).
#
# The pack is pieces, not assemblies (#665). js/props.js, js/pier.js and the
# rest loop over field.js's LAYOUT and put one primitive on the ground per
# entry, each at its own groundHeight or pierDeckY; field.js stays the author
# of where every piece stands and how tall it is. So each item here is one
# piece, built at a reference entry's size (budget.json's `ref`), and the
# wiring row (B6) scales it by entry / ref where the builder had the entry's
# own numbers. Repeated pieces come in variants, each from its own seed (#666).
#
# The builders are ported in three's frame (x across, y up, z along), which is
# where roughen() lives: it is a function of position, so a piece has to be
# roughened where the builder roughened it. Geo holds a piece in that frame
# and hands it to Blender at the end, turned (x, y, z) -> (x, -z, y), which the
# exporter turns back.

import json
import math
import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

SEED = 0x9E_AC  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)
PALETTE = BUDGET['palette']
TAU = 2 * math.pi


def col(name):
    return int(PALETTE[name], 16)


def ref(item):
    return BUDGET['items'][item]['ref']


# ---------------------------------------------------------------- three's frame

def rough(amount, seed):
    """js/props.js's roughen(), exactly, as a function of one point: pushed
    out along its own direction by a smooth function of where it is, so two
    vertices at one point move together and no seam opens."""
    s = ((seed & 0xFFFFFFFF) % 1000) * 0.017

    def push(x, y, z):
        n = math.sin(x * 1.7 + s) * math.sin(y * 2.3 - s * 1.6) * math.sin(z * 1.9 + s * 2.4)
        k = 1 + n * amount
        return x * k, y * k, z * k
    return push


class Geo:
    """Vertices and faces in three's frame. A face is (vertex ids, material
    slot, smooth). Nothing is written to Blender until to_bm()."""

    def __init__(self):
        self.v = []
        self.f = []

    def add(self, x, y, z):
        self.v.append([x, y, z])
        return len(self.v) - 1

    def face(self, ids, smooth=True, slot=0, uvs=None):
        self.f.append((list(ids), slot, smooth, uvs))

    def merge(self, other):
        n = len(self.v)
        self.v += [p[:] for p in other.v]
        self.f += [([i + n for i in ids], s, sm, uv) for ids, s, sm, uv in other.f]
        return self

    def each(self, fn):
        self.v = [list(fn(*p)) for p in self.v]
        return self

    def scale(self, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        return self.each(lambda x, y, z: (x * sx, y * sy, z * sz))

    def translate(self, dx, dy, dz):
        return self.each(lambda x, y, z: (x + dx, y + dy, z + dz))

    def rotate_x(self, a):
        c, s = math.cos(a), math.sin(a)
        return self.each(lambda x, y, z: (x, y * c - z * s, y * s + z * c))

    def rotate_y(self, a):
        c, s = math.cos(a), math.sin(a)
        return self.each(lambda x, y, z: (x * c + z * s, y, -x * s + z * c))

    def rotate_z(self, a):
        c, s = math.cos(a), math.sin(a)
        return self.each(lambda x, y, z: (x * c - y * s, x * s + y * c, z))

    def roughen(self, amount, seed):
        return self.each(rough(amount, seed))

    def paint(self, slot):
        self.f = [(ids, slot, sm, uv) for ids, _, sm, uv in self.f]
        return self

    def to_bm(self, closed=True):
        bm = bmesh.new()
        vs = [bm.verts.new((x, -z, y)) for x, y, z in self.v]
        uv_layer = None
        made = []
        for ids, slot, smooth, uvs in self.f:
            f = bm.faces.new([vs[i] for i in ids])
            f.material_index = slot
            f.smooth = smooth
            if uvs:
                uv_layer = uv_layer or bm.loops.layers.uv.new('UVMap')
                for loop, c in zip(f.loops, uvs):
                    loop[uv_layer].uv = c
            made.append(f)
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=made)
        return bm


def cylinder(rt, rb, h, seg, hseg=1, caps=True):
    """three's CylinderGeometry: radius rt at the top (+y), rb at the bottom,
    centred on the origin, with its seam welded. Returns the rings too, top
    first, so a piece can break or weather an end. Sides smooth, caps flat."""
    g = Geo()
    rings = []
    for iy in range(hseg + 1):
        v = iy / hseg
        r = v * (rb - rt) + rt
        y = -v * h + h / 2
        rings.append([g.add(r * math.sin(TAU * j / seg), y, r * math.cos(TAU * j / seg))
                      for j in range(seg)])
    for iy in range(hseg):
        a, b = rings[iy], rings[iy + 1]
        for j in range(seg):
            k = (j + 1) % seg
            g.face([a[j], b[j], b[k], a[k]])
    if caps:
        g.face(rings[0], smooth=False)
        g.face(rings[-1][::-1], smooth=False)
    return g, rings


def cone(r, h, seg):
    """three's ConeGeometry: a base ring at -h/2 and an apex at +h/2."""
    g = Geo()
    ring = [g.add(r * math.sin(TAU * j / seg), -h / 2, r * math.cos(TAU * j / seg))
            for j in range(seg)]
    apex = g.add(0, h / 2, 0)
    for j in range(seg):
        g.face([ring[j], ring[(j + 1) % seg], apex])
    g.face(ring[::-1], smooth=False)
    return g


def sphere(r, wseg, hseg, theta_len=math.pi):
    """three's SphereGeometry with its poles welded to one vertex each. Short
    of a full theta it stops at an open rim (the wrack's shell)."""
    g = Geo()
    top = g.add(0, r, 0)
    closed = theta_len >= math.pi - 1e-9
    rows = []
    last = hseg - 1 if closed else hseg
    for iy in range(1, last + 1):
        th = theta_len * iy / hseg
        rows.append([g.add(-r * math.cos(TAU * j / wseg) * math.sin(th), r * math.cos(th),
                           r * math.sin(TAU * j / wseg) * math.sin(th)) for j in range(wseg)])
    for j in range(wseg):
        g.face([top, rows[0][(j + 1) % wseg], rows[0][j]])
    for a, b in zip(rows, rows[1:]):
        for j in range(wseg):
            k = (j + 1) % wseg
            g.face([a[j], a[k], b[k], b[j]])
    if closed:
        bottom = g.add(0, -r, 0)
        for j in range(wseg):
            g.face([rows[-1][j], rows[-1][(j + 1) % wseg], bottom])
    return g


def box(w, h, d, nx=1, ny=1, nz=1, smooth=False, corners=None):
    """three's BoxGeometry, subdivided, with every lattice point shared
    between the faces that meet there. corners(x, y, z) -> (x, y, z) moves the
    eight corners and the lattice follows them, which is roughen() as a
    builder applied it to an undivided box (the wrack's weed)."""
    g = Geo()
    at = {}
    move = corners or (lambda x, y, z: (x, y, z))
    c = {(a, b, e): move(w * (a - 0.5), h * (b - 0.5), d * (e - 0.5))
         for a in (0, 1) for b in (0, 1) for e in (0, 1)}

    def vert(i, j, k):
        if (i, j, k) not in at:
            u, v, t = i / nx, j / ny, k / nz
            p = [sum(c[(a, b, e)][n] * (u if a else 1 - u) * (v if b else 1 - v) * (t if e else 1 - t)
                     for a in (0, 1) for b in (0, 1) for e in (0, 1)) for n in range(3)]
            at[(i, j, k)] = g.add(*p)
        return at[(i, j, k)]
    for i in range(nx):
        for j in range(ny):
            g.face([vert(i, j, 0), vert(i + 1, j, 0), vert(i + 1, j + 1, 0), vert(i, j + 1, 0)], smooth)
            g.face([vert(i, j, nz), vert(i, j + 1, nz), vert(i + 1, j + 1, nz), vert(i + 1, j, nz)], smooth)
    for i in range(nx):
        for k in range(nz):
            g.face([vert(i, 0, k), vert(i, 0, k + 1), vert(i + 1, 0, k + 1), vert(i + 1, 0, k)], smooth)
            g.face([vert(i, ny, k), vert(i + 1, ny, k), vert(i + 1, ny, k + 1), vert(i, ny, k + 1)], smooth)
    for j in range(ny):
        for k in range(nz):
            g.face([vert(0, j, k), vert(0, j + 1, k), vert(0, j + 1, k + 1), vert(0, j, k + 1)], smooth)
            g.face([vert(nx, j, k), vert(nx, j, k + 1), vert(nx, j + 1, k + 1), vert(nx, j + 1, k)], smooth)
    return g


def from_blender(bm):
    """A primitive Blender made (an icosphere, a hull), taken into three's
    frame: Blender (x, y, z) is three's (x, z, -y)."""
    g = Geo()
    ids = {v: g.add(v.co.x, v.co.z, -v.co.y) for v in bm.verts}
    for f in bm.faces:
        g.face([ids[v] for v in f.verts])
    bm.free()
    return g


def dodecahedron(r):
    """three's DodecahedronGeometry(r, 0): twenty corners on a sphere, closed
    by their hull."""
    p = (1 + math.sqrt(5)) / 2
    q = 1 / p
    pts = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    for a in (-1, 1):
        for b in (-1, 1):
            pts += [(0, a * q, b * p), (a * q, b * p, 0), (a * p, 0, b * q)]
    bm = bmesh.new()
    for x, y, z in pts:
        n = math.sqrt(x * x + y * y + z * z)
        bm.verts.new((x / n * r, y / n * r, z / n * r))
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    # The hull comes back as triangles, split whichever way it likes; merged
    # back into the twelve pentagons, the exporter splits them the same way
    # every run.
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts[:], edges=bm.edges[:])
    return from_blender(bm)


def icosahedron(r, subdivisions):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=r)
    return from_blender(bm)


def jitter(g, lo, hi, rnd, fy=1.0, jy=True):
    """shells.js's and stones.js's per-vertex jitter, scaling each corner by
    lo..hi and y by fy as well (and by the jitter too, unless jy is False:
    stones.js leaves a stone's thickness alone). Those builders jitter an unwelded solid, so a
    corner is drawn once for every triangle that meets there and the one that
    reaches furthest is what shows; welded, each corner takes the furthest of
    that many draws. Corners are visited in order of position, so the draws
    do not depend on the order Blender made them in."""
    meets = [0] * len(g.v)
    for ids, *_ in g.f:
        for i in ids:
            meets[i] += len(ids) - 2
    for i in sorted(range(len(g.v)), key=lambda i: tuple(round(c, 6) for c in g.v[i])):
        j = max(lo + rnd.random() * (hi - lo) for _ in range(meets[i]))
        x, y, z = g.v[i]
        g.v[i] = [x * j, y * fy * (j if jy else 1), z * j]
    return g


def build(name, geo, materials, closed=True):
    """One piece as a grounded object: base on y = 0, centred on x and z."""
    ob = common.mesh_object(name, geo.to_bm(closed), materials, smooth=True)
    common.ground(ob)
    return ob


# ---------------------------------------------------------------- the pieces

# field.js's four hand-placed logs (LAYOUT.driftwood), copied with the seeds
# mulberry32(0xd21f) gives them there. Each is its own item: where they lie and
# how many branches each carries is a composition decision, not a statistic.
LOGS = [
    dict(len=6.4, r=0.38, roll=0.12, sink=0.16, branches=2, seed=44206),
    dict(len=5.0, r=0.30, roll=-0.2, sink=0.10, branches=3, seed=691131),
    dict(len=4.2, r=0.26, roll=0.05, sink=0.30, branches=1, seed=737394),
    dict(len=3.4, r=0.22, roll=0.3, sink=0.08, branches=2, seed=49308),
]


def driftwood(n):
    def make(rnd):
        d = LOGS[n - 1]
        trunk, rings = cylinder(d['r'] * 0.7, d['r'], d['len'], 8, hseg=4)
        # Snapped ends: each end's rim pulled in or out along the log by its
        # own amount, so neither reads as sawn. Before roughen, as a builder
        # would have it.
        for ring, sign in ((rings[0], 1), (rings[-1], -1)):
            for i in ring:
                trunk.v[i][1] += sign * rnd.uniform(-0.6, 0.25) * d['r']
        trunk.roughen(0.14, d['seed'])
        trunk.rotate_z(math.pi / 2).rotate_x(d['roll']).translate(0, d['r'] - d['sink'], 0)
        for b in range(d['branches']):
            t = (b + 1) / (d['branches'] + 1) - 0.5
            bl = d['len'] * (0.22 + 0.16 * b)
            br, _ = cylinder(d['r'] * 0.16, d['r'] * 0.3, bl, 5, hseg=2)
            br.roughen(0.2, d['seed'] + b * 7919)
            br.rotate_z(math.pi / 2.6 + b * 0.5).rotate_y(1.1 if b % 2 else -1.3)
            trunk.merge(br.translate(t * d['len'], d['r'] * 1.1, 0))
        return build(f'driftwood-{n}', trunk, [common.material('wood', col('wood'), roughness=0.95)])
    return make


GROYNE_SEEDS = [-41914, -42997, -44716]   # the first three posts' (x * 977 + z * 131) | 0


def groyne_post(n):
    def make(rnd):
        r, length = ref(f'groyne-post-{n}')['r'], ref(f'groyne-post-{n}')['len']
        g, rings = cylinder(r * 0.88, r, length, 7, hseg=3)
        for i in rings[0]:                        # the top, worn by the sea
            g.v[i][1] -= rnd.uniform(0.0, 0.09)
        g.roughen(0.10, GROYNE_SEEDS[n - 1])
        return build(f'groyne-post-{n}', g, [common.material('wood', col('wood'), roughness=0.95)])
    return make


BOULDER_SEEDS = [5870, 413606, 206663]    # the first three rocks' seeds in LAYOUT.rocks


def boulder(n):
    def make(rnd):
        g = sphere(ref(f'boulder-{n}')['r'], 14, 10).roughen(0.22, BOULDER_SEEDS[n - 1])
        return build(f'boulder-{n}', g, [common.material('stone', col('stone'), roughness=0.82)])
    return make


def wrack_shell(rnd):
    s = ref('wrack-shell')['s']
    g = sphere(1, 7, 5, theta_len=math.pi * 0.55).scale(1, 0.5, 1.25).scale(s)
    return build('wrack-shell', g, [common.material('wrack-shell', col('wrack-shell'), roughness=0.7,
                                                     double_sided=True)], closed=False)


def wrack_pebble(rnd):
    s = ref('wrack-pebble')['s']
    g = sphere(1, 6, 5).roughen(0.4, 0x51AB).scale(1, 0.55, 0.9).scale(s)
    return build('wrack-pebble', g, [common.material('wrack-pebble', col('wrack-pebble'), roughness=0.9)])


def wrack_weed(rnd):
    s = ref('wrack-weed')['s']
    # The builder's roughen, on the builder's eight corners; the lengthwise
    # cuts only let the strand sag between them, 4 mm at the most.
    g = box(2.6, 0.18, 0.7, nx=6, corners=rough(0.5, 0x9C2D))
    g.each(lambda x, y, z: (x, y - 0.02 * math.sin(math.pi * (x / 2.6 + 0.5)) * rnd.uniform(0.6, 1.0), z))
    g.scale(s)
    return build('wrack-weed', g, [common.material('wrack-weed', col('wrack-weed'), roughness=1.0)])


FENCE_SEEDS = [15518, 14616, 13476]       # the first three posts' (x * 331 + z * 17) | 0


def fence_post(n):
    def make(rnd):
        g, rings = cylinder(0.055, 0.07, ref(f'fence-post-{n}')['h'] + 0.5, 6, hseg=2)
        tilt = rnd.uniform(0, TAU)               # a top cut on a slant, split by weather
        for i in rings[0]:
            x, _, z = g.v[i]
            g.v[i][1] += 0.3 * (x * math.cos(tilt) + z * math.sin(tilt)) - rnd.uniform(0, 0.012)
        g.roughen(0.12, FENCE_SEEDS[n - 1])
        return build(f'fence-post-{n}', g, [common.material('wood', col('wood'), roughness=0.95)])
    return make


def pool_stone(n):
    def make(rnd):
        g = sphere(ref(f'pool-stone-{n}')['r'], 8, 6).roughen(0.3, n * 7919).scale(1, 0.65, 1)
        return build(f'pool-stone-{n}', g, [common.material('stone', col('stone'), roughness=0.82)])
    return make


def cave_block(n):
    def make(rnd):
        g = sphere(ref(f'cave-block-{n}')['r'], 10, 8).roughen(0.3, n * 977).scale(1, 0.7, 1)
        # A fallen lintel block has one broken face: the side it came away
        # from, flattened, turned a different way on each variant.
        a = rnd.uniform(0, TAU)
        dx, dz = math.cos(a), math.sin(a)
        cut = ref(f'cave-block-{n}')['r'] * 0.9
        g.each(lambda x, y, z: (x - dx * max(0, x * dx + z * dz - cut), y,
                                z - dz * max(0, x * dx + z * dz - cut)))
        return build(f'cave-block-{n}', g, [common.material('stone', col('stone'), roughness=0.82)])
    return make


def cave_rubble(n):
    def make(rnd):
        g = sphere(ref(f'cave-rubble-{n}')['r'], 7, 5).roughen(0.35, n * 131)
        return build(f'cave-rubble-{n}', g, [common.material('stone', col('stone'), roughness=0.82)])
    return make


def pier_pile(n):
    def make(rnd):
        g, _ = cylinder(0.16, 0.2, ref(f'pier-pile-{n}')['len'], 7, hseg=3)
        g.roughen(0.08, n * 977)
        return build(f'pier-pile-{n}', g, [common.material('pier-wood', col('pier-wood'), roughness=0.95)])
    return make


def pier_stump(n):
    def make(rnd):
        g, rings = cylinder(0.16, 0.2, ref(f'pier-stump-{n}')['len'], 7, hseg=3)
        # Snapped, not sawn: a jagged top, one side standing proud.
        tall = rnd.randrange(7)
        for j, i in enumerate(rings[0]):
            k = min((j - tall) % 7, (tall - j) % 7)
            g.v[i][1] -= 0.05 * k + rnd.uniform(0, 0.08)
        g.roughen(0.08, n * 131)
        return build(f'pier-stump-{n}', g, [common.material('pier-old-wood', col('pier-old-wood'),
                                                             roughness=1.0)])
    return make


def pier_plank(n):
    def make(rnd):
        w = ref(f'pier-plank-{n}')['w']
        g = box(w, 0.09, 0.5, nx=4)
        # Warped as far as a 9 cm board can go and still sit on field.js's
        # deck: under a centimetre, all of it.
        twist, bow = rnd.uniform(-0.008, 0.008), rnd.uniform(0.002, 0.004)

        def warp(x, y, z):
            t = x / w
            a = twist * t
            y2, z2 = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
            return x, y2 + bow * (1 - 4 * t * t), z2
        g.each(warp)
        return build(f'pier-plank-{n}', g, [common.material('pier-wood', col('pier-wood'), roughness=0.95)])
    return make


def pier_stringer(rnd):
    g = box(0.18, 0.22, ref('pier-stringer')['len'], nz=8)
    return build('pier-stringer', g, [common.material('pier-old-wood', col('pier-old-wood'), roughness=1.0)])


SHELL = 'shell'


def cockle(n):
    def make(rnd):
        s = ref(f'cockle-{n}')['s']
        ridges = 8 + rnd.randrange(4)
        g = sphere(1, 44, 8)

        def rib(x, y, z):
            k = 1 + abs(math.sin(math.atan2(z, x) * ridges * 0.5)) * 0.14
            return x * k, max(y * 0.42, -0.06), z * k
        g.each(rib).scale(s)
        return build(f'cockle-{n}', g, [common.material('cockle', col('shell'), roughness=0.8)])
    return make


def whelk(n):
    """shells.js's whelkGeo: a log spiral swept by a circle, apex up, the
    aperture at the bottom. 40 x 8 where the builder had 64 x 10."""
    def make(rnd):
        s = ref(f'whelk-{n}')['s']
        turns, U, V = 2.6 + rnd.random() * 0.6, 40, 8
        g = Geo()
        rows = []
        for i in range(U + 1):
            u = i / U
            th = turns * TAU * u
            r = 0.05 + 0.42 * u ** 1.25
            tube = 0.04 + r * 0.62
            cx, cy, cz = math.cos(th) * r * 0.55, 1.05 * (1 - u) - 0.35, math.sin(th) * r * 0.55
            rows.append([g.add(cx + math.cos(th) * math.cos(TAU * j / V) * tube,
                               cy + math.sin(TAU * j / V) * tube,
                               cz + math.sin(th) * math.cos(TAU * j / V) * tube) for j in range(V)])
        for a, b in zip(rows, rows[1:]):
            for j in range(V):
                k = (j + 1) % V
                g.face([a[j], b[j], b[k], a[k]])
        g.face(rows[0][::-1], smooth=False)       # the apex, shut
        g.scale(s)
        return build(f'whelk-{n}', g, [common.material('whelk', col('whelk'), roughness=0.75,
                                                        double_sided=True)], closed=False)
    return make


def rosette(size=128):
    """shells.js's sandDollarMaterialTop() canvas, drawn pixel by pixel: the
    fill, five petals stroked 2.5 px wide at 65%, and a dot at 50% (#654)."""
    fill = [int(PALETTE['sand-dollar'][i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ink = [int(PALETTE['sand-dollar-rosette'][i:i + 2], 16) / 255 for i in (0, 2, 4)]
    petals = []
    for p in range(5):
        a = p / 5 * TAU - math.pi / 2
        petals.append((64 + math.cos(a) * 22, 64 + math.sin(a) * 22, a + math.pi / 2))

    def pixel(x, y):
        cx, cy = x + 0.5, size - y - 0.5          # canvas y runs down
        c = fill[:]
        for px, py, rot in petals:
            dx, dy = cx - px, cy - py
            u = dx * math.cos(rot) + dy * math.sin(rot)
            v = -dx * math.sin(rot) + dy * math.cos(rot)
            f = (u / 8) ** 2 + (v / 20) ** 2 - 1
            grad = math.hypot(2 * u / 64, 2 * v / 400) or 1
            cover = max(0.0, min(1.0, 1.75 - abs(f) / grad)) * 0.65
            c = [a * (1 - cover) + b * cover for a, b in zip(c, ink)]
        cover = max(0.0, min(1.0, 0.5 - (math.hypot(cx - 64, cy - 64) - 3))) * 0.5
        return [a * (1 - cover) + b * cover for a, b in zip(c, ink)]
    return common.image('sand-dollar', size, pixel)


def sand_dollar(rnd):
    s = ref('sand-dollar')['s']
    g, rings = cylinder(1, 1.04, 0.16, 22)
    # UVs: each cap mapped flat onto the rosette, as three's cylinder caps
    # are; the rim takes a corner of plain fill.
    uv_of = {i: (0.5 + 0.5 * g.v[i][0] / r, 0.5 + 0.5 * g.v[i][2] / r)
             for ring, r in ((rings[0], 1), (rings[1], 1.04)) for i in ring}
    g.f = [(ids, slot, sm, [uv_of[i] for i in ids] if len(ids) > 4 else [(0.03, 0.03)] * len(ids))
           for ids, slot, sm, _ in g.f]
    g.scale(s)
    mat = common.material('sand-dollar', col('sand-dollar'), roughness=0.9, image=rosette())
    return build('sand-dollar', g, [mat])


GLASS = ['sea-glass-green', 'sea-glass-blue', 'sea-glass-amber']


def sea_glass(n):
    def make(rnd):
        s = ref(f'sea-glass-{n}')['s']
        g = jitter(icosahedron(0.8, 2), 0.86, 1.14, rnd, fy=0.5).scale(s)
        mat = common.material(GLASS[n - 1], col(GLASS[n - 1]), roughness=0.35, alpha=0.78)
        return build(f'sea-glass-{n}', g, [mat])
    return make


def skimming_stone(n):
    def make(rnd):
        s = ref(f'skimming-stone-{n}')['s']
        g = jitter(dodecahedron(1), 0.85, 1.15, rnd, fy=0.34, jy=False).scale(s)
        g.f = [(ids, slot, False, uv) for ids, slot, _, uv in g.f]     # faceted, as the builder's
        return build(f'skimming-stone-{n}', g, [common.material('skimming-stone', col('skimming-stone'))])
    return make


def sandcastle(rnd):
    """makeCastle() in js/sandcastle.js: a keep, an upper stage and a cap, four
    towers each with a tip. Its base is the sand, as the builder's group was."""
    g = Geo()

    def put(piece, x, y, z):
        g.merge(piece.translate(x, y, z))
    put(cylinder(0.34, 0.44, 0.5, 10)[0], 0, 0.25, 0)
    put(cylinder(0.2, 0.26, 0.3, 9)[0], 0, 0.62, 0)
    put(cone(0.2, 0.18, 9), 0, 0.85, 0)
    for i in range(4):
        a = i / 4 * TAU + 0.4
        put(cylinder(0.1, 0.13, 0.4, 7)[0], math.cos(a) * 0.5, 0.2, math.sin(a) * 0.5)
        put(cone(0.11, 0.12, 7), math.cos(a) * 0.5, 0.45, math.sin(a) * 0.5)
    return build('sandcastle', g, [common.material('sandcastle', col('sandcastle'), roughness=0.98)])


ITEMS = {}
for i in (1, 2, 3, 4):
    ITEMS[f'driftwood-{i}'] = driftwood(i)
for i in (1, 2, 3):
    ITEMS[f'groyne-post-{i}'] = groyne_post(i)
for i in (1, 2, 3):
    ITEMS[f'boulder-{i}'] = boulder(i)
ITEMS['wrack-shell'] = wrack_shell
ITEMS['wrack-pebble'] = wrack_pebble
ITEMS['wrack-weed'] = wrack_weed
for i in (1, 2, 3):
    ITEMS[f'fence-post-{i}'] = fence_post(i)
for i in (1, 2, 3):
    ITEMS[f'pool-stone-{i}'] = pool_stone(i)
for i in (1, 2):
    ITEMS[f'cave-block-{i}'] = cave_block(i)
    ITEMS[f'cave-rubble-{i}'] = cave_rubble(i)
for i in (1, 2):
    ITEMS[f'pier-pile-{i}'] = pier_pile(i)
    ITEMS[f'pier-stump-{i}'] = pier_stump(i)
for i in (1, 2, 3):
    ITEMS[f'pier-plank-{i}'] = pier_plank(i)
ITEMS['pier-stringer'] = pier_stringer
for i in (1, 2, 3):
    ITEMS[f'cockle-{i}'] = cockle(i)
for i in (1, 2, 3):
    ITEMS[f'whelk-{i}'] = whelk(i)
ITEMS['sand-dollar'] = sand_dollar
for i in (1, 2, 3):
    ITEMS[f'sea-glass-{i}'] = sea_glass(i)
for i in (1, 2, 3):
    ITEMS[f'skimming-stone-{i}'] = skimming_stone(i)
ITEMS['sandcastle'] = sandcastle


def main():
    common.check_version()
    wanted = common.args() or list(ITEMS)
    unknown = [w for w in wanted if w not in ITEMS]
    missing = [n for n in ITEMS if n not in BUDGET['items']]
    if unknown or missing:
        print(f'props.py: no item named {", ".join(unknown)}' if unknown else
              f'props.py: budget.json has no entry for {", ".join(missing)}')
        sys.exit(1)

    common.reset()
    roots = []
    for i, name in enumerate(ITEMS):
        if name not in wanted:
            continue
        item = BUDGET['items'][name]
        root = ITEMS[name](common.rng(SEED + i))
        common.export_glb(root, item['file'], textured=bool(item.get('texture')))
        common.retire(root, name)
        print(f'props.py: wrote {item["file"]}')
        roots.append(root)
    print(f'props.py: contact sheet {common.contact_sheet(roots, "props", tile=128)}')


main()
