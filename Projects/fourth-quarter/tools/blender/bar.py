# The Fourth Quarter's bar pack, built from code into models/bar/.
#
#   blender -b --factory-startup -P tools/blender/bar.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class and
# palette, and `node tools/blender/validate.mjs` checks what this writes
# (WISHLIST.md "Blender assets" B1, B3).
#
# The wooden crate is the pipeline's sample (B1). B3 adds the rest of the
# fit-out and furniture js/world.js builds from BoxGeometry beside it. Every
# piece is built at the size the Corner Tap's description gives it, in metres,
# so the wiring row's scale of f.w, f.h, f.d over the file's box is 1 wherever
# a room keeps the reference numbers. Every piece's front faces +Z in the file
# (Blender -Y), its origin is the centre of its base.

import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json  # noqa: E402

import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import common  # noqa: E402

SEED = 0xF0_4B  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)
PALETTE = BUDGET['palette']


def col(name):
    """A palette colour by its budget.json name: colours are data."""
    return int(PALETTE[name], 16)


def crate_wood(rnd):
    """The `crateWood` fit-out kind: world.js draws a 0.55 x 0.5 x 0.55 block in
    flat(0x5a4632, 0.8). This is a slatted crate inside that box: four corner
    posts standing proud, three slats a side, three lid boards, and a core so
    the gaps show wood rather than the floor. One colour, as the block has; the
    slats read as slats from the light, not from a second tone (a new colour is
    a decision). Each slat sits a few millimetres in or out, seeded, so the
    sides do not read as a ruled grid; the box is the posts', which do not
    move."""
    W, D, H = 0.55, 0.55, 0.5          # x, Blender y (the file's z), height
    POST, SLAT_T, LID_T = 0.045, 0.018, 0.012
    wood = common.flat('crateWood', rough=0.8)
    hexv = col('crate-wood')

    bm = common.new_bmesh()
    hw, hd = W / 2, D / 2
    core = POST * 0.6
    common.box(bm, (W - 2 * core, D - 2 * core, H - LID_T), (0, 0, (H - LID_T) / 2), 0, hexv)
    for sx in (-1, 1):
        for sy in (-1, 1):
            common.box(bm, (POST, POST, H),
                       (sx * (hw - POST / 2), sy * (hd - POST / 2), H / 2), 0, hexv)
    inner_w, inner_d = W - 2 * POST, D - 2 * POST
    slat_h, gap = 0.12, (H - LID_T - 3 * 0.12) / 4
    for k in range(3):
        z = gap + slat_h / 2 + k * (slat_h + gap)
        for side in (-1, 1):
            # front and back: long in x, proud of the core by the slat's thickness
            y = side * (hd - core + SLAT_T / 2 - 0.004 + rnd.uniform(-0.003, 0.003))
            common.box(bm, (inner_w, SLAT_T, slat_h), (0, y, z), 0, hexv)
            # left and right: long in y
            x = side * (hw - core + SLAT_T / 2 - 0.004 + rnd.uniform(-0.003, 0.003))
            common.box(bm, (SLAT_T, inner_d, slat_h), (x, 0, z), 0, hexv)
    board_w = (inner_w - 2 * 0.01) / 3
    for k in range(3):
        x = -inner_w / 2 + board_w / 2 + k * (board_w + 0.01)
        common.box(bm, (board_w, inner_d, LID_T), (x, 0, H - LID_T / 2), 0, hexv)

    root = common.mesh_object('crateWood', bm, [wood])
    common.ground(root)
    return root


# ---------------------------------------------------------------- B3 helpers
#
# Blender's frame throughout: x across, y to the back (the file's -Z), z up.
# The front of every piece is -y.

def keyed_piece(name, key, build):
    """One object in a keyed MATS slot: `build(bm)` adds the boxes, then every
    face gets UVs box-projected over the piece's own box."""
    bm = common.new_bmesh()
    build(bm)
    lo = [min(v.co[i] for v in bm.verts) for i in range(3)]
    hi = [max(v.co[i] for v in bm.verts) for i in range(3)]
    bm.normal_update()
    common.box_uv(bm, lo, hi)
    return common.mesh_object(name, bm, [common.keyed(key)])


def flat_piece(name, what, build, rough=0.85, metal=0.0, parent=None):
    """One object in one flat- material, colours from `build(bm)`."""
    bm = common.new_bmesh()
    build(bm)
    return common.mesh_object(name, bm, [common.flat(what, rough=rough, metal=metal)], parent=parent)


def turned(bm, faces, angle, centre):
    """Rotate the vertices of `faces` about Blender y (the axis through a
    wall-hung piece) by `angle` radians, round `centre`."""
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.rotate(bm, verts=verts, cent=centre, matrix=Matrix.Rotation(angle, 3, 'Y'))


# ---------------------------------------------------------------- the kitchen

def stove(rnd):
    """The `stove` kind: world.js draws a 1.7 x 0.95 x 0.85 block in mat("metal")
    and puts four glow() burners on it at y = h + 0.01, x +-0.35, z -0.17 and
    +0.19 from its centre. The burners stay the game's (#689): an emissive is a
    material the game makes, and a model's colour is never emissive. So this is
    the body they sit on: a recessed plinth, an oven door with its handle, a
    drawer, a knob strip, and a grate under each burner's spot, the grates'
    tops at the block's 0.95 so the discs rest on them."""
    W, D = 1.7, 0.82

    def build(bm):
        common.box(bm, (W - 0.08, D - 0.06, 0.08), (0, 0.03, 0.04))            # plinth, set back
        common.box(bm, (W, D, 0.86), (0, 0, 0.08 + 0.43))                      # body, top at 0.94
        fy = -D / 2
        common.box(bm, (0.95, 0.02, 0.48), (-0.2, fy - 0.01, 0.40))           # oven door
        common.box(bm, (0.72, 0.025, 0.025), (-0.2, fy - 0.035, 0.68))        # its handle
        common.box(bm, (0.5, 0.02, 0.48), (0.5, fy - 0.01, 0.40))             # the drawer beside it
        for i in range(4):                                                     # knobs
            common.box(bm, (0.05, 0.03, 0.05), (-0.6 + i * 0.4, fy - 0.015, 0.83))
        for bx in (-0.35, 0.35):
            for by in (0.17, -0.19):        # three's z -0.17 and +0.19 is Blender y +0.17 and -0.19
                common.box(bm, (0.32, 0.02, 0.01), (bx, by, 0.945))
                common.box(bm, (0.02, 0.32, 0.01), (bx, by, 0.945))

    root = keyed_piece('stove', 'metal', build)
    common.ground(root)
    return root


def prep(rnd):
    """The `prep` kind: a 2.4 x 0.95 x 0.9 block in mat("metal"). A steel prep
    table: the top with a turned-down front edge, four legs and an undershelf,
    all inside the block, which is still the collider."""
    W, D, H = 2.4, 0.9, 0.95

    def build(bm):
        common.box(bm, (W, D, 0.04), (0, 0, H - 0.02))
        common.box(bm, (W, 0.02, 0.07), (0, -D / 2 + 0.01, H - 0.055))
        for sx in (-1, 1):
            for sy in (-1, 1):
                common.box(bm, (0.05, 0.05, H - 0.04),
                           (sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), (H - 0.04) / 2))
        common.box(bm, (W - 0.1, D - 0.1, 0.03), (0, 0, 0.22))

    root = keyed_piece('prep', 'metal', build)
    common.ground(root)
    return root


def crate(rnd):
    """The `crate` kind: a 0.7 x 0.6 x 0.6 block in mat("metal"). A steel
    storage bin: a core, corner posts standing proud, two ribs round it and a
    lid seam; the posts make the box."""
    W, D, H = 0.7, 0.6, 0.6
    P = 0.04

    def build(bm):
        common.box(bm, (W - 0.03, D - 0.03, H - 0.02), (0, 0, (H - 0.02) / 2))
        for sx in (-1, 1):
            for sy in (-1, 1):
                common.box(bm, (P, P, H), (sx * (W / 2 - P / 2), sy * (D / 2 - P / 2), H / 2))
        for z in (0.2, 0.42):
            common.box(bm, (W - 0.01, D - 0.01, 0.03), (0, 0, z))
        common.box(bm, (W - 0.05, D - 0.05, 0.02), (0, 0, H - 0.01))

    root = keyed_piece('crate', 'metal', build)
    common.ground(root)
    return root


