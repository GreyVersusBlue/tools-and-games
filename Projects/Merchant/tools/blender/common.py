"""Merchant art: the shared setup every picture uses.

PINNED BLENDER VERSION: 5.3  (built and tested on Blender 5.3.0, Steam build,
2026-11-10). ART.md asked for 5.2 LTS; the Steam copy on this machine had
already updated to 5.3 and no 5.2 install was present, so 5.3 is pinned.
Every script refuses to run on any other major.minor.

Run a picture headless:
    blender -b --factory-startup -P scripts/<script>.py -- --preview
    blender -b --factory-startup -P scripts/<script>.py -- --final

Holds: version check, argument parsing, scene reset, one seeded random
source, Cycles + GPU setup, the colour transform, sky and sun presets, haze,
lenses, the materials library, mesh helpers, and the two savers.
"""
import argparse
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

PINNED = (5, 3)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INPUTS = os.path.join(ROOT, "inputs")
TEX = os.path.join(INPUTS, "tex")
MASTERS = os.path.join(ROOT, "masters")
SCRATCH = os.path.join(ROOT, "masters", "preview")   # preview renders, never shipped
OUT = os.path.join(ROOT, "out")
PREVIEWS = os.path.join(ROOT, "previews")
REPORTS = os.path.join(ROOT, "reports")

# One contrast look, chosen in batch 1 (look test) and then never changed.
LOOK = "AgX - Medium High Contrast"

SEED = 1324          # the year Mansa Musa came through Cairo
FINAL_SAMPLES = 512
PREVIEW_SAMPLES = 64

STILL_MASTER = (2560, 1440)
STILL_SHIP = (1920, 1080)
STILL_MAX_BYTES = 400 * 1024

ARGS = None
RNG = random.Random(SEED)
RESET_HOOKS = []   # kits register cache-clearing functions here


# --------------------------------------------------------------------------
# version, arguments, reset
# --------------------------------------------------------------------------
def check_version():
    v = bpy.app.version[:2]
    if tuple(v) != PINNED:
        sys.stderr.write("\n*** Merchant scripts are pinned to Blender %d.%d; this is %d.%d. "
                         "Refusing to run. ***\n\n" % (PINNED + tuple(v)))
        sys.exit(2)


def parse_args(extra=None):
    """extra: function(parser) that adds the script's own options."""
    global ARGS
    check_version()
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group()
    g.add_argument("--preview", action="store_true", help="quarter size, 64 samples")
    g.add_argument("--final", action="store_true", help="full size, 512 samples")
    p.add_argument("--samples", type=int, default=0, help="override sample count")
    p.add_argument("--pct", type=int, default=0, help="preview only: override resolution percent")
    if extra:
        extra(p)
    ARGS = p.parse_args(argv)
    if not ARGS.final:
        ARGS.preview = True
    return ARGS


def reset():
    """Empty scene, fixed seed, fresh random source."""
    global RNG
    bpy.ops.wm.read_factory_settings(use_empty=True)
    RNG = random.Random(SEED)
    _MATS.clear()
    _IMAGES.clear()
    for h in RESET_HOOKS:
        h()
    return bpy.context.scene


def rng(salt=0):
    """A seeded random source. Same salt, same numbers, every run."""
    return random.Random(SEED * 7919 + salt)


# --------------------------------------------------------------------------
# Cycles, GPU, colour
# --------------------------------------------------------------------------
GPU_REPORT = {"type": None, "devices": []}


def enable_gpu():
    prefs = bpy.context.preferences
    cp = prefs.addons["cycles"].preferences
    chosen = None
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            cp.compute_device_type = kind
        except TypeError:
            continue
        try:
            cp.refresh_devices()
        except AttributeError:
            cp.get_devices()
        gpus = [d for d in cp.devices if d.type == kind]
        if gpus:
            chosen = kind
            for d in cp.devices:
                d.use = (d.type == kind)
            GPU_REPORT["devices"] = [d.name for d in gpus]
            break
    GPU_REPORT["type"] = chosen
    if not chosen:
        msg = "!!! NO GPU FOUND: rendering on the CPU. Say so in the report. !!!"
        print("\n" + "!" * len(msg) + "\n" + msg + "\n" + "!" * len(msg) + "\n")
        bpy.context.scene.cycles.device = "CPU"
    else:
        bpy.context.scene.cycles.device = "GPU"
        print("GPU:", chosen, GPU_REPORT["devices"])
    return chosen


def setup_render(width, height, transparent=False, exposure=0.0):
    s = bpy.context.scene
    try:
        s.render.engine = "CYCLES"
    except TypeError as e:
        raise SystemExit("Cycles not available: %s" % e)
    enable_gpu()
    c = s.cycles
    final = bool(ARGS and ARGS.final)
    c.samples = (ARGS.samples if ARGS and ARGS.samples else
                 (FINAL_SAMPLES if final else PREVIEW_SAMPLES))
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.01
    c.adaptive_min_samples = 32 if final else 16
    c.use_denoising = True
    try:
        c.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    c.denoising_use_gpu = True
    c.seed = SEED
    c.use_animated_seed = False
    c.max_bounces = 10
    c.diffuse_bounces = 4
    c.glossy_bounces = 6
    c.transmission_bounces = 10
    c.volume_bounces = 1
    c.transparent_max_bounces = 16
    c.sample_clamp_indirect = 8.0
    c.blur_glossy = 0.5
    s.render.resolution_x = width
    s.render.resolution_y = height
    s.render.resolution_percentage = 100 if final else (ARGS.pct if ARGS and ARGS.pct else 25)
    s.render.film_transparent = transparent
    # colour: AgX with the one chosen look
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = LOOK
    s.view_settings.exposure = exposure
    s.view_settings.gamma = 1.0
    s.display_settings.display_device = "sRGB"
    return s


# --------------------------------------------------------------------------
# sky and sun presets
# --------------------------------------------------------------------------
# elevation and azimuth in degrees. azimuth: 0 = sun in +Y (north of scene),
# 90 = sun in +X. Each scene may rotate the azimuth (sun_turn) to suit its
# window or view; the preset fixes elevation, colour and strength.
SKY_PRESETS = {
    "dawn":     dict(kind="sky", elev=4.0,  sky=0.35, sun_size=1.2, air=1.4, aerosol=2.2, ozone=1.0),
    "day":      dict(kind="sky", elev=34.0, sky=0.30, sun_size=1.4, air=1.0, aerosol=1.2, ozone=1.0),
    "late":     dict(kind="sky", elev=14.0, sky=0.32, sun_size=1.2, air=1.2, aerosol=2.0, ozone=1.0),
    "dusk":     dict(kind="sky", elev=2.2,  sky=0.40, sun_size=1.6, air=1.6, aerosol=3.0, ozone=1.2),
    "moon":     dict(kind="moon", elev=38.0, sky=0.012, sun=0.06, sun_size=0.6,
                     sun_col=(0.62, 0.72, 1.0), sky_col=(0.012, 0.018, 0.04)),
    "overcast": dict(kind="flat", elev=55.0, sky=0.9, sun=0.6, sun_size=30.0,
                     sun_col=(0.95, 0.97, 1.0), sky_col=(0.62, 0.66, 0.70), ground=(0.18, 0.17, 0.16)),
    "storm":    dict(kind="flat", elev=25.0, sky=0.35, sun=1.8, sun_size=6.0,
                     sun_col=(1.0, 0.92, 0.78), sky_col=(0.22, 0.25, 0.28), ground=(0.06, 0.06, 0.065)),
}


