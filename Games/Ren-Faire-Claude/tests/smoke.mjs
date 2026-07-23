// tests/smoke.mjs — plain-Node smoke suite. No test framework: a tiny
// assert() counter, same pattern as this account's other JS sims
// (see fourth-quarter's smokeN.js). Run with `npm test` or `node tests/smoke.mjs`.

import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// ---------------------------------------------------------------------
// Section 1: pure engine.js logic (no DOM)
// ---------------------------------------------------------------------
const { makeRng, validateSchedule, simulateDay, QUIRKS, terrainAt, chebyshevDistance, computePlotAttributes, quoteBuild, isLegalPlacement, campaignById, effectivePerformerCost, effectiveVendorCost, isSeasonUnlocked, summarizeWeekend, currentGridSize, nextGridExpansion, isWithinCurrentGrid, effectivePopularity, EVENT_REQUIREMENTS, EVENT_EFFECTS, stallSummary, STALL_KIND_BY_VENDOR_TYPE, footprintFor, footprintCells, plotFootprintCells, isFootprintWithinCurrentGrid, hasPathFrontage } = await import(path.join(root, 'js/engine.js'));
const { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS, PLACEMENT_RULES, EVENT_POOL } = await import(path.join(root, 'js/data.js'));
const State = await import(path.join(root, 'js/state.js'));

// --- RNG determinism ---
{
  const r1 = makeRng(42);
  const r2 = makeRng(42);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  assert(JSON.stringify(seq1) === JSON.stringify(seq2), 'makeRng(seed) is deterministic for the same seed');
  const r3 = makeRng(43);
  assert(r3() !== seq1[0], 'makeRng(seed) differs across different seeds (statistically true, not guaranteed, but should hold here)');
  seq1.forEach(n => assert(n >= 0 && n < 1, 'rng() output stays in [0,1)'));
}

// --- data integrity ---
{
  assert(PERFORMERS.length > 0, 'PERFORMERS is non-empty');
  assert(VENDORS.length > 0, 'VENDORS is non-empty');
  assert(TIME_BLOCKS.length === CONFIG.blocksPerDay, 'TIME_BLOCKS length matches CONFIG.blocksPerDay');
  const perfIds = PERFORMERS.map(p => p.id);
  assert(new Set(perfIds).size === perfIds.length, 'all PERFORMERS ids are unique');
  const vendIds = VENDORS.map(v => v.id);
  assert(new Set(vendIds).size === vendIds.length, 'all VENDORS ids are unique');
  assert(PERFORMERS.every(p => p.quirk === null || QUIRKS[p.quirk]), 'every performer quirk id (if set) exists in QUIRKS');
}

// --- buildable structure catalog integrity (Stage 3) ---
{
  const kinds = Object.keys(STRUCTURE_TYPES);
  assert(kinds.length === 4, 'STRUCTURE_TYPES has the four expected kinds');
  assert(STRUCTURE_TYPES.stage.baseCapacity > 0, 'stage is the only kind with a baseCapacity, and it is positive');
  for (const kind of kinds) {
    assert(STRUCTURE_TYPES[kind].baseCost > 0, `${kind} has a positive baseCost`);
    assert(TERRAIN_NAME && KIND_NOUN[kind], `${kind} has a KIND_NOUN entry for auto-naming`);
  }
  for (const terrainName of Object.values(TERRAIN_LEGEND)) {
    assert(TERRAIN_BUILD_MODIFIERS[terrainName], `terrain "${terrainName}" has a TERRAIN_BUILD_MODIFIERS entry`);
    assert(TERRAIN_NAME[terrainName], `terrain "${terrainName}" has a TERRAIN_NAME entry for auto-naming`);
  }
}

// --- ad campaign catalog integrity (Stage 4) ---
{
  assert(AD_CAMPAIGNS.length > 0, 'AD_CAMPAIGNS is non-empty');
  const ids = AD_CAMPAIGNS.map(c => c.id);
  assert(new Set(ids).size === ids.length, 'all AD_CAMPAIGNS ids are unique');
  for (const c of AD_CAMPAIGNS) {
    assert(c.cost > 0, `${c.id} has a positive cost`);
    assert(c.attendanceMult > 1, `${c.id} attendanceMult is a boost (>1)`);
    assert(Number.isInteger(c.durationDays) && c.durationDays > 0, `${c.id} has a positive integer durationDays`);
    assert(Number.isInteger(c.cooldownDays) && c.cooldownDays > 0, `${c.id} has a positive integer cooldownDays`);
    assert(campaignById(c.id) === c, `campaignById finds ${c.id} by id`);
  }
  assert(campaignById('nonsense') === undefined, 'campaignById returns undefined for an unknown id');
}

// --- contract option catalog integrity (Stage 5) ---
{
  assert(CONTRACT_OPTIONS.open, 'CONTRACT_OPTIONS has an "open" (day rate) entry');
  assert(CONTRACT_OPTIONS.weekend, 'CONTRACT_OPTIONS has a "weekend" (Weekend Package) entry');
  assert(CONTRACT_OPTIONS.open.commitDays === 0, 'the open day-rate carries no commitment');
  assert(CONTRACT_OPTIONS.open.cancelFeeMult === 0, 'the open day-rate has no cancellation fee');
  assert(CONTRACT_OPTIONS.weekend.priceMult < 1, 'the Weekend Package is discounted off the listed rate');
  assert(CONTRACT_OPTIONS.weekend.commitDays > 0, 'the Weekend Package carries a real commitment');
  assert(CONTRACT_OPTIONS.weekend.cancelFeeMult > 0, 'breaking a Weekend Package early has a real cancellation fee');
}

// --- map/terrain data integrity ---
{
  assert(TERRAIN_ROWS.length === GRID.rows, 'TERRAIN_ROWS has GRID.rows rows');
  assert(TERRAIN_ROWS.every(row => row.length === GRID.cols), 'every terrain row has GRID.cols characters');
  const usedChars = new Set(TERRAIN_ROWS.join(''));
  for (const ch of usedChars) assert(TERRAIN_LEGEND[ch], `terrain char "${ch}" used in the grid resolves in TERRAIN_LEGEND`);
  for (const name of Object.values(TERRAIN_LEGEND)) assert(TERRAIN_BASE[name], `terrain type "${name}" has a TERRAIN_BASE entry`);
}

// --- grounds expansion catalog integrity (Stage 8) ---
{
  assert(GRID_EXPANSIONS.length >= 2, 'GRID_EXPANSIONS has at least a baseline and one real expansion');
  assert(GRID_EXPANSIONS[0].unlockSeason === 1, 'the first GRID_EXPANSIONS entry unlocks at Weekend 1 (always available)');
  assert(GRID_EXPANSIONS[0].cols === 10 && GRID_EXPANSIONS[0].rows === 7, 'the Weekend-1 baseline matches the original Stage 1-7 grounds footprint exactly');
  for (let i = 1; i < GRID_EXPANSIONS.length; i++) {
    const prev = GRID_EXPANSIONS[i - 1], cur = GRID_EXPANSIONS[i];
    assert(cur.unlockSeason > prev.unlockSeason, `GRID_EXPANSIONS[${i}] unlocks strictly later than GRID_EXPANSIONS[${i - 1}]`);
    assert(cur.cols >= prev.cols && cur.rows >= prev.rows && (cur.cols > prev.cols || cur.rows > prev.rows), `GRID_EXPANSIONS[${i}] is strictly bigger than GRID_EXPANSIONS[${i - 1}]`);
  }
  const last = GRID_EXPANSIONS[GRID_EXPANSIONS.length - 1];
  assert(last.cols === GRID.cols && last.rows === GRID.rows, 'the final GRID_EXPANSIONS tier matches the full authored GRID/TERRAIN_ROWS extent');
}

// --- effectivePopularity: quirk multipliers, including night_owl's
//     block-conditional behavior (Stage 9) ---
{
  const plain = { popularity: 10, quirk: null };
  assert(effectivePopularity(plain, 'midday') === 10, 'a quirkless performer\u2019s effective popularity is just their base popularity');

  const pleaser = { popularity: 10, quirk: 'crowd_pleaser' };
  assert(effectivePopularity(pleaser, 'midday') === 10 * QUIRKS.crowd_pleaser.popularityMult, 'crowd_pleaser applies its multiplier regardless of block');
  assert(effectivePopularity(pleaser, 'golden') === effectivePopularity(pleaser, 'morning'), 'crowd_pleaser\u2019s boost does not vary by block');

  const owl = { popularity: 10, quirk: 'night_owl' };
  assert(effectivePopularity(owl, 'golden') === 10 * QUIRKS.night_owl.goldenMult, 'night_owl draws better in Golden Hour');
  assert(effectivePopularity(owl, 'morning') === 10 * QUIRKS.night_owl.morningMult, 'night_owl draws worse in Morning Procession');
  assert(effectivePopularity(owl, 'midday') === 10, 'night_owl has no effect in Midday');
  assert(effectivePopularity(owl, 'afternoon') === 10, 'night_owl has no effect in Afternoon');
  assert(effectivePopularity(owl, undefined) === 10, 'night_owl has no effect with no block context (ambient/overall popularity calc)');
  assert(effectivePopularity(owl, 'golden') > effectivePopularity(owl, 'morning'), 'night_owl draws strictly better in Golden Hour than in Morning Procession');
}

// --- random event catalog integrity (Stage 9: backstage drama events) ---
{
  const ids = EVENT_POOL.map(e => e.id);
  assert(new Set(ids).size === ids.length, 'all EVENT_POOL ids are unique');
  for (const e of EVENT_POOL) {
    assert(EVENT_EFFECTS[e.effectId], `${e.id}'s effectId "${e.effectId}" has a matching EVENT_EFFECTS entry`);
    assert(e.weight > 0, `${e.id} has a positive weight`);
    if (e.requires) {
      assert(EVENT_REQUIREMENTS[e.requires], `${e.id}'s requires "${e.requires}" has a matching EVENT_REQUIREMENTS entry (fails closed otherwise, not open)`);
    }
  }
  // an unrecognized requires string must fail closed (ineligible), not
  // silently fall back to "always eligible" the way the pre-Stage-9
  // if/else chain did.
  assert(EVENT_REQUIREMENTS.nonsense === undefined, 'EVENT_REQUIREMENTS has no entry for an unrecognized requires string, by construction');

  const rng = makeRng(1);
  const ctxAllFalse = { hasChaosProne: false, hasVendor: false, hasMultiplePrimaDonnas: false, hasTwoMusicians: false, hasFalconerScheduled: false, bigRoster: false };
  for (const [key, check] of Object.entries(EVENT_REQUIREMENTS)) {
    assert(check(ctxAllFalse) === false, `EVENT_REQUIREMENTS.${key} is false against an all-false ctx`);
    assert(check({ ...ctxAllFalse, [key]: true }) === true, `EVENT_REQUIREMENTS.${key} is true once its own ctx flag is set`);
  }

  for (const effectId of ['diva_standoff', 'musicians_jam', 'falconer_show', 'gossip_wagon']) {
    const result = EVENT_EFFECTS[effectId](rng);
    assert(typeof result.message === 'string' && result.message.length > 0, `${effectId} produces a non-empty message`);
    assert(typeof result.cashDelta === 'number' && typeof result.repDelta === 'number' && typeof result.satisfactionDelta === 'number', `${effectId} produces numeric deltas`);
  }
  assert(EVENT_EFFECTS.diva_standoff(rng).satisfactionDelta < 0, 'diva_standoff is a net-negative event (backstage drama souring the day)');
  assert(EVENT_EFFECTS.musicians_jam(rng).satisfactionDelta > 0, 'musicians_jam is a net-positive event');
}

