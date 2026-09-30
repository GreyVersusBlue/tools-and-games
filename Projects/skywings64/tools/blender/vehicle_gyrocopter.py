"""Build gyrocopter.glb: yellow/red pod fuselage, windscreen, mast, 2-blade main rotor, pusher prop,
tail fin/stabiliser, 3 wheels, seated pilot. "rotor" and "prop" are separate top-level empties whose
pivots sit at the rotation axis (rotor hub at local (0,2.2,0.28); prop hub at local (0,0.32,1.62)),
matching src/vehicles/gyrocopter.js so the game can spin them directly.
"""
import sys, os, math, mathutils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sw_common import *

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'gyrocopter.glb'))

clear_scene()

mat_yellow = make_material('Yellow', (1.0, 0.77, 0.0), roughness=0.3)
mat_red = make_material('Red', (0.91, 0.2, 0.16), roughness=0.35)
mat_white = make_material('White', (0.95, 0.95, 0.94), roughness=0.35)
mat_dark = make_material('Dark', (0.14, 0.15, 0.17), roughness=0.55, metallic=0.3)
mat_alu = make_material('Aluminium', (0.75, 0.76, 0.78), roughness=0.35, metallic=0.85)
mat_chrome = make_material('Chrome', (0.9, 0.91, 0.93), roughness=0.08, metallic=1.0)
mat_glass = make_material('Glass', (0.66, 0.86, 1.0), roughness=0.05, metallic=0.0, alpha=0.35)
mat_tire = make_material('Tire', (0.06, 0.06, 0.07), roughness=0.85)
mat_wood = make_material('Wood', (0.69, 0.48, 0.24), roughness=0.4)
mat_suit = make_material('PilotSuit', (0.13, 0.64, 0.35), roughness=0.6)
mat_helmet = make_material('PilotHelmet', (1.0, 0.58, 0.0), roughness=0.3)
mat_skin = make_material('Skin', (0.85, 0.63, 0.5), roughness=0.7)
mat_visor = make_material('Visor', (0.05, 0.08, 0.12), roughness=0.1, metallic=0.3)

body_meshes = []

def bm_add(o):
    body_meshes.append(o)
    return o

# fuselage pod (approx capsule)
pod = add_cyl('pod', 0.5, 3.0, (0, 0.15, -0.3), rot=(0, 0, 0), mat=mat_yellow, verts=16)
pod.scale = (0.72, 1.0, 0.66)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bm_add(pod)
nose_cone = add_cone('nose_cone', 0.001, 0.34, 0.5, (0, 0.13, -2.0), rot=(0, 0, 0), mat=mat_yellow, verts=16)
bm_add(nose_cone)
tail_cone = add_cone('tail_cone', 0.2, 0.001, 0.4, (0, 0.32, 1.3), rot=(0, 0, 0), mat=mat_yellow, verts=16)
bm_add(tail_cone)
deck = add_cyl('deck', 0.18, 0.9, (0, 0.5, 0.6), rot=(0, 0, 0), mat=mat_red, verts=12)
bm_add(deck)
rim = add_torus('cockpit_rim', 0.48, 0.03, (0, 0.5, -0.15), rot=(math.pi / 2, 0, 0), mat=mat_red, minor_segs=8)
bm_add(rim)
# windscreen
ws = add_sphere('windscreen', 0.48, (0, 0.55, -0.75), mat=mat_glass, scale=(0.62, 0.55, 0.75))
bm_add(ws)
ws_frame = add_torus('ws_frame', 0.44, 0.018, (0, 0.5, -0.53), rot=(0, 0, 0), mat=mat_chrome, minor_segs=6)
ws_frame.scale = (1, 0.4, 1)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bm_add(ws_frame)
dash = add_box('dash', (0.62, 0.05, 0.26), (0, 0.55, -0.68), mat=mat_dark)
bm_add(dash)

# seat
seat = add_box('seat', (0.52, 0.09, 0.44), (0, 0.34, 0.18), mat=make_material('Leather', (0.16, 0.12, 0.08), roughness=0.6))
bm_add(seat)
seat_back = add_box('seat_back', (0.52, 0.5, 0.09), (0, 0.62, 0.44), rot=(-0.15, 0, 0), mat=make_material('Leather2', (0.16, 0.12, 0.08), roughness=0.6))
bm_add(seat_back)

