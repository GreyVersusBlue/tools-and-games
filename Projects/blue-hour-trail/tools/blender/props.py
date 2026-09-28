# Blue Hour's trail prop pack, built from code into assets/models/props/.
#
#   blender -b --factory-startup -P tools/blender/props.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class and
# reference entry, and `node tools/blender/validate.mjs` checks what this
# writes (BACKLOG.md "Blue Hour: Blender assets" B5).
#
# The nine things js/props.js builds, less the bootprints, which are a texture
# and stay one. Golden Hour's B5 set the pattern (#665): a piece at a reference
# entry where a builder loops over LAYOUT (the markers, the cairn stones, the
# mushrooms), whole where it builds one thing once (the bridge, the bench, the
# tower, the cabin, the radio, the headlamp).
#
# Every item is ported in its builder's own frame, before the builder's last
# yaw and translate: three's x across, y up, z toward what the builder called
# its front (the cabin's door, the bench's seat). So nothing here is turned a
# half turn, unlike the animals (#675). The builder's origin is where the
# builder's arithmetic puts things, and grounding moves it; budget.json's
# `ref.origin` says where it landed, in the model's frame, and this script
# stops if what it built disagrees by more than a millimetre, so the wiring row
# (B6) can put the builder's origin back at load and keep every builder's
# arithmetic as it is.
#
# Geo holds a piece in three's frame and hands it to Blender at the end,
# turned (x, y, z) -> (x, -z, y), which the exporter turns back. It and the
# primitives under it are Blue Hour's own copy of Golden Hour's props.py's at
# 9c20a44 (#17, #643).

import json
import math
import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

import bmesh  # noqa: E402

SEED = 0xB1_5E  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)
PALETTE = BUDGET['palette']
TAU = 2 * math.pi


def col(name):
    return int(PALETTE[name], 16)


def ref(item):
    return BUDGET['items'][item]['ref']


# The materials, by the palette name each wears. Lit where js/props.js draws
# with a MeshLambertMaterial, unlit where it draws with a MeshBasicMaterial.
def lit(name, **kw):
    return common.material(name, col(name), roughness=kw.pop('roughness', 0.9), **kw)


def unlit(name):
    return common.material(name, col(name), unlit=True)


# ---------------------------------------------------------------- three's frame

def rough(amount, seed):
    """js/props.js's roughen(), exactly, as a function of one point, so a
    stone is roughened where the builder roughened it."""
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

    def face(self, ids, smooth=True, slot=0):
        self.f.append((list(ids), slot, smooth))

    def merge(self, other):
        n = len(self.v)
        self.v += [p[:] for p in other.v]
        self.f += [([i + n for i in ids], s, sm) for ids, s, sm in other.f]
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
        self.f = [(ids, slot, sm) for ids, _, sm in self.f]
        return self

    def to_bm(self, closed=True):
        bm = bmesh.new()
        vs = [bm.verts.new((x, -z, y)) for x, y, z in self.v]
        made = []
        for ids, slot, smooth in self.f:
            f = bm.faces.new([vs[i] for i in ids])
            f.material_index = slot
            f.smooth = smooth
            made.append(f)
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=made)
        return bm


def cylinder(rt, rb, h, seg, hseg=1, caps=True):
    """three's CylinderGeometry: radius rt at the top (+y), rb at the bottom,
    centred on the origin, seam welded. Sides smooth, caps flat."""
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
    return g


def cone(r, h, seg):
    """three's ConeGeometry: a base ring at -h/2 and an apex at +h/2."""
    g = Geo()
    ring = [g.add(r * math.sin(TAU * j / seg), -h / 2, r * math.cos(TAU * j / seg))
            for j in range(seg)]
    apex = g.add(0, h / 2, 0)
    for j in range(seg):
        g.face([ring[j], ring[(j + 1) % seg], apex], smooth=False)
    g.face(ring[::-1], smooth=False)
    return g


def sphere(r, wseg, hseg, theta_len=math.pi):
    """three's SphereGeometry with its poles welded to one vertex each. Short
    of a full theta it stops at an open rim, and `rim` is that ring."""
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
    g.rim = rows[-1]
    return g


def box(w, h, d, x=0.0, y=0.0, z=0.0, slot=0):
    """three's BoxGeometry, flat-shaded, centred on (x, y, z)."""
    g = Geo()
    c = {(a, b, e): g.add(x + w * (a - 0.5), y + h * (b - 0.5), z + d * (e - 0.5))
         for a in (0, 1) for b in (0, 1) for e in (0, 1)}
    for ids in (((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
                ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
                ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
                ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
                ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),
                ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))):
        g.face([c[k] for k in ids], smooth=False, slot=slot)
    return g


