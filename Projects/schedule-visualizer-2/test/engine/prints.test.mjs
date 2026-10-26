// The printable outputs (ui/prints/): the frame every document shares, the
// floor plan, the room list and the checks report, rendered in plain Node
// from the sample school, from small drawn buildings, and from a school
// whose every name is hostile.
//
//   node test/engine/prints.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OUTPUTS, outputFor, renderOutput, printButtons } from '../../ui/prints/index.js';
import { esc, escXml, frame, paperOf, paperBox, printableBox, pageRule, printDate, PAPERS, ORIENTATIONS, MARGIN, TOOL_NAME } from '../../ui/prints/document.js';
import { planSvg, PLAN_INK, PLAN_ROOM_DEFAULT, PLAN_STYLE } from '../../ui/prints/plan-svg.js';
import { planImage, IMAGE_CELL } from '../../ui/prints/floor-plan.js';
import { PAPER_SIZES } from '../../engine/schema.js';
import { roomRows, sortRoomRows, ROOM_COLUMNS } from '../../ui/prints/room-list.js';
import { gridMarks, numbered, findingsFor } from '../../ui/prints/checks-report.js';
import { checkSchedule } from '../../engine/checks.js';
import { makeFinding } from '../../engine/findings.js';
import { teacherDays } from '../../engine/teacher-day.js';
import { SAMPLE_PROBLEMS, SAMPLE_SCHOOL_NAME } from '../../data/sample-school.js';
import { planProject } from '../fixtures/buildings/plans.mjs';
import { school, PINNED } from './helpers.mjs';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = { now: PINNED };
// What each paper's page rule says, written out here (SV2-32c: the sizes CSS
// has no keyword for are lengths, the way the sheet is read).
const PAGE_SIZES = {
  letter: { portrait: 'letter portrait', landscape: 'letter landscape' },
  a4: { portrait: 'A4 portrait', landscape: 'A4 landscape' },
  tabloid: { portrait: '279.4mm 431.8mm', landscape: '431.8mm 279.4mm' },
  a3: { portrait: '297mm 420mm', landscape: '420mm 297mm' },
  a2: { portrait: '420mm 594mm', landscape: '594mm 420mm' },
  a1: { portrait: '594mm 841mm', landscape: '841mm 594mm' },
  a0: { portrait: '841mm 1189mm', landscape: '1189mm 841mm' },
  'poster-24x36': { portrait: '609.6mm 914.4mm', landscape: '914.4mm 609.6mm' },
};
const PAPER_CHOICES = Object.keys(PAPERS).flatMap((size) => Object.keys(ORIENTATIONS).map((orientation) => ({ size, orientation })));

// Every tag a print document is made of. A name that came through as markup
// would bring a tag that is not here.
const TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'style', 'body', 'main', 'section', 'header', 'footer', 'div', 'p', 'h1', 'h2', 'ul', 'li', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'svg', 'g', 'path', 'text']);

function tagsOf(html) {
  return Array.from(html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)).map((match) => match[1]);
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// Text a person might type, or paste, into any name.
const HOSTILE = [
  '<script>alert("s")</script>',
  '"><img src=x onerror=alert(1)>',
  '</title></style><svg onload=alert(2)>',
  "O'Neil & <b>Sons</b>",
  '<!-- -->&amp;&lt;',
];

// The sample school with a hostile string in every name a user can type.
// Each gets a number so that every one is its own string.
function hostileSchool() {
  const project = school();
  let next = 0;
  const made = [];
  const nasty = (what) => {
    const value = HOSTILE[next % HOSTILE.length] + ' #' + next;
    next += 1;
    made.push({ what, value });
    return value;
  };
  project.settings.schoolName = nasty('school');
  for (const floor of project.building.floors) {
    floor.name = nasty('floor');
    for (const space of floor.spaces) {
      if (space.kind === 'room') {
        space.number = nasty('room');
        space.wing = nasty('wing');
      } else {
        space.label = nasty('other space');
      }
    }
    for (const corridor of floor.corridors) corridor.name = nasty('corridor');
    for (const exit of floor.exits) {
      exit.doorName = nasty('door');
      exit.assembly = nasty('assembly');
    }
  }
  for (const connection of project.building.connections) connection.label = nasty('stairs');
  for (const subject of project.subjects) {
    subject.name = nasty('subject');
    subject.code = nasty('code');
  }
  for (const teacher of project.teachers) teacher.name = nasty('teacher');
  for (const group of project.groups) group.name = nasty('group');
  for (const dayType of project.dayTypes) dayType.name = nasty('day type');
  return { project, made };
}

// ---------------------------------------------------------------- the frame

test('esc writes the five characters markup reads, and nothing else', () => {
  assert.equal(esc('<a href="x" title=\'y\'>&</a>'), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc('Ms. Okafor · 204 — 数学'), 'Ms. Okafor · 204 — 数学');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(30), '30');
  assert.equal(esc('&amp;'), '&amp;amp;', 'text that looks escaped already is escaped again: it is shown as typed');
});

test('the paper is what was asked, else the project\'s setting, else US Letter upright', () => {
  const project = school();
  project.settings.paper = { size: 'a4', orientation: 'landscape' };
  assert.deepEqual(paperOf(project, null), { size: 'a4', orientation: 'landscape' });
  assert.deepEqual(paperOf(project, { paper: { size: 'letter' } }), { size: 'letter', orientation: 'landscape' });
  assert.deepEqual(paperOf(project, { paper: { size: 'poster', orientation: 'sideways' } }), { size: 'a4', orientation: 'landscape' });
  assert.deepEqual(paperOf({ settings: {} }, null), { size: 'letter', orientation: 'portrait' });
  assert.deepEqual(paperBox({ size: 'letter', orientation: 'portrait' }), { width: 215.9, height: 279.4 });
  assert.deepEqual(paperBox({ size: 'a4', orientation: 'landscape' }), { width: 297, height: 210 });
  assert.deepEqual(printableBox({ size: 'a4', orientation: 'portrait' }), { width: 210 - MARGIN.left - MARGIN.right, height: 297 - MARGIN.top - MARGIN.bottom });
});

test('the papers are the setting\'s sizes, in its order: US Letter and A4, tabloid and A3, then the posters', () => {
  assert.deepEqual(Object.keys(PAPERS), PAPER_SIZES);
  assert.deepEqual(Object.keys(PAPERS), Object.keys(PAGE_SIZES));
  assert.deepEqual(Object.entries(PAPERS).filter(([, paper]) => paper.poster).map(([size]) => size), ['a2', 'a1', 'a0', 'poster-24x36']);
  // millimetres, upright: ISO 216 and the US sizes
  assert.deepEqual(Object.values(PAPERS).map((paper) => [paper.width, paper.height]), [[215.9, 279.4], [210, 297], [279.4, 431.8], [297, 420], [420, 594], [594, 841], [841, 1189], [609.6, 914.4]]);
  for (const paper of PAPER_CHOICES) assert.equal(pageRule(paper), '@page { size: ' + PAGE_SIZES[paper.size][paper.orientation] + '; }', paper.size + ' ' + paper.orientation);
});

test('the page rule names the size and the orientation, for both papers both ways', () => {
  assert.equal(pageRule({ size: 'letter', orientation: 'portrait' }), '@page { size: letter portrait; }');
  assert.equal(pageRule({ size: 'letter', orientation: 'landscape' }), '@page { size: letter landscape; }');
  assert.equal(pageRule({ size: 'a4', orientation: 'portrait' }), '@page { size: A4 portrait; }');
  assert.equal(pageRule({ size: 'a4', orientation: 'landscape' }), '@page { size: A4 landscape; }');
});

test('the date is written out in words, and is nothing for what is not a date', () => {
  assert.equal(printDate(PINNED), '1 September 2026');
  assert.equal(printDate(new Date('2026-12-25T09:00:00Z')), '25 December 2026');
  assert.equal(printDate(null), '');
  assert.equal(printDate('soon'), '');
});

