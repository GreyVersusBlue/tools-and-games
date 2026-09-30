# The tavern's cast: the seated patrons, the dog, the cat and the barkeep as
# silhouette cells on one sheet, assets/tavern/cast.webp, built the way
# walkers.py builds the walkers (its Rig, path() and key(), its flat Workbench
# render with no anti-aliasing, the same ppu and yaw) from drawSeated(),
# drawDog(), drawCat() and the barkeep block of frame() in index.html.
#
#   blender -b --factory-startup -t 4 -P blender/cast.py -- [--only seat-hood-mug,keep] [--png]
#
# budget.json's `cast` plate says where everything is. `sheet.rows` lists the
# rows in order, each with the cells it has (`frames`) and `ax`, the pixel
# column in a cell where the figure's origin stands (its feet, or for the
# barkeep the floor under his bar); `sheet.ay` is the pixel row every figure
# stands on. A row is one value the canvas varies continuously, sampled at its
# `frames` steps: a seated patron's hat and food are the row and the drink
# cycle is the column; the dog's head lift is the row and the wag of its tail
# the column; the cat sitting has its stretch for a row and the curl of its
# tail for a column; walking it is one row of steps; the barkeep is one row of
# his three modes. The page picks the nearest cell and draws it where it drew
# the vector figure. Anything that is not a silhouette (the pour's amber
# stream, the rim pass, the table's shadow) stays canvas.
#
# Coordinates are the canvas's own, in the figure's frame: origin where the
# drawing's origin is, y down, units the page's. Seated patrons and the barkeep
# have their leaning torso on a bone of its own, so the drink cycle tips the
# head about its neck exactly as drawSeated() rotates it.

import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402
import walkers as W  # noqa: E402
from walkers import Rig, path, turned, key, armature  # noqa: E402

PLATE = C.BUDGET['plates']['cast']
SHEET = PLATE['sheet']
ROWS = SHEET['rows']
CELL_W, CELL_H = SHEET['cell']
PPU = float(W.ARGS[W.ARGS.index('--ppu') + 1]) if '--ppu' in W.ARGS else SHEET['ppu']
AA = SHEET.get('aa', 'OFF')
AY = SHEET['ay']
YAW = math.radians(SHEET['yaw'])
U = C.UNIT
PI = math.pi
sin, cos = math.sin, math.cos
HIP = -52                                 # drawSeated()'s hipY
LEAN = -0.15                              # its lean; the page adds the talk on top

ONLY = W.ARGS[W.ARGS.index('--only') + 1].split(',') if '--only' in W.ARGS else None
PNG = '--png' in W.ARGS


def ik(sx, sy, tx, ty, l1, l2, sign):
    """index.html's ik(): the two angles of a two-bone limb reaching (tx, ty)."""
    dx, dy = tx - sx, ty - sy
    d = min(l1 + l2 - 0.001, max(abs(l1 - l2) + 0.001, math.hypot(dx, dy)))
    base = math.atan2(dx, dy)
    alpha = math.acos(max(-1.0, min(1.0, (d * d + l1 * l1 - l2 * l2) / (2 * d * l1))))
    a1 = base + sign * alpha
    kx, ky = sx + sin(a1) * l1, sy + cos(a1) * l1
    return a1, math.atan2(tx - kx, ty - ky) - a1


def tri(*pts):
    return list(pts)


def limb_rods(g, bone, sx, sy, a1, a2, l1, l2, w1, w2, w3, d):
    """bone(): a two-bone limb drawn at rest in `bone`'s own frame, from (sx, sy)."""
    kx, ky = sx + sin(a1) * l1, sy + cos(a1) * l1
    ex, ey = kx + sin(a1 + a2) * l2, ky + cos(a1 + a2) * l2
    g.rod(bone, (sx, sy), (kx, ky), w1, w2, 7, d)
    g.blob(bone, sx, sy, w1, w1, w1, d=d, seg=8, rings=5)
    g.rod(bone, (kx, ky), (ex, ey), w2, w3, 7, d)
    g.blob(bone, kx, ky, w2, w2, w2, d=d, seg=8, rings=5)
    return ex, ey


# ---------------------------------------------------------------- seated

HATS = ['none', 'hood', 'bun', 'beard']
FOODS = ['mug', 'bread']


