# Corner & Kettle's Blender pipeline: the one place its render settings live.
#
# A 2D pipeline (WISHLIST.md B1). It renders one sprite sheet, not models: the
# cup a station builds and the food a customer orders, seen from a
# three-quarter camera the way a thing on a counter is seen, packed into one
# PNG with an atlas beside it. It is Corner & Kettle's own copy (#643) of
# Faire Weekend's renderer, which was Signal City's: canonical(), read_png(),
# pack() and write_png() are theirs as they were.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS on huginn (~/.local/bin/blender), Cycles on the CPU.
# A minor bump stops every script here at check_version() until someone
# reruns the pack, checks that `git status --porcelain` stays empty, and moves
# REQUIRED. One sheet comes from one machine (BACKLOG.md "Blender assets: the
# common plan").
#
# Run from Projects/corner-and-kettle, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/<pack>.py
#
# The style (WISHLIST.md, "Blender assets"): the old cup's ink and its flat
# fills, given a body. Every surface is an emission, so nothing depends on a
# light's noise; its strength comes from the face's normal against one fixed
# light direction, between SHADE and 1, so a face turned to the light is its
# palette hex exactly and a face turned away is that hex darker. The lines are
# Freestyle in INK (the old SVG's stroke) over the top: every silhouette, every
# crease sharper than CREASE, every edge between two materials.
#
# The camera: orthographic, ELEVATION degrees above the counter, looking at
# the cup's front with its handle on the right, as the old SVG drew it. One
# Blender unit is 10 units of the old SVG's 100 x 130 viewBox, and a frame is
# that viewBox at SCALE pixels per unit, so every cup layer lines up with the
# others by being drawn at the same place.

import json
import math
import os
import random
import subprocess
import sys
import zlib

import bpy
import bmesh
from mathutils import Vector

REQUIRED = (5, 2)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# The render. Cycles with a fixed seed, a fixed sample count, adaptive sampling
# off and no denoiser gives the same pixels from one run to the next on one
# machine. An emission has no noise to clean, so the samples are only the
# antialiasing of an edge.
SAMPLES = 32
SEED = 0

# The ink: Freestyle's thickness in frame pixels. A cup frame is shown at its
# viewBox size, half its pixels, so 4 px is the old SVG's 2 to 2.5 unit stroke.
LINE = 4.0
CREASE = 140