test('every output is a whole document: header with school, what it is and the date; light; its page rule; a footer', () => {
  const project = school();
  for (const output of OUTPUTS) {
    for (const paper of PAPER_CHOICES) {
      const { title, html } = output.render(project, null, { ...NOW, paper });
      const at = output.id + ' on ' + paper.size + ' ' + paper.orientation;
      // a door sign is an upright sheet: it is portrait whatever is asked (SV2-45 item 2)
      const turn = output.upright === true ? 'portrait' : paper.orientation;
      assert.equal(title, output.name + ' · ' + SAMPLE_SCHOOL_NAME, at);
      assert.ok(html.startsWith('<!doctype html>\n<html lang="en" class="print-doc" data-theme="light" data-output="' + output.id + '" data-paper="' + paper.size + '" data-orientation="' + turn + '"'), at + ': the root');
      assert.equal(countOf(html, '<title>' + esc(title) + '</title>'), 1, at + ': the title');
      // written out here, not asked of pageRule(): a rule that ignored the paper would agree with itself
      const rule = '@page { size: ' + PAGE_SIZES[paper.size][turn] + '; }';
      assert.equal(countOf(html, '<style id="page-size">' + rule + '</style>'), 1, at + ': the page rule');
      assert.equal(countOf(html, '@page'), 1, at + ': one page rule and no other');
      assert.ok(html.includes('<link rel="stylesheet" href="ui/tokens.css">') && html.includes('<link rel="stylesheet" href="ui/print.css">'), at + ': the two stylesheets');
      assert.ok(countOf(html, '<p class="doc-head__school">' + esc(SAMPLE_SCHOOL_NAME) + '</p>') >= 1, at + ': the school');
      assert.ok(html.includes('<h1 class="doc-head__what">' + output.name), at + ': what this is');
      assert.ok(html.includes('<p class="doc-head__date">1 September 2026</p>'), at + ': the date');
      // a batch has no closing line: its last sheet is the paper's height, and the line was a sheet more (SV2-49 item 3)
      const batch = ['teacher-schedules', 'door-signs', 'door-signs-day', 'room-schedules', 'whole-school'].includes(output.id);
      assert.equal(countOf(html, '<footer class="doc-foot">' + TOOL_NAME + '</footer>'), batch ? 0 : 1, at + ': the footer');
      assert.ok(html.trimEnd().endsWith('</html>'), at + ': closed');
      assert.equal(countOf(html, '<header class="doc-head">'), countOf(html, '<section class="page">'), at + ': a header on every sheet');
      const stray = tagsOf(html).filter((tag) => !TAGS.has(tag));
      assert.deepEqual(stray, [], at + ': tags');
    }
  }
});

test('a school with no name prints under the tool\'s name, and a document with no date has no date line', () => {
  const project = school();
  project.settings.schoolName = '   ';
  const { title, html } = renderOutput('room-list', project, null, {});
  assert.equal(title, 'Room list · Schedule Visualizer 2');
  assert.ok(html.includes('<p class="doc-head__school">Schedule Visualizer 2</p>'));
  assert.ok(!html.includes('doc-head__date'));
});

test('the same project and options give the same document, byte for byte', () => {
  for (const output of OUTPUTS) {
    assert.equal(output.render(school(), null, NOW).html, output.render(school(), null, NOW).html, output.id);
  }
});

test('the stylesheets are found where the caller says they are', () => {
  const { html } = renderOutput('checks', school(), null, { base: 'http://127.0.0.1:8123/Projects/schedule-visualizer-2/ui/' });
  assert.ok(html.includes('<link rel="stylesheet" href="http://127.0.0.1:8123/Projects/schedule-visualizer-2/ui/print.css">'));
  const hostile = renderOutput('checks', school(), null, { base: '"><script>alert(1)</script>' }).html;
  assert.equal(countOf(hostile, '<script'), 0);
});

test('the outputs are listed once each, and every print button names one of them', () => {
  assert.deepEqual(OUTPUTS.map((output) => output.id), ['floor-plan', 'room-list', 'checks', 'teacher-schedules', 'door-signs', 'door-signs-day', 'room-schedules', 'whole-school', 'movement', 'congestion', 'door-cards', 'groups', 'teachers', 'teacher-grid', 'room-grid', 'travel-time', 'calendar']);
  for (const output of OUTPUTS) {
    assert.equal(typeof output.render, 'function');
    assert.equal(outputFor(output.id), output);
  }
  assert.equal(outputFor('lockdown-map'), null);
  assert.equal(renderOutput('lockdown-map', school(), null, {}), null);
  assert.deepEqual(printButtons.map((button) => button.output).sort(), ['checks', 'door-cards', 'floor-plan', 'groups', 'groups', 'room-grid', 'room-grid', 'room-list', 'teacher-grid', 'teacher-grid', 'teachers', 'teachers', 'travel-time']);
  assert.equal(new Set(printButtons.map((button) => button.id)).size, printButtons.length);
  for (const button of printButtons) {
    assert.ok(outputFor(button.output), button.id);
    assert.match(button.screen, /^#(building|schedule\/(checks|grid|teachers|import)|movement)$/);
    assert.ok(button.label.startsWith('Print '), button.id);
  }
});

test('frame() escapes what it is handed as text, and leaves the body as its maker wrote it', () => {
  const project = school();
  project.settings.schoolName = 'A & B <School>';
  const { title, html } = frame(project, { output: 'x"y', what: 'What <this> is', pages: [{ body: '<p>one</p>' }, { what: 'Second & last', body: '<p>two</p>' }], options: NOW });
  assert.equal(title, 'What <this> is · A & B <School>');
  assert.ok(html.includes('<title>What &lt;this&gt; is · A &amp; B &lt;School&gt;</title>'));
  assert.ok(html.includes('data-output="x&quot;y"'));
  assert.ok(html.includes('<h1 class="doc-head__what">What &lt;this&gt; is</h1>'));
  assert.ok(html.includes('<h1 class="doc-head__what">Second &amp; last</h1>'));
  assert.equal(countOf(html, '<section class="page">'), 2);
  assert.ok(html.includes('<p>one</p>') && html.includes('<p>two</p>'));
});

// ---------------------------------------------------------------- hostile names

test('hostile names come through every output as text, never as markup', () => {
  const { project, made } = hostileSchool();
  project.accepted = [{ findingId: 'room-double:' + SAMPLE_PROBLEMS.roomDouble.dayTypeId + ':1:rsample203', reason: HOSTILE[1] + ' reason', at: PINNED, about: [] }];
  const expected = {
    'floor-plan': ['school', 'floor', 'room', 'other space', 'corridor', 'door', 'stairs'],
    'room-list': ['school', 'floor', 'room', 'teacher', 'subject'],
    checks: ['school', 'room', 'teacher', 'group', 'day type'],
    'teacher-schedules': ['school', 'room', 'teacher', 'subject', 'group', 'day type'],
    'door-signs': ['school', 'floor', 'room', 'teacher', 'subject'],
    'door-signs-day': ['school', 'floor', 'room', 'teacher', 'subject', 'group', 'day type'],
    'room-schedules': ['school', 'floor', 'room', 'teacher', 'subject', 'group', 'day type'],
    'whole-school': ['school', 'floor', 'room', 'teacher', 'subject', 'group', 'day type'],
    movement: ['school', 'group', 'day type'],
    congestion: ['school', 'group', 'day type'],
    'door-cards': ['school', 'floor', 'room', 'other space', 'corridor', 'door', 'assembly', 'stairs'],
    groups: ['school', 'room', 'group', 'day type'],
    teachers: ['school', 'room', 'teacher', 'subject', 'code'],
    'teacher-grid': ['school', 'room', 'teacher', 'group', 'day type'],
    'room-grid': ['school', 'floor', 'room', 'group', 'day type'],
    'travel-time': ['school', 'room', 'group', 'day type'],
    calendar: ['school'],
  };
  for (const output of OUTPUTS) {
    for (const paper of [PAPER_CHOICES[0], PAPER_CHOICES[3]]) {
      const { title, html } = output.render(project, null, { ...NOW, paper });
      assert.ok(title.includes(project.settings.schoolName), output.id + ': the title is the name as typed');
      // not one of them is in the document as it was typed
      for (const { what, value } of made) assert.equal(countOf(html, value), 0, output.id + ': the ' + what + ' name ' + value + ' is in the markup as typed');
      for (const raw of HOSTILE) assert.equal(countOf(html, raw), 0, output.id + ': ' + raw);
      // and each kind of name this output prints is there, escaped
      for (const what of expected[output.id]) {
        const names = made.filter((entry) => entry.what === what);
        assert.ok(names.some((entry) => html.includes(esc(entry.value))), output.id + ': no ' + what + ' name was printed at all');
      }
      const stray = tagsOf(html).filter((tag) => !TAGS.has(tag));
      assert.deepEqual(stray, [], output.id + ': a tag that no print document has');
      assert.equal(countOf(html, '<title>'), 1, output.id);
      assert.equal(countOf(html, '</title>'), 1, output.id);
      assert.equal(countOf(html, '<style'), 1, output.id);
      assert.equal(countOf(html, '</style>'), 1, output.id);
      assert.equal(countOf(html, '<svg'), output.id === 'floor-plan' ? project.building.floors.length : output.id === 'door-cards' ? countOf(html, '<figure class="card__map"') : 0, output.id);
      // with every quoted value taken out (a quote inside one is &quot;), no tag has an event handler left in it
      assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, output.id + ': an event handler attribute');
    }
  }
  const checks = renderOutput('checks', project, null, NOW).html;
  assert.ok(checks.includes(esc(HOSTILE[1] + ' reason')), 'the reason a finding was accepted for');
});

test('the teacher\'s surname under a room number is text too', () => {
  const project = school();
  project.teachers.find((teacher) => teacher.id === 'tsample001').name = 'Ms. <i>Zed</i>';
  const { html } = renderOutput('floor-plan', project, null, NOW);
  assert.equal(countOf(html, '<i>'), 0);
  assert.ok(/<text class="plan__teacher"[^>]*>&lt;i&gt;Zed&lt;\/i&gt;<\/text>/.test(html));
});

test('a colour that is not a colour is never written into the plan', () => {
  const project = school();
  project.subjects[0].colour = 'red" onload="alert(1)';
  project.building.floors[0].spaces.find((space) => space.kind === 'other').colour = 'url(javascript:alert(1))';
  const { html } = renderOutput('floor-plan', project, null, NOW);
  assert.equal(countOf(html, 'onload'), 0);
  assert.equal(countOf(html, 'javascript'), 0);
  for (const fill of html.matchAll(/ fill="([^"]*)"/g)) assert.match(fill[1], /^#[0-9a-f]{6}$/);
  assert.ok(html.includes('fill="' + PLAN_ROOM_DEFAULT + '"'));
});

// ---------------------------------------------------------------- the floor plan

const SMALL = [
  '..........',
  '..........',
  '...AAB....',
  '...AAB....',
  '...####...',
  '..........',
];

test('the plan is cropped to what is drawn', () => {
  const project = planProject([SMALL], { doors: { '1A': [[3, 3, 's']] } });
  const plan = planSvg(project, project.building.floors[0]);
  // drawn from x 3 to 6 and y 2 to 4: four cells by three, a quarter cell around, 20 units a cell
  assert.ok(plan.svg.includes('viewBox="55 35 90 70"'), plan.svg.slice(0, 200));
  assert.equal(plan.width, 4.5);
  assert.equal(plan.height, 3.5);
  assert.equal(plan.rooms, 2);
  assert.equal(plan.exits, 0);
});

test('an exit with a door name gets a cell of room around the plan for the name', () => {
  const project = planProject([SMALL], { exits: [[1, 6, 4, 'Door <B>']] });
  const plan = planSvg(project, project.building.floors[0]);
  assert.ok(plan.svg.includes('viewBox="40 20 120 100"'), plan.svg.slice(0, 200));
  assert.equal(plan.exits, 1);
  assert.equal(countOf(plan.svg, '<path class="plan__exit"'), 1);
  assert.ok(plan.svg.includes('>Door &lt;B&gt;</text>'));
});

test('a floor with nothing drawn has no picture, and its sheet says so', () => {
  const project = planProject([['.....']]);
  const plan = planSvg(project, project.building.floors[0]);
  assert.deepEqual({ svg: plan.svg, drawn: plan.drawn }, { svg: '', drawn: false });
  const { html } = renderOutput('floor-plan', project, null, NOW);
  assert.equal(countOf(html, '<svg'), 0);
  assert.ok(html.includes('Nothing is drawn on Floor 1 yet.'));
});

test('a door is a gap in the room\'s outline', () => {
  const doorless = planProject([SMALL]);
  const doored = planProject([SMALL], { doors: { '1A': [[3, 3, 's']] } });
  const outline = (project) => /<g class="plan__space plan__space--room">\n<path class="plan__fill"[^>]*>\n<path class="plan__outline" d="([^"]*)"/.exec(planSvg(project, project.building.floors[0]).svg)[1];
  // room 1A's south edge under the cell at (3, 3) runs from (60, 80) to (80, 80)
  const edge = 'M60 80L80 80';
  assert.ok(outline(doorless).includes(edge), 'with no door the edge is whole');
  assert.ok(!outline(doored).includes(edge), 'with a door the whole edge is gone');
  assert.ok(outline(doored).includes('M60 80L64 80') && outline(doored).includes('M76 80L80 80'), 'and a fifth is left at each end');
});

test('a room with no number is outlined in dashes and carries no label', () => {
  const project = planProject([SMALL], { numbers: { '1B': '' } });
  const { svg } = planSvg(project, project.building.floors[0]);
  assert.equal(countOf(svg, 'plan__space--unnumbered'), 1);
  assert.equal(countOf(svg, 'class="plan__number"'), 1);
  assert.ok(svg.includes('>1A</text>'));
});

test('stairs carry their connection letters, and the caption names them', () => {
  const project = planProject([['AA#S', 'AA##'], ['BB#S', 'BB##']], { connections: [[1, 3, 0, 2, 3, 0]] });
  const first = planSvg(project, project.building.floors[0]);
  assert.deepEqual(first.letters, ['A']);
  assert.equal(countOf(first.svg, 'class="plan__chevron"'), 1);
  assert.ok(first.svg.includes('class="plan__letter"') && first.svg.includes('>A</text>'));
  const { html } = renderOutput('floor-plan', project, null, NOW);
  assert.ok(html.includes('Floor 1: 1 room, no exits, stairs A.'));
});

test('the sample school prints one sheet a floor, or the one floor asked for', () => {
  const project = school();
  const all = renderOutput('floor-plan', project, null, NOW).html;
  assert.equal(countOf(all, '<section class="page">'), 3);
  assert.equal(countOf(all, '<svg class="plan"'), 3);
  for (const floor of project.building.floors) assert.ok(all.includes('<h1 class="doc-head__what">Floor plan: ' + floor.name + '</h1>'));
  const second = project.building.floors[1];
  const one = renderOutput('floor-plan', project, null, { ...NOW, floorId: second.id }).html;
  assert.equal(countOf(one, '<section class="page">'), 1);
  assert.ok(one.includes('Floor plan: ' + second.name));
  assert.ok(one.includes('aria-label="Floor plan of ' + second.name + '"'));
  // every room number and every door name of the floor is on it
  const first = renderOutput('floor-plan', project, null, { ...NOW, floorId: project.building.floors[0].id }).html;
  for (const space of project.building.floors[0].spaces) {
    if (space.kind === 'room') assert.ok(first.includes('>' + esc(space.number) + '</text>'), space.number);
  }
  for (const exit of project.building.floors[0].exits) assert.ok(first.includes('>' + esc(exit.doorName) + '</text>'), exit.doorName);
  assert.ok(first.includes('Floor 1: 5 rooms, 2 exits, stairs A.'), /plan-figure__caption">([^<]*)/.exec(first)[1]);
});

test('the plan fits inside the margins of every paper, whichever way it is turned', () => {
  const project = school();
  for (const paper of PAPER_CHOICES) {
    const box = printableBox(paper);
    const { html } = renderOutput('floor-plan', project, null, { ...NOW, paper });
    const sizes = Array.from(html.matchAll(/class="plan-figure__plan" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/g));
    assert.equal(sizes.length, 3);
    for (const [, width, height] of sizes) {
      assert.ok(Number(width) <= box.width + 0.01, paper.size + ' ' + paper.orientation + ': ' + width + ' mm wide in ' + box.width);
      assert.ok(Number(height) <= box.height - 30, paper.size + ' ' + paper.orientation + ': ' + height + ' mm tall in ' + box.height);
      assert.ok(Number(width) > box.width * 0.5 || Number(height) > box.height * 0.5, 'and it is not a postage stamp');
    }
  }
});

// SV2-32c: on a poster the plan is as large as the sheet lets it be, not
// held at the size it has on Letter.
test('on every paper each floor is one sheet, its plan filling the sheet\'s width or the height under the header', () => {
  const project = school();
  for (const paper of PAPER_CHOICES) {
    const at = paper.size + ' ' + paper.orientation;
    const box = printableBox(paper);
    const { html } = renderOutput('floor-plan', project, null, { ...NOW, paper });
    assert.equal(countOf(html, '<section class="page">'), project.building.floors.length, at + ': a sheet a floor');
    const sizes = Array.from(html.matchAll(/class="plan-figure__plan" style="width: ([\d.]+)mm; height: ([\d.]+)mm;"/g)).map((match) => [Number(match[1]), Number(match[2])]);
    for (const [width, height] of sizes) {
      // 26 mm for the header and 12 for the sentence under the plan (floor-plan.js)
      const fills = Math.abs(width - box.width) <= 0.01 || Math.abs(height - (box.height - 38)) <= 0.01;
      assert.ok(fills, at + ': ' + width + ' by ' + height + ' mm in ' + box.width + ' by ' + (box.height - 38));
    }
  }
});

test('a building of a few cells is not blown up past 14 mm a cell on Letter, and past the same share of a poster\'s shorter side', () => {
  const project = planProject([['#######', '#.....#', '#######']]);
  for (const paper of PAPER_CHOICES) {
    const box = printableBox(paper);
    const { html } = renderOutput('floor-plan', project, null, { ...NOW, paper });
    const [, width] = /class="plan-figure__plan" style="width: ([\d.]+)mm;/.exec(html);
    const plan = planSvg(project, project.building.floors[0]);
    const cell = Number(width) / plan.width;
    const most = 14 * Math.max(1, Math.min(box.width, box.height) / (215.9 - 24));
    assert.ok(cell <= most + 0.01, paper.size + ' ' + paper.orientation + ': ' + cell + ' mm a cell');
  }
});

test('the traced image is not on paper, and neither is any mark of the editor', () => {
  const project = school();
  const floor = project.building.floors[0];
  floor.image = { imageId: 'isample001', opacity: 0.4, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 800, height: 600, missing: false };
  for (const options of [NOW, { ...NOW, traceImage: true }]) {
    const { html } = renderOutput('floor-plan', project, null, options);
    assert.equal(countOf(html, '<image'), 0);
    assert.equal(countOf(html, 'isample001'), 0);
    assert.equal(countOf(html, 'data:'), 0);
    assert.doesNotMatch(html, /selection|selected|hover|cursor|handle|preview/i);
  }
});

// A one-pixel PNG: what the preview sheet hands the plan is a data URL like it.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// Turned and scaled, so every number of the placement is its own.
const TRACED = { imageId: 'itraced001', opacity: 0.35, scale: 0.05, rotation: 30, x: 2, y: 3, visible: true, locked: false, width: 800, height: 400, missing: false };

function tracedSchool(change) {
  const project = school();
  project.building.floors[0].image = { ...TRACED, ...change };
  return project;
}

test('the traced image is off by default: bytes handed in are not drawn unless it is asked for', () => {
  const project = tracedSchool();
  for (const options of [{ ...NOW, traceImages: { itraced001: PIXEL } }, { ...NOW, traceImage: false, traceImages: { itraced001: PIXEL } }, { ...NOW, traceImage: 'yes', traceImages: { itraced001: PIXEL } }]) {
    const { html } = renderOutput('floor-plan', project, null, options);
    assert.equal(countOf(html, '<image'), 0);
    assert.equal(countOf(html, 'data:'), 0);
  }
  assert.equal(planSvg(project, project.building.floors[0]).traced, false);
  assert.equal(countOf(planSvg(project, project.building.floors[0], { traceImages: { itraced001: PIXEL } }).svg, '<image'), 0);
});

test('asked for and given its bytes, the traced image is under the plan where the screen has it: box, turn about its middle, opacity', () => {
  const project = tracedSchool();
  const floor = project.building.floors[0];
  const plan = planSvg(project, floor, { traceImage: true, traceImages: { itraced001: PIXEL } });
  assert.equal(plan.traced, true);
  assert.equal(countOf(plan.svg, '<image'), 1);
  // 800 by 400 pixels at 0.05 cells a pixel is 40 by 20 cells; a cell is 20 units; the middle is cell (22, 13)
  const box = ' x="40" y="60" width="800" height="400"';
  assert.ok(plan.svg.includes('<g class="plan__trace" transform="rotate(30 440 260)">'
    + '<rect class="plan__trace-backing"' + box + ' fill="#ffffff"/>'
    + '<image class="plan__trace-image"' + box + ' opacity="0.35" preserveAspectRatio="none" href="' + PIXEL + '"/></g>'), plan.svg.slice(0, 600));
  assert.ok(plan.svg.indexOf('<image') < plan.svg.indexOf('<path'), 'under the cells: it is drawn first');
  assert.equal(countOf(plan.svg, 'itraced001'), 0, 'the id of the stored image is not printed');
  // the picture is still cropped to the cells, image or no image
  const plain = planSvg(project, floor);
  assert.deepEqual([plan.width, plan.height], [plain.width, plain.height]);
  assert.equal(plan.svg.replace(/<g class="plan__trace".*?<\/g>\n/, ''), plain.svg, 'nothing else in the plan changes');
  // through the document: one image, on the one floor that has one
  const { html } = renderOutput('floor-plan', project, null, { ...NOW, traceImage: true, traceImages: { itraced001: PIXEL } });
  assert.equal(countOf(html, '<image'), 1);
  assert.equal(countOf(html, 'rotate(30 440 260)'), 1);
  assert.deepEqual(tagsOf(html).filter((tag) => !TAGS.has(tag) && tag !== 'image' && tag !== 'rect'), []);
});

test('asked for, the traced image is still not drawn without its bytes, when it is hidden, when it is missing, or on a floor with nothing drawn', () => {
  const on = { traceImage: true, traceImages: { itraced001: PIXEL } };
  const none = (project, options, why) => {
    const { html } = renderOutput('floor-plan', project, null, { ...NOW, ...options });
    assert.equal(countOf(html, '<image'), 0, why);
    assert.equal(countOf(html, 'plan__trace'), 0, why);
    assert.equal(countOf(html, 'data:'), 0, why);
  };
  none(tracedSchool(), { traceImage: true }, 'no bytes at all');
  none(tracedSchool(), { traceImage: true, traceImages: {} }, 'no bytes for this image');
  none(tracedSchool(), { traceImage: true, traceImages: { iother00001: PIXEL } }, 'another image\'s bytes');
  none(tracedSchool({ visible: false }), on, 'hidden on screen');
  none(tracedSchool({ missing: true }), on, 'not on this device');
  none(tracedSchool({ imageId: 'toString' }), { traceImage: true, traceImages: {} }, 'an id that is a word every object knows');
  const bare = planProject([['....', '....']]);
  bare.building.floors[0].image = { ...TRACED };
  none(bare, on, 'nothing is drawn on the floor');
});

test('only the bytes of an image are drawn: an address, or anything that is not a data URL of an image, is left out, and the URL is written as text', () => {
  const project = tracedSchool();
  for (const url of ['https://example.invalid/plan.png', '//example.invalid/plan.png', 'plan.png', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '', null, 5, { toString: () => PIXEL }]) {
    const { html } = renderOutput('floor-plan', project, null, { ...NOW, traceImage: true, traceImages: { itraced001: url } });
    assert.equal(countOf(html, '<image'), 0, String(url));
    assert.equal(countOf(html, 'example.invalid'), 0, String(url));
  }
  const nasty = 'data:image/png;base64,AAAA"><script>alert(1)</script>';
  const { html } = renderOutput('floor-plan', project, null, { ...NOW, traceImage: true, traceImages: { itraced001: nasty } });
  assert.equal(countOf(html, '<image'), 1);
  assert.equal(countOf(html, '<script'), 0);
  assert.ok(html.includes('href="' + esc(nasty) + '"'));
});

test('the plan\'s own ink and room colour are the light theme\'s', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'tokens.css'), 'utf8');
  const light = /\[data-theme="light"\],\s*\[data-theme="auto"\]\s*\{([^}]*)\}/.exec(css)[1];
  const token = (name) => new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})').exec(light)[1];
  assert.equal(PLAN_INK, token('ink'));
  assert.equal(PLAN_ROOM_DEFAULT, token('room-default'));
});

