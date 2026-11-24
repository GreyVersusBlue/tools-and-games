"""A06 Alexandria, the harbour: from a quay looking out across a wide curved
harbour, wide lens, late sun. Ships at anchor and at the quay; on the far
point the broken stump of the great lighthouse.

    blender -b --factory-startup -P scripts/a06_alexandria.py -- --preview [--dress full|empty]

--dress full   alexandria-harbour (A06)
--dress empty  the bare quay, no boats moving, no goods, one ship alone far
               out with sails furled: used by A17's harbour-empty with the
               `overcast` sky (build(dress, sky) is importable).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_props as P       # noqa: E402
import kit_ships as S       # noqa: E402
import kit_terrain as T     # noqa: E402
import numpy as np          # noqa: E402

QUAY_Z = 1.1                # quay top above the water
CAM = (2.0, -6.0, QUAY_Z + 1.65)
LOOK = (40.0, 900.0, -40.0)
SUN_TURN = -38.0            # low sun ahead-left: a path of light on the water
POINT = (360.0, 900.0)      # the far point that closes the harbour, with the ruin
EXPOSURE = {"late": -1.6, "overcast": 0.2}


def land_mask(X, Y):
    """1 on land, 0 in the harbour. The shore runs out from the far left,
    curves round the back of the harbour, and ends in a long arm reaching
    to the point on the right (the old Heptastadion and Pharos island)."""
    # a broad crescent: distance from a circle centred in the harbour
    cx, cy, R = 60.0, 420.0, 520.0
    d = np.sqrt((X - cx) ** 2 + ((Y - cy) * 1.25) ** 2)
    m = np.clip((d - R) / 60.0, 0, 1)
    # the near shore (where the camera stands) is land too
    m = np.maximum(m, np.clip((-Y - 2.0) / 20.0, 0, 1))
    # the arm out to the point
    ax, ay = POINT
    t = np.clip(((X - 120) * (ax - 120) + (Y - 1000) * (ay - 1000)) / ((ax - 120) ** 2 + (ay - 1000) ** 2), 0, 1)
    px, py = 120 + t * (ax - 120), 1000 + t * (ay - 1000)
    arm = np.clip((70.0 - np.sqrt((X - px) ** 2 + (Y - py) ** 2)) / 25.0, 0, 1)
    m = np.maximum(m, arm)
    # the open gap to the sea, right of the point
    gap = np.exp(-(((X - 560) / 130.0) ** 2 + ((Y - 820) / 200.0) ** 2))
    return np.clip(m - gap * 1.4, 0, 1) * (Y > -2.0) + (Y <= -2.0)


def land_fn(X, Y):
    m = land_mask(X, Y)
    z = -4.0 + m * (6.5 + 3.0 * T.fbm(X, Y, 180.0, 4, 61)) + 0.3 * T.fbm(X, Y, 15.0, 3, 62)
    # under and behind the quay the ground stays below the quay top
    return np.where(Y < 60.0, np.minimum(z, QUAY_Z - 0.6), z)


def quay(dress):
    stone = C.M("quay_stone", scale=0.15)
    C.box_mesh("Quay", (220.0, 30.0, QUAY_Z + 3.0), (0.0, -11.0, (QUAY_Z - 3.0) / 2), stone)
    # a worn edge course and a few iron-free mooring stones
    C.box_mesh("QuayEdge", (220.0, 0.9, 0.35), (0.0, 3.6, QUAY_Z + 0.05), stone)
    for k, x in enumerate((-30.0, -8.0, 26.0, 52.0)):
        b = P.block("Bollard%d" % k, (0.6, 0.6, 0.7), stone, chip=0.08, salt=700 + k)
        b.location = (x, 2.4, QUAY_Z)
    if dress != "full":
        return
    r = C.rng(66)
    put = lambda ob, x, y, rz=0.0: P.place(ob, (x, y, QUAY_Z), rz)
    # left: jars, sacks and bales; right: rope coils and more jars
    for i in range(7):
        j = P.jar("Amph%d" % i, r=0.24, h=0.75, neck=0.09, mat=C.M("clay", colour=(0.60, 0.40, 0.27)), salt=710 + i)
        put(j, -4.4 + (i % 4) * 0.6 + r.uniform(-0.1, 0.1), 3.4 + (i // 4) * 0.6)
    for i in range(6):
        # sacks lying in a heap, half-full, slumped on their sides
        sk = P.block("Sack%d" % i, (0.9, 0.55, 0.45), C.M("hessian"), chip=0.18, salt=720 + i)
        put(sk, -2.6 + (i % 3) * 0.75 + r.uniform(-0.1, 0.1), 2.8 + (i // 3) * 0.6, r.uniform(-0.4, 0.4))
        if i >= 3:
            sk.location.z += 0.42
    for i in range(5):
        b = P.block("Bale%d" % i, (1.1, 0.8, 0.7), C.M("hessian", colour=(0.60, 0.50, 0.36)), chip=0.12, salt=730 + i)
        put(b, -6.4 + (i % 3) * 1.2, 2.4 + (i // 3) * 0.9, r.uniform(-0.2, 0.2))
    for i in range(3):
        put(P.rope_coil("Rope%d" % i, 0.55, 5.0, 0.05, salt=740 + i), 4.0 + i * 1.2, 3.0 + (i % 2) * 0.7)
    for i in range(4):
        j = P.jar("Jar%d" % i, r=0.3, h=0.85, neck=0.12, mat=C.M("clay", colour=(0.55, 0.36, 0.25)), salt=750 + i)
        put(j, 7.6 + (i % 2) * 0.7, 2.8 + (i // 2) * 0.7)


def lighthouse():
    """The ruined Pharos: the great square lower stage standing, its top
    broken and ragged, the upper stages fallen into heaps of blocks."""
    stone = C.M("pale_block", scale=0.08, tint=(0.92, 0.86, 0.76))
    x, y = POINT
    W, H = 36.0, 56.0
    r = C.rng(77)
    lower = H * 0.55
    C.box_mesh("PharosBase", (W, W, lower), (x, y, lower / 2 + 1.0), stone)
    # the broken upper part: the masonry stands in ragged steps, highest at
    # one corner, gone altogether on the side the earthquakes threw down
    n = 6
    cw = W / n
    for i in range(n):
        for j in range(n):
            u, v = (i + 0.5) / n, (j + 0.5) / n
            keep = max(0.0, 0.95 - 0.9 * u + 0.25 * math.sin(v * 7.0 + 1.0) + 0.25 * (r.random() - 0.5))
            if i in (0, n - 1) or j in (0, n - 1):
                keep = min(1.0, keep * 1.3)        # the outer walls stand higher than the core
            hh = (H - lower) * keep
            if hh < 1.0:
                continue
            C.box_mesh("PharosUp%d_%d" % (i, j), (cw * 1.01, cw * 1.01, hh),
                       (x - W / 2 + (i + 0.5) * cw, y - W / 2 + (j + 0.5) * cw, 1.0 + lower + hh / 2), stone)
    # a low podium wall and fallen blocks around the foot
    C.box_mesh("PharosPodium", (W + 18, W + 18, 4.0), (x, y, 2.0), stone)
    for k in range(140):
        a = r.uniform(-1.2, 1.9)                   # mostly on the fallen (east) side
        d = r.uniform(W * 0.5, W * 1.3)
        s = r.uniform(2.0, 6.0)
        b = P.block("Rubble%d" % k, (s, s * r.uniform(0.6, 1.0), s * r.uniform(0.5, 0.9)), stone, chip=0.3, salt=800 + k)
        b.location = (x + math.cos(a) * d, y + math.sin(a) * d, r.uniform(1.5, 6.0) * (1.4 - d / (W * 1.3)))
        b.rotation_euler = (r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(0, 3))


def city(dress):
    mats = [C.M("house_wall", colour=(0.72, 0.66, 0.56)), C.M("house_wall", colour=(0.66, 0.60, 0.50), tex="stone"),
            C.M("house_wall", colour=(0.62, 0.55, 0.45))]
    def avoid(x, y):
        return land_mask(np.array([x]), np.array([y]))[0] < 0.95 or (abs(x - POINT[0]) < 90 and abs(y - POINT[1]) < 90)
    A.town("House", -1400, 900, 250, 2200, mats, n=700, h=(5, 13), size=(9, 18), salt=606, avoid=avoid,
           ground=lambda x, y: float(land_fn(np.array([x]), np.array([y]))[0]))
    stone = C.M("pale_block", scale=0.1)
    for k, (x, y, h) in enumerate(((-420, 760, 40.0), (-150, 980, 36.0))):
        A.minaret_mamluk("Minaret%d" % k, h, stone, loc=(x, y, 3.0))


def ships(dress):
    if dress == "full":
        a = S.round_ship("RoundShipA", 27.0, "furled")
        a.location = (-200.0, 330.0, 0)
        a.rotation_euler = (0, 0, math.radians(200))
        b = S.round_ship("RoundShipB", 24.0, "furled")
        b.location = (90.0, 330.0, 0)
        b.rotation_euler = (0, 0, math.radians(160))
        c = S.round_ship("RoundShipQuay", 25.0, "furled", masts=1)
        c.location = (31.0, 36.0, 0)
        c.rotation_euler = (0, 0, math.radians(186))
        g = S.galley("Galley", 40.0, "furled", oars_up=True)
        g.location = (-40.0, 140.0, 0)
        g.rotation_euler = (0, 0, math.radians(15))
        r = C.rng(91)
        for i in range(6):
            sb = S.small_boat("Boat%d" % i, r.uniform(4.5, 6.0), salt=900 + i)
            sb.location = (r.uniform(-40, 60), r.uniform(25, 160), 0)
            sb.rotation_euler = (0, 0, r.uniform(0, 6.28))
    else:
        a = S.round_ship("RoundShipFar", 26.0, "furled")
        a.location = (200.0, 620.0, 0)
        a.rotation_euler = (0, 0, math.radians(150))


def harbour_water():
    """Calm harbour water: dark green-blue, small wind ripples at two
    scales so the sky's reflection breaks up and the sun lays a path."""
    b = C._NB("harbour_surface")
    vec = b.coords(1.0)
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 2.5, 1.0)
    b.link(vec, mp.inputs["Vector"])
    n1 = b.n("ShaderNodeTexNoise", Scale=0.35, Detail=6.0, Roughness=0.6)
    b.link(mp.outputs[0], n1.inputs["Vector"])
    n2 = b.n("ShaderNodeTexNoise", Scale=3.0, Detail=4.0, Roughness=0.5)
    b.link(mp.outputs[0], n2.inputs["Vector"])
    h = b.math("ADD", n1.outputs["Fac"], b.math("MULTIPLY", n2.outputs["Fac"], 0.35))
    bp = b.bump(h, 0.9, 0.12)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=(0.010, 0.040, 0.042), Roughness=0.06, Specular_IOR_Level=0.5, IOR=1.333)
    return b.m


def build(dress="full", sky="late"):
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE[sky])
    C.sky(sky, sun_turn=SUN_TURN)
    C.haze(0.00014 if sky == "late" else 0.0005, (0.90, 0.84, 0.76) if sky == "late" else (0.75, 0.77, 0.80),
           0.5, extent=6000.0, top=400.0)
    T.heightfield("Land", -2200, 2200, -40, 3200, 500, 500, land_fn, C.M("rocky_ground", scale=0.2), py=1.6)
    C.box_mesh("Harbour", (8000, 8000, 0.02), (0, 3000, -0.01), harbour_water())
    quay(dress)
    lighthouse()
    city(dress)
    ships(dress)
    cam = C.camera("wide", CAM, LOOK)
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--dress", default="full", choices=["full", "empty"]))
    build(C.ARGS.dress)
    C.save_still("alexandria-harbour" if C.ARGS.dress == "full" else "alexandria-harbour-empty-test")
    C.write_log("a06-" + C.ARGS.dress)


if __name__ == "__main__":
    main()
