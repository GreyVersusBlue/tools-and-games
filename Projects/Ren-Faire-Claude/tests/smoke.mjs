// tests/smoke.mjs — plain-Node smoke suite. No test framework: a tiny
// assert() counter, same pattern as this account's other JS sims
// (see fourth-quarter's smokeN.js). Run with `npm test` or `node tests/smoke.mjs`.

import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// import() takes a URL, not a path. On Windows a bare absolute path starts with
// a drive letter, which Node reads as the URL scheme "c:" and refuses outright
// (ERR_UNSUPPORTED_ESM_URL_SCHEME), so this whole suite was unrunnable there.
// It works on Linux and macOS only because a POSIX absolute path happens to be
// a valid relative URL.
const mod = p => pathToFileURL(path.join(root, p)).href;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

// ---------------------------------------------------------------------
// Section 1: pure engine.js logic (no DOM)
// ---------------------------------------------------------------------
const { makeRng, validateSchedule, simulateDay, QUIRKS, terrainAt, chebyshevDistance, computePlotAttributes, quoteBuild, isLegalPlacement, campaignById, effectivePerformerCost, effectiveVendorCost, isSeasonUnlocked, summarizeWeekend, currentGridSize, nextGridExpansion, isWithinCurrentGrid, effectivePopularity, EVENT_REQUIREMENTS, EVENT_EFFECTS, stallSummary, STALL_KIND_BY_VENDOR_TYPE, footprintFor, footprintCells, plotFootprintCells, isFootprintWithinCurrentGrid, hasPathFrontage, plotUpkeep, totalUpkeep, computeFootTraffic, measureFootTraffic, countBuiltOfKind, previewCommitAll, checkBankruptcy, checkWinCondition, computePathDistances, reachabilityDistance, computeReachability, computeGroundsDraw, priceFactor, ticketRevenueIndex, priceSatisfactionDelta, blockQualityWeights, weatherById, weatherFor, weatherWeightAt, rollWeather, nextCalendarDay, forecastWeather, performerFor, vendorFor, traitRateMult, relationshipOf, relationshipTier, contractedActIds, bestBlockFor, offerDiscount, relationshipRateMult, quoteContract, beatById, actNameOf, pendingBeats, performerById, vendorById, isExpansionUnlocked, renownOf, moodRenown, weekendRenown, signingBar, nextRunSeed, previewPlacement, PREVIEW_PLOT_ID, reachabilityDistance: reachabilityDistanceOf } = await import(mod('js/engine.js'));
const { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS, PLACEMENT_RULES, EVENT_POOL, ENTRANCE, GROUNDS_DRAW, WEEKEND_DAY_ATTENDANCE, GUESTS, WEATHER, WEATHER_SEASON_SPAN, WEATHER_SHADE_CEILING, DEFAULT_WEATHER_ID, RELATIONSHIP, NEGOTIATION, ARCS, RENOWN, CARRYOVER } = await import(mod('js/data.js'));
const { previewLine, readoutDefault, readoutFor } = await import(mod('js/ui.js'));
const State = await import(mod('js/state.js'));
// Phase 6: the plat's geometry, read here for the CSS-agreement checks in
// Sections 23, 24 and 29. Its own suite is tests/mapview.mjs.
const { TRACK, FRAME, MARKER_MARGIN, createView, minScaleFor, markerSize, fit, withViewport, trackTransform, stageHeight, contentSize, KEY_ZOOM } = await import(mod('js/mapview.js'));

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
  // Built off the map's own keys rather than a hand-typed list: Phase 3
  // added two flags and the typed version read them as `undefined`, which
  // is not `false`, so both went red for a reason that was not a bug.
  const ctxAllFalse = Object.fromEntries(Object.keys(EVENT_REQUIREMENTS).map(k => [k, false]));
  assert(Object.keys(ctxAllFalse).length >= 8, `the all-false ctx covers every EVENT_REQUIREMENTS key (${Object.keys(ctxAllFalse).length})`);
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

// --- Stage 15: countBuiltOfKind + quoteBuild's escalating build cost ---
{
  assert(countBuiltOfKind([], 'stage') === 0, 'countBuiltOfKind is 0 for an empty list');
  assert(countBuiltOfKind(undefined, 'stage') === 0, 'countBuiltOfKind handles a missing plot list');

  const builtA = { id: 'a', kind: 'food', x: 6, y: 2, status: 'built' };
  const builtB = { id: 'b', kind: 'food', x: 6, y: 3, status: 'built' };
  const planningC = { id: 'c', kind: 'food', x: 6, y: 4, status: 'planning' };
  const builtStage = { id: 'd', kind: 'stage', x: 3, y: 0, status: 'built' };
  const pool = [builtA, builtB, planningC, builtStage];

  assert(countBuiltOfKind(pool, 'food') === 2, 'countBuiltOfKind counts only built plots of the given kind');
  assert(countBuiltOfKind(pool, 'food', 'a') === 1, 'countBuiltOfKind excludes the given id (for relocating a plot against itself)');
  assert(countBuiltOfKind(pool, 'stage') === 1, 'countBuiltOfKind is kind-specific');

  // No builtPlots arg (or an empty one) means zero escalation, exactly like
  // pre-Stage-15 behavior — every existing call site/test that doesn't pass
  // one still prices flat off terrain alone.
  const bare = quoteBuild('food', 6, 2);
  assert(bare.builtCount === 0 && bare.escalationMult === 1, 'quoteBuild with no builtPlots arg has zero escalation (backward compatible)');

  const oneBuilt = quoteBuild('food', 6, 3, [builtA]);
  assert(oneBuilt.builtCount === 1, 'quoteBuild counts one already-built same-kind plot');
  assert(oneBuilt.cost > bare.cost, 'a second food stall costs more than the first once one is already built');
  assert(Math.abs(oneBuilt.escalationMult - (1 + CONFIG.escalatingBuildCostRate)) < 1e-9, 'escalationMult is (1+rate)^builtCount');

  const twoBuilt = quoteBuild('food', 6, 4, [builtA, builtB]);
  assert(twoBuilt.cost > oneBuilt.cost, 'a third food stall costs more than the second (escalation compounds)');
  const expectedMult = Math.pow(1 + CONFIG.escalatingBuildCostRate, 2);
  assert(Math.abs(twoBuilt.escalationMult - expectedMult) < 1e-9, 'escalationMult compounds as (1+rate)^builtCount for a 2nd already-built plot');

  // planning plots never count toward escalation, mirroring plotUpkeep's rule
  const withPlanning = quoteBuild('food', 6, 4, [builtA, planningC]);
  assert(withPlanning.builtCount === 1, 'a still-planning same-kind plot does not count toward escalation');

  // a different kind entirely (stage) is unaffected by two built food stalls
  const stageQuote = quoteBuild('stage', 3, 0, [builtA, builtB]);
  assert(stageQuote.builtCount === 0, 'escalation is kind-specific \u2014 built food stalls don\u2019t escalate a stage\u2019s price');

  // excludeId lets a plot's own already-built record be omitted from its
  // own relocate/move quote, so it never inflates its own price
  const selfQuote = quoteBuild('food', 6, 5, [builtA], 'a');
  assert(selfQuote.builtCount === 0, 'excludeId omits that plot from its own count (for relocating it)');
}

