"""Terrain kit: heightfield ground (dunes, rocky desert, mountains, coast),
the sea surface, and the volumes that go with wide views (ground mist,
blowing sand, rain curtains, falling snow, smoke).

Everything is seeded: the same arguments give the same ground. Heights are
built with numpy and written straight into a mesh, so a 600 x 600 grid is
quick. All sizes in metres.
"""
import math

import bpy
import numpy as np

import common as C


# --------------------------------------------------------------------------
# noise (numpy, seeded)
# --------------------------------------------------------------------------
def _lattice(seed, n=256):
    r = np.random.RandomState(seed)
    return r.rand(n, n).astype(np.float64)


def value_noise(x, y, seed=0):
    """Smooth value noise in about -1..1 on arrays x, y (lattice spacing 1)."""
    L = _lattice(seed)
    n = L.shape[0]
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - xi, y - yi
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = L[xi % n, yi % n]
    b = L[(xi + 1) % n, yi % n]
    c = L[xi % n, (yi + 1) % n]
    d = L[(xi + 1) % n, (yi + 1) % n]
    return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1


def fbm(x, y, scale, octaves=5, seed=0, gain=0.5, lac=2.03):
    v, amp, f, tot = 0.0, 1.0, 1.0 / scale, 0.0
    for o in range(octaves):
        v = v + amp * value_noise(x * f, y * f, seed + o * 17)
        tot += amp
        amp *= gain
        f *= lac
    return v / tot


def ridged(x, y, scale, octaves=6, seed=0, gain=0.5):
    """Ridged multifractal: sharp crests, for mountains and rock."""
    v, amp, f, w = 0.0, 1.0, 1.0 / scale, 1.0
    tot = 0.0
    for o in range(octaves):
        s = 1.0 - np.abs(value_noise(x * f, y * f, seed + o * 31))
        s = s * s * w
        w = np.clip(s * 2.0, 0, 1)
        v = v + s * amp
        tot += amp
        amp *= gain
        f *= 2.0
    return v / tot


# --------------------------------------------------------------------------
# heightfield mesh
# --------------------------------------------------------------------------
def heightfield(name, x0, x1, y0, y1, nx, ny, fn, mat=None, smooth=True, py=1.0, px=1.0):
    """Grid over x0..x1, y0..y1 with nx*ny vertices; fn(X, Y) -> Z arrays.
    py > 1 packs rows toward y0 (near the camera) and spreads them far off;
    px > 1 packs columns toward the middle of x."""
    xs = np.linspace(x0, x1, nx)
    if px != 1.0:
        t = np.linspace(-1, 1, nx)
        xs = (x0 + x1) / 2 + np.sign(t) * np.abs(t) ** px * (x1 - x0) / 2
    ys = y0 + (y1 - y0) * np.linspace(0, 1, ny) ** py
    X, Y = np.meshgrid(xs, ys)
    Z = fn(X, Y)
    co = np.stack([X, Y, Z], -1).reshape(-1, 3).astype(np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(nx * ny)
    me.vertices.foreach_set("co", co.ravel())
    i = np.arange((ny - 1) * (nx - 1))
    r, c = i // (nx - 1), i % (nx - 1)
    a = r * nx + c
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).astype(np.int32)
    nq = len(quads)
    me.loops.add(nq * 4)
    me.loops.foreach_set("vertex_index", quads.ravel())
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", (np.arange(nq) * 4).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(nq, 4, np.int32))
    me.update(calc_edges=True)
    me.validate()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    if mat:
        ob.data.materials.append(mat if isinstance(mat, bpy.types.Material) else C.M(mat))
    _AXES[ob.name] = (xs, ys)
    return ob, Z


_AXES = {}
C.RESET_HOOKS.append(_AXES.clear)


def sample(Z, ob, x, y):
    """Height of a heightfield at (x, y), bilinear."""
    xs, ys = _AXES[ob.name]
    i = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2))
    j = int(np.clip(np.searchsorted(ys, y) - 1, 0, len(ys) - 2))
    fu = (x - xs[i]) / (xs[i + 1] - xs[i])
    fv = (y - ys[j]) / (ys[j + 1] - ys[j])
    a, b, c, d = Z[j, i], Z[j, i + 1], Z[j + 1, i], Z[j + 1, i + 1]
    return float(a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv)


# --------------------------------------------------------------------------
# ground types
# --------------------------------------------------------------------------
def dune_fn(wavelength=180.0, height=38.0, wind_deg=20.0, seed=0, draa=0.6, ripple=0.0):
    """Transverse dunes: long gentle windward slopes, short steep slip
    faces, sinuous crests; a larger, lower swell (draa) underneath.
    Wind blows toward wind_deg (from +X toward +Y)."""
    wa = math.radians(wind_deg)
    dx, dy = math.cos(wa), math.sin(wa)

    def f(X, Y):
        along = X * dx + Y * dy
        across = -X * dy + Y * dx
        warp = fbm(X, Y, wavelength * 2.2, 4, seed) * wavelength * 0.55 + \
            np.sin(across / (wavelength * 1.7)) * wavelength * 0.25
        p = (along + warp) / wavelength
        fr = p - np.floor(p)
        k = 0.78                                      # crest position in the cycle
        prof = np.where(fr < k, (fr / k) ** 1.35, (1 - (fr - k) / (1 - k)) ** 1.6)
        amp = height * (0.65 + 0.35 * fbm(X, Y, wavelength * 3.0, 3, seed + 5))
        z = prof * amp
        z = z + draa * height * fbm(X, Y, wavelength * 5.0, 3, seed + 9)
        return z
    return f


def rocky_fn(scale=400.0, height=120.0, seed=0, base=0.0):
    """Bare eroded desert hills."""
    def f(X, Y):
        r = ridged(X, Y, scale, 6, seed)
        return base + height * (r ** 1.6) + 0.06 * height * fbm(X, Y, scale / 10, 4, seed + 3)
    return f


def mountain_fn(scale=900.0, height=700.0, seed=0):
    def f(X, Y):
        r = ridged(X, Y, scale, 7, seed)
        return height * r ** 1.3 + 0.15 * height * fbm(X, Y, scale / 4, 4, seed + 7)
    return f


# --------------------------------------------------------------------------
# materials for terrain
# --------------------------------------------------------------------------
def dune_sand(colour=(0.80, 0.56, 0.33), ripple=0.16, wind_deg=20.0):
    """Dune sand: warm, fine, with wind ripples (only visible near)."""
    b = C._NB("dune_sand")
    diff, nor, rough, disp = C._tex_paths("sand_01")
    vec = b.coords(0.5)
    t = b.n("ShaderNodeTexImage")
    t.image = C._img(diff)
    t.projection = "BOX"
    b.link(vec, t.inputs["Vector"])
    bw = b.n("ShaderNodeRGBToBW")
    b.link(t.outputs["Color"], bw.inputs[0])
    sh = b.ramp(bw.outputs[0], (0.8, 0.8, 0.8), (1.1, 1.1, 1.1), 0.2, 0.8)
    big = b.noise(b.coords(1.0), 0.004, 3, 0.5)
    c = b.mix(b.math("MULTIPLY", big.outputs["Fac"], 0.55), colour, tuple(x * 0.78 for x in colour))
    # wind-sorted streaks: darker coarse grains in long bands, paler fine sand
    smp = b.n("ShaderNodeMapping")
    smp.inputs["Scale"].default_value = (0.02, 0.2, 1.0)
    smp.inputs["Rotation"].default_value = (0, 0, math.radians(wind_deg))
    tcs = b.n("ShaderNodeTexCoord")
    b.link(tcs.outputs["Object"], smp.inputs["Vector"])
    stk = b.n("ShaderNodeTexNoise", Scale=1.0, Detail=6.0, Roughness=0.65)
    b.link(smp.outputs[0], stk.inputs["Vector"])
    sr = b.ramp(stk.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.4, 0.75)
    c = b.mix(b.math("MULTIPLY", sr.outputs[0], 0.35), c, (colour[0] * 0.72, colour[1] * 0.62, colour[2] * 0.55))
    # crests and steep slip faces: the slip faces darker (coarser sand), crests paler
    geo = b.n("ShaderNodeNewGeometry")
    ns = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], ns.inputs[0])
    steep = b.ramp(ns.outputs["Z"], (1, 1, 1), (0, 0, 0), 0.80, 0.95)
    c = b.mix(b.math("MULTIPLY", steep.outputs[0], 0.25), c, tuple(x * 0.8 for x in colour))
    c = b.mix(1.0, c, sh.outputs[0], "MULTIPLY")
    b.link(c, b.bsdf.inputs["Base Color"])
    # ripples: a wave texture across the wind, warped
    tc = b.n("ShaderNodeTexCoord")
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(wind_deg))
    b.link(tc.outputs["Object"], mp.inputs["Vector"])
    wv = b.n("ShaderNodeTexWave", Scale=1.0 / ripple, Distortion=6.0, Detail=2.0, **{"Detail Scale": 0.5})
    wv.wave_type = "BANDS"
    wv.bands_direction = "X"
    b.link(mp.outputs[0], wv.inputs["Vector"])
    wv2 = b.n("ShaderNodeTexWave", Scale=1.0 / (ripple * 9.0), Distortion=8.0, Detail=3.0)
    wv2.wave_type = "BANDS"
    wv2.bands_direction = "X"
    b.link(mp.outputs[0], wv2.inputs["Vector"])
    rh = b.math("ADD", wv.outputs["Fac"], b.math("MULTIPLY", wv2.outputs["Fac"], 1.4))
    bp = b.bump(rh, 0.16, 0.02)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Roughness=0.9, Sheen_Weight=0.2, Sheen_Tint=(*colour, 1))
    return b.m


def rock_snow_mat(snow_from=0.0, slope=0.62, name="rock_snow"):
    """Snow lying wherever the ground is flatter than `slope` (normal Z),
    bare rock on the steep faces."""
    b = C._NB(name)
    # build both looks in one tree: rock texture colour vs snow white
    diff, nor, rough, disp = C._tex_paths("rock_face")
    vec = b.coords(0.25)
    t = b.n("ShaderNodeTexImage")
    t.image = C._img(diff)
    t.projection = "BOX"
    t.projection_blend = 0.3
    b.link(vec, t.inputs["Vector"])
    geo = b.n("ShaderNodeNewGeometry")
    sep = b.n("ShaderNodeSeparateXYZ")
    b.link(geo.outputs["Normal"], sep.inputs[0])
    nz = b.noise(b.coords(1.0), 0.05, 4, 0.6)
    thr = b.math("ADD", sep.outputs["Z"], b.math("MULTIPLY", b.math("SUBTRACT", nz.outputs["Fac"], 0.5), 0.25))
    m = b.ramp(thr, (0, 0, 0), (1, 1, 1), slope - 0.04, slope + 0.04)
    rc = b.n("ShaderNodeHueSaturation", Saturation=0.45, Value=1.0)
    b.link(t.outputs["Color"], rc.inputs["Color"])
    col = b.mix(m.outputs[0], rc.outputs[0], (0.82, 0.85, 0.90))
    b.link(col, b.bsdf.inputs["Base Color"])
    rr = b.mix(m.outputs[0], (0.85, 0.85, 0.85), (0.55, 0.55, 0.55))
    b.link(rr, b.bsdf.inputs["Roughness"])
    tn = b.n("ShaderNodeTexImage")
    tn.image = C._img(nor, True)
    tn.projection = "BOX"
    tn.projection_blend = 0.3
    b.link(vec, tn.inputs["Vector"])
    nm = b.n("ShaderNodeNormalMap", Strength=1.5)
    b.link(tn.outputs["Color"], nm.inputs["Color"])
    b.link(nm.outputs[0], b.bsdf.inputs["Normal"])
    b.set(Subsurface_Weight=0.15, Subsurface_Radius=(0.3, 0.4, 0.5), Subsurface_Scale=0.02)
    return b.m


