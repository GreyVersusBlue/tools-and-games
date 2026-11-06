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
import { transitionsCsv, dayCsv, travelDay, anyHeldBack, heldBackWords, transitionRows, lateWords } from '../../ui/movement/tables.js';
import { durationWords } from '../../ui/scenarios/model.js';
import { renderOutput, outputFor, printButtons } from '../../ui/prints/index.js';
import { esc } from '../../ui/prints/document.js';
import { school, emptyProject, assertValid, PINNED } from './helpers.mjs';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../engine/schema.js';
import { planProject, roomId } from '../fixtures/buildings/plans.mjs';

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

// ---------------------------------------------------------------- by bells (SV2-79)

test('SV2-79: the travel-time paper under a bell schedule is that run\'s tables, headed with the bells, with no transition that does not happen', () => {
  const project = school();
  const times = (p) => String(8 + Math.floor((33 * p) / 60)).padStart(2, '0') + ':' + String((33 * p) % 60).padStart(2, '0');
  const end = (p) => String(8 + Math.floor((33 * p + 30) / 60)).padStart(2, '0') + ':' + String((33 * p + 30) % 60).padStart(2, '0');
  project.bellSchedules = [{ id: 'bsample0er', name: 'Early Release', short: '', bells: Array.from({ length: 8 }, (_, p) => (p < 4 ? { start: times(p), end: end(p) } : null)), off: [4, 5, 6, 7] }];
  const world = derive(project);
  const { html } = renderOutput('travel-time', project, null, { ...NOW, dayTypeId: DAY_A, bellsId: 'bsample0er', movement: world });
  const sections = sectionsOf(html).filter((section) => section.classes === 'doc-section--travel');
  assert.deepEqual(sections.map((section) => section.heading), ['Period 1 to Period 2', 'Period 2 to Period 3', 'Period 3 to Period 4'], 'three transitions happen');
  assert.ok(html.includes('A Day with Early Release bells'), 'the heading names the bells');
  const file = transitionsCsv(project, world.results, DAY_A, 'bsample0er').slice(1);
  assert.equal(sections.reduce((sum, section) => sum + section.rows.length, 0), file.length, 'every walk in the file is on paper once');
  // without the choice the paper is the regular bells', as before
  const regular = renderOutput('travel-time', project, null, { ...NOW, dayTypeId: DAY_A, movement: world }).html;
  assert.ok(!regular.includes('Early Release'), 'regular bells say nothing of the schedule');
  assert.equal(sectionsOf(regular).filter((section) => section.classes === 'doc-section--travel').length, 7);
});

// ---------------------------------------------------------------- staggered dismissal (SV2-93)

// grade 7 held back two minutes after every period, every day type
function held(seconds) {
  const project = school();
  project.release = [{ id: 'lsample001', who: { grade: '7' }, seconds, after: null, dayTypeIds: null }];
  return derive(project);
}

test('SV2-93: a school with no staggered dismissal has no "Left after the bell" anywhere: the tables, the files and the report are what they were', () => {
  const html = renderOutput('travel-time', sample.project, null, { ...NOW, movement: sample }).html;
  assert.equal(html.includes('Left after the bell'), false, 'the print');
  assert.equal(html.includes('staggered'), false, 'and not a word about staggering');
  assert.deepEqual(transitionsCsv(sample.project, sample.results, DAY_A)[0], ['Day type', 'Transition', 'Passing time (seconds)', 'Group', 'From room', 'To room', 'Walking (seconds)', 'Waiting (seconds)', 'Total (seconds)', 'Late', 'Late by (seconds)']);
  assert.deepEqual(dayCsv(sample.project, sample.results, DAY_A)[0], ['Day type', 'Group', 'Walks', 'Walking (seconds)', 'Waiting (seconds)', 'Total (seconds)', 'Late walks', 'Slowest walk', 'Slowest walk (seconds)']);
  const report = renderOutput('congestion', sample.project, null, { ...NOW, movement: sample }).html;
  assert.equal(report.includes('Staggered dismissal is in force'), false);
  assert.equal(anyHeldBack(sample.results, DAY_A), false);
  assert.equal(heldBackWords(sample.project, sample.results, DAY_A), '');
});

