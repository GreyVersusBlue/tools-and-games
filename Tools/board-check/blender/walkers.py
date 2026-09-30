# The tavern's walkers: eight silhouette figures on a hand-built armature,
# keyed from drawPerson()'s own formulas (index.html, <tavern-scene>) and
# rendered to one sheet, assets/tavern/walkers.webp: a row a type, twelve
# frames of the walk cycle and then a standing frame, Workbench flat
# #0c0803 on alpha at a slight three-quarter turn.
#
#   blender -b --factory-startup -t 4 -P blender/walkers.py -- [--only traveler,dwarf] [--png]
#
# A row of budget.json's `walkers` plate says where everything is: `sheet`
# has the types in row order, the frame count, the cell size in pixels, the
# pixels a room unit gets (`ppu`), and `anchor`, the pixel in a cell where
# the figure's feet stand. drawPerson() in the page turns the same numbers
# back into a source rectangle. --only renders just those rows to
# out/walkers-preview.webp and writes no sheet; --png also writes the full
# sheet's master as out/walkers.png for looking at.
#
# How the rig follows the canvas. drawPerson() draws in a local frame with
# the feet at the origin, y down, facing +x, and poses every limb with
# bone(x, y, a1, l1, a2, l2): an angle a measured from straight down,
# positive toward +x, and angles add down a chain. A bone here is exactly
# one of those frames: its pivot, and the angle its geometry is turned by.
# Geometry is authored at rest (every angle 0, every limb hanging) and each
# frame sets `pose_bone.matrix` from the canvas's own numbers, so a number
# changed in drawPerson() is the same number changed here. The canvas's
# 2D paths become extrusions of the same outlines, with a depth so that the
# turn shows a thickness; a limb is a tapered rod of the canvas's half-width
# for a radius. The body's bob and lean are keyed on the root. What the
# canvas moves with the clock (a cloak's wobble, the ranger's tail, the
# skirt's sway) moves with the phase here, as a swing of its own bone.
#
# The standing frame is its own rig, built with sw 0.06, aSw 0.12, the
# cloak's smaller flare and no bob: the page adds the idle bob and lean on
# top, from the clock, exactly as drawPerson() does.

import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import common as C  # noqa: E402

C.check_version()
scene = C.reset()
ARGS = C.args()
ONLY = ARGS[ARGS.index('--only') + 1].split(',') if '--only' in ARGS else None
PNG = '--png' in ARGS

PLATE = C.BUDGET['plates']['walkers']
SHEET = PLATE['sheet']
TYPES = SHEET['types']
FRAMES = SHEET['frames']                  # walk frames; one more column is the standing frame
CELL_W, CELL_H = SHEET['cell']            # pixels (scaled with --ppu)
PPU = float(ARGS[ARGS.index('--ppu') + 1]) if '--ppu' in ARGS else SHEET['ppu']   # pixels per room unit
AA = ARGS[ARGS.index('--aa') + 1] if '--aa' in ARGS else SHEET.get('aa', '8')
ANCHOR = SHEET['anchor']                  # pixels from the cell's top left to the feet
YAW = math.radians(SHEET['yaw'])
U = C.UNIT
PI = math.pi
DARK = 0x0c0803

# drawPerson()'s TYPE table, verbatim. validate.mjs holds the keys to the page's.
TYPE = {
    'traveler': dict(h=1.00, cloak=1, hood=1, staff=1, pack=1),
    'dwarf': dict(h=0.76, wide=1.5, beard=1, axe=1, stout=1),
    'ranger': dict(h=0.98, quiver=1, bow=1, tail=1, cloakS=1),
    'rogue': dict(h=0.97, cape=1, hood=1, sword=1),
    'server': dict(h=0.95, skirt=1, tray=1, bun=1),
    'patron': dict(h=0.99, mug=1, cap=1),
    'child': dict(h=0.62, run=1),
    'knight': dict(h=1.04, wide=1.18, sword=1, pauldron=1, helm=1),
}

sin, cos = math.sin, math.cos


# ---------------------------------------------------------------- outlines

def path(start, segs, n=7):
    """A canvas path as points: start (x, y), then ('L', x, y) and
    ('Q', cx, cy, x, y) in order, each quadratic sampled at n steps."""
    pts = [start]
    for s in segs:
        x0, y0 = pts[-1]
        if s[0] == 'L':
            pts.append((s[1], s[2]))
        else:
            _, cx, cy, x, y = s
            for i in range(1, n + 1):
                t = i / n
                pts.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x,
                            (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y))
    return pts


