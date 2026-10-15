// The room picker's rules, and the Groups tab's addresses, with no browser:
//
//   node test/ui/room-picker.test.mjs
//
// Three parts. First the rules as plain functions (ui/schedule/room-rules.js):
// what typed text means, and which rooms a list shows for it. Then the picker
// itself (ui/schedule/room-picker.js) on a page that is a few dozen lines of
// stand-in at the top of this file, worked by the events a browser would
// send: what Enter does, what leaving the field does, where the highlight
// starts, a field that is read only. Then what an address of the Groups tab
// names in a project (ui/schedule/address.js), when the group, the day type
// or the period it names is no longer there.
//
// The stand-in page has elements, attributes, classes, listeners and nothing
// else: no layout, no focus, no bubbling. It is here so that the picker's own
// code runs, not a copy of its rules.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readTyped, listFor, severalWords } from '../../ui/schedule/room-rules.js';
import { readAddress, slotHash, groupHash, GROUPS_HASH } from '../../ui/schedule/address.js';
import { deleteGroup, makeOwnCopy, revertToBase, setPeriods } from '../../engine/actions.js';
import { school, ctx, group } from '../engine/helpers.mjs';

// ---------------------------------------------------------------- a page to stand on

class StubNode {
  constructor() {
    this.parentNode = null;
  }
}

class StubText extends StubNode {
  constructor(text) {
    super();
    this.data = String(text);
  }

  get textContent() {
    return this.data;
  }
}

class StubElement extends StubNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.dataset = {};
    this.value = '';
    this.readOnly = false;
    this.selected = 0;
    this.classList = {
      add: (name) => this.setClass(name, true),
      remove: (name) => this.setClass(name, false),
      contains: (name) => this.classNames().includes(name),
      toggle: (name, on) => this.setClass(name, on === undefined ? !this.classNames().includes(name) : Boolean(on)),
    };
  }

  classNames() {
    return (this.attributes.get('class') || '').split(' ').filter(Boolean);
  }

  setClass(name, on) {
    const names = this.classNames().filter((each) => each !== name);
    if (on) names.push(name);
    this.attributes.set('class', names.join(' '));
  }

  get className() {
    return this.attributes.get('class') || '';
  }

  set className(value) {
    this.attributes.set('class', String(value));
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  get hidden() {
    return this.attributes.has('hidden');
  }

  set hidden(value) {
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof StubElement);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = node instanceof StubNode ? node : new StubText(node);
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  // Send an event to this element's own listeners, and say what they did.
  send(type, init) {
    const event = { type, target: this, relatedTarget: null, prevented: false, ...(init || {}) };
    event.preventDefault = () => {
      event.prevented = true;
    };
    event.stopPropagation = () => {};
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }

  select() {
    this.selected += 1;
  }

  scrollIntoView() {}
}

globalThis.Node = StubNode;
globalThis.document = {
  createElement: (tag) => new StubElement(tag),
  createTextNode: (text) => new StubText(text),
};
globalThis.location = { hash: '#schedule/groups' };

const { roomPicker } = await import('../../ui/schedule/room-picker.js');

// ---------------------------------------------------------------- the rooms

// Invented rooms and teachers. Ms. Okonjo-Reyes is based in two rooms, 201
// and 202; two rooms were both numbered 150 (a project the checks would
// object to, and a picker still has to cope with).
const ROOMS = [
  { id: 'r101', number: '101', label: '101 — Ms. Harrowgate', teachers: 'Ms. Harrowgate', detail: 'MATH' },
  { id: 'r102', number: '102', label: '102 — Mr. Tindall', teachers: 'Mr. Tindall', detail: 'MATH' },
  { id: 'r150a', number: '150', label: '150 — Mr. Abernethy-Voss', teachers: 'Mr. Abernethy-Voss', detail: '' },
  { id: 'r150b', number: '150', label: '150 — Dr. Quennell', teachers: 'Dr. Quennell', detail: '' },
  { id: 'r201', number: '201', label: '201 — Ms. Okonjo-Reyes', teachers: 'Ms. Okonjo-Reyes', detail: 'ENG' },
  { id: 'r202', number: '202', label: '202 — Ms. Okonjo-Reyes, Mr. Lindqvist', teachers: 'Ms. Okonjo-Reyes, Mr. Lindqvist', detail: 'ENG' },
  { id: 'rb12', number: 'B12', label: 'B12', teachers: '', detail: '' },
  { id: 'rgym', number: 'Gym', label: 'Gym — Coach Draycott', teachers: 'Coach Draycott', detail: 'PE' },
];
const NO_ROOM = { id: null, number: '', label: 'No room', detail: '' };
const ids = (options) => options.map((option) => option.id);

