import * as P from './props.js';

// Character configurations.
//   rig: GLB in assets/models/chars/<rig>.glb — one skinned mesh + baked atlas, built by
//        tools/blender/characters (see build.sh). All rigs share the 23-bone Quaternius UE-style skeleton, so every
//        clip in chars/anims.glb works on every character.
//   height: world height of the rest-pose model (feet → top of head/helmet/hair).
//   anims: idle/run/attack/cast/death → clip | [clips] (random per play) | { clip, speed, hit }.
//          Clip names are Universal Animation Library names or COMBOS below.
//   hitFrac: fallback attackHitFraction when a clip has no CLIP_META entry.
//   props: procedural extras at the model root (auras).
//   glowColor: colour of the baked emissive mask (default: albedo).
//   base (legacy): Fox / Horse GLBs recoloured via tint rules (wolves, courier).

// Clips glued together at load time (windup + recovery → one attack clip).
export const COMBOS = {
  SwordA: ['Sword_Regular_A', 'Sword_Regular_A_Rec'],
  SwordB: ['Sword_Regular_B', 'Sword_Regular_B_Rec'],
  Hook: ['Melee_Hook', 'Melee_Hook_Rec'],
  SpellShot: ['Spell_Simple_Enter', 'Spell_Simple_Shoot'],
};

// Fraction of each clip where the weapon/spell visually connects, measured from hand-speed peaks in Blender
// (tools/blender/characters/measure_hits.py) and checked frame by frame in scripts/model_gallery.mjs.
export const CLIP_META = {
  Sword_Attack: { hit: 0.31 },
  SwordA: { hit: 0.21 },
  SwordB: { hit: 0.22 },
  Sword_Regular_C: { hit: 0.35 },
  Hook: { hit: 0.28 },
  Punch_Cross: { hit: 0.22 },
  Punch_Jab: { hit: 0.22 },
  Zombie_Scratch: { hit: 0.35 },
  OverhandThrow: { hit: 0.31 },
  SpellShot: { hit: 0.58 },
  Spell_Simple_Shoot: { hit: 0.2 },
  Pistol_Shoot: { hit: 0.08 },
  Sword_Dash: { hit: 0.22 },
  Shield_OneShot: { hit: 0.15 },
  TreeChopping_Loop: { hit: 0.45 },
};

const MELEE = { idle: 'Sword_Idle', run: 'Jog_Fwd_Loop', death: 'Death01', cast: 'OverhandThrow' };
const CASTER = { idle: 'Idle_Loop', run: 'Jog_Fwd_Loop', death: 'Death01', attack: 'SpellShot', cast: 'SpellShot' };
const BRUTE = { idle: 'Idle_Loop', run: 'Jog_Fwd_Loop', death: 'Death01', cast: 'Shield_OneShot' };

