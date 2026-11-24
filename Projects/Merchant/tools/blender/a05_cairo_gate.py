"""A05 Cairo, the gate at dawn: from outside the walls, well back and low,
long lens. A stone gate between two square towers in a long wall, first sun
on the upper stone, mist near the ground, a caravan forming far off and
small; behind the wall flat roofs, a few domes and three minarets.

    blender -b --factory-startup -P scripts/a05_cairo_gate.py -- --preview

North is -Y: the camera stands north of the wall looking south, so the
dawn sun rises on the left (east, -X).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_figures as F     # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_props as P       # noqa: E402

CAM_POS = (-18.0, -340.0, 4.5)
CAM_LOOK = (0.0, 0.0, 17.0)
SUN_TURN = -104.0           # east, a little north: midsummer sunrise
WALL_H = 12.0
WALL_T = 4.0
TOWER = (15.0, 14.0, 23.0)  # w, d, h
GAP = 9.0                   # between the two gate towers
EXPOSURE = 0.3


def ground():
    def f(X, Y):
        return 0.6 * T.fbm(X, Y, 90.0, 4, 3) + 0.15 * T.fbm(X, Y, 8.0, 3, 4)
    ob, Z = T.heightfield("Ground", -900, 900, -700, 60, 300, 300, f, C.M("rocky_ground", scale=0.25), py=1.0)
    return ob, Z


def walls():
    stone = C.M("pale_block", scale=0.12)
    gx = TOWER[0] + GAP / 2
    parts = []
    # long curtain wall either side of the gate, with towers every 85 m
    for side in (-1, 1):
        x0, x1 = (gx, 700.0) if side > 0 else (-700.0, -gx)
        parts.append(C.box_mesh("Wall%d" % side, (x1 - x0, WALL_T, WALL_H), ((x0 + x1) / 2, WALL_T / 2, WALL_H / 2), stone))
        parts += A.merlons("WallMer%d" % side, x0, x1, WALL_H, 0.8, stone, y=0.4)
        for k in range(1, 8):
            tx = side * (gx + 85.0 * k)
            parts += A.tower("WT%d_%d" % (side, k), 10.0, 9.0, WALL_H + 4.0, stone, loc=(tx, 1.5, 0))
    # the gate: two square towers, a round-headed arch between them, set
    # back, with a deep passage
    for side in (-1, 1):
        parts += A.tower("GateTower%d" % side, TOWER[0], TOWER[1], TOWER[2], stone,
                         loc=(side * (GAP / 2 + TOWER[0] / 2), -3.0, 0))
    span, spring = 5.6, 7.5
    face = A.arched_panel("GateFace", GAP, TOWER[2] - 3.0, TOWER[1] - 2.0, [(GAP / 2, span, spring)], stone, "round")
    face.location = (-GAP / 2, -2.0, 0)
    parts.append(face)
    parts += A.soffits("GateSoffit", [(GAP / 2, span, spring)], TOWER[1] - 2.0, stone, "round")
    for p in parts[-1:]:
        p.location = (-GAP / 2, -2.0, 0)
    # a moulded arch ring standing proud round the opening
    ring = A.arched_panel("GateRing", span + 1.6, spring + span / 2 + 0.9, 0.5,
                          [((span + 1.6) / 2, span, spring)], stone, "round")
    ring.location = (-(span + 1.6) / 2, -2.0 - (TOWER[1] - 2.0) / 2 - 0.25, 0)
    parts.append(ring)
    # the passage beyond is dark: heavy wooden leaves standing open, shadow
    dark = C.M("plank_hull", colour=(0.12, 0.08, 0.05), plank=0.3)
    for side in (-1, 1):
        lv = C.box_mesh("Leaf%d" % side, (0.35, 2.8, spring + 1.5), (side * (span / 2 - 0.2), 2.0, (spring + 1.5) / 2), dark)
        parts.append(lv)
    parts.append(C.box_mesh("PassageBack", (span + 1.0, 0.3, spring + span), (0, 6.0, (spring + span) / 2),
                            C.M("dark", colour=(0.02, 0.018, 0.015))))
    return parts


def city():
    mats = [C.M("house_wall", colour=(0.66, 0.58, 0.46)), C.M("house_wall", colour=(0.62, 0.55, 0.44), tex="stone"),
            C.M("house_wall", colour=(0.62, 0.48, 0.34), tex="mud"), C.M("house_wall", colour=(0.56, 0.48, 0.38)),
            C.M("house_wall", colour=(0.85, 0.78, 0.66), tex="stone")]
    A.town("House", -420, 420, 14, 420, mats, n=520, h=(9, 24), size=(7, 16), salt=505,
           avoid=lambda x, y: abs(x) < 30 and y < 40)
    stone = C.M("pale_block", scale=0.12)
    # domes on cubic bases (mausolea and mosques)
    for k, (x, y, r) in enumerate(((-95, 140, 7.0), (78, 230, 9.0), (-30, 300, 6.5), (140, 110, 5.5), (-130, 260, 8.0))):
        C.box_mesh("DomeBase%d" % k, (2.2 * r, 2.2 * r, 22.0), (x, y, 11.0), stone)
        A.dome("Dome%d" % k, r, stone, drum=2.5, loc=(x, y, 22.0), ribbed=(k % 2 == 0))
    # three Mamluk minarets at different distances
    for k, (x, y, h) in enumerate(((-62, 120, 52.0), (48, 200, 57.0), (118, 330, 49.0))):
        C.box_mesh("MosqueBlock%d" % k, (30, 30, 14.0), (x + 12, y + 12, 7.0), stone)
        A.minaret_mamluk("Minaret%d" % k, h, stone, loc=(x, y, 0.0))


def caravan(cam, Zg, gob):
    """A caravan forming in front of the gate, far off: kneeling camels as
    dark shapes, bales on the ground, a few cloaked figures."""
    r = C.rng(55)
    dark = C.M("dark", colour=(0.035, 0.03, 0.025))
    camelm = C.M("dark", colour=(0.05, 0.04, 0.03))
    bale = C.M("hessian", colour=(0.55, 0.45, 0.33))
    cx, cy = -6.0, -95.0
    for i in range(9):
        x, y = cx + r.uniform(-16, 18), cy + r.uniform(-6, 8)
        z = T.sample(Zg, gob, x, y)
        cm = F.camel("Camel%d" % i, 1, camelm, height=1.95, kneel=(i % 3 != 0), load=("bales" if i % 3 == 0 else False))
        F.place(cm, (x, y, z), r.uniform(-0.6, 0.6) + (math.pi if r.random() < 0.4 else 0), cam)
    for i in range(10):
        x, y = cx + r.uniform(-14, 14), cy + r.uniform(-4, 6)
        z = T.sample(Zg, gob, x, y)
        b = P.block("Bale%d" % i, (1.0, 0.7, 0.6), bale, chip=0.15, salt=600 + i)
        b.location = (x, y, z)
        b.rotation_euler = (0, 0, r.uniform(0, 3))
    for i in range(5):
        x, y = cx + r.uniform(-12, 12), cy + r.uniform(-3, 6)
        z = T.sample(Zg, gob, x, y)
        fg = F.cloaked_figure("Figure%d" % i, dark, 1.7)
        F.place(fg, (x, y, z), r.uniform(0, 6.28), cam)


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    C.sky("dawn", sun_turn=SUN_TURN)
    C.haze(0.00045, (0.90, 0.82, 0.74), 0.55, extent=3000.0, top=250.0)
    gob, Zg = ground()
    walls()
    city()
    cam = C.camera("long", CAM_POS, CAM_LOOK)
    caravan(cam, Zg, gob)
    T.ground_mist((-700, -600, -2), (700, 30, 9), density=0.022, colour=(0.88, 0.84, 0.80))
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("cairo-gate-dawn")
    C.write_log("a05")


main()
