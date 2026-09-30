# Hero recipes. Each builder gets nothing and returns a finished Char (not yet exported).
from parts import *

REG = {}


def recipe(name, tris=13000, tex=1024):
    def deco(fn):
        REG[name] = (fn, dict(tris=tris, tex=tex))
        return fn
    return deco


STEEL = lambda n, c=0x9aa0a8: mat(n, c, rough=0.35, metal=0.8, edge=0.45, noise=0.1)
CLOTH = lambda n, c: mat(n, c, rough=0.85, noise=0.18, noise_scale=40)
LEATHER = lambda n, c: mat(n, c, rough=0.6, noise=0.2, noise_scale=25)
GLOW = lambda n, c, e=1.0: mat(n, c, rough=0.3, emit=e, noise=0.05)
FUR = lambda n, c: mat(n, c, rough=0.95, noise=0.35, noise_scale=90)


# ================================================================================================ BRAKKA
@recipe('brakka')
def brakka():
    # Hill-clan warlord: ash-olive skin, braided rust beard, riveted iron war-helm with cheek guards and a bronze
    # brow band, brown fur mantle over a leather-and-iron harness, ochre war-kilt, double-bitted war-axe on a short haft.
    C = Char('brakka', 'male', skin=0x7e8a66, skin_strength=0.85)
    C.hair('Hair_Beard', 0x7a3c1c, 0.95)
    C.prep()
    # bulk: broad shoulders / chest
    C.scale_region(BH(C, 'spine_03') + Vector((0, 0, 0.05)), 0.42, 1.12, (1.15, 1.1, 1.0))
    C.scale_region(BH(C, 'Head'), 0.2, 1.05)
    iron = mat('brakka_iron', 0x2e3038, rough=0.45, metal=0.5, edge=0.05, noise=0.12)
    bronze = mat('brakka_bronze', 0x7a4a18, rough=0.45, metal=0.45, edge=0.04, noise=0.1)
    leather = LEATHER('brakka_leather', 0x4a3020)
    ochre = CLOTH('brakka_ochre', 0x8a5e1c)
    fur = FUR('brakka_fur', 0x5a4030)
    C.paint([(zones('foot'), 0x241a14, 1.0), (zones('calf', 'thigh'), 0x3a3026, 0.95),
             (zones('hips', 'belly', zmax=BH(C, 'pelvis').z + 0.1), 0x3a3026, 0.95)])
    # leather jerkin over belly + lower chest, iron plate on the chest centre
    C.shell(zones('belly', 'chest', zmax=BH(C, 'spine_03').z + 0.02), 'jerkin', leather, offset=0.016, thick=0.014)
    C.shell(lambda v, co, z: z == 'chest' and abs(co.x) < 0.13 and co.y < body_center_y(C, co.z), 'plate', iron, offset=0.03, thick=0.016)
    bracers(C, iron)
    boots(C, leather, top=BH(C, 'calf_l').z - 0.05)
    # heavy fur mantle across both shoulders (no spikes), small iron plates on top
    top = BH(C, 'neck_01').z
    ex, ey = body_extent(C, top - 0.04)
    mant = lathe('mantle', [(0.1, 0.05), (0.16, 0.02), (0.2, -0.04), (0.2, -0.09)], seg=16, m=fur)
    place(mant, loc=(0, body_center_y(C, top - 0.04), top - 0.03), scale=(max(1.0, ex / 0.17), max(0.9, ey / 0.17), 1))
    C.skinned(mant, lambda co: {'spine_03': 0.6, 'neck_01': 0.4})
    pauldron(C, 'l', iron, size=0.13, spikes=0, layers=2, flat=0.5, lift=0.08)
    pauldron(C, 'r', iron, size=0.13, spikes=0, layers=2, flat=0.5, lift=0.08)
    belt(C, leather, width=0.09, buckle=0.065, buckle_mat=bronze)
    loincloth(C, ochre, width=0.28, length=0.42)
    # war-helm: iron dome over the skull, bronze brow band, cheek guards and a short nasal
    hc, hs = head_center(C)
    top = head_top(C)
    brow = hc.z + 0.035
    hz = top.z - brow + 0.045
    dome = lathe('helm', [(1.0, -0.02), (1.02, 0.0), (1.0, 0.3), (0.92, 0.58), (0.72, 0.84), (0.4, 0.98), (0.0, 1.02)], seg=16, m=iron)
    place(dome, loc=(0, hc.y + 0.01, brow), scale=(hs.x * 0.6, hs.y * 0.62, hz))
    # neck guard flaring out at the back
    guard = lathe('nguard', [(1.0, 0.1), (1.08, -0.1), (1.14, -0.16)], seg=16, m=iron)
    place(guard, loc=(0, hc.y + 0.02, brow), scale=(hs.x * 0.6, hs.y * 0.62, 1.0))
    bm_ = bmesh.new(); bm_.from_mesh(guard.data)
    bmesh.ops.delete(bm_, geom=[f for f in bm_.faces if f.calc_center_median().y < -0.02], context='FACES')
    bm_.to_mesh(guard.data); bm_.free()
    sm = guard.modifiers.new('s', 'SOLIDIFY'); sm.thickness = 0.015
    select_only([guard]); bpy.ops.object.modifier_apply(modifier=sm.name)
    band = prim('torus', 'band', bronze, R=1.0, r=0.02, seg=16, rseg=4)
    place(band, loc=(0, hc.y + 0.01, brow + 0.02), scale=(hs.x * 0.62, hs.y * 0.64, 1.0))
    nasal = prim('box', 'nasal', iron)
    place(nasal, loc=(0, hc.y - hs.y * 0.62, brow - 0.035), scale=(0.03, 0.018, 0.1))
    cheeks = []
    for sx in (1, -1):
        ch = prim('box', 'cheek', iron)
        place(ch, loc=(sx * hs.x * 0.56, hc.y - hs.y * 0.2, brow - 0.07), rotxyz=(0, sx * -8, sx * 14), scale=(0.022, 0.12, 0.13))
        cheeks.append(ch)
    ridge = extrude_shape('ridge', [(-0.14, 0.0), (0.14, 0.0), (0.1, 0.04), (-0.1, 0.04)], 0.03, m=bronze)
    place(ridge, rotxyz=(0, 0, 90))
    ridge.location = Vector((0, hc.y + 0.01, brow + hz - 0.012))
    apply_transforms(ridge)
    C.hide_under([dome], dist=0.05, pred=zones('head'))
    C.rigid(join([dome, guard, band, nasal, ridge] + cheeks, 'helm'), 'Head')
    C.weapon('Axe_Double', 'r', length=1.25, grip=-2.1, recolor={'Steel': STEEL('brakka_blade', 0x8a8c94), 'LightSteel': STEEL('brakka_blade2', 0xb8bac2), 'DarkSteel': iron, 'Gold': bronze, 'LightWood': LEATHER('brakka_haft', 0x4a3424), 'DarkWood': bronze})
    return C


