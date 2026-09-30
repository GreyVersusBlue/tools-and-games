# The site's Blender pipeline: the one place its render settings live.
#
# The site's own copy of Golden Hour's common.py (#643: each area keeps its
# own, nothing is shared across projects), taken at PR #476's main and with
# the .glb output section replaced by a renderer. What this folder makes is
# images, not models: the tavern set behind the Guild Board (BACKLOG.md "The
# site itself: the tavern set") and, later, D1's dioramas.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS. It was written against the Steam install on Devon's
#   Windows machine and calibrated there; the committed room plate
#   (assets/tavern/room.webp) was rendered on huginn, Linux, Blender 5.2.2
#   LTS at ~/.local/bin/blender, Cycles on the CPU with 4 threads.
# A lit render's bytes differ between machines, so every plate in one pack
# comes from one machine: re-render them all together, on one of the two.
# A minor bump of either install stops every script here at check_version()
# until someone reruns the renders, looks at them, and moves REQUIRED.
#
# Run from Tools/board-check, headless, never through a GUI session, and on
# huginn one render at a time across the whole machine with 4 threads
# (run.mjs waits for any other Blender to finish and passes -t for you):
#   blender -b --factory-startup -t 4 -P blender/<script>.py -- [args]
# --factory-startup keeps the machine's preferences and add-ons out, and
# reset() empties the scene again before anything is built.
#
# The room frame. index.html's <tavern-scene> draws in a fixed 1600 by 900
# space, y down, with the floor seam at y 618 and the hearth centred on x 330.
# Everything here is built in that frame: rx() and rz() turn a room x and a
# room y into Blender metres (budget.json's `unit` per room unit), with the
# back wall on the plane Y = 0 and the floor running toward the camera at
# negative Y. room_camera() builds the one camera that puts the wall plane on
# the render 1:1, so a thing built at paintRoom()'s numbers lands where
# paintRoom() drew it. calibrate.py proves that; validate.mjs --rendered
# reads its markers back.

import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

REQUIRED = (5, 2)
FPS = 30

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'out')

with open(os.path.join(HERE, 'budget.json'), encoding='utf8') as _f:
    BUDGET = json.load(_f)
UNIT = BUDGET['unit']
ROOM = BUDGET['room']
FLOOR = ROOM['floor']


def check_version():
    have = tuple(bpy.app.version[:2])
    if have != REQUIRED:
        print(f'common.py: this pipeline is pinned to Blender {REQUIRED[0]}.{REQUIRED[1]}, '
              f'and this is Blender {bpy.app.version_string}. Rerun the renders under the new '
              f'version, look at them, then move REQUIRED.')
        sys.exit(1)


def args():
    """Whatever follows `--` on the command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset():
    """An empty scene from factory settings, at the pipeline's frame rate."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    return scene


def rng(seed):
    """The only randomness a script may use: seeded, and passed down."""
    return random.Random(seed)


def linear(hexv):
    """A palette hex (sRGB, as the page writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255), 1.0)


def material(name, hexv, unlit=False, double_sided=False, roughness=0.85, alpha=1.0, image=None):
    """A flat material. unlit=True is a Background shader with no lighting,
    the flat colour Golden Hour used for its MeshBasicMaterial things; here it
    is what a calibration marker and a silhouette sheet are made of."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    mat.diffuse_color = linear(hexv)            # what Workbench shows
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    if unlit:
        bg = nodes.new('ShaderNodeBackground')
        bg.inputs['Color'].default_value = linear(hexv)
        links.new(bg.outputs['Background'], out.inputs['Surface'])
    else:
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Base Color'].default_value = linear(hexv)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = 0.0
        if alpha < 1.0:
            bsdf.inputs['Alpha'].default_value = alpha
            mat.surface_render_method = 'BLENDED'
        if image is not None:
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = image
            tex.interpolation = 'Linear'
            links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------- geometry

def sphere(bm, radii, centre, segments=8, rings=5):
    m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*radii, 1.0))
    return bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings,
                                     radius=1.0, matrix=m, calc_uvs=False)['verts']


def cone(bm, r1, r2, depth, matrix, segments=6):
    return bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                 radius1=r1, radius2=r2, depth=depth, matrix=matrix,
                                 calc_uvs=False)['verts']


def limb(bm, a, b, r1, r2, segments=4):
    """A tapered rod from point a (radius r1) to point b (radius r2)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    turn = Vector((0.0, 0.0, 1.0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    return cone(bm, r1, r2, d.length, Matrix.Translation((a + b) / 2) @ turn, segments)


def box(bm, lo, hi):
    """An axis-aligned box from two opposite corners, in metres, with UVs."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    m = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ \
        Matrix.Diagonal(((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 1.0))
    return bmesh.ops.create_cube(bm, size=2.0, matrix=m, calc_uvs=True)['verts']


