// The frame of a page, shared by every view: a heading, the sentence the page
// starts with, and whatever follows. A view returns pageOf(...) and the shell
// puts it on screen, moves focus to the heading and sets the tab's title.

import { h } from './dom.js';

export const NOT_BUILT_SENTENCE = 'This page is not built yet.';

// pageOf(typed(teacher.name), 'Teaches 5 classes.', ...more)
// `title` and `lede` are text or nodes; a name somebody typed goes in through
// typed() from dom.js.
export function pageOf(title, lede, ...children) {
  return h('article', { class: 'page__body' },
    h('h1', { class: 'page__title', tabindex: '-1' }, title),
    lede ? h('p', { class: 'lede' }, lede) : null,
    children);
}

// A page for an address that names something this file does not have: a
// teacher who has left, a link from an older copy.
export function missingPage(what) {
  return pageOf('Not in this schedule', 'This copy of the schedule has no ' + what + ' at this address. It may be from an older or a newer copy.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule')));
}

// A view the publisher left out of this file.
export function leftOutPage(name) {
  return pageOf(name, 'This view was not included when this schedule was published.',
    h('p', null, h('a', { class: 'btn', href: '#/search' }, 'Search the schedule')));
}
