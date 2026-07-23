// state.js — the single game-state object and the actions that change it.
// Deliberately framework-agnostic: every action takes a state and returns a
// NEW state (no in-place mutation), so ui.js can just re-render after every
// action and tests can assert on plain objects.

import { CONFIG, TIME_BLOCKS, STRUCTURE_TYPES, AD_CAMPAIGNS, CONTRACT_OPTIONS } from './data.js';
import { simulateDay, performerById, vendorById, campaignById, validateSchedule, terrainAt, quoteBuild, isSeasonUnlocked, isWithinCurrentGrid } from './engine.js';

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
export function buildPlot(state, kind, x, y) {
  if (!STRUCTURE_TYPES[kind]) return { state, error: 'Unknown structure type.' };
  if (!isWithinCurrentGrid(state, x, y)) {
    return { state, error: 'That spot is past the fence line \u2014 expand the grounds first.' };
  }
  const quote = quoteBuild(kind, x, y);
  if (!quote) return { state, error: 'Nothing can be built there.' };
  if (state.builtPlots.some(p => p.x === x && p.y === y)) return { state, error: 'Something is already built there.' };
  if (state.cash < quote.cost) return { state, error: `Not enough cash (need $${quote.cost}).` };
  const next = clone(state);
  next.cash -= quote.cost;
  const plot = { id: `${x}_${y}`, kind, x, y, name: quote.name, cost: quote.cost };
  if (kind === 'stage') plot.capacity = quote.capacity;
  next.builtPlots.push(plot);
  return { state: next, error: null };
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
export function hireVendor(state, vendorId, contractId = 'open') {
  const vendor = vendorById(vendorId);
  if (!vendor) return { state, error: 'Unknown vendor.' };
  if (state.hiredVendors.includes(vendorId)) return { state, error: 'Already hired.' };
  const vendorPlotsBuilt = state.builtPlots.filter(p => p.kind === 'food' || p.kind === 'vendor').length;
  if (state.hiredVendors.length >= vendorPlotsBuilt) return { state, error: 'Build a stall plot first — no open stalls.' };
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
    return parsed;
  } catch (e) {
    return null;
  }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  return createInitialState();
}
