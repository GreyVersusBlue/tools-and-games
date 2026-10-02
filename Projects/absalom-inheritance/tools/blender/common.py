# The Absalom Inheritance's Blender pipeline: the one place its render
# settings live.
#
# A 2D pipeline (WISHLIST.md B1). It renders sprite sheets, not models: every
# frame is one render through an orthographic camera at the board's own 2:1
# isometric angle onto a transparent film, and the frames are packed into one
# PNG with a JSON atlas beside it. It is Absalom's own copy of Signal City's
# (#643); write_png, pack and canonical() are that file's, unchanged.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS on huginn (~/.local/bin/blender), Cycles on the CPU.
# A minor bump stops every script here at check_version() until someone
# reruns the sheets, checks that `git status --porcelain` stays empty, and
# moves REQUIRED. A render's bytes can differ between machines, so one sheet
# comes from one machine (BACKLOG.md "Blender assets: the common plan").
#
# Run from Projects/absalom-inheritance, headless, one render at a time:
#   blender -b --factory-startup -t 4 -P tools/blender/<sheet>.py -- [frame ...]
#
# The board, as js/render.js draws it, and the frames that match it:
#
#   - One grid square is one Blender unit. Game +x is Blender +Y and game +y
#     is Blender +X, so a block's face toward game +y (the one render.js fills
#     with its `left` colour) faces Blender +X, and its face toward game +x
#     (`right`) faces Blender +Y. Up is +Z, and the floor is z = 0.
#   - The camera looks down at 30 degrees and along the board's diagonal, so a
#     square comes out as a diamond exactly twice as wide as it is tall: the
#     2:1 projection of isoX/isoY.
#   - A frame is drawn at TW = 112 pixels a square (render.js's largest `tw`,
#     56, on a 2x screen). A height of `ht` pixels in render.js at tw 56 is
#     2 * ht frame pixels, and HT_UNIT world units per render.js pixel.
#   - Every frame is TW + 2 * pad wide. Its anchor is where the square's
#     centre on the floor lands, and the frame is tall enough above it for the
#     solid's height plus its headroom (frame_box below; validate.mjs computes
#     the same box and holds the frame to it).
#
# The light (#794). render.js fills a block's top, left and right faces with
# three flat colours, and the sheets keep that look: no lamp, but an emission
# shader that weights the three colours by the surface normal, w = max(n, 0)^2
# per axis, so a face square to an axis comes out at exactly that colour and a
# bevel or a curve blends between them. A face turned away from all three
# (a mortar line's underside) falls toward SHADE times the left colour.
# Ambient occlusion over a short distance darkens the crevices. The figure
# sheet's heir is rendered the same way with the three colours replaced by
# pure red, green and blue: the mask the game tints with the build's palette.

import json
import math
import os
import random
import subprocess
import sys
import zlib

import bpy
import bmesh
from mathutils import Euler, Vector

REQUIRED = (5, 2)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# The render. Cycles with a fixed seed, a fixed sample count, adaptive
# sampling off and no denoiser is byte-stable from one run to the next on one
# machine (Signal City's finding, #721, and checked again here with cmp).
# Every surface is emission, so the samples only settle the edges and the
# occlusion.
SAMPLES = 64
SEED = 0

TW = 112                                   # frame pixels across one square
ELEV = math.radians(30)                    # sin(30) = 1/2: the 2:1 diamond
PPU = TW / math.sqrt(2)                    # frame pixels per world unit, across
HT_UNIT = 2 / (math.cos(ELEV) * PPU)       # world units per render.js pixel of height

# The light rig as numbers, so the style sheet can name them.
SHADE = 0.45          # a face turned away from all three axes: this much of `left`
AO_DISTANCE = 0.12    # world units: about a fifth of a figure's height
AO_FLOOR = 0.55       # what full occlusion leaves of a colour


def check_version():
    have = tuple(bpy.app.version[:2])
    if have != REQUIRED:
        print(f'common.py: this pipeline is pinned to Blender {REQUIRED[0]}.{REQUIRED[1]}, '
              f'and this is Blender {bpy.app.version_string}. Rerun the sheets under the new '
              f'version, check `git status --porcelain` stays empty, then move REQUIRED.')
        sys.exit(1)