// --- Stage 16: checkBankruptcy / checkWinCondition (pure) ---
{
  assert(checkBankruptcy(CONFIG.bankruptcyFloor) === true, 'checkBankruptcy is true exactly AT the floor');
  assert(checkBankruptcy(CONFIG.bankruptcyFloor + 1) === false, 'checkBankruptcy is false one dollar above the floor');
  assert(checkBankruptcy(CONFIG.bankruptcyFloor - 1) === true, 'checkBankruptcy is true below the floor');
  assert(checkBankruptcy(CONFIG.startingCash) === false, 'checkBankruptcy is false at a healthy starting cash balance');

  const w = CONFIG.winCondition;
  const base = { season: w.seasonTarget, reputation: w.minReputation, cash: w.minCash };
  assert(checkWinCondition(base) === true, 'checkWinCondition passes when every threshold is met exactly');
  assert(checkWinCondition({ ...base, season: w.seasonTarget - 1 }) === false, 'checkWinCondition fails one weekend short of the target');
  assert(checkWinCondition({ ...base, reputation: w.minReputation - 1 }) === false, 'checkWinCondition fails one reputation point short');
  assert(checkWinCondition({ ...base, cash: w.minCash - 1 }) === false, 'checkWinCondition fails one dollar short of the cash minimum');
  assert(checkWinCondition({ ...base, season: w.seasonTarget + 4 }) === true, 'checkWinCondition still passes well past the target weekend');
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

// --- Stage 14: computePlotAttributes' demo-camp traffic bonus ---
{
  const demoCamp = { id: '3_2_demo', kind: 'demo', x: 3, y: 2 };
  const farDemo = { id: '9_9_demo', kind: 'demo', x: 9, y: 9 };
  const foodPlot = { id: '2_2', kind: 'food', x: 2, y: 2 };
  const stagePlot = { id: '2_2s', kind: 'stage', x: 2, y: 2 };

  const bare = computePlotAttributes(foodPlot, []);
  assert(bare.nearbyDemos === 0, 'a food plot has zero nearby demo camps with nothing built');

  const nearDemo = computePlotAttributes(foodPlot, [demoCamp]);
  assert(nearDemo.nearbyDemos === 1, 'nearbyDemos counts the one built demo camp in range');
  assert(nearDemo.traffic > bare.traffic, 'a nearby built demo camp raises a food/vendor plot\u2019s traffic');

  const withFarDemo = computePlotAttributes(foodPlot, [farDemo]);
  assert(withFarDemo.nearbyDemos === 0, 'a demo camp far outside the adjacency radius does not count as nearby');

  // A demo camp's traffic bonus is food/vendor-only \u2014 it doesn't touch a
  // stage's sightline math (only nearbyStages does that).
  const stageBare = computePlotAttributes(stagePlot, []);
  const stageNearDemo = computePlotAttributes(stagePlot, [demoCamp]);
  assert(stageNearDemo.sightline === stageBare.sightline, 'a nearby demo camp does not affect a stage\u2019s sightline');
}

// --- Stage 14: computeFootTraffic ---
{
  assert(Object.keys(computeFootTraffic([])).length === 0, 'computeFootTraffic returns nothing with no built plots');
  assert(Object.keys(computeFootTraffic(undefined)).length === 0, 'computeFootTraffic handles an undefined plot list');

  // A single built stall's foot traffic is always exactly average (mult 1)
  // no matter where it sits \u2014 there's nothing to compare it against yet.
  // This is also the regression guarantee: a lone stall's economics must
  // come out identical to the pre-Stage-14 flat formula.
  const soloStall = { id: 'solo', kind: 'food', x: 8, y: 5, status: 'built', cost: 480 };
  const solo = computeFootTraffic([soloStall]);
  assert(solo.solo && solo.solo.mult === 1, 'a lone built stall always has a foot-traffic multiplier of exactly 1');

  // A stall still in "planning" isn't really on the grounds yet \u2014 it's
  // excluded from the result AND from the mean the other stalls are
  // measured against (mirrors every other planning-plot rule already in
  // the engine).
  const planningStall = { id: 'plan', kind: 'food', x: 1, y: 1, status: 'planning', cost: 480 };
  const withPlanning = computeFootTraffic([soloStall, planningStall]);
  assert(withPlanning.solo.mult === 1 && withPlanning.plan === undefined, 'a planning stall is excluded from computeFootTraffic entirely');

  // Two stalls, one clearly better-sited (near a built stage) than the
  // other (isolated woods) \u2014 the better one should sell better, the
  // worse one worse, both bounded within the documented clamp.
  const crossingStage = { id: 'stage1', kind: 'stage', x: 3, y: 0, status: 'built', cost: 850 };
  const goodStall = { id: 'good', kind: 'food', x: 4, y: 2, status: 'built', cost: 480 }; // adjacent to the stage
  const badStall = { id: 'bad', kind: 'food', x: 9, y: 9, status: 'built', cost: 480 }; // far away, alone
  const shares = computeFootTraffic([crossingStage, goodStall, badStall]);
  assert(shares.good.mult > 1, 'a well-sited stall (near a built stage) earns a foot-traffic multiplier above 1');
  assert(shares.bad.mult < 1, 'a poorly-sited, isolated stall earns a foot-traffic multiplier below 1');
  for (const key of Object.keys(shares)) {
    assert(shares[key].mult >= 0.6 && shares[key].mult <= 1.6, `${key}\u2019s foot-traffic multiplier stays within the documented clamp`);
  }

  // Stage kind is never included in the result \u2014 only food/vendor stalls
  // have a foot-traffic multiplier at all.
  assert(shares.stage1 === undefined, 'computeFootTraffic never includes a stage in its result');
}

// --- Phase 1 increment 2: measureFootTraffic, the estimate's measured twin ---
{
  const seated = (id, x, y) => ({ id, kind: 'food', x, y, status: 'built', cost: 480, assignedVendorId: 'vend_stew' });
  assert(Object.keys(measureFootTraffic({}, [])).length === 0, 'measureFootTraffic returns nothing with no built stalls');
  assert(Object.keys(measureFootTraffic(undefined, undefined)).length === 0, 'measureFootTraffic handles undefined arguments');

  const lone = seated('lone', 6, 1);
  const one = measureFootTraffic({ lone: 90 }, [lone]);
  assert(one.lone.mult === 1 && one.lone.arrivals === 90, 'a lone seated stall is its own mean, so exactly 1x, and carries its raw arrival count');

  // An unstaffed stall is a shed: it is not measured, and it does not drag
  // the mean the staffed ones are scored against. Same rule the walk and
  // computeGroundsDraw already follow.
  const shed = { id: 'shed', kind: 'food', x: 9, y: 1, status: 'built', cost: 480 };
  const withShed = measureFootTraffic({ lone: 90, shed: 0 }, [lone, shed]);
  assert(withShed.shed === undefined && withShed.lone.mult === 1, 'an unstaffed stall is measured nowhere and moves nobody\u2019s mean');

  const busy = seated('busy', 6, 1), quiet = seated('quiet', 9, 1);
  const pair = measureFootTraffic({ busy: 120, quiet: 80 }, [busy, quiet]);
  assert(pair.busy.mult > 1 && pair.quiet.mult < 1, 'the better-walked stall scores above 1x and the other below');
  assert(Math.abs(pair.busy.mult + pair.quiet.mult - 2) < 1e-9, 'inside the clamp band the two multipliers average to exactly 1 \u2014 this is a share of the day, not an absolute');

  // Same clamp band as the estimate, so the two numbers are comparable to
  // the eye on the report. A stall nobody reached sits on the floor rather
  // than dropping off the report; it earns nothing either way, because
  // sales come off the till and not off this number.
  const lopsided = measureFootTraffic({ busy: 1000, quiet: 0 }, [busy, quiet]);
  assert(lopsided.busy.mult === 1.6 && lopsided.quiet.mult === 0.6, 'both ends clamp to the same 0.6x-1.6x band computeFootTraffic uses');
  assert(lopsided.quiet.arrivals === 0, 'and a stall nobody walked to still reports its zero');
}

// --- Stage 17: computePathDistances (BFS from ENTRANCE) ---
{
  const dist = computePathDistances();
  assert(dist.get(`${ENTRANCE.x},${ENTRANCE.y}`) === 0, 'ENTRANCE itself is distance 0');
  assert(terrainAt(ENTRANCE.x, ENTRANCE.y) === 'path', 'ENTRANCE sits on a path tile, as the BFS requires');
  // The row-2 artery runs the grid's full authored width (Stage 8/12 both
  // rely on this), so the far east end should be exactly GRID.cols-1 hops.
  assert(dist.get(`${GRID.cols - 1},2`) === GRID.cols - 1, 'the row-2 artery is a straight, fully-connected walk from end to end');
  // A non-path cell never appears in the distance map at all.
  assert(dist.get('0,0') === undefined, 'a non-path cell (a hill/woods/clearing tile) never gets a BFS distance');
  // Same object every call \u2014 the terrain map is static, so this is safe
  // to memoize (see the "computed once" comment above the function).
  assert(computePathDistances() === dist, 'computePathDistances() memoizes its result across calls');
  // Content note (see HANDOFF's Stage 17 retro): the col-3 spur has an
  // authoring gap at row 3, leaving rows 4+ of that spur unreachable from
  // ENTRANCE by any path-tile walk, even though the tiles are still 'path'
  // terrain and still legally buildable-against per hasPathFrontage. This
  // assertion pins that discovery down as a known, tested fact rather than
  // a silent surprise for a future stage to re-debug from scratch.
  assert(dist.get('3,2') === 3 && dist.get('3,4') === undefined, 'the col-3 spur is disconnected from the gate at row 3 \u2014 a pre-existing terrain-authoring gap, not a Stage 17 bug');
}

// --- Stage 17: reachabilityDistance + computeReachability ---
{
  // A stage built right on the row-2 artery, one built far down the col-10
  // spur \u2014 same kind (stage), so they're compared against each other's
  // mean directly, and the artery one should read as closer to the gate.
  const nearStage = { id: 'nearStage', kind: 'stage', x: 2, y: 1, w: 2, h: 2, status: 'built' }; // fronts row 2 at x=2..3
  const farStage = { id: 'farStage', kind: 'stage', x: 9, y: 8, w: 2, h: 2, status: 'built' }; // deep down the col-10 spur
  assert(reachabilityDistance(nearStage) < reachabilityDistance(farStage), 'a stage built near the gate resolves to a shorter gate-walk than one built far down a spur');

  const reach = computeReachability([nearStage, farStage]);
  assert(reach.nearStage.mult > 1 && reach.farStage.mult < 1, 'the near-gate stage scores above 1x and the far one below, relative to each other');
  for (const key of Object.keys(reach)) {
    assert(reach[key].mult >= 0.8 && reach[key].mult <= 1.2, `${key}\u2019s reachability multiplier stays within the documented 0.8x-1.2x clamp`);
  }

  // A single built plot of a kind is always exactly 1x \u2014 mirrors
  // computeFootTraffic's same backward-compatible guarantee.
  const solo = computeReachability([nearStage]);
  assert(solo.nearStage.mult === 1, 'a lone built plot of a kind always has a reachability multiplier of exactly 1');

  // Stages and stalls are scored against their OWN kind-group's mean, not
  // pooled together \u2014 so a lone stall's score is untouched by a stage
  // built elsewhere, even a very differently-sited one.
  const soloStall = { id: 'soloStall', kind: 'food', x: 6, y: 2, status: 'built' }; // right on the artery
  const grouped = computeReachability([farStage, soloStall]);
  assert(grouped.soloStall.mult === 1, 'a lone stall\u2019s reachability is unaffected by an unrelated stage built elsewhere (stages/stalls scored in separate groups)');

  // A still-planning plot doesn't functionally exist on the grounds yet
  // (same rule every other siting mechanic already follows) \u2014 excluded
  // entirely, from both the result and the mean.
  const planningStage = { id: 'planStage', kind: 'stage', x: 2, y: 1, w: 2, h: 2, status: 'planning' };
  const withPlanning = computeReachability([nearStage, planningStage]);
  assert(withPlanning.nearStage.mult === 1 && withPlanning.planStage === undefined, 'a planning plot is excluded from computeReachability entirely');

  // A plot built against the disconnected col-3 spur (see the BFS test
  // above) has no finite gate-walk at all \u2014 it's pinned straight to the
  // worst multiplier rather than corrupting the group's mean with Infinity.
  const cutOffStall = { id: 'cutOff', kind: 'food', x: 4, y: 5, status: 'built' }; // fronts the col-3 spur at (3,5), past the row-3 gap
  assert(!Number.isFinite(reachabilityDistance(cutOffStall)), 'a plot fronting the disconnected col-3 spur has no finite path-distance to the gate');
  const withCutOff = computeReachability([soloStall, cutOffStall]);
  assert(withCutOff.cutOff.mult === 0.8, 'a gate-unreachable plot is pinned to the worst (0.8x) reachability multiplier, not NaN or Infinity');
  assert(Number.isFinite(withCutOff.soloStall.mult) && withCutOff.soloStall.mult > 0, 'the OTHER (reachable) plot in the group is unaffected by the unreachable one\u2019s distance');
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

  // demo, not food: (3,0) is a hill cell, and Stage 18 banned food/vendor
  // stalls from hills \u2014 using demo here keeps this test isolated to the
  // occupancy check it's actually named for.
  const dup = State.buildPlot(afterBuild, 'demo', 3, 0);
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

// --- Stage 15: escalating build cost, end to end through the state actions ---
{
  // (2,3) and (5,3) are both clearing cells with path frontage onto row 2,
  // spaced far enough apart to clear Stage 18's same-kind stall spacing rule.
  let s = State.createInitialState();
  let r1 = State.buildPlot(s, 'food', 2, 3);
  assert(r1.error === null, 'first food stall builds normally');
  const firstCost = r1.state.builtPlots[0].cost;
  const r2 = State.buildPlot(r1.state, 'food', 5, 3);
  assert(r2.error === null, 'second food stall builds normally');
  const secondCost = r2.state.builtPlots[1].cost;
  assert(secondCost > firstCost, 'buildPlot: a second built food stall costs more than the first, via escalating build cost');
  assert(secondCost === Math.round(firstCost * (1 + CONFIG.escalatingBuildCostRate) / 10) * 10, 'the escalated cost matches (1+rate) times the base, rounded to the nearest $10');

  // a different kind (stage) is unaffected by the two built food stalls
  const stageAfterFoods = State.buildPlot(r2.state, 'stage', 3, 0);
  const bareStageQuote = quoteBuild('stage', 3, 0);
  assert(stageAfterFoods.state.builtPlots.find(p => p.kind === 'stage').cost === bareStageQuote.cost, 'building a stage after two food stalls is unaffected \u2014 escalation is kind-specific');
}

// --- Stage 15: commitAllPlots escalates a same-kind batch against each
// other in commit order, closing the loophole where planning several
// same-kind plots before committing any would otherwise let every one of
// them quote at "1st built" pricing ---
{
  let s = State.createInitialState();
  let r = State.placePlot(s, 'food', 2, 3);
  assert(r.error === null, 'first food stall plans for free');
  const planCost1 = r.state.builtPlots[0].cost;
  s = r.state;
  r = State.placePlot(s, 'food', 5, 3);
  assert(r.error === null, 'second food stall also plans for free');
  const planCost2 = r.state.builtPlots[1].cost;
  s = r.state;
  // Both still quote at "nothing built yet" pricing since neither is committed
  assert(planCost1 === planCost2, 'two planning-status food stalls quote identically \u2014 neither counts as built yet');

  const sequential = State.createInitialState();
  const seq1 = State.buildPlot(sequential, 'food', 2, 3);
  const seq2 = State.buildPlot(seq1.state, 'food', 5, 3);
  const sequentialTotal = seq1.state.builtPlots[0].cost + seq2.state.builtPlots[1].cost;

  const batchRes = State.commitAllPlots(s);
  assert(batchRes.error === null, 'commitAllPlots succeeds for an affordable batch');
  assert(batchRes.count === 2, 'commitAllPlots commits both planning plots');
  assert(batchRes.total === sequentialTotal, 'committing two same-kind plans together charges the same total as building them one at a time, not the flat sum of their stale planning-time quotes');
  const committedCosts = batchRes.state.builtPlots.map(p => p.cost).sort((a, b) => a - b);
  assert(committedCosts[0] < committedCosts[1], 'the two committed plots end up with escalating costs, not identical stale ones');
}

// --- Stage 15: relocatePlot excludes the plot's own built record from its
// own new-site quote (otherwise it would inflate its own relocate price) ---
{
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 2, 3).state;
  const lonePlot = s.builtPlots[0];
  // Relocating the only built food stall to a fresh spot should quote at
  // "0 already built" (excluding itself), not "1 already built".
  const relocateQuoteExcludingSelf = quoteBuild('food', 3, 3, s.builtPlots, lonePlot.id);
  const bareQuote = quoteBuild('food', 3, 3);
  assert(relocateQuoteExcludingSelf.cost === bareQuote.cost, 'a lone built plot relocating to a new site is quoted as if it were the first of its kind, not the second');

  const relocated = State.relocatePlot(s, lonePlot.id, 3, 3);
  assert(relocated.error === null, 'relocatePlot succeeds');
  assert(relocated.state.builtPlots[0].cost === bareQuote.cost, 'the relocated plot\u2019s stored cost reflects excluding itself from escalation');
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

// --- Stage 16: bankruptcy (loss condition) ---
{
  let s = State.createInitialState();
  assert(s.bankrupt === false, 'a fresh game starts not-bankrupt');

  // Start already ruinously deep in the hole — deep enough that even a
  // fully healthy day's ticket revenue (there's no plots built here to
  // suppress attendance/ticket sales, only stage-dependent extras) can't
  // possibly bring cash back above the floor — so runDay's result is
  // guaranteed to land at/under it regardless of the day's own cashDelta.
  const ruined = { ...s, cash: CONFIG.bankruptcyFloor - 50000 };
  const { state: afterRuin } = State.runDay(ruined, 11);
  assert(afterRuin.bankrupt === true, 'runDay flags bankrupt once cash is already at/under the floor');
  assert(afterRuin.phase === 'report', 'a bankrupt day still shows the normal report ticket first, not gameOver directly');

  // nextDay(), called from that report screen, is what actually routes to
  // the terminal gameOver phase — and does so WITHOUT ticking day/weekendDay
  // or any contracts/campaigns further.
  const dayBefore = afterRuin.day, weekendDayBefore = afterRuin.weekendDay;
  const ended = State.nextDay(afterRuin).state;
  assert(ended.phase === 'gameOver', 'nextDay routes to gameOver once the prior day left the state bankrupt');
  assert(ended.day === dayBefore && ended.weekendDay === weekendDayBefore, 'nextDay does not advance day/weekendDay once the run has ended in bankruptcy');

  // Calling nextDay again on an already-gameOver state is a stable no-op
  // (still bankrupt, still gameOver) rather than throwing or resurrecting.
  const endedAgain = State.nextDay(ended).state;
  assert(endedAgain.phase === 'gameOver', 'nextDay on an already-gameOver state stays in gameOver');

  // A healthy day, by contrast, never sets the flag.
  const { state: healthyAfter } = State.runDay(s, 5);
  assert(healthyAfter.bankrupt === false, 'a normal day with healthy cash never flags bankrupt');
}

// --- Stage 16: the win condition (one-time victory milestone) ---
{
  const w = CONFIG.winCondition;
  // Craft a state sitting one day short of the win-condition weekend, with
  // reputation/cash already past both thresholds, so the very next
  // weekend-boundary tick is the one that should fire victory.
  let s = {
    ...State.createInitialState(),
    season: w.seasonTarget,
    weekendDay: CONFIG.seasonLength, // today is the weekend's last day
    reputation: w.minReputation,
    cash: w.minCash,
  };
  const afterLastDay = State.nextDay(s).state;
  assert(afterLastDay.phase === 'victory', 'nextDay fires the victory phase at the weekend boundary once every threshold is met');
  assert(afterLastDay.victoryAchieved === true, 'victoryAchieved flips true the moment the milestone fires');
  assert(afterLastDay.season === w.seasonTarget && afterLastDay.weekendDay === CONFIG.seasonLength, 'day/weekendDay/season do NOT advance yet while parked in victory, same as weekendEnd');

  const acked = State.acknowledgeVictory(afterLastDay).state;
  assert(acked.phase === 'weekendEnd', 'acknowledgeVictory drops into the normal weekend-end summary screen');
  assert(acked.victoryAchieved === true, 'acknowledgeVictory leaves victoryAchieved set (so it cannot refire)');
  assert(acked.cash === afterLastDay.cash && acked.reputation === afterLastDay.reputation, 'acknowledgeVictory does not alter cash/reputation \u2014 purely a phase transition');

  const rolledOver = State.startNextWeekend(acked).state;
  assert(rolledOver.phase === 'plan' && rolledOver.season === w.seasonTarget + 1, 'the sandbox continues normally into the next weekend after victory is acknowledged');

  // Reaching (or re-passing) the threshold again on a later weekend must
  // NOT refire victory now that victoryAchieved is already true.
  let s2 = { ...rolledOver, weekendDay: CONFIG.seasonLength };
  const secondBoundary = State.nextDay(s2).state;
  assert(secondBoundary.phase === 'weekendEnd', 'a later weekend boundary that still meets every threshold does not refire victory once already achieved');

  // And falling short of any one threshold at the target weekend simply
  // proceeds to the normal weekendEnd screen, no victory.
  let short = {
    ...State.createInitialState(),
    season: w.seasonTarget,
    weekendDay: CONFIG.seasonLength,
    reputation: w.minReputation - 1,
    cash: w.minCash,
  };
  const notYet = State.nextDay(short).state;
  assert(notYet.phase === 'weekendEnd', 'falling one reputation point short at the target weekend does not fire victory');
  assert(notYet.victoryAchieved === false, 'victoryAchieved stays false when the threshold is not actually met');
}

// --- Stage 16: loadState migration for pre-Stage-16 saves ---
{
  const preStage16 = State.createInitialState();
  delete preStage16.bankrupt;
  delete preStage16.victoryAchieved;
  const raw = JSON.stringify(preStage16);
  globalThis.localStorage = { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
  const migrated = State.loadState();
  assert(migrated.bankrupt === false, 'loadState backfills bankrupt:false onto a pre-Stage-16 save');
  assert(migrated.victoryAchieved === false, 'loadState backfills victoryAchieved:false onto a pre-Stage-16 save');
  delete globalThis.localStorage;
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
  let guestsOk = true;
  let endedEarly = false;
  for (let i = 0; i < 50; i++) {
    try {
      const { state: next, result } = State.runDay(s, i * 31 + 7);
      if (Number.isNaN(result.cashDelta) || Number.isNaN(result.satisfaction)) ok = false;
      if (result.attendance < 0) ok = false;
      // Phase 1: the crowd walked, nobody left the path network, and no
      // number the walk reports is NaN or Infinity.
      if (!result.guests || result.guests.offGrid !== 0) guestsOk = false;
      for (const v of Object.values(result.guests || {})) if (typeof v === 'number' && !Number.isFinite(v)) guestsOk = false;
      if (result.attendance > 0 && result.guests && result.guests.sampled !== Math.min(result.attendance, GUESTS.sampleCap)) guestsOk = false;
      s = State.nextDay(next).state;
      // Stage 16: victory and bankruptcy are now legitimate outcomes of a
      // long random run, not failures of the fuzz test itself. Victory
      // acknowledges-then-proceeds exactly like a player would; bankruptcy
      // is terminal for this save, so the loop stops early on purpose.
      if (s.phase === 'victory') s = State.acknowledgeVictory(s).state;
      if (s.phase === 'weekendEnd') s = State.startNextWeekend(s).state;
      if (s.phase === 'gameOver') { endedEarly = true; break; }
    } catch (e) {
      ok = false;
      console.error(e);
      break;
    }
  }
  assert(ok, '50-day fuzz run completes with no throws, no NaNs, no negative attendance');
  assert(guestsOk, '50-day fuzz run: every day\'s crowd walked with nobody off-grid, no NaN in the walk\'s report, and a sample sized to the gate');
  assert(s.day === 51 || (endedEarly && s.phase === 'gameOver'), '50-day fuzz run advanced the day counter the expected number of times, or ended early in a legitimate bankruptcy');
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

  // demo, not food: (3,0) is a hill cell, banned for food stalls since
  // Stage 18 \u2014 demo keeps this test isolated to the occupancy check.
  const dupPlace = State.placePlot(s, 'demo', 3, 0);
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
  // Row 2 is path the whole way across; these three sit 3 cells apart so
  // Stage 18's same-kind stall spacing rule doesn't block any of them.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'food', 1, 2).state;
  s = State.buildPlot(s, 'food', 4, 2).state;
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
  let fillTest = State.buildPlot(reassigned.state, 'food', 7, 2).state;
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
  s = State.buildPlot(s, 'food', 9, 2).state;
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
  // demo, not food: (2,1) is a hill cell, banned for food/vendor since
  // Stage 18 \u2014 demo isn't, so this stays a pure stage-spacing test.
  const nonStageNearby = isLegalPlacement('demo', 2, 1, existingStage);
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
// Stage 18: three more legality rules on the same PLACEMENT_RULES/
// isLegalPlacement pattern Stage 11/12 established — a hill ban for
// food/vendor stalls, same-kind stall spacing, and a demo camp cap.
// ---------------------------------------------------------------------
{
  // data integrity: the new PLACEMENT_RULES entries exist and are shaped
  // as isLegalPlacement expects.
  assert(Array.isArray(PLACEMENT_RULES.terrainBans.food) && PLACEMENT_RULES.terrainBans.food.includes('hill'), 'PLACEMENT_RULES bans food stalls from hill terrain');
  assert(Array.isArray(PLACEMENT_RULES.terrainBans.vendor) && PLACEMENT_RULES.terrainBans.vendor.includes('hill'), 'PLACEMENT_RULES bans craft stalls from hill terrain too');
  assert(Array.isArray(PLACEMENT_RULES.stallSpacingKinds) && PLACEMENT_RULES.stallSpacingKinds.includes('food') && PLACEMENT_RULES.stallSpacingKinds.includes('vendor'), 'PLACEMENT_RULES applies stall spacing to both food and craft stalls');
  assert(typeof PLACEMENT_RULES.minStallSpacing === 'number', 'PLACEMENT_RULES defines a numeric minStallSpacing');
  assert(PLACEMENT_RULES.maxBuiltByKind && PLACEMENT_RULES.maxBuiltByKind.demo === 3, 'PLACEMENT_RULES caps demo camps at 3');
}

{
  // Hill ban: a food/craft stall can't be built on a hill; a stage and a
  // demo camp both still can (a stage's best terrain, a demo's fixed camp
  // site). (2,1) is a hill cell with path frontage via its south neighbor.
  assert(terrainAt(2, 1) === 'hill', 'sanity check: (2,1) is a hill cell');
  const foodOnHill = isLegalPlacement('food', 2, 1, []);
  assert(foodOnHill.ok === false && /hill/i.test(foodOnHill.reason), 'isLegalPlacement refuses a food stall on a hill');
  const vendorOnHill = isLegalPlacement('vendor', 2, 1, []);
  assert(vendorOnHill.ok === false && /hill/i.test(vendorOnHill.reason), 'isLegalPlacement refuses a craft stall on a hill too');
  // (2,0) anchors a full 2x2 hill footprint \u2014 (2,1) alone would have the
  // stage's footprint spill onto the path row at (2,2)/(3,2), which is a
  // separate, correct refusal (stage still can't touch the path) that
  // isn't what this check is testing.
  const stageOnHill = isLegalPlacement('stage', 2, 0, []);
  assert(stageOnHill.ok === true, 'a stage is still allowed on a hill \u2014 the ban is stall-specific');
  const demoOnHill = isLegalPlacement('demo', 2, 1, []);
  assert(demoOnHill.ok === true, 'a demo camp is still allowed on a hill \u2014 the ban is stall-specific');
  // The refusal message suggests terrain that's actually still open, not a
  // stale "try a hill" leftover from the old hardcoded path-ban message.
  assert(!/try.*hill/i.test(foodOnHill.reason), 'the hill-ban message doesn\u2019t suggest hill as an alternative');

  const buildOnHill = State.buildPlot(State.createInitialState(), 'food', 2, 1);
  assert(buildOnHill.error && /hill/i.test(buildOnHill.error), 'buildPlot surfaces the same hill-ban refusal end to end');
}

{
  // Same-kind stall spacing: two food stalls (or two craft stalls) can't
  // sit within minStallSpacing of each other, but a food stall right next
  // to a craft stall is fine \u2014 the rule is same-kind only.
  const existingFood = [{ id: 'plot_1', kind: 'food', x: 6, y: 2, status: 'built' }];
  const tooCloseFood = isLegalPlacement('food', 7, 2, existingFood);
  assert(tooCloseFood.ok === false && /crowd/i.test(tooCloseFood.reason), 'isLegalPlacement refuses a second food stall directly beside an existing one');
  const farEnoughFood = isLegalPlacement('food', 9, 2, existingFood);
  assert(farEnoughFood.ok === true, 'isLegalPlacement allows a second food stall once it clears minStallSpacing');
  const vendorBeside = isLegalPlacement('vendor', 7, 2, existingFood);
  assert(vendorBeside.ok === true, 'a craft stall right beside an existing food stall is fine \u2014 spacing is same-kind only');

  const existingVendor = [{ id: 'plot_2', kind: 'vendor', x: 6, y: 2, status: 'built' }];
  const tooCloseVendor = isLegalPlacement('vendor', 7, 2, existingVendor);
  assert(tooCloseVendor.ok === false && /crowd/i.test(tooCloseVendor.reason), 'isLegalPlacement refuses a second craft stall directly beside an existing one too');

  // A still-planning stall claims its spacing too, same rule the stage
  // check already follows.
  const planningFood = [{ id: 'plot_3', kind: 'food', x: 6, y: 2, status: 'planning' }];
  const tooCloseToPlan = isLegalPlacement('food', 7, 2, planningFood);
  assert(tooCloseToPlan.ok === false && /crowd/i.test(tooCloseToPlan.reason), 'isLegalPlacement treats a still-planning stall as claiming its spot for spacing purposes');

  // excludeId: a stall being moved/relocated doesn\u2019t count against its own new spot.
  const selfCheck = isLegalPlacement('food', 6, 2, existingFood, 'plot_1');
  assert(selfCheck.ok === true, 'isLegalPlacement ignores the stall\u2019s own current position when excludeId matches it');

  const placedFood = State.placePlot(State.createInitialState(), 'food', 6, 2).state;
  const tooCloseBuild = State.buildPlot(placedFood, 'food', 7, 2);
  assert(tooCloseBuild.error && /crowd/i.test(tooCloseBuild.error), 'buildPlot surfaces the same stall-spacing refusal end to end');
}

{
  // Demo camp cap: the 4th demo camp is refused regardless of open,
  // legal ground, even though nothing else about the site is a problem.
  // (0,1), (2,1), (6,1), (9,1) are all row-1 cells with frontage via their
  // shared south neighbor (row 2 is path the whole way across), leaving
  // (3,1)/(4,1) free for the stage footprint used below.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'demo', 0, 1).state;
  s = State.buildPlot(s, 'demo', 2, 1).state;
  s = State.buildPlot(s, 'demo', 6, 1).state;
  assert(s.builtPlots.filter(p => p.kind === 'demo').length === 3, 'three demo camps build normally, right up to the cap');
  const fourth = State.buildPlot(s, 'demo', 9, 1);
  assert(fourth.error && /can only support/i.test(fourth.error), 'buildPlot refuses a 4th demo camp once the cap is reached');
  assert(s.builtPlots.filter(p => p.kind === 'demo').length === 3, 'the refused 4th demo camp was not actually added to state');

  // Still-planning demo camps count toward the cap too, closing the same
  // bulk-commit loophole the stage-spacing/stall-spacing rules already
  // close \u2014 planning 4 and committing them together can\u2019t bypass it.
  let planned = State.createInitialState();
  planned = State.placePlot(planned, 'demo', 0, 1).state;
  planned = State.placePlot(planned, 'demo', 2, 1).state;
  planned = State.placePlot(planned, 'demo', 6, 1).state;
  const fourthPlan = State.placePlot(planned, 'demo', 9, 1);
  assert(fourthPlan.error && /can only support/i.test(fourthPlan.error), 'placePlot refuses a 4th planning-status demo camp once the cap is reached');

  // A different kind is unaffected by the demo cap. (3,0) is a known-good
  // path-fronted stage site used throughout this suite; its footprint
  // (3,0)-(4,1) doesn't touch any of the three demo cells above.
  const stageAfterDemos = State.buildPlot(s, 'stage', 3, 0);
  assert(stageAfterDemos.error === null, 'the demo cap doesn\u2019t block building other kinds');
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

  // Phase 1 increment 2: the col-3 spur, ruled (#227). hasPathFrontage is
  // a terrain question and (4,5) answers it yes — (3,5) is a path tile
  // right beside it. But the col-3 spur is cut off from ENTRANCE by the
  // authoring gap at (3,3), so nobody can walk there, and now that sales
  // come off the walk a stall there takes $0 a day while paying full
  // upkeep. It is refused with its own sentence rather than sold as a
  // buildable spot.
  assert(hasPathFrontage([{ x: 4, y: 5 }]) === true, 'a cell beside the col-3 spur passes the terrain-only frontage check');
  assert(!Number.isFinite(reachabilityDistance({ kind: 'food', x: 4, y: 5 })), 'and has no finite walk from the gate, which is the whole problem');
  const spurStall = isLegalPlacement('food', 4, 5, []);
  assert(spurStall.ok === false && /connect to the front gate/i.test(spurStall.reason),
    'isLegalPlacement refuses a stall whose only path frontage does not connect to the gate');
  assert(!/thoroughfare/.test(spurStall.reason || ''), 'and refuses it with the disconnected-path sentence, not the no-frontage one');
  const spurBuild = State.buildPlot(State.createInitialState(), 'food', 4, 5);
  assert(spurBuild.error && /connect to the front gate/i.test(spurBuild.error), 'buildPlot surfaces the disconnected-path refusal end to end');
  // A demo camp is subject to the same rule (it is in requiresPathFrontage
  // too) and a stage is not, because a stage does not need frontage at all.
  assert(isLegalPlacement('demo', 4, 5, []).ok === false, 'a demo camp on the spur is refused for the same reason');
  // A stall against the connected artery is still legal — (6,1) is a
  // clearing whose south neighbour (6,2) is on the row-2 artery, four hops
  // from the gate.
  assert(isLegalPlacement('food', 6, 1, []).ok === true, 'a stall fronting the connected artery is still legal');
}

{
  // Footprint occupancy: a second structure can't be anchored on ANY cell
  // of an already-built stage's 2x2 block, not just its anchor cell.
  // demo, not food: the stage's whole 2x2 block sits on hill terrain, and
  // Stage 18 banned food/vendor stalls from hills \u2014 demo isn't banned
  // there, keeping this test isolated to footprint occupancy.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state; // occupies (3,0),(4,0),(3,1),(4,1)
  const onAnchor = State.buildPlot(s, 'demo', 3, 0);
  assert(onAnchor.error && /already built/i.test(onAnchor.error), 'a second plot can\u2019t anchor on the stage\u2019s own anchor cell');
  const onFarCorner = State.buildPlot(s, 'demo', 4, 1);
  assert(onFarCorner.error && /already built/i.test(onFarCorner.error), 'a second plot can\u2019t anchor on a NON-anchor cell of the stage\u2019s footprint either');
  const beside = State.buildPlot(s, 'demo', 5, 1); // just outside the footprint, with frontage via (5,2)
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
// Stage 13: daily upkeep. A built plot costs CONFIG.upkeepRate of its own
// stored `cost` every day; a planning (uncommitted) plot costs nothing.
// ---------------------------------------------------------------------
{
  const builtStage = { id: 'p1', kind: 'stage', x: 0, y: 0, cost: 850, status: 'built' };
  assert(plotUpkeep(builtStage) === Math.round(850 * CONFIG.upkeepRate), 'plotUpkeep is CONFIG.upkeepRate of a built plot\u2019s stored cost');

  const planningStage = { id: 'p2', kind: 'stage', x: 2, y: 2, cost: 850, status: 'planning' };
  assert(plotUpkeep(planningStage) === 0, 'plotUpkeep is 0 for a still-planning plot, same as every other gameplay effect');

  assert(plotUpkeep(null) === 0, 'plotUpkeep is 0 for a missing/undefined plot');

  const foodStall = { id: 'p3', kind: 'food', x: 5, y: 5, cost: 480, status: 'built' };
  const total = totalUpkeep([builtStage, planningStage, foodStall]);
  assert(total === plotUpkeep(builtStage) + plotUpkeep(foodStall), 'totalUpkeep sums only built plots, ignoring planning ones');
  assert(totalUpkeep([]) === 0 && totalUpkeep(undefined) === 0, 'totalUpkeep handles an empty or missing plot list');

  // A pricier build (e.g. a hilltop stage vs. a clearing food stall)
  // costs more, so it costs more to maintain \u2014 no separate authored
  // table needed, upkeep just rides along with the stored cost.
  const hillStage = { id: 'p4', kind: 'stage', x: 0, y: 0, cost: 1060, status: 'built' }; // 850 * 1.25 hill mult, rounded
  assert(plotUpkeep(hillStage) > plotUpkeep(builtStage), 'a pricier (e.g. hill-terrain) build costs more upkeep than a cheaper one of the same kind');
}

{
  // simulateDay-level: upkeep is a real, separate line item in the ledger,
  // it scales with how many plots are actually built (not planning), and
  // the flat baseOverhead no longer depends on stage count.
  let s = State.createInitialState();
  const before = simulateDay(s, 1);
  assert(before.upkeep === 0 && before.overhead === CONFIG.baseOverhead, 'simulateDay reports zero upkeep and flat baseOverhead with nothing built yet');

  s = State.buildPlot(s, 'stage', 3, 0).state; // 2x2 footprint, occupies (3,0)-(4,1)
  const afterStage = simulateDay(s, 1);
  const builtStagePlot = s.builtPlots.find(p => p.kind === 'stage');
  assert(afterStage.upkeep === Math.round(builtStagePlot.cost * CONFIG.upkeepRate), 'simulateDay\u2019s upkeep matches plotUpkeep for the one built stage');
  assert(afterStage.overhead === CONFIG.baseOverhead, 'overhead stays flat regardless of what\u2019s built \u2014 stage-count scaling moved into upkeep');
  assert(afterStage.costs === afterStage.performerCosts + afterStage.vendorCosts + afterStage.upkeep + afterStage.overhead + afterStage.guestCosts, 'simulateDay\u2019s total costs line includes upkeep and per-guest cost alongside wages and overhead');
  assert(afterStage.guestCosts === Math.round(afterStage.attendance * CONFIG.perGuestCost), 'Stage 19: per-guest cost is attendance \u00d7 CONFIG.perGuestCost');

  s = State.buildPlot(s, 'food', 6, 1).state; // path-fronted clearing cell, 1x1
  const afterTwo = simulateDay(s, 1);
  assert(afterTwo.upkeep > afterStage.upkeep, 'upkeep grows as more plots get built');

  // A planning (not yet committed) plot must not add to the day\u2019s
  // upkeep bill \u2014 mirrors it drawing no crowd/seating anything either.
  const planResult = State.placePlot(s, 'demo', 1, 1);
  assert(planResult.error === null, 'sanity check: the planning-plot fixture itself placed legally');
  s = planResult.state;
  const withPlanning = simulateDay(s, 1);
  assert(withPlanning.upkeep === afterTwo.upkeep, 'a still-planning plot contributes nothing to the day\u2019s upkeep total');
}

// ---------------------------------------------------------------------
// Stage 14: crowd-flow-as-a-system, phase 1 — foot traffic drives vendor
// revenue at the simulateDay level, not just as a standalone pure function.
//
// Phase 1 increment 2 rewrote this whole section, and the rewrite is worth
// reading before trusting it. Through Stage 22 a stall's sales were
// `attendance x 0.12 x quality/7 x footTraffic x reachability`, so a SOLO
// stall's revenue was a closed-form number these tests could reproduce by
// hand, and a stall's distance from the gate moved money even when the
// grounds held nothing else to walk to. Neither is true of an agent model:
// the till is whatever the crowd handed over, and with exactly one thing
// on the grounds every guest finds it wherever it is. So the two claims
// this section pins are now:
//  (1) a stall's house revenue is its own crowd's money and nothing else;
//  (2) on a grounds with somewhere else to be, the better-placed stall
//      takes more of it.
// Claim (2) is tested on a faire with a scheduled stage and a demo camp,
// because that is the only condition under which it is true — the version
// of this test that used a lone stall was asserting a coefficient, not a
// mechanic.
// ---------------------------------------------------------------------
{
  // (1) A lone seated stall: its measured foot traffic is exactly 1 (it is
  // the whole group, so it is the mean), and every dollar of house revenue
  // traces back through the walk — buyers x the vendor's ticket x the
  // house's cut, with no coefficient anywhere in the chain.
  let solo = State.createInitialState();
  solo = State.buildPlot(solo, 'stage', 3, 0).state;
  solo = State.buildPlot(solo, 'food', 6, 1).state; // (6,1): clearing, no stage-adjacency bonus at anchor distance 3
  solo = State.hireVendor(solo, 'vend_cider').state; // quality 8, avgTicket 9, food
  const soloResult = simulateDay(solo, 1);
  const soloPlot = solo.builtPlots.find(p => p.kind === 'food');
  assert(soloResult.footTraffic[soloPlot.id].mult === 1, 'a lone seated stall’s measured foot-traffic multiplier is exactly 1 inside a real simulateDay run');
  const soloSale = soloResult.stallSales[soloPlot.id];
  assert(soloSale && soloSale.buyers > 0, 'a lone seated stall sells to somebody');
  assert(soloSale.buyers === Math.round(soloResult.guests.buyers[soloPlot.id] * soloResult.guests.represents),
    'a stall’s buyer count is the walk’s own count scaled by what one agent stands for — not a conversion rate on attendance');
  assert(soloSale.gross === soloSale.buyers * 9, 'a stall’s gross is its buyers times the vendor’s average ticket, exactly');
  assert(soloResult.vendorRevenue === Math.round(soloSale.gross * CONFIG.wristbandCut),
    'house vendor revenue is the wristband cut of the till and nothing else');
  assert(soloResult.vendorGross === soloSale.gross, 'the day report’s vendorGross is the sum of what the stalls took');
  assert(soloResult.guests.spent === soloResult.vendorGross,
    'and what the crowd is reported as spending is the same money — the ticket stub’s "left the purses" line and its stall revenue row add up');

  // The solo fixture above draws well under GUESTS.sampleCap, so `represents`
  // is exactly 1 and every way of scaling the till agrees. On a real
  // Saturday it is not: the sample stands for two-and-a-bit people each, and
  // scaling the buyer count and the raw dollars separately then rounding
  // both puts a report on screen that says 940 sales and a gross that is not
  // 940 times the ticket. So the buyer count is scaled once and the gross is
  // priced off it, and this is the crowd big enough to tell the difference.
  let crowded = State.createInitialState();
  crowded.cash = 200000; crowded.reputation = 90; crowded.season = 4; crowded.weekendDay = 2;
  for (const [k, x, y] of [['stage', 3, 0], ['stage', 8, 0], ['food', 5, 3], ['vendor', 6, 3], ['demo', 8, 3]]) {
    const r = State.buildPlot(crowded, k, x, y);
    assert(!r.error, `crowded fixture: ${k} at ${x},${y} builds legally`);
    crowded = r.state;
  }
  for (const v of ['vend_cider', 'vend_leather']) crowded = State.hireVendor(crowded, v).state;
  const bill = ['perf_jouster_1', 'perf_musician_2', 'perf_magician_1'];
  for (const q of bill) crowded = State.contractPerformer(crowded, q).state;
  {
    let i = 0;
    for (const b of TIME_BLOCKS) for (const st of crowded.builtPlots.filter(p => p.kind === 'stage')) {
      crowded = State.assignSchedule(crowded, b.id, st.id, bill[i++ % bill.length]).state;
    }
  }
  const crowdedResult = simulateDay(crowded, 1);
  assert(crowdedResult.attendance > GUESTS.sampleCap && crowdedResult.guests.represents > 2,
    `the crowded fixture puts more than the sample cap through the gate (${crowdedResult.attendance}, each agent standing for ${crowdedResult.guests.represents})`);
  let anyFractional = false;
  for (const [id, sale] of Object.entries(crowdedResult.stallSales)) {
    const ticket = VENDORS.find(v => v.id === sale.vendorId).avgTicket;
    assert(sale.gross === sale.buyers * ticket, `${id}: gross is the reported buyer count times the ticket, on a crowd the sample only stands for`);
    if (sale.gross !== Math.round(crowdedResult.guests.buyers[id] * crowdedResult.guests.represents * ticket)) anyFractional = true;
  }
  assert(anyFractional, 'and the fixture is one where scaling the raw till separately would have disagreed \u2014 otherwise this test proves nothing');
  const crowdedTotal = Object.values(crowdedResult.stallSales).reduce((sum, sale) => sum + sale.gross, 0);
  assert(crowdedResult.vendorGross === crowdedTotal && crowdedResult.guests.spent === crowdedTotal,
    'the stall lines, the vendorGross total and the crowd\u2019s reported spend are all the same number');

  // A stall with nobody seated is a shed: it never appears in the sales
  // ledger, however well sited it is.
  let shed = State.createInitialState();
  shed = State.buildPlot(shed, 'stage', 3, 0).state;
  shed = State.buildPlot(shed, 'food', 6, 1).state;
  const shedResult = simulateDay(shed, 1);
  assert(Object.keys(shedResult.stallSales).length === 0 && shedResult.vendorRevenue === 0,
    'an unstaffed stall sells nothing and shows up nowhere in the sales ledger');

  // (2) Two identically-staffed food stalls on a faire that has somewhere
  // else to be — a stage running a show every block at (1,0) and a demo
  // camp at (5,1). One stall sits at (2,3), two hops off the artery near
  // both; the other at (9,3), seven hops further out. Same state, same
  // seed, so the only difference is where the two stalls sit.
  const spread = () => {
    let s = State.createInitialState();
    s.cash = 90000;
    for (const [k, x, y] of [['stage', 1, 0], ['food', 2, 3], ['food', 9, 3], ['demo', 5, 1]]) {
      const r = State.buildPlot(s, k, x, y);
      assert(!r.error, `sitings fixture: ${k} at ${x},${y} builds legally`);
      s = r.state;
    }
    for (const v of ['vend_cider', 'vend_stew']) s = State.hireVendor(s, v).state;
    for (const q of ['perf_jester_2', 'perf_musician_1']) s = State.contractPerformer(s, q).state;
    const stage = s.builtPlots.find(p => p.kind === 'stage');
    let i = 0;
    for (const b of TIME_BLOCKS) s = State.assignSchedule(s, b.id, stage.id, ['perf_jester_2', 'perf_musician_1'][i++ % 2]).state;
    return s;
  };
  const sited = spread();
  const near = sited.builtPlots.find(p => p.x === 2 && p.y === 3);
  const far = sited.builtPlots.find(p => p.x === 9 && p.y === 3);
  assert(near.assignedVendorId && far.assignedVendorId, 'sanity check: both stalls in the siting fixture are staffed');
  const sitedResult = simulateDay(sited, 700);
  assert(sitedResult.footTraffic[near.id].arrivals > sitedResult.footTraffic[far.id].arrivals * 2,
    'the stall beside the show and the gate is walked past more than twice as often as the one seven hops out');
  assert(sitedResult.stallSales[near.id].gross > sitedResult.stallSales[far.id].gross,
    'the better-placed stall takes more money, on a grounds where the crowd has somewhere else to be');
  assert(sitedResult.log.some(l => l.includes('pulled a lively crowd')),
    'a noticeable measured foot-traffic spread between two staffed stalls surfaces as a flavor-log line');

  // The spread is a fact about the day, not a fluke of one seed.
  let nearWins = 0;
  for (let i = 0; i < 12; i++) {
    const d = simulateDay(sited, 700 + i);
    if (d.stallSales[near.id].gross > d.stallSales[far.id].gross) nearWins++;
  }
  assert(nearWins === 12, `the well-placed stall outsells the far one on every one of twelve seeds (won ${nearWins})`);
}

// ---------------------------------------------------------------------
// Stage 17: reachability-gated draw \u2014 gate-distance drives both stall
// sales and stage draw-weight at the simulateDay level.
// ---------------------------------------------------------------------
{
  // Same technique as the Stage 14 sHigh/sLow test above: TWO food stalls
  // built in every state (so reachability actually has something to
  // compare against \u2014 a truly solo stall is pinned to exactly 1x by
  // design), only one vendor hired, auto-seating at whichever stall was
  // built first. No stage in either state, so there's no stage-adjacency
  // traffic bonus to muddy which effect moved the numbers \u2014 gate distance
  // is the only variable in play. Both cells sit directly on the row-2
  // artery itself (food/craft stalls are allowed on path \u2014 see
  // PLACEMENT_RULES.terrainBans), so their foot-traffic terrain/adjacency
  // numbers are identical and only their gate-distance differs.
  let sNear = State.createInitialState();
  sNear = State.buildPlot(sNear, 'food', 1, 2).state; // built first \u2014 auto-seat lands here, 1 hop from ENTRANCE
  sNear = State.buildPlot(sNear, 'food', 9, 2).state; // 9 hops from ENTRANCE
  sNear = State.hireVendor(sNear, 'vend_cider').state;
  const resultNear = simulateDay(sNear, 1);

  let sFar = State.createInitialState();
  sFar = State.buildPlot(sFar, 'food', 9, 2).state; // built first this time \u2014 auto-seat lands here instead
  sFar = State.buildPlot(sFar, 'food', 1, 2).state;
  sFar = State.hireVendor(sFar, 'vend_cider').state;
  const resultFar = simulateDay(sFar, 1);

  const nearSeated = sNear.builtPlots.find(p => p.assignedVendorId);
  const farSeated = sFar.builtPlots.find(p => p.assignedVendorId);
  assert(nearSeated.x === 1 && farSeated.x === 9, 'sanity check: each scenario auto-seated the vendor at the stall built first');
  assert(resultNear.footTraffic[nearSeated.id].mult === 1 && resultFar.footTraffic[farSeated.id].mult === 1, 'with no stage in play, both stalls\u2019 terrain/adjacency traffic is identical \u2014 gate distance is the only variable left');
  assert(resultNear.reachability[nearSeated.id].mult > 1, 'the near-gate stall scores above 1x reachability');
  assert(resultFar.reachability[farSeated.id].mult < 1, 'the far-from-gate stall scores below 1x reachability');
  assert(resultNear.attendance === resultFar.attendance, 'attendance itself is unaffected by a stall\u2019s distance from the gate (same seed/roster/schedule)');
  // Phase 1 increment 2: this used to assert the near stall out-earned the
  // far one on this exact fixture, and it no longer does — deliberately.
  // The grounds here hold one seated stall and nothing else, and an agent
  // with one place to go walks there however far it is; the whole 14-cell
  // artery is inside one block's stride. The reachability multiplier said
  // otherwise because it was a coefficient that never asked whether there
  // was anywhere else to be. The claim itself is not abandoned — the Stage
  // 14 section above pins it on a faire with a scheduled stage and a demo
  // camp, which is the condition under which it is true — so what is
  // asserted here is the narrower, still-true thing: gate distance is
  // scored, it is reported, and it costs the far stall nothing on a
  // grounds where there is nothing to compete for the walk.
  assert(resultNear.vendorRevenue === resultFar.vendorRevenue,
    'with one seated stall and nothing else on the grounds, the crowd finds it wherever it is \u2014 gate distance costs it nothing');

  // Same idea, one level up: a single state with TWO built stages (no
  // schedule, no vendors \u2014 isolating reachability's effect on stage
  // draw-weight from every other factor) sited near vs. far from the gate.
  let stageBoth = State.createInitialState();
  stageBoth = State.buildPlot(stageBoth, 'stage', 3, 0).state; // fronts (3,2)/(4,2), 3 hops from ENTRANCE
  stageBoth = State.buildPlot(stageBoth, 'stage', 8, 0).state; // fronts (8,2)/(9,2), 8 hops from ENTRANCE
  const nearStagePlot = stageBoth.builtPlots.find(p => p.x === 3);
  const farStagePlot = stageBoth.builtPlots.find(p => p.x === 8);
  const resultStageBoth = simulateDay(stageBoth, 1);
  assert(resultStageBoth.reachability[nearStagePlot.id].mult > 1, 'a stage built near the gate scores above 1x reachability');
  assert(resultStageBoth.reachability[farStagePlot.id].mult < 1, 'a stage built far from the gate scores below 1x reachability');
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
    // Stage 21: index.html used to carry three <link>s to fonts.googleapis.com
    // that got stripped here so jsdom would not try to fetch them. The fonts
    // are vendored now, so there is nothing to strip; Section 21 asserts they
    // stay that way.
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, ''); // we import main.js ourselves below

  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = makeMemoryStorage();
  globalThis.confirm = () => true;

  await import(mod('js/main.js') + `?t=${Date.now()}`); // cache-bust so re-imports re-run top-level code

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
  assert(doc.querySelector('.gate-marker'), 'Stage 17: the front gate marker renders on the grounds map');
  assert(!doc.querySelector('.plot-marker.ghost'), 'no ghost placement cells before a structure kind is selected');
  // Stage 19: the grounds tier label moved from the status line into the
  // plat sheet's own title cartouche; the status line now carries only the
  // next-unlock hint.
  assert(doc.querySelector('.plat-title')?.textContent.includes('Home Grounds'), 'Stage 19: the plat title names the current grounds tier');
  assert(doc.querySelector('.grounds-status')?.textContent.includes('unlocks Weekend'), 'the grounds-status line shows when the next expansion unlocks');
  // Stage 19: the site plan is persistent, not a Fair-Floor-only panel.
  doc.querySelector('[data-tab="office"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(doc.querySelector('.grounds-map'), 'Stage 19: the grounds map stays visible from the Office tab');
  assert(doc.querySelector('#grounds .grounds-map'), 'Stage 19: the map lives in its own #grounds section, outside the tab panel');
  assert(doc.querySelector('#content').innerHTML.includes('Ledger Desk'), 'the Office panel still renders beside the persistent map');
  assert(doc.querySelector('.price-curve'), 'Stage 19: the Office shows the ticket-revenue curve');
  assert(doc.querySelector('#ledger').textContent.includes('grounds draw'), 'Stage 19: the HUD carries a permanent grounds-draw readout');
  doc.querySelector('[data-tab="fairfloor"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
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
  assert(doc.querySelector('.plot-card[data-kind="stage"]')?.textContent.includes('gate reach'), 'Stage 17: a built stage\u2019s card shows its gate-reach tag');

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
  // Stage 14: the lone food stall's card shows its foot-traffic tag (always
  // 1.00x with nothing else built to compare it against).
  assert(doc.querySelector('.plot-card[data-kind="food"]').textContent.includes('1.00x foot traffic'), 'Stage 14: a built food stall\u2019s card shows its foot-traffic multiplier');

  // Stage 15: with one food stall now committed, the build palette's price
  // tag for Food Stall should reflect the escalated (pricier) next build,
  // not the flat STRUCTURE_TYPES base cost.
  const foodPaletteBtn = doc.querySelector('[data-action="selectBuild"][data-kind="food"]');
  const foodPaletteQuoteMatch = foodPaletteBtn.textContent.match(/from \$([\d,]+)/);
  assert(!!foodPaletteQuoteMatch, 'Stage 15: the Food Stall palette button shows a "from $X" price');
  const foodPaletteQuote = Number(foodPaletteQuoteMatch[1].replace(/,/g, ''));
  assert(foodPaletteQuote > STRUCTURE_TYPES.food.baseCost, 'Stage 15: the palette\u2019s Food Stall price is above the flat base cost now that one is already built');

  const backstageTabBtn2 = doc.querySelector('[data-tab="backstage"]');
  click(backstageTabBtn2);
  assert(doc.querySelector('.stall-summary')?.textContent.includes('Food Stalls'), 'Stage 10: Backstage shows the Food Stalls vacancy gauge');
  const weekendHireBtn = doc.querySelector('[data-action="hireVendor"][data-contract="weekend"]');
  assert(!!weekendHireBtn, 'a Weekend Package hire button is present for an uncontracted vendor once a matching stall is committed');
  click(weekendHireBtn);
  assert(doc.querySelector('#content').innerHTML.includes('Weekend Package'), 'the hired vendor row shows its Weekend Package contract label');
  assert(doc.querySelector('#content').innerHTML.includes('seated:'), 'Stage 10: hiring auto-seats the vendor, shown on their roster row');
  // Stage 14: with only one food stall built, its foot-traffic multiplier
  // is always exactly 1 (see the engine-level regression test above) \u2014
  // confirms the Backstage seat note actually renders the tag end to end.
  assert(doc.querySelector('#content').innerHTML.includes('1.00x traffic'), 'Stage 14: the seated stall\u2019s foot-traffic multiplier renders on the Backstage vendor row');
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

// ---------------------------------------------------------------------
// Stage 18: DOM-level checks for the demo-cap palette indicator and the
// hill-ban blocked marker, driven end to end through main.js like the
// gameOver/victory tests below \u2014 a save preloaded with 3 built demo
// camps, rather than clicking through placing three of them by hand.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

  let capSave = State.createInitialState();
  capSave = State.buildPlot(capSave, 'demo', 0, 1).state;
  capSave = State.buildPlot(capSave, 'demo', 2, 1).state;
  capSave = State.buildPlot(capSave, 'demo', 6, 1).state;
  const storage = makeMemoryStorage();
  storage.setItem('renn-faire-sim-save-v1', JSON.stringify(capSave));

  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = storage;
  globalThis.confirm = () => true;

  await import(mod('js/main.js') + `?t=${Date.now()}`);
  const doc = dom.window.document;
  const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  const fairFloorTabBtn = doc.querySelector('[data-tab="fairfloor"]');
  click(fairFloorTabBtn);
  assert(doc.querySelector('.map-legend')?.textContent.includes('hill'), 'Stage 18: the grounds-map legend mentions the stall hill ban');

  const demoBtn = doc.querySelector('[data-action="selectBuild"][data-kind="demo"]');
  assert(!!demoBtn, 'the build palette has a Demo Camp option');
  assert(demoBtn.textContent.includes('3/3 built'), 'Stage 18: with the cap already reached, the Demo Camp palette button shows "3/3 built" instead of a price');
  click(demoBtn);
  assert(!doc.querySelector('.plot-marker.ghost'), 'Stage 18: no ghost cell is offered anywhere once a kind is at its build cap');
  const cappedBlocked = [...doc.querySelectorAll('.plot-marker.blocked')].find(el => /can only support/i.test(el.getAttribute('title')));
  assert(!!cappedBlocked, 'Stage 18: a blocked marker explains the demo cap refusal');
  click(doc.querySelector('[data-action="cancelBuild"]'));

  const foodBtn = doc.querySelector('[data-action="selectBuild"][data-kind="food"]');
  click(foodBtn);
  const hillBlocked = [...doc.querySelectorAll('.plot-marker.blocked')].find(el => /hill/i.test(el.getAttribute('title')));
  assert(!!hillBlocked, 'Stage 18: selecting Food Stall shows a blocked marker on a hill cell, with the hill ban explained in its title');

  dom.window.close();
}

// ---------------------------------------------------------------------
// Stage 16: gameOver and victory screens render correctly and their
// buttons work, driven end to end through main.js exactly like a browser.
// Each preloads localStorage with a save already parked in that phase
// (rather than grinding out real days) so the test is fast and exercises
// main.js's render() dispatch + button wiring directly.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

  const gameOverSave = { ...State.createInitialState(), cash: -1800, season: 2, weekendDay: 1, reputation: 22, phase: 'gameOver', bankrupt: true };
  const storage = makeMemoryStorage();
  storage.setItem('renn-faire-sim-save-v1', JSON.stringify(gameOverSave));

  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = storage;
  globalThis.confirm = () => true;

  await import(mod('js/main.js') + `?t=${Date.now()}`);
  const doc = dom.window.document;

  assert(!doc.querySelector('[data-tab]'), 'gameOver phase hides the tabs');
  assert(doc.querySelector('.gameover-stub'), 'a gameOver save renders the game-over ticket stub on boot');
  assert(doc.querySelector('#content').innerHTML.includes('The Faire Folds'), 'the game-over screen shows its headline');
  const newFaireBtn = doc.querySelector('[data-action="newFaire"]');
  assert(!!newFaireBtn, 'the game-over screen has a Start a New Faire button');
  newFaireBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(doc.querySelector('#ledger').innerHTML.includes('Weekend 1'), 'clicking Start a New Faire resets the ledger back to Weekend 1');
  assert(doc.querySelector('[data-tab]'), 'tabs reappear once a fresh faire starts');
  assert(!doc.querySelector('.gameover-stub'), 'the game-over screen is gone after starting a new faire');

  dom.window.close();
}

{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

  const w = CONFIG.winCondition;
  const victorySave = { ...State.createInitialState(), cash: w.minCash + 500, season: w.seasonTarget, weekendDay: CONFIG.seasonLength, reputation: w.minReputation + 5, phase: 'victory', victoryAchieved: true };
  const storage = makeMemoryStorage();
  storage.setItem('renn-faire-sim-save-v1', JSON.stringify(victorySave));

  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = storage;
  globalThis.confirm = () => true;

  await import(mod('js/main.js') + `?t=${Date.now()}`);
  const doc = dom.window.document;

  assert(!doc.querySelector('[data-tab]'), 'victory phase hides the tabs');
  assert(doc.querySelector('.victory-stub'), 'a victory save renders the victory ticket stub on boot');
  assert(doc.querySelector('#content').innerHTML.includes('Legendary Faire'), 'the victory screen shows its headline');
  const continueBtn = doc.querySelector('[data-action="acknowledgeVictory"]');
  assert(!!continueBtn, 'the victory screen has a Continue the Faire button');
  continueBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(doc.querySelector('.weekend-summary'), 'acknowledging victory drops into the normal weekend-end summary screen');
  assert(doc.querySelector(`[data-action="startNextWeekend"]`)?.textContent.includes(String(w.seasonTarget + 1)), 'the weekend-end screen after victory still offers to begin the next weekend normally');

  dom.window.close();
}

// ---------------------------------------------------------------------
// Section 1h: Stage 21 — the save matches the screen in every phase
//
// Through Stage 20, render() called saveState() at the very bottom, below
// the early return the report/victory/gameOver/weekendEnd phases take. So a
// report was never on disk while it was on screen, and reloading on a day's
// takings rewound to before the gates opened. runDay() seeds off Date.now(),
// so replaying that day rerolled it: measured across 400 seeds on a developed
// grounds, one day's net ran -$301 to +$1,265 and its reputation gain 0 to
// +5. F5 was worth about 3x the median day's profit.
//
// saveState() now runs at the TOP of render(), so it cannot be skipped by an
// early return. Every assertion below fails if it moves back down — which is
// how it was checked (locked decision #34): put the call back at the bottom
// and this whole section goes red.
//
// These read the SCREEN for what just happened and the SAVE only for what a
// reload has to survive, per locked decision #39 — the rule this game is one
// of the reasons for.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

  // One shared storage across two JSDOMs: booting main.js against the same
  // storage a second time IS a reload, which is the behaviour under test.
  const storage = makeMemoryStorage();
  const saved = () => JSON.parse(storage.getItem('renn-faire-sim-save-v1'));

  const boot = async () => {
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return dom;
  };
  const click = (dom, sel) => {
    const el = dom.window.document.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    return true;
  };

  let dom = await boot();
  let doc = dom.window.document;
  assert(saved().phase === 'plan', 'booting a fresh game writes a plan-phase save immediately');

  // --- a report is on disk while it is on screen ---
  assert(click(dom, '[data-action="openGates"]'), 'Open the Gates is clickable on a fresh boot');
  const onScreen = doc.querySelector('.ticket-stub h2').textContent;
  assert(/Closed the Gates/.test(onScreen), 'clicking Open the Gates puts a day report on screen', onScreen);

  const reportSave = saved();
  assert(reportSave.phase === 'report', 'Stage 21: the save says "report" while a report is on screen (was "plan" through Stage 20)');
  assert(reportSave.lastResult !== null, 'the saved report carries its lastResult rather than a null');
  assert(reportSave.history.length === 1, 'the day that just ran is in the saved history');
  // Guarded reads from here down: with the bug reintroduced lastResult is null,
  // and a suite that throws on the first symptom hides the other twenty checks.
  assert(reportSave.lastResult?.attendance === reportSave.history[0]?.attendance,
    'the saved lastResult and the saved history agree about the gate');

  // The screen and the save report the same day. This is the assertion that
  // the whole change exists for.
  assert(reportSave.lastResult != null && doc.querySelector('.ticket-stub').textContent.includes(reportSave.lastResult.attendance.toLocaleString()),
    'the attendance on screen is the attendance in the save');

  // --- the day is locked: a reload comes back to the same report ---
  const cashAtReport = reportSave.cash;
  const attendanceAtReport = reportSave.lastResult?.attendance;
  dom.window.close();
  dom = await boot();
  doc = dom.window.document;
  assert(!!doc.querySelector('.ticket-stub'), 'reloading on a report comes back to the report, not to the planning desk');
  assert(!doc.querySelector('[data-action="openGates"]'), 'and the gates cannot be opened a second time on the same day');
  assert(!!doc.querySelector('[data-action="nextDay"]'), 'the only way on from a reloaded report is Next Day');
  const afterReload = saved();
  assert(afterReload.cash === cashAtReport,
    `the day's takings survive the reload rather than being rewound ($${cashAtReport} -> $${afterReload.cash})`);
  assert(afterReload.lastResult?.attendance === attendanceAtReport,
    'and it is the same day, not a rerolled one', `${attendanceAtReport} -> ${afterReload.lastResult?.attendance}`);
  assert(afterReload.history.length === 1, 'the reload did not duplicate the day in history');

  // --- weekendEnd persists too, and it takes the same early return ---
  click(dom, '[data-action="nextDay"]');
  assert(saved().phase === 'plan', 'Next Day from a report saves the new planning phase');
  for (let i = 0; i < CONFIG.seasonLength; i++) {
    if (!click(dom, '[data-action="openGates"]')) break;
    if (saved().phase === 'weekendEnd') break;
    click(dom, '[data-action="nextDay"]');
  }
  const weekendSave = saved();
  assert(weekendSave.phase === 'weekendEnd', 'playing out the weekend lands in the weekendEnd phase', weekendSave.phase);
  assert(!!doc.querySelector('.weekend-summary'), 'and the weekend summary is on screen');
  assert(weekendSave.history.length === CONFIG.seasonLength, 'the whole weekend is in the saved history',
    `${weekendSave.history.length} days`);

  const weekendCash = weekendSave.cash;
  dom.window.close();
  dom = await boot();
  doc = dom.window.document;
  assert(!!doc.querySelector('.weekend-summary'), 'reloading on the weekend summary comes back to the weekend summary');
  assert(saved().cash === weekendCash, 'and the weekend\'s last day is not replayable either', `$${weekendCash}`);
  dom.window.close();
}

// The gameOver phase takes the same early return, and it is the one nobody
// remembers to check. A report-phase save already flagged bankrupt: clicking
// on from it must leave 'gameOver' on disk, not the stale report.
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

  const ruined = State.runDay({ ...State.createInitialState(), cash: CONFIG.bankruptcyFloor + 200 }, 4242).state;
  assert(ruined.bankrupt === true, 'a day that crosses the bankruptcy floor flags the state bankrupt');

  const storage = makeMemoryStorage();
  storage.setItem('renn-faire-sim-save-v1', JSON.stringify(ruined));
  const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = storage;
  globalThis.confirm = () => true;
  await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
  const doc = dom.window.document;

  assert(!!doc.querySelector('.ticket-stub'), 'a bankrupt day still shows its report before the run ends');
  doc.querySelector('[data-action="nextDay"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert(!!doc.querySelector('.gameover-stub'), 'clicking on from a bankrupt report shows the game-over screen');
  const overSave = JSON.parse(storage.getItem('renn-faire-sim-save-v1'));
  assert(overSave.phase === 'gameOver', 'Stage 21: the gameOver phase reaches the save rather than leaving a stale report on disk');

  // Start a New Faire has to reach the save too, or a reload resurrects the
  // dead run — the same class of bug in the other direction.
  doc.querySelector('[data-action="newFaire"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const fresh = JSON.parse(storage.getItem('renn-faire-sim-save-v1'));
  assert(fresh.phase === 'plan' && fresh.day === 1 && fresh.bankrupt === false,
    'Start a New Faire writes the fresh game to disk, so a reload does not resurrect the folded faire');

  dom.window.close();
}

// ---------------------------------------------------------------------
// Section 22: the wiring nothing has ever clicked, plus the gvb-save.js
// footer save bar (Stage 22)
//
// The 737-assertion engine suite and the big DOM boot test above cover
// build/commit/schedule/weekend flow, but mapping every data-action in
// main.js against both suites turned up ten player-facing actions that had
// never been clicked in a browser by anything: contract, release,
// hireVendor's day-rate let-go path (only the Weekend Package fee path
// above was ever covered), launchCampaign, autoFillStalls, unassignVendor,
// demolishPlot, selectMove/moveTo, deletePlanningPlot, and renamePlot.
// Worse: no change/input event was ever dispatched by any suite, so the
// ticket-price slider and both <select>s (schedule, assignVendor) — which
// all run through main.js's single delegated 'change' listener, a
// completely different event path from every click both suites fire — had
// zero coverage. This is the day.rebuildStations shape of risk: a passing
// engine suite next to wiring nobody has ever actually exercised.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify(save));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    // renamePlot's UI reads window.prompt(), which jsdom does not implement.
    dom.window.prompt = () => 'The Jousting Green Renamed';
    // gvb-save.js's exportToFile() clicks a real <a href="blob:...">. jsdom
    // schedules that as an actual (unimplemented) navigation unless the
    // default action is prevented — nothing here ever wants that anchor to
    // navigate anywhere.
    dom.window.document.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'A') e.preventDefault();
    }, true);
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document, storage };
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return true;
  };
  const saved = (storage) => JSON.parse(storage.getItem('renn-faire-sim-save-v1'));

  // --- contract / release / autoFillStalls (Backstage) ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.hireVendor(s, 'vend_cider', 'open').state; // seats at (6,2)
    s = State.buildPlot(s, 'food', 9, 2).state;
    s = State.hireVendor(s, 'vend_piepeddler', 'open').state; // seats at (9,2)
    const openStall = s.builtPlots.find(p => p.x === 9 && p.kind === 'food');
    s = State.unassignVendorFromPlot(s, openStall.id).state; // hired but unseated, for autoFillStalls
    s = State.contractPerformer(s, 'perf_jester_2', 'open').state; // contracted, for release
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="backstage"]');

    assert(click(doc, '[data-action="contract"][data-id="perf_musician_1"][data-contract="open"]'),
      'Stage 22: an uncontracted performer’s Day Rate contract button is clickable');
    assert(saved(storage).roster.includes('perf_musician_1'),
      'Stage 22: clicking Contract actually adds the performer to the roster — never exercised before this session');

    assert(click(doc, '[data-action="release"][data-id="perf_jester_2"]'),
      'Stage 22: a contracted performer’s Release button is clickable');
    assert(!saved(storage).roster.includes('perf_jester_2'),
      'Stage 22: clicking Release actually removes the performer from the roster — never exercised before this session');

    assert(click(doc, '[data-action="autoFillStalls"]'),
      'Stage 22: Auto-Fill Stalls is clickable');
    assert(saved(storage).builtPlots.find(p => p.id === openStall.id)?.assignedVendorId === 'vend_piepeddler',
      'Stage 22: clicking Auto-Fill Stalls actually seats the hired-but-unseated vendor into the open stall');

    dom.window.close();
  }

  // --- hireVendor's day-rate let-go path: firing a vendor hired at the
  // no-commitment day rate charges no cancellation fee. The DOM boot test
  // above only ever fires a Weekend Package vendor (the fee path); the
  // plain, more common day-rate let-go had never been clicked. ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'vendor', 1, 2).state;
    s = State.hireVendor(s, 'vend_leather', 'open').state;
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="backstage"]');
    assert(click(doc, '[data-action="fireVendor"][data-id="vend_leather"]'),
      'Stage 22: a Day Rate vendor’s Let go button is clickable');
    assert(!saved(storage).hiredVendors.includes('vend_leather'),
      'Stage 22: clicking Let go actually removes the vendor — never exercised before this session');
    assert(!doc.querySelector('#content').innerHTML.includes('cancellation fee'),
      'Stage 22: letting a Day Rate (no-commitment) vendor go charges no fee, unlike the Weekend Package path the DOM boot test already covers');

    dom.window.close();
  }

  // --- unassignVendor + the assignVendor <select>'s change event (Fair Floor) ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.hireVendor(s, 'vend_cider', 'open').state; // seats at (6,2)
    s = State.buildPlot(s, 'food', 9, 2).state;
    s = State.hireVendor(s, 'vend_piepeddler', 'open').state; // seats at (9,2)
    const seatedPlot = s.builtPlots.find(p => p.x === 6);
    const openPlot = s.builtPlots.find(p => p.x === 9);
    s = State.unassignVendorFromPlot(s, openPlot.id).state; // (9,2) open, vend_piepeddler unseated
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="fairfloor"]');

    assert(click(doc, `.plot-card[data-kind="food"] [data-action="unassignVendor"][data-id="${seatedPlot.id}"]`),
      'Stage 22: a staffed stall’s Unassign button is clickable');
    assert(saved(storage).builtPlots.find(p => p.id === seatedPlot.id).assignedVendorId === null,
      'Stage 22: clicking Unassign actually clears the seat — never exercised before this session');

    const assignSelect = doc.querySelector(`select[data-action="assignVendor"][data-plot="${openPlot.id}"]`);
    assert(!!assignSelect, 'Stage 22: an open stall with a hired-unseated vendor offers the seat-a-vendor <select>');
    assignSelect.value = 'vend_piepeddler';
    assignSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert(saved(storage).builtPlots.find(p => p.id === openPlot.id).assignedVendorId === 'vend_piepeddler',
      'Stage 22: dispatching change on the assignVendor <select> actually seats the chosen vendor — never exercised before this session, since main.js’s change handling runs on a different event path from every click either suite fires');

    dom.window.close();
  }

  // --- selectMove/moveTo, renamePlot, demolishPlot, deletePlanningPlot (Fair Floor) ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'demo', 0, 1).state; // built, for relocate/rename/demolish
    s = State.placePlot(s, 'demo', 2, 1).state; // planning, for deletePlanningPlot
    const builtPlot = s.builtPlots.find(p => p.status === 'built');
    const planningPlot = s.builtPlots.find(p => p.status === 'planning');
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="fairfloor"]');

    assert(click(doc, `[data-action="renamePlot"][data-id="${builtPlot.id}"]`),
      'Stage 22: a built plot’s Rename button is clickable');
    assert(saved(storage).builtPlots.find(p => p.id === builtPlot.id).name === 'The Jousting Green Renamed',
      'Stage 22: clicking Rename actually renames the plot to what window.prompt returned — never exercised before this session');

    const cashBeforeMove = saved(storage).cash;
    assert(click(doc, `[data-action="selectMove"][data-id="${builtPlot.id}"]`),
      'Stage 22: a built plot’s Relocate button is clickable');
    const moveGhosts = [...doc.querySelectorAll(`[data-action="moveTo"][data-plot="${builtPlot.id}"]`)];
    assert(moveGhosts.length > 0, 'Stage 22: selecting Relocate reveals ghost cells on the grounds map, same as a fresh placement');
    // One "ghost" is always the plot's own current cell (relocating onto
    // yourself is legal, if pointless) — pick a different one so the test
    // actually proves the plot moved rather than paying a fee to stay put.
    const destGhost = moveGhosts.find(g => Number(g.dataset.x) !== builtPlot.x || Number(g.dataset.y) !== builtPlot.y);
    assert(!!destGhost, 'Stage 22: at least one relocate destination is a different cell than the plot’s own');
    destGhost.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const movedPlot = saved(storage).builtPlots.find(p => p.id === builtPlot.id);
    assert(movedPlot.x !== builtPlot.x || movedPlot.y !== builtPlot.y,
      'Stage 22: moveTo actually moved the plot to the clicked cell');
    assert(saved(storage).cash < cashBeforeMove,
      'Stage 22: relocating a built plot actually charges the demolish-plus-rebuild fee');

    assert(click(doc, `[data-action="deletePlanningPlot"][data-id="${planningPlot.id}"]`),
      'Stage 22: a planning plot’s Delete button is clickable');
    assert(!saved(storage).builtPlots.some(p => p.id === planningPlot.id),
      'Stage 22: clicking Delete actually removes the planning plot — never exercised before this session');

    const cashBeforeDemolish = saved(storage).cash;
    assert(click(doc, `[data-action="demolishPlot"][data-id="${builtPlot.id}"]`),
      'Stage 22: a built plot’s Demolish button is clickable');
    assert(!saved(storage).builtPlots.some(p => p.id === builtPlot.id),
      'Stage 22: clicking Demolish actually removes the plot — never exercised before this session');
    assert(saved(storage).cash < cashBeforeDemolish,
      'Stage 22: demolishing actually charges the teardown fee');

    dom.window.close();
  }

  // --- cancelMove: re-running Stage 22's own wiring-audit method (grep
  // every data-action in main.js, cross-reference against both suites)
  // turned up one action its own list missed — selectMove/moveTo were
  // covered, but the move-in-progress banner's Cancel button never was. ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'demo', 0, 1).state;
    const builtPlot = s.builtPlots.find(p => p.status === 'built');
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="fairfloor"]');

    assert(click(doc, `[data-action="selectMove"][data-id="${builtPlot.id}"]`),
      'Stage 23: a built plot’s Relocate button is clickable');
    assert(doc.querySelectorAll(`[data-action="moveTo"][data-plot="${builtPlot.id}"]`).length > 0,
      'Stage 23: selecting Relocate reveals destination ghost cells on the map');
    assert(click(doc, '[data-action="cancelMove"]'),
      'Stage 23: the move-in-progress banner’s Cancel button is clickable — never exercised before this session');
    assert(doc.querySelectorAll('[data-action="moveTo"]').length === 0,
      'Stage 23: clicking Cancel actually exits move mode — no destination ghosts remain on the map');
    assert(saved(storage).builtPlots.find(p => p.id === builtPlot.id).x === builtPlot.x
      && saved(storage).builtPlots.find(p => p.id === builtPlot.id).y === builtPlot.y,
      'Stage 23: cancelling a relocate leaves the plot exactly where it was, uncharged');

    dom.window.close();
  }

  // --- the schedule <select>'s change event (Fair Floor) ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'stage', 3, 0).state;
    s = State.contractPerformer(s, 'perf_musician_1', 'open').state; // on the roster, not yet scheduled
    s = { ...s, cash: 20000 };
    const stagePlot = s.builtPlots.find(p => p.kind === 'stage');

    const { dom, doc, storage } = await boot(s);
    click(doc, '[data-tab="fairfloor"]');

    const scheduleSelect = doc.querySelector(`select[data-action="schedule"][data-block="morning"][data-stage="${stagePlot.id}"]`);
    assert(!!scheduleSelect, 'Stage 22: the schedule grid offers a <select> for the built stage’s Morning Procession slot');
    scheduleSelect.value = 'perf_musician_1';
    scheduleSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert(saved(storage).schedule.morning[stagePlot.id] === 'perf_musician_1',
      'Stage 22: dispatching change on the schedule <select> actually books the performer — never exercised before this session');

    const scheduleSelect2 = doc.querySelector(`select[data-action="schedule"][data-block="morning"][data-stage="${stagePlot.id}"]`);
    scheduleSelect2.value = '';
    scheduleSelect2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert(saved(storage).schedule.morning[stagePlot.id] === undefined,
      'Stage 22: setting the schedule <select> back to empty actually unassigns the slot');

    dom.window.close();
  }

  // --- the ticket-price slider's input/change events, and launchCampaign (Office) ---
  {
    let s = State.createInitialState();
    s = { ...s, cash: 20000 };

    const { dom, doc, storage } = await boot(s); // Office is the default tab
    const slider = doc.querySelector('#ticketPrice');
    assert(!!slider, 'Stage 22: the ticket-price slider is present on the Office tab');
    slider.value = '24';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert(doc.querySelector('#priceReadout')?.textContent === '$24',
      'Stage 22: dispatching input on the ticket-price slider updates the live readout — never exercised before this session');
    assert(saved(storage).ticketPrice !== 24,
      'Stage 22: input alone does not commit the new price — that is change’s job');
    slider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert(saved(storage).ticketPrice === 24,
      'Stage 22: dispatching change on the ticket-price slider actually commits the new price — never exercised before this session');

    const campaignBtn = doc.querySelector('[data-action="launchCampaign"]:not([disabled])');
    assert(!!campaignBtn, 'Stage 22: at least one campaign is launchable on a fresh faire');
    const campaignId = campaignBtn.dataset.id;
    assert(click(doc, `[data-action="launchCampaign"][data-id="${campaignId}"]`),
      'Stage 22: a launchable campaign’s Launch button is clickable');
    assert(saved(storage).activeCampaign?.id === campaignId,
      'Stage 22: clicking Launch actually starts the campaign — never exercised before this session');

    dom.window.close();
  }

  // --- the footer save bar (Stage 22's headline task): mounted with only
  // export/import (locked decision #48's buttons option — #resetBtn stays
  // the one eraser), and both buttons actually round-trip through the real
  // gvb-save.js pipeline rather than being asserted present and untested. ---
  {
    let s = State.createInitialState();
    s = { ...s, cash: 4321, day: 3 };

    const { dom, doc, storage } = await boot(s);
    const gvbButtons = [...doc.querySelectorAll('#save-bar [data-gvb]')].map(b => b.dataset.gvb);
    assert(gvbButtons.length === 2 && gvbButtons.includes('export') && gvbButtons.includes('import'),
      `Stage 22: the footer save bar mounts exactly export and import, no reset (got: ${gvbButtons.join(',')})`);
    assert(!!doc.querySelector('#resetBtn'),
      'Stage 22: #resetBtn is untouched — mounting a second eraser beside it was the thing to avoid');

    // Export: jsdom implements neither URL.createObjectURL nor a readable
    // Blob, so the Blob constructor is wrapped just long enough to capture
    // what gvb-save.js actually wrote, rather than mocking the module itself.
    const OrigBlob = globalThis.Blob;
    let exportedText = null;
    globalThis.Blob = class extends OrigBlob {
      constructor(parts, opts) { super(parts, opts); exportedText = parts[0]; }
    };
    globalThis.URL.createObjectURL = () => 'blob:mock';
    globalThis.URL.revokeObjectURL = () => {};
    assert(click(doc, '#save-bar [data-gvb="export"]'), 'Stage 22: the Export save button is clickable');
    globalThis.Blob = OrigBlob;
    const exported = exportedText && JSON.parse(exportedText);
    // Phase 4 bumped the slot to version 2, the first bump this game has
    // had; an exported file says which shape it is in.
    assert(exported?.format === 'gvb-save' && exported.game === 'faire-weekend' && exported.version === 2,
      'Stage 22: Export writes a real gvb-save envelope for this game, not a stub (version 2 as of Phase 4)');
    assert(exported?.state?.cash === 4321,
      'Stage 22: the exported envelope actually carries the live game state, not a snapshot from boot');

    // Import: build a save file with a state distinct enough to prove it
    // actually landed, wire it into the hidden <input type="file"> the same
    // way a real file chooser would, and dispatch the change event
    // gvb-save.js's promptImport() is waiting on.
    globalThis.FileReader = dom.window.FileReader;
    assert(click(doc, '#save-bar [data-gvb="import"]'), 'Stage 22: the Import save button is clickable');
    const fileInput = doc.querySelector('input[type="file"]');
    assert(!!fileInput, 'Stage 22: clicking Import creates the hidden file-picker input promptImport() uses');
    const importedState = { ...State.createInitialState(), cash: 99999, day: 7 };
    const file = new dom.window.File([JSON.stringify(importedState)], 'my-save.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50)); // FileReader + the import Promise both resolve async
    assert(saved(storage).cash === 99999 && saved(storage).day === 7,
      'Stage 22: importing a file actually replaces the live save with its contents — never exercised before this session');

    dom.window.close();
  }
}

