// Expeditions, contracts, returns, the act jump and the ending's recall
// (ARCHITECTURE 4.2 returns, 4.3, 4.5, 4.7, 4.9). Every function that takes `s` works on a
// state its caller has already cloned. The public ones (outfit, suggestPlan, checkPlan,
// routeFor, destinations) take a state and return a new one or a plain answer.
//
// Timeline of one expedition, in seasons (a state has `t`, the season being played):
//   sent in season n      it does not move; its first leg starts in n+1 (n+2 if that leg is closed)
//   a leg of L seasons    travels for L seasons, then arrives at the end of the last one
//   arrival               toll paid; at the far end it trades; the next leg starts the season after
//                         if it is open (`opens` names the seasons, `when` a condition), else it waits
//   last leg arrives      status "home"; the next season opens with its return paper
// The closing steps run in this order (turn.js): move (a season passes, waiting costs upkeep),
// risk (each season ridden is rolled), tolls (arrivals: toll, trade, start the next leg).
// Trade is after risk, so a vessel lost on the way does not first sell its cargo.
import { seasonIndex, seasonName, playedSeasons, actOfSeason, year } from './calendar.js';
import { holds, fillTrip, tripFacts, mainGoodOf, placeOf } from './conditions.js';
import { applyAll } from './effects.js';
import { cityOf, addPaper, deskFull } from './state.js';
import { next, chance } from './rng.js';
import * as M from './market.js';
import { riskFactor, bargain, legSeasons, returnTrust, refusesOwn, refusesAny } from './agents.js';
import { decide, close, seasonsLeft, MAX_HOLD, WAIT, HOME } from './letters.js';
// (market.js's `expectedPrice` is read as M.expectedPrice below.)

