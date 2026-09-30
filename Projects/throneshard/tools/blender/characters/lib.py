# Blender helper library for the character pipeline (Blender 5.x, headless).
# Everything is built procedurally from CC0 source packs (see fetch_sources.mjs / CREDITS.txt) so the
# GLBs in public/assets/models/chars/ can be regenerated with `tools/blender/characters/build.sh`.
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion
from mathutils.bvhtree import BVHTree

SRC = os.environ.get('ART_SRC', os.path.expanduser('~/.cache/throneshard-art'))
UBC = SRC + '/ubc/Universal Base Characters[Standard]'
MCO = SRC + '/mco/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)'
BEST = SRC + '/best/Bestiary - Dungeon Monsters Kit[Standard]/Exports/GLB (Godot-Unreal)'
WPN = SRC + '/wpn/OBJ'
UAL1 = SRC + '/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'
UAL2 = SRC + '/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb'

# Bones kept in the game rig (fingers are folded into the hands after posing them into a fist).
KEEP_BONES = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
              'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
              'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']


# ------------------------------------------------------------------------------------------------ scene utils
def reset():
    _mat_cache.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for x in list(c):
            c.remove(x)


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
            new.remove(o)
    return new


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def apply_transforms(o):
    select_only([o])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


# ------------------------------------------------------------------------------------------------ rig
def armature_of(objs):
    return next(o for o in objs if o.type == 'ARMATURE')


