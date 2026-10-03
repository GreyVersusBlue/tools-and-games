# Hearth's Blender pipeline: the one place its render settings live.
#
# A 2D pipeline (HISTORY.md #805). It renders a sprite sheet, not models: every
# frame is one render through an orthographic camera onto a transparent film,
# and the frames are packed into one PNG with an atlas beside it. It is
# Hearth's own copy (#643) of Faire Weekend's renderer, which was Signal
# City's cut down; pack() and write_png() are theirs as they were.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS on huginn (~/.local/bin/blender), Cycles on the CPU.
# A minor bump stops every script here at check_version() until someone
# reruns the pack, checks that `git status --porcelain` stays empty, and moves
# REQUIRED. One sheet comes from one machine (BACKLOG.md "Blender assets: the
# common plan").
#
# Run from Projects/hearth, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/<pack>.py
#
# The style (HISTORY.md #805). Hearth draws in whole pixels at T = 8 px a tile
# and scales the map up with smoothing off, so a frame is drawn at exactly
# one frame pixel to one map pixel, and a frame's sides are whole tiles: the
# game never resamples it, it only blows it up the way it blows up its own
# fillRects. Every pixel is sampled at its centre (Cycles' pixel filter at its
# 0.01 px floor, one sample) and every surface is a flat emission, so a pixel
# is one colour or nothing, with no antialiased edge and no noise.
#
# The projection is the map's own. Hearth draws a building with its ground
# where it stands and its height straight up the screen: a south face is an
# elevation, one map pixel to one frame pixel, and a roof or a top recedes up
# the screen as far as it runs north. In map pixels, with x east, y south (the
# map's own y) and z up, a point lands on the screen at (x, y - z). The
# camera looks straight down, and every vertex goes through project() first,
# so the camera's depth is y + z: nearer the watcher is further south or
# higher, which is the order draw() already sorts its buildings in.
#
# A face is shaded by which way it faces, one tier a face, from budget.json's
# `tiers`: the palette hex times the tier's factor. The colours are
# js/render.js's, read through spec.mjs; nothing here invents one.

import json
import os
import random
import subprocess
import sys
import zlib

import bpy
import bmesh

REQUIRED = (5, 2)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# One sample through a 0.01 px filter is the pixel's centre and nothing else.
# With a fixed seed and no denoiser it is the same pixel every run.
SAMPLES = 1
SEED = 0
FILTER = 0.01


def check_version():
    have = tuple(bpy.app.version[:2])
    if have != REQUIRED:
        print(f'common.py: this pipeline is pinned to Blender {REQUIRED[0]}.{REQUIRED[1]}, '
              f'and this is Blender {bpy.app.version_string}. Rerun the pack under the new '
              f'version, check `git status --porcelain` stays empty, then move REQUIRED.')
        sys.exit(1)


def rng(seed):
    """The only randomness a pack may use: seeded, and passed down."""
    return random.Random(seed)


def budget():
    with open(os.path.join(HERE, 'budget.json'), encoding='utf8') as f:
        return json.load(f)


def spec():
    """T, BLD, the roof colours and render.js's palette, read out of the game
    by spec.mjs, so each has one home and it is the game's."""
    out = subprocess.run(['node', os.path.join(HERE, 'spec.mjs')], capture_output=True,
                         text=True, check=True)
    return json.loads(out.stdout)


# ---------------------------------------------------------------- colour

def rgb(hexv):
    h = hexv.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(hexv, factor):
    """A palette hex at a tier: each channel times the factor, rounded and
    held to 255. validate.mjs computes the same thing."""
    return tuple(min(255, int(c * factor + 0.5)) for c in rgb(hexv))