// ---------------------------------------------------------------------
// Section 1f: Stage 19 — grounds draw, price elasticity, block quality
// ---------------------------------------------------------------------

// --- computeGroundsDraw (pure) ---
{
  const empty = computeGroundsDraw([]);
  assert(empty.points === 0, 'empty grounds generate zero draw points');
  assert(empty.mult === GROUNDS_DRAW.floor, 'empty grounds sit exactly at the draw floor');

  const planning = computeGroundsDraw([{ id: 'a', kind: 'stage', status: 'planning' }]);
  assert(planning.points === 0, 'a planning-status plot contributes no draw \u2014 it is not on the grounds yet');

  const oneStage = computeGroundsDraw([{ id: 'a', kind: 'stage', status: 'built' }]);
  assert(oneStage.points === GROUNDS_DRAW.points.stage, 'one built stage contributes its full point value');
  assert(oneStage.mult > GROUNDS_DRAW.floor, 'building a single stage lifts the grounds above the empty-field floor');

  const emptyStall = computeGroundsDraw([{ id: 'b', kind: 'food', status: 'built', assignedVendorId: null }]);
  assert(emptyStall.points === 0, 'an unstaffed stall draws nobody \u2014 same rule stall revenue already follows');
  const staffedStall = computeGroundsDraw([{ id: 'b', kind: 'food', status: 'built', assignedVendorId: 'v1' }]);
  assert(staffedStall.points === GROUNDS_DRAW.points.food, 'a staffed stall does contribute draw');

  // Diminishing returns: the 2nd structure is worth more than the 20th.
  const ladder = (n) => computeGroundsDraw(Array.from({ length: n }, (_, i) => ({ id: 's' + i, kind: 'stage', status: 'built' }))).mult;
  const firstStep = ladder(2) - ladder(1);
  const laterStep = ladder(12) - ladder(11);
  assert(firstStep > laterStep, 'grounds draw has diminishing returns \u2014 an early structure moves the needle more than a late one');
  assert(ladder(60) <= GROUNDS_DRAW.ceiling + 1e-9, 'grounds draw is capped at its ceiling no matter how much is built');
  assert(computeGroundsDraw([{ id: 'z', kind: 'nonsense', status: 'built' }]).points === 0, 'an unknown kind contributes nothing rather than NaN');
}

// --- price elasticity + the ticket-revenue curve (pure) ---
{
  assert(priceFactor(CONFIG.priceAnchor) === 1, 'the anchor price is exactly neutral for attendance');
  assert(priceFactor(CONFIG.ticketPrice.max) < priceFactor(CONFIG.ticketPrice.min), 'a higher price suppresses attendance more than a lower one');

  const prices = [];
  for (let p = CONFIG.ticketPrice.min; p <= CONFIG.ticketPrice.max; p++) prices.push(p);
  const peak = prices.reduce((a, b) => (ticketRevenueIndex(b) > ticketRevenueIndex(a) ? b : a));
  // THE point of Stage 19's elasticity change: through Stage 18 this peaked
  // at exactly ticketPrice.max, which made the slider a solved problem.
  assert(peak > CONFIG.ticketPrice.min && peak < CONFIG.ticketPrice.max,
    'the ticket-revenue curve peaks strictly inside the slider, so neither extreme is the automatic answer');

  assert(priceSatisfactionDelta(CONFIG.priceAnchor) === 0, 'pricing at the anchor is satisfaction-neutral');
  assert(priceSatisfactionDelta(CONFIG.ticketPrice.max) < 0, 'gouging costs crowd satisfaction');
  assert(priceSatisfactionDelta(CONFIG.ticketPrice.min) > 0, 'a bargain gate earns goodwill');
  assert(Math.abs(priceSatisfactionDelta(CONFIG.priceAnchor + 5)) > Math.abs(priceSatisfactionDelta(CONFIG.priceAnchor - 5)),
    'the penalty for overcharging outweighs the bonus for undercharging by the same margin');
}

// --- blockQualityWeights: shade only counts while the sun is out ---
{
  for (const block of TIME_BLOCKS) {
    const w = blockQualityWeights(block);
    const sum = w.sightline + w.shade + w.pop;
    assert(Math.abs(sum - 1) < 1e-9, `quality weights sum to 1 in ${block.id}`);
    assert(typeof block.heat === 'number' && block.heat >= 0 && block.heat <= 1, `${block.id} authors a heat value in 0..1`);
  }
  const hottest = TIME_BLOCKS.reduce((a, b) => (b.heat > a.heat ? b : a));
  const coolest = TIME_BLOCKS.reduce((a, b) => (b.heat < a.heat ? b : a));
  assert(blockQualityWeights(hottest).shade > blockQualityWeights(coolest).shade, 'shade matters more in the hottest block than the coolest');
  assert(blockQualityWeights(coolest).sightline > blockQualityWeights(hottest).sightline, 'the weight shade gives up in a cool block rolls into sightline');
  assert(blockQualityWeights({}).sightline === 0.55, 'a block with no authored heat falls back to full-heat weighting');

  // The payoff: a hilltop (high sightline, no shade) and a grove (low
  // sightline, deep shade) should now swap places across the day. That
  // trade is the whole reason this function exists.
  const hill = TERRAIN_BASE.hill, woods = TERRAIN_BASE.woods;
  const score = (t, block) => { const w = blockQualityWeights(block); return t.sightline * w.sightline + t.shade * w.shade; };
  assert(score(hill, coolest) > score(woods, coolest), 'a hilltop stage beats a grove stage in the coolest block');
  assert(score(woods, hottest) - score(hill, hottest) > score(woods, coolest) - score(hill, coolest),
    'the grove closes the gap on the hilltop as the day heats up \u2014 terrain choice is schedule-dependent');
}

