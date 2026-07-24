// engine.js — pure functions only. Nothing here touches the DOM or mutates
// its inputs; state.js owns the actual game-state object and calls into
// this module for the math. That split is what makes the smoke tests able
// to run simulateDay() hundreds of times in plain Node with no jsdom.

import { CONFIG, TIME_BLOCKS, PERFORMERS, VENDORS, EVENT_POOL, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS, PLACEMENT_RULES } from './data.js';

// ---------- seeded RNG (mulberry32) ----------
// Deterministic given a numeric seed so tests can assert exact outputs.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- lookups ----------
// No plotById: plots are no longer a static catalog (Stage 3) — a built
// plot IS its own record, living in state.builtPlots, so anything that
// needs one just reads it straight from that array.
export function performerById(id) { return PERFORMERS.find(p => p.id === id); }
export function vendorById(id) { return VENDORS.find(v => v.id === id); }
export function campaignById(id) { return AD_CAMPAIGNS.find(c => c.id === id); }

// Stage 10: a VENDORS entry's `type` ('food'/'craft') and a built plot's
// `kind` ('food'/'vendor') use different vocabularies for the same two
// stall categories — this is the one place that translates between them,
// so hireVendor's cap check and the assignment/vacancy-tracker logic never
// have to spell the mapping out inline.
export const STALL_KIND_BY_VENDOR_TYPE = { food: 'food', craft: 'vendor' };

// Vacancy tracker (Stage 10): for each stall kind, how many committed plots
// exist and how many currently have a vendor seated. Pure read of
// state.builtPlots — used by both the Backstage "N/M filled" display and
// hireVendor's per-kind hiring cap.
export function stallSummary(state) {
  const summarize = (kind) => {
    const plots = state.builtPlots.filter(p => p.kind === kind && p.status === 'built');
    return { total: plots.length, filled: plots.filter(p => p.assignedVendorId).length };
  };
  return { food: summarize('food'), vendor: summarize('vendor') };
}

// A contracted performer's actual daily rate depends on which contract type
// they were signed under (Stage 5) — a Weekend Package pays less per day
// than the listed cost, an open day-rate pays the listed cost exactly.
// Falls back to the listed cost for a performer with no contract record
// (shouldn't normally happen if they're on the roster, but keeps this safe
// to call defensively).
export function effectivePerformerCost(state, performerId) {
  const perf = performerById(performerId);
  if (!perf) return 0;
  const contract = state.contracts && state.contracts[performerId];
  return contract ? contract.dailyCost : perf.cost;
}

// Stage 7: vendors can now be signed under the same CONTRACT_OPTIONS deals
// as performers (see state.js's hireVendor). Mirrors effectivePerformerCost
// exactly — a vendor with no contract record falls back to the listed cost.
export function effectiveVendorCost(state, vendorId) {
  const vendor = vendorById(vendorId);
  if (!vendor) return 0;
  const contract = state.vendorContracts && state.vendorContracts[vendorId];
  return contract ? contract.dailyCost : vendor.cost;
}

// ---------- season/progression (Stage 6) ----------
// Whether an item gated by `unlockSeason` (an AD_CAMPAIGNS entry or a
// CONTRACT_OPTIONS entry) is available yet at the given state's current
// weekend (state.season). Missing/undefined unlockSeason defaults to 1
// (available from the very first weekend) so old content never needs the
// field retrofitted.
export function isSeasonUnlocked(state, unlockSeason) {
  return state.season >= (unlockSeason || 1);
}

// ---------- grounds expansion (Stage 8) ----------
// The largest GRID_EXPANSIONS entry the player's current weekend
// (state.season) has reached — i.e. how much of the authored TERRAIN_ROWS
// grid is actually buildable/visible right now. GRID_EXPANSIONS[0] is
// always the Weekend-1 baseline, so this never returns undefined even for
// a save at season 1 (or a pre-Stage-8 save with no migration needed,
// since season already defaults to 1).
export function currentGridSize(state) {
  const unlocked = GRID_EXPANSIONS.filter(g => isSeasonUnlocked(state, g.unlockSeason));
  return unlocked[unlocked.length - 1] || GRID_EXPANSIONS[0];
}

// The next fence line still ahead of the player, or null once every
// GRID_EXPANSIONS entry has been reached. Used to show "next expansion"
// hints in the UI the same way AD_CAMPAIGNS/CONTRACT_OPTIONS show locked
// tiers.
export function nextGridExpansion(state) {
  return GRID_EXPANSIONS.find(g => !isSeasonUnlocked(state, g.unlockSeason)) || null;
}

// Whether (x,y) sits within the currently-unlocked grounds — distinct from
// terrainAt() returning non-null, since TERRAIN_ROWS is authored at full
// size but a cell can be past the current fence line before its
// GRID_EXPANSIONS tier unlocks.
export function isWithinCurrentGrid(state, x, y) {
  const size = currentGridSize(state);
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size.cols && y < size.rows;
}

