"""A08 the Sahara: great dunes at late sun through the long lens; along a
distant crest a thin line of camels and walkers in silhouette.

    blender -b --factory-startup -P scripts/a08_sahara.py -- --preview

The dune field is kit_terrain.dune_fn so A17's sandstorm can reuse it
(build_field() is importable).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_models as KM     # noqa: E402
import kit_figures as F     # noqa: E402
import numpy as np          # noqa: E402

WIND = -30.0                # wind blows toward this heading (degrees from +X)
CAM = (0.0, 0.0)            # camera stands here, on a dune shoulder
CAM_EYE = 1.6
RIDGE_DEG = -14.0           # the camera's ridge runs off ahead-left
RIDGE_H = 58.0
CARAVAN_DIST = (1500.0, 2300.0)
SUN_TURN = -82.0            # sun low on the left, a little ahead: long shadows across the view
EXPOSURE = -2.0


def field_fn():
    big = T.dune_fn(wavelength=420.0, height=62.0, wind_deg=WIND, seed=8, draa=0.5)

    def f(X, Y):
        z = big(X, Y)
        # the camera stands on a long ridge running off ahead and a little
        # to the left; its right flank, facing away from the low left sun,
        # falls away in shadow across the lower third of the picture
        ra = math.radians(RIDGE_DEG)
        along = (X - CAM[0]) * math.sin(ra) + (Y - CAM[1]) * math.cos(ra)
        perp = (X - CAM[0]) * math.cos(ra) - (Y - CAM[1]) * math.sin(ra)
        w = np.where(perp > 0, 85.0, 140.0)
        fade = np.exp(-(np.maximum(along, 0) / 650.0) ** 2) * (1 / (1 + np.exp(-(along + 120.0) / 40.0)))
        ridge = RIDGE_H * np.exp(-(perp / w) ** 2) * fade
        keep = 1 - 0.85 * np.exp(-(perp / 160.0) ** 2) * fade
        return z * keep + ridge
    return f


def build_field(sand=None):
    f = field_fn()
    ob, Z = T.heightfield("Dunes", -5000, 7000, -200, 14000, 640, 820, f, sand or T.dune_sand(wind_deg=WIND),
                          py=2.6, px=1.0)
    return ob, Z, f


def crest_path(f, x0, x1, ylo, yhi, step=6.0):
    """Follow the highest line between ylo and yhi for x0..x1."""
    pts = []
    ys = np.linspace(ylo, yhi, 400)
    for x in np.arange(x0, x1, step):
        zs = f(np.full_like(ys, x), ys)
        j = int(np.argmax(zs))
        pts.append((x, ys[j], zs[j]))
    # smooth the line a little
    p = np.array(pts)
    for _ in range(3):
        p[1:-1, 1] = (p[:-2, 1] + p[1:-1, 1] + p[2:, 1]) / 3
    p[:, 2] = f(p[:, 0], p[:, 1])
    return p


def caravan(cam, f):
    path = crest_path(f, 470.0, 900.0, *CARAVAN_DIST)
    dark = C.M("dark", colour=(0.05, 0.035, 0.025))
    r = C.rng(808)
    i = 6
    k = 0
    while i < len(path) - 2 and k < 34:
        x, y, z = path[i]
        dx, dy = path[i + 1][0] - path[i - 1][0], path[i + 1][1] - path[i - 1][1]
        heading = math.atan2(dy, dx)
        if k % 5 == 4:
            fig = F.cloaked_figure("Walker%d" % k, dark, 1.7)
            F.place(fig, (x, y, z - 0.1), heading, cam)
        else:
            load = "salt" if r.random() < 0.6 else "bales"
            cm = F.camel("Camel%d" % k, 1, dark, height=2.0, load=load)
            F.place(cm, (x, y, z - 0.15), heading, cam)
        k += 1
        i += 1 if k % 5 else 1
    return path


def spindrift(f, cam):
    """Threads of sand lifted off two crests, streaming downwind."""
    wa = math.radians(WIND)
    out = []
    for (cx, ylo, yhi, L) in ((260.0, 600.0, 900.0, 160.0), (880.0, 1100.0, 1450.0, 220.0)):
        p = crest_path(f, cx, cx + L, ylo, yhi, step=20.0)
        z = float(p[:, 2].max())
        x0, x1 = p[:, 0].min(), p[:, 0].max()
        ym = float(p[:, 1].mean())
        out.append(T.streak_volume("Drift%d" % len(out), (x0, ym - 8, z - 6), (x1 + 30, ym + 60, z + 10),
                                   0.35, (0.85, 0.66, 0.45), streak=(1, 0, 0), scale=0.05, thresh=0.5, anis=0.6))
    return out


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    C.sky("late", sun_turn=SUN_TURN, strength=1.25)      # a sky photo was tried: it flattened the light
    C.haze(0.000018, (0.92, 0.80, 0.66), 0.6, top=800.0, extent=16000.0)
    ob, Z, f = build_field()
    zc = T.sample(Z, ob, CAM[0], CAM[1])
    cam = C.camera("long", (CAM[0], CAM[1], zc + CAM_EYE), (CAM[0] + 650.0, 1900.0, 18.0))
    caravan(cam, f)
    spindrift(f, cam)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("sahara-dunes")
    C.write_log("a08")


if __name__ == "__main__":
    main()
