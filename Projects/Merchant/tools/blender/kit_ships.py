"""Ships kit: full-size vessels for the wide views, seen from far off.

Nile boat, Red Sea / Indian Ocean dhow (sewn planks, double-ended, one
lateen sail), Mediterranean galley (long, low, oared, one lateen yard),
Mediterranean round ship (deep round hull, two lateen masts, no castles),
small harbour boats, a long narrow river canoe, and a Chinese junk for the
far distance (several masts, battened sails, high square stern).

Each builder returns a group empty at the waterline origin, bow toward +X.
Sails take a `rig` option: 'set' (sail drawing), 'furled' (bundled on the
yard) or 'bare' (yard lowered, no sail). The dhow's sail shape is one option
(`sail=`) so it can be swapped when the research milestone decides.
"""
import math

import bpy
from mathutils import Vector

import common as C
import kit_props as P


# --------------------------------------------------------------------------
# hull
# --------------------------------------------------------------------------
def hull(name, L, beam, depth, sheer_bow=0.8, sheer_stern=0.8, mat=None, full=2.4,
         stern_w=0.0, bow_fine=2.2, stern_fine=2.8, stations=48, ring=32, freeboard=None):
    """Closed hull along +X (bow +X), keel at z = -draft, deck edge at z =
    freeboard (the waterline is z = 0). stern_w > 0 gives a square stern of
    that fraction of the beam (the junk)."""
    fb = freeboard if freeboard is not None else depth * 0.45
    draft = depth - fb
    verts, faces = [], []
    for i in range(stations + 1):
        t = i / stations
        u = 2 * t - 1
        x = u * L / 2
        if u > 0:
            w = max(0.02, 1 - abs(u) ** bow_fine) ** 0.55
        else:
            w = max(stern_w, max(0.02, 1 - abs(u) ** stern_fine) ** 0.55)
        b = beam / 2 * w
        d = depth * (0.3 + 0.7 * min(1.0, w * 1.2))
        top = fb + (sheer_bow if u > 0 else sheer_stern) * abs(u) ** 2.2
        for k in range(ring):
            a = 2 * math.pi * k / ring
            sa, ca = math.sin(a), math.cos(a)
            y = b * math.copysign(abs(sa) ** (2 / full), sa)
            if ca < 0:
                z = (top - d) + d * (1 - abs(ca) ** (2 / full))
            else:
                z = top - 0.15 + 0.03 * b * ca         # deck a little below the rail
            verts.append((x, y, z))
    for i in range(stations):
        for k in range(ring):
            a0 = i * ring + k
            a1 = i * ring + (k + 1) % ring
            faces.append((a0, a1, a1 + ring, a0 + ring))
    n = len(verts)
    e = stations * ring
    verts.append((-L / 2, 0, fb + sheer_stern * 0.5))
    verts.append((L / 2, 0, fb + sheer_bow * 0.5))
    for k in range(ring):
        faces.append(((k + 1) % ring, k, n))
        faces.append((e + k, e + (k + 1) % ring, n + 1))
    ob = C.mesh_object(name, verts, faces, mat or C.M("plank_hull"), True)
    C.subsurf(ob, 1)
    return ob


def rod(name, a, b, r, mat, r_end=None):
    a, b = Vector(a), Vector(b)
    ln = (b - a).length
    re = r if r_end is None else r_end
    ob = C.lathe(name, [(0, 0), (r, 0), (re, ln), (0, ln)], 8, mat)
    ob.location = a
    ob.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return ob


