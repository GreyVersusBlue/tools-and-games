# Signal City's Blender pipeline: the one place its render settings live.
#
# The first 2D pipeline in the repo (WISHLIST.md B1). It renders sprite sheets,
# not models: every frame is one render straight down through an orthographic
# camera onto a transparent film, and the frames are packed into one PNG with a
# JSON atlas beside it. Other 2D projects copy this file rather than share it
# (#643). canonical() is Golden Hour's, from d93690d, where #652 found that
# Blender's own primitives do not come out in a stable order.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS on huginn (~/.local/bin/blender), Cycles on the CPU.
# A minor bump stops every script here at check_version() until someone
# reruns the pack, checks that `git status --porcelain` stays empty, and moves
# REQUIRED. A lit render's bytes differ between machines, so one sheet comes
# from one machine (BACKLOG.md "Blender assets: the common plan").
#
# Run from Projects/signal-city, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/<pack>.py -- [frame ...]
#
# Conventions every sheet keeps (validate.mjs checks the ones a file can show):
# a car is built in metres, nose along +x, centred on the origin, exactly as
# js/sprites.js draws it. Blender's +Y is the game's -y, so the top of the
# image is the side sprites.js calls -y, the side its roof gloss sits on and
# the side the light comes from here. A frame is ceil(length * ppm) + 2 * pad
# pixels by ceil(width * ppm) + 2 * pad, the size spriteFor() makes its canvas,
# and its anchor is the frame's centre, which is where the car's origin lands.
# Colours come from js/sprites.js through spec.mjs; nothing here invents one.

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
# off and no denoiser is byte-stable from one run to the next on one machine;
# the grain left at 128 samples is what the sheet is. OpenImageDenoise on the
# CPU was byte-stable too, and took 9% off the PNG while softening the seams and
# the lettering, so it stays off. Workbench was the other stable choice, and it
# cannot put the light where sprites.js puts its gloss.
SAMPLES = 128
SEED = 0
DENOISE = False


def check_version():
    have = tuple(bpy.app.version[:2])
    if have != REQUIRED:
        print(f'common.py: this pipeline is pinned to Blender {REQUIRED[0]}.{REQUIRED[1]}, '
              f'and this is Blender {bpy.app.version_string}. Rerun the pack under the new '
              f'version, check `git status --porcelain` stays empty, then move REQUIRED.')
        sys.exit(1)


def args():
    """Whatever follows `--` on the command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def rng(seed):
    """The only randomness a pack may use: seeded, and passed down."""
    return random.Random(seed)


def budget():
    with open(os.path.join(HERE, 'budget.json'), encoding='utf8') as f:
        return json.load(f)


def spec():
    """The archetypes, their sizes and their palettes, read out of js/sprites.js
    by spec.mjs, so the palette has one home and it is the game's."""
    out = subprocess.run(['node', os.path.join(HERE, 'spec.mjs')], capture_output=True,
                         text=True, check=True)
    return json.loads(out.stdout)


# ---------------------------------------------------------------- colour

def rgb(hexv):
    h = hexv.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(hexv, other, k):
    """sprites.js's mix(): the same rounding, so a darkened trim is the colour
    the procedural car gives it."""
    a, b = rgb(hexv), rgb(other)
    return '#' + ''.join(f'{round(v + (w - v) * k):02x}' for v, w in zip(a, b))


def darken(hexv, k):
    return mix(hexv, '#000000', k)


def lighten(hexv, k):
    return mix(hexv, '#ffffff', k)


def linear(hexv):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*(ch(c) for c in rgb(hexv)), 1.0)


# ---------------------------------------------------------------- the scene