// --- schedule validation ---
{
  const schedule = {
    morning: { stage_a: 'perf_jouster_1', stage_b: 'perf_jouster_1' }, // double-booked
    midday: {}, afternoon: {}, golden: {},
  };
  const conflicts = validateSchedule(schedule);
  assert(conflicts.length === 1, 'validateSchedule catches a same-block double-booking');

  const okSchedule = {
    morning: { stage_a: 'perf_jouster_1' },
    midday: { stage_a: 'perf_jouster_1' }, // same performer, different block: fine
    afternoon: {}, golden: {},
  };
  assert(validateSchedule(okSchedule).length === 0, 'same performer in different blocks is not a conflict');
}

// --- quoteBuild: terrain-driven cost/capacity/name (Stage 3) ---
{
  assert(quoteBuild('nonsense', 0, 0) === null, 'quoteBuild returns null for an unknown structure kind');
  assert(quoteBuild('stage', -1, 0) === null, 'quoteBuild returns null for an off-grid cell');

  const onHill = quoteBuild('stage', 3, 0); // hill terrain
  const onClearing = quoteBuild('stage', 7, 3); // clearing terrain
  assert(onHill.cost > onClearing.cost, 'a hill build costs more than the same structure on clearing (grading cost)');
  assert(onHill.capacity < onClearing.capacity, 'a hill stage seats fewer than the same stage on clearing (capacityMult)');
  assert(onHill.name === `${TERRAIN_NAME.hill} Stage`, 'quoteBuild auto-names using TERRAIN_NAME + KIND_NOUN');

  const foodQuote = quoteBuild('food', 6, 2); // path terrain
  assert(foodQuote.capacity === undefined, 'non-stage kinds have no capacity in their quote');
}

// --- computePlotAttributes: bounds and terrain lookup ---
{
  assert(chebyshevDistance({ x: 0, y: 0 }, { x: 2, y: 1 }) === 2, 'chebyshevDistance is the max of the axis deltas');
  assert(terrainAt(3, 2) === 'path', 'the crossing cell (3,2) resolves to path terrain');
  assert(terrainAt(-1, 0) === null, 'terrainAt returns null for out-of-bounds cells');

  const samplePlots = [
    { id: '3_0', kind: 'stage', x: 3, y: 0 },
    { id: '2_4', kind: 'stage', x: 2, y: 4 },
    { id: '6_2', kind: 'food', x: 6, y: 2 },
    { id: '2_2', kind: 'vendor', x: 2, y: 2 },
  ];
  for (const p of samplePlots) {
    const attrs = computePlotAttributes(p, []);
    assert(attrs.sightline >= 0 && attrs.sightline <= 1, `${p.id} sightline stays in [0,1] with nothing built`);
    assert(attrs.shade >= 0 && attrs.shade <= 1, `${p.id} shade stays in [0,1] with nothing built`);
    assert(attrs.traffic >= 0 && attrs.traffic <= 1, `${p.id} traffic stays in [0,1] with nothing built`);
    assert(attrs.nearbyStages === 0, `${p.id} has zero nearby stages with nothing built`);
  }
}

// --- computePlotAttributes: stage-adjacency effects ---
{
  // (3,0) and (3,2) are 2 cells apart (chebyshev), right at the adjacency
  // radius, so building a stage at one should dent the other's sightline;
  // a stage far away, e.g. (7,3), should be unaffected.
  const hillStage = { id: '3_0', kind: 'stage', x: 3, y: 0 };
  const crossingStage = { id: '3_2', kind: 'stage', x: 3, y: 2 };
  const farStage = { id: '7_3', kind: 'stage', x: 7, y: 3 };

  const bare = computePlotAttributes(hillStage, []);
  const withNeighborStage = computePlotAttributes(hillStage, [crossingStage]);
  assert(withNeighborStage.sightline < bare.sightline, 'a nearby built stage reduces another stage\u2019s sightline');
  assert(withNeighborStage.nearbyStages === 1, 'nearbyStages counts the one built stage in range');

  const farResult = computePlotAttributes(farStage, [hillStage]);
  assert(farResult.nearbyStages === 0, 'a stage far outside the adjacency radius does not count as nearby');

  // a food/vendor plot within range of a built stage gains traffic instead
  // of a sightline penalty.
  const bazaarPlot = { id: '2_2', kind: 'vendor', x: 2, y: 2 };
  const bazaarBare = computePlotAttributes(bazaarPlot, []);
  const bazaarNearStage = computePlotAttributes(bazaarPlot, [crossingStage]);
  assert(bazaarNearStage.traffic > bazaarBare.traffic, 'a nearby built stage raises a food/vendor/demo plot\u2019s traffic');
}

// --- simulateDay: basic shape & determinism ---
{
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.contractPerformer(s, 'perf_jouster_1').state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_1').state;

  const r1 = simulateDay(s, 1234);
  const r2 = simulateDay(s, 1234);
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'simulateDay(state, sameSeed) is deterministic');

  const r3 = simulateDay(s, 999);
  assert(typeof r3.attendance === 'number' && r3.attendance >= 0, 'attendance is a non-negative number');
  assert(typeof r3.cashDelta === 'number', 'cashDelta is a number');
  assert(r3.satisfaction >= 0 && r3.satisfaction <= 100, 'satisfaction stays within 0-100');
  assert(Array.isArray(r3.warnings), 'result.warnings is an array');
  assert(Array.isArray(r3.log), 'result.log is an array');
}

// --- simulateDay: no stages built => warning fires, low/no attendance draw from stages ---
{
  const s = State.createInitialState();
  const r = simulateDay(s, 1);
  assert(r.warnings.some(w => /no stages/i.test(w)), 'warns when no stages are built');
}

// --- simulateDay: higher ticket price reduces attendance, all else equal ---
{
  let base = State.createInitialState();
  base = State.buildPlot(base, 'stage', 3, 0).state;
  base = State.contractPerformer(base, 'perf_jouster_1').state;
  base = State.assignSchedule(base, 'midday', '3_0', 'perf_jouster_1').state;

  const cheap = State.setTicketPrice(base, 8).state;
  const pricey = State.setTicketPrice(base, 28).state;
  // Average over several seeds to smooth jitter noise.
  let cheapSum = 0, priceySum = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    cheapSum += simulateDay(cheap, i).attendance;
    priceySum += simulateDay(pricey, i).attendance;
  }
  assert(cheapSum / N > priceySum / N, 'lower ticket price yields higher average attendance than a much higher price');
}

// --- simulateDay: contracted performer with popularity raises attendance vs none scheduled ---
{
  let noAct = State.createInitialState();
  noAct = State.buildPlot(noAct, 'stage', 3, 0).state;

  let withAct = State.createInitialState();
  withAct = State.buildPlot(withAct, 'stage', 3, 0).state;
  withAct = State.contractPerformer(withAct, 'perf_jouster_2').state; // popularity 9
  withAct = State.assignSchedule(withAct, 'midday', '3_0', 'perf_jouster_2').state;

  let noActSum = 0, withActSum = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    noActSum += simulateDay(noAct, i).attendance;
    withActSum += simulateDay(withAct, i).attendance;
  }
  assert(withActSum / N > noActSum / N, 'a scheduled popular performer raises average attendance over an empty stage');
}

// --- simulateDay: night_owl's block-conditional draw shows up in satisfaction (Stage 9) ---
{
  let golden = State.createInitialState();
  golden = State.buildPlot(golden, 'stage', 3, 0).state;
  golden = State.contractPerformer(golden, 'perf_musician_3').state; // night_owl
  golden = State.assignSchedule(golden, 'golden', '3_0', 'perf_musician_3').state;

  let morning = State.createInitialState();
  morning = State.buildPlot(morning, 'stage', 3, 0).state;
  morning = State.contractPerformer(morning, 'perf_musician_3').state; // night_owl
  morning = State.assignSchedule(morning, 'morning', '3_0', 'perf_musician_3').state;

  let goldenSatSum = 0, morningSatSum = 0;
  const N = 30;
  for (let i = 0; i < N; i++) {
    goldenSatSum += simulateDay(golden, i).satisfaction;
    morningSatSum += simulateDay(morning, i).satisfaction;
  }
  assert(goldenSatSum / N > morningSatSum / N, 'scheduling a night_owl performer into Golden Hour yields better average satisfaction than scheduling the same act into Morning Procession');
}

// --- simulateDay: two prima donnas sharing a block sulk without throwing,
//     and the log names the actual block label (regression test — this
//     previously read a nonexistent `block.block.label`, since the
//     for-of destructuring already unwraps `block` to the TIME_BLOCKS
//     entry itself) ---
{
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.buildPlot(s, 'stage', 7, 3).state;
  s = State.contractPerformer(s, 'perf_jouster_2').state; // prima_donna, popularity 9
  s = State.contractPerformer(s, 'perf_magician_1').state; // prima_donna, popularity 7
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_2').state;
  s = State.assignSchedule(s, 'midday', '7_3', 'perf_magician_1').state;

  let result;
  let threw = false;
  try { result = simulateDay(s, 42); } catch (e) { threw = true; console.error(e); }
  assert(!threw, 'simulateDay does not throw when two prima donnas share a time block on different stages');
  assert(result.log.some(line => /sulked through Midday/.test(line)), 'the sulking log line names the actual block label, not "undefined" or "[object Object]"');
  assert(result.log.some(line => line.includes('Master Aldric of the Hollow') && line.includes('Dame Ysolde Ironback')), 'the sulking log line names both the sulking performer and the rival they lost the bill to');
}

// --- state actions: buildPlot cash/error handling & free placement (Stage 3) ---
{
  let s = State.createInitialState();
  const before = s.cash;
  const quote = quoteBuild('stage', 3, 0);
  const { state: afterBuild, error } = State.buildPlot(s, 'stage', 3, 0);
  assert(error === null, 'buildPlot succeeds when affordable');
  assert(afterBuild.cash === before - quote.cost, 'buildPlot deducts the terrain-quoted cost');
  assert(s.cash === before, 'buildPlot does not mutate the original state object (immutability)');
  assert(afterBuild.builtPlots[0].id === '3_0', 'the built plot gets an id derived from its cell');
  assert(afterBuild.builtPlots[0].capacity === quote.capacity, 'the built stage stores its terrain-adjusted capacity');

  const dup = State.buildPlot(afterBuild, 'food', 3, 0);
  assert(dup.error && /already built/i.test(dup.error), 'buildPlot refuses to build on an already-occupied cell, regardless of kind');

  const elsewhere = State.buildPlot(afterBuild, 'food', 6, 2);
  assert(elsewhere.error === null, 'buildPlot succeeds building a different kind on a different open cell');
  assert(elsewhere.state.builtPlots.length === 2, 'both structures now exist independently');

  const offGrid = State.buildPlot(afterBuild, 'stage', -1, 0);
  assert(offGrid.error && /fence line/i.test(offGrid.error), 'buildPlot refuses an off-grid cell');

  const unknownKind = State.buildPlot(afterBuild, 'castle', 5, 5);
  assert(unknownKind.error && /unknown structure/i.test(unknownKind.error), 'buildPlot refuses an unknown structure kind');

  const broke = { ...State.createInitialState(), cash: 0 };
  const brokeRes = State.buildPlot(broke, 'stage', 3, 0);
  assert(brokeRes.error && /not enough cash/i.test(brokeRes.error), 'buildPlot refuses when cash is insufficient');
}

{
  let s = State.createInitialState();
  s = State.contractPerformer(s, 'perf_jester_1').state;
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jester_1').state;
  assert(s.schedule.midday['3_0'] === 'perf_jester_1', 'assignSchedule places the performer in the grid');

  const released = State.releasePerformer(s, 'perf_jester_1').state;
  assert(!released.roster.includes('perf_jester_1'), 'releasePerformer removes them from the roster');
  assert(released.schedule.midday['3_0'] === undefined, 'releasePerformer also clears them from the schedule');
}

{
  // contractPerformer defaults to the open day rate (Stage 5) — same cost
  // and free-release behavior as before contracts existed.
  const perf = PERFORMERS.find(p => p.id === 'perf_jouster_1');
  let s = State.createInitialState();
  s = State.contractPerformer(s, 'perf_jouster_1').state;
  assert(s.contracts.perf_jouster_1.contractId === 'open', 'contractPerformer defaults to the open day-rate contract');
  assert(s.contracts.perf_jouster_1.dailyCost === perf.cost, 'the open day rate charges exactly the listed cost');
  assert(effectivePerformerCost(s, 'perf_jouster_1') === perf.cost, 'effectivePerformerCost matches the listed cost under an open contract');

  const cashBefore = s.cash;
  const released = State.releasePerformer(s, 'perf_jouster_1');
  assert(released.fee === 0, 'releasing an open day-rate contract charges no cancellation fee');
  assert(released.state.cash === cashBefore, 'no cash changes hands when releasing an open day-rate contract');
}

{
  // Weekend Package: discounted daily rate, real commitment, and a
  // cancellation fee for breaking it early (Stage 5).
  const perf = PERFORMERS.find(p => p.id === 'perf_jouster_1');
  const option = CONTRACT_OPTIONS.weekend;
  let s = State.createInitialState();
  const { state: signed, error } = State.contractPerformer(s, 'perf_jouster_1', 'weekend');
  assert(error === null, 'contractPerformer accepts the weekend contract type');
  const expectedRate = Math.round(perf.cost * option.priceMult);
  assert(signed.contracts.perf_jouster_1.dailyCost === expectedRate, 'the Weekend Package charges the discounted daily rate');
  assert(signed.contracts.perf_jouster_1.dailyCost < perf.cost, 'the Weekend Package rate is cheaper than the listed day rate');
  assert(signed.contracts.perf_jouster_1.commitDaysRemaining === option.commitDays, 'the Weekend Package starts with its full commitment length');

  const cashBefore = signed.cash;
  const earlyRelease = State.releasePerformer(signed, 'perf_jouster_1');
  const expectedFee = Math.round(expectedRate * option.commitDays * option.cancelFeeMult);
  assert(earlyRelease.fee === expectedFee, 'breaking a Weekend Package early charges the expected cancellation fee');
  assert(earlyRelease.state.cash === cashBefore - expectedFee, 'the cancellation fee is actually deducted from cash');

  const unknownContract = State.contractPerformer(s, 'perf_jouster_1', 'lifetime');
  assert(unknownContract.error && /unknown contract/i.test(unknownContract.error), 'contractPerformer refuses an unrecognized contract type');
}

{
  // nextDay ticks a Weekend Package's commitment down; once it reaches
  // zero, the performer stays on the roster (contracts persist day to day,
  // same as Stage 1-4) but releasing them is free again (Stage 5).
  let s = State.createInitialState();
  s = State.contractPerformer(s, 'perf_jouster_1', 'weekend').state;
  assert(s.contracts.perf_jouster_1.commitDaysRemaining === 3, 'starts with 3 committed days');

  s = State.nextDay(s).state;
  assert(s.contracts.perf_jouster_1.commitDaysRemaining === 2, 'nextDay ticks the commitment down by one');
  assert(s.roster.includes('perf_jouster_1'), 'the performer remains on the roster while committed');

  s = State.nextDay(s).state;
  s = State.nextDay(s).state;
  assert(s.contracts.perf_jouster_1.commitDaysRemaining === 0, 'the commitment reaches zero after its full duration');
  assert(s.roster.includes('perf_jouster_1'), 'the performer is NOT auto-removed once the commitment ends');

  const freeRelease = State.releasePerformer(s, 'perf_jouster_1');
  assert(freeRelease.fee === 0, 'once the commitment has run out, releasing is free again');
}

{
  // simulateDay's performer wages reflect the contracted daily rate, not
  // the listed cost, once a discounted Weekend Package is signed (Stage 5).
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.contractPerformer(s, 'perf_jouster_1', 'weekend').state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_1').state;
  const result = simulateDay(s, 7);
  const expectedRate = Math.round(PERFORMERS.find(p => p.id === 'perf_jouster_1').cost * CONTRACT_OPTIONS.weekend.priceMult);
  assert(result.performerCosts === expectedRate, 'simulateDay charges the Weekend Package\u2019s discounted rate, not the listed cost');
}

{
  // vendor hiring requires an open stall plot
  let s = State.createInitialState();
  const noPlot = State.hireVendor(s, 'vend_cider');
  assert(noPlot.error && /build a stall plot/i.test(noPlot.error), 'hireVendor refuses without a built food/vendor plot');

  s = State.buildPlot(s, 'food', 6, 2).state;
  const withPlot = State.hireVendor(s, 'vend_cider');
  assert(withPlot.error === null, 'hireVendor succeeds once a stall plot exists');
}

{
  // Stage 7: hireVendor defaults to the open day rate, same shape as
  // contractPerformer — same cost and free-release behavior.
  const vend = VENDORS.find(v => v.id === 'vend_cider');
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.hireVendor(s, 'vend_cider').state;
  assert(s.vendorContracts.vend_cider.contractId === 'open', 'hireVendor defaults to the open day-rate contract');
  assert(s.vendorContracts.vend_cider.dailyCost === vend.cost, 'the open day rate charges exactly the listed vendor cost');
  assert(effectiveVendorCost(s, 'vend_cider') === vend.cost, 'effectiveVendorCost matches the listed cost under an open contract');

  const cashBefore = s.cash;
  const released = State.fireVendor(s, 'vend_cider');
  assert(released.fee === 0, 'letting go of an open day-rate vendor charges no cancellation fee');
  assert(released.state.cash === cashBefore, 'no cash changes hands when firing an open day-rate vendor');
}

{
  // Stage 7: Weekend Package for a vendor — discounted daily rate, real
  // commitment, and a cancellation fee for breaking it early. Mirrors the
  // performer Weekend Package test exactly.
  const vend = VENDORS.find(v => v.id === 'vend_cider');
  const option = CONTRACT_OPTIONS.weekend;
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  const { state: signed, error } = State.hireVendor(s, 'vend_cider', 'weekend');
  assert(error === null, 'hireVendor accepts the weekend contract type');
  const expectedRate = Math.round(vend.cost * option.priceMult);
  assert(signed.vendorContracts.vend_cider.dailyCost === expectedRate, 'the vendor Weekend Package charges the discounted daily rate');
  assert(signed.vendorContracts.vend_cider.dailyCost < vend.cost, 'the vendor Weekend Package rate is cheaper than the listed cost');
  assert(signed.vendorContracts.vend_cider.commitDaysRemaining === option.commitDays, 'the vendor Weekend Package starts with its full commitment length');

  const cashBefore = signed.cash;
  const earlyRelease = State.fireVendor(signed, 'vend_cider');
  const expectedFee = Math.round(expectedRate * option.commitDays * option.cancelFeeMult);
  assert(earlyRelease.fee === expectedFee, 'breaking a vendor Weekend Package early charges the expected cancellation fee');
  assert(earlyRelease.state.cash === cashBefore - expectedFee, 'the vendor cancellation fee is actually deducted from cash');

  const unknownContract = State.hireVendor(s, 'vend_cider', 'lifetime');
  assert(unknownContract.error && /unknown contract/i.test(unknownContract.error), 'hireVendor refuses an unrecognized contract type');
}

{
  // Stage 7: nextDay ticks a vendor's Weekend Package commitment down; once
  // it reaches zero, the vendor stays hired but firing them is free again.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.hireVendor(s, 'vend_cider', 'weekend').state;
  assert(s.vendorContracts.vend_cider.commitDaysRemaining === 3, 'vendor starts with 3 committed days');

  s = State.nextDay(s).state;
  assert(s.vendorContracts.vend_cider.commitDaysRemaining === 2, 'nextDay ticks the vendor commitment down by one');
  assert(s.hiredVendors.includes('vend_cider'), 'the vendor remains hired while committed');

  s = State.nextDay(s).state;
  s = State.nextDay(s).state;
  assert(s.vendorContracts.vend_cider.commitDaysRemaining === 0, 'the vendor commitment reaches zero after its full duration');
  assert(s.hiredVendors.includes('vend_cider'), 'the vendor is NOT auto-removed once the commitment ends');

  const freeRelease = State.fireVendor(s, 'vend_cider');
  assert(freeRelease.fee === 0, 'once the vendor commitment has run out, firing them is free again');
}

{
  // Stage 7: simulateDay's vendor wages reflect the contracted daily rate,
  // not the listed cost, once a discounted Weekend Package is signed.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.hireVendor(s, 'vend_cider', 'weekend').state;
  const result = simulateDay(s, 7);
  const expectedRate = Math.round(VENDORS.find(v => v.id === 'vend_cider').cost * CONTRACT_OPTIONS.weekend.priceMult);
  assert(result.vendorCosts === expectedRate, 'simulateDay charges the vendor Weekend Package\\u2019s discounted rate, not the listed cost');
}

{
  // Stage 7: vendor contracts are season-gated exactly like performer
  // contracts — a Season Contract refuses before Weekend 3.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  const tooEarly = State.hireVendor(s, 'vend_cider', 'season');
  assert(tooEarly.error && /unlocks in weekend 3/i.test(tooEarly.error), 'hireVendor refuses a vendor Season Contract before Weekend 3');
}

{
  // launchCampaign: cash/error handling, one-at-a-time, cooldowns (Stage 4)
  let s = State.createInitialState();
  const before = s.cash;
  const { state: launched, error } = State.launchCampaign(s, 'ad_flyers');
  assert(error === null, 'launchCampaign succeeds when affordable and nothing else is running');
  assert(launched.cash === before - AD_CAMPAIGNS.find(c => c.id === 'ad_flyers').cost, 'launchCampaign deducts the campaign cost');
  assert(s.cash === before, 'launchCampaign does not mutate the original state object (immutability)');
  assert(launched.activeCampaign.id === 'ad_flyers', 'the launched campaign becomes activeCampaign');
  assert(launched.activeCampaign.daysRemaining === campaignById('ad_flyers').durationDays, 'activeCampaign starts with its full duration');

  const secondWhileRunning = State.launchCampaign(launched, 'ad_crier');
  assert(secondWhileRunning.error && /still running/i.test(secondWhileRunning.error), 'launchCampaign refuses a second campaign while one is already running');

  const unknown = State.launchCampaign(s, 'ad_nonsense');
  assert(unknown.error && /unknown campaign/i.test(unknown.error), 'launchCampaign refuses an unknown campaign id');

  const broke = { ...State.createInitialState(), cash: 0 };
  const brokeRes = State.launchCampaign(broke, 'ad_flyers');
  assert(brokeRes.error && /not enough cash/i.test(brokeRes.error), 'launchCampaign refuses when cash is insufficient');
}

{
  // nextDay ticks the active campaign down and then applies its cooldown
  // (Stage 4) — ad_flyers runs 1 day, cools down 1 day.
  let s = State.createInitialState();
  s = State.launchCampaign(s, 'ad_flyers').state;
  assert(s.activeCampaign.daysRemaining === 1, 'ad_flyers starts with 1 day remaining');

  s = State.nextDay(s).state;
  assert(s.activeCampaign === null, 'ad_flyers expires after its single day of duration');
  assert(s.campaignCooldowns.ad_flyers === 1, 'ad_flyers enters its 1-day cooldown the moment it expires');

  const stillCoolingDown = State.launchCampaign(s, 'ad_flyers');
  assert(stillCoolingDown.error && /before it can run again/i.test(stillCoolingDown.error), 'launchCampaign refuses while the campaign is still cooling down');

  s = State.nextDay(s).state;
  assert(s.campaignCooldowns.ad_flyers === undefined, 'the cooldown clears once its days are up');

  const readyAgain = State.launchCampaign(s, 'ad_flyers');
  assert(readyAgain.error === null, 'ad_flyers can be relaunched once its cooldown has fully ticked down');
}

{
  // simulateDay: an active campaign's multiplier raises average attendance
  let noAd = State.createInitialState();
  noAd = State.buildPlot(noAd, 'stage', 3, 0).state;

  let withAd = State.createInitialState();
  withAd = State.buildPlot(withAd, 'stage', 3, 0).state;
  withAd = State.launchCampaign(withAd, 'ad_broadside').state; // biggest boost, easiest to detect over jitter

  let noAdSum = 0, withAdSum = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    noAdSum += simulateDay(noAd, i).attendance;
    withAdSum += simulateDay(withAd, i).attendance;
  }
  assert(withAdSum / N > noAdSum / N, 'a running ad campaign raises average attendance over having none active');

  const result = simulateDay(withAd, 1);
  assert(result.campaignActive === 'Regional Broadside', 'simulateDay reports the active campaign\u2019s name');
  assert(result.adFactor === campaignById('ad_broadside').attendanceMult, 'simulateDay reports the exact adFactor applied');
}

{
  // runDay + nextDay full loop
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.contractPerformer(s, 'perf_jouster_1').state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_1').state;
  const { state: afterRun, result } = State.runDay(s, 5);
  assert(afterRun.phase === 'report', 'runDay moves phase to report');
  assert(afterRun.history.length === 1, 'runDay appends to history');
  assert(afterRun.lastResult === result, 'runDay stores the result as lastResult');

  const afterNext = State.nextDay(afterRun).state;
  assert(afterNext.day === 2, 'nextDay increments the day counter');
  assert(afterNext.phase === 'plan', 'nextDay returns to the plan phase');
  assert(afterNext.builtPlots.some(p => p.id === '3_0'), 'nextDay preserves built plots');
  assert(afterNext.roster.includes('perf_jouster_1'), 'nextDay preserves the roster');
  assert(afterNext.schedule.midday['3_0'] === 'perf_jouster_1', 'nextDay preserves the prior schedule');
}

// --- season/progression catalog integrity (Stage 6) ---
{
  for (const c of AD_CAMPAIGNS) {
    assert(typeof c.unlockSeason === 'number' && c.unlockSeason >= 1, `${c.id} has a valid unlockSeason`);
  }
  for (const opt of Object.values(CONTRACT_OPTIONS)) {
    assert(typeof opt.unlockSeason === 'number' && opt.unlockSeason >= 1, `${opt.id} has a valid unlockSeason`);
  }
  assert(AD_CAMPAIGNS.some(c => c.unlockSeason > 1), 'at least one campaign is gated behind a later weekend');
  assert(Object.values(CONTRACT_OPTIONS).some(o => o.unlockSeason > 1), 'at least one contract type is gated behind a later weekend');
  assert(CONTRACT_OPTIONS.open.unlockSeason === 1, 'the Day Rate contract is available from Weekend 1');
  assert(CONTRACT_OPTIONS.season.priceMult < CONTRACT_OPTIONS.weekend.priceMult, 'the Season Contract is a deeper discount than the Weekend Package');
  assert(CONTRACT_OPTIONS.season.commitDays > CONTRACT_OPTIONS.weekend.commitDays, 'the Season Contract carries a longer commitment than the Weekend Package');
}

// --- isSeasonUnlocked (Stage 6) ---
{
  const s1 = { season: 1 };
  const s3 = { season: 3 };
  assert(isSeasonUnlocked(s1, 1) === true, 'a Weekend-1 item is unlocked in Weekend 1');
  assert(isSeasonUnlocked(s1, 2) === false, 'a Weekend-2 item is NOT unlocked in Weekend 1');
  assert(isSeasonUnlocked(s3, 2) === true, 'a Weekend-2 item is unlocked once Weekend 3 is reached');
  assert(isSeasonUnlocked(s1, undefined) === true, 'a missing unlockSeason defaults to available (treated as 1)');
}

// --- nextDay hard-stops at the end of a weekend (Stage 6) ---
{
  let s = State.createInitialState();
  assert(s.season === 1 && s.weekendDay === 1, 'a fresh game starts on Weekend 1, day 1 of the weekend');

  s = State.nextDay(s).state;
  assert(s.weekendDay === 2 && s.phase === 'plan' && s.season === 1, 'day 1\u21922 of a weekend advances normally');

  s = State.nextDay(s).state;
  assert(s.weekendDay === 3 && s.phase === 'plan' && s.season === 1, 'day 2\u21923 of a weekend advances normally');

  const beforeLastTick = s.day;
  s = State.nextDay(s).state;
  assert(s.phase === 'weekendEnd', 'nextDay stops at weekendEnd after the weekend\u2019s final day');
  assert(s.day === beforeLastTick && s.weekendDay === 3 && s.season === 1, 'day/weekendDay/season do NOT advance yet while parked in weekendEnd');

  s = State.startNextWeekend(s).state;
  assert(s.season === 2 && s.weekendDay === 1 && s.phase === 'plan', 'startNextWeekend rolls over into the next weekend');
  assert(s.day === beforeLastTick + 1, 'startNextWeekend advances the day counter exactly once');
}

// --- summarizeWeekend (Stage 6) ---
{
  const empty = summarizeWeekend([], 3);
  assert(empty.days.length === 0 && empty.totalAttendance === 0 && empty.totalNet === 0, 'summarizeWeekend returns a zeroed shape for empty history');

  const history = [
    { day: 1, attendance: 100, cashDelta: 50, satisfaction: 60, reputationDelta: 1 },
    { day: 2, attendance: 200, cashDelta: -20, satisfaction: 80, reputationDelta: 2 },
    { day: 3, attendance: 150, cashDelta: 30, satisfaction: 70, reputationDelta: -1 },
  ];
  const summary = summarizeWeekend(history, 3);
  assert(summary.days.length === 3, 'summarizeWeekend takes exactly the requested trailing slice');
  assert(summary.totalAttendance === 450, 'summarizeWeekend sums attendance across the weekend');
  assert(summary.totalNet === 60, 'summarizeWeekend sums cashDelta across the weekend');
  assert(summary.avgSatisfaction === 70, 'summarizeWeekend averages satisfaction across the weekend');
  assert(summary.repDelta === 2, 'summarizeWeekend sums reputationDelta across the weekend');
  assert(summary.bestDay.day === 1, 'summarizeWeekend identifies the best day by cashDelta');
  assert(summary.worstDay.day === 2, 'summarizeWeekend identifies the worst day by cashDelta');

  const longerHistory = [...history, { day: 4, attendance: 90, cashDelta: 10, satisfaction: 55, reputationDelta: 0 }];
  const trailing = summarizeWeekend(longerHistory, 3);
  assert(trailing.days[0].day === 2, 'summarizeWeekend only looks at the trailing `count` entries, not the whole history');
}

// --- season-gated contracts and campaigns (Stage 6) ---
{
  let s = State.createInitialState();
  const tooEarly = State.contractPerformer(s, 'perf_jouster_1', 'season');
  assert(tooEarly.error && /unlocks in weekend 3/i.test(tooEarly.error), 'contractPerformer refuses a Season Contract before Weekend 3');

  const proclamationEarly = State.launchCampaign(s, 'ad_proclamation');
  assert(proclamationEarly.error && /unlocks in weekend 2/i.test(proclamationEarly.error), 'launchCampaign refuses Kingdom Proclamation before Weekend 2');

  // fast-forward to Weekend 3 by walking the day/weekend boundaries forward
  for (let i = 0; i < 6; i++) {
    const r = State.nextDay(s);
    s = r.state.phase === 'weekendEnd' ? State.startNextWeekend(r.state).state : r.state;
  }
  assert(s.season === 3, 'walking forward 6 days from Weekend 1 day 1 reaches Weekend 3');

  const proclamationNow = State.launchCampaign(s, 'ad_proclamation');
  assert(proclamationNow.error === null, 'launchCampaign succeeds for Kingdom Proclamation once Weekend 2+ is reached');

  const seasonContractNow = State.contractPerformer(s, 'perf_jouster_1', 'season');
  assert(seasonContractNow.error === null, 'contractPerformer succeeds for a Season Contract once Weekend 3 is reached');
  assert(seasonContractNow.state.contracts.perf_jouster_1.commitDaysRemaining === CONTRACT_OPTIONS.season.commitDays, 'a signed Season Contract starts with its full commitment length');

  // Stage 7: the same unlock applies to a vendor Season Contract.
  let sv = State.buildPlot(s, 'food', 6, 2).state;
  const vendorSeasonContractNow = State.hireVendor(sv, 'vend_cider', 'season');
  assert(vendorSeasonContractNow.error === null, 'hireVendor succeeds for a vendor Season Contract once Weekend 3 is reached');
  assert(vendorSeasonContractNow.state.vendorContracts.vend_cider.commitDaysRemaining === CONTRACT_OPTIONS.season.commitDays, 'a signed vendor Season Contract starts with its full commitment length');
}