def arc_pts(cx, cy, r, a0, a1, n=16):
    return [(cx + r * cos(a0 + (a1 - a0) * i / n), cy + r * sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def turned(pts, rot, tx, ty):
    """ctx.translate(tx, ty); ctx.rotate(rot), applied to pts."""
    c, s = cos(rot), sin(rot)
    return [(tx + x * c - y * s, ty + x * s + y * c) for x, y in pts]


def rect(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


# ---------------------------------------------------------------- the rig

class Rig:
    """One figure: a bmesh of rigid parts, each weighted to one bone, and the
    bones' rest pivots in canvas units (figure frame, y down). Parts are given
    in canvas units, local to a bone's pivot, at rest."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.bones = {}                   # name -> dict(parent, pivot, d)
        self.order = []
        self.groups = {}                  # name -> verts

    def bone(self, name, parent, pivot, d=0.0):
        self.bones[name] = dict(parent=parent, pivot=pivot, d=d)
        self.order.append(name)
        self.groups[name] = []

    def P(self, bone, x, y, d=0.0):
        px, py = self.bones[bone]['pivot']
        return Vector(((px + x) * U, (self.bones[bone]['d'] + d) * U, -(py + y) * U))

    def keep(self, bone, verts):
        self.groups[bone] += list(verts)

    def rod(self, bone, a, b, r1, r2, seg=6, d=0.0):
        self.keep(bone, C.limb(self.bm, self.P(bone, *a, d), self.P(bone, *b, d), r1 * U, r2 * U, seg))

    def blob(self, bone, cx, cy, rx, ry, rd, rot=0.0, d=0.0, seg=10, rings=6):
        m = Matrix.Translation(self.P(bone, cx, cy, d)) @ Matrix.Rotation(rot, 4, 'Y') \
            @ Matrix.Diagonal((rx * U, rd * U, ry * U, 1.0))
        self.keep(bone, bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0,
                                                  matrix=m, calc_uvs=False)['verts'])

    def box(self, bone, x0, y0, x1, y1, dz, d=0.0):
        self.keep(bone, C.box(self.bm, self.P(bone, x0, y1, d - dz), self.P(bone, x1, y0, d + dz)))

    def slab(self, bone, pts, dz, d=0.0):
        """The outline pts (canvas units, local) extruded dz either side of depth d."""
        clean = [pts[0]]
        for p in pts[1:]:
            if abs(p[0] - clean[-1][0]) + abs(p[1] - clean[-1][1]) > 1e-4:
                clean.append(p)
        if abs(clean[0][0] - clean[-1][0]) + abs(clean[0][1] - clean[-1][1]) < 1e-4:
            clean.pop()
        bm = self.bm
        near = [bm.verts.new(self.P(bone, x, y, d - dz)) for x, y in clean]
        far = [bm.verts.new(self.P(bone, x, y, d + dz)) for x, y in clean]
        faces = [bm.faces.new(near), bm.faces.new(list(reversed(far)))]
        n = len(clean)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new([near[i], near[j], far[j], far[i]]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self.keep(bone, near + far)


def build(tname, moving):
    """The rig for one type, the walking one or the standing one, and the
    pose function that gives each of its bones a frame at phase ph."""
    k = TYPE[tname]
    u = k['h']
    wide = k.get('wide', 1)
    stout, run = k.get('stout', 0), k.get('run', 0)
    hipY = (-60 if stout else -74) * u
    shY, headY = -124 * u, -140 * u
    headR = (12.6 if stout else 11.6) * u
    lf = 0.78 if stout else 1
    thigh, shin = 39 * u * lf, 36 * u * lf
    uArm, fArm = 30 * u * (0.86 if stout else 1), 27 * u * (0.86 if stout else 1)
    sw = 1 if moving else 0.06
    aSw = 1 if moving else 0.12
    hand = k.get('tray') or k.get('mug') or k.get('staff') or k.get('axe') or k.get('bow')
    holdA = (-1.05 if k.get('tray') else -0.42 if k.get('staff') else -0.72 if k.get('mug')
             else -1.5 if k.get('axe') else -0.9,
             -0.95 if k.get('tray') else -0.5 if k.get('staff') else -1.35 if k.get('mug')
             else 0.5 if k.get('axe') else -1.1)
    dleg, darm = 5 * u, 8 * u

    g = Rig(f'{tname}-{"walk" if moving else "stand"}')
    g.bone('body', None, (0, 0))

    # ---- legs: far then near, each thigh, shin and boot
    for side, dd in (('f', dleg), ('n', -dleg)):
        g.bone(f'thigh_{side}', 'body', (0, hipY), dd)
        g.bone(f'shin_{side}', f'thigh_{side}', (0, hipY + thigh), dd)
        g.bone(f'boot_{side}', f'shin_{side}', (0, hipY + thigh + shin), dd)
        g.rod(f'thigh_{side}', (0, 0), (0, thigh), 7.6 * u * wide, 5.8 * u, 7)
        g.blob(f'thigh_{side}', 0, 0, 7.6 * u * wide, 7.6 * u * wide, 7.6 * u * wide, seg=8, rings=5)
        g.rod(f'shin_{side}', (0, 0), (0, shin), 5.8 * u, 4.4 * u, 7)
        g.blob(f'shin_{side}', 0, 0, 5.8 * u, 5.8 * u, 5.8 * u, seg=8, rings=5)
        s = 5.6 * u * wide
        boot = path((-s * 0.55, -s * 0.9), [('L', s * 0.5, -s * 0.95), ('Q', s * 1.5, -s * 0.2, s * 1.35, s * 0.25),
                                            ('L', -s * 0.7, s * 0.25), ('Q', -s * 1.0, -s * 0.3, -s * 0.55, -s * 0.9)])
        g.slab(f'boot_{side}', boot, 4.2 * u * wide)

    # ---- arms: far, and near, with what the near one carries
    g.bone('arm_f', 'body', (-13 * u * wide, shY + 5 * u), darm)
    g.bone('fore_f', 'arm_f', (-13 * u * wide, shY + 5 * u + uArm), darm)
    g.bone('arm_n', 'body', (13 * u * wide, shY + 5 * u), -darm)
    g.bone('fore_n', 'arm_n', (13 * u * wide, shY + 5 * u + uArm), -darm)
    for side, w1, w2, w3 in (('f', 5.6 * u, 4.4 * u, 3.4 * u), ('n', 5.8 * u, 4.5 * u, 3.4 * u)):
        g.rod(f'arm_{side}', (0, 0), (0, uArm), w1, w2, 6)
        g.blob(f'arm_{side}', 0, 0, w1, w1, w1, seg=8, rings=5)
        g.rod(f'fore_{side}', (0, 0), (0, fArm), w2, w3, 6)
        g.blob(f'fore_{side}', 0, 0, w2, w2, w2, seg=8, rings=5)
        g.blob(f'fore_{side}', 0, fArm, w3 * 1.25, w3 * 1.25, w3 * 1.25, seg=8, rings=5)
    hold_rest = (13 * u * wide, shY + 5 * u + uArm + fArm)

    # ---- the torso, hem and everything else that hangs off the body
    if k.get('cloak') or k.get('cape'):
        g.bone('cloak', 'body', (-3 * u, shY - 6 * u), 0)
    if k.get('skirt'):
        g.bone('skirt', 'body', (0, hipY - 2 * u), 0)
    if k.get('tail'):
        g.bone('tail', 'body', (-8 * u, headY - 8 * u), 0)
    if hand:
        ox, oy = (6 * u, -2 * u) if k.get('tray') else (2 * u, 0) if k.get('mug') else \
                 (0, 12 * u) if k.get('bow') else (0, 0)
        g.bone('gear', 'fore_n', (hold_rest[0] + ox, hold_rest[1] + oy), -darm)

    B = 'body'
    torso = path((-17 * u * wide, shY + 2 * u), [
        ('Q', -12 * u * wide, shY + 30 * u, -10.5 * u * wide, hipY + 4 * u),
        ('L', 11 * u * wide, hipY + 4 * u),
        ('Q', 13 * u * wide, shY + 26 * u, 17 * u * wide, shY + 2 * u),
        ('Q', 6 * u, shY - 8 * u, 0, shY - 8 * u),
        ('Q', -6 * u, shY - 8 * u, -17 * u * wide, shY + 2 * u)])
    g.slab(B, torso, 8.5 * u * wide)
    if k.get('skirt'):
        sk = path((-13 * u, hipY - 2 * u), [
            ('Q', -22 * u, hipY + 22 * u, -20 * u, hipY + 44 * u),
            ('Q', 0, hipY + 52 * u, 20 * u, hipY + 42 * u),
            ('Q', 21 * u, hipY + 20 * u, 13 * u, hipY - 2 * u)])
        px, py = g.bones['skirt']['pivot']
        g.slab('skirt', [(x - px, y - py) for x, y in sk], 9 * u)
    elif not run:
        hem = path((-13 * u * wide, hipY - 4 * u), [
            ('Q', -15 * u * wide, hipY + 14 * u, -11 * u * wide, hipY + 20 * u),
            ('L', 11 * u * wide, hipY + 20 * u),
            ('Q', 15 * u * wide, hipY + 12 * u, 13 * u * wide, hipY - 4 * u)])
        g.slab(B, hem, 8 * u * wide)
    if k.get('pauldron'):
        g.blob(B, -15 * u, shY + 3 * u, 9 * u, 6.5 * u, 7 * u, rot=-0.3)
        g.blob(B, 15 * u, shY + 3 * u, 9 * u, 6.5 * u, 7 * u, rot=0.3)
    if k.get('beard'):
        bd = path((-11 * u, headY + 2 * u), [
            ('Q', -19 * u, headY + 30 * u, -6 * u, headY + 52 * u),
            ('Q', 0, headY + 58 * u, 5 * u, headY + 50 * u),
            ('Q', 17 * u, headY + 26 * u, 12 * u, headY + 1 * u),
            ('Q', 0, headY + 12 * u, -11 * u, headY + 2 * u)])
        g.slab(B, bd, 6 * u, -2 * u)
        g.slab(B, [(-7 * u, headY + 48 * u), (-4 * u, headY + 62 * u), (0, headY + 50 * u)], 3 * u, -2 * u)

    # cloak / cape, short cape, pack, quiver
    if k.get('cloak') or k.get('cape'):
        flare = (1.5 if k.get('cape') else 1) * (1 if moving else 0.45)
        cape = k.get('cape')
        cl = path((-3 * u, shY - 6 * u), [
            ('Q', -26 * u * wide, shY + 30 * u, (-30 - 10 * flare) * u, hipY + (62 if cape else 42) * u),
            ('Q', -8 * u, hipY + (72 if cape else 52) * u, 6 * u, hipY + (46 if cape else 30) * u),
            ('Q', 12 * u, shY + 20 * u, 8 * u, shY - 6 * u)])
        px, py = g.bones['cloak']['pivot']
        g.slab('cloak', [(x - px, y - py) for x, y in cl], 6 * u, 3 * u)
    if k.get('cloakS'):
        cs = path((-15 * u, shY - 2 * u), [
            ('Q', -22 * u, shY + 22 * u, -10 * u, shY + 30 * u),
            ('L', 14 * u, shY + 26 * u),
            ('Q', 19 * u, shY + 6 * u, 14 * u, shY - 4 * u)])
        g.slab(B, cs, 9 * u)
    if k.get('pack'):
        pk = path((-9 * u, -13 * u), [('L', 9 * u, -15 * u), ('Q', 13 * u, 0, 8 * u, 14 * u),
                                      ('L', -8 * u, 12 * u), ('Q', -12 * u, 0, -9 * u, -13 * u)])
        g.slab(B, turned(pk, -0.12, -16 * u, shY + 26 * u), 9 * u, 4 * u)
    if k.get('quiver'):
        g.slab(B, turned(rect(-6 * u, -18 * u, 12 * u, 34 * u), 0.34, -12 * u, shY + 16 * u), 4 * u, 4 * u)
        for q in range(4):
            x = (-5 + q * 3.2) * u
            g.slab(B, turned(rect(x, -40 * u, 1.6 * u, 24 * u), 0.34, -12 * u, shY + 16 * u), 0.8 * u, 4 * u)
            fl = [(x - 0.5 * u, -40 * u), (x + 2.8 * u, -36 * u), (x - 0.5 * u, -32 * u)]
            g.slab(B, turned(fl, 0.34, -12 * u, shY + 16 * u), 0.8 * u, 4 * u)

    # ---- head, neck, headgear
    g.blob(B, 1 * u, headY, headR * 0.92, headR, headR * 0.95, rot=0.1, seg=12, rings=8)
    g.rod(B, (0.5 * u, headY + 8 * u), (0, shY - 2 * u), 4 * u, 4.5 * u, 6)
    if k.get('hood'):
        hd = path((-13 * u, headY + 12 * u), [
            ('Q', -17 * u, headY - 16 * u, 2 * u, headY - 15 * u),
            ('Q', 15 * u, headY - 13 * u, 15 * u, headY + 2 * u),
            ('Q', 9 * u, headY + 4 * u, 6 * u, headY + 14 * u)])
        g.slab(B, hd, headR * 0.95)
        pe = path((-11 * u, headY - 6 * u), [
            ('Q', -24 * u, headY + 2 * u, -22 * u, headY + 20 * u),
            ('Q', -14 * u, headY + 10 * u, -8 * u, headY + 8 * u)])
        g.slab(B, pe, 6 * u)
    elif k.get('helm'):
        hm = arc_pts(1 * u, headY - 1 * u, headR * 1.16, PI * 1.02, PI * 2.02) + [
            (headR * 1.2, headY + 5 * u), (-headR * 1.1, headY + 5 * u)]
        g.slab(B, hm, headR * 1.08)
        g.box(B, -2 * u, headY - 16 * u, 2 * u, headY - 8 * u, 1.5 * u)
    elif k.get('cap'):
        g.blob(B, 0, headY - 8 * u, headR * 1.5, headR * 0.5, headR * 1.15, rot=-0.12)
        g.blob(B, -1 * u, headY - 13 * u, headR * 0.85, headR * 0.6, headR * 0.85)
    elif k.get('tail'):
        px, py = g.bones['tail']['pivot']
        tl = path((-8 * u, headY - 8 * u), [
            ('Q', -22 * u, headY - 2 * u, -20 * u, headY + 22 * u),
            ('Q', -10 * u, headY + 8 * u, -4 * u, headY - 2 * u)])
        g.slab('tail', [(x - px, y - py) for x, y in tl], 4 * u)
    elif k.get('bun'):
        g.blob(B, -11 * u, headY - 7 * u, 6.2 * u, 6.2 * u, 6.2 * u, seg=10, rings=6)
        fr = path((-11 * u, headY - 10 * u), [('Q', -2 * u, headY - 16 * u, 9 * u, headY - 6 * u),
                                              ('Q', 0, headY - 9 * u, -11 * u, headY - 10 * u)])
        g.slab(B, fr, headR * 0.9)
    else:
        hr = path((-11 * u, headY + 4 * u), [
            ('Q', -13 * u, headY - 14 * u, 3 * u, headY - 12 * u),
            ('Q', 12 * u, headY - 10 * u, 12 * u, headY - 2 * u),
            ('Q', 2 * u, headY - 8 * u, -11 * u, headY + 4 * u)])
        g.slab(B, hr, headR * 0.95)

    # ---- what the near hand carries, at the hand, at rest
    G = 'gear'
    if k.get('staff'):
        g.rod(G, (0, -96 * u), (0, 72 * u), 1.7 * u, 1.7 * u, 6)
        g.blob(G, 0, -96 * u, 4.2 * u, 4.2 * u, 4.2 * u, seg=8, rings=5)
    if k.get('axe'):
        g.rod(G, (0, -34 * u), (0, 62 * u), 2.6 * u, 2.6 * u, 6)
        ax = path((0, -28 * u), [('Q', 30 * u, -34 * u, 40 * u, -4 * u), ('Q', 28 * u, 22 * u, 1 * u, 12 * u)])
        g.slab(G, ax, 3 * u)
    if k.get('bow'):
        bw = path((0, -52 * u), [('Q', 26 * u, 0, 0, 52 * u)], 12)
        for a, b in zip(bw, bw[1:]):
            g.rod(G, a, b, 1.3 * u, 1.3 * u, 4)
        g.rod(G, (0, -52 * u), (0, 52 * u), 0.55 * u, 0.55 * u, 4)
    if k.get('mug'):
        g.box(G, -5 * u, -9 * u, 5 * u, 4 * u, 5 * u)
        g.box(G, 5 * u, -6 * u, 8.4 * u, 0, 1.8 * u)
    if k.get('tray'):
        g.blob(G, 0, 0, 19 * u, 5 * u, 9 * u, seg=14, rings=6)
        g.box(G, -11 * u, -12 * u, -4 * u, 0, 4 * u)
        g.box(G, 0, -14 * u, 7 * u, 0, 4 * u)
        g.box(G, 8 * u, -9 * u, 13 * u, 0, 3.5 * u)
    if k.get('sword'):                     # scabbard at the hip, static in the body
        g.slab(B, turned(rect(-2.4 * u, 0, 4.8 * u, 46 * u), 0.55, -9 * u, hipY + 8 * u), 2.4 * u, 5 * u)
        g.slab(B, turned(rect(-6 * u, -5 * u, 12 * u, 4 * u), 0.55, -9 * u, hipY + 8 * u), 2.4 * u, 5 * u)

    def pose(ph):
        """Every bone's (x, y, angle) in the canvas's own terms, in the body
        frame (before bob and lean), angle as bone() takes it."""
        out = {}
        for side, p0 in (('f', ph + PI), ('n', ph)):
            th = 0.52 * sw * sin(p0) * (0.7 if stout else 1) - (0.1 if run else 0)
            sr = -(0.12 + 0.66 * max(0.0, cos(p0))) * sw - (0.3 if run else 0)
            kx, ky = sin(th) * thigh, hipY + cos(th) * thigh
            ex, ey = kx + sin(th + sr) * shin, ky + cos(th + sr) * shin
            out[f'thigh_{side}'] = (0, hipY, th)
            out[f'shin_{side}'] = (kx, ky, th + sr)
            out[f'boot_{side}'] = (ex, ey, -0.35 * (th + sr))
        far_a = -0.44 * aSw * sin(ph) - (0.5 if run else 0)
        far_b = -0.42 - (0.5 if run else 0)
        sx, sy = -13 * u * wide, shY + 5 * u
        out['arm_f'] = (sx, sy, far_a)
        out['fore_f'] = (sx + sin(far_a) * uArm, sy + cos(far_a) * uArm, far_a + far_b)
        sx = 13 * u * wide
        if hand:
            a1, a2 = holdA
        else:
            a1 = 0.4 * aSw * sin(ph) + (0.55 if run else 0)
            a2 = -0.44 - (0.6 if run else 0)
        ex, ey = sx + sin(a1) * uArm, sy + cos(a1) * uArm
        hx, hy = ex + sin(a1 + a2) * fArm, ey + cos(a1 + a2) * fArm
        out['arm_n'] = (sx, sy, a1)
        out['fore_n'] = (ex, ey, a1 + a2)
        if hand:
            ox, oy = (6 * u, -2 * u) if k.get('tray') else (2 * u, 0) if k.get('mug') else \
                     (0, 12 * u) if k.get('bow') else (0, 0)
            rot = (0.06 + sin(ph) * 0.05) if k.get('staff') else -0.5 if k.get('axe') else \
                  0.32 if k.get('bow') else 0.0
            out['gear'] = (hx + ox, hy + oy, -rot)
        if 'cloak' in g.bones:
            out['cloak'] = (*g.bones['cloak']['pivot'], 0.05 * sin(2 * ph + 1) if moving else 0.0)
        if 'skirt' in g.bones:
            out['skirt'] = (*g.bones['skirt']['pivot'], -sin(ph) * 4 / 46 if moving else 0.0)
        if 'tail' in g.bones:
            out['tail'] = (*g.bones['tail']['pivot'], 0.1 * sin(2 * ph) if moving else 0.0)
        bob = (abs(sin(ph)) * 2.4 + 1) * u if moving else 0.0
        lean = (0.16 if run else 0.04) if moving else 0.0
        return out, bob, lean

    return g, pose


# ---------------------------------------------------------------- the armature

def armature(g):
    """The armature object and the skinned mesh for a rig. Every bone points
    down at rest, 4 cm long: a bone is a frame here, not a shape."""
    arm = bpy.data.armatures.new(g.name)
    ob = bpy.data.objects.new(g.name, arm)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    made = {}
    for name in g.order:
        b = g.bones[name]
        head = Vector((b['pivot'][0] * U, b['d'] * U, -b['pivot'][1] * U))
        eb = arm.edit_bones.new(name)
        eb.head = head
        eb.tail = head + Vector((0.0, 0.0, -0.04))
        if b['parent']:
            eb.parent = made[b['parent']]
        made[name] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    me = bpy.data.meshes.new(g.name)
    g.bm.verts.index_update()
    index = {n: [v.index for v in vs] for n, vs in g.groups.items()}
    g.bm.to_mesh(me)
    g.bm.free()
    skin = bpy.data.objects.new(g.name + '-skin', me)
    scene.collection.objects.link(skin)
    for name in g.order:
        vg = skin.vertex_groups.new(name=name)
        vg.add(index[name], 1.0, 'REPLACE')
    mod = skin.modifiers.new('rig', 'ARMATURE')
    mod.object = ob
    return ob, skin


def key(ob, g, pose, ph, frame):
    """Set every bone to the canvas's pose at phase ph and key it at `frame`."""
    bones, bob, lean = pose(ph)
    c, s = cos(lean), sin(lean)
    for name in g.order:
        pb = ob.pose.bones[name]
        if name == 'body':
            x, y, a = 0.0, -bob, -lean
        else:
            bx, by, ba = bones[name]
            # ctx.translate(0, -bob); ctx.rotate(lean) over the body frame
            x, y, a = bx * c - by * s, bx * s + by * c - bob, ba - lean
        b = g.bones[name]
        rest = Vector((b['pivot'][0] * U, b['d'] * U, -b['pivot'][1] * U))
        if name == 'body':
            pivot = (0.0, 0.0)
        else:
            pivot = (x, y)
        posed = Vector((pivot[0] * U, b['d'] * U, -pivot[1] * U))
        m = Matrix.Translation(posed) @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Translation(-rest) \
            @ pb.bone.matrix_local
        pb.matrix = m
        bpy.context.view_layer.update()
        pb.keyframe_insert('location', frame=frame)
        pb.keyframe_insert('rotation_quaternion', frame=frame)


# ---------------------------------------------------------------- the sheet

def main():

    flat = C.material('silhouette', DARK, unlit=True)
    cols = FRAMES + 1
    types = [t for t in TYPES if ONLY is None or t in ONLY]
    cw, ch = SHEET['cell'][0] / SHEET['ppu'], SHEET['cell'][1] / SHEET['ppu']           # a cell in room units
    ax, ay = ANCHOR[0] / SHEET['ppu'], ANCHOR[1] / SHEET['ppu']


    def bake(ob, skin, row, col):
        """The posed mesh as a plain object in its cell, turned by YAW about the feet."""
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(skin.evaluated_get(dg))
        me.materials.clear()
        me.materials.append(flat)
        baked = bpy.data.objects.new(f'cell-{row}-{col}', me)
        scene.collection.objects.link(baked)
        baked.location = ((col * cw + ax) * U, 0.0, -(row * ch + ay) * U)
        baked.rotation_euler = (0.0, 0.0, -YAW)


    for row, tname in enumerate(types):
        for moving in (True, False):
            g, pose = build(tname, moving)
            ob, skin = armature(g)
            frames = range(FRAMES) if moving else [FRAMES]
            for f in frames:
                key(ob, g, pose, f * 2 * PI / FRAMES if moving else 0.0, 1 + f)
            for f in frames:
                scene.frame_set(1 + f)
                bake(ob, skin, row, f)
            bpy.data.objects.remove(skin)
            bpy.data.objects.remove(ob)
        print(f'walkers: {tname}')

    # the camera: orthographic, level, square on to the sheet, one pixel a 1/PPU room unit
    data = bpy.data.cameras.new('sheet')
    data.type = 'ORTHO'
    data.ortho_scale = cols * cw * U
    data.clip_start, data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new('sheet', data)
    scene.collection.objects.link(cam)
    cam.location = (cols * cw * U / 2, -10.0, -len(types) * ch * U / 2)
    cam.rotation_euler = (PI / 2, 0.0, 0.0)
    scene.camera = cam
    width, height = round(cols * cw * PPU), round(len(types) * ch * PPU)
    cam['frame_aspect'] = width / height          # render() keeps the pixels square at any size

    dest = os.path.join(C.SITE, PLATE['file']) if ONLY is None else os.path.join(C.OUT, 'walkers-preview.webp')
    if PNG:
        C.render(os.path.join(C.OUT, 'walkers.png'), width, height, engine='BLENDER_WORKBENCH', transparent=True, aa=AA)
    C.render(dest, width, height, engine='BLENDER_WORKBENCH', transparent=True, fmt='WEBP', quality=100, aa=AA)
    print(f'walkers: wrote {dest}, {width}x{height}, {os.path.getsize(dest)} bytes')



if __name__ == "__main__":
    main()
