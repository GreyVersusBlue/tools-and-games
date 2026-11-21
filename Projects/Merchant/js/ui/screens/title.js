// The title screen, DESIGN 4.2. The title and tagline come from city.json when it has them,
// so a rename is one line of data; these are the fallbacks and the About text.
import { h } from '../dom.js';
import { SAVE_KEY } from '../../save.js';
import { num } from './paper.js';

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

/** The last finished game's score and rank, read from the save slot itself (the ended game's `state.score`; there is
    no key of its own). Null while there is no save, while the game is not over, or when the save has no score. */
export function lastScore(storage = globalThis.localStorage) {
  try {
    const st = JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null');
    const sc = st?.phase === 'ended' ? st.score : null;
    return sc && Number.isFinite(sc.total) && typeof sc.rank === 'string' ? { total: sc.total, rank: sc.rank } : null;
  } catch { return null; }
}

/** Render the title screen. `save` is null, or { label } for the game that Continue opens
    ("Summer 1325, Act one"). Each handler gets the button that was pressed. */
export function renderTitle({ city, save, onNew, onContinue, onAbout, onSettings, last = save ? lastScore() : null }) {
  const btn = (id, label, onclick, ...more) => h('button', { class: 'choice', type: 'button', id, onclick: e => onclick(e.currentTarget) }, label, ...more);
  return h('main', { class: 'title-screen', id: 'screen-title' },
    h('div', { class: 'title-head' },
      h('h1', { class: 'title-name', tabindex: '-1' }, city?.title ?? TITLE_TEXT.title),
      h('p', { class: 'title-tagline' }, city?.tagline ?? TITLE_TEXT.tagline)),
    h('div', { class: 'title-body' },
      h('div', { class: 'paper title-menu' },
        last ? h('p', { class: 'title-last', id: 'title-last' }, `Last game: ${num(last.total)} points, ${last.rank.charAt(0).toLowerCase()}${last.rank.slice(1)}. A new game replaces it.`) : null,
        btn('btn-new', 'New game', onNew),
        save ? btn('btn-continue', 'Continue', onContinue, h('span', { class: 'hint', id: 'continue-where' }, save.label)) : null,
        h('p', { class: 'title-what' }, TITLE_TEXT.about.join(' ')),
        btn('btn-about', 'About this game', onAbout),
        btn('btn-settings', 'Settings', onSettings))));
}
