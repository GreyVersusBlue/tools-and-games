// data.js — all tunable content. No logic lives here; engine.js reads this.
// Keeping content JSON-shaped (plain object/array literals) so it can later be
// swapped for real .json files + fetch() without touching engine/state code.

export const CONFIG = {
  startingCash: 3200,
  startingReputation: 50, // 0-100
  ticketPrice: { min: 8, max: 28, start: 16 },
  wristbandCut: 0.65, // fraction of a food/craft sale that goes to the house
  blocksPerDay: 4,
};

export const TIME_BLOCKS = [
  { id: 'morning', label: 'Morning Procession', weight: 0.9 },
  { id: 'midday', label: 'Midday', weight: 1.15 },
  { id: 'afternoon', label: 'Afternoon', weight: 1.2 },
  { id: 'golden', label: 'Golden Hour', weight: 0.85 },
];

// ---------- faire grounds map ----------
// Stage 2: plots now sit on a real coordinate grid instead of carrying
// authored sightline/shade/traffic numbers. Those are *derived* in
// engine.js from (a) the terrain the plot sits on and (b) which other
// plots are built nearby — see engine.js computePlotAttributes(). This
// file stays data-only: the grid, a terrain legend, and per-terrain base
// modifiers are all just content.
export const GRID = { cols: 10, rows: 7 };

// One character per cell, legend below. Two path lines cross at (3,2),
// which is why Market Crossing Stage sits there.
export const TERRAIN_ROWS = [
  'CCHHHHCCWW',
  'CCHHHHCCWW',
  'PPPPPPPPPP',
  'CCCCCCCCWW',
  'CWWPWWCCWW',
  'CWWPWWCCCC',
  'CCCPCCCCCC',
];

export const TERRAIN_LEGEND = { C: 'clearing', H: 'hill', W: 'woods', P: 'path' };

// Base sightline/shade/traffic for a plot sitting on each terrain type,
// before any adjacency effects from nearby built plots are applied.
export const TERRAIN_BASE = {
  clearing: { sightline: 0.7, shade: 0.3, traffic: 0.55 },
  hill: { sightline: 0.92, shade: 0.15, traffic: 0.4 },
  woods: { sightline: 0.5, shade: 0.88, traffic: 0.3 },
  path: { sightline: 0.55, shade: 0.12, traffic: 0.92 },
};

// Buildable structure kinds. Stage 1/2 offered 9 pre-surveyed named plots;
// Stage 3 lets the player build any of these four kinds on any open grid
// cell, so this is now a small catalog of *kinds*, not specific sites.
// `baseCapacity` only applies to stage (the only kind with an attendance cap).
export const STRUCTURE_TYPES = {
  stage: { label: 'Stage', icon: '\u{1F3AD}', baseCost: 850, baseCapacity: 220 },
  food: { label: 'Food Stall', icon: '\u{1F357}', baseCost: 480 },
  vendor: { label: 'Craft Stall', icon: '\u{1F6D2}', baseCost: 480 },
  demo: { label: 'Demo Camp', icon: '\u{1F985}', baseCost: 350 },
};

// Per-terrain multipliers applied when a structure is actually built there.
// Clearing is the baseline (1.0x): hills cost more to grade, woods cost more
// to clear, and a path build disrupts foot traffic while it's underway —
// but a finished stage on a hill or path also seats more people than one
// squeezed into the woods, hence capacityMult.
export const TERRAIN_BUILD_MODIFIERS = {
  clearing: { costMult: 1.0, capacityMult: 1.0 },
  hill: { costMult: 1.25, capacityMult: 0.95 },
  woods: { costMult: 1.2, capacityMult: 0.85 },
  path: { costMult: 1.1, capacityMult: 1.15 },
};

// Auto-naming for a plot at build time: `${TERRAIN_NAME[terrain]}
// ${KIND_NOUN[kind]}`, e.g. a stage built on a hill becomes "Hilltop Stage".
export const TERRAIN_NAME = { clearing: 'Green', hill: 'Hilltop', woods: 'Grove', path: 'Crossing' };
export const KIND_NOUN = { stage: 'Stage', food: 'Stall', vendor: 'Bazaar', demo: 'Camp' };

