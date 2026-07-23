// state.js — the single game-state object and the actions that change it.
// Deliberately framework-agnostic: every action takes a state and returns a
// NEW state (no in-place mutation), so ui.js can just re-render after every
// action and tests can assert on plain objects.

import { CONFIG, TIME_BLOCKS, STRUCTURE_TYPES, AD_CAMPAIGNS, CONTRACT_OPTIONS } from './data.js';
import { simulateDay, performerById, vendorById, campaignById, validateSchedule, terrainAt, quoteBuild, isSeasonUnlocked, isLegalPlacement, isFootprintWithinCurrentGrid, footprintFor, STALL_KIND_BY_VENDOR_TYPE } from './engine.js';

const SAVE_KEY = 'renn-faire-sim-save-v1';

export function createInitialState() {
  return {
    day: 1,
    season: 1, // weekend number (Stage 6) — gates campaigns/contracts via unlockSeason
    weekendDay: 1, // 1=Fri, 2=Sat, 3=Sun; hard-stops at CONFIG.seasonLength (see nextDay)
    cash: CONFIG.startingCash,
    reputation: CONFIG.startingReputation,
    ticketPrice: CONFIG.ticketPrice.start,
    builtPlots: [],
    roster: [],
    contracts: {}, // performerId -> { contractId, dailyCost, commitDaysRemaining }
    hiredVendors: [],
    vendorContracts: {}, // vendorId -> { contractId, dailyCost, commitDaysRemaining } (Stage 7)
    schedule: Object.fromEntries(TIME_BLOCKS.map(b => [b.id, {}])),
    activeCampaign: null, // { id, name, attendanceMult, daysRemaining, cooldownDays } or null
    campaignCooldowns: {}, // campaignId -> days remaining before it can be relaunched
    phase: 'plan', // 'plan' -> 'report' -> 'plan' ...
    lastResult: null,
    history: [], // array of past simulateDay() results, oldest first
    nextPlotId: 1, // Stage 10: counter for placePlot's ids, decoupled from (x,y) so relocating a plot never orphans its schedule/assignment references
  };
}

function clone(state) {
  return {
    ...state,
    builtPlots: state.builtPlots.map(p => ({ ...p })),
    roster: [...state.roster],
    contracts: Object.fromEntries(Object.entries(state.contracts).map(([k, v]) => [k, { ...v }])),
    hiredVendors: [...state.hiredVendors],
    vendorContracts: Object.fromEntries(Object.entries(state.vendorContracts).map(([k, v]) => [k, { ...v }])),
    schedule: Object.fromEntries(Object.entries(state.schedule).map(([k, v]) => [k, { ...v }])),
    activeCampaign: state.activeCampaign ? { ...state.activeCampaign } : null,
    campaignCooldowns: { ...state.campaignCooldowns },
    history: [...state.history],
  };
}

// ---------- plan-phase actions ----------
// Stage 3: buildPlot takes a structure kind plus a grid cell rather than a
// catalog id — there is no fixed list of plots anymore. quoteBuild() (pure,
// engine.js) computes the terrain-adjusted cost/capacity/name; this action
// just validates the cell, charges for it, and records the new plot.
// Kept as a one-shot "place and pay immediately" action — still used by the
// existing test suite, and available for any future flow that wants instant
// construction. The live Fair Floor UI itself now goes through placePlot +
// commitPlot (below) so a player can lay a plot out, move it around, and
// only pay once they're happy with it. Both paths produce the same plot
// shape (status: 'built' here vs 'planning' → 'built' there) so nothing
// downstream needs to know which path a given plot came from.
export function buildPlot(state, kind, x, y) {
  if (!STRUCTURE_TYPES[kind]) return { state, error: 'Unknown structure type.' };
  if (!isFootprintWithinCurrentGrid(state, kind, x, y)) {
    return { state, error: 'That spot is past the fence line \u2014 expand the grounds first.' };
  }
  const quote = quoteBuild(kind, x, y);
  if (!quote) return { state, error: 'Nothing can be built there.' };
  const legal = isLegalPlacement(kind, x, y, state.builtPlots);
  if (!legal.ok) return { state, error: legal.reason };
  if (state.cash < quote.cost) return { state, error: `Not enough cash (need $${quote.cost}).` };
  const next = clone(state);
  next.cash -= quote.cost;
  const { w, h } = footprintFor(kind);
  const plot = { id: `${x}_${y}`, kind, x, y, w, h, name: quote.name, cost: quote.cost, status: 'built', customName: false };
  if (kind === 'stage') plot.capacity = quote.capacity;
  if (kind === 'food' || kind === 'vendor') plot.assignedVendorId = null;
  next.builtPlots.push(plot);
  return { state: next, error: null };
}

