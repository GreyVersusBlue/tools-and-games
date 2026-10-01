# Procedural armour / accessory builders. All functions take a Char (charkit) and return the created object(s),
# already skinned to the rig. Coordinates: Blender Z-up, characters face -Y, their left side is +X.
from charkit import *


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def BH(C, b):
    return bone_head(C.arm, b)


def BT(C, b):
    return bone_tail(C.arm, b)


def sgn(side):
    return 1 if side == 'l' else -1


# ------------------------------------------------------------------------------------------------ weights helpers
def w_blend(a, b, t):
    return {a: 1 - t, b: t} if a != b else {a: 1.0}


def w_torso(C):
    """Weights for things hugging the torso by height."""
    z_hip, z_mid, z_chest = BH(C, 'spine_01').z, BH(C, 'spine_02').z, BH(C, 'spine_03').z

    def f(co):
        if co.z >= z_chest:
            return {'spine_03': 1.0}
        if co.z >= z_mid:
            t = (co.z - z_mid) / (z_chest - z_mid)
            return w_blend('spine_02', 'spine_03', t)
        if co.z >= z_hip:
            t = (co.z - z_hip) / (z_mid - z_hip)
            return w_blend('spine_01', 'spine_02', t)
        return {'pelvis': 1.0}
    return f


LEG_CAP = 0.4
SIDE_SPLIT = 0.45


def w_skirt(C, stiff=0.35):
    """Skirts / robes: pelvis at the waist, increasingly following each thigh towards the hem."""
    zw = BH(C, 'pelvis').z + 0.08
    zk = BH(C, 'calf_l').z
    xl = BH(C, 'thigh_l').x

    def f(co):
        t = smoothstep(0, 1, (zw - co.z) / max(1e-3, zw - zk))  # 0 at waist, 1 at knee
        # A robe is a bell, not two trouser legs: cap how far the skirt follows the thighs (0.4 of the weight) and pull the left/right split
        # towards an even mix, so the two opposite thigh swings of a run cancel instead of dragging a flap of cloth
        # out to the front and back (the old weights let the hem follow one thigh by up to 100%).
        leg = min(t * (1 - stiff), LEG_CAP)
        s = max(0.0, min(1.0, 0.5 + co.x / (2.2 * abs(xl))))
        s = 0.5 + (s - 0.5) * SIDE_SPLIT
        w = {'pelvis': 1 - leg}
        if leg > 0:
            w['thigh_l'] = leg * s
            w['thigh_r'] = leg * (1 - s)
        return w
    return f


# ------------------------------------------------------------------------------------------------ shapes
def horn(length=0.3, r=0.05, bend=0.6, seg=8, rings=8, twist=0.0):
    """Curved cone along +Z bending toward +Y (backwards)."""
    bm = bmesh.new()
    prev = None
    for i in range(rings + 1):
        t = i / rings
        ang = bend * t
        rad = r * (1 - t) + 0.002
        # centre along an arc
        R = length / max(1e-3, bend) if bend > 1e-3 else 1e6
        cz = math.sin(ang) * R if bend > 1e-3 else length * t
        cy = (1 - math.cos(ang)) * R if bend > 1e-3 else 0
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            lx, ly = math.cos(a) * rad, math.sin(a) * rad
            # rotate local ring by tangent angle around X
            y = cy + ly * math.cos(ang)
            z = cz - ly * math.sin(ang)
            x = lx
            ring.append(bm.verts.new((x, y, z)))
        if prev:
            for j in range(seg):
                bm.faces.new((prev[j], prev[(j + 1) % seg], ring[(j + 1) % seg], ring[j]))
        else:
            bm.faces.new(list(reversed(ring)))
        prev = ring
    tip = bm.verts.new((0, prev[0].co.y, prev[0].co.z + 0.0))
    return new_obj('horn', bm)


def ellipsoid(rx, ry, rz, seg=14, rings=9, m=None, name='ell'):
    o = prim('sphere', name, m, r=1.0, seg=seg, rings=rings)
    place(o, scale=(rx, ry, rz))
    return o