def bone_head(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def bone_tail(arm, name):
    return arm.matrix_world @ arm.data.bones[name].tail_local


def bone_matrix(arm, name):
    """World-space rest matrix of a bone (Y along the bone)."""
    return arm.matrix_world @ arm.data.bones[name].matrix_local


FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb']


def curl_fingers(arm, meshes, amount=1.0):
    """Pose the fingers into a loose fist and bake that into the meshes' rest shape + the armature rest pose."""
    select_only([arm])
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        n = pb.name
        if not any(n.startswith(f) for f in FINGERS) or 'leaf' in n:
            continue
        pb.rotation_mode = 'XYZ'
        side = 1 if n.endswith('_l') else -1
        seg = int(n.split('_')[1]) if n.split('_')[1].isdigit() else 1
        if n.startswith('thumb'):
            pb.rotation_euler = Euler((math.radians(-25 * amount) if seg > 1 else 0, 0, 0))
        else:
            ang = math.radians((55 if seg == 1 else 70) * amount)
            pb.rotation_euler = Euler((0, 0, side * ang))
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        bake_pose_into_mesh(m, arm)
    select_only([arm])
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_pose_into_mesh(m, arm):
    mod = next((x for x in m.modifiers if x.type == 'ARMATURE'), None)
    if not mod:
        return
    select_only([m])
    # duplicate the modifier, apply the copy, keep the original bound to the (soon re-rested) armature
    bpy.ops.object.modifier_copy(modifier=mod.name)
    copy = m.modifiers[-1]
    bpy.ops.object.modifier_move_to_index(modifier=copy.name, index=0)
    bpy.ops.object.modifier_apply(modifier=copy.name)


def merge_groups(m, mapping):
    """mapping: {src_group_name: dst_group_name}; weights added then src removed."""
    vg = m.vertex_groups
    for src, dst in mapping.items():
        if src not in vg:
            continue
        if dst not in vg:
            vg.new(name=dst)
        s, d = vg[src].index, vg[dst]
        for v in m.data.vertices:
            for g in v.groups:
                if g.group == s and g.weight > 0:
                    d.add([v.index], g.weight, 'ADD')
        vg.remove(vg[src])


def strip_bones(arm, meshes, keep=KEEP_BONES):
    """Delete every bone not in `keep`, folding their weights into the nearest kept ancestor."""
    parent_of = {}
    for b in arm.data.bones:
        p = b
        while p and p.name not in keep:
            p = p.parent
        parent_of[b.name] = p.name if p else 'root'
    for m in meshes:
        merge_groups(m, {n: parent_of[n] for n in parent_of if n not in keep})
        for g in list(m.vertex_groups):
            if g.name not in keep:
                m.vertex_groups.remove(g)
    select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in list(arm.data.edit_bones):
        if eb.name not in keep:
            arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')


def normalize_weights(m, limit=4):
    select_only([m])
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=limit)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def bind(obj, arm, bone=None, weights=None):
    """Skin a static object to the armature: all verts to `bone`, or per-vertex via weights(v_co)->{bone:w}."""
    apply_transforms(obj)
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    if bone:
        g = obj.vertex_groups.new(name=bone)
        g.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    else:
        groups = {}
        for v in obj.data.vertices:
            for b, w in weights(obj.matrix_world @ v.co).items():
                if w <= 0:
                    continue
                if b not in groups:
                    groups[b] = obj.vertex_groups.new(name=b)
                groups[b].add([v.index], w, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return obj


def copy_weights(dst, src):
    """Transfer skin weights from src (body) to dst by nearest surface."""
    apply_transforms(dst)
    dst.parent = src.parent
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    for g in src.vertex_groups:
        dst.vertex_groups.new(name=g.name)
    mod = dst.modifiers.new('wt', 'DATA_TRANSFER')
    mod.object = src
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    select_only([dst])
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    arm = src.find_armature()
    if not any(m.type == 'ARMATURE' for m in dst.modifiers):
        am = dst.modifiers.new('Armature', 'ARMATURE')
        am.object = arm
    # drop empty groups
    used = set()
    for v in dst.data.vertices:
        for g in v.groups:
            if g.weight > 1e-4:
                used.add(g.group)
    for g in list(dst.vertex_groups):
        if g.index not in used:
            dst.vertex_groups.remove(g)
    return dst


# ------------------------------------------------------------------------------------------------ materials
_mat_cache = {}


def mat(name, color, rough=0.6, metal=0.0, emit=0.0, noise=0.12, noise_scale=18.0, edge=0.0):
    """Principled material with subtle procedural value noise (reads as painted texture after baking).
    edge>0 brightens convex edges (pointiness) for worn-metal highlights."""
    key = (name, color if isinstance(color, int) else tuple(color), rough, metal, emit, noise, edge)
    if key in _mat_cache:
        try:
            _mat_cache[key].name
            return _mat_cache[key]
        except ReferenceError:
            pass
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = srgb(color)
    rgb = nt.nodes.new('ShaderNodeRGB')
    rgb.outputs[0].default_value = (*col, 1)
    out = rgb.outputs[0]
    if noise > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = noise_scale
        nz.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = 1 - noise
        mr.inputs['To Max'].default_value = 1 + noise
        nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1
        nt.links.new(out, mul.inputs[6])
        cv = nt.nodes.new('ShaderNodeCombineColor')
        for i in range(3):
            nt.links.new(mr.outputs[0], cv.inputs[i])
        nt.links.new(cv.outputs[0], mul.inputs[7])
        out = mul.outputs[2]
    if edge > 0:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        ramp = nt.nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0.5
        ramp.inputs['From Max'].default_value = 0.56
        ramp.inputs['To Max'].default_value = edge
        nt.links.new(geo.outputs['Pointiness'], ramp.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.blend_type = 'SCREEN'
        nt.links.new(ramp.outputs[0], mx.inputs['Factor'])
        nt.links.new(out, mx.inputs[6])
        mx.inputs[7].default_value = (1, 1, 1, 1)
        out = mx.outputs[2]
    nt.links.new(out, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m['emit'] = emit
    m['game_color'] = color if isinstance(color, int) else list(color)
    _mat_cache[key] = m
    return m


def srgb(c):
    """0xRRGGBB int or (r,g,b) 0..1 sRGB -> linear tuple"""
    if isinstance(c, int):
        c = ((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255)
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def set_material(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.material_index = 0


def recolor_obj_materials(o, fn):
    """fn(material_name, (r,g,b) linear) -> material to use"""
    for i, slot in enumerate(o.material_slots):
        sm = slot.material
        base = (0.8, 0.8, 0.8)
        if sm and sm.node_tree:
            b = sm.node_tree.nodes.get('Principled BSDF')
            if b:
                base = tuple(b.inputs['Base Color'].default_value[:3])
        slot.material = fn(sm.name if sm else '', base)


# ------------------------------------------------------------------------------------------------ mesh building
def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def prim(kind, name='prim', m=None, **kw):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
    elif kind == 'cyl':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=kw.get('seg', 12), radius1=kw.get('r1', 0.5), radius2=kw.get('r2', 0.5), depth=kw.get('depth', 1.0))
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=kw.get('seg', 10), radius1=kw.get('r1', 0.5), radius2=kw.get('r2', 0.0), depth=kw.get('depth', 1.0))
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get('seg', 12), v_segments=kw.get('rings', 8), radius=kw.get('r', 0.5))
    elif kind == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 1), radius=kw.get('r', 0.5))
    elif kind == 'torus':
        R, r, seg, rs = kw.get('R', 0.5), kw.get('r', 0.1), kw.get('seg', 16), kw.get('rseg', 6)
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rs):
                b = 2 * math.pi * j / rs
                ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
            verts.append(ring)
        for i in range(seg):
            for j in range(rs):
                a, b = verts[i][j], verts[(i + 1) % seg][j]
                c, d = verts[(i + 1) % seg][(j + 1) % rs], verts[i][(j + 1) % rs]
                bm.faces.new((a, b, c, d))
    o = new_obj(name, bm)
    if m:
        set_material(o, m)
    return o


