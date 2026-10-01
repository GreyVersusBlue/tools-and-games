# School Generator's built-in model pack: furniture as vertex-coloured .glb.
#
#   blender -b --factory-startup -P tools/blender/models.py -- [item ...] [--no-sheet]
#
# Every item is a port of the builder js/render.js draws the same catalog row
# with, at the row budget.json names, written in the page's own feet and
# coordinates (common.py says how they reach Blender). Colours come from
# budget.json's per-item palette, by role, and nowhere else: the palette is
# the tints render.js gives that row, computed the way render.js computes them
# (three.js's HSL in its linear working space, which is why the darkest tints
# are black: the page draws them black).
#
# One file per silhouette, not per row. Two rows that share a builder share a
# file, and the wiring row fits the file into each row's box (`fitModel`,
# 'stretch' where the row's dimensions are the intent). What a file leaves
# out, against its builder, is named on the item in budget.json under `left`.
#
# Writes assets/models/<item>.glb, then one contact sheet to
# tools/blender/out/contact.png (skip it with --no-sheet). validate.mjs reads
# the files back; it needs no Blender.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from common import Builder


def C(pal, role):
    return pal[role]


# ---------------------------------------------------------------- seating

def chair(b, pal, w, d, h, style):
    seat_h = h * 0.45 if style == 'task' else h * 0.52
    b.box(w, 0.12, d * 0.92, 0, seat_h, 0.02, pal['seat'])
    if style == 'stack':
        b.box(w * 0.94, (h - seat_h) * 0.55, 0.1, 0, h - (h - seat_h) * 0.3, -d / 2 + 0.06, pal['back'])
    else:
        b.box(w * 0.94, h - seat_h - 0.08, 0.1, 0, seat_h + (h - seat_h) / 2 + 0.04, -d / 2 + 0.05, pal['back'])
    leg = pal['leg']
    if style == 'task':
        base = min(w, d) / 2 - 0.08
        b.cyl(0.07, 0.07, seat_h - 0.2, 8, 0, (seat_h - 0.2) / 2 + 0.2, 0, leg)
        for i in range(5):
            a = i / 5 * math.pi * 2
            b.box(0.14, 0.1, base, math.sin(a) * base * 0.45, 0.14, math.cos(a) * base * 0.45, leg, 0, a, 0)
            b.sph(0.09, math.sin(a) * base * 0.92, 0.09, math.cos(a) * base * 0.92, pal['caster'], 6)
        for sx in (-1, 1):
            b.box(0.12, 0.1, d * 0.5, sx * (w / 2 - 0.1), seat_h + 0.55, 0, leg)
            b.box(0.12, 0.55, 0.12, sx * (w / 2 - 0.1), seat_h + 0.27, d * 0.18, leg)
    elif style == 'rocker':
        for sx in (-1, 1):
            b.box(0.12, seat_h - 0.08, 0.12, sx * (w / 2 - 0.12), (seat_h - 0.08) / 2 + 0.14, d / 2 - 0.35, leg)
            b.box(0.12, seat_h - 0.08, 0.12, sx * (w / 2 - 0.12), (seat_h - 0.08) / 2 + 0.14, -d / 2 + 0.4, leg)
            b.box(0.1, 0.14, d * 1.05, sx * (w / 2 - 0.12), 0.07, 0, leg)
            b.box(0.1, 0.1, d * 0.55, sx * (w / 2 - 0.1), seat_h + 0.75, -0.05, leg)
    elif style == 'stack':
        for sx in (-1, 1):
            for sz in (-1, 1):
                b.cyl(0.05, 0.05, seat_h + 0.05, 6, sx * (w / 2 - 0.12), seat_h / 2, sz * (d / 2 - 0.12), leg,
                      rx=sz * -0.07, rz=sx * 0.07)
    else:
        for sx in (-1, 1):
            for sz in (-1, 1):
                b.box(0.12, seat_h, 0.12, sx * (w / 2 - 0.12), seat_h / 2, sz * (d / 2 - 0.12), leg)