# ---------------------------------------------------------------- the bar

BAR_H, BAR_D, TOP_T = 1.1, 0.75, 0.06


def counter_mid(rnd):
    """One metre of the counter (#690). world.js draws the bar as one
    desc.bar.len x 1.1 x 0.75 block in mat("barTop"); the pack gives it as two
    end pieces and this middle, which the wiring row repeats and stretches
    along x to fill desc.bar.len less the ends. The top overhangs the body at
    the customer's side (-y); the front carries two rails and a centre stile,
    never one at an edge, so a run of middles shows no doubled joint."""
    body_d = BAR_D - 0.08

    def build(bm):
        common.box(bm, (1.0, body_d, BAR_H - TOP_T), (0, 0.04, (BAR_H - TOP_T) / 2))
        common.box(bm, (1.0, BAR_D, TOP_T), (0, 0, BAR_H - TOP_T / 2))
        fy = 0.04 - body_d / 2
        for z in (0.32, 0.86):
            common.box(bm, (1.0, 0.02, 0.05), (0, fy - 0.01, z))
        common.box(bm, (0.05, 0.02, 0.49), (0, fy - 0.01, 0.59))

    root = keyed_piece('counterMid', 'barTop', build)
    common.ground(root)
    return root


def counter_end(rnd):
    """The counter's end, 0.5 m, its closed side at +x. The wiring row puts one
    at each end of the run and mirrors the west one (scale.x = -1, which three
    draws with its winding flipped). The top overhangs the end panel as it
    overhangs the front."""
    body_d = BAR_D - 0.08

    def build(bm):
        common.box(bm, (0.47, body_d, BAR_H - TOP_T), (-0.015, 0.04, (BAR_H - TOP_T) / 2))
        common.box(bm, (0.5, BAR_D, TOP_T), (0, 0, BAR_H - TOP_T / 2))
        fy = 0.04 - body_d / 2
        for z in (0.32, 0.86):
            common.box(bm, (0.47, 0.02, 0.05), (-0.015, fy - 0.01, z))
        common.box(bm, (0.02, body_d - 0.1, 0.8), (0.23, 0.04, 0.55))          # end panel
        common.box(bm, (0.05, 0.02, 0.97), (0.195, fy - 0.01, 0.525))          # the corner stile

    root = keyed_piece('counterEnd', 'barTop', build)
    common.ground(root)
    return root


def kick(rnd):
    """One metre of the kick: world.js's desc.bar.len x 0.12 x 0.8 block in
    flat(0x120c07), repeated and stretched with the counter's middles. A plinth
    and a slightly narrower cap, so its top edge catches a line of light."""
    hexv = col('kick')

    def build(bm):
        common.box(bm, (1.0, 0.8, 0.1), (0, 0, 0.05), 0, hexv)
        common.box(bm, (1.0, 0.76, 0.02), (0, 0, 0.11), 0, hexv)

    root = flat_piece('kick', 'kick', build)
    common.ground(root)
    return root


def shelf_back(rnd):
    """One metre of the back-bar shelf: desc.bar.len x 0.08 x 0.35 in
    mat("barTop") on the north wall, repeated and stretched like the counter.
    A board with a front lip that keeps the bottles off the edge."""
    def build(bm):
        common.box(bm, (1.0, 0.35, 0.05), (0, 0, 0.025))
        common.box(bm, (1.0, 0.02, 0.08), (0, -0.165, 0.04))

    root = keyed_piece('shelfBack', 'barTop', build)
    common.ground(root)
    return root


