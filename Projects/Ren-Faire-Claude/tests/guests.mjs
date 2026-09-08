// tests/guests.mjs — Phase 1 (guests who walk). Pure Node, no jsdom: the
// walk is a pure function of (state, guests, rng) and every assertion here
// runs against that, plus the seam where simulateDay reads it. Same
// assert() counter as tests/smoke.mjs. Run with `npm test` or
// `node tests/guests.mjs`.

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
// import() takes a URL, not a path — see smoke.mjs for why a bare Windows
// absolute path is refused as the URL scheme "c:".
const mod = p => pathToFileURL(path.join(root, p)).href;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}

const { spawnGuests, walkGuests, buildAttractions, pathRouteBetween, pathHopsBetween } = await import(mod('js/guests.js'));
const { makeRng, simulateDay, computePathRoutes, computePathDistances, pathRouteTo, terrainAt, reachabilityDistance, vendorById, measureFootTraffic } = await import(mod('js/engine.js'));
const { GUESTS, GRID, ENTRANCE, TIME_BLOCKS, VENDORS, CONFIG } = await import(mod('js/data.js'));
const { renderReport } = await import(mod('js/ui.js'));
const State = await import(mod('js/state.js'));

const key = (x, y) => `${x},${y}`;
const orthogonal = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// A bare state with real built plots, bypassing cash: the walk reads
// builtPlots, schedule and nothing else about the desk.
function grounds(plots, schedule = {}) {
  return {
    day: 1, season: 1, cash: 20000, reputation: 55, ticketPrice: CONFIG.priceAnchor, weekendDay: 2,
    builtPlots: plots, roster: [], hiredVendors: [], schedule, contracts: {}, vendorContracts: {},
    activeCampaign: null, campaignCooldowns: {}, history: [],
  };
}
const stage = (id, x, y) => ({ id, kind: 'stage', x, y, w: 2, h: 2, status: 'built', cost: 1700, capacity: 150, name: `Stage ${id}` });
const stall = (id, kind, x, y, vendorId) => ({ id, kind, x, y, w: 1, h: 1, status: 'built', cost: 950, name: `${kind} ${id}`, assignedVendorId: vendorId });
const demo = (id, x, y) => ({ id, kind: 'demo', x, y, w: 1, h: 1, status: 'built', cost: 700, name: `Camp ${id}` });

// ---------------------------------------------------------------------
// Section 1: GUESTS content integrity
// ---------------------------------------------------------------------
{
  const shares = GUESTS.archetypes.reduce((s, a) => s + a.share, 0);
  assert(Math.abs(shares - 1) < 1e-9, `archetype shares sum to 1 (got ${shares})`);
  assert(GUESTS.archetypes.length === 4, 'four archetypes: families, revellers, history buffs, day-trippers');
  assert(new Set(GUESTS.archetypes.map(a => a.id)).size === GUESTS.archetypes.length, 'archetype ids are unique');
  for (const a of GUESTS.archetypes) {
    for (const need of ['food', 'spectacle', 'shade', 'spend']) {
      assert(typeof a.needs[need] === 'number' && a.needs[need] >= 0 && a.needs[need] <= 1, `${a.id}.needs.${need} is a 0-1 number`);
    }
    assert(a.budget[0] > 0 && a.budget[1] > a.budget[0], `${a.id}'s purse range is ordered and positive`);
    for (const kind of ['stage', 'demo', 'food', 'vendor']) {
      assert(typeof a.affinity[kind] === 'number' && a.affinity[kind] > 0, `${a.id}.affinity.${kind} is a positive multiplier`);
    }
  }
  assert(GUESTS.sampleCap >= 200, 'the sample cap is large enough for a stall\'s share to be a statistic');
  // Increment 2 changed this from a comparison against the network's *size*
  // (24 cells against 24 steps, which passed by one) to its diameter, which
  // is the number that actually decides whether a guest can get somewhere:
  // the farthest reachable cell is 16 hops out, so a day's 24 steps reaches
  // it with room to walk back. Below TIME_BLOCKS.length steps per block the
  // far end of the grounds would be unreachable within a day, which is a
  // different game.
  const gateDistances = [...computePathDistances().values()];
  const diameter = Math.max(...gateDistances);
  assert(GUESTS.stepsPerBlock * TIME_BLOCKS.length > diameter, `a full day of steps reaches the farthest cell on the network and leaves some over (${GUESTS.stepsPerBlock * TIME_BLOCKS.length} steps against ${diameter} hops)`);
  assert(GUESTS.stepsPerBlock < diameter, `and one block's walk does not cross the whole grounds, or gate distance costs nothing (${GUESTS.stepsPerBlock} against ${diameter})`);
  assert(GUESTS.satisfyRate > 0 && GUESTS.satisfyRate < 1, 'satisfyRate is a fraction of a need, not all of it or none');
}

