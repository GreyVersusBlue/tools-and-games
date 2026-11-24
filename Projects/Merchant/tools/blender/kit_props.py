"""Props kit: everything small that sits on a table or a quay.

Each function builds one object (or a small group parented to an empty) at
the origin, standing on z = 0, and returns it. Callers move it. All sizes in
metres. Every random choice goes through common.rng(salt) so a prop comes out
the same every run.
"""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise

import common as C


def group(name, children, loc=(0, 0, 0), rot_z=0.0):
    e = bpy.data.objects.new(name, None)
    C.link(e)
    for ch in children:
        ch.parent = e
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    return e


def place(ob, loc, rot_z=0.0, tilt=(0.0, 0.0)):
    ob.location = Vector(loc)
    ob.rotation_euler = (tilt[0], tilt[1], rot_z)
    return ob


# --------------------------------------------------------------------------
# vessels
# --------------------------------------------------------------------------
def bowl(name="Bowl", r=0.08, h=0.045, wall=0.004, mat="brass", foot=True, salt=1, jitter=0.01):
    """Open bowl with a rolled rim and optional foot ring."""
    prof = []
    if foot:
        prof += [(0.0, 0.0), (r * 0.42, 0.0), (r * 0.45, 0.004), (r * 0.40, 0.007)]
    else:
        prof += [(0.0, 0.0), (r * 0.45, 0.0)]
    # outer wall
    for i in range(1, 10):
        t = i / 9
        prof.append((r * (0.42 + 0.58 * math.sin(t * math.pi / 2) ** 0.8), 0.006 + (h - 0.006) * t ** 1.4))
    prof += [(r + wall * 0.4, h + wall * 0.3), (r - wall * 0.5, h + wall * 0.4), (r - wall, h - wall * 0.6)]
    # inner wall back down
    for i in range(8, -1, -1):
        t = i / 9
        prof.append(((r - wall) * (0.38 + 0.58 * math.sin(t * math.pi / 2) ** 0.8), wall + 0.006 + (h - wall - 0.008) * t ** 1.4))
    prof.append((0.0, wall + 0.006))
    ob = C.lathe(name, prof, 64, mat, True, jitter=jitter, salt=salt)
    C.subsurf(ob, 1)
    return ob


def jar(name="Jar", r=0.05, h=0.11, neck=0.022, mat="glazed", salt=2):
    prof = [(0.0, 0.0), (r * 0.6, 0.0), (r * 0.64, 0.003)]
    for i in range(1, 13):
        t = i / 12
        rr = r * (0.64 + 0.36 * math.sin(min(1, t * 1.6) * math.pi / 2)) if t < 0.62 else \
            r - (r - neck) * ((t - 0.62) / 0.3) ** 1.2 if t < 0.92 else neck
        prof.append((rr, h * t))
    prof += [(neck * 1.25, h + 0.004), (neck * 1.18, h + 0.008), (neck * 0.85, h + 0.006), (neck * 0.8, h - 0.01)]
    ob = C.lathe(name, prof, 64, mat, True, jitter=0.012, salt=salt)
    C.subsurf(ob, 1)
    return ob


def bottle(name="Bottle", r=0.038, h=0.17, mat="glass", salt=3):
    """Blown bottle: round body, long neck, lip; walls modelled thick."""
    out_p = [(0.0, 0.004), (r * 0.7, 0.0), (r * 0.95, 0.012)]
    for i in range(1, 9):
        t = i / 8
        out_p.append((r * (0.95 + 0.05 * math.sin(t * math.pi)) * (1 - 0.65 * max(0, t - 0.6) / 0.4), h * 0.45 * t + 0.012))
    nr = r * 0.30
    out_p += [(nr * 1.15, h * 0.62), (nr, h * 0.75), (nr * 0.95, h * 0.92), (nr * 1.35, h * 0.95), (nr * 1.3, h)]
    w = 0.0025
    in_p = [(max(0.0005, x - w), z - w * 0.6) for (x, z) in reversed(out_p[2:])]
    in_p[0] = (out_p[-1][0] - w, h - 0.001)
    prof = out_p + in_p + [(0.0, 0.009)]
    ob = C.lathe(name, prof, 64, mat, True, jitter=0.02, salt=salt)
    C.subsurf(ob, 1)
    return ob


def beaker(name="Beaker", r=0.03, h=0.09, mat="glass", salt=4):
    w = 0.0022
    prof = [(0.0, 0.003), (r * 0.8, 0.0), (r * 0.85, 0.004)]
    for i in range(1, 7):
        t = i / 6
        prof.append((r * (0.85 + 0.2 * t), h * t))
    prof += [(r * 1.05 - w, h - 0.001)]
    for i in range(5, 0, -1):
        t = i / 6
        prof.append((r * (0.85 + 0.2 * t) - w, h * t))
    prof += [(r * 0.8 - w, 0.006), (0.0, 0.006)]
    ob = C.lathe(name, prof, 64, mat, True, jitter=0.025, salt=salt)
    C.subsurf(ob, 1)
    return ob


def liquid_in(vessel_r, level, mat, name="Liquid", r_frac=0.92):
    """A disc of liquid filling a bowl up to `level`, cylinder below."""
    prof = [(0.0, 0.007), (vessel_r * r_frac * 0.5, 0.007), (vessel_r * r_frac, level), (0.0, level)]
    return C.lathe(name, prof, 48, mat, True)