def shelf_kitchen(rnd):
    """One metre of the kitchen's dry-goods shelf: shelfLen x 0.06 x 0.35 in
    mat("barTop"), 2.2 m at the Corner Tap and longer in a wider kitchen. A
    board and a rear upstand against the wall."""
    def build(bm):
        common.box(bm, (1.0, 0.35, 0.04), (0, 0, 0.02))
        common.box(bm, (1.0, 0.02, 0.06), (0, 0.165, 0.03))

    root = keyed_piece('shelfKitchen', 'barTop', build)
    common.ground(root)
    return root


def sill(rnd):
    """The pass-through sill: (window width + 0.2) x 0.08 x 0.7 in mat("barTop"),
    1.9 m at the Corner Tap's window, both sides of the wall. The wiring row
    stretches it along x for a wider window. A slab and a nosing at each face."""
    W = 1.9

    def build(bm):
        common.box(bm, (W, 0.62, 0.08), (0, 0, 0.04))
        for s in (-1, 1):
            common.box(bm, (W, 0.04, 0.06), (0, s * 0.33, 0.04))

    root = keyed_piece('sill', 'barTop', build)
    common.ground(root)
    return root


# Bottle shapes, one per colour: (body radius bottom, top, body height,
# shoulder height, neck radius, neck height). Every one is 0.32 m tall in all,
# as world.js's CylinderGeometry(0.045, 0.05, 0.32) is, and 0.1 m across.
BOTTLES = {
    'bottle-green':  (0.050, 0.048, 0.19, 0.06, 0.015, 0.060),   # a tall wine shape
    'bottle-amber':  (0.050, 0.050, 0.17, 0.03, 0.017, 0.110),   # a squared whiskey, long neck
    'bottle-violet': (0.048, 0.044, 0.21, 0.05, 0.014, 0.050),   # a liqueur
    'bottle-blue':   (0.050, 0.050, 0.15, 0.08, 0.016, 0.080),   # a gin, sloped shoulder
    'bottle-gold':   (0.050, 0.046, 0.20, 0.04, 0.018, 0.070),   # a rum
}


def bottle_of(name):
    r0, r1, hb, hs, rn, hn = BOTTLES[name]

    def builder(rnd):
        """A back-bar bottle in its flat() colour, roughness 0.25 as world.js
        paints it: body, shoulder, neck and a lip, 8 sides as the cylinder
        was."""
        hexv = col(name)
        cap = 0.32 - hb - hs - hn

        def build(bm):
            common.cylinder(bm, r0, r1, hb, (0, 0, hb / 2), 8, 0, hexv)
            common.cylinder(bm, r1, rn, hs, (0, 0, hb + hs / 2), 8, 0, hexv)
            common.cylinder(bm, rn, rn, hn, (0, 0, hb + hs + hn / 2), 8, 0, hexv)
            common.cylinder(bm, rn + 0.003, rn + 0.003, cap, (0, 0, 0.32 - cap / 2), 8, 0, hexv)

        root = flat_piece('bottle', 'bottle', build, rough=0.25)
        common.ground(root)
        return root
    return builder


def tap(rnd):
    """A tap handle on the bar top: world.js draws CylinderGeometry(0.03, 0.03,
    0.35) in flat(0xc9c9c9, 0.3, 0.9). A collar, a shaft and a handle that
    swells to the top."""
    hexv = col('tap')

    def build(bm):
        common.cylinder(bm, 0.03, 0.03, 0.03, (0, 0, 0.015), 8, 0, hexv)
        common.cylinder(bm, 0.012, 0.012, 0.14, (0, 0, 0.1), 8, 0, hexv)
        common.cylinder(bm, 0.02, 0.03, 0.18, (0, 0, 0.26), 8, 0, hexv)

    root = flat_piece('tap', 'tap', build, rough=0.3, metal=0.9)
    common.ground(root)
    return root


def can(rnd):
    """A dry-goods can: CylinderGeometry(0.08, 0.08, 0.2, 10) in
    flat(0xb8b2a6, 0.5, 0.4). A body and a rolled rim at each end."""
    hexv = col('can')

    def build(bm):
        common.cylinder(bm, 0.077, 0.077, 0.012, (0, 0, 0.006), 10, 0, hexv)
        common.cylinder(bm, 0.08, 0.08, 0.176, (0, 0, 0.1), 10, 0, hexv)
        common.cylinder(bm, 0.077, 0.077, 0.012, (0, 0, 0.194), 10, 0, hexv)

    root = flat_piece('can', 'can', build, rough=0.5, metal=0.4)
    common.ground(root)
    return root


