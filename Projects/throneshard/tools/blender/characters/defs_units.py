# Creep / neutral / Grimmaw / summon recipes.
from parts import *
from defs_heroes import STEEL, CLOTH, LEATHER, GLOW, FUR

REG = {}


def recipe(name, tris=5000, tex=512):
    def deco(fn):
        REG[name] = (fn, dict(tris=tris, tex=tex))
        return fn
    return deco


def eyes(C, m, dx=0.035, r=0.018, fwd=0.45, up=0.03):
    hc, hs = head_center(C)
    es = []
    for x in (-dx, dx):
        e = prim('ico', 'eye', m, sub=1, r=r)
        place(e, loc=hc + Vector((x, -hs.y * fwd, up)))
        es.append(e)
    return C.rigid(join(es, 'eyes'), 'Head')


# ================================================================================================ CREEPS
@recipe('creep_melee_sunward', tris=5000)
def creep_melee_sunward():
    C = Char('creep_melee_sunward', 'male', skin=0xe0b890, skin_strength=0.2)
    C.prep()
    green = CLOTH('crm_green', 0x2f9a3a)
    steel = STEEL('crm_steel', 0x9aa2ae)
    gold = STEEL('crm_gold', 0xe0b040)
    C.paint([(zones('chest', 'belly', 'hips', 'uparm'), 0x2f9a3a, 1.0), (zones('thigh', 'calf'), 0x5a4a30, 1.0), (zones('foot'), 0x3a2a18, 1.0), (zones('forearm'), 0x8a7050, 1.0)])
    C.shell(zones('chest', 'belly'), 'mail', steel, offset=0.02, thick=0.015)
    hc, hs = head_center(C)
    C.shell(lambda v, co, z: z == 'head' and co.z > hc.z + 0.02, 'helm', steel, offset=0.02, thick=0.015)
    belt(C, gold, width=0.06)
    loincloth(C, green, width=0.26, length=0.38)
    pauldron(C, 'l', gold, size=0.12)
    pauldron(C, 'r', gold, size=0.12)
    boots(C, LEATHER('crm_boot', 0x4a3420))
    C.weapon('Sword', 'r', length=0.95, grip=-0.5)
    C.shield('Shield_Heater_2', 'l', size=0.62, recolor={'DarkWood': green, 'LightWood': CLOTH('crm_green2', 0x3ab84a), 'Steel': gold, 'LightSteel': gold})
    return C


@recipe('creep_melee_duskward', tris=5000)
def creep_melee_duskward():
    C = Char('creep_melee_duskward', 'imp', skin=0x7a2a2a, skin_strength=0.55)
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.4, 1.12)
    dark = STEEL('cmd_iron', 0x3a3036)
    red = GLOW('cmd_eye', 0xff5020, 1.0)
    eyes(C, red, dx=0.04, r=0.02)
    pauldron(C, 'l', dark, size=0.13, spikes=2, spike_mat=STEEL('cmd_spike', 0x8a8070))
    pauldron(C, 'r', dark, size=0.13, spikes=2, spike_mat=STEEL('cmd_spike', 0x8a8070))
    return C


@recipe('creep_ranged_sunward', tris=5000)
def creep_ranged_sunward():
    C = Char('creep_ranged_sunward', 'female', skin=0xf0c8a8, skin_strength=0.15)
    C.hair('Hair_Buns', 0x6a3a1a, 0.9)
    C.prep()
    green = CLOTH('crr_green', 0x2fa844)
    white = CLOTH('crr_white', 0xf0f0e0)
    C.paint([(zones('chest', 'belly', 'uparm'), 0xf0f0e0, 1.0), (zones('hips', 'thigh', 'calf'), 0x2fa844, 1.0), (zones('foot'), 0x5a4020, 1.0)])
    robe(C, green, hem=0.15, r_hem=0.34)
    belt(C, STEEL('crr_gold', 0xe0b040), width=0.05)
    cape(C, CLOTH('crr_cape', 0x1f7a30), width_top=0.34, width_bot=0.5, bottom=0.4, flare=0.2)
    def top_b(p, axis):
        return [orient(prim('ico', 'orb', GLOW('crr_orb', 0x80ff90, 1.0), sub=2, r=0.08), p + axis * 0.06, axis)]
    staff(C, 'r', LEATHER('crr_staff', 0x8a6030), top_b, length=1.35, grip_frac=0.45)
    return C