// ---------------------------------------------------------------------
// Section 1g: Stage 19 significance tests.
//
// These are deliberately different in kind from everything above. The rest
// of the suite asserts that a mechanic is *correctly implemented*; these
// assert that it is *strategically load-bearing*. Stage 18 shipped with a
// fully green suite and a dominant "build nothing, charge maximum" strategy,
// because no test ever asked whether the numbers mattered. Each assertion
// here is a design invariant: if one starts failing, a tuning change has
// quietly made part of the game pointless.
// ---------------------------------------------------------------------
{
  const base = () => ({
    day: 1, season: 1, cash: 20000, reputation: 55, ticketPrice: CONFIG.priceAnchor,
    builtPlots: [], roster: [], hiredVendors: [], schedule: {}, contracts: {}, vendorContracts: {},
    activeCampaign: null, campaignCooldowns: {}, history: [],
  });
  const avg = (state, key, n = 120) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += simulateDay(state, 77000 + i)[key];
    return total / n;
  };

  // 1. Opening the gates on an empty field must LOSE money. This is the
  //    single invariant Stage 18 violated hardest: an empty field earned
  //    about +$5,400 a day, more than a fully built faire cost to construct.
  const emptyField = base();
  assert(avg(emptyField, 'cashDelta') < 0, 'SIGNIFICANCE: an empty field loses money \u2014 doing nothing is not a viable strategy');
  assert(avg(emptyField, 'reputationDelta') < 0, 'SIGNIFICANCE: an empty field bleeds reputation as well as cash');

  // 2. Building must measurably grow the crowd, not just re-slice it.
  let built = base();
  built = State.buildPlot(built, 'stage', 3, 0).state;
  const stagePlot = built.builtPlots.find(p => p.kind === 'stage');
  assert(avg(built, 'attendance') > avg(emptyField, 'attendance') * 1.5,
    'SIGNIFICANCE: building a stage substantially grows attendance \u2014 the grounds are an input to the crowd, not just a container for it');

  // 3. Neither end of the ticket slider is the automatic answer.
  const cheap = { ...built, ticketPrice: CONFIG.ticketPrice.min };
  const dear = { ...built, ticketPrice: CONFIG.ticketPrice.max };
  const mid = { ...built, ticketPrice: CONFIG.priceAnchor };
  assert(avg(mid, 'cashDelta') > avg(dear, 'cashDelta'), 'SIGNIFICANCE: maxing the ticket price is NOT cash-optimal');
  assert(avg(mid, 'cashDelta') > avg(cheap, 'cashDelta'), 'SIGNIFICANCE: bottoming out the ticket price is not cash-optimal either');
  assert(avg(cheap, 'satisfaction') > avg(dear, 'satisfaction'), 'SIGNIFICANCE: price is a real cash-vs-goodwill trade, not free money');

  // 4. Fixed costs have to be big enough to notice. If the daily nut is
  //    rounding error against revenue, every cost mechanic in the game
  //    (upkeep, contracts, cancellation fees, the bankruptcy floor) is
  //    decorative — which is exactly what Stage 18 shipped.
  const bigDay = simulateDay(built, 4242);
  assert(bigDay.costs > (bigDay.ticketRevenue + bigDay.vendorRevenue) * 0.25,
    'SIGNIFICANCE: daily costs are a meaningful share of revenue, not a rounding error');

  // 5. Upkeep on a built-out grounds has to be visible in the ledger.
  let sprawl = base();
  for (const [k, x, y] of [['stage', 3, 0], ['stage', 8, 4], ['food', 2, 3], ['vendor', 4, 5], ['demo', 6, 5]]) {
    const r = State.buildPlot(sprawl, k, x, y);
    if (!r.error) sprawl = r.state;
  }
  assert(totalUpkeep(sprawl.builtPlots) > CONFIG.baseOverhead * 0.1,
    'SIGNIFICANCE: upkeep on a developed grounds is a real line item next to fixed overhead');

  // 6. Siting still has to beat noise once everything else is equal.
  assert(stagePlot && stagePlot.capacity < 400, 'SIGNIFICANCE: stage capacity is low enough that a successful faire eventually has to build a second stage');

  // 7. Stage 22: the weekend has to have a shape. Through Stage 21,
  //    weekendDay was set, incremented, and shown in the HUD, and nothing
  //    else ever read it — Friday, Saturday, and Sunday were mechanically
  //    the same day three times despite the game being named for the shape
  //    a weekend has. If this regresses to a flat multiplier again, nothing
  //    else in the suite would have caught it.
  const friday = { ...built, weekendDay: 1 };
  const saturday = { ...built, weekendDay: 2 };
  const sunday = { ...built, weekendDay: 3 };
  assert(avg(saturday, 'attendance') > avg(friday, 'attendance'),
    'SIGNIFICANCE: Saturday draws a bigger crowd than Friday on an identical grounds — the weekend has a shape');
  assert(avg(saturday, 'attendance') > avg(sunday, 'attendance'),
    'SIGNIFICANCE: Saturday draws a bigger crowd than Sunday too — it is the peak, not just "not Friday"');
  const fridayCash = avg(friday, 'cashDelta');
  const saturdayCash = avg(saturday, 'cashDelta');
  assert(saturdayCash > fridayCash,
    `SIGNIFICANCE: the bigger Saturday crowd shows up as more money, not just a cosmetic attendance number (Friday $${fridayCash.toFixed(0)} -> Saturday $${saturdayCash.toFixed(0)})`);

  // 8. Phase 1 increment 2: the ticket slider now has a second edge, and
  //    checks 1-7 above cannot see it — every state they use is a bare
  //    stage with nobody selling anything, so the only thing the price
  //    moved was attendance. With stalls on the grounds the gate takes its
  //    share of a guest's purse before the guest reaches a stall (#229), so
  //    a dear ticket does not just thin the crowd, it thins what is left of
  //    every purse that walks in. Both ends of the slider must still be
  //    wrong, and the till has to be the thing that says so.
  const withStalls = () => {
    let s = base();
    for (const [k, x, y] of [['stage', 3, 0], ['food', 5, 3], ['vendor', 6, 3]]) {
      const r = State.buildPlot(s, k, x, y);
      assert(!r.error, `stall-economy fixture: ${k} at ${x},${y} builds legally`);
      s = r.state;
    }
    for (const v of ['vend_cider', 'vend_leather']) s = State.hireVendor(s, v).state;
    return s;
  };
  const stalled = withStalls();
  assert(stalled.builtPlots.filter(p => p.assignedVendorId).length === 2, 'sanity check: the stall-economy fixture seated both vendors');
  const sCheap = { ...stalled, ticketPrice: CONFIG.ticketPrice.min };
  const sDear = { ...stalled, ticketPrice: CONFIG.ticketPrice.max };
  const sMid = { ...stalled, ticketPrice: CONFIG.priceAnchor };
  assert(avg(sMid, 'cashDelta') > avg(sDear, 'cashDelta'), 'SIGNIFICANCE: maxing the ticket price is not cash-optimal on a faire that actually sells things either');
  assert(avg(sMid, 'cashDelta') > avg(sCheap, 'cashDelta'), 'SIGNIFICANCE: nor is bottoming it out');
  const perHead = (st) => avg(st, 'vendorRevenue') / avg(st, 'attendance');
  assert(perHead(sDear) < perHead(sCheap) * 0.8,
    `SIGNIFICANCE: a dear ticket leaves visibly less in the purse for the stalls — the gate and the till compete for the same money (dear $${perHead(sDear).toFixed(2)}/head vs cheap $${perHead(sCheap).toFixed(2)}/head)`);

  // 9. Where a stall sits has to decide money, not just a tooltip. This is
  //    the claim Stages 14 and 17 made with clamped 0.6x-1.6x and 0.8x-1.2x
  //    coefficients; increment 2 took both out of the sales path, so if the
  //    walk does not reproduce it, the game quietly lost a mechanic.
  const sitedFaire = (x, y) => {
    let s = base();
    s.cash = 90000;
    for (const [k, cx, cy] of [['stage', 1, 0], ['demo', 5, 1], ['food', x, y]]) {
      const r = State.buildPlot(s, k, cx, cy);
      assert(!r.error, `siting fixture: ${k} at ${cx},${cy} builds legally`);
      s = r.state;
    }
    s = State.hireVendor(s, 'vend_stew').state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    const stage = s.builtPlots.find(p => p.kind === 'stage');
    for (const b of TIME_BLOCKS) s = State.assignSchedule(s, b.id, stage.id, 'perf_jester_2').state;
    return s;
  };
  const wellSited = avg(sitedFaire(3, 3), 'vendorRevenue', 40);
  const badlySited = avg(sitedFaire(9, 3), 'vendorRevenue', 40);
  assert(wellSited > badlySited * 1.15,
    `SIGNIFICANCE: the same vendor makes materially more money beside the show than seven hops out (near $${wellSited.toFixed(0)} vs far $${badlySited.toFixed(0)})`);

  // 10. The stalls have to be worth running and must not be the whole
  //     business. CONFIG.wristbandCut is the one number that sets this, and
  //     it moved from 0.28 to 0.12 in increment 2 because the gross it
  //     multiplies stopped being a coefficient and became real purses
  //     (#228). Raise it back toward a quarter and a built-out faire earns
  //     roughly three times what it costs to run, which puts the $25,000
  //     win condition inside two weekends and makes every construction and
  //     contract decision after that free. This is the band, asserted on
  //     the ledger rather than on the constant, so a change anywhere in the
  //     chain trips it.
  let developed = base();
  developed.cash = 200000;
  developed.reputation = 75;
  developed.season = 4;
  developed.weekendDay = 2;
  for (const [k, x, y] of [['stage', 3, 0], ['stage', 8, 0], ['food', 5, 3], ['vendor', 6, 3], ['demo', 8, 3], ['food', 12, 3], ['stage', 11, 8]]) {
    const r = State.buildPlot(developed, k, x, y);
    if (!r.error) developed = r.state;
  }
  for (const v of VENDORS.slice(0, 6)) developed = State.hireVendor(developed, v.id).state;
  for (const perf of PERFORMERS.slice(0, 6)) developed = State.contractPerformer(developed, perf.id).state;
  {
    let i = 0;
    for (const b of TIME_BLOCKS) {
      for (const stage of developed.builtPlots.filter(p => p.kind === 'stage')) {
        developed = State.assignSchedule(developed, b.id, stage.id, PERFORMERS[i++ % 6].id).state;
      }
    }
  }
  const devVendor = avg(developed, 'vendorRevenue', 40);
  const devTicket = avg(developed, 'ticketRevenue', 40);
  const devCosts = avg(developed, 'costs', 40);
  assert(devVendor > devCosts * 0.1,
    `SIGNIFICANCE: stalls on a built-out faire are clearly worth running — their cut covers a real share of the day's costs ($${devVendor.toFixed(0)} against $${devCosts.toFixed(0)})`);
  assert(devVendor < devTicket * 0.6,
    `SIGNIFICANCE: stalls are not the whole business model — the gate is still the bigger half ($${devVendor.toFixed(0)} against $${devTicket.toFixed(0)})`);
  const devNet = avg(developed, 'cashDelta', 40);
  assert(devNet < CONFIG.winCondition.minCash / (CONFIG.seasonLength * 2),
    `SIGNIFICANCE: a built-out faire cannot bank the win condition in two weekends — $${devNet.toFixed(0)} a day against $${(CONFIG.winCondition.minCash / (CONFIG.seasonLength * 2)).toFixed(0)}`);
  assert(devNet > 0, `SIGNIFICANCE: a built-out faire is still profitable, or there is nothing to play toward ($${devNet.toFixed(0)} a day)`);

  // 11. Phase 2: the sky has to change which ground is the good ground.
  //     TIME_BLOCKS already made terrain schedule-dependent — a hilltop is
  //     the best seat at Morning Procession and the worst at Afternoon —
  //     but averaged over a whole day the hilltop won every time, because
  //     the authored heats are fixed and two of the four blocks are cool.
  //     Weather is what makes the choice of ground a season-long bet rather
  //     than a solved one: on the hottest authored day the grove stage has
  //     the happier crowd across the whole day, and on the coolest the
  //     hilltop does. Two states, one stage each, same act in all four
  //     blocks, and only the ground and the sky differ.
  //
  //     Note what this is NOT asserted on. Terrain does not move
  //     attendance (computeGroundsDraw counts kinds, not ground) and
  //     satisfaction does not move today's cash, so the day's net is nearly
  //     identical either way and would pass this check under a completely
  //     broken weather term. What the flip actually pays is reputation,
  //     which is what tomorrow's gate is built from, so that is the second
  //     assertion here.
  const oneStageOn = (x, y) => {
    let s = base();
    s.cash = 60000;
    const r = State.buildPlot(s, 'stage', x, y);
    assert(!r.error, `terrain fixture: a stage at ${x},${y} builds legally`);
    s = r.state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    const st = s.builtPlots.find(p => p.kind === 'stage');
    for (const b of TIME_BLOCKS) s = State.assignSchedule(s, b.id, st.id, 'perf_jester_2').state;
    return s;
  };
  // (2,0) is four cells of authored hill; (8,0) is four cells of authored
  // woods. Both are inside the Weekend-1 fence.
  const hilltop = oneStageOn(2, 0);
  const grove = oneStageOn(8, 0);
  assert(terrainAt(2, 0) === 'hill' && terrainAt(8, 0) === 'woods', 'sanity check: the terrain fixture really is a hilltop against a grove');
  const hottest = WEATHER.reduce((a, b) => (b.heatMult > a.heatMult ? b : a));
  const coolest = WEATHER.reduce((a, b) => (b.heatMult < a.heatMult ? b : a));
  const under = (st, w, key) => avg({ ...st, weather: w.id }, key, 60);
  const hotHill = under(hilltop, hottest, 'satisfaction');
  const hotGrove = under(grove, hottest, 'satisfaction');
  const coolHill = under(hilltop, coolest, 'satisfaction');
  const coolGrove = under(grove, coolest, 'satisfaction');
  assert(hotGrove > hotHill,
    `SIGNIFICANCE: on the hottest authored day (${hottest.id}) the grove stage has the happier crowd (${hotGrove.toFixed(1)} against the hilltop's ${hotHill.toFixed(1)})`);
  assert(coolHill > coolGrove,
    `SIGNIFICANCE: and on the coolest (${coolest.id}) the hilltop takes it back (${coolHill.toFixed(1)} against the grove's ${coolGrove.toFixed(1)})`);
  assert(under(grove, hottest, 'reputationDelta') > under(hilltop, hottest, 'reputationDelta'),
    'SIGNIFICANCE: and the flip is worth reputation, not just a satisfaction number nothing spends');
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
// Section 1i: Phase 2 — weather worth checking.
//
// Weather is deliberately NOT drawn from the day's own rng (#231). It is a
// pure function of one number stored per save and the calendar position,
// which is what lets the Office desk print tomorrow's sky honestly and what
// stops a reload from rerolling today's. Most of what follows is that
// property, asserted from several directions, because a forecast that can
// disagree with the day that arrives is worse than no forecast at all.
// ---------------------------------------------------------------------
{
  // --- the table itself ---
  assert(WEATHER.length >= 5, `WEATHER authors a real spread of days (${WEATHER.length})`);
  const weatherIds = WEATHER.map(w => w.id);
  assert(new Set(weatherIds).size === weatherIds.length, 'every WEATHER id is unique');
  for (const w of WEATHER) {
    assert(typeof w.name === 'string' && w.name.length > 0, `${w.id} carries a name`);
    assert(typeof w.note === 'string' && w.note.length > 0, `${w.id} carries a note the UI can show`);
    assert(typeof w.heatMult === 'number' && w.heatMult >= 0, `${w.id} authors a non-negative heat multiplier`);
    assert(typeof w.attendanceMult === 'number' && w.attendanceMult > 0, `${w.id} authors a positive attendance multiplier`);
    assert(typeof w.satisfactionDelta === 'number', `${w.id} authors a satisfaction delta`);
    assert(w.early >= 0 && w.late >= 0, `${w.id} authors non-negative early/late weights`);
    assert(w.early > 0 || w.late > 0, `${w.id} is reachable somewhere in the season`);
  }
  const fair = WEATHER.find(w => w.id === DEFAULT_WEATHER_ID);
  assert(!!fair, `WEATHER carries the fallback row DEFAULT_WEATHER_ID names ('${DEFAULT_WEATHER_ID}')`);
  // The fallback has to be arithmetically invisible, because every state
  // written before this phase falls back to it — a fixture built from a
  // plain object literal, a save repaired on load, a history entry. If it
  // ever stops being neutral, "no weather" silently becomes "some weather".
  assert(fair.heatMult === 1 && fair.attendanceMult === 1 && fair.satisfactionDelta === 0,
    'the fallback weather row is neutral on all three multipliers');

  // --- lookup and fallback ---
  assert(weatherById(DEFAULT_WEATHER_ID) === fair, 'weatherById finds the row an id names');
  assert(weatherById('a-sky-nobody-authored') === fair, 'an unknown weather id falls back to the neutral row');
  assert(weatherById(undefined) === fair, 'a missing weather id falls back to the neutral row');
  assert(weatherFor({}) === fair, 'a state that never set weather reads as the neutral row');
  assert(weatherFor({ weather: 'downpour' }).id === 'downpour', 'weatherFor reads the id off the state');

  // --- the season's shape ---
  for (const w of WEATHER) {
    assert(weatherWeightAt(w, 1) === w.early, `${w.id} draws at its early weight in weekend 1`);
    assert(Math.abs(weatherWeightAt(w, WEATHER_SEASON_SPAN) - w.late) < 1e-9, `${w.id} draws at its late weight in weekend ${WEATHER_SEASON_SPAN}`);
    assert(weatherWeightAt(w, WEATHER_SEASON_SPAN + 6) === weatherWeightAt(w, WEATHER_SEASON_SPAN),
      `${w.id} holds its late weight past the end of the ramp rather than extrapolating`);
    assert(weatherWeightAt(w, 0) === w.early, `${w.id} holds its early weight before weekend 1`);
  }
  // The payoff, measured rather than asserted off the table: sample every
  // weekend-day of a lot of saves and count what actually turns up. Weekend
  // 1 has to be a hot season and weekend WEATHER_SEASON_SPAN a cool wet
  // one, or `seasonTarget: 6` is still six copies of the same weekend.
  const shareAt = (season) => {
    const counts = {};
    let total = 0;
    for (let seed = 0; seed < 800; seed++) {
      for (let wd = 1; wd <= CONFIG.seasonLength; wd++) {
        const w = rollWeather(seed, season, wd);
        counts[w.id] = (counts[w.id] || 0) + 1;
        total++;
      }
    }
    const share = (ids) => ids.reduce((sum, id) => sum + (counts[id] || 0), 0) / total;
    return { counts, share, total };
  };
  const early = shareAt(1);
  const late = shareAt(WEATHER_SEASON_SPAN);
  const hotIds = WEATHER.filter(w => w.heatMult > 1).map(w => w.id);
  const wetIds = ['drizzle', 'downpour'];
  assert(hotIds.length > 0 && wetIds.every(id => weatherIds.includes(id)), 'sanity check: the season-shape test names rows that exist');
  assert(early.share(hotIds) > late.share(hotIds) * 2,
    `SIGNIFICANCE: weekend 1 is a hot season and weekend ${WEATHER_SEASON_SPAN} is not (${(early.share(hotIds) * 100).toFixed(0)}% hot days against ${(late.share(hotIds) * 100).toFixed(0)}%)`);
  assert(late.share(wetIds) > early.share(wetIds) * 2,
    `SIGNIFICANCE: and the late season is the wet one (${(late.share(wetIds) * 100).toFixed(0)}% wet days against ${(early.share(wetIds) * 100).toFixed(0)}%)`);
  for (const w of WEATHER) {
    assert((early.counts[w.id] || 0) > 0 || (late.counts[w.id] || 0) > 0,
      `${w.id} actually turns up in play, not just in the table`);
  }

  // --- the roll is a lookup, not a draw ---
  assert(rollWeather(12345, 2, 3) === rollWeather(12345, 2, 3), 'rollWeather answers the same twice for the same save and calendar day');
  assert(rollWeather(12345, 2, 3) === rollWeather(12345, 2, 3), 'and a third time — it holds no state between calls');
  {
    // Different days of one save have to differ somewhere, or the "season"
    // is one sky repeated. Counted across a save's whole run rather than
    // asserted on one pair, since any two adjacent days may legitimately
    // match.
    const seen = new Set();
    for (let season = 1; season <= WEATHER_SEASON_SPAN; season++) {
      for (let wd = 1; wd <= CONFIG.seasonLength; wd++) seen.add(rollWeather(9001, season, wd).id);
    }
    assert(seen.size >= 3, `one save's season runs through several skies (${seen.size} distinct across ${WEATHER_SEASON_SPAN * CONFIG.seasonLength} days)`);
    const other = new Set();
    for (let season = 1; season <= WEATHER_SEASON_SPAN; season++) {
      for (let wd = 1; wd <= CONFIG.seasonLength; wd++) other.add(rollWeather(9002, season, wd).id);
    }
    let differs = false;
    for (let season = 1; season <= WEATHER_SEASON_SPAN && !differs; season++) {
      for (let wd = 1; wd <= CONFIG.seasonLength && !differs; wd++) {
        if (rollWeather(9001, season, wd).id !== rollWeather(9002, season, wd).id) differs = true;
      }
    }
    assert(differs, 'two saves get two different seasons');
  }

  // --- the weights ---
  {
    // Every authored combination has to leave three non-negative weights
    // summing to 1. This is the invariant WEATHER_SHADE_CEILING exists for:
    // sightline is 0.80 - shade, so an unbounded shade term would pay a
    // stage for having no view at all.
    for (const block of TIME_BLOCKS) {
      for (const w of WEATHER) {
        const q = blockQualityWeights(block, w);
        assert(q.sightline >= 0 && q.shade >= 0 && q.pop >= 0, `${block.id} under ${w.id} keeps every quality weight non-negative`);
        assert(Math.abs(q.sightline + q.shade + q.pop - 1) < 1e-9, `${block.id} under ${w.id} keeps the three quality weights summing to 1`);
        assert(q.shade <= WEATHER_SHADE_CEILING, `${block.id} under ${w.id} keeps shade under the ceiling`);
      }
    }
    // The ceiling has to be a guard rail, not a number the balance leans
    // on: if the hottest authored row is already pinned to it, retuning the
    // ceiling silently retunes the game.
    const liveMax = Math.max(...TIME_BLOCKS.flatMap(b => WEATHER.map(w => blockQualityWeights(b, w).shade)));
    assert(liveMax < WEATHER_SHADE_CEILING, `nothing authored reaches the shade ceiling (live max ${liveMax.toFixed(3)} against ${WEATHER_SHADE_CEILING})`);
    // ...and it does bite on something absurd, or it is not a guard rail.
    assert(blockQualityWeights({ heat: 1 }, { heatMult: 40 }).shade === WEATHER_SHADE_CEILING,
      'a nonsense heat multiplier is caught by the ceiling rather than driving sightline negative');
    assert(blockQualityWeights({ heat: 1 }, { heatMult: 40 }).sightline >= 0,
      'and sightline stays non-negative under it');

    // No weather argument has to mean exactly what it meant before this
    // phase existed, for every block, or ~850 assertions written against
    // the old weighting were quietly re-baselined.
    for (const block of TIME_BLOCKS) {
      const before = { sightline: 0.55 + (0.25 - 0.25 * block.heat), shade: 0.25 * block.heat, pop: 0.20 };
      const now = blockQualityWeights(block);
      assert(Math.abs(now.sightline - before.sightline) < 1e-9 && Math.abs(now.shade - before.shade) < 1e-9,
        `${block.id} with no weather weighs exactly as it did before Phase 2`);
      assert(Math.abs(blockQualityWeights(block, weatherById(DEFAULT_WEATHER_ID)).shade - before.shade) < 1e-9,
        `${block.id} under the neutral row weighs the same as under no row at all`);
    }
    const hottestRow = WEATHER.reduce((a, b) => (b.heatMult > a.heatMult ? b : a));
    const coolestRow = WEATHER.reduce((a, b) => (b.heatMult < a.heatMult ? b : a));
    const midday = TIME_BLOCKS.find(b => b.id === 'midday');
    assert(blockQualityWeights(midday, hottestRow).shade > blockQualityWeights(midday, coolestRow).shade,
      'the same block wants far more shade on the hottest authored day than the coolest');
    assert(blockQualityWeights(midday, hottestRow).shade > blockQualityWeights(midday, hottestRow).sightline,
      'and on the hottest day shade outweighs the view outright — that is what makes a hilltop the wrong place to be');
  }

  // --- the forecast cannot lie ---
  {
    assert(nextCalendarDay({ season: 2, weekendDay: 1 }).weekendDay === 2, 'the calendar rolls to the next day of the same weekend');
    assert(nextCalendarDay({ season: 2, weekendDay: 1 }).season === 2, 'without touching the weekend number');
    const rollover = nextCalendarDay({ season: 2, weekendDay: CONFIG.seasonLength });
    assert(rollover.season === 3 && rollover.weekendDay === 1, 'and a weekend’s last day rolls into the next weekend’s Friday');

    // The real assertion: walk a save through a whole weekend boundary,
    // reading the forecast before each advance and the stamp after it. This
    // is the one that would catch state.js and engine.js drifting apart —
    // nextCalendarDay models what nextDay/startNextWeekend do, and nothing
    // makes them do it except this check.
    let s = State.createInitialState();
    let checked = 0;
    for (let i = 0; i < 9; i++) {
      const forecast = forecastWeather(s);
      s = State.runDay(s, 5000 + i).state;
      s.bankrupt = false; // the fixture is an empty field; the point here is the calendar, not solvency
      let n = State.nextDay(s).state;
      if (n.phase === 'victory') n = State.acknowledgeVictory(n).state;
      if (n.phase === 'weekendEnd') n = State.startNextWeekend(n).state;
      s = n;
      assert(forecast.id === s.weather,
        `the forecast shown on the desk is the weather the day arrived with (weekend ${s.season} day ${s.weekendDay}: forecast ${forecast.id}, got ${s.weather})`);
      checked++;
    }
    assert(checked === 9, 'the forecast walk covered a full weekend rollover and then some');
  }

  // --- what the day does with it ---
  {
    let built = State.createInitialState();
    built.cash = 60000;
    built = State.buildPlot(built, 'stage', 3, 0).state;
    built = State.contractPerformer(built, 'perf_jester_2').state;
    const stage = built.builtPlots.find(p => p.kind === 'stage');
    for (const b of TIME_BLOCKS) built = State.assignSchedule(built, b.id, stage.id, 'perf_jester_2').state;

    const day = (weather, seed = 4242) => simulateDay({ ...built, weather }, seed);
    const neutral = day(DEFAULT_WEATHER_ID);
    const unstamped = simulateDay({ ...built, weather: undefined }, 4242);
    assert(neutral.attendance === unstamped.attendance && neutral.satisfaction === unstamped.satisfaction,
      'a day with no weather stamped on it resolves exactly like a fair one');

    const wet = WEATHER.reduce((a, b) => (b.attendanceMult < a.attendanceMult ? b : a));
    const dry = WEATHER.reduce((a, b) => (b.attendanceMult > a.attendanceMult ? b : a));
    assert(day(wet.id).attendance < neutral.attendance, `${wet.id} keeps people home (${day(wet.id).attendance} against ${neutral.attendance})`);
    assert(day(dry.id).attendance > neutral.attendance, `${dry.id} brings them out (${day(dry.id).attendance} against ${neutral.attendance})`);
    // Asserted as a ratio against the authored multiplier rather than as
    // "smaller", so a weather term that got wired in at half strength — or
    // stacked twice — fails here instead of passing as "still smaller".
    const ratio = day(wet.id).attendance / neutral.attendance;
    assert(Math.abs(ratio - wet.attendanceMult) < 0.02,
      `and by the multiplier the table authors, not some fraction of it (${ratio.toFixed(3)} against ${wet.attendanceMult})`);

    const gloomy = WEATHER.reduce((a, b) => (b.satisfactionDelta < a.satisfactionDelta ? b : a));
    const lovely = WEATHER.reduce((a, b) => (b.satisfactionDelta > a.satisfactionDelta ? b : a));
    assert(day(gloomy.id).weatherSatDelta === gloomy.satisfactionDelta, 'the report carries the mood the sky cost');
    assert(day(lovely.id).satisfaction > day(gloomy.id).satisfaction, 'a lovely day leaves a happier crowd than a miserable one');
    assert(day(gloomy.id).warnings.some(w => w.includes(gloomy.name)),
      'and a genuinely bad day says so on the report rather than only in the arithmetic');

    assert(day(wet.id).weather && day(wet.id).weather.id === wet.id, 'the day report carries the whole weather row, not an id to look up later');

    // The load-bearing determinism claim: weather takes no draw from the
    // day's own rng, so every seed rolls the events it rolled before this
    // phase landed. If a future change rolls the sky inside simulateDay,
    // this is what fails.
    let sameEvents = true;
    for (let seed = 0; seed < 40; seed++) {
      const a = simulateDay({ ...built, weather: 'scorcher' }, 6000 + seed);
      const b = simulateDay({ ...built, weather: 'downpour' }, 6000 + seed);
      if (JSON.stringify(a.events.map(e => e.id)) !== JSON.stringify(b.events.map(e => e.id))) sameEvents = false;
    }
    assert(sameEvents, 'weather takes no draw from the day rng — the same seed rolls the same events under any sky');
    const twice = day('drizzle');
    assert(twice.attendance === day('drizzle').attendance && twice.cashDelta === day('drizzle').cashDelta,
      'and the same seed under the same sky is still the same day');
  }

  // --- the save ---
  {
    // Both determinism checks below run under a clock that jumps a minute
    // per reading, because both are about code that MIGHT call Date.now()
    // and the real clock does not move between two adjacent statements.
    // Written the naive way first, and both passed against a deliberately
    // clock-seeded version — the two calls landed in the same millisecond,
    // so the assertion agreed with its own comment by luck (#147). Move
    // the clock and they fail as they claim to.
    const withMovingClock = (fn) => {
      const realNow = Date.now;
      let t = 1e9;
      Date.now = () => (t += 60000);
      try { return fn(); } finally { Date.now = realNow; }
    };

    const fresh = State.createInitialState();
    const again = withMovingClock(() => State.createInitialState());
    // createInitialState() drawing its seed off the clock was written first
    // and this is the assertion that refused it: two fixtures built a
    // millisecond apart got two different skies, and every test in this
    // file that compares two fresh states was silently comparing two
    // different days (#232).
    assert(fresh.weatherSeed === again.weatherSeed && fresh.weather === again.weather,
      'two states from createInitialState() are the same state whenever they are built — it is deterministic, and most of this file depends on that');
    assert(fresh.weatherSeed === State.DEFAULT_WEATHER_SEED,
      'and the seed it defaults to is the named constant, not something derived');
    assert(typeof fresh.weatherSeed === 'number' && Number.isFinite(fresh.weatherSeed), 'a new state carries a weather seed');
    assert(weatherIds.includes(fresh.weather), `and day one is stamped with a real sky (${fresh.weather})`);
    assert(State.createInitialState(1234).weather !== undefined && State.createInitialState(1234).weatherSeed === 1234,
      'and an explicit seed is honoured');
    let differs = false;
    for (let seed = 0; seed < 200 && !differs; seed++) {
      if (State.createInitialState(seed).weather !== fresh.weather) differs = true;
    }
    assert(differs, 'the seed is what decides the sky — different seeds give different opening days');
    assert(typeof State.newGame === 'function' && Number.isFinite(State.newGame().weatherSeed),
      'newGame() is the one thing that draws a real seed');

    const storage = makeMemoryStorage();
    const slot = State.saveSlot(storage);
    let s = State.createInitialState(777);
    s = State.runDay(s, 11).state;
    s = State.nextDay(s).state;
    slot.save(s);
    const back = slot.load();
    assert(back.weatherSeed === s.weatherSeed && back.weather === s.weather, 'the weather seed and today’s sky both survive a save/load round trip');
    assert(forecastWeather(back).id === forecastWeather(s).id, 'and so does the forecast — reloading does not reroll tomorrow');

    // A save written before this phase: no seed, no sky. It has to come
    // back neutral and, crucially, come back the SAME neutral twice — a
    // seed redrawn per load would rewrite the forecast under a player who
    // pressed F5, which is the whole thing #231 exists to prevent.
    const legacy = State.createInitialState(777);
    delete legacy.weather;
    delete legacy.weatherSeed;
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify(legacy));
    const repaired = State.saveSlot(storage).load();
    assert(repaired.weather === DEFAULT_WEATHER_ID, 'a save from before Phase 2 loads under the neutral sky');
    assert(typeof repaired.weatherSeed === 'number', 'and is given a weather seed on the way in');
    assert(repaired.weatherSeed === State.DEFAULT_WEATHER_SEED, 'and it is the named constant');
    const repairedTwice = withMovingClock(() => State.saveSlot(storage).load());
    assert(repairedTwice.weatherSeed === repaired.weatherSeed && forecastWeather(repairedTwice).id === forecastWeather(repaired).id,
      'and loading it again an hour later gives it the same season, not a fresh roll — a redrawn seed would rewrite the forecast under a player who pressed F5');
  }
}

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Section 20: CSS contrast regression (Stage 20)
//
// Stage 19's HANDOFF flagged that no browser was available to review the
// visual rebuild, so nothing had actually checked whether its color tokens
// were readable. A static WCAG contrast audit found two: --vellum-faint
// (2.9-3.1:1 against the panel backgrounds it's used as small text on —
// tab labels, table headers, HUD sub-labels) and --wine used as text on
// dark backgrounds (2.54:1 for the "bad"/"neg" ledger values — the one
// color meant to flag a loss). Both were retuned to hold >=4.5:1 (WCAG AA
// for normal-size text). This block parses the actual tokens out of
// style.css so a future edit that quietly darkens them again fails here
// instead of waiting for the next "no browser available" stage.
{
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const tokenValue = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    assert(m, `--${name} is defined in style.css`);
    return m ? m[1] : '#000000';
  };
  const hexToRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const linear = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const contrastRatio = (hex1, hex2) => {
    const l1 = luminance(hexToRgb(hex1)), l2 = luminance(hexToRgb(hex2));
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const AA_NORMAL = 4.5;

  const vellumFaint = tokenValue('vellum-faint');
  const wineText = tokenValue('wine-text');
  const bark = tokenValue('bark');           // .plat/#content panel body
  const cardBg = '#1A1610';                  // build-palette/plot-card/campaign-card body, hardcoded in CSS
  const hudBottom = '#1A1611';               // #hud gradient's darker stop, hardcoded in CSS

  assert(contrastRatio(vellumFaint, bark) >= AA_NORMAL,
    `--vellum-faint (${vellumFaint}) holds AA contrast against --bark (${bark}) — was 2.91:1 pre-Stage-20`);
  assert(contrastRatio(vellumFaint, cardBg) >= AA_NORMAL,
    `--vellum-faint (${vellumFaint}) holds AA contrast against card backgrounds (${cardBg})`);
  assert(contrastRatio(wineText, bark) >= AA_NORMAL,
    `--wine-text (${wineText}) holds AA contrast against --bark (${bark}) — --wine itself was 2.54:1 pre-Stage-20`);
  assert(contrastRatio(wineText, hudBottom) >= AA_NORMAL,
    `--wine-text (${wineText}) holds AA contrast against the HUD background (${hudBottom})`);

  // Guard the call sites too, not just the tokens: the two places that
  // specifically needed the brighter red should reference --wine-text,
  // not the original --wine (which stays as-is for borders/backgrounds).
  assert(/\.ledger-label\.bad\s*\{\s*color:\s*var\(--wine-text\)/.test(css),
    '.ledger-label.bad reads --wine-text, not the low-contrast --wine, for its text color');
  assert(/\.ledger-table td\.neg\s*\{\s*color:\s*var\(--wine-text\)/.test(css),
    '.ledger-table td.neg reads --wine-text, not the low-contrast --wine, for its text color');
}

// ---------------------------------------------------------------------
// Section 21: the fonts are vendored and stay vendored (Stage 21)
//
// index.html hotlinked three families from fonts.googleapis.com until this
// stage, and the board-check suite could not see it: prepPage() in
// Tools/board-check/harness.mjs fulfills Google Fonts requests locally from
// bundled @fontsource packages BEFORE the blocked-list check runs, so a font
// hotlink never lands in page.__blocked. That is why this check lives here
// and reads the file directly rather than trusting a browser run.
// ---------------------------------------------------------------------
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const fontsDir = path.join(root, 'assets/fonts');

  // Comments are stripped first: the <head> carries a "do not put these back"
  // note that names the domain, and a comment cannot make a request.
  const liveHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  assert(!/fonts\.googleapis\.com/.test(liveHtml), 'index.html makes no request to fonts.googleapis.com');
  assert(!/fonts\.gstatic\.com/.test(liveHtml), 'index.html makes no request to fonts.gstatic.com');

  // The general form of the same check: every href/src the browser would
  // actually fetch has to be relative. og:image and friends live in `content`
  // attributes, which are read by scrapers and never fetched by the page.
  const fetched = [...liveHtml.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const offsite = fetched.filter(u => /^(?:https?:)?\/\//.test(u));
  assert(offsite.length === 0, `every href/src in index.html is relative (offsite: ${offsite.join(', ') || 'none'})`);
  assert(!/node_modules/.test(css) && !/node_modules/.test(html),
    'nothing the browser loads references node_modules');

  // Every declared face resolves to a file that is actually on disk. A typo in
  // a src path is silent in a browser: the family just falls back.
  const srcs = [...css.matchAll(/@font-face\s*\{[^}]*?src:\s*url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, '').trim());
  assert(srcs.length === 6, `style.css declares the six expected @font-face srcs (found ${srcs.length})`);
  let bytes = 0;
  for (const src of srcs) {
    const file = path.join(root, 'css', src);
    const there = fs.existsSync(file);
    assert(there, `@font-face src resolves to a real file: ${src}`);
    if (there) bytes += fs.statSync(file).size;
    assert(/\.woff2$/.test(src), `${path.basename(src)} is woff2 (no legacy formats — every browser that runs ES modules reads woff2)`);
  }
  assert(bytes === 259680, `the vendored fonts total 259,680 bytes as documented in assets/fonts/README.md (measured ${bytes})`);

  // The families the @font-face rules define have to be the families the
  // --font-* tokens ask for, or the vendoring silently does nothing.
  for (const family of ['Fraunces', 'Grenze Gotisch', 'Barlow Semi Condensed']) {
    assert(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${family}'`).test(css),
      `a local @font-face defines '${family}'`);
    assert(new RegExp(`--font-[a-z]+:\\s*'${family}'`).test(css),
      `the --font-* token for ${family} names the same family the @font-face defines`);
  }

  // Only the weights that are actually on screen. Measured with
  // getComputedStyle across every screen; see assets/fonts/README.md.
  const barlowWeights = [...css.matchAll(/@font-face\s*\{[^}]*'Barlow Semi Condensed'[^}]*font-weight:\s*(\d+)/g)].map(m => Number(m[1])).sort();
  assert(JSON.stringify(barlowWeights) === '[400,600,700]',
    `Barlow ships 400/600/700 and not the unused 500 the old hotlink fetched (got ${barlowWeights.join('/')})`);
  assert(fs.readdirSync(fontsDir).filter(f => f.endsWith('.woff2')).length === 6,
    'assets/fonts holds exactly the six files the stylesheet asks for — no orphans left behind');

  // Fraunces was hotlinked as a variable font with an optical-size axis. It
  // stays one: nine static cuts would be the wrong shape of fix.
  assert(/font-family:\s*'Fraunces'[^}]*font-weight:\s*100 900/.test(css.replace(/\n/g, ' ')),
    'Fraunces is declared across the full 100-900 variable weight range, not as static cuts');
  assert((css.match(/format\('woff2-variations'\)/g) || []).length === 3,
    'the three variable faces (Fraunces normal + italic, Grenze Gotisch) declare woff2-variations');
}

// ---------------------------------------------------------------------
// Section 23: mobile touch targets + grounds-map scroll affordance (Stage 23)
//
// Toured on a real 375x812 layout at the end of Stage 21 and left
// deliberately undone through Stage 22: 38 plot markers at 26px, buttons at
// 27-28px, and tabs at 40px, all under the 44px touch minimum, plus no
// affordance at all for the fact that the widest grounds tier runs wider
// than the viewport. None of this is renderable in a Node/jsdom suite (no
// real layout engine), so — same move as Stage 20's WCAG contrast audit —
// this parses the actual rule text back out of style.css and checks the
// arithmetic and the technique directly, rather than only printing a
// screenshot's worth of "looks fine."
// ---------------------------------------------------------------------
{
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  const mobileBlockMatch = css.match(/@media \(max-width:\s*720px\)\s*\{([\s\S]*?)\r?\n\}\r?\n/);
  assert(!!mobileBlockMatch, 'style.css still has its max-width: 720px breakpoint');
  const mobile = mobileBlockMatch[1];

  // Plot markers: the grid cell size minus the marker's own margin (2px a
  // side, set once at global scope and unchanged here) has to clear 44px.
  const mobileCell = Number((mobile.match(/--cell:\s*(\d+)px/) || [])[1]);
  const markerMargin = Number((css.match(/\.plot-marker\s*\{[^}]*?margin:\s*(\d+)px/) || [])[1]);
  assert(Number.isFinite(mobileCell) && Number.isFinite(markerMargin),
    'both --cell (mobile) and .plot-marker\u2019s margin parse as real numbers');
  assert(mobileCell - markerMargin * 2 >= 44,
    `a mobile plot marker (cell ${mobileCell}px \u2212 margin ${markerMargin}px \u00d7 2) is at least 44px (got ${mobileCell - markerMargin * 2}px) \u2014 was 26px pre-Stage-23`);

  // Buttons, tabs, and the footer controls all get an explicit floor rather
  // than a font/padding guess, so no variant (small, primary, danger, the
  // gvb-save.js footer buttons) can quietly fall back under 44px.
  for (const selector of ['.btn', '.tab-btn', '#save-bar button', '#resetBtn']) {
    const escaped = selector.replace(/[.#]/g, '\\$&');
    const rule = new RegExp(`${escaped}[^{]*\\{[^}]*min-height:\\s*44px`);
    assert(rule.test(mobile), `${selector} has a 44px min-height inside the mobile breakpoint (was ${selector === '.tab-btn' ? '40px' : selector === '.plot-marker' ? '26px' : 'under 44px'} pre-Stage-23)`);
  }

  // Phase 6: the map is wider than a phone at every tier (Home Grounds at
  // 48px is 489px of tracks plus the frame), and through Phase 5 the fix
  // was the sheet scrolling sideways with a four-gradient scroll shadow.
  // The stage pans now, under mapview.js's view, at every width. So this
  // checks the mechanism that replaced it: the stage clips, it hands
  // vertical swipes to the page and keeps the rest, the grid rides the
  // transform from its own origin, the sheet does not scroll in either
  // breakpoint any more, and the 44px guarantee is provable through the
  // view rather than through a cell size alone: on a coarse pointer the
  // view's floor scale keeps a marker at 44px however the stage is sized.
  const rule = (selector, from = css) => (from.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.#[\]=*+?()|]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
  const stage = rule('.plat-stage');
  assert(/overflow:\s*hidden/.test(stage), '.plat-stage clips the map: the stage is the viewport the view pans inside');
  assert(/touch-action:\s*pan-y/.test(stage), '.plat-stage leaves vertical swipes to the page (touch-action: pan-y) and keeps horizontal drags and pinches for the map');
  assert(/user-select:\s*none/.test(stage), '.plat-stage does not select text while a mouse drags it');
  const stagePad = stage.match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/);
  assert(stagePad && Number(stagePad[1]) === FRAME.top && Number(stagePad[2]) === FRAME.right && Number(stagePad[3]) === FRAME.bottom && Number(stagePad[4]) === FRAME.left,
    `.plat-stage\u2019s padding is mapview.js\u2019s FRAME (${FRAME.top} ${FRAME.right} ${FRAME.bottom} ${FRAME.left}), so the grid sits where the canvas paints the tracks`);
  const canvasRule = rule('.plat-canvas');
  assert(/position:\s*absolute/.test(canvasRule) && /inset:\s*0/.test(canvasRule) && /pointer-events:\s*none/.test(canvasRule), '.plat-canvas fills the stage behind the grid and takes no pointer events, so every tap reaches the marker under it');
  const map = rule('.grounds-map');
  assert(/transform-origin:\s*0 0/.test(map), '.grounds-map scales from its own top-left, which is what trackTransform() assumes');
  assert(/position:\s*relative/.test(map), '.grounds-map sits in flow inside the stage\u2019s padding, so the plat column keeps its intrinsic width');
  const mapGap = Number((map.match(/gap:\s*(\d+)px/) || [])[1]);
  const mapBorderW = Number((map.match(/border:\s*(\d+)px solid/) || [])[1]);
  assert(mapGap === TRACK.gap && mapBorderW === TRACK.border, `.grounds-map\u2019s gap (${mapGap}px) and border (${mapBorderW}px) are mapview.js\u2019s TRACK (${TRACK.gap}, ${TRACK.border}) \u2014 a drift here puts every marker off its terrain by a cell\u2019s worth per column`);
  assert(markerMargin === MARKER_MARGIN, `.plot-marker\u2019s margin (${markerMargin}px) is mapview.js\u2019s MARKER_MARGIN (${MARKER_MARGIN}), the number the 44px floor is computed from`);
  const wideBlockMatch = css.match(/@media \(max-width:\s*1080px\)\s*\{([\s\S]*?)\r?\n\}\r?\n/);
  assert(!!wideBlockMatch, 'style.css still has its max-width: 1080px breakpoint');
  const plotSheetWide = ((wideBlockMatch || [])[1] || '').match(/\.plat-sheet\s*\{([\s\S]*?)\}/)?.[1] || '';
  const plotSheetPhone = (mobile.match(/\.plat-sheet\s*\{([\s\S]*?)\}/) || [])[1] || '';
  assert(!/overflow-x|background-attachment/.test(plotSheetWide) && !/overflow-x|background-attachment/.test(plotSheetPhone),
    'neither breakpoint scrolls the sheet sideways any more \u2014 the stage pans, and a scrolling sheet under a panning stage would be two ways to move the map that disagree');
  assert(!/\.terrain-cell/.test(css), 'no .terrain-cell rule survives \u2014 the terrain is painted on the canvas, and a rule here would be dead CSS waiting to be trusted');

  // The floor, through the view: a coarse pointer at the phone cell on a
  // 330px stage (a 375 phone less the chrome) settles at scale 1 and its
  // markers measure 44px; a mouse on the same stage may shrink to fit.
  const coarseView = createView({ cols: 10, rows: 7, cell: mobileCell, viewport: { w: 330, h: 0 }, minScale: minScaleFor({ cell: mobileCell, coarse: true }) });
  assert(coarseView.scale === 1 && markerSize(coarseView) >= 44,
    `on a coarse pointer a 330px stage settles at scale ${coarseView.scale} with ${markerSize(coarseView)}px markers \u2014 the map pans rather than shrinking under 44px`);
  const fineView = createView({ cols: 10, rows: 7, cell: mobileCell, viewport: { w: 330, h: 0 }, minScale: minScaleFor({ cell: mobileCell, coarse: false }) });
  assert(fineView.scale < 1 && markerSize(fineView) < 44, `a mouse on the same stage fits the map at scale ${fineView.scale.toFixed(3)}, because a mouse does not need 44px`);
}

// ---------------------------------------------------------------------
// Section 24: #board's desktop column split (Stage 23, Phase 5)
//
// A live-browser measurement (not reproducible in jsdom, which does no real
// layout) found the desk column \u2014 Office/Backstage/Fair Floor, i.e. most of
// the game's own controls \u2014 squeezed to 373px on a 1280px desktop, because
// the grounds column's "auto" track sized itself off the build palette's
// flex-wrap row measured as if it never wraps (839px), not off the actual
// map (515px for the starting 10x7 grounds). Fixed with a fit-content()
// cap. The first attempt (`minmax(0, fit-content(710px))`) is invalid CSS \u2014
// fit-content() cannot nest inside minmax() per the grid spec \u2014 and a
// browser silently drops the whole declaration, collapsing #board to a
// single implicit column and stacking the map on top of the desk instead
// of beside it. That regression is invisible to this suite (jsdom does not
// validate grid-track syntax the way a real layout engine does), so this
// guards the specific shape of the fix rather than its rendered effect.
//
// Phase 5 made the cap the current tier's width rather than a fixed 710px
// (#246): fit-content(calc(...)) reading --cols, which main.js sets on
// #board (Section 28 checks that), and --cell. The calc is evaluated here
// for every tier against the plat's real width, so a constant that drifts
// from the sheet's padding fails by name.
// ---------------------------------------------------------------------
{
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const boardRule = (css.match(/#board\s*\{([\s\S]*?)\}/) || [])[1] || '';

  const shape = boardRule.match(/grid-template-columns:\s*fit-content\(calc\(var\(--cols\)\s*\*\s*var\(--cell\)\s*\+\s*\(var\(--cols\)\s*-\s*1\)\s*\*\s*1px\s*\+\s*(\d+)px\s*\+\s*([\d.]+)rem\)\)\s+minmax\(340px,\s*1fr\)/);
  assert(!!shape,
    '#board\u2019s first column is a bare fit-content(calc()) off --cols and --cell, not nested inside minmax() \u2014 minmax(0, fit-content(...)) is invalid CSS and silently drops the whole rule');
  assert(!/minmax\([^)]*fit-content/.test(boardRule),
    '#board never nests fit-content() inside minmax() \u2014 the exact invalid shape that collapsed the two-column layout to one column pre-fix');
  assert(/--cols:\s*14\s*;/.test(boardRule), '#board declares a --cols fallback of 14, the widest tier, so a page without main.js lays out as Stage 23 did');

  // The plat's real width around the tracks: .grounds-map's 1px border a
  // side, .plat-sheet's 12px padding and 3px double border a side, .plat's
  // 0.7rem padding and 1px border a side = 32px + 1.4rem. Each of those
  // is parsed back out rather than assumed.
  const px = n => Number((n || [])[1]);
  const sheetPad = px(css.match(/\.plat-sheet\s*\{[^}]*?padding:\s*(\d+)px/));
  const sheetBorder = px(css.match(/\.plat-sheet\s*\{[^}]*?border:\s*(\d+)px double/));
  const mapBorder = px(css.match(/\.grounds-map\s*\{[^}]*?border:\s*(\d+)px solid/));
  const platPadRem = Number((css.match(/\.plat\s*\{[^}]*?padding:\s*([\d.]+)rem/) || [])[1]);
  const platBorder = px(css.match(/\.plat\s*\{[^}]*?border:\s*(\d+)px solid/));
  const chromePx = 2 * (sheetPad + sheetBorder + mapBorder + platBorder);
  const chromeRem = 2 * platPadRem;
  assert(Number.isFinite(chromePx) && Number.isFinite(chromeRem), 'the sheet\u2019s and plat\u2019s padding and borders parse out of style.css');
  const capPx = shape ? Number(shape[1]) : NaN, capRem = shape ? Number(shape[2]) : NaN;
  // Phase 6: the stage's paper margin (mapview.js's FRAME, which the
  // stage's padding copies and Section 23 checks) sits inside the chrome.
  const framePx = FRAME.left + FRAME.right;
  assert(capPx === chromePx + framePx && capRem === chromeRem,
    `the calc\u2019s constants (${capPx}px + ${capRem}rem) are the chrome around the tracks plus the frame (${chromePx}px + ${framePx}px + ${chromeRem}rem) \u2014 a padding edited on one side and not the other reopens a gap or clips a column`);
  const desktopCell = Number((css.match(/:root\s*\{[\s\S]*?--cell:\s*(\d+)px/) || [])[1]);
  const widthFor = cols => cols * desktopCell + (cols - 1) + capPx + capRem * 16;
  for (const tier of GRID_EXPANSIONS) {
    const w = widthFor(tier.cols);
    assert(w >= tier.cols * desktopCell + (tier.cols - 1) + 2 * (sheetPad + sheetBorder + mapBorder) + framePx && w < 780,
      `${tier.label} (${tier.cols} wide) gets a ${w.toFixed(1)}px column at the desktop ${desktopCell}px cell \u2014 wide enough for its own map and frame and narrower than the 780px that would squeeze the desk under 480 on a 1280 desktop`);
  }
  assert(widthFor(10) < widthFor(14) - 180,
    `the Home Grounds column (${widthFor(10).toFixed(1)}px) is at least 180px narrower than Deep Woods Trail\u2019s (${widthFor(14).toFixed(1)}px) \u2014 Stage 23\u2019s fixed cap gave every tier the widest one\u2019s 710px`);
}

// ---------------------------------------------------------------------
// Section 25: Phase 2 — the weather is on screen (jsdom)
//
// A lever nothing on screen names is not a lever. weekendDay was set,
// incremented and displayed for sixteen stages while nothing read it;
// weather is the reverse failure mode waiting to happen — three multipliers
// silently moving the day's numbers with nothing telling the player which
// day they are planning against. So this boots the real page and reads the
// real DOM: today's sky in the permanent HUD, tomorrow's on the Office
// desk, the schedule's sun pips at today's heat rather than an average one,
// and the sky the day ran under on the ticket stub.
//
// Asserted against the DOM for what is on screen now, per locked decision
// #39 — the save carries the id, but an id in a save nobody renders is the
// bug this section exists to catch.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify(save));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    dom.window.prompt = () => 'A Name';
    dom.window.document.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'A') e.preventDefault();
    }, true);
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document, storage };
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return true;
  };

  // A save deliberately stamped with the worst sky in the table, so every
  // assertion below is looking for a specific named row rather than
  // whichever one the default seed happened to roll.
  const wet = WEATHER.reduce((a, b) => (b.attendanceMult < a.attendanceMult ? b : a));
  let s = State.createInitialState(4242);
  s.cash = 60000;
  s.weather = wet.id;
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.contractPerformer(s, 'perf_jester_2').state;
  const stage = s.builtPlots.find(p => p.kind === 'stage');
  for (const b of TIME_BLOCKS) s = State.assignSchedule(s, b.id, stage.id, 'perf_jester_2').state;

  const { doc } = await boot(s);

  // --- the HUD names today's sky ---
  const ledger = doc.querySelector('#ledger').textContent;
  assert(ledger.includes(wet.name), `the HUD names today's sky (${wet.name})`);
  const skySlot = [...doc.querySelectorAll('#ledger .ledger-item')].find(el => el.textContent.includes(wet.name));
  assert(!!skySlot, 'and it has its own slot rather than being buried in another item’s text');
  assert(/\d/.test((skySlot && skySlot.getAttribute('title')) || ''),
    'and the slot’s tooltip carries the numbers, not just the name — the whole point of the weekendDay precedent');

  // --- the Office desk forecasts tomorrow ---
  const tomorrow = forecastWeather(s);
  const forecastCard = doc.querySelector('.forecast-card');
  assert(!!forecastCard, 'the Office desk carries a forecast card');
  assert(forecastCard.textContent.includes(tomorrow.name),
    `and it names the sky tomorrow actually arrives with (${tomorrow.name})`);
  assert(forecastCard.textContent.includes(tomorrow.attendanceMult.toFixed(2)),
    'and prints the gate multiplier as a number a player can plan a day rate against');
  // --- the schedule's pips read today's heat, not the authored one ---
  {
    assert(click(doc, '[data-tab="fairfloor"]'), 'the Fair Floor tab is clickable');
    const rows = [...doc.querySelectorAll('.schedule-table tbody tr')];
    assert(rows.length === TIME_BLOCKS.length, `the schedule table has a row per time block (${rows.length})`);
    const hottestBlock = TIME_BLOCKS.reduce((a, b) => (b.heat > a.heat ? b : a));
    const row = rows.find(r => r.textContent.includes(hottestBlock.label));
    const pips = row.querySelectorAll('.heat-pip').length;
    // Under the wettest (and so coolest) authored sky the hottest authored
    // block loses its pips outright. With the pips read off block.heat
    // alone — the pre-Phase-2 code — this is 3.
    assert(pips < 3, `the hottest block shows fewer sun pips under ${wet.name} than its authored heat would give it (${pips})`);
    assert((doc.querySelector('.schedule-table + .hint') || { textContent: '' }).textContent.includes(wet.name.toLowerCase()) ||
      doc.querySelector('#content').textContent.toLowerCase().includes(wet.name.toLowerCase()),
      'and the hint under the table says which sky the pips are drawn at');
  }

  // --- the ticket stub says what the day ran under ---
  {
    click(doc, '[data-action="openGates"]');
    const stub = doc.querySelector('.ticket-stub');
    assert(!!stub, 'the gates opened and a report is on screen');
    // Read the row, not the stub's text. Written the loose way first —
    // "the stub mentions Downpour somewhere" — and deleting the weather row
    // outright left the suite green, because the bad-weather warning and
    // the draw breakdown both name the sky too. Three lines guarding the
    // same absence guard nothing (#34).
    const weatherRow = [...stub.querySelectorAll('.ticket-row')]
      .find(r => (r.querySelector('span') || {}).textContent === 'Weather');
    assert(!!weatherRow, 'the ticket stub carries a Weather row of its own');
    assert(!!weatherRow && weatherRow.textContent.includes(wet.name), `and it names the sky the day ran under (${wet.name})`);
    assert(!!weatherRow && weatherRow.textContent.includes(wet.attendanceMult.toFixed(2)),
      'and what that sky did to the gate, so a bad day reads as a bad day rather than a mystery');
  }

  // --- the forecast is tomorrow's, not today's rendered twice ---
  // Every boot below this line replaces globalThis.document, and main.js's
  // `$` reads that global — so a second JSDOM steals the first one's
  // renders. Everything that reads `doc` has to happen above here.
  {
    let split = null;
    for (let seed = 0; seed < 400 && !split; seed++) {
      const probe = State.createInitialState(seed);
      if (forecastWeather(probe).id !== weatherFor(probe).id) split = probe;
    }
    assert(!!split, 'a save exists whose today and tomorrow differ');
    const probe = { ...split, cash: 60000 };
    const { doc: doc2 } = await boot(probe);
    const card = doc2.querySelector('.forecast-card');
    assert(!!card && card.textContent.includes(forecastWeather(probe).name),
      `the forecast card shows tomorrow's sky (${forecastWeather(probe).name}), not today's (${weatherFor(probe).name})`);
    assert(!!card && !card.textContent.includes(weatherFor(probe).name),
      'and does not show today\u2019s at all, which is what a forecast card rendering the wrong day would look like');
  }

  // --- and the card's own arithmetic is a ratio, not a difference ---
  // Written as `tomorrow.attendanceMult - today.attendanceMult` first, which
  // reads correctly only when today is 1.00x. Off a washed-out day it is
  // badly wrong: 0.50x to 0.86x is 72% more people through the gate, not 36%.
  {
    let pair = null;
    for (let seed = 0; seed < 4000 && !pair; seed++) {
      const probe = State.createInitialState(seed);
      const today = weatherFor(probe), tomorrow = forecastWeather(probe);
      const ratio = Math.round((tomorrow.attendanceMult / today.attendanceMult - 1) * 100);
      const diff = Math.round((tomorrow.attendanceMult - today.attendanceMult) * 100);
      // Only a pair the two formulas disagree about can test anything.
      if (Math.abs(ratio - diff) >= 5) pair = { probe, ratio, diff };
    }
    assert(!!pair, 'a save exists whose forecast the two formulas disagree about');
    const { doc: doc3 } = await boot({ ...pair.probe, cash: 60000 });
    const hint = [...doc3.querySelectorAll('.forecast-card .hint')].map(e => e.textContent).join(' ');
    assert(hint.includes(`${Math.abs(pair.ratio)}%`),
      `the forecast prints the ratio (${pair.ratio}%) between today's gate and tomorrow's`);
    assert(!hint.includes(`${Math.abs(pair.diff)}%`),
      `and not the difference between the two multipliers (${pair.diff}%), which is only right when today is 1.00x`);
  }

  // --- a report written before this phase existed renders without one ---
  {
    let legacy = State.createInitialState(4242);
    legacy.cash = 20000;
    legacy = State.buildPlot(legacy, 'stage', 3, 0).state;
    legacy = State.runDay(legacy, 99).state;
    delete legacy.lastResult.weather;
    delete legacy.lastResult.weatherSatDelta;
    legacy.history[0] = legacy.lastResult;
    const { doc: doc3 } = await boot(legacy);
    const stub = doc3.querySelector('.ticket-stub');
    assert(!!stub, 'a day report from before Phase 2 still renders');
    assert(!/Weather/.test(stub.textContent),
      'and shows no weather row at all rather than inventing neutral multipliers the day never ran under');
  }
}

