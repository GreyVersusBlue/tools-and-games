// balance.mjs — play the shop N times and report what happened.
//
// Run:  node Projects/corner-and-kettle/test/balance.mjs [runs]
//       node Projects/corner-and-kettle/test/balance.mjs 200 --verbose
//       node Projects/corner-and-kettle/test/balance.mjs 50 --days 10
//
// Why this exists: three rounds of balance claims and not one of them could be
// reproduced. Round 1's headline served more customers than it was offered;
// round 3's day-10 and day-20 table came out of scripts that were never
// committed and a real 136-second shift each. With Phase 1's seeded sim a day
// costs about six milliseconds, so this plays every seed from 0x5EED up under
// three scripted players (test/autopilot.mjs) and prints per day and per
// prestige level: offered, served, left in line, drinks against food, gross,
// wages, net, accuracy, best streak, reputation, and how many customers were
// served while they still had patience.
//
// It also runs the two sweeps nobody had run: barista fumble chance across the
// `trained` and `grinder` multipliers, and the prestige floors at levels 0
// through 6 on day 30.
//
// Exits non-zero on one thing (locked decision #13): the patient player's
// numbers outside BAND. Every batch is seeded 0x5EED + i, so the same code over
// the same run count gives the same numbers to the last decimal on every
// machine — a change here is a change in the game, never noise.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeShop, playRun, playDay, patient, eager, shopper, HAND_MS } from "./autopilot.mjs";
import { BARISTA_TIERS } from "../js/content.js";

const DEFAULT_RUNS = 100;
const DEFAULT_DAYS = 30;
const PRESTIGE_AFTER = 10; // the shop reopens at the close of this day, once

/**
 * The band. Two batches, because one day of this game cannot be both.
 *
 *   run     the patient player, 100 seeds, 30 days, reopening once at the
 *           close of day 10, hands every HAND_MS. This is "can the shop be
 *           played" and "is it free".
 *   stress  the same player on day 30 at prestige level 5, the hardest day
 *           the game has: both floors are at their bottom (spawnFactor 0.30,
 *           patienceFactor 0.45) and the reopen took every upgrade away.
 *           This is the batch where patience does anything at all.
 *
 * It is a guard-rail against "unplayable" and "free", not a target, and every
 * rail is wide on purpose. Narrow one and every tuning change becomes a
 * failing test, which is how a guard-rail gets deleted instead of fixed.
 *
 *   run.servedShare      served / offered. Below the floor one pair of hands
 *                        cannot keep up with the door. Measured 0.990.
 *   run.netPerDay        mean net over the run. The floor is unplayable, the
 *                        ceiling is free. Measured $1,927 — not the $309
 *                        round 3 wrote down; see the re-measurement block.
 *   run.accuracy         a player who serves only complete cups scores 1.0
 *                        by construction, so this floor is a check that a
 *                        barista's fumble is still caught before the serve,
 *                        not a balance number. Measured 1.000.
 *   stress.servedShare   the hardest day still mostly served. Measured 0.962.
 *   stress.patienceAtServe  patience left, as a share of patienceMax, on the
 *                        cups served that day — the number the tip is paid
 *                        from, and the only thing patience changes in this
 *                        game: nobody walks, and patience ticks only while a
 *                        customer is in the queue, never on a station.
 *                        Measured 0.905. Halving patienceFactor()'s floor
 *                        puts it at 0.796, so the floor is 0.82: the one
 *                        break this file was verified against has to land
 *                        outside it by more than rounding. The ceiling is
 *                        free — a hardest day on which nobody ever waits has
 *                        no clock.
 *
 * On an ordinary day the patience rails cannot hear anything. servedShare
 * is 0.99, the queue is empty most of the shift, and a customer's patience
 * stops moving the moment they are accepted, so the halved floor leaves a
 * 30-day run inside every rail above. That is a finding about the game, not
 * a gap in the band (locked decision #147): the queue cap of five throttles
 * the door, so "offered" is what the shop could take, not what came by.
 */
export const BAND = {
  run: {
    servedShare: { min: 0.75, max: 1.0 },
    netPerDay: { min: 600, max: 4000 },
    accuracy: { min: 0.98, max: 1.0 },
  },
  stress: {
    servedShare: { min: 0.75, max: 1.0 },
    patienceAtServe: { min: 0.82, max: 0.98 },
  },
};
export const STRESS = { runs: 50, day: 30, prestigeLevel: 5 };

/* ========================================================================= *
 * Playing a batch                                                           *
 * ========================================================================= */

/** A run that threw, shaped like one that did not, so no reader has to ask. */
const crashed = (seed, message) => ({ seed, error: message, rows: [] });

export function runBatch(runs, { days = DEFAULT_DAYS, policy = patient, prestigeAfter = [PRESTIGE_AFTER], handMs = HAND_MS, mutate = null, verbose = false } = {}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const seed = 0x5EED + i;
    const { sim, state, counters } = makeShop(seed, mutate);
    let r;
    try {
      r = { seed, error: null, rows: playRun(sim, state, { days, policy, prestigeAfter, handMs, counters }) };
    } catch (e) {
      r = crashed(seed, e.message);
    }
    results.push(r);
    if (verbose && i < 12) {
      const t = totals(r.rows);
      console.log(`  seed ${seed}  ${r.error ? "error: " + r.error : `served ${num(t.served, 4)}/${num(t.offered, 4)}  net $${num(t.net, 6)}  acc ${pct(t.accuracy)}  best streak ${num(t.bestStreak, 3)}  $${state.money} at close`}`);
    }
  }
  return results;
}

/* ========================================================================= *
 * Reading a batch                                                           *
 *                                                                           *
 * Pure: batch in, numbers out, no printing and no process.exit, so a test    *
 * can hand these a batch it built by hand and read what comes back.         *
 * ========================================================================= */

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const mean = (xs, f) => (xs.length ? sum(xs, f) / xs.length : 0);

/** One run's rows folded to one line. */
export function totals(rows) {
  const offered = sum(rows, r => r.offered), served = sum(rows, r => r.served);
  return {
    days: rows.length, offered, served,
    unserved: sum(rows, r => r.unserved), tipped: sum(rows, r => r.tipped), patienceSum: sum(rows, r => r.patienceSum),
    drinks: sum(rows, r => r.drinks), food: sum(rows, r => r.food),
    gross: sum(rows, r => r.gross), wages: sum(rows, r => r.wages), net: sum(rows, r => r.net),
    accuracy: served ? sum(rows, r => r.accuracy * r.served) / served : 1,
    bestStreak: Math.max(0, ...rows.map(r => r.bestStreak)),
    fumbles: sum(rows, r => r.fumbles), finished: sum(rows, r => r.finished),
    spent: sum(rows, r => r.spent),
  };
}

/** One row per (prestige, day), averaged across the runs that played it. */
export function dayRows(results) {
  const by = new Map();
  for (const r of results) {
    for (const row of r.rows) {
      const key = `${row.prestige}/${row.day}`;
      const acc = by.get(key) || { key, prestige: row.prestige, day: row.day, n: 0, rows: [] };
      acc.n++; acc.rows.push(row);
      by.set(key, acc);
    }
  }
  return [...by.values()]
    .sort((a, b) => a.prestige - b.prestige || a.day - b.day)
    .map(({ key, prestige, day, n, rows }) => ({
      key, prestige, day, n,
      offered: mean(rows, r => r.offered), served: mean(rows, r => r.served), unserved: mean(rows, r => r.unserved),
      drinks: mean(rows, r => r.drinks), food: mean(rows, r => r.food),
      gross: mean(rows, r => r.gross), wages: mean(rows, r => r.wages), net: mean(rows, r => r.net),
      accuracy: mean(rows, r => r.accuracy), bestStreak: mean(rows, r => r.bestStreak),
      repDelta: mean(rows, r => r.repDelta),
      tippedShare: sum(rows, r => r.served) ? sum(rows, r => r.tipped) / sum(rows, r => r.served) : 1,
      fumbles: mean(rows, r => r.fumbles),
    }));
}

/** One row per prestige level: the days at that level, folded. */
export function prestigeRows(results) {
  const by = new Map();
  for (const r of results) for (const row of r.rows) {
    const acc = by.get(row.prestige) || { prestige: row.prestige, rows: [] };
    acc.rows.push(row); by.set(row.prestige, acc);
  }
  return [...by.values()].sort((a, b) => a.prestige - b.prestige).map(({ prestige, rows }) => {
    const t = totals(rows);
    const n = rows.length;
    return {
      prestige, days: n,
      offered: t.offered / n, served: t.served / n, unserved: t.unserved / n,
      drinks: t.drinks / n, food: t.food / n, gross: t.gross / n, wages: t.wages / n, net: t.net / n,
      accuracy: t.accuracy, bestStreak: mean(rows, r => r.bestStreak), repDelta: mean(rows, r => r.repDelta),
      tippedShare: t.served ? t.tipped / t.served : 1,
    };
  });
}

/** The stress batch: one day, the hardest one. */
export function runStress(policy = patient) {
  return runBatch(STRESS.runs, { days: 1, policy, prestigeAfter: [], mutate: s => { s.day = STRESS.day; s.prestigeLevel = STRESS.prestigeLevel; } });
}

/** The whole batch as the numbers the band reads, plus the crashes. */
export function summarise(results) {
  const ok = results.filter(r => !r.error);
  const all = ok.flatMap(r => r.rows);
  const t = totals(all);
  const days = all.length || 1;
  return {
    n: results.length, crashed: results.filter(r => r.error).map(r => `${r.seed}: ${r.error}`),
    servedShare: t.offered ? t.served / t.offered : 0,
    tippedShare: t.served ? t.tipped / t.served : 0,
    patienceAtServe: t.served ? t.patienceSum / t.served : 0,
    netPerDay: t.net / days,
    accuracy: t.accuracy,
    grossPerDay: t.gross / days, wagesPerDay: t.wages / days,
    offeredPerDay: t.offered / days, servedPerDay: t.served / days,
    fumbleRate: t.finished ? t.fumbles / t.finished : 0,
    bestStreak: mean(ok, r => totals(r.rows).bestStreak),
    byDay: dayRows(ok), byPrestige: prestigeRows(ok),
  };
}

/**
 * The band, applied. Returns the lines that fail, empty when none do, each
 * naming the rail, the measured value and the edge it crossed. A crashed run
 * is a failure too: a batch that threw is not a measurement.
 */
export function checkBand(summary, band = BAND.run) {
  const out = [];
  if (summary.crashed.length) out.push(`${summary.crashed.length} of ${summary.n} runs threw — first: ${summary.crashed[0]}`);
  for (const [rail, { min, max }] of Object.entries(band)) {
    const v = summary[rail];
    if (typeof v !== "number" || Number.isNaN(v)) { out.push(`${rail}: not a number (${v})`); continue; }
    if (v < min) out.push(`${rail} ${show(rail, v)} is below the floor ${show(rail, min)}`);
    if (v > max) out.push(`${rail} ${show(rail, v)} is above the ceiling ${show(rail, max)}`);
  }
  return out;
}

/* ========================================================================= *
 * The sweeps                                                                *
 * ========================================================================= */

/**
 * Fumble chance across `trained` and `grinder`, on day 10, three baristas of
 * one tier, the patient player's hands parked (handMs = Infinity) so every
 * cup is the barista's and every serve is a human check. Reports the fumble
 * rate the toasts show against the rate the tables promise, and what the
 * fixes cost the day: a fumbled cup is an incomplete ticket the player has
 * to see and redo before serving, so accuracy stays 1.0 and the cost is time.
 */
export function fumbleSweep(runs) {
  const rows = [];
  for (const level of [1, 2]) for (const trained of [false, true]) for (const grinder of [false, true]) {
    let fumbles = 0, finished = 0, served = 0, offered = 0, tipped = 0;
    for (let i = 0; i < runs; i++) {
      const { sim, state, counters } = makeShop(0x5EED + i, s => {
        s.day = 10; s.money = 5000;
        if (grinder) s.upgrades.add("grinder");
        for (let b = 0; b < 3; b++) s.baristas.push({ id: "b" + b, name: "B" + b, level, targetSlot: null, acc: 0, spec: null, trained, working: true });
      });
      const row = playDay(sim, state, patient, { handMs: Infinity, counters });
      fumbles += row.fumbles; finished += row.finished; served += row.served; offered += row.offered; tipped += row.tipped;
    }
    const expected = BARISTA_TIERS[level].mistakeChance * (trained ? 0.7 : 1) * (grinder ? 0.7 : 1);
    rows.push({
      level, trained, grinder, expected,
      measured: finished ? fumbles / finished : 0, finished: finished / runs, fumbles: fumbles / runs,
      servedShare: offered ? served / offered : 0, tippedShare: served ? tipped / served : 0,
    });
  }
  return rows;
}