test('SV2-93: a groups entry on the bell (0 s) is no delay: no column, the same paper and files', () => {
  // a delay of 0 on the bell is no delay: no column
  const project = school();
  project.release = [{ id: 'lsample002', who: { groups: ['gsample07a'] }, seconds: 0, after: null, dayTypeIds: null }];
  const world = derive(project);
  assert.equal(anyHeldBack(world.results, DAY_A), false);
  assert.equal(renderOutput('travel-time', project, null, { ...NOW, movement: world }).html, renderOutput('travel-time', sample.project, null, { ...NOW, movement: sample }).html, 'the same paper');
  assert.deepEqual(transitionsCsv(project, world.results, DAY_A), transitionsCsv(sample.project, sample.results, DAY_A), 'the same file');
});

test('SV2-93: with a delay the column stands between Waiting and Total on paper and in both files, and the total adds up', () => {
  const world = held(120);
  assert.equal(anyHeldBack(world.results, DAY_A), true);
  const html = renderOutput('travel-time', world.project, null, { ...NOW, dayTypeId: DAY_A, movement: world }).html;
  const file = transitionsCsv(world.project, world.results, DAY_A);
  assert.deepEqual(file[0], ['Day type', 'Transition', 'Passing time (seconds)', 'Group', 'From room', 'To room', 'Walking (seconds)', 'Waiting (seconds)', 'Left after the bell (seconds)', 'Total (seconds)', 'Late', 'Late by (seconds)']);
  const sections = sectionsOf(html).filter((section) => section.classes === 'doc-section--travel');
  const withRows = sections.filter((section) => section.rows.length > 0);
  assert.ok(withRows.length > 0);
  for (const section of withRows) {
    assert.deepEqual(section.head, ['Group', 'From', 'To', 'Walking', 'Waiting', 'Left after the bell', 'Total', 'Fits the passing time'], section.heading);
    const mine = file.slice(1).filter((row) => row[1] === section.heading);
    assert.deepEqual(section.rows.map((row) => row.slice(0, 6)), mine.map((row) => [row[3], roomOf(row[4]), roomOf(row[5]), time(row[6]), orNone(row[7]), orNone(row[8])]), section.heading);
  }
  const rows = file.slice(1);
  assert.ok(rows.some((row) => row[8] === 120), 'grade 7 left two minutes after the bell');
  assert.ok(rows.every((row) => (row[3].startsWith('7') ? row[8] === 120 : row[8] === 0)), 'and nobody else was held');
  for (const row of rows) assert.equal(row[6] + row[7] + row[8], row[9], row[3] + ': total = left after the bell + walking + waiting');
  const day = dayCsv(world.project, world.results, DAY_A);
  assert.deepEqual(day[0], ['Day type', 'Group', 'Walks', 'Walking (seconds)', 'Waiting (seconds)', 'Left after the bell (seconds)', 'Total (seconds)', 'Late walks', 'Slowest walk', 'Slowest walk (seconds)']);
  const wholeDay = sectionsOf(html).find((section) => section.classes.includes('doc-section--travel-day'));
  assert.deepEqual(wholeDay.head, ['Group', 'Walks', 'Walking', 'Waiting', 'Left after the bell', 'Total', 'Late walks', 'Slowest walk']);
  for (const row of day.slice(1)) {
    assert.equal(row[3] + row[4] + row[5], row[6], row[1] + ': the day adds up too');
    assert.equal(row[5] > 0, row[1].startsWith('7'), row[1]);
  }
  assert.ok(html.includes('Left after the bell is the time a group was held back by a staggered dismissal'));
});

