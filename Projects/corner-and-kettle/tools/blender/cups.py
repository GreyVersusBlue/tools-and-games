# The cup and food sheet (WISHLIST.md B2): every layer cupSvg stacks into a
# cup, and one plate per entry in js/content.js's FOODS.
#
# Run from Projects/corner-and-kettle, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/cups.py
#
# Writes assets/sprites/cups.png and its atlas assets/sprites/cups.js, and a
# contact sheet over the counter's colour to tools/blender/out/cups.png.
#
# The cup is a glass, so the drink shows through it the way the old SVG's
# white cup showed its liquid: cupSvg draws cup_back, the straw, the liquid
# (tinted to its mix), the ice, the foam, the toppings in the old SVG's order,
# and cup_front over all of it. Every layer is rendered through the same
# camera into the same frame, and each is the only thing in its render, but
# for the ice, which is rendered with the full liquid as a holdout so the part
# of a cube under the surface is not drawn. Things that sit on the surface are
# drawn at the full level; at the low level cupSvg moves them down by
# `levels.low` viewBox units, which is what the old SVG did with liquidY.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.check_version()
SPEC = C.spec()
B = C.budget()
COL = B['colours']
SCALE = B['scale']
VIEW = SPEC['VIEW']
BOX = SPEC['CUP_BOX']
INK = SPEC['INK']

# The tinted frames' ink: a grey of INK's own lightness, so the multiply at
# draw time turns it into a darker line of the drink's colour.
GREY_INK = '#3d3d3d'
WHITE = '#ffffff'

# The glass, in Blender units (one is ten viewBox units). The old SVG's body
# ran from a 56-unit mouth to a 44-unit foot; this one is the same.
FOOT, MOUTH, H = 2.2, 2.8, 7.5
WALL, BASE = 0.12, 0.28
LEVELS = {'full': 0.9, 'low': 0.27}   # the old 92% and 20% of its 82-unit column


def radius(z):
    return FOOT + (MOUTH - FOOT) * z / H


def surface(level):
    return LEVELS[level] * H


# Where the camera sits: the frame's centre on the image plane, chosen so the
# rim's back edge lands on the old box's top and the foot on its middle.
_, RIM_TOP = C.screen((0.0, MOUTH, H))
CY = RIM_TOP - (VIEW['h'] / 2 - BOX['y0']) / 10.0
CX = (VIEW['w'] / 2 - 50) / 10.0


def back(a):
    return math.sin(a) >= 0


def front(a):
    return math.sin(a) < 0


def glass_profile():
    """Inside up, over the lip, outside down: the wall has a thickness, so the
    rim reads as a ring and its inner edge is a line."""
    return [(0.0, BASE), (radius(BASE) - WALL, BASE), (MOUTH - WALL, H), (MOUTH, H),
            (FOOT, 0.0), (0.0, 0.0)]


def glass(half, alpha):
    mat = C.flat('glass', COL['glass'], alpha=alpha)
    C.lathe('glass_' + half, glass_profile(), mat, keep=back if half == 'back' else front)


def handle():
    """The old SVG's handle, M78 48 q16 2 14 20 q-2 16 -16 16: out from below
    the rim, round, and back in a third of the way up."""
    mat = C.flat('glass', COL['glass'], alpha=COL['glassFront'])
    zc, rz, rx = 4.4, 1.8, 1.35
    xb = radius(zc) - 0.05
    pts = []
    for k in range(25):
        a = math.pi * (0.5 - k / 24)     # top to bottom round the outside
        pts.append((xb + rx * math.cos(a), 0.0, zc + rz * math.sin(a)))
    C.tube('handle', pts, 0.24, mat)


def liquid(level):
    z1 = surface(level)
    prof = [(0.0, BASE), (radius(BASE) - WALL - 0.01, BASE), (radius(z1) - WALL - 0.01, z1), (0.0, z1)]
    return C.lathe('liquid', prof, C.flat('liquid', WHITE), smooth=False)


def straw():
    tip = C.flat('strawTip', COL['strawTip'])
    body = C.flat('straw', COL['straw'])
    x0, y0 = 1.0, 1.3
    C.tube('straw', [(x0 - 0.35, y0 - 0.25, BASE + 0.2), (x0 + 0.55, y0 + 0.35, H + 2.0)], 0.3, body)
    C.tube('straw_tip', [(x0 + 0.55, y0 + 0.35, H + 2.0), (x0 + 0.63, y0 + 0.40, H + 2.45)], 0.3, tip)


