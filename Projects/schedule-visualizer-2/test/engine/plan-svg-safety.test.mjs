// planSvg's options for the safety prints (SV2-108): routes, refGrid,
// highlightCells, exitMarks and marker; PRINT_EXIT_COLOURS; and ui/prints/routes.js.
// Plain Node, no clock, no browser.
//
//   node test/engine/plan-svg-safety.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { planSvg, planStyleText, textEms, PRINT_EXIT_COLOURS, printExitColour, gridSquare, columnLetters } from '../../ui/prints/plan-svg.js';
import { runsOf, waysOnFloor } from '../../ui/prints/routes.js';
import { runsOf as overlayRunsOf } from '../../ui/surface/overlays/evacuation.js';
import { esc } from '../../ui/prints/document.js';
import { evacuationRoutes } from '../../engine/evacuation.js';
import { routingGraph } from '../../engine/routing.js';
import { planProject } from '../fixtures/buildings/plans.mjs';
import { school } from './helpers.mjs';

const count = (text, piece) => text.split(piece).length - 1;
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// ---- nothing new asked for: nothing new drawn

// The sample school's three floors, drawn before these options existed:
// the first 16 hex digits of the SHA-256 of planSvg's svg with no options,
// with `route`, with `crop`, and with both. Re-record only for a change that
// is meant to move a picture of the sample (the route is the one the sample's
// first room on the floor takes; written out so a routing change cannot move it).
const WINDOW = { x: 2, y: 2, width: 12, height: 9 };
const PINS = {
  fsample001: { route: { cells: [283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 340, 380, 420, 460, 500, 540], start: 243, exit: 540 }, plain: '6126a6016a866e29', withRoute: '8c5d1efe35aa4e75', withCrop: 'e167fa8158e831ae', both: 'd4f03975c606b258' },
  fsample002: { route: { cells: [283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 332], start: 243, exit: 332 }, plain: 'c10d53aaa195e142', withRoute: '6c5502cdbc78a2a1', withCrop: 'c9eac85f995a2c99', both: '877cb807f3f9611e' },
  fsample003: { route: { cells: [284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 353], start: 244, exit: 353 }, plain: '3a3494077ea40b11', withRoute: '9e43334980aa3345', withCrop: '71c9332f58fc5d80', both: '85ffbd7d3d0ec326' },
};

test('with none of the new options every sample floor is drawn byte for byte as before, with and without route and crop', () => {
  const project = school();
  assert.deepEqual(project.building.floors.map((floor) => floor.id), Object.keys(PINS));
  for (const floor of project.building.floors) {
    const pin = PINS[floor.id];
    assert.equal(sha(planSvg(project, floor).svg), pin.plain, floor.name + ' plain');
    assert.equal(sha(planSvg(project, floor, { route: pin.route }).svg), pin.withRoute, floor.name + ' with route');
    assert.equal(sha(planSvg(project, floor, { crop: WINDOW }).svg), pin.withCrop, floor.name + ' with crop');
    assert.equal(sha(planSvg(project, floor, { crop: WINDOW, route: pin.route }).svg), pin.both, floor.name + ' with both');
    // an empty or false option is not an option
    const idle = planSvg(project, floor, { routes: undefined, refGrid: false, highlightCells: [], exitMarks: [], marker: null });
    assert.equal(sha(idle.svg), pin.plain, floor.name + ' idle options');
    assert.equal('grid' in idle || 'labelCells' in idle, false);
  }
});

// ---- the colours

test('PRINT_EXIT_COLOURS are eight, and the ninth exit wears the first colour again', () => {
  assert.equal(PRINT_EXIT_COLOURS.length, 8);
  assert.equal(new Set(PRINT_EXIT_COLOURS).size, 8);
  for (let i = 0; i < 24; i += 1) assert.equal(printExitColour(i), PRINT_EXIT_COLOURS[i % 8]);
  assert.equal(printExitColour(8), printExitColour(0));
  assert.equal(printExitColour(-1), PRINT_EXIT_COLOURS[0], 'a bad index is the first colour, never undefined');
  assert.equal(printExitColour(NaN), PRINT_EXIT_COLOURS[0]);
});

// ---- the drawings

//   0123456789
// 0 ..........
// 1 ..AAB.....
// 2 ..AAB.....
// 3 .#########
// 4 ..S.......
const FLOOR = ['..........', '..AAB.....', '..AAB.....', '.#########', '..S.......'];
const ids = (project) => project.building.floors[0].exits.map((exit) => exit.id);
function small(extra) {
  return planProject([FLOOR], { doors: { '1A': [[2, 2, 's']] }, exits: [[1, 9, 3, 'East Door']], ...(extra || {}) });
}
const at = (x, y) => y * 10 + x;
// a corridor with a room above and below it, so its east end opens outside on the east
const EAST = ['AAAAA', '#####', 'BBBBB', '.....', '.....'];

test('routes: each way is a line in its colour under its badge; a faint way is grey at 30 % with no band, mark or colour', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, {
    routes: [
      { cells: [at(1, 3), at(2, 3), at(3, 3)], start: at(2, 2), exit: null, number: 2, faint: true },
      { cells: [at(2, 3), at(3, 3), at(4, 3), at(5, 3)], start: at(2, 2), exit: at(9, 3), colour: '#255ebc', number: 1 },
    ],
  });
  assert.equal(count(plan.svg, '<g class="plan__ways">'), 1);
  assert.equal(count(plan.svg, 'class="plan__way-band"'), 1, 'a band under the coloured way only');
  assert.equal(count(plan.svg, 'class="plan__way-line"'), 2);
  assert.equal(count(plan.svg, 'class="plan__way-line" stroke="#1f2328" stroke-opacity="0.3"'), 1);
  assert.equal(count(plan.svg, 'class="plan__way-line" stroke="#255ebc"'), 1);
  assert.equal(count(plan.svg, 'class="plan__way-start"'), 1, 'a faint way has no start mark');
  // the order given is the order drawn: the faint way first
  assert.ok(plan.svg.indexOf('stroke-opacity="0.3"') < plan.svg.indexOf('stroke="#255ebc"'));
  // the coloured way's badge at its exit, the faint way's at none (it ends on another floor)
  assert.equal(count(plan.svg, 'class="plan__badge-number"'), 1);
  assert.ok(plan.svg.includes('>1</text>'));
  assert.equal(count(plan.svg, 'stroke="#255ebc"/>'), 1, 'one badge ring in the way\'s colour');
});

