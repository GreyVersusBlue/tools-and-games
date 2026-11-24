"""A04 tokens: carved playing pieces for the map table.

    blender -b --factory-startup -P scripts/a04_tokens.py -- --preview --token caravan

Batch 1 builds only the caravan. Camera and light match A03: the camera is
pitched 70 degrees down and the light comes from the same azimuth as the
map's sun (from the upper left of the picture). The sun is raised from the
map's 14 degrees to 42 so the contact shadow stays inside the cutout; the
direction it falls is the same as the mountains' shadows on the map.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_figures as F     # noqa: E402
import kit_props as P       # noqa: E402

MAP_SUN_TURN = -62.0        # keep in step with a03_map.py
MAP_PRESET = "late"
TOKEN_SHIP = 384
# the map sun is 14 degrees up; tokens need a higher sun so the shadow of a
# sail stays in the cutout. Same azimuth, so it falls the same way.
TOKEN_SUN_ELEV = 52.0


def base(name="Base", r=0.021):
    """Low round base: a turned walnut disc with a brass band let into its
    edge."""
    wood = C.M("carved_wood")
    d = C.lathe(name, [(0, 0), (r, 0), (r * 1.02, 0.0015), (r * 1.02, 0.0045), (r * 0.97, 0.0062),
                       (r * 0.9, 0.0068), (0, 0.0068)], 64, wood, jitter=0.004, salt=5)
    C.bevel(d, 0.0006, 2)
    band = C.lathe(name + "_band", [(r * 1.022, 0.0018), (r * 1.03, 0.0022), (r * 1.03, 0.0038),
                                    (r * 1.022, 0.0042)], 64, C.M("brass"))
    return [d, band]


def caravan():
    parts = base("CaravanBase", 0.0275)
    wood = C.M("carved_wood")
    brass = C.M("brass")
    # three camels in a gentle diagonal string, each a little smaller
    # a staggered procession facing right (east on the map): each camel a
    # step ahead of and a step nearer than the one behind it, so all three
    # humps stand in profile
    heading0 = math.radians(6)
    spots = []
    # spaced so each hump stands clear of the next: reads better at 64 px
    for k_, (along, side) in enumerate(((-0.0155, 0.0095), (0.0, 0.0), (0.0155, -0.0095))):
        x_ = along * math.cos(heading0) - side * math.sin(heading0) + 0.001
        y_ = along * math.sin(heading0) + side * math.cos(heading0)
        spots.append((x_, y_, 0.94 + 0.03 * k_, heading0))
    prev = None
    for i, (x, y, s, heading) in enumerate(spots):
        c = F.camel("Camel%d" % i, humps=1, mat=wood, carved=True, height=0.026 * s)
        c.location = (x, y, 0.0068)
        c.rotation_euler = (0, 0, heading)
        parts.append(c)
        k = c.scale[0]
        # a brass pack slung across each hump: a bright point per camel, so
        # the three still count at 64 px
        pk = C.box_mesh("Pack%d" % i, (0.34, 0.66, 0.30), (0, 0, 0), brass)
        C.bevel(pk, 0.06, 3)
        pk.parent = c
        pk.location = (-0.04, 0, 1.08)
        parts.append(pk)
        # lead rope as brass wire from this camel's muzzle back to the next
        if prev is not None:
            # the camel behind (prev) has its halter tied to this one's tail
            px_, py_, pk, ph = prev
            bpt = (px_ + math.cos(ph) * 1.02 * pk, py_ + math.sin(ph) * 1.02 * pk, 0.0068 + 1.50 * pk)
            ap = (x - math.cos(heading) * 0.52 * k, y - math.sin(heading) * 0.52 * k, 0.0068 + 0.84 * k)
            cu = bpy.data.curves.new("Lead%d" % i, "CURVE")
            cu.dimensions = "3D"
            sp = cu.splines.new("POLY")
            mid = ((ap[0] + bpt[0]) / 2, (ap[1] + bpt[1]) / 2, min(ap[2], bpt[2]) - 0.002)
            for j, p_ in enumerate((bpt, mid, ap)):
                if j:
                    sp.points.add(1)
                sp.points[j].co = (*p_, 1)
            cu.bevel_depth = 0.00035
            cu.bevel_resolution = 2
            lo = bpy.data.objects.new("Lead%d" % i, cu)
            C.link(lo)
            lo.data.materials.append(brass)
            parts.append(lo)
        prev = (x, y, k, heading)
    return parts


import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402


# ---------------------------------------------------------------------------
# carved boats: one hull routine, a lateen sail routine, oars
# ---------------------------------------------------------------------------
def hull(name, L, beam, depth, sheer_bow, sheer_stern, deck_z, full=2.6, mat=None, stations=40, ring=28):
    """A carved boat hull along +X (bow at +X), keel at z = 0. Each station
    is a rounded U section (superellipse) closed by a gently crowned deck.
    Half-beam and depth taper to the stems; the sheer rises at both ends."""
    verts, faces = [], []
    for i in range(stations + 1):
        t = i / stations                      # 0 stern .. 1 bow
        u = 2 * t - 1
        x = u * L / 2
        # fuller aft, finer bow
        w = max(0.04, (1 - abs(u) ** (2.2 if u > 0 else 3.0))) ** 0.55
        b = beam / 2 * w
        d = depth * (0.35 + 0.65 * w)
        top = deck_z + (sheer_bow if u > 0 else sheer_stern) * abs(u) ** 2.4
        for k in range(ring):
            a = 2 * math.pi * k / ring
            sa, ca = math.sin(a), math.cos(a)
            y = b * math.copysign(abs(sa) ** (2 / full), sa)
            if ca < 0:                          # bottom: the hull
                z = (top - d) + d * (1 - abs(ca) ** (2 / full))
            else:                               # deck, slight crown
                z = top + 0.04 * b * ca
            verts.append((x, y, z))
    for i in range(stations):
        for k in range(ring):
            a0 = i * ring + k
            a1 = i * ring + (k + 1) % ring
            faces.append((a0, a1, a1 + ring, a0 + ring))
    # close the two ends
    n = len(verts)
    verts.append((-L / 2 - 0.0004, 0, deck_z + sheer_stern * 0.8))
    verts.append((L / 2 + 0.0004, 0, deck_z + sheer_bow * 0.8))
    e = stations * ring
    for k in range(ring):
        faces.append(((k + 1) % ring, k, n))
        faces.append((e + k, e + (k + 1) % ring, n + 1))
    ob = C.mesh_object(name, verts, faces, mat or C.M("carved_wood"), True)
    C.subsurf(ob, 1)
    return ob


def rod(name, a, b, r, mat):
    """A round rod (mast, yard, oar) from point a to point b."""
    a, b = Vector(a), Vector(b)
    ln = (b - a).length
    ob = C.lathe(name, [(0, 0), (r, 0), (r, ln), (0, ln)], 10, mat)
    ob.location = a
    ob.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return ob


def lateen(name, tack, peak, clew, mat, belly=0.12, n=18, normal=(0, 1, 0)):
    """A lateen sail: a triangle hung from a slanted yard (tack to peak),
    its third corner (clew) down aft near the deck. Bellied a little away
    from the camera (+Y), so its face is what the camera sees."""
    A, B, Cc = Vector(tack), Vector(peak), Vector(clew)
    verts, faces, idx = [], [], {}
    edge = (B - A).length
    for i in range(n + 1):
        for j in range(n + 1 - i):
            u, v = i / n, j / n           # barycentric on (A->B, A->C)
            p = A + (B - A) * u + (Cc - A) * v
            w = 1 - u - v
            bul = belly * edge * 4 * (u * v + v * w + u * w) * 0.6
            p = p + Vector(normal) * bul
            idx[(i, j)] = len(verts)
            verts.append(tuple(p))
    for i in range(n):
        for j in range(n - i):
            faces.append((idx[(i, j)], idx[(i + 1, j)], idx[(i, j + 1)]))
            if i + j + 1 < n:
                faces.append((idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
    ob = C.mesh_object(name, verts, faces, mat, True)
    sol = ob.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.0006
    sol.offset = 0
    return ob


def boat(name, L, beam, depth, sheer_bow, sheer_stern, sail, oars=0, z0=0.0068, swing=35.0):
    """Assemble a carved boat on the base. sail = (mast_x, mast_h, yard_len,
    yard_angle_deg, clew_x) or None. The sail is swung `swing` degrees
    about the mast, its aft end toward the camera, as a sail sheeted out
    to one side; from 70 degrees above that shows its face, not its edge."""
    wood = C.M("carved_wood")
    brass = C.M("brass")
    parts = []
    h = hull(name + "_hull", L, beam, depth, sheer_bow, sheer_stern, deck_z=depth, mat=wood)
    h.location = (0, 0, z0)
    parts.append(h)
    # a brass rubbing strake along the sheer: a thin band just under the deck edge
    band = hull(name + "_strake", L * 0.985, beam * 1.05, depth * 0.18, sheer_bow * 0.98, sheer_stern * 0.98,
                deck_z=depth * 0.18, mat=brass, stations=40, ring=20)
    band.location = (0, 0, z0 + depth * 0.70)
    parts.append(band)
    if sail:
        mx, mh, yl, ya, cx = sail
        foot = (mx, 0, z0 + depth)
        top = (mx, 0, z0 + depth + mh)
        parts.append(rod(name + "_mast", foot, top, 0.0007, wood))
        ang = math.radians(ya)
        # yard crosses the mast near its head, forward end low, aft end high
        f = 0.38 * yl
        tack = (mx + f * math.cos(ang), 0, z0 + depth + mh - f * math.sin(ang))
        peak = (mx - (yl - f) * math.cos(ang), 0, z0 + depth + mh + (yl - f) * math.sin(ang))
        clew = (cx, 0, z0 + depth + 0.0025)
        th = math.radians(swing)

        def sw(p):
            dx, dy = p[0] - mx, p[1]
            return (mx + dx * math.cos(th) - dy * math.sin(th), dx * math.sin(th) + dy * math.cos(th), p[2])
        tack, peak, clew = sw(tack), sw(peak), sw(clew)
        parts.append(rod(name + "_yard", tack, peak, 0.00055, wood))
        parts.append(lateen(name + "_sail", tack, peak, clew, brass,
                            normal=(-math.sin(th), math.cos(th), 0)))
    if oars:
        for side in (-1, 1):
            for k in range(oars):
                x = -L * 0.30 + L * 0.60 * k / max(1, oars - 1)
                a = (x, side * beam * 0.42, z0 + depth * 1.02)
                b = (x - 0.002, side * (beam * 0.5 + 0.011), z0 + 0.0008)
                parts.append(rod("%s_oar%d%d" % (name, side, k), a, b, 0.00045, wood))
                # a flat brass blade at the water end
                parts.append(C.box_mesh("%s_blade%d%d" % (name, side, k), (0.0014, 0.0034, 0.0004),
                                        (b[0], b[1] + side * 0.001, z0 + 0.0003), brass))
    return parts


def dhow():
    """A Red Sea / Indian Ocean dhow: deep hull with a high stern, one
    slanted sail."""
    parts = base("DhowBase", 0.025)
    parts += boat("Dhow", L=0.038, beam=0.0125, depth=0.0075, sheer_bow=0.0050, sheer_stern=0.0075,
                  sail=(0.004, 0.014, 0.034, 18, -0.012))
    return parts


def nileboat():
    """A Nile boat: long, shallow and flat, with one very tall slanted
    sail on a yard much longer than the boat."""
    parts = base("NileBase", 0.025)
    parts += boat("Nile", L=0.044, beam=0.0120, depth=0.0034, sheer_bow=0.0034, sheer_stern=0.0022,
                  sail=(0.012, 0.022, 0.058, 50, -0.017))
    return parts


def galley():
    """A Mediterranean galley: long, narrow, low, a bank of oars down each
    side, a spur at the bow and a raised deck house aft."""
    parts = base("GalleyBase", 0.025)
    z0, d = 0.0068, 0.0042
    parts += boat("Galley", L=0.046, beam=0.0085, depth=d, sheer_bow=0.0018, sheer_stern=0.0050,
                  sail=None, oars=7)
    wood, brass = C.M("carved_wood"), C.M("brass")
    parts.append(rod("GalleySpur", (0.021, 0, z0 + d * 0.9), (0.0275, 0, z0 + d * 0.8), 0.0008, wood))
    parts.append(rod("GalleySpurTip", (0.0262, 0, z0 + d * 0.82), (0.0285, 0, z0 + d * 0.78), 0.0009, brass))
    house = C.box_mesh("GalleyHouse", (0.008, 0.0066, 0.0032), (-0.015, 0, z0 + d + 0.0028), wood)
    C.bevel(house, 0.0007, 2)
    parts.append(house)
    return parts


def mules():
    """A pair of laden mules walking right, one a step ahead and nearer,
    each with a bale slung either side and one on top, roped in brass."""
    parts = base("MuleBase", 0.025)
    wood = C.M("carved_wood")
    brass = C.M("brass")
    for i, (x, y) in enumerate(((-0.0085, 0.0062), (0.0075, -0.0062))):
        m = F.mule("Mule%d" % i, mat=wood, carved=True, height=0.025)
        m.location = (x, y, 0.0068)
        m.rotation_euler = (0, 0, math.radians(6))
        parts.append(m)
        # load, in the mule's own units (shoulder height ~0.85)
        for side in (-1, 1):
            b = C.box_mesh("Bale%d%d" % (i, side), (0.50, 0.22, 0.40), (0, 0, 0), wood)
            C.bevel(b, 0.04, 2)
            b.parent = m
            b.location = (-0.03, side * 0.30, 0.86)
            parts.append(b)
        top = C.box_mesh("BaleTop%d" % i, (0.46, 0.56, 0.22), (0, 0, 0), wood)
        C.bevel(top, 0.045, 2)
        top.parent = m
        top.location = (-0.03, 0, 1.14)
        parts.append(top)
        g = C.box_mesh("Girth%d" % i, (0.06, 0.84, 0.48), (0, 0, 0), brass)
        g.parent = m
        g.location = (-0.03, 0, 0.98)
        parts.append(g)
    return parts


TOKENS = {"caravan": caravan, "dhow": dhow, "galley": galley, "nileboat": nileboat, "mules": mules}


def build(kind):
    C.reset()
    C.setup_render(768, 768, transparent=True, exposure=-3.6)
    C.sky(MAP_PRESET, sun_turn=MAP_SUN_TURN, elev=TOKEN_SUN_ELEV)
    TOKENS[kind]()
    C.shadow_catcher(0.5, 0.0)
    # batch 2: camera moved in from 0.13 m to 0.105 m so the piece fills the
    # cutout (at 0.13 the base was only ~40% of the frame, too small at 64 px)
    cam = C.tilt_camera("normal", (0.009, -0.006, 0.008), 0.105, 70.0)
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--token", default="caravan", choices=list(TOKENS)))
    build(C.ARGS.token)
    C.save_cutout("token-" + C.ARGS.token, TOKEN_SHIP, "token")
    C.write_log("a04-" + C.ARGS.token)


main()