export const CHARACTERS = {
  // ------------------------------------------------ HEROES
  brakka: { rig: 'brakka', height: 2.55, anims: { ...MELEE, attack: ['Sword_Attack', 'SwordA'], cast: 'Shield_OneShot' } },
  kenshar: { rig: 'kenshar', height: 2.35, anims: { ...MELEE, attack: ['SwordA', 'SwordB', 'Sword_Regular_C'], cast: 'Sword_Dash' } },
  isolde: { rig: 'isolde', height: 2.3, anims: { ...CASTER }, props: [{ build: () => P.footAura(0x66c8ff, 1.0, 0.3) }] },
  pell: { rig: 'pell', height: 2.0, anims: { idle: 'Pistol_Idle_Loop', run: 'Jog_Fwd_Loop', death: 'Death01', attack: 'Pistol_Shoot', cast: 'Pistol_Shoot' } },
  sera: { rig: 'sera', height: 2.35, anims: { ...CASTER, cast: 'OverhandThrow' }, props: [{ build: () => P.footAura(0xff6010, 1.0, 0.35) }] },
  gorrow: { rig: 'gorrow', height: 2.75, runRef: 6.5, anims: { ...BRUTE, idle: 'Zombie_Idle_Loop', run: 'Zombie_Walk_Fwd_Loop', attack: ['Hook', 'Zombie_Scratch'], cast: 'OverhandThrow' } },
  vesna: { rig: 'vesna', height: 2.25, anims: { ...CASTER, attack: 'Punch_Jab', cast: 'OverhandThrow' }, props: [{ build: () => P.footAura(0x9fdcff, 0.8, 0.2) }] },
  aldric: { rig: 'aldric', height: 2.5, anims: { ...MELEE, attack: ['Sword_Attack', 'Sword_Regular_C'], cast: 'OverhandThrow' } },
  morvane: { rig: 'morvane', height: 2.45, anims: { ...CASTER }, props: [{ build: () => P.footAura(0x60c0ff, 1.1, 0.35) }] },
  sable: { rig: 'sable', height: 2.2, anims: { ...MELEE, attack: ['SwordA', 'SwordB'], cast: 'OverhandThrow' } },
  thalor: { rig: 'thalor', height: 2.4, anims: { ...CASTER, cast: 'OverhandThrow' }, props: [{ build: () => P.footAura(0x7ab8ff, 1.0, 0.3) }] },
  vashkar: { rig: 'vashkar', height: 2.45, anims: { ...CASTER }, props: [{ build: () => P.footAura(0x70ff30, 0.9, 0.25) }] },
  // heroes WS5 may add
  ondur: { rig: 'ondur', height: 2.6, anims: { ...MELEE, idle: 'Idle_Loop', attack: ['Sword_Attack', 'Hook'], cast: 'Shield_OneShot' } },
  liora: { rig: 'liora', height: 2.25, anims: { ...CASTER, attack: 'Punch_Jab', cast: 'OverhandThrow' } },
  rift_stalker: { rig: 'rift_stalker', height: 2.45, anims: { ...MELEE, attack: ['Sword_Attack', 'SwordA'], cast: 'Sword_Dash' } },
  bone_shaman: { rig: 'bone_shaman', height: 2.3, anims: { ...CASTER, cast: 'OverhandThrow' }, props: [{ build: () => P.footAura(0x80ff60, 0.9, 0.25) }] },

  // ------------------------------------------------ CREEPS
  creep_melee_sunward: { rig: 'creep_melee_sunward', height: 1.85, anims: { ...MELEE, attack: ['SwordA', 'SwordB'] } },
  creep_melee_duskward: { rig: 'creep_melee_duskward', height: 1.95, anims: { ...MELEE, attack: ['Sword_Attack', 'SwordB'] } },
  creep_ranged_sunward: { rig: 'creep_ranged_sunward', height: 1.8, anims: { ...CASTER } },
  creep_ranged_duskward: { rig: 'creep_ranged_duskward', height: 1.85, anims: { ...CASTER } },

  // ------------------------------------------------ NEUTRALS / SUMMONS
  neutral_small: { rig: 'neutral_small', height: 1.35, anims: { ...BRUTE, idle: 'Sword_Idle', attack: ['SwordA', 'Hook'] } },
  neutral_medium: {
    base: 'Fox', height: 1.25, lengthScale: 1.2,
    tint: [['*', 0x8a8e9a, 0.85]],
    anims: { idle: 'Survey', run: 'Run', attack: null, cast: null, death: null },
  },
  summon_wolf: {
    base: 'Fox', height: 1.4, lengthScale: 1.25,
    tint: [['*', 0x4a4a58, 0.9]],
    props: [{ build: () => P.footAura(0x6a8aff, 0.7, 0.2) }],
    anims: { idle: 'Survey', run: 'Run', attack: null, cast: null, death: null },
  },
  neutral_large: { rig: 'neutral_large', height: 2.9, widen: 1.05, runRef: 6.5, anims: { ...BRUTE, attack: ['Sword_Attack', 'Hook'] } },
  neutral_elder: { rig: 'neutral_elder', height: 3.4, runRef: 6, anims: { ...BRUTE, idle: 'Zombie_Idle_Loop', run: 'Zombie_Walk_Fwd_Loop', attack: ['Punch_Cross', 'Zombie_Scratch'] } },
  grimmaw: { rig: 'grimmaw', height: 4.4, runRef: 6, anims: { ...BRUTE, idle: 'Zombie_Idle_Loop', run: 'Zombie_Walk_Fwd_Loop', attack: ['Zombie_Scratch', 'Punch_Cross', 'Hook'], cast: 'Shield_OneShot' }, props: [{ build: () => P.footAura(0xff8030, 2.2, 0.2) }] },
  summon_golem: { rig: 'summon_golem', height: 2.8, runRef: 6, anims: { ...BRUTE, idle: 'Zombie_Idle_Loop', run: 'Zombie_Walk_Fwd_Loop', attack: ['Punch_Cross', 'Zombie_Scratch'] }, props: [{ build: () => P.footAura(0xff5010, 1.2, 0.3) }] },
  summon_treant: { rig: 'summon_treant', height: 2.3, runRef: 6, anims: { ...BRUTE, idle: 'Zombie_Idle_Loop', run: 'Zombie_Walk_Fwd_Loop', attack: ['Zombie_Scratch', 'Punch_Cross'] } },
  courier: {
    base: 'Horse', height: 1.5,
    tint: [['*', 0x8a7a6a, 0.8]],
    props: [{ build: P.courierBags }],
    anims: { idle: { clip: 'horse_A_', speed: 0 }, run: { clip: 'horse_A_', speed: 1.1 }, attack: null, cast: null, death: null },
  },
  fallback: { rig: 'fallback', height: 2.3, anims: { ...MELEE, attack: ['SwordA', 'Sword_Attack'] } },
};

// Hero ids the Heroes agent uses in HeroDefs[x].model.
export const HERO_IDS = ['brakka', 'kenshar', 'isolde', 'pell', 'sera', 'gorrow', 'vesna', 'aldric', 'morvane', 'sable', 'thalor', 'vashkar'];