def sky(preset, sun_turn=0.0, strength=1.0, elev=None, tint=None):
    """Build the world for a preset. Returns a dict with the sun direction
    (unit vector pointing TOWARD the sun) and the preset.
    elev overrides the preset's sun elevation; use it only where the preset
    angle cannot work (token shadows that must stay in the cutout, dusk
    light that must clear a window sill) and say so in the report.
    tint multiplies the sky's colour (keeps a raised dusk sun orange)."""
    P = dict(SKY_PRESETS[preset])
    if elev is not None:
        P["elev"] = elev
    s = bpy.context.scene
    w = bpy.data.worlds.new("World_" + preset)
    s.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    elev = math.radians(P["elev"])
    az = math.radians(sun_turn)
    sun_dir = Vector((math.sin(az) * math.cos(elev), math.cos(az) * math.cos(elev), math.sin(elev)))

    if P["kind"] == "sky":
        st = nt.nodes.new("ShaderNodeTexSky")
        st.sky_type = "MULTIPLE_SCATTERING"
        st.sun_disc = True
        st.sun_size = math.radians(P["sun_size"])
        st.sun_intensity = 1.0
        st.sun_elevation = elev
        # measured in 5.3: sun_rotation is the sun's azimuth from +Y toward +X,
        # the same convention as sun_dir above
        st.sun_rotation = az % (2 * math.pi)
        st.altitude = 0.0
        st.air_density = P["air"]
        st.aerosol_density = P["aerosol"]
        st.ozone_density = P["ozone"]
        if tint:
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type = "RGBA"
            mx.blend_type = "MULTIPLY"
            mx.inputs["Factor"].default_value = 1.0
            nt.links.new(st.outputs[0], mx.inputs[6])
            mx.inputs[7].default_value = (*tint, 1)
            nt.links.new(mx.outputs[2], bg.inputs["Color"])
        else:
            nt.links.new(st.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = P["sky"] * strength
        sun_obj = None
    else:
        # flat gradient sky + a sun lamp
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        nt.links.new(tc.outputs["Generated"] if False else tc.outputs["Normal"], sep.inputs[0])
        nt.links.new(sep.outputs["Z"], ramp.inputs[0])
        sc = P["sky_col"]
        gc = P.get("ground", tuple(x * 0.3 for x in sc))
        ramp.color_ramp.elements[0].position = 0.45
        ramp.color_ramp.elements[0].color = (*gc, 1)
        ramp.color_ramp.elements[1].position = 0.75
        ramp.color_ramp.elements[1].color = (*sc, 1)
        # map Z (-1..1) to 0..1
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = -1
        mr.inputs["From Max"].default_value = 1
        nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
        nt.links.new(mr.outputs[0], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = P["sky"] * strength
        ld = bpy.data.lights.new("Sun_" + preset, "SUN")
        ld.energy = P["sun"] * strength
        ld.color = P["sun_col"]
        ld.angle = math.radians(P["sun_size"])
        sun_obj = bpy.data.objects.new("Sun_" + preset, ld)
        s.collection.objects.link(sun_obj)
        sun_obj.rotation_euler = sun_dir.to_track_quat("Z", "Y").to_euler()
    return {"dir": sun_dir, "preset": P, "sun": sun_obj, "world": w, "bg": bg}


def haze(density, colour=(0.85, 0.80, 0.72), anisotropy=0.3, box=None, extent=8000.0, top=1500.0):
    """Distance haze. box=None makes a large volume box round the origin
    (outdoor views: +-extent across, up to `top`, thinning with height).
    A world volume is not used: rays to the sky would cross infinite haze
    and the sky would go black. box=((x0,y0,z0),(x1,y1,z1)) makes a plain
    volume box instead (rooms, dust)."""
    s = bpy.context.scene
    if box is None:
        ob = box_mesh("Haze", (2 * extent, 2 * extent, top + 50), (0, 0, (top - 50) / 2))
        m = bpy.data.materials.new("Haze")
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        v = nt.nodes.new("ShaderNodeVolumePrincipled")
        v.inputs["Color"].default_value = (*colour, 1)
        v.inputs["Anisotropy"].default_value = anisotropy
        # thins with height: density * exp(-z / (top/4))
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        mz = nt.nodes.new("ShaderNodeMath")
        mz.operation = "MULTIPLY"
        nt.links.new(sep.outputs["Z"], mz.inputs[0])
        mz.inputs[1].default_value = -4.0 / top
        ex = nt.nodes.new("ShaderNodeMath")
        ex.operation = "EXPONENT"
        nt.links.new(mz.outputs[0], ex.inputs[0])
        dm = nt.nodes.new("ShaderNodeMath")
        dm.operation = "MULTIPLY"
        dm.use_clamp = False
        nt.links.new(ex.outputs[0], dm.inputs[0])
        dm.inputs[1].default_value = density
        nt.links.new(dm.outputs[0], v.inputs["Density"])
        nt.links.new(v.outputs[0], out.inputs["Volume"])
        ob.data.materials.append(m)
        ob.visible_shadow = False
        return ob
    (x0, y0, z0), (x1, y1, z1) = box
    ob = box_mesh("Haze", (x1 - x0, y1 - y0, z1 - z0),
                  ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    m = bpy.data.materials.new("Haze")
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    v = nt.nodes.new("ShaderNodeVolumePrincipled")
    v.inputs["Color"].default_value = (*colour, 1)
    v.inputs["Density"].default_value = density
    v.inputs["Anisotropy"].default_value = anisotropy
    nt.links.new(v.outputs[0], out.inputs["Volume"])
    ob.data.materials.append(m)
    ob.visible_shadow = False
    return ob


def window_light(az=-50.0, elev=40.0, dist=2.2, size=(1.4, 1.1), energy=180.0,
                 colour=(1.0, 0.95, 0.88), fill=0.18, fill_col=(0.80, 0.84, 0.92)):
    """Soft window light for still lifes and cutouts: a large area light
    standing where a window would be (az from +Y toward +X, like the sun),
    plus a dim cool room fill as the world. Returns the light object."""
    s = bpy.context.scene
    w = bpy.data.worlds.new("World_room")
    s.world = w
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*fill_col, 1)
    bg.inputs["Strength"].default_value = fill
    a, e = math.radians(az), math.radians(elev)
    d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
    ld = bpy.data.lights.new("Window", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = colour
    ob = bpy.data.objects.new("Window", ld)
    s.collection.objects.link(ob)
    ob.location = d * dist
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return ob


# --------------------------------------------------------------------------
# lenses and camera
# --------------------------------------------------------------------------
LENSES = {
    "wide":   dict(mm=24, fstop=None),
    "normal": dict(mm=40, fstop=None),
    "long":   dict(mm=85, fstop=None),
    "table":  dict(mm=50, fstop=2.8),     # shallow depth of field
}


def camera(lens, location, target, focus=None, fstop=None, name="Cam"):
    s = bpy.context.scene
    L = LENSES[lens]
    cd = bpy.data.cameras.new(name)
    cd.lens = L["mm"]
    cd.sensor_width = 36.0
    cd.sensor_fit = "HORIZONTAL"
    cd.clip_start = 0.01
    cd.clip_end = 1.0e5
    ob = bpy.data.objects.new(name, cd)
    s.collection.objects.link(ob)
    ob.location = Vector(location)
    d = Vector(target) - Vector(location)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    fs = fstop if fstop is not None else L["fstop"]
    if fs:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fs
        cd.dof.focus_distance = focus if focus else d.length
    s.camera = ob
    return ob


def tilt_camera(lens, target, distance, down_deg, heading_deg=0.0, **kw):
    """Camera looking at target from `distance`, pitched down_deg below the
    horizontal; heading 0 = camera stands south of target looking north."""
    a = math.radians(down_deg)
    h = math.radians(heading_deg)
    t = Vector(target)
    back = Vector((-math.sin(h), -math.cos(h), 0.0))
    loc = t + back * (distance * math.cos(a)) + Vector((0, 0, distance * math.sin(a)))
    return camera(lens, loc, t, **kw)


# --------------------------------------------------------------------------
# mesh helpers (kits use these)
# --------------------------------------------------------------------------
def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_object(name, verts, faces, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if mat:
        ob.data.materials.append(mat if isinstance(mat, bpy.types.Material) else M(mat))
    return ob


def from_bmesh(name, bm, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if mat:
        ob.data.materials.append(mat if isinstance(mat, bpy.types.Material) else M(mat))
    return ob


def box_mesh(name, size, center=(0, 0, 0), mat=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return from_bmesh(name, bm, mat)


def lathe(name, profile, segments=48, mat=None, smooth=True, cap_bottom=False, jitter=0.0, salt=0):
    """Revolve a list of (radius, z) points around Z. jitter adds a
    hand-made wobble to the radius (fraction of radius)."""
    r = rng(salt)
    ph = [r.uniform(0, 6.283) for _ in range(3)]
    verts, faces = [], []
    n = len(profile)
    for i in range(segments):
        a = 2 * math.pi * i / segments
        wob = 1.0 + jitter * (0.6 * math.sin(2 * a + ph[0]) + 0.3 * math.sin(3 * a + ph[1])
                              + 0.2 * math.sin(5 * a + ph[2]))
        for (rad, z) in profile:
            verts.append((rad * wob * math.cos(a), rad * wob * math.sin(a), z))
    for i in range(segments):
        j = (i + 1) % segments
        for k in range(n - 1):
            faces.append((i * n + k, j * n + k, j * n + k + 1, i * n + k + 1))
    if cap_bottom:
        c = len(verts)
        verts.append((0, 0, profile[0][1]))
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((j * n, i * n, c))
    return mesh_object(name, verts, faces, mat, smooth)


def add_mod(ob, kind, **props):
    m = ob.modifiers.new(kind.title(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def bevel(ob, width=0.002, segments=2):
    return add_mod(ob, "BEVEL", width=width, segments=segments, limit_method="ANGLE")


def subsurf(ob, levels=2):
    return add_mod(ob, "SUBSURF", levels=levels, render_levels=levels)


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=m.name)


def shadow_catcher(size=4.0, z=0.0):
    ob = box_mesh("ShadowCatcher", (size, size, 0.0001), (0, 0, z - 0.00005))
    ob.is_shadow_catcher = True
    return ob


# --------------------------------------------------------------------------
# materials library
# --------------------------------------------------------------------------
_MATS = {}
_IMAGES = {}


def _img(path, noncolor=False):
    key = (path, noncolor)
    if key in _IMAGES:
        return _IMAGES[key]
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    _IMAGES[key] = im
    return im


def _tex_paths(tid):
    d = os.path.join(TEX, tid)
    f = lambda t: os.path.join(d, "%s_%s_2k.jpg" % (tid, t))
    return f("diff"), f("nor"), f("rough"), f("disp")


class _NB:
    """Tiny node-builder for a material."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.nt = self.m.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.bsdf = self.nt.nodes.new("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs[0], self.out.inputs["Surface"])

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            if k.startswith("_"):
                setattr(node, k[1:], v)
            else:
                node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, **kw):
        for k, v in kw.items():
            key = k.replace("_", " ")
            inp = self.bsdf.inputs[key]
            if isinstance(v, (tuple, list)) and len(v) == 3 and inp.type == "RGBA":
                v = (*v, 1.0)
            inp.default_value = v

    def coords(self, scale=1.0, uv=False):
        tc = self.n("ShaderNodeTexCoord")
        mp = self.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        self.link(tc.outputs["UV" if uv else "Object"], mp.inputs["Vector"])
        return mp.outputs[0]

    def noise(self, vec, scale, detail=6.0, rough=0.55):
        nz = self.n("ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough)
        self.link(vec, nz.inputs["Vector"])
        return nz

    def ramp(self, src, a, b, pa=0.0, pb=1.0):
        r = self.n("ShaderNodeValToRGB")
        e = r.color_ramp.elements
        e[0].position, e[1].position = pa, pb
        e[0].color = (*a, 1) if len(a) == 3 else a
        e[1].color = (*b, 1) if len(b) == 3 else b
        self.link(src, r.inputs[0])
        return r

    def band(self, src, a, b):
        """0 below a, 1 above b, smooth between: for thresholds in real
        units (a colour ramp only takes positions 0..1)."""
        m = self.n("ShaderNodeMapRange", **{"From Min": a, "From Max": b})
        m.interpolation_type = "SMOOTHSTEP"
        m.clamp = True
        self.link(src, m.inputs["Value"])
        return m.outputs[0]

    def bump(self, height, strength=0.2, distance=0.002, normal=None):
        b = self.n("ShaderNodeBump", Strength=strength, Distance=distance)
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b

    def mix(self, fac, a, b, blend="MIX"):
        mx = self.n("ShaderNodeMix", _data_type="RGBA", _blend_type=blend)
        if isinstance(fac, (int, float)):
            mx.inputs["Factor"].default_value = fac
        else:
            self.link(fac, mx.inputs["Factor"])
        for slot, v in ((6, a), (7, b)):
            if isinstance(v, (tuple, list)):
                mx.inputs[slot].default_value = (*v, 1) if len(v) == 3 else v
            else:
                self.link(v, mx.inputs[slot])
        return mx.outputs[2]

    def math(self, op, a, b=0.0):
        m = self.n("ShaderNodeMath", _operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def pbr(self, tid, scale=1.0, tint=None, tint_amt=1.0, rough_add=0.0, rough_mul=1.0,
            nor_strength=1.0, bump_strength=0.0, uv=False, blend=0.25, sat=1.0, val=1.0,
            flat=None, weave=0.0):
        """Poly Haven texture set, box-projected on object coordinates.
        flat=(r,g,b) ignores the colour map and uses this colour (the cloth
        scans are near-solid colour; their weave lives in the height map).
        weave>0 darkens the colour in the hollows of the height map, so the
        weave reads in colour as well as in the shading."""
        diff, nor, rough, disp = _tex_paths(tid)
        vec = self.coords(scale, uv)

        def tex(path, noncolor):
            t = self.n("ShaderNodeTexImage")
            t.image = _img(path, noncolor)
            if not uv:
                t.projection = "BOX"
                t.projection_blend = blend
            self.link(vec, t.inputs["Vector"])
            return t

        td = tex(diff, False)
        col = td.outputs["Color"]
        if flat is not None:
            rgb = self.n("ShaderNodeRGB")
            rgb.outputs[0].default_value = (*flat, 1)
            col = rgb.outputs[0]
        if weave > 0:
            th = tex(disp, True)
            sh = self.ramp(th.outputs["Color"], (1 - weave,) * 3, (1.0, 1.0, 1.0), 0.15, 0.75)
            col = self.mix(1.0, col, sh.outputs[0], "MULTIPLY")
        if sat != 1.0 or val != 1.0:
            hsv = self.n("ShaderNodeHueSaturation", Saturation=sat, Value=val)
            self.link(col, hsv.inputs["Color"])
            col = hsv.outputs[0]
        if tint is not None:
            col = self.mix(tint_amt, col, tint, "MULTIPLY")
        self.link(col, self.bsdf.inputs["Base Color"])
        tr = tex(rough, True)
        r = self.math("MULTIPLY", tr.outputs["Color"], rough_mul)
        r = self.math("ADD", r, rough_add)
        self.link(r, self.bsdf.inputs["Roughness"])
        tn = tex(nor, True)
        nm = self.n("ShaderNodeNormalMap", Strength=nor_strength)
        self.link(tn.outputs["Color"], nm.inputs["Color"])
        nrm = nm.outputs[0]
        if bump_strength > 0:
            th = tex(disp, True)
            b = self.bump(th.outputs["Color"], bump_strength, 0.003, nrm)
            nrm = b.outputs[0]
        self.link(nrm, self.bsdf.inputs["Normal"])
        return td


def M(name, **kw):
    """Get a library material by name. Keyword options make a variant
    (colour etc.), cached by name + options."""
    key = (name, tuple(sorted(kw.items())))
    if key in _MATS:
        return _MATS[key]
    fn = LIBRARY[name]
    m = fn(**kw)
    m.name = name + ("_" + "_".join("%s%s" % (k, v) for k, v in sorted(kw.items())) if kw else "")
    _MATS[key] = m
    return m


# ---- woods ----------------------------------------------------------------
def _walnut(scale=1.2, val=0.85, sat=0.62, wear=True):
    """Walnut, oiled. Poly Haven 'dark_wood' grain, pulled from red toward
    walnut's cool chocolate brown."""
    b = _NB("walnut")
    b.pbr("dark_wood", scale=scale, rough_mul=0.8, rough_add=0.08,
          nor_strength=0.5, val=val, sat=sat, tint=(0.95, 1.0, 1.05))
    b.set(Coat_Weight=0.3, Coat_Roughness=0.3, Specular_IOR_Level=0.45)
    return b.m


def _walnut_inlay(half_x=0.5, half_y=0.34, band=(0.022, 0.062), period=0.06,
                  pale=(0.80, 0.70, 0.52), dark=(0.05, 0.035, 0.03)):
    """Walnut top with a geometric inlay band near its edge (object coords,
    top centred on the origin): two pale fillets and a row of lozenges in
    pale wood on a dark ground. Pure geometry, no script, no figures."""
    b = _NB("walnut_inlay")
    td = b.pbr("dark_wood", scale=1.2, rough_mul=0.8, rough_add=0.08, nor_strength=0.5,
               val=0.85, sat=0.62, tint=(0.95, 1.0, 1.05))
    base_col = b.bsdf.inputs["Base Color"].links[0].from_socket
    tc = b.n("ShaderNodeTexCoord")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(tc.outputs["Object"], sep.inputs[0])
    ax = b.math("ABSOLUTE", sep.outputs["X"])
    ay = b.math("ABSOLUTE", sep.outputs["Y"])
    dx = b.math("SUBTRACT", half_x, ax)
    dy = b.math("SUBTRACT", half_y, ay)
    d = b.math("MINIMUM", dx, dy)
    use_x = b.math("LESS_THAN", dy, dx)          # nearest edge is a long (top/bottom) edge
    # along-edge coordinate: x on long edges, y on short edges
    a1 = b.math("MULTIPLY", sep.outputs["X"], use_x)
    a2 = b.math("MULTIPLY", sep.outputs["Y"], b.math("SUBTRACT", 1.0, use_x))
    along = b.math("ADD", a1, a2)
    b0, b1 = band
    mid = (b0 + b1) / 2
    half = (b1 - b0) / 2
    inband = b.math("MULTIPLY", b.math("GREATER_THAN", d, b0), b.math("LESS_THAN", d, b1))
    fil = 0.0028
    f1 = b.math("LESS_THAN", b.math("ABSOLUTE", b.math("SUBTRACT", d, b0 + fil / 2)), fil / 2)
    f2 = b.math("LESS_THAN", b.math("ABSOLUTE", b.math("SUBTRACT", d, b1 - fil / 2)), fil / 2)
    ping = b.math("PINGPONG", along, period / 2)                 # 0..p/2..0
    u = b.math("DIVIDE", b.math("ABSOLUTE", b.math("SUBTRACT", ping, period / 4)), period / 4)
    v = b.math("DIVIDE", b.math("ABSOLUTE", b.math("SUBTRACT", d, mid)), half - fil * 1.6)
    loz = b.math("LESS_THAN", b.math("ADD", u, v), 0.82)
    pale_m = b.math("MAXIMUM", b.math("MAXIMUM", f1, f2), b.math("MULTIPLY", loz, inband))
    dark_m = b.math("MULTIPLY", inband, b.math("SUBTRACT", 1.0, pale_m))
    # pale inlay keeps a trace of grain
    bw = b.n("ShaderNodeRGBToBW")
    b.link(td.outputs["Color"], bw.inputs[0])
    pg = b.ramp(bw.outputs[0], tuple(x * 0.85 for x in pale), pale, 0.1, 0.5)
    col = b.mix(dark_m, base_col, dark)
    col = b.mix(pale_m, col, pg.outputs[0])
    b.link(col, b.bsdf.inputs["Base Color"])
    b.set(Coat_Weight=0.3, Coat_Roughness=0.3, Specular_IOR_Level=0.45)
    return b.m


def _plain_wood(scale=1.2, tint=(1.0, 0.92, 0.80), val=1.7):
    b = _NB("plain_wood")
    b.pbr("wood_table_worn", scale=scale, tint=tint, nor_strength=0.8, val=val, sat=0.8)
    return b.m


def _ship_timber(scale=0.8):
    b = _NB("ship_timber")
    b.pbr("weathered_planks", scale=scale, nor_strength=1.0, sat=0.6, val=1.5)
    return b.m


def _carved_wood(scale=3.0):
    """Dark hand-carved wood for playing pieces: walnut grain, oiled, rubbed
    lighter on the edges by handling (pointiness drives the wear)."""
    b = _NB("carved_wood")
    td = b.pbr("dark_wood", scale=scale, rough_mul=0.7, nor_strength=0.3, val=0.7, sat=0.6)
    geo = b.n("ShaderNodeNewGeometry")
    edge = b.ramp(geo.outputs["Pointiness"], (0, 0, 0), (1, 1, 1), 0.52, 0.62)
    lighter = b.n("ShaderNodeHueSaturation", Value=1.5, Saturation=0.8)
    b.link(td.outputs["Color"], lighter.inputs["Color"])
    col = b.mix(edge.outputs[0], td.outputs["Color"], lighter.outputs[0])
    b.link(col, b.bsdf.inputs["Base Color"])
    b.set(Coat_Weight=0.35, Coat_Roughness=0.3)
    return b.m


# ---- metals ---------------------------------------------------------------
def _metal(name, col, rough, tarnish_col, tarnish=0.35, scale=18.0):
    b = _NB(name)
    vec = b.coords(scale)
    nz = b.noise(vec, 1.0, 8, 0.6)
    t = b.ramp(nz.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.42, 0.7)
    # tarnish collects in hollows (AO)
    ao = b.n("ShaderNodeAmbientOcclusion", Distance=0.01, _samples=8)
    inv = b.math("SUBTRACT", 1.0, ao.outputs["AO"])
    tm = b.math("MULTIPLY", b.math("ADD", inv, b.math("MULTIPLY", t.outputs[0], 0.5)), tarnish)
    c = b.mix(tm, col, tarnish_col)
    b.link(c, b.bsdf.inputs["Base Color"])
    rr = b.ramp(nz.outputs["Fac"], (rough * 0.7,) * 3, (rough * 1.7,) * 3, 0.3, 0.75)
    b.link(rr.outputs[0], b.bsdf.inputs["Roughness"])
    # fine handling scratches
    sc = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=10.0, Roughness=0.7)
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale * 8, scale * 0.6, scale * 8)
    tc = b.n("ShaderNodeTexCoord")
    b.link(tc.outputs["Object"], mp.inputs["Vector"])
    b.link(mp.outputs[0], sc.inputs["Vector"])
    bp = b.bump(sc.outputs["Fac"], 0.04, 0.001)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Metallic=1.0)
    return b.m


def _brass():
    return _metal("brass", (0.78, 0.56, 0.26), 0.26, (0.30, 0.24, 0.12), 0.45)


def _copper():
    return _metal("copper", (0.80, 0.42, 0.28), 0.30, (0.25, 0.14, 0.09), 0.5)


def _gold():
    return _metal("gold", (1.0, 0.74, 0.34), 0.20, (0.55, 0.38, 0.15), 0.18)


def _silver():
    return _metal("silver", (0.90, 0.89, 0.86), 0.24, (0.26, 0.24, 0.22), 0.45)


def _copper_bar():
    """Rough cast copper ingot: redder, rougher, oxide in the hollows."""
    return _metal("copper_bar", (0.50, 0.21, 0.11), 0.50, (0.10, 0.06, 0.04), 0.8, 9.0)


# ---- paper ----------------------------------------------------------------
def _paper(ink=False, tone=(0.78, 0.72, 0.58), lines=28.0, ink_amt=0.35, line_rows=(0.0, 1.0),
           rule=0.0, mottle=1.0):
    """Handmade paper. ink=True lays faint, illegible lines of soft ink:
    rows of broken dashes with no letter shapes. Lines run along object X,
    `lines` per metre along Y. line_rows limits them to a band of the
    object's Y extent in generated coordinates (0..1)."""
    b = _NB("paper")
    vec = b.coords(1.0)
    nz = b.noise(vec, 60.0, 8, 0.6)                   # fibre mottling
    big = b.noise(vec, 6.0, 3, 0.5)
    c = b.ramp(nz.outputs["Fac"], tuple(x * (1 - 0.07 * mottle) for x in tone),
               tuple(min(1, x * (1 + 0.04 * mottle)) for x in tone), 0.3, 0.7)
    col = b.mix(b.math("MULTIPLY", big.outputs["Fac"], 0.3 * mottle),
                c.outputs[0], tuple(x * 0.88 for x in tone))
    if ink:
        tc = b.n("ShaderNodeTexCoord")
        sep = b.n("ShaderNodeSeparateXYZ")
        b.link(tc.outputs["Object"], sep.inputs[0])
        g = b.n("ShaderNodeSeparateXYZ")
        b.link(tc.outputs["Generated"], g.inputs[0])
        # row profile: soft stripes
        wy = b.math("MULTIPLY", sep.outputs["Y"], lines * math.pi * 2)
        row = b.math("SINE", wy)
        row = b.math("POWER", b.math("MAXIMUM", row, 0.0), 6.0)
        # dashes along the row: noise thresholded, varies per row
        dash_vec = b.n("ShaderNodeCombineXYZ")
        b.link(b.math("MULTIPLY", sep.outputs["X"], 90.0), dash_vec.inputs["X"])
        b.link(b.math("FLOOR", b.math("MULTIPLY", sep.outputs["Y"], lines)), dash_vec.inputs["Y"])
        dn = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=2.0, Roughness=0.5)
        b.link(dash_vec.outputs[0], dn.inputs["Vector"])
        dash = b.ramp(dn.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.44, 0.52)
        # row length: lines end at varying points on the right
        endn = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=0.0)
        ev = b.n("ShaderNodeCombineXYZ")
        b.link(b.math("FLOOR", b.math("MULTIPLY", sep.outputs["Y"], lines)), ev.inputs["Y"])
        ev.inputs["X"].default_value = 3.3
        b.link(ev.outputs[0], endn.inputs["Vector"])
        within = b.math("LESS_THAN", g.outputs["X"], b.math("ADD", 0.72, b.math("MULTIPLY", endn.outputs["Fac"], 0.35)))
        within = b.math("MULTIPLY", within, b.math("GREATER_THAN", g.outputs["X"], 0.08))
        band = b.math("MULTIPLY", b.math("GREATER_THAN", g.outputs["Y"], line_rows[0]),
                      b.math("LESS_THAN", g.outputs["Y"], line_rows[1]))
        ink_m = b.math("MULTIPLY", b.math("MULTIPLY", row, dash.outputs[0]), b.math("MULTIPLY", within, band))
        ink_m = b.math("MULTIPLY", ink_m, ink_amt)
        col = b.mix(ink_m, col, (0.16, 0.12, 0.09))
    if rule > 0:
        # faint ruled lines: thin, continuous, inside the margins (a ledger)
        tcr = b.n("ShaderNodeTexCoord")
        sr = b.n("ShaderNodeSeparateXYZ")
        b.link(tcr.outputs["Object"], sr.inputs[0])
        gr = b.n("ShaderNodeSeparateXYZ")
        b.link(tcr.outputs["Generated"], gr.inputs[0])
        rl = b.math("SINE", b.math("MULTIPLY", sr.outputs["Y"], lines * math.pi * 2))
        rl = b.math("POWER", b.math("MAXIMUM", rl, 0.0), 80.0)
        inside = b.math("MULTIPLY", b.math("GREATER_THAN", gr.outputs["X"], 0.06),
                        b.math("LESS_THAN", gr.outputs["X"], 0.95))
        inside = b.math("MULTIPLY", inside, b.math("MULTIPLY", b.math("GREATER_THAN", gr.outputs["Y"], 0.05),
                                                   b.math("LESS_THAN", gr.outputs["Y"], 0.95)))
        col = b.mix(b.math("MULTIPLY", b.math("MULTIPLY", rl, inside), rule), col, (0.42, 0.36, 0.30))
    b.link(col, b.bsdf.inputs["Base Color"])
    bp = b.bump(nz.outputs["Fac"], 0.08, 0.0005)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.82, Sheen_Weight=0.3, Subsurface_Weight=0.08,
          Subsurface_Radius=(0.02, 0.015, 0.01), Subsurface_Scale=0.01, Specular_IOR_Level=0.35)
    return b.m


# ---- cloth ----------------------------------------------------------------
def _leather(tint=(0.85, 0.75, 0.65)):
    b = _NB("leather")
    b.pbr("brown_leather", scale=3.0, tint=tint, nor_strength=0.8)
    b.set(Sheen_Weight=0.2)
    return b.m


def _linen(colour=(0.70, 0.66, 0.56), scale=5.0):
    """Linen: matt, off-white, a clear open weave."""
    b = _NB("linen")
    b.pbr("rough_linen", scale=scale, flat=colour, weave=0.45, nor_strength=1.4, rough_add=0.2)
    b.set(Sheen_Weight=0.3, Sheen_Roughness=0.7, Specular_IOR_Level=0.25,
          Sheen_Tint=(*colour, 1))
    return b.m


def _hessian(colour=(0.80, 0.66, 0.46), scale=4.0):
    b = _NB("hessian")
    b.pbr("hessian_230", scale=scale, tint=colour, sat=0.8, nor_strength=1.2)
    b.set(Sheen_Weight=0.4, Sheen_Roughness=0.7, Sheen_Tint=(*colour, 1))
    return b.m


def _wool(colour=(0.025, 0.035, 0.095), scale=3.0):
    """Fulled wool broadcloth: heavy, dense, matt, a soft fuzzy sheen."""
    b = _NB("wool")
    b.pbr("caban", scale=scale, flat=colour, weave=0.35, nor_strength=1.0, rough_add=0.3)
    b.set(Sheen_Weight=0.7, Sheen_Roughness=0.9,
          Sheen_Tint=(*[min(1, x * 2.2 + 0.04) for x in colour], 1), Specular_IOR_Level=0.15)
    return b.m


def _silk(colour=(0.55, 0.05, 0.06), scale=6.0, axis="Z"):
    """Silk: smooth, with a strong coloured sheen and anisotropic highlight.
    Faint lengthwise streaks (the slubbed threads that make silk shimmer)
    run along `axis` (object space: the warp direction), and a slight waver
    keeps the highlight from looking moulded."""
    b = _NB("silk")
    diff, nor, rough, disp = _tex_paths("crepe_satin")
    vec = b.coords(scale)
    tn = b.n("ShaderNodeTexImage")
    tn.image = _img(nor, True)
    tn.projection = "BOX"
    tn.projection_blend = 0.3
    b.link(vec, tn.inputs["Vector"])
    nm = b.n("ShaderNodeNormalMap", Strength=1.2)
    b.link(tn.outputs["Color"], nm.inputs["Color"])
    # streaks: noise squashed hard across the warp
    tc = b.n("ShaderNodeTexCoord")
    mp = b.n("ShaderNodeMapping")
    sc = {"X": (2.0, 260.0, 260.0), "Y": (260.0, 2.0, 260.0), "Z": (260.0, 260.0, 2.0)}[axis]
    mp.inputs["Scale"].default_value = sc
    b.link(tc.outputs["Object"], mp.inputs["Vector"])
    st = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=3.0, Roughness=0.5)
    b.link(mp.outputs[0], st.inputs["Vector"])
    wav = b.noise(b.coords(1.0), 18.0, 2, 0.5)
    h = b.math("ADD", b.math("MULTIPLY", st.outputs["Fac"], 0.6), b.math("MULTIPLY", wav.outputs["Fac"], 0.4))
    bp = b.bump(h, 0.12, 0.002, nm.outputs[0])
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    # colour: deep saturated core, lighter at the turn; streaks shift it a touch
    lw = b.n("ShaderNodeLayerWeight", Blend=0.5)
    deep = tuple(x * 0.42 for x in colour)
    c = b.mix(lw.outputs["Facing"], deep, tuple(min(1, x * 1.15) for x in colour))
    c = b.mix(b.math("MULTIPLY", st.outputs["Fac"], 0.35), c, deep)
    b.link(c, b.bsdf.inputs["Base Color"])
    rr = b.ramp(st.outputs["Fac"], (0.2,) * 3, (0.34,) * 3, 0.3, 0.7)
    b.link(rr.outputs[0], b.bsdf.inputs["Roughness"])
    b.set(Anisotropic=0.85, Specular_IOR_Level=0.45,
          Specular_Tint=(*[min(1, x * 1.1 + 0.15) for x in colour], 1),
          Sheen_Weight=1.0, Sheen_Roughness=0.28,
          Sheen_Tint=(*[min(1, x * 1.2 + 0.2) for x in colour], 1))
    return b.m


