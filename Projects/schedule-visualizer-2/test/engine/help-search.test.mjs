// Help's search index and matcher (SV2-136; DESIGN 16.10, 16.12 item 7;
// ARCHITECTURE 22.12): every word of the query, in any order, ignoring case
// and accents, over an index built from helpModel, with the matched words
// marked as segments (text, never markup).
//
//   node test/engine/help-search.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { helpModel, SECTION_HELP } from '../../ui/help/content.js';
import { buildIndex, search, announcement, queryTokens, fold, partTitles, findKey, leadOf, MIN_CHARS, SNIPPET_CHARS, LEAD_WORDS } from '../../ui/help/search.js';
import { defaultSettings } from '../../engine/schema.js';

// An index over made-up entries, to test the matcher alone.
function indexOf(...rows) {
  const model = {
    sections: [],
    keys: { guard: '', rows: [], groups: [] },
    gestures: [],
    words: rows.map(([term, meaning]) => ({ term, meaning })),
    numbers: [],
  };
  return buildIndex(model);
}
const titlesOf = (found) => found.results.map((r) => r.entry.title);
const plain = (result) => result.segments.map((piece) => piece.text).join('');
const marked = (result) => result.segments.filter((piece) => piece.mark).map((piece) => piece.text);

// The real model: the rail's seven sections, the shell's shortcuts as rows.
function realModel(settings) {
  const sections = Object.keys(SECTION_HELP).map((id, at) => ({ id, name: id[0].toUpperCase() + id.slice(1), key: String(at + 1) }));
  const rows = [
    { id: 'search', group: 'Anywhere', keys: 'Ctrl+F', does: 'Go to the search box' },
    { id: 'undo', group: 'Anywhere', keys: 'Ctrl+Z', does: 'Undo the last change' },
  ];
  return helpModel({ sections, current: 'building', shortcuts: rows, settings: settings || defaultSettings() });
}

test('every word must be in an entry, in any order', () => {
  const index = indexOf(['Dead end', 'A corridor that ends.'], ['Stairwell', 'Stairs joined through several floors as one.'], ['Flight', 'The stairs between two floors.']);
  assert.deepEqual(titlesOf(search(index, 'stairs floors')), ['Stairwell', 'Flight']);
  assert.deepEqual(titlesOf(search(index, 'floors stairs')), ['Stairwell', 'Flight']);
  assert.deepEqual(titlesOf(search(index, 'stairs several')), ['Stairwell'], 'a word only one entry has narrows the list');
  assert.deepEqual(titlesOf(search(index, 'stairs corridor')), [], 'words from two entries are not a match');
});

test('case and accents are ignored, in the query and in the text', () => {
  const index = indexOf(['Café', 'Résumé du Élève, naïve façade.'], ['Plain', 'nothing here']);
  for (const query of ['CAFE', 'café', 'cafe', 'CAFÉ', 'resume eleve', 'RÉSUMÉ ÉLÈVE', 'naive facade']) {
    assert.deepEqual(titlesOf(search(index, query)), ['Café'], query);
  }
  // an accent made of two code points (e + combining acute) folds the same
  assert.equal(fold('Café').folded, 'cafe');
  assert.deepEqual(titlesOf(search(indexOf(['x', 'Café au lait']), 'café')), ['x']);
});

test('a query word matches the start of a word, not its middle; dead-end and dead end are one query', () => {
  const index = indexOf(['Dead end', 'A corridor that ends: a bend is not one.'], ['Stairwell', 'Stairs joined as one.']);
  assert.equal(search(index, 'stair').results.length, 1, 'stair finds stairwell');
  assert.equal(search(index, 'well').results.length, 0, 'well is the middle of a word');
  assert.equal(search(index, 'bend end').results.length, 1);
  assert.equal(search(index, 'nd').results.length, 0, 'nd is the end of end and bend, the start of no word');
  assert.deepEqual(queryTokens('Dead-end'), ['dead', 'end']);
  assert.deepEqual(titlesOf(search(index, 'dead-end')), ['Dead end']);
  assert.deepEqual(titlesOf(search(index, 'end dead')), ['Dead end']);
  assert.deepEqual(queryTokens('  Stairs  stairs  '), ['stairs'], 'each word once');
});

