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
# metres; its front faces +Z in the file (Blender -Y), and its origin is the
# centre of its base.

import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json  # noqa: E402

import bmesh  # noqa: E402

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


# name -> builder. The file each one writes is budget.json's, never a literal
# here. Order is the seed order: a new item goes at the end, so no item's seed
# moves.
ITEMS = {
    'console': console,
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
