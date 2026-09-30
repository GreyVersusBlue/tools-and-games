"""Shared helpers for SkyWings 64 Blender hero-model scripts.
Run headless: ~/.local/bin/blender -b -P tools/blender/vehicle_XXX.py
"""
import bpy
import bmesh
import math
import os

V = None  # placeholder


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, color, roughness=0.5, metallic=0.0, emissive=None, emissive_strength=1.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.blend_method = 'BLEND'
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    return mat


def add_box(name, size, loc, rot=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat:
        obj.data.materials.append(mat)
    return obj


def add_cyl(name, radius, depth, loc, rot=(0, 0, 0), mat=None, radius2=None, verts=16, cap=True):
    if radius2 is not None and abs(radius2 - radius) > 1e-6:
        bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=radius2, depth=depth, location=loc, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, vertices=verts,
                                             end_fill_type='NGON' if cap else 'NOTHING')
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if mat:
        obj.data.materials.append(mat)
    return obj


def add_sphere(name, radius, loc, mat=None, scale=(1, 1, 1), segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=segs, ring_count=rings)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    return obj


def add_cone(name, radius1, radius2, depth, loc, rot=(0, 0, 0), mat=None, verts=16):
    bpy.ops.mesh.primitive_cone_add(radius1=radius1, radius2=radius2, depth=depth, location=loc, vertices=verts)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if mat:
        obj.data.materials.append(mat)
    return obj


def add_torus(name, major_r, minor_r, loc, rot=(0, 0, 0), mat=None, major_segs=16, minor_segs=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_r, minor_radius=minor_r, location=loc,
                                      major_segments=major_segs, minor_segments=minor_segs)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if mat:
        obj.data.materials.append(mat)
    return obj


def add_empty(name, loc, size=0.05):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = size
    e.location = loc
    bpy.context.collection.objects.link(e)
    return e


def parent_to(child, parent, keep_transform=True):
    child.parent = parent
    if keep_transform:
        child.matrix_parent_inverse = parent.matrix_world.inverted()


def shade_smooth(obj, angle=None):
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    if angle is not None:
        try:
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = angle
        except Exception:
            pass


def join_all_meshes_into(name):
    """Join every mesh object in the scene into one named object (keeps materials as slots)."""
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    return joined


def uv_smart_project(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_ao(objs, image_size=512, samples=24):
    """Bake AO for a list of mesh objects onto a new 'AO' UV map + image, wired into each material's
    glTF Material Output occlusion socket so the exporter writes occlusionTexture."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    try:
        scene.cycles.device = 'CPU'
    except Exception:
        pass

    img = bpy.data.images.new('AO_Bake', width=image_size, height=image_size)

    for obj in objs:
        if obj.type != 'MESH':
            continue
        # second UV map for baking (avoid disturbing primary UVs used for other maps)
        if 'AO' not in obj.data.uv_layers:
            uv = obj.data.uv_layers.new(name='AO')
        else:
            uv = obj.data.uv_layers['AO']
        obj.data.uv_layers.active = uv
        uv_smart_project(obj)
        # make sure AO layer stays active after smart project (smart project uses active uv)
        obj.data.uv_layers.active = obj.data.uv_layers['AO']

        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nt = mat.node_tree
            img_node = nt.nodes.new('ShaderNodeTexImage')
            img_node.image = img
            img_node.select = True
            nt.nodes.active = img_node
            uvmap_node = nt.nodes.new('ShaderNodeUVMap')
            uvmap_node.uv_map = 'AO'
            nt.links.new(uvmap_node.outputs['UV'], img_node.inputs['Vector'])

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        if obj.type == 'MESH':
            obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    bpy.ops.object.bake(type='AO')

    # wire AO image into glTF settings occlusion input per material (Khronos glTF Material Output group)
    for obj in objs:
        if obj.type != 'MESH':
            continue
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nt = mat.node_tree
            img_node = None
            for n in nt.nodes:
                if n.type == 'TEX_IMAGE' and n.image == img:
                    img_node = n
                    break
            if img_node is None:
                continue
            group = nt.nodes.new('ShaderNodeGroup')
            gltf_group = get_or_create_gltf_settings_group()
            group.node_tree = gltf_group
            group.location = (img_node.location.x + 300, img_node.location.y)
            nt.links.new(img_node.outputs['Color'], group.inputs['Occlusion'])
    return img


def get_or_create_gltf_settings_group():
    name = 'glTF Settings'
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    out = g.nodes.new('NodeGroupOutput')
    inp = g.nodes.new('NodeGroupInput')
    return g


def fix_orientation(top_level_objects):
    """Scripts in this folder author geometry directly in glTF/three.js convention
    (X right, Y up, Z forward, nose at -Z) using literal (x, y, z) tuples fed straight
    into Blender's own (Z-up) coordinate fields. Blender's glTF exporter always converts
    Blender's Z-up space to glTF's Y-up space (a -90 degree rotation about X for points),
    so left uncorrected the whole model comes out lying on its side. Applying the exact
    inverse (+90 degrees about X, around the world origin) to every unparented root object
    cancels the exporter's conversion, so the final glTF coordinates equal the literal
    (x, y, z) values used when building the mesh -- including for empty nodes like
    "rotor"/"prop"/"leg_L" whose local +Y axis must still point straight up after export
    so runtime spin code (`node.rotation.y += angle`) rotates about true vertical.
    """
    import mathutils
    Rx90 = mathutils.Matrix.Rotation(math.radians(90), 4, 'X')
    for obj in top_level_objects:
        if obj.parent is not None:
            continue  # only correct true roots; parented children follow automatically
        obj.matrix_world = Rx90 @ obj.matrix_world
    bpy.context.view_layer.update()


def export_glb(path, objects=None, apply_modifiers=True):
    bpy.ops.object.select_all(action='DESELECT')
    if objects:
        for o in objects:
            o.select_set(True)
        use_selection = True
    else:
        use_selection = False
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=use_selection,
        export_apply=apply_modifiers,
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_skins=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )


def report_stats(path):
    size = os.path.getsize(path)
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                tris += max(0, len(p.vertices) - 2)
    print(f"[sw_common] {path}: {size/1024:.1f} KB, ~{tris} tris (pre-triangulation estimate)")
    return size, tris