test('SV2-93: a held group that is late says why in its Late cell, on paper and in the report; one that is on time says nothing of it', () => {
  const world = held(120);
  const file = transitionsCsv(world.project, world.results, DAY_A).slice(1);
  const lateHeld = file.filter((row) => row[10] === 'late' && row[8] > 0);
  assert.ok(lateHeld.length > 0, 'holding grade 7 back makes some of its walks late');
  const html = renderOutput('travel-time', world.project, null, { ...NOW, dayTypeId: DAY_A, movement: world }).html;
  for (const row of lateHeld) assert.ok(html.includes('Late by ' + time(row[11]) + ' · left 2 min after the bell'), row[3] + ' ' + row[1]);
  const onTime = file.filter((row) => row[10] === 'in time');
  assert.ok(onTime.length > 0);
  assert.equal(html.includes('In time ·'), false, 'in time says only that');
  const late = file.filter((row) => row[10] === 'late' && row[8] === 0);
  for (const row of late) assert.equal(html.includes('Late by ' + time(row[11]) + ' ·'), false, 'a late walk that was not held back names no cause');
  const report = renderOutput('congestion', world.project, null, { ...NOW, dayTypeId: DAY_A, movement: world }).html;
  assert.ok(report.includes('Late by ' + time(lateHeld[0][11]) + ' · left 2 min after the bell'), 'the report\'s late walks too');
});

test('SV2-93: the congestion report\'s first line names the staggered dismissal in force, from the walks', () => {
  const world = held(120);
  const report = renderOutput('congestion', world.project, null, { ...NOW, dayTypeId: DAY_A, movement: world }).html;
  const lead = report.match(/<p class="doc-lead">On A Day the busiest place[\s\S]*?<\/p>/)[0];
  assert.ok(text(lead).endsWith('Staggered dismissal is in force: 3 groups leave up to 2 min after the bell.'), text(lead));
  assert.equal(heldBackWords(world.project, world.results, DAY_A), 'Staggered dismissal is in force: 3 groups leave up to 2 min after the bell.');
  const one = school();
  one.release = [{ id: 'lsample003', who: { groups: ['gsample07a'] }, seconds: 45, after: [0], dayTypeIds: null }];
  const single = derive(one);
  assert.equal(heldBackWords(single.project, single.results, DAY_A), 'Staggered dismissal is in force: 1 group leaves up to 45 s after the bell.');
});

// ---------------------------------------------------------------- a school with an elevator (W4)
//
// Three floors of one hall with an elevator at the west end of each corridor
// (Elevator D, staff only). Ada needs step-free routes and has 20 students: a
// car carries 8, so she rides in 3 trips. Bo needs none and stays on Floor 1.
// The passing time is 60 s, which three trips cannot make.
function elevatorSchool(settings) {
  const hall = ['.AA.BB.', '.AA.BB.', '#######', '.......', '.......'];
  const project = planProject([hall, hall, hall], { exits: [[1, 6, 2, 'Main Door']] });
  const at = (number) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: 2 * floor.width };
  };
  for (const number of [1, 2, 3]) {
    const floor = project.building.floors[number - 1];
    const stop = at(number).cell;
    floor.cells = floor.cells.slice(0, stop) + 'S' + floor.cells.slice(stop + 1);
    floor.lifts = [stop];
  }
  [[1, 2], [2, 3]].forEach(([a, b], index) => {
    project.building.connections.push({ id: 'celev0000' + (index + 1), label: 'D' + (index + 1), a: at(a), b: at(b), direction: 'both', kind: 'elevator', staffOnly: true, car: 'D' });
  });
  project.settings.periods = 3;
  project.settings.defaultPassingSeconds = 60;
  Object.assign(project.settings, settings || {});
  for (const dayType of project.dayTypes) dayType.bells = emptyBells(3);
  const rows = { Ada: ['1A', '2A', '2A'], Bo: ['1A', '1B', '1B'] };
  project.groups = Object.keys(rows).map((name, index) => ({
    id: 'gplan0000' + (index + 1),
    name,
    grade: '',
    headCount: index === 0 ? 20 : null,
    colour: GROUP_COLOUR_PRESETS[index],
    ...(index === 0 ? { stepFree: true } : {}),
    days: { [project.dayTypes[0].id]: rows[name].map((number) => ({ ...emptySlot(), room: roomId(number) })) },
  }));
  assertValid(project);
  return project;
}

