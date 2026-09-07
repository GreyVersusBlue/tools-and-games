// balance.mjs — play the adventure N times and report what happened.
//
// Run:  node Projects/absalom-inheritance/test/balance.mjs [runs]
//       node Projects/absalom-inheritance/test/balance.mjs 2000 --verbose
//       node Projects/absalom-inheritance/test/balance.mjs 2000 --write-baseline
//       node Projects/absalom-inheritance/test/balance.mjs 2000 \
//         --variant 'no-cone={"creatures":{"vault-keeper":{"abilities":[]}}}' \
//         --variant brawler=@test/variants/brawler.json
//
// Why this exists: the shipped single-file build could not be won. Not "was
// hard" — could not be won. Two Creature-0 constructs woke together and put six
// attacks a round into a 15 HP wizard, and the only way to find that out was to
// count. One browser playthrough said "I died"; this says "you die 100% of the
// time, having dealt 4 of the 34 damage you needed".
//
// One number is not enough any more. Four phases of engine change later the
// pack has two areas, three creatures, three creature policies and a construct
// that drops a cone on the floor, and "81.4%" cannot say whether the Keeper is
// too hard or the sanctum is free. So this reports per encounter and per area
// as well, holds a stored baseline it compares every run against, and takes a
// `--variant` patch so separating the causes of a move is a flag rather than
// the thirty lines of throwaway script every phase that touches balance has
// written from scratch.
//
// Exits non-zero on four things (locked decision #13): a win rate outside
// BAND, a command or creature ability nothing ever used, a drift from
// test/baseline.json past DRIFT, and a variant that will not load.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack, selectPc } from "../js/content.js";
import { createGame } from "../js/game.js";
import { makeRng } from "../js/rules.js";
import { playThrough } from "./autopilot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(HERE, "..", "content", "vault.json");
const BASELINE = path.join(HERE, "baseline.json");

/**
 * The band. A vignette whose one mandatory fight you always win is not a fight;
 * one you usually lose is the bug this file was written to catch.
 *
 * 0.45–0.90 is wide on purpose: it is a guard-rail against "unwinnable" and
 * "free", not a target. The autopilot brawls all three creatures and never once
 * uses the cover that lets a player slip past a sentinel, so it measures the
 * floor of competent play rather than the ceiling. At the time of writing it
 * lands on 59.3% over 2000 runs; the shipped single-file build was 0%.
 *
 * Narrow this and every dice-math change becomes a failing test, which is how a
 * guard-rail gets deleted instead of fixed.
 */
export const BAND = { min: 0.45, max: 0.90 };

/**
 * How far a number may move from `test/baseline.json` before it is a
 * regression rather than a tweak.
 *
 * The band above is 45 points wide, and a 3.5-point drop passes through it
 * without a sound — which is exactly what "the Keeper got harder" looks like
 * from the outside. The baseline is the other half of the guard-rail: the band
 * says the adventure is playable, this says it is the same adventure it was
 * yesterday.
 *
 * The comparison is exact, not statistical, and that is a property of how the
 * batch is seeded: every run uses `0x5EED + i`, so the same code over the same
 * run count produces the same numbers to the last decimal, every time, on
 * every machine. There is no sampling noise to leave room for. These
 * tolerances are about what is worth stopping for, not about error bars — and
 * because the comparison needs the seeds to line up, it only runs when the run
 * count matches the baseline's.
 *
 * A deliberate change to the numbers is meant to fail here once. Read the
 * lines it prints, decide they are the change you meant, and rewrite the file
 * with --write-baseline in the same commit.
 */
export const DRIFT = { rate: 0.03, deaths: 0.03, takenRel: 0.15, takenAbs: 0.5 };

const rawPack = JSON.parse(fs.readFileSync(PACK, "utf8"));
const basePack = loadPack(rawPack);

/** A run that threw, shaped like one that did not, so no reader has to ask. */
const crashed = message => ({
  outcome: "error:" + message, hp: 0, rounds: 0, dealt: 0, taken: 0, slain: 0,
  woken: 0, reactions: 0, lore: 0, potions: 0, slots: 0, focus: 0,
  gateOpen: false, cast: {}, abilities: {}, loreRead: [],
  encounters: [], areas: [], reactionsBy: {}, conditionsBy: {},
});

