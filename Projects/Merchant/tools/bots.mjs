// Balance bots (ARCHITECTURE 7.3): node tools/bots.mjs [--games N] [--seed S] [--bots a,b] [--house id] [--workers 3] [--length acts|full|both]
//
// Plays N seeded three-act games per bot through the engine's public surface (index.js) and
// prints a table. Exits 1 when a threshold below is breached. No browser, no clock, plain Node.
//
// Papers (MER-68): a bot answers every card and letter by the policy below (CARD POLICY); `random` takes a random
// choice that holds. They differ in what they send out:
//   careful  open legs only (no waiting), small cargo, goods from the warehouse first, own money
//   greedy   the biggest margin by last known price, a big cargo, buys goods back at the far end
//   random   any destination, any good, any size
//   qirad    greedy's choice and a medium cargo, always under a qirad with partners
//
// What every bot but `random` values and refuses (MER-51): an offer is the whole round trip (goods out sold at the far
// price, the best good there bought for the way home, less what each leg's risk is expected to take), money-only
// trips included, because the Sahara has nothing the house sells; no second agent to a stop one is already bound for;
// no load above half a market's depth in one good; no stake under five times the wage bill of the road. An expedition
// still on the road at the act jump is settled off stage and counts as a trip, tagged with its route, so the table
// can give the median by direction. The four directions and their limits are DIRECTIONS and LIMITS below.
//
// Defaults: 2,000 games per bot, both lengths (the three-act length is about 22 minutes on three threads, the full years several times that; time --games 200 first), 20,000 by hand (--games 20000). Games rotate through the
// houses (--house to fix one). Seed of game i is SEED0 + i, so a run is repeatable.
// test/bots-smoke.mjs imports `playGame` and `run` and plays 200 games for CI.

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadContent } from '../js/data.js';
import { newGame, openSeason, choose, paperChoices, canEndSeason, endSeason, recall, outfit, destinations, score } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';
import { outEnd, jumpChances } from '../js/engine/routes.js';
import { truePrice, baseOf } from '../js/engine/market.js';
import { cityOf, REP_GROUPS } from '../js/engine/state.js';
import { netWealth, TRUST_BONUS_AT } from '../js/engine/score.js';
import { next } from '../js/engine/rng.js';

// ---- thresholds (the whole of the balance contract; change them here and nowhere else)
export const LIMITS = {
  routeShare: 0.60,        // no single route is greedy's most-used route in more than this share of greedy games
  brokeBySeason: 5,        // a careful player is broke (money under 0, empty warehouse, nothing on the road) by this season...
  brokeShare: 0.02,        // ...in more than this share of games
  carefulMedianAbove: 'p75', // careful's median score is above random's 75th percentile (the key names the percentile)
  cardDrawn: 0.01,         // every card of the content is drawn in at least this share of all games
  choiceTaken: 0.90,       // greedy takes no one choice more than this share of the times its card is offered
  agentsPinned: 0.50,      // careful ends the game with rep.agents at its ceiling (3) in fewer than this share of games (MER-61b, DECISIONS 2026-11-17 13:20)
  // Choices no policy can leave unsettled (MER-68). MER-69 rewrote fifteen of the sixteen so the other choice has a reason.
  // What is left is the scripted opening card, whose `go` is the one press that teaches sending an expedition (ui: outfit-first);
  // the check skips exactly this key and nothing near it.
  choiceExempt: ['first-expedition/go'],
  choiceMinOffers: 30,     // a card offered fewer times than this is not judged on its choices
  tripMedian: [0.10, 0.30],// careful's and greedy's median profit on a round trip after the wage, as a share of the house's stake. 10 to 30 percent is a design target (DECISIONS 2026-11-17 08:50), not a recorded figure; the one recorded anchor is Goitein, Letters of Medieval Jewish Traders, 1973, p. 35 note 27: profits were as a rule surprisingly low and a near doubling exceptional (so tripMedianMax)
  tripMedianMax: 1.0,      // no bot's median round trip reaches a doubling
};
// the four directions a destination belongs to (MER-51): a bot's trips are counted by where the road ends
export const DIRECTIONS = {
  mediterranean: ['venice', 'constantinople', 'tunis', 'famagusta', 'alexandria'],
  'levant-persia': ['damascus', 'aleppo', 'tabriz', 'samarkand'],
  'redsea-india': ['qus', 'quseir', 'aydhab', 'jeddah', 'aden', 'calicut', 'hormuz'],
  sahara: ['tuat', 'walata', 'gao'],
};
LIMITS.directionMin = 0.08;        // over the careful, greedy and qirad bots' trips together, each direction but the Mediterranean carries at least this share...
LIMITS.depthShare = 0.5;            // not a limit of the run: a sensible bot trades no more than this share of a market's depth in one good, which would move the price against it
LIMITS.wageBillShare = 5;           // not a limit of the run: a bot sends a stake of at least this many times the wage bill of the whole road (seasons times the agent's wage)
LIMITS.redseaMedianAtLeastMediterranean = true; // the long roads paid most (MER-51b); the rule is a comparison, so it has no number
LIMITS.carefulRank = 'A respected house';   // the score (MER-85): careful's median game ends in this rank (the words are city.json's `score.ranks`)
LIMITS.randomBelow = 2;             // ...random's median ends in one of this many lowest ranks
LIMITS.topRankShare = 0.01;         // ...the top rank is reached by the best game of a long run but by no more than this share of all games
LIMITS.partShare = 0.5;             // ...and for a sensible bot no one part of the score is more than this share of the median total before the house multiplier, so no single lever wins the game
LIMITS.mediterraneanMax = 0.60;    // ...and the Mediterranean at most this share. An estimate of balance, not a recorded figure: the long roads were risky and paid the most, so a sensible bot uses them sometimes
export const SENSIBLE = ['careful', 'greedy', 'qirad'];
export const directionOf = dest => Object.keys(DIRECTIONS).find(d => DIRECTIONS[d].includes(dest)) ?? null;
export const DEFAULTS = { games: 2000, seed0: 1000, length: 'acts' };
export const BOTS = ['careful', 'greedy', 'random', 'qirad'];
// `first` presses the first choice that can be taken on every paper, sends nobody and recalls nobody (MER-86: the M4 play's
// 127 against careful's 95). It is not in BOTS, so the balance table and its checks do not play it; ask for it with --bots first.
export const EXTRA_BOTS = ['first'];