def _sailcloth(colour=(0.72, 0.66, 0.52)):
    """Heavy cotton/linen canvas: tighter and smoother than sacking."""
    b = _NB("sailcloth")
    b.pbr("rough_linen", scale=2.2, flat=colour, weave=0.3, nor_strength=1.8, rough_add=0.25)
    b.set(Sheen_Weight=0.2, Sheen_Roughness=0.8, Sheen_Tint=(*colour, 1))
    return b.m


def _rope(colour=(0.62, 0.50, 0.34)):
    b = _NB("rope")
    b.pbr("hessian_380" if os.path.exists(os.path.join(TEX, "hessian_380")) else "hessian_230",
          scale=10.0, tint=colour, nor_strength=1.5)
    return b.m


def _carpet(c1=(0.36, 0.08, 0.06), c2=(0.08, 0.10, 0.22), c3=(0.62, 0.44, 0.18), field=(0.42, 0.12, 0.08)):
    """Flat-woven mat: plain bands and a row of small lozenges near the
    edge, muted vegetable dyes, weave from the hessian normal."""
    b = _NB("carpet")
    tc = b.n("ShaderNodeTexCoord")
    wob = b.n("ShaderNodeTexNoise", Scale=14.0, Detail=2.0)
    b.link(tc.outputs["Object"], wob.inputs["Vector"])
    wv = b.n("ShaderNodeVectorMath", _operation="MULTIPLY_ADD")
    b.link(wob.outputs["Color"], wv.inputs[0])
    wv.inputs[1].default_value = (0.004, 0.004, 0.0)
    b.link(tc.outputs["Object"], wv.inputs[2])
    # step the coordinates to the weft rows so diagonals stair-step like a kilim
    snap = b.n("ShaderNodeVectorMath", _operation="SNAP")
    b.link(wv.outputs[0], snap.inputs[0])
    snap.inputs[1].default_value = (0.003, 0.003, 1.0)
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(snap.outputs[0], sep.inputs[0])
    # distance from edge is supplied by object: we use |x|,|y| in object space
    ax = b.math("ABSOLUTE", sep.outputs["X"])
    ay = b.math("ABSOLUTE", sep.outputs["Y"])
    # bands by distance to the nearest edge; object half-size is set by
    # custom props (defaults 1.2 x 0.9)
    hx = b.n("ShaderNodeAttribute", _attribute_type="OBJECT", _attribute_name="half_x")
    hy = b.n("ShaderNodeAttribute", _attribute_type="OBJECT", _attribute_name="half_y")
    dx = b.math("SUBTRACT", hx.outputs["Fac"], ax)
    dy = b.math("SUBTRACT", hy.outputs["Fac"], ay)
    d = b.math("MINIMUM", dx, dy)
    # band index from d
    bands = b.n("ShaderNodeValToRGB")
    bands.color_ramp.interpolation = "CONSTANT"
    el = bands.color_ramp.elements
    el[0].position = 0.0
    el[0].color = (*c2, 1)
    stops = [(0.035, c3), (0.05, c1), (0.15, c3), (0.165, c2), (0.19, field)]
    el[1].position = 0.03
    el[1].color = (*c2, 1)
    for p, cc in stops:
        e = el.new(p / 0.25)
        e.color = (*cc, 1)
    el[1].position = 0.03 / 0.25
    b.link(b.math("DIVIDE", d, 0.25), bands.inputs[0])
    # lozenges in the band 0.05..0.15: along-edge coordinate
    along = b.math("ADD", sep.outputs["X"], sep.outputs["Y"])
    tri_a = b.math("PINGPONG", b.math("MULTIPLY", along, 1.0), 0.05)
    tri_d = b.math("ABSOLUTE", b.math("SUBTRACT", d, 0.10))
    loz = b.math("LESS_THAN", b.math("ADD", tri_a, tri_d), 0.045)
    inb = b.math("MULTIPLY", b.math("GREATER_THAN", d, 0.055), b.math("LESS_THAN", d, 0.145))
    loz = b.math("MULTIPLY", loz, inb)
    col = b.mix(loz, bands.outputs[0], c2)
    # abrash: dye lots vary across the weft
    ab = b.n("ShaderNodeTexWave", _wave_type="BANDS", _bands_direction="Y", Scale=9.0, Distortion=3.0, Detail=2.0)
    b.link(tc.outputs["Object"], ab.inputs["Vector"])
    abr = b.ramp(ab.outputs["Fac"], (0.82, 0.82, 0.82), (1.05, 1.05, 1.05), 0.2, 0.9)
    col = b.mix(1.0, col, abr.outputs[0], "MULTIPLY")
    # weave
    diff, nor, rough, disp = _tex_paths("hessian_230")
    vec = b.coords(9.0)
    td = b.n("ShaderNodeTexImage")
    td.image = _img(diff)
    td.projection = "BOX"
    b.link(vec, td.inputs["Vector"])
    bw = b.n("ShaderNodeRGBToBW")
    b.link(td.outputs["Color"], bw.inputs[0])
    shade = b.ramp(bw.outputs[0], (0.45, 0.45, 0.45), (1.1, 1.1, 1.1), 0.2, 0.8)
    col = b.mix(1.0, col, shade.outputs[0], "MULTIPLY")
    b.link(col, b.bsdf.inputs["Base Color"])
    tn = b.n("ShaderNodeTexImage")
    tn.image = _img(nor, True)
    tn.projection = "BOX"
    b.link(vec, tn.inputs["Vector"])
    nm = b.n("ShaderNodeNormalMap", Strength=1.2)
    b.link(tn.outputs["Color"], nm.inputs["Color"])
    b.link(nm.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.95, Sheen_Weight=0.12, Sheen_Roughness=0.8)
    return b.m


