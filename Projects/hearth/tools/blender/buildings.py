# The building sheet (HISTORY.md #807): every kind in js/core.js's BLD, the
# house in each roof colour sim.js picks from, and a snow frame for each
# building the game puts snow on. Writes assets/sprites/buildings.png and
# buildings.js, and a contact sheet over the grass to tools/blender/out/.
#
#   blender -b --factory-startup -t 4 -P tools/blender/buildings.py
#
# Each model is built in map pixels from the building's tile corner (x east,
# y south, z up; common.py), standing where render.js's procedural drawing
# stood: its foot on the same row, its south face the elevation the game drew,
# so a door, a window or a lamp is on the pixel it was on. What stays drawn by
# render.js over a frame is what moves or changes: the mill's sails, a lit
# window, the lighthouse lamp, the kiln's chimney pots, the hall's shelf, the
# boat beside the hut, and a building still going up (#807).
#
# A10 adds what the year does to a building: the house, hut and hall each have
# an autumn dress (a woodpile against the west wall, two leaves on the roof) and
# a spring dress (a flower box), and every snow frame comes in two weights,
# `-snow1` (the ridge and the eaves) and `-snow2` (the whole roof, with icicles
# under the eaves). `-snow1` is cut out of `-snow2` and the icicles are added to
# it after the render, both from the pixels alone, so the second run of this
# script is the first one's bytes again.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.check_version()
SPEC = C.spec()
BUDGET = C.budget()
TIERS = BUDGET['tiers']
SNOW = BUDGET['snow']
T = SPEC['T']

R = C.rng(9)        # nothing is random yet; the one generator a model may use

# The palette, every hex of it render.js's own (spec.mjs checks none is new).
WALL = '#b8a17e'
WOOD, PLANK, DARK, DEEP = '#8a6a44', '#6b4a2a', '#6f4b32', '#4a2f16'
STONE, STONE_D, PALE = '#8c8478', '#3a3a30', '#d9d4c8'
WINDOW = '#2b2b3a'
SLATE = '#4c5f78'
LEAF = ('#d4813a', '#b8552a', '#c0392b')           # the autumn greens' turn, render.js's own
PETAL, GOLD, GREEN = '#e8a0b8', '#d4c04a', '#7fb64c'


def leaf(m, x, row, hexv, y1, z0, z1, inset):
    """One roof pixel: a quad on a hipped roof's south face (the plane
    z = z0 + slope * (y1 - y)), one screen pixel tall at screen row `row` and
    one wide at x, a hair toward the viewer so it wins over the roof."""
    k = (z1 - z0) / inset

    def at(sr):
        y = (sr + z0 + k * y1) / (1 + k)
        return y, z0 + k * (y1 - y)
    (ya, za), (yb, zb) = at(row), at(row + 1)
    d = 0.05
    m.face([(x, yb + d, zb), (x + 1, yb + d, zb), (x + 1, ya + d, za), (x, ya + d, za)], hexv)


def woodpile(m, x0, y0, y1, h):
    """Split logs stacked against a west wall: a block with its log ends on the
    south face, three rows of them, each end a dark ring on wood."""
    m.box(x0, x0 + 3, y0, y1, 0, h, PLANK, top=WOOD)
    for z in range(0, h, 2):
        m.plate(x0, x0 + 3, z, z + 1, y1, WOOD)
        if z + 1 < h:
            m.plate(x0, x0 + 3, z + 1, z + 2, y1, DEEP)


def flowers(m, x0, z, y):
    """A flower box on a south wall, three wide: its front on row z to z+1, a
    petal, a leaf and a bloom standing on it."""
    m.plate(x0, x0 + 3, z, z + 1, y, PLANK)
    for i, c in enumerate((PETAL, GREEN, GOLD)):
        m.plate(x0 + i, x0 + i + 1, z + 1, z + 2, y, c)