# --- pilot (seated), parented under body so it rides the pod
pilot_parts = []
torso = add_cyl('p_torso', 0.15, 0.5, (0, 0.7, 0.15), rot=(math.pi / 2, 0, 0), mat=mat_suit, verts=10)
pilot_parts.append(torso)
head = add_sphere('p_head', 0.1, (0, 1.06, 0.05), mat=mat_skin)
pilot_parts.append(head)
helmet = add_sphere('p_helmet', 0.125, (0, 1.08, 0.03), mat=mat_helmet, scale=(1, 1, 1.05))
pilot_parts.append(helmet)
visor = add_sphere('p_visor', 0.09, (0, 1.06, -0.05), mat=mat_visor, scale=(1, 0.6, 0.6))
pilot_parts.append(visor)
for s in (-1, 1):
    arm = add_cyl(f'p_arm_{"L" if s<0 else "R"}', 0.04, 0.42, (s * 0.19, 0.78, -0.1), rot=(1.0, 0, 0), mat=mat_suit, verts=8)
    pilot_parts.append(arm)
    thigh = add_cyl(f'p_thigh_{"L" if s<0 else "R"}', 0.055, 0.42, (s * 0.13, 0.48, 0.35), rot=(0, 0, 0), mat=mat_suit, verts=8)
    pilot_parts.append(thigh)
    shin = add_cyl(f'p_shin_{"L" if s<0 else "R"}', 0.05, 0.4, (s * 0.13, 0.28, 0.62), rot=(0.15, 0, 0), mat=mat_suit, verts=8)
    pilot_parts.append(shin)
for p in pilot_parts:
    shade_smooth(p)
body_meshes.extend(pilot_parts)

# control stick
stick = add_cyl('stick', 0.016, 0.5, (0, 0.75, -0.3), rot=(math.pi / 2 + 0.1, 0, 0), mat=mat_chrome, verts=8)
bm_add(stick)

# mast (support for rotor)
mast = add_cyl('mast', 0.075, 2.0, (0, 1.2, 0.28), rot=(math.pi / 2, 0, 0), mat=mat_white, verts=12)
bm_add(mast)
for s in (-1, 1):
    brace = None
    p0 = mathutils.Vector((s * 0.42, 0.28, 0.75))
    p1 = mathutils.Vector((s * 0.03, 2.0, 0.25))
    mid = (p0 + p1) / 2
    length = (p1 - p0).length
    brace = add_cyl(f'brace_{"L" if s<0 else "R"}', 0.03, length, mid, mat=mat_alu, verts=6)
    brace.rotation_mode = 'QUATERNION'
    brace.rotation_quaternion = mathutils.Vector((0, 0, 1)).rotation_difference(p1 - p0)
    bm_add(brace)

# engine block + exhaust
engine = add_cyl('engine', 0.22, 0.8, (0, 0.32, 1.1), rot=(0, 0, 0), mat=mat_dark, verts=12)
bm_add(engine)
for s in (-1, 1):
    cyl_ = add_cyl(f'engine_cyl_{"L" if s<0 else "R"}', 0.09, 0.22, (s * 0.3, 0.32, 1.2), rot=(0, math.pi / 2, 0), mat=mat_alu, verts=10)
    bm_add(cyl_)
pipe = add_cyl('exhaust_pipe', 0.032, 0.9, (0.45, 0.24, 1.6), rot=(math.pi / 2, 0, 0.2), mat=mat_chrome, verts=8)
bm_add(pipe)

# tail boom + fin + stabiliser
boom0 = mathutils.Vector((0, 0.3, 1.0))
boom1 = mathutils.Vector((0, 0.62, 3.3))
boom_len = (boom1 - boom0).length
boom = add_cyl('tail_boom', 0.075, boom_len, (boom0 + boom1) / 2, mat=mat_alu, verts=10)
boom.rotation_mode = 'QUATERNION'
boom.rotation_quaternion = mathutils.Vector((0, 0, 1)).rotation_difference(boom1 - boom0)
bm_add(boom)
fin = add_box('tail_fin', (0.03, 0.7, 0.5), (0, 0.85, 3.15), rot=(-0.12, 0, 0), mat=mat_red)
bm_add(fin)
stab = add_box('stabiliser', (1.5, 0.03, 0.28), (0, 0.66, 3.05), mat=mat_yellow)
bm_add(stab)
elevator = add_box('elevator', (1.5, 0.02, 0.16), (0, 0.66, 3.28), mat=mat_red)
bm_add(elevator)
rudder = add_box('rudder', (0.02, 0.55, 0.24), (0, 0.6, 3.45), mat=mat_white)
bm_add(rudder)

for m in body_meshes:
    shade_smooth(m)

# ---- landing gear: 3 wheels ----
gear_meshes = []
def make_wheel(name, loc, r, w):
    parts = []
    tire = add_torus(f'{name}_tire', r - w * 0.5, w * 0.5, loc, rot=(0, math.pi / 2, 0), mat=mat_tire, minor_segs=8)
    parts.append(tire)
    hub = add_cyl(f'{name}_hub', r * 0.55, w * 0.9, loc, rot=(0, math.pi / 2, 0), mat=mat_alu, verts=12)
    parts.append(hub)
    return parts

