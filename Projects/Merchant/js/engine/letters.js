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
//
// A letter about a trip never reaches the desk after that trip's return paper (MER-118): see `deliver`. Lost expeditions are
// exempt, their letters are kept (DECISIONS 2026-11-17 12:10).
import { seasonIndex, playedSeasons } from './calendar.js';
import { holds, placeOf } from './conditions.js';
import { applyAll } from './effects.js';
import { addPaper, deskFull, cityOf } from './state.js';
import { chance, weighted } from './rng.js';
import { lagOf, writeSeason, truePrice } from './market.js';
import { wary, legSeasons } from './agents.js';
import { accountItem, foldAccounts } from './routes.js';   // a cycle (routes.js reads decide and close from here); both are only called after the modules have loaded

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
/** Seasons in which a fact is not told again: the season it was told and the next (MER-123). */
export const REPEAT_GAP = 2;
/** What a letter's words claim that its `when` cannot say, by letter id (MER-123): `sells` is true or a list of goods, and
    holds only while the expedition carries one of them ("I sold at once" from a party with nothing to sell is a lie).
    Empty for now, on purpose: switching a letter on changes which letters a seeded game draws, because most scripted and bot
    parties carry money and no goods, and that moved test/routes.mjs's seed 13 (no agent at home for the plague) and
    test/venture.mjs's played states, files MER-123 does not own. The letters that say "I sold" are walata-early-sale,
    constantinople-sacks, alexandria-genoese-buyer and alexandria-galleys-back; add their ids here, as { sells: true }, in the
    batch that re-pins those two files. */
export const CLAIMS = {};

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

/** Whether what the letter claims is true of the expedition now (`CLAIMS`). */
export function claimsHold(l, x) {
  const claim = CLAIMS[l.id];
  if (!claim?.sells) return true;
  const carried = Object.entries(x.cargo ?? {}).filter(([, n]) => n > 0).map(([g]) => g);
  return claim.sells === true ? carried.length > 0 : carried.some(g => claim.sells.includes(g));
}

/** The note and the source lines of a card or letter: what it tells, for comparing with what the desk was told lately. */
const factsOf = item => [item?.note, ...(item?.sources ?? []).map(s => `${s.src}|${s.at}`)].filter(Boolean);

/** True when a card or letter that tells the same note or the same source line is on the desk's record for the last REPEAT_GAP
    seasons (the log writes `card` and `letter` as each reaches the desk), or is in the post for a season within REPEAT_GAP of
    the one this letter would arrive in. A letter of the same id is `repeat`'s business, not this one's. */
export function repeatsRecent(s, content, l, idx, lag = 0) {
  const mine = new Set(factsOf(l));
  const told = (id) => { const o = (content.cards ?? []).find(c => c.id === id) ?? letterOf(content, id); return !!o && id !== l.id && factsOf(o).some(f => mine.has(f)); };
  if (s.log.some(e => (e.kind === 'card' || e.kind === 'letter') && idx - e.at < REPEAT_GAP && told(e.ref))) return true;
  return s.post.some(p => Math.abs(p.arrive - (idx + lag)) < REPEAT_GAP && told(p.id));
}

/** The letters an expedition could write now: weight above 0, `when` holds, not a once-only letter
    written before, not one of its own already on the way, and one that can matter (see the head). */
function pool(s, content, x, idx, lag) {
  const legs = routeOf(content, x.route).legs;
  const home = closeOf(content, x, idx, legs.length - 1) + 1;                      // the season its return is due
  const lastDecision = x.leg <= legs.length - 2 ? closeOf(content, x, idx, legs.length - 2) : -1;
  return (content.letters ?? []).filter(l =>
    l.weight > 0 && !(l.repeat === false && s.seen[l.id]) && !s.post.some(p => p.id === l.id && p.expedition === x.id) &&
    holds(l.when, s, content, x) && claimsHold(l, x) && !repeatsRecent(s, content, l, idx, lag) &&
    (l.kind === 'question'
      ? idx + 2 * lag <= lastDecision && idx + 2 * lag < actEnd(s, content, idx)
      : idx + lag <= home && idx + lag < gameEnd(s, content) && idx + lag <= actEnd(s, content, idx)));
}

