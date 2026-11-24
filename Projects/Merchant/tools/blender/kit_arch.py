"""Architecture kit. Batch 1 needs the room shell and the wooden lattice
window screen; walls, towers, arches, domes and minarets join in batch 3.
"""
import math

import bpy
import bmesh
from mathutils import Vector

import common as C


def wall_with_opening(name, length, height, thick, hole, mat, axis="X"):
    """A wall slab along `axis` from 0..length, 0..height, with a
    rectangular hole (u0, z0, u1, z1) in wall coordinates. Built from four
    boxes, no booleans. Returns the list of pieces (local, unplaced)."""
    u0, z0, u1, z1 = hole
    pieces = []
    rects = [(0, 0, u0, height), (u1, 0, length, height), (u0, 0, u1, z0), (u0, z1, u1, height)]
    for k, (a0, b0, a1, b1) in enumerate(rects):
        if a1 - a0 <= 1e-6 or b1 - b0 <= 1e-6:
            continue
        if axis == "X":
            size = (a1 - a0, thick, b1 - b0)
            ctr = ((a0 + a1) / 2, 0, (b0 + b1) / 2)
        else:
            size = (thick, a1 - a0, b1 - b0)
            ctr = (0, (a0 + a1) / 2, (b0 + b1) / 2)
        pieces.append(C.box_mesh("%s_%d" % (name, k), size, ctr, mat))
    return pieces


def room(x0, x1, y0, y1, height, wall_mat, floor_mat=None, ceil_mat=None,
         window=None, thick=0.25):
    """Closed room x0..x1, y0..y1, floor at z=0. window = (side, u0, z0, u1, z1)
    where side is one of 'N' (y1), 'S' (y0), 'E' (x1), 'W' (x0) and u runs
    along the wall from its low-coordinate end."""
    out = []
    fm = floor_mat or wall_mat
    cm = ceil_mat or wall_mat
    out.append(C.box_mesh("Floor", (x1 - x0 + 2 * thick, y1 - y0 + 2 * thick, 0.1),
                          ((x0 + x1) / 2, (y0 + y1) / 2, -0.05), fm))
    out.append(C.box_mesh("Ceiling", (x1 - x0 + 2 * thick, y1 - y0 + 2 * thick, 0.1),
                          ((x0 + x1) / 2, (y0 + y1) / 2, height + 0.05), cm))
    sides = {
        "N": ("X", x1 - x0, (x0, y1 + thick / 2)),
        "S": ("X", x1 - x0, (x0, y0 - thick / 2)),
        "E": ("Y", y1 - y0, (x1 + thick / 2, y0)),
        "W": ("Y", y1 - y0, (x0 - thick / 2, y0)),
    }
    for side, (axis, length, (ox, oy)) in sides.items():
        hole = (0, 0, 0, 0)
        if window and window[0] == side:
            hole = window[1:]
        if hole == (0, 0, 0, 0):
            size = (length, thick, height) if axis == "X" else (thick, length, height)
            ctr = (ox + length / 2, oy, height / 2) if axis == "X" else (ox, oy + length / 2, height / 2)
            out.append(C.box_mesh("Wall" + side, size, ctr, wall_mat))
        else:
            for p in wall_with_opening("Wall" + side, length, height, thick, hole, wall_mat, axis):
                p.location = (ox, oy, 0) if axis == "X" else (ox, oy, 0)
                out.append(p)
    return out


_SPINDLE = {}
C.RESET_HOOKS.append(_SPINDLE.clear)


def _spindle_mesh(length, r, beads):
    key = (round(length, 4), round(r, 4), beads)
    if key in _SPINDLE:
        return _SPINDLE[key]
    prof = [(0.0, 0.0), (r * 0.7, 0.0)]
    for i in range(beads):
        z0 = length * i / beads
        seg = length / beads
        prof += [(r * 0.65, z0 + seg * 0.08), (r * 1.25, z0 + seg * 0.3), (r * 1.45, z0 + seg * 0.5),
                 (r * 1.25, z0 + seg * 0.7), (r * 0.65, z0 + seg * 0.92)]
    prof += [(r * 0.7, length), (0.0, length)]
    ob = C.lathe("spindle_tmp", prof, 10, None, True)
    me = ob.data
    bpy.data.objects.remove(ob)
    _SPINDLE[key] = me
    return me