def seated(hat, food):
    g = Rig(f'seat-{hat}-{food}')
    g.bone('body', None, (0, 0))
    # bench, and the near leg: knee forward under the table, shin to the floor
    g.box('body', -22, HIP + 4, 24, HIP + 12, 5)
    g.box('body', -19, HIP + 12, -13, HIP + 52, 4)
    a1, a2 = ik(4, HIP, 30, -3, 30, 32, -1)
    ex, ey = limb_rods(g, 'body', 4, HIP, a1, a2, 30, 32, 9, 7, 5.4, -5)
    s = 6
    bt = path((-s * 0.55, -s * 0.9), [('L', s * 0.5, -s * 0.95), ('Q', s * 1.5, -s * 0.2, s * 1.35, s * 0.25),
                                      ('L', -s * 0.7, s * 0.25), ('Q', -s * 1.0, -s * 0.3, -s * 0.55, -s * 0.9)])
    g.slab('body', turned(bt, 0.05 * 0.35, ex, ey), 4.2, -5)

    # the torso and the far arm, resting on the tabletop, in the frame the lean turns
    g.bone('torso', 'body', (0, HIP), 0)
    torso = path((-16, -44), [('Q', -13, -22, -12, 2), ('L', 12, 2), ('Q', 15, -24, 16, -44),
                              ('Q', 6, -52, 0, -52), ('Q', -6, -52, -16, -44)])
    g.slab('torso', torso, 8.5)
    fa1, fa2 = ik(-12, -40, 30, -26, 25, 23, -1)
    hx, hy = limb_rods(g, 'torso', -12, -40, fa1, fa2, 25, 23, 5.6, 4.4, 3.4, 8)
    g.blob('torso', hx, hy, 4.2, 4.2, 4.2, d=8, seg=8, rings=5)

    # the near arm and what it holds
    g.bone('arm_n', 'torso', (13, HIP - 40), -8)
    g.bone('fore_n', 'arm_n', (13, HIP - 15), -8)
    g.bone('gear', 'fore_n', (13, HIP + 8), -8)
    g.rod('arm_n', (0, 0), (0, 25), 5.8, 4.6, 7)
    g.blob('arm_n', 0, 0, 5.8, 5.8, 5.8, seg=8, rings=5)
    g.rod('fore_n', (0, 0), (0, 23), 4.6, 3.6, 7)
    g.blob('fore_n', 0, 0, 4.6, 4.6, 4.6, seg=8, rings=5)
    if food == 'mug':
        g.box('gear', -5.5, -11, 5.5, 3, 5)
        g.box('gear', 5.5, -8, 9.1, -1, 1.8)
    else:
        g.blob('gear', 0, -3, 7, 5.2, 5, rot=0.35)

    # the head, tipping back with each pull on the drink, and its hat
    g.bone('head', 'torso', (2, HIP - 56), 0)
    g.blob('head', 0, -10, 10.4, 11.4, 10.4, rot=0.08, seg=12, rings=8)
    g.box('head', -4.5, -3, 4.5, 5, 4)
    if hat == 'hood':
        g.slab('head', path((-12, 2), [('Q', -17, -26, 1, -25), ('Q', 14, -23, 14, -8), ('Q', 8, -6, 6, 3)]), 10.6)
        g.slab('head', path((-10, -16), [('Q', -22, -8, -20, 8), ('Q', -13, -2, -7, -4)]), 6, 3)
    elif hat == 'bun':
        g.blob('head', -10, -16, 6, 6, 6, seg=10, rings=6)
        g.slab('head', path((-10, -19), [('Q', -1, -26, 9, -15), ('Q', 0, -19, -10, -19)]), 10)
    elif hat == 'beard':
        g.slab('head', path((-9, -8), [('Q', -14, 12, -2, 20), ('Q', 11, 12, 10, -9), ('Q', 0, 0, -9, -8)]), 6, -2)
    else:
        g.slab('head', path((-10, -7), [('Q', -12, -23, 3, -21), ('Q', 11, -19, 11, -12), ('Q', 2, -17, -10, -7)]), 10)

    def pose(eat):
        c, s_ = cos(LEAN), sin(LEAN)

        def at(x, y):                     # a point of the torso's frame, in the figure's
            return x * c - y * s_, HIP + x * s_ + y * c
        out = {'torso': (0, HIP, -LEAN)}
        n1, n2 = ik(13, -40, 26 - eat * 12, -26 - eat * 30, 25, 23, 1)
        kx, ky = 13 + sin(n1) * 25, -40 + cos(n1) * 25
        ex_, ey_ = kx + sin(n1 + n2) * 23, ky + cos(n1 + n2) * 23
        out['arm_n'] = (*at(13, -40), n1 - LEAN)
        out['fore_n'] = (*at(kx, ky), n1 + n2 - LEAN)
        out['gear'] = (*at(ex_, ey_), -LEAN)
        out['head'] = (*at(2, -56), eat * 0.22 - LEAN)
        return out, 0.0, 0.0
    return g, pose


# ---------------------------------------------------------------- the dog