// ---------- Stage 10: planning → commit construction flow ----------
// placePlot lays a plot down for free, unpaid and non-functional
// ('planning' status) — it draws no crowd, seats no vendor, and affects no
// adjacency math (see engine.js's computePlotAttributes/simulateDay) until
// commitPlot actually charges for it. This is what lets a player lay out a
// whole cluster of stalls, eyeball the map, and only pay once they've
// settled on a layout — rather than the old buildPlot behavior of charging
// (and being stuck with) whatever cell was clicked first.
export function placePlot(state, kind, x, y) {
  if (!STRUCTURE_TYPES[kind]) return { state, error: 'Unknown structure type.' };
  if (!isFootprintWithinCurrentGrid(state, kind, x, y)) {
    return { state, error: 'That spot is past the fence line \u2014 expand the grounds first.' };
  }
  const quote = quoteBuild(kind, x, y);
  if (!quote) return { state, error: 'Nothing can be built there.' };
  const legal = isLegalPlacement(kind, x, y, state.builtPlots);
  if (!legal.ok) return { state, error: legal.reason };
  const next = clone(state);
  const id = `plot_${next.nextPlotId}`;
  next.nextPlotId += 1;
  const { w, h } = footprintFor(kind);
  const plot = { id, kind, x, y, w, h, name: quote.name, cost: quote.cost, status: 'planning', customName: false };
  if (kind === 'stage') plot.capacity = quote.capacity;
  if (kind === 'food' || kind === 'vendor') plot.assignedVendorId = null;
  next.builtPlots.push(plot);
  return { state: next, error: null };
}

export function commitPlot(state, plotId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'planning') return { state, error: 'That plot is already built.' };
  if (state.cash < plot.cost) return { state, error: `Not enough cash (need $${plot.cost}).` };
  const next = clone(state);
  next.cash -= plot.cost;
  next.builtPlots.find(p => p.id === plotId).status = 'built';
  return { state: next, error: null };
}

// Bulk convenience for exactly the scenario that caused the original soft
// lock: several stalls placed in one sitting. All-or-nothing rather than
// partial, so the player always knows exactly what they paid for in one
// glance rather than having to work out which subset got skipped.
export function commitAllPlots(state) {
  const planning = state.builtPlots.filter(p => p.status === 'planning');
  if (planning.length === 0) return { state, error: 'Nothing is waiting to be committed.', count: 0, total: 0 };
  const total = planning.reduce((s, p) => s + p.cost, 0);
  if (state.cash < total) return { state, error: `Not enough cash to commit everything (need $${total}).`, count: 0, total };
  const next = clone(state);
  next.cash -= total;
  for (const p of next.builtPlots) if (p.status === 'planning') p.status = 'built';
  return { state: next, error: null, count: planning.length, total };
}

export function deletePlanningPlot(state, plotId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'planning') return { state, error: 'Only an un-built plan can be deleted for free \u2014 demolish a built plot instead.' };
  const next = clone(state);
  next.builtPlots = next.builtPlots.filter(p => p.id !== plotId);
  return { state: next, error: null };
}