def ice(r):
    mat = C.flat('ice', COL['ice'], alpha=0.85)
    z = surface('full')
    spots = [(-1.1, -0.6), (0.5, -1.0), (-0.2, 0.7), (1.2, 0.3)]
    for i, (x, y) in enumerate(spots):
        C.rounded_cube(f'ice{i}', (x, y, z + 0.05), 0.95 + 0.1 * r.random(), mat,
                       rot=(r.random() * 0.5, r.random() * 0.5, r.random() * math.pi))
    C.holdout(liquid('full'))


def foam():
    z = surface('full')
    rr = radius(z) - WALL - 0.02
    prof = [(rr, z - 0.01), (rr - 0.12, z + 0.1), (rr * 0.6, z + 0.15), (0.0, z + 0.16)]
    C.lathe('foam', prof, C.flat('foam', COL['foam']), smooth=True)


def cinnamon(r):
    mat = C.flat('cinnamon', COL['cinnamon'])
    z = surface('full') + 0.2
    rr = radius(z) - WALL - 0.35
    for i in range(46):
        a, d = r.random() * 2 * math.pi, rr * math.sqrt(r.random())
        C.bare(C.blob(f'speck{i}', (d * math.cos(a), d * math.sin(a), z), (0.09, 0.09, 0.03), mat, subdiv=1))


def drizzle():
    z = surface('full') + 0.22
    rr = radius(z) - WALL - 0.3
    pts = []
    for k in range(57):
        t = k / 56
        x = -rr + 2 * rr * t
        span = math.sqrt(max(rr * rr - x * x, 0.0))
        y = span * math.sin(t * 7 * math.pi) * 0.92
        pts.append((x, y, z + 0.03 * math.cos(t * 7 * math.pi)))
    C.bare(C.tube('drizzle', pts, 0.14, C.flat('drizzle', WHITE)))   # sauce has no outline


def sprinkles(r):
    mats = [C.flat(f'sprinkle{i}', c) for i, c in enumerate(COL['sprinkles'])]
    z = surface('full') + 0.22
    rr = radius(z) - WALL - 0.45
    for i in range(34):
        a, d = r.random() * 2 * math.pi, rr * math.sqrt(r.random())
        C.bare(C.blob(f'sprinkle{i}', (d * math.cos(a), d * math.sin(a), z), (0.24, 0.075, 0.075),
                      mats[i % len(mats)], rot=(0.0, 0.0, r.random() * math.pi), subdiv=2))


def whip():
    """A piped swirl: tiers that step in, each lip a crease the ink draws."""
    z = surface('full')
    prof = [(radius(z) - WALL - 0.02, z), (2.45, z + 0.45), (2.0, z + 0.85), (2.05, z + 1.15),
            (1.45, z + 1.55), (1.5, z + 1.8), (0.8, z + 2.2), (0.85, z + 2.4), (0.15, z + 2.85), (0.0, z + 2.9)]
    C.lathe('whip', prof, C.flat('whip', COL['whip']), seg=40, smooth=False)


# ---------------------------------------------------------------- the foods

def croissant():
    mats = [C.flat('croissantA', COL['croissant'][0]), C.flat('croissantB', COL['croissant'][1])]
    n = 7
    for i in range(n):
        t = (i + 0.5) / n
        a = math.pi * (0.12 + 0.76 * t)
        fat = math.sin(math.pi * t) ** 0.7
        x, y = 1.6 * math.cos(a), 1.2 * math.sin(a) - 0.6
        C.blob(f'seg{i}', (x, y, 0.45 * fat + 0.12), (0.42 * fat + 0.18, 0.55 * fat + 0.2, 0.42 * fat + 0.14),
               mats[i % 2], rot=(0.0, 0.0, a - math.pi / 2), subdiv=3)


def bagel(r):
    seg = 18
    ring = []
    for k in range(seg):
        a = -math.pi / 2 + 2 * math.pi * k / seg
        ring.append((1.0 + 0.55 * math.cos(a), 0.42 + 0.42 * math.sin(a)))
    ring.append(ring[0])
    C.lathe('bagel', ring, C.flat('bagel', COL['bagel']), seg=40)
    seed = C.flat('seed', COL['seed'])
    for i in range(22):
        a = r.random() * 2 * math.pi
        d = 1.0 + (r.random() - 0.5) * 0.6
        C.bare(C.blob(f'seed{i}', (d * math.cos(a), d * math.sin(a), 0.84), (0.1, 0.055, 0.03), seed,
                      rot=(0.0, 0.0, r.random() * math.pi), subdiv=1))