// Aggregates the most recent `count` simulateDay() results (a completed
// weekend's worth of history) into the totals shown on the weekend-end
// summary screen. Pure — takes the plain history array, never touches
// state directly. Returns a zeroed shape if history is empty so callers
// never have to null-check before rendering.
export function summarizeWeekend(history, count) {
  const days = (history || []).slice(-count);
  if (days.length === 0) {
    return { days: [], totalAttendance: 0, totalNet: 0, avgSatisfaction: 0, repDelta: 0, bestDay: null, worstDay: null };
  }
  const totalAttendance = days.reduce((s, d) => s + d.attendance, 0);
  const totalNet = days.reduce((s, d) => s + d.cashDelta, 0);
  const avgSatisfaction = Math.round(days.reduce((s, d) => s + d.satisfaction, 0) / days.length);
  const repDelta = days.reduce((s, d) => s + d.reputationDelta, 0);
  const bestDay = days.reduce((a, b) => (b.cashDelta > a.cashDelta ? b : a));
  const worstDay = days.reduce((a, b) => (b.cashDelta < a.cashDelta ? b : a));
  return { days, totalAttendance, totalNet, avgSatisfaction, repDelta, bestDay, worstDay };
}

// Stage 16: loss condition. Pure so tests can assert on plain numbers
// without needing a whole state object.
export function checkBankruptcy(cash) {
  return cash <= CONFIG.bankruptcyFloor;
}

// Stage 16: win condition. True once the faire has reached (or passed) the
// target weekend with reputation and cash both at or above the configured
// minimums. Reads `state.season`/`reputation`/`cash` only — deliberately
// ignorant of `victoryAchieved`, so callers decide when/whether to act on a
// true result (state.js only fires it once, via the victoryAchieved flag).
export function checkWinCondition(state) {
  const w = CONFIG.winCondition;
  return state.season >= w.seasonTarget && state.reputation >= w.minReputation && state.cash >= w.minCash;
}

// ---------- faire grounds map ----------
// Terrain lookup by grid cell. Returns null for out-of-bounds/unknown cells.
export function terrainAt(x, y) {
  const row = TERRAIN_ROWS[y];
  const ch = row ? row[x] : undefined;
  return ch ? TERRAIN_LEGEND[ch] || null : null;
}

// Chebyshev (king-move) distance — a stage two cells away in any direction,
// including diagonally, counts as "nearby" for crowd/sightline purposes.
export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---------- structure footprints (Stage 12) ----------
// How many cells a structure kind occupies, anchored at (x,y). Falls back
// to 1x1 for any kind without an explicit STRUCTURE_TYPES[kind].footprint
// (every kind except stage, today) so old content/saves never need a
// retrofit. `footprintCells` is the pure enumerator both quoteBuild and
// isLegalPlacement build on; a plot's OWN footprint should be read off its
// stored `w`/`h` (set at build time) rather than re-derived from
// STRUCTURE_TYPES, since a later stage changing a kind's footprint must
// never reshape plots that already exist on the grounds.
export function footprintFor(kind) {
  const type = STRUCTURE_TYPES[kind];
  return (type && type.footprint) || { w: 1, h: 1 };
}

export function footprintCells(x, y, w, h) {
  const cells = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy });
  }
  return cells;
}

// A built plot's actual footprint, honoring its stored w/h when present
// (falls back to the kind's current footprint for a pre-Stage-12 save,
// which loadState migrates to explicit 1x1 anyway).
export function plotFootprintCells(plot) {
  const w = plot.w || footprintFor(plot.kind).w;
  const h = plot.h || footprintFor(plot.kind).h;
  return footprintCells(plot.x, plot.y, w, h);
}

// Whether every cell of `kind`'s footprint at (x,y) sits within the
// currently-unlocked grounds (state-aware — see isWithinCurrentGrid/
// currentGridSize above). A footprint that would poke past the fence line
// on ANY cell, not just its anchor, is refused.
export function isFootprintWithinCurrentGrid(state, kind, x, y) {
  const { w, h } = footprintFor(kind);
  return footprintCells(x, y, w, h).every(c => isWithinCurrentGrid(state, c.x, c.y));
}

function orthogonalNeighbors(cell) {
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
}

// Whether any cell of a footprint sits ON a path tile, or directly beside
// one (orthogonal neighbor only — a diagonal touch doesn't count as
// frontage). A neighbor that's itself part of the same footprint is
// skipped (it's interior to the structure, not a street it fronts onto).
export function hasPathFrontage(cells) {
  const key = (c) => `${c.x},${c.y}`;
  const own = new Set(cells.map(key));
  for (const c of cells) {
    if (terrainAt(c.x, c.y) === 'path') return true;
    for (const n of orthogonalNeighbors(c)) {
      if (own.has(key(n))) continue;
      if (terrainAt(n.x, n.y) === 'path') return true;
    }
  }
  return false;
}