export function movePlanningPlot(state, plotId, x, y) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'planning') return { state, error: 'Only an un-built plan can be moved for free \u2014 relocate a built plot instead.' };
  if (!isFootprintWithinCurrentGrid(state, plot.kind, x, y)) return { state, error: 'That spot is past the fence line.' };
  const quote = quoteBuild(plot.kind, x, y);
  if (!quote) return { state, error: 'Nothing can be built there.' };
  const legal = isLegalPlacement(plot.kind, x, y, state.builtPlots, plotId);
  if (!legal.ok) return { state, error: legal.reason };
  const next = clone(state);
  const np = next.builtPlots.find(p => p.id === plotId);
  np.x = x; np.y = y; np.cost = quote.cost;
  if (plot.kind === 'stage') np.capacity = quote.capacity;
  if (!np.customName) np.name = quote.name;
  return { state: next, error: null };
}

// Tearing down a committed plot charges CONFIG.demolishFeeMult of its build
// cost as a fee (deducted even if it dips cash negative, same pattern as
// releasePerformer/fireVendor's cancellation fees). Any vendor seated there
// is released back to "hired but unseated" rather than fired outright.
export function demolishPlot(state, plotId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'built') return { state, error: 'That is still just a plan \u2014 delete it instead, for free.' };
  const fee = Math.round(plot.cost * CONFIG.demolishFeeMult);
  const next = clone(state);
  next.cash -= fee;
  next.builtPlots = next.builtPlots.filter(p => p.id !== plotId);
  return { state: next, error: null, fee };
}

// Relocating a committed plot pays the same demolition fee as demolishPlot
// PLUS CONFIG.relocateDiscountMult of the new site's build cost (a small
// discount off building fresh there). Its id, name (if customized), and any
// seated vendor all carry over untouched.
export function relocatePlot(state, plotId, x, y) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'built') return { state, error: 'Move it for free while it is still a plan.' };
  if (!isFootprintWithinCurrentGrid(state, plot.kind, x, y)) return { state, error: 'That spot is past the fence line.' };
  const quote = quoteBuild(plot.kind, x, y);
  if (!quote) return { state, error: 'Nothing can be built there.' };
  const legal = isLegalPlacement(plot.kind, x, y, state.builtPlots, plotId);
  if (!legal.ok) return { state, error: legal.reason };
  const demolishFee = Math.round(plot.cost * CONFIG.demolishFeeMult);
  const rebuildCost = Math.round(quote.cost * CONFIG.relocateDiscountMult);
  const total = demolishFee + rebuildCost;
  if (state.cash < total) return { state, error: `Not enough cash to relocate (need $${total}).` };
  const next = clone(state);
  next.cash -= total;
  const np = next.builtPlots.find(p => p.id === plotId);
  np.x = x; np.y = y; np.cost = quote.cost;
  if (plot.kind === 'stage') np.capacity = quote.capacity;
  if (!np.customName) np.name = quote.name;
  return { state: next, error: null, fee: total };
}

export function renamePlot(state, plotId, newName) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  const trimmed = (newName || '').trim();
  if (!trimmed) return { state, error: 'Name cannot be empty.' };
  const next = clone(state);
  const np = next.builtPlots.find(p => p.id === plotId);
  np.name = trimmed.slice(0, CONFIG.maxPlotNameLength);
  np.customName = true;
  return { state: next, error: null };
}

// ---------- Stage 10: individual vendor ↔ stall assignment ----------
export function assignVendorToPlot(state, plotId, vendorId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'built') return { state, error: 'Commit that plot before seating a vendor.' };
  if (plot.kind !== 'food' && plot.kind !== 'vendor') return { state, error: 'Only food and craft stalls take a vendor.' };
  const vendor = vendorById(vendorId);
  if (!vendor) return { state, error: 'Unknown vendor.' };
  if (!state.hiredVendors.includes(vendorId)) return { state, error: 'That vendor has not been hired yet.' };
  if (STALL_KIND_BY_VENDOR_TYPE[vendor.type] !== plot.kind) {
    return { state, error: `${vendor.name} doesn\u2019t fit a ${STRUCTURE_TYPES[plot.kind].label}.` };
  }
  if (plot.assignedVendorId) return { state, error: 'That stall already has a vendor \u2014 unassign them first.' };
  const next = clone(state);
  // A vendor can only run one stall at a time — pull them off wherever they
  // were previously seated (a no-op if this is their first assignment).
  for (const p of next.builtPlots) if (p.assignedVendorId === vendorId) p.assignedVendorId = null;
  next.builtPlots.find(p => p.id === plotId).assignedVendorId = vendorId;
  return { state: next, error: null };
}