def solid(bm, points, faces):
    """A closed shape from its corners and faces, normals turned to face out."""
    vs = [bm.verts.new(p) for p in points]
    made = [bm.faces.new([vs[i] for i in f]) for f in faces]
    bmesh.ops.recalc_face_normals(bm, faces=made)
    return vs


def sheet(bm, points, faces, side=1):
    """An open shape one face thick, mirrored across x when side is -1."""
    vs = [bm.verts.new((x * side, y, z)) for x, y, z in points]
    for f in faces:
        bm.faces.new([vs[i] for i in (f if side > 0 else reversed(f))])
    return vs


def paint(bm, verts, slot):
    """Give every face touching `verts` material slot `slot`."""
    vs = set(verts)
    for f in bm.faces:
        if any(v in vs for v in f.verts):
            f.material_index = slot


def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    A render does not care about face order, but a sheet rendered with
    Workbench is expected to come back on one hash, and this is half of why."""
    verts = sorted(bm.verts, key=lambda v: (v.co.z, v.co.y, v.co.x))
    index = {v: i for i, v in enumerate(verts)}
    uv = bm.loops.layers.uv.active
    faces = []
    for f in bm.faces:
        ids = [index[v] for v in f.verts]
        k = ids.index(min(ids))
        uvs = [tuple(l[uv].uv) for l in f.loops] if uv else None
        faces.append((f.material_index, ids[k:] + ids[:k], f.smooth,
                      uvs[k:] + uvs[:k] if uvs else None))
    faces.sort(key=lambda t: (t[0], t[1]))
    out = bmesh.new()
    out_uv = out.loops.layers.uv.new('UVMap') if uv else None
    nv = [out.verts.new(v.co) for v in verts]
    for mat, ids, smooth, uvs in faces:
        f = out.faces.new([nv[i] for i in ids])
        f.material_index = mat
        f.smooth = smooth
        if uvs:
            for l, c in zip(f.loops, uvs):
                l[out_uv].uv = c
    bm.free()
    return out


def mesh_object(name, bm, materials, parent=None, location=(0, 0, 0), smooth=False):
    """An object from a bmesh, with its transforms already applied."""
    bm = canonical(bm)
    if not smooth:
        for f in bm.faces:
            f.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = location
    return ob


def tree(root):
    out = [root]
    for c in root.children:
        out += tree(c)
    return out


# ---------------------------------------------------------------- the room frame

def rx(x):
    """Room x (0..1600, left to right) to Blender X in metres."""
    return x * UNIT


def rz(y):
    """Room y (down the canvas) to Blender Z (up), the floor seam at Z = 0."""
    return (FLOOR - y) * UNIT


def depth_for(y, cam=None):
    """The Blender Y (0 at the wall, negative toward the camera) of a floor
    point that the level camera projects to room y. From the horizon h and
    the camera's height above the floor: y - h = (FLOOR - h) * D / (Y + D)."""
    cam = cam or BUDGET['camera']
    h, D = cam['horizon'], cam['distance']
    return (FLOOR - h) * D / (y - h) - D


def scale_at(y, cam=None):
    """How many room units a wall-scale unit covers at the depth that projects
    to room y: 1 at the wall, more as things come toward the camera. A
    tabletop drawn 92 units across at y 720 is 92 / scale_at(720) wall units
    wide in the world."""
    cam = cam or BUDGET['camera']
    D = cam['distance']
    return D / (depth_for(y, cam) + D)


def at_depth(x, y, Y, cam=None):
    """The world point (X, Y, Z) at depth Y (metres: 0 at the wall, negative
    toward the camera) that the room camera projects to room (x, y). A thing
    that stands off the wall is built through this, so it lands where
    paintRoom() drew it rather than where its wall-plane numbers would."""
    cam = cam or BUDGET['camera']
    D = cam['distance']
    k = (Y + D) / D
    return (rx(cam['eye_x'] + (x - cam['eye_x']) * k), Y, rz(cam['horizon'] + (y - cam['horizon']) * k))