# ================================================================================================ ALDRIC
@recipe('aldric')
def aldric():
    C = Char('aldric', 'male', skin=0xe8c0a0, skin_strength=0.1)
    C.hair('Hair_Beard', 0xd8b070, 0.9)
    C.prep()
    C.scale_region(BH(C, 'spine_03') + Vector((0, 0, 0.05)), 0.42, 1.1, (1.14, 1.06, 1.0))
    blue = mat('aldric_plate', 0x646a76, rough=0.35, metal=0.6, edge=0.1, noise=0.1)
    dark = STEEL('aldric_dark', 0x33363e)
    gold = STEEL('aldric_gold', 0xf0c040)
    # tight mail painted on the body (seamless), plates as shells on top
    C.paint([(zones('foot'), 0x33363e, 1.0), (zones('calf'), 0x8a909c, 1.0), (zones('thigh', 'hips'), 0x33363e, 1.0),
             (zones('belly', 'chest'), 0x33363e, 1.0), (zones('uparm'), 0x33363e, 1.0), (zones('forearm', 'hand'), 0x8a909c, 1.0)])
    C.shell(zones('chest', 'belly'), 'cuirass', blue, offset=0.025, thick=0.02)
    bracers(C, blue, offset=0.016, thick=0.014)
    boots(C, blue, top=BH(C, 'calf_l').z - 0.04, offset=0.016, thick=0.014)
    pauldron(C, 'l', blue, size=0.19, layers=3, spikes=0)
    pauldron(C, 'r', blue, size=0.19, layers=3, spikes=0)
    belt(C, gold, width=0.07, buckle=0.05, buckle_mat=gold)
    loincloth(C, CLOTH('aldric_tabard', 0x1d5a34), width=0.28, length=0.42)
    # open-faced helm (dome above the brows) with gold crest + big side horns
    hc, hs = head_center(C)
    C.shell(lambda v, co, z: z == 'head' and co.z > hc.z + 0.015, 'helm', blue, offset=0.03, thick=0.02, smooth=30)
    crest = extrude_shape('crest', [(-0.1, 0.0), (0.12, 0.0), (0.06, 0.12), (-0.08, 0.08)], 0.03, m=gold)
    place(crest, rotxyz=(0, 0, 90))
    crest.location = Vector((0, hc.y + 0.02, hc.z + hs.z * 0.5))
    apply_transforms(crest)
    C.rigid(crest, 'Head')
    cape(C, CLOTH('aldric_cape', 0x1d5a34), width_top=0.46, width_bot=0.82, bottom=0.22, flare=0.32)
    C.weapon('Sword_Big', 'r', length=2.05, grip=0.3, recolor={'Steel': STEEL('aldric_blade', 0xc8ccd4), 'LightSteel': STEEL('aldric_blade2', 0xe8eaf0), 'DarkSteel': dark, 'LightWood': LEATHER('aldric_grip', 0x3a2418), 'DarkWood': gold})
    return C