// ---- a bot's own dice: a separate stream so the bot never shifts the engine's draws
const dice = seed => { const st = { rng: (seed * 2654435761 + 12345) >>> 0 }; return () => next(st); };

// ---- what a bot knows of a price: the last letter, else the base it would guess
function priceOf(state, content, stop, good) {
  const home = cityOf(content, 'bots').home;
  if (stop === home) return truePrice(state, content, stop, good);
  const k = state.known[stop]?.[good];
  return k ? k.p : baseOf(state, content, stop, good);
}

const stopOf = (content, id) => content.stops.find(s => s.id === id);

/** The good the bot would buy at the far end to bring home: the one cheapest there against its home price, if
    that is under 80 percent of it (by what the bot knows). Null when none is. `except` is the good it carries out. */
function bestBack(state, content, home, d, except) {
  let best = null;
  for (const b of Object.keys(stopOf(content, d.stop).sells ?? {})) {
    if (b === except) continue;
    const homeB = truePrice(state, content, home, b);
    if (homeB === null) continue;
    const thereB = priceOf(state, content, d.stop, b);
    if (thereB >= homeB * 0.8) continue;
    const ratio = homeB / thereB;
    if (!best || ratio > best.ratio) best = { good: b, ratio, homeB, thereB };
  }
  return best;
}

/** What a bot expects the road to leave of what it carries: goods lose their share on the way out and again on
    the way back (a loss takes a part of each good, or the whole vessel), money only in the whole-vessel losses.
    Counted from each leg's own risk, as the engine rolls it. Returns { out, back } as shares kept, for goods and for money. */
function keeps(content, route) {
  const J = jumpChances(content);
  const part = (J.partial[0] + J.partial[1]) / 2;
  const cut = (legs, loss) => legs.reduce((k, l) => k * (1 - l.risk * loss), 1);
  const far = outEnd(route), out = route.legs.slice(0, far + 1), home = route.legs.slice(far + 1);
  const goods = J.wholeLoss + (1 - J.wholeLoss) * part, money = J.wholeLoss;
  return { goodsOut: cut(out, goods), goodsBack: cut(home, goods), moneyOut: cut(out, money), moneyBack: cut(home, money) };
}

/** Every (destination, good) the house could send now, with the margin by what the bot knows: the margin of the
    round trip, goods out sold at the far price and the best good bought there carried home. `good` is null for a
    trip that sends money only and buys goods there (the Sahara's way, where the house has nothing the stop buys). */
export function offers(state, content) {
  const home = cityOf(content, 'bots').home;
  const out = [];
  for (const d of destinations(state, content)) {
    const dest = stopOf(content, d.stop);
    const k = keeps(content, content.routes.find(r => r.id === d.route));
    for (const g of Object.keys(dest.sells ?? {})) {
      const homeP = truePrice(state, content, home, g);
      if (homeP === null) continue;
      const there = priceOf(state, content, d.stop, g);
      const back = bestBack(state, content, home, d, g);
      // goods out sell at the far price (less what the road took); the proceeds buy `back`, which the road taxes again
      out.push({ ...d, good: g, homeP, there, back, margin: (there / homeP) * k.goodsOut * (back ? back.ratio * k.goodsBack : k.moneyBack) - 1 });
    }
    const back = bestBack(state, content, home, d, null);
    if (back) out.push({ ...d, good: null, homeP: back.homeB, there: back.thereB, back, margin: k.moneyOut * back.ratio * k.goodsBack - 1 });
  }
  return out;
}

const freeAgents = (state, content) => content.agents.filter(a => {
  const r = state.agents[a.id];
  return r?.hired && r.where === cityOf(content, 'bots').home && !state.expeditions.some(x => x.agent === a.id);
});

/** A plan for `agent` or null: the policy of each bot, ending in `sizes` tried from big to small. */
function plan(bot, state, content, agent, roll) {
  if (bot === 'first') return null;
  // a sensible bot does not send a second agent to a stop one of its expeditions is already bound for: the
  // market there is the same depth for both (random does not mind)
  const busy = new Set(bot === 'random' ? [] : state.expeditions.map(x => content.routes.find(r => r.id === x.route)?.to));
  const all = offers(state, content).filter(o => !busy.has(o.stop));
  if (!all.length) return null;
  const home = cityOf(content, 'bots').home;
  let pick, share, cap, buyBack = 0, contract = 'own';
  if (bot === 'careful') {
    const sound = all.filter(o => o.waits === 0 && o.seasons <= 6 && o.margin > 0.08);
    if (!sound.length) return null;
    pick = sound.reduce((a, b) => (b.margin / b.seasons > a.margin / a.seasons ? b : a));
    share = 0.15; cap = 10;
  } else if (bot === 'greedy' || bot === 'qirad') {
    pick = all.reduce((a, b) => (b.margin > a.margin ? b : a));
    if (pick.margin <= 0) return null;
    share = bot === 'greedy' ? 0.5 : 0.35; cap = 40; buyBack = bot === 'greedy' ? 2 : 1;
    if (bot === 'qirad') contract = 'qirad';
  } else {
    pick = all[Math.floor(roll() * all.length)];
    share = 0.1 + roll() * 0.5; cap = 40; buyBack = Math.floor(roll() * 3);
    if (roll() < 0.2) contract = 'qirad';
  }
  const dest = stopOf(content, pick.stop);
  const g = pick.good;
  // back: the good the offer was valued on first, then others cheaper there than at home by what the bot knows
  const others = Object.keys(dest.sells).filter(b => b !== g && b !== pick.back?.good && truePrice(state, content, home, b) !== null
    && priceOf(state, content, pick.stop, b) < truePrice(state, content, home, b) * 0.8)
    .sort((a, b) => (priceOf(state, content, pick.stop, a) / truePrice(state, content, home, a)) - (priceOf(state, content, pick.stop, b) / truePrice(state, content, home, b)));
  const back = (pick.back ? [pick.back.good, ...others] : others).slice(0, Math.max(buyBack, pick.back ? 1 : 0));
  const base = { agent: agent.id, route: pick.route, sell: g ? [g] : [], buy: back };
  const capitalOf = n => (g ? n * pick.homeP : n * pick.there);
  let n;
  if (g === null) {
    // money only: n units of the good bought there, paid for out of a purse (a toll's worth over)
    const depthThere = dest.sells[pick.back.good].depth;
    n = Math.min(cap, bot === 'random' ? depthThere : Math.ceil(depthThere * LIMITS.depthShare), Math.floor((state.money * share) / pick.there));
  } else {
    const have = state.stock[g] ?? 0;
    const afford = Math.floor((state.money * share) / pick.homeP);
    const depth = stopOf(content, home).sells[g]?.depth ?? 20;
    n = Math.min(cap, bot === 'random' ? depth : Math.ceil(Math.min(depth, dest.sells[g].depth) * LIMITS.depthShare), bot === 'careful' ? Math.max(have > 0 ? have : 0, afford) : have + afford);
    if (bot === 'careful' && have > 0) n = Math.min(n, Math.max(have, 1));
  }
  // shrink until the engine takes it (it checks money, stock and every rule in words)
  // a sensible bot sends no stake the wage bill of the road would swallow: a long road wants a big stake
  const minStake = bot === 'random' || contract === 'qirad' ? 0 : (agent.wage ?? 0) * pick.seasons * LIMITS.wageBillShare;
  for (; n >= 1 && capitalOf(n) >= minStake; n = n > 4 ? Math.floor(n * 0.7) : n - 1) {
    const p = g === null ? { ...base, cargo: {}, purse: Math.ceil(n * pick.there) } : { ...base, cargo: { [g]: n }, purse: 0 };
    if (contract === 'qirad') {
      p.contract = 'qirad';
      p.partners = Math.max(1, Math.floor(capitalOf(n) * 0.5));
    }
    try { outfit(state, content, p); return p; } catch { /* smaller */ }
  }
  return null;
}

// ---- CARD POLICY (MER-68). What a choice is worth is read off its own effects, in money:
//   net      money now and later, plus stock at the home price (a later effect counts whole, no discounting)
//   outlay   the money and stock value it pays out, now and later, counted from the negative effects only
//   standing the reputation and trust it adds (a tie-break: money first, then who thinks well of the house)
// careful and qirad take the choice with the least outlay (the least money at risk), then the most net, then standing.
// greedy takes the most net (money now plus later) with each point of standing counted as a share of the house's
// cash in money: standing pays back later, and a house with more to spare buys more of it. How much a greedy house
// values standing is its temperament, drawn once per game between 0 and STANDING_MAX (its own dice), so no card
// has one answer for every greedy game that merely differs in money. It also draws how much of a follow-up card's pay it counts on (0 to all of it). The draw is per group (partners, court, foreign,
// agents, trust), so one greedy house cares for the court's good opinion and not its partners', and the next the reverse. List order breaks a full tie. random shuffles.
export const STANDING_MAX = 0.15;
export function worthOf(state, content, choice, follow = 1, depth = 0) {
  const home = cityOf(content, 'bots').home;
  let net = 0, outlay = 0, standing = 0;
  const regard = {};   // standing by group: each rep group, and 'trust' for what an agent thinks
  const add = v => { net += v; if (v < 0) outlay -= v; };
  const walk = list => {
    for (const e of list ?? []) {
      if (e.do) walk(e.do);
      if (e.card && depth < 2) {   // a follow-up card is worth what its best answer pays (the bot reads the money the card holds out)
        const nextCard = content.cards.find(k => k.id === e.card);
        const best = Math.max(...(nextCard?.choices ?? []).map(c => worthOf(state, content, c, follow, depth + 1).net), 0);
        net += best * follow;
        continue;
      }
      if (e.do) continue;
      if (typeof e.money === 'number') add(e.money);
      else if (e.stock && typeof e.by === 'number') add(e.by * (truePrice(state, content, home, e.stock) ?? 0));
      else if ((e.rep || e.trust) && typeof e.by === 'number') { standing += e.by; regard[e.rep ?? 'trust'] = (regard[e.rep ?? 'trust'] ?? 0) + e.by; }
    }
  };
  walk(choice.now); walk(choice.later);
  return { net, outlay, standing, regard };
}
/** The choices a bot would take, best first. `open` are the ones whose requirements hold. */
const standingOf = (w, state, temper) => Object.entries(w.regard).reduce((n, [g, by]) => n + by * state.money * (temper[g] ?? 0), 0);
export function ranked(bot, state, content, open, roll, temper = {}) {
  if (bot === 'random') return shuffle(open, roll);
  if (bot === 'first') return open;
  const scored = open.map((c, i) => ({ c, i, w: worthOf(state, content, c, bot === 'greedy' ? (temper.follow ?? 1) : 1) }));
  const by = bot === 'greedy'
    ? (a, b) => (b.w.net + standingOf(b.w, state, temper)) - (a.w.net + standingOf(a.w, state, temper)) || a.i - b.i
    : (a, b) => a.w.outlay - b.w.outlay || b.w.net - a.w.net || b.w.standing - a.w.standing || a.i - b.i;
  return scored.sort(by).map(x => x.c);
}