def dog(head):
    """head is drawDog()'s own lift in units, 0 to about 15. The canvas faces
    the dog -x; the page does not mirror it."""
    g = Rig(f'dog-{head}')
    g.bone('body', None, (0, 0))
    g.bone('tail', 'body', (31, -16), 0)
    g.blob('body', 0, -12, 34, 13, 12, seg=14, rings=8)
    g.slab('tail', path((0, -2.5), [('Q', 16, -8, 24, -18), ('L', 26, -14), ('Q', 17, -2, 0, 2.5)]), 3)
    ex = head / 15 * 5
    hx, hy = -30, -16 - head * 0.5
    g.blob('body', hx, hy, 13, 10.5, 10, rot=-0.15 - head * 0.02, seg=12, rings=8)
    g.slab('body', [(hx + x, hy + y) for x, y in
                    [(-8, 1), (-20, 4 - head * 0.15), (-19, 8 - head * 0.15), (-6, 7)]], 5)
    g.slab('body', [(hx + x, hy + y) for x, y in [(4, -7), (11, -20 - ex), (13, -5)]], 2.4, 4)
    g.blob('body', -14, 1, 8, 4, 5, d=-6, seg=8, rings=5)
    g.blob('body', 12, 1, 9, 4, 5, d=-6, seg=8, rings=5)
    g.blob('body', -14, 1, 8, 4, 5, d=6, seg=8, rings=5)
    g.blob('body', 12, 1, 9, 4, 5, d=6, seg=8, rings=5)

    def pose(rot):                        # rot: the tail's canvas angle
        return {'tail': (31, -16, -rot)}, 0.0, 0.0
    return g, pose


# ---------------------------------------------------------------- the cat

def cat_sit(stretch):
    g = Rig(f'cat-sit-{stretch}')
    g.bone('body', None, (0, 0))
    g.bone('tail', 'body', (9, -3), 0)
    st = stretch * 4
    g.slab('body', path((-11, 0), [('Q', -14, -18, -6, -22), ('Q', 2, -25, 6, -14), ('Q', 9, -4, 11, 0)]), 7)
    g.blob('body', -2, -28 - st, 7.5, 6.5, 6.5, seg=10, rings=6)
    g.slab('body', tri((-8, -32 - st), (-6, -40 - st), (-2, -33 - st)), 1.6, 3)
    g.slab('body', tri((3, -33 - st), (6, -40 - st), (8, -32 - st)), 1.6, 3)
    g.slab('tail', path((0, -2), [('Q', 16, -4, 18, -20), ('L', 21, -19), ('Q', 21, 2, 0, 2)]), 2, 3)

    def pose(tail):
        return {'tail': (9, -3, -tail * 0.35)}, 0.0, 0.0
    return g, pose


def cat_walk():
    g = Rig('cat-walk')
    g.bone('body', None, (0, 0))
    g.bone('leg_a', 'body', (-11, -8), -4)
    g.bone('leg_b', 'body', (9, -8), 4)
    g.bone('tail', 'body', (15, -14), 0)
    g.blob('body', 0, -12, 17, 6.5, 6, seg=12, rings=6)
    g.blob('body', -17, -16, 7, 6, 6, seg=10, rings=6)
    g.slab('body', tri((-22, -21), (-21, -28), (-16, -21)), 1.6, 3)
    g.slab('body', tri((-14, -21), (-11, -28), (-9, -21)), 1.6, 3)
    g.box('leg_a', 0, 0, 2.6, 8, 1.3)
    g.box('leg_b', 0, 0, 2.6, 8, 1.3)
    g.slab('tail', path((0, -1.6), [('Q', 14, -6, 19, -16), ('L', 21, -13), ('Q', 16, 0, 0, 1.6)]), 2, 2)

    def pose(ph):
        step = sin(ph) * 3
        tail = sin(ph) * 0.5
        return {'leg_a': (-11 + step, -8, 0), 'leg_b': (9 - step, -8, 0),
                'tail': (15, -14, 0.6 - tail * 0.3)}, 0.0, 0.0
    return g, pose


# ---------------------------------------------------------------- the barkeep

KEEP_ARM = {'wipe': -0.9, 'pour': -1.35, 'idle': -0.15}


def keep(mode):
    g = Rig(f'keep-{mode}')
    g.bone('body', None, (0, 0))
    g.bone('arm', 'body', (14, -90), -10)
    g.slab('body', path((-20, 0), [('Q', -24, -60, -15, -96), ('L', 15, -96), ('Q', 24, -60, 20, 0)]), 14)
    g.blob('body', 0, -110, 13, 13, 12, seg=12, rings=8)
    g.slab('arm', [(-4, 0), (4, 0), (3, 40), (-3, 40)], 4)
    if mode == 'pour':
        g.box('arm', -6, 36, 6, 62, 4)

    def pose(_):
        return {'arm': (14, -90, -KEEP_ARM[mode])}, 0.0, 0.0
    return g, pose


