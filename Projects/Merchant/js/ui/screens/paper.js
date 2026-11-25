// What a paper says and how it reads (DESIGN 4.4 to 4.6). Pure functions from the engine's
// content and a paper to words and DOM; no state is changed here and no rule is computed.
// "Can the player afford it" is asked of the engine itself, by trying `choose` on a copy.
import { h, qs } from '../dom.js';
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
/** Whether a group's name takes "think" or "thinks" (MER-122: "The court think better of the house"). */
const REP_SINGULAR = new Set(['court']);

/** Sentences for "what happened now": money and goods first, then whose trust or standing moved
    (`app` is optional; with it a reputation also says where it stands now, in the engine's words from
    view()), else the plain line when nothing a player can see changed. `agent` is the paper's own agent:
    an effect written for `$agent` is said with that agent's name, never the raw token. Moves of one group
    in one result are added into one net line, so a result never says "think less" and "speak well" of the
    same group back to back, and the verb agrees with the group ("The court thinks", "Your agents think"). `result` is the choice's own sentence, when its card wrote one: it is said
    after the numbers, and then "Nothing changed at once." is never printed. */
export function happened(content, effects, app = null, { agent = null, result = null } = {}) {
  const parts = seenEffects(content, effects).map(s => s.said);
  const view = app?.view?.();
  const net = new Map();   // "trust:ali" or "rep:partners" -> { kind, id, by }, in the order first seen
  for (const e of effects ?? []) {
    if (typeof e.by !== 'number' || e.by === 0) continue;
    const id = typeof e.trust === 'string' ? (e.trust === '$agent' ? agent : e.trust) : null;
    const key = typeof e.trust === 'string' ? `trust:${id ?? e.trust}` : typeof e.rep === 'string' ? `rep:${e.rep}` : null;
    if (!key) continue;
    const m = net.get(key) ?? { trust: typeof e.trust === 'string', id: id ?? e.trust ?? e.rep, rep: e.rep, by: 0 };
    m.by += e.by;
    net.set(key, m);
  }
  for (const m of net.values()) {
    if (m.by === 0) continue;
    const up = m.by > 0;
    if (m.trust) {
      const name = m.id === '$agent' ? 'The agent' : (content.agents ?? []).find(a => a.id === m.id)?.name ?? m.id;
      parts.push(`${name} trusts the house ${up ? 'more' : 'less'}.`);
    } else {
      const who = cap(REP_WORDS[m.rep] ?? m.rep);
      let now = view?.rep?.[m.rep]?.words;
      // a drop that still leaves a good standing says nothing more: "think less" and then "speak well of you" in one breath reads as a
      // contradiction, and "Still," did not mend it (MER-99, MER-122). A drop to a worse standing still says where it stands.
      if (now && !up && /^They (speak well of you|come to you first)$/.test(now)) now = null;
      parts.push(`${who} ${REP_SINGULAR.has(m.rep) ? 'thinks' : 'think'} ${up ? 'better' : 'less'} of the house.${now ? ` ${now}.` : ''}`);
    }
  }
  if (result) parts.push(result);
  return parts.length ? parts.join(' ') : 'Nothing changed at once.';
}

/** "Cairo pays 25 a load. Damascus paid 38, two seasons ago." from what the house knows
    (view().prices), for the first expedition's card; null when the house knows nothing yet. */
export function priceLine(app) {
  const { content, state } = app;
  const home = content.city.home, stopId = content.city.firstStop ?? 'damascus';
  const stop = (content.stops ?? []).find(x => x.id === stopId);
  // The first expedition's card names its own good ("ten loads of linen") and the line under it prices that good, not the sheet's first
  // cargo, which `proposePlan` orders by its own rule (MER-142). From the second expedition the sheet's proposal is what the card sends (MER-97).
  const first = !state.log.some(e => e.kind === 'outfit');
  const good = (first && engine.openingGood(state, content, stopId)) || Object.keys(cardPlan(state, content, stopId)?.cargo ?? {})[0]
    || Object.keys(state.stock).find(g => stop?.sells?.[g]);
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

const planCache = new WeakMap();   // state -> stop id -> plan; a checked plan clones the state, and a card is drawn more than once

/** The plan the outfit sheet opens on for `stopId`, by the sheet's own rule (outfit.js, DESIGN 2.2 rule 1): the plain suggestion for
    the first expedition of a game, from the second on the engine's proposal for the road the stop is reached by, for the first free
    agent (one who knows the stop first) the engine has a proposal and an estimate for. Null when there is none. */
function cardPlan(state, content, stopId) {
  const seen = planCache.get(state) ?? new Map();
  planCache.set(state, seen);
  if (seen.has(stopId)) return seen.get(stopId);
  let plan = null;
  if (!state.log.some(e => e.kind === 'outfit')) plan = engine.suggestPlan(state, content, stopId);
  else {
    const home = content.city.home, roadId = engine.routeFor(state, content, stopId)?.route.id;
    const free = (content.agents ?? []).filter(a => state.agents[a.id]?.hired && state.agents[a.id].where === home && !state.expeditions.some(x => x.agent === a.id));
    const knows = a => a.traits?.includes(`knows-${stopId}`);
    for (const a of [...free.filter(knows), ...free.filter(a => !knows(a))]) {
      const p = roadId ? engine.proposePlan(state, content, a.id, roadId) : null;
      if (p && !p.why && engine.estimate(state, content, p)) { plan = p; break; }
    }
  }
  seen.set(stopId, plan);
  return plan;
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

const sayKey = t => String(t ?? '').replace(/[.!?]+\s*$/, '').trim().toLowerCase();

/** A loss paper's title: its headline without any sentence its question (`ask.title`) already says as a heading. A whole loss's
    headline ends "Ali did not come back." and so does the entry's title; the sheet shows each sentence once. A headline that is
    nothing but the question's title stays whole, and the question then goes without a heading of its own (askTitle). */
function lossTitle(paper) {
  const head = paper.data?.headline ?? 'News of the house', ask = paper.data?.ask?.title;
  if (!ask) return head;
  const kept = (head.match(/[^.!?]+[.!?]+/g) ?? [head]).map(x => x.trim()).filter(x => sayKey(x) !== sayKey(ask));
  return kept.length ? kept.join(' ') : head;
}

/** The heading over a return's or loss's question: the entry's title, unless the paper's own title already says it. */
const askTitle = (content, paper) => {
  const t = paper.data?.ask?.title;
  return t && sayKey(t) !== sayKey(paperTitle(content, paper)) ? t : null;
};

export function paperTitle(content, paper, cards) {
  if (paper.kind === 'lost') return lossTitle(paper);
  if (paper.kind === 'return') return paper.data?.headline ?? 'News of the house';
  if (paper.kind === 'news') {
    const n = paper.letters?.length ?? 0;
    return n === 1 ? `News from ${stopName(content, paper.letters[0].stop)}` : `News from ${n} cities`;
  }
  if (paper.kind === 'accounts') return 'Accounts';
  return cards?.[paper.id]?.title ?? sourceOf(content, paper).title ?? 'A paper';
}

/** The headline on an opened return (DESIGN 2.2 rule 2): only the engine's first sentences, who came home and what the house
    made. What the sheet hoped for, the one reason for the gap and any unsold goods follow in body type (`returnLead`). */
export function returnHeadline(content, paper) {
  return paperTitle(content, paper);
}

/** The body-type lead under a return's headline: what the sheet hoped for at sending, the one reason for the gap, then any
    unsold goods, so the hope is not buried (M4B-PLAY2). Null when there is nothing to say. A save from before `hoped` was kept (both null) says only the unsold goods. */
export function returnLead(content, paper) {
  if (paper.kind !== 'return') return null;
  const d = paper.data ?? {}, held = unsoldLine(d, content);
  if (!Number.isFinite(d.hoped) || !d.why) return held;
  const hoped = d.hoped >= 0 ? `We hoped for about ${dinars(d.hoped)}.` : `We expected to lose about ${dinars(-d.hoped)}.`;
  return `${hoped} ${d.why}${held ? ` ${held}` : ''}`;
}

const goodOf = (content, id) => (content.goods ?? []).find(g => g.id === id);

/** Goods as a spoken list: '7 loads of sugar, 3 of wool cloth, 4 of pepper and 2 of linen'. The unit is said once, by the first
    good, and again only where a good's unit differs; one good is '4 loads of pepper', one load is '1 load of pepper'. */
export function goodsList(content, goods) {
  const items = Object.entries(goods ?? {}).filter(([, n]) => n > 0);
  const first = goodOf(content, items[0]?.[0])?.unit ?? 'load';
  const parts = items.map(([g, n], i) => {
    const unit = goodOf(content, g)?.unit ?? 'load', name = (goodOf(content, g)?.name ?? g).toLowerCase();
    return i && unit === first ? `${n} of ${name}` : `${n} ${n === 1 ? unit : `${unit}s`} of ${name}`;
  });
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** One sentence for goods that came home unsold: "14 loads of wool cloth are in the warehouse, worth about 880 at Cairo's
    price." Null when nothing came home but money. It reads the paper's `goodsBack` and `cargoValue` (MER-103); a paper saved
    before those fields reads the account's "Back home" row instead ("14 loads of wool cloth (worth 880 dinars in Cairo now),
    880 dinars in all"), and if the engine changes those words the fallback goes quiet (journey pins it). */
export function unsoldLine(d, content = null) {
  if (d?.goodsBack && content) {
    const n = Object.values(d.goodsBack).filter(q => q > 0);
    if (!n.length) return null;
    const home = content.city?.home, place = (content.stops ?? []).find(x => x.id === home)?.name ?? home;
    const one = n.length === 1 && n[0] === 1;
    return `${cap(goodsList(content, d.goodsBack))} ${one ? 'is' : 'are'} in the warehouse, worth about ${num(d.cargoValue ?? 0)} at ${place}'s price.`;
  }
  const row = (d?.account ?? []).find(r => r.label === 'Back home');
  const m = /^(.+?) \(worth ([\d,]+)(?: [^)]*?)? in ([^)]+?) now\)/.exec(row?.text ?? '');
  if (!m) return null;
  const [, what, worth, place] = m;
  const one = /^1 [^ ]+ of /.test(what) && !/, | and /.test(what);
  return `${cap(what)} ${one ? 'is' : 'are'} in the warehouse, worth about ${worth} at ${place}'s price.`;
}

/** Who a paper is from: the agent's seal on a return or a loss, a plain mark on the rest. */
export function senderOf(content, paper) {
  const agent = paper.agent && (content.agents ?? []).find(a => a.id === paper.agent);
  if (agent && paper.kind === 'letter') return { name: agent.name, role: 'Word from the road', seal: agent.seal };
  if (agent && paper.kind !== 'notice') return { name: agent.name, role: paper.kind === 'lost' ? 'Bad news from the road' : 'Home from the road', seal: agent.seal };
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

/** One item's changes as one line (MER-122, as routes.js accountWords writes an item's own text): the money and goods run on with
    commas, and each sentence (a group's good name, "The court thinks better of the house.") follows whole after a full stop, so a
    sentence never sits after a comma. */
export function accountLine(changes) {
  const says = changes.filter(c => c.endsWith('.')), facts = changes.filter(c => !c.endsWith('.'));
  return [facts.length ? `${facts.join(', ')}${says.length ? '.' : ''}` : '', ...says].filter(Boolean).join(' ');
}

/** The Accounts paper's lines grouped under the choice that caused them (DESIGN 2.1 rule 6), in the order the
    first line of each cause arrived: "After "Lend Hasan", you chose "Lend it":". A line whose card is gone
    from the content still names its cause as an earlier choice, never as a bare line. */
export function accountGroups(items, content = null) {
  const groups = [];
  for (const i of items) {
    const key = i.from ?? '';
    let g = groups.find(x => x.key === key);
    if (!g) {
      g = { key, from: i.from ?? null, cause: causeLine(i, content), items: [] };
      groups.push(g);
    }
    g.items.push(i);
  }
  return groups;
}

const hasBrace = t => typeof t === 'string' && /[{}]/.test(t);

/** The agent a card tells of: the `trip` leaf of its `when`, at the top or inside a top-level `all`. */
function cardAgent(card) {
  const w = card?.when;
  if (w?.trip) return w.trip.agent ?? null;
  for (const c of Array.isArray(w?.all) ? w.all : []) if (c?.trip) return c.trip.agent ?? null;
  return null;
}

/** The engine records a card's title and a choice's label as the player saw them, filled (MER-109). A record from an
    older save holds them as written, with `{agent}` or `{to}` still in it, and keeps this fallback. For those the one slot the card itself names is filled, the agent; a slot that needs the trip
    (`{to}`, `{good}`, `{route}`, `{seasons}`) is not known here, and its words are dropped to a plainer line. */
function causeLine(i, content) {
  const card = content ? (content.cards ?? []).find(c => c.id === String(i.from ?? '').split('/')[0]) : null;
  const agent = content && cardAgent(card) ? (content.agents ?? []).find(a => a.id === cardAgent(card))?.name : null;
  const fill = t => (typeof t === 'string' && agent ? t.replace(/\{agent\}/g, agent) : t);
  const title = fill(i.card), choice = fill(i.choice);
  const cleanTitle = typeof title === 'string' && !hasBrace(title) ? title : null;
  const cleanChoice = typeof choice === 'string' && !hasBrace(choice) ? choice : null;
  if (cleanTitle && cleanChoice) return `After "${cleanTitle}", you chose "${cleanChoice}":`;
  if (cleanTitle) return `After "${cleanTitle}":`;
  return 'After an earlier choice:';
}

/** A loss paper's picture slot (DESIGN 2.1 rule 4): the still `lost` from the manifest when it has one, else the
    bare frame the picture will fill, so the sheet does not change shape when the art comes. Never read aloud. */
function pictureSlot(app) {
  const asset = app.art.get('lost');
  return h('figure', { class: 'picture-slot', dataset: { slot: 'lost' }, 'aria-hidden': 'true' },
    asset ? h('img', { src: `assets/art/${asset.file}`, alt: '', decoding: 'async' }) : null);
}

/** The box a raised paper scrolls in: the paper's own box on a laptop or the board (MER-138), else the stack, which is visible, and the page scrolls. */
export function scrollBoxOf(root) {
  const sb = qs('.sheet-box', root);
  return sb && getComputedStyle(sb).overflowY === 'auto' ? sb : qs('.stack-papers', root);
}

/** MER-138 (play a052, b011, b017): the headline of a raised paper is whole in its box after any scroll the desk made to bring a choice into
    view (the headline wins where both cannot show, MER-122). */
export function keepHeadline(sheet, gap = 6) {
  const title = qs('.sheet-title', sheet), box = sheet.closest('.sheet-box, .stack-papers');
  if (!title || !box) return;
  if (getComputedStyle(box).overflowY !== 'auto') return;   // the phones scroll the page: desk.js's revealOnPage and the focus code keep the headline under the bar
  const over = box.getBoundingClientRect().top + gap - title.getBoundingClientRect().top;
  if (over > 0) box.scrollTop = Math.max(0, box.scrollTop - over);
}

/** MER-138: the tabs lie above the paper's box and no longer cover it, so this is 0 unless a stylesheet sticks them again. Kept so the one caller reads true. */
export function stuckHeight(box) {
  const tabs = box && qs('.edges', box);
  if (!tabs || getComputedStyle(tabs).position !== 'sticky' || !tabs.checkVisibility?.()) return 0;
  return tabs.getBoundingClientRect().height + (parseFloat(getComputedStyle(box).rowGap) || 0);
}

/** An account cell's words with each figure and its unit ("340 dinars", "4 loads") in one nowrap span, so a long sentence breaks between
    words and never between a number and what it counts (MER-142: "340 / dinars" at the phone's width). The text is the same text. */
const keepUnits = text => String(text ?? '').split(/(\d[\d,]* (?:loads?|dinars?)(?![a-z]))/).map((part, i) => (i % 2 ? h('span', { class: 'nb' }, part) : part));
/** MER-145 (M4e play a063, a031, b025: "spend-646 dinars", "now)+877 dinars"): a row's cells are read one after another by a screen reader and by textContent, so a
    space ends every cell but the last and a figure never runs into the words before it. It collapses on screen. */
const row = (k, v) => h('tr', null, h('th', { scope: 'row' }, k, ' '), h('td', null, keepUnits(v)));
/** The words of an account row for a return. A sum row (an `amount`, no `detail`) shows its total in the last column, so the engine's
    closing ", 527 dinars in all" is dropped from the words (MER-132, play: "Back home / 527 dinars, 527 dinars in all / +527 dinars" said
    the figure three times). What is left is what came home; a row of money alone, whose words would be the figure again, says so in words. */
export function accountText(r) {
  const text = String(r.text ?? '');
  if (!Number.isFinite(r.amount) || r.detail) return text;
  const m = /^(.*), (\S+ \S+) in all$/.exec(text);
  if (!m) return text;
  return m[1] === m[2] ? 'All of it in money' : m[1];
}

/** An account row for a return: label, words, and the signed dinars when the row is one of the sums. The one sign is this file's: the
    engine's words carry none in front of a figure the column shows (a loss is U+2212, never a hyphen, and never twice). */
const sumRow = r => {
  const sum = Number.isFinite(r.amount) && !r.detail;
  return h('tr', { class: sum ? 'sum' : null }, h('th', { scope: 'row' }, r.label, ' '), h('td', { colspan: sum ? null : 2 }, keepUnits(accountText(r)), sum ? ' ' : null),
    sum ? h('td', { class: 'amount' }, `${r.amount > 0 ? '+' : r.amount < 0 ? SIGN_MINUS : ''}${dinars(Math.abs(r.amount))}`) : null);
};

/** The engine's own papers (DESIGN 4.6, 2): a return, a loss, price letters and the folded
    Accounts paper. Each is read and set aside with one press. `open` says whether a return's
    account starts unfolded. MER-122: it never does now. An open account made the paper taller than the stack, the desk scrolled
    the stack down to the choice, and the headline sat above the top (play a062, b070: focused headline at y=-292). The account is
    one press away, and the ledger keeps every trip's account. `open` is still passed by the desk and no longer read. */
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
      // a return's rows that are sums (an `amount`, no `detail`) show it in a last column, so what a child reads adds up to the
      // Profit row to the dinar (MER-119); the road's detail rows say what happened, and their money is inside the next sum
      const table = h('table', { class: 'accounts-table' }, h('tbody', null, rows.map(r => paper.kind === 'return' ? sumRow(r) : row(r.label, r.text))));
      body.push(paper.kind === 'return'
        ? h('details', { class: 'account' }, h('summary', null, 'Show the account'), table)
        : table);
    }
    // DESIGN 2.1 rules 3 and 4: the paper ends by asking, when returns.json has an entry for the trip
    const choices = choicesOf(app, paper);
    if (choices.some(c => c.id !== 'ok')) {
      asking = true;
      const asked = askTitle(content, paper);
      const askId = `paper-${paper.id}-ask`;
      body.push(h('div', { class: 'ask', id: askId },
        asked ? h('h3', { class: 'ask-title' }, asked) : null,
        d.ask?.body ? h('p', { class: 'sheet-body' }, d.ask.body) : null),
      choiceList(choices, { titleId: asked ? askId : titleId, paper, onChoose, locked }));
    }
  } else if (paper.kind === 'news') {
    if (paper.line) body.push(h('p', { class: 'sheet-body' }, paper.line));
    else for (const l of paper.letters ?? []) {
      body.push(h('h3', null, `From ${stopName(content, l.stop)}, written in ${l.writtenIn}`),
        h('table', { class: 'accounts-table' }, h('tbody', null, Object.entries(l.prices).map(([g, p]) =>
          row((content.goods ?? []).find(x => x.id === g)?.name ?? g, `${num(p)} a load`)))));
    }
  } else {
    for (const g of accountGroups(paper.items ?? [], content)) {
      body.push(h('section', { class: 'account-group', dataset: { from: g.from ?? '' } },
        h('h3', { class: 'cause' }, g.cause),
        ...g.items.map(i => h('p', { class: 'account-item' }, cap(i.changes ? accountLine(i.changes) : i.text)))));
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
  const sheet = h('article', { class: `paper sheet front kind-${paper.kind}`, dataset: { paper: paper.id, kind: paper.kind, face: 'front' }, 'aria-labelledby': titleId, onkeydown: onKey },
    head(app, senderOf(content, paper)),
    slot,
    h('h2', { class: 'sheet-title', id: titleId, tabindex: '-1' }, returnHeadline(content, paper)),
    paper.kind === 'return' && returnLead(content, paper) ? h('p', { class: 'return-lead' }, returnLead(content, paper)) : null,
    ...body,
    asking ? null : h('button', { class: 'button next', type: 'button', id: 'btn-next', onclick: onDone }, paper.kind === 'return' ? 'Into the ledger' : 'Noted'));
  // MER-122: the desk scrolls a raised paper's stack down to its first choice (revealChoice), and on a short frame that leaves the headline
  // above the top (play a062, b070: y=-292). A record opens on its headline, whatever else is cut: this runs after the desk's own pass and
  // again when the sheet's rise ends, which is the desk's second pass.
  const headline = () => keepHeadline(sheet);
  queueMicrotask(() => {
    if (!sheet.isConnected) return;
    headline();
    sheet.addEventListener('animationend', headline, { once: true });
  });
  return sheet;
}

/** The edge of a paper lower in the stack: seal and title, pressed to raise it. */
export function edge(app, paper, { onRaise, tilt }) {
  return h('button', { class: 'edge', type: 'button', style: `--tilt:${tilt}deg`, dataset: { paper: paper.id }, onclick: onRaise,
    'aria-label': `Raise: ${paperTitle(app.content, paper, app.view().cards)}` },
  seal(app, senderOf(app.content, paper)?.seal), h('span', null, paperTitle(app.content, paper, app.view().cards)));
}