def prism(outline, x0, x1, slot=0):
    """A flat outline in (z, y), pushed out along x from x0 to x1: a gable."""
    g = Geo()
    a = [g.add(x0, y, z) for z, y in outline]
    b = [g.add(x1, y, z) for z, y in outline]
    n = len(outline)
    g.face(a, smooth=False, slot=slot)
    g.face(b[::-1], smooth=False, slot=slot)
    for i in range(n):
        j = (i + 1) % n
        g.face([a[i], a[j], b[j], b[i]], smooth=False, slot=slot)
    return g


def slab(p0, p1, width, thick, slot=0):
    """A board from p0 to p1 in (z, y), width along x, `thick` on top of the
    line between them: a roof pitch, a stair flight."""
    (z0, y0), (z1, y1) = p0, p1
    dz, dy = z1 - z0, y1 - y0
    n = math.hypot(dz, dy)
    nz, ny = -dy / n * thick, dz / n * thick           # the side the board sits on
    if ny < 0:
        nz, ny = -nz, -ny
    return prism([(z0, y0), (z1, y1), (z1 + nz, y1 + ny), (z0 + nz, y0 + ny)],
                 -width / 2, width / 2, slot)


def band(a, b, width, h, seg, n=2.0):
    """A flat loop, a coiled strap: outer semi-axes a and b, the band `width`
    wide and `h` tall, centred on the origin. n is the superellipse's power: 2
    is an ellipse, and higher is squarer, as a strap coiled flat lies."""
    g = Geo()
    rings = []

    def se(t):
        c, s = math.cos(t), math.sin(t)
        return math.copysign(abs(c) ** (2 / n), c), math.copysign(abs(s) ** (2 / n), s)
    for (ra, rb), y in (((a, b), -h / 2), ((a - width, b - width), -h / 2),
                        ((a - width, b - width), h / 2), ((a, b), h / 2)):
        rings.append([g.add(ra * se(TAU * j / seg)[0], y, rb * se(TAU * j / seg)[1])
                      for j in range(seg)])
    for i in range(4):
        p, q = rings[i], rings[(i + 1) % 4]
        for j in range(seg):
            k = (j + 1) % seg
            g.face([p[j], p[k], q[k], q[j]], smooth=False)
    return g


def build(name, geo, materials, closed=True, nodes=()):
    """One item as a grounded object: base on y = 0, centred on x and z. The
    builder's origin, where it lands after grounding, is checked against
    budget.json's ref.origin to a millimetre. `nodes` are (node name, Geo,
    materials) children the game finds by name (the cabin's window)."""
    pts = geo.v + [p for _, g, _ in nodes for p in g.v]
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    origin = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]
    want = ref(name)['origin']
    if any(abs(a - b) > 0.001 for a, b in zip(origin, want)):
        print(f'props.py: {name} puts the builder\'s origin at '
              f'[{", ".join(f"{v:.4f}" for v in origin)}], and budget.json says '
              f'[{", ".join(f"{v:.4f}" for v in want)}]')
        sys.exit(1)
    ob = common.mesh_object(name, geo.to_bm(closed), materials, smooth=True)
    for node, g, mats in nodes:
        common.mesh_object(node, g.to_bm(closed), mats, parent=ob)
    common.ground(ob)
    return ob


# ---------------------------------------------------------------- the pieces

def marker(n):
    """buildMarkers(): a 1.5 m post sunk 10 cm, a board across its head and a
    pale blaze. The builder's blaze is a box inside the post, showing 1.5 cm
    each side; here it is a plate on each face, so it reads from the trail
    whichever way the walker comes. The builder's origin is the ground."""
    def make(rnd):
        g = Geo()
        post = box(0.13, 1.5, 0.13, y=0.65)
        # Weather: the post's head leans a little and its corners wander by
        # under a centimetre, which is all a 13 cm post can take and stay one.
        lean = rnd.uniform(-0.015, 0.015)
        post.each(lambda x, y, z: (x + lean * (y + 0.1) / 1.5 + rnd.uniform(-0.004, 0.004), y,
                                   z + rnd.uniform(-0.004, 0.004)))
        g.merge(post)
        tilt = rnd.uniform(-0.035, 0.035)
        g.merge(box(0.3, 0.22, 0.05).rotate_z(tilt).translate(lean * 0.92, 1.28, 0))
        for side in (-1, 1):
            g.merge(box(0.16, 0.24, 0.004, z=side * 0.067, slot=1).translate(lean * 0.7, 0.95, 0))
        return build(f'marker-{n}', g, [lit('wood'), unlit('marker-blaze')])
    return make


