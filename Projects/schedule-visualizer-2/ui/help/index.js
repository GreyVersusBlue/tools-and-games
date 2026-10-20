// The Help dialog (spec 14, 3.15; DESIGN 4): reached from the top bar's ?
// and the ? key on every screen. One dialog: its title stays at the top and
// its buttons (Show Getting started, Close help) at the foot while the body
// scrolls between them, so a phone upright or on its side can always close it.
//
//   openHelp(ctx, { sections, current, opener }) -> { element, close, closed }
//
// `sections` is the rail's list (ui/app.js's SECTIONS) and `current` the id
// of the section open now; the shortcuts come from ctx.shortcuts.list() and
// the numbers from the project's settings, so Help says what the planner has
// and not what someone remembered to copy. The words are ./content.js.
// The dialog is the shell's (ctx.openDialog): it traps Tab, closes on Escape
// and gives the focus back to the opener, or to the surface when the opener
// has gone. "Show Getting started" brings the card back (ctx.showGettingStarted).

import { h, uid } from '../components/dom.js';
import { table } from '../components/table.js';
import { helpModel } from './content.js';

export const HELP_TITLE = 'This is how the planner works.';

// index.html may link the sheet (with data-sheet="help"); this adds it on a
// page that does not.
const SHEET = new URL('./help.css', import.meta.url).href;
// Resolves once the sheet applies; the dialog then carries data-styled.
let sheetReady = null;
function loadSheet() {
  if (sheetReady) return sheetReady;
  const linked = document.querySelector('link[data-sheet="help"]');
  if (linked && linked.sheet) sheetReady = Promise.resolve();
  else {
    const link = linked || h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'help' } });
    sheetReady = new Promise((resolve) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
    });
    if (!linked) document.head.append(link);
  }
  return sheetReady;
}
// Asked for as the page boots, so the sheet is there before Help first opens.
if (typeof document !== 'undefined') loadSheet();

// A user's name (a section's is the tool's own, but a period word is not
// typed by the planner either) goes in as text, isolated.
const name = (text) => h('bdi', null, text);

function part(id, title, ...children) {
  const titleId = uid('help-' + id);
  return h('section', { class: 'help__part', 'aria-labelledby': titleId, data: { part: id } },
    h('h3', { class: 'help__title', id: titleId, tabindex: '-1' }, title),
    children);
}

function sectionsPart(model) {
  return part('sections', 'The ' + model.sections.length + ' sections',
    h('p', null, 'The rail on the left (along the bottom on a phone) has one item for each. The digit in its corner opens it from anywhere.'),
    h('ol', { class: 'help__sections' }, model.sections.map((section) => h('li', { class: 'help__section', data: { section: section.id, here: String(section.here) } },
      h('h4', { class: 'help__name' }, h('kbd', null, section.key), ' ', name(section.name), section.here ? h('span', { class: 'help__here' }, ' · open now') : null),
      h('p', null, section.purpose),
      section.first ? h('p', null, h('strong', null, 'First: '), section.first) : null,
      section.more ? h('p', { class: 'help__more' }, section.more) : null,
    ))));
}

function keysPart(model) {
  const list = table({
    caption: 'Keyboard shortcuts',
    key: (row) => row.id,
    columns: [
      { id: 'keys', label: 'Keys', sortable: true, value: (row) => row.keys, render: (row) => h('kbd', null, row.keys) },
      { id: 'does', label: 'What it does', sortable: true, value: (row) => row.does },
      { id: 'group', label: 'Where', sortable: true, value: (row) => row.group },
    ],
    rows: model.keys.rows,
  });
  return part('keys', 'Keyboard shortcuts',
    h('p', null, model.keys.guard),
    h('div', { class: 'help__table' }, list.element),
    h('dl', { class: 'help__groups' }, model.keys.groups.map((each) => [
      h('dt', null, name(each.group)),
      h('dd', { data: { group: each.group } }, each.says),
    ])));
}

function gesturesPart(model) {
  return part('gestures', 'Mouse, touch, pen and keyboard on a map',
    h('p', null, 'The Building plan, the Movement map, the scenario lab’s map and the Safety map all answer the same way.'),
    model.gestures.map((each) => h('div', { class: 'help__device', data: { device: each.id } },
      h('h4', { class: 'help__name' }, each.device),
      h('ul', null, each.items.map((item) => h('li', null, item))))));
}

function wordsPart(model) {
  return part('words', 'The words the planner uses',
    h('p', null, 'Each thing has one name, and the planner uses it everywhere.'),
    h('dl', { class: 'help__words' }, model.words.map((each) => [
      h('dt', { data: { term: each.term } }, name(each.term)),
      h('dd', null, each.meaning),
    ])));
}

function numbersPart(model) {
  return part('numbers', 'How the numbers are worked out',
    h('p', null, 'Every figure on every screen, print and published file comes from these rules. The numbers in them are this project’s settings.'),
    model.numbers.map((each) => h('div', { class: 'help__numbers', data: { numbers: each.id } },
      h('h4', { class: 'help__name' }, each.title),
      each.sentences.map((sentence) => h('p', null, sentence)))));
}

export function openHelp(ctx, options) {
  const styled = loadSheet();
  const model = helpModel({
    sections: options.sections,
    current: options.current,
    shortcuts: ctx.shortcuts ? ctx.shortcuts.list() : [],
    settings: ctx.store.project.settings,
  });
  const parts = [sectionsPart(model), keysPart(model), gesturesPart(model), wordsPart(model), numbersPart(model)];
  const scroller = h('div', { class: 'help__scroll', tabindex: '0', role: 'region', 'aria-label': 'Help' });
  // Buttons, not links: a link's address would change the page's hash, which
  // is how the planner moves between sections.
  const jump = h('nav', { class: 'help__jump', 'aria-label': 'Parts of Help' },
    h('ul', null, parts.map((each) => {
      const title = each.querySelector('.help__title');
      return h('li', null, h('button', { type: 'button', class: 'btn btn--quiet', data: { jump: each.dataset.part }, on: { click: () => {
        title.scrollIntoView({ block: 'start' });
        title.focus({ preventScroll: true });
      } } }, title.textContent));
    })));
  const here = model.current
    ? h('p', { class: 'help__lead', data: { lead: model.current.id } }, 'You are in ', name(model.current.name), '. ', model.current.purpose)
    : h('p', { class: 'help__lead' }, 'The planner has ' + model.sections.length + ' sections.');
  scroller.append(here, jump, ...parts);

  const dialog = ctx.openDialog({
    id: 'help-dialog',
    title: HELP_TITLE,
    opener: options.opener,
    body: scroller,
    buttons: [
      { label: 'Show Getting started', value: 'start' },
      { label: 'Close help', value: null },
    ],
  });
  // openDialog focused Close before the class was on, while the whole dialog
  // was one scrolling box, and so scrolled itself down to it; as Help its own
  // box does not scroll, and that offset would hide the title. It is put back
  // now, and again once the sheet applies, before data-styled says so.
  dialog.element.classList.add('help');
  dialog.element.scrollTop = 0;
  styled.then(() => {
    dialog.element.scrollTop = 0;
    dialog.element.dataset.styled = 'true';
  });
  dialog.closed.then((value) => {
    if (value === 'start') ctx.showGettingStarted();
  });
  return dialog;
}
