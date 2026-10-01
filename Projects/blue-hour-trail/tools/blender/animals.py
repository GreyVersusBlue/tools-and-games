# Blue Hour's animal pack, built from code into assets/models/animals/.
#
#   blender -b --factory-startup -P tools/blender/animals.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class,
# clips and the nodes the game poses, and `node tools/blender/validate.mjs`
# checks what this writes (BACKLOG.md "Blue Hour: Blender assets" B1, B3).
#
# The crow is the pipeline's sample (B1); B3 adds the deer, fox, owl, squirrel
# and small bird beside it, the six js/wildlife.js builds. The bear and the elk
# are not here (#646). Every animal faces +Y here, which the exporter writes as
# -Z: x across, z up. Every builder in js/wildlife.js leads with +Z, so the
# wiring row turns each by a half turn (#675). Every origin is the centre of
# the base, not the builder's origin.
#
# What reads in Blue Hour is what the fog leaves (B1's style sheet): a crow is
# 25 to 35 m off, where a pixel is 3 to 4 cm, so its triangles go into the
# outline (slotted primaries, a wedge tail, a heavy bill) and none into an eye.
# The deer is the closest large thing, bolting at 13 m, so it gets jointed legs
# and a muzzle and still spends about a quarter of its cap (#672).

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


def deer(rnd):
    """makeDeer() in js/wildlife.js, in the pose it spends its life in: head
    down at 0.9 rad, where the builder's box is 1.24 m across, 1.79 m tall and
    2.86 m nose to tail. The builder's barrel is 1.24 m wide, which the model
    keeps. Its triangles go into what says deer at 13 to 40 m in fog: legs that
    bend at the knee and the hock, a neck, ears and a muzzle (#672).

    The head is a node where the builder's headG pivots, carrying the neck, the
    head and the ears as headG does. `graze` is the builder's nod, 0.9 + 0.12
    sin(0.4 t) rad, one period in 471 frames (15.7 s), and its frame 0 is the
    rest pose (#673). The alert pose, head up, is the game's to set on the
    node. Turned a half turn from the builder, so its head's rotation.x is the
    negative of what headG took."""
    coat = common.material('deer', col('deer'), roughness=0.9)
    pale = common.material('deer.pale', col('deer-pale'), roughness=0.9)

    bm = bmesh.new()
    common.sphere(bm, (0.6, 0.98, 0.44), (0, 0, 1.08), segments=12, rings=8)     # the barrel
    common.sphere(bm, (0.5, 0.42, 0.46), (0, 0.5, 1.08), segments=10, rings=6)   # chest
    common.sphere(bm, (0.52, 0.46, 0.48), (0, -0.52, 1.1), segments=10, rings=6)  # haunch
    for s in (1, -1):
        # Forelegs straight down from the shoulder, a knee halfway.
        common.limb(bm, (s * 0.24, 0.55, 0.95), (s * 0.24, 0.58, 0.5), 0.085, 0.045, 6)
        common.limb(bm, (s * 0.24, 0.58, 0.5), (s * 0.24, 0.55, 0.1), 0.045, 0.033, 6)
        common.limb(bm, (s * 0.24, 0.55, 0.1), (s * 0.24, 0.6, 0.0), 0.033, 0.04, 5)
        # Hind legs: a thigh down and back to the hock, then the cannon forward.
        common.limb(bm, (s * 0.25, -0.55, 1.0), (s * 0.25, -0.7, 0.52), 0.1, 0.05, 6)
        common.limb(bm, (s * 0.25, -0.7, 0.52), (s * 0.25, -0.6, 0.1), 0.045, 0.033, 6)
        common.limb(bm, (s * 0.25, -0.6, 0.1), (s * 0.25, -0.55, 0.0), 0.033, 0.04, 5)
    tail = common.limb(bm, (0, -0.95, 1.3), (0, -1.08, 1.14), 0.085, 0.03, 5)    # the white flag
    common.paint(bm, tail, 1)
    body = common.mesh_object('deer', bm, [coat, pale])

    # The head in headG's space: x across, y forward, z up, the pivot at the
    # base of the neck where the builder puts headG, (0, 1.3, 0.85).
    bm = bmesh.new()
    common.limb(bm, (0, -0.05, -0.06), (0, 0.2, 0.64), 0.14, 0.085, 7)           # neck
    common.sphere(bm, (0.11, 0.15, 0.12), (0, 0.24, 0.67), segments=8, rings=6)  # skull
    common.limb(bm, (0, 0.3, 0.66), (0, 0.54, 0.58), 0.085, 0.05, 6)             # muzzle
    ears = []
    for s in (1, -1):
        ears += common.limb(bm, (s * 0.07, 0.18, 0.74), (s * 0.21, 0.15, 0.88), 0.055, 0.012, 4)
    common.paint(bm, ears, 1)
    head = common.mesh_object('head', bm, [coat, pale], parent=body, location=(0, 0.85, 1.3))

    nod = lambda t: -(0.9 + 0.12 * math.sin(2 * math.pi * t))  # noqa: E731
    head.rotation_euler = (nod(0), 0.0, 0.0)
    common.ground(body)

    def pose(ob, t):
        ob.rotation_euler = (nod(t), 0.0, 0.0)
    common.clip('graze', head, 471, pose)
    return body


