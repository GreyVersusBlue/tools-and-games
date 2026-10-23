// The travel-time tables on paper (ui/prints/travel-time.js), against the two
// CSV files the movement view saves (ui/movement/tables.js transitionsCsv and
// dayCsv): the same walks in the same order with the same figures, a table a
// transition and one for the whole day.
//
//   node test/engine/prints-travel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { repair } from '../../engine/repair.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { transitionsCsv, dayCsv, travelDay } from '../../ui/movement/tables.js';
import { durationWords } from '../../ui/scenarios/model.js';
import { renderOutput, outputFor, printButtons } from '../../ui/prints/index.js';
import { esc } from '../../ui/prints/document.js';
import { school, emptyProject, PINNED } from './helpers.mjs';

const NOW = { now: PINNED };
const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function text(markup) {
  return markup.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]).trim();
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

function derive(project) {
  return { project, results: createPipeline().run(project), graph: buildGraph(project) };
}

// Each sheet's heading, then each section under it: its heading and the rows
// of its table as text, cell by cell.
function sectionsOf(html) {
  return Array.from(html.matchAll(/<section class="doc-section ([^"]*)"([^>]*)>([\s\S]*?)<\/section>/g)).map((match) => {
    const inside = match[3];
    const heading = inside.match(/<h2>([\s\S]*?)<\/h2>/);
    const body = inside.includes('<tbody>') ? inside.slice(inside.indexOf('<tbody>'), inside.indexOf('</tbody>')) : '';
    return {
      classes: match[1],
      period: (match[2].match(/data-period="(\d+)"/) || [])[1],
      heading: heading ? text(heading[1]) : null,
      head: inside.includes('<thead>') ? Array.from(inside.slice(inside.indexOf('<thead>'), inside.indexOf('</thead>')).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map((cell) => text(cell[1])) : [],
      rows: body.split('</tr>').filter((row) => row.includes('<tr')).map((row) => Array.from(row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)).map((cell) => text(cell[1]))),
      lateRows: (body.match(/<tr class="is-late">/g) || []).length,
      inside,
    };
  });
}

function whatOf(html) {
  return Array.from(html.matchAll(/<h1 class="doc-head__what">([\s\S]*?)<\/h1>/g)).map((match) => text(match[1]));
}

const time = (seconds) => durationWords(Number(seconds));
const orNone = (seconds) => (Number(seconds) === 0 ? 'none' : time(seconds));
const roomOf = (number) => (number === '' ? 'no number' : number);
// The file's late column in the paper's words.
function lateOf(row) {
  if (row[9] === 'did not arrive') return 'Did not arrive';
  return row[9] === 'late' ? 'Late by ' + time(row[10]) : 'In time';
}

const sample = derive(school());

// ---------------------------------------------------------------- one transition

test('each transition\'s table is the by-transition file\'s rows for it, in the file\'s order, with the same figures', () => {
  for (const dayType of ownDayTypes(sample.project)) {
    const { html } = renderOutput('travel-time', sample.project, null, { ...NOW, dayTypeId: dayType.id, movement: sample });
    const file = transitionsCsv(sample.project, sample.results, dayType.id).slice(1);
    const sections = sectionsOf(html).filter((section) => section.classes === 'doc-section--travel');
    assert.equal(sections.length, sample.project.settings.periods - 1, dayType.name + ': a section a transition');
    let walks = 0;
    for (const section of sections) {
      const mine = file.filter((row) => row[1] === section.heading);
      assert.ok(section.heading.startsWith('Period ' + (Number(section.period) + 1) + ' to '), section.heading);
      if (mine.length === 0) {
        assert.ok(section.inside.includes('Nobody walks in this transition.'), section.heading);
        continue;
      }
      assert.deepEqual(section.head, ['Group', 'From', 'To', 'Walking', 'Waiting', 'Total', 'Fits the passing time']);
      assert.deepEqual(section.rows, mine.map((row) => [row[3], roomOf(row[4]), roomOf(row[5]), time(row[6]), orNone(row[7]), time(row[8]), lateOf(row)]), dayType.name + ', ' + section.heading);
      assert.equal(section.lateRows, mine.filter((row) => row[9] !== 'in time').length, section.heading + ': the late rows are marked');
      assert.ok(section.inside.includes('Passing time ' + time(mine[0][2])), section.heading + ': its passing time');
      walks += mine.length;
    }
    assert.equal(walks, file.length, dayType.name + ': every walk in the file is on paper once');
  }
});

test('the sample school\'s long walk is late on paper as in the file', () => {
  const { html } = renderOutput('travel-time', sample.project, null, { ...NOW, movement: sample });
  const late = transitionsCsv(sample.project, sample.results, DAY_A).slice(1).filter((row) => row[9] === 'late');
  assert.ok(late.length >= 1, 'the sample has a walk too long for its passing time');
  assert.ok(html.includes('Late by ' + time(late[0][10])));
});

// ---------------------------------------------------------------- the whole day

test('the whole day is the by-group file\'s rows, on a sheet of its own', () => {
  for (const dayType of ownDayTypes(sample.project)) {
    const { html } = renderOutput('travel-time', sample.project, null, { ...NOW, dayTypeId: dayType.id, movement: sample });
    const file = dayCsv(sample.project, sample.results, dayType.id).slice(1);
    const [day] = sectionsOf(html).filter((section) => section.classes.includes('doc-section--travel-day'));
    assert.ok(day.classes.includes('new-sheet'), 'it starts a sheet');
    assert.equal(day.heading, 'Each group over the whole of ' + dayType.name);
    assert.deepEqual(day.head, ['Group', 'Walks', 'Walking', 'Waiting', 'Total', 'Late walks', 'Slowest walk']);
    assert.deepEqual(day.rows, file.map((row) => [row[1], String(row[2]), time(row[3]), orNone(row[4]), time(row[5]), row[6] === 0 ? 'none' : String(row[6]), row[7] + ', ' + time(row[8])]), dayType.name);
    assert.equal(day.lateRows, file.filter((row) => row[6] > 0).length);
  }
});

// ---------------------------------------------------------------- which day types

test('left to itself the print has every day type of its own, each starting a sheet; asked for one, that one alone', () => {
  const every = renderOutput('travel-time', sample.project, null, { ...NOW, movement: sample }).html;
  assert.deepEqual(whatOf(every), ['Travel time: A Day', 'Travel time: B Day']);
  const one = renderOutput('travel-time', sample.project, null, { ...NOW, dayTypeId: DAY_B, movement: sample }).html;
  assert.deepEqual(whatOf(one), ['Travel time: B Day']);
  // a day type the project does not have is every day type
  assert.deepEqual(whatOf(renderOutput('travel-time', sample.project, null, { ...NOW, dayTypeId: 'dnothere00', movement: sample }).html), ['Travel time: A Day', 'Travel time: B Day']);
});

test('a day type that is the same as A Day prints A Day\'s walks under its own name, said so, as its file does', () => {
  const project = school();
  const b = project.dayTypes[1];
  project.dayTypes[1] = { ...b, own: false, bells: b.bells.map(() => null) };
  for (const each of project.groups) delete each.days[b.id];
  const world = derive(repair(project).project);
  assert.equal(world.project.dayTypes[1].own, false);
  const chosen = renderOutput('travel-time', world.project, null, { ...NOW, dayTypeId: DAY_B, movement: world }).html;
  assert.equal(travelDay(world.project, DAY_B).heading, 'B Day (same as A Day)');
  assert.deepEqual(whatOf(chosen), ['Travel time: B Day (same as A Day)']);
  const fileB = transitionsCsv(world.project, world.results, DAY_B).slice(1);
  assert.ok(fileB.length > 0 && fileB.every((row) => row[0] === 'B Day (same as A Day)'));
  const printed = sectionsOf(chosen).filter((section) => section.classes === 'doc-section--travel').flatMap((section) => section.rows);
  assert.equal(printed.length, fileB.length);
  // left to itself: A Day, and a line for B Day
  const every = renderOutput('travel-time', world.project, null, { ...NOW, movement: world }).html;
  assert.deepEqual(whatOf(every), ['Travel time: A Day']);
  assert.ok(every.includes('<p class="doc-meaning">B Day is the same as A Day and has the same travel times.</p>'));
});

// ---------------------------------------------------------------- what it is made from

test('the movement view\'s own state is printed whole; with none, the figures are worked out from the project given', () => {
  const other = school();
  other.groups[0].name = 'Handed over';
  const world = derive(other);
  const { html } = renderOutput('travel-time', school(), null, { ...NOW, movement: world });
  assert.ok(html.includes('Handed over'), 'the view\'s project, not the one in the store');
  const worked = renderOutput('travel-time', school(), null, NOW).html;
  assert.equal(worked, renderOutput('travel-time', school(), null, { ...NOW, movement: sample }).html, 'the same document either way for the same school');
});

test('with nobody walking the day says so and has no tables; a margin is said with the rule for late', () => {
  const { html } = renderOutput('travel-time', emptyProject(), null, NOW);
  assert.equal(countOf(html, '<table'), 0);
  assert.ok(html.includes(esc('Nobody walks anywhere on A Day yet: give a group a room in two periods that follow each other.')));
  const project = school();
  project.settings.checks.passingMarginSeconds = 30;
  const margin = renderOutput('travel-time', project, null, NOW).html;
  assert.ok(margin.includes('A walk is late when it takes longer than the passing time and 30 s of margin.'));
  assert.ok(renderOutput('travel-time', school(), null, NOW).html.includes('A walk is late when it takes longer than the passing time.'));
});

test('a group that stays in one room all day is named under every transition, and has no row', () => {
  const project = school();
  // a group in one room all day
  const still = project.groups[0];
  still.name = 'Stays <put>';
  const room = project.building.floors[0].spaces.find((space) => space.kind === 'room');
  for (const dayTypeId of Object.keys(still.days)) still.days[dayTypeId] = still.days[dayTypeId].map(() => ({ room: room.id, roomText: '', label: '', teacherIds: [] }));
  const { html } = renderOutput('travel-time', project, null, { ...NOW, dayTypeId: DAY_A });
  assert.ok(html.includes(esc('Stays <put>') + ' stays in its room.'));
  assert.equal(countOf(html, esc('Stays <put>')), project.settings.periods - 1);
});

test('the print button is the Travel time tab\'s', () => {
  assert.equal(outputFor('travel-time').name, 'Travel time');
  assert.deepEqual(printButtons.filter((entry) => entry.output === 'travel-time').map((entry) => [entry.id, entry.screen, entry.label]), [['print-travel-time', '#movement', 'Print the travel times']]);
});
