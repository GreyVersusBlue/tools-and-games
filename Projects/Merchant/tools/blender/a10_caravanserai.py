"""A10 a caravanserai at night: the inner court of a roadside inn for
caravans, from a corner of its upper gallery looking down and across, wide
lens, moonlight. Pointed arcades on two floors, one great gate in striped
stone with heavy studded wooden leaves, a basin in the middle; warm oil
lamps in the arches against cold moonlight on the stone; camels kneeling,
bales stacked, a few cloaked figures by a small fire far below.

    blender -b --factory-startup -P scripts/a10_caravanserai.py -- --preview
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_figures as F     # noqa: E402
import kit_props as P       # noqa: E402
import bpy                  # noqa: E402

HALF = 24.0                 # half the court's width (inner face of the arcades)
DEPTH = 4.5                 # depth of each arcade bay to the back wall
F1 = 5.6                    # height of the gallery floor
F2 = 10.2                   # roof
BAYS = 9
EXPOSURE = 1.6
LAMP_W = 30.0


def side(name, length, stone, dark, gate=False):
    """One side of the court, built along +X from -length/2 at y = 0 with
    the court toward -Y. Ground-floor and gallery arcades, back walls with
    dark cell doors, floor and roof slabs. Returns parts and lamp spots."""
    parts, lamps = [], []
    span = length / BAYS * 0.68
    ops1, ops2 = [], []
    for k in range(BAYS):
        cx = (k + 0.5) * length / BAYS
        if gate and k == BAYS // 2:
            continue
        ops1.append((cx, span, 2.7))
        ops2.append((cx, span * 0.9, 2.2))
    a1 = A.arched_panel(name + "_arc1", length, F1, 0.9, ops1, stone, "pointed")
    a2 = A.arched_panel(name + "_arc2", length, F2 - F1, 0.8, ops2, stone, "pointed")
    for p in (a1, a2):
        p.location = (-length / 2, 0.45, 0 if p is a1 else F1)
    parts += [a1, a2]
    for sf in A.soffits(name + "_sof1", ops1, 0.9, stone, "pointed"):
        sf.location = (-length / 2, 0.45, 0)
        parts.append(sf)
    for sf in A.soffits(name + "_sof2", ops2, 0.8, stone, "pointed"):
        sf.location = (-length / 2, 0.45, F1)
        parts.append(sf)
    # back wall, floor and roof slabs
    parts.append(C.box_mesh(name + "_back", (length, 0.8, F2), (0, DEPTH + 0.4, F2 / 2), stone))
    parts.append(C.box_mesh(name + "_gal", (length, DEPTH, 0.35), (0, DEPTH / 2, F1 - 0.17), stone))
    parts.append(C.box_mesh(name + "_roof", (length, DEPTH + 1.0, 0.45), (0, DEPTH / 2, F2 + 0.2), stone))
    parts.append(C.box_mesh(name + "_par", (length, 0.5, 0.9), (0, -0.2, F2 + 0.65), stone))
    # cell doors in the back wall, and lamp spots in some arches
    for k in range(BAYS):
        cx = -length / 2 + (k + 0.5) * length / BAYS
        if gate and k == BAYS // 2:
            continue
        for lvl, z0 in ((0, 0.0), (1, F1)):
            parts.append(C.box_mesh("%s_door%d_%d" % (name, lvl, k), (1.2, 0.1, 2.1), (cx, DEPTH - 0.02, z0 + 1.05), dark))
        lamps.append((cx, DEPTH * 0.55, 2.4))
        lamps.append((cx, DEPTH * 0.55, F1 + 2.1))
    return parts, lamps


def gate_block(stone, ablaq, wood, iron, length):
    """The great gate: a tall pointed arch through a projecting block that
    rises above the roof, faced in alternating light and dark courses,
    with heavy wooden leaves studded with iron, standing closed."""
    parts = []
    w, hgt, proj = 11.0, F2 + 3.5, 1.2
    span, spring = 5.2, 5.2
    face = A.arched_panel("GateFace", w, hgt, 1.2, [(w / 2, span, spring)], ablaq, "pointed")
    face.location = (-w / 2, -proj + 0.6, 0)
    parts.append(face)
    for sf in A.soffits("GateSoffit", [(w / 2, span, spring)], 1.2, ablaq, "pointed"):
        sf.location = (-w / 2, -proj + 0.6, 0)
        parts.append(sf)
    parts.append(C.box_mesh("GateTunnel", (span + 2.0, DEPTH + proj, 0.5), (0, DEPTH / 2 - proj / 2, spring + 3.4), stone))
    for s in (-1, 1):
        parts.append(C.box_mesh("GateSide%d" % s, (0.8, DEPTH + proj, spring + 3.0),
                                (s * (span / 2 + 0.4), DEPTH / 2 - proj / 2, (spring + 3.0) / 2), stone))
    # the leaves, closed, at the outer end of the passage
    for s in (-1, 1):
        lf = C.box_mesh("GateLeaf%d" % s, (span / 2 - 0.05, 0.25, spring + 1.2),
                        (s * span / 4, DEPTH - 0.3, (spring + 1.2) / 2), wood)
        parts.append(lf)
        for i in range(5):
            for j in range(9):
                st = C.lathe("Stud%d_%d_%d" % (s, i, j), [(0, 0), (0.045, 0), (0.035, 0.03), (0, 0.04)], 8, iron)
                st.rotation_euler = (math.radians(90), 0, 0)
                st.location = (s * (0.25 + i * (span / 2 - 0.5) / 4), DEPTH - 0.43, 0.5 + j * (spring + 0.2) / 8)
                parts.append(st)
    return parts


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    # a low moon (18 degrees, not the preset's 38): it rakes the far arcades
    # and leaves much of the court floor in the shadow of the near side
    C.sky("moon", sun_turn=-35.0, strength=7.0, elev=18.0)
    stone = C.M("pale_block", scale=0.35)
    ablaq = C.M("striped_stone", course=0.38, dark=(0.30, 0.26, 0.24))
    dark = C.M("dark", colour=(0.015, 0.012, 0.01))
    wood = C.M("plank_hull", colour=(0.20, 0.13, 0.08), plank=0.25)
    iron = C.M("dark", colour=(0.05, 0.05, 0.055))
    L = 2 * HALF
    all_lamps = []
    # four sides: rotate each about the court centre
    for k, rot in enumerate((0, 90, 180, 270)):
        g = k == 0
        parts, lamps = side("Side%d" % k, L, stone, dark, gate=g)
        if g:
            parts += gate_block(stone, ablaq, wood, iron, L)
        e = P.group("SideG%d" % k, parts, (0, 0, 0), 0)
        # place: side 0 is the far (north) side, its court face at y = +HALF
        a = math.radians(rot)
        e.rotation_euler = (0, 0, a)
        e.location = (-math.sin(a) * HALF, math.cos(a) * HALF, 0)
        bpy.context.view_layer.update()
        for (lx, ly, lz) in lamps:
            from mathutils import Vector
            all_lamps.append(e.matrix_world @ Vector((lx, ly, lz)))
    # corner blocks filling the gaps
    for sx in (-1, 1):
        for sy in (-1, 1):
            C.box_mesh("Corner%d%d" % (sx, sy), (DEPTH + 0.8, DEPTH + 0.8, F2 + 0.45),
                       (sx * (HALF + DEPTH / 2 + 0.4), sy * (HALF + DEPTH / 2 + 0.4), (F2 + 0.45) / 2), stone)
    # court floor and the basin
    C.box_mesh("Court", (L + 2 * DEPTH + 4, L + 2 * DEPTH + 4, 0.3), (0, 0, -0.15), C.M("limestone", colour=(0.30, 0.28, 0.25), scale=0.5))
    basin = C.lathe("Basin", [(0, 0.0), (2.6, 0.0), (2.6, 0.7), (2.25, 0.7), (2.25, 0.15), (0, 0.15)], 8, stone, False)
    basin.rotation_euler = (0, 0, math.pi / 8)
    C.lathe("BasinWater", [(0, 0.5), (2.25, 0.5), (2.25, 0.52), (0, 0.52)], 8, C.M("open_sea", colour=(0.01, 0.02, 0.025)))
    # oil lamps in some arches: a small flame and a warm point light each
    r = C.rng(1010)
    flame = bpy.data.materials.new("lampflame")
    nt = flame.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.55, 0.2, 1)
    em.inputs["Strength"].default_value = 60.0
    nt.links.new(em.outputs[0], o.inputs["Surface"])
    picks = [p for i, p in enumerate(all_lamps) if r.random() < 0.5]
    for i, p in enumerate(picks):
        ld = bpy.data.lights.new("Lamp%d" % i, "POINT")
        ld.energy = LAMP_W
        ld.color = (1.0, 0.58, 0.28)
        ld.shadow_soft_size = 0.05
        lo = bpy.data.objects.new("Lamp%d" % i, ld)
        C.link(lo)
        lo.location = p
        fl = C.lathe("Flame%d" % i, [(0, 0), (0.025, 0.03), (0.02, 0.07), (0, 0.12)], 8, flame)
        fl.location = (p[0], p[1], p[2] - 0.06)
    # the court: kneeling camels, stacked bales, a small fire with figures
    cam = C.camera("wide", (-HALF + 0.6, -HALF + 0.6, F1 + 1.6), (6.0, 12.0, 0.0))
    camelm = C.M("dark", colour=(0.05, 0.04, 0.035))
    for i, (x, y, rz) in enumerate(((10, 6, 30), (14, 9, 200), (12, 14, 110), (3, 15, 80), (17, 2, 160), (7, 19, 250))):
        F.place(F.camel("Camel%d" % i, 1, camelm, height=1.95, kneel=True), (x, y, 0), math.radians(rz), cam)
    bale = C.M("hessian", colour=(0.42, 0.34, 0.25))
    for i in range(14):
        b = P.block("Bale%d" % i, (1.1, 0.8, 0.7), bale, chip=0.12, salt=1020 + i)
        b.location = (-6.0 + (i % 5) * 1.15, 17.0 + (i // 5 % 2) * 0.85, 0.7 * (i // 10))
    fx, fy = 4.0, 9.0
    fire = bpy.data.materials.new("fire")
    nt = fire.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.45, 0.12, 1)
    em.inputs["Strength"].default_value = 25.0
    nt.links.new(em.outputs[0], o.inputs["Surface"])
    C.lathe("Fire", [(0, 0), (0.35, 0), (0.2, 0.35), (0, 0.7)], 10, fire, jitter=0.3, salt=1030)
    bpy.data.objects["Fire"].location = (fx, fy, 0)
    fl = bpy.data.lights.new("FireLight", "POINT")
    fl.energy = 400.0
    fl.color = (1.0, 0.5, 0.2)
    fl.shadow_soft_size = 0.3
    fo = bpy.data.objects.new("FireLight", fl)
    C.link(fo)
    fo.location = (fx, fy, 0.6)
    wool = C.M("dark", colour=(0.06, 0.05, 0.045))
    for i, a in enumerate((30, 120, 200, 290)):
        x = fx + math.cos(math.radians(a)) * 1.4
        y = fy + math.sin(math.radians(a)) * 1.4
        fg = F.cloaked_figure("Sitter%d" % i, wool, 1.05)     # seated, wrapped in cloaks
        F.place(fg, (x, y, 0), math.radians(a + 180), cam)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("caravanserai-night")
    C.write_log("a10")


main()
