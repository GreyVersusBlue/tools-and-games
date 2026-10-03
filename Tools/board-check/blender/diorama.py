# A board card's diorama (D1 and D2, BACKLOG.md "The site itself: Blender
# dioramas"): the shared plinth, camera, lights and backdrop from common.py,
# with the card's own scene from dioramas.json standing on the plinth top.
#
#   blender -b --factory-startup -P blender/diorama.py -- [card ...] [--samples N] [--preview]
#
# (or `npm run dioramas -- [card ...]`, which runs dioramas.mjs --rendered
# after). With no cards it renders every card dioramas.json lists. Each lands
# at Tools/board-check/candidates/<card>-diorama.png, untracked, at the
# style's 2640 by 1600; candidates/chosen.json then names it and
# `npm run promote <card>` writes the two committed JPEGs. --preview renders
# at a quarter of the size and 32 samples to out/<card>-diorama.png instead,
# for framing a card without touching candidates/.
#
# Every render in the set comes from one machine (dioramas.json `machine`):
# Cycles on that machine's GPU, at a fixed seed.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import bmesh
from mathutils import Matrix, Vector

import common
from common import DIORAMAS, STYLE, OUT, SITE, box, cone, material, mesh_object


def patch(s, name):
    """A flat prism over a polygon on the plinth top, `z` thick."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, 0.0)) for x, y in s['poly']]
    top = [bm.verts.new((x, y, s['z'])) for x, y in s['poly']]
    n = len(bottom)
    bm.faces.new(top)
    bm.faces.new(list(reversed(bottom)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bottom[i], bottom[j], top[j], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=s.get('roughness', 0.85))])


def wall(s, name):
    a, b = Vector((*s['from'], 0.0)), Vector((*s['to'], 0.0))
    d = b - a
    t = s['t'] / 2
    bm = bmesh.new()
    box(bm, (-d.length / 2 - t, -t, 0.0), (d.length / 2 + t, t, s['h']))
    turn = Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z')
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ turn, verts=bm.verts)
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=0.9)])


def pine(s, name):
    """Three stacked cones on a trunk, `h` tall: a tree the game draws in
    code rather than ships as a model."""
    x, y = s['at']
    h = s['h']
    bm = bmesh.new()
    cone(bm, h * 0.035, h * 0.03, h * 0.25, Matrix.Translation((x, y, h * 0.125)), segments=6)
    trunk = list(bm.verts)
    for k, (z0, z1, r) in enumerate(((0.18, 0.62, 0.26), (0.42, 0.84, 0.2), (0.64, 1.0, 0.13))):
        depth = (z1 - z0) * h
        cone(bm, r * h, 0.0, depth, Matrix.Translation((x, y, z0 * h + depth / 2)), segments=9)
    common.paint(bm, trunk, 1)
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=0.9),
                           material(name + '-trunk', 0x3a2a1c, roughness=0.9)])


def post(s, name):
    x, y = s['at']
    bm = bmesh.new()
    cone(bm, s['r'], s['r'], s['h'], Matrix.Translation((x, y, s['h'] / 2)), segments=16)
    cone(bm, s['r'] * 4, s['r'] * 4, 0.02, Matrix.Translation((x, y, 0.01)), segments=24)
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=0.35, metallic=0.85)])


def window(s, name):
    """A port on a wall facing -Y: a dark pane `w` by `h` centred `z` up at
    `at`, a frame round it, and `stars` lit points on the pane from a seeded
    generator, so the same card always gets the same sky."""
    x, y = s['at']
    w, h, z = s['w'], s['h'], s['z']
    bm = bmesh.new()
    box(bm, (x - w / 2, y - 0.01, z - h / 2), (x + w / 2, y, z + h / 2))
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=0.2)])
    bm = bmesh.new()
    f = 0.035
    for lo, hi in (((x - w / 2 - f, y - 0.03, z + h / 2), (x + w / 2 + f, y, z + h / 2 + f)),
                   ((x - w / 2 - f, y - 0.03, z - h / 2 - f), (x + w / 2 + f, y, z - h / 2)),
                   ((x - w / 2 - f, y - 0.03, z - h / 2), (x - w / 2, y, z + h / 2)),
                   ((x + w / 2, y - 0.03, z - h / 2), (x + w / 2 + f, y, z + h / 2))):
        box(bm, lo, hi)
    mesh_object(name + '-frame', bm, [material(name + '-frame', 0x8a93a3, roughness=0.4, metallic=0.7)])
    r = common.rng(len(name))
    bm = bmesh.new()
    for _ in range(s['stars']):
        common.sphere(bm, (0.006,) * 3, (x + (r.random() - 0.5) * w * 0.95, y - 0.012,
                                         z + (r.random() - 0.5) * h * 0.9), segments=4, rings=3)
    mesh_object(name + '-stars', bm, [material(name + '-stars', 0xe8eeff, emit=6.0)])


SHAPES = {'patch': patch, 'wall': wall, 'pine': pine, 'post': post, 'window': window}


def centre(holder):
    """Move a holder's children so their bounds sit centred on it in X and Y
    with their lowest point on it: a model built round some other origin
    (Aphelion's hull) then stands where its card says."""
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    bpy.context.view_layer.update()
    inv = holder.matrix_world.inverted()
    for o in common.tree(holder):
        if o.type == 'MESH':
            for c in o.bound_box:
                w = inv @ (o.matrix_world @ Vector(c))
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in holder.children:
        o.location += shift


def build(card):
    spec = DIORAMAS['cards'][card]
    scene = common.diorama_stage()
    if 'ground' in spec:
        bpy.data.materials['plinth-top'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = \
            common.linear(int(spec['ground'], 16))
    for i, s in enumerate(spec.get('shapes', [])):
        SHAPES[s['kind']](s, f'{card}-{s["kind"]}-{i}')
    for p in spec.get('place', []):
        step = p.get('step', [0, 0])
        for k in range(p.get('count', 1)):
            x, y = p['at'][0] + step[0] * k, p['at'][1] + step[1] * k
            h = common.import_glb(os.path.join(spec['project'], p['glb']),
                                  at=(x, y, p.get('z', 0.0)), rot=p.get('rot', 0.0), scale=p['scale'])
            if p.get('centre'):
                centre(h)
    return scene


def main():
    common.check_version()
    argv = common.args()
    preview = '--preview' in argv
    samples = STYLE['samples']
    if '--samples' in argv:
        samples = int(argv[argv.index('--samples') + 1])
    if preview:
        samples = min(samples, 32)
    cards = [a for a in argv if not a.startswith('--') and not a.isdigit()]
    cards = cards or list(DIORAMAS['cards'])
    unknown = [c for c in cards if c not in DIORAMAS['cards']]
    if unknown:
        print(f'diorama.py: not in dioramas.json: {", ".join(unknown)}')
        sys.exit(1)
    cand = os.path.join(SITE, 'Tools', 'board-check', 'candidates')
    W, H = STYLE['size']
    for card in cards:
        build(card)
        out = os.path.join(OUT if preview else cand, f'{card}-diorama.png')
        common.render(out, W, H, samples=samples, view=STYLE['view'], percent=25 if preview else 100)
        print(f'diorama.py: {card} -> {out} on {common.use_gpu()}')


main()