function answerPapers(state, content, bot, roll, out, temper) {
  let s = state;
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const choices = paperChoices(s, content, p.id);
    const open = choices.filter(c => holds(c.requires, s, content));
    const order = ranked(bot, s, content, open, roll, temper);
    if (p.kind === 'card') {
      out.offers[p.ref] = (out.offers[p.ref] ?? 0) + 1;
      if (open.length >= 2) out.multi[p.ref] = (out.multi[p.ref] ?? 0) + 1;   // a real choice: two or more can be taken
    }
    let done = false;
    for (const c of order) {
      try { s = choose(s, content, p.id, c.id); done = true; if (p.kind === 'card' && open.length >= 2) { const k = `${p.ref}|${c.id}`; out.takes[k] = (out.takes[k] ?? 0) + 1; } break; } catch { /* next choice */ }
    }
    if (!done) throw new Error(`bots: no choice of "${p.ref}" can be taken`);
  }
  return s;
}
function shuffle(list, roll) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(roll() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** What the house is worth at the end: money, the warehouse at home prices, less loans owed. A stand-in
    for the score (not built yet): it counts wealth only, not who came home. */
export function netWorth(state, content) {
  const home = cityOf(content, 'bots').home;
  let w = state.money;
  for (const [g, n] of Object.entries(state.stock)) w += n * (truePrice(state, content, home, g) ?? 0);
  for (const l of state.loans ?? []) w -= l.principal ?? 0;
  return w;
}

/** One whole game. Returns { bot, seed, house, worth, trips: [profit share per round trip], routes: {id: count},
    cards: [ids drawn], offers/multi/takes: {card: n, 'card|choice': n}, brokeBy: season index or null, survivors, lost } */
export function playGame(content, { bot, seed, house, length = DEFAULTS.length }) {
  if (!BOTS.includes(bot) && !EXTRA_BOTS.includes(bot)) throw new Error(`bots: no bot called "${bot}"`);
  const roll = dice(seed);
  const tdice = dice(seed + 77); tdice(); tdice();   // the first draws of a nearby seed are alike, so two are spent
  const temper = Object.fromEntries([...REP_GROUPS, 'trust'].map(g => [g, tdice() * STANDING_MAX]).concat([['follow', tdice()]]));   // greedy's regard for standing this game; the others do not read it
  let s = newGame(content, { seed, length, house });
  const out = { bot, seed, house, trips: [], tripRoute: [], gross: [], capital: [], routes: {}, brokeBy: null, lost: 0, settled: 0, offers: {}, multi: {}, takes: {} };
  const routeOfX = {};   // expedition id to its route, so a return or a settlement can be told by where it went
  for (let guard = 0; guard < 500; guard++) {
    if (s.phase === 'interlude') { s = openSeason(s, content); continue; }
    if (s.phase === 'recall') {
      // careful brings people home; the others leave them
      const decisions = bot === 'careful' ? Object.fromEntries(s.expeditions.map(x => [x.id, 'recall'])) : {};
      s = recall(s, content, decisions);
      continue;
    }
    if (s.phase === 'ended') break;
    if (s.phase !== 'desk') throw new Error(`bots: unexpected phase ${s.phase}`);
    // returns are on the desk now: note them before answering
    for (const p of s.desk) {
      if (p.kind === 'return' && p.state === 'open') {
        // the house's own return: what it made after the agent's wage, over what it put in. The paper does
        // not state the house's stake, so it is rebuilt: what the house was paid, less what it made, less the wage.
        const wage = -(p.data.account.find(r => /'s wage$/.test(r.label))?.amount ?? 0);
        const stake = p.data.shares.house - p.data.houseNet - wage;
        if (stake > 0) {
          out.trips.push(p.data.houseNet / stake);
          out.tripRoute.push(routeOfX[p.expedition]);
          out.gross.push((p.data.houseNet + wage) / stake);
          out.capital.push(stake);
        }
      } else if (p.kind === 'lost' && p.state === 'open') out.lost++;
    }
    s = answerPapers(s, content, bot, roll, out, temper);
    for (const agent of freeAgents(s, content)) {
      const p = plan(bot, s, content, agent, roll);
      if (!p) continue;
      s = outfit(s, content, p);
      out.routes[p.route] = (out.routes[p.route] ?? 0) + 1;
    }
    const broke = s.money < 0 && !Object.values(s.stock).some(n => n > 0) && !s.expeditions.length;
    if (broke && out.brokeBy === null) out.brokeBy = s.t + 1;
    const can = canEndSeason(s);
    if (!can.ok) throw new Error(`bots: ${can.reason}`);
    for (const x of s.expeditions) routeOfX[x.id] = x.route;
    const stakes = Object.fromEntries(s.expeditions.map(x => [x.id, x.staked.house]));
    const logAt = s.log.length;
    s = endSeason(s, content);
    if (s.phase === 'interlude') {
      // an expedition still on the road at the act jump is settled off stage (ARCHITECTURE 4.7): it counts as a
      // trip here, so a road too long to finish inside an act of eight seasons is judged like any other
      // the jump's entry among this closing's entries (the season entry is written after it, MER-60b)
      const jumped = s.log.slice(logAt).find(e => e.kind === 'jump');
      for (const line of jumped ? jumped.settled : []) {
        if (line.result === 'lost') out.lost++;
        else if (stakes[line.expedition] > 0) { out.trips.push(line.houseNet / stakes[line.expedition]); out.tripRoute.push(routeOfX[line.expedition]); out.settled++; }
      }
    }
  }
  if (s.phase !== 'ended') throw new Error(`bots: game ${bot}/${seed} did not end (phase ${s.phase})`);
  out.worth = netWorth(s, content);
  const sc = score(s, content);   // the engine's own score of the finished game (ARCHITECTURE 4.10)
  out.score = sc.total;
  out.rank = sc.rank;
  out.parts = Object.fromEntries(sc.parts.map(p => [p.id, p.points]));
  out.sum = sc.sum;
  // what the four parts are made of, so a rate can be tried on a finished run without replaying it
  const homeAgents = content.agents.map(a => s.agents[a.id]).filter(r => r?.hired && r.where === cityOf(content, 'bots').home && (r.trips ?? 0) > 0);
  out.raw = { net: netWealth(s, content).net, rep: REP_GROUPS.reduce((n, g) => n + (s.rep[g] ?? 0), 0), home: homeAgents.length,
    trusted: homeAgents.filter(r => r.trust >= TRUST_BONUS_AT).length, pages: (s.notebook ?? []).length, multiplier: content.houses.find(h => h.id === house).multiplier ?? 1 };
  out.cards = Object.keys(out.offers);   // a follow-up reaches the desk by an effect, so `seen` does not count it
  out.repAgents = s.rep.agents;
  out.survivors = Object.values(s.agents).filter(a => a.hired && a.where !== 'dead').length;
  return out;
}

// ---- statistics
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const num = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : 'n/a');

/** Plays every bot `games` times and returns { results: {bot: [game]}, offered, taken }.
    `workers` games run on that many threads (0 or 1: in this thread); the results are the same either way. */
export async function run({ games = DEFAULTS.games, seed0 = DEFAULTS.seed0, bots = BOTS, house = null, length = DEFAULTS.length, workers = 1, content: given } = {}) {
  const content = given ?? await loadContent('cairo', { fs });
  const houses = house ? [house] : content.houses.map(h => h.id);
  const jobs = [];
  for (const bot of bots) for (let i = 0; i < games; i++) jobs.push({ bot, seed: seed0 + i, house: houses[i % houses.length], length });
  let played;
  if (workers > 1) {
    played = new Array(jobs.length);
    let at = 0;
    const lane = () => new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { lane: true } });
      const feed = () => { if (at >= jobs.length) { w.postMessage(null); return; } const n = at++; w.postMessage({ n, job: jobs[n] }); };
      w.on('message', m => { if (m.error) { reject(new Error(m.error)); return; } played[m.n] = m.game; feed(); });
      w.on('error', reject);
      w.on('exit', () => resolve());
      feed();
    });
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, lane));
  } else played = jobs.map(j => playGame(content, j));
  const results = Object.fromEntries(bots.map(b => [b, []]));
  const offered = {}, taken = {};
  for (const g of played) {
    results[g.bot].push(g);
    for (const [r, n] of Object.entries(g.multi)) offered[`${g.bot}|${r}`] = (offered[`${g.bot}|${r}`] ?? 0) + n;
    for (const [k, n] of Object.entries(g.takes)) taken[`${g.bot}|${k}`] = (taken[`${g.bot}|${k}`] ?? 0) + n;
  }
  const startWorth = Object.fromEntries(houses.map(h => [h, netWorth(newGame(content, { seed: 1, length, house: h }), content)]));
  return { content, results, offered, taken, games, houses, startWorth, length };
}

