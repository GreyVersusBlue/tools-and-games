# Character assembly kit: base body + outfit parts + procedural armour/props + weapons -> one skinned mesh,
# one material, baked albedo*AO atlas. See defs_*.py for the per-character recipes.
import json
from lib import *

BASES = {
    'male': (UBC + '/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', 'SuperHero_Male',
             UBC + '/Base Characters/Textures/T_Superhero_Male_Dark.png'),
    'female': (UBC + '/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf', 'Superhero_Female',
               UBC + '/Base Characters/Textures/T_Superhero_Female_Dark_BaseColor.png'),
    'imp': (BEST + '/Imp.glb', 'Imp_Body', None),
    'puglin': (BEST + '/Puglin.glb', 'Puglin_Body', None),
}
HAIR = UBC + '/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/'
PARTS = MCO + '/Modular Parts/'


def tex_of(material):
    """Image file feeding Base Color of an imported glTF material."""
    if not material or not material.node_tree:
        return None
    for n in material.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and 'Normal' not in n.image.name and 'Rough' not in n.image.name and 'ORM' not in n.image.name:
            fp = bpy.path.abspath(n.image.filepath)
            if n.image.packed_file or not os.path.exists(fp):
                # glb-embedded: save next to the build cache so Cycles can sample it
                out = os.path.join(bpy.app.tempdir or '/tmp', n.image.name + '.png')
                n.image.filepath_raw = out
                n.image.file_format = 'PNG'
                n.image.save()
                return out
            return fp
    return None


