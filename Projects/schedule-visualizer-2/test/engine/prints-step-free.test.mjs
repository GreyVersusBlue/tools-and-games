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
