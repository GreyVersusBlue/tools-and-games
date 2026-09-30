# Orbital's Blender pipeline: the one place its render settings live.
#
# Orbital's own copy of Aphelion's tools/blender/common.py as it stood at
# commit db06e5f (#643), cut down to what a 2D game needs and given a sprite
# renderer in place of the glTF export. Nothing here is imported from the other
# project, and a change to one is not a change to the other. It is the first 2D
# pipeline in the repo: the common plan names Signal City's renderer as the
# source for every 2D copy, and Signal City's row had not shipped when this was
# written (BACKLOG.md "Blender assets: the common plan", "Orbital: Blender
# assets" B1), so this is the one the later copies start from.
#
# What Orbital draws today (js/render.js): every body is a disc of gradients on
# a 2D canvas, in a colour from its COLOR table, with a glowCircle behind it.
# This pipeline renders one frame per body type, the body and nothing around
# it: no glow, since the game keeps drawing that itself, over the frame once
# the wiring row lands (B3). The frames are packed into one PNG with a JSON
# atlas beside it, in the common plan's shape, plus one field:
#
#   { "<type>": { "x", "y", "w", "h", "ax", "ay", "r" } }
#
# x, y, w, h are the frame's box in the sheet, ax, ay the anchor in frame
# pixels (the body's centre), and r is the body's radius in frame pixels, so
# the game draws a body of radius R world units at view scale s as the frame
# scaled by (R * s) / r about the anchor. A frame is drawn with the game's
# `spin` and `flow` at 0 and the booster's `dir` at 0 (its chevrons point +x);
# the wiring row rotates the frame where the game rotates the drawing.
#
# How the sheet is rendered: one scene, every body built at one Blender unit
# per frame pixel in its own cell of a grid, one orthographic camera straight
# down over the whole grid, a transparent film, Workbench with studio lighting
# and material colour, 8-sample anti-aliasing, the Standard view transform so
# a palette hex comes out as itself. Workbench and not EEVEE because a rerun
# has to be byte-stable (the common plan's done line): Workbench rasterizes the
# same scene to the same pixels every time, and it has no sampler to seed.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS, the Steam install on Devon's machine,
#   C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe
# Steam updates that install on its own, so a minor bump will stop every script
# here at check_version() until someone reruns the pack, checks that
# `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/orbital, headless, never through a GUI session:
#   blender -b --factory-startup -P tools/blender/bodies.py
# --factory-startup keeps the machine's preferences and add-ons out, and reset()
# empties the scene again before anything is built.

import json
import math
import os
import random
import re
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

REQUIRED = (5, 2)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# The style sheet's fixed numbers (BACKLOG.md "Orbital: Blender assets" B1).
# FRAME is the side of every frame in pixels; a body's outermost drawn extent
# fills the frame to EXTENT, leaving a margin nothing may cross, so a frame
# scaled and rotated in the game never shows a neighbour's edge. COLS is the
# grid's width in frames; the sheet is COLS wide and as tall as the pack needs.
FRAME = 256
EXTENT = 120
COLS = 4

# The studio light turned so its key sits up and to the left of the frame,
# where render.js puts every gradient's highlight (its centre offset is
# (-0.3 R, -0.3 R) on the canvas: left and up). Degrees about the camera axis:
# unturned, the Default studio light's key lit every ball from the lower
# right, at 180 from the upper right, and 90 puts it upper left. EXPOSURE
# lifts the render two stops: under the Default light a ball's
# mean colour came out at about half its material's sRGB value (the planet's
# #63d8ff rendered to a mean of #366273), and two stops puts the mean back on
# the palette hex with the key side clipping toward the gradient's light stop,
# which is how render.js shades it.
STUDIO_ROTATE = 90.0
EXPOSURE = 2.0


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