const ADJACENCY_RADIUS = 2;
const NEARBY_STAGE_SIGHTLINE_PENALTY = 0.1; // per nearby built stage, stages only
const NEARBY_STAGE_TRAFFIC_BONUS = 0.05; // per nearby built stage, food/vendor/demo only
// Stage 14: a demo camp draws its own lingering crowd (a falconer, a living-
// history camp) that spills over onto nearby stalls the same way a stage's
// crowd does — a slightly bigger per-camp bonus than a stage's, since
// drawing foot traffic to nearby stalls is a demo camp's whole mechanical
// purpose today (it has no capacity/revenue of its own). Food/vendor stalls
// only — a demo doesn't boost another demo, and a stage's sightline math is
// untouched by nearby demo camps.
const NEARBY_DEMO_TRAFFIC_BONUS = 0.07;

// Derives a built (or hypothetical) plot's real sightline/shade/traffic from
// its terrain plus which OTHER plots are currently built nearby:
//  - a stage within ADJACENCY_RADIUS of another built stage loses sightline
//    (overlapping crowds/noise/tree cover between two show sites)
//  - a food/vendor/demo plot within ADJACENCY_RADIUS of a built stage gains
//    traffic (people spilling out of a show walk past it)
//  - a food/vendor plot within ADJACENCY_RADIUS of a built demo camp also
//    gains traffic (Stage 14 — see NEARBY_DEMO_TRAFFIC_BONUS above)
// `builtPlots` is the array of full plot objects (state.builtPlots) — not
// ids, since Stage 3 plots are player-built records with no catalog to
// look them up in. Pure function; never mutates its arguments.
export function computePlotAttributes(plot, builtPlots) {
  const base = TERRAIN_BASE[terrainAt(plot.x, plot.y)] || TERRAIN_BASE.clearing;
  // Stage 10: a plot still sitting in "planning" (placed but not yet
  // committed/paid for) doesn't functionally exist on the grounds yet, so
  // it neither steals sightline from a nearby stage nor sends it traffic.
  const others = (builtPlots || []).filter(p => p && p.id !== plot.id && p.status !== 'planning');
  const nearbyStages = others.filter(o => o.kind === 'stage' && chebyshevDistance(plot, o) <= ADJACENCY_RADIUS).length;
  const nearbyDemos = others.filter(o => o.kind === 'demo' && chebyshevDistance(plot, o) <= ADJACENCY_RADIUS).length;

  let sightline = base.sightline;
  let traffic = base.traffic;
  if (plot.kind === 'stage') {
    sightline = clamp(sightline - nearbyStages * NEARBY_STAGE_SIGHTLINE_PENALTY, 0.15, 1);
  } else if (nearbyStages > 0) {
    traffic = clamp(traffic + nearbyStages * NEARBY_STAGE_TRAFFIC_BONUS, 0, 1);
  }
  if ((plot.kind === 'food' || plot.kind === 'vendor') && nearbyDemos > 0) {
    traffic = clamp(traffic + nearbyDemos * NEARBY_DEMO_TRAFFIC_BONUS, 0, 1);
  }

  return {
    sightline: Math.round(sightline * 100) / 100,
    shade: Math.round(base.shade * 100) / 100,
    traffic: Math.round(traffic * 100) / 100,
    nearbyStages,
    nearbyDemos,
  };
}

// ---------- foot traffic (Stage 14: crowd-flow-as-a-system, phase 1) ----------
// Every built food/vendor stall already carries a `traffic` attribute
// (terrain + nearby-stage/demo adjacency, above) — through Stage 13 that
// number was purely cosmetic for a stall: only a STAGE's traffic fed into
// anything (its draw-weight share of a time block). This is what actually
// wires stall placement into the economy: each stall's traffic, relative to
// the day's average across every built stall, becomes a sales multiplier —
// a corner stall on a busy path next to a packed stage sells better than
// one tucked alone in the deep woods, and that's now a real number instead
// of just a stat on a tooltip.
//
// Deliberately relative (mult ~1.0 = "an average day's stall"), not
// absolute, so a lone stall's economics are completely unaffected (mean ==
// its own traffic == mult of exactly 1) and the overall economy doesn't
// swing just because the player built more or fewer stalls — only *where*
// they sit relative to each other moves the needle. Clamped to a fairly
// narrow band: this is meant to reward good siting, not let a pathological
// layout zero out or multiply a stall's sales many times over.
const FOOT_TRAFFIC_MIN_MULT = 0.6;
const FOOT_TRAFFIC_MAX_MULT = 1.6;

export function computeFootTraffic(builtPlots) {
  const stalls = (builtPlots || []).filter(p => p && p.status === 'built' && (p.kind === 'food' || p.kind === 'vendor'));
  const result = {};
  if (stalls.length === 0) return result;
  const withTraffic = stalls.map(p => ({ id: p.id, traffic: computePlotAttributes(p, builtPlots).traffic }));
  const mean = withTraffic.reduce((s, p) => s + p.traffic, 0) / withTraffic.length;
  for (const p of withTraffic) {
    const raw = mean > 0 ? p.traffic / mean : 1;
    result[p.id] = { traffic: p.traffic, mult: clamp(raw, FOOT_TRAFFIC_MIN_MULT, FOOT_TRAFFIC_MAX_MULT) };
  }
  return result;
}