# --------------------------------------------------------------------------
# cloth, paper, blocks
# --------------------------------------------------------------------------
def folded_cloth(name="Cloth", w=0.14, d=0.10, layers=3, thick=0.006, mat="linen", salt=5):
    """A folded length: stacked layers with rounded folds on alternate ends,
    a little slumped and uneven."""
    r = C.rng(salt)
    bm = bmesh.new()
    for i in range(layers):
        z = i * thick * 0.92
        sh = 1.0 - i * 0.015
        res = bmesh.ops.create_cube(bm, size=1.0)
        vs = res["verts"]
        bmesh.ops.scale(bm, vec=(w * sh, d * sh, thick), verts=vs)
        bmesh.ops.translate(bm, vec=(r.uniform(-0.003, 0.003), r.uniform(-0.002, 0.002), z + thick / 2), verts=vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    ob.data.materials.append(C.M(mat) if isinstance(mat, str) else mat)
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = thick * 0.49
    m.segments = 5
    C.subsurf(ob, 2)
    # soft slump: broad lumps plus fine creases, so it reads as cloth, not tile
    tex = bpy.data.textures.new(name + "_wr", "CLOUDS")
    tex.noise_scale = 0.045
    tex.noise_depth = 2
    d_ = ob.modifiers.new("Slump", "DISPLACE")
    d_.texture = tex
    d_.strength = thick * 0.9
    d_.mid_level = 0.5
    d_.texture_coords = "OBJECT"
    tex2 = bpy.data.textures.new(name + "_cr", "CLOUDS")
    tex2.noise_scale = 0.012
    d2 = ob.modifiers.new("Crease", "DISPLACE")
    d2.texture = tex2
    d2.strength = thick * 0.25
    d2.texture_coords = "OBJECT"
    me.shade_smooth()
    return ob


def bolt(name="Bolt", r=0.045, length=0.26, mat=None, unroll=0.22, unroll_w=None, salt=6, end_mat=None,
         wrinkle=0.0):
    """A bolt of cloth lying on its side along X: the cloth wound in layers
    (the ends show the wound edges as fine rings), its outer end unrolled
    toward -Y onto the table in soft, uneven folds."""
    r_ = C.rng(salt)
    parts = []
    # wound layers: concentric thin shells, slightly uneven, so the end faces
    # show the edge of every turn
    nl = 8
    prev = r * 0.35
    for k in range(nl):
        rr = r * (0.35 + 0.65 * (k + 1) / nl)
        ri = prev + 0.0005                       # a hair of gap: a dark line between turns
        prev = rr
        i0, i1 = 0.0035 * r_.random(), 0.0035 * r_.random()   # turns stagger at the ends
        prof = [(ri, -length / 2 + i0 + 0.0005), (ri + 0.0004, -length / 2 + i0),
                (rr - 0.0004, -length / 2 + i0), (rr, -length / 2 + i0 + 0.0006),
                (rr * (1 + 0.004 * k), 0.0), (rr, length / 2 - i1 - 0.0006),
                (rr - 0.0004, length / 2 - i1), (ri + 0.0004, length / 2 - i1), (ri, length / 2 - i1 - 0.0005)]
        sh = C.lathe("%s_turn%d" % (name, k), prof, 64, mat, True, jitter=0.012, salt=salt * 10 + k)
        sh.rotation_euler = (0, math.pi / 2, 0)
        sh.location = (0, 0, r)
        if wrinkle > 0 and k == nl - 1:
            # soft creases in the outer wrap, so it reads as cloth, not a tube
            C.subsurf(sh, 1)
            tx = bpy.data.textures.new(name + "_wr", "CLOUDS")
            tx.noise_scale = 0.018
            tx.noise_depth = 3
            dm = sh.modifiers.new("Wrinkle", "DISPLACE")
            dm.texture = tx
            dm.strength = wrinkle
            dm.texture_coords = "OBJECT"
        parts.append(sh)
    core = C.lathe(name + "_core", [(0, -length / 2 + 0.002), (r * 0.36, -length / 2 + 0.002),
                                    (r * 0.36, length / 2 - 0.002), (0, length / 2 - 0.002)], 32, mat)
    core.rotation_euler = (0, math.pi / 2, 0)
    core.location = (0, 0, r)
    parts.append(core)
    if unroll > 0:
        uw = unroll_w or length * 0.97
        nx, ny = 64, 48
        verts, faces = [], []
        ph = [r_.uniform(0, 6.28) for _ in range(4)]
        for j in range(ny + 1):
            t = j / ny
            y = -t * unroll
            for i in range(nx + 1):
                s = i / nx
                x = (s - 0.5) * uw
                # soft pleats running down the length, growing toward the free end
                pleat = (0.0026 * math.sin(s * math.pi * 3.2 + ph[0] + t * 2.1) +
                         0.0016 * math.sin(s * math.pi * 7.3 + ph[1] - t * 1.3) +
                         0.0012 * noise.noise(Vector((s * 6, t * 4, salt)))) * (0.2 + t)
                # a lazy wave across, and the free end lifting a little
                wave = 0.004 * math.sin(t * math.pi * 1.6 + ph[2]) ** 2 * t
                lift = 0.006 * max(0.0, t - 0.85) / 0.15
                # where it leaves the roll it rises up the roll's underside
                rise = r * (1 - math.cos(min(1.0, (0.06 - min(t * unroll, 0.06)) / 0.06) * 1.2)) if t * unroll < 0.06 else 0
                z = 0.0012 + max(0.0, pleat) + wave + lift + rise * 0.3
                verts.append((x + 0.002 * math.sin(t * 7 + ph[3]) * t, y, z))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                faces.append((a, a + 1, a + nx + 2, a + nx + 1))
        strip = C.mesh_object(name + "_end", verts, faces, end_mat or mat, True)
        sol = strip.modifiers.new("Solid", "SOLIDIFY")
        sol.thickness = 0.0008
        C.subsurf(strip, 1)
        parts.append(strip)
    return group(name, parts)


def sheet(name="Sheet", w=0.15, d=0.21, mat=None, curl=0.004, salt=7, folds=0):
    """A sheet of paper, slightly cockled, optional fold lines across Y."""
    r = C.rng(salt)
    nx, ny = 24, 32
    verts, faces = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = (i / nx - 0.5) * w
            y = (j / ny - 0.5) * d
            z = curl * (abs(i / nx - 0.5) * 2) ** 3 + 0.0006 * noise.noise(Vector((x * 30, y * 30, salt)))
            if folds:
                f = (j / ny) * (folds + 1)
                z += 0.0008 * abs(math.sin(f * math.pi))
            verts.append((x, y, z + 0.0004))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    ob = C.mesh_object(name, verts, faces, mat or C.M("paper"), True)
    sol = ob.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.0003
    return ob


def block(name="Block", size=(0.08, 0.06, 0.05), mat="limestone", chip=0.004, salt=8):
    ob = C.box_mesh(name, size, (0, 0, size[2] / 2), mat)
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = chip
    m.segments = 3
    tex = bpy.data.textures.new(name + "_chip", "VORONOI")
    tex.noise_scale = 0.02
    C.subsurf(ob, 2)
    d = ob.modifiers.new("Chip", "DISPLACE")
    d.texture = tex
    d.strength = chip * 0.35
    d.texture_coords = "OBJECT"
    return ob


def heap(name="Heap", r=0.05, h=0.03, mat="sand", salt=9, lumps=0.25):
    prof = [(0.0, 0.0)]
    for i in range(1, 13):
        t = i / 12
        prof.append((r * (1 - t), h * (1 - (1 - t) ** 1.8)))
    prof.append((0.0, h))
    ob = C.lathe(name, prof, 48, mat, True, jitter=0.12, salt=salt)
    C.subsurf(ob, 1)
    tex = bpy.data.textures.new(name + "_n", "CLOUDS")
    tex.noise_scale = 0.012
    tex.noise_depth = 3
    d = ob.modifiers.new("Lumps", "DISPLACE")
    d.texture = tex
    d.strength = h * lumps
    d.texture_coords = "OBJECT"
    return ob


def rope_coil(name="Rope", r_out=0.07, turns=4.5, thick=0.007, mat="rope", salt=10):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    n = int(turns * 48)
    sp.points.add(n - 1)
    for i in range(n):
        t = i / (n - 1)
        a = t * turns * 2 * math.pi
        rr = r_out - t * (r_out - r_out * 0.45)
        z = thick * 0.5 + (0.3 * thick if i % 97 < 40 and t > 0.6 else 0)
        sp.points[i].co = (rr * math.cos(a), rr * math.sin(a), z, 1)
    cu.bevel_depth = thick / 2
    cu.bevel_resolution = 4
    ob = bpy.data.objects.new(name, cu)
    C.link(ob)
    ob.data.materials.append(C.M(mat) if isinstance(mat, str) else mat)
    return ob


# --------------------------------------------------------------------------
# coins
# --------------------------------------------------------------------------
def _coin_mesh(name, r, t, salt):
    """Hand-struck coin: slightly irregular outline, thicker in the middle,
    a raised rim ring and a field of dots and rings (no letters, no faces)."""
    rr = C.rng(salt)
    seg = 40
    ph = [rr.uniform(0, 6.28) for _ in range(4)]
    amp = [rr.uniform(0.02, 0.05), rr.uniform(0.01, 0.03), rr.uniform(0.005, 0.015)]
    bm = bmesh.new()
    rings = [0.0, 0.25, 0.5, 0.72, 0.84, 0.9, 0.96, 1.0]
    zs = [0.62, 0.6, 0.55, 0.56, 0.62, 0.58, 0.52, 0.4]   # relief profile (fraction of t/2)
    top, bot = [], []
    for k, (f, zf) in enumerate(zip(rings, zs)):
        rt, rb = [], []
        for i in range(seg if f > 0 else 1):
            a = 2 * math.pi * i / seg
            wob = 1 + amp[0] * math.sin(2 * a + ph[0]) + amp[1] * math.sin(3 * a + ph[1]) + amp[2] * math.sin(7 * a + ph[2])
            x, y = r * f * wob * math.cos(a), r * f * wob * math.sin(a)
            dz = 0.04 * t * math.sin(9 * a + ph[3]) * (f > 0.3) * (f < 0.8)
            rt.append(bm.verts.new((x, y, t / 2 + t / 2 * zf + dz)))
            rb.append(bm.verts.new((x, y, t / 2 - t / 2 * zf * 0.95 - dz)))
        top.append(rt)
        bot.append(rb)
    for ringset, flip in ((top, False), (bot, True)):
        c = ringset[0][0]
        for i in range(seg):
            j = (i + 1) % seg
            f = (c, ringset[1][i], ringset[1][j])
            bm.faces.new(f[::-1] if flip else f)
        for k in range(1, len(rings) - 1):
            for i in range(seg):
                j = (i + 1) % seg
                f = (ringset[k][i], ringset[k + 1][i], ringset[k + 1][j], ringset[k][j])
                bm.faces.new(f[::-1] if flip else f)
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((top[-1][i], bot[-1][i], bot[-1][j], top[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


_COIN_MESHES = {}
C.RESET_HOOKS.append(_COIN_MESHES.clear)


def coin(name, metal="gold", salt=0, r=None):
    r = r or (0.0105 if metal == "gold" else 0.0125)
    t = 0.0012 if metal == "gold" else 0.0011
    key = (metal, salt % 6)
    if key not in _COIN_MESHES:
        _COIN_MESHES[key] = _coin_mesh("coin_%s_%d" % key, r, t, 500 + salt % 6 + (0 if metal == "gold" else 50))
    ob = bpy.data.objects.new(name, _COIN_MESHES[key])
    C.link(ob)
    ob.data.materials.append(C.M(metal))
    return ob


def coin_stack(name, metal, n, salt=0, lean=0.0):
    """A hand-stacked pile: each coin a little off-centre and tilted."""
    r = C.rng(700 + salt)
    obs = []
    z = 0.0
    t = 0.0012 if metal == "gold" else 0.0011
    for i in range(n):
        c = coin("%s_%d" % (name, i), metal, salt + i)
        c.location = (r.uniform(-0.0012, 0.0012) + lean * i * 0.0004, r.uniform(-0.0012, 0.0012), z)
        c.rotation_euler = (r.uniform(-0.04, 0.04), r.uniform(-0.04, 0.04), r.uniform(0, 6.28))
        z += t * 0.98
        obs.append(c)
    return group(name, obs)


def coin_scatter(name, items, area=(0.06, 0.04), salt=0):
    """items: list of (metal, count). Coins lying flat, some overlapping."""
    r = C.rng(800 + salt)
    obs = []
    k = 0
    for metal, n in items:
        for i in range(n):
            c = coin("%s_%d" % (name, k), metal, salt + k)
            x, y = r.uniform(-area[0] / 2, area[0] / 2), r.uniform(-area[1] / 2, area[1] / 2)
            c.location = (x, y, 0.0004 * (k % 3))
            c.rotation_euler = (r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), r.uniform(0, 6.28))
            obs.append(c)
            k += 1
    return group(name, obs)


# --------------------------------------------------------------------------
# desk things
# --------------------------------------------------------------------------
def balance_scale(name="Scale", span=0.24, mat="brass"):
    """Hand balance at rest on the table: beam laid across its two pans,
    cords coiled. Seen from above it reads as beam + two pans."""
    parts = []
    pr = 0.045
    for sx in (-1, 1):
        p = bowl(name + "_pan%d" % sx, r=pr, h=0.012, wall=0.0015, mat=mat, foot=False, salt=20 + sx, jitter=0.004)
        p.location = (sx * span / 2, 0, 0)
        parts.append(p)
    # beam resting across the two pan rims
    beam = C.box_mesh(name + "_beam", (span + 0.04, 0.005, 0.005), (0, 0, 0.016), mat)
    C.bevel(beam, 0.0012, 2)
    parts.append(beam)
    for sx in (-1, 1):
        k = C.lathe(name + "_knob%d" % sx, [(0, -0.004), (0.0045, -0.003), (0.005, 0.0), (0.0045, 0.003), (0, 0.004)], 16, mat)
        k.rotation_euler = (0, math.pi / 2, 0)
        k.location = (sx * (span / 2 + 0.022), 0, 0.016)
        parts.append(k)
    # central pointer and pivot
    piv = C.box_mesh(name + "_tongue", (0.004, 0.003, 0.04), (0, 0.012, 0.02), mat)
    piv.rotation_euler = (math.radians(80), 0, 0)
    parts.append(piv)
    ring = C.lathe(name + "_ring", [(0.010, -0.0015), (0.012, 0), (0.010, 0.0015), (0.008, 0), (0.010, -0.0015)], 24, mat)
    ring.location = (0, 0, 0.0186)
    parts.append(ring)
    # cords: thin loops lying in the pans
    for sx in (-1, 1):
        c = rope_coil(name + "_cord%d" % sx, pr * 0.6, 2.0, 0.0012, C.M("rope", colour=(0.35, 0.25, 0.16)), salt=30 + sx)
        c.location = (sx * span / 2, 0, 0.003)
        parts.append(c)
    return group(name, parts)


def weights_row(name="Weights", n=6, mat="brass"):
    """Nested-style cylinder weights, largest to smallest, in a row."""
    parts = []
    x = 0.0
    for i in range(n):
        s = 0.85 ** i
        r, h = 0.011 * s, 0.014 * s
        w = C.lathe("%s_%d" % (name, i), [(0, 0), (r * 0.95, 0), (r, h * 0.12), (r, h * 0.8), (r * 0.7, h),
                                          (r * 0.3, h * 1.05), (r * 0.35, h * 1.25), (0, h * 1.3)], 32, mat,
                    jitter=0.01, salt=40 + i)
        C.bevel(w, 0.0006)
        w.location = (x + r, 0, 0)
        x += 2 * r + 0.006
        parts.append(w)
    return group(name, parts)


def inkwell(name="Inkwell", mat="brass"):
    prof = [(0, 0), (0.024, 0), (0.026, 0.004), (0.027, 0.02), (0.022, 0.032), (0.011, 0.036),
            (0.010, 0.040), (0.0125, 0.042), (0.0115, 0.044), (0.008, 0.043), (0.008, 0.02), (0, 0.02)]
    ob = C.lathe(name, prof, 48, mat, jitter=0.006, salt=50)
    ink = C.lathe(name + "_ink", [(0, 0.0395), (0.0082, 0.0395), (0, 0.0396)], 24, "ink")
    C.subsurf(ob, 1)
    return group(name, [ob, ink])


def reed_pen(name="Reed", length=0.20, salt=60):
    """A cut reed pen: a hollow-ish cane tube with nodes and a slanted cut nib."""
    r = 0.0045
    prof = [(0.0, 0.0), (r * 0.25, 0.003), (r * 0.7, 0.018), (r, 0.03)]
    nodes = [0.08, 0.15]
    z = 0.03
    while z < length:
        z += 0.01
        rr = r * (1.08 if any(abs(z - n) < 0.004 for n in nodes) else 1.0)
        prof.append((rr, min(z, length)))
    prof += [(r * 0.95, length + 0.001), (0.0, length + 0.001)]
    ob = C.lathe(name, prof, 16, C.M("plain_wood", tint=(1.0, 0.86, 0.52), scale=6.0, val=2.2), jitter=0.03, salt=salt)
    ob.rotation_euler = (0, math.pi / 2, 0)
    ob.location = (-length / 2, 0, r)
    return group(name, [ob])


def oil_lamp(name="Lamp", mat=None, lit=False, glow=6.0):
    """Glazed ceramic oil lamp of the medieval Egyptian kind: a low round
    reservoir with an open filling hole, a long tapering nozzle, and a loop
    handle at the back. Wick at the nozzle tip."""
    mat = mat or C.M("glazed", colour=(0.10, 0.28, 0.30))
    # slipper lamp: a low dome pulled out into a teardrop toward +X
    body = C.lathe(name + "_body", [(0, 0), (0.024, 0), (0.030, 0.004), (0.038, 0.011), (0.037, 0.017),
                                    (0.028, 0.023), (0.015, 0.0265), (0.0125, 0.0255), (0.011, 0.020),
                                    (0, 0.019)], 64, mat, jitter=0.01, salt=70)
    L = 0.085
    for v in body.data.vertices:
        x, y, z = v.co
        if x > 0:
            t = x / 0.038
            v.co.x = x * (1.0 + 1.25 * t)
            v.co.y = y * (1.0 - 0.62 * t ** 1.5)
    C.subsurf(body, 1)
    # wick hole rim at the tip
    noz = C.lathe(name + "_noz", [(0.0, 0.0), (0.0075, 0.0), (0.0085, 0.004), (0.0065, 0.006), (0.004, 0.0055),
                                  (0.0035, 0.002), (0.0, 0.002)], 20, mat)
    noz.location = (0.074, 0, 0.012)
    handle = C.lathe(name + "_hd", [(0.008, -0.0025), (0.011, 0), (0.008, 0.0025), (0.0055, 0), (0.008, -0.0025)], 20, mat)
    handle.rotation_euler = (math.pi / 2, 0, 0)
    handle.location = (-0.036, 0, 0.022)
    parts = [body, noz, handle]
    wick = C.lathe(name + "_wick", [(0, 0), (0.0022, 0), (0.0016, 0.007), (0, 0.008)], 8,
                   C.M("dark", colour=(0.05, 0.04, 0.03)))
    wick.location = (0.074, 0, 0.016)
    wick.rotation_euler = (0, math.radians(35), 0)
    parts.append(wick)
    if lit:
        fl = C.lathe(name + "_flame", [(0, 0), (0.0035, 0.004), (0.003, 0.011), (0, 0.022)], 12, None)
        fm = bpy.data.materials.new("flame")
        nt = fm.node_tree
        nt.nodes.clear()
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (1.0, 0.55, 0.18, 1)
        em.inputs["Strength"].default_value = 40.0
        nt.links.new(em.outputs[0], o.inputs["Surface"])
        fl.data.materials.append(fm)
        fl.location = (0.076, 0, 0.022)
        ld = bpy.data.lights.new(name + "_light", "POINT")
        ld.energy = glow
        ld.color = (1.0, 0.58, 0.25)
        ld.shadow_soft_size = 0.012
        lo = bpy.data.objects.new(name + "_light", ld)
        C.link(lo)
        lo.location = (0.076, 0, 0.036)
        parts += [fl, lo]
    return group(name, parts)


def ledger(name="Ledger", w=0.30, d=0.21, salt=80, rows=((0.08, 0.92), (0.55, 0.92)), rule=0.0,
           tone=(0.70, 0.63, 0.50), ink_amt=(0.42, 0.30)):
    """A bound paper book lying open flat: limp leather cover, two page
    blocks curving up to the gutter, faint illegible lines."""
    parts = []
    cover = C.box_mesh(name + "_cover", (w + 0.012, d + 0.01, 0.003), (0, 0, 0.0015), C.M("leather"))
    C.bevel(cover, 0.0012)
    parts.append(cover)
    for side in (-1, 1):
        nx, ny = 20, 16
        verts, faces = [], []
        for j in range(ny + 1):
            for i in range(nx + 1):
                s = i / nx                      # 0 = gutter, 1 = fore-edge
                x = side * (0.004 + s * (w / 2 - 0.006))
                y = (j / ny - 0.5) * d
                z = 0.003 + 0.006 + 0.012 * (1 - s) ** 0.3 * (1 - s * 0.5) - 0.004 * s ** 3
                verts.append((x, y, z))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                f = (a, a + 1, a + nx + 2, a + nx + 1)
                faces.append(f if side > 0 else f[::-1])
        pg = C.mesh_object(name + "_page%d" % side, verts, faces,
                           C.M("paper", ink=True, lines=36.0, ink_amt=ink_amt[0] if side < 0 else ink_amt[1],
                               line_rows=rows[0] if side < 0 else rows[1], tone=tone, rule=rule), True)
        # page block thickness
        sol = pg.modifiers.new("Solid", "SOLIDIFY")
        sol.thickness = 0.006
        sol.offset = -1
        parts.append(pg)
    return group(name, parts)


def letter_packet(name="Letter", w=0.11, d=0.045, salt=90, thread=(0.30, 0.20, 0.12)):
    """A sheet folded into a narrow packet, tied round with thread."""
    r = C.rng(salt)
    body = C.box_mesh(name + "_body", (w, d, 0.004), (0, 0, 0.002), C.M("paper", tone=(0.72, 0.64, 0.50)))
    C.bevel(body, 0.0016, 3)
    tex = bpy.data.textures.new(name + "_ck", "CLOUDS")
    tex.noise_scale = 0.02
    C.subsurf(body, 2)
    d_ = body.modifiers.new("Cockle", "DISPLACE")
    d_.texture = tex
    d_.strength = 0.0006
    body.data.shade_smooth()
    parts = [body]
    tm = C.M("rope", colour=thread)
    for k, x in enumerate((-w * 0.18 + r.uniform(-0.004, 0.004), w * 0.2 + r.uniform(-0.004, 0.004))):
        cu = bpy.data.curves.new(name + "_thr%d" % k, "CURVE")
        cu.dimensions = "3D"
        sp = cu.splines.new("POLY")
        hy, hz = d / 2 + 0.0004, 0.0044
        pts = [(0, -hy, -0.0002), (0, hy, -0.0002), (0, hy, hz), (0, -hy, hz)]
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            sp.points[i].co = (*p, 1)
        sp.use_cyclic_u = True
        cu.bevel_depth = 0.0008
        cu.bevel_resolution = 2
        ob = bpy.data.objects.new(name + "_thr%d" % k, cu)
        C.link(ob)
        ob.data.materials.append(tm)
        ob.location = (x, 0, 0)
        ob.rotation_euler = (0, 0, r.uniform(-0.12, 0.12))
        parts.append(ob)
    return group(name, parts)


# --------------------------------------------------------------------------
# seal devices: eight simple marks of geometry and plants (no letters, no
# animals, no faces), for the agents' seals and the stamps on paper
# --------------------------------------------------------------------------
DEVICES = ("star", "knot", "palm", "dots", "crescent", "lozenge", "wheel", "rosette")


def device(name, kind, size, relief, mat, z0=0.0):
    """Build one device lying flat at the origin, `size` = radius of the
    seal face, `relief` = height of the raised mark. Returns a group.
    Used raised on a clay seal and almost flat as stamp ink on paper."""
    mat = C.M(mat) if isinstance(mat, str) else mat
    parts = []
    lw = 0.075                       # stroke radius, in face radii

    def tube(pts, rad=lw, closed=False, zs=None):
        cu = bpy.data.curves.new(name + "_t", "CURVE")
        cu.dimensions = "3D"
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, (x, y) in enumerate(pts):
            z = zs[i] if zs else 0.0
            sp.points[i].co = (x * size, y * size, z * size, 1)
        sp.use_cyclic_u = closed
        cu.bevel_depth = rad * size
        cu.bevel_resolution = 3
        cu.use_fill_caps = True
        ob = bpy.data.objects.new(name + "_t", cu)
        C.link(ob)
        ob.data.materials.append(mat)
        parts.append(ob)
        return ob

    def blob(x, y, rx, ry, ang=0.0):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=1.0)
        ob = C.from_bmesh(name + "_b", bm, mat, True)
        ob.scale = (rx * size, ry * size, 1.0)
        ob.rotation_euler = (0, 0, ang)
        ob.location = (x * size, y * size, 0)
        ob["blob"] = True
        parts.append(ob)
        return ob

    def poly(pts):
        """A raised flat shape: a prism built as a fan from the centroid
        (every device outline is star-shaped about it), height 1, scaled
        to the relief afterwards."""
        n = len(pts)
        cx = sum(p[0] for p in pts) / n
        cy = sum(p[1] for p in pts) / n
        # make the outline counter-clockwise
        area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
        if area < 0:
            pts = pts[::-1]
        verts = [(x * size, y * size, 0.0) for x, y in pts] + [(x * size, y * size, 1.0) for x, y in pts]
        # the centre stands higher: a low faceted peak, as a chip-carved stamp
        # cuts it, so each facet catches the light differently
        verts += [(cx * size, cy * size, 0.0), (cx * size, cy * size, 2.2)]
        cb, ct = 2 * n, 2 * n + 1
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append((n + i, n + j, ct))          # top
            faces.append((j, i, cb))                  # bottom
            faces.append((i, j, n + j, n + i))        # side
        ob = C.mesh_object(name + "_p", verts, faces, mat)
        ob["poly"] = True
        parts.append(ob)
        return ob

    circ = lambda r, n, a0=0.0: [(r * math.cos(a0 + 2 * math.pi * i / n), r * math.sin(a0 + 2 * math.pi * i / n))
                                 for i in range(n)]
    if kind == "star":
        pts = []
        for i in range(16):
            r = 0.84 if i % 2 == 0 else 0.45
            a = math.pi / 2 + i * math.pi / 8
            pts.append((r * math.cos(a), r * math.sin(a)))
        poly(pts)
    elif kind == "knot":
        # a trefoil knot drawn as one cord, rising and dipping at the crossings
        n = 120
        pts, zs = [], []
        for i in range(n):
            t = 2 * math.pi * i / n
            x = (math.sin(t) + 2 * math.sin(2 * t)) / 3.0 * 0.78
            y = (math.cos(t) - 2 * math.cos(2 * t)) / 3.0 * 0.78
            pts.append((x, y))
            zs.append(0.06 * math.sin(3 * t))
        tube(pts, lw * 1.05, True, zs)
    elif kind == "palm":
        rib = [(0.08 * math.sin(t * 2.2), -0.82 + 1.6 * t) for t in [i / 20 for i in range(21)]]
        tube(rib, lw * 0.9)
        for k in range(7):
            t = 0.18 + 0.11 * k
            bx, by = rib[int(t * 20)]
            L = 0.62 * (1 - 0.55 * (k / 6))
            for side in (-1, 1):
                a = math.radians(90 + side * 52)
                tip = (bx + side * L * math.sin(math.radians(52)), by + L * math.cos(math.radians(52)) * 0.75)
                mid = ((bx + tip[0]) / 2, (by + tip[1]) / 2 + 0.05)
                tube([(bx, by), mid, tip], lw * 0.7)
    elif kind == "dots":
        for x, y in circ(0.62, 12, math.pi / 2):
            blob(x, y, 0.105, 0.105)
        blob(0, 0, 0.17, 0.17)
    elif kind == "crescent":
        for i in range(9):
            a = math.radians(55 + 250 * i / 8)
            x, y = 0.56 * math.cos(a), 0.56 * math.sin(a)
            blob(x, y, 0.25, 0.11, a + math.pi / 2)
        blob(0.18, 0.0, 0.10, 0.10)
    elif kind == "lozenge":
        tube([(0, 0.84), (0.58, 0), (0, -0.84), (-0.58, 0)], lw, True)
        poly([(0, 0.40), (0.28, 0), (0, -0.40), (-0.28, 0)])
    elif kind == "wheel":
        tube(circ(0.68, 48), lw, True)
        blob(0, 0, 0.17, 0.17)
        for x, y in circ(1.0, 6, math.pi / 2):
            tube([(x * 0.16, y * 0.16), (x * 0.66, y * 0.66)], lw * 0.85)
    elif kind == "rosette":
        for i in range(8):
            a = math.pi / 2 + i * math.pi / 4
            blob(0.40 * math.cos(a), 0.40 * math.sin(a), 0.28, 0.12, a)
        blob(0, 0, 0.14, 0.14)
    else:
        raise ValueError(kind)
    # relief: tubes and blobs flattened to the relief height, prisms set to it
    for ob in parts:
        if ob.type == "CURVE":
            ob.scale = (1, 1, relief / (2 * lw * size))
            ob.location.z = relief * 0.5
        elif ob.get("blob"):
            ob.scale.z = relief
        else:
            ob.scale.z = relief
        if relief > 0.0004:
            pass
    g = group(name, parts)
    g.location.z = z0
    return g


def clay_seal(name, kind, r=0.017, salt=0):
    """A pressed clay seal: a small domed lump squashed flat, its rim
    pushed out unevenly by the stamp, with the device raised on its face."""
    mat = C.M("clay", colour=(0.30, 0.19, 0.13))
    h = 0.0042
    prof = [(0.0, 0.0), (r * 0.92, 0.0), (r * 1.02, h * 0.35), (r * 1.0, h * 0.72), (r * 0.9, h * 0.95),
            (r * 0.84, h), (0.0, h * 0.98)]
    body = C.lathe(name + "_lump", prof, 64, mat, True, jitter=0.06, salt=salt)
    C.subsurf(body, 2)
    rim = C.lathe(name + "_rim", [(r * 0.80, h - 0.0002), (r * 0.82, h + 0.0004), (r * 0.86, h + 0.0004),
                                  (r * 0.88, h - 0.0003)], 64, mat, True, jitter=0.01, salt=salt + 1)
    dv = device(name + "_dev", kind, r * 0.74, 0.0010, mat, z0=h + 0.00025)
    return group(name, [body, rim, dv])


def prayer_beads(name="Beads", n=33, r_loop=0.035, salt=95):
    r = C.rng(salt)
    parts = []
    me = None
    mat = C.M("plain_wood", tint=(0.55, 0.30, 0.16), scale=20.0)
    for i in range(n):
        t = i / n
        a = 2 * math.pi * t
        # a slack loop: ellipse with a sag
        x = r_loop * 1.25 * math.cos(a) + 0.004 * math.sin(3 * a)
        y = r_loop * 0.8 * math.sin(a) + 0.006 * math.cos(2 * a)
        if me is None:
            b = bmesh.new()
            bmesh.ops.create_uvsphere(b, u_segments=12, v_segments=8, radius=0.0042)
            me = bpy.data.meshes.new(name + "_bead")
            b.to_mesh(me)
            b.free()
            me.shade_smooth()
            me.materials.append(mat)
        ob = bpy.data.objects.new("%s_%d" % (name, i), me)
        C.link(ob)
        ob.location = (x, y, 0.0042)
        parts.append(ob)
    tas = C.lathe(name + "_tassel", [(0, 0), (0.004, 0.002), (0.003, 0.02), (0, 0.022)], 12,
                  C.M("wool", colour=(0.35, 0.10, 0.06)))
    tas.rotation_euler = (math.pi / 2, 0, 0.4)
    tas.location = (r_loop * 1.25, -0.002, 0.003)
    parts.append(tas)
    return group(name, parts)


# --------------------------------------------------------------------------
# sacks and grains
# --------------------------------------------------------------------------
def sack(name="Sack", r=0.075, h=0.13, roll=0.022, mat=None, salt=100):
    """A small cloth sack standing open, its top rolled down into a thick
    cuff. Walls bulge and slump."""
    mat = mat or C.M("hessian")
    prof = [(0.0, 0.0), (r * 0.85, 0.0), (r * 0.98, 0.012)]
    for i in range(1, 9):
        t = i / 8
        prof.append((r * (1.0 + 0.06 * math.sin(t * math.pi)), 0.012 + (h - roll - 0.012) * t))
    # the roll: outward and back down
    cz = h - roll * 0.5
    for i in range(0, 13):
        a = -math.pi / 2 + i / 12 * 2 * math.pi * 0.92
        prof.append((r * 1.04 + roll * 0.5 + roll * 0.5 * math.cos(a + math.pi), cz + roll * 0.5 * math.sin(a + math.pi)))
    # inner wall dropping in
    prof += [(r * 0.98, h - roll * 1.1), (r * 0.92, h - roll * 2.2)]
    ob = C.lathe(name, prof, 64, mat, True, jitter=0.05, salt=salt)
    tex = bpy.data.textures.new(name + "_wr", "CLOUDS")
    tex.noise_scale = 0.025
    tex.noise_depth = 3
    C.subsurf(ob, 1)
    d = ob.modifiers.new("Slump", "DISPLACE")
    d.texture = tex
    d.strength = 0.011
    d.texture_coords = "OBJECT"
    tex2 = bpy.data.textures.new(name + "_cr", "CLOUDS")
    tex2.noise_scale = 0.008
    d2 = ob.modifiers.new("Creases", "DISPLACE")
    d2.texture = tex2
    d2.strength = 0.003
    d2.texture_coords = "OBJECT"
    return ob


def grain_mesh(name, centers, radius, salt=0, squash=0.85, mat="peppercorn", detail=1, lumpy=0.10):
    """One mesh of many small wrinkled spheres (peppercorns, beads of resin)
    at the given centres, each randomly turned and sized."""
    r = C.rng(900 + salt)
    base = bmesh.new()
    bmesh.ops.create_icosphere(base, subdivisions=detail + 1, radius=1.0)
    bv = [v.co.copy() for v in base.verts]
    bf = [[v.index for v in f.verts] for f in base.faces]
    base.free()
    verts, faces = [], []
    for (cx, cy, cz) in centers:
        s = radius * r.uniform(0.82, 1.15)
        rot = Euler((r.uniform(0, 6.28), r.uniform(0, 6.28), r.uniform(0, 6.28))).to_matrix()
        sd = r.uniform(0, 100)
        o = len(verts)
        for v in bv:
            wr = 1.0 + lumpy * noise.noise(v * (3.0 if lumpy <= 0.1 else 1.6) + Vector((sd, 0, 0)))
            p = rot @ Vector((v.x * wr, v.y * wr, v.z * wr * squash))
            verts.append((cx + p.x * s, cy + p.y * s, cz + p.z * s))
        faces += [[i + o for i in f] for f in bf]
    return C.mesh_object(name, verts, faces, mat, True)


def mound_points(r, h, spacing, center=(0, 0, 0), salt=0, base_z=0.0):
    """Points packed over a low dome (only the visible surface layers)."""
    rr = C.rng(950 + salt)
    pts = []
    for layer in range(2):
        n = int(math.pi * r * r / (spacing * spacing))
        for i in range(n):
            a = rr.uniform(0, 6.283)
            d = r * math.sqrt(rr.uniform(0, 1))
            z = base_z + h * (1 - (d / r) ** 2) - layer * spacing * 0.8
            pts.append((center[0] + d * math.cos(a), center[1] + d * math.sin(a), center[2] + z))
    return pts
