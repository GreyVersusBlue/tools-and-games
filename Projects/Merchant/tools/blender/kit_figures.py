"""Figures kit: low-detail shapes to be seen only far off.

One cloaked human figure, a one-humped camel, a two-humped camel, a mule.
No face geometry is modelled on anything, ever: heads are plain rounded
masses (the human figure's head is a hood).

`guard(ob, cam)` refuses (raises) if a figure would stand taller than 5% of
the frame height. Every scene that places a figure must call it; place()
does so automatically. The only exception is carved=True, for the carved
wooden playing pieces of A04, which are objects, not animals.

Batch 1 uses the one-humped camel for the caravan token. The others are
built here so batch 3 can use them; they are blocked in, not yet refined.
"""
import math

import bpy
import bmesh
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

import common as C

MAX_FRAC = 0.05


def _skin(name, nodes, edges, mat=None, levels=2):
    """nodes: list of ((x, y, z), radius). edges: list of (i, j).
    Builds a skin-modifier body, subdivides, applies, returns the object.
    Units: shoulder height = 1.0; scale afterwards."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([n[0] for n in nodes], edges, [])
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    sk = ob.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, (co, r) in enumerate(nodes):
        sv = me.skin_vertices[0].data[i]
        sv.radius = (r, r) if isinstance(r, (int, float)) else r
    me.skin_vertices[0].data[0].use_root = True
    C.subsurf(ob, levels)
    C.apply_all(ob)
    ob.data.shade_smooth()
    if mat:
        ob.data.materials.append(mat if isinstance(mat, bpy.types.Material) else C.M(mat))
    return ob


def camel(name="Camel", humps=1, mat=None, carved=False, height=1.9, load=False, kneel=False):
    """A camel standing, facing +X. height = real shoulder height (metres)
    unless carved, when it is the piece's height in metres.
    Carved pieces get stouter legs (as a carver would leave them)."""
    leg = 0.085 if carved else 0.05
    bulk = 1.3 if carved else 1.0            # carved pieces are stouter
    N = []
    E = []

    def n(co, r):
        if isinstance(r, tuple):
            r = (r[0] * bulk, r[1] * bulk)
        elif r > 0.06:
            r = r * bulk
        N.append((co, r))
        return len(N) - 1

    hip = n((-0.36, 0, 0.92), (0.17, 0.2))
    mid = n((0.0, 0, 0.98), (0.22, 0.24))
    sh = n((0.36, 0, 0.95), (0.19, 0.21))
    E += [(hip, mid), (mid, sh)]
    if humps == 1:
        if carved:
            # a carver exaggerates what reads from above: a tall peaked hump
            h0 = n((-0.02, 0, 1.18), (0.17, 0.17))
            h = n((-0.04, 0, 1.46), (0.085, 0.09))
            E += [(mid, h0), (h0, h)]
        else:
            h = n((0.0, 0, 1.24), (0.14, 0.15))
            E.append((mid, h))
    else:
        for x in (-0.17, 0.2):
            h = n((x, 0, 1.18), (0.1, 0.11))
            m2 = n((x, 0, 1.0), (0.18, 0.2))
            E += [(m2, h)]
            E.append((mid, m2))
    # legs
    for side in (-1, 1):
        if kneel:
            # folded under the body: knee forward on the ground, foot tucked back
            k = n((0.42, 0.13 * side, 0.06), leg * 1.2)
            f = n((0.12, 0.15 * side, 0.05), leg * 1.1)
            E += [(sh, k), (k, f)]
            k = n((-0.30, 0.15 * side, 0.07), leg * 1.3)
            f = n((-0.52, 0.14 * side, 0.05), leg * 1.1)
            E += [(hip, k), (k, f)]
            continue
        k = n((0.40, 0.11 * side, 0.50), leg)
        f = n((0.41, 0.11 * side, 0.03), leg * 1.25)
        E += [(sh, k), (k, f)]
        k = n((-0.42, 0.11 * side, 0.50), leg)
        f = n((-0.38, 0.11 * side, 0.03), leg * 1.25)
        E += [(hip, k), (k, f)]
    # neck: dips forward then rises, a small plain head (no face)
    if carved:
        # neck dips forward, then rises high; head held well above the hump line
        n1 = n((0.62, 0, 0.88), (0.085, 0.075))
        n2 = n((0.80, 0, 1.20), (0.07, 0.065))
        hd = n((0.86, 0, 1.52), (0.075, 0.065))
        mz = n((1.02, 0, 1.52), (0.05, 0.045))
    else:
        n1 = n((0.60, 0, 0.86), (0.09, 0.08))
        n2 = n((0.80, 0, 1.12), (0.075, 0.07))
        hd = n((0.90, 0, 1.33), (0.08, 0.07))
        mz = n((1.04, 0, 1.30), (0.05, 0.045))
    E += [(sh, n1), (n1, n2), (n2, hd), (hd, mz)]
    tl = n((-0.52, 0, 0.84), 0.025)
    t2 = n((-0.55, 0, 0.62), 0.02)
    E += [(hip, tl), (tl, t2)]
    if kneel:
        drop = 0.55
        N[:] = [((co[0], co[1], co[2] - drop if co[2] > 0.2 else co[2]), r) for co, r in N]
    ob = _skin(name, N, E, mat, levels=2)
    s = height / 1.33
    ob.scale = (s, s, s)
    ob["figure"] = True
    ob["carved"] = carved
    if load:
        _load(ob, load, humps, kneel, mat)
    return ob


def _load(animal, kind, humps, kneel, mat):
    """Pack load on a camel, parented to it, in its own units (shoulder
    height ~1.0): 'bales' (two cloth bales and a top bundle) or 'salt'
    (a grey-white slab roped flat on each side)."""
    z = 1.05 - (0.55 if kneel else 0.0)
    pieces = []
    if kind == "salt":
        sm = C.M("salt")
        for side in (-1, 1):
            b = C.box_mesh(animal.name + "_salt%d" % side, (0.62, 0.07, 0.36), (0, 0, 0), sm)
            b.location = (0.0, side * 0.30, z - 0.05)
            b.rotation_euler = (side * 0.12, 0, 0)
            pieces.append(b)
    else:
        cl = C.M("hessian", colour=(0.62, 0.52, 0.40))
        for side in (-1, 1):
            b = C.box_mesh(animal.name + "_bale%d" % side, (0.50, 0.24, 0.40), (0, 0, 0), cl)
            C.bevel(b, 0.06, 2)
            b.location = (0.0, side * 0.32, z - 0.05)
            pieces.append(b)
        t = C.box_mesh(animal.name + "_top", (0.46, 0.50, 0.20), (0, 0, 0), cl)
        C.bevel(t, 0.06, 2)
        t.location = (0.0, 0, z + 0.28)
        pieces.append(t)
    for p in pieces:
        p.parent = animal
        p["figure"] = True
    return pieces


def mule(name="Mule", mat=None, height=1.4, carved=False):
    """A mule, facing +X. carved=True makes the stout playing-piece version
    for A04 (thicker legs, bigger ears, head held up) and height is then the
    piece's height in metres."""
    N, E = [], []
    bulk = 1.35 if carved else 1.0

    def n(co, r):
        if isinstance(r, tuple):
            r = (r[0] * bulk, r[1] * bulk)
        else:
            r = r * bulk
        N.append((co, r))
        return len(N) - 1

    hip = n((-0.4, 0, 0.82), (0.18, 0.2))
    sh = n((0.35, 0, 0.84), (0.19, 0.2))
    E.append((hip, sh))
    for side in (-1, 1):
        for x0, x1 in ((0.36, 0.38), (-0.4, -0.38)):
            k = n((x0, 0.11 * side, 0.42), 0.05)
            f = n((x1, 0.11 * side, 0.03), 0.055)
            E += [(sh if x0 > 0 else hip, k), (k, f)]
    if carved:
        nk = n((0.58, 0, 1.12), (0.085, 0.075))
        hd = n((0.74, 0, 1.30), (0.075, 0.065))
        mz = n((0.88, 0, 1.18), (0.05, 0.05))
        ears = [((0.68, 0.06, 1.54), 0.022), ((0.66, -0.06, 1.54), 0.022)]
    else:
        nk = n((0.55, 0, 1.08), (0.09, 0.08))
        hd = n((0.72, 0, 1.12), (0.08, 0.07))
        mz = n((0.80, 0, 0.98), (0.05, 0.05))
        ears = [((0.68, 0.04, 1.32), 0.02), ((0.68, -0.04, 1.32), 0.02)]
    E += [(sh, nk), (nk, hd), (hd, mz)]
    for co, r in ears:
        E.append((hd, n(co, r)))
    tl = n((-0.55, 0, 0.74), 0.025)
    E.append((hip, tl))
    ob = _skin(name, N, E, mat)
    s = height / (1.55 if carved else 1.3)
    ob.scale = (s, s, s)
    ob["figure"] = True
    ob["carved"] = carved
    return ob


