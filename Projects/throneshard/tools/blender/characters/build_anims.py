# Builds public/assets/models/chars/anims.glb: the shared 23-bone humanoid rig + every clip the game uses,
# taken from Quaternius' Universal Animation Library 1 + 2 (CC0). All character GLBs share these bone names,
# so one set of AnimationClips drives every hero/creep/neutral (see src/models/ModelFactory.js).
#   blender -b --python tools/blender/characters/build_anims.py -- <out.glb>
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from lib import *

CLIPS_UAL1 = ['Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Walk_Loop', 'Death01', 'Sword_Attack', 'Sword_Idle',
              'Spell_Simple_Shoot', 'Spell_Simple_Enter', 'Spell_Simple_Idle_Loop', 'Punch_Cross', 'Punch_Jab',
              'Pistol_Shoot', 'Pistol_Idle_Loop', 'Hit_Chest', 'Crouch_Idle_Loop', 'Jump_Start']
CLIPS_UAL2 = ['Sword_Regular_A', 'Sword_Regular_A_Rec', 'Sword_Regular_B', 'Sword_Regular_B_Rec', 'Sword_Regular_C',
              'Sword_Heavy_Combo', 'Melee_Hook', 'Melee_Hook_Rec', 'OverhandThrow', 'Shield_OneShot', 'Zombie_Scratch',
              'Zombie_Walk_Fwd_Loop', 'Zombie_Idle_Loop', 'Idle_Shield_Loop', 'Sword_Dash', 'TreeChopping_Loop',
              'Idle_FoldArms_Loop', 'Hit_Knockback', 'NinjaJump_Start', 'Consume']


def channelbag(action):
    from bpy_extras import anim_utils
    for slot in action.slots:
        cb = anim_utils.action_get_channelbag_for_slot(action, slot)
        if cb:
            return cb
    return None


def main(out):
    reset()
    a1 = import_gltf(UAL1)
    arm = armature_of(a1)
    keep_actions = set(CLIPS_UAL1)
    for a in list(bpy.data.actions):
        if a.name not in keep_actions:
            bpy.data.actions.remove(a)
    before = set(bpy.data.actions)
    a2 = import_gltf(UAL2)
    for a in list(bpy.data.actions):
        if a in before:
            continue
        if a.name not in CLIPS_UAL2:
            bpy.data.actions.remove(a)
    for o in a2:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    # strip bones + their curves
    strip_bones(arm, [])
    for a in bpy.data.actions:
        a.name = a.name.split('.')[0] if a.name.split('.')[0] in CLIPS_UAL1 + CLIPS_UAL2 else a.name
        cb = channelbag(a)
        if not cb:
            continue
        for fc in list(cb.fcurves):
            dp = fc.data_path
            if dp.startswith('pose.bones["'):
                bn = dp.split('"')[1]
                prop = dp.split('.')[-1]
                if bn not in KEEP_BONES or (prop in ('location', 'scale') and bn not in ('pelvis', 'root')):
                    cb.fcurves.remove(fc)
        a.use_fake_user = True
    # tiny placeholder mesh so the exporter emits a skin (joints) — removed again in JS
    bpy.ops.mesh.primitive_plane_add(size=0.01)
    p = bpy.context.active_object
    p.name = 'anim_stub'
    bind(p, arm, 'pelvis')
    arm.animation_data_create()
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)
    # push every action into its own NLA track so the exporter writes them all
    for a in bpy.data.actions:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = a.name
        st = tr.strips.new(a.name, int(a.frame_range[0]), a)
        tr.mute = True
    arm.animation_data.action = None
    select_only([arm, p], arm)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_force_sampling=False, export_frame_step=1,
                              export_optimize_animation_size=True, export_anim_single_armature=True,
                              export_def_bones=False, export_skins=True, export_materials='NONE')
    print('ANIMS', sorted(a.name for a in bpy.data.actions))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv[0] if argv else '/tmp/anims.glb')
