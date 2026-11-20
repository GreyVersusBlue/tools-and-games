// Letters from the road (ARCHITECTURE 4.2 step 2, 4.4, 5.7; DESIGN 4.5; DECISIONS 2026-11-17 12:10).
//
// Each opening season, every expedition on the road may write one letter, drawn from letters.json
// by `when` and `weight`. A letter belongs to the house's post, `state.post`, not to the
// expedition, so it reaches the desk at its season whatever becomes of the expedition after:
// home, lost, or settled by the act jump. A report's `happened` effects apply as it arrives.
//   post entry: { id, kind, expedition, agent, stop, standing, written, lag, arrive }
// `standing` is true when the agent wrote at a stop and false when riding to it: "at Hilltown" and
// "on the road to Hilltown". `lag` is market.lagOf, the same seasons the price letters take.
//
// An answer to a question becomes an order on its expedition, `x.orders`: { go, letter, at }, `at`
// the season it reaches the agent (the season answered plus the lag). `go` is one of WAIT, ON or
// HOME and the order stands for the rest of the trip: routes.js asks `decide` at every decision
// point, the end of each leg but the last, and a due order wins. Until one is due the agent acts by
// trait at once: careful (or wary) holds at each decision point until the answer arrives, up to
// MAX_HOLD seasons in all; bold goes on; anyone else does the question's default. An order the
// trip ended before it could act on, or that was answered after the trip had ended, is logged as
// dropped.
//
// A letter is written only if it can matter: a report must arrive no later than the season the
// expedition's return is due and before the game's last season; a question only if its answer
// (written + 2 x lag) reaches the agent by the trip's last decision point and before the last
// season of the act it is written in, so a question is never a lie. Which rule a trip the jump
// settles falls under: the jump settles the expedition at the act's end, so an answer that would
// arrive after it reaches no one (a question needs the act's rule), while a report is in the
// post and is delivered at the opening after the jump (4.7, `deliver`), so a report only needs
// the game's rule.
import { seasonIndex, playedSeasons } from './calendar.js';
import { holds, placeOf } from './conditions.js';
import { applyAll } from './effects.js';
import { addPaper, deskFull } from './state.js';
import { chance, weighted } from './rng.js';
import { lagOf, writeSeason } from './market.js';
import { wary, legSeasons } from './agents.js';

/** The chance a letter is written, for an expedition with a letter to write, in a season. */
export const LETTER_CHANCE = 0.5;
/** A trip that has written nothing yet gains this much chance for each opening it could have written at and did not (`x.quiet`),
    up to a sure thing (DESIGN 2.1 rule 5: a long trip brings a letter). Once it has written, the plain chance holds. */
export const SILENT_RAMP = 0.25;
/** The three orders: hold a season at a decision point, go on, turn back toward home. */
export const WAIT = 'wait', ON = 'on', HOME = 'home';
export const GOES = [WAIT, ON, HOME];
/** Seasons in all one trip may be held at decision points, by trait or by a wait order. */
export const MAX_HOLD = 4;

const letterOf = (content, id) => (content.letters ?? []).find(l => l.id === id);
const agentOf = (content, id) => (content.agents ?? []).find(a => a.id === id);
const stopName = (content, id) => (content.stops ?? []).find(s => s.id === id)?.name ?? id;
const routeOf = (content, id) => (content.routes ?? []).find(r => r.id === id);

/** The `go` of a choice's order, or null when the choice gives none. */
const goOf = choice => (choice?.now ?? []).find(e => e && typeof e === 'object' && 'order' in e)?.order?.go ?? null;

/** The `go` a plain agent does while a question is unanswered: its `default` choice's order. */
const defaultOf = (content, id) => {
  const l = letterOf(content, id);
  return l?.kind === 'question' && l.default ? goOf(l.choices.find(c => c.id === l.default)) : null;
};

/** Seasons from the opening of the season being played until the expedition's last ride ends
    (counting the season being played, which an expedition on a leg rides at its closing). */