test('routes: a badge sits at the exit and where the way meets stairs, once for two ways with the same number, side by side for two numbers', () => {
  const project = small();
  const floor = project.building.floors[0];
  const stairs = at(2, 4);
  const way = (number, colour, extra) => ({ cells: [stairs, at(2, 3), at(3, 3)], start: null, exit: at(9, 3), number, colour, ...(extra || {}) });
  const one = planSvg(project, floor, { routes: [way(1, '#255ebc'), way(1, '#255ebc')] });
  // the exit and the stairs cell: two badges, not four
  assert.equal(count(one.svg, 'class="plan__badge"'), 2);
  const two = planSvg(project, floor, { routes: [way(1, '#255ebc'), way(2, '#005700')] });
  assert.equal(count(two.svg, 'class="plan__badge"'), 4, 'two numbers, two cells');
  const xs = Array.from(two.svg.matchAll(/class="plan__badge" cx="([\d.]+)" cy="([\d.]+)"/g)).map((m) => Number(m[1]));
  const atExit = xs.filter((x) => x > 150);
  assert.equal(atExit.length, 2);
  assert.ok(Math.abs(atExit[0] - atExit[1]) >= 11, 'the badges at the exit do not overlap: ' + atExit);
  // no number, no badge
  assert.equal(count(planSvg(project, floor, { routes: [way(undefined, '#255ebc')] }).svg, 'plan__badge'), 0);
});

test('routes: a colour not given comes from the number (past eight it wraps); one that is not a colour is not written', () => {
  const project = small();
  const floor = project.building.floors[0];
  const draw = (route) => planSvg(project, floor, { routes: [{ cells: [at(2, 3), at(3, 3)], ...route }] }).svg;
  assert.ok(draw({ number: 3 }).includes('class="plan__way-line" stroke="' + PRINT_EXIT_COLOURS[2] + '"'));
  assert.ok(draw({ number: 9 }).includes('class="plan__way-line" stroke="' + PRINT_EXIT_COLOURS[0] + '"'), 'the ninth is the first again');
  assert.ok(draw({}).includes('class="plan__way-line" stroke="#1f2328"'), 'no number, no colour: the ink');
  const hostile = draw({ number: 1, colour: '#fff" onload="alert(1)' });
  assert.equal(count(hostile, 'onload'), 0);
  assert.ok(hostile.includes('stroke="' + PRINT_EXIT_COLOURS[0] + '"'));
});

test('routes: like route, they draw plain stair marks and put corridor names on a halo; the one-way chevrons stay for a plan with neither', () => {
  const project = planProject([FLOOR, FLOOR.map((row) => row)], { connections: [[1, 2, 4, 2, 2, 4]] });
  project.building.connections[0].direction = 'ab';
  project.building.floors[0].corridors.push({ id: 'cor00000001', name: 'Main', cells: [at(1, 3), at(2, 3), at(3, 3), at(4, 3)] });
  const floor = project.building.floors[0];
  assert.equal(count(planSvg(project, floor).svg, 'plan__oneway'), 1);
  assert.equal(count(planSvg(project, floor).svg, 'paint-order'), 0);
  const many = planSvg(project, floor, { routes: [] });
  assert.equal(count(many.svg, 'plan__oneway'), 0);
  assert.equal(count(many.svg, 'paint-order="stroke"'), 1);
  assert.equal(count(planSvg(project, floor, { route: { cells: [at(2, 3)] } }).svg, 'plan__oneway'), 0);
  // the corridor's name is over the ways
  const withWay = planSvg(project, floor, { routes: [{ cells: [at(1, 3), at(2, 3)], number: 1 }] }).svg;
  assert.ok(withWay.indexOf('class="plan__ways"') < withWay.indexOf('class="plan__corridor-name"'));
});

test('routes: cells that are not on the floor are left out, as for route', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { routes: [{ cells: [-1, 999, 1.5, 'x', null], start: 500, exit: 500, number: 1 }, null, 'nonsense'] });
  assert.equal(count(plan.svg, 'plan__way-line'), 0);
  assert.equal(count(plan.svg, 'plan__badge'), 0);
});

test('highlightCells: a band in the accent at 25 % over the corridor and under the rooms and labels', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { highlightCells: [at(2, 3), at(3, 3), at(3, 3), 9999, 'x'] });
  assert.equal(count(plan.svg, 'class="plan__highlight"'), 1);
  assert.ok(plan.svg.includes('<path class="plan__highlight" d="M40 60h40v20h-40z"/>'), 'two cells, once each, one run');
  assert.ok(plan.svg.indexOf('plan__highlight') > plan.svg.indexOf('plan__corridor'));
  assert.ok(plan.svg.indexOf('plan__highlight') < plan.svg.indexOf('plan__wall'));
  assert.ok(plan.svg.indexOf('plan__highlight') < plan.svg.indexOf('plan__space'));
  // in a window, only the cells in it
  const window = planSvg(project, floor, { highlightCells: [at(2, 3), at(8, 3)], crop: { x: 0, y: 0, width: 5, height: 5 } });
  assert.ok(window.svg.includes('d="M40 60h20v20h-20z"'));
});

test('exitMarks: a numbered circle beside the door name, the name kept whole, an exit not listed as before', () => {
  const project = small();
  const floor = project.building.floors[0];
  const [exitId] = ids(project);
  const before = planSvg(project, floor);
  const plan = planSvg(project, floor, { exitMarks: [{ exitId, number: 12, colour: '#661f75' }] });
  assert.equal(count(plan.svg, 'class="plan__mark"'), 1);
  assert.ok(plan.svg.includes('fill="#661f75"/><text class="plan__mark-number"'));
  assert.ok(plan.svg.includes('>12</text>'));
  assert.ok(plan.svg.includes('>East Door</text>'));
  assert.equal(sha(planSvg(project, floor, { exitMarks: [{ exitId: 'nothere', number: 1 }] }).svg), sha(before.svg), 'a mark for no exit changes nothing');
  // the exit above is on the north edge: the circle is left of the name, inside the picture
  const box = /viewBox="([-\d. ]+)"/.exec(plan.svg)[1].split(' ').map(Number);
  const cx = Number(/class="plan__mark" cx="([\d.]+)"/.exec(plan.svg)[1]);
  assert.ok(cx - 5.2 >= box[0] && cx + 5.2 <= box[0] + box[2]);
  // an east edge: the name moves out past the circle, and the picture holds both
  const east = planProject([EAST], { exits: [[1, 4, 1, 'East Door']] });
  const eastFloor = east.building.floors[0];
  const eastId = eastFloor.exits[0].id;
  const eastBefore = planSvg(east, eastFloor);
  const eastPlan = planSvg(east, eastFloor, { exitMarks: [{ exitId: eastId, number: 2 }] });
  const eastBox = /viewBox="([-\d. ]+)"/.exec(eastPlan.svg)[1].split(' ').map(Number);
  const nameX = Number(/class="plan__exit-name plan__exit-name--e" x="([\d.]+)"/.exec(eastPlan.svg)[1]);
  const beforeX = Number(/class="plan__exit-name plan__exit-name--e" x="([\d.]+)"/.exec(eastBefore.svg)[1]);
  assert.ok(nameX >= beforeX + 12, 'the name moved out by the circle: ' + beforeX + ' to ' + nameX);
  assert.ok(Number(/class="plan__mark" cx="([\d.]+)"/.exec(eastPlan.svg)[1]) < nameX);
  assert.ok(eastBox[0] + eastBox[2] >= nameX + 9 * 0.5 * 7.5, 'the picture holds the whole name: ' + eastBox + ' name from ' + nameX);
  assert.ok(eastPlan.width > eastBefore.width);
  // a south edge: the circle left of a name that stays centred on the door
  const south = planProject([FLOOR], { exits: [[1, 3, 3, 'Back']] });
  const down = planSvg(south, south.building.floors[0], { exitMarks: [{ exitId: south.building.floors[0].exits[0].id, number: 2 }] });
  const circle = /class="plan__mark" cx="([\d.]+)"/.exec(down.svg)[1];
  const label = /class="plan__exit-name" x="([\d.]+)"/.exec(down.svg)[1];
  assert.ok(Number(circle) < Number(label));
  // an exit with no name: the circle alone, on the door
  const bare = planProject([FLOOR], { exits: [[1, 3, 3, '']] });
  const alone = planSvg(bare, bare.building.floors[0], { exitMarks: [{ exitId: bare.building.floors[0].exits[0].id, number: 1 }] });
  assert.equal(count(alone.svg, 'class="plan__mark"'), 1);
  assert.equal(Number(/class="plan__mark" cx="([\d.]+)"/.exec(alone.svg)[1]), 70);
});