// Quotes what building a given structure kind at (x,y) would cost/seat,
// before anything is actually built — the single source of truth for that
// math, used both by state.js's buildPlot action and ui.js's build-preview
// Stage 13: daily upkeep. A single built plot's daily cost is just
// CONFIG.upkeepRate of its own stored `cost` — that field is set once at
// build/commit/relocate time (see state.js) and already bakes in kind,
// terrain, and footprint, so upkeep needs no separate authored table.
// Deliberately returns 0 for a still-"planning" plot — same rule every
// other gameplay effect (crowd draw, adjacency, seating) already follows:
// a plan isn't real until it's committed.
export function plotUpkeep(plot) {
  if (!plot || plot.status !== 'built') return 0;
  return Math.round(plot.cost * CONFIG.upkeepRate);
}

export function totalUpkeep(builtPlots) {
  return (builtPlots || []).reduce((sum, p) => sum + plotUpkeep(p), 0);
}

// Stage 15: how many already-*built* plots of a given kind exist, optionally
// excluding one plot id (used by relocatePlot/movePlanningPlot so a plot
// being repositioned never counts against its own price). Pure; a
// still-'planning' plot never counts, same rule plotUpkeep already follows.
export function countBuiltOfKind(builtPlots, kind, excludeId) {
  return (builtPlots || []).filter(p => p.status === 'built' && p.kind === kind && p.id !== excludeId).length;
}

// tooltips so the number a player sees matches what they're charged.
// Returns null for an unknown kind or an off-grid/unrecognized cell.
// Stage 15: builtPlots/excludeId are optional (default: no escalation) so
// every pre-Stage-15 call site and test that doesn't pass them keeps
// pricing exactly as before. Passing state.builtPlots is what makes the
// Nth built structure of a kind cost more than the first.
export function quoteBuild(kind, x, y, builtPlots = [], excludeId = null) {
  const type = STRUCTURE_TYPES[kind];
  const terrain = terrainAt(x, y);
  if (!type || !terrain) return null;
  // Stage 12: a multi-cell footprint (currently just stage's 2x2) must sit
  // entirely on the authored map — a cell hanging off TERRAIN_ROWS' edge
  // isn't buildable even if the anchor cell itself is fine. Cost/capacity
  // still price off the anchor cell's terrain only (a stage straddling two
  // terrain types doesn't get split pricing) — deliberately simple.
  const { w, h } = footprintFor(kind);
  if (footprintCells(x, y, w, h).some(c => !terrainAt(c.x, c.y))) return null;
  const mod = TERRAIN_BUILD_MODIFIERS[terrain];
  const builtCount = countBuiltOfKind(builtPlots, kind, excludeId);
  const escalationMult = Math.pow(1 + CONFIG.escalatingBuildCostRate, builtCount);
  const cost = Math.round((type.baseCost * mod.costMult * escalationMult) / 10) * 10;
  const capacity = kind === 'stage' ? Math.round(type.baseCapacity * mod.capacityMult) : undefined;
  const name = `${TERRAIN_NAME[terrain]} ${KIND_NOUN[kind]}`;
  return { kind, x, y, w, h, terrain, cost, capacity, name, builtCount, escalationMult };
}

// Stage 15: prices out committing every 'planning' plot in `builtPlots`
// together, one at a time in list order, against a scratch copy — so
// several same-kind plans committed as a batch escalate against each
// other exactly like committing them one by one would (see state.js's
// commitAllPlots). Pure and read-only; used both by commitAllPlots itself
// and by ui.js's "Commit All" total, so the number a player sees always
// matches what they'll actually be charged. Returns { total, costs } where
// costs maps plotId -> the price that plot would be charged in this batch.
export function previewCommitAll(builtPlots) {
  const planningIds = (builtPlots || []).filter(p => p.status === 'planning').map(p => p.id);
  const scratch = (builtPlots || []).map(p => ({ ...p }));
  const costs = {};
  let total = 0;
  for (const id of planningIds) {
    const p = scratch.find(pp => pp.id === id);
    const quote = quoteBuild(p.kind, p.x, p.y, scratch);
    const cost = quote ? quote.cost : p.cost;
    costs[id] = cost;
    total += cost;
    p.status = 'built';
  }
  return { total, costs };
}