# ---- ceramics and glass ---------------------------------------------------
def _glazed(colour=(0.46, 0.55, 0.44), rough=0.06, pool=0.6):
    """Thick glaze: glossy coat, glaze pooling darker in hollows, a slight
    ripple in the surface."""
    b = _NB("glazed")
    ao = b.n("ShaderNodeAmbientOcclusion", Distance=0.015, _samples=8)
    deep = tuple(x * 0.55 for x in colour)
    c = b.mix(b.math("MULTIPLY", b.math("SUBTRACT", 1.0, ao.outputs["AO"]), pool * 2), colour, deep)
    vec = b.coords(1.0)
    nz = b.noise(vec, 35.0, 4, 0.5)
    c = b.mix(b.math("MULTIPLY", nz.outputs["Fac"], 0.25), c, tuple(min(1, x * 1.15) for x in colour))
    b.link(c, b.bsdf.inputs["Base Color"])
    rip = b.noise(vec, 12.0, 3, 0.5)
    bp = b.bump(rip.outputs["Fac"], 0.06, 0.001)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.link(bp.outputs[0], b.bsdf.inputs["Coat Normal"])
    b.set(Roughness=0.45, Coat_Weight=1.0, Coat_Roughness=rough, Coat_IOR=1.52,
          Subsurface_Weight=0.15, Subsurface_Radius=(0.01, 0.01, 0.008), Subsurface_Scale=0.005)
    return b.m


