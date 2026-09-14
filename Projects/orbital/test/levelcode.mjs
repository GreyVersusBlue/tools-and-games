// Orbital — level codec test suite. No DOM, no browser: loads physics.js, the
// codec and the two level packs the way index.html does, then exercises
// OrbitalCode directly.
//
// Run:  node Projects/orbital/test/levelcode.mjs [--verbose]
//
// Why this exists: a level code is a wire format. Somebody pastes a link into
// a chat window and a stranger's browser has to build the same level out of
// it, months later, with no server in between to fix anything up. Two things
// can go wrong silently, and this suite is aimed at both:
//
//   1. A round trip that loses a field. The level still opens, it just flies
//      differently — so the check here is not "the objects look alike", it is
//      "the same launch has the same outcome and the same end state to the
//      last bit", run against all 22 shipped levels as the fixture.
//   2. A decoder that accepts what it should refuse. Everything it reads came
//      out of somebody else's address bar, so each malformed input below is
//      asserted to fail WITH THE REASON IT SHOULD FAIL FOR — a test that only
//      checks "it threw" passes on the wrong throw.
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
require(path.join(JS, "levels", "pack-01-basics.js"));
require(path.join(JS, "levels", "pack-02-deepspace.js"));

const C = globalThis.OrbitalCode;
const { solve, findWinningShot, MAXSPEED } = globalThis.OrbitalPhysics;

const LEVELS = [];
globalThis.OrbitalPacks.forEach(p => p.levels.forEach((lv, i) =>
  LEVELS.push(Object.assign({}, lv, { key: p.id + "#" + i }))));

