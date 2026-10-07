// Orbital — physics test suite. No DOM, no browser: loads physics.js and the
// two level packs exactly the way index.html does (they're plain scripts that
// attach to globalThis), then exercises OrbitalPhysics directly.
//
// Run:  node Projects/orbital/test/physics.mjs [--verbose]
//
// The codec that turns one of these levels into a share link has its own
// suite next door: test/levelcode.mjs.
//
// Why this exists: physics.js's own header comment names "solvability tests"
// as the reason it's DOM-free, and none existed. A level nobody can actually
// win is a real, silent bug that 21 levels of hand-testing can hide — this
// brute-forces a launch vector for every one of them and fails loudly if it
// can't find one. Exits non-zero on any failure (locked decision #13).
//
// The save checks import js/save.mjs, the module the page itself loads, and
// hand its slot a Map behind localStorage's three methods. Nothing of the slot
// or of the v1 carry-over is rebuilt here. `test/fixtures/progress-eb2806c.json`
// is what the build before the slot (eb2806c, 2026-10-07) wrote for a made-up
// campaign, byte for byte: it was produced by running that build's own
// writeSave(), and it is the old save every later build has to keep reading.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(HERE, "..", "js");
const require = createRequire(import.meta.url);

require(path.join(JS, "physics.js"));
require(path.join(JS, "levels", "pack-01-basics.js"));
require(path.join(JS, "levels", "pack-02-deepspace.js"));

const { solve, substep, isSolid, MAXSPEED, findWinningShot } = globalThis.OrbitalPhysics;
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
// The search itself lives in physics.js now, because the editor's Check
// button runs it too and a level the editor calls winnable had better be one
// this suite calls winnable. What stays here is the claim: every shipped level
// has a shot, and the shot the search hands back is re-flown before it counts.
// A search that returned a plausible-looking angle it never actually flew
// would pass "!!shot" and fail the line under it.

