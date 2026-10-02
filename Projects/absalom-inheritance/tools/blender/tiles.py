# The Absalom Inheritance's tile sheet (WISHLIST.md B2): the board's squares
# and the solids that stand on them, at render.js's 2:1 angle, packed into
# assets/sprites/tiles.png with its atlas in assets/sprites/tiles.json.
#
#   blender -b --factory-startup -t 4 -P tools/blender/tiles.py
#   blender -b --factory-startup -t 4 -P tools/blender/tiles.py -- wall
#
# With no frame named it renders the whole sheet and writes it. Naming frames
# renders only those, into tools/blender/out/, and writes nothing the game
# loads: that is for looking at one tile while its build is changed.
#
# Every colour is one of render.js's PALETTE entries, read through spec.mjs,
# and every solid is held to its SOLIDS box (common.py's header has the axes).

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

H = C.HT_UNIT          # world units per render.js pixel of height
BEVEL = 0.018          # a stone's edge: a blended band, and a dark line where two meet


def stones(prefix, mat, x0, y0, z0, x1, y1, z1, split, bevel=BEVEL):
    """One course of masonry: the block x0..x1, y0..y1, z0..z1 cut at
    split = (sx, sy) into four stones, so a joint shows on both faces."""
    sx, sy = split
    for i, (a, b) in enumerate(((x0, sx), (sx, x1))):
        for j, (c, d) in enumerate(((y0, sy), (sy, y1))):
            C.box(f'{prefix}{i}{j}', a, c, z0, b, d, z1, mat, bevel)


def wall(sp):
    """render.js's wall prism: a full square, SOLIDS.wall.ht high. Three
    courses of stone under one capstone, the joints staggered course to
    course from a seeded draw, kept clear of the faces' centres so the
    validator's face samples land on stone."""
    p = sp['PALETTE']
    mat = C.palette_mat('wall', p['wallTop'], p['wallLeft'], p['wallRight'])
    top = sp['SOLIDS']['wall']['ht'] * H
    r = C.rng(26)
    edges = [0.0, 0.27, 0.54, 0.80]
    for k in range(3):
        sx = r.choice((-1, 1)) * r.uniform(0.16, 0.32)
        sy = r.choice((-1, 1)) * r.uniform(0.16, 0.32)
        stones(f'course{k}', mat, -0.5, -0.5, edges[k] * top, 0.5, 0.5, edges[k + 1] * top, (sx, sy))
    C.box('cap', -0.5, -0.5, edges[3] * top, 0.5, 0.5, top, mat, BEVEL)


BUILDERS = {
    'wall': wall,
}

if __name__ == '__main__':
    C.run_sheet('tiles', BUILDERS)