// --- season-gated grounds expansion (Stage 8) ---
{
  let s = State.createInitialState();
  const homeSize = currentGridSize(s);
  assert(homeSize.label === 'Home Grounds' && homeSize.cols === 10 && homeSize.rows === 7, 'a fresh Weekend-1 game starts on the Home Grounds footprint');
  assert(nextGridExpansion(s).label === 'East Meadow', 'a fresh game\u2019s next expansion is East Meadow');

  assert(isWithinCurrentGrid(s, 9, 6) === true, 'the Home Grounds\u2019 far corner (9,6) is buildable at Weekend 1');
  assert(isWithinCurrentGrid(s, 10, 0) === false, 'a cell just past the Weekend-1 fence line (10,0) is not yet buildable');

  // Stage 12: a stage's footprint is 2x2, so the anchor picked here has to
  // clear the WHOLE footprint against each tier, not just its own cell.
  // (8,6)-(9,7) straddles the Home-Grounds/East-Meadow boundary (row 7 is
  // new at East Meadow) and sits beside the new col-10 path spur for
  // frontage; (11,8)-(12,9) clears Deep Woods Trail but still overflows
  // East Meadow's row cap.
  const tooFarOut = State.buildPlot(s, 'stage', 8, 6);
  assert(tooFarOut.error && /fence line/i.test(tooFarOut.error), 'buildPlot refuses a cell past the current fence line with a clear error');
  assert(tooFarOut.state === s, 'a refused off-grounds build does not mutate state');

  // fast-forward to Weekend 2 (3 days) to unlock the East Meadow
  for (let i = 0; i < 3; i++) {
    const r = State.nextDay(s);
    s = r.state.phase === 'weekendEnd' ? State.startNextWeekend(r.state).state : r.state;
  }
  assert(s.season === 2, 'walking forward one weekend from Weekend 1 reaches Weekend 2');
  const meadowSize = currentGridSize(s);
  assert(meadowSize.label === 'East Meadow' && meadowSize.cols === 12 && meadowSize.rows === 8, 'reaching Weekend 2 unlocks the East Meadow (12\u00d78) footprint');
  assert(isWithinCurrentGrid(s, 9, 7) === true, 'a cell that was off-grounds at Weekend 1 (9,7) becomes buildable once East Meadow unlocks');

  const meadowBuild = State.buildPlot(s, 'stage', 8, 6);
  assert(meadowBuild.error === null, 'buildPlot succeeds in the newly-unlocked East Meadow once Weekend 2 is reached');

  const stillTooFarOut = State.buildPlot(meadowBuild.state, 'stage', 11, 8);
  assert(stillTooFarOut.error && /fence line/i.test(stillTooFarOut.error), 'a cell in the not-yet-unlocked Deep Woods Trail tier is still refused at Weekend 2');
  assert(nextGridExpansion(meadowBuild.state).label === 'Deep Woods Trail', 'Deep Woods Trail is the next expansion still ahead at Weekend 2');
}

// --- 50-day fuzz run: engine should never throw or produce NaN/negatives ---
{
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.contractPerformer(s, 'perf_jouster_1').state;
  s = State.contractPerformer(s, 'perf_jester_1').state; // chaos_prone, exercises the rowdy_crowd event path
  s = State.hireVendor(s, 'vend_cider').state;
  s = State.assignSchedule(s, 'morning', '3_0', 'perf_jester_1').state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_1').state;

  let ok = true;
  for (let i = 0; i < 50; i++) {
    try {
      const { state: next, result } = State.runDay(s, i * 31 + 7);
      if (Number.isNaN(result.cashDelta) || Number.isNaN(result.satisfaction)) ok = false;
      if (result.attendance < 0) ok = false;
      s = State.nextDay(next).state;
      if (s.phase === 'weekendEnd') s = State.startNextWeekend(s).state;
    } catch (e) {
      ok = false;
      console.error(e);
      break;
    }
  }
  assert(ok, '50-day fuzz run completes with no throws, no NaNs, no negative attendance');
  assert(s.day === 51, '50-day fuzz run advanced the day counter the expected number of times');
}

// ---------------------------------------------------------------------
// Stage 10: planning → commit construction, move/demolish/relocate/
// rename, and individual vendor ↔ stall assignment (incl. auto-fill and
// the per-kind hire cap that replaces the old shared food+craft pool).
// ---------------------------------------------------------------------
{
  // placePlot is free and non-final; commitPlot is what actually charges.
  let s = State.createInitialState();
  const cashStart = s.cash;
  const placed = State.placePlot(s, 'stage', 3, 0);
  assert(placed.error === null, 'placePlot succeeds on an open, in-bounds cell');
  s = placed.state;
  assert(s.cash === cashStart, 'placePlot does not charge anything');
  const plot = s.builtPlots.find(p => p.x === 3 && p.y === 0);
  assert(!!plot && plot.status === 'planning', 'a freshly placed plot has status "planning"');
  assert(plot.id.startsWith('plot_'), 'placePlot ids come from the nextPlotId counter, not the (x,y) scheme buildPlot uses');

  const dupPlace = State.placePlot(s, 'food', 3, 0);
  assert(dupPlace.error && /already built/i.test(dupPlace.error), 'placePlot refuses an already-occupied cell');

  const commitRes = State.commitPlot(s, plot.id);
  assert(commitRes.error === null, 'commitPlot succeeds once affordable');
  assert(commitRes.state.cash === cashStart - plot.cost, 'commitPlot charges exactly the plot\u2019s quoted cost');
  assert(commitRes.state.builtPlots.find(p => p.id === plot.id).status === 'built', 'commitPlot flips status to "built"');

  const doubleCommit = State.commitPlot(commitRes.state, plot.id);
  assert(doubleCommit.error && /already built/i.test(doubleCommit.error), 'commitPlot refuses a plot that is already built');

  const broke = { ...s, cash: 0 };
  const brokeCommit = State.commitPlot(broke, plot.id);
  assert(brokeCommit.error && /not enough cash/i.test(brokeCommit.error), 'commitPlot refuses when cash is insufficient');
}

{
  // A planning plot doesn't count toward gameplay yet — no crowd draw, no
  // adjacency effect on neighbors, not schedulable in any meaningful way.
  let s = State.createInitialState();
  s = State.placePlot(s, 'stage', 3, 0).state;
  const result = simulateDay(s, 3);
  assert(result.warnings.some(w => /no stages built/i.test(w)), 'simulateDay treats a still-planning stage as not built yet');
}

{
  // commitAllPlots: all-or-nothing bulk commit, exactly the scenario behind
  // the reported soft lock (several stalls placed in one sitting).
  let s = State.createInitialState();
  const noneToCommit = State.commitAllPlots(s);
  assert(noneToCommit.error && /nothing is waiting/i.test(noneToCommit.error), 'commitAllPlots refuses when nothing is planned');

  s = State.placePlot(s, 'food', 6, 2).state;
  s = State.placePlot(s, 'vendor', 7, 2).state;
  const planningIds = s.builtPlots.map(p => p.id);
  const total = s.builtPlots.reduce((sum, p) => sum + p.cost, 0);

  const tooPoor = { ...s, cash: 1 };
  const cantAfford = State.commitAllPlots(tooPoor);
  assert(cantAfford.error && cantAfford.error.includes(`$${total}`), 'commitAllPlots refuses (all-or-nothing) when the combined total is unaffordable');
  assert(cantAfford.state.builtPlots.every(p => p.status === 'planning'), 'a refused commitAllPlots leaves every plot untouched in planning');

  const cashBefore = s.cash;
  const committed = State.commitAllPlots(s);
  assert(committed.error === null, 'commitAllPlots succeeds once the combined total is affordable');
  assert(committed.count === 2, 'commitAllPlots reports how many plots it committed');
  assert(committed.state.cash === cashBefore - total, 'commitAllPlots charges the exact combined total, once');
  assert(planningIds.every(id => committed.state.builtPlots.find(p => p.id === id).status === 'built'), 'every previously-planning plot is now built');
}

{
  // deletePlanningPlot / movePlanningPlot: free while still a plan; refused
  // once committed (demolishPlot/relocatePlot are the paid equivalents).
  let s = State.createInitialState();
  s = State.placePlot(s, 'stage', 3, 0).state;
  const plot = s.builtPlots[0];

  const movedElsewhere = State.movePlanningPlot(s, plot.id, 5, 3);
  assert(movedElsewhere.error === null, 'movePlanningPlot succeeds on an open cell');
  assert(movedElsewhere.state.cash === s.cash, 'movePlanningPlot is free');
  const movedPlot = movedElsewhere.state.builtPlots.find(p => p.id === plot.id);
  assert(movedPlot.x === 5 && movedPlot.y === 3, 'movePlanningPlot actually updates the plot\u2019s position');
  assert(movedPlot.id === plot.id, 'movePlanningPlot keeps the same plot id after moving (id is decoupled from x,y)');

  const deleted = State.deletePlanningPlot(movedElsewhere.state, plot.id);
  assert(deleted.error === null, 'deletePlanningPlot succeeds on a planning plot');
  assert(deleted.state.builtPlots.length === 0, 'deletePlanningPlot actually removes the plot');
  assert(deleted.state.cash === s.cash, 'deletePlanningPlot refunds nothing because nothing was ever charged');

  let built = State.placePlot(s, 'stage', 8, 3).state;
  built = State.commitPlot(built, built.builtPlots.find(p => p.x === 8 && p.y === 3).id).state;
  const builtPlot = built.builtPlots.find(p => p.x === 8 && p.y === 3);
  const cantMove = State.movePlanningPlot(built, builtPlot.id, 9, 3);
  assert(cantMove.error && /relocate a built plot instead/i.test(cantMove.error), 'movePlanningPlot refuses a plot that is already built');
  const cantDelete = State.deletePlanningPlot(built, builtPlot.id);
  assert(cantDelete.error && /demolish a built plot instead/i.test(cantDelete.error), 'deletePlanningPlot refuses a plot that is already built');
}

{
  // demolishPlot / relocatePlot: the paid equivalents for a committed plot.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  const plot = s.builtPlots[0];
  const expectedFee = Math.round(plot.cost * CONFIG.demolishFeeMult);

  const cashBefore = s.cash;
  const demolished = State.demolishPlot(s, plot.id);
  assert(demolished.error === null, 'demolishPlot succeeds on a built plot');
  assert(demolished.fee === expectedFee, 'demolishPlot charges CONFIG.demolishFeeMult of the original build cost');
  assert(demolished.state.cash === cashBefore - expectedFee, 'the demolition fee is actually deducted');
  assert(demolished.state.builtPlots.length === 0, 'demolishPlot removes the plot');

  let onlyPlanning = State.createInitialState();
  onlyPlanning = State.placePlot(onlyPlanning, 'stage', 3, 0).state;
  const refusedDemolish = State.demolishPlot(onlyPlanning, onlyPlanning.builtPlots[0].id);
  assert(refusedDemolish.error && /delete it instead/i.test(refusedDemolish.error), 'demolishPlot refuses a plot that is still just a plan');

  let s2 = State.createInitialState();
  s2 = State.buildPlot(s2, 'stage', 3, 0).state;
  const origPlot = s2.builtPlots[0];
  const quote = quoteBuild('stage', 8, 3);
  const expectedTotal = Math.round(origPlot.cost * CONFIG.demolishFeeMult) + Math.round(quote.cost * CONFIG.relocateDiscountMult);
  const cashBeforeRelocate = s2.cash;
  const relocated = State.relocatePlot(s2, origPlot.id, 8, 3);
  assert(relocated.error === null, 'relocatePlot succeeds onto a different open cell');
  assert(relocated.fee === expectedTotal, 'relocatePlot charges the demolition fee plus the discounted rebuild cost');
  assert(relocated.state.cash === cashBeforeRelocate - expectedTotal, 'relocatePlot actually deducts the combined total');
  const relocatedPlot = relocated.state.builtPlots.find(p => p.id === origPlot.id);
  assert(relocatedPlot.x === 8 && relocatedPlot.y === 3, 'relocatePlot updates the plot\u2019s position');
  assert(relocatedPlot.id === origPlot.id, 'relocatePlot keeps the same plot id (schedule references to it stay valid)');

  const poorRelocate = State.relocatePlot({ ...s2, cash: 0 }, origPlot.id, 6, 3);
  assert(poorRelocate.error && /not enough cash/i.test(poorRelocate.error), 'relocatePlot refuses when cash can\u2019t cover the combined cost');
}

{
  // renamePlot: works on both planning and built plots, and sticks through
  // a later move (customName protects it from the terrain auto-name).
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  const plot = s.builtPlots[0];
  const emptyName = State.renamePlot(s, plot.id, '   ');
  assert(emptyName.error && /cannot be empty/i.test(emptyName.error), 'renamePlot refuses a blank/whitespace-only name');

  const renamed = State.renamePlot(s, plot.id, 'The Jousting Green');
  assert(renamed.error === null, 'renamePlot succeeds with a real name');
  assert(renamed.state.builtPlots[0].name === 'The Jousting Green', 'renamePlot actually sets the new name');
  assert(renamed.state.builtPlots[0].customName === true, 'renamePlot flags the plot as customName so relocation won\u2019t overwrite it');

  const relocatedAfterRename = State.relocatePlot(renamed.state, plot.id, 8, 3);
  assert(relocatedAfterRename.state.builtPlots[0].name === 'The Jousting Green', 'a custom name survives a later relocate');

  const longName = 'x'.repeat(100);
  const capped = State.renamePlot(s, plot.id, longName);
  assert(capped.state.builtPlots[0].name.length === CONFIG.maxPlotNameLength, 'renamePlot caps an overly long name at CONFIG.maxPlotNameLength');
}

{
  // hireVendor's per-kind cap (Stage 10 fix for the shared food+craft pool)
  // plus auto-seating on hire.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'vendor', 6, 2).state; // a CRAFT stall, not food
  const foodHire = State.hireVendor(s, 'vend_cider'); // vend_cider is type "food"
  assert(foodHire.error && /no open food stalls/i.test(foodHire.error), 'Stage 10: a built craft stall does NOT let a food vendor be hired (the old shared-pool bug)');
  const craftHire = State.hireVendor(s, 'vend_leather'); // type "craft"
  assert(craftHire.error === null, 'a craft vendor hires fine against a built craft stall');
  assert(craftHire.state.builtPlots[0].assignedVendorId === 'vend_leather', 'hireVendor auto-seats the newly hired vendor into the open matching stall');

  const summary = stallSummary(craftHire.state);
  assert(summary.vendor.total === 1 && summary.vendor.filled === 1, 'stallSummary reports the craft stall as 1/1 filled after the auto-seated hire');
  assert(summary.food.total === 0 && summary.food.filled === 0, 'stallSummary reports zero food stalls (none built)');

  const secondCraftHire = State.hireVendor(craftHire.state, 'vend_glass');
  assert(secondCraftHire.error && /no open craft stalls/i.test(secondCraftHire.error), 'hireVendor refuses a second craft vendor once the single craft stall is already filled');
}

{
  // assignVendorToPlot / unassignVendorFromPlot / autoFillStalls.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.buildPlot(s, 'food', 7, 2).state;
  const [plotA, plotB] = s.builtPlots;

  s = State.hireVendor(s, 'vend_cider').state; // auto-seats at plotA
  assert(s.builtPlots.find(p => p.id === plotA.id).assignedVendorId === 'vend_cider', 'the first hired food vendor is auto-seated at the first open food plot');

  const notHired = State.assignVendorToPlot(s, plotB.id, 'vend_leather');
  assert(notHired.error && /has not been hired/i.test(notHired.error), 'assignVendorToPlot refuses a vendor that has not been hired yet');

  s = State.hireVendor(s, 'vend_piepeddler').state; // auto-seats at plotB (the only open food plot left)
  assert(s.builtPlots.find(p => p.id === plotB.id).assignedVendorId === 'vend_piepeddler', 'the second hired food vendor is auto-seated at the remaining open food plot');

  const alreadySeated = State.assignVendorToPlot(s, plotA.id, 'vend_piepeddler');
  assert(alreadySeated.error && /already has a vendor/i.test(alreadySeated.error), 'assignVendorToPlot refuses to double-seat a stall that already has a vendor');

  const unassigned = State.unassignVendorFromPlot(s, plotA.id);
  assert(unassigned.error === null, 'unassignVendorFromPlot succeeds');
  assert(unassigned.state.builtPlots.find(p => p.id === plotA.id).assignedVendorId === null, 'unassignVendorFromPlot actually clears the seat');
  assert(unassigned.state.hiredVendors.includes('vend_cider'), 'unassigning does not fire the vendor \u2014 they stay hired, just unseated');

  const reassigned = State.assignVendorToPlot(unassigned.state, plotA.id, 'vend_cider');
  assert(reassigned.error === null, 'a now-unseated vendor can be manually reassigned back to an open stall');

  // autoFillStalls: unseat everyone, add a third food stall, then confirm
  // it fills every open stall/vendor pair deterministically.
  let fillTest = State.buildPlot(reassigned.state, 'food', 8, 2).state;
  fillTest = State.unassignVendorFromPlot(fillTest, plotA.id).state;
  fillTest = State.unassignVendorFromPlot(fillTest, plotB.id).state;
  const autoFilled = State.autoFillStalls(fillTest);
  assert(autoFilled.filled === 2, 'autoFillStalls seats every unseated hired vendor into an open matching stall');
  assert(autoFilled.state.builtPlots.filter(p => p.kind === 'food' && p.assignedVendorId).length === 2, 'autoFillStalls actually wrote the assignments back onto the plots');
  const noMoreToFill = State.autoFillStalls(autoFilled.state);
  assert(noMoreToFill.filled === 0, 'autoFillStalls is a no-op once there is nothing left to match up');
}

{
  // Demolishing a plot with a seated vendor unseats them (rather than firing
  // them outright) — they stay hired and can be reassigned or auto-filled.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.hireVendor(s, 'vend_cider').state;
  const plot = s.builtPlots[0];
  assert(plot.assignedVendorId === 'vend_cider', 'sanity check: the vendor is seated before demolition');
  const demolished = State.demolishPlot(s, plot.id);
  assert(demolished.state.hiredVendors.includes('vend_cider'), 'demolishing a stall does not fire its seated vendor');
  assert(demolished.state.builtPlots.length === 0, 'the demolished plot is gone');

  // Fire also clears the seat, symmetrically.
  let s2 = State.createInitialState();
  s2 = State.buildPlot(s2, 'food', 6, 2).state;
  s2 = State.hireVendor(s2, 'vend_cider').state;
  const fired = State.fireVendor(s2, 'vend_cider');
  assert(fired.state.builtPlots[0].assignedVendorId === null, 'firing a seated vendor clears their stall\u2019s assignment');
}

{
  // Only a vendor actually seated at a built stall earns revenue/wages the
  // stall depends on \u2014 an unseated hired vendor is pure cost, and this is
  // surfaced as a warning so it's never a silent soft lock again.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.buildPlot(s, 'food', 6, 2).state;
  s = State.buildPlot(s, 'food', 7, 2).state;
  s = State.hireVendor(s, 'vend_cider').state; // seats at the first food plot; second stays open
  const result = simulateDay(s, 11);
  assert(!result.warnings.some(w => /not assigned to a stall/i.test(w)), 'no "unseated vendor" warning when every hired vendor is seated');
  assert(result.warnings.some(w => /stall plots are built/i.test(w)) === false, 'no "no vendors hired" warning once at least one vendor is hired and seated');

  s = State.hireVendor(s, 'vend_piepeddler').state; // seats at the second food plot
  const unassign = State.unassignVendorFromPlot(s, s.builtPlots.find(p => p.assignedVendorId === 'vend_piepeddler').id);
  const result2 = simulateDay(unassign.state, 11);
  assert(result2.warnings.some(w => /1 hired vendor is not assigned/i.test(w)), 'simulateDay warns when a hired vendor is not seated anywhere');
}

// --- Stage 10: loadState migration for pre-Stage-10 saves ---
{
  globalThis.localStorage = makeMemoryStorage();
  const legacySave = {
    day: 5, season: 1, weekendDay: 2, cash: 1000, reputation: 50, ticketPrice: 16,
    builtPlots: [
      { id: '6_2', kind: 'food', x: 6, y: 2, name: 'Green Stall', cost: 480 }, // no status, no assignedVendorId — pre-Stage-10 shape
    ],
    roster: [], contracts: {}, hiredVendors: ['vend_cider'], vendorContracts: { vend_cider: { contractId: 'open', dailyCost: 120, commitDaysRemaining: 0 } },
    schedule: {}, activeCampaign: null, campaignCooldowns: {}, phase: 'plan', lastResult: null, history: [],
  };
  globalThis.localStorage.setItem('renn-faire-sim-save-v1', JSON.stringify(legacySave));
  const migrated = State.loadState();
  assert(migrated.builtPlots[0].status === 'built', 'loadState migrates a pre-Stage-10 plot straight to status "built"');
  assert(migrated.builtPlots[0].assignedVendorId === 'vend_cider', 'loadState auto-seats an already-hired vendor into their matching already-built stall on migration');
  assert(typeof migrated.nextPlotId === 'number', 'loadState backfills nextPlotId for a pre-Stage-10 save');
  globalThis.localStorage.removeItem('renn-faire-sim-save-v1');
}


// ---------------------------------------------------------------------
// Stage 11: build-time legality rules — terrain bans (stage/demo can't
// block the path) and a minimum stage-to-stage spacing.
// ---------------------------------------------------------------------
{
  // (x=0,y=2) sits on the path (row 2 is all 'P'). A food/craft stall is
  // still fine there; a stage or demo camp is not.
  assert(terrainAt(0, 2) === 'path', 'sanity check: (0,2) is path terrain, as the legality tests below assume');
  const stageOnPath = isLegalPlacement('stage', 0, 2, []);
  assert(stageOnPath.ok === false && /path/i.test(stageOnPath.reason), 'isLegalPlacement refuses a stage on the path');
  const demoOnPath = isLegalPlacement('demo', 0, 2, []);
  assert(demoOnPath.ok === false, 'isLegalPlacement refuses a demo camp on the path');
  const foodOnPath = isLegalPlacement('food', 0, 2, []);
  assert(foodOnPath.ok === true, 'isLegalPlacement allows a food stall on the path (roadside stalls are fine)');
  const vendorOnPath = isLegalPlacement('vendor', 0, 2, []);
  assert(vendorOnPath.ok === true, 'isLegalPlacement allows a craft stall on the path too');

  // Stage 12: a stage anchored at (0,0) now occupies the 2x2 block
  // (0,0)-(1,1). (2,0) doesn't overlap that block but its nearest cell is
  // still Chebyshev distance 1 from it — too close for two stages. (4,0)
  // clears minStageSpacing. A 1x1 kind at (2,1) sits right beside the same
  // stage (and has path frontage via its own south neighbor) to prove the
  // spacing rule only fires stage-to-stage.
  const existingStage = [{ id: 'plot_1', kind: 'stage', x: 0, y: 0, status: 'built' }];
  const tooClose = isLegalPlacement('stage', 2, 0, existingStage);
  assert(tooClose.ok === false && /too close/i.test(tooClose.reason), 'isLegalPlacement refuses a second stage directly adjacent to an existing one');
  const farEnough = isLegalPlacement('stage', 4, 0, existingStage);
  assert(farEnough.ok === true, 'isLegalPlacement allows a second stage once it clears minStageSpacing');
  const nonStageNearby = isLegalPlacement('food', 2, 1, existingStage);
  assert(nonStageNearby.ok === true, 'the stage-spacing rule only applies between two stages, not other kinds');

  // A plot excluded by id (the one being moved/relocated) doesn't count
  // against its own new position.
  const selfCheck = isLegalPlacement('stage', 0, 0, existingStage, 'plot_1');
  assert(selfCheck.ok === true, 'isLegalPlacement ignores the plot\u2019s own current position when excludeId matches it');

  // A still-"planning" stage claims its spot for spacing purposes too, so
  // two planned-but-uncommitted stages can't be planned right next to
  // each other and then committed together.
  const planningStage = [{ id: 'plot_2', kind: 'stage', x: 0, y: 0, status: 'planning' }];
  const tooCloseToPlan = isLegalPlacement('stage', 2, 0, planningStage);
  assert(tooCloseToPlan.ok === false && /too close/i.test(tooCloseToPlan.reason), 'isLegalPlacement treats a still-planning stage as claiming its spot for spacing purposes');
}

{
  // End-to-end: state.js's placePlot/buildPlot/movePlanningPlot/relocatePlot
  // all surface the same refusal, not just the pure isLegalPlacement helper.
  let s = State.createInitialState();
  const placeOnPath = State.placePlot(s, 'stage', 0, 2);
  assert(placeOnPath.error && /path/i.test(placeOnPath.error), 'placePlot refuses a stage sited on the path');

  const buildOnPath = State.buildPlot(s, 'demo', 1, 2);
  assert(buildOnPath.error && /path/i.test(buildOnPath.error), 'buildPlot refuses a demo camp sited on the path');

  const foodOnPath2 = State.placePlot(s, 'food', 2, 2);
  assert(foodOnPath2.error === null, 'placePlot still allows a food stall on the path');

  s = State.placePlot(s, 'stage', 0, 0).state;
  const first = s.builtPlots[0];
  const tooCloseCommit = State.placePlot(s, 'stage', 2, 0); // adjacent to (0,0)'s 2x2 footprint, not overlapping it
  assert(tooCloseCommit.error && /too close/i.test(tooCloseCommit.error), 'placePlot refuses a second stage placed too close to the first');
  const farStage = State.placePlot(s, 'stage', 4, 0);
  assert(farStage.error === null, 'placePlot allows a second stage once it is far enough away');

  // movePlanningPlot: moving the first stage next to another built stage
  // should be refused; relocatePlot mirrors it for an already-built one.
  s = farStage.state;
  const secondStage = s.builtPlots.find(p => p.x === 4 && p.y === 0);
  const moveTooClose = State.movePlanningPlot(s, first.id, 2, 0); // distance 1 from the second stage's footprint at (4,0)-(5,1)
  assert(moveTooClose.error && /too close/i.test(moveTooClose.error), 'movePlanningPlot refuses moving a stage too close to another one');

  let committed = State.commitPlot(s, first.id).state;
  committed = State.commitPlot(committed, secondStage.id).state;
  const builtFirst = committed.builtPlots.find(p => p.x === 0 && p.y === 0);
  const relocateTooClose = State.relocatePlot(committed, builtFirst.id, 2, 0);
  assert(relocateTooClose.error && /too close/i.test(relocateTooClose.error), 'relocatePlot refuses relocating a built stage too close to another built stage');
}

// ---------------------------------------------------------------------
// Stage 12: bigger stage footprints (2x2 vs everything else's 1x1), a
// real path network (a second north-south spur + eastward connector, not
// just one line), and a path-frontage requirement on every built kind.
// ---------------------------------------------------------------------
{
  assert(footprintFor('stage').w === 2 && footprintFor('stage').h === 2, 'a stage\u2019s footprint is 2x2');
  assert(footprintFor('food').w === 1 && footprintFor('food').h === 1, 'a food stall stays 1x1');
  assert(footprintFor('vendor').w === 1 && footprintFor('vendor').h === 1, 'a craft stall stays 1x1');
  assert(footprintFor('demo').w === 1 && footprintFor('demo').h === 1, 'a demo camp stays 1x1');
  assert(footprintFor('unknownKind').w === 1 && footprintFor('unknownKind').h === 1, 'footprintFor defaults to 1x1 for an unrecognized kind');

  const cells = footprintCells(3, 4, 2, 2);
  assert(cells.length === 4 && cells.some(c => c.x === 4 && c.y === 5), 'footprintCells enumerates every cell of a w\u00d7h block anchored at (x,y)');

  // A plot record with no stored w/h (a pre-Stage-12 fixture, or the
  // stage-spacing test fixtures above) falls back to its KIND\u2019s current
  // footprint rather than assuming 1x1.
  const legacyStagePlot = { id: 'plot_x', kind: 'stage', x: 2, y: 2 };
  assert(plotFootprintCells(legacyStagePlot).length === 4, 'plotFootprintCells falls back to footprintFor(kind) when w/h are missing');
  const explicitPlot = { id: 'plot_y', kind: 'stage', x: 2, y: 2, w: 1, h: 1 };
  assert(plotFootprintCells(explicitPlot).length === 1, 'plotFootprintCells honors an explicitly-stored (smaller) w/h over the kind\u2019s current footprint');
}

{
  // quoteBuild now refuses a footprint that would hang off the authored
  // TERRAIN_ROWS edge even when the anchor cell itself is fine.
  const edgeQuote = quoteBuild('stage', 13, 9); // anchor is valid terrain, but (14,9)/(13,10)/(14,10) run off the 14x10 map
  assert(edgeQuote === null, 'quoteBuild refuses a stage footprint that runs off the authored map edge');
  const okQuote = quoteBuild('food', 13, 9); // a 1x1 kind at the same anchor is fine
  assert(okQuote !== null, 'quoteBuild still allows a 1x1 kind at the map\u2019s far corner');

  // isFootprintWithinCurrentGrid: a footprint straddling the fence line is
  // refused even though its anchor cell alone would pass isWithinCurrentGrid.
  const s0 = State.createInitialState(); // Weekend 1, Home Grounds (10x7)
  assert(isWithinCurrentGrid(s0, 9, 6) === true, 'sanity check: (9,6) alone is inside Home Grounds');
  assert(isFootprintWithinCurrentGrid(s0, 'stage', 9, 6) === false, 'a 2x2 stage anchored at the Home Grounds\u2019 far corner still hangs off two edges');
  assert(isFootprintWithinCurrentGrid(s0, 'food', 9, 6) === true, 'a 1x1 kind at the same corner is fine');
}

{
  // Path frontage: hasPathFrontage() directly, then isLegalPlacement's
  // integration of it, then the same rule surfacing through buildPlot.
  assert(hasPathFrontage([{ x: 6, y: 2 }]) === true, 'a cell ON the path has frontage (trivially)');
  assert(hasPathFrontage([{ x: 6, y: 1 }]) === true, 'a cell directly beside the path (south neighbor) has frontage');
  assert(hasPathFrontage([{ x: 6, y: 0 }]) === false, 'a cell two rows from the path (no direct neighbor) has no frontage');
  // A neighbor that's part of the SAME footprint doesn't count as frontage
  // (it's interior, not a street the structure fronts onto).
  const interiorOnly = footprintCells(5, 6, 2, 2); // nowhere near any path or path-adjacent cell
  assert(hasPathFrontage(interiorOnly) === false, 'a footprint stranded away from any path has no frontage');

  // (6,0) is a clearing two rows from the path with no path-adjacent
  // neighbor in any direction \u2014 a 1x1 kind there is refused for lacking
  // frontage (distinct from a terrain ban, which is what blocks stage/demo
  // ON the path itself).
  assert(terrainAt(6, 0) === 'clearing', 'sanity check: (6,0) is clearing, not path, and not adjacent to any path cell');
  const strandedFood = isLegalPlacement('food', 6, 0, []);
  assert(strandedFood.ok === false && /path/i.test(strandedFood.reason), 'isLegalPlacement refuses a food stall with no path frontage');
  const frontedFood = isLegalPlacement('food', 6, 1, []); // south neighbor (6,2) is path
  assert(frontedFood.ok === true, 'isLegalPlacement allows the same kind one row closer, where it fronts the path');

  const strandedBuild = State.buildPlot(State.createInitialState(), 'food', 6, 0);
  assert(strandedBuild.error && /path/i.test(strandedBuild.error), 'buildPlot surfaces the same path-frontage refusal end to end');
}