// ---------------------------------------------------------------------
// Section 2: the route tree (computePathRoutes / pathRouteTo)
// ---------------------------------------------------------------------
{
  const routes = computePathRoutes();
  const dist = computePathDistances();
  assert(routes.size === dist.size, 'computePathDistances covers exactly the cells computePathRoutes reaches');
  let agree = true;
  for (const [k, node] of routes) if (dist.get(k) !== node.dist) agree = false;
  assert(agree, 'every hop count computePathDistances reports is the route tree\'s own');
  assert(routes.get(key(ENTRANCE.x, ENTRANCE.y)).prev === null, 'the gate has no parent');
  let parentsCloser = true;
  for (const [k, node] of routes) {
    if (node.prev === null) continue;
    const parent = routes.get(node.prev);
    if (!parent || parent.dist !== node.dist - 1 || !orthogonal(parent, node)) parentsCloser = false;
  }
  assert(parentsCloser, 'every cell\'s parent is one orthogonal hop closer to the gate');

  const far = pathRouteTo(13, 7);
  assert(Array.isArray(far) && far.length === dist.get('13,7') + 1, 'pathRouteTo returns dist+1 cells, gate included');
  assert(far[0].x === ENTRANCE.x && far[0].y === ENTRANCE.y, 'a route starts at the gate');
  assert(far[far.length - 1].x === 13 && far[far.length - 1].y === 7, 'a route ends at the asked cell');
  assert(far.every(c => terrainAt(c.x, c.y) === 'path'), 'a route walks path tiles only');
  assert(far.every((c, i) => i === 0 || orthogonal(far[i - 1], c)), 'a route is contiguous: every step is one orthogonal hop');
  assert(pathRouteTo(3, 4) === null, 'the col-3 spur below row 3 has no route from the gate (the pre-existing authoring gap, still pinned)');
  assert(pathRouteTo(0, 0) === null, 'a clearing cell has no route');
  assert(pathRouteTo(ENTRANCE.x, ENTRANCE.y).length === 1, 'the route to the gate is the gate alone');
}

// ---------------------------------------------------------------------
// Section 3: routes between two cells
// ---------------------------------------------------------------------
{
  const gate = { x: ENTRANCE.x, y: ENTRANCE.y };
  assert(pathRouteBetween(gate, gate).length === 0, 'a route from a cell to itself is empty, not null');
  assert(pathHopsBetween(gate, gate) === 0, 'zero hops from a cell to itself');
  const toEast = pathRouteBetween(gate, { x: 10, y: 7 });
  assert(toEast.length === computePathDistances().get('10,7'), 'gate-to-cell hops agree with the Stage 17 BFS');
  assert(toEast.length === pathHopsBetween(gate, { x: 10, y: 7 }), 'pathHopsBetween is the length of pathRouteBetween');
  assert(toEast[toEast.length - 1].x === 10 && toEast[toEast.length - 1].y === 7, 'the between-route ends at its destination');
  assert(toEast.every((c, i) => orthogonal(i === 0 ? gate : toEast[i - 1], c)), 'the between-route is contiguous from its origin');
  const back = pathRouteBetween({ x: 10, y: 7 }, { x: 2, y: 2 });
  assert(back.length === pathHopsBetween({ x: 10, y: 7 }, { x: 2, y: 2 }) && back.length === 13, 'a route from mid-grounds back toward the gate is the real shortest walk (13 hops), not a detour via the gate');
  assert(pathRouteBetween(gate, { x: 3, y: 4 }) === null, 'no route onto the disconnected spur');
  assert(pathRouteBetween({ x: 3, y: 4 }, gate) === null, 'no route off the disconnected spur either');
  assert(pathHopsBetween(gate, { x: 3, y: 4 }) === Infinity, 'hops to an unreachable cell are Infinity');
}

