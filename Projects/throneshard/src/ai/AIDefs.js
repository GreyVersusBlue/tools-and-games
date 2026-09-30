import { du } from '../core/constants.js';

// Stat blocks for every AI-owned unit type. Distances are world units (du() converts from game units).

export const TOWER_STATS = {
  1: { maxHp: 1800, armor: 12, damageMin: 100, damageMax: 120, bountyGold: [140, 180], bountyXp: 120 },
  2: { maxHp: 2300, armor: 15, damageMin: 120, damageMax: 140, bountyGold: [160, 200], bountyXp: 160 },
  3: { maxHp: 2500, armor: 16, damageMin: 140, damageMax: 160, bountyGold: [180, 220], bountyXp: 200 },
  4: { maxHp: 2600, armor: 20, damageMin: 140, damageMax: 160, bountyGold: [200, 240], bountyXp: 220 },
};
export const TOWER_COMMON = {
  hpRegen: 0, magicResist: 0.4, bat: 1.0, attackSpeed: 100, attackPoint: 0.15,
  attackRange: du(700), acquireRange: du(700), projectileSpeed: du(750), moveSpeed: 0, turnRate: 100,
  collisionRadius: 1.8, vision: du(1800),
};

// Non-attacking buildings get a negative attack range so Unit's idle auto-acquire never fires.
const NO_ATTACK = { damageMin: 0, damageMax: 0, attackRange: -100, acquireRange: -100, moveSpeed: 0, turnRate: 0, hpRegen: 0 };
export const BARRACKS_STATS = {
  melee: { ...NO_ATTACK, maxHp: 2200, armor: 15, magicResist: 0.4, collisionRadius: 2.4, vision: 22, bountyGold: [180, 220], bountyXp: 160 },
  ranged: { ...NO_ATTACK, maxHp: 1300, armor: 9, magicResist: 0.4, collisionRadius: 2.0, vision: 22, bountyGold: [100, 140], bountyXp: 120 },
};
export const THRONESHARD_STATS = { ...NO_ATTACK, maxHp: 4500, armor: 13, magicResist: 0.4, collisionRadius: 3.4, vision: 24, bountyGold: [0, 0], bountyXp: 0 };
export const FOUNTAIN_STATS = {
  maxHp: 99999, armor: 100, damageMin: 180, damageMax: 200, bat: 0.35, attackPoint: 0.05, attackRange: 14,
  acquireRange: 14, projectileSpeed: 34, moveSpeed: 0, turnRate: 100, collisionRadius: 2.6, vision: 26,
  bountyGold: [0, 0], bountyXp: 0,
};

const CREEP_COMMON = {
  bat: 1.0, attackSpeed: 100, moveSpeed: du(325), turnRate: 8, collisionRadius: 0.55, vision: du(750),
  acquireRange: du(500), hpRegen: 0.5, magicResist: 0,
};
export const CREEP_STATS = {
  melee: { ...CREEP_COMMON, maxHp: 550, armor: 2, damageMin: 19, damageMax: 23, attackPoint: 0.467, attackRange: du(100), projectileSpeed: 0, bountyGold: [34, 39], bountyXp: 57 },
  ranged: { ...CREEP_COMMON, maxHp: 300, armor: 0, damageMin: 21, damageMax: 26, attackPoint: 0.5, attackRange: du(500), projectileSpeed: du(900), bountyGold: [43, 53], bountyXp: 69 },
  siege: { ...CREEP_COMMON, maxHp: 875, armor: 0, magicResist: 0.8, damageMin: 35, damageMax: 46, bat: 3.0, attackPoint: 0.7, attackRange: du(690), projectileSpeed: du(1100), bountyGold: [66, 80], bountyXp: 88, collisionRadius: 0.8 },
};
// Super / mega creep overrides (applied on top of the base block)
export const SUPER_CREEP = {
  melee: { maxHp: 700, armor: 3, damageMin: 36, damageMax: 44, bountyGold: [18, 24], bountyXp: 25 },
  ranged: { maxHp: 475, armor: 1, damageMin: 41, damageMax: 46, bountyGold: [18, 24], bountyXp: 25 },
  siege: { maxHp: 875, damageMin: 51, damageMax: 62 },
};
export const MEGA_CREEP = {
  melee: { maxHp: 1270, armor: 3, damageMin: 94, damageMax: 102, bountyGold: [18, 24], bountyXp: 25 },
  ranged: { maxHp: 1015, armor: 1, damageMin: 111, damageMax: 116, bountyGold: [18, 24], bountyXp: 25 },
  siege: { maxHp: 875, damageMin: 51, damageMax: 62 },
};