/**
 * The prestige floors on day 30: spawnFactor() bottoms at
 * max(0.30, 0.6 - 0.06*level) and patienceFactor() at
 * max(0.45, 0.75 - 0.06*level). Levels 0 through 6: both floors stop moving
 * at level 5, so 6 is there to show that they do. A patient player on
 * the day-one shop, no upgrades and no staff: the worst case, since a reopen
 * takes the upgrades away. "Unservable" here means the patient player served
 * fewer than half the customers offered, and the report says which level
 * that first happens at, or that it never does.
 */
export function prestigeSweep(runs) {
  const rows = [];
  for (let level = 0; level <= 6; level++) {
    let offered = 0, served = 0, unserved = 0, tipped = 0, patienceSum = 0, net = 0;
    let spawnFloor = 0, patienceFloor = 0;
    for (let i = 0; i < runs; i++) {
      const { sim, state, counters } = makeShop(0x5EED + i, s => { s.day = 30; s.prestigeLevel = level; });
      spawnFloor = sim.spawnFactor(); patienceFloor = sim.patienceFactor();
      const row = playDay(sim, state, patient, { counters });
      offered += row.offered; served += row.served; unserved += row.unserved; tipped += row.tipped; patienceSum += row.patienceSum; net += row.net;
    }
    rows.push({
      level, spawnFactor: spawnFloor, patienceFactor: patienceFloor,
      offered: offered / runs, served: served / runs, unserved: unserved / runs,
      servedShare: offered ? served / offered : 0, tippedShare: served ? tipped / served : 0,
      patienceAtServe: served ? patienceSum / served : 0, net: net / runs,
    });
  }
  return rows;
}

/* ========================================================================= *
 * Printing                                                                  *
 * ========================================================================= */

const pct = x => `${(100 * x).toFixed(1)}%`;
const money = x => `$${Math.round(x).toLocaleString("en-US")}`;
const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
const show = (rail, v) => (rail === "netPerDay" ? money(v) : /accuracy|patienceAtServe/.test(rail) ? v.toFixed(3) : pct(v));

function printPolicy(name, s) {
  console.log(`\n${name} — ${s.n} runs`);
  console.log(`  served ${pct(s.servedShare)} of ${s.offeredPerDay.toFixed(1)} offered a day, ${pct(s.tippedShare)} of them before patience ran out, with ${s.patienceAtServe.toFixed(3)} of it left`);
  console.log(`  gross ${money(s.grossPerDay)} a day, wages ${money(s.wagesPerDay)}, net ${money(s.netPerDay)}; accuracy ${s.accuracy.toFixed(3)}; best streak ${s.bestStreak.toFixed(1)}`);
  if (s.fumbleRate) console.log(`  barista fumbles ${pct(s.fumbleRate)} of handed-back cups`);
  if (s.crashed.length) console.log(`  ${s.crashed.length} runs threw — first: ${s.crashed[0]}`);
  console.log(`\n  ${pad("prestige", 10)}${num("days", 5)}${num("offered", 9)}${num("served", 8)}${num("in line", 9)}${num("drinks", 8)}${num("food", 6)}${num("gross", 8)}${num("wages", 7)}${num("net", 8)}${num("acc", 7)}${num("streak", 8)}${num("rep Δ", 7)}${num("tipped", 8)}`);
  for (const p of s.byPrestige) {
    console.log(`  ${pad(p.prestige, 10)}${num(p.days, 5)}${num(p.offered.toFixed(1), 9)}${num(p.served.toFixed(1), 8)}${num(p.unserved.toFixed(1), 9)}${num(p.drinks.toFixed(1), 8)}${num(p.food.toFixed(1), 6)}` +
      `${num(money(p.gross), 8)}${num(money(p.wages), 7)}${num(money(p.net), 8)}${num(p.accuracy.toFixed(3), 7)}${num(p.bestStreak.toFixed(1), 8)}${num(p.repDelta.toFixed(1), 7)}${num(pct(p.tippedShare), 8)}`);
  }
  console.log(`\n  ${pad("prestige/day", 14)}${num("offered", 9)}${num("served", 8)}${num("in line", 9)}${num("drinks", 8)}${num("food", 6)}${num("gross", 8)}${num("wages", 7)}${num("net", 8)}${num("acc", 7)}${num("streak", 8)}${num("rep Δ", 7)}${num("tipped", 8)}`);
  for (const d of s.byDay) {
    console.log(`  ${pad(d.key, 14)}${num(d.offered.toFixed(1), 9)}${num(d.served.toFixed(1), 8)}${num(d.unserved.toFixed(1), 9)}${num(d.drinks.toFixed(1), 8)}${num(d.food.toFixed(1), 6)}` +
      `${num(money(d.gross), 8)}${num(money(d.wages), 7)}${num(money(d.net), 8)}${num(d.accuracy.toFixed(3), 7)}${num(d.bestStreak.toFixed(1), 8)}${num(d.repDelta.toFixed(1), 7)}${num(pct(d.tippedShare), 8)}`);
  }
  console.log("  in line is customers still waiting or on a station at close: nobody walks in this game, patience only stops the tip");
}

