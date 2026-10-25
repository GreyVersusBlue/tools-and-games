// The three lists a finger picks from, with no browser:
//
//   node test/ui/picker.test.mjs
//
// The general picker (ui/components/picker.js: a slot's Teacher, a teacher's
// Add a room, a room's Teachers), the Building search's results
// (ui/building/search.js) and the grid sheet's list of rooms
// (ui/schedule/grid/sheet.js), each on a page that is a stand-in at the top
// of this file, worked by the events a browser would send. What is pinned:
// a press of an option is prevented (so the field keeps the focus) and picks
// nothing; the click picks, and only with the main button; a finger that
// lands on an option and swipes (a press, then pointercancel, no click)
// picks nothing. For the general picker also: a drawing that hands its list
// over (`picker:resume`) keeps the option that was highlighted, or none,
// never the first; and a field that is read only picks nothing.
//
// The stand-in page has elements, attributes, classes, listeners, a focus
// and nothing else: no layout, no bubbling. It is here so that the lists'
// own code runs, not a copy of their rules.

import test from 'node:test';
import assert from 'node:assert/strict';

import { school } from '../engine/helpers.mjs';

// ---------------------------------------------------------------- a page to stand on

class StubNode {
  constructor() {
    this.parentNode = null;
  }

  get isConnected() {
    for (let at = this; at; at = at.parentNode) if (at === globalThis.document.body) return true;
    return false;
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
    this.style = {};
    this.value = '';
    this.readOnly = false;
    this.tabIndex = -1;
    this.offsetWidth = 0;
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

  append(...nodes) {
    for (const node of nodes) {
      const child = node instanceof StubNode ? node : new StubText(node);
      if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter((each) => each !== child);
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  after(node) {
    const parent = this.parentNode;
    node.parentNode = parent;
    parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, node);
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

  set textContent(text) {
    this.replaceChildren(new StubText(text));
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

  // The focus moves: the element that had it hears blur and focusout.
  focus() {
    const had = globalThis.document.activeElement;
    if (had === this) return;
    globalThis.document.activeElement = this;
    if (had && had !== globalThis.document.body) {
      had.send('blur', { relatedTarget: this });
      had.send('focusout', { relatedTarget: this });
    }
    this.send('focus');
    this.send('focusin');
  }

  // Everything under this element that matches one simple selector
  // (a tag, `[role="option"]`): enough for these lists.
  querySelectorAll(selector) {
    const role = /^\[role="([^"]+)"\]$/.exec(selector);
    const match = role ? (el) => el.getAttribute('role') === role[1] : (el) => el.tagName === selector.toUpperCase();
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (match(child)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  select() {}

  setSelectionRange() {}

  scrollIntoView() {}
}

globalThis.Node = StubNode;
globalThis.document = {
  createElement: (tag) => new StubElement(tag),
  createTextNode: (text) => new StubText(text),
  querySelector: () => null,
  getElementById: (id) => {
    let found = null;
    const walk = (el) => {
      for (const child of el.children) {
        if (found) return;
        if (child.id === id) found = child;
        else walk(child);
      }
    };
    walk(globalThis.document.body);
    return found;
  },
};
globalThis.document.body = new StubElement('body');
globalThis.document.head = new StubElement('head');
globalThis.document.activeElement = globalThis.document.body;
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };

const { picker, optionKey } = await import('../../ui/components/picker.js');
const { attachSearch } = await import('../../ui/building/search.js');
const { sheet } = await import('../../ui/schedule/grid/sheet.js');
const { sheetModel } = await import('../../ui/schedule/grid/model.js');

const MAIN = { pointerType: 'mouse', button: 0 };
const FINGER = { pointerType: 'touch', button: 0 };

// A press of an option, as a mouse or a finger makes it: both are prevented.
function press(option, how) {
  const down = option.send('pointerdown', how);
  const mouse = option.send('mousedown', { button: 0 });
  return { pointer: down.prevented, mouse: mouse.prevented };
}

// ---------------------------------------------------------------- the general picker

// Invented teachers.
const TEACHERS = [
  { id: 't1', label: 'Ms. Harrowgate' },
  { id: 't2', label: 'Mr. Tindall' },
  { id: 't3', label: 'Dr. Quennell' },
  { id: 't4', label: 'Mx. Abernethy-Voss' },
];

// A picker on the page, its field focused, and what it picked.
function make(more) {
  const picked = [];
  const made = picker({ label: 'Teacher', options: () => TEACHERS.slice(), onPick: (option) => picked.push(option.id), ...(more || {}) });
  document.body.replaceChildren(made.element);
  document.activeElement = document.body;
  made.input.focus();
  const list = made.element.querySelector('ul');
  return {
    ...made,
    picked,
    list,
    options: () => list.children.filter((item) => item.getAttribute('role') === 'option'),
    open: () => !list.hidden,
    // the option the field says is highlighted, by its id as the list carries it
    lit: () => {
      const id = made.input.getAttribute('aria-activedescendant');
      return id ? list.children.find((item) => item.id === id).dataset.id : null;
    },
    key: (key) => made.input.send('keydown', { key }),
  };
}

test('the general picker: a click with the main button picks the option clicked', () => {
  const field = make();
  field.input.send('click');
  assert.equal(field.open(), true, 'a click did not open the list');
  assert.deepEqual(field.options().map((item) => item.dataset.id), ['t1', 't2', 't3', 't4'], 'each option carries its id');
  field.options()[2].send('click', { button: 0 });
  assert.deepEqual(field.picked, ['t3']);
  assert.equal(field.open(), false, 'the list stayed open after a pick');
});

test('the general picker: a press of an option is prevented, so the field keeps the focus, and picks nothing; another button\'s click picks nothing', () => {
  const field = make();
  field.input.send('click');
  const option = field.options()[1];
  assert.deepEqual(press(option, MAIN), { pointer: true, mouse: true }, 'a press was let through, and would take the focus from the field');
  assert.deepEqual(field.picked, [], 'a press picked');
  assert.equal(field.open(), true);
  option.send('click', { button: 2 });
  option.send('click', { button: 1 });
  assert.deepEqual(field.picked, [], 'a click of another button picked');
});

test('the general picker: a finger that lands on an option and swipes (a press, then pointercancel, no click) picks nothing', () => {
  const field = make();
  field.input.send('click');
  const option = field.options()[0];
  assert.deepEqual(press(option, FINGER), { pointer: true, mouse: true });
  option.send('pointercancel', { pointerType: 'touch' });
  assert.deepEqual(field.picked, [], 'a swipe that began on an option picked it');
  assert.equal(field.open(), true, 'a swipe shut the list');
  // the finger's tap after it is a click, and picks
  press(option, FINGER);
  option.send('click', { button: 0, pointerType: 'touch' });
  assert.deepEqual(field.picked, ['t1']);
});

test('the general picker: a drawing that hands the list over keeps the option the arrow keys highlighted, so ArrowDown twice, a drawing, Enter is the third, not the first', () => {
  const old = make();
  old.input.send('click');
  old.key('ArrowDown');
  old.key('ArrowDown');
  assert.equal(old.lit(), 't3');
  // what the section does (ui/schedule/index.js, run): the highlighted option's id, read from the list
  const handed = old.lit();
  const next = make();
  next.input.send('picker:resume', { detail: { room: undefined, id: handed } });
  assert.equal(next.open(), true, 'the list was not opened again');
  assert.equal(next.lit(), 't3', 'the highlight went back to the first option at the drawing');
  next.key('Enter');
  assert.deepEqual(next.picked, ['t3']);
});

test('the general picker: handed over with nothing highlighted, or with an option the new list does not have, the list opens on none, and Enter picks nothing', () => {
  for (const id of [null, 't9']) {
    const next = make();
    next.input.send('picker:resume', { detail: { room: null, id } });
    assert.equal(next.open(), true);
    assert.equal(next.lit(), null, 'handed ' + id + ', the list opened on ' + next.lit());
    next.key('Enter');
    assert.deepEqual(next.picked, [], 'Enter with nothing highlighted picked');
    // the arrows go on from none: Down to the first, Up to the last
    next.key('ArrowUp');
    assert.equal(next.lit(), 't4');
  }
  // an option whose id is a number is found by its text
  const numbered = make({ options: () => [{ id: 7, label: 'Room 7' }, { id: 8, label: 'Room 8' }] });
  assert.equal(optionKey({ id: 8 }), '8');
  numbered.input.send('picker:resume', { detail: { id: '8' } });
  assert.equal(numbered.lit(), '8');
  // a field that does not have the focus is not opened
  const away = make();
  document.activeElement = document.body;
  away.input.send('picker:resume', { detail: { id: 't2' } });
  assert.equal(away.open(), false, 'a field without the focus opened its list');
});

test('the general picker: a read-only field opens nothing and picks nothing, by a click, a key, an option or a hand-over', () => {
  const field = make();
  field.input.readOnly = true;
  field.input.send('click');
  assert.equal(field.open(), false);
  field.key('ArrowDown');
  assert.equal(field.open(), false);
  field.input.send('picker:resume', { detail: { id: 't2' } });
  assert.equal(field.open(), false, 'a hand-over opened a read-only field');
  field.key('Enter');
  // made read only with the list open: a click of an option picks nothing
  const late = make();
  late.input.send('click');
  late.input.readOnly = true;
  late.options()[1].send('click', { button: 0 });
  late.key('Enter');
  assert.deepEqual(field.picked.concat(late.picked), [], 'a read-only field picked');
});

// ---------------------------------------------------------------- the Building search

function makeSearch() {
  const project = school();
  const went = [];
  const form = new StubElement('form');
  const input = new StubElement('input');
  form.append(input);
  document.body.replaceChildren(form);
  document.activeElement = document.body;
  attachSearch(input, { store: { project }, navigate: (hash) => went.push(hash), announce: () => {} });
  input.focus();
  const list = form.children[1];
  input.value = '10';
  input.send('input');
  return { input, list, went, options: () => list.children.filter((item) => item.getAttribute('role') === 'option') };
}

test('the Building search: a press of a result is prevented and goes nowhere; a swipe that began on it goes nowhere; the main button\'s click goes there', () => {
  const search = makeSearch();
  const options = search.options();
  assert.ok(options.length >= 2, 'the case needs two results for "10"');
  const option = options[1];
  assert.deepEqual(press(option, FINGER), { pointer: true, mouse: true }, 'a press was let through, and would take the focus from the box');
  option.send('pointercancel', { pointerType: 'touch' });
  assert.deepEqual(search.went, [], 'a press, or a swipe that began on a result, went to it');
  assert.equal(search.list.hidden, false, 'the list shut');
  option.send('click', { button: 2 });
  assert.deepEqual(search.went, [], 'another button\'s click went to it');
  option.send('click', { button: 0 });
  assert.deepEqual(search.went, ['#building/' + option.dataset.floor + '?room=' + option.dataset.room]);
  assert.equal(search.list.hidden, true);
});

// ---------------------------------------------------------------- the grid sheet

function makeSheet() {
  const project = school();
  const staged = [];
  const made = sheet({
    view: { at: null, anchor: null, fields: true },
    stage: (ops) => staged.push(...ops),
    undo: () => false,
    remove: () => {},
    keep: () => {},
    say: () => {},
    roomLabel: (after, room) => room.number,
    focusCursor: () => {},
  });
  document.body.replaceChildren(made.element);
  document.activeElement = document.body;
  const model = sheetModel(project, project, { slots: new Map() });
  made.draw(model);
  const row = model.rows[0];
  const column = model.columns.find((each) => each.kind === 'slot');
  made.startEditing(row.id, column.id);
  const list = made.element.children[1];
  const now = row.group.days[column.dayTypeId][column.period].room;
  const options = list.children.filter((item) => item.getAttribute('role') === 'option');
  return { staged, list, options, now, row, column, input: document.activeElement };
}

test('the grid sheet: a press of a room is prevented and stages nothing; a swipe that began on it stages nothing; the main button\'s click stages that room', () => {
  const grid = makeSheet();
  assert.equal(grid.list.hidden, false, 'the case needs the list open under the cell');
  const others = grid.options.filter((item) => item.dataset.room !== grid.now);
  assert.ok(others.length >= 3, 'the case needs rooms other than the cell\'s');
  const option = others[1];
  assert.deepEqual(press(option, FINGER), { pointer: true, mouse: true }, 'a press was let through, and would take the focus from the field');
  option.send('pointercancel', { pointerType: 'touch' });
  assert.deepEqual(grid.staged, [], 'a press, or a swipe that began on a room, staged it');
  assert.equal(grid.list.hidden, false, 'the list shut');
  option.send('click', { button: 2 });
  assert.deepEqual(grid.staged, [], 'another button\'s click staged it');
  option.send('click', { button: 0 });
  assert.equal(grid.staged.length, 1);
  assert.deepEqual([grid.staged[0].op, grid.staged[0].groupId, grid.staged[0].fields.room], ['slot', grid.row.id, option.dataset.room]);
});

test('the grid sheet: the room clicked is the one staged, whatever the arrow keys had highlighted', () => {
  const grid = makeSheet();
  grid.input.send('keydown', { key: 'ArrowDown' });
  // the list is drawn again at each arrow: its options are read after it
  const options = grid.list.children.filter((item) => item.getAttribute('role') === 'option');
  const lit = options.find((item) => item.getAttribute('aria-selected') === 'true');
  assert.ok(lit, 'ArrowDown highlighted nothing');
  const clicked = options.find((item) => item !== lit && item.dataset.room !== grid.now);
  clicked.send('click', { button: 0 });
  assert.deepEqual(grid.staged.map((op) => op.fields.room), [clicked.dataset.room], 'the highlighted room was staged, not the one clicked');
});
