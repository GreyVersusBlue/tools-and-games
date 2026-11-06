// The step-free report on paper (ui/prints/step-free.js; SV2-104; DESIGN 13.6), rendered
// in plain Node and read as a string, as test/engine/prints-door-cards.test.mjs reads the cards.
//
//   node test/engine/prints-step-free.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sheet from '../../ui/prints/step-free.js';
import { OUTPUTS, outputFor, renderOutput } from '../../ui/prints/index.js';
import { esc } from '../../ui/prints/document.js';
import { UNMARKED_SAYS, TWO_VIEWS_SAYS, ALL_REACHED_SAYS } from '../../ui/safety/ways.js';
import { school, group } from './helpers.mjs';
import { planProject, floorId, roomId } from '../fixtures/buildings/plans.mjs';
import { PINNED } from './helpers.mjs';

const NOW = { now: PINNED };
const HALL = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];
const STAIRS_HALL = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// A building with a ground floor and a floor up the stairs, no elevator: Floor 2 cannot be reached.
function upstairs() {
  return planProject([STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] });
}

test('the output is registered as step-free, named for the report', () => {
  assert.equal(sheet.id, 'step-free');
  assert.equal(outputFor('step-free'), sheet);
  assert.equal(OUTPUTS.filter((output) => output.id === 'step-free').length, 1);
  assert.equal(typeof renderOutput('step-free', upstairs(), null, NOW).html, 'string');
  assert.equal(renderOutput('step-free', upstairs(), null, NOW).title, 'Step-free report · Schedule Visualizer 2');
});

test('with nothing step-free marked it opens by saying so, says every room can be reached, and ends on the two views', () => {
  const project = planProject([HALL], { exits: [[1, 6, 2, 'Main Door']] });
  const { html } = sheet.render(project, null, NOW);
  const first = html.indexOf('data-line="unmarked"');
  assert.ok(first > 0, 'the opening is there');
  assert.ok(html.includes(esc(UNMARKED_SAYS)));
  assert.ok(first < html.indexOf('data-line="none"'), 'the opening comes first');
  assert.ok(html.includes(esc(ALL_REACHED_SAYS)));
  assert.ok(html.indexOf('data-line="none"') < html.indexOf('data-line="views"'));
  assert.ok(html.includes(esc(TWO_VIEWS_SAYS)));
  assert.equal(countOf(html, 'doc-table'), 0, 'no table when there is nothing to list');
});

test('once something is marked the opening goes, and a building every room of which is reached still says so', () => {
  const project = planProject([HALL], { exits: [[1, 6, 2, 'Main Door'], [1, 0, 2, 'Side Door']] });
  project.building.floors[0].exits[1].stepFree = false;
  const { html } = sheet.render(project, null, NOW);
  assert.equal(countOf(html, 'data-line="unmarked"'), 0);
  assert.equal(countOf(html, 'data-line="none"'), 1);
});

test('rooms that cannot be reached are listed floor by floor, each with its reason', () => {
  const project = upstairs();
  const { html } = sheet.render(project, null, NOW);
  assert.equal(countOf(html, 'data-line="none"'), 0);
  assert.ok(html.includes('2 rooms cannot be reached without stairs.'));
  assert.equal(countOf(html, '<section class="doc-section" data-floor="'), 1, 'one floor has rooms to list');
  assert.ok(html.includes('data-floor="' + floorId(2) + '"'));
  for (const number of ['2A', '2B']) {
    const row = html.slice(html.indexOf('<tr data-room="' + roomId(number) + '"'));
    assert.ok(row.slice(0, row.indexOf('</tr>')).includes('data-reason="floor"'));
    assert.ok(row.slice(0, row.indexOf('</tr>')).includes('Floor 2 has no elevator stop'));
  }
  assert.equal(countOf(html, 'data-room="' + roomId('1A') + '"'), 0, 'a room that is reached is not listed');
  // the unmarked opening is there too: stairs alone mark nothing step-free
  assert.equal(countOf(html, 'data-line="unmarked"'), 1);
});

test('with no step-free exit the engine\'s line comes first and every room is under it', () => {
  const project = planProject([HALL], { exits: [[1, 6, 2, 'Main Door']] });
  project.building.floors[0].exits[0].stepFree = false;
  const { html } = sheet.render(project, null, NOW);
  assert.ok(html.includes('data-line="no-exit"'));
  assert.ok(html.includes('No exit is step-free, so no room can be reached without stairs.'));
  assert.equal(countOf(html, 'data-reason="no-exit"'), 2);
  assert.ok(html.includes('No step-free exit'), 'the reason is in the table, capitalised');
});