def stool(b, pal, w, d, h):
    seat_h = h - 0.1
    b.cyl(w / 2, w / 2 * 0.92, 0.18, 14, 0, seat_h, 0, pal['seat'])
    for i in range(4):
        a = i / 4 * math.pi * 2 + math.pi / 4
        b.cyl(0.05, 0.05, seat_h, 6, math.sin(a) * (w / 2 - 0.14), seat_h / 2, math.cos(a) * (w / 2 - 0.14),
              pal['leg'], rx=math.cos(a) * 0.12, rz=math.sin(a) * -0.12)
    # the page's foot ring is a torus; two crossed rails hold the legs here
    b.box(w - 0.36, 0.06, 0.07, 0, seat_h * 0.4, 0, pal['leg'])
    b.box(0.07, 0.06, w - 0.36, 0, seat_h * 0.4, 0, pal['leg'])


def sofa(b, pal, w, d, h):
    seat_h, arm_w = h * 0.55, 0.45
    b.box(w, seat_h * 0.55, d, 0, seat_h * 0.28, 0, pal['frame'])
    b.box(w, h - seat_h * 0.55, 0.5, 0, (h - seat_h * 0.55) / 2 + seat_h * 0.55, -d / 2 + 0.25, pal['frame'])
    n = max(2, round(w / 2))
    cw = (w - arm_w * 2) / n
    for i in range(n):
        x = -w / 2 + arm_w + cw * (i + 0.5)
        b.box(cw - 0.12, 0.35, d - 0.7, x, seat_h * 0.55 + 0.17, 0.1, pal['cushion'])
        b.box(cw - 0.12, h - seat_h - 0.3, 0.35, x, seat_h + (h - seat_h) / 2 - 0.05, -d / 2 + 0.55, pal['backcushion'])
    for sx in (-1, 1):
        b.box(arm_w, h * 0.75, d, sx * (w / 2 - arm_w / 2), h * 0.375, 0, pal['frame'])


# ---------------------------------------------------------------- tables and desks

def desk(b, pal, w, d, h):
    leg_t, top_t = 0.15, 0.1
    b.box(w, top_t, d, 0, h - top_t / 2, 0, pal['top'])
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.box(leg_t, h - top_t, leg_t, sx * (w / 2 - leg_t), (h - top_t) / 2, sz * (d / 2 - leg_t), pal['leg'])


def table(b, pal, w, d, h):
    top_t = 0.12
    b.box(w, top_t, d, 0, h - top_t / 2, 0, pal['top'])
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.cyl(0.07, 0.09, h - top_t, 6, sx * (w / 2 - 0.35), (h - top_t) / 2, sz * (d / 2 - 0.3), pal['leg'])


def workstation(b, pal, w, d, h):
    desk_h = min(2.5, h)
    desk(b, {'top': pal['top'], 'leg': pal['leg']}, w, d, desk_h)
    b.box(w * 0.45, h * 0.35, 0.08, 0, desk_h + h * 0.28, -d * 0.18, pal['dark'])
    b.box(0.3, 0.28, 0.2, 0, desk_h + 0.14, -d * 0.18, pal['dark'])
    b.box(w * 0.32, 0.05, 0.5, 0, desk_h + 0.03, d * 0.12, pal['keys'])


def counter(b, pal, w, d, h):
    b.box(w, h - 0.15, d - 0.3, 0, (h - 0.15) / 2, 0.1, pal['body'])
    b.box(w + 0.15, 0.15, d, 0, h - 0.07, 0, pal['top'])


def labbench(b, pal, w, d, h):
    b.box(w - 0.2, h - 0.35, d - 0.2, 0, (h - 0.35) / 2, 0, pal['body'])
    b.box(w, 0.2, d, 0, h - 0.1, 0, pal['top'])
    doors = max(2, round(w / 1.6))
    for i in range(doors):
        x = -w / 2 + (w / doors) * (i + 0.5)
        b.box(w / doors - 0.25, h - 0.7, 0.05, x, (h - 0.7) / 2 + 0.15, d / 2 - 0.06, pal['door'])
        b.box(0.3, 0.06, 0.08, x, h - 0.55, d / 2, pal['handle'])
    b.cyl(0.05, 0.05, 0.6, 6, -w * 0.3, h + 0.28, -d * 0.2, pal['tap'])
    b.cyl(0.05, 0.05, 0.35, 6, -w * 0.3 + 0.17, h + 0.55, -d * 0.2, pal['tap'], rz=math.pi / 2)


# ---------------------------------------------------------------- storage and decor