test('Riding is a column of the tables, the print and both files only when some group rides', () => {
  const project = elevatorSchool();
  const world = derive(project);
  const file = transitionsCsv(project, world.results, project.dayTypes[0].id);
  assert.deepEqual(file[0].slice(6, 9), ['Walking (seconds)', 'Riding (seconds)', 'Waiting (seconds)'], 'the transition file has it');
  const ada = file.find((row) => row[3] === 'Ada' && row[1] === 'Period 1 to Period 2');
  assert.equal(ada[7], 91, 'the 30 s wait, 6 s for a floor and two more round trips of 32 s, less the column\'s walk out');
  assert.equal(ada[6] + ada[7] + ada[8], ada[9], 'walking + riding + waiting is the total (nobody is held back)');
  const bo = file.find((row) => row[3] === 'Bo');
  assert.equal(bo[7], 0, 'a group that takes no car rides 0 s');
  const days = dayCsv(project, world.results, project.dayTypes[0].id);
  assert.deepEqual(days[0].slice(3, 6), ['Walking (seconds)', 'Riding (seconds)', 'Waiting (seconds)'], 'the whole-day file has it');
  const { html } = renderOutput('travel-time', project, null, { ...NOW, dayTypeId: project.dayTypes[0].id, movement: world });
  const [first] = sectionsOf(html).filter((section) => section.classes === 'doc-section--travel');
  assert.deepEqual(first.head, ['Group', 'From', 'To', 'Walking', 'Riding', 'Waiting', 'Total', 'Fits the passing time']);
  const [day] = sectionsOf(html).filter((section) => section.classes.includes('doc-section--travel-day'));
  assert.deepEqual(day.head, ['Group', 'Walks', 'Walking', 'Riding', 'Waiting', 'Total', 'Late walks', 'Slowest walk']);
  // a school with no elevator keeps today's shape, whatever else changed
  const plain = renderOutput('travel-time', sample.project, null, { ...NOW, dayTypeId: project.dayTypes[0].id, movement: sample }).html;
  assert.equal(plain.includes('Riding'), false, 'no ride, no column');
  assert.equal(transitionsCsv(sample.project, sample.results, project.dayTypes[0].id)[0].includes('Riding (seconds)'), false);
});

test('a late walk that rode names the elevator, the trips and the wait; a wait of 0 says so', () => {
  const project = elevatorSchool();
  const world = derive(project);
  const found = transitionRows(project, world.results, project.dayTypes[0].id, 0);
  const ada = found.rows.find((row) => row.group.name === 'Ada');
  assert.equal(ada.late, true);
  assert.deepEqual(ada.ride, { car: 'D', trips: 3, perTrip: 8, wait: 30 });
  assert.equal(lateWords(ada), 'Late by 43 s · 3 trips of 8 in Elevator D, 30 s wait');
  assert.equal(found.rows.find((row) => row.group.name === 'Bo').ride, undefined, 'a group that takes no car has no ride');
  const printed = renderOutput('travel-time', project, null, { ...NOW, dayTypeId: project.dayTypes[0].id, movement: world }).html;
  assert.ok(text(printed).includes('3 trips of 8 in Elevator D, 30 s wait'), 'on paper too');
  // one person's trip is one trip, and the school may have set the wait to 0
  const none = elevatorSchool({ elevatorWaitSeconds: 0, elevatorPeoplePerTrip: 40 });
  const fast = derive(none);
  const row = transitionRows(none, fast.results, none.dayTypes[0].id, 0).rows.find((each) => each.group.name === 'Ada');
  assert.deepEqual(row.ride, { car: 'D', trips: 1, perTrip: 40, wait: 0 });
  assert.equal(row.riding, 6, 'no wait: just the ride');
  assert.equal(lateWords({ ...row, late: true, over: 5, arrived: true }), 'Late by 5 s · Elevator D, no wait');
});