// ---------------------------------------------------------------------
// Section 4: spawnGuests
// ---------------------------------------------------------------------
{
  const none = spawnGuests(0, makeRng(1));
  assert(none.guests.length === 0 && none.represents === 0, 'zero attendance spawns nobody and represents nobody');
  const small = spawnGuests(150, makeRng(1));
  assert(small.guests.length === 150 && small.represents === 1, 'below the cap every guest is one person');
  const big = spawnGuests(1000, makeRng(1));
  assert(big.guests.length === GUESTS.sampleCap && big.represents === 1000 / GUESTS.sampleCap, 'above the cap the sample is capped and each agent stands for the remainder');
  const ids = new Set(GUESTS.archetypes.map(a => a.id));
  assert(big.guests.every(g => ids.has(g.archetype)), 'every guest has a real archetype');
  assert(big.guests.every(g => g.x === ENTRANCE.x && g.y === ENTRANCE.y), 'every guest starts at the gate');
  assert(big.guests.every(g => {
    const a = GUESTS.archetypes.find(x => x.id === g.archetype);
    return g.budget >= a.budget[0] && g.budget <= a.budget[1];
  }), 'every purse is within its archetype\'s range');
  assert(big.guests.every(g => g.needs !== GUESTS.archetypes.find(x => x.id === g.archetype).needs), 'each guest carries its own copy of the needs vector, not the table\'s');
  const share = (arr, id) => arr.filter(g => g.archetype === id).length / arr.length;
  const fam = GUESTS.archetypes.find(a => a.id === 'family').share;
  assert(Math.abs(share(big.guests, 'family') - fam) < 0.1, `families are about ${fam} of a 400-guest spawn (got ${share(big.guests, 'family').toFixed(2)})`);
  const a = spawnGuests(300, makeRng(9)), b = spawnGuests(300, makeRng(9));
  assert(JSON.stringify(a) === JSON.stringify(b), 'spawnGuests is deterministic for the same seed');
  assert(JSON.stringify(spawnGuests(300, makeRng(10))) !== JSON.stringify(a), 'and differs across seeds');

  // Increment 2: the gate takes its share of the purse first (#229). Same
  // seed, so `arrived` is identical across the three and only what is left
  // for the stalls moves.
  const free = spawnGuests(300, makeRng(9), 0);
  const anchored = spawnGuests(300, makeRng(9), CONFIG.priceAnchor);
  const gouged = spawnGuests(300, makeRng(9), CONFIG.ticketPrice.max);
  assert(free.guests.every((g, i) => g.arrived === anchored.guests[i].arrived && g.arrived === gouged.guests[i].arrived),
    'what a guest walked up with does not depend on the ticket price');
  assert(free.guests.every((g, i) => g.budget === g.arrived), 'with no gate charge a guest carries its whole purse in');
  assert(anchored.guests.every((g, i) => g.budget === Math.max(0, g.arrived - CONFIG.priceAnchor)), 'at the anchor price the gate has taken exactly the ticket out of every purse');
  const purse = (r) => r.guests.reduce((sum, g) => sum + g.budget, 0);
  assert(purse(gouged) < purse(anchored) && purse(anchored) < purse(free), 'a dearer ticket leaves the stalls a thinner crowd to sell to');
  assert(gouged.guests.every(g => g.budget >= 0), 'a purse the gate emptied floors at zero rather than going negative');
  assert(spawnGuests(300, makeRng(9)).guests.every((g, i) => g.budget === free.guests[i].budget),
    'the ticket price argument defaults to no charge, so every pre-increment-2 caller is unchanged');
}

// ---------------------------------------------------------------------
// Section 5: buildAttractions
// ---------------------------------------------------------------------
{
  const s = grounds([
    stage('3_0', 3, 0),
    stall('6_3', 'food', 6, 3, 'vend_cider'),
    stall('8_3', 'vendor', 8, 3, null),
    { ...stall('9_1', 'food', 9, 1, 'vend_stew'), status: 'planning' },
    stall('4_4', 'food', 4, 4, 'vend_stew'),
    demo('7_1', 7, 1),
  ]);
  const { attractions, unreachable } = buildAttractions(s);
  const byId = Object.fromEntries(attractions.map(a => [a.plotId, a]));
  assert(byId['3_0'] && byId['3_0'].stop.x === 3 && byId['3_0'].stop.y === 2 && byId['3_0'].gateHops === 3, 'a stage\'s stop is its nearest-to-the-gate frontage path cell');
  assert(byId['3_0'].gateHops === reachabilityDistance(stage('3_0', 3, 0)), 'an attraction\'s gate hops are reachabilityDistance\'s number');
  assert(byId['3_0'].need === 'spectacle' && byId['6_3'].need === 'food' && byId['7_1'].need === 'spectacle', 'stages and camps serve spectacle, food stalls serve food');
  assert(byId['6_3'].vendor && byId['6_3'].vendor.id === 'vend_cider' && byId['6_3'].price === VENDORS.find(v => v.id === 'vend_cider').avgTicket, 'a seated stall carries its vendor and its ticket');
  assert(!byId['8_3'], 'a stall with nobody seated is a shed and is not an attraction');
  assert(!byId['9_1'], 'a planning plot is not on the grounds');
  assert(!byId['4_4'] && unreachable.length === 1 && unreachable[0] === '4_4', 'a stall fronting the disconnected col-3 spur is named unreachable rather than given a stop');
  assert(attractions.every(a => terrainAt(a.stop.x, a.stop.y) === 'path' && computePathRoutes().has(key(a.stop.x, a.stop.y))), 'every stop is a reachable path cell');
  assert(buildAttractions(grounds([])).attractions.length === 0, 'an empty field has no attractions');
}