export function seasonsLeft(content, x) {
  const legs = routeOf(content, x.route).legs, agent = agentOf(content, x.agent);
  let n = x.status === 'out' ? x.left : legSeasons(agent, legs[x.leg]);
  for (let i = x.leg + 1; i < legs.length; i++) n += legSeasons(agent, legs[i]);
  return n;
}

/** The season whose closing steps end the last leg `upTo` (inclusive) from where `x` is at the
    opening of season `idx`: an expedition on a leg rides this season at its closing, one waiting
    starts at that closing and first rides the next. */
function closeOf(content, x, idx, upTo) {
  const legs = routeOf(content, x.route).legs, agent = agentOf(content, x.agent);
  let n = x.status === 'out' ? x.left - 1 : legSeasons(agent, legs[x.leg]);
  for (let i = x.leg + 1; i <= upTo; i++) n += legSeasons(agent, legs[i]);
  return idx + n;
}

/** The last season of the stretch of played seasons that `idx` is in, up to the next gap (where the
    act jump settles the road) or the end of the game. A calendar with no gap is one stretch. */
function actEnd(s, content, idx) {
  const played = playedSeasons(content.calendar, s.length);
  let i = played.indexOf(idx);
  while (i + 1 < played.length && played[i + 1] === played[i] + 1) i++;
  return played[i];
}

/** The last season the game plays. */
const gameEnd = (s, content) => playedSeasons(content.calendar, s.length).at(-1);

/** The letters an expedition could write now: weight above 0, `when` holds, not a once-only letter
    written before, not one of its own already on the way, and one that can matter (see the head). */
function pool(s, content, x, idx, lag) {
  const legs = routeOf(content, x.route).legs;
  const home = closeOf(content, x, idx, legs.length - 1) + 1;                      // the season its return is due
  const lastDecision = x.leg <= legs.length - 2 ? closeOf(content, x, idx, legs.length - 2) : -1;
  return (content.letters ?? []).filter(l =>
    l.weight > 0 && !(l.repeat === false && s.seen[l.id]) && !s.post.some(p => p.id === l.id && p.expedition === x.id) &&
    holds(l.when, s, content, x) &&
    (l.kind === 'question'
      ? idx + 2 * lag <= lastDecision && idx + 2 * lag < actEnd(s, content, idx)
      : idx + lag <= home && idx + lag < gameEnd(s, content)));
}

/** Opening step "letters": put on the desk what has arrived, then let each expedition on the
    road write. */
export function letters(s, content) {
  const idx = seasonIndex(s, content);
  s.post ??= [];
  deliver(s, content, idx);
  for (const x of s.expeditions) write(s, content, x, idx);
}

/** A letter whose season has come goes onto the desk, if there is room; if not it waits a season.
    A report's `happened` effects apply now, once, as it reaches the house. */
function deliver(s, content, idx) {
  const waiting = [];
  for (const p of s.post) {
    if (p.arrive > idx || deskFull(s)) { waiting.push(p); continue; }
    const letter = letterOf(content, p.id);
    if (!letter) continue;
    const ctx = { agent: p.agent, expedition: p.expedition };
    const trial = structuredClone(s);
    try { applyAll(trial, content, letter.happened, ctx); }
    catch (e) { s.log.push({ at: idx, kind: 'dropped', ref: letter.id, reason: e.message }); continue; }
    applyAll(s, content, letter.happened, ctx); // the trial said it holds
    addPaper(s, { kind: 'letter', ref: letter.id, agent: p.agent, expedition: p.expedition, stop: p.stop, standing: p.standing, written: p.written, lag: p.lag, reached: idx });
    s.log.push({ at: idx, kind: 'letter', ref: letter.id });
  }
  s.post = waiting;
}

/** The chance an expedition writes now: the plain chance, a rising one while it has written nothing on this trip, and a
    sure thing at the last opening a trip that has written nothing has (DESIGN 2.1 rule 5): a road of one stop and
    one writing opening has no ramp to climb, so without this they cap near the plain chance. */
export const chanceFor = (x, content) => {
  if (x.wrote) return LETTER_CHANCE;
  if (content && seasonsLeft(content, x) <= 1) return 1;
  return Math.min(1, LETTER_CHANCE + SILENT_RAMP * (x.quiet ?? 0));
};

/** One draw at most for an expedition that is on the road and not at home. The first question a house can be asked
    is sure (DESIGN 2.1 rule 5, "the second season's question letter"): while no question has been written in this game, an
    expedition with one that can be written now writes it, with no chance draw and whatever the weights; city.json's
    `secondSeason.letter` if that is one of them, else one by weight. DESIGN says season two, but an expedition sent in
    season one is still at home at season two's opening (it does not move in the season it is sent, and nobody writes from
    home), so the first opening a letter can be written at is season three; the sure question is that one. A question that
    could not matter (see the head) is never written, so a trip with no decision point left brings none, and the
    guarantee waits for the next trip that can. */
function write(s, content, x, idx) {
  const place = placeOf(content, x);
  if (!place || x.sent === idx || s.post.some(p => p.expedition === x.id && p.written === idx)) return; // one a season
  const lag = lagOf(content, place.stop);
  if (!lag) return; // at home (0) or at a stop no route reaches (null): nobody writes
  const choices = pool(s, content, x, idx, lag);
  const first = !(content.letters ?? []).some(l => l.kind === 'question' && s.seen[l.id]);
  const sure = first ? choices.filter(l => l.kind === 'question') : [];
  let letter = null;
  if (sure.length) letter = sure.find(l => l.id === content.city?.secondSeason?.letter) ?? weighted(s, sure);
  else if (choices.length && chance(s, chanceFor(x, content))) letter = weighted(s, choices);
  if (!letter) { x.quiet = (x.quiet ?? 0) + 1; return; }   // an opening it could have written at and did not
  x.wrote = (x.wrote ?? 0) + 1;
  s.seen[letter.id] = (s.seen[letter.id] ?? 0) + 1;
  s.post.push({ id: letter.id, kind: letter.kind, expedition: x.id, agent: x.agent, stop: place.stop, standing: place.standing, written: idx, lag, arrive: idx + lag });
}

/** Called by choose() after the player answers a letter's question: stamps each order the choice
    just pushed (the ones with no season yet) with the letter and the season it reaches the agent. */
export function stamp(s, paper, idx) {
  const x = s.expeditions.find(e => e.id === paper.expedition);
  if (!x) return;
  for (const o of x.orders) if (o.at === undefined) Object.assign(o, { letter: paper.ref, at: idx + paper.lag });
}

const droppedOrder = (s, at, letter, reason) => s.log.push({ at, kind: 'dropped', ref: `order:${letter}`, reason });

/** An answer to a letter whose expedition is gone (home and put away, lost, or settled at the jump)
    reaches no one. The orders in `now` are left out of the choice, the rest of it still
    applies, and the drop is logged. Returns the effects to run. */
export function reachable(s, paper, now) {
  const x = s.expeditions.find(e => e.id === paper.expedition);
  if (x) return now ?? [];
  const rest = (now ?? []).filter(e => !(e && typeof e === 'object' && 'order' in e));
  if (rest.length !== (now ?? []).length) droppedOrder(s, paper.reached ?? s.log.at(-1)?.at ?? 0, paper.ref, `the answer to "${paper.ref}" came after the trip was over, so it reached no one`);
  return rest;
}

/** An expedition leaves the road (home, lost or settled): an order that never acted is dropped, and logged. */
export function close(s, content, x, idx) {
  for (const o of x.orders ?? []) {
    if (o.used) continue;
    droppedOrder(s, idx, o.letter, `the answer to "${o.letter}" had not acted before ${agentOf(content, x.agent)?.name ?? x.agent}'s trip was over`);
  }
  x.orders = [];
}

/** The questions an expedition's agent is still waiting on at season `idx`: letters of its own on
    the way, and answers given but not yet arrived. */
const pending = (s, x, idx) =>
  s.post.filter(p => p.kind === 'question' && p.expedition === x.id).map(p => p.id)
    .concat((x.orders ?? []).filter(o => o.at === undefined || o.at > idx).map(o => o.letter));

/** What the expedition does on arriving at a decision point (the end of a leg that is not the last)
    at season `idx`, or, with `again`, on waking in a season it was held: WAIT (hold a season), ON
    (go on) or HOME (turn back toward home). Sets `x.hold` when a careful agent is holding, which
    makes routes.move ask again next season. */
export function decide(s, content, x, idx, { again = false } = {}) {
  delete x.hold;
  const held = () => (x.held ?? 0) < MAX_HOLD && (x.held = (x.held ?? 0) + 1);
  const due = (x.orders ?? []).filter(o => o.at !== undefined && o.at <= idx).sort((a, b) => a.at - b.at);
  if (due.length) {
    const fresh = due.filter(o => !o.used);
    const alone = fresh.length ? byTrait(s, content, x, idx, again) : null;   // what the agent would have done unasked, read before the order moves `held`
    for (const o of fresh) { o.used = true; s.log.push({ at: idx, kind: 'order', ref: o.letter, choice: o.go }); }
    const go = due[due.length - 1].go;
    // an agent woken after a hold has already waited here, so a wait order has been kept
    const did = go === WAIT && !again && held() ? WAIT : go === HOME ? HOME : ON;
    // the return paper tells the player what an order changed (routes.js `orderLine`): the last order is the one that acted
    if (fresh.length && x.book) {
      const stop = routeOf(content, x.route)?.legs?.[x.leg]?.from;
      for (const o of fresh) (x.book.orders ??= []).push({ letter: o.letter, go: o.go, stop, did: o === due[due.length - 1] ? did : null, changed: o === due[due.length - 1] && did !== alone });
    }
    return did;
  }
  const asked = pending(s, x, idx);
  if (!asked.length) return ON;
  const traits = agentOf(content, x.agent)?.traits ?? [];
  if (traits.includes('careful') || wary(s, x.agent)) {
    if (!held()) return ON;
    x.hold = true;
    return WAIT;
  }
  if (again) return ON;
  if (traits.includes('bold')) return ON;
  const go = defaultOf(content, asked[asked.length - 1]);
  return go === WAIT ? (held() ? WAIT : ON) : go === HOME ? HOME : ON;
}

/** What `decide` would answer with no order due, changing nothing: used to tell whether an order changed what the agent did. */
function byTrait(s, content, x, idx, again) {
  const asked = pending(s, x, idx);
  if (!asked.length) return ON;
  const room = (x.held ?? 0) < MAX_HOLD;
  const traits = agentOf(content, x.agent)?.traits ?? [];
  if (traits.includes('careful') || wary(s, x.agent)) return room ? WAIT : ON;
  if (again || traits.includes('bold')) return ON;
  const go = defaultOf(content, asked[asked.length - 1]);
  return go === WAIT ? (room ? WAIT : ON) : go === HOME ? HOME : ON;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** For view(): what a letter paper says about itself, by paper id. */
export function describe(s, content) {
  const out = {};
  for (const p of s.desk) {
    if (p.kind !== 'letter' || p.id === null) continue;
    const letter = letterOf(content, p.ref);
    const name = agentOf(content, p.agent)?.name ?? p.agent;
    const stop = stopName(content, p.stop);
    out[p.id] = {
      line: `From ${name}, ${p.standing === false ? 'on the road to' : 'at'} ${stop}. Written in ${writeSeason(content, p.written)}. It reached you in ${writeSeason(content, p.reached)}.`,
      answer: letter?.kind === 'question'
        ? `Your answer will reach ${name} ${p.lag === 1 ? 'next season' : `in ${NUMBER_WORDS[p.lag] ?? p.lag} seasons`}.`
        : null,
    };
  }
  return out;
}