export function unassignVendorFromPlot(state, plotId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (!plot.assignedVendorId) return { state, error: null };
  const next = clone(state);
  next.builtPlots.find(p => p.id === plotId).assignedVendorId = null;
  return { state: next, error: null };
}

// Matches every hired-but-unseated vendor to an open stall of the matching
// kind, in roster/build order. Deterministic and pure aside from returning
// a new state — no randomness, so the same starting position always fills
// the same way.
export function autoFillStalls(state) {
  const next = clone(state);
  const alreadySeated = new Set(next.builtPlots.filter(p => p.assignedVendorId).map(p => p.assignedVendorId));
  const openPlots = next.builtPlots.filter(p => p.status === 'built' && (p.kind === 'food' || p.kind === 'vendor') && !p.assignedVendorId);
  const freeVendors = next.hiredVendors.filter(id => !alreadySeated.has(id)).map(vendorById).filter(Boolean);
  let filled = 0;
  for (const plot of openPlots) {
    const idx = freeVendors.findIndex(v => STALL_KIND_BY_VENDOR_TYPE[v.type] === plot.kind);
    if (idx === -1) continue;
    const [vendor] = freeVendors.splice(idx, 1);
    plot.assignedVendorId = vendor.id;
    filled++;
  }
  return { state: next, error: null, filled };
}

// `contractId` picks the deal (see data.js's CONTRACT_OPTIONS): 'open' (the
// default) is the no-commitment day rate at the listed cost; 'weekend'
// locks the performer in at a discount for CONTRACT_OPTIONS.weekend.commitDays,
// tracked via state.contracts[performerId].commitDaysRemaining.
export function contractPerformer(state, performerId, contractId = 'open') {
  const perf = performerById(performerId);
  if (!perf) return { state, error: 'Unknown performer.' };
  if (state.roster.includes(performerId)) return { state, error: 'Already contracted.' };
  const option = CONTRACT_OPTIONS[contractId];
  if (!option) return { state, error: 'Unknown contract type.' };
  if (!isSeasonUnlocked(state, option.unlockSeason)) {
    return { state, error: `${option.label} unlocks in Weekend ${option.unlockSeason}.` };
  }
  const next = clone(state);
  next.roster.push(performerId);
  next.contracts[performerId] = {
    contractId,
    dailyCost: Math.round(perf.cost * option.priceMult),
    commitDaysRemaining: option.commitDays,
  };
  return { state: next, error: null };
}

// Releasing is free for an open day-rate, or once a Weekend Package's
// commitment has run its course. Breaking a still-active Weekend Package
// early charges a cancellation fee against the days still owed on it —
// returned as `fee` (0 when none applies) so the UI can flash the amount.
export function releasePerformer(state, performerId) {
  const next = clone(state);
  const contract = next.contracts[performerId];
  let fee = 0;
  if (contract && contract.commitDaysRemaining > 0) {
    const option = CONTRACT_OPTIONS[contract.contractId];
    fee = Math.round(contract.dailyCost * contract.commitDaysRemaining * (option?.cancelFeeMult || 0));
    next.cash -= fee;
  }
  delete next.contracts[performerId];
  next.roster = next.roster.filter(id => id !== performerId);
  // pull them out of the schedule too
  for (const blockId of Object.keys(next.schedule)) {
    for (const stageId of Object.keys(next.schedule[blockId])) {
      if (next.schedule[blockId][stageId] === performerId) delete next.schedule[blockId][stageId];
    }
  }
  return { state: next, error: null, fee };
}

