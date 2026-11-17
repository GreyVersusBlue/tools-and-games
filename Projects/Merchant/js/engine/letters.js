// Letters from the road (ARCHITECTURE 4.2 step 2, 4.4, 5.7; DESIGN 4.5).
//
// Each opening season, every expedition on the road may write one letter, drawn from
// letters.json by `when` and `weight`. The letter was written where the expedition stands, and
// it travels: it reaches the desk `lag` seasons later, `lag` being market.lagOf, the same
// function the price letters use. A letter carries its expedition and agent as the context of
// its paper, the stop it was written at and the season it was written.
//
// While a letter is on the road it lives on its expedition, in `x.post`:
//   { id, kind, stop, leg, written, lag, arrive, def, delivered }
// `leg` is the leg the expedition was on when it wrote, and the decision a question asks about
// is what to do at the end of that leg: go on at once, or wait a season where it stands. `def`
// is the plain agent's default, the `go` of the choice the question names with "default".
// An answer comes back as an order on `x.orders`: { go, letter, leg, at }, with `at` the
// season it reaches the expedition (the season the player answered, plus the same lag).
//
// routes.js asks `decide` when an expedition arrives at the end of a leg. A due order wins.
// Until the order arrives the agent acts by its trait: careful waits, bold goes on, anyone else
// does what the letter calls the default. An order that arrives after the expedition has passed
// the end of that leg is dropped and logged.
import { seasonIndex } from './calendar.js';
import { holds, placeOf } from './conditions.js';
import { applyAll } from './effects.js';
import { addPaper, deskFull } from './state.js';
import { chance, weighted } from './rng.js';
import { lagOf, writeSeason } from './market.js';
import { wary } from './agents.js';

/** The chance a letter is written, for an expedition with a letter to write, in a season. */
export const LETTER_CHANCE = 0.5;
/** The `go` that holds an expedition a season where it stands; any other answer is "go on". */
export const WAIT = 'wait';

const letterOf = (content, id) => (content.letters ?? []).find(l => l.id === id);
const agentOf = (content, id) => (content.agents ?? []).find(a => a.id === id);
const stopName = (content, id) => (content.stops ?? []).find(s => s.id === id)?.name ?? id;

/** The `go` of a choice's order, or null when the choice gives none. */
const goOf = choice => (choice?.now ?? []).find(e => e && typeof e === 'object' && 'order' in e)?.order?.go ?? null;

/** The letters an expedition could write now: weight above 0, `when` holds, not a once-only
    letter that was written before, and not one already on its way from this expedition. */
function pool(s, content, x) {
  return (content.letters ?? []).filter(l =>
    l.weight > 0 && !(l.repeat === false && s.seen[l.id]) && !(x.post ?? []).some(p => p.id === l.id) &&
    holds(l.when, s, content, x));
}

/** Opening step "letters": drop what has gone stale, put on the desk what has arrived, then let
    each expedition on the road write. */
export function letters(s, content) {
  const idx = seasonIndex(s, content);
  for (const x of s.expeditions) { staleOrders(s, content, x, idx); deliver(s, content, x, idx); }
  for (const x of s.expeditions) write(s, content, x, idx);
}

/** An order whose season has come but whose leg the expedition is past reached it too late. */
function staleOrders(s, content, x, idx) {
  const kept = [];
  for (const o of x.orders ?? []) {
    if (o.at === undefined || o.at > idx || o.leg === undefined || o.leg >= x.leg) { kept.push(o); continue; }
    s.log.push({ at: idx, kind: 'dropped', ref: `order:${o.letter}`, reason: `the answer to "${o.letter}" reached ${agentOf(content, x.agent)?.name ?? x.agent} after the expedition had passed the end of leg ${o.leg + 1}` });
  }
  x.orders = kept;
  x.post = (x.post ?? []).filter(p => !(p.delivered && p.leg < x.leg));
}

/** A letter whose season has come goes onto the desk, if there is room; if not it waits a season.
    A report's `happened` effects apply now, once, as it reaches the house. */
function deliver(s, content, x, idx) {
  for (const p of x.post ?? []) {
    if (p.delivered || p.arrive > idx || deskFull(s)) continue;
    const letter = letterOf(content, p.id);
    p.delivered = true;
    if (!letter) continue;
    const trial = structuredClone(s);
    try { applyAll(trial, content, letter.happened, { agent: x.agent, expedition: x.id }); }
    catch (e) { s.log.push({ at: idx, kind: 'dropped', ref: letter.id, reason: e.message }); continue; }
    applyAll(s, content, letter.happened, { agent: x.agent, expedition: x.id }); // the trial said it holds
    addPaper(s, { kind: 'letter', ref: letter.id, agent: x.agent, expedition: x.id, stop: p.stop, leg: p.leg, written: p.written, lag: p.lag, reached: idx });
    s.log.push({ at: idx, kind: 'letter', ref: letter.id });
  }
}

/** One draw at most for an expedition that is on the road and not at home. */
function write(s, content, x, idx) {
  const place = placeOf(content, x);
  if (!place || x.sent === idx || (x.post ?? []).some(p => p.written === idx)) return; // one a season
  const lag = lagOf(content, place.stop);
  if (!lag) return; // at home (0) or at a stop no route reaches (null): nobody writes
  const choices = pool(s, content, x);
  if (!choices.length || !chance(s, LETTER_CHANCE)) return;
  const letter = weighted(s, choices);
  s.seen[letter.id] = (s.seen[letter.id] ?? 0) + 1;
  const def = letter.kind === 'question' && letter.default ? goOf(letter.choices.find(c => c.id === letter.default)) : null;
  (x.post ??= []).push({ id: letter.id, kind: letter.kind, stop: place.stop, leg: place.leg, written: idx, lag, arrive: idx + lag, def, delivered: false });
}

/** Called by choose() after the player answers a letter's question: stamps each order the choice
    just pushed (the ones with no season yet) with the letter, its leg and the season it arrives. */
export function stamp(s, paper, idx) {
  const x = s.expeditions.find(e => e.id === paper.expedition);
  if (!x) return;
  for (const o of x.orders) if (o.at === undefined) Object.assign(o, { letter: paper.ref, leg: paper.leg, at: idx + paper.lag });
}

/** An answer to a letter whose expedition is no longer on the road reaches no one. The orders in
    `now` are left out of the choice and the rest of it still applies. Returns the effects to run. */
export function reachable(s, paper, now) {
  if (s.expeditions.some(e => e.id === paper.expedition)) return now ?? [];
  return (now ?? []).filter(e => !(e && typeof e === 'object' && 'order' in e));
}

/** What the expedition does on arriving at the end of leg `legIdx` at season `idx`:
    WAIT (hold a season), or null (go on). Consumes the order it used. Called by routes.tolls
    before the next leg starts. */
export function decide(s, content, x, legIdx, idx) {
  const orders = x.orders ?? [];
  const due = orders.filter(o => o.leg === legIdx && o.at !== undefined && o.at <= idx).sort((a, b) => a.at - b.at);
  if (due.length) {
    x.orders = orders.filter(o => !due.includes(o));
    return due[due.length - 1].go === WAIT ? WAIT : null;
  }
  const asked = (x.post ?? []).filter(p => p.kind === 'question' && p.leg === legIdx);
  if (!asked.length) return null;
  const traits = agentOf(content, x.agent)?.traits ?? [];
  if (traits.includes('careful') || wary(s, x.agent)) return WAIT;
  if (traits.includes('bold')) return null;
  return asked[asked.length - 1].def === WAIT ? WAIT : null;
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
      line: `From ${name}, at ${stop}. Written in ${writeSeason(content, p.written)}. It reached you in ${writeSeason(content, p.reached)}.`,
      answer: letter?.kind === 'question'
        ? `Your answer will reach ${stop} ${p.lag === 1 ? 'next season' : `in ${NUMBER_WORDS[p.lag] ?? p.lag} seasons`}.`
        : null,
    };
  }
  return out;
}
