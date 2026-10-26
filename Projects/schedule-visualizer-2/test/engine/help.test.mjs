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
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { helpModel, numbers, words, gestures, SECTION_HELP, SHORTCUT_GROUPS, NOTHING_WRITTEN, duration } from '../../ui/help/content.js';
import { createShortcuts } from '../../ui/components/shortcuts.js';
import { defaultSettings, STUDENTS_PER_LANE_CELL, PERIOD_WORDS } from '../../engine/schema.js';
import { CROSSING_WAIT_MAX, walkingSeconds } from '../../engine/crowd.js';
import { route, routingGraph } from '../../engine/routing.js';
import { threeFloors, roomId } from '../fixtures/buildings/plans.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(path.join(TOOL, ...parts), 'utf8');
const APP = read('ui', 'app.js');

// each rail section's module source, for what it mounts
const sources = new Map();
// what each section's start(ctx) put on the list, by the section's id
const fromStart = new Map();

// The rail: `export const SECTIONS = [building, schedule, …]` and the import
// line that names each.
async function railSections() {
  const listed = APP.match(/export const SECTIONS = \[([^\]]*)\]/);
  assert.ok(listed, 'ui/app.js has no `export const SECTIONS = [...]` line to read the rail from');
  const names = listed[1].split(',').map((each) => each.trim()).filter(Boolean);
  const sections = [];
  for (const local of names) {
    const line = APP.match(new RegExp("import \\{[^}]*\\bsection as " + local + "\\b[^}]*\\} from '([^']+)'"));
    assert.ok(line, 'ui/app.js has no import line for the rail\'s ' + local);
    const mod = await import(pathToFileURL(path.join(TOOL, 'ui', line[1])).href);
    sources.set(mod.section, read('ui', line[1]));
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
      const before = shortcuts.list().length;
      try {
        each.start(ctx);
        fromStart.set(each.id, shortcuts.list().slice(before));
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

// The plan map (ui/surface/plan-map.js) answers =, - and 0 itself, on every
// section that mounts one, so each such section lists them from its start():
// the scenario lab's map answered them for weeks with none of them in Help
// (SV2-32b).
test('every section that mounts the plan map lists its zoom and fit keys, = - 0, in Help', async () => {
  const sections = await railSections();
  const rows = await registered(sections);
  const withMap = sections.filter((each) => /\bcreatePlanMap\(/.test(sources.get(each)));
  assert.deepEqual(withMap.map((each) => each.id), ['movement', 'scenarios', 'safety'], 'the sections that mount the plan map');
  const listed = new Set(helpModel({ sections, shortcuts: rows }).keys.rows.map((row) => row.id));
  for (const each of withMap) {
    const own = fromStart.get(each.id) || [];
    const keys = new Set(own.flatMap((row) => String(row.keys).split(/\s+/)));
    for (const key of ['=', '-', '0']) assert.ok(keys.has(key), each.id + ' mounts the plan map, which answers ' + key + ', and its start() lists no shortcut with that key: Help cannot show it');
    for (const row of own) assert.ok(listed.has(row.id), 'Help leaves out ' + row.id);
  }
});

test('a shortcut group Help has no sentence for still shows, saying so', () => {
  const model = helpModel({ shortcuts: [{ id: 'atlas-x', group: 'Atlas', does: 'Spin the globe', keys: 'G' }, { id: 'x', group: 'constructor', does: 'x', keys: 'Y' }] });
  assert.deepEqual(model.keys.groups.map((each) => [each.group, each.written, each.says]), [['Atlas', false, NOTHING_WRITTEN], ['constructor', false, NOTHING_WRITTEN]]);
});

// Spec 2, the vocabulary table, in its order.
const SPEC_WORDS = ['Project', 'Floor', 'Cell', 'Room', 'Other space', 'Corridor', 'Stairs', 'Elevator', 'Exit', 'Door', 'Period', 'Day type', 'Passing time', 'Transition', 'Group', 'Teacher', 'Subject', 'Load', 'Scenario', 'Finding'];
// DESIGN 11.1's words, after spec 2's, as the units that build them add them
// (SV2-78: bell schedules and their No class; the calendar's and the marks'
// words come with their tabs)
const NEW_WORDS = ['Bell schedule', 'Regular bells', 'No class'];

test('every word of spec 2 is explained, in the spec’s order, with the school’s own period word, then DESIGN 11.1’s', () => {
  assert.deepEqual(words(defaultSettings()).map((each) => each.term), SPEC_WORDS.concat(NEW_WORDS));
  for (const each of words(defaultSettings())) assert.ok(each.meaning.endsWith('.') && each.meaning.length > 20, each.term + ' is not explained in a sentence');
  const block = words({ ...defaultSettings(), periodWord: 'Block' });
  assert.deepEqual(block.map((each) => each.term), SPEC_WORDS.map((term) => (term === 'Period' ? 'Block' : term)).concat(NEW_WORDS));
  assert.match(block.find((each) => each.term === 'Block').meaning, /This school’s word for it is block, and the planner says block everywhere\./);
  assert.match(block.find((each) => each.term === 'Passing time').meaning, /one block and the start of the next/);
  assert.equal(words(undefined).length, SPEC_WORDS.length + NEW_WORDS.length);
  assert.match(block.find((each) => each.term === 'No class').meaning, /^Under a bell schedule, the blocks ticked No class do not meet/);
});

// The settings the engines read for load, routes, the crowd and the passing
// time, found in their code (comments stripped first). Every engine/*.js is
// read, so a new engine is scanned the day it lands. Left out:
//
// Files that read every setting to store or check it, not to work a figure
// out: schema.js (the defaults), validate.js, repair.js, migrate.js and
// project-file.js.
const KEEPERS = new Set(['schema.js', 'validate.js', 'repair.js', 'migrate.js', 'project-file.js']);
// Settings that are no figure's size: periods (how many transitions there
// are), periodWord, timeFormat and schoolName (words and clock faces), paper
// and theme (prints and screens), checks.consecutiveLimit and checks.off (a
// schedule check's own limit and its switches, not load, travel or late), and
// checks and colourScale, read whole to reach their fields, which are named
// one by one.
const NOT_A_NUMBER = new Set(['periods', 'periodWord', 'timeFormat', 'schoolName', 'paper', 'paper.size', 'paper.orientation', 'theme', 'checks.consecutiveLimit', 'checks.off', 'checks', 'colourScale']);

function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      out += ' ';
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (c === '\'' || c === '"' || c === '`') {
      // a string: copied whole, so a // inside one is not a comment
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// Every name the code reads off something called settings: settings.x and
// settings.x.y, settings['x'], and const { x, y: z } = …settings.
function settingsRead(code) {
  const found = new Set();
  for (const [, name] of code.matchAll(/\bsettings\??\.([A-Za-z]+(?:\??\.[A-Za-z]+)?)/g)) found.add(name.replace(/\?/g, ''));
  for (const [whole, quoted] of code.matchAll(/\bsettings\??\.?\[\s*(?:'([A-Za-z]+)'|"([A-Za-z]+)")?[^\]]*\]/g)) {
    if (quoted) found.add(quoted);
    else found.add('?' + whole);
  }
  for (const [, inside] of code.matchAll(/\{([^{}]*)\}\s*=\s*[\w.?]*\bsettings\b(?!\s*\.)/g)) {
    for (const part of inside.split(',')) {
      const key = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z]+$/.test(key)) found.add(key);
    }
  }
  return found;
}

function settingsTheEnginesRead() {
  const found = new Set();
  const files = readdirSync(path.join(TOOL, 'engine')).filter((name) => name.endsWith('.js'));
  assert.ok(files.includes('routing.js') && files.includes('crowd.js') && files.includes('load.js') && files.includes('bells.js'), 'engine/ has lost a file the numbers come from');
  for (const file of files) {
    if (KEEPERS.has(file)) continue;
    const code = stripComments(read('engine', file));
    for (const name of settingsRead(code)) {
      assert.ok(!name.startsWith('?'), 'engine/' + file + ' reads ' + name.slice(1) + ', a setting this test cannot name: teach it the shape');
      if (!NOT_A_NUMBER.has(name)) found.add(name);
    }
  }
  // The colour scale reaches load.js as an argument (the screens pass it
  // settings.colourScale): the fields its code reads off `scale` are the
  // colour scale's settings.
  for (const [, field] of stripComments(read('engine', 'load.js')).matchAll(/\bscale\.([A-Za-z]+)/g)) found.add('colourScale.' + field);
  return [...found].sort();
}

test('the settings scan reads code, not comments, and every shape a setting is read in', () => {
  const code = stripComments([
    '// settings.inAComment',
    '/* settings.inABlock */',
    "const url = 'http://settings.inAString.example';",
    'const a = project.settings.dotted;',
    'const b = settings.checks.deep;',
    "const c = settings['quoted'];",
    'const { one, two: renamed, three = 4 } = project.settings;',
    'const d = settings?.optional;',
  ].join('\n'));
  const found = [...settingsRead(code)].sort();
  assert.deepEqual(found, ['checks.deep', 'dotted', 'inAString.example', 'one', 'optional', 'quoted', 'three', 'two']);
  assert.deepEqual([...settingsRead('const e = settings[key];')], ['?settings[key]'], 'a read by a computed key is flagged, not passed over');
});

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
  assert.match(text, new RegExp('\\b' + defaults.secondsPerCell + ' seconds \\(the default\\) for each cell of corridor'));
  assert.match(text, new RegExp('\\b' + defaults.secondsPerStair + ' seconds \\(the default\\) on stairs'));
  assert.match(text, new RegExp('counts as ' + defaults.defaultHeadCount + ' students \\(the default\\)'));
  assert.match(text, new RegExp(duration(defaults.defaultPassingSeconds) + ' \\(the default\\)'));
  assert.match(text, /plus the passing margin: 0 seconds \(the default\)/);
  assert.match(text, new RegExp(defaults.colourScale.bands.join(', ') + ' \\(the default\\)'));
  assert.match(text, new RegExp('one cell long for every ' + STUDENTS_PER_LANE_CELL + ' students'));
  assert.match(text, new RegExp('for no more than ' + CROSSING_WAIT_MAX + ' seconds at one crossing'));
});

