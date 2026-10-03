# Faire Weekend's Blender pipeline: the one place its render settings live.
#
# A 2D pipeline (WISHLIST.md B1). It renders a sprite sheet, not models: every
# frame is one render straight down through an orthographic camera onto a
# transparent film, and the frames are packed into one PNG with a JSON atlas
# beside it. It is Faire Weekend's own copy (#643) of Signal City's renderer,
# cut down to what a drawing on a surveyor's plat needs: no sun, no sky, no
# gloss. canonical(), pack() and write_png() are Signal City's as they were.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS on huginn (~/.local/bin/blender), Cycles on the CPU.
# A minor bump stops every script here at check_version() until someone
# reruns the pack, checks that `git status --porcelain` stays empty, and moves
# REQUIRED. One sheet comes from one machine (BACKLOG.md "Blender assets: the
# common plan").
#
# Run from Projects/Ren-Faire-Claude, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/<pack>.py
#
# The style (WISHLIST.md B1, the "Blender assets" section): line work in the
# plat's ink, not shading. Every surface is an emission of one flat colour, so
# a palette hex comes back as that hex with no light on it, and the lines are
# Blender's Freestyle drawn in INK over the top: every silhouette, every
# crease sharper than CREASE, and every edge between two materials. The
# colours are js/plat.js's INK, TERRAIN_FILL and PAPER, read through spec.mjs;
# nothing here invents one.
#
# Units: one plat cell is 1.0 in Blender, so a 2 x 2 stage is built in a
# 2 x 2 box. The image's up is Blender's +Y, which is the plat's north. A
# frame is the cells it claims times budget.json's cell times its scale
# (WISHLIST.md B1: one cell at scale 1, at 2x), its anchor is its centre, and
# the drawing's centre sits on the origin.

import json
import math
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

# The render. Cycles with a fixed seed, a fixed sample count, adaptive sampling
# off and no denoiser gives the same pixels from one run to the next on one
# machine. Flat emission has no noise to clean, so the samples are only the
# antialiasing of an edge. Freestyle is drawn by Cycles' own pass and is as
# stable. Workbench cannot draw Freestyle lines.
SAMPLES = 32
SEED = 0

# The ink. Freestyle's thickness is in frame pixels; a 1-cell frame is 96 px
# shown at the marker's 42 to 44, so 3 px reads as the plat's own 1.2 px rule.
# A crease is drawn where two faces meet at less than this many degrees, which
# takes a roof's ridge and a step's nosing and leaves a curve's facets alone.
LINE = 3.0
CREASE = 150


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
    """The plat's colours and the marker kinds with their footprints, read out
    of js/plat.js and js/data.js by spec.mjs, so both have one home and it is
    the game's."""
    out = subprocess.run(['node', os.path.join(HERE, 'spec.mjs')], capture_output=True,
                         text=True, check=True)
    return json.loads(out.stdout)


# ---------------------------------------------------------------- colour

def rgb(hexv):
    h = hexv.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def linear(hexv):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*(ch(c) for c in rgb(hexv)), 1.0)


# ---------------------------------------------------------------- the scene

def reset(ink):
    """An empty scene from factory settings with the render, the camera and
    the ink every frame shares."""
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
    r.film_transparent = True
    r.resolution_percentage = 100
    r.pixel_aspect_x = r.pixel_aspect_y = 1
    r.use_border = False
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

    r.use_freestyle = True
    r.line_thickness_mode = 'ABSOLUTE'
    r.line_thickness = 1.0
    fs = scene.view_layers[0].freestyle_settings
    fs.crease_angle = math.radians(CREASE)
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    ls = fs.linesets.new('ink')
    ls.select_by_visibility = True
    ls.visibility = 'VISIBLE'
    ls.select_by_edge_types = True
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.select_material_boundary = True
    style = bpy.data.linestyles.new('ink')
    style.color = linear(ink)[:3]
    style.thickness = LINE
    style.thickness_position = 'CENTER'
    style.caps = 'ROUND'
    style.chaining = 'PLAIN'
    ls.linestyle = style

    cam_data = bpy.data.cameras.new('top')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.1
    cam_data.clip_end = 40.0
    cam = bpy.data.objects.new('top', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 20.0)   # straight down; the image's up is +Y, north
    cam.rotation_euler = (0.0, 0.0, 0.0)
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