// A picker on a slot, and what it was told to do: [['pick', id] | ['keep', text]].
function make(slot, more) {
  const calls = [];
  const settings = {
    name: 'Room for Period 1 on A Day',
    key: 'slot:d:0:room',
    text: '',
    roomId: null,
    missing: false,
    describedBy: null,
    options: () => (slot && (slot.roomId || slot.missing) ? [NO_ROOM].concat(ROOMS) : ROOMS),
    onPick: (id) => calls.push(['pick', id]),
    onKeep: (text) => calls.push(['keep', text]),
    ...(slot || {}),
    ...(more || {}),
  };
  const made = roomPicker(settings);
  const [, line, missing, list] = made.element.childNodes;
  const input = made.input;
  return {
    calls,
    input,
    line,
    missing,
    list,
    type(text) {
      input.value = text;
      input.send('input');
    },
    key(name) {
      return input.send('keydown', { key: name });
    },
    click() {
      input.send('click');
    },
    leave(to) {
      input.send('blur', { relatedTarget: to || null });
    },
    shown: () => list.children.map((item) => item.dataset.room),
    lit: () => list.children.filter((item) => item.getAttribute('aria-selected') === 'true').map((item) => item.dataset.room),
    open: () => !list.hidden,
    described: () => (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean),
  };
}

// ---------------------------------------------------------------- the rules, as functions

test('nothing typed is no room, and spaces alone are nothing', () => {
  assert.deepEqual(readTyped('', ROOMS), { kind: 'none' });
  assert.deepEqual(readTyped('   ', ROOMS), { kind: 'none' });
});

test('a room\'s exact number is that room, whatever the case and the spaces around it', () => {
  assert.equal(readTyped('101', ROOMS).option.id, 'r101');
  assert.equal(readTyped('  101 ', ROOMS).option.id, 'r101');
  assert.equal(readTyped('b12', ROOMS).option.id, 'rb12');
  assert.equal(readTyped(' GYM', ROOMS).option.id, 'rgym');
  assert.equal(readTyped('101', ROOMS).kind, 'room');
});

test('a room\'s whole label is that room, whatever the case', () => {
  assert.deepEqual(readTyped('101 — Ms. Harrowgate', ROOMS), { kind: 'room', option: ROOMS[0] });
  assert.equal(readTyped(' 202 — ms. okonjo-reyes, mr. lindqvist ', ROOMS).option.id, 'r202');
});

test('text that is in the teachers of one room alone is that room', () => {
  assert.equal(readTyped('Harrowgate', ROOMS).option.id, 'r101');
  assert.equal(readTyped('lindq', ROOMS).option.id, 'r202');
  assert.equal(readTyped('draycott', ROOMS).option.id, 'rgym');
});

test('text that is in the teachers of two rooms picks neither: both are handed back', () => {
  const found = readTyped('Okonjo', ROOMS);
  assert.equal(found.kind, 'several');
  assert.deepEqual(ids(found.options), ['r201', 'r202']);
  assert.equal(severalWords(found.options.length), '2 rooms match. Pick one from the list.');
  // "Ms." is in six of them
  assert.equal(readTyped('ms.', ROOMS).kind, 'several');
});

test('the start of another room\'s number is not that room: "10" is kept as typed, and so is "Gy"', () => {
  assert.deepEqual(readTyped('10', ROOMS), { kind: 'keep', text: '10' });
  assert.deepEqual(readTyped('Gy', ROOMS), { kind: 'keep', text: 'Gy' });
  assert.deepEqual(readTyped('2', ROOMS), { kind: 'keep', text: '2' });
  // one room alone starts with it, and it is still not that room
  assert.deepEqual(readTyped('B1', ROOMS), { kind: 'keep', text: 'B1' });
  assert.deepEqual(readTyped(' Portable 9 ', ROOMS), { kind: 'keep', text: 'Portable 9' }, 'kept without the spaces around it');
});

test('a number two rooms share picks neither of them', () => {
  const found = readTyped('150', ROOMS);
  assert.equal(found.kind, 'several');
  assert.deepEqual(ids(found.options), ['r150a', 'r150b']);
  // the whole label of one of them is that one
  assert.equal(readTyped('150 — Dr. Quennell', ROOMS).option.id, 'r150b');
});

test('with no rooms at all, anything typed is kept', () => {
  assert.deepEqual(readTyped('101', []), { kind: 'keep', text: '101' });
});

test('a list shows every option for no text, and for text the rooms with it anywhere in their label, never "No room"', () => {
  const all = [NO_ROOM].concat(ROOMS);
  assert.deepEqual(listFor('', all), all);
  assert.deepEqual(listFor('  ', all), all);
  assert.deepEqual(ids(listFor('10', all)), ['r101', 'r102']);
  assert.deepEqual(ids(listFor('OKONJO', all)), ['r201', 'r202']);
  assert.deepEqual(ids(listFor('no room', all)), []);
  assert.deepEqual(ids(listFor('zzz', all)), []);
});

// SV2-50 item 5: the words that stand for a room with no number, and a
// number with spaces round it, are not a room's teachers. The labels are the
// ones ui/schedule/common.js's roomLabel makes for such rooms.
const ODD = [
  { id: 'rnone', number: '', label: 'a room with no number — Ms. Pellegrew', teachers: 'Ms. Pellegrew', detail: '' },
  { id: 'rbare', number: '', label: 'a room with no number', teachers: '', detail: '' },
  { id: 'rpad', number: ' 104 ', label: ' 104  — Mr. Fairweather-Ness', teachers: 'Mr. Fairweather-Ness', detail: '' },
];

test('SV2-50 item 5: a room with no number is never picked by the words that stand for it, and a number with spaces round it is read right', () => {
  for (const words of ['with', 'no number', 'a room', 'room with no number', 'number']) {
    assert.deepEqual(readTyped(words, ODD), { kind: 'keep', text: words }, '"' + words + '" picked a room');
    assert.deepEqual(ids(listFor(words, ODD)), [], '"' + words + '" listed a room');
  }
  // its teacher still finds it, and so does its whole label
  assert.equal(readTyped('Pellegrew', ODD).option.id, 'rnone');
  assert.equal(readTyped('a room with no number — Ms. Pellegrew', ODD).option.id, 'rnone');
  // the padded number, by number and by teacher, and the teacher's name is
  // looked through whole: the start of it ("Mr. F") and its end ("Ness")
  assert.equal(readTyped('104', ODD).option.id, 'rpad');
  assert.equal(readTyped('Fairweather', ODD).option.id, 'rpad');
  assert.equal(readTyped('mr. f', ODD).option.id, 'rpad');
  assert.equal(readTyped('ness', ODD).option.id, 'rpad');
  assert.deepEqual(ids(listFor('10', ODD)), ['rpad']);
  // a teacher's text is never read off the end of a number: "4 " is in the label after "10"
  assert.deepEqual(readTyped('4', ODD), { kind: 'keep', text: '4' });
});

test('SV2-50 item 11: text is folded by NFKC and without a locale, and "Room 101" is Room 101', () => {
  // a full-width number
  assert.equal(readTyped('１０１', ROOMS).option?.id, 'r101', 'readTyped(\'１０１\', ROOMS)');
  assert.deepEqual(ids(listFor('１０', ROOMS)), ['r101', 'r102']);
  // a name typed with its accent as a mark of its own (NFD), and stored that way
  const accented = [{ id: 'r301', number: '301', label: '301 — Mme Renée Fauchard', teachers: 'Mme Renée Fauchard', detail: '' }];
  assert.equal(readTyped('Rene\u0301e', accented).option?.id, 'r301', 'readTyped(\'Rene\u0301e\', accented)');
  const stored = [{ id: 'r301', number: '301', label: '301 — Mme Rene\u0301e Fauchard', teachers: 'Mme Rene\u0301e Fauchard', detail: '' }];
  assert.equal(readTyped('Renée', stored).option?.id, 'r301', 'readTyped(\'Renée\', stored)');
  // (No case for the locale: typed text and a room's text are folded by the
  // one function, so a locale's lower case would agree with itself and pass
  // here either way. That fold() names no locale is read in room-rules.js.)
  // "Room 101", as a sentence of the tool names it, in any case
  assert.equal(readTyped('Room 101', ROOMS).option?.id, 'r101', 'readTyped(\'Room 101\', ROOMS)');
  assert.equal(readTyped('  room  b12 ', ROOMS).option?.id, 'rb12', 'readTyped(\'  room  b12 \', ROOMS)');
  assert.deepEqual(ids(listFor('Room 10', ROOMS)), ['r101', 'r102']);
  // "Room" alone names nothing, and "Room 10" is not Room 101
  assert.deepEqual(readTyped('Room', ROOMS), { kind: 'keep', text: 'Room' });
  assert.deepEqual(readTyped('Room 10', ROOMS), { kind: 'keep', text: 'Room 10' });
  // two rooms numbered 150 are still two
  assert.equal(readTyped('Room 150', ROOMS).kind, 'several');
});

// SV2-54 item 1: the start of a room's label lists it, as it did before
// SV2-50 ("101 — ms" and "101 — Ms. Okafo" listed r101; after SV2-50 they
// listed nothing, live on the site). Listing is not picking: the text is
// still kept as typed when the field is left.
test('SV2-54 item 1: text that starts a room\'s label, folded, lists that room, and is still not picked', () => {
  const okafor = [
    { id: 'r101', number: '101', label: '101 — Ms. Okafor', teachers: 'Ms. Okafor', detail: '' },
    { id: 'r102', number: '102', label: '102 — Mr. Tindall', teachers: 'Mr. Tindall', detail: '' },
  ];
  for (const typed of ['101 — ms', '101 — Ms. Okafo', '101 — MS. OKAFOR', ' 101 — ', 'Room 101 — Ms', '１０１ — Ｍｓ']) {
    assert.deepEqual(ids(listFor(typed, okafor)), ['r101'], 'listFor(' + JSON.stringify(typed) + ')');
  }
  assert.deepEqual(readTyped('101 — ms', okafor), { kind: 'keep', text: '101 — ms' });
  assert.deepEqual(readTyped('101 — Ms. Okafo', okafor), { kind: 'keep', text: '101 — Ms. Okafo' });
  // the whole label is the room, as before
  assert.equal(readTyped('101 — Ms. Okafor ', okafor).option?.id, 'r101');
  // the label is read from its start only: the middle of one is not a start
  assert.deepEqual(ids(listFor('— ms', okafor)), [], '"— ms" is not the start of a label');
  assert.deepEqual(ids(listFor('1 — ms', okafor)), [], '"1 — ms" is not the start of a label');
  // a padded number's label, from its start as the field shows it
  assert.deepEqual(ids(listFor('104  — mr', [{ id: 'rpad', number: ' 104 ', label: ' 104  — Mr. Fairweather-Ness', teachers: 'Mr. Fairweather-Ness' }])), ['rpad']);
});

// SV2-54 item 2: the whole of the words that stand for a room with no number
// (the label roomLabel gives such a room with no teacher) is not that room.
test('SV2-54 item 2: the whole phrase "a room with no number", in any case and with spaces round it, picks nothing and lists nothing', () => {
  for (const words of ['a room with no number', 'A Room With No Number', 'A ROOM WITH NO NUMBER', '  a room with no number ', 'Room a room with no number']) {
    assert.deepEqual(readTyped(words, ODD), { kind: 'keep', text: words.trim() }, JSON.stringify(words) + ' picked a room');
    assert.deepEqual(ids(listFor(words, ODD)), [], JSON.stringify(words) + ' listed a room');
  }
  // the label of one with a teacher names its teacher, and that is the room
  assert.equal(readTyped('A ROOM WITH NO NUMBER — ms. pellegrew', ODD).option?.id, 'rnone');
});

test('SV2-54 item 2: a field that holds a room with no number keeps its room when its own words are typed again, and when they are picked again', () => {
  const held = make({ text: 'a room with no number', roomId: 'rbare' }, { options: () => [NO_ROOM].concat(ODD) });
  held.type('A room with no number');
  held.leave();
  assert.deepEqual(held.calls, [], 'its own words typed again dropped the room');
  assert.equal(held.input.value, 'a room with no number');
  const entered = make({ text: 'a room with no number', roomId: 'rbare' }, { options: () => [NO_ROOM].concat(ODD) });
  entered.type('a room with no number ');
  entered.key('Enter');
  assert.deepEqual(entered.calls, []);
  // and other words are kept, as any text that is no room
  const other = make({ text: 'a room with no number', roomId: 'rbare' }, { options: () => [NO_ROOM].concat(ODD) });
  other.type('a room with no window');
  other.leave();
  assert.deepEqual(other.calls, [['keep', 'a room with no window']]);
});

// ---------------------------------------------------------------- the picker: Enter and leaving the field

test('"10" and Enter keeps "10", as leaving the field does: no room is highlighted while typing, and none is picked', () => {
  for (const how of ['Enter', 'leave']) {
    const picker = make();
    picker.type('10');
    assert.deepEqual(picker.shown(), ['r101', 'r102'], how);
    assert.deepEqual(picker.lit(), [], how + ': a room is highlighted that no arrow went to');
    assert.equal(picker.input.getAttribute('aria-activedescendant'), null);
    if (how === 'Enter') assert.equal(picker.key('Enter').prevented, true);
    else picker.leave();
    assert.deepEqual(picker.calls, [['keep', '10']], how);
    assert.equal(picker.input.value, '10', how);
    assert.equal(picker.open(), false, how);
  }
});

test('the arrow keys highlight, and Enter picks what they highlighted', () => {
  const picker = make();
  picker.type('10');
  picker.key('ArrowDown');
  assert.deepEqual(picker.lit(), ['r101']);
  assert.equal(picker.input.getAttribute('aria-activedescendant'), picker.list.children[0].id);
  picker.key('ArrowDown');
  assert.deepEqual(picker.lit(), ['r102']);
  picker.key('ArrowDown');
  assert.deepEqual(picker.lit(), ['r101'], 'past the last is the first');
  picker.key('ArrowUp');
  assert.deepEqual(picker.lit(), ['r102']);
  picker.key('Enter');
  assert.deepEqual(picker.calls, [['pick', 'r102']]);
  assert.equal(picker.input.value, '102 — Mr. Tindall');
  // ArrowUp with nothing highlighted goes to the last
  const up = make();
  up.type('10');
  up.key('ArrowUp');
  assert.deepEqual(up.lit(), ['r102']);
});

test('typing after an arrow takes the highlight off: Enter then reads the text', () => {
  const picker = make();
  picker.type('10');
  picker.key('ArrowDown');
  picker.type('102');
  assert.deepEqual(picker.lit(), []);
  picker.key('Enter');
  assert.deepEqual(picker.calls, [['pick', 'r102']], 'a whole number typed is that room');
  const kept = make();
  kept.type('1');
  kept.key('ArrowDown');
  kept.type('10');
  kept.key('Enter');
  assert.deepEqual(kept.calls, [['keep', '10']]);
});

test('an option highlighted, then the field left: what was typed is read, and the highlight picks nothing', () => {
  const picker = make();
  picker.type('10');
  picker.key('ArrowDown');
  assert.deepEqual(picker.lit(), ['r101']);
  picker.leave();
  assert.deepEqual(picker.calls, [['keep', '10']]);
  // a click on an option is a pick (SV2-50 item 10: the click, not the press)
  const pressed = make();
  pressed.type('10');
  assert.equal(pressed.list.children[1].send('pointerdown').prevented, true, 'the press took the focus from the field');
  assert.equal(pressed.list.children[1].send('mousedown').prevented, true, 'the press took the focus from the field');
  pressed.list.children[1].send('click', { button: 0 });
  assert.deepEqual(pressed.calls, [['pick', 'r102']]);
});

test('a number, a whole label and one teacher\'s name are picked on Enter and on leaving alike', () => {
  for (const [typed, id] of [['101', 'r101'], [' b12 ', 'rb12'], ['gym — coach draycott', 'rgym'], ['Harrowgate', 'r101']]) {
    for (const how of ['Enter', 'leave']) {
      const picker = make();
      picker.type(typed);
      if (how === 'Enter') picker.key('Enter');
      else picker.leave();
      assert.deepEqual(picker.calls, [['pick', id]], typed + ', ' + how);
    }
  }
});

test('two rooms for what was typed: Enter leaves the list open on the two and says so, picking neither; leaving keeps the text', () => {
  for (const [typed, two] of [['Okonjo', ['r201', 'r202']], ['150', ['r150a', 'r150b']]]) {
    const picker = make();
    picker.type(typed);
    picker.key('Enter');
    assert.deepEqual(picker.calls, [], typed + ': Enter picked or kept');
    assert.equal(picker.open(), true, typed);
    assert.deepEqual(picker.shown(), two, typed);
    assert.deepEqual(picker.lit(), [], typed);
    assert.equal(picker.line.textContent, '2 rooms match. Pick one from the list.');
    assert.ok(picker.described().includes(picker.line.id), 'the field is not described by the line');
    assert.equal(picker.input.value, typed);
    // again: still neither
    picker.key('Enter');
    assert.deepEqual(picker.calls, []);
    // the arrows choose between them
    picker.key('ArrowDown');
    picker.key('ArrowDown');
    picker.key('Enter');
    assert.deepEqual(picker.calls, [['pick', two[1]]], typed);

    const left = make();
    left.type(typed);
    left.leave();
    assert.deepEqual(left.calls, [['keep', typed]], typed + ': leaving the field picked one');
    const both = make();
    both.type(typed);
    both.key('Enter');
    both.leave();
    assert.deepEqual(both.calls, [['keep', typed]], typed + ': Enter then leaving');
  }
});

test('kept text that two rooms answer to says so for as long as it is kept, and opens on the two', () => {
  const picker = make({ text: 'Okonjo', missing: true });
  assert.equal(picker.line.textContent, '2 rooms match. Pick one from the list.');
  assert.equal(picker.missing.hidden, false);
  assert.deepEqual(picker.described(), [picker.missing.id, picker.line.id]);
  picker.click();
  assert.deepEqual(picker.shown(), ['r201', 'r202']);
  assert.deepEqual(picker.lit(), []);
  // kept text that is no room at all opens on every room
  const other = make({ text: 'Portable 9', missing: true });
  assert.equal(other.line.textContent, '');
  other.click();
  assert.equal(other.shown().length, ROOMS.length + 1);
});

// ---------------------------------------------------------------- the picker: a field that holds a room

test('a field that holds a room opens with that room highlighted, by a click and by ArrowDown: Enter changes nothing', () => {
  for (const how of ['click', 'ArrowDown']) {
    const picker = make({ text: '201 — Ms. Okonjo-Reyes', roomId: 'r201' });
    if (how === 'click') picker.click();
    else picker.key('ArrowDown');
    assert.equal(picker.open(), true, how);
    assert.equal(picker.shown()[0], '', 'the case needs "No room" first on the list');
    assert.deepEqual(picker.lit(), ['r201'], how + ': the highlight is not on the room the slot holds');
    picker.key('Enter');
    assert.deepEqual(picker.calls, [], how + ': Enter on a list just opened changed the slot');
    assert.equal(picker.open(), false);
    assert.equal(picker.input.value, '201 — Ms. Okonjo-Reyes');
  }
});

test('from its own room the arrows go to "No room", and Enter there empties the slot', () => {
  const picker = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  picker.click();
  assert.deepEqual(picker.lit(), ['r101']);
  picker.key('ArrowUp');
  assert.deepEqual(picker.lit(), ['']);
  picker.key('Enter');
  assert.deepEqual(picker.calls, [['pick', null]]);
  assert.equal(picker.input.value, '');
});

test('an empty field opened by ArrowDown is on the first room, and opened by a click is on none', () => {
  const down = make();
  down.key('ArrowDown');
  assert.deepEqual(down.lit(), ['r101']);
  down.key('Enter');
  assert.deepEqual(down.calls, [['pick', 'r101']]);
  const clicked = make();
  clicked.click();
  assert.deepEqual(clicked.lit(), []);
  clicked.key('Enter');
  assert.deepEqual(clicked.calls, []);
  assert.equal(clicked.open(), false);
});

test('the room the slot already holds, typed again or picked again, is no change; an emptied field is no room', () => {
  const again = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  again.type('101');
  again.key('Enter');
  assert.deepEqual(again.calls, []);
  assert.equal(again.input.value, '101 — Ms. Harrowgate', 'the label is put back');
  const emptied = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  emptied.type('');
  emptied.leave();
  assert.deepEqual(emptied.calls, [['pick', null]]);
  const nothing = make();
  nothing.type('x');
  nothing.type('');
  nothing.key('Enter');
  assert.deepEqual(nothing.calls, [], 'an empty slot emptied is no change');
  // kept text typed again as it was is no change either
  const kept = make({ text: 'Portable 9', missing: true });
  kept.type('Portable 9');
  kept.leave();
  assert.deepEqual(kept.calls, []);
  assert.equal(kept.missing.hidden, false);
});

test('Escape shuts the list, and then puts back what the slot holds', () => {
  const picker = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  picker.type('20');
  assert.equal(picker.open(), true);
  assert.equal(picker.key('Escape').prevented, true);
  assert.equal(picker.open(), false);
  assert.equal(picker.input.value, '20');
  assert.equal(picker.key('Escape').prevented, true);
  assert.equal(picker.input.value, '101 — Ms. Harrowgate');
  assert.equal(picker.key('Escape').prevented, false, 'a third Escape is the page\'s');
  picker.leave();
  assert.deepEqual(picker.calls, []);
});

// ---------------------------------------------------------------- the picker: the line, and a field that is read only

test('text that matches nothing is said on the line, a status the field is described by, and there is no list', () => {
  const picker = make({ describedBy: 'finding-7' });
  assert.deepEqual(picker.described(), ['finding-7'], 'described by a line with no words');
  picker.type('zzz');
  // a status from the first key (SV2-50 item 11)
  assert.equal(picker.line.getAttribute('role'), 'status');
  assert.equal(picker.line.textContent, 'No room matches. It is kept as typed, and marked as not in the building.');
  assert.deepEqual(picker.described(), ['finding-7', picker.line.id]);
  assert.equal(picker.open(), false, 'a list is open with nothing in it to pick');
  assert.equal(picker.input.getAttribute('aria-expanded'), 'false');
  assert.equal(picker.input.classList.contains('sch-room--missing'), true);
  picker.type('10');
  assert.equal(picker.line.textContent, '');
  assert.equal(picker.input.classList.contains('sch-room--missing'), false);
  assert.equal(picker.input.getAttribute('aria-expanded'), 'true');
});

test('with no rooms in the building the line says so with a link, the link keeps the picker open, and pressing it keeps what was typed', () => {
  const picker = make(null, { options: () => [] });
  picker.click();
  assert.equal(picker.line.textContent, 'No rooms in the building yet. Number them in Building.');
  const link = picker.line.children[0];
  assert.equal(link.tagName, 'A');
  assert.equal(link.getAttribute('href'), '#building');
  assert.equal(link.getAttribute('tabindex'), null, 'the link is taken out of the Tab order');
  picker.type('B12');
  assert.equal(picker.line.children[0], link, 'the link is made again at every key, under the focus it may hold');
  // Tab from the field lands on the link: the picker has not been left
  picker.leave(link);
  assert.deepEqual(picker.calls, []);
  assert.equal(picker.line.textContent, 'No rooms in the building yet. Number them in Building.');
  globalThis.location.hash = '#schedule/groups';
  assert.equal(link.send('click').prevented, true);
  assert.deepEqual(picker.calls, [['keep', 'B12']]);
  assert.equal(globalThis.location.hash, '#building');
  // and Tab on past the link is leaving
  const on = make(null, { options: () => [] });
  on.type('B12');
  on.leave(on.line.children[0]);
  on.line.children[0].send('blur', { relatedTarget: null });
  assert.deepEqual(on.calls, [['keep', 'B12']]);
});

test('a field that is read only neither opens its list, nor picks, nor keeps', () => {
  const picker = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  picker.input.readOnly = true;
  picker.click();
  assert.equal(picker.open(), false);
  picker.key('ArrowDown');
  assert.equal(picker.open(), false);
  picker.key('Enter');
  // a browser sends no input to a field that is read only; one that came anyway changes nothing
  picker.input.value = '102';
  picker.input.send('input');
  assert.equal(picker.open(), false);
  picker.key('Enter');
  picker.leave();
  assert.deepEqual(picker.calls, []);
  // made read only with the list already open and an option highlighted
  const late = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  late.click();
  late.key('ArrowDown');
  late.input.readOnly = true;
  late.key('Enter');
  assert.deepEqual(late.calls, []);
  assert.equal(late.input.value, '101 — Ms. Harrowgate');
  late.list.children[3].send('click', { button: 0 });
  assert.deepEqual(late.calls, []);
});

// ---------------------------------------------------------------- SV2-50: presses, composing, a drawing under the list

test('SV2-50 item 10: an option is picked by a click with the main button, never as the pointer comes down, so a finger scrolling the list picks nothing', () => {
  const picker = make();
  picker.type('10');
  const option = picker.list.children[0];
  // a finger lands on the list and scrolls it: the press, then no click
  option.send('pointerdown', { pointerType: 'touch', button: 0 });
  option.send('pointercancel', { pointerType: 'touch' });
  assert.deepEqual(picker.calls, [], 'a press picked a room');
  // another button's click is not a pick either
  option.send('click', { button: 2 });
  option.send('click', { button: 1 });
  assert.deepEqual(picker.calls, []);
  assert.equal(picker.open(), true);
  // the main button's click (a tap's too) is
  option.send('click', { button: 0 });
  assert.deepEqual(picker.calls, [['pick', 'r101']]);
});

test('SV2-50 item 10: Enter and the arrows while an input method composes a word are the input method\'s: nothing is picked, kept or moved', () => {
  for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
    const picker = make();
    picker.type('10');
    picker.input.send('keydown', { key: 'ArrowDown', ...composing });
    assert.deepEqual(picker.lit(), [], 'an arrow moved the highlight while composing');
    picker.key('ArrowDown');
    assert.deepEqual(picker.lit(), ['r101']);
    const enter = picker.input.send('keydown', { key: 'Enter', ...composing });
    assert.equal(enter.prevented, false, 'the composing Enter was taken from the input method');
    assert.deepEqual(picker.calls, [], 'Enter while composing picked or kept');
    assert.equal(picker.open(), true);
    // the composition over, Enter is the picker's
    picker.key('Enter');
    assert.deepEqual(picker.calls, [['pick', 'r101']]);
  }
});

test('SV2-50 item 6: a new picker made under the focus by a drawing opens with the highlight the old one had, so "10", ArrowDown, a drawing, Enter is Room 101', () => {
  const old = make();
  old.type('10');
  old.key('ArrowDown');
  assert.deepEqual(old.lit(), ['r101']);
  // what the section does (ui/schedule/index.js, run): the text carried as typing, then the list resumed
  const next = make();
  next.type('10');
  assert.deepEqual(next.lit(), [], 'typing alone highlights nothing');
  next.input.send('picker:resume', { detail: { room: 'r101' } });
  assert.equal(next.open(), true);
  assert.deepEqual(next.lit(), ['r101']);
  next.key('Enter');
  assert.deepEqual(next.calls, [['pick', 'r101']]);
  // "No room" highlighted, nothing typed: the same list, on "No room"
  const held = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  held.input.send('picker:resume', { detail: { room: '' } });
  assert.deepEqual(held.lit(), ['']);
  held.key('Enter');
  assert.deepEqual(held.calls, [['pick', null]]);
  // no highlight handed over: the list opens as a click opens it
  const plain = make({ text: '101 — Ms. Harrowgate', roomId: 'r101' });
  plain.input.send('picker:resume', { detail: { room: null } });
  assert.deepEqual(plain.lit(), ['r101']);
  // a highlighted room the new list does not have: no highlight
  const gone = make();
  gone.type('10');
  gone.input.send('picker:resume', { detail: { room: 'r999' } });
  assert.deepEqual(gone.lit(), []);
});

test('SV2-50 item 11: a pick or a keep the project refuses puts the field back to what the slot holds', () => {
  const refused = make({ text: '101 — Ms. Harrowgate', roomId: 'r101', onPick: () => false, onKeep: () => false });
  refused.type('102');
  refused.key('Enter');
  assert.equal(refused.input.value, '101 — Ms. Harrowgate', 'a refused pick left the refused room in the field');
  assert.equal(refused.open(), false);
  refused.type('Portable 9');
  refused.leave();
  assert.equal(refused.input.value, '101 — Ms. Harrowgate', 'a refused keep left the refused text in the field');
  // an answer that is not false is no refusal
  const taken = make({ text: '', roomId: null, onPick: () => undefined });
  taken.type('102');
  taken.key('Enter');
  assert.equal(taken.input.value, '102 — Mr. Tindall');
});

test('SV2-50 item 11: the line is a status from the user\'s first key, so a picker drawn again under the focus does not say its words again; its link has a key', () => {
  // kept text two rooms answer to: the words are there from the start, and describe the field
  const drawn = make({ text: '150', roomId: null, missing: true });
  assert.equal(drawn.line.textContent, '2 rooms match. Pick one from the list.');
  assert.ok(drawn.described().includes(drawn.line.id));
  assert.equal(drawn.line.getAttribute('role'), null, 'a new drawing\'s line is a status before anything was pressed');
  // the text a drawing carries over is sent as an input event the page made, not a key
  drawn.input.send('input', { isTrusted: false });
  assert.equal(drawn.line.getAttribute('role'), null);
  drawn.key('ArrowDown');
  assert.equal(drawn.line.getAttribute('role'), 'status');
  // typing is a key too
  const typed = make();
  typed.type('zzz');
  assert.equal(typed.line.getAttribute('role'), 'status');
  // with no rooms, the link to the building has a key for the drawing to find it by
  const empty = make(null, { options: () => [] });
  empty.click();
  const link = empty.line.children[0];
  assert.equal(link.tagName, 'A');
  assert.equal(link.dataset.key, 'slot:d:0:room:building');
});

// ---------------------------------------------------------------- the Groups tab's addresses

test('a slot\'s address is written and read back: the group, the day type and the period', () => {
  const project = school();
  const g = group(project, '6C');
  const day = project.dayTypes[0];
  assert.equal(GROUPS_HASH, '#schedule/groups');
  assert.equal(groupHash(g.id), '#schedule/groups/' + g.id);
  assert.equal(slotHash(g.id, day.id, 1), '#schedule/groups/' + g.id + '/' + day.id + '/1');
  assert.deepEqual(readAddress(project, 'groups/' + g.id + '/' + day.id + '/1'), { group: g, slot: { dayTypeId: day.id, period: 1 } });
  assert.deepEqual(readAddress(project, 'groups/' + g.id), { group: g, slot: null });
  assert.deepEqual(readAddress(project, 'groups'), { group: null, slot: null });
  assert.deepEqual(readAddress(project, ''), { group: null, slot: null });
  // an id with a character an address escapes comes back as it was
  const odd = { ...project, groups: [{ ...g, id: 'g a/b%' }] };
  assert.equal(readAddress(odd, slotHash('g a/b%', day.id, 0).replace('#schedule/', '')).group.id, 'g a/b%');
});

test('an address whose group is no longer in the project names no group', () => {
  const project = school();
  const g = group(project, '6C');
  const day = project.dayTypes[0];
  const rest = 'groups/' + g.id + '/' + day.id + '/1';
  const after = deleteGroup(project, { id: g.id }, ctx());
  assert.deepEqual(readAddress(after, rest), { group: null, slot: null });
  assert.deepEqual(readAddress(project, 'groups/gnobody0001/' + day.id + '/1'), { group: null, slot: null });
});

test('an address whose day type is gone, or whose period is past the school\'s last or no number, opens the group and names no slot', () => {
  const project = school();
  const g = group(project, '6C');
  const day = project.dayTypes[0];
  const periods = project.settings.periods;
  assert.deepEqual(readAddress(project, 'groups/' + g.id + '/dnothing001/1'), { group: g, slot: null });
  assert.deepEqual(readAddress(project, 'groups/' + g.id + '/' + day.id + '/' + (periods - 1)).slot, { dayTypeId: day.id, period: periods - 1 });
  for (const period of [String(periods), '99', '-1', 'x', '1.5', '', '1e0']) {
    assert.deepEqual(readAddress(project, 'groups/' + g.id + '/' + day.id + '/' + period), { group: g, slot: null }, 'period ' + JSON.stringify(period));
  }
  // the school went from 8 periods to 4: the address of Period 6 names no slot now
  const fewer = setPeriods(project, { periods: 4 }, ctx());
  const still = fewer.groups.find((each) => each.id === g.id);
  assert.deepEqual(readAddress(fewer, 'groups/' + g.id + '/' + day.id + '/5'), { group: still, slot: null });
  assert.deepEqual(readAddress(fewer, 'groups/' + g.id + '/' + day.id + '/3').slot, { dayTypeId: day.id, period: 3 });
});

test('the address of a slot on a day type that is the same as another names the day it copies, until it has its own copy', () => {
  const sample = school();
  const g = group(sample, '6C');
  const [base, other] = sample.dayTypes;
  assert.deepEqual(readAddress(sample, 'groups/' + g.id + '/' + other.id + '/2').slot, { dayTypeId: other.id, period: 2 }, 'the sample\'s second day type is its own copy');
  const same = revertToBase(sample, { dayTypeId: other.id }, ctx());
  assert.deepEqual(readAddress(same, 'groups/' + g.id + '/' + other.id + '/2').slot, { dayTypeId: base.id, period: 2 });
  const own = makeOwnCopy(same, { dayTypeId: other.id }, ctx());
  assert.deepEqual(readAddress(own, 'groups/' + g.id + '/' + other.id + '/2').slot, { dayTypeId: other.id, period: 2 });
});
