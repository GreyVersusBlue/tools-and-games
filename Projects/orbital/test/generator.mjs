// Orbital — level generator test suite. No DOM, no browser: loads physics.js,
// the codec, the generator and the two level packs the way index.html does,
// then exercises OrbitalGen directly.
//
// Run:  node Projects/orbital/test/generator.mjs [--verbose]
//
// Why this exists: a generator's wrong answer is silent. A level it hands out
// that cannot be won, that is won by any shot at all, or that a stranger's
// browser rebuilds differently from the seed's name is not an error anybody
// sees — it is a dull sector somebody closes. So the checks here are the
// claims the generator makes, each measured rather than trusted:
//
//   1. The same tier and seed produce the same level, to the character.
//   2. What it produces is a level: validate() is silent, the codec round
//      trips it, the CI search (findWinningShot, the budget the suite and the
//      editor share, #399) finds a shot, and that shot re-flies to a WIN.
//   3. The judge means what its words mean, held against the 22 shipped
//      levels as the fixture, at each tier's band: which are accepted and
//      which refused, each for the reason its numbers say. The 18 rolled
//      levels are pinned too (candidates spent, wins, wins that win anyway),
//      so a moved band or a changed recipe names the seed it moved.
//   4. A recipe that cannot make a level inside the candidate cap hands back
//      null rather than looping, and says how many it tried.
//   5. The census the editor's Check prints (#877) is this one: the same
//      draft reads the same figure however it is sliced, three shipped levels'
//      lines are pinned, and the two zero cases each have their own sentence.
//
// Exits non-zero on any failure (locked decision #13).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(HERE, "..", "js");
const require = createRequire(import.meta.url);

require(path.join(JS, "physics.js"));
require(path.join(JS, "levelcode.js"));
require(path.join(JS, "generator.js"));
require(path.join(JS, "levels", "pack-01-basics.js"));
require(path.join(JS, "levels", "pack-02-deepspace.js"));

const G = globalThis.OrbitalGen, C = globalThis.OrbitalCode;
const { solve, findWinningShot, MAXSPEED, SEARCH } = globalThis.OrbitalPhysics;

const LEVELS = [];
globalThis.OrbitalPacks.forEach(p => p.levels.forEach((lv, i) =>
  LEVELS.push(Object.assign({}, lv, { key: p.id + "#" + i }))));

