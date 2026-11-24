"""A17 event plates, all stills.

    blender -b --factory-startup -P scripts/a17_events.py -- --preview --plate storm|sandstorm|toll|procession|harbour

storm       storm-sea.webp       a ship climbing a great grey swell
sandstorm   sandstorm.webp       A08's dunes, a wall of dust rolling in, a caravan halted
toll        toll-gate.webp       a dry valley road closed by a small fort and a bar
procession  procession.webp      the king of Mali camps by the pyramids, 1324
harbour     harbour-empty.webp   A06's harbour, overcast, bare (A06 --dress empty)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_figures as F     # noqa: E402
import kit_props as P       # noqa: E402
import kit_ships as S       # noqa: E402
import kit_terrain as T     # noqa: E402
import bpy                  # noqa: E402
import numpy as np          # noqa: E402
from mathutils import Vector  # noqa: E402


def _emit(name, colour, strength):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*colour, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    return m


# ---------------------------------------------------------------------------
# harbour-empty: A06 with --dress empty under overcast
# ---------------------------------------------------------------------------
def harbour():
    import a06_alexandria as H
    return H.build("empty", "overcast")


# ---------------------------------------------------------------------------
# sandstorm: A08's field, a wall of dust from the left, the sun a dull disc
# ---------------------------------------------------------------------------
def dust_wall(lo, hi, density, colour):
    """A towering front of dust: thick behind, its leading edge (the +X
    side of the box) billowing and broken, thinning toward the top."""
    def build(nt, v):
        v.inputs["Color"].default_value = (*colour, 1)
        v.inputs["Anisotropy"].default_value = 0.75     # forward scatter: the backlit dust glows
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.004
        nz.inputs["Detail"].default_value = 6
        nz.inputs["Roughness"].default_value = 0.6
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        # front: generated X + noise wobble against a threshold
        wob = nt.nodes.new("ShaderNodeMath")
        wob.operation = "MULTIPLY_ADD"
        nt.links.new(nz.outputs["Fac"], wob.inputs[0])
        wob.inputs[1].default_value = -0.35
        nt.links.new(sep.outputs["X"], wob.inputs[2])
        front = nt.nodes.new("ShaderNodeMapRange")
        front.inputs["From Min"].default_value = 0.62
        front.inputs["From Max"].default_value = 0.42
        nt.links.new(wob.outputs[0], front.inputs["Value"])
        # the top: billows thinning upward, a lumpy upper edge
        top = nt.nodes.new("ShaderNodeMath")
        top.operation = "MULTIPLY_ADD"
        nt.links.new(nz.outputs["Fac"], top.inputs[0])
        top.inputs[1].default_value = 0.45
        nt.links.new(sep.outputs["Z"], top.inputs[2])
        tf = nt.nodes.new("ShaderNodeMapRange")
        tf.inputs["From Min"].default_value = 1.05
        tf.inputs["From Max"].default_value = 0.7
        nt.links.new(top.outputs[0], tf.inputs["Value"])
        m1 = nt.nodes.new("ShaderNodeMath")
        m1.operation = "MULTIPLY"
        nt.links.new(front.outputs[0], m1.inputs[0])
        nt.links.new(tf.outputs[0], m1.inputs[1])
        m2 = nt.nodes.new("ShaderNodeMath")
        m2.operation = "MULTIPLY"
        nt.links.new(m1.outputs[0], m2.inputs[0])
        m2.inputs[1].default_value = density
        nt.links.new(m2.outputs[0], v.inputs["Density"])
    ob = T._vol_box("DustWall", lo, hi, build)
    ob.visible_shadow = True          # the wall shades the ground in front of it
    return ob


def sandstorm():
    import a08_sahara as D
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=-1.2)
    # the sun low ahead-left, about to be swallowed by the dust
    C.sky("late", sun_turn=8.0, elev=5.0, strength=1.2)
    C.haze(0.00006, (0.86, 0.62, 0.40), 0.6, top=800.0, extent=16000.0)
    ob, Z, f = D.build_field()
    zc = T.sample(Z, ob, D.CAM[0], D.CAM[1])
    cam = C.camera("long", (D.CAM[0], D.CAM[1], zc + D.CAM_EYE), (D.CAM[0] + 520.0, 1900.0, 40.0))
    # the wall: hundreds of metres high, rolling in from the left
    dust_wall((-500.0, 2200.0, -50.0), (1400.0, 9000.0, 800.0), 0.0035, (0.95, 0.68, 0.42))
    # a caravan halted on a flank below, camels kneeling as small dark shapes
    dark = C.M("dark", colour=(0.05, 0.035, 0.025))
    r = C.rng(1701)
    k = 0
    for i in range(16):
        x, y = 420.0 + r.uniform(-30, 30), 900.0 + r.uniform(-25, 25)
        z = float(f(np.array([x]), np.array([y]))[0])
        if i < 12:
            ob_ = F.camel("Kneel%d" % i, 1, dark, height=2.0, kneel=True, load=("salt" if i % 2 else "bales"))
        else:
            ob_ = F.cloaked_figure("Fig%d" % i, dark, 1.7)
        F.place(ob_, (x, y, z - 0.1), math.radians(r.uniform(150, 210)), cam)
    return cam


# ---------------------------------------------------------------------------
# toll gate: a dry valley road, a small stone fort, a bar across the way
# ---------------------------------------------------------------------------
def toll():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=-2.4)
    C.sky("day", sun_turn=-60.0, elev=48.0)          # harsh, high
    C.haze(0.00012, (0.88, 0.82, 0.72), 0.4, extent=5000.0, top=500.0)

    def valley(X, Y):
        road_x = 12.0 * np.sin(Y / 140.0)
        dx = np.abs(X - road_x)
        sides = 160.0 * np.clip((dx - 40.0) / 380.0, 0, 1) ** 1.3
        rough = (60.0 * T.ridged(X, Y, 220.0, 5, 171) + 12.0 * T.ridged(X, Y, 40.0, 4, 173)) * np.clip((dx - 30) / 200.0, 0, 1)
        return 0.02 * Y + sides + rough + 0.5 * T.fbm(X, Y, 20.0, 3, 172)
    gob, Z = T.heightfield("Valley", -1500, 1500, -60, 3000, 400, 480, valley, C.M("rocky_ground", scale=0.25), py=1.6)
    h = lambda x, y: T.sample(Z, gob, x, y)
    # the road: a pale trodden band
    rm = C._NB("road")
    rm.m = C.M("rocky_ground", scale=0.6, tint=(0.80, 0.64, 0.46))
    verts, faces = [], []
    ys = np.linspace(-50, 1400, 400)
    for i, y in enumerate(ys):
        x = 12.0 * math.sin(y / 140.0)
        for s in (-1, 1):
            verts.append((x + s * 3.0, y, h(x + s * 3.0, y) + 0.05))
        if i:
            a = 2 * (i - 1)
            faces.append((a, a + 1, a + 3, a + 2))
    C.mesh_object("Road", verts, faces, rm.m)
    # the fort: a square tower and a walled yard beside the road, at y ~ 260
    stone = C.M("pale_block", scale=0.3, tint=(0.95, 0.82, 0.66))
    fy = 260.0
    rx = 12.0 * math.sin(fy / 140.0)
    gz = h(rx, fy)
    fx = rx + 22.0
    A.tower("FortTower", 12.0, 12.0, 15.0, stone, loc=(fx + 6.0, fy + 8.0, gz - 1.0))
    for (cx, cy, sx, sy) in ((fx, fy - 2.0, 26.0, 1.4), (fx, fy + 22.0, 26.0, 1.4), (fx - 12.3, fy + 10.0, 1.4, 25.4),
                             (fx + 12.3, fy + 10.0, 1.4, 25.4)):
        C.box_mesh("FortWall", (sx, sy, 7.0), (cx, cy, gz - 1.0 + 3.5), stone)
    A.merlons("FortMerA", fx - 13.0, fx + 13.0, gz + 6.0, 1.0, stone, y=fy - 2.0)
    # a wall across the valley floor from the fort to the far side, with the gap of the road
    C.box_mesh("Barrier", (40.0, 1.6, 4.0), (rx - 26.0, fy - 2.0, gz + 1.0), stone)
    # the bar: a heavy pole across the road on two posts
    wood = C.M("plain_wood", tint=(0.55, 0.42, 0.30))
    for s in (-1, 1):
        C.box_mesh("BarPost%d" % s, (0.4, 0.4, 1.6), (rx + s * 4.2, fy - 2.6, gz + 0.8), wood)
    bar = S.rod("Bar", (rx - 4.6, fy - 2.6, gz + 1.25), (rx + 4.6, fy - 2.6, gz + 1.25), 0.14, wood)
    # a plain banner on the tower, no device
    pole = S.rod("BannerPole", (fx + 6.0, fy + 8.0, gz + 14.0), (fx + 6.0, fy + 8.0, gz + 22.0), 0.08, wood)
    cloth = C.M("wool", colour=(0.42, 0.10, 0.06))
    verts, faces = [], []
    for i in range(9):
        for j in range(5):
            u, v = i / 8, j / 4
            verts.append((fx + 6.0 - u * 3.6, fy + 8.0 + 0.25 * math.sin(u * 5 + v), gz + 21.6 - v * 1.8 - u * 0.3))
    for i in range(8):
        for j in range(4):
            a = i * 5 + j
            faces.append((a, a + 1, a + 6, a + 5))
    C.mesh_object("Banner", verts, faces, cloth, True)
    cam = C.camera("normal", (rx - 3.0, fy - 95.0, h(rx - 3.0, fy - 95.0) + 1.7), (fx - 8.0, fy, gz + 5.0))
    # a few distant guards on the wall, cloaked shapes
    dark = C.M("dark", colour=(0.06, 0.05, 0.04))
    for i, (gx, gy, gzz) in enumerate(((fx - 6.0, fy - 2.2, gz + 6.0), (fx + 2.0, fy - 2.2, gz + 6.0),
                                      (fx + 6.0, fy + 2.0, gz + 14.0))):
        F.place(F.cloaked_figure("Guard%d" % i, dark, 1.7), (gx, gy, gzz), math.radians(-90), cam)
    return cam


# ---------------------------------------------------------------------------
# storm at sea: a ship small in the frame climbing a great grey swell
# ---------------------------------------------------------------------------
def storm():
    import kit_models as KM
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=1.0)
    # a dense photographed overcast, darkened almost to black
    KM.sky_photo("mud_road_puresky", sun_turn=160.0, strength=0.5, tint=(0.42, 0.45, 0.47), contrast=1.0)
    C.haze(0.0011, (0.40, 0.43, 0.45), 0.2, extent=6000.0, top=600.0)
    # a full gale sea: big, steep, wind-driven waves breaking white at the crests
    sea = T.ocean("Swell", tile=280.0, repeat=9, res=15, waves=7.5, chop=2.2, wind=32.0, seed=181, align=0.6,
                  direction=math.radians(90), foam=-0.45, damping=0.3,
                  mat=T.ocean_water(colour=(0.010, 0.019, 0.021), foam_col=(0.70, 0.73, 0.74), foam_gain=1.2, foam_lo=0.15, foam_hi=0.7, crest=(1.5, 4.5),
                                     streaks=0.55, streak_dir=0.0),
                  loc=(0.0, 900.0, 0.0))
    # the ship on the face of a wave: sample the evaluated sea round it
    sx, sy = 20.0, 520.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = sea.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world
    pts = []
    for v in me.vertices:
        p = mw @ v.co
        if abs(p.x - sx) < 16 and abs(p.y - sy) < 16:
            pts.append((p.x, p.y, p.z))
    ev.to_mesh_clear()
    P_ = np.array(pts) if pts else np.array([[sx, sy, 0.0]])
    A_ = np.c_[P_[:, 0] - sx, P_[:, 1] - sy, np.ones(len(P_))]
    coef = np.linalg.lstsq(A_, P_[:, 2], rcond=None)[0] if len(P_) > 3 else np.array([0.0, 0.0, 0.0])
    sz = float(coef[2])
    HEAD = 205.0                      # broadside-on, heeled, the sail toward the light
    hx, hy = math.cos(math.radians(HEAD)), math.sin(math.radians(HEAD))
    pitch = math.atan(coef[0] * hx + coef[1] * hy)
    roll = math.atan(-coef[0] * hy + coef[1] * hx)
    ship = S.round_ship("StormShip", 26.0, "bare", masts=2)
    ship.location = (sx, sy, sz + 0.6)
    ship.rotation_euler = (roll * 0.8 + math.radians(-8), -pitch, math.radians(HEAD))
    # the torn sail: a lateen on the foremast, ragged, holed
    tear = C.M("sailcloth", colour=(0.36, 0.33, 0.28))
    parts = S.lateen_rig("Torn", 26.0 * 0.18, 26.0 * 0.22 * 0.5 - 0.15, 26.0 * 0.95, 26.0 * 1.0, 30, "set",
                         mat_sail=tear, swing=35.0)
    for ob in parts:
        if ob.name.startswith("Torn_sail"):
            r = C.rng(1801)
            me = ob.data
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(me)
            # refine first, so the tears follow ragged lines, not the triangle grid
            bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
            from mathutils import noise as N
            top = max(v.co.z for v in bm.verts)
            kill = []
            for f in bm.faces:
                c = f.calc_center_median()
                n1 = N.noise(c * 0.22 + Vector((17.3, 5.2, 0)))   # chosen so no pattern of holes reads as a face
                n2 = N.noise(c * 1.6)
                rag = (c.z - top * 0.62) / (top * 0.38) + 0.35 * n2       # the upper sail blown out raggedly
                if n1 + 0.25 * n2 > 0.30 or rag > 0.55:
                    kill.append(f)
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            bm.to_mesh(me)
            bm.free()
        ob.parent = ship
    # spray off the bow
    T.streak_volume("Spray", (sx - 10, sy - 30, sz - 1), (sx + 30, sy + 5, sz + 14), 0.25, (0.80, 0.82, 0.83),
                    streak=(0, 1, 0), scale=0.3, thresh=0.55, anis=0.3)
    cam = C.camera("long", (0.0, 0.0, 14.0), (sx, sy, sz + 7.0))
    # spray torn off the nearer crests by the wind
    r = C.rng(1811)
    for k in range(7):
        x, y = r.uniform(-140, 160), r.uniform(150, 450)
        T.streak_volume("Spindrift%d" % k, (x - 40, y - 6, 1.0), (x + 40, y + 6, 9.0), 0.10, (0.80, 0.82, 0.83),
                        streak=(1, 0, 0), scale=0.15, thresh=0.5, anis=0.3)
    return cam


# ---------------------------------------------------------------------------
# procession: Mansa Musa's camp by the pyramids, 1324
# ---------------------------------------------------------------------------
def _tent_mesh(name, w, d, h, mat, kind=0, salt=0):
    """Cloth tents seen from far off. kind 0: a round bell tent (a cone
    sagging between its ribs over a short wall); kind 1: a ridge tent whose
    cloth sags between the ridge pole and the side ropes."""
    r = C.rng(salt)
    if kind == 0:
        R = w * 0.55
        prof = [(0, 0), (R, 0), (R * 1.02, h * 0.28), (R * 0.95, h * 0.33)]
        for i in range(1, 7):
            t = i / 6
            prof.append((R * 0.95 * (1 - t) ** 1.25, h * 0.33 + (h * 0.67) * t ** 0.9))
        ob = C.lathe(name, prof, 24, mat, True, jitter=0.03, salt=salt)
        for v in ob.data.vertices:                  # sag between 8 ribs
            a = math.atan2(v.co.y, v.co.x)
            if v.co.z > h * 0.3:
                k = 1.0 - 0.06 * (0.5 + 0.5 * math.cos(a * 8 + math.pi))
                v.co.x *= k
                v.co.y *= k
        return ob
    nx, ny = 10, 8
    verts, faces = [], []
    for j in range(ny + 1):
        y = (j / ny - 0.5) * d
        side = abs(y) / (d / 2)                    # 0 at ridge, 1 at the eaves
        for i in range(nx + 1):
            x = (i / nx - 0.5) * w
            ridge_sag = 0.12 * h * (1 - (2 * i / nx - 1) ** 2)
            z = h * (1 - side) * 0.62 + h * 0.38 - ridge_sag * (1 - side)
            z -= 0.10 * h * math.sin(side * math.pi)          # the cloth bellies down between ridge and eave
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    roof = C.mesh_object(name, verts, faces, mat, True)
    sol = roof.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.06
    # short cloth walls front and back, and the gable ends
    me = roof.data
    for sgn in (-1, 1):
        wall = C.box_mesh(name + "_w%d" % sgn, (w, 0.05, h * 0.38), (0, sgn * d / 2, h * 0.19), mat)
        wall.parent = roof
    for sgn in (-1, 1):
        g = C.mesh_object(name + "_g%d" % sgn, [(sgn * w / 2, -d / 2, 0), (sgn * w / 2, d / 2, 0),
                                                (sgn * w / 2, d / 2, h * 0.38), (sgn * w / 2, 0, h),
                                                (sgn * w / 2, -d / 2, h * 0.38)], [(0, 1, 2, 3, 4)], mat)
        g.parent = roof
    return roof


def pyramid(name, base, height, mat, loc, stripped=0.0):
    """A pyramid. Most of its smooth outer casing still on in 1324: the
    casing material over the whole face, a rougher stepped band near the
    foot where stone is being taken (stripped = fraction of height)."""
    x, y, z = loc
    b = base / 2
    verts = [(x - b, y - b, z), (x + b, y - b, z), (x + b, y + b, z), (x - b, y + b, z), (x, y, z + height)]
    faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)]
    ob = C.mesh_object(name, verts, faces, mat)
    if stripped > 0:
        core = C.M("pale_block", scale=0.05, tint=(0.85, 0.74, 0.58))
        hh = height * stripped
        bb = b * (1 - stripped)
        s = 1.004
        verts2 = [(x - b * s, y - b * s, z), (x + b * s, y - b * s, z), (x + b * s, y + b * s, z), (x - b * s, y + b * s, z),
                  (x - bb * s, y - bb * s, z + hh), (x + bb * s, y - bb * s, z + hh), (x + bb * s, y + bb * s, z + hh),
                  (x - bb * s, y + bb * s, z + hh)]
        C.mesh_object(name + "_strip", verts2, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], core)
    return ob


GREEN_X = -330.0           # west of this line (left of the view) the Nile cultivation begins


def _ground_mat():
    """Desert and sown land in one material: sand and stony ground on the
    desert, a mosaic of green and fallow fields on the cultivation
    (Position X past GREEN_X), the edge between them ragged."""
    b = C._NB("giza_ground")
    geo = b.n("ShaderNodeNewGeometry")
    sp = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Position"], sp.inputs[0])
    diff, nor, rough, disp = C._tex_paths("rock_face")
    t = b.n("ShaderNodeTexImage")
    t.image = C._img(diff)
    t.projection = "BOX"
    b.link(b.coords(0.12), t.inputs["Vector"])
    hs = b.n("ShaderNodeHueSaturation", Saturation=0.6, Value=1.5)
    b.link(t.outputs["Color"], hs.inputs["Color"])
    stony = b.mix(1.0, hs.outputs[0], (1.0, 0.80, 0.58), "MULTIPLY")
    big = b.noise(b.coords(1.0), 0.003, 4, 0.6)
    sand = b.mix(b.ramp(big.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.35, 0.7).outputs[0], (0.78, 0.58, 0.36), (0.88, 0.70, 0.46))
    patch = b.ramp(b.noise(b.coords(1.0), 0.03, 5, 0.6).outputs["Fac"], (0, 0, 0), (0.45, 0.45, 0.45), 0.5, 0.7)
    desert = b.mix(patch.outputs[0], sand, stony)
    vor = b.n("ShaderNodeTexVoronoi", Scale=0.012)
    b.link(b.coords(1.0), vor.inputs["Vector"])
    fcol = b.ramp(vor.outputs["Color"], (0.10, 0.17, 0.05), (0.30, 0.30, 0.12), 0.3, 0.8)
    ditch = b.math("LESS_THAN", vor.outputs["Distance"], 0.06)
    fields = b.mix(ditch, fcol.outputs[0], (0.22, 0.17, 0.10))
    edge_n = b.noise(b.coords(1.0), 0.004, 3, 0.5)
    ex = b.math("ADD", sp.outputs["X"], b.math("MULTIPLY", b.math("SUBTRACT", edge_n.outputs["Fac"], 0.5), 300.0))
    sown = b.band(ex, GREEN_X + 60.0, GREEN_X - 60.0)
    col = b.mix(sown, desert, fields)
    b.link(col, b.bsdf.inputs["Base Color"])
    tn = b.n("ShaderNodeTexImage")
    tn.image = C._img(nor, True)
    tn.projection = "BOX"
    b.link(b.coords(0.12), tn.inputs["Vector"])
    nm = b.n("ShaderNodeNormalMap", Strength=0.8)
    b.link(tn.outputs["Color"], nm.inputs["Color"])
    b.link(nm.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.9)
    return b.m


def procession():
    import kit_models as KM
    import kit_plants as PL
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=-2.0)
    C.sky("late", sun_turn=-95.0)                      # west, low: gold light from the left
    C.haze(0.00020, (0.95, 0.76, 0.50), 0.6, extent=12000.0, top=500.0)

    def plain(X, Y):
        z = 3.0 * T.fbm(X, Y, 400.0, 4, 191) + 0.6 * T.fbm(X, Y, 30.0, 3, 192)
        # low dunes drifted against the desert edge, flattening toward the sown land
        dunes = T.dune_fn(wavelength=140.0, height=7.0, wind_deg=-20.0, seed=193, draa=0.4)(X, Y)
        z = z + dunes * np.clip((X - GREEN_X) / 400.0, 0, 1) * np.clip((Y - 600.0) / 600.0, 0, 1)
        z = z - 4.0 * np.clip((GREEN_X - X) / 200.0, 0, 1)          # the valley floor lies lower
        # the plateau the pyramids stand on rises beyond the camp, a broken scarp
        scarp = np.clip((Y - 3200.0 - 120.0 * T.fbm(X, Y, 500.0, 3, 194)) / 300.0, 0, 1)
        z = z + 38.0 * scarp ** 1.5 + (14.0 * T.ridged(X, Y, 160.0, 5, 195) + 8.0 * T.fbm(X, Y, 600.0, 3, 196)) * scarp
        # the camera's rise
        z = z + 170.0 * np.exp(-((X / 420.0) ** 2 + ((Y + 120.0) / 360.0) ** 2))
        return z
    gob, Z = T.heightfield("Plain", -6000, 6000, -300, 12000, 560, 700, plain, _ground_mat(), py=2.0)
    h = lambda x, y: T.sample(Z, gob, x, y)
    # casing: dressed, weathered limestone, streaked and patchy
    casing = C._NB("casing")
    cvec = casing.coords(1.0)
    cn = casing.noise(cvec, 0.05, 5, 0.6)
    cmap = casing.n("ShaderNodeMapping")
    cmap.inputs["Scale"].default_value = (0.6, 0.6, 0.04)
    casing.link(cvec, cmap.inputs["Vector"])
    cs = casing.n("ShaderNodeTexNoise", Scale=1.0, Detail=5.0, Roughness=0.6)
    casing.link(cmap.outputs[0], cs.inputs["Vector"])
    cc = casing.mix(casing.ramp(cn.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.3, 0.75).outputs[0], (0.60, 0.48, 0.33), (0.74, 0.62, 0.45))
    cc = casing.mix(casing.ramp(cs.outputs["Fac"], (0, 0, 0), (0.5, 0.5, 0.5), 0.5, 0.8).outputs[0], cc, (0.42, 0.34, 0.25))
    casing.link(cc, casing.bsdf.inputs["Base Color"])
    cb = casing.bump(cn.outputs["Fac"], 0.2, 0.5)
    casing.link(cb.outputs[0], casing.bsdf.inputs["Normal"])
    casing.set(Roughness=0.55, Specular_IOR_Level=0.45)
    pz = 38.0
    pyramid("Khufu", 230.0, 146.0, casing.m, (300.0, 4300.0, pz), stripped=0.18)
    pyramid("Khafre", 215.0, 143.0, casing.m, (-150.0, 4700.0, pz + 10.0), stripped=0.04)
    pyramid("Menkaure", 105.0, 65.0, casing.m, (-480.0, 5050.0, pz + 4.0), stripped=0.12)
    # the largest has lost its capstone: a small flat platform at the top
    C.box_mesh("KhufuTop", (9.0, 9.0, 3.0), (300.0, 4300.0, pz + 140.0), casing.m)
    # rubble and quarried blocks heaped at their feet
    r0 = C.rng(1905)
    core = C.M("pale_block", scale=0.06, tint=(0.82, 0.70, 0.52))
    for (px, py, b_) in ((300.0, 4300.0, 230.0), (-150.0, 4700.0, 215.0), (-480.0, 5050.0, 105.0)):
        for k in range(45):
            side = r0.randrange(4)
            u = r0.uniform(-0.5, 0.5) * b_
            off = b_ / 2 + r0.uniform(2, 18)
            x, y = [(px + u, py - off), (px + off, py + u), (px + u, py + off), (px - off, py + u)][side]
            s_ = r0.uniform(1.5, 4.0)
            blk = P.block("Rub%d_%d" % (int(px), k), (s_, s_ * 0.8, s_ * 0.6), core, chip=0.3, salt=1906 + k)
            blk.location = (x, y, h(x, y) + r0.uniform(-0.5, 0.5))
            blk.rotation_euler = (r0.uniform(-0.3, 0.3), r0.uniform(-0.3, 0.3), r0.uniform(0, 3))
    # the sown land: date palm groves along the cultivation edge and over the fields
    palm_coll = bpy.data.collections.new("PalmProto")
    for k in range(4):
        pg = PL.coconut_palm_fine("DatePalm%d" % k, r0.uniform(11, 15), lean=(0.0, 0.0), bend=0.02, salt=1970 + k, fronds=26)
        for o in [pg] + list(pg.children_recursive):
            for c in list(o.users_collection):
                c.objects.unlink(o)
            palm_coll.objects.link(o)
    for k in range(900):
        x = GREEN_X - 40.0 - 2500.0 * r0.random() ** 1.6
        y = r0.uniform(500, 6000)
        e = bpy.data.objects.new("Palm%d" % k, None)
        e.instance_type = "COLLECTION"
        e.instance_collection = palm_coll
        C.link(e)
        e.location = (x, y, h(x, y))
        e.rotation_euler = (0, 0, r0.uniform(0, 6.28))
        sc = r0.uniform(0.8, 1.15)
        e.scale = (sc, sc, sc)
    # desert scrub scattered over the sand, clear of the camp
    in_camp = lambda x, y: x ** 2 / 650.0 ** 2 + (y - 2200) ** 2 / 380.0 ** 2 < 1.4
    KM.scatter("wild_rooibos_bush", 500, (-600, 2500, 300, 3200), h, 1975, scale=(1.5, 3.0), avoid=in_camp, name="Scrub")
    KM.scatter("searsia_burchellii", 160, (-600, 2500, 300, 3200), h, 1976, scale=(1.5, 3.0), avoid=in_camp, name="Bush")
    # the great stone head beside them, buried to the neck in sand. Seen from
    # far off and from the side: a weathered rounded mass with its headcloth
    # flaps, no face modelled
    head = C.lathe("Head", [(0, 0), (5.5, 0), (6.0, 6.0), (5.0, 11.0), (3.0, 14.0), (0, 15.0)], 16,
                   C.M("limestone", colour=(0.70, 0.58, 0.42)), True, jitter=0.12, salt=1901)
    head.location = (520.0, 3900.0, h(520.0, 3900.0) - 2.0)
    head.scale = (1.3, 1.0, 1.0)
    for s in (-1, 1):
        flap = C.box_mesh("Flap%d" % s, (2.0, 5.0, 9.0), (520.0 + s * 7.4, 3901.0, h(520.0, 3900.0) + 3.0),
                          C.M("limestone", colour=(0.70, 0.58, 0.42)))
    # the camp: hundreds of tents across the plain, camels in lines, people
    cloths = [C.M("linen", colour=c) for c in ((0.66, 0.58, 0.44), (0.58, 0.48, 0.34), (0.72, 0.66, 0.54),
                                               (0.45, 0.28, 0.17), (0.52, 0.40, 0.24), (0.30, 0.22, 0.16))]
    r = C.rng(1910)
    tents = {}
    for k, m in enumerate(cloths):
        tents[k] = _tent_mesh("TentProto%d" % k, 7.0, 5.0, 3.8, m, kind=k % 2, salt=1950 + k)
        tents[k].hide_render = True
        for ch in tents[k].children:
            ch.hide_render = True
    royal = _tent_mesh("RoyalTent", 26.0, 16.0, 9.0, C.M("silk", colour=(0.85, 0.62, 0.15)), kind=1, salt=1960)
    royal.location = (60.0, 2200.0, h(60.0, 2200.0))
    # the camp is a town of compounds: each household's tents in a tight
    # group round a yard, paths and open ground between the groups
    spots = []
    for c in range(170):
        cx, cy = r.gauss(0, 700), 2200.0 + r.gauss(0, 420)
        if abs(cx - 60) < 70 and abs(cy - 2200) < 60:
            continue
        nt = r.randint(8, 26)
        rad = 9.0 + nt * 0.9
        for i in range(nt):
            a_ = 2 * math.pi * i / nt + r.uniform(-0.15, 0.15)
            rr = rad * r.uniform(0.75, 1.05)
            spots.append((cx + math.cos(a_) * rr, cy + math.sin(a_) * rr, a_ + math.pi / 2))
    for i, (x, y, face) in enumerate(spots):
        p = tents[r.randrange(len(cloths))]
        t = p.copy()
        t.hide_render = False
        C.link(t)
        for ch in p.children:
            c2 = ch.copy()
            c2.hide_render = False
            C.link(c2)
            c2.parent = t
        t.location = (x, y, h(x, y))
        t.rotation_euler = (0, 0, face + r.uniform(-0.2, 0.2))
        s = r.uniform(1.2, 2.0)
        t.scale = (s, s, s)
    cam = C.camera("long", (0.0, 0.0, h(0.0, 0.0) + 1.7), (60.0, 2500.0, 15.0))
    # camels: one mesh, many linked copies, in lines and herds
    dark = C.M("dark", colour=(0.10, 0.07, 0.05))
    proto_c = F.camel("CamelProto", 1, dark, height=2.0)
    proto_k = F.camel("KneelProto", 1, dark, height=2.0, kneel=True)
    proto_f = F.cloaked_figure("FigProto", C.M("dark", colour=(0.20, 0.16, 0.12)), 1.7)
    for p in (proto_c, proto_k, proto_f):
        p.location = (0, 2200, -50)
    F.guard(proto_c, cam)
    n = 0
    for herd in range(14):
        hx, hy = r.uniform(-1200, 1200), r.uniform(1500, 2900)
        for i in range(r.randint(20, 45)):
            src = proto_k if r.random() < 0.6 else proto_c
            c = src.copy()
            C.link(c)
            x, y = hx + r.gauss(0, 30), hy + r.gauss(0, 18)
            c.location = (x, y, h(x, y))
            c.rotation_euler = (0, 0, r.uniform(0, 6.28))
            n += 1
    for i in range(700):
        f_ = proto_f.copy()
        C.link(f_)
        x, y = r.gauss(0, 700), 2200.0 + r.gauss(0, 420)
        f_.location = (x, y, h(x, y))
    # here and there a glint of gold: small polished gold objects catching the sun
    gold = C.M("gold")
    for i in range(60):
        x, y = r.gauss(60, 300), 2200.0 + r.gauss(0, 200)
        g = C.lathe("Glint%d" % i, [(0, 0), (1.0, 0), (1.3, 1.0), (0.6, 2.0), (0, 2.1)], 12, gold)
        g.location = (x, y, h(x, y))
    for k in range(9):
        x, y = r.gauss(0, 500), 2200.0 + r.gauss(0, 300)
        T.smoke("CampSmoke%d" % k, (x, y, h(x, y)), height=70.0, width=8.0, drift=(50.0, 12.0), density=0.35,
                colour=(0.62, 0.58, 0.54))
    # dust in the gold light over the camp
    T.ground_mist((-3000, 1200, -5), (3000, 3400, 60), density=0.004, colour=(0.95, 0.78, 0.55), name="CampDust")
    return cam


PLATES = {"storm": ("storm-sea", storm), "sandstorm": ("sandstorm", sandstorm), "toll": ("toll-gate", toll),
          "procession": ("procession", procession), "harbour": ("harbour-empty", harbour)}


def main():
    C.parse_args(lambda p: p.add_argument("--plate", default="storm", choices=list(PLATES) + ["all"]))
    todo = list(PLATES) if C.ARGS.plate == "all" else [C.ARGS.plate]
    for k in todo:
        name, fn = PLATES[k]
        fn()
        C.save_still(name)
    C.write_log("a17-" + C.ARGS.plate)


main()
