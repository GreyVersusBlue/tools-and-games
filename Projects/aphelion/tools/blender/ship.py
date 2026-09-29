# Aphelion's ship pack, built from code into models/ship/.
#
#   blender -b --factory-startup -P tools/blender/ship.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box and class,
# and `node tools/blender/validate.mjs` checks what this writes (BACKLOG.md
# "Aphelion: Blender assets" B1, B3).
#
# The cockpit console is the pipeline's sample (B1). B3 adds the rest of what
# src/ship.js builds from primitives beside it: the interior props and
# interactables, the exterior shell, the satellite and the EVA points of
# interest. Every piece is built at the size ship.js gives what it replaces, in
# metres and in ship.js's own orientation (the system panel alone faces +Z,
# the file's front, and takes systems.json's rotY), and its origin is the
# centre of its base.

import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json  # noqa: E402
import math  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common  # noqa: E402

SEED = 0xA9_E1  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)


def console(rnd):
    """The cockpit console. ship.js draws a 4.4 x 0.15 x 1.0 desk in M.metal at
    y 0.85, z -12.8, and under its forward edge a 4.4 x 0.7 x 0.5 face in a
    clone of M.panel at y 0.5, z -13.1: together a box 4.4 x 0.775 x 1.05 whose
    base is 0.15 above the deck, since nothing stands under the face. The
    file keeps that box (the wiring row puts its base at y 0.15, as ship.js
    has it), so the pilot's view over the desk is the one the game was tuned
    on. The desk gets a raised lip at the pilot's edge and a seam where the
    face meets it; the face gets three rows of instrument insets, all in the
    panel slot, so the power state dims every one of them."""
    METAL, PANEL = 0, 1
    # ship.js's z runs aft to +z and the pilot sits aft, so the file's +Z is
    # the pilot's side. In Blender's frame, the desk spans y -0.525..0.475
    # about the pair's centre, the face y 0.025..0.525.
    bm = bmesh.new()
    common.box(bm, (4.4, 1.0, 0.12), (0, -0.025, 0.775 - 0.09), METAL)          # the desk
    common.box(bm, (4.4, 0.06, 0.15), (0, -0.495, 0.775 - 0.075), METAL)        # the pilot's lip
    common.box(bm, (4.4, 0.5, 0.7), (0, 0.275, 0.35), PANEL)                    # the face
    common.box(bm, (4.4, 0.03, 0.03), (0, 0.01, 0.62), METAL)                   # the seam under the desk
    for row in range(3):
        for k in range(7):
            x = -1.8 + k * 0.6 + rnd.uniform(-0.03, 0.03)
            common.box(bm, (0.42, 0.02, 0.12), (x, 0.015, 0.14 + row * 0.16), PANEL)
    root = common.mesh_object('console', bm, [common.keyed('metal'), common.keyed('panel')])
    common.ground(root)
    return root


# ---------------------------------------------------------------- B3
#
# Every piece after the console is written in src/ship.js's own frame: tbox()
# and the cylinder helpers take ship.js's box() arguments as it writes them
# (width, height, depth, then the centre, three's x y z), so each builder reads
# line for line against the one it replaces, and ground() then moves the origin
# to the centre of the base. budget.json's `at` is where that origin sits in
# ship.js's frame (in the POI group's frame for the satellite, and relative to
# systems.json's panel.pos for the panel), which is where the wiring row puts
# the file with no rotation. The system panel is the one piece built facing +Z,
# because systems.json already carries the rotY that turns it to its wall.

def tbox(bm, w, h, d, x, y, z, slot=0):
    """ship.js's box(w, h, d, mat, x, y, z), in Blender's frame."""
    return common.box(bm, (w, d, h), (x, -z, y), slot)


def tcyl(bm, r_top, r_bottom, h, x, y, z, segments=12, slot=0):
    """ship.js's CylinderGeometry(r_top, r_bottom, h) standing on y at (x, y, z)."""
    return common.cylinder(bm, r_bottom, r_top, h, (x, -z, y), segments, slot)