export function runBatch(content, runs, { verbose = false } = {}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const rng = makeRng(0x5EED + i);
    const game = createGame({ content, rng });
    let r;
    try {
      r = playThrough(game);
    } catch (e) {
      r = crashed(e.message);
    }
    r.seed = 0x5EED + i;
    results.push(r);
    if (verbose && i < 12) console.log(`  seed ${r.seed}  ${r.outcome.padEnd(10)} hp ${String(r.hp).padStart(2)}  lore ${r.lore}  slain ${r.slain}/${game.run.creatures.length}  rounds ${r.rounds}`);
  }
  return results;
}

/* ========================================================================= *
 * Reading a batch                                                           *
 *                                                                           *
 * Every function here is pure: batch in, numbers out, no printing and no    *
 * process.exit. That is what lets test/smoke.mjs hand them a batch it built  *
 * by hand and assert on what comes back, which is the only way the harness   *
 * itself gets a guard-rail (locked decision #34 pointed at the thing that    *
 * does the measuring).                                                      *
 * ========================================================================= */

const mean = (xs, f) => (xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0);
const median = xs => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * One row per encounter the batch actually played, keyed by where it happened
 * and what started it.
 *
 * Not one row per creature: the vault places two Shattered Sentinels and they
 * wake separately, so "the sentinel fight" is a thing that happens about twice
 * a run. `n` counts occurrences and `runs` counts the runs that saw at least
 * one, because those are different questions and the first one alone would
 * read as "the sanctum happens 0.95 times" without ever saying that 5% of
 * runs never get there.
 */
export function encounterRows(content, results) {
  const by = new Map();
  const seen = new Map();
  for (const r of results) {
    const here = new Set();
    for (const e of r.encounters) {
      const key = `${e.area}/${e.starter}`;
      const row = by.get(key) || {
        key, area: e.area, starter: e.starter,
        n: 0, rounds: 0, dealt: 0, taken: 0,
        cleared: 0, settled: 0, died: 0, unfinished: 0,
      };
      row.n++;
      row.rounds += e.rounds; row.dealt += e.dealt; row.taken += e.taken;
      if (row[e.ended] === undefined) row[e.ended] = 0;
      row[e.ended]++;
      by.set(key, row);
      here.add(key);
    }
    for (const key of here) seen.set(key, (seen.get(key) || 0) + 1);
  }
  const order = id => {
    const i = content.areaOrder.indexOf(id);
    return i < 0 ? content.areaOrder.length : i;
  };
  return [...by.values()]
    .map(row => ({
      ...row,
      runs: seen.get(row.key) || 0,
      per: row.n / (results.length || 1),
      rounds: row.rounds / row.n,
      dealt: row.dealt / row.n,
      taken: row.taken / row.n,
      // Deaths as a share of the whole batch, not of this encounter's
      // occurrences: "9% of runs die to the warden" is the sentence a person
      // wants, and dividing by the encounters that happened would quietly
      // exclude every run that never reached it.
      deathShare: row.died / (results.length || 1),
    }))
    .sort((a, b) => order(a.area) - order(b.area) || b.n - a.n);
}

/**
 * One row per area in the pack's own order: how often a run got there, how
 * often it ended there, and what share of all the damage the batch took was
 * taken in it.
 *
 * "read the reliquary 64.0%" was the only sanctum signal this file had, and it
 * is a lore count rather than a fight.
 */
export function areaRows(content, results) {
  const n = results.length || 1;
  const totalTaken = results.reduce((a, r) => a + r.taken, 0) || 1;
  const rows = content.areaOrder.map(id => ({ id, name: content.areas[id].name, reached: 0, died: 0, taken: 0 }));
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const r of results) {
    const here = new Set();
    for (const a of r.areas) {
      const row = byId.get(a.area);
      if (!row) continue;
      row.taken += a.taken;
      here.add(a.area);
    }
    for (const id of here) byId.get(id).reached++;
    if (r.outcome === "defeat" && r.areas.length) {
      const last = byId.get(r.areas[r.areas.length - 1].area);
      if (last) last.died++;
    }
  }
  return rows.map(row => ({
    ...row,
    reachedShare: row.reached / n,
    deathShare: row.died / n,
    takenShare: row.taken / totalTaken,
  }));
}

