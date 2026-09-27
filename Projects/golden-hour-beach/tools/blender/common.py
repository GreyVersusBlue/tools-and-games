# Golden Hour's Blender pipeline: the one place its export settings live.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS (hash d13f752e3b9c), the Steam install on Devon's machine,
#   C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe
# Steam updates that install on its own, so a minor bump will stop every script
# here at check_version() until someone reruns the pack, checks that
# `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/golden-hour-beach, headless, never through a GUI session:
#   blender -b --factory-startup -P tools/blender/<pack>.py -- [item ...]
# --factory-startup keeps the machine's preferences and add-ons out, and reset()
# empties the scene again before anything is built (BACKLOG.md "Blender assets:
# the common plan").
#
# Conventions every pack keeps (validate.mjs checks the ones a file can show):
# glTF binary, metres, +Y up, transforms applied, no Draco and no meshopt (the
# project vendors neither decoder), origin at the centre of the asset's base so
# y = 0 is the ground it stands on, flat materials with no texture unless
# budget.json names a cap, colours from budget.json's palette only, clips at
# 30 fps named for what the game calls the motion.

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
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')


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
    """An empty scene from factory settings, at the pipeline's frame rate."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    return scene


def rng(seed):
    """The only randomness a pack may use: seeded, and passed down."""
    return random.Random(seed)


def linear(hexv):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255), 1.0)


def material(name, hexv, unlit=False, double_sided=False, roughness=0.85):
    """A flat material. unlit=True exports as KHR_materials_unlit, which is how
    the game's MeshBasicMaterial things (the gull, the bats) read."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    mat.diffuse_color = linear(hexv)            # what the contact sheet shows
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


def paint(bm, verts, slot):
    """Give every face touching `verts` material slot `slot`."""
    vs = set(verts)
    for f in bm.faces:
        if any(v in vs for v in f.verts):
            f.material_index = slot


def canonical(bm):
    """The same mesh, in an order that depends only on its geometry.

    Blender's own primitives do not come out in a stable order:
    bmesh.ops.create_uvsphere gave four face orders in four runs of one script
    under 5.2.2, so the exporter wrote the same triangles in a different order
    and the .glb changed on every run. Rebuilding with vertices sorted by
    position, each face's loop started at its lowest vertex (winding kept), and
    faces sorted by material then vertices, makes a rerun byte-stable."""
    verts = sorted(bm.verts, key=lambda v: (v.co.z, v.co.y, v.co.x))
    index = {v: i for i, v in enumerate(verts)}
    faces = []
    for f in bm.faces:
        ids = [index[v] for v in f.verts]
        k = ids.index(min(ids))
        faces.append((f.material_index, ids[k:] + ids[:k]))
    faces.sort()
    out = bmesh.new()
    nv = [out.verts.new(v.co) for v in verts]
    for mat, ids in faces:
        out.faces.new([nv[i] for i in ids]).material_index = mat
    bm.free()
    return out


def mesh_object(name, bm, materials, parent=None, location=(0, 0, 0)):
    """A flat-shaded object from a bmesh, with its transforms already applied."""
    bm = canonical(bm)
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


def ground(root):
    """Move the asset so its origin is the centre of its base: x and z (Blender
    x and y) centred, the lowest point on y = 0 (Blender z = 0). Checked by
    validate.mjs to 1 cm."""
    bpy.context.view_layer.update()
    pts = [ob.matrix_world @ Vector(c) for ob in tree(root) if ob.type == 'MESH'
           for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    root.data.transform(Matrix.Translation(shift))
    for c in root.children:
        c.location += shift
    bpy.context.view_layer.update()
    return hi - lo


def clip(name, obj, frames, key):
    """A looping clip on one object, keyed on every frame (30 fps) so the
    exported samples are exactly the curve. key(obj, t) poses obj for t in
    [0, 1]; frame `frames` must pose the same as frame 0 for the loop to close.
    Every object's track shares `name`, and the exporter merges tracks of one
    name into one glTF animation."""
    obj.animation_data_create()
    act = bpy.data.actions.new(f'{name}.{obj.name}')
    obj.animation_data.action = act
    for f in range(frames + 1):
        key(obj, f / frames)
        obj.keyframe_insert('rotation_euler', frame=f)
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    return act


# ---------------------------------------------------------------- output

def export_glb(root, rel):
    """Write root and its children to PROJECT/rel as a .glb, with the settings
    this project loads. Returns the absolute path."""
    path = os.path.join(PROJECT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in tree(root):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='MATERIAL',
        export_image_format='NONE',
        export_draco_mesh_compression_enable=False,
        export_meshopt_compression_enable=False,
        export_use_gltfpack=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=False,
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_morph=False,
        export_copyright='',
    )
    return path


def contact_sheet(roots, name, tile=192):
    """Every item in a row under one fixed camera, rendered with Workbench to
    tools/blender/out/<name>.png (gitignored, #645). It is for looking at; no
    check reads it."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    spans = []
    for r in roots:
        pts = [ob.matrix_world @ Vector(c) for ob in tree(r) if ob.type == 'MESH'
               for c in ob.bound_box]
        spans.append(max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)))
    step = max(spans) * 1.15
    for i, r in enumerate(roots):
        r.location.x += (i - (len(roots) - 1) / 2) * step

    cam_data = bpy.data.cameras.new('sheet')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = step * len(roots)
    cam = bpy.data.objects.new('sheet', cam_data)
    scene.collection.objects.link(cam)
    # From the front (+Y is forward), 25 degrees down, looking at the row.
    tilt = math.radians(25)
    cam.rotation_euler = (math.pi / 2 - tilt, 0.0, math.pi)
    cam.location = (0.0, 20 * math.cos(tilt), 20 * math.sin(tilt) + step * 0.2)
    scene.camera = cam

    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.render_aa = 'OFF'
    scene.render.film_transparent = True
    scene.render.resolution_x = tile * len(roots)
    scene.render.resolution_y = tile
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, f'{name}.png')
    scene.frame_set(0)
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath
