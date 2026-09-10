// state.js — the single game-state object and the actions that change it.
// Deliberately framework-agnostic: every action takes a state and returns a
// NEW state (no in-place mutation), so ui.js can just re-render after every
// action and tests can assert on plain objects.

import { CONFIG, TIME_BLOCKS, STRUCTURE_TYPES, AD_CAMPAIGNS, CONTRACT_OPTIONS, DEFAULT_WEATHER_ID, RELATIONSHIP, CARRYOVER } from './data.js';
import { simulateDay, performerById, vendorById, campaignById, validateSchedule, terrainAt, quoteBuild, isSeasonUnlocked, isLegalPlacement, isFootprintWithinCurrentGrid, footprintFor, STALL_KIND_BY_VENDOR_TYPE, previewCommitAll, checkBankruptcy, checkWinCondition, rollWeather, quoteContract, offerDiscount, relationshipOf, beatById, pendingBeats, clamp, summarizeWeekend, weekendRenown, moodRenown, signingBar, nextRunSeed, contractedActIds, crewById } from './engine.js';
// Relative, not "/assets/js/gvb-save.js": tests/smoke.mjs imports this module
// under plain Node, which cannot resolve a leading slash. The relative form
// resolves identically in the browser (v7 §1 documented the same trap for
// fourth-quarter's campaign.js).
import { createSaveSlot } from '../../../assets/js/gvb-save.js';

const SAVE_KEY = 'renn-faire-sim-save-v1';

// The weather seed anything that did not ask for one gets: a save written
// before Phase 2, and every state createInitialState() builds without an
// explicit seed. Any constant would do; what matters is that it IS a
// constant. createInitialState() drawing a seed off the clock was written
// first and the suite refused it inside a minute (#232): two fresh states
// built one millisecond apart got different skies, so a test holding
// everything but a stall's gate distance equal was comparing two different
// days — and would have passed most runs, which is worse than failing.
// newGame() below is the one function that draws a real one.
export const DEFAULT_WEATHER_SEED = 0x0FA13E00;

// Deterministic given its argument, and the argument defaults to a
// constant — calling this twice in one process gives two identical states,
// which most of tests/smoke.mjs quietly depends on. newGame() is where a
// real playthrough's season comes from.
export function createInitialState(weatherSeed = DEFAULT_WEATHER_SEED) {
  const seed = (weatherSeed ?? DEFAULT_WEATHER_SEED) >>> 0;
  return {
    // Phase 2: one weather seed per save, drawn once and never again, so a
    // playthrough gets the same weather every time it is reloaded and the
    // forecast cannot be rerolled by pressing F5.
    weatherSeed: seed,
    // Today's weather, stamped at the top of the day rather than rolled
    // when the gates open (#231). Day 1 of weekend 1 is stamped here for
    // the same reason nextDay/startNextWeekend stamp theirs: the player has
    // to be able to plan against it.
    weather: rollWeather(seed, 1, 1).id,
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
    // Phase 7: the third payroll. Same two shapes the roster and the vendor
    // list already use, signed through the same CONTRACT_OPTIONS deals, and
    // both additive so repair fills them for any save written before this.
    crew: [], // crew ids on the payroll
    crewContracts: {}, // crewId -> { contractId, dailyCost, commitDaysRemaining, cancelFeeMult, label }
    schedule: Object.fromEntries(TIME_BLOCKS.map(b => [b.id, {}])),
    activeCampaign: null, // { id, name, attendanceMult, daysRemaining, cooldownDays } or null
    campaignCooldowns: {}, // campaignId -> days remaining before it can be relaunched
    phase: 'plan', // 'plan' -> 'report' -> 'plan' ...
    lastResult: null,
    history: [], // array of past simulateDay() results, oldest first
    nextPlotId: 1, // Stage 10: counter for placePlot's ids, decoupled from (x,y) so relocating a plot never orphans its schedule/assignment references
    bankrupt: false, // Stage 16: set true by runDay() the moment cash crosses CONFIG.bankruptcyFloor; nextDay() reads it once, on the player's next click, to route to the 'gameOver' phase
    victoryAchieved: false, // Stage 16: set true the first time checkWinCondition() passes at a weekend boundary, so the milestone only fires once per save
    // Phase 3: acts with a story. All three additive, all filled by repair.
    relationships: {}, // performer/vendor id -> 0..100, written at signing and moved by runDay; absent reads as RELATIONSHIP.neutral
    arcBeats: {}, // beat id -> choice id, once resolved; a resolved beat never fires again on this save
    actTraits: {}, // performer/vendor id -> { popularity?, quality?, quirk?, rateMult? } laid over the catalog by performerFor/vendorFor
    // Phase 4: a faire that outlives its season. renown and carryover are
    // the first fields a pre-Phase-4 save reaches through migrate rather
    // than repair (see migrateSave below); tenure, demolished and
    // lastRenown are ordinary content drift and repair fills them.
    renown: 0, // the second track; earned at each weekend boundary by engine.js's weekendRenown, carried whole across a closed season
    carryover: emptyCarryover(), // { schema, run, seasons, startedWith } — see data.js's CARRYOVER
    tenure: {}, // performer/vendor id -> weekends held under contract without a break; ticked at the boundary, deleted with the act
    demolished: 0, // built plots torn down this run; the "nothing torn down" renown line reads it
    lastRenown: null, // the most recent weekend's { lines, total }, for the weekend-end screen
  };
}