# ---------------------------------------------------------------- the walls

def corkboard(rnd):
    """The promo corkboard on the south wall: world.js draws a 1.5 x 1.0 cork
    in flat(0x8a6a42, 0.95), a 1.62 x 1.12 frame in flat(0x2e1d10, 0.7) and five
    0.22 x 0.28 notes in three colours, each tilted by Math.random() on every
    build. Here the frame is four bars proud of the cork, and the notes' tilts
    are seeded, so the board is the same every night. One material, since the
    cork, frame and notes differ only in colour; its roughness is the cork's."""
    FW, FH, B = 1.62, 1.12, 0.06
    notes = [col('note-cream'), col('note-yellow'), col('note-blue')]
    cork_c, frame_c = col('cork'), col('cork-frame')

    def build(bm):
        # the back of the board is the wall side, +y; the room is -y
        common.box(bm, (FW - 2 * B, 0.03, FH - 2 * B), (0, 0.015, FH / 2), 0, cork_c)
        for sx in (-1, 1):
            common.box(bm, (B, 0.065, FH), (sx * (FW / 2 - B / 2), -0.0025, FH / 2), 0, frame_c)
        for sz in (0, 1):
            common.box(bm, (FW - 2 * B, 0.065, B), (0, -0.0025, B / 2 + sz * (FH - B)), 0, frame_c)
        for i in range(5):
            x = -0.55 + (i % 3) * 0.55
            z = FH / 2 + 0.15 - (i // 3) * 0.4
            f = common.box(bm, (0.22, 0.004, 0.28), (x, -0.002, z), 0, notes[i % 3])
            turned(bm, f, rnd.uniform(-0.1, 0.1), (x, -0.002, z))

    root = flat_piece('corkboard', 'cork', build, rough=0.95)
    common.ground(root)
    return root


def tv_frame(rnd):
    """A TV's frame: world.js draws a 1.95 x 1.15 x 0.08 box in flat(0x0a0a0a,
    0.4) and a 1.8 x 1.0 screen plane 0.05 in front of its centre. A housing
    set in from a bezel, the bezel's face 0.01 behind the screen's plane."""
    W, H = 1.95, 1.15
    hexv = col('tv-frame')

    def build(bm):
        common.box(bm, (W - 0.1, 0.04, H - 0.1), (0, 0.02, H / 2), 0, hexv)    # housing
        common.box(bm, (W, 0.025, H), (0, -0.0125, H / 2), 0, hexv)               # the panel behind the screen
        for sx in (-1, 1):
            common.box(bm, (0.075, 0.015, H), (sx * (W / 2 - 0.0375), -0.0325, H / 2), 0, hexv)
        for sz in (0, 1):
            common.box(bm, (W - 0.15, 0.015, 0.075), (0, -0.0325, 0.0375 + sz * (H - 0.075)), 0, hexv)

    root = flat_piece('tvFrame', 'tvFrame', build, rough=0.4)
    common.ground(root)
    return root


def door_frame(rnd):
    """The front door's frame: world.js draws a solid 1.4 x 2.3 x 0.12 box in
    flat(0x241a10, 0.7), with a 1.2 x 2.1 glow plane just in front for the
    night outside. Two posts and a head, a threshold, and a recessed back so
    the wall never shows through; the glow still covers the opening."""
    W, H, D = 1.4, 2.3, 0.12
    hexv = col('door-frame')

    def build(bm):
        for sx in (-1, 1):
            common.box(bm, (0.1, D, H), (sx * (W / 2 - 0.05), 0, H / 2), 0, hexv)
        common.box(bm, (W - 0.2, D, 0.2), (0, 0, H - 0.1), 0, hexv)
        common.box(bm, (W - 0.2, D, 0.03), (0, 0, 0.015), 0, hexv)
        common.box(bm, (W - 0.2, 0.02, H - 0.23), (0, D / 2 - 0.01, 0.03 + (H - 0.23) / 2), 0, hexv)

    root = flat_piece('doorFrame', 'doorFrame', build, rough=0.7)
    common.ground(root)
    return root


# ---------------------------------------------------------------- furniture

def stool(rnd):
    """A bar stool: world.js's stool() is a leather top, CylinderGeometry(0.22,
    0.22, 0.07, 14) at y 0.72, on a leg CylinderGeometry(0.035, 0.05, 0.7, 8)
    in flat(0x2a2a2e, 0.4, 0.8) at y 0.36. The cushion is a keyed `leather`
    object; the steel is a second object parented to it (#687): a base disc,
    the column, a foot plate and the seat pan."""
    hexv = col('stool-leg')

    def cushion(bm):
        common.cylinder(bm, 0.22, 0.21, 0.07, (0, 0, 0.72), 14)

    def steel(bm):
        common.cylinder(bm, 0.19, 0.17, 0.025, (0, 0, 0.0125), 12, 0, hexv)
        common.cylinder(bm, 0.035, 0.03, 0.66, (0, 0, 0.025 + 0.33), 8, 0, hexv)
        common.cylinder(bm, 0.15, 0.15, 0.015, (0, 0, 0.28), 12, 0, hexv)
        common.cylinder(bm, 0.17, 0.17, 0.015, (0, 0, 0.6775), 12, 0, hexv)

    root = keyed_piece('stool', 'leather', cushion)
    flat_piece('stoolLeg', 'stoolLeg', steel, rough=0.4, metal=0.8, parent=root)
    common.ground(root)
    return root


def table(rnd):
    """A four-top: world.js's table4() is a mat("tableTop") top,
    CylinderGeometry(0.62, 0.62, 0.06, 20) at y 0.92, on a leg
    CylinderGeometry(0.05, 0.09, 0.9, 10) in flat(0x1c130b, 0.5). The top is a
    keyed object; the pedestal a flat one under it: a foot, the column and a
    spider under the top."""
    hexv = col('table-leg')

    def top(bm):
        common.cylinder(bm, 0.62, 0.62, 0.06, (0, 0, 0.92), 20)

    def pedestal(bm):
        common.cylinder(bm, 0.3, 0.26, 0.03, (0, 0, 0.015), 12, 0, hexv)
        common.cylinder(bm, 0.07, 0.05, 0.82, (0, 0, 0.03 + 0.41), 10, 0, hexv)
        common.cylinder(bm, 0.2, 0.2, 0.04, (0, 0, 0.87), 10, 0, hexv)

    root = keyed_piece('table', 'tableTop', top)
    flat_piece('tableLeg', 'tableLeg', pedestal, rough=0.5, parent=root)
    common.ground(root)
    return root


# name -> builder. The file each one writes is budget.json's, never a literal
# here. Order is the seed order: a new item goes at the end, so no item's seed
# moves (crate-wood is index 0, and its bytes are the pipeline row's).
ITEMS = {
    'crate-wood': crate_wood,
    'stove': stove,
    'prep': prep,
    'crate': crate,
    'counter-mid': counter_mid,
    'counter-end': counter_end,
    'kick': kick,
    'shelf-back': shelf_back,
    'shelf-kitchen': shelf_kitchen,
    'sill': sill,
    **{n: bottle_of(n) for n in BOTTLES},
    'tap': tap,
    'can': can,
    'corkboard': corkboard,
    'tv-frame': tv_frame,
    'door-frame': door_frame,
    'stool': stool,
    'table': table,
}


def main():
    common.check_version()
    want = common.args() or list(ITEMS)
    unknown = [n for n in want if n not in ITEMS]
    if unknown:
        print(f'bar.py: no item {", ".join(unknown)}; the items are {", ".join(ITEMS)}')
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
        print(f'bar.py: wrote {rel} ({os.path.getsize(path)} bytes)')
        common.retire(root, name)
        roots.append(root)
    common.contact_sheet(roots, 'bar')


main()