def _glass(colour=(0.78, 0.88, 0.72), rough=0.02):
    """Blown glass, faintly green, uneven: wavy bump, tiny seeds."""
    b = _NB("glass")
    vec = b.coords(1.0)
    w = b.noise(vec, 9.0, 3, 0.5)
    seeds = b.n("ShaderNodeTexVoronoi", Scale=180.0)
    b.link(vec, seeds.inputs["Vector"])
    s = b.ramp(seeds.outputs["Distance"], (1, 1, 1), (0, 0, 0), 0.0, 0.06)
    h = b.math("ADD", w.outputs["Fac"], b.math("MULTIPLY", s.outputs[0], 0.2))
    bp = b.bump(h, 0.12, 0.002)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=colour, Roughness=rough, Transmission_Weight=1.0, IOR=1.51,
          Specular_IOR_Level=0.5)
    return b.m


def _water(deep=(0.02, 0.10, 0.11), murk=0.0):
    b = _NB("water")
    vec = b.coords(1.0)
    nz = b.noise(vec, 4.0, 6, 0.55)
    bp = b.bump(nz.outputs["Fac"], 0.05, 0.01)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=(0.9, 0.97, 0.97), Roughness=0.02, Transmission_Weight=1.0, IOR=1.333)
    v = b.n("ShaderNodeVolumeAbsorption", Density=6.0 + murk * 20)
    v.inputs["Color"].default_value = (*[min(1, x * 6) for x in deep], 1)
    b.link(v.outputs[0], b.out.inputs["Volume"])
    if murk > 0:
        sc = b.n("ShaderNodeVolumeScatter", Density=murk * 4)
        sc.inputs["Color"].default_value = (0.3, 0.45, 0.35, 1)
        add = b.n("ShaderNodeAddShader")
        b.link(v.outputs[0], add.inputs[0])
        b.link(sc.outputs[0], add.inputs[1])
        b.link(add.outputs[0], b.out.inputs["Volume"])
    return b.m


def _sea_water():
    return _water((0.015, 0.09, 0.12), 0.0)


def _harbour_water():
    return _water((0.03, 0.08, 0.05), 0.35)


def _enamel_sea(colour=(0.025, 0.085, 0.085)):
    """Dark blue-green enamel for the map's sea: glossy, calm, faint swirl."""
    b = _NB("enamel_sea")
    vec = b.coords(1.0)
    nz = b.noise(vec, 3.0, 4, 0.5)
    c = b.mix(b.math("MULTIPLY", nz.outputs["Fac"], 0.5), colour, tuple(x * 1.35 for x in colour))
    b.link(c, b.bsdf.inputs["Base Color"])
    fine = b.noise(vec, 40.0, 2, 0.5)
    bp = b.bump(fine.outputs["Fac"], 0.02, 0.0005)
    b.link(bp.outputs[0], b.bsdf.inputs["Coat Normal"])
    b.set(Roughness=0.35, Coat_Weight=1.0, Coat_Roughness=0.12, Coat_IOR=1.5)
    return b.m


# ---- stone, earth ---------------------------------------------------------
def _limestone(colour=(0.74, 0.68, 0.56), scale=1.0):
    """Pale Mokattam-type limestone: warm cream, mottled, small pits.
    Procedural so a small block shows no mortar joints; walls in batch 3
    will layer block joints on top."""
    b = _NB("limestone")
    vec = b.coords(scale)
    big = b.noise(vec, 8.0, 6, 0.6)
    fine = b.noise(vec, 80.0, 6, 0.65)
    c = b.ramp(big.outputs["Fac"], tuple(x * 0.82 for x in colour), tuple(min(1, x * 1.06) for x in colour), 0.3, 0.75)
    col = b.mix(b.math("MULTIPLY", fine.outputs["Fac"], 0.25), c.outputs[0], tuple(x * 0.7 for x in colour))
    b.link(col, b.bsdf.inputs["Base Color"])
    pits = b.n("ShaderNodeTexVoronoi", Scale=60.0)
    b.link(vec, pits.inputs["Vector"])
    pr = b.ramp(pits.outputs["Distance"], (0, 0, 0), (1, 1, 1), 0.0, 0.12)
    h = b.math("ADD", b.math("MULTIPLY", fine.outputs["Fac"], 0.6), b.math("MULTIPLY", pr.outputs[0], 0.4))
    bp = b.bump(h, 0.35, 0.002)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.85)
    return b.m


