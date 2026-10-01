# Procedural "sculpted" structures for Throneshard: towers, barracks (melee/ranged), throneshards (sunward/duskward),
# fountain and shop. Each structure is modelled from primitives, bevelled, subdivided and noise-displaced for a
# hand-sculpted stone look, decimated to a triangle budget, UV-unwrapped and baked (Cycles) to:
#   <name>_col.png  : albedo x ambient occlusion (team-neutral: tinted regions are baked light/neutral)
#   <name>_mask.png : R = stone tint region, G = metal trim region, B = cloth/roof region (team colours in the shader)
# Glowing parts (runes, windows, lava) are a separate mesh "glow" (team emissive colour set at runtime).
# Team-specific silhouette extras are separate meshes "extra_sunward" / "extra_duskward" (toggled at runtime).
# Objects named after the ModelFactory animation hooks (e.g. "sway") keep their names in the GLB.
#
# usage: blender -b --python tools/blender/structures/build.py -- <outdir> [name ...]
import bpy, bmesh, math, sys, os, random
from mathutils import Vector, Euler, Matrix
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/ws2/structures'
ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)
TEX = int(os.environ.get('STRUCT_TEX', '1024'))
SAMPLES = int(os.environ.get('STRUCT_SAMPLES', '24'))


def B(x, y, z):
    """three.js (Y-up, +Z towards camera) -> Blender (Z-up)."""
    return (x, -z, y)


# ------------------------------------------------------------------ scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for d in list(c):
            c.remove(d)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    w.light_settings.distance = 2.5


MATS = {}