test('marker: a filled mark on its cell with its words in a pill; the picture grows to hold the pill', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { marker: { cell: at(5, 3), label: 'You are here' } });
  assert.equal(count(plan.svg, 'class="plan__marker"'), 1);
  assert.ok(plan.svg.includes('>You are here</text>'));
  assert.equal(planSvg(project, floor, { marker: { cell: at(5, 3), label: '' } }).svg.includes('plan__marker-pill'), false, 'no words, no pill');
  assert.equal(count(planSvg(project, floor, { marker: { cell: 9999, label: 'x' } }).svg, 'plan__marker'), 0);
  // a marker on the top row of what is drawn puts its pill below, inside the picture
  const top = planSvg(project, floor, { marker: { cell: at(2, 1), label: 'You are here' } });
  const pill = /class="plan__marker-pill" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(top.svg).slice(1).map(Number);
  const view = /viewBox="([-\d. ]+)"/.exec(top.svg)[1].split(' ').map(Number);
  assert.ok(pill[0] >= view[0] && pill[1] >= view[1] && pill[0] + pill[2] <= view[0] + view[2] && pill[1] + pill[3] <= view[1] + view[3], 'the pill is inside the picture');
  // a wide label at an edge grows the picture, never cut
  const edge = planSvg(project, floor, { marker: { cell: at(1, 3), label: 'You are right here at the far west end' } });
  const ev = /viewBox="([-\d. ]+)"/.exec(edge.svg)[1].split(' ').map(Number);
  const ep = /class="plan__marker-pill" x="([-\d.]+)"/.exec(edge.svg)[1];
  assert.ok(Number(ep) >= ev[0]);
});

// ---- the reference grid

function grid(width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(y === 0 || y === height - 1 ? '#'.repeat(width) : '#' + '.'.repeat(width - 2) + '#');
  return planProject([rows]);
}

test('refGrid: a 5 by 5 floor takes the smallest size, 4 cells, and a 200 by 200 floor the one that gives ten', () => {
  const tiny = grid(5, 5);
  const little = planSvg(tiny, tiny.building.floors[0], { refGrid: true });
  assert.deepEqual(little.grid, { x0: 0, y0: 0, size: 4, cols: 2, rows: 2 });
  const big = grid(200, 200);
  const huge = planSvg(big, big.building.floors[0], { refGrid: true });
  assert.deepEqual(huge.grid, { x0: 0, y0: 0, size: 20, cols: 10, rows: 10 });
  assert.equal(count(huge.svg, 'class="plan__grid-label"'), 40, 'letters over and under, numbers left and right');
});

test('refGrid: the size is the smallest of 4 5 6 8 10 12 15 20 25 that gives at most 12 columns and 12 rows, at and either side of each edge', () => {
  const sizeOf = (w, h) => { const p = grid(w, h); return planSvg(p, p.building.floors[0], { refGrid: true }).grid.size; };
  assert.equal(sizeOf(48, 5), 4, '12 columns of 4');
  assert.equal(sizeOf(49, 5), 5, '13 columns of 4 is one too many');
  assert.equal(sizeOf(5, 49), 5, 'rows count as columns do');
  assert.equal(sizeOf(60, 10), 5);
  assert.equal(sizeOf(61, 10), 6);
  assert.equal(sizeOf(144, 10), 12);
  assert.equal(sizeOf(145, 10), 15);
  assert.equal(sizeOf(300, 10), 25);
  assert.equal(sizeOf(301, 10), 25, 'past the last size, the last size');
  const p = grid(301, 10);
  assert.equal(planSvg(p, p.building.floors[0], { refGrid: true }).grid.cols, 13);
  // the rule can be given
  const own = planSvg(p, p.building.floors[0], { refGrid: { maxCols: 4, maxRows: 4, sizes: [10, 100] } });
  assert.deepEqual([own.grid.size, own.grid.cols], [100, 4]);
  assert.equal(planSvg(p, p.building.floors[0], { refGrid: { maxCols: 'x', sizes: [0, -1] } }).grid.size, 25, 'a rule that is not one is the default');
});

test('refGrid: it starts at the top left of what is drawn, labels A… over and under and 1… either side, in a band outside the plan', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plain = planSvg(project, floor);
  const plan = planSvg(project, floor, { refGrid: true });
  assert.equal(plan.grid.x0, 1);
  assert.equal(plan.grid.y0, 1);
  assert.ok(plan.width > plain.width && plan.height > plain.height, 'one band each side');
  const words = Array.from(plan.svg.matchAll(/class="plan__grid-label"[^>]*>([^<]*)</g)).map((m) => m[1]);
  assert.equal(words.filter((word) => /^[A-Z]+$/.test(word)).length, plan.grid.cols * 2);
  assert.equal(words.filter((word) => /^\d+$/.test(word)).length, plan.grid.rows * 2);
  assert.ok(plan.svg.includes('<g class="plan__grid-labels" aria-hidden="true">'));
  assert.ok(plan.svg.includes('class="plan__grid-lines" aria-hidden="true"'));
  // every label lies outside the plain picture's box, so the band is clear of the door-name pad
  const [vx, vy, vw, vh] = /viewBox="([-\d. ]+)"/.exec(plain.svg)[1].split(' ').map(Number);
  for (const match of plan.svg.matchAll(/class="plan__grid-label" x="([-\d.]+)" y="([-\d.]+)"/g)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const inside = x > vx && x < vx + vw && y > vy && y < vy + vh;
    assert.equal(inside, false, 'label at ' + x + ',' + y + ' is over the plan\'s pad');
  }
});