# ================================================================================================ KENSHAR
def sabre(C, side, blade_m, guard_m, grip_m, length=0.95, curve=0.14, width=0.06, back=0.012, grip_len=0.26):
    """Procedural curved sabre through the fist (grip along the fist's Y axis, blade forward along -Y, curving up)."""
    f = C.fist(side)
    bm = bmesh.new()
    n = 10
    rings = []
    y0 = 0.1  # blade starts just past the guard
    for i in range(n + 1):
        t = i / n
        y = -(y0 + length * t)
        zc = curve * t * t
        w = width * (1 - 0.35 * t) if i < n else 0.0
        # triangular section: back (spine, thick) above, edge below
        top = bm.verts.new((f.x - back * (1 - t * 0.7), f.y + y, f.z + zc + w * 0.5))
        top2 = bm.verts.new((f.x + back * (1 - t * 0.7), f.y + y, f.z + zc + w * 0.5))
        edge = bm.verts.new((f.x, f.y + y - (0.05 if i == n else 0.0), f.z + zc - w * 0.5 + (curve * 0.25 if i == n else 0)))
        rings.append((top, top2, edge))
    for k in range(n):
        A, B = rings[k], rings[k + 1]
        for j in range(3):
            bm.faces.new((A[j], A[(j + 1) % 3], B[(j + 1) % 3], B[j]))
    bm.faces.new(list(reversed(rings[0])))
    tip = rings[-1]
    bm.faces.new(tip)
    blade = new_obj('sabre', bm)
    set_material(blade, blade_m)
    flat(blade)
    guard = prim('cyl', 'guard', guard_m, seg=10, r1=0.07, r2=0.07, depth=0.025)
    place(guard, loc=f + Vector((0, -0.09, 0.0)), rotxyz=(90, 0, 0), scale=(0.7, 1.0, 1.0))
    grip = prim('cyl', 'grip', grip_m, seg=8, r1=0.022, r2=0.02, depth=grip_len)
    place(grip, loc=f + Vector((0, -0.09 + grip_len / 2, 0.0)), rotxyz=(90, 0, 0))
    pom = prim('ico', 'pommel', guard_m, sub=1, r=0.032)
    pom.location = f + Vector((0, -0.09 + grip_len + 0.01, 0))
    apply_transforms(pom)
    o = join([blade, guard, grip, pom], 'sabre')
    return C.rigid(o, 'hand_' + side)


@recipe('kenshar')
def kenshar():
    # Wandering duelist: wide lacquered rain-hat with bronze rim, bronze half-mask, indigo long coat with a teal sash,
    # dark trousers and boots, curved sabre + scabbard on the left hip.
    C = Char('kenshar', 'male', skin=0xc89468, skin_strength=0.3)
    coat = C.outfit('Male_Peasant', ['Body', 'Legs'], tint=0x1c2a5a, strength=0.85)
    boots_ = C.outfit('Male_Ranger', ['Feet_Boots'], tint=0x1a1612, strength=0.8)
    C.prep()
    C.hide_under(coat + boots_, dist=0.04)
    indigo = CLOTH('ken_indigo', 0x1e2c62)
    teal = CLOTH('ken_teal', 0x1f8a86)
    bronze = mat('ken_bronze', 0x7a4818, rough=0.45, metal=0.45, edge=0.04, noise=0.12)
    dark = LEATHER('ken_dark', 0x1a1612)
    C.paint([(zones('foot'), 0x1a1612, 1.0), (zones('calf', 'thigh', 'hips'), 0x22222a, 1.0),
             (zones('chest', 'belly', 'uparm'), 0x1e2c62, 1.0), (zones('forearm'), 0x1e2c62, 0.9)])
    # long coat skirt split at the front + back (coat tails), teal sash with hanging ends
    loincloth(C, indigo, width=0.24, length=0.5, front=True, back=False)
    loincloth(C, indigo, width=0.36, length=0.66, front=False, back=True)
    belt(C, teal, width=0.11, buckle=0.045, buckle_mat=bronze)
    # bronze lamellar shoulder plate on the lead (left) side + bronze-studded bracers
    pauldron(C, 'l', bronze, size=0.12, layers=2, spikes=0, flat=0.55)
    bracers(C, dark, offset=0.012, thick=0.012)
    hc, hs = head_center(C)
    top = head_top(C)
    # wide shallow conical hat: reads as a dark disc with a bronze ring from the MOBA camera
    hat = lathe('hat', [(0.0, 0.12), (0.06, 0.1), (0.18, 0.035), (0.29, -0.02), (0.3, -0.035)], seg=20, m=LEATHER('ken_hat', 0x2a2438))
    sm = hat.modifiers.new('s', 'SOLIDIFY'); sm.thickness = 0.018
    select_only([hat]); bpy.ops.object.modifier_apply(modifier=sm.name)
    place(hat, loc=top + Vector((0, 0.01, -0.035)), rotxyz=(-6, 0, 0))
    rim = prim('torus', 'rim', bronze, R=0.295, r=0.012, seg=20, rseg=4)
    place(rim, loc=top + Vector((0, 0.01, -0.065)), rotxyz=(-6, 0, 0))
    knob = prim('ico', 'knob', bronze, sub=1, r=0.03)
    place(knob, loc=top + Vector((0, 0.0, 0.095)))
    C.hide_under([hat], dist=0.08, pred=lambda v, co, z: z == 'head' and co.z > hc.z + 0.04)
    # bronze half-mask over mouth + nose (lower face), angular
    C.rigid(join([hat, rim, knob], 'hat'), 'Head')
    C.shell(lambda v, co, z: z == 'head' and co.y < hc.y - hs.y * 0.1 and co.z < hc.z - 0.005, 'mask', bronze, offset=0.018, thick=0.012)
    # scabbard on the left hip, angled back
    z = BH(C, 'pelvis').z + 0.02
    sc = prim('cyl', 'scabbard', dark, seg=6, r1=0.028, r2=0.022, depth=0.8)
    place(sc, loc=(body_extent(C, z)[0] + 0.05, body_center_y(C, z) + 0.12, z - 0.12), rotxyz=(-62, 0, -6), scale=(0.7, 1.4, 1))
    tipc = prim('cyl', 'chape', bronze, seg=6, r1=0.03, r2=0.03, depth=0.06)
    place(tipc, loc=(body_extent(C, z)[0] + 0.05, body_center_y(C, z) + 0.12 + 0.35, z - 0.12 - 0.19), rotxyz=(-62, 0, -6), scale=(0.7, 1.4, 1))
    C.skinned(join([sc, tipc], 'scabbard'), lambda co: {'pelvis': 1.0})
    sabre(C, 'r', STEEL('ken_blade', 0xd8dde6), bronze, LEATHER('ken_grip', 0x1f8a86))
    return C