def reset():
    """An empty scene from factory settings with the render, the camera, the
    sun and the sky every frame shares."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    r = scene.render
    r.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = SEED
    scene.cycles.use_animated_seed = False
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = DENOISE
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.denoising_use_gpu = False
    scene.cycles.max_bounces = 4
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
    vs.view_transform = 'Standard'   # a palette hex comes back as that hex, lit
    vs.look = 'None'
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'

    cam_data = bpy.data.cameras.new('top')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.1
    cam_data.clip_end = 40.0
    cam = bpy.data.objects.new('top', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 20.0)   # straight down; the image's up is +Y
    cam.rotation_euler = (0.0, 0.0, 0.0)
    scene.camera = cam

    # The sun comes from the front and the -y side (Blender +Y), fifty degrees
    # up: the corner sprites.js starts its light-catch gradient from.
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = LIGHT['sun']
    sun_data.angle = math.radians(6)
    sun = bpy.data.objects.new('sun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector(LIGHT['from']).normalized().to_track_quat('Z', 'Y').to_euler()

    # The sky: brighter toward the sun, so a crowned roof and a glass pane
    # reflect a gradient that runs back from the nose, which is the gloss.
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new('ShaderNodeTexCoord')
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = Vector(LIGHT['from']).normalized()
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = -1.0
    ramp.inputs['From Max'].default_value = 1.0
    ramp.inputs['To Min'].default_value = LIGHT['sky'][0]
    ramp.inputs['To Max'].default_value = LIGHT['sky'][1]
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(coord.outputs['Generated'], dot.inputs[0])
    nt.links.new(dot.outputs['Value'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], bg.inputs['Strength'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return scene


# The light rig as numbers, so the style sheet can name them.
LIGHT = {
    'from': (0.55, 0.45, 0.70),   # Blender axes: front, the -y side, up
    'sun': 1.6,
    'sky': (0.18, 0.62),          # sky strength facing away from the sun, and toward it
}


def clear():
    """Everything a frame built, gone, so the next frame starts from the same
    empty set of datablocks (and names) whatever came before it."""
    keep = {'top', 'sun'}
    for ob in list(bpy.data.objects):
        if ob.name not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for block in list(coll):
            coll.remove(block)


# ---------------------------------------------------------------- materials

def paint_mat(name, hexv, roughness=0.32, coat=0.6):
    """Car paint: the palette colour under a clear coat, glossy enough to show
    the sky's gradient on a crowned panel."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = linear(hexv)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = 0.08
    return mat


def matte_mat(name, hexv, roughness=0.8):
    return paint_mat(name, hexv, roughness=roughness, coat=0.0)


def glass_mat(name, hexv):
    """Glass reads from above as a dark, sharp mirror of the sky."""
    return paint_mat(name, hexv, roughness=0.06, coat=0.0)


