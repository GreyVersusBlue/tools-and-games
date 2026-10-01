# Authors the clips Quaternius' libraries do not have: 'Bow_Shoot' (nock, draw, hold, release, recover) and
# 'Rifle_Shoot' (two-handed recoil). Both start from a Universal Animation Library pose and add an IK-driven second
# arm, baked back to plain bone rotations, so they run on every character that shares the 23-bone rig.
# Called from build_anims.py after the rig has been stripped to KEEP_BONES.
import bpy, math
from mathutils import Vector, Matrix


def _assign(arm, act):
    ad = arm.animation_data_create()
    ad.action = act
    try:
        ad.action_slot = act.slots[0]
    except Exception:
        pass


def _ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _pose_from(arm, src_act, src_frame, dst_act, dst_frame):
    """Copy the pose `src_act` has at `src_frame` into keyframes of `dst_act` at `dst_frame`."""
    _assign(arm, src_act)
    fi = int(math.floor(src_frame))
    bpy.context.scene.frame_set(fi, subframe=src_frame - fi)
    bpy.context.view_layer.update()
    snap = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}
    return snap


def _key_pose(arm, act, snap, frame):
    _assign(arm, act)
    for pb in arm.pose.bones:
        q, l = snap[pb.name]
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if pb.name in ('pelvis', 'root'):
            pb.location = l
            pb.keyframe_insert('location', frame=frame)


def _world(arm, name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def _empty(name, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    return e


def _bake(arm, name, f0, f1):
    for o in bpy.context.scene.objects:
        o.select_set(o == arm)
    bpy.context.view_layer.objects.active = arm
    before = set(bpy.data.actions)
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False, visual_keying=True,
                     clear_constraints=True, clear_parents=False, use_current_action=False, bake_types={'POSE'})
    new = [a for a in bpy.data.actions if a not in before]
    act = new[0]
    act.name = name
    act.use_fake_user = True
    return act


def _add_ik(arm, bone, target, pole, pole_angle):
    c = arm.pose.bones[bone].constraints.new('IK')
    c.target = target
    c.pole_target = pole
    c.pole_angle = pole_angle
    c.chain_count = 2
    c.use_tail = True
    return c


def _key_loc(e, frame, loc):
    e.location = loc
    e.keyframe_insert('location', frame=frame)


def _calibrate_pole(arm, side, target_loc, elbow_want, pole):
    """Pick the IK pole angle whose elbow lands closest to `elbow_want` for a fixed target."""
    best = None
    for ang in (0, 90, 180, -90):
        for pb in arm.pose.bones:
            for c in list(pb.constraints):
                pb.constraints.remove(c)
        t = _empty('cal_t', target_loc)
        _add_ik(arm, 'lowerarm_' + side, t, pole, math.radians(ang))
        bpy.context.view_layer.update()
        elbow = _world(arm, 'lowerarm_' + side)
        d = (elbow - elbow_want).length
        if best is None or d < best[0]:
            best = (d, ang)
        for c in list(arm.pose.bones['lowerarm_' + side].constraints):
            arm.pose.bones['lowerarm_' + side].constraints.remove(c)
        bpy.data.objects.remove(t, do_unlink=True)
    return best[1]


def _cleanup(*things):
    for t in things:
        if isinstance(t, bpy.types.Action):
            bpy.data.actions.remove(t)
        else:
            ad = t.animation_data
            if ad and ad.action:
                a = ad.action
                ad.action = None
                bpy.data.actions.remove(a)
            bpy.data.objects.remove(t, do_unlink=True)


def author_bow(arm, out_name='Bow_Shoot'):
    """Left arm holds the bow (Punch_Jab's extended pose, eased in and out); right hand nocks, draws to the cheek,
    holds, releases with a snap back, and relaxes. 40 frames."""
    jab = bpy.data.actions['Punch_Jab']
    j0 = jab.frame_range[0]
    HOLD = 5.0
    N = 36
    base = bpy.data.actions.new('Bow_base')
    base.use_fake_user = True
    snaps = {}

    def jf(f):
        if f <= 8:
            return j0 + (HOLD - j0) * _ease(f / 8)
        if f <= 30:
            return HOLD
        # only start to lower the bow arm; the game's crossfade to idle does the rest
        return HOLD + (j0 - HOLD) * 0.3 * _ease((f - 30) / (N - 30))
    for f in range(0, N + 1):
        s = _pose_from(arm, jab, jf(f), base, f)
        _key_pose(arm, base, s, f)
    _assign(arm, base)
    bl_hand_r, bl_hand_l, head_c = {}, {}, {}
    for f in range(0, N + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        bl_hand_r[f] = _world(arm, 'hand_r').copy()
        bl_hand_l[f] = _world(arm, 'hand_l').copy()
        head_c[f] = _world(arm, 'Head', tail=True).copy()
    # anchor: right cheek, just in front of the ear (character faces -Y, its right is -X)
    F = 24
    hc = head_c[F]
    anchor = hc + Vector((-0.06, -0.02, -0.16))
    nock = lambda f: bl_hand_l[f] + Vector((0.0, 0.09, 0.0))
    rel_far = anchor + Vector((-0.02, 0.22, 0.02))

    def target(f):
        if f <= 3:
            t = _ease(f / 3)
            return bl_hand_r[f].lerp(nock(f), t)
        if f <= 8:
            return nock(f)
        if f <= 24:
            return nock(f).lerp(anchor, _ease((f - 8) / 16))
        if f <= 30:
            return anchor + Vector((0, 0.004 * math.sin((f - 24) * 2.0), 0.003 * math.sin((f - 24) * 3.0)))
        if f <= 32:
            return anchor.lerp(rel_far, _ease((f - 30) / 2))
        return rel_far.lerp(bl_hand_r[f], 0.6 * _ease((f - 32) / (N - 32)))
    tgt = _empty('bow_t', target(0))
    shoulder_r = _world(arm, 'upperarm_r')
    pole = _empty('bow_pole', shoulder_r + Vector((-0.55, 0.45, -0.45)))
    ang = _calibrate_pole(arm, 'r', target(F), shoulder_r + Vector((-0.28, 0.16, -0.22)), pole)
    print('BOW pole angle', ang)
    for f in range(0, N + 1):
        _key_loc(tgt, f, target(f))
    _assign(arm, base)
    _add_ik(arm, 'lowerarm_r', tgt, pole, math.radians(ang))
    act = _bake(arm, out_name, 0, N)
    _cleanup(tgt, pole, base)
    return act


def author_rifle(arm, out_name='Rifle_Shoot'):
    """Two-handed rifle: Pistol_Shoot's body and firing arm, with the left hand IK'd onto the fore-end. The fore-end
    is a point 0.5 m down the barrel from the right hand, carried through the recoil in the hand's own space."""
    src = bpy.data.actions['Pistol_Shoot']
    f0, f1 = int(src.frame_range[0]), int(src.frame_range[1])
    N = f1 - f0
    base = bpy.data.actions.new('Rifle_base')
    base.use_fake_user = True
    for f in range(0, N + 1):
        s = _pose_from(arm, src, f0 + f, base, f)
        _key_pose(arm, base, s, f)
    _assign(arm, base)
    hm = {}
    for f in range(0, N + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        pb = arm.pose.bones['hand_r']
        hm[f] = (arm.matrix_world @ pb.matrix).copy()
    grip0 = _world(arm, 'hand_r')
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    desired = (hm[0] @ Vector((0, 0, 0))) + Vector((0.0, -0.5, -0.03))
    local = hm[0].inverted() @ desired
    tgt = _empty('rifle_t', hm[0] @ local)
    for f in range(0, N + 1):
        _key_loc(tgt, f, hm[f] @ local)
    shoulder_l = _world(arm, 'upperarm_l')
    pole = _empty('rifle_pole', shoulder_l + Vector((0.5, 0.2, -0.5)))
    ang = _calibrate_pole(arm, 'l', hm[0] @ local, shoulder_l + Vector((0.25, 0.1, -0.25)), pole)
    print('RIFLE pole angle', ang)
    _assign(arm, base)
    _add_ik(arm, 'lowerarm_l', tgt, pole, math.radians(ang))
    act = _bake(arm, out_name, 0, N)
    _cleanup(tgt, pole, base)
    return act
