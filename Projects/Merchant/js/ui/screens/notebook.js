// The notebook (DESIGN 4.10): a bound book with four tabs. An entry the player has met shows its
// title, body and source line; one not yet met is a blank ruled line, and the count says how many
// are found. Entries stand in the order they were met (state.notebook is that order).
import { h } from '../dom.js';
// index.js is MER-92's and does not export readEntry yet; it should, and this import then moves there.
import { readEntry } from '../../engine/turn.js';

export const TABS = [['terms', 'Terms'], ['places', 'Places'], ['people', 'People'], ['goods', 'Goods']];

// A source's `at` often has a page, then a note after a semicolon. Only the page goes on the line,
// and only when the part before the semicolon is a page; "estimate" and the like are left out.
const PAGE = /\bpp?\.\s*\d|^(ch|no|section)\.\s*\d/;
const pageOf = at => {
  const head = String(at ?? '').split(';')[0].trim();
  return PAGE.test(head) ? head.replace(/\s+and the .*$/, '') : null;
};

/** "Author, Title, year, page", one per distinct source and page, joined by semicolons. */
export function sourceText(content, sources) {
  const seen = new Set(), parts = [];
  for (const s of sources ?? []) {
    const src = (content.sources ?? []).find(x => x.id === s.src);
    if (!src) continue;
    const page = pageOf(s.at);
    const key = `${src.id}|${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({ author: src.author, title: src.title, year: String(src.year), page });
  }
  return parts;
}

function entry(app, e) {
  const art = e.art && app.art.get(e.art);
  const parts = sourceText(app.content, e.sources);
  const src = parts.length ? h('p', { class: 'source' }, 'Source: ', parts.flatMap((p, i) => [
    i ? '; ' : '', p.author, ', ', h('i', null, p.title), `, ${p.year}`, p.page ? `, ${p.page}` : '']), '.') : null;
  // The title is a summary; opening the entry is what counts as reading it (readEntry adds it once).
  const open = ev => { if (ev.target.open) app.act(st => readEntry(st, app.content, e.id)); };
  return h('li', { class: 'nb-entry', dataset: { entry: e.id } },
    art ? h('img', { class: 'nb-art', src: `assets/art/${art.file}`, alt: art.alt ?? '', width: 96, height: 96, loading: 'lazy', decoding: 'async' }) : null,
    h('details', { class: 'nb-open', ontoggle: open }, h('summary', null, h('h4', null, e.title)), h('p', { class: 'nb-body' }, e.body), src));
}

/** "14 of 60 found" for the whole book, or for a tab. */
export const countWords = (found, total) => `${found} of ${total} found`;

/** The body of the notebook panel: the tab list and the open tab. Returns { nodes, count } where count
    is the number of entries found, for the button. */
export function notebookBody(app, { tab = 'terms' } = {}) {
  const { content, state } = app;
  const all = content.notebook ?? [];
  const byId = new Map(all.map(e => [e.id, e]));
  const met = state.notebook.map(id => byId.get(id)).filter(Boolean);
  let current = TABS.some(([k]) => k === tab) ? tab : 'terms';

  const overall = h('p', { class: 'nb-count', id: 'nb-count' }, countWords(met.length, all.length));
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Notebook' });
  const panel = h('div', { class: 'tabpanel', role: 'tabpanel', id: 'nb-panel', tabindex: '0' });

  const tabBtns = TABS.map(([key, name]) => {
    const found = met.filter(e => e.tab === key).length;
    return h('button', { class: 'tab', type: 'button', role: 'tab', id: `nb-tab-${key}`, 'aria-controls': 'nb-panel', dataset: { tab: key },
      onclick: () => select(key),
      onkeydown: e => {
        const at = TABS.findIndex(([k]) => k === key);
        const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: TABS.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(TABS[(to + TABS.length) % TABS.length][0], true);
      } }, name, h('span', { class: 'tab-count' }, ` ${found}`));
  });
  list.append(...tabBtns);

  function select(key, focus = false) {
    current = key;
    tabBtns.forEach((b, i) => {
      const on = TABS[i][0] === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    const here = all.filter(e => e.tab === key);
    const found = met.filter(e => e.tab === key);
    panel.setAttribute('aria-labelledby', `nb-tab-${key}`);
    panel.dataset.tab = key;
    panel.replaceChildren(
      h('p', { class: 'nb-tab-count', id: 'nb-tab-count' }, countWords(found.length, here.length)),
      h('ul', { class: 'nb-entries' }, found.map(e => entry(app, e))),
      here.length > found.length
        ? h('ul', { class: 'nb-blanks', 'aria-hidden': 'true' }, Array.from({ length: here.length - found.length }, () => h('li', { class: 'nb-blank' })))
        : null);
    panel.scrollTop = 0;
  }
  select(current);
  return { nodes: [overall, list, panel], count: met.length };
}