def lattice_screen(name, width, height, cell=0.05, bar=0.006, mat=None, frame=0.035, depth=0.03):
    """Mashrabiya-style screen in the XZ plane (width along X, height along
    Z, centred on x=0, bottom at z=0, facing Y). Turned wooden spindles on a
    square grid, rotated 45 degrees for the diamond pattern seen in Cairo
    screens, inside a plain frame."""
    mat = mat or C.M("plain_wood", tint=(0.42, 0.28, 0.17), scale=4.0)
    parts = []
    # frame
    for (sx, sz, cx, cz) in ((width, frame, 0, frame / 2), (width, frame, 0, height - frame / 2),
                             (frame, height, -width / 2 + frame / 2, height / 2),
                             (frame, height, width / 2 - frame / 2, height / 2)):
        parts.append(C.box_mesh(name + "_frame", (sx, depth * 1.4, sz), (cx, 0, cz), mat))
    # diagonal spindles, clipped to the inner rectangle by construction
    iw, ih = width - 2 * frame, height - 2 * frame
    x0, z0 = -iw / 2, frame
    step = cell * math.sqrt(2)
    me_cache = {}
    for direction in (1, -1):
        # lines x - direction*z = c
        cmin = -ih - iw if direction > 0 else -iw
        k0 = int(math.floor((-iw - ih) / step)) - 1
        k1 = int(math.ceil((iw + ih) / step)) + 1
        for k in range(k0, k1 + 1):
            c = k * step
            # param line: (u, v) inside [0,iw]x[0,ih], u - d*v = c'
            pts = []
            for (u, v) in ((0, None), (iw, None), (None, 0), (None, ih)):
                if u is not None:
                    vv = (u - c) / direction if direction else 0
                    if 0 <= vv <= ih:
                        pts.append((u, vv))
                else:
                    uu = c + direction * v
                    if 0 <= uu <= iw:
                        pts.append((uu, v))
            pts = sorted(set((round(a, 6), round(b, 6)) for a, b in pts))
            if len(pts) < 2:
                continue
            (ua, va), (ub, vb) = pts[0], pts[-1]
            L = math.hypot(ub - ua, vb - va)
            if L < cell * 0.5:
                continue
            nb = max(1, int(round(L / cell)))
            me = _spindle_mesh(L, bar, nb)
            ob = bpy.data.objects.new(name + "_sp", me)
            C.link(ob)
            if not me.materials:
                me.materials.append(mat)
            ang = math.atan2(vb - va, ub - ua)
            ob.location = (x0 + ua, 0, z0 + va)
            # spindle runs along local Z; rotate so Z points along (du, 0, dv)
            ob.rotation_euler = (0, math.pi / 2 - ang, 0)
            parts.append(ob)
    e = bpy.data.objects.new(name, None)
    C.link(e)
    for p in parts:
        p.parent = e
    return e


# ==========================================================================
# batch 3: walls, towers, arches, arcades, domes, minarets, houses
# ==========================================================================
def arch_curve(cx, w, spring, kind="round", n=16):
    """Points of an arch head from the right springer to the left, centred
    at cx, span w, springing at height `spring`. kind: round | pointed |
    horseshoe-free two-centred 'pointed' (the Islamic and Gothic arch)."""
    r = w / 2
    pts = []
    if kind == "round":
        for i in range(n + 1):
            a = math.pi * i / n
            pts.append((cx + r * math.cos(a), spring + r * math.sin(a)))
    else:
        # two-centred pointed arch: centres inside the span at +-e
        e = r * 0.35
        R = r + e
        a_top = math.acos(e / R)
        half = n // 2
        for i in range(half + 1):
            a = a_top * i / half
            pts.append((cx - e + R * math.cos(a), spring + R * math.sin(a)))
        for i in range(half, -1, -1):
            a = a_top * i / half
            pts.append((cx + e - R * math.cos(a), spring + R * math.sin(a)))
        pts = pts[: half + 1] + pts[half + 2:]
    return pts


def arch_top(w, kind="round"):
    r = w / 2
    return r if kind == "round" else math.sqrt((r * 1.35) ** 2 - (r * 0.35) ** 2)


def arched_panel(name, width, height, thick, openings, mat, kind="round"):
    """A flat wall panel in the X-Z plane (0..width, 0..height, centred on
    y = 0, thickness along Y) with arched openings that reach its foot.
    openings = list of (cx, span, spring_height). One ngon outline,
    extruded; no booleans."""
    outline = [(0.0, 0.0)]
    for cx, w, spr in sorted(openings):
        outline += [(cx - w / 2, 0.0), (cx - w / 2, spr)]
        head = arch_curve(cx, w, spr, kind)
        head = list(reversed(head))          # left springer to right
        outline += head[1:-1]
        outline += [(cx + w / 2, spr), (cx + w / 2, 0.0)]
    outline += [(width, 0.0), (width, height), (0.0, height)]
    # drop duplicate consecutive points
    clean = []
    for p in outline:
        if not clean or (abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6):
            clean.append(p)
    if abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    bm = bmesh.new()
    vs = [bm.verts.new((x, -thick / 2, z)) for x, z in clean]
    f = bm.faces.new(vs)
    ex = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in ex["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, thick, 0), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY",
                          ngon_method="EAR_CLIP")
    return C.from_bmesh(name, bm, mat)


