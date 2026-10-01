# Golden Hour's animal pack, built from code into assets/models/animals/.
#
#   blender -b --factory-startup -P tools/blender/animals.py -- [item ...]
#
# No item named builds them all. budget.json holds every item's box, class,
# clips and the nodes the game poses, and `node tools/blender/validate.mjs`
# checks what this writes (BACKLOG.md "Golden Hour: Blender assets" B3).
#
# Every animal faces +Y here, which the exporter writes as -Z (#655, #656): x
# across, z up. Each builder in js/ faces its own way (most lead with +X), so
# the sizes below are the builder's, turned: a builder's (x, y, z) is Blender's
# (z, x, y) for a +X builder. Every origin is the centre of the base (#655), not
# the builder's origin; budget.json's items say how far apart the two are.

import json
import math
import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

import bmesh  # noqa: E402

SEED = 0x60_1D  # every item gets rng(SEED + its index), whether it draws or not

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    PALETTE = json.load(f)['palette']


def col(name):
    """A palette colour by its budget.json name: colours are data (#653)."""
    return int(PALETTE[name], 16)


def gull(rnd):
    """makeGull() in js/wildlife.js, at its box: 3.2 m wingtip to wingtip,
    0.35 m tall, 0.7 m long. It faces +Y here, which the exporter writes as
    -Z, the way the orbiting gulls fly. The wings are their own nodes, pivoted
    at the shoulder, so the game can still pose them the way it poses wL/wR
    today: wingR is the builder's wL (+X) and wingL its wR (-X)."""
    body_mat = common.material('gull', col('gull'), unlit=True, double_sided=True)
    bill_mat = common.material('gull.bill', col('bill'), unlit=True)

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


def dolphin(rnd):
    """makeDolphin() in js/wildlife.js: 6.8 m nose to flukes, 2.45 m belly to
    fin tip, 1.6 m across. The builder's is three times a real dolphin, seen at
    110 to 180 m, and its tail is a cone stood on edge like a fish's; the
    flukes here lie flat, as a dolphin's do, inside the same box (#658). No
    part of it moves on its own: the arcs pitch and carry the whole body, so it
    has no clip (#657)."""
    mat = common.material('dolphin', col('dolphin'), roughness=0.4)
    bm = bmesh.new()
    common.sphere(bm, (0.8, 2.6, 0.9), (0, 0, 0), segments=12, rings=8)
    # The beak: the builder's nose cone, 2.2 to 3.6 m forward.
    common.limb(bm, (0, 2.2, 0.05), (0, 3.6, 0.0), 0.45, 0.10, segments=8)
    # The dorsal fin, swept back, its tip at the builder's 1.55 m.
    common.solid(bm, [(0.12, 0.6, 0.6), (-0.12, 0.6, 0.6), (-0.12, -0.35, 0.6),
                      (0.12, -0.35, 0.6), (0, -0.5, 1.55)],
                 [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)])
    # Flukes, flat and notched, reaching the builder's -3.2 m.
    common.solid(bm, [(0, -2.3, 0.07), (-0.75, -3.2, 0), (0, -2.95, 0.04), (0.75, -3.2, 0),
                      (0, -2.3, -0.07), (0, -2.95, -0.04)],
                 [(0, 1, 2), (0, 2, 3), (4, 5, 1), (4, 3, 5),
                  (0, 4, 1), (0, 3, 4), (2, 1, 5), (2, 5, 3)])
    # Pectoral fins, down and back.
    for s in (1, -1):
        common.solid(bm, [(s * 0.6, 1.4, -0.35), (s * 0.6, 0.9, -0.35), (s * 0.6, 1.4, -0.45),
                          (s * 0.6, 0.9, -0.45), (s * 0.85, 0.7, -0.75)],
                     [(0, 1, 4), (1, 3, 4), (3, 2, 4), (2, 0, 4), (0, 2, 3, 1)])
    body = common.mesh_object('dolphin', bm, [mat])
    common.ground(body)
    return body