// ---------------------------------------------------------------------
// Section 6: the walk
// ---------------------------------------------------------------------
const reachable = computePathRoutes();
const onGrid = (g) => g.x >= 0 && g.y >= 0 && g.x < GRID.cols && g.y < GRID.rows && terrainAt(g.x, g.y) === 'path' && reachable.has(key(g.x, g.y));

// --- determinism and the invariants ---
{
  const s = grounds([stage('3_0', 3, 0), stall('6_3', 'food', 6, 3, 'vend_cider'), stall('8_1', 'vendor', 8, 1, 'vend_leather')], { midday: { '3_0': 'perf_jouster_1' } });
  const run = (seed) => { const rng = makeRng(seed); const { guests } = spawnGuests(900, rng); return { report: walkGuests(s, guests, rng), guests }; };
  const a = run(5), b = run(5);
  assert(JSON.stringify(a.report) === JSON.stringify(b.report) && JSON.stringify(a.guests) === JSON.stringify(b.guests), 'the walk is deterministic for the same seed');
  assert(JSON.stringify(run(6).report) !== JSON.stringify(a.report), 'and differs across seeds');
  assert(a.report.offGrid === 0, 'no guest ended a block off the reachable path network');
  assert(a.guests.every(onGrid), 'every guest\'s final position is a reachable path cell');
  assert(a.guests.every(g => g.steps <= GUESTS.stepsPerBlock * TIME_BLOCKS.length), 'no guest walked more than stepsPerBlock hops per block');
  assert(a.guests.some(g => g.steps > 0) && a.report.steps === a.guests.reduce((t, g) => t + g.steps, 0), 'steps is the sum of every guest\'s walk, and somebody walked');
  const origin = (g) => g.budget + g.spent;
  const spawned = spawnGuests(900, makeRng(5)).guests;
  assert(a.guests.every((g, i) => origin(g) === spawned[i].budget && g.spent >= 0 && g.budget >= 0), 'nobody spent money they did not have: purse + spent is the purse they arrived with');
  assert(Object.values(a.report.arrivals).reduce((t, n) => t + n, 0) === a.guests.reduce((t, g) => t + g.arrivals, 0), 'arrivals per plot sum to arrivals per guest');
  const perBlock = Object.values(a.report.arrivalsByBlock).reduce((t, b) => t + Object.values(b).reduce((u, n) => u + n, 0), 0);
  assert(Object.keys(a.report.arrivalsByBlock).join() === TIME_BLOCKS.map(b => b.id).join() && perBlock === a.guests.reduce((t, g) => t + g.arrivals, 0), 'arrivalsByBlock has one entry per time block and sums to the same total');
  assert(a.report.served.food + a.report.served.spectacle + a.report.served.spend === a.guests.reduce((t, g) => t + g.arrivals, 0), 'every arrival served exactly one need');
  assert(a.report.buyers['8_1'] > 0 && a.report.spent === a.guests.reduce((t, g) => t + g.spent, 0), 'the craft stall sold something and spent is the sum of every purse\'s outlay');
  assert(a.report.buyers['3_0'] === 0, 'a stage sells nothing');
  const byArch = Object.values(a.report.byArchetype).reduce((t, n) => t + n, 0);
  assert(byArch === a.report.sampled && a.report.sampled === GUESTS.sampleCap, 'byArchetype accounts for every sampled guest');
}

// --- an empty field ---
{
  const rng = makeRng(2);
  const { guests } = spawnGuests(200, rng);
  const r = walkGuests(grounds([]), guests, rng);
  assert(r.steps === 0 && r.idle === 200 * TIME_BLOCKS.length, 'on an empty field nobody walks and everyone sits every block out');
  assert(guests.every(g => g.x === ENTRANCE.x && g.y === ENTRANCE.y), 'on an empty field everyone is still at the gate');
  const wanted = guests.filter(g => GUESTS.archetypes.find(a => a.id === g.archetype).needs.food >= 0.5).length;
  assert(wanted > 100 && r.hungry === wanted && r.unspent === 200, 'everyone who came in wanting a meal went home hungry, and every purse is untouched');
}

