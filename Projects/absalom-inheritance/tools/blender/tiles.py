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

import math
import os
import sys

import bmesh

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


def flagstones(prefix, mat, seed):
    """A floor square as four flagstones, 2 cm thick, cut off-centre from a
    seeded draw so the top face's centre lands on stone. Each stone is
    bevelled, so a joint reads as a fine line and the square's own edge as
    the grid render.js strokes over it."""
    r = C.rng(seed)
    sx = r.choice((-1, 1)) * r.uniform(0.12, 0.24)
    sy = r.choice((-1, 1)) * r.uniform(0.12, 0.24)
    g = 0.504                                   # common.diamond_floor's grow
    stones(prefix, mat, -g, -g, -0.02, g, g, 0.0, (sx, sy), bevel=0.012)


def slab(prefix, mat):
    """A floor square as one stone: a gate's sill."""
    C.box(prefix, -0.504, -0.504, -0.02, 0.504, 0.504, 0.0, mat, 0.012)


def floor(colour, seed):
    def build(sp):
        flagstones('flag', C.palette_mat('floor', *C.sides_of(sp['PALETTE'][colour])), seed)
    return build


def sill(colour):
    def build(sp):
        slab('sill', C.palette_mat('sill', *C.sides_of(sp['PALETTE'][colour])))
    return build


def steps(sp):
    """The stairway, drawn while it is in sight in place of render.js's two
    gold diamonds: the square's stone round a well, and four steps going down
    into it away from the viewer, a gold lip on the top step."""
    p = sp['PALETTE']
    stone = C.palette_mat('stone', *C.sides_of(p['stairs']))
    gold = C.palette_mat('lip', *C.sides_of(p['goldDim']))
    g, w = 0.504, 0.32                      # the well is 2w across
    depth = 0.28
    # The stone round the well, as four blocks reaching down past the well's
    # floor, so the well's back walls are their inner faces.
    low = -depth - 0.04
    C.box('rimN', -g, -g, low, g, -w, 0.0, stone, 0.01)
    C.box('rimS', -g, w, low, g, g, 0.0, stone, 0.01)
    C.box('rimW', -g, -w, low, -w, w, 0.0, stone, 0.01)
    C.box('rimE', w, -w, low, g, w, 0.0, stone, 0.01)
    # The earth in front of the square, below the floor: a holdout, so the
    # blocks' outer faces leave the film clear under the diamond's front edges
    # instead of hanging below them.
    hold = C.holdout_mat('earth')
    C.box('earthX', g, -g - 0.1, -1.0, g + 0.2, g + 0.2, -0.0005, hold)
    C.box('earthY', -g - 0.1, g, -1.0, g + 0.2, g + 0.2, -0.0005, hold)
    # Four steps down toward Blender -X -Y (away from the camera), each one a
    # block from the well's floor up to its tread.
    n = 4
    for k in range(n):
        x0 = -w + (2 * w) * k / n
        tread = -depth * (n - k) / (n + 1)
        C.box(f'step{k}', x0, -w, -depth - 0.02, x0 + 2 * w / n, w, tread, stone, 0.008)
    C.box('lip', w - 0.03, -w, -0.004, w, w, 0.006, gold, 0.004)


def casket(sp):
    """The casket, drawn on a treasure square while it is in sight in place
    of render.js's gold diamond: a chest in gold, its lid a half-round, banded
    in goldDim."""
    p = sp['PALETTE']
    gold = C.palette_mat('gold', *C.sides_of(p['gold']))
    band = C.palette_mat('band', *C.sides_of(p['goldDim']))
    lx, ly, hz = 0.15, 0.10, 0.20           # half-length, half-width, body height
    C.box('body', -lx, -ly, 0.0, lx, ly, hz, gold, 0.01)
    # The lid: a half cylinder along X.
    bm = bmesh.new()
    seg = 10
    a_ring, b_ring = [], []
    for k in range(seg + 1):
        t = math.pi * k / seg
        y, z = ly * math.cos(t), hz + ly * 0.9 * math.sin(t)
        a_ring.append(bm.verts.new((-lx, y, z)))
        b_ring.append(bm.verts.new((lx, y, z)))
    for k in range(seg):
        f = bm.faces.new([a_ring[k], b_ring[k], b_ring[k + 1], a_ring[k + 1]])
        f.smooth = True
    bm.faces.new(a_ring[::-1])
    bm.faces.new(b_ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    C.mesh_object('lid', bm, gold)
    for k, x in enumerate((-lx * 0.6, lx * 0.6)):
        C.box(f'band{k}', x - 0.015, -ly - 0.008, -0.0, x + 0.015, ly + 0.008, hz + 0.002, band)


def door(sp):
    """The shut gate, render.js's door prism: a full square SOLIDS.door.ht
    high, timber in the door colours, two iron straps across both faces the
    viewer sees, kept off the faces' centres."""
    p = sp['PALETTE']
    wood = C.palette_mat('wood', p['doorTop'], p['doorLeft'], p['doorRight'])
    iron = C.palette_mat('iron', *C.sides_of(C.tone(p['doorLeft'], 0.8)))
    top = sp['SOLIDS']['door']['ht'] * H
    # Planks: the block cut into five boards along X, so a seam runs up the
    # right face; the seams stand clear of its centre at +-0.1.
    cuts = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]
    for i in range(5):
        C.box(f'boardX{i}', cuts[i], -0.5, 0.0, cuts[i + 1], 0.5, top - 0.06, wood, 0.012)
    # A lintel over the boards, so the top reads as one timber and not a crate.
    C.box('lintel', -0.5, -0.5, top - 0.06, 0.5, 0.5, top, wood, 0.012)
    for z0 in (0.16, 0.74):
        z = z0 * top
        C.box(f'strap{z0}', -0.5, -0.5, z, 0.512, 0.512, z + 0.06, iron, 0.006)


def pillar(sp):
    """render.js's pillar prism, SOLIDS.pillar.ht high on SOLIDS.pillar.fp of
    the square: a plinth, an eight-sided shaft, and a capital whose top is
    where render.js sets the lore gem."""
    p = sp['PALETTE']
    mat = C.palette_mat('pillar', p['pillarTop'], p['pillarLeft'], p['pillarRight'])
    s = sp['SOLIDS']['pillar']
    top, half = s['ht'] * H, s['fp'] / 2
    C.box('plinth', -half, -half, 0.0, half, half, 0.12, mat, 0.015)
    C.box('torus', -half * 0.82, -half * 0.82, 0.12, half * 0.82, half * 0.82, 0.18, mat, 0.02)
    C.prism_n('shaft', 0.0, 0.0, 0.18, top - 0.16, half * 0.62, half * 0.55, 8, mat,
              turn=math.pi / 8)
    C.box('neck', -half * 0.74, -half * 0.74, top - 0.16, half * 0.74, half * 0.74, top - 0.10, mat, 0.015)
    C.box('abacus', -half, -half, top - 0.10, half, half, top, mat, 0.015)


BUILDERS = {
    'floor/a': floor('floorA', 1),
    'floor/b': floor('floorB', 2),
    'treasure': floor('treasure', 3),
    'casket': casket,
    'gate/shut': sill('gateShut'),
    'gate/open': sill('gateOpen'),
    'stairs': floor('stairs', 4),
    'steps': steps,
    'wall': wall,
    'door': door,
    'pillar': pillar,
}

if __name__ == '__main__':
    C.run_sheet('tiles', BUILDERS)