# ================================================================================================ ISOLDE
@recipe('isolde')
def isolde():
    # frost-seer: raven hair with a crystal circlet, plum bodice, silver-white robe, white fur mantle (no hood / cape)
    C = Char('isolde', 'female', skin=0xe8c4ac, skin_strength=0.2)
    C.hair('Hair_Long', 0x1c1a2a, 0.95)
    C.prep()
    robe_m = CLOTH('isolde_robe', 0xd8dde6)
    white = FUR('isolde_fur', 0xf4f8ff)
    ice = GLOW('isolde_ice', 0x80d8ff, 0.8)
    C.paint([(zones('chest', 'belly', 'hips', 'uparm'), 0x4a2458, 1.0), (zones('forearm'), 0xd8dde6, 0.9),
             (zones('thigh', 'calf'), 0x3a1c46, 1.0), (zones('foot'), 0x3a1c46, 1.0)])
    robe(C, robe_m, hem=0.12, r_hem=0.4, stiff=0.35)
    belt(C, STEEL('isolde_silver', 0x9aa4b4), width=0.05)
    hc, hs = head_center(C)
    top = head_top(C)
    circ = prim('torus', 'circlet', STEEL('isolde_silver', 0x9aa4b4), R=1.0, r=0.012, seg=16, rseg=4)
    place(circ, loc=(0, hc.y + 0.005, hc.z + 0.05), rotxyz=(-10, 0, 0), scale=(hs.x * 0.56, hs.y * 0.6, 1.0))
    gem = crystal(0.025, 0.12, ice)
    orient(gem, Vector((0, hc.y - hs.y * 0.6, hc.z + 0.08)), Vector((0, -0.2, 1)).normalized())
    C.rigid(join([circ, gem], 'circlet'), 'Head')
    # white fur stole hugging the shoulders / upper chest
    zs = BH(C, 'spine_03').z + 0.04
    C.shell(lambda v, co, z: (z == 'chest' and co.z > zs) or (z == 'uparm' and co.z > zs + 0.02 and abs(co.x) < abs(BH(C, 'upperarm_l').x) + 0.08), 'stole', white, offset=0.03, thick=0.03, smooth=10)
    def top_b(p, axis):
        return gem_cluster(p, axis, ice, n=5, size=0.13, seed=4)
    staff(C, 'r', LEATHER('isolde_staff', 0x5a6070), top_b, length=1.75, grip_frac=0.42)
    return C



def hand_axis(C, side):
    return (BT(C, 'hand_' + side) - BH(C, 'hand_' + side)).normalized()


# ================================================================================================ PELL
@recipe('pell')
def pell():
    C = Char('pell', 'male', skin=0xe8b890, skin_strength=0.2)
    C.hair('Hair_Beard', 0xd0d0c8, 0.95)
    C.prep()
    # stocky keen: bigger head, shorter legs feel via wide hips
    C.scale_region(BH(C, 'Head') + Vector((0, 0, 0.08)), 0.2, 1.22)
    brown = LEATHER('sn_leather', 0x6a4a28)
    C.paint([(zones('foot'), 0x3a2414, 1.0), (zones('calf', 'thigh', 'hips'), 0x6a5a38, 1.0), (zones('belly', 'chest'), 0x8a6a3a, 1.0),
             (zones('uparm'), 0x8a6a3a, 1.0), (zones('forearm'), 0x5a4020, 1.0)])
    outfit = C.outfit('Male_Ranger', ['Body', 'Feet_Boots'], tint=0x7a5a30, strength=0.6)
    C.hide_under(outfit, dist=0.04)
    belt(C, brown, buckle=0.04, buckle_mat=STEEL('sn_brass', 0xc09040))
    # big floppy helmet / hat with goggles
    hc, hs = head_center(C)
    top = head_top(C)
    hat = lathe('hat', [(0.0, 0.035), (0.08, 0.025), (0.125, -0.01), (0.145, -0.06), (0.15, -0.1), (0.14, -0.11)], seg=16, m=LEATHER('sn_hat', 0x3a2a1c))
    place(hat, loc=top + Vector((0, 0.01, 0.0)), scale=(hs.x / 0.26, hs.y / 0.26, 1.0))
    flaps = []
    for sx in (1, -1):
        fl = prim('box', 'flap', LEATHER('sn_hat', 0x3a2a1c))
        place(fl, loc=(sx * hs.x * 0.55, hc.y + 0.01, hc.z - 0.02), rotxyz=(0, sx * 8, 0), scale=(0.03, 0.09, 0.12))
        flaps.append(fl)
    C.hide_under([hat], dist=0.05, pred=lambda v, co, z: z == 'head' and co.z > hc.z + 0.05)
    gog = []
    for dx in (-0.05, 0.05):
        g = prim('cyl', 'gog', STEEL('sn_gog', 0xb89040), seg=10, r1=0.035, r2=0.035, depth=0.04)
        place(g, loc=hc + Vector((dx, -hs.y * 0.5 - 0.01, 0.1)), rotxyz=(80, 0, 0))
        l = prim('cyl', 'lens', GLOW('sn_lens', 0x80e0ff, 0.6), seg=10, r1=0.026, r2=0.026, depth=0.01)
        place(l, loc=hc + Vector((dx, -hs.y * 0.5 - 0.032, 0.103)), rotxyz=(80, 0, 0))
        gog += [g, l]
    C.rigid(join([hat] + flaps + gog, 'hat'), 'Head')
    # long rifle along the hand axis (pistol-grip clips point the hand bone at the target)
    f = C.fist('r')
    ax = C.aim_axis('hand_r', 'Pistol_Idle_Loop', (0, -1, 0))
    wood = LEATHER('sn_wood', 0x7a4a20)
    metal = STEEL('sn_barrel', 0x3a3a40)
    parts_ = []
    barrel = prim('cyl', 'barrel', metal, seg=8, r1=0.022, r2=0.018, depth=1.25)
    orient(barrel, f + ax * 0.7 + Vector((0, 0, 0.06)), ax)
    stock = prim('box', 'stock', wood)
    place(stock, scale=(0.07, 0.07, 0.5))
    orient(stock, f + ax * 0.05 + Vector((0, 0, 0.03)), ax)
    butt = prim('box', 'butt', wood)
    place(butt, scale=(0.06, 0.16, 0.14))
    orient(butt, f - ax * 0.22 + Vector((0, 0, -0.01)), ax)
    scope = prim('cyl', 'scope', metal, seg=8, r1=0.03, r2=0.03, depth=0.34)
    orient(scope, f + ax * 0.2 + Vector((0, 0, 0.13)), ax)
    muzzle = prim('cyl', 'muz', STEEL('sn_brass2', 0xc09040), seg=8, r1=0.03, r2=0.03, depth=0.08)
    orient(muzzle, f + ax * 1.3 + Vector((0, 0, 0.06)), ax)
    C.rigid(join([barrel, stock, butt, scope, muzzle], 'rifle'), 'hand_r')
    # backpack
    pack = prim('box', 'pack', LEATHER('sn_pack', 0x5a4020))
    z = BH(C, 'spine_03').z - 0.05
    place(pack, loc=(0, body_center_y(C, z) + body_extent(C, z)[1] + 0.1, z), scale=(0.32, 0.18, 0.38))
    C.skinned(pack, lambda co: {'spine_03': 1.0})
    return C


# ================================================================================================ SERA
@recipe('sera')
def sera():
    C = Char('sera', 'female', skin=0xf0c8a8, skin_strength=0.15)
    C.hair('Hair_Long', 0x181014, 0.95)
    C.prep()
    red = CLOTH('sera_red', 0x2a2024)
    gold = STEEL('sera_gold', 0xe0a830)
    fire = GLOW('sera_fire', 0xff8020, 1.0)
    fire2 = GLOW('sera_fire2', 0xffd040, 1.0)
    C.paint([(zones('chest', 'belly'), 0x3a2a2c, 1.0), (zones('hips', 'thigh'), 0x2a2024, 1.0), (zones('calf', 'foot'), 0x1a1214, 1.0)])
    robe(C, red, top=BH(C, 'pelvis').z + 0.08, hem=0.18, r_hem=0.36, stiff=0.4, open_front=True)
    belt(C, gold, width=0.05)
    bracers(C, gold, offset=0.008, thick=0.008)
    # flame hair: flickering cones rising from the head
    top = head_top(C)
    fl = []
    rnd = random.Random(7)
    for i in range(9):
        a = rnd.uniform(-1, 1)
        c = prim('cone', 'flame', fire if i % 2 else fire2, seg=6, r1=0.05, r2=0.0, depth=rnd.uniform(0.2, 0.34))
        place(c, loc=top + Vector((a * 0.09, 0.05 + rnd.uniform(0, 0.08), 0.06)), rotxyz=(-35 + rnd.uniform(-10, 10), a * 30, 0))
        fl.append(c)
    C.rigid(join(fl, 'flamehair'), 'Head')
    # fire orbs in both fists
    for s in 'lr':
        o = prim('ico', 'orb', fire, sub=2, r=0.08)
        o.location = C.fist(s)
        apply_transforms(o)
        C.rigid(o, 'hand_' + s)
    return C