def fox(rnd):
    """makeFox() in js/wildlife.js: 0.33 m across, 0.54 m to the ears, 1.30 m
    nose to tail tip. It crosses the trail once, moved whole, so no clip and no
    node. The builder's cone head becomes a skull, a snout and two ears, and
    the tail thickens and drops the way a fox carries it at a trot. The legs
    are the builder's darker brown."""
    coat = common.material('fox', col('fox'), roughness=0.9)
    legs = common.material('fox.leg', col('fox-leg'), roughness=0.9)
    bm = bmesh.new()
    common.sphere(bm, (0.165, 0.36, 0.13), (0, 0, 0.36), segments=10, rings=8)
    common.limb(bm, (0, 0.24, 0.38), (0, 0.38, 0.43), 0.09, 0.065, 6)             # neck
    common.sphere(bm, (0.085, 0.09, 0.075), (0, 0.4, 0.43), segments=8, rings=5)
    common.limb(bm, (0, 0.45, 0.42), (0, 0.61, 0.385), 0.05, 0.012, 5)           # snout
    for s in (1, -1):
        common.limb(bm, (s * 0.045, 0.38, 0.48), (s * 0.07, 0.37, 0.56), 0.035, 0.004, 4)
    common.limb(bm, (0, -0.3, 0.38), (0, -0.5, 0.32), 0.05, 0.09, 6)             # the brush
    common.limb(bm, (0, -0.5, 0.32), (0, -0.7, 0.25), 0.09, 0.02, 6)
    leg = []
    for s in (1, -1):
        leg += common.limb(bm, (s * 0.075, 0.22, 0.3), (s * 0.075, 0.24, 0.0), 0.03, 0.02, 5)
        leg += common.limb(bm, (s * 0.075, -0.22, 0.3), (s * 0.075, -0.27, 0.13), 0.035, 0.022, 5)
        leg += common.limb(bm, (s * 0.075, -0.27, 0.13), (s * 0.075, -0.23, 0.0), 0.022, 0.02, 5)
    common.paint(bm, leg, 1)
    body = common.mesh_object('fox', bm, [coat, legs])
    common.ground(body)
    return body


def owl(rnd):
    """makeOwl() in js/wildlife.js: 0.35 m across, 0.70 m from the body's base
    to the ear tufts, 0.31 m deep. The head is a node where headG sits, because
    the game turns it to follow the walker with lookAt: a node the game poses,
    not a clip (#657, #673). The eyes stay unlit, a MeshBasicMaterial as the
    builder's are, on a lit head: the one Blue Hour model with both kinds
    (#671). The head faces -Z and lookAt points +Z, so the wiring row turns the
    head's lookAt a half turn as it turns the body (#675). Folded wings on the
    flanks and a short tail below; the owl flees without opening them, as the
    builder's does."""
    mat = common.material('owl', col('owl'), roughness=0.9)
    eye = common.material('owl.eye', col('owl-eye'), unlit=True)
    bm = bmesh.new()
    common.sphere(bm, (0.15, 0.155, 0.25), (0, 0, 0.25), segments=10, rings=8)
    for s in (1, -1):
        common.sphere(bm, (0.045, 0.12, 0.19), (s * 0.13, -0.03, 0.23), segments=6, rings=5)
    common.limb(bm, (0, -0.1, 0.1), (0, -0.14, 0.0), 0.06, 0.02, 5)              # tail
    body = common.mesh_object('owl', bm, [mat])

    bm = bmesh.new()
    common.sphere(bm, (0.14, 0.13, 0.125), (0, 0, 0), segments=10, rings=7)
    for s in (1, -1):
        common.limb(bm, (s * 0.085, 0, 0.09), (s * 0.1, -0.01, 0.18), 0.035, 0.004, 4)
    common.limb(bm, (0, 0.115, 0.0), (0, 0.15, -0.035), 0.016, 0.002, 4)         # beak
    eyes = []
    for s in (1, -1):
        eyes += common.sphere(bm, (0.028, 0.028, 0.028), (s * 0.055, 0.103, 0.03), segments=6, rings=4)
    common.paint(bm, eyes, 1)
    common.mesh_object('head', bm, [mat, eye], parent=body, location=(0, 0, 0.52))
    common.ground(body)
    return body


