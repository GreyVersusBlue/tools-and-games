// The schedule's prints (ui/prints/schedule-grids.js): the groups, the
// teacher list, the teachers by period and the rooms by period, against the
// CSV files of the same names (engine/exports.js). The cells on paper are the
// cells in the file, row for row; a grid is a sheet a day type that is its
// own copy, and one too wide for the sheet is cut by periods.
//
//   node test/engine/prints-schedule.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupsRows, teachersRows, teacherGridRows, roomGridRows, NOT_IN_BUILDING, PLANNING } from '../../engine/exports.js';
import { repair } from '../../engine/repair.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { periodName } from '../../engine/bells.js';
import { OUTPUTS, outputFor, renderOutput, printButtons, buttonLabel } from '../../ui/prints/index.js';
import { GRIDS, periodParts, partWords, groupDetails, NAME_MM, PERIOD_MM } from '../../ui/prints/schedule-grids.js';
import { PAPERS, ORIENTATIONS, printableBox, esc } from '../../ui/prints/document.js';
import { exportList, PRINTED } from '../../ui/schedule/import/exports.js';
import { school, emptyProject, PINNED } from './helpers.mjs';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = { now: PINNED };
const PAPER_CHOICES = Object.keys(PAPERS).flatMap((size) => Object.keys(ORIENTATIONS).map((orientation) => ({ size, orientation })));
const LETTER = { size: 'letter', orientation: 'portrait' };

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function text(markup) {
  return markup.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]);
}

// The text of the first element with this class inside a piece of markup, or null.
function classText(markup, name) {
  const match = markup.match(new RegExp('<span class="[^"]*\\b' + name + '\\b[^"]*">([\\s\\S]*?)</span>'));
  return match ? text(match[1]) : null;
}

// Every table of a document: its data attributes, its head cells and its
// rows, each row a list of cells as markup.
function tablesOf(html) {
  return Array.from(html.matchAll(/<table class="([^"]*)"([^>]*)>([\s\S]*?)<\/table>/g)).map((match) => {
    const attributes = Object.fromEntries(Array.from(match[2].matchAll(/data-([a-z]+)="([^"]*)"/g)).map((pair) => [pair[1], pair[2]]));
    const head = match[3].slice(0, match[3].indexOf('</thead>'));
    const body = match[3].slice(match[3].indexOf('<tbody>'));
    const cells = (row) => Array.from(row.matchAll(/<t([hd])([^>]*)>([\s\S]*?)<\/t[hd]>/g)).map((cell) => ({ kind: cell[1], attributes: cell[2], inside: cell[3] }));
    return {
      classes: match[1],
      ...attributes,
      head: cells(head),
      rows: body.split('</tr>').filter((row) => row.includes('<tr')).map((row) => ({ tag: row.slice(row.indexOf('<tr'), row.indexOf('>', row.indexOf('<tr')) + 1), cells: cells(row) })),
    };
  });
}

function whatOf(html) {
  return Array.from(html.matchAll(/<h1 class="doc-head__what">([\s\S]*?)<\/h1>/g)).map((match) => text(match[1]));
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// The sample school with B Day made the same as A Day again: no bells and
// no group days of its own (repair keeps a day type that still has days).
function followingB() {
  const project = school();
  const b = project.dayTypes[1];
  project.dayTypes[1] = { ...b, own: false, bells: b.bells.map(() => null) };
  for (const group of project.groups) delete group.days[b.id];
  const repaired = repair(project).project;
  assert.equal(repaired.dayTypes[1].own, false);
  return repaired;
}

// The sample school with as many periods as asked; repair sizes every day.
function withPeriods(n) {
  const project = school();
  project.settings.periods = n;
  return repair(project).project;
}

// ---------------------------------------------------------------- the rule that cuts a grid

test('a grid of every period fits the sheet when it can; when it cannot, it is cut into as few parts as fit, of equal size give or take one', () => {
  for (const paper of PAPER_CHOICES) {
    const room = printableBox(paper).width;
    for (let periods = 1; periods <= 16; periods += 1) {
      const parts = periodParts(paper, periods);
      const at = paper.size + ' ' + paper.orientation + ', ' + periods + ' periods';
      // every period once, in order
      assert.deepEqual(parts.flatMap((part) => Array.from({ length: part.to - part.from }, (unused, index) => part.from + index)), Array.from({ length: periods }, (unused, index) => index), at);
      // each part fits across the sheet beside the names
      for (const part of parts) assert.ok(NAME_MM + (part.to - part.from) * PERIOD_MM <= room, at + ': a part of ' + (part.to - part.from) + ' is wider than the sheet');
      // and one part fewer would not
      if (parts.length > 1) assert.ok(NAME_MM + Math.ceil(periods / (parts.length - 1)) * PERIOD_MM > room, at + ': fewer parts would have fitted');
      const sizes = parts.map((part) => part.to - part.from);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, at + ': parts of ' + sizes.join(', '));
      assert.deepEqual(sizes, sizes.slice().sort((a, b) => b - a), at + ': the longer parts first');
    }
  }
  // written out: eight periods fit US Letter and A4 upright; ten do not
  assert.deepEqual(periodParts(LETTER, 8), [{ from: 0, to: 8 }]);
  assert.deepEqual(periodParts({ size: 'a4', orientation: 'portrait' }, 8), [{ from: 0, to: 8 }]);
  assert.deepEqual(periodParts(LETTER, 10), [{ from: 0, to: 5 }, { from: 5, to: 10 }]);
  assert.deepEqual(periodParts({ size: 'letter', orientation: 'landscape' }, 16), [{ from: 0, to: 8 }, { from: 8, to: 16 }]);
  assert.deepEqual(periodParts({ size: 'a3', orientation: 'landscape' }, 16), [{ from: 0, to: 16 }]);
  assert.deepEqual(periodParts(LETTER, 11), [{ from: 0, to: 6 }, { from: 6, to: 11 }]);
});

test('the name column the rule leaves room for is the one print.css draws', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8');
  assert.match(css, new RegExp('\\.print-doc \\.doc-grid th:first-child \\{\\s*width: ' + NAME_MM + 'mm;'));
  // and the head row of every table repeats on each sheet a table runs on to
  assert.match(css, /\.print-doc \.doc-table thead \{\s*display: table-header-group;/);
});

test('a part is named by its periods in the school\'s own word', () => {
  const settings = { periods: 16, periodWord: 'Period' };
  assert.equal(partWords(settings, { from: 0, to: 5 }), 'Period 1 to Period 5');
  assert.equal(partWords(settings, { from: 15, to: 16 }), 'Period 16');
  assert.equal(partWords({ ...settings, periodWord: 'Block' }, { from: 0, to: 3 }), 'Block A to Block C');
  assert.equal(partWords({ ...settings, periodWord: 'Hour' }, { from: 1, to: 4 }), '2nd Hour to 4th Hour');
});

// ---------------------------------------------------------------- the groups

test('the groups print the groups file\'s cells: a sheet a day type, a row a group, the name, its grade and head count, and the room in each slot', () => {
  const project = school();
  const file = groupsRows(project);
  const { html } = renderOutput('groups', project, null, NOW);
  const own = ownDayTypes(project);
  assert.equal(own.length, 2, 'the sample school has two day types of its own');
  assert.deepEqual(whatOf(html), own.map((dayType) => 'Groups: ' + dayType.name));
  const tables = tablesOf(html);
  assert.equal(tables.length, own.length);
  own.forEach((dayType, day) => {
    const table = tables[day];
    assert.equal(table.day, dayType.id);
    assert.deepEqual(table.head.map((cell) => classText(cell.inside, 'doc-grid__period') || text(cell.inside)), ['Group'].concat(file[0].slice(4 + day * 8, 12 + day * 8).map((head) => head.replace(dayType.name + ' ', ''))));
    assert.equal(table.rows.length, project.groups.length);
    table.rows.forEach((row, index) => {
      const cells = file[index + 1];
      const at = dayType.name + ', ' + cells[0];
      assert.equal(row.tag, '<tr data-group="' + project.groups[index].id + '">', at);
      assert.equal(classText(row.cells[0].inside, 'doc-grid__name'), cells[0], at + ': the name');
      assert.equal(classText(row.cells[0].inside, 'doc-grid__time') || '', groupDetails(cells), at + ': grade and head count');
      assert.deepEqual(row.cells.slice(1).map((cell) => classText(cell.inside, 'doc-grid__slot') || ''), cells.slice(4 + day * 8, 12 + day * 8), at + ': the slots');
    });
  });
  assert.equal(groupDetails(['7-1', '7', '25', '#d1495b']), 'Grade 7, head count 25');
  assert.equal(groupDetails(['7-1', '', '25', '#d1495b']), 'Head count 25');
  assert.equal(groupDetails(['7-1', 'K', '', '#d1495b']), 'Grade K');
  assert.equal(groupDetails(['7-1', '', '', '#d1495b']), '');
});

