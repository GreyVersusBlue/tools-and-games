# The Absalom Inheritance's figure sheet (WISHLIST.md B3): the heir, the foe
# and the boss, standing where render.js stands their prisms, packed into
# assets/sprites/figures.png with its atlas in assets/sprites/figures.json.
#
#   blender -b --factory-startup -t 4 -P tools/blender/figures.py
#   blender -b --factory-startup -t 4 -P tools/blender/figures.py -- heir
#
# An heir's colours are content: each build in each pack carries its own
# `palette`, so the heir is rendered once with common.py's mask material
# (red where a face would take the build's top colour, green its left, blue
# its right) and render.js tints it at draw time. A pack with new colours
# needs no new render. The foe and the boss take PALETTE's foe and boss
# colours directly, because render.js draws every foe alike and tells the
# boss by its level, not its name.
#
# Each figure faces the viewer (Blender +X +Y). Its head is placed so the eye
# render.js draws over it, at 12 and 16 render.js pixels above the square's
# centre, lands on the face.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

FRONT = (math.sqrt(0.5), math.sqrt(0.5))     # toward the camera, on the floor


def ahead(d):
    """A point d world units toward the viewer."""
    return FRONT[0] * d, FRONT[1] * d


def side(d):
    """A point d world units to the viewer's right (Blender -X +Y)."""
    return -FRONT[0] * d, FRONT[1] * d


def heir(sp):
    """A hooded wanderer in a long cloak, SOLIDS.heir high: the cloak a
    frustum flaring to the floor, a mantle over the shoulders, the hood round
    the head, and a satchel at the hip."""
    m = C.mask_mat('heir')
    C.prism_n('cloak', 0.0, 0.0, 0.0, 0.40, 0.17, 0.10, 14, m)
    C.sphere('mantle', 0.0, 0.0, 0.38, 0.14, 0.14, 0.08, m)
    hx, hy = ahead(0.015)
    C.sphere('hood', hx * 0.2, hy * 0.2, 0.50, 0.095, 0.095, 0.11, m)
    C.sphere('head', hx, hy, 0.49, 0.072, 0.072, 0.075, m)
    for k, s in enumerate((-1, 1)):
        ax, ay = side(0.15 * s)
        C.sphere(f'arm{k}', ax, ay, 0.27, 0.05, 0.05, 0.12, m)
    sx, sy = side(0.12)
    fx, fy = ahead(0.08)
    C.box('satchel', sx + fx - 0.05, sy + fy - 0.05, 0.16, sx + fx + 0.05, sy + fy + 0.05, 0.25, m, 0.015)


def foe(sp):
    """A hunched thing on two short legs, SOLIDS.foe high: a heavy belly,
    long arms hanging to the knee, a low head thrust forward with two swept
    ears."""
    p = sp['PALETTE']
    m = C.palette_mat('foe', p['foeTop'], p['foeLeft'], p['foeRight'])
    for k, s in enumerate((-1, 1)):
        lx, ly = side(0.07 * s)
        C.prism_n(f'leg{k}', lx, ly, 0.0, 0.12, 0.045, 0.055, 8, m)
    C.sphere('belly', 0.0, 0.0, 0.22, 0.16, 0.16, 0.15, m)
    bx, by = ahead(0.03)
    C.sphere('chest', bx, by, 0.32, 0.13, 0.13, 0.08, m)
    hx, hy = ahead(0.07)
    C.sphere('head', hx, hy, 0.40, 0.085, 0.085, 0.08, m)
    for k, s in enumerate((-1, 1)):
        ex, ey = side(0.085 * s)
        C.prism_n(f'ear{k}', hx + ex, hy + ey, 0.42, 0.52, 0.03, 0.004, 6, m)
        ax, ay = side(0.17 * s)
        C.sphere(f'arm{k}', ax + bx, ay + by, 0.20, 0.045, 0.045, 0.13, m)


def boss(sp):
    """The Keeper, SOLIDS.boss high on its wider footprint: a robed bulk with
    broad shoulders, a crowned head, and two horns curling up past it."""
    p = sp['PALETTE']
    m = C.palette_mat('boss', p['bossTop'], p['bossLeft'], p['bossRight'])
    C.prism_n('robe', 0.0, 0.0, 0.0, 0.40, 0.21, 0.15, 16, m)
    C.sphere('shoulders', 0.0, 0.0, 0.42, 0.20, 0.20, 0.09, m)
    hx, hy = ahead(0.05)
    C.sphere('head', hx, hy, 0.53, 0.10, 0.10, 0.10, m)
    for k, s in enumerate((-1, 1)):
        # A horn as three shrinking spheres climbing outward and up.
        for j, (out, up, r) in enumerate(((0.10, 0.58, 0.045), (0.14, 0.64, 0.035), (0.15, 0.70, 0.025))):
            ox, oy = side(out * s)
            C.sphere(f'horn{k}{j}', hx * 0.5 + ox, hy * 0.5 + oy, up, r, r, r * 1.2, m, 10, 6)
        ax, ay = side(0.22 * s)
        C.sphere(f'arm{k}', ax, ay, 0.28, 0.06, 0.06, 0.15, m)


BUILDERS = {
    'heir': heir,
    'foe': foe,
    'boss': boss,
}

if __name__ == '__main__':
    C.run_sheet('figures', BUILDERS)