def house(roof, dress=None):
    m = C.Model()
    m.box(1, 15, 12, 16, 0, 9, WALL)
    m.plate(7, 10, 0, 5, 16, DEEP)                      # the door
    m.plate(4, 7, 3, 6, 16, WINDOW)                      # the windows, lit by draw()
    m.plate(10, 13, 3, 6, 16, WINDOW)
    m.hip(-1, 17, 12, 16, 8, 14, 2, roof)                # front face is the game's triangle
    if dress == 'autumn':
        woodpile(m, -2, 11, 15, 5)                       # its wood in, against the west wall
        leaf(m, 4, 5, LEAF[0], 16, 8, 14, 2)             # two leaves caught on the roof
        leaf(m, 10, 3, LEAF[1], 16, 8, 14, 2)
    elif dress == 'spring':
        flowers(m, 4, 1, 16)                             # under the west window
    return m


def hut(dress=None):
    m = C.Model()
    m.box(1, 15, 4, 7, 0, 8, WOOD)
    m.plate(6, 9, 0, 5, 7, '#4a3a2a')                   # the door
    m.plate(11, 14, 2, 6, 7, STONE_D)                    # the stove
    m.box(12, 13, 5, 6, 6, 12, STONE_D)                  # its pipe
    m.box(0, 16, 4, 8, 7, 8, DARK)                       # the roof, a flat board
    if dress == 'autumn':
        woodpile(m, -1, 5, 7, 3)
        for x, y, c in ((4, 6, LEAF[0]), (11, 5, LEAF[2])):   # two leaves on the board
            m.face([(x, y, 8.05), (x + 1, y, 8.05), (x + 1, y - 1, 8.05), (x, y - 1, 8.05)], c)
    elif dress == 'spring':
        flowers(m, 2, 0, 7)                              # beside the door, there being no window
    return m


def well():
    m = C.Model()
    m.box(1, 7, 3, 7, 0, 4, STONE, top=PALE)
    m.face([(2, 6, 4.05), (6, 6, 4.05), (6, 4, 4.05), (2, 4, 4.05)], STONE_D)  # the water
    m.box(1, 2, 5, 6, 4, 8, DARK)                        # the posts
    m.box(6, 7, 5, 6, 4, 8, DARK)
    m.box(0, 8, 5, 6, 8, 9, DARK)                        # the beam
    return m


def market():
    m = C.Model()
    for i, (cloth, sy) in enumerate((('#8a3d2f', 2), (SLATE, 14), ('#c9a24a', 2))):
        sx, g = 2 + i * 8, sy + 7                         # g: the stall's front row
        m.box(sx, sx + 1, g - 1, g, 0, 4, DARK)           # posts
        m.box(sx + 5, sx + 6, g - 1, g, 0, 4, DARK)
        m.box(sx + 1, sx + 5, g - 2, g, 0, 2, WALL)       # the counter
        m.box(sx, sx + 6, g - 3, g, 4, 5, cloth)          # the awning
    return m


def mill():
    m = C.Model()
    m.box(3, 13, 11, 16, 0, 13, '#a89880')
    m.plate(12, 13, 0, 13, 16, STONE)                    # the shaded corner
    m.plate(7, 10, 0, 5, 16, DEEP)                       # the door
    m.hip(2, 14, 12, 16, 12, 16, 2, SLATE)              # the sails turn on its front, drawn
    return m


def smoke():
    m = C.Model()
    m.box(1, 15, 4, 7, 0, 7, '#4a3a2a')
    m.plate(6, 9, 0, 5, 7, '#2a1c12')                   # the door
    m.box(0, 16, 4, 8, 7, 8, '#3a2a1a')                  # the roof
    m.box(12, 14, 5, 7, 8, 11, STONE)                    # the chimney
    return m


