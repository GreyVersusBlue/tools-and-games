// planSvg's options for the safety prints (SV2-108): routes, refGrid,
// highlightCells, exitMarks and marker; PRINT_EXIT_COLOURS; and ui/prints/routes.js.
// Plain Node, no clock, no browser.
//
//   node test/engine/plan-svg-safety.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { planSvg, planStyleText, PRINT_EXIT_COLOURS, printExitColour, gridSquare, columnLetters } from '../../ui/prints/plan-svg.js';
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
    exitMarks: [{ exitId: floor.exits[0].id, number: HOSTILE, colour: HOSTILE }],
    marker: { cell: at(5, 3), label: HOSTILE },
    refGrid: true,
    highlightCells: [at(3, 3)],
  });
  assert.equal(count(plan.svg, '<script'), 0);
  assert.equal(count(plan.svg, '<img'), 0);
  assert.equal(count(plan.svg, 'onerror=alert(1)>'), 0);
  assert.ok(count(plan.svg, esc(HOSTILE)) >= 4, 'door name, marker, badge and mark number, each as typed: ' + count(plan.svg, esc(HOSTILE)));
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
