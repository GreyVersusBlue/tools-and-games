// The title screen, DESIGN 4.2. The title and tagline come from city.json when it has them,
// so a rename is one line of data; these are the fallbacks and the About text.
import { h } from '../dom.js';

export const TITLE_TEXT = {
  title: 'Merchant',
  tagline: 'Cairo, 1324. Buy where it is cheap, sell where it is dear, and bring your people home.',
  about: [
    'You run a trading house in Cairo in the 1320s. You never travel yourself.',
    'You hire agents, give them goods, and send them over the sea and across the desert.',
    'Their letters come home late, so every choice is a guess.',
    'In the end, the people who came home count as much as the money.',
  ],
  noSave: 'The game sends nothing anywhere and saves only in this browser.',
};

/** Render the title screen. `save` is null, or { label } for the game that Continue opens
    ("Summer 1325, Act one"). Each handler gets the button that was pressed. */
export function renderTitle({ city, save, onNew, onContinue, onAbout, onSettings }) {
  const btn = (id, label, onclick, ...more) => h('button', { class: 'choice', type: 'button', id, onclick: e => onclick(e.currentTarget) }, label, ...more);
  return h('main', { class: 'title-screen', id: 'screen-title' },
    h('div', { class: 'title-head' },
      h('h1', { class: 'title-name', tabindex: '-1' }, city?.title ?? TITLE_TEXT.title),
      h('p', { class: 'title-tagline' }, city?.tagline ?? TITLE_TEXT.tagline)),
    h('div', { class: 'title-body' },
      h('div', { class: 'paper title-menu' },
        btn('btn-new', 'New game', onNew),
        save ? btn('btn-continue', 'Continue', onContinue, h('span', { class: 'hint', id: 'continue-where' }, save.label)) : null,
        h('p', { class: 'title-what' }, TITLE_TEXT.about.join(' ')),
        btn('btn-about', 'About this game', onAbout),
        btn('btn-settings', 'Settings', onSettings))));
}