def half_dome(r, m, seg=14, rings=6, name='dome'):
    prof = [(r * math.cos(math.radians(a)), r * math.sin(math.radians(a))) for a in range(0, 91, 90 // rings)]
    prof[-1] = (0.0, r)
    return lathe(name, [(r * 1.02, -0.02)] + prof, seg=seg, m=m)


def pauldron(C, side, m, size=0.15, spikes=0, spike_mat=None, spike_len=0.16, lift=0.05, tilt=28, layers=1, flat=0.75):
    s = sgn(side)
    sh = BH(C, 'upperarm_' + side)
    objs = []
    for k in range(layers):
        sz = size * (1 - 0.18 * k)
        d = half_dome(sz, m, name='pauld')
        place(d, scale=(1.15, 1.0, flat))
        d.rotation_euler = Euler((0, math.radians(-s * tilt), 0))
        d.location = sh + Vector((s * (0.02 + 0.06 * k), 0, lift - 0.07 * k))
        apply_transforms(d)
        objs.append(d)
    for i in range(spikes):
        h = horn(spike_len * (1 - 0.15 * i), 0.028, 0.25)
        if spike_mat:
            set_material(h, spike_mat)
        a = (i - (spikes - 1) / 2) * 0.09
        h.rotation_euler = Euler((math.radians(-10), math.radians(-s * (30 + 8 * i)), 0))
        h.location = sh + Vector((s * (0.03 + 0.02 * i), a, lift + size * flat * 0.85))
        apply_transforms(h)
        objs.append(h)
    o = join(objs, 'pauldron_' + side)
    return C.skinned(o, lambda co: {'upperarm_' + side: 0.6, 'clavicle_' + side: 0.4})


def belt(C, m, z=None, rx=None, ry=None, width=0.07, buckle=None, buckle_mat=None):
    """Elliptic band around the waist (fitted to the body cross-section at height z)."""
    z = z if z is not None else BH(C, 'pelvis').z + 0.07
    ex, ey = body_extent(C, z)
    rx = rx or ex + 0.02
    ry = ry or ey + 0.02
    o = prim('cyl', 'belt', m, seg=20, r1=1.0, r2=1.0, depth=width)
    # hollow ring: make a lathe band instead
    bpy.data.objects.remove(o, do_unlink=True)
    o = lathe('belt', [(1.0, -width / 2), (1.06, -width / 3), (1.06, width / 3), (1.0, width / 2)], seg=20, m=m)
    cy = body_center_y(C, z)
    place(o, loc=(0, cy, z), scale=(rx, ry, 1))
    objs = [o]
    if buckle:
        bk = prim('cyl', 'buckle', buckle_mat or m, seg=8, r1=buckle, r2=buckle, depth=0.03)
        place(bk, loc=(0, cy - ry - 0.01, z), rotxyz=(90, 0, 0))
        objs.append(bk)
    o = join(objs, 'belt')
    return C.skinned(o, w_torso(C))


_extent_cache = {}


def body_extent(C, z, band=0.03):
    xs, ys = [0.1], [0.1]
    mw = C.body.matrix_world
    cy = body_center_y(C, z)
    for v in C.body.data.vertices:
        co = mw @ v.co
        if abs(co.z - z) < band and abs(co.x) < 0.35:
            zn = zone_of(C.body, v)
            if zn in ('uparm', 'forearm', 'hand'):
                continue
            xs.append(abs(co.x))
            ys.append(abs(co.y - cy))
    return max(xs), max(ys)


def body_center_y(C, z, band=0.03):
    mw = C.body.matrix_world
    ys = [(mw @ v.co).y for v in C.body.data.vertices if abs((mw @ v.co).z - z) < band and abs((mw @ v.co).x) < 0.12]
    return (min(ys) + max(ys)) / 2 if ys else 0.0


def cape(C, m, top=None, bottom=0.3, width_top=0.42, width_bot=0.7, flare=0.28, cols=8, rows=10, thick=0.012, collar=False):
    """Cloth cape hanging from the shoulders at the back (+Y)."""
    top = top or BH(C, 'spine_03').z + 0.13
    y0 = body_extent(C, top - 0.05)[1] + body_center_y(C, top - 0.05) + 0.02
    bm = bmesh.new()
    grid = []
    for r in range(rows + 1):
        t = r / rows
        z = top + (bottom - top) * t
        w = width_top + (width_bot - width_top) * (t ** 0.8)
        y = y0 + flare * (t ** 1.4) + 0.05 * math.sin(t * math.pi) * 0.5
        row = []
        for c in range(cols + 1):
            u = c / cols - 0.5
            x = u * w
            yy = y + 0.06 * (u * 2) ** 2 * (0.3 + t) * -1 + 0.03 * math.sin(u * 9 + t * 5) * t
            row.append(bm.verts.new((x, yy, z)))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
    o = new_obj('cape', bm)
    set_material(o, m)
    sm = o.modifiers.new('s', 'SOLIDIFY')
    sm.thickness = thick
    select_only([o])
    bpy.ops.object.modifier_apply(modifier=sm.name)
    objs = [o]
    if collar:
        cl = lathe('collar', [(0.2, -0.03), (0.24, 0.0), (0.22, 0.05)], seg=16, m=m)
        place(cl, loc=(0, body_center_y(C, top) + 0.01, top - 0.02), scale=(1.0, 0.8, 1))
        objs.append(cl)
    o = join(objs, 'cape')
    smooth(o, 60)
    zc, zp = BH(C, 'spine_03').z, BH(C, 'pelvis').z

    def wf(co):
        if co.z >= zc:
            return {'spine_03': 1.0}
        t = smoothstep(zc, zp - 0.2, co.z) if False else min(1.0, max(0.0, (zc - co.z) / max(1e-3, zc - (zp - 0.25))))
        return {'spine_03': 1 - t * 0.85, 'pelvis': t * 0.85}
    return C.skinned(o, wf)


def robe(C, m, top=None, hem=0.1, r_top=None, r_hem=0.42, flare_back=0.06, seg=20, rings=8, stiff=0.3, open_front=False):
    """Long skirt / robe from the waist down (lathe), weighted between pelvis and thighs."""
    top = top if top is not None else BH(C, 'pelvis').z + 0.12
    ex, ey = body_extent(C, top)
    hx, hy = body_extent(C, BH(C, 'pelvis').z - 0.05)
    cy = body_center_y(C, top)
    prof = []
    for i in range(rings + 1):
        t = i / rings
        z = top + (hem - top) * t
        prof.append((t, z))
    bm = bmesh.new()
    rows = []
    for t, z in prof:
        rx = (ex + 0.03) * (1 - t) + r_hem * t if t > 0 else ex + 0.03
        rx = max(rx, (hx + 0.05) * min(1, t * 3)) if t > 0 else rx
        ry = (ey + 0.03) * (1 - t) + r_hem * 0.85 * t
        row = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            x = math.cos(a) * rx
            y = math.sin(a) * ry + cy + flare_back * t * max(0, math.sin(a))
            zz = z + 0.02 * math.sin(a * 5 + t * 3) * t
            row.append(bm.verts.new((x, y, zz)))
        rows.append(row)
    for k in range(len(rows) - 1):
        for j in range(seg):
            if open_front and j in (seg * 3 // 4, ):
                continue
            bm.faces.new((rows[k][j], rows[k][(j + 1) % seg], rows[k + 1][(j + 1) % seg], rows[k + 1][j]))
    o = new_obj('robe', bm)
    set_material(o, m)
    sm = o.modifiers.new('s', 'SOLIDIFY')
    sm.thickness = 0.012
    select_only([o])
    bpy.ops.object.modifier_apply(modifier=sm.name)
    smooth(o, 60)
    return C.skinned(o, w_skirt(C, stiff))


def loincloth(C, m, front=True, back=True, width=0.24, length=0.45):
    z0 = BH(C, 'pelvis').z + 0.05
    ex, ey = body_extent(C, z0)
    cy = body_center_y(C, z0)
    objs = []
    for sgn_y, on in ((-1, front), (1, back)):
        if not on:
            continue
        bm = bmesh.new()
        rows = []
        for r in range(5):
            t = r / 4
            z = z0 - length * t
            w = width * (1 - 0.25 * t)
            y = cy + sgn_y * (ey + 0.03 + 0.05 * t)
            rows.append([bm.verts.new((u * w, y, z)) for u in (-0.5, -0.17, 0.17, 0.5)])
        for r in range(4):
            for c in range(3):
                bm.faces.new((rows[r][c], rows[r][c + 1], rows[r + 1][c + 1], rows[r + 1][c]))
        o = new_obj('loin', bm)
        set_material(o, m)
        sm = o.modifiers.new('s', 'SOLIDIFY')
        sm.thickness = 0.01
        select_only([o])
        bpy.ops.object.modifier_apply(modifier=sm.name)
        objs.append(o)
    o = join(objs, 'loin')
    return C.skinned(o, lambda co: {'pelvis': 1.0})


def head_piece(C, o, scale=1.0):
    """Bind an object authored relative to the head top (origin = top of skull) to the Head bone."""
    top = head_top(C)
    o.location = top
    apply_transforms(o)
    return C.rigid(o, 'Head')


def head_top(C):
    mw = C.body.matrix_world
    zs = [(mw @ v.co) for v in C.body.data.vertices if zone_of(C.body, v) == 'head']
    zt = max(v.z for v in zs)
    hb = BH(C, 'Head')
    return Vector((0, hb.y, zt))


def head_center(C):
    mw = C.body.matrix_world
    vs = [(mw @ v.co) for v in C.body.data.vertices if zone_of(C.body, v) == 'head']
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return (mn + mx) / 2, (mx - mn)


def horns_pair(C, m, length=0.3, r=0.05, bend=0.9, spread=0.09, out=35, fwd=-10, up=0.0, back=0.0):
    c, size = head_center(C)
    objs = []
    for s in (1, -1):
        h = horn(length, r, bend)
        set_material(h, m)
        h.rotation_euler = Euler((math.radians(fwd), math.radians(s * out), 0))
        h.location = c + Vector((s * spread, back, size.z * 0.3 + up))
        apply_transforms(h)
        objs.append(h)
    return C.rigid(join(objs, 'horns'), 'Head')


def spikes_row(C, m, points, length=0.18, r=0.035, bone='spine_03', direction=(0, 1, 0.4)):
    objs = []
    d = Vector(direction).normalized()
    for p in points:
        h = prim('cone', 'spk', m, seg=6, r1=r, r2=0.0, depth=length)
        rotxyz = d.to_track_quat('Z', 'Y').to_euler()
        h.rotation_euler = rotxyz
        h.location = Vector(p) + d * length * 0.5
        apply_transforms(h)
        objs.append(h)
    return C.rigid(join(objs, 'spikes'), bone)


def staff(C, side, shaft_mat, top_builder=None, length=1.7, r=0.022, grip_frac=0.45, pitch=0, yaw=0):
    """Straight staff through the fist; top_builder(top_point, axis) -> [objs]."""
    f = C.fist(side)
    axis = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(pitch), 3, 'X') @ Vector((0, -1, 0))
    p0 = f - axis * length * grip_frac
    p1 = f + axis * length * (1 - grip_frac)
    sh = prim('cyl', 'shaft', shaft_mat, seg=8, r1=r, r2=r * 0.8, depth=length)
    sh.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    sh.location = (p0 + p1) / 2
    apply_transforms(sh)
    objs = [sh]
    if top_builder:
        objs += top_builder(p1, axis)
    o = join(objs, 'staff')
    smooth(o, 35)
    return C.rigid(o, 'hand_' + side)


def orient(o, pos, axis):
    o.rotation_euler = axis.to_track_quat('Z', 'Y').to_euler()
    o.location = pos
    apply_transforms(o)
    return o


def crystal(r, h, m, seg=6):
    o = lathe('crystal', [(0, -h * 0.35), (r, 0), (r * 0.85, h * 0.35), (0, h * 0.65)], seg=seg, m=m)
    flat(o)
    return o


def gem_cluster(pos, axis, m, n=4, size=0.12, seed=1):
    rnd = random.Random(seed)
    objs = []
    for i in range(n):
        c = crystal(size * (0.35 + 0.25 * rnd.random()), size * (1.2 + rnd.random()), m)
        a = axis.copy()
        tilt = Euler((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0)).to_matrix()
        orient(c, pos + axis * size * 0.3, (tilt @ a).normalized())
        objs.append(c)
    return objs


def bracers(C, m, sides='lr', offset=0.012, thick=0.012, zone='forearm'):
    out = []
    for s in sides:
        xs = (0, 9) if s == 'l' else (-9, 0)
        out.append(C.shell(zones(zone, xmin=xs[0], xmax=xs[1]), 'bracer_' + s, m, offset=offset, thick=thick))
    return out


def boots(C, m, top=None, offset=0.012, thick=0.012):
    top = top if top is not None else BH(C, 'calf_l').z - 0.12
    return C.shell(zones('calf', 'foot', zmax=top), 'boots', m, offset=offset, thick=thick)


def rocks(C, m, bone, n=5, size=0.1, spread=0.12, seed=3, along=0.5):
    rnd = random.Random(seed)
    h, t = BH(C, bone), BT(C, bone)
    objs = []
    for i in range(n):
        p = h.lerp(t, rnd.uniform(0.1, 0.9) if along else 0.5)
        o = prim('ico', 'rock', m, sub=1, r=size * rnd.uniform(0.7, 1.3))
        place(o, scale=(rnd.uniform(0.8, 1.3), rnd.uniform(0.8, 1.3), rnd.uniform(0.7, 1.1)))
        o.location = p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 1))) * spread
        o.rotation_euler = Euler((rnd.random() * 3, rnd.random() * 3, rnd.random() * 3))
        apply_transforms(o)
        flat(o)
        objs.append(o)
    return C.rigid(join(objs, 'rocks_' + bone), bone)