test('refGrid: a long door name on an east edge is whole inside the picture and the grid\'s label band is clear of it', () => {
  const project = planProject([EAST], { exits: [[1, 4, 1, 'The Very Long Door Name Out To The East']] });
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { refGrid: true });
  const [vx, , vw] = /viewBox="([-\d. ]+)"/.exec(plan.svg)[1].split(' ').map(Number);
  const nameStart = 100 + 4;
  const nameEnd = nameStart + 39 * 0.5 * 7.5;
  const right = Array.from(plan.svg.matchAll(/class="plan__grid-label" x="([-\d.]+)"/g)).map((m) => Number(m[1])).filter((x) => x > 60 && x > vx + vw / 2);
  assert.ok(Math.min(...right) > nameEnd, 'row numbers at ' + Math.min(...right) + ' are clear of the name, which ends near ' + nameEnd);
  assert.ok(vx + vw > nameEnd);
});

test('refGrid: labelCells maps each drawn space to the cell its label is centred on, and gridSquare names it', () => {
  const project = small();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { refGrid: true });
  const [a, b] = floor.spaces;
  // room A is 2 by 2 at (2,1): its label is on the corner it shares with the cells below and right, cell (3,2)
  assert.equal(plan.labelCells.get(a.id), at(3, 2));
  // room B is 1 by 2 at (4,1): the middle of its column is a boundary, cell (4,2)
  assert.equal(plan.labelCells.get(b.id), at(4, 2));
  assert.equal(plan.labelCells.size, 2);
  assert.equal(gridSquare(plan.grid, floor.width, at(3, 2)), 'A1', 'the grid starts at (1,1) and is 4 cells wide');
  // a number is drawn centred where the index says: the cell the label's text is in
  const x = Number(/class="plan__number" x="([\d.]+)" y="([\d.]+)"/.exec(plan.svg)[1]);
  assert.equal(Math.floor(x / 20), plan.labelCells.get(a.id) % 10);
  // a window keeps only the spaces in it
  const window = planSvg(project, floor, { refGrid: true, crop: { x: 4, y: 0, width: 3, height: 4 } });
  assert.deepEqual([...window.labelCells.keys()], [b.id], 'room A is outside the window');
});

test('columnLetters runs on past Z; gridSquare is null outside the grid', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetters), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  const grid = { x0: 2, y0: 3, size: 4, cols: 3, rows: 2 };
  assert.equal(gridSquare(grid, 10, 3 * 10 + 2), 'A1');
  assert.equal(gridSquare(grid, 20, 8 * 20 + 12), 'C2');
  assert.equal(gridSquare(grid, 10, 1 * 10 + 2), null, 'above');
  assert.equal(gridSquare(grid, 10, 3 * 10 + 1), null, 'left');
  assert.equal(gridSquare(grid, 10, 11 * 10 + 2), null, 'below the last row');
  assert.equal(gridSquare(null, 10, 5), null);
});

// ---- typed names

const HOSTILE = '"><img src=x onerror=alert(1)><script>alert(2)</script>&amp;';

test('every typed name is escaped: a door name, a marker\'s words, a badge\'s number, a grid on a floor named with markup', () => {
  const project = planProject([FLOOR], { exits: [[1, 9, 3, HOSTILE]] });
  const floor = project.building.floors[0];
  floor.name = HOSTILE;
  const plan = planSvg(project, floor, {
    routes: [{ cells: [at(3, 3), at(4, 3)], exit: at(9, 3), number: HOSTILE, colour: HOSTILE }],
    exitMarks: [{ exitId: floor.exits[0].id, number: 7, colour: HOSTILE }],
    marker: { cell: at(5, 3), label: HOSTILE },
    refGrid: true,
    highlightCells: [at(3, 3)],
  });
  assert.equal(count(plan.svg, '<script'), 0);
  assert.equal(count(plan.svg, '<img'), 0);
  assert.equal(count(plan.svg, 'onerror=alert(1)>'), 0);
  // the door name, the marker's words and the badge's number, each as typed (a mark's number is a whole number now, so only its colour is typed)
  assert.ok(count(plan.svg, esc(HOSTILE)) >= 3, 'door name, marker and badge, each as typed: ' + count(plan.svg, esc(HOSTILE)));
  assert.equal(count(plan.svg, 'fill="' + HOSTILE), 0, 'a colour that is not a colour is not written');
  assert.ok(plan.svg.includes('>7</text>'), 'the mark is drawn, in the exit\'s own colour');
  assert.deepEqual(Array.from(plan.svg.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)).map((m) => m[1]).filter((tag) => !['svg', 'g', 'path', 'text', 'circle', 'rect'].includes(tag)), []);
  // the picture on its own, as XML, is as safe
  const xml = planSvg(project, floor, { xml: true, marker: { cell: at(5, 3), label: HOSTILE } });
  assert.equal(count(xml.svg, '<img'), 0);
});

// ---- the styles

test('every class the new options write is in PLAN_STYLE, so a picture on its own looks as it does on a sheet', () => {
  const project = small();
  const floor = project.building.floors[0];
  const [exitId] = ids(project);
  const plan = planSvg(project, floor, {
    routes: [{ cells: [at(2, 4), at(2, 3)], start: at(2, 2), exit: at(9, 3), number: 1 }],
    refGrid: true, highlightCells: [at(3, 3)], exitMarks: [{ exitId, number: 1 }], marker: { cell: at(5, 3), label: 'Here' },
  });
  const styled = planStyleText();
  const used = new Set(Array.from(plan.svg.matchAll(/class="([^"]+)"/g)).flatMap((m) => m[1].split(' ')));
  for (const name of ['plan__highlight', 'plan__grid-lines', 'plan__grid-label', 'plan__way-band', 'plan__way-line', 'plan__way-start', 'plan__badge', 'plan__badge-number', 'plan__mark', 'plan__mark-number', 'plan__marker', 'plan__marker-pill', 'plan__marker-label']) {
    assert.ok(used.has(name), name + ' is drawn');
    assert.ok(styled.includes('.' + name + ' {'), name + ' is styled');
  }
  const missing = [...used].filter((name) => name.startsWith('plan') && !styled.includes('.' + name) && !['plan__ways', 'plan__grid-labels', 'plan__you', 'plan__space', 'plan__space--room', 'plan__fill', 'plan__steps', 'plan__trace', 'plan__lift', 'plan__pill', 'plan__key', 'plan__refuge', 'plan__oneway'].includes(name));
  assert.deepEqual(missing, []);
});

// ---- routes.js

test('runsOf moved to ui/prints/routes.js and the overlay still exports the same function', () => {
  assert.equal(overlayRunsOf, runsOf);
  assert.deepEqual(runsOf(null), []);
  assert.deepEqual(runsOf({ ok: false, cells: [] }), []);
  const a = { floorId: 'f1', cell: 1 };
  const b = { floorId: 'f1', cell: 2 };
  const c = { floorId: 'f2', cell: 3 };
  assert.deepEqual(runsOf({ ok: true, from: a, cells: [b, c], connectionAt: [0] }), [[a, b], [c]]);
});

test('waysOnFloor: the part of every route on a floor, the room\'s own floor in colour and others\' parts faint and first', () => {
  const project = school();
  const evac = evacuationRoutes(project, routingGraph(project));
  const [first, second] = project.building.floors;
  const numbering = new Map();
  evac.rooms.filter((r) => r.route.ok).forEach((r) => { if (!numbering.has(r.route.exitId)) numbering.set(r.route.exitId, { number: numbering.size + 1, colour: printExitColour(numbering.size) }); });
  const upper = waysOnFloor(evac.rooms, second.id, { numbering });
  const mine = evac.rooms.filter((r) => r.floorId === second.id && r.route.ok);
  assert.ok(upper.length >= mine.length);
  assert.ok(upper.every((way) => way.cells.every((cell) => cell >= 0 && cell < second.width * second.height)));
  assert.equal(upper.filter((way) => !way.faint).length, mine.length, 'one coloured way for each room on the floor');
  assert.equal(upper.filter((way) => !way.faint && way.start !== null).length, mine.length);
  // faint ways come before the coloured ones
  const firstColoured = upper.findIndex((way) => !way.faint);
  assert.ok(upper.slice(firstColoured).every((way) => !way.faint));
  // the lower floor: the upper floors' rooms come down to it, faint, and end at an exit there
  const lower = waysOnFloor(evac.rooms, first.id, { numbering });
  const coming = lower.filter((way) => way.faint);
  assert.ok(coming.length > 0, 'ways from the floors above arrive on Floor 1');
  assert.ok(coming.every((way) => way.start === null), 'they do not start in a room here');
  assert.ok(coming.every((way) => way.number !== undefined && way.colour));
  // a faint option greys coloured ways, and no numbering leaves no number
  const grey = waysOnFloor(evac.rooms, first.id, { faint: () => true });
  assert.ok(grey.every((way) => way.faint && way.number === undefined));
  assert.deepEqual(waysOnFloor(null, first.id), []);
  assert.deepEqual(waysOnFloor([{ roomId: 'r', floorId: first.id, route: { ok: false } }], first.id), []);
  // a route that leaves a floor and returns is two ways on it
  const entry = { roomId: 'r', floorId: 'fa', route: { ok: true, exitId: 'x', from: { floorId: 'fa', cell: 5 }, cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fb', cell: 1 }, { floorId: 'fa', cell: 8 }, { floorId: 'fa', cell: 9 }], connectionAt: [0, 1], exit: { id: 'x', floorId: 'fa', cell: 9 } } };
  const both = waysOnFloor([entry], 'fa');
  assert.deepEqual(both.map((way) => [way.cells, way.start, way.exit]), [[[6], 5, null], [[8, 9], null, 9]]);
});

// ---- SV2-108b: the corrections

const boxesOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const viewOf = (svg) => /viewBox="([-\d. ]+)"/.exec(svg)[1].split(' ').map(Number);

test('teachers: false leaves out the surname under a room number; left out of the options, every sample floor is as it was', () => {
  const project = school();
  let seen = 0;
  for (const floor of project.building.floors) {
    const plain = planSvg(project, floor);
    const same = planSvg(project, floor, { teachers: true });
    assert.equal(same.svg, plain.svg, floor.name + ': teachers true is the default');
    const without = planSvg(project, floor, { teachers: false });
    const named = count(plain.svg, 'class="plan__teacher"');
    seen += named;
    assert.equal(count(without.svg, 'plan__teacher'), 0, floor.name + ': no surname');
    // every room number is still drawn
    assert.equal(count(without.svg, 'class="plan__number"'), count(plain.svg, 'class="plan__number"'));
    assert.equal(without.rooms, plain.rooms);
  }
  assert.ok(seen >= 4, 'the sample has surnames to leave out: ' + seen);
});

// the box of a corridor name as the plan draws it: textEms of its capitals, 1.15 for the letter spacing, turned a quarter when it runs down
function nameBoxes(svg) {
  return Array.from(svg.matchAll(/<text class="plan__corridor-name" x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)).map((m) => {
    const [x, y, size] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const wide = textEms(m[5].toUpperCase()) * 1.15 * size;
    const tall = size * 0.5;
    return m[4].includes('rotate') ? { name: m[5], left: x - tall, right: x + tall, top: y - wide / 2, bottom: y + wide / 2 } : { name: m[5], left: x - wide / 2, right: x + wide / 2, top: y - tall, bottom: y + tall };
  });
}
const pillBox = (svg) => {
  const m = /class="plan__marker-pill" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  return m ? { left: Number(m[1]), top: Number(m[2]), right: Number(m[1]) + Number(m[3]), bottom: Number(m[2]) + Number(m[4]) } : null;
};

test('marker: the pill never covers a corridor name, on every named corridor of the sample at its middle cell', () => {
  const project = school();
  let checked = 0;
  for (const floor of project.building.floors) {
    for (const corridor of floor.corridors) {
      if (corridor.name.trim() === '') continue;
      const mx = corridor.cells.reduce((sum, cell) => sum + (cell % floor.width), 0) / corridor.cells.length;
      const my = corridor.cells.reduce((sum, cell) => sum + Math.floor(cell / floor.width), 0) / corridor.cells.length;
      const cell = corridor.cells.slice().sort((a, b) => Math.hypot((a % floor.width) - mx, Math.floor(a / floor.width) - my) - Math.hypot((b % floor.width) - mx, Math.floor(b / floor.width) - my))[0];
      const plan = planSvg(project, floor, { marker: { cell, label: 'You are here' } });
      const pill = pillBox(plan.svg);
      assert.ok(pill, 'a pill is drawn');
      for (const name of nameBoxes(plan.svg)) assert.equal(boxesOverlap(pill, name), false, floor.name + ' ' + corridor.name + ': the pill covers ' + name.name);
      checked += 1;
    }
  }
  assert.equal(checked, 5, 'the sample names five corridors');
  // a corridor two cells high is named on the line between its rows: a marker on the lower row has the name just above it, where the pill would go
  const wide = planProject([['.....', '.###########', '.###########']]);
  const hall = wide.building.floors[0];
  hall.corridors.push({ id: 'cor00000002', name: 'Hall', cells: hall.cells.split('').flatMap((c, i) => (c === '#' ? [i] : [])) });
  const under = planSvg(wide, hall, { marker: { cell: 2 * hall.width + 6, label: 'You are here' } });
  const hallName = nameBoxes(under.svg);
  assert.equal(hallName.length, 1);
  assert.equal(boxesOverlap(pillBox(under.svg), hallName[0]), false, 'the pill is off the name Hall');
  // a marker with nothing near it keeps its pill above, where it was
  const project2 = small();
  const floor2 = project2.building.floors[0];
  const lone = pillBox(planSvg(project2, floor2, { marker: { cell: at(5, 3), label: 'Here' } }).svg);
  assert.equal(lone.bottom, at(5, 3) % 1 + 70 - 7.6 - 3, 'above the dot, 3 units clear of it');
});

test('marker: the pill is moved off a route badge beside the dot, and stays whole inside the picture', () => {
  const project = small();
  const floor = project.building.floors[0];
  // a badge on the cell above the marker, where the pill would go
  const way = { cells: [at(5, 2)], joins: [at(5, 2)], number: 1, colour: '#255ebc' };
  const plan = planSvg(project, floor, { marker: { cell: at(5, 3), label: 'You are here' }, routes: [way] });
  const badge = /class="plan__badge" cx="([\d.]+)" cy="([\d.]+)"/.exec(plan.svg);
  assert.ok(badge, 'the badge is drawn');
  const near = { left: Number(badge[1]) - 6, right: Number(badge[1]) + 6, top: Number(badge[2]) - 6, bottom: Number(badge[2]) + 6 };
  const pill = pillBox(plan.svg);
  assert.equal(boxesOverlap(pill, near), false, 'the pill is clear of the badge');
  const view = viewOf(plan.svg);
  assert.ok(pill.left >= view[0] && pill.right <= view[0] + view[2] && pill.top >= view[1] && pill.bottom <= view[1] + view[3]);
});

test('refGrid on a floor with nothing drawn: grid null, no labelled cells, never undefined', () => {
  const project = planProject([['.....']]);
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { refGrid: true });
  assert.equal(plan.drawn, false);
  assert.equal(plan.grid, null);
  assert.ok(plan.labelCells instanceof Map);
  assert.equal(plan.labelCells.size, 0);
  assert.deepEqual(plan.unlabelled, []);
  // without the grid the result is what it was
  assert.equal('grid' in planSvg(project, floor), false);
  assert.equal('labelCells' in planSvg(project, floor, { refGrid: false }), false);
});

test('labelCells holds the spaces whose label is drawn; unlabelled names the drawn spaces with none', () => {
  const project = small({ numbers: { '1B': '' } });
  const floor = project.building.floors[0];
  const [a, b] = floor.spaces;
  const plan = planSvg(project, floor, { refGrid: true });
  assert.deepEqual([...plan.labelCells.keys()], [a.id], 'a room with no number has no label cell');
  assert.deepEqual(plan.unlabelled, [b.id]);
  // every space labelled: nothing unlabelled
  const all = planSvg(small(), small().building.floors[0], { refGrid: true });
  assert.deepEqual(all.unlabelled, []);
  assert.equal(all.labelCells.size, 2);
  // an other space with no label, and a label a window cuts, are unlabelled too
  const other = planProject([['..aa.', '..aa.', '.###.']]);
  other.building.floors[0].spaces[0].label = '';
  const blank = planSvg(other, other.building.floors[0], { refGrid: true });
  assert.deepEqual(blank.unlabelled, [other.building.floors[0].spaces[0].id]);
  assert.equal(blank.labelCells.size, 0);
  const cut = planSvg(project, floor, { refGrid: true, crop: { x: 2, y: 1, width: 1, height: 2 } });
  assert.deepEqual(cut.unlabelled, [a.id], 'room A\'s number is on the window\'s edge and is left out');
  assert.equal(cut.labelCells.size, 0);
});

test('crop: the options for safety never grow the window; a marker outside it is not drawn', () => {
  const project = small();
  const floor = project.building.floors[0];
  const [exitId] = ids(project);
  const window = { x: 0, y: 0, width: 6, height: 5 };
  const plain = planSvg(project, floor, { crop: window });
  assert.deepEqual(viewOf(plain.svg), [0, 0, 120, 100]);
  // the marker is on the east, outside the window: not drawn, and the window is the one asked for
  const outside = planSvg(project, floor, { crop: window, marker: { cell: at(8, 3), label: 'You are here' } });
  assert.equal(count(outside.svg, 'plan__marker'), 0);
  assert.equal(outside.svg, plain.svg, 'nothing about it is drawn');
  assert.deepEqual([outside.width, outside.height], [6, 5]);
  // one cell past the edge, where a pill put on the left would lie inside the window: still nothing
  const beside = planSvg(project, floor, { crop: { x: 0, y: 0, width: 5, height: 5 }, marker: { cell: at(5, 3), label: 'You are here' } });
  assert.equal(count(beside.svg, 'plan__marker'), 0, 'no dot and no pill for a marker outside the window');
  assert.deepEqual(viewOf(beside.svg), [0, 0, 100, 100]);
  // inside, with room for its pill: dot and pill, window as asked
  const inside = planSvg(project, floor, { crop: { x: 0, y: 0, width: 10, height: 5 }, marker: { cell: at(5, 3), label: 'You are here' } });
  assert.equal(count(inside.svg, 'class="plan__marker"'), 1);
  assert.equal(count(inside.svg, 'class="plan__marker-pill"'), 1);
  assert.deepEqual(viewOf(inside.svg), [0, 0, 200, 100]);
  // a window with no room for the pill: the dot stays, the pill is left out, the window stays
  const tight = planSvg(project, floor, { crop: { x: 4, y: 2, width: 3, height: 3 }, marker: { cell: at(5, 3), label: 'You are here' } });
  assert.equal(count(tight.svg, 'class="plan__marker"'), 1);
  assert.equal(count(tight.svg, 'plan__marker-pill'), 0);
  assert.deepEqual(viewOf(tight.svg), [80, 40, 60, 60]);
  // exitMarks: the exit's name and mark are inside the window and kept, or the edge would cut them and both are left out
  const back = planProject([FLOOR], { exits: [[1, 6, 3, 'East Door']] });
  const backFloor = back.building.floors[0];
  const backId = backFloor.exits[0].id;
  const mid = { x: 3, y: 0, width: 6, height: 5 };
  const kept = planSvg(back, backFloor, { crop: mid, exitMarks: [{ exitId: backId, number: 1 }] });
  assert.equal(count(kept.svg, 'class="plan__mark"'), 1);
  assert.ok(kept.svg.includes('>East Door</text>'));
  assert.deepEqual(viewOf(kept.svg), [60, 0, 120, 100]);
  const low = { x: 3, y: 3, width: 6, height: 2 };
  const cutOff = planSvg(back, backFloor, { crop: low, exitMarks: [{ exitId: backId, number: 1 }] });
  assert.equal(count(cutOff.svg, 'plan__mark'), 0, 'the mark the edge would cut is left out');
  assert.equal(count(cutOff.svg, 'East Door'), 0, 'and so is the name');
  assert.deepEqual(viewOf(cutOff.svg), viewOf(planSvg(back, backFloor, { crop: low }).svg), 'the window did not grow');
  assert.deepEqual(viewOf(cutOff.svg), [60, 60, 120, 40]);
  const east = { x: 5, y: 0, width: 5, height: 5 };
  // a long name on an east edge: the window is not grown to hold it, with marks or a grid
  const wide = planProject([EAST], { exits: [[1, 4, 1, 'The Very Long Door Name Out To The East']] });
  const wideFloor = wide.building.floors[0];
  const wideId = wideFloor.exits[0].id;
  const base = viewOf(planSvg(wide, wideFloor, { crop: { x: 0, y: 0, width: 5, height: 5 } }).svg);
  assert.deepEqual(viewOf(planSvg(wide, wideFloor, { crop: { x: 0, y: 0, width: 5, height: 5 }, exitMarks: [{ exitId: wideId, number: 1 }] }).svg), base);
  const gridded = planSvg(wide, wideFloor, { crop: { x: 0, y: 0, width: 5, height: 5 }, refGrid: true });
  const [gx, gy, gw, gh] = viewOf(gridded.svg);
  assert.ok(Math.abs(gx + gw / 2 - 50) < 1e-6 && Math.abs(gy + gh / 2 - 50) < 1e-6, 'the grid\'s band is the same all round, the window the one asked for: ' + [gx, gy, gw, gh]);
  assert.equal(count(gridded.svg, 'The Very Long'), 0, 'the name the edge would cut is left out');
  // routes: a way in the window draws as before and holds nothing
  const ways = planSvg(project, floor, { crop: east, routes: [{ cells: [at(5, 3), at(6, 3)], start: null, exit: at(9, 3), joins: [], number: 1 }] });
  assert.deepEqual(viewOf(ways.svg), [100, 0, 100, 100]);
  assert.ok(count(ways.svg, 'class="plan__badge"') >= 1);
  // all of them at once
  const all = planSvg(project, floor, { crop: east, exitMarks: [{ exitId, number: 1 }], marker: { cell: at(8, 3), label: 'Here' }, routes: [{ cells: [at(8, 3)], exit: at(9, 3), number: 1 }] });
  assert.deepEqual(viewOf(all.svg), [100, 0, 100, 100]);
});

test('exitMarks: an exit on each of the four edges has its name and circle whole inside the picture and clear of each other', () => {
  const block = ['.....', '.###.', '.###.', '.###.'];
  const project = planProject([block], { exits: [[1, 2, 1, 'North Door'], [1, 2, 3, 'South Door'], [1, 1, 2, 'West Door'], [1, 3, 2, 'East Door']] });
  const floor = project.building.floors[0];
  const marks = floor.exits.map((exit, i) => ({ exitId: exit.id, number: i + 1 }));
  for (const options of [{ exitMarks: marks }, { exitMarks: marks, refGrid: true }]) {
    const plan = planSvg(project, floor, options);
    assert.equal(plan.exits, 4);
    const [vx, vy, vw, vh] = viewOf(plan.svg);
    const circles = Array.from(plan.svg.matchAll(/class="plan__mark" cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)).map((m) => ({ left: Number(m[1]) - Number(m[3]), right: Number(m[1]) + Number(m[3]), top: Number(m[2]) - Number(m[3]), bottom: Number(m[2]) + Number(m[3]) }));
    assert.equal(circles.length, 4);
    const names = Array.from(plan.svg.matchAll(/<text class="plan__exit-name( plan__exit-name--([we]))?" x="([-\d.]+)" y="([-\d.]+)" font-size="7.5">([^<]*)</g)).map((m) => {
      const wide = textEms(m[5]) * 7.5;
      const x = Number(m[3]);
      const y = Number(m[4]);
      const box = m[2] === 'w' ? { left: x - wide, right: x } : m[2] === 'e' ? { left: x, right: x + wide } : { left: x - wide / 2, right: x + wide / 2 };
      return { ...box, top: y - 3.75, bottom: y + 3.75 };
    });
    assert.equal(names.length, 4);
    for (const box of circles.concat(names)) assert.ok(box.left >= vx && box.right <= vx + vw && box.top >= vy && box.bottom <= vy + vh, 'inside the picture: ' + JSON.stringify(box));
    for (const circle of circles) for (const name of names) assert.equal(boxesOverlap(circle, name), false, 'a circle over a name');
  }
});

test('exitMarks: more than eight wrap the colours; no colour takes printExitColour(number - 1), like routes', () => {
  const row = '#'.repeat(12);
  const project = planProject([['............', row]], { exits: Array.from({ length: 10 }, (_, i) => [1, i, 1, '']) });
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { exitMarks: floor.exits.map((exit, i) => ({ exitId: exit.id, number: i + 1 })) });
  const fills = Array.from(plan.svg.matchAll(/class="plan__mark" cx="[-\d.]+" cy="[-\d.]+" r="[\d.]+" fill="(#[0-9a-f]{6})"/g)).map((m) => m[1]);
  assert.deepEqual(fills, Array.from({ length: 10 }, (_, i) => PRINT_EXIT_COLOURS[i % 8]));
  assert.equal(fills[8], fills[0], 'the ninth is the first again');
  assert.ok(plan.svg.includes('>10</text>'));
  // a colour given is kept; the mark's number, not its place in the list, picks the default
  const picked = planSvg(project, floor, { exitMarks: [{ exitId: floor.exits[0].id, number: 3 }, { exitId: floor.exits[1].id, number: 2, colour: '#661f75' }] });
  assert.ok(picked.svg.includes('fill="' + PRINT_EXIT_COLOURS[2] + '"/>'));
  assert.ok(picked.svg.includes('fill="#661f75"/>'));
  // and routes of the same number are the same colour
  const way = planSvg(project, floor, { routes: [{ cells: [1 * 12 + 3, 1 * 12 + 4], number: 3 }] });
  assert.ok(way.svg.includes('class="plan__way-line" stroke="' + PRINT_EXIT_COLOURS[2] + '"'));
});

test('exitMarks: a number that is not a positive whole number draws no mark, no empty circle and no "0"', () => {
  const project = small();
  const floor = project.building.floors[0];
  const [exitId] = ids(project);
  const plain = planSvg(project, floor);
  for (const number of [0, -1, 1.5, NaN, Infinity, undefined, null, '', '3', '0', {}, [2]]) {
    const plan = planSvg(project, floor, { exitMarks: [{ exitId, number }] });
    assert.equal(count(plan.svg, 'plan__mark'), 0, JSON.stringify(number) + ' draws no mark');
    assert.equal(plan.svg, plain.svg, JSON.stringify(number) + ': the exit is drawn as without marks');
  }
  // the first mark for an exit that is bad does not shadow a later good one
  const later = planSvg(project, floor, { exitMarks: [{ exitId, number: 0 }, { exitId, number: 4 }] });
  assert.equal(count(later.svg, 'class="plan__mark"'), 1);
  assert.ok(later.svg.includes('>4</text>'));
});

test('exitMarks: an exit with no door name has the circle alone on its door, whole inside the picture, on every edge', () => {
  const project = planProject([['.....', '.###.', '.###.', '.###.']], { exits: [[1, 2, 1, ''], [1, 2, 3, ''], [1, 1, 2, ''], [1, 3, 2, '   ']] });
  const floor = project.building.floors[0];
  const marks = floor.exits.map((exit, i) => ({ exitId: exit.id, number: i + 1 }));
  for (const options of [{ exitMarks: marks }, { exitMarks: marks, refGrid: true }]) {
    const plan = planSvg(project, floor, options);
    assert.equal(count(plan.svg, 'plan__exit-name'), 0);
    assert.equal(count(plan.svg, 'class="plan__mark"'), 4);
    const [vx, vy, vw, vh] = viewOf(plan.svg);
    for (const m of plan.svg.matchAll(/class="plan__mark" cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)) {
      const [x, y, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
      assert.ok(x - r >= vx && x + r <= vx + vw && y - r >= vy && y + r <= vy + vh, 'circle at ' + x + ',' + y + ' is inside the picture');
    }
  }
});

test('routes: badges sit at the cells in joins and the exit only, side by side in number order', () => {
  const project = small();
  const floor = project.building.floors[0];
  const stairs = at(2, 4);
  const way = (extra) => ({ cells: [stairs, at(2, 3), at(3, 3)], exit: at(9, 3), number: 1, colour: '#255ebc', ...extra });
  // a way that only crosses the stairs landing has a badge at its exit and none on the landing
  assert.equal(count(planSvg(project, floor, { routes: [way({ joins: [] })] }).svg, 'class="plan__badge"'), 1);
  // one that takes the connection there has one there too
  assert.equal(count(planSvg(project, floor, { routes: [way({ joins: [stairs] })] }).svg, 'class="plan__badge"'), 2);
  // joins that are not cells of the floor are left out
  assert.equal(count(planSvg(project, floor, { routes: [way({ joins: [-1, 9999, 1.5, 'x', null] })] }).svg, 'class="plan__badge"'), 1);
  // 2 and 10 on one cell: 2 on the left, never "10" before "2"
  const two = planSvg(project, floor, { routes: [way({ number: 10, joins: [], colour: '#005700' }), way({ number: 2, joins: [] }), way({ number: 9, joins: [], colour: '#661f75' })] });
  const order = Array.from(two.svg.matchAll(/class="plan__badge-number" x="([\d.]+)" y="[\d.]+" font-size="[\d.]+">(\d+)</g)).sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]);
  assert.deepEqual(order, ['2', '9', '10']);
});