// `contractId` mirrors contractPerformer exactly (Stage 7): 'open' (the
// default) is the no-commitment day rate at the listed cost; 'weekend'/
// 'season' lock the vendor in at a discount for CONTRACT_OPTIONS[id].commitDays,
// tracked via state.vendorContracts[vendorId].commitDaysRemaining.
// Stage 10: food stalls and craft stalls are now capped separately — the
// old check summed BOTH kinds of built plot into one shared pool, so it was
// possible to hire, say, ten food vendors against ten craft stalls (and
// zero food stalls) with nothing stopping it. Splitting the cap by kind
// also feeds the Backstage "N/M filled" vacancy tracker directly.
export function hireVendor(state, vendorId, contractId = 'open') {
  const vendor = vendorById(vendorId);
  if (!vendor) return { state, error: 'Unknown vendor.' };
  if (state.hiredVendors.includes(vendorId)) return { state, error: 'Already hired.' };
  const stallKind = STALL_KIND_BY_VENDOR_TYPE[vendor.type];
  const kindLabel = vendor.type === 'food' ? 'food' : 'craft';
  const builtOfKind = state.builtPlots.filter(p => p.kind === stallKind && p.status === 'built').length;
  const hiredOfType = state.hiredVendors.map(vendorById).filter(v => v && v.type === vendor.type).length;
  if (hiredOfType >= builtOfKind) {
    return builtOfKind === 0
      ? { state, error: `Build a stall plot first \u2014 no open ${kindLabel} stalls.` }
      : { state, error: `No open ${kindLabel} stalls \u2014 build another, or let a hired ${kindLabel} vendor go first.` };
  }
  const option = CONTRACT_OPTIONS[contractId];
  if (!option) return { state, error: 'Unknown contract type.' };
  if (!isSeasonUnlocked(state, option.unlockSeason)) {
    return { state, error: `${option.label} unlocks in Weekend ${option.unlockSeason}.` };
  }
  const next = clone(state);
  next.hiredVendors.push(vendorId);
  next.vendorContracts[vendorId] = {
    contractId,
    dailyCost: Math.round(vendor.cost * option.priceMult),
    commitDaysRemaining: option.commitDays,
  };
  // Auto-seat into the first open matching stall so hiring "just works" for
  // the common case; the player can still reassign by hand, or reach for
  // Auto-Fill Stalls later if a demolition ever leaves someone unseated.
  const openPlot = next.builtPlots.find(p => p.kind === stallKind && p.status === 'built' && !p.assignedVendorId);
  if (openPlot) openPlot.assignedVendorId = vendorId;
  return { state: next, error: null };
}

// Mirrors releasePerformer exactly: free for an open day-rate, or once a
// commitment has run its course; breaking an active commitment early
// charges a cancellation fee against the days still owed, returned as
// `fee` (0 when none applies) so the UI can flash the amount.
export function fireVendor(state, vendorId) {
  const next = clone(state);
  const contract = next.vendorContracts[vendorId];
  let fee = 0;
  if (contract && contract.commitDaysRemaining > 0) {
    const option = CONTRACT_OPTIONS[contract.contractId];
    fee = Math.round(contract.dailyCost * contract.commitDaysRemaining * (option?.cancelFeeMult || 0));
    next.cash -= fee;
  }
  delete next.vendorContracts[vendorId];
  next.hiredVendors = next.hiredVendors.filter(id => id !== vendorId);
  for (const p of next.builtPlots) if (p.assignedVendorId === vendorId) p.assignedVendorId = null;
  return { state: next, error: null, fee };
}

export function assignSchedule(state, blockId, stageId, performerId) {
  if (!state.schedule[blockId]) return { state, error: 'Unknown time block.' };
  if (!state.roster.includes(performerId)) return { state, error: 'Performer is not on the roster.' };
  const next = clone(state);
  next.schedule[blockId][stageId] = performerId;
  const conflicts = validateSchedule(next.schedule);
  return { state: next, error: null, conflicts };
}