const VERBOSE = process.argv.includes("--verbose");
const failures = [];
function check(name, cond, detail) {
  if (cond) { if (VERBOSE) console.log(`  ok    ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
const fly = (lv, shot) => {
  const sp = shot.power * MAXSPEED;
  return solve(lv.start, { x: Math.cos(shot.angle) * sp, y: Math.sin(shot.angle) * sp }, lv).outcome;
};

const TIERS = Object.keys(G.TIERS);
const SEEDS = [1, 2, 3, 4, 5, 6];
console.log(`Orbital generator test — ${TIERS.length} tiers x ${SEEDS.length} seeds, ${LEVELS.length} shipped levels as the judge's fixture\n`);

// ============================================================
// 1. Determinism
// ============================================================
console.log("1. The same tier and seed make the same level");
for (const tier of TIERS) {
  const a = G.generate(tier, 7), b = G.generate(tier, 7);
  check(`${tier} seed 7 twice, identical codes`, a && b && C.encode(a) === C.encode(b),
    a && b ? `${C.encode(a)} vs ${C.encode(b)}` : "one of them was null");
  const c = G.generate(tier, 8);
  check(`${tier} seed 7 and seed 8 differ`, a && c && C.encode(a) !== C.encode(c));
}
check("a seed's name is its base-36 spelling", G.seedName(1295) === "Sector ZZ", G.seedName(1295));
check("a negative seed spells as the unsigned value, not with a minus", !/-/.test(G.seedName(-1)), G.seedName(-1));

// ============================================================
// 2. The census grid is the search grid, subsampled
// ============================================================
// Every census cell has to be a cell of makeSearch's grid pass, or "the
// census saw a win" and "CI's search finds a win" are two different claims.
console.log("\n2. The census grid divides the search grid");
{
  const g = G.censusGrid();
  check("angles divide evenly", SEARCH.angleSteps % G.CENSUS.angleDiv === 0 && g.angles === SEARCH.angleSteps / G.CENSUS.angleDiv,
    `${SEARCH.angleSteps} / ${G.CENSUS.angleDiv} = ${g.angles}`);
  check("powers divide evenly", SEARCH.powerSteps % G.CENSUS.powerDiv === 0 && g.powers === SEARCH.powerSteps / G.CENSUS.powerDiv,
    `${SEARCH.powerSteps} / ${G.CENSUS.powerDiv} = ${g.powers}`);
}

// ============================================================
// 3. Everything generated is a level, and a winnable one
// ============================================================
console.log("\n3. Generated levels: valid, round-trippable, winnable at the CI budget");
// What each seed rolled on 2026-10-05, read off this generator and not
// recomputed here: [candidates spent, census wins of 1,200, wins that also win
// in an empty field]. A band that moves, or a proposer that draws one more
// number from the stream, changes a row and this says which. The bands were
// measured over 200 seeds a tier that day and left alone (BACKLOG.md, Orbital
// item 5); these 18 are the part of that reading the suite can afford.
const ROLLED = {
  "easy seed 1": [1, 16, 0], "easy seed 2": [1, 13, 0], "easy seed 3": [1, 23, 2],
  "easy seed 4": [1, 21, 5], "easy seed 5": [1, 13, 0], "easy seed 6": [2, 12, 0],
  "medium seed 1": [1, 29, 0], "medium seed 2": [2, 18, 2], "medium seed 3": [1, 31, 0],
  "medium seed 4": [1, 19, 0], "medium seed 5": [3, 27, 0], "medium seed 6": [1, 20, 0],
  "hard seed 1": [1, 30, 1], "hard seed 2": [1, 17, 0], "hard seed 3": [1, 11, 0],
  "hard seed 4": [3, 10, 0], "hard seed 5": [3, 27, 0], "hard seed 6": [1, 13, 0]
};
const made = {};
const t0 = Date.now();
for (const tier of TIERS) {
  const T = G.TIERS[tier];
  for (const seed of SEEDS) {
    const tag = `${tier} seed ${seed}`;
    const gen = G.makeGenerator(tier, seed);
    let r; do { r = gen.step(512); } while (!r.done);
    const lv = r.level;
    check(`${tag} produced a level`, !!lv, `null after ${r.tried} candidates: ${JSON.stringify(r.report)}`);
    if (!lv) continue;
    made[tag] = lv;
    const got = [r.tried, lv.census.wins, lv.census.anyway], pin = ROLLED[tag];
    check(`${tag} is the level pinned for it: candidate ${pin[0]}, ${pin[1]} wins, ${pin[2]} anyway`,
      got.join() === pin.join(), `got candidate ${got[0]}, ${got[1]} wins, ${got[2]} anyway`);
    if (VERBOSE) console.log(`        ${tag}: ${r.tried} candidate${r.tried === 1 ? "" : "s"}, ${lv.bodies.length} bodies, ${lv.census.wins}/${lv.census.total} win, ${lv.census.anyway} anyway — "${lv.sub}"`);

    const bad = C.validate(lv);
    check(`${tag} passes validate()`, bad.length === 0, bad.join(" "));
    const code = C.encode(lv);
    check(`${tag} encodes under the link cap`, code.length <= C.MAX_CODE, `${code.length} characters`);
    check(`${tag} round-trips to the same code`, C.encode(C.decode(code)) === code);
    check(`${tag} has a body count inside its tier`, lv.bodies.length >= T.bodies[0] && lv.bodies.length <= T.bodies[1],
      `${lv.bodies.length} bodies, tier allows ${T.bodies[0]} to ${T.bodies[1]}`);
    const strange = lv.bodies.filter(b => !T.types.includes(b.type)).map(b => b.type);
    check(`${tag} uses only its tier's body types`, strange.length === 0, `found ${strange.join(", ")}`);
    check(`${tag} is accepted by its own tier's judge`, G.judge(lv, lv.census, tier) === null, G.judge(lv, lv.census, tier));
    check(`${tag}'s first census win re-flies to a WIN`, lv.census.first && fly(lv, lv.census.first) === "WIN",
      lv.census.first ? fly(lv, lv.census.first) : "no first win recorded");

    const shot = findWinningShot(lv);
    check(`${tag} has a winning shot at the CI budget`, !!shot, "findWinningShot returned null");
    if (shot) check(`${tag}'s CI shot re-flies to a WIN`, fly(lv, shot) === "WIN", fly(lv, shot));
    check(`${tag} carries no campaign key`, lv.key === undefined && lv.pack === undefined);
  }
}
if (VERBOSE) console.log(`  (generation and re-flights took ${Date.now() - t0}ms)`);

// ============================================================
// 4. The judge, against the shipped levels
// ============================================================
// Each band is a share of the grid winning, with at most a third of those
// wins also winning in an empty field: Easy 1% to 8%, Medium 0.8% to 5%, Hard
// 0.5% to 3%. Read against the 22 shipped levels at Medium that is: First
// Light refused because it has no bodies at all (every win would win anyway);
// The Long Way refused as a needle at 9 wins in 1200, which is also the level
// where all 9 skip both portals; and First Portal, Dark Slingshot, Twin Holes
// and Singularity Run refused as loose, at 12.7%, 6.3%, 5.8% and 5.1%. The
// other 16 are accepted. Easy's wider top lets three of those four back in and
// its higher floor turns The Gauntlet (0.83%) away, 18 accepted; Hard's 3% top
// refuses seven of the twelve deep-space levels and its lower floor lets The
// Long Way's 9 wins through to the decoration test, 13 accepted. One census a
// level serves all three. Move a band and this table says which shipped level
// changed sides, and at which tier.
console.log("\n4. The judge's words, read against the shipped levels at each tier's band");
const EXPECT = {
  easy: { "basics#0": "decoration", "basics#9": "needle", "deepspace#2": "loose", "deepspace#7": "needle" },
  medium: {
    "basics#0": "decoration", "deepspace#7": "needle",
    "deepspace#1": "loose", "deepspace#2": "loose", "deepspace#6": "loose", "deepspace#10": "loose"
  },
  hard: {
    "basics#0": "decoration", "deepspace#7": "decoration",
    "deepspace#1": "loose", "deepspace#2": "loose", "deepspace#3": "loose", "deepspace#6": "loose",
    "deepspace#9": "loose", "deepspace#10": "loose", "deepspace#11": "loose"
  }
};
const t1 = Date.now();
for (const lv of LEVELS) {
  const cen = G.census(lv);
  for (const tier of TIERS) {
    const got = G.judge(lv, cen, tier);
    const want = EXPECT[tier][lv.key] || null;
    check(`${lv.key.padEnd(13)} "${lv.name}" at ${tier} is ${want || "accepted"}`, got === want,
      `got ${got || "accepted"} at ${cen.wins}/${cen.total} wins, ${cen.anyway} would win anyway`);
  }
}
if (VERBOSE) console.log(`  (22 censuses took ${Date.now() - t1}ms)`);

// ============================================================
// 5. The candidate cap
// ============================================================
console.log("\n5. A spent cap is a null, not a loop");
{
  // easy seed 9's first candidate is refused (a needle) and its third is
  // accepted, so a cap of one is a known miss and a cap of three a known hit.
  const miss = G.makeGenerator("easy", 9, { candidates: 1 });
  let r; do { r = miss.step(512); } while (!r.done);
  check("cap of 1 on easy seed 9 hands back null", r.level === null && r.tried === 1, `level=${!!r.level} tried=${r.tried}`);
  check("and the report names why", Object.values(r.report).reduce((a, b) => a + b, 0) === 1, JSON.stringify(r.report));
  const hit = G.generate("easy", 9, { candidates: 3 });
  check("cap of 3 on easy seed 9 succeeds", !!hit);
}

// ============================================================
// 6. The census as the editor's Check reads it (#877)
// ============================================================
// editor.js calls makeCensus on C.clean(draft) one launch a step and prints
// censusLine of the result. Nothing here re-counts a win: the figures are
// literals read off this census on 2026-10-05, and the Check's line in
// test/browser.mjs is held to the same two Slingshot literals.
console.log("\n6. The census line the editor's Check prints");
{
  const draft = i => C.clean(LEVELS[i]);
  const sliced = (lv, n) => { const c = G.makeCensus(lv); let r; do { r = c.step(n); } while (!r.done); return r.result; };
  const same = (a, b) => a.wins === b.wins && a.anyway === b.anyway && a.total === b.total;

  // Same draft, same figure: one launch a step (the editor), 512 (the
  // generator), and after a trip through the codec (a reload of #e=).
  const one = sliced(draft(2), 1), big = G.census(draft(2)), back = G.census(C.decode(C.encode(draft(2))));
  check("Slingshot one launch a step and 512 a step agree", same(one, big), `${one.wins}/${one.total} vs ${big.wins}/${big.total}`);
  check("and so does the draft read back from its code", same(one, back), `${one.wins}/${one.total} vs ${back.wins}/${back.total}`);
  check("progress runs from the first launch to 1", (() => {
    const c = G.makeCensus(draft(0)); const a = c.step(1).progress; let r; do { r = c.step(7); } while (!r.done);
    return a === 1 / 1200 && r.progress === 1;
  })());

  const PIN = { 2: "1.4% of launches win (17 of 1,200).", 12: "12.7% of launches win (152 of 1,200).", 17: "0.8% of launches win (9 of 1,200)." };
  for (const i of Object.keys(PIN)) {
    const line = G.censusLine(i === "2" ? one : G.census(draft(+i)));
    check(`"${LEVELS[i].name}" reads "${PIN[i]}"`, line === PIN[i], line);
  }
  // The marker widened from 40 to 60, which is the edit browser.mjs makes.
  const wide = draft(2); wide.goal.r = 60;
  const wl = G.censusLine(G.census(wide));
  check("Slingshot with a 60 marker reads 2.4%, 29 of 1,200", wl === "2.4% of launches win (29 of 1,200).", wl);

  // An unwinnable draft: one asteroid of the largest radius, 5 px clear of the
  // launch point, shadows the whole marker. The search spends its budget, and
  // the census agrees at zero, which is why the Check does not fly it.
  const walled = C.decode("o1$Walled$$120,300$880,300,44$k,245,300,120,0");
  check("the walled draft is a level", C.validate(walled).length === 0, C.validate(walled).join(" "));
  check("the search finds no shot in it", findWinningShot(walled) === null);
  const wc = G.census(walled);
  check("and its census wins nothing", wc.wins === 0 && wc.first === null && wc.total === 1200, `${wc.wins}/${wc.total}`);
  check("an unwinnable draft's line says the census was not flown",
    G.censusLine(null) === "No census: its 1,200 launches are among those.", G.censusLine(null));

  // A winnable draft the census never wins: an empty field with a 20 marker
  // 850 px out at 1.5 degrees. The search's grid has that angle; the census,
  // every second one, has 0 and 3 degrees and flies either side of it.
  const narrow = C.decode("o1$Narrow$$100,300$950,322,20$");
  const ns = findWinningShot(narrow);
  check("the narrow draft has a winning shot", !!ns && fly(narrow, ns) === "WIN", JSON.stringify(ns));
  check("on an angle the census skips", !!ns && Math.abs(ns.angle - Math.PI * 2 / SEARCH.angleSteps) < 1e-12, ns && String(ns.angle));
  const nc = G.census(narrow);
  check("and its census wins nothing", nc.wins === 0, `${nc.wins}/${nc.total}`);
  check("a zero beside a found shot has its own sentence",
    G.censusLine(nc) === "None of the census's 1,200 launches win, though: the window is narrower than its grid.", G.censusLine(nc));
}

// ============================================================
console.log(`\n${failures.length === 0 ? "ALL PASSED" : failures.length + " FAILED"}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
