"""A15 goods: one rig for all twelve trade goods, each a small still life
on a transparent ground with its own soft contact shadow.

    blender -b --factory-startup -P scripts/a15_goods.py -- --preview --good pepper

Rig: camera about 35 degrees down through the table lens, the same soft
window light from the upper left, the same subject scale (each still life
sits in a ~24 cm circle). Batch 1 built pepper and silk; batch 2 the other ten.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_props as P       # noqa: E402
import bpy                  # noqa: E402
from mathutils import Vector  # noqa: E402

GOOD_SHIP = 768


def pepper():
    """A small cloth sack with its top rolled down, full of black
    peppercorns, a few spilled."""
    r, h, roll = 0.058, 0.105, 0.02
    sk = P.sack("PepperSack", r=r, h=h, roll=roll, mat=C.M("hessian", colour=(0.78, 0.64, 0.45)), salt=101)
    sk.location = (0.012, 0.018, 0)
    # the mound of corns filling the mouth of the sack
    top = h - roll * 1.2
    pts = P.mound_points(r * 0.9, 0.022, 0.0047, center=(0.012, 0.018, top), salt=1)
    P.grain_mesh("Peppercorns", pts, 0.0024, salt=1, squash=0.92, detail=1)
    # a few spilled on the ground, front left, in a loose trail
    rr = C.rng(55)
    spill = []
    for i in range(16):
        t = rr.random()
        a = math.radians(rr.uniform(200, 290))
        d = r + 0.008 + t * 0.07 + rr.uniform(-0.006, 0.006)
        spill.append((0.012 + d * math.cos(a), 0.018 + d * math.sin(a), 0.0021))
    for i in range(5):     # a little cluster against the sack
        spill.append((0.012 + rr.uniform(-0.05, -0.02), 0.018 - r - rr.uniform(0.0, 0.01), 0.0021 + 0.003 * (i % 2)))
    P.grain_mesh("Spilled", spill, 0.0024, salt=2, squash=0.92, detail=1)


def silk():
    """Two bolts of smooth, shining cloth, one deep red, one gold-yellow,
    an end unrolled."""
    # roll shells are lathes whose local Z is the bolt's axis; the cloth's
    # warp runs round the roll, and along local Y on the unrolled end
    red = C.M("silk", colour=(0.42, 0.018, 0.035), axis="Z")
    gold = C.M("silk", colour=(0.86, 0.58, 0.10), axis="Z")
    gold_end = C.M("silk", colour=(0.86, 0.58, 0.10), axis="Y")
    red_end = C.M("silk", colour=(0.42, 0.018, 0.035), axis="Y")
    b1 = P.bolt("SilkRed", r=0.034, length=0.21, mat=red, unroll=0.035, salt=6, end_mat=red_end, wrinkle=0.0028)
    b1.location = (0.018, 0.045, 0)
    b1.rotation_euler = (0, 0, math.radians(-12))
    b2 = P.bolt("SilkGold", r=0.032, length=0.20, mat=gold, unroll=0.12, salt=7, end_mat=gold_end, wrinkle=0.0022)
    b2.location = (-0.012, -0.012, 0)
    b2.rotation_euler = (0, 0, math.radians(6))


# ---------------------------------------------------------------------------
# batch 2: the other ten
# ---------------------------------------------------------------------------
def _loop(name, pts, thick, mat, cyclic=True):
    """A cord or rope along a list of points (a closed loop by default)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    sp.use_cyclic_u = cyclic
    cu.bevel_depth = thick / 2
    cu.bevel_resolution = 3
    ob = bpy.data.objects.new(name, cu)
    C.link(ob)
    ob.data.materials.append(C.M(mat) if isinstance(mat, str) else mat)
    return ob


def _band(name, x, w, d, h, thick, mat, z0=0.0, salt=0, slack=0.0):
    """A cord tied round a box-shaped bundle: a rounded rectangle in the
    Y-Z plane at x, hugging a w (Y) by h (Z) cross-section."""
    r = C.rng(salt)
    pts = []
    hw, rr = w / 2 + thick * 0.4, thick * 1.5
    corners = [(hw - rr, h - rr), (-hw + rr, h - rr), (-hw + rr, rr), (hw - rr, rr)]
    starts = [0, 90, 180, 270]
    for (cy, cz), a0 in zip(corners, starts):
        for k in range(6):
            a = math.radians(a0 + 90 * k / 5)
            pts.append((x + r.uniform(-0.0006, 0.0006), cy + (rr + slack) * math.cos(a),
                        z0 + cz + (rr + slack) * math.sin(a) - thick * 0.2))
    return _loop(name, pts, thick, mat)


