# Orbital's body sheet, rendered from code into assets/sprites/.
#
#   blender -b --factory-startup -P tools/blender/bodies.py
#
# One frame per key of COLOR in js/render.js: planet, star, rock, repulse,
# blackhole, wormhole and booster, in that order, on a 4-wide grid of 256 px
# frames (BACKLOG.md "Orbital: Blender assets" B1, B2). budget.json holds each
# frame's radius and extent, and `node tools/blender/validate.mjs` checks what
# this writes.
#
# Every body is built at one Blender unit per frame pixel, from what drawBody
# in js/render.js draws for it today, minus the glowCircle behind it: the
# game keeps drawing the glow, over the frame, once the wiring row lands (B3).
# A frame is the drawing at spin 0, flow 0 and dir 0. Where drawBody has a
# stroke, its width and dash lengths are the game's numbers (at DPR 1) scaled
# by the frame's pixels per world unit at the body type's default radius in
# js/levelcode.js, so a body at that radius on a 1000-wide playfield shown at
# one screen pixel per world unit gets the stroke the game draws. Where it has
# a gradient, the studio light on a ball stands in for the highlight and the
# stops' hexes colour the parts.

import os
import sys

sys.dont_write_bytecode = True   # no __pycache__ left in the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json  # noqa: E402
import math  # noqa: E402

import bmesh  # noqa: E402

import common  # noqa: E402

SEED = 0x0B_17  # every body gets rng(SEED + its index), whether it draws or not

SHEET = 'assets/sprites/bodies.png'
ATLAS = 'assets/sprites/bodies.json'

with open(os.path.join(common.HERE, 'budget.json'), encoding='utf-8') as f:
    BUDGET = json.load(f)

# The default radius of each type, from DEFAULTS in js/levelcode.js: the
# world radius a stroke's width is scaled against (see the header).
DEFAULT_R = {'planet': 52, 'star': 70, 'rock': 30, 'repulse': 34,
             'blackhole': 26, 'wormhole': 32, 'booster': 40}

# Hexes lifted from drawBody's gradient stops and strokes, named for where
# they sit in js/render.js. Every base colour comes from COLOR via
# common.palette(); these are the second colours the same function draws
# with, and no colour here is new to the game.
STOP = {
    'planet_light': 0xC9F2FF,   # the planet gradient's first stop
    'star_dark': 0xC9701A,      # the star gradient's last stop
    'repulse_ring': 0xFF96E1,   # rgba(255,150,225,.7), the repulsor's dashed ring
    'hole_core': 0x05010F,      # the black hole core's middle stop
    'hole_edge': 0xA08CFF,      # rgba(160,140,255,.9), the core's edge stroke
    'hole_ring0': 0xFFE6FF,     # rgba(255,230,255,.85), the inner accretion ring
    'hole_ring1': 0xC8B4FF,     # rgba(200,180,255,.5), the outer one
    'worm_core': 0x04211D,      # the wormhole core's first stop
}


def px(kind, r):
    """Frame pixels per world unit for a body of type `kind` drawn at r frame
    pixels: what a game stroke width is multiplied by."""
    return r / DEFAULT_R[kind]


def on_ball(r, x, y):
    """The z of the ball's surface over (x, y), or 1 if the point is off it."""
    return math.sqrt(max(r * r - x * x - y * y, 1.0))


def planet(rnd, color):
    """A ball in COLOR.planet, with four cloud banks in the gradient's light
    stop sitting just proud of the surface, seeded, on the half that faces
    the camera; the dark stop is the lit ball's own shadow side."""
    r = 120
    bm = bmesh.new()
    common.sphere(bm, r, slot=0, segments=96, rings=48)
    for _ in range(4):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.15, 0.75) * r
        x, y = math.cos(a) * d, math.sin(a) * d
        w = rnd.uniform(0.18, 0.30) * r
        common.sphere(bm, (w, w * 0.5, w * 0.12), (x, y, on_ball(r, x, y) * 0.995),
                      slot=1, segments=32, rings=16)
    ob = common.mesh_object('planet', bm, [common.material('planet', color),
                                            common.material('planet_light', STOP['planet_light'])])
    return ob, r


