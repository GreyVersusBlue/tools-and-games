// The season (ARCHITECTURE 4.1). Public functions take a state and the content and
// return a new state; they work on a structuredClone and never touch their input.
//
// Order of a season, called through `steps` so a test can watch it and a later unit
// can replace a stub:
//   open:  returns, letters, news, events, drawCards
//   close: move, risk, tolls, drift, fireDue, advance, (jump), end, then open
// returns, letters, news, move, risk, tolls, drift and jump are stubs here. Expeditions
// (routes.js), markets (market.js) and letters (agents.js) fill them in later units.
import { playedSeasons, seasonIndex, seasonName, year, actOf, actPosition, isLastSeason } from './calendar.js';
import { holds } from './conditions.js';
import { apply, applyAll, check } from './effects.js';
import { find } from './state.js';
import { weighted } from './rng.js';

export const MAX_PAPERS = 5;
export const RECENT = 6; // a card is not drawn again within this many seasons

const noop = () => {};

export const steps = {
  // opening a season
  returns: noop,
  letters: noop,
  news: noop,
  events(s, content) {
    const idx = seasonIndex(s, content);
    for (const ev of content.events ?? []) {
      if (ev.at !== idx || s.seen[`event:${ev.id}`]) continue;
      s.seen[`event:${ev.id}`] = 1;
      applyAll(s, content, ev.do);
      s.log.push({ at: idx, kind: 'event', ref: ev.id });
      if (ev.notice) s.desk.push({ id: null, kind: 'notice', ref: ev.id, state: 'open' });
    }
  },
  drawCards(s, content) { drawCards(s, content); },
  // closing a season
  move: noop,
  risk: noop,
  tolls: noop,
  drift: noop,
  fireDue(s, content) { fireDue(s, content); },
  advance(s, content) {
    const moved = s.t + 1 < playedSeasons(content.calendar, s.length).length;
    if (moved) s.t += 1;
    return moved;
  },
  jump(s) { s.phase = 'interlude'; },
  end(s, content, moved) { if (!moved) s.phase = 'recall'; },
};

const clone = s => structuredClone(s);

function cardsOnDesk(s) { return s.desk.filter(p => p.kind === 'card'); }

function cardTarget(s, content) {
  if (s.t === 1 && content.city.secondSeason?.cards !== undefined) return content.city.secondSeason.cards;
  const { i, of } = actPosition(s, content);
  return s.expeditions.length >= 3 || i + 1 > of / 2 ? 3 : 2;
}

function drawCards(s, content) {
  const idx = seasonIndex(s, content);
  const put = ref => { s.desk.push({ id: null, kind: 'card', ref, state: 'open' }); s.seen[ref] = (s.seen[ref] ?? 0) + 1; };

  if (s.t === 0) {
    const opening = content.city.opening?.[s.house] ?? [];
    if (s.desk.length + opening.length > MAX_PAPERS) throw new Error(`opening for "${s.house}" is more than ${MAX_PAPERS} papers`);
    for (const id of opening) { find(content.cards, id, 'card'); put(id); }
  }
  for (let want = cardTarget(s, content) - cardsOnDesk(s).length; want > 0 && s.desk.length < MAX_PAPERS; want--) {
    const groups = new Set(cardsOnDesk(s).map(p => find(content.cards, p.ref, 'card').group));
    const recent = new Set(s.log.filter(e => e.kind === 'card' && idx - e.at < RECENT).map(e => e.ref));
    const onDesk = new Set(s.desk.map(p => p.ref));
    const pool = (content.cards ?? []).filter(c =>
      c.group !== 'followups' && c.weight !== 0 &&
      !onDesk.has(c.id) && !groups.has(c.group) && !recent.has(c.id) &&
      !(c.repeat === false && s.seen[c.id]) &&
      holds(c.when, s, content));
    if (!pool.length) break;
    put(weighted(s, pool).id);
  }
}

function numberPapers(s) {
  s.desk.forEach((p, i) => { p.id = `p${s.t}-${i}`; });
}

function open(s, content) {
  steps.returns(s, content);
  steps.letters(s, content);
  steps.news(s, content);
  steps.events(s, content);
  steps.drawCards(s, content);
  numberPapers(s);
}

function fireDue(s, content) {
  const played = playedSeasons(content.calendar, s.length);
  const upTo = played[Math.min(s.t + 1, played.length - 1)];
  const due = s.queue.filter(q => q.at <= upTo).sort((a, b) => a.at - b.at);
  s.queue = s.queue.filter(q => q.at > upTo);
  for (const q of due) {
    applyAll(s, content, q.do, { later: true });
    if (q.card) {
      apply(s, content, { card: q.card }, { later: true });
      s.flags[`from:${q.card}`] = q.from;
    }
  }
}

export function newGameFrom(state, content) {
  const s = clone(state);
  open(s, content);
  return s;
}

/** Opens the season after an interlude, or the very first one of a fresh state. */
export function openSeason(state, content) {
  const s = clone(state);
  if (s.phase === 'interlude') s.phase = 'desk';
  else if (s.phase !== 'desk' || s.desk.some(p => p.id !== null)) throw new Error(`openSeason: season is already open (phase ${s.phase})`);
  open(s, content);
  return s;
}

export function paperChoices(state, content, paperId) {
  const p = state.desk.find(x => x.id === paperId);
  if (!p) throw new Error(`no paper "${paperId}" on the desk`);
  if (p.kind === 'notice') return [{ id: 'ok', label: 'Noted' }];
  return find(content.cards, p.ref, 'card').choices;
}

export function choose(state, content, paperId, choiceId) {
  if (state.phase !== 'desk') throw new Error(`choose: nothing to answer in phase ${state.phase}`);
  const s = clone(state);
  const paper = s.desk.find(p => p.id === paperId);
  if (!paper) throw new Error(`choose: no paper "${paperId}" on the desk`);
  if (paper.state !== 'open') throw new Error(`choose: paper "${paperId}" is already answered`);
  const idx = seasonIndex(s, content);

  if (paper.kind === 'notice') {
    if (choiceId !== 'ok') throw new Error(`choose: a notice is answered with "ok"`);
  } else {
    const card = find(content.cards, paper.ref, 'card');
    const choice = (card.choices ?? []).find(c => c.id === choiceId);
    if (!choice) throw new Error(`choose: card "${card.id}" has no choice "${choiceId}"`);
    if (!holds(choice.requires, s, content)) throw new Error(`choose: "${choice.label}" is not available`);
    for (const l of choice.later ?? []) {
      if (!Number.isInteger(l.in) || l.in < 1) throw new Error(`choose: later.in must be a whole number above 0 (card "${card.id}")`);
      for (const e of l.do ?? []) check(e);
    }
    const ctx = { agent: paper.agent, expedition: paper.expedition };
    applyAll(s, content, choice.now, ctx);
    for (const l of choice.later ?? []) {
      s.queue.push({ at: idx + l.in, do: l.do ?? [], ...(l.card ? { card: l.card } : {}), from: `${card.id}/${choice.id}` });
    }
    for (const e of card.unlocks ?? []) if (!s.notebook.includes(e)) s.notebook.push(e);
  }
  paper.state = 'done';
  paper.choice = choiceId;
  s.done.push({ id: paper.id, ref: paper.ref, choice: choiceId });
  s.log.push({ at: idx, kind: paper.kind === 'notice' ? 'event' : 'card', ref: paper.ref, choice: choiceId });
  return s;
}

export function canEndSeason(state) {
  if (state.phase !== 'desk') return { ok: false, reason: `the season is not open (${state.phase})` };
  const left = state.desk.filter(p => p.state === 'open').length;
  if (left) return { ok: false, reason: left === 1 ? 'One paper still needs an answer.' : `${left} papers still need an answer.` };
  return { ok: true, reason: null };
}

export function endSeason(state, content) {
  const can = canEndSeason(state);
  if (!can.ok) throw new Error(`endSeason: ${can.reason}`);
  const s = clone(state);
  s.desk = [];
  s.done = [];
  steps.move(s, content);
  steps.risk(s, content);
  steps.tolls(s, content);
  steps.drift(s, content);
  steps.fireDue(s, content);
  const before = seasonIndex(s, content);
  const moved = steps.advance(s, content);
  if (moved && seasonIndex(s, content) - before > 1) steps.jump(s, content);
  steps.end(s, content, moved);
  if (s.phase === 'desk') open(s, content);
  return s;
}

/** The ending's last choice (ARCHITECTURE 4.9). Stub: later units settle the expeditions. */
export function recall(state, content, decisions = {}) {
  if (state.phase !== 'recall') throw new Error(`recall: the game is not at its end (phase ${state.phase})`);
  const s = clone(state);
  s.phase = 'ended';
  return s;
}

/** Values the screens need so they never compute a rule (ARCHITECTURE 2.1). */
export function view(state, content) {
  const idx = seasonIndex(state, content);
  return {
    money: state.money,
    papersLeft: state.desk.filter(p => p.state === 'open').length,
    seasonIndex: idx,
    season: seasonName(idx),
    year: year(content.calendar, idx),
    act: actOf(state, content),
    last: isLastSeason(state, content),
    phase: state.phase,
  };
}