def gold():
    """A few gold coins and a small open leather pouch of gold dust."""
    pouch = P.sack("Pouch", r=0.036, h=0.052, roll=0.009, mat=C.M("leather", tint=(0.75, 0.55, 0.38)), salt=111)
    pouch.location = (0.022, 0.030, 0)
    dust_m = C.M("gold_dust")
    d = P.heap("Dust", r=0.032, h=0.014, mat=dust_m, salt=112, lumps=0.3)
    d.location = (0.022, 0.030, 0.052 - 0.009 * 1.6)
    sp = P.heap("DustSpill", r=0.022, h=0.004, mat=dust_m, salt=113, lumps=0.5)
    sp.location = (-0.020, 0.004, 0)
    sp.scale = (1.2, 0.8, 1.0)
    st = P.coin_stack("GoldStack", "gold", 5, salt=114)
    st.location = (-0.045, 0.030, 0)
    sc = P.coin_scatter("GoldLoose", [("gold", 6)], (0.07, 0.04), salt=115)
    sc.location = (-0.012, -0.040, 0)


def salt():
    """A grey-white slab of rock salt the size of a paving stone, roped."""
    W, D, H = 0.22, 0.13, 0.046
    s = P.block("SaltSlab", (W, D, H), mat="salt", chip=0.007, salt=121)
    s.rotation_euler = (0, 0, math.radians(-14))
    # two rope loops round its width, and a loose end trailing off
    ropes = []
    for i, x in enumerate((-0.062, 0.058)):
        ropes.append(_band("SaltRope%d" % i, x, D, D, H, 0.0095, C.M("rope"), salt=122 + i))
    tail = _loop("SaltRopeEnd", [(0.058, -D / 2 - 0.002, 0.012), (0.066, -D / 2 - 0.018, 0.004),
                                 (0.082, -D / 2 - 0.030, 0.0032), (0.104, -D / 2 - 0.034, 0.0032)],
                 0.0095, C.M("rope"), cyclic=False)
    for ob in ropes + [tail]:
        ob.parent = s


def porcelain():
    """A pale grey-green glazed bowl and a small jar: thick, smooth glaze,
    no painted pattern."""
    cel = C.M("glazed", colour=(0.36, 0.48, 0.39), rough=0.05, pool=0.8)
    b = P.bowl("CeladonBowl", r=0.072, h=0.050, wall=0.005, mat=cel, salt=131, jitter=0.006)
    b.location = (-0.030, -0.012, 0)
    j = P.jar("CeladonJar", r=0.036, h=0.085, neck=0.018, mat=cel, salt=132)
    j.location = (0.062, 0.040, 0)


def glass():
    """A blown bottle and a beaker, slightly green or amber, a little
    uneven."""
    g = C.M("glass", colour=(0.70, 0.84, 0.58), rough=0.03)
    a = C.M("glass", colour=(0.92, 0.70, 0.36), rough=0.03)
    bt = P.bottle("GlassBottle", r=0.042, h=0.185, mat=g, salt=141)
    bt.location = (0.026, 0.032, 0)
    bk = P.beaker("GlassBeaker", r=0.032, h=0.088, mat=a, salt=142)
    bk.location = (-0.052, -0.020, 0)


def _deckle_sheet(name, w, d, salt, mat):
    """A handmade sheet: slightly cockled, its edges rough and uneven."""
    r = C.rng(salt)
    nx, ny = 30, 22
    ph = [r.uniform(0, 50) for _ in range(3)]
    verts, faces = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x, y = (u - 0.5) * w, (v - 0.5) * d
            edge = (i in (0, nx)) or (j in (0, ny))
            if edge:
                from mathutils import noise as N
                k = 0.0022 * N.noise(Vector((x * 90 + ph[0], y * 90 + ph[1], salt)))
                k += 0.0009 * N.noise(Vector((x * 400, y * 400, ph[2])))
                if i in (0, nx):
                    x += k * (1 if i else -1)
                else:
                    y += k * (1 if j else -1)
            from mathutils import noise as N
            z = 0.0007 * N.noise(Vector((x * 25 + ph[0], y * 25, salt)))
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    ob = C.mesh_object(name, verts, faces, mat, True)
    sol = ob.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.0004
    return ob