const NEUTRAL_COMMON = {
  bat: 1.35, attackSpeed: 100, moveSpeed: du(350), turnRate: 8, collisionRadius: 0.7, vision: 16,
  acquireRange: -100, attackRange: du(100), projectileSpeed: 0, hpRegen: 1, magicResist: 0.25, attackPoint: 0.4,
};
// Each camp: list of units to spawn (name, stats, scale)
export const CAMP_DEFS = {
  small: [
    { name: 'Kobold Taskmaster', stats: { ...NEUTRAL_COMMON, maxHp: 420, armor: 1, damageMin: 16, damageMax: 19, bountyGold: [24, 30], bountyXp: 40 } },
    { name: 'Kobold', stats: { ...NEUTRAL_COMMON, maxHp: 260, armor: 0, damageMin: 10, damageMax: 13, bountyGold: [14, 18], bountyXp: 25, collisionRadius: 0.5 } },
    { name: 'Kobold', stats: { ...NEUTRAL_COMMON, maxHp: 260, armor: 0, damageMin: 10, damageMax: 13, bountyGold: [14, 18], bountyXp: 25, collisionRadius: 0.5 } },
  ],
  medium: [
    { name: 'Alpha Wolf', stats: { ...NEUTRAL_COMMON, maxHp: 650, armor: 2, damageMin: 26, damageMax: 32, bountyGold: [34, 40], bountyXp: 70 } },
    { name: 'Giant Wolf', stats: { ...NEUTRAL_COMMON, maxHp: 500, armor: 1, damageMin: 20, damageMax: 24, bountyGold: [26, 32], bountyXp: 55 } },
  ],
  large: [
    { name: 'Centaur Warchief', stats: { ...NEUTRAL_COMMON, maxHp: 1100, armor: 4, damageMin: 44, damageMax: 52, bountyGold: [56, 66], bountyXp: 120, collisionRadius: 1.0 } },
    { name: 'Centaur Outrider', stats: { ...NEUTRAL_COMMON, maxHp: 550, armor: 1, damageMin: 18, damageMax: 22, bountyGold: [22, 28], bountyXp: 60 } },
  ],
  elder: [
    { name: 'Elder Wyrm', stats: { ...NEUTRAL_COMMON, maxHp: 1600, armor: 6, damageMin: 60, damageMax: 70, attackRange: du(300), projectileSpeed: du(900), bountyGold: [85, 105], bountyXp: 160, collisionRadius: 1.2 } },
    { name: 'Drakeling', stats: { ...NEUTRAL_COMMON, maxHp: 800, armor: 3, damageMin: 28, damageMax: 34, bountyGold: [30, 38], bountyXp: 80 } },
  ],
};

export const GRIMMAW_STATS = {
  maxHp: 6000, armor: 20, magicResist: 0.55, damageMin: 75, damageMax: 75, bat: 1.0, attackSpeed: 100, attackPoint: 0.6,
  attackRange: du(150), projectileSpeed: 0, moveSpeed: du(270), turnRate: 6, collisionRadius: 1.6, vision: 16,
  acquireRange: -100, hpRegen: 20, bountyGold: [225, 325], bountyXp: 450,
};
