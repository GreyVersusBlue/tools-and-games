"""A14 a Venetian quay: the water's edge of a trading city on a lagoon, dawn
with mist, normal lens. Brick warehouses with rows of round and pointed
arches at the water, wooden mooring poles, stone steps down into green
water; a galley and a round ship moored, small flat boats; bales of wool
cloth and barrels on the quay.

    blender -b --factory-startup -P scripts/a14_venice.py -- --preview

No landmark of any kind: the buildings are generic warehouses of this
script's own design.
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

QUAY_Z = 1.0
FAR_Y = 55.0                # the far side of the canal: warehouse fronts
CAM = (0.0, -2.0, QUAY_Z + 1.65)
LOOK = (55.0, 60.0, 7.0)
SUN_TURN = 70.0             # dawn sun low on the right, through the mist
EXPOSURE = -1.3


def arch_window(name, cx, z0, w, h, kind, y, mat):
    """A dark arched window opening drawn flush on a facade (no glass)."""
    pts = [(cx - w / 2, z0), (cx + w / 2, z0)] + \
          [(x, z) for x, z in A.arch_curve(cx, w, z0 + h - w / 2, kind, 10)]
    verts = [(x, y, z) for x, z in pts]
    return C.mesh_object(name, verts, [list(range(len(verts)))], mat)


def warehouse(name, x0, width, height, kind, brick, stone, dark, salt):
    """A brick warehouse on the water: an arcade at water level opening onto
    steps, a stone string course, two floors of arched windows, a cornice."""
    r = C.rng(salt)
    n = max(3, int(width / 4.2))
    ops = [((k + 0.5) * width / n, width / n * 0.66, 2.6 if kind == "round" else 2.2) for k in range(n)]
    front = A.arched_panel(name + "_arc", width, height, 0.8, ops, brick, kind)
    front.location = (x0, FAR_Y, QUAY_Z - 0.4)
    for sf in A.soffits(name + "_sof", ops, 0.8, brick, kind):
        sf.location = (x0, FAR_Y, QUAY_Z - 0.4)
    # dark interior behind the arcade
    C.box_mesh(name + "_in", (width, 0.3, 4.4), (x0 + width / 2, FAR_Y + 3.0, QUAY_Z + 1.8), dark)
    C.box_mesh(name + "_body", (width, 12.0, height), (x0 + width / 2, FAR_Y + 9.4, QUAY_Z - 0.4 + height / 2), brick)
    C.box_mesh(name + "_floor", (width, 3.4, 0.3), (x0 + width / 2, FAR_Y + 1.6, QUAY_Z - 0.05), stone)
    # string course and cornice in pale stone
    C.box_mesh(name + "_course", (width, 1.0, 0.3), (x0 + width / 2, FAR_Y - 0.1, QUAY_Z + 4.6), stone)
    C.box_mesh(name + "_corn", (width + 0.4, 1.3, 0.45), (x0 + width / 2, FAR_Y - 0.2, QUAY_Z - 0.4 + height), stone)
    # windows on the upper floors
    for fl in range(2 if height > 13 else 1):
        z0 = QUAY_Z + 5.8 + fl * 4.3
        for k in range(n):
            cx = x0 + (k + 0.5) * width / n
            arch_window("%s_w%d_%d" % (name, fl, k), cx, z0, 1.1, 2.4, kind, FAR_Y - 0.42, dark)
    # stone steps down into the water from the middle arch
    cx = x0 + ops[n // 2][0]
    for s in range(5):
        C.box_mesh("%s_step%d" % (name, s), (2.6, 0.45, 0.25), (cx, FAR_Y - 0.6 - s * 0.45, QUAY_Z - 0.25 - s * 0.25), stone)
    return front


def barrel(name, r=0.32, h=0.9, mat=None):
    prof = [(0, 0), (r * 0.85, 0)]
    for i in range(1, 8):
        t = i / 8
        prof.append((r * (0.85 + 0.15 * math.sin(math.pi * t)), h * t))
    prof += [(r * 0.85, h), (0, h)]
    ob = C.lathe(name, prof, 24, mat or C.M("plank_hull", colour=(0.32, 0.24, 0.16), plank=0.08), True)
    for z in (0.15, h - 0.15):
        hoop = C.lathe(name + "_hoop", [(r * 0.9, z - 0.02), (r * 0.98, z - 0.02), (r * 0.98, z + 0.02), (r * 0.9, z + 0.02)], 24,
                       C.M("dark", colour=(0.05, 0.04, 0.03)))
        hoop.parent = ob
    return ob


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    C.sky("dawn", sun_turn=SUN_TURN, elev=7.0, tint=(0.86, 0.88, 0.95))
    C.haze(0.0026, (0.80, 0.82, 0.84), 0.45, extent=2500.0, top=120.0)
    brick = C.M("red_brick", scale=0.45)
    stone = C.M("limestone", colour=(0.72, 0.70, 0.64), scale=0.6)
    dark = C.M("dark", colour=(0.015, 0.014, 0.012))
    C.box_mesh("Canal", (3000, 3000, 0.02), (0, 0, -0.01),
               C.M("rippled_water", colour=(0.020, 0.045, 0.030), rough=0.05, ripple=0.6, stretch=3.0))
    # the far side: a row of warehouses of different heights and arches
    x = -40.0
    r = C.rng(1414)
    k = 0
    while x < 260.0:
        w = r.uniform(16, 26)
        hgt = r.uniform(11.0, 17.0)
        warehouse("W%d" % k, x, w, hgt, "round" if k % 2 else "pointed", brick, stone, dark, 1420 + k)
        x += w + r.uniform(0.0, 1.0)
        k += 1
    # the near quay
    C.box_mesh("Quay", (160.0, 18.0, QUAY_Z + 3.0), (40.0, -11.0, (QUAY_Z - 3.0) / 2), C.M("quay_stone", scale=0.18))
    C.box_mesh("QuayEdge", (160.0, 0.6, 0.3), (40.0, -2.1, QUAY_Z + 0.05), stone)
    # mooring poles in clusters, in the water
    wood = C.M("plain_wood", tint=(0.45, 0.38, 0.30))
    for c, (px, py) in enumerate(((-6, 22), (30, 24), (78, 40), (96, 44), (130, 47))):
        for i in range(3):
            pole = C.lathe("Pole%d_%d" % (c, i), [(0, -1.5), (0.16, -1.5), (0.14, 4.2 + r.uniform(-0.6, 0.6)),
                                                   (0, 4.3)], 10, wood)
            pole.location = (px + r.uniform(-0.4, 0.4), py + r.uniform(-0.4, 0.4), 0)
            pole.rotation_euler = (r.uniform(-0.06, 0.06), r.uniform(-0.06, 0.06), 0)
    # ships moored along the far side
    g = S.galley("Galley", 38.0, "furled", oars_up=True)
    g.location = (40.0, FAR_Y - 10.5, 0)
    g.rotation_euler = (0, 0, math.radians(180))
    rs = S.round_ship("RoundShip", 25.0, "furled")
    rs.location = (102.0, FAR_Y - 12.5, 0)
    rs.rotation_euler = (0, 0, math.radians(185))
    flat = C.M("plank_hull", colour=(0.28, 0.21, 0.15), plank=0.2)
    for i, (bx, by, rz) in enumerate(((2, 14, 40), (64, 34, 160), (150, 38, 175))):
        b = S.small_boat("Flat%d" % i, 7.0, salt=1450 + i, mat=flat)
        b.location = (bx, by, -0.1)
        b.rotation_euler = (0, 0, math.radians(rz))
        b.scale = (1.0, 1.15, 0.7)          # wide and flat-bottomed
    # on the near quay: bales of wool cloth and barrels, at the edges of the frame
    bale = C.M("linen", colour=(0.46, 0.42, 0.36), scale=4.0)
    for i in range(8):
        b = P.block("Bale%d" % i, (1.2, 0.8, 0.75), bale, chip=0.12, salt=1460 + i)
        b.location = (-3.4 + (i % 4) * 1.25, 1.6 - 0.95 * (i // 4) - 3.0, QUAY_Z + (0.75 if i >= 6 else 0))
        b.rotation_euler = (0, 0, r.uniform(-0.1, 0.1))
    for i in range(5):
        bb = barrel("Barrel%d" % i)
        bb.location = (7.5 + (i % 3) * 0.75, -2.6 - (i // 3) * 0.75, QUAY_Z)
    # a narrow quay along the far side in front of the warehouses, with the
    # cargo: bales of wool cloth and barrels
    C.box_mesh("FarQuay", (300.0, 3.0, QUAY_Z + 3.0), (110.0, FAR_Y - 1.9, (QUAY_Z - 3.0) / 2), C.M("quay_stone", scale=0.25))
    for i in range(10):
        b = P.block("FarBale%d" % i, (1.2, 0.8, 0.75), bale, chip=0.12, salt=1480 + i)
        b.location = (64.0 + (i % 5) * 1.3, FAR_Y - 2.4 + 0.9 * (i // 5 % 2), QUAY_Z + (0.75 if i == 9 else 0))
    for i in range(6):
        bb = barrel("FarBarrel%d" % i)
        bb.location = (73.0 + (i % 3) * 0.75, FAR_Y - 2.6 + 0.75 * (i // 3), QUAY_Z)
    # mist lying on the water
    T.ground_mist((-200, -5, -2), (400, 140, 8), density=0.02, colour=(0.86, 0.87, 0.88))
    cam = C.camera("normal", CAM, LOOK)
    dark2 = C.M("dark", colour=(0.05, 0.045, 0.04))
    for i, (fx, fy) in enumerate(((60.0, FAR_Y + 1.0), (63.0, FAR_Y + 1.6))):
        F.place(F.cloaked_figure("Fig%d" % i, dark2, 1.7), (fx, fy, QUAY_Z - 0.05), math.radians(90), cam)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("venice-quay")
    C.write_log("a14")


main()
