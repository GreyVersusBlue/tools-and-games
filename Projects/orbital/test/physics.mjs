// Orbital — physics test suite. No DOM, no browser: loads physics.js and the
// two level packs exactly the way index.html does (they're plain scripts that
// attach to globalThis), then exercises OrbitalPhysics directly.
//
// Run:  node Projects/orbital/test/physics.mjs [--verbose]
//
// Why this exists: physics.js's own header comment names "solvability tests"
// as the reason it's DOM-free, and none existed. A level nobody can actually
// win is a real, silent bug that 21 levels of hand-testing can hide — this
// brute-forces a launch vector for every one of them and fails loudly if it
// can't find one. Exits non-zero on any failure (locked decision #13).
//
// The v1->v2 save-migration check extracts game.js's persistence block by its
// own marker comments and evaluates it in isolation with a fake localStorage,
// rather than reimplementing loadSave()/writeSave() here — that would drift
// from the real code the moment either changed. If the markers move, this
// test fails with a clear message instead of silently testing stale logic.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(HERE, "..", "js");
const require = createRequire(import.meta.url);

require(path.join(JS, "physics.js"));
require(path.join(JS, "levels", "pack-01-basics.js"));
require(path.join(JS, "levels", "pack-02-deepspace.js"));

const { solve, substep, isSolid, MAXSPEED } = globalThis.OrbitalPhysics;
const PACKS = globalThis.OrbitalPacks;

// Flatten levels exactly like game.js does, including the stable `key`.
const LEVELS = [];
PACKS.forEach(p => p.levels.forEach((lv, i) => {
  LEVELS.push(Object.assign({}, lv, { pack: p.name, packId: p.id, localIdx: i, key: p.id + "#" + i }));
}));

const VERBOSE = process.argv.includes("--verbose");
const failures = [];
function check(name, cond, detail) {
  if (cond) { if (VERBOSE) console.log(`  ok    ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

console.log(`Orbital physics test — ${LEVELS.length} levels\n`);

// ============================================================
// 1. Every level has a winning launch vector
// ============================================================
// Coarse grid over angle x power first (fast — most levels resolve here).
// Any grid cell that doesn't WIN outright still reports how close its whole
// sampled path got to the goal, which seeds a shrinking local search around
// the closest miss for levels a grid alone doesn't crack (timed orbits,
// wormhole exits, boosted lines — the multi-body ones like The Gauntlet or
// Deep Field are exactly why the refinement pass exists).

function closestApproach(level, angle, power) {
  const sp = power * MAXSPEED;
  const r = solve(level.start, { x: Math.cos(angle) * sp, y: Math.sin(angle) * sp }, level);
  if (r.outcome === "WIN") return { win: true, dist: 0 };
  let best = Infinity;
  for (const p of r.pts) {
    const d = Math.hypot(p.x - level.goal.x, p.y - level.goal.y);
    if (d < best) best = d;
  }
  return { win: false, dist: best };
}

function findWinningShot(level) {
  const ANGLE_STEPS = 240, POWER_STEPS = 20;
  let best = null;
  for (let ai = 0; ai < ANGLE_STEPS; ai++) {
    const angle = (ai / ANGLE_STEPS) * Math.PI * 2;
    for (let pi = 1; pi <= POWER_STEPS; pi++) {
      const power = pi / POWER_STEPS;
      const r = closestApproach(level, angle, power);
      if (r.win) return { angle, power };
      if (!best || r.dist < best.dist) best = { angle, power, dist: r.dist };
    }
  }
  // Shrinking neighborhood search around the best grid candidate.
  let center = { angle: best.angle, power: best.power }, bestDist = best.dist;
  let dAngle = (Math.PI * 2) / ANGLE_STEPS, dPower = 1 / POWER_STEPS;
  for (let round = 0; round < 60; round++) {
    let improved = false;
    for (let da = -1; da <= 1; da++) for (let dp = -1; dp <= 1; dp++) {
      if (!da && !dp) continue;
      const angle = center.angle + da * dAngle;
      const power = Math.min(1, Math.max(0.01, center.power + dp * dPower));
      const r = closestApproach(level, angle, power);
      if (r.win) return { angle, power };
      if (r.dist < bestDist) { bestDist = r.dist; center = { angle, power }; improved = true; }
    }
    if (!improved) { dAngle *= 0.6; dPower *= 0.6; }
    if (dAngle < 1e-6 && dPower < 1e-6) break;
  }
  return null;
}

console.log("1. Every level has a winning launch vector");
const t0 = Date.now();
for (const lv of LEVELS) {
  const shot = findWinningShot(lv);
  check(
    `${lv.key.padEnd(16)} "${lv.name}"`,
    !!shot,
    shot ? "" : "no winning vector found in search budget (240x20 grid + local refinement)"
  );
}
if (VERBOSE) console.log(`  (search took ${Date.now() - t0}ms)`);

// ============================================================
// 2. Wormhole pairing + exitTurn
// ============================================================
console.log("\n2. Wormhole pairing / exitTurn");
{
  // exitTurn lives on the mouth you ENTER (`b` in game.js's substep — the
  // body the probe's distance check matches), not the one you exit from.
  // Confirmed against the code directly: `let ang = atan2(vy,vx) + (b.exitTurn
  // || 0)` reads exitTurn off `b`, the entry body, before ever looking up
  // `partner`. So a linked pair can be asymmetric — which mouth you enter
  // decides whether the exit turns you, matching "Portal Maze"'s own
  // wormhole-pair authoring (exitTurn set on only one of its two).
  const OFF = 16;
  const level = {
    bodies: [
      { type: "wormhole", x: 100, y: 100, r: 20, link: "a", exitTurn: Math.PI / 2 },
      { type: "wormhole", x: 500, y: 300, r: 20, link: "a" },
    ],
    goal: { x: -9999, y: -9999, r: 1 }, // far away so WIN can't intervene
  };
  // Start just inside the first mouth's radius, heading straight at +x.
  const st = { x: 90, y: 100, vx: 40, vy: 0, t: 0, lock: 0, jumped: false };
  substep(st, level);

  const sp = Math.hypot(st.vx, st.vy);
  check("preserves speed through the jump", Math.abs(sp - 40) < 1e-6, `speed=${sp}`);
  check("sets st.jumped so the renderer can break the line", st.jumped === true);

  const entryAngle = Math.atan2(0, 40); // 0
  const expectAngle = entryAngle + Math.PI / 2;
  const gotAngle = Math.atan2(st.vy, st.vx);
  check("exitTurn rotates the exit velocity", Math.abs(gotAngle - expectAngle) < 1e-6, `angle=${gotAngle}, expected=${expectAngle}`);

  const partner = level.bodies[1];
  const expX = partner.x + Math.cos(expectAngle) * (partner.r + OFF);
  const expY = partner.y + Math.sin(expectAngle) * (partner.r + OFF);
  check("exits at the linked partner, offset by r+16 along the (turned) angle",
    Math.hypot(st.x - expX, st.y - expY) < 1e-6, `got (${st.x.toFixed(2)},${st.y.toFixed(2)}) expected (${expX.toFixed(2)},${expY.toFixed(2)})`);

  check("sets a re-entry lock so the exit mouth doesn't immediately re-trigger", st.lock === 48, `lock=${st.lock}`);
}

// ============================================================
// 3. Booster kick direction
// ============================================================
console.log("\n3. Booster kick direction");
{
  const level = {
    bodies: [{ type: "booster", x: 500, y: 300, r: 30, dir: Math.PI / 2, boost: 100 }],
    goal: { x: -9999, y: -9999, r: 1 },
  };
  // 15px above center (inside r=30), moving sideways — booster is massless
  // (no `mass` field) so gravity contributes nothing; the kick is the only
  // thing that should change velocity this substep.
  const st = { x: 500, y: 285, vx: 10, vy: 0, t: 0, lock: 0, jumped: false };
  substep(st, level);
  check("kick doesn't perturb the perpendicular component", Math.abs(st.vx - 10) < 1e-6, `vx=${st.vx}`);
  check("kick applies fully along dir (dir=90°, boost=100)", Math.abs(st.vy - 100) < 1e-6, `vy=${st.vy}`);
  check("sets a re-trigger lock", st.lock === 40, `lock=${st.lock}`);
  check("a booster pass isn't a wormhole jump", st.jumped === false);
}

// ============================================================
// 4. Body solidity
// ============================================================
console.log("\n4. Body solidity");
check("planet is solid", isSolid("planet") === true);
check("star is solid", isSolid("star") === true);
check("rock is solid", isSolid("rock") === true);
check("blackhole is solid", isSolid("blackhole") === true);
check("repulse is not solid", isSolid("repulse") === false);
check("booster is not solid", isSolid("booster") === false);
check("wormhole is not solid", isSolid("wormhole") === false);

for (const type of ["planet", "star", "rock", "blackhole"]) {
  const level = { bodies: [{ type, x: 500, y: 300, r: 30, mass: 10 }], goal: { x: -9999, y: -9999, r: 1 } };
  const st = { x: 510, y: 300, vx: 0, vy: 0, t: 0, lock: 0, jumped: false }; // 10px inside r=30
  const outcome = substep(st, level);
  check(`touching a ${type} is CRASH`, outcome === "CRASH", `outcome=${outcome}`);
}
{
  // repulse is a gravity body (negative mass) but not solid — touching it
  // should never CRASH regardless of how close the probe gets.
  const level = { bodies: [{ type: "repulse", x: 500, y: 300, r: 30, mass: -40 }], goal: { x: -9999, y: -9999, r: 1 } };
  const st = { x: 505, y: 300, vx: 0, vy: 0, t: 0, lock: 0, jumped: false }; // 5px inside r=30
  const outcome = substep(st, level);
  check("touching a repulse never CRASHes", outcome !== "CRASH", `outcome=${outcome}`);
}

// ============================================================
// 5. Save migration: orbital_progress_v1 -> v2
// ============================================================
console.log("\n5. Save migration v1 -> v2");
{
  const gameSrc = fs.readFileSync(path.join(JS, "game.js"), "utf8");
  const startMarker = "// ---- persistence (by stable key, so new packs never shift old progress) ----";
  const endMarker = "// ---- canvas / view ----";
  const si = gameSrc.indexOf(startMarker), ei = gameSrc.indexOf(endMarker);

  if (si === -1 || ei === -1) {
    check("persistence block markers found in game.js", false,
      "markers moved or renamed in game.js — update the marker strings in test/physics.mjs");
  } else {
    const block = gameSrc.slice(si, ei);
    const fakeStore = new Map();
    const fakeLocalStorage = {
      getItem: k => (fakeStore.has(k) ? fakeStore.get(k) : null),
      setItem: (k, v) => fakeStore.set(k, String(v)),
    };
    const sandbox = { localStorage: fakeLocalStorage, exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(block + "\nexports.loadSave = loadSave; exports.writeSave = writeSave; exports.SAVE_KEY = SAVE_KEY;", sandbox);
    const { loadSave, writeSave, SAVE_KEY } = sandbox.exports;

    check("SAVE_KEY is unchanged (locked decision #36)", SAVE_KEY === "orbital_progress_v2", `SAVE_KEY="${SAVE_KEY}"`);

    // Hand-built v1 fixture: the old flat object keyed by plain numeric index.
    fakeStore.set("orbital_progress_v1", JSON.stringify({ "0": 3, "2": 1, "5": 2 }));
    const migrated = loadSave();
    check("v1 fixture migrates to basics#N keys",
      migrated["basics#0"] === 3 && migrated["basics#2"] === 1 && migrated["basics#5"] === 2,
      JSON.stringify(migrated));

    writeSave(migrated);
    const raw = fakeStore.get(SAVE_KEY);
    check("migrated save round-trips under the v2 key", raw === JSON.stringify(migrated), raw);

    // Once a v2 key exists, it wins outright — no re-migration of stale v1 data.
    fakeStore.set("orbital_progress_v1", JSON.stringify({ "0": 99 }));
    fakeStore.set(SAVE_KEY, JSON.stringify({ "deepspace#1": 2 }));
    const reload = loadSave();
    check("an existing v2 key takes precedence over v1",
      reload["deepspace#1"] === 2 && reload["basics#0"] === undefined, JSON.stringify(reload));
  }
}

// ============================================================
console.log(`\n${failures.length === 0 ? "ALL PASSED" : failures.length + " FAILED"} (${LEVELS.length} levels, ${failures.length + (VERBOSE ? 0 : 0)} total checks failing)`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