test('a project’s own numbers are shown beside the defaults', () => {
  const defaults = defaultSettings();
  const mine = { ...defaults, secondsPerCell: 5, defaultHeadCount: 30, defaultPassingSeconds: 270, checks: { ...defaults.checks, passingMarginSeconds: 20 }, periodWord: 'Mod' };
  const text = numbers(mine).flatMap((each) => each.sentences).join(' ');
  assert.match(text, /5 seconds \(the default is 3 seconds\) for each cell of corridor/);
  assert.match(text, /counts as 30 students \(the default is 25 students\)/);
  assert.match(text, /a group of 30 is 5 cells long/);
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

// The stairs, as the engines take them on the defaults: the route's search
// cost per floor (routing.js) and the walking time of a flight (crowd.js),
// read off real routes up one floor and up two, never typed here.
test('Help’s stairs figures are the engines’: the route’s seconds a floor, and a flight’s walking time in whole cells', () => {
  const flight = (project) => {
    const graph = routingGraph(project);
    const found = route(graph, roomId('1A'), roomId('2A'));
    assert.equal(found.ok, true, 'the fixture has no route up the stairs');
    assert.equal(found.connections.length, 1, 'the fixture’s route takes one connection');
    const cells = found.cells.length * graph.secondsPerCell;
    return { search: found.seconds - cells, walking: walkingSeconds(graph, found) - cells, perCell: graph.secondsPerCell };
  };
  const one = flight(threeFloors());
  const tall = threeFloors();
  tall.building.floors[1].level = 3; // floor 2 is two floors above floor 1 now
  tall.building.floors[2].level = 4;
  const two = flight(tall);
  assert.equal(two.search, 2 * one.search, 'the route is chosen on the same seconds for each floor');
  assert.notEqual(one.walking, one.search, 'on the defaults a flight walks in other seconds than the route is chosen on, or this case proves nothing');
  const text = numbers(defaultSettings()).flatMap((each) => each.sentences).join(' ');
  assert.match(text, new RegExp('chosen on ' + one.perCell + ' seconds \\(the default\\) for each cell of corridor'));
  assert.match(text, new RegExp('and ' + one.search + ' seconds \\(the default\\) on stairs for each floor climbed or descended'));
  assert.match(text, new RegExp('a flight of one floor is ' + one.walking / one.perCell + ' cells, ' + one.walking + ' seconds, and a flight of two floors ' + two.walking / two.perCell + ' cells, ' + two.walking + ' seconds\\.'),
    'Help’s walking time for a flight of stairs is not the crowd model’s');
});

test('Help says cell, never square (spec 2: those words and only those)', async () => {
  const sections = await railSections();
  const model = helpModel({ sections, shortcuts: await registered(sections) });
  for (const word of PERIOD_WORDS) {
    const text = allText(helpModel({ sections, settings: { ...defaultSettings(), periodWord: word } }));
    assert.doesNotMatch(text, /\bsquares?\b/i, 'Help says "square" with the period word ' + word);
  }
  assert.doesNotMatch(allText({ ...model, keys: { ...model.keys, rows: [] } }), /\bsquares?\b/i, 'Help says "square"');
});

test('the school’s period word takes no wrong article: not "a hour", not "an mod"', () => {
  assert.deepEqual(PERIOD_WORDS, ['Period', 'Mod', 'Block', 'Hour']);
  const text = (word) => allText(helpModel({ settings: { ...defaultSettings(), periodWord: word } }));
  for (const word of PERIOD_WORDS) {
    const lower = word.toLowerCase();
    const vowelSound = /^(?:[aeiou]|hour)/.test(lower);
    assert.doesNotMatch(text(word), new RegExp('\\ba ' + (vowelSound ? lower : '(?!)') + '\\b', 'i'), '"a ' + lower + '" in Help');
    assert.doesNotMatch(text(word), new RegExp('\\ban ' + (vowelSound ? '(?!)' : lower) + '\\b', 'i'), '"an ' + lower + '" in Help');
  }
  for (const word of PERIOD_WORDS.slice(1)) assert.match(text(word), new RegExp('This school’s word for it is ' + word.toLowerCase() + ','), word + ': Help does not say the school’s word');
});

// A value for each setting `uses` can name, unlike any default, and the
// ways Help shows it (one of them in each part that uses it).
const SHOWN = {
  secondsPerCell: [7, '7 seconds (the default is 3 seconds)'],
  secondsPerStair: [13, '13 seconds (the default is 8 seconds)'],
  defaultHeadCount: [37, '37 students (the default is 25 students)', 'a group of 37 is 7 cells long'],
  defaultPassingSeconds: [317, '5 minutes 17 seconds (the default is 4 minutes)'],
  'checks.passingMarginSeconds': [41, '41 seconds (the default is 0 seconds)'],
  'colourScale.mode': ['absolute', 'absolute (the default is relative)'],
  'colourScale.bands': [[11, 27, 53, 107], '11, 27, 53, 107 (the default is 10, 25, 50, 100)'],
};

function withSetting(dotted, value) {
  const settings = structuredClone(defaultSettings());
  const keys = dotted.split('.');
  const last = keys.pop();
  keys.reduce((object, key) => object[key], settings)[last] = value;
  return settings;
}

test('each setting a part says it uses is shown in that part’s sentences, and moves them', () => {
  const plain = numbers(defaultSettings());
  for (const [index, part] of plain.entries()) {
    for (const name of part.uses) {
      assert.ok(Object.hasOwn(SHOWN, name), part.id + ' uses ' + name + ', which this test has no value for: add one to SHOWN');
      const [value, ...shown] = SHOWN[name];
      const changed = numbers(withSetting(name, value))[index].sentences.join(' ');
      assert.notEqual(changed, part.sentences.join(' '), part.id + ' says it uses ' + name + ' and does not change with it');
      assert.ok(shown.some((each) => changed.includes(each)), part.id + ' does not show ' + name + ' as "' + shown.join('" or "') + '": ' + changed);
    }
  }
});

test('the bands and the head count shown are the ones the engines fall back to', () => {
  const broken = { ...defaultSettings(), defaultHeadCount: 0, colourScale: { mode: 'absolute', bands: [5, 9] } };
  const text = numbers(broken).flatMap((each) => each.sentences).join(' ');
  assert.match(text, /counts as 25 students \(the default\)/, 'a head count of 0 is not what load.js or crowd.js use');
  assert.match(text, /a group of 25 is 5 cells long/);
  assert.match(text, /the loads you set: 10, 25, 50, 100 \(the default\)/, 'bands load.js refuses are shown as if used');
});

// Sentences checked against the code they describe (SV2-30c's review).
test('the gestures and the numbers say what the code does', () => {
  const said = gestures().flatMap((each) => each.items).join(' ');
  const input = stripComments(read('ui', 'surface', 'input.js'));
  assert.match(input, /panBy\(-event\.deltaX/, 'input.js no longer pans on the wheel: change this sentence');
  assert.match(said, /The wheel alone moves the map\./, 'the wheel: input.js pans with it, it does not scroll');
  assert.match(said, /press and hold[^:]*: on the Building plan, the menu for that cell\./i, 'the long press: only Building has a menu');
  assert.match(said, /Shift\+F10 or the Menu key: on the Building plan, the menu for the cell under the cursor\./, 'the menu key: only Building has a menu');
  assert.match(input, /if \(!pan && !ev\.inside\) pan = true;/, 'input.js no longer pans a drag from off the floor: change this sentence');
  assert.match(said, /A drag that starts off the floor moves the map whatever the tool in hand/, 'the drag from off the floor (DESIGN 6)');
  assert.match(said, /A room drawn with the mouse, a pen or the keyboard puts you in its number field: type the number, and Enter keeps it and takes you back to the cursor/, 'a new room’s number field (DESIGN 6)');
  const parts = Object.fromEntries(numbers(defaultSettings()).map((each) => [each.id, each.sentences.join(' ')]));
  assert.match(parts.travel, /no more than 6 seconds at one crossing; after that it turns as soon as the cell ahead is free/, 'the 6 seconds is a cap on waiting for a gap, not on all waiting');
  assert.match(parts.travel, /taken, for as long as that takes\./, 'waiting behind a taken cell has no cap');
  assert.match(parts.travel, /charged to the cell or the flight of stairs/, 'waiting is charged to a connection too (crowd.js connectionDelay)');
  assert.match(parts.late, /Where the bells give no gap, because a time is missing or the next period starts no later than this one ends, the default/, 'bells.js uses the default where the bells give no gap, not only where they say nothing');
  assert.match(parts.late, /is stopped, reported as did not arrive, and counted as late\./, 'a group stopped at the cap is late (crowd.js)');
});