// --- the unreachable stall is never arrived at, and it costs the crowd ---
{
  const near = grounds([stage('3_0', 3, 0), stall('6_3', 'food', 6, 3, 'vend_stew')]);
  const cutOff = grounds([stage('3_0', 3, 0), stall('4_4', 'food', 4, 4, 'vend_stew')]);
  const walk = (s, seed) => { const rng = makeRng(seed); const { guests } = spawnGuests(300, rng); return walkGuests(s, guests, rng); };
  const a = walk(near, 3), b = walk(cutOff, 3);
  assert(b.unreachable.length === 1 && b.unreachable[0] === '4_4' && !('4_4' in b.arrivals), 'the spur stall is reported unreachable and has no arrival count at all');
  assert(a.served.food > 0 && b.served.food === 0, 'the same vendor on the spur feeds nobody');
  assert(b.hungry > a.hungry, 'and the crowd goes home hungrier for it');
  assert(a.unreachable.length === 0, 'a stall on the artery is reachable');
  // Increment 2: this is now the whole of the col-3 spur ruling (#227) at
  // the walk level. No arrivals means no `spentAt` entry at all, which is
  // what makes simulateDay bill the stall $0 instead of Stage 17's 0.8x
  // floor. The placement that would create this state is refused up front
  // (see tests/smoke.mjs); an already-built one lands here.
  assert(!('4_4' in b.spentAt) && (b.spentAt['6_3'] === undefined), 'an unreachable stall has no till entry to bill from');
  assert(a.spentAt['6_3'] > 0, 'and the reachable one does');
}

// --- the till: every dollar a stall banked came out of a named purse ---
{
  const s = grounds([
    stage('3_0', 3, 0),
    stall('6_3', 'food', 6, 3, 'vend_cider'),
    stall('8_3', 'vendor', 8, 3, 'vend_leather'),
  ]);
  const rng = makeRng(21);
  const { guests } = spawnGuests(400, rng, CONFIG.priceAnchor);
  const r = walkGuests(s, guests, rng);
  const tillTotal = Object.values(r.spentAt).reduce((sum, n) => sum + n, 0);
  assert(tillTotal > 0, 'the stalls took money');
  assert(tillTotal === r.spent, `the stalls' tills add up to exactly what the crowd spent (${tillTotal} vs ${r.spent})`);
  assert(tillTotal === guests.reduce((sum, g) => sum + g.spent, 0), 'and to exactly what came out of the guests\u2019 own purses');
  assert(guests.every(g => g.spent + g.budget === Math.max(0, g.arrived - CONFIG.priceAnchor)),
    'no guest spent money it did not walk in with \u2014 what it brought is the gate\u2019s share plus the stalls\u2019 plus what it took home');
  const cider = vendorById('vend_cider'), leather = vendorById('vend_leather');
  assert(r.spentAt['6_3'] === r.buyers['6_3'] * cider.avgTicket, 'a stall\u2019s till is its buyer count times the vendor\u2019s average ticket, exactly');
  assert(r.spentAt['8_3'] === r.buyers['8_3'] * leather.avgTicket, 'and the same for the craft stall, at its own ticket');
  assert(r.spentAt['3_0'] === 0 && r.arrivals['3_0'] > 0, 'a stage takes no money however many people watch it');
}

// --- distance matters: the same stall nearer the gate draws more ---
{
  const s = grounds([stall('1_3', 'food', 1, 3, 'vend_stew'), stall('10_8', 'food', 10, 8, 'vend_stew')]);
  const rng = makeRng(4);
  const { guests } = spawnGuests(400, rng);
  const r = walkGuests(s, guests, rng);
  assert(r.arrivals['1_3'] > 0 && r.arrivals['1_3'] > r.arrivals['10_8'] * 1.5, `an identical stall one hop from the gate outdraws one sixteen hops away (${r.arrivals['1_3']} vs ${r.arrivals['10_8']})`);
}

// --- a stall's crowd is where the crowd already is ---
{
  // Same two stew stalls, one by the gate and one under a stage at the
  // east end of the artery with a jouster on all day: the crowd eats by the
  // gate, walks to the show, and eats again at the stall beside it.
  const bill = Object.fromEntries(TIME_BLOCKS.map(b => [b.id, { '9_0': 'perf_jouster_1' }]));
  const s = grounds([stage('9_0', 9, 0), stall('1_3', 'food', 1, 3, 'vend_stew'), stall('8_3', 'food', 8, 3, 'vend_stew')], bill);
  const rng = makeRng(4);
  const { guests } = spawnGuests(400, rng);
  const r = walkGuests(s, guests, rng);
  assert(r.arrivals['9_0'] > 200, 'most of the crowd reached the show');
  assert(r.arrivals['8_3'] > 50, `the stall beside the stage fed a real share of the crowd that came for the show (${r.arrivals['8_3']})`);
  assert(r.arrivalsByBlock.morning['1_3'] > 0 && !r.arrivalsByBlock.morning['8_3'], 'and the morning meal was by the gate, before anyone had walked east');
}