def args():
    """Whatever follows `--` on the command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def rng(seed):
    """The only randomness a sheet may use: seeded, and passed down."""
    return random.Random(seed)


def budget():
    with open(os.path.join(HERE, 'budget.json'), encoding='utf8') as f:
        return json.load(f)


def spec():
    """PALETTE and SOLIDS, read out of js/render.js by spec.mjs, so the colours
    and the boxes have one home and it is the game's."""
    out = subprocess.run(['node', os.path.join(HERE, 'spec.mjs')], capture_output=True,
                         text=True, check=True)
    return json.loads(out.stdout)


def frame_box(item, solids, pad):
    """A frame's size and anchor in frame pixels, from its budget entry:
    TW + 2 * pad across, and tall enough for the solid's height plus its
    headroom over the square's diamond. validate.mjs has the same function."""
    ht, fp = box_of(item, solids)
    rise = 2 * (ht + item.get('headroom', 0))
    w = TW + 2 * pad
    h = TW // 2 + rise + 2 * pad
    return w, h, w / 2, pad + rise + TW // 4


def box_of(item, solids):
    """The box an item replaces: a SOLIDS entry by name, or its own ht and fp."""
    if 'solid' in item:
        s = solids[item['solid']]
        return s['ht'], s['fp']
    return item.get('ht', 0), item.get('fp', 1)


# ---------------------------------------------------------------- colour

def rgb(hexv):
    h = hexv.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def linear(hexv):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGB."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(ch(c) for c in rgb(hexv))


MASK = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

# A thing PALETTE gives one colour (the stairs, the gold) takes its two side
# faces from that colour at render.js's own wall ratios, wallLeft / wallTop
# and wallRight / wallTop to the nearest hundredth, rather than from a new hex
# (#795).
LEFT_OF, RIGHT_OF = 0.61, 0.76


def tone(hexv, k):
    """A palette hex with every sRGB channel times k, rounded."""
    return '#' + ''.join(f'{min(255, round(c * k)):02x}' for c in rgb(hexv))


def sides_of(hexv):
    """A single PALETTE colour as top, left and right (#795)."""
    return hexv, tone(hexv, LEFT_OF), tone(hexv, RIGHT_OF)


# ---------------------------------------------------------------- the scene