@recipe('creep_ranged_duskward', tris=5000)
def creep_ranged_duskward():
    C = Char('creep_ranged_duskward', 'male', skin=0x8a7a9a, skin_strength=0.9)
    C.prep()
    C.scale_region(BH(C, 'spine_02'), 0.6, 0.9, (0.9, 0.9, 1.0))
    robe_m = CLOTH('crd_robe', 0x4a1020)
    C.paint([(zones('chest', 'belly', 'hips', 'uparm'), 0x3a0c18, 1.0), (zones('thigh', 'calf', 'foot'), 0x2a0810, 1.0)])
    robe(C, robe_m, top=BH(C, 'spine_01').z, hem=0.05, r_hem=0.4, stiff=0.25)
    C.remove_body(zones('thigh', 'calf', zmin=0.2))
    hood = C.outfit('Male_Ranger', ['Head_Hood'], tint=0x3a0c18, strength=0.95)
    eyes(C, GLOW('crd_eye', 0xff3010, 1.0), dx=0.035)
    def top_b(p, axis):
        objs = [orient(prim('ico', 'orb', GLOW('crd_orb', 0xff4010, 1.0), sub=2, r=0.08), p + axis * 0.06, axis)]
        objs += [orient(horn(0.16, 0.02, 1.0), p, (axis + Vector((s * 0.6, 0, 0))).normalized()) for s in (-1, 1)]
        for o in objs[1:]:
            set_material(o, mat('crd_bone', 0xd8c8a0))
        return objs
    staff(C, 'r', LEATHER('crd_staff', 0x2a1a14), top_b, length=1.4, grip_frac=0.45)
    return C


# ================================================================================================ NEUTRALS
@recipe('neutral_small', tris=4500)
def neutral_small():
    C = Char('neutral_small', 'puglin', skin=0xa07040, skin_strength=0.5)
    C.prep()
    eyes(C, GLOW('ns_eye', 0xffd030, 1.0), dx=0.05, r=0.02, fwd=0.4)
    C.weapon('Spear', 'r', length=1.2, grip=1.0, recolor={'Steel': STEEL('ns_tip', 0xb0a898), 'LightSteel': STEEL('ns_tip', 0xb0a898)})
    return C


@recipe('neutral_large', tris=6500)
def neutral_large():
    """Ogre bruiser: blue-grey skin, huge belly & arms, club."""
    C = Char('neutral_large', 'male', skin=0x6a8aa8, skin_strength=0.95)
    C.prep()
    C.inflate(BH(C, 'spine_01') + Vector((0, -0.1, 0)), 0.45, 0.2)
    C.scale_region(BH(C, 'spine_03'), 0.5, 1.2, (1.25, 1.15, 1.0))
    for s in 'lr':
        C.inflate((BH(C, 'lowerarm_' + s) + BT(C, 'lowerarm_' + s)) / 2, 0.2, 0.05)
    C.scale_region(BH(C, 'Head'), 0.2, 0.85)
    C.paint([(zones('hips', 'thigh'), 0x5a3a20, 1.0), (zones('foot', 'calf'), 0x4a4a58, 0.3)])
    loincloth(C, FUR('nl_fur', 0x6a4a2a), width=0.36, length=0.4)
    belt(C, LEATHER('nl_belt', 0x3a2414))
    pauldron(C, 'l', FUR('nl_fur2', 0x5a4028), size=0.16)
    horns_pair(C, mat('nl_tusk', 0xe8dcc0), length=0.12, r=0.025, bend=0.6, spread=0.05, out=20, fwd=40, up=-0.14)
    C.weapon('Hammer_Small', 'r', length=1.25, grip=-1.0, recolor={'Steel': LEATHER('nl_clubh', 0x6a4a30), 'LightSteel': STEEL('nl_band', 0x7a7a80), 'LightWood': LEATHER('nl_club', 0x6a4a30), 'DarkWood': LEATHER('nl_club2', 0x4a3020)})
    return C