// Stage 11: build-time legality — on top of (not instead of) whatever
// quoteBuild() charges. Checked wherever a plot's kind/position is set or
// changed (placePlot/buildPlot/movePlanningPlot/relocatePlot in state.js),
// so an illegal siting is refused before any money moves. Pure function;
// `builtPlots` is state.builtPlots (any status — a planning stage still
// "claims" its spot for spacing purposes, same as it claims its cell for
// the occupancy check state.js already does). `excludeId` lets a plot being
// moved/relocated ignore its own current position when checking distance to
// itself. Returns { ok, reason } rather than throwing — callers surface
// `reason` as the same kind of error string quoteBuild-adjacent checks use.
export function isLegalPlacement(kind, x, y, builtPlots, excludeId) {
  const { w, h } = footprintFor(kind);
  const cells = footprintCells(x, y, w, h);
  if (cells.some(c => !terrainAt(c.x, c.y))) {
    return { ok: false, reason: 'That doesn\u2019t fit within the surveyed grounds.' };
  }
  const banned = PLACEMENT_RULES.terrainBans[kind];
  if (banned && cells.some(c => banned.includes(terrainAt(c.x, c.y)))) {
    const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
    return { ok: false, reason: `A ${label} can't block the path \u2014 try a nearby clearing, hill, or woods instead.` };
  }
  // Stage 12: occupancy is now a footprint-vs-footprint overlap check (any
  // status counts, same as before — a still-"planning" plot claims its
  // cells too), not a single (x,y) match.
  const others = (builtPlots || []).filter(p => p && p.id !== excludeId);
  const overlaps = others.some(p => {
    const oCells = plotFootprintCells(p);
    return cells.some(c => oCells.some(o => o.x === c.x && o.y === c.y));
  });
  if (overlaps) return { ok: false, reason: 'Something is already built there.' };
  if (kind === 'stage') {
    const tooClose = others.some(p => {
      if (p.kind !== 'stage') return false;
      const oCells = plotFootprintCells(p);
      return cells.some(c => oCells.some(o => chebyshevDistance(c, o) <= PLACEMENT_RULES.minStageSpacing));
    });
    if (tooClose) {
      return { ok: false, reason: 'Too close to another stage \u2014 give show sites more room to breathe.' };
    }
  }
  const requiresFrontage = (PLACEMENT_RULES.requiresPathFrontage || []).includes(kind);
  if (requiresFrontage && !hasPathFrontage(cells)) {
    const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
    return { ok: false, reason: `A ${label} needs to sit on or beside a path \u2014 nothing gets built away from the thoroughfare.` };
  }
  return { ok: true, reason: null };
}

// Quirk effects are looked up by id rather than storing functions in data.js,
// keeping data.js pure content. Each quirk fn: (performer, ctx) => modifier info.
export const QUIRKS = {
  crowd_pleaser: {
    label: 'Crowd Pleaser',
    desc: '+15% draw in whatever block they play.',
    popularityMult: 1.15,
  },
  prima_donna: {
    label: 'Prima Donna',
    desc: 'Sulks (\u22123 satisfaction that block) if sharing a block with an equally or more popular act.',
    popularityMult: 1.0,
  },
  chaos_prone: {
    label: 'Chaos-Prone',
    desc: 'Raises the odds of a "Rowdy Crowd" event on days they perform.',
    popularityMult: 1.0,
  },
  // Stage 9: the first quirk whose effect actually depends on WHICH block
  // they're playing, not just whether they're playing at all — see
  // effectivePopularity() below, which is the only place blockId matters.
  night_owl: {
    label: 'Night Owl',
    desc: '+20% draw in Golden Hour; \u221210% draw in Morning Procession; no change midday/afternoon.',
    goldenMult: 1.2,
    morningMult: 0.9,
  },
};

// Effective popularity for a performer in a given time block, quirks
// applied. Exported (and pulled out of simulateDay's old inline closure)
// so it's independently testable — night_owl is the first quirk whose
// effect depends on WHICH block is passed in, so this needed to stop being
// a private nested function.
export function effectivePopularity(perf, blockId) {
  let mult = 1;
  if (perf.quirk === 'crowd_pleaser') mult *= QUIRKS.crowd_pleaser.popularityMult;
  if (perf.quirk === 'night_owl') {
    if (blockId === 'golden') mult *= QUIRKS.night_owl.goldenMult;
    else if (blockId === 'morning') mult *= QUIRKS.night_owl.morningMult;
  }
  return perf.popularity * mult;
}

// ---------- scheduling ----------
// schedule shape: { [blockId]: { [stageId]: performerId } }
// Returns a list of human-readable conflict strings (a performer scheduled
// into more than one block-stage slot within the SAME block is impossible
// by construction since a block only holds one performer per stage — the
// real conflict is the same performer in two different STAGES within the
// same time block, which we do need to catch).
export function validateSchedule(schedule) {
  const conflicts = [];
  for (const block of TIME_BLOCKS) {
    const stagesInBlock = schedule[block.id] || {};
    const seen = new Map();
    for (const [stageId, performerId] of Object.entries(stagesInBlock)) {
      if (!performerId) continue;
      if (seen.has(performerId)) {
        conflicts.push(`${performerById(performerId)?.name || performerId} is double-booked in ${block.label} (${seen.get(performerId)} and ${stageId})`);
      } else {
        seen.set(performerId, stageId);
      }
    }
  }
  return conflicts;
}

