# Blue Hour's animal pack, built from code into assets/models/animals/.
#
#   blender -b --factory-startup -P tools/blender/animals.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class,
# clips and the nodes the game poses, and `node tools/blender/validate.mjs`
# checks what this writes (BACKLOG.md "Blue Hour: Blender assets" B1, B3).
#
# The crow is the pipeline's sample (B1); rank 2 (B3) adds the deer, fox, owl,
# squirrel and small bird beside it. Every animal faces +Y here, which the
# exporter writes as -Z: x across, z up. Every origin is the centre of the
# base, not the builder's origin.
#
# What reads in Blue Hour is what the fog leaves (B1's style sheet): a crow is
# 25 to 35 m off, where a pixel is 3 to 4 cm, so its triangles go into the
# outline (slotted primaries, a wedge tail, a heavy bill) and none into an eye.

import json
import math
import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

import bmesh  # noqa: E402

SEED = 0xB1_0E  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    PALETTE = json.load(f)['palette']


def col(name):
    """A palette colour by its budget.json name: colours are data."""
    return int(PALETTE[name], 16)


def crow(rnd):
    """makeCrow() in js/wildlife.js at its box: the small bird at 2.2 times,
    2.64 m wingtip to wingtip, 0.36 m tall, 0.62 m long, unlit as its
    MeshBasicMaterial is. The builder's body is long across the wings; this
    one is long nose to tail, facing -Z in the file the way the orbit's
    `dir = 1` crows fly (B1 says what the `dir = -1` ones do). The wings are
    their own nodes, pivoted at the shoulder: wingR is the builder's wL (+X)."""
    mat = common.material('crow', col('crow'), unlit=True, double_sided=True)

    bm = bmesh.new()
    common.sphere(bm, (0.115, 0.19, 0.115), (0, 0, 0.16), segments=10, rings=6)
    common.sphere(bm, (0.08, 0.085, 0.08), (0, 0.21, 0.2), segments=8, rings=5)
    common.limb(bm, (0, 0.27, 0.19), (0, 0.34, 0.175), 0.028, 0.004, 5)       # the bill
    # A wedge tail, fanned a little, one face thick.
    common.sheet(bm, [(-0.045, -0.14, 0.17), (0.045, -0.14, 0.17), (0.085, -0.28, 0.14),
                      (0.03, -0.3, 0.14), (-0.03, -0.3, 0.14), (-0.085, -0.28, 0.14)],
                 [(0, 1, 2, 3), (0, 3, 4, 5)])
    body = common.mesh_object('crow', bm, [mat])

    # One wing in shoulder space: the arm, the hand, and four primaries fanned
    # off the hand's edge, whose slots are what says crow and not gull.
    arm = [(0, 0.1, 0), (0, -0.14, 0), (0.45, 0.13, 0.05), (0.45, -0.18, 0.05)]        # 0..3
    hand = [(0.9, 0.1, 0.11), (0.915, 0.05, 0.112), (0.93, 0.0, 0.115),
            (0.95, -0.07, 0.12), (0.95, -0.15, 0.12)]                                   # 4..8
    tips = [(1.24, 0.07, 0.15), (1.26, 0.0, 0.155), (1.22, -0.07, 0.15), (1.13, -0.14, 0.145)]  # 9..12
    right = arm + hand + tips
    faces = [(1, 3, 2, 0), (3, 8, 4, 2)] + [(4 + k, 5 + k, 9 + k) for k in range(4)]
    shoulder = (0.07, 0.03, 0.25)
    wings = []
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        common.sheet(bm, right, faces, side)
        wings.append(common.mesh_object(name, bm, [mat], parent=body,
                                        location=(shoulder[0] * side, shoulder[1], shoulder[2])))

    # `fly`: one wingbeat, 30 frames (1.0 s, inside the 0.9 to 1.4 s the
    # crows' `o.flap * 4` rates give), 0.5 rad each way as makeCrow's orbit
    # has it, about the forward axis: a beat, where the builder's rotation.x
    # about the span twisted the wing.
    amp = 0.5
    for w, side in zip(wings, (1, -1)):
        def pose(ob, t, side=side):
            ob.rotation_euler = (0.0, -side * amp * math.sin(2 * math.pi * t), 0.0)
        common.clip('fly', w, 30, pose)

    common.ground(body)
    return body


ITEMS = {
    'crow': ('assets/models/animals/crow.glb', crow),
}


def main():
    common.check_version()
    wanted = common.args() or list(ITEMS)
    unknown = [w for w in wanted if w not in ITEMS]
    if unknown:
        print(f'animals.py: no item named {", ".join(unknown)}; the pack has {", ".join(ITEMS)}')
        sys.exit(1)

    common.reset()
    roots = []
    for i, name in enumerate(ITEMS):
        if name not in wanted:
            continue
        rel, build = ITEMS[name]
        root = build(common.rng(SEED + i))
        common.export_glb(root, rel)
        common.retire(root, name)
        print(f'animals.py: wrote {rel}')
        roots.append(root)
    print(f'animals.py: contact sheet {common.contact_sheet(roots, "animals")}')


main()
