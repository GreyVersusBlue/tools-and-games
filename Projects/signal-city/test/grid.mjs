// node test/grid.mjs
//
// The grid (M9, first increment): the generator in js/grid.js, the cells a
// Network is built from (network.js buildCells), and a World running a grid
// of boxes joined both ways, north-south as well as east-west. Exits
// non-zero on any FAIL (#13). Imports through pathToFileURL (Windows rule).

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(HERE, '..', 'js', f)).href);
const { World } = await load('sim.js');
const { Network, buildNodes } = await load('network.js');
const { growCells, gridLevel, GRID_SPACING } = await load('grid.js');

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);
const f1 = x => (+x).toFixed(1);
const where = cells => cells.map(c => c.at.join(',') + (c.roundabout ? 'o' : '') + (c.legs.length < 4 ? 'T' : '')).join(' ');
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/* ------------------------------------------------------------ the generator -- */

group('the generator: a district grown one box at a time');

{
  const a = growCells(7, 12), b = growCells(7, 12), c = growCells(8, 12);
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same seed grows the same district', where(a));
  ok(JSON.stringify(a) !== JSON.stringify(c), 'and another seed another one', where(c));
  // the property endless stands on: day n's boxes are day n+1's first n
  let prefix = true, firstBad = '';
  for (let seed = 1; seed <= 20 && prefix; seed++) {
    const full = JSON.stringify(growCells(seed, 12));
    for (let n = 1; n < 12; n++) {
      const part = JSON.stringify(growCells(seed, n));
      if (full.slice(0, part.length - 1) !== part.slice(0, -1)) { prefix = false; firstBad = `seed ${seed}, ${n} boxes`; break; }
    }
  }
  ok(prefix, 'on twenty seeds, the first n boxes are the same whatever count is asked for', firstBad);

  let inBounds = true, adjacent = true, teeOut = true, firstSignal = true, rings = 0, tees = 0, demandOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    const cells = growCells(seed, 12);
    const seen = new Set();
    cells.forEach((cell, i) => {
      const [c, r] = cell.at;
      if (c < 0 || c >= 4 || r < 0 || r >= 3) inBounds = false;
      if (i > 0 && !Object.values(STEP).some(([dc, dr]) => seen.has((c + dc) + ',' + (r + dr)))) adjacent = false;
      seen.add(c + ',' + r);
      if (i === 0 && cell.roundabout) firstSignal = false;
      if (cell.roundabout) rings++;
      if (cell.legs.length < 4) {
        tees++;
        const miss = ['N', 'E', 'S', 'W'].find(l => !cell.legs.includes(l));
        const [nc, nr] = [c + STEP[miss][0], r + STEP[miss][1]];
        if (nc >= 0 && nc < 4 && nr >= 0 && nr < 3) teeOut = false;
      }
      for (const l of cell.legs) if (!(cell.demand[l] >= 150 && cell.demand[l] <= 260)) demandOk = false;
    });
    if (seen.size !== 12) inBounds = false;
  }
  ok(inBounds, 'on forty seeds, twelve boxes fill the 4 by 3 district, one to a cell');
  ok(adjacent, 'every box after the first stands next to one already built');
  ok(firstSignal, 'the first box is always a signal');
  ok(teeOut, 'a T only ever drops a leg that faces out of the district', `${tees} Ts in 480 boxes`);
  ok(rings > 40 && rings < 150 && tees > 20, 'and both rings and Ts turn up', `${rings} rings, ${tees} Ts`);
  ok(demandOk, 'every leg has 150 to 260 vehicles an hour');
  let threw = null;
  try { growCells(1, 13); } catch (e) { threw = e.message; }
  ok(threw && /1 to 12/.test(threw), 'a thirteenth box in a 4 by 3 district is refused', threw);
  // a whole district of twelve builds: every cell's legs meet its neighbours'
  let built = true, err = '';
  for (let seed = 1; seed <= 40; seed++) {
    try { buildNodes(gridLevel(seed, 12).network); } catch (e) { built = false; err = `seed ${seed}: ${e.message}`; break; }
  }
  ok(built, 'on forty seeds the full district builds, every joined pair of legs on one line', err);
}

/* --------------------------------------------------------------- the cells -- */

group('the cells: a Network per cell, joined both ways');

{
  const nodes = buildNodes({ cells: [{ at: [0, 0] }, { at: [1, 0] }, { at: [0, 1], legs: ['N', 'E', 'S'] }, { at: [1, 1], roundabout: true }], spacing: 220 });
  ok(nodes.map(n => n.origin.join(',')).join(' ') === '0,0 220,0 0,220 220,220', 'each cell stands at its column and row times the spacing, unshifted', nodes.map(n => n.origin.join(',')).join(' '));
  ok(nodes.map(n => n.spawnLegs.join('')).join(' ') === 'NW NE S ES', 'the legs that face another box spawn nothing', nodes.map(n => n.spawnLegs.join('')).join(' '));
  const down = nodes[0].pathFor('N', 0, 'T');
  ok(down.link && down.link.node === 2 && down.link.entry === 'N' && down.link.atS === 0, 'N-T at the first box links south onto the box below', JSON.stringify(down.link));
  ok(nodes[2].pathFor('W', 0, 'T') === null && nodes[2].pathFor('N', 0, 'R') === null, 'the T has no west leg, and no path in or out by one');
  const left = nodes[3].pathFor('E', 0, 'R');
  ok(left.link && left.link.node === 1 && left.link.entry === 'S', 'a right from the ring\'s east leg goes north into the box above', JSON.stringify(left.link));
  ok(nodes[2].roundabout === false && nodes[3].roundabout === true && nodes[2].legs.join('') === 'NES', 'and each cell keeps its own spec');
  let threw = null;
  try { buildNodes({ cells: [{ at: [0, 0] }, { at: [1, 0], legs: ['N', 'E', 'S'] }] }); } catch (e) { threw = e.message; }
  ok(threw && /runs into node 1/.test(threw), 'a leg facing a box with no leg back is refused', threw);
  threw = null;
  try { buildNodes({ cells: [{ at: [0, 0] }, { at: [1, 0], lanesPerDir: 2 }] }); } catch (e) { threw = e.message; }
  ok(threw && /1 and 2 lanes/.test(threw), 'two joined boxes with different lane counts are refused', threw);
  threw = null;
  try { buildNodes({ cells: [{ at: [0, 0] }, { at: [0, 0] }] }); } catch (e) { threw = e.message; }
  ok(threw && /two nodes/.test(threw), 'two boxes on one cell are refused', threw);
  // the corridor did not move: nodes: 2 is still centred on the origin
  const corr = buildNodes({ nodes: 2, spacing: 220 });
  ok(corr[0].origin[0] === -110 && corr[1].origin[0] === 110, 'and a corridor is built as before', corr.map(n => n.origin.join(',')).join(' '));
}

{
  // the crossing cache is keyed by path, and two boxes share path keys: a
  // box with two lanes asked after a box with one must not get the first
  // box's answer back (#602)
  const nodes = buildNodes({ cells: [{ at: [0, 0] }, { at: [2, 0], lanesPerDir: 2 }] });
  const [a0, b0] = [nodes[0].pathFor('W', 0, 'T'), nodes[0].pathFor('N', 0, 'T')];
  const [a1, b1] = [nodes[1].pathFor('W', 0, 'T'), nodes[1].pathFor('N', 0, 'T')];
  const one = nodes[0].crossing(a0, b0);
  const two = nodes[0].crossing(a1, b1);
  const fresh = new Network({ lanesPerDir: 2, origin: nodes[1].origin, node: 1 }).crossing(a1, b1);
  ok(Math.abs(two.sA - fresh.sA) < 1e-9 && Math.abs(two.sB - fresh.sB) < 1e-9 && Math.abs(two.sA - one.sA) > 1, 'the crossing of two paths is theirs, whichever box is asked', `one lane ${f1(one.sA)}/${f1(one.sB)}, two lanes ${f1(two.sA)}/${f1(two.sB)}, fresh ${f1(fresh.sA)}/${f1(fresh.sB)}`);
}

/* --------------------------------------------------------------- the world -- */

group('the world on a grid: handed on south as well as east');

