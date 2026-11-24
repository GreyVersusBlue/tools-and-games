"""A01 (and A02): the merchant's low writing table, seen from above.

    blender -b --factory-startup -P scripts/a01_desk.py -- --preview [--light day|dusk|night]

--light day   -> desk-day     (A01)
--light dusk  -> desk-dusk    (A02)
--light night -> desk-night   (A02)
The scene and camera are identical for all three; only the light changes.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_props as P       # noqa: E402
import kit_arch as A        # noqa: E402

# ---- layout constants (metres) -------------------------------------------
TABLE_W, TABLE_D, TABLE_T = 1.04, 0.70, 0.035
TABLE_Z = 0.30                      # low table, the merchant sits on the floor
WALL_Y = TABLE_D / 2 + 0.34         # inside face of the window wall
WIN = (-0.80, 0.10, 0.80, 1.95)     # window opening x0, z0, x1, z1 (low sill)
CAM_TARGET = (0.0, 0.09, TABLE_Z)
CAM_DIST = 1.80
CAM_DOWN = 57.0
FSTOP = 3.2

EXPOSURE = {"day": -1.6, "dusk": 0.0, "night": 0.4}
LAMP_GLOW = 30.0                    # lit lamp, watts; lights the middle of the table at night
SUN_TURN = 18.0                     # sun beyond the window, a little to the right


def light_setup(light):
    if light == "day":
        C.sky("day", sun_turn=SUN_TURN)
    elif light == "dusk":
        # the preset's 2.2 degree sun would pass over the table and land on
        # the back wall; raised to 9 so the lattice shadows run long across
        # the top, tinted to keep the dusk colour
        C.sky("dusk", sun_turn=SUN_TURN + 6.0, elev=10.0, tint=(1.0, 0.62, 0.40))
    else:
        C.sky("moon", sun_turn=SUN_TURN - 20.0)


def sky_card(light):
    """Bright sky seen through the lattice. The camera looks down, so through
    the window it would see the street; this card, visible to the camera
    only, stands in for open sky. It casts no light."""
    col = {"day": ((0.80, 0.88, 1.0), 18.0), "dusk": ((1.0, 0.62, 0.36), 6.0),
           "night": ((0.30, 0.40, 0.70), 1.1)}[light]
    ob = C.box_mesh("SkyCard", (4.0, 0.01, 3.0), (0, WALL_Y + 1.2, 1.0))
    m = C._NB("skycard")
    m.nt.nodes.remove(m.bsdf)
    em = m.n("ShaderNodeEmission", Strength=col[1])
    em.inputs["Color"].default_value = (*col[0], 1)
    # a little gradient: brighter low (toward the sun side)
    m.link(em.outputs[0], m.out.inputs["Surface"])
    ob.data.materials.append(m.m)
    ob.visible_shadow = False
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    return ob


def build(light):
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=EXPOSURE[light])

    # room: floor of worn stone, plaster walls, low window in the north wall
    A.room(-1.6, 1.6, -1.5, WALL_Y, 3.2, C.M("lime_plaster"), floor_mat=C.M("limestone", scale=0.6),
           window=("N", WIN[0] + 1.6, WIN[1], WIN[2] + 1.6, WIN[3]), thick=0.30)
    scr = A.lattice_screen("Lattice", WIN[2] - WIN[0], WIN[3] - WIN[1], cell=0.055, bar=0.0065)
    scr.location = (0, WALL_Y + 0.12, WIN[1])
    light_setup(light)
    sky_card(light)
    C.haze(0.035 if light == "day" else 0.02, (0.95, 0.88, 0.76), 0.55,
           box=((-1.5, -1.4, 0.0), (1.5, WALL_Y - 0.02, 2.4)))

    # carpet under the table, its edge showing between table and wall
    car = C.box_mesh("Carpet", (1.9, 1.5, 0.008), (0.0, -0.05, 0.004),
                     C.M("carpet", c1=(0.30, 0.07, 0.05), c2=(0.06, 0.07, 0.15), c3=(0.55, 0.40, 0.17),
                         field=(0.34, 0.09, 0.06)))
    car["half_x"] = 0.95
    car["half_y"] = 0.75

    # the table: thick top with inlay border, four short turned legs
    top = C.box_mesh("TableTop", (TABLE_W, TABLE_D, TABLE_T), (0, 0, TABLE_Z - TABLE_T / 2),
                     C.M("walnut_inlay", half_x=TABLE_W / 2, half_y=TABLE_D / 2))
    C.bevel(top, 0.004, 3)
    apron = C.box_mesh("Apron", (TABLE_W - 0.08, TABLE_D - 0.08, 0.07), (0, 0, TABLE_Z - TABLE_T - 0.035), "walnut")
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = C.lathe("Leg", [(0, 0), (0.032, 0), (0.034, 0.02), (0.026, 0.06), (0.03, 0.12),
                                  (0.024, 0.18), (0.03, TABLE_Z - TABLE_T - 0.07), (0, TABLE_Z - TABLE_T - 0.07)],
                          16, "walnut")
            leg.location = (sx * (TABLE_W / 2 - 0.07), sy * (TABLE_D / 2 - 0.07), 0.008)

    z = TABLE_Z
    put = lambda ob, x, y, rz=0.0: P.place(ob, (x, y, z), math.radians(rz))

    # LEFT: open ledger along the left edge
    put(P.ledger("Ledger", 0.30, 0.21), -0.385, -0.05, 86)
    # TOP LEFT: balance scale and its weights
    put(P.balance_scale("Scale", 0.20), -0.27, 0.235, 8)
    put(P.weights_row("Weights", 6), -0.10, 0.285, 4)
    # TOP, left of centre: inkwell and two reed pens
    put(P.inkwell("Inkwell"), 0.03, 0.27)
    put(P.reed_pen("Reed1", 0.21, salt=61), 0.13, 0.285, 6)
    put(P.reed_pen("Reed2", 0.19, salt=62), 0.12, 0.262, 1)
    # TOP RIGHT: oil lamp (unlit by day and dusk, lit at night)
    put(P.oil_lamp("Lamp", lit=(light == "night"), glow=LAMP_GLOW), 0.37, 0.235, 200)
    # RIGHT: folded letters tied with thread
    put(P.letter_packet("Letter1", salt=91), 0.405, 0.03, 84)
    put(P.letter_packet("Letter2", salt=92, thread=(0.45, 0.20, 0.12)), 0.42, -0.07, 97)
    l3 = P.letter_packet("Letter3", salt=93)
    put(l3, 0.39, -0.02, 78)
    l3.location.z += 0.0042
    # BOTTOM LEFT: coins
    put(P.coin_stack("Gold", "gold", 8, salt=11), -0.205, -0.235)
    put(P.coin_stack("Silver", "silver", 26, salt=12), -0.15, -0.242)
    put(P.coin_scatter("LooseCoins", [("silver", 4), ("gold", 2)], (0.05, 0.03), salt=13), -0.10, -0.232)
    # BOTTOM RIGHT: prayer beads and a small brass bowl
    put(P.prayer_beads("Beads"), 0.29, -0.225, 15)
    put(P.bowl("SmallBowl", 0.045, 0.028, mat="brass", salt=14), 0.405, -0.195)

    cam = C.tilt_camera("table", CAM_TARGET, CAM_DIST, CAM_DOWN, fstop=FSTOP)
    # focus a little nearer than centre so the far edge falls soft
    cam.data.dof.focus_distance = CAM_DIST - 0.06
    return cam


def main():
    C.parse_args(lambda p: p.add_argument("--light", default="day", choices=["day", "dusk", "night"]))
    build(C.ARGS.light)
    C.save_still({"day": "desk-day", "dusk": "desk-dusk", "night": "desk-night"}[C.ARGS.light])
    C.write_log("a01-" + C.ARGS.light)


main()
