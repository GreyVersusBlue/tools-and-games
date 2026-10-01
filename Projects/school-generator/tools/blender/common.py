# School Generator's Blender pipeline: the one place its export settings live.
#
# School Generator's own copy of the pipeline shape Golden Hour, Blue Hour and
# Bell to Bell share (#643): nothing here is imported from another project, and
# a change to one is not a change to the other. What this folder makes is the
# built-in model pack, .glb files in assets/models/ that js/gltf.js reads.
#
# WHAT IT WRITES IS WHAT js/gltf.js READS, AND NOTHING ELSE. TRIANGLES
# primitives with POSITION, NORMAL and COLOR_0, one material whose base colour
# is white, no image, no sampler, no skin, no animation, no camera, no light
# and no extension. gltf.js refuses each of those it does not read, or drops
# them quietly, and a prop that arrives half-read is worse than one that
# refuses to arrive. validate.mjs fails on any of them in a file, so the
# exporter's defaults cannot drift in under a Blender update unseen.
#
# Pinned to the Blender this pipeline was built and checked under:
#   Blender 5.2.2 LTS, on huginn (Linux, ~/.local/bin/blender). Devon's
#   Windows install is the same version. A minor bump will stop every script
#   here at check_version() until someone reruns the pack, checks that
#   `git status --porcelain` stays empty, and moves REQUIRED.
#
# Run from Projects/school-generator, headless, never through a GUI session:
#   blender -b --factory-startup -P tools/blender/models.py -- [item ...]
# --factory-startup keeps the machine's preferences and add-ons out, and reset()
# empties the scene again before anything is built. One Blender at a time.
#
# The frame. The page's prop builders (js/render.js) work in feet, y up, the
# prop's front toward +z, its base on y = 0, and its centre on x = 0, z = 0.
# Every helper here takes those same numbers in feet (so a part is written at
# the page's own coordinates) and puts them in Blender's frame: x stays x, the
# page's y is Blender's Z, and the page's z is Blender's -Y, which is the
# rotation the exporter's +Y up undoes, so the file comes out with the front
# toward +Z. Units leave as metres: finish() scales feet by UNIT. gltf.js
# normalizes a model into its catalog row's box anyway, so the scale only has
# to be honest.

import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

REQUIRED = (5, 2)
UNIT = 0.3048                      # metres per foot

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

with open(os.path.join(HERE, 'budget.json'), encoding='utf8') as _f:
    BUDGET = json.load(_f)

# page (x, y up, z front) -> Blender (x, -z, y up): a rotation, so winding holds
PAGE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
# Blender's cone and cylinder run along Z; the page's run along Y
AXIS_Y = Euler((-math.pi / 2, 0, 0)).to_matrix().to_4x4()


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
    """A palette hex (sRGB, as budget.json writes it) to Blender's linear RGBA.
    js/render.js hands three.js the same hex and three.js converts it the same
    way, so the vertex colour the page would have drawn is the one written."""
    if isinstance(hexv, str):
        hexv = int(hexv.lstrip('#'), 16)

    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (ch((hexv >> 16) & 255), ch((hexv >> 8) & 255), ch(hexv & 255), 1.0)


def material():
    """The one material every file carries: white base colour, so the vertex
    colours gltf.js multiplies it by come through unchanged, and nothing
    wired to an image."""
    mat = bpy.data.materials.new('prop')
    mat.use_nodes = True
    mat.use_backface_culling = True            # the page's propMat is front-face only
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.78   # render.js's propMat
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