// --- the same show twice is half the show ---
{
  const bill = Object.fromEntries(TIME_BLOCKS.map(b => [b.id, { '3_0': 'perf_jouster_1', '7_0': 'perf_jouster_2' }]));
  const s = grounds([stage('3_0', 3, 0), stage('7_0', 7, 0)], bill);
  const rng = makeRng(21);
  const { guests } = spawnGuests(300, rng);
  walkGuests(s, guests, rng);
  assert(guests.filter(g => g.visits['3_0'] && g.visits['7_0']).length > 200, 'with two stages on the bill most guests saw both, rather than the nearer one four times');
}

// --- a block is a budget of steps: the East Meadow is not a stroll ---
{
  const s = grounds([stall('13_6', 'vendor', 13, 6, 'vend_glass')]);
  const rng = makeRng(8);
  const { guests } = spawnGuests(50, rng);
  const hops = pathHopsBetween({ x: ENTRANCE.x, y: ENTRANCE.y }, buildAttractions(s).attractions[0].stop);
  assert(hops > GUESTS.stepsPerBlock, `the test needs a stop farther than one block's walk (${hops} hops vs ${GUESTS.stepsPerBlock})`);
  const r = walkGuests(s, guests, rng);
  const walkers = guests.filter(g => g.steps > 0);
  assert(walkers.length > 0 && walkers.every(g => g.arrivals <= TIME_BLOCKS.length - 1), 'nobody reached a stop farther than stepsPerBlock in the first block');
  assert(walkers.every(g => g.steps >= Math.min(hops, GUESTS.stepsPerBlock)), 'a guest who set out walked the whole block\'s allowance toward it');
  assert(r.arrivals['13_6'] > 0, 'and got there in a later block');
}

// --- taste: history buffs cross the grounds for a demo camp ---
{
  const s = grounds([stage('3_0', 3, 0), demo('7_3', 7, 3)], { morning: { '3_0': 'perf_jouster_1' }, midday: { '3_0': 'perf_jouster_1' }, afternoon: { '3_0': 'perf_jouster_1' }, golden: { '3_0': 'perf_jouster_1' } });
  const crowdOf = (id) => {
    const rng = makeRng(11);
    const { guests } = spawnGuests(400, rng);
    for (const g of guests) {
      const a = GUESTS.archetypes.find(x => x.id === id);
      g.archetype = id; g.needs = { ...a.needs }; g.affinity = a.affinity; g.budget = a.budget[0];
    }
    return walkGuests(s, guests, rng);
  };
  const buffs = crowdOf('buff'), trippers = crowdOf('tripper');
  const demoShare = (r) => r.arrivals['7_3'] / (r.arrivals['7_3'] + r.arrivals['3_0']);
  assert(demoShare(buffs) > demoShare(trippers) * 1.5, `history buffs send a bigger share of their arrivals to the camp than day-trippers do (${demoShare(buffs).toFixed(2)} vs ${demoShare(trippers).toFixed(2)})`);
}

// --- heat: the grove stall outdraws the open one once the sun is up ---
{
  // Two stew stalls fronting the same path cell (10,5) on the col-10 spur,
  // thirteen hops from the gate: (9,5) is clearing (shade 0.3), (11,5) is
  // woods (shade 0.88). Same vendor, same distance, same everything but
  // the canopy. Thirteen hops is more than two blocks' walk at
  // GUESTS.stepsPerBlock, so the first arrival lands in a hot block rather
  // than at the gate-side start of the day; which block that is falls out
  // of the stride and is read off the result rather than named here.
  const s = grounds([stall('9_5', 'food', 9, 5, 'vend_stew'), stall('11_5', 'food', 11, 5, 'vend_stew')]);
  const { attractions } = buildAttractions(s);
  const shady = attractions.find(a => a.plotId === '11_5'), open = attractions.find(a => a.plotId === '9_5');
  assert(shady.gateHops === open.gateHops && shady.gateHops > GUESTS.stepsPerBlock, `the test needs both stalls at the same distance, past one block's walk (${shady.gateHops} vs ${open.gateHops})`);
  assert(shady.shade > open.shade + 0.4, `and one much shadier than the other (${shady.shade} vs ${open.shade})`);
  const rng = makeRng(12);
  const { guests } = spawnGuests(400, rng);
  const r = walkGuests(s, guests, rng);
  assert(r.served.shade > 0, 'somebody found shade on a hot block');
  const firstBlockId = TIME_BLOCKS.map(b => b.id).find(id => Object.keys(r.arrivalsByBlock[id]).length > 0);
  const firstBlock = TIME_BLOCKS.find(b => b.id === firstBlockId);
  assert(firstBlock && firstBlock.heat >= 0.85, `the walk out to the spur lands the crowd in a hot block (${firstBlockId} at heat ${firstBlock && firstBlock.heat})`);
  const arriving = r.arrivalsByBlock[firstBlockId];
  assert((arriving['11_5'] || 0) > 300 && !arriving['9_5'], `on the block they arrive, the crowd chose the grove stall over the open one (${arriving['11_5'] || 0} vs ${arriving['9_5'] || 0})`);
  assert(r.arrivals['9_5'] > 0, 'the open stall still fed the second meal, once the grove stall was a place they had already been');
}

