# The Fourth Quarter's Blender pipeline: the one place its export settings live.
#
# The Fourth Quarter's own copy of Blue Hour's tools/blender/common.py as it
# stood at commit 0038881 (#643): nothing here is imported from the other
# project, and a change to one is not a change to the other. What differs from
# Blue Hour's, and why (WISHLIST.md "Blender assets" B1):
#   - colour is vertex colour, not a material colour. What js/world.js paints
#     with flat(0x...) is a COLOR_0 attribute on a white material named
#     `flat-<what>`, which three r160's GLTFLoader reads as a MeshStandardMaterial
#     with vertexColors on, the same thing flat() makes.
#   - a material named for a key of MATS (js/textures.js: barTop, metal,
#     leather and the rest) is a slot the game fills with its own tiered mat() at
#     load. Faces wearing one carry UVs, box-projected so each side of the
#     piece's box spans 0 to 1 the way BoxGeometry's does, since that is what
#     the texture repeats in MATS were tuned against. No image is ever written.
#   - no unlit, no clips, no skins: nothing in the bar moves on its own.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS (hash d13f752e3b9c), the Steam install on Devon's machine,
#   C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe
# Steam updates that install on its own, so a minor bump will stop every script
# here at check_version() until someone reruns the pack, checks that
# `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/fourth-quarter, headless, never through a GUI session:
#   blender -b --factory-startup -P tools/blender/<pack>.py -- [item ...]
# --factory-startup keeps the machine's preferences and add-ons out, and reset()
# empties the scene again before anything is built (BACKLOG.md "Blender assets:
# the common plan").
#
# Conventions every pack keeps (validate.mjs checks the ones a file can show):
# glTF binary, metres, +Y up, transforms applied, no Draco and no meshopt (the
# project vendors neither decoder), origin at the centre of the piece's base so
# y = 0 is the floor it stands on, built at the size the description gives it
# (the Corner Tap's, which every room shares for the fit-out), front to +Z in
# the file, which is Blender's -Y. +Z is glTF's own front and it is the side a
# fit-out block at rotY 0 shows the room in js/world.js (the stove's burners,
# the counter's customer face), so the wiring row applies f.rotY as it is.

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

FLAT = 'flat-'      # the prefix of every vertex-coloured material's name
HEX = 'hex'         # the face layer a pack paints into; mesh_object() turns it into COLOR_0


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

def mats():
    """MATS from js/textures.js, read as text: {key: (colour, rough, metal)}.
    The game is the source of these, so a pack never copies a number out of
    it by hand."""
    with open(os.path.join(PROJECT, 'js', 'textures.js'), encoding='utf-8') as f:
        src = f.read()
    out = {}
    for m in re.finditer(r'^  (\w+): \{(.*?)^  \},', src, re.S | re.M):
        body = m.group(2)
        colour = re.search(r'color: 0x([0-9a-fA-F]{6})', body)
        if not colour:
            continue
        rough = re.search(r'rough: ([0-9.]+)', body)
        metal = re.search(r'metal: ([0-9.]+)', body)
        out[m.group(1)] = (int(colour.group(1), 16),
                           float(rough.group(1)) if rough else 0.8,
                           float(metal.group(1)) if metal else 0.0)
    return out


def _principled(name, rough, metal):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat, bsdf


def keyed(key):
    """A slot for the game's own mat(key). The name is the key, the colour,
    roughness and metalness are MATS's placeholder values, so a file opened
    anywhere else still looks like the room before its textures arrive."""
    table = mats()
    if key not in table:
        print(f'common.py: "{key}" is not a key of MATS in js/textures.js; '
              f'the keys are {", ".join(sorted(table))}.')
        sys.exit(1)
    hexv, rough, metal = table[key]
    mat, bsdf = _principled(key, rough, metal)
    bsdf.inputs['Base Color'].default_value = linear(hexv)
    mat.diffuse_color = linear(hexv)
    mat['fq_hex'] = hexv
    return mat


def flat(what, rough=0.85, metal=0.0):
    """What world.js's flat(colour, rough, metal) makes: white, with the colour
    in the vertices. `what` names the material (flat-<what>); two flat()
    calls with different roughness or metalness need two names."""
    mat, bsdf = _principled(FLAT + what, rough, metal)
    attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Color'
    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# ---------------------------------------------------------------- geometry
#
# Every helper paints the faces it makes: material slot `slot`, and colour
# `hexv` into the HEX face layer. A keyed slot's faces take the MATS colour, so
# the contact sheet shows them. The exporter writes COLOR_0 for a mesh whose
# material reads it (export_vertex_color='MATERIAL'), and then for every
# primitive of that mesh, which is why mesh_object() keeps keyed and flat-
# materials on separate objects.

def new_bmesh():
    bm = bmesh.new()
    bm.faces.layers.int.new(HEX)
    return bm


def _paint(bm, faces, slot, hexv):
    layer = bm.faces.layers.int[HEX]
    for f in faces:
        f.material_index = slot
        f[layer] = hexv


def box(bm, size, centre, slot=0, hexv=0xffffff):
    """An axis-aligned box, size (x, y, z) in Blender's frame (x across, y to
    the back, which is the file's -Z, z up), centred on `centre`."""
    m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*size, 1.0))
    verts = bmesh.ops.create_cube(bm, size=1.0, matrix=m, calc_uvs=False)['verts']
    faces = list({f for v in verts for f in v.link_faces})
    _paint(bm, faces, slot, hexv)
    return faces


def cylinder(bm, r1, r2, depth, centre, segments=8, slot=0, hexv=0xffffff):
    """A capped cylinder or cone standing on Blender z, radius r1 at the bottom
    and r2 at the top, the way CylinderGeometry(r2, r1, h) stands in three."""
    m = Matrix.Translation(Vector(centre))
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                  radius1=r1, radius2=r2, depth=depth, matrix=m,
                                  calc_uvs=False)['verts']
    faces = list({f for v in verts for f in v.link_faces})
    _paint(bm, faces, slot, hexv)
    return faces


def box_uv(bm, lo, hi):
    """UVs by box projection onto the piece's own box (lo, hi corners in
    Blender's frame): each face is projected along its normal's largest axis
    and each side of the box spans 0 to 1, as a BoxGeometry of that size does.
    Only a piece that wears a keyed material needs this."""
    uv = bm.loops.layers.uv.verify()
    span = [max(hi[i] - lo[i], 1e-6) for i in range(3)]
    for f in bm.faces:
        n = f.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co[a] - lo[a]) / span[a], (co[b] - lo[b]) / span[b])


def canonical(bm):
    """The same mesh, in an order that depends only on its geometry (#652).

    Blender's own primitives do not come out in a stable order (Golden Hour's
    uvsphere gave four face orders in four runs under 5.2.2), so the exporter
    wrote the same triangles in a different order and the .glb changed on every
    run. Rebuilding with vertices sorted by position, each face's loop started
    at its lowest vertex (winding kept), and faces sorted by material then
    vertices, makes a rerun byte-stable. Each face keeps its smooth flag, its
    HEX colour and, where the mesh has them, its UVs; none of those takes part
    in the order."""
    verts = sorted(bm.verts, key=lambda v: (v.co.z, v.co.y, v.co.x))
    index = {v: i for i, v in enumerate(verts)}
    uv = bm.loops.layers.uv.active
    hexl = bm.faces.layers.int.get(HEX)
    faces = []
    for f in bm.faces:
        ids = [index[v] for v in f.verts]
        k = ids.index(min(ids))
        uvs = [tuple(l[uv].uv) for l in f.loops] if uv else None
        faces.append((f.material_index, ids[k:] + ids[:k], f.smooth,
                      uvs[k:] + uvs[:k] if uvs else None,
                      f[hexl] if hexl else 0xffffff))
    faces.sort(key=lambda t: (t[0], t[1]))
    out = bmesh.new()
    out_uv = out.loops.layers.uv.new('UVMap') if uv else None
    out_hex = out.faces.layers.int.new(HEX)
    nv = [out.verts.new(v.co) for v in verts]
    for mat, ids, smooth, uvs, hexv in faces:
        f = out.faces.new([nv[i] for i in ids])
        f.material_index = mat
        f.smooth = smooth
        f[out_hex] = hexv
        if uvs:
            for l, c in zip(f.loops, uvs):
                l[out_uv].uv = c
    bm.free()
    return out


def mesh_object(name, bm, materials, parent=None, location=(0, 0, 0), smooth=False):
    """An object from a bmesh, with its transforms already applied, and its HEX
    face layer turned into a per-corner colour attribute named `Color` (linear
    float, which the exporter writes as COLOR_0 for the flat- materials).
    Flat-shaded unless smooth=True, which keeps each face's own smooth flag.

    One object's materials are all flat- or all keyed, never both: the
    exporter writes COLOR_0 on every primitive of a mesh once any material
    reads it, so a keyed slot sharing a mesh with a flat one came out with a
    white vertex colour it has no use for (a scratch stool, leather top and
    flat leg, failed validate.mjs's "carries no vertex colour" on exactly
    that). A piece with both is two objects, one parented to the other."""
    kinds = {m.name.startswith(FLAT) for m in materials}
    if len(kinds) > 1:
        print(f'common.py: {name} mixes flat- and keyed materials '
              f'({", ".join(m.name for m in materials)}); build them as two objects.')
        sys.exit(1)
    bm = canonical(bm)
    if not smooth:
        for f in bm.faces:
            f.smooth = False
    hexl = bm.faces.layers.int[HEX]
    colours = [f[hexl] for f in bm.faces]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if HEX in me.attributes:
        me.attributes.remove(me.attributes[HEX])
    col = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    for poly, hexv in zip(me.polygons, colours):
        c = linear(hexv)
        for li in poly.loop_indices:
            col.data[li].color = c
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
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

def export_glb(root, rel):
    """Write root and its children to PROJECT/rel as a .glb, with the settings
    this project loads. Returns the absolute path. UVs go out only where a mesh
    has them (a piece wearing a keyed material); images never do, since no
    material is given one."""
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
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        # Not 'NONE': under 5.2.2 that also stops the exporter looking through
        # Base Color for a colour attribute (io_scene_gltf2's
        # pbr_metallic_roughness.py, __gather_base_color_factor), and every
        # flat- material came out 0.8 grey with no COLOR_0. No material here
        # holds an image, so 'AUTO' writes none; validate.mjs fails any image.
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
    return path


def retire(root, tag):
    """Rename an exported piece's objects, meshes and materials out of the way,
    so the next piece can use the same names (every stove's body is `body`,
    every keyed slot `metal`). Blender would otherwise export the second one as
    `metal.001`, which is no key of MATS, and a file's names would depend on
    what else was built in the same run."""
    for ob in tree(root):
        if ob.type == 'MESH':
            for m in ob.data.materials:
                if not m.name.startswith('~'):
                    m.name = f'~{tag}.{m.name}'
            ob.data.name = f'~{tag}.{ob.data.name}'
        ob.name = f'~{tag}.{ob.name}'


def contact_sheet(roots, name, tile=192):
    """Every piece in a row under one fixed camera, rendered with Workbench to
    tools/blender/out/<name>.png (gitignored, #645), coloured by the `Color`
    attribute, which holds the flat colours and the keyed slots' placeholders
    alike. It is for looking at; no check reads it. Each piece is scaled to fill
    its tile, since a pack holds a 2.4 m prep table and a 32 cm bottle; the
    files are already written by then."""
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
    # From the front (-Y, the file's +Z), 25 degrees down, looking at the row.
    tilt = math.radians(25)
    cam.rotation_euler = (math.pi / 2 - tilt, 0.0, 0.0)
    cam.location = (0.0, -20 * math.cos(tilt), 20 * math.sin(tilt) + step * 0.2)
    scene.camera = cam

    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
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