def reset():
    """An empty scene from factory settings."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def rng(seed):
    """The only randomness a pack may use: seeded, and passed down."""
    return random.Random(seed)


def linear(hexv, alpha=1.0):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255), alpha)


# ---------------------------------------------------------------- palette

def palette():
    """COLOR from js/render.js, read as text: {type: hex int}. The game is the
    source of these, so a pack never copies a number out of it by hand.
    validate.mjs reads the table with the same pattern."""
    with open(os.path.join(PROJECT, 'js', 'render.js'), encoding='utf-8') as f:
        src = f.read()
    table = re.search(r'^const COLOR = \{(.*?)\};', src, re.S | re.M)
    return {m.group(1): int(m.group(2), 16)
            for m in re.finditer(r'(\w+):\s*"#([0-9a-fA-F]{6})"', table.group(1))}


def material(name, hexv, alpha=1.0, roughness=0.55):
    """A Workbench material: `diffuse_color` is what MATERIAL colour renders,
    so the hex lands on the film as itself under the Standard view transform.
    An alpha under 1 renders blended."""
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = linear(hexv, alpha)
    mat.roughness = roughness
    mat.metallic = 0.0
    if alpha < 1.0:
        mat.surface_render_method = 'BLENDED'
        if hasattr(mat, 'blend_method'):
            mat.blend_method = 'BLEND'
    return mat


# ---------------------------------------------------------------- geometry
# One Blender unit is one frame pixel. The camera looks down -Z, so +X is the
# frame's right and +Y is the frame's up (the canvas's -y).

def _slot(verts, slot, smooth):
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = slot
        f.smooth = smooth
    return faces


def sphere(bm, r, centre=(0, 0, 0), slot=0, segments=64, rings=32):
    """A smooth ball, which the top-down camera sees as a shaded disc. `r` is
    a radius, or an (x, y, z) triple of them for a squashed one."""
    s = (r, r, r) if isinstance(r, (int, float)) else tuple(r)
    m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*s, 1.0))
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings,
                                      radius=1.0, matrix=m, calc_uvs=False)['verts']
    return _slot(verts, slot, True)


def ellipse_ring(bm, rx, ry, width, a0=0.0, a1=math.tau, z=0.0, centre=(0, 0), slot=0,
                 segments=128):
    """A stroke of constant `width` along an ellipse of semi-axes rx, ry, from
    angle a0 to a1: ctx.ellipse() stroked. Each edge is the ellipse's point
    pushed along its outward normal by half the width, so the stroke stays as
    wide at the ends of the long axis as at the short one."""
    n = max(3, int(round(segments * abs(a1 - a0) / math.tau)))
    closed = abs(abs(a1 - a0) - math.tau) < 1e-9
    steps = n if closed else n + 1
    inner, outer = [], []
    for i in range(steps):
        a = a0 + (a1 - a0) * i / n
        p = Vector((rx * math.cos(a), ry * math.sin(a)))
        nrm = Vector((ry * math.cos(a), rx * math.sin(a))).normalized() * (width / 2)
        inner.append(bm.verts.new((centre[0] + p.x - nrm.x, centre[1] + p.y - nrm.y, z)))
        outer.append(bm.verts.new((centre[0] + p.x + nrm.x, centre[1] + p.y + nrm.y, z)))
    faces = []
    for i in range(n):
        j = (i + 1) % steps
        f = bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
        f.material_index = slot
        f.smooth = False
        faces.append(f)
    return faces


def bumpy_sphere(bm, r, rnd, amount=0.12, centre=(0, 0, 0), slot=0, subdiv=3):
    """An icosphere with every vertex pushed in or out along its radius by a
    seeded amount, flat-shaded: a rock. The mean radius stays r. The vertices
    are visited in position order so the same seed moves the same vertex."""
    m = Matrix.Translation(Vector(centre))
    verts = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r, matrix=m,
                                       calc_uvs=False)['verts']
    c = Vector(centre)
    for v in sorted(verts, key=lambda v: (round(v.co.z, 4), round(v.co.y, 4), round(v.co.x, 4))):
        d = v.co - c
        v.co = c + d * (1 + rnd.uniform(-amount, amount))
    return _slot(verts, slot, False)


def disc(bm, r, z=0.0, centre=(0, 0), slot=0, segments=96):
    """A flat filled circle facing the camera."""
    m = Matrix.Translation(Vector((centre[0], centre[1], z)))
    verts = bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=True, radius=r,
                                    segments=segments, matrix=m, calc_uvs=False)['verts']
    return _slot(verts, slot, False)


def annulus(bm, ri, ro, a0=0.0, a1=math.tau, z=0.0, centre=(0, 0), slot=0,
            segments=96, scale=(1.0, 1.0)):
    """A flat ring, or an arc of one from angle a0 to a1, between radii ri and
    ro, optionally squashed into an ellipse by `scale`. This is how a canvas
    stroke of an arc lands in the frame: ri and ro are the stroke's inner and
    outer edge. Angles run counter-clockwise as seen by the camera."""
    n = max(3, int(round(segments * (a1 - a0) / math.tau)))
    closed = abs((a1 - a0) - math.tau) < 1e-9
    steps = n if closed else n + 1
    inner, outer = [], []
    for i in range(steps):
        a = a0 + (a1 - a0) * i / n
        cx, cy = math.cos(a) * scale[0], math.sin(a) * scale[1]
        inner.append(bm.verts.new((centre[0] + cx * ri, centre[1] + cy * ri, z)))
        outer.append(bm.verts.new((centre[0] + cx * ro, centre[1] + cy * ro, z)))
    faces = []
    for i in range(n):
        j = (i + 1) % steps
        f = bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
        f.material_index = slot
        f.smooth = False
        faces.append(f)
    return faces


def dashed_ring(bm, r, width, dash, gap, z=0.0, centre=(0, 0), slot=0, phase=0.0):
    """A ring of dashes, as ctx.setLineDash([dash, gap]) strokes an arc of
    radius r: the dash and gap are lengths along the circumference, and the
    pattern starts at angle `phase`. Rounded to a whole number of periods so
    the ring closes on itself."""
    period = dash + gap
    count = max(1, int(round(math.tau * r / period)))
    step = math.tau / count
    on = step * dash / period
    for k in range(count):
        a0 = phase + k * step
        annulus(bm, r - width / 2, r + width / 2, a0, a0 + on, z, centre, slot, segments=96)


def stroke(bm, points, width, z=0.0, slot=0):
    """A polyline as flat quads, one per segment, `width` across, with the
    joints closed by a disc of the stroke's half width: ctx.lineTo with a round
    join and butt caps."""
    pts = [Vector((x, y)) for x, y in points]
    for a, b in zip(pts, pts[1:]):
        d = b - a
        if d.length < 1e-9:
            continue
        nrm = Vector((-d.y, d.x)).normalized() * (width / 2)
        vs = [bm.verts.new((p.x, p.y, z)) for p in (a + nrm, b + nrm, b - nrm, a - nrm)]
        f = bm.faces.new(vs)
        f.material_index = slot
        f.smooth = False
    for p in pts[1:-1]:
        disc(bm, width / 2, z, (p.x, p.y), slot, segments=16)


def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    Blender's primitives do not come out in a stable order, so without this a
    rerun could build the same triangles in a different order. It matters less
    for a raster than for a .glb, but a flat quad's diagonal and a smooth
    normal's neighbours both depend on order, so every pack keeps it. Vertices
    sorted by position, each face's loop started at its lowest vertex (winding
    kept), faces sorted by material then vertices; each face keeps its smooth
    flag."""
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


def mesh_object(name, bm, materials, location=(0, 0, 0)):
    """An object from a bmesh, each face keeping its own smooth flag."""
    bm = canonical(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = location
    return ob


# ---------------------------------------------------------------- the sheet

def grid(count):
    """Sheet size in pixels for `count` frames on a COLS-wide grid."""
    rows = max(1, math.ceil(count / COLS))
    return COLS * FRAME, rows * FRAME


def cell(index, count):
    """Where frame `index` sits: (atlas x, atlas y) in sheet pixels from the
    top-left, and the Blender (x, y) of its centre, with the sheet centred on
    the origin and +Y up."""
    w, h = grid(count)
    col, row = index % COLS, index // COLS
    ax, ay = col * FRAME, row * FRAME
    bx = ax + FRAME / 2 - w / 2
    by = h / 2 - (ay + FRAME / 2)
    return ax, ay, bx, by


def _camera(w, h, z=2000.0):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('sheet')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(w, h)
    cam_data.sensor_fit = 'AUTO'
    cam_data.clip_start = 1.0
    cam_data.clip_end = z * 2
    cam = bpy.data.objects.new('sheet', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.0, 0.0, z)
    cam.rotation_euler = (0.0, 0.0, 0.0)      # straight down -Z; +Y is up in the frame
    scene.camera = cam
    return cam


def _workbench(w, h, transparent):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_specular_highlight = True
    sh.show_shadows = False
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_backface_culling = False
    sh.use_world_space_lighting = True
    sh.studiolight_rotate_z = math.radians(STUDIO_ROTATE)
    scene.display.render_aa = '8'
    scene.render.film_transparent = transparent
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.dither_intensity = 0.0
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = EXPOSURE
    scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 90
    scene.render.use_file_extension = True
    scene.render.image_settings.color_management = 'FOLLOW_SCENE'
    # No metadata in the file. With the defaults, Blender writes its stamp
    # into the PNG as tEXt chunks, and two of them (Date and RenderTime)
    # change every run: three renders with identical pixels hashed three ways
    # before these were turned off (the common plan's byte-stable rerun).
    for flag in ('use_stamp_date', 'use_stamp_time', 'use_stamp_render_time',
                 'use_stamp_frame', 'use_stamp_frame_range', 'use_stamp_memory',
                 'use_stamp_hostname', 'use_stamp_camera', 'use_stamp_lens',
                 'use_stamp_scene', 'use_stamp_marker', 'use_stamp_filename',
                 'use_stamp_sequencer_strip', 'use_stamp_note'):
        if hasattr(scene.render, flag):
            setattr(scene.render, flag, False)
    scene.render.use_stamp = False


def render_sheet(frames, rel_png, rel_json):
    """Render the scene as the sheet at PROJECT/rel_png and write the atlas at
    PROJECT/rel_json. `frames` is [(name, ax, ay, r)] in pack order, the
    anchor in frame pixels. Returns the two absolute paths."""
    w, h = grid(len(frames))
    _camera(w, h)
    _workbench(w, h, transparent=True)
    png = os.path.join(PROJECT, rel_png)
    os.makedirs(os.path.dirname(png), exist_ok=True)
    bpy.context.scene.render.filepath = png
    bpy.ops.render.render(write_still=True)

    atlas = {}
    for i, (name, ax, ay, r) in enumerate(frames):
        x, y, _, _ = cell(i, len(frames))
        atlas[name] = {'x': x, 'y': y, 'w': FRAME, 'h': FRAME, 'ax': ax, 'ay': ay, 'r': r}
    js = os.path.join(PROJECT, rel_json)
    with open(js, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(atlas, f, indent=2, sort_keys=True)
        f.write('\n')
    return png, js


def contact_sheet(name, background=0x0B0F22):
    """The same scene again, with the film opaque over the game's own night
    blue (drawBg's middle stop), to tools/blender/out/<name>.png (gitignored,
    #645). It is for looking at; no check reads it."""
    scene = bpy.context.scene
    w, h = scene.render.resolution_x, scene.render.resolution_y
    _workbench(w, h, transparent=False)
    if not scene.world:
        scene.world = bpy.data.worlds.new('sheet')
    scene.world.color = linear(background)[:3]
    scene.display.shading.background_type = 'WORLD'
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath
