// Dead ends and split stairwells (SV2-135; ARCHITECTURE 22.6, 22.17; DESIGN
// 16.12 item 6): `deadEnds` on small hand-drawn plans, the two findings with
// their sentences, ids and thresholds, and Join the parts as the fix. Plain
// Node: every plan is drawn as text in test/fixtures/buildings/plans.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingChecks, deadEnds, DEAD_END_CELLS } from '../../engine/building-checks.js';
import { joinStairwell } from '../../engine/stairwells.js';
import { stairwells } from '../../engine/schema.js';
import { ctx, clone } from './helpers.mjs';
import { planProject, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);
const only = (project, kind) => buildingChecks(project).filter((finding) => finding.kind === kind);
// a hall's own two ends are dead ends unless they are exits, so every plan with a nine-wide hall marks both
const exits = [[1, 0, 2, 'West Door'], [1, 8, 2, 'East Door']];
const cellsOf = (project, number, points) => points.map(([x, y]) => y * project.building.floors[number - 1].width + x);

// a nine-wide hall along row 2, as the base of most plans
const HALL = '#########';

test('an L stub off a hall is one dead end: every cell from the far end to the cell before the junction', () => {
  const project = planProject([['.........', '.........', HALL, '....#....', '....#....', '....###..', '......#..']], { exits });
  const found = deadEnds(project);
  assert.equal(found.length, 1);
  assert.equal(found[0].floorId, F1);
  assert.equal(found[0].length, 6);
  assert.equal(found[0].end, cellsOf(project, 1, [[6, 6]])[0]);
  assert.equal(found[0].first, cellsOf(project, 1, [[4, 3]])[0], 'named by the cell next to the junction');
  assert.equal(found[0].junction, cellsOf(project, 1, [[4, 2]])[0]);
  assert.deepEqual(found[0].cells.slice().sort((a, b) => a - b), cellsOf(project, 1, [[4, 3], [4, 4], [4, 5], [5, 5], [6, 5], [6, 6]]));
  assert.deepEqual(found[0].roomIds, []);
  const findings = only(project, 'dead-end');
  assert.deepEqual(findings.map((finding) => [finding.severity, finding.id]), [['warning', 'dead-end:' + F1 + ':' + found[0].first]]);
  assert.equal(findings[0].text, 'A dead end on Floor 1 off a corridor at row 3, column 5 goes nowhere: 6 cells that lead to no room, stair or exit. A slip in the drawing?');
  assert.deepEqual(findings[0].where, { floorId: F1, cells: found[0].cells.slice().sort((a, b) => a - b), roomIds: [] });
  assert.equal(findings[0].fixable, false);
});

test('a one-cell stub is "1 cell that leads", and a named junction corridor is the "off", as typed', () => {
  const project = planProject([['.........', '.........', HALL, '....#....']], { exits });
  project.building.floors[0].corridors.push({ id: 'kplan00001', name: 'North <b>Corridor</b>', cells: cellsOf(project, 1, [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2]]) });
  const [finding] = only(project, 'dead-end');
  assert.equal(finding.text, 'A dead end on Floor 1 off North <b>Corridor</b> goes nowhere: 1 cell that leads to no room, stair or exit. A slip in the drawing?', 'the name is as typed, and one cell leads');
});

test('a two-wide hall makes no end, whatever its length', () => {
  const project = planProject([['..........', '##########', '##########']], { exits: [[1, 0, 1, 'West Door']] });
  assert.deepEqual(deadEnds(project), []);
  assert.deepEqual(only(project, 'dead-end'), []);
});

test('an isolated line is not a dead end: its two ends meet, and part-unreachable says the rest', () => {
  const project = planProject([['.........', '.........', HALL, '.........', '.........', '.#####...']], { exits });
  assert.deepEqual(deadEnds(project), []);
  assert.deepEqual(only(project, 'dead-end'), []);
  assert.equal(only(project, 'part-unreachable').length, 1, 'the covering check still sees it');
});

test('a stub that ends on an exit is not a dead end', () => {
  const project = planProject([['.........', '.........', HALL, '....#....', '....#....']], { exits: exits.concat([[1, 4, 4, 'South Door']]) });
  assert.deepEqual(deadEnds(project), []);
});

test('a stub that ends on stairs, or on a lift stop, is not a dead end', () => {
  const stairs = planProject([['.........', '.........', HALL, '....#....', '....S....']], { exits });
  assert.deepEqual(deadEnds(stairs), [], 'stairs at the end');
  const lift = planProject([['.........', '.........', HALL, '....#....', '....S....']], { exits });
  lift.building.floors[0].lifts = [4 * lift.building.floors[0].width + 4];
  assert.deepEqual(deadEnds(lift), [], 'a lift stop at the end');
  // a line that starts at stairs and stops short is one: the stairs stop the run as a junction
  const beyond = planProject([['.........', '.........', HALL, '....S....', '....#....', '....#....']], { exits });
  const found = deadEnds(beyond);
  assert.equal(found.length, 1);
  assert.equal(found[0].length, 2);
  assert.equal(found[0].junction, 3 * beyond.building.floors[0].width + 4, 'the stairs cell is the junction');
});

test('a short dead end that serves a room is a door\'s nook and says nothing; the same stub with nothing beside it is a warning', () => {
  const nook = planProject([['.........', '.........', HALL, '..#......', '..#......', '.AA......']], { exits });
  // the stub is column 2, rows 3 to 4; room 1A touches its end cell from the south
  const found = deadEnds(nook);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].roomIds, [roomId('1A')]);
  assert.deepEqual(only(nook, 'dead-end'), []);
  const bare = planProject([['.........', '.........', HALL, '..#......', '..#......']], { exits });
  assert.deepEqual(only(bare, 'dead-end').map((finding) => finding.severity), ['warning']);
});

test('a stub on the building\'s edge is a dead end whatever "no exit" says', () => {
  const rows = ['....#....', '....#....', HALL, '.........', '.........'];
  const withExit = planProject([rows], { exits });
  const without = planProject([rows]);
  for (const project of [withExit, without]) {
    const [finding] = only(project, 'dead-end');
    assert.equal(finding.severity, 'warning');
    assert.match(finding.text, /^A dead end on Floor 1 off a corridor at row 3, column 5 goes nowhere: 2 cells /);
  }
  assert.equal(only(without, 'no-exit').length, 1, 'no-exit speaks too, separately');
  assert.equal(only(withExit, 'no-exit').length, 0);
});

// a stub 9 cells long with a room beside its far end, off a hall
function longStub(cells) {
  const rows = ['.........', '.........', HALL];
  for (let i = 0; i < cells; i += 1) rows.push('....#....');
  rows[rows.length - 1] = '....#AA..';
  rows.push('......AA.');
  return planProject([rows], { exits });
}

test('a long dead end that serves a room is a note: past 6 cells with no scale, and the code\'s variation said', () => {
  assert.equal(DEAD_END_CELLS, 6);
  assert.deepEqual(only(longStub(6), 'dead-end'), [], '6 cells is allowed');
  const [note] = only(longStub(7), 'dead-end');
  assert.equal(note.severity, 'note');
  assert.equal(note.text, 'A dead end on Floor 1 off a corridor at row 3, column 5 is 7 cells long and serves room 1A. Many fire codes limit dead-end corridors, often to about 20 feet; check your local code.');
  assert.deepEqual(note.where.roomIds, [roomId('1A')]);
});

test('with a cell scale the limit is 20 feet (6.1 metres) and the length is said in the scale\'s unit', () => {
  const scaled = (cells, unit, length) => {
    const project = longStub(cells);
    project.settings.cellScale = { unit, length };
    return only(project, 'dead-end');
  };
  const [feet] = scaled(9, 'feet', 3);
  assert.equal(feet.severity, 'note');
  assert.equal(feet.text, 'A dead end on Floor 1 off a corridor at row 3, column 5 is 9 cells long (about 27 feet) and serves room 1A. Many fire codes limit dead-end corridors, often to about 20 feet; check your local code.');
  assert.deepEqual(scaled(9, 'feet', 2), [], '9 cells at 2 feet is 18 feet: allowed, though it is over 6 cells');
  assert.deepEqual(scaled(7, 'feet', 20 / 7), [], 'exactly 20 feet is allowed');
  assert.equal(scaled(7, 'feet', 3)[0].text.includes('(about 21 feet)'), true);
  const [metres] = scaled(9, 'metres', 0.9);
  assert.equal(metres.text, 'A dead end on Floor 1 off a corridor at row 3, column 5 is 9 cells long (about 8 metres) and serves room 1A. Many fire codes limit dead-end corridors, often to about 6 metres; check your local code.');
  assert.deepEqual(scaled(9, 'metres', 0.6), [], '5.4 metres is under 6.1');
  assert.equal(scaled(10, 'metres', 0.61).length, 0, '6.1 metres exactly is allowed');
  assert.equal(scaled(10, 'metres', 0.62).length, 1);
  // a stub that serves nothing is a warning whatever the scale says
  const nothing = planProject([['.........', '.........', HALL, '....#....']], { exits });
  nothing.settings.cellScale = { unit: 'metres', length: 0.1 };
  assert.deepEqual(only(nothing, 'dead-end').map((finding) => finding.severity), ['warning']);
});