def flat(name, hexv):
    """A surface that is its colour and nothing else: an emission at strength
    1, which the Standard view transform returns as the hex it was given. Two
    names may share a colour; Freestyle still draws the edge between them,
    which is how a plank or a stripe gets its line."""
    key = (name, hexv)
    if key in _mats:
        return _mats[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = linear(hexv)
    em.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    _mats[key] = mat
    return mat


# ---------------------------------------------------------------- geometry

def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    Signal City's, from Golden Hour's d93690d."""
    verts = sorted(bm.verts, key=lambda v: (v.co.z, v.co.y, v.co.x))
    index = {v: i for i, v in enumerate(verts)}
    faces = []
    for f in bm.faces:
        ids = [index[v] for v in f.verts]
        k = ids.index(min(ids))
        faces.append((f.material_index, ids[k:] + ids[:k], f.smooth))
    faces.sort(key=lambda t: (t[0], t[1]))
    out = bmesh.new()
    nv = [out.verts.new(v.co) for v in verts]
    for mat, ids, smooth in faces:
        f = out.faces.new([nv[i] for i in ids])
        f.material_index = mat
        f.smooth = smooth
    bm.free()
    return out


def mesh_object(name, bm, mat):
    bm = canonical(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def prism(name, pts, z0, z1, mat):
    """A polygon (x, y corners, either winding) stood up between z0 and z1. A
    vertical side is invisible straight down, so what is seen is the top and
    the outline Freestyle draws round it."""
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts)))
    if area < 0:
        pts = pts[::-1]
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]
    hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(pts)
    for k in range(n):
        bm.faces.new([lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]])
    return mesh_object(name, bm, mat)


def box(name, x0, y0, x1, y1, z0, z1, mat):
    return prism(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat)


def circle(cx, cy, r, seg=24, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * k / seg),
             cy + r * math.sin(phase + 2 * math.pi * k / seg)) for k in range(seg)]


def disc(name, cx, cy, r, z0, z1, mat, seg=24):
    return prism(name, circle(cx, cy, r, seg), z0, z1, mat)


def pyramid(name, pts, z0, z1, apex, mat):
    """A roof: the outline at z0 rising to one apex (x, y) at z1. Each face is
    its own plane, so Freestyle draws every hip as a crease."""
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts)))
    if area < 0:
        pts = pts[::-1]
    bm = bmesh.new()
    ring = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = bm.verts.new((apex[0], apex[1], z1))
    bm.faces.new(ring[::-1])
    n = len(ring)
    for k in range(n):
        bm.faces.new([ring[k], ring[(k + 1) % n], top])
    return mesh_object(name, bm, mat)


def gable(name, x0, y0, x1, y1, z0, z1, mat_a, mat_b, stripes):
    """A ridged canopy over a box, the ridge along x at the middle of y, cut
    across into `stripes` bands that take mat_a and mat_b in turn: a striped
    awning seen from above, each band edge a line because the material
    changes there."""
    ym = (y0 + y1) / 2
    bm = bmesh.new()
    xs = [x0 + (x1 - x0) * k / stripes for k in range(stripes + 1)]
    for k in range(stripes):
        a, b = xs[k], xs[k + 1]
        v = [bm.verts.new(c) for c in ((a, y0, z0), (b, y0, z0), (b, ym, z1), (a, ym, z1),
                                        (a, y1, z0), (b, y1, z0))]
        f1 = bm.faces.new([v[0], v[1], v[2], v[3]])
        f2 = bm.faces.new([v[3], v[2], v[5], v[4]])
        f1.material_index = f2.material_index = k % 2
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    ob = mesh_object(name, bm, mat_a)
    ob.data.materials.append(mat_b)
    return ob


# ---------------------------------------------------------------- frames

def frame_px(cells, cell, scale):
    """A frame's side in pixels: the cells it claims at budget.json's cell and
    scale. A 2 x 2 stage is four cells big, not four cells and the gap."""
    return cells * cell * scale


def render_frame(scene, w, h, cells_w, path):
    """Render the scene into a w x h frame, `cells_w` cells across, the origin
    at the frame's centre, and return its RGBA bytes, top row first."""
    r = scene.render
    r.resolution_x, r.resolution_y = w, h
    scene.camera.data.ortho_scale = cells_w
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


def pack(sizes, width):
    """Shelf packing: the tallest frames first, left to right, a new shelf when
    a row is full. Deterministic: ties go by width, then by name. Returns
    {name: (x, y)} and the sheet's height. Two pixels of air between frames,
    so a marker shown at under half size never samples a neighbour."""
    gap = 2
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


def write_sheet(frames, width, png_rel, atlas_rel, cell, scale):
    """Pack `frames` ({name: (w, h, rows)}) into one sheet `width` pixels wide,
    and write the PNG and its atlas under the project. The atlas is
    { "sheet": { w, h, cell, scale }, "frames": { name: { x, y, w, h, ax, ay } } },
    the anchor in frame pixels (BACKLOG.md, the common plan)."""
    at, height = pack({n: (f[0], f[1]) for n, f in frames.items()}, width)
    sheet = [bytearray(width * 4) for _ in range(height)]
    atlas = {}
    for n in sorted(frames):
        w, h, rows = frames[n]
        x, y = at[n]
        for j, row in enumerate(rows):
            sheet[y + j][x * 4:(x + w) * 4] = row
        atlas[n] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': w / 2, 'ay': h / 2}
    write_png(os.path.join(PROJECT, png_rel), width, height, [bytes(r) for r in sheet])
    doc = {'sheet': {'w': width, 'h': height, 'cell': cell, 'scale': scale}, 'frames': atlas}
    with open(os.path.join(PROJECT, atlas_rel), 'w', encoding='utf8', newline='\n') as f:
        f.write(json.dumps(doc, indent=1, sort_keys=True) + '\n')
    return width, height, sheet


def contact_sheet(name, width, height, sheet, ground):
    """The packed sheet over the built marker's own token colour, to
    tools/blender/out/<name>.png (gitignored, #645), so a drawing can be seen
    the way the plat shows it. For looking at; no check reads it."""
    bg = rgb(ground)
    rows = []
    for y in range(height):
        src = sheet[y]
        row = bytearray(width * 4)
        for x in range(width):
            r, g, b, a = src[x * 4:x * 4 + 4]
            k = a / 255
            row[x * 4:x * 4 + 4] = bytes((round(r * k + bg[0] * (1 - k)), round(g * k + bg[1] * (1 - k)),
                                          round(b * k + bg[2] * (1 - k)), 255))
        rows.append(bytes(row))
    path = os.path.join(OUT, f'{name}.png')
    write_png(path, width, height, rows)
    return path
