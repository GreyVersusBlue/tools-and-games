// Markets and old news (ARCHITECTURE 4.2 step 3, 4.8).
//
// state.market[stop][good] = { f, glut, h }: the true factor on the base price, what the
// house has done to the stop (positive after selling, negative after buying), and `h`, the
// true price at the end of each of the last HISTORY seasons as [season, price] pairs.
// state.known[stop][good] = { p, at } is all the screens ever see (view().prices).
//
// Drift draws from its own stream, not state.rng: one fresh generator per season, stop and
// good, seeded from the game's seed (FNV-1a over "seed:season:stop:good"). So a market never
// shifts the cards a seed deals, and adding a good never moves the drift of another one.
// ARCHITECTURE 2.2 should say so.
import { normal } from './rng.js';
import { seasonIndex, seasonName, year, actOfSeason, playedSeasons } from './calendar.js';
import { cityOf, addPaper } from './state.js';
import { routeFor } from './routes.js';

export const HISTORY = 12;           // seasons of true prices kept per stop and good
export const F_MIN = 0.5, F_MAX = 2.0;
export const GLUT_MAX = 0.6, GLUT_MIN = -0.3;

const WORDS = ['this season', 'one season old', 'two seasons old', 'three seasons old', 'four seasons old',
  'five seasons old', 'six seasons old', 'seven seasons old', 'eight seasons old', 'nine seasons old',
  'ten seasons old', 'eleven seasons old', 'twelve seasons old'];

/** Age of a price in words: "two seasons old". Past twelve it is a number. */
export function ageWords(age) { return WORDS[age] ?? `${age} seasons old`; }

/** "Winter 1323": a season index written out. */
export function writeSeason(content, idx) {
  const n = seasonName(((idx % 4) + 4) % 4);
  return `${n[0].toUpperCase()}${n.slice(1)} ${year(content.calendar, idx)}`;
}

const stopOf = (content, id) => (content.stops ?? []).find(s => s.id === id);