# ---------------------------------------------------------------- the rows

def lin(i, n, a, b):
    return a + (b - a) * (i / (n - 1) if n > 1 else 0)


def row_spec(rid, n):
    """(rig builder, the parameter at each of n frames, material hex, yaw sign)."""
    parts = rid.split('-')
    if parts[0] == 'seat':
        return lambda: seated(parts[1], parts[2]), [lin(i, n, 0, 1) for i in range(n)], W.DARK, -1
    if parts[0] == 'dog':
        h = float(parts[1])
        return lambda: dog(h), [lin(i, n, -1.35, 0.35) for i in range(n)], W.DARK, 1
    if parts[0] == 'cat' and parts[1] == 'sit':
        s = float(parts[2])
        return lambda: cat_sit(s), [lin(i, n, -0.5, 1.5) for i in range(n)], 0x070502, 1
    if rid == 'cat-walk':
        return cat_walk, [i * 2 * PI / n for i in range(n)], 0x070502, 1
    if parts[0] == 'keep':
        modes = ['wipe', 'pour', 'idle']
        return None, modes, W.DARK, -1
    raise SystemExit(f'cast.py: no row called {rid}')


mats = {}


def material(hexv):
    if hexv not in mats:
        mats[hexv] = C.material(f'silhouette-{hexv:06x}', hexv, unlit=True)
    return mats[hexv]


cols = max(r['frames'] for r in ROWS)
rows = [r for r in ROWS if ONLY is None or r['id'] in ONLY]
cw, ch = CELL_W / PPU, CELL_H / PPU
extent = {}


def bake(skin, rid, row, col, ax, hexv, sign):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(skin.evaluated_get(dg))
    xs = [v.co.x / U for v in me.vertices]
    zs = [-v.co.z / U for v in me.vertices]
    e = extent.setdefault(rid, [1e9, -1e9, 1e9, -1e9])
    e[0], e[1] = min(e[0], min(xs)), max(e[1], max(xs))
    e[2], e[3] = min(e[2], min(zs)), max(e[3], max(zs))
    me.materials.clear()
    me.materials.append(material(hexv))
    baked = bpy.data.objects.new(f'cell-{row}-{col}', me)
    scene.collection.objects.link(baked)
    baked.location = ((col * cw + ax / PPU) * U, 0.0, -(row * ch + AY / PPU) * U)
    baked.rotation_euler = (0.0, 0.0, sign * YAW)


def main():
    for r, spec in enumerate(rows):
        rid, n, ax = spec['id'], spec['frames'], spec['ax']
        build, params, hexv, sign = row_spec(rid, n)
        for col, p in enumerate(params):
            g, pose = build() if build else keep(p)
            ob, skin = armature(g)
            key(ob, g, pose, p, 1)
            scene.frame_set(1)
            bake(skin, rid, r, col, ax, hexv, sign)
            bpy.data.objects.remove(skin)
            bpy.data.objects.remove(ob)
        print(f'cast: {rid}')
    for rid, (x0, x1, y0, y1) in extent.items():
        print(f'cast: {rid} spans x {x0:.1f}..{x1:.1f}, y {y0:.1f}..{y1:.1f}')

    data = bpy.data.cameras.new('sheet')
    data.type = 'ORTHO'
    data.sensor_fit = 'HORIZONTAL'          # the sheet is taller than wide: AUTO would fit the height
    data.ortho_scale = cols * cw * U
    data.clip_start, data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new('sheet', data)
    scene.collection.objects.link(cam)
    cam.location = (cols * cw * U / 2, -10.0, -len(rows) * ch * U / 2)
    cam.rotation_euler = (PI / 2, 0.0, 0.0)
    scene.camera = cam
    width, height = round(cols * cw * PPU), round(len(rows) * ch * PPU)
    cam['frame_aspect'] = width / height

    dest = os.path.join(C.SITE, PLATE['file']) if ONLY is None else os.path.join(C.OUT, 'cast-preview.webp')
    if PNG:
        C.render(os.path.join(C.OUT, 'cast.png'), width, height, engine='BLENDER_WORKBENCH', transparent=True, aa=AA)
    C.render(dest, width, height, engine='BLENDER_WORKBENCH', transparent=True, fmt='WEBP', quality=100, aa=AA)
    print(f'cast: wrote {dest}, {width}x{height}, {os.path.getsize(dest)} bytes')


scene = W.scene
if __name__ == '__main__':
    main()