test('a group\'s colour is a square of that colour by its name; a value that is not a colour is not written at all', () => {
  const project = school();
  project.groups[0].colour = 'red; background: url(https://example.com/x)';
  const { html } = renderOutput('groups', project, null, NOW);
  const first = tablesOf(html)[0].rows;
  assert.ok(!first[0].cells[0].inside.includes('doc-swatch'), 'no square for a colour that is not one');
  assert.ok(first[1].cells[0].inside.includes('border-left: 3mm solid ' + project.groups[1].colour + ';'), 'the second group\'s own colour');
  assert.equal(countOf(html, 'example.com'), 0);
});

test('a room that is not in the building prints as typed, said so under it', () => {
  const project = school();
  const dayTypeId = project.dayTypes[0].id;
  project.groups[0].days[dayTypeId][2] = { room: null, roomText: '999 <b>', label: '', teacherIds: [] };
  const { html } = renderOutput('groups', project, null, NOW);
  const slot = tablesOf(html)[0].rows[0].cells[3].inside;
  assert.equal(classText(slot, 'doc-grid__slot'), '999 <b>');
  assert.equal(classText(slot, 'doc-grid__missing'), 'not in the building');
  assert.equal(countOf(html, 'doc-grid__missing'), 1, 'and no other slot says so');
});

test('a day type that is the same as the first has no sheet of its own, and the last sheet says so', () => {
  for (const id of ['groups', 'teacher-grid', 'room-grid']) {
    const project = followingB();
    const { html } = renderOutput(id, project, null, NOW);
    assert.equal(tablesOf(html).length, 1, id);
    assert.ok(html.includes('<p class="doc-meaning">B Day is the same as A Day and has no grid of its own.</p>'), id);
  }
});

// ---------------------------------------------------------------- the teacher list

test('the teacher list prints the teachers file: its head and every row, in its order', () => {
  const project = school();
  const file = teachersRows(project);
  const { html } = renderOutput('teachers', project, null, NOW);
  const [table] = tablesOf(html);
  assert.deepEqual(table.head.map((cell) => text(cell.inside)), file[0]);
  assert.deepEqual(table.rows.map((row) => row.cells.map((cell) => text(cell.inside))), file.slice(1));
  assert.equal(countOf(html, '<section class="page">'), 1);
});

// ---------------------------------------------------------------- the teachers by period

test('the teachers by period print the file\'s cells for each day type of its own; a planning period is set apart', () => {
  const project = school();
  const { html } = renderOutput('teacher-grid', project, null, NOW);
  const own = ownDayTypes(project);
  assert.deepEqual(whatOf(html), own.map((dayType) => 'Teachers by period: ' + dayType.name));
  const tables = tablesOf(html);
  own.forEach((dayType, day) => {
    const file = teacherGridRows(project, dayType.id);
    assert.deepEqual(tables[day].head.map((cell) => classText(cell.inside, 'doc-grid__period') || text(cell.inside)), ['Teacher'].concat(file[0].slice(2)));
    const printed = tables[day].rows.map((row) => [classText(row.cells[0].inside, 'doc-grid__name')].concat(row.cells.slice(1).map((cell) => text(cell.inside))));
    assert.deepEqual(printed, file.slice(1).map((row) => [row[0]].concat(row.slice(2))), dayType.name);
    // planning is the class of a planning period, and of nothing else
    for (const row of tables[day].rows) {
      for (const cell of row.cells.slice(1)) assert.equal(cell.attributes.includes('is-planning'), text(cell.inside) === PLANNING, dayType.name + ': ' + text(cell.inside));
    }
  });
  assert.ok(tables[0].rows.some((row) => row.cells.some((cell) => cell.attributes.includes('is-planning'))), 'the sample has planning periods');
});