# The look. ELEVATION is the camera's angle above the counter; SHADE the
# strength of a face turned straight away from LIGHT, and BANDS the number of
# steps from SHADE to 1. Stepped, not smooth: the shop's UI is flat fills, and
# a smooth gradient made every pixel its own value and the sheet 180 KB.
ELEVATION = 30.0
LIGHT = (-0.45, -0.55, 1.0)
SHADE = 0.76
BANDS = 4


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
    """The palette, the layers and the foods, read out of js/content.js by
    spec.mjs, so each has one home and it is the game's."""
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
    scene.cycles.transparent_max_bounces = 8
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
    bare = bpy.data.collections.new('bare')
    scene.collection.children.link(bare)
    ls.select_by_collection = True
    ls.collection = bare
    ls.collection_negation = 'EXCLUSIVE'

    cam_data = bpy.data.cameras.new('view')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.1
    cam_data.clip_end = 80.0
    cam = bpy.data.objects.new('view', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene


def axes():
    """The camera's forward and up, and the world's right, at ELEVATION."""
    e = math.radians(ELEVATION)
    fwd = Vector((0.0, math.cos(e), -math.sin(e)))
    up = Vector((0.0, math.sin(e), math.cos(e)))
    return fwd, up, Vector((1.0, 0.0, 0.0))


def screen(p):
    """A world point's place on the image plane, in units: (right, up)."""
    _, up, right = axes()
    p = Vector(p)
    return p.dot(right), p.dot(up)


def aim(scene, cx, cy, width):
    """Point the camera so the image plane's (cx, cy) is the frame's centre
    and the frame is `width` units across."""
    fwd, up, right = axes()
    cam = scene.camera
    cam.location = right * cx + up * cy - fwd * 40.0
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = width


def clear():
    """Everything a frame built, gone, so the next frame starts from the same
    empty set of datablocks (and names) whatever came before it."""
    for ob in list(bpy.data.objects):
        if ob.name != 'view':
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for block in list(coll):
            coll.remove(block)
    _mats.clear()


# ---------------------------------------------------------------- materials

_mats = {}


def flat(name, hexv, alpha=1.0, shade=True):
    """A surface that is its colour, lit by nothing: an emission whose
    strength runs from SHADE (a face turned away from LIGHT) to 1 (a face
    turned to it), which the Standard view transform returns as the hex at 1.
    `alpha` under 1 mixes in a transparent surface: glass. `shade=False` is
    the hex everywhere."""
    key = (name, hexv, alpha, shade)
    if key in _mats:
        return _mats[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = linear(hexv)
    if shade:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        dot.inputs[1].default_value = Vector(LIGHT).normalized()
        nt.links.new(geo.outputs['Normal'], dot.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.clamp = True
        mr.inputs['From Min'].default_value = -0.2
        mr.inputs['From Max'].default_value = 0.8
        mr.inputs['To Min'].default_value = SHADE
        mr.inputs['To Max'].default_value = 1.0
        mr.interpolation_type = 'STEPPED'      # BANDS steps, not a gradient
        mr.inputs['Steps'].default_value = BANDS - 1
        nt.links.new(dot.outputs['Value'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], em.inputs['Strength'])
    else:
        em.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if alpha < 1.0:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = alpha
        nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
        nt.links.new(em.outputs['Emission'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    else:
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


def mesh_object(name, bm, mats):
    """A bmesh as an object, its faces' material_index into `mats`."""
    bm = canonical(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def lathe(name, profile, mat, seg=48, keep=None, cap_bottom=False, cap_top=False, smooth=True,
          mat_of=None):
    """A surface of revolution about +Z: `profile` is (radius, z) from the
    bottom up. `keep(angle)` drops the faces whose middle angle it refuses,
    which is how a glass is cut into the half behind the liquid and the half
    in front of it. Angles are measured from +X towards +Y (the back).
    `mat_of(k)` picks the material index of the k-th slice round, for a
    pleated wrapper; `mat` is then a list."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r == 0:
            pole = bm.verts.new((0.0, 0.0, z))
            rings.append([pole] * seg)
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / seg),
                                        r * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg):
            mid = 2 * math.pi * (k + 0.5) / seg
            if keep and not keep(mid):
                continue
            quad = [rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]]
            quad = [v for j, v in enumerate(quad) if v not in quad[:j]]
            f = bm.faces.new(quad)
            f.smooth = smooth
            if mat_of:
                f.material_index = mat_of(k)
    if cap_bottom:
        f = bm.faces.new(rings[0][::-1])
        f.smooth = False
    if cap_top:
        f = bm.faces.new(rings[-1])
        f.smooth = False
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return mesh_object(name, bm, mat)


def tube(name, path, radius, mat, seg=10):
    """A round tube along a polyline of points: a straw, a handle, a drizzle."""
    bm = bmesh.new()
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = t.orthogonal().normalized()
        b = t.cross(a).normalized()
        rings.append([bm.verts.new(p + radius * (math.cos(2 * math.pi * k / seg) * a +
                                                  math.sin(2 * math.pi * k / seg) * b))
                      for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg):
            f = bm.faces.new([rings[i][k], rings[i][(k + 1) % seg],
                              rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
            f.smooth = True
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return mesh_object(name, bm, mat)


def blob(name, centre, size, mat, rot=(0.0, 0.0, 0.0), subdiv=2):
    """A squashed sphere: a speck of cinnamon, a sprinkle, a chip, a seed."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    from mathutils import Euler
    rm = Euler(rot).to_matrix()
    for v in bm.verts:
        v.co = rm @ v.co + Vector(centre)
    for f in bm.faces:
        f.smooth = True
    return mesh_object(name, bm, mat)


def bare(ob):
    """An object drawn without ink: it moves into the `bare` collection, which
    the ink's lineset leaves out. A speck of cinnamon is two pixels across,
    and a 4 px line round it is all that would show."""
    bpy.context.scene.collection.objects.unlink(ob)
    bpy.data.collections['bare'].objects.link(ob)
    return ob


def rounded_cube(name, centre, side, mat, rot=(0.0, 0.0, 0.0)):
    """An ice cube: a cube with its edges bevelled round in three steps, so no
    edge is sharp enough to be a crease and the ink draws its outline only."""
    from mathutils import Euler
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=side)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=side * 0.22, segments=3,
                    affect='EDGES', profile=0.5)
    rm = Euler(rot).to_matrix()
    for v in bm.verts:
        v.co = rm @ v.co + Vector(centre)
    for f in bm.faces:
        f.smooth = True
    return mesh_object(name, bm, mat)


def holdout(ob):
    """An object that hides what is behind it and draws nothing itself, not
    even its ink: the liquid, when the ice that floats in it is rendered."""
    ob.is_holdout = True
    return bare(ob)


def set_ink(hexv):
    """The ink's colour for the next render."""
    bpy.data.linestyles['ink'].color = linear(hexv)[:3]


# ---------------------------------------------------------------- frames

def render_frame(scene, w, h, path):
    """Render the scene into a w x h frame and return its RGBA bytes, top row
    first."""
    r = scene.render
    r.resolution_x, r.resolution_y = w, h
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    return read_png(path)


def read_png(path):
    """Straight RGBA bytes from an 8-bit PNG Blender wrote, top row first.
    Blender's file carries a timestamp; these pixels do not. A clear pixel
    comes back as 0, 0, 0, 0 whatever Blender left in its colour."""
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = list(img.pixels)            # bottom row first, floats of bytes / 255
    bpy.data.images.remove(img)
    rows = []
    for y in range(h - 1, -1, -1):
        row = px[y * w * 4:(y + 1) * w * 4]
        b = bytearray(int(round(v * 255)) for v in row)
        for i in range(0, len(b), 4):     # nothing under a clear pixel: Blender
            if b[i + 3] == 0:             # leaves 1s there, and they cost bytes
                b[i:i + 3] = b'\x00\x00\x00'
        rows.append(bytes(b))
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


def write_sheet(frames, width, png_rel, atlas_rel, meta):
    """Pack `frames` ({name: (w, h, rows)}) into one sheet `width` pixels wide,
    and write the PNG and its atlas under the project. The atlas is an ES
    module, since draw.js imports it and the page has no fetch to wait on:
    `export const CUP_SHEET = { sheet: { w, h, ...meta }, frames: { name: { x,
    y, w, h, ax, ay } } };`, the anchor in frame pixels (BACKLOG.md, the
    common plan), one JSON literal so validate.mjs can read it either way."""
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
    doc = {'sheet': {'w': width, 'h': height, **meta}, 'frames': atlas}
    with open(os.path.join(PROJECT, atlas_rel), 'w', encoding='utf8', newline='\n') as f:
        f.write('// Generated by tools/blender/cups.py; do not edit. The atlas of cups.png beside it.\n')
        f.write('export const CUP_SHEET = ' + json.dumps(doc, indent=1, sort_keys=True) + ';\n')
    return width, height, sheet


def contact_sheet(name, width, height, sheet, ground):
    """The packed sheet over the counter's colour, to tools/blender/out/<name>.png
    (gitignored, #645). For looking at; no check reads it."""
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