export function unassignSchedule(state, blockId, stageId) {
  const next = clone(state);
  if (next.schedule[blockId]) delete next.schedule[blockId][stageId];
  return { state: next, error: null };
}

// Only one campaign may run at a time (non-stacking, per the kickoff doc's
// ad-campaign pattern), and each campaign kind has its own cooldown after it
// finishes — both checked here rather than left to the UI, so a stale
// button click can't sneak a second campaign in.
export function launchCampaign(state, campaignId) {
  const campaign = campaignById(campaignId);
  if (!campaign) return { state, error: 'Unknown campaign.' };
  if (!isSeasonUnlocked(state, campaign.unlockSeason)) {
    return { state, error: `${campaign.name} unlocks in Weekend ${campaign.unlockSeason}.` };
  }
  if (state.activeCampaign) return { state, error: `${state.activeCampaign.name} is still running \u2014 wait for it to finish.` };
  const cooldown = state.campaignCooldowns[campaignId] || 0;
  if (cooldown > 0) return { state, error: `${campaign.name} needs ${cooldown} more day${cooldown === 1 ? '' : 's'} before it can run again.` };
  if (state.cash < campaign.cost) return { state, error: `Not enough cash (need $${campaign.cost}).` };
  const next = clone(state);
  next.cash -= campaign.cost;
  next.activeCampaign = {
    id: campaign.id,
    name: campaign.name,
    attendanceMult: campaign.attendanceMult,
    daysRemaining: campaign.durationDays,
    cooldownDays: campaign.cooldownDays,
  };
  return { state: next, error: null };
}

export function setTicketPrice(state, price) {
  const clamped = Math.max(CONFIG.ticketPrice.min, Math.min(CONFIG.ticketPrice.max, Math.round(price)));
  const next = clone(state);
  next.ticketPrice = clamped;
  return { state: next, error: null };
}

// ---------- day resolution ----------
export function runDay(state, seed = Date.now() ^ (state.day * 7919)) {
  const result = simulateDay(state, seed);
  const next = clone(state);
  next.cash += result.cashDelta;
  next.reputation = Math.max(0, Math.min(100, next.reputation + result.reputationDelta));
  next.lastResult = result;
  next.history.push(result);
  next.phase = 'report';
  return { state: next, result };
}

// Stage 6: a weekend is CONFIG.seasonLength days (Fri/Sat/Sun). Every day
// that passes still ticks contracts/campaigns exactly as before, but when
// the day that just finished was the LAST day of the weekend, nextDay stops
// short of actually advancing day/weekendDay/season — it parks in a new
// 'weekendEnd' phase instead, so the UI can show a weekend summary. The
// player then calls startNextWeekend() to actually roll over into the next
// weekend. This keeps "one tick per elapsed day" happening exactly once per
// nextDay() call (no double-ticking) while still giving the season boundary
// its own beat.
export function nextDay(state) {
  const next = clone(state);
  next.lastResult = null;

  // Tick down any active performer commitments (Weekend Package/Season
  // Contract) — this only shortens how much longer breaking the deal would
  // cost a cancellation fee; it never removes the performer from the roster.
  for (const id of Object.keys(next.contracts)) {
    const contract = next.contracts[id];
    if (contract.commitDaysRemaining > 0) contract.commitDaysRemaining -= 1;
  }
  // Stage 7: vendor contracts tick down exactly the same way.
  for (const id of Object.keys(next.vendorContracts)) {
    const contract = next.vendorContracts[id];
    if (contract.commitDaysRemaining > 0) contract.commitDaysRemaining -= 1;
  }

  // Tick down any existing cooldowns first, then resolve the active
  // campaign (if any) — a campaign that expires today starts its own fresh
  // cooldown below, and that fresh value must NOT get decremented again in
  // this same call.
  for (const id of Object.keys(next.campaignCooldowns)) {
    const remaining = next.campaignCooldowns[id] - 1;
    if (remaining <= 0) delete next.campaignCooldowns[id];
    else next.campaignCooldowns[id] = remaining;
  }
  if (next.activeCampaign) {
    next.activeCampaign.daysRemaining -= 1;
    if (next.activeCampaign.daysRemaining <= 0) {
      next.campaignCooldowns[next.activeCampaign.id] = next.activeCampaign.cooldownDays;
      next.activeCampaign = null;
    }
  }

  if (next.weekendDay >= CONFIG.seasonLength) {
    // Today was the weekend's last day — hold here for the summary screen
    // rather than silently rolling into a new weekend. day/weekendDay/season
    // only advance once the player confirms via startNextWeekend().
    next.phase = 'weekendEnd';
    return { state: next };
  }

  next.day += 1;
  next.weekendDay += 1;
  next.phase = 'plan';
  // roster, built plots, hired vendors, ticket price, and schedule all
  // persist day-to-day on purpose — replanning from zero every day would
  // make a multi-day run tedious. See HANDOFF.md backlog for a "reset
  // schedule each weekend" toggle if that turns out to be too sticky.
  return { state: next };
}

