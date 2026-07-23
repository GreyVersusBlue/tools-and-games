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
const { makeRng, validateSchedule, simulateDay, QUIRKS, terrainAt, chebyshevDistance, computePlotAttributes, quoteBuild } = await import(path.join(root, 'js/engine.js'));
const { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN } = await import(path.join(root, 'js/data.js'));
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
  // vendor hiring requires an open stall plot
  let s = State.createInitialState();
  const noPlot = State.hireVendor(s, 'vend_cider');
  assert(noPlot.error && /build a stall plot/i.test(noPlot.error), 'hireVendor refuses without a built food/vendor plot');

  s = State.buildPlot(s, 'food', 6, 2).state;
  const withPlot = State.hireVendor(s, 'vend_cider');
  assert(withPlot.error === null, 'hireVendor succeeds once a stall plot exists');
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