def shelf(b, pal, w, d, h, dividers=False):
    t = 0.08
    b.box(t, h, d, -w / 2 + t / 2, h / 2, 0, pal['side'])
    b.box(t, h, d, w / 2 - t / 2, h / 2, 0, pal['side'])
    b.box(w, t, d, 0, t / 2, 0, pal['side'])
    b.box(w - t * 2, t, d - 0.06, 0, h - t / 2, 0.03, pal['shelf'])
    shelves = max(2, round(h / 1.4))
    for i in range(1, shelves):
        b.box(w - t * 2, t, d - 0.06, 0, h / shelves * i, 0.03, pal['shelf'])
    if dividers:
        cols = max(2, round(w / 1.3))
        for i in range(1, cols):
            b.box(0.06, h, d - 0.06, -w / 2 + w / cols * i, h / 2, 0.03, pal['divider'])


def locker(b, pal, w, d, h, doors=6):
    b.box(w, h, d, 0, h / 2, 0, pal['body'])
    dw, th = w / doors, h - 0.2
    for i in range(doors):
        x = -w / 2 + dw * (i + 0.5)
        b.box(dw - 0.12, th - 0.1, 0.05, x, 0.1 + th / 2, d / 2 + 0.01, pal['door'])
        b.box(dw * 0.5, 0.08, 0.03, x, 0.1 + th * 0.82, d / 2 + 0.05, pal['vent'])
        b.box(dw * 0.5, 0.08, 0.03, x, 0.1 + th * 0.72, d / 2 + 0.05, pal['vent'])
        b.box(0.1, 0.18, 0.06, x + dw * 0.28, 0.1 + th * 0.45, d / 2 + 0.04, pal['vent'])


def plant(b, pal, w, d, h):
    pot_r = w * 0.32
    b.lathe([(pot_r * 0.6, 0), (pot_r, h * 0.28), (pot_r * 0.85, h * 0.3)], 0, 0, 0, pal['pot'], 12)
    b.cyl(0.04, 0.05, h * 0.3, 6, 0, h * 0.4, 0, pal['stem'])
    b.sph(w * 0.42, 0, h * 0.68, 0, pal['leaf'], 10)
    b.sph(w * 0.3, w * 0.2, h * 0.52, w * 0.12, pal['leaf2'], 8)
    b.sph(w * 0.28, -w * 0.22, h * 0.58, -w * 0.1, pal['leaf3'], 8)


# ---------------------------------------------------------------- the pack

BUILDERS = {
    'chair-basic': lambda b, p, w, d, h: chair(b, p, w, d, h, 'basic'),
    'chair-stack': lambda b, p, w, d, h: chair(b, p, w, d, h, 'stack'),
    'chair-task': lambda b, p, w, d, h: chair(b, p, w, d, h, 'task'),
    'chair-rocker': lambda b, p, w, d, h: chair(b, p, w, d, h, 'rocker'),
    'stool': stool,
    'sofa': sofa,
    'desk': desk,
    'table': table,
    'workstation': workstation,
    'counter': counter,
    'labbench': labbench,
    'shelf': shelf,
    'cubby': lambda b, p, w, d, h: shelf(b, p, w, d, h, dividers=True),
    'locker': locker,
    'plant': plant,
}


def build(name):
    item = common.BUDGET['items'][name]
    w, d, h = item['row']['w'], item['row']['d'], item['row']['h']
    b = Builder(name)
    BUILDERS[name](b, item['palette'], w, d, h)
    return b.finish()


def main():
    common.check_version()
    argv = common.args()
    sheet = '--no-sheet' not in argv
    names = [a for a in argv if not a.startswith('--')] or list(common.BUDGET['items'])
    for n in names:
        if n not in BUILDERS or n not in common.BUDGET['items']:
            print(f'models.py: {n} is not in both BUILDERS and budget.json')
            sys.exit(1)
    common.reset()
    made = []
    for n in names:
        obj = build(n)
        path = common.export_glb(obj, common.BUDGET['items'][n]['file'])
        lo, hi = common.dims(obj)
        ft = 1 / common.UNIT
        print(f'{n}: {common.triangles(obj)} triangles, '
              f'{(hi.x - lo.x) * ft:.2f} x {(hi.z - lo.z) * ft:.2f} x {(hi.y - lo.y) * ft:.2f} ft (w d h)')
        made.append(obj)
    if sheet:
        print('contact sheet:', common.contact_sheet(made, os.path.join(common.OUT, 'contact.png')))


if __name__ == '__main__':
    main()
