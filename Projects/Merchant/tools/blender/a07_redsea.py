"""A07 a Red Sea port: a small poor port on a hot, empty desert shore, late
sun, wide lens. Low coral-stone buildings and shelters of reed matting, a
beach with dhows drawn up and at anchor in very clear shallow water over
reef, bare brown hills behind, heat haze.

    blender -b --factory-startup -P scripts/a07_redsea.py -- --preview [--sail lateen|settee]

The coast faces east (like Aydhab on the African shore), so the late sun is
behind the camera over the land and lights the water.
The dhows' sail is one swappable option (--sail): the rig of these ships in
the 1300s is argued over. Default: lateen.
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
import kit_models as KM     # noqa: E402
import numpy as np          # noqa: E402

CAM = (-12.0, -34.0)
CAM_EYE = 1.7
LOOK = (70.0, 330.0, -12.0)
SUN_TURN = -125.0           # behind the camera, to the left (west, over the land)
EXPOSURE = -1.5


def shore_x(Y):
    """x of the waterline at y: the beach runs off north, curving out."""
    return 26.0 + 0.18 * Y + 22.0 * np.sin(Y / 160.0) + 6.0 * T.fbm(np.zeros_like(Y), Y, 60.0, 3, 71)


def ground_fn(X, Y):
    d = X - shore_x(Y)                 # >0 seaward, <0 inland
    sea = -0.4 - 0.06 * np.maximum(d, 0) - 0.00012 * np.maximum(d, 0) ** 2
    sea = np.maximum(sea, -14.0)
    reef = 1.4 * np.clip(T.fbm(X, Y, 45.0, 4, 72) * 2.2, 0, 1) * (d > 25)        # reef heads rising
    beach = 0.035 * (-d) + 0.25 * T.fbm(X, Y, 12.0, 3, 73)
    inland = np.where(d < 0, beach, sea + reef)
    # bare hills behind, from ~350 m inland
    # bare brown hills close behind the port, gullied, with a stony apron
    hills = (130.0 * np.clip(T.ridged(X, Y, 360.0, 6, 74) - 0.1, 0, 1) + 18.0 * T.ridged(X, Y, 70.0, 4, 76)
             + 12.0 * T.fbm(X, Y, 60.0, 4, 75)) * np.clip((-d - 110.0) / 240.0, 0, 1)
    return np.where(d < -40, beach + hills, inland)


def ground():
    ob, Z = T.heightfield("Ground", -2400, 1600, -300, 3600, 520, 560, ground_fn, None, py=1.8, px=1.0)
    # one material, blended by height: seabed below water, sand on the beach, rock up the hills
    b = C._NB("shore")
    sand_c = (0.78, 0.66, 0.48)
    geo = b.n("ShaderNodeNewGeometry")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Position"], sep.inputs[0])
    vec = b.coords(1.0)
    nz = b.noise(vec, 0.03, 5, 0.6)
    reef = b.ramp(nz.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.50, 0.58)
    under = b.mix(reef.outputs[0], (0.80, 0.74, 0.58), (0.30, 0.26, 0.20))
    diff, nor, rough, disp = C._tex_paths("rock_face")
    t = b.n("ShaderNodeTexImage")
    t.image = C._img(diff)
    t.projection = "BOX"
    b.link(b.coords(0.05), t.inputs["Vector"])
    hs = b.n("ShaderNodeHueSaturation", Saturation=0.8, Value=1.0)
    b.link(t.outputs["Color"], hs.inputs["Color"])
    rockc = b.mix(1.0, hs.outputs[0], (0.80, 0.58, 0.42), "MULTIPLY")
    # rock wherever the ground rises above the beach or tilts
    nsep = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], nsep.inputs[0])
    tilt = b.ramp(nsep.outputs["Z"], (1, 1, 1), (0, 0, 0), 0.90, 0.985)
    high = b.band(sep.outputs["Z"], 5.0, 9.0)
    up = b.n("ShaderNodeMath", _operation="MAXIMUM")
    b.link(tilt.outputs[0], up.inputs[0])
    b.link(high, up.inputs[1])
    ups = b.math("MULTIPLY", up.outputs[0], b.band(sep.outputs["Z"], 2.0, 4.0))
    # beach sand: the scanned sand texture, wind ripples, a dark wrack line of
    # dried weed and shell where the tide reaches, trampled darker by the huts
    sdiff, snor, srough, sdisp = C._tex_paths("sand_01")
    stx = b.n("ShaderNodeTexImage")
    stx.image = C._img(sdiff)
    stx.projection = "BOX"
    b.link(b.coords(0.13), stx.inputs["Vector"])
    stx2 = b.n("ShaderNodeTexImage")
    stx2.image = C._img(sdiff)
    stx2.projection = "BOX"
    b.link(b.coords(0.031), stx2.inputs["Vector"])
    brk = b.noise(b.coords(1.0), 0.05, 3, 0.5)
    sraw = b.mix(brk.outputs["Fac"], stx.outputs["Color"], stx2.outputs["Color"])     # two scales, so it never tiles
    sdes = b.n("ShaderNodeHueSaturation", Saturation=0.55, Value=1.15)
    b.link(sraw, sdes.inputs["Color"])
    sandc = b.mix(1.0, sdes.outputs[0], (0.92, 0.82, 0.66), "MULTIPLY")
    tramp = b.noise(b.coords(1.0), 0.08, 5, 0.6)
    sandc = b.mix(b.ramp(tramp.outputs["Fac"], (0, 0, 0), (0.35, 0.35, 0.35), 0.5, 0.75).outputs[0], sandc, (0.52, 0.42, 0.30))
    wrack = b.math("MULTIPLY", b.band(sep.outputs["Z"], 0.18, 0.28), b.band(sep.outputs["Z"], 0.48, 0.36))
    wn = b.noise(b.coords(1.0), 1.5, 4, 0.6)
    wrack = b.math("MULTIPLY", wrack, b.ramp(wn.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.45, 0.6).outputs[0])
    sandc = b.mix(wrack, sandc, (0.16, 0.13, 0.09))
    land = b.mix(ups, sandc, rockc)
    wet = b.band(sep.outputs["Z"], -0.3, 0.25)
    col = b.mix(wet, under, land)
    b.link(col, b.bsdf.inputs["Base Color"])
    fine = b.noise(vec, 3.0, 6, 0.6)
    rip = b.n("ShaderNodeTexWave", Scale=5.0, Distortion=6.0, Detail=2.0)
    rip.bands_direction = "Y"
    b.link(vec, rip.inputs["Vector"])
    bp = b.bump(b.math("ADD", fine.outputs["Fac"], b.math("MULTIPLY", rip.outputs["Fac"], 0.5)), 0.3, 0.05)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.9)
    ob.data.materials.append(b.m)
    return ob, Z


def water():
    """A closed slab of very clear water: the reef and sand show through,
    tinting green-blue with depth."""
    ob = C.box_mesh("Water", (5000, 5000, 16.0), (2300, 1500, -8.0), C.M("clear_water", deep=(0.02, 0.21, 0.19), density=0.55))
    return ob


def shelter(name, x, y, z, w, d, h, rot, salt, walls=True):
    """A shelter of reed matting on poles: a flat roof sloping a little,
    matting walls on two or three sides."""
    mat = C.M("reed_mat", scale=1.2)
    wood = C.M("plain_wood", tint=(0.6, 0.5, 0.4))
    parts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(C.box_mesh(name + "_post", (0.12, 0.12, h + (0.3 if sy > 0 else 0)),
                                    (sx * w / 2, sy * d / 2, (h + (0.3 if sy > 0 else 0)) / 2), wood))
    roof = C.box_mesh(name + "_roof", (w + 0.6, d + 0.6, 0.12), (0, 0, h + 0.15), mat)
    roof.rotation_euler = (math.radians(-6), 0, 0)
    parts.append(roof)
    if walls:
        r = C.rng(salt)
        for k, (cx, cy, sw, sd) in enumerate(((0, d / 2, w, 0.06), (-w / 2, 0, 0.06, d), (w / 2, 0, 0.06, d))):
            if r.random() < 0.75:
                parts.append(C.box_mesh("%s_wall%d" % (name, k), (sw, sd, h * 0.85), (cx, cy, h * 0.42), mat))
    g = P.group(name, parts, (x, y, z), rot)
    return g


def build(sail="lateen"):
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    # a photographed sky: hot, hazy blue with fair-weather cloud over the hills
    KM.sky_photo("kloofendal_48d_partly_cloudy_puresky", sun_turn=SUN_TURN, strength=0.9)
    C.haze(0.00012, (0.93, 0.86, 0.74), 0.5, extent=6000.0, top=500.0)
    gob, Z = ground()
    water()
    zc = T.sample(Z, gob, *CAM)
    # from the roof of one of the coral-stone houses, about 9 m up
    cam = C.camera("wide", (CAM[0], CAM[1], zc + CAM_EYE + 8.0), LOOK)
    h = lambda x, y: T.sample(Z, gob, x, y)
    r = C.rng(707)

    # the near dhow drawn up on the beach, close enough to show sewn seams
    d0 = S.dhow("DhowNear", 15.0, rig="bare", sail=sail)
    x0, y0 = float(shore_x(np.array([6.0]))[0]) - 4.0, 6.0
    d0.location = (x0, y0, h(x0, y0) + 1.0)
    d0.rotation_euler = (math.radians(4), math.radians(-6), math.radians(115))
    # two more drawn up further along
    for k, yy in enumerate((95.0, 140.0)):
        xx = float(shore_x(np.array([yy]))[0]) - 3.0
        dk = S.dhow("DhowBeach%d" % k, r.uniform(11, 14), rig="bare", sail=sail)
        dk.location = (xx, yy, h(xx, yy) + 0.9)
        dk.rotation_euler = (math.radians(3), math.radians(-5), math.radians(100 + r.uniform(-15, 15)))
    # dhows at anchor in the shallows, one with its sail set
    for k, (dx, yy, rig) in enumerate(((70.0, 120.0, "furled"), (130.0, 230.0, "set"), (60.0, 300.0, "furled"),
                                       (200.0, 420.0, "furled"))):
        xx = float(shore_x(np.array([yy]))[0]) + dx
        dk = S.dhow("DhowAnchor%d" % k, r.uniform(14, 18), rig=rig, sail=sail)
        dk.location = (xx, yy, 0.0)
        dk.rotation_euler = (0, 0, math.radians(r.uniform(140, 200)))

    # the port: shelters of matting along the top of the beach, a few low
    # coral-stone buildings
    for k in range(30):
        yy = 22.0 + k * 8.0 + r.uniform(-4, 4)
        xx = float(shore_x(np.array([yy]))[0]) - r.uniform(22, 42)
        shelter("Shelter%d" % k, xx, yy, h(xx, yy), r.uniform(3.5, 6), r.uniform(3, 5), r.uniform(2.0, 2.6),
                r.uniform(-0.4, 0.4) + math.radians(20), 710 + k)
    coral = C.M("coral_stone", scale=0.4)
    for k, (dx, yy) in enumerate(((-52.0, 60.0), (-60.0, 105.0), (-48.0, 165.0), (-70.0, 220.0))):
        xx = float(shore_x(np.array([yy]))[0]) + dx
        hb = r.uniform(3.2, 4.2)
        A.flat_house("Coral%d" % k, r.uniform(7, 11), r.uniform(6, 9), hb, coral, (xx, yy, h(xx, yy) - 0.3),
                     math.radians(20) + r.uniform(-0.1, 0.1), parapet=0.5, salt=720 + k)
    # bales and sacks under matting near the beach
    bale = C.M("hessian", colour=(0.62, 0.52, 0.38))
    for k in range(12):
        yy = 60.0 + r.uniform(-6, 6)
        xx = float(shore_x(np.array([yy]))[0]) - 20.0 + r.uniform(-4, 4)
        b = P.block("Bale%d" % k, (1.1, 0.8, 0.7), bale, chip=0.15, salt=730 + k)
        b.location = (xx, yy, h(xx, yy) + (0.7 if k > 8 else 0))
        b.rotation_euler = (0, 0, r.uniform(0, 3))
    shelter("BaleCover", float(shore_x(np.array([60.0]))[0]) - 20.0, 60.0, h(float(shore_x(np.array([60.0]))[0]) - 20.0, 60.0),
            8.0, 6.0, 2.2, math.radians(20), 740, walls=False)

    # mangroves: dark green stands growing out into the shallows along the shore
    for k in range(46):
        yy = r.uniform(-60, 620)
        if 0 < yy < 150 and r.random() < 0.7:
            continue                      # the beach in front of the port is kept clear
        xx = float(shore_x(np.array([yy]))[0]) + r.uniform(-4, 14)
        KM.place(["island_tree_01", "island_tree_03"][k % 2], (xx, yy, -0.6), r.uniform(0, 6.28),
                 (r.uniform(2.0, 3.0), r.uniform(2.0, 3.0), r.uniform(1.2, 1.7)), name="Mangrove%d" % k)
    # thorn scrub and boulders on the stony slopes and the hills behind
    inland = lambda x, y: x - float(shore_x(np.array([y]))[0]) > -60
    KM.scatter("searsia_burchellii", 220, (-900, 300, -200, 900), h, 7101, scale=(1.0, 2.2), avoid=inland, name="Scrub")
    KM.scatter("wild_rooibos_bush", 320, (-700, 300, -200, 900), h, 7102, scale=(1.2, 2.4), avoid=inland, name="Bush")
    beach = lambda x, y: not (-60 < x - float(shore_x(np.array([y]))[0]) < -14) or (10 < y < 260 and x - float(shore_x(np.array([y]))[0]) > -50)
    KM.scatter("wild_rooibos_bush", 140, (-150, 200, -80, 400), h, 7103, scale=(0.6, 1.3), avoid=beach, name="BeachScrub")
    for i, tid in enumerate(("namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_05")):
        KM.scatter(tid, 60, (-800, 200, -150, 900), h, 7110 + i, scale=(1.5, 4.0), avoid=inland, name="Rock%d" % i)
    # more of the port: fences of brush, drying racks, small boats on the sand
    wood = C.M("plain_wood", tint=(0.55, 0.45, 0.35))
    for k in range(12):
        yy = 40.0 + k * 18.0
        xx = float(shore_x(np.array([yy]))[0]) - r.uniform(15, 30)
        for j in range(5):
            C.box_mesh("Rack%d_%d" % (k, j), (0.08, 0.08, 1.8), (xx + j * 1.6, yy, h(xx + j * 1.6, yy) + 0.9), wood)
        C.box_mesh("RackBar%d" % k, (6.6, 0.05, 0.05), (xx + 3.2, yy, h(xx, yy) + 1.7), wood)
    for k in range(8):
        yy = 150.0 + k * 22.0
        xx = float(shore_x(np.array([yy]))[0]) - 6.0
        sb = S.small_boat("Skiff%d" % k, r.uniform(4.5, 6.5), salt=7120 + k)
        sb.location = (xx, yy, h(xx, yy) + 0.25)
        sb.rotation_euler = (0, math.radians(r.uniform(-8, 8)), math.radians(100 + r.uniform(-20, 20)))
    # camels far off, bringing loads down from the hills
    dark = C.M("dark", colour=(0.10, 0.08, 0.06))
    for k in range(6):
        yy = 520.0 + k * 9.0
        xx = float(shore_x(np.array([yy]))[0]) - 260.0 + k * 14.0
        cm = F.camel("Camel%d" % k, 1, dark, height=1.95, load="bales")
        F.place(cm, (xx, yy, h(xx, yy)), math.radians(-10), cam)
    for k in range(2):
        yy = 516.0 + k * 30.0
        xx = float(shore_x(np.array([yy]))[0]) - 262.0 + k * 40.0
        F.place(F.cloaked_figure("Walker%d" % k, dark, 1.7), (xx, yy, h(xx, yy)), 0.0, cam)
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--sail", default="lateen", choices=["lateen", "settee"]))
    build(C.ARGS.sail)
    C.save_still("redsea-port")
    C.write_log("a07")


main()