def star(rnd, color):
    """A ball in COLOR.star with a lower roughness than the rest, so the
    studio key reads as the gradient's light stop, and three sunspots in its
    dark stop, seeded, on the lit face."""
    r = 120
    bm = bmesh.new()
    common.sphere(bm, r, slot=0, segments=96, rings=48)
    for _ in range(3):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.25, 0.75) * r
        x, y = math.cos(a) * d, math.sin(a) * d
        w = rnd.uniform(0.05, 0.09) * r
        common.sphere(bm, (w, w, w * 0.2), (x, y, on_ball(r, x, y) * 0.995),
                      slot=1, segments=24, rings=12)
    ob = common.mesh_object('star', bm, [common.material('star', color, roughness=0.35),
                                          common.material('star_dark', STOP['star_dark'])])
    return ob, r


def rock(rnd, color):
    """An icosphere pushed about by the seed, flat-shaded in COLOR.rock: an
    asteroid. The mean radius is 108 so the farthest bump stays inside the
    frame's extent."""
    r = 108
    bm = bmesh.new()
    common.bumpy_sphere(bm, r, rnd, amount=0.10, slot=0, subdiv=3)
    ob = common.mesh_object('rock', bm, [common.material('rock', color)])
    return ob, r


def repulse(rnd, color):
    """A ball in COLOR.repulse, and the dashed ring drawBody strokes at 1.5 R:
    lineWidth 1.5, dash [4, 5], in rgba(255,150,225,.7). R is 80 so the ring's
    outer edge lands at the frame's extent."""
    r = 80
    k = px('repulse', r)
    bm = bmesh.new()
    common.sphere(bm, r, slot=0, segments=96, rings=48)
    w = 1.5 * k
    common.dashed_ring(bm, 1.5 * r - w / 2, w, 4 * k, 5 * k, z=0.0, slot=1)
    ob = common.mesh_object('repulse', bm, [common.material('repulse', color),
                                             common.material('repulse_ring', STOP['repulse_ring'], alpha=0.7)])
    return ob, r


def blackhole(rnd, color):
    """drawBody's black hole: two accretion ellipses (1.5 R by 0.7 R, 3 px, in
    rgba(255,230,255,.85); 1.9 R by 0.9 R, 2 px, in rgba(200,180,255,.5)),
    both open from canvas angle 5.5 to 0.3, then the dark core over them with
    a 1.5 px edge in rgba(160,140,255,.9). R is 62 so the outer ring's edge
    lands at the frame's extent. The canvas's angles run clockwise on screen
    (y down) and the frame's run counter-clockwise (y up), so the arcs are
    mirrored to put the gap where the game puts it. COLOR.blackhole is the
    glow's colour, and the glow is the game's; nothing in the frame wears it."""
    r = 62
    k = px('blackhole', r)
    bm = bmesh.new()
    common.sphere(bm, r, slot=0, segments=96, rings=48)
    w = 1.5 * k
    common.annulus(bm, r - w * 0.4, r + w * 0.6, z=0.0, slot=1, segments=128)
    common.ellipse_ring(bm, 1.5 * r, 0.7 * r, 3 * k, -5.5, -0.3, z=-1.0, slot=2)
    common.ellipse_ring(bm, 1.9 * r, 0.9 * r, 2 * k, -5.5, -0.3, z=-2.0, slot=3)
    ob = common.mesh_object('blackhole', bm, [
        common.material('hole_core', STOP['hole_core'], roughness=0.9),   # no hot spot on a black core
        common.material('hole_edge', STOP['hole_edge'], alpha=0.9),
        common.material('hole_ring0', STOP['hole_ring0'], alpha=0.85),
        common.material('hole_ring1', STOP['hole_ring1'], alpha=0.5),
    ])
    return ob, r