// ---------- day simulation ----------
// state fields used (read-only): cash, reputation, day, builtPlots[],
// roster[] (performer ids), hiredVendors[] (vendor ids), schedule, ticketPrice
export function simulateDay(state, seed) {
  const rng = makeRng(seed);
  const log = [];
  const warnings = [];

  // Stage 10: a plot still in "planning" hasn't been paid for or committed
  // yet, so it doesn't draw a crowd, seat a vendor, or affect anything else
  // gameplay-side until it's actually built.
  const builtStages = state.builtPlots.filter(p => p.kind === 'stage' && p.status === 'built');
  const builtFoodVendorPlots = state.builtPlots.filter(p => (p.kind === 'food' || p.kind === 'vendor') && p.status === 'built');
  const rosterPerformers = state.roster.map(performerById).filter(Boolean);
  const hiredVendorObjs = state.hiredVendors.map(vendorById).filter(Boolean);
  // Stage 10: hiring a vendor and seating them at a specific stall are now
  // two different things — a hired-but-unseated vendor still draws wages
  // (see vendorCosts below) but sells nothing, so only vendors actually
  // assigned to a built stall count toward revenue/satisfaction.
  const seatedVendorIds = new Set(builtFoodVendorPlots.filter(p => p.assignedVendorId).map(p => p.assignedVendorId));
  const activeVendorObjs = hiredVendorObjs.filter(v => seatedVendorIds.has(v.id));

  if (builtStages.length === 0) warnings.push('No stages built — the grounds have nothing to draw a crowd.');
  if (builtFoodVendorPlots.length > 0 && hiredVendorObjs.length === 0) {
    warnings.push('Stall plots are built but no vendors are hired to run them.');
  }
  const unseated = hiredVendorObjs.length - activeVendorObjs.length;
  if (unseated > 0) {
    warnings.push(`${unseated} hired vendor${unseated === 1 ? ' is' : 's are'} not assigned to a stall and earning nothing today.`);
  }

  // --- per-block, per-stage draw weight ---
  let scheduledCount = 0;
  const blockBreakdown = TIME_BLOCKS.map(block => {
    const stagesInBlock = state.schedule[block.id] || {};
    const stageEntries = builtStages.map(stage => {
      const performerId = stagesInBlock[stage.id];
      const perf = performerId ? performerById(performerId) : null;
      if (perf) scheduledCount++;
      const drawPop = perf ? effectivePopularity(perf, block.id) : 1.2; // ambient draw, empty stage
      const attrs = computePlotAttributes(stage, state.builtPlots);
      const weight = (attrs.traffic * 0.45 + (drawPop / 10) * 0.55);
      return { stage, attrs, perf, drawPop, weight };
    });
    return { block, stageEntries };
  });

  // --- prima donna satisfaction penalty check ---
  for (const { block, stageEntries } of blockBreakdown) {
    const withPerf = stageEntries.filter(e => e.perf);
    for (const e of withPerf) {
      if (e.perf.quirk === 'prima_donna') {
        const rival = withPerf.find(o => o !== e && o.perf.popularity >= e.perf.popularity);
        if (rival) {
          log.push(`${e.perf.name} sulked through ${block.label} sharing the bill with ${rival.perf.name}.`);
          e._sulking = true;
        }
      }
    }
  }

  // --- attendance ---
  const totalScheduledPopularity = rosterPerformers.reduce((sum, p) => sum + (state.schedule && isScheduledAnywhere(state.schedule, p.id) ? effectivePopularity(p) : 0), 0);
  const baseAttendance = 150 + state.reputation * 4;
  const priceFactor = clamp(1 - (state.ticketPrice - 16) / 40, 0.55, 1.35);
  const popularityFactor = 1 + Math.min(1.2, totalScheduledPopularity / 55);
  const adFactor = state.activeCampaign ? state.activeCampaign.attendanceMult : 1;
  const jitter = 0.9 + rng() * 0.2;
  const attendance = Math.max(0, Math.round(baseAttendance * priceFactor * popularityFactor * adFactor * jitter));

  // --- satisfaction (attendance-weighted across block/stage slots) ---
  let satWeightSum = 0;
  let satTotal = 0;
  let overCapacityHit = false;
  const totalWeightAllBlocks = blockBreakdown.reduce((s, b) => s + b.stageEntries.reduce((s2, e) => s2 + e.weight, 0), 0) || 1;

  for (const { block, stageEntries } of blockBreakdown) {
    const blockWeightSum = stageEntries.reduce((s, e) => s + e.weight, 0) || 1;
    const blockAttendance = Math.round(attendance * (blockWeightSum / totalWeightAllBlocks));
    for (const e of stageEntries) {
      const share = e.weight / blockWeightSum;
      const stageAttendance = Math.round(blockAttendance * share);
      const capped = Math.min(stageAttendance, e.stage.capacity);
      if (stageAttendance > e.stage.capacity) overCapacityHit = true;
      let quality = e.attrs.sightline * 0.6 + e.attrs.shade * 0.25 + (e.drawPop / 10) * 0.15;
      if (e._sulking) quality -= 0.3;
      if (capped > e.stage.capacity * 0.95) quality -= 0.15; // crowding discomfort near cap
      satWeightSum += capped;
      satTotal += quality * capped;
    }
  }
  let satisfaction = satWeightSum > 0 ? clamp((satTotal / satWeightSum) * 100, 0, 100) : 45;
  if (overCapacityHit) warnings.push('At least one stage overflowed its capacity — some folks were turned away from the best view.');

  // --- vendor revenue ---
  // Stage 14: a seated vendor's buyer count now scales with their OWN
  // stall's foot-traffic multiplier (computeFootTraffic), not just the
  // day's total attendance — a well-sited stall (path frontage, near a
  // packed stage or a demo camp) genuinely outsells an identically-good
  // vendor stuck in a dead corner of the grounds.
  const footTraffic = computeFootTraffic(state.builtPlots);
  const plotByVendorId = new Map(builtFoodVendorPlots.filter(p => p.assignedVendorId).map(p => [p.assignedVendorId, p]));
  let vendorGrossTotal = 0;
  let houseVendorRevenue = 0;
  let bestStall = null, worstStall = null;
  for (const vendor of activeVendorObjs) {
    const plot = plotByVendorId.get(vendor.id);
    const trafficMult = plot && footTraffic[plot.id] ? footTraffic[plot.id].mult : 1;
    const conversion = 0.12 * (vendor.quality / 7);
    const buyers = Math.round(attendance * conversion * trafficMult);
    const gross = buyers * vendor.avgTicket;
    vendorGrossTotal += gross;
    houseVendorRevenue += gross * CONFIG.wristbandCut;
    satisfaction = clamp(satisfaction + (vendor.quality - 6) * 0.4, 0, 100);
    if (plot) {
      const entry = { vendor, plot, mult: trafficMult };
      if (!bestStall || trafficMult > bestStall.mult) bestStall = entry;
      if (!worstStall || trafficMult < worstStall.mult) worstStall = entry;
    }
  }
  // Only worth remarking on when the spread between the best- and
  // worst-sited stalls today is actually noticeable.
  if (bestStall && worstStall && bestStall.vendor.id !== worstStall.vendor.id && bestStall.mult / worstStall.mult >= 1.3) {
    log.push(`${bestStall.vendor.name} pulled a lively crowd from its ${bestStall.plot.name} spot, while ${worstStall.vendor.name} saw barely anyone drift past its ${worstStall.plot.name}.`);
  }

  // --- ticket revenue & costs ---
  const ticketRevenue = attendance * state.ticketPrice;
  const performerCosts = rosterPerformers.reduce((s, p) => s + effectivePerformerCost(state, p.id), 0);
  const vendorCosts = hiredVendorObjs.reduce((s, v) => s + effectiveVendorCost(state, v.id), 0);
  // Stage 13: real per-plot upkeep (any built kind, not just stages)
  // replaces the old flat "+20/stage" stand-in; overhead is now just the
  // flat cost of running the grounds at all, independent of what's built.
  const overhead = CONFIG.baseOverhead;
  const upkeep = totalUpkeep(state.builtPlots);
  const costs = performerCosts + vendorCosts + upkeep + overhead;

  // --- random events ---
  const ctx = {
    hasChaosProne: rosterPerformers.some(p => p.quirk === 'chaos_prone' && isScheduledAnywhere(state.schedule, p.id)),
    hasVendor: activeVendorObjs.length > 0,
    // Stage 9: "backstage drama" events gated on roster composition rather
    // than a single quirk/vendor flag.
    hasMultiplePrimaDonnas: rosterPerformers.filter(p => p.quirk === 'prima_donna').length >= 2,
    hasTwoMusicians: rosterPerformers.filter(p => p.role === 'musician' && isScheduledAnywhere(state.schedule, p.id)).length >= 2,
    hasFalconerScheduled: rosterPerformers.some(p => p.role === 'falconer' && isScheduledAnywhere(state.schedule, p.id)),
    bigRoster: rosterPerformers.length >= 5,
  };
  const events = rollEvents(rng, ctx);
  let eventCashDelta = 0, eventRepDelta = 0, eventSatDelta = 0;
  for (const evt of events) {
    const eff = EVENT_EFFECTS[evt.effectId];
    if (!eff) continue;
    const result = eff(rng, state);
    eventCashDelta += result.cashDelta || 0;
    eventRepDelta += result.repDelta || 0;
    eventSatDelta += result.satisfactionDelta || 0;
    log.push(result.message);
  }
  satisfaction = clamp(satisfaction + eventSatDelta, 0, 100);

  const cashDelta = Math.round(ticketRevenue + houseVendorRevenue - costs + eventCashDelta);
  const reputationDelta = clamp(Math.round((satisfaction - 60) / 8), -6, 6) + eventRepDelta;

  return {
    day: state.day,
    attendance,
    ticketRevenue: Math.round(ticketRevenue),
    vendorRevenue: Math.round(houseVendorRevenue),
    performerCosts, vendorCosts, upkeep, overhead,
    costs: Math.round(costs),
    cashDelta,
    satisfaction: Math.round(satisfaction),
    reputationDelta,
    scheduledCount,
    adFactor,
    campaignActive: state.activeCampaign ? state.activeCampaign.name : null,
    footTraffic,
    events,
    log,
    warnings,
  };
}

