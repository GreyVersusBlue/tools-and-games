# The marker sheet (WISHLIST.md B2): one drawing for every kind of plot the
# plat shows a glyph for today, and the front gate, straight down in the
# plat's ink. Writes assets/sprites/markers.png and markers.json, and a
# contact sheet over the built token's colour to tools/blender/out/.
#
#   blender -b --factory-startup -t 4 -P tools/blender/markers.py
#
# Each drawing is built in cells (common.py): the stage in a 2 x 2 box, the
# rest in 1 x 1, centred on the origin, north up. Everything stays a margin
# in from its box's edge so no line is clipped by the frame, which
# validate.mjs checks as a frame whose outer ring is clear.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

import bmesh  # noqa: E402

C.check_version()
SPEC = C.spec()
BUDGET = C.budget()
INK = SPEC['INK']
T = SPEC['TERRAIN_FILL']
PAPER = SPEC['PAPER']
WOOD, DARK_WOOD, GRASS, GREEN = T['hill'], T['path'], T['clearing'], T['woods']
TOKEN = '#E6CD96'   # the middle of .plot-marker.built's gradient; contact sheet only

R = C.rng(5)        # nothing is random yet; the one generator a drawing may use


def annulus(name, cx, cy, r0, r1, z0, z1, mat, seg=32):
    """A ring lying flat: a rope, a fence line, a rim."""
    bm = bmesh.new()
    rings = []
    for r in (r0, r1):
        for z in (z0, z1):
            rings.append([bm.verts.new((x, y, z)) for x, y in C.circle(cx, cy, r, seg)])
    i_lo, i_hi, o_lo, o_hi = rings
    for k in range(seg):
        n = (k + 1) % seg
        bm.faces.new([i_hi[k], o_hi[k], o_hi[n], i_hi[n]])
        bm.faces.new([o_lo[k], o_lo[n], o_hi[n], o_hi[k]])
        bm.faces.new([i_lo[k], i_hi[k], i_hi[n], i_lo[n]])
    return C.mesh_object(name, bm, mat)


def pennant(name, x, y, z, length, width, mat):
    """A flag on a pole at (x, y), flying east."""
    return C.prism(name, [(x, y + width / 2), (x + length, y), (x, y - width / 2)], z, z + 0.01, mat)


# ---------------------------------------------------------------- drawings

def stage():
    """A 2 x 2 stage facing south: a planked deck, a pleated backdrop along
    the north edge, a round thrust apron in front, and a pennant at each
    front corner."""
    planks = 7
    y0, y1 = -0.52, 0.56
    for k in range(planks):
        a = y0 + (y1 - y0) * k / planks
        b = y0 + (y1 - y0) * (k + 1) / planks
        C.box(f'plank{k}', -0.84, a, 0.84, b, 0.0, 0.22, C.flat(f'plank_{k % 2}', WOOD))
    pleats = 9
    for k in range(pleats):
        a = -0.88 + 1.76 * k / pleats
        b = -0.88 + 1.76 * (k + 1) / pleats
        C.box(f'curtain{k}', a, 0.56, b, 0.84, 0.0, 0.9, C.flat(f'curtain_{k % 2}', GREEN))
    arc = [(0.0, -0.52)] + [(0.46 * math.cos(math.pi + math.pi * k / 16),
                             -0.52 + 0.34 * math.sin(math.pi + math.pi * k / 16)) for k in range(17)]
    C.prism('apron', arc, 0.0, 0.2, C.flat('apron', DARK_WOOD))
    for side in (-1, 1):
        x = side * 0.76
        C.disc(f'pole{side}', x, -0.66, 0.05, 0.0, 1.0, C.flat('pole', DARK_WOOD), seg=12)
        flag = 'flag_a' if side < 0 else 'flag_b'
        pennant(f'flag{side}', x + 0.03, -0.66, 0.95, 0.2 if side < 0 else -0.2, 0.14,
                C.flat(flag, GRASS if side < 0 else PAPER))


def food():
    """A food stall: a hipped canopy over the back of the plot with a
    scalloped valance, a counter in front of it, and a fire pit ringed with
    stones and a spit across it in front of that."""
    C.pyramid('canopy', [(-0.38, 0.0), (0.38, 0.0), (0.38, 0.41), (-0.38, 0.41)],
              0.5, 0.78, (0.0, 0.205), C.flat('canopy', PAPER))
    scallops = 6
    for k in range(scallops):
        a = -0.38 + 0.76 * k / scallops
        b = -0.38 + 0.76 * (k + 1) / scallops
        C.prism(f'valance{k}', [(a, 0.0), (b, 0.0), ((a + b) / 2, -0.08)], 0.48, 0.5,
                C.flat(f'valance_{k % 2}', WOOD if k % 2 else DARK_WOOD))
    C.box('counter', -0.36, -0.2, 0.36, -0.08, 0.0, 0.3, C.flat('counter', DARK_WOOD))
    for k in range(8):
        a = 2 * math.pi * k / 8
        C.disc(f'stone{k}', 0.07 * math.cos(a), -0.32 + 0.07 * math.sin(a), 0.026, 0.0, 0.08,
               C.flat('stone', WOOD), seg=10)
    C.disc('embers', 0.0, -0.32, 0.045, 0.0, 0.05, C.flat('embers', GREEN), seg=16)
    C.box('spit', -0.15, -0.33, 0.15, -0.31, 0.0, 0.2, C.flat('spit', DARK_WOOD))
    C.prism('roast', C.circle(0.0, -0.32, 1.0, 16), 0.2, 0.26, C.flat('roast', DARK_WOOD)) \
        .scale = (0.075, 0.045, 1.0)


