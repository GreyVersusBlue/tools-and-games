// data.js — all tunable content. No logic lives here; engine.js reads this.
// Keeping content JSON-shaped (plain object/array literals) so it can later be
// swapped for real .json files + fetch() without touching engine/state code.

export const CONFIG = {
  startingCash: 3200,
  startingReputation: 50, // 0-100
  ticketPrice: { min: 8, max: 28, start: 16 },
  wristbandCut: 0.65, // fraction of a food/craft sale that goes to the house
  blocksPerDay: 4,
  seasonLength: 3, // days per weekend/season (Fri/Sat/Sun) — see Stage 6
  // Stage 10: planning → commit construction flow. Placing a plot is free
  // and non-final ("planning"); commitPlot charges the cost and makes it
  // real. Once real, tearing it down or moving it costs money instead.
  demolishFeeMult: 0.3, // tearing down a committed plot costs this fraction of what it cost to build
  relocateDiscountMult: 0.85, // relocating a committed plot pays the demolish fee above PLUS this fraction of the new site's build cost
  maxPlotNameLength: 40, // cap on a custom name via renamePlot
  // Stage 13: daily upkeep. Every *built* (not planning) plot costs this
  // fraction of its own stored `cost` every day, staffed or not — see
  // engine.js's plotUpkeep/totalUpkeep. Deriving upkeep from a plot's own
  // cost (already set once at build/relocate time) means it automatically
  // reflects kind, terrain, and footprint with no new authored table to
  // keep in sync — a 2x2 stage costs more to build than a food stall, so
  // it costs more to maintain, same as a hilltop build already costs more
  // than a clearing build via TERRAIN_BUILD_MODIFIERS above.
  upkeepRate: 0.025,
  // Flat daily cost of running the grounds at all, independent of what's
  // built on them (gate staff, general insurance, etc). Stage 13 split
  // this out from the old `150 + stages*20` overhead formula — the
  // per-stage scaling term is now real per-plot upkeep instead.
  baseOverhead: 150,
  // Stage 15: escalating build cost. Each additional *built* structure of
  // the same kind compounds the next one's price by this fraction — the
  // 1st stage prices at the terrain-adjusted base, the 2nd built stage
  // prices at base*(1+rate), the 3rd at base*(1+rate)^2, etc. Complements
  // Stage 13's upkeep (ongoing cost of what you already have) with
  // pressure at construction time (cost of getting more of the same
  // kind) — see engine.js's quoteBuild. Only *built* plots count, same
  // "not real until committed" rule upkeep already follows — laying out
  // several planning-status stalls doesn't escalate each other's price.
  escalatingBuildCostRate: 0.15,
  // Stage 16: win/loss conditions. If cash falls at or below this after a
  // day resolves, the faire is bankrupt and the run ends (see engine.js's
  // checkBankruptcy / state.js's runDay+nextDay). Deliberately well below
  // zero rather than exactly 0 — a single bad day dipping slightly
  // negative shouldn't end the run; sustained, serious insolvency should.
  bankruptcyFloor: -1500,
  // Reach the END of this weekend (i.e. season has advanced to at least
  // seasonTarget) with reputation and cash at least these values, and the
  // faire earns a one-time "Legendary Faire" milestone (see engine.js's
  // checkWinCondition) — celebratory, not a hard stop; the player
  // acknowledges it and keeps playing the same save afterward.
  winCondition: { seasonTarget: 6, minReputation: 70, minCash: 4000 },
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
//
// Stage 8: GRID is now the full authored terrain extent (the biggest the
// grounds ever get). The grounds a player can actually build on grow over
// time — see GRID_EXPANSIONS below and engine.js's currentGridSize(state).
// Keeping the whole terrain map authored up front (rather than generating
// new rows/cols on the fly) means terrainAt()/TERRAIN_ROWS stay simple,
// pure, and state-independent, same as every stage before this one — only
// the *bounds a build is allowed within* become state-aware.
export const GRID = { cols: 14, rows: 10 };

// One character per cell, legend below. The grounds are threaded by a real
// path *network*, not one line: the row-2 artery runs the full width, a
// north-south spur at col 3 drops off it ("Market Crossing" sits where
// they cross, at (3,2)), and a second north-south spur at col 10 (Stage 12)
// carries that same artery out east — with a short eastward connector
// along row 7 (cols 10-13) so the Stage 8 expansion territory (cols 10-13,
// rows 7-9) actually has path frontage to build against, instead of being
// stranded once unlocked. Columns 10-13 and rows 7-9 are that expansion
// territory — not buildable until unlocked (see GRID_EXPANSIONS), but
// authored now so the map never needs new terrain content generated later.
export const TERRAIN_ROWS = [
  'CCHHHHCCWWWWCC',
  'CCHHHHCCWWWWCC',
  'PPPPPPPPPPPPPP',
  'CCCCCCCCWWPHCC',
  'CWWPWWCCWWPHCC',
  'CWWPWWCCCCPWCC',
  'CCCPCCCCCCPWCC',
  'CCCPCCCCCCPPPP',
  'HHHPHHCCWWPWCC',
  'CCCPCCCCCCPCCC',
];

export const TERRAIN_LEGEND = { C: 'clearing', H: 'hill', W: 'woods', P: 'path' };

// Stage 17: the front gate — where every guest's walk across the grounds
// starts. Sits on the row-2 artery's western end, the only edge of the path
// network that has been on the map since Stage 1 (the row-2 artery has
// always run the full authored width). Authored here as data, read by
// engine.js's path-distance BFS — never moves on its own, but living as a
// named constant (not a magic literal in engine.js) means a future stage
// could relocate it, or add a second gate, without touching the BFS logic.
export const ENTRANCE = { x: 0, y: 2 };

// How much of the authored TERRAIN_ROWS grid is actually buildable right
// now. Each entry is a hard fence line at (cols, rows) — everything inside
// it is fair game, everything outside is "past the fence" until the
// player reaches `unlockSeason` (a weekend number, same field/meaning as
// AD_CAMPAIGNS/CONTRACT_OPTIONS use it). Must be sorted ascending by
// unlockSeason, and the first entry MUST be { unlockSeason: 1, cols: 10,
// rows: 7 } — that's the exact Stage 1-7 footprint, so an existing save
// (or a fresh one) at Weekend 1 sees precisely the grounds it always has.
export const GRID_EXPANSIONS = [
  { unlockSeason: 1, cols: 10, rows: 7, label: 'Home Grounds' },
  { unlockSeason: 2, cols: 12, rows: 8, label: 'East Meadow' },
  { unlockSeason: 4, cols: 14, rows: 10, label: 'Deep Woods Trail' },
];

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
// `footprint` (Stage 12): how many grid cells a built structure actually
// occupies, anchored at its (x,y). A stage is a real show site — trussing,
// backstage curtain, a crowd apron — so it spans 2x2 instead of the single
// cell every other kind still uses; that size difference is now load-
// bearing (it eats more of the grounds, is harder to fit a path-frontage
// requirement against, and collides with more neighbors for the stage-
// spacing rule below). Any kind without an explicit `footprint` defaults to
// 1x1 via engine.js's footprintFor().
export const STRUCTURE_TYPES = {
  stage: { label: 'Stage', icon: '\u{1F3AD}', baseCost: 850, baseCapacity: 220, footprint: { w: 2, h: 2 } },
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

// Stage 11: build-time legality rules. Terrain/kind combos and structure
// spacing that are refused outright at place/move/relocate time, on top of
// (not instead of) the cost/capacity terrain modifiers above and the
// adjacency sightline/traffic math in engine.js's computePlotAttributes.
// Deliberately small and data-only, same pattern as TERRAIN_BUILD_MODIFIERS,
// so a future stage can extend either list without touching engine logic.
//
// Stage 18 extends this same data-only pattern three ways (all three were
// standing "not yet requested" options since Stage 11/12): a terrain ban for
// stalls (not just stage/demo), same-kind stall spacing, and a demo camp
// cap. None of the three needed a single new field on a saved plot, and
// engine.js's isLegalPlacement reads all of it generically — see the
// comments there.
export const PLACEMENT_RULES = {
  // Kinds that refuse to be built on a given terrain outright.
  // - A stage or demo camp squarely blocking the one thoroughfare through
  //   the grounds isn't a cost tradeoff, it's just not allowed; a food/craft
  //   stall is still fine on the path (roadside stalls are exactly what a
  //   real faire's path is lined with).
  // - Stage 18: a food or craft stall also can't be built on a hill — a
  //   cart-based stall needs level ground to wheel in and set up on, unlike
  //   a stage (which already treats hill as its BEST terrain, highest
  //   sightline and a capacityMult bonus) or a demo camp (a fixed
  //   living-history/falconer site, not a cart). This is the first terrain
  //   ban that isn't about the path, and the first time hill and path
  //   aren't just "cost more/less" — a hill is now stage/demo-only ground,
  //   the path is stage/demo-*excluded* ground, and clearing/woods stay
  //   open to everything.
  terrainBans: {
    stage: ['path'],
    demo: ['path'],
    food: ['hill'],
    vendor: ['hill'],
  },
  // Minimum Chebyshev (king-move) distance required between two stages,
  // built or still-planning — 1 means two stages can't sit directly
  // touching (including diagonally). Checked cell-to-cell across each
  // stage's full 2x2 footprint (Stage 12), not just anchor-to-anchor. This
  // is a hard floor underneath the existing soft sightline penalty
  // (ADJACENCY_RADIUS=2 in engine.js), which still applies on top of it for
  // anything farther than this.
  minStageSpacing: 1,
  // Stage 18: which kinds get a same-kind spacing floor, and how much. Only
  // between two stalls of the SAME kind (two food stalls, or two craft
  // stalls) — a food stall right beside a craft stall is still fine and
  // even desirable (that's a real food-court/market-row layout); the point
  // is to stop five identical carts from walling off one corner of the
  // grounds, not to break up variety. Same 1-cell-touching floor as
  // minStageSpacing, checked the same footprint-cell-to-footprint-cell way
  // (stalls are 1x1, so today this is just cell-to-cell, but it stays
  // footprint-correct if a stall footprint ever grows).
  stallSpacingKinds: ['food', 'vendor'],
  minStallSpacing: 1,
  // Stage 18: a hard cap on how many of a kind can be built (or still
  // planned) at once. A demo camp is a living-history reenactor or a
  // falconer's mews — a real person/animal on site, not a purchased
  // structure — so the faire only has so many to field regardless of how
  // much room is left on the grounds. Keyed by kind so a future stage can
  // cap something else the same way without a new code path.
  maxBuiltByKind: { demo: 3 },
  // Stage 12: "build along the paths" — every buildable kind needs at
  // least one cell of its footprint sitting ON a path (food/craft/demo can
  // straddle one) or directly beside one (orthogonal neighbor only, not
  // diagonal). A stage/demo can never sit ON the path (see terrainBans
  // above), so for those two this only ever resolves via the "beside"
  // half of the check. Kept as an explicit kind list rather than a bare
  // boolean so a future stage could exempt one kind without touching
  // engine.js's hasPathFrontage().
  requiresPathFrontage: ['stage', 'food', 'vendor', 'demo'],
};

// Marketing/advertising campaigns (Stage 4). Only one campaign can be
// running at a time — launching one costs cash up front, its
// `attendanceMult` applies to attendance for `durationDays`, and once it
// ends that specific campaign can't be relaunched until `cooldownDays` have
// passed. Deliberately non-stacking: there is no way to have two campaigns'
// multipliers apply on the same day, which keeps the attendance formula in
// engine.js simple (one multiplier, or none).
// `unlockSeason` (Stage 6) gates a campaign behind reaching that weekend
// number (state.season) — 1 means available from the very first weekend.
export const AD_CAMPAIGNS = [
  { id: 'ad_flyers', name: 'Flyer Run', desc: 'A few riders post bills in the nearest towns. Cheap, quick, modest.', cost: 120, attendanceMult: 1.08, durationDays: 1, cooldownDays: 1, unlockSeason: 1 },
  { id: 'ad_crier', name: 'Town Crier', desc: 'A hired crier works the market squares for days on end.', cost: 280, attendanceMult: 1.16, durationDays: 2, cooldownDays: 2, unlockSeason: 1 },
  { id: 'ad_broadside', name: 'Regional Broadside', desc: 'Printed notices carried by wagon to every shire nearby.', cost: 550, attendanceMult: 1.28, durationDays: 3, cooldownDays: 4, unlockSeason: 1 },
  { id: 'ad_proclamation', name: 'Kingdom Proclamation', desc: 'A royal proclamation read at every market cross in the shire. Slow to arrange, hard to beat.', cost: 900, attendanceMult: 1.4, durationDays: 3, cooldownDays: 6, unlockSeason: 2 },
];

// Contract types for performers (Stage 5) — and, as of Stage 7, vendors
// too (see engine.js's effectiveVendorCost / state.js's hireVendor). `open`
// is the no-commitment day rate — pay the listed cost, release anytime for
// free (this was the only option through Stage 4). `weekend` locks the
// contractee in for `commitDays` at a discount off the listed rate;
// releasing early, before the commitment runs out, costs a cancellation fee
// (cancelFeeMult \u00d7 dailyCost \u00d7 days still owed on the commitment).
// `season` (Stage 6) is a longer, deeper-discount commitment spanning two
// full weekends, gated behind `unlockSeason` the same way AD_CAMPAIGNS are.
// Kept as one shared catalog rather than a duplicated vendor-only copy —
// performers and vendors are contracted via the exact same deal shapes.
export const CONTRACT_OPTIONS = {
  open: { id: 'open', label: 'Day Rate', priceMult: 1.0, commitDays: 0, cancelFeeMult: 0, unlockSeason: 1 },
  weekend: { id: 'weekend', label: 'Weekend Package', priceMult: 0.85, commitDays: 3, cancelFeeMult: 0.5, unlockSeason: 1 },
  season: { id: 'season', label: 'Season Contract', priceMult: 0.72, commitDays: 6, cancelFeeMult: 0.6, unlockSeason: 3 },
};

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
  // Stage 9 additions — content-pool filler, plus two `night_owl` holders
  // (see engine.js QUIRKS.night_owl / effectivePopularity) so a Golden
  // Hour-favoring lineup is an actual choice a player can build toward.
  { id: 'perf_musician_3', name: 'Rosalind Quicksilver', role: 'musician', cost: 175, popularity: 6, quirk: 'night_owl' },
  { id: 'perf_magician_2', name: 'Vesper Nightshade', role: 'magician', cost: 240, popularity: 7, quirk: 'night_owl' },
  { id: 'perf_jester_3', name: 'Bramblewit', role: 'jester', cost: 120, popularity: 5, quirk: null },
  { id: 'perf_falconer_2', name: 'Talon of the Greenwood', role: 'falconer', cost: 190, popularity: 6, quirk: 'crowd_pleaser' },
  { id: 'perf_livinghist_3', name: "The Chandler\u2019s Row", role: 'livingHistory', cost: 85, popularity: 3, quirk: null },
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
  // Stage 9 additions — content-pool filler, same shape as the original 8.
  { id: 'vend_mead', name: "Meadow\u2019s Gold Mead", type: 'food', cost: 95, quality: 7, avgTicket: 10 },
  { id: 'vend_pretzel', name: 'Twisted Bread Cart', type: 'food', cost: 70, quality: 6, avgTicket: 6 },
  { id: 'vend_woodcarve', name: 'Oakenshield Woodcarving', type: 'craft', cost: 55, quality: 6, avgTicket: 18 },
  { id: 'vend_herbalist', name: "The Herbwife\u2019s Basket", type: 'craft', cost: 45, quality: 7, avgTicket: 15 },
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
  // Stage 9 additions — "backstage drama" events, gated on roster
  // composition rather than a single quirk/vendor flag. See engine.js's
  // EVENT_REQUIREMENTS for what each `requires` string actually checks.
  { id: 'evt_diva_standoff', weight: 2, effectId: 'diva_standoff', requires: 'hasMultiplePrimaDonnas' },
  { id: 'evt_musicians_jam', weight: 2, effectId: 'musicians_jam', requires: 'hasTwoMusicians' },
  { id: 'evt_falconer_show', weight: 2, effectId: 'falconer_show', requires: 'hasFalconerScheduled' },
  { id: 'evt_gossip_wagon', weight: 1, effectId: 'gossip_wagon', requires: 'bigRoster' },
];