test('the step-free groups scheduled into those rooms follow, by period; the day column only with more than one own day type', () => {
  const project = school();
  group(project, '8A').stepFree = true;
  const { html } = sheet.render(project, null, NOW);
  assert.ok(html.includes('data-section="groups"'));
  assert.ok(html.includes('Step-free groups in these rooms'));
  assert.ok(html.includes('<span dir="auto">8A</span>, <span dir="auto">Room 303</span>'), 'Room 303 in the seventh period');
  const rows = Array.from(html.matchAll(/<tr data-period="(\d+)">/g)).map((match) => Number(match[1]));
  assert.ok(rows.length > 0);
  const own = project.dayTypes.filter((dayType, index) => index === 0 || dayType.own).length;
  assert.equal(html.includes('<th scope="col">Day</th>'), own > 1);
  // no step-free group, no section
  assert.equal(countOf(sheet.render(school(), null, NOW).html, 'data-section="groups"'), 0);
});

test('names are as typed: a floor, a room, a group and a school with markup or a right-to-left script print as text', () => {
  const project = school();
  group(project, '8A').stepFree = true;
  project.settings.schoolName = '<b>School</b> & "Co"';
  const floor = project.building.floors[1];
  floor.name = 'مستوى <i>2</i>';
  group(project, '8A').name = '<script>alert(1)</script> ויקי';
  const { html } = sheet.render(project, null, NOW);
  assert.equal(countOf(html, '<script'), 0);
  assert.equal(countOf(html, '<b>School'), 0);
  assert.equal(countOf(html, '<i>2'), 0);
  assert.ok(html.includes('<span dir="auto">' + esc(floor.name) + '</span>'));
  assert.ok(html.includes('<span dir="auto">' + esc('<script>alert(1)</script> ויקי') + '</span>'));
  assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i);
});

test('the paper chosen is the paper used, and the same options give the same document, with no clock read', () => {
  const project = upstairs();
  for (const paper of [{ size: 'letter', orientation: 'portrait' }, { size: 'a4', orientation: 'landscape' }]) {
    const { html } = sheet.render(project, null, { ...NOW, paper });
    assert.ok(html.includes('data-paper="' + paper.size + '" data-orientation="' + paper.orientation + '"'));
    assert.equal(sheet.render(project, null, { ...NOW, paper }).html, html);
  }
  assert.equal(countOf(sheet.render(project, null, {}).html, 'doc-head__date'), 0, 'no date without a clock handed in');
});

// ---------------------------------------------------------------- the Step-free view's drawing and words (ui/safety)

import { stepFreeOverlay, endsOf } from '../../ui/safety/stepfree-overlay.js';
import { stepFreePicture, safetyPicture, refugeUse, stepFreeFirstLine } from '../../ui/safety/model.js';
import { buildGraph } from '../../engine/graph.js';

// A recording stand-in for a canvas 2D context: every call, in order, with the dash in force.
function recorder() {
  const calls = [];
  let dash = [];
  const g = new Proxy({}, {
    get(target, name) {
      if (name === 'calls') return calls;
      if (name === 'measureText') return (text) => ({ width: String(text).length * 6 });
      return (...args) => {
        if (name === 'setLineDash') dash = args[0];
        calls.push({ name, args, dash: dash.slice(), style: target.strokeStyle });
      };
    },
    set(target, name, value) {
      target[name] = value;
      return true;
    },
  });
  return g;
}

const THEME = { card: '#fff', ink: '#000', paper: '#eee', accent: '#0a0', problem: '#a00', font: 'sans-serif' };
const LABEL_ON = () => '#000';

function wayBuilding() {
  const project = planProject([STAIRS_HALL, STAIRS_HALL], { exits: [[1, 6, 2, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2]] });
  const floor = project.building.floors[0];
  floor.exits[0].stepFree = false;
  floor.refuges = [{ id: 'aplan00001', cell: 2 * floor.width + 1, name: 'Area of refuge' }];
  return project;
}

function pictureOf(project) {
  const graph = buildGraph(project);
  const picture = safetyPicture(project, graph);
  return { picture, step: stepFreePicture(project, graph, picture) };
}

test('stepFreePicture: every room by how it leaves, counts, the refuge used with where it stands, the words for the switch', () => {
  const project = wayBuilding();
  const { step } = pictureOf(project);
  assert.deepEqual(step.rooms.map((room) => room.way), ['refuge', 'refuge', 'none', 'none']);
  assert.deepEqual(step.counts, { exit: 0, refuge: 2, none: 2 });
  assert.equal(step.refuges[0].by, 'Stairs A', 'the stairs it stands by, found from the refuge\'s own cell');
  assert.equal(step.refuges[0].use, 'Used by 2 rooms.');
  assert.equal(refugeUse([]), 'Not used by any room.');
  assert.equal(refugeUse(['a']), 'Used by 1 room.');
  assert.equal(step.exits.length, 0, 'the one exit has a step, so no room goes out by it');
  assert.deepEqual(stepFreeFirstLine(project, step, null), [{ text: 'Step-free ways out: 0 to an exit, 2 to an area of refuge, 2 with no way out.', name: false }]);
  const room = stepFreeFirstLine(project, step, roomId('2A')).map((part) => part.text).join('');
  assert.equal(room, 'Room 2A on Floor 2 has no step-free way out: no step-free way through.');
});

test('the Step-free overlay: a way to a refuge dashed in the accent, a way to an exit solid, a room with none framed in the problem colour with ×, each end labelled in words', () => {
  const project = wayBuilding();
  const { step } = pictureOf(project);
  const rooms = step.rooms.map((room) => ({ roomId: room.roomId, floorId: room.floorId, cells: room.cells, way: room.way, route: room.route, exitId: room.exitId, refugeId: room.refugeId, exitName: room.exitName, refugeName: room.refugeName, colour: '#00f', mark: room.way === 'refuge' ? 'R' : '×' }));
  const ends = endsOf(rooms, project, (room) => (room.way === 'refuge' ? THEME.accent : room.colour));
  assert.deepEqual(ends.map((end) => [end.kind, end.label, end.floorId]), [['refuge', 'Area of refuge', floorId(1)]], 'one end, though two rooms wait there');
  const draw = stepFreeOverlay(() => ({ rooms, ends, picked: null }), LABEL_ON);
  const floor = project.building.floors[0];
  const g = recorder();
  draw(g, { x: 0, y: 0, size: 20 }, floor, THEME);
  const calls = g.calls;
  assert.ok(calls.some((call) => call.name === 'stroke' && call.dash.length > 0 && call.style === THEME.accent), 'a dashed line in the accent');
  // room 1A picked: its way to the refuge and its frame are both dashed in the accent, two strokes
  const picked = recorder();
  stepFreeOverlay(() => ({ rooms, ends, picked: roomId('1A') }), LABEL_ON)(picked, { x: 0, y: 0, size: 20 }, floor, THEME);
  assert.equal(picked.calls.filter((call) => call.name === 'stroke' && call.dash.length > 0 && call.style === THEME.accent).length, 2, 'the way and the frame, both dashed');
  assert.ok(calls.some((call) => call.name === 'fillText' && call.args[0] === 'R'), 'a refuge room\'s badge says R');
  assert.ok(calls.some((call) => call.name === 'strokeText' && call.args[0] === 'Area of refuge'), 'the end is labelled in words, on a halo');
  assert.ok(calls.some((call) => call.name === 'fillText' && call.args[0] === 'Area of refuge'));
  // the rooms upstairs are not on this floor
  const upper = recorder();
  draw(upper, { x: 0, y: 0, size: 20 }, project.building.floors[1], THEME);
  assert.ok(upper.calls.some((call) => call.name === 'fillText' && call.args[0] === '×'), 'a room with no way out is marked ×');
  assert.ok(upper.calls.some((call) => call.name === 'stroke' && call.style === THEME.problem), 'and framed in the problem colour');
  assert.ok(!upper.calls.some((call) => call.name === 'fillText' && call.args[0] === 'Area of refuge'), 'the end is on its own floor only');
  // zoomed out under the badges' size: no badge and no label
  const far = recorder();
  draw(far, { x: 0, y: 0, size: 4 }, floor, THEME);
  assert.ok(!far.calls.some((call) => call.name === 'fillText' || call.name === 'strokeText'));
  // with a room picked: its way alone, no badges
  const one = recorder();
  stepFreeOverlay(() => ({ rooms, ends, picked: roomId('1A') }), LABEL_ON)(one, { x: 0, y: 0, size: 20 }, floor, THEME);
  assert.ok(!one.calls.some((call) => call.name === 'fillText' && call.args[0] === 'R'));
  assert.ok(one.calls.some((call) => call.name === 'strokeText' && call.args[0] === 'Area of refuge'));
  // nothing to read: nothing drawn
  const none = recorder();
  stepFreeOverlay(() => null, LABEL_ON)(none, { x: 0, y: 0, size: 20 }, floor, THEME);
  assert.deepEqual(none.calls, []);
});

test('where a refuge stands is read from its own cell: the nearer of two stairs, not the last one listed', () => {
  const hall = ['.AA.BB.', '.AA.BB.', 'S#####S', '.......', '.......'];
  // the near stairs, by the refuge, are Stairs A and the far ones, listed last, Stairs B
  const project = planProject([hall, hall], { exits: [[1, 3, 3, 'Main Door']], connections: [[1, 0, 2, 2, 0, 2], [1, 6, 2, 2, 6, 2]] });
  const floor = project.building.floors[0];
  floor.exits[0].stepFree = false;
  floor.refuges = [{ id: 'aplan00001', cell: 2 * floor.width + 1, name: 'Area of refuge' }];
  const { step } = pictureOf(project);
  assert.equal(step.refuges[0].by, 'Stairs A');
}); 