// ---------------------------------------------------------------------
// Section 1j: Phase 3 — acts with a story.
//
// A relationship number per contracted act, moved by what the day did;
// arcs whose beats fire at a tier and change a number for the rest of the
// save; one contract quote that the quick picks and a negotiated offer
// both go through; two events gated on the tiers. Most of what follows is
// pure. The DOM half is Section 26 below.
// ---------------------------------------------------------------------
{
  const R = RELATIONSHIP;
  // --- the table ---
  assert(R.min === 0 && R.max === 100 && R.neutral > R.min && R.neutral < R.max, 'RELATIONSHIP runs 0-100 with neutral strictly inside it');
  assert(R.tiers.length >= 3, `RELATIONSHIP names a real spread of tiers (${R.tiers.length})`);
  for (let i = 1; i < R.tiers.length; i++) assert(R.tiers[i].min < R.tiers[i - 1].min, `tiers are listed from the top down (${R.tiers[i].id} under ${R.tiers[i - 1].id})`);
  assert(R.tiers[R.tiers.length - 1].min === R.min, 'the lowest tier starts at the floor, so every number has a tier');
  assert(R.tiers.every(t => t.label && t.note), 'every tier carries a label and a note the tooltip can show');
  assert(R.tiers.find(t => t.id === 'devoted').min === R.devotedAt, 'devotedAt is the Devoted tier’s floor, not a second number to keep in sync');
  assert(relationshipTier(R.sourAt).id === 'sour' && relationshipTier(R.sourAt + 1).id !== 'sour', 'sourAt is the Sour tier’s ceiling');
  assert(relationshipTier(R.neutral).id === 'settled', 'a fresh signing reads as Settled');
  assert(relationshipTier(R.max).id === 'devoted' && relationshipTier(R.min).id === 'sour', 'the two ends are the two edges');
  assert(R.onBill > 0 && R.bestBlock > 0 && R.packedHouse > 0 && R.soldWell > 0, 'the good things move the number up');
  assert(R.offBill < 0 && R.sulked < 0 && R.soldNothing < 0 && R.unseated < 0, 'and the bad things move it down');
  assert(Math.abs(R.offBill) > R.onBill, 'a day left off the bill costs more than a day on it earns, so a benched act drifts sour rather than treading water');
  assert(relationshipOf({}, 'perf_jouster_1') === R.neutral, 'an act with no record reads as neutral');
  assert(relationshipOf({ relationships: { perf_jouster_1: 12 } }, 'perf_jouster_1') === 12, 'and one with a record reads its number');
  assert(relationshipOf(undefined, 'x') === R.neutral, 'relationshipOf survives no state at all');

  // --- the arcs ---
  const allActIds = new Set([...PERFORMERS.map(p => p.id), ...VENDORS.map(v => v.id)]);
  const tierIds = new Set(R.tiers.map(t => t.id));
  const allowedKeys = new Set(['id', 'label', 'note', 'cash', 'relationship', 'popularity', 'quality', 'rateMult', 'quirk']);
  const arcIds = ARCS.map(a => a.id);
  assert(new Set(arcIds).size === arcIds.length, 'every arc id is unique');
  const subjects = ARCS.map(a => a.subject);
  assert(new Set(subjects).size === subjects.length, 'no act has two arcs');
  const beatIds = ARCS.flatMap(a => a.beats.map(b => b.id));
  assert(new Set(beatIds).size === beatIds.length, 'every beat id is unique across every arc, since state.arcBeats is keyed by it alone');
  assert(ARCS.some(a => PERFORMERS.some(p => p.id === a.subject)) && ARCS.some(a => VENDORS.some(v => v.id === a.subject)), 'arcs exist for both a performer and a vendor');
  for (const arc of ARCS) {
    assert(allActIds.has(arc.subject), `${arc.id}’s subject ${arc.subject} is a real performer or vendor`);
    const isPerformer = PERFORMERS.some(p => p.id === arc.subject);
    assert(arc.beats.length >= 1, `${arc.id} has at least one beat`);
    assert(arc.beats.some(b => b.when === 'devoted') && arc.beats.some(b => b.when === 'sour'), `${arc.id} has a beat at both edges, so a run in either direction finds something`);
    for (const beat of arc.beats) {
      assert(tierIds.has(beat.when), `${beat.id}’s when ("${beat.when}") is a tier id`);
      assert(typeof beat.title === 'string' && beat.title.length > 0 && typeof beat.text === 'string' && beat.text.length > 40, `${beat.id} carries a title and a real paragraph`);
      assert(beat.choices.length >= 2, `${beat.id} offers a choice, not a notice`);
      const choiceIds = beat.choices.map(c => c.id);
      assert(new Set(choiceIds).size === choiceIds.length, `${beat.id}’s choice ids are unique`);
      for (const c of beat.choices) {
        assert(typeof c.label === 'string' && c.label.length > 0, `${beat.id}/${c.id} has a label`);
        for (const k of Object.keys(c)) assert(allowedKeys.has(k), `${beat.id}/${c.id} uses only effect keys resolveBeat reads (got "${k}")`);
        const moves = ['cash', 'relationship', 'popularity', 'quality', 'rateMult'].some(k => typeof c[k] === 'number' && c[k] !== 0 && !(k === 'rateMult' && c[k] === 1)) || ('quirk' in c);
        assert(moves || c.relationship === 0, `${beat.id}/${c.id} changes a number (or says out loud that it changes nothing)`);
        if ('popularity' in c) assert(isPerformer, `${beat.id}/${c.id} moves popularity only on a performer`);
        if ('quality' in c) assert(!isPerformer, `${beat.id}/${c.id} moves quality only on a vendor`);
        if ('quirk' in c) assert(isPerformer && (c.quirk === null || !!QUIRKS[c.quirk]), `${beat.id}/${c.id}’s quirk is null or a real QUIRKS id`);
        if ('rateMult' in c) assert(c.rateMult > 0, `${beat.id}/${c.id}’s rateMult is positive`);
        if ('cash' in c) assert(Number.isInteger(c.cash), `${beat.id}/${c.id}’s cash is whole dollars`);
      }
    }
  }
  assert(beatById('ysolde_sour').arc.id === 'arc_ysolde' && beatById('nope') === null, 'beatById finds a beat by id and returns null for a stranger');
  assert(actNameOf('perf_jouster_2') === 'Dame Ysolde Ironback' && actNameOf('vend_glass') === "Gaffer's Glass" && actNameOf('zzz') === 'zzz', 'actNameOf names a performer, a vendor, or echoes an unknown id');

  // --- the save's own version of an act ---
  {
    const base = performerById('perf_jouster_2');
    assert(performerFor({}, 'perf_jouster_2') === base, 'with no traits, performerFor hands back the catalog record itself');
    assert(performerFor({ actTraits: {} }, 'perf_jouster_2') === base, 'and with an empty traits map');
    const moved = performerFor({ actTraits: { perf_jouster_2: { popularity: -2, quirk: null } } }, 'perf_jouster_2');
    assert(moved.popularity === base.popularity - 2 && moved.quirk === null && base.quirk === 'prima_donna', 'traits lay popularity and quirk over the record without touching the catalog');
    assert(performerFor({ actTraits: { perf_jouster_2: { popularity: 40 } } }, 'perf_jouster_2').popularity === 10, 'popularity is clamped to 10');
    assert(performerFor({ actTraits: { perf_jouster_2: { quirk: 'night_owl' } } }, 'perf_jouster_2').quirk === 'night_owl', 'a quirk can be gained');
    assert(performerFor({}, 'nobody') === undefined, 'an unknown performer is still undefined');
    const vb = vendorById('vend_glass');
    assert(vendorFor({}, 'vend_glass') === vb, 'vendorFor hands back the catalog record with no traits');
    assert(vendorFor({ actTraits: { vend_glass: { quality: -2 } } }, 'vend_glass').quality === vb.quality - 2, 'and lays quality over it with traits');
    assert(traitRateMult({}, 'vend_glass') === 1 && traitRateMult({ actTraits: { vend_glass: { rateMult: 1.2 } } }, 'vend_glass') === 1.2, 'traitRateMult defaults to 1');
  }

  // --- the best block ---
  assert(bestBlockFor(performerById('perf_musician_3')).id === 'golden', 'a night owl’s best block is Golden Hour');
  assert(bestBlockFor(performerById('perf_jouster_1')).id === 'afternoon', 'a crowd pleaser’s best block is the Afternoon, the biggest crowd');
  assert(bestBlockFor(performerById('perf_jester_2')).id === 'afternoon', 'and so is a plain act’s');
  assert(bestBlockFor({ ...performerById('perf_jester_2'), quirk: 'night_owl' }).id === 'golden', 'a quirk gained through an arc moves it');

  // --- one quote for every contract ---
  {
    const s0 = State.createInitialState();
    const ys = performerById('perf_jouster_2');
    for (const opt of Object.values(CONTRACT_OPTIONS)) {
      const q = quoteContract(s0, 'performer', ys.id, opt);
      assert(q.dailyCost === Math.round(ys.cost * opt.priceMult), `at neutral a ${opt.label} quotes exactly what it did before this phase (${q.dailyCost})`);
      assert(q.contractId === opt.id && q.label === opt.label && q.commitDays === opt.commitDays && q.cancelFeeMult === opt.cancelFeeMult, `and carries the option’s id, label, commitment and fee`);
    }
    const day = quoteContract(s0, 'performer', ys.id, { commitDays: 0, cancelFeeMult: 0 });
    assert(day.dailyCost === ys.cost && day.contractId === 'offer' && day.commitDays === 0, 'a day-to-day offer with no fee is the listed rate');
    const dayFee = quoteContract(s0, 'performer', ys.id, { commitDays: 0, cancelFeeMult: 1 });
    assert(dayFee.dailyCost === day.dailyCost, 'a cancellation fee on a day rate buys nothing, since there are no days to owe it on');
    const wk = quoteContract(s0, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 0 });
    const wkFee = quoteContract(s0, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 0.5 });
    const wkFull = quoteContract(s0, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 1 });
    assert(wk.dailyCost < day.dailyCost && wkFee.dailyCost < wk.dailyCost && wkFull.dailyCost < wkFee.dailyCost, `commitment and then fee each buy a lower rate (${day.dailyCost} > ${wk.dailyCost} > ${wkFee.dailyCost} > ${wkFull.dailyCost})`);
    assert(wkFee.label === 'The weekend, half the days owed' && wkFee.commitDays === 3 && wkFee.cancelFeeMult === 0.5, 'a negotiated quote names its terms');
    const two = quoteContract(s0, 'performer', ys.id, { commitDays: 6, cancelFeeMult: 1 });
    assert(two.dailyCost < wkFull.dailyCost, 'two weekends is cheaper still');
    // The quick picks are points on the grid, not a second price list.
    assert(Math.abs(wkFee.mult - CONTRACT_OPTIONS.weekend.priceMult) <= 0.02, `"the weekend, half the days owed" prices within 2 points of the Weekend Package (${wkFee.mult.toFixed(2)} vs ${CONTRACT_OPTIONS.weekend.priceMult})`);
    assert(Math.abs(two.mult - CONTRACT_OPTIONS.season.priceMult) <= 0.03, `"two weekends, every day owed" prices within 3 points of the Season Contract (${two.mult.toFixed(2)} vs ${CONTRACT_OPTIONS.season.priceMult})`);
    assert(quoteContract(s0, 'performer', ys.id, { commitDays: 4, cancelFeeMult: 0 }) === null, 'a commitment not on the list is not on offer');
    assert(quoteContract(s0, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 0.3 }) === null, 'nor is a fee not on the list');
    assert(quoteContract(s0, 'performer', 'nobody', { commitDays: 0, cancelFeeMult: 0 }) === null, 'nor an act nobody has heard of');
    assert(offerDiscount(3, 0.5).priceMult === 1 - 0.12 - 0.04 && offerDiscount(0, 0.5).priceMult === 1, 'offerDiscount is the two list discounts, with the fee counting only against a commitment');
    // The relationship swing.
    const devoted = { ...s0, relationships: { [ys.id]: R.max } };
    const sour = { ...s0, relationships: { [ys.id]: R.min } };
    assert(Math.abs(relationshipRateMult(devoted, ys.id) - (1 - NEGOTIATION.relationshipSwing)) < 1e-9 && Math.abs(relationshipRateMult(sour, ys.id) - (1 + NEGOTIATION.relationshipSwing)) < 1e-9 && relationshipRateMult(s0, ys.id) === 1, 'the swing is symmetric about neutral and reaches NEGOTIATION.relationshipSwing at either end');
    const qD = quoteContract(devoted, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 0.5 });
    const qS = quoteContract(sour, 'performer', ys.id, { commitDays: 3, cancelFeeMult: 0.5 });
    assert(qD.dailyCost < wkFee.dailyCost && wkFee.dailyCost < qS.dailyCost, `SIGNIFICANCE: a Devoted act asks less and a Sour one more on the same terms (${qD.dailyCost} < ${wkFee.dailyCost} < ${qS.dailyCost})`);
    assert(qS.dailyCost - qD.dailyCost >= ys.cost * 0.2, `and the spread is worth caring about (${qS.dailyCost - qD.dailyCost} a day on a ${ys.cost} act)`);
    const cheap = { ...devoted, actTraits: { [ys.id]: { rateMult: 0.1 } } };
    assert(quoteContract(cheap, 'performer', ys.id, { commitDays: 6, cancelFeeMult: 1 }).mult === NEGOTIATION.floorMult, 'nothing stacks below the floor');
    const priced = { ...s0, actTraits: { [ys.id]: { rateMult: 1.5 } } };
    assert(quoteContract(priced, 'performer', ys.id, CONTRACT_OPTIONS.open).dailyCost === Math.round(ys.cost * 1.5), 'an arc’s rate multiplier prices every future contract, quick pick included');
    const vq = quoteContract(s0, 'vendor', 'vend_glass', { commitDays: 3, cancelFeeMult: 0.5 });
    assert(vq && vq.dailyCost === Math.round(vendorById('vend_glass').cost * wkFee.mult), 'vendors are priced through the same quote');
  }

  // --- signing through the quote ---
  {
    let s = State.createInitialState();
    s = State.contractPerformer(s, 'perf_jouster_2', 'weekend').state;
    const c = s.contracts.perf_jouster_2;
    assert(c.dailyCost === Math.round(750 * 0.85) && c.commitDaysRemaining === 3 && c.cancelFeeMult === 0.5 && c.label === 'Weekend Package' && c.contractId === 'weekend', 'a quick-pick contract stores exactly what it did before, plus its fee and label');
    assert(s.relationships.perf_jouster_2 === R.neutral, 'signing starts the relationship at neutral');
    const r = State.contractPerformer(State.createInitialState(), 'perf_jouster_2', { commitDays: 3, cancelFeeMult: 1 });
    assert(!r.error && r.state.contracts.perf_jouster_2.contractId === 'offer' && r.state.contracts.perf_jouster_2.cancelFeeMult === 1 && r.state.contracts.perf_jouster_2.commitDaysRemaining === 3, 'a negotiated offer signs with its own terms');
    assert(r.state.contracts.perf_jouster_2.dailyCost === quoteContract(State.createInitialState(), 'performer', 'perf_jouster_2', { commitDays: 3, cancelFeeMult: 1 }).dailyCost, 'at the rate the quote showed');
    assert(effectivePerformerCost(r.state, 'perf_jouster_2') === r.state.contracts.perf_jouster_2.dailyCost, 'and effectivePerformerCost reads it — no fourth cost path');
    const released = State.releasePerformer(r.state, 'perf_jouster_2');
    assert(released.fee === Math.round(r.state.contracts.perf_jouster_2.dailyCost * 3 * 1), `breaking a negotiated contract charges the fee the offer named (${released.fee}), not a CONTRACT_OPTIONS row’s`);
    assert(!('perf_jouster_2' in released.state.relationships), '#235: the relationship leaves with the act');
    const locked = State.contractPerformer(State.createInitialState(), 'perf_jouster_2', { commitDays: 6, cancelFeeMult: 0 });
    assert(locked.error && /Weekend 3/.test(locked.error), `a two-weekend commitment is gated to Weekend 3 like the Season Contract (${locked.error})`);
    assert(State.contractPerformer(State.createInitialState(), 'perf_jouster_2', { commitDays: 5, cancelFeeMult: 0 }).error, 'terms off the list are refused');
    // An old-shape contract (no cancelFeeMult, no label) still releases on its option row.
    let old = State.createInitialState();
    old = State.contractPerformer(old, 'perf_jouster_2', 'weekend').state;
    delete old.contracts.perf_jouster_2.cancelFeeMult;
    delete old.contracts.perf_jouster_2.label;
    const oldFee = State.releasePerformer(old, 'perf_jouster_2').fee;
    assert(oldFee === Math.round(Math.round(750 * 0.85) * 3 * 0.5), `a pre-Phase-3 contract record still charges its option row’s fee (${oldFee})`);
    // Vendors mirror all of it.
    let v = State.createInitialState();
    v = State.buildPlot(v, 'vendor', 1, 2).state;
    const vr = State.hireVendor(v, 'vend_glass', { commitDays: 3, cancelFeeMult: 0.5 });
    assert(!vr.error && vr.state.vendorContracts.vend_glass.contractId === 'offer' && vr.state.vendorContracts.vend_glass.cancelFeeMult === 0.5 && vr.state.relationships.vend_glass === R.neutral, 'a vendor signs a negotiated offer and starts at neutral');
    const fired = State.fireVendor(vr.state, 'vend_glass');
    assert(fired.fee === Math.round(vr.state.vendorContracts.vend_glass.dailyCost * 3 * 0.5) && !('vend_glass' in fired.state.relationships), 'and is let go on the offer’s own fee, taking the relationship with them');
    // Re-signing starts over.
    const again = State.contractPerformer({ ...released.state, relationships: { ...released.state.relationships } }, 'perf_jouster_2', 'open').state;
    assert(again.relationships.perf_jouster_2 === R.neutral, 'an act released and re-signed starts at neutral again');
  }

  // --- what the day does to the acts ---
  {
    let s = State.createInitialState();
    s.cash = 60000;
    s = State.buildPlot(s, 'stage', 3, 0).state;
    s = State.buildPlot(s, 'stage', 7, 3).state;
    s = State.contractPerformer(s, 'perf_jouster_2').state; // prima donna, 9
    s = State.contractPerformer(s, 'perf_magician_1').state; // prima donna, 7
    s = State.contractPerformer(s, 'perf_jester_2').state; // benched
    s = State.contractPerformer(s, 'perf_musician_3').state; // night owl
    s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_2').state;
    s = State.assignSchedule(s, 'midday', '7_3', 'perf_magician_1').state;
    s = State.assignSchedule(s, 'golden', '3_0', 'perf_musician_3').state;
    s = State.assignSchedule(s, 'afternoon', '7_3', 'perf_jouster_2').state;
    const result = simulateDay(s, 42);
    const rel = result.relationships;
    assert(rel && typeof rel === 'object', 'the day report carries a relationships map');
    assert(rel.perf_jester_2.delta === R.offBill && rel.perf_jester_2.notes.includes('left off the bill'), 'a contracted act nobody scheduled is left off the bill');
    assert(rel.perf_musician_3.delta === R.onBill + R.bestBlock && rel.perf_musician_3.notes.some(n => /Golden Hour/.test(n)), 'a night owl in Golden Hour played their best block');
    assert(rel.perf_magician_1.delta === R.onBill + R.sulked, 'the prima donna who lost the bill sulked, and it cost them');
    assert(rel.perf_jouster_2.delta === R.onBill + R.bestBlock && !rel.perf_jouster_2.notes.some(n => /sulk/.test(n)), 'the one who won it did not — and playing the Afternoon was their best block');
    assert(result.log.some(l => /Rosalind Quicksilver went home pleased: played, played Golden Hour, their best block\./.test(l)), 'a move of four or more is written on the report with its reasons');
    assert(!result.log.some(l => /Old Nettle went home/.test(l)), 'and a move of three is not — the report is not a ledger of every act every day');
    // A packed house: shrink a stage until it overflows.
    const tiny = { ...s, builtPlots: s.builtPlots.map(p => (p.id === '3_0' ? { ...p, capacity: 5 } : p)) };
    const packed = simulateDay(tiny, 42);
    assert(packed.warnings.some(w => /overflowed/.test(w)), 'sanity: the shrunk stage overflows');
    assert(packed.relationships.perf_jouster_2.notes.includes('played to a packed house'), 'the act on the overflowing stage played to a packed house');
    assert(packed.relationships.perf_jouster_2.delta === rel.perf_jouster_2.delta + R.packedHouse, 'and it is worth packedHouse on top');
    assert(!packed.relationships.perf_magician_1.notes.includes('played to a packed house'), 'the act on the other stage did not');
    // Vendors.
    let v = State.createInitialState();
    v.cash = 60000;
    v.reputation = 80;
    v = State.buildPlot(v, 'stage', 3, 0).state;
    v = State.buildPlot(v, 'food', 6, 3).state;
    v = State.buildPlot(v, 'food', 9, 3).state; // will be walked onto the spur below
    v = State.buildPlot(v, 'vendor', 8, 3).state;
    v = State.hireVendor(v, 'vend_cider', 'open').state; // seats at 6_3
    v = State.hireVendor(v, 'vend_stew', 'open').state; // seats at 9_3
    v = State.hireVendor(v, 'vend_glass', 'open').state; // seats at 8_3
    v = State.unassignVendorFromPlot(v, '8_3').state; // hired, unseated
    // The spur is unbuildable by rule (#227), so the stall is walked onto
    // it by hand, the way tests/guests.mjs builds its spur fixture.
    v = { ...v, builtPlots: v.builtPlots.map(p => (p.id === '9_3' ? { ...p, id: '4_4', x: 4, y: 4 } : p)) };
    assert(v.builtPlots.find(p => p.id === '4_4').assignedVendorId === 'vend_stew', 'sanity: the stew is on the spur');
    const vr = simulateDay(v, 7);
    assert(vr.relationships.vend_cider.delta === R.soldWell, 'a seated stall that took money sold well');
    assert(vr.relationships.vend_stew.delta === R.soldNothing && vr.relationships.vend_stew.notes.includes('sold nothing all day'), 'a seated stall nobody could reach sold nothing');
    assert(!!vr.relationships.vend_glass && vr.relationships.vend_glass.delta === R.unseated, 'a hired vendor with no stall was left standing');
    // runDay applies them.
    const ran = State.runDay(s, 42).state;
    assert(ran.relationships.perf_jester_2 === R.neutral + R.offBill && ran.relationships.perf_musician_3 === R.neutral + R.onBill + R.bestBlock, 'runDay moves each act by its delta');
    const floor = State.runDay({ ...s, relationships: { ...s.relationships, perf_jester_2: 1 } }, 42).state;
    assert(floor.relationships.perf_jester_2 === R.min, 'and clamps at the floor');
    const ceil = State.runDay({ ...s, relationships: { ...s.relationships, perf_musician_3: 99 } }, 42).state;
    assert(ceil.relationships.perf_musician_3 === R.max, 'and the ceiling');
    const gone = simulateDay({ ...s, roster: s.roster.filter(id => id !== 'perf_jester_2') }, 42);
    assert(!('perf_jester_2' in gone.relationships) && Object.keys(gone.relationships).length === 3, 'an act not under contract is never reported on, so runDay cannot resurrect a released one');
    // The same seed moves them the same way twice.
    assert(JSON.stringify(simulateDay(s, 42).relationships) === JSON.stringify(rel), 'the deltas are a pure function of the day');
    // And a state from before the phase still simulates and does not move anyone.
    const bare = { ...s };
    delete bare.relationships; delete bare.arcBeats; delete bare.actTraits;
    assert(simulateDay(bare, 42).attendance === result.attendance, 'a state with none of the three new maps runs the same day');
  }

  // --- the two gated events ---
  {
    assert(EVENT_POOL.some(e => e.id === 'evt_encore' && e.requires === 'hasDevotedAct') && EVENT_POOL.some(e => e.id === 'evt_late_call' && e.requires === 'hasSourAct'), 'the two new events are in the pool and gated on the two tier flags');
    assert(typeof EVENT_REQUIREMENTS.hasDevotedAct === 'function' && typeof EVENT_REQUIREMENTS.hasSourAct === 'function', 'both flags are in EVENT_REQUIREMENTS, so neither fails open');
    const enc = EVENT_EFFECTS.encore(makeRng(1));
    const late = EVENT_EFFECTS.late_call(makeRng(1));
    assert(enc.satisfactionDelta > 0 && enc.repDelta > 0 && /encore/.test(enc.message), 'an encore is good news');
    assert(late.satisfactionDelta < 0 && late.cashDelta < 0 && /missed their call/.test(late.message), 'a missed call is bad news');
    let s = State.createInitialState();
    s.cash = 60000;
    s = State.buildPlot(s, 'stage', 3, 0).state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    s = State.assignSchedule(s, 'afternoon', '3_0', 'perf_jester_2').state;
    const fired = (state, id) => { for (let seed = 0; seed < 300; seed++) if (simulateDay(state, seed).events.some(e => e.id === id)) return true; return false; };
    assert(!fired(s, 'evt_encore') && !fired(s, 'evt_late_call'), 'at neutral neither event can fire in 300 seeds');
    const devoted = { ...s, relationships: { perf_jester_2: R.devotedAt } };
    const sour = { ...s, relationships: { perf_jester_2: R.sourAt } };
    assert(fired(devoted, 'evt_encore') && !fired(devoted, 'evt_late_call'), 'a Devoted act unlocks the encore and not the missed call');
    assert(fired(sour, 'evt_late_call') && !fired(sour, 'evt_encore'), 'a Sour act unlocks the missed call and not the encore');
    assert(!fired({ ...s, relationships: { perf_jester_2: R.devotedAt - 1 } }, 'evt_encore'), 'one point under Devoted is not Devoted');
    const vend = { ...s, builtPlots: [...s.builtPlots], hiredVendors: ['vend_cider'], vendorContracts: { vend_cider: { contractId: 'open', dailyCost: 250, commitDaysRemaining: 0 } }, relationships: { vend_cider: R.max } };
    assert(fired(vend, 'evt_encore'), 'a Devoted vendor counts too');
    // The event rolls a neutral state made before this phase are the rolls it makes now.
    const oldEvents = [];
    for (let seed = 0; seed < 40; seed++) oldEvents.push(simulateDay(s, seed).events.map(e => e.id).join('|'));
    const bare = { ...s }; delete bare.relationships;
    const bareEvents = [];
    for (let seed = 0; seed < 40; seed++) bareEvents.push(simulateDay(bare, seed).events.map(e => e.id).join('|'));
    assert(oldEvents.join(',') === bareEvents.join(','), 'a state with no relationships rolls the events a neutral one does');
  }

  // --- beats ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    s = State.contractPerformer(s, 'perf_jouster_2', 'weekend').state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    assert(pendingBeats(s).length === 0, 'nothing is pending at neutral');
    const dev = { ...s, relationships: { ...s.relationships, perf_jouster_2: 85 } };
    const pend = pendingBeats(dev);
    assert(pend.length === 1 && pend[0].beat.id === 'ysolde_devoted' && pend[0].subjectName === 'Dame Ysolde Ironback', 'Ysolde at 85 has her Devoted beat pending and nothing else');
    assert(pendingBeats({ ...dev, roster: ['perf_jester_2'] }).length === 0, 'a released subject’s beats are not pending');
    assert(pendingBeats({ ...dev, relationships: { perf_jouster_2: 15 } })[0].beat.id === 'ysolde_sour', 'at 15 it is the Sour beat instead');
    assert(pendingBeats({ ...dev, arcBeats: { ysolde_devoted: 'thanks' } }).length === 0, 'a resolved beat never comes back');
    assert(pendingBeats({}).length === 0, 'pendingBeats survives an empty state');
    // Resolve it.
    const before = dev.contracts.perf_jouster_2.dailyCost;
    const r = State.resolveBeat(dev, 'ysolde_devoted', 'champion');
    assert(!r.error && r.state.arcBeats.ysolde_devoted === 'champion', 'resolving records the choice');
    assert(r.state.actTraits.perf_jouster_2.rateMult === 1.15 && r.state.actTraits.perf_jouster_2.popularity === 1, 'and its effects as traits');
    assert(r.state.contracts.perf_jouster_2.dailyCost === Math.round(before * 1.15), `a rate change re-prices the standing contract now (${before} → ${r.state.contracts.perf_jouster_2.dailyCost})`);
    assert(effectivePerformerCost(r.state, 'perf_jouster_2') === r.state.contracts.perf_jouster_2.dailyCost, 'through effectivePerformerCost');
    assert(performerFor(r.state, 'perf_jouster_2').popularity === 10, 'and her draw moved (9 → 10)');
    assert(r.state.relationships.perf_jouster_2 === 90, 'and the relationship moved by the choice’s own delta');
    assert(dev.contracts.perf_jouster_2.dailyCost === before && !dev.arcBeats.ysolde_devoted, 'the state passed in was not mutated');
    assert(pendingBeats(r.state).length === 0, 'and the beat is no longer pending');
    assert(State.resolveBeat(r.state, 'ysolde_devoted', 'thanks').error, 'resolving it again is refused');
    assert(State.resolveBeat(dev, 'ysolde_devoted', 'nope').error, 'a choice the beat does not offer is refused');
    assert(State.resolveBeat(dev, 'ysolde_sour', 'purse').error, 'a beat whose tier is not the current one is refused');
    assert(State.resolveBeat(dev, 'nothing', 'purse').error, 'an unknown beat is refused');
    // The other kinds of effect.
    const sourY = { ...s, relationships: { ...s.relationships, perf_jouster_2: 10 } };
    const purse = State.resolveBeat(sourY, 'ysolde_sour', 'purse').state;
    assert(purse.cash === sourY.cash - 400 && purse.relationships.perf_jouster_2 === 35, 'a purse costs cash and buys relationship');
    const headline = State.resolveBeat(sourY, 'ysolde_sour', 'headline').state;
    assert(performerFor(headline, 'perf_jouster_2').quirk === null && performerFor(headline, 'perf_jouster_2').popularity === 8, 'a quirk can be shed and popularity lowered');
    let a = State.createInitialState();
    a = State.contractPerformer(a, 'perf_magician_1').state;
    a = { ...a, relationships: { perf_magician_1: 90 } };
    const dusk = State.resolveBeat(a, 'aldric_devoted', 'dusk').state;
    assert(performerFor(dusk, 'perf_magician_1').quirk === 'night_owl' && bestBlockFor(performerFor(dusk, 'perf_magician_1')).id === 'golden', 'a quirk can be gained, and the best block follows it');
    let g = State.createInitialState();
    g = State.buildPlot(g, 'vendor', 1, 2).state;
    g = State.hireVendor(g, 'vend_glass').state;
    g = { ...g, cash: 5000, relationships: { vend_glass: 90 } };
    const rail = State.resolveBeat(g, 'glass_devoted', 'rail').state;
    assert(vendorFor(rail, 'vend_glass').quality === 10 && rail.cash === 5000 - 180, 'a vendor’s quality moves and the rail is paid for');
    // A rate multiplier compounds across beats and prices the next signing.
    const raised = State.resolveBeat({ ...a, relationships: { perf_magician_1: 10 } }, 'aldric_sour', 'raise').state;
    assert(raised.contracts.perf_magician_1.dailyCost === Math.round(550 * 1.2), 'Aldric’s raise lands on his standing contract');
    const rehired = State.contractPerformer(State.releasePerformer(raised, 'perf_magician_1').state, 'perf_magician_1', 'open').state;
    assert(rehired.contracts.perf_magician_1.dailyCost === Math.round(550 * 1.2), 'and on the next contract he signs');
    // SIGNIFICANCE 12: an arc's choice is a different day, not a different tooltip.
    let d = State.createInitialState();
    d.cash = 60000;
    d = State.buildPlot(d, 'stage', 3, 0).state;
    d = State.contractPerformer(d, 'perf_musician_2').state; // Fenwick, 6
    for (const b of TIME_BLOCKS) d = State.assignSchedule(d, b.id, '3_0', 'perf_musician_2').state;
    const plain = simulateDay(d, 11);
    const consort = simulateDay(State.resolveBeat({ ...d, relationships: { perf_musician_2: 90 } }, 'fenwick_devoted', 'consort').state, 11);
    assert(consort.attendance > plain.attendance, `SIGNIFICANCE: hiring the consort draws a bigger crowd on the same seed (${consort.attendance} vs ${plain.attendance})`);
    assert(consort.performerCosts === Math.round(plain.performerCosts * 1.5), `and costs a rate and a half (${consort.performerCosts} vs ${plain.performerCosts})`);
  }

  // --- a pre-arc save loads with every relationship at neutral ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.contractPerformer(s, 'perf_jouster_2', 'weekend').state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    s = State.hireVendor(s, 'vend_cider', 'weekend').state;
    delete s.relationships; delete s.arcBeats; delete s.actTraits;
    for (const c of Object.values(s.contracts)) { delete c.cancelFeeMult; delete c.label; }
    for (const c of Object.values(s.vendorContracts)) { delete c.cancelFeeMult; delete c.label; }
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify(s));
    const loaded = State.saveSlot(storage).load();
    assert(loaded && typeof loaded.relationships === 'object' && typeof loaded.arcBeats === 'object' && typeof loaded.actTraits === 'object', 'a pre-Phase-3 save comes through repair with all three maps');
    assert(['perf_jouster_2', 'perf_jester_2', 'vend_cider'].every(id => loaded.relationships[id] === R.neutral), 'and every act it had under contract is at neutral');
    assert(Object.keys(loaded.relationships).length === 3, 'and nobody else has a record');
    assert(Object.keys(loaded.arcBeats).length === 0 && Object.keys(loaded.actTraits).length === 0, 'with nothing resolved and nobody changed');
    assert(pendingBeats(loaded).length === 0, 'so nothing is pending on first load');
    assert(loaded.roster.length === 2 && loaded.hiredVendors.length === 1 && loaded.cash === s.cash, 'and it lost nothing');
    const fee = State.releasePerformer(loaded, 'perf_jouster_2').fee;
    assert(fee === Math.round(loaded.contracts.perf_jouster_2.dailyCost * 3 * 0.5), 'its old-shape Weekend Package still breaks on the option row’s fee');
  }
}