// ---------------------------------------------------------------- the room list

test('the room list has a row for every room, floor by floor, with what the list on screen shows', () => {
  const project = school();
  const rows = sortRoomRows(roomRows(project, 'all'), null);
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  assert.equal(rows.length, rooms.length);
  assert.deepEqual(rows.map((row) => row.floorIndex), rows.map((row) => row.floorIndex).slice().sort((a, b) => a - b), 'floor by floor');
  assert.deepEqual(rows.filter((row) => row.floorIndex === 0).map((row) => row.number), ['101', '102', '103', 'Cafeteria', 'Gym']);
  const first = rows.find((row) => row.number === '101');
  assert.deepEqual(first, { id: 'rsample101', number: '101', floor: 'Floor 1', floorIndex: 0, teachers: [project.teachers.find((teacher) => teacher.id === 'tsample001').name], subject: 'Mathematics', capacity: 30, shared: false });

  const { html } = renderOutput('room-list', project, null, NOW);
  assert.ok(html.includes('There are ' + rooms.length + ' rooms on 3 floors.'));
  assert.equal(countOf(html, '<tr>'), rooms.length + 1);
  assert.deepEqual(Array.from(html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)).map((match) => match[1]), ['Room', 'Floor', 'Teacher', 'Subject', 'Capacity', 'Shared']);
  assert.deepEqual(ROOM_COLUMNS.map((column) => column.id), ['number', 'floor', 'teacher', 'subject', 'capacity', 'shared']);
  assert.ok(html.includes('<tr><th scope="row">101</th><td>Floor 1</td><td>' + esc(first.teachers[0]) + '</td><td>Mathematics</td><td class="is-number">30</td><td></td></tr>'));
});

test('the room list sorts by a column, either way, and numbers sort as numbers', () => {
  const project = planProject([['AAB#', 'CCD#']], { numbers: { '1A': '10', '1B': '9', '1C': 'Gym', '1D': '100' } });
  const rows = roomRows(project, 'all');
  rows.find((row) => row.number === '9').capacity = 12;
  rows.find((row) => row.number === '100').capacity = 150;
  assert.deepEqual(sortRoomRows(rows, null).map((row) => row.number), ['9', '10', '100', 'Gym']);
  assert.deepEqual(sortRoomRows(rows, { column: 'number', direction: 'descending' }).map((row) => row.number), ['Gym', '100', '10', '9']);
  assert.deepEqual(sortRoomRows(rows, { column: 'capacity', direction: 'descending' }).map((row) => row.number), ['100', '9', '10', 'Gym']);
  assert.deepEqual(sortRoomRows(rows, { column: 'nothing', direction: 'ascending' }).map((row) => row.number), ['9', '10', '100', 'Gym']);
});

test('the room list for one floor names the floor; a room with no number says so; a shared room says so', () => {
  const project = school();
  const floor = project.building.floors[1];
  const rooms = floor.spaces.filter((space) => space.kind === 'room');
  const shared = rooms.filter((room) => room.shared).length;
  assert.equal(rooms[1].shared, false);
  rooms[0].number = '';
  rooms[1].shared = true;
  rooms[1].capacity = null;
  const { title, html } = renderOutput('room-list', project, null, { ...NOW, floorId: floor.id });
  assert.equal(title, 'Room list: Floor 2 · ' + SAMPLE_SCHOOL_NAME);
  assert.ok(html.includes('There are ' + rooms.length + ' rooms on Floor 2.'));
  assert.equal(countOf(html, '<tr>'), rooms.length + 1);
  assert.equal(countOf(html, '<th scope="row" class="is-missing">No number</th>'), 1);
  assert.equal(countOf(html, '<td>Shared</td>'), shared + 1);
  assert.ok(new RegExp('<th scope="row">' + rooms[1].number + '</th>.*<td class="is-number"></td><td>Shared</td></tr>').test(html));
});

test('a building with no rooms gets a sentence and no table', () => {
  const { html } = renderOutput('room-list', planProject([['####']]), null, NOW);
  assert.ok(html.includes('There are no rooms in the building yet.'));
  assert.equal(countOf(html, '<table'), 0);
});

// ---------------------------------------------------------------- the checks report