export const WINTER_GALLEY = 1.5;   // risk times this on a galley leg started in winter (Duggan 2015: risky, not closed)
export const QIRAD_STAKE = 60;      // coins the partners put in for a suggested qirad, at most (a fifth of the house's money when that is less)
export const RULES = {
  // DESIGN 2.2 rule 1: money sent to buy with, and no good named to bring back, is refused in words, and the sheet offers the
  // default (MER-93). It shipped off until test/letters.mjs's game plan named a good to bring back (MER-95) and the sheet could
  // show the reason; test/venture.mjs keeps a case that it is on, and a false here fails the named cases there.
  refuseUnspentMoney: true,
};
export const UPKEEP = 4;            // coins a season for an expedition waiting at a stop (an estimate; the bots tune it)
// What happens to an expedition that is lost, and to an agent at home across the act jump: the
// defaults for city.json's `jump` block (ARCHITECTURE 5.1). A loss is rolled the same way on the
// road and at the jump, so the loss shares are one set of numbers, read in both places.
export const DEFAULT_JUMP = {
  retires: 0.1,          // an agent at home retires during the years of the jump
  wholeLoss: 0.4,        // of the losses, the share that take the whole vessel
  survivesWhole: 0.75,   // an agent whose vessel was lost gets home
  partial: [0.25, 0.75], // a partial loss takes this share of each good
};
export const MAX_WAIT = MAX_HOLD;   // seasons a plan may wait at one stop before it is refused (and a trip may be held in all, letters.js)
export const DEFAULT_RECALL = {
  reach: { start: 0.95, perSeason: 0.15, floor: 0.1 }, // chance word reaches an agent in time, by seasons from home
  recalledKeeps: 0.6, recalledSurvives: 0.9,
  stayedSurvives: 0.5, byStop: {},                      // an agent who stays; byStop overrides for a stop
  homeSurvives: 0.6,                                     // an agent at home in the home city
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const stopOf = (content, id) => (content.stops ?? []).find(x => x.id === id);
const goodOf = (content, id) => (content.goods ?? []).find(g => g.id === id);
const agentOf = (content, id) => (content.agents ?? []).find(a => a.id === id);
const routeOf = (content, id) => (content.routes ?? []).find(r => r.id === id);
const homeOf = content => cityOf(content, 'expeditions').home;
const cap = w => `${w[0].toUpperCase()}${w.slice(1)}`;
const goodName = (content, id) => (goodOf(content, id)?.name ?? id).toLowerCase();
const stopName = (content, id) => stopOf(content, id)?.name ?? id;
const SEASON_WORDS = { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' };
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const words = n => NUMBER_WORDS[n] ?? String(n);
const plural = (n, one, many) => (n === 1 ? one : many);
const VESSEL = { caravan: 'caravan', galley: 'galley', dhow: 'dhow', nileboat: 'boat', mules: 'mule train' };

/** "20 loads of <good>", "1 chest of <good>". */
function qty(content, good, n) {
  const unit = goodOf(content, good)?.unit ?? 'load';
  return `${n} ${plural(n, unit, `${unit}s`)} of ${goodName(content, good)}`;
}
const cargoText = (content, cargo) => {
  const parts = Object.entries(cargo).filter(([, n]) => n > 0).map(([g, n]) => qty(content, g, n));
  return parts.length ? parts.join(', ') : 'no goods';
};
const commas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 2663 reads "2,663", on every machine
function coins(content, n) {
  const cur = cityOf(content, 'expeditions').currency ?? 'coins';
  return `${commas(n)} ${Math.abs(n) === 1 && cur.endsWith('s') ? cur.slice(0, -1) : cur}`;
}
const addStock = (s, good, n) => { const v = (s.stock[good] ?? 0) + n; if (v > 0) s.stock[good] = v; else delete s.stock[good]; };

// ---------------------------------------------------------------------------------------------
// Routes: the legs, which seasons they are open in, and the timeline of a plan

/** Index of the last leg out: the first leg that reaches the route's far stop. */
export const outEnd = route => route.legs.findIndex(l => l.to === route.to);

/** The season `k` places ahead of the one being played, as { idx, st } where `st` reads like the
    state would in that season; null past the calendar's last season. */
function ahead(s, content, k) {
  const played = playedSeasons(content.calendar, s.length);
  if (s.t + k >= played.length) return null;
  return { idx: played[s.t + k], st: k === 0 ? s : { ...s, t: s.t + k } };
}

/** Can `leg` be started in the season `k` places ahead? `why` is "season", "when" or "end". */
function legOpen(s, content, leg, k) {
  const a = ahead(s, content, k);
  if (!a) return { open: true, idx: undefined };   // past the last season nothing is known, and the ending settles it
  if (!leg.opens.includes(seasonName(a.idx))) return { open: false, why: 'season', idx: a.idx };
  if (leg.when && !holds(leg.when, a.st, content)) return { open: false, why: 'when', idx: a.idx };
  return { open: true, idx: a.idx };
}

const listWords = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);
const legName = (content, leg) => `${stopName(content, leg.from)} to ${stopName(content, leg.to)}`;

/** Walks the legs of `route` from leg `i0`, the first of which would start `k0` seasons ahead (`limit0` waits allowed
    for it), and says where the road ends up: one rule for the outfit's estimate and for an expedition already out. */
function walk(s, content, route, agent, i0, k0, limit0) {
  const warnings = [];
  let k = k0, waits = 0;
  const legs = [];
  for (let i = i0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const limit = i === i0 ? limit0 : MAX_WAIT;
    let w = 0, o = legOpen(s, content, leg, k);
    while (!o.open && w < limit) { w++; k++; o = legOpen(s, content, leg, k); }
    if (!o.open) {
      const how = o.why === 'when' ? 'is not open in these years'
        : `can only start in ${listWords(leg.opens.map(x => SEASON_WORDS[x]))}`;
      return { ok: false, legs, why: `${i === 0 ? 'The first leg' : 'A later leg'}, ${legName(content, leg)}, ${how}.` };
    }
    if (w > 0 && i > 0) {
      warnings.push(`${cap(by(leg))} from ${stopName(content, leg.from)} to ${stopName(content, leg.to)} can only leave in ${listWords(leg.opens.map(x => SEASON_WORDS[x]))}. The expedition will wait in ${stopName(content, leg.from)} for ${words(w)} ${plural(w, 'season', 'seasons')}.`);
    }
    waits += w;
    legs.push({ i, startK: k, startIdx: o.idx, waits: w });
    k += legSeasons(agent, leg);
  }
  // k - 1 seasons from the season after sending to the last arrival, so the return opens k seasons ahead
  return { ok: true, legs, seasons: k, waits, warnings };
}

/** Where a plan along `route` would be, season by season, if sent now. Legs start at the first
    season they are open; the first may wait one season, a later one up to MAX_WAIT.
    { ok, legs: [{ i, startK, startIdx, waits }], seasons, waits, warnings, why } */
export function project(s, content, route, agent) { return walk(s, content, route, agent, 0, 1, 1); }

/** Seasons from the opening of the season being played until `x`'s return paper opens, by the rule `project` uses for the
    outfit's estimate (MER-88): so the map's "home about" and the sheet's "about three seasons" are one number, and both
    are the season the paper arrives in when nothing but the road changes it (an order, a hold, a loss). 0 for one that
    is home. Just sent: the whole road; riding: what is left of the leg and then the rest; waiting at a stop: that leg
    from next season. The first leg of an expedition sent this season does not move until the next closing. */
export function returnsIn(s, content, x) {
  if (x.status === 'home') return 0;
  const route = routeOf(content, x.route), agent = agentOf(content, x.agent);
  if (!route) return 0;
  const idx = seasonIndex(s, content);
  const fromStart = x.sent === idx;
  const hit = fromStart ? walk(s, content, route, agent, 0, 1, 1)
    : x.status === 'out' ? (x.leg + 1 >= route.legs.length ? { ok: true, seasons: x.left } : walk(s, content, route, agent, x.leg + 1, x.left, MAX_WAIT))
    : walk(s, content, route, agent, x.leg, 1, MAX_WAIT);
  return hit.ok ? hit.seasons : seasonsLeft(content, x);
}

const by = leg => ({ caravan: 'the caravan', galley: 'the galley', dhow: 'the dhow', nileboat: 'the boat', mules: 'the mules' }[leg.by] ?? 'the boat');

/** The open route to `stopId` that gets there and back soonest, or null. Ties go to the one
    with fewer legs, then the one listed first. */
export function routeFor(state, content, stopId, agent) {
  let best = null;
  for (const r of content.routes ?? []) {
    if (r.to !== stopId) continue;
    const p = project(state, content, r, agent);
    if (!p.ok) continue;
    if (!best || p.seasons < best.seasons || (p.seasons === best.seasons && r.legs.length < best.route.legs.length)) {
      best = { route: r, seasons: p.seasons, waits: p.waits, warnings: p.warnings };
    }
  }
  return best;
}

/** One line per stop the house can send someone to now, each with its best open route. With an
    `agent` the seasons and the waits are that agent's timing (a careful agent is slower on a long leg). */
export function destinations(state, content, agent) {
  const home = homeOf(content);
  const out = [];
  for (const stop of content.stops ?? []) {
    if (stop.id === home) continue;
    const hit = routeFor(state, content, stop.id, agent);
    if (hit) out.push({ stop: stop.id, name: stop.name, route: hit.route.id, seasons: hit.seasons, waits: hit.waits, warnings: hit.warnings });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Money

/** The house pays `amount`. It sells loads from its warehouse at the home price when its money
    falls short, and stops at 0: returns what could not be paid. */
function pay(s, content, amount) {
  if (amount <= 0) return 0;
  s.money -= amount;
  if (s.money >= 0) return 0;
  const home = homeOf(content);
  const price = g => M.sellPrice(s, content, home, g);
  const goods = Object.keys(s.stock).filter(g => s.market[home]?.[g]).sort((a, b) => price(b) - price(a) || (a < b ? -1 : 1));
  for (const g of goods) {
    while (s.stock[g] > 0 && s.money < 0) { s.money += price(g); M.noteSale(s, content, home, g, 1); addStock(s, g, -1); }
  }
  if (s.money >= 0) return 0;
  const short = -s.money;
  s.money = 0;
  return short;
}

/** An expedition pays `amount` from its purse, then in goods (cheapest at home first, each load
    worth its home price). Whatever is still owed when it has nothing left is waived. Returns the
    part paid in goods as { good: loads }. */
function payFromExpedition(s, content, x, amount) {
  const fromPurse = Math.min(x.purse, amount);
  x.purse -= fromPurse;
  let owed = amount - fromPurse;
  const given = {};
  if (owed > 0) {
    const home = homeOf(content);
    const worth = g => M.truePrice(s, content, home, g) ?? stopOf(content, home)?.sells?.[g]?.base ?? 1;
    const goods = Object.keys(x.cargo).sort((a, b) => worth(a) - worth(b) || (a < b ? -1 : 1));
    for (const g of goods) {
      while (x.cargo[g] > 0 && owed > 0) { x.cargo[g]--; given[g] = (given[g] ?? 0) + 1; owed -= worth(g); }
      if (!x.cargo[g]) delete x.cargo[g];
    }
    if (owed < 0) x.purse += -owed;   // the toll-keeper gives change for a load
  }
  return given;
}

// ---------------------------------------------------------------------------------------------
// Risk

/** A leg's chance of going wrong in one season, for this agent, starting in `startIdx`. */
export function legRisk(content, agent, leg, startIdx) {
  const winter = leg.by === 'galley' && startIdx !== undefined && seasonName(startIdx) === 'winter';
  return clamp(leg.risk * riskFactor(agent, leg) * (winter ? WINTER_GALLEY : 1), 0, 0.95);
}

/** The chances of loss and retirement: city.json's `jump` over the defaults. */
export function jumpChances(content) {
  return { ...DEFAULT_JUMP, ...(content.city?.jump ?? {}) };
}

/** What struck, from the leg and the loss (returns.json's `cause` fact): a ship, a boat or a caravan that goes down is the
    sea, the river or the desert; a part of a load that goes on a road or a river is taken by robbers; a part that goes
    at sea is the sea's. No draw is spent, so a seed's stream does not move. */
export function causeOf(leg, loss) {
  if (leg.by === 'galley' || leg.by === 'dhow') return 'sea';
  if (loss.whole) return leg.by === 'nileboat' ? 'river' : 'desert';
  return 'robbers';
}

/** A loss happened to `x`. Draws: whole or partial; a whole loss then draws whether the agent
    lives, a partial loss how much goes. Returns what was lost; changes `x` on a partial loss. */
function loseSome(s, content, x) {
  const J = jumpChances(content);
  if (next(s) < J.wholeLoss) {
    const survived = next(s) < J.survivesWhole;
    const cargo = { ...x.cargo }, purse = x.purse;
    x.cargo = {}; x.purse = 0;
    return { whole: true, survived, cargo, purse };
  }
  const f = J.partial[0] + next(s) * (J.partial[1] - J.partial[0]);
  const cargo = {};
  for (const [g, n] of Object.entries(x.cargo)) {
    const lose = Math.min(n, Math.max(1, Math.round(n * f)));
    cargo[g] = lose;
    x.cargo[g] -= lose;
    if (!x.cargo[g]) delete x.cargo[g];
  }
  return { whole: false, survived: true, cargo, purse: 0 };
}

// ---------------------------------------------------------------------------------------------
// Papers

const bumpKnown = (s, stop, good, p, at) => {
  const k = (s.known[stop] ??= {});
  if (!k[good] || k[good].at <= at) k[good] = { p, at };
};

function lostPaper(s, content, x, loss, leg) {
  const agent = agentOf(content, x.agent), route = routeOf(content, x.route);
  const goods = cargoText(content, loss.cargo);
  const parts = [];
  if (Object.keys(loss.cargo).length) parts.push(goods);
  if (loss.purse) parts.push(coins(content, loss.purse));
  const lost = parts.length ? parts.join(' and ') : 'nothing of value';
  const way = `the ${VESSEL[leg.by] ?? 'party'} from ${stopName(content, leg.from)} to ${stopName(content, leg.to)}`;
  const costs = lossCosts(x, loss, content, s);
  const headline = loss.whole
    ? `${agent.name}'s ${VESSEL[leg.by] ?? 'party'} was lost on the way from ${stopName(content, leg.from)} to ${stopName(content, leg.to)}. ${loss.survived ? `${agent.name} survived and is home.` : `${agent.name} did not come back.`}`
    : `Part of ${agent.name}'s cargo was lost on ${way}. ${agent.name} goes on.`;
  const lines = [{ label: 'Lost', text: lost }];
  if (x.contract.kind === 'qirad') {
    lines.push({ label: 'The house', text: `${coins(content, costs.house)} of its money` });
    lines.push({ label: 'The partners', text: `${coins(content, costs.partners)} of theirs` });
  }
  const idx = seasonIndex(s, content);
  // an order the loss overtook says what became of it, in one sentence (MER-88)
  const line = orderLine(content, x, seasonIndex(s, content), leg);
  if (line) lines.push({ label: 'Your order', text: line });
  const trip = tripFacts(content, x.agent, route, leg.to, mainGoodOf(x.book?.cargo ?? x.cargo), idx + 1 - x.sent, x.id);
  const entry = pickEntry(s, content, 'loss', { by: leg.by, cause: causeOf(leg, loss), whole: loss.whole, survived: loss.survived, agent: x.agent, to: leg.to, good: trip.good, seasons: trip.seasons, contract: x.contract.kind });
  return { kind: 'lost', ref: 'lost', agent: x.agent, expedition: x.id, data: { headline, orderLine: line, route: route.id, cause: causeOf(leg, loss), whole: loss.whole, survived: loss.survived, lines, costs, trip, ...askOf(content, entry, trip) } };
}

// ---------------------------------------------------------------------------------------------
// What a return or a loss asks (returns.json, DESIGN 2.1 rules 3 and 4)

/** Whether a trip's `facts` (one value per key) fit an entry's `facts`: every key the entry names must match.
    A list holds the values that fit, `seasons` is a { gte, lte } range, a true-or-false key matches by truth. */
function factsFit(want, have) {
  for (const [k, w] of Object.entries(want ?? {})) {
    const v = have[k];
    if (k === 'seasons') { if (!Number.isFinite(v) || (w.gte !== undefined && v < w.gte) || (w.lte !== undefined && v > w.lte)) return false; }
    else if (typeof w === 'boolean') { if (!!v !== w) return false; }
    else if (!w.includes(v)) return false;
  }
  return true;
}

/** The entry of returns.json for `paper` ('return' or 'loss') that fits the trip's facts and whose `when` holds: the one
    that names the most facts, then the heavier, then the first in the file. No draw is spent, so the seed's stream does
    not move. null when none fits. */
export function pickEntry(s, content, paper, facts) {
  const fit = (content.returns ?? []).filter(e => e.paper === paper && (e.weight ?? 1) > 0 && factsFit(e.facts, facts) && holds(e.when, s, content));
  const named = e => Object.keys(e.facts ?? {}).length;
  return fit.reduce((best, e) => (!best || named(e) > named(best) || (named(e) === named(best) && (e.weight ?? 1) > (best.weight ?? 1)) ? e : best), null);
}

/** The `choices` slot of a paper: the entry's title, body and choices with the trip's words filled in ({agent}, {to},
    {good}, {route}, {seasons}). The effects are the entry's own; nothing runs until a choice is made. */
function askOf(content, entry, trip) {
  if (!entry) return { entry: null, ask: null, choices: [] };
  const fill = text => (text === undefined ? text : fillTrip(content, text, trip));
  return {
    entry: entry.id,
    ask: { title: fill(entry.title) ?? null, body: fill(entry.body) ?? null },
    choices: entry.choices.map(c => ({ ...structuredClone(c), label: fill(c.label), ...(c.hint !== undefined ? { hint: fill(c.hint) } : {}), ...(c.result !== undefined ? { result: fill(c.result) } : {}) })),
  };
}

/** Where an order's answer found the agent, in words: "at <stop>" or "on the road to <stop>". */
const placeText = (content, p) => `${p.standing === false ? 'on the road to' : 'at'} ${stopName(content, p.stop)}`;

/** One sentence for a return or a loss whose orders changed what the expedition did, or whose answer could not (DESIGN 2.1
    rule 5), or null. The last order that acted is told first (`decide`, letters.js, wrote what the agent did and whether the
    agent would have done it unasked); failing that, the last turn-back answer that did not act. A turn-back answer is never
    lost without a word: it turns the agent back, or this line says why it did not (MER-88): there was no road home from the
    stop it was used at, the agent was already on the way home, it reached the agent after the last stop where it could
    turn, or the trip ended (`lostOn`, the leg a loss struck) before it reached the agent or before the next stop. */
export function orderLine(content, x, idx, lostOn = null) {
  const name = agentOf(content, x.agent)?.name ?? x.agent;
  const route = routeOf(content, x.route);
  const partyAt = stop => `the ${VESSEL[route?.legs?.find(l => l.from === stop && l.by)?.by] ?? 'party'}`;
  const noTurn = e => (e.beyond
    ? `You told ${name} to turn back at ${stopName(content, e.stop)}, but ${partyAt(e.stop)} was already on the road home, so there was nowhere to turn back to.`
    : `Because you told ${name} to turn back at ${stopName(content, e.stop)}, ${partyAt(e.stop)} would have, but no road leads home from there, so it went on.`);
  const o = (x.book?.orders ?? []).filter(e => e.changed).at(-1);
  if (o) {
    const at = stopName(content, o.stop), party = partyAt(o.stop);
    if (o.did === WAIT) return `Because you told ${name} to wait at ${at}, ${party} waited a season there before going on.`;
    if (o.did === HOME) return x.book.turned === o.stop ? `Because you told ${name} to turn back at ${at}, ${party} came home from there.` : noTurn(o);
    if (o.go === WAIT) return `Because you told ${name} to wait at ${at}, ${party} waited as long as a trip may, then went on.`;
    return `Because you told ${name} to go on from ${at}, ${party} did not wait there.`;
  }
  // an order used where the agent would have gone home unasked, or already was: it did not turn either
  const home = (x.book?.orders ?? []).filter(e => e.go === HOME && e.did === HOME && x.book.turned !== e.stop).at(-1);
  if (home) return noTurn(home);
  const late = (x.orders ?? []).filter(e => !e.used && e.go === HOME).at(-1);
  if (!late) return null;
  const what = `You told ${name} to turn back`;
  const reached = late.at !== undefined && (idx === undefined || late.at <= idx);
  const wayOf = leg => `${stopName(content, leg.from)} to ${stopName(content, leg.to)}`;
  if (lostOn) {
    if (route && route.legs.indexOf(lostOn) > outEnd(route)) return `${what}, but ${name} was already on the road home when the ${VESSEL[lostOn.by] ?? 'party'} was lost on the way from ${wayOf(lostOn)}, so there was nowhere to turn back to.`;
    if (!reached) return `${what}, but the answer had not reached ${name} when the ${VESSEL[lostOn.by] ?? 'party'} was lost on the way from ${wayOf(lostOn)}.`;
    return `${what}, and the answer reached ${name} ${late.place ? placeText(content, late.place) : 'on the road'}, but the ${VESSEL[lostOn.by] ?? 'party'} was lost on the way from ${wayOf(lostOn)} before there was a stop to turn back at.`;
  }
  if (!reached) return `${what}, but the answer had not reached ${name} when the trip ended.`;
  return `${what}, but the answer arrived too late: ${name} was ${late.place ? placeText(content, late.place) : 'on the road'} by then, past the last stop where the party could turn.`;
}

/** What a loss costs each party under the contract: the capital bears it in proportion to stake. */
function lossCosts(x, loss, content, s) {
  if (loss.whole) return { house: x.staked.house, partners: x.staked.partners };   // all the capital went
  const home = homeOf(content);
  let value = loss.purse;
  for (const [g, n] of Object.entries(loss.cargo)) value += n * (M.truePrice(s, content, home, g) ?? 0);
  const total = x.staked.house + x.staked.partners;
  const partners = x.contract.kind === 'qirad' && total > 0 ? Math.floor(value * x.staked.partners / total) : 0;
  return { house: value - partners, partners };
}

function put(s, paper) {
  // A return, loss or accounts paper goes on the desk at once; when the desk is full it is not shown
  // and the log says so, because the money and goods have already moved.
  const shown = addPaper(s, paper);
  if (!shown) s.log.push({ at: s.t, kind: 'dropped', ref: paper.kind, reason: 'the desk was full' });
  return shown;
}

/** For view(): when each expedition on the road is due home, by `returnsIn`, as { [expedition id]: { in, season } }: `in`
    seasons from now and the season's name ("Winter 1324"). The map and the ledger say this, so they never count it themselves. */
export function homeBy(s, content) {
  const idx = seasonIndex(s, content);
  return Object.fromEntries(s.expeditions.filter(x => routeOf(content, x.route)).map(x => {
    const n = returnsIn(s, content, x);
    return [x.id, { in: n, season: M.writeSeason(content, idx + n) }];
  }));
}

// ---------------------------------------------------------------------------------------------
// Outfitting (ARCHITECTURE 4.5)

const isCount = n => Number.isInteger(n) && n >= 0;

/** The way back is open only where there is no qirad to offer instead. */
const canPrepay = city => !city.contracts?.qirad?.agentShare;

/** The seasons of wage a trip sent now is charged, and where the road ends (MER-116): the one count the sheet's estimate, the
    prepay and the return all use. A trip that comes home before the next jump is charged the seasons its return paper counts
    (`elapsed`, `out + 1`), which is `proj.seasons`. One that cannot is settled by `jump` when the years pass, which charges the
    seasons its whole road takes (`wholeRoad`, no waits, no season for sending) or the closings it had been away if more.
    { seasons, settled, at, out, leg }: `settled` says `jump` settles it, `at` is the season index of the jump, `out` the
    closings away when it comes and `leg` the leg the party is on then (what `settle` finds in `x.leg`). */
function wageCount(s, content, route, agent, proj) {
  const played = playedSeasons(content.calendar, s.length);
  for (let j = s.t + 1; j <= s.t + proj.seasons && j < played.length; j++) {
    if (played[j] - played[j - 1] <= 1) continue;   // the closing turn.js runs `jump` after: the played seasons skip years
    const out = j - 1 - s.t;
    let leg = 0;
    for (const l of proj.legs) if (l.startK <= j - s.t) leg = l.i;
    return { seasons: Math.max(1, out, roadSeasons(agent, route)), settled: true, at: played[j], out, leg };
  }
  return { seasons: proj.seasons, settled: false };
}

/** The wage for the whole trip, at the agent's wage, for the seasons `wageCount` says. */
const tripWage = (agent, count) => count.seasons * (agent.wage ?? 0);

/** What the house would pay up front for `agentId` on `routeId`, in coins, or 0 when the road does not project. */
export function prepayCost(state, content, routeId, agentId) {
  const route = routeOf(content, routeId), agent = agentOf(content, agentId);
  const proj = route && agent ? project(state, content, route, agent) : null;
  return proj?.ok ? tripWage(agent, wageCount(state, content, route, agent, proj)) : 0;
}

/** Checks `plan` against `s` and, when it holds, applies it to `s` (a clone). Returns
    { problems, warnings }; `s` is changed only when there are no problems. */
function build(s, content, plan) {
  const problems = [], warnings = [];
  const city = cityOf(content, 'outfit');
  const home = homeOf(content);
  const homeName = stopName(content, home);
  const no = msg => { problems.push(msg); };

  if (s.phase !== 'desk') no('You can send people out only while the desk is open.');
  if (!plan || typeof plan !== 'object') return { problems: ['There is no plan to send.'], warnings, cost: null };

  // who goes
  const agent = plan.agent ? agentOf(content, plan.agent) : null;
  const rec = agent && s.agents[agent.id];
  if (!plan.agent) no('Choose who goes.');
  else if (!agent) no(`There is no one called "${plan.agent}" in the house's books.`);
  else if (!rec.hired) no(`${agent.name} does not work for the house.`);
  else if (rec.where === 'road' || s.expeditions.some(x => x.agent === agent.id)) no(`${agent.name} is already on the road.`);
  else if (rec.where !== home) no(`${agent.name} is not in ${homeName}.`);
  else { const leaving = refusesAny(s, agent); if (leaving) no(leaving); }

  // where
  const route = plan.route ? routeOf(content, plan.route) : null;
  let proj = null;
  if (!plan.route) no('Choose where the expedition goes.');
  else if (!route) no(`There is no road called "${plan.route}".`);
  else {
    proj = project(s, content, route, agent);
    if (!proj.ok) no(proj.why);
    else warnings.push(...proj.warnings);
  }
  const dest = route ? stopOf(content, route.to) : null;

  // what they carry
  const cargo = {}, purse = plan.purse ?? 0;
  if (!isCount(purse)) no(`${purse} is not an amount of money to send.`);
  for (const [g, n] of Object.entries(plan.cargo ?? {})) {
    if (!goodOf(content, g)) { no(`There is no good called "${g}".`); continue; }
    if (!isCount(n)) { no(`${n} is not a number of ${goodOf(content, g).unit}s.`); continue; }
    if (n > 0) cargo[g] = n;
  }
  if (!problems.length && !Object.keys(cargo).length && !purse) no(`Send some goods or some ${city.currency ?? 'money'}, or the journey is for nothing.`);

  // the part bought now, at the home price, and what it costs
  const sim = { ...s, market: structuredClone(s.market) };
  let buyCost = 0, stockValue = 0;
  const taken = {}, goodsCost = [];
  for (const [g, n] of Object.entries(cargo)) {
    const have = s.stock[g] ?? 0;
    const fromStock = Math.min(have, n);
    const need = n - fromStock;
    taken[g] = fromStock;
    stockValue += fromStock * (M.truePrice(s, content, home, g) ?? 0);
    let spent = 0;
    if (need > 0) {
      if (!s.market[home]?.[g]) { no(`The house has ${have ? `only ${have}` : 'none'} in the warehouse and ${homeName} does not sell ${goodName(content, g)}.`); continue; }
      for (let i = 0; i < need; i++) { spent += M.buyPrice(sim, content, home, g); M.notePurchase(sim, content, home, g, 1); }
    }
    buyCost += spent;
    goodsCost.push({ good: g, loads: n, fromWarehouse: fromStock, bought: need, cost: spent });
  }

  // the contract
  let kind = plan.contract ?? 'own', partners = 0, share = null;
  if (typeof kind === 'object') { partners = kind.partners ?? 0; kind = kind.kind; }
  partners = plan.partners ?? partners;
  if (kind !== 'own' && kind !== 'qirad') no(`There is no contract called "${kind}".`);
  if (kind === 'qirad') {
    share = city.contracts?.qirad?.agentShare;
    if (!share) no(`A qirad is not an option in ${city.name ?? 'this city'}.`);
    else if (!isCount(partners) || partners < 1) no('A qirad needs partners who put in some money. Say how much.');
    else if (partners > purse + buyCost) no(`The partners cannot put in more than the ${coins(content, purse + buyCost)} that goes out in money and bought goods.`);
  } else partners = 0;
  // the way back for an agent who will not go on a wage again, in a city with no qirad: the house pays the trip's wage now (ARCH 4.11)
  const prepay = kind === 'own' && plan.prepay === true;
  const wants = agent && kind === 'own' ? refusesOwn(s, agent, !!city.contracts?.qirad?.agentShare) : null;
  if (wants && !(prepay && canPrepay(city))) no(wants);
  else if (prepay && agent && !wants) no(`${agent.name} has no reason to ask for the wage first.`);
  const wagePaid = prepay && proj?.ok ? tripWage(agent, wageCount(s, content, route, agent, proj)) : 0;

  // selling and buying at the far end
  const carried = new Set(Object.keys(cargo));
  const sell = plan.sell ?? (dest ? Object.keys(cargo).filter(g => dest.sells?.[g]) : []);
  const buy = plan.buy ?? [];
  if (dest) {
    for (const g of sell) {
      if (!goodOf(content, g)) no(`There is no good called "${g}".`);
      else if (!carried.has(g)) no(`${agent?.name ?? 'The agent'} is not carrying any ${goodName(content, g)} to sell.`);
      else if (!dest.sells?.[g]) no(`${dest.name} does not trade in ${goodName(content, g)}.`);
    }
    for (const g of buy) {
      if (!goodOf(content, g)) no(`There is no good called "${g}".`);
      else if (!dest.sells?.[g]) no(`${dest.name} has no ${goodName(content, g)} to buy.`);
    }
    // money sent to buy with, and nothing named to bring back: it would come home unspent (DESIGN 2.2 rule 1, M4 play finding 8).
    // Refused only where the stop has a good the house could name; a stop with nothing the house trades at home leaves the
    // plan alone, because no default can be offered there (the fixtures' Hilltown; no stop of the data is like it, test/venture.mjs).
    if (RULES.refuseUnspentMoney && isCount(purse) && purse > 0 && !buy.length && !problems.length) {
      const best = bringBack(s, content, dest, [...carried]);
      if (best) no(`Money sent to buy with needs a good to bring back, and none is named. ${cap(goodName(content, best.good))} is the best known one from ${dest.name}: name it, or send no money.`);
    }
  }

  // money: the one sum the sheet shows and the apply below takes (MER-72). `now` is charged at Send;
  // `later` is what the road will cost, from the purse and the cargo (tolls) and at the return (wage),
  // as far as the plan can know it.
  const houseMoney = buyCost + purse - partners + wagePaid;
  const cost = {
    goods: goodsCost, bought: buyCost, purse: isCount(purse) ? purse : 0, partners, wagePaid, total: houseMoney,
    later: route && proj?.ok ? {
      tolls: route.legs.reduce((n, l) => n + (l.toll ?? 0), 0),
      wage: kind === 'own' && !prepay && agent ? proj.seasons * (agent.wage ?? 0) : 0,
      wagePerSeason: agent?.wage ?? 0,
    } : null,
  };
  if (!problems.length && s.money < houseMoney) no(`The house has ${coins(content, s.money)} and this costs ${coins(content, houseMoney)}${wagePaid ? `, with ${coins(content, wagePaid)} of it ${agent.name}'s wage paid first` : ''}.`);
  if (problems.length) return { problems, warnings, cost };
  const hope = estimate(s, content, { ...plan, sell: [...sell], buy: [...buy], purse, contract: kind, partners, prepay });

  // apply
  for (const [g, n] of Object.entries(taken)) addStock(s, g, -n);
  s.market = sim.market;
  s.money -= houseMoney;
  const n = (s.seen['#x'] = (s.seen['#x'] ?? 0) + 1);
  const first = proj.legs[0];
  const idx = seasonIndex(s, content);
  const x = {
    id: `x${n}`, agent: agent.id, route: route.id, leg: 0, left: legSeasons(agent, route.legs[0]), waiting: 0, status: first.waits ? 'waiting' : 'out',
    cargo, purse,
    contract: kind === 'qirad' ? { kind, agentShare: share[0], of: share[1] } : prepay ? { kind, prepaid: true } : { kind },
    staked: { house: stockValue + buyCost + purse - partners, partners },
    orders: [], sent: idx, out: 0, start: first.startIdx,
    plan: { sell: [...sell], buy: [...buy] },
    ...(hope ? { hoped: hope.net, hope: { net: hope.net, sell: hope.pricesSell, buy: hope.pricesBuy, home: hope.pricesHome, tolls: hope.tolls, ageWords: hope.ageWords, impact: hope.impact, glut: hope.glut } } : {}),
    quote: Object.fromEntries(Object.keys(dest.sells ?? {}).map(g => [g, M.truePrice(s, content, route.to, g)])),
    book: { cargo: { ...cargo }, purse, capital: stockValue + buyCost + purse, ...(wagePaid ? { wagePaid } : {}), sold: [], bought: [], tolls: 0, upkeep: 0, paidInGoods: {}, seen: [] },
  };
  s.expeditions.push(x);
  rec.where = 'road';
  rec.trips = (rec.trips ?? 0) + 1;   // a trip for the house: the score counts a person home only if they made one (MER-86)
  s.log.push({ at: idx, kind: 'outfit', ref: x.id, choice: route.id });
  return { problems, warnings, cost, hope };
}

/** The same check `outfit` makes, without sending: { ok, reasons, warnings, cost }. `cost.total` is
    the dinars `outfit` takes from the house, from the same pass (MER-72); `cost.goods` lists each
    good ({ good, loads, fromWarehouse, bought, cost }), `cost.purse`, `cost.partners` (what the
    partners put in, which the house does not pay) and `cost.wagePaid` make up the rest; `cost.later`
    is { tolls, wage, wagePerSeason } the road will take afterwards, or null when the road does not
    project. `cost` is null when the plan is too broken to price (no plan at all). `estimate` is `estimate`'s answer for a
    plan that holds (below), null for one that does not. */
export function checkPlan(state, content, plan) {
  const { problems, warnings, cost, hope } = build(structuredClone(state), content, plan);
  return { ok: problems.length === 0, reasons: problems, warnings, cost, estimate: problems.length ? null : hope ?? null };
}

/** Sends an expedition, or throws with every reason the plan was refused, in words. */
export function outfit(state, content, plan) {
  const s = structuredClone(state);
  const { problems } = build(s, content, plan);
  if (problems.length) {
    const err = new Error(`outfit: ${problems.join(' ')}`);
    err.reasons = problems;
    throw err;
  }
  return s;
}

/** A complete, valid plan for the one-press first expedition (DESIGN 4.8): the first free agent
    (one who knows the stop first), the best open route, half of a good the house holds that the
    stop trades, no money sent, the house's own contract. Null when nothing fits. */
export function suggestPlan(state, content, stopId) {
  const home = homeOf(content);
  const stop = stopOf(content, stopId);
  if (!stop || stopId === home) return null;
  const hasQirad = !!cityOf(content, 'outfit').contracts?.qirad?.agentShare;
  const free = (content.agents ?? []).filter(a => {
    const r = state.agents[a.id];
    return r?.hired && r.where === home && !state.expeditions.some(x => x.agent === a.id);
  });
  if (!free.length) return null;
  const tryAgent = agent => {
    const hit = routeFor(state, content, stopId, agent);
    if (!hit) return null;
    const homePrice = g => state.known[home]?.[g]?.p ?? M.truePrice(state, content, home, g) ?? 0;
    const there = g => state.known[stopId]?.[g]?.p ?? null;
    const goods = Object.keys(state.stock).filter(g => stop.sells?.[g] && state.stock[g] > 0)
      .sort((a, b) => ((there(b) ?? 0) - homePrice(b)) - ((there(a) ?? 0) - homePrice(a)) || state.stock[b] - state.stock[a] || (a < b ? -1 : 1));
    if (!goods.length) return null;
    const g = goods[0];
    const load = Math.max(1, Math.floor(state.stock[g] / 2));
    // buy back the good that is cheaper there than at home by what the house knows
    const back = Object.keys(stop.sells).filter(b => b !== g && there(b) !== null && state.known[home]?.[b] && there(b) < homePrice(b))
      .sort((a, b) => (homePrice(b) - there(b)) - (homePrice(a) - there(a)) || (a < b ? -1 : 1));
    const plan = { agent: agent.id, route: hit.route.id, cargo: { [g]: load }, purse: 0, contract: 'own', sell: [g], buy: back.slice(0, 1) };
    // an agent who will not go for a wage again is offered a qirad: partners put in a small purse and the house sends no money;
    // a city with no qirad has none to offer, so the agent is passed over for the next (MER-103)
    if (refusesOwn(state, agent, hasQirad)) {
      if (!hasQirad) return null;
      const stake = Math.max(1, Math.min(QIRAD_STAKE, Math.floor(state.money / 5)));
      Object.assign(plan, { contract: 'qirad', partners: stake, purse: stake });
    }
    return build(structuredClone(state), content, plan).problems.length ? null : plan;
  };
  // one who knows the stop first; an agent who refuses (a wage again, or a house they are leaving) is passed over for the next
  const order = [...free.filter(a => a.traits.includes(`knows-${stopId}`)), ...free.filter(a => !a.traits.includes(`knows-${stopId}`))];
  for (const agent of order) { const plan = tryAgent(agent); if (plan) return plan; }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ventures (DESIGN 2.2): the default plan for a road, what it should fetch, and what the news says is worth doing

export const DEPTH_SHARE = 0.5;   // a default plan trades no more than this share of a market's depth in one good, which would move the price against it
export const RISK_WORDS = [[0.10, 'safe'], [0.25, 'uncertain'], [0.45, 'risky'], [Infinity, 'dangerous']];   // by the chance of some loss on the whole road

/** The chance that something goes wrong somewhere on `route`, there and back: each season ridden is rolled once (`risk`). */
export function roadRisk(content, agent, route, startIdx) {
  return 1 - route.legs.reduce((k, l) => k * Math.pow(1 - legRisk(content, agent, l, startIdx), l.seasons), 1);
}
/** The one word for a chance of loss on a road: safe, uncertain, risky or dangerous. */
export const riskWord = p => RISK_WORDS.find(([top]) => p < top)[1];

/** What the house expects `good` to fetch at `stop`, from its news: { p, age, ageWords } or null with none. */
function farPrice(s, content, stop, good) {
  const e = M.expectedPrice(s, content, stop, good);
  return e ? { p: e.p, age: e.age, ageWords: M.ageWords(e.age) } : null;
}

/** The good the house would bring home from `dest`: the first trade `bestTrades` keeps for this road in the direction `back`
    (`trades` is its list for the road, best a season first), which counts the loads the road's markets take, each priced after the
    one before it with the house's own buying in it, and how fresh the news is. Not the widest price ratio: that picks a good whose
    margin the house's own buying eats (MER-112b). Not one in `except`. Where the map keeps none (a margin too thin to pay the
    tolls and the wage alone, or no news), the old pick: the widest price ratio above 1, goods with news before guesses, then the
    best ratio there is, so a trip that sends money still has a good to name. Null when the stop sells nothing the home market
    trades. { good, there, home, ratio, age, ageWords, guess } */
function bringBack(s, content, dest, except = [], trades = []) {
  const home = homeOf(content);
  const t = trades.find(r => r.direction === 'back' && r.stop === dest.id && !except.includes(r.good));
  if (t) return { good: t.good, there: t.there, home: t.here, ratio: t.here / t.there, age: t.age, ageWords: t.ageWords, guess: false };
  const rows = [];
  for (const b of Object.keys(dest.sells ?? {})) {
    if (except.includes(b)) continue;
    const homeP = M.truePrice(s, content, home, b);
    if (homeP === null) continue;
    const far = farPrice(s, content, dest.id, b);
    const there = far ? far.p : M.baseOf(s, content, dest.id, b);
    if (!there) continue;
    rows.push({ good: b, there, home: homeP, ratio: homeP / there, age: far ? far.age : null, ageWords: far ? far.ageWords : 'no news', guess: !far });
  }
  const widest = list => list.sort((a, b) => b.ratio - a.ratio || (a.good < b.good ? -1 : 1))[0] ?? null;
  return widest(rows.filter(r => !r.guess && r.ratio > 1)) ?? widest(rows.filter(r => r.ratio > 1)) ?? widest(rows.filter(r => !r.guess)) ?? widest(rows);
}

/** The venture DESIGN 2.2 rule 1 proposes for `agent` on `route`: the house's goods that sell better at the far end, goods
    bought now at home with about half the money on hand (the goods that sell best there by the house's news), and one good
    to bring back, the best known margin; the money left after selling there buys it. A trip whose far stop buys nothing the
    house can send goes as money alone, about half the money on hand, to buy that good. Own contract, or a qirad when the
    agent will not go for a wage again. `agent` and `route` are ids or records. A plan the engine takes, or null when none is;
    `check: false` skips that last check against the whole state (a caller that prices many roads and sends one checks the one);
    `share` is the part of the money on hand the plan spends (a half, as the sheet opens; a bot that wants a bigger stake says so). */
export function proposePlan(state, content, agent, route, { check = true, share = 0.5 } = {}) {
  const a = typeof agent === 'string' ? agentOf(content, agent) : agent;
  const r = typeof route === 'string' ? routeOf(content, route) : route;
  const dest = r ? stopOf(content, r.to) : null;
  if (!a || !r || !dest) return null;
  const home = homeOf(content);
  const homeStop = stopOf(content, home);
  if (!project(state, content, r, a).ok) return null;
  const homeP = g => M.truePrice(state, content, home, g);
  // goods that sell better at the far end than at home, widest margin first
  // (a good the house has no news of is guessed at the stop's base price, and the estimate says so)
  // the trades the map names for this road (best a season first) come before the rest, so the stake reaches the best one
  // before the wider margins on thin markets have spent it (MER-112)
  const known = bestTrades(state, content, Infinity, r.id);
  const rank = g => { const i = known.findIndex(t => t.direction === 'out' && t.good === g); return i < 0 ? Infinity : i; };
  const out = Object.keys(dest.sells ?? {}).map(g => ({ g, far: farPrice(state, content, dest.id, g) ?? { p: M.baseOf(state, content, dest.id, g) }, at: homeP(g) }))
    .filter(e => e.far && e.at !== null && e.far.p > e.at)
    .sort((x, y) => rank(x.g) - rank(y.g) || y.far.p / y.at - x.far.p / x.at || (x.g < y.g ? -1 : 1));
  const carried = out.map(e => e.g);
  const back = bringBack(state, content, dest, carried, known);
  const budget = Math.floor(state.money * share);
  const cargo = {};
  // buying now at home moves the home price: price each load after the one before it
  const sim = { ...state, market: { [home]: structuredClone(state.market[home]) } };
  let left = budget;
  for (const e of out) {
    const cap = Math.max(1, Math.ceil(Math.min(homeStop.sells?.[e.g]?.depth ?? Infinity, dest.sells[e.g].depth) * DEPTH_SHARE));
    const held = Math.min(state.stock[e.g] ?? 0, cap);
    let n = held;
    while (n < cap) {
      const p = M.buyPrice(sim, content, home, e.g);
      if (p > left) break;
      left -= p; n++;
      M.notePurchase(sim, content, home, e.g, 1);
    }
    if (n) cargo[e.g] = n;
  }
  // money alone, when no good goes out: to buy the good that is the whole point of the trip
  let purseOnly = 0;
  if (back) {
    const cap = Math.max(1, Math.ceil(dest.sells[back.good].depth * DEPTH_SHARE));
    purseOnly = Math.min(budget, Math.ceil(cap * back.there * 1.15));
  }
  // a qirad only where the city has one; where it has none, an agent who refuses a wage gets no plan, and the words say why (MER-103)
  const hasQirad = !!cityOf(content, 'outfit').contracts?.qirad?.agentShare;
  const refused = refusesOwn(state, a, hasQirad);
  const qirad = hasQirad && !!refused;
  const stake = Math.max(1, Math.min(QIRAD_STAKE, Math.floor(state.money / 5)));
  /** The plan that carries `loads` out, brings `back` home when `fetch` is set, and sends `money` to buy it with. */
  const shape = (loads, fetch, money) => {
    const buy = fetch && back ? [back.good] : [];
    const p = { agent: a.id, route: r.id, cargo: loads, purse: buy.length ? money : 0, contract: 'own', sell: Object.keys(loads).filter(g => dest.sells?.[g]), buy };
    if (qirad) Object.assign(p, { contract: 'qirad', partners: buy.length ? stake : 0, purse: buy.length ? Math.max(money, stake) : 0 });
    return p;
  };
  const memo = new Map();   // the far markets carried to arrival, once for all the plans priced here (state does not change inside this call)
  const worth = p => estimate(state, content, p, memo)?.net ?? -Infinity;
  // DESIGN 2.2 rule 1 (MER-98): only a plan that pays. Each good goes out only if it adds to the estimate after tolls, in the
  // size that adds most (a bigger load sells lower and buys dearer, so the most loads is not always the most money), and the
  // bring-back good is kept only if it adds; otherwise the plan brings nothing back and sends no purse.
  const sizes = n => [...new Set([0, Math.ceil(n / 3), Math.ceil(n * 2 / 3), n])];
  let loads = { ...cargo }, fetch = true, top = worth(shape(loads, true, 0));
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    if (back) {   // the bring-back good stays only while it adds (a tie drops it: no purse, nothing to carry back)
      const w = worth(shape(loads, !fetch, 0));
      if (w > top || (w === top && fetch)) { top = w; fetch = !fetch; moved = true; }
    }
    for (const g of Object.keys(cargo)) {
      for (const n of sizes(cargo[g])) {
        if (n === (loads[g] ?? 0)) continue;
        const trial = { ...loads, [g]: n };
        if (!n) delete trial[g];
        for (const f of back ? [true, false] : [false]) {
          const w = worth(shape(trial, f, 0));
          if (w > top || (w === top && n < (loads[g] ?? 0) && f === fetch)) { top = w; loads = trial; fetch = f; moved = true; }
        }
      }
    }
    if (!moved) break;
  }
  let best = { loads, fetch, money: 0, net: top };
  if (back) {
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const money = Math.floor(purseOnly * f);
      const w = worth(shape({}, true, money));
      if (money && w > best.net) best = { loads: {}, fetch: true, money, net: w };
    }
  }
  const nothing = why => ({ ...shape({}, false, 0), why });
  if (refused && !hasQirad) return nothing(refused);
  const empty = !Object.keys(best.loads).length && !best.money;
  if (empty || best.net <= 0) {
    const result = !Number.isFinite(best.net) ? '' : best.net < 0 ? `: the best one would lose about ${coins(content, -best.net)} after the tolls and the wage` : ': the best one would only break even';
    return nothing(empty && !Object.keys(cargo).length && !back
      ? `${dest.name} buys nothing the house sells and sells nothing the house wants at home.`
      : `No plan the house knows of pays on the road to ${dest.name}${result}.`);
  }
  const base = shape(best.loads, best.fetch, best.money);
  if (!check) return base;
  // shrink until the engine takes it (money, wage, rules in words), as the outfit sheet would, and the estimate still pays
  for (const f of [1, 0.7, 0.5, 0.35, 0.25, 0.15]) {
    const loadsNow = Object.fromEntries(Object.entries(best.loads).map(([g, n]) => [g, Math.floor(n * f)]).filter(([, n]) => n > 0));
    const p = shape(loadsNow, best.fetch, Math.floor(best.money * f));
    if (p.contract === 'qirad') p.partners = Math.max(0, Math.min(p.partners, p.purse + 1));
    if (!Object.keys(p.cargo).length && !p.purse) continue;
    if (worth(p) <= 0) continue;
    if (build(structuredClone(state), content, p).problems.length === 0) return p;
  }
  return nothing(`The house cannot fit out a plan that pays on the road to ${dest.name} with what it has.`);
}

/** A market of one good at one stop, to run the house's own loads through market.js: the price is `p` now with the house's own
    mark `glut` on it (so the factor is whatever puts `p` there). `noteSale`, `notePurchase`, `sellPrice` and `buyPrice` then
    move and read it by the rule the trade itself uses, caps included, so no price rule is written out a second time here. */
function marketAt(s, content, stop, good, p, glut = 0) {
  const base = M.baseOf(s, content, stop, good);
  return { t: s.t, length: s.length, seed: s.seed, market: { [stop]: { [good]: { f: p / (base * (1 - glut)), glut, h: [] } } } };   // only what market.js reads
}

/** `content` cut to one good with its noise switched off, so market.js's `drift` carries a price along the way it expects to go
    (the factor pulled back toward its base, the mark halved) and not along the way the seed will send it, which the house cannot
    know. One good, so `drift` does not walk the whole list each season it is run. */
const calm = new WeakMap();
function quiet(content, good) {
  const byGood = calm.get(content) ?? calm.set(content, new Map()).get(content);
  if (!byGood.has(good)) byGood.set(good, { ...content, goods: (content.goods ?? []).filter(g => g.id === good).map(g => ({ ...g, sigma: 0 })) });
  return byGood.get(good);
}

/** The far market as a party that trades there `closings` seasons from now will find it, from what the house knows. The news price
    was written with the house's own mark on it as it stood in the season the news is dated, so the market is rebuilt as of that
    season with that mark (the house knows its own trades: the mark it has now, doubled for each closing since, as `drift` halves
    it; a trade of its own since the news would make that too large, and nothing the house keeps says when it was), and `drift`
    carries it, noise off, through the closings since and the closings still to come. With no news the price is the stop's base
    price now, marked as it is now. `m` is a market of that one good for `saleRevenue` and `buyRun`; `free` is the price before the
    house's mark when the party arrives (what the gap's "news" is measured against), `glut` the mark it finds, and `age` the
    seasons the news is old (null with none). */
function farMarket(s, content, stop, good, closings) {
  const now = s.market[stop]?.[good]?.glut ?? 0;
  const k = s.known[stop]?.[good], played = playedSeasons(content.calendar, s.length);
  const at = k ? played.indexOf(k.at) : -1;
  const since = k ? Math.min(s.t, at >= 0 ? s.t - at : Math.max(0, seasonIndex(s, content) - k.at)) : 0;   // closings between the news and now
  const t0 = s.t - since;
  const mark = k ? clamp(Math.round(now * Math.pow(2, since) * 1e4) / 1e4, M.GLUT_MIN, M.GLUT_MAX) : now;
  const seed = { t: t0, length: s.length };
  const sim = marketAt(seed, content, stop, good, k ? k.p : M.baseOf(seed, content, stop, good), mark);
  const world = quiet(content, good);
  for (let i = 0; i < since + Math.max(0, closings) && sim.t + 1 < played.length; i++) { M.drift(sim, world); sim.t += 1; }
  const m = sim.market[stop][good];
  return { m: sim, free: Math.max(1, Math.round(M.baseOf(sim, content, stop, good) * m.f)), glut: m.glut, age: k ? Math.max(0, seasonIndex(s, content) - k.at) : null };
}

/** What `n` more loads of a good fetch from a market `m` (from marketAt) for an agent who gets `cut` of it: each load is priced
    after the one before it, as `tradeAt` sells them, so the last loads fetch least. `m` ends up with the loads sold. */
const saleRevenue = (m, content, stop, good, cut, n) => {
  let got = 0;
  for (let k = 0; k < n; k++) { got += Math.round(M.sellPrice(m, content, stop, good) * cut); M.noteSale(m, content, stop, good, 1); }
  return got;
};

/** How many loads `budget` buys from market `m` (from marketAt), each priced after the one before it as `tradeAt` buys them,
    and what they cost: { q, spent }. `m` ends up with the loads bought. */
function buyRun(m, content, stop, good, cut, budget) {
  let spent = 0, q = 0;
  for (;;) {
    const price = Math.max(1, Math.round(M.buyPrice(m, content, stop, good) * cut));
    if (spent + price > budget) return { q, spent };
    spent += price; q++;
    M.notePurchase(m, content, stop, good, 1);
  }
}

/** Loads of each good in `cargo` with their price at home now, the part drawn from the warehouse and the part to buy:
    { stockValue, buyCost, market }, the second priced load by load as `build` prices it, `market` home's market once it is bought
    (what `build` leaves there). */
function homeStake(s, content, cargo) {
  const home = homeOf(content);
  const sim = { ...s, market: { [home]: structuredClone(s.market[home]) } };   // only home's prices move here
  let stockValue = 0, buyCost = 0;
  for (const [g, n] of Object.entries(cargo)) {
    const fromStock = Math.min(s.stock[g] ?? 0, n);
    stockValue += fromStock * (M.truePrice(s, content, home, g) ?? 0);
    for (let i = fromStock; i < n; i++) { buyCost += M.buyPrice(sim, content, home, g); M.notePurchase(sim, content, home, g, 1); }
  }
  return { stockValue, buyCost, market: sim.market[home] };
}

/** What the house's own market at home will fetch for `good` when a party back `closings` closings from now sells or values it:
    the market as it is now with the house's own buying of this plan's cargo in it (`market`; the house sees home's price and its own mark on it), carried through the closings by market.js's
    `drift` with the noise off, the way `farMarket` carries a far one. A price event cannot be foreseen and is not in it. Null where
    home does not trade the good. Past the calendar's last season the price stays where it got to. A road that comes home across a
    jump into the next act is valued as `jump` values it:
    the closing into the next act is the jump, which settles every party still out at home's price as it stands after that closing
    (`jump` resets the markets after it), so the carry stops there. */
function homePriceAt(s, content, good, closings, market = s.market[homeOf(content)]) {
  const home = homeOf(content), e = market?.[good];
  if (!e) return null;
  const played = playedSeasons(content.calendar, s.length);
  const sim = { t: s.t, length: s.length, seed: s.seed, market: { [home]: { [good]: { f: e.f, glut: e.glut, h: [] } } } };
  const world = quiet(content, good);
  for (let i = 0; i < Math.max(0, closings) && sim.t + 1 < played.length; i++) {
    const was = actOfSeason(content.calendar, s.length, played[sim.t]);
    M.drift(sim, world); sim.t += 1;
    if (actOfSeason(content.calendar, s.length, played[sim.t]) !== was) break;
  }
  const m = sim.market[home][good], base = M.baseOf(sim, content, home, good);
  return Math.max(1, Math.round(base * m.f * (1 - m.glut)));
}

/** What `plan` should make for the house, from the prices the house knows and no others: goods sold at the far end at the
    price its news gives, taken to the season of arrival (the house's own mark on that price as it stood when the news was
    written, halved at each closing since, and the factor pulled back toward its base, with no noise: `farMarket`), each load a
    little lower than the one before as the market takes it, the money bought back goods at the far end (each a little dearer),
    those goods valued at the home price the party will find on its return (`homePriceAt`: today's price and the house's mark on it carried to the season the paper opens, noise off), less every toll, the waiting a closed leg costs, the wage, and the qirad's shares.
    It ignores what the road may take (that is `riskWord`'s warning) and the noise a price will add. Reads the state's `known`
    and the house's own mark, never the true far market. `pricesSell` and `pricesBuy` are the prices expected at arrival before
    the house's mark, `glut` the mark expected on each, `impact` what the house's own loads cost against the marked first price.
    { net, gross, stake, tolls, wage, upkeep, shares, seasons, age, ageWords, risk, riskWord, line, ... } or null when the plan names no
    road or agent that holds. `net` is the dinars the house ends up ahead, after its own stake (the number the return
    paper's "hoped" is kept as). `memo` is a Map a caller that prices many plans on one unchanged state (`proposePlan`) passes
    so the far markets are carried to arrival once, not once a plan. */
export function estimate(state, content, plan, memo = null) {
  if (!plan || typeof plan !== 'object') return null;
  const agent = agentOf(content, plan.agent), route = routeOf(content, plan.route);
  if (!agent || !route) return null;
  const proj = project(state, content, route, agent);
  if (!proj.ok) return null;
  const dest = stopOf(content, route.to), home = homeOf(content);
  const cargo = Object.fromEntries(Object.entries(plan.cargo ?? {}).filter(([g, n]) => goodOf(content, g) && n > 0));
  const purse = isCount(plan.purse) ? plan.purse : 0;
  const kind = (typeof plan.contract === 'object' ? plan.contract?.kind : plan.contract) ?? 'own';
  const partners = kind === 'qirad' ? (plan.partners ?? plan.contract?.partners ?? 0) : 0;
  const sell = (plan.sell ?? Object.keys(cargo).filter(g => dest.sells?.[g])).filter(g => cargo[g] && dest.sells?.[g]);
  const buy = (plan.buy ?? []).filter(g => dest.sells?.[g]);
  const { stockValue, buyCost, market: homeAfter } = homeStake(state, content, cargo);
  const stakedHouse = stockValue + buyCost + purse - partners;
  const far = outEnd(route);
  let ages = [], guessed = false;
  // a road that cannot come home inside its act is settled by `jump` (MER-116): at the prices the party left with, if it has not
  // yet reached the far end when the act ends (a party past it traded in play, and only its way home is settled)
  const count = wageCount(state, content, route, agent, proj);
  const atQuote = count.settled && count.leg <= far;
  // at the far end: sell, then buy with the purse and the proceeds, less the tolls that came first
  const tollsBefore = route.legs.slice(0, atQuote ? count.leg : far).reduce((n, l) => n + l.toll, 0);
  const tollsAll = route.legs.reduce((n, l) => n + l.toll, 0);
  const pricesSell = {}, pricesBuy = {}, pricesHome = {};
  const impact = {};   // dinars each good's price moved against the house's own loads there (what a flat price would have paid, less what the loads fetched)
  let money = purse - Math.min(purse, tollsBefore);
  const goodsBack = { ...cargo };
  // the far market as the party will find it, from the news and the house's own mark on it then, carried to the season of arrival
  // by market.js (`farMarket`); sales first, then purchases, as `tradeAt` does them
  const closings = proj.legs[far] ? proj.legs[far].startK + legSeasons(agent, route.legs[far]) - 1 : 0;
  const books = {};
  const bookOf = g => {
    if (!books[g]) {
      const key = `${dest.id}|${g}|${closings}`;
      let far = memo?.get(key);
      if (!far) { far = farMarket(state, content, dest.id, g, closings); memo?.set(key, far); }
      const e = far.m.market[dest.id][g];
      books[g] = { ...far, m: { ...far.m, market: { [dest.id]: { [g]: { ...e } } } } };   // the loads sold or bought move this copy, not the one kept
      if (books[g].age === null) guessed = true; else ages.push(books[g].age);
    }
    return books[g];
  };
  const glutOf = {};   // the mark the estimate expected on each price when the party arrives
  const quoted = g => M.truePrice(state, content, dest.id, g);   // `x.quote`: the far price today, no mark on it
  for (const g of sell) {
    if (atQuote) {
      const p = quoted(g), cut = bargain(agent, dest.id, 'sell');
      if (p === null || p === undefined) continue;
      pricesSell[g] = p; glutOf[g] = 0; impact[g] = 0; ages.push(0);
      money += cargo[g] * Math.round(p * cut);
      delete goodsBack[g];
      continue;
    }
    const b = bookOf(g), cut = bargain(agent, dest.id, 'sell');
    pricesSell[g] = b.free; glutOf[g] = b.glut;
    const first = Math.round(M.sellPrice(b.m, content, dest.id, g) * cut);
    const got = saleRevenue(b.m, content, dest.id, g, cut, cargo[g]);
    impact[g] = cargo[g] * first - got;
    money += got;
    delete goodsBack[g];
  }
  const live = buy.filter(g => atQuote ? quoted(g) : M.truePrice(state, content, home, g) !== null);
  live.forEach((g, i) => {
    if (atQuote) {
      const cut = bargain(agent, dest.id, 'buy'), p = Math.max(1, Math.round(quoted(g) * cut));
      const q = Math.floor(Math.floor(money / (live.length - i)) / p);
      pricesBuy[g] = quoted(g); glutOf[g] = 0; ages.push(0);
      if (q) { money -= q * p; goodsBack[g] = (goodsBack[g] ?? 0) + q; impact[g] = 0; }
      return;
    }
    const b = bookOf(g), cut = bargain(agent, dest.id, 'buy');
    pricesBuy[g] = b.free; glutOf[g] = b.glut;
    const first = Math.max(1, Math.round(M.buyPrice(b.m, content, dest.id, g) * cut));
    const { q, spent } = buyRun(b.m, content, dest.id, g, cut, Math.floor(money / (live.length - i)));
    money -= spent;
    if (q) { goodsBack[g] = (goodsBack[g] ?? 0) + q; impact[g] = spent - q * first; }
  });
  let goodsValue = 0;
  for (const [g, n] of Object.entries(goodsBack)) {
    const p = homePriceAt(state, content, g, proj.seasons, homeAfter) ?? 0;
    pricesHome[g] = p;
    goodsValue += n * p;
  }
  const upkeep = proj.waits * UPKEEP;
  // what the tolls took before the far end came out of the purse (money already net of it) or the cargo; the rest comes out of what is left
  const gross = money + goodsValue - (tollsAll - tollsBefore) - Math.max(0, tollsBefore - purse) - upkeep;
  const share = cityOf(content, 'expeditions').contracts?.qirad?.agentShare ?? [0, 1];
  const shares = split({ kind, agentShare: share[0], of: share[1] }, { house: stakedHouse, partners }, gross);
  const wage = kind === 'own' ? tripWage(agent, count) : 0;
  const net = shares.house - stakedHouse - wage;
  const age = ages.length ? Math.max(...ages) : null;
  const ageWords = guessed || age === null ? 'no news' : M.ageWords(age);
  const chance = roadRisk(content, agent, route, proj.legs[0]?.startIdx);
  const sign = net >= 0 ? '+' : '-';
  const old = guessed || age === null ? 'The house has no news of the prices there' : `The news of the prices is ${ageWords === 'this season' ? 'from this season' : ageWords}`;
  return {
    ok: true, net, gross, stake: stakedHouse, tolls: tollsAll, wage, upkeep, shares: { agent: shares.agent, partners: shares.partners }, seasons: proj.seasons, wageSeasons: count.seasons,
    settledAtJump: count.settled, ...(count.settled ? { jumpAt: count.at } : {}),
    age, ageWords, news: old, risk: chance, riskWord: riskWord(chance),
    line: `If prices hold: about ${sign}${commas(Math.abs(net))} ${cityOf(content, 'expeditions').currency ?? 'coins'}. ${old}; the road is ${riskWord(chance)}.`,
    pricesSell, pricesBuy, pricesHome, impact, glut: glutOf, back: goodsBack,
  };
}

export const NEWS_HALF_LIFE = 8;   // seasons: news this old is worth half of fresh news when trades are ranked

/** Dinars a plan of `n` loads of one good makes there and back before tolls and the wage, loads priced one after the other
    as the trades price them (market.js, through `marketAt`): bought at one end, sold (or, at home, valued) at the other.
    `out` is a good carried out (bought at home, sold at the far end); a good brought back is bought far and valued at home.
    { n, gain }: the loads, up to `cap`, that make the most. */
function bestLoads(s, content, out, home, far, cap) {
  const sold = out ? far : home, bought = out ? home : far;
  const sell = marketAt(s, content, sold.stop, sold.good, sold.p), buy = marketAt(s, content, bought.stop, bought.good, bought.p);
  let gain = 0, best = { n: 0, gain: 0 };
  for (let k = 0; k < cap; k++) {
    const margin = M.sellPrice(sell, content, sold.stop, sold.good) - M.buyPrice(buy, content, bought.stop, bought.good);
    if (margin <= 0) break;
    gain += margin;
    best = { n: k + 1, gain };
    M.noteSale(sell, content, sold.stop, sold.good, 1);
    M.notePurchase(buy, content, bought.stop, bought.good, 1);
  }
  return best;
}

/** The trades worth a road, for the map's "Best known trades" (DESIGN 2.2 rule 3, 4.7): a good that sells for more at the far
    end than at home (carry it out) or for less (bring it back), ranked by the dinars a season it should make (MER-98): the
    margin on the loads a plan could move (up to DEPTH_SHARE of the thinner market, each load priced as the last one moved the
    price), less the tolls and the wage, over the seasons out and back, and then by how old the news is, halved every
    NEWS_HALF_LIFE seasons. A road that cannot come home before the game ends is left out, and so is a trade that loses.
    Each row keeps its road, the age of the news in words and the road's risk word. `n` of them, or those of the one route `road` names; reads only what the house knows. */
export function bestTrades(state, content, n = 3, road = null) {
  const home = homeOf(content), homeStop = stopOf(content, home);
  const left = playedSeasons(content.calendar, state.length).length - 1 - state.t;
  const hired = (content.agents ?? []).filter(a => state.agents[a.id]?.hired);
  const wage = Math.min(...(hired.length ? hired : content.agents ?? []).map(a => a.wage ?? 0), Infinity);
  const rows = [];
  for (const d of destinations(state, content)) {
    if (d.seasons > left || (road && d.route !== road)) continue;
    const route = routeOf(content, d.route), dest = stopOf(content, d.stop);
    const chance = roadRisk(content, undefined, route, undefined);
    const fixed = route.legs.reduce((k, l) => k + l.toll, 0) + (Number.isFinite(wage) ? wage * d.seasons : 0);
    for (const g of Object.keys(dest.sells ?? {})) {
      const homeP = M.truePrice(state, content, home, g), far = farPrice(state, content, d.stop, g);
      if (homeP === null || !far || far.p === homeP || !homeStop.sells?.[g]) continue;
      const out = far.p > homeP;
      const margin = out ? far.p / homeP - 1 : homeP / far.p - 1;
      const depthHome = homeStop.sells[g].depth, depthFar = dest.sells[g].depth;
      const cap = Math.max(1, Math.ceil(Math.min(depthHome, depthFar) * DEPTH_SHARE));
      const { n: loads, gain } = bestLoads(state, content, out, { stop: home, good: g, p: homeP }, { stop: d.stop, good: g, p: far.p }, cap);
      const expected = gain - fixed, perSeason = expected / d.seasons;
      if (!loads || perSeason <= 0) continue;
      rows.push({
        stop: d.stop, name: dest.name, good: g, goodName: goodName(content, g), direction: out ? 'out' : 'back', here: homeP, there: far.p, margin,
        perLoad: Math.abs(far.p - homeP), loads, expected: Math.round(expected), perSeason: Math.round(perSeason * 10) / 10,
        score: perSeason * Math.pow(0.5, far.age / NEWS_HALF_LIFE),
        route: d.route, road: `${stopName(content, home)} to ${dest.name}`, seasons: d.seasons,
        age: far.age, ageWords: far.ageWords, risk: chance, riskWord: riskWord(chance),
        text: out ? `${dest.name} pays ${far.p} for ${goodName(content, g)}. ${stopName(content, home)} pays ${homeP}.` : `${dest.name} sells ${goodName(content, g)} at ${far.p}. ${stopName(content, home)} pays ${homeP}.`,
      });
    }
  }
  rows.sort((a, b) => b.score - a.score || b.margin - a.margin || (a.stop < b.stop ? -1 : a.stop > b.stop ? 1 : a.good < b.good ? -1 : 1));
  return rows.slice(0, n);
}

/** The outfit draft view() carries (DESIGN 2.2 rule 1): the road of the widest known margin that a free agent can ride now
    (an agent who knows the far stop first), with the default plan for it and its estimate, so the sheet opens filled and the
    line under Send is the engine's. { agent, route, stop, plan, estimate }, or null when the house has no news of a margin
    or nobody is free; the sheet then builds its draft from `proposePlan` for the stop the player picks. One plan is built
    here, not one for every road: `proposePlan` checks the plan against the whole state, which is not cheap. */
export function draftVenture(state, content, trades = bestTrades(state, content, 8)) {
  const home = homeOf(content);
  const free = (content.agents ?? []).filter(a => {
    const r = state.agents[a.id];
    return r?.hired && r.where === home && !state.expeditions.some(x => x.agent === a.id);
  });
  if (!free.length) return null;
  for (const t of trades) {
    const order = [...free.filter(a => a.traits?.includes(`knows-${t.stop}`)), ...free.filter(a => !a.traits?.includes(`knows-${t.stop}`))];
    for (const a of order) {
      const plan = proposePlan(state, content, a, t.route);
      if (plan && !plan.why) return { agent: a.id, route: t.route, stop: t.stop, plan, estimate: estimate(state, content, plan) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The closing steps

const seasonsHome = seasonsLeft;

/** Fills in what an expedition written before these fields existed (or by hand, in a test) lacks. */
function norm(x) {
  x.status ??= 'out';
  x.out ??= 0;
  x.plan ??= { sell: [], buy: [] };
  x.quote ??= {};
  x.book ??= { cargo: { ...x.cargo }, purse: x.purse ?? 0, capital: (x.staked?.house ?? 0) + (x.staked?.partners ?? 0), sold: [], bought: [], tolls: 0, upkeep: 0, paidInGoods: {}, seen: [] };
  x.contract ??= { kind: 'own' };
  x.staked ??= { house: 0, partners: 0 };
  return x;
}

/** Closing step "move": a season passes for every expedition that was already on its way. A
    leg's seasons count down; one that is waiting pays upkeep and starts when its leg opens. */
export function move(s, content) {
  const idx = seasonIndex(s, content);
  for (const x of s.expeditions) {
    norm(x);
    delete x.rode;
    if (!routeOf(content, x.route) || x.status === 'home' || x.sent === idx) continue;
    // an answer reaching the agent this season finds it here: kept for the paper that says so if the answer comes too late to act
    for (const o of x.orders ?? []) if (o.at !== undefined && o.at <= idx && !o.used && !o.place) o.place = placeOf(content, x);
    x.out += 1;
    if (x.status === 'out') {
      x.left -= 1;
      x.rode = { leg: x.leg, start: x.start };
      continue;
    }
    // waiting
    x.waiting += 1;
    x.book.upkeep += UPKEEP;
    const given = payFromExpedition(s, content, x, UPKEEP);
    for (const [g, q] of Object.entries(given)) x.book.paidInGoods[g] = (x.book.paidInGoods[g] ?? 0) + q;
    // held at a decision point by a careful agent: ask again, an answer may have come (letters.js)
    if (x.hold) {
      const go = decide(s, content, x, idx, { again: true });
      if (go === WAIT) continue;
      proceed(s, content, x, go, idx);
      continue;
    }
    startLeg(s, content, x, 1);
  }
}

/** What an expedition does at a decision point once `decide` has answered ON or HOME: ride the
    next leg, or turn back. Turning back is possible only on the way out (the next leg is still an
    out leg) and only if the road has a leg home from this stop; the goods the stop buys are sold
    here, the rest are carried home. */
function proceed(s, content, x, go, idx) {
  const route = routeOf(content, x.route);
  const stop = route.legs[x.leg].from, outbound = x.leg <= outEnd(route);
  if (go === HOME && outbound) {
    const back = route.legs.findIndex((l, i) => i > outEnd(route) && l.from === stop);
    if (back > 0) {
      tradeAt(s, content, x, stop, { sell: Object.keys(x.cargo), buy: [] }, idx);
      x.leg = back;
      x.book.turned = stop;
    }
  }
  // an answer that turns back an agent past the far end, or at a stop with no road home, did not act: the paper says which
  if (go === HOME && x.book.turned !== stop) { const o = (x.book.orders ?? []).at(-1); if (o?.go === HOME && o.stop === stop) o.beyond = !outbound; }
  startLeg(s, content, x, 1);
}

/** Starts leg x.leg if it is open `k` seasons ahead (the season after this one: k = 1). */
function startLeg(s, content, x, k) {
  const leg = routeOf(content, x.route).legs[x.leg];
  const o = legOpen(s, content, leg, k);
  if (o.open) { x.status = 'out'; x.left = legSeasons(agentOf(content, x.agent), leg); x.start = o.idx; }
  else x.status = 'waiting';
}

/** Closing step "risk": every expedition that rode this season is rolled once. */
export function risk(s, content) {
  const lost = [];
  for (const x of s.expeditions) {
    if (!x.rode || !routeOf(content, x.route)) continue;
    norm(x);
    const leg = routeOf(content, x.route).legs[x.rode.leg];
    const p = legRisk(content, agentOf(content, x.agent), leg, x.rode.start);
    if (next(s) >= p) continue;
    const loss = loseSome(s, content, x);
    x.book.lost = x.book.lost ?? {};
    for (const [g, n] of Object.entries(loss.cargo)) x.book.lost[g] = (x.book.lost[g] ?? 0) + n;
    put(s, lostPaper(s, content, x, loss, leg));
    if (!loss.whole) continue;
    // the vessel is gone: the agent is home or dead, the expedition is over
    const a = s.agents[x.agent];
    a.where = loss.survived ? homeOf(content) : 'dead';
    if (loss.survived && x.contract.kind === 'own' && !x.contract.prepaid) pay(s, content, (x.out + 1) * (agentOf(content, x.agent).wage ?? 0));   // away through this closing, as a return counts it (MER-88)
    lost.push(x.id);
    close(s, content, x, seasonIndex(s, content));
    s.log.push({ at: seasonIndex(s, content), kind: 'lost', ref: x.id, choice: loss.survived ? 'survived' : 'died' });
  }
  s.expeditions = s.expeditions.filter(x => !lost.includes(x.id));
}

/** Sells the goods the plan names and buys the ones it names with the money there, at the far
    end, through market.js with glut: each load is priced after the one before it. */
function tradeAtFar(s, content, x, route, idx) { tradeAt(s, content, x, route.to, x.plan, idx); }

/** The same at any stop, for `plan` = { sell, buy }: goods the stop does not trade stay in the cargo. */
function tradeAt(s, content, x, stop, plan, idx) {
  const agent = agentOf(content, x.agent);
  for (const g of plan.sell) {
    const q = x.cargo[g] ?? 0;
    if (!q || !s.market[stop]?.[g]) continue;
    bumpSeen(s, x, stop, g, M.sellPrice(s, content, stop, g), idx);
    let got = 0;
    for (let i = 0; i < q; i++) {
      got += Math.round(M.sellPrice(s, content, stop, g) * bargain(agent, stop, 'sell'));
      M.noteSale(s, content, stop, g, 1);
    }
    delete x.cargo[g];
    x.purse += got;
    x.book.sold.push({ good: g, q, got, stop });
  }
  const goods = plan.buy.filter(g => s.market[stop]?.[g]);
  goods.forEach((g, k) => {
    const budget = Math.floor(x.purse / (goods.length - k));
    bumpSeen(s, x, stop, g, M.buyPrice(s, content, stop, g), idx);
    let spent = 0, q = 0;
    for (;;) {
      const p = Math.max(1, Math.round(M.buyPrice(s, content, stop, g) * bargain(agent, stop, 'buy')));
      if (spent + p > budget) break;
      spent += p; q++;
      M.notePurchase(s, content, stop, g, 1);
    }
    if (q) {
      x.cargo[g] = (x.cargo[g] ?? 0) + q;
      x.purse -= spent;
      x.book.bought.push({ good: g, q, cost: spent, stop });
    }
  });
}
const bumpSeen = (s, x, stop, good, p, at) => x.book.seen.push({ stop, good, p, at, glut: s.market[stop]?.[good]?.glut ?? 0 });   // `glut` is the house's own mark on the price when it arrived (the return paper's "why")

/** Closing step "tolls": an expedition that finished a leg pays that leg's toll (from the purse,
    then from the cargo), trades if this is the far end, and starts the next leg or comes home. */
export function tolls(s, content) {
  const idx = seasonIndex(s, content);
  for (const x of s.expeditions) {
    if (!x.rode || !routeOf(content, x.route)) continue;
    norm(x);
    const rode = x.rode;
    delete x.rode;
    if (x.left > 0) continue;
    const route = routeOf(content, x.route);
    const leg = route.legs[rode.leg];
    // at the far end the goods are sold first, so the toll comes out of what they fetched
    if (rode.leg === outEnd(route)) tradeAtFar(s, content, x, route, idx);
    x.book.tolls += leg.toll;
    const given = payFromExpedition(s, content, x, leg.toll);
    for (const [g, q] of Object.entries(given)) x.book.paidInGoods[g] = (x.book.paidInGoods[g] ?? 0) + q;
    if (rode.leg === route.legs.length - 1) { x.status = 'home'; x.leg = route.legs.length; continue; }
    x.leg = rode.leg + 1;
    // an order from a letter, or the agent's trait until one comes (letters.js): wait a season here
    const go = decide(s, content, x, idx);
    if (go === WAIT) { x.status = 'waiting'; continue; }
    proceed(s, content, x, go, idx);
  }
}

// ---------------------------------------------------------------------------------------------
// Coming home, and the contract's split

/** The split of `value` (what came home, in coins) under a contract, in whole numbers that add
    up to `value`: { agent, partners, house }. An own contract gives all of it to the house (the
    agent's wage is a cost the house pays besides). A qirad gives the agent its share of a profit
    and nothing of a loss; what is left is split by stake, and the remainder goes to the house. */
export function split(contract, staked, value) {
  const capital = staked.house + staked.partners;
  if (contract.kind !== 'qirad' || capital <= 0) return { agent: 0, partners: 0, house: value };
  const profit = value - capital;
  const agent = profit > 0 ? Math.floor(profit * contract.agentShare / contract.of) : 0;
  const rest = value - agent;
  // the partners' share of what is left: their stake over the capital (a loss falls on them in proportion)
  const partners = Math.floor(rest * staked.partners / capital);
  return { agent, partners, house: rest - partners };
}

/** An expedition is home: its goods go to the warehouse, its money to the house, the shares are
    paid, the agent is at home. Returns the report the return paper and the interlude both use. */
function bringHome(s, content, x, { elapsed, at = null }) {
  const home = homeOf(content);
  const agentRec = s.agents[x.agent], agent = agentOf(content, x.agent), route = routeOf(content, x.route);
  // A party that was already home when the years passed is valued at home's price in the season it came home (`at`, from the
  // price history); one settled by quotes, and every trip that came home in its act, at the price as it stands now (MER-119).
  const homePrices = Object.fromEntries(Object.keys(x.cargo).map(g => [g, (at !== null ? M.priceAt(s, home, g, at) : null) ?? M.truePrice(s, content, home, g) ?? 0]));
  const cargoValue = Object.entries(x.cargo).reduce((v, [g, n]) => v + n * homePrices[g], 0);
  const value = x.purse + cargoValue;
  const shares = split(x.contract, x.staked, value);
  for (const [g, n] of Object.entries(x.cargo)) addStock(s, g, n);
  s.money += x.purse;
  const partnersShort = pay(s, content, shares.partners), agentShort = pay(s, content, shares.agent);
  const short = partnersShort + agentShort;
  // a prepaid wage was charged at outfitting: it is shown on the paper and counted against the house, and charged no more
  const wage = x.contract.kind !== 'own' ? 0 : x.contract.prepaid ? (x.book.wagePaid ?? 0) : elapsed * (agent.wage ?? 0);   // the wage is for the seasons the paper counts (MER-88)
  const wageShort = x.contract.prepaid ? 0 : pay(s, content, wage);
  if (short || wageShort) s.rep.partners = clamp(s.rep.partners - 1, -3, 3);
  returnTrust(s, content, x, { qirad: x.contract.kind === 'qirad', prepaid: !!x.contract.prepaid, agentShare: shares.agent, agentShort, wage, wageShort, lost: Object.keys(x.book.lost ?? {}).length > 0, since: x.sent }, seasonIndex(s, content));
  agentRec.where = home;
  for (const k of x.book.seen) bumpKnown(s, k.stop, k.good, k.p, k.at);
  const houseNet = shares.house - x.staked.house - wage;
  return { x, route, shares, value, cargoValue, homePrices, wage, houseNet, short: short + wageShort, elapsed, goodsBack: { ...x.cargo }, moneyBack: x.purse };
}

/** The five causes a trip makes less than its estimate said (DESIGN 2.2 rule 2), as dinars the house is short by each:
    news (the far price was not the price the news gave, and the home price moved), glut (the house's own earlier trade at that
    stop had marked the price), tolls (paid in goods that would have sold for more at the far end), loss (what the road took) and
    order (a letter's order changed the trip, and what no other cause explains). Reads what the expedition recorded at the
    far end (`book.seen`, with the glut it found) against what it hoped (`hope`). A negative number is a gain. */
export function gapCauses(s, content, x, r) {
  const hope = x.hope;
  if (!hope) return null;
  const agent = agentOf(content, x.agent), home = homeOf(content), book = x.book;
  const causes = { news: 0, glut: 0, own: 0, tolls: 0, loss: 0, order: 0 };
  const named = { news: null, glut: null, own: null, tolls: null, loss: null };   // the biggest single item of each, for the sentence
  const low = {};   // the biggest single gain of each (the most negative item)
  const note = (k, amount, item) => { causes[k] += amount; if (!named[k] || amount > named[k].amount) named[k] = { amount, ...item }; if (!low[k] || amount < low[k].amount) low[k] = { amount, ...item }; };
  const seenAt = (stop, g) => (book.seen ?? []).find(e => e.stop === stop && e.good === g);
  // the house's own loads moved the price against it (selling pushes it down, buying up): the dinars that cost, less what the
  // estimate allowed for (`hope.impact`), with the price before the first load and after the last for the sentence
  const ownMove = (e, seen, side, actual) => {
    const depth = stopOf(content, e.stop).sells?.[e.good]?.depth;
    if (!depth) return;
    const free = seen.p / (1 - (seen.glut ?? 0));
    const end = side === 'sell' ? Math.min(M.GLUT_MAX, (seen.glut ?? 0) + e.q / depth) : Math.max(M.GLUT_MIN, (seen.glut ?? 0) - e.q / depth);
    if (!hope.impact) return;   // a trip sent before the estimate recorded its own impact allowed for it all the same: no gap to name
    note('own', actual - (hope.impact[e.good] ?? 0), { stop: e.stop, good: e.good, side, q: e.q, from: seen.p, to: Math.max(1, Math.round(free * (1 - end))) });
  };
  // A price the party found is `free` before the house's own mark and `seen.p` with it. The estimate expected `pH` free and a
  // mark of `hope.glut` (an expedition that did not keep one expected the mark it found), so what it expected the first load to
  // fetch is pH * (1 - mark). The gap in that price splits into the news (free price against free price, at the mark expected)
  // and the mark beyond what was expected (MER-112b); selling is hurt by a bigger mark and buying by a smaller one.
  for (const e of book.sold ?? []) {
    const seen = seenAt(e.stop, e.good), pH = hope.sell?.[e.good];
    if (!seen || !pH) continue;
    const cut = bargain(agent, e.stop, 'sell');
    const free = seen.p / (1 - (seen.glut ?? 0)), mark = hope.glut?.[e.good] ?? seen.glut ?? 0;   // the price before the house's mark
    note('news', (pH - free) * (1 - mark) * e.q * cut, { stop: e.stop, good: e.good, side: 'sell', got: Math.round(free * (1 - mark)), hoped: Math.round(pH * (1 - mark)) });
    note('glut', free * ((seen.glut ?? 0) - mark) * e.q * cut, { stop: e.stop, good: e.good, side: 'sell' });
    ownMove(e, seen, 'sell', e.q * Math.round(seen.p * cut) - e.got);
  }
  for (const e of book.bought ?? []) {
    const seen = seenAt(e.stop, e.good), pH = hope.buy?.[e.good];
    if (!seen || !pH) continue;
    const cut = bargain(agent, e.stop, 'buy');
    const free = seen.p / (1 - (seen.glut ?? 0)), mark = hope.glut?.[e.good] ?? seen.glut ?? 0;
    note('news', (free - pH) * (1 - mark) * e.q * cut, { stop: e.stop, good: e.good, side: 'buy', got: Math.round(free * (1 - mark)), hoped: Math.round(pH * (1 - mark)) });
    note('glut', free * (mark - (seen.glut ?? 0)) * e.q * cut, { stop: e.stop, good: e.good, side: 'buy' });
    ownMove(e, seen, 'buy', e.cost - e.q * Math.max(1, Math.round(seen.p * cut)));
  }
  for (const [g, n] of Object.entries(r.goodsBack)) {
    const now = r.homePrices?.[g] ?? M.truePrice(s, content, home, g) ?? 0, pH = hope.home?.[g];
    if (pH) note('news', (pH - now) * n, { stop: home, good: g, side: 'home', got: now, hoped: pH });
  }
  // a toll paid in goods that the far end would have bought costs what the last loads would have fetched there, less the toll they paid
  const dest = stopOf(content, routeOf(content, x.route).to);
  for (const [g, q] of Object.entries(book.paidInGoods ?? {})) {
    const pH = hope.sell?.[g], depth = dest.sells?.[g]?.depth;
    if (!pH || !depth) continue;
    const sold = (book.sold ?? []).filter(e => e.good === g).reduce((n, e) => n + e.q, 0), cut = bargain(agent, dest.id, 'sell');
    const seen = seenAt(dest.id, g);   // the loads go through the price the party found, the house's own mark on it included
    const m = seen ? marketAt(s, content, dest.id, g, seen.p, seen.glut ?? 0) : marketAt(s, content, dest.id, g, pH);
    saleRevenue(m, content, dest.id, g, cut, sold);   // the loads that did sell move the price first
    const lost = saleRevenue(m, content, dest.id, g, cut, q);
    note('tolls', lost - q * (M.truePrice(s, content, home, g) ?? 0), { good: g });
  }
  causes.tolls += Math.max(0, book.tolls - (hope.tolls ?? book.tolls));
  for (const [g, q] of Object.entries(book.lost ?? {})) note('loss', q * (hope.sell?.[g] ?? hope.home?.[g] ?? M.truePrice(s, content, home, g) ?? 0), { good: g });
  const gap = hope.net - r.houseNet;
  const ordered = (book.orders ?? []).some(o => o.changed) || !!book.turned;
  if (ordered) causes.order = Math.max(0, gap - Math.max(0, causes.news) - Math.max(0, causes.glut) - Math.max(0, causes.own) - Math.max(0, causes.tolls) - Math.max(0, causes.loss));
  return { gap, causes, named, low };
}

/** The one sentence the return paper gives for the difference between what was hoped and what came (DESIGN 2.2 rule 2): the
    largest of the causes in `gapCauses`, in words, or "about as hoped" when the gap is small, or a gain's reason. Null for
    an expedition sent before the estimate existed. */
function whyLine(s, content, x, r) {
  const found = gapCauses(s, content, x, r);
  if (!found) return null;
  const { gap, causes, named, low } = found;
  const agent = agentOf(content, x.agent);
  const small = Math.max(10, Math.abs(x.hope.net) * 0.1);
  if (Math.abs(gap) <= small) return 'The trip went about as hoped.';
  const news = named.news;
  const guessed = x.hope.ageWords === 'no news';
  const aged = `the news, ${x.hope.ageWords}, led us to expect`;
  // one price that was not the one hoped for: `rel` is "not" for a worse one and "more than"/"less than" for a better one
  const priceWords = (n, better) => {
    const good = goodName(content, n.good), place = stopName(content, n.stop);
    const rel = (up) => (better ? `${up ? 'more' : 'less'} than` : 'not');
    if (n.side === 'home') {
      // a party settled by quotes was not back when the price was read: say so (MER-119); one that was back says the season
      if (r.jump?.quoted) return `The years passed before ${agent.name} was home, so ${good} was counted at ${n.got} at home, ${rel(n.got > n.hoped)} the ${n.hoped} we hoped for.`;
      const when = r.jump ? `in ${M.writeSeason(content, r.jump.at)}, when ${agent.name} was back` : `by the time ${agent.name} was back`;
      return `${cap(good)} fetched ${n.got} at home ${when}, ${rel(n.got > n.hoped)} the ${n.hoped} it fetched when ${agent.name} left.`;
    }
    const was = guessed ? ` We had no news of ${place} and guessed ${n.hoped}.` : null;   // no news: say so in a sentence of its own
    if (n.side === 'sell') return was ? `${place} paid ${n.got} for ${good} when ${agent.name} arrived.${was}` : `${place} paid ${n.got} for ${good} when ${agent.name} arrived, ${rel(true)} the ${n.hoped} ${aged}.`;
    return was ? `${cap(good)} cost ${n.got} in ${place} when ${agent.name} arrived.${was}` : `${cap(good)} cost ${n.got} in ${place} when ${agent.name} arrived, ${rel(false)} the ${n.hoped} ${aged}.`;
  };
  if (gap < 0) return low.news && causes.news < -small / 2 ? priceWords(low.news, true) : 'The trip made more than hoped.';
  // the cause that moved the result most, in dinars, as the sentence will tell it: a cause the house came out short by is sized by
  // the one item its sentence names (a price that fell 40 dinars short is 40 even when another good rose and the sum is 10);
  // loss, order and tolls are sized by the whole of what they took. A tie goes in this order.
  const order = ['loss', 'order', 'tolls', 'glut', 'own', 'news'];
  const size = k => (causes[k] <= 0 ? 0 : named[k]?.amount > 0 && k !== 'tolls' && k !== 'loss' ? named[k].amount : causes[k]);
  const top = order.reduce((best, k) => (size(k) > size(best) ? k : best), 'news');
  if (size(top) <= 0) return 'Prices moved against the house on the way.';
  if (top === 'loss') return `The road took ${cargoText(content, x.book.lost)}.`;
  if (top === 'order') return orderLine(content, x, seasonIndex(s, content)) ?? 'An order from a letter changed the trip.';
  if (top === 'own') {
    const n = named.own, good = goodName(content, n.good), place = stopName(content, n.stop);
    return n.side === 'sell'
      ? `Selling ${n.q} ${plural(n.q, 'load', 'loads')} pushed the price of ${good} in ${place} down from ${n.from} to ${n.to}.`
      : `Buying ${n.q} ${plural(n.q, 'load', 'loads')} pushed the price of ${good} in ${place} up from ${n.from} to ${n.to}.`;
  }
  if (top === 'tolls') return `Tolls were paid in ${goodName(content, named.tolls.good)} that would have sold for more in ${stopName(content, routeOf(content, x.route).to)}.`;
  if (top === 'glut') { const n = named.glut; return n.side === 'sell' ? `${stopName(content, n.stop)} already had too much ${goodName(content, n.good)}: the house's own earlier sales there had pushed the price down.` : `${cap(goodName(content, n.good))} was dear in ${stopName(content, n.stop)}: the house's own earlier buying there had pushed the price up.`; }
  if (!news || news.got === news.hoped) return 'Prices moved against the house on the way.';   // the price itself was as hoped: it was the cost of getting there
  return priceWords(news);
}

/** The return paper: the headline sentence first (DESIGN 4.6), then the account. */
function returnPaper(s, content, r) {
  const { x, route } = r;
  const agent = agentOf(content, x.agent), dest = stopName(content, x.book.turned ?? route.to), homeName = stopName(content, homeOf(content));
  const n = r.houseNet;
  const headline = `${agent.name} came home from ${dest}. ${n > 0 ? `The house made ${coins(content, n)}.` : n < 0 ? `The house lost ${coins(content, -n)}.` : 'The house came out even.'}`;
  const book = x.book;
  const rows = [];
  // The account adds up (MER-88): every row with an `amount` and no `detail` is a sum the house took in or paid out, and
  // together they come to `houseNet`, the same number the headline and the Profit row give. `detail` rows say what
  // happened on the road; their money is inside the row that follows.
  rows.push({ label: 'Sent out', text: `${cargoText(content, book.cargo)}${book.purse ? `, ${coins(content, book.purse)} to spend` : ''}`, amount: -book.capital });
  for (const e of book.sold) rows.push({ label: 'Sold', text: `${qty(content, e.good, e.q)} in ${stopName(content, e.stop)}, for ${coins(content, e.got)}`, amount: e.got, detail: true });
  for (const e of book.bought) rows.push({ label: 'Bought', text: `${qty(content, e.good, e.q)} in ${stopName(content, e.stop)}, for ${coins(content, e.cost)}`, amount: -e.cost, detail: true });
  if (book.tolls) rows.push({ label: 'Tolls', text: `${coins(content, book.tolls)} paid on the road`, amount: -book.tolls, detail: true });
  if (book.upkeep) rows.push({ label: 'Waiting', text: `${words(x.waiting)} ${plural(x.waiting, 'season', 'seasons')} at a stop, kept at ${coins(content, UPKEEP)} a season`, amount: -book.upkeep, detail: true });
  if (book.lost && Object.keys(book.lost).length) rows.push({ label: 'Lost', text: cargoText(content, book.lost) });
  const back = [];
  if (Object.keys(r.goodsBack).length) back.push(`${cargoText(content, r.goodsBack)} (worth ${coins(content, r.cargoValue)} in ${homeName} now)`);
  if (r.moneyBack) back.push(coins(content, r.moneyBack));
  rows.push({ label: 'Back home', text: back.length ? `${back.join(' and ')}, ${coins(content, r.value)} in all` : 'nothing', amount: r.value });
  if (x.contract.kind === 'qirad') {
    const word = { 1: 'one third', 2: 'two thirds' }[x.contract.agentShare] ?? `${x.contract.agentShare} of ${x.contract.of}`;
    if (x.staked.partners) rows.push({ label: 'The partners put in', text: coins(content, x.staked.partners), amount: x.staked.partners });
    rows.push({ label: `${agent.name}'s share`, text: `a qirad: ${agent.name} keeps ${x.contract.of === 3 ? word : `${x.contract.agentShare} in ${x.contract.of}`} of a profit and bears none of a loss, ${coins(content, r.shares.agent)} this time`, amount: -r.shares.agent });
    rows.push({ label: "The partners' share", text: r.shares.partners ? `${coins(content, r.shares.partners)} of the ${coins(content, x.staked.partners)} they put in, with their part of the profit` : 'nothing', amount: -r.shares.partners });
  } else if (r.wage) {
    // the seasons the wage was paid for: what the trip was away (a prepaid wage was fixed at sending)
    const paid = agent.wage ? Math.round(r.wage / agent.wage) : x.out;
    rows.push({ label: `${agent.name}'s wage`, text: `${coins(content, agent.wage)} a season for ${words(paid)} ${plural(paid, 'season', 'seasons')}${x.contract.prepaid ? ', paid before the trip' : ''}`, amount: -r.wage });
  }
  if (r.short) rows.push({ label: 'Not paid', text: `the house could not pay ${coins(content, r.short)} of what it owed, and its good name suffers` });
  rows.push({ label: n < 0 ? 'Loss' : 'Profit', text: n === 0 ? 'none, the house came out even' : `${Object.keys(r.goodsBack).length ? 'about ' : ''}${coins(content, Math.abs(n))}`, amount: n });
  const seasons = r.elapsed;
  const trip = { ...tripFacts(content, x.agent, route, x.book.turned ?? route.to, mainGoodOf(book.cargo), seasons, x.id), orders: (book.orders ?? []).map(o => ({ ...o })) };
  const line = orderLine(content, x, seasonIndex(s, content));
  // "Sell the <good> now?" is about the good that came home, not the one that went out (MER-88): the facts and the words
  // read the main good of what came back, and `brought` says something did. A trip that sold everything it carried asks nothing about it.
  const homeGood = mainGoodOf(r.goodsBack);
  const asking = { ...trip, good: homeGood ?? trip.good };
  const entry = pickEntry(s, content, 'return', {
    outcome: n > 0 ? 'profit' : n < 0 ? 'loss' : 'even', agent: x.agent, to: trip.to, good: asking.good, seasons, orders: !!line,
    contract: x.contract.kind, lost: Object.keys(book.lost ?? {}).length > 0, brought: homeGood !== null,
  });
  return {
    kind: 'return', ref: 'return', agent: x.agent, expedition: x.id,
    data: {
      headline: line ? `${line} ${headline}` : headline,
      orderLine: line, trip, ...askOf(content, entry, asking),
      route: `${homeName} to ${dest} and back, ${words(seasons)} ${plural(seasons, 'season', 'seasons')}`,
      account: rows, goodsBack: Object.fromEntries(Object.entries(r.goodsBack).filter(([, q]) => q > 0)), cargoValue: Math.round(r.cargoValue), houseNet: n, outcome: n > 0 ? 'profit' : n < 0 ? 'loss' : 'even',
      hoped: x.hoped ?? null, why: x.hoped === undefined ? null : whyLine(s, content, x, r),   // what the sheet said at sending, and one sentence for the gap (DESIGN 2.2 rule 2)
      shares: { agent: r.shares.agent, partners: r.shares.partners, house: r.shares.house },
    },
  };
}

/** Opening step "returns": every expedition whose last leg finished comes home and puts a return
    paper on the desk. One the desk has no room for waits at home for the next season. */
export function returns(s, content) {
  const idx = seasonIndex(s, content);
  const back = [];
  for (const x of s.expeditions) {
    if (x.status !== 'home') continue;
    if (deskFull(s)) break;
    // `out` counts the closings it moved in; the season it left in is one it was away for too, so the paper's season count and the wage's are `out + 1` (MER-88)
    const r = bringHome(s, content, x, { elapsed: x.out + 1 });
    put(s, returnPaper(s, content, r));
    close(s, content, x, idx);
    back.push(x.id);
    s.log.push({ at: idx, kind: 'return', ref: x.id, choice: r.houseNet >= 0 ? 'profit' : 'loss' });
  }
  s.expeditions = s.expeditions.filter(x => !back.includes(x.id));
}

// ---------------------------------------------------------------------------------------------
// Settling an expedition without playing it out: the act jump and the ending

/** What the expedition would have done from where it is: trade at the far end at the prices of
    that stop when it left (no glut), one roll of each leg's risk left, each toll. Returns "home"
    with the expedition changed, or "lost" (the agent's fate is in `fate`). */
function settle(s, content, x) {
  const route = routeOf(content, x.route), legs = route.legs, agent = agentOf(content, x.agent);
  const far = outEnd(route);
  if (x.leg <= far) {
    for (const g of x.plan.sell) {
      const q = x.cargo[g] ?? 0, p = x.quote[g];
      if (!q || p === undefined || p === null) continue;
      const got = q * Math.round(p * bargain(agent, route.to, 'sell'));
      delete x.cargo[g]; x.purse += got;
      x.book.sold.push({ good: g, q, got, stop: route.to });
    }
    const goods = x.plan.buy.filter(g => x.quote[g]);
    goods.forEach((g, k) => {
      const p = Math.max(1, Math.round(x.quote[g] * bargain(agent, route.to, 'buy')));
      const q = Math.floor(Math.floor(x.purse / (goods.length - k)) / p);
      if (!q) return;
      x.cargo[g] = (x.cargo[g] ?? 0) + q; x.purse -= q * p;
      x.book.bought.push({ good: g, q, cost: q * p, stop: route.to });
    });
  }
  for (let i = x.leg; i < legs.length; i++) {
    const leg = legs[i];
    if (next(s) < legRisk(content, agent, leg, undefined)) {
      const loss = loseSome(s, content, x);
      x.book.lost = x.book.lost ?? {};
      for (const [g, n] of Object.entries(loss.cargo)) x.book.lost[g] = (x.book.lost[g] ?? 0) + n;
      if (loss.whole) return { result: 'lost', loss, leg };
    }
    x.book.tolls += leg.toll;
    payFromExpedition(s, content, x, leg.toll);
  }
  x.status = 'home'; x.leg = legs.length;
  return { result: 'home' };
}

/** One line for an expedition settled off stage (the interlude page, the ending). */
function settledLine(s, content, x, out, r) {
  const agent = agentOf(content, x.agent), dest = stopName(content, x.book?.turned ?? routeOf(content, x.route).to);
  if (out.result === 'lost') {
    const surv = out.fate === 'died' ? `${agent.name} did not come back.` : `${agent.name} got home.`;
    return { expedition: x.id, agent: x.agent, result: 'lost', cargo: { ...x.book?.cargo }, text: `${agent.name}'s expedition to ${dest} was lost on the way. ${surv}`, houseNet: -x.staked.house };
  }
  const n = r.houseNet;
  return { expedition: x.id, agent: x.agent, result: 'home', cargo: { ...x.book?.cargo }, text: `${agent.name} came home from ${dest}. ${n > 0 ? `The house made ${coins(content, n)}.` : n < 0 ? `The house lost ${coins(content, -n)}.` : 'The house came out even.'}`, houseNet: n };
}

/** Settles `x` (settle, then bring it home or write it off). Returns its line. */
function settleAndClose(s, content, x, elapsed, { papers = null, at = null } = {}) {
  const wasHome = x.status === 'home';   // it finished its road before the years passed; otherwise the jump settles it by quotes
  const out = settle(s, content, x);
  if (out.result === 'lost') {
    out.fate = out.loss.survived ? 'survived' : 'died';
    s.agents[x.agent].where = out.loss.survived ? homeOf(content) : 'dead';
    if (out.loss.survived && x.contract.kind === 'own' && !x.contract.prepaid) pay(s, content, x.out * (agentOf(content, x.agent).wage ?? 0));
    return settledLine(s, content, x, out);
  }
  const r = bringHome(s, content, x, { elapsed, at: papers && wasHome ? at : null });
  // a trip that came home while the years passed leaves its paper for the first desk after the interlude (MER-98), with
  // what the sheet hoped and one sentence for the gap, which the interlude page carries too (MER-119)
  const line = { ...settledLine(s, content, x, out, r), quoted: !wasHome };   // `quoted`: settled by the prices it left with, not home before the years passed
  if (papers) {
    r.jump = { quoted: !wasHome, at };
    const paper = returnPaper(s, content, r);
    papers.push(paper);
    if (paper.data.why) Object.assign(line, { hoped: paper.data.hoped, why: paper.data.why });
  }
  return line;
}

// ---------------------------------------------------------------------------------------------
// The act jump (ARCHITECTURE 4.7)

/** The seasons of every leg of the expedition's road, there and back, at its agent's pace. */
export function wholeRoad(content, x) { return roadSeasons(agentOf(content, x.agent), routeOf(content, x.route)); }
const roadSeasons = (agent, route) => route.legs.reduce((n, l) => n + legSeasons(agent, l), 0);

/** Closing step "jump": the years between acts. Called after `t` has advanced to the first
    season of the next act. Writes one log entry, kind "jump", which the interlude page reads
    (view().interlude). */
export function jump(s, content) {
  const played = playedSeasons(content.calendar, s.length);
  const to = played[s.t], from = played[s.t - 1];
  const years = Math.max(1, Math.round((to - from) / 4));
  const entry = { at: to, kind: 'jump', from, to, years, settled: [], loans: [], agents: [], events: [] };

  // 1. every expedition on the road is settled
  const papers = [];   // the return papers of the ones that came home, put on the desk once step 3 has said who is still in the house's service
  // The years pass while it finishes, so an expedition still out is charged the wage of its whole road
  // (every leg's seasons, there and back), not of the seasons it had ridden when the jump came (MER-51b).
  for (const x of s.expeditions) {
    norm(x);
    const road = routeOf(content, x.route) ? wholeRoad(content, x) : 0;
    x.out = Math.max(x.out, road);
    entry.settled.push(settleAndClose(s, content, x, Math.max(1, x.out), { papers, at: from }));
    close(s, content, x, to);
  }
  s.expeditions = [];

  // 2. loans fall due, with interest for the years passed
  const due = s.loans.filter(l => l.due <= to);
  for (const l of due) {
    const owed = Math.round(l.principal * (1 + (l.rate ?? 0) * years));
    const short = pay(s, content, owed);
    if (short) s.rep.partners = clamp(s.rep.partners - 1, -3, 3);
    entry.loans.push({ id: l.id, from: l.from, owed, short });
  }
  s.loans = s.loans.filter(l => l.due > to);

  // 3. agents: trust halves toward 0; one at -2 or lower leaves; some retire
  for (const a of content.agents ?? []) {
    const r = s.agents[a.id];
    if (!r || !r.hired || r.where === 'dead' || r.where === 'gone') continue;
    if (r.trust <= -2) { r.hired = false; r.where = 'gone'; entry.agents.push({ id: a.id, left: 'trust' }); continue; }
    r.trust = Math.trunc(r.trust / 2);
    if (chance(s, jumpChances(content).retires)) { r.hired = false; r.where = 'gone'; entry.agents.push({ id: a.id, left: 'retired' }); }
  }

  // a paper left for the first desk (MER-98): an agent who left or retired at the jump is not asked about again, and gets no bonus
  for (const paper of papers) {
    if (!s.agents[paper.agent]?.hired) Object.assign(paper.data, askOf(content, null, paper.data.trip));
    put(s, paper);
  }

  // 4. markets reset to the new act's base prices, with no glut
  for (const [stop, byGood] of Object.entries(s.market)) for (const g of Object.keys(byGood)) byGood[g] = { f: 1.0, glut: 0 };

  // 4b. the house hears from every stop on a road it could send someone on, up to the last year of the jump (MER-98): ten
  // years pass, so the news it had is not what it knows. The prices are the new act's, written in the season before the first.
  for (const stop of content.stops ?? []) {
    if (stop.id === homeOf(content) || !(content.routes ?? []).some(r => r.to === stop.id && r.legs.every(l => !l.when || holds(l.when, s, content)))) continue;
    for (const g of Object.keys(s.market[stop.id] ?? {})) (s.known[stop.id] ??= {})[g] = { p: M.truePrice(s, content, stop.id, g), at: to - 1 };
  }

  // 5. the events of this gap, in the order of their seasons
  const a = actOfSeason(content.calendar, s.length, from), b = actOfSeason(content.calendar, s.length, to);
  const evs = (content.events ?? []).filter(e => e.between && e.between[0] === a && e.between[1] === b).sort((p, q) => p.at - q.at);
  for (const ev of evs) {
    if (s.seen[`event:${ev.id}`]) continue;
    s.seen[`event:${ev.id}`] = 1;
    applyAll(s, content, ev.do, { at: ev.at });
    entry.events.push({ id: ev.id, at: ev.at, ...(ev.interlude ? { interlude: ev.interlude } : {}) });
  }
  s.log.push(entry);
  s.phase = 'interlude';
}

/** What the page between acts shows, read from the last jump: the span, each settled expedition,
    the loans repaid, the agents who left and the paragraphs of the events. Null if none. */
export function interludeOf(state, content) {
  const e = [...state.log].reverse().find(x => x.kind === 'jump');
  if (!e) return null;
  return {
    from: year(content.calendar, e.from), to: year(content.calendar, e.to), years: e.years,
    settled: e.settled, loans: e.loans, agents: e.agents,
    paragraphs: e.events.filter(x => x.interlude).map(x => ({ id: x.id, text: x.interlude })),
  };
}

// ---------------------------------------------------------------------------------------------
// The accounts paper (DECISIONS 2026-11-17 on MER-35)

const sign = n => (n > 0 ? `+${n}` : `${n}`);

/** What a fired later effect did that the player can see, as short phrases; [] if nothing. */
function changesOf(content, q, s) {
  const out = [];
  const nameOf = id => agentOf(content, id === '$agent' ? q.agent : id)?.name ?? id;
  for (const e of q.do ?? []) {
    if ('money' in e) out.push(`${sign(e.money)} ${cityOf(content, 'accounts').currency ?? 'coins'}`);
    else if ('stock' in e) out.push(`${sign(e.by)} ${goodName(content, e.stock)}`);
    else if ('rep' in e) out.push(`good name with ${e.rep} ${sign(e.by)}`);
    else if ('trust' in e) out.push(`${nameOf(e.trust)}'s trust ${sign(e.by)}`);
    else if ('loan' in e) out.push(`a loan of ${e.loan.principal} from ${e.loan.from}`);
    else if ('hire' in e) out.push(`${nameOf(e.hire)} joins the house`);
    else if ('dismiss' in e) out.push(`${nameOf(e.dismiss)} leaves the house`);
  }
  return out;
}

/** One item for the accounts paper from a later effect that fired with no follow-up card. */
export function accountItem(s, content, q) {
  const changes = changesOf(content, q, s);
  if (!changes.length) return null;
  // the card and the choice that set this effect: the words the player saw when choosing (turn.js `choose` records them in
  // the queue item), else looked up from the ids, else, for an item queued before they were recorded, a plain "earlier choice"
  const [cardId, choiceId] = String(q.from ?? '').split('/');
  const card = (content.cards ?? []).find(c => c.id === cardId) ?? (content.letters ?? []).find(l => l.id === cardId) ?? (content.returns ?? []).find(e => e.id === cardId);
  const choice = card?.choices?.find(c => c.id === choiceId);
  const title = q.viaCard ?? card?.title ?? null, label = q.viaChoice ?? choice?.label ?? null;
  const from = title ? `${title}${label ? `, "${label}"` : ''}` : (q.from ?? 'an earlier choice');
  return { from: q.from ?? null, card: title, choice: label, changes, text: `From ${from}: ${changes.join(', ')}` };
}

/** Puts one folded Accounts paper on the desk naming every item (a count, not a paper each). */
export function foldAccounts(s, content, items) {
  if (!items.length) return;
  const idx = seasonIndex(s, content);
  s.log.push({ at: idx, kind: 'accounts', items: items.map(i => i.text) });
  put(s, { kind: 'accounts', ref: 'accounts', items });
}

// ---------------------------------------------------------------------------------------------
// The ending (ARCHITECTURE 4.9)

/** The chances of the ending: city.json's `recall` over the defaults. */
export function recallChances(content) {
  const r = content.city?.recall ?? {};
  return { ...DEFAULT_RECALL, ...r, reach: { ...DEFAULT_RECALL.reach, ...(r.reach ?? {}) }, byStop: { ...DEFAULT_RECALL.byStop, ...(r.byStop ?? {}) } };
}

/** A chance in the four words the recall page already uses for word reaching an expedition. */
export function chanceWord(p) { return p >= 0.8 ? 'sure' : p >= 0.5 ? 'likely' : p >= 0.25 ? 'maybe' : 'unlikely'; }

/** What the recall page may say of each person (MER-86): the engine's own numbers as plain facts, one entry
    per hired agent who is on the road or at home, in the content's order. `reach` is the chance word gets
    to an expedition in time; `ifCalled` and `ifStays` the chance the agent lives under each choice (a call
    that word does not reach is a stay); `risk` is the chance of dying of the plague in the words of
    `chanceWord`, for the choice most likely taken (stays) on the road and for the one at home. People at
    home are rolled at `homeSurvives` too, so they carry the same fields with `where: 'home'`. */
export function recallRisk(s, content) {
  const cfg = recallChances(content);
  const home = homeOf(content);
  const out = [];
  const onRoad = new Set(s.expeditions.map(x => x.agent));
  for (const a of content.agents ?? []) {
    const r = s.agents?.[a.id];
    if (!r?.hired || r.where === 'dead' || r.where === 'gone') continue;
    const x = s.expeditions.find(e => e.agent === a.id);
    if (x) {
      const route = routeOf(content, x.route);
      const lag = x.status === 'home' ? 0 : seasonsHome(content, x);
      const reach = clamp(cfg.reach.start - cfg.reach.perSeason * lag, cfg.reach.floor, 1);
      const leg = route.legs[Math.min(x.leg, route.legs.length - 1)];
      const place = x.status === 'out' ? leg.to : leg.from;
      const stay = cfg.byStop[place] ?? cfg.stayedSurvives;
      const called = reach * cfg.recalledSurvives + (1 - reach) * stay;
      out.push({ agent: a.id, where: 'road', expedition: x.id, place, reach, reachWord: chanceWord(reach),
        ifCalled: called, ifStays: stay, risk: chanceWord(1 - stay), riskIfCalled: chanceWord(1 - called) });
    } else if (r.where === home && !onRoad.has(a.id)) {
      out.push({ agent: a.id, where: 'home', place: home, ifStays: cfg.homeSurvives, risk: chanceWord(1 - cfg.homeSurvives), lives: cfg.homeSurvives });
    }
  }
  return out;
}

/** The ending's last choice. `decisions` maps an expedition id to "recall" or "stay" (missing means
    stay). Each expedition is rolled in turn, then each agent at home. One line each in the log. */
export function recall(s, content, decisions = {}) {
  const cfg = recallChances(content);
  const idx = seasonIndex(s, content);
  const home = homeOf(content);
  const results = [];
  const settled = new Set();
  for (const x of s.expeditions) {
    settled.add(x.agent);
    const agent = agentOf(content, x.agent), route = routeOf(content, x.route);
    const lag = x.status === 'home' ? 0 : seasonsHome(content, x);
    const reach = clamp(cfg.reach.start - cfg.reach.perSeason * lag, cfg.reach.floor, 1);
    const word = next(s) < reach;                // one draw whatever was decided, so draws do not shift
    const leg = route.legs[Math.min(x.leg, route.legs.length - 1)];
    const place = x.status === 'out' ? leg.to : leg.from;
    const called = decisions[x.id] === 'recall' && word;
    const before = s.money;
    let line;
    if (called) {
      const lives = next(s) < cfg.recalledSurvives;
      for (const g of Object.keys(x.cargo)) { x.cargo[g] = Math.floor(x.cargo[g] * cfg.recalledKeeps); if (!x.cargo[g]) delete x.cargo[g]; }
      if (lives) {
        const r = bringHome(s, content, x, { elapsed: idx - x.sent });
        line = { expedition: x.id, agent: x.agent, how: 'recalled', survived: true, text: `${agent.name} got word and came home with part of the cargo.`, houseNet: r.houseNet };
      } else {
        s.agents[x.agent].where = 'dead';
        line = { expedition: x.id, agent: x.agent, how: 'recalled', survived: false, text: `${agent.name} set out for home and did not arrive.`, houseNet: -x.staked.house };
      }
    } else {
      const lives = next(s) < (cfg.byStop[place] ?? cfg.stayedSurvives);
      const how = decisions[x.id] === 'recall' ? 'no word' : 'stayed';
      if (lives) {
        const out = settleAndClose(s, content, x, idx - x.sent);
        line = { expedition: x.id, agent: x.agent, how, survived: out.result === 'home' || out.fate === 'survived', text: out.text, houseNet: out.houseNet };
      } else {
        s.agents[x.agent].where = 'dead';
        line = { expedition: x.id, agent: x.agent, how, survived: false, text: `${agent.name} stayed in ${stopName(content, place)} and did not come back.`, houseNet: -x.staked.house };
      }
    }
    line.brought = s.money - before;   // what this agent's return put into the house's cash, for the score's wealth line
    results.push(line);
  }
  s.expeditions = [];
  for (const a of content.agents ?? []) {
    const r = s.agents[a.id];
    if (!r?.hired || r.where !== home || settled.has(a.id)) continue;   // one who came home from the road above has had their roll
    const lives = next(s) < cfg.homeSurvives;
    if (!lives) r.where = 'dead';
    results.push({ agent: a.id, how: 'home', survived: lives, text: lives ? `${a.name} was in ${stopName(content, home)} and lived.` : `${a.name} was in ${stopName(content, home)} and died of the plague.` });
  }
  s.log.push({ at: idx, kind: 'recall', results });
  s.phase = 'ended';
}
