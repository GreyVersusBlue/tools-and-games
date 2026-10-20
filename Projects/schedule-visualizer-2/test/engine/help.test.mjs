// Help covers what the planner has (spec 3.15, 14): every section in the
// rail, every shortcut registered in the shell or a section's start(), every
// word of spec 2, and every setting the load, travel-time and late numbers
// are worked out from, with the default numbers read from the defaults.
//
//   node test/engine/help.test.mjs
//
// The rail and the shell's own shortcuts are read from ui/app.js's source
// (the module boots a page on import); every section module is imported and
// its start(ctx) run against a real shortcut list, as the shell does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { helpModel, numbers, words, gestures, SECTION_HELP, SHORTCUT_GROUPS, NOTHING_WRITTEN, duration } from '../../ui/help/content.js';
import { createShortcuts } from '../../ui/components/shortcuts.js';
import { defaultSettings, STUDENTS_PER_LANE_CELL } from '../../engine/schema.js';
import { CROSSING_WAIT_MAX } from '../../engine/crowd.js';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(path.join(TOOL, ...parts), 'utf8');
const APP = read('ui', 'app.js');

// The rail: `export const SECTIONS = [building, schedule, …]` and the import
// line that names each.
async function railSections() {
  const listed = APP.match(/export const SECTIONS = \[([^\]]*)\]/);
  assert.ok(listed, 'ui/app.js has no `export const SECTIONS = [...]` line to read the rail from');
  const names = listed[1].split(',').map((each) => each.trim()).filter(Boolean);
  const sections = [];
  for (const local of names) {
    const line = APP.match(new RegExp("import \\{ section as " + local + " \\} from '([^']+)'"));
    assert.ok(line, 'ui/app.js has no import line for the rail\'s ' + local);
    const mod = await import(pathToFileURL(path.join(TOOL, 'ui', line[1])).href);
    sections.push(mod.section);
  }
  return sections;
}

