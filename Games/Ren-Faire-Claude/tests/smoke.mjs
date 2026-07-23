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
const { makeRng, validateSchedule, simulateDay, QUIRKS, terrainAt, chebyshevDistance, computePlotAttributes, quoteBuild, campaignById, effectivePerformerCost, effectiveVendorCost, isSeasonUnlocked, summarizeWeekend } = await import(path.join(root, 'js/engine.js'));
const { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS } = await import(path.join(root, 'js/data.js'));
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
  assert(offGrid.error && /off the grounds/i.test(offGrid.error), 'buildPlot refuses an off-grid cell');

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
// Section 2: DOM boot test (jsdom) — index.html loads, main.js runs, key
// elements exist, tab-switching works, and the Stage 3 build-placement
// flow (pick a kind, tap an open cell) works end to end.
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

  const stageBtn = doc.querySelector('[data-action="selectBuild"][data-kind="stage"]');
  assert(!!stageBtn, 'the build palette has a Stage option');
  stageBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const ghostCell = doc.querySelector('.plot-marker.ghost');
  assert(!!ghostCell, 'selecting a structure kind reveals ghost placement cells on the map');

  const cashBefore = doc.querySelector('#ledger .ledger-item .ledger-label.mono')?.textContent;
  ghostCell.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(!doc.querySelector('.plot-marker.ghost'), 'placing a structure exits placement mode (no more ghost cells)');
  assert(doc.querySelector('.plot-marker.built'), 'the newly built structure appears as a built marker on the map');
  const cashAfter = doc.querySelector('#ledger .ledger-item .ledger-label.mono')?.textContent;
  assert(cashAfter !== cashBefore, 'cash on hand changed after paying to build the placed structure');

  const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  // Stage 7: build a food plot, then hire a vendor under a Weekend Package
  // through the actual Backstage buttons, confirming the contract-type
  // button, running-commitment tag, and Let go button all wire correctly.
  const foodBtn = doc.querySelector('[data-action="selectBuild"][data-kind="food"]');
  assert(!!foodBtn, 'the build palette has a Food Stall option');
  click(foodBtn);
  const foodGhost = doc.querySelector('.plot-marker.ghost');
  assert(!!foodGhost, 'selecting Food Stall reveals ghost placement cells');
  click(foodGhost);

  const backstageTabBtn2 = doc.querySelector('[data-tab="backstage"]');
  click(backstageTabBtn2);
  const weekendHireBtn = doc.querySelector('[data-action="hireVendor"][data-contract="weekend"]');
  assert(!!weekendHireBtn, 'a Weekend Package hire button is present for an uncontracted vendor');
  click(weekendHireBtn);
  assert(doc.querySelector('#content').innerHTML.includes('Weekend Package'), 'the hired vendor row shows its Weekend Package contract label');
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