{
  // two boxes one above the other, both green north-south: a car from the
  // north goes straight down through both and off the map
  const L = { network: { cells: [{ at: [0, 0] }, { at: [0, 1] }] }, demand: [], duration: 600, turns: { T: 1 }, controller: { startPhase: 0, timing: { yellow: 3, allRed: 1, minGreen: 1 } } };
  const w = new World(L, 1);
  const c = w.spawnCar({ leg: 'N', archetype: 'standard', turn: 'T', node: 0 });
  let jump = 0, handedAt = -1;
  for (let i = 0; i < 60 * 60 && !c.done; i++) {
    const before = c.path.at(c.s), node = c.path.node;
    w.step();
    if (c.done) break;
    const after = c.path.at(c.s);
    const d = Math.hypot(after.x - before.x, after.y - before.y);
    if (d > c.v / 60 + 0.05) jump = Math.max(jump, d);
    if (node === 0 && c.path.node === 1) handedAt = w.t;
  }
  ok(handedAt > 0 && jump < 0.01, 'it is handed to the box below with no jump in position', `at ${f1(handedAt)} s, ${jump.toFixed(3)} m`);
  ok(c.done && w.stats.cleared === 1 && w.stats.handoffs === 1, 'and leaves by the lower box\'s south leg', `cleared ${w.stats.cleared}, handoffs ${w.stats.handoffs}`);
}

{
  // four boxes, every one of them a signal cycling on its own rule
  const L = gridLevel(3, 4, { ring: 0, tee: 0 });
  const a = new World(L, 3);
  const across = { EW: 0, NS: 0 };
  const byNode = new Set();
  for (let i = 0; i < 180 * 60; i++) {
    a.step();
    for (const e of a.events) if (e.kind === 'handoff') { const entry = e.to[0]; across[entry === 'E' || entry === 'W' ? 'EW' : 'NS']++; }
    a.events.length = 0;
    for (const car of a.cars) if (!car.done) byNode.add(car.path.node);
  }
  const b = new World(L, 3).run(180);
  ok(a.hash() === b.hash(), 'a grid run is a function of its seed', `${a.hash()} ${b.hash()}`);
  ok(across.EW > 5 && across.NS > 5, 'cars are handed on across both streets', `${across.EW} east-west, ${across.NS} north-south`);
  ok(byNode.size === 4, 'and every box has had traffic', [...byNode].sort().join(''));
  let finite = true;
  for (const car of a.cars) if (!Number.isFinite(car.s) || !Number.isFinite(car.v)) finite = false;
  ok(finite && a.stats.cleared > 40, 'cars leave the map and every one still on it is a finite number', `${a.stats.cleared} cleared, ${a.stats.collisions} collisions`);
}

{
  // a tourist's wrong turn at the second box picks from the second box's
  // paths. It once read world.network (box one) whatever box the car was
  // at, and jumped the car 220 m onto the first box's geometry (#603).
  const L = { network: { cells: [{ at: [0, 0] }, { at: [1, 0] }] }, demand: [], duration: 600, controller: { startPhase: 0 } };
  const w = new World(L, 2);
  const c = w.spawnCar({ leg: 'N', archetype: 'tourist', turn: 'T', node: 1 });
  c.stats = { ...c.stats, wrongTurn: 1, hesitate: 0 };
  const before = c.path;
  let moved = 0, prev = c.path.at(c.s);
  while (!c.wrongTurnDone && w.t < 30) {
    w.step();
    const p = c.path.at(c.s);
    moved = Math.max(moved, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  ok(c.wrongTurnDone && c.path !== before, 'a tourist sure to turn wrong does, fourteen metres out', `${before.movement} to ${c.path.movement}`);
  ok(c.path.node === 1 && w.nodes[1].choicesFrom('N', 0).includes(c.path), 'onto a path at the box it is approaching', `node ${c.path.node}`);
  ok(moved < 1, 'without moving more than a step\'s worth', `${f1(moved)} m`);
}

{
  // the full district runs: twelve boxes, rings and Ts
  const L = gridLevel(5, 12, { duration: 90 });
  const w = new World(L, 5).run(90);
  ok(w.nodes.length === 12 && w.controllers.length === 12 && w.stats.spawned > 60, 'twelve boxes, twelve controllers, traffic arriving on the district\'s edge', `${where(growCells(5, 12))}; ${w.stats.spawned} spawned, ${w.stats.handoffs} handoffs`);
  ok(w.nodes.filter(n => n.roundabout).every(n => w.controllers[n.node].stage === 'dark'), 'and every ring\'s controller is dark');
  ok(GRID_SPACING === 220, 'two 110 m legs laid end to end');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
