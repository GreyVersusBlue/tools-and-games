"""A18 title: at the window of the merchant's room at dawn, looking out
through the open lattice screen over the roofs, domes and minarets of Cairo
to the river and a pale sky. On the sill, in soft focus, a sealed letter
and a small brass balance. The upper left third is plain sky for the title.

    blender -b --factory-startup -P scripts/a18_title.py -- --preview

Writes title.webp (still) and title-wide.webp (1200 x 630, 250 KB or less),
the second cropped from the same master so the two always match.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_props as P       # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_models as KM     # noqa: E402
import bpy                  # noqa: E402
import numpy as np          # noqa: E402

EYE = 45.0                  # the house stands high on the slopes above the city
WALL_Y = 1.25
SILL_Z = EYE - 0.55
WIN = (-3.4, 0.55)          # window opening x0, x1: its right jamb shows at the frame edge
WIN_TOP = EYE + 2.6
EXPOSURE = -0.6
SUN_TURN = 200.0            # dawn sun behind the camera (east), lighting the city toward the river


def room():
    plaster = C.M("lime_plaster", colour=(0.62, 0.55, 0.46))
    stone = C.M("limestone", colour=(0.66, 0.60, 0.50), scale=2.0)
    # the window wall: a slab with a big opening
    L = 14.0
    pieces = A.wall_with_opening("WinWall", L, EYE + 6.0, 0.6,
                                 (WIN[0] + L / 2, SILL_Z, WIN[1] + L / 2, WIN_TOP), plaster)
    for p in pieces:
        p.location = (-L / 2, WALL_Y + 0.3, 0)
    # the sill: a deep stone ledge
    C.box_mesh("Sill", (WIN[1] - WIN[0] + 0.3, 0.75, 0.12), ((WIN[0] + WIN[1]) / 2, WALL_Y + 0.25, SILL_Z - 0.06), stone)
    # the lattice screen: two leaves swung open into the room, right side
    for k, (hx, ang) in enumerate(((WIN[1], 115.0),)):
        scr = A.lattice_screen("Leaf%d" % k, 1.6, WIN_TOP - SILL_Z, cell=0.06, bar=0.007)
        scr.location = (hx, WALL_Y - 0.05, SILL_Z)
        scr.rotation_euler = (0, 0, math.radians(ang))
    # the dim room behind the camera (only to stop the sky lighting the sill from behind)
    C.box_mesh("RoomBack", (L, 0.3, EYE + 6.0), (0, -6.0, (EYE + 6.0) / 2), plaster)
    C.box_mesh("RoomCeil", (L, 8.0, 0.3), (0, -2.5, WIN_TOP + 0.6), plaster)


def sill_objects():
    z = SILL_Z
    lt = P.letter_packet("Letter", w=0.13, d=0.05, salt=1801)
    lt.scale = (2.2, 2.2, 2.2)
    P.place(lt, (-0.55, WALL_Y - 0.22, z), math.radians(14))
    sc = P.balance_scale("Balance", 0.18)
    sc.scale = (2.0, 2.0, 2.0)
    P.place(sc, (0.10, WALL_Y - 0.05, z), math.radians(-8))


def packed_city(x0, x1, y0, y1, cell, h, salt, mats, skip=0.08, street=5):
    """A dense quarter of flat-roofed houses packed wall to wall, with a
    narrow street every few cells: one mesh per material, so thousands of
    houses build quickly. Each house is a block with a low parapet."""
    r = C.rng(salt)
    groups = [([], []) for _ in mats]
    nx, ny = int((x1 - x0) / cell), int((y1 - y0) / cell)
    for j in range(ny):
        if j % street == street - 1:
            continue
        for i in range(nx):
            if i % (street + 2) == street + 1 or r.random() < skip:
                continue
            cx, cy = x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell
            w = cell * r.uniform(0.86, 0.99)
            d = cell * r.uniform(0.86, 0.99)
            hh = r.uniform(*h) * (1.5 if r.random() < 0.08 else 1.0)
            vs, fs = groups[r.randrange(len(mats))]
            o = len(vs)
            for (zz, ww, dd) in ((0.0, w, d), (hh, w, d), (hh, w * 0.92, d * 0.92), (hh + 0.0, w, d), (hh + 0.7, w, d),
                                 (hh + 0.7, w * 0.92, d * 0.92), (hh - 0.1, w * 0.92, d * 0.92)):
                pass
            # outer box with a parapet lip and a sunk roof
            pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
            inner = [(px * 0.9, py * 0.9) for px, py in pts]
            for px, py in pts:
                vs.append((cx + px, cy + py, 0.0))
            for px, py in pts:
                vs.append((cx + px, cy + py, hh + 0.7))
            for px, py in inner:
                vs.append((cx + px, cy + py, hh + 0.7))
            for px, py in inner:
                vs.append((cx + px, cy + py, hh))
            for k in range(4):
                k2 = (k + 1) % 4
                fs.append((o + k, o + k2, o + 4 + k2, o + 4 + k))           # walls
                fs.append((o + 4 + k, o + 4 + k2, o + 8 + k2, o + 8 + k))    # parapet top
                fs.append((o + 8 + k, o + 8 + k2, o + 12 + k2, o + 12 + k))  # parapet inside
            fs.append((o + 12, o + 13, o + 14, o + 15))                      # roof
    for k, (vs, fs) in enumerate(groups):
        if vs:
            C.mesh_object("Quarter%d_%d" % (salt, k), vs, fs, mats[k])


def city():
    mats = [C.M("house_wall", colour=(0.66, 0.58, 0.47)), C.M("house_wall", colour=(0.62, 0.56, 0.46), tex="stone"),
            C.M("house_wall", colour=(0.60, 0.46, 0.33), tex="mud"), C.M("house_wall", colour=(0.56, 0.49, 0.40)),
            C.M("house_wall", colour=(0.80, 0.72, 0.60), tex="stone")]
    C.box_mesh("Ground", (8000, 8000, 0.2), (0, 3000, -0.1), C.M("rocky_ground", scale=0.2, tint=(0.75, 0.62, 0.48)))
    # near: small houses packed tight; further: the same, coarser
    packed_city(-500, 400, 16, 700, 13.0, (7, 15), 1811, mats)
    packed_city(-1300, 1100, 700, 1450, 22.0, (5, 10), 1812, mats, street=4)
    stone = C.M("pale_block", scale=0.12)
    # domes and minarets right of centre: the upper left stays plain sky
    for k, (x, y, r) in enumerate(((10, 330, 9.0), (120, 760, 13.0), (-40, 1150, 9.0), (210, 520, 7.0),
                                   (-90, 620, 7.5))):
        C.box_mesh("DomeBase%d" % k, (2.2 * r, 2.2 * r, 20.0), (x, y, 10.0), stone)
        A.dome("Dome%d" % k, r, stone, drum=2.5, loc=(x, y, 20.0), ribbed=(k % 2 == 0))
    for k, (x, y, hm) in enumerate(((40, 380, 56.0), (150, 820, 60.0), (-20, 1250, 52.0), (240, 560, 48.0))):
        C.box_mesh("MosqueBlock%d" % k, (28, 28, 15.0), (x + 14, y + 14, 7.5), stone)
        A.minaret_mamluk("Minaret%d" % k, hm, stone, loc=(x, y, 0.0))
    # the river and the far bank
    C.box_mesh("Nile", (9000, 900, 0.2), (0, 1950, 0.05), C.M("rippled_water", colour=(0.05, 0.06, 0.06), ripple=0.5))
    import kit_ships as S
    import kit_plants as PL
    r = C.rng(1830)
    for k in range(5):
        nb = S.nile_boat("NileBoat%d" % k, r.uniform(12, 18), rig="set")
        nb.location = (r.uniform(-700, 600), r.uniform(1700, 2250), 0.05)
        nb.rotation_euler = (0, 0, r.uniform(-0.4, 0.4) + (3.1416 if r.random() < 0.5 else 0))
    palm_coll = bpy.data.collections.new("FarPalms")
    for k in range(3):
        pg = PL.coconut_palm_fine("FarPalm%d" % k, r.uniform(11, 15), lean=(0.0, 0.0), bend=0.02, salt=1840 + k)
        for o in [pg] + list(pg.children_recursive):
            for c in list(o.users_collection):
                c.objects.unlink(o)
            palm_coll.objects.link(o)
    for k in range(1400):
        e = bpy.data.objects.new("FarPalm_%d" % k, None)
        e.instance_type = "COLLECTION"
        e.instance_collection = palm_coll
        C.link(e)
        e.location = (r.uniform(-2500, 2500), 2420.0 + 900.0 * r.random() ** 1.5, 0.2)
        e.rotation_euler = (0, 0, r.uniform(0, 6.28))
    C.box_mesh("FarBank", (9000, 3000, 0.4), (0, 3830, 0.0), C.M("foliage", colour=(0.12, 0.17, 0.06)))      # green sown land on the far bank


def save_wide(master, out, size=(1200, 630), max_bytes=250 * 1024):
    """Crop the master to the wide card's shape (keeping the sky) and ship it."""
    im = bpy.data.images.load(master, check_existing=False)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ch = int(round(w * size[1] / size[0]))
    top = h - ch                                       # numpy rows run bottom-up: keep the top (sky)
    crop = a[max(0, top - int(h * 0.02)):max(0, top - int(h * 0.02)) + ch]
    bpy.data.images.remove(im)
    ci = bpy.data.images.new("wide", w, crop.shape[0], alpha=False)
    ci.pixels.foreach_set(np.ascontiguousarray(crop).ravel())
    p = os.path.join(C.MASTERS, "title-wide.png")
    ci.filepath_raw = p
    ci.file_format = "PNG"
    ci.save()
    bpy.data.images.remove(ci)
    return C._ship_webp(p, out, size, max_bytes, alpha=False)


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    C.sky("dawn", sun_turn=SUN_TURN, elev=6.0)      # a sky photo was tried: grey on the side away from the sun
    C.haze(0.0007, (0.92, 0.84, 0.78), 0.55, extent=7000.0, top=300.0)
    room()
    sill_objects()
    city()
    cam = C.camera("normal", (-0.15, -1.2, EYE), (-150.0, 2000.0, EYE - 215.0), focus=600.0, fstop=2.8)
    return cam


def main():
    C.parse_args()
    build()
    out = C.save_still("title")
    if C.ARGS.final:
        q, n, fits = save_wide(os.path.join(C.MASTERS, "title.png"), os.path.join(C.OUT, "title-wide.webp"))
        C.SAVE_LOG.append(dict(name="title-wide", out=os.path.join(C.OUT, "title-wide.webp"), seconds=0.0,
                               quality=q, bytes=n, fits=fits))
    C.write_log("a18")


main()