def crab(rnd):
    """makeCrab() in js/creatures/crabs.js: 0.33 m across the claws, 0.21 m
    front to back, 0.1 m tall. The builder's claws are on its +Z side and it
    runs along its own +Z, so here they lead (+Y). It moves only as a whole, so
    it has no clip (#657)."""
    mat = common.material('crab', col('crab'))
    bm = bmesh.new()
    common.sphere(bm, (0.135, 0.099, 0.0495), (0, 0, 0), segments=8, rings=6)
    for s in (1, -1):
        common.sphere(bm, (0.035, 0.035, 0.035), (s * 0.13, 0.08, 0.01), segments=6, rings=5)
        for y in (0.03, -0.01, -0.05):
            common.limb(bm, (s * 0.09, y, -0.005), (s * 0.16, y - 0.02, -0.045), 0.01, 0.005, 3)
        common.limb(bm, (s * 0.04, 0.08, 0.03), (s * 0.045, 0.085, 0.055), 0.006, 0.006, 3)
    body = common.mesh_object('crab', bm, [mat])
    common.ground(body)
    return body


def heron(rnd):
    """makeHeronMesh() in js/creatures/estuary.js: 1.51 m to the crown, 1.28 m
    tail to bill tip, 0.43 m across. Its head is a node (skull and bill), as
    the builder's head group is, and `strike` is the dart update() plays on it:
    down 0.55 m and out 0.25 m and back, over 0.5 s (#657). The flight's bob is
    the whole body's pitch and stays the game's."""
    grey = common.material('heron', col('heron'))
    bill = common.material('heron.bill', col('bill'), roughness=0.6)
    bm = bmesh.new()
    common.sphere(bm, (0.224, 0.448, 0.28), (0, 0, 0.72), segments=10, rings=8)
    common.limb(bm, (0, 0.22, 0.84), (0, 0.33, 1.10), 0.06, 0.05, 6)
    common.limb(bm, (0, 0.33, 1.10), (0, 0.40, 1.38), 0.05, 0.045, 6)
    for s in (1, -1):
        common.limb(bm, (s * 0.08, 0.0, 0.0), (s * 0.08, 0.0, 0.62), 0.018, 0.018, 4)
        common.limb(bm, (s * 0.08, -0.06, 0.004), (s * 0.08, 0.10, 0.004), 0.008, 0.008, 3)
    body = common.mesh_object('heron', bm, [grey])

    bm = bmesh.new()
    common.sphere(bm, (0.09, 0.09, 0.09), (0, 0, 0), segments=8, rings=6)
    common.limb(bm, (0, -0.05, 0.06), (0, -0.18, 0.04), 0.012, 0.004, 3)   # the plume
    beak = common.limb(bm, (0, 0.05, 0), (0, 0.39, 0), 0.03, 0.004, 5)
    common.paint(bm, beak, 1)
    head = common.mesh_object('head', bm, [grey, bill], parent=body, location=(0, 0.44, 1.42))

    common.ground(body)
    rest = head.location.copy()

    def dart(ob, t):
        s = math.sin(math.pi * t)
        ob.location = (rest.x, rest.y + 0.25 * s, rest.z - 0.55 * s)
    common.clip('strike', head, 15, dart, paths=('location',))
    return body


def cormorant(rnd):
    """makeCormorantMesh() in js/creatures/estuary.js: 0.72 m tall, 0.54 m
    long, the wings held open to dry. update() spreads and half-folds them,
    scale 0.55 to 0.95 about the body's centre line on a 21 s cycle; `dry` is
    that cycle (#657). The rest pose is the full spread, 0.95, because a clip's
    first frame is the rest pose and the builder's own scale 1 is never shown
    (#657)."""
    dark = common.material('cormorant', col('cormorant'), roughness=0.7)
    wing_mat = common.material('cormorant.wing', col('cormorant-wing'), double_sided=True,
                               roughness=0.8)
    bm = bmesh.new()
    common.sphere(bm, (0.144, 0.252, 0.198), (0, 0, 0.2), segments=8, rings=7)
    common.limb(bm, (0, 0.09, 0.32), (0, 0.19, 0.64), 0.05, 0.035, 5)
    common.sphere(bm, (0.06, 0.06, 0.06), (0, 0.24, 0.66), segments=6, rings=5)
    common.limb(bm, (0, 0.28, 0.655), (0, 0.33, 0.64), 0.015, 0.006, 4)   # the bill
    body = common.mesh_object('cormorant', bm, [dark])

    # One wing at full spread, pivoted where the builder scales it from.
    k = 0.95
    right = [(0, 0.03, 0), (0.5 * k, 0.05 * k, 0.30), (0.42 * k, -0.15 * k, -0.05),
             (0.2 * k, -0.12 * k, 0.0)]
    faces = [(0, 1, 2), (0, 2, 3)]
    wings = []
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        common.sheet(bm, right, faces, side)
        wings.append(common.mesh_object(name, bm, [wing_mat], parent=body, location=(0, 0, 0.2)))

    common.ground(body)

    # 628 frames is 20.93 s, the builder's 2 pi / 0.3.
    for w in wings:
        def spread(ob, t):
            s = (0.75 + 0.2 * math.cos(2 * math.pi * t)) / k
            ob.scale = (s, s, 1.0)
        common.clip('dry', w, 628, spread, paths=('scale',))
    return body