test('nothing under two characters is searched; whitespace and punctuation alone find nothing', () => {
  const index = indexOf(['Floor', 'One level.']);
  assert.equal(MIN_CHARS, 2);
  for (const query of ['', ' ', 'f', ' f ', undefined, null]) {
    const found = search(index, query);
    assert.equal(found.short, true, JSON.stringify(query));
    assert.deepEqual(found.results, []);
  }
  assert.equal(search(index, 'fl').short, false);
  // only letters and digits count toward the two: punctuation is not a character of the search
  for (const query of ['--', 'f.', '.f', 'f-', '“f”', 'f ?', '–—']) {
    const found = search(index, query);
    assert.equal(found.short, true, JSON.stringify(query) + ' has one letter or none, and was searched');
    assert.deepEqual(found.results, []);
  }
  assert.equal(search(index, 'f l').short, false, 'two letters, apart, are two');
  assert.equal(search(index, 'f f').short, false, 'the same letter twice is two');
  assert.equal(search(index, 'fl.').short, false);
  assert.deepEqual(search(index, 'fl.').results.map((r) => r.entry.title), ['Floor']);
});

test('a match in the title ranks before one only in the text; ties keep Help’s own order', () => {
  const index = indexOf(['Cell', 'Everything on a floor is drawn in cells.'], ['Room', 'A space in a cell of its own.'], ['Floor', 'One level made of cells.']);
  assert.deepEqual(titlesOf(search(index, 'cell')), ['Cell', 'Room', 'Floor'], 'the title match first; Room and Floor tie, Room is earlier');
  assert.deepEqual(titlesOf(search(index, 'cells')), ['Cell', 'Floor'], 'cells is not the start of cell’s other forms, and Cell’s text has cells');
});

test('a title that starts with the word outranks a text that has the whole word', () => {
  const index = indexOf(['Room', 'A space in a cell of its own.'], ['Cells', 'Everything on a floor.']);
  assert.deepEqual(titlesOf(search(index, 'cell')), ['Cells', 'Room']);
});

test('the matched words come back marked as text segments, which join to the sentence exactly', () => {
  const index = indexOf(['Dead end', 'A corridor that ends. Many fire codes limit dead-end corridors. Check your local code.']);
  const [result] = search(index, 'dead corridors').results;
  assert.equal(plain(result), 'Many fire codes limit dead-end corridors.', 'the sentence with the most of the words');
  assert.deepEqual(marked(result), ['dead', 'corridors'], 'the whole matched words');
  // case is kept as written
  const [again] = search(indexOf(['T', 'The Stairwell stops once.']), 'STAIRWELL').results;
  assert.deepEqual(marked(again), ['Stairwell']);
  // a whole word is marked for a start of it
  const [start] = search(indexOf(['T', 'Stairwells are one.']), 'stair').results;
  assert.deepEqual(marked(start), ['Stairwells']);
});

test('markup in the text is text: a segment is a plain string, never parsed', () => {
  const index = indexOf(['Name', 'A room called <img src=x onerror=alert(1)> and <b>bold</b> stairs.']);
  const [result] = search(index, 'stairs').results;
  assert.equal(plain(result), 'A room called <img src=x onerror=alert(1)> and <b>bold</b> stairs.');
  assert.deepEqual(marked(result), ['stairs']);
  const [tag] = search(index, 'img').results;
  assert.deepEqual(marked(tag), ['img']);
  assert.ok(result.segments.every((piece) => typeof piece.text === 'string' && typeof piece.mark === 'boolean'));
});

test('marks fall on the right letters when folding changes the length', () => {
  const text = 'Voilà: Café et İstanbul, ﬁn.';
  const [result] = search(indexOf(['T', text]), 'cafe istanbul').results;
  assert.equal(plain(result), text);
  assert.deepEqual(marked(result), ['Café', 'İstanbul']);
});

test('a long sentence is cut round its first match, at spaces, with ellipses', () => {
  const lead = 'alpha '.repeat(80);
  const tail = ' omega'.repeat(80);
  const [result] = search(indexOf(['T', lead + 'needle' + tail + '.']), 'needle').results;
  const shown = plain(result);
  assert.ok(shown.length <= SNIPPET_CHARS + 4, 'cut to about ' + SNIPPET_CHARS + ': ' + shown.length);
  assert.ok(shown.startsWith('… ') && shown.endsWith(' …'), shown);
  assert.deepEqual(marked(result), ['needle']);
  assert.ok(!shown.includes('alphaalpha') && !/\bomeg\b/.test(shown), 'cut at spaces, not through a word');
  // a short one is whole, with no ellipsis
  const [short] = search(indexOf(['T', 'Short needle here.']), 'needle').results;
  assert.equal(plain(short), 'Short needle here.');
});

test('the index is built from helpModel: every section, shortcut, gesture, word and number is in it', () => {
  const model = realModel();
  const index = buildIndex(model);
  const keys = new Set(index.map(findKey));
  for (const section of model.sections) assert.ok(keys.has('sections:' + section.id), 'section ' + section.id);
  for (const row of model.keys.rows) assert.ok(keys.has('keys:key:' + row.id), 'shortcut ' + row.id);
  for (const group of model.keys.groups) assert.ok(keys.has('keys:group:' + group.group), 'group ' + group.group);
  for (const device of model.gestures) assert.ok(keys.has('gestures:' + device.id), 'gestures ' + device.id);
  for (const word of model.words) assert.ok(keys.has('words:' + word.term), 'word ' + word.term);
  for (const block of model.numbers) assert.ok(keys.has('numbers:' + block.id), 'numbers ' + block.id);
  // each paragraph of a section is searchable: the last part of Building, the staff part
  const building = model.sections.find((s) => s.id === 'building');
  assert.equal(index.filter((e) => e.part === 'sections' && e.key === 'building').length, 3 + building.parts.length);
  assert.deepEqual(Object.keys(partTitles(model)), ['sections', 'keys', 'gestures', 'words', 'numbers']);
});

test('each glossary word is found once under its own name, and Stairwell ranks first for stairwell', () => {
  const model = realModel();
  const index = buildIndex(model);
  for (const word of model.words) {
    const found = search(index, word.term);
    const first = found.results[0];
    assert.ok(first, word.term + ' finds nothing');
    const own = found.results.filter((r) => r.entry.part === 'words' && r.entry.key === word.term);
    assert.equal(own.length, 1, word.term + ' is found once among the words');
  }
  const stairwell = search(index, 'stairwell').results;
  assert.equal(stairwell[0].entry.title, 'Stairwell', 'the glossary word ranks first');
  assert.equal(stairwell[0].entry.part, 'words');
});

test('W7: each new ability can be found by the words a reader would use', () => {
  const index = buildIndex(realModel());
  const first = (query, part, key) => {
    const found = search(index, query);
    assert.ok(found.results.length > 0, query + ' finds nothing');
    return found.results.some((r) => r.entry.part === part && (key === undefined || r.entry.key === key));
  };
  assert.ok(first('duplicate floor', 'sections', 'building'));
  assert.ok(first('auto-number next number', 'sections', 'building'));
  assert.ok(first('features kiln', 'sections', 'building'));
  assert.ok(first('stairwell through floors', 'sections', 'building'));
  assert.ok(first('join the parts', 'sections', 'building'));
  assert.ok(first('dead end 20 feet', 'sections', 'building'));
  assert.ok(first('dead end 20 feet', 'numbers', 'travel'));
  assert.ok(first('other word count as', 'sections', 'schedule'));
  assert.ok(first('name periods lunch', 'sections', 'schedule'));
  assert.ok(first('part-time only in school', 'sections', 'schedule'));
  assert.ok(first('free rooms features chips', 'sections', 'staff'));
  for (const term of ['Feature', 'Period name', 'Not in school', 'Stairwell', 'Flight', 'Dead end']) assert.ok(first(term, 'words', term), term);
  // each is one sentence
  const model = realModel();
  for (const term of ['Feature', 'Period name', 'Not in school', 'Stairwell', 'Flight', 'Dead end']) {
    const meaning = model.words.find((word) => word.term === term).meaning;
    assert.ok(meaning.endsWith('.') && !meaning.includes('. '), term + ' is not one sentence: ' + meaning);
  }
  // the thresholds are stated: 6 cells, 20 feet, 6.1 metres
  const dead = search(index, 'dead end').results.find((r) => r.entry.part === 'words' && r.entry.key === 'Dead end');
  assert.match(dead.entry.text, /6 cells/);
  assert.match(dead.entry.text, /20 feet \(6\.1 metres\)/);
});

