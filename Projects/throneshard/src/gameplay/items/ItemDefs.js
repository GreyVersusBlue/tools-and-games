// Item definitions. Owned by the Items agent.
//
// Def shape (see ARCHITECTURE "Items contract"):
//   { id, name, icon (emoji), color (icon bg), cost (total, computed for recipes), bonus {stat: value},
//     components?: [ids], recipeCost?, active?: {name, targetType, targetTeam, cooldown, manaCost, castRange, castPoint},
//     passive?: {...special passive data consumed by ItemSystem}, description, lore?, category, shop: 'base'|'secret',
//     stackable?, charges? (charges granted per purchase), maxCharges?, consumable? (removed at 0 charges),
//     stock?: {initial, max, restock}, meleeBonus?/rangedBonus? (stat bonus only for melee / ranged heroes) }
// Distances are WORLD units (du(gameUnits)). Bonus keys are understood by Unit/Hero.getStat; `evasion`, `lifesteal`,
// `spellAmp`, `castRange` are read by the ItemSystem / abilities.
import { du } from '../../core/constants.js';

const MS = (v) => du(v); // movement speed in world units

// Categories in shop-tab order.
export const SHOP_CATEGORIES = [
  { id: 'consumables', name: 'Consumables', group: 'basic' },
  { id: 'attributes', name: 'Attributes', group: 'basic' },
  { id: 'equipment', name: 'Equipment', group: 'basic' },
  { id: 'misc', name: 'Miscellaneous', group: 'basic' },
  { id: 'secret', name: 'Hidden Bazaar', group: 'basic' },
  { id: 'accessories', name: 'Accessories', group: 'upgrades' },
  { id: 'support', name: 'Support', group: 'upgrades' },
  { id: 'magical', name: 'Magical', group: 'upgrades' },
  { id: 'armor', name: 'Armor', group: 'upgrades' },
  { id: 'weapons', name: 'Weapons', group: 'upgrades' },
  { id: 'artifacts', name: 'Artifacts', group: 'upgrades' },
];

