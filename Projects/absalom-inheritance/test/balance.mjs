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
import { loadPack, selectPc } from "../js/content.js";
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

const basePack = loadPack(JSON.parse(fs.readFileSync(PACK, "utf8")));

export function runBatch(content, runs, { verbose = false } = {}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const rng = makeRng(0x5EED + i);
    const game = createGame({ content, rng });
    let r;
    try {
      r = playThrough(game);
    } catch (e) {
      r = { outcome: "error:" + e.message, hp: 0, rounds: 0, dealt: 0, taken: 0, slain: 0, woken: 0, reactions: 0, lore: 0, potions: 0, slots: 0, focus: 0, gateOpen: false, cast: {}, abilities: {} };
    }
    r.seed = 0x5EED + i;
    results.push(r);
    if (verbose && i < 12) console.log(`  seed ${r.seed}  ${r.outcome.padEnd(10)} hp ${String(r.hp).padStart(2)}  lore ${r.lore}  slain ${r.slain}/${game.run.creatures.length}  rounds ${r.rounds}`);
  }
  return results;
}

function report(content, results) {
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

  console.log(`\n${n} runs of "${content.pack.name}" — ${content.pc.name}, ${content.pc.title}\n`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}  ${(100 * v / n).toFixed(1)}%`);
  }
  console.log(`\n  win rate            ${(100 * wins.length / n).toFixed(1)}%  (band ${100 * BAND.min}–${100 * BAND.max}%)`);
  // `lore` is a raw count and the sanctum's plaque means it can now go past
  // the two the gate needs — read this off gateOpen (exactly the condition
  // content.gate.requiresLore describes) rather than an exact lore count that
  // a third, non-gating pillar can legitimately exceed.
  console.log(`  opened the gate      ${(100 * results.filter(r => r.gateOpen).length / n).toFixed(1)}%`);
  console.log(`  read the reliquary   ${(100 * results.filter(r => r.lore >= 3).length / n).toFixed(1)}%  (optional; not required to win)`);
  const totalPlacements = content.areaOrder.reduce((n, id) => n + content.areas[id].placements.length, 0);
  console.log(`  creatures slain      mean ${mean(results, r => r.slain).toFixed(2)} of ${totalPlacements}`);
  console.log(`  encounter rounds     median ${median(results.map(r => r.rounds))}`);
  console.log(`  damage dealt / taken mean ${mean(results, r => r.dealt).toFixed(1)} / ${mean(results, r => r.taken).toFixed(1)}`);
  // Reactions, measured rather than asserted. A build whose reaction never
  // fires under the autopilot is a rule the engine implements and this
  // adventure's creatures never provoke, and that is worth reading off a
  // number instead of arguing about.
  console.log(`  reactions fired      mean ${mean(results, r => r.reactions).toFixed(2)}  (in ${(100 * results.filter(r => r.reactions > 0).length / n).toFixed(1)}% of runs)`);
  // Which commands the autopilot actually cast, counted rather than assumed,
  // and a build failure when one of them is never cast at all.
  //
  // The last phase shipped two pieces of content that validated at load and
  // were then never reached in a single number this project had quoted: a
  // `self-heal` branch the policy did not have, so Rousing Splash had never
  // been cast once, and an `inflicts` on an `unerring` command that applied
  // nothing because that branch read no degree of success. Neither crashed.
  // Both looked exactly like working content from the outside.
  //
  // This phase reproduced it on its own first run — Ember Burst and Warding
  // Pulse both read 0 — which is the argument for the line exiting non-zero
  // rather than printing a note somebody scrolls past (locked decision #13).
  // A command nothing ever casts is either content the adventure has no room
  // for or a policy that cannot see it, and both are worth stopping for.
  // Reactions are exempt: they fire from the bus rather than from a decision,
  // and they have their own line above.
  const casts = {};
  for (const r of results) for (const [id, k] of Object.entries(r.cast || {})) casts[id] = (casts[id] || 0) + k;
  const uncast = [];
  console.log("  commands cast");
  for (const cmd of content.commands) {
    if (cmd.kind === "reaction") continue;
    const k = casts[cmd.id] || 0;
    if (!k) uncast.push(cmd.name);
    console.log(`    ${cmd.name.padEnd(22)} ${String(k).padStart(6)}${k ? "" : "   ← never cast"}`);
  }
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
  const unused = [];
  if (owned.length) {
    console.log("  creature abilities used");
    for (const id of owned) {
      const k = fired[id] || 0;
      if (!k) unused.push(content.allCommandById[id].name);
      console.log(`    ${content.allCommandById[id].name.padEnd(22)} ${String(k).padStart(6)}${k ? "" : "   ← never used"}`);
    }
  }
  if (wins.length) {
    console.log(`  on a win: HP left    mean ${mean(wins, r => r.hp).toFixed(1)} of ${content.pc.hp}, median ${median(wins.map(r => r.hp))}`);
    console.log(`            potions left mean ${mean(wins, r => r.potions).toFixed(2)}`);
  }
  return { rate: wins.length / n, uncast: [...uncast, ...unused] };
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const runs = Number(process.argv[2]) || 2000;
  const verbose = process.argv.includes("--verbose");
  // Every build gets its own batch and its own band check — character
  // creation means "is this adventure winnable" is now a question per PC, not
  // one number for the pack. A build with an unfair chance at the vault is
  // exactly as much a shipped bug as the original single build being
  // unwinnable was.
  let allOk = true;
  for (const build of basePack.pcOptions) {
    const content = selectPc(basePack, build.id);
    if (verbose) console.log(`\nfirst twelve runs, ${build.name}:`);
    const { rate, uncast } = report(content, runBatch(content, runs, { verbose }));
    const inBand = rate >= BAND.min && rate <= BAND.max;
    // Two ways to fail, and they say which. A rate outside the band means
    // the adventure got unwinnable or free; a command nothing cast means
    // the pack grew content the game never reaches.
    const verdict = !inBand ? `BALANCE OUT OF BAND — ${build.id}: ${(100 * rate).toFixed(1)}%`
      : uncast.length ? `CONTENT NEVER REACHED — ${build.id}: ${uncast.join(", ")}`
      : `BALANCE OK — ${build.id}: ${(100 * rate).toFixed(1)}%`;
    console.log(`\n${verdict}\n`);
    allOk = allOk && inBand && !uncast.length;
  }
  process.exit(allOk ? 0 : 1);
}
