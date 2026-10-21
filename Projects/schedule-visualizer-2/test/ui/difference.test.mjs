// The difference map's plain functions (SV2-69, SV2-69b): the strength rule
// and its five bands, the two tints and their contrast on the corridor and
// on the stairs in both themes (read from ui/tokens.css), zero changes and
// exclusion zones left unpainted (through a canvas that records what is
// drawn), the strengths taken from painted cells only, every day type
// together, the ten largest changes with ties, groups apart, the card's
// walks against engine/load.js contributors and that a later card only
// looks its cell up, and the card's words with typed names. The map in a
// page is test/browser/difference.mjs.
//
//   node test/ui/difference.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { strengthOf, tintOf, differenceOf, differenceWords, rankPlaces, apartGroups, differenceOverlay, DIFFERENCE_ALPHA, DIFFERENCE_STRENGTHS, DIFFERENCE_TOP } from '../../ui/surface/overlays/difference.js';
import { apart } from '../../ui/surface/overlays/evacuation.js';
import { whenWords, sidesWords, cardText, apartLabel, cardWalks, groupsAt } from '../../ui/scenarios/difference.js';
import { contrast, mix } from '../../ui/colour.js';
import { sampleSchool } from '../../data/sample-school.js';
import { buildGraph } from '../../engine/graph.js';
import { createPipeline, scenarioRun } from '../../engine/worker.js';
import { loadDifference, applyChanges, editedGroupIds } from '../../engine/scenario.js';
import { contributors } from '../../engine/load.js';
import { routingGraph, routesForSchedule } from '../../engine/routing.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- the themes, as ui/tokens.css has them: the light block first, then
// the dark one, then the dark one again for "auto" under the media query
function tokens() {
  const css = fs.readFileSync(path.join(TOOL, 'ui', 'tokens.css'), 'utf8');
  const values = (name) => Array.from(css.matchAll(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g')), (m) => m[1].toLowerCase());
  const out = { light: {}, dark: {} };
  for (const name of ['problem', 'accent', 'corridor', 'stairs']) {
    const found = values(name);
    assert.equal(found.length, 3, name + ': three values in tokens.css (light, dark, auto dark), found ' + found.length);
    assert.equal(found[2], found[1], name + ': the auto dark block is the dark one');
    out.light[name] = found[0];
    out.dark[name] = found[1];
  }
  return out;
}
const THEMES = tokens();

// ---- the sample school worked out before and after a scenario
const MOVE = { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' };
// on B Day: 6A's Periods 1 and 4 swapped
const SWAP_B = { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample06a', periodA: 0, periodB: 3 };

function worked(changes, shape) {
  const project = sampleSchool();
  if (shape) shape(project);
  const pipeline = createPipeline();
  const before = pipeline.run(project, { geometry: 1, building: 1, schedule: 1 });
  const scenario = { ...project, scenario: { name: 'Try', changes, compared: null } };
  const after = scenarioRun(createPipeline({ cache: pipeline.cache }), scenario, { geometry: 1, building: 1, schedule: 2 });
  return { project, graph: buildGraph(project), before, after };
}

// a canvas context that records every rectangle filled, with its colour and opacity
function recorder() {
  const fills = [];
  const g = { globalAlpha: 1, fillStyle: '#000000', save() {}, restore() {}, fillRect(x, y, w, h) { fills.push({ x, y, w, h, alpha: this.globalAlpha, colour: this.fillStyle }); } };
  return { g, fills };
}

// every floor drawn whole at 10 px a cell from the top left
function paintAll(world, overlay, theme) {
  const out = new Map();
  for (const floor of world.project.building.floors) {
    const { g, fills } = recorder();
    overlay(g, { x: 0, y: 0, size: 10, width: floor.width * 10, height: floor.height * 10 }, floor, theme);
    out.set(floor.id, fills.map((fill) => ({ ...fill, cell: Math.floor(fill.y / 10) * floor.width + Math.floor(fill.x / 10) })));
  }
  return out;
}

// ---- the strength rule

test('the strength is the fifth of the largest change a change reaches, rounded up: five bands, none for no change', () => {
  assert.equal(DIFFERENCE_STRENGTHS, 5);
  assert.equal(DIFFERENCE_ALPHA.length, 5);
  // against a largest of 10: 1 and 2 are the first fifth, 9 and 10 the last
  const bands = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => strengthOf(d, 10));
  assert.deepEqual(bands, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  // quieter is measured by its size the same way
  assert.deepEqual([-1, -3, -10].map((d) => strengthOf(d, 10)), [1, 2, 5]);
  // a change of 1 against a largest of 27 still shows, at the weakest
  assert.equal(strengthOf(1, 27), 1);
  assert.equal(strengthOf(-27, 27), 5);
  // nothing changing anywhere paints nothing; a change past the largest (one in a zone) is the strongest, never a sixth
  assert.equal(strengthOf(5, 0), 0);
  assert.equal(strengthOf(40, 27), 5);
});

test('busier is the problem colour and quieter the accent, at the strength\'s opacity over the corridor; no change has no tint', () => {
  for (const theme of Object.values(THEMES)) {
    for (let s = 1; s <= 5; s += 1) {
      assert.equal(tintOf(4, s, theme), mix(theme.problem, theme.corridor, DIFFERENCE_ALPHA[s - 1]));
      assert.equal(tintOf(-4, s, theme), mix(theme.accent, theme.corridor, DIFFERENCE_ALPHA[s - 1]));
    }
    assert.equal(tintOf(0, 3, theme), null);
    assert.equal(tintOf(4, 0, theme), null);
  }
});

// Over the corridor and over the stairs colour: a stairs cell (a landing) is
// painted too. The measured figures are of 2026-10-19's tokens.
const UNDER = {
  // weakest 1.26 to 1.37, steps 1.29 or more, strongest 4.43 or more; busier and quieter 0.042 apart at the weakest
  corridor: { apart: 0.04 },
  // weakest 1.24 to 1.37, steps 1.26 or more, strongest 3.78 or more; busier and quieter 0.037 apart at the weakest (dark)
  stairs: { apart: 0.035 },
};
for (const [name, theme] of Object.entries(THEMES)) {
  for (const [under, held] of Object.entries(UNDER)) {
    test('the ' + name + ' theme over the ' + under + ' ' + theme[under] + ': both tints\' five strengths each show, each is told from the one under it, the strongest is 3:1, and busier is told from quieter', () => {
      const base = theme[under];
      for (const kind of ['problem', 'accent']) {
        const ratios = DIFFERENCE_ALPHA.map((alpha) => contrast(mix(theme[kind], base, alpha), base));
        const said = kind + ' over ' + under + ' ' + ratios.map((r) => r.toFixed(2)).join(', ');
        // the weakest still shows
        assert.ok(ratios[0] >= 1.2, said);
        // each strength is at least a quarter again the one under it
        for (let i = 1; i < ratios.length; i += 1) assert.ok(ratios[i] >= ratios[i - 1] * 1.25, said + ': strength ' + (i + 1) + ' against ' + i);
        // the strongest meets WCAG 1.4.11 for a graphic, 3:1
        assert.ok(ratios[4] >= 3, said);
      }
      // the same strength busier and quieter differ in hue, not only in name
      for (let s = 1; s <= 5; s += 1) {
        const d = apart(mix(theme.problem, base, DIFFERENCE_ALPHA[s - 1]), mix(theme.accent, base, DIFFERENCE_ALPHA[s - 1]));
        assert.ok(d >= held.apart, under + ', strength ' + s + ': busier and quieter are ' + d.toFixed(3) + ' apart in OKLab');
      }
    });
  }
}

// ---- the difference from two results

test('one day type: the deltas are loadDifference\'s, before and after are the loads compared, and after less before is the delta at every cell', () => {
  const w = worked([MOVE]);
  const a = w.before.loads.find((load) => load.dayTypeId === 'dsample00a');
  const b = w.after.loads.find((load) => load.dayTypeId === 'dsample00a');
  for (const transition of [null, 1, 2]) {
    const d = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a', transition });
    const engine = loadDifference(a, b, { transition });
    assert.deepEqual(Array.from(d.cells), Array.from(engine.cells));
    assert.deepEqual(Array.from(d.connections), Array.from(engine.connections));
    // the largest is the cells' (what is painted), which here is the engine's too
    let cellsLargest = 0;
    for (let i = 0; i < d.cells.length; i += 1) if (!d.excluded[i]) cellsLargest = Math.max(cellsLargest, Math.abs(d.cells[i]));
    assert.equal(d.largest, cellsLargest);
    assert.equal(d.largest, engine.largest);
    assert.deepEqual(d.dayTypeIds, ['dsample00a']);
    for (let i = 0; i < d.cells.length; i += 1) assert.equal(d.after.cells[i] - d.before.cells[i], d.cells[i], 'node ' + i);
    // the loads compared are the ones the transition picks
    const picked = transition === null ? b.cells.busiest : b.cells.byTransition[transition];
    assert.deepEqual(Array.from(d.after.cells), Array.from(picked));
  }
  assert.equal(differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'nope' }), null);
  assert.equal(differenceOf([], [], {}), null);
});

test('the transition chosen changes the picture: the move is busier in one place in one transition and quieter in others in the next', () => {
  const w = worked([MOVE]);
  const signs = (transition) => {
    const d = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a', transition });
    return { busier: d.cells.filter((x) => x > 0).length, quieter: d.cells.filter((x) => x < 0).length };
  };
  // Period 2 to 3 the group walks to Room 101 instead of the Library; Period 3 to 4 it walks back from there
  assert.deepEqual(signs(1), { busier: 31, quieter: 0 });
  assert.deepEqual(signs(2), { busier: 6, quieter: 25 });
  assert.deepEqual(signs(0), { busier: 0, quieter: 0 });
  assert.deepEqual(signs(null), { busier: 14, quieter: 2 });
});

test('every day type: each cell shows the day whose change there is largest, and says which day that is', () => {
  const w = worked([MOVE, SWAP_B]);
  const both = differenceOf(w.before.loads, w.after.loads, { dayTypeId: null, transition: null });
  const a = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a', transition: null });
  const b = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00b', transition: null });
  assert.deepEqual(both.dayTypeIds, ['dsample00a', 'dsample00b']);
  assert.equal(both.largest, Math.max(a.largest, b.largest));
  let fromB = 0;
  for (let i = 0; i < both.cells.length; i += 1) {
    const wantB = Math.abs(b.cells[i]) > Math.abs(a.cells[i]);
    assert.equal(both.cells[i], wantB ? b.cells[i] : a.cells[i], 'node ' + i);
    assert.equal(both.dayTypeIds[both.dayOfCell[i]], wantB ? 'dsample00b' : 'dsample00a', 'node ' + i);
    assert.equal(both.before.cells[i], wantB ? b.before.cells[i] : a.before.cells[i]);
    if (wantB) fromB += 1;
  }
  // the B Day swap moves loads where A Day's move does not: some cells come from B Day
  assert.ok(fromB > 0, 'no cell took B Day');
});

// ---- the painting

test('the overlay paints every cell that changes, in its tint at its strength, and no cell whose change is zero', () => {
  const w = worked([MOVE]);
  const difference = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a', transition: 2 });
  const overlay = differenceOverlay(() => ({ difference, graph: w.graph }));
  for (const [name, theme] of Object.entries(THEMES)) {
    const painted = paintAll({ project: w.project }, overlay, theme);
    let count = 0;
    for (const [floorId, fills] of painted) {
      const f = w.graph.floorIndex.get(floorId);
      for (const fill of fills) {
        const node = w.graph.floors[f].nodeOfCell[fill.cell];
        const delta = difference.cells[node];
        assert.notEqual(delta, 0, name + ': painted a cell with no change');
        assert.equal(fill.colour, delta > 0 ? theme.problem : theme.accent);
        assert.equal(fill.alpha, DIFFERENCE_ALPHA[strengthOf(delta, difference.largest) - 1]);
        // inset inside its cell, so the edge between cells (a wall) is not covered
        assert.ok(fill.x % 10 >= 1 && fill.x % 10 + fill.w <= 9, 'inset: ' + JSON.stringify(fill));
        count += 1;
      }
    }
    assert.equal(count, difference.cells.filter((x) => x !== 0).length, name + ': every changed cell painted once');
  }
});

test('an exclusion zone is never painted, nor counted for the largest change or the table', () => {
  // a zone over the start of Floor 1's Main Corridor, where the move is busiest
  const shape = (project) => project.building.zones.push({ id: 'zdiffzone1', floorId: 'fsample001', label: 'Leave out', x: 3, y: 7, w: 8, h: 1 });
  const open = worked([MOVE]);
  const shut = worked([MOVE], shape);
  const d = differenceOf(shut.before.loads, shut.after.loads, { dayTypeId: 'dsample00a', transition: null });
  const free = differenceOf(open.before.loads, open.after.loads, { dayTypeId: 'dsample00a', transition: null });
  const zoned = [];
  for (let i = 0; i < d.cells.length; i += 1) if (d.excluded[i] && d.cells[i] !== 0) zoned.push(i);
  assert.ok(zoned.length > 0, 'the zone covers changed cells');
  // the largest is what is left outside the zone
  let outside = 0;
  for (let i = 0; i < d.cells.length; i += 1) if (!d.excluded[i]) outside = Math.max(outside, Math.abs(d.cells[i]));
  assert.equal(d.largest, outside);
  assert.ok(free.largest >= d.largest);
  const painted = paintAll({ project: shut.project }, differenceOverlay(() => ({ difference: d, graph: shut.graph })), THEMES.light);
  const fills = painted.get('fsample001');
  const f = shut.graph.floorIndex.get('fsample001');
  for (const fill of fills) assert.equal(d.excluded[shut.graph.floors[f].nodeOfCell[fill.cell]], 0, 'painted a cell in the zone');
  // and the table's rows take no member in the zone
  const ranked = rankPlaces(d, shut.after.places);
  for (const row of ranked.rows) if (row.node !== null) assert.equal(d.excluded[row.node], 0, row.name);
});

test('a graph of another size than the difference is not painted, and nothing is painted with no difference', () => {
  const w = worked([MOVE]);
  const difference = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a' });
  const other = { ...w.graph, count: w.graph.count + 1 };
  assert.equal(paintAll({ project: w.project }, differenceOverlay(() => ({ difference, graph: other })), THEMES.light).get('fsample001').length, 0);
  assert.equal(paintAll({ project: w.project }, differenceOverlay(() => null), THEMES.light).get('fsample001').length, 0);
});

// two loads of one day type over three cells and one stairs connection, the
// connection's change (12) larger than any cell's (at most 4)
function loadOf(cells, links) {
  const c = Int32Array.from(cells);
  const l = Int32Array.from(links);
  return { dayTypeId: 'dA', unit: 'students', cells: { busiest: c, total: c, byTransition: [c] }, connections: { busiest: l, total: l, byTransition: [l] }, excluded: new Uint8Array(cells.length), excludedConnections: new Uint8Array(links.length) };
}

test('the strengths and the key\'s largest are of the painted cells: a stairs connection changing more is in the table, not in the scale', () => {
  const before = loadOf([10, 10, 10], [2]);
  const after = loadOf([14, 8, 10], [14]);
  const d = differenceOf([before], [after], { dayTypeId: 'dA', transition: null });
  assert.equal(loadDifference(before, after).largest, 12, 'the engine\'s largest takes the connection');
  assert.equal(d.largest, 4, 'the map\'s largest is the largest cell change');
  // the strongest painted cell is strength 5, so the map shows what the key says
  assert.equal(strengthOf(d.cells[0], d.largest), 5);
  // the connection is still the table's first row, with its own figures
  const places = { places: [
    { id: 'stretch', kind: 'stretch', name: 'Run', parts: [], floorId: 'f1', nodes: [0, 1, 2] },
    { id: 'stairs', kind: 'connection', name: 'Stairs A', parts: [], floorId: 'f1', floorIds: ['f1', 'f2'], nodes: [], link: 0 },
  ] };
  assert.deepEqual(rankPlaces(d, places).rows.map((row) => [row.placeId, row.delta]), [['stairs', 12], ['stretch', 4]]);
});

// ---- the card's walks

// MOVE and SWAP_B on the sample school, as the card works them out and as
// contributors counts the same walks
function walksOfSample() {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const changes = [MOVE, SWAP_B];
  const walks = cardWalks(project, changes, graph);
  const edited = new Set(editedGroupIds(changes));
  const only = (whole) => ({ ...whole, groups: whole.groups.filter((group) => edited.has(group.id)) });
  const routing = routingGraph(project, graph);
  const after = applyChanges(project, changes);
  return { project, graph, walks, sides: { before: { project, routes: routesForSchedule(only(project), routing) }, after: { project: after, routes: routesForSchedule(only(after), routing) } } };
}

test('the card\'s walks say who crosses every cell, day and transition as engine/load.js contributors does, the groups apart in the list\'s order', () => {
  const { project, graph, walks, sides } = walksOfSample();
  const order = new Map(project.groups.map((group, i) => [group.id, i]));
  const who = (side, node, day, t) => contributors(side.project, side.routes, day, { nodes: [node] }, graph, t === null ? undefined : { period: t }).map((each) => each.groupId).sort((a, b) => order.get(a) - order.get(b));
  let apartSeen = 0;
  for (const day of ['dsample00a', 'dsample00b']) {
    for (const t of [null, 0, 1, 2, 3, 4, 5]) {
      for (let node = 0; node < graph.count; node += 1) {
        const want = apartGroups(who(sides.before, node, day, t), who(sides.after, node, day, t));
        assert.deepEqual(groupsAt(walks, node, day, t), want, day + ', transition ' + t + ', node ' + node);
        if (want.onlyBefore.length + want.onlyAfter.length > 0) apartSeen += 1;
      }
    }
  }
  // enough to mean something: the move and the swap put groups apart on many cells
  assert.ok(apartSeen > 100, 'cells with a group apart: ' + apartSeen);
  // no change that edits a group, nobody walks anywhere else
  assert.equal(cardWalks(project, [], graph), null);
  assert.deepEqual(groupsAt(null, 0, 'dsample00a', null), { onlyBefore: [], onlyAfter: [] });
});

// A later card only looks its cell up. groupsAt is handed walks whose day
// and cell maps count their gets and throw on any iteration, set, delete or
// clear: each call may get its day and its cell once a side, and read that
// one cell's groups, so it neither walks every cell nor builds or changes
// the index. Its answers are the same as on the plain walks. What that costs
// on the big fixture is test/timing/difference-card.mjs.
function watched(map, counts, inner) {
  const out = new Map(Array.from(map, ([key, value]) => [key, inner ? inner(value) : value]));
  const refuse = (what) => () => { throw new Error('groupsAt ' + what + ' a map of the index'); };
  const get = out.get.bind(out);
  return Object.assign(out, {
    get(key) { counts.gets += 1; return get(key); },
    has: refuse('asked has of'), set: refuse('set'), delete: refuse('deleted from'), clear: refuse('cleared'),
    keys: refuse('iterated'), values: refuse('iterated'), entries: refuse('iterated'), forEach: refuse('iterated'),
    [Symbol.iterator]: refuse('iterated'),
  });
}

test('a later card looks its cell up and nothing else: one get of its day and one of its cell a side, no walk over the cells, no change to the index', () => {
  const { graph, walks } = walksOfSample();
  const counts = { gets: 0 };
  const side = (byDay) => watched(byDay, counts, (nodes) => watched(nodes, counts));
  const seen = { order: walks.order, before: side(walks.before), after: side(walks.after) };
  let calls = 0;
  let apartSeen = 0;
  for (const day of ['dsample00a', 'dsample00b', 'no-such-day']) {
    for (const t of [null, 2]) {
      for (let node = 0; node < graph.count; node += 1) {
        const before = counts.gets;
        const got = groupsAt(seen, node, day, t);
        calls += 1;
        assert.ok(counts.gets - before <= 4, day + ', node ' + node + ': ' + (counts.gets - before) + ' gets');
        assert.deepEqual(got, groupsAt(walks, node, day, t), day + ', transition ' + t + ', node ' + node);
        if (got.onlyBefore.length + got.onlyAfter.length > 0) apartSeen += 1;
      }
    }
  }
  assert.ok(apartSeen > 10, 'cells with a group apart: ' + apartSeen);
  assert.ok(counts.gets <= calls * 4, counts.gets + ' gets for ' + calls + ' cards');
});

// ---- words and the table

test('the change in words: "14 busier", "9 quieter", "no change"', () => {
  assert.equal(differenceWords(14), '14 busier');
  assert.equal(differenceWords(-9), '9 quieter');
  assert.equal(differenceWords(0), 'no change');
});

// twelve one-cell places and their changes, for the ranking
function synthetic(deltas, excluded) {
  const n = deltas.length;
  const difference = {
    cells: Int32Array.from(deltas),
    connections: new Int32Array(0),
    before: { cells: Int32Array.from(deltas.map(() => 50)), connections: new Int32Array(0) },
    after: { cells: Int32Array.from(deltas.map((d) => 50 + d)), connections: new Int32Array(0) },
    dayOfCell: new Uint8Array(n),
    dayOfConnection: new Uint8Array(0),
    dayTypeIds: ['dA'],
    excluded: Uint8Array.from(excluded || deltas.map(() => 0)),
    excludedConnections: new Uint8Array(0),
  };
  const places = { places: deltas.map((d, i) => ({ id: 'p' + i, kind: 'stretch', name: 'Place ' + i, parts: [{ text: 'Place ' + i }], floorId: 'f1', nodes: [i] })) };
  return { difference, places };
}

test('the table is the ten largest changes, largest first by size, busier and quieter alike, ties in the order of the places', () => {
  //                          p0  p1 p2  p3 p4  p5 p6 p7  p8 p9 p10 p11 p12
  const { difference, places } = synthetic([3, -9, 0, 9, 5, -5, 1, 7, -7, 2, -2, 4, 1]);
  const ranked = rankPlaces(difference, places);
  assert.equal(DIFFERENCE_TOP, 10);
  assert.equal(ranked.changed, 12, 'every place with a change, the zero left out');
  assert.equal(ranked.rows.length, 10);
  assert.deepEqual(ranked.rows.map((row) => row.placeId), ['p1', 'p3', 'p7', 'p8', 'p4', 'p5', 'p11', 'p0', 'p9', 'p10']);
  assert.deepEqual(ranked.rows.map((row) => row.delta), [-9, 9, 7, -7, 5, -5, 4, 3, 2, -2]);
  assert.deepEqual(ranked.rows.slice(0, 2).map((row) => [row.before, row.after]), [[50, 41], [50, 59]]);
  // p6 and p12 tie at 1 for the eleventh row: both are out, and fewer rows are all there are
  assert.deepEqual(rankPlaces(difference, places, 12).rows.slice(10).map((row) => row.placeId), ['p6', 'p12']);
  assert.equal(rankPlaces(difference, places, 3).rows.length, 3);
});

test('a place takes its member with the largest change, the first on a tie, and leaves out a member in a zone', () => {
  const { difference } = synthetic([2, -6, 6, 9]);
  difference.excluded[3] = 1;
  const places = { places: [{ id: 'run', kind: 'stretch', name: 'Run', parts: [], floorId: 'f1', nodes: [0, 1, 2, 3] }] };
  const [row] = rankPlaces(difference, places).rows;
  assert.equal(row.node, 1);
  assert.equal(row.delta, -6);
  assert.deepEqual(row.parts, [{ text: 'Run' }]);
  assert.deepEqual(rankPlaces(null, places), { rows: [], changed: 0 });
});

test('on the sample school the table names corridors and stairs by place, with their floors', () => {
  const w = worked([MOVE]);
  const d = differenceOf(w.before.loads, w.after.loads, { dayTypeId: 'dsample00a', transition: null });
  const ranked = rankPlaces(d, w.after.places);
  assert.ok(ranked.rows.length > 0 && ranked.rows.length <= 10);
  // the first row is the largest change (here a cell's, the map's largest)
  assert.equal(ranked.rows[0].delta, d.largest, 'the first row is the largest change');
  for (const row of ranked.rows) {
    assert.ok(row.parts.length > 0 && row.parts.every((part) => typeof part.text === 'string'));
    assert.ok(row.floorIds.length >= 1);
    assert.equal(row.after - row.before, row.delta);
  }
  // the stairs between Floors 1 and 2 are a place of their own, on both floors
  const stairs = ranked.rows.find((row) => row.link !== null);
  assert.ok(stairs, 'a connection among the rows');
  assert.deepEqual(stairs.floorIds, ['fsample001', 'fsample002']);
});

test('groups apart: who walks a cell only before and only after, each in its list\'s order', () => {
  assert.deepEqual(apartGroups(['g1', 'g2', 'g3'], ['g3', 'g4', 'g1']), { onlyBefore: ['g2'], onlyAfter: ['g4'] });
  assert.deepEqual(apartGroups([], ['g4', 'g5']), { onlyBefore: [], onlyAfter: ['g4', 'g5'] });
  assert.deepEqual(apartGroups(['g1'], ['g1']), { onlyBefore: [], onlyAfter: [] });
});

// ---- the card's words

const HOSTILE = '<img src=x onerror="alert(1)">&amp;';
const ARABIC = 'الممر الشمالي';

test('the card\'s words: the place and floor as typed, corridor or stairs, the change, before and after with the unit, when, and the groups apart over the day or in the transition', () => {
  const project = sampleSchool();
  assert.equal(whenWords(project, null, 'dsample00a'), 'at its busiest in one transition, on A Day');
  assert.equal(whenWords(project, 2, 'dsample00b'), 'in Period 3 to Period 4, on B Day');
  assert.equal(whenWords(project, 2, 'gone'), 'in Period 3 to Period 4');
  const info = {
    parts: [{ text: ARABIC, name: true }, { text: ', by ' }, { text: HOSTILE, name: true }],
    floorName: 'Étage 2 "<b>"',
    words: differenceWords(14),
    before: 12,
    after: 26,
    unit: 'students',
    when: whenWords(project, null, 'dsample00a'),
    transition: null,
    stairs: false,
    excluded: false,
    groups: { onlyBefore: [{ id: 'g1', name: HOSTILE }], onlyAfter: [{ id: 'g2', name: '七年一班' }, { id: 'g3', name: '8B' }] },
  };
  assert.equal(sidesWords(info), 'Before 12, after 26 students, at its busiest in one transition, on A Day.');
  // the whole day: the groups are counted over the day, and the words say so
  assert.equal(cardText(info), ARABIC + ', by ' + HOSTILE + ', Étage 2 "<b>", corridor: 14 busier. Before 12, after 26 students, at its busiest in one transition, on A Day. Over the day, walk here only before: ' + HOSTILE + '. Over the day, walk here only after: 七年一班, 8B.');
  // one transition: the groups are of that transition, the figures' own
  const one = { ...info, when: whenWords(project, 2, 'dsample00a'), transition: 2, stairs: true };
  assert.equal(cardText(one), ARABIC + ', by ' + HOSTILE + ', Étage 2 "<b>", stairs: 14 busier. Before 12, after 26 students, in Period 3 to Period 4, on A Day. Walk here only before: ' + HOSTILE + '. Walk here only after: 七年一班, 8B.');
  assert.equal(apartLabel('after', null), 'Over the day, walk here only after: ');
  assert.equal(apartLabel('before', 0), 'Walk here only before: ');
  // one group, no zone, nothing apart
  const quiet = { ...info, words: differenceWords(-1), before: 2, after: 1, unit: 'groups', excluded: true, groups: { onlyBefore: [], onlyAfter: [] } };
  assert.equal(cardText(quiet), ARABIC + ', by ' + HOSTILE + ', Étage 2 "<b>", corridor: 1 quieter. Before 2, after 1 group, at its busiest in one transition, on A Day. In an exclusion zone.');
  assert.equal(cardText({ ...quiet, groups: null }), cardText(quiet));
});

// SV2-72d item 9: the day type each cell's change is from is kept in an
// array wide enough for every day type; a Uint8Array wrapped past 256 and
// named the wrong day type.
test('SV2-72d: every day type together names the right day type past 256 day types', () => {
  const n = 300;
  const load = (dayTypeId, value) => ({
    dayTypeId,
    unit: 'students',
    cells: { busiest: Int32Array.of(value, 0), total: Int32Array.of(value, 0), byTransition: [] },
    connections: { busiest: Int32Array.of(value), total: Int32Array.of(value), byTransition: [] },
    excluded: new Uint8Array(2),
    excludedConnections: new Uint8Array(1),
  });
  const before = [];
  const after = [];
  // the change grows with the day type, so the last one's is largest
  for (let i = 0; i < n; i += 1) {
    before.push(load('d' + i, 0));
    after.push(load('d' + i, i + 1));
  }
  const found = differenceOf(before, after, { dayTypeId: null });
  assert.equal(found.dayTypeIds.length, n);
  assert.equal(found.cells[0], n);
  assert.equal(found.dayTypeIds[found.dayOfCell[0]], 'd' + (n - 1), 'the cell names the day type its change is from');
  assert.equal(found.dayTypeIds[found.dayOfConnection[0]], 'd' + (n - 1), 'and so does the connection');
  const places = { places: [{ id: 'p1', kind: 'run', name: 'Hall', nodes: [0, 1], floorId: 'f1' }] };
  assert.equal(rankPlaces(found, places).rows[0].dayTypeId, 'd' + (n - 1), 'the table names it too');
});
