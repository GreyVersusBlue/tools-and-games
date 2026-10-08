// The parts of the interface that are plain functions: the shortcut guard,
// what a settings field reads and writes, the picker's filter, the table's
// sort, and the words built from counts.
//
//   node test/ui/helpers.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { singleKeyAllowed, isEditing, isTextField, createShortcuts, chordText } from '../../ui/components/shortcuts.js';
import { parsePassing, formatPassing, parseBands, paperForRegion, checkLabel } from '../../ui/project/settings.js';
import { wholeNumber } from '../../ui/components/field.js';
import { filterOptions } from '../../ui/components/picker.js';
import { sortRows, compareValues } from '../../ui/components/table.js';
import { count, list, periodWords, figures } from '../../ui/components/words.js';
import { CHECK_KINDS } from '../../engine/schema.js';
import { sampleSchool } from '../../data/sample-school.js';

// The least of an element the guard looks at.
function element(tagName, extra) {
  const selectors = { INPUT: 'input', SELECT: 'select', TEXTAREA: 'textarea' };
  return {
    tagName,
    type: 'text',
    isContentEditable: false,
    closest(selector) {
      if (extra && extra.editing && selector.includes('[data-editing]')) return this;
      return selectors[tagName] && selector.split(',').map((part) => part.trim()).includes(selectors[tagName]) ? this : null;
    },
    ...extra,
  };
}
const key = (target, more) => ({ key: '7', target, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, preventDefault() {}, ...more });

test('a single key is allowed on the page and refused in anything being typed into', () => {
  assert.equal(singleKeyAllowed(key(element('BODY'))), true);
  assert.equal(singleKeyAllowed(key(element('BUTTON'))), true);
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) assert.equal(singleKeyAllowed(key(element(tag))), false, tag);
  assert.equal(singleKeyAllowed(key(element('DIV', { isContentEditable: true }))), false, 'contenteditable');
  assert.equal(singleKeyAllowed(key(element('TD', { editing: true }))), false, 'a grid cell being edited');
});

test('a single key is refused while Ctrl, Alt or Meta is held, and Shift alone is fine', () => {
  for (const held of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(singleKeyAllowed(key(element('BODY'), { [held]: true })), false, held);
  assert.equal(singleKeyAllowed(key(element('BODY'), { shiftKey: true })), true);
});

test('a text field has its own undo; a checkbox and a radio do not', () => {
  assert.equal(isTextField(element('INPUT')), true);
  assert.equal(isTextField(element('TEXTAREA')), true);
  assert.equal(isTextField(element('INPUT', { type: 'radio' })), false);
  assert.equal(isTextField(element('INPUT', { type: 'checkbox' })), false);
  assert.equal(isTextField(element('SELECT')), false);
  assert.equal(isEditing(element('SELECT')), true);
});

test('the shortcut list runs the first match, stops when blocked, and lists what Help shows', () => {
  let dialogOpen = false;
  const ran = [];
  const shortcuts = createShortcuts({ blocked: () => dialogOpen });
  shortcuts.add({ id: 'seven', group: 'Sections', does: 'Open Project', key: '7', run: () => ran.push('seven') });
  shortcuts.add({ id: 'undo', group: 'Anywhere', does: 'Undo', chord: { key: 'z', mod: true }, textFields: false, run: () => ran.push('undo') });
  shortcuts.add({ id: 'redo', group: 'Anywhere', does: 'Redo', chord: { key: 'z', mod: true, shift: true }, textFields: false, run: () => ran.push('redo') });
  shortcuts.add({ id: 'find', group: 'Anywhere', does: 'Search', chord: { key: 'f', mod: true }, run: () => ran.push('find') });
  shortcuts.add({ id: 'esc', group: 'Dialogs', does: 'Close', shown: 'Esc' });
  const mod = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? 'metaKey' : 'ctrlKey';

  assert.equal(shortcuts.handle(key(element('BODY'))), true);
  assert.equal(shortcuts.handle(key(element('INPUT'))), false, 'a digit in a field');
  assert.equal(shortcuts.handle(key(element('BODY'), { key: 'z', [mod]: true })), true);
  assert.equal(shortcuts.handle(key(element('BODY'), { key: 'Z', [mod]: true, shiftKey: true })), true);
  assert.equal(shortcuts.handle(key(element('INPUT'), { key: 'z', [mod]: true })), false, 'undo inside a text field is the field\'s');
  assert.equal(shortcuts.handle(key(element('INPUT', { type: 'radio' }), { key: 'z', [mod]: true })), true, 'a radio has no undo of its own');
  assert.equal(shortcuts.handle(key(element('INPUT'), { key: 'f', [mod]: true })), true, 'search works from inside a field');
  assert.equal(shortcuts.handle(key(element('BODY'), { key: 'Escape' })), false, 'a listed-only entry is never run');
  dialogOpen = true;
  assert.equal(shortcuts.handle(key(element('BODY'))), false, 'blocked while a dialog is open');
  assert.deepEqual(ran, ['seven', 'undo', 'redo', 'undo', 'find']);
  assert.deepEqual(shortcuts.list().map((entry) => entry.id), ['seven', 'undo', 'redo', 'find', 'esc']);
  assert.equal(shortcuts.list()[4].keys, 'Esc');
  assert.match(chordText({ key: 'z', mod: true, shift: true }), /^(Ctrl\+Shift\+Z|⇧⌘Z)$/);
  assert.equal(chordText({ key: 'F6', shift: 'any' }), 'F6');
});

test('the passing time is typed in minutes and kept in seconds', () => {
  assert.equal(parsePassing('4'), 240);
  assert.equal(parsePassing(' 4:30 '), 270);
  assert.equal(parsePassing('4.5'), 270);
  assert.equal(parsePassing('0'), 0);
  for (const bad of ['', 'four', '4:60', '4:5', '-4', '4m']) assert.throws(() => parsePassing(bad), /minutes/, JSON.stringify(bad));
  assert.equal(formatPassing(240), '4');
  assert.equal(formatPassing(270), '4:30');
  assert.equal(formatPassing(5), '0:05');
  for (const seconds of [0, 59, 60, 240, 275, 3600]) assert.equal(parsePassing(formatPassing(seconds)), seconds);
});

test('the bands are four whole numbers however they are separated', () => {
  assert.deepEqual(parseBands('10, 25, 50, 100'), [10, 25, 50, 100]);
  assert.deepEqual(parseBands('10 25;50,100'), [10, 25, 50, 100]);
  for (const bad of ['10, 25, 50', '10, 25, 50, 100, 200', 'a, b, c, d', '1.5, 2, 3, 4']) assert.throws(() => parseBands(bad), /four whole numbers/, bad);
});

test('a whole-number field refuses anything else in a sentence', () => {
  const parse = wholeNumber('The default head count');
  assert.equal(parse(' 31 '), 31);
  for (const bad of ['', '3.5', 'x', '1e3']) assert.throws(() => parse(bad), /^Error: The default head count is a whole number\./, JSON.stringify(bad));
});

test('paper is US Letter where the region uses it and A4 elsewhere', () => {
  assert.equal(paperForRegion('en-US'), 'letter');
  assert.equal(paperForRegion('fr-CA'), 'letter');
  assert.equal(paperForRegion('es-MX'), 'letter');
  assert.equal(paperForRegion('en-GB'), 'a4');
  assert.equal(paperForRegion('de'), 'a4');
  assert.equal(paperForRegion('not a locale'), 'a4');
});

test('every check kind has a name of its own, in the school\'s word for a period', () => {
  const words = periodWords({ periodWord: 'Mod' });
  const labels = CHECK_KINDS.map((kind) => checkLabel(kind, words));
  CHECK_KINDS.forEach((kind, index) => assert.notEqual(labels[index], kind, kind + ' has no name in ui/project/settings.js'));
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(checkLabel('no-planning', words), 'A teacher with no planning mod');
  assert.equal(labels.some((label) => /period/i.test(label)), false, 'a label says "period" in a school that says Mod');
});

test('the picker matches anywhere in the label, without regard to case', () => {
  const options = [{ id: 'a', label: 'Room 204 — Ms. Okafor' }, { id: 'b', label: 'Room 105' }, { id: 'c', label: 'Library' }];
  assert.deepEqual(filterOptions(options, 'OKA').map((option) => option.id), ['a']);
  assert.deepEqual(filterOptions(options, 'room').map((option) => option.id), ['a', 'b']);
  assert.deepEqual(filterOptions(options, '  ').map((option) => option.id), ['a', 'b', 'c']);
  assert.deepEqual(filterOptions(options, '<b>'), []);
});

test('the table sorts numbers inside text as numbers, keeps ties in order, and reverses', () => {
  const rows = [{ n: 'Room 10', k: 1 }, { n: 'Room 9', k: 2 }, { n: 'room 9', k: 3 }, { n: 'Gym', k: 4 }];
  const column = { value: (row) => row.n };
  assert.deepEqual(sortRows(rows, column, 'ascending').map((row) => row.k), [4, 2, 3, 1]);
  assert.deepEqual(sortRows(rows, column, 'descending').map((row) => row.k), [1, 2, 3, 4]);
  assert.deepEqual(sortRows(rows, null, 'ascending').map((row) => row.k), [1, 2, 3, 4]);
  assert.equal(compareValues(2, 10) < 0, true);
  assert.equal(rows[0].k, 1, 'the rows given are not reordered');
});

test('counts and lists read as a sentence would', () => {
  assert.equal(count(0, 'room'), 'no rooms');
  assert.equal(count(1, 'room'), '1 room');
  assert.equal(count(13, 'room'), '13 rooms');
  assert.equal(count(2, 'room entry', 'room entries'), '2 room entries');
  assert.equal(list([]), '');
  assert.equal(list(['a']), 'a');
  assert.equal(list(['a', 'b']), 'a and b');
  assert.equal(list(['a', 'b', 'c']), 'a, b and c');
  assert.deepEqual(periodWords({ periodWord: 'Block' }), { One: 'Block', one: 'block', Many: 'Blocks', many: 'blocks' });
  assert.deepEqual(periodWords({}), { One: 'Period', one: 'period', Many: 'Periods', many: 'periods' });
});

test('the figures of the sample school are counted from its data', () => {
  assert.deepEqual(figures(sampleSchool()), { floors: 3, rooms: 13, otherSpaces: 10, exits: 2, connections: 2, teachers: 12, groups: 8, subjects: 9, dayTypes: 2 });
});