def muffin():
    wrap = [C.flat('wrapA', COL['wrapper'][0]), C.flat('wrapB', COL['wrapper'][1])]
    C.lathe('wrapper', [(0.85, 0.0), (1.12, 1.05)], wrap, seg=24, mat_of=lambda k: k % 2, smooth=False,
            cap_bottom=True)
    top = C.flat('muffinTop', COL['muffinTop'])
    prof = [(1.08, 1.0), (1.42, 1.25), (1.38, 1.55), (1.05, 1.9), (0.55, 2.12), (0.0, 2.18)]
    C.lathe('top', prof, top, seg=40)


def cookie(r):
    C.lathe('cookie', [(0.0, 0.0), (1.35, 0.0), (1.42, 0.12), (1.36, 0.26), (0.0, 0.3)],
            C.flat('cookie', COL['cookie']), seg=40, smooth=False)
    chip = C.flat('chip', COL['chip'])
    for i in range(9):
        a = r.random() * 2 * math.pi
        d = 1.05 * math.sqrt(r.random())
        C.blob(f'chip{i}', (d * math.cos(a), d * math.sin(a), 0.3), (0.13, 0.13, 0.08), chip, subdiv=1)


FOODS = {'croissant': lambda r: croissant(), 'bagel': bagel, 'muffin': lambda r: muffin(), 'cookie': cookie}


# ---------------------------------------------------------------- render

def fit(objs):
    """The image-plane box of everything built, for centring a food."""
    xs, ys = [], []
    for ob in objs:
        for v in ob.data.vertices:
            sx, sy = C.screen(ob.matrix_world @ v.co)
            xs.append(sx)
            ys.append(sy)
    return min(xs), min(ys), max(xs), max(ys)


def main():
    scene = C.reset(INK)
    tmp = os.path.join(C.OUT, 'frame.png')
    os.makedirs(C.OUT, exist_ok=True)
    W, Hpx = VIEW['w'] * SCALE, VIEW['h'] * SCALE
    frames = {}

    layer_builders = {
        'cup_back': lambda r: (glass('back', COL['glassBack'])),
        'straw': lambda r: straw(),
        'liquid_low': lambda r: liquid('low'),
        'liquid_full': lambda r: liquid('full'),
        'ice': ice,
        'foam': lambda r: foam(),
        'cinnamon': cinnamon,
        'drizzle': lambda r: drizzle(),
        'sprinkles': sprinkles,
        'whip': lambda r: whip(),
        'cup_front': lambda r: (glass('front', COL['glassFront']), handle()),
    }
    names = [l['name'] for l in SPEC['LAYERS']]
    if sorted(names) != sorted(layer_builders):
        print(f'cups.py: spec.mjs LAYERS {names} is not what cups.py builds {sorted(layer_builders)}')
        sys.exit(1)
    for i, layer in enumerate(SPEC['LAYERS']):
        C.clear()
        C.set_ink(GREY_INK if layer.get('tint') else INK)
        layer_builders[layer['name']](C.rng(100 + i))
        C.aim(scene, CX, CY, VIEW['w'] / 10.0)
        frames[layer['name']] = C.render_frame(scene, W, Hpx, tmp)
        print(f'cups.py: {layer["name"]}')

    side = B['food'] * SCALE
    for i, f in enumerate(SPEC['FOODS']):
        if f['id'] not in FOODS:
            print(f'cups.py: FOODS has {f["id"]}, which cups.py does not draw')
            sys.exit(1)
        C.clear()
        C.set_ink(INK)
        FOODS[f['id']](C.rng(200 + i))
        x0, y0, x1, y1 = fit([o for o in scene.objects if o.type == 'MESH'])
        C.aim(scene, (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.18)
        frames['food_' + f['id']] = C.render_frame(scene, side, side, tmp)
        print(f'cups.py: food_{f["id"]}')
    os.remove(tmp)

    # How far a thing on the surface moves when the cup is at the low level,
    # in viewBox units, down the image.
    low = (surface('full') - surface('low')) * math.cos(math.radians(C.ELEVATION)) * 10.0
    meta = {'scale': SCALE, 'view': VIEW, 'food': B['food'], 'levels': {'full': 0, 'low': round(low, 2)}}
    width, height, sheet = C.write_sheet(frames, B['sheet']['width'], B['sheet']['png'],
                                         B['sheet']['atlas'], meta)
    print('cups.py: contact sheet', C.contact_sheet('cups', width, height, sheet, '#e6d3b3'))


main()
