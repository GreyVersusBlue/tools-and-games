// engine.js — pure functions only. Nothing here touches the DOM or mutates
// its inputs; state.js owns the actual game-state object and calls into
// this module for the math. That split is what makes the smoke tests able
// to run simulateDay() hundreds of times in plain Node with no jsdom.

import { CONFIG, TIME_BLOCKS, PERFORMERS, VENDORS, EVENT_POOL, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN } from './data.js';

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
};

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

  // --- effective popularity per performer for today (quirks applied) ---
  function effectivePopularity(perf, blockId) {
    let mult = 1;
    if (perf.quirk === 'crowd_pleaser') mult *= QUIRKS.crowd_pleaser.popularityMult;
    return perf.popularity * mult;
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
          log.push(`${e.perf.name} sulked through ${block.block.label} sharing the bill with ${rival.perf.name}.`);
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
  const jitter = 0.9 + rng() * 0.2;
  const attendance = Math.max(0, Math.round(baseAttendance * priceFactor * popularityFactor * jitter));

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
  const performerCosts = rosterPerformers.reduce((s, p) => s + p.cost, 0);
  const vendorCosts = hiredVendorObjs.reduce((s, v) => s + v.cost, 0);
  const overhead = 150 + builtStages.length * 20; // grounds upkeep scales a little with built stages
  const costs = performerCosts + vendorCosts + overhead;

  // --- random events ---
  const ctx = {
    hasChaosProne: rosterPerformers.some(p => p.quirk === 'chaos_prone' && isScheduledAnywhere(state.schedule, p.id)),
    hasVendor: hiredVendorObjs.length > 0,
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

function rollEvents(rng, ctx) {
  const eligible = EVENT_POOL.filter(e => {
    if (!e.requires) return true;
    if (e.requires === 'hasChaosProne') return ctx.hasChaosProne;
    if (e.requires === 'hasVendor') return ctx.hasVendor;
    return true;
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
};
