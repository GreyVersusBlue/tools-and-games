"""Build rocket_pilot.glb: pilot figure with jet/rocket backpack (twin chrome tanks + nozzles), helmet
with visor, suit. leg_L / leg_R are separate nodes pivoted at the hip so the game can animate the kick.
nozzle_L / nozzle_R are empty nodes at the nozzle exit so vehicleFx flame groups line up.
Reference: src/vehicles/rocketBelt.js — pilot at (0,-1.0,0); nozzles at world (+-0.2, -0.55, 0.4).
"""
import sys, os, math, mathutils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sw_common import *

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'rocket_pilot.glb'))

clear_scene()

mat_suit = make_material('Suit', (1.0, 0.48, 0.1), roughness=0.55)
mat_helmet = make_material('Helmet', (1.0, 0.84, 0.02), roughness=0.3)
mat_visor = make_material('Visor', (0.05, 0.1, 0.16), roughness=0.08, metallic=0.4)
mat_skin = make_material('Skin', (0.85, 0.63, 0.5), roughness=0.7)
mat_dark = make_material('Dark', (0.16, 0.18, 0.2), roughness=0.5, metallic=0.5)
mat_chrome = make_material('Chrome', (0.9, 0.91, 0.93), roughness=0.08, metallic=1.0)
mat_gold = make_material('Gold', (0.85, 0.66, 0.22), roughness=0.25, metallic=1.0)
mat_stripe = make_material('Stripe', (0.17, 0.44, 1.0), roughness=0.4)
mat_boot = make_material('Boot', (0.12, 0.12, 0.14), roughness=0.6)

fixed_meshes = []

# torso / suit
torso = add_cyl('torso', 0.19, 0.62, (0, -0.55, 0), rot=(math.pi / 2, 0, 0), mat=mat_suit, verts=12)
fixed_meshes.append(torso)
belt = add_torus('belt', 0.2, 0.035, (0, -0.82, 0), rot=(math.pi / 2, 0, 0), mat=mat_stripe, minor_segs=8)
fixed_meshes.append(belt)
chest_stripe = add_box('chest_stripe', (0.3, 0.1, 0.05), (0, -0.4, -0.18), mat=mat_stripe)
fixed_meshes.append(chest_stripe)

# head/helmet
head = add_sphere('head', 0.115, (0, -0.08, 0), mat=mat_skin)
fixed_meshes.append(head)
helmet = add_sphere('helmet', 0.145, (0, -0.06, 0), mat=mat_helmet, scale=(1, 1.05, 1.05))
fixed_meshes.append(helmet)
visor = add_sphere('visor', 0.11, (0, -0.05, -0.06), mat=mat_visor, scale=(0.95, 0.65, 0.7))
fixed_meshes.append(visor)

# arms
for s in (-1, 1):
    tag = 'L' if s < 0 else 'R'
    upper = add_cyl(f'arm_upper_{tag}', 0.05, 0.32, (s * 0.26, -0.5, 0), rot=(math.pi / 2 - 0.3, 0, s * 0.3), mat=mat_suit, verts=8)
    fixed_meshes.append(upper)
    lower = add_cyl(f'arm_lower_{tag}', 0.045, 0.3, (s * 0.38, -0.78, 0.05), rot=(math.pi / 2 + 0.3, 0, s * 0.1), mat=mat_suit, verts=8)
    fixed_meshes.append(lower)
    glove = add_sphere(f'glove_{tag}', 0.055, (s * 0.42, -0.95, 0.12), mat=mat_boot)
    fixed_meshes.append(glove)

for m in fixed_meshes:
    shade_smooth(m)

# ---- legs: separate top-level nodes leg_L / leg_R, pivot at hip (0, -0.82, 0) ----
HIP_Y = -0.82
leg_meshes_by_side = {}
for s, tag in ((-1, 'L'), (1, 'R')):
    leg_empty = add_empty(f'leg_{tag}', (s * 0.11, HIP_Y, 0), size=0.1)
    thigh = add_cyl(f'thigh_{tag}', 0.075, 0.42, (s * 0.11, HIP_Y - 0.21, 0), rot=(math.pi / 2, 0, 0), mat=mat_suit, verts=10)
    shin = add_cyl(f'shin_{tag}', 0.065, 0.4, (s * 0.11, HIP_Y - 0.62, 0.02), rot=(math.pi / 2 + 0.08, 0, 0), mat=mat_suit, verts=10)
    boot = add_box(f'boot_{tag}', (0.1, 0.12, 0.26), (s * 0.11, HIP_Y - 0.86, 0.06), mat=mat_boot)
    for m in (thigh, shin, boot):
        shade_smooth(m)
        parent_to(m, leg_empty)
    bpy.ops.object.select_all(action='DESELECT')
    for m in (thigh, shin, boot):
        m.select_set(True)
    bpy.context.view_layer.objects.active = thigh
    bpy.ops.object.join()
    leg_mesh = bpy.context.active_object
    leg_mesh.name = f'leg_{tag}_mesh'
    parent_to(leg_mesh, leg_empty)
    leg_meshes_by_side[tag] = (leg_empty, leg_mesh)