def lamp_mat(name, hexv, strength=1.0):
    """A lamp that is lit: its colour as emission, at `strength` over the base."""
    mat = paint_mat(name, hexv, roughness=0.3, coat=0.0)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Emission Color'].default_value = linear(hexv)
    bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def glow_mat(name, hexv, alpha, inner, outer, centre=(0.0, 0.0)):
    """A soft disc of light on the road under a car, fading from `inner` to
    `outer` metres out: sprites.js's radial halo, as emission over the film's
    transparency, peaking at `alpha`."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new('ShaderNodeTexCoord')
    dist = nt.nodes.new('ShaderNodeVectorMath')
    dist.operation = 'DISTANCE'
    dist.inputs[1].default_value = (centre[0], -centre[1], 0.0)
    fade = nt.nodes.new('ShaderNodeMapRange')
    fade.inputs['From Min'].default_value = inner
    fade.inputs['From Max'].default_value = outer
    fade.inputs['To Min'].default_value = alpha
    fade.inputs['To Max'].default_value = 0.0
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = linear(hexv)
    em.inputs['Strength'].default_value = 1.0
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mixer = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(coord.outputs['Object'], dist.inputs[0])
    nt.links.new(dist.outputs['Value'], fade.inputs['Value'])
    nt.links.new(fade.outputs['Result'], mixer.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mixer.inputs[1])
    nt.links.new(em.outputs['Emission'], mixer.inputs[2])
    nt.links.new(mixer.outputs['Shader'], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------- outlines

def round_poly(pts, r, seg=6):
    """sprites.js's roundPoly() as points: every corner of a closed polygon
    rounded to r, the radius cut down where two corners would overlap (canvas
    arcTo overshoots instead, which no hull in sprites.js asks it to do)."""
    if r <= 0:
        return [tuple(p) for p in pts]
    n = len(pts)
    out = []
    for i in range(n):
        p = Vector(pts[i])
        a = Vector(pts[i - 1])
        b = Vector(pts[(i + 1) % n])
        u0, u1 = (a - p), (b - p)
        l0, l1 = u0.length, u1.length
        u0.normalize()
        u1.normalize()
        theta = math.acos(max(-1.0, min(1.0, u0.dot(u1))))
        if theta < 1e-4 or abs(theta - math.pi) < 1e-4:
            out.append((p.x, p.y))
            continue
        d = r / math.tan(theta / 2)
        dmax = min(l0, l1) / 2 * 0.98     # two corners never share a point
        rr = r if d <= dmax else dmax * math.tan(theta / 2)
        d = min(d, dmax)
        t0, t1 = p + u0 * d, p + u1 * d
        bis = (u0 + u1).normalized()
        c = p + bis * (rr / math.sin(theta / 2))
        a0 = math.atan2(t0.y - c.y, t0.x - c.x)
        a1 = math.atan2(t1.y - c.y, t1.x - c.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(seg + 1):
            ang = a0 + da * k / seg
            out.append((c.x + rr * math.cos(ang), c.y + rr * math.sin(ang)))
    return out


def rrect(x, y, w, h, r):
    """sprites.js's rr(): a rectangle from its top-left corner in the game's
    axes, corners rounded to r, as a shape for slab()."""
    r = min(r, abs(w) / 2, abs(h) / 2)
    return ([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], r)


def offset(corners, d):
    """A convex polygon moved in by d on every side: each edge's line pushed
    toward the middle, and the new corners where neighbouring lines meet."""
    n = len(corners)
    cx = sum(p[0] for p in corners) / n
    cy = sum(p[1] for p in corners) / n
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        k = math.hypot(ex, ey)
        nx, ny = -ey / k, ex / k
        if (cx - x0) * nx + (cy - y0) * ny < 0:
            nx, ny = -nx, -ny
        lines.append(((x0 + nx * d, y0 + ny * d), (ex, ey)))
    out = []
    for i in range(n):
        (px, py), (ax, ay) = lines[i - 1]
        (qx, qy), (bx, by) = lines[i]
        den = ax * by - ay * bx
        t = ((qx - px) * by - (qy - py) * bx) / den
        out.append((px + ax * t, py + ay * t))
    return out


# ---------------------------------------------------------------- geometry

def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    Golden Hour's, from d93690d, without the UV half: nothing here is
    textured."""
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


def mesh_object(name, bm, mat, shadow=True):
    bm = canonical(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.visible_shadow = shadow
    return ob


def slab(name, shape, z0, z1, mat, crown=(), shadow=True):
    """A shape standing up between z0 and z1, its top stepped in and up by
    `crown`, a list of (inset, rise) pairs in metres. `shape` is a polygon's
    corners in game axes and the radius its corners are rounded to, as
    sprites.js writes a hull; each crown step is that polygon moved in by the
    inset and rounded at the radius less it, which is the exact offset of the
    rounded outline and keeps every ring the same number of points. Every hull
    in sprites.js is convex, which offset() needs; a concave outline (a
    curved trim) takes no crown. The steps are shaded smooth, so a hull reads
    as a rounded panel from above and the sky's gradient runs across it. A
    vertical side is invisible to a camera looking straight down, so only the
    top and the crown are seen."""
    corners, r = shape
    rings = [(round_poly(corners, r), z0), (round_poly(corners, r), z1)]
    inset, z = 0.0, z1
    for step, rise in crown:
        inset += step
        z += rise
        rings.append((round_poly(offset(corners, inset), max(r - inset, 0.01)), z))
    first = [(x, -y) for x, y in rings[0][0]]
    area = sum(first[i][0] * first[(i + 1) % len(first)][1] - first[(i + 1) % len(first)][0] * first[i][1]
               for i in range(len(first)))
    flip = area < 0
    bm = bmesh.new()
    loops = []
    for pts, zz in rings:
        ring = [bm.verts.new((x, -y, zz)) for x, y in pts]
        loops.append(ring[::-1] if flip else ring)
    if any(len(l) != len(loops[0]) for l in loops):
        raise ValueError(f'{name}: crown rings differ in point count')
    base = bm.faces.new(loops[0][::-1])
    n = len(loops[0])
    for lo, hi in zip(loops, loops[1:]):
        for k in range(n):
            bm.faces.new([lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]])
    bm.faces.new(loops[-1])
    for f in bm.faces:
        f.smooth = bool(crown) and f is not base
    return mesh_object(name, bm, mat, shadow)