// a worker thread: plays the games it is handed one by one
if (!isMainThread && workerData?.lane) {
  const content = await loadContent('cairo', { fs });
  parentPort.on('message', m => {
    if (m === null) { process.exit(0); }
    try { parentPort.postMessage({ n: m.n, game: playGame(content, m.job) }); } catch (e) { parentPort.postMessage({ error: `${m.job.bot}/${m.job.seed}: ${e.stack ?? e.message}` }); }
  });
}

/** The share of the expeditions sent that ended in each direction, over a list of games. */
export function directionShares(content, games) {
  const dest = Object.fromEntries(content.routes.map(r => [r.id, r.to]));
  const n = Object.fromEntries(Object.keys(DIRECTIONS).map(d => [d, 0]));
  let all = 0;
  for (const g of games) for (const [r, c] of Object.entries(g.routes)) {
    const d = directionOf(dest[r]);
    if (d === null) throw new Error(`bots: route "${r}" ends at "${dest[r]}", which belongs to no direction`);
    n[d] += c; all += c;
  }
  return Object.fromEntries(Object.entries(n).map(([d, c]) => [d, all ? c / all : 0]));
}

/** The median round trip profit after wage by direction, over the trips of the careful, greedy and qirad bots
    together (MER-51b: the long roads paid most). Returns { direction: { median, n } }; the median is NaN with no trip. */