def reset():
    """An empty scene from factory settings with the render and the camera
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
    scene.cycles.max_bounces = 0          # emission only: nothing to bounce
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

    cam_data = bpy.data.cameras.new('iso')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.1
    cam_data.clip_end = 60.0
    cam = bpy.data.objects.new('iso', cam_data)
    scene.collection.objects.link(cam)
    # Down 30 degrees from level (x 60 from straight down), turned so it looks
    # from Blender's +X +Y corner toward -X -Y: game +x runs right and down
    # the image, game +y left and down, as isoX/isoY have them.
    cam.rotation_euler = Euler((math.pi / 2 - ELEV, 0.0, math.radians(135)), 'XYZ')
    scene.camera = cam

    world = bpy.data.worlds.new('none')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    return scene


def aim(scene, w, h, ax, ay):
    """Put the camera so the floor's origin lands on frame pixel (ax, ay) of a
    w x h frame, TW pixels a square."""
    cam = scene.camera
    cam.data.ortho_scale = w / PPU
    rot = cam.rotation_euler.to_matrix()
    right, up, back = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, 1))
    dx, dy = ax - w / 2, ay - h / 2          # where the origin sits from the centre, y down
    cam.location = back * 30.0 - right * (dx / PPU) + up * (dy / PPU)


def clear():
    """Everything a frame built, gone, so the next frame starts from the same
    empty set of datablocks (and names) whatever came before it."""
    for ob in list(bpy.data.objects):
        if ob.name != 'iso':
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for block in list(coll):
            coll.remove(block)


# ---------------------------------------------------------------- materials

def face_mat(name, top, left, right):
    """The three-face light (#794): emission of top, left and right (linear
    RGB triples) weighted by the normal's +Z, +X and +Y, squared; what is left
    of the weight goes to SHADE times `left`; then ambient occlusion."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])

    def weight(axis):
        mx = nt.nodes.new('ShaderNodeMath')
        mx.operation = 'MAXIMUM'
        mx.inputs[1].default_value = 0.0
        nt.links.new(sep.outputs[axis], mx.inputs[0])
        sq = nt.nodes.new('ShaderNodeMath')
        sq.operation = 'MULTIPLY'
        nt.links.new(mx.outputs[0], sq.inputs[0])
        nt.links.new(mx.outputs[0], sq.inputs[1])
        return sq.outputs[0]

    def scaled(w, colour):
        sc = nt.nodes.new('ShaderNodeVectorMath')
        sc.operation = 'SCALE'
        sc.inputs[0].default_value = colour
        nt.links.new(w, sc.inputs['Scale'])
        return sc.outputs[0]

    def add(a, b):
        ad = nt.nodes.new('ShaderNodeVectorMath')
        ad.operation = 'ADD'
        nt.links.new(a, ad.inputs[0])
        nt.links.new(b, ad.inputs[1])
        return ad.outputs[0]

    wz, wx, wy = weight('Z'), weight('X'), weight('Y')
    total = nt.nodes.new('ShaderNodeMath')
    total.operation = 'ADD'
    nt.links.new(wz, total.inputs[0])
    nt.links.new(wx, total.inputs[1])
    total2 = nt.nodes.new('ShaderNodeMath')
    total2.operation = 'ADD'
    nt.links.new(total.outputs[0], total2.inputs[0])
    nt.links.new(wy, total2.inputs[1])
    rest = nt.nodes.new('ShaderNodeMath')
    rest.operation = 'SUBTRACT'
    rest.use_clamp = True
    rest.inputs[0].default_value = 1.0
    nt.links.new(total2.outputs[0], rest.inputs[1])

    colour = add(add(scaled(wz, top), scaled(wx, left)), add(scaled(wy, right),
                 scaled(rest.outputs[0], tuple(c * SHADE for c in left))))

    ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
    ao.samples = 16
    ao.inputs['Distance'].default_value = AO_DISTANCE
    ao.only_local = False
    occl = nt.nodes.new('ShaderNodeMapRange')
    occl.inputs['From Min'].default_value = 0.0
    occl.inputs['From Max'].default_value = 1.0
    occl.inputs['To Min'].default_value = AO_FLOOR
    occl.inputs['To Max'].default_value = 1.0
    nt.links.new(ao.outputs['AO'], occl.inputs['Value'])
    lit = nt.nodes.new('ShaderNodeVectorMath')
    lit.operation = 'SCALE'
    nt.links.new(colour, lit.inputs[0])
    nt.links.new(occl.outputs['Result'], lit.inputs['Scale'])

    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(lit.outputs[0], em.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def holdout_mat(name):
    """A surface that hides whatever is behind it and leaves the film
    transparent: the earth in front of a stairwell, which the board's own
    floor in front of the square will draw."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    hold = nt.nodes.new('ShaderNodeHoldout')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(hold.outputs['Holdout'], out.inputs['Surface'])
    return mat


def palette_mat(name, top, left, right):
    """face_mat from three palette hexes."""
    return face_mat(name, linear(top), linear(left), linear(right))


def mask_mat(name):
    """face_mat with pure red, green and blue for top, left and right: the
    heir, to be tinted at draw time with a build's palette."""
    return face_mat(name, *MASK)


# ---------------------------------------------------------------- geometry

def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    Golden Hour's, from d93690d, by way of Signal City's common.py."""
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


def box(name, x0, y0, z0, x1, y1, z1, mat, bevel=0.0):
    """An axis-aligned block, its edges bevelled by `bevel` world units (one
    segment, so a bevel is one blended band between two faces)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1,
                        affect='EDGES', profile=0.5)
    return mesh_object(name, bm, mat)


