"""Models kit (rework round): scanned CC0 models (Poly Haven, glTF 2k) and
CC0 sky photographs (HDRIs).

load(tid) imports a model once into a hidden library collection and returns
that collection; place(tid, loc, ...) puts an instance of it in the scene
(an empty pointing at the collection, so hundreds of trees cost little).
sky_photo(tid, sun_turn, ...) lights and backs the scene with a sky photo,
turned so its sun stands at the scene's sun azimuth.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

import common as C

MODELS = os.path.join(C.INPUTS, "models")
HDRI = os.path.join(C.INPUTS, "hdri")
_LIB = {}
C.RESET_HOOKS.append(_LIB.clear)


def load(tid):
    if tid in _LIB:
        return _LIB[tid]
    d = os.path.join(MODELS, tid)
    gl = next(f for f in os.listdir(d) if f.endswith(".gltf"))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, gl))
    new = [o for o in bpy.data.objects if o not in before]
    coll = bpy.data.collections.new("LIB_" + tid)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    # the library collection is not linked to the scene: only instances render
    _LIB[tid] = coll
    return coll


def size(tid):
    """Bounding size (x, y, z) of a model as imported."""
    coll = load(tid)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in coll.objects:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return hi - lo


def place(tid, loc, rot_z=0.0, scale=1.0, name=None, tilt=(0.0, 0.0)):
    coll = load(tid)
    e = bpy.data.objects.new(name or ("I_" + tid), None)
    e.instance_type = "COLLECTION"
    e.instance_collection = coll
    C.link(e)
    e.location = loc
    e.rotation_euler = (tilt[0], tilt[1], rot_z)
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    e.scale = s
    return e


def scatter(tid, n, region, height_fn, salt, scale=(0.8, 1.2), avoid=None, name=None):
    """Scatter n instances over region (x0, x1, y0, y1) on the ground."""
    r = C.rng(salt)
    out = []
    x0, x1, y0, y1 = region
    tries = 0
    while len(out) < n and tries < n * 20:
        tries += 1
        x, y = r.uniform(x0, x1), r.uniform(y0, y1)
        if avoid and avoid(x, y):
            continue
        out.append(place(tid, (x, y, height_fn(x, y) - 0.05), r.uniform(0, 6.283), r.uniform(*scale),
                         name="%s_%d" % (name or tid, len(out))))
    return out


# --------------------------------------------------------------------------
# sky photographs
# --------------------------------------------------------------------------
def _sun_angle(path):
    """Azimuth (radians, Blender world atan2(y, x)) and elevation of the
    brightest spot in an equirectangular image: the sun (or the moon)."""
    im = bpy.data.images.load(path, check_existing=True)
    w, h = im.size
    step = max(1, w // 512)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::step, ::step, :3]
    lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    j, i = np.unravel_index(int(np.argmax(lum)), lum.shape)
    hh, ww = lum.shape
    u = (i + 0.5) / ww
    v = (j + 0.5) / hh                     # pixels run bottom-up: v = 0 at the bottom
    elev = (v - 0.5) * math.pi
    # Blender equirect: u = atan2(dir.y, -dir.x) / (2 pi) + 0.5
    phi = (u - 0.5) * 2 * math.pi          # = atan2(y, -x)
    az = math.atan2(math.sin(phi), -math.cos(phi))   # = atan2(y, x)
    return az, elev


def sky_photo(tid, sun_turn=0.0, strength=1.0, tint=None, contrast=0.0, res=None):
    """World from a CC0 sky photo, rotated so the sun in it sits at the
    scene's sun azimuth (sun_turn, degrees from +Y toward +X, as in
    common.sky). tint multiplies its colour; contrast > 0 deepens it (for
    storms). Returns the sun's direction and elevation in the photo."""
    files = sorted(f for f in os.listdir(HDRI) if f.startswith(tid + "_"))
    if res:
        files = [f for f in files if ("_%s." % res) in f] or files
    path = os.path.join(HDRI, files[-1])
    az, elev = _sun_angle(path)
    want = math.atan2(math.cos(math.radians(sun_turn)), math.sin(math.radians(sun_turn)))   # atan2(y, x)
    rot = want - az
    s = bpy.context.scene
    w = bpy.data.worlds.new("World_" + tid)
    s.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, rot)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], env.inputs["Vector"])
    col = env.outputs["Color"]
    if contrast > 0:
        bc = nt.nodes.new("ShaderNodeBrightContrast")
        bc.inputs["Contrast"].default_value = contrast
        nt.links.new(col, bc.inputs["Color"])
        col = bc.outputs[0]
    if tint:
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(col, mx.inputs[6])
        mx.inputs[7].default_value = (*tint, 1)
        col = mx.outputs[2]
    nt.links.new(col, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    a = math.radians(sun_turn)
    sun_dir = Vector((math.sin(a) * math.cos(elev), math.cos(a) * math.cos(elev), math.sin(elev)))
    print("SKY %s: sun %.1f deg up in the photo, turned to %.0f" % (tid, math.degrees(elev), sun_turn))
    return {"dir": sun_dir, "elev": math.degrees(elev), "world": w, "bg": bg}