def _striped_stone(light=(0.78, 0.72, 0.60), dark=(0.20, 0.18, 0.17), course=0.30):
    """Ablaq: alternating courses of pale limestone and dark stone. Bands by
    object Z, `course` metres each."""
    b = _NB("striped_stone")
    diff, nor, rough, disp = _tex_paths("large_sandstone_blocks")
    vec = b.coords(1.0)
    td = b.n("ShaderNodeTexImage")
    td.image = _img(diff)
    td.projection = "BOX"
    td.projection_blend = 0.25
    b.link(vec, td.inputs["Vector"])
    bw = b.n("ShaderNodeRGBToBW")
    b.link(td.outputs["Color"], bw.inputs[0])
    tc = b.n("ShaderNodeTexCoord")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(tc.outputs["Object"], sep.inputs[0])
    band = b.math("MODULO", b.math("FLOOR", b.math("DIVIDE", sep.outputs["Z"], course)), 2.0)
    band = b.math("ABSOLUTE", band)
    col = b.mix(band, light, dark)
    sh = b.ramp(bw.outputs[0], (0.6, 0.6, 0.6), (1.2, 1.2, 1.2), 0.1, 0.7)
    col = b.mix(1.0, col, sh.outputs[0], "MULTIPLY")
    b.link(col, b.bsdf.inputs["Base Color"])
    tn = b.n("ShaderNodeTexImage")
    tn.image = _img(nor, True)
    tn.projection = "BOX"
    b.link(vec, tn.inputs["Vector"])
    nm = b.n("ShaderNodeNormalMap", Strength=0.9)
    b.link(tn.outputs["Color"], nm.inputs["Color"])
    b.link(nm.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.8)
    return b.m


def _mud_brick(scale=1.0):
    b = _NB("mud_brick")
    b.pbr("brown_mud_dry", scale=scale * 0.18, tint=(0.95, 0.80, 0.62), nor_strength=0.4, rough_add=0.15, sat=0.75)
    return b.m


def _lime_plaster(colour=(0.86, 0.82, 0.74), scale=1.0):
    b = _NB("lime_plaster")
    b.pbr("white_stucco", scale=scale, tint=colour, nor_strength=0.6, rough_add=0.1)
    return b.m


def _sand(colour=(0.86, 0.72, 0.52), scale=4.0):
    b = _NB("sand")
    b.pbr("sand_01", scale=scale * 2, tint=colour, sat=0.9, nor_strength=0.35)
    return b.m


def _snow():
    b = _NB("snow")
    vec = b.coords(1.0)
    nz = b.noise(vec, 30.0, 6, 0.6)
    bp = b.bump(nz.outputs["Fac"], 0.15, 0.002)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    sp = b.n("ShaderNodeTexVoronoi", Scale=400.0)
    b.link(vec, sp.inputs["Vector"])
    gl = b.ramp(sp.outputs["Distance"], (0.05,) * 3, (0.55,) * 3, 0.0, 0.08)
    b.link(gl.outputs[0], b.bsdf.inputs["Roughness"])
    b.set(Base_Color=(0.88, 0.90, 0.94), Subsurface_Weight=1.0,
          Subsurface_Radius=(0.6, 0.8, 1.0), Subsurface_Scale=0.02)
    return b.m


def _salt():
    b = _NB("salt")
    vec = b.coords(1.0)
    nz = b.noise(vec, 9.0, 8, 0.65)
    c = b.ramp(nz.outputs["Fac"], (0.36, 0.35, 0.33), (0.66, 0.64, 0.60), 0.35, 0.7)
    # grey bands of earthy impurity through the bed, as in mined rock salt
    wv = b.n("ShaderNodeTexWave", Scale=18.0, Distortion=6.0, Detail=4.0)
    wv.bands_direction = "Z"
    b.link(vec, wv.inputs["Vector"])
    bands = b.ramp(wv.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.55, 0.9)
    cc = b.mix(b.math("MULTIPLY", bands.outputs[0], 0.55), c.outputs[0], (0.22, 0.20, 0.18))
    b.link(cc, b.bsdf.inputs["Base Color"])
    bp = b.bump(nz.outputs["Fac"], 0.4, 0.004)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.6, Subsurface_Weight=0.4, Subsurface_Radius=(0.05, 0.05, 0.05),
          Subsurface_Scale=0.01)
    return b.m


def _peppercorn():
    b = _NB("peppercorn")
    vec = b.coords(1.0)
    nz = b.noise(vec, 900.0, 4, 0.6)
    c = b.ramp(nz.outputs["Fac"], (0.025, 0.020, 0.017), (0.11, 0.075, 0.05), 0.3, 0.75)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    b.set(Roughness=0.55)
    return b.m


def _clay(colour=(0.62, 0.40, 0.26)):
    b = _NB("clay")
    vec = b.coords(1.0)
    nz = b.noise(vec, 40.0, 6, 0.6)
    c = b.ramp(nz.outputs["Fac"], tuple(x * 0.85 for x in colour), colour, 0.3, 0.7)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    bp = b.bump(nz.outputs["Fac"], 0.15, 0.001)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.85)
    return b.m


def _bone(colour=(0.82, 0.76, 0.62)):
    b = _NB("bone")
    vec = b.coords(1.0)
    nz = b.noise(vec, 30.0, 4, 0.5)
    c = b.ramp(nz.outputs["Fac"], tuple(x * 0.9 for x in colour), colour, 0.3, 0.7)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    b.set(Roughness=0.35, Subsurface_Weight=0.3, Subsurface_Radius=(0.01, 0.008, 0.006), Subsurface_Scale=0.004)
    return b.m


def _gold_dust():
    """Gold dust: a heap of fine metallic grains, each catching light."""
    b = _NB("gold_dust")
    vec = b.coords(1.0)
    g = b.n("ShaderNodeTexVoronoi", Scale=1400.0)
    b.link(vec, g.inputs["Vector"])
    c = b.ramp(g.outputs["Distance"], (1.0, 0.76, 0.36), (0.45, 0.30, 0.10), 0.05, 0.5)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    bp = b.bump(g.outputs["Distance"], 0.6, 0.0004)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Metallic=1.0, Roughness=0.38)
    return b.m


def _sugar():
    """Hard loaf sugar: white, faintly warm, crystalline, light passing a
    little way in."""
    b = _NB("sugar")
    vec = b.coords(1.0)
    nz = b.noise(vec, 300.0, 6, 0.6)
    c = b.ramp(nz.outputs["Fac"], (0.80, 0.78, 0.72), (0.93, 0.92, 0.88), 0.3, 0.7)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    sp = b.n("ShaderNodeTexVoronoi", Scale=900.0)
    b.link(vec, sp.inputs["Vector"])
    bp = b.bump(sp.outputs["Distance"], 0.25, 0.0005)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.55, Subsurface_Weight=0.6, Subsurface_Radius=(0.02, 0.02, 0.018),
          Subsurface_Scale=0.006)
    return b.m


def _resin(colour=(0.78, 0.52, 0.16)):
    """Frankincense tears: pale yellow, cloudy, translucent, a dusty
    bloom on the surface."""
    b = _NB("resin")
    vec = b.coords(1.0)
    nz = b.noise(vec, 180.0, 5, 0.6)
    c = b.ramp(nz.outputs["Fac"], colour, tuple(min(1, x * 1.18) for x in colour), 0.3, 0.75)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    bp = b.bump(nz.outputs["Fac"], 0.2, 0.0006)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.45, Subsurface_Weight=1.0, Subsurface_Radius=(0.04, 0.03, 0.012),
          Subsurface_Scale=0.006, Coat_Weight=0.2, Coat_Roughness=0.5)
    return b.m


def _brass_pierced():
    """Brass with a band of small round piercings on the upper half (an
    incense burner's lid). The holes are dark discs, not real cuts."""
    m = _metal("brass_pierced", (0.78, 0.56, 0.26), 0.26, (0.30, 0.24, 0.12), 0.45)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = bsdf.inputs["Base Color"].links[0].from_socket
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 260.0
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    hole = nt.nodes.new("ShaderNodeMath")
    hole.operation = "LESS_THAN"
    nt.links.new(vor.outputs["Distance"], hole.inputs[0])
    hole.inputs[1].default_value = 0.22
    band = nt.nodes.new("ShaderNodeMath")
    band.operation = "GREATER_THAN"
    nt.links.new(sep.outputs["Z"], band.inputs[0])
    band.inputs[1].default_value = 0.044
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(hole.outputs[0], mul.inputs[0])
    nt.links.new(band.outputs[0], mul.inputs[1])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    nt.links.new(mul.outputs[0], mx.inputs["Factor"])
    nt.links.new(src, mx.inputs[6])
    mx.inputs[7].default_value = (0.01, 0.008, 0.006, 1)
    nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
    rmx = nt.nodes.new("ShaderNodeMath")
    rmx.operation = "MAXIMUM"
    rsrc = bsdf.inputs["Roughness"].links[0].from_socket
    nt.links.new(rsrc, rmx.inputs[0])
    nt.links.new(mul.outputs[0], rmx.inputs[1])
    nt.links.new(rmx.outputs[0], bsdf.inputs["Roughness"])
    return m


# ---- batch 3: the wide views ---------------------------------------------
def _tex_mat(name, tid, scale=1.0, tint=None, sat=1.0, val=1.0, nor=1.0, rough_add=0.0, bump=0.0):
    b = _NB(name)
    b.pbr(tid, scale=scale, tint=tint, sat=sat, val=val, nor_strength=nor, rough_add=rough_add,
          bump_strength=bump)
    return b.m


def _rock(scale=0.3, tint=(0.95, 0.85, 0.72)):
    """Bare weathered rock (desert hills, mountain faces)."""
    return _tex_mat("rock", "rock_face", scale, tint, 0.8, 1.0, 1.2)


def _rocky_ground(scale=0.5, tint=(1.0, 0.86, 0.68)):
    """Dry stony desert ground (rock_face scan, lightened and dusted)."""
    return _tex_mat("rocky_ground", "rock_face", scale, tint, 0.65, 1.45, 0.8)


def _coral_stone(scale=0.5):
    """Coral rag walls of a Red Sea port: pale, pitted, roughly coursed."""
    return _tex_mat("coral_stone", "coral_stone_wall", scale, (1.0, 0.95, 0.86), 0.7, 1.05, 1.0)


def _red_brick(scale=0.45):
    """Venetian brick: dark red, soft, uneven, lime mortar."""
    return _tex_mat("red_brick", "medieval_red_brick", scale, (0.95, 0.82, 0.76), 0.9, 1.0, 1.0)