def lathe(name, profile, seg=12, m=None, axis='Z'):
    """Revolve [(radius, z)] around Z."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)) if r > 1e-5 or i == 0 else ring[0])
        rings.append(ring)
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(seg):
            vs = [A[i], A[(i + 1) % seg], B[(i + 1) % seg], B[i]]
            uniq = []
            for v in vs:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                try:
                    bm.faces.new(uniq)
                except ValueError:
                    pass
    o = new_obj(name, bm)
    if m:
        set_material(o, m)
    return o


def extrude_shape(name, pts2d, depth, m=None, bevel=0.0):
    """Flat polygon in XZ plane (x, z), extruded along Y by depth (centred)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, -depth / 2, z)) for x, z in pts2d]
    f = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[f]) if False else None
    ret = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=(0, depth, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = new_obj(name, bm)
    if m:
        set_material(o, m)
    if bevel > 0:
        md = o.modifiers.new('bev', 'BEVEL')
        md.width = bevel
        md.segments = 1
        md.limit_method = 'ANGLE'
        select_only([o])
        bpy.ops.object.modifier_apply(modifier=md.name)
    return o


def place(o, loc=(0, 0, 0), rotxyz=(0, 0, 0), scale=(1, 1, 1)):
    o.location = Vector(loc)
    o.rotation_euler = Euler([math.radians(a) for a in rotxyz])
    o.scale = Vector(scale) if not isinstance(scale, (int, float)) else Vector((scale,) * 3)
    apply_transforms(o)
    return o


def to_bone_space(o, arm, bone, loc=(0, 0, 0), rotxyz=(0, 0, 0), scale=1.0):
    """Treat o as authored in the bone's local frame (Y along bone) and move it to world rest pose."""
    place(o, (0, 0, 0), rotxyz, scale if not isinstance(scale, (int, float)) else (scale,) * 3)
    M = bone_matrix(arm, bone) @ Matrix.Translation(Vector(loc))
    o.matrix_world = M
    apply_transforms(o)
    return o


def join(objs, name=None):
    objs = [o for o in objs if o]
    select_only(objs, objs[0])
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    if name:
        o.name = name
        o.data.name = name
    return o


def smooth(o, angle=40):
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        select_only([o])
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass


def flat(o):
    for p in o.data.polygons:
        p.use_smooth = False


# ------------------------------------------------------------------------------------------------ body zones
def dominant_bone(m, v):
    best, bw = None, 0
    for g in v.groups:
        if g.weight > bw:
            best, bw = m.vertex_groups[g.group].name, g.weight
    return best


def bone_weight(m, v, name):
    if name not in m.vertex_groups:
        return 0.0
    gi = m.vertex_groups[name].index
    for g in v.groups:
        if g.group == gi:
            return g.weight
    return 0.0


ZONE_BONES = {
    'head': ['Head', 'neck_01'], 'neck': ['neck_01'], 'chest': ['spine_03', 'spine_02', 'clavicle_l', 'clavicle_r'],
    'belly': ['spine_01'], 'hips': ['pelvis'], 'uparm': ['upperarm_l', 'upperarm_r'],
    'forearm': ['lowerarm_l', 'lowerarm_r'], 'hand': ['hand_l', 'hand_r'], 'thigh': ['thigh_l', 'thigh_r'],
    'calf': ['calf_l', 'calf_r'], 'foot': ['foot_l', 'foot_r', 'ball_l', 'ball_r'],
}


def zone_of(m, v):
    b = dominant_bone(m, v)
    for z, bs in ZONE_BONES.items():
        if b in bs:
            return z
    return 'other'


def select_verts(m, pred):
    """pred(v, co_world, zone) -> bool. Returns set of vertex indices."""
    mw = m.matrix_world
    return {v.index for v in m.data.vertices if pred(v, mw @ v.co, zone_of(m, v))}


def zones(*names, zmin=-9, zmax=9, xmin=-9, xmax=9, ymin=-9, ymax=9):
    names = set(names)
    return lambda v, co, z: (z in names or '*' in names) and zmin <= co.z <= zmax and xmin <= co.x <= xmax and ymin <= co.y <= ymax


def paint(m, rules, attr='paint'):
    """Per-vertex paint layer used by the body material: rules = [(pred, color_int, strength)] (first match wins).
    Stored as a POINT color attribute (rgb linear, a = strength)."""
    if attr in m.data.color_attributes:
        m.data.color_attributes.remove(m.data.color_attributes[attr])
    ca = m.data.color_attributes.new(attr, 'FLOAT_COLOR', 'POINT')
    mw = m.matrix_world
    for v in m.data.vertices:
        co = mw @ v.co
        z = zone_of(m, v)
        val = (1, 1, 1, 0)
        for pred, col, s in rules:
            if pred(v, co, z):
                val = (*srgb(col), s)
                break
        ca.data[v.index].color = val
    return ca


def shell(m, pred, name, offset=0.012, thick=0.01, material=None, grow=0, smooth_iter=0):
    """Armour/cloth shell: duplicates body faces whose verts all match pred, pushes them out along normals and
    solidifies. Keeps skin weights (so it deforms with the body)."""
    idx = select_verts(m, pred)
    bm = bmesh.new()
    bm.from_mesh(m.data)
    bm.verts.ensure_lookup_table()
    keep = [f for f in bm.faces if all(v.index in idx for v in f.verts)]
    for _ in range(grow):
        vs = {v for f in keep for v in f.verts}
        keep = list({f for v in vs for f in v.link_faces})
    kill = [f for f in bm.faces if f not in set(keep)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    if smooth_iter > 0:
        # remove anatomy (faces, toes, abs) then keep the shell at least `offset` outside the body
        src = bmesh.new()
        src.from_mesh(m.data)
        tree = BVHTree.FromBMesh(src)
        for _ in range(smooth_iter):
            bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.8, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in bm.verts:
            loc, nrm, _, d = tree.find_nearest(v.co)
            if loc is None:
                continue
            outside = (v.co - loc).dot(nrm) > 0
            if not outside or d < offset * 0.4:
                v.co = loc + nrm * offset * 0.4
        src.free()
        bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.matrix_world = m.matrix_world.copy()
    o.parent = m.parent
    o.matrix_parent_inverse = m.matrix_parent_inverse.copy()
    for g in m.vertex_groups:
        o.vertex_groups.new(name=g.name)
    # vertex groups are copied by bm.to_mesh (deform layer) — nothing else to do
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    if thick > 0:
        sm = o.modifiers.new('solid', 'SOLIDIFY')
        sm.thickness = thick
        sm.offset = 1
        sm.use_rim = True
        select_only([o])
        bpy.ops.object.modifier_apply(modifier=sm.name)
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = m.find_armature()
    if material:
        set_material(o, material)
    smooth(o, 50)
    return o


def inflate(m, center, radius, amount, axis_scale=(1, 1, 1), along_normal=True):
    """Push verts near `center` outward (soft sphere falloff). Used for bulk (Gorrow belly, Brakka shoulders)."""
    c = Vector(center)
    mw = m.matrix_world
    inv = mw.inverted()
    me = m.data
    for v in me.vertices:
        w = mw @ v.co
        d = Vector(((w.x - c.x) / axis_scale[0], (w.y - c.y) / axis_scale[1], (w.z - c.z) / axis_scale[2])).length
        if d >= radius:
            continue
        f = 0.5 + 0.5 * math.cos(math.pi * d / radius)
        if along_normal:
            n = (mw.to_3x3() @ v.normal).normalized()
            w = w + n * amount * f
        else:
            dirv = (w - c)
            if dirv.length > 1e-6:
                w = w + dirv.normalized() * amount * f
        v.co = inv @ w


def scale_region(m, center, radius, s, axis=(1, 1, 1)):
    """Scale verts around center with soft falloff (bigger hands/heads/shoulders)."""
    c = Vector(center)
    mw = m.matrix_world
    inv = mw.inverted()
    for v in m.data.vertices:
        w = mw @ v.co
        d = (w - c).length
        if d >= radius:
            continue
        f = 0.5 + 0.5 * math.cos(math.pi * d / radius)
        off = w - c
        k = [1 + (s * a - 1) * f for a in axis]
        v.co = inv @ (c + Vector((off.x * k[0], off.y * k[1], off.z * k[2])))


def delete_hidden(body, covers, dist=0.03, zone_pred=None):
    """Delete body faces completely enclosed by cover meshes (outfit parts). Ray from each vertex outward along
    its normal; if it hits a cover within `dist`, the vertex is hidden."""
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for c in covers:
        bm = bmesh.new()
        bm.from_mesh(c.data)
        bm.transform(c.matrix_world)
        trees.append(BVHTree.FromBMesh(bm))
        bm.free()
    mw = body.matrix_world
    hidden = set()
    for v in body.data.vertices:
        co = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        if zone_pred and not zone_pred(v, co, zone_of(body, v)):
            continue
        hit = 0
        for dirs in (n, (n + Vector((0, 0, 0.6))).normalized(), (n - Vector((0, 0, 0.6))).normalized()):
            for t in trees:
                h = t.ray_cast(co + dirs * 0.001, dirs, dist)
                if h[0] is not None:
                    hit += 1
                    break
        if hit >= 3:
            hidden.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    kill = [f for f in bm.faces if all(v.index in hidden for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    return len(kill)


# ------------------------------------------------------------------------------------------------ decimate / bake / export
def decimate(o, target_tris):
    t = tri_count(o)
    if t <= target_tris:
        return
    md = o.modifiers.new('dec', 'DECIMATE')
    md.ratio = target_tris / t
    md.use_collapse_triangulate = True
    # keep armature modifier last
    select_only([o])
    bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
    bpy.ops.object.modifier_apply(modifier=md.name)


def triangulate(o):
    md = o.modifiers.new('tri', 'TRIANGULATE')
    select_only([o])
    bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
    bpy.ops.object.modifier_apply(modifier=md.name)


# ------------------------------------------------------------------------------------------------ body material
def image(path):
    for im in bpy.data.images:
        if im.filepath and os.path.abspath(bpy.path.abspath(im.filepath)) == os.path.abspath(path):
            return im
    return bpy.data.images.load(path)


def body_material(name, tex_path, skin=None, skin_strength=0.0, paint_attr='paint', uv='UVMap', rough=0.6):
    """Skin texture, optionally re-tinted (skin colour * texture luminance), with a per-vertex paint layer on top
    that recolours cloth regions while keeping the texture's shading detail."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    uvn = N.new('ShaderNodeUVMap')
    uvn.uv_map = uv
    tex = N.new('ShaderNodeTexImage')
    tex.image = image(tex_path)
    L.new(uvn.outputs[0], tex.inputs[0])
    # luminance
    lum = N.new('ShaderNodeRGBToBW')
    L.new(tex.outputs[0], lum.inputs[0])
    lumk = N.new('ShaderNodeMath')
    lumk.operation = 'MULTIPLY_ADD'
    lumk.inputs[1].default_value = 2.2
    lumk.inputs[2].default_value = 0.25
    L.new(lum.outputs[0], lumk.inputs[0])
    col = tex.outputs[0]
    if skin is not None and skin_strength > 0:
        sk = N.new('ShaderNodeRGB')
        sk.outputs[0].default_value = (*srgb(skin), 1)
        mulk = N.new('ShaderNodeMix')
        mulk.data_type = 'RGBA'
        mulk.blend_type = 'MULTIPLY'
        mulk.inputs['Factor'].default_value = 1
        L.new(sk.outputs[0], mulk.inputs[6])
        gray = N.new('ShaderNodeCombineColor')
        for i in range(3):
            L.new(lumk.outputs[0], gray.inputs[i])
        L.new(gray.outputs[0], mulk.inputs[7])
        mx = N.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.inputs['Factor'].default_value = skin_strength
        L.new(col, mx.inputs[6])
        L.new(mulk.outputs[2], mx.inputs[7])
        col = mx.outputs[2]
    # paint layer
    attr = N.new('ShaderNodeAttribute')
    attr.attribute_name = paint_attr
    mulp = N.new('ShaderNodeMix')
    mulp.data_type = 'RGBA'
    mulp.blend_type = 'MULTIPLY'
    mulp.inputs['Factor'].default_value = 1
    L.new(attr.outputs['Color'], mulp.inputs[6])
    gray2 = N.new('ShaderNodeCombineColor')
    lum2 = N.new('ShaderNodeMath')
    lum2.operation = 'MULTIPLY_ADD'
    lum2.inputs[1].default_value = 1.1
    lum2.inputs[2].default_value = 0.55
    L.new(lum.outputs[0], lum2.inputs[0])
    for i in range(3):
        L.new(lum2.outputs[0], gray2.inputs[i])
    L.new(gray2.outputs[0], mulp.inputs[7])
    mxp = N.new('ShaderNodeMix')
    mxp.data_type = 'RGBA'
    L.new(attr.outputs['Alpha'], mxp.inputs['Factor'])
    L.new(col, mxp.inputs[6])
    L.new(mulp.outputs[2], mxp.inputs[7])
    L.new(mxp.outputs[2], bsdf.inputs['Base Color'])
    m['emit'] = 0.0
    return m


def textured_material(name, tex_path, tint=None, strength=0.0, uv='UVMap', rough=0.6):
    """Outfit parts: their texture, optionally recoloured (tint * luminance)."""
    return body_material(name, tex_path, skin=tint, skin_strength=strength, paint_attr='paint', uv=uv, rough=rough)


# ------------------------------------------------------------------------------------------------ bake
def ensure_uv(o, name='UVMap'):
    if not o.data.uv_layers:
        o.data.uv_layers.new(name=name)
    else:
        o.data.uv_layers[0].name = name
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])


def ensure_paint(o, attr='paint'):
    if attr not in o.data.color_attributes:
        ca = o.data.color_attributes.new(attr, 'FLOAT_COLOR', 'POINT')
        for d in ca.data:
            d.color = (1, 1, 1, 0)


def setup_cycles(samples=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = max(2, (os.cpu_count() or 4) - 2)


def bake_atlas(o, size=1024, ao_strength=0.75, margin=6, ao_dist=0.25, name='atlas'):
    """New non-overlapping UV 'atlas', bake albedo + AO into one sRGB image. Returns the image."""
    me = o.data
    uv = me.uv_layers.new(name='atlas')
    me.uv_layers.active = uv
    for l in me.uv_layers:
        l.active_render = (l.name == 'UVMap')
    select_only([o])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    try:
        bpy.ops.uv.pack_islands(margin=0.004, rotate=True, shape_method='CONCAVE')
    except Exception:
        bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    setup_cycles(16)
    sc = bpy.context.scene
    col = bpy.data.images.new(name + '_col', size, size, alpha=False, float_buffer=True)
    ao = bpy.data.images.new(name + '_ao', size, size, alpha=False, float_buffer=True)
    nodes = []
    for slot in o.material_slots:
        mt = slot.material
        b = mt.node_tree.nodes.get('Principled BSDF')
        if b:
            b.inputs['Metallic'].default_value = 0.0  # bake albedo, not the (dark) diffuse share of metals
        n = mt.node_tree.nodes.new('ShaderNodeTexImage')
        uvn = mt.node_tree.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'atlas'
        mt.node_tree.links.new(uvn.outputs[0], n.inputs[0])
        nodes.append((mt, n, uvn))
    # every material samples its own textures through explicit UVMap nodes (see body_material) so switching the
    # active render layer is safe
    for l in me.uv_layers:
        l.active_render = (l.name == 'UVMap')

    for slot in o.material_slots:
        b = slot.material.node_tree.nodes.get('Principled BSDF')
        if b:
            slot.material['metal'] = float(b.inputs['Metallic'].default_value)
            b.inputs['Metallic'].default_value = 0.0

    def bake(img, typ, **kw):
        for mt, n, _ in nodes:
            n.image = img
            mt.node_tree.nodes.active = n
        select_only([o])
        bpy.ops.object.bake(type=typ, margin=margin, use_clear=True, uv_layer='atlas', **kw)

    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    bake(col, 'DIFFUSE', pass_filter={'COLOR'})
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.cycles.samples = 48
    # AO distance via world settings
    sc.world.light_settings.distance = ao_dist
    bake(ao, 'AO')
    c = np.array(col.pixels[:]).reshape(size, size, 4)
    a = np.array(ao.pixels[:]).reshape(size, size, 4)[..., :1]
    shade = (1 - ao_strength) + ao_strength * np.clip(a, 0, 1) ** 0.8
    out = c.copy()
    out[..., :3] = c[..., :3] * shade
    # linear -> sRGB
    x = np.clip(out[..., :3], 0, 1)
    out[..., :3] = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    out[..., 3] = 1
    final = bpy.data.images.new(name, size, size, alpha=False)
    final.colorspace_settings.name = 'sRGB'
    final.pixels[:] = out.ravel()
    final.file_format = 'PNG'
    for mt, n, uvn in nodes:
        mt.node_tree.nodes.remove(n)
        mt.node_tree.nodes.remove(uvn)
    bpy.data.images.remove(col)
    bpy.data.images.remove(ao)
    return final


def finalize_material(o, img, name):
    """Replace all materials by one baked material; emissive strength per original material goes into the
    COLOR_0 vertex colour (r = emissive mask) which the game shader reads."""
    me = o.data
    emits = [float(s.material.get('emit', 0.0)) if s.material else 0.0 for s in o.material_slots]
    metals = [float(s.material.get('metal', 0.0)) if s.material else 0.0 for s in o.material_slots]
    has_emit = any(e > 0 for e in emits) or any(m > 0.2 for m in metals)
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    if has_emit:
        ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        for p in me.polygons:
            e = min(1.0, emits[p.material_index] if p.material_index < len(emits) else 0)
            mt = min(1.0, metals[p.material_index] if p.material_index < len(metals) else 0)
            for li in p.loop_indices:
                ca.data[li].color = (e, mt, 0, 1)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs[0], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
    me.materials.clear()
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    # keep only the atlas UVs
    for l in list(me.uv_layers):
        if l.name != 'atlas':
            me.uv_layers.remove(l)
    return has_emit


def export_glb(objs, path, animations=False, image_format='JPEG'):
    select_only(objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_animations=animations,
              export_skins=True, export_morph=False, export_yup=True, export_apply=False,
              export_image_format=image_format, export_texcoords=True, export_normals=True,
              export_tangents=False, export_materials='EXPORT', export_cameras=False, export_lights=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


# ------------------------------------------------------------------------------------------------ preview render
def preview(path, objs=None, size=512, angle=-30, elev=12, dist=None, target=None, samples=24):
    sc = bpy.context.scene
    setup_cycles(samples)
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.25, 0.27, 0.3, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    cam = bpy.data.objects.get('_cam')
    if not cam:
        cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam'))
        sc.collection.objects.link(cam)
        sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))
        sun.data.energy = 3.5
        sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-30)))
        sc.collection.objects.link(sun)
    sc.camera = cam
    cam.data.lens = 50
    tgt = Vector(target or (0, 0, 0.95))
    d = dist or 4.2
    a, e = math.radians(angle), math.radians(elev)
    cam.location = tgt + Vector((math.sin(a) * math.cos(e) * d, -math.cos(a) * math.cos(e) * d, math.sin(e) * d))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