console.log("1. Every level has a winning launch vector");
const t0 = Date.now();
for (const lv of LEVELS) {
  const shot = findWinningShot(lv);
  check(
    `${lv.key.padEnd(16)} "${lv.name}"`,
    !!shot,
    shot ? "" : "no winning vector found in search budget (240x20 grid + local refinement)"
  );
  if (!shot) continue;
  const sp = shot.power * MAXSPEED;
  const r = solve(lv.start, { x: Math.cos(shot.angle) * sp, y: Math.sin(shot.angle) * sp }, lv);
  check(
    `${lv.key.padEnd(16)} the reported shot re-flies to a WIN`,
    r.outcome === "WIN",
    `outcome=${r.outcome} at ${(shot.angle * 180 / Math.PI).toFixed(1)}deg / ${(shot.power * 100) | 0}%`
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
// 5. The save: the slot, an old save, and a file out and back
// ============================================================
console.log("\n5. The save");
{
  const { SAVE_KEY, SAVE_VERSION, makeSlot, loadProgress, repair } =
    await import(pathToFileURL(path.join(JS, "save.mjs")).href);
  const store = () => {
    const m = new Map();
    return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  check("SAVE_KEY is unchanged (locked decision #36)", SAVE_KEY === "orbital_progress_v2", `SAVE_KEY="${SAVE_KEY}"`);

  // --- the v1 key, carried over as it always was ---
  {
    const st = store(), slot = makeSlot({ storage: st });
    // Hand-built v1 fixture: the old flat object keyed by plain numeric index.
    st.m.set("orbital_progress_v1", JSON.stringify({ "0": 3, "2": 1, "5": 2 }));
    const migrated = loadProgress(slot, st);
    check("v1 fixture migrates to basics#N keys",
      same(migrated, { "basics#0": 3, "basics#2": 1, "basics#5": 2 }), JSON.stringify(migrated));
    check("reading the v1 save writes nothing: it is carried over on the next win", !st.m.has(SAVE_KEY),
      String(st.m.get(SAVE_KEY)));

    slot.save(migrated);
    check("migrated save round-trips under the v2 key", same(loadProgress(slot, st), migrated), st.m.get(SAVE_KEY));

    // Once a v2 key exists, it wins outright — no re-migration of stale v1 data.
    st.m.set("orbital_progress_v1", JSON.stringify({ "0": 99 }));
    st.m.set(SAVE_KEY, JSON.stringify({ "deepspace#1": 2 }));
    const reload = loadProgress(slot, st);
    check("an existing v2 key takes precedence over v1", same(reload, { "deepspace#1": 2 }), JSON.stringify(reload));

    // A wiped campaign is an empty object on disk, and it is still a v2 save.
    slot.save({});
    check("a wiped save is an empty record, not a missing key", st.m.get(SAVE_KEY) === `{"__v":${SAVE_VERSION}}`, st.m.get(SAVE_KEY));
    check("and a wiped save does not bring the v1 one back", same(loadProgress(slot, st), {}),
      JSON.stringify(loadProgress(slot, st)));
  }

  // --- a save from the build before the slot ---
  const OLD = fs.readFileSync(path.join(HERE, "fixtures", "progress-eb2806c.json"), "utf8");
  const oldState = JSON.parse(OLD);
  {
    const st = store(), slot = makeSlot({ storage: st });
    st.m.set(SAVE_KEY, OLD);
    const got = loadProgress(slot, st);
    check("an old save loads with every key and every count as it was written", same(got, oldState), JSON.stringify(got));
    slot.save(got);
    // The version stamp is the whole difference on disk.
    check("and saved again it is the same bytes plus the version stamp",
      st.m.get(SAVE_KEY) === OLD.slice(0, -1) + `,"__v":${SAVE_VERSION}}`, st.m.get(SAVE_KEY));
    check("which loads to the same thing, with no stamp left in it", same(loadProgress(slot, st), oldState),
      JSON.stringify(loadProgress(slot, st)));
  }

  // --- export to a file, import on another browser ---
  {
    const a = store(), slotA = makeSlot({ storage: a });
    a.m.set(SAVE_KEY, OLD);
    const state = loadProgress(slotA, a);
    slotA.save(state);
    const file = slotA.serialize(state);
    const env = JSON.parse(file);
    check("the exported file names the game and the version",
      env.format === "gvb-save" && env.game === "orbital" && env.version === SAVE_VERSION, `${env.format} ${env.game} v${env.version}`);

    const b = store(), slotB = makeSlot({ storage: b });
    const back = slotB.deserialize(file);
    check("the file imports", back !== null);
    if (back) {
      slotB.save(back);
      check("and what it writes is byte for byte what the first browser had", b.m.get(SAVE_KEY) === a.m.get(SAVE_KEY),
        `${b.m.get(SAVE_KEY)} vs ${a.m.get(SAVE_KEY)}`);
      const stamp = t => t.replace(/"savedAt": "[^"]*"/, '"savedAt": ""');
      check("and exported again it is the same file, the time it was saved aside",
        stamp(slotB.serialize(back)) === stamp(file) && stamp(file) !== file);
    }

    const slot = makeSlot({ storage: store() });
    check("another game's file is refused",
      slot.deserialize(JSON.stringify({ format: "gvb-save", game: "signal-city", version: 1, state: { "basics#0": 1 } })) === null);
    check("a list is refused, it is not a campaign", slot.deserialize("[1,2,3]") === null);
    check("and so is a file that is not JSON", slot.deserialize("basics#0 = 1") === null);
    const mended = slot.deserialize(JSON.stringify({ "basics#0": 2, "basics#1": "3", "basics#2": null, "basics#3": 0, "basics#4": -1, "later#7": 4, "basics#5": 2.9 }));
    check("a hand-edited file keeps its attempt counts and drops what is not one",
      same(mended, { "basics#0": 2, "later#7": 4, "basics#5": 2 }), JSON.stringify(mended));
    check("repair leaves a real save exactly as it found it", same(repair(oldState), oldState), JSON.stringify(repair(oldState)));
  }

  // One writer. game.js asks the slot and holds no storage call of its own;
  // a second one would write the bare shape back over the stamped one.
  const gameSrc = fs.readFileSync(path.join(JS, "game.js"), "utf8");
  check("game.js reads and writes through the slot and nothing else",
    !/localStorage/.test(gameSrc) && gameSrc.includes("OrbitalSave.load()") &&
    gameSrc.split("OrbitalSave.save(progress)").length === 3);
}

// ============================================================
console.log(`\n${failures.length === 0 ? "ALL PASSED" : failures.length + " FAILED"} (${LEVELS.length} levels, ${failures.length + (VERBOSE ? 0 : 0)} total checks failing)`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
