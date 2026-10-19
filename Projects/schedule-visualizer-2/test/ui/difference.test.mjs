// The difference map's plain functions (SV2-69): the strength rule and its
// five bands, the two tints and their contrast on the corridor in both
// themes (read from ui/tokens.css), zero changes and exclusion zones left
// unpainted (through a canvas that records what is drawn), every day type
// together, the ten largest changes with ties, groups apart, and the card's
// words with typed names. The map in a page is test/browser/difference.mjs.
//
//   node test/ui/difference.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { strengthOf, tintOf, differenceOf, differenceWords, rankPlaces, apartGroups, differenceOverlay, DIFFERENCE_ALPHA, DIFFERENCE_STRENGTHS, DIFFERENCE_TOP } from '../../ui/surface/overlays/difference.js';
import { apart } from '../../ui/surface/overlays/evacuation.js';
import { whenWords, sidesWords, cardText } from '../../ui/scenarios/difference.js';
import { contrast, mix } from '../../ui/colour.js';
import { sampleSchool } from '../../data/sample-school.js';
import { buildGraph } from '../../engine/graph.js';
import { createPipeline, scenarioRun } from '../../engine/worker.js';
import { loadDifference } from '../../engine/scenario.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- the themes, as ui/tokens.css has them: the light block first, then
// the dark one, then the dark one again for "auto" under the media query
function tokens() {
  const css = fs.readFileSync(path.join(TOOL, 'ui', 'tokens.css'), 'utf8');
  const values = (name) => Array.from(css.matchAll(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g')), (m) => m[1].toLowerCase());
  const out = { light: {}, dark: {} };
  for (const name of ['problem', 'accent', 'corridor']) {
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

for (const [name, theme] of Object.entries(THEMES)) {
  test('the ' + name + ' theme: both tints\' five strengths against the corridor ' + theme.corridor + ': each shows, each is told from the one under it, the strongest is 3:1, and busier is told from quieter', () => {
    for (const kind of ['problem', 'accent']) {
      const ratios = DIFFERENCE_ALPHA.map((alpha) => contrast(mix(theme[kind], theme.corridor, alpha), theme.corridor));
      const said = kind + ' ' + ratios.map((r) => r.toFixed(2)).join(', ');
      // the weakest still shows on a corridor (measured 1.26 to 1.37)
      assert.ok(ratios[0] >= 1.2, said);
      // each strength is at least a quarter again the one under it (measured 1.29 or more)
      for (let i = 1; i < ratios.length; i += 1) assert.ok(ratios[i] >= ratios[i - 1] * 1.25, said + ': strength ' + (i + 1) + ' against ' + i);
      // the strongest meets WCAG 1.4.11 for a graphic, 3:1 (measured 4.43 or more)
      assert.ok(ratios[4] >= 3, said);
    }
    // the same strength busier and quieter differ in hue, not only in name (measured 0.051 at the weakest)
    for (let s = 1; s <= 5; s += 1) {
      const d = apart(tintOf(1, s, theme), tintOf(-1, s, theme));
      assert.ok(d >= 0.04, 'strength ' + s + ': busier and quieter are ' + d.toFixed(3) + ' apart in OKLab');
    }
  });
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

test('the card\'s words: the place and floor as typed, the change, before and after with the unit, when, and the groups apart', () => {
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
    excluded: false,
    groups: { onlyBefore: [{ id: 'g1', name: HOSTILE }], onlyAfter: [{ id: 'g2', name: '七年一班' }, { id: 'g3', name: '8B' }] },
  };
  assert.equal(sidesWords(info), 'Before 12, after 26 students, at its busiest in one transition, on A Day.');
  assert.equal(cardText(info), ARABIC + ', by ' + HOSTILE + ', Étage 2 "<b>": 14 busier. Before 12, after 26 students, at its busiest in one transition, on A Day. Walk here only before: ' + HOSTILE + '. Walk here only after: 七年一班, 8B.');
  // one group, no zone, nothing apart
  const quiet = { ...info, words: differenceWords(-1), before: 2, after: 1, unit: 'groups', excluded: true, groups: { onlyBefore: [], onlyAfter: [] } };
  assert.equal(cardText(quiet), ARABIC + ', by ' + HOSTILE + ', Étage 2 "<b>": 1 quieter. Before 2, after 1 group, at its busiest in one transition, on A Day. In an exclusion zone.');
  assert.equal(cardText({ ...quiet, groups: null }), cardText(quiet));
});
