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
//      levels as the fixture: which are accepted at the medium band and which
//      three are refused, each for the reason its numbers say.
//   4. A recipe that cannot make a level inside the candidate cap hands back
//      null rather than looping, and says how many it tried.
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
// The medium band is [0.8%, 5%] of the grid winning, with at most a third of
// those wins also winning in an empty field. Read against the 22 shipped
// levels that is: First Light refused because it has no bodies at all (every
// win would win anyway); The Long Way refused as a needle at 9 wins in 1200,
// which is also the level where all 9 skip both portals; and First Portal,
// Dark Slingshot, Twin Holes and Singularity Run refused as loose, at 12.7%,
// 6.3%, 5.8% and 5.1%. The other 16 are accepted. Move a band and this table
// says which shipped level changed sides.
console.log("\n4. The judge's words, read against the shipped levels at the medium band");
const EXPECT = {
  "basics#0": "decoration", "deepspace#7": "needle",
  "deepspace#1": "loose", "deepspace#2": "loose", "deepspace#6": "loose", "deepspace#10": "loose"
};
const t1 = Date.now();
for (const lv of LEVELS) {
  const cen = G.census(lv);
  const got = G.judge(lv, cen, "medium");
  const want = EXPECT[lv.key] || null;
  check(`${lv.key.padEnd(13)} "${lv.name}" is ${want || "accepted"}`, got === want,
    `got ${got || "accepted"} at ${cen.wins}/${cen.total} wins, ${cen.anyway} would win anyway`);
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
console.log(`\n${failures.length === 0 ? "ALL PASSED" : failures.length + " FAILED"}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