test('a group named Planning is taught, not planning', () => {
  const project = school();
  project.groups[0].name = PLANNING;
  const { html } = renderOutput('teacher-grid', project, null, NOW);
  const cells = tablesOf(html).flatMap((table) => table.rows.flatMap((row) => row.cells.slice(1)));
  assert.ok(cells.some((cell) => cell.attributes.includes('is-teaching') && text(cell.inside).startsWith(PLANNING + ' · ')), 'the group\'s slot is teaching');
});

// ---------------------------------------------------------------- the rooms by period

test('the rooms by period print the file\'s cells; a room the schedule names that is not in the building comes last, said so', () => {
  const project = school();
  const dayTypeId = project.dayTypes[0].id;
  project.groups[1].days[dayTypeId][4] = { room: null, roomText: 'Annex 1', label: '', teacherIds: [] };
  const { html } = renderOutput('room-grid', project, null, NOW);
  const own = ownDayTypes(project);
  const tables = tablesOf(html);
  own.forEach((dayType, day) => {
    const file = roomGridRows(project, dayType.id);
    const printed = tables[day].rows.map((row) => [classText(row.cells[0].inside, 'doc-grid__name'), classText(row.cells[0].inside, 'doc-grid__time')].concat(row.cells.slice(1).map((cell) => text(cell.inside))));
    assert.deepEqual(printed, file.slice(1).map((row) => [row[0], row[1]].concat(row.slice(3))), dayType.name);
  });
  const last = tables[0].rows[tables[0].rows.length - 1];
  assert.equal(last.tag, '<tr class="is-away">');
  assert.equal(classText(last.cells[0].inside, 'doc-grid__name'), 'Annex 1');
  assert.equal(classText(last.cells[0].inside, 'doc-grid__time'), NOT_IN_BUILDING);
  assert.equal(text(last.cells[5].inside), project.groups[1].name);
});

test('a room with no number says so where the number would be', () => {
  const project = school();
  const room = project.building.floors[0].spaces.find((space) => space.kind === 'room');
  room.number = '';
  const { html } = renderOutput('room-grid', project, null, NOW);
  assert.ok(html.includes('<span class="doc-grid__name"><span class="is-missing">No number</span></span>'));
});

// ---------------------------------------------------------------- cut by periods, and the school's word

test('a day too long for the sheet is printed in parts: each a sheet under its periods, the names repeated, every slot once', () => {
  const project = withPeriods(12);
  for (const id of ['groups', 'teacher-grid', 'room-grid']) {
    const { html } = renderOutput(id, project, null, { ...NOW, paper: LETTER });
    const own = ownDayTypes(project);
    const name = outputFor(id).name;
    assert.deepEqual(whatOf(html), own.flatMap((dayType) => [name + ': ' + dayType.name + ', Period 1 to Period 6', name + ': ' + dayType.name + ', Period 7 to Period 12']), id);
    const tables = tablesOf(html);
    assert.equal(tables.length, own.length * 2, id);
    for (let day = 0; day < own.length; day += 1) {
      const [one, two] = [tables[day * 2], tables[day * 2 + 1]];
      assert.deepEqual([one.from, one.to, two.from, two.to], ['0', '6', '6', '12'], id);
      assert.deepEqual(one.head.slice(1).map((cell) => classText(cell.inside, 'doc-grid__period')), Array.from({ length: 6 }, (unused, index) => periodName(project.settings, index)), id);
      assert.deepEqual(two.head.slice(1).map((cell) => classText(cell.inside, 'doc-grid__period')), Array.from({ length: 6 }, (unused, index) => periodName(project.settings, index + 6)), id);
      // the same rows, in the same order, in both parts
      assert.deepEqual(two.rows.map((row) => row.cells[0].inside), one.rows.map((row) => row.cells[0].inside), id + ': the names repeat');
      for (const row of one.rows.concat(two.rows)) assert.equal(row.cells.length, 7, id);
    }
    assert.equal(countOf(html, 'Part 1 of 2'), own.length, id);
    assert.equal(countOf(html, 'Part 2 of 2'), own.length, id);
    // turned, the same day fits one sheet
    const turned = renderOutput(id, project, null, { ...NOW, paper: { size: 'letter', orientation: 'landscape' } }).html;
    assert.equal(tablesOf(turned).length, own.length, id + ' on its side');
    assert.equal(countOf(turned, 'Part 1 of'), 0, id + ' on its side');
  }
  // the parts together are the file
  const file = teacherGridRows(project, project.dayTypes[0].id).slice(1);
  const tables = tablesOf(renderOutput('teacher-grid', project, null, { ...NOW, paper: LETTER }).html);
  const joined = tables[0].rows.map((row, index) => row.cells.slice(1).concat(tables[1].rows[index].cells.slice(1)).map((cell) => text(cell.inside)));
  assert.deepEqual(joined, file.map((row) => row.slice(2)));
});