// ---------------------------------------------------------------------
// Section 26: Phase 3 on the page. Backstage wears the relationship, shows
// the beat as a card, and takes a negotiated offer through the delegated
// change listener; the ticket stub carries a Backstage row.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify(save));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    dom.window.prompt = () => 'A Name';
    dom.window.document.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'A') e.preventDefault();
    }, true);
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document, storage };
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return true;
  };
  const change = (doc, sel, value) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.value = String(value);
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
    return true;
  };
  const saved = (storage) => JSON.parse(storage.getItem('renn-faire-sim-save-v1'));

  // --- the relationship is on the page, and a beat is a card with buttons ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.contractPerformer(s, 'perf_jouster_2', 'weekend').state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    s = State.hireVendor(s, 'vend_cider').state;
    s.relationships.perf_jouster_2 = 85;
    s.relationships.vend_cider = 10;
    const { doc, storage } = await boot(s);
    click(doc, '[data-tab="backstage"]');
    const tags = [...doc.querySelectorAll('.roster-table .mood-tag')];
    assert(tags.length === 3, `every contracted act wears a mood tag (${tags.length} of 3)`);
    assert(tags.some(t => t.classList.contains('mood-devoted') && /Devoted/.test(t.textContent) && /85\/100/.test(t.title)), 'Ysolde’s reads Devoted and carries the number in its tooltip');
    assert(tags.some(t => t.classList.contains('mood-sour') && /Sour/.test(t.textContent)), 'the cider’s reads Sour');
    assert(tags.some(t => t.classList.contains('mood-settled')), 'and Old Nettle’s reads Settled');
    const cards = [...doc.querySelectorAll('.beat-card')];
    assert(cards.length === 1 && cards[0].dataset.beat === 'ysolde_devoted', 'the one pending beat is a card (the cider has no arc at Sour, since vend_cider has no arc at all)');
    assert(/Ironback rides/.test(cards[0].textContent) && /Dame Ysolde Ironback/.test(cards[0].textContent), 'the card names the beat and the act');
    const choiceBtns = cards[0].querySelectorAll('[data-action="resolveBeat"]');
    assert(choiceBtns.length === 2 && [...choiceBtns].every(b => b.title.length > 0), 'each choice is a button whose tooltip says what it moves');
    const costBefore = saved(storage).contracts.perf_jouster_2.dailyCost;
    assert(click(doc, '[data-action="resolveBeat"][data-id="ysolde_devoted"][data-choice="champion"]'), 'a choice is clickable');
    const after = saved(storage);
    assert(after.arcBeats.ysolde_devoted === 'champion' && after.actTraits.perf_jouster_2.rateMult === 1.15, 'clicking it resolves the beat into the save');
    assert(after.contracts.perf_jouster_2.dailyCost === Math.round(costBefore * 1.15), 'and re-prices her contract');
    assert(!doc.querySelector('.beat-card'), 'the card is gone');
    const row = [...doc.querySelectorAll('.roster-table tr')].find(tr => /Ysolde/.test(tr.textContent));
    assert(row && row.textContent.includes(`$${after.contracts.perf_jouster_2.dailyCost.toLocaleString()}/day`), 'the roster row shows the new rate');
    assert(row && row.querySelector('.stars').textContent.length === 5, 'and five stars for a draw of 10');
    assert(doc.querySelector('#content .warn') && /A bigger draw, at a bigger rate/.test(doc.querySelector('#content .warn').textContent), 'the flash carries the choice’s note');
  }

  // --- negotiating an offer, through the change listener ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    const { doc, storage } = await boot(s);
    click(doc, '[data-tab="backstage"]');
    assert(!doc.querySelector('.offer-card'), 'no offer row is open on boot');
    assert(click(doc, '[data-action="negotiate"][data-id="perf_musician_1"]'), 'Negotiate is clickable on an unsigned act');
    const card = doc.querySelector('.offer-card[data-id="perf_musician_1"]');
    assert(!!card, 'and opens an offer row under that act');
    const listed = performerById('perf_musician_1').cost;
    assert(card.querySelector('.offer-ask').textContent.includes(`$${listed}`), `it opens at the listed rate ($${listed}), day to day, no fee`);
    assert(change(doc, '.offer-card select[data-term="commitDays"]', 3), 'the commitment select is on the change listener');
    const ask3 = quoteContract(s, 'performer', 'perf_musician_1', { commitDays: 3, cancelFeeMult: 0 }).dailyCost;
    assert(doc.querySelector('.offer-card .offer-ask').textContent.includes(`$${ask3}`), `and the ask re-quotes for the weekend ($${ask3})`);
    assert(change(doc, '.offer-card select[data-term="cancelFeeMult"]', 1), 'so is the fee select');
    const ask3f = quoteContract(s, 'performer', 'perf_musician_1', { commitDays: 3, cancelFeeMult: 1 }).dailyCost;
    assert(ask3f < ask3 && doc.querySelector('.offer-card .offer-ask').textContent.includes(`$${ask3f}`), `and the fee lowers it ($${ask3f})`);
    const two = doc.querySelector('.offer-card select[data-term="commitDays"] option[value="6"]');
    assert(two && two.disabled && /Weekend 3/.test(two.textContent), 'two weekends is listed but locked until Weekend 3');
    assert(click(doc, '[data-action="signOffer"][data-id="perf_musician_1"]'), 'Sign is clickable');
    const c = saved(storage).contracts.perf_musician_1;
    assert(c && c.contractId === 'offer' && c.commitDaysRemaining === 3 && c.cancelFeeMult === 1 && c.dailyCost === ask3f, 'signing stores the terms and the rate the row showed');
    assert(!doc.querySelector('.offer-card'), 'and the row closes');
    const row = [...doc.querySelectorAll('.roster-table tr')].find(tr => /Tumbledown/.test(tr.textContent));
    assert(row && /The weekend, every day owed/.test(row.textContent) && /3 days left/.test(row.textContent), 'the roster names the negotiated terms');
    assert(click(doc, '[data-action="negotiate"][data-id="vend_turkeyleg"]') === false, 'a vendor with no open stall has no Negotiate button');
    assert(click(doc, '[data-action="negotiate"][data-id="perf_jester_2"]') && click(doc, '[data-action="cancelOffer"]') && !doc.querySelector('.offer-card'), 'Never mind closes an offer without signing');
    assert(!saved(storage).contracts.perf_jester_2, 'and nothing was signed');
  }

  // --- the ticket stub carries a Backstage row ---
  {
    let s = State.createInitialState();
    s.cash = 60000;
    s = State.buildPlot(s, 'stage', 3, 0).state;
    s = State.contractPerformer(s, 'perf_jester_2').state;
    s = State.contractPerformer(s, 'perf_jester_3').state;
    s = State.assignSchedule(s, 'afternoon', '3_0', 'perf_jester_2').state;
    const { doc } = await boot(s);
    click(doc, '[data-action="openGates"]');
    const rows = [...doc.querySelectorAll('.ticket-stub .ticket-row')];
    const back = rows.find(r => /^Backstage/.test(r.textContent.trim()));
    assert(!!back, 'the ticket stub carries a Backstage row');
    assert(back && /1 pleased, 1 sore/.test(back.textContent), 'counting who went home pleased and who sore');
    assert(back && /Bramblewit -3 \(left off the bill\)/.test(back.title) && /Old Nettle \+4/.test(back.title), 'with each act’s move and reason in the tooltip');
  }

  // --- a pre-arc save renders Backstage without a label on its contracts ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    s = State.contractPerformer(s, 'perf_jouster_2', 'weekend').state;
    delete s.relationships; delete s.arcBeats; delete s.actTraits;
    delete s.contracts.perf_jouster_2.cancelFeeMult; delete s.contracts.perf_jouster_2.label;
    const { doc } = await boot(s);
    click(doc, '[data-tab="backstage"]');
    const row = [...doc.querySelectorAll('.roster-table tr')].find(tr => /Ysolde/.test(tr.textContent));
    assert(row && /Weekend Package/.test(row.textContent) && row.querySelector('.mood-tag.mood-settled'), 'an old contract row names its option and reads Settled');
  }
}