function isScheduledAnywhere(schedule, performerId) {
  for (const stages of Object.values(schedule || {})) {
    if (Object.values(stages).includes(performerId)) return true;
  }
  return false;
}

// Every `requires` string any EVENT_POOL entry uses must have an entry
// here — see the EVENT_POOL integrity test in tests/smoke.mjs, which
// walks EVENT_POOL and asserts exactly that. Exported so a future stage
// adding a new gated event can't silently typo a requires string: an
// unrecognized one now makes that event ineligible (fails closed) instead
// of the old inline if/else chain's fallback of treating it as always
// eligible (fails open) — a bug that happened to be harmless while only
// two requires strings existed, but wouldn't have stayed harmless forever.
export const EVENT_REQUIREMENTS = {
  hasChaosProne: (ctx) => ctx.hasChaosProne,
  hasVendor: (ctx) => ctx.hasVendor,
  hasMultiplePrimaDonnas: (ctx) => ctx.hasMultiplePrimaDonnas,
  hasTwoMusicians: (ctx) => ctx.hasTwoMusicians,
  hasFalconerScheduled: (ctx) => ctx.hasFalconerScheduled,
  bigRoster: (ctx) => ctx.bigRoster,
};

function rollEvents(rng, ctx) {
  const eligible = EVENT_POOL.filter(e => {
    if (!e.requires) return true;
    const check = EVENT_REQUIREMENTS[e.requires];
    return check ? check(ctx) : false;
  });
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);
  const events = [];
  // At most one event per day for stage 1 — keeps the report readable and
  // the sim easy to reason about. See HANDOFF.md for scaling this up.
  if (rng() < 0.6 && eligible.length > 0) {
    let roll = rng() * totalWeight;
    for (const e of eligible) {
      roll -= e.weight;
      if (roll <= 0) { events.push(e); break; }
    }
  }
  return events;
}