def vendor():
    """A craft stall: a striped ridged awning, and a table in front of it
    laid out with wares."""
    C.gable('awning', -0.40, -0.04, 0.40, 0.40, 0.45, 0.66,
            C.flat('stripe_a', GRASS), C.flat('stripe_b', PAPER), 6)
    C.box('table', -0.38, -0.30, 0.38, -0.10, 0.0, 0.3, C.flat('table', WOOD))
    C.disc('jug', -0.26, -0.20, 0.05, 0.3, 0.36, C.flat('jug', DARK_WOOD), seg=16)
    C.box('bolt', -0.15, -0.26, -0.03, -0.14, 0.3, 0.34, C.flat('bolt', PAPER))
    C.disc('bowl', 0.09, -0.20, 0.045, 0.3, 0.35, C.flat('bowl', GREEN), seg=16)
    C.box('crate', 0.20, -0.26, 0.32, -0.14, 0.3, 0.36, C.flat('crate', DARK_WOOD))


def demo():
    """A demo camp, where the falconer flies: a roped ring of grass with a
    bell tent in the back of it and a hawk on a T-perch in the front."""
    C.disc('grass', 0.0, 0.0, 0.37, 0.0, 0.02, C.flat('grass', GRASS), seg=40)
    annulus('rope', 0.0, 0.0, 0.37, 0.395, 0.0, 0.2, C.flat('rope', WOOD), seg=40)
    for k in range(10):
        a = 2 * math.pi * k / 10 + math.pi / 10
        C.disc(f'post{k}', 0.383 * math.cos(a), 0.383 * math.sin(a), 0.03, 0.0, 0.3,
               C.flat('post', DARK_WOOD), seg=10)
    C.pyramid('tent', C.circle(-0.1, 0.12, 0.18, 10, math.pi / 10), 0.02, 0.7, (-0.1, 0.12),
              C.flat('tent', PAPER))
    C.box('perch', 0.06, -0.21, 0.30, -0.17, 0.0, 0.4, C.flat('perch', DARK_WOOD))
    hawk = [(0.0, 0.08), (0.03, 0.025), (0.12, 0.04), (0.045, -0.02), (0.025, -0.075),
            (0.0, -0.055), (-0.025, -0.075), (-0.045, -0.02), (-0.12, 0.04), (-0.03, 0.025)]
    C.prism('hawk', [(0.18 + x, -0.16 + y) for x, y in hawk], 0.4, 0.46, C.flat('hawk', GREEN))


def gate():
    """The front gate: a gatehouse in the palisade that the guests walk
    through west to east, two round crenellated towers north and south of the
    road, and the gate between them."""
    C.box('road', -0.44, -0.09, 0.44, 0.09, 0.0, 0.02, C.flat('road', DARK_WOOD))
    for side in (-1, 1):
        cy = side * 0.22
        C.box(f'wall{side}', -0.04, side * 0.3, 0.04, side * 0.43, 0.0, 0.4,
              C.flat('wall', DARK_WOOD))
        C.disc(f'tower{side}', 0.0, cy, 0.14, 0.0, 0.6, C.flat('tower', WOOD), seg=24)
        C.disc(f'floor{side}', 0.0, cy, 0.095, 0.0, 0.62, C.flat('floor', PAPER), seg=24)
        for k in range(6):
            a = 2 * math.pi * k / 6 + math.pi / 6
            C.disc(f'merlon{side}{k}', 0.118 * math.cos(a), cy + 0.118 * math.sin(a), 0.026,
                   0.0, 0.66, C.flat('merlon', WOOD), seg=10)
    C.box('gate', -0.07, -0.1, 0.07, 0.1, 0.0, 0.45, C.flat('gate', WOOD))
    C.box('door', -0.07, -0.1, 0.0, 0.1, 0.0, 0.46, C.flat('door', WOOD))
    C.disc('pole', 0.0, 0.22, 0.022, 0.0, 0.9, C.flat('pole', DARK_WOOD), seg=10)
    pennant('banner', 0.02, 0.22, 0.88, 0.2, 0.12, C.flat('banner', GRASS))


DRAW = {'stage': stage, 'food': food, 'vendor': vendor, 'demo': demo, 'gate': gate}


def main():
    names = [m['name'] for m in SPEC['markers']]
    missing = [n for n in names if n not in DRAW]
    if missing:
        print(f'markers.py: no drawing for {", ".join(missing)}; js/data.js has a kind this file does not')
        sys.exit(1)
    cell, scale = BUDGET['cell'], BUDGET['scale']
    sheet = BUDGET['sheets']['markers']
    scene = C.reset(INK)
    frames = {}
    tmp = os.path.join(C.OUT, 'frame.png')
    os.makedirs(C.OUT, exist_ok=True)
    for m in SPEC['markers']:
        C.clear()
        DRAW[m['name']]()
        w, h = C.frame_px(m['w'], cell, scale), C.frame_px(m['h'], cell, scale)
        frames[m['name']] = C.render_frame(scene, w, h, m['w'], tmp)
        print(f'markers.py: {m["name"]} {w} x {h}')
    os.remove(tmp)
    width, height, px = C.write_sheet(frames, sheet['width'], sheet['png'], sheet['atlas'], cell, scale)
    print('markers.py: contact sheet', C.contact_sheet('markers', width, height, px, TOKEN))


main()