// A first run's carryover record: nothing closed yet, and it opened on the
// configured starting numbers.
export function emptyCarryover() {
  return {
    schema: CARRYOVER.schema,
    run: 1,
    seasons: [],
    startedWith: { cash: CONFIG.startingCash, reputation: CONFIG.startingReputation, renown: 0 },
  };
}

// A brand-new game with a season of its own. The one impure thing in this
// module, and it is impure in exactly the way runDay()'s default seed
// argument already is: the clock decides, once, and everything downstream
// is a pure function of what it decided. main.js calls this when there is
// no save to load, and it is the `defaults` factory the save slot resets
// through, so wiping a save starts a new season rather than replaying the
// constant one.
export function newGame() {
  return createInitialState((Date.now() ^ 0x5BD1E995) >>> 0);
}

function clone(state) {
  return {
    ...state,
    builtPlots: state.builtPlots.map(p => ({ ...p })),
    roster: [...state.roster],
    contracts: Object.fromEntries(Object.entries(state.contracts).map(([k, v]) => [k, { ...v }])),
    hiredVendors: [...state.hiredVendors],
    vendorContracts: Object.fromEntries(Object.entries(state.vendorContracts).map(([k, v]) => [k, { ...v }])),
    crew: [...(state.crew || [])],
    crewContracts: Object.fromEntries(Object.entries(state.crewContracts || {}).map(([k, v]) => [k, { ...v }])),
    schedule: Object.fromEntries(Object.entries(state.schedule).map(([k, v]) => [k, { ...v }])),
    activeCampaign: state.activeCampaign ? { ...state.activeCampaign } : null,
    campaignCooldowns: { ...state.campaignCooldowns },
    history: [...state.history],
    relationships: { ...(state.relationships || {}) },
    arcBeats: { ...(state.arcBeats || {}) },
    actTraits: Object.fromEntries(Object.entries(state.actTraits || {}).map(([k, v]) => [k, { ...v }])),
    tenure: { ...(state.tenure || {}) },
    carryover: cloneCarryover(state.carryover),
    lastRenown: state.lastRenown ? { total: state.lastRenown.total, lines: (state.lastRenown.lines || []).map(l => ({ ...l })) } : null,
  };
}
function cloneCarryover(co) {
  if (!co) return emptyCarryover();
  return {
    ...co,
    seasons: (co.seasons || []).map(r => ({ ...r })),
    startedWith: { ...(co.startedWith || {}) },
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
  const quote = quoteBuild(kind, x, y, state.builtPlots);
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
  const quote = quoteBuild(kind, x, y, state.builtPlots);
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

// Stage 15: a planning plot's stored `cost` was only ever an estimate taken
// at placePlot time — since escalating build cost prices off how many
// *built* same-kind plots exist, and only built ones count, that estimate
// can go stale if other same-kind plots get built (or committed) in the
// meantime. commitPlot always re-quotes against the live builtPlots list
// right before charging, so the price charged matches the live "Commit —
// $X" number the UI shows (ui.js's renderPlotCard re-quotes the same way),
// not whatever was true back when the plot was first placed.
export function commitPlot(state, plotId) {
  const plot = state.builtPlots.find(p => p.id === plotId);
  if (!plot) return { state, error: 'No such plot.' };
  if (plot.status !== 'planning') return { state, error: 'That plot is already built.' };
  const quote = quoteBuild(plot.kind, plot.x, plot.y, state.builtPlots);
  const cost = quote ? quote.cost : plot.cost;
  if (state.cash < cost) return { state, error: `Not enough cash (need $${cost}).` };
  const next = clone(state);
  next.cash -= cost;
  const np = next.builtPlots.find(p => p.id === plotId);
  np.status = 'built';
  np.cost = cost;
  return { state: next, error: null };
}

// Bulk convenience for exactly the scenario that caused the original soft
// lock: several stalls placed in one sitting. All-or-nothing rather than
// partial, so the player always knows exactly what they paid for in one
// glance rather than having to work out which subset got skipped.
// Stage 15: several planning plots of the *same* kind committed together
// must escalate against each other in commit order (list order here) —
// otherwise a player could sidestep the whole escalating-cost mechanic by
// planning a cluster of, say, five stages before committing any of them,
// since every one of those quotes would've been taken while zero stages
// were yet built. A scratch pass (a shallow copy of builtPlots, flipping
// each committed plot to 'built' as it goes) works out the real total
// first, without touching real cash/state, so an unaffordable batch is
// still rejected up front exactly like before.
export function commitAllPlots(state) {
  const planningIds = state.builtPlots.filter(p => p.status === 'planning').map(p => p.id);
  if (planningIds.length === 0) return { state, error: 'Nothing is waiting to be committed.', count: 0, total: 0 };
  const { total, costs } = previewCommitAll(state.builtPlots);
  if (state.cash < total) return { state, error: `Not enough cash to commit everything (need $${total}).`, count: 0, total };
  const next = clone(state);
  next.cash -= total;
  for (const id of planningIds) {
    const np = next.builtPlots.find(p => p.id === id);
    np.status = 'built';
    np.cost = costs[id];
  }
  return { state: next, error: null, count: planningIds.length, total };
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
  const quote = quoteBuild(plot.kind, x, y, state.builtPlots, plotId);
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
  // Phase 4: the "nothing torn down" renown line reads this count for the
  // rest of the run. A relocation is not a demolition — the plot is still
  // standing — so relocatePlot does not touch it.
  next.demolished = (next.demolished || 0) + 1;
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
  // Stage 15: exclude this plot's own (already 'built') record from its own
  // relocate quote — otherwise it would count against itself and inflate
  // its own new price by one escalation step for no reason.
  const quote = quoteBuild(plot.kind, x, y, state.builtPlots, plotId);
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
// Phase 3: `contractId` may also be an offer — { commitDays, cancelFeeMult }
// off NEGOTIATION's two lists — and either way the record stored here is
// what engine.js's quoteContract priced, relationship swing and all. The
// contract carries its own cancelFeeMult and label now, so releasePerformer
// and Backstage read the record rather than looking a CONTRACT_OPTIONS row
// back up; a quick-pick contract still names its option id.
function resolveTerms(state, contractId) {
  if (contractId && typeof contractId === 'object') {
    const d = offerDiscount(contractId.commitDays, contractId.cancelFeeMult);
    if (!d) return { error: 'Those terms are not on offer.' };
    if (!isSeasonUnlocked(state, d.commitment.unlockSeason)) {
      return { error: `A ${d.commitment.label.toLowerCase()} commitment unlocks in Weekend ${d.commitment.unlockSeason}.` };
    }
    return { terms: { commitDays: d.commitment.days, cancelFeeMult: d.fee.mult } };
  }
  const option = CONTRACT_OPTIONS[contractId];
  if (!option) return { error: 'Unknown contract type.' };
  if (!isSeasonUnlocked(state, option.unlockSeason)) {
    return { error: `${option.label} unlocks in Weekend ${option.unlockSeason}.` };
  }
  return { terms: option };
}

export function contractPerformer(state, performerId, contractId = 'open') {
  const perf = performerById(performerId);
  if (!perf) return { state, error: 'Unknown performer.' };
  if (state.roster.includes(performerId)) return { state, error: 'Already contracted.' };
  // Phase 4: the headliner will not sign for money alone. Checked before
  // any terms are resolved, so no quote is ever made for a refusal.
  const bar = signingBar(state, perf);
  if (bar) return { state, error: `${perf.name} will not sign for money alone \u2014 the faire needs ${bar.need} renown and has ${bar.have}.` };
  const resolved = resolveTerms(state, contractId);
  if (resolved.error) return { state, error: resolved.error };
  const quote = quoteContract(state, 'performer', performerId, resolved.terms);
  const next = clone(state);
  next.roster.push(performerId);
  next.tenure[performerId] = 0; // Phase 4: weekends held; the boundary ticks it
  next.contracts[performerId] = {
    contractId: quote.contractId,
    label: quote.label,
    dailyCost: quote.dailyCost,
    commitDaysRemaining: quote.commitDays,
    cancelFeeMult: quote.cancelFeeMult,
  };
  // A fresh signing starts at neutral. An act released and re-signed starts
  // over too (#235): the record went with them.
  next.relationships[performerId] = RELATIONSHIP.neutral;
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
    // Phase 3: a negotiated contract carries its own fee; a quick-pick one
    // from before this phase still reads its option row.
    const feeMult = typeof contract.cancelFeeMult === 'number' ? contract.cancelFeeMult : (option?.cancelFeeMult || 0);
    fee = Math.round(contract.dailyCost * contract.commitDaysRemaining * feeMult);
    next.cash -= fee;
  }
  delete next.contracts[performerId];
  delete next.relationships[performerId]; // #235: the relationship leaves with them
  delete next.tenure[performerId]; // Phase 4: and so does the tenure
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
  const resolved = resolveTerms(state, contractId);
  if (resolved.error) return { state, error: resolved.error };
  const quote = quoteContract(state, 'vendor', vendorId, resolved.terms);
  const next = clone(state);
  next.hiredVendors.push(vendorId);
  next.vendorContracts[vendorId] = {
    contractId: quote.contractId,
    label: quote.label,
    dailyCost: quote.dailyCost,
    commitDaysRemaining: quote.commitDays,
    cancelFeeMult: quote.cancelFeeMult,
  };
  next.relationships[vendorId] = RELATIONSHIP.neutral;
  next.tenure[vendorId] = 0;
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
    const feeMult = typeof contract.cancelFeeMult === 'number' ? contract.cancelFeeMult : (option?.cancelFeeMult || 0);
    fee = Math.round(contract.dailyCost * contract.commitDaysRemaining * feeMult);
    next.cash -= fee;
  }
  delete next.vendorContracts[vendorId];
  delete next.relationships[vendorId]; // #235
  delete next.tenure[vendorId];
  next.hiredVendors = next.hiredVendors.filter(id => id !== vendorId);
  for (const p of next.builtPlots) if (p.assignedVendorId === vendorId) p.assignedVendorId = null;
  return { state: next, error: null, fee };
}

// ---------- the crew (Phase 7) ----------
// Hiring and releasing a crew member, and deliberately nothing else. They
// ride resolveTerms and quoteContract exactly as a performer or a vendor
// does, so a Weekend Package on the gate crew is the same deal shape and
// the same cancellation arithmetic it is on a jouster. What they do NOT get
// is a relationship, an arc or a tenure count (#256): a crew is staff, and
// staff do not have a story the faire tends. quoteContract's relationship
// swing reads neutral for them and multiplies by exactly 1.
export function contractCrew(state, crewId, contractId = 'open') {
  const member = crewById(crewId);
  if (!member) return { state, error: 'Unknown crew.' };
  if ((state.crew || []).includes(crewId)) return { state, error: 'Already on the payroll.' };
  if (!isSeasonUnlocked(state, member.unlockSeason)) {
    return { state, error: `${member.name} is not available until Weekend ${member.unlockSeason}.` };
  }
  const resolved = resolveTerms(state, contractId);
  if (resolved.error) return { state, error: resolved.error };
  const quote = quoteContract(state, 'crew', crewId, resolved.terms);
  const next = clone(state);
  next.crew.push(crewId);
  next.crewContracts[crewId] = {
    contractId: quote.contractId,
    label: quote.label,
    dailyCost: quote.dailyCost,
    commitDaysRemaining: quote.commitDays,
    cancelFeeMult: quote.cancelFeeMult,
  };
  return { state: next, error: null };
}

// Mirrors releasePerformer and fireVendor: free on a day rate or once the
// commitment has run out, a fee against the days still owed otherwise.
export function releaseCrew(state, crewId) {
  const next = clone(state);
  const contract = next.crewContracts[crewId];
  let fee = 0;
  if (contract && contract.commitDaysRemaining > 0) {
    const option = CONTRACT_OPTIONS[contract.contractId];
    const feeMult = typeof contract.cancelFeeMult === 'number' ? contract.cancelFeeMult : (option?.cancelFeeMult || 0);
    fee = Math.round(contract.dailyCost * contract.commitDaysRemaining * feeMult);
    next.cash -= fee;
  }
  delete next.crewContracts[crewId];
  next.crew = next.crew.filter(id => id !== crewId);
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
  // Phase 3: what the day did to each act. simulateDay only reports acts
  // on the roster or in hiredVendors, so nothing here can resurrect a
  // relationship #235 says leaves with a released act; a guard for that
  // was written and then deleted, because no break could reach it (#34).
  for (const [id, r] of Object.entries(result.relationships || {})) {
    next.relationships[id] = clamp(relationshipOf(next, id) + r.delta, RELATIONSHIP.min, RELATIONSHIP.max);
  }
  // Stage 16: flag bankruptcy the moment it happens, but still show today's
  // report ticket as normal — the player sees what went wrong before the
  // run actually ends. nextDay() checks this flag first and routes to the
  // 'gameOver' phase instead of continuing, the next time they click on.
  next.bankrupt = checkBankruptcy(next.cash);
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
  // Stage 16: a day that just crossed the bankruptcy floor (flagged by
  // runDay) ends the run the moment the player moves on from that day's
  // report — no further contract/campaign ticking, no new day. Checked
  // before cloning-and-continuing so a bankrupt state can never sneak
  // through into 'weekendEnd'/'plan'.
  if (state.bankrupt) {
    const next = clone(state);
    next.phase = 'gameOver';
    return { state: next };
  }

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
  // Phase 7: and so do crew contracts. Crew take no tenure and earn no
  // renown (#256) — a weekend held is an act's story, not a gatekeeper's —
  // so this loop is the whole of what the boundary does to them.
  for (const id of Object.keys(next.crewContracts)) {
    const contract = next.crewContracts[id];
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
    // Phase 4: the weekend just closed counts toward every act still under
    // contract, and then the weekend earns its renown. Tenure ticks first
    // so an act signed on Weekend 1's Friday reads as kept a third weekend
    // at the close of Weekend 3, not Weekend 4. The award is applied here
    // and nowhere else, so a reload on the weekend-end screen cannot earn
    // it twice (the phase is on disk, #45).
    for (const id of contractedActIds(next)) next.tenure[id] = (next.tenure[id] || 0) + 1;
    const award = weekendRenown(next, summarizeWeekend(next.history, CONFIG.seasonLength));
    next.renown = (next.renown || 0) + award.total;
    next.lastRenown = award;
    // Stage 16: check the win condition right at this same boundary, before
    // the weekend-end summary shows. Only ever fires once per save (guarded
    // by victoryAchieved) — acknowledgeVictory() below drops back into the
    // normal 'weekendEnd' phase afterward, so hitting the milestone doesn't
    // interrupt the sandbox, just celebrates it once.
    if (!next.victoryAchieved && checkWinCondition(next)) {
      next.victoryAchieved = true;
      next.phase = 'victory';
    }
    return { state: next };
  }

  next.day += 1;
  next.weekendDay += 1;
  next.weather = rollWeather(next.weatherSeed, next.season, next.weekendDay).id;
  next.phase = 'plan';
  // roster, built plots, hired vendors, ticket price, and schedule all
  // persist day-to-day on purpose — replanning from zero every day would
  // make a multi-day run tedious. See WISHLIST.md's standing backlog for a "reset
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
  // Same stamp as nextDay's, and the two together are exactly what
  // engine.js's nextCalendarDay models — the forecast shown on the Office
  // desk yesterday is this line's output, or the forecast was lying.
  next.weather = rollWeather(next.weatherSeed, next.season, next.weekendDay).id;
  next.phase = 'plan';
  return { state: next };
}

// Stage 16: dismisses the one-time victory banner and drops into the
// normal weekend-end summary screen — the save, cash, reputation, and
// victoryAchieved flag are all untouched, so the milestone can't refire
// and the player picks up exactly where the sandbox left off.
export function acknowledgeVictory(state) {
  const next = clone(state);
  next.phase = 'weekendEnd';
  return { state: next };
}

// ---------- the run boundary (Phase 4) ----------
// Whether the season can be closed from here: only from the weekend-end
// desk (or the victory screen that sits in front of it), and only once the
// season has run its CONFIG.winCondition.seasonTarget weekends. A run that
// missed the win still closes — the record says so — because a faire that
// outlives its season is the point, not a prize for the win alone.
export function canCloseSeason(state) {
  if (state.phase !== 'weekendEnd' && state.phase !== 'victory') return { ok: false, reason: 'The season closes from the weekend-end desk.' };
  const target = CONFIG.winCondition.seasonTarget;
  if (state.season < target) return { ok: false, reason: `A season runs ${target} weekends; this is Weekend ${state.season}.` };
  return { ok: true };
}

// The one record a closed season leaves. Pure, and exported so the ledger
// screens can show exactly what closeSeason is about to bank.
export function seasonRecord(state) {
  const co = state.carryover || emptyCarryover();
  const history = state.history || [];
  return {
    run: co.run,
    weekends: state.season,
    days: history.length,
    attendance: history.reduce((s, d) => s + (d.attendance || 0), 0),
    net: history.reduce((s, d) => s + (d.cashDelta || 0), 0),
    cash: Math.round(state.cash),
    reputation: Math.round(state.reputation),
    renown: state.renown || 0,
    renownEarned: (state.renown || 0) - ((co.startedWith && co.startedWith.renown) || 0),
    won: !!state.victoryAchieved,
    plots: (state.builtPlots || []).filter(p => p.status === 'built').length,
    beats: Object.keys(state.arcBeats || {}).length,
  };
}

// What the next run opens with, before it exists. Pure, read by the ledger
// screens and by closeSeason itself so the two cannot disagree.
export function carryoverPreview(state) {
  const co = state.carryover || emptyCarryover();
  return {
    run: co.run + 1,
    cash: CONFIG.startingCash,
    // Half of what stood above the starting reputation carries, never
    // less than the start. "Half the closing number, floored at the start"
    // was written first and carried nothing for any faire that could win:
    // the start is 50 and half of a Legendary 82 is 41.
    reputation: CONFIG.startingReputation + Math.max(0, Math.round((state.reputation - CONFIG.startingReputation) * CARRYOVER.reputationKeep)),
    renown: state.renown || 0,
    beats: Object.keys(state.arcBeats || {}).length,
  };
}

// End the season deliberately. Banks this run's record onto the carryover,
// and returns a fresh run that keeps exactly what data.js's CARRYOVER says
// crosses: renown whole, reputation at half, the acts' stories. Everything
// else starts over. The next run's weather seed is derived from this one's
// (engine.js's nextRunSeed) rather than drawn off the clock, so the action
// is as pure as every other in this file and a test can replay it.
export function closeSeason(state) {
  const can = canCloseSeason(state);
  if (!can.ok) return { state, error: can.reason };
  const co = state.carryover || emptyCarryover();
  const record = seasonRecord(state);
  const opens = carryoverPreview(state);
  const next = createInitialState(nextRunSeed(state.weatherSeed, opens.run));
  next.reputation = opens.reputation;
  next.renown = opens.renown;
  next.arcBeats = { ...(state.arcBeats || {}) };
  next.actTraits = Object.fromEntries(Object.entries(state.actTraits || {}).map(([k, v]) => [k, { ...v }]));
  next.carryover = {
    schema: CARRYOVER.schema,
    run: opens.run,
    seasons: [...(co.seasons || []).map(r => ({ ...r })), record],
    startedWith: { cash: opens.cash, reputation: opens.reputation, renown: opens.renown },
  };
  return { state: next, error: null, record };
}

// ---------- arc beats (Phase 3) ----------
// The one writer of state.arcBeats and state.actTraits. Refuses a beat that
// is not actually pending (wrong tier, already resolved, subject released)
// and a choice the beat does not offer, before any number moves. Each
// effect key is read here and nowhere else — see data.js's ARCS for what
// each one means. A rate change re-prices the standing contract in place
// as well as future ones, so "raise his rate a fifth" costs a fifth more
// tomorrow, not after the next signing.
export function resolveBeat(state, beatId, choiceId) {
  const found = beatById(beatId);
  if (!found) return { state, error: 'Unknown beat.' };
  const { arc, beat } = found;
  if (!pendingBeats(state).some(p => p.beat.id === beatId)) return { state, error: 'That moment has passed.' };
  const choice = beat.choices.find(c => c.id === choiceId);
  if (!choice) return { state, error: 'That is not one of the choices.' };
  const id = arc.subject;
  const next = clone(state);
  const traits = { ...(next.actTraits[id] || {}) };
  if (typeof choice.cash === 'number') next.cash += choice.cash;
  if (typeof choice.relationship === 'number') {
    next.relationships[id] = clamp(relationshipOf(next, id) + choice.relationship, RELATIONSHIP.min, RELATIONSHIP.max);
  }
  if (typeof choice.popularity === 'number') traits.popularity = (traits.popularity || 0) + choice.popularity;
  if (typeof choice.quality === 'number') traits.quality = (traits.quality || 0) + choice.quality;
  if ('quirk' in choice) traits.quirk = choice.quirk;
  if (typeof choice.rateMult === 'number') {
    traits.rateMult = (traits.rateMult || 1) * choice.rateMult;
    const contract = next.contracts[id] || next.vendorContracts[id];
    if (contract) contract.dailyCost = Math.round(contract.dailyCost * choice.rateMult);
  }
  next.actTraits[id] = traits;
  next.arcBeats[beat.id] = choice.id;
  return { state: next, error: null, choice, beat, subjectId: id };
}

// ---------- persistence ----------
// Stage 22: adopted assets/js/gvb-save.js, replacing the hand-rolled
// localStorage calls this used to make directly. Key is unchanged (locked
// decision #36) — an existing save carries no `__v`, which gvb-save reads
// as version 0 and sends through repair() below rather than migrate().

/** The gate on garbage: lifted unchanged from the old loadState(). */
function validateSave(s) {
  return !!s && typeof s.cash === 'number' && typeof s.day === 'number';
}

/**
 * Everything else the old loadState() filled in, moved here unchanged.
 * Locked decision #50: this is content drift (fields/shape added to the
 * game since a save was written), not schema drift, so it belongs in
 * repair — it has to run on every accepted load regardless of what __v
 * says, exactly like it always ran regardless of what an old save's
 * (nonexistent) version field said. migrate() stays the default no-op;
 * there is no version-specific reshaping here, only fill-in-the-gaps.
 */
/**
 * Phase 4: the first real migration this game has had, and the one place
 * migrate stops being a no-op. It runs only when the stored version is not
 * the current one (gvb-save's contract), which for this project means a
 * save written before Phase 4: version 1 from Stage 22 on, or no `__v` at
 * all (read as 0) from before that. Both are "before the carryover".
 *
 * What it does that repair could not: it tallies the renown the save's
 * completed weekends would have earned, off the history they already
 * carry. That is a one-time reshaping of old data into the new field —
 * exactly what #37 says migrate is for — and it must not run on every
 * load, because a second pass would overwrite renown earned since. Only
 * the mood line is tallied: the other two need tenure and a demolition
 * count, neither of which an old save recorded, and guessing at them would
 * be inventing a history rather than reading one.
 *
 * Nothing the old save carried is touched. The migration test asserts
 * every original key comes through equal.
 */
function migrateSave(parsed, from) {
  if (from < 2) {
    parsed.carryover = emptyCarryover();
    const history = Array.isArray(parsed.history) ? parsed.history : [];
    const per = CONFIG.seasonLength;
    let renown = 0;
    for (let start = 0; start + per <= history.length; start += per) {
      const line = moodRenown(summarizeWeekend(history.slice(start, start + per), per));
      if (line) renown += line.points;
    }
    parsed.renown = renown;
  }
  return parsed;
}

function repairSave(parsed) {
  if (typeof parsed.season !== 'number') parsed.season = 1; // pre-Stage-6 save
  if (!parsed.vendorContracts) parsed.vendorContracts = {}; // pre-Stage-7 save
  if (typeof parsed.nextPlotId !== 'number') parsed.nextPlotId = 1; // pre-Stage-10 save
  if (typeof parsed.bankrupt !== 'boolean') parsed.bankrupt = false; // pre-Stage-16 save
  if (typeof parsed.victoryAchieved !== 'boolean') parsed.victoryAchieved = false; // pre-Stage-16 save
  // Phase 2: a save written before weather existed has neither field. The
  // seed backfills to a fixed constant rather than Date.now() so that
  // loading such a save twice gives it the same season twice — a seed
  // redrawn on every load would rewrite the forecast under a player who
  // reloaded, which is the one thing the whole calendar-derived design
  // (#231) exists to prevent. The day itself defaults to 'fair', which is
  // neutral on all three multipliers, exactly as WEEKEND_DAY_ATTENDANCE
  // falls back to 1 for a state that never set weekendDay.
  if (typeof parsed.weatherSeed !== 'number') parsed.weatherSeed = DEFAULT_WEATHER_SEED;
  if (typeof parsed.weather !== 'string') parsed.weather = DEFAULT_WEATHER_ID;
  // Phase 3: a save from before the acts had a story. Every act it has
  // under contract starts at neutral — the same number a fresh signing gets
  // — and nothing has been resolved or changed. Written out explicitly
  // rather than left to relationshipOf's fallback so the map on disk says
  // what the game will read, and the pre-arc save test can assert it.
  if (!parsed.relationships || typeof parsed.relationships !== 'object') parsed.relationships = {};
  if (!parsed.arcBeats || typeof parsed.arcBeats !== 'object') parsed.arcBeats = {};
  if (!parsed.actTraits || typeof parsed.actTraits !== 'object') parsed.actTraits = {};
  for (const id of [...(parsed.roster || []), ...(parsed.hiredVendors || [])]) {
    if (typeof parsed.relationships[id] !== 'number') parsed.relationships[id] = RELATIONSHIP.neutral;
  }
  // Phase 4. The carryover itself came through migrate for an old save;
  // this is the every-load gap fill for a current-version save with a
  // field missing (a hand-edited localStorage, a truncated write), which
  // is what repair is for. It fills zeros and empties only — it never
  // tallies anything, so it cannot double-count what migrate did.
  if (!parsed.carryover || typeof parsed.carryover !== 'object') parsed.carryover = emptyCarryover();
  if (typeof parsed.carryover.schema !== 'number') parsed.carryover.schema = CARRYOVER.schema;
  if (typeof parsed.carryover.run !== 'number') parsed.carryover.run = 1;
  if (!Array.isArray(parsed.carryover.seasons)) parsed.carryover.seasons = [];
  if (!parsed.carryover.startedWith || typeof parsed.carryover.startedWith !== 'object') parsed.carryover.startedWith = emptyCarryover().startedWith;
  if (typeof parsed.renown !== 'number') parsed.renown = 0;
  if (!parsed.tenure || typeof parsed.tenure !== 'object') parsed.tenure = {};
  for (const id of [...(parsed.roster || []), ...(parsed.hiredVendors || [])]) {
    if (typeof parsed.tenure[id] !== 'number') parsed.tenure[id] = 0;
  }
  if (typeof parsed.demolished !== 'number') parsed.demolished = 0;
  // Phase 7: a save from before the crew existed has an empty payroll and
  // an unstaffed gate, which is exactly what it was playing with. Content
  // drift, filled every load (#37) — there is nothing to tally and nothing
  // to reshape, so it has no business in migrate.
  // One line, not two: written as a missing-field default followed by a
  // separate prune, deleting the default made the prune throw inside the
  // load and the suite caught the break as a crash rather than by name
  // (#34 — a break caught by a stack trace is a break nobody can read).
  parsed.crew = Array.isArray(parsed.crew) ? parsed.crew.filter(id => crewById(id)) : [];
  if (!parsed.crewContracts || typeof parsed.crewContracts !== 'object') parsed.crewContracts = {};
  if (parsed.lastRenown !== null && (typeof parsed.lastRenown !== 'object' || !Array.isArray(parsed.lastRenown.lines))) parsed.lastRenown = null;

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
}

/**
 * Deliberately built fresh on every call rather than cached: this project's
 * own Node smoke suite reassigns globalThis.localStorage per JSDOM boot to
 * simulate separate page loads sharing one storage (or, for most tests, a
 * fresh storage per boot). gvb-save's storage probe only runs at
 * createSaveSlot() construction time, and this module itself is only ever
 * imported once — main.js is what the suite re-imports with a cache-busting
 * query string — so a cached slot would freeze onto whichever localStorage
 * happened to exist the first time any test in the process booted the game,
 * silently breaking every later boot's save. createSaveSlot() just builds
 * closures; building one per call is cheap next to the full re-render every
 * action already does.
 */
function slot(storage) {
  return createSaveSlot({
    game: 'faire-weekend',
    key: SAVE_KEY,
    // Phase 4: 1 -> 2. The key is unchanged (#36); the version is what
    // routes a pre-carryover save through migrateSave once.
    version: 2,
    storage,
    validate: validateSave,
    migrate: migrateSave,
    repair: repairSave,
    // A factory, not a literal (locked decision #47), and Phase 2 made that
    // load-bearing rather than merely tidy: newGame() draws a weather seed
    // off the clock, so a literal would hand every reset for the life of the
    // page the one season that existed when this module was imported.
    defaults: newGame,
  });
}

/** Exposed for main.js to hand to mountSaveBar; pass a stub in tests. */
export function saveSlot(storage) {
  return slot(storage);
}

export function saveState(state) {
  return slot().save(state);
}

export function loadState() {
  return slot().load();
}

export function resetSave() {
  return slot().reset();
}
