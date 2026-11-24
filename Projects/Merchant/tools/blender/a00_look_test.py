"""A00 look test: one of each library material on a walnut table, lit
through a window. Renders look-test (day) and look-test-dusk.

    blender -b --factory-startup -P scripts/a00_look_test.py -- --preview [--light day|dusk|both]
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_props as P       # noqa: E402
import kit_arch as A        # noqa: E402

TABLE_Z = 0.75
EXPOSURE = {"day": -2.0, "dusk": 1.4}


def build(light):
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE[light])
    # room 3.2 x 3.0, window in the west wall, sill just above the table top
    A.room(-1.25, 1.95, -1.6, 1.4, 2.8, C.M("lime_plaster"), floor_mat=C.M("limestone", scale=0.5),
           window=("W", 1.0, TABLE_Z + 0.08, 2.4, 2.1))
    C.sky(light, sun_turn=-80.0)

    # table
    top = C.box_mesh("TableTop", (1.5, 0.95, 0.045), (0.1, 0.0, TABLE_Z - 0.0225), "walnut")
    C.bevel(top, 0.004, 3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            C.box_mesh("Leg", (0.06, 0.06, TABLE_Z - 0.045), (0.1 + sx * 0.68, sy * 0.4, (TABLE_Z - 0.045) / 2), "walnut")

    z = TABLE_Z
    put = lambda ob, x, y, rz=0.0: P.place(ob, (x, y, z), rz)

    # back row: blocks
    blocks = [("limestone", {}), ("striped_stone", dict(course=0.018)), ("mud_brick", {}),
              ("lime_plaster", {}), ("plain_wood", {}), ("ship_timber", {})]
    for i, (mname, kw) in enumerate(blocks):
        b = P.block("Blk_" + mname, (0.085, 0.07, 0.065), C.M(mname, **kw), salt=10 + i)
        put(b, -0.45 + i * 0.13, 0.30, 0.15 * ((i % 3) - 1))

    # middle row: metals, ceramics, glass, water
    put(P.bowl("BrassBowl", 0.075, 0.042, mat="brass"), -0.50, 0.08)
    put(P.bowl("CopperCup", 0.045, 0.05, mat="copper", salt=11), -0.33, 0.12)
    g = P.bowl("GlazedBowl", 0.07, 0.045, mat=C.M("glazed", colour=(0.42, 0.52, 0.42)), salt=12)
    put(g, -0.18, 0.06)
    put(P.liquid_in(0.07, 0.035, "sea_water", "SeaWater"), -0.18, 0.06)
    put(P.bottle("Bottle", mat="glass"), 0.0, 0.14)
    put(P.beaker("Beaker", mat=C.M("glass", colour=(0.90, 0.78, 0.55))), 0.10, 0.07)
    put(P.liquid_in(0.03, 0.05, "harbour_water", "HarbourWater", r_frac=0.86), 0.10, 0.07)
    put(P.jar("Jar", mat=C.M("glazed", colour=(0.12, 0.24, 0.36)), salt=13), 0.22, 0.16)
    put(P.coin_stack("GoldStack", "gold", 9, salt=1), 0.33, 0.08)
    put(P.coin_stack("SilverStack", "silver", 14, salt=2), 0.38, 0.13)
    put(P.coin_scatter("Coins", [("gold", 3), ("silver", 4)], (0.07, 0.04), salt=3), 0.46, 0.04)
    put(P.heap("Salt", 0.035, 0.02, mat="salt", salt=14), 0.56, 0.16)

    # front row: cloth, paper, leather, rope, sand, snow
    cloths = [("linen", {}), ("wool", {}), ("silk", dict(colour=(0.55, 0.05, 0.06))),
              ("silk", dict(colour=(0.85, 0.62, 0.12))), ("sailcloth", {}), ("hessian", {})]
    for i, (mname, kw) in enumerate(cloths):
        c = P.folded_cloth("Cloth_%d" % i, 0.10, 0.075, 3, 0.007, C.M(mname, **kw), salt=20 + i)
        put(c, -0.52 + i * 0.115, -0.12, 0.1 * ((i % 2) - 0.5))
    lea = P.folded_cloth("Leather", 0.10, 0.07, 1, 0.003, C.M("leather"), salt=30)
    put(lea, 0.18, -0.10, 0.3)
    s = P.sheet("Paper", 0.15, 0.20, C.M("paper", ink=True, lines=40.0, line_rows=(0.3, 0.9)), salt=31)
    put(s, 0.36, -0.14, -0.18)
    put(P.rope_coil("Rope", 0.055, 4.0, 0.008, salt=32), 0.56, -0.08)
    put(P.heap("Sand", 0.05, 0.022, mat="sand", salt=33, lumps=0.04), -0.38, -0.33)
    put(P.heap("Snow", 0.045, 0.03, mat="snow", salt=34), -0.22, -0.33)
    car = C.box_mesh("Carpet", (0.36, 0.16, 0.004), (0, 0, 0.002), C.M("carpet"))
    car["half_x"] = 0.18
    car["half_y"] = 0.08
    put(car, 0.05, -0.33, 0.0)
    put(P.balance_scale("Scale", 0.16), 0.40, -0.34, 0.1)

    # camera: front, ~38 degrees down, table lens
    cam = C.tilt_camera("table", (0.04, -0.02, TABLE_Z), 1.85, 44.0, heading_deg=0.0, fstop=5.6)
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--light", default="both", choices=["day", "dusk", "both"]))
    lights = ["day", "dusk"] if C.ARGS.light == "both" else [C.ARGS.light]
    for lt in lights:
        build(lt)
        C.save_still("look-test" if lt == "day" else "look-test-dusk")
    C.write_log("a00")


main()