// Rolls the game over into the next weekend once the player has seen the
// weekend-end summary. No contract/campaign ticking happens here — that
// already happened, once, in the nextDay() call that produced the
// 'weekendEnd' phase. This just advances the day/weekendDay/season counters
// and returns to the plan phase.
export function startNextWeekend(state) {
  const next = clone(state);
  next.day += 1;
  next.weekendDay = 1;
  next.season += 1;
  next.phase = 'plan';
  return { state: next };
}

// ---------- persistence ----------
export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.cash !== 'number' || typeof parsed.day !== 'number') return null;
    if (typeof parsed.season !== 'number') parsed.season = 1; // pre-Stage-6 save
    if (!parsed.vendorContracts) parsed.vendorContracts = {}; // pre-Stage-7 save
    if (typeof parsed.nextPlotId !== 'number') parsed.nextPlotId = 1; // pre-Stage-10 save

    // Stage 10: planning/build status + per-plot vendor seating are new
    // fields. Every pre-existing plot was, functionally, already "built"
    // the instant it was placed (the old buildPlot charged immediately), so
    // migrate straight to status:'built' rather than dropping it back into
    // planning limbo. assignedVendorId defaults to null on food/vendor
    // plots that predate the field.
    let needsAutoSeat = false;
    parsed.builtPlots = (parsed.builtPlots || []).map(p => {
      // Stage 12: every plot from before this stage was built 1x1 — even a
      // stage, since footprint didn't exist yet — so a missing w/h always
      // backfills to 1, never to the current (now 2x2) STRUCTURE_TYPES
      // footprint. Reshaping an old stage to 2x2 on load could suddenly
      // overlap something the player already built right next to it.
      const withStatus = { customName: false, w: 1, h: 1, ...p, status: p.status || 'built' };
      if ((withStatus.kind === 'food' || withStatus.kind === 'vendor') && withStatus.assignedVendorId === undefined) {
        withStatus.assignedVendorId = null;
        needsAutoSeat = true;
      }
      return withStatus;
    });
    if (needsAutoSeat) {
      // Seat already-hired vendors into already-built stalls so a save from
      // before Stage 10 keeps earning exactly what it did before, without
      // the player having to manually reseat everyone on first load.
      const stallsByKind = { food: [], vendor: [] };
      for (const p of parsed.builtPlots) {
        if ((p.kind === 'food' || p.kind === 'vendor') && p.status === 'built') stallsByKind[p.kind].push(p);
      }
      const seated = new Set();
      for (const vendorId of parsed.hiredVendors || []) {
        const vendor = vendorById(vendorId);
        if (!vendor || seated.has(vendorId)) continue;
        const kind = STALL_KIND_BY_VENDOR_TYPE[vendor.type];
        const openPlot = stallsByKind[kind] && stallsByKind[kind].find(p => !p.assignedVendorId);
        if (openPlot) { openPlot.assignedVendorId = vendorId; seated.add(vendorId); }
      }
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  return createInitialState();
}