test('with the school’s own period word, the glossary and the results say it', () => {
  const model = realModel({ ...defaultSettings(), periodCustom: { word: 'Lesson', plural: 'Lessons', count: 'number' } });
  const index = buildIndex(model);
  const found = search(index, 'lesson name');
  assert.equal(found.results[0].entry.title, 'Lesson name');
  assert.equal(search(index, 'period name').results.some((r) => r.entry.title === 'Period name'), false);
});

test('the Period word follows periodWordForms: Other word is named, and a custom word is said as typed', () => {
  const standard = realModel().words.find((word) => word.term === 'Period').meaning;
  assert.match(standard, /Period, Mod, Block, Hour or Other word\.$/);
  const custom = realModel({ ...defaultSettings(), periodWord: 'Mod', periodCustom: { word: 'Class', plural: 'Classes', count: 'letter' } });
  const own = custom.words.find((word) => word.term === 'Class');
  assert.ok(own, 'the glossary lists the custom word, not Mod');
  assert.match(own.meaning, /This school’s word for it is Class, and the planner says Class everywhere\./);
  assert.ok(!custom.words.some((word) => word.term === 'Mod'));
  // a malformed word falls back to Period, as the engine does
  const odd = realModel({ ...defaultSettings(), periodWord: 'Nonsense' });
  assert.ok(odd.words.some((word) => word.term === 'Period'));
  assert.ok(!/This school’s word/.test(odd.words.find((word) => word.term === 'Period').meaning));
});

test('a query with nothing to find says so in words, and counts say their number once', () => {
  const index = buildIndex(realModel());
  assert.equal(search(index, 'kiln zzzzz').results.length, 0);
  assert.equal(announcement(0, ' kiln '), 'No results for ‘kiln’. Try fewer or different words.');
  assert.equal(announcement(1, 'kiln'), '1 result');
  assert.equal(announcement(5, 'kiln'), '5 results');
});

test('a section\'s entries are its paragraphs, each named for the one it opens, with its first words to tell same-title results apart', () => {
  const model = realModel();
  const index = buildIndex(model);
  const building = model.sections.find((s) => s.id === 'building');
  const mine = index.filter((e) => e.part === 'sections' && e.key === 'building');
  assert.deepEqual(mine.map((e) => e.paragraph), ['purpose', 'first', 'more', ...building.parts.map((_, at) => 'part-' + at)]);
  assert.equal(new Set(mine.map((e) => e.id)).size, mine.length, 'two of Building\'s paragraphs share an id');
  // the dead-end paragraph is the last part, many screens below the heading
  const dead = search(index, 'dead end').results.filter((r) => r.entry.part === 'sections' && r.entry.key === 'building');
  const last = 'part-' + (building.parts.length - 1);
  assert.deepEqual(dead.map((r) => r.entry.paragraph), [last], 'the dead-end paragraph is not the Building result');
  assert.equal(dead[0].entry.lead, 'Checks has two more findings, each…');
  // results under one title each have their own second line
  const stairs = search(index, 'stairs').results.filter((r) => r.entry.part === 'sections' && r.entry.key === 'building');
  assert.ok(stairs.length > 2, 'too few Building results for stairs to tell apart');
  assert.equal(new Set(stairs.map((r) => r.entry.lead)).size, stairs.length, 'two Building results have the same second line');
  assert.match(mine.find((e) => e.paragraph === 'first').lead, /^First: Draw a corridor/);
  // the lead: up to LEAD_WORDS words, the sentence whole when it is shorter
  assert.equal(LEAD_WORDS, 6);
  assert.equal(leadOf('One two three. Four five six seven eight.'), 'One two three.');
  assert.equal(leadOf('One two three four five (six) seven.'), 'One two three four five (six)…');
  assert.equal(leadOf('One two three four five six, seven.'), 'One two three four five six…');
  // the other parts have no paragraphs, and so no lead
  assert.ok(index.filter((e) => e.part !== 'sections').every((e) => e.paragraph === undefined && e.lead === undefined));
});