class Char:
    def __init__(self, name, base='male', skin=None, skin_strength=0.0, height=None):
        reset()
        self.name = name
        self.base = base
        path, body_name, tex = BASES[base]
        objs = import_gltf(path)
        self.arm = armature_of(objs)
        self.arm.name = 'Armature'
        self.body = None
        self.extra = []  # other skinned meshes from the base file
        for o in objs:
            if o.type != 'MESH':
                continue
            if o.name in ('Eyes', 'Eyebrows'):
                bpy.data.objects.remove(o, do_unlink=True)
            elif o.name.lower().startswith(body_name.lower()):
                self.body = o
            else:
                self.extra.append(o)
        self.parts = [self.body] + self.extra
        # body material: base texture (or the glb's own) with a paint layer
        t = tex or tex_of(self.body.active_material)
        self.body_tex = t
        self.body_mat = body_material(name + '_skin', t, skin=skin, skin_strength=skin_strength)
        for o in [self.body]:
            set_material(o, self.body_mat)
            ensure_paint(o)
        for o in self.extra:
            self._convert_materials(o)
        self.meta = {'name': name, 'base': base}
        self._rigids = []
        self._prepped = False

    # ------------------------------------------------------------------ importing parts
    def _convert_materials(self, o, tint=None, strength=0.0, per=None):
        ensure_uv(o)
        ensure_paint(o)
        for slot in o.material_slots:
            m = slot.material
            t = tex_of(m)
            nm = m.name if m else 'x'
            tt, ss = tint, strength
            if per:
                for key, (c, s) in per.items():
                    if key in nm:
                        tt, ss = c, s
                        break
            if t:
                slot.material = textured_material(self.name + '_' + nm, t, tint=tt, strength=ss)
            else:
                col = (0.7, 0.7, 0.7)
                slot.material = mat(self.name + '_' + nm, tt if tt is not None else 0xaaaaaa)

    def add_part(self, path, only=None, tint=None, strength=0.0, per=None, skip=()):
        """Import a skinned outfit/hair glTF, keep meshes whose name contains any of `only`."""
        objs = import_gltf(path)
        a = armature_of(objs)
        got = []
        for o in objs:
            if o.type != 'MESH':
                continue
            if (only and not any(k in o.name for k in only)) or any(k in o.name for k in skip):
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            mw = o.matrix_world.copy()
            o.parent = self.arm
            o.matrix_world = mw
            for md in o.modifiers:
                if md.type == 'ARMATURE':
                    md.object = self.arm
            self._convert_materials(o, tint, strength, per)
            got.append(o)
        bpy.data.objects.remove(a, do_unlink=True)
        self.parts += got
        return got

    def hair(self, name, color, strength=0.85):
        return self.add_part(HAIR + name + '.gltf', tint=color, strength=strength)

    def outfit(self, gender_kind, pieces, tint=None, strength=0.0, per=None, skip=()):
        """gender_kind e.g. 'Male_Ranger'; pieces e.g. ['Legs', 'Feet_Boots']"""
        got = []
        for p in pieces:
            got += self.add_part(PARTS + f'{gender_kind}_{p}.gltf', tint=tint, strength=strength, per=per, skip=skip)
        return got

    # ------------------------------------------------------------------ rig prep (fist, strip fingers)
    def prep(self):
        if self._prepped:
            return
        skinned = [o for o in self.parts if o and any(m.type == 'ARMATURE' for m in o.modifiers)]
        curl_fingers(self.arm, skinned)
        # fist centres = centroid of finger-weighted verts of the body
        for side in 'lr':
            acc, n = Vector(), 0
            for o in skinned:
                gi = {g.index for g in o.vertex_groups if any(g.name.startswith(f) and g.name.endswith('_' + side) for f in FINGERS)}
                if not gi:
                    continue
                for v in o.data.vertices:
                    w = sum(g.weight for g in v.groups if g.group in gi)
                    if w > 0.5:
                        acc += o.matrix_world @ v.co
                        n += 1
            hb = bone_head(self.arm, 'hand_' + side)
            self.meta['fist_' + side] = list(acc / n) if n else list(hb)
        strip_bones(self.arm, skinned)
        self._prepped = True

    def fist(self, side='r'):
        self.prep()
        return Vector(self.meta['fist_' + side])

    # ------------------------------------------------------------------ building blocks
    def paint(self, rules, target=None):
        self.prep()
        paint(target or self.body, rules)

    def shell(self, pred, name, material, offset=0.012, thick=0.012, grow=0, src=None, smooth=6):
        self.prep()
        o = shell(src or self.body, pred, name, offset=offset, thick=thick, material=material, grow=grow, smooth_iter=smooth)
        ensure_uv(o)
        ensure_paint(o)
        self.parts.append(o)
        return o

    def rigid(self, o, bone):
        """Static prop authored in world rest space, skinned 100% to bone."""
        self.prep()
        ensure_uv(o)
        ensure_paint(o)
        bind(o, self.arm, bone)
        self.parts.append(o)
        return o

    def skinned(self, o, weights):
        self.prep()
        ensure_uv(o)
        ensure_paint(o)
        bind(o, self.arm, weights=weights)
        self.parts.append(o)
        return o

    def weapon(self, obj_name, side='r', length=1.0, grip=0.0, pitch=0.0, roll=0.0, yaw=0.0, recolor=None, offset=(0, 0, 0), flip=False, keep_mats=None):
        """Import a Medieval Weapons OBJ, scale so its length is `length` m, put the point `grip` (OBJ units along
        +Z) into the fist; weapon +Z points forward (-Y) in the rest pose, rotated by pitch (about X, +up), then
        roll (about the weapon axis) and yaw."""
        self.prep()
        objs = import_obj(WPN + '/' + obj_name + '.obj')
        o = join(objs) if len(objs) > 1 else objs[0]
        apply_transforms(o)
        bb = [Vector(c) for c in o.bound_box]
        zmin, zmax = min(v.z for v in bb), max(v.z for v in bb)
        s = length / (zmax - zmin)
        # material recolour
        def rc(nm, base):
            key = nm.split('.')[0]
            if recolor and key in recolor:
                spec = recolor[key]
                if isinstance(spec, bpy.types.Material):
                    return spec
                return mat(self.name + '_w_' + key, spec, rough=0.45 if 'Steel' in key or 'Gold' in key else 0.7,
                           metal=0.6 if 'Steel' in key or 'Gold' in key else 0.0, edge=0.35 if 'Steel' in key else 0.0)
            lin = base
            hexc = tuple(((x * 12.92) if x <= 0.0031308 else (1.055 * x ** (1 / 2.4) - 0.055)) for x in lin)
            metal = 'Steel' in key or 'Gold' in key
            return mat(self.name + '_w_' + key, hexc, rough=0.4 if metal else 0.7, metal=0.6 if metal else 0.0, edge=0.3 if metal else 0.0)
        recolor_obj_materials(o, rc)
        M = Matrix.Translation(Vector(offset)) @ Matrix.Translation(self.fist(side))
        # weapon axis +Z -> -Y (forward), then pitch/roll/yaw
        base = Matrix.Rotation(math.radians(90), 4, 'X')  # +Z -> -Y (forward)
        o.matrix_world = M @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Rotation(math.radians(pitch), 4, 'X') @ base @ \
            Matrix.Rotation(math.radians(roll), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((0, 0, -grip)))
        if flip:
            o.matrix_world = o.matrix_world @ Matrix.Rotation(math.pi, 4, 'Y')
        smooth(o, 35)
        return self.rigid(o, 'hand_' + side)

    def weapon_frame(self, obj_name, side, length, z_axis, x_axis, grip=0.0, recolor=None):
        """Like weapon() but orientation given explicitly: OBJ +Z -> z_axis, OBJ +X -> (orthogonalised) x_axis."""
        o = self.weapon(obj_name, side, length=length, grip=grip, recolor=recolor)
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        for g in list(o.vertex_groups):
            o.vertex_groups.remove(g)
        o.parent = None
        self.parts.remove(o)
        # weapon() mapped OBJ(+X,+Y,+Z) -> world(+X,+Z,-Y) around the fist; undo that rotation, then apply ours
        f = self.fist(side)
        base = Matrix.Rotation(math.radians(90), 4, 'X')
        me = o.data
        me.transform(Matrix.Translation(-f))
        me.transform(base.inverted())
        z = Vector(z_axis).normalized()
        x = (Vector(x_axis) - z * Vector(x_axis).dot(z)).normalized()
        y = z.cross(x)
        R = Matrix((x, y, z)).transposed().to_4x4()
        me.transform(R)
        me.transform(Matrix.Translation(f))
        o.matrix_world = Matrix.Identity(4)
        return self.rigid(o, 'hand_' + side)

    def shield(self, obj_name, side='l', size=0.7, recolor=None, out=0.09, along=0.55):
        """Shield strapped to the outside of the forearm, face pointing away from the body (±X in rest pose)."""
        self.prep()
        o = self.weapon(obj_name, side, length=size, grip=0.0, recolor=recolor)
        # undo the hand placement: rebuild transform explicitly
        mods = [m for m in o.modifiers]
        for m in mods:
            o.modifiers.remove(m)
        for g in list(o.vertex_groups):
            o.vertex_groups.remove(g)
        o.parent = None
        # centre the mesh at origin
        bb = [Vector(c) for c in o.bound_box]
        cen = sum(bb, Vector()) / 8
        me = o.data
        me.transform(Matrix.Translation(-cen))
        # after weapon(): height axis along -Y, shield front facing -Z. In the T-pose the outside of the forearm is +Z
        # (it becomes lateral when the arm hangs), so: front -> +Z, height along the forearm (X).
        me.transform(Matrix.Rotation(math.pi, 4, 'X'))
        me.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
        a, b = bone_head(self.arm, 'lowerarm_' + side), bone_tail(self.arm, 'lowerarm_' + side)
        o.matrix_world = Matrix.Translation(a.lerp(b, along) + Vector((0, 0, out)))
        apply_transforms(o)
        self.parts.remove(o)
        return self.rigid(o, 'lowerarm_' + side)

    def aim_axis(self, bone, clip, world_dir, frame=None, src=UAL1):
        """Rest-pose world direction that becomes `world_dir` when `clip` poses `bone` (e.g. make a rifle point
        forward while Pistol_Idle plays). Temporarily imports the animation library."""
        self.prep()
        before = set(bpy.data.objects)
        acts_before = set(bpy.data.actions)
        import_gltf(src)
        new_objs = [o for o in bpy.data.objects if o not in before]
        act = next((a for a in bpy.data.actions if a not in acts_before and a.name.split('.')[0] == clip), None)
        rest = self.arm.matrix_world @ self.arm.data.bones[bone].matrix_local
        out = Vector(world_dir).normalized()
        if act:
            ad = self.arm.animation_data_create()
            ad.action = act
            try:
                ad.action_slot = act.slots[0]
            except Exception:
                pass
            f = frame if frame is not None else act.frame_range[0] + 0.5 * (act.frame_range[1] - act.frame_range[0])
            bpy.context.scene.frame_set(int(f))
            posed = self.arm.matrix_world @ self.arm.pose.bones[bone].matrix
            local = posed.to_3x3().inverted() @ out
            out = (rest.to_3x3() @ local).normalized()
            ad.action = None
            for pb in self.arm.pose.bones:
                pb.matrix_basis.identity()
            bpy.context.scene.frame_set(0)
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in list(bpy.data.actions):
            if a not in acts_before:
                bpy.data.actions.remove(a)
        return out

    def inflate(self, center, radius, amount, axis_scale=(1, 1, 1), targets=None):
        self.prep()
        for o in targets or [p for p in self.parts if p.type == 'MESH']:
            inflate(o, center, radius, amount, axis_scale)

    def scale_region(self, center, radius, s, axis=(1, 1, 1), targets=None):
        self.prep()
        for o in targets or [p for p in self.parts if p.type == 'MESH']:
            scale_region(o, center, radius, s, axis)

    def hide_under(self, covers, dist=0.035, pred=None):
        self.prep()
        return delete_hidden(self.body, covers, dist, pred)

    def remove_body(self, pred):
        """Delete body faces whose verts all match pred (e.g. under a robe)."""
        self.prep()
        idx = select_verts(self.body, pred)
        bm = bmesh.new()
        bm.from_mesh(self.body.data)
        kill = [f for f in bm.faces if all(v.index in idx for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(self.body.data)
        bm.free()

    # ------------------------------------------------------------------ output
    def finish(self, out_dir, tris=14000, tex=1024, ao=0.75, preview_dir=None, scale=1.0):
        self.prep()
        parts = [p for p in self.parts if p and p.name in bpy.data.objects and p.type == 'MESH' and len(p.data.polygons)]
        for p in parts:
            ensure_uv(p)
            ensure_paint(p)
            if not any(m.type == 'ARMATURE' for m in p.modifiers):
                bind(p, self.arm, 'pelvis')
        # join (active = body keeps armature modifier)
        o = join(parts, self.name)
        for md in list(o.modifiers):
            if md.type != 'ARMATURE':
                o.modifiers.remove(md)
        arms = [m for m in o.modifiers if m.type == 'ARMATURE']
        for extra in arms[1:]:
            o.modifiers.remove(extra)
        triangulate(o)
        decimate(o, tris)
        normalize_weights(o, 4)
        # remove unused vertex groups (keeps the skin small)
        for g in list(o.vertex_groups):
            if g.name not in KEEP_BONES:
                o.vertex_groups.remove(g)
        if preview_dir:
            preview(preview_dir + f'/{self.name}_src.png', samples=16)
        img = bake_atlas(o, size=tex, ao_strength=ao, name=self.name + '_atlas')
        emit = finalize_material(o, img, 'M_' + self.name)
        if scale != 1.0:
            self.arm.scale = (scale,) * 3
        self.meta['tris'] = tri_count(o)
        self.meta['emissive'] = emit
        self.meta['height'] = max((o.matrix_world @ Vector(c)).z for c in o.bound_box)
        # export
        out = os.path.join(out_dir, self.name + '.glb')
        export_glb([o, self.arm], out)
        if preview_dir:
            img.save_render(preview_dir + f'/{self.name}_atlas.png')
            preview(preview_dir + f'/{self.name}.png', samples=16)
        print('BUILT', json.dumps(self.meta))
        return out


def _drop(self, *names):
    for o in list(self.parts):
        if o and any(n in o.name for n in names):
            self.parts.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)


Char.drop = _drop
