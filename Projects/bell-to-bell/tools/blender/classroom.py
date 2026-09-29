# Bell to Bell's classroom pack, built from code into Assets/models/blender/.
#
#   blender -b --factory-startup -P tools/blender/classroom.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's file, box and
# class, and `node tools/blender/validate.mjs` checks what this writes
# (WISHLIST.md "Blender assets" B1, B2).
#
# The whiteboard is the pipeline's sample (B1). B2 adds the rest of what
# src/world/ builds from boxes that data/assets.json does not already name.
# Every piece is built at the size data/room.json gives what it replaces, in
# metres; its front faces +Z in the file (Blender -Y), and its origin is the
# centre of its base.

import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402

import common  # noqa: E402

SEED = 0xB2_B1  # every item gets rng(SEED + its index), whether it draws or not


def whiteboard(rnd):
    """The whiteboard. data/room.json's `whiteboard` fixture is a 6.4 x 1.5 x
    0.06 box in the board colour, hung on the front wall facing the room. The
    file keeps that box: a white face set 1.5 cm back inside a 4 cm frame in
    the Kenney kit's light metal, and along the bottom a marker lip standing
    proud of the face, all inside the fixture's 6 cm, so its front is where
    the fixture's was and the board's writing (board.js) still lands on it."""
    BOARD, FRAME = 0, 1
    W, H, D, F = 6.4, 1.5, 0.06, 0.04
    # Blender y is the file's -Z, so the front is -y: the frame spans
    # y -0.03..0.03, the face y -0.015..0.03.
    bm = bmesh.new()
    common.box(bm, (W - 2 * F, D - 0.015, H - 2 * F), (0, 0.0075, H / 2), BOARD)       # the face
    common.box(bm, (W, D, F), (0, 0, H - F / 2), FRAME)                                # the top rail
    common.box(bm, (W, D, F), (0, 0, F / 2), FRAME)                                    # the bottom rail
    for x in (-(W - F) / 2, (W - F) / 2):
        common.box(bm, (F, D, H - 2 * F), (x, 0, H / 2), FRAME)                        # the stiles
    common.box(bm, (W - 2 * F, 0.012, 0.03), (0, -D / 2 + 0.006, F + 0.015), FRAME)    # the marker lip
    root = common.mesh_object('whiteboard', bm, [common.material('board'),
                                                 common.material('kenney-metal', 0.4, 0.6)])
    common.ground(root)
    return root


# name -> builder. The file each one writes is budget.json's, never a literal
# here. Order is the seed order: a new item goes at the end, so no item's seed
# moves.
ITEMS = {
    'whiteboard': whiteboard,
}


def main():
    common.check_version()
    want = common.args() or list(ITEMS)
    unknown = [n for n in want if n not in ITEMS]
    if unknown:
        print(f'classroom.py: no item {", ".join(unknown)}; the items are {", ".join(ITEMS)}')
        sys.exit(1)
    common.reset()
    roots = []
    for i, name in enumerate(ITEMS):
        rnd = common.rng(SEED + i)       # drawn for every item, so one item's seed never moves
        if name not in want:
            continue
        root = ITEMS[name](rnd)
        rel = common.BUDGET['items'][name]['file']
        for path in common.export_gltf(root, rel):
            print(f'classroom.py: wrote {os.path.relpath(path, common.PROJECT)} ({os.path.getsize(path)} bytes)')
        common.retire(root, name)
        roots.append(root)
    common.contact_sheet(roots, 'classroom')


main()
