import { du } from '../../core/constants.js';

// Talent trees: 4 tiers (hero level 10/15/20/25), two mutually exclusive options per tier.
// Choosing a talent costs one ability point. Option shapes (combinable):
//   { name, bonus: {stat: value} }                       flat hero stat (Hero.talentBonus, read by bonusFromSources)
//   { name, ability, values: {valueKey: +x} }            additive change to ability.v(valueKey)
//   { name, ability, cooldown: x | manaCost: x }         flat cooldown / mana cost reduction
//   { name, ability, castRange: x | radius: x }          flat cast range / radius increase (world units)
export const TALENT_TIERS = [10, 15, 20, 25];

const T = (a, b) => [a, b];

export const TALENT_DEFS = {
  brakka: {
    10: T({ name: '+8 Strength', bonus: { str: 8 } }, { name: '+30 Whirling Riposte Damage', ability: 'brakka_whirling_riposte', values: { damage: 30 } }),
    15: T({ name: '+20 Bloodfever Damage', ability: 'brakka_bloodfever', values: { dps: 20 } }, { name: '+6 HP Regen', bonus: { hpRegen: 6 } }),
    20: T({ name: "+0.5s Taunting Roar Duration", ability: 'brakka_taunting_roar', values: { duration: 0.5 } }, { name: '+8 Armor', bonus: { armor: 8 } }),
    25: T({ name: '+5% Whirling Riposte Chance', ability: 'brakka_whirling_riposte', values: { chance: 0.05 } }, { name: "+150 Executioner's Cleave Threshold", ability: 'brakka_executioners_cleave', values: { threshold: 150 } }),
  },
  kenshar: {
    10: T({ name: '+10 Agility', bonus: { agi: 10 } }, { name: '+40 Steel Cyclone DPS', ability: 'kenshar_steel_cyclone', values: { dps: 40 } }),
    15: T({ name: '+25 Attack Speed', bonus: { attackSpeed: 25 } }, { name: '+2% Mending Totem Heal', ability: 'kenshar_mending_totem', values: { healPct: 0.02 } }),
    20: T({ name: '+1s Steel Cyclone Duration', ability: 'kenshar_steel_cyclone', values: { duration: 1 } }, { name: '+5% Keen Edge Chance', ability: 'kenshar_keen_edge', values: { chance: 0.05 } }),
    25: T({ name: '+3 Thousand Cuts Slashes', ability: 'kenshar_thousand_cuts', values: { slashes: 3 } }, { name: '-8s Steel Cyclone Cooldown', ability: 'kenshar_steel_cyclone', cooldown: 8 }),
  },
  isolde: {
    10: T({ name: '+75 Rime Burst Damage', ability: 'isolde_rime_burst', values: { damage: 75 } }, { name: '+200 Health', bonus: { maxHp: 200 } }),
    15: T({ name: '+0.5s Ice Shackles Duration', ability: 'isolde_ice_shackles', values: { duration: 0.5 } }, { name: '+1 Wellspring Aura Mana Regen', ability: 'isolde_wellspring_aura', values: { regen: 1 } }),
    20: T({ name: '-3s Rime Burst Cooldown', ability: 'isolde_rime_burst', cooldown: 3 }, { name: '+50 Blizzard Veil Damage', ability: 'isolde_blizzard_veil', values: { explosionDamage: 50 } }),
    25: T({ name: '+250 Ice Shackles Damage', ability: 'isolde_ice_shackles', values: { totalDamage: 250 } }, { name: '+100 Blizzard Veil Explosion Radius', ability: 'isolde_blizzard_veil', values: { explosionRadius: du(100) } }),
  },
  pell: {
    10: T({ name: '+25 Scattershot DPS', ability: 'pell_scattershot', values: { dps: 25 } }, { name: '+30 Attack Speed', bonus: { attackSpeed: 30 } }),
    15: T({ name: '+40 Deadeye Damage', ability: 'pell_deadeye', values: { damage: 40 } }, { name: '+15 Agility', bonus: { agi: 15 } }),
    20: T({ name: '+12% Scattershot Slow', ability: 'pell_scattershot', values: { slow: 0.12 } }, { name: '-4s Final Round Cooldown', ability: 'pell_final_round', cooldown: 4 }),
    25: T({ name: '+100 Attack Range', ability: 'pell_steady_sights', values: { range: du(100) } }, { name: '+200 Final Round Damage', ability: 'pell_final_round', values: { damage: 200 } }),
  },
  sera: {
    10: T({ name: '+60 Flame Wave Damage', ability: 'sera_flame_wave', values: { damage: 60 } }, { name: '+25 Attack Speed', bonus: { attackSpeed: 25 } }),
    15: T({ name: '+100 Pillar of Flame Damage', ability: 'sera_pillar_of_flame', values: { damage: 100 } }, { name: '+15 Kindled Heart Attack Speed', ability: 'sera_kindled_heart', values: { attackSpeed: 15 } }),
    20: T({ name: '+0.4s Pillar of Flame Stun', ability: 'sera_pillar_of_flame', values: { stun: 0.4 } }, { name: '-2s Flame Wave Cooldown', ability: 'sera_flame_wave', cooldown: 2 }),
    25: T({ name: '+250 Sunlance Damage', ability: 'sera_sunlance', values: { damage: 250 } }, { name: '-25s Sunlance Cooldown', ability: 'sera_sunlance', cooldown: 25 }),
  },
  gorrow: {
    10: T({ name: '+80 Gut Hook Damage', ability: 'gorrow_gut_hook', values: { damage: 80 } }, { name: '+8 Strength', bonus: { str: 8 } }),
    15: T({ name: '+40 Blight Cloud Damage', ability: 'gorrow_blight_cloud', values: { dps: 40 } }, { name: '+10% Blight Cloud Slow', ability: 'gorrow_blight_cloud', values: { slow: 0.1 } }),
    20: T({ name: '-3s Gut Hook Cooldown', ability: 'gorrow_gut_hook', cooldown: 3 }, { name: '+1 Stitched Hide Strength per Stack', ability: 'gorrow_stitched_hide', values: { strPerStack: 1 } }),
    25: T({ name: '+0.3x Devour Strength Multiplier', ability: 'gorrow_devour', values: { strMult: 0.3 } }, { name: '+200 Gut Hook Range', ability: 'gorrow_gut_hook', castRange: du(200) }),
  },
  vesna: {
    10: T({ name: '+20 Chill Arrows Damage', ability: 'vesna_chill_arrows', values: { damage: 20 } }, { name: '+10 Agility', bonus: { agi: 10 } }),
    15: T({ name: '+20% Arrow Fan Damage', ability: 'vesna_arrow_fan', values: { damagePct: 0.2 } }, { name: '-4s Hush Wind Cooldown', ability: 'vesna_hush_wind', cooldown: 4 }),
    20: T({ name: '+10% Chill Arrows Slow', ability: 'vesna_chill_arrows', values: { slow: 0.1 } }, { name: '+100 Attack Range', bonus: { attackRange: du(100) } }),
    25: T({ name: "+10% Hunter's Eye Chance", ability: 'vesna_hunters_eye', values: { chance: 0.1 } }, { name: '+2 Arrow Fan Arrows', ability: 'vesna_arrow_fan', values: { arrows: 2 } }),
  },
  aldric: {
    10: T({ name: '+8 Strength', bonus: { str: 8 } }, { name: '+80 Thunder Gauntlet Damage', ability: 'aldric_thunder_gauntlet', values: { damage: 80 } }),
    15: T({ name: '+6 Rally Shout Armor', ability: 'aldric_rally_shout', values: { armor: 6 } }, { name: '+30 Attack Speed', bonus: { attackSpeed: 30 } }),
    20: T({ name: '+0.6s Thunder Gauntlet Stun', ability: 'aldric_thunder_gauntlet', values: { stun: 0.6 } }, { name: '+40% Wide Sweep', ability: 'aldric_wide_sweep', values: { cleave: 0.4 } }),
    25: T({ name: "+50% Titan's Might Damage", ability: 'aldric_titans_might', values: { damagePct: 0.5 } }, { name: '-5s Thunder Gauntlet Cooldown', ability: 'aldric_thunder_gauntlet', cooldown: 5 }),
  },
  morvane: {
    10: T({ name: '+100 Grave Frost AoE Damage', ability: 'morvane_grave_frost', values: { aoeDamage: 100 } }, { name: '+2 Mana Regen', bonus: { manaRegen: 2 } }),
    15: T({ name: '+10% Rime Armor Reduction', ability: 'morvane_rime_armor', values: { reduction: 0.1 } }, { name: '-2s Grave Frost Cooldown', ability: 'morvane_grave_frost', cooldown: 2 }),
    20: T({ name: '+0.6s Dread Stare Duration', ability: 'morvane_dread_stare', values: { duration: 0.6 } }, { name: '+150 Leaping Cold Damage', ability: 'morvane_leaping_cold', values: { damage: 150 } }),
    25: T({ name: '+10 Leaping Cold Bounces', ability: 'morvane_leaping_cold', values: { bounces: 10 } }, { name: '+60 Rime Armor Pulse Damage', ability: 'morvane_rime_armor', values: { pulseDamage: 60 } }),
  },
  sable: {
    10: T({ name: '+25% Throwing Knife Attack Factor', ability: 'sable_throwing_knife', values: { attackFactor: 0.25 } }, { name: '+25 Attack Speed', bonus: { attackSpeed: 25 } }),
    15: T({ name: '+1s Shadow Step Duration', ability: 'sable_shadow_step', values: { duration: 1 } }, { name: '+12 Agility', bonus: { agi: 12 } }),
    20: T({ name: '+10% Haze Evasion', ability: 'sable_haze', values: { evasion: 0.1 } }, { name: '-3s Throwing Knife Cooldown', ability: 'sable_throwing_knife', cooldown: 3 }),
    25: T({ name: '+5% Killing Edge Chance', ability: 'sable_killing_edge', values: { chance: 0.05 } }, { name: '+100% Killing Edge Crit Damage', ability: 'sable_killing_edge', values: { crit: 1 } }),
  },
  thalor: {
    10: T({ name: '+40 Forked Spark Damage', ability: 'thalor_forked_spark', values: { damage: 40 } }, { name: '+250 Mana', bonus: { maxMana: 250 } }),
    15: T({ name: '+100 Skybolt Damage', ability: 'thalor_skybolt', values: { damage: 100 } }, { name: '-4s Storm Leap Cooldown', ability: 'thalor_storm_leap', cooldown: 4 }),
    20: T({ name: '+5 Forked Spark Bounces', ability: 'thalor_forked_spark', values: { jumps: 5 } }, { name: '+0.4s Skybolt Stun', ability: 'thalor_skybolt', values: { stun: 0.4 } }),
    25: T({ name: "+200 Heaven's Verdict Damage", ability: 'thalor_heavens_verdict', values: { damage: 200 } }, { name: '+300 Skybolt Cast Range', ability: 'thalor_skybolt', castRange: du(300) }),
  },
  vashkar: {
    10: T({ name: '+80 Stone Spines Damage', ability: 'vashkar_stone_spines', values: { damage: 80 } }, { name: '+2 Mana Regen', bonus: { manaRegen: 2 } }),
    15: T({ name: '-4s Toadcurse Cooldown', ability: 'vashkar_toadcurse', cooldown: 4 }, { name: '+40 Siphon Will per Second', ability: 'vashkar_siphon_will', values: { drain: 40 } }),
    20: T({ name: '+0.6s Stone Spines Stun', ability: 'vashkar_stone_spines', values: { stun: 0.6 } }, { name: '+1s Toadcurse Duration', ability: 'vashkar_toadcurse', values: { duration: 1 } }),
    25: T({ name: '+300 Death Mark Damage', ability: 'vashkar_death_mark', values: { damage: 300 } }, { name: '-30s Death Mark Cooldown', ability: 'vashkar_death_mark', cooldown: 30 }),
  },
  ondur: {
    10: T({ name: '+60 Rift Wall Damage', ability: 'ondur_rift_wall', values: { damage: 60 } }, { name: '+10 Strength', bonus: { str: 10 } }),
    15: T({ name: '+50% Totem Swing Damage', ability: 'ondur_totem_swing', values: { bonusPct: 0.5 } }, { name: '-2s Rift Wall Cooldown', ability: 'ondur_rift_wall', cooldown: 2 }),
    20: T({ name: '+0.4s Tremor Stun', ability: 'ondur_tremor', values: { stun: 0.4 } }, { name: '+100 Tremor Radius', ability: 'ondur_tremor', radius: du(100) }),
    25: T({ name: '+50 Deep Quake Echo Damage', ability: 'ondur_deep_quake', values: { echo: 50 } }, { name: '-30s Deep Quake Cooldown', ability: 'ondur_deep_quake', cooldown: 30 }),
  },
  liora: {
    10: T({ name: '+120 Piercing Gale Damage', ability: 'liora_piercing_gale', values: { damage: 120 } }, { name: '+25 Attack Speed', bonus: { attackSpeed: 25 } }),
    15: T({ name: '+1s Tailwind Duration', ability: 'liora_tailwind', values: { duration: 1 } }, { name: '+0.6s Tether Shot Duration', ability: 'liora_tether_shot', values: { stun: 0.6 } }),
    20: T({ name: '-4s Tether Shot Cooldown', ability: 'liora_tether_shot', cooldown: 4 }, { name: '+100 Attack Range', bonus: { attackRange: du(100) } }),
    25: T({ name: '-15% Arrow Storm Damage Reduction', ability: 'liora_arrow_storm', values: { damageReduction: -0.15 } }, { name: '-15s Arrow Storm Cooldown', ability: 'liora_arrow_storm', cooldown: 15 }),
  },
  ormund: {
    10: T({ name: '+60 Confiscate Damage', ability: 'ormund_confiscate', values: { damage: 60 } }, { name: '+250 Health', bonus: { maxHp: 250 } }),
    15: T({ name: '+8% No Free Passage Slow', ability: 'ormund_no_free_passage', values: { slow: 0.08 } }, { name: '+6 Armor', bonus: { armor: 6 } }),
    20: T({ name: '+0.75s Confiscate Duration', ability: 'ormund_confiscate', values: { duration: 0.75 } }, { name: '-4s Stand Surety Cooldown', ability: 'ormund_stand_surety', cooldown: 4 }),
    25: T({ name: '+150 Called to Account Cap', ability: 'ormund_called_to_account', values: { cap: 150 } }, { name: '+10% Stand Surety Share', ability: 'ormund_stand_surety', values: { sharePct: 0.1 } }),
  },
};

// Generic fallback tree for heroes without a hand-written one (e.g. new heroes before their tree exists).
export const GENERIC_TALENTS = {
  10: T({ name: '+20 Attack Damage', bonus: { damage: 20 } }, { name: '+200 Health', bonus: { maxHp: 200 } }),
  15: T({ name: '+25 Attack Speed', bonus: { attackSpeed: 25 } }, { name: '+6 Armor', bonus: { armor: 6 } }),
  20: T({ name: '+10 All Attributes', bonus: { allStats: 10 } }, { name: '+2.5 Mana Regen', bonus: { manaRegen: 2.5 } }),
  25: T({ name: '+50 Attack Damage', bonus: { damage: 50 } }, { name: '+15% Spell Amplification', bonus: { spellAmp: 0.15 } }),
};

export function talentTree(heroId) { return TALENT_DEFS[heroId] ?? GENERIC_TALENTS; }