{
  // Footprint occupancy: a second structure can't be anchored on ANY cell
  // of an already-built stage's 2x2 block, not just its anchor cell.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state; // occupies (3,0),(4,0),(3,1),(4,1)
  const onAnchor = State.buildPlot(s, 'food', 3, 0);
  assert(onAnchor.error && /already built/i.test(onAnchor.error), 'a second plot can\u2019t anchor on the stage\u2019s own anchor cell');
  const onFarCorner = State.buildPlot(s, 'food', 4, 1);
  assert(onFarCorner.error && /already built/i.test(onFarCorner.error), 'a second plot can\u2019t anchor on a NON-anchor cell of the stage\u2019s footprint either');
  const beside = State.buildPlot(s, 'food', 5, 1); // just outside the footprint, with frontage via (5,2)
  assert(beside.error === null, 'a plot just outside the stage\u2019s footprint (with its own frontage) is fine');

  // The built stage record itself carries its footprint size, so a save
  // round-trip (or any later footprint math) knows it's 2x2 without
  // re-deriving it from STRUCTURE_TYPES.
  const builtStage = s.builtPlots.find(p => p.x === 3 && p.y === 0);
  assert(builtStage.w === 2 && builtStage.h === 2, 'a built stage plot stores its own w/h at build time');
}

{
  // loadState migration: a pre-Stage-12 save had every plot at 1x1
  // (including stages, since footprint didn't exist yet) \u2014 loading it
  // must never retroactively balloon an old stage to today's 2x2 and
  // risk it overlapping something the player already built beside it.
  const legacySave = {
    day: 4, season: 1, weekendDay: 1, cash: 1000, reputation: 50, ticketPrice: 16,
    builtPlots: [
      { id: '3_0', kind: 'stage', x: 3, y: 0, name: 'Green Stage', cost: 850, capacity: 220 }, // no status, no w/h — pre-Stage-12 shape
    ],
    roster: [], contracts: {}, hiredVendors: [], vendorContracts: {},
    schedule: {}, activeCampaign: null, campaignCooldowns: {}, phase: 'plan', lastResult: null, history: [], nextPlotId: 1,
  };
  globalThis.localStorage.setItem('renn-faire-sim-save-v1', JSON.stringify(legacySave));
  const migrated = State.loadState();
  const migratedPlot = migrated.builtPlots[0];
  assert(migratedPlot.w === 1 && migratedPlot.h === 1, 'loadState migrates a pre-Stage-12 plot to explicit 1x1, never the kind\u2019s current (bigger) footprint');
  globalThis.localStorage.removeItem('renn-faire-sim-save-v1');
}

// ---------------------------------------------------------------------
{
  // jsdom does not execute <script type="module"> tags (a long-standing
  // jsdom limitation), so instead of relying on index.html's own script
  // tag we build the same DOM shell, install the globals main.js expects
  // (document/window/localStorage/confirm), and import main.js directly —
  // its top-level wire()+render() calls then run exactly as a browser's
  // module script would after parse.
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<link[^>]*fonts\.g[^>]*>/g, '')            // skip network font fetch
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, ''); // we import main.js ourselves below

  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = makeMemoryStorage();
  globalThis.confirm = () => true;

  await import(path.join(root, 'js/main.js') + `?t=${Date.now()}`); // cache-bust so re-imports re-run top-level code

  const doc = dom.window.document;
  assert(!!doc.querySelector('#ledger') && doc.querySelector('#ledger').innerHTML.length > 0, 'index.html boots and #ledger is populated by main.js');
  assert(!!doc.querySelector('#tabs') && doc.querySelector('#tabs').innerHTML.length > 0, '#tabs is populated on boot (plan phase)');
  assert(!!doc.querySelector('[data-action="openGates"]'), 'the Open the Gates button is present on boot');

  const backstageTabBtn = doc.querySelector('[data-tab="backstage"]');
  if (backstageTabBtn) {
    backstageTabBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert(doc.querySelector('#content').innerHTML.includes('Tiring House'), 'clicking the Backstage tab swaps the content panel');
  } else {
    assert(false, 'backstage tab button exists to click');
  }

  const fairFloorTabBtn = doc.querySelector('[data-tab="fairfloor"]');
  fairFloorTabBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(doc.querySelector('.grounds-map'), 'Fair Floor shows the grounds map');
  assert(!doc.querySelector('.plot-marker.ghost'), 'no ghost placement cells before a structure kind is selected');
  assert(doc.querySelector('.grounds-status')?.textContent.includes('Home Grounds'), 'the grounds-status line shows Home Grounds at Weekend 1');
  assert(doc.querySelector('.grounds-status')?.textContent.includes('East Meadow'), 'the grounds-status line names East Meadow as the next expansion at Weekend 1');

  const stageBtn = doc.querySelector('[data-action="selectBuild"][data-kind="stage"]');
  assert(!!stageBtn, 'the build palette has a Stage option');
  stageBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const ghostCell = doc.querySelector('.plot-marker.ghost');
  assert(!!ghostCell, 'selecting a structure kind reveals ghost placement cells on the map');
  const ghostXs = [...doc.querySelectorAll('.plot-marker.ghost')].map(el => Number(el.dataset.x));
  const ghostYs = [...doc.querySelectorAll('.plot-marker.ghost')].map(el => Number(el.dataset.y));
  assert(Math.max(...ghostXs) < 10 && Math.max(...ghostYs) < 7, 'no ghost placement cell is offered past the Weekend-1 fence line (10\u00d77)');

  const cashBefore = doc.querySelector('#ledger .ledger-item .ledger-label.mono')?.textContent;
  ghostCell.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(!doc.querySelector('.plot-marker.ghost'), 'placing a structure exits placement mode (no more ghost cells)');
  assert(doc.querySelector('.plot-marker.planning'), 'Stage 10: a freshly placed structure appears as a planning marker, not a built one, until committed');
  const cashAfterPlace = doc.querySelector('#ledger .ledger-item .ledger-label.mono')?.textContent;
  assert(cashAfterPlace === cashBefore, 'Stage 10: placing a structure is free \u2014 cash does not change until it is committed');

  const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  const commitStageBtn = doc.querySelector('.plot-card[data-kind="stage"] [data-action="commitPlot"]');
  assert(!!commitStageBtn, 'Stage 10: a planning plot\u2019s card has a Commit button');
  click(commitStageBtn);
  assert(doc.querySelector('.plot-marker.built'), 'Stage 10: committing turns the planning marker into a built one');
  const cashAfterCommit = doc.querySelector('#ledger .ledger-item .ledger-label.mono')?.textContent;
  assert(cashAfterCommit !== cashBefore, 'Stage 10: cash on hand changes once the plot is actually committed');

  // Stage 11: with a committed stage now on the map, selecting Stage again
  // shows a blocked marker (not a clickable ghost) on the cell directly
  // touching it, with a reason in its title.
  click(doc.querySelector('[data-action="selectBuild"][data-kind="stage"]')); // re-select Stage build mode
  const blockedCell = doc.querySelector('.plot-marker.blocked');
  assert(!!blockedCell, 'Stage 11: an illegal cell (too close to the just-built stage) renders as a blocked marker, not a ghost');
  assert(/too close/i.test(blockedCell.getAttribute('title')), 'Stage 11: the blocked marker\u2019s title explains why the cell is refused');
  click(doc.querySelector('[data-action="cancelBuild"]')); // deselect before choosing Food Stall next

  // Stage 7/10: build (place + commit) a food plot, then hire a vendor under
  // a Weekend Package through the actual Backstage buttons, confirming the
  // contract-type button, running-commitment tag, seat status, and Let go
  // button all wire correctly.
  const foodBtn = doc.querySelector('[data-action="selectBuild"][data-kind="food"]');
  assert(!!foodBtn, 'the build palette has a Food Stall option');
  click(foodBtn);
  const foodGhost = doc.querySelector('.plot-marker.ghost');
  assert(!!foodGhost, 'selecting Food Stall reveals ghost placement cells');
  click(foodGhost);
  const commitFoodBtn = doc.querySelector('.plot-card[data-kind="food"] [data-action="commitPlot"]');
  assert(!!commitFoodBtn, 'Stage 10: the newly placed food plot has its own Commit button');
  click(commitFoodBtn);

  const backstageTabBtn2 = doc.querySelector('[data-tab="backstage"]');
  click(backstageTabBtn2);
  assert(doc.querySelector('.stall-summary')?.textContent.includes('Food Stalls'), 'Stage 10: Backstage shows the Food Stalls vacancy gauge');
  const weekendHireBtn = doc.querySelector('[data-action="hireVendor"][data-contract="weekend"]');
  assert(!!weekendHireBtn, 'a Weekend Package hire button is present for an uncontracted vendor once a matching stall is committed');
  click(weekendHireBtn);
  assert(doc.querySelector('#content').innerHTML.includes('Weekend Package'), 'the hired vendor row shows its Weekend Package contract label');
  assert(doc.querySelector('#content').innerHTML.includes('seated:'), 'Stage 10: hiring auto-seats the vendor, shown on their roster row');
  const letGoBtn = doc.querySelector('[data-action="fireVendor"]');
  assert(!!letGoBtn, 'a Let go button appears for the newly hired vendor');
  click(letGoBtn);
  assert(doc.querySelector('#content').innerHTML.includes('cancellation fee'), 'letting a Weekend Package vendor go early flashes the cancellation-fee message');

  // Stage 6: walk through a full 3-day weekend via the actual DOM buttons and
  // confirm the weekend-end summary screen appears on schedule, then that
  // starting the next weekend rolls the ledger over.
  for (let day = 1; day <= 3; day++) {
    const gatesBtn = doc.querySelector('[data-action="openGates"]');
    assert(!!gatesBtn, `Open the Gates button is present on weekend day ${day}`);
    click(gatesBtn);
    assert(doc.querySelector('.ticket-stub') && !doc.querySelector('.weekend-summary'), `day ${day}'s report is a normal ticket stub, not the weekend summary`);
    click(doc.querySelector('[data-action="nextDay"]'));
  }
  assert(doc.querySelector('.weekend-summary'), 'the third day\u2019s Next Day click surfaces the weekend-end summary screen');
  assert(!doc.querySelector('[data-tab]'), 'tabs are hidden on the weekend-end summary screen');

  const beginBtn = doc.querySelector('[data-action="startNextWeekend"]');
  assert(!!beginBtn, 'the weekend-end screen has a Begin Next Weekend button');
  click(beginBtn);
  assert(doc.querySelector('#ledger').innerHTML.includes('Weekend 2'), 'starting the next weekend updates the ledger to Weekend 2');
  assert(doc.querySelector('[data-tab]'), 'tabs reappear once the next weekend begins');

  dom.window.close();
}

function makeMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