def prism_n(name, cx, cy, z0, z1, r0, r1, sides, mat, smooth=True, turn=0.0):
    """A frustum standing on (cx, cy): radius r0 at z0, r1 at z1, `sides`
    sides, capped. Smooth-shaded, so a column or a body reads round."""
    bm = bmesh.new()
    lo, hi = [], []
    for k in range(sides):
        a = turn + 2 * math.pi * k / sides
        lo.append(bm.verts.new((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z0)))
        hi.append(bm.verts.new((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z1)))
    bm.faces.new(lo[::-1])
    top = bm.faces.new(hi)
    for k in range(sides):
        f = bm.faces.new([lo[k], lo[(k + 1) % sides], hi[(k + 1) % sides], hi[k]])
        f.smooth = smooth
    top.smooth = False
    return mesh_object(name, bm, mat)


def sphere(name, cx, cy, cz, rx, ry, rz, mat, segments=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((cx + v.co.x * rx, cy + v.co.y * ry, cz + v.co.z * rz))
    for f in bm.faces:
        f.smooth = True
    return mesh_object(name, bm, mat)


def diamond_floor(name, mat, inset=0.0, z=0.0, grow=0.004):
    """The floor square as a flat top at z, grown by `grow` so neighbouring
    squares overlap by a hair and no seam of transparency opens between them,
    or shrunk by `inset`."""
    h = 0.5 + grow - inset
    return box(name, -h, -h, z - 0.02, h, h, z, mat)


def triangles(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ---------------------------------------------------------------- frames

def render_frame(scene, w, h, ax, ay, path):
    """Render what is in the scene into a w x h frame with the floor's origin
    at (ax, ay), and return its RGBA bytes, top row first."""
    r = scene.render
    r.resolution_x, r.resolution_y = w, h
    aim(scene, w, h, ax, ay)
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


def write_sheet(frames, anchors, width, png_rel, atlas_rel, pad):
    """Pack `frames` ({name: (w, h, rows)}) into one sheet `width` pixels wide,
    and write the PNG and its atlas under the project. The atlas is
    { "sheet": { w, h, tw, pad }, "frames": { name: { x, y, w, h, ax, ay } } },
    the anchor in frame pixels."""
    at, height = pack({n: (f[0], f[1]) for n, f in frames.items()}, width)
    sheet = [bytearray(width * 4) for _ in range(height)]
    atlas = {}
    for n in sorted(frames):
        w, h, rows = frames[n]
        x, y = at[n]
        for j, row in enumerate(rows):
            sheet[y + j][x * 4:(x + w) * 4] = row
        ax, ay = anchors[n]
        atlas[n] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax, 'ay': ay}
    write_png(os.path.join(PROJECT, png_rel), width, height, [bytes(r) for r in sheet])
    doc = {'sheet': {'w': width, 'h': height, 'tw': TW, 'pad': pad}, 'frames': atlas}
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


def run_sheet(sheet_name, builders, tint=None):
    """The main() every sheet script shares. `builders` is {frame: fn(spec)},
    each fn building one frame's objects. With frame names after `--`, render
    only those into out/ and write nothing the game loads."""
    check_version()
    sp = spec()
    bd = budget()
    pad = bd['pad']
    sheet = bd['sheets'][sheet_name]
    items = sheet['frames']
    missing = sorted(set(items) ^ set(builders))
    if missing:
        raise SystemExit(f'{sheet_name}: budget.json and the builders disagree on {missing}')
    only = args()
    names = only or sorted(items)
    scene = reset()
    frames, anchors = {}, {}
    os.makedirs(OUT, exist_ok=True)
    for n in names:
        clear()
        builders[n](sp)
        tris = sum(triangles(ob) for ob in bpy.data.objects if ob.type == 'MESH')
        cap = sheet['maxTriangles']
        if tris > cap:
            raise SystemExit(f'{sheet_name}: {n} is {tris} triangles, over the cap of {cap}')
        w, h, ax, ay = frame_box(items[n], sp['SOLIDS'], pad)
        path = os.path.join(OUT, f'{sheet_name}-{n.replace("/", "-")}.png')
        frames[n] = render_frame(scene, w, h, ax, ay, path)
        anchors[n] = (ax, ay)
        print(f'{sheet_name}.py: {n} {w} x {h}, {tris} triangles')
    if only:
        return
    w, h, px = write_sheet(frames, anchors, sheet['width'], sheet['png'], sheet['atlas'], pad)
    print(f'{sheet_name}.py: contact sheet {contact_sheet(sheet_name, w, h, px)}')
