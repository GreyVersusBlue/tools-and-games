// The frame of a page, shared by every view: a heading, the sentence the page
// starts with, whatever follows, and under it the two things every page can
// do: print itself and be shared. A view returns pageOf(...) and the shell
// puts it on screen, moves focus to the heading and sets the tab's title.
//
// On paper a page is headed by the school (the shell's own line), what the
// page is (the heading) and the date it was printed (the line made here,
// which the screen never shows). The @media print block of staff/staff.css
// lays the paper out.

import { h } from './dom.js';
import { dayText } from './dates.js';
import { clockNow } from './clock.js';

function today() {
  return dayText(clockNow({ now: () => new Date() }).toISOString(), null);
}

// "Share": the device's own share sheet, with the page's name and, when the
// file is on a web address, that address. An address on disk means nothing on
// another phone, so it is never shared or copied. `title()` is asked when the
// button is pressed. Null where there is nothing to offer.
export function shareRow(title) {
  const hosted = globalThis.location.protocol === 'http:' || globalThis.location.protocol === 'https:';
  const nav = globalThis.navigator;
  const buttons = [];
  if (nav && typeof nav.share === 'function') {
    buttons.push(h('button', { class: 'btn', type: 'button', dataset: { share: 'share' }, onclick: () => {
      const what = { title: title(), text: title() };
      if (hosted) what.url = globalThis.location.href;
      Promise.resolve().then(() => nav.share(what)).catch(() => {
        // closing the share sheet without sending is not a failure
      });
    } }, 'Share'));
  }
  if (hosted && nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    const says = h('span', { class: 'muted', role: 'status' });
    buttons.push(h('button', { class: 'btn', type: 'button', dataset: { share: 'copy' }, onclick: () => {
      nav.clipboard.writeText(globalThis.location.href).then(() => {
        says.textContent = 'Link copied.';
      }, () => {
        says.textContent = 'The link could not be copied. Copy it from the address bar.';
      });
    } }, 'Copy link'), says);
  }
  return buttons.length > 0 ? h('p', { class: 'actions', dataset: { actions: 'share' } }, buttons) : null;
}

// "Print this page": the browser's own print, which is also how a page is
// saved as a PDF. A page that has a print button of its own (anything marked
// data-print) is not given a second one.
export function printButton(label, primary) {
  return h('button', { class: primary ? 'btn btn--primary' : 'btn', type: 'button', dataset: { print: 'page' }, onclick: () => globalThis.print() }, label || 'Print this page');
}

// pageOf(typed(teacher.name), 'Teaches 5 classes.', ...more)
// `title` and `lede` are text or nodes; a name somebody typed goes in through
// typed() from dom.js. What is shared is the tab's title, which the shell
// sets from the view's own: the page's name, then the school's.
export function pageOf(title, lede, ...children) {
  const page = h('article', { class: 'page__body' },
    h('p', { class: 'print-only page__printed', dataset: { printed: 'date' } }, 'Printed ', today()),
    h('h1', { class: 'page__title', tabindex: '-1' }, title),
    lede ? h('p', { class: 'lede' }, lede) : null,
    children);
  const print = page.querySelector('[data-print]') ? null : h('p', { class: 'actions', dataset: { actions: 'print' } }, printButton());
  const share = shareRow(() => document.title);
  if (print || share) page.appendChild(h('div', { class: 'page__outputs' }, print, share));
  return page;
}

// "Print this page" stands only on a page with something to print: a page
// that is still asking (which teacher, which rooms, what to search for) has
// no result, and says so with printWhen(page, false). The row leaves the
// page, and Share's frame with it when nothing else is in it.
export function printWhen(page, has) {
  page.dataset.result = has ? 'true' : 'none';
  const row = page.querySelector('[data-actions="print"]');
  if (row) row.hidden = !has;
  const outputs = page.querySelector('.page__outputs');
  if (outputs) outputs.hidden = Array.from(outputs.children).every((child) => child.hidden);
  return page;
}

// For a view whose result comes and goes as the reader chooses, before and
// after its page exists:
//
//   const gate = printGate();
//   gate.set(found.ok);                 in the view's own draw()
//   return gate.on(pageOf(...));
export function printGate() {
  let page = null;
  let has = false;
  return {
    set(value) {
      has = Boolean(value);
      if (page) printWhen(page, has);
    },
    on(made) {
      page = made;
      return printWhen(page, has);
    },
  };
}

// The date line of every page on screen is written again as printing starts,
// so a page left open since yesterday is not dated yesterday.
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('beforeprint', () => {
    for (const line of document.querySelectorAll('[data-printed="date"]')) line.replaceChildren('Printed ', today());
  });
}

// A page for an address that names something this file does not have: a
// teacher who has left, a link from an older copy.
export function missingPage(what) {
  return printWhen(pageOf('Not in this schedule', 'This copy of the schedule has no ' + what + ' at this address. It may be from an older or a newer copy.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule'))), false);
}

// What the search page says above its box when the address named no page of
// this file at all ("#/nonsense/route"): the shell puts it there.
export const UNKNOWN_PAGE_SENTENCE = 'That page is not in this schedule.';

// A view the publisher left out of this file.
export function leftOutPage(name) {
  return printWhen(pageOf(name, 'This view was not included when this schedule was published.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule'))), false);
}
