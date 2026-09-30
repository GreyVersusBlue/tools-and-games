# The tavern set: the room behind the Guild Board, built at paintRoom()'s
# numbers (index.html, <tavern-scene>) and rendered through the room camera
# to assets/tavern/room.webp. The canvas draws the fire, its glow, the
# embers, the motes, the candles, the lantern, the door's night wash and every
# silhouette on top of this; the plate is the walls, the beams, the hearth,
# the door, the bar, the floor and the three tables, lit by a fire that is
# not in it. The near beams at the frame's edges stay the canvas's, since they
# sit in front of the walkers.
#
#   blender -b --factory-startup -t 4 -P blender/tavern.py -- [--preview] [--samples N] [--quality Q] [--encode]
#
# The three tables are not in the plate (#732 is closed by T2): they render
# as their own alpha crops, assets/tavern/table-N.webp, from this same scene.
# The plate pass hides them from the camera and leaves them casting shadows, so
# their shadow is in the plate and the page only has to draw the table over
# it; the table pass hides everything else from the camera and leaves it
# lighting them. --plate-only and --tables-only run one of the two.
#
# --preview renders at a quarter size to out/room-preview.png and writes no
# plate, for looking at while tuning. A full run renders once to
# out/room.png (lossless, untracked) and encodes the plate from it as WebP at
# --quality (82 unless given); --encode re-encodes that master without
# rendering, which is how the plate is fitted under its byte cap. Every number in room units is the one
# the canvas uses; anything that stands off the wall goes through at_depth()
# so it lands where the canvas drew it.

import math
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

C.check_version()
scene = C.reset()
ARGS = C.args()
PREVIEW = '--preview' in ARGS
SAMPLES = int(ARGS[ARGS.index('--samples') + 1]) if '--samples' in ARGS else 256
QUALITY = int(ARGS[ARGS.index('--quality') + 1]) if '--quality' in ARGS else 82
TABLE_QUALITY = 90
ENCODE = '--encode' in ARGS
PLATE_ONLY = '--plate-only' in ARGS
TABLES_ONLY = '--tables-only' in ARGS

# the light, in watts, and the world's warm ambient
FIRE = 600
SPILL = 200
AMBIENT = 0.3

FLOOR = C.FLOOR
HX = C.ROOM['hearth'][0]
CAM = C.BUDGET['camera']
D = CAM['distance']
fx, fy, fw, fh = CAM['frame']
rx, rz, at = C.rx, C.rz, C.at_depth


# ---------------------------------------------------------------- materials

