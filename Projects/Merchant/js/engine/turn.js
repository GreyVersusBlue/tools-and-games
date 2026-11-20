// The season (ARCHITECTURE 4.1). Public functions take a state and the content and
// return a new state; they work on a structuredClone and never touch their input.
//
// Order of a season, called through `steps` so a test can watch it and a later unit
// can replace a stub:
//   open:  returns, letters, news, events, drawCards
//   close: move, risk, tolls, drift, fireDue, advance, (jump), end, then open
// Expeditions and the jump are routes.js, letters from the road letters.js, markets market.js.
import { playedSeasons, seasonIndex, seasonName, year, actOf, actPosition, isLastSeason } from './calendar.js';
import { holds, describeTrips } from './conditions.js';
import { apply, applyAll, check } from './effects.js';
import { find, addPaper, deskFull, cityOf, MAX_PAPERS } from './state.js';
import { weighted } from './rng.js';
import * as market from './market.js';
import * as routes from './routes.js';
import * as letters from './letters.js';
import * as agents from './agents.js';

export { MAX_PAPERS };
export const RECENT = 6; // a card is not drawn again within this many seasons

export const steps = {
  // opening a season
  agents(s, content) { agents.opening(s, content); },
  settle(s) { agents.settle(s); },
  returns(s, content) { routes.returns(s, content); },
  letters(s, content) { letters.letters(s, content); },
  news(s, content) {
    // city.json's priceNews (default true) turns price letters off for a city
    if (content.city?.priceNews === false) return;
    market.news(s, content);
  },
  events(s, content) {
    const idx = seasonIndex(s, content);
    for (const ev of content.events ?? []) {
      // an event with `between` belongs to the gap between acts: the jump fires it, never its season
      if (ev.at !== idx || s.seen[`event:${ev.id}`] || (ev.between && s.length === 'acts')) continue;
      s.seen[`event:${ev.id}`] = 1;
      applyAll(s, content, ev.do);
      const shown = !ev.notice || addPaper(s, { kind: 'notice', ref: ev.id });
      // A notice with no room on a full desk is not shown; the event's effects stand (MER-07).
      s.log.push({ at: idx, kind: 'event', ref: ev.id, ...(shown ? {} : { dropped: 'notice' }) });
    }
  },
  drawCards(s, content) { drawCards(s, content); },
  // closing a season
  move(s, content) { routes.move(s, content); },
  risk(s, content) { routes.risk(s, content); },
  tolls(s, content) { routes.tolls(s, content); },
  drift(s, content) { market.drift(s, content); },
  fireDue(s, content) { fireDue(s, content); },
  advance(s, content) {
    const moved = s.t + 1 < playedSeasons(content.calendar, s.length).length;
    if (moved) s.t += 1;
    return moved;
  },
  jump(s, content) { routes.jump(s, content); },
  end(s, content, moved) { if (!moved) s.phase = 'recall'; },
};

const clone = s => structuredClone(s);

function cardsOnDesk(s) { return s.desk.filter(p => p.kind === 'card'); }

function cardTarget(s, content) {
  const city = cityOf(content, 'drawing cards');
  if (s.t === 1 && city.secondSeason?.cards !== undefined) return city.secondSeason.cards;
  const { i, of } = actPosition(s, content);
  return s.expeditions.length >= 3 || i + 1 > of / 2 ? 3 : 2;
}

function drawCards(s, content) {
  const idx = seasonIndex(s, content);
  const city = cityOf(content, 'drawing cards');
  const put = ref => {
    if (!addPaper(s, { kind: 'card', ref })) return false;
    s.seen[ref] = (s.seen[ref] ?? 0) + 1;
    return true;
  };

  if (s.t === 0) {
    const opening = city.opening?.[s.house] ?? [];
    if (deskFull(s, opening.length)) throw new Error(`opening for "${s.house}" is more than ${MAX_PAPERS} papers`);
    for (const id of opening) { find(content.cards, id, 'card'); put(id); }
  }
  for (let want = cardTarget(s, content) - cardsOnDesk(s).length; want > 0; want--) {
    const groups = new Set(cardsOnDesk(s).map(p => find(content.cards, p.ref, 'card').group));
    const recent = new Set(s.log.filter(e => e.kind === 'card' && idx - e.at < RECENT).map(e => e.ref));
    const onDesk = new Set(s.desk.map(p => p.ref));
    const pool = (content.cards ?? []).filter(c =>
      c.group !== 'followups' && c.weight !== 0 &&
      !onDesk.has(c.id) && !groups.has(c.group) && !recent.has(c.id) &&
      !(c.repeat === false && s.seen[c.id]) &&
      holds(c.when, s, content));
    if (!pool.length || deskFull(s)) break; // no draw is spent on a paper that has no room
    put(weighted(s, pool).id);
  }
}

function numberPapers(s) {
  s.desk.forEach((p, i) => { p.id = `p${s.t}-${i}`; });
}

function open(s, content) {
  steps.agents(s, content);
  steps.returns(s, content);
  steps.letters(s, content);
  steps.news(s, content);
  steps.events(s, content);
  steps.drawCards(s, content);
  numberPapers(s);
}

/** Papers a queue item will put on the desk when it fires: its card and any {card} in its do. */
const slotsOf = q => (q.card ? 1 : 0) + (q.do ?? []).filter(e => e && typeof e === 'object' && 'card' in e).length;

/** Fires one queue item on `s`: every effect with "now" equal to the item's own season
    (`at`) and the context of the paper that queued it. */
function fireOne(s, content, q) {
  const ctx = { later: true, at: q.at, from: q.from, ...(q.agent ? { agent: q.agent } : {}), ...(q.expedition ? { expedition: q.expedition } : {}) };
  applyAll(s, content, q.do, ctx);
  if (q.card) apply(s, content, { card: q.card }, ctx);
}

/** Queue items due by the next played season fire in order of `at`. An item due in a gap
    between acts (ARCHITECTURE 4.7) fires with the first item of the next played season, at
    the end of the last season before the gap, with its own `at`: the jump does not settle it.
    A follow-up that would put a sixth paper on the desk waits a season, effects and all, and
    keeps its `from`. An item that throws is logged as dropped and never fires again; its
    effects up to the throw are undone. */
function fireDue(s, content) {
  const played = playedSeasons(content.calendar, s.length);
  const upTo = played[Math.min(s.t + 1, played.length - 1)];
  const due = s.queue.filter(q => q.at <= upTo).sort((a, b) => a.at - b.at);
  const held = [], accounts = [];
  for (const q of due) {
    if (slotsOf(q) && deskFull(s, slotsOf(q))) { held.push(q); continue; }
    const trial = structuredClone(s);
    try {
      fireOne(trial, content, q);
      // a later effect with no follow-up card is recorded for the one folded Accounts paper
      const item = slotsOf(q) ? null : routes.accountItem(trial, content, q);
      Object.assign(s, trial);
      if (item) accounts.push(item);
    } catch (e) {
      s.log.push({ at: seasonIndex(s, content), kind: 'dropped', ref: q.from ?? q.card ?? null, reason: e.message });
    }
  }
  s.queue = [...s.queue.filter(q => q.at > upTo), ...held];
  routes.foldAccounts(s, content, accounts);
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

/** Papers that tell the player something and are answered with "ok": no card behind them. */
const INFO = { notice: 'Noted', news: 'Noted', return: 'Into the ledger', lost: 'Noted', accounts: 'Noted' };

/** The card or letter a paper was drawn from. */
const definition = (content, p) => find(p.kind === 'letter' ? content.letters : content.cards, p.ref, p.kind === 'letter' ? 'letter' : 'card');

export function paperChoices(state, content, paperId) {
  const p = state.desk.find(x => x.id === paperId);
  if (!p) throw new Error(`no paper "${paperId}" on the desk`);
  if (p.kind in INFO) return [{ id: 'ok', label: INFO[p.kind] }];
  return structuredClone(definition(content, p).choices ?? []);
}

export function choose(state, content, paperId, choiceId) {
  if (state.phase !== 'desk') throw new Error(`choose: nothing to answer in phase ${state.phase}`);
  const s = clone(state);
  const paper = s.desk.find(p => p.id === paperId);
  if (!paper) throw new Error(`choose: no paper "${paperId}" on the desk`);
  if (paper.state !== 'open') throw new Error(`choose: paper "${paperId}" is already answered`);
  const idx = seasonIndex(s, content);

  if (paper.kind in INFO) {
    if (choiceId !== 'ok') throw new Error(`choose: a notice is answered with "ok"`);
  } else {
    const card = definition(content, paper);
    const choice = (card.choices ?? []).find(c => c.id === choiceId);
    if (!choice) throw new Error(`choose: card "${card.id}" has no choice "${choiceId}"`);
    if (!holds(choice.requires, s, content)) throw new Error(`choose: "${choice.label}" is not available`);
    const ctx = { agent: paper.agent, expedition: paper.expedition };
    const refuse = e => new Error(`choose: "${choice.label}" on card "${card.id}" is refused: ${e.message}`);
    const later = choice.later ?? [];
    const now = paper.kind === 'letter' ? letters.reachable(s, paper, choice.now) : choice.now;
    // Every reference in `later` is checked now, on a scratch copy, so a bad card id, good,
    // stop or agent refuses the choice here and never throws when the item fires.
    const trial = clone(s);
    try {
      applyAll(trial, content, now, ctx);
      for (const l of later) {
        if (!Number.isInteger(l.in) || l.in < 1) throw new Error(`later.in must be a whole number above 0`);
        const item = { do: l.do ?? [], ...(l.card ? { card: l.card } : {}) };
        if (l.card) find(content.cards, l.card, 'card');
        if (slotsOf(item) > MAX_PAPERS) throw new Error(`a later effect that puts more than ${MAX_PAPERS} papers on the desk can never fire`);
        for (const e of item.do) check(e);
        applyAll(trial, content, item.do, { ...ctx, later: true, dry: true });
      }
    } catch (e) { throw refuse(e); }
    applyAll(s, content, now, ctx);
    if (paper.kind === 'letter') letters.stamp(s, paper, idx);
    for (const l of later) {
      s.queue.push({
        at: idx + l.in, do: structuredClone(l.do ?? []), ...(l.card ? { card: l.card } : {}),
        from: `${card.id}/${choice.id}`,
        ...(paper.agent ? { agent: paper.agent } : {}), ...(paper.expedition ? { expedition: paper.expedition } : {}),
      });
    }
    for (const e of card.unlocks ?? []) if (!s.notebook.includes(e)) s.notebook.push(e);
  }
  paper.state = 'done';
  paper.choice = choiceId;
  s.done.push({ id: paper.id, ref: paper.ref, choice: choiceId });
  s.log.push({ at: idx, kind: paper.kind in INFO ? 'event' : 'card', ref: paper.ref, choice: choiceId });
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
  const moneyAtClose = s.money;
  s.desk = [];
  s.done = [];
  steps.move(s, content);
  steps.risk(s, content);
  steps.tolls(s, content);
  steps.drift(s, content);
  steps.fireDue(s, content);
  steps.settle(s);
  const closing = seasonIndex(s, content), first = s.t === 0;
  const moved = steps.advance(s, content);
  if (moved && seasonIndex(s, content) - closing > 1) steps.jump(s, content);
  logSeason(s, content, moneyAtClose, closing, first); // after the jump, so its money is in the season it happened
  steps.end(s, content, moved);
  if (s.phase === 'desk') open(s, content);
  return s;
}

/** One `{ at, kind: 'season', change, money }` entry per closed season, for the ledger. `change`
    is the net dinars from the end of the season before to the end of this one (the opening's
    returns, the answers at the desk and the closing steps all count), `money` what the house had
    then, which is where the next season's change starts. The first season starts from its
    house's money; a save from before this entry reads its first change from the money it was
    holding when the season closed. */
function logSeason(s, content, moneyAtClose, at, firstSeason) {
  const last = [...s.log].reverse().find(e => e.kind === 'season' && Number.isInteger(e.money));
  const start = (content.houses ?? []).find(h => h.id === s.house)?.money ?? 0;
  const from = last ? last.money : (firstSeason ? start : moneyAtClose);
  s.log.push({ at, kind: 'season', change: s.money - from, money: s.money });
}

/** The ending's last choice (ARCHITECTURE 4.9): routes.js rolls each expedition and each agent at home. */
export function recall(state, content, decisions = {}) {
  if (state.phase !== 'recall') throw new Error(`recall: the game is not at its end (phase ${state.phase})`);
  const s = clone(state);
  routes.recall(s, content, decisions);
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
    prices: market.knownPrices(state, content),
    letters: letters.describe(state, content),
    cards: describeTrips(state, content),   // filled words of the cards that tell of a trip, by paper id
    ...agents.standing(state, content),
    interlude: state.phase === 'interlude' ? routes.interludeOf(state, content) : null,
  };
}