function printRemeasure(byDay) {
  const at = key => byDay.find(d => d.key === key);
  const d10 = at("0/10"), d20 = at("1/10");
  console.log("\nthe table nobody could reproduce — patient player, same seeds");
  console.log(`  ${pad("", 26)}${num("offered", 9)}${num("served", 8)}${num("net", 8)}${num("acc", 7)}`);
  console.log(`  ${pad("round 3, day 10 / prestige 0", 26)}${num(41, 9)}${num(41, 8)}${num("$309", 8)}${num("100%", 7)}`);
  if (d10) console.log(`  ${pad("here, day 10 / prestige 0", 26)}${num(d10.offered.toFixed(1), 9)}${num(d10.served.toFixed(1), 8)}${num(money(d10.net), 8)}${num(pct(d10.accuracy), 7)}`);
  console.log(`  ${pad("round 3, day 20 / prestige 1", 26)}${num(46, 9)}${num(46, 8)}${num("$452", 8)}${num("100%", 7)}`);
  if (d20) console.log(`  ${pad("here, day 20 / prestige 1", 26)}${num(d20.offered.toFixed(1), 9)}${num(d20.served.toFixed(1), 8)}${num(money(d20.net), 8)}${num(pct(d20.accuracy), 7)}`);
  console.log("  round 3's counts are close and its dollars are not: 41 cups at the cheapest $30 drink is $1,230 before tips, so");
  console.log("  its 'net' was not a day's takings. Round 1's $2,353 assumed a fully-upgraded shop and is not this measurement either.");
  console.log(`  'day 20 / prestige 1' here is the tenth day after a reopen at the close of day ${PRESTIGE_AFTER}, on a day-one shop.`);
}

function printFumbles(rows) {
  console.log("\nbarista fumbles — day 10, three baristas of one tier, the player only serves");
  console.log(`  ${pad("tier", 8)}${pad("trained", 9)}${pad("grinder", 9)}${num("promised", 10)}${num("measured", 10)}${num("cups/day", 10)}${num("fumbles", 9)}${num("served", 8)}${num("tipped", 8)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.level === 1 ? "junior" : "senior", 8)}${pad(r.trained ? "yes" : "no", 9)}${pad(r.grinder ? "yes" : "no", 9)}${num(pct(r.expected), 10)}${num(pct(r.measured), 10)}${num(r.finished.toFixed(1), 10)}${num(r.fumbles.toFixed(2), 9)}${num(pct(r.servedShare), 8)}${num(pct(r.tippedShare), 8)}`);
  }
  console.log("  a fumbled cup is an incomplete ticket the patient player redoes before serving; accuracy stays 1.000 and the cost is the time.");
  console.log("  measured runs under promised because baristaFumble() has nothing to break on a plain drip or americano — no milk, syrup or topping —");
  console.log("  and returns false, so the promised chance is per cup with something to get wrong. Juniors serve about half the day because");
  console.log("  they cannot touch a specialty order and the player's hands are parked here; that is the sweep's design, not a finding.");
}