const RAW = [
  // ------------------------------------------------------------------ Consumables
  { id: 'homeward_scroll', name: 'Homeward Scroll', icon: '📜', color: '#3a6fb0', cost: 100, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 20,
    active: { name: 'Teleport', targetType: 'point', targetTeam: 'any', cooldown: 80, manaCost: 75, castRange: 0, castPoint: 0, channel: 3 },
    description: 'Channel for 3 seconds, then teleport to the allied structure nearest the target point.',
    lore: 'Read aloud, it carries you home.' },
  { id: 'bark_ration', name: 'Bark Ration', icon: '🌿', color: '#3f8f3a', cost: 90, category: 'consumables',
    stackable: true, consumable: true, charges: 3, maxCharges: 20,
    active: { name: 'Chew Bark', targetType: 'none', cooldown: 0.5, manaCost: 0, castPoint: 0 },
    description: 'Consume a charge to regenerate 7 HP/s for 16 seconds.' },
  { id: 'healing_salve', name: 'Healing Salve', icon: '🧪', color: '#b83a32', cost: 100, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 20,
    active: { name: 'Salve', targetType: 'none', cooldown: 0.5, manaCost: 0, castPoint: 0 },
    description: 'Regenerate 40 HP/s for 10 seconds. Breaks if damaged by an enemy hero or tower.' },
  { id: 'clarity', name: 'Clarity', icon: '💧', color: '#2f78c8', cost: 50, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 20,
    active: { name: 'Clarity', targetType: 'none', cooldown: 0.5, manaCost: 0, castPoint: 0 },
    description: 'Regenerate 6 mana/s for 25 seconds. Breaks if damaged by an enemy hero.' },
  { id: 'honeyed_plum', name: 'Honeyed Plum', icon: '🥭', color: '#d9831f', cost: 65, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 20, bonus: { hpRegen: 0.6 },
    active: { name: 'Eat Plum', targetType: 'none', cooldown: 0.5, manaCost: 0, castPoint: 0 },
    description: 'Instantly restores 100 mana.' },
  { id: 'wisp_ember', name: 'Wisp Ember', icon: '🧚', color: '#c43c8e', cost: 70, category: 'consumables',
    stackable: false, consumable: true, charges: 1, bonus: { damage: 2 },
    active: { name: 'Wisp Ember', targetType: 'none', cooldown: 5, manaCost: 0, castPoint: 0 },
    description: 'Instantly restores 85 health.' },
  { id: 'lookout_ward', name: 'Lookout Ward', icon: '👁️', color: '#b8962e', cost: 0, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 4, stock: { initial: 2, max: 4, restock: 135 },
    active: { name: 'Plant', targetType: 'point', targetTeam: 'any', cooldown: 1, manaCost: 0, castRange: du(500), castPoint: 0, radius: du(1600) },
    description: 'Plants an invisible ward that grants 1600 vision for 6 minutes. Gives 100 gold to an enemy that destroys it.' },
  { id: 'seeker_ward', name: 'Seeker Ward', icon: '🔎', color: '#2d6fa8', cost: 50, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 10, stock: { initial: 5, max: 10, restock: 60 },
    active: { name: 'Plant', targetType: 'point', targetTeam: 'any', cooldown: 1, manaCost: 0, castRange: du(500), castPoint: 0, radius: du(900) },
    description: 'Plants an invisible ward that reveals invisible units (including enemy wards) within 900 range for 7 minutes.' },
  { id: 'ashveil_powder', name: 'Ashveil Powder', icon: '🌫️', color: '#6c6f7a', cost: 50, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 3, stock: { initial: 2, max: 3, restock: 420 },
    active: { name: 'Shroud', targetType: 'none', cooldown: 1, manaCost: 0, castPoint: 0, radius: du(1200) },
    description: 'Allied heroes within 1200 become invisible and gain 15% movement speed for 35s. Broken by attacking or nearby enemy heroes/towers.' },
  { id: 'glimmerdust', name: 'Glimmerdust', icon: '✨', color: '#8b6fb8', cost: 80, category: 'consumables',
    stackable: true, consumable: true, charges: 1, maxCharges: 10,
    active: { name: 'Reveal', targetType: 'none', cooldown: 30, manaCost: 0, castPoint: 0, radius: du(1050) },
    description: 'Reveals invisible enemies within 1050 for 12 seconds and slows them by 20%.' },
  { id: 'bottle', name: 'Bottle', icon: '🍾', color: '#4d9fb0', cost: 675, category: 'consumables',
    charges: 3, maxCharges: 3, keepAtZero: true,
    active: { name: 'Regenerate', targetType: 'none', cooldown: 0.5, manaCost: 0, castPoint: 0 },
    description: 'Consume a charge to restore 110 HP and 60 mana over 2.5s. Refills at the fountain. Picking up a power rune stores it in the Bottle (refilling it); use the Bottle to activate the stored rune.' },

  // ------------------------------------------------------------------ Attributes
  { id: 'oak_twig', name: 'Oak Twig', icon: '🌱', color: '#6b8e3a', cost: 50, category: 'attributes', bonus: { allStats: 1 } },
  { id: 'gauntlets', name: 'Gauntlets of Strength', icon: '🥊', color: '#a33b2c', cost: 140, category: 'attributes', bonus: { str: 3 } },
  { id: 'slippers', name: 'Slippers of Agility', icon: '🥿', color: '#3a9a4a', cost: 140, category: 'attributes', bonus: { agi: 3 } },
  { id: 'mantle', name: 'Mantle of Intelligence', icon: '🧣', color: '#2f63b0', cost: 140, category: 'attributes', bonus: { int: 3 } },
  { id: 'circlet', name: 'Circlet', icon: '💍', color: '#a58a3c', cost: 155, category: 'attributes', bonus: { allStats: 2 } },
  { id: 'belt_of_strength', name: 'Belt of Strength', icon: '🎗️', color: '#9c3a2a', cost: 450, category: 'attributes', bonus: { str: 6 } },
  { id: 'fleetfoot_band', name: 'Fleetfoot Band', icon: '🧝', color: '#2f8f46', cost: 450, category: 'attributes', bonus: { agi: 6 } },
  { id: 'robe', name: 'Robe of the Magi', icon: '👘', color: '#3f58b0', cost: 450, category: 'attributes', bonus: { int: 6 } },
  { id: 'crown', name: 'Crown', icon: '👑', color: '#b89a2e', cost: 450, category: 'attributes', bonus: { allStats: 4 } },
  { id: 'brute_hatchet', name: 'Brute Hatchet', icon: '🪓', color: '#a0402c', cost: 1000, category: 'attributes', bonus: { str: 10 } },
  { id: 'quickstep_blade', name: 'Quickstep Blade', icon: '🗡️', color: '#2e9a5a', cost: 1000, category: 'attributes', bonus: { agi: 10 } },
  { id: 'staff_of_wizardry', name: 'Staff of Wizardry', icon: '🪄', color: '#3a5cc0', cost: 1000, category: 'attributes', bonus: { int: 10 } },

  // ------------------------------------------------------------------ Equipment
  { id: 'woodsmans_knife', name: "Woodsman's Knife", icon: '🔪', color: '#6f7d4a', cost: 100, category: 'equipment',
    passive: { creepBonus: { melee: 8, ranged: 4 } }, description: 'Passive: +8 (melee) / +4 (ranged) attack damage against creeps.' },
  { id: 'ring_of_protection', name: 'Ring of Protection', icon: '⭕', color: '#8a7a5a', cost: 175, category: 'equipment', bonus: { armor: 2 } },
  { id: 'blades_of_attack', name: 'Blades of Attack', icon: '🔪', color: '#8f4a3a', cost: 450, category: 'equipment', bonus: { damage: 9 } },
  { id: 'gloves', name: 'Gloves of Haste', icon: '🧤', color: '#b88a2a', cost: 450, category: 'equipment', bonus: { attackSpeed: 20 } },
  { id: 'chainmail', name: 'Chainmail', icon: '⛓️', color: '#6a7480', cost: 550, category: 'equipment', bonus: { armor: 4 } },
  { id: 'quarterstaff', name: 'Quarterstaff', icon: '🏑', color: '#8a6a3a', cost: 875, category: 'equipment', bonus: { damage: 10, attackSpeed: 10 } },
  { id: 'helm_of_iron_will', name: 'Helm of Iron Will', icon: '⛑️', color: '#7a6a5a', cost: 975, category: 'equipment', bonus: { armor: 6, hpRegen: 5 } },
  { id: 'javelin', name: 'Javelin', icon: '🎯', color: '#8a5a2a', cost: 900, category: 'equipment', bonus: { damage: 20 },
    passive: { proc: { chance: 0.25, damage: 40 } }, description: 'Passive Pierce: 25% chance on attack to deal 40 bonus magical damage.' },
  { id: 'broadsword', name: 'Broadsword', icon: '⚔️', color: '#707a8a', cost: 1000, category: 'equipment', bonus: { damage: 15 } },
  { id: 'claymore', name: 'Claymore', icon: '🗡️', color: '#5a6a80', cost: 1350, category: 'equipment', bonus: { damage: 20 } },
  { id: 'mithril_hammer', name: 'Mithril Hammer', icon: '🔨', color: '#6a7a9a', cost: 1600, category: 'equipment', bonus: { damage: 24 } },

  // ------------------------------------------------------------------ Misc
  { id: 'ring_of_regen', name: 'Ring of Regen', icon: '➰', color: '#3a8a4a', cost: 175, category: 'misc', bonus: { hpRegen: 1.25 } },
  { id: 'scholars_veil', name: "Scholar's Veil", icon: '🎭', color: '#3a6aa0', cost: 175, category: 'misc', bonus: { manaRegen: 0.7 } },
  { id: 'resonant_reed', name: 'Resonant Reed', icon: '🥢', color: '#8a5a8a', cost: 200, category: 'misc',
    charges: 0, maxCharges: 10, keepAtZero: true, passive: { stick: 10 },
    active: { name: 'Release Charge', targetType: 'none', cooldown: 13, manaCost: 0, castPoint: 0 },
    description: 'Gains a charge whenever a nearby enemy hero casts a spell (max 10). Restores 15 HP and mana per charge.' },
  { id: 'breeze_ribbon', name: 'Breeze Ribbon', icon: '🎐', color: '#5ab0c0', cost: 250, category: 'misc', bonus: { moveSpeed: MS(20) } },
  { id: 'woolen_cap', name: 'Woolen Cap', icon: '🎩', color: '#a07a5a', cost: 250, category: 'misc', bonus: { maxHp: 125 } },
  { id: 'boots', name: 'Boots of Speed', icon: '👢', color: '#8a5a3a', cost: 500, category: 'misc', bonus: { moveSpeed: MS(45) } },
  { id: 'ring_of_health', name: 'Ring of Health', icon: '💚', color: '#2f9a5a', cost: 700, category: 'misc', bonus: { hpRegen: 6.5 } },
  { id: 'quietstone', name: 'Quietstone', icon: '🔮', color: '#5a3aa0', cost: 725, category: 'misc', bonus: { manaRegen: 1.75 } },
  { id: 'cloak', name: 'Cloak', icon: '🧥', color: '#6a4a8a', cost: 800, category: 'misc', bonus: { magicResist: 0.15 } },
  { id: 'leech_mask', name: 'Leech Mask', icon: '💀', color: '#8a2a3a', cost: 900, category: 'misc', bonus: { lifesteal: 0.18 },
    description: 'Passive: heals for 18% of attack damage dealt.' },
  { id: 'umbral_pendant', name: 'Umbral Pendant', icon: '🌑', color: '#3a3a5a', cost: 1000, category: 'misc', bonus: { attackSpeed: 20 } },
  { id: 'flicker_dagger', name: 'Flicker Dagger', icon: '💫', color: '#4a6ad0', cost: 2250, category: 'misc',
    active: { name: 'Flicker', targetType: 'point', targetTeam: 'any', cooldown: 15, manaCost: 0, castRange: du(1200), castPoint: 0 },
    description: 'Teleport to a target point up to 1200 units away. Disabled for 3 seconds after taking damage from an enemy hero.',
    lore: 'A dagger that folds the space between two steps.' },

  // ------------------------------------------------------------------ Hidden Bazaar
  { id: 'mana_geode', name: 'Mana Geode', icon: '🔋', color: '#2f6ac0', cost: 800, category: 'secret', shop: 'secret', bonus: { maxMana: 250 } },
  { id: 'heartroot', name: 'Heartroot', icon: '❤️', color: '#b02f3a', cost: 1000, category: 'secret', shop: 'secret', bonus: { maxHp: 250 } },
  { id: 'lodestone', name: 'Lodestone', icon: '⭐', color: '#8a5ac0', cost: 1200, category: 'secret', shop: 'secret', bonus: { maxHp: 175, maxMana: 175 } },
  { id: 'feather_charm', name: 'Feather Charm', icon: '🍃', color: '#3aa08a', cost: 1300, category: 'secret', shop: 'secret', bonus: { evasion: 0.15 } },
  { id: 'platemail', name: 'Platemail', icon: '🦺', color: '#6a7a8a', cost: 1400, category: 'secret', shop: 'secret', bonus: { armor: 10 } },
  { id: 'quickening_gem', name: 'Quickening Gem', icon: '💎', color: '#c0a02a', cost: 2000, category: 'secret', shop: 'secret', bonus: { attackSpeed: 60 } },
  { id: 'paragon_orb', name: 'Paragon Orb', icon: '🔵', color: '#3a7ad0', cost: 2050, category: 'secret', shop: 'secret', bonus: { allStats: 10 } },
  { id: 'fiendblade', name: 'Fiendblade', icon: '👹', color: '#a02a2a', cost: 2200, category: 'secret', shop: 'secret', bonus: { damage: 40 } },
  { id: 'colossus_pick', name: 'Colossus Pick', icon: '⛏️', color: '#9a3a2a', cost: 2800, category: 'secret', shop: 'secret', bonus: { str: 25 } },
  { id: 'hawkfeather', name: 'Hawkfeather', icon: '🪶', color: '#2f9a4a', cost: 2800, category: 'secret', shop: 'secret', bonus: { agi: 25 } },
  { id: 'arcanists_rod', name: "Arcanist's Rod", icon: '🔱', color: '#3a4ac0', cost: 2800, category: 'secret', shop: 'secret', bonus: { int: 25 } },
  { id: 'hallowed_idol', name: 'Hallowed Idol', icon: '🏺', color: '#c07a2a', cost: 3800, category: 'secret', shop: 'secret', bonus: { damage: 60 } },

  // ------------------------------------------------------------------ Accessories
  { id: 'resonant_wand', name: 'Resonant Wand', icon: '🪄', color: '#9a4ab0', category: 'accessories',
    components: ['oak_twig', 'oak_twig', 'resonant_reed'], recipeCost: 150, bonus: { allStats: 3 },
    charges: 0, maxCharges: 20, keepAtZero: true, passive: { stick: 20 },
    active: { name: 'Release Charge', targetType: 'none', cooldown: 13, manaCost: 0, castPoint: 0 },
    description: 'Gains a charge whenever a nearby enemy hero casts a spell (max 20). Restores 15 HP and mana per charge.' },
  { id: 'bracer', name: 'Bracer', icon: '🛡️', color: '#a0402c', category: 'accessories',
    components: ['circlet', 'gauntlets'], recipeCost: 210, bonus: { str: 5, agi: 2, int: 2, hpRegen: 1, damage: 3 } },
  { id: 'swift_band', name: 'Swift Band', icon: '🪬', color: '#2f9a5a', category: 'accessories',
    components: ['circlet', 'slippers'], recipeCost: 210, bonus: { agi: 5, str: 2, int: 2, attackSpeed: 5, armor: 1.5 } },
  { id: 'mind_talisman', name: 'Mind Talisman', icon: '📿', color: '#3a63c0', category: 'accessories',
    components: ['circlet', 'mantle'], recipeCost: 210, bonus: { int: 5, str: 2, agi: 2, maxMana: 40, manaRegen: 0.6 } },
  { id: 'shifting_treads', name: 'Shifting Treads', icon: '🥾', color: '#9a6a2a', category: 'accessories',
    components: ['boots', 'gloves', 'belt_of_strength'], recipeCost: 0, bonus: { moveSpeed: MS(45), attackSpeed: 25 },
    passive: { treads: 10 },
    active: { name: 'Switch Attribute', targetType: 'toggle', cooldown: 0, manaCost: 0, castPoint: 0 },
    description: 'Grants +10 to the selected attribute. Activate to cycle Strength → Intelligence → Agility.' },
  { id: 'surge_boots', name: 'Surge Boots', icon: '👟', color: '#b0502a', category: 'accessories',
    components: ['boots', 'blades_of_attack', 'chainmail'], recipeCost: 0, bonus: { moveSpeed: MS(45), damage: 12, armor: 4 },
    meleeBonus: { damage: 6 },
    active: { name: 'Surge', targetType: 'none', cooldown: 8, manaCost: 0, castPoint: 0 },
    description: 'Surge: +20% (melee) / +10% (ranged) movement speed and unobstructed movement for 3s. Melee heroes gain +6 extra damage.' },
  { id: 'tidecall_boots', name: 'Tidecall Boots', icon: '🔷', color: '#2f6ab0', category: 'accessories',
    components: ['boots', 'mana_geode'], recipeCost: 0, bonus: { moveSpeed: MS(45), maxMana: 250 },
    active: { name: 'Replenish Mana', targetType: 'none', cooldown: 55, manaCost: 0, castPoint: 0, radius: du(1200) },
    description: 'Restores 175 mana to allies within 1200.' },
  { id: 'wayfarer_boots', name: 'Wayfarer Boots', icon: '🌠', color: '#c09a2a', category: 'accessories',
    components: ['boots'], recipeCost: 2000, bonus: { moveSpeed: MS(100) },
    active: { name: 'Travel', targetType: 'point', targetTeam: 'any', cooldown: 45, manaCost: 75, castRange: 0, castPoint: 0, channel: 3 },
    description: 'Channel for 3s, then teleport to the allied structure or creep nearest the target point.' },
  { id: 'gilded_gauntlet', name: 'Gilded Gauntlet', icon: '🫱', color: '#d0a020', category: 'accessories',
    components: ['gloves'], recipeCost: 1750, bonus: { attackSpeed: 40 },
    active: { name: 'Gild', targetType: 'unit', targetTeam: 'enemy', cooldown: 90, manaCost: 0, castRange: du(600), castPoint: 0 },
    description: 'Kills a non-hero, non-elder creep instantly, granting 160 gold and 2.1x its experience.' },
  { id: 'frenzy_mask', name: 'Frenzy Mask', icon: '👺', color: '#b02a2a', category: 'artifacts',
    components: ['leech_mask', 'quarterstaff'], recipeCost: 0, bonus: { damage: 10, attackSpeed: 10, lifesteal: 0.2 },
    active: { name: 'Frenzy', targetType: 'none', cooldown: 16, manaCost: 25, castPoint: 0 },
    description: 'Frenzy: +110 attack speed and +30% movement speed for 6s, but -8 armor.' },

  // ------------------------------------------------------------------ Support
  { id: 'headdress', name: 'Headdress', icon: '🪶', color: '#4a9a4a', category: 'support',
    components: ['ring_of_regen', 'oak_twig'], recipeCost: 200, bonus: { allStats: 1, hpRegen: 2 } },
  { id: 'buckler', name: 'Buckler', icon: '🛡️', color: '#7a6a4a', category: 'support',
    components: ['ring_of_protection', 'oak_twig'], recipeCost: 200, bonus: { allStats: 1, armor: 3 } },
  { id: 'clockwork_mender', name: 'Clockwork Mender', icon: '⚙️', color: '#3a9a6a', category: 'support',
    components: ['headdress', 'chainmail'], recipeCost: 800, bonus: { allStats: 1, hpRegen: 2, armor: 4 },
    active: { name: 'Restore', targetType: 'none', cooldown: 50, manaCost: 150, castPoint: 0, radius: du(1200) },
    description: 'Heals allied heroes within 1200 for 275 HP.' },
  { id: 'keepers_greaves', name: "Keeper's Greaves", icon: '🪖', color: '#3a8ab0', category: 'support',
    components: ['clockwork_mender', 'tidecall_boots', 'buckler'], recipeCost: 1450,
    bonus: { moveSpeed: MS(45), maxMana: 250, armor: 5, hpRegen: 3, allStats: 2 },
    active: { name: 'Mend', targetType: 'none', cooldown: 40, manaCost: 0, castPoint: 0, radius: du(1200) },
    description: 'Heals allies within 1200 for 350 HP and restores 200 mana. Dispels the caster.' },
  { id: 'thrust_staff', name: 'Thrust Staff', icon: '🦯', color: '#4a8ac0', category: 'support',
    components: ['staff_of_wizardry', 'woolen_cap'], recipeCost: 950, bonus: { int: 10, maxHp: 175 },
    active: { name: 'Thrust', targetType: 'unit', targetTeam: 'any', cooldown: 19, manaCost: 100, castRange: du(550), castPoint: 0 },
    description: 'Pushes the target unit 600 units in the direction it is facing.' },
  { id: 'shimmer_cloak', name: 'Shimmer Cloak', icon: '🌌', color: '#5a4ab0', category: 'support',
    components: ['umbral_pendant', 'cloak'], recipeCost: 150, bonus: { attackSpeed: 20, magicResist: 0.2 },
    active: { name: 'Shimmer', targetType: 'unit', targetTeam: 'ally', cooldown: 14, manaCost: 90, castRange: du(600), castPoint: 0 },
    description: 'After 0.5s the target turns invisible for 5s and gains a barrier absorbing 450 magic damage.' },
  { id: 'ironbark_shield', name: 'Ironbark Shield', icon: '🛡️', color: '#8a4a2a', category: 'armor',
    components: ['ring_of_health', 'heartroot'], recipeCost: 0, bonus: { maxHp: 250, hpRegen: 7 },
    passive: { block: { melee: 64, ranged: 32 } }, description: 'Passive: blocks 64 (melee) / 32 (ranged) damage from attacks.' },
  { id: 'crimson_bulwark', name: 'Crimson Bulwark', icon: '🟥', color: '#a02a2a', category: 'armor',
    components: ['ironbark_shield', 'helm_of_iron_will'], recipeCost: 1050, bonus: { maxHp: 250, hpRegen: 12, armor: 8 },
    passive: { block: { melee: 64, ranged: 32 } },
    active: { name: 'Guard', targetType: 'none', cooldown: 46, manaCost: 0, castPoint: 0, radius: du(1200) },
    description: 'Guard: allies within 1200 block 72 damage from each attack for 12s.' },
  { id: 'farsight_lens', name: 'Farsight Lens', icon: '🔍', color: '#3a8ad0', category: 'support',
    components: ['mana_geode', 'quietstone'], recipeCost: 750, bonus: { maxMana: 300, manaRegen: 2.5, castRange: du(225) },
    description: 'Passive: +225 cast range for spells and items.' },

  // ------------------------------------------------------------------ Magical
  { id: 'vigor_stone', name: 'Vigor Stone', icon: '🌀', color: '#3a9a8a', category: 'magical',
    components: ['ring_of_health', 'quietstone'], recipeCost: 0, bonus: { hpRegen: 6.5, manaRegen: 1.75 } },
  { id: 'hollow_staff', name: 'Hollow Staff', icon: '🦯', color: '#4a4a9a', category: 'magical',
    components: ['quarterstaff', 'scholars_veil', 'robe'], recipeCost: 0, bonus: { int: 6, damage: 10, attackSpeed: 10, manaRegen: 0.7 } },
  { id: 'whirlwind_scepter', name: "Whirlwind Scepter", icon: '🌪️', color: '#4ab0c0', category: 'magical',
    components: ['staff_of_wizardry', 'quietstone', 'breeze_ribbon'], recipeCost: 650, bonus: { int: 10, manaRegen: 2.5, moveSpeed: MS(20) },
    active: { name: 'Whirlwind', targetType: 'unit', targetTeam: 'any', cooldown: 23, manaCost: 175, castRange: du(575), castPoint: 0 },
    description: 'Lifts the target in a whirlwind for 2.5s, making it invulnerable and disabled. Enemies take 50 damage on landing.' },
  { id: 'clearmind', name: 'Clearmind', icon: '🟦', color: '#3a5ad0', category: 'artifacts',
    components: ['staff_of_wizardry', 'robe'], recipeCost: 600, bonus: { int: 16, spellAmp: 0.08, manaRegen: 0.5 } },
  { id: 'silencing_bloom', name: 'Silencing Bloom', icon: '🌸', color: '#a03a9a', category: 'magical',
    components: ['hollow_staff', 'hollow_staff'], recipeCost: 475, bonus: { int: 25, damage: 30, attackSpeed: 30, manaRegen: 3 },
    active: { name: 'Wither', targetType: 'unit', targetTeam: 'enemy', cooldown: 18, manaCost: 100, castRange: du(900), castPoint: 0 },
    description: 'Silences the target for 5s. When it ends, deals 30% of the damage taken during the silence as magical damage.' },
  { id: 'thornbloom', name: 'Thornbloom', icon: '🩸', color: '#8a1a3a', category: 'magical',
    components: ['silencing_bloom', 'glint_blade'], recipeCost: 1000, bonus: { int: 25, damage: 60, attackSpeed: 30, manaRegen: 3 },
    passive: { crit: { chance: 0.2, mult: 1.75 } },
    active: { name: 'Rend', targetType: 'unit', targetTeam: 'enemy', cooldown: 15, manaCost: 100, castRange: du(900), castPoint: 0 },
    description: 'Silences the target for 5s; attacks against it always hit and crit for 145%. Passive: 20% chance to crit for 175%.' },
  { id: 'ascendant_scepter', name: "Ascendant Scepter", icon: '🔱', color: '#3a7ad0', category: 'magical',
    components: ['lodestone', 'brute_hatchet', 'quickstep_blade', 'staff_of_wizardry'], recipeCost: 0,
    bonus: { allStats: 10, maxHp: 175, maxMana: 175 },
    description: "Upgrades your hero's ultimate (and some abilities)." },
  { id: 'morphing_scythe', name: 'Morphing Scythe', icon: '🐑', color: '#6a3ab0', category: 'magical',
    components: ['arcanists_rod', 'paragon_orb', 'quietstone'], recipeCost: 100, bonus: { int: 35, str: 10, agi: 10, manaRegen: 4 },
    active: { name: 'Beastshape', targetType: 'unit', targetTeam: 'enemy', cooldown: 20, manaCost: 250, castRange: du(800), castPoint: 0 },
    description: 'Turns the target into a harmless critter for 3.5s, disabling its attacks and abilities.' },
  { id: 'renewal_orb', name: 'Renewal Orb', icon: '🔄', color: '#2fa08a', category: 'magical',
    components: ['vigor_stone', 'vigor_stone'], recipeCost: 2150, bonus: { hpRegen: 13, manaRegen: 5 },
    active: { name: 'Reset Cooldowns', targetType: 'none', cooldown: 180, manaCost: 350, castPoint: 0 },
    description: 'Resets the cooldowns of all your abilities and items.' },
  { id: 'warding_sphere', name: "Warding Sphere", icon: '🔵', color: '#2a8ad0', category: 'magical',
    components: ['paragon_orb', 'vigor_stone'], recipeCost: 1325, bonus: { allStats: 15, hpRegen: 6.5, manaRegen: 1.75 },
    passive: { spellBlock: 14 }, description: 'Passive: blocks most targeted enemy spells once every 14 seconds.' },
  { id: 'windseer_blade', name: 'Windseer Blade', icon: '💠', color: '#3a8a9a', category: 'artifacts',
    components: ['swiftwind', 'clearmind'], recipeCost: 0, bonus: { agi: 16, int: 16, attackSpeed: 12, moveSpeedPct: 0.08, spellAmp: 0.12, manaRegen: 0.5 } },
  { id: 'warmage_blade', name: 'Warmage Blade', icon: '♦️', color: '#8a3a8a', category: 'artifacts',
    components: ['clearmind', 'ironheart'], recipeCost: 0, bonus: { str: 16, int: 16, spellAmp: 0.12, hpRegen: 1.5, manaRegen: 0.5 } },

  // ------------------------------------------------------------------ Armor
  { id: 'unbroken_standard', name: 'Unbroken Standard', icon: '🏏', color: '#b08a2a', category: 'armor',
    components: ['brute_hatchet', 'mithril_hammer'], recipeCost: 1450, bonus: { str: 10, damage: 24 },
    active: { name: 'Unbreakable', targetType: 'none', cooldown: 95, manaCost: 0, castPoint: 0 },
    description: 'Grants magic immunity and removes debuffs. Duration 9s, reduced by 1s per use (min 5s).' },
  { id: 'siege_cuirass', name: 'Siege Cuirass', icon: '🛡️', color: '#c08a2a', category: 'armor',
    components: ['platemail', 'quickening_gem', 'buckler'], recipeCost: 1300, bonus: { armor: 10, attackSpeed: 30 },
    passive: { aura: 'assault' }, description: 'Aura (1200): allies gain +30 attack speed and +5 armor; enemies lose 5 armor.' },
  { id: 'frostguard_mail', name: "Frostguard Mail", icon: '❄️', color: '#4ab0e0', category: 'armor',
    components: ['platemail', 'arcanists_rod'], recipeCost: 975, bonus: { armor: 15, int: 30 },
    passive: { aura: 'frostguard' },
    active: { name: 'Glacial Pulse', targetType: 'none', cooldown: 30, manaCost: 100, castPoint: 0, radius: du(900) },
    description: 'Emits a freezing wave (900 radius) dealing 200 magical damage and slowing 40% for 4s. Aura: enemies -45 attack speed.' },
  { id: 'behemoth_heart', name: 'Behemoth Heart', icon: '🫀', color: '#b02a3a', category: 'armor',
    components: ['heartroot', 'colossus_pick'], recipeCost: 1200, bonus: { str: 45, maxHp: 250 },
    passive: { heartRegen: 0.016 }, description: 'Passive: regenerates 1.6% of max health per second.' },
  { id: 'mirror_mantle', name: 'Mirror Mantle', icon: '🌊', color: '#2a7ab0', category: 'armor',
    components: ['swiftwind', 'paragon_orb'], recipeCost: 550, bonus: { str: 10, agi: 26, int: 10, attackSpeed: 15, moveSpeedPct: 0.08 },
    active: { name: 'Split Self', targetType: 'none', cooldown: 30, manaCost: 125, castPoint: 0 },
    description: 'Creates 2 illusions for 20s (deal 33% damage, take 350%) and dispels the caster.' },

  // ------------------------------------------------------------------ Weapons
  { id: 'glint_blade', name: 'Glint Blade', icon: '💎', color: '#a02a5a', category: 'weapons',
    components: ['blades_of_attack', 'broadsword'], recipeCost: 500, bonus: { damage: 32 },
    passive: { crit: { chance: 0.3, mult: 1.6 } }, description: 'Passive: 30% chance to deal 160% critical damage.' },
  { id: 'headsmans_blade', name: "Headsman's Blade", icon: '🏹', color: '#c02a2a', category: 'weapons',
    components: ['glint_blade', 'fiendblade'], recipeCost: 1000, bonus: { damage: 88 },
    passive: { crit: { chance: 0.3, mult: 2.25 } }, description: 'Passive: 30% chance to deal 225% critical damage.' },
  { id: 'armorbane', name: 'Armorbane', icon: '🔥', color: '#8a1a1a', category: 'weapons',
    components: ['mithril_hammer', 'mithril_hammer'], recipeCost: 300, bonus: { damage: 50 },
    passive: { corruption: { armor: -6, duration: 7 } }, description: 'Passive: attacks reduce the target\'s armor by 6 for 7s.' },
  { id: 'unerring_staff', name: 'Unerring Staff', icon: '🥢', color: '#c09a3a', category: 'weapons',
    components: ['fiendblade', 'javelin', 'quarterstaff'], recipeCost: 1000, bonus: { damage: 40, attackSpeed: 45 },
    passive: { trueStrike: true, proc: { chance: 0.7, damage: 70 } },
    description: 'Passive: attacks cannot miss. 70% chance to deal 70 bonus magical damage.' },
  { id: 'harvest_glaive', name: 'Harvest Glaive', icon: '🪓', color: '#b04a2a', category: 'weapons',
    components: ['broadsword', 'claymore', 'vigor_stone', 'woodsmans_knife'], recipeCost: 225,
    bonus: { damage: 50, hpRegen: 7.5, manaRegen: 2.75 },
    passive: { cleave: { pct: 0.7, radius: du(650) }, creepBonus: { melee: 20, ranged: 8 } },
    description: 'Passive: melee attacks cleave 70% damage to enemies in front. Bonus damage vs creeps.' },
  { id: 'stormcoil', name: 'Stormcoil', icon: '⚡', color: '#3a8ad0', category: 'weapons',
    components: ['javelin', 'mithril_hammer'], recipeCost: 200, bonus: { damage: 24, attackSpeed: 15 },
    passive: { chain: { chance: 0.25, damage: 140, bounces: 4, radius: du(650) } },
    description: 'Passive: 25% chance on attack to release chain lightning dealing 140 magical damage, bouncing to 4 targets.' },
  { id: 'pyre_brand', name: 'Pyre Brand', icon: '☀️', color: '#e0a020', category: 'weapons',
    components: ['hallowed_idol'], recipeCost: 1350, bonus: { damage: 60, evasion: 0.15 },
    passive: { aura: 'pyre_brand' }, description: 'Burn aura: enemies within 700 take 60 magical damage per second.' },
  { id: 'swallowtail', name: 'Swallowtail', icon: '🦋', color: '#3ab08a', category: 'weapons',
    components: ['hawkfeather', 'feather_charm', 'quarterstaff'], recipeCost: 0,
    bonus: { agi: 35, damage: 25, attackSpeed: 30, evasion: 0.35 }, description: 'Passive: 35% evasion.' },
  { id: 'fateblade', name: 'Fateblade', icon: '🗡️', color: '#e0c050', category: 'weapons',
    components: ['hallowed_idol', 'fiendblade'], recipeCost: 0, bonus: { damage: 350 },
    passive: { dropsOnDeath: true }, description: 'An incredibly powerful weapon. Drops on death — the killer takes it.' },

  // ------------------------------------------------------------------ Artifacts
  { id: 'ironheart', name: 'Ironheart', icon: '🟥', color: '#b03a2a', category: 'artifacts',
    components: ['brute_hatchet', 'belt_of_strength'], recipeCost: 600, bonus: { str: 16, hpRegen: 1.5 } },
  { id: 'swiftwind', name: 'Swiftwind', icon: '🟩', color: '#2f9a4a', category: 'artifacts',
    components: ['quickstep_blade', 'fleetfoot_band'], recipeCost: 600, bonus: { agi: 16, attackSpeed: 12, moveSpeedPct: 0.08 } },
  { id: 'twin_fangs', name: 'Twin Fangs', icon: '⚜️', color: '#8a7a2a', category: 'artifacts',
    components: ['ironheart', 'swiftwind'], recipeCost: 0, bonus: { str: 16, agi: 16, attackSpeed: 12, moveSpeedPct: 0.08, hpRegen: 1.5 } },
  { id: 'twinstrike_sabre', name: 'Twinstrike Sabre', icon: '🔊', color: '#5a6ab0', category: 'artifacts',
    components: ['hollow_staff', 'brute_hatchet'], recipeCost: 200, bonus: { str: 12, int: 10, damage: 15, attackSpeed: 10, manaRegen: 1.75 },
    passive: { echo: 6 }, description: 'Passive (melee): every 6s your next attack is followed by an instant second strike that slows 100% for 0.8s.' },
  { id: 'hungering_blade', name: 'Hungering Blade', icon: '😈', color: '#8a1a1a', category: 'artifacts',
    components: ['leech_mask', 'colossus_pick', 'claymore'], recipeCost: 0, bonus: { str: 25, damage: 30, lifesteal: 0.25 },
    active: { name: 'Crimson Hunger', targetType: 'none', cooldown: 30, manaCost: 0, castPoint: 0 },
    description: 'Crimson Hunger: +175% lifesteal for 6s and a basic dispel.' },
  { id: 'bonebreaker', name: 'Bonebreaker', icon: '🔨', color: '#7a4a2a', category: 'artifacts',
    components: ['mithril_hammer', 'belt_of_strength'], recipeCost: 825, bonus: { str: 10, damage: 25 },
    passive: { bash: { chance: 0.25, rangedChance: 0.1, duration: 1.5, damage: 100, cooldown: 2.3 } },
    description: 'Passive: 25% (melee) / 10% (ranged) chance to bash for 1.5s and deal 100 bonus damage.' },
  { id: 'chasm_blade', name: 'Chasm Blade', icon: '🌑', color: '#4a2a6a', category: 'artifacts',
    components: ['bonebreaker', 'ironbark_shield'], recipeCost: 1675, bonus: { str: 10, damage: 25, maxHp: 250, hpRegen: 7 },
    passive: { bash: { chance: 0.25, rangedChance: 0.1, duration: 1.5, damage: 100, cooldown: 2.3 }, block: { melee: 70, ranged: 35 } },
    active: { name: 'Crushing Blow', targetType: 'unit', targetTeam: 'enemy', cooldown: 35, manaCost: 75, castRange: du(150), castPoint: 0 },
    description: 'Crushing Blow: stuns the target for 2s, piercing spell immunity. Passive bash and damage block.' },
  { id: 'wyrmspear', name: 'Wyrmspear', icon: '🐉', color: '#3a8a3a', category: 'artifacts',
    components: ['fleetfoot_band', 'fleetfoot_band', 'brute_hatchet'], recipeCost: 0, bonus: { agi: 13, str: 12 },
    rangedBonus: { attackRange: du(150) }, description: 'Passive: +150 attack range for ranged heroes.' },
];