def _salt(name):
    """A stable salt from a name (Python's hash() changes every run)."""
    return sum((i + 1) * ord(ch) for i, ch in enumerate(name)) % 9973


def cloaked_figure(name="Figure", mat=None, height=1.7, pose="stand", head="hood"):
    """A person in a long cloak, seen far off, from behind or against the
    light. No face is modelled: the head is a hood or a wrapped turban.
    The cloak hangs from the shoulders in vertical folds that deepen toward
    an uneven hem, the body leans a little, the shoulders are broad and
    sloped, an arm under the cloth makes a bulge at one side.
    pose = 'stand' or 'sit' (cross-legged, wrapped, leaning in)."""
    r = C.rng(_salt(name))
    mat = mat or C.M("wool", colour=(0.18, 0.15, 0.12))
    if pose == "sit":
        prof = [(0.0, 0.0), (0.36, 0.0), (0.40, 0.06), (0.36, 0.14), (0.26, 0.20), (0.20, 0.32),
                (0.19, 0.48), (0.22, 0.56), (0.20, 0.60), (0.12, 0.63), (0.0, 0.64)]
        H = 0.64
    else:
        prof = [(0.0, 0.0), (0.27, 0.0), (0.26, 0.04), (0.24, 0.20), (0.205, 0.45), (0.185, 0.62),
                (0.19, 0.74), (0.225, 0.80), (0.235, 0.825), (0.20, 0.855), (0.09, 0.875), (0.0, 0.88)]
        H = 0.88
    k = height / (H + (0.20 if pose == "stand" else 0.16) * 1.0)
    XY = 0.62 if pose == "stand" else 0.78     # real proportions: a person is narrow for their height
    seg = 40
    verts, faces = [], []
    n = len(prof)
    ph = r.uniform(0, 6.28)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for (rad, z) in prof:
            t = 1 - z / H                                   # 1 at the hem, 0 at the shoulders
            fold = (0.022 * math.sin(a * 9 + ph + z * 2.0) + 0.012 * math.sin(a * 17 + ph * 2)) * t ** 0.8
            hem = 0.025 * math.sin(a * 5 + ph) if z < 0.02 else 0.0
            rr = (rad + fold * (1 if z > 0.01 else 0)) if rad > 0 else 0.0
            # an arm under the cloth at the right side, a little forward
            arm = 0.035 * math.exp(-((a - 0.4) ** 2) / 0.1) * math.exp(-((z - 0.55) ** 2) / 0.03) if pose == "stand" else 0
            rr += arm
            x = rr * math.cos(a)
            y = rr * math.sin(a) * 0.72                     # flatter front to back
            lean = 0.04 * (z / H) ** 2
            verts.append((x * k * XY, (y * XY + lean) * k, (z + hem) * k))
    for i in range(seg):
        j = (i + 1) % seg
        for q in range(n - 1):
            faces.append((i * n + q, j * n + q, j * n + q + 1, i * n + q + 1))
    body = C.mesh_object(name, verts, faces, mat, True)
    C.subsurf(body, 1)
    # the head: a hood falling onto the shoulders, or a wrapped turban
    hz = H * k
    if head == "turban":
        hp = [(0.0, 0.0), (0.085, 0.0), (0.10, 0.04), (0.115, 0.09), (0.11, 0.13), (0.08, 0.17), (0.0, 0.18)]
    else:
        hp = [(0.0, -0.03), (0.12, -0.03), (0.115, 0.05), (0.105, 0.12), (0.085, 0.18), (0.045, 0.215), (0.0, 0.22)]
    hd = C.lathe(name + "_head", [(rr * k * 0.68, z * k * 0.82) for rr, z in hp], 24, mat, True)
    hd.location = (0, 0.03 * k, hz - 0.01 * k)
    hd.rotation_euler = (math.radians(-12 if pose == "sit" else -6), 0, 0)
    hd.scale = (1.0, 0.92, 1.0)
    hd.parent = body
    if head == "turban":
        for w in range(3):
            q = k * 0.68
            tr = C.lathe(name + "_wrap%d" % w, [(0.10 * q, 0.0), (0.122 * q, 0.012 * q), (0.10 * q, 0.024 * q),
                                                 (0.09 * q, 0.012 * q), (0.10 * q, 0.0)], 20, mat, True)
            tr.location = (0, 0.03 * k, hz + (0.03 + w * 0.028) * k)
            tr.rotation_euler = (math.radians(-6 + w * 6), math.radians(w * 4 - 4), 0)
            tr.parent = body
    body["figure"] = True
    return body


def frame_fraction(ob, cam):
    """Height of the object's bounding box in the frame, as a fraction of
    the frame height."""
    s = bpy.context.scene
    bpy.context.view_layer.update()
    ys = []
    for c in ob.bound_box:
        p = ob.matrix_world @ Vector(c)
        ys.append(world_to_camera_view(s, cam, p).y)
    return max(ys) - min(ys)


def guard(ob, cam, max_frac=MAX_FRAC):
    if ob.get("carved"):
        return 0.0
    f = frame_fraction(ob, cam)
    if f > max_frac:
        raise RuntimeError("kit_figures guard: %s would be %.1f%% of the frame height (limit %.0f%%). "
                           "Move it further off." % (ob.name, f * 100, max_frac * 100))
    return f


def place(ob, loc, rot_z, cam):
    ob.location = Vector(loc)
    ob.rotation_euler = (0, 0, rot_z)
    guard(ob, cam)
    return ob