function printPrestige(rows) {
  console.log("\nprestige floors — day 30, patient player, day-one shop, no staff");
  console.log(`  ${pad("level", 7)}${num("spawn", 7)}${num("patience", 10)}${num("offered", 9)}${num("served", 8)}${num("in line", 9)}${num("served%", 9)}${num("tipped%", 9)}${num("patience@serve", 15)}${num("net", 8)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.level, 7)}${num(r.spawnFactor.toFixed(2), 7)}${num(r.patienceFactor.toFixed(2), 10)}${num(r.offered.toFixed(1), 9)}${num(r.served.toFixed(1), 8)}${num(r.unserved.toFixed(1), 9)}${num(pct(r.servedShare), 9)}${num(pct(r.tippedShare), 9)}${num(r.patienceAtServe.toFixed(3), 15)}${num(money(r.net), 8)}`);
  }
  console.log("  both floors stop moving at level 5, so levels 5 and 6 are the same day; offered is throttled by the queue cap of 5, not by the door");
  const first = rows.find(r => r.servedShare < 0.5);
  console.log(first
    ? `  a day becomes unservable (under half the customers served) at level ${first.level}`
    : `  no level makes a day unservable (under half the customers served); the worst is ${pct(Math.min(...rows.map(r => r.servedShare)))} at level ${rows.reduce((a, r) => (r.servedShare < a.servedShare ? r : a)).level}`);
}

/* ========================================================================= *
 * The command line                                                          *
 * ========================================================================= */

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const runs = Number(argv.find(a => /^\d+$/.test(a))) || DEFAULT_RUNS;
  const verbose = argv.includes("--verbose");
  const daysAt = argv.indexOf("--days");
  const days = daysAt >= 0 ? Number(argv[daysAt + 1]) || DEFAULT_DAYS : DEFAULT_DAYS;
  const opts = { days, prestigeAfter: days > PRESTIGE_AFTER ? [PRESTIGE_AFTER] : [] };
  const t0 = Date.now();

  if (verbose) console.log("\nfirst twelve runs, patient:");
  const patientS = summarise(runBatch(runs, { ...opts, policy: patient, verbose }));
  const eagerS = summarise(runBatch(runs, { ...opts, policy: eager }));
  const shopperS = summarise(runBatch(runs, { ...opts, policy: shopper() }));

  console.log(`\n${runs} runs × ${days} days, three players, hands every ${HAND_MS} ms, reopening ${opts.prestigeAfter.length ? `at the close of day ${PRESTIGE_AFTER}` : "never"}`);
  printPolicy("patient — serves only complete tickets (the banded player)", patientS);
  printPolicy("eager — serves the moment the page's button enables", eagerS);
  printPolicy("shopper — patient hands, spends the till by DEFAULT_PRIORITY at every close", shopperS);

  console.log(`\n  ${pad("player", 10)}${num("served", 8)}${num("tipped", 8)}${num("net/day", 9)}${num("acc", 7)}${num("streak", 8)}`);
  for (const [name, s] of [["patient", patientS], ["eager", eagerS], ["shopper", shopperS]]) {
    console.log(`  ${pad(name, 10)}${num(pct(s.servedShare), 8)}${num(pct(s.tippedShare), 8)}${num(money(s.netPerDay), 9)}${num(s.accuracy.toFixed(3), 7)}${num(s.bestStreak.toFixed(1), 8)}`);
  }

  if (days >= 20 && opts.prestigeAfter.length) printRemeasure(patientS.byDay);
  const sweepRuns = Math.max(10, Math.min(runs, 50));
  printFumbles(fumbleSweep(sweepRuns));
  printPrestige(prestigeSweep(sweepRuns));

  // Only the patient player is banded: it is the one whose numbers say
  // whether the shop can be played at all. Eager and shopper are reference
  // columns for Phase 3 and for anyone comparing an upgrade path.
  const stressS = summarise(runStress(patient));
  console.log(`\nstress — day ${STRESS.day} at prestige ${STRESS.prestigeLevel}, ${STRESS.runs} runs, patient: served ${pct(stressS.servedShare)} of ${stressS.offeredPerDay.toFixed(1)}, patience at serve ${stressS.patienceAtServe.toFixed(3)}, net ${money(stressS.netPerDay)}`);
  const bad = [
    ...checkBand(patientS, BAND.run).map(l => `run: ${l}`),
    ...checkBand(stressS, BAND.stress).map(l => `stress: ${l}`),
  ];
  const rails = [
    ...Object.entries(BAND.run).map(([k, b]) => `run ${k} ${show(k, patientS[k])} (band ${show(k, b.min)}–${show(k, b.max)})`),
    ...Object.entries(BAND.stress).map(([k, b]) => `stress ${k} ${show(k, stressS[k])} (band ${show(k, b.min)}–${show(k, b.max)})`),
  ].join(", ");
  console.log(`\n${bad.length ? `BALANCE OUT OF BAND — ${bad.join("\n                      ")}` : `BALANCE OK — ${rails}`}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  process.exit(bad.length ? 1 : 0);
}