# --------------------------------------------------------------------------
# sea surface
# --------------------------------------------------------------------------
def sea(name="Sea", size=4000.0, mat="sea_water", z=0.0, waves=0.6, chop=0.8, seed=1, ocean_size=60.0,
        resolution=12, wind=6.0):
    """A sea plane with Blender's Ocean modifier for waves (seeded); the
    modifier repeats its tile out to `size`."""
    ob = C.box_mesh(name, (1, 1, 0.001), (0, 0, z))
    m = ob.modifiers.new("Ocean", "OCEAN")
    m.geometry_mode = "GENERATE"
    m.resolution = resolution
    m.spatial_size = int(ocean_size)
    m.repeat_x = max(1, int(size / ocean_size))
    m.repeat_y = max(1, int(size / ocean_size))
    m.random_seed = seed
    m.wave_scale = waves
    m.choppiness = chop
    m.wind_velocity = wind
    m.use_normals = True
    m.time = 1.0
    ob.location = (-size / 2, -size / 2, z)
    ob.data.materials.append(C.M(mat) if isinstance(mat, str) else mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def flat_water(name, x0, x1, y0, y1, z, mat, ripple=0.02):
    """Calm water as a plain surface (for still harbours far off)."""
    return C.box_mesh(name, (x1 - x0, y1 - y0, 0.01), ((x0 + x1) / 2, (y0 + y1) / 2, z - 0.005), mat)


# --------------------------------------------------------------------------
# volumes
# --------------------------------------------------------------------------
def _vol_box(name, lo, hi, build):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    ob = C.box_mesh(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    v = nt.nodes.new("ShaderNodeVolumePrincipled")
    nt.links.new(v.outputs[0], out.inputs["Volume"])
    build(nt, v)
    ob.data.materials.append(m)
    ob.visible_shadow = False
    return ob


def ground_mist(lo, hi, density=0.01, colour=(0.85, 0.82, 0.78), falloff=None, name="Mist"):
    """Mist thickest at the ground, thinning with height, broken by noise."""
    z0, z1 = lo[2], hi[2]

    def build(nt, v):
        v.inputs["Color"].default_value = (*colour, 1)
        v.inputs["Anisotropy"].default_value = 0.5
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = -(z1 - z0) / 2
        mr.inputs["From Max"].default_value = (z1 - z0) / 2
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
        pw = nt.nodes.new("ShaderNodeMath")
        pw.operation = "POWER"
        nt.links.new(mr.outputs[0], pw.inputs[0])
        pw.inputs[1].default_value = 2.0
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.02
        nz.inputs["Detail"].default_value = 3
        nt.links.new(tc.outputs["Generated"] if False else tc.outputs["Object"], nz.inputs["Vector"])
        nm = nt.nodes.new("ShaderNodeMath")
        nm.operation = "MULTIPLY"
        nt.links.new(pw.outputs[0], nm.inputs[0])
        nt.links.new(nz.outputs["Fac"], nm.inputs[1])
        dm = nt.nodes.new("ShaderNodeMath")
        dm.operation = "MULTIPLY"
        nt.links.new(nm.outputs[0], dm.inputs[0])
        dm.inputs[1].default_value = density * 2.0
        nt.links.new(dm.outputs[0], v.inputs["Density"])
    return _vol_box(name, lo, hi, build)


def streak_volume(name, lo, hi, density, colour, streak=(0.0, 0.0, 1.0), scale=0.4, thresh=0.55, anis=0.2):
    """A volume of streaks (rain curtains, blowing sand): noise stretched
    along `streak` and thresholded."""
    def build(nt, v):
        v.inputs["Color"].default_value = (*colour, 1)
        v.inputs["Anisotropy"].default_value = anis
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        sx, sy, sz = streak
        mp.inputs["Scale"].default_value = (scale * (0.05 if sx else 1), scale * (0.05 if sy else 1),
                                            scale * (0.05 if sz else 1))
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.0
        nz.inputs["Detail"].default_value = 4
        nt.links.new(mp.outputs[0], nz.inputs["Vector"])
        rp = nt.nodes.new("ShaderNodeMapRange")
        rp.inputs["From Min"].default_value = thresh
        rp.inputs["From Max"].default_value = 0.85
        nt.links.new(nz.outputs["Fac"], rp.inputs["Value"])
        # soften toward the box edges (Generated 0..1)
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        edge = None
        for ax in ("X", "Y", "Z"):
            e = nt.nodes.new("ShaderNodeMath")
            e.operation = "PINGPONG"
            nt.links.new(sep.outputs[ax], e.inputs[0])
            e.inputs[1].default_value = 0.5
            s = nt.nodes.new("ShaderNodeMath")
            s.operation = "MULTIPLY"
            s.use_clamp = True
            nt.links.new(e.outputs[0], s.inputs[0])
            s.inputs[1].default_value = 5.0
            if edge is None:
                edge = s
            else:
                mm = nt.nodes.new("ShaderNodeMath")
                mm.operation = "MULTIPLY"
                nt.links.new(edge.outputs[0], mm.inputs[0])
                nt.links.new(s.outputs[0], mm.inputs[1])
                edge = mm
        a = nt.nodes.new("ShaderNodeMath")
        a.operation = "MULTIPLY"
        nt.links.new(rp.outputs[0], a.inputs[0])
        nt.links.new(edge.outputs[0], a.inputs[1])
        d = nt.nodes.new("ShaderNodeMath")
        d.operation = "MULTIPLY"
        nt.links.new(a.outputs[0], d.inputs[0])
        d.inputs[1].default_value = density
        nt.links.new(d.outputs[0], v.inputs["Density"])
    return _vol_box(name, lo, hi, build)


def smoke(name, base, height=8.0, width=2.0, drift=(3.0, 0.0), density=0.6, colour=(0.55, 0.55, 0.56)):
    """A thin column of smoke rising and drifting: a leaning volume box
    whose density thins upward and is broken by noise."""
    x, y, z = base
    lo = (x - width, y - width, z)
    hi = (x + width + drift[0], y + width + drift[1], z + height)

    def build(nt, v):
        v.inputs["Color"].default_value = (*colour, 1)
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        # centre line leans with height: x_c = 0.5*w/(W) .. drifting
        W = 2 * width + drift[0]
        cx0 = width / W
        cx1 = (width + drift[0]) / W
        lean = nt.nodes.new("ShaderNodeMapRange")
        lean.inputs["To Min"].default_value = cx0
        lean.inputs["To Max"].default_value = cx1
        nt.links.new(sep.outputs["Z"], lean.inputs["Value"])
        dxn = nt.nodes.new("ShaderNodeMath")
        dxn.operation = "SUBTRACT"
        nt.links.new(sep.outputs["X"], dxn.inputs[0])
        nt.links.new(lean.outputs[0], dxn.inputs[1])
        dyn = nt.nodes.new("ShaderNodeMath")
        dyn.operation = "SUBTRACT"
        nt.links.new(sep.outputs["Y"], dyn.inputs[0])
        dyn.inputs[1].default_value = 0.5
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        sx = nt.nodes.new("ShaderNodeMath")
        sx.operation = "MULTIPLY"
        nt.links.new(dxn.outputs[0], sx.inputs[0])
        sx.inputs[1].default_value = W
        sy = nt.nodes.new("ShaderNodeMath")
        sy.operation = "MULTIPLY"
        nt.links.new(dyn.outputs[0], sy.inputs[0])
        sy.inputs[1].default_value = 2 * width
        nt.links.new(sx.outputs[0], cmb.inputs["X"])
        nt.links.new(sy.outputs[0], cmb.inputs["Y"])
        ln = nt.nodes.new("ShaderNodeVectorMath")
        ln.operation = "LENGTH"
        nt.links.new(cmb.outputs[0], ln.inputs[0])
        # radius grows with height
        rad = nt.nodes.new("ShaderNodeMapRange")
        rad.inputs["To Min"].default_value = width * 0.15
        rad.inputs["To Max"].default_value = width * 0.9
        nt.links.new(sep.outputs["Z"], rad.inputs["Value"])
        ratio = nt.nodes.new("ShaderNodeMath")
        ratio.operation = "DIVIDE"
        nt.links.new(ln.outputs["Value"], ratio.inputs[0])
        nt.links.new(rad.outputs[0], ratio.inputs[1])
        core = nt.nodes.new("ShaderNodeMapRange")
        core.inputs["From Min"].default_value = 1.0
        core.inputs["From Max"].default_value = 0.0
        nt.links.new(ratio.outputs[0], core.inputs["Value"])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.6
        nz.inputs["Detail"].default_value = 4
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        fade = nt.nodes.new("ShaderNodeMapRange")
        fade.inputs["To Min"].default_value = 1.0
        fade.inputs["To Max"].default_value = 0.0
        nt.links.new(sep.outputs["Z"], fade.inputs["Value"])
        m1 = nt.nodes.new("ShaderNodeMath")
        m1.operation = "MULTIPLY"
        nt.links.new(core.outputs[0], m1.inputs[0])
        nt.links.new(nz.outputs["Fac"], m1.inputs[1])
        m2 = nt.nodes.new("ShaderNodeMath")
        m2.operation = "MULTIPLY"
        nt.links.new(m1.outputs[0], m2.inputs[0])
        nt.links.new(fade.outputs[0], m2.inputs[1])
        m3 = nt.nodes.new("ShaderNodeMath")
        m3.operation = "MULTIPLY"
        nt.links.new(m2.outputs[0], m3.inputs[0])
        m3.inputs[1].default_value = density
        nt.links.new(m3.outputs[0], v.inputs["Density"])
    return _vol_box(name, lo, hi, build)


def flakes(name, cam, n=6000, near=2.0, far=60.0, size=0.012, seed=0, mat=None, fall=(0.0, 0.0)):
    """Falling snow: small soft flakes scattered through the camera's view
    between `near` and `far` metres. One mesh of tiny quads facing the
    camera, slightly streaked downward."""
    r = np.random.RandomState(seed)
    s = bpy.context.scene
    bpy.context.view_layer.update()          # the camera's matrix must be current
    cd = cam.data
    aspect = s.render.resolution_y / s.render.resolution_x
    half_w = (cd.sensor_width / 2) / cd.lens
    mw = cam.matrix_world
    verts, faces = [], []
    for i in range(n):
        d = near + (far - near) * r.rand() ** 1.6
        u = (r.rand() * 2 - 1) * half_w * d * 1.1
        v = (r.rand() * 2 - 1) * half_w * aspect * d * 1.1
        p = mw @ C.Vector((u, v, -d))
        k = size * (0.6 + 0.8 * r.rand()) * (1 + d * 0.02)
        rx = mw.to_3x3() @ C.Vector((k, 0, 0))
        ry = mw.to_3x3() @ C.Vector((0, k * 1.8, 0))
        o = len(verts)
        verts += [p - rx - ry, p + rx - ry, p + rx + ry, p - rx + ry]
        faces.append((o, o + 1, o + 2, o + 3))
    ob = C.mesh_object(name, verts, faces, mat or C.M("snowflake"))
    ob.visible_shadow = False
    return ob


# --------------------------------------------------------------------------
# rework round: a real ocean surface with foam
# --------------------------------------------------------------------------
def ocean(name="Ocean", tile=200.0, repeat=4, res=14, waves=1.0, chop=1.0, wind=12.0, seed=3,
          align=0.0, direction=0.0, foam=0.5, mat=None, loc=(0, 0, 0), damping=0.5):
    """Blender's Ocean modifier: real wind-driven waves with choppy crests,
    and a 'foam' attribute where they break, read by the ocean_water
    material. One tile of `tile` metres repeated `repeat` times each way,
    centred on loc. Seeded and frozen at a fixed time."""
    ob = C.box_mesh(name, (1, 1, 0.001), (0, 0, 0))
    m = ob.modifiers.new("Ocean", "OCEAN")
    m.geometry_mode = "GENERATE"
    m.resolution = res
    m.viewport_resolution = 6
    m.spatial_size = int(tile)
    m.repeat_x = m.repeat_y = repeat
    m.random_seed = seed
    m.wave_scale = waves
    m.choppiness = chop
    m.wind_velocity = wind
    m.wave_alignment = align
    m.wave_direction = direction
    m.damping = damping
    m.use_normals = True
    m.use_foam = True
    m.foam_layer_name = "foam"
    m.foam_coverage = foam
    m.time = 7.0
    span = tile * repeat
    ob.location = (loc[0] - span / 2, loc[1] - span / 2, loc[2])
    ob.data.materials.append(mat or ocean_water())
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def ocean_water(colour=(0.012, 0.035, 0.040), foam_col=(0.80, 0.83, 0.84), foam_gain=1.0, rough=0.05,
                foam_lo=0.55, foam_hi=0.95, crest=None, streaks=0.0, streak_dir=0.0):
    """Sea water for the Ocean modifier: dark, glossy, a little light
    scattered up through the wave crests, white only where the foam
    attribute is high (the breaking crests), broken up by noise so the
    whitecaps streak and tatter."""
    b = C._NB("ocean_water")
    at = b.n("ShaderNodeAttribute", _attribute_name="foam")
    nz = b.noise(b.coords(1.0), 0.6, 6, 0.7)
    cap = b.band(at.outputs["Fac"], foam_lo, foam_hi)
    if crest:
        # whitecaps from height: only the tops of the waves break
        geo = b.n("ShaderNodeNewGeometry")
        sp = b.n("ShaderNodeSeparateXYZ")
        b.link(geo.outputs["Position"], sp.inputs[0])
        cap = b.math("MULTIPLY", cap, b.band(sp.outputs["Z"], crest[0], crest[1]))
    tatter = b.ramp(nz.outputs["Fac"], (0.0, 0.0, 0.0), (1.3, 1.3, 1.3), 0.45, 0.75).outputs[0]
    fsum = b.math("MULTIPLY", b.math("MULTIPLY", cap, foam_gain), tatter)
    if streaks > 0:
        # a gale draws the foam out into long streaks along the wind
        smp = b.n("ShaderNodeMapping")
        smp.inputs["Scale"].default_value = (0.9, 0.05, 1.0)
        smp.inputs["Rotation"].default_value = (0, 0, streak_dir)
        tcs = b.n("ShaderNodeTexCoord")
        b.link(tcs.outputs["Object"], smp.inputs["Vector"])
        sn = b.n("ShaderNodeTexNoise", Scale=1.2, Detail=8.0, Roughness=0.7)
        b.link(smp.outputs[0], sn.inputs["Vector"])
        sl = b.ramp(sn.outputs["Fac"], (0, 0, 0), (1, 1, 1), 0.56, 0.7).outputs[0]
        fsum = b.math("ADD", fsum, b.math("MULTIPLY", sl, streaks))
    f = b.n("ShaderNodeClamp")
    b.link(fsum, f.inputs["Value"])
    col = b.mix(f.outputs[0], colour, foam_col)
    b.link(col, b.bsdf.inputs["Base Color"])
    rr = b.mix(f.outputs[0], (rough,) * 3, (0.7, 0.7, 0.7))
    b.link(rr, b.bsdf.inputs["Roughness"])
    fine = b.noise(b.coords(1.0), 4.0, 4, 0.6)
    bp = b.bump(fine.outputs["Fac"], 0.15, 0.02)
    b.link(bp.outputs[0], b.bsdf.inputs["Normal"])
    b.set(IOR=1.333, Specular_IOR_Level=0.5, Subsurface_Weight=0.15,
          Subsurface_Radius=(0.1, 0.4, 0.35), Subsurface_Scale=0.5)
    return b.m
