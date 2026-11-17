// The title screen, DESIGN 4.2. The text is data so a rename is one line;
// it moves into data/cairo/text.json when the content loader exists.
import { h } from '../dom.js';

export const TITLE_TEXT = {
  title: 'Merchant',
  tagline: 'Cairo, 1324. Buy where it is cheap, sell where it is dear, and bring your people home.',
  notReady: 'The first playable season is being built. Come back soon.',
  about: [
    'You run a trading house in Cairo in the 1320s. You never travel yourself.',
    'You hire agents, give them goods, and send them over the sea and across the desert.',
    'Their letters come home late, so every choice is a guess.',
    'In the end, the people who came home count as much as the money.',
  ],
  noSave: 'This game saves nothing yet.',
};

/** Render the title screen. onAbout and onSettings get the button that was pressed. */
export function renderTitle({ onAbout, onSettings }) {
  const reasonId = 'new-game-reason';
  return h('main', { class: 'title-screen', id: 'screen-title' },
    h('div', { class: 'title-head' },
      h('h1', { class: 'title-name', tabindex: '-1' }, TITLE_TEXT.title),
      h('p', { class: 'title-tagline' }, TITLE_TEXT.tagline)),
    h('div', { class: 'title-body' },
      h('div', { class: 'paper title-menu' },
        // aria-disabled, not disabled: a Tab user reaches it and hears the reason.
        // The handler is empty on purpose; there is no game to start yet.
        h('button', { class: 'choice', type: 'button', id: 'btn-new', 'aria-disabled': 'true', 'aria-describedby': reasonId, onclick: () => {} }, 'New game'),
        h('p', { class: 'title-reason', id: reasonId }, TITLE_TEXT.notReady),
        h('p', { class: 'title-what' }, TITLE_TEXT.about.join(' ')),
        h('button', { class: 'choice', type: 'button', id: 'btn-about', onclick: e => onAbout(e.currentTarget) }, 'About this game'),
        h('button', { class: 'choice', type: 'button', id: 'btn-settings', onclick: e => onSettings(e.currentTarget) }, 'Settings'))));
}
