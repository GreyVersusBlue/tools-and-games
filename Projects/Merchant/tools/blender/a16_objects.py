"""A16 objects: the pieces of paper, coins and seals the game lays on the
desk as cards, each seen straight down on a transparent ground.

    blender -b --factory-startup -P scripts/a16_objects.py -- --preview --obj letter-sealed
    blender -b --factory-startup -P scripts/a16_objects.py -- --final --obj all

Light: as on A01's desk by day. The sun there stands beyond the window at
the top of the picture, a little to the right; here a soft window light from
the same direction, so every shadow falls down and a little to the left.
Camera: the `long` lens straight down from far enough to frame the object;
the frame is fitted to each object's own size and shape.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_props as P       # noqa: E402
import bpy                  # noqa: E402
from mathutils import Vector  # noqa: E402

LIGHT_AZ = 18.0             # same azimuth as A01's sun (a01_desk.SUN_TURN)
LIGHT_ELEV = 42.0
EXPOSURE = -1.3
PAPER = (0.80, 0.68, 0.48)          # the pale, even sheet the game writes on
PAPER_LETTER = (0.78, 0.66, 0.46)

# shipped longest side in pixels, from ART.md
SIZES = {"letter-sealed": 600, "letter-open": 1200, "sheet-blank": 1600, "contract": 1200,
         "ledger-open": 1600, "coins-few": 400, "coins-some": 400, "coins-many": 400}
SEALS = {"seal-%d" % (i + 1): k for i, k in enumerate(P.DEVICES)}
SIZES.update({k: 256 for k in SEALS})
SQUARE = {"coins-few", "coins-some", "coins-many"} | set(SEALS)


def letter_sealed():
    pk = P.letter_packet("Packet", w=0.11, d=0.045, salt=91)
    # the stamped mark on the fold, between the two ties
    P.device("Stamp", "rosette", 0.0072, 0.00003, C.M("stamp_ink"), z0=0.0041).location.x = 0.004


def _sheet(name, w, d, mat, folds, salt):
    """Handmade sheet with fold lines: creases across (folds) and one down
    the middle, from being folded into a packet."""
    sh = P.sheet(name, w=w, d=d, mat=mat, curl=0.0012, salt=salt, folds=folds)
    # a crease down the middle as well
    for v in sh.data.vertices:
        v.co.z += 0.0006 * math.exp(-(v.co.x / 0.004) ** 2)
    return sh


def letter_open():
    m = C.M("paper", ink=True, tone=PAPER_LETTER, lines=58.0, ink_amt=0.34, line_rows=(0.36, 0.93))
    _sheet("LetterOpen", 0.16, 0.22, m, 3, 301)


def sheet_blank():
    m = C.M("paper", tone=PAPER, mottle=0.45)
    _sheet("SheetBlank", 0.16, 0.22, m, 3, 302)


def contract():
    W, D = 0.15, 0.32
    m = C.M("paper", ink=True, tone=PAPER_LETTER, lines=58.0, ink_amt=0.32, line_rows=(0.22, 0.93))
    _sheet("Contract", W, D, m, 4, 303)
    # four small stamped marks in a row at the foot: the witnesses
    for i, k in enumerate(("star", "knot", "wheel", "lozenge")):
        x = (i - 1.5) * 0.030
        P.device("Witness%d" % i, k, 0.0095, 0.00003, C.M("stamp_ink"), z0=0.0022).location = (x, -D / 2 + 0.034, 0.0022)


def ledger_open():
    P.ledger("LedgerOpen", 0.32, 0.22, rows=((0.80, 0.92), (0.98, 0.99)), rule=0.55,
             tone=(0.78, 0.66, 0.46), ink_amt=(0.30, 0.0))


def _coins(spec, salt):
    r = C.rng(salt)
    for i, (kind, metal, n, x, y) in enumerate(spec):
        if kind == "stack":
            s = P.coin_stack("Stack%d" % i, metal, n, salt=salt + i)
        else:
            s = P.coin_scatter("Loose%d" % i, [(metal, n)], (0.045, 0.035), salt=salt + i)
        s.location = (x, y, 0)


def coins_few():
    _coins([("loose", "gold", 2, -0.006, 0.006), ("loose", "silver", 3, 0.010, -0.008)], 401)


def coins_some():
    _coins([("stack", "gold", 4, -0.016, 0.010), ("stack", "silver", 7, 0.012, 0.014),
            ("loose", "gold", 3, -0.010, -0.016), ("loose", "silver", 4, 0.016, -0.012)], 411)


def coins_many():
    _coins([("stack", "gold", 9, -0.024, 0.016), ("stack", "gold", 6, -0.002, 0.026),
            ("stack", "silver", 14, 0.022, 0.014), ("stack", "silver", 10, 0.030, -0.012),
            ("loose", "gold", 7, -0.016, -0.014), ("loose", "silver", 8, 0.006, -0.020),
            ("loose", "gold", 3, -0.034, -0.002)], 421)


BUILD = {"letter-sealed": letter_sealed, "letter-open": letter_open, "sheet-blank": sheet_blank,
         "contract": contract, "ledger-open": ledger_open, "coins-few": coins_few,
         "coins-some": coins_some, "coins-many": coins_many}


def _bounds():
    bpy.context.view_layer.update()
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.context.scene.objects:
        if ob.type not in {"MESH", "CURVE"} or ob.name.startswith("ShadowCatcher"):
            continue
        ev = ob.evaluated_get(dg)
        if ob.type == "CURVE":
            # a curve's bound_box is not reliable here: use its points
            r = ob.data.bevel_depth
            pts = [Vector(pt.co[:3]) for sp in ob.data.splines for pt in sp.points]
            pts = [ob.matrix_world @ (q + Vector(o)) for q in pts for o in ((r, r, r), (-r, -r, -r))]
        else:
            pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
        for p in pts:
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def frame(name):
    """Fit render size and camera to the object: a margin all round, more
    at the bottom and left where the shadow falls."""
    lo, hi = _bounds()
    w, d = hi.x - lo.x, hi.y - lo.y
    sh = max(0.004, (hi.z - lo.z) / math.tan(math.radians(LIGHT_ELEV)))   # shadow length
    m = 0.05 * max(w, d)
    x0, x1 = lo.x - m - sh * 0.35, hi.x + m
    y0, y1 = lo.y - m - sh, hi.y + m
    if name in SQUARE:
        cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0)
        x0, x1, y0, y1 = cx - s / 2, cx + s / 2, cy - s / 2, cy + s / 2
    fw, fh = x1 - x0, y1 - y0
    L = SIZES[name]
    if fw >= fh:
        ship = (L, max(2, int(round(L * fh / fw / 2)) * 2))
    else:
        ship = (max(2, int(round(L * fw / fh / 2)) * 2), L)
    C.setup_render(ship[0] * 2, ship[1] * 2, transparent=True, exposure=EXPOSURE)
    lens = C.LENSES["long"]["mm"]
    dist = fw * lens / 36.0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    C.camera("long", (cx, cy, dist), (cx, cy, 0.0))
    return ship


def build(name):
    C.reset()
    C.setup_render(64, 64, transparent=True, exposure=EXPOSURE)     # replaced in frame()
    C.window_light(az=LIGHT_AZ, elev=LIGHT_ELEV, dist=1.6, size=(0.8, 0.6), energy=110.0, fill=0.35)
    if name in SEALS:
        P.clay_seal("Seal", SEALS[name], salt=500 + list(SEALS).index(name))
    else:
        BUILD[name]()
    ship = frame(name)
    C.shadow_catcher(2.0, 0.0)
    return ship


def main():
    names = list(SIZES)
    C.parse_args(lambda p: p.add_argument("--obj", default="letter-sealed", choices=names + ["all", "seals"]))
    todo = names if C.ARGS.obj == "all" else list(SEALS) if C.ARGS.obj == "seals" else [C.ARGS.obj]
    for n in todo:
        ship = build(n)
        C.save_cutout(n, ship, "object")
    C.write_log("a16-" + C.ARGS.obj)


main()