def golem(name, stone, glow, crack, skin, seed=1):
    C = Char(name, 'male', skin=skin, skin_strength=1.0)
    stone, glow = stone(), glow()
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.55, 1.3, (1.35, 1.2, 1.0))
    for s in 'lr':
        C.inflate((BH(C, 'lowerarm_' + s) + BT(C, 'lowerarm_' + s)) / 2, 0.25, 0.08)
        C.inflate(BH(C, 'hand_' + s), 0.15, 0.06)
    C.scale_region(BH(C, 'Head'), 0.2, 0.75)
    C.paint([(zones('hips', 'thigh'), crack, 0.0)])
    for b in ('upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'spine_03', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'Head'):
        rocks(C, stone, b, n=4 if 'spine' in b else 3, size=0.1 if 'spine' in b else 0.075, spread=0.1, seed=seed + hash(b) % 97)
    eyes(C, glow, dx=0.03, r=0.022)
    # glowing core
    z = BH(C, 'spine_02').z
    core = prim('ico', 'core', glow, sub=1, r=0.09)
    place(core, loc=(0, body_center_y(C, z) - body_extent(C, z)[1] - 0.02, z))
    C.rigid(core, 'spine_02')
    return C


@recipe('neutral_elder', tris=7000, tex=1024)
def neutral_elder():
    return golem('neutral_elder', lambda: mat('na_rock', 0x7a7a70, rough=0.9, noise=0.3, noise_scale=12), lambda: GLOW('na_glow', 0x40ffd0, 1.0), 0x40c0a0, 0x6a6a60)


@recipe('summon_golem', tris=6000)
def summon_golem():
    return golem('summon_golem', lambda: mat('sg_rock', 0x3a3030, rough=0.9, noise=0.3, noise_scale=12), lambda: GLOW('sg_lava', 0xff6010, 1.0), 0xff5010, 0x3a302c, seed=7)


@recipe('summon_treant', tris=5000)
def summon_treant():
    C = Char('summon_treant', 'male', skin=0x7a5a38, skin_strength=1.0)
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.5, 1.15)
    C.paint([(lambda v, co, z: (int(co.x * 60) % 3 == 0), 0x4a3420, 1.0)])
    leaf = mat('tr_leaf', 0x4aa030, rough=0.8, noise=0.3)
    top = head_top(C)
    ls = []
    rnd = random.Random(3)
    for i in range(8):
        o = prim('ico', 'leaf', leaf, sub=1, r=rnd.uniform(0.08, 0.13))
        place(o, loc=top + Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.05, 0.12), rnd.uniform(-0.02, 0.12))))
        flat(o)
        ls.append(o)
    C.rigid(join(ls, 'canopy'), 'Head')
    for s in 'lr':
        o = prim('ico', 'leafs', leaf, sub=1, r=0.1)
        place(o, loc=BH(C, 'upperarm_' + s) + Vector((0, 0, 0.08)))
        flat(o)
        C.rigid(o, 'upperarm_' + s)
    eyes(C, GLOW('tr_eye', 0xb0ff40, 1.0))
    return C


