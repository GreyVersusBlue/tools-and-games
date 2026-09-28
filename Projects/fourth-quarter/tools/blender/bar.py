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


# name -> builder. The file each one writes is budget.json's, never a literal here.
ITEMS = {
    'crate-wood': crate_wood,
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
