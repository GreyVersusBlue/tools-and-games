/* ============================================================
   Orbital — level generator. Proposes a sector from a seed, then
   lets the two judges that already exist say whether it is one:
   OrbitalCode.validate for "is this a level at all", and a census
   of launches flown through OrbitalPhysics.solve for "is it worth
   playing". Pure module: no DOM. Attaches to globalThis so it loads
   in index.html as a plain script and under Node for test/generator.mjs.

   THE GENERATOR PROPOSES; IT DOES NOT DECIDE. Every candidate goes
   through validate() and then through the census, and a candidate
   that fails either is thrown away and the seed's stream rolls on.
   The tiers below are recipes (how many bodies, of which types),
   not difficulty claims — the census is what holds a level to a
   band, and what the band measures is written next to it.

   Seeds are deterministic: the same tier and seed produce the same
   level on every machine, which is what makes a generated level
   testable in Node and reproducible from its name.
   ============================================================ */
;(function (g) {
  "use strict";

  const PH = g.OrbitalPhysics, C = g.OrbitalCode;
  const W = C.W, H = C.H;

  // ---- seeded random -----------------------------------------------------
  // mulberry32: 32-bit state, good enough spread, and small enough to read.
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
    next.pick = list => list[Math.floor(next() * list.length)];
    return next;
  }

  // ---- the census --------------------------------------------------------
  // A grid of launches, every one flown with solve(). Three numbers come out:
  //   wins    — how many reach the marker. Divided by total this is how
  //             FORGIVING the level is, not how hard: in an empty field it is
  //             exactly the marker's angular size from the launch point, and
  //             the 22 shipped levels measure 0.75% to 12.7% with no relation
  //             to their order in the packs.
  //   anyway  — how many of those wins ALSO win with every body removed. A
  //             level where most of the winning launches would win anyway is
  //             one whose bodies are decoration; 15 of the 22 shipped levels
  //             score 0 here, and the two that fail the judge below are First
  //             Light (no bodies at all, 18 of 18) and The Long Way (9 of 9:
  //             every winning shot skips both portals).
  //   total   — the grid size.
  // The grid is every second angle and every second power of the search in
  // physics.js (240 x 20 -> 120 x 10), so each cell here IS a cell there and
  // a census win is a win findWinningShot's grid pass reaches, by construction
  // rather than by a second implementation of the verdict (#399).
  const CENSUS = { angleDiv: 2, powerDiv: 2 };
  function censusGrid() {
    const S = PH.SEARCH;
    return { angles: S.angleSteps / CENSUS.angleDiv, powers: S.powerSteps / CENSUS.powerDiv };
  }

  // Stepped, like makeSearch: step(budget) flies at most `budget` launches and
  // returns { done, result }. Sync callers loop it; the sector map slices it.
  function makeCensus(level) {
    const { angles, powers } = censusGrid();
    const total = angles * powers;
    const empty = Object.assign({}, level, { bodies: [] });
    let ai = 0, pi = 1, wins = 0, anyway = 0, flown = 0, first = null;
    function fly(lv, angle, power) {
      const sp = power * PH.MAXSPEED;
      return PH.solve(lv.start, { x: Math.cos(angle) * sp, y: Math.sin(angle) * sp }, lv).outcome;
    }
    function step(budget) {
      for (let n = 0; n < (budget || 1) && ai < angles; n++) {
        const angle = (ai / angles) * Math.PI * 2, power = pi / powers;
        if (fly(level, angle, power) === "WIN") {
          wins++;
          if (!first) first = { angle, power };
          if (fly(empty, angle, power) === "WIN") anyway++;
        }
        flown++;
        if (++pi > powers) { pi = 1; ai++; }
      }
      const done = ai >= angles;
      return { done, progress: flown / total, result: done ? { wins, anyway, total, first } : null };
    }
    return { step };
  }
  function census(level) {
    const c = makeCensus(level);
    for (;;) { const r = c.step(512); if (r.done) return r.result; }
  }

  // ---- the judge ---------------------------------------------------------
  // Bands on the census, per tier. `win` is [min, max] as a fraction of the
  // grid: below it the level is a needle, above it a barn door. `anyway` is
  // the largest share of the wins that may also win in an empty field. The
  // one shipped level over 8% is First Portal at 12.7%, the loosest thing in
  // either pack; the tightest is The Long Way at 0.75%. Tiers narrow the top
  // rather than the bottom because a tight window is what makes a level
  // read as hard, and the recipe already adds the bodies.
  const TIERS = {
    easy: {
      label: "Easy", bodies: [1, 2],
      types: ["planet", "planet", "star", "rock", "repulse"],
      orbit: 0, win: [0.010, 0.080], anyway: 1 / 3
    },
    medium: {
      label: "Medium", bodies: [2, 4],
      types: ["planet", "planet", "star", "rock", "repulse", "blackhole", "booster"],
      orbit: 0.3, win: [0.008, 0.050], anyway: 1 / 3
    },
    hard: {
      label: "Hard", bodies: [3, 5],
      types: ["planet", "star", "rock", "repulse", "blackhole", "blackhole", "booster", "wormhole"],
      orbit: 0.4, win: [0.005, 0.030], anyway: 1 / 3
    }
  };

  // null when the level is accepted, else one word naming why not. The words
  // are the report's histogram keys, so the test and the status line agree.
  function judge(level, cen, tier) {
    const t = TIERS[tier] || TIERS.medium;
    if (C.validate(level).length) return "invalid";
    if (cen.wins === 0) return "unwinnable";
    const f = cen.wins / cen.total;
    if (f < t.win[0]) return "needle";
    if (f > t.win[1]) return "loose";
    if (cen.anyway > cen.wins * t.anyway) return "decoration";
    return null;
  }

  // ---- proposing ---------------------------------------------------------
  // Left to right or right to left, the launch point in one side band and the
  // marker in the other, the bodies in the lane between. Nothing here is a
  // rule about playability — that is the judge's — but a body sitting on the
  // launch point or two bodies inside each other are wasted candidates, so
  // the placer refuses those itself and tries again.
  const MAX_PLACE = 40;

  function nearest(list, x, y) {
    let best = Infinity;
    for (const b of list) { const d = Math.hypot(b.x - x, b.y - y) - b.r; if (d < best) best = d; }
    return best;
  }

  function place(level, type, rand) {
    const d = C.DEFAULTS[type];
    const scale = rand.range(0.8, 1.2);
    const b = { type, x: 0, y: 0, r: Math.round(d.r * scale) };
    if (type === "wormhole") { b.link = "a"; b.exitTurn = rand.pick([0, 0, 0.6, -0.6, 1.2, -1.2]); }
    else if (type === "booster") { b.dir = 0; b.boost = Math.round(rand.range(150, 230)); }
    else b.mass = Math.round(d.mass * scale * scale);   // a bigger planet is a heavier one
    for (let i = 0; i < MAX_PLACE; i++) {
      b.x = Math.round(rand.range(230, W - 230)); b.y = Math.round(rand.range(90, H - 90));
      const clearStart = Math.hypot(b.x - level.start.x, b.y - level.start.y) - b.r;
      const clearGoal = Math.hypot(b.x - level.goal.x, b.y - level.goal.y) - b.r - level.goal.r;
      if (clearStart < 90 || clearGoal < 50) continue;
      if (nearest(level.bodies, b.x, b.y) < b.r + 40) continue;
      if (type === "booster") {
        // pointed somewhere near the marker, never straight at it
        const at = Math.atan2(level.goal.y - b.y, level.goal.x - b.x);
        b.dir = Math.round((at + rand.pick([-1, 1]) * rand.range(0.35, 1.1)) * 100) / 100;
      }
      level.bodies.push(b);
      return b;
    }
    return null;
  }

  function orbit(b, rand) {
    // Circle the body around a centre so that at t = 0 it sits where it was
    // placed — the same pose rule the editor's Orbiting toggle uses — and
    // the sweep stays on the field.
    const r = rand.int(110, 200), a0 = Math.round(rand.range(-Math.PI, Math.PI) * 100) / 100;
    const cx = Math.round(b.x - Math.cos(a0) * r), cy = Math.round(b.y - Math.sin(a0) * r);
    if (cx - r < 40 || cx + r > W - 40 || cy - r < 40 || cy + r > H - 40) return;
    b.orbit = { cx, cy, r, speed: rand.pick([-1, 1]) * Math.round(rand.range(0.6, 1.3) * 100) / 100, a0 };
    b.x = cx + Math.cos(a0) * r; b.y = cy + Math.sin(a0) * r;
  }

  const WORDS = { planet: "planet", star: "star", rock: "asteroid", repulse: "repulsor",
                  blackhole: "black hole", wormhole: "wormhole", booster: "booster" };
  const COUNT = ["no", "", "two", "three", "four", "five", "six"];
  function describe(bodies) {
    const n = {};
    for (const b of bodies) n[b.type] = (n[b.type] || 0) + 1;
    const parts = Object.keys(n).map(t => n[t] === 1
      ? `${/^[aeiou]/.test(WORDS[t]) ? "an" : "a"} ${WORDS[t]}`
      : `${COUNT[n[t]] || n[t]} ${WORDS[t]}s`);
    if (parts.length < 2) return parts[0] || "an empty field";
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }

  function propose(tier, rand, seedName) {
    const t = TIERS[tier] || TIERS.medium;
    const flip = rand() < 0.5;
    const start = { x: rand.int(90, 160), y: rand.int(100, H - 100) };
    const goal = { x: rand.int(W - 160, W - 90), y: rand.int(100, H - 100), r: rand.int(38, 48) };
    if (flip) { const s = start.x; start.x = goal.x; goal.x = s; }
    const level = { name: seedName, sub: "", start, goal, bodies: [] };
    let want = rand.int(t.bodies[0], t.bodies[1]);
    while (level.bodies.length < want) {
      const type = rand.pick(t.types);
      if (type === "wormhole") {
        if (level.bodies.some(b => b.type === "wormhole") || level.bodies.length + 2 > want) continue;
        const a = place(level, "wormhole", rand); if (!a) break;
        const b = place(level, "wormhole", rand); if (!b) { level.bodies.pop(); break; }
        continue;
      }
      const b = place(level, type, rand);
      if (!b) break;
      if (C.GRAVITY[type] && rand() < t.orbit) orbit(b, rand);
    }
    // The codec caps a subtitle at 48 characters; "one black hole, two
    // asteroids, one repulsor and two wormholes" is 61, so a long roster
    // falls back to its count.
    const sub = describe(level.bodies);
    level.sub = sub.length <= C.MAX_TEXT ? sub : `${level.bodies.length} bodies`;
    return level;
  }

  // ---- the generator -----------------------------------------------------
  // step(budget) spends at most `budget` launches and returns
  // { done, level, progress, tried, report }. `level` is null until a candidate
  // is accepted, and stays null if `candidates` are spent — a recipe that
  // cannot make a level in that many tries is broken, and the test says so.
  const seedName = seed => "Sector " + (seed >>> 0).toString(36).toUpperCase();

  function makeGenerator(tier, seed, opts) {
    const o = Object.assign({ candidates: 40 }, opts || {});
    const rand = rng(seed);
    const name = seedName(seed);
    const report = { invalid: 0, unwinnable: 0, needle: 0, loose: 0, decoration: 0 };
    let tried = 0, cand = null, cen = null, level = null, done = false, part = 0;

    function step(budget) {
      let left = budget || 1;
      while (left > 0 && !done) {
        if (!cand) {
          if (tried >= o.candidates) { done = true; break; }
          cand = propose(tier, rand, name); tried++;
          if (C.validate(cand).length) { report.invalid++; cand = null; continue; }
          cen = makeCensus(cand);
        }
        const r = cen.step(left);
        left = 0;                                   // one slice per call, whatever it flew
        part = r.progress;
        if (!r.done) break;
        const why = judge(cand, r.result, tier);
        if (why) { report[why]++; cand = null; cen = null; part = 0; }
        else { level = C.clean(cand); level.census = r.result; done = true; }
      }
      // Progress is candidates spent plus how far through the current census,
      // over the cap — it can only ever be a guess at where the accepted one is.
      const spent = tried - (cand ? 1 : 0) + part;
      return { done, level, progress: done ? 1 : Math.min(1, spent / o.candidates), tried, report };
    }
    return { step, get tried() { return tried; }, get report() { return report; } };
  }

  // The whole thing in one call. Returns the level or null.
  function generate(tier, seed, opts) {
    const gen = makeGenerator(tier, seed, opts);
    for (;;) { const r = gen.step(512); if (r.done) return r.level; }
  }

  g.OrbitalGen = { TIERS, CENSUS, rng, seedName, censusGrid, makeCensus, census, judge,
                   propose, describe, makeGenerator, generate };
})(typeof globalThis !== "undefined" ? globalThis : this);