const VERBOSE = process.argv.includes("--verbose");
const failures = [];
function check(name, cond, detail) {
  if (cond) { if (VERBOSE) console.log(`  ok    ${name}`); }
  else { failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
// Asserts the throw AND its reason. `want` is a substring of the message.
function throws(name, fn, want) {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  if (msg === null) { check(name, false, "it did not throw at all"); return; }
  check(name, msg.includes(want), `threw "${msg}", which does not mention "${want}"`);
}

console.log(`Orbital level-codec test — ${LEVELS.length} shipped levels as the fixture\n`);

// ============================================================
// 1. Every shipped level survives the round trip, in flight
// ============================================================
// The position after the flight is the assertion, not the JSON. Twelve vectors
// spread over the circle, PLUS one aimed straight at each body in the level at
// two powers — and the second half is there because the first was not enough.
// Re-encoding a booster's kick as its heading (210 becomes -0.9) left all
// twelve sweep launches landing in exactly the same place on all three booster
// levels: not one of them flew near a booster. The comment claiming the sweep
// would catch a dropped kick was a claim the arithmetic could not make. With a
// shot aimed at each body, that same break fails this assertion on two of the
// three booster levels ("Kick" flies to a WIN before and a CRASH after) — the
// third, "Gravity Assist", is still only caught downstream by the validator,
// because its booster sits behind a star that bends every direct shot away
// from it. Two of three is what the arithmetic can claim, and #34 is why it was
// measured rather than assumed.
console.log("1. Round trip: 22 levels, a sweep plus a shot at every body, identical flights");
const SWEEP = [];
for (let a = 0; a < 6; a++) for (const pw of [0.35, 0.8]) SWEEP.push([a * Math.PI / 3, pw]);
const vectorsFor = lv => SWEEP.concat(lv.bodies.flatMap(b => {
  const a = Math.atan2(b.y - lv.start.y, b.x - lv.start.x);
  return [[a, 0.5], [a, 1]];
}));

for (const lv of LEVELS) {
  const code = C.encode(lv);
  const back = C.decode(code);

  check(`${lv.key.padEnd(16)} encode is idempotent`, C.encode(back) === code,
    `"${C.encode(back)}" !== "${code}"`);

  let drift = null;
  for (const [ang, pw] of vectorsFor(lv)) {
    const v = { x: Math.cos(ang) * pw * MAXSPEED, y: Math.sin(ang) * pw * MAXSPEED };
    const a = solve(lv.start, v, lv), b = solve(back.start, v, back);
    if (a.outcome !== b.outcome || a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy || a.t !== b.t) {
      drift = `${(ang * 180 / Math.PI) | 0}° at ${pw}: ${a.outcome} (${a.x.toFixed(3)},${a.y.toFixed(3)}) vs ${b.outcome} (${b.x.toFixed(3)},${b.y.toFixed(3)})`;
      break;
    }
  }
  check(`${lv.key.padEnd(16)} flies identically after the round trip`, drift === null, drift);
  check(`${lv.key.padEnd(16)} validates clean`, C.validate(back).length === 0, C.validate(back).join(" "));
}

// A code is a link, and a link has to stay short enough to paste.
const longest = LEVELS.map(lv => C.encode(lv)).reduce((a, b) => a.length >= b.length ? a : b);
check(`the longest shipped level is under 200 characters`, longest.length < 200, `${longest.length}: ${longest}`);

// And it has to survive being a link. RFC 3986's fragment grammar is
//   fragment = *( pchar / "/" / "?" ),  pchar = unreserved / pct-encoded /
//   sub-delims / ":" / "@"
// which is this set. A character outside it is one a chat client, a mail
// client or a URL normaliser is entitled to percent-encode on the way to the
// next reader, and the code that comes out the other end is a different
// string. `|` is outside it, which is why it is not the section delimiter
// even though Chrome keeps it verbatim.
const FRAGMENT_OK = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/;
for (const lv of LEVELS) {
  const code = C.encode(lv);
  const bad = [...code].filter(ch => !FRAGMENT_OK.test(ch));
  check(`${lv.key.padEnd(16)} is legal in a URL fragment`, bad.length === 0, `illegal: ${JSON.stringify(bad)}`);
}
// Including a level whose name is made of the characters most likely to break it.
{
  const nasty = Object.assign(C.blank(), { name: "a|b$c;d,e@f/g?h#i", sub: "100% ☄ <>&\"'" });
  const code = C.encode(nasty);
  check("a level named out of delimiters is still fragment-legal", FRAGMENT_OK.test(code), code);
  check("and still round-trips", C.decode(code).name === nasty.name, C.decode(code).name);
}

// ============================================================
// 2. Decode refuses malformed input, for the right reason
// ============================================================
console.log("\n2. Decode refuses malformed input");
const GOOD = C.encode(C.blank());
throws("a non-string", () => C.decode(null), "not a string");
throws("a code with no version", () => C.decode("120,500$880,160,44$"), 'expected "o1"');
throws("a future version", () => C.decode("o9$a$b$1,2$3,4,5$"), 'expected "o1"');
throws("a section missing", () => C.decode("o1$a$b$1,2$3,4,5"), "expected 6 sections, got 5");
throws("a section too many", () => C.decode(GOOD + "$extra"), "expected 6 sections, got 7");
throws("a start with one field", () => C.decode("o1$a$b$120$880,160,44$"), "start takes 2 fields, got 1");
throws("a goal with two fields", () => C.decode("o1$a$b$120,500$880,160$"), "goal takes 3 fields, got 2");
throws("an unknown type letter", () => C.decode("o1$a$b$120,500$880,160,44$z,1,2,3,4"), 'unknown type letter "z"');
throws("a planet with a field missing", () => C.decode("o1$a$b$120,500$880,160,44$p,1,2,3"), "planet takes 5 fields, got 4");
throws("a wormhole with a planet's field count", () => C.decode("o1$a$b$120,500$880,160,44$w,1,2,3,a"), "wormhole takes 6 fields, got 5");
throws("a booster with a planet's field count", () => C.decode("o1$a$b$120,500$880,160,44$t,1,2,3,0"), "booster takes 6 fields, got 5");
throws("a wormhole with an empty link", () => C.decode("o1$a$b$120,500$880,160,44$w,1,2,3,,0"), "wormhole has no link id");
throws("a mass that is not a number", () => C.decode("o1$a$b$120,500$880,160,44$p,1,2,3,banana"), 'body 1 mass: not a number ("banana")');
throws("an exponent, which encode never emits", () => C.decode("o1$a$b$120,500$880,160,44$p,1,2,3,1e9"), 'not a number ("1e9")');
throws("Infinity spelled out", () => C.decode("o1$a$b$120,500$880,160,44$p,1,2,3,Infinity"), 'not a number ("Infinity")');
throws("an orbit with four fields", () => C.decode("o1$a$b$120,500$880,160,44$p,1,2,3,4@1,2,3,4"), "orbit takes 5 fields, got 4");
throws("a name longer than the cap",
  () => C.decode(`o1$${"x".repeat(C.MAX_TEXT + 1)}$$120,500$880,160,44$`), `longer than ${C.MAX_TEXT} characters`);

// The two caps that exist because a link is somebody else's input: the solver
// walks every body on every one of up to 5,200 substeps, and a 24-body level
// is already the most anyone should hand a stranger's browser.
const oneBody = "p,500,330,52,58";
const over = `o1$a$b$120,500$880,160,44$${Array(C.MAX_BODIES + 1).fill(oneBody).join(";")}`;
throws(`${C.MAX_BODIES + 1} bodies`, () => C.decode(over), `${C.MAX_BODIES + 1} bodies, over the ${C.MAX_BODIES} limit`);
check(`${C.MAX_BODIES} bodies is accepted`,
  C.decode(`o1$a$b$120,500$880,160,44$${Array(C.MAX_BODIES).fill(oneBody).join(";")}`).bodies.length === C.MAX_BODIES);
throws("a code over the length cap",
  () => C.decode("o1$" + "x".repeat(C.MAX_CODE)), `over the ${C.MAX_CODE} limit`);

// Empty is a real body list, not a malformed one — "First Light" has no bodies.
check("no bodies at all decodes to an empty list",
  C.decode("o1$a$b$120,500$880,160,44$").bodies.length === 0);

// ============================================================
// 3. Text survives the delimiters
// ============================================================
// Name and subtitle are free text and the format is delimiter-separated, so
// the escaping is the only thing standing between a level called "a|b" and a
// code that reads as seven sections.
console.log("\n3. Names carry the delimiters without breaking the format");
for (const bad of ["a$b", "a|b", "a;b", "a,b", "100%", "#hash", "he said \"go\"", "émigré ☄", "a@b"]) {
  const lv = Object.assign(C.blank(), { name: bad, sub: bad });
  const back = C.decode(C.encode(lv));
  check(`a level called ${JSON.stringify(bad)}`, back.name === bad && back.sub === bad,
    `got name ${JSON.stringify(back.name)}`);
}

// ============================================================
// 4. Validate catches the levels nobody can play
// ============================================================
// Each case names the one problem it is about; the assertion is on the
// message, not on the count, so a level that trips two rules cannot pass this
// by tripping the wrong one.
console.log("\n4. Validate catches the unplayable ones");
const bend = f => { const lv = C.blank(); f(lv); return C.validate(lv); };
const says = (name, probs, want) =>
  check(name, probs.some(p => p.includes(want)), `got ${JSON.stringify(probs)}`);

says("a launch point off the field", bend(l => l.start.x = -40), "launch point is off the playfield");
says("a marker off the field", bend(l => l.goal.y = 900), "marker is off the playfield");
says("a marker the size of a dot", bend(l => l.goal.r = 4), "has to be between 20 and 120");
says("a marker swallowing the launch point", bend(l => { l.goal.x = 130; l.goal.y = 505; }),
  "won before it starts");
says("a launch point inside a planet", bend(l => { l.bodies[0].x = 125; l.bodies[0].y = 500; }),
  "every shot crashes on the first step");
says("a planet of impossible mass", bend(l => l.bodies[0].mass = 5000), "has to be between -400 and 400");
says("a planet the size of the field", bend(l => l.bodies[0].r = 400), "has to be between 8 and 120");
says("a lone wormhole mouth",
  bend(l => l.bodies.push({ type: "wormhole", x: 400, y: 200, r: 30, link: "a", exitTurn: 0 })),
  'link "a" has 1 mouth');
says("three mouths on one link", bend(l => {
  for (let i = 0; i < 3; i++) l.bodies.push({ type: "wormhole", x: 300 + i * 80, y: 200, r: 30, link: "a", exitTurn: 0 });
}), 'link "a" has 3 mouths');
says("a booster kicking harder than the field allows",
  bend(l => l.bodies.push({ type: "booster", x: 400, y: 200, r: 40, dir: 0, boost: 900 })),
  "has to be between 0 and 400");
says("an orbit wider than the sky", bend(l => l.bodies[0].orbit = { cx: 500, cy: 330, r: 900, speed: 1, a0: 0 }),
  "orbit radius is 900");

// A repulsor is not solid, so standing the probe on one is legal — the level
// is hard, not broken. This is the case the "inside a body" rule must NOT fire
// on, and without it that rule could be written as "inside anything".
check("a launch point inside a repulsor is allowed",
  bend(l => l.bodies.push({ type: "repulse", x: 120, y: 500, r: 40, mass: -48 })).length === 0,
  JSON.stringify(bend(l => l.bodies.push({ type: "repulse", x: 120, y: 500, r: 40, mass: -48 }))));

// A pair of mouths is the shape that works, so it validates clean.
check("two mouths on one link validate clean",
  bend(l => {
    l.bodies.push({ type: "wormhole", x: 300, y: 200, r: 30, link: "a", exitTurn: 0 });
    l.bodies.push({ type: "wormhole", x: 700, y: 200, r: 30, link: "a", exitTurn: 0 });
  }).length === 0);

// ============================================================
// 5. Encode refuses what decode could not read back
// ============================================================
console.log("\n5. Encode refuses what decode could not read back");
throws("a NaN coordinate", () => C.encode(Object.assign(C.blank(), { start: { x: NaN, y: 0 } })), "cannot encode NaN");
throws("an Infinite radius", () => C.encode(Object.assign(C.blank(), { goal: { x: 1, y: 1, r: Infinity } })), "cannot encode Infinity");
throws("a coordinate big enough to need an exponent",
  () => C.encode(Object.assign(C.blank(), { start: { x: 1e21, y: 0 } })), "formats as");
throws("a body type the format has no letter for",
  () => C.encode(Object.assign(C.blank(), { bodies: [{ type: "quasar", x: 1, y: 1, r: 10, mass: 1 }] })),
  'cannot encode body type "quasar"');

// ============================================================
// 6. The editor's verdict and CI's verdict are the same verdict
// ============================================================
// The Check button runs OrbitalPhysics.makeSearch at exactly the budget
// test/physics.mjs runs findWinningShot at, so a draft the editor calls
// winnable is one the suite would call winnable. What this pins is the other
// half: that a shot the search reports is a shot that actually wins, re-flown
// here rather than taken on the search's word.
console.log("\n6. A reported shot really wins, re-flown");
{
  const lv = C.decode(C.encode(LEVELS[1]));      // "The Curve": one well, fast to crack
  const shot = findWinningShot(lv);
  check("the search finds a shot for a decoded level", !!shot);
  if (shot) {
    const sp = shot.power * MAXSPEED;
    const r = solve(lv.start, { x: Math.cos(shot.angle) * sp, y: Math.sin(shot.angle) * sp }, lv);
    check("re-flying that shot reaches the marker", r.outcome === "WIN", `outcome=${r.outcome}`);
  }
  // An unreachable marker is the other side of it: walled in by a ring of
  // planets, no launch vector gets there, and the search has to say so rather
  // than run forever or report a shot that misses.
  const walled = C.blank();
  walled.goal = { x: 500, y: 330, r: 20 };
  walled.bodies = [];
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    walled.bodies.push({ type: "rock", x: 500 + Math.cos(a) * 70, y: 330 + Math.sin(a) * 70, r: 20, mass: 0 });
  }
  check("a walled-in marker validates clean (it is buildable, just not winnable)",
    C.validate(walled).length === 0, C.validate(walled).join(" "));
  // A tenth of the budget: what is being pinned here is that a search with no
  // answer ends and says null, not that this ring is unwinnable. The full
  // budget takes 5.8 s on this level and proves the same thing.
  check("the search reports no shot for a walled-in marker",
    findWinningShot(walled, { angleSteps: 72, powerSteps: 8, rounds: 12 }) === null);
}

// ============================================================
console.log(`\n${failures.length === 0 ? "ALL PASSED" : failures.length + " FAILED"}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
