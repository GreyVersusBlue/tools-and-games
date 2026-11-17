// What a paper says and how it reads (DESIGN 4.4 to 4.6). Pure functions from the engine's
// content and a paper to words and DOM; no state is changed here and no rule is computed.
// "Can the player afford it" is asked of the engine itself, by trying `choose` on a copy.
import { h } from '../dom.js';
import * as engine from '../../engine/index.js';

export const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const dinars = n => `${num(n)} ${Math.abs(n) === 1 ? 'dinar' : 'dinars'}`;
const loads = n => `${num(n)} ${Math.abs(n) === 1 ? 'load' : 'loads'}`;
const SIGN_MINUS = '−';

const goodName = (content, id) => (content.goods ?? []).find(g => g.id === id)?.name?.toLowerCase() ?? id;

/** The effects of a choice that the player can see on its button: money and goods. Each is
    { kind: 'gain' | 'loss', cost: '-20 dinars', said: 'You paid 20 dinars.' }. Effects that
    change trust, standing, flags or the notebook are not numbers on a button (DESIGN 1). */
export function seenEffects(content, effects) {
  const out = [];
  for (const e of effects ?? []) {
    if (typeof e.money === 'number' && e.money !== 0) {
      const gain = e.money > 0;
      out.push({ kind: gain ? 'gain' : 'loss', cost: `${gain ? '+' : SIGN_MINUS}${dinars(Math.abs(e.money))}`,
        said: gain ? `You received ${dinars(e.money)}.` : `You paid ${dinars(-e.money)}.` });
    } else if (typeof e.stock === 'string' && typeof e.by === 'number' && e.by !== 0) {
      const gain = e.by > 0, name = goodName(content, e.stock);
      out.push({ kind: gain ? 'gain' : 'loss', cost: `${gain ? '+' : SIGN_MINUS}${loads(Math.abs(e.by))} of ${name}`,
        said: gain ? `${loads(e.by)} of ${name} came into the warehouse.` : `${loads(-e.by)} of ${name} left the warehouse.` });
    }
  }
  return out;
}

/** Sentences for "what happened now", or the plain line when nothing changed. */
export function happened(content, effects) {
  const seen = seenEffects(content, effects);
  return seen.length ? seen.map(s => s.said).join(' ') : 'Nothing changed at once.';
}

/** The choices of an open paper with their availability. The engine says whether a choice can
    be made by being asked to make it on a copy of the state. */
export function choicesOf(app, paper) {
  const { content } = app;
  const state = app.state;
  return engine.paperChoices(state, content, paper.id).map(c => {
    let available = true;
    try { engine.choose(state, content, paper.id, c.id); } catch { available = false; }
    let why = null;
    if (!available) {
      const need = c.requires?.money?.gte;
      why = typeof need === 'number' ? `You have ${dinars(state.money)}.` : 'Not open to you now.';
    }
    return { ...c, available, why, seen: seenEffects(content, c.now) };
  });
}

/** The definition a paper was made from: a card, a letter, or the event behind a notice. */
export function sourceOf(content, paper) {
  if (paper.kind === 'notice') {
    const ev = (content.events ?? []).find(e => e.id === paper.ref);
    return { ...ev?.notice, from: { name: 'Word in the city', role: 'Cairo', seal: null }, note: ev?.note, sources: ev?.sources, unlocks: [] };
  }
  if (paper.kind === 'letter') return (content.letters ?? []).find(l => l.id === paper.ref) ?? {};
  if (paper.kind === 'card') return (content.cards ?? []).find(c => c.id === paper.ref) ?? {};
  return paper; // returns and the Accounts paper carry their own words
}

export function paperTitle(content, paper) {
  const s = sourceOf(content, paper);
  return s.title ?? s.headline ?? (paper.kind === 'accounts' ? 'Accounts' : 'A paper');
}

/** "Source: Author, Title, year, where." The line a teacher reads; never an address. */
export function sourceLine(content, sources) {
  const parts = [];
  for (const s of sources ?? []) {
    const src = (content.sources ?? []).find(x => x.id === s.src);
    if (!src) continue;
    parts.push([src.author, h('i', null, src.title), String(src.year), s.at].filter(Boolean)
      .flatMap((p, i) => (i ? [', ', p] : [p])));
  }
  if (!parts.length) return null;
  return h('p', { class: 'source' }, 'Source: ', parts.flatMap((p, i) => (i ? ['; ', ...p] : p)), '.');
}

/** The round mark of a sender: the seal's picture when the manifest has one, else a plain disc. */
export function seal(app, id) {
  const asset = id && app.art.get(id);
  if (!asset) return h('span', { class: 'seal seal-plain', 'aria-hidden': 'true' });
  return h('img', { class: 'seal', src: `assets/art/${asset.file}`, alt: '', width: 48, height: 48, decoding: 'async' });
}

export function head(app, from) {
  return h('div', { class: 'sheet-head' },
    seal(app, from?.seal),
    h('p', { class: 'sender' }, h('strong', null, from?.name ?? ''), from?.role ? h('span', null, ` ${from.role}`) : null));
}

/** The front of a card, letter or notice. onChoose(choice, index). */
export function front(app, paper, { onChoose, locked }) {
  const s = sourceOf(app.content, paper);
  const titleId = `paper-${paper.id}-title`;
  const choices = paper.kind === 'notice'
    ? [{ id: 'ok', label: 'Noted', available: true, seen: [] }]
    : choicesOf(app, paper);
  const list = h('div', { class: 'choices', role: 'group', 'aria-labelledby': titleId },
    choices.map((c, i) => h('button', {
      class: 'choice', type: 'button', id: `choice-${paper.id}-${c.id}`, dataset: { choice: c.id },
      'aria-disabled': c.available ? null : 'true',
      onclick: () => { if (c.available && !locked()) onChoose(c, i); },
    },
    h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)),
    h('span', { class: 'label' }, c.label),
    c.available
      ? (c.seen.length || c.hint ? h('span', { class: 'costline' },
        c.seen.length ? h('span', { class: 'cost' }, c.seen.map((e, j) => [j ? ' · ' : '', h('span', { class: e.kind }, e.cost)]), ' now') : null,
        c.hint ? h('em', { class: 'hint' }, c.hint) : null) : null)
      : h('span', { class: 'costline why' }, c.why))));
  return h('article', { class: `paper sheet front kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'front' }, 'aria-labelledby': titleId },
    head(app, s.from),
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, paperTitle(app.content, paper)),
    h('p', { class: 'sheet-body' }, s.body ?? ''),
    list);
}

/** The back of an answered paper: what happened now, the note, new notebook entries, Next,
    and last the source line (DESIGN 4.4.2). `now` is the sentence, `fresh` the entry titles. */
export function back(app, paper, { now, fresh, onNext }) {
  const s = sourceOf(app.content, paper);
  const titleId = `paper-${paper.id}-back`;
  return h('article', { class: `paper sheet back kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'back' }, 'aria-labelledby': titleId },
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, now),
    s.note ? h('div', { class: 'note' }, h('h3', null, 'What really happened'), h('p', null, s.note)) : null,
    fresh.length ? h('p', { class: 'fresh' }, 'New in your notebook: ', fresh.join(', '), '.') : null,
    h('button', { class: 'button next', type: 'button', id: 'btn-next', onclick: onNext }, 'Next'),
    sourceLine(app.content, s.sources));
}

/** A return paper or the Accounts paper. The engine writes their words (MER-41): `headline`,
    `route`, `account` rows of [label, value] and `lines`. Until it does, none is made. */
export function record(app, paper, { onDone }) {
  const titleId = `paper-${paper.id}-title`;
  const s = sourceOf(app.content, paper);
  const rows = paper.account ?? [];
  return h('article', { class: `paper sheet front kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'front' }, 'aria-labelledby': titleId },
    head(app, s.from ?? paper.from),
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, paper.headline ?? paper.title ?? 'Accounts'),
    paper.route ? h('p', { class: 'route' }, paper.route) : null,
    (paper.lines ?? []).map(l => h('p', null, l)),
    rows.length ? h('details', { class: 'account', open: paper.open !== false },
      h('summary', null, 'Show the account'),
      h('table', null, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v)))))) : null,
    h('button', { class: 'button next', type: 'button', id: 'btn-next', onclick: onDone }, paper.kind === 'return' ? 'Into the ledger' : 'Noted'));
}

/** The edge of a paper lower in the stack: seal and title, pressed to raise it. */
export function edge(app, paper, { onRaise, tilt }) {
  const s = sourceOf(app.content, paper);
  return h('button', { class: 'edge', type: 'button', style: `--tilt:${tilt}deg`, dataset: { paper: paper.id }, onclick: onRaise,
    'aria-label': `Raise: ${paperTitle(app.content, paper)}` },
  seal(app, (s.from ?? paper.from)?.seal), h('span', null, paperTitle(app.content, paper)));
}
