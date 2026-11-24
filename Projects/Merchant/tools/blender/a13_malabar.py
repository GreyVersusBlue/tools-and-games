"""A13 a harbour in the monsoon: a green tropical shore under a huge bank of
monsoon cloud, storm light with one break of light on the water, wide
lens. Rain in grey curtains out to sea, coconut palms bent in the wind, a
beach with sewn-plank boats hauled up above the surf, wooden warehouses
with steep thatched roofs, sacks under cover. Far out at anchor one very
large Chinese junk.

    blender -b --factory-startup -P scripts/a13_malabar.py -- --preview

The coast faces west; the wind comes off the sea (from +Y), bending the
palms inland. The break of light is a soft spot of sun falling through a
gap in the cloud onto the water.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import kit_plants as PL     # noqa: E402
import kit_props as P       # noqa: E402
import kit_ships as S       # noqa: E402
import kit_terrain as T     # noqa: E402
import kit_models as KM     # noqa: E402
import bpy                  # noqa: E402
import numpy as np          # noqa: E402

CAM = (-24.0, 4.0, 2.6)
LOOK = (270.0, 250.0, 16.0)
EXPOSURE = 0.9
GAP = (470.0, 900.0)        # where the break of light falls on the sea


def shore_y(X):
    return 26.0 + 0.55 * X + 6.0 * np.sin(X / 40.0)


def ground_fn(X, Y):
    d = Y - shore_y(X)            # >0 at sea
    sea = -0.3 - 0.05 * np.maximum(d, 0)
    land = 0.06 * np.maximum(-d, 0) + 0.3 * T.fbm(X, Y, 30.0, 3, 131)
    land = np.minimum(land, 3.5) + 0.8 * T.fbm(X, Y, 120.0, 3, 132) * np.clip(-d / 60.0, 0, 1)
    # green hills rising behind the coastal strip
    land += 70.0 * np.clip((-d - 220.0) / 500.0, 0, 1) ** 1.3 * (0.6 + 0.4 * T.fbm(X, Y, 300.0, 4, 133))
    return np.where(d > 0, sea, land)


def warehouse(name, x, y, z, w, d, h, rot):
    """A wooden warehouse on a low plinth: plank walls, a steep thatched
    gable roof with deep eaves."""
    plank = C.M("plank_hull", colour=(0.30, 0.22, 0.15), plank=0.3)
    thatch = C.M("thatch", scale=0.8)
    parts = [C.box_mesh(name + "_plinth", (w + 0.6, d + 0.6, 0.6), (0, 0, 0.3), C.M("rock", scale=0.4)),
             C.box_mesh(name + "_walls", (w, d, h), (0, 0, 0.6 + h / 2), plank)]
    rh = d * 0.55
    ov = 1.0
    verts = [(-w / 2 - ov, -d / 2 - ov, 0.6 + h - 0.5), (w / 2 + ov, -d / 2 - ov, 0.6 + h - 0.5),
             (w / 2 + ov, 0, 0.6 + h + rh), (-w / 2 - ov, 0, 0.6 + h + rh),
             (-w / 2 - ov, d / 2 + ov, 0.6 + h - 0.5), (w / 2 + ov, d / 2 + ov, 0.6 + h - 0.5)]
    roof = C.mesh_object(name + "_roof", verts, [(0, 1, 2, 3), (3, 2, 5, 4)], thatch)
    sol = roof.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.35
    parts.append(roof)
    for sx in (-1, 1):
        g = C.mesh_object(name + "_gable%d" % sx, [(sx * w / 2, -d / 2, 0.6 + h), (sx * w / 2, d / 2, 0.6 + h),
                                                   (sx * w / 2, 0, 0.6 + h + rh - 0.3)], [(0, 1, 2)], plank)
        parts.append(g)
    door = C.box_mesh(name + "_door", (2.0, 0.1, 2.6), (0, -d / 2 - 0.03, 0.6 + 1.3), C.M("dark", colour=(0.02, 0.016, 0.012)))
    parts.append(door)
    return P.group(name, parts, (x, y, z), rot)


def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE)
    # a photographed sky of heavy cloud, darkened and cooled into a monsoon sky;
    # its sun, low among the clouds ahead, makes the one break of light
    sk = KM.sky_photo("mud_road_puresky", sun_turn=200.0, strength=0.55, tint=(0.52, 0.56, 0.58), contrast=0.5)
    # the one break of light: sun through a gap in the cloud, falling on a patch of sea
    ld = bpy.data.lights.new("Break", "SPOT")
    ld.energy = 1.2e9
    ld.spot_size = math.radians(7.0)
    ld.spot_blend = 1.0
    ld.shadow_soft_size = 40.0
    ld.color = (1.0, 0.93, 0.80)
    lo = bpy.data.objects.new("Break", ld)
    C.link(lo)
    gx, gy = GAP
    lo.location = (gx - 500.0, gy + 700.0, 1600.0)
    lo.rotation_euler = (C.Vector((gx, gy, 0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    C.haze(0.00030, (0.55, 0.58, 0.60), 0.3, extent=7000.0, top=900.0)
    gob, Z = T.heightfield("Shore", -1500, 2500, -400, 4500, 420, 520, ground_fn, None, py=1.6)
    # ground: green on land, wet dark sand by the water
    b = C._NB("shore_green")
    geo = b.n("ShaderNodeNewGeometry")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Position"], sep.inputs[0])
    nz = b.noise(b.coords(1.0), 0.15, 5, 0.6)
    grass = b.ramp(nz.outputs["Fac"], (0.05, 0.10, 0.03), (0.10, 0.16, 0.05), 0.3, 0.7)
    diff, nor_, rough_, disp_ = C._tex_paths("sand_01")
    st = b.n("ShaderNodeTexImage")
    st.image = C._img(diff)
    st.projection = "BOX"
    b.link(b.coords(0.4), st.inputs["Vector"])
    sand = b.mix(1.0, st.outputs["Color"], (0.62, 0.52, 0.40), "MULTIPLY")
    land = b.mix(b.band(sep.outputs["Z"], 0.6, 1.6), sand, grass.outputs[0])
    col = b.mix(b.band(sep.outputs["Z"], -0.1, 0.25), (0.16, 0.13, 0.10), land)
    b.link(col, b.bsdf.inputs["Base Color"])
    # wet: the beach and grass glisten a little
    b.link(b.mix(b.band(sep.outputs["Z"], 0.4, 1.4), (0.42, 0.42, 0.42), (0.75, 0.75, 0.75)), b.bsdf.inputs["Roughness"])
    gob.data.materials.append(b.m)
    h = lambda x, y: T.sample(Z, gob, x, y)
    # the sea: a real wind sea near, a rippled plane beyond it to the horizon
    T.ocean("Sea", tile=160.0, repeat=14, res=12, waves=0.9, chop=1.3, wind=16.0, seed=13, foam=0.12,
            mat=T.ocean_water(colour=(0.015, 0.032, 0.034), foam_gain=0.9), loc=(0.0, 700.0, -0.1))
    C.box_mesh("SeaFar", (14000, 14000, 0.02), (0, 3000, -0.35),
               C.M("rippled_water", colour=(0.018, 0.030, 0.030), rough=0.12, ripple=1.6, stretch=1.3))
    # surf: broken white foam along the waterline
    foam = C._NB("foam")
    fz = foam.noise(foam.coords(1.0), 0.8, 4, 0.6)
    fm = foam.ramp(fz.outputs["Fac"], (0, 0, 0), (0.8, 0.8, 0.8), 0.55, 0.68)
    foam.link(fm.outputs[0], foam.bsdf.inputs["Alpha"])
    foam.set(Base_Color=(0.75, 0.77, 0.78), Roughness=0.6)
    for k, off in enumerate(()):        # surf strips read as painted lines; left out
        xs = np.linspace(-600, 1200, 300)
        verts, faces = [], []
        for i, x in enumerate(xs):
            y = float(shore_y(np.array([x]))[0]) + off
            wob = 1.5 * math.sin(x / 13.0 + k * 2.0)
            verts += [(x, y - 0.5 + wob, 0.0 + 0.01 * k), (x, y + 0.5 + wob, 0.0 + 0.01 * k)]
            if i:
                a = 2 * (i - 1)
                faces.append((a, a + 2, a + 3, a + 1))
        C.mesh_object("Surf%d" % k, verts, faces, foam.m)
    # cloud bank: a towering wall of cloud far out to sea, and rain curtains
    for k, (cx, cy) in enumerate(((-900, 1900), (500, 2300), (1500, 1700))):
        T.streak_volume("Rain%d" % k, (cx - 260, cy - 120, -5), (cx + 260, cy + 120, 700), 0.006, (0.50, 0.52, 0.54),
                        streak=(0, 0, 1), scale=0.02, thresh=0.45, anis=0.0)
    r = C.rng(1313)
    # palms bent by the wind off the sea
    for k in range(34):
        x = r.uniform(20, 420)
        y = float(shore_y(np.array([x]))[0]) - r.uniform(14, 90)
        if (x - 10) ** 2 + (y + 12) ** 2 < 40 ** 2:
            continue
        p = PL.coconut_palm_fine("Palm%d" % k, r.uniform(11, 18), lean=(r.uniform(-0.05, 0.05), -r.uniform(0.15, 0.3)),
                                 bend=0.12, salt=1320 + k, wind=(0.0, -0.9))
        p.location = (x, y, h(x, y) - 0.2)
    # dense green coastal trees behind the palms, and woods over the hills
    for k in range(70):
        x = r.uniform(-40, 520)
        y = float(shore_y(np.array([x]))[0]) - r.uniform(45, 160)
        KM.place(["island_tree_01", "island_tree_02", "island_tree_03"][k % 3], (x, y, h(x, y) - 0.3),
                 r.uniform(0, 6.28), r.uniform(1.4, 2.4), name="Coast%d" % k)
    # low bushes and young trees over the grass between beach and woods
    KM.scatter("island_tree_03", 700, (-10, 700, -260, 260), h, 1395, scale=(0.5, 1.2),
               avoid=lambda x, y: y > float(shore_y(np.array([x]))[0]) - 22 or (x + 24) ** 2 + (y - 4) ** 2 < 900,
               name="Bush")
    KM.scatter("island_tree_02", 260, (-300, 1400, -500, 200), h, 1390, scale=(2.0, 3.2),
               avoid=lambda x, y: y > float(shore_y(np.array([x]))[0]) - 160, name="Wood")
    # sewn-plank boats hauled up above the surf
    for k in range(5):
        x = 30.0 + k * 22.0 + r.uniform(-4, 4)
        y = float(shore_y(np.array([x]))[0]) - 10.0
        bt = S.dhow("Boat%d" % k, r.uniform(9, 13), rig="bare", sewn=True)
        bt.location = (x, y, h(x, y) + 0.7)
        bt.rotation_euler = (math.radians(3), math.radians(-4), math.radians(70 + r.uniform(-10, 10)))
    # warehouses and a covered stack of sacks
    for k in range(4):
        x = 120.0 + k * 45.0
        y = float(shore_y(np.array([x]))[0]) - 50.0
        warehouse("Warehouse%d" % k, x, y, h(x, y) - 0.3, r.uniform(14, 20), r.uniform(9, 12), 3.6,
                  math.radians(29) + r.uniform(-0.1, 0.1))
    sx = 95.0
    sy = float(shore_y(np.array([sx]))[0]) - 34.0
    for k in range(16):
        sb = P.block("Sack%d" % k, (0.9, 0.55, 0.5), C.M("hessian", colour=(0.42, 0.34, 0.25)), chip=0.15, salt=1340 + k)
        sb.location = (sx + (k % 4) * 0.95, sy + (k // 4 % 2) * 0.6, h(sx, sy) + 0.5 * (k // 8))
    warehouse("Cover", sx + 1.5, sy + 0.3, h(sx, sy) - 0.6, 6.5, 4.5, 0.6, math.radians(29))
    # far out at anchor: the junk
    j = S.junk("Junk", 58.0, masts=4)
    j.location = (520.0, 1500.0, 0.0)
    j.rotation_euler = (0, 0, math.radians(160))
    for k, (x, y) in enumerate(((150, 1300), (520, 1900))):
        d = S.dhow("Anchored%d" % k, 17.0, rig="furled")
        d.location = (x, y, 0)
        d.rotation_euler = (0, 0, math.radians(r.uniform(0, 360)))
    cam = C.camera("wide", CAM, LOOK)
    return cam


def main():
    C.parse_args()
    build()
    C.save_still("malabar-harbour")
    C.write_log("a13")


main()