def mat(name, rgb, kind='stone', pattern='stone', rough=0.8, metal=0.0, scale=1.0):
    """kind: mask class (stone|metal|cloth|plain); pattern: procedural albedo detail used for the bake."""
    key = name
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0  # bake albedo only
    tc = N.new('ShaderNodeTexCoord')
    base = N.new('ShaderNodeRGB')
    base.outputs[0].default_value = (*rgb, 1)
    col = base.outputs[0]

    def mul(a, b):
        mx = N.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1.0
        L.new(a, mx.inputs[6])
        L.new(b, mx.inputs[7])
        return mx.outputs[2]

    def maprange(src, a, b, c, d):
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = a
        mr.inputs['From Max'].default_value = b
        mr.inputs['To Min'].default_value = c
        mr.inputs['To Max'].default_value = d
        L.new(src, mr.inputs['Value'])
        return mr.outputs[0]

    noise = N.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 5.0 * scale
    noise.inputs['Detail'].default_value = 6.0
    L.new(tc.outputs['Object'], noise.inputs['Vector'])
    nval = maprange(noise.outputs['Fac'], 0.3, 0.7, 0.78, 1.12)
    if pattern == 'stone':
        vor = N.new('ShaderNodeTexVoronoi')
        vor.feature = 'DISTANCE_TO_EDGE'
        vor.inputs['Scale'].default_value = 1.6 * scale
        L.new(tc.outputs['Object'], vor.inputs['Vector'])
        edge = maprange(vor.outputs['Distance'], 0.0, 0.07, 0.45, 1.0)
        # per-block tint variation
        vor2 = N.new('ShaderNodeTexVoronoi')
        vor2.inputs['Scale'].default_value = 1.6 * scale
        L.new(tc.outputs['Object'], vor2.inputs['Vector'])
        blk = maprange(vor2.outputs['Distance'], 0.0, 1.0, 0.86, 1.08)
        col = mul(mul(mul(col, nval), edge), blk)
    elif pattern in ('wood', 'bark'):
        wave = N.new('ShaderNodeTexWave')
        wave.wave_type = 'BANDS'
        wave.bands_direction = 'Z' if pattern == 'bark' else 'X'
        wave.inputs['Scale'].default_value = 3.0 * scale
        wave.inputs['Distortion'].default_value = 6.0
        wave.inputs['Detail'].default_value = 4.0
        L.new(tc.outputs['Object'], wave.inputs['Vector'])
        col = mul(mul(col, maprange(wave.outputs['Fac'], 0.0, 1.0, 0.7, 1.08)), nval)
    elif pattern == 'leaf':
        vor = N.new('ShaderNodeTexVoronoi')
        vor.inputs['Scale'].default_value = 6.0 * scale
        L.new(tc.outputs['Object'], vor.inputs['Vector'])
        col = mul(mul(col, maprange(vor.outputs['Distance'], 0.0, 0.9, 1.15, 0.65)), nval)
    else:
        col = mul(col, maprange(noise.outputs['Fac'], 0.3, 0.7, 0.9, 1.05))
    L.new(col, bsdf.inputs['Base Color'])
    m['kind'] = kind
    m['rough'] = rough
    m['metal'] = metal
    MATS[key] = m
    return m


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def new_obj(name, bm_fn, material, loc=(0, 0, 0), rotxyz=(0, 0, 0), scl=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm_fn(bm)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc
    ob.rotation_euler = rotxyz
    ob.scale = scl
    me.materials.append(material)
    return ob


def cyl(r1, r2, h, seg=8, cap=True):
    def f(bm):
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    return f


def box(x, y, z):
    def f(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(x, y, z), verts=bm.verts)
    return f


def ico(r, sub=2):
    def f(bm):
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    return f


def torus(R, r, seg=16, rseg=6):
    def f(bm):
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                verts.append(bm.verts.new(p))
        for i in range(seg):
            for j in range(rseg):
                a = verts[i * rseg + j]
                b = verts[((i + 1) % seg) * rseg + j]
                c = verts[((i + 1) % seg) * rseg + (j + 1) % rseg]
                d = verts[i * rseg + (j + 1) % rseg]
                bm.faces.new((a, b, c, d))
    return f


# three-space placement (pos in three coords, rotxyz = three Euler XYZ radians applied in three space)
def put(name, fn, material, pos=(0, 0, 0), rotxyz=(0, 0, 0), scl=None, three_scale=None):
    ob = new_obj(name, fn, material)
    # convert: three rotation (x, y, z) -> Blender: x -> x, y(up) -> z, z -> -y
    ob.rotation_mode = 'YZX'
    ob.rotation_euler = Euler((rotxyz[0], -rotxyz[2], rotxyz[1]), 'YZX')
    ob.location = B(*pos)
    if three_scale:
        sx, sy, sz = three_scale
        ob.scale = (sx, sz, sy)
    return ob


def ring(n, fn, off=0.0):
    return [fn(off + 2 * math.pi * i / n, i) for i in range(n)]


# ------------------------------------------------------------------ "sculpt" + finishing
_TEX = {}


def ntex(kind, size):
    k = (kind, size)
    if k not in _TEX:
        t = bpy.data.textures.new('%s%.2f' % (kind, size), type=kind)
        t.noise_scale = size
        if kind == 'VORONOI':
            t.distance_metric = 'DISTANCE'
        _TEX[k] = t
    return _TEX[k]


def sculpt(ob, bevel=0.06, sub=2, chip=0.05, lumps=0.05, size=1.0):
    """Bevel + simple subdivision + two noise displacements (large lumps + chipped cells), then apply."""
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL')
        bv.width = bevel
        bv.segments = 2
        bv.limit_method = 'ANGLE'
    if sub:
        sd = ob.modifiers.new('sub', 'SUBSURF')
        sd.subdivision_type = 'SIMPLE'
        sd.levels = sub
        sd.render_levels = sub
    if lumps:
        d1 = ob.modifiers.new('lump', 'DISPLACE')
        d1.texture = ntex('CLOUDS', 0.6 * size)
        d1.texture_coords = 'GLOBAL'
        d1.strength = lumps
        d1.mid_level = 0.5
    if chip:
        d2 = ob.modifiers.new('chip', 'DISPLACE')
        d2.texture = ntex('VORONOI', 0.35 * size)
        d2.texture_coords = 'GLOBAL'
        d2.strength = -chip
        d2.mid_level = 0.0
    apply_mods(ob)
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)


