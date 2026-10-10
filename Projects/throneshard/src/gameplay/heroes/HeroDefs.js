// Hero definitions. Distances are in game units here; Hero.js converts with du().
// Shape (see src/core/Hero.js): { id, name, title, primary, model, icon, color, attackType, str, agi, int, strGain,
//   agiGain, intGain, baseArmor, baseDamage[min,max] (without primary attribute), moveSpeed, attackRange, bat,
//   attackPoint, projectileSpeed, baseHpRegen, baseManaRegen, turnRate, abilities[q,w,e,r], roles[], lore,
//   projectileKind (vfx key for attack projectiles) }

const hero = (d) => ({
  model: d.id,
  baseHpRegen: 0.5,
  baseManaRegen: 0,
  turnRate: 10,
  projectileSpeed: 0,
  projectileKind: d.id,
  ...d,
});

export const HERO_DEFS = {
  brakka: hero({
    id: 'brakka', name: 'Brakka', title: 'the Red Warlord', primary: 'str', icon: '🪓', color: '#c0392b',
    attackType: 'melee', roles: ['Initiator', 'Durable', 'Disabler', 'Carry'],
    str: 25, agi: 20, int: 18, strGain: 2.8, agiGain: 1.7, intGain: 1.6,
    baseArmor: -1, baseDamage: [27, 31], moveSpeed: 310, attackRange: 150, bat: 1.7, attackPoint: 0.4, baseHpRegen: 2.75,
    abilities: ['brakka_taunting_roar', 'brakka_bloodfever', 'brakka_whirling_riposte', 'brakka_executioners_cleave'],
    lore: "Brakka clawed his way up from the pit-fights of the Red Steppe to lead its war bands. He answers every challenge in person, and he has yet to lose one.",
  }),
  kenshar: hero({
    id: 'kenshar', name: 'Kenshar', title: 'the Masked Blade', primary: 'agi', icon: '🗡️', color: '#e67e22',
    attackType: 'melee', roles: ['Carry', 'Pusher', 'Escape'],
    str: 21, agi: 34, int: 14, strGain: 2.2, agiGain: 2.8, intGain: 1.4,
    baseArmor: 0, baseDamage: [20, 24], moveSpeed: 305, attackRange: 150, bat: 1.4, attackPoint: 0.33,
    abilities: ['kenshar_steel_cyclone', 'kenshar_mending_totem', 'kenshar_keen_edge', 'kenshar_thousand_cuts'],
    lore: "Nobody has seen the face behind Kenshar's lacquered mask. The last duelist of a drowned island school, he keeps its forms alive one flawless cut at a time.",
  }),
  isolde: hero({
    id: 'isolde', name: 'Isolde', title: 'the Frost Warden', primary: 'int', icon: '❄️', color: '#5dade2',
    attackType: 'ranged', roles: ['Support', 'Disabler', 'Nuker'],
    str: 18, agi: 16, int: 16, strGain: 2.5, agiGain: 1.6, intGain: 3.3,
    baseArmor: 0, baseDamage: [24, 30], moveSpeed: 280, attackRange: 600, bat: 1.7, attackPoint: 0.45, projectileSpeed: 900,
    abilities: ['isolde_rime_burst', 'isolde_ice_shackles', 'isolde_wellspring_aura', 'isolde_blizzard_veil'],
    lore: "Isolde keeps the northern passes for the glacier-folk who raised her. Where she walks the air turns to rime, and her friends find their spells come easier in the cold.",
  }),
  pell: hero({
    id: 'pell', name: 'Pell', title: 'the Long Shot', primary: 'agi', icon: '🎯', color: '#b7950b',
    attackType: 'ranged', roles: ['Carry', 'Nuker'],
    str: 19, agi: 27, int: 15, strGain: 2.0, agiGain: 3.4, intGain: 2.6,
    baseArmor: -1, baseDamage: [15, 21], moveSpeed: 285, attackRange: 550, bat: 1.7, attackPoint: 0.17, projectileSpeed: 3000,
    abilities: ['pell_scattershot', 'pell_deadeye', 'pell_steady_sights', 'pell_final_round'],
    lore: "Pell learned to shoot in the high valleys, knocking pinecones off ridgelines half a mile away. He carries a long-barreled rifle and a very short temper.",
  }),
  sera: hero({
    id: 'sera', name: 'Sera', title: 'the Cinder Queen', primary: 'int', icon: '🔥', color: '#e74c3c',
    attackType: 'ranged', roles: ['Support', 'Carry', 'Nuker', 'Disabler'],
    str: 18, agi: 23, int: 30, strGain: 2.2, agiGain: 1.7, intGain: 3.7,
    baseArmor: -1, baseDamage: [21, 35], moveSpeed: 290, attackRange: 670, bat: 1.6, attackPoint: 0.75, projectileSpeed: 1000,
    abilities: ['sera_flame_wave', 'sera_pillar_of_flame', 'sera_kindled_heart', 'sera_sunlance'],
    lore: "Sera was crowned by the fire cult of the salt flats after she walked out of their sacred furnace unburnt. She has been setting things alight ever since.",
  }),
  gorrow: hero({
    id: 'gorrow', name: 'Gorrow', title: 'the Carrion Cook', primary: 'str', icon: '🍖', color: '#7d9a3a',
    attackType: 'melee', roles: ['Disabler', 'Initiator', 'Durable', 'Nuker'],
    str: 25, agi: 14, int: 16, strGain: 3.0, agiGain: 1.4, intGain: 1.8,
    baseArmor: -1, baseDamage: [45, 51], moveSpeed: 285, attackRange: 150, bat: 1.7, attackPoint: 0.5, baseHpRegen: 2,
    abilities: ['gorrow_gut_hook', 'gorrow_blight_cloud', 'gorrow_stitched_hide', 'gorrow_devour'],
    lore: "Gorrow runs the kitchen at the edge of every battlefield. He brings his own hook, his own knives, and an appetite that never seems to fill.",
  }),
  vesna: hero({
    id: 'vesna', name: 'Vesna', title: 'the Winter Archer', primary: 'agi', icon: '🏹', color: '#85c1e9',
    attackType: 'ranged', roles: ['Carry', 'Disabler', 'Pusher'],
    str: 18, agi: 30, int: 15, strGain: 1.8, agiGain: 2.9, intGain: 1.4,
    baseArmor: -1, baseDamage: [10, 21], moveSpeed: 290, attackRange: 625, bat: 1.7, attackPoint: 0.5, projectileSpeed: 1250,
    abilities: ['vesna_chill_arrows', 'vesna_hush_wind', 'vesna_arrow_fan', 'vesna_hunters_eye'],
    lore: "Vesna hunts the frozen forests alone. Her arrows carry a frost that numbs the legs, and she rarely needs more than a few of them.",
  }),
  aldric: hero({
    id: 'aldric', name: 'Aldric', title: 'the Oathbreaker', primary: 'str', icon: '⚔️', color: '#2e86c1',
    attackType: 'melee', roles: ['Carry', 'Disabler', 'Initiator', 'Durable', 'Nuker'],
    str: 23, agi: 21, int: 16, strGain: 3.2, agiGain: 2.0, intGain: 1.3,
    baseArmor: 1, baseDamage: [41, 43], moveSpeed: 315, attackRange: 150, bat: 1.8, attackPoint: 0.4,
    abilities: ['aldric_thunder_gauntlet', 'aldric_wide_sweep', 'aldric_rally_shout', 'aldric_titans_might'],
    lore: "Aldric swore his sword to a knightly order and broke the vow the day it asked him to burn a village. He now fights for no banner but his own conscience.",
  }),
  morvane: hero({
    id: 'morvane', name: 'Morvane', title: 'the Ice Revenant', primary: 'int', icon: '💀', color: '#48c9b0',
    attackType: 'ranged', roles: ['Support', 'Nuker'],
    str: 20, agi: 15, int: 24, strGain: 2.05, agiGain: 2.0, intGain: 3.3,
    baseArmor: -1, baseDamage: [18, 27], moveSpeed: 295, attackRange: 550, bat: 1.7, attackPoint: 0.46, projectileSpeed: 900,
    abilities: ['morvane_grave_frost', 'morvane_rime_armor', 'morvane_dread_stare', 'morvane_leaping_cold'],
    lore: "Morvane was a court sorcerer sealed inside a glacier for his crimes. The ice kept him, and his grudge, perfectly preserved until the day it cracked.",
  }),
  sable: hero({
    id: 'sable', name: 'Sable', title: 'the Veiled Blade', primary: 'agi', icon: '🗡', color: '#8e44ad',
    attackType: 'melee', roles: ['Carry', 'Escape'],
    str: 19, agi: 21, int: 15, strGain: 2.0, agiGain: 3.4, intGain: 1.7,
    baseArmor: 1, baseDamage: [23, 25], moveSpeed: 310, attackRange: 150, bat: 1.7, attackPoint: 0.3,
    abilities: ['sable_throwing_knife', 'sable_shadow_step', 'sable_haze', 'sable_killing_edge'],
    lore: "Sable was raised by a sisterhood of veiled killers who take no names and leave no witnesses. Her targets rarely see more than the glint of a knife.",
  }),
  thalor: hero({
    id: 'thalor', name: 'Thalor', title: 'the Storm Father', primary: 'int', icon: '⚡', color: '#5dade2',
    attackType: 'ranged', roles: ['Nuker', 'Carry'],
    str: 19, agi: 11, int: 22, strGain: 2.3, agiGain: 1.2, intGain: 3.3,
    baseArmor: 1, baseDamage: [29, 37], moveSpeed: 300, attackRange: 380, bat: 1.7, attackPoint: 0.633, projectileSpeed: 1100,
    abilities: ['thalor_forked_spark', 'thalor_skybolt', 'thalor_storm_leap', 'thalor_heavens_verdict'],
    lore: "Thalor rules the high clouds and treats every mortal champion like an unruly grandchild. When he loses patience, the sky does too.",
  }),
  vashkar: hero({
    id: 'vashkar', name: 'Vashkar', title: 'the Hexbinder', primary: 'int', icon: '🐸', color: '#a93226',
    attackType: 'ranged', roles: ['Support', 'Disabler', 'Nuker', 'Initiator'],
    str: 18, agi: 15, int: 18, strGain: 2.3, agiGain: 1.5, intGain: 3.5,
    baseArmor: 0, baseDamage: [29, 35], moveSpeed: 290, attackRange: 600, bat: 1.7, attackPoint: 0.43, projectileSpeed: 1000,
    abilities: ['vashkar_stone_spines', 'vashkar_toadcurse', 'vashkar_siphon_will', 'vashkar_death_mark'],
    lore: "Vashkar bargained with something below the world for power and then cheated it. He wears its severed claw as a charm and turns his enemies into toads for fun.",
  }),
  // WS5 additions — reuse existing model kinds until dedicated models exist (set `model` to the new kind then).
  ondur: hero({
    id: 'ondur', name: 'Ondur', title: 'the Stonehorn', primary: 'str', icon: '🌋', color: '#b9770e', model: 'aldric',
    attackType: 'melee', roles: ['Support', 'Initiator', 'Disabler', 'Nuker'],
    str: 22, agi: 12, int: 18, strGain: 3.7, agiGain: 1.4, intGain: 1.8,
    baseArmor: 2, baseDamage: [27, 37], moveSpeed: 305, attackRange: 150, bat: 1.7, attackPoint: 0.467, baseHpRegen: 1,
    abilities: ['ondur_rift_wall', 'ondur_totem_swing', 'ondur_tremor', 'ondur_deep_quake'],
    lore: "Ondur was a mountain spirit before he learned to walk. He carries a stone totem as tall as a man, and when he strikes the ground, the ground strikes back.",
  }),
  liora: hero({
    id: 'liora', name: 'Liora', title: 'the Gale Archer', primary: 'int', icon: '🍃', color: '#27ae60', model: 'vesna',
    attackType: 'ranged', roles: ['Carry', 'Support', 'Disabler', 'Escape', 'Nuker'], projectileKind: 'vesna',
    str: 18, agi: 17, int: 18, strGain: 3.0, agiGain: 1.9, intGain: 2.8,
    baseArmor: 0, baseDamage: [24, 36], moveSpeed: 290, attackRange: 600, bat: 1.5, attackPoint: 0.4, projectileSpeed: 1250,
    abilities: ['liora_tether_shot', 'liora_piercing_gale', 'liora_tailwind', 'liora_arrow_storm'],
    lore: "Liora was found as a baby in the eye of a storm and raised by the wind that left her there. She moves like a squall and never wastes an arrow.",
  }),
  // Wears the spare model rift_stalker (src/models/configs.js); there is no ormund.glb.
  ormund: hero({
    id: 'ormund', name: 'Ormund', title: 'the Tollkeeper', primary: 'str', icon: '🗝️', color: '#7a5aa8', model: 'rift_stalker',
    attackType: 'melee', roles: ['Guardian', 'Durable', 'Disabler'],
    str: 24, agi: 14, int: 18, strGain: 3.1, agiGain: 1.5, intGain: 1.8,
    baseArmor: 1, baseDamage: [28, 34], moveSpeed: 300, attackRange: 150, bat: 1.7, attackPoint: 0.4, baseHpRegen: 1.5,
    abilities: ['ormund_stand_surety', 'ormund_confiscate', 'ormund_no_free_passage', 'ormund_called_to_account'],
    lore: "Ormund keeps the gate where the rift meets the road and takes a toll from everything that crosses it. He writes every blow he is owed in a ledger, and he has never let a debt go.",
  }),
};

export const HERO_IDS = Object.keys(HERO_DEFS);
export default HERO_DEFS;