# The first three stones of LAYOUT.cairns[0], at their own radius and with
# their own seed (ci * 131 + s * 977): the bottom stone and the two above it.
# The wiring scales a stone by its entry's r over the variant's.
CAIRN = [(0.34, 0), (0.3328, 977), (0.2586, 1954)]


def cairn_stone(n):
    """buildCairns(): a sphere roughened at 0.18 and squashed to 0.55, at 12 x 8
    where the builder had 9 x 7; the cairns are found from 4 m. The builder's
    origin is the sphere's centre."""
    def make(rnd):
        r, seed = CAIRN[n - 1]
        g = sphere(r, 12, 8).roughen(0.18, seed).scale(1, 0.55, 1)
        return build(f'cairn-stone-{n}', g, [lit('stone', roughness=0.95)])
    return make


def bridge(rnd):
    """buildBridge() at len 7, width 2.4: nine planks across the way, two
    stringers, a post at each corner and one mid-span, a rail each side. Each
    plank sits a few millimetres off true and turned a little, as boards laid
    by hand do. The builder's origin is the deck's height, mid-span."""
    b = ref('bridge')
    L, W = b['len'], b['width']
    g = Geo()
    for i in range(9):
        along = -L / 2 + (i + 0.5) * (L / 9)
        g.merge(box(W, 0.07, L / 9 - 0.05).rotate_y(rnd.uniform(-0.015, 0.015))
                .translate(rnd.uniform(-0.03, 0.03), -0.045 + rnd.uniform(-0.004, 0.004), along))
    for side in (-1, 1):
        g.merge(box(0.14, 0.2, L, x=side * (W / 2 - 0.15), y=-0.18))
        for end in (-1, 0, 1):
            g.merge(box(0.1, 1.0, 0.1, x=side * W / 2, y=0.42, z=end * (L / 2 - 0.2)))
        g.merge(box(0.08, 0.08, L, x=side * W / 2, y=0.9))
    return build('bridge', g, [lit('wood')])


def bench(rnd):
    """buildBench(): the seat as three slats and the back as two, on the
    builder's two end frames. The builder's origin is the ground under the
    seat's middle; the back sits behind it, at -z."""
    g = Geo()
    for z in (-0.155, 0.0, 0.155):
        g.merge(box(1.6, 0.07, 0.14, y=0.46, z=z))
    for y in (0.61, 0.89):
        g.merge(box(1.6, 0.12, 0.06, y=y, z=-0.24))
    for x in (-0.68, 0.68):
        g.merge(box(0.08, 0.46, 0.4, x=x, y=0.23))
        g.merge(box(0.08, 0.5, 0.06, x=x, y=0.7, z=-0.24))
    return build('bench', g, [lit('wood')])


