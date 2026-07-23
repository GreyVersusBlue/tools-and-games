// engine.js — pure functions only. Nothing here touches the DOM or mutates
// its inputs; state.js owns the actual game-state object and calls into
// this module for the math. That split is what makes the smoke tests able
// to run simulateDay() hundreds of times in plain Node with no jsdom.

import { CONFIG, TIME_BLOCKS, PERFORMERS, VENDORS, EVENT_POOL, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS } from './data.js';

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

const ADJACENCY_RADIUS = 2;
const NEARBY_STAGE_SIGHTLINE_PENALTY = 0.1; // per nearby built stage, stages only
const NEARBY_STAGE_TRAFFIC_BONUS = 0.05; // per nearby built stage, food/vendor/demo only

// Derives a built (or hypothetical) plot's real sightline/shade/traffic from
// its terrain plus which OTHER plots are currently built nearby:
//  - a stage within ADJACENCY_RADIUS of another built stage loses sightline
//    (overlapping crowds/noise/tree cover between two show sites)
//  - a food/vendor/demo plot within ADJACENCY_RADIUS of a built stage gains
//    traffic (people spilling out of a show walk past it)
// `builtPlots` is the array of full plot objects (state.builtPlots) — not
// ids, since Stage 3 plots are player-built records with no catalog to
// look them up in. Pure function; never mutates its arguments.
export function computePlotAttributes(plot, builtPlots) {
  const base = TERRAIN_BASE[terrainAt(plot.x, plot.y)] || TERRAIN_BASE.clearing;
  const others = (builtPlots || []).filter(p => p && p.id !== plot.id);
  const nearbyStages = others.filter(o => o.kind === 'stage' && chebyshevDistance(plot, o) <= ADJACENCY_RADIUS).length;

  let sightline = base.sightline;
  let traffic = base.traffic;
  if (plot.kind === 'stage') {
    sightline = clamp(sightline - nearbyStages * NEARBY_STAGE_SIGHTLINE_PENALTY, 0.15, 1);
  } else if (nearbyStages > 0) {
    traffic = clamp(traffic + nearbyStages * NEARBY_STAGE_TRAFFIC_BONUS, 0, 1);
  }

  return {
    sightline: Math.round(sightline * 100) / 100,
    shade: Math.round(base.shade * 100) / 100,
    traffic: Math.round(traffic * 100) / 100,
    nearbyStages,
  };
}

// Quotes what building a given structure kind at (x,y) would cost/seat,
// before anything is actually built — the single source of truth for that
// math, used both by state.js's buildPlot action and ui.js's build-preview
// tooltips so the number a player sees matches what they're charged.
// Returns null for an unknown kind or an off-grid/unrecognized cell.
export function quoteBuild(kind, x, y) {
  const type = STRUCTURE_TYPES[kind];
  const terrain = terrainAt(x, y);
  if (!type || !terrain) return null;
  const mod = TERRAIN_BUILD_MODIFIERS[terrain];
  const cost = Math.round((type.baseCost * mod.costMult) / 10) * 10;
  const capacity = kind === 'stage' ? Math.round(type.baseCapacity * mod.capacityMult) : undefined;
  const name = `${TERRAIN_NAME[terrain]} ${KIND_NOUN[kind]}`;
  return { kind, x, y, terrain, cost, capacity, name };
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

  const builtStages = state.builtPlots.filter(p => p.kind === 'stage');
  const builtFoodVendorPlots = state.builtPlots.filter(p => p.kind === 'food' || p.kind === 'vendor');
  const rosterPerformers = state.roster.map(performerById).filter(Boolean);
  const hiredVendorObjs = state.hiredVendors.map(vendorById).filter(Boolean);

  if (builtStages.length === 0) warnings.push('No stages built — the grounds have nothing to draw a crowd.');
  if (builtFoodVendorPlots.length > 0 && hiredVendorObjs.length === 0) {
    warnings.push('Stall plots are built but no vendors are hired to run them.');
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
  let vendorGrossTotal = 0;
  let houseVendorRevenue = 0;
  for (const vendor of hiredVendorObjs) {
    const conversion = 0.12 * (vendor.quality / 7);
    const buyers = Math.round(attendance * conversion);
    const gross = buyers * vendor.avgTicket;
    vendorGrossTotal += gross;
    houseVendorRevenue += gross * CONFIG.wristbandCut;
    satisfaction = clamp(satisfaction + (vendor.quality - 6) * 0.4, 0, 100);
  }

  // --- ticket revenue & costs ---
  const ticketRevenue = attendance * state.ticketPrice;
  const performerCosts = rosterPerformers.reduce((s, p) => s + effectivePerformerCost(state, p.id), 0);
  const vendorCosts = hiredVendorObjs.reduce((s, v) => s + effectiveVendorCost(state, v.id), 0);
  const overhead = 150 + builtStages.length * 20; // grounds upkeep scales a little with built stages
  const costs = performerCosts + vendorCosts + overhead;

  // --- random events ---
  const ctx = {
    hasChaosProne: rosterPerformers.some(p => p.quirk === 'chaos_prone' && isScheduledAnywhere(state.schedule, p.id)),
    hasVendor: hiredVendorObjs.length > 0,
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
    performerCosts, vendorCosts, overhead,
    costs: Math.round(costs),
    cashDelta,
    satisfaction: Math.round(satisfaction),
    reputationDelta,
    scheduledCount,
    adFactor,
    campaignActive: state.activeCampaign ? state.activeCampaign.name : null,
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