def _quay_stone(scale=0.4):
    """Worn, sea-washed stone blocks for quays and harbour walls."""
    return _tex_mat("quay_stone", "seaworn_sandstone_brick", scale, (1.0, 0.94, 0.84), 0.8, 1.0, 1.0)


def _pale_block(scale=0.3, tint=(1.0, 0.90, 0.74)):
    """Large dressed blocks of pale limestone (city walls, gates, inns):
    the sandstone-block scan, desaturated, lightened and warmed."""
    return _tex_mat("pale_block", "large_sandstone_blocks", scale, tint, 0.35, 1.55, 1.0)


def _thatch(scale=0.6):
    return _tex_mat("thatch", "thatch_roof_angled", scale, (0.85, 0.75, 0.6), 0.8, 0.9, 1.0)


def _reed_mat(scale=0.8):
    """Woven reed matting and reed roofs."""
    return _tex_mat("reed_mat", "reed_roof_04", scale, (1.0, 0.9, 0.75), 0.8, 1.0, 1.0)


def _snow_ground(scale=0.25):
    b = _NB("snow_ground")
    b.pbr("snow_02", scale=scale, tint=(0.96, 0.98, 1.0), nor_strength=0.6, sat=0.3)
    b.set(Subsurface_Weight=0.4, Subsurface_Radius=(0.5, 0.7, 1.0), Subsurface_Scale=0.02)
    return b.m


def _earth_plaster(colour=(0.62, 0.42, 0.27), scale=1.0):
    """Hand-smoothed mud plaster (banco): even, matt, faint trowel swirls,
    darker where rain has run."""
    b = _NB("earth_plaster")
    vec = b.coords(scale)
    big = b.noise(vec, 0.6, 4, 0.55)
    sw = b.noise(vec, 3.0, 6, 0.6)
    c = b.ramp(big.outputs["Fac"], tuple(x * 0.82 for x in colour), tuple(min(1, x * 1.08) for x in colour), 0.3, 0.7)
    col = b.mix(b.math("MULTIPLY", sw.outputs["Fac"], 0.25), c.outputs[0], tuple(x * 0.9 for x in colour))
    # rain streaks: vertical noise
    tc = b.n("ShaderNodeTexCoord")
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (6.0, 6.0, 0.4)
    b.link(tc.outputs["Object"], mp.inputs["Vector"])
    st = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=3.0)
    b.link(mp.outputs[0], st.inputs["Vector"])
    sr = b.ramp(st.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.55, 0.75)
    col = b.mix(b.math("MULTIPLY", sr.outputs[0], 0.25), col, tuple(x * 0.7 for x in colour))
    b.link(col, b.bsdf.inputs["Base Color"])
    bp = b.bump(sw.outputs["Fac"], 0.25, 0.01)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.92)
    return b.m


def _foliage(colour=(0.10, 0.20, 0.06)):
    """Leaves seen from far off: dark green, a little translucent, waxy."""
    b = _NB("foliage")
    vec = b.coords(1.0)
    nz = b.noise(vec, 2.0, 4, 0.6)
    c = b.ramp(nz.outputs["Fac"], tuple(x * 0.6 for x in colour), tuple(min(1, x * 1.4) for x in colour), 0.3, 0.75)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    b.set(Roughness=0.55, Subsurface_Weight=0.3, Subsurface_Radius=(0.1, 0.2, 0.05), Subsurface_Scale=0.02,
          Specular_IOR_Level=0.4)
    return b.m


def _bark(colour=(0.30, 0.25, 0.20)):
    b = _NB("bark")
    vec = b.coords(1.0)
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (8.0, 8.0, 1.5)
    b.link(vec, mp.inputs["Vector"])
    nz = b.n("ShaderNodeTexNoise", Scale=3.0, Detail=8.0, Roughness=0.7)
    b.link(mp.outputs[0], nz.inputs["Vector"])
    c = b.ramp(nz.outputs["Fac"], tuple(x * 0.6 for x in colour), colour, 0.35, 0.7)
    b.link(c.outputs[0], b.bsdf.inputs["Base Color"])
    bp = b.bump(nz.outputs["Fac"], 0.6, 0.02)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.9)
    return b.m


def _clear_water(deep=(0.02, 0.22, 0.20), density=0.35):
    """Very clear shallow sea over sand and reef: a closed volume of water
    that tints with depth, glassy surface with fine ripples."""
    b = _NB("clear_water")
    vec = b.coords(1.0)
    nz = b.noise(vec, 0.8, 5, 0.55)
    bp = b.bump(nz.outputs["Fac"], 0.08, 0.05)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=(1, 1, 1), Roughness=0.01, Transmission_Weight=1.0, IOR=1.333)
    v = b.n("ShaderNodeVolumeAbsorption", Density=density)
    v.inputs["Color"].default_value = (*[min(1, x * 4) for x in deep], 1)
    b.link(v.outputs[0], b.out.inputs["Volume"])
    return b.m


def _open_sea(colour=(0.012, 0.045, 0.06), rough=0.04):
    """Deep or murky water seen at a distance: opaque, dark, glossy. Waves
    come from the geometry (kit_terrain.sea)."""
    b = _NB("open_sea")
    vec = b.coords(1.0)
    nz = b.noise(vec, 3.0, 4, 0.6)
    bp = b.bump(nz.outputs["Fac"], 0.05, 0.02)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=colour, Roughness=rough, Specular_IOR_Level=0.5, IOR=1.333,
          Subsurface_Weight=0.0)
    return b.m


def _rippled_water(colour=(0.010, 0.040, 0.042), rough=0.06, ripple=0.9, stretch=2.5):
    """Calm open water seen from a shore: opaque, glossy, small wind ripples
    at two scales so the sky's reflection breaks up and the sun lays a
    path. (Harbours, rivers, lagoons.)"""
    b = _NB("rippled_water")
    vec = b.coords(1.0)
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, stretch, 1.0)
    b.link(vec, mp.inputs["Vector"])
    n1 = b.n("ShaderNodeTexNoise", Scale=0.35, Detail=6.0, Roughness=0.6)
    b.link(mp.outputs[0], n1.inputs["Vector"])
    n2 = b.n("ShaderNodeTexNoise", Scale=3.0, Detail=4.0, Roughness=0.5)
    b.link(mp.outputs[0], n2.inputs["Vector"])
    h = b.math("ADD", n1.outputs["Fac"], b.math("MULTIPLY", n2.outputs["Fac"], 0.35))
    bp = b.bump(h, ripple, 0.12)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Base_Color=colour, Roughness=rough, Specular_IOR_Level=0.5, IOR=1.333)
    return b.m

def _seabed(sand=(0.82, 0.74, 0.56), reef=(0.30, 0.26, 0.20)):
    """Pale sand with dark patches of reef."""
    b = _NB("seabed")
    vec = b.coords(1.0)
    nz = b.noise(vec, 0.035, 5, 0.6)
    m = b.ramp(nz.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.52, 0.58)
    col = b.mix(m.outputs[0], sand, reef)
    b.link(col, b.bsdf.inputs["Base Color"])
    fine = b.noise(vec, 2.0, 6, 0.6)
    bp = b.bump(fine.outputs["Fac"], 0.4, 0.05)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.9)
    return b.m


def _snowflake():
    """A soft round flake: white, fading at its edges."""
    m = bpy.data.materials.new("snowflake")
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    gr = nt.nodes.new("ShaderNodeTexGradient")
    gr.gradient_type = "SPHERICAL"
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Location"].default_value = (-0.5, -0.5, 0)
    mp.inputs["Scale"].default_value = (2, 2, 0)
    # UV-free: use Generated coordinates of each quad would be shared, so
    # fade by facing instead: flakes are tiny, a plain soft white is enough
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (0.9, 0.92, 0.95, 1)
    mx = nt.nodes.new("ShaderNodeMixShader")
    mx.inputs["Fac"].default_value = 0.55
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(df.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def _plank_hull(colour=(0.42, 0.30, 0.20), plank=0.22, sewn=False, scale=0.8):
    """Ship's planking: weathered timber with plank seams running along
    the hull (object Z bands). sewn=True adds rows of cord stitches along
    every seam, as on Indian Ocean sewn boats."""
    b = _NB("plank_hull")
    diff, nor, rough, disp = _tex_paths("weathered_planks")
    vec = b.coords(scale)
    td = b.n("ShaderNodeTexImage")
    td.image = _img(diff)
    td.projection = "BOX"
    b.link(vec, td.inputs["Vector"])
    bw = b.n("ShaderNodeRGBToBW")
    b.link(td.outputs["Color"], bw.inputs[0])
    sh = b.ramp(bw.outputs[0], (0.55, 0.55, 0.55), (1.2, 1.2, 1.2), 0.1, 0.8)
    col = b.mix(1.0, colour, sh.outputs[0], "MULTIPLY")
    tc = b.n("ShaderNodeTexCoord")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(tc.outputs["Object"], sep.inputs[0])
    zz = b.math("DIVIDE", sep.outputs["Z"], plank)
    fr = b.math("FRACT", zz)
    seam = b.math("LESS_THAN", fr, 0.06)
    col = b.mix(b.math("MULTIPLY", seam, 0.7), col, (0.05, 0.035, 0.025))
    h = b.math("SUBTRACT", 1.0, seam)
    if sewn:
        # stitches: short dark dashes across each seam every ~12 cm
        st = b.math("LESS_THAN", b.math("FRACT", b.math("DIVIDE", sep.outputs["X"], 0.12)), 0.35)
        band = b.math("LESS_THAN", b.math("ABSOLUTE", b.math("SUBTRACT", fr, 0.03)), 0.12)
        stitch = b.math("MULTIPLY", st, band)
        col = b.mix(stitch, col, (0.12, 0.09, 0.05))
        h = b.math("SUBTRACT", h, b.math("MULTIPLY", stitch, -0.6))
    b.link(col, b.bsdf.inputs["Base Color"])
    bp = b.bump(h, 0.5, 0.01)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.8)
    return b.m


_HOUSE_TEX = {"plaster": "white_stucco", "mud": "brown_mud_dry", "stone": "large_sandstone_blocks"}


