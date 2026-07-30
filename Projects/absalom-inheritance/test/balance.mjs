// balance.mjs — play the adventure N times and report what happened.
//
// Run:  node Projects/absalom-inheritance/test/balance.mjs [runs]
//       node Projects/absalom-inheritance/test/balance.mjs 2000 --verbose
//
// Why this exists: the shipped single-file build could not be won. Not "was
// hard" — could not be won. Two Creature-0 constructs woke together and put six
// attacks a round into a 15 HP wizard, and the only way to find that out was to
// count. One browser playthrough said "I died"; this says "you die 100% of the
// time, having dealt 4 of the 34 damage you needed".
//
// Exits non-zero if the win rate leaves the band declared in BAND, so a content
// edit that quietly breaks the game breaks the build instead (locked
// decision #13).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../js/content.js";
import { createGame } from "../js/game.js";
import { makeRng } from "../js/rules.js";
import { playThrough } from "./autopilot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(HERE, "..", "content", "vault.json");

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

const content = loadPack(JSON.parse(fs.readFileSync(PACK, "utf8")));

export function runBatch(runs, { verbose = false } = {}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const rng = makeRng(0x5EED + i);
    const game = createGame({ content, rng });
    let r;
    try {
      r = playThrough(game);
    } catch (e) {
      r = { outcome: "error:" + e.message, hp: 0, rounds: 0, dealt: 0, taken: 0, slain: 0, woken: 0, lore: 0, potions: 0, slots: 0, focus: 0, gateOpen: false };
    }
    r.seed = 0x5EED + i;
    results.push(r);
    if (verbose && i < 12) console.log(`  seed ${r.seed}  ${r.outcome.padEnd(10)} hp ${String(r.hp).padStart(2)}  lore ${r.lore}  slain ${r.slain}/${game.run.creatures.length}  rounds ${r.rounds}`);
  }
  return results;
}

function report(results) {
  const n = results.length;
  const tally = {};
  for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
  const wins = results.filter(r => r.outcome === "victory");
  const mean = (xs, f) => (xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0);
  const median = xs => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  console.log(`\n${n} runs of "${content.pack.name}"\n`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}  ${(100 * v / n).toFixed(1)}%`);
  }
  console.log(`\n  win rate            ${(100 * wins.length / n).toFixed(1)}%  (band ${100 * BAND.min}–${100 * BAND.max}%)`);
  console.log(`  reached both pillars ${(100 * results.filter(r => r.lore === 2).length / n).toFixed(1)}%`);
  console.log(`  opened the gate      ${(100 * results.filter(r => r.gateOpen).length / n).toFixed(1)}%`);
  console.log(`  creatures slain      mean ${mean(results, r => r.slain).toFixed(2)} of ${Object.keys(content.creatures).length > 0 ? content.area.placements.length : 0}`);
  console.log(`  encounter rounds     median ${median(results.map(r => r.rounds))}`);
  console.log(`  damage dealt / taken mean ${mean(results, r => r.dealt).toFixed(1)} / ${mean(results, r => r.taken).toFixed(1)}`);
  if (wins.length) {
    console.log(`  on a win: HP left    mean ${mean(wins, r => r.hp).toFixed(1)} of ${content.pc.hp}, median ${median(wins.map(r => r.hp))}`);
    console.log(`            potions left mean ${mean(wins, r => r.potions).toFixed(2)}`);
  }
  return wins.length / n;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const runs = Number(process.argv[2]) || 2000;
  const verbose = process.argv.includes("--verbose");
  if (verbose) console.log("first twelve runs:");
  const rate = report(runBatch(runs, { verbose }));
  const ok = rate >= BAND.min && rate <= BAND.max;
  console.log(`\n${ok ? "BALANCE OK" : "BALANCE OUT OF BAND"} — ${(100 * rate).toFixed(1)}%\n`);
  process.exit(ok ? 0 : 1);
}
