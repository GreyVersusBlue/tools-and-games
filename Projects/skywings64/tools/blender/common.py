# Shared helpers for SkyWings 64 hero-model export scripts.
# Import with: import sys; sys.path.insert(0, <this dir>); import common
import bpy, bmesh, math, os, random

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.node_groups):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)

def mat(name, color, rough=0.8, metal=0.0, emissive=None, alpha=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
        try:
            m.show_transparent_back = False
        except Exception:
            pass
    return m

# All scripts author geometry using a (x, y_up, z_depth) / (rx, ry_yaw, rz_depth) convention
# matching the target glTF/three.js space (Y up). Blender itself is Z-up natively, so every
# helper below remaps into real Blender coordinates: blender=(x, -z_depth, y_up) for positions,
# and (rx, -rz, ry) for Euler rotations (a rotation about "mine" Y/up becomes a rotation about
# Blender's Z, a rotation about "mine" Z/depth becomes a rotation about Blender's -Y). Blender's
# cylinder/cone primitives already extrude along their own local Z, which after this remap is
# exactly the "up" axis, so shapes stand upright with no further whole-object fix-up needed.
def _mloc(loc):
    x, y, z = loc
    return (x, -z, y)

def _mrot(rot):
    rx, ry, rz = rot
    return (rx, -rz, ry)

def add_box(name, size, loc, rot=(0, 0, 0), mat_=None):
    # Scale is set as an object property (in the box's own pre-rotation local axes) and rotation
    # is left as a normal object-level Euler transform (not baked into vertex data at creation) so
    # non-uniform sizes stay correct regardless of rotation; join() later composes both correctly
    # via each object's matrix_world.
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=_mloc(loc))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)
    o.rotation_euler = _mrot(rot)
    if mat_:
        o.data.materials.append(mat_)
    return o

def add_cyl(name, r1, r2, depth, loc, rot=(0, 0, 0), verts=16, mat_=None, cap=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                     location=_mloc(loc), rotation=_mrot(rot),
                                     end_fill_type='NGON' if cap else 'NOTHING')
    o = bpy.context.object
    o.name = name
    if mat_:
        o.data.materials.append(mat_)
    return o

def add_cone(name, r, depth, loc, rot=(0, 0, 0), verts=14, mat_=None):
    return add_cyl(name, r, 0.001, depth, loc, rot, verts, mat_)

def add_sphere(name, r, loc, mat_=None, seg=12, ring=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=_mloc(loc), segments=seg, ring_count=ring)
    o = bpy.context.object
    o.name = name
    if mat_:
        o.data.materials.append(mat_)
    return o

def place_mine(obj, x, y_up, z_depth=0.0):
    """Set an object's own .location using the (x, y_up, z_depth) convention (for objects built
    via join() / bmesh rather than the add_* helpers above)."""
    obj.location = _mloc((x, y_up, z_depth))

def join(objs, name):
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    r = bpy.context.object
    r.name = name
    return r

def apply_all_transforms(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def shade_flat(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_flat()

def setup_ao_bake_and_wire(obj, size=512, samples=24):
    """Smart-UV unwrap obj, bake AO with Cycles CPU, and wire the baked image into the
    glTF Material Output 'Occlusion' input on every material slot so the exporter emits
    an occlusionTexture."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    try:
        scene.cycles.use_denoising = False
    except Exception:
        pass

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # UV unwrap (needed for baking to a texture)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    img = bpy.data.images.new(obj.name + '_AO', width=size, height=size)
    materials = [s.material for s in obj.material_slots if s.material]
    img_nodes = []
    for m in materials:
        nt = m.node_tree
        img_node = nt.nodes.new('ShaderNodeTexImage')
        img_node.image = img
        img_node.select = True
        nt.nodes.active = img_node
        img_nodes.append((m, img_node))

    bpy.ops.object.bake(type='AO', width=size, height=size, margin=4)

    # Wire occlusion into the glTF Settings node group (created by exporter add-on utility
    # or manually here) per Khronos convention: a node group named "glTF Settings" with an
    # 'Occlusion' input, fed from the AO image node, linked (unconnected to BSDF) into output.
    for m, img_node in img_nodes:
        nt = m.node_tree
        grp = bpy.data.node_groups.get('glTF Settings')
        if grp is None:
            grp = bpy.data.node_groups.new('glTF Settings', 'ShaderNodeTree')
            grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
            out = grp.nodes.new('NodeGroupOutput')
        gnode = nt.nodes.new('ShaderNodeGroup')
        gnode.node_tree = grp
        gnode.name = 'glTF Settings'
        gnode.location = (img_node.location.x + 300, img_node.location.y)
        nt.links.new(img_node.outputs['Color'], gnode.inputs['Occlusion'])
    img.pack()
    return img

def export_glb(path, objects=None, apply_modifiers=True):
    bpy.ops.object.select_all(action='DESELECT')
    if objects:
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        use_sel = True
    else:
        bpy.ops.object.select_all(action='SELECT')
        use_sel = True
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=use_sel,
        export_apply=apply_modifiers,
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_animations=True,
        export_skins=False,
    )

def report_size(path):
    sz = os.path.getsize(path)
    print(f'[export] {path}: {sz/1024:.1f} KB')