def bridge(across):
    """`across` True is the game's hz: water east and west, so the deck runs
    east-west. A bridge is a flat thing, so the deck lies on the ground and
    only the near rail (or both side rails) stands a pixel up."""
    m = C.Model()
    if across:
        m.face([(-1, 7, 0), (9, 7, 0), (9, 1, 0), (-1, 1, 0)], WOOD)
        for y in (2, 4, 6):
            m.face([(-1, y + 1, 0.02), (9, y + 1, 0.02), (9, y, 0.02), (-1, y, 0.02)], PLANK)
        m.face([(-1, 1, 0.02), (9, 1, 0.02), (9, 0, 0.02), (-1, 0, 0.02)], DEEP)
        m.box(-1, 9, 7, 8, 0, 1, DEEP)
    else:
        m.box(1, 7, -1, 9, 0, 1, WOOD)
        for x in (2, 4, 6):
            m.face([(x, 9, 1.02), (x + 1, 9, 1.02), (x + 1, -1, 1.02), (x, -1, 1.02)], PLANK)
        m.box(0, 1, -1, 9, 0, 1, DEEP)
        m.box(7, 8, -1, 9, 0, 1, DEEP)
    return m


def hall(dress=None):
    m = C.Model()
    m.box(1, 23, 11, 16, 0, 11, WALL)
    m.plate(10, 14, 0, 6, 16, DEEP)                     # the door
    m.plate(4, 7, 5, 8, 16, WINDOW)                      # the windows, lit by draw()
    m.plate(17, 20, 5, 8, 16, WINDOW)
    m.hip(-1, 25, 11, 16, 10, 15.5, 2.5, DARK)
    m.box(10, 14, 11, 13, 12, 20, STONE)                 # the bell tower
    m.plate(11, 13, 15, 17, 13, '#f0b35a')               # its lantern
    m.box(9, 15, 11, 14, 20, 21, DARK)                   # its cap
    if dress == 'autumn':
        woodpile(m, -2, 10, 15, 6)
        leaf(m, 4, 3, LEAF[0], 16, 10, 15.5, 2.5)
        leaf(m, 17, 1, LEAF[2], 16, 10, 15.5, 2.5)
    elif dress == 'spring':
        flowers(m, 4, 3, 16)                             # under the west window
    return m


def light():
    m = C.Model()
    m.box(1, 7, 3, 6, 0, 16, '#e6e2d8')
    m.plate(1, 7, 3, 6, 6, '#8a3d2f')                   # the red bands
    m.plate(1, 7, 9, 12, 6, '#8a3d2f')
    m.plate(6, 7, 0, 3, 6.06, '#c9c4b8')                 # the shaded side, between them
    m.plate(6, 7, 6, 9, 6.06, '#c9c4b8')
    m.plate(6, 7, 12, 16, 6.06, '#c9c4b8')
    m.box(0, 8, 4, 6, 16, 17, '#4a4640')                 # the gallery
    m.box(2, 6, 4, 6, 17, 20, '#5a5a60')                 # the lamp, lit by draw()
    m.box(1, 7, 4, 6, 20, 21, '#4a4640')                 # the cap
    return m


DRESSES = ('autumn', 'spring')

# name: (model, frame box [x, y, w, h] in map pixels from the tile corner)
FRAMES = {
    'hut': (hut, (-8, -8, 32, 24)),
    'well': (well, (-8, -8, 24, 24)),
    'market': (market, (0, -8, 32, 32)),
    'mill': (mill, (0, -8, 16, 32)),
    'smoke': (smoke, (-8, -8, 32, 24)),
    'bridge-h': (lambda: bridge(True), (-8, -8, 24, 24)),
    'bridge-v': (lambda: bridge(False), (-8, -8, 24, 24)),
    'hall': (hall, (-8, -16, 40, 40)),
    'light': (light, (-8, -24, 24, 40)),
}
for roof in SPEC['ROOFS']:
    FRAMES['house-' + roof[1:]] = ((lambda r=roof: house(r)), (-8, -8, 32, 32))
    for d in DRESSES:
        FRAMES['house-%s-%s' % (roof[1:], d)] = ((lambda r=roof, d=d: house(r, d)), (-8, -8, 32, 32))