const ENTRY = (route) => ({ roomId: 'r', floorId: 'fa', route: { ok: true, exitId: 'x', ...route } });

test('waysOnFloor: joins are the cells a connection is taken from and comes out at, and only those', () => {
  // a way that leaves a floor and comes back to it: two ways, each with its join
  const twice = ENTRY({ from: { floorId: 'fa', cell: 5 }, cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fb', cell: 1 }, { floorId: 'fa', cell: 8 }, { floorId: 'fa', cell: 9 }], connectionAt: [0, 1], exit: { id: 'x', floorId: 'fa', cell: 9 } });
  assert.deepEqual(waysOnFloor([twice], 'fa').map((way) => [way.cells, way.start, way.exit, way.joins]), [[[6], 5, null, [6]], [[8, 9], null, 9, [8]]]);
  assert.deepEqual(waysOnFloor([twice], 'fb').map((way) => [way.cells, way.start, way.exit, way.joins]), [[[1], null, null, [1]]]);
  // a way that crosses a stairs landing without taking the connection has none
  const across = ENTRY({ from: { floorId: 'fa', cell: 5 }, cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fa', cell: 7 }, { floorId: 'fa', cell: 8 }], connectionAt: [], exit: { id: 'x', floorId: 'fa', cell: 8 } });
  assert.deepEqual(waysOnFloor([across], 'fa').map((way) => way.joins), [[]]);
  // and drawn, its badge is at the exit alone
  const project = small();
  const floor = project.building.floors[0];
  const drawn = (list) => count(planSvg(project, floor, { routes: list.map((way) => ({ ...way, number: 1 })) }).svg, 'class="plan__badge"');
  assert.equal(drawn(waysOnFloor([across], 'fa')), 1);
  assert.equal(drawn(waysOnFloor([twice], 'fa')), 3, 'two joins and the exit');
});

test('waysOnFloor: a stairs connection on one floor is two ways, its two ends both joins', () => {
  const route = ENTRY({ from: { floorId: 'fa', cell: 5 }, cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fa', cell: 7 }, { floorId: 'fa', cell: 20 }, { floorId: 'fa', cell: 21 }, { floorId: 'fa', cell: 22 }], connectionAt: [1], exit: { id: 'x', floorId: 'fa', cell: 22 } });
  const ways = waysOnFloor([route], 'fa');
  assert.deepEqual(ways.map((way) => [way.cells, way.start, way.exit, way.joins]), [[[6, 7], 5, null, [7]], [[20, 21, 22], null, 22, [20]]]);
  assert.deepEqual(runsOf(route.route).map((run) => run.length), [3, 3]);
  // drawn: a badge at 7, at 20 and at the exit 22
  const project = small();
  const plan = planSvg(project, project.building.floors[0], { routes: ways.map((way) => ({ ...way, number: 1 })) });
  assert.equal(count(plan.svg, 'class="plan__badge"'), 3);
});

test('waysOnFloor: a route with no from has no start, on its first floor and after a connection', () => {
  const plain = ENTRY({ cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fa', cell: 7 }], exit: { id: 'x', floorId: 'fa', cell: 7 } });
  assert.deepEqual(waysOnFloor([plain], 'fa').map((way) => [way.cells, way.start, way.exit, way.joins]), [[[6, 7], null, 7, []]]);
  const over = ENTRY({ cells: [{ floorId: 'fa', cell: 6 }, { floorId: 'fb', cell: 1 }, { floorId: 'fa', cell: 8 }], connectionAt: [0, 1], exit: { id: 'x', floorId: 'fa', cell: 8 } });
  assert.deepEqual(waysOnFloor([over], 'fa').map((way) => [way.cells, way.start, way.exit, way.joins]), [[[6], null, null, [6]], [[8], null, 8, [8]]]);
  assert.deepEqual(runsOf(over.route).map((run) => run.length), [1, 1, 1]);
});