// Build the map + computed costs.
export const ITEM_DEFS = {};
for (const d of RAW) {
  d.shop ??= 'base';
  d.bonus ??= {};
  d.isRecipeItem = !!d.components;
  ITEM_DEFS[d.id] = d;
}
function totalCost(id, seen = new Set()) {
  const d = ITEM_DEFS[id];
  if (!d) return 0;
  if (!d.components) return d.cost ?? 0;
  if (seen.has(id)) return 0;
  seen.add(id);
  return d.components.reduce((s, c) => s + totalCost(c, seen), 0) + (d.recipeCost ?? 0);
}
for (const d of RAW) {
  if (d.components) d.cost = totalCost(d.id);
  // Ability-shaped mirrors of the active so items can be cast like abilities.
  const a = d.active;
  if (a) {
    a.targetTeam ??= a.targetType === 'unit' ? 'enemy' : 'any';
    a.castRange ??= 0;
    a.castPoint ??= 0;
    d.targetType = a.targetType;
    d.targetTeam = a.targetTeam;
    d.cooldown = a.cooldown;
    d.manaCost = a.manaCost;
    d.castRange = a.castRange;
    d.castPoint = a.castPoint;
    d.radius = a.radius;
  } else {
    d.targetType = 'passive';
    d.castPoint = 0;
  }
  // Items that are built from this one
  d.buildsInto = [];
}
for (const d of RAW) for (const c of new Set(d.components ?? [])) ITEM_DEFS[c]?.buildsInto.push(d.id);
// Human-readable stat summary appended to the description where there is none.
for (const d of RAW) d.description ??= '';

export function getItemDef(id) { return ITEM_DEFS[id] ?? null; }