def paper():
    """A stack of handmade sheets with rough edges, tied with cord."""
    W, D = 0.19, 0.135
    r = C.rng(151)
    sheets = []
    tones = [(0.72, 0.60, 0.42), (0.68, 0.57, 0.40), (0.75, 0.63, 0.45)]
    n = 22
    for i in range(n):
        m = C.M("paper", tone=tones[i % 3])
        sh = _deckle_sheet("Sheet%d" % i, W * r.uniform(0.985, 1.0), D * r.uniform(0.985, 1.0), 152 + i, m)
        sh.location = (r.uniform(-0.002, 0.002), r.uniform(-0.002, 0.002), 0.0004 + i * 0.00105)
        sh.rotation_euler = (0, 0, math.radians(r.uniform(-1.2, 1.2)))
        sheets.append(sh)
    H = n * 0.00105 + 0.001
    cords = [_band("PaperCordA", 0.0, D, D, H, 0.0028, C.M("rope", colour=(0.55, 0.42, 0.28)), salt=181,
                   slack=-0.0008)]
    cb = _band("PaperCordB", 0.0, W, W, H, 0.0028, C.M("rope", colour=(0.55, 0.42, 0.28)), salt=182, slack=-0.0008)
    cb.rotation_euler = (0, 0, math.pi / 2)
    cords.append(cb)
    # the knot on top: a small lump where the cords cross, and two loose ends
    knot = P.heap("PaperKnot", r=0.0055, h=0.004, mat=C.M("rope", colour=(0.55, 0.42, 0.28)), salt=183, lumps=0.4)
    knot.location = (0, 0, H)
    for k, (dx, dy) in enumerate(((0.018, -0.026), (0.030, -0.012))):
        _loop("PaperCordEnd%d" % k, [(0.002, 0, H + 0.002), (dx * 0.5, dy * 0.5, H + 0.0014), (dx, dy, H + 0.001)],
              0.0026, C.M("rope", colour=(0.55, 0.42, 0.28)), cyclic=False)
    grp = P.group("PaperStack", sheets + cords + [knot], rot_z=math.radians(-10))
    return grp


def linen():
    """Folded lengths of off-white cloth, matt, a visible weave."""
    m = C.M("linen", colour=(0.70, 0.63, 0.49), scale=6.0)
    a = P.folded_cloth("LinenA", w=0.20, d=0.13, layers=4, thick=0.008, mat=m, salt=161)
    a.location = (0.004, 0.012, 0)
    a.rotation_euler = (0, 0, math.radians(-8))
    b = P.folded_cloth("LinenB", w=0.18, d=0.12, layers=3, thick=0.008, mat=m, salt=162)
    b.location = (-0.008, 0.004, 4 * 0.008 * 0.92 + 0.001)
    b.rotation_euler = (0, 0, math.radians(7))


def _sugar_cone(name, h, r, salt, chip=None):
    """A tall cone of hard sugar with a rounded tip and a slightly concave
    base. chip=(height fraction, depth) cuts a flat broken facet off one
    side near the tip."""
    prof = [(0.0, 0.004), (r * 0.6, 0.002), (r, 0.0), (r * 1.01, 0.006)]
    for i in range(1, 15):
        t = i / 14
        prof.append((r * (1 - t) ** 1.05 * (1 + 0.03 * math.sin(t * 9)) + 0.004 * t, 0.006 + (h - 0.012) * t))
    prof += [(0.004, h - 0.002), (0.0, h)]
    ob = C.lathe(name, prof, 64, C.M("sugar"), True, jitter=0.02, salt=salt)
    if chip:
        tz, dep = chip
        zc = h * tz
        # the radius there, then a plane cutting dep into the side facing the camera
        rz = r * (1 - tz) ** 1.05 + 0.004 * tz
        n = Vector((0.15, -1.0, 0.55)).normalized()
        p0 = Vector((0, -rz + dep, zc))
        for v in ob.data.vertices:
            dd = (v.co - p0).dot(n)
            if dd > 0:
                v.co -= n * dd
    C.subsurf(ob, 1)
    tex = bpy.data.textures.new(name + "_g", "CLOUDS")
    tex.noise_scale = 0.004
    dm = ob.modifiers.new("Grain", "DISPLACE")
    dm.texture = tex
    dm.strength = 0.0008
    dm.texture_coords = "OBJECT"
    return ob


def sugar():
    """Two tall white cones of hard sugar, one chipped."""
    a = _sugar_cone("SugarA", 0.20, 0.046, 171)
    a.location = (0.036, 0.034, 0)
    b = _sugar_cone("SugarB", 0.175, 0.042, 172, chip=(0.50, 0.022))
    b.location = (-0.040, -0.018, 0)
    # a few broken crumbs from the chip
    P.grain_mesh("SugarCrumbs", [(-0.012, -0.060, 0.0025), (-0.002, -0.052, 0.002), (-0.020, -0.070, 0.0018),
                                 (0.006, -0.066, 0.0015)], 0.0032, salt=173, squash=0.6, mat=C.M("sugar"))