def _turned(bm, r, h, centre, rot, segments, slot):
    m = Matrix.Translation(Vector(centre)) @ rot
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                  radius1=r, radius2=r, depth=h, matrix=m,
                                  calc_uvs=False)['verts']
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = slot
    return faces


def xcyl(bm, r, length, x, y, z, segments=12, slot=0):
    """A cylinder lying along three's x, the way ship.js turns a pipe by
    rotation.z = PI / 2."""
    return _turned(bm, r, length, (x, -z, y), Matrix.Rotation(math.pi / 2, 4, 'Y'), segments, slot)


def zcyl(bm, r, length, x, y, z, segments=12, slot=0):
    """A disc or cylinder lying along three's z (Blender y): a hatch wheel, a
    nozzle ring."""
    return _turned(bm, r, length, (x, -z, y), Matrix.Rotation(math.pi / 2, 4, 'X'), segments, slot)


def finish(name, bm, keys):
    """The object, grounded. Prints where ground() moved the origin from, in
    ship.js's frame, which budget.json carries as `at` for the wiring row."""
    root = common.mesh_object(name, bm, [common.keyed(k) for k in keys])
    vs = [v.co for v in root.data.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    at = ((lo[0] + hi[0]) / 2, lo[2], -(lo[1] + hi[1]) / 2)
    print(f'ship.py: {name} at ({at[0]:.4f}, {at[1]:.4f}, {at[2]:.4f})')
    common.ground(root)
    return root


def seat(rnd):
    """The pilot's seat. ship.js: a 0.8 x 0.15 x 0.8 cushion at y 0.55, z
    -11.6 and a 0.8 x 0.9 x 0.15 back at y 1.05, z -11.25, both M.bed, with
    nothing under them, so the seat keeps its 0.475 m float as the console
    keeps its 0.15 (#691). Metal armrests on posts, inside the same box."""
    BED, METAL = 0, 1
    bm = bmesh.new()
    tbox(bm, 0.8, 0.15, 0.8, 0, 0.55, -11.6, BED)            # cushion
    tbox(bm, 0.8, 0.9, 0.15, 0, 1.05, -11.25, BED)           # back
    tbox(bm, 0.7, 0.04, 0.7, 0, 0.645, -11.63, BED)          # the cushion's pad
    for sx in (-1, 1):
        tbox(bm, 0.06, 0.05, 0.55, sx * 0.37, 0.84, -11.62, METAL)   # armrest
        tbox(bm, 0.04, 0.19, 0.04, sx * 0.37, 0.72, -11.8, METAL)    # its post
    return finish('seat', bm, ['bed', 'metal'])


def panel(rnd):
    """A system panel. ship.js: one 0.08 x 1.1 x 1.4 box in a clone of M.panel
    at systems.json's panel.pos, thin across the ship. Built here facing +Z,
    1.4 x 1.1 x 0.08, so systems.json's rotY (pi / 2 on the port wall, -pi / 2
    on the starboard) turns it to face the room. A metal backplate, the face in
    the panel slot so the power state dims it, and three rows of gauge insets
    below the gauge strip ship.js hangs 0.35 above the centre, which stays the
    game's (its colour is set per system)."""
    METAL, PANEL = 0, 1
    bm = bmesh.new()
    tbox(bm, 1.4, 1.1, 0.03, 0, 0, -0.025, METAL)            # backplate
    tbox(bm, 1.3, 1.0, 0.04, 0, 0, 0.01, PANEL)              # face
    for row in range(3):
        for k in range(4):
            x = -0.45 + k * 0.3 + rnd.uniform(-0.01, 0.01)
            tbox(bm, 0.22, 0.12, 0.01, x, -0.3 + row * 0.19, 0.035, PANEL)
    for sx in (-1, 1):
        tbox(bm, 0.04, 0.3, 0.03, sx * 0.62, 0, 0.025, METAL)   # grab handles
    return finish('panel', bm, ['metal', 'panel'])


def pipes(rnd):
    """The systems bay's pipe run. ship.js: four M.metal cylinders, radius
    0.06, 5.6 long, turned across the ship at y 2.7, 2.54, 2.38 and 2.22, z
    -6.8. Twelve sides where three used eight, clamp bands at three stations
    and a strap holding the four together at each."""
    bm = bmesh.new()
    for i in range(4):
        y = 2.7 - i * 0.16
        xcyl(bm, 0.06, 5.6, 0, y, -6.8)
        for cx in (-2.1, 0.0, 2.1):
            xcyl(bm, 0.064, 0.05, cx, y, -6.8)
    for cx in (-2.1, 0.0, 2.1):
        tbox(bm, 0.03, 0.6, 0.02, cx, 2.46, -6.8)
    return finish('pipes', bm, ['metal'])


def workbench(rnd):
    """The systems bay workbench. ship.js: one 1.8 x 0.8 x 0.7 M.metal box at
    (2.0, 0.4, -7.4), against the starboard wall. A top on four legs, a low
    shelf, and a drawer hung under the top on the room side, with a trim
    handle."""
    METAL, TRIM = 0, 1
    bm = bmesh.new()
    tbox(bm, 1.8, 0.06, 0.7, 2.0, 0.77, -7.4, METAL)          # top
    for sx in (-1, 1):
        for sz in (-1, 1):
            tbox(bm, 0.06, 0.74, 0.06, 2.0 + sx * 0.84, 0.37, -7.4 + sz * 0.32, METAL)
    tbox(bm, 1.68, 0.04, 0.6, 2.0, 0.16, -7.4, METAL)          # low shelf
    tbox(bm, 0.5, 0.26, 0.6, 1.95, 0.61, -7.4, METAL)          # drawer
    tbox(bm, 0.02, 0.03, 0.22, 1.69, 0.63, -7.4, TRIM)         # its handle
    return finish('workbench', bm, ['metal', 'trim'])


def bed(rnd):
    """The bunk. ship.js: a 2.0 x 0.35 x 0.95 M.bed frame at (-1.9, 0.28,
    4.8), a 1.6 x 0.12 x 0.9 M.blanket over it at x -2.05, y 0.5, and a 0.4 x
    0.1 x 0.6 pillow in M.wall at x -1.2, y 0.48; nothing under the frame, so
    it keeps its 0.105 m float. The blanket gets a turned-back fold at the
    foot. The frame is the interactable (bed.children[0]), which the wiring row
    finds by its bed material."""
    BED, BLANKET, WALL = 0, 1, 2
    bm = bmesh.new()
    tbox(bm, 2.0, 0.35, 0.95, -1.9, 0.28, 4.8, BED)
    tbox(bm, 1.6, 0.12, 0.9, -2.05, 0.5, 4.8, BLANKET)
    tbox(bm, 0.28, 0.03, 0.92, -2.7, 0.575, 4.8, BLANKET)     # the fold
    tbox(bm, 0.4, 0.1, 0.6, -1.2, 0.48, 4.8, WALL)             # pillow
    return finish('bed', bm, ['bed', 'blanket', 'wall'])


def shelf(rnd):
    """The curio shelf. ship.js: a 1.4 x 0.06 x 0.35 M.trim plank at (2.5,
    1.7, 4.8). A thinner plank with end stops, the whole still 1.7 at its
    centre, so the curio group ship.js hangs at y 1.82 keeps its place."""
    bm = bmesh.new()
    tbox(bm, 1.4, 0.045, 0.35, 2.5, 1.6925, 4.8)
    for sx in (-1, 1):
        tbox(bm, 0.02, 0.018, 0.35, 2.5 + sx * 0.69, 1.724, 4.8)
    return finish('shelf', bm, ['trim'])


def tray(rnd):
    """The hydroponics tray. ship.js: a 1.6 x 0.7 x 0.8 M.metal body at y 0.35
    and a 1.4 x 0.12 x 0.6 M.soil bed at y 0.76, in a group at (2.2, 0, 0.8).
    Built at the group's origin, so `at` is the group's. A metal rim round the
    soil and vent slats on the room side; the soil's top stays at 0.82, where
    the plant group sits. The soil is the interactable (tray.children[1])."""
    METAL, SOIL = 0, 1
    bm = bmesh.new()
    tbox(bm, 1.6, 0.7, 0.8, 0, 0.35, 0, METAL)
    tbox(bm, 1.4, 0.12, 0.6, 0, 0.76, 0, SOIL)
    for sz in (-1, 1):
        tbox(bm, 1.6, 0.06, 0.1, 0, 0.73, sz * 0.35, METAL)
    for sx in (-1, 1):
        tbox(bm, 0.1, 0.06, 0.6, sx * 0.75, 0.73, 0, METAL)
    for row in range(2):
        for k in range(3):
            tbox(bm, 0.01, 0.04, 0.2, -0.805, 0.25 + row * 0.12, -0.25 + k * 0.25, METAL)
    return finish('tray', bm, ['metal', 'soil'])


def hatch_inner(rnd):
    """The inner airlock hatch. ship.js: a 1.4 x 2.0 x 0.15 M.metal door at
    (0, 1.1, 9.9) and a 1.6 x 0.15 x 0.3 M.trim header at (0, 2.2, 9.85).
    Trim jambs down both sides under the header's ends, and a wheel on the
    airlock side (-z), inside the header's depth."""
    METAL, TRIM = 0, 1
    bm = bmesh.new()
    tbox(bm, 1.4, 2.0, 0.15, 0, 1.1, 9.9, METAL)
    tbox(bm, 1.6, 0.15, 0.3, 0, 2.2, 9.85, TRIM)
    for sx in (-1, 1):
        tbox(bm, 0.1, 1.95, 0.2, sx * 0.75, 1.075, 9.9, TRIM)
    zcyl(bm, 0.22, 0.03, 0, 1.15, 9.81, 16, TRIM)              # wheel
    zcyl(bm, 0.05, 0.05, 0, 1.15, 9.78, 8, METAL)              # hub
    return finish('hatch-inner', bm, ['metal', 'trim'])


def hull(rnd):
    """The exterior shell, seen on EVA. ship.js: a (W + 1) x (H + 1) x (L +
    1.5) M.hullExt body, 7 x 4 x 25.5 at (0, 1.5, -2); a 2.5 x 1.2 x 3.5
    dorsal hump at (0, 4.2, -9); a dish, CylinderGeometry(1.2, 0.1, 0.5, 16)
    in M.sat at (0, 5.2, -9); and two 1.2 x 1.2 x 4 engine pods at (+-4.2, 1.5,
    7). Seam bands round the body, pylons to the pods, a sat ring behind each
    engine glow and a mast. The two glows (MeshBasicMaterial 0x6fb7ff, no key
    of M) and the outer hatch (its own file) stay out of this one."""
    HULL, SAT = 0, 1
    bm = bmesh.new()
    tbox(bm, 7, 4, 25.5, 0, 1.5, -2, HULL)
    tbox(bm, 2.5, 1.2, 3.5, 0, 4.2, -9, HULL)
    tcyl(bm, 1.2, 0.1, 0.5, 0, 5.2, -9, 16, SAT)
    tcyl(bm, 0.15, 0.15, 0.25, 0, 4.9, -9, 8, SAT)             # the dish's stem
    for z in (-12, -6, 0, 6):
        tbox(bm, 7.06, 4.06, 0.12, 0, 1.5, z, HULL)            # seam band
    for sx in (-1, 1):
        tbox(bm, 1.2, 1.2, 4, sx * 4.2, 1.5, 7, HULL)          # pod
        tbox(bm, 0.2, 0.3, 2.4, sx * 3.55, 1.5, 7, HULL)       # pylon
        zcyl(bm, 0.52, 0.04, sx * 4.2, 1.5, 9.02, 16, SAT)     # ring behind the glow at 9.05
        tbox(bm, 1.24, 0.08, 0.08, sx * 4.2, 1.5, 5.4, SAT)    # pod band
    tbox(bm, 0.08, 1.0, 0.08, 1.5, 4.0, 4, SAT)                # mast
    tbox(bm, 0.16, 0.12, 0.16, 1.5, 4.56, 4, SAT)              # its beacon housing
    return finish('hull', bm, ['hullExt', 'sat'])


def hatch_outer(rnd):
    """The outer airlock hatch. ship.js: a 1.4 x 2.0 x 0.2 M.trim box at (0,
    1.1, 10.9), the EVA interactable. A door 0.18 thick with a raised plate and
    a metal grab bar on the space side, the bar's face at ship.js's 11.0."""
    TRIM, METAL = 0, 1
    bm = bmesh.new()
    tbox(bm, 1.4, 2.0, 0.18, 0, 1.1, 10.89, TRIM)
    tbox(bm, 1.0, 1.5, 0.01, 0, 1.1, 10.985, TRIM)
    tbox(bm, 0.06, 0.45, 0.02, 0.5, 1.1, 10.99, METAL)
    return finish('hatch-outer', bm, ['trim', 'metal'])


def satellite(rnd):
    """The EVA points of interest: all three draw this one satellite today, so
    the pack makes one file and every POI takes it (#646). ship.js, in the POI
    group's own frame before its rotation (0.4, 0.8, 0.15): a 0.8 x 0.8 x 1.4
    M.sat core at the origin, two 2.2 x 0.05 x 0.9 solar wings at x +-1.6 (M.solar,
    the material ship.js built inline and B3 put in M) and a 1.6 m antenna of
    radius 0.02 at y 1.0. Struts to the wings, ribs across them, and a feed on
    the antenna's tip."""
    SAT, SOLAR = 0, 1
    bm = bmesh.new()
    tbox(bm, 0.8, 0.8, 1.4, 0, 0, 0, SAT)
    for sx in (-1, 1):
        tbox(bm, 2.2, 0.05, 0.9, sx * 1.6, 0, 0, SOLAR)
        tbox(bm, 0.12, 0.04, 0.04, sx * 0.45, 0, 0, SAT)       # strut
        for k in range(1, 4):
            tbox(bm, 0.02, 0.056, 0.9, sx * (0.5 + k * 0.55), 0, 0, SAT)   # rib
    tcyl(bm, 0.02, 0.02, 1.6, 0, 1.0, 0, 6, SAT)
    tcyl(bm, 0.05, 0.05, 0.06, 0, 1.77, 0, 8, SAT)             # feed
    return finish('satellite', bm, ['sat', 'solar'])


# name -> builder. The file each one writes is budget.json's, never a literal
# here. Order is the seed order: a new item goes at the end, so no item's seed
# moves.
ITEMS = {
    'console': console,
    'seat': seat,
    'panel': panel,
    'pipes': pipes,
    'workbench': workbench,
    'bed': bed,
    'shelf': shelf,
    'tray': tray,
    'hatch-inner': hatch_inner,
    'hull': hull,
    'hatch-outer': hatch_outer,
    'satellite': satellite,
}


def main():
    common.check_version()
    want = common.args() or list(ITEMS)
    unknown = [n for n in want if n not in ITEMS]
    if unknown:
        print(f'ship.py: no item {", ".join(unknown)}; the items are {", ".join(ITEMS)}')
        sys.exit(1)
    common.reset()
    roots = []
    for i, name in enumerate(ITEMS):
        rnd = common.rng(SEED + i)       # drawn for every item, so one item's seed never moves
        if name not in want:
            continue
        root = ITEMS[name](rnd)
        rel = BUDGET['items'][name]['file']
        path = common.export_glb(root, rel)
        print(f'ship.py: wrote {rel} ({os.path.getsize(path)} bytes)')
        common.retire(root, name)
        roots.append(root)
    common.contact_sheet(roots, 'ship')


main()