def tower(rnd):
    """buildTower(): four splayed legs, three levels of braces, the platform,
    the cab, its four-sided roof and the platform rail, all where the builder
    put them. What is new is inside that box: four stair flights between the
    legs, and each window band split into three panes by two mullions. The
    panes are the builder's own unlit band, a `panes` node of their own. The
    builder's origin is the ground at the legs' centre."""
    H = 9
    g = Geo()
    for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        leg = cylinder(0.09, 0.13, H, 5)
        leg.rotate_z(-sx * 0.12).rotate_x(sz * 0.12).translate(sx * 1.85 * 0.75, H / 2, sz * 1.85 * 0.75)
        g.merge(leg)
    for lvl in (1, 2, 3):
        y = lvl * 2.4
        spread = 1.85 * (1 - (y / H) * 0.45) * 1.5
        g.merge(box(spread * 2, 0.09, 0.09, y=y, z=-spread * 0.62))
        g.merge(box(spread * 2, 0.09, 0.09, y=y, z=spread * 0.62))
        g.merge(box(0.09, 0.09, spread * 1.24, x=-spread * 0.95, y=y))
        g.merge(box(0.09, 0.09, spread * 1.24, x=spread * 0.95, y=y))
    # Stairs: four flights switching back between the legs, each a stringer
    # board from one landing to the next, 2.25 m up over 1.8 m.
    for k in range(4):
        y0, y1 = k * 2.25, (k + 1) * 2.25
        z0, z1 = (-0.9, 0.9) if k % 2 == 0 else (0.9, -0.9)
        g.merge(slab((z0, y0), (z1, y1), 0.6, 0.05).translate(-0.35 if k % 2 == 0 else 0.35, 0, 0))
    g.merge(box(3.4, 0.16, 3.4, y=H))
    g.merge(box(2.6, 1.7, 2.6, y=H + 0.95))
    g.merge(cone(2.25, 1.1, 4).rotate_y(math.pi / 4).translate(0, H + 2.35, 0))
    for side in (-1, 1):
        g.merge(box(3.4, 0.06, 0.06, y=H + 0.6, z=side * 1.7))
        g.merge(box(0.06, 0.06, 3.4, x=side * 1.7, y=H + 0.6))
    # Two mullions across each window band, proud of the glass.
    for s in range(4):
        for u in (-2.2 / 6, 2.2 / 6):
            m = box(0.05, 0.66, 0.03).translate(u, H + 1.12, 1.31).rotate_y(s * math.pi / 2)
            g.merge(m)
    panes = Geo()
    for s in range(4):
        pane = box(2.2, 0.62, 0.002).translate(0, H + 1.12, 1.301).rotate_y(s * math.pi / 2)
        panes.merge(pane)
    return build('tower', g, [lit('wood-dark')], nodes=[('panes', panes, [unlit('tower-pane')])])


def cabin(rnd):
    """buildCabin(): the builder's body, 4.2 x 2.4 x 3.2, with its door on
    the trail side (+z) and its window on the other side of the front. The
    builder's roof is a three-sided cylinder that comes out as a lopsided
    prism, 4.4 m at the front and 2.75 m at the back; this keeps that box and
    that fall, as a saltbox roof with a short front pitch, gable ends, and a
    stone chimney at the back. The lit window is its own `window` node, the
    thing B6 lerps (#669's `cabin-window`). The builder's origin is the ground
    at the body's centre."""
    g = Geo()
    g.merge(box(4.2, 2.4, 3.2, y=1.2))
    g.merge(box(0.9, 1.8, 0.12, x=1.1, y=0.9, z=1.62))
    for x in (0.61, 1.59):                                   # door frame
        g.merge(box(0.08, 1.9, 0.1, x=x, y=0.95, z=1.63))
    g.merge(box(1.06, 0.08, 0.1, x=1.1, y=1.86, z=1.63))
    for x in (-1.29, -0.51):                                 # window frame
        g.merge(box(0.08, 0.76, 0.08, x=x, y=1.35, z=1.62))
    for y in (1.01, 1.69):
        g.merge(box(0.86, 0.08, 0.08, x=-0.9, y=y, z=1.62))
    for x in (-2.12, 2.12):                                  # corner posts
        for z in (-1.62, 1.62):
            g.merge(box(0.14, 2.4, 0.14, x=x, y=1.2, z=z))

    ridge, back, front = (0.5, 4.4), (-1.9, 2.75), (1.8, 3.55)

    def under(z):
        (za, ya), (zb, yb) = (back, ridge) if z <= ridge[0] else (ridge, front)
        return ya + (yb - ya) * (z - za) / (zb - za)
    g.merge(prism([(-1.6, 2.4), (1.6, 2.4), (1.6, under(1.6)), ridge, (-1.6, under(-1.6))], -2.1, 2.1))
    g.merge(slab(back, ridge, 4.6, 0.12))
    g.merge(slab(ridge, front, 4.6, 0.12))
    chimney = box(0.5, 1.1, 0.5, slot=1).translate(-1.5, under(-0.6) + 0.25, -0.6)
    g.merge(chimney)

    win = box(0.7, 0.6, 0.002).translate(-0.9, 1.35, 1.61)
    return build('cabin', g, [lit('wood-dark'), lit('stone', roughness=0.95)],
                 nodes=[('window', win, [unlit('cabin-window')])])