// ---------------------------------------------------------------------
// Section 1k: Phase 4 — a faire that outlives its season.
//
// Renown, the second track, tallied at every weekend boundary; a run
// boundary that banks a record and opens the next season on what carries;
// the carryover schema, the first thing in this game's history to reach a
// save through migrate rather than repair; and the two unlocks that hang
// off renown. Pure. The DOM half is Section 27.
// ---------------------------------------------------------------------
{
  // --- the tables ---
  assert(RENOWN.moodHighBar > RENOWN.moodBar && RENOWN.moodHighPoints > RENOWN.moodPoints, 'a weekend the crowd loved is worth more than one they enjoyed, and sits higher');
  assert(RENOWN.moodBar > 60, 'the mood bar sits above the 60 that reputation itself reads as neutral, so renown is not a second reputation');
  assert(Number.isInteger(RENOWN.keptWeekends) && RENOWN.keptWeekends >= 2 && RENOWN.keptCap >= 1, 'kept acts count from a real tenure, and the line is capped');
  assert(RENOWN.intactMinBuilt >= 2 && RENOWN.intactPoints >= 1, 'the intact-grounds line needs something built before it pays');
  assert(CARRYOVER.schema === 1 && CARRYOVER.reputationKeep > 0 && CARRYOVER.reputationKeep < 1, 'the carryover schema is at 1 and reputation crosses as a real fraction, neither whole nor none');
  const meadow = GRID_EXPANSIONS[GRID_EXPANSIONS.length - 1];
  assert(typeof meadow.unlockRenown === 'number' && meadow.unlockRenown > 0, 'the last grounds tier is gated on renown');
  assert(GRID_EXPANSIONS.filter(g => typeof g.unlockRenown === 'number').length === 1, 'and it is the only one, so the first three tiers unlock exactly as they did');
  assert(GRID.rows === 12 && TERRAIN_ROWS.length === 12, 'the authored grid grew two rows for it');
  assert(GRID.cols === 14, 'and no columns: the row-2 artery, the east-edge stage test and the 710px board column all pin the width');
  const headliner = PERFORMERS.find(p => typeof p.unlockRenown === 'number');
  assert(!!headliner && headliner.id === 'perf_troupe_1', 'one performer carries a renown bar: the headliner');
  assert(headliner.popularity === 10 && headliner.cost > Math.max(...PERFORMERS.filter(p => p !== headliner).map(p => p.cost)), 'and is the biggest draw at the biggest rate in the catalog');
  assert(headliner.unlockRenown < meadow.unlockRenown, 'the headliner is the first-season prize and the meadow is the reason to play a second');
  // The South Meadow's path connector: on the network the gate reaches,
  // inside a day's walk, and not joined to the col-3 spur.
  const dist = computePathDistances();
  assert(dist.get('10,11') !== undefined && dist.get('6,11') !== undefined, 'the row-11 connector is reachable from the gate along the col-10 spur');
  assert(dist.get('3,10') === undefined && dist.get('3,11') === undefined && dist.get('5,11') === undefined, 'and stops short of the col-3 spur, which stays disconnected (#227)');
  assert(Math.max(...dist.values()) < GUESTS.stepsPerBlock * TIME_BLOCKS.length, `the far end of the meadow is inside a day's walk (${Math.max(...dist.values())} hops against ${GUESTS.stepsPerBlock * TIME_BLOCKS.length} steps) — the first draft reached col 4 and was 25`);
  const meadowStall = { kind: 'food', x: 7, y: 10, w: 1, h: 1 };
  assert(Number.isFinite(reachabilityDistanceOf(meadowStall)), 'a stall on the meadow fronting the connector resolves a gate walk');
  assert(isLegalPlacement('food', 7, 10, []).ok, 'and is a legal placement once the fence moves');

  // --- renownOf and the three lines ---
  assert(renownOf({}) === 0 && renownOf(undefined) === 0 && renownOf({ renown: 7 }) === 7, 'renownOf reads the number and falls back to 0');
  const summaryAt = (avg) => ({ days: [{}], avgSatisfaction: avg });
  assert(moodRenown(summaryAt(RENOWN.moodBar - 1)) === null, 'a weekend one point under the bar earns no mood line');
  assert(moodRenown(summaryAt(RENOWN.moodBar)).points === RENOWN.moodPoints, 'at the bar it earns the enjoyed points');
  assert(moodRenown(summaryAt(RENOWN.moodHighBar)).points === RENOWN.moodHighPoints, 'at the high bar it earns the loved points');
  assert(moodRenown({ days: [], avgSatisfaction: 100 }) === null && moodRenown(null) === null, 'a weekend with no days earns nothing, whatever the average says');

  const bare = State.createInitialState();
  const none = weekendRenown(bare, summaryAt(50));
  assert(none.total === 0 && none.lines.length === 0, 'an empty faire with a flat crowd earns nothing');
  let f = State.createInitialState();
  f.cash = 60000;
  for (const [k, x, y] of [['stage', 3, 0], ['food', 5, 3], ['vendor', 6, 3], ['demo', 8, 3]]) f = State.buildPlot(f, k, x, y).state;
  f = State.contractPerformer(f, 'perf_jester_2').state;
  f = State.contractPerformer(f, 'perf_jester_3').state;
  f = State.hireVendor(f, 'vend_stew').state;
  assert(f.builtPlots.filter(p => p.status === 'built').length === RENOWN.intactMinBuilt, 'fixture: exactly intactMinBuilt plots built');
  const intactOnly = weekendRenown(f, summaryAt(50));
  assert(intactOnly.lines.length === 1 && intactOnly.lines[0].id === 'intact' && intactOnly.total === RENOWN.intactPoints, 'four built plots and nothing torn down is the intact line alone');
  const torn = { ...f, demolished: 1 };
  assert(weekendRenown(torn, summaryAt(50)).total === 0, 'one demolition this run and the intact line is gone');
  const three = { ...f, builtPlots: f.builtPlots.slice(0, RENOWN.intactMinBuilt - 1) };
  assert(weekendRenown(three, summaryAt(50)).total === 0, 'one plot short of the minimum and it is gone too');
  const planned = { ...f, builtPlots: [...f.builtPlots.slice(0, 3), { ...f.builtPlots[3], status: 'planning' }] };
  assert(weekendRenown(planned, summaryAt(50)).total === 0, 'a planning plot does not count as built for it');
  const kept = { ...f, tenure: { perf_jester_2: RENOWN.keptWeekends, perf_jester_3: RENOWN.keptWeekends - 1, vend_stew: RENOWN.keptWeekends + 2 } };
  const keptAward = weekendRenown(kept, summaryAt(50));
  const keptLine = keptAward.lines.find(l => l.id === 'kept');
  assert(!!keptLine && keptLine.points === 2 && /2 acts kept/.test(keptLine.label), 'two of three acts are in their third weekend or later, and the line counts exactly them (performer and vendor alike)');
  const many = { ...f, roster: PERFORMERS.slice(0, 8).map(p => p.id), tenure: Object.fromEntries(PERFORMERS.slice(0, 8).map(p => [p.id, 9])) };
  assert(weekendRenown(many, summaryAt(50)).lines.find(l => l.id === 'kept').points === RENOWN.keptCap, `eight kept acts cap at ${RENOWN.keptCap}`);
  const gone = { ...kept, roster: [], hiredVendors: [] };
  assert(!weekendRenown(gone, summaryAt(50)).lines.find(l => l.id === 'kept'), 'a tenure record with no contract behind it counts for nothing');
  const all = weekendRenown(kept, summaryAt(RENOWN.moodHighBar));
  assert(all.lines.map(l => l.id).join(',') === 'mood,kept,intact' && all.total === RENOWN.moodHighPoints + 2 + RENOWN.intactPoints, 'all three lines stack and the total is their sum');

  // --- the expansion gate ---
  assert(isExpansionUnlocked({ season: 5, renown: meadow.unlockRenown }, meadow), 'the meadow opens at its weekend with its renown');
  assert(!isExpansionUnlocked({ season: 5, renown: meadow.unlockRenown - 1 }, meadow), 'one renown short and it does not');
  assert(!isExpansionUnlocked({ season: 4, renown: 99 }, meadow), 'nor a weekend early, however much renown');
  assert(isExpansionUnlocked({ season: 4 }, GRID_EXPANSIONS[2]) && isExpansionUnlocked({ season: 1 }, GRID_EXPANSIONS[0]), 'a tier with no renown gate reads exactly as before');
  assert(currentGridSize({ season: 6, renown: 0 }).label === 'Deep Woods Trail', 'a Weekend 6 faire with no renown is still on Deep Woods Trail');
  assert(currentGridSize({ season: 5, renown: meadow.unlockRenown }).rows === 12, 'and with the renown the fence moves south');
  assert(nextGridExpansion({ season: 4, renown: 0 }).label === meadow.label && nextGridExpansion({ season: 5, renown: meadow.unlockRenown }) === null, 'nextGridExpansion names the meadow until it opens, then nothing');
  assert(!isWithinCurrentGrid({ season: 5, renown: 0 }, 7, 10) && isWithinCurrentGrid({ season: 5, renown: meadow.unlockRenown }, 7, 10), 'isWithinCurrentGrid reads the same gate');
  {
    let m = State.createInitialState();
    m.cash = 60000; m.season = 5;
    assert(/fence line/.test(State.buildPlot(m, 'food', 7, 10).error || ''), 'building on the meadow without the renown is refused as past the fence');
    m.renown = meadow.unlockRenown;
    assert(!State.buildPlot(m, 'food', 7, 10).error, 'and allowed with it');
  }

  // --- the headliner's bar ---
  assert(signingBar({ renown: 0 }, performerById('perf_jester_2')) === null, 'an ordinary act has no bar');
  const bar = signingBar({ renown: 5 }, headliner);
  assert(bar && bar.need === headliner.unlockRenown && bar.have === 5 && bar.short === headliner.unlockRenown - 5, 'the headliner reports need, have and the gap');
  assert(signingBar({ renown: headliner.unlockRenown }, headliner) === null, 'and none once the faire has it');
  {
    let h = State.createInitialState();
    h.cash = 60000;
    const refused = State.contractPerformer(h, headliner.id, 'open');
    assert(/will not sign for money alone/.test(refused.error || '') && refused.state === h, 'contractPerformer refuses the headliner at zero renown, before any money moves');
    const refusedOffer = State.contractPerformer(h, headliner.id, { commitDays: 3, cancelFeeMult: 1 });
    assert(/will not sign/.test(refusedOffer.error || ''), 'a negotiated offer is refused the same way');
    h.renown = headliner.unlockRenown;
    const signed = State.contractPerformer(h, headliner.id, 'weekend');
    assert(!signed.error && signed.state.roster.includes(headliner.id) && signed.state.contracts[headliner.id].dailyCost === quoteContract(h, 'performer', headliner.id, CONTRACT_OPTIONS.weekend).dailyCost, 'with the renown they sign, priced through the one quote like everyone else');
  }

  // --- tenure and the demolition count ---
  {
    let t = State.createInitialState();
    t.cash = 60000;
    t = State.buildPlot(t, 'food', 5, 3).state;
    t = State.contractPerformer(t, 'perf_jester_2').state;
    t = State.hireVendor(t, 'vend_stew').state;
    assert(t.tenure.perf_jester_2 === 0 && t.tenure.vend_stew === 0, 'signing writes a tenure of 0 for a performer and a vendor');
    let w = { ...t, weekendDay: CONFIG.seasonLength };
    w = State.nextDay(w).state;
    assert(w.phase === 'weekendEnd' && w.tenure.perf_jester_2 === 1 && w.tenure.vend_stew === 1, 'the weekend boundary ticks every contracted act');
    const mid = State.nextDay({ ...t, weekendDay: 1 }).state;
    assert(mid.tenure.perf_jester_2 === 0, 'an ordinary day does not');
    const rel = State.releasePerformer(w, 'perf_jester_2').state;
    assert(!('perf_jester_2' in rel.tenure) && rel.tenure.vend_stew === 1, 'release deletes the tenure with the act (#235) and leaves the others');
    const fired = State.fireVendor(w, 'vend_stew').state;
    assert(!('vend_stew' in fired.tenure), 'so does firing a vendor');
    const resigned = State.contractPerformer(rel, 'perf_jester_2').state;
    assert(resigned.tenure.perf_jester_2 === 0, 'and re-signing starts the count over');

    const plot = t.builtPlots[0];
    const dem = State.demolishPlot(t, plot.id).state;
    assert(dem.demolished === 1, 'demolishPlot counts');
    const moved = State.relocatePlot(t, plot.id, 6, 3);
    assert(!moved.error && moved.state.demolished === 0, 'relocatePlot does not — the plot is still standing');
    const del = State.placePlot(t, 'demo', 8, 3).state;
    assert(State.deletePlanningPlot(del, del.builtPlots[1].id).state.demolished === 0, 'and deleting a plan is not a demolition');
  }

  // --- the boundary award, applied once ---
  {
    let b = State.createInitialState();
    b.cash = 60000;
    for (const [k, x, y] of [['stage', 3, 0], ['food', 5, 3], ['vendor', 6, 3], ['demo', 8, 3]]) b = State.buildPlot(b, k, x, y).state;
    b = State.contractPerformer(b, 'perf_jester_2').state;
    b.tenure.perf_jester_2 = RENOWN.keptWeekends - 1; // ticks to keptWeekends at this boundary
    b.weekendDay = CONFIG.seasonLength;
    b.history = [{ day: 1, attendance: 100, cashDelta: 0, satisfaction: 90, reputationDelta: 0 }, { day: 2, attendance: 100, cashDelta: 0, satisfaction: 90, reputationDelta: 0 }, { day: 3, attendance: 100, cashDelta: 0, satisfaction: 90, reputationDelta: 0 }];
    const closed = State.nextDay(b).state;
    const expected = RENOWN.moodHighPoints + 1 + RENOWN.intactPoints;
    assert(closed.renown === expected, `the boundary awards the weekend's renown (${closed.renown} of ${expected}: loved crowd, one act kept a third weekend, grounds intact)`);
    assert(closed.lastRenown && closed.lastRenown.total === expected && closed.lastRenown.lines.length === 3, 'and records the lines for the screen');
    assert(closed.tenure.perf_jester_2 === RENOWN.keptWeekends, 'tenure ticked before the award was computed, so the act reads as kept this weekend and not next');
    const rolled = State.startNextWeekend(closed).state;
    assert(rolled.renown === expected, 'startNextWeekend does not award again');
    assert(State.nextDay({ ...b, weekendDay: 1 }).state.renown === 0, 'and an ordinary day awards nothing');
    // The "kept" line is the one break that used to pass: with the tick
    // after the award, an act signed on Weekend 1 read as kept at the close
    // of Weekend 4, and the assertion above on tenure would still pass.
    // This one is what catches the order.
    const late = { ...b, tenure: { perf_jester_2: RENOWN.keptWeekends - 1 } };
    assert(State.nextDay(late).state.lastRenown.lines.some(l => l.id === 'kept'), 'an act one weekend short at the top of the boundary is kept by the bottom of it');
  }

  // --- the run boundary ---
  {
    const target = CONFIG.winCondition.seasonTarget;
    assert(!State.canCloseSeason({ ...State.createInitialState(), phase: 'plan', season: target }).ok, 'the season does not close from the planning desk');
    assert(!State.canCloseSeason({ ...State.createInitialState(), phase: 'weekendEnd', season: target - 1 }).ok, 'nor a weekend early');
    assert(State.canCloseSeason({ ...State.createInitialState(), phase: 'weekendEnd', season: target }).ok, 'it closes from the weekend-end desk at the target weekend');
    assert(State.canCloseSeason({ ...State.createInitialState(), phase: 'victory', season: target }).ok, 'and from the victory screen');
    assert(State.canCloseSeason({ ...State.createInitialState(), phase: 'weekendEnd', season: target + 3 }).ok, 'and any weekend after');
    const early = State.closeSeason({ ...State.createInitialState(), phase: 'weekendEnd', season: 2 });
    assert(early.error && /Weekend 2/.test(early.error), 'closeSeason refuses with the reason');

    let r = State.createInitialState();
    r.cash = 60000;
    for (const [k, x, y] of [['stage', 3, 0], ['food', 5, 3]]) r = State.buildPlot(r, k, x, y).state;
    r = State.contractPerformer(r, 'perf_jouster_2', 'weekend').state;
    r = State.hireVendor(r, 'vend_stew').state;
    r.relationships.perf_jouster_2 = 85;
    r = State.resolveBeat(r, 'ysolde_devoted', 'champion').state;
    r.season = target; r.weekendDay = CONFIG.seasonLength; r.phase = 'weekendEnd';
    r.reputation = 82; r.cash = 31000; r.renown = 23; r.victoryAchieved = true; r.demolished = 2;
    r.history = Array.from({ length: target * CONFIG.seasonLength }, (_, i) => ({ day: i + 1, attendance: 500, cashDelta: 1000, satisfaction: 70, reputationDelta: 1 }));
    r.tenure = { perf_jouster_2: 4, vend_stew: 4 };
    const rec = State.seasonRecord(r);
    assert(rec.run === 1 && rec.weekends === target && rec.days === target * CONFIG.seasonLength && rec.attendance === 500 * rec.days && rec.net === 1000 * rec.days, 'the record sums the season out of history');
    assert(rec.cash === 31000 && rec.reputation === 82 && rec.renown === 23 && rec.renownEarned === 23 && rec.won === true && rec.plots === 2 && rec.beats === 1, 'and carries the closing numbers, the win, the grounds and the answered moments');
    const opens = State.carryoverPreview(r);
    assert(opens.run === 2 && opens.cash === CONFIG.startingCash && opens.renown === 23 && opens.reputation === CONFIG.startingReputation + Math.round((82 - CONFIG.startingReputation) * CARRYOVER.reputationKeep), `the preview says what the next run opens with (reputation ${opens.reputation}: the start plus half of what stood above it)`);
    assert(State.carryoverPreview({ ...r, reputation: 40 }).reputation === CONFIG.startingReputation, 'a reputation under the start carries as the start, so a bad season is not a handicap');
    assert(opens.reputation > CONFIG.startingReputation, 'and a Legendary one carries something — "half the closing number, floored at the start" carried nothing, since half of 82 is under 50');

    const { state: run2, error, record } = State.closeSeason(r);
    assert(!error && record && record.run === 1 && JSON.stringify(record) === JSON.stringify(rec), 'closeSeason banks exactly the record seasonRecord described');
    assert(run2.carryover.run === 2 && run2.carryover.schema === CARRYOVER.schema && run2.carryover.seasons.length === 1 && run2.carryover.seasons[0].renown === 23, 'run 2 carries the banked season');
    assert(run2.renown === 23, 'renown crosses whole');
    assert(run2.reputation === opens.reputation && run2.cash === CONFIG.startingCash, 'reputation crosses at half; cash starts over');
    assert(run2.carryover.startedWith.renown === 23 && run2.carryover.startedWith.reputation === run2.reputation && run2.carryover.startedWith.cash === CONFIG.startingCash, 'startedWith records what run 2 opened on');
    assert(run2.arcBeats.ysolde_devoted === 'champion' && run2.actTraits.perf_jouster_2.rateMult === 1.15, 'the acts remember: the beat stays answered and the rate stays raised');
    assert(run2.roster.length === 0 && run2.hiredVendors.length === 0 && run2.builtPlots.length === 0 && Object.keys(run2.relationships).length === 0 && Object.keys(run2.tenure).length === 0 && run2.history.length === 0 && run2.demolished === 0, 'the roster, the vendors, the grounds, every relationship and tenure, the history and the demolition count start over');
    assert(run2.season === 1 && run2.day === 1 && run2.weekendDay === 1 && run2.phase === 'plan' && run2.victoryAchieved === false && run2.bankrupt === false && run2.lastRenown === null, 'the calendar and the flags are a fresh season');
    assert(run2.weatherSeed === nextRunSeed(r.weatherSeed, 2) && run2.weatherSeed !== r.weatherSeed, 'run 2 gets its own weather seed, derived from run 1 rather than the clock');
    assert(run2.weather === rollWeather(run2.weatherSeed, 1, 1).id, 'and its first day is stamped off it');
    const again = State.closeSeason(r).state;
    assert(JSON.stringify(again) === JSON.stringify(run2), 'closing the same season twice gives the same second season — the action is pure');
    assert(nextRunSeed(r.weatherSeed, 3) !== run2.weatherSeed && nextRunSeed(7, 2) === nextRunSeed(7, 2), 'nextRunSeed differs by run and is deterministic');
    assert(r.carryover.run === 1 && r.carryover.seasons.length === 0, 'the closed state itself was not mutated');
    // Run 2 closes too, and the bank grows.
    const r2 = { ...run2, phase: 'weekendEnd', season: target, renown: 40, reputation: 60, history: [] };
    const run3 = State.closeSeason(r2).state;
    assert(run3.carryover.run === 3 && run3.carryover.seasons.length === 2 && run3.carryover.seasons[1].renownEarned === 17 && run3.carryover.seasons[0].run === 1, 'a third season carries both records in order, and the second knows what it earned over what it started with');
    const fromVictory = State.closeSeason({ ...r, phase: 'victory' });
    assert(!fromVictory.error && fromVictory.state.carryover.run === 2, 'closing from the victory screen works the same');
  }

  // --- the migration: a pre-carryover save enters the new shape and loses nothing ---
  {
    const mkOld = () => {
      let o = State.createInitialState();
      o.cash = 60000;
      o = State.buildPlot(o, 'stage', 3, 0).state;
      o = State.contractPerformer(o, 'perf_jester_2', 'weekend').state;
      o.season = 3; o.day = 7; o.weekendDay = 1; o.reputation = 61;
      // Two completed weekends in history: one the crowd enjoyed (avg 72),
      // one they did not (avg 60); then nothing for weekend 3 yet.
      o.history = [72, 72, 72, 60, 60, 60].map((sat, i) => ({ day: i + 1, attendance: 400, cashDelta: 300, satisfaction: sat, reputationDelta: 1 }));
      delete o.renown; delete o.carryover; delete o.tenure; delete o.demolished; delete o.lastRenown;
      return o;
    };
    const oldKeys = Object.keys(mkOld());
    assert(!oldKeys.includes('renown') && !oldKeys.includes('carryover'), 'fixture: the old save has none of the Phase 4 fields');
    const loadWith = (blob) => {
      const raw = JSON.stringify(blob);
      globalThis.localStorage = { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
      const loaded = State.loadState();
      delete globalThis.localStorage;
      return loaded;
    };
    for (const [label, blob] of [['a Stage 22 save (__v 1)', { ...mkOld(), __v: 1 }], ['a pre-Stage-22 save (no __v)', mkOld()]]) {
      const m = loadWith(blob);
      assert(!!m, `${label} loads`);
      if (!m) continue;
      assert(m.carryover && m.carryover.schema === CARRYOVER.schema && m.carryover.run === 1 && m.carryover.seasons.length === 0, `${label} enters as run 1 with an empty record`);
      assert(m.carryover.startedWith.cash === CONFIG.startingCash && m.carryover.startedWith.reputation === CONFIG.startingReputation && m.carryover.startedWith.renown === 0, `${label} is recorded as having started on the configured numbers`);
      assert(m.renown === RENOWN.moodPoints, `${label} is credited the mood renown its completed weekends earned (${m.renown} of ${RENOWN.moodPoints}: one weekend at 72, one at 60, a third not yet played)`);
      assert(m.tenure && m.tenure.perf_jester_2 === 0 && m.demolished === 0 && m.lastRenown === null, `${label} gets zeros for what it never recorded`);
      const before = mkOld();
      const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
      const lost = oldKeys.filter(k => canon(before[k]) !== canon(m[k]));
      assert(lost.length === 0, `${label} loses nothing: every original key comes through equal (${lost.join(', ') || 'none differ'})`);
    }
    // The split (#37): the tally is migrate's, not repair's. A current-
    // version save missing the field is a gap, and repair fills it with a
    // zero — it does not go back through history, because on every load it
    // would overwrite what the boundary has earned since.
    const current = loadWith({ ...mkOld(), __v: 2 });
    assert(current && current.renown === 0 && current.carryover.run === 1, 'a version-2 save with the fields missing is repaired to zero, not tallied');
    const already = loadWith({ ...mkOld(), __v: 2, renown: 9, carryover: { schema: 1, run: 2, seasons: [{ run: 1 }], startedWith: { cash: 1, reputation: 2, renown: 3 } } });
    assert(already && already.renown === 9 && already.carryover.run === 2 && already.carryover.seasons.length === 1, 'and a version-2 save that has them keeps them');
    // An exported file from before this phase says version 1 in its
    // envelope and takes the same road.
    const slot = State.saveSlot({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const imported = slot.deserialize(JSON.stringify({ format: 'gvb-save', game: 'faire-weekend', version: 1, savedAt: 'x', state: mkOld() }));
    assert(imported && imported.renown === RENOWN.moodPoints && imported.carryover.run === 1, 'an imported version-1 export migrates the same way');
    assert(slot.version === 2, 'the slot is at version 2');
    const written = JSON.parse((() => { let out; State.saveSlot({ getItem: () => null, setItem: (k, v) => { out = v; }, removeItem: () => {} }).save(State.createInitialState()); return out; })());
    assert(written.__v === 2 && written.carryover.run === 1, 'and a save written now says so');
  }

  // --- a full season, twice, through the boundary ---
  // A scripted manager plays from a real start: builds toward the gate,
  // hires the best vendors, signs the biggest draws, fills every stage in
  // every block, answers every beat, and holds the price at the anchor.
  // Reputation is set to the win's bar at the start and that is said out
  // loud: across six seeds and a dozen builds no manager this file could
  // write cleared 63 from 50 in six weekends, while cash cleared $25,000
  // by a factor of two to four every time. That is evidence for Questions
  // for Devon's economy question, recorded there; everything else here —
  // the cash, the renown, the headliner, the fence, the record, the second
  // season — is played for real.
  const tryBuild = (s, kind, reserve) => {
    const size = currentGridSize(s);
    let best = null;
    for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.cols; x++) {
      if (!isFootprintWithinCurrentGrid(s, kind, x, y) || !quoteBuild(kind, x, y, s.builtPlots) || !isLegalPlacement(kind, x, y, s.builtPlots).ok) continue;
      const d = reachabilityDistanceOf({ kind, x, y, ...footprintFor(kind) });
      if (!Number.isFinite(d)) continue;
      if (!best || d < best.d) best = { x, y, d, cost: quoteBuild(kind, x, y, s.builtPlots).cost };
    }
    if (!best || s.cash - best.cost < reserve) return s;
    const r = State.buildPlot(s, kind, best.x, best.y);
    return r.error ? s : r.state;
  };
  const manage = (s, o) => {
    const cnt = k => s.builtPlots.filter(p => p.kind === k && p.status === 'built').length;
    const plan = [['stage', 1], ['food', 2], ['vendor', 2], ['stage', 2], ['demo', 1], ['food', o.stalls], ['vendor', o.stalls], ['stage', o.stages], ['demo', 2]];
    for (let i = 0; i < 16; i++) {
      const before = s.cash;
      const step = plan.find(([k, n]) => cnt(k) < n);
      if (!step) break;
      s = tryBuild(s, step[0], 600);
      if (s.cash === before) break;
    }
    for (const v of [...VENDORS].sort((a, b) => b.quality - a.quality)) {
      if (!s.hiredVendors.includes(v.id)) { const r = State.hireVendor(s, v.id, 'weekend'); if (!r.error) s = r.state; }
    }
    s = State.autoFillStalls(s).state;
    const stages = s.builtPlots.filter(p => p.kind === 'stage' && p.status === 'built');
    const want = Math.min(stages.length * TIME_BLOCKS.length, o.acts);
    const pool = PERFORMERS.map(p => performerFor(s, p.id)).sort((a, b) => b.popularity - a.popularity);
    for (const p of pool) {
      if (s.roster.includes(p.id) || signingBar(s, p)) continue;
      if (s.roster.length >= want) {
        // The headliner takes the weakest act's slot the moment they will sign.
        if (typeof p.unlockRenown !== 'number') break;
        const weakest = [...s.roster].map(id => performerFor(s, id)).sort((a, b) => a.popularity - b.popularity)[0];
        s = State.releasePerformer(s, weakest.id).state;
      }
      if (s.cash < 1500) break;
      const r = State.contractPerformer(s, p.id, 'weekend');
      if (!r.error) s = r.state;
    }
    for (const b of TIME_BLOCKS) for (const st of stages) s = State.unassignSchedule(s, b.id, st.id).state;
    const acts = [...s.roster].map(id => performerFor(s, id)).sort((a, b) => b.popularity - a.popularity);
    let i = 0;
    for (const b of TIME_BLOCKS) for (const st of stages) { if (i < acts.length) s = State.assignSchedule(s, b.id, st.id, acts[i++].id).state; }
    for (const pb of pendingBeats(s)) s = State.resolveBeat(s, pb.beat.id, pb.beat.choices[0].id).state;
    s = State.setTicketPrice(s, CONFIG.priceAnchor).state;
    if (!s.activeCampaign && s.cash > 6000) { const r = State.launchCampaign(s, 'ad_crier'); if (!r.error) s = r.state; }
    return s;
  };
  const playSeason = (s, seed, o) => {
    const trace = [];
    for (let d = 0; d < 60; d++) {
      s = manage(s, o);
      s = State.runDay(s, seed + d * 101).state;
      s = State.nextDay(s).state;
      if (s.phase === 'gameOver') return { s, trace };
      if (s.phase === 'victory') return { s, trace, won: true };
      if (s.phase === 'weekendEnd') {
        trace.push({ season: s.season, cash: s.cash, reputation: s.reputation, renown: s.renown, award: s.lastRenown });
        if (s.season >= CONFIG.winCondition.seasonTarget) return { s, trace };
        s = State.startNextWeekend(s).state;
      }
    }
    return { s, trace };
  };
  {
    const o = { stalls: 3, stages: 5, acts: 8 };
    let s1 = State.createInitialState(20260908);
    s1.reputation = CONFIG.winCondition.minReputation;
    const one = playSeason(s1, 4242, o);
    assert(one.won === true && one.s.phase === 'victory' && one.s.victoryAchieved, `season one reaches the win from $${CONFIG.startingCash} (cash $${one.s.cash}, reputation ${one.s.reputation} at Weekend ${one.s.season})`);
    assert(one.s.cash >= CONFIG.winCondition.minCash, 'the cash bar is cleared by play, not by the fixture');
    assert(one.trace.every((t, i) => i === 0 || t.renown >= one.trace[i - 1].renown), 'renown never goes down across the season');
    assert(one.s.renown >= headliner.unlockRenown, `and reaches the headliner's bar by the close (${one.s.renown} against ${headliner.unlockRenown})`);
    assert(one.s.roster.includes(headliner.id), 'the manager signed the headliner the weekend they would sign');
    assert(one.s.renown < meadow.unlockRenown, `but not the meadow's (${one.s.renown} against ${meadow.unlockRenown}): that is the second season's prize`);
    assert(one.trace.some(t => t.award && t.award.lines.some(l => l.id === 'kept')) && one.trace.some(t => t.award && t.award.lines.some(l => l.id === 'intact')), 'the kept and intact lines both fired during the season');
    assert(currentGridSize(one.s).label === 'Deep Woods Trail', 'season one ends on Deep Woods Trail');

    const { state: s2, record } = State.closeSeason(one.s);
    assert(record.won && record.run === 1 && record.days === CONFIG.winCondition.seasonTarget * CONFIG.seasonLength && record.attendance > 0, 'the season closes from the victory screen with a won record of every day played');
    assert(s2.carryover.run === 2 && s2.renown === one.s.renown && s2.cash === CONFIG.startingCash && s2.reputation === CONFIG.startingReputation + Math.round((one.s.reputation - CONFIG.startingReputation) * CARRYOVER.reputationKeep), 'season two opens on the carryover');
    assert(Object.keys(s2.arcBeats).length === Object.keys(one.s.arcBeats).length && Object.keys(s2.arcBeats).length > 0, 'and remembers every moment answered');
    assert(currentGridSize(s2).label === 'Home Grounds', 'season two starts back on the Home Grounds');
    const two = playSeason(s2, 9001, o);
    assert(two.s.phase !== 'gameOver', `season two does not fold (cash $${two.s.cash} at Weekend ${two.s.season})`);
    assert(two.s.renown >= meadow.unlockRenown, `season two reaches the meadow's bar (${two.s.renown} against ${meadow.unlockRenown})`);
    const meadowWeekend = two.trace.find(t => t.season >= meadow.unlockSeason && t.renown >= meadow.unlockRenown);
    assert(!!meadowWeekend, 'and had it by Weekend 5 or 6, when the fence can move');
    assert(currentGridSize(two.s).label === meadow.label, 'the fence moved: season two ends on the South Meadow');
    assert(!State.buildPlot({ ...two.s, cash: 60000 }, 'food', 7, 10).error, 'and a stall can be built on it');
    assert(two.s.roster.includes(headliner.id), 'the headliner signed again in season two, on carried renown');
    assert(two.s.carryover.seasons.length === 1 && two.s.carryover.startedWith.renown === one.s.renown, 'the bank is intact through a whole second season');
    const s3 = State.closeSeason({ ...two.s, phase: 'weekendEnd' }).state;
    assert(s3.carryover.run === 3 && s3.carryover.seasons.length === 2 && s3.carryover.seasons[1].renownEarned === two.s.renown - one.s.renown, 'and a third season banks the second, knowing what it earned');
  }
}

// ---------------------------------------------------------------------
// Section 27: Phase 4 on the page. Renown in the HUD, the weekend-end
// stub's renown lines, the season close with its ledger, the victory
// screen as a ledger, the headliner's bar on Backstage, and the fence's
// hint naming its renown.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  // A fixture written straight to storage is stamped with the current
  // version unless it says otherwise: without `__v` it reads as a pre-
  // Phase-4 save and migrate re-tallies its renown from its history, which
  // is exactly the behaviour the last block below tests on purpose and the
  // rest of this section must not trip over.
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify('__v' in save ? save : { ...save, __v: 2 }));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    dom.window.prompt = () => 'A Name';
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document, storage };
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return true;
  };
  const saved = (storage) => JSON.parse(storage.getItem('renn-faire-sim-save-v1'));
  const target = CONFIG.winCondition.seasonTarget;
  const headliner = PERFORMERS.find(p => typeof p.unlockRenown === 'number');
  const meadow = GRID_EXPANSIONS[GRID_EXPANSIONS.length - 1];

  // --- the HUD, and a weekend-end stub before the season can close ---
  {
    let s = State.createInitialState();
    s.renown = 7;
    s.season = 2; s.weekendDay = CONFIG.seasonLength; s.phase = 'weekendEnd';
    s.lastRenown = { total: 3, lines: [{ id: 'mood', label: 'A weekend the crowd enjoyed (mood 71/100)', points: 2 }, { id: 'intact', label: '4 plots built and nothing torn down', points: 1 }] };
    const { doc } = await boot(s);
    const slot = [...doc.querySelectorAll('#ledger .ledger-item')].find(el => /renown/.test(el.textContent));
    assert(!!slot && slot.querySelector('.ledger-label').textContent.trim() === '7' && /season 1/.test(slot.textContent), 'the HUD carries renown and the season number');
    assert(slot && /tallied at the close of every weekend/.test(slot.title) && slot.title.includes(headliner.name) && slot.title.includes(meadow.label), 'with a tooltip that says what earns it and what it buys');
    const total = doc.querySelector('.weekend-summary .renown-total');
    assert(!!total && /\+3/.test(total.textContent) && /7/.test(total.textContent), 'the weekend-end stub carries a Renown row with the weekend\'s total and the running number');
    const lines = [...doc.querySelectorAll('.weekend-summary .renown-line')];
    assert(lines.length === 2 && /crowd enjoyed/.test(lines[0].textContent) && /\+2/.test(lines[0].textContent) && /nothing torn down/.test(lines[1].textContent), 'and one line per reason');
    assert(!doc.querySelector('[data-action="closeSeason"]') && !doc.querySelector('.carry-ledger'), 'at Weekend 2 there is no Close Season button and no ledger');
  }

  // --- a weekend that earned nothing says so ---
  {
    let s = State.createInitialState();
    s.season = 1; s.weekendDay = CONFIG.seasonLength; s.phase = 'weekendEnd';
    s.lastRenown = { total: 0, lines: [] };
    const { doc } = await boot(s);
    const line = doc.querySelector('.weekend-summary .renown-line');
    assert(!!line && /Nothing this weekend/.test(line.textContent) && /\+0/.test(line.textContent), 'an empty weekend prints the three ways to earn, not a blank');
  }

  // --- closing the season from the weekend-end desk ---
  {
    let s = State.createInitialState();
    s.cash = 60000;
    s = State.buildPlot(s, 'stage', 3, 0).state;
    s = State.contractPerformer(s, 'perf_jouster_2').state;
    s.relationships.perf_jouster_2 = 85;
    s = State.resolveBeat(s, 'ysolde_devoted', 'champion').state;
    s.season = target; s.weekendDay = CONFIG.seasonLength; s.phase = 'weekendEnd';
    s.reputation = 64; s.cash = 12000; s.renown = 19;
    s.history = Array.from({ length: target * CONFIG.seasonLength }, (_, i) => ({ day: i + 1, attendance: 300, cashDelta: 200, satisfaction: 65, reputationDelta: 0 }));
    s.lastRenown = { total: 1, lines: [{ id: 'intact', label: '4 plots built and nothing torn down', points: 1 }] };
    const { doc, storage } = await boot(s);
    const ledger = doc.querySelector('.weekend-summary .carry-ledger');
    assert(!!ledger, 'at the target weekend the weekend-end stub carries the carryover ledger');
    const rows = ledger ? [...ledger.querySelectorAll('.ticket-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()) : [];
    assert(rows.some(r => /Through the gate/.test(r) && r.includes((300 * target * CONFIG.seasonLength).toLocaleString())), 'the ledger sums the season\'s gate');
    assert(rows.some(r => /Net over the season/.test(r) && r.includes(`$${(200 * target * CONFIG.seasonLength).toLocaleString()}`)), 'and its net');
    assert(rows.some(r => /Renown earned/.test(r) && /\+19/.test(r)), 'and the renown it earned');
    assert(rows.some(r => /Standing/.test(r) && /Not yet legendary/.test(r)), 'a season that missed the win says so');
    assert(rows.some(r => /Renown, whole/.test(r) && /19/.test(r)) && rows.some(r => /Reputation, 50 plus 50% of the 14 above it\s*57$/.test(r)), 'what carries: renown whole, reputation as the start plus half of the 14 above it (57)');
    assert(rows.some(r => /stories/.test(r) && /1 moment answered/.test(r)), 'and the acts\' stories');
    assert(rows.some(r => /Cash/.test(r) && r.includes(`$${CONFIG.startingCash.toLocaleString()}`)), 'and what season 2 opens with');
    assert(!ledger.textContent.includes(`${headliner.name} will sign`), 'at 19 renown the ledger does not promise the headliner');
    const btn = doc.querySelector('[data-action="closeSeason"]');
    assert(!!btn && /Close Season 1/.test(btn.textContent), 'the Close Season button names the season');
    assert(!!doc.querySelector('[data-action="startNextWeekend"]'), 'and Begin Weekend 7 is still offered beside it: closing is a choice');
    assert(click(doc, '[data-action="closeSeason"]'), 'it is clickable');
    const after = saved(storage);
    assert(after.carryover.run === 2 && after.carryover.seasons.length === 1 && after.carryover.seasons[0].won === false && after.renown === 19 && after.reputation === 57 && after.cash === CONFIG.startingCash && after.phase === 'plan' && after.season === 1, 'clicking it writes season 2 to disk: run 2, one banked season, the carryover applied');
    assert(after.arcBeats.ysolde_devoted === 'champion', 'with Ysolde\'s moment still answered');
    const hud = [...doc.querySelectorAll('#ledger .ledger-item')].find(el => /renown/.test(el.textContent));
    assert(hud && /season 2/.test(hud.textContent) && hud.querySelector('.ledger-label').textContent.trim() === '19', 'the HUD now reads season 2 at 19 renown');
    assert(/Season 1 closed and banked/.test(doc.querySelector('#content .warn')?.textContent || '') && /Season 2 opens with/.test(doc.querySelector('#content .warn')?.textContent || ''), 'the flash says what happened and what the new season opens with');
    assert(doc.querySelector('.plat-title').textContent.trim() === 'Home Grounds' && !doc.querySelector('.plot-marker'), 'the site plan is the empty Home Grounds again');
  }

  // --- the victory screen is a ledger with two ways on ---
  {
    const w = CONFIG.winCondition;
    let s = { ...State.createInitialState(), cash: w.minCash + 500, season: target, weekendDay: CONFIG.seasonLength, reputation: w.minReputation + 10, phase: 'victory', victoryAchieved: true, renown: headliner.unlockRenown + 2 };
    s.history = Array.from({ length: target * CONFIG.seasonLength }, (_, i) => ({ day: i + 1, attendance: 600, cashDelta: 1500, satisfaction: 75, reputationDelta: 1 }));
    const { doc, storage } = await boot(s);
    assert(!!doc.querySelector('.victory-stub .carry-ledger'), 'the victory stub carries the ledger');
    const text = doc.querySelector('.victory-stub').textContent.replace(/\s+/g, ' ');
    assert(/A Legendary Faire/.test(text) && /Standing/.test(text) && /Season 2 opens with/.test(text), 'headline, standing, and what season 2 opens with');
    assert(text.includes(`${headliner.name} will sign`), 'at 22 renown it promises the headliner will sign');
    assert(!!doc.querySelector('.victory-stub [data-action="closeSeason"]') && !!doc.querySelector('.victory-stub [data-action="acknowledgeVictory"]'), 'both Close the season and Continue the Faire are offered');
    assert(click(doc, '[data-action="acknowledgeVictory"]') && !!doc.querySelector('.weekend-summary'), 'Continue still drops into the weekend-end summary');
    assert(!!doc.querySelector('.weekend-summary [data-action="closeSeason"]'), 'where the season can still be closed');
    assert(click(doc, '[data-action="closeSeason"]'), 'and is');
    const after = saved(storage);
    assert(after.carryover.run === 2 && after.carryover.seasons[0].won === true && after.reputation === CONFIG.startingReputation + Math.round((w.minReputation + 10 - CONFIG.startingReputation) * CARRYOVER.reputationKeep), 'closing after the win banks a won season and carries half of the reputation above the start');
  }

  // --- the headliner on Backstage ---
  {
    let s = State.createInitialState();
    s.cash = 20000;
    const { doc, storage } = await boot(s);
    click(doc, '[data-tab="backstage"]');
    let row = [...doc.querySelectorAll('.roster-table tr')].find(tr => tr.textContent.includes(headliner.name));
    assert(!!row, 'the headliner is on the Backstage board');
    assert(row && row.querySelector('.renown-bar') && new RegExp(`${headliner.unlockRenown} renown \\(0 now\\)`).test(row.textContent), 'wearing the bar: will not sign for money alone, with the number and the gap');
    assert(row && !row.querySelector('[data-action="contract"]') && !row.querySelector('[data-action="negotiate"]'), 'and no contract or Negotiate button');
    let s2 = State.createInitialState();
    s2.cash = 20000; s2.renown = headliner.unlockRenown;
    const b2 = await boot(s2);
    click(b2.doc, '[data-tab="backstage"]');
    row = [...b2.doc.querySelectorAll('.roster-table tr')].find(tr => tr.textContent.includes(headliner.name));
    assert(row && !row.querySelector('.renown-bar') && row.querySelector('[data-action="contract"]') && row.querySelector('[data-action="negotiate"]'), 'with the renown the row has the same buttons as anyone');
    assert(click(b2.doc, `[data-action="contract"][data-id="${headliner.id}"][data-contract="open"]`), 'and the day rate is clickable');
    assert(saved(b2.storage).roster.includes(headliner.id) && saved(b2.storage).tenure[headliner.id] === 0, 'clicking it signs them, tenure 0');
  }

  // --- the fence names its renown ---
  {
    let s = State.createInitialState();
    s.season = meadow.unlockSeason; s.renown = 12;
    const { doc } = await boot(s);
    const hint = doc.querySelector('.grounds-status').textContent;
    assert(new RegExp(`${meadow.label}.*unlocks ${meadow.unlockRenown} renown \\(12 now\\)`).test(hint), `at Weekend ${meadow.unlockSeason} with 12 renown the fence hint names the renown gap, not a weekend already reached`);
    let s2 = State.createInitialState();
    s2.season = meadow.unlockSeason - 1; s2.renown = 0;
    const b2 = await boot(s2);
    assert(new RegExp(`unlocks Weekend ${meadow.unlockSeason} and ${meadow.unlockRenown} renown`).test(b2.doc.querySelector('.grounds-status').textContent), 'a weekend earlier it names both gates');
    let s3 = { ...State.createInitialState(), season: meadow.unlockSeason - 1, weekendDay: CONFIG.seasonLength, phase: 'weekendEnd', renown: 0, lastRenown: { total: 0, lines: [] } };
    const b3 = await boot(s3);
    const note = b3.doc.querySelector('.unlock-note');
    assert(note && note.textContent.includes(meadow.label) && new RegExp(`once the faire has ${meadow.unlockRenown} renown`).test(note.textContent), 'the weekend-end unlock notice names the meadow with its renown condition rather than promising it');
    let s4 = { ...State.createInitialState(), season: meadow.unlockSeason, renown: meadow.unlockRenown };
    const b4 = await boot(s4);
    // Phase 6: the terrain is on the canvas, so the tier the grid lays out
    // is read off its own --cols/--rows rather than counted as cells.
    const b4map = b4.doc.querySelector('.grounds-map');
    assert(b4.doc.querySelector('.plat-title').textContent.trim() === meadow.label && b4map && b4map.style.getPropertyValue('--cols') === String(meadow.cols) && b4map.style.getPropertyValue('--rows') === String(meadow.rows), 'with both gates met the plat draws the South Meadow');
  }

  // --- a pre-carryover save boots straight into the new shape ---
  {
    let o = State.createInitialState();
    o.history = [80, 80, 80].map((sat, i) => ({ day: i + 1, attendance: 400, cashDelta: 300, satisfaction: sat, reputationDelta: 1, weather: { id: 'fair' }, warnings: [], log: [], events: [] }));
    o.season = 1; o.weekendDay = CONFIG.seasonLength; o.phase = 'weekendEnd';
    delete o.renown; delete o.carryover; delete o.tenure; delete o.demolished; delete o.lastRenown;
    const { doc, storage } = await boot({ ...o, __v: 1 });
    assert(!!doc.querySelector('.weekend-summary'), 'a Stage 22 save parked on a weekend-end screen boots to it');
    const hud = [...doc.querySelectorAll('#ledger .ledger-item')].find(el => /renown/.test(el.textContent));
    assert(hud && hud.querySelector('.ledger-label').textContent.trim() === String(RENOWN.moodPoints), 'the HUD shows the renown its one completed weekend was credited on the way in');
    assert(saved(storage).__v === 2 && saved(storage).carryover.run === 1, 'and the save on disk is now version 2');
  }
}

// ---------------------------------------------------------------------
// Section 28: Phase 5 \u2014 the layout review, guarded.
//
// tools/shoot-states.mjs put the page in a real Chromium at 1280, 1080,
// 820 and 375 across every phase and desk tab, and these are the numbers
// it found wrong: a 710px plat column on the 10-wide Home Grounds with
// 187px of the map\u2019s brown gap colour painted east of the last column
// (445px at 1080); the Fair Floor 1,820px wide at a 1280 viewport because
// five 175px schedule <select>s cannot fit a 514px desk; the roster table
// 541px in a 517px desk on a fresh game; a 191px sticky HUD on a 375x812
// phone; 34px plot markers on every tablet; a 16px slider and 31px
// <select>s on touch; "200 guests" broken over two lines. Each fix is
// parsed back out of style.css or read off a jsdom boot here, and each
// was reintroduced on purpose and watched fail by name (#34).
// ---------------------------------------------------------------------
{
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const block = (query) => (css.match(new RegExp(`@media \\(${query}\\)\\s*\\{([\\s\\S]*?)\\r?\\n\\}\\r?\\n`)) || [])[1] || '';
  const rule = (selector, from = css) => (from.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.#[\]=*+?()|]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) || [])[1] || '';

  // --- the map is its tracks (#247, kept by Phase 6 a different way) ---
  // Phase 5 cured the brown slab east of the last column with max-content
  // and auto margins. Phase 6 took the grid's background away altogether:
  // the canvas paints the tracks to the pixel (plat.js fills exactly
  // trackSize()), and a grid with no background has no colour to spill
  // whatever its box measures. So the guard is that nothing gives it one.
  const map = rule('.grounds-map');
  assert(/background:\s*none/.test(map) && !/background(?:-color)?:\s*#/.test(map), '.grounds-map paints no background of its own \u2014 the brown gap colour is the canvas\u2019s to paint, exactly the tracks wide (#247)');
  assert(/border:\s*1px solid transparent/.test(map), '.grounds-map keeps its 1px border, transparent: the cell arithmetic counts it and the canvas paints it in ink');
  assert(/width:\s*max-content/.test(map), '.grounds-map is still max-content wide, so its box is its tracks \u2014 a block-level grid is otherwise its container\u2019s width, and the Phase 6 shoot read 491px of tracks as a 271px box on a phone');

  // --- the 1080 band keeps the desktop cell; a coarse pointer gets 48 (#249) ---
  assert(!/--cell:\s*38px/.test(css), 'no breakpoint shrinks --cell to 38px any more \u2014 that was 34px markers on every tablet');
  assert(!/--cell:\s*\d/.test(block('max-width:\\s*1080px')), 'the 1080px block does not set --cell at all; the sheet pans instead');
  const coarse = block('pointer:\\s*coarse');
  assert(coarse.length > 0, 'style.css has a (pointer: coarse) block \u2014 the touch sizes hang off the pointer, not the width');
  const coarseCell = Number((coarse.match(/--cell:\s*(\d+)px/) || [])[1]);
  const markerMargin = Number((css.match(/\.plot-marker\s*\{[^}]*?margin:\s*(\d+)px/) || [])[1]);
  assert(coarseCell - markerMargin * 2 >= 44, `a plot marker on a coarse pointer (cell ${coarseCell}px \u2212 margin ${markerMargin}px \u00d7 2) is at least 44px at any width (got ${coarseCell - markerMargin * 2}px)`);
  for (const selector of ['.btn', '.tab-btn', '#save-bar button', '#resetBtn']) {
    const escaped = selector.replace(/[.#]/g, '\\$&');
    assert(new RegExp(`${escaped}[^{]*\\{[^}]*min-height:\\s*44px`).test(coarse), `${selector} has a 44px min-height on a coarse pointer, whatever the viewport width`);
  }
  assert(/input\[type=range\]\s*\{[^}]*min-height:\s*44px/.test(coarse), 'the ticket-price slider is 44px tall on a coarse pointer \u2014 it measured 16px on a phone before');
  assert(/(?:^|[\s,])select[^{]*\{[^}]*min-height:\s*44px/.test(coarse), 'every <select> is 44px tall on a coarse pointer \u2014 the schedule\u2019s measured 31px and the offer row\u2019s 32px before');
  assert(/\.offer-terms select[^{]*\{[^}]*min-height:\s*44px/.test(coarse), 'including the two offer-row <select>s, whose own 32px rule would otherwise win on specificity');

  // --- nothing pushes the page sideways (#248) ---
  const scroll = rule('.table-scroll');
  assert(/overflow-x:\s*auto/.test(scroll), '.table-scroll scrolls a wide table inside its own box');
  const sched = rule('.schedule-table select');
  assert(/width:\s*100%/.test(sched) && /min-width:\s*7\.5em/.test(sched), 'a schedule <select> fills its column down to 7.5em rather than sitting at its 175px intrinsic width');
  assert(/\.roster-table td \.hint-tag,\s*\.roster-table td \.warn-tag\s*\{[^}]*white-space:\s*normal/.test(css), 'a tag inside a roster cell wraps \u2014 a nowrap "Season Contract unlocks Weekend 3" set the table\u2019s minimum at 541px');
  assert(/min-width:\s*0/.test(rule('input[type=range]')), 'the slider may shrink below its 129px intrinsic width, so the price row fits a 340px panel');
  assert(/white-space:\s*nowrap/.test(rule('.ledger-table td:last-child')), 'a ledger figure never wraps \u2014 "200 guests" broke over two lines at every width');

  // --- the phone HUD (#250) ---
  const phone = block('max-width:\\s*720px');
  assert(/\.wordmark \.subtitle\s*\{[^}]*display:\s*none/.test(phone), 'the wordmark\u2019s version line is hidden on a phone');
  assert(/#ledger\s*\{[^}]*grid-template-columns:\s*repeat\(3,/.test(phone), 'the six HUD figures sit in a three-column grid on a phone rather than wrapping at their own widths');

  // --- main.js threads the tier onto #board, and every table has its box (#246, #248) ---
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify({ ...save, __v: 2 }));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return dom.window.document;
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (el) el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return !!el;
  };
  {
    const doc = await boot(State.createInitialState());
    assert(doc.querySelector('#board').style.getPropertyValue('--cols') === String(GRID_EXPANSIONS[0].cols), `a fresh game sets --cols ${GRID_EXPANSIONS[0].cols} on #board`);
    click(doc, '[data-tab="backstage"]');
    const rosters = [...doc.querySelectorAll('table.roster-table')];
    assert(rosters.length === 2 && rosters.every(t => t.parentElement.classList.contains('table-scroll')), 'both Backstage roster tables sit in a .table-scroll box');
  }
  {
    const deep = GRID_EXPANSIONS.find(g => g.label === 'Deep Woods Trail');
    let s = State.createInitialState();
    s.season = deep.unlockSeason;
    s = State.buildPlot(s, 'stage', 3, 0).state || s;
    const doc = await boot(s);
    assert(doc.querySelector('#board').style.getPropertyValue('--cols') === String(deep.cols), `at Weekend ${deep.unlockSeason} #board carries --cols ${deep.cols}`);
    click(doc, '[data-tab="fairfloor"]');
    const sched = doc.querySelector('table.schedule-table');
    assert(!!sched && sched.parentElement.classList.contains('table-scroll'), 'the schedule table sits in a .table-scroll box');
    click(doc, '[data-action="openGates"]');
    assert(!!doc.querySelector('.ticket-stub') && doc.querySelector('#board').style.getPropertyValue('--cols') === String(deep.cols), 'and the variable is still set on a report screen, so the next planning render starts from the right width');
  }
}

// ---------------------------------------------------------------------
// Section 29: Phase 6, increment 1 — the map is a canvas under a grid,
// both under one view.
//
// renderGroundsMap no longer emits a .terrain-cell per cell; plat.js
// paints the ground on a .plat-canvas and the marker grid rides the same
// view transform (mapview.js) as a CSS transform, so a marker sits on its
// terrain at every scale and pan. main.js owns the view in `ui`, sizes the
// stage after every render, and wires drag, pinch, Ctrl+wheel, the arrow
// keys and three zoom buttons. jsdom lays nothing out, so the stage's
// rectangle is stubbed to 330px here — a phone's worth of sheet — and
// everything below is read off the transform the page actually wrote.
// ---------------------------------------------------------------------
{
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const STAGE_W = 330;
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify({ ...save, __v: 2 }));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    // The stage is the one element whose size the view depends on.
    const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList && this.classList.contains('plat-stage')
        ? { left: 0, top: 0, right: STAGE_W, bottom: 400, width: STAGE_W, height: 400 }
        : zero;
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document };
  };
  const click = (doc, sel) => {
    const el = doc.querySelector(sel);
    if (el) el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
    return !!el;
  };
  const transformOf = (doc) => {
    const m = (doc.querySelector('.grounds-map')?.style.transform || '').match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e-]+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) } : null;
  };
  const cellOf = (doc) => parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue('--cell')) || 46;
  const tick = () => new Promise(r => setTimeout(r, 5));

  const { dom, doc } = await boot(State.createInitialState());
  const win = dom.window;
  const stage = doc.querySelector('.plat-stage');
  assert(!!stage && stage.getAttribute('tabindex') === '0' && /pan/i.test(stage.getAttribute('aria-label') || ''), 'the map sits in a focusable .plat-stage whose label says how to pan it');
  assert(!!stage.querySelector('canvas.plat-canvas') && !!stage.querySelector('.grounds-map'), 'the stage holds the canvas and the marker grid');
  assert(doc.querySelectorAll('.terrain-cell').length === 0, 'no .terrain-cell is emitted any more — the terrain is the canvas’s');
  assert(!!doc.querySelector('.gate-marker') && doc.querySelector('#grounds .grounds-map').style.getPropertyValue('--cols') === String(GRID_EXPANSIONS[0].cols), 'the gate and the grid’s tracks are still in the DOM');
  assert(!doc.querySelector('.compass') && !doc.querySelector('svg.compass'), 'the SVG compass is gone from the sheet; the canvas draws its own');
  for (const a of ['mapZoomIn', 'mapZoomOut', 'mapFit']) assert(!!doc.querySelector(`[data-action="${a}"]`), `a ${a} button is on the page`);

  // The rest view: a 330px stage with a mouse fits the 10-wide Home Grounds.
  const cell = cellOf(doc);
  // Built the way layoutMap() builds it: the stage's height is the view's
  // viewport height, so a map shorter than its stage centres vertically.
  const restView = (tier) => {
    const v = createView({ cols: tier.cols, rows: tier.rows, cell, viewport: { w: STAGE_W, h: 0 }, minScale: minScaleFor({ cell, coarse: false }) });
    return fit(withViewport(v, { w: STAGE_W, h: stageHeight(v) }));
  };
  const expected = restView(GRID_EXPANSIONS[0]);
  const t0 = transformOf(doc);
  assert(!!t0, 'the marker grid carries a translate(...) scale(...) transform');
  assert(t0 && Math.abs(t0.scale - expected.scale) < 1e-9 && expected.scale < 1, `at rest the grid is scaled to fit the stage (${t0 && t0.scale.toFixed(4)}, expected ${expected.scale.toFixed(4)})`);
  const tt = trackTransform(expected);
  assert(t0 && Math.abs(t0.x - (tt.x - FRAME.left)) < 1e-9 && Math.abs(t0.y - (tt.y - FRAME.top)) < 1e-9, 'and its translate is trackTransform() less the static FRAME offset the padding already gives it');
  assert(stage.style.height === `${stageHeight(expected)}px`, `the stage’s height is stageHeight() for the tier at the rest scale (${stage.style.height})`);

  // Zoom buttons change the transform without a render.
  click(doc, '[data-action="selectBuild"][data-kind="food"]');
  const ghostsBefore = doc.querySelectorAll('.plot-marker.ghost').length;
  assert(ghostsBefore > 0, 'ghost markers render in the grid while a kind is selected');
  const stageAfterSelect = doc.querySelector('.plat-stage');
  click(doc, '[data-action="mapZoomIn"]');
  const t1 = transformOf(doc);
  assert(t1 && Math.abs(t1.scale - expected.scale * KEY_ZOOM) < 1e-9, `mapZoomIn multiplies the scale by KEY_ZOOM (${t1 && t1.scale.toFixed(4)})`);
  assert(doc.querySelector('.plat-stage') === stageAfterSelect && doc.querySelectorAll('.plot-marker.ghost').length === ghostsBefore, 'a zoom button does not re-render the grounds; the ghosts are the same nodes');
  click(doc, '[data-action="mapZoomIn"]');
  const t2 = transformOf(doc);
  assert(t2 && t2.scale > 1 && t2.x < 0, 'two zooms in put the map wider than the stage, panned to keep the centre');
  click(doc, '[data-action="mapFit"]');
  const t3 = transformOf(doc);
  assert(t3 && Math.abs(t3.scale - expected.scale) < 1e-9 && Math.abs(t3.x - t0.x) < 1e-9, 'mapFit returns to the rest transform');
  click(doc, '[data-action="mapZoomOut"]');
  const t4 = transformOf(doc);
  assert(t4 && Math.abs(t4.scale - expected.scale / KEY_ZOOM) < 1e-9, 'mapZoomOut divides by KEY_ZOOM (a mouse may go under the fit)');
  click(doc, '[data-action="mapZoomIn"]');
  click(doc, '[data-action="mapZoomIn"]');
  click(doc, '[data-action="mapZoomIn"]');
  const zoomed = transformOf(doc);
  assert(zoomed && zoomed.scale > 1, `zoomed in for the gestures below (scale ${zoomed && zoomed.scale.toFixed(3)})`);

  // A drag pans, and swallows the click that ends it.
  const stageEl = doc.querySelector('.plat-stage');
  const ghost = doc.querySelector('.plot-marker.ghost');
  const mouse = (type, target, x, y) => target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  mouse('pointerdown', ghost, 100, 100);
  mouse('pointermove', ghost, 60, 100);
  mouse('pointerup', ghost, 60, 100);
  const dragged = transformOf(doc);
  assert(dragged && Math.abs(dragged.x - (zoomed.x - 40)) < 1e-9 && Math.abs(dragged.y - zoomed.y) < 1e-9, `a 40px drag west pans the map 40px (x ${zoomed && zoomed.x.toFixed(1)} → ${dragged && dragged.x.toFixed(1)})`);
  click(doc, '.plot-marker.ghost');
  assert(!doc.querySelector('.plot-marker.planning') && doc.querySelectorAll('.plot-marker.ghost').length === ghostsBefore, 'the click that ends a drag is swallowed: nothing was placed under it');
  await tick();
  // A still click still places.
  mouse('pointerdown', doc.querySelector('.plot-marker.ghost'), 100, 100);
  mouse('pointermove', doc.querySelector('.plot-marker.ghost'), 102, 101);
  mouse('pointerup', doc.querySelector('.plot-marker.ghost'), 102, 101);
  assert(Math.abs(transformOf(doc).x - dragged.x) < 1e-9, 'a 3px wobble inside the slop does not pan');
  click(doc, '.plot-marker.ghost');
  assert(!!doc.querySelector('.plot-marker.planning'), 'a still click on a ghost places the plot as before');
  const afterPlace = transformOf(doc);
  assert(afterPlace && Math.abs(afterPlace.scale - zoomed.scale) < 1e-9 && Math.abs(afterPlace.x - dragged.x) < 1e-9, 'the render that placed it kept the zoom and the pan — the view survives a re-render while the tier and stage hold');

  // Ctrl+wheel zooms at the cursor; a plain wheel is the page’s.
  const wheel = (ctrl) => doc.querySelector('.plat-stage').dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, deltaY: -50, ctrlKey: ctrl }));
  wheel(false);
  assert(Math.abs(transformOf(doc).scale - afterPlace.scale) < 1e-9, 'a plain wheel leaves the map alone, so the page can scroll under the cursor');
  wheel(true);
  const wheeled = transformOf(doc);
  assert(wheeled.scale > afterPlace.scale, `Ctrl+wheel up zooms in (${afterPlace.scale.toFixed(3)} → ${wheeled.scale.toFixed(3)})`);

  // Arrow keys on the focused stage.
  const key = (k) => doc.querySelector('.plat-stage').dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowRight');
  const keyed = transformOf(doc);
  assert(Math.abs(keyed.x - (wheeled.x - 40)) < 1e-9 || Math.abs(keyed.x - wheeled.x) < 1e-9 && wheeled.x <= STAGE_W - contentSize(GRID_EXPANSIONS[0].cols, GRID_EXPANSIONS[0].rows, cell).w * wheeled.scale + 1e-9, 'ArrowRight pans 40px east, or stays if already at the east edge');
  key('0');
  assert(Math.abs(transformOf(doc).scale - expected.scale) < 1e-9, '0 fits the map again');
  // The same key on something else inside #grounds — the zoom button is
  // the nearest focusable thing — does nothing to the map. (Dispatched on
  // the desk it would prove only that the listener is on #grounds, which
  // is true by construction: the first draft of this line did that and
  // stayed green with the target check deleted.)
  doc.querySelector('[data-action="mapZoomIn"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: '+', bubbles: true }));
  assert(Math.abs(transformOf(doc).scale - expected.scale) < 1e-9, 'a + typed anywhere but the stage is not a zoom');

  // A new tier refits.
  click(doc, '[data-action="cancelBuild"]');
  click(doc, '[data-action="mapZoomIn"]');
  const beforeTier = transformOf(doc);
  assert(beforeTier.scale > expected.scale, 'zoomed before the tier changes');
  const deep = GRID_EXPANSIONS.find(g => g.label === 'Deep Woods Trail');
  const { doc: doc2 } = await boot({ ...State.createInitialState(), season: deep.unlockSeason });
  const deepExpected = restView(deep);
  const t5 = transformOf(doc2);
  assert(t5 && Math.abs(t5.scale - deepExpected.scale) < 1e-9 && doc2.querySelector('.plat-stage').style.height === `${stageHeight(deepExpected)}px`, `a wider tier rests at its own fit (${t5 && t5.scale.toFixed(4)}) with its own stage height`);

  // A report screen has no stage, and coming back from one lays the map out again.
  click(doc2, '[data-action="openGates"]');
  assert(!doc2.querySelector('.plat-stage') && !!doc2.querySelector('.ticket-stub'), 'a report has no stage');
  click(doc2, '[data-action="nextDay"]');
  const t6 = transformOf(doc2);
  assert(t6 && Math.abs(t6.scale - deepExpected.scale) < 1e-9, 'and the next planning day comes back at the rest view');
}

