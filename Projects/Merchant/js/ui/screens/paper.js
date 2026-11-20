// What a paper says and how it reads (DESIGN 4.4 to 4.6). Pure functions from the engine's
// content and a paper to words and DOM; no state is changed here and no rule is computed.
// "Can the player afford it" is asked of the engine itself, by trying `choose` on a copy.
import { h } from '../dom.js';
import * as engine from '../../engine/index.js';

export const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const dinars = n => `${num(n)} ${Math.abs(n) === 1 ? 'dinar' : 'dinars'}`;
const loads = n => `${num(n)} ${Math.abs(n) === 1 ? 'load' : 'loads'}`;
const SIGN_MINUS = '−';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

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

const REP_WORDS = { partners: 'your partners', agents: 'your agents', court: 'the court', foreign: 'foreign merchants' };

/** Sentences for "what happened now": money and goods first, then whose trust or standing moved
    (`app` is optional; with it a reputation also says where it stands now, in the engine's words from
    view()), else the plain line when nothing a player can see changed. */
export function happened(content, effects, app = null) {
  const parts = seenEffects(content, effects).map(s => s.said);
  const view = app?.view?.();
  for (const e of effects ?? []) {
    if (typeof e.by !== 'number' || e.by === 0) continue;
    const up = e.by > 0;
    if (typeof e.trust === 'string') {
      const name = (content.agents ?? []).find(a => a.id === e.trust)?.name ?? e.trust;
      parts.push(`${name} trusts the house ${up ? 'more' : 'less'}.`);
    } else if (typeof e.rep === 'string') {
      const who = cap(REP_WORDS[e.rep] ?? e.rep), now = view?.rep?.[e.rep]?.words;
      parts.push(`${who} think ${up ? 'better' : 'less'} of the house.${now ? ` ${now}.` : ''}`);
    }
  }
  return parts.length ? parts.join(' ') : 'Nothing changed at once.';
}

/** "Cairo pays 25 a load. Damascus paid 38, two seasons ago." from what the house knows
    (view().prices), for the first expedition's card; null when the house knows nothing yet. */
export function priceLine(app) {
  const { content, state } = app;
  const home = content.city.home, stopId = content.city.firstStop ?? 'damascus';
  const stop = (content.stops ?? []).find(x => x.id === stopId);
  const plan = engine.suggestPlan(state, content, stopId);
  const good = Object.keys(plan?.cargo ?? {})[0] ?? Object.keys(state.stock).find(g => stop?.sells?.[g]);
  if (!stop || !good) return null;
  const prices = app.view().prices, name = goodName(content, good);
  const here = prices[home]?.[good], there = prices[stopId]?.[good];
  const parts = [];
  if (here?.p != null) parts.push(`${stopName(content, home)} pays ${num(here.p)} a load of ${name}.`);
  if (there?.p != null) {
    const ago = there.age === 0 ? 'this season' : there.ageWords.replace(/ old$/, ' ago');
    parts.push(`${stop.name} paid ${num(there.p)}, ${ago}.`);
  }
  return parts.length ? parts.join(' ') : null;
}

const listOf = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

/** The first thing a condition asks for that the house does not have, in words; null when the
    condition holds. Reads the same fields the engine's `holds` reads (turn.js, conditions.js) and
    only words them: whether a choice is open is still the engine's answer (choicesOf below). */
export function whyNot(cond, state, content) {
  if (!cond || typeof cond !== 'object') return null;
  if (Array.isArray(cond.all)) { for (const c of cond.all) { const w = whyNot(c, state, content); if (w) return w; } return null; }
  if (Array.isArray(cond.any)) {
    const ws = cond.any.map(c => whyNot(c, state, content));
    return ws.every(Boolean) ? listOf(ws.map(w => w.replace(/\.$/, '').replace(/^(\w)/, c => c.toLowerCase()))).replace(/^(\w)/, c => c.toUpperCase()) + '.' : null;
  }
  const lo = (v, n) => v?.gte !== undefined && n < v.gte, hi = (v, n) => v?.lte !== undefined && n > v.lte;
  if ('money' in cond) {
    if (lo(cond.money, state.money)) return `You need ${dinars(cond.money.gte)} for this and you have ${dinars(state.money)}.`;
    if (hi(cond.money, state.money)) return `Only a house with ${dinars(cond.money.lte)} or less may ask for this.`;
  } else if ('stock' in cond) {
    const have = state.stock[cond.stock] ?? 0;
    if (have < cond.gte) return `You need ${loads(cond.gte)} of ${goodName(content, cond.stock)} in the warehouse and you have ${loads(have)}.`;
  } else if ('out' in cond) {
    const n = state.expeditions.length;
    if (lo(cond.out, n)) return `You need ${cond.out.gte === 1 ? 'an expedition' : `${cond.out.gte} expeditions`} on the road first.`;
    if (hi(cond.out, n)) return cond.out.lte === 0 ? 'Not while an expedition is on the road.' : `Not with more than ${cond.out.lte} on the road.`;
  } else if ('rep' in cond) {
    const n = state.rep[cond.rep], who = REP_WORDS[cond.rep] ?? cond.rep;
    if (cond.gte !== undefined && n < cond.gte) return `${cap(who)} think too little of the house for this.`;
    if (cond.lte !== undefined && n > cond.lte) return `${cap(who)} think too well of the house for this.`;
  } else if ('flag' in cond) {
    const set = cond.flag in state.flags && (cond.gte === undefined || (typeof state.flags[cond.flag] === 'number' && state.flags[cond.flag] >= cond.gte));
    if (cond.not ? set : !set) return cond.not ? 'You have already done this.' : 'Something has to happen first.';
  } else if ('notebook' in cond) {
    if (!state.notebook.includes(cond.notebook)) return `You have not yet learned about ${(content.notebook ?? []).find(n => n.id === cond.notebook)?.title?.toLowerCase() ?? 'this'}.`;
  } else if ('agent' in cond) {
    const a = state.agents[cond.agent], name = (content.agents ?? []).find(x => x.id === cond.agent)?.name ?? cond.agent;
    if (!a || a.where === 'gone') return `${name} is no longer with the house.`;
    if (cond.hired === true && !a.hired) return `${name} is not working for you.`;
    if (cond.hired === false && a.hired) return `${name} already works for you.`;
    if (cond.where !== undefined && a.where !== cond.where) return `${name} is not ${cond.where === 'home' ? 'at home' : 'on the road'} now.`;
  } else if ('season' in cond) {
    const ses = cond.season.map(x => x);
    if (!ses.includes(engine.view(state, content).season)) return `Only in ${listOf(ses)}.`;
  }
  return null;
}

/** The choices of an open paper with their availability. The engine says whether a choice can
    be made by being asked to make it on a copy of the state. When it cannot, `why` is the
    engine's own refusal in words when it gave one ("Ali has retired and cannot be hired again"),
    else the condition on the choice put into words (whyNot). */
export function choicesOf(app, paper) {
  const { content } = app;
  const state = app.state;
  const filled = app.view().cards?.[paper.id]?.choices ?? {};
  return engine.paperChoices(state, content, paper.id).map(c => {
    let available = true, refusal = null;
    try { engine.choose(state, content, paper.id, c.id); } catch (e) { available = false; refusal = /is refused: (.+)$/.exec(e.message)?.[1] ?? null; }
    let why = null;
    if (!available) {
      why = (refusal && `${refusal.charAt(0).toUpperCase()}${refusal.slice(1)}${/[.!?]$/.test(refusal) ? '' : '.'}`)
        || whyNot(c.requires, state, content) || 'Not open to you now.';
    }
    return { ...c, label: filled[c.id]?.label ?? c.label, hint: filled[c.id]?.hint ?? c.hint, available, why, seen: seenEffects(content, c.now), prices: c.ui === 'outfit-first' ? priceLine(app) : null };
  });
}

/** The definition a paper was made from: a card, a letter, or the event behind a notice. */
export function sourceOf(content, paper) {
  if (paper.kind === 'notice') {
    // a notice the engine wrote itself carries its words (the `agent-left` notice has no event behind it)
    if (paper.data?.title) return { title: paper.data.title, body: paper.data.body ?? paper.data.headline, from: { name: 'Word in the city', role: 'Cairo', seal: null }, unlocks: [] };
    const ev = (content.events ?? []).find(e => e.id === paper.ref);
    return { ...ev?.notice, from: { name: 'Word in the city', role: 'Cairo', seal: null }, note: ev?.note, sources: ev?.sources, unlocks: [] };
  }
  if (paper.kind === 'letter') return (content.letters ?? []).find(l => l.id === paper.ref) ?? {};
  if (paper.kind === 'card') return (content.cards ?? []).find(c => c.id === paper.ref) ?? {};
  return paper; // returns and the Accounts paper carry their own words
}

/** Papers the engine writes itself, answered with "ok" and never flipped (MER-40, MER-41). */
export const RECORD_KINDS = ['return', 'lost', 'news', 'accounts'];

const stopName = (content, id) => (content.stops ?? []).find(x => x.id === id)?.name ?? id;

export function paperTitle(content, paper, cards) {
  if (paper.kind === 'return' || paper.kind === 'lost') return paper.data?.headline ?? 'News of the house';
  if (paper.kind === 'news') {
    const n = paper.letters?.length ?? 0;
    return n === 1 ? `News from ${stopName(content, paper.letters[0].stop)}` : `News from ${n} cities`;
  }
  if (paper.kind === 'accounts') return 'Accounts';
  return cards?.[paper.id]?.title ?? sourceOf(content, paper).title ?? 'A paper';
}

/** Who a paper is from: the agent's seal on a return or a loss, a plain mark on the rest. */
export function senderOf(content, paper) {
  const agent = paper.agent && (content.agents ?? []).find(a => a.id === paper.agent);
  if (agent && paper.kind === 'letter') return { name: agent.name, role: 'Word from the road', seal: agent.seal };
  if (agent && paper.kind !== 'notice') return { name: agent.name, role: paper.kind === 'lost' ? 'Word from the road' : 'Home from the road', seal: agent.seal };
  if (paper.kind === 'news') return { name: 'Price letters', role: 'Cairo', seal: null };
  if (paper.kind === 'accounts') return { name: 'Your clerk', role: 'The house, Cairo', seal: null };
  return sourceOf(content, paper).from ?? null;
}

/** What a letter says about itself, from the engine's view (DESIGN 4.5): where and when it was
    written, when it reached the desk, and for a question how long the answer takes. */
export function letterNotes(app, paper) {
  return paper.kind === 'letter' ? app.view().letters?.[paper.id] ?? null : null;
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

/** The buttons of a paper's choices, numbered for the keyboard (DESIGN 6). Every paper that asks something
    draws them here, so a card, a letter, a return and a loss answer to the same digits and the same press. */
export function choiceList(choices, { titleId, describedBy = null, paper, onChoose, locked }) {
  return h('div', { class: 'choices', role: 'group', 'aria-labelledby': titleId, 'aria-describedby': describedBy },
    choices.map((c, i) => h('button', {
      class: 'choice', type: 'button', id: `choice-${paper.id}-${c.id}`, dataset: { choice: c.id },
      'aria-disabled': c.available ? null : 'true',
      onclick: () => { if (c.available && !locked()) onChoose(c, i); },
    },
    h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)),
    h('span', { class: 'label' }, c.label),
    c.available
      ? (c.seen.length || c.hint || c.prices ? h('span', { class: 'costline' },
        c.seen.length ? h('span', { class: 'cost' }, c.seen.map((e, j) => [j ? ' · ' : '', h('span', { class: e.kind }, e.cost)]), ' now') : null,
        c.hint ? h('em', { class: 'hint' }, c.hint) : null,
        c.prices ? h('span', { class: 'prices' }, c.prices) : null) : null)
      : h('span', { class: 'costline why' }, c.why))));
}

/** The front of a card, letter or notice. onChoose(choice, index). */
export function front(app, paper, { onChoose, locked }) {
  const s = sourceOf(app.content, paper);
  const cards = app.view().cards;
  const titleId = `paper-${paper.id}-title`;
  const note = letterNotes(app, paper);
  const choices = paper.kind === 'notice'
    ? [{ id: 'ok', label: 'Noted', available: true, seen: [] }]
    : choicesOf(app, paper);
  const list = choiceList(choices, { titleId, describedBy: note?.answer ? `paper-${paper.id}-answer` : null, paper, onChoose, locked });
  return h('article', { class: `paper sheet front kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'front' }, 'aria-labelledby': titleId },
    head(app, senderOf(app.content, paper)),
    note?.line ? h('p', { class: 'letter-line', id: `paper-${paper.id}-line` }, note.line) : null,
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, paperTitle(app.content, paper, cards)),
    h('p', { class: 'sheet-body' }, cards?.[paper.id]?.body ?? s.body ?? ''),
    list,
    note?.answer ? h('p', { class: 'letter-answer', id: `paper-${paper.id}-answer` }, note.answer) : null);
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

/** The Accounts paper's lines grouped under the choice that caused them (DESIGN 2.1 rule 6), in the order the
    first line of each cause arrived: "After "Lend Hasan", you chose "Lend it":". A line whose card is gone
    from the content still names its cause as an earlier choice, never as a bare line. */
export function accountGroups(items) {
  const groups = [];
  for (const i of items) {
    const key = i.from ?? '';
    let g = groups.find(x => x.key === key);
    if (!g) {
      g = { key, from: i.from ?? null, cause: i.card && i.choice ? `After "${i.card}", you chose "${i.choice}":` : i.card ? `After "${i.card}":` : 'After an earlier choice:', items: [] };
      groups.push(g);
    }
    g.items.push(i);
  }
  return groups;
}

/** A loss paper's picture slot (DESIGN 2.1 rule 4): the still `lost` from the manifest when it has one, else the
    bare frame the picture will fill, so the sheet does not change shape when the art comes. Never read aloud. */
function pictureSlot(app) {
  const asset = app.art.get('lost');
  return h('figure', { class: 'picture-slot', dataset: { slot: 'lost' }, 'aria-hidden': 'true' },
    asset ? h('img', { src: `assets/art/${asset.file}`, alt: '', decoding: 'async' }) : null);
}

const row = (k, v) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v));

/** The engine's own papers (DESIGN 4.6, 2): a return, a loss, price letters and the folded
    Accounts paper. Each is read and set aside with one press. `open` says whether a return's
    account starts unfolded (it is folded shut on the first return of a game). */
export function record(app, paper, { onDone, open, onChoose = () => {}, locked = () => false }) {
  const { content } = app;
  const titleId = `paper-${paper.id}-title`;
  const d = paper.data ?? {};
  const body = [];
  let asking = false;
  if (paper.kind === 'return' || paper.kind === 'lost') {
    if (d.route && paper.kind === 'return') body.push(h('p', { class: 'route' }, d.route));
    const rows = paper.kind === 'return' ? (d.account ?? []) : (d.lines ?? []);
    if (rows.length) {
      const table = h('table', { class: 'accounts-table' }, h('tbody', null, rows.map(r => row(r.label, r.text))));
      body.push(paper.kind === 'return'
        ? h('details', { class: 'account', open: open ? true : null }, h('summary', null, 'Show the account'), table)
        : table);
    }
    if (d.agentLine) body.push(h('p', { class: 'agent-line' }, d.agentLine));
    // DESIGN 2.1 rules 3 and 4: the paper ends by asking, when returns.json has an entry for the trip
    const choices = choicesOf(app, paper);
    if (choices.some(c => c.id !== 'ok')) {
      asking = true;
      const askId = `paper-${paper.id}-ask`;
      body.push(h('div', { class: 'ask', id: askId },
        d.ask?.title ? h('h3', { class: 'ask-title' }, d.ask.title) : null,
        d.ask?.body ? h('p', { class: 'sheet-body' }, d.ask.body) : null),
      choiceList(choices, { titleId: d.ask?.title ? askId : titleId, paper, onChoose, locked }));
    }
  } else if (paper.kind === 'news') {
    if (paper.line) body.push(h('p', { class: 'sheet-body' }, paper.line));
    else for (const l of paper.letters ?? []) {
      body.push(h('h3', null, `From ${stopName(content, l.stop)}, written in ${l.writtenIn}`),
        h('table', { class: 'accounts-table' }, h('tbody', null, Object.entries(l.prices).map(([g, p]) =>
          row((content.goods ?? []).find(x => x.id === g)?.name ?? g, `${num(p)} a load`)))));
    }
  } else {
    for (const g of accountGroups(paper.items ?? [])) {
      body.push(h('section', { class: 'account-group', dataset: { from: g.from ?? '' } },
        h('h3', { class: 'cause' }, g.cause),
        ...g.items.map(i => h('p', { class: 'account-item' }, cap(i.changes?.join(', ') ?? i.text)))));
    }
  }
  // Focus lands on the heading, so Enter there sets the paper aside, as it turns a card's back
  // over to Next (DESIGN 6). A focused button or the account's summary keeps its own Enter.
  const onKey = e => {
    if (asking || e.key !== 'Enter' || e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.('button, summary, a, input, select, textarea')) return;
    e.preventDefault();
    onDone();
  };
  const slot = paper.kind === 'lost' ? pictureSlot(app) : null;
  return h('article', { class: `paper sheet front kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'front' }, 'aria-labelledby': titleId, onkeydown: onKey },
    head(app, senderOf(content, paper)),
    slot,
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, paperTitle(content, paper)),
    ...body,
    asking ? null : h('button', { class: 'button next', type: 'button', id: 'btn-next', onclick: onDone }, paper.kind === 'return' ? 'Into the ledger' : 'Noted'));
}

/** The edge of a paper lower in the stack: seal and title, pressed to raise it. */
export function edge(app, paper, { onRaise, tilt }) {
  return h('button', { class: 'edge', type: 'button', style: `--tilt:${tilt}deg`, dataset: { paper: paper.id }, onclick: onRaise,
    'aria-label': `Raise: ${paperTitle(app.content, paper, app.view().cards)}` },
  seal(app, senderOf(app.content, paper)?.seal), h('span', null, paperTitle(app.content, paper, app.view().cards)));
}