# ================================================================================================ GORROW
@recipe('gorrow')
def gorrow():
    C = Char('gorrow', 'male', skin=0xa87e6c, skin_strength=0.9)
    C.prep()
    # massive belly + bulk everywhere
    C.inflate(BH(C, 'spine_01') + Vector((0, -0.12, 0.0)), 0.5, 0.26, (1.0, 1.0, 1.1))
    C.inflate(BH(C, 'spine_03'), 0.45, 0.08)
    C.scale_region(BH(C, 'spine_02'), 0.7, 1.12, (1.2, 1.15, 1.0))
    for s in 'lr':
        C.inflate((BH(C, 'upperarm_' + s) + BT(C, 'upperarm_' + s)) / 2, 0.22, 0.05)
        C.inflate((BH(C, 'thigh_' + s) + BT(C, 'thigh_' + s)) / 2, 0.3, 0.05)
    C.scale_region(BH(C, 'Head'), 0.2, 0.9)
    apron = LEATHER('gorrow_apron', 0x6a3a28)
    C.paint([(zones('foot', 'calf'), 0x3a2a20, 1.0), (zones('thigh', 'hips'), 0x2e3440, 1.0)])
    loincloth(C, apron, width=0.3, length=0.5, back=False)
    belt(C, LEATHER('gorrow_belt', 0x3a2418), buckle=0.07, buckle_mat=STEEL('gorrow_iron', 0x5a5a5a))
    # hooks / chains on shoulders
    pauldron(C, 'l', STEEL('gorrow_rust', 0x6a5040), size=0.14, spikes=2, spike_mat=STEEL('gorrow_spike', 0x4a4038))
    # hook in right hand: chain links + big hook
    f = C.fist('r')
    iron = STEEL('gorrow_hook', 0x7a7a80)
    links = []
    for i in range(5):
        l = prim('torus', 'link', iron, R=0.04, r=0.012, seg=10, rseg=5)
        place(l, loc=f + Vector((0, -0.05 - i * 0.07, 0)), rotxyz=(0, 90 * (i % 2), 90))
        links.append(l)
    hk = horn(0.7, 0.055, 3.3, seg=6, rings=12)
    set_material(hk, iron)
    place(hk, loc=f + Vector((0, -0.4, 0.0)), rotxyz=(-90, 0, 0))
    C.rigid(join(links + [hk], 'hook'), 'hand_r')
    # meat-mallet in the off hand
    C.weapon('Hammer_Small', 'l', length=0.8, grip=-0.6, recolor={'Steel': STEEL('gorrow_mallet', 0x5a5654), 'LightSteel': STEEL('gorrow_mallet2', 0x7a7470), 'LightWood': apron, 'DarkWood': apron})
    return C


# ================================================================================================ VESNA
@recipe('vesna')
def vesna():
    C = Char('vesna', 'female', skin=0xd8b090, skin_strength=0.3)
    C.hair('Hair_Long', 0x141418, 0.95)
    C.prep()
    outfit = C.outfit('Female_Ranger', ['Body', 'Legs', 'Feet', 'Acc_Pauldrons', 'Head_Hood'], tint=0x5a2030, strength=0.75)
    C.hide_under(outfit, dist=0.04)
    C.paint([(zones('uparm'), 0x5a2030, 0.0)])
    cape(C, CLOTH('vesna_cape', 0x2a1018), width_top=0.36, width_bot=0.6, bottom=0.35, flare=0.25)
    up = C.aim_axis('hand_l', 'Punch_Jab', (0, 0, 1), frame=5)
    back = C.aim_axis('hand_l', 'Punch_Jab', (0, 1, 0), frame=5)
    C.weapon_frame('Bow_Evil', 'l', 1.4, up, back, recolor={'Red': mat('vesna_bow', 0x9ad8ff, rough=0.3, emit=0.5), 'Black': STEEL('vesna_grip', 0x2a3a5a), 'White': GLOW('vesna_string', 0xd0f0ff, 0.6)})
    # quiver
    z = BH(C, 'spine_03').z - 0.05
    q = prim('cyl', 'quiver', LEATHER('vesna_quiver', 0x3a2a4a), seg=8, r1=0.06, r2=0.07, depth=0.5)
    place(q, loc=(0.08, body_center_y(C, z) + body_extent(C, z)[1] + 0.07, z), rotxyz=(0, -25, 0))
    arrows = prim('cone', 'fletch', GLOW('vesna_fletch', 0xa0e8ff, 0.4), seg=6, r1=0.06, r2=0.02, depth=0.12)
    place(arrows, loc=(0.08 - 0.12, body_center_y(C, z) + body_extent(C, z)[1] + 0.07, z + 0.3), rotxyz=(0, -25, 0))
    C.skinned(join([q, arrows], 'quiver'), lambda co: {'spine_03': 1.0})
    return C