// ---------------------------------------------------------------------
// Section 30: Phase 6, increment 2 — the build preview, and the readout
// that finally shows a sentence on a phone.
//
// Increment 1 kept every marker in the DOM so its `title` survived the
// canvas (#251). That was the right call and it did not fix anything: a
// `title` has never shown on a touch screen, so the refusal a blocked
// cell has carried since Stage 11 has never been read by anybody holding
// a phone, and the numbers a build would move were not written down
// anywhere at all — the ghost buttons quoted a price and stopped.
//
// The two halves below. previewPlacement() splices the candidate into a
// copy of builtPlots and runs the three functions the day itself runs;
// the strongest check here is that its promise matches what actually
// happens when the plot gets built for real. previewLine() turns that
// into one sentence, out of a DOM. Then the wiring: pointerover — the
// event a tap fires before its click, and the only one a phone ever
// gives the map — writes that sentence into a live region under the
// sheet.
// ---------------------------------------------------------------------
{
  // --- the splice is 'built', and staffed for a stall ---
  {
    const s = State.createInitialState();
    const p = previewPlacement('food', 6, 2, s.builtPlots);
    assert(p.ok && p.cost === quoteBuild('food', 6, 2, s.builtPlots).cost,
      'a legal cell previews at exactly quoteBuild’s price, not a second cost formula');
    assert(p.draw.before === computeGroundsDraw(s.builtPlots).mult,
      'the preview’s "before" is the grounds as they stand');
    assert(p.draw.after > p.draw.before && p.draw.delta > 0,
      `a stall on empty grounds raises the draw (${p.draw.before} → ${p.draw.after}) — spliced as planning, or as a stall with nobody in it, every cell on the map would read +0.00`);
    assert(s.builtPlots.length === 0 && !s.builtPlots.some(q => q.id === PREVIEW_PLOT_ID),
      'and the candidate never lands in the caller’s array');
  }

  // --- the promise is the outcome: build it for real and compare ---
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.hireVendor(s, 'vend_cider', 'open').state;
    s = State.buildPlot(s, 'stage', 8, 5).state;
    const p = previewPlacement('food', 1, 2, s.builtPlots);
    assert(p.ok, 'the second stall at (1,2) is a legal placement');
    // Build the previewed stall for real, seat somebody in it, and read
    // the same three numbers off the state the day would use.
    let after = State.buildPlot(s, 'food', 1, 2).state;
    after = State.hireVendor(after, 'vend_piepeddler', 'open').state;
    const realPlot = after.builtPlots.find(q => q.x === 1 && q.y === 2);
    assert(!!realPlot && realPlot.assignedVendorId === 'vend_piepeddler', 'the real stall got built and seated at (1,2)');
    // The preview rounds to two places to be readable; the comparison is
    // against the same rounding, not a looser tolerance that would hide a
    // real disagreement in the third place.
    const realDraw = Math.round(computeGroundsDraw(after.builtPlots).mult * 100) / 100;
    assert(realDraw === p.draw.after,
      `the previewed draw is the draw the built grounds actually have (${p.draw.after} against ${realDraw})`);
    const realReach = computeReachability(after.builtPlots)[realPlot.id];
    assert(p.reach && Math.abs(realReach.mult - p.reach.mult) < 0.005 && realReach.distance === p.reach.hops,
      `the previewed gate reach is the one the built stall actually gets (${JSON.stringify(p.reach)} against ${realReach.distance} hops, ${realReach.mult.toFixed(2)}×)`);
    const realTraffic = computeFootTraffic(after.builtPlots)[realPlot.id];
    assert(p.traffic && Math.abs(realTraffic.mult - p.traffic.mult) < 0.005,
      `the previewed foot traffic is the one the built stall actually gets (${JSON.stringify(p.traffic)} against ${realTraffic.mult.toFixed(2)}×)`);
    // What it costs the neighbours. The stall already at (6,2) is five
    // hops out; a second one on the gate itself drops its reach.
    const existing = s.builtPlots.find(q => q.x === 6 && q.y === 2);
    assert(p.drops.length === 1 && p.drops[0].id === existing.id && p.drops[0].drop > 0,
      `the preview names the plot that pays for it (${p.drops.map(d => d.name).join(', ') || 'none'})`);
    const beforeReach = computeReachability(s.builtPlots)[existing.id].mult;
    const afterReach = computeReachability(after.builtPlots)[existing.id].mult;
    assert(beforeReach > afterReach && Math.abs((beforeReach - afterReach) - (p.drops[0] || {}).drop) < 0.02,
      `and the drop it names (${(p.drops[0] || {}).drop}) is the one the build actually deals (${(beforeReach - afterReach).toFixed(2)})`);
  }

  // --- the drop is the net of both halves, and they can pull apart ---
  // Found by breaking the traffic term's sign and watching the suite stay
  // green (#34): every scenario above moved a neighbour's gate reach and
  // left its foot traffic alone, so half of `drops` was unguarded. A stall
  // at (0,1) and a second at (2,2) move both, in opposite directions.
  {
    let s = State.buildPlot(State.createInitialState(), 'food', 0, 1).state;
    s = State.hireVendor(s, 'vend_cider', 'open').state;
    const existing = s.builtPlots[0];
    assert(existing.assignedVendorId === 'vend_cider', 'the stall at (0,1) is built and seated');
    const p = previewPlacement('food', 2, 2, s.builtPlots);
    let after = State.buildPlot(s, 'food', 2, 2).state;
    after = State.hireVendor(after, 'vend_piepeddler', 'open').state;
    const t0 = computeFootTraffic(s.builtPlots)[existing.id].mult;
    const t1 = computeFootTraffic(after.builtPlots)[existing.id].mult;
    const r0 = computeReachability(s.builtPlots)[existing.id].mult;
    const r1 = computeReachability(after.builtPlots)[existing.id].mult;
    assert(t1 < t0 && r1 > r0,
      `the second stall costs the first its foot traffic (${t0.toFixed(2)} → ${t1.toFixed(2)}) and hands it gate reach (${r0.toFixed(2)} → ${r1.toFixed(2)})`);
    const net = Math.round(((t0 - t1) + (r0 - r1)) * 100) / 100;
    assert(p.drops.length === 1 && Math.abs((p.drops[0] || {}).drop - net) < 1e-9,
      `and the reported drop is the net of both, not whichever one is bigger (${(p.drops[0] || {}).drop} against ${net})`);
  }

  // --- a first plot costs nobody anything; a stage is not a stall ---
  {
    const s = State.createInitialState();
    assert(previewPlacement('food', 6, 2, s.builtPlots).drops.length === 0,
      'the first stall on empty grounds takes nothing from anybody');
    const stage = previewPlacement('stage', 0, 0, s.builtPlots);
    assert(stage.ok && stage.traffic === null && stage.capacity > 0 && stage.reach !== null,
      'a stage previews a capacity and a gate reach, and no foot traffic — traffic is a stall’s number');
    const demo = previewPlacement('demo', 0, 1, s.builtPlots);
    assert(demo.ok && demo.reach === null && demo.traffic === null && demo.draw.delta > 0,
      'a demo camp is in neither reachability group and neither traffic group, and still moves the draw');
  }

  // --- a refusal is isLegalPlacement's own sentence, once ---
  {
    const s = State.createInitialState();
    const hill = [];
    for (let y = 0; y < 7 && hill.length === 0; y++) {
      for (let x = 0; x < 10; x++) if (terrainAt(x, y) === 'hill') { hill.push({ x, y }); break; }
    }
    assert(hill.length === 1, 'the Home Grounds have a hill cell to refuse a stall on');
    const legal = isLegalPlacement('food', hill[0].x, hill[0].y, s.builtPlots);
    const p = previewPlacement('food', hill[0].x, hill[0].y, s.builtPlots);
    assert(!legal.ok && !p.ok && p.reason === legal.reason && p.draw === undefined,
      'a refused cell previews no numbers and carries isLegalPlacement’s exact sentence, not a second wording of it');
    assert(previewLine(p) === legal.reason,
      'and the readout line for it is that sentence and nothing else');
  }

  // --- previewLine, out of a DOM ---
  {
    const s = State.createInitialState();
    const stall = previewPlacement('food', 6, 2, s.builtPlots);
    const line = previewLine(stall);
    assert(line.includes(`$${stall.cost.toLocaleString()}`) && line.includes(stall.name),
      `the preview line names the structure and its price (${line})`);
    assert(line.includes(stall.draw.before.toFixed(2)) && line.includes(stall.draw.after.toFixed(2)),
      'and both sides of the draw, so the delta is readable rather than asserted');
    assert(stall.reach && line.includes(`${stall.reach.hops} hops from the gate`), 'and how far the gate is');
    assert(/built and staffed/.test(line), 'a stall’s line says "built and staffed" — the splice seated a vendor and the sentence has to admit it');
    const stageLine = previewLine(previewPlacement('stage', 0, 0, s.builtPlots));
    assert(/once built\./.test(stageLine) && !/staffed/.test(stageLine),
      'a stage’s line says "once built" and nothing about staffing');
    assert(!/drop/.test(line), 'a preview that costs nobody anything says nothing about drops');
    let s2 = State.buildPlot(s, 'food', 6, 2).state;
    s2 = State.hireVendor(s2, 'vend_cider', 'open').state;
    const costly = previewLine(previewPlacement('food', 1, 2, s2.builtPlots));
    assert(/drops 0\.\d\d× across traffic and reach/.test(costly),
      `and one that does names it (${costly})`);
  }

  // --- the readout on the page ---
  const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
  const boot = async (save) => {
    const storage = makeMemoryStorage();
    storage.setItem('renn-faire-sim-save-v1', JSON.stringify({ ...save, __v: 2 }));
    const dom = new JSDOM(rawHtml, { url: `file://${root}/index.html`, pretendToBeVisual: true });
    const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList && this.classList.contains('plat-stage')
        ? { left: 0, top: 0, right: 330, bottom: 400, width: 330, height: 400 }
        : zero;
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = storage;
    globalThis.confirm = () => true;
    await import(mod('js/main.js') + `?t=${Date.now()}${Math.random()}`);
    return { dom, doc: dom.window.document, storage };
  };
  const readout = (doc) => doc.querySelector('.plat-readout').textContent;
  {
    let s = State.createInitialState();
    s = State.buildPlot(s, 'food', 6, 2).state;
    s = State.hireVendor(s, 'vend_cider', 'open').state;
    const { dom, doc, storage } = await boot(s);
    const win = dom.window;
    const over = (el) => el.dispatchEvent(new win.MouseEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const click = (el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));

    const region = doc.querySelector('.plat-readout');
    assert(!!region && region.getAttribute('role') === 'status' && region.getAttribute('aria-live') === 'polite',
      'the sheet carries a .plat-readout live region, so a sentence written into it is announced rather than just drawn');
    assert(readoutDefault(false) !== readoutDefault(true) && readoutDefault(false).length > 20 && readoutDefault(true).length > 20,
      'the two defaults are two different sentences — comparing the page against readoutDefault() proves nothing if both sides are the same empty string');
    assert(region.textContent === readoutDefault(false), 'at rest it says what the map is for');
    assert(doc.querySelector('.plat-sheet').compareDocumentPosition(region) & win.Node.DOCUMENT_POSITION_FOLLOWING,
      'and it sits after the sheet, where a thumb over the map is not covering it');

    // A built plot's stats, which no phone has ever seen.
    const built = doc.querySelector('.plot-marker.built');
    assert(!!built && built.getAttribute('title').includes('sightline'), 'the built stall still carries its stats in a title');
    over(built);
    assert(readout(doc) === built.getAttribute('title'),
      'pointing at a built plot reads its title out into the readout — the same string, so the tooltip and the readout cannot drift');

    doc.querySelector('[data-action="selectBuild"][data-kind="food"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert(readout(doc) === readoutDefault(true),
      'choosing a kind re-renders the map and the readout says what to do with it now');

    // The refusal. This is the sentence the wishlist has owed a phone
    // since Stage 11.
    const blocked = doc.querySelector('.plot-marker.blocked');
    assert(!!blocked && !!blocked.getAttribute('title'), 'blocked cells are on the map with their reason in a title');
    over(blocked);
    assert(readout(doc) === blocked.getAttribute('title') && readout(doc) !== readoutDefault(true),
      `a pointerover on a blocked cell — the event a tap fires before its click — writes the refusal where a touch screen can read it ("${readout(doc)}")`);

    // The preview, on a ghost.
    const ghost = [...doc.querySelectorAll('.plot-marker.ghost')].find(g => g.dataset.x === '1' && g.dataset.y === '2');
    assert(!!ghost, 'there is a ghost at (1,2)');
    over(ghost);
    const expected = previewLine(previewPlacement('food', 1, 2, State.loadState().builtPlots));
    assert(readout(doc) === expected, `pointing at a ghost previews the build (${readout(doc)})`);
    assert(/×/.test(readout(doc)) && readout(doc).includes('$'),
      'and that preview carries multipliers as well as a price — a price is what the ghost’s own title already said');

    // Focus is the keyboard's way in. Re-query the built marker: choosing
    // a kind re-rendered the map, and the first draft of this line pointed
    // at the detached node from before that render, so the readout never
    // moved off the preview and the assertion held with the focusin
    // listener deleted.
    const builtNow = doc.querySelector('.plot-marker.built');
    over(builtNow);
    assert(readout(doc) === builtNow.getAttribute('title') && readout(doc) !== expected, 'the readout is off the preview before the focus test starts');
    ghost.dispatchEvent(new win.Event('focusin', { bubbles: true }));
    assert(readout(doc) === expected, 'focusing a ghost previews it too, so the keyboard gets the same sentence the pointer does');

    // Mid-drag the pointer crosses cells nobody is asking about.
    const stage = doc.querySelector('.plat-stage');
    const mouse = (type, target, x, y) => target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    mouse('pointerdown', stage, 100, 100);
    const held = readout(doc);
    over(blocked);
    assert(readout(doc) === held, 'a pointer crossing the map with a button down does not rewrite the readout under the drag');
    mouse('pointerup', stage, 100, 100);
    await new Promise(r => setTimeout(r, 5));

    // Placing keeps the numbers on screen through the re-render, and
    // spends nothing.
    const cashBefore = JSON.parse(storage.getItem('renn-faire-sim-save-v1')).cash;
    click(doc.querySelector('.plot-marker.ghost[data-x="1"][data-y="2"]'));
    const saved = JSON.parse(storage.getItem('renn-faire-sim-save-v1'));
    assert(saved.cash === cashBefore && saved.builtPlots.some(p => p.x === 1 && p.y === 2 && p.status === 'planning'),
      'the ghost placed a planning plot and took no money for it');
    assert(readout(doc).startsWith('Planned, nothing spent yet.') && readout(doc).includes(expected),
      `and the readout keeps the preview through the render that placed it (${readout(doc)})`);
    assert(!doc.querySelector('.plot-marker.ghost'), 'the ghosts are gone with the pending build, so the readout is the only place those numbers still are');

    // One render, then it is the map's again.
    doc.querySelector('[data-tab="backstage"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    assert(readout(doc) === readoutDefault(false),
      'the placement readout is spent by one render, like a flash — a stale sentence about a plot that has since moved is worse than none');
    dom.window.close();
  }

  // readoutFor is the one place the choice is made, so it is checked
  // directly rather than only through the listener above.
  {
    const el = { dataset: { action: 'placeAt', kind: 'food', x: '6', y: '2' }, getAttribute: () => 'a title nobody should read here' };
    const s = State.createInitialState();
    assert(readoutFor(el, s.builtPlots) === previewLine(previewPlacement('food', 6, 2, s.builtPlots)),
      'readoutFor previews a ghost rather than reading its title');
    const plain = { dataset: {}, getAttribute: (n) => (n === 'title' ? 'The Cider Tent — built' : null) };
    assert(readoutFor(plain, s.builtPlots) === 'The Cider Tent — built', 'and hands back the title for anything else');
    assert(readoutFor(null, s.builtPlots) === null, 'and nothing for nothing');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