export const EVENT_EFFECTS = {
  perfect_weather: (rng) => ({
    cashDelta: 0, repDelta: 0, satisfactionDelta: 6,
    message: 'Clear skies and a cool breeze all day — the crowd lingered longer than usual.',
  }),
  dropped_prop_recovery: (rng) => ({
    cashDelta: 0, repDelta: 1, satisfactionDelta: 4,
    message: 'A performer fumbled a prop and turned it into a bit — the crowd loved the save.',
  }),
  broken_wagon_wheel: (rng) => {
    const cost = 60 + Math.floor(rng() * 60);
    return {
      cashDelta: -cost, repDelta: 0, satisfactionDelta: -3,
      message: `A supply wagon threw a wheel on the dirt path — $${cost} to get it moving again.`,
    };
  },
  noble_visit: (rng) => ({
    cashDelta: 120, repDelta: 3, satisfactionDelta: 5,
    message: 'A minor noble made a surprise visit and was delighted — word will spread.',
  }),
  rowdy_crowd: (rng) => {
    const roll = rng();
    if (roll < 0.5) {
      return { cashDelta: 0, repDelta: 0, satisfactionDelta: 5, message: 'The jester whipped the crowd into a roar of laughter.' };
    }
    const cost = 40 + Math.floor(rng() * 40);
    return { cashDelta: -cost, repDelta: -1, satisfactionDelta: -2, message: `The rowdy crowd knocked over a stall rail — $${cost} in repairs.` };
  },
  sellout_stall: (rng) => ({
    cashDelta: 45, repDelta: 0, satisfactionDelta: 2,
    message: 'One of the stalls sold clean out by mid-afternoon — brisk business.',
  }),
  // Stage 9 additions — "backstage drama" events (see EVENT_REQUIREMENTS
  // above for what gates each one).
  diva_standoff: (rng) => ({
    cashDelta: 0, repDelta: -1, satisfactionDelta: -4,
    message: 'Two prima donnas traded icy words backstage \u2014 word of the standoff spread through the crowd.',
  }),
  musicians_jam: (rng) => ({
    cashDelta: 0, repDelta: 1, satisfactionDelta: 6,
    message: 'Two musicians struck up an unplanned duet between sets \u2014 the crowd lingered to listen.',
  }),
  falconer_show: (rng) => ({
    cashDelta: 30, repDelta: 1, satisfactionDelta: 5,
    message: 'A hawk swooped low over the crowd mid-show \u2014 gasps, then applause, then a few coins tossed.',
  }),
  gossip_wagon: (rng) => ({
    cashDelta: 0, repDelta: 0, satisfactionDelta: 3,
    message: 'With so many acts camped together, the tiring house buzzed with shared stories \u2014 morale stayed high all day.',
  }),
};