def owl(rnd):
    """The owl in makeOwl(), js/creatures/nightlife.js: 0.64 m from the body's
    base to the ear tufts, 0.31 m across. Its head is a node, as the builder's
    is, because update() turns it to follow the walker with lookAt, which is
    the game's to drive and not a clip (#657). The tufts ride on the head here;
    the builder left them on the body. The beak shows which way it faces (+Y,
    so -Z), and lookAt points +Z: rank 2 turns it (#656). The snags it perches
    on stay the game's."""
    mat = common.material('owl', col('owl'), roughness=0.9)
    bm = bmesh.new()
    common.sphere(bm, (0.16, 0.16, 0.24), (0, 0, 0), segments=8, rings=7)
    body = common.mesh_object('owl', bm, [mat])

    bm = bmesh.new()
    common.sphere(bm, (0.11, 0.11, 0.11), (0, 0, 0), segments=8, rings=6)
    for s in (1, -1):
        common.limb(bm, (s * 0.06, 0, 0.065), (s * 0.06, 0, 0.135), 0.03, 0.003, 4)
    common.limb(bm, (0, 0.09, -0.01), (0, 0.13, -0.035), 0.015, 0.002, 4)
    common.mesh_object('head', bm, [mat], parent=body, location=(0, 0, 0.26))
    common.ground(body)
    return body


def bat(rnd):
    """One bat of makeBats(), js/creatures/nightlife.js: 0.44 m across and
    0.2 m of chord, and 3 cm thick, since the builder is two wing triangles and
    no body. Flock class: no clip (#646), but the wings are nodes, pivoted at
    the shoulder, because update() flaps each bat's wL/wR itself. Unlit, as
    the builder's MeshBasicMaterial is."""
    mat = common.material('bat', col('bat'), unlit=True, double_sided=True)
    bm = bmesh.new()
    common.sphere(bm, (0.025, 0.06, 0.015), (0, 0, 0.015), segments=6, rings=4)
    body = common.mesh_object('bat', bm, [mat])

    right = [(0, 0.07, 0), (0.10, 0.10, 0.01), (0.20, 0.0, 0.018), (0.12, -0.08, 0.008),
             (0, -0.10, 0)]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 4)]
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        common.sheet(bm, right, faces, side)
        common.mesh_object(name, bm, [mat], parent=body, location=(0.02 * side, 0, 0.012))
    common.ground(body)
    return body


def pelican(rnd):
    """makePelican() in js/creatures/pelicans.js: 4.8 m wingtip to wingtip,
    2.85 m tail to bill tip, 0.75 m tall. The builder lays its wings along the
    body, fore and aft; here they go across, where a pelican's are, and the box
    is the builder's turned to match (#658). Wings are nodes at the shoulder,
    and `fly` is the flap train's beat: 0.55 rad each way at 9 rad/s, 21 frames
    (#657). The glide between trains is a 0.06 rad drift the wiring row can
    fade the clip's weight to."""
    mat = common.material('pelican', col('pelican'))
    wing_mat = common.material('pelican.wing', col('pelican-wing'), double_sided=True,
                               roughness=0.9)
    bm = bmesh.new()
    common.sphere(bm, (0.35, 0.95, 0.375), (0, 0, 0), segments=10, rings=8)
    common.sphere(bm, (0.15, 0.17, 0.15), (0, 0.85, 0.18), segments=8, rings=6)
    common.limb(bm, (0, 0.8, 0.1), (0, 1.9, -0.05), 0.12, 0.03, 6)          # bill and pouch
    body = common.mesh_object('pelican', bm, [mat])

    right = [(0, 0.35, 0), (0, -0.35, 0), (1.1, 0.30, 0.05), (1.1, -0.40, 0.05),
             (2.2, 0.05, 0.10), (2.0, -0.30, 0.08)]
    faces = [(1, 3, 2, 0), (3, 5, 4), (3, 4, 2)]
    wings = []
    for name, side in (('wingR', 1), ('wingL', -1)):
        bm = bmesh.new()
        common.sheet(bm, right, faces, side)
        wings.append(common.mesh_object(name, bm, [wing_mat], parent=body,
                                        location=(0.2 * side, 0.05, 0.1)))
    amp = 0.55
    for w, side in zip(wings, (1, -1)):
        def pose(ob, t, side=side):
            ob.rotation_euler = (0.0, -side * amp * math.sin(2 * math.pi * t), 0.0)
        common.clip('fly', w, 21, pose)
    common.ground(body)
    return body