// --- a purse is a limit: a craft stall a guest cannot afford pulls nothing ---
{
  const s = grounds([stall('4_3', 'vendor', 4, 3, 'vend_glass')]);
  const price = VENDORS.find(v => v.id === 'vend_glass').avgTicket;
  const rng = makeRng(13);
  const { guests } = spawnGuests(100, rng);
  for (const g of guests) g.budget = price - 1;
  const r = walkGuests(s, guests, rng);
  assert(r.steps === 0 && r.buyers['4_3'] === 0 && r.spent === 0, 'a crowd that cannot afford the only stall stays at the gate and buys nothing');
  const rng2 = makeRng(13);
  const { guests: rich } = spawnGuests(100, rng2);
  for (const g of rich) g.budget = price;
  const r2 = walkGuests(s, rich, rng2);
  assert(r2.buyers['4_3'] === 100 && r2.spent === 100 * price && rich.every(g => g.budget === 0), 'a crowd with exactly the ticket buys once each and is broke');
  assert(r2.arrivals['4_3'] === 100, 'and does not come back to a stall it can no longer afford');
}

// --- a guest who ate is not hungry, however much appetite is left ---
{
  // At the shipped satisfyRate one meal takes any table appetite below the
  // half-need line, so "never ate" and "still wants food" agree on every
  // real crowd. This crowd is hungrier than the table allows, so that they
  // disagree, and the meal count is the one that has to win.
  const s = grounds([stall('1_3', 'food', 1, 3, 'vend_stew')]);
  const rng = makeRng(14);
  const { guests } = spawnGuests(100, rng);
  // A purse for exactly one meal, so the second one they still want is
  // one they cannot buy.
  const price = VENDORS.find(v => v.id === 'vend_stew').avgTicket;
  for (const g of guests) { g.archetype = 'family'; g.needs = { food: 2, spectacle: 0, shade: 0, spend: 0 }; g.budget = price; }
  const r = walkGuests(s, guests, rng);
  assert(guests.every(g => g.meals > 0 && g.needs.food > 0.5), 'the test needs everyone fed and still wanting food');
  assert(r.hungry === 0, 'nobody who ate went home hungry');
}

// ---------------------------------------------------------------------
// Section 7: the seam — simulateDay reads the walk
// ---------------------------------------------------------------------
{
  const s = grounds([stage('3_0', 3, 0), stall('6_3', 'food', 6, 3, 'vend_cider')], { midday: { '3_0': 'perf_jouster_1' } });
  s.roster = ['perf_jouster_1']; s.hiredVendors = ['vend_cider'];
  const r = simulateDay(s, 4242);
  assert(r.guests && typeof r.guests.sampled === 'number', 'the day report carries a guests block');
  assert(r.guests.sampled === Math.min(r.attendance, GUESTS.sampleCap), 'the sample is attendance up to the cap');
  assert(Math.abs(r.guests.represents - r.attendance / r.guests.sampled) < 0.01, 'represents is attendance over sample');
  assert(r.guests.offGrid === 0, 'nobody off-grid on a real day');
  assert(r.guests.watched > 0 && r.guests.ate > 0, 'on a stage-and-stall grounds people watched and ate');
  assert(r.guests.watched <= r.attendance * TIME_BLOCKS.length && r.guests.ate <= r.attendance * TIME_BLOCKS.length, 'scaled counts never exceed one arrival per guest per block');
  for (const k of ['ate', 'watched', 'bought', 'shaded', 'hungry', 'unspent', 'spent', 'steps', 'idle']) {
    assert(Number.isFinite(r.guests[k]) && r.guests[k] >= 0, `guests.${k} is a finite non-negative number`);
  }
  assert(JSON.stringify(simulateDay(s, 4242).guests) === JSON.stringify(r.guests), 'the walk survives a re-simulation of the same seed unchanged (#45)');
  assert(JSON.stringify(simulateDay(s, 4243).guests) !== JSON.stringify(r.guests), 'and a different seed walks a different day');
  assert(!r.warnings.some(w => w.includes('find a way')), 'no unreachable warning when everything fronts the artery');

  const cut = grounds([stage('3_0', 3, 0), stall('4_4', 'food', 4, 4, 'vend_cider')]);
  cut.hiredVendors = ['vend_cider'];
  const rc = simulateDay(cut, 4242);
  assert(rc.guests.unreachable.length === 1 && rc.guests.unreachable[0] === '4_4', 'the report names the unreachable stall');
  assert(rc.warnings.some(w => w.includes('find a way') && w.includes('food 4_4')), 'and the day warns about it by name');
  assert(rc.warnings.some(w => w.includes('went home hungry')), 'and says the crowd went hungry');
  assert(rc.guests.ate === 0, 'a stall nobody can reach fed nobody');
}