def incense():
    """A bowl of pale yellow resin lumps beside a small brass burner."""
    bw = P.bowl("ResinBowl", r=0.062, h=0.036, wall=0.005, mat=C.M("clay", colour=(0.55, 0.36, 0.24)),
                foot=True, salt=181, jitter=0.012)
    bw.location = (0.030, 0.020, 0)
    pts = P.mound_points(0.052, 0.016, 0.0085, center=(0.030, 0.020, 0.026), salt=182)
    P.grain_mesh("Resin", pts, 0.0058, salt=183, squash=0.62, mat=C.M("resin"), detail=1, lumpy=0.35)
    P.grain_mesh("ResinSpill", [(-0.010, -0.040, 0.003), (-0.002, -0.050, 0.0028), (0.012, -0.046, 0.003)],
                 0.0055, salt=184, squash=0.62, mat=C.M("resin"), lumpy=0.35)
    # the burner: a footed brass cup with a pierced-looking domed lid
    br = C.M("brass")
    prof = [(0.0, 0.0), (0.020, 0.0), (0.021, 0.003), (0.012, 0.006), (0.007, 0.012), (0.007, 0.020),
            (0.015, 0.024), (0.022, 0.034), (0.023, 0.040), (0.021, 0.041), (0.022, 0.043),
            (0.020, 0.049), (0.013, 0.057), (0.006, 0.061), (0.004, 0.066), (0.006, 0.070), (0.0, 0.074)]
    burner = C.lathe("Burner", prof, 48, C.M("brass_pierced"), True, jitter=0.004, salt=185)
    burner.location = (-0.058, 0.040, 0)
    C.subsurf(burner, 1)
    # a short flat handle out to the side
    hd = C.box_mesh("BurnerHandle", (0.034, 0.008, 0.003), (-0.058 - 0.034, 0.040, 0.030), br)
    C.bevel(hd, 0.0012, 2)


def copper():
    """A stack of rough red-brown bars, laid in crossing courses."""
    r = C.rng(191)
    L, Wb, Hb = 0.15, 0.030, 0.018
    for layer in range(3):
        rot = (layer % 2) * math.pi / 2
        n = 3 if layer < 2 else 2
        for k in range(n):
            off = (k - (n - 1) / 2) * (Wb + 0.006)
            b = P.block("CuBar%d%d" % (layer, k), (L * r.uniform(0.92, 1.0) * (0.75 if layer % 2 else 1.0),
                        Wb * r.uniform(0.92, 1.05), Hb * r.uniform(0.9, 1.1)), mat="copper_bar",
                        chip=0.005, salt=192 + layer * 5 + k)
            x, y = (off, 0) if layer % 2 else (0, off)
            b.location = (x + r.uniform(-0.003, 0.003), y + r.uniform(-0.002, 0.002), layer * (Hb + 0.0004))
            b.rotation_euler = (r.uniform(-0.02, 0.02), r.uniform(-0.02, 0.02), rot + r.uniform(-0.06, 0.06) + math.radians(-12))
            # cast bars taper: narrower on top
            for v in b.data.vertices:
                if v.co.z > Hb * 0.5:
                    v.co.x *= 0.93
                    v.co.y *= 0.82


def wool():
    """A heavy bolt of dark blue cloth, thick and matt."""
    m = C.M("wool", colour=(0.010, 0.016, 0.050))
    me = C.M("wool", colour=(0.010, 0.016, 0.050), scale=3.01)
    b = P.bolt("WoolBolt", r=0.052, length=0.22, mat=m, unroll=0.10, salt=201, end_mat=me)
    b.location = (0.0, 0.022, 0)
    b.rotation_euler = (0, 0, math.radians(-8))


GOODS = {"pepper": pepper, "silk": silk, "gold": gold, "salt": salt, "porcelain": porcelain,
         "glass": glass, "paper": paper, "linen": linen, "sugar": sugar, "incense": incense,
         "copper": copper, "wool": wool}


# Some goods are physically small (a pouch of gold dust, a burner); each is
# scaled up as a whole so all twelve fill the frame alike, as the rig asks.
SCALE = {"gold": 1.7, "incense": 1.4, "copper": 1.25, "sugar": 0.95}


def _scale_scene(k):
    if k == 1.0:
        return
    root = bpy.data.objects.new("GoodRoot", None)
    C.link(root)
    for ob in list(bpy.context.scene.objects):
        if ob.parent is None and ob is not root and ob.type in {"MESH", "CURVE", "EMPTY"}:
            ob.parent = root
    root.scale = (k, k, k)


def build(good):
    C.reset()
    C.setup_render(1536, 1536, transparent=True, exposure=-0.9)
    C.window_light(az=-48.0, elev=56.0, dist=1.6, size=(0.7, 0.55), energy=110.0, fill=0.35)
    GOODS[good]()
    _scale_scene(SCALE.get(good, 1.0))
    C.shadow_catcher(1.5, 0.0)
    cam = C.tilt_camera("table", (0.0, 0.0, 0.035), 0.52, 35.0, fstop=8.0)
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--good", default="pepper", choices=list(GOODS)))
    build(C.ARGS.good)
    C.save_cutout("good-" + C.ARGS.good, GOOD_SHIP, "good")
    C.write_log("a15-" + C.ARGS.good)


main()
