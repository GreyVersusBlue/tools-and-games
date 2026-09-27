# Golden Hour's animal pack, built from code into assets/models/animals/.
#
#   blender -b --factory-startup -P tools/blender/animals.py -- [item ...]
#
# No item named builds them all. The pipeline row (BACKLOG.md "Golden Hour:
# Blender assets" B1) shipped the gull alone, as the sample; the pack row (B3)
# adds the other nine here. budget.json holds every item's box, class and caps,
# and `node tools/blender/validate.mjs` checks what this writes.

import math
import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

import bmesh  # noqa: E402

SEED = 0x60_1D  # every item gets rng(SEED + its index), whether it draws or not

WHITE = 0xf2ebe0   # makeGull() in js/wildlife.js, a MeshBasicMaterial
BILL = 0xc9a04a    # the heron's bill in js/creatures/estuary.js


def gull(rnd):
    """makeGull() in js/wildlife.js, at its box: 3.2 m wingtip to wingtip,
    0.35 m tall, 0.7 m long. It faces +Y here, which the exporter writes as
    -Z, the way the orbiting gulls fly. The wings are their own nodes, pivoted
    at the shoulder, so the game can still pose them the way it poses wL/wR
    today: wingR is the builder's wL (+X) and wingL its wR (-X)."""
    body_mat = common.material('gull', WHITE, unlit=True, double_sided=True)
    bill_mat = common.material('gull.bill', BILL, unlit=True)

    bm = bmesh.new()
    common.sphere(bm, (0.13, 0.30, 0.15), (0, 0, 0.15), segments=10, rings=6)
    common.sphere(bm, (0.07, 0.08, 0.075), (0, 0.26, 0.24), segments=8, rings=5)
    bill = common.sphere(bm, (0.018, 0.06, 0.018), (0, 0.36, 0.225), segments=6, rings=4)
    common.paint(bm, bill, 1)
    body = common.mesh_object('gull', bm, [body_mat, bill_mat])

    # One wing, in shoulder space: root chord, elbow, a swept-back tip.
    right = [(0, 0.17, 0), (0, -0.17, 0), (0.70, -0.14, 0.08), (0.70, 0.14, 0.08),
             (1.50, -0.08, 0.17)]
    faces = [(1, 2, 3, 0), (2, 4, 3)]
    shoulder = 0.10
    wings = []
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        vs = [bm.verts.new((x * side, y, z)) for x, y, z in right]
        for f in faces:
            bm.faces.new([vs[i] for i in (f if side > 0 else reversed(f))])
        wings.append(common.mesh_object(name, bm, [body_mat], parent=body,
                                        location=(shoulder * side, 0.03, 0.18)))

    # `fly`: one full wingbeat, 24 frames at 30 fps (0.8 s, inside the
    # 0.6 to 1.0 s the orbiting gulls' flap rates give), 0.6 rad each way, the
    # amplitude makeGull's orbit uses. A real flap about the forward axis.
    amp = 0.6
    for w, side in zip(wings, (1, -1)):
        def pose(ob, t, side=side):
            ob.rotation_euler = (0.0, -side * amp * math.sin(2 * math.pi * t), 0.0)
        common.clip('fly', w, 24, pose)

    common.ground(body)
    return body


ITEMS = {
    'gull': ('assets/models/animals/gull.glb', gull),
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
        print(f'animals.py: wrote {rel}')
        roots.append(root)
    print(f'animals.py: contact sheet {common.contact_sheet(roots, "animals")}')


main()