# ================================================================================================ GRIMMAW
@recipe('grimmaw', tris=12000, tex=1024)
def grimmaw():
    C = Char('grimmaw', 'imp', skin=0x7a6250, skin_strength=0.9)
    for o in list(C.extra):
        if any(k in o.name for k in ('Chains', 'Mace', 'Collar')):
            C.extra.remove(o)
            C.parts.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.65, 1.35, (1.4, 1.3, 1.1))
    C.inflate(BH(C, 'spine_01') + Vector((0, -0.08, 0)), 0.4, 0.1)
    for s in 'lr':
        C.inflate((BH(C, 'lowerarm_' + s) + BT(C, 'lowerarm_' + s)) / 2, 0.25, 0.06)
        C.inflate((BH(C, 'upperarm_' + s) + BT(C, 'upperarm_' + s)) / 2, 0.25, 0.05)
        C.scale_region(C.fist(s), 0.16, 1.5)
    C.paint([(zones('hips', 'thigh'), 0x3a2418, 0.9)])
    bone = mat('ro_horn', 0xf0e6cc, rough=0.5)
    horns_pair(C, bone, length=0.62, r=0.085, bend=1.4, spread=0.1, out=60, fwd=-25, up=0.0)
    eyes(C, GLOW('ro_eye', 0xffa020, 1.0), dx=0.045, r=0.024)
    z0, z1 = BH(C, 'spine_01').z, BH(C, 'spine_03').z + 0.12
    pts = []
    for i in range(6):
        z = z0 + (z1 - z0) * i / 5
        pts.append(Vector((0, body_center_y(C, z) + body_extent(C, z)[1] - 0.02, z)))
    spikes_row(C, bone, pts, length=0.26, r=0.06, direction=(0, 1, 0.5))
    plate = STEEL('ro_plate', 0x6a5a48)
    pauldron(C, 'l', plate, size=0.2, spikes=3, spike_mat=bone, spike_len=0.22)
    pauldron(C, 'r', plate, size=0.2, spikes=3, spike_mat=bone, spike_len=0.22)
    bracers(C, plate, offset=0.02, thick=0.02)
    belt(C, LEATHER('ro_belt', 0x3a2418), buckle=0.07, buckle_mat=bone)
    return C


# ================================================================================================ FALLBACK + NEW HEROES
@recipe('fallback', tris=9000)
def fallback():
    C = Char('fallback', 'male', skin=0xe0b890, skin_strength=0.2)
    C.hair('Hair_SimpleParted', 0x4a3020, 0.9)
    C.prep()
    C.paint([(zones('chest', 'belly', 'uparm', 'hips'), 0xb0b0b8, 1.0), (zones('thigh', 'calf'), 0x6a6a70, 1.0), (zones('foot'), 0x3a3030, 1.0)])
    steel = STEEL('fb_steel', 0xd0d0d8)
    pauldron(C, 'l', steel, size=0.14)
    pauldron(C, 'r', steel, size=0.14)
    belt(C, LEATHER('fb_belt', 0x3a2a1a))
    cape(C, CLOTH('fb_cape', 0xd8d8e0), bottom=0.35)
    C.weapon('Sword', 'r', length=1.1, grip=-0.5)
    return C


@recipe('ondur', tris=13000, tex=1024)
def ondur():
    C = Char('ondur', 'male', skin=0xb86a38, skin_strength=0.9)
    C.hair('Hair_Beard', 0xe8e0d0, 0.95)
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.55, 1.18, (1.25, 1.15, 1.0))
    C.paint([(zones('hips', 'thigh'), 0x5a4a8a, 1.0), (zones('calf', 'foot'), 0x7a4a28, 0.5)])
    fur = FUR('ondur_fur', 0x8a6a48)
    pauldron(C, 'l', fur, size=0.17, layers=2)
    pauldron(C, 'r', fur, size=0.17, layers=2)
    belt(C, LEATHER('ondur_belt', 0x4a3020), buckle=0.06, buckle_mat=STEEL('ondur_gold', 0xd0a040))
    loincloth(C, CLOTH('ondur_cloth', 0x4a3a7a), width=0.3, length=0.45)
    top = head_top(C)
    tuft = prim('cone', 'tuft', FUR('ondur_hair', 0xe8e0d0), seg=8, r1=0.08, r2=0.0, depth=0.18)
    place(tuft, loc=top + Vector((0, 0.03, 0.02)), rotxyz=(-40, 0, 0))
    C.rigid(tuft, 'Head')
    C.weapon('Hammer_Double', 'r', length=1.5, grip=-1.4, recolor={'Steel': mat('ondur_totem', 0x8a6a40, rough=0.8), 'LightSteel': mat('ondur_totem2', 0xa08050, rough=0.8), 'LightWood': LEATHER('ondur_haft', 0x5a3a20), 'DarkWood': LEATHER('ondur_haft2', 0x3a2410)})
    return C


