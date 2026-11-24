"""Scratch check for A04: lay the shipped tokens on the shipped map, at the
size the game will show them, and save previews/token-composite.png.

    blender -b --factory-startup -P scripts/preview_tokens_on_map.py -- [--size 72]

Each token is placed where a moving piece might plausibly stand, using the
stop positions in out/map-cairo-geo.json.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import bpy          # noqa: E402

# token, the stop it travels from, the stop it travels to, fraction of the way
PLACES = [
    ("caravan", "Cairo", "Awjila", 0.45),
    ("caravan", "Gao", "Tuat", 0.35),
    ("nileboat", "Cairo", "Qus", 0.5),
    ("dhow", "Jeddah", "Aden", 0.45),
    ("galley", "Alexandria", "Venice", 0.4),
    ("mules", "Aleppo", "Tabriz", 0.45),
]


def load(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(im)
    return a


def resize(a, size):
    """Box-filter shrink to size x size (token images are square)."""
    h, w = a.shape[:2]
    f = w // size
    a = a[: size * f, : size * f]
    # premultiply so edges don't fringe
    p = a.copy()
    p[..., :3] *= p[..., 3:4]
    p = p.reshape(size, f, size, f, 4).mean((1, 3))
    out = p.copy()
    m = out[..., 3:4] > 1e-5
    out[..., :3] = np.where(m, out[..., :3] / np.maximum(out[..., 3:4], 1e-5), 0)
    return out


def main():
    C.parse_args(lambda p: p.add_argument("--size", type=int, default=72))
    size = C.ARGS.size
    js = json.load(open(os.path.join(C.OUT, "map-cairo-geo.json")))
    base = load(os.path.join(C.OUT, "map-cairo.webp"))
    for token, a_, b_, t in PLACES:
        path = os.path.join(C.OUT, "token-%s.webp" % token)
        if not os.path.exists(path):
            continue
        tk = resize(load(path), size)
        sa, sb = js["stops"][a_], js["stops"][b_]
        cx = sa["x"] + (sb["x"] - sa["x"]) * t
        cy = sa["y"] + (sb["y"] - sa["y"]) * t
        x0, y0 = int(cx - size / 2), int(cy - size / 2)
        reg = base[y0:y0 + size, x0:x0 + size]
        al = tk[..., 3:4]
        reg[..., :3] = reg[..., :3] * (1 - al) + tk[..., :3] * al
    out = bpy.data.images.new("composite", base.shape[1], base.shape[0], alpha=True)
    out.pixels.foreach_set(np.ascontiguousarray(base[::-1]).ravel())
    os.makedirs(C.PREVIEWS, exist_ok=True)
    out.filepath_raw = os.path.join(C.PREVIEWS, "token-composite.png")
    out.file_format = "PNG"
    out.save()
    print("COMPOSITE", out.filepath_raw)


main()
