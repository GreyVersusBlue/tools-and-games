// Balance bots (ARCHITECTURE 7.3): node tools/bots.mjs [--games N] [--seed S] [--bots a,b] [--house id] [--workers 3]
//
// Plays N seeded three-act games per bot through the engine's public surface (index.js) and
// prints a table. Exits 1 when a threshold below is breached. No browser, no clock, plain Node.
//
// The bots have no card policy yet (M3 adds one): at every card a bot takes the first choice
// that holds, and `random` takes a random one. They differ in what they send out:
//   careful  open legs only (no waiting), small cargo, goods from the warehouse first, own money
//   greedy   the biggest margin by last known price, a big cargo, buys goods back at the far end
//   random   any destination, any good, any size
//   qirad    greedy's choice and a medium cargo, always under a qirad with partners
//
// Defaults: 2,000 games per bot (about 11 minutes on three threads), 20,000 by hand (--games 20000). Games rotate through the
// houses (--house to fix one). Seed of game i is SEED0 + i, so a run is repeatable.
// test/bots-smoke.mjs imports `playGame` and `run` and plays 200 games for CI.

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadContent } from '../js/data.js';
import { newGame, openSeason, choose, paperChoices, canEndSeason, endSeason, recall, outfit, destinations } from '../js/engine/index.js';
import { holds } from '../js/engine/conditions.js';
import { truePrice, baseOf } from '../js/engine/market.js';
import { cityOf } from '../js/engine/state.js';
import { next } from '../js/engine/rng.js';

// ---- thresholds (the whole of the balance contract; change them here and nowhere else)
export const LIMITS = {
  routeShare: 0.60,        // no single route is greedy's most-used route in more than this share of greedy games
  brokeBySeason: 5,        // a careful player is broke (money under 0, empty warehouse, nothing on the road) by this season...
  brokeShare: 0.02,        // ...in more than this share of games
  carefulMedianAbove: 'p75', // careful's median score is above random's 75th percentile (the key names the percentile)
  cardDrawn: 0.01,         // every card of the content is drawn in at least this share of all games
  choiceTaken: 0.90,       // greedy takes no one choice more than this share of the times its card is offered (card policy: M3)
  choicePending: true,     // true until M3 gives a bot a card policy: with 'the first choice that holds' the number only measures list order, so it is printed and does not fail the run
  choiceMinOffers: 30,     // a card offered fewer times than this is not judged on its choices
  tripMedian: [0.10, 0.30],// careful's and greedy's median profit on a round trip after the wage, as a share of the house's stake. 10 to 30 percent is a design target (DECISIONS 2026-11-17 08:50), not a recorded figure; the one recorded anchor is Goitein, Letters of Medieval Jewish Traders, 1973, p. 35 note 27: profits were as a rule surprisingly low and a near doubling exceptional (so tripMedianMax)
  tripMedianMax: 1.0,      // no bot's median round trip reaches a doubling
};
export const DEFAULTS = { games: 2000, seed0: 1000, length: 'acts' };
export const BOTS = ['careful', 'greedy', 'random', 'qirad'];

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

/** Every (destination, good) the house could send now, with the margin by what the bot knows. */
function offers(state, content) {
  const home = cityOf(content, 'bots').home;
  const out = [];
  for (const d of destinations(state, content)) {
    const dest = stopOf(content, d.stop);
    for (const g of Object.keys(dest.sells ?? {})) {
      const homeP = truePrice(state, content, home, g);
      if (homeP === null) continue;
      const there = priceOf(state, content, d.stop, g);
      out.push({ ...d, good: g, homeP, there, margin: there / homeP - 1 });
    }
  }
  return out;
}

const freeAgents = (state, content) => content.agents.filter(a => {
  const r = state.agents[a.id];
  return r?.hired && r.where === cityOf(content, 'bots').home && !state.expeditions.some(x => x.agent === a.id);
});

/** A plan for `agent` or null: the policy of each bot, ending in `sizes` tried from big to small. */
function plan(bot, state, content, agent, roll) {
  const all = offers(state, content);
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
  const have = state.stock[g] ?? 0;
  const afford = Math.floor((state.money * share) / pick.homeP);
  const depth = stopOf(content, home).sells[g]?.depth ?? 20;
  let n = Math.min(cap, depth, bot === 'careful' ? Math.max(have > 0 ? have : 0, afford) : have + afford);
  if (bot === 'careful' && have > 0) n = Math.min(n, Math.max(have, 1));
  // back: goods that are cheaper there than at home by what the bot knows
  const back = Object.keys(dest.sells).filter(b => b !== g && truePrice(state, content, home, b) !== null
    && priceOf(state, content, pick.stop, b) < truePrice(state, content, home, b) * 0.8)
    .sort((a, b) => (priceOf(state, content, pick.stop, a) / truePrice(state, content, home, a)) - (priceOf(state, content, pick.stop, b) / truePrice(state, content, home, b)))
    .slice(0, buyBack);
  const base = { agent: agent.id, route: pick.route, purse: 0, sell: [g], buy: back };
  // shrink until the engine takes it (it checks money, stock and every rule in words)
  for (; n >= 1; n = n > 4 ? Math.floor(n * 0.7) : n - 1) {
    const p = { ...base, cargo: { [g]: n } };
    if (contract === 'qirad') {
      const capital = n * pick.homeP;
      p.contract = 'qirad';
      p.partners = Math.max(1, Math.floor(capital * 0.5));
    }
    try { outfit(state, content, p); return p; } catch { /* smaller */ }
  }
  return null;
}