def radio(rnd):
    """buildRadio(): the field set on its shelf by the window, whip aerial up,
    in the cabin's frame, so the builder's origin is the cabin's. What is new
    is on the set's face: a dark dial and two knobs, and a carry handle on
    top. Nothing is lit behind the dial."""
    g = Geo()
    g.merge(box(0.34, 0.22, 0.14, x=-1.7, y=1.02, z=1.55))
    g.merge(box(0.36, 0.05, 0.18, x=-1.7, y=0.88, z=1.55))
    g.merge(cylinder(0.006, 0.006, 0.85, 5).translate(-1.83, 1.5, 1.5))
    g.merge(box(0.18, 0.09, 0.006, x=-1.74, y=1.04, z=1.623, slot=1))
    for x in (-1.6, -1.56):
        g.merge(cylinder(0.016, 0.016, 0.014, 8).rotate_x(math.pi / 2).translate(x, 1.0, 1.627).paint(2))
    for x in (-1.62, -1.52):
        g.merge(box(0.018, 0.035, 0.018, x=x, y=1.1475, z=1.55))
    g.merge(box(0.118, 0.016, 0.018, x=-1.57, y=1.173, z=1.55))
    return build('radio', g, [lit('radio'), lit('tower-pane', roughness=0.4), lit('headlamp')])


def headlamp(rnd):
    """buildHeadlamp(): the lamp body turned 0.7 on the step, its lens on the
    trail end, the strap coiled beside it. The builder's strap is a flat box;
    here it is the loop it stands for, squared off enough to fill the same
    footprint (an ellipse came out 17% narrow). The lens is a
    thin disc in the bezel, unlit, as the builder's is. The builder's origin is the ground point."""
    g = Geo()
    g.merge(box(0.09, 0.06, 0.06).rotate_y(0.7).translate(0, 0.05, 0))
    bezel = cylinder(0.031, 0.031, 0.008, 12).rotate_z(math.pi / 2)   # along x
    g.merge(bezel.translate(0.047, 0, 0).rotate_y(0.7).translate(0, 0.05, 0))
    strap = band(0.08, 0.05, 0.016, 0.015, 20, n=6).paint(1)
    g.merge(strap.rotate_y(0.4).translate(-0.02, 0.02, 0.06))
    lens = cylinder(0.026, 0.026, 0.002, 12).rotate_z(math.pi / 2)
    lens.translate(0.052, 0, 0).rotate_y(0.7).translate(0, 0.05, 0)
    g.merge(lens.paint(2))
    return build('headlamp', g, [lit('headlamp'), lit('headlamp-strap'), unlit('headlamp-lens')])


def mushroom(glow):
    """buildMushrooms(): the stem and cap every instance shares, at unit
    scale, stem 7-sided and cap 10 x 5 where the builder had 5 and 7 x 5, and
    the cap's underside closed in the stem's colour, since the walker looks
    down on these. The glowing kind's cap carries the builder's emissive. The
    builder's origin is the foot of the stem."""
    def make(rnd):
        g = cylinder(0.02, 0.035, 0.12, 7).translate(0, 0.06, 0)
        cap = sphere(0.06, 10, 5, theta_len=math.pi * 0.55).paint(1)
        cap.face(cap.rim, smooth=False)                      # the gills, stem-coloured
        g.merge(cap.translate(0, 0.1, 0))
        top = (lit('mushroom-glow', emissive=col('mushroom-glow-emissive')) if glow
               else lit('mushroom-cap'))
        return build('mushroom-glow' if glow else 'mushroom', g, [lit('mushroom-stem'), top])
    return make


ITEMS = {
    'marker-1': marker(1),
    'marker-2': marker(2),
    'cairn-stone-1': cairn_stone(1),
    'cairn-stone-2': cairn_stone(2),
    'cairn-stone-3': cairn_stone(3),
    'bridge': bridge,
    'bench': bench,
    'tower': tower,
    'cabin': cabin,
    'radio': radio,
    'headlamp': headlamp,
    'mushroom': mushroom(False),
    'mushroom-glow': mushroom(True),
}


def main():
    common.check_version()
    wanted = common.args() or list(ITEMS)
    unknown = [w for w in wanted if w not in ITEMS]
    missing = [n for n in ITEMS if n not in BUDGET['items']]
    if unknown or missing:
        print(f'props.py: no item named {", ".join(unknown)}; the pack has {", ".join(ITEMS)}' if unknown else
              f'props.py: budget.json has no entry for {", ".join(missing)}')
        sys.exit(1)

    common.reset()
    roots = []
    for i, name in enumerate(ITEMS):
        if name not in wanted:
            continue
        item = BUDGET['items'][name]
        root = ITEMS[name](common.rng(SEED + i))
        common.export_glb(root, item['file'])
        common.retire(root, name)
        print(f'props.py: wrote {item["file"]}')
        roots.append(root)
    print(f'props.py: contact sheet {common.contact_sheet(roots, "props", tile=128)}')


main()
