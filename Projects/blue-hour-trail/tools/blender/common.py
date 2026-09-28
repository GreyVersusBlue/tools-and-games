# Blue Hour's Blender pipeline: the one place its export settings live.
#
# Blue Hour's own copy of Golden Hour's tools/blender/common.py as it stood at
# commit d93690d (#643): nothing here is imported from the other project, and
# a change to one is not a change to the other.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS (hash d13f752e3b9c), the Steam install on Devon's machine,
#   C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe
# Steam updates that install on its own, so a minor bump will stop every script
# here at check_version() until someone reruns the pack, checks that
# `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/blue-hour-trail, headless, never through a GUI session:
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
# 30 fps named for what the game calls the motion. What reads at the distances
# Blue Hour's fog allows is BACKLOG.md "Blue Hour: Blender assets" B1's call.

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


def material(name, hexv, unlit=False, double_sided=False, roughness=0.85, alpha=1.0, image=None):
    """A flat material. unlit=True exports as KHR_materials_unlit, which is how
    the game's MeshBasicMaterial things (the crow, the small birds) read. alpha under
    1 exports as alphaMode BLEND. image is a texture for the
    base colour, only on an item budget.json gives a texture cap (the sand
    dollar in Golden Hour, #654; Blue Hour has none); the factor is then
    white, which the palette check allows."""
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


def image(name, size, pixel):
    """A size x size texture from pixel(x, y) -> sRGB (r, g, b) in 0..1, y up,
    packed into the .blend so the exporter embeds it as a PNG."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    px = []
    for y in range(size):
        for x in range(size):
            px.extend((*pixel(x, y), 1.0))
    img.pixels.foreach_set(px)
    img.file_format = 'PNG'
    img.pack()
    return img


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
    """A tapered rod from point a (radius r1) to point b (radius r2): a leg, a
    neck, a bill."""
    a, b = Vector(a), Vector(b)
    d = b - a
    turn = Vector((0.0, 0.0, 1.0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    return cone(bm, r1, r2, d.length, Matrix.Translation((a + b) / 2) @ turn, segments)


def solid(bm, points, faces):
    """A closed shape from its corners and faces (a fin, a fluke, a flipper).
    The faces may be listed in either winding; their normals are turned to face
    out here."""
    vs = [bm.verts.new(p) for p in points]
    made = [bm.faces.new([vs[i] for i in f]) for f in faces]
    bmesh.ops.recalc_face_normals(bm, faces=made)
    return vs


def sheet(bm, points, faces, side=1):
    """An open shape one face thick (a wing), mirrored across x when side is -1
    with its winding flipped to match. Its material is double-sided."""
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
    """The same mesh, in an order that depends only on its geometry.

    Blender's own primitives do not come out in a stable order:
    bmesh.ops.create_uvsphere gave four face orders in four runs of one script
    under 5.2.2, so the exporter wrote the same triangles in a different order
    and the .glb changed on every run. Rebuilding with vertices sorted by
    position, each face's loop started at its lowest vertex (winding kept), and
    faces sorted by material then vertices, makes a rerun byte-stable. Each
    face keeps its smooth flag and, where the mesh has one, its UVs; neither
    takes part in the order, so a mesh without them sorts as it always did."""
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
    """An object from a bmesh, with its transforms already applied. Flat-shaded
    unless smooth=True, which keeps each face's own smooth flag as the pack set
    it: a rock is smooth all over, a post smooth round its sides with flat
    ends, the way three's primitives shade them in the builders."""
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


def ground(root):
    """Move the asset so its origin is the centre of its base: x and z (Blender
    x and y) centred, the lowest point on y = 0 (Blender z = 0). Checked by
    validate.mjs to 1 cm.

    The box is the vertices', not each object's bound_box corners: a node that
    rests rotated (the deer's head, down at 0.9 rad) swings its local box's
    corners well past its geometry, and centred the deer 3.9 cm off. For a node
    at no rotation the two are the same box, so every earlier file rebuilt
    byte-identical (#674)."""
    bpy.context.view_layer.update()
    pts = [ob.matrix_world @ v.co for ob in tree(root) if ob.type == 'MESH'
           for v in ob.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    root.data.transform(Matrix.Translation(shift))
    for c in root.children:
        c.location += shift
    bpy.context.view_layer.update()
    return hi - lo


def clip(name, obj, frames, key, paths=('rotation_euler',)):
    """A looping clip on one object, keyed on every frame (30 fps) so the
    exported samples are exactly the curve. key(obj, t) poses obj for t in
    [0, 1]; frame `frames` must pose the same as frame 0 for the loop to close,
    and frame 0 is the rest pose, since that is what the file's nodes carry.
    `paths` says what is keyed (rotation_euler, location, scale); a clip that
    keys location is made after ground(), which moves the children.
    Every object's track shares `name`, and the exporter merges tracks of one
    name into one glTF animation."""
    obj.animation_data_create()
    act = bpy.data.actions.new(f'{name}.{obj.name}')
    obj.animation_data.action = act
    for f in range(frames + 1):
        key(obj, f / frames)
        for p in paths:
            obj.keyframe_insert(p, frame=f)
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    return act


# ---------------------------------------------------------------- output

def export_glb(root, rel, textured=False):
    """Write root and its children to PROJECT/rel as a .glb, with the settings
    this project loads. Returns the absolute path. textured=True writes UVs
    and embeds the images as PNG; only an item with a texture cap in
    budget.json passes it, and every other file carries neither."""
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
        export_texcoords=textured,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='MATERIAL',
        export_image_format='AUTO' if textured else 'NONE',
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


def retire(root, tag):
    """Rename an exported item's objects, meshes, materials and actions out of
    the way, so the next item can use the same names (every wing is `wingR`,
    every head `head`). Blender would otherwise export the second one as
    `wingR.001`, and a file's node names would depend on what else was built in
    the same run."""
    for ob in tree(root):
        if ob.animation_data:
            for track in ob.animation_data.nla_tracks:
                for strip in track.strips:
                    strip.action.name = f'~{tag}.{strip.action.name}'
        if ob.type == 'MESH':
            for m in ob.data.materials:
                if not m.name.startswith('~'):
                    m.name = f'~{tag}.{m.name}'
            ob.data.name = f'~{tag}.{ob.data.name}'
        ob.name = f'~{tag}.{ob.name}'


def contact_sheet(roots, name, tile=192):
    """Every item in a row under one fixed camera, rendered with Workbench to
    tools/blender/out/<name>.png (gitignored, #645). It is for looking at; no
    check reads it. Each item is scaled to fill its tile, since a pack can hold
    a 3 m fire-tower cabin and a 10 cm mushroom; the files are already
    written by then."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    for r in roots:
        for ob in tree(r):              # the rest pose, not a clip's frame 0
            if ob.animation_data:
                ob.animation_data.use_nla = False
        pts = [ob.matrix_world @ Vector(c) for ob in tree(r) if ob.type == 'MESH'
               for c in ob.bound_box]
        span = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
        r.scale = (1 / span,) * 3
        r.rotation_euler.z = math.radians(40)    # three-quarters, so length shows
    bpy.context.view_layer.update()
    step = 1.15
    for i, r in enumerate(roots):
        r.location.x -= (i - (len(roots) - 1) / 2) * step   # the camera faces -Y: first on the left

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
