// The season (ARCHITECTURE 4.1). Public functions take a state and the content and
// return a new state; they work on a structuredClone and never touch their input.
//
// Order of a season, called through `steps` so a test can watch it and a later unit
// can replace a stub:
//   open:  returns, letters, news, events, drawCards
//   close: move, risk, tolls, drift, fireDue, advance, (jump), end, then open
// Expeditions and the jump are routes.js, letters from the road letters.js, markets market.js.
import { playedSeasons, seasonIndex, seasonName, year, actOf, actPosition, isLastSeason } from './calendar.js';
import { holds, describeTrips, tripLeaf } from './conditions.js';
import { apply, applyAll, check } from './effects.js';
import { find, addPaper, deskFull, cityOf, MAX_PAPERS } from './state.js';
import { weighted } from './rng.js';
import * as market from './market.js';
import * as routes from './routes.js';
import * as letters from './letters.js';
import * as agents from './agents.js';
import { score } from './score.js';

export { MAX_PAPERS };
export const RECENT = 6; // a card is not drawn again within this many seasons
/** Pool cards a season may draw while the house has a trip out or home (DESIGN 2.1 rule 1). */
export const POOL_WITH_TRIP = 2;

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

/** The agents a card can dismiss (a choice whose `now` has a `dismiss`), and the agent a card's trip leaf binds it to. */
const dismisses = c => new Set((c.choices ?? []).flatMap(ch => (ch.now ?? []).filter(e => e && typeof e === 'object' && 'dismiss' in e).map(e => e.dismiss)));
const boundTo = c => tripLeaf(c.when)?.agent ?? null;
/** Two cards on one desk that cannot both be answered: one dismisses the agent whose trip the other tells of, so whichever is answered
    second has every choice refused ("is not free to be sent out") and the season cannot end. The draw never deals the pair. */
const clash = (a, b) => (boundTo(a) !== null && dismisses(b).has(boundTo(a))) || (boundTo(b) !== null && dismisses(a).has(boundTo(b)));

/** A trip is live this season: an expedition is on the road, or a return or loss paper is on the desk. */
const tripLive = s => s.expeditions.length > 0 || s.desk.some(p => p.kind === 'return' || p.kind === 'lost');

/** The date leaves of a `when` (`year`, `season`) at season `idx`; every other leaf counts as true, so a card is never read as closed
    because of the house's money or notebook. */
function datesHold(when, idx, content) {
  if (!when || typeof when !== 'object') return true;
  if (when.all) return when.all.every(x => datesHold(x, idx, content));
  if (when.any) return when.any.some(x => datesHold(x, idx, content));
  if (when.year) { const y = year(content.calendar, idx); return y >= when.year[0] && y <= when.year[1]; }
  if (when.season) return when.season.includes(seasonName(idx));
  return true;
}
/** A card's dates end with this season: its dates hold now, name a year or a season, and hold in no later season of the game
    (MER-128). A card dated to one season (a king passing through in summer 1324) is dealt in that season or never. */
function datesClose(c, idx, s, content) {
  const dated = JSON.stringify(c.when ?? {});
  if (!/"(year|season)"/.test(dated) || !datesHold(c.when, idx, content)) return false;
  const later = playedSeasons(content.calendar, s.length).filter(i => i > idx);
  return later.length > 0 && !later.some(i => datesHold(c.when, i, content));
}

/** Draws the season's cards (DESIGN 2.1). The papers of the house's own trips are already on the desk (returns, losses,
    letters). From the pool: a card that tells of a trip (a `trip` leaf) is drawn before any other; at most POOL_WITH_TRIP pool
    cards while a trip is live; at most one `favour` card on the desk, a follow-up's included; no two pool cards of one
    kind; no card beside one that it clashes with (above); and no card with no choice open now (`anyOpen`). A draw that no card fits is not spent: the desk holds fewer cards.
    One more slot is dealt first to a card whose dates end this season (`datesClose`, MER-128): it fits the same rules, and the season's own target is unchanged, so the card cannot lose its only season to the other cards. */
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
  const live = tripLive(s), kindsDrawn = new Set();
  // the cards the draw could deal now under every rule of the head, from the desk as it stands
  const poolNow = () => {
    const groups = new Set(cardsOnDesk(s).map(p => find(content.cards, p.ref, 'card').group));
    const favours = cardsOnDesk(s).filter(p => find(content.cards, p.ref, 'card').kind === 'favour').length;
    const recent = new Set(s.log.filter(e => e.kind === 'card' && idx - e.at < RECENT).map(e => e.ref));
    const onDesk = new Set(s.desk.map(p => p.ref));
    const beside = cardsOnDesk(s).map(p => find(content.cards, p.ref, 'card'));
    return (content.cards ?? []).filter(c =>
      c.group !== 'followups' && c.weight !== 0 &&
      !onDesk.has(c.id) && !groups.has(c.group) && !recent.has(c.id) &&
      !(c.repeat === false && s.seen[c.id]) &&
      !(c.kind === 'favour' && favours >= 1) && !(c.kind && kindsDrawn.has(c.kind)) && !beside.some(d => clash(c, d)) &&
      holds(c.when, s, content));
  };
  let drawn = 0, extra = 0;
  if (!deskFull(s)) {
    const closing = poolNow().filter(c => datesClose(c, idx, s, content));
    const sure = closing.find(c => anyOpen(s, content, { kind: 'card' }, c.choices ?? []));
    if (sure && put(sure.id)) { drawn++; extra = 1; if (sure.kind) kindsDrawn.add(sure.kind); }
  }
  for (let want = cardTarget(s, content) + extra - cardsOnDesk(s).length; want > 0; want--) {
    if (live && drawn >= POOL_WITH_TRIP) break;
    const pool = poolNow();
    if (!pool.length || deskFull(s)) break; // no draw is spent on a paper that has no room
    // A card with no choice open now is never dealt. The check runs on the card the draw lands on (it clones the state),
    // and a closed one leaves the pool and the draw goes again, so a pool with none closed draws exactly as it did.
    let card = null;
    while (pool.length && !card) {
      const trips = pool.filter(c => tripLeaf(c.when));
      const pick = weighted(s, trips.length ? trips : pool);
      if (anyOpen(s, content, { kind: 'card' }, pick.choices ?? [])) card = pick;
      else pool.splice(pool.indexOf(pick), 1);
    }
    if (!card || !put(card.id)) break;
    drawn++;
    if (card.kind) kindsDrawn.add(card.kind);
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

/** Papers the rest of this closing is bound to put on the desk, which a follow-up card must leave room for (MER-134, play problem 10:
    in two of 60 played games a return paper was "dropped, the desk was full" at the act jump while three follow-up cards sat on the
    desk, so the money and goods of that trip came home with no paper): one for each trip that comes home at the next opening, or,
    when the act jump comes, for each trip it settles; and one for the folded Accounts paper when a due item has a line for it. */
function reserve(s, content, due) {
  const played = playedSeasons(content.calendar, s.length), here = seasonIndex(s, content), next = played[s.t + 1];
  const jump = next !== undefined && next - here > 1;
  const trips = jump ? s.expeditions.length : s.expeditions.filter(x => x.status === 'home').length;
  const lines = due.some(q => !slotsOf(q) && routes.accountItem(s, content, q));
  return trips + (lines ? 1 : 0);
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
  const room = reserve(s, content, due);
  for (const q of due) {
    if (slotsOf(q) && deskFull(s, slotsOf(q) + room)) { held.push(q); continue; }
    const trial = structuredClone(s);
    try {
      fireOne(trial, content, q);
      // a later effect with no follow-up card is recorded for the one folded Accounts paper
      const item = slotsOf(q) ? null : letters.trueMinus(routes.accountItem(trial, content, q));
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

/** The engine's own way out of a card that has no choice left to make (a choice is closed by what it asks, see `isOpen`). */
export const LEAVE = { id: 'leave', label: 'Leave it' };

/** The choices a paper offers from its own data: a return or a loss paper carries them in `data.choices` (routes.js,
    drawn from returns.json), a card or a letter's are in its definition. */
const listOf = (content, p) => (p.kind === 'return' || p.kind === 'lost' ? p.data?.choices : p.kind in INFO ? [] : definition(content, p).choices) ?? [];

/** The effects of a choice as `choose` applies them. A letter's go through the road it was written on. */
const nowOf = (s, p, choice) => (p.kind === 'letter' ? letters.reachable(s, p, choice.now) : choice.now);

/** A choice is open when its `requires` holds and its `now` applies on a copy of the state without being refused
    (an outfit for an agent who cannot be sent, a card or good that does not exist). `choose` refuses exactly what this
    reports closed, so a screen can offer what is open and the season cannot be left with nothing to answer. */
function isOpen(s, content, p, choice) {
  if (!holds(choice.requires, s, content)) return false;
  // on the copy throughout: letters.reachable logs a dropped order on the state it is given
  const trial = clone(s);
  try { applyAll(trial, content, nowOf(trial, p, choice), { agent: p.agent, expedition: p.expedition }); return true; }
  catch { return false; }
}
const anyOpen = (s, content, p, list) => list.some(c => isOpen(s, content, p, c));

export function paperChoices(state, content, paperId) {
  const p = state.desk.find(x => x.id === paperId);
  if (!p) throw new Error(`no paper "${paperId}" on the desk`);
  const note = p.kind in INFO ? { id: 'ok', label: INFO[p.kind] } : null;
  const list = structuredClone(listOf(content, p));
  // a return or loss paper with no entry behind it is answered "ok", and so is one whose every choice has closed
  if (note) return list.length && anyOpen(state, content, p, list) ? list : [...list, note];
  return list.length && anyOpen(state, content, p, list) ? list : [...list, { ...LEAVE }];
}

export function choose(state, content, paperId, choiceId) {
  if (state.phase !== 'desk') throw new Error(`choose: nothing to answer in phase ${state.phase}`);
  const s = clone(state);
  const paper = s.desk.find(p => p.id === paperId);
  if (!paper) throw new Error(`choose: no paper "${paperId}" on the desk`);
  if (paper.state !== 'open') throw new Error(`choose: paper "${paperId}" is already answered`);
  const idx = seasonIndex(s, content);

  const info = paper.kind in INFO, list = listOf(content, paper);
  // "ok" answers any notice, and a return or loss paper whether or not it offers choices (a screen that does not show them yet)
  if (info && choiceId === 'ok') { /* nothing to apply */ }
  else if (!info && choiceId === LEAVE.id) {
    if (anyOpen(s, content, paper, list)) throw new Error(`choose: card "${paper.ref}" still has a choice that is open`);
  } else if (info && !list.length) throw new Error(`choose: a notice is answered with "ok"`);
  else {
    const card = info ? { id: paper.ref } : definition(content, paper);
    const choice = list.find(c => c.id === choiceId);
    if (!choice) throw new Error(`choose: card "${card.id}" has no choice "${choiceId}"`);
    // what a later effect of this choice is called when it fires: the card (or letter, or the return or loss entry) and the
    // choice, in the words the player saw (MER-88), so the Accounts paper can name the choice that set it
    // A card that tells of a trip is filled by `describeTrips`, the code view().cards uses, so the record holds the words the player saw
    // and not '{agent} is home' (MER-109). A return or loss paper's ask and choices are filled already.
    const seen = paper.kind === 'card' ? describeTrips(s, content)[paper.id] : null;
    const via = { from: `${paper.kind === 'return' || paper.kind === 'lost' ? (paper.data?.entry ?? paper.ref) : card.id}/${choice.id}`, card: (paper.kind === 'return' || paper.kind === 'lost' ? paper.data?.ask?.title : (seen?.title ?? card.title)) ?? null, choice: (seen?.choices[choice.id]?.label ?? choice.label) ?? null };
    if (!holds(choice.requires, s, content)) throw new Error(`choose: "${choice.label}" is not available`);
    const ctx = { agent: paper.agent, expedition: paper.expedition };
    const refuse = e => new Error(`choose: "${choice.label}" on card "${card.id}" is refused: ${e.message}`);
    const later = choice.later ?? [];
    const now = nowOf(s, paper, choice);
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
    if (paper.kind === 'return' && choiceId === 'bonus' && paper.agent) s.flags[`${paper.agent}-bonused`] = idx;   // one bonus for one trip (letters.js fitOffers)
    if (paper.kind === 'letter') letters.stamp(s, paper, idx);
    for (const l of later) {
      s.queue.push({
        at: idx + l.in, do: structuredClone(l.do ?? []), ...(l.card ? { card: l.card } : {}),
        from: via.from, ...(via.card ? { viaCard: via.card } : {}), ...(via.choice ? { viaChoice: via.choice } : {}),
        ...(paper.agent ? { agent: paper.agent } : {}), ...(paper.expedition ? { expedition: paper.expedition } : {}),
      });
    }
    for (const e of card.unlocks ?? []) if (!s.notebook.includes(e)) s.notebook.push(e);
  }
  paper.state = 'done';
  paper.choice = choiceId;
  s.done.push({ id: paper.id, ref: paper.ref, choice: choiceId });
  s.log.push({ at: idx, kind: info ? 'event' : 'card', ref: paper.ref, choice: choiceId });
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
  s.score = score(s, content);
  return s;
}

/** The player opens a page of the notebook (DESIGN 2.2 rule 6). Adds the id to `notebookRead` once;
    an entry not yet found, an unknown id, or one already read changes nothing. No phase gate: the book opens any time. */
export function readEntry(state, content, id) {
  if (!state.notebook.includes(id) || (state.notebookRead ?? []).includes(id)) return state;
  const s = clone(state);
  s.notebookRead = [...(s.notebookRead ?? []), id];
  return s;
}

/** Values the screens need so they never compute a rule (ARCHITECTURE 2.1). */
export function view(state, content) {
  const idx = seasonIndex(state, content);
  const bestTrades = routes.bestTrades(state, content);
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
    homeBy: routes.homeBy(state, content),   // by expedition id: { in, season }, the one answer the map, the ledger and the outfit give (MER-88)
    bestTrades,   // the three widest margins the house has news of: road, news age and risk, in words (DESIGN 2.2 rule 3)
    venture: routes.draftVenture(state, content),   // the outfit sheet's default draft and its estimate (DESIGN 2.2 rules 1 and 2), or null
    cards: describeTrips(state, content),   // filled words of the cards that tell of a trip, by paper id
    ...agents.standing(state, content),
    interlude: state.phase === 'interlude' ? routes.interludeOf(state, content) : null,
  };
}