def soffits(name, openings, thick, mat, kind="round", y=0.0):
    """The curved underside of each arch through the wall's thickness."""
    out = []
    for k, (cx, w, spr) in enumerate(openings):
        head = arch_curve(cx, w, spr, kind)
        verts, faces = [], []
        for x, z in head:
            verts += [(x, y - thick / 2, z), (x, y + thick / 2, z)]
        for i in range(len(head) - 1):
            a = 2 * i
            faces.append((a, a + 2, a + 3, a + 1))
        out.append(C.mesh_object("%s_%d" % (name, k), verts, faces, mat))
    return out


def merlons(name, x0, x1, z, thick, mat, w=0.9, h=1.1, gap=0.7, y=0.0, axis="X"):
    """A row of square merlons along a wall top."""
    out = []
    n = int((x1 - x0) / (w + gap))
    for i in range(n):
        u = x0 + gap / 2 + i * (w + gap) + w / 2
        ctr = (u, y, z + h / 2) if axis == "X" else (y, u, z + h / 2)
        size = (w, thick, h) if axis == "X" else (thick, w, h)
        out.append(C.box_mesh("%s_%d" % (name, i), size, ctr, mat))
    return out


def tower(name, w, d, h, mat, crenel=True, loc=(0, 0, 0)):
    parts = [C.box_mesh(name, (w, d, h), (loc[0], loc[1], loc[2] + h / 2), mat)]
    # a slight string course near the top
    parts.append(C.box_mesh(name + "_course", (w + 0.3, d + 0.3, 0.35), (loc[0], loc[1], loc[2] + h - 1.6), mat))
    if crenel:
        for s in (-1, 1):
            parts += merlons(name + "_mx%d" % s, loc[0] - w / 2, loc[0] + w / 2, loc[2] + h, 0.6, mat,
                             y=loc[1] + s * (d / 2 - 0.3))
            parts += merlons(name + "_my%d" % s, loc[1] - d / 2, loc[1] + d / 2, loc[2] + h, 0.6, mat,
                             y=loc[0] + s * (w / 2 - 0.3), axis="Y")
    return parts


def dome(name, r, mat, drum=0.0, ribbed=False, loc=(0, 0, 0), point=0.15):
    """A dome on an optional drum; slightly pointed at the crown."""
    prof = [(0.0, 0.0), (r, 0.0)]
    if drum:
        prof.append((r, drum))
    for i in range(1, 13):
        a = (math.pi / 2) * i / 12
        rr = r * math.cos(a)
        zz = drum + r * math.sin(a) * (1 + point * (i / 12) ** 3)
        prof.append((rr, zz))
    prof.append((0.0, drum + r * (1 + point) + r * 0.08))
    ob = C.lathe(name, prof, 32 if not ribbed else 24, mat, True)
    if ribbed:
        for i, v in enumerate(ob.data.vertices):
            a = math.atan2(v.co.y, v.co.x)
            if v.co.z > drum:
                k = 1.0 + 0.04 * math.cos(a * 12)
                v.co.x *= k
                v.co.y *= k
    ob.location = loc
    return ob


