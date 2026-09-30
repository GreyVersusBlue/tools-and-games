"""Build hang_glider.glb: delta wing sail, A-frame control bar, keel, cables, prone pilot.
Scale reference from src/vehicles/hangGlider.js: semi-span 4.7m (full span ~9.4m), keel nose z=-2.72
to tail z=1.2 (local +z = nose-to-tail direction *away* from travel; glider forward = -Z in three.js
mesh space -> nose points -Z). Control bar base at y=-1.3, x=+-0.88, z=-1.02. Kingpost top y=1.2.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sw_common import *

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'hang_glider.glb')
OUT = os.path.normpath(OUT)

clear_scene()

mat_sail_red = make_material('SailRed', (0.85, 0.08, 0.06), roughness=0.55)
mat_sail_yellow = make_material('SailYellow', (1.0, 0.78, 0.02), roughness=0.55)
mat_sail_white = make_material('SailWhite', (0.92, 0.92, 0.9), roughness=0.55)
mat_alu = make_material('Aluminium', (0.75, 0.76, 0.78), roughness=0.35, metallic=0.9)
mat_steel = make_material('Steel', (0.55, 0.56, 0.6), roughness=0.3, metallic=0.95)
mat_suit = make_material('Suit', (0.1, 0.22, 0.65), roughness=0.6)
mat_helmet = make_material('Helmet', (0.95, 0.95, 0.95), roughness=0.3)
mat_skin = make_material('Skin', (0.85, 0.63, 0.5), roughness=0.7)
mat_visor = make_material('Visor', (0.05, 0.08, 0.12), roughness=0.1, metallic=0.3)
mat_bag = make_material('Bag', (1.0, 0.7, 0.0), roughness=0.5)

meshes = []

# ---- sail: build as two triangular wing halves with a curved trailing edge, using a bmesh grid ----
SPAN = 4.7
NS, NC = 10, 6

def sail_verts(sgn, mat, name):
    bm = bmesh.new()
    grid = {}
    for i in range(NS + 1):
        s = i / NS
        zle = -2.75 + s * 4.55
        zte = 1.15 + s * 0.7 - 0.3 * math.sin(math.pi * s) * (1 - s * 0.3)
        chord = zte - zle
        for j in range(NC + 1):
            c = j / NC
            y = 0.02 + s * 0.4
            y += 0.17 * math.sin(math.pi * (c ** 0.75)) * (chord / 3.9) * (1 - 0.25 * s)
            y -= 0.1 * c * (1 - s)
            y += 0.25 * s * s * c
            x = sgn * s * SPAN
            z = zle + chord * c
            grid[(i, j)] = bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    for i in range(NS):
        for j in range(NC):
            a, b, c, d = grid[(i, j)], grid[(i + 1, j)], grid[(i, j + 1)], grid[(i + 1, j + 1)]
            if sgn > 0:
                bm.faces.new((a, b, d, c))
            else:
                bm.faces.new((a, c, d, b))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj

# right wing: 3 colour panels (root white, mid yellow, tip red) approximated with 3 separate meshes cut by span
def sail_panel(sgn, s0, s1, mat, name):
    bm = bmesh.new()
    grid = {}
    n = 5
    for ii in range(n + 1):
        s = s0 + (s1 - s0) * ii / n
        zle = -2.75 + s * 4.55
        zte = 1.15 + s * 0.7 - 0.3 * math.sin(math.pi * s) * (1 - s * 0.3)
        chord = zte - zle
        for j in range(NC + 1):
            c = j / NC
            y = 0.02 + s * 0.4
            y += 0.17 * math.sin(math.pi * (c ** 0.75)) * (chord / 3.9) * (1 - 0.25 * s)
            y -= 0.1 * c * (1 - s)
            y += 0.25 * s * s * c
            x = sgn * s * SPAN
            z = zle + chord * c
            grid[(ii, j)] = bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    for ii in range(n):
        for j in range(NC):
            a, b, c, d = grid[(ii, j)], grid[(ii + 1, j)], grid[(ii, j + 1)], grid[(ii + 1, j + 1)]
            if sgn > 0:
                bm.faces.new((a, b, d, c))
            else:
                bm.faces.new((a, c, d, b))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj

for sgn, tag in ((1, 'R'), (-1, 'L')):
    p1 = sail_panel(sgn, 0.0, 0.33, mat_sail_white, f'sail_root_{tag}')
    p2 = sail_panel(sgn, 0.33, 0.66, mat_sail_yellow, f'sail_mid_{tag}')
    p3 = sail_panel(sgn, 0.66, 1.0, mat_sail_red, f'sail_tip_{tag}')
    for p in (p1, p2, p3):
        shade_smooth(p)
        meshes.append(p)

# leading edge tubes (aluminium) along the LE curve for each wing
def le_point(sgn, s):
    zle = -2.75 + s * 4.55
    x = sgn * s * SPAN
    return (x, 0.008, zle)

for sgn, tag in ((1, 'R'), (-1, 'L')):
    N = 9
    for i in range(N):
        s0 = i / N
        s1 = (i + 1) / N
        p0 = le_point(sgn, s0)
        p1 = le_point(sgn, s1)
        mid = tuple((a + b) / 2 for a, b in zip(p0, p1))
        length = math.dist(p0, p1)
        dirv = tuple(b - a for a, b in zip(p0, p1))
        # orient cylinder (default along Z) to point along dirv
        yaw = math.atan2(dirv[0], dirv[2])
        pitch = math.atan2(-dirv[1], math.hypot(dirv[0], dirv[2]))
        rad = 0.048 - 0.024 * (i / N)
        obj = add_cyl(f'le_{tag}_{i}', rad, length, mid, rot=(pitch, 0, -yaw) if False else (0, 0, 0), mat=mat_alu, verts=8)
        # simpler: align using quaternion via track_to
        obj.rotation_mode = 'QUATERNION'
        import mathutils
        dvec = mathutils.Vector(dirv)
        obj.rotation_quaternion = mathutils.Vector((0, 0, 1)).rotation_difference(dvec)
        meshes.append(obj)

# keel tube (nose to tail)
K0 = (0, 0.0, -2.72)
K1 = (0, -0.07, 1.2)
def tube_between(name, p0, p1, r0, r1, mat, verts=8):
    import mathutils
    mid = tuple((a + b) / 2 for a, b in zip(p0, p1))
    length = math.dist(p0, p1)
    obj = add_cyl(name, (r0 + r1) / 2, length, mid, mat=mat, verts=verts)
    dvec = mathutils.Vector(tuple(b - a for a, b in zip(p0, p1)))
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = mathutils.Vector((0, 0, 1)).rotation_difference(dvec)
    return obj

keel = tube_between('keel', K0, K1, 0.05, 0.05, mat_alu)
meshes.append(keel)
nose = add_cone('nose_cap', 0.005, 0.13, 0.6, (0, 0.02, -3.0), rot=(math.pi / 2, 0, 0), mat=mat_sail_yellow, verts=10)
meshes.append(nose)

# kingpost
KP0 = (0, 0.0, -0.45)
KP1 = (0, 1.2, -0.45)
kingpost = tube_between('kingpost', KP0, KP1, 0.038, 0.038, mat_alu)
meshes.append(kingpost)
apex = add_sphere('kingpost_cap', 0.06, KP1, mat=mat_steel)
meshes.append(apex)

# top wires kingpost -> LE points + tail
for sgn, tag in ((1, 'R'), (-1, 'L')):
    for s in (0.72, 0.34):
        p = le_point(sgn, s)
        w = tube_between(f'wire_top_{tag}_{int(s*100)}', KP1, p, 0.008, 0.008, mat_steel, verts=5)
        meshes.append(w)
    w = tube_between(f'wire_rear_{tag}', KP1, (sgn * 1.2, -0.02, 1.0), 0.008, 0.008, mat_steel, verts=5)
    meshes.append(w)
w = tube_between('wire_tail', KP1, (0, -0.07, 1.2), 0.008, 0.008, mat_steel, verts=5)
meshes.append(w)

# control frame: downtubes + base bar
baseL = (-0.88, -1.3, -1.02)
baseR = (0.88, -1.3, -1.02)
for sgn, tag, base in ((1, 'R', baseR), (-1, 'L', baseL)):
    p = le_point(sgn, 0.27)
    dt = tube_between(f'downtube_{tag}', p, base, 0.032, 0.032, mat_alu)
    meshes.append(dt)
    cross = tube_between(f'crossbar_{tag}', le_point(sgn, 0.42), (0, -0.07, 0.55), 0.03, 0.03, mat_alu)
    meshes.append(cross)
basebar = tube_between('basebar', baseL, baseR, 0.03, 0.03, mat_alu)
meshes.append(basebar)
for s, base in ((-1, baseL), (1, baseR)):
    grip = tube_between(f'grip_{"L" if s<0 else "R"}', (s * 0.45, -1.3, -1.02), (s * 0.15, -1.3, -1.02), 0.042, 0.042, make_material('Grip', (0.08, 0.08, 0.09), roughness=0.9))
    meshes.append(grip)
    j = add_sphere(f'joint_{"L" if s<0 else "R"}', 0.045, base, mat=mat_steel)
    meshes.append(j)

# bottom flying wires
for sgn, tag, base in ((1, 'R', baseR), (-1, 'L', baseL)):
    w = tube_between(f'wire_bot_{tag}', base, le_point(sgn, 0.55), 0.008, 0.008, mat_steel, verts=5)
    meshes.append(w)
    w2 = tube_between(f'wire_nose_{tag}', base, (0, -0.02, -2.6), 0.008, 0.008, mat_steel, verts=5)
    meshes.append(w2)

# ---- pilot (prone, simplified capsule figure) ----
pilot_parts = []
torso = add_cyl('torso', 0.16, 0.62, (0, -0.9, 0.15), rot=(0, 0, 0), mat=mat_suit, verts=10)
pilot_parts.append(torso)
head = add_sphere('head_base', 0.11, (0, -0.86, -0.28), mat=mat_skin, scale=(1, 1, 1.05))
pilot_parts.append(head)
helmet = add_sphere('helmet', 0.135, (0, -0.85, -0.3), mat=mat_helmet, scale=(1, 1, 1.1))
pilot_parts.append(helmet)
visor = add_sphere('visor', 0.1, (0, -0.82, -0.37), mat=mat_visor, scale=(1, 0.6, 0.6))
pilot_parts.append(visor)
for s in (-1, 1):
    arm = add_cyl(f'arm_{"L" if s<0 else "R"}', 0.045, 0.55, (s * 0.2, -1.05, -0.15), rot=(2.4, 0, 0), mat=mat_suit, verts=8)
    pilot_parts.append(arm)
    hand = add_sphere(f'hand_{"L" if s<0 else "R"}', 0.05, (s * 0.2, -1.28, -0.45), mat=mat_skin)
    pilot_parts.append(hand)
    leg = add_cyl(f'leg_{"L" if s<0 else "R"}', 0.06, 0.7, (s * 0.1, -0.92, 0.75), rot=(0, 0, 0), mat=mat_suit, verts=8)
    pilot_parts.append(leg)
    boot = add_box(f'boot_{"L" if s<0 else "R"}', (0.09, 0.09, 0.2), (s * 0.1, -0.9, 1.15), mat=mat_helmet)
    pilot_parts.append(boot)
# harness / cocoon bag
bag = add_cyl('bag', 0.18, 0.95, (0, -0.95, 0.45), rot=(0, 0, 0), mat=mat_bag, verts=10)
pilot_parts.append(bag)
for p in pilot_parts:
    shade_smooth(p)
meshes.extend(pilot_parts)

for m in meshes:
    if m.data and m.data.polygons:
        shade_smooth(m)

joined = join_all_meshes_into('hang_glider')
shade_smooth(joined, angle=math.radians(35))

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
bpy.context.collection.objects.link(sun)

bake_ao([joined], image_size=512, samples=24)

fix_orientation([joined])

export_glb(OUT, objects=[joined])
report_stats(OUT)
print('HANG_GLIDER_OK')