export function directionMedians(content, results) {
  const dest = Object.fromEntries(content.routes.map(r => [r.id, r.to]));
  const by = Object.fromEntries(Object.keys(DIRECTIONS).map(d => [d, []]));
  for (const b of SENSIBLE) for (const g of results[b] ?? []) g.trips.forEach((t, i) => by[directionOf(dest[g.tripRoute[i]])]?.push(t));
  return Object.fromEntries(Object.entries(by).map(([d, l]) => [d, { median: l.length ? quantile(l, 0.5) : NaN, n: l.length }]));
}

/** Every threshold against a run. Returns { rows: [{ name, value, limit, ok, note }], ok }. */
export function check({ content, results, offered, taken, games }) {
  const rows = [];
  const add = (name, value, limit, ok, note = '', pending = false, fmt = 'pct') => rows.push({ name, value, limit, ok: ok || pending, pending: pending && !ok, note, fmt });
  const mode = list => { const m = {}; for (const r of list) m[r] = (m[r] ?? 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]; };

  if (results.greedy) {
    const modal = results.greedy.map(g => mode(Object.entries(g.routes).flatMap(([r, n]) => Array(n).fill(r)))[0]).filter(Boolean);
    const [route, n] = mode(modal);
    add('greedy: one route is its most-used in at most', modal.length ? n / modal.length : 0, LIMITS.routeShare, !modal.length || n / modal.length <= LIMITS.routeShare, route ?? 'no route sent');
  }
  if (results.careful) {
    const broke = results.careful.filter(g => g.brokeBy !== null && g.brokeBy <= LIMITS.brokeBySeason).length / results.careful.length;
    add(`careful: broke by season ${LIMITS.brokeBySeason} in at most`, broke, LIMITS.brokeShare, broke <= LIMITS.brokeShare);
    if (results.random) {
      const med = quantile(results.careful.map(g => g.score), 0.5), p75 = quantile(results.random.map(g => g.score), 0.75);
      add('careful median score above random 75th percentile', med, p75, med > p75, `random median ${num(quantile(results.random.map(g => g.score), 0.5))}`, false, 'num');
    }
  }
  // the score's ranks (MER-85)
  const ranks = [...(cityOf(content, 'bots').score?.ranks ?? [])].sort((a, b) => a.from - b.from);
  const rankOf = total => ranks.reduce((r, k, i) => (total >= k.from ? i : r), 0);
  if (ranks.length) {
    if (results.careful) {
      const med = quantile(results.careful.map(g => g.score), 0.5), at = ranks[rankOf(med)].name;
      add(`careful: median score ends in "${LIMITS.carefulRank}"`, med, `${ranks.find(r => r.name === LIMITS.carefulRank)?.from}+`, at === LIMITS.carefulRank, at, false, 'num');
    }
    if (results.random) {
      const med = quantile(results.random.map(g => g.score), 0.5);
      add(`random: median score in one of the lowest ${LIMITS.randomBelow} ranks`, med, `under ${ranks[LIMITS.randomBelow]?.from}`, rankOf(med) < LIMITS.randomBelow, ranks[rankOf(med)].name, false, 'num');
    }
    const every = Object.values(results).flat(), top = ranks.at(-1).from, reached = every.filter(g => g.score >= top).length;
    add('the top rank is reached by the best game', Math.max(...every.map(g => g.score)), `${top}+`, reached >= 1, `${reached} of ${every.length} games`, false, 'num');
    add(`the top rank is reached by at most ${pct(LIMITS.topRankShare, 0)} of games`, reached / every.length, LIMITS.topRankShare, reached / every.length <= LIMITS.topRankShare);
  }
  for (const bot of SENSIBLE.filter(b => results[b])) {
    const med = k => quantile(results[bot].map(g => g.parts[k]), 0.5), sum = quantile(results[bot].map(g => g.sum), 0.5);
    const shares = Object.keys(results[bot][0].parts).map(k => [k, med(k) / sum]).sort((a, b) => b[1] - a[1]);
    add(`${bot}: no one part of the score is over ${pct(LIMITS.partShare, 0)} of the median total`, shares[0][1], LIMITS.partShare, shares[0][1] <= LIMITS.partShare, shares.map(([k, x]) => `${k} ${pct(x, 0)}`).join(', '));
  }
  // the balance target: what the house keeps from a sensible round trip, after the agent's wage (qirad bots share the profit, random is not sensible)
  for (const bot of ['careful', 'greedy']) {
    if (!results[bot]) continue;
    const trips = results[bot].flatMap(g => g.trips);
    const m = trips.length ? quantile(trips, 0.5) : NaN;
    add(`${bot}: median round trip profit, after wage, within`, m, `${pct(LIMITS.tripMedian[0], 0)} to ${pct(LIMITS.tripMedian[1], 0)}`, m >= LIMITS.tripMedian[0] && m <= LIMITS.tripMedian[1], trips.length ? `${trips.length} trips` : 'no trip made');
  }
  for (const [bot, list] of Object.entries(results)) {
    const trips = list.flatMap(g => g.trips);
    if (!trips.length) continue;
    const m = quantile(trips, 0.5);
    add(`${bot}: median round trip stays under a doubling`, m, LIMITS.tripMedianMax, m < LIMITS.tripMedianMax, `${trips.length} trips`);
  }
  // directions: where the sensible bots' trips went (MER-51)
  const sensible = SENSIBLE.filter(b => results[b]);
  if (sensible.length) {
    const share = directionShares(content, sensible.flatMap(b => results[b]));
    for (const d of Object.keys(DIRECTIONS)) {
      if (d === 'mediterranean') add('mediterranean: share of careful, greedy and qirad trips at most', share[d], LIMITS.mediterraneanMax, share[d] <= LIMITS.mediterraneanMax, `${sensible.join(', ')}`);
      else add(`${d}: share of careful, greedy and qirad trips at least`, share[d], LIMITS.directionMin, share[d] >= LIMITS.directionMin, `${sensible.join(', ')}`);
    }
  }
  // the long roads paid most (MER-51b): the Red Sea and India's median trip is at least the Mediterranean's
  if (sensible.length) {
    const med = directionMedians(content, results);
    const r = med['redsea-india'], m = med.mediterranean;
    add('redsea-india: median round trip profit at least the mediterranean\'s', r.median, m.median, r.n > 0 && m.n > 0 && r.median >= m.median, `${r.n} and ${m.n} trips`);
  }
  // rep.agents: careful must not sit at the ceiling (3) in most games (MER-61b)
  if (results.careful) {
    const pinned = results.careful.filter(g => g.repAgents === 3).length / results.careful.length;
    add('careful: rep.agents ends at 3 in fewer than', pinned, LIMITS.agentsPinned, pinned < LIMITS.agentsPinned, 'share of games');
  }
  // cards drawn: the union over every bot's games, per card
  const total = Object.values(results).reduce((n, l) => n + l.length, 0);
  const drawn = {};
  for (const list of Object.values(results)) for (const g of list) for (const c of g.cards) drawn[c] = (drawn[c] ?? 0) + 1;
  const never = content.cards.filter(c => (drawn[c.id] ?? 0) / total < LIMITS.cardDrawn).map(c => `${c.id} ${pct((drawn[c.id] ?? 0) / total, 2)}`);
  add(`every card drawn in at least ${pct(LIMITS.cardDrawn, 0)} of games: cards short`, never.length, 0, never.length === 0, never.join(', '), false, 'num');
  // a choice greedy takes nearly always
  if (results.greedy) {
    const over = [], exempt = [];
    for (const [k, n] of Object.entries(offered)) {
      const [b, ref] = k.split('|');
      if (b !== 'greedy' || n < LIMITS.choiceMinOffers) continue;
      for (const [tk, tn] of Object.entries(taken)) {
        const [tb, tref, choice] = tk.split('|');
        if (tb === 'greedy' && tref === ref && tn / n > LIMITS.choiceTaken) (LIMITS.choiceExempt.includes(`${ref}/${choice}`) ? exempt : over).push(`${ref}/${choice} ${pct(tn / n, 0)}`);
      }
    }
    add(`greedy: choices taken over ${pct(LIMITS.choiceTaken, 0)} of the offers with a real choice`, over.length, 0, over.length === 0, `${over.length ? over.join(', ') : 'none'}${exempt.length ? `; ${exempt.length} listed in LIMITS.choiceExempt are skipped` : ''}`, false, 'num');
  }
  return { rows, ok: rows.every(r => r.ok) };
}