// ---- cards: no policy yet
function answerPapers(state, content, bot, roll, out) {
  let s = state;
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const choices = paperChoices(s, content, p.id);
    const open = choices.filter(c => holds(c.requires, s, content));
    const order = bot === 'random' ? shuffle(open, roll) : open;
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
  if (!BOTS.includes(bot)) throw new Error(`bots: no bot called "${bot}"`);
  const roll = dice(seed);
  let s = newGame(content, { seed, length, house });
  const out = { bot, seed, house, trips: [], gross: [], capital: [], routes: {}, brokeBy: null, lost: 0, offers: {}, multi: {}, takes: {} };
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
          out.gross.push((p.data.houseNet + wage) / stake);
          out.capital.push(stake);
        }
      } else if (p.kind === 'lost' && p.state === 'open') out.lost++;
    }
    s = answerPapers(s, content, bot, roll, out);
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
    s = endSeason(s, content);
  }
  if (s.phase !== 'ended') throw new Error(`bots: game ${bot}/${seed} did not end (phase ${s.phase})`);
  out.worth = netWorth(s, content);
  out.cards = Object.keys(out.offers);   // a follow-up reaches the desk by an effect, so `seen` does not count it
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
  return { content, results, offered, taken, games, houses, startWorth };
}

// a worker thread: plays the games it is handed one by one
if (!isMainThread && workerData?.lane) {
  const content = await loadContent('cairo', { fs });
  parentPort.on('message', m => {
    if (m === null) { process.exit(0); }
    try { parentPort.postMessage({ n: m.n, game: playGame(content, m.job) }); } catch (e) { parentPort.postMessage({ error: `${m.job.bot}/${m.job.seed}: ${e.stack ?? e.message}` }); }
  });
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
      const med = quantile(results.careful.map(g => g.worth), 0.5), p75 = quantile(results.random.map(g => g.worth), 0.75);
      add('careful median score above random 75th percentile', med, p75, med > p75, `random median ${num(quantile(results.random.map(g => g.worth), 0.5))}`, false, 'num');
    }
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
  // cards drawn: the union over every bot's games, per card
  const total = Object.values(results).reduce((n, l) => n + l.length, 0);
  const drawn = {};
  for (const list of Object.values(results)) for (const g of list) for (const c of g.cards) drawn[c] = (drawn[c] ?? 0) + 1;
  const never = content.cards.filter(c => (drawn[c.id] ?? 0) / total < LIMITS.cardDrawn).map(c => `${c.id} ${pct((drawn[c.id] ?? 0) / total, 2)}`);
  add(`every card drawn in at least ${pct(LIMITS.cardDrawn, 0)} of games: cards short`, never.length, 0, never.length === 0, never.join(', '), false, 'num');
  // a choice greedy takes nearly always
  if (results.greedy) {
    const over = [];
    for (const [k, n] of Object.entries(offered)) {
      const [b, ref] = k.split('|');
      if (b !== 'greedy' || n < LIMITS.choiceMinOffers) continue;
      for (const [tk, tn] of Object.entries(taken)) {
        const [tb, tref, choice] = tk.split('|');
        if (tb === 'greedy' && tref === ref && tn / n > LIMITS.choiceTaken) over.push(`${ref}/${choice} ${pct(tn / n, 0)}`);
      }
    }
    add(`greedy: choices taken over ${pct(LIMITS.choiceTaken, 0)} of the offers with a real choice`, over.length, 0, over.length === 0, `${over.length ? over.join(', ') : 'none'}${LIMITS.choicePending ? '; pending the card policy (M3), not judged' : ''}`, LIMITS.choicePending, 'num');
  }
  return { rows, ok: rows.every(r => r.ok) };
}

export function table({ results, houses, games, startWorth }, checked) {
  const lines = [];
  lines.push(`${games} games per bot, three acts, houses: ${houses.join(', ')}`);
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
  lines.push('worth by house (median; start is the house before its first season):');
  for (const h of houses) {
    lines.push(`  ${h.padEnd(9)}start ${num(startWorth[h])}   ${Object.entries(results).map(([b, l]) => `${b} ${num(quantile(l.filter(g => g.house === h).map(g => g.worth), 0.5))}`).join('   ')}`);
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
const args = (argv => {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`bots: unknown argument "${argv[i]}"`);
    o[argv[i].slice(2)] = argv[++i];
  }
  return o;
})(process.argv.slice(2));

if (isMainThread && import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bots = args.bots ? args.bots.split(',') : BOTS;
  for (const b of bots) if (!BOTS.includes(b)) { console.error(`bots: no bot called "${b}"`); process.exit(2); }
  const started = Date.now();
  const res = await run({ games: Number(args.games ?? DEFAULTS.games), seed0: Number(args.seed ?? DEFAULTS.seed0), bots, house: args.house ?? null, workers: Number(args.workers ?? 3) });
  const checked = check(res);
  console.log(table(res, checked));
  console.log(`\n${checked.ok ? 'balance checks passed' : 'balance checks FAILED'} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  process.exitCode = checked.ok ? 0 : 1;
}