/** "<who> <what>" bags, summed across the batch and turned into per-run rates. */
function bagRows(results, field) {
  const total = {};
  for (const r of results) for (const [k, v] of Object.entries(r[field] || {})) total[k] = (total[k] || 0) + v;
  return Object.entries(total)
    .map(([key, count]) => ({ key, count, per: count / (results.length || 1) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Everything one build's batch has to say, as data. `printReport` renders it
 * and `compareToBaseline` checks it; neither of them measures anything itself.
 */
export function summarise(content, results) {
  const n = results.length;
  const tally = {};
  for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
  const wins = results.filter(r => r.outcome === "victory");

  // Which commands the autopilot actually cast, counted rather than assumed,
  // and a build failure when one of them is never cast at all.
  //
  // Round three shipped two pieces of content that validated at load and were
  // then never reached in a single number this project had quoted: a
  // `self-heal` branch the policy did not have, so Rousing Splash had never
  // been cast once, and an `inflicts` on an `unerring` command that applied
  // nothing because that branch read no degree of success. Neither crashed.
  // Both looked exactly like working content from the outside.
  //
  // Reactions are exempt: they fire from the bus rather than from a decision,
  // and they have their own counters now.
  const casts = {};
  for (const r of results) for (const [id, k] of Object.entries(r.cast || {})) casts[id] = (casts[id] || 0) + k;
  const commands = content.commands
    .filter(cmd => cmd.kind !== "reaction")
    .map(cmd => ({ name: cmd.name, count: casts[cmd.id] || 0 }));

  // The same check, pointed at the other side of the board. A creature's
  // ability is content no player policy can reach, so it can never appear in
  // the list above however long the run goes, and it has one more way to go
  // silent than a spell does: the pack can validate it, the engine can resolve
  // it, and the creature's policy can still never choose it. Nothing in the
  // report would say so. The three casualties on record here all took a whole
  // phase to notice, and every one of them was a number nobody was printing.
  const fired = {};
  for (const r of results) for (const [id, k] of Object.entries(r.abilities || {})) fired[id] = (fired[id] || 0) + k;
  const owned = [...new Set(Object.values(content.creatures).flatMap(c => c.abilities))];
  const abilities = owned.map(id => ({ name: content.allCommandById[id].name, count: fired[id] || 0 }));

  const totalPlacements = content.areaOrder.reduce((n, id) => n + content.areas[id].placements.length, 0);
  return {
    n,
    build: content.pc,
    packName: content.pack.name,
    tally,
    rate: n ? wins.length / n : 0,
    gateOpen: results.filter(r => r.gateOpen).length / (n || 1),
    // Every pillar the gate does not require: content a run can walk straight
    // past, which makes it the only measure of whether an optional room is
    // being visited at all. Read off `content.gate.requiresLore` rather than a
    // list of ids here — this file is the vault's harness, and it should not
    // have to be edited the day the vault grows a fourth pillar.
    optional: Object.keys(content.lore)
      .filter(id => !content.gate.requiresLore.includes(id))
      .map(id => ({
        id,
        title: content.lore[id].title,
        share: results.filter(r => (r.loreRead || []).includes(id)).length / (n || 1),
      })),
    slain: mean(results, r => r.slain),
    totalPlacements,
    roundsMedian: median(results.map(r => r.rounds)),
    dealt: mean(results, r => r.dealt),
    taken: mean(results, r => r.taken),
    reactions: mean(results, r => r.reactions),
    reactionRuns: results.filter(r => r.reactions > 0).length / (n || 1),
    commands,
    abilities,
    uncast: [...commands, ...abilities].filter(c => !c.count).map(c => c.name),
    encounters: encounterRows(content, results),
    areas: areaRows(content, results),
    reactionsBy: bagRows(results, "reactionsBy"),
    conditionsBy: bagRows(results, "conditionsBy"),
    winHp: wins.length ? mean(wins, r => r.hp) : null,
    winHpMedian: wins.length ? median(wins.map(r => r.hp)) : null,
    winPotions: wins.length ? mean(wins, r => r.potions) : null,
  };
}

/* ========================================================================= *
 * The stored baseline                                                       *
 * ========================================================================= */

/** What of a summary is worth freezing: the aggregate, and every fight in it. */
export function baselineOf(summary) {
  const encounters = {};
  for (const e of summary.encounters) {
    encounters[e.key] = { per: round(e.per, 4), taken: round(e.taken, 3), deathShare: round(e.deathShare, 4) };
  }
  return { rate: round(summary.rate, 4), encounters };
}

const round = (x, places) => Number(x.toFixed(places));

/**
 * Compare a summary against its stored baseline. Returns a list of drift
 * lines, empty when nothing moved past DRIFT — pure, so smoke.mjs can hand it
 * two hand-built objects and read what comes back.
 *
 * Two numbers per encounter, because one of them was not enough and the phase
 * that built this found out on its own first try. Bumping the Vault Keeper's
 * fist from 1d6+2 to 1d6+4 cost the fighter 10.4 points of win rate and took
 * her deaths in that fight from 21.0% to 31.3%, and the damage-taken line
 * stayed quiet at +1.8 against a tolerance of 1.9: a fight that kills you
 * stops dealing damage, so the harder it gets the less of it the average
 * shows. Deaths per encounter is the number that does not truncate, and it is
 * the one the phase's own title asks for.
 */
export function compareToBaseline(baseline, buildId, summary) {
  const want = baseline && baseline.builds && baseline.builds[buildId];
  if (!want) return [`no baseline for ${buildId} — write one with --write-baseline`];
  const drift = [];
  const points = x => (100 * x).toFixed(1);

  const dRate = summary.rate - want.rate;
  if (Math.abs(dRate) > DRIFT.rate) {
    drift.push(`${buildId}: win rate ${points(want.rate)}% → ${points(summary.rate)}% ` +
      `(${dRate > 0 ? "+" : "−"}${points(Math.abs(dRate))} points, tolerance ${points(DRIFT.rate)})`);
  }

  const now = new Map(summary.encounters.map(e => [e.key, e]));
  for (const [key, base] of Object.entries(want.encounters || {})) {
    const e = now.get(key);
    if (!e) { drift.push(`${buildId}, ${key}: the baseline has this encounter and this batch never played it`); continue; }
    const d = e.taken - base.taken;
    const tolerance = Math.max(DRIFT.takenAbs, DRIFT.takenRel * base.taken);
    if (Math.abs(d) > tolerance) {
      drift.push(`${buildId}, ${key}: damage taken ${base.taken.toFixed(1)} → ${e.taken.toFixed(1)} per fight ` +
        `(${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}, tolerance ${tolerance.toFixed(1)})`);
    }
    const dd = e.deathShare - base.deathShare;
    if (Math.abs(dd) > DRIFT.deaths) {
      drift.push(`${buildId}, ${key}: killed ${points(base.deathShare)}% of runs, now ${points(e.deathShare)}% ` +
        `(${dd > 0 ? "+" : "−"}${points(Math.abs(dd))} points, tolerance ${points(DRIFT.deaths)})`);
    }
  }
  for (const key of now.keys()) {
    if (!(want.encounters || {})[key]) drift.push(`${buildId}, ${key}: this batch played an encounter the baseline has never seen`);
  }
  return drift;
}

/* ========================================================================= *
 * Variants                                                                  *
 * ========================================================================= */

/**
 * RFC 7386 merge patch, against a deep copy. An object merges key by key, a
 * null deletes, and anything else — an array included — replaces whole.
 *
 * That last rule is what makes `{"creatures":{"vault-keeper":{"abilities":[]}}}`
 * mean "take the Keeper's cone away" rather than "add nothing to it", which is
 * exactly the thirty-line throwaway script phase 4 wrote by hand to separate
 * the skirmisher's contribution from the caster's.
 */
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch === undefined ? target : patch;
  }
  const out = (target && typeof target === "object" && !Array.isArray(target)) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/**
 * `--variant name={json}` or `--variant name=@file.json`, repeatable. The
 * name is what the comparison table's column is headed with, so it is
 * required: an unnamed column in a four-column table is a column nobody can
 * read six months later.
 */
export function parseVariants(argv, readFile = f => fs.readFileSync(f, "utf8")) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--variant") continue;
    const spec = argv[i + 1];
    if (!spec) throw new Error("--variant needs name={json} or name=@file.json");
    const eq = spec.indexOf("=");
    if (eq <= 0) throw new Error(`--variant "${spec}" needs a name: --variant no-cone={...}`);
    const name = spec.slice(0, eq);
    const body = spec.slice(eq + 1);
    const text = body.startsWith("@") ? readFile(body.slice(1)) : body;
    let patch;
    try { patch = JSON.parse(text); } catch (e) { throw new Error(`--variant ${name}: ${e.message}`); }
    out.push({ name, patch });
  }
  return out;
}

/* ========================================================================= *
 * Printing                                                                  *
 * ========================================================================= */

const pct = x => `${(100 * x).toFixed(1)}%`;
const pad = (s, w) => String(s).padEnd(w);
const num = (s, w) => String(s).padStart(w);
const widest = (header, labels) => 2 + Math.max(header.length, ...labels.map(l => l.length), 0);

function printReport(summary) {
  const s = summary;
  console.log(`\n${s.n} runs of "${s.packName}" — ${s.build.name}, ${s.build.title}\n`);
  for (const [k, v] of Object.entries(s.tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(k, 12)} ${num(v, 6)}  ${pct(v / s.n)}`);
  }
  console.log(`\n  win rate            ${pct(s.rate)}  (band ${100 * BAND.min}–${100 * BAND.max}%)`);
  // `lore` is a raw count and two of the pack's four pillars do not gate
  // anything — read this off gateOpen (exactly the condition
  // content.gate.requiresLore describes) rather than an exact lore count that
  // a non-gating pillar can legitimately exceed.
  console.log(`  opened the gate      ${pct(s.gateOpen)}`);
  for (const o of s.optional) {
    console.log(`  read ${pad(o.title, 18)} ${pct(o.share)}  (optional; not required to win)`);
  }
  console.log(`  creatures slain      mean ${s.slain.toFixed(2)} of ${s.totalPlacements}`);
  console.log(`  encounter rounds     median ${s.roundsMedian}`);
  console.log(`  damage dealt / taken mean ${s.dealt.toFixed(1)} / ${s.taken.toFixed(1)}`);
  // Reactions, measured rather than asserted. A build whose reaction never
  // fires under the autopilot is a rule the engine implements and this
  // adventure's creatures never provoke, and that is worth reading off a
  // number instead of arguing about.
  console.log(`  reactions fired      mean ${s.reactions.toFixed(2)}  (in ${pct(s.reactionRuns)} of runs)`);

  // Every label column is sized from the labels themselves. A pack is content
  // and its names are as long as its author made them; a width picked by hand
  // holds until the first area called something longer, and then the table
  // stops lining up in exactly the report somebody is reading to find out why
  // they died.
  const ew = widest("area / started by", s.encounters.map(e => e.key));
  console.log("\n  encounters, in the order the adventure meets them");
  console.log(`    ${pad("area / started by", ew)}${num("per run", 8)}${num("rounds", 8)}${num("dealt", 7)}${num("taken", 7)}${num("cleared", 9)}${num("settled", 9)}${num("died", 8)}`);
  for (const e of s.encounters) {
    console.log(`    ${pad(e.key, ew)}${num(e.per.toFixed(2), 8)}${num(e.rounds.toFixed(1), 8)}` +
      `${num(e.dealt.toFixed(1), 7)}${num(e.taken.toFixed(1), 7)}` +
      `${num(pct(e.cleared / e.n), 9)}${num(pct(e.settled / e.n), 9)}${num(pct(e.deathShare), 8)}`);
  }
  // Two denominators in one table, said out loud rather than left to be
  // worked out. `cleared` and `settled` are about the fight — of the times
  // this one happened, how often did it end each way. `died` is about the
  // run, so the column adds up to the defeat rate above it and the rows can
  // be read against each other: this is the "which fight killed you" number.
  console.log("    cleared and settled are shares of that fight; died is a share of all runs, and the column sums to the defeat rate");

  const label = a => `${a.id} — ${a.name}`;
  const aw = widest("area", s.areas.map(label));
  console.log("\n  areas");
  console.log(`    ${pad("area", aw)}${num("reached", 9)}${num("died here", 11)}${num("of all damage", 15)}`);
  for (const a of s.areas) {
    console.log(`    ${pad(label(a), aw)}${num(pct(a.reachedShare), 9)}${num(pct(a.deathShare), 11)}${num(pct(a.takenShare), 15)}`);
  }

  console.log("\n  commands cast");
  for (const c of s.commands) {
    console.log(`    ${pad(c.name, 22)}${num(c.count, 6)}${c.count ? "" : "   ← never cast"}`);
  }
  if (s.abilities.length) {
    console.log("  creature abilities used");
    for (const c of s.abilities) {
      console.log(`    ${pad(c.name, 22)}${num(c.count, 6)}${c.count ? "" : "   ← never used"}`);
    }
  }

  // Reactions and conditions by who and which, which is the cheapest way there
  // is to catch a feature that is wired, validated, and never actually
  // triggered. Zero rows is itself the finding: it says the whole subsystem is
  // asleep, and it has been true here before.
  const bw = widest("", [...s.reactionsBy, ...s.conditionsBy].map(r => r.key));
  console.log("  reactions fired, by actor");
  if (!s.reactionsBy.length) console.log("    (none fired in this batch)");
  for (const r of s.reactionsBy) console.log(`    ${pad(r.key, bw)}${num(r.count, 7)}   ${r.per.toFixed(2)} per run`);
  console.log("  conditions applied, by actor");
  if (!s.conditionsBy.length) console.log("    (none applied in this batch)");
  for (const r of s.conditionsBy) console.log(`    ${pad(r.key, bw)}${num(r.count, 7)}   ${r.per.toFixed(2)} per run`);

  if (s.winHp !== null) {
    console.log(`  on a win: HP left    mean ${s.winHp.toFixed(1)} of ${s.build.hp}, median ${s.winHpMedian}`);
    console.log(`            potions left mean ${s.winPotions.toFixed(2)}`);
  }
}

/**
 * The build × area matrix, one table for every build in the pack, so a fourth
 * build costs three lines of output rather than a fourth full report.
 */
function printMatrix(summaries) {
  const areas = summaries[0] ? summaries[0].areas.map(a => a.id) : [];
  if (!areas.length) return;
  const w = Math.max(12, ...summaries.map(s => s.build.name.length + 2));
  const cw = Math.max(18, ...areas.map(id => id.length + 2));
  console.log("\nbuild × area — reached / died there");
  console.log(`  ${pad("build", w)}${areas.map(id => num(id, cw)).join("")}`);
  for (const s of summaries) {
    const cells = s.areas.map(a => num(`${pct(a.reachedShare)} / ${pct(a.deathShare)}`, cw)).join("");
    console.log(`  ${pad(s.build.name, w)}${cells}`);
  }
}

/** Variants, side by side, in two tables rather than one report each. */
function printVariants(buildName, columns) {
  const base = columns[0];
  const w = Math.max(10, ...columns.map(c => c.name.length + 2));
  console.log(`\n  variants — ${buildName}`);
  console.log(`    ${pad("variant", w)}${num("win rate", 10)}${num("Δ", 9)}${num("rounds", 9)}${num("dealt", 8)}${num("taken", 8)}`);
  for (const c of columns) {
    const d = c === base ? "—" : `${c.summary.rate >= base.summary.rate ? "+" : "−"}${(100 * Math.abs(c.summary.rate - base.summary.rate)).toFixed(1)}`;
    console.log(`    ${pad(c.name, w)}${num(pct(c.summary.rate), 10)}${num(d, 9)}` +
      `${num(c.summary.roundsMedian, 9)}${num(c.summary.dealt.toFixed(1), 8)}${num(c.summary.taken.toFixed(1), 8)}`);
  }
  // Where the move went. A variant that changes the win rate by a point while
  // moving a single encounter's deaths by six is a different finding from one
  // that shifts every fight a little, and the aggregate above cannot tell them
  // apart.
  const keys = [...new Set(columns.flatMap(c => c.summary.encounters.map(e => e.key)))];
  const kw = widest("share of runs that died in", keys);
  const cw = Math.max(12, ...columns.map(c => c.name.length + 2));
  console.log(`\n    ${pad("share of runs that died in", kw)}${columns.map(c => num(c.name, cw)).join("")}`);
  for (const key of keys) {
    const cells = columns.map(c => {
      const e = c.summary.encounters.find(e => e.key === key);
      return num(e ? pct(e.deathShare) : "—", cw);
    }).join("");
    console.log(`    ${pad(key, kw)}${cells}`);
  }
}

/* ========================================================================= *
 * The command line                                                          *
 * ========================================================================= */

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const runs = Number(process.argv[2]) || 2000;
  const verbose = process.argv.includes("--verbose");
  const writeBaseline = process.argv.includes("--write-baseline");
  let variants;
  try {
    variants = parseVariants(process.argv);
  } catch (e) {
    console.log(`\nVARIANT REFUSED — ${e.message}\n`);
    process.exit(1);
  }
  // A variant is a patch against the raw pack, loaded through the same
  // loadPack every other caller uses, so a patch that makes the pack invalid
  // fails here the way a bad edit to vault.json would rather than producing a
  // column of quietly wrong numbers.
  const packs = [{ name: "shipped", pack: basePack }];
  for (const v of variants) {
    try {
      packs.push({ name: v.name, pack: loadPack(mergePatch(rawPack, v.patch)) });
    } catch (e) {
      console.log(`\nVARIANT REFUSED — ${v.name}: ${e.message}\n`);
      process.exit(1);
    }
  }

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
  // The seeds are what makes the comparison exact, so the run counts have to
  // line up for it to mean anything. Say so out loud rather than comparing
  // 200 runs against a 2000-run baseline and calling the difference a
  // regression.
  const comparable = !!baseline && baseline.runs === runs && !variants.length;
  if (baseline && !comparable) {
    console.log(`\nbaseline not compared — it holds ${baseline.runs} runs${variants.length ? " and this is a variant batch" : `, this batch is ${runs}`}`);
  }

  // Every build gets its own batch and its own band check — character
  // creation means "is this adventure winnable" is now a question per PC, not
  // one number for the pack. A build with an unfair chance at the vault is
  // exactly as much a shipped bug as the original single build being
  // unwinnable was.
  let allOk = true;
  const summaries = [];
  const written = { runs, builds: {} };
  for (const build of basePack.pcOptions) {
    const columns = packs.map(p => {
      const content = selectPc(p.pack, build.id);
      if (verbose && p.name === "shipped") console.log(`\nfirst twelve runs, ${build.name}:`);
      return { name: p.name, summary: summarise(content, runBatch(content, runs, { verbose: verbose && p.name === "shipped" })) };
    });
    const shipped = columns[0].summary;
    summaries.push(shipped);
    written.builds[build.id] = baselineOf(shipped);
    printReport(shipped);
    if (columns.length > 1) printVariants(build.name, columns);

    const inBand = shipped.rate >= BAND.min && shipped.rate <= BAND.max;
    const drift = comparable ? compareToBaseline(baseline, build.id, shipped) : [];
    // Three ways to fail, and they say which. A rate outside the band means
    // the adventure got unwinnable or free; a command nothing cast means the
    // pack grew content the game never reaches; a drift means the numbers
    // moved and nobody wrote down that they meant to.
    const verdict = !inBand ? `BALANCE OUT OF BAND — ${build.id}: ${pct(shipped.rate)}`
      : shipped.uncast.length ? `CONTENT NEVER REACHED — ${build.id}: ${shipped.uncast.join(", ")}`
      : drift.length ? `BASELINE DRIFT — ${drift.join("\n                 ")}\n(if you meant it, rerun with --write-baseline and commit the file)`
      : `BALANCE OK — ${build.id}: ${pct(shipped.rate)}`;
    console.log(`\n${verdict}\n`);
    allOk = allOk && inBand && !shipped.uncast.length && !drift.length;
  }
  printMatrix(summaries);

  if (writeBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(written, null, 2) + "\n");
    console.log(`\nwrote ${path.relative(process.cwd(), BASELINE)} — ${runs} runs, ${Object.keys(written.builds).length} builds\n`);
  }
  process.exit(allOk ? 0 : 1);
}