function seedFor(state, idx, stop, good) {
  let h = 0x811c9dc5;
  for (const ch of `${state.seed}:${idx}:${stop}:${good}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/** The base price of a good at a stop in a season: baseByAct in the three-act game. */
export function baseOf(state, content, stopId, goodId, idx = seasonIndex(state, content)) {
  const sell = stopOf(content, stopId)?.sells?.[goodId];
  if (!sell) return null;
  if (state.length === 'acts' && sell.baseByAct) return sell.baseByAct[actOfSeason(content.calendar, state.length, idx) - 1] ?? sell.base;
  return sell.base;
}

/** The true price now, a whole number of dinars a load; null where the stop does not trade the good. */
export function truePrice(state, content, stopId, goodId, idx) {
  const m = state.market[stopId]?.[goodId];
  const base = baseOf(state, content, stopId, goodId, idx);
  if (!m || base === null) return null;
  return Math.max(1, Math.round(base * m.f * (1 - m.glut)));
}

/** Dinars the house gets for one load of `good` at `stop` now (the price the stop pays). */
export const sellPrice = (state, content, stopId, goodId) => truePrice(state, content, stopId, goodId);
/** Dinars the house pays for one load of `good` at `stop` now. */
export const buyPrice = (state, content, stopId, goodId) => truePrice(state, content, stopId, goodId);

function entry(state, stopId, goodId) {
  const m = state.market[stopId]?.[goodId];
  if (!m) throw new Error(`stop "${stopId}" does not trade "${goodId}"`);
  return m;
}
const depthOf = (content, stopId, goodId) => stopOf(content, stopId).sells[goodId].depth;
const whole = q => { if (!Number.isInteger(q) || q < 0) throw new Error(`market: ${q} is not a number of loads`); return q; };

/** The house sold q loads at the stop (call on a clone): the price falls by q over depth, capped. */
export function noteSale(state, content, stopId, goodId, q) {
  const m = entry(state, stopId, goodId);
  m.glut = Math.min(GLUT_MAX, round4(m.glut + whole(q) / depthOf(content, stopId, goodId)));
}
/** The house bought q loads at the stop: scarcity raises the price, floored. */
export function notePurchase(state, content, stopId, goodId, q) {
  const m = entry(state, stopId, goodId);
  m.glut = Math.max(GLUT_MIN, round4(m.glut - whole(q) / depthOf(content, stopId, goodId)));
}
const round4 = n => Math.round(n * 1e4) / 1e4;

/** The broker's cut when the house sells from its warehouse at home: 15 in every hundred of each load's price, rounded per load (sell.js says why 15). It is
    here and not in sell.js because what the house's goods are worth is what this selling pays (MER-148, M4f play problem 1): the estimate, the return
    account and the worth bar all read `houseSale`, and the Sell button reads the same run. */
export const BROKER_CUT = 0.15;

/** What `loads` loads of `good` fetch for the house at `stop` on the market in `state`, sold one after another the way the Sell button sells them: each
    load is priced after the one before it (market.js `noteSale`), the broker's cut comes off each and is rounded per load. `ahead` loads are sold first and not
    counted, so the figure is what these loads add to a warehouse already holding `ahead` of the good. The state is not changed (one entry is copied).
    { gross, got, first, last, after }: what the market would pay, what the house keeps, the first and last load's part, and the price once all are sold. */
export function houseSale(state, content, stopId, goodId, loads, ahead = 0) {
  const e = state.market?.[stopId]?.[goodId];
  const out = { gross: 0, got: 0, first: null, last: null, after: null };
  if (!e) return out;
  // The same arithmetic as `sellPrice` and `noteSale`, load by load, with the base price and the depth read once (the loop is run many times a season: the worth bar,
  // the estimate and every worth line read it, and reading the base for every load was most of what a game cost). test/market.mjs holds it to `sellHome`, which sells with the two.
  const base = baseOf(state, content, stopId, goodId), depth = depthOf(content, stopId, goodId);
  let glut = e.glut;
  const price = () => Math.max(1, Math.round(base * e.f * (1 - glut)));
  const sold = () => { glut = Math.min(GLUT_MAX, round4(glut + 1 / depth)); };
  for (let i = 0; i < ahead; i++) sold();
  for (let i = 0; i < loads; i++) {
    const p = price();
    const net = Math.max(1, Math.round(p * (1 - BROKER_CUT)));
    out.gross += p; out.got += net;
    if (out.first === null) out.first = net;
    out.last = net;
    sold();
  }
  out.after = price();
  return out;
}

/** Seasons from home to a stop along the shortest route that reaches it, summing the legs
    out. Home is 0, an unreachable stop is null. Never below 1 for anywhere else. */
export function lagOf(content, stopId) {
  const home = cityOf(content, 'market').home;
  if (stopId === home) return 0;
  let best = null;
  for (const r of content.routes ?? []) {
    let sum = 0;
    for (const leg of r.legs ?? []) {
      sum += leg.seasons;
      if (leg.to === stopId) { if (best === null || sum < best) best = sum; break; }
    }
  }
  return best === null ? null : Math.max(1, best);
}

/** Drift for the season just played (closing step "drift", before t advances): the true
    price of every good at every stop is written to its history, then glut halves and `f`
    moves. A price event that fired this season is already in `f` and so in the record. */
export function drift(s, content) {
  const idx = seasonIndex(s, content);
  const goods = Object.fromEntries((content.goods ?? []).map(g => [g.id, g]));
  for (const [stopId, byGood] of Object.entries(s.market)) {
    for (const [goodId, m] of Object.entries(byGood)) {
      const g = goods[goodId];
      if (!g) continue;
      const p = truePrice(s, content, stopId, goodId, idx);
      m.h = [...(m.h ?? []).filter(e => e[0] !== idx), [idx, p]].slice(-HISTORY);
      const z = normal({ rng: seedFor(s, idx, stopId, goodId) });
      const pull = Math.pow(m.f, -g.revert);
      m.f = round4(Math.min(F_MAX, Math.max(F_MIN, m.f * Math.exp(g.sigma * z) * pull)));
      m.glut = Math.abs(m.glut) < 0.005 ? 0 : round4(m.glut / 2);
    }
  }
}

/** The true price of a good at a stop in a past season, from the history; null if not kept. */
export function priceAt(state, stopId, goodId, idx) {
  const hit = state.market[stopId]?.[goodId]?.h?.find(e => e[0] === idx);
  return hit ? hit[1] : null;
}

/** Opening step "news": the home stop's price is always current; each other stop whose news
    is due sends a price letter carrying its prices as they were `lag` seasons ago. A stop
    `lag` seasons away is due every `lag` seasons (season index divisible by it). Every letter
    that arrives updates `known` in full and goes onto one paper, kind "news". The paper's
    `line` is at most two leads (DESIGN 2.2 rule 3, `leadLine` below), so the desk never reads
    a wall of prices; the full table stays on the map. */
export function news(s, content) {
  const idx = seasonIndex(s, content);
  const home = cityOf(content, 'market').home;
  for (const goodId of Object.keys(s.market[home] ?? {})) {
    (s.known[home] ??= {})[goodId] = { p: truePrice(s, content, home, goodId), at: idx };
  }
  const letters = [];
  for (const stop of content.stops ?? []) {
    const lag = lagOf(content, stop.id);
    if (!lag || idx % lag !== 0) continue;
    const written = idx - lag;
    const prices = {};
    for (const goodId of Object.keys(s.market[stop.id] ?? {})) {
      const p = priceAt(s, stop.id, goodId, written);
      if (p === null) continue;
      prices[goodId] = p;
      const known = (s.known[stop.id] ??= {});
      if (!known[goodId] || known[goodId].at <= written) known[goodId] = { p, at: written };
    }
    if (Object.keys(prices).length) letters.push({ stop: stop.id, at: written, writtenIn: writeSeason(content, written), prices });
  }
  if (!letters.length) return;
  const leads = leadsOf(s, content, letters, home);
  addPaper(s, { kind: 'news', ref: 'news', letters, leads, line: leadLine(content, leads, home) });
}

export const MAX_LEADS = 2;   // price lines on one season's paper

/** The leads in this season's letters: a good the house holds or can buy at home, at a stop it can
    send someone to now (an open route), where the letter's price beats home's price now. Widest
    margin first, ties by stop then good so the order never depends on object key order. At most
    MAX_LEADS. Each is { stop, good, p, home, at, writtenIn }. */
function leadsOf(s, content, letters, home) {
  const open = {};
  const reach = id => (open[id] ??= routeFor(s, content, id) !== null);
  const out = [];
  for (const l of letters) {
    for (const [g, p] of Object.entries(l.prices)) {
      if (!s.market[home]?.[g]) continue;           // the house can neither hold nor buy what home does not trade
      const here = truePrice(s, content, home, g);
      if (p - here <= 0 || !reach(l.stop)) continue;
      out.push({ stop: l.stop, good: g, p, home: here, at: l.at, writtenIn: l.writtenIn });
    }
  }
  out.sort((a, b) => (b.p - b.home) - (a.p - a.home) || (a.stop < b.stop ? -1 : a.stop > b.stop ? 1 : a.good < b.good ? -1 : 1));
  return out.slice(0, MAX_LEADS);
}

/** "<Stop> pays 38 for <good>. <Home> pays 25." for each lead, then the season the news was written
    in. With no lead the paper says so in a sentence, so the desk is not handed the whole table. */
function leadLine(content, leads, home) {
  if (!leads.length) return 'The letters hold no price worth a road this season.';
  const name = id => (content.goods ?? []).find(g => g.id === id)?.name.toLowerCase() ?? id;
  const homeName = stopOf(content, home).name;
  return leads.map(l => `${stopOf(content, l.stop).name} pays ${l.p} for ${name(l.good)}. ${homeName} pays ${l.home}. News of ${l.writtenIn}.`).join(' ');
}

/** What the house expects a good to fetch at `stopId` now, from what it knows and nothing it should
    not: the last known price, aged toward the city's base by the seasons since. Drift pulls the
    factor f (price over base) to f^(1 - revert) each season (drift above, without its noise), so a
    price known `age` seasons ago has f^((1 - revert)^age) left of its distance from the base.
    Returns { p, at, age, written } or null when the house has no news of it ("no news"). A whole
    number of dinars; reads state.known, never the true market. */
export function expectedPrice(state, content, stopId, goodId) {
  const k = state.known[stopId]?.[goodId];
  if (!k) return null;
  const idx = seasonIndex(state, content);
  const good = (content.goods ?? []).find(g => g.id === goodId);
  const then = baseOf(state, content, stopId, goodId, k.at), now = baseOf(state, content, stopId, goodId, idx);
  if (!good || !then || !now) return null;
  const age = Math.max(0, idx - k.at);
  const f = k.p / then;
  const aged = Math.pow(f, Math.pow(1 - (good.revert ?? 0), age));
  return { p: Math.max(1, Math.round(now * aged)), at: k.at, age, written: writeSeason(content, k.at) };
}

/** What the house knows, for view(): prices[stop][good] = { p, at, written, age, ageWords }.
    A good the stop trades and the house has no news of reads { p: null, ageWords: "no news" }.
    Never reads the true market except for its keys (which goods a stop trades is public). */
export function knownPrices(state, content) {
  const idx = seasonIndex(state, content);
  const out = {};
  for (const stop of content.stops ?? []) {
    out[stop.id] = {};
    for (const goodId of Object.keys(stop.sells ?? {})) {
      const k = state.known[stop.id]?.[goodId];
      out[stop.id][goodId] = k
        ? { p: k.p, at: k.at, written: writeSeason(content, k.at), age: idx - k.at, ageWords: ageWords(idx - k.at) }
        : { p: null, at: null, written: null, age: null, ageWords: 'no news' };
    }
  }
  return out;
}