export function table({ content, results, houses, games, startWorth, length = DEFAULTS.length }, checked) {
  const lines = [];
  lines.push(`${games} games per bot, length "${length}", houses: ${houses.join(', ')}`);
  lines.push('');
  lines.push(['bot', 'worth p25', 'median', 'p75', 'trips', 'net median', 'net p25', 'net p75', 'before wage', 'stake med', 'lost/game', 'alive', 'broke by 5'].map((h, i) => (i ? h.padStart(11) : h.padEnd(9))).join(' '));
  for (const [bot, list] of Object.entries(results)) {
    const w = list.map(g => g.worth), t = list.flatMap(g => g.trips);
    const cells = [bot.padEnd(9), num(quantile(w, 0.25)), num(quantile(w, 0.5)), num(quantile(w, 0.75)), String(t.length), pct(quantile(t, 0.5)), pct(quantile(t, 0.25)), pct(quantile(t, 0.75)),
      pct(quantile(list.flatMap(g => g.gross), 0.5)), num(quantile(list.flatMap(g => g.capital), 0.5)),
      (list.reduce((n, g) => n + g.lost, 0) / list.length).toFixed(2), (list.reduce((n, g) => n + g.survivors, 0) / list.length).toFixed(2),
      pct(list.filter(g => g.brokeBy !== null && g.brokeBy <= LIMITS.brokeBySeason).length / list.length)];
    lines.push(cells.map((c, i) => (i ? String(c).padStart(11) : c)).join(' '));
  }
  lines.push('');
  lines.push('score (the engine\'s, with the house multiplier): quantiles per bot, then the median points of each part');
  lines.push(['bot', 'p5', 'p25', 'median', 'p75', 'p95', 'best', 'wealth', 'reputation', 'people', 'notebook', 'sum'].map((h, i) => (i ? h.padStart(10) : h.padEnd(9))).join(' '));
  for (const [bot, list] of Object.entries(results)) {
    const sc = list.map(g => g.score), part = k => num(quantile(list.map(g => g.parts[k]), 0.5));
    lines.push([bot.padEnd(9), ...[0.05, 0.25, 0.5, 0.75, 0.95, 1].map(p => num(quantile(sc, p))), part('wealth'), part('reputation'), part('people'), part('notebook'), num(quantile(list.map(g => g.sum), 0.5))].map((c, i) => (i ? String(c).padStart(10) : c)).join(' '));
  }
  lines.push('');
  lines.push('part quantiles (p25 / median / p75 of the points, before the multiplier):');
  for (const [bot, list] of Object.entries(results)) {
    lines.push(`  ${bot.padEnd(9)}${Object.keys(list[0].parts).map(k => `${k} ${[0.25, 0.5, 0.75].map(p => num(quantile(list.map(g => g.parts[k]), p))).join('/')}`).join('   ')}`);
  }
  lines.push('');
  lines.push('rank reached (share of games):');
  const rankNames = [...(cityOf(content, 'bots').score?.ranks ?? [])].sort((a, b) => a.from - b.from).map(r => r.name);
  for (const [bot, list] of Object.entries(results)) {
    lines.push(`  ${bot.padEnd(9)}${rankNames.map((n, i) => `${i}: ${pct(list.filter(g => g.rank === n).length / list.length, 1)}`).join('   ')}`);
  }
  lines.push('');
  lines.push('worth by house (median; start is the house before its first season):');
  for (const h of houses) {
    lines.push(`  ${h.padEnd(9)}start ${num(startWorth[h])}   ${Object.entries(results).map(([b, l]) => `${b} ${num(quantile(l.filter(g => g.house === h).map(g => g.worth), 0.5))}`).join('   ')}`);
  }
  lines.push('');
  lines.push('trips by direction (share of expeditions sent):');
  const names = Object.keys(DIRECTIONS);
  for (const [bot, list] of Object.entries(results)) {
    const sh = directionShares(content, list);
    lines.push(`  ${bot.padEnd(9)}${names.map(d => `${d} ${pct(sh[d], 0)}`).join('   ')}`);
  }
  if (SENSIBLE.every(b => results[b])) {
    const sh = directionShares(content, SENSIBLE.flatMap(b => results[b]));
    lines.push(`  ${'together'.padEnd(9)}${names.map(d => `${d} ${pct(sh[d], 0)}`).join('   ')}   (careful, greedy, qirad)`);
  }
  lines.push('');
  lines.push('median round trip profit after wage, by direction (trips; careful, greedy and qirad together):');
  {
    const med = directionMedians(content, results);
    lines.push(`  ${names.map(d => `${d} ${pct(med[d].median)} (${med[d].n})`).join('   ')}`);
  }
  lines.push('');
  lines.push('rep.agents at game end (share of games at -3 .. 3):');
  for (const [bot, list] of Object.entries(results)) {
    lines.push(`  ${bot.padEnd(9)}${[-3, -2, -1, 0, 1, 2, 3].map(v => `${v >= 0 ? '+' : ''}${v}: ${pct(list.filter(g => g.repAgents === v).length / list.length, 0)}`).join('   ')}`);
  }
  lines.push('');
  lines.push('routes sent (share of all expeditions):');
  for (const [bot, list] of Object.entries(results)) {
    const m = {}; let n = 0;
    for (const g of list) for (const [r, c] of Object.entries(g.routes)) { m[r] = (m[r] ?? 0) + c; n += c; }
    lines.push(`  ${bot.padEnd(9)}${Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, c]) => `${r} ${pct(c / n, 0)}`).join('   ') || 'none'}`);
  }
  lines.push('');
  for (const r of checked.rows) {
    const f = x => (typeof x !== 'number' ? x : r.fmt === 'pct' ? pct(x, 2) : num(x));
    lines.push(`${r.pending ? 'pend' : r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${f(r.value)} (limit ${f(r.limit)})${r.note ? ` [${r.note}]` : ''}`);
  }
  return lines.join('\n');
}