test('the documents say the school\'s word for a period, and the buttons do too', () => {
  const project = school();
  project.settings.periodWord = 'Block';
  const teachers = renderOutput('teacher-grid', project, null, NOW);
  assert.equal(teachers.title, 'Teachers by block · ' + project.settings.schoolName);
  assert.deepEqual(whatOf(teachers.html), ['Teachers by block: A Day', 'Teachers by block: B Day']);
  assert.equal(classText(tablesOf(teachers.html)[0].head[1].inside, 'doc-grid__period'), 'Block A');
  assert.deepEqual(whatOf(renderOutput('room-grid', project, null, NOW).html), ['Rooms by block: A Day', 'Rooms by block: B Day']);
  const entry = printButtons.find((each) => each.id === 'print-grid-teachers');
  assert.equal(buttonLabel(entry, project.settings), 'Print the teachers by block');
  assert.equal(buttonLabel(printButtons.find((each) => each.id === 'print-grid-groups'), project.settings), 'Print the groups');
  assert.equal(buttonLabel(entry, { periodWord: 'Hour' }), 'Print the teachers by hour');
});

// ---------------------------------------------------------------- nothing yet

test('a project with nothing in it prints a sentence for each, and no table', () => {
  const project = emptyProject();
  const said = {
    groups: 'There are no groups yet.',
    teachers: 'There are no teachers yet.',
    'teacher-grid': 'There are no teachers yet.',
    'room-grid': 'There are no rooms yet, and no group is scheduled into a room.',
  };
  for (const output of GRIDS) {
    const { html } = output.render(project, null, NOW);
    assert.equal(tablesOf(html).length, 0, output.id);
    assert.ok(html.includes(esc(said[output.id])), output.id);
  }
});

// ---------------------------------------------------------------- where they are printed from

test('the four are outputs, and each has a button on the Import tab beside its file and one on the tab that shows it', () => {
  assert.deepEqual(GRIDS.map((output) => output.id), PRINTED);
  for (const output of GRIDS) assert.equal(outputFor(output.id), output);
  assert.ok(GRIDS.every((output) => OUTPUTS.includes(output)));
  // every printed kind is a file the panel offers
  const kinds = exportList(school().settings).map(([kind]) => kind);
  for (const kind of PRINTED) assert.ok(kinds.includes(kind), kind);
  for (const kind of PRINTED) {
    const entry = printButtons.find((each) => each.id === 'print-export-' + kind);
    assert.ok(entry, kind);
    assert.equal(entry.output, kind);
    assert.equal(entry.screen, '#schedule/import');
  }
  assert.deepEqual(printButtons.filter((entry) => entry.screen === '#schedule/grid').map((entry) => [entry.id, entry.output]), [['print-grid-groups', 'groups'], ['print-grid-teachers', 'teacher-grid'], ['print-grid-rooms', 'room-grid']]);
  assert.deepEqual(printButtons.filter((entry) => entry.screen === '#schedule/teachers').map((entry) => entry.output), ['teachers']);
});