def linear(c8):
    """sRGB bytes to Blender's linear RGBA. The Standard view transform turns
    it back into the same bytes."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*(ch(c) for c in c8), 1.0)


# ---------------------------------------------------------------- the scene

def reset():
    """An empty scene from factory settings, with the render and the camera
    every frame shares."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    r = scene.render
    r.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = SEED
    scene.cycles.use_animated_seed = False
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.cycles.filter_width = FILTER
    r.film_transparent = True
    r.resolution_percentage = 100
    r.pixel_aspect_x = r.pixel_aspect_y = 1
    r.use_border = False
    r.use_freestyle = False
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
    r.image_settings.compression = 100
    vs = scene.view_settings
    vs.view_transform = 'Standard'   # a palette hex comes back as that hex
    vs.look = 'None'
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'

    cam_data = bpy.data.cameras.new('top')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 1.0
    cam_data.clip_end = 1000.0
    cam = bpy.data.objects.new('top', cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = (0.0, 0.0, 0.0)   # straight down; project() did the rest
    scene.camera = cam
    return scene


def clear():
    """Everything a frame built, gone, so the next frame starts from the same
    empty set of datablocks (and names) whatever came before it."""
    for ob in list(bpy.data.objects):
        if ob.name != 'top':
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for block in list(coll):
            coll.remove(block)
    _mats.clear()


# ---------------------------------------------------------------- materials

_mats = {}


def flat(c8):
    """A surface that is its colour and nothing else: an emission at strength
    1, which the Standard view transform returns as the bytes it was given."""
    key = ('flat', c8)
    if key in _mats:
        return _mats[key]
    mat = bpy.data.materials.new('flat-%02x%02x%02x' % c8)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = linear(c8)
    em.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    _mats[key] = mat
    return mat


def holdout():
    """A surface that hides what is behind it and leaves the film clear: how
    a snow frame keeps its snow where the building would cover it."""
    if 'holdout' in _mats:
        return _mats['holdout']
    mat = bpy.data.materials.new('holdout')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    ho = nt.nodes.new('ShaderNodeHoldout')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(ho.outputs['Holdout'], out.inputs['Surface'])
    _mats['holdout'] = mat
    return mat


# ---------------------------------------------------------------- geometry

def project(p):
    """A map-pixel point (x east, y south, z up) to Blender: the screen point
    (x, y - z) with Blender's +Y up, and the camera's depth y + z."""
    x, y, z = p
    return (x, z - y, y + z)


def normal(pts):
    """A face's unit normal in map pixels (Newell's method), the corners in
    the order that faces it outward."""
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0, z0 = pts[i]
        x1, y1, z1 = pts[(i + 1) % n]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    m = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
    # Newell's sum is for a right-handed frame; x east, y south, z up is
    # left-handed, so the sign turns over.
    return (-nx / m, -ny / m, -nz / m)


def tier(n):
    """Which way a face faces: the top if it is within about 25 degrees of
    level, and otherwise by the larger part of its normal across the ground,
    so a roof's slopes take east and west and its front takes south. An east
    or west wall is edge-on in this projection; only a slope shows them."""
    nx, ny, nz = n
    if nz >= 0.9:
        return 'top'
    if abs(nx) >= abs(ny):
        return 'east' if nx > 0 else 'west'
    return 'south' if ny > 0 else 'north'


class Model:
    """Faces in map pixels, each with its palette hex. build() makes one mesh
    of them, shaded by tier, or, for a snow frame, snow on every face that
    faces up and a holdout on the rest."""

    def __init__(self):
        self.faces = []

    def face(self, pts, hexv):
        self.faces.append((list(pts), hexv))

    def box(self, x0, x1, y0, y1, z0, z1, hexv, top=None, faces='all'):
        """An axis-aligned box: x0..x1 east, y0..y1 south (y1 is its front),
        z0..z1 up. `top` colours the top face if given."""
        c = hexv
        self.face([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], c)   # south
        self.face([(x1, y0, z0), (x0, y0, z0), (x0, y0, z1), (x1, y0, z1)], c)   # north
        self.face([(x1, y1, z0), (x1, y0, z0), (x1, y0, z1), (x1, y1, z1)], c)   # east
        self.face([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], c)   # west
        self.face([(x0, y1, z1), (x1, y1, z1), (x1, y0, z1), (x0, y0, z1)], top or c)

    def hip(self, x0, x1, y0, y1, z0, z1, inset, hexv, front=None):
        """A hipped roof on the eaves rectangle x0..x1, y0..y1 at z0, rising
        to a ridge along y at z1, the ridge `inset` in from the front and
        back. Its south face is a triangle, which is the roof the game draws."""
        xm = (x0 + x1) / 2
        a, b = (xm, y1 - inset, z1), (xm, y0 + inset, z1)
        self.face([(x0, y1, z0), (x1, y1, z0), a], front or hexv)                     # south
        self.face([(x1, y0, z0), (x0, y0, z0), b], hexv)                              # north
        self.face([(x1, y1, z0), (x1, y0, z0), b, a], hexv)                           # east
        self.face([(x0, y0, z0), (x0, y1, z0), a, b], hexv)                           # west

    def gable(self, x0, x1, y0, y1, z0, z1, hexv, end=None):
        """A gabled roof, the ridge along y at z1: two slopes and a triangle
        at each end. `end` colours the south gable if given."""
        xm = (x0 + x1) / 2
        self.face([(x0, y1, z0), (x1, y1, z0), (xm, y1, z1)], end or hexv)            # south gable
        self.face([(x1, y0, z0), (x0, y0, z0), (xm, y0, z1)], end or hexv)            # north gable
        self.face([(x1, y1, z0), (x1, y0, z0), (xm, y0, z1), (xm, y1, z1)], hexv)    # east slope
        self.face([(x0, y0, z0), (x0, y1, z0), (xm, y1, z1), (xm, y0, z1)], hexv)    # west slope

    def lean(self, x0, x1, y0, y1, zf, zb, hexv):
        """A flat roof that rises from zf at the front to zb at the back, and
        its two side wedges."""
        self.face([(x0, y1, zf), (x1, y1, zf), (x1, y0, zb), (x0, y0, zb)], hexv)
        self.face([(x0, y1, zf - 1), (x1, y1, zf - 1), (x1, y1, zf), (x0, y1, zf)], hexv)  # the edge

    def plate(self, x0, x1, z0, z1, y, hexv):
        """A flat panel on the south face of something at row y: a door, a
        window, a stripe. It stands a hair proud of the wall so it wins."""
        y += 0.05
        self.face([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], hexv)

    def build(self, tiers, snow=None, snow_up=0.5):
        bm = bmesh.new()
        mats, index = [], {}
        for pts, hexv in self.faces:
            n = normal(pts)
            if snow:
                key = 'snow' if n[2] >= snow_up else 'hold'
            else:
                key = shade(hexv, tiers[tier(n)])
            if key not in index:
                index[key] = len(mats)
                mats.append(flat(rgb(snow)) if key == 'snow' else holdout() if key == 'hold' else flat(key))
            f = bm.faces.new([bm.verts.new(project(p)) for p in pts])
            f.material_index = index[key]
        me = bpy.data.meshes.new('model')
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new('model', me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- frames

def render_frame(scene, box, path):
    """Render the screen box (x, y, w, h), in map pixels from the building's
    tile corner, into a w x h frame, and return its RGBA bytes, top row first."""
    x, y, w, h = box
    r = scene.render
    r.resolution_x, r.resolution_y = w, h
    cam = scene.camera
    cam.data.ortho_scale = w
    cam.location = (x + w / 2, -(y + h / 2), 500.0)
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    return read_png(path)


def read_png(path):
    """Straight RGBA bytes from an 8-bit PNG Blender wrote, top row first.
    Blender's file carries a timestamp; these pixels do not."""
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = list(img.pixels)            # bottom row first, floats of bytes / 255
    bpy.data.images.remove(img)
    rows = []
    for y in range(h - 1, -1, -1):
        row = px[y * w * 4:(y + 1) * w * 4]
        rows.append(bytes(int(round(v * 255)) for v in row))
    return w, h, rows


def pack(sizes, width, gap):
    """Shelf packing: the tallest frames first, left to right, a new shelf when
    a row is full. Deterministic: ties go by width, then by name. Returns
    {name: (x, y)} and the sheet's height."""
    order = sorted(sizes, key=lambda n: (-sizes[n][1], -sizes[n][0], n))
    at, x, y, shelf = {}, 0, 0, 0
    for n in order:
        w, h = sizes[n]
        if w > width:
            raise ValueError(f'frame {n} is {w} px wide, wider than the {width} px sheet')
        if x + w > width:
            x, y, shelf = 0, y + shelf + gap, 0
        at[n] = (x, y)
        x += w + gap
        shelf = max(shelf, h)
    return at, y + shelf


def write_png(path, w, h, rows):
    """An 8-bit RGBA PNG from its rows, written here rather than by Blender so
    the bytes depend on the pixels and nothing else. Each row takes whichever of
    PNG's five filters leaves the smallest sum, the usual heuristic."""
    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    raw = bytearray()
    prev = bytes(w * 4)
    for row in rows:
        cands = []
        for ft in range(5):
            f = bytearray(len(row))
            for i, v in enumerate(row):
                a = row[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pred = (0, a, b, (a + b) >> 1, paeth(a, b, c))[ft]
                f[i] = (v - pred) & 255
            cands.append((sum(x if x < 128 else 256 - x for x in f), ft, f))
        _, ft, f = min(cands, key=lambda t: (t[0], t[1]))
        raw.append(ft)
        raw += f
        prev = row

    def chunk(kind, data):
        c = kind + data
        return len(data).to_bytes(4, 'big') + c + zlib.crc32(c).to_bytes(4, 'big')

    ihdr = w.to_bytes(4, 'big') + h.to_bytes(4, 'big') + bytes((8, 6, 0, 0, 0))
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


ATLAS_HEAD = ('// Generated by tools/blender/buildings.py; do not edit. The building sheet\'s atlas,\n'
              '// as data: Hearth\'s scripts are classic, so it is a JSON literal on one global\n'
              '// rather than an import, and it loads by <script> before js/render.js (#806).\n'
              'const BSHEET=')


def write_sheet(frames, width, gap, png_rel, atlas_rel, tile):
    """Pack `frames` ({name: (w, h, rows, ax, ay)}) into one sheet `width`
    pixels wide, and write the PNG and its atlas under the project. The atlas
    is { "sheet": { w, h, tile }, "frames": { name: { x, y, w, h, ax, ay } } },
    the anchor being where the building's tile corner falls in the frame."""
    at, height = pack({n: (f[0], f[1]) for n, f in frames.items()}, width, gap)
    sheet = [bytearray(width * 4) for _ in range(height)]
    atlas = {}
    for n in sorted(frames):
        w, h, rows, ax, ay = frames[n]
        x, y = at[n]
        for j, row in enumerate(rows):
            sheet[y + j][x * 4:(x + w) * 4] = row
        atlas[n] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax, 'ay': ay}
    write_png(os.path.join(PROJECT, png_rel), width, height, [bytes(r) for r in sheet])
    doc = {'sheet': {'w': width, 'h': height, 'tile': tile}, 'frames': atlas}
    with open(os.path.join(PROJECT, atlas_rel), 'w', encoding='utf8', newline='\n') as f:
        f.write(ATLAS_HEAD + json.dumps(doc, indent=1, sort_keys=True) + ';\n')
    return width, height, sheet


def contact_sheet(name, width, height, sheet, ground, zoom):
    """The packed sheet over the island's grass, blown up `zoom` times with no
    smoothing the way the game shows it, to tools/blender/out/<name>.png
    (gitignored, #645). For looking at; no check reads it."""
    bg = rgb(ground)
    rows = []
    for y in range(height):
        src = sheet[y]
        row = bytearray(width * 4 * zoom)
        for x in range(width):
            r, g, b, a = src[x * 4:x * 4 + 4]
            k = a / 255
            px = bytes((round(r * k + bg[0] * (1 - k)), round(g * k + bg[1] * (1 - k)),
                        round(b * k + bg[2] * (1 - k)), 255))
            row[x * 4 * zoom:(x + 1) * 4 * zoom] = px * zoom
        rows.extend([bytes(row)] * zoom)
    path = os.path.join(OUT, f'{name}.png')
    write_png(path, width * zoom, height * zoom, rows)
    return path