// Performer pool. `quirk` is a small effect tag the engine looks up by id —
// see engine.js QUIRKS for what each one actually does.
export const PERFORMERS = [
  { id: 'perf_jouster_1', name: 'Sir Corwin the Unhorsed', role: 'jouster', cost: 260, popularity: 8, quirk: 'crowd_pleaser' },
  { id: 'perf_jouster_2', name: "Dame Ysolde Ironback", role: 'jouster', cost: 300, popularity: 9, quirk: 'prima_donna' },
  { id: 'perf_musician_1', name: 'The Tumbledown Consort', role: 'musician', cost: 150, popularity: 5, quirk: null },
  { id: 'perf_musician_2', name: 'Fenwick Loudlyre', role: 'musician', cost: 190, popularity: 6, quirk: 'crowd_pleaser' },
  { id: 'perf_jester_1', name: 'Piccolo the Contrary', role: 'jester', cost: 140, popularity: 6, quirk: 'chaos_prone' },
  { id: 'perf_jester_2', name: 'Old Nettle', role: 'jester', cost: 110, popularity: 4, quirk: null },
  { id: 'perf_magician_1', name: 'Master Aldric of the Hollow', role: 'magician', cost: 220, popularity: 7, quirk: 'prima_donna' },
  { id: 'perf_livinghist_1', name: 'The Cooper\u2019s Guild Camp', role: 'livingHistory', cost: 90, popularity: 3, quirk: null },
  { id: 'perf_livinghist_2', name: "The Physick's Tent", role: 'livingHistory', cost: 100, popularity: 3, quirk: 'crowd_pleaser' },
  { id: 'perf_falconer_1', name: 'Wren of the Mews', role: 'falconer', cost: 170, popularity: 6, quirk: null },
];

// Vendor pool (food + craft). `takeRate` is the fraction of gross the vendor
// keeps for themself; the house keeps the rest via CONFIG.wristbandCut,
// modulated by vendor quality.
export const VENDORS = [
  { id: 'vend_turkeyleg', name: 'Giant Turkey Legs', type: 'food', cost: 120, quality: 7, avgTicket: 11 },
  { id: 'vend_piepeddler', name: 'The Pie Peddler', type: 'food', cost: 90, quality: 6, avgTicket: 8 },
  { id: 'vend_cider', name: "Hollow Barrel Cider", type: 'food', cost: 100, quality: 8, avgTicket: 9 },
  { id: 'vend_stew', name: 'Widow\u2019s Kettle Stew', type: 'food', cost: 80, quality: 5, avgTicket: 7 },
  { id: 'vend_leather', name: 'Blackthorn Leatherworks', type: 'craft', cost: 60, quality: 7, avgTicket: 22 },
  { id: 'vend_glass', name: "Gaffer's Glass", type: 'craft', cost: 70, quality: 8, avgTicket: 30 },
  { id: 'vend_blades', name: 'Ravensmoor Blades', type: 'craft', cost: 90, quality: 6, avgTicket: 40 },
  { id: 'vend_trinkets', name: 'Pixie & Pauper Trinkets', type: 'craft', cost: 40, quality: 5, avgTicket: 12 },
];

// Random event pool. Each entry has a `weight` (relative chance per day),
// an optional `requires` predicate (state) => bool, and an `effect`
// (state, rng) => { cashDelta, repDelta, satisfactionDelta, message }.
// Kept data-only where possible; engine.js interprets the string effect ids.
export const EVENT_POOL = [
  { id: 'evt_perfect_weather', weight: 3, effectId: 'perfect_weather' },
  { id: 'evt_dropped_prop', weight: 2, effectId: 'dropped_prop_recovery' },
  { id: 'evt_wagon_wheel', weight: 2, effectId: 'broken_wagon_wheel' },
  { id: 'evt_noble_visit', weight: 1, effectId: 'noble_visit' },
  { id: 'evt_rowdy_crowd', weight: 2, effectId: 'rowdy_crowd', requires: 'hasChaosProne' },
  { id: 'evt_sellout_stall', weight: 2, effectId: 'sellout_stall', requires: 'hasVendor' },
];
