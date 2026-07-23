// state.js — the single game-state object and the actions that change it.
// Deliberately framework-agnostic: every action takes a state and returns a
// NEW state (no in-place mutation), so ui.js can just re-render after every
// action and tests can assert on plain objects.

import { CONFIG, TIME_BLOCKS, GRID, STRUCTURE_TYPES } from './data.js';
import { simulateDay, performerById, vendorById, validateSchedule, terrainAt, quoteBuild } from './engine.js';

const SAVE_KEY = 'renn-faire-sim-save-v1';

export function createInitialState() {
  return {
    day: 1,
    weekendDay: 1, // 1=Fri, 2=Sat, 3=Sun (labeling only; the loop itself doesn't hard-stop)
    cash: CONFIG.startingCash,
    reputation: CONFIG.startingReputation,
    ticketPrice: CONFIG.ticketPrice.start,
    builtPlots: [],
    roster: [],
    hiredVendors: [],
    schedule: Object.fromEntries(TIME_BLOCKS.map(b => [b.id, {}])),
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
    hiredVendors: [...state.hiredVendors],
    schedule: Object.fromEntries(Object.entries(state.schedule).map(([k, v]) => [k, { ...v }])),
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
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID.cols || y >= GRID.rows) {
    return { state, error: 'That spot is off the grounds.' };
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

export function contractPerformer(state, performerId) {
  const perf = performerById(performerId);
  if (!perf) return { state, error: 'Unknown performer.' };
  if (state.roster.includes(performerId)) return { state, error: 'Already contracted.' };
  const next = clone(state);
  next.roster.push(performerId);
  return { state: next, error: null };
}

export function releasePerformer(state, performerId) {
  const next = clone(state);
  next.roster = next.roster.filter(id => id !== performerId);
  // pull them out of the schedule too
  for (const blockId of Object.keys(next.schedule)) {
    for (const stageId of Object.keys(next.schedule[blockId])) {
      if (next.schedule[blockId][stageId] === performerId) delete next.schedule[blockId][stageId];
    }
  }
  return { state: next, error: null };
}

export function hireVendor(state, vendorId) {
  const vendor = vendorById(vendorId);
  if (!vendor) return { state, error: 'Unknown vendor.' };
  if (state.hiredVendors.includes(vendorId)) return { state, error: 'Already hired.' };
  const vendorPlotsBuilt = state.builtPlots.filter(p => p.kind === 'food' || p.kind === 'vendor').length;
  if (state.hiredVendors.length >= vendorPlotsBuilt) return { state, error: 'Build a stall plot first — no open stalls.' };
  const next = clone(state);
  next.hiredVendors.push(vendorId);
  return { state: next, error: null };
}

export function fireVendor(state, vendorId) {
  const next = clone(state);
  next.hiredVendors = next.hiredVendors.filter(id => id !== vendorId);
  return { state: next, error: null };
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

export function nextDay(state) {
  const next = clone(state);
  next.day += 1;
  next.weekendDay = ((next.weekendDay % 3) + 1);
  next.phase = 'plan';
  next.lastResult = null;
  // roster, built plots, hired vendors, ticket price, and schedule all
  // persist day-to-day on purpose — replanning from zero every day would
  // make a multi-day run tedious. See HANDOFF.md backlog for a "reset
  // schedule each weekend" toggle if that turns out to be too sticky.
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
    return parsed;
  } catch (e) {
    return null;
  }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  return createInitialState();
}
