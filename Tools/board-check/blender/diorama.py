# A board card's diorama (D1 and D2, BACKLOG.md "The site itself: Blender
# dioramas"): the shared plinth, camera, lights and backdrop from common.py,
# with the card's own scene from dioramas.json standing on the plinth top:
# the game's .glb files (`place`), shapes built here (`shapes`), and, for a
# game that ships no .glb, its own sprite builders (`build`, #848).
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
    """A flat prism over a polygon on the plinth top, `z` thick; `emit` makes
    it glow in its own colour (The Fracture Cycle's seam)."""
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
    mesh_object(name, bm, [material(name, int(s['colour'], 16), roughness=s.get('roughness', 0.85),
                                    emit=s.get('emit', 0.0))])


def wall(s, name):
    a, b = Vector((*s['from'], 0.0)), Vector((*s['to'], 0.0))
    d = b - a
    t = s['t'] / 2
    bm = bmesh.new()
    z = s.get('z', 0.0)                         # a wall may stand on something: a counter's top
    box(bm, (-d.length / 2 - t, -t, z), (d.length / 2 + t, t, z + s['h']))
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


# What a game with no Blender pipeline draws in its DOM or on a canvas,
# built out of five plain solids (#850): Closing Time's street, Integer
# Foundry's board, Daredevil's ramps and buses, Orbital's marker and flight
# plan. Each takes `colour` and, where it says so, `roughness`, `metallic`
# and `emit` (an emission strength in the same colour).

def _mat(s, name):
    return material(name, int(s['colour'], 16), roughness=s.get('roughness', 0.8),
                    metallic=s.get('metallic', 0.0), emit=s.get('emit', 0.0))


def _stand(bm, s):
    """Turn a solid built round its own origin `pitch` degrees about Y, then
    `rot` about Z, and stand it at `at`, `z` above the plinth top."""
    x, y = s['at']
    m = Matrix.Translation((x, y, s.get('z', 0.0))) @ Matrix.Rotation(math.radians(s.get('rot', 0.0)), 4, 'Z') \
        @ Matrix.Rotation(math.radians(s.get('pitch', 0.0)), 4, 'Y')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def block(s, name):
    """A box `size` [w, d, h], its bottom centred on `at`."""
    w, d, h = s['size']
    bm = bmesh.new()
    box(bm, (-w / 2, -d / 2, 0.0), (w / 2, d / 2, h))
    _stand(bm, s)
    mesh_object(name, bm, [_mat(s, name)])


def prism(s, name):
    """A triangular prism `size` [w, d, h] along Y, its ridge `peak` of the
    way across the width: 0.5 is a gable roof, 1 a ramp rising to +X and 0
    one falling to it."""
    w, d, h = s['size']
    ax = -w / 2 + s.get('peak', 0.5) * w
    pts = [(-w / 2, -d / 2, 0.0), (w / 2, -d / 2, 0.0), (ax, -d / 2, h),
           (-w / 2, d / 2, 0.0), (w / 2, d / 2, 0.0), (ax, d / 2, h)]
    bm = bmesh.new()
    common.solid(bm, pts, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (0, 2, 5, 3)])
    _stand(bm, s)
    mesh_object(name, bm, [_mat(s, name)])


def ball(s, name):
    """A smooth ball of radius `r` (or [rx, ry, rz]) centred `z` up at `at`."""
    r = s['r'] if isinstance(s['r'], list) else [s['r']] * 3
    bm = bmesh.new()
    common.sphere(bm, r, (0.0, 0.0, 0.0), segments=32, rings=16)
    _stand(bm, s)
    ob = mesh_object(name, bm, [_mat(s, name)])
    for p in ob.data.polygons:
        p.use_smooth = True


def dots(s, name):
    """Small balls of radius `r`: every `gap` along `path` ([x, y, z] points),
    or `scatter` of them strewn over the plinth top from a seeded generator
    (`seed`), `z` up."""
    bm = bmesh.new()
    r = s['r']
    if 'path' in s:
        pts = [Vector(p) for p in s['path']]
        carry = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = (b - a).length
            t = carry
            while t <= seg + 1e-9:
                common.sphere(bm, (r, r, r), a.lerp(b, t / seg), segments=10, rings=6)
                t += s['gap']
            carry = t - seg
    else:
        tw, td = STYLE['plinth']['top']
        g = common.rng(s['seed'])
        for _ in range(s['scatter']):
            common.sphere(bm, (r, r, r), ((g.random() - 0.5) * (tw - 0.1), (g.random() - 0.5) * (td - 0.1),
                                          s.get('z', 0.0)), segments=6, rings=4)
    ob = mesh_object(name, bm, [_mat(s, name)])
    for p in ob.data.polygons:
        p.use_smooth = True


