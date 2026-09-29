# Bell to Bell's Blender pipeline: the one place its export settings live.
#
# Bell to Bell's own copy of Aphelion's tools/blender/common.py as it stood at
# commit b63cd05 (#643): nothing here is imported from the other project, and a
# change to one is not a change to the other. What differs from Aphelion's, and
# why (WISHLIST.md "Blender assets" B1):
#   - it writes glTF Separate (a .gltf, a .bin, and any texture beside them)
#     into Assets/models/blender/, not a .glb. That is what the meshopt recipe
#     in Tools/board-check/asset-pipeline.mjs reads out of git, and the recipe
#     writes the .glb the game loads beside it (#619, #624; B3).
#   - the game loads a model's own materials (src/world/models.js loadStatic),
#     so the file is where a prop's colour lives. Every material is named for
#     an entry of budget.json's palette and carries that colour: the game's
#     PALETTE in src/world/materials.js, and the four colours of the Kenney
#     furniture it stands beside. Nothing reads a key at load; the thermal
#     twin is registerModel()'s, one flat colour a prop.
#   - a material may carry a texture, written as a loose image beside the
#     .gltf, as the Poly Haven props are; budget.json caps its size.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS (hash d13f752e3b9c), the Steam install on Devon's machine,
#   C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe
# Steam updates that install on its own, so a minor bump will stop every script
# here at check_version() until someone reruns the pack, checks that
# `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/bell-to-bell, headless, never through a GUI session:
#   blender -b --factory-startup -P tools/blender/<pack>.py -- [item ...]
# --factory-startup keeps the machine's preferences and add-ons out, and reset()
# empties the scene again before anything is built (BACKLOG.md "Blender assets:
# the common plan").
#
# Conventions every pack keeps (validate.mjs checks the ones a file can show):
# glTF Separate, metres, +Y up, transforms applied, no Draco and no meshopt in
# what this writes (the recipe adds meshopt), origin at the centre of the
# piece's base so y = 0 is the floor it stands on, built at the size the room
# gives what it replaces, front to +Z in the file, which is Blender's -Y. A wall
# piece faces +Z and takes its wall's turn.

import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

REQUIRED = (5, 2)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

with open(os.path.join(HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)


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


def linear(hexv):
    """A palette hex (sRGB, as the game writes it) to Blender's linear RGBA."""
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255), 1.0)


# ---------------------------------------------------------------- materials

def material(name, roughness=0.85, metalness=0.0):
    """A material named for a palette entry in budget.json, carrying its
    colour. Roughness and metalness default to what createMaterials() gives the
    room's own surfaces (0.85, and 0 for anything but metal). An entry in
    budget.json's `opacity` (glass, 0.75, as createMaterials() makes it) is
    written as that alpha, blended; every other material is opaque."""
    pal = BUDGET['palette']
    if name not in pal:
        print(f'common.py: "{name}" is not in budget.json\'s palette; '
              f'the entries are {", ".join(sorted(pal))}.')
        sys.exit(1)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = linear(int(pal[name], 16))
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metalness
    alpha = BUDGET.get('opacity', {}).get(name, 1.0)
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    mat.diffuse_color = linear(int(pal[name], 16))
    return mat


# ---------------------------------------------------------------- geometry

def box(bm, size, centre, slot=0):
    """An axis-aligned box, size (x, y, z) in Blender's frame (x across, y to
    the back, which is the file's -Z, z up), centred on `centre`, in material
    slot `slot`."""
    m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*size, 1.0))
    verts = bmesh.ops.create_cube(bm, size=1.0, matrix=m, calc_uvs=False)['verts']
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = slot
    return faces


def cylinder(bm, r1, r2, depth, centre, segments=8, slot=0):
    """A capped cylinder or cone standing on Blender z, radius r1 at the bottom
    and r2 at the top, the way CylinderGeometry(r2, r1, h) stands in three."""
    m = Matrix.Translation(Vector(centre))
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                  radius1=r1, radius2=r2, depth=depth, matrix=m,
                                  calc_uvs=False)['verts']
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = slot
    return faces


def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).
    Blender's primitives do not come out in a stable order, so without this a
    rerun could write the same triangles in a different order. Vertices sorted
    by position, each face's loop started at its lowest vertex (winding kept),
    faces sorted by material then vertices; each face keeps its smooth flag."""
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


def mesh_object(name, bm, materials, parent=None, location=(0, 0, 0), smooth=False):
    """An object from a bmesh, with its transforms already applied. Flat-shaded
    unless smooth=True, which keeps each face's own smooth flag."""
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
    """Move the piece so its origin is the centre of its base: x and z (Blender
    x and y) centred, the lowest point on y = 0 (Blender z = 0). Checked by
    validate.mjs to 1 cm. The box is the vertices', not each object's
    bound_box corners, which swing past a rotated node's geometry (#674)."""
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


# ---------------------------------------------------------------- output

def export_gltf(root, rel):
    """Write root and its children to PROJECT/rel as glTF Separate: rel is the
    .gltf, and the exporter writes its .bin (and any image) beside it. Returns
    the absolute paths written, the .gltf first."""
    path = os.path.join(PROJECT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in tree(root):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLTF_SEPARATE',
        export_texture_dir='',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='NONE',
        export_image_format='AUTO',
        export_draco_mesh_compression_enable=False,
        export_meshopt_compression_enable=False,
        export_use_gltfpack=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_copyright='',
    )
    return [path, os.path.splitext(path)[0] + '.bin']


def retire(root, tag):
    """Rename an exported piece's objects, meshes and materials out of the way,
    so the next piece can use the same names (two props can both be `metal`).
    Blender would otherwise export the second one as `metal.001`, which is in
    no palette, and a file's names would depend on what else was built in the
    same run."""
    for ob in tree(root):
        if ob.type == 'MESH':
            for m in ob.data.materials:
                if not m.name.startswith('~'):
                    m.name = f'~{tag}.{m.name}'
            ob.data.name = f'~{tag}.{ob.data.name}'
        ob.name = f'~{tag}.{ob.name}'


def contact_sheet(roots, name, tile=192):
    """Every piece in a row under one fixed camera, rendered with Workbench to
    tools/blender/out/<name>.png (gitignored, #645), coloured by material. It
    is for looking at; no check reads it. Each piece is scaled to fill its
    tile, since a pack holds a 6 m whiteboard and a stapler; the files are
    already written by then."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    for r in roots:
        pts = [ob.matrix_world @ v.co for ob in tree(r) if ob.type == 'MESH'
               for v in ob.data.vertices]
        span = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
        r.scale = (0.75 / span,) * 3        # room for the three-quarter turn
        r.rotation_euler.z = math.radians(-40)   # three-quarters from the front (-Y)
    bpy.context.view_layer.update()
    step = 1.15
    for i, r in enumerate(roots):
        r.location.x += (i - (len(roots) - 1) / 2) * step   # the camera looks +Y: first on the left

    cam_data = bpy.data.cameras.new('sheet')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = step * len(roots)
    cam = bpy.data.objects.new('sheet', cam_data)
    scene.collection.objects.link(cam)
    tilt = math.radians(25)
    cam.rotation_euler = (math.pi / 2 - tilt, 0.0, 0.0)
    cam.location = (0.0, -20 * math.cos(tilt), 20 * math.sin(tilt) + step * 0.2)
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
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath
