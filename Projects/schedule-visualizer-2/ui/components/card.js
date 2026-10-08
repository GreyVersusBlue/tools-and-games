// The two blocks every screen is made of: a card (a titled panel), and the
// sentence an empty screen opens with: what this is, and what to do first.

import { h, uid } from './dom.js';

// card({ id, title, eyebrow }, ...children) -> a <section> labelled by its title
export function card(options, ...children) {
  const titleId = uid('card');
  return h('section', { class: 'card' + (options.class ? ' ' + options.class : ''), id: options.id, 'aria-labelledby': titleId },
    options.eyebrow ? h('p', { class: 'eyebrow' }, options.eyebrow) : null,
    h('h2', { class: 'card__title', id: titleId }, options.title),
    children,
  );
}

// intro({ headline, first, facts, note, actions }) -> the opening of a screen.
//   headline  "This is the building."  (the screen's one headline)
//   first     what to do first
//   facts     what the project has here now, in a sentence
//   note      a quieter line
//   actions   buttons
export function intro(options) {
  return h('div', { class: 'intro' },
    h('h1', { class: 'intro__headline' }, options.headline),
    h('p', { class: 'intro__first' }, options.first),
    options.facts ? h('p', { class: 'intro__facts' }, options.facts) : null,
    options.actions && options.actions.length > 0 ? h('div', { class: 'intro__actions' }, options.actions) : null,
    options.note ? h('p', { class: 'intro__note' }, options.note) : null,
  );
}

export const NOT_BUILT = 'This part of the tool is still being built. What you enter elsewhere will be waiting for it.';
