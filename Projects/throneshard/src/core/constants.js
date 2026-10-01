// Shared world layout + balance constants. Every module reads from here.
// Coordinate system: ground is the XZ plane, +Y is up. Map spans [-MAP_HALF, MAP_HALF] on X and Z.
// Camera looks "north" = -Z. Sunward sits bottom-left (-X,+Z), Duskward top-right (+X,-Z).
// The river runs along the line x == z. Sunward side: x < z. Duskward side: x > z.
// Duskward layout is the point-mirror of Sunward: (x, z) -> (-x, -z).

export const MAP_SIZE = 200;
export const MAP_HALF = MAP_SIZE / 2;

export const TEAM = { SUNWARD: 'sunward', DUSKWARD: 'duskward', NEUTRAL: 'neutral' };
export const TEAM_COLORS = { sunward: 0x4caf50, duskward: 0xd32f2f, neutral: 0xc8a040 };
export const enemyOf = (team) => (team === TEAM.SUNWARD ? TEAM.DUSKWARD : team === TEAM.DUSKWARD ? TEAM.SUNWARD : null);

const mirror = ([x, z]) => [-x, -z];
const mirrorList = (list) => list.map(mirror);

export const FOUNTAIN = { sunward: [-92, 92], duskward: [92, -92] };
export const THRONESHARD = { sunward: [-76, 76], duskward: [76, -76] };

// Lane waypoints, ordered from Sunward base toward Duskward base.
export const LANES = {
  top: [[-70, 64], [-84, 44], [-85, 0], [-85, -60], [-80, -80], [-60, -85], [0, -85], [44, -84], [64, -70]],
  mid: [[-64, 64], [-30, 30], [0, 0], [30, -30], [64, -64]],
  bot: [[-64, 70], [-44, 84], [0, 85], [60, 85], [80, 80], [85, 60], [85, 0], [84, -44], [70, -64]],
};
export const laneFor = (lane, team) => (team === TEAM.SUNWARD ? LANES[lane] : [...LANES[lane]].reverse());

// Sunward towers; Duskward towers are mirrored. Note Duskward "top" towers = mirror of Sunward "bot" towers.
const RAD_TOWERS = [
  { lane: 'top', tier: 1, pos: [-85, -30] },
  { lane: 'top', tier: 2, pos: [-85, 12] },
  { lane: 'top', tier: 3, pos: [-80, 52] },
  { lane: 'mid', tier: 1, pos: [-16, 16] },
  { lane: 'mid', tier: 2, pos: [-36, 36] },
  { lane: 'mid', tier: 3, pos: [-56, 56] },
  { lane: 'bot', tier: 1, pos: [30, 85] },
  { lane: 'bot', tier: 2, pos: [-12, 85] },
  { lane: 'bot', tier: 3, pos: [-52, 80] },
  { lane: 'base', tier: 4, pos: [-72, 68] },
  { lane: 'base', tier: 4, pos: [-68, 72] },
];
const swapLane = (l) => (l === 'top' ? 'bot' : l === 'bot' ? 'top' : l);
export const TOWERS = {
  sunward: RAD_TOWERS,
  duskward: RAD_TOWERS.map((t) => ({ ...t, lane: swapLane(t.lane), pos: mirror(t.pos) })),
};

// Barracks (melee + ranged) behind each tier-3 tower.
const RAD_RAX = [
  { lane: 'top', kind: 'melee', pos: [-86, 60] }, { lane: 'top', kind: 'ranged', pos: [-76, 60] },
  { lane: 'mid', kind: 'melee', pos: [-66, 58] }, { lane: 'mid', kind: 'ranged', pos: [-58, 66] },
  { lane: 'bot', kind: 'melee', pos: [-60, 86] }, { lane: 'bot', kind: 'ranged', pos: [-60, 76] },
];
export const BARRACKS = {
  sunward: RAD_RAX,
  duskward: RAD_RAX.map((b) => ({ ...b, lane: swapLane(b.lane), pos: mirror(b.pos) })),
};

// Neutral camps. Sunward jungle camps then Duskward jungle camps.
const RAD_CAMPS = [
  { kind: 'small', pos: [-50, -10] }, { kind: 'medium', pos: [-60, 20] },
  { kind: 'medium', pos: [-15, 48] }, { kind: 'large', pos: [12, 58] }, { kind: 'elder', pos: [38, 66] },
];
export const NEUTRAL_CAMPS = [...RAD_CAMPS, ...RAD_CAMPS.map((c) => ({ ...c, pos: mirror(c.pos) }))];
export const GRIMMAW_LAIR = [-40, -40];

// Shops: base shop next to fountain; hidden bazaars in the jungle.
export const SHOPS = {
  sunward: [-86, 84],
  duskward: [86, -84],
  secret: [[-30, 60], [30, -60]],
};
export const SHOP_RADIUS = 12;

// Timing / balance
export const CREEP_WAVE_INTERVAL = 30; // seconds
export const FIRST_WAVE_TIME = 3; // seconds after match start
export const NEUTRAL_RESPAWN_INTERVAL = 60;
export const PASSIVE_GOLD_PER_SEC = 1.5;
export const STARTING_GOLD = 600;
export const MAX_LEVEL = 25;
// Cumulative XP needed to reach level index+1. The raw curve left bot heroes at level 12 to 14 when a match ends at 35
// minutes, so talents at 20 and 25 and scepters almost never showed; XP_CURVE_SCALE pulls level 20 to about minute 35.
const XP_CURVE_RAW = [0, 240, 640, 1160, 1760, 2440, 3200, 4000, 4900, 5900, 7000, 8200, 9500, 10900, 12400,
  14000, 15700, 17500, 19400, 21400, 23600, 26000, 28600, 31400, 34400];
export const XP_CURVE_SCALE = 0.42;
export const XP_TABLE = XP_CURVE_RAW.map((v) => Math.round((v * XP_CURVE_SCALE) / 10) * 10);
export const XP_SHARE_RADIUS = 15;
export const respawnTime = (level) => 4 + level * 2;
export const heroKillGold = (victimLevel, streak = 0) => 110 + victimLevel * 8 + Math.min(streak, 10) * 30;
export const heroKillXp = (victimLevel) => 100 + victimLevel * 40;

export const armorMultiplier = (armor) => 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));

// World units per "game unit". Game-unit ranges (e.g. 600 cast range) divide by this.
export const GAME_UNIT = 40;
export const du = (v) => v / GAME_UNIT;

export const toVec = (arr, THREE, y = 0) => new THREE.Vector3(arr[0], y, arr[1]);