def room_camera(scene, cam=None):
    """The one camera. Level (verticals stay vertical), at room x eye_x, its
    optical axis at room y `horizon`, `distance` metres back from the wall
    plane Y = 0, with the lens and shift chosen so the frame's w by h room
    units of wall land on a w by h render exactly. Its sign conventions are
    what calibrate.py checks."""
    cam = cam or BUDGET['camera']
    fx, fy, fw, fh = cam['frame']
    D = cam['distance']
    data = bpy.data.cameras.new('room')
    data.sensor_fit = 'HORIZONTAL'
    data.sensor_width = 36.0
    data.lens = 36.0 * D / (fw * UNIT)
    data.shift_x = (fx + fw / 2 - cam['eye_x']) / fw
    data.shift_y = -((fy + fh / 2) - cam['horizon']) / fw
    data.clip_start = 0.05
    data.clip_end = 200.0
    ob = bpy.data.objects.new('room', data)
    scene.collection.objects.link(ob)
    ob.location = (rx(cam['eye_x']), -D, rz(cam['horizon']))
    ob.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.camera = ob
    ob['frame_aspect'] = fw / fh              # render() keeps this shape at any size
    scene.render.resolution_x = fw
    scene.render.resolution_y = fh
    return ob


# ---------------------------------------------------------------- output

def use_gpu():
    """Cycles on the best device the machine has: OptiX, then CUDA, then the
    CPU. --factory-startup forgets the preference, so every run sets it."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'NONE'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type != 'CPU']
        if kind == 'NONE' or gpus:
            for d in prefs.devices:
                d.use = True if kind == 'NONE' else d.type != 'CPU'
            bpy.context.scene.cycles.device = 'CPU' if kind == 'NONE' else 'GPU'
            return kind
    return 'NONE'


def render(path, width=None, height=None, engine='CYCLES', samples=256, seed=0,
           transparent=False, fmt='PNG', quality=80, percent=100, view='Standard', border=None, aa='OFF'):
    """Render the scene through its camera to `path` (absolute), at width by
    height pixels (the camera's own size when omitted), and return the path.
    Cycles renders on the GPU at a fixed seed with denoising; Workbench is
    flat colour with no anti-aliasing unless `aa` says otherwise ('8' is
    eight samples), for calibration frames and silhouette
    sheets that must come back the same every run. fmt is PNG or WEBP
    (lossy at `quality`, lossless at 100). border is (x0, y0, x1, y1) as fractions
    of the full render from its top left, and crops the file to that window:
    the tables are cut out of a plate-sized frame this way, at the plate's own
    pixels.

    A width by height that is not the camera's own shape keeps the camera's
    frame and stretches the pixels instead: the room plate is 3200 by 1800
    over a 2000 by 1300 frame, so its pixels are 1.156 times taller than wide
    and the page draws it back onto the 2000 by 1300 rect. Without this the
    horizontal-fit camera would crop the frame to 2000 by 1125."""
    scene = bpy.context.scene
    r = scene.render
    cam = scene.camera
    frame_aspect = cam['frame_aspect'] if cam and 'frame_aspect' in cam else r.resolution_x / r.resolution_y
    r.engine = engine
    if engine == 'CYCLES':
        scene.cycles.samples = samples
        scene.cycles.seed = seed
        scene.cycles.use_denoising = True
        scene.cycles.use_animated_seed = False
        use_gpu()
    elif engine == 'BLENDER_WORKBENCH':
        scene.display.shading.light = 'FLAT'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.render_aa = aa
    scene.view_settings.view_transform = view
    scene.view_settings.look = 'None'
    if width:
        r.resolution_x = width
    if height:
        r.resolution_y = height
    # (resolution_x * pixel_aspect_x) / (resolution_y * pixel_aspect_y) is the
    # view's shape; Blender wants both aspects at 1 or more
    stretch = (r.resolution_x / r.resolution_y) / frame_aspect
    r.pixel_aspect_x = 1.0 if stretch >= 1.0 else 1.0 / stretch
    r.pixel_aspect_y = stretch if stretch >= 1.0 else 1.0
    r.resolution_percentage = percent
    r.film_transparent = transparent
    r.use_border = border is not None
    r.use_crop_to_border = border is not None
    if border is not None:
        # Blender floors a border edge to a pixel, and 1 - f is a hair under a
        # whole pixel as often as over it, so each edge is nudged a hundredth
        # of a pixel up to land on the pixel the caller meant
        nx, ny = 0.01 / r.resolution_x, 0.01 / r.resolution_y
        r.border_min_x, r.border_max_x = border[0] + nx, border[2] + nx
        r.border_min_y, r.border_max_y = 1.0 - border[3] + ny, 1.0 - border[1] + ny
    r.image_settings.file_format = fmt
    r.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    if fmt == 'WEBP':
        r.image_settings.quality = quality
    elif fmt == 'PNG':
        r.image_settings.compression = 50
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r.filepath = path
    scene.frame_set(0)
    bpy.ops.render.render(write_still=True)
    return path
