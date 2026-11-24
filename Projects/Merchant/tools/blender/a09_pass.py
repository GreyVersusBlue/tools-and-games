"""A09 a mountain pass in snow: between rock walls, a narrow track climbs to
a notch in the ridge. Deep snow, a stone cairn, a small rough stone shelter
with smoke; far up the track a few loaded animals and walkers as small dark
shapes. Overcast turning to snow, normal lens.

    blender -b --factory-startup -P scripts/a09_pass.py -- --preview

The animals are two-humped camels and mules: this is the Asian road.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_figures as F     # noqa: E402
import kit_props as P       # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_models as KM     # noqa: E402
import numpy as np          # noqa: E402

NOTCH_Y = 1100.0
NOTCH_Z = 210.0
CAM = (6.0, 0.0)
CAM_EYE = 1.7
EXPOSURE = 0.2


def track_x(Y):
    return 18.0 * np.sin(Y / 170.0) - 6.0 * np.sin(Y / 61.0)


def pass_fn(X, Y):
    t = np.clip(Y / NOTCH_Y, 0, 1)
    floor = NOTCH_Z * t ** 1.25 - np.maximum(Y - NOTCH_Y, 0) * 0.35
    dx = np.abs(X - track_x(Y))
    # valley walls steepen into rock faces; they close in toward the notch
    width = 120.0 - 70.0 * t
    walls = 380.0 * np.clip((dx - width * 0.25) / (width * 2.2), 0, 1) ** 1.4
    rough = (70.0 * T.ridged(X, Y, 260.0, 6, 91) + 14.0 * T.ridged(X, Y, 45.0, 4, 93)) * np.clip(dx / width, 0, 1)
    snowy = 2.0 * T.fbm(X, Y, 25.0, 3, 92)
    # the trodden track: a shallow groove
    groove = -0.5 * np.exp(-(dx / 1.6) ** 2)
    return floor + walls + rough + snowy + groove


def hut(name, x, y, z, rock):
    """A small rough stone shelter, half buried in drifts, smoke from the
    roof."""
    parts = []
    w, d, h = 5.0, 4.0, 2.4
    parts.append(P.block(name + "_walls", (w, d, h), rock, chip=0.5, salt=901))
    roof = P.block(name + "_roof", (w + 0.6, d + 0.6, 0.45), rock, chip=0.15, salt=902)
    roof.location.z = h - 0.1
    parts.append(roof)
    snow = P.block(name + "_snowcap", (w + 0.7, d + 0.7, 0.35), C.M("snow_ground"), chip=0.3, salt=903)
    snow.location.z = h + 0.3
    parts.append(snow)
    door = C.box_mesh(name + "_door", (0.9, 0.1, 1.4), (0.8, -d / 2 - 0.02, 0.7), C.M("dark", colour=(0.02, 0.018, 0.015)))
    parts.append(door)
    g = P.group(name, parts, (x, y, z - 0.3), math.radians(12))
    T.smoke(name + "_smoke", (x - 1.0, y + 0.5, z + h + 0.5), height=16.0, width=2.4, drift=(7.0, 2.0),
            density=3.0, colour=(0.45, 0.45, 0.47))
    return g


def cairn(name, x, y, z, rock):
    """A traveller's cairn: a rough cone of piled stones, snow lodged on top."""
    r = C.rng(931)
    k = 0
    for lvl, (n, rad, s0) in enumerate(((9, 0.75, 0.55), (6, 0.5, 0.45), (4, 0.28, 0.38), (1, 0.0, 0.32))):
        for i in range(n):
            a = 2 * math.pi * i / n + r.uniform(-0.3, 0.3)
            b = P.block("%s_%d" % (name, k), (s0 * r.uniform(0.9, 1.4), s0 * r.uniform(0.8, 1.1), s0 * 0.75), rock,
                        chip=0.1, salt=940 + k)
            b.location = (x + math.cos(a) * rad, y + math.sin(a) * rad, z - 0.1 + lvl * 0.36)
            b.rotation_euler = (r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), r.uniform(0, 3))
            k += 1
    cap = P.heap(name + "_snow", 0.32, 0.14, mat=C.M("snow_ground"), salt=949)
    cap.location = (x, y, z + 1.35)


def track_strip(h):
    """The trodden track: a narrow band of packed, greyer snow following
    the groove up toward the notch."""
    m = C.M("snow_ground")
    tm = C._NB("trodden")
    tm.set(Base_Color=(0.74, 0.74, 0.77), Roughness=0.85)
    verts, faces = [], []
    ys = np.linspace(6.0, NOTCH_Y, 500)
    for i, y in enumerate(ys):
        x = float(track_x(np.array([y]))[0])
        w = 0.45 + 0.15 * math.sin(y / 9.0) + 0.1 * math.sin(y / 2.3)
        for s in (-1, 1):
            verts.append((x + s * w, y, h(x + s * w, y) + 0.04))
        if i:
            a = 2 * (i - 1)
            faces.append((a, a + 1, a + 3, a + 2))
    return C.mesh_object("Track", verts, faces, tm.m)


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    KM.sky_photo("snow_field_puresky", sun_turn=30.0, strength=1.0)      # a photographed snowy overcast
    C.haze(0.0016, (0.82, 0.84, 0.88), 0.2, extent=4000.0, top=1200.0)
    gob, Z = T.heightfield("Pass", -900, 900, -80, 2200, 460, 620, pass_fn, T.rock_snow_mat(slope=0.62), py=1.7)
    h = lambda x, y: T.sample(Z, gob, x, y)
    zc = h(*CAM)
    cam = C.camera("normal", (CAM[0], CAM[1], zc + CAM_EYE), (float(track_x(np.array([NOTCH_Y]))[0]), NOTCH_Y, NOTCH_Z + 30.0))
    rock = C.M("rock", scale=0.5)
    cairn("Cairn", 12.0, 30.0, h(12.0, 30.0), rock)
    track_strip(h)
    hx, hy = float(track_x(np.array([150.0]))[0]) - 22.0, 150.0
    hut("Hut", hx, hy, h(hx, hy), rock)
    # far up the track: two-humped camels, mules and walkers
    dark = C.M("dark", colour=(0.04, 0.035, 0.03))
    seq = ["fig", "camel2", "camel2", "mule", "fig", "camel2", "mule", "fig"]
    for k, kind in enumerate(seq):
        y = 390.0 + k * 6.0
        x = float(track_x(np.array([y]))[0])
        dy = 1.0
        hd = math.atan2(dy, float(track_x(np.array([y + 1]))[0] - x)) + 0.0
        if kind == "fig":
            ob = F.cloaked_figure("Walker%d" % k, dark, 1.7)
        elif kind == "camel2":
            ob = F.camel("Camel%d" % k, 2, dark, height=2.0, load="bales")
        else:
            ob = F.mule("Mule%d" % k, dark, 1.4)
        F.place(ob, (x, y, h(x, y) - 0.2), hd, cam)
    # boulders breaking through the snow along the track and up the slopes
    for i, tid in enumerate(("namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_05")):
        KM.scatter(tid, 45, (-140, 160, 40, 700), h, 9200 + i, scale=(0.5, 1.6),
                   avoid=lambda x, y: abs(x - float(track_x(np.array([y]))[0])) < 4.0, name="Boulder%d" % i)
    T.flakes("Snowfall", cam, n=14000, near=7.0, far=140.0, size=0.007, seed=95)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("mountain-pass")
    C.write_log("a09")


main()