def _house_wall(colour=(0.66, 0.58, 0.47), tex="plaster", windows=0.55, grime=1.0, spacing=3.6, storey=3.3,
                win=(0.32, 0.38), lattice=0.35, scale=0.3):
    """Walls of town houses seen from far off (batch 3 polish): the base
    texture tinted, weathered (darker at the foot, rain streaks down the
    faces, dirt in the corners), with small dark window openings on the
    vertical faces in rows by storey, some filled with dark wooden lattice.
    Windows are drawn in the shader from world position, so packed meshes
    and scattered boxes both get them. windows = fraction of slots used."""
    b = _NB("house_wall")
    td = b.pbr(_HOUSE_TEX[tex], scale=scale, tint=colour, sat=0.35, val=1.6 if tex != "mud" else 1.2,
               nor_strength=0.6)
    base = b.bsdf.inputs["Base Color"].links[0].from_socket
    geo = b.n("ShaderNodeNewGeometry")
    pos = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Position"], pos.inputs[0])
    nrm = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], nrm.inputs[0])
    col = base
    if grime > 0:
        # darker toward the foot of each wall: AO from the ground and the street
        ao = b.n("ShaderNodeAmbientOcclusion", Distance=2.5, _samples=8)
        dirt = b.math("MULTIPLY", b.math("SUBTRACT", 1.0, ao.outputs["AO"]), 0.55 * grime)
        col = b.mix(dirt, col, tuple(x * 0.45 for x in colour))
        # rain streaks running down the faces from the parapets
        mp = b.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (2.2, 2.2, 0.18)
        b.link(geo.outputs["Position"], mp.inputs["Vector"])
        st = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=4.0, Roughness=0.6)
        b.link(mp.outputs[0], st.inputs["Vector"])
        sr = b.ramp(st.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.55, 0.78)
        col = b.mix(b.math("MULTIPLY", sr.outputs[0], 0.35 * grime), col, tuple(x * 0.6 for x in colour))
        # a broad patchiness so no two walls are the same tone
        big = b.noise(b.coords(1.0), 0.05, 3, 0.5)
        col = b.mix(b.math("MULTIPLY", big.outputs["Fac"], 0.3), col, tuple(min(1, x * 1.12) for x in colour))
    if windows > 0:
        u = b.math("DIVIDE", b.math("ADD", pos.outputs["X"], pos.outputs["Y"]), spacing)
        v = b.math("DIVIDE", b.math("SUBTRACT", pos.outputs["Z"], 1.6), storey)
        fu, fv = b.math("FRACT", u), b.math("FRACT", v)
        inu = b.math("MULTIPLY", b.math("GREATER_THAN", fu, 0.5 - win[0] / 2), b.math("LESS_THAN", fu, 0.5 + win[0] / 2))
        inv = b.math("MULTIPLY", b.math("GREATER_THAN", fv, 0.35), b.math("LESS_THAN", fv, 0.35 + win[1]))
        cv = b.n("ShaderNodeCombineXYZ")
        b.link(b.math("FLOOR", u), cv.inputs["X"])
        b.link(b.math("FLOOR", v), cv.inputs["Y"])
        wn = b.n("ShaderNodeTexWhiteNoise", _noise_dimensions="3D")
        b.link(cv.outputs[0], wn.inputs["Vector"])
        used = b.math("LESS_THAN", wn.outputs["Value"], windows)
        wall = b.math("LESS_THAN", b.math("ABSOLUTE", nrm.outputs["Z"]), 0.3)
        above = b.math("GREATER_THAN", pos.outputs["Z"], 1.6)
        m = b.math("MULTIPLY", b.math("MULTIPLY", inu, inv), b.math("MULTIPLY", used, b.math("MULTIPLY", wall, above)))
        wood = b.math("LESS_THAN", wn.outputs["Value"], windows * lattice)   # some slots hold wooden lattice
        hole = b.mix(wood, (0.015, 0.013, 0.011), (0.10, 0.065, 0.04))
        col = b.mix(m, col, hole)
    b.link(col, b.bsdf.inputs["Base Color"])
    return b.m


def _stamp_ink(colour=(0.10, 0.06, 0.05)):
    """Ink from a stamp: dark, matt, unevenly inked so the paper shows
    through in places."""
    b = _NB("stamp_ink")
    vec = b.coords(1.0)
    nz = b.noise(vec, 700.0, 4, 0.6)
    patchy = b.ramp(nz.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.35, 0.62)
    c = b.mix(b.math("MULTIPLY", patchy.outputs[0], 0.6), colour, (0.30, 0.22, 0.16))
    b.link(c, b.bsdf.inputs["Base Color"])
    b.set(Roughness=0.7, Specular_IOR_Level=0.3)
    return b.m


def _ink(colour=(0.05, 0.035, 0.03)):
    b = _NB("ink")
    b.set(Base_Color=colour, Roughness=0.15)
    return b.m


def _dark(colour=(0.02, 0.02, 0.02)):
    b = _NB("dark")
    b.set(Base_Color=colour, Roughness=0.9)
    return b.m


LIBRARY = {
    "walnut": _walnut, "walnut_inlay": _walnut_inlay, "plain_wood": _plain_wood, "ship_timber": _ship_timber,
    "carved_wood": _carved_wood,
    "brass": _brass, "copper": _copper, "gold": _gold, "silver": _silver, "copper_bar": _copper_bar,
    "paper": _paper, "leather": _leather, "linen": _linen, "wool": _wool, "silk": _silk,
    "hessian": _hessian, "sailcloth": _sailcloth, "rope": _rope, "carpet": _carpet,
    "glazed": _glazed, "glass": _glass,
    "limestone": _limestone, "striped_stone": _striped_stone, "mud_brick": _mud_brick,
    "lime_plaster": _lime_plaster, "sand": _sand, "snow": _snow, "salt": _salt,
    "sea_water": _sea_water, "harbour_water": _harbour_water, "enamel_sea": _enamel_sea,
    "gold_dust": _gold_dust, "sugar": _sugar, "resin": _resin, "brass_pierced": _brass_pierced,
    "stamp_ink": _stamp_ink,
    "house_wall": _house_wall, "rock": _rock, "rocky_ground": _rocky_ground, "coral_stone": _coral_stone, "red_brick": _red_brick,
    "quay_stone": _quay_stone, "pale_block": _pale_block, "thatch": _thatch, "reed_mat": _reed_mat,
    "snow_ground": _snow_ground, "earth_plaster": _earth_plaster, "foliage": _foliage, "bark": _bark,
    "clear_water": _clear_water, "rippled_water": _rippled_water, "open_sea": _open_sea, "seabed": _seabed, "snowflake": _snowflake,
    "plank_hull": _plank_hull, "peppercorn": _peppercorn, "clay": _clay, "bone": _bone, "ink": _ink, "dark": _dark,
}


# --------------------------------------------------------------------------
# saving
# --------------------------------------------------------------------------
def _render_to(path):
    s = bpy.context.scene
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_depth = "8"
    s.render.image_settings.color_mode = "RGBA" if s.render.film_transparent else "RGB"
    s.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    import time
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    print("RENDERED %s in %.1f s" % (path, dt))
    return dt


def _ship_webp(master_path, out_path, size, max_bytes, alpha):
    """Scale the master inside Blender and write WebP, quality 82 stepping
    down to 72 until it fits. Returns (quality, bytes, fits)."""
    s = bpy.context.scene
    im = bpy.data.images.load(master_path, check_existing=False)
    im.scale(size[0], size[1])
    ims = s.render.image_settings
    ims.file_format = "WEBP"
    ims.color_mode = "RGBA" if alpha else "RGB"
    # the master is already display-referred: write it untouched
    ims.color_management = "OVERRIDE"
    ims.view_settings.view_transform = "Standard"
    ims.view_settings.look = "None"
    ims.view_settings.exposure = 0.0
    ims.view_settings.gamma = 1.0
    q, n = 82, 0
    for q in range(82, 71, -1):
        ims.quality = q
        im.save_render(out_path, scene=s)
        n = os.path.getsize(out_path)
        if n <= max_bytes:
            break
    ims.color_management = "FOLLOW_SCENE"
    bpy.data.images.remove(im)
    fits = n <= max_bytes
    print("SHIPPED %s  %dx%d  q=%d  %d bytes%s" % (out_path, size[0], size[1], q, n,
                                                    "" if fits else "  *** OVER LIMIT ***"))
    return q, n, fits


SAVE_LOG = []


def save_still(name, ship_size=STILL_SHIP, max_bytes=STILL_MAX_BYTES):
    """Preview: renders to masters/preview/<name>.png only.
    Final: master PNG in masters/, shipped WebP in out/."""
    if ARGS.preview:
        p = os.path.join(SCRATCH, name + ".png")
        dt = _render_to(p)
        SAVE_LOG.append(dict(name=name, preview=p, seconds=dt))
        return p
    p = os.path.join(MASTERS, name + ".png")
    dt = _render_to(p)
    o = os.path.join(OUT, name + ".webp")
    os.makedirs(OUT, exist_ok=True)
    q, n, fits = _ship_webp(p, o, ship_size, max_bytes, alpha=False)
    SAVE_LOG.append(dict(name=name, master=p, out=o, seconds=dt, quality=q, bytes=n, fits=fits))
    return o


CUTOUT_LIMITS = {"good": 120 * 1024, "token": 60 * 1024, "object": 150 * 1024}


def save_cutout(name, size, kind="good"):
    """size = shipped (w, h). Master renders at twice that, with alpha."""
    if isinstance(size, int):
        size = (size, size)
    if ARGS.preview:
        p = os.path.join(SCRATCH, name + ".png")
        dt = _render_to(p)
        SAVE_LOG.append(dict(name=name, preview=p, seconds=dt))
        return p
    p = os.path.join(MASTERS, name + ".png")
    dt = _render_to(p)
    o = os.path.join(OUT, name + ".webp")
    q, n, fits = _ship_webp(p, o, size, CUTOUT_LIMITS[kind], alpha=True)
    SAVE_LOG.append(dict(name=name, master=p, out=o, seconds=dt, quality=q, bytes=n, fits=fits))
    return o


def write_log(script_id):
    """Machine-readable record of what this run made, for the reports."""
    import json
    os.makedirs(os.path.join(MASTERS, "logs"), exist_ok=True)
    rec = dict(script=script_id, blender=bpy.app.version_string, gpu=GPU_REPORT,
               mode="final" if ARGS.final else "preview", saves=SAVE_LOG)
    with open(os.path.join(MASTERS, "logs", "%s-%s.json" % (script_id, rec["mode"])), "w") as f:
        json.dump(rec, f, indent=1)
