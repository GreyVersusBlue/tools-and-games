"""A11 a town on the Niger: a rich, large town of mud brick on a flat plain
across a wide slow river, late sun, long lens, dust in gold light. Smooth
earthen walls with rounded edges, flat roofs, and one larger building, a
mosque, with tapering towers and rows of wooden beams standing out of its
walls. Long narrow boats on the river; a few thorn trees and one great
thick-trunked tree.

    blender -b --factory-startup -P scripts/a11_sahel.py -- --preview

The mosque is not a copy of any surviving building: its plan, its three
river-side towers and its buttress rhythm are this script's own.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_figures as F     # noqa: E402
import kit_plants as PL     # noqa: E402
import kit_props as P       # noqa: E402
import kit_ships as S       # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_models as KM     # noqa: E402
import numpy as np          # noqa: E402

CAM = (0.0, 0.0, 14.0)
LOOK = (30.0, 560.0, 2.0)
RIVER = (70.0, 330.0)       # near and far waterline (y)
TOWN_Y = 700.0
SUN_TURN = -78.0            # low sun from the left (west): long shadows across the town
EXPOSURE = -2.5


def ground_fn(X, Y):
    near, far = RIVER
    bank = np.minimum(np.clip((near - Y) / 12.0, 0, 1), 1) + np.clip((Y - far) / 15.0, 0, 1)
    z = -2.5 + 3.4 * np.clip(bank, 0, 1) + 0.4 * T.fbm(X, Y, 90.0, 4, 111) * np.clip(bank, 0, 1)
    # a slight rise under the town
    z += 2.5 * np.exp(-(((X - 40) / 420.0) ** 2 + ((Y - 650) / 260.0) ** 2))
    # the camera stands on a low bluff on the near bank
    z += 11.0 * np.exp(-((X / 60.0) ** 2 + ((Y + 10.0) / 45.0) ** 2))
    return z


def mosque(earth, wood, x0, y0):
    """A large mud-brick mosque: a long prayer hall behind a river-side wall
    with three tapering towers, buttresses rising above the parapet as
    pinnacles, and rows of projecting wooden beams (scaffolding left in the
    walls for replastering after the rains)."""
    W, D, H = 70.0, 46.0, 9.0
    A.rounded_block("MosqueHall", (W, D, H), (x0, y0 + D / 2, H / 2), earth, round_=0.8, wobble=0.15, salt=1101)
    r = C.rng(1102)
    beams = []
    # buttresses along the front wall, each rising into a rounded pinnacle
    for k in range(15):
        bx = x0 - W / 2 + 2.5 + k * (W - 5) / 14
        hb = H + 2.4
        A.rounded_block("Butt%d" % k, (1.6, 1.4, hb), (bx, y0 - 0.5, hb / 2), earth, round_=0.6, wobble=0.08, salt=1110 + k)
    # three tapering towers on the river side
    for k, tx in enumerate((-22.0, 0.0, 22.0)):
        th = 21.0 if k == 1 else 17.0
        prof = [(0, 0), (4.6, 0), (3.6, th * 0.85), (2.4, th), (1.2, th + 1.6), (0, th + 2.0)]
        tw = C.lathe("Tower%d" % k, prof, 4, earth, False)
        tw.rotation_euler = (0, 0, math.pi / 4)
        tw.location = (x0 + tx, y0 - 2.5, 0)
        b = tw.modifiers.new("Bevel", "BEVEL")
        b.width = 0.35
        b.segments = 3
        b.limit_method = "ANGLE"
        # rows of beams on the tower's front face
        for row in range(5):
            z = 2.5 + row * th * 0.17
            half = 4.6 - (4.6 - 3.6) * z / (th * 0.85)
            for c in range(4):
                bx = x0 + tx + (c - 1.5) * half * 0.42
                beams.append((bx, y0 - 2.5 - half * 0.72, z))
    # beams along the front wall
    for row in range(2):
        for k in range(26):
            beams.append((x0 - W / 2 + 2 + k * (W - 4) / 25, y0 - 0.05, 3.2 + row * 3.2))
    for i, (bx, by, bz) in enumerate(beams):
        bm = C.lathe("Toron%d" % i, [(0, 0), (0.14, 0), (0.12, 1.5), (0, 1.55)], 6, wood, False)
        bm.rotation_euler = (math.radians(90), 0, r.uniform(-0.1, 0.1))
        bm.location = (bx, by + 0.6, bz)


def houses(earth_mats, x0, x1, y0, y1, n, salt, avoid):
    """Mud-brick houses: rounded blocks, some two storeys, parapets with
    small rounded corner pinnacles, low compound walls between."""
    r = C.rng(salt)
    k = 0
    for i in range(n * 3):
        if k >= n:
            break
        x, y = r.uniform(x0, x1), r.uniform(y0, y1)
        if avoid(x, y):
            continue
        m = earth_mats[r.randrange(len(earth_mats))]
        w, d = r.uniform(8, 16), r.uniform(8, 14)
        h = r.uniform(3.5, 8.5) * (1.3 if r.random() < 0.25 else 1.0)
        z = ground_fn(np.array([x]), np.array([y]))[0] - 0.5
        A.rounded_block("House%d" % k, (w, d, h), (x, y, z + h / 2), m, round_=0.5, wobble=0.12, salt=salt * 100 + k)
        for sx in (-1, 1):
            A.rounded_block("Pin%d_%d" % (k, sx), (0.8, 0.8, 1.2), (x + sx * (w / 2 - 0.4), y - d / 2 + 0.4, z + h + 0.5),
                            m, round_=0.35, wobble=0.05, salt=salt * 100 + k + 5000 + sx)
        if r.random() < 0.5:
            A.rounded_block("CWall%d" % k, (r.uniform(8, 16), 0.7, 2.0), (x + r.uniform(-6, 6), y - d / 2 - r.uniform(3, 7), z + 1.0),
                            m, round_=0.3, wobble=0.08, salt=salt * 100 + k + 9000)
        k += 1


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    # a photographed evening sky: gold sun low on the left, broken cloud
    C.sky("late", sun_turn=SUN_TURN)      # the photographed sky made this scene grey; the gold procedural sky suits it
    C.haze(0.00055, (0.95, 0.74, 0.48), 0.6, extent=6000.0, top=300.0)
    gob, Z = T.heightfield("Plain", -2500, 2500, -60, 4500, 420, 520, ground_fn,
                           C.M("rocky_ground", scale=0.2, tint=(1.0, 0.78, 0.56)), py=1.6)
    C.box_mesh("River", (6000, RIVER[1] - RIVER[0] + 60, 0.02), (0, (RIVER[0] + RIVER[1]) / 2, -0.4),
               C.M("rippled_water", colour=(0.05, 0.042, 0.03), rough=0.08, ripple=0.7))
    # the river surface in view: gentle wind waves, so it carries light and reflections
    T.ocean("RiverWaves", tile=120.0, repeat=8, res=11, waves=0.18, chop=0.6, wind=5.0, seed=1105, foam=-1.0,
            mat=T.ocean_water(colour=(0.06, 0.05, 0.035), foam_gain=0.0, rough=0.06),
            loc=(30.0, (RIVER[0] + RIVER[1]) / 2, -0.3))
    earth = [C.M("house_wall", colour=(0.52, 0.34, 0.21), tex="mud", windows=0.18, win=(0.22, 0.3), lattice=0.0, scale=0.15),
             C.M("house_wall", colour=(0.45, 0.29, 0.18), tex="mud", windows=0.18, win=(0.22, 0.3), lattice=0.0, scale=0.15),
             C.M("house_wall", colour=(0.58, 0.39, 0.25), tex="mud", windows=0.18, win=(0.22, 0.3), lattice=0.0, scale=0.15)]
    mosque_earth = C.M("earth_plaster", colour=(0.52, 0.34, 0.21))
    wood = C.M("plain_wood", tint=(0.55, 0.42, 0.30))
    mx, my = 30.0, 470.0
    mosque(mosque_earth, wood, mx, my)
    houses(earth, -330, 390, 360, 950, 620, 1120,
           avoid=lambda x, y: (abs(x - mx) < 48 and y < my + 60) or y < 372)
    # trees: thorn trees on both banks, one great baobab
    r = C.rng(1130)
    for k in range(14):
        x = r.uniform(-500, 600)
        y = r.choice([r.uniform(345, 365), r.uniform(1000, 1300)])
        x = r.uniform(-75, 130)
        t = PL.scan_tree("Acacia%d" % k, "searsia_burchellii", r.uniform(6, 9), r.uniform(8, 12), salt=1140 + k,
                         clumps=10, flat=0.4)
        t.location = (x, y, float(ground_fn(np.array([x]), np.array([y]))[0]) - 0.2)
    b = PL.baobab_fine("Baobab", 18.0, 4.2, salt=1160)
    b.location = (-38.0, 346.0, float(ground_fn(np.array([-95.0]), np.array([352.0]))[0]) - 0.3)
    # long narrow boats on the river
    for k in range(7):
        c = S.canoe("Canoe%d" % k, r.uniform(10, 16))
        c.location = (r.uniform(-150, 200), r.uniform(150, 310), -0.4)
        c.rotation_euler = (0, 0, r.uniform(-0.3, 0.3) + (math.pi if r.random() < 0.5 else 0))
    cam = C.camera("long", CAM, LOOK)
    # a few people and animals on the far bank, tiny
    dark = C.M("dark", colour=(0.06, 0.045, 0.035))
    for k in range(8):
        x, y = r.uniform(-120, 180), r.uniform(338, 360)
        F.place(F.cloaked_figure("Fig%d" % k, dark, 1.7), (x, y, float(ground_fn(np.array([x]), np.array([y]))[0])),
                r.uniform(0, 6), cam)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("sahel-town")
    C.write_log("a11")


main()
