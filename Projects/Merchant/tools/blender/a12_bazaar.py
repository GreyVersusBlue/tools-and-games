"""A12 a covered market: inside a long market street roofed with vaults,
empty in the early morning, normal lens. Shafts of sun come down through
openings in the roof into dusty air. Stalls along both sides, raised a step,
their goods laid out: bolts of cloth, brass and copper vessels, sacks of
spice with the tops rolled back, rope, jars. At the far end, small in the
light, two cloaked figures from behind.

    blender -b --factory-startup -P scripts/a12_bazaar.py -- --preview

Spices: black pepper, pale ginger, brown cinnamon, yellow turmeric, dried
rose buds. Nothing from the Americas.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_figures as F     # noqa: E402
import kit_props as P       # noqa: E402
import bpy                  # noqa: E402

W = 5.2                     # street width between stall fronts
BAY = 5.0
NBAYS = 16
STALL_D = 2.6               # stall depth behind the arch
STEP = 0.55                 # stalls raised a step
BENCH = 0.95                # the raised stone bench runs out in front of each stall
WALL_H = 6.0                # springing of the vault
EXPOSURE = 0.6
SUN_TURN = 152.0            # morning sun from behind-right, steep: shafts lean toward the camera's left
SUN_ELEV = 58.0


def vault(name, y0, slot, mat):
    """A barrel vault over one bay, from wall to wall across X; if slot,
    a long opening along its crown lets the sun in."""
    R = W / 2 + 0.6
    n = 24
    verts, faces = [], []
    gap = 0.55 if slot else 0.0
    rows = []
    for i in range(n + 1):
        a = math.pi * i / n
        x = R * math.cos(a)
        if abs(x) < gap:
            rows.append(None)
            continue
        rows.append((x, WALL_H + R * math.sin(a) * 0.9))
    for yy in (y0, y0 + BAY):
        for p in rows:
            if p is not None:
                verts.append((p[0], yy, p[1]))
    m = sum(1 for p in rows if p is not None)
    idx = [k for k, p in enumerate(rows) if p is not None]
    for j in range(m - 1):
        if idx[j + 1] - idx[j] != 1:
            continue            # the slot
        faces.append((j, j + 1, m + j + 1, m + j))
    ob = C.mesh_object(name, verts, faces, mat, True)
    s = ob.modifiers.new("Solid", "SOLIDIFY")
    s.thickness = 0.5
    s.offset = 1
    return ob


def stall_goods(k, side, y, r):
    """Goods on one stall platform at bay k on `side` (-1 left, +1 right)."""
    x0 = side * (W / 2 - BENCH + 0.15)
    z = STEP
    kind = k % 6
    put = lambda ob, dx, dy, rz=0.0: P.place(ob, (x0 + side * dx, y + dy, z), rz)
    if kind == 0:       # cloth
        cols = [(0.42, 0.04, 0.05), (0.08, 0.10, 0.30), (0.70, 0.55, 0.20), (0.20, 0.30, 0.15)]
        for i in range(4):
            b = P.bolt("Bolt%d_%d_%d" % (k, side, i), r=0.13, length=0.9, mat=C.M("wool", colour=cols[i]), unroll=0.0,
                       salt=1200 + k * 10 + i)
            put(b, 0.2 + (i % 2) * 0.35, -1.4 + i * 0.75, math.pi / 2)
            if i == 3:
                b.location.z += 0.26
    elif kind == 1:     # brass and copper
        for i in range(7):
            m = "brass" if i % 2 else "copper"
            if i % 3 == 0:
                o = P.jar("Ewer%d_%d_%d" % (k, side, i), r=0.13, h=0.38, neck=0.05, mat=m, salt=1300 + k * 10 + i)
            else:
                o = P.bowl("Basin%d_%d_%d" % (k, side, i), r=r.uniform(0.18, 0.32), h=r.uniform(0.1, 0.18), mat=m,
                           salt=1300 + k * 10 + i)
            put(o, 0.25 + (i % 3) * 0.45, -1.6 + (i // 3) * 1.0 + r.uniform(-0.1, 0.1))
    elif kind in (2, 4):  # spice sacks, tops rolled back
        spices = [("peppercorn", None), ("sand", (0.95, 0.85, 0.62)), ("clay", (0.45, 0.24, 0.12)),
                  ("sand", (0.95, 0.66, 0.08)), ("clay", (0.55, 0.20, 0.24))]
        for i in range(5):
            sx = 0.3 + (i % 2) * 0.5
            sy = -1.8 + i * 0.85
            sk = P.sack("Spice%d_%d_%d" % (k, side, i), r=0.24, h=0.45, roll=0.07, mat=C.M("hessian", colour=(0.55, 0.43, 0.30)),
                        salt=1400 + k * 10 + i)
            put(sk, sx, sy)
            mname, col = spices[(i + k) % 5]
            mat = C.M(mname) if col is None else C.M(mname, colour=col)
            hp = P.heap("SpiceHeap%d_%d_%d" % (k, side, i), r=0.235, h=0.14, mat=mat, salt=1450 + k * 10 + i, lumps=0.5)
            put(hp, sx, sy)
            hp.location.z += 0.36
    elif kind == 3:     # rope and jars
        for i in range(3):
            put(P.rope_coil("Rope%d_%d_%d" % (k, side, i), 0.3, 5.0, 0.03, salt=1500 + k * 10 + i), 0.3, -1.5 + i * 1.0)
        for i in range(3):
            put(P.jar("Jar%d_%d_%d" % (k, side, i), r=0.2, h=0.6, neck=0.08, mat=C.M("clay"), salt=1550 + k * 10 + i),
                0.95, -1.3 + i * 0.9)
    else:               # jars and folded cloth
        for i in range(4):
            put(P.folded_cloth("Fold%d_%d_%d" % (k, side, i), 0.6, 0.45, 4, 0.04,
                               C.M("linen", colour=(0.62, 0.56, 0.44)), salt=1600 + k * 10 + i), 0.35, -1.6 + i * 0.95)


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    C.sky("day", sun_turn=SUN_TURN, elev=SUN_ELEV)
    wall = C.M("pale_block", scale=0.35)
    plaster = C.M("lime_plaster", colour=(0.72, 0.66, 0.56))
    floor = C.M("quay_stone", scale=0.6)
    L = NBAYS * BAY
    C.box_mesh("Floor", (W + 8, L + 10, 0.2), (0, L / 2, -0.1), floor)
    r = C.rng(1212)
    for side in (-1, 1):
        # stall platforms, back walls, and the arcade of stall openings
        C.box_mesh("Platform%d" % side, (STALL_D + BENCH, L, STEP), (side * (W / 2 + (STALL_D - BENCH) / 2), L / 2, STEP / 2), wall)
        C.box_mesh("Back%d" % side, (0.6, L, WALL_H + 1.5), (side * (W / 2 + STALL_D + 0.3), L / 2, (WALL_H + 1.5) / 2), wall)
        ops = [((k + 0.5) * BAY, BAY * 0.78, 2.6) for k in range(NBAYS)]
        pan = A.arched_panel("Arcade%d" % side, L, WALL_H, 0.7, ops, wall, "pointed")
        pan.rotation_euler = (0, 0, math.radians(90))
        pan.location = (side * (W / 2 + 0.35), 0, 0)
        for sf in A.soffits("ArcSof%d" % side, ops, 0.7, wall, "pointed"):
            sf.rotation_euler = (0, 0, math.radians(90))
            sf.location = (side * (W / 2 + 0.35), 0, 0)
        C.box_mesh("StallCeil%d" % side, (STALL_D + 0.6, L, 0.3), (side * (W / 2 + STALL_D / 2), L / 2, 4.4), wall)
        for k in range(1, NBAYS):
            stall_goods(k, side, (k + 0.5) * BAY, r)
    # the vaults, slots in every other bay; transverse arch ribs between bays
    for k in range(NBAYS):
        vault("Vault%d" % k, k * BAY, slot=(k % 2 == 1), mat=plaster)
        rib = A.arched_panel("Rib%d" % k, W + 1.2, WALL_H + W / 2 + 1.0, 0.5, [((W + 1.2) / 2, W, WALL_H - 0.2)], wall, "pointed")
        rib.location = (-(W + 1.2) / 2, k * BAY, 0)
    # end wall far away with a bright doorway
    end = A.arched_panel("EndWall", W + 1.2, WALL_H + 4.0, 0.8, [((W + 1.2) / 2, 3.0, 3.0)], wall, "pointed")
    end.location = (-(W + 1.2) / 2, L + 0.4, 0)
    # dusty air
    C.haze(0.022, (0.92, 0.86, 0.76), 0.7, box=((-W / 2 - 0.1, 0.0, 0.0), (W / 2 + 0.1, L, WALL_H + 3.0)))
    cam = C.camera("normal", (0.6, -1.0, 1.65), (0.0, L * 0.6, 1.9))
    dark = C.M("dark", colour=(0.05, 0.04, 0.035))
    for i, (x, y) in enumerate(((-0.6, L - 6.0), (0.9, L - 9.0))):
        F.place(F.cloaked_figure("Fig%d" % i, dark, 1.7), (x, y, 0), math.radians(90), cam)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("bazaar")
    C.write_log("a12")


main()
