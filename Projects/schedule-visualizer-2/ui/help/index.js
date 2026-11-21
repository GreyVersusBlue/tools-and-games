// The Help dialog (spec 14, 3.15; DESIGN 4): reached from the top bar's ?
// and the ? key on every screen. One dialog: its title stays at the top and
// its buttons (Show Getting started, Close help) at the foot while the body
// scrolls between them, so a phone upright or on its side can always close it.
//
//   openHelp(ctx, { sections, current, opener }) -> { element, close, closed }
//
// A Search help field sits at the top of the body (ARCHITECTURE 22.12, DESIGN
// 16.10 and 16.12 item 7; the index and matcher are ./search.js). Typing two
// letters or more replaces the body with a list of results, a button each; one
// opens its part in the full body, its heading (or a section's paragraph that
// matched) focused and scrolled to, and Back to results
// (the next Tab stop after the field) returns to the list. Escape clears a
// non-empty field first, then closes Help as before; Ctrl or ⌘ with F inside
// Help focuses the field. The dialog's data-mode says where it is (browse,
// results, opened), data-found how many results, data-pending while the
// 150 ms of typing has not settled, and the status line is a live region that
// speaks the count after 500 ms of quiet, once for each change.
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
import { buildIndex, search, announcement, partTitles } from './search.js';

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

function sectionsPart(model, titles) {
  return part('sections', titles.sections,
    h('p', null, 'The rail on the left (along the bottom on a phone) has one item for each. The digit in its corner opens it from anywhere.'),
    h('ol', { class: 'help__sections' }, model.sections.map((section) => h('li', { class: 'help__section', data: { section: section.id, here: String(section.here) } },
      h('h4', { class: 'help__name' }, h('kbd', null, section.key), ' ', name(section.name), section.here ? h('span', { class: 'help__here' }, ' · open now') : null),
      h('p', { data: { paragraph: 'purpose' } }, section.purpose),
      section.first ? h('p', { data: { paragraph: 'first' } }, h('strong', null, 'First: '), section.first) : null,
      section.more ? h('p', { class: 'help__more', data: { paragraph: 'more' } }, section.more) : null,
      ...section.parts.map((text, at) => h('p', { class: 'help__more', data: { paragraph: 'part-' + at } }, text)),
    ))));
}

function keysPart(model, titles) {
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
  return part('keys', titles.keys,
    h('p', null, model.keys.guard),
    h('div', { class: 'help__table' }, list.element),
    h('dl', { class: 'help__groups' }, model.keys.groups.map((each) => [
      h('dt', null, name(each.group)),
      h('dd', { data: { group: each.group } }, each.says),
    ])));
}

function gesturesPart(model, titles) {
  return part('gestures', titles.gestures,
    h('p', null, 'The Building plan, the Movement map, the scenario lab’s map and the Safety map all answer the same way.'),
    model.gestures.map((each) => h('div', { class: 'help__device', data: { device: each.id } },
      h('h4', { class: 'help__name' }, each.device),
      h('ul', null, each.items.map((item) => h('li', null, item))))));
}

function wordsPart(model, titles) {
  return part('words', titles.words,
    h('p', null, 'Each thing has one name, and the planner uses it everywhere.'),
    h('dl', { class: 'help__words' }, model.words.map((each) => [
      h('dt', { data: { term: each.term } }, name(each.term)),
      h('dd', null, each.meaning),
    ])));
}

function numbersPart(model, titles) {
  return part('numbers', titles.numbers,
    h('p', null, 'Every figure on every screen, print and published file comes from these rules. The numbers in them are this project’s settings.'),
    model.numbers.map((each) => h('div', { class: 'help__numbers', data: { numbers: each.id } },
      h('h4', { class: 'help__name' }, each.title),
      each.sentences.map((sentence) => h('p', null, sentence)))));
}

// The element a result opens, in the full body: a section's paragraph that
// matched, a gesture's, a word's or a numbers block's heading, a shortcut's row, a group's term, or
// the part's own heading. Compared as text, never as a selector, since a word
// can be the school's own.
function locate(root, entry) {
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const same = (list, name, value) => list.find((el) => el.dataset[name] === value);
  if (entry.part === 'sections') {
    const item = same(all('.help__section'), 'section', entry.key);
    if (!item) return null;
    // the paragraph that matched, which may be screens below the heading
    const paragraph = entry.paragraph && same(Array.from(item.querySelectorAll('p[data-paragraph]')), 'paragraph', entry.paragraph);
    return paragraph || item.querySelector('.help__name');
  }
  if (entry.part === 'keys') {
    if (entry.key.startsWith('key:')) return same(all('tbody tr[data-key]'), 'key', entry.key.slice(4));
    if (entry.key.startsWith('group:')) {
      const says = same(all('dd[data-group]'), 'group', entry.key.slice(6));
      return says && says.previousElementSibling;
    }
    return root.querySelector('[data-part="keys"] .help__title');
  }
  if (entry.part === 'gestures') {
    const item = same(all('.help__device'), 'device', entry.key);
    return item && item.querySelector('.help__name');
  }
  if (entry.part === 'words') return same(all('dt[data-term]'), 'term', entry.key);
  if (entry.part === 'numbers') {
    const item = same(all('.help__numbers'), 'numbers', entry.key);
    return item && item.querySelector('.help__name');
  }
  return null;
}

const PENDING_MS = 150;
const SPEAK_MS = 500;

export function openHelp(ctx, options) {
  const styled = loadSheet();
  const model = helpModel({
    sections: options.sections,
    current: options.current,
    shortcuts: ctx.shortcuts ? ctx.shortcuts.list() : [],
    settings: ctx.store.project.settings,
  });
  const titles = partTitles(model);
  const parts = [sectionsPart(model, titles), keysPart(model, titles), gesturesPart(model, titles), wordsPart(model, titles), numbersPart(model, titles)];
  const scroller = h('div', { class: 'help__scroll', tabindex: '0', role: 'region', 'aria-label': 'Help' });
  // Buttons, not links: a link's address would change the page's hash, which
  // is how the planner moves between sections.
  const jump = h('nav', { class: 'help__jump', 'aria-label': 'Parts of Help' },
    h('ul', null, parts.map((each) => {
      const title = each.querySelector('.help__title');
      return h('li', null, h('button', { type: 'button', class: 'btn btn--quiet', data: { jump: each.dataset.part }, on: { click: () => {
        bringToTop(title);
        title.focus({ preventScroll: true });
      } } }, title.textContent));
    })));
  const here = model.current
    ? h('p', { class: 'help__lead', data: { lead: model.current.id } }, 'You are in ', name(model.current.name), '. ', model.current.purpose)
    : h('p', { class: 'help__lead' }, 'The planner has ' + model.sections.length + ' sections.');
  const bodyNodes = [here, jump, ...parts];
  scroller.append(...bodyNodes);

  // ---- Search help
  const index = buildIndex(model);
  const fieldId = uid('help-search');
  const hintId = uid('help-search-hint');
  const field = h('input', {
    class: 'field__input help__field', id: fieldId, type: 'text', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    title: 'Search help (Ctrl+F)', 'aria-describedby': hintId,
  });
  const back = h('button', { type: 'button', class: 'btn help__back', hidden: true }, 'Back to results');
  const clear = h('button', { type: 'button', class: 'btn help__clear', hidden: true, 'aria-label': 'Clear search', title: 'Clear search' }, h('span', { 'aria-hidden': 'true' }, '✕'));
  const status = h('div', { class: 'vh', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const bar = h('div', { class: 'help__search', role: 'search' },
    h('div', { class: 'help__label' },
      h('label', { for: fieldId }, 'Search help'),
      h('span', { class: 'help__hint', id: hintId }, 'Two letters or more. Escape clears the search.')),
    h('div', { class: 'help__row' }, field, back, clear),
    status);

  let mode = 'browse';
  let current = null;       // the search last drawn
  let opened = null;        // the entry last opened, for Back to results
  let typing = 0;
  let speaking = 0;
  let said = '';
  let landed = null;
  let dialog = null;

  const setMode = (next) => {
    mode = next;
    if (dialog) dialog.element.dataset.mode = next;
    back.hidden = next !== 'opened';
  };

  function unland() {
    if (landed) delete landed.dataset.landed;
    landed = null;
  }

  function showBody() {
    unland();
    scroller.setAttribute('aria-label', 'Help');
    scroller.tabIndex = 0;
    scroller.replaceChildren(...bodyNodes);
  }

  // The results, as a list of buttons in the Tab order.
  function showResults(found) {
    unland();
    current = found;
    scroller.setAttribute('aria-label', 'Search results');
    // the results are the Tab stops; the box itself is not one
    scroller.removeAttribute('tabindex');
    // results that share a title and a section (Building's paragraphs) get
    // a second line, the paragraph's first words, to tell them apart
    const shared = new Map();
    for (const result of found.results) {
      const both = result.entry.title + '\n' + result.entry.section;
      shared.set(both, (shared.get(both) || 0) + 1);
    }
    const leadOf = (result) => (result.entry.lead && shared.get(result.entry.title + '\n' + result.entry.section) > 1
      ? h('span', { class: 'help__result-lead' }, result.entry.lead)
      : null);
    if (found.results.length === 0) {
      scroller.replaceChildren(h('p', { class: 'help__none' }, announcement(0, found.query)));
    } else {
      scroller.replaceChildren(
        h('p', { class: 'help__count' }, announcement(found.results.length, found.query)),
        h('ul', { class: 'help__results', on: { keydown: moveAmong } }, found.results.map((result, at) => h('li', null,
          h('button', { type: 'button', class: 'help__result', data: { result: String(at) }, on: { click: () => open(result.entry, at) } },
            h('span', { class: 'help__result-head' },
              h('span', { class: 'help__result-title' }, name(result.entry.title)),
              h('span', { class: 'help__result-section' }, result.entry.section)),
            leadOf(result),
            h('span', { class: 'help__result-text' }, result.segments.map((piece) => (piece.mark ? h('mark', null, piece.text) : piece.text))))))));
    }
    scroller.scrollTop = 0;
    if (dialog) dialog.element.dataset.found = String(found.results.length);
    setMode('results');
  }

  const resultButtons = () => Array.from(scroller.querySelectorAll('.help__result'));

  // ArrowDown and ArrowUp move between results; ArrowUp from the first goes
  // back to the field.
  function moveAmong(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = resultButtons();
    const at = all.indexOf(document.activeElement);
    if (at === -1) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      if (at < all.length - 1) all[at + 1].focus();
    } else if (at === 0) field.focus();
    else all[at - 1].focus();
  }

  function open(entry, at) {
    opened = { entry, at };
    showBody();
    setMode('opened');
    const target = locate(scroller, entry);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.dataset.landed = 'true';
    landed = target;
    bringToTop(target);
    target.focus({ preventScroll: true });
  }

  // Scrolls the one box that scrolls (the body, or under 500 px of height the
  // dialog) and nothing else: scrollIntoView would also move the dialog's own
  // hidden overflow and push the title and the field out of the window.
  function bringToTop(target) {
    const box = scroller.scrollHeight > scroller.clientHeight + 1 ? scroller : dialog.element;
    const frame = box.getBoundingClientRect();
    const pinned = box === scroller ? 0 : bar.getBoundingClientRect().height;
    box.scrollTop += target.getBoundingClientRect().top - frame.top - pinned - 12;
  }

  // What the field says now: nothing with under MIN_CHARS letters and digits is
  // searched.
  function settle() {
    typing = 0;
    if (dialog) delete dialog.element.dataset.pending;
    const found = search(index, field.value);
    if (found.short) {
      current = null;
      if (mode !== 'browse') showBody();
      if (dialog) delete dialog.element.dataset.found;
      setMode('browse');
      return found;
    }
    showResults(found);
    return found;
  }

  // The count is spoken once for each change, after 500 ms of quiet.
  function speak() {
    clearTimeout(speaking);
    speaking = setTimeout(() => {
      const found = current;
      const text = found ? announcement(found.results.length, found.query) : '';
      if (text === said) return;
      said = text;
      status.textContent = text;
      if (dialog) dialog.element.dataset.said = text;
    }, SPEAK_MS);
  }

  field.addEventListener('input', () => {
    clear.hidden = field.value === '';
    clearTimeout(typing);
    if (dialog) dialog.element.dataset.pending = 'true';
    typing = setTimeout(() => {
      settle();
      speak();
    }, PENDING_MS);
  });

  function clearField(focus) {
    clearTimeout(typing);
    field.value = '';
    clear.hidden = true;
    opened = null;
    settle();
    speak();
    if (focus) field.focus();
  }

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && field.value !== '') {
      // clears first; closing is for the next Escape
      event.preventDefault();
      event.stopPropagation();
      clearField(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (typing) {
        clearTimeout(typing);
        settle();
        speak();
      }
      const first = current && current.results[0];
      if (first) open(first.entry, 0);
    } else if (event.key === 'ArrowDown') {
      // during the 150 ms the list on screen is the last query's: settle
      // first, so the focus goes to a result of what the field says now
      if (typing) {
        clearTimeout(typing);
        settle();
        speak();
      }
      if (mode !== 'results') return;
      const all = resultButtons();
      if (all.length > 0) {
        event.preventDefault();
        all[0].focus();
      }
    }
  });
  clear.addEventListener('click', () => clearField(true));
  back.addEventListener('click', () => {
    if (!opened) return;
    const found = search(index, field.value);
    if (found.short) return;
    showResults(found);
    const at = Math.min(opened.at, found.results.length - 1);
    const button = resultButtons()[at];
    if (button) button.focus();
    else field.focus();
  });

  // The class is on before the dialog is shown, so help.css lays it out as
  // it opens: openDialog's focus on Close then scrolls the body, never the
  // whole dialog, and the title stays at the top with no scroll put back by
  // hand (SV2-32b; the sheet is asked for as the page boots).
  dialog = ctx.openDialog({
    id: 'help-dialog',
    class: 'help',
    title: HELP_TITLE,
    opener: options.opener,
    body: [bar, scroller],
    buttons: [
      { label: 'Show Getting started', value: 'start' },
      { label: 'Close help', value: null },
    ],
  });
  dialog.element.dataset.mode = 'browse';
  // Ctrl or ⌘ with F inside Help is Help's search, never the planner's.
  dialog.element.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      field.focus();
      field.select();
    }
  });
  dialog.closed.then(() => {
    clearTimeout(typing);
    clearTimeout(speaking);
  });
  styled.then(() => {
    dialog.element.dataset.styled = 'true';
  });
  dialog.closed.then((value) => {
    if (value === 'start') ctx.showGettingStarted();
  });
  return dialog;
}