def shader(name, base, rough=0.8, build=None, spec=0.5):
    """A Principled material from an sRGB hex, with `build(nodes, links,
    bsdf)` free to wire textures into it."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = C.linear(base)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Specular IOR Level'].default_value = spec
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if build:
        build(nodes, links, bsdf)
    return mat


def coords(nodes):
    tc = nodes.new('ShaderNodeTexCoord')
    return tc.outputs['Object']


def bump(nodes, links, bsdf, height_out, strength=0.3, distance=0.02):
    b = nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = distance
    links.new(height_out, b.inputs['Height'])
    links.new(b.outputs['Normal'], bsdf.inputs['Normal'])


def mix_colour(nodes, links, fac_out, a, b):
    m = nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.inputs['A'].default_value = C.linear(a)
    m.inputs['B'].default_value = C.linear(b)
    links.new(fac_out, m.inputs['Factor'])
    return m.outputs['Result']


def plaster_build(nodes, links, bsdf):
    co = coords(nodes)
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 3.0
    n.inputs['Detail'].default_value = 6.0
    n.inputs['Roughness'].default_value = 0.7
    links.new(co, n.inputs['Vector'])
    links.new(mix_colour(nodes, links, n.outputs['Fac'], 0x9a7448, 0x6e4e2e), bsdf.inputs['Base Color'])
    bump(nodes, links, bsdf, n.outputs['Fac'], 0.25, 0.01)


def timber_build(nodes, links, bsdf):
    co = coords(nodes)
    w = nodes.new('ShaderNodeTexWave')
    w.wave_type = 'BANDS'
    w.bands_direction = 'Z'
    w.inputs['Scale'].default_value = 6.0
    w.inputs['Distortion'].default_value = 4.0
    w.inputs['Detail'].default_value = 3.0
    links.new(co, w.inputs['Vector'])
    links.new(mix_colour(nodes, links, w.outputs['Fac'], 0x2e1c0e, 0x1c1108), bsdf.inputs['Base Color'])
    bump(nodes, links, bsdf, w.outputs['Fac'], 0.15, 0.005)


def stone_build(nodes, links, bsdf):
    co = coords(nodes)
    br = nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.012
    br.inputs['Mortar Smooth'].default_value = 0.4
    br.inputs['Brick Width'].default_value = 52 * C.UNIT
    br.inputs['Row Height'].default_value = 42 * C.UNIT
    br.inputs['Color1'].default_value = C.linear(0x3a3026)
    br.inputs['Color2'].default_value = C.linear(0x2c241c)
    br.inputs['Mortar'].default_value = C.linear(0x1e1a14)
    # bricks laid across x by height: the texture reads x and z
    mp = nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (math.pi / 2, 0.0, 0.0)
    links.new(co, mp.inputs['Vector'])
    links.new(mp.outputs['Vector'], br.inputs['Vector'])
    n = nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 14.0
    n.inputs['Detail'].default_value = 5.0
    links.new(co, n.inputs['Vector'])
    m = nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.inputs['Factor'].default_value = 0.35
    links.new(br.outputs['Color'], m.inputs['A'])
    links.new(mix_colour(nodes, links, n.outputs['Fac'], 0x3e3428, 0x221c16), m.inputs['B'])
    links.new(m.outputs['Result'], bsdf.inputs['Base Color'])
    bump(nodes, links, bsdf, br.outputs['Fac'], 0.6, 0.02)


def floor_build(nodes, links, bsdf):
    co = coords(nodes)
    br = nodes.new('ShaderNodeTexBrick')      # planks: long along y, 0.34 m wide
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.006
    br.inputs['Mortar Smooth'].default_value = 0.2
    br.inputs['Brick Width'].default_value = 2.6
    br.inputs['Row Height'].default_value = 0.34
    br.inputs['Color1'].default_value = C.linear(0x4d3820)
    br.inputs['Color2'].default_value = C.linear(0x3f2d19)
    br.inputs['Mortar'].default_value = C.linear(0x120c06)
    mp = nodes.new('ShaderNodeMapping')          # rows along x, bricks along y
    mp.inputs['Rotation'].default_value = (0.0, 0.0, math.pi / 2)
    links.new(co, mp.inputs['Vector'])
    links.new(mp.outputs['Vector'], br.inputs['Vector'])
    w = nodes.new('ShaderNodeTexWave')            # grain along the plank
    w.wave_type = 'BANDS'
    w.bands_direction = 'X'
    w.inputs['Scale'].default_value = 9.0
    w.inputs['Distortion'].default_value = 6.0
    w.inputs['Detail'].default_value = 2.0
    links.new(co, w.inputs['Vector'])
    m = nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    links.new(w.outputs['Fac'], m.inputs['Factor'])
    links.new(br.outputs['Color'], m.inputs['A'])
    dk = nodes.new('ShaderNodeMix')
    dk.data_type = 'RGBA'
    dk.inputs['Factor'].default_value = 0.35
    links.new(br.outputs['Color'], dk.inputs['A'])
    dk.inputs['B'].default_value = C.linear(0x1a1108)
    links.new(dk.outputs['Result'], m.inputs['B'])
    links.new(m.outputs['Result'], bsdf.inputs['Base Color'])
    bump(nodes, links, bsdf, br.outputs['Fac'], 0.4, 0.01)


def door_build(nodes, links, bsdf):
    co = coords(nodes)
    br = nodes.new('ShaderNodeTexBrick')      # vertical planks 30 units wide
    br.inputs['Scale'].default_value = 1.0
    br.inputs['Mortar Size'].default_value = 0.008
    br.inputs['Brick Width'].default_value = 4.0
    br.inputs['Row Height'].default_value = 30 * C.UNIT
    br.inputs['Color1'].default_value = C.linear(0x3a2712)
    br.inputs['Color2'].default_value = C.linear(0x30200f)
    br.inputs['Mortar'].default_value = C.linear(0x0c0803)
    mp = nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0.0, math.pi / 2, 0.0)
    links.new(co, mp.inputs['Vector'])
    links.new(mp.outputs['Vector'], br.inputs['Vector'])
    links.new(br.outputs['Color'], bsdf.inputs['Base Color'])
    bump(nodes, links, bsdf, br.outputs['Fac'], 0.5, 0.01)


plaster = shader('plaster', 0x8a6a42, 0.9, plaster_build, 0.2)
timber = shader('timber', 0x261708, 0.65, timber_build, 0.4)
stone = shader('stone', 0x5a5248, 0.85, stone_build, 0.3)
floor_m = shader('floor', 0x46321c, 0.75, floor_build, 0.25)
door_m = shader('door', 0x34220f, 0.6, door_build, 0.4)
soot = shader('soot', 0x000000, 1.0, None, 0.0)
iron = shader('iron', 0x17130f, 0.5, None, 0.6)
tabletop = shader('tabletop', 0x3d2a15, 0.5, timber_build, 0.5)
glass_g = shader('glass-green', 0x2c4a22, 0.15, None, 0.8)
glass_a = shader('glass-amber', 0x6a3f12, 0.15, None, 0.8)
glass_d = shader('glass-dark', 0x1c1410, 0.2, None, 0.8)
pewter = shader('pewter', 0x4a4540, 0.35, None, 0.7)
pewter.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.7
iron.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.6


# ---------------------------------------------------------------- shapes

def obj(name, bm, mat, smooth=False):
    return C.mesh_object(name, bm, [mat], smooth=smooth)


def wall_box(bm, x0, y0, x1, y1, y_front, y_back=0.0):
    """A box on the wall plane: room x0..x1, room y0..y1 (y0 above y1),
    from depth y_front (in front of the wall, negative) to y_back."""
    C.box(bm, (rx(x0), y_front, rz(y1)), (rx(x1), y_back, rz(y0)))


def arch(x0, x1, y_spring, y_ctrl, n=18):
    """The quadratic arch the canvas draws: from (x0, y_spring) through the
    control point (mid, y_ctrl) to (x1, y_spring), as room (x, y) points
    left to right."""
    mx = (x0 + x1) / 2
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t * t * x1
        y = (1 - t) ** 2 * y_spring + 2 * (1 - t) * t * y_ctrl + t * t * y_spring
        pts.append((x, y))
    return pts


def prism(name, profile, y_front, y_back, mat, depth_fix=None):
    """A closed room-plane profile (a list of (x, y), any winding) extruded
    from depth y_front to y_back. With depth_fix, the front face is placed
    through at_depth(.., y_front) so it projects to the profile exactly and
    the back face through at_depth(.., y_back)."""
    bm = bmesh.new()
    if depth_fix:
        front = [bm.verts.new(at(x, y, y_front)) for x, y in profile]
        back = [bm.verts.new(at(x, y, y_back)) for x, y in profile]
    else:
        front = [bm.verts.new((rx(x), y_front, rz(y))) for x, y in profile]
        back = [bm.verts.new((rx(x), y_back, rz(y))) for x, y in profile]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new([front[i], front[j], back[j], back[i]]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return obj(name, bm, mat)


def cut(target, cutter):
    """target minus cutter, applied; the cutter is deleted."""
    mod = target.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(cutter)


def cylinder(bm, x, y_bottom, y_top, r, depth, segs=12, mat_slot=0):
    """A vertical cylinder standing on room y_bottom at depth, radius r in
    room units, top at room y_top, placed through at_depth()."""
    base = Vector(at(x, y_bottom, depth))
    top = Vector(at(x, y_top, depth))
    k = (depth + D) / D
    C.cone(bm, r * C.UNIT * k, r * C.UNIT * k, (top - base).length,
           C.Matrix.Translation((base + top) / 2), segs)


# ---------------------------------------------------------------- the room

# back wall, from well below the seam to well above the frame
bm = bmesh.new()
C.box(bm, (rx(fx - 100), 0.0, rz(fy + fh + 100)), (rx(fx + fw + 100), 0.12, rz(fy - 100)))
wall = obj('wall', bm, plaster)

# studs every 176 from -100, 22 wide, under the top plate
bm = bmesh.new()
x = -100
while x < fx + fw + 100:
    wall_box(bm, x, 122, x + 22, FLOOR + 10, -0.05)
    x += 176
# top plate at 96..122, and the sill beam along the seam
wall_box(bm, fx - 100, 96, fx + fw + 100, 122, -0.07)
wall_box(bm, fx - 100, FLOOR - 8, fx + fw + 100, FLOOR + 6, -0.04)
obj('studs', bm, timber)

# joist ends above the top plate, every 300 from -60, coming forward
bm = bmesh.new()
x = -60
while x < fx + fw + 100:
    C.box(bm, (rx(x), -1.6, rz(130)), (rx(x + 46), 0.0, rz(96)))
    x += 300
obj('joists', bm, timber)

# floor, wall to camera
bm = bmesh.new()
C.box(bm, (rx(fx - 400), -D - 1.0, -0.06), (rx(fx + fw + 400), 0.0, 0.0))
obj('floor', bm, floor_m)

# ---- hearth: surround block, cut by the firebox arch, cavity behind
SURR = 0.34
surround = prism('surround', [
    (HX - 190, FLOOR + 10), (HX - 190, 300), (HX - 150, 246), (HX + 150, 246),
    (HX + 190, 300), (HX + 190, FLOOR + 10)], -SURR, 0.0, stone, depth_fix=True)
firebox = arch(HX - 112, HX + 112, 412, 322)
firebox_profile = [(HX - 112, FLOOR + 30)] + firebox + [(HX + 112, FLOOR + 30)]
cut(surround, prism('firebox-cut', firebox_profile, -SURR - 0.1, 0.9, soot, depth_fix=True))
cut(wall, prism('firebox-cut2', firebox_profile, -0.05, 0.9, soot, depth_fix=True))
# the cavity: a box open to the front, sooted
bm = bmesh.new()
lo = at(HX - 130, FLOOR + 2, -SURR)
hi = at(HX + 130, 330, 0.8)
C.box(bm, (lo[0], -SURR + 0.02, -0.02), (hi[0], 0.8, hi[2]))
cavity = obj('cavity', bm, soot)
# take the cavity's front face off so the inside shows
bm = bmesh.new()
bm.from_mesh(cavity.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y < -0.5], context='FACES')
bm.to_mesh(cavity.data)
bm.free()
# hearth floor slab and the two logs the canvas draws over
bm = bmesh.new()
lo = at(HX - 118, FLOOR + 6, -SURR - 0.02)
C.box(bm, (lo[0], -SURR - 0.02, -0.01), (at(HX + 118, FLOOR, 0.2)[0], 0.3, 0.02))
obj('hearth-slab', bm, stone)
# mantel
bm = bmesh.new()
lo = at(HX - 206, 254, -0.44)
hi = at(HX + 206, 228, -0.44)
C.box(bm, (lo[0], -0.44, lo[2]), (hi[0], 0.0, hi[2]))
obj('mantel', bm, timber)

# ---- door: frame with an arch, planked leaf, two bands, a ring
outer = arch(872, 1040, 392, 322)
inner = arch(890, 1022, 400, 342)
frame_profile = ([(872, FLOOR + 4)] + outer + [(1040, FLOOR + 4), (1022, FLOOR + 4)]
                 + list(reversed(inner)) + [(890, FLOOR + 4)])
prism('door-frame', frame_profile, -0.09, 0.0, timber)
leaf_profile = [(890, FLOOR + 4)] + inner + [(1022, FLOOR + 4)]
prism('door-leaf', leaf_profile, -0.015, 0.03, door_m)
bm = bmesh.new()
wall_box(bm, 894, 424, 1018, 436, -0.03)
wall_box(bm, 894, 556, 1018, 568, -0.03)
obj('door-bands', bm, iron)
bpy.ops.mesh.primitive_torus_add(major_radius=6 * C.UNIT, minor_radius=1.6 * C.UNIT,
                                 location=(rx(1006), -0.035, rz(500)),
                                 rotation=(math.pi / 2, 0.0, 0.0), major_segments=20, minor_segments=8)
ring = bpy.context.active_object
ring.name = 'door-ring'
ring.data.materials.append(iron)

# ---- bar: counter front at the depth that projects its base to 646
BAR_Y = C.depth_for(646)
bm = bmesh.new()
c0 = at(1096, 646, BAR_Y)
c1 = at(fx + fw + 100, 496, BAR_Y)
C.box(bm, (c0[0], BAR_Y, -0.02), (c1[0], 0.0, c1[2]))                   # the body
top = C.box(bm, (c0[0] - 0.03, BAR_Y - 0.04, c1[2]), (c1[0], 0.0, c1[2] + 0.05))
obj('bar', bm, timber)
bm = bmesh.new()
C.box(bm, (c0[0] - 0.03, BAR_Y - 0.04, c1[2] + 0.05), (c1[0], 0.0, c1[2] + 0.06))
obj('bar-top', bm, tabletop)
# kick rail and a shadow line under the counter's lip
bm = bmesh.new()
C.box(bm, (c0[0] - 0.01, BAR_Y - 0.02, 0.0), (c1[0], BAR_Y + 0.06, 0.09))
obj('bar-kick', bm, iron)

# shelf at 300 with bottles, hanging mugs over the bar
bm = bmesh.new()
wall_box(bm, 1180, 300, fx + fw + 100, 316, -0.26)
wall_box(bm, 1180, 316, 1186, 340, -0.26, -0.2)
obj('shelf', bm, timber)
for i in range(12):
    bx = 1210 + i * 34 + (i % 3) * 4 + 6.5
    bh = 30 + (i % 4) * 12
    bm = bmesh.new()
    cylinder(bm, bx, 300, 300 - bh, 6.5, -0.13, 10)
    cylinder(bm, bx, 300 - bh, 300 - bh - 9, 2.5, -0.13, 8)
    obj(f'bottle-{i}', bm, (glass_g, glass_a, glass_d)[i % 3], smooth=True)
bm = bmesh.new()
wall_box(bm, 1150, 170, 1560, 178, -0.34, -0.28)
obj('mug-rail', bm, timber)
for m in range(7):
    mx = 1170 + m * 58 + 2
    bm = bmesh.new()
    cylinder(bm, mx, 198, 176, 1.5, -0.31, 6)              # the hook
    cylinder(bm, mx, 222, 198, 10, -0.31, 12)              # the mug
    lo = at(mx + 10, 214, -0.31)
    hi = at(mx + 16, 202, -0.31)
    C.box(bm, (lo[0], -0.325, lo[2]), (hi[0], -0.295, hi[2]))   # its handle
    obj(f'mug-{m}', bm, pewter, smooth=True)

# ---- the three tables: a round top on a post and a foot, at the depth
# whose floor point is the canvas's base ellipse, sized to project as drawn.
# The top surface is the canvas's ellipse exactly; what makes them read as
# tables rather than discs on sticks is under it: a 5 cm slab with a
# moulded underside, a turned post with a collar at each end, and a stepped
# pedestal foot. Each is rendered as its own crop (budget.json's table-N
# `rect`, which has to hold the whole of this: a tankard above the top, the
# foot's base below it); a change here that grows past the rect is cut off.
TABLES = [(706, 720, 92), (1078, 786, 106), (452, 862, 118)]
SLAB = 0.05
for i, (tx, ty, r) in enumerate(TABLES):
    y_base = ty + r * 0.55
    Y = C.depth_for(y_base)
    k = (Y + D) / D
    R = r * C.UNIT * k
    centre = Vector(at(tx, y_base, Y))
    top_c = Vector(at(tx, ty - r * 0.1, Y))
    bm = bmesh.new()
    C.cone(bm, R, R, SLAB, C.Matrix.Translation((top_c.x, top_c.y, top_c.z - SLAB / 2)), 40)
    C.cone(bm, R * 0.97, R * 0.9, 0.02, C.Matrix.Translation((top_c.x, top_c.y, top_c.z - SLAB - 0.01)), 40)
    obj(f'table-{i}-top', bm, tabletop, smooth=True)
    bm = bmesh.new()
    post_r = r * 0.12 * C.UNIT * k
    under = top_c.z - SLAB - 0.02
    foot_h = 0.07
    at_c = lambda z: C.Matrix.Translation((centre.x, centre.y, z))  # noqa: E731
    C.cone(bm, post_r * 0.8, post_r, under - foot_h - 0.12, at_c((under + foot_h) / 2), 16)
    C.cone(bm, post_r * 1.3, post_r * 1.3, 0.06, at_c(under - 0.03), 16)            # top collar
    C.cone(bm, post_r * 1.25, post_r * 1.1, 0.06, at_c(foot_h + 0.03), 16)          # bottom collar
    C.cone(bm, R * 0.5, R * 0.42, foot_h * 0.6, at_c(foot_h * 0.3), 28)             # the foot, stepped
    C.cone(bm, R * 0.34, R * 0.26, foot_h * 0.4, at_c(foot_h * 0.8), 28)
    obj(f'table-{i}-base', bm, timber, smooth=True)
    # plates, bread and tankards where the canvas puts them
    bm = bmesh.new()
    zt = top_c.z
    for (ox, oy, pr) in ((-0.42, -0.14, 0.2), (0.44, -0.10, 0.17)):
        p = at(tx + r * ox, ty - r * 0.1 + r * oy * 0.28 / 0.28, Y)
        C.cone(bm, r * pr * C.UNIT * k, r * pr * C.UNIT * k, 0.008,
               C.Matrix.Translation((p[0], p[1] + r * oy * C.UNIT * k * 3.2, zt + 0.004)), 14)
    obj(f'table-{i}-plates', bm, pewter, smooth=True)
    bm = bmesh.new()
    for (ox, w, h) in ((-0.12, 0.11, 0.2), (0.12, 0.1, 0.19)):
        p = at(tx + r * (ox + w / 2), ty, Y)
        rr = r * w / 2 * C.UNIT * k
        hh = r * h * C.UNIT * k * 0.9
        C.cone(bm, rr, rr, hh, C.Matrix.Translation((p[0], p[1] - r * 0.3 * C.UNIT * k, zt + hh / 2)), 10)
    obj(f'table-{i}-mugs', bm, pewter, smooth=True)


# ---------------------------------------------------------------- light

def light(name, kind, loc, colour, energy, size=0.3, rot=None):
    data = bpy.data.lights.new(name, kind)
    data.color = colour
    data.energy = energy
    if kind == 'POINT':
        data.shadow_soft_size = size
    elif kind == 'AREA':
        data.size = size
    ob = bpy.data.objects.new(name, data)
    scene.collection.objects.link(ob)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    return ob


# the fire: the canvas draws it in the firebox mouth, so its light stands
# just in front of the surround, where it can reach the room; a low ember
# glow on the hearth floor; and a broad dim spill a few metres out, standing
# in for the fire's bounce, so the far wall and the walk lanes are lit the
# way the canvas's glow gradient lights them rather than falling off to black
light('fire', 'POINT', at(HX, 500, -SURR - 0.3), (1.0, 0.5, 0.2), FIRE, 0.6)
light('embers', 'POINT', at(HX, 600, -SURR - 0.15), (1.0, 0.36, 0.1), FIRE * 0.06, 0.5)
light('spill', 'POINT', at(HX + 260, 560, -3.0), (1.0, 0.56, 0.26), SPILL, 2.0)
# the lantern over the bar: the canvas draws the lantern, the plate its pool
light('lantern', 'POINT', at(1230, 175, -0.6), (1.0, 0.72, 0.42), 70, 0.35)
# candles on the tables, where the canvas draws them
for (tx, ty, r) in TABLES:
    Y = C.depth_for(ty + r * 0.55)
    p = at(tx + r * 0.18, ty - r * 0.16 - 26, Y)
    light('candle', 'POINT', (p[0], p[1], p[2]), (1.0, 0.74, 0.45), 6, 0.03)
# a cool fill from the door's side, for separation, faint
light('fill', 'AREA', (rx(1300), -9.0, 4.0), (0.55, 0.62, 0.8), 40, 6.0, (math.radians(70), 0.0, math.radians(20)))

scene.world = bpy.data.worlds.new('night')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.012, 0.006, 1.0)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = AMBIENT

# ---------------------------------------------------------------- render

C.room_camera(scene)
scene.view_settings.exposure = 0.0
plate = C.BUDGET['plates']['room']
master = os.path.join(C.OUT, 'room.png')
dest = os.path.join(C.SITE, plate['file'])


def encode(image):
    """The plate is the master's pixels as a lossy WebP at QUALITY. The view
    transform is set here too, because --encode never goes through
    C.render(), and Blender 5's default AgX darkens a re-saved PNG by up to
    9 levels in the shadows."""
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    s = scene.render.image_settings
    s.file_format = 'WEBP'
    s.color_mode = 'RGB'
    s.quality = QUALITY
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    image.save_render(dest, scene=scene)
    print(f'tavern: wrote {dest} at quality {QUALITY}, {os.path.getsize(dest)} bytes')


def visibility(tables, rest):
    for ob in scene.objects:
        if ob.type == 'MESH':
            ob.visible_camera = tables if ob.name.startswith('table-') else rest


def render_tables():
    """Each table cut out of a plate-sized frame at the plate's own pixels:
    the crop is budget.json's `rect` in room units, turned into plate pixels
    and then into the fractions Blender's border wants."""
    visibility(True, False)
    sx, sy = plate['width'] / fw, plate['height'] / fh
    for i in range(len(TABLES)):
        p = C.BUDGET['plates'][f'table-{i}']
        x, y, w, h = p['rect']
        px0, py0 = round((x - fx) * sx), round((y - fy) * sy)
        px1, py1 = px0 + p['width'], py0 + p['height']
        path = os.path.join(C.SITE, p['file'])
        C.render(path, plate['width'], plate['height'], samples=SAMPLES, transparent=True, fmt='WEBP',
                 quality=TABLE_QUALITY, border=(px0 / plate['width'], py0 / plate['height'],
                                                px1 / plate['width'], py1 / plate['height']))
        im = bpy.data.images.load(path, check_existing=False)
        print(f'tavern: wrote {path}, {im.size[0]}x{im.size[1]} (budget {p["width"]}x{p["height"]}), {os.path.getsize(path)} bytes')
    visibility(True, True)


if PREVIEW:
    visibility(False, True)
    out = C.render(os.path.join(C.OUT, 'room-preview.png'), plate['width'], plate['height'],
                   samples=min(SAMPLES, 96), percent=25)
    print('tavern: wrote', out)
elif ENCODE:
    # re-encode the last full render without rendering again, to fit the
    # byte cap: --encode --quality N
    encode(bpy.data.images.load(master))
else:
    if not TABLES_ONLY:
        # one full render: a lossless master in out/ (untracked), then the plate
        visibility(False, True)
        C.render(master, plate['width'], plate['height'], samples=SAMPLES)
        print('tavern: wrote', master)
        encode(bpy.data.images['Render Result'])
    if not PLATE_ONLY:
        render_tables()