/** Opening step "letters": put on the desk what has arrived, then let each expedition on the
    road write. */
export function letters(s, content) {
  const idx = seasonIndex(s, content);
  s.post ??= [];
  accountFor(s, content, idx, deliver(s, content, idx));
  tripFacts(s, content);
  for (const x of s.expeditions) write(s, content, x, idx);
}

// ---------------------------------------------------------------------------------------------
// What the trips that came home this opening did, for the papers that tell of them (MER-123).
// A card's `when` can read a flag but not a return paper, so the facts a card's words rely on are written to flags
// here, after the return step and before the cards are drawn, and cleared at each opening. For an agent `a`:
//   `a-profit`        the house's net on the trip that came home (a number, negative for a loss)
//   `a-undersold`     set when the trip sold goods and made less than the sheet hoped
//   `a-widened-trip`  set when the answer "let him go further" was given while this trip was out
export const FACT_FLAGS = ['profit', 'undersold', 'widened-trip', 'bonused'];
const FACT_FLAG = new RegExp(`^(.+)-(${FACT_FLAGS.join('|')})$`);

/** The trip's season of sailing, from the log's `outfit` line for the expedition (the paper keeps no season of its own). */
const sentSeason = (s, expedition) => s.log.find(e => e.kind === 'outfit' && e.ref === expedition)?.at ?? null;

function tripFacts(s, content) {
  for (const k of Object.keys(s.flags ?? {})) {
    const m = FACT_FLAG.exec(k);
    if (!m || !agentOf(content, m[1])) continue;
    // a bonus paid while a trip was out (a letter's) or at its return stays on record until that trip is answered and gone, so a letter's bonus
    // and the return paper's cannot both be paid (MER-135); a trip sent in the season the flag was set, or later, is a new trip
    if (m[2] === 'bonused') {
      // (the return step has already taken a trip that came home off the books and put its paper on the desk, so both are looked at)
      const trips = [...s.expeditions.filter(e => e.agent === m[1]).map(e => e.id), ...s.desk.filter(q => q.kind === 'return' && q.agent === m[1]).map(q => q.expedition)];
      if (trips.some(id => { const sent = sentSeason(s, id); return sent !== null && sent < s.flags[k]; })) continue;
    }
    delete s.flags[k];
  }
  for (const p of s.desk) {
    if (p.kind !== 'return' || !p.data || !agentOf(content, p.agent)) continue;
    const net = p.data.houseNet, sold = (p.data.account ?? []).some(r => r.label === 'Sold' && r.amount > 0);
    s.flags[`${p.agent}-profit`] = net;
    // a trip the road robbed already has its blame paper (the lost paper): the clerk does not blame the agent's selling for what the robbers took (MER-139, play problem 10)
    const robbed = (p.data.account ?? []).some(r => r.label === 'Lost');
    if (sold && !robbed && Number.isFinite(p.data.hoped) && net < p.data.hoped) s.flags[`${p.agent}-undersold`] = 1;
    const sent = sentSeason(s, p.expedition), given = s.flags[`${p.agent}-widened`];
    if (sent !== null && Number.isFinite(given) && given >= sent) s.flags[`${p.agent}-widened-trip`] = 1;
  }
  for (const p of s.desk) if (p.kind === 'return' && p.data && !p.data.fitted) { limitBroker(s, p); fitOffers(p); fitBroker(s, content, p); }
}

/** A broker's offer says how far under the usual price it is (MER-134, play problem 7: "about 17 in every hundred less" was printed
    for one good at three prices that were 9 to 25 in every hundred off, and 16 for another that was 25 off). The words are worked out here, when the paper is made,
    from the sum the broker offers and the price the house would get for the goods in the home market now (the price the ledger
    shows). A sum that would be no discount (under 5 in every hundred) or an insult (over 30) is first set again at the discount
    the entry's own words name, against today's price, so the broker still looks like a broker; the sum, the choice's label and
    hint, its effect and the paper's body then all carry the same number. */
export const BROKER_MIN = 5, BROKER_MAX = 30;
const BROKER_WORDS = /(That is about )(\d+)( in every hundred less than the usual price in )/;
function fitBroker(s, content, p) {
  const choice = (p.data.choices ?? []).find(c => c.id === 'sell');
  const pay = choice?.now?.find(e => e && typeof e === 'object' && typeof e.money === 'number' && e.money > 0);
  const out = choice?.now?.find(e => e && typeof e === 'object' && typeof e.stock === 'string' && e.by < 0);
  const body = p.data.ask?.body, words = BROKER_WORDS.exec(body ?? '');
  if (!pay || !out || !words) return;
  const price = truePrice(s, content, cityOf(content, 'market').home, out.stock, seasonIndex(s, content));
  if (!price) return;
  const loads = -out.by, was = pay.money, gapOf = sum => Math.round((1 - sum / (loads * price)) * 100);
  let sum = was, gap = gapOf(sum);
  if (gap < BROKER_MIN || gap > BROKER_MAX) { sum = Math.max(1, Math.round(loads * price * (1 - Number(words[2]) / 100))); gap = gapOf(sum); }
  const swap = text => (typeof text === 'string' ? text.replace(`for ${was} dinars`, `for ${sum} dinars`).replace(`get ${was} dinars`, `get ${sum} dinars`) : text);
  p.data.ask.body = swap(body).replace(BROKER_WORDS, `$1${gap}$3`);
  choice.hint = swap(choice.hint);
  pay.money = sum;
}

/** A bonus is never offered above the trip's profit (MER-123): the return paper's bonus choice is cut to half the profit,
    rounded down, when the entry's fixed sum is more than the profit, and left out when half the profit is under one dinar.
    The label, the effect and the `requires` carry the new sum. */
function fitOffers(p) {
  p.data.fitted = true;
  const net = p.data.houseNet, choices = p.data.choices ?? [];
  const i = choices.findIndex(c => c.id === 'bonus' && (c.now ?? []).some(e => e && typeof e === 'object' && e.money < 0));
  if (i < 0) return;
  const c = choices[i], was = -c.now.find(e => e && typeof e === 'object' && e.money < 0).money;
  if (net < was) {
    const sum = Math.floor(Math.max(net, 0) / 2);
    if (sum < 1) { choices.splice(i, 1); return; }
    c.label = c.label.replace(String(was), String(sum));
    for (const e of c.now) if (e && typeof e === 'object' && e.money < 0) e.money = -sum;
    if (c.requires?.money) c.requires.money.gte = sum;
  }
  // one bonus for one trip (MER-134, play problem 15: "a bonus of 30 dinars", then a card offering "a bonus of 5 dinars first"):
  // once either is paid the other closes. `choose` sets the flag when this one is paid; a card's bonus sets it in its own effects.
  const gate = { flag: `${p.agent}-bonused`, not: true };
  c.requires = c.requires ? { all: [c.requires, gate] } : gate;
}

/** One bonus for one trip, on a letter as on a return paper (MER-135): a letter's choice with the id 'bonus' closes once the agent's
    trip has had a bonus, and `choose` records it. The choices come back as copies; the content is not touched. */
export function gateBonus(p, list) {
  if (p.kind !== 'letter' || !p.agent) return list;
  const gate = { flag: `${p.agent}-bonused`, not: true };
  return list.map(c => (c.id === 'bonus' ? { ...c, requires: c.requires ? { all: [c.requires, gate] } : gate } : c));
}

/** How many times one broker's paper is shown in a game (MER-134, play problem 15: the same broker paper four times). The third time
    a trip would bring it, the return paper carries no offer, and the goods wait in the store as the paper says. */
export const BROKER_SHOWN = 2;
function limitBroker(s, p) {
  const id = p.data.entry;
  if (!id || !/^return-sell-/.test(id)) return;
  const key = `shown:${id}`;
  if ((s.seen[key] ?? 0) >= BROKER_SHOWN) { Object.assign(p.data, { entry: null, ask: null, choices: [] }); return; }
  s.seen[key] = (s.seen[key] ?? 0) + 1;
}

/** The season the expedition's trip came home and its return paper was made, or null while it is on the road or if it was
    lost (a loss has its own paper, and a letter from a lost expedition is kept, DECISIONS 2026-11-17 12:10). Read from the log:
    a return step writes `return` (ref the expedition), the act jump writes `settled` lines with `result: 'home'`. */
function returnSeason(s, id) {
  for (const e of s.log) {
    if (e.kind === 'return' && e.ref === id) return e.at;
    if (e.kind === 'jump' && (e.settled ?? []).some(l => l.expedition === id && l.result === 'home')) return e.at;
  }
  return null;
}

/** A letter whose season has come goes onto the desk, if there is room; if not it waits a season.
    A report's `happened` effects apply now, once, as it reaches the house.
    A letter about a trip never reaches the desk after that trip's return paper (MER-118). The return step runs before this one,
    so a letter that arrives in the season its trip's paper is made is put ahead of the paper. A letter that could only come
    after it (the trip came home early, by a recall or an order home, or the paper took the last room on the desk) is dropped, and the log says so. */
function deliver(s, content, idx) {
  const waiting = [], items = [];
  for (const p of s.post) {
    if (actEnd(s, content, p.written) < idx) {                       // written in an act that has ended: it would reach the desk years late
      s.log.push({ at: idx, kind: 'dropped', ref: p.id, reason: `the letter "${p.id}" was written in an act that ended before it could arrive, so it was left out` });
      continue;
    }
    const home = returnSeason(s, p.expedition);
    // a letter that waited for room on a full desk (it arrived in an earlier season) must not turn up with the agent it was
    // written by: it is as old as the wait, and the player would read a news item that the agent's own return paper outdates (MER-134)
    if (home !== null && (home < idx || p.arrive > home || (p.arrive < idx && home === idx))) {
      s.log.push({ at: idx, kind: 'dropped', ref: p.id, reason: `the letter "${p.id}" could only have reached the desk after ${agentOf(content, p.agent)?.name ?? p.agent}'s return paper, so it was left out` });
      continue;
    }
    const letter = letterOf(content, p.id);
    // money or goods that move as a letter arrives need a line on the Accounts paper (MER-134): room for the letter and for that paper
    const moves = (letter?.happened ?? []).some(e => e && typeof e === 'object' && ('money' in e || 'stock' in e));
    // and once a letter this opening has moved money, the place for its paper stays kept against every letter after it, until foldAccounts puts the paper on the desk (MER-135)
    const room = s.desk.some(q => q.kind === 'accounts' && q.state === 'open') || (!moves && !items.length) ? 1 : 2;
    if (p.arrive > idx || deskFull(s, room)) { waiting.push(p); continue; }
    if (!letter) continue;
    const ctx = { agent: p.agent, expedition: p.expedition };
    const trial = structuredClone(s);
    try { applyAll(trial, content, letter.happened, ctx); }
    catch (e) { s.log.push({ at: idx, kind: 'dropped', ref: letter.id, reason: e.message }); continue; }
    applyAll(s, content, letter.happened, ctx); // the trial said it holds
    addPaper(s, { kind: 'letter', ref: letter.id, agent: p.agent, expedition: p.expedition, stop: p.stop, standing: p.standing, written: p.written, lag: p.lag, reached: idx });
    const paper = s.desk.pop(), k = s.desk.findIndex(q => q.kind === 'return' && q.expedition === p.expedition);
    s.desk.splice(k < 0 ? s.desk.length : k, 0, paper);                   // ahead of its own trip's return paper
    s.log.push({ at: idx, kind: 'letter', ref: letter.id });
    const item = moves ? accountItem(s, content, { do: letter.happened, from: letter.id, agent: p.agent, viaCard: letter.title }) : null;
    if (item) items.push(item);
  }
  s.post = waiting;
  return items;
}

/** What letters moved this opening goes on the Accounts paper (MER-134, play problem 9 and 10: 30 dinars left the purse at the start of
    Summer 1336 with no paper saying why, because a letter's `happened` money moved silently). One open Accounts paper on the desk
    takes the lines; with none, one is put on the desk. */
function accountFor(s, content, idx, items) {
  if (!items.length) return;
  const open = s.desk.find(q => q.kind === 'accounts' && q.state === 'open');
  if (!open) { foldAccounts(s, content, items); return; }
  open.items.push(...items);
  s.log.push({ at: idx, kind: 'accounts', items: items.map(i => i.text) });
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