def ring(s, name):
    """A flat ring at `at`, `z` up: radius `r` to its middle, `w` across, `h`
    thick, with `ticks` bars of length `tick` standing off it at even angles
    (Orbital's marker has four)."""
    r, w, h = s['r'], s['w'], s['h']
    n = 96
    bm = bmesh.new()
    rows = [[bm.verts.new((rad * math.cos(math.tau * i / n), rad * math.sin(math.tau * i / n), zz))
             for i in range(n)] for rad, zz in ((r - w / 2, 0.0), (r + w / 2, 0.0), (r + w / 2, h), (r - w / 2, h))]
    for k in range(4):
        a, b = rows[k], rows[(k + 1) % 4]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for k in range(s.get('ticks', 0)):
        tv = box(bm, (r + w, -w / 2, 0.0), (r + w + s['tick'], w / 2, h))
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.tau * (k + 0.5) / s['ticks'], 4, 'Z'), verts=tv)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    _stand(bm, s)
    mesh_object(name, bm, [_mat(s, name)])


SHAPES = {'patch': patch, 'wall': wall, 'pine': pine, 'post': post, 'window': window,
          'block': block, 'prism': prism, 'ball': ball, 'dots': dots, 'ring': ring}


def repeat(s, k):
    """Copy k of a shape that has `count` and `step`: moved k steps in X and Y."""
    dx, dy = (v * k for v in s.get('step', [0, 0]))
    t = dict(s)
    for key in ('at', 'from', 'to'):
        if key in s:
            t[key] = [s[key][0] + dx, s[key][1] + dy]
    if 'poly' in s:
        t['poly'] = [[x + dx, y + dy] for x, y in s['poly']]
    if 'path' in s:
        t['path'] = [[x + dx, y + dy, *rest] for x, y, *rest in s['path']]
    return t


# ---------------------------------------------------------------- the 2D games' own builders
#
# A game that ships no .glb still builds its sprites in Blender: Faire
# Weekend's markers, Absalom's tiles and figures, Corner & Kettle's cups are
# real geometry, rendered flat. A `build` entry calls those builders (#848)
# rather than modelling the game a second time. The script is loaded with its
# own project's common.py in place of this one and its top-level main() call
# left out; its flat, unlit materials become lit ones of the same colour, so
# the plinth's lights shade them like everything else on it.

_scripts = {}
_colours = {}
_glow = {}


def lit(name, colour, alpha=1.0):
    """A builder's material, lit: `colour` a palette hex ('#rrggbb' or an
    int) or a linear RGB(A) triple, unless the card's `colours` names this
    material; the card's `glow` gives one an emission strength."""
    if name in _colours:
        colour = _colours[name]
    if isinstance(colour, str):
        hexv = int(colour.lstrip('#'), 16)
    elif isinstance(colour, int):
        hexv = colour
    else:
        def ch(c):
            c = max(0.0, min(1.0, c))
            return round(255 * (c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))
        hexv = (ch(colour[0]) << 16) | (ch(colour[1]) << 8) | ch(colour[2])
    return material(name, hexv, roughness=0.15 if alpha < 1.0 else 0.75, alpha=alpha,
                    emit=_glow.get(name, 0.0))


def relight(gc):
    """Swap a project common.py's unlit materials for lit ones, and its
    sprite-only tricks (holdouts, the ink-free collection) for nothing."""
    if hasattr(gc, 'flat'):
        gc.flat = lambda name, hexv, alpha=1.0, *a, **k: lit(name, hexv, alpha)
    if hasattr(gc, 'face_mat'):                 # Absalom: top, left, right; the top is the colour
        gc.face_mat = lambda name, top, left, right: lit(name, top)
    if hasattr(gc, 'holdout_mat'):
        gc.holdout_mat = lambda name: lit(name, '#000000', alpha=0.0)
    if hasattr(gc, 'holdout'):
        gc.holdout = lambda ob: bpy.data.objects.remove(ob)
    if hasattr(gc, 'bare'):
        gc.bare = lambda ob: ob
    if hasattr(gc, 'material'):                 # Orbital: Workbench, its colour in diffuse_color only
        gc.material = lambda name, hexv, alpha=1.0, *a, **k: lit(name, hexv, alpha)