for d in DRESSES:
    FRAMES['hut-' + d] = ((lambda d=d: hut(d)), (-8, -8, 32, 24))
    FRAMES['hall-' + d] = ((lambda d=d: hall(d)), (-8, -16, 40, 40))
SNOWY = {'house': ((lambda: house(SPEC['ROOFS'][0])), (-8, -8, 32, 32))}
for k in SNOW['kinds']:
    if k != 'house':
        SNOWY[k] = FRAMES[k]


def solid(rows, x, y):
    return 0 <= y < len(rows) and 0 <= x < len(rows[0]) // 4 and rows[y][x * 4 + 3] == 255


def runs(rows):
    """Every vertical run of opaque pixels, as (x, top, bottom)."""
    out = []
    for x in range(len(rows[0]) // 4):
        y = 0
        while y < len(rows):
            if solid(rows, x, y):
                t = y
                while solid(rows, x, y + 1):
                    y += 1
                out.append((x, t, y))
            y += 1
    return out


def put(rows, x, y, px):
    rows[y] = rows[y][:x * 4] + px + rows[y][x * 4 + 4:]


def light_snow(heavy):
    """`-snow1`: the snow that lands first, on the ridge and along the eaves,
    which is the top pixel and the bottom pixel of each vertical run of the
    full roof's snow."""
    w, h, rows = heavy
    keep = bytes(w * 4)
    out = [bytearray(keep) for _ in rows]
    for x, t, b in runs(rows):
        for y in (t, b):
            out[y][x * 4:x * 4 + 4] = rows[y][x * 4:x * 4 + 4]
    return w, h, [bytes(r) for r in out]


def icicles(heavy, base):
    """Icicles on `-snow2`: under the lowest snow pixel of every third column,
    one pixel of snow colour, where the building (`base`) is drawn there."""
    w, h, rows = heavy
    rows = list(rows)
    for x, t, b in runs(rows):
        if x % 3 == 0 and solid(base[2], x, b + 1) and not solid(rows, x, b + 1):
            put(rows, x, b + 1, rows[b][x * 4:x * 4 + 4])
    return w, h, rows


def main():
    scene = C.reset()
    tmp = os.path.join(C.OUT, 'frame.png')
    os.makedirs(C.OUT, exist_ok=True)
    frames = {}
    jobs = [(n, f, b, None) for n, (f, b) in FRAMES.items()]
    jobs += [(n + '-snow2', f, b, SNOW['colour']) for n, (f, b) in SNOWY.items()]
    bases = {}
    for name, build, box, snow in jobs:
        C.clear()
        build().build(TIERS, snow=snow, snow_up=SNOW['up'])
        w, h, rows = C.render_frame(scene, box, tmp)
        frames[name] = (w, h, rows, -box[0], -box[1])
        bases[name] = (w, h, rows)
        print(f'buildings.py: {name} {w} x {h}')
    os.remove(tmp)
    for name in [n for n in frames if n.endswith('-snow2')]:
        kind = name[:-6]
        base = bases['house-' + SPEC['ROOFS'][0][1:] if kind == 'house' else kind]
        heavy = icicles(bases[name], base)
        light = light_snow(bases[name])
        for n, (w, h, rows) in ((name, heavy), (kind + '-snow1', light)):
            frames[n] = (w, h, rows, frames[name][3], frames[name][4])
    sheet = BUDGET['sheet']
    w, h, px = C.write_sheet(frames, sheet['width'], sheet['gap'], sheet['png'], sheet['atlas'], T)
    print(f'buildings.py: {sheet["png"]} {w} x {h}')
    print('buildings.py: contact sheet', C.contact_sheet('buildings', w, h, px, '#5a9a4a', 4))


main()