# ================================================================================================ MORVANE
@recipe('morvane')
def morvane():
    C = Char('morvane', 'male', skin=0xd0e4ec, skin_strength=1.0)
    C.prep()
    C.scale_region(BH(C, 'spine_02'), 0.6, 0.88, (0.85, 0.85, 1.0))  # gaunt
    robe_m = CLOTH('morvane_robe', 0x163a40)
    ice = GLOW('morvane_ice', 0x80e0ff, 0.9)
    gold = STEEL('morvane_gold', 0xc0b070)
    C.paint([(lambda v, co, z: z in ('chest', 'belly') and abs(co.x) < 0.07, 0xd0e4ec, 0.0), (zones('chest', 'belly', 'hips', 'uparm'), 0x163a40, 1.0), (zones('thigh', 'calf', 'foot'), 0x0e2226, 1.0), (zones('head'), 0x8aa8b8, 0.35)])
    robe(C, robe_m, top=BH(C, 'spine_01').z, hem=0.05, r_hem=0.45, stiff=0.2)
    C.remove_body(zones('thigh', 'calf', zmin=0.2))
    cape(C, CLOTH('morvane_cape', 0x0c1c22), width_top=0.5, width_bot=0.85, bottom=0.08, flare=0.35)
    # ice crown: ring of crystals
    top = head_top(C)
    hc, hs = head_center(C)
    crs = []
    for i in range(7):
        a = i / 7 * math.pi * 2
        p = Vector((math.cos(a) * hs.x * 0.55, hc.y + math.sin(a) * hs.y * 0.55, top.z - 0.05))
        crs.append(orient(crystal(0.03, 0.22 if i % 2 else 0.15, ice), p, Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 1)).normalized()))
    ring = prim('torus', 'crown', gold, R=hs.x * 0.55, r=0.018, seg=16, rseg=5)
    place(ring, loc=(0, hc.y, top.z - 0.06))
    C.rigid(join(crs + [ring], 'crown'), 'Head')
    # glowing eyes
    eyes = []
    for dx in (-0.035, 0.035):
        e = prim('ico', 'eye', GLOW('morvane_eye', 0x60f0ff, 1.0), sub=1, r=0.018)
        place(e, loc=hc + Vector((dx, -hs.y * 0.45, 0.03)))
        eyes.append(e)
    C.rigid(join(eyes, 'eyes'), 'Head')
    # big ice shards on shoulders
    for s in 'lr':
        sh = BH(C, 'upperarm_' + s)
        objs = gem_cluster(sh + Vector((0, 0.02, 0.06)), Vector((sgn(s) * 0.4, 0.2, 1)).normalized(), ice, n=3, size=0.14, seed=ord(s))
        C.skinned(join(objs, 'shard_' + s), lambda co, s=s: {'clavicle_' + s: 0.5, 'upperarm_' + s: 0.5})
    return C


# ================================================================================================ SABLE
@recipe('sable')
def sable():
    C = Char('sable', 'female', skin=0xc8a8b8, skin_strength=0.3)
    C.prep()
    outfit = C.outfit('Female_Ranger', ['Body', 'Legs', 'Feet', 'Head_Hood'], tint=0x2a1a3a, strength=0.85)
    C.hide_under(outfit, dist=0.04)
    purple = CLOTH('sable_purple', 0x4a2a70)
    C.paint([(zones('uparm', 'forearm'), 0x2a1a3a, 0.9)])
    # veil: covers the face below the eyes
    hc, hs = head_center(C)
    C.shell(lambda v, co, z: z == 'head' and co.y < hc.y and co.z < hc.z + 0.005, 'veil', CLOTH('sable_veil', 0x5a3a80), offset=0.02, thick=0.008)
    # tall helmet crest / headdress
    hd = extrude_shape('crest', [(-0.06, 0), (0.06, 0), (0.02, 0.28), (-0.02, 0.28)], 0.14, m=STEEL('sable_steel', 0x6a6a8a))
    top = head_top(C)
    place(hd, loc=top + Vector((0, 0.02, -0.03)), rotxyz=(-15, 0, 0))
    C.rigid(hd, 'Head')
    cape(C, purple, width_top=0.34, width_bot=0.55, bottom=0.45, flare=0.2)
    rc = {'Steel': STEEL('sable_blade', 0xc0c8e0), 'LightSteel': STEEL('sable_blade2', 0xe0e8ff), 'Gold': STEEL('sable_gold', 0x8a70c0), 'LightWood': LEATHER('sable_grip', 0x2a1a3a), 'DarkWood': LEATHER('sable_grip', 0x2a1a3a)}
    C.weapon('Dagger_2', 'r', length=0.75, grip=-0.3, recolor=rc)
    C.weapon('Dagger_2', 'l', length=0.75, grip=-0.3, recolor=rc)
    return C