def plate(name, shape, z, mat, thick=0.02):
    """A flat part lying on a surface (a lamp, a stripe, a seam, a placard).
    It casts no shadow: it is paint, not a thing standing on the car."""
    return slab(name, shape, z - thick, z, mat, shadow=False)


def wheel(name, x, y, length, thick, mat, radius=0.34):
    """A tyre seen from above: a cylinder across the car, its outer face at the
    game's y + thick (or y), the length of its footprint along x."""
    bm = bmesh.new()
    seg = 12
    ring = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        ring.append((x + math.cos(a) * length / 2, radius + math.sin(a) * radius))
    y0, y1 = -y, -(y + thick)            # to Blender's Y
    lo, hi = min(y0, y1), max(y0, y1)
    a = [bm.verts.new((px, lo, pz)) for px, pz in ring]
    b = [bm.verts.new((px, hi, pz)) for px, pz in ring]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for k in range(seg):
        bm.faces.new([a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_object(name, bm, mat)


def text(name, body, x, y, size, z, mat):
    """Lettering lying flat at z, centred on (x, y) in game axes, reading
    along +x the way fillText does in the car's frame."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.004
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (x, -y, z)
    ob.visible_shadow = False
    return ob


# ---------------------------------------------------------------- frames

def frame_size(length, width, ppm, pad):
    """The pixel box spriteFor() makes its canvas: ceil(metres * ppm) plus the
    pad on both sides."""
    return math.ceil(length * ppm) + 2 * pad, math.ceil(width * ppm) + 2 * pad


def render_frame(scene, w, h, ppm, path):
    """Render what is in the scene into a w x h frame at ppm pixels a metre,
    the origin at the frame's centre, and return its RGBA bytes, top row first."""
    r = scene.render
    r.resolution_x, r.resolution_y = w, h
    scene.camera.data.ortho_scale = w / ppm
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    return read_png(path)


def read_png(path):
    """Straight RGBA bytes from an 8-bit PNG Blender wrote, top row first."""
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
    {name: (x, y)} and the sheet's height. One pixel of air between frames, so
    the filtering at a frame's edge never reaches a neighbour."""
    gap = 1
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


def write_sheet(frames, width, png_rel, atlas_rel, ppm, pad):
    """Pack `frames` ({name: (w, h, rows)}) into one sheet `width` pixels wide,
    and write the PNG and its atlas under the project. The atlas is
    { "sheet": { w, h, ppm, pad }, "frames": { name: { x, y, w, h, ax, ay } } },
    the anchor in frame pixels (#715)."""
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
    doc = {'sheet': {'w': width, 'h': height, 'ppm': ppm, 'pad': pad}, 'frames': atlas}
    with open(os.path.join(PROJECT, atlas_rel), 'w', encoding='utf8', newline='\n') as f:
        f.write(json.dumps(doc, indent=1, sort_keys=True) + '\n')
    return width, height, sheet


def contact_sheet(name, width, height, sheet, tile=16):
    """The packed sheet over a grey checkerboard, to tools/blender/out/<name>.png
    (gitignored, #645), so a frame's edge and its transparency can be seen. For
    looking at; no check reads it."""
    rows = []
    for y in range(height):
        src = sheet[y]
        row = bytearray(width * 4)
        for x in range(width):
            bgv = 150 if ((x // tile) + (y // tile)) % 2 else 110
            r, g, b, a = src[x * 4:x * 4 + 4]
            k = a / 255
            row[x * 4:x * 4 + 4] = bytes((round(r * k + bgv * (1 - k)), round(g * k + bgv * (1 - k)),
                                          round(b * k + bgv * (1 - k)), 255))
        rows.append(bytes(row))
    path = os.path.join(OUT, f'{name}.png')
    write_png(path, width, height, rows)
    return path