// --- the walk's rng is its own: existing seeds still roll the events they did ---
{
  // Computed against the Stage 22 engine (git HEAD before this phase) for
  // seeds 101..4040 on this exact state. If the walk ever draws from the
  // day's own rng instead of its derived stream, every roll after the
  // attendance jitter shifts and this fingerprint moves.
  const before = ["-","-","-","-","-","evt_rowdy_crowd","-","-","-","-","-","evt_wagon_wheel","-","evt_perfect_weather","-","-","evt_perfect_weather","-","evt_noble_visit","-","evt_wagon_wheel","-","-","evt_noble_visit","evt_perfect_weather","evt_dropped_prop","evt_perfect_weather","evt_dropped_prop","-","evt_wagon_wheel","evt_perfect_weather","-","evt_wagon_wheel","-","-","evt_rowdy_crowd","-","evt_perfect_weather","evt_dropped_prop","evt_wagon_wheel"];
  const base = { day: 1, season: 1, cash: 20000, reputation: 55, ticketPrice: 16, builtPlots: [stage('3_0', 3, 0)], roster: ['perf_jester_1'], hiredVendors: ['vend_cider'], schedule: { midday: { '3_0': 'perf_jester_1' } }, contracts: {}, vendorContracts: {}, activeCampaign: null, campaignCooldowns: {}, history: [] };
  const after = [];
  for (let seed = 1; seed <= 40; seed++) after.push(simulateDay(base, seed * 101).events.map(e => e.id || e.effectId).join('+') || '-');
  assert(JSON.stringify(after) === JSON.stringify(before), 'forty seeds roll exactly the events they rolled before the crowd could walk');
}

// ---------------------------------------------------------------------
// Section 8: the report on the page
// ---------------------------------------------------------------------
{
  const s = grounds([stage('3_0', 3, 0), stall('6_3', 'food', 6, 3, 'vend_cider')]);
  s.hiredVendors = ['vend_cider'];
  const r = simulateDay(s, 77);
  const html = renderReport(s, r);
  assert(html.includes('Where the crowd went') && html.includes(`${r.guests.watched.toLocaleString()}</b> watched a show`) && html.includes(`${r.guests.ate.toLocaleString()}</b> ate`), 'the ticket stub says where the crowd went, with the report\'s own numbers');
  const old = { ...r }; delete old.guests;
  assert(!renderReport(s, old).includes('Where the crowd went'), 'a report from before this phase (an old save\'s history) renders no crowd line rather than zeros');
}

// ---------------------------------------------------------------------
// Section 9: a 30-day run through the state layer
// ---------------------------------------------------------------------
{
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 3, 0).state;
  s = State.buildPlot(s, 'food', 6, 3).state;
  s = State.contractPerformer(s, 'perf_jouster_1').state;
  s = State.hireVendor(s, 'vend_cider').state;
  s = State.assignSchedule(s, 'midday', '3_0', 'perf_jouster_1').state;
  let ok = true, walked = 0;
  for (let i = 0; i < 30; i++) {
    const { state: next, result } = State.runDay(s, i * 17 + 3);
    if (!result.guests || result.guests.offGrid !== 0) ok = false;
    for (const v of Object.values(result.guests)) if (typeof v === 'number' && !Number.isFinite(v)) ok = false;
    walked += result.guests.steps;
    s = State.nextDay(next).state;
    if (s.phase === 'victory') s = State.acknowledgeVictory(s).state;
    if (s.phase === 'weekendEnd') s = State.startNextWeekend(s).state;
    if (s.phase === 'gameOver') break;
  }
  assert(ok, '30 days through runDay: a guests block on every report, nobody off-grid, no NaN');
  assert(walked > 0, 'and the crowd actually walked');
  assert(s.history.every(h => h.guests && !('positions' in h.guests) && !('guests' in h.guests)), 'history carries aggregates only — no guest records survive the day');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