test('the checks report: the summary, a table for each severity, a grid for each own day type', () => {
  const project = school();
  const { findings } = checkSchedule(project, null);
  const { html } = renderOutput('checks', project, null, NOW);
  assert.ok(html.includes('The checks found 1 problem, no warnings and 2 notes in this schedule.'), /doc-lead">([^<]*)/.exec(html)[1]);
  assert.ok(html.includes('Walking times had not been worked out when this was printed'));
  assert.deepEqual(Array.from(html.matchAll(/<h2>([^<]*?)(?: <span class="doc-count">(\d+)<\/span>)?<\/h2>/g)).map((match) => match[1] + (match[2] ? ' ' + match[2] : '')),
    ['Problems 1', 'Warnings 0', 'Notes 2', 'Teachers by period: A Day', 'Teachers by period: B Day']);
  assert.ok(html.includes('<p class="doc-none">No warnings.</p>'));
  // every finding is there in full, under its number
  const problem = findings.find((finding) => finding.severity === 'problem');
  assert.ok(html.includes('<tr><th scope="row"><span class="mark mark--problem">P1</span></th><td>' + esc(problem.text) + '</td><td class="doc-when">A Day, Period 2</td></tr>'));
  for (const finding of findings) assert.equal(countOf(html, '<td>' + esc(finding.text) + '</td>'), 1, finding.id);
  assert.equal(countOf(html, 'mark--note">N2<'), 1);
  // the grids: a row a teacher, a column a period with its bell times
  assert.equal(countOf(html, '<table class="doc-table doc-grid">'), 2);
  const grid = html.slice(html.indexOf('Teachers by period: A Day'), html.indexOf('Teachers by period: B Day'));
  assert.equal(countOf(grid, '<tr><th scope="row"'), project.teachers.length);
  assert.equal(countOf(grid, '<th scope="col">Period '), project.settings.periods);
  assert.ok(grid.includes('<th scope="col">Period 1<span class="doc-grid__time">8:00–8:48</span></th>'), /<th scope="col">Period 1.*?<\/th>/.exec(grid)[0]);
  assert.ok(grid.includes('<span class="doc-grid__planning">Planning</span>'));
});

test('the grid marks the cells of the double-booked room, on its own day and no other', () => {
  const project = school();
  const { dayTypeId, period, groupIds } = SAMPLE_PROBLEMS.roomDouble;
  const { html } = renderOutput('checks', project, null, NOW);
  const cut = (from, to) => html.slice(html.indexOf(from), to ? html.indexOf(to) : html.length);
  const dayA = cut('Teachers by period: A Day', 'Teachers by period: B Day');
  const dayB = cut('Teachers by period: B Day');
  // who is with the two groups then, by the one rule for a teacher's day
  const days = teacherDays(project, dayTypeId);
  const with203 = project.teachers.filter((teacher) => days.get(teacher.id)[period].groups.some((taught) => groupIds.includes(taught.groupId)));
  assert.ok(with203.length >= 1);
  assert.equal(countOf(dayA, 'is-marked'), with203.length);
  assert.equal(countOf(dayA, '<span class="mark mark--problem">P1</span>'), with203.length);
  for (const teacher of with203) {
    const row = dayA.slice(dayA.indexOf('<tr><th scope="row">' + esc(teacher.name)));
    const cells = row.slice(0, row.indexOf('</tr>')).split('<td ').slice(1);
    assert.equal(cells.length, project.settings.periods);
    cells.forEach((cell, index) => assert.equal(cell.includes('is-marked'), index === period, teacher.name + ', period ' + index));
  }
  assert.equal(countOf(dayB, 'is-marked'), 0);
  assert.equal(countOf(dayB, 'class="mark'), 0);
});

test('a finding of one period marks its teacher\'s cell; a finding of a whole day marks the teacher\'s name; the rest mark nothing', () => {
  const project = school();
  const day = project.dayTypes[0].id;
  const other = project.dayTypes[1].id;
  const [first, second] = project.teachers;
  const days = teacherDays(project, day);
  const entries = numbered(project, [
    makeFinding('teacher-double', [day, 2, first.id], 'One.', { dayTypeId: day, period: 2, teacherId: first.id }),
    makeFinding('no-planning', [day, second.id], 'Two.', { dayTypeId: day, teacherId: second.id }),
    makeFinding('room-unused', [day, 'rsample101'], 'Three.', { dayTypeId: day, roomId: 'rsample101' }),
    makeFinding('room-no-subject', ['rsample101'], 'Four.', { roomId: 'rsample101' }),
    makeFinding('consecutive', [other, 0, first.id], 'Five.', { dayTypeId: other, period: 0, teacherId: first.id }),
  ]);
  assert.deepEqual(entries.map((entry) => entry.ref + ' ' + entry.finding.text), ['P1 One.', 'W1 Two.', 'W2 Five.', 'N1 Three.', 'N2 Four.']);
  const marks = gridMarks(project, day, days, entries);
  assert.deepEqual(Array.from(marks.cells.keys()), [first.id + ':2']);
  assert.deepEqual(marks.cells.get(first.id + ':2').map((entry) => entry.ref), ['P1']);
  assert.deepEqual(Array.from(marks.rows.keys()), [second.id]);
  assert.deepEqual(marks.rows.get(second.id).map((entry) => entry.ref), ['W1']);
  const there = gridMarks(project, other, teacherDays(project, other), entries);
  assert.deepEqual(Array.from(there.cells.keys()), [first.id + ':0']);
  assert.equal(there.rows.size, 0);
});

test('the report prints the findings it is handed, and runs the checks itself only when it has none', () => {
  const project = school();
  const day = project.dayTypes[0].id;
  const teacher = project.teachers[0];
  const handed = {
    findings: [makeFinding('teacher-walk', [day, 3, teacher.id], 'A walk the planner worked out & timed.', { dayTypeId: day, period: 3, teacherId: teacher.id })],
    accepted: [],
    gone: [],
  };
  const { html } = renderOutput('checks', project, { findings: handed, walks: { groups: [], teachers: [] } }, NOW);
  assert.ok(html.includes('The checks found no problems, 1 warning and no notes in this schedule.'));
  assert.ok(html.includes('<td>A walk the planner worked out &amp; timed.</td>'));
  assert.ok(!html.includes('Walking times had not been worked out'));
  assert.equal(countOf(html, 'Room 203 has two groups'), 0, 'its own run of the checks is not mixed in');
  const row = html.slice(html.indexOf('<tr><th scope="row">' + esc(teacher.name)));
  assert.ok(row.slice(0, row.indexOf('</tr>')).split('<td ')[4].includes('<span class="mark mark--warning">W1</span>'));

  assert.equal(findingsFor(project, null).walks, false);
  assert.equal(findingsFor(project, { walks: { groups: [], teachers: [] } }).walks, true);
  assert.equal(findingsFor(project, { findings: handed }).result, handed);
  assert.equal(findingsFor(project, { findings: handed }).walks, false);
});

test('an accepted finding leaves the counts and the grid and is listed apart with its reason', () => {
  const project = school();
  const { dayTypeId, period, roomId } = SAMPLE_PROBLEMS.roomDouble;
  project.accepted = [{ findingId: 'room-double:' + dayTypeId + ':' + period + ':' + roomId, reason: 'Both classes are at the assembly.', at: '2026-08-20T09:00:00.000Z', about: [] }];
  const { html } = renderOutput('checks', project, null, NOW);
  assert.ok(html.includes('The checks found no problems, no warnings and 2 notes in this schedule. 1 more finding has been accepted and is listed apart.'), /doc-lead">([^<]*)/.exec(html)[1]);
  assert.ok(html.includes('<p class="doc-none">No problems.</p>'));
  assert.ok(html.includes('<h2>Accepted <span class="doc-count">1</span></h2>'));
  assert.ok(/<td>Room 203 has two groups[^<]*<\/td><td>Both classes are at the assembly\.<\/td><td class="doc-when">20 August 2026<\/td>/.test(html));
  assert.equal(countOf(html, 'is-marked'), 0);
  assert.equal(countOf(html, 'mark--problem'), 0);
});

test('a day type that is the same as the first has no grid of its own, and the report says so', () => {
  const project = school();
  project.dayTypes[1].own = false;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  for (const group of project.groups) delete group.days[project.dayTypes[1].id];
  const { html } = renderOutput('checks', project, null, NOW);
  assert.equal(countOf(html, '<table class="doc-table doc-grid">'), 1);
  assert.ok(html.includes('B Day is the same as A Day and has no grid of its own.'));
});

test('the report uses the school\'s word for a period, and says when checks are switched off', () => {
  const project = school();
  project.settings.periodWord = 'Block';
  project.settings.timeFormat = '24h';
  project.settings.checks.off = ['room-no-subject', 'room-no-teacher'];
  const { html } = renderOutput('checks', project, null, NOW);
  assert.ok(html.includes('Teachers by block: A Day'));
  assert.ok(html.includes('<th scope="col">Block A<span class="doc-grid__time">08:00–08:48</span></th>'));
  assert.ok(html.includes('<td class="doc-when">A Day, Block B</td>'));
  assert.ok(html.includes('2 checks are switched off in Settings.'));
  assert.ok(html.includes('The checks found 1 problem, no warnings and no notes in this schedule.'));
});

test('a school with nothing in it still prints all three', () => {
  const project = planProject([['.....']]);
  for (const output of OUTPUTS) {
    const { html } = output.render(project, null, NOW);
    assert.ok(html.includes('<section class="page">'), output.id);
  }
  const { html } = renderOutput('checks', project, null, NOW);
  assert.ok(html.includes('The checks found nothing in this schedule.'));
  assert.equal(countOf(html, 'There are no teachers yet.'), project.dayTypes.filter((dayType, index) => index === 0 || dayType.own).length);
});

// ---------------------------------------------------------------- what the modules may touch

test('the print modules read no screen, clock or storage: a document is made from the model alone', () => {
  const dir = path.join(TOOL_DIR, 'ui', 'prints');
  const files = readdirSync(dir).filter((file) => file.endsWith('.js'));
  assert.deepEqual(files.sort(), ['batch.js', 'checks-report.js', 'congestion.js', 'document.js', 'door-cards.js', 'floor-plan.js', 'index.js', 'movement.js', 'plan-svg.js', 'room-list.js', 'schedule-grids.js', 'travel-time.js', 'calendar.js'].sort());
  for (const file of files) {
    const code = readFileSync(path.join(dir, file), 'utf8').replace(/\/\/.*$/gm, '');
    for (const name of [/\bdocument\.(?!js')/, /\bwindow\./, /\bnavigator\b/, /\blocalStorage\b/, /\bindexedDB\b/, /Date\.now/, /new Date\(\)/, /Math\.random/, /innerHTML/, /querySelector/, /getContext/]) {
      assert.doesNotMatch(code, name, file);
    }
  }
});

test('print.css keeps to its two roots and reaches for nothing outside the tool', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /@import|https?:|url\(/);
  // every rule outside @page starts from the document's root or the preview sheet
  const selectors = Array.from(css.replace(/@page\s*\{[\s\S]*?\n\}/, '').matchAll(/(^|\})\s*([^{}@]+)\{/g)).flatMap((match) => match[2].split(',').map((selector) => selector.trim()));
  assert.ok(selectors.length > 60);
  for (const selector of selectors) assert.match(selector, /^\.(print-doc|preview)(?![a-zA-Z0-9-])/, selector);
  assert.match(css, /@page\s*\{\s*margin: 12mm 12mm 16mm;/, 'the margins document.js lays the plan out for');
  assert.deepEqual(MARGIN, { top: 12, right: 12, bottom: 16, left: 12 });
});

// ---------------------------------------------------------------- the floor plan as a picture (SV2-32c)

// Every tag the picture is made of. A name that came through as markup would bring one that is not here.
const IMAGE_TAGS = new Set(['svg', 'title', 'style', 'rect', 'text', 'g', 'path']);
const FACE = 'data:font/woff2;base64,d09GMgABAAAAAA==';

test('the picture is the plan of every floor, one under the other, labelled as the print is and cropped to what is drawn', () => {
  const project = school();
  const image = planImage(project, NOW);
  assert.equal(image.drawn, true);
  assert.deepEqual(image.floors.map((floor) => floor.name), ['Floor 1', 'Floor 2', 'Floor 3']);
  assert.ok(image.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="' + image.width + '" height="' + image.height + '" viewBox="0 0 ' + image.width + ' ' + image.height + '">'));
  assert.equal(countOf(image.svg, '<title>Floor plan · ' + esc(SAMPLE_SCHOOL_NAME) + '</title>'), 1);
  // the heading: the school, what this is, the date; then each floor's name, its plan and the print's sentence
  const lines = Array.from(image.svg.matchAll(/<text class="img (img__[a-z]+)"[^>]*>([^<]*)<\/text>/g)).map((match) => match[1] + ': ' + match[2]);
  assert.deepEqual(lines.slice(0, 3), ['img__school: ' + esc(SAMPLE_SCHOOL_NAME), 'img__what: Floor plan', 'img__date: 1 September 2026']);
  assert.deepEqual(lines.filter((line) => line.startsWith('img__floor')), ['img__floor: Floor 1', 'img__floor: Floor 2', 'img__floor: Floor 3']);
  assert.ok(lines.includes('img__caption: Floor 1: 5 rooms, 2 exits, stairs A.'), lines.join(' / '));
  // each floor is the print's own plan, placed at IMAGE_CELL pixels a cell, centred, top to bottom without overlapping
  const placed = Array.from(image.svg.matchAll(/<svg class="plan" xmlns="http:\/\/www.w3.org\/2000\/svg" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"/g)).map((match) => match.slice(1, 5).map(Number).concat([match[5]]));
  assert.equal(placed.length, 3);
  let bottom = 0;
  project.building.floors.forEach((floor, index) => {
    const plan = planSvg(project, floor);
    const [x, y, width, height, viewBox] = placed[index];
    assert.equal(viewBox, /viewBox="([^"]+)"/.exec(plan.svg)[1], floor.name + ': cropped as the print is');
    assert.ok(Math.abs(width - plan.width * IMAGE_CELL) < 0.01 && Math.abs(height - plan.height * IMAGE_CELL) < 0.01, floor.name + ': ' + width + ' by ' + height);
    assert.ok(Math.abs(x + width / 2 - image.width / 2) < 0.01, floor.name + ': centred');
    assert.ok(y > bottom, floor.name + ' starts under what is above it');
    bottom = y + height;
  });
  assert.ok(bottom < image.height, 'the last floor is inside the picture');
  const widest = Math.max(...project.building.floors.map((floor) => planSvg(project, floor).width * IMAGE_CELL));
  assert.equal(image.width, Math.ceil(Math.max(640, widest) + 64), 'as wide as the widest plan and its margins');
  // on light paper, with nothing of the editor and no traced image
  assert.ok(image.svg.includes('<rect width="100%" height="100%" fill="#ffffff"/>'));
  assert.doesNotMatch(image.svg, /selection|selected|hover|cursor|handle|preview|<image/i);
  assert.deepEqual(tagsOf(image.svg).filter((tag) => !IMAGE_TAGS.has(tag)), []);
});

test('one floor is that floor alone under "Floor plan: its name"; the picture is as wide as its plan, and never under 640 pixels', () => {
  const project = school();
  const floor = project.building.floors[1];
  const image = planImage(project, { ...NOW, floorId: floor.id });
  assert.deepEqual(image.floors.map((each) => each.id), [floor.id]);
  assert.ok(image.svg.includes('>Floor plan: ' + esc(floor.name) + '</text>'));
  assert.equal(countOf(image.svg, 'class="img img__floor"'), 0, 'no floor line over a lone floor: the heading names it');
  assert.equal(countOf(image.svg, '<svg class="plan"'), 1);
  assert.equal(image.width, Math.ceil(Math.max(640, planSvg(project, floor).width * IMAGE_CELL) + 64));
  const wide = planProject([['#'.repeat(60), '#' + '.'.repeat(58) + '#', '#'.repeat(60)]]);
  assert.equal(planImage(wide, { floorId: wide.building.floors[0].id }).width, Math.ceil(60.5 * IMAGE_CELL + 64), 'a wide floor sets the width');
  const empty = planProject([['.....']]);
  const nothing = planImage(empty, { floorId: empty.building.floors[0].id });
  assert.equal(nothing.drawn, false);
  assert.ok(nothing.svg.includes('>Nothing is drawn on Floor 1 yet.</text>'));
});

test('the picture carries the faces it is given as data, and nothing else: no address, no file of its own', () => {
  const project = school();
  const fonts = [
    { family: 'Barlow Semi Condensed', weight: 600, url: FACE },
    { family: 'Public Sans', weight: 700, url: FACE },
    { family: 'Public Sans', weight: 400, url: 'https://fonts.example/public-sans.woff2' },
    { family: 'Public Sans', weight: 500, url: FACE + ') format("woff2"); } svg { display: none } @font-face { src: url(x' },
    { family: 'Bad"; } svg { display: none } x { a: "', weight: 500, url: FACE },
    { family: 'Public Sans', weight: '600', url: FACE },
  ];
  const { svg } = planImage(project, { ...NOW, fonts });
  assert.equal(countOf(svg, '@font-face'), 2, 'the two faces that are woff2 data, with a plain family and a whole weight');
  assert.ok(svg.includes('@font-face { font-family: "Barlow Semi Condensed"; font-weight: 600; font-style: normal; src: url(' + FACE + ') format("woff2"); }'));
  assert.equal(countOf(svg, 'url('), 2);
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, 'no address but the SVG namespace');
  assert.doesNotMatch(svg, /display: none/);
  assert.equal(countOf(planImage(project, NOW).svg, '@font-face'), 0, 'with none given the picture names the faces and carries none');
});

test('every name in the picture is text, escaped, and the picture is still one SVG', () => {
  const { project, made } = hostileSchool();
  for (const floorId of ['all', project.building.floors[0].id]) {
    const { svg } = planImage(project, { ...NOW, floorId });
    for (const { what, value } of made) assert.equal(countOf(svg, value), 0, 'the ' + what + ' name ' + value + ' is in the picture as typed');
    for (const raw of HOSTILE) assert.equal(countOf(svg, raw), 0, raw);
    assert.ok(svg.includes(esc(project.settings.schoolName)), 'the school, escaped');
    assert.deepEqual(tagsOf(svg).filter((tag) => !IMAGE_TAGS.has(tag)), [], floorId + ': a tag the picture has no use for');
    assert.equal(countOf(svg, '<svg'), countOf(svg, '</svg>'));
    assert.equal(countOf(svg, '<style>'), 1);
    assert.equal(countOf(svg, '</style>'), 1);
    assert.doesNotMatch(svg.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, 'an event handler attribute');
  }
});

// What XML 1.0 cannot hold: a C0 control but tab, newline and carriage return, U+FFFE, U+FFFF, a lone surrogate.
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('escXml writes each character XML cannot hold as U+FFFD and keeps the rest as esc() does (SV2-32k)', () => {
  assert.equal(escXml('a\u0000b\u0008c\u000bd\u000ce\u001ff'), 'a�b�c�d�e�f');
  assert.equal(escXml('tab\tnew\nline\rend'), 'tab\tnew\nline\rend', 'tab, newline and carriage return are XML');
  assert.equal(escXml('x￾y￿z'), 'x�y�z');
  assert.equal(escXml('lone \ud800 and \udc00, a pair 😀'), 'lone � and �, a pair 😀');
  assert.equal(escXml('<a href="x">O\'Brien & Ñandú, 王老师</a>'), esc('<a href="x">O\'Brien & Ñandú, 王老师</a>'));
  assert.equal(escXml(null), '');
  assert.equal(esc('a\u000bb'), 'a\u000bb', 'esc, for HTML, is as it was');
});

test('a control character in a floor, a room number, a teacher or the school: the picture writes it as U+FFFD and is XML; the print keeps it as typed (SV2-32k)', () => {
  const project = school();
  const floor = project.building.floors[0];
  const room = floor.spaces.find((space) => space.kind === 'room' && space.teacherIds.length > 0);
  const teacher = project.teachers.find((each) => each.id === room.teacherIds[0]);
  project.settings.schoolName = 'Marrow\u0001by ￾\ud800School';
  floor.name = 'Floor\u000b1';
  room.number = '1\u001f01';
  teacher.name = 'Ms. Ze\u0002d';
  const typed = [project.settings.schoolName, floor.name, room.number, 'Ze\u0002d'];
  for (const floorId of ['all', floor.id]) {
    const { svg } = planImage(project, { ...NOW, floorId });
    const bad = NOT_XML.exec(svg);
    assert.equal(bad, null, floorId + ': U+' + (bad ? bad[0].charCodeAt(0).toString(16).padStart(4, '0') : '') + ' at ' + (bad ? bad.index : -1) + ' is not XML');
    for (const value of typed) {
      assert.equal(countOf(svg, value), 0, floorId + ': ' + JSON.stringify(value) + ' as typed');
      assert.ok(svg.includes(escXml(value)), floorId + ': ' + JSON.stringify(escXml(value)) + ' in the picture');
    }
  }
  const { html } = renderOutput('floor-plan', project, null, { ...NOW, floorId: floor.id });
  for (const value of typed) assert.ok(html.includes(value), 'the print keeps ' + JSON.stringify(value) + ' as typed');
  assert.equal(countOf(html, '�'), 0, 'the print writes no U+FFFD');
});

test('a heading line whose Public Sans face the picture does not carry is sized in the face it falls back to (SV2-32k)', () => {
  const project = school();
  const floor = project.building.floors[0];
  floor.name = 'West Wing Upper Level '.repeat(2).trim();
  const what = 'Floor plan: ' + floor.name;
  const room = (width) => width - 64;
  const sizeOf = (svg, cls) => Number(new RegExp('class="img ' + cls + '"[^>]*font-size="([\\d.]+)"').exec(svg)[1]);
  const all = [400, 600, 700].map((weight) => ({ family: 'Public Sans', weight, url: FACE }));
  const asked = [];
  const measure = (value, weight) => {
    asked.push(weight + ' ' + value);
    return value.length * 0.9;
  };
  // carried at 700: the heading is sized by Public Sans, and the fallback is never measured
  const carried = planImage(project, { ...NOW, floorId: floor.id, fonts: all, measure });
  assert.deepEqual(asked, [], 'nothing measured when every face is carried');
  const publicSans = sizeOf(carried.svg, 'img__what');
  // not carried: measured in the fallback, at the line's weight
  const without = planImage(project, { ...NOW, floorId: floor.id, fonts: all.filter((face) => face.weight !== 700), measure });
  assert.deepEqual(asked, ['700 ' + what], 'the heading measured at 700 in the face the browser falls back to');
  const measured = sizeOf(without.svg, 'img__what');
  assert.equal(measured, Math.round(Math.max(10, Math.min(26, room(without.width) / (what.length * 0.9))) * 100) / 100, 'sized by the measure');
  assert.ok(measured < publicSans, measured + ' under ' + publicSans);
  // not carried and nothing to measure with: sized wider than Public Sans, never as if it were
  const unmeasured = sizeOf(planImage(project, { ...NOW, floorId: floor.id }).svg, 'img__what');
  assert.ok(unmeasured < publicSans, unmeasured + ' under ' + publicSans);
  // a measure that gives nothing a number is not taken
  assert.equal(sizeOf(planImage(project, { ...NOW, floorId: floor.id, measure: () => NaN }).svg, 'img__what'), unmeasured);
});

test('a long school name is set smaller to stay inside the picture, down to 8 pixels', () => {
  const project = school();
  project.settings.schoolName = 'Marrowby '.repeat(40).trim();
  const { svg, width } = planImage(project, NOW);
  const size = Number(/class="img img__school"[^>]*font-size="([\d.]+)"/.exec(svg)[1]);
  assert.ok(size < 16 && size >= 8, String(size));
  project.settings.schoolName = 'Marrowby Middle School';
  assert.equal(Number(/class="img img__school"[^>]*font-size="([\d.]+)"/.exec(planImage(project, NOW).svg)[1]), 16, 'a name that fits is set at 16');
  assert.ok(width >= 640);
});

test('the picture\'s plan looks as the printed plan does: print.css\'s plan rules with the light theme written in', () => {
  const tokens = readFileSync(path.join(TOOL_DIR, 'ui', 'tokens.css'), 'utf8');
  const light = /\[data-theme="light"\],\s*\[data-theme="auto"\]\s*\{([^}]*)\}/.exec(tokens)[1];
  const root = /:root\s*\{([^}]*)\}/.exec(tokens)[1];
  const token = (name) => {
    const found = new RegExp('--' + name + ':\\s*([^;]+);').exec(light) || new RegExp('--' + name + ':\\s*([^;]+);').exec(root);
    assert.ok(found, '--' + name);
    return found[1].trim();
  };
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const printed = new Map();
  for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(',').map((each) => each.trim())) {
      if (!/^\.print-doc \.plan(\b|__)/.test(selector) || /^\.print-doc \.plan-/.test(selector)) continue;
      const declarations = match[2].split(';').map((each) => each.trim()).filter(Boolean).map((each) => each.replace(/var\(--([a-z0-9-]+)\)/g, (all, name) => token(name)).replace(/\s+/g, ' '));
      const own = selector.replace(/^\.print-doc /, '');
      // .plan's display, width and height lay it out on a sheet; on a nested <svg> they would undo its placing
      printed.set(own, (printed.get(own) || []).concat(own === '.plan' ? declarations.filter((each) => !/^(display|width|height):/.test(each)) : declarations));
    }
  }
  const written = new Map(PLAN_STYLE.map(([selector, rules]) => [selector, rules.split(';').map((each) => each.trim().replace(/\s+/g, ' '))]));
  assert.deepEqual([...written.keys()].sort(), [...printed.keys()].sort(), 'the same parts of the plan');
  for (const [selector, rules] of printed) assert.deepEqual(written.get(selector), rules, selector);
});