def game_script(project, script):
    """A game's sprite script as a module, loaded once."""
    key = (project, script)
    if key in _scripts:
        return _scripts[key]
    import ast
    import importlib.util
    import types
    path = os.path.join(SITE, project, script)
    folder = os.path.dirname(path)
    tag = os.path.basename(project).replace('-', '_').lower()
    spec = importlib.util.spec_from_file_location(f'{tag}_common', os.path.join(folder, 'common.py'))
    gc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gc)
    relight(gc)
    tree = ast.parse(open(path, encoding='utf8').read(), path)
    tree.body = [n for n in tree.body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                                              and getattr(n.value.func, 'id', None) == 'main')]
    mod = types.ModuleType(f'{tag}_{os.path.splitext(os.path.basename(script))[0]}')
    mod.__file__ = path
    saved_path, saved_common = list(sys.path), sys.modules.get('common')
    sys.modules['common'] = gc
    try:
        exec(compile(tree, path, 'exec'), mod.__dict__)
    finally:
        sys.path[:] = saved_path
        sys.modules['common'] = saved_common
    gc._diorama_spec = None
    _scripts[key] = (mod, gc)
    return mod, gc


def call_builder(mod, gc, call):
    """One call, [function, arg, ...]: a function of the script's, or a frame
    of its BUILDERS ('floor/a'). {"rng": n} is the project's own seeded
    generator, {"spec": true} the spec its sheets build from and
    {"palette": key} a colour from the game's own table (Orbital's COLOR)."""
    fn, *args = call
    def arg(a):
        if isinstance(a, dict) and 'rng' in a:
            return gc.rng(a['rng'])
        if isinstance(a, dict) and a.get('spec'):
            if gc._diorama_spec is None:
                gc._diorama_spec = gc.spec()
            return gc._diorama_spec
        if isinstance(a, dict) and 'palette' in a:
            return gc.palette()[a['palette']]
        return a
    f = getattr(mod, fn, None) or getattr(mod, 'BUILDERS', {})[fn]
    f(*map(arg, args))


def build_game(project, b, x, y, name):
    """One `build` entry at one point: its calls, under one empty."""
    mod, gc = game_script(project, b['build'])
    _colours.clear()
    _colours.update(b.get('colours', {}))
    _glow.clear()
    _glow.update(b.get('glow', {}))
    before = set(bpy.data.objects)
    for call in b['calls']:
        call_builder(mod, gc, call)
    made = [o for o in bpy.data.objects if o not in before]
    holder = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(holder)
    for o in made:
        if o.parent is None:
            o.parent = holder
    holder.location = Vector((x, y, b.get('z', 0.0)))
    holder.rotation_euler = (0.0, 0.0, math.radians(b.get('rot', 0.0)))
    s = b['scale']
    holder.scale = (s, s, s)
    _colours.clear()
    _glow.clear()
    return holder


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
        for k in range(s.get('count', 1)):
            SHAPES[s['kind']](repeat(s, k), f'{card}-{s["kind"]}-{i}' + (f'-{k}' if k else ''))
    for p in spec.get('place', []):
        step = p.get('step', [0, 0])
        for k in range(p.get('count', 1)):
            x, y = p['at'][0] + step[0] * k, p['at'][1] + step[1] * k
            h = common.import_glb(os.path.join(spec['project'], p['glb']),
                                  at=(x, y, p.get('z', 0.0)), rot=p.get('rot', 0.0), scale=p['scale'])
            if p.get('centre'):
                centre(h)
    for i, b in enumerate(spec.get('build', [])):
        step = b.get('step', [0, 0])
        for k in range(b.get('count', 1)):
            build_game(spec['project'], b, b['at'][0] + step[0] * k, b['at'][1] + step[1] * k,
                       f'{card}-build-{i}-{k}')
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