def _tri_sail(name, A, B, Cc, mat, belly, normal, n=14):
    A, B, Cc = Vector(A), Vector(B), Vector(Cc)
    verts, faces, idx = [], [], {}
    edge = (B - A).length
    for i in range(n + 1):
        for j in range(n + 1 - i):
            u, v = i / n, j / n
            w = 1 - u - v
            p = A + (B - A) * u + (Cc - A) * v + Vector(normal) * belly * edge * 2.4 * (u * v + v * w + u * w)
            idx[(i, j)] = len(verts)
            verts.append(tuple(p))
    for i in range(n):
        for j in range(n - i):
            faces.append((idx[(i, j)], idx[(i + 1, j)], idx[(i, j + 1)]))
            if i + j + 1 < n:
                faces.append((idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
    ob = C.mesh_object(name, verts, faces, mat, True)
    s = ob.modifiers.new("Solid", "SOLIDIFY")
    s.thickness = 0.02
    return ob


def lateen_rig(name, mast_x, deck_z, mast_h, yard_len, yard_ang, rig="set", clew_x=None, swing=20.0,
               mat_sail=None, mat_wood=None, side=1, luff=0.0):
    """Mast, slanted yard and a lateen sail (set, furled or bare)."""
    wood = mat_wood or C.M("ship_timber")
    sail = mat_sail or C.M("sailcloth")
    parts = [rod(name + "_mast", (mast_x, 0, deck_z), (mast_x, 0, deck_z + mast_h), mast_h * 0.012, wood,
                 mast_h * 0.007)]
    ang = math.radians(yard_ang)
    f = 0.36 * yard_len
    hz = deck_z + mast_h * (0.95 if rig != "bare" else 0.35)
    if rig == "bare":
        ang = math.radians(4)
    tack = Vector((mast_x + f * math.cos(ang), 0, hz - f * math.sin(ang)))
    peak = Vector((mast_x - (yard_len - f) * math.cos(ang), 0, hz + (yard_len - f) * math.sin(ang)))
    th = math.radians(swing) * side

    def sw(p):
        dx, dy = p.x - mast_x, p.y
        return Vector((mast_x + dx * math.cos(th) - dy * math.sin(th), dx * math.sin(th) + dy * math.cos(th), p.z))
    tack, peak = sw(tack), sw(peak)
    parts.append(rod(name + "_yard", tack, peak, yard_len * 0.006, wood, yard_len * 0.003))
    if rig == "set":
        cx = clew_x if clew_x is not None else mast_x - yard_len * 0.45
        clew = sw(Vector((cx, 0, deck_z + 1.0)))
        nrm = Vector((-math.sin(th), math.cos(th), 0)) * side
        parts.append(_tri_sail(name + "_sail", tack, peak, clew, sail, 0.07, nrm))
        if luff > 0:
            # settee: the forward corner is cut off square, a short luff
            # running down from the tack to a second corner near the deck
            low = sw(Vector((tack.x + 0.3, 0, max(deck_z + 1.0, tack.z - luff * yard_len))))
            low = Vector((low.x, tack.y, low.z))
            parts.append(_tri_sail(name + "_luff", tack, clew, low, sail, 0.03, nrm, n=6))
    elif rig == "furled":
        # the sail bundled along the yard: a fat soft roll hanging under it
        d = (peak - tack)
        parts.append(rod(name + "_furl", tack + d * 0.08 + Vector((0, 0, -0.25)), peak - d * 0.06 + Vector((0, 0, -0.2)),
                         yard_len * 0.016, sail, yard_len * 0.008))
    # a couple of stays: forestay and two shrouds, thin dark lines
    rope = C.M("rope", colour=(0.25, 0.20, 0.15))
    top = Vector((mast_x, 0, deck_z + mast_h * 0.97))
    for k, foot in enumerate(((mast_x + mast_h * 0.5, 0, deck_z + 0.3), (mast_x - mast_h * 0.12, 0.9, deck_z + 0.3),
                              (mast_x - mast_h * 0.12, -0.9, deck_z + 0.3))):
        parts.append(rod("%s_stay%d" % (name, k), top, foot, 0.02, rope))
    return parts


def _group(name, parts, rot_z=0.0):
    return P.group(name, parts, rot_z=rot_z)


# --------------------------------------------------------------------------
# ships
# --------------------------------------------------------------------------
def dhow(name="Dhow", L=16.0, rig="set", sail="lateen", sewn=True, salt=0):
    """Sewn-plank Indian Ocean ship: pointed at both ends, a raked stem, one
    mast, one slanted sail. sail='lateen' (triangular) or 'settee' (a
    lateen with a short luff at the front: the swappable option)."""
    beam, depth = L * 0.28, L * 0.17
    hm = C.M("plank_hull", sewn=sewn, colour=(0.40, 0.30, 0.20), plank=0.24)
    h = hull(name + "_hull", L, beam, depth, sheer_bow=L * 0.09, sheer_stern=L * 0.07, mat=hm,
             bow_fine=1.8, stern_fine=2.0)
    deck = depth * 0.45 - 0.15
    parts = [h]
    parts += lateen_rig(name, L * 0.08, deck, L * 0.75, L * 1.05, 28, rig, clew_x=-L * 0.42,
                        luff=0.12 if sail == "settee" else 0.0)
    return _group(name, parts)


def nile_boat(name="NileBoat", L=14.0, rig="set"):
    beam, depth = L * 0.26, L * 0.09
    h = hull(name + "_hull", L, beam, depth, sheer_bow=L * 0.05, sheer_stern=L * 0.06,
             mat=C.M("plank_hull", colour=(0.38, 0.30, 0.22)), full=3.0)
    parts = [h] + lateen_rig(name, L * 0.12, depth * 0.45 - 0.15, L * 0.9, L * 1.5, 40, rig, clew_x=-L * 0.45)
    return _group(name, parts)


def round_ship(name="RoundShip", L=26.0, rig="furled", masts=2):
    """Mediterranean round ship of the 1300s: a deep, full, round hull, high
    sides, two masts with lateen yards (the foremast taller), steering oars
    at the quarters. No castles, no gun ports."""
    beam, depth = L * 0.32, L * 0.22
    h = hull(name + "_hull", L, beam, depth, sheer_bow=L * 0.06, sheer_stern=L * 0.08,
             mat=C.M("plank_hull", colour=(0.30, 0.22, 0.15), plank=0.28), full=2.0, bow_fine=2.6,
             stern_fine=2.6, freeboard=depth * 0.5)
    deck = depth * 0.5 - 0.15
    parts = [h]
    parts += lateen_rig(name + "_fore", L * 0.18, deck, L * 0.95, L * 1.05, 26, rig)
    if masts > 1:
        parts += lateen_rig(name + "_main", -L * 0.10, deck, L * 0.72, L * 0.85, 26, rig)
    wood = C.M("ship_timber")
    for s in (-1, 1):
        parts.append(rod(name + "_steer%d" % s, (-L * 0.40, s * beam * 0.45, deck + 1.2),
                         (-L * 0.47, s * beam * 0.52, -depth * 0.4), 0.12, wood))
    return _group(name, parts)


def galley(name="Galley", L=40.0, rig="furled", oars=24, oars_up=False):
    """Long, low, narrow war-and-merchant galley: a bank of oars each side,
    a raised steering deck aft, a beak forward, one lateen yard."""
    beam, depth = L * 0.13, L * 0.06
    hm = C.M("plank_hull", colour=(0.28, 0.20, 0.14), plank=0.26)
    h = hull(name + "_hull", L, beam, depth, sheer_bow=0.5, sheer_stern=1.4, mat=hm, full=2.6,
             bow_fine=2.4, stern_fine=2.6, freeboard=depth * 0.55)
    deck = depth * 0.55 - 0.15
    parts = [h]
    wood = C.M("ship_timber")
    parts.append(rod(name + "_beak", (L * 0.48, 0, deck + 0.2), (L * 0.60, 0, deck + 0.1), 0.18, wood, 0.08))
    # outrigger (apostis) rail along each side, and the oars
    for s in (-1, 1):
        parts.append(rod(name + "_rail%d" % s, (-L * 0.33, s * beam * 0.62, deck + 0.4),
                         (L * 0.36, s * beam * 0.62, deck + 0.4), 0.1, wood))
        for k in range(oars):
            x = -L * 0.30 + L * 0.62 * k / (oars - 1)
            a = Vector((x, s * beam * 0.62, deck + 0.4))
            if oars_up:
                b = Vector((x - 1.0, s * (beam * 0.62 + 5.5), deck + 4.5))
            else:
                b = Vector((x - 1.5, s * (beam * 0.62 + 7.5), -0.1))
            parts.append(rod("%s_oar%d_%d" % (name, s, k), a, b, 0.06, wood, 0.05))
    house = C.box_mesh(name + "_poop", (L * 0.12, beam * 0.9, 1.4), (-L * 0.40, 0, deck + 0.9), wood)
    parts.append(house)
    parts += lateen_rig(name + "_m", L * 0.12, deck, L * 0.42, L * 0.62, 20, rig)
    return _group(name, parts)


def small_boat(name="Skiff", L=5.5, salt=0, mat=None):
    beam, depth = L * 0.33, L * 0.13
    h = hull(name + "_hull", L, beam, depth, sheer_bow=0.35, sheer_stern=0.25,
             mat=mat or C.M("plank_hull", colour=(0.36, 0.28, 0.20), plank=0.18), full=2.4, freeboard=depth * 0.55)
    wood = C.M("ship_timber")
    r = C.rng(salt)
    parts = [h]
    for s in (-1, 1):
        parts.append(rod(name + "_oar%d" % s, (0.2, s * beam * 0.4, depth * 0.5),
                         (-L * 0.5 + r.uniform(-0.3, 0.3), s * beam * 0.3, depth * 0.55), 0.03, wood))
    return _group(name, parts)


def canoe(name="Canoe", L=13.0, mat=None):
    """Long narrow river boat (the Niger): low, slim, upswept ends."""
    beam, depth = L * 0.10, L * 0.05
    h = hull(name + "_hull", L, beam, depth, sheer_bow=0.45, sheer_stern=0.4,
             mat=mat or C.M("plank_hull", colour=(0.30, 0.22, 0.15), plank=0.3), full=2.2, bow_fine=1.6,
             stern_fine=1.6, freeboard=depth * 0.5)
    return _group(name, [h])


def _batten_sail(name, x, deck_z, h, w, mat, battens=7, lean=0.05):
    """A junk's lug sail: a tall near-rectangle stiffened by battens."""
    verts, faces = [], []
    ny, nx = battens * 2, 6
    for j in range(ny + 1):
        t = j / ny
        z = deck_z + h * (0.12 + 0.86 * t)
        wid = w * (0.9 + 0.1 * t)
        x0 = x - wid * 0.35 + lean * h * t
        belly = 0.25 * math.sin(math.pi * ((j % 2) * 0.5 + 0.25))
        for i in range(nx + 1):
            s = i / nx
            verts.append((x0 - wid * s, (belly + 0.35 * math.sin(math.pi * s)), z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    ob = C.mesh_object(name, verts, faces, mat, True)
    s = ob.modifiers.new("Solid", "SOLIDIFY")
    s.thickness = 0.05
    parts = [ob]
    wood = C.M("ship_timber")
    for j in range(0, ny + 1, 2):
        t = j / ny
        z = deck_z + h * (0.12 + 0.86 * t)
        wid = w * (0.9 + 0.1 * t)
        x0 = x - wid * 0.35 + lean * h * t
        parts.append(rod("%s_bat%d" % (name, j), (x0 + 0.2, 0.4, z), (x0 - wid - 0.2, 0.4, z), 0.07, wood))
    return parts


def junk(name="Junk", L=55.0, masts=4):
    """A large Chinese seagoing junk, built only for the far distance: a
    broad hull with a high square stern, several masts with tall battened
    lug sails of dark matting."""
    beam, depth = L * 0.28, L * 0.18
    h = hull(name + "_hull", L, beam, depth, sheer_bow=L * 0.05, sheer_stern=L * 0.12,
             mat=C.M("plank_hull", colour=(0.26, 0.19, 0.13), plank=0.4), full=2.2, stern_w=0.62,
             bow_fine=2.0, freeboard=depth * 0.5)
    deck = depth * 0.5 - 0.15
    parts = [h]
    # stern castle block (the high square stern of the junk)
    parts.append(C.box_mesh(name + "_stern", (L * 0.14, beam * 0.62, L * 0.07), (-L * 0.43, 0, deck + L * 0.04),
                            C.M("plank_hull", colour=(0.24, 0.17, 0.12), plank=0.4)))
    wood = C.M("ship_timber")
    sail = C.M("reed_mat")
    xs = [L * 0.34, L * 0.12, -L * 0.08, -L * 0.26, -L * 0.38][:masts]
    hs = [0.62, 0.95, 0.85, 0.6, 0.45]
    for k, (x, hk) in enumerate(zip(xs, hs)):
        mh = L * hk
        parts.append(rod("%s_mast%d" % (name, k), (x, 0, deck), (x, 0, deck + mh), 0.35, wood, 0.2))
        parts += _batten_sail("%s_sail%d" % (name, k), x + mh * 0.18, deck, mh, mh * 0.42, sail)
    return _group(name, parts)