def sanderling(rnd):
    """birdGeometry() in js/creatures/sanderlings.js: 0.33 m bill to tail,
    0.2 m tall, 0.14 m across. Flock class: one mesh, one material, no nodes
    and no clip, so it can go straight into the flock's InstancedMesh (#646,
    #657). The legs and bill are the body's colour for the same reason."""
    mat = common.material('sanderling', col('sanderling'), roughness=0.9)
    bm = bmesh.new()
    common.sphere(bm, (0.072, 0.153, 0.081), (0, 0, 0), segments=8, rings=6)
    common.sphere(bm, (0.05, 0.05, 0.05), (0, 0.13, 0.07), segments=6, rings=5)
    common.limb(bm, (0, 0.17, 0.065), (0, 0.20, 0.06), 0.008, 0.003, 3)
    for s in (1, -1):
        common.limb(bm, (s * 0.025, 0, -0.06), (s * 0.025, 0.005, -0.096), 0.005, 0.004, 3)
    body = common.mesh_object('sanderling', bm, [mat])
    common.ground(body)
    return body


def seal(rnd):
    """makeSeal() in js/creatures/seals.js: 2.94 m nose to rear flippers,
    0.83 m tall, 0.98 m across. The head is a node, because update() lifts it
    toward a target on a random clock, which is the game's to drive. `breathe`
    is the other thing update() does: the body swells 3.5% along and up on a
    9 s cycle (#657). It is keyed on the root, so the swell is about the belly
    on the sand, not the body's centre."""
    mat = common.material('seal', col('seal'), roughness=0.75)
    bm = bmesh.new()
    common.sphere(bm, (0.495, 1.21, 0.4125), (0, 0, 0), segments=12, rings=9)
    for s in (1, -1):
        common.solid(bm, [(s * 0.08, -1.0, 0.05), (s * 0.08, -1.0, -0.05),
                          (s * 0.05, -1.5, 0.0), (s * 0.30, -1.55, 0.0)],
                     [(0, 2, 3), (1, 3, 2), (0, 1, 2), (0, 3, 1)])
        common.solid(bm, [(s * 0.40, 0.65, -0.25), (s * 0.40, 0.40, -0.25),
                          (s * 0.40, 0.55, -0.35), (s * 0.48, 0.25, -0.38)],
                     [(0, 1, 2), (0, 1, 3), (1, 2, 3), (0, 2, 3)])
    body = common.mesh_object('seal', bm, [mat])

    bm = bmesh.new()
    common.sphere(bm, (0.24, 0.24, 0.24), (0, 0, 0), segments=8, rings=6)
    common.sphere(bm, (0.10, 0.12, 0.09), (0, 0.20, -0.04), segments=6, rings=5)
    common.mesh_object('head', bm, [mat], parent=body, location=(0, 1.15, 0.18))
    common.ground(body)

    def swell(ob, t):
        s = 1 + 0.035 * math.sin(2 * math.pi * t)
        ob.scale = (1.0, s, s)
    common.clip('breathe', body, 270, swell, paths=('scale',))
    return body


ITEMS = {
    'gull': ('assets/models/animals/gull.glb', gull),
    'dolphin': ('assets/models/animals/dolphin.glb', dolphin),
    'crab': ('assets/models/animals/crab.glb', crab),
    'heron': ('assets/models/animals/heron.glb', heron),
    'cormorant': ('assets/models/animals/cormorant.glb', cormorant),
    'owl': ('assets/models/animals/owl.glb', owl),
    'bat': ('assets/models/animals/bat.glb', bat),
    'pelican': ('assets/models/animals/pelican.glb', pelican),
    'sanderling': ('assets/models/animals/sanderling.glb', sanderling),
    'seal': ('assets/models/animals/seal.glb', seal),
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