def minaret_mamluk(name, height=48.0, mat=None, loc=(0, 0, 0)):
    """A Mamluk minaret: a tall square shaft, a balcony, an eight-sided
    stage, a second balcony, an open pavilion of slender posts, and a
    small ribbed bulbous cap with a finial."""
    mat = mat or C.M("pale_block")
    H = height
    x, y, z = loc
    parts = []
    w = H * 0.11
    h1 = H * 0.42
    parts.append(C.box_mesh(name + "_sq", (w, w, h1), (x, y, z + h1 / 2), mat))
    parts.append(C.box_mesh(name + "_bal1", (w * 1.35, w * 1.35, H * 0.012), (x, y, z + h1), mat))
    # balcony corbel band under it
    parts.append(C.box_mesh(name + "_cor1", (w * 1.15, w * 1.15, H * 0.02), (x, y, z + h1 - H * 0.012), mat))
    h2 = H * 0.26
    o = C.lathe(name + "_oct", [(0, 0), (w * 0.48, 0), (w * 0.46, h2), (0, h2)], 8, mat, False)
    o.location = (x, y, z + h1 + H * 0.006)
    o.rotation_euler = (0, 0, math.pi / 8)
    parts.append(o)
    z2 = z + h1 + h2
    b2 = C.lathe(name + "_bal2", [(0, 0), (w * 0.66, 0), (w * 0.66, H * 0.012), (0, H * 0.012)], 16, mat, False)
    b2.location = (x, y, z2)
    parts.append(b2)
    # open pavilion: eight posts under a small roof ring
    hp = H * 0.11
    for i in range(8):
        a = 2 * math.pi * i / 8
        parts.append(C.box_mesh("%s_post%d" % (name, i), (w * 0.06, w * 0.06, hp),
                                (x + math.cos(a) * w * 0.32, y + math.sin(a) * w * 0.32, z2 + hp / 2), mat))
    ring = C.lathe(name + "_ring", [(0, 0), (w * 0.4, 0), (w * 0.4, H * 0.015), (0, H * 0.015)], 16, mat, False)
    ring.location = (x, y, z2 + hp)
    parts.append(ring)
    # bulb: ribbed cap
    cap = C.lathe(name + "_cap", [(0, 0), (w * 0.26, 0), (w * 0.34, H * 0.03), (w * 0.3, H * 0.06),
                                  (w * 0.16, H * 0.085), (w * 0.05, H * 0.1), (0, H * 0.105)], 24, mat, True)
    for v in cap.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        k = 1 + 0.07 * math.cos(a * 12)
        v.co.x *= k
        v.co.y *= k
    cap.location = (x, y, z2 + hp + H * 0.015)
    parts.append(cap)
    parts.append(C.box_mesh(name + "_fin", (0.12, 0.12, H * 0.03), (x, y, z2 + hp + H * 0.135), C.M("brass")))
    return parts


def flat_house(name, w, d, h, mat, loc=(0, 0, 0), rot=0.0, parapet=0.6, windows=True, salt=0):
    """A flat-roofed house: a block with a low parapet and a few small dark
    window holes (dark inset boxes)."""
    r = C.rng(salt)
    x, y, z = loc
    parts = [C.box_mesh(name, (w, d, h), (0, 0, h / 2), mat)]
    parts.append(C.box_mesh(name + "_par", (w + 0.1, d + 0.1, parapet), (0, 0, h + parapet / 2 - 0.4), mat))
    if windows:
        dark = C.M("dark", colour=(0.03, 0.025, 0.02))
        for k in range(r.randint(1, 3)):
            wx = r.uniform(-w * 0.35, w * 0.35)
            wz = r.uniform(h * 0.45, h * 0.85)
            parts.append(C.box_mesh("%s_win%d" % (name, k), (0.7, 0.06, 0.9), (wx, -d / 2 - 0.02, wz), dark))
    g = bpy.data.objects.new(name + "_grp", None)
    C.link(g)
    for p in parts:
        p.parent = g
    g.location = loc
    g.rotation_euler = (0, 0, rot)
    return g


def town(name, x0, x1, y0, y1, mat, n=120, h=(5, 12), size=(6, 14), salt=0, avoid=None, ground=None):
    """Scatter flat-roofed houses over a rectangle. avoid(x, y) -> True to
    skip a spot; ground(x, y) -> z for uneven ground."""
    r = C.rng(salt)
    out = []
    for i in range(n * 3):
        if len(out) >= n:
            break
        x, y = r.uniform(x0, x1), r.uniform(y0, y1)
        if avoid and avoid(x, y):
            continue
        z = ground(x, y) if ground else 0.0
        w, d = r.uniform(*size), r.uniform(*size)
        hh = r.uniform(*h)
        mm = mat[r.randrange(len(mat))] if isinstance(mat, (list, tuple)) else mat
        out.append(flat_house("%s_%d" % (name, i), w, d, hh, mm, (x, y, z - 0.5), r.uniform(-0.15, 0.15),
                              salt=salt * 1000 + i))
    return out


def rounded_block(name, size, center, mat, round_=0.35, wobble=0.12, salt=0):
    """A hand-built earthen mass: a box with heavily rounded edges and a
    soft uneven surface (Sahel mud architecture)."""
    ob = C.box_mesh(name, size, center, mat)
    b = ob.modifiers.new("Bevel", "BEVEL")
    b.width = min(round_, min(size) * 0.45)
    b.segments = 4
    C.subsurf(ob, 2)
    tex = bpy.data.textures.new(name + "_w", "CLOUDS")
    tex.noise_scale = 1.5
    d = ob.modifiers.new("Wobble", "DISPLACE")
    d.texture = tex
    d.strength = wobble
    d.texture_coords = "OBJECT"
    return ob