// ---- command line
const parseArgs = argv => {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`bots: unknown argument "${argv[i]}"`);
    o[argv[i].slice(2)] = argv[++i];
  }
  return o;
};

if (isMainThread && import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2));   // only when run, never when imported
  const bots = args.bots ? args.bots.split(',') : BOTS;
  for (const b of bots) if (!BOTS.includes(b) && !EXTRA_BOTS.includes(b)) { console.error(`bots: no bot called "${b}"`); process.exit(2); }
  const lengthArg = args.length ?? 'both';
  const lengths = lengthArg === 'both' ? ['acts', 'full'] : [lengthArg];
  const started = Date.now();
  let allOk = true;
  for (const length of lengths) {
    const res = await run({ games: Number(args.games ?? DEFAULTS.games), seed0: Number(args.seed ?? DEFAULTS.seed0), bots, house: args.house ?? null, length, workers: Number(args.workers ?? 3) });
    const checked = check(res);
    console.log(table({ ...res, length }, checked));
    console.log(`\n${length}: ${checked.ok ? 'balance checks passed' : 'balance checks FAILED'} (${((Date.now() - started) / 1000).toFixed(1)} s so far)\n`);
    allOk = allOk && checked.ok;
  }
  process.exitCode = allOk ? 0 : 1;
}