def squirrel(rnd):
    """makeSquirrel() in js/wildlife.js: 0.18 m across, 0.38 m tall, 0.41 m
    nose to tail. The builder is two spheres; the model hunches, with a head,
    ears, haunches and the tail curled up over the back. It is moved whole
    (hopping, then spiralling up a trunk), so no clip and no node. The builder
    floats 2.4 cm above its origin; the model stands on it."""
    mat = common.material('squirrel', col('squirrel'), roughness=0.9)
    bm = bmesh.new()
    common.sphere(bm, (0.085, 0.12, 0.08), (0, 0, 0.1), segments=8, rings=6)
    common.sphere(bm, (0.052, 0.062, 0.052), (0, 0.12, 0.15), segments=7, rings=5)
    for s in (1, -1):
        common.limb(bm, (s * 0.028, 0.115, 0.19), (s * 0.034, 0.108, 0.225), 0.015, 0.003, 3)
        common.sphere(bm, (0.04, 0.06, 0.05), (s * 0.052, -0.04, 0.065), segments=6, rings=4)
        common.limb(bm, (s * 0.04, 0.085, 0.07), (s * 0.04, 0.095, 0.0), 0.018, 0.012, 4)
        common.limb(bm, (s * 0.05, -0.03, 0.03), (s * 0.05, 0.03, 0.0), 0.015, 0.012, 4)
    common.limb(bm, (0, -0.09, 0.08), (0, -0.17, 0.16), 0.04, 0.06, 6)           # the tail,
    common.limb(bm, (0, -0.17, 0.16), (0, -0.17, 0.3), 0.06, 0.063, 6)          # up over
    common.limb(bm, (0, -0.17, 0.3), (0, -0.12, 0.37), 0.063, 0.03, 6)          # the back
    body = common.mesh_object('squirrel', bm, [mat])
    common.ground(body)
    return body


def small_bird(rnd):
    """makeSmallBird() in js/wildlife.js: 1.2 m wingtip to wingtip, as the
    builder draws it for the fog, 0.16 m tall and 0.28 m of chord. Flock
    class: seven fly together, so no clip (#646); but each is a group whose
    wL/wR the game flaps, as Golden Hour's bats are (#659), so the wings are
    nodes pivoted at the shoulder, wingR the builder's wL (+X). The builder's
    body is long across the wings; this one is long nose to tail, a songbird's
    round wings, short bill and notched tail. Unlit and one material, as the
    builder's MeshBasicMaterial is."""
    mat = common.material('small-bird', col('small-bird'), unlit=True, double_sided=True)
    bm = bmesh.new()
    common.sphere(bm, (0.06, 0.1, 0.065), (0, 0, 0), segments=8, rings=6)
    common.sphere(bm, (0.045, 0.045, 0.045), (0, 0.08, 0.03), segments=6, rings=5)
    common.limb(bm, (0, 0.115, 0.028), (0, 0.15, 0.022), 0.012, 0.002, 3)        # the bill
    common.sheet(bm, [(-0.025, -0.08, 0.0), (0.025, -0.08, 0.0), (0.045, -0.14, -0.005),
                      (0.0, -0.12, -0.003), (-0.045, -0.14, -0.005)],
                 [(0, 1, 2, 3), (0, 3, 4)])
    body = common.mesh_object('small-bird', bm, [mat])

    right = [(0, 0.05, 0), (0, -0.06, 0), (0.3, 0.07, 0.035), (0.3, -0.09, 0.035),
             (0.56, 0.02, 0.07), (0.52, -0.08, 0.065)]
    faces = [(1, 3, 2, 0), (3, 5, 4, 2)]
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        common.sheet(bm, right, faces, side)
        common.mesh_object(name, bm, [mat], parent=body, location=(0.04 * side, 0.01, 0.02))
    common.ground(body)
    return body


ITEMS = {
    'crow': ('assets/models/animals/crow.glb', crow),
    'deer': ('assets/models/animals/deer.glb', deer),
    'fox': ('assets/models/animals/fox.glb', fox),
    'owl': ('assets/models/animals/owl.glb', owl),
    'squirrel': ('assets/models/animals/squirrel.glb', squirrel),
    'small-bird': ('assets/models/animals/small-bird.glb', small_bird),
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