def wormhole(rnd, color):
    """drawBody's wormhole: three dashed rings at R, 0.78 R and 0.56 R,
    lineWidth 2, dash [6, 7], in COLOR.wormhole at alpha .75, .57 and .39,
    each turned one radian on from the last, and a dark core (the gradient's
    first stop) fading out at 0.7 R, here a ball squashed nearly flat so the
    light falls off toward its rim. R is 116 so the outer ring's outer edge
    lands at the frame's extent."""
    r = 116
    k = px('wormhole', r)
    bm = bmesh.new()
    w = 2 * k
    for i in range(3):
        common.dashed_ring(bm, r * (1 - i * 0.22), w, 6 * k, 7 * k, z=float(i), slot=i, phase=-float(i))
    common.sphere(bm, (0.7 * r, 0.7 * r, 0.7 * r * 0.12), (0, 0, 0), slot=3, segments=64, rings=32)
    ob = common.mesh_object('wormhole', bm, [
        common.material('worm_ring0', color, alpha=0.75),
        common.material('worm_ring1', color, alpha=0.57),
        common.material('worm_ring2', color, alpha=0.39),
        common.material('worm_core', STOP['worm_core'], roughness=0.8),
    ])
    return ob, r


def booster(rnd, color):
    """drawBody's booster at dir 0 and flow 0: the gate ring at R, lineWidth
    2.5, in COLOR.booster at alpha .85, and three chevrons pointing +x,
    lineWidth 3, at alpha 1, 2/3 and 1/3 from the back of the gate forward.
    The back chevron's tail reaches 1.15 R behind the centre, past the ring,
    so R is 100 to land that tail at the frame's extent; the ring itself sits
    at 103 px. The first render had R at 116 and the tail 134 px out, six
    pixels into the wormhole's frame."""
    r = 100
    k = px('booster', r)
    bm = bmesh.new()
    w = 2.5 * k
    common.annulus(bm, r - w / 2, r + w / 2, z=0.0, slot=0, segments=128)
    for i in range(3):
        off = i / 3
        a = 0.35 + off * 0.6
        cxp = (off - 0.5) * r * 1.6
        common.stroke(bm, [(cxp - r * 0.35, -r * a), (cxp + r * 0.2, 0.0), (cxp - r * 0.35, r * a)],
                      3 * k, z=1.0 + i, slot=1 + i)
    ob = common.mesh_object('booster', bm, [
        common.material('booster_ring', color, alpha=0.85),
        common.material('booster_chev0', color, alpha=1.0),
        common.material('booster_chev1', color, alpha=2 / 3),
        common.material('booster_chev2', color, alpha=1 / 3),
    ])
    return ob, r


BUILDERS = {'planet': planet, 'star': star, 'rock': rock, 'repulse': repulse,
            'blackhole': blackhole, 'wormhole': wormhole, 'booster': booster}


def main():
    common.check_version()
    common.reset()
    colors = common.palette()
    if list(colors) != list(BUILDERS):
        print(f'bodies.py: COLOR in js/render.js has {list(colors)}, and this pack builds '
              f'{list(BUILDERS)}. The two lists have to match, in order.')
        sys.exit(1)

    frames = []
    count = len(BUILDERS)
    for i, (name, build) in enumerate(BUILDERS.items()):
        ob, r = build(common.rng(SEED + i), colors[name])
        _, _, bx, by = common.cell(i, count)
        ob.location = (bx, by, 0.0)
        want = BUDGET['items'][name]['r']
        if r != want:
            print(f'bodies.py: {name} is built at r {r}, and budget.json says {want}. '
                  f'Move one to the other.')
            sys.exit(1)
        frames.append((name, common.FRAME // 2, common.FRAME // 2, r))
        print(f'{name}: r {r} px, {len(ob.data.polygons)} faces')

    png, js = common.render_sheet(frames, SHEET, ATLAS)
    print(f'wrote {os.path.relpath(png, common.PROJECT)} ({os.path.getsize(png)} bytes) '
          f'and {os.path.relpath(js, common.PROJECT)}')
    print(f'contact sheet: {common.contact_sheet("bodies")}')


if __name__ == '__main__':
    main()