class Builder:
    """One prop, built from primitives in the page's own feet and coordinates.
    Each primitive takes a colour (a hex string from budget.json's palette for
    the item); finish() scales to metres, writes the colours as one vertex
    colour attribute and returns the object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.colours = {}          # face -> linear rgba

    def _paint(self, verts, colour, smooth=False):
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            self.colours[f] = linear(colour)
            f.smooth = smooth

    @staticmethod
    def _matrix(x, y, z, rx=0.0, ry=0.0, rz=0.0):
        # three.js rotates about X, then Z, then Y in boxT; every part here
        # needs at most one axis at a time, so XYZ order is the same thing.
        rot = Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        return PAGE_TO_BLENDER @ Matrix.Translation((x, y, z)) @ rot

    def box(self, w, h, d, x, y, z, colour, rx=0.0, ry=0.0, rz=0.0):
        m = self._matrix(x, y, z, rx, ry, rz) @ Matrix.Diagonal((w, h, d, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)['verts']
        self._paint(verts, colour)

    def cyl(self, rt, rb, h, segs, x, y, z, colour, rx=0.0, rz=0.0):
        m = self._matrix(x, y, z, rx, 0.0, rz) @ AXIS_Y
        verts = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs,
                                      radius1=rb, radius2=rt, depth=h, matrix=m,
                                      calc_uvs=False)['verts']
        self._paint(verts, colour)

    def sph(self, r, x, y, z, colour, segs=10):
        """A UV sphere written here rather than by bmesh.ops.create_uvsphere,
        whose vertices come out differently from one run to the next and so
        would make every file that has one byte-unstable (#652)."""
        rings = max(5, segs // 2)
        bm = self.bm

        def at(rad, h, a):
            p = PAGE_TO_BLENDER @ Vector((x + rad * math.sin(a), y + h, z + rad * math.cos(a), 1.0))
            return bm.verts.new(p.xyz)
        top, bottom = at(0, r, 0), at(0, -r, 0)
        ring = []
        for k in range(1, rings):
            phi = math.pi * k / rings
            ring.append([at(r * math.sin(phi), r * math.cos(phi), 2 * math.pi * i / segs) for i in range(segs)])
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((top, ring[0][i], ring[0][j]))
            for a_, b_ in zip(ring, ring[1:]):
                bm.faces.new((a_[i], b_[i], b_[j], a_[j]))
            bm.faces.new((bottom, ring[-1][j], ring[-1][i]))
        self._paint([top, bottom] + [v for rg in ring for v in rg], colour)

    def lathe(self, profile, x, y, z, colour, segs=12):
        """A surface of revolution about the page's Y axis from a [radius,
        height] profile, bottom to top, open at both ends like three's
        LatheGeometry."""
        rings = []
        for r, h in profile:
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                p = PAGE_TO_BLENDER @ Vector((x + r * math.sin(a), y + h, z + r * math.cos(a), 1.0))
                ring.append(self.bm.verts.new(p.xyz))
            rings.append(ring)
        made = [v for ring in rings for v in ring]
        for a, b in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                self.bm.faces.new((a[i], a[j], b[j], b[i]))
        self.bm.verts.ensure_lookup_table()
        self._paint(made, colour)

    def finish(self):
        bm = self.bm
        bmesh.ops.scale(bm, vec=(UNIT, UNIT, UNIT), verts=bm.verts)
        layer = bm.loops.layers.float_color.new('Col')   # linear floats; a byte layer is read as sRGB
        for f, rgba in self.colours.items():
            for loop in f.loops:
                loop[layer] = rgba
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        mesh.color_attributes.render_color_index = mesh.color_attributes.find('Col')
        mesh.materials.append(bpy.data.materials.get('prop') or material())
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def triangles(obj):
    """What a file will carry: every polygon fanned to triangles."""
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def dims(obj):
    """(min, max) corners of the object's box in metres, page axes (x, y up,
    z front), for the log line a run prints."""
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.z for p in pts), min(-p.y for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.z for p in pts), max(-p.y for p in pts)))
    return lo, hi


def export_glb(obj, rel):
    """Write obj to PROJECT/rel as a .glb with the settings gltf.js reads."""
    path = os.path.join(PROJECT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
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
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_image_format='NONE',
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


def contact_sheet(objs, path, cols=5, size=(1600, 1000)):
    """One fixed camera over the whole pack, laid out in a grid on a floor,
    drawn in Workbench with the vertex colours. A picture to look at, written
    to tools/blender/out/ and kept out of git (#645); nothing reads it."""
    scene = bpy.context.scene
    gap = 2.6
    rows = math.ceil(len(objs) / cols)
    for i, obj in enumerate(objs):
        obj.location = ((i % cols - (cols - 1) / 2) * gap, ((rows - 1) / 2 - i // cols) * gap, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = cols * gap * 1.02
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.location = Vector((0, -rows * gap * 1.25, rows * gap * 1.3 + 4))
    cam.rotation_euler = (Vector((0, 0, 0.6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.16, 0.17, 0.19)
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'VERTEX'
    scene.render.image_settings.file_format = 'PNG'
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