@recipe('liora', tris=13000, tex=1024)
def liora():
    C = Char('liora', 'female', skin=0xf0c8a8, skin_strength=0.15)
    C.hair('Hair_Long', 0xe04a18, 0.95)
    C.prep()
    outfit = C.outfit('Female_Ranger', ['Body', 'Legs', 'Feet', 'Acc_Pauldrons'], tint=0x3a8a3a, strength=0.7)
    C.hide_under(outfit, dist=0.04)
    cape(C, CLOTH('liora_cape', 0x2a7a3a), width_top=0.36, width_bot=0.62, bottom=0.3, flare=0.3)
    up = C.aim_axis('hand_l', 'Punch_Jab', (0, 0, 1), frame=5)
    back = C.aim_axis('hand_l', 'Punch_Jab', (0, 1, 0), frame=5)
    C.weapon_frame('Bow_Golden', 'l', 1.4, up, back, recolor={'Gold': STEEL('liora_bow', 0xe0c050), 'LightWood': LEATHER('liora_grip', 0x5a3a20), 'White': GLOW('liora_string', 0xe0ffe0, 0.3)})
    return C


@recipe('rift_stalker', tris=13000, tex=1024)
def rift_stalker():
    C = Char('rift_stalker', 'male', skin=0x7a5aa8, skin_strength=0.95)
    C.prep()
    C.scale_region(BH(C, 'spine_03'), 0.5, 1.1)
    C.paint([(zones('hips', 'thigh', 'calf'), 0x3a2a50, 1.0), (zones('foot'), 0x2a2030, 1.0)])
    gold = STEEL('fv_gold', 0xd8b040)
    C.shell(zones('head', 'neck'), 'helm', mat('fv_helm', 0x4a3a70, rough=0.4), offset=0.03, thick=0.02)
    horns_pair(C, gold, length=0.24, r=0.04, bend=0.5, spread=0.07, out=15, fwd=-40, up=0.02)
    bracers(C, gold)
    pauldron(C, 'l', gold, size=0.15, layers=2)
    pauldron(C, 'r', gold, size=0.15, layers=2)
    belt(C, gold)
    loincloth(C, CLOTH('fv_cloth', 0x5a3a80), width=0.3, length=0.5)
    C.weapon('Hammer_Small', 'r', length=1.1, grip=-1.0, recolor={'Steel': STEEL('fv_mace', 0xa0a0c0), 'LightSteel': gold})
    return C


@recipe('bone_shaman', tris=12000, tex=1024)
def bone_shaman():
    C = Char('bone_shaman', 'male', skin=0x5a3a28, skin_strength=0.8)
    C.prep()
    C.scale_region(BH(C, 'spine_02'), 0.6, 0.9, (0.9, 0.9, 1.0))
    C.paint([(zones('hips', 'thigh'), 0x8a2a8a, 1.0)])
    loincloth(C, FUR('wd_grass', 0xa0a040), width=0.4, length=0.45)
    hc, hs = head_center(C)
    mask = extrude_shape('mask', [(-0.1, -0.12), (0.1, -0.12), (0.13, 0.1), (0.0, 0.34), (-0.13, 0.1)], 0.04, m=mat('wd_mask', 0xe8d8a0))
    mask.location = hc + Vector((0, -hs.y * 0.5 - 0.02, 0.0))
    apply_transforms(mask)
    C.rigid(mask, 'Head')
    eyes(C, GLOW('wd_eye', 0x80ff40, 1.0), fwd=0.75)
    def top_b(p, axis):
        return [orient(prim('ico', 'skull', mat('wd_skull', 0xe8e0c8), sub=2, r=0.08), p + axis * 0.05, axis)]
    staff(C, 'r', LEATHER('wd_staff', 0x5a3a20), top_b, length=1.6, grip_frac=0.45)
    return C
