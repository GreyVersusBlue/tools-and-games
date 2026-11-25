// The title screen, DESIGN 4.2. The title and tagline come from city.json when it has them,
// so a rename is one line of data; these are the fallbacks and the About text.
import { h } from '../dom.js';
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

/** The finished game's score and rank, from the save app.js loaded (the ended game's `state.score`; there is no key of its
    own). Null for no save, a game not over, or a save with no score. The title never reads storage itself (MER-97). */
export function lastScore(state) {
  const sc = state?.phase === 'ended' ? state.score : null;
  return sc && Number.isFinite(sc.total) && typeof sc.rank === 'string' ? { total: sc.total, rank: sc.rank } : null;
}

/** Render the title screen. `art` is the manifest's A18 still (title.webp), laid behind the panel (MER-132); null or a file that fails to load leaves the gradient.
    `save` is null, or { label } for the game that Continue opens
    ("Summer 1325, Act one"). `last` is { total, rank } of a finished game (lastScore), or null. Each handler gets the button that was pressed. */
export function renderTitle({ city, art = null, save, onNew, onContinue, onAbout, onSettings, last = null }) {
  const btn = (id, label, onclick, ...more) => h('button', { class: 'choice', type: 'button', id, onclick: e => onclick(e.currentTarget) }, label, ...more);
  // the picture is decoration: the headline and the panel say everything it does, so it has no alt text. A file that fails to load takes itself
  // off the page and the stylesheet's gradient shows, as it did before the picture came.
  const still = art ? h('img', { class: 'title-still', src: `assets/art/${art.file}`, alt: '', decoding: 'async', fetchpriority: 'high', onerror: e => e.currentTarget.remove() }) : null;
  return h('main', { class: 'title-screen', id: 'screen-title' },
    still,
    h('div', { class: 'title-head' },
      h('h1', { class: 'title-name', tabindex: '-1' }, city?.title ?? TITLE_TEXT.title),
      h('p', { class: 'title-tagline' }, city?.tagline ?? TITLE_TEXT.tagline),
      // MER-138 (site sweep 2026-11-24): the way back to the board, in the pattern of the site's other games (TG-97, an "All games" link to the
      // site root on the title screen). It sits under the tagline, which every frame shows, so it never waits behind the menu.
      h('p', { class: 'title-home' }, h('a', { class: 'home-link', id: 'lnk-all-games', href: '/' }, 'All games'))),
    h('div', { class: 'title-body' },
      h('div', { class: 'paper title-menu' },
        last ? h('p', { class: 'title-last', id: 'title-last' }, `Last game: ${num(last.total)} points, ${last.rank.charAt(0).toLowerCase()}${last.rank.slice(1)}. A new game replaces it.`) : null,
        btn('btn-new', 'New game', onNew),
        save ? btn('btn-continue', 'Continue', onContinue, h('span', { class: 'hint', id: 'continue-where' }, save.label)) : null,
        h('p', { class: 'title-what' }, TITLE_TEXT.about.join(' ')),
        btn('btn-about', 'About this game', onAbout),
        btn('btn-settings', 'Settings', onSettings))));
}