test('the id names the cell next to the junction, so lengthening the far end keeps an accepted finding', () => {
  const [short] = only(longStub(8), 'dead-end');
  const [long] = only(longStub(9), 'dead-end');
  assert.equal(short.id, long.id);
  assert.match(short.id, new RegExp('^dead-end:' + F1 + ':\\d+$'));
  assert.equal(only(longStub(8), 'dead-end')[0].id, short.id, 'the same tomorrow');
});

// ------------------------------------------------------------ split stairwells

function fiveFloors() {
  const floor = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  const project = planProject([floor, floor, floor, floor, floor], { connections: [[1, 0, 2, 2, 0, 2], [4, 0, 2, 5, 0, 2]], exits: [[1, 6, 2, 'Main Door']] });
  for (const connection of project.building.connections) connection.well = 'A';
  return project;
}

test('a stairwell in two parts is a warning with the fix, and a whole one says nothing', () => {
  const project = fiveFloors();
  assert.equal(stairwells(project.building)[0].parts, 2);
  const [finding] = only(project, 'stairwell-split');
  assert.equal(finding.id, 'stairwell-split:A');
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.fixable, true);
  assert.equal(finding.text, 'Stairwell A is in 2 parts: Floor 1 to Floor 2, and Floor 4 to Floor 5. Join the parts, or split the stairwell.');
  assert.equal(finding.where.floorId, floorId(1));
  assert.equal(finding.where.well, 'A');
  assert.deepEqual(finding.where.cells, [2 * 7]);
  assert.deepEqual(finding.where.floors.map((entry) => entry.floorId), [floorId(1), floorId(4)]);
  const whole = clone(project);
  whole.building.connections.push({ id: 'cplan00003', label: 'B', well: 'A', a: { floorId: floorId(2), cell: 14 }, b: { floorId: floorId(4), cell: 14 }, direction: 'both' });
  assert.deepEqual(only(whole, 'stairwell-split'), []);
  assert.deepEqual(only(fiveFloors(), 'stairwell-split').map((each) => each.kind), ['stairwell-split']);
});

test('a well in three parts lists all three, the name as typed', () => {
  const project = fiveFloors();
  project.building.connections.push({ id: 'cplan00003', label: 'C', well: 'A', a: { floorId: floorId(2), cell: 14 }, b: { floorId: floorId(3), cell: 14 }, direction: 'both' });
  project.building.connections[0].a = { floorId: floorId(1), cell: 14 };
  // floors 1-2 and 2-3 now touch at floor 2's stop? keep them apart: move the first flight to floor 1 and a cell on floor 2 nobody else uses
  project.building.connections[0].b = { floorId: floorId(2), cell: 0 };
  project.building.floors[1].name = 'Ground <i>';
  const [finding] = only(project, 'stairwell-split');
  assert.equal(finding.text, 'Stairwell A is in 3 parts: Floor 1 to Ground <i>, Ground <i> to Floor 3, and Floor 4 to Floor 5. Join the parts, or split the stairwell.');
});

test('Join the parts: the action puts one flight between the closest stops, and the finding goes', () => {
  const project = fiveFloors();
  const after = joinStairwell(project, { well: 'A' }, ctx(5));
  assert.equal(stairwells(after.building)[0].parts, 1);
  assert.deepEqual(only(after, 'stairwell-split'), []);
  const added = after.building.connections.filter((connection) => !project.building.connections.some((old) => old.id === connection.id));
  assert.equal(added.length, 1);
  assert.deepEqual([added[0].a.floorId, added[0].b.floorId].sort(), [floorId(2), floorId(4)], 'the closest stops of the two parts by level: Floor 2 and Floor 4');
  assert.equal(added[0].well, 'A');
});

test('the sample and the small plans have neither new finding', () => {
  const quiet = planProject([['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......']], { exits: [[1, 6, 2, 'Main Door']] });
  assert.deepEqual(buildingChecks(quiet).filter((finding) => finding.kind === 'dead-end' || finding.kind === 'stairwell-split'), []);
});