// Everything the shell and the sections put on the shortcut list.
async function registered(sections) {
  const shortcuts = createShortcuts();
  // the shell's own lines: one for each section, then its literal entries
  for (const each of sections) shortcuts.add({ id: 'section-' + each.id, group: 'Sections', does: 'Open ' + each.name, key: each.key });
  const adds = APP.match(/shortcuts\.add\(/g) || [];
  const literal = [...APP.matchAll(/shortcuts\.add\(\{\s*id: '([^']+)',\s*group: '([^']+)',\s*does: '((?:[^'\\]|\\.)*)'(?:,\s*(only): '([a-z]+)')?/g)];
  // the loop over SECTIONS is the one add without a literal id
  assert.equal(literal.length, adds.length - 1, 'a shortcuts.add( in ui/app.js is in a shape this test cannot read; teach it the shape');
  for (const [, id, group, does] of literal) shortcuts.add({ id, group, does, shown: id });
  // each section's start(ctx), as the shell runs it at boot
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { readyState: 'loading', querySelector: () => null };
  globalThis.window = { addEventListener() {} };
  try {
    const ctx = {
      shortcuts,
      store: { project: { id: 'p0000000000', settings: defaultSettings() }, subscribe() {} },
      clock: () => new Date('2026-09-01T12:00:00Z'),
    };
    for (const each of sections) {
      if (!each.start) continue;
      try {
        each.start(ctx);
      } catch (error) {
        assert.fail(each.id + '.start(ctx) threw in Node (' + error.message + '): give the fake ctx here what it needs');
      }
    }
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
  return shortcuts.list();
}

const allText = (model) => JSON.stringify(model);

test('every section in the rail has its purpose and its first step, in the rail’s order', async () => {
  const sections = await railSections();
  assert.deepEqual(sections.map((each) => each.id), ['building', 'schedule', 'movement', 'scenarios', 'safety', 'staff', 'project']);
  const model = helpModel({ sections, current: 'movement' });
  assert.deepEqual(model.sections.map((each) => each.id), sections.map((each) => each.id));
  for (const each of model.sections) {
    assert.equal(each.written, true, 'Help has nothing written for the section ' + each.id + ': add it to SECTION_HELP in ui/help/content.js');
    assert.ok(each.purpose.length > 40 && each.first.length > 40, each.id + ' has no purpose or no first step');
    assert.equal(each.name, sections.find((s) => s.id === each.id).name, 'the section is named as the rail names it');
  }
  assert.equal(model.current.id, 'movement');
  assert.deepEqual(model.sections.filter((each) => each.here).map((each) => each.id), ['movement']);
});

test('a section the rail has and Help does not still shows, saying Help has nothing for it', () => {
  const model = helpModel({ sections: [{ id: 'atlas', name: 'Atlas', key: '8' }] });
  assert.equal(model.sections[0].written, false);
  assert.equal(model.sections[0].purpose, NOTHING_WRITTEN);
  for (const id of Object.keys(SECTION_HELP)) assert.ok(typeof SECTION_HELP[id].purpose !== 'undefined');
});

test('every shortcut the shell and the sections’ start() register is in Help once, under a group Help explains', async () => {
  const sections = await railSections();
  const rows = await registered(sections);
  // the shell's, Building's, the grid's, Movement's and Safety's
  for (const id of ['section-building', 'section-project', 'undo', 'redo', 'search', 'search-slash', 'help', 'regions', 'escape', 'field-enter', 'tool-select', 'plan-arrows', 'grid-fill', 'movement-fit', 'safety-enter']) {
    assert.ok(rows.some((row) => row.id === id), 'the registry this test built has no ' + id);
  }
  const model = helpModel({ sections, shortcuts: rows });
  assert.deepEqual(model.keys.rows.map((row) => row.id), rows.map((row) => row.id), 'Help lists the shortcuts as registered, each once, in order');
  const groups = [...new Set(rows.map((row) => row.group))];
  assert.deepEqual(model.keys.groups.map((each) => each.group), groups);
  for (const each of model.keys.groups) assert.equal(each.written, true, 'Help has no sentence for the shortcut group "' + each.group + '": add it to SHORTCUT_GROUPS in ui/help/content.js');
  // a group nobody registers has no business in Help
  for (const group of Object.keys(SHORTCUT_GROUPS)) assert.ok(groups.includes(group), 'SHORTCUT_GROUPS explains "' + group + '", which nothing registers');
});

test('a shortcut group Help has no sentence for still shows, saying so', () => {
  const model = helpModel({ shortcuts: [{ id: 'atlas-x', group: 'Atlas', does: 'Spin the globe', keys: 'G' }, { id: 'x', group: 'constructor', does: 'x', keys: 'Y' }] });
  assert.deepEqual(model.keys.groups.map((each) => [each.group, each.written, each.says]), [['Atlas', false, NOTHING_WRITTEN], ['constructor', false, NOTHING_WRITTEN]]);
});

// Spec 2, the vocabulary table, in its order.
const SPEC_WORDS = ['Project', 'Floor', 'Cell', 'Room', 'Other space', 'Corridor', 'Stairs', 'Elevator', 'Exit', 'Door', 'Period', 'Day type', 'Passing time', 'Transition', 'Group', 'Teacher', 'Subject', 'Load', 'Scenario', 'Finding'];

test('every word of spec 2 is explained, in the spec’s order, with the school’s own period word', () => {
  assert.deepEqual(words(defaultSettings()).map((each) => each.term), SPEC_WORDS);
  for (const each of words(defaultSettings())) assert.ok(each.meaning.endsWith('.') && each.meaning.length > 20, each.term + ' is not explained in a sentence');
  const block = words({ ...defaultSettings(), periodWord: 'Block' });
  assert.deepEqual(block.map((each) => each.term), SPEC_WORDS.map((term) => (term === 'Period' ? 'Block' : term)));
  assert.match(block.find((each) => each.term === 'Block').meaning, /This school calls it a block/);
  assert.match(block.find((each) => each.term === 'Passing time').meaning, /one block and the start of the next/);
  assert.equal(words(undefined).length, SPEC_WORDS.length);
});

// The settings the engines read for load, routes, the crowd and the passing
// time, found in their source. Left out, each for its reason: periods (how
// many transitions there are, no figure's size), periodWord and timeFormat
// (words and clock faces), checks (read whole to reach its fields, which are
// named one by one).
const NOT_A_NUMBER = new Set(['periods', 'periodWord', 'timeFormat', 'checks', 'colourScale']);

function settingsTheEnginesRead() {
  const found = new Set();
  for (const file of ['routing.js', 'load.js', 'crowd.js', 'bells.js']) {
    for (const [, name] of read('engine', file).matchAll(/settings\.([A-Za-z]+(?:\.[A-Za-z]+)?)/g)) {
      if (!NOT_A_NUMBER.has(name)) found.add(name);
    }
  }
  // load.js reads the colour scale through a helper: its two fields
  if (/settings\.colourScale/.test(read('engine', 'load.js'))) {
    found.add('colourScale.mode');
    found.add('colourScale.bands');
  }
  return [...found].sort();
}

const at = (object, dotted) => dotted.split('.').reduce((value, key) => (value == null ? value : value[key]), object);

test('every setting the load, travel-time and late numbers depend on is in Help, with its default read from the defaults', () => {
  const needed = settingsTheEnginesRead();
  const parts = numbers(defaultSettings());
  assert.deepEqual(parts.map((each) => each.id), ['load', 'travel', 'late']);
  const used = new Set(parts.flatMap((each) => each.uses));
  for (const name of needed) assert.ok(used.has(name), 'Help does not say how ' + name + ' goes into the numbers: add it to numbers() in ui/help/content.js');
  // and the search above finds what it should: a pattern that found nothing would pass the loop
  for (const name of ['checks.passingMarginSeconds', 'colourScale.bands', 'colourScale.mode', 'defaultHeadCount', 'defaultPassingSeconds', 'secondsPerCell', 'secondsPerStair']) assert.ok(needed.includes(name), 'the engines\' source no longer shows ' + name + ' being read');
  const defaults = defaultSettings();
  const text = parts.flatMap((each) => each.sentences).join(' ');
  assert.match(text, new RegExp('\\b' + defaults.secondsPerCell + ' seconds \\(the default\\) for each square of corridor'));
  assert.match(text, new RegExp('\\b' + defaults.secondsPerStair + ' seconds \\(the default\\) on stairs'));
  assert.match(text, new RegExp('counts as ' + defaults.defaultHeadCount + ' students \\(the default\\)'));
  assert.match(text, new RegExp(duration(defaults.defaultPassingSeconds) + ' \\(the default\\)'));
  assert.match(text, /plus the passing margin: 0 seconds \(the default\)/);
  assert.match(text, new RegExp(defaults.colourScale.bands.join(', ') + ' \\(the default\\)'));
  assert.match(text, new RegExp('one square long for every ' + STUDENTS_PER_LANE_CELL + ' students'));
  assert.match(text, new RegExp('at most ' + CROSSING_WAIT_MAX + ' seconds'));
});

test('a project’s own numbers are shown beside the defaults', () => {
  const defaults = defaultSettings();
  const mine = { ...defaults, secondsPerCell: 5, defaultHeadCount: 30, defaultPassingSeconds: 270, checks: { ...defaults.checks, passingMarginSeconds: 20 }, periodWord: 'Mod' };
  const text = numbers(mine).flatMap((each) => each.sentences).join(' ');
  assert.match(text, /5 seconds \(the default is 3 seconds\) for each square of corridor/);
  assert.match(text, /counts as 30 students \(the default is 25 students\)/);
  assert.match(text, /a group of 30 is 5 squares long/);
  assert.match(text, /4 minutes 30 seconds \(the default is 4 minutes\)/);
  assert.match(text, /20 seconds \(the default is 0 seconds\)/);
  assert.match(text, /between one mod and the next/);
  assert.equal(duration(45), '45 seconds');
  assert.equal(duration(60), '1 minute');
  assert.equal(duration(0), '0 seconds');
});

test('the gestures cover mouse, touch, pen and keyboard', () => {
  const all = gestures();
  assert.deepEqual(all.map((each) => each.id), ['mouse', 'touch', 'pen', 'keyboard']);
  for (const each of all) assert.ok(each.items.length >= 3, each.device + ' has too few lines');
  const text = all.flatMap((each) => each.items).join(' ');
  assert.match(text, /0\.5 seconds/, 'the long press is read from input.js');
  assert.match(text, /25% to 300%/, 'the zoom range is read from viewport.js');
});

test('Help’s words follow the house style: sentences, no em dash, no "error" or "issue"', async () => {
  const sections = await railSections();
  const model = helpModel({ sections, shortcuts: await registered(sections) });
  const text = allText({ ...model, keys: { ...model.keys, rows: [] } });
  assert.doesNotMatch(text, /—/, 'an em dash in Help');
  assert.doesNotMatch(text, /\b(error|issue|conflict)s?\b/i, 'a severity word the vocabulary does not use');
  for (const each of model.sections) for (const line of [each.purpose, each.first, each.more]) assert.match(line, /[.!?]$/, each.id + ': "' + line + '" is not a sentence');
});