# ---- backpack: back plate, twin chrome tanks, nozzles ----
pack_meshes = []
back_plate = add_box('back_plate', (0.56, 0.72, 0.09), (0, -0.4, 0.24), mat=mat_dark)
pack_meshes.append(back_plate)
top_bar = add_box('pack_top', (0.5, 0.06, 0.16), (0, -0.04, 0.29), mat=mat_stripe)
pack_meshes.append(top_bar)
tank_positions = {}
for s in (-1, 1):
    tag = 'L' if s < 0 else 'R'
    x = s * 0.2
    tank = add_cyl(f'tank_{tag}', 0.15, 1.0, (x, -0.52, 0.4), rot=(math.pi / 2, 0, 0), mat=mat_chrome, verts=16)
    pack_meshes.append(tank)
    for y in (-0.72, -0.24):
        ring = add_torus(f'ring_{tag}_{int(-y*100)}', 0.152, 0.014, (x, y, 0.4), rot=(math.pi / 2, 0, 0), mat=mat_stripe, minor_segs=8)
        pack_meshes.append(ring)
    valve = add_cyl(f'valve_{tag}', 0.03, 0.12, (x, -0.03, 0.4), rot=(math.pi / 2, 0, 0), mat=mat_gold, verts=10)
    pack_meshes.append(valve)
    plumb = add_cyl(f'plumb_{tag}', 0.02, 0.26, (x, -0.85, 0.4), rot=(math.pi / 2, 0, 0), mat=mat_dark, verts=8)
    pack_meshes.append(plumb)
    tank_positions[tag] = x

for m in pack_meshes:
    shade_smooth(m)
bpy.ops.object.select_all(action='DESELECT')
for m in fixed_meshes + pack_meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = fixed_meshes[0]
bpy.ops.object.join()
body_joined = bpy.context.active_object
body_joined.name = 'rocket_pilot_body'
shade_smooth(body_joined, angle=math.radians(35))

# ---- nozzles: visible geometry + named empty nodes at the exit point for FX flame alignment ----
nozzle_meshes = []
nozzle_empties = []
for s in (-1, 1):
    tag = 'L' if s < 0 else 'R'
    x = s * 0.2
    noz = add_cone('nozzle_' + tag + '_mesh', 0.15, 0.055, 0.25, (x, -1.0, 0.4), rot=(math.pi / 2, 0, 0), mat=make_material('NozzleAlu_' + tag, (0.6, 0.63, 0.68), roughness=0.4, metallic=0.8), verts=16)
    shade_smooth(noz)
    nozzle_meshes.append(noz)
    nring = add_torus('nozzle_ring_' + tag, 0.15, 0.014, (x, -1.1, 0.4), rot=(math.pi / 2, 0, 0), mat=mat_gold, minor_segs=8)
    shade_smooth(nring)
    nozzle_meshes.append(nring)
    ne = add_empty('nozzle_' + tag, (x, -1.15, 0.4), size=0.08)
    nozzle_empties.append(ne)

bpy.ops.object.select_all(action='DESELECT')
for m in nozzle_meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = nozzle_meshes[0]
bpy.ops.object.join()
nozzle_joined = bpy.context.active_object
nozzle_joined.name = 'nozzles_mesh'

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
bpy.context.collection.objects.link(sun)

leg_L_mesh = leg_meshes_by_side['L'][1]
leg_R_mesh = leg_meshes_by_side['R'][1]
all_meshes = [body_joined, leg_L_mesh, leg_R_mesh, nozzle_joined]
bake_ao(all_meshes, image_size=512, samples=24)

fix_orientation([body_joined, leg_meshes_by_side['L'][0], leg_meshes_by_side['R'][0],
                  nozzle_joined, nozzle_empties[0], nozzle_empties[1]])

export_objs = [body_joined, leg_meshes_by_side['L'][0], leg_meshes_by_side['R'][0], leg_L_mesh, leg_R_mesh,
               nozzle_joined, nozzle_empties[0], nozzle_empties[1]]
export_glb(OUT, objects=export_objs)
report_stats(OUT)
print('ROCKET_PILOT_OK')