# ================================================================================================ THALOR
@recipe('thalor')
def thalor():
    C = Char('thalor', 'male', skin=0xf0d0b0, skin_strength=0.2)
    C.hair('Hair_Beard', 0xf4f4f0, 0.95)
    C.hair('Hair_Long', 0xf4f4f0, 0.95)
    C.prep()
    C.scale_region(BH(C, 'Head'), 0.25, 1.08)
    white = CLOTH('thalor_robe', 0x3c4660)
    blue = CLOTH('thalor_blue', 0x1a2240)
    gold = STEEL('thalor_gold', 0xe8c040)
    bolt = GLOW('thalor_bolt', 0x9ad0ff, 1.0)
    C.paint([(zones('chest', 'belly', 'hips'), 0x46506a, 1.0), (zones('thigh', 'calf'), 0x3c4660, 1.0), (zones('foot'), 0x6a4a28, 1.0)])
    robe(C, white, top=BH(C, 'pelvis').z + 0.1, hem=0.08, r_hem=0.42, stiff=0.3)
    # blue sash across the chest
    C.shell(lambda v, co, z: z in ('chest', 'belly') and abs(co.x - (co.z - 1.25) * 0.9) < 0.06, 'sash', gold, offset=0.014, thick=0.01)
    belt(C, gold, width=0.06)
    bracers(C, gold, offset=0.01, thick=0.01)
    cape(C, blue, width_top=0.44, width_bot=0.7, bottom=0.2, flare=0.28)
    # laurel/lightning crown
    top = head_top(C)
    hc, hs = head_center(C)
    ring = prim('torus', 'crown', gold, R=hs.x * 0.56, r=0.016, seg=16, rseg=5)
    place(ring, loc=(0, hc.y, top.z - 0.07))
    spikes = []
    for i in range(5):
        a = math.pi * (0.15 + 0.7 * i / 4) + math.pi
        p = Vector((math.cos(a) * hs.x * 0.56, hc.y + math.sin(a) * hs.y * 0.56, top.z - 0.06))
        spikes.append(orient(crystal(0.02, 0.14, bolt, seg=4), p, Vector((0, 0, 1))))
    C.rigid(join([ring] + spikes, 'crown'), 'Head')
    for s in 'lr':
        o = prim('ico', 'spark', bolt, sub=1, r=0.07)
        o.location = C.fist(s)
        apply_transforms(o)
        C.rigid(o, 'hand_' + s)
    return C


# ================================================================================================ VASHKAR
@recipe('vashkar')
def vashkar():
    C = Char('vashkar', 'male', skin=0x5a4a66, skin_strength=0.9)
    C.prep()
    C.scale_region(BH(C, 'spine_02'), 0.6, 0.92, (0.9, 0.9, 1.0))
    dark = CLOTH('vashkar_robe', 0x221c24)
    obsid = mat('vashkar_obsid', 0x1c1620, rough=0.3, metal=0.3, noise=0.08)
    bone = mat('vashkar_bone', 0xe0d0b0, rough=0.6)
    fel = GLOW('vashkar_fel', 0x80ff40, 1.0)
    C.paint([(zones('chest', 'belly', 'hips'), 0x2a2230, 1.0), (zones('thigh', 'calf'), 0x1a161c, 1.0)])
    robe(C, dark, top=BH(C, 'pelvis').z + 0.1, hem=0.1, r_hem=0.4, stiff=0.3, open_front=True)
    cape(C, CLOTH('vashkar_cape', 0x163a26), width_top=0.4, width_bot=0.75, bottom=0.12, flare=0.35)
    horns_pair(C, obsid, length=0.42, r=0.04, bend=1.1, spread=0.06, out=18, fwd=-55, up=0.0)
    hc, hs = head_center(C)
    eyes = []
    for dx in (-0.035, 0.035):
        e = prim('ico', 'eye', fel, sub=1, r=0.018)
        place(e, loc=hc + Vector((dx, -hs.y * 0.45, 0.03)))
        eyes.append(e)
    C.rigid(join(eyes, 'eyes'), 'Head')
    pauldron(C, 'l', obsid, size=0.12, spikes=0, layers=2, flat=0.55)
    pauldron(C, 'r', obsid, size=0.12, spikes=0, layers=2, flat=0.55)
    # staff topped with a clawed hand holding a fel orb
    def top_b(p, axis):
        objs = [orient(prim('ico', 'orb', fel, sub=2, r=0.07), p + axis * 0.1, axis)]
        for i in range(4):
            a = i / 4 * math.pi * 2
            d = (axis + Vector((math.cos(a), math.sin(a), 0)) * 0.6).normalized()
            h = horn(0.18, 0.02, 1.2)
            set_material(h, bone)
            orient(h, p + d * 0.03, d)
            objs.append(h)
        return objs
    staff(C, 'r', LEATHER('vashkar_staff', 0x3a2a1a), top_b, length=1.7, grip_frac=0.45)
    return C

REG_ORDER = list(REG.keys())