for s in (-1, 1):
    gear_meshes += make_wheel(f'wheel_{"L" if s<0 else "R"}', (s * 0.78, -0.76, 0.2), 0.25, 0.12)
    strut = mathutils.Vector((s * 0.3, -0.3, 0.28))
    wpos = mathutils.Vector((s * 0.78, -0.76, 0.2))
    strutlen = (wpos - strut).length
    strut_obj = add_cyl(f'strut_{"L" if s<0 else "R"}', 0.035, strutlen, (strut + wpos) / 2, mat=mat_alu, verts=6)
    strut_obj.rotation_mode = 'QUATERNION'
    strut_obj.rotation_quaternion = mathutils.Vector((0, 0, 1)).rotation_difference(wpos - strut)
    gear_meshes.append(strut_obj)
    fair = add_box(f'fairing_{"L" if s<0 else "R"}', (0.36, 0.16, 0.5), (s * 0.84, -0.76, 0.2), mat=mat_red)
    gear_meshes.append(fair)
gear_meshes += make_wheel('wheel_nose', (0, -0.8, -1.3), 0.2, 0.1)
fork = add_cyl('nose_fork', 0.03, 0.7, (0, -0.5, -1.22), rot=(math.pi / 2 + 0.15, 0, 0), mat=mat_alu, verts=6)
gear_meshes.append(fork)

for m in gear_meshes:
    shade_smooth(m)

all_body = body_meshes + gear_meshes
body_joined = join_all_meshes_into('gyro_body')
shade_smooth(body_joined, angle=math.radians(35))

# ---- rotor node (separate top-level object; pivot at hub) ----
rotor_empty = add_empty('rotor', (0, 2.2, 0.28), size=0.3)
rotor_hub = add_cyl('rotor_hub', 0.1, 0.16, (0, 0, 0), mat=mat_dark, verts=12)
parent_to(rotor_hub, rotor_empty)
rotor_hub.location = (0, 2.2, 0.28)
teeter = add_box('teeter_bar', (0.32, 0.035, 0.09), (0, 2.18, 0.28), mat=mat_chrome)
parent_to(teeter, rotor_empty)

blade_objs = []
blade_mats = [mat_red, mat_white]
for i in range(2):
    s = 1 if i == 0 else -1
    length = 3.62
    blade = add_box(f'blade_{i}', (length, 0.03, 0.15), (s * length / 2, 2.31, 0.28), mat=blade_mats[i])
    tipw = add_box(f'blade_tipw_{i}', (0.14, 0.02, 0.03), (s * (length - 0.07), 2.33, 0.24), mat=mat_chrome)
    blade_objs.append(blade)
    blade_objs.append(tipw)
    parent_to(blade, rotor_empty)
    parent_to(tipw, rotor_empty)

rotor_meshes = [rotor_hub, teeter] + blade_objs
for m in rotor_meshes:
    shade_smooth(m)
bpy.ops.object.select_all(action='DESELECT')
for m in rotor_meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = rotor_meshes[0]
bpy.ops.object.join()
rotor_joined = bpy.context.active_object
rotor_joined.name = 'rotor_mesh'
parent_to(rotor_joined, rotor_empty)

# ---- prop node (pusher prop, pivot at hub) ----
prop_empty = add_empty('prop', (0, 0.32, 1.62), size=0.15)
prop_objs = []
for i in range(2):
    ang = i * math.pi
    blade = add_box(f'prop_blade_{i}', (0.09, 0.92, 0.02), (0, 0.32, 1.62), mat=mat_wood)
    blade.rotation_mode = 'XYZ'
    blade.rotation_euler = (0, 0, ang)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    blade.location = (0, 0.32, 1.62)
    prop_objs.append(blade)
spinner = add_cone('spinner', 0.11, 0.001, 0.3, (0, 0.32, 1.47), rot=(0, 0, 0), mat=mat_red, verts=14)
prop_objs.append(spinner)
for m in prop_objs:
    shade_smooth(m)
    parent_to(m, prop_empty)
bpy.ops.object.select_all(action='DESELECT')
for m in prop_objs:
    m.select_set(True)
bpy.context.view_layer.objects.active = prop_objs[0]
bpy.ops.object.join()
prop_joined = bpy.context.active_object
prop_joined.name = 'prop_mesh'
parent_to(prop_joined, prop_empty)

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
bpy.context.collection.objects.link(sun)

all_meshes = [body_joined, rotor_joined, prop_joined]
bake_ao(all_meshes, image_size=512, samples=24)

fix_orientation([body_joined, rotor_empty, prop_empty])

export_objs = [body_joined, rotor_empty, prop_empty, rotor_joined, prop_joined]
export_glb(OUT, objects=export_objs)
report_stats(OUT)
print('GYROCOPTER_OK')