def join(objs, name):
    objs = [o for o in objs if o]
    for o in objs:
        apply_mods(o)
    ctx = {'active_object': objs[0], 'object': objs[0], 'selected_objects': objs, 'selected_editable_objects': objs}
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def drop_hidden(ob):
    """Remove faces that point straight down (never seen from the RTS camera) to save UV space and triangles."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    bad = [f for f in bm.faces if f.normal.z < -0.85]
    bmesh.ops.delete(bm, geom=bad, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate(ob, budget):
    t = tris(ob)
    if t > budget:
        d = ob.modifiers.new('dec', 'DECIMATE')
        d.ratio = budget / t
        d.use_collapse_triangulate = True
        apply_mods(ob)
    # smooth-ish shading with sharp edges kept
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    except Exception as e:  # noqa
        print('smooth by angle failed', e)
    return ob


def unwrap(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)  # guarantees non-overlapping islands for baking
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_body(ob, name):
    """Bake AO, albedo and region mask for the joined body mesh; replace its materials with one textured material."""
    size = TEX
    col = bpy.data.images.new(name + '_col', size, size, alpha=False)
    ao = bpy.data.images.new(name + '_ao', size, size, alpha=False)
    msk = bpy.data.images.new(name + '_mask', size, size, alpha=False)
    mats = [s.material for s in ob.material_slots if s.material]
    nodes = []
    for m in mats:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        m.node_tree.nodes.active = n
        nodes.append(n)
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    sc = bpy.context.scene
    sc.render.bake.margin = 6

    def bake(img, typ, **kw):
        for n in nodes:
            n.image = img
        bpy.ops.object.bake(type=typ, use_clear=True, margin=6, **kw)

    bake(ao, 'AO')
    bake(col, 'DIFFUSE', pass_filter={'COLOR'})
    # region mask via emission
    for m in mats:
        bs = m.node_tree.nodes['Principled BSDF']
        k = m.get('kind', 'plain')
        c = {'stone': (1, 0, 0), 'metal': (0, 1, 0), 'cloth': (0, 0, 1)}.get(k, (0, 0, 0))
        bs.inputs['Emission Color'].default_value = (*c, 1)
        bs.inputs['Emission Strength'].default_value = 1.0
    bake(msk, 'EMIT')
    # albedo x AO (AO softened), then save
    a = np.array(ao.pixels[:]).reshape(-1, 4)
    c = np.array(col.pixels[:]).reshape(-1, 4)
    occ = 0.3 + 0.7 * np.clip(a[:, :1], 0, 1)
    c[:, :3] = np.clip(c[:, :3] * occ, 0, 1)
    col.pixels[:] = c.ravel()
    for img in (col, msk):
        img.filepath_raw = os.path.join(OUT, img.name + '.png')
        img.file_format = 'PNG'
        img.save()
    # roughness/metal hints go to the runtime shader via the mask; single export material:
    ob.data.materials.clear()
    m = bpy.data.materials.new(name + '_body')
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes['Principled BSDF']
    t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = col
    t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = msk
    t2.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(t1.outputs['Color'], bs.inputs['Base Color'])
    nt.links.new(t2.outputs['Color'], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = 1.0
    bs.inputs['Roughness'].default_value = 0.8
    ob.data.materials.append(m)


def glow_mat():
    m = bpy.data.materials.get('glow') or bpy.data.materials.new('glow')
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.2, 1, 0.5, 1)
    bs.inputs['Emission Color'].default_value = (0.2, 1, 0.5, 1)
    bs.inputs['Emission Strength'].default_value = 2.0
    return m


def finish_simple(objs, name, budget, material):
    """Join small parts (glow / team extras) without baking."""
    objs = [o for o in objs if o]
    if not objs:
        return None
    ob = join(objs, name)
    decimate(ob, budget)
    ob.data.materials.clear()
    ob.data.materials.append(material)
    return ob


def export(name):
    path = os.path.join(OUT, name + '.glb')
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='AUTO')
    info = {o.name: tris(o) for o in bpy.context.scene.objects if o.type == 'MESH'}
    print('BUILT', name, info)


def build(name, parts_fn, budget):
    reset()
    MATS.clear()
    _TEX.clear()
    body, glow, extras = parts_fn()
    ob = join(body, 'body')
    drop_hidden(ob)
    decimate(ob, budget)
    unwrap(ob)
    bake_body(ob, name)
    finish_simple(glow, 'glow', 3000, glow_mat())
    for k, lst in (extras or {}).items():
        finish_simple(lst, k, 2500, mat('extra_' + k, (0.2, 0.15, 0.15), 'plain', 'plain'))
    export(name)


# ------------------------------------------------------------------ materials (team-neutral albedo)
def STONE():
    return mat('stone', (0.80, 0.78, 0.74), 'stone', 'stone', 0.85)


def STONE_B():
    return mat('stoneB', (0.66, 0.64, 0.61), 'stone', 'stone', 0.9, scale=1.3)


def METAL():
    return mat('metal', (0.85, 0.85, 0.85), 'metal', 'plain', 0.35, 0.8)


def CLOTH():
    return mat('cloth', (0.85, 0.85, 0.85), 'cloth', 'plain', 0.9)


def ROOF():
    return mat('roof', (0.85, 0.85, 0.85), 'cloth', 'stone', 0.75, scale=2.6)


def WOOD():
    return mat('wood', (0.14, 0.07, 0.035), 'plain', 'wood', 0.85)


# ------------------------------------------------------------------ TOWER (~9 tall, crystal added at runtime at y=7.9)
def tower():
    S, SB, MT = STONE(), STONE_B(), METAL()
    body, glow = [], []
    body.append(sculpt(put('b0', cyl(2.5, 2.3, 0.6, 8), SB, (0, 0.3, 0)), 0.08, 2, 0.07, 0.08))
    body.append(sculpt(put('b1', cyl(2.2, 2.0, 0.5, 8), S, (0, 0.85, 0)), 0.06, 2, 0.05, 0.06))
    body.append(sculpt(put('b2', cyl(1.95, 1.85, 0.35, 8), SB, (0, 1.25, 0)), 0.04, 2, 0.03, 0.03))
    for a, i in ring(8, lambda a, i: (a, i), math.pi / 8):  # rune plates on the band
        glow.append(put('rune%d' % i, box(0.28, 0.06, 0.18), None or glow_mat(), (math.cos(a) * 1.93, 1.25, math.sin(a) * 1.93), (0, -a + math.pi / 2, 0)))
    for a, i in ring(4, lambda a, i: (a, i), math.pi / 4):
        body.append(sculpt(put('but%d' % i, box(0.6, 1.3, 2.4), SB, (math.cos(a) * 1.6, 1.5, math.sin(a) * 1.6), (0, -a, 0.1)), 0.08, 2, 0.06, 0.06))
    shaft = put('shaft', cyl(1.45, 1.15, 4.4, 12), S, (0, 3.6, 0))
    body.append(sculpt(shaft, 0.05, 3, 0.06, 0.07, 0.8))
    body.append(put('ring1', torus(1.42, 0.12, 16, 6), MT, (0, 1.55, 0)))
    body.append(sculpt(put('band', cyl(1.36, 1.32, 0.45, 12), SB, (0, 3.4, 0)), 0.03, 2, 0.03, 0.02))
    body.append(put('ring2', torus(1.2, 0.1, 16, 6), MT, (0, 5.75, 0)))
    for a, i in ring(4, lambda a, i: (a, i)):
        glow.append(put('win%d' % i, box(0.24, 0.2, 0.8), glow_mat(), (math.cos(a) * 1.24, 4.6, math.sin(a) * 1.24), (0, -a + math.pi / 2, 0)))
        body.append(put('winf%d' % i, box(0.5, 0.25, 0.14), MT, (math.cos(a) * 1.3, 5.08, math.sin(a) * 1.3), (0, -a + math.pi / 2, 0)))
    body.append(sculpt(put('plat', cyl(1.25, 1.8, 0.5, 8), SB, (0, 6.1, 0)), 0.05, 2, 0.05, 0.05))
    body.append(put('rim', torus(1.78, 0.12, 24, 6), MT, (0, 6.38, 0)))
    for a, i in ring(8, lambda a, i: (a, i)):
        body.append(sculpt(put('cren%d' % i, box(0.4, 0.45, 0.4), S, (math.cos(a) * 1.68, 6.72, math.sin(a) * 1.68), (0, -a, 0)), 0.05, 2, 0.04, 0.04))
    # four slim pillars holding the crystal
    for a, i in ring(4, lambda a, i: (a, i), math.pi / 4):
        x, z = math.cos(a) * 1.35, math.sin(a) * 1.35
        body.append(sculpt(put('pil%d' % i, cyl(0.2, 0.14, 1.7, 8), S, (x, 7.35, z), (math.sin(a) * 0.18, 0, -math.cos(a) * 0.18)), 0.02, 1, 0.02, 0.02))
        body.append(put('cap%d' % i, cyl(0.24, 0.02, 0.55, 8), MT, (x * 1.08, 8.45, z * 1.08)))
    extras = {
        'extra_duskward': [put('sp%d' % i, cyl(0.24, 0.0, 1.8, 6), None or mat('ex', (0.2, 0.15, 0.15), 'plain', 'plain'),
                           (math.cos(a) * 2.25, 1.1, math.sin(a) * 2.25), (math.sin(a) * 0.8, 0, -math.cos(a) * 0.8))
                       for a, i in ring(8, lambda a, i: (a, i), math.pi / 8)]
        + [put('tsp%d' % i, cyl(0.2, 0.0, 1.5, 6), mat('ex', (0.2, 0.15, 0.15), 'plain', 'plain'),
               (math.cos(a) * 1.75, 6.9, math.sin(a) * 1.75), (math.sin(a) * 0.5, 0, -math.cos(a) * 0.5))
           for a, i in ring(6, lambda a, i: (a, i))],
        'extra_sunward': [put('lf%d' % i, cyl(0.02, 0.2, 0.7, 6), mat('ex', (0.2, 0.15, 0.15), 'plain', 'plain'),
                              (math.cos(a) * 2.05, 1.35, math.sin(a) * 2.05), (math.sin(a) * -0.5, 0, -math.cos(a) * -0.5))
                          for a, i in ring(8, lambda a, i: (a, i), math.pi / 8)],
    }
    return body, glow, extras


# ------------------------------------------------------------------ BARRACKS (~6 tall)
def tri_prism(depth, h, thick):
    """Gable-end board: triangle (base `depth` along three-z, apex `h` up) extruded `thick` along three-x. Blender coords."""
    def f(bm):
        pts = [(0, -depth / 2, 0), (0, depth / 2, 0), (0, 0, h)]
        a = [bm.verts.new((-thick / 2, y, z)) for _, y, z in pts]
        b = [bm.verts.new((thick / 2, y, z)) for _, y, z in pts]
        bm.faces.new(a[::-1])
        bm.faces.new(b)
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new((a[i], a[j], b[j], b[i]))
    return f


def gable_roof(SB, MT):
    """Melee barracks roof: two pitched slopes along X with stepped shingle courses, a metal ridge cap,
    eave trim and gable-end boards, so the profile reads from the top-down camera. ~1.4k tris after sculpt."""
    out = []
    eave, rise, half, L_x = 3.95, 1.75, 2.75, 6.1
    th = math.atan2(rise, half)
    slope = math.hypot(rise, half)
    ridge_y = eave + rise
    n = 5
    for side in (1, -1):
        rx = th * side
        nrm = (0, math.cos(th), side * math.sin(th))
        down = (0, -math.sin(th), side * math.cos(th))
        # base slab, blender-native box(x, depth, height)
        c = (0, ridge_y + down[1] * slope / 2 - 0.06, side * half / 2)
        out.append(sculpt(put('slab%d' % side, box(L_x, slope, 0.16), ROOF(), c, (rx, 0, 0)), 0.02, 1, 0.02, 0.02))
        for k in range(n):
            s = slope * (k + 0.5) / n
            lift = 0.09 + 0.02 * k
            p = (0, ridge_y + down[1] * s + nrm[1] * lift, side * (half * (k + 0.5) / n * 1.0) + nrm[2] * lift)
            length = slope / n * 0.86
            mat_ = ROOF() if k % 2 == 0 else SB
            out.append(sculpt(put('crs%d_%d' % (side, k), box(L_x - 0.1 * k * 0.4, length, 0.12), mat_, p, (rx + side * 0.07, 0, 0)), 0.02, 1, 0.02, 0.0))
    # ridge cap + eave trim
    out.append(sculpt(put('ridge', box(L_x + 0.5, 0.36, 0.3), MT, (0, ridge_y + 0.06, 0)), 0.04, 1, 0.02, 0.0))
    for side in (1, -1):
        out.append(sculpt(put('eave%d' % side, box(L_x + 0.2, 0.2, 0.22), MT, (0, eave - 0.02, side * (half + 0.05)), (0, 0, 0)), 0.03, 1, 0.02, 0.0))
    for sx in (-1, 1):
        out.append(sculpt(put('gab%d' % sx, tri_prism(half * 2 - 0.4, rise - 0.15, 0.24), SB, (sx * (L_x / 2 - 0.15), eave + 0.0, 0)), 0.02, 1, 0.02, 0.0))
    return out


def barracks(ranged):
    S, SB, MT, CL, WD = STONE(), STONE_B(), METAL(), CLOTH(), WOOD()
    body, glow = [], []
    body.append(sculpt(put('p0', box(6.4, 0.5, 6.4), SB, (0, 0.25, 0)), 0.08, 2, 0.07, 0.07))
    body.append(sculpt(put('p1', box(5.8, 0.4, 5.8), S, (0, 0.7, 0)), 0.06, 2, 0.05, 0.05))
    for k in range(3):
        body.append(sculpt(put('st%d' % k, box(2.2 - k * 0.2, 0.18, 0.5), S, (0, 0.09 + k * 0.18, 3.55 - k * 0.3)), 0.03, 1, 0.03, 0.02))
    if not ranged:
        body.append(sculpt(put('hall', box(4.4, 2.8, 4.4), S, (0, 2.3, 0)), 0.08, 3, 0.07, 0.06, 0.8))
        body.append(put('trim', box(4.7, 0.3, 4.7), MT, (0, 3.8, 0)))
        body.extend(gable_roof(SB, MT))
        body.append(put('fin', cyl(0.18, 0.02, 0.9, 8), MT, (0, 6.45, 0)))
        glow.append(put('orb', ico(0.28, 2), glow_mat(), (0, 6.35, 0)))
        for s in (-1, 1):
            glow.append(put('emb%d' % s, box(0.12, 1.2, 0.08), glow_mat(), (0, 3.2, 2.25), (0, 0, 0.6 * s)))
    else:
        body.append(sculpt(put('hall', cyl(2.5, 2.3, 2.8, 16), S, (0, 2.3, 0)), 0.06, 2, 0.07, 0.06, 0.8))
        body.append(put('trim', cyl(2.6, 2.6, 0.3, 20), MT, (0, 3.8, 0)))
        body.append(sculpt(put('roof', cyl(2.9, 0.1, 1.5, 16), ROOF(), (0, 4.65, 0)), 0.03, 2, 0.03, 0.03))
        body.append(sculpt(put('spire', cyl(0.35, 0.25, 1.2, 8), SB, (0, 5.6, 0)), 0.03, 1, 0.02, 0.02))
        glow.append(put('ring', torus(0.45, 0.05, 16, 4), glow_mat(), (0, 3.2, 2.4), (math.pi / 2, 0, 0)))
        glow.append(put('bar', box(1.0, 0.08, 0.08), glow_mat(), (0, 3.2, 2.45)))
    # corner pillars
    for a, i in ring(4, lambda a, i: (a, i), math.pi / 4):
        x, z = math.cos(a) * 3.1, math.sin(a) * 3.1
        body.append(sculpt(put('col%d' % i, cyl(0.4, 0.35, 3.6, 10), SB, (x, 2.7, z)), 0.03, 2, 0.04, 0.04))
        body.append(put('colc%d' % i, box(0.9, 0.3, 0.9), MT, (x, 4.6, z)))
        body.append(put('colt%d' % i, cyl(0.35, 0.02, 0.7, 8), MT, (x, 5.1, z)))
    body.append(sculpt(put('door', box(1.3, 1.9, 0.22), WD, (0, 1.85, 2.35 if ranged else 2.25)), 0.03, 1, 0.02, 0.01))
    body.append(put('doorf', box(1.6, 0.25, 0.3), MT, (0, 2.9, 2.36 if ranged else 2.26)))
    for s in (-1, 1):
        body.append(put('ban%d' % s, box(0.06, 2.0, 0.9), CL, (s * (2.55 if ranged else 2.25), 2.4, 0)))
    extras = {
        'extra_duskward': [put('dsp%d' % i, cyl(0.28, 0.0, 1.5, 6), mat('ex', (0.2, 0.15, 0.15), 'plain', 'plain'),
                           (math.cos(a) * 3.1, 5.6, math.sin(a) * 3.1)) for a, i in ring(4, lambda a, i: (a, i), math.pi / 4)],
    }
    return body, glow, extras


# ------------------------------------------------------------------ FOUNTAIN (~6)
def fountain():
    S, SB, MT = STONE(), STONE_B(), METAL()
    body, glow = [], []
    body.append(sculpt(put('f0', cyl(5.0, 4.6, 0.4, 24), SB, (0, 0.2, 0)), 0.06, 2, 0.06, 0.06))
    body.append(sculpt(put('lip', torus(4.1, 0.38, 32, 8), S, (0, 0.75, 0)), 0, 1, 0.05, 0.05))
    body.append(put('floor', cyl(4.0, 4.0, 0.3, 32), SB, (0, 0.5, 0)))
    body.append(sculpt(put('col', cyl(0.9, 0.6, 3.4, 10), S, (0, 2.2, 0)), 0.04, 2, 0.05, 0.05))
    body.append(sculpt(put('bowl', cyl(0.6, 1.3, 0.5, 12), SB, (0, 4.0, 0)), 0.04, 2, 0.04, 0.03))
    body.append(put('bowlr', torus(1.3, 0.08, 20, 5), MT, (0, 4.25, 0)))
    for a, i in ring(8, lambda a, i: (a, i)):
        glow.append(put('rn%d' % i, box(0.25, 0.1, 0.35), glow_mat(), (math.cos(a) * 1.18, 4.0, math.sin(a) * 1.18), (0, -a + math.pi / 2, 0)))
    for a, i in ring(4, lambda a, i: (a, i), math.pi / 4):
        x, z = math.cos(a) * 4.6, math.sin(a) * 4.6
        body.append(sculpt(put('ob%d' % i, box(0.55, 2.4, 0.55), S, (x, 1.5, z), (0, -a, 0)), 0.04, 2, 0.04, 0.03))
        glow.append(put('obg%d' % i, cyl(0.42, 0.0, 0.6, 4), glow_mat(), (x, 3.0, z), (0, math.pi / 4, 0)))
    return body, glow, {}


# ------------------------------------------------------------------ SHOP (~3.8)
def shop():
    S, WD, CL, MT = STONE(), WOOD(), CLOTH(), METAL()
    body, glow = [], []
    body.append(sculpt(put('deck', box(4.0, 0.3, 3.2), WD, (0, 0.15, 0)), 0.03, 1, 0.02, 0.02))
    body.append(sculpt(put('hut', box(3.4, 2.0, 2.4), S, (0, 1.3, -0.3)), 0.06, 2, 0.05, 0.05))
    body.append(sculpt(put('roof', cyl(2.8 * 1.2, 0.02, 1.6, 4), ROOF(), (0, 3.1, -0.3), (0, math.pi / 4, 0)), 0.03, 2, 0.02, 0.03))
    body.append(put('awn', box(3.6, 0.08, 1.2), CL, (0, 2.1, 1.3), (0.35, 0, 0)))
    for s in (-1, 1):
        body.append(put('post%d' % s, cyl(0.07, 0.07, 2.1, 6), WD, (s * 1.7, 1.05, 1.8)))
    body.append(sculpt(put('ctr', box(3.2, 0.9, 0.5), WD, (0, 0.75, 1.1)), 0.03, 1, 0.02, 0.01))
    body.append(sculpt(put('crate', box(0.6, 0.6, 0.6), WD, (-1.9, 0.6, 1.3), (0, 0.4, 0)), 0.03, 1, 0.02, 0.01))
    body.append(sculpt(put('barrel', cyl(0.35, 0.35, 0.8, 12), WD, (2.0, 0.7, 1.2)), 0.02, 1, 0.01, 0.01))
    body.append(put('coin', cyl(0.4, 0.4, 0.08, 16), MT, (0, 2.6, 1.0), (math.pi / 2, 0, 0)))
    glow.append(put('g1', ico(0.15, 1), glow_mat(), (0.8, 1.35, 1.1)))
    glow.append(put('g2', ico(0.15, 1), glow_mat(), (-0.6, 1.35, 1.1)))
    glow.append(put('g3', ico(0.15, 1), glow_mat(), (0.1, 1.35, 1.1)))
    return body, glow, {}


# ------------------------------------------------------------------ THRONESHARDS (~12)
def bend_cyl(name, material, pts, r0, r1, seg=10):
    """Tube along a list of three-space points."""
    def f(bm):
        rings_ = []
        n = len(pts)
        for k, p in enumerate(pts):
            p = Vector(B(*p))
            q = Vector(B(*pts[min(n - 1, k + 1)])) - Vector(B(*pts[max(0, k - 1)]))
            q.normalize()
            ax = q.orthogonal().normalized()
            ay = q.cross(ax).normalized()
            r = r0 + (r1 - r0) * k / (n - 1)
            rings_.append([bm.verts.new(p + (ax * math.cos(2 * math.pi * j / seg) + ay * math.sin(2 * math.pi * j / seg)) * r) for j in range(seg)])
        for k in range(n - 1):
            for j in range(seg):
                bm.faces.new((rings_[k][j], rings_[k][(j + 1) % seg], rings_[k + 1][(j + 1) % seg], rings_[k + 1][j]))
        bm.faces.new(rings_[-1][::-1])
    return new_obj(name, f, material)


def throneshard_sunward():
    S, SB, MT = STONE(), STONE_B(), METAL()
    BARK = mat('bark', (0.62, 0.52, 0.38), 'plain', 'bark', 0.8)
    LEAF = mat('leaf', (0.05, 0.2, 0.035), 'plain', 'leaf', 0.8)
    LEAF2 = mat('leaf2', (0.11, 0.32, 0.05), 'plain', 'leaf', 0.8, scale=1.3)
    body, glow = [], []
    body.append(sculpt(put('t0', cyl(6.0, 5.6, 0.6, 16), SB, (0, 0.3, 0)), 0.08, 2, 0.07, 0.08))
    body.append(sculpt(put('t1', cyl(5.2, 4.8, 0.6, 16), S, (0, 0.9, 0)), 0.06, 2, 0.06, 0.06))
    body.append(put('t2', cyl(4.3, 4.2, 0.25, 24), MT, (0, 1.32, 0)))
    rnd = random.Random(5)
    for k in range(5):  # twisted trunk strands
        a0 = 2 * math.pi * k / 5
        pts = []
        for s in range(9):
            t = s / 8
            r = 1.25 - t * 0.7
            a = a0 + t * 2.0
            pts.append((math.cos(a) * r, 1.2 + t * 7.4, math.sin(a) * r))
        body.append(sculpt(bend_cyl('str%d' % k, BARK, pts, 0.55, 0.3, 10), 0, 1, 0.04, 0.08, 0.7))
    for k in range(7):  # roots
        a = 2 * math.pi * k / 7 + 0.3
        pts = [(math.cos(a) * (1.0 + t * 3.6), 3.4 - t * 2.3 - (t * t) * 0.2, math.sin(a) * (1.0 + t * 3.6)) for t in [i / 5 for i in range(6)]]
        body.append(sculpt(bend_cyl('root%d' % k, BARK, pts, 0.5, 0.12, 8), 0, 1, 0.03, 0.06, 0.7))
    canopy = []
    blobs = [(0, 10.2, 0, 2.6), (1.9, 9.3, 0.6, 1.9), (-1.8, 9.4, -0.4, 2.0), (0.5, 9.2, -1.9, 1.8), (-0.6, 9.0, 1.9, 1.8),
             (0.2, 11.4, 0.3, 1.5), (2.4, 8.4, -1.2, 1.2), (-2.3, 8.3, 1.3, 1.3)]
    for i, (x, y, z, r) in enumerate(blobs):
        canopy.append(sculpt(put('leaf%d' % i, ico(r, 3), LEAF if i % 2 else LEAF2, (x, y, z), (0, 0, 0), three_scale=(1, 0.8, 1)), 0, 0, 0.12, 0.35, 0.5))
    for a, i in ring(10, lambda a, i: (a, i)):
        glow.append(put('bl%d' % i, ico(0.22, 1), glow_mat(), (math.cos(a) * (2.3 + (i % 3) * 0.4), 8.3 + (i % 4) * 0.8, math.sin(a) * (2.3 + (i % 3) * 0.4))))
    for a, i in ring(12, lambda a, i: (a, i)):
        glow.append(put('rn%d' % i, box(0.4, 0.06, 0.2), glow_mat(), (math.cos(a) * 4.25, 1.46, math.sin(a) * 4.25), (0, -a, 0)))
    return body + canopy, glow, {}


def throneshard_duskward():
    ROCK = mat('rock', (0.075, 0.055, 0.06), 'plain', 'stone', 0.85, scale=0.8)
    ROCK2 = mat('rock2', (0.035, 0.025, 0.03), 'plain', 'stone', 0.9, scale=1.2)
    body, glow = [], []
    body.append(sculpt(put('d0', cyl(6.2, 5.6, 0.7, 9), ROCK2, (0, 0.35, 0)), 0.1, 2, 0.1, 0.12))
    body.append(sculpt(put('d1', cyl(5.3, 4.6, 0.6, 9), ROCK, (0, 1.0, 0)), 0.08, 2, 0.08, 0.1))
    spires = [(0, 0, 1.9, 11.5, 0, 0), (1.6, 0.6, 1.2, 7.5, 0.25, 0.1), (-1.4, 0.9, 1.1, 8.2, -0.2, 0.2), (0.4, -1.7, 1.0, 6.8, -0.1, -0.3),
              (-1.0, -1.2, 0.9, 5.5, -0.35, -0.2), (2.1, -1.2, 0.8, 5.0, 0.3, -0.25), (-2.3, 0.0, 0.8, 4.5, -0.4, 0)]
    for i, (x, z, r, h, rz, rx) in enumerate(spires):
        o = put('sp%d' % i, cyl(r, r * 0.05, h, 7), ROCK if i % 2 else ROCK2, (x, 1.2 + h / 2, z), (rx, i, rz))
        body.append(sculpt(o, 0.06, 3, 0.14, 0.18, 0.6))
        # lava veins
        glow.append(put('vein%d' % i, cyl(r * 0.35, 0.02, h * 0.7, 5), glow_mat(), (x * 1.08, 1.2 + h * 0.4, z * 1.08 + 0.25), (rx, i + 0.3, rz)))
    glow.append(put('pool', cyl(4.3, 4.3, 0.05, 24), glow_mat(), (0, 1.32, 0)))
    for a, i in ring(5, lambda a, i: (a, i)):
        body.append(put('cage%d' % i, cyl(0.12, 0.0, 2.4, 5), ROCK2, (math.cos(a) * 1.2, 5.2, 1.7 + math.sin(a) * 1.2), (math.sin(a) * 0.4, 0, -math.cos(a) * 0.4)))
    return body, glow, {}


BUILDS = {
    'tower': (tower, 9000),
    'barracks_melee': (lambda: barracks(False), 7000),
    'barracks_ranged': (lambda: barracks(True), 7000),
    'fountain': (fountain, 7000),
    'shop': (shop, 5000),
    'throneshard_sunward': (throneshard_sunward, 14000),
    'throneshard_duskward': (throneshard_duskward, 12000),
}

for n, (fn, budget) in BUILDS.items():
    if ONLY and n not in ONLY:
        continue
    try:
        build(n, fn, budget)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('FAILED', n, e)
