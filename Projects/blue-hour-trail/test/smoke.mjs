// node test/smoke.mjs
//
// Checks the half of the mountain that is arithmetic: the heightfield, the
// trail, the creek, and the layout of everything standing between the trees.
// Exits non-zero on any failure.
//
// It imports js/field.js and nothing else, deliberately. The rest of js/
// imports the bare specifier `three`, which only resolves through index.html's
// import map — Node refuses it outright, and that is the reason field.js
// exists as a separate file rather than living at the top of terrain.js.
//
// WHAT THIS CANNOT SEE, so you still open the page after touching this
// project: whether any of it is wired up, whether the meshes render, whether
// the fog breathes, whether the controls move anybody.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {
  groundHeight, BOUNDS, TRAIL, trailPoint, trailInfo, trailBlend,
  CREEK, creekX, creekInfo, creekWaterY, walkHeight, walkable, surfaceAt,
  LAYOUT, buildLayout, KEEPERS,
} = await import(pathToFileURL(path.join(HERE, '..', 'js', 'field.js')).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

/* ------------------------------------------------------------- heightfield -- */

group('the heightfield');

ok(groundHeight(0, 145) < 6, 'the trailhead sits low',
  `h(0,145) = ${groundHeight(0, 145).toFixed(2)}`);
ok(groundHeight(-5, -100) > 55, 'the summit stands high',
  `h(-5,-100) = ${groundHeight(-5, -100).toFixed(2)}`);

{
  const a = [groundHeight(12.5, -3.25), groundHeight(-88, 31), groundHeight(120, 140)];
  const b = [groundHeight(12.5, -3.25), groundHeight(-88, 31), groundHeight(120, 140)];
  ok(a.every((v, i) => v === b[i]), 'the same coordinates give the same height twice');
  ok(a.every(Number.isFinite), 'and they are finite numbers', a.map(v => v.toFixed(2)).join(', '));
}

{
  // No step in ground a walker is allowed on is a cliff. Cells the gradient
  // limit already forbids are exempt — a mountainside is allowed crags, the
  // walker just isn't allowed onto them.
  let worst = 0, at = null;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 2) {
    for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 2) {
      if (!walkable(x, z) || !walkable(x, z + 2)) continue;
      const d = Math.abs(groundHeight(x, z + 2) - groundHeight(x, z)) / 2;
      if (d > worst) { worst = d; at = [x, z]; }
    }
  }
  ok(worst < 1.2, 'no step between walkable cells is a cliff',
    `worst rise ${worst.toFixed(2)} m/m at ${at}`);
}

/* ------------------------------------------------------------------- trail -- */

group('the trail climbs the mountain');

{
  const pts = TRAIL.points;
  const first = pts[0], last = pts[pts.length - 1];
  ok(Math.hypot(first.x - 0, first.z - 145) < 2, 'it starts at the trailhead',
    `(${first.x.toFixed(1)}, ${first.z.toFixed(1)})`);
  ok(last.z < -95 && last.y > 58, 'and ends high on the summit ridge',
    `(${last.x.toFixed(1)}, ${last.z.toFixed(1)}) at y ${last.y.toFixed(1)}`);
  ok(TRAIL.length > 700 && TRAIL.length < 1100, 'the walk is a real hike, not a stroll',
    `${TRAIL.length.toFixed(0)} m of trail`);

  const zBacksteps = pts.filter((p, i) => i > 0 && p.z > pts[i - 1].z + 0.6);
  ok(zBacksteps.length === 0, 'every switchback still gains ground (z never doubles back)',
    zBacksteps.length ? `${zBacksteps.length} backsteps` : '');

  const inBounds = pts.every(p =>
    p.x > BOUNDS.minX + 4 && p.x < BOUNDS.maxX - 4 &&
    p.z > BOUNDS.minZ + 4 && p.z < BOUNDS.maxZ - 4);
  ok(inBounds, 'the whole centerline stays well inside the walkable bounds');

  let worstGrade = 0;
  for (let i = 1; i < pts.length; i++) {
    const ds = pts[i].s - pts[i - 1].s || 1;
    const g = Math.abs(pts[i].y - pts[i - 1].y) / ds;
    if (g > worstGrade) worstGrade = g;
  }
  ok(worstGrade < 0.14, 'the grade stays walkable the whole way up',
    `steepest ${(worstGrade * 100).toFixed(1)}%`);
}

{
  // The bench actually benches: the ground under the centerline is the trail's
  // own analytic height, and the shoulders stay close rather than shearing off.
  let worstCut = 0, worstShoulder = 0;
  const b = LAYOUT.bridge;
  for (let i = 0; i < TRAIL.points.length; i += 10) {
    const p = TRAIL.points[i];
    worstCut = Math.max(worstCut, Math.abs(groundHeight(p.x, p.z) - p.y - 0.03));
    // The creek is allowed to cut the bench — that gap is what the bridge is
    // for — so the shoulder claim skips the bridge's neighbourhood.
    if (Math.hypot(p.x - b.x, p.z - b.z) < 9) continue;
    const px = -p.dz, pz = p.dx;
    for (const side of [-1.2, 1.2]) {
      const d = Math.abs(groundHeight(p.x + px * side, p.z + pz * side) - p.y);
      worstShoulder = Math.max(worstShoulder, d);
    }
  }
  ok(worstCut < 0.1, 'the ground under the centerline is the trail',
    `worst gap ${worstCut.toFixed(3)} m`);
  ok(worstShoulder < 0.6, 'and the near shoulders hold the bench away from the creek',
    `worst ${worstShoulder.toFixed(2)} m`);

  const unwalkable = TRAIL.points.filter(p => !walkable(p.x, p.z));
  ok(unwalkable.length === 0, 'the whole centerline is walkable',
    unwalkable.length ? `first blocked at (${unwalkable[0].x.toFixed(1)}, ${unwalkable[0].z.toFixed(1)})` : '');

  ok(trailBlend(trailPoint(0.5).x, trailPoint(0.5).z) > 0.95, 'the blend reads 1 on the dirt');
  const p = trailPoint(0.5);
  ok(trailBlend(p.x + -p.dz * 12, p.z + p.dx * 12) < 0.05, 'and 0 out in the woods');
}

/* ------------------------------------------------------------------- creek -- */

group('the creek and the bridge');

{
  const b = LAYOUT.bridge;
  ok(Math.abs(b.x - creekX(b.z)) < 2.5, 'the bridge sits over the creek',
    `bridge x ${b.x.toFixed(1)}, creek x ${creekX(b.z).toFixed(1)} at z ${b.z.toFixed(1)}`);
  ok(trailInfo(b.x, b.z).dist < 1, 'and on the trail centerline');
  ok(b.z > CREEK.headZ && b.z < CREEK.endZ, 'inside the creek\'s run');

  const water = creekWaterY(b.z);
  ok(b.deckY - water > 0.25 && b.deckY - water < 1.2,
    'the deck clears the water without towering over it',
    `deck ${b.deckY.toFixed(2)}, water ${water.toFixed(2)}`);

  ok(surfaceAt(b.x, b.z) === 'bridge', 'standing mid-bridge reads as bridge');
  ok(walkHeight(b.x, b.z) >= b.deckY - 1e-9, 'and the walker stands on the deck, not in the creek');
  ok(walkable(b.x, b.z), 'the bridge is walkable');

  const mid = trailPoint(0.5);
  ok(surfaceAt(mid.x, mid.z) === 'trail', 'standing mid-trail reads as trail');
}

{
  // Downhill means downhill: the water at the head of the creek sits above
  // the water where it leaves the map.
  const top = creekWaterY(CREEK.headZ + 1), bottom = creekWaterY(CREEK.endZ - 1);
  ok(top > bottom, 'the creek runs downhill off the map',
    `head ${top.toFixed(2)}, mouth ${bottom.toFixed(2)}`);

  const w = LAYOUT.waterfall;
  ok(w.topY - w.baseY > 3, 'the waterfall has a real drop',
    `${(w.topY - w.baseY).toFixed(1)} m`);
}

/* ------------------------------------------------------------------ layout -- */

group('the layout');

{
  const t = LAYOUT.trees;
  ok(t.length > 3000, 'the mountainside is crammed with trees', `${t.length} of them`);
  const near = t.filter(x => x.tier === 'near');
  ok(near.length > 700 && near.length < 2200, 'the near tier fits the draw budget',
    `${near.length} full meshes, ${t.length - near.length} silhouettes`);
  ok(t.some(x => x.species === 'conifer') && t.some(x => x.species === 'birch'),
    'both species are present');

  const onTrail = t.filter(x => trailInfo(x.x, x.z).dist < 3.0);
  ok(onTrail.length === 0, 'no tree grows on the trail',
    onTrail.length ? `${onTrail.length} in the way` : '');
  const inCreek = t.filter(x => creekInfo(x.x, x.z).dist < 3.2);
  ok(inCreek.length === 0, 'or in the creek');
  const outside = t.filter(x =>
    x.x < BOUNDS.minX || x.x > BOUNDS.maxX || x.z < BOUNDS.minZ || x.z > BOUNDS.maxZ);
  ok(outside.length === 0, 'and none outside the bounds');
}

{
  const c = LAYOUT.cairns;
  ok(c.length === 7, 'seven cairns to find', `${c.length}`);
  ok(c.every(x => {
    const d = trailInfo(x.x, x.z).dist;
    return d > 3.5 && d < 16;
  }), 'each one off the path but findable',
    c.map(x => trailInfo(x.x, x.z).dist.toFixed(1)).join(', ') + ' m out');
  const ts = c.map(x => x.t);
  ok(ts.every((t, i) => i === 0 || t > ts[i - 1]), 'strung in order up the climb');
}

{
  const m = LAYOUT.markers;
  ok(m.length === 14, 'fourteen trail markers', `${m.length}`);
  ok(m.every(x => {
    const d = trailInfo(x.x, x.z).dist;
    return d > 1.5 && d < 3.5;
  }), 'each at the trail\'s elbow, not in the way');
  const gaps = m.slice(1).map((x, i) => x.t - m[i].t);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  ok(gaps.every(g => Math.abs(g - mean) < mean * 0.4), 'spaced evenly along the climb');
}

{
  ok(LAYOUT.mushrooms.length === 90, 'ninety mushroom clusters');
  ok(LAYOUT.mushrooms.some(m => m.glow), 'some of them pale enough to glow');
  ok(LAYOUT.shafts.length === 12 && LAYOUT.perches.length === 40 && LAYOUT.clearings.length === 12,
    'light shafts, perches and clearings are all populated');
  ok(LAYOUT.perches.every(p => p.h > 2), 'perches sit up in the canopy');
}

{
  // The summit furniture. Not a payoff any more — the walk ends in the fog, and
  // the bench is somewhere to sit in it while the lookout watches you do it.
  const end = trailPoint(1);
  const d = Math.hypot(LAYOUT.bench.x - end.x, LAYOUT.bench.z - end.z);
  ok(d < 6, 'the bench waits at the top of the trail', `${d.toFixed(1)} m from the end`);
  ok(groundHeight(LAYOUT.bench.x, LAYOUT.bench.z) > 55, 'high on the mountain',
    `${groundHeight(LAYOUT.bench.x, LAYOUT.bench.z).toFixed(1)} m`);

  // The tower has to be far enough from the bench that the figure on it is not
  // straight overhead, and close enough to be unmistakably the thing you
  // climbed to. dread.js stops showing it below 6.5 m and past 70 m — if the
  // furniture ever moves, this is the check that catches a figure nobody can
  // see from the one place the walk actually ends.
  const td = Math.hypot(LAYOUT.tower.x - LAYOUT.bench.x, LAYOUT.tower.z - LAYOUT.bench.z);
  ok(td > 6.5 && td < 70, 'the lookout stands in the figure\'s readable band from the bench',
    `${td.toFixed(1)} m`);
}

group('the keepers');
{
  // Grant 2, session 4: the cairns carry keepers' names, and the roster is one
  // name longer than the cairn count. That gap is the whole story and this is
  // the check that keeps it countable: eight names, seven cairns, exactly one
  // keeper with entries in the log and no cairn on the mountain. Nothing in
  // the piece ever says so — only a player who counts will know, and only
  // this test makes sure the count stays worth making.
  ok(KEEPERS.length === 8, 'eight keepers on the roster', KEEPERS.join(', '));
  ok(new Set(KEEPERS).size === 8, 'no two share a name');
  ok(LAYOUT.cairns.length === 7 && LAYOUT.cairns.every(c => KEEPERS.includes(c.keeper)),
    'every cairn is a keeper\'s cairn');
  ok(new Set(LAYOUT.cairns.map(c => c.keeper)).size === 7, 'no keeper built two');
  const uncairned = KEEPERS.filter(k => !LAYOUT.cairns.some(c => c.keeper === k));
  ok(uncairned.length === 1, 'exactly one keeper has no cairn', uncairned.join(', '));
  ok(LAYOUT.pages.some(p => p.keeper === uncairned[0]),
    'and that keeper\'s entries are in the log all the same');
}

group('the logbook');
{
  const pg = LAYOUT.pages;
  ok(pg.length === 10, 'ten pages scattered on the mountain', `${pg.length}`);
  ok(KEEPERS.every(k => pg.some(p => p.keeper === k)),
    'every keeper is heard from at least once');
  ok(pg.every(p => p.entries.length >= 1 && p.entries.every(e => e.date && e.body.length > 20)),
    'every page carries dated, written entries');
  ok(pg.every(p => walkable(p.x, p.z)), 'every page lies where a walker can stand',
    pg.map(p => walkable(p.x, p.z) ? '' : p.id).join(''));

  const onTrail = pg.filter(p => trailInfo(p.x, p.z).dist < 3.5);
  const nearCabin = pg.filter(p => Math.hypot(p.x - LAYOUT.cabin.x, p.z - LAYOUT.cabin.z) < 8);
  const nearTop = pg.filter(p =>
    Math.hypot(p.x - LAYOUT.tower.x, p.z - LAYOUT.tower.z) < 20 ||
    Math.hypot(p.x - LAYOUT.bench.x, p.z - LAYOUT.bench.z) < 20);
  ok(onTrail.length >= 3 && nearCabin.length >= 3 && nearTop.length >= 3,
    'a few on the trail, the rest at the cabin and the summit',
    `${onTrail.length} trail, ${nearCabin.length} cabin, ${nearTop.length} summit`);

  // The doctrine, held to the letter where a test can hold it: no entry may
  // mention the figure, and the log never speaks in the game's voice. (No
  // entry confirming danger or safety is editorial and stays a human's job.)
  const all = pg.flatMap(p => p.entries.map(e => e.body)).join(' ');
  ok(!/figure|monster|ghost|haunt|spirit|creature|watcher/i.test(all),
    'no entry mentions the figure, by any name');
  ok(!/\b(press|click|hold|player|found|unlock|collect)\b/i.test(all),
    'and the log never speaks in the game\'s voice');

  // Kessler's arc is the heart of the writing brief: the circling entries sit
  // mid-roster and there are more of them than anyone else's, in order.
  const mid = KEEPERS[4];
  const midPages = pg.filter(p => p.keeper === mid);
  ok(midPages.length >= 3, `${mid} carries the middle of the log`, `${midPages.length} pages`);
  ok(midPages.every((p, i) => i === 0 || p.id > midPages[i - 1].id),
    'and those pages read in order along the id sequence');
}

group('the bootprints');
{
  // Ladder item 4, session 4: one set of prints on the last switchback,
  // already there, ascending only. They start partway up the final climb and
  // stop short of the top; no set ever comes back down. props.js fog-gates
  // the rendering; this group pins the arithmetic.
  const bp = LAYOUT.bootprints;
  ok(bp.length > 55 && bp.length < 85, 'one climb\'s worth of prints', `${bp.length}`);
  ok(bp.every(p => p.t >= 0.9 && p.t < 0.965), 'all on the last switchback, stopping short of the top',
    `t ${bp[0].t.toFixed(3)} to ${bp[bp.length - 1].t.toFixed(3)}`);
  ok(bp.every((p, i) => i === 0 || p.t > bp[i - 1].t), 'ascending only — the t sequence never doubles back');
  ok(bp.every(p => trailInfo(p.x, p.z).dist < 1.0), 'every print is on the trail itself',
    `worst ${Math.max(...bp.map(p => trailInfo(p.x, p.z).dist)).toFixed(2)} m out`);
  ok(bp.every((p, i) => i === 0 || p.foot !== bp[i - 1].foot), 'left, right, left — a walker, not a stamp');
  const toeUp = bp.every(p => {
    const tp = trailPoint(p.t);
    const uphillYaw = Math.atan2(tp.dx, tp.dz);
    let d = p.yaw - uphillYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) < 0.25;
  });
  ok(toeUp, 'and every toe points up the mountain');
}

group('determinism');
{
  const a = buildLayout(), b = buildLayout();
  ok(JSON.stringify(a) === JSON.stringify(b),
    'two builds of the layout are byte-identical');
  ok(a.trees.length === LAYOUT.trees.length, 'and match the exported layout',
    `${a.trees.length} trees`);
}

/* ------------------------------------------------------------------- music -- */

// audio.js touches window only inside init(), so Node can import the motif
// engine's pure half and hold every phrase it will ever play to the scale.
group('the phantom steps only ever descend');
{
  // Ladder item 1, session 4: the steps that are not yours are on their way
  // DOWN the mountain — pitch and tone fall step over step, no exceptions,
  // whatever rhythm they play in. This is the eight-keepers story told with
  // no words at all, and this group keeps any future tuning from accidentally
  // making the mountain's one direction ambiguous.
  const { phantomStepPlan } = await import(
    pathToFileURL(path.join(HERE, '..', 'js', 'audio.js')).href);
  const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  let ordered = true, falling = true, dulling = true, fading = true;
  for (let seed = 1; seed <= 200; seed++) {
    for (const count of [2, 3, 4]) {
      const plan = phantomStepPlan(lcg(seed), { count });
      for (let i = 1; i < plan.length; i++) {
        if (plan[i].at <= plan[i - 1].at) ordered = false;
        if (plan[i].rate >= plan[i - 1].rate) falling = false;
        if (plan[i].cutoff >= plan[i - 1].cutoff) dulling = false;
        if (plan[i].gain >= plan[i - 1].gain) fading = false;
      }
    }
  }
  ok(ordered, 'the steps land in order');
  ok(falling, 'every step is lower than the last');
  ok(dulling, 'and duller');
  ok(fading, 'and a little further away');

  // The ghost's door: a supplied rhythm is honoured (clamped to a walkable
  // gait), and the descent survives whoever's rhythm it is.
  const ghost = phantomStepPlan(lcg(7), { count: 4, intervals: [0.45, 0.8, 2.5] });
  const gaps = ghost.slice(1).map((s, i) => s.at - ghost[i].at);
  ok(Math.abs(gaps[0] - 0.45) < 1e-9 && Math.abs(gaps[1] - 0.8) < 1e-9 && Math.abs(gaps[2] - 1.2) < 1e-9,
    'a recorded rhythm is replayed, clamped to a believable gait',
    gaps.map(g => g.toFixed(2)).join(', '));
  ok(ghost.every((s, i) => i === 0 || s.rate < ghost[i - 1].rate),
    'and it still descends in somebody else\'s rhythm');
}

group('the mountain remembers your last walk');
{
  // Grant 3, session 4: one project-local localStorage record of the previous
  // walk's footstep rhythm, fed to the phantom steps on the next visit. Not a
  // save — the prompt file's amendment is the authority. This group holds the
  // pure half under a stub storage: what gets remembered, what gets refused,
  // and what a corrupt memory degrades to.
  const { createGhost, encodeWalk, decodeWalk, rhythmNear, GHOST_KEY } = await import(
    pathToFileURL(path.join(HERE, '..', 'js', 'ghost.js')).href);

  const stub = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
  };

  // A believable recorded climb: 200 steps, 0.5-0.7 s apart, trailhead to top.
  const climb = Array.from({ length: 200 }, (_, i) => [i / 200, 0.5 + (i % 5) * 0.05]);
  ok(decodeWalk(encodeWalk(climb)).length === 200, 'a walk survives the round trip');
  ok(decodeWalk('{"v":1,"steps":"no"}') === null && decodeWalk('garbage') === null
    && decodeWalk(null) === null, 'a corrupt memory is quietly nobody');
  ok(decodeWalk(encodeWalk(climb.slice(0, 10))) === null,
    'ten steps is a door opened and closed, not a walk');

  const r = rhythmNear(climb, 0.5);
  ok(r && r.length === 3 && r.every(dt => dt > 0.4 && dt < 0.8),
    'the rhythm near mid-trail is the gait recorded there', r && r.map(x => x.toFixed(2)).join(', '));
  ok(rhythmNear(climb.slice(0, 20), 0.9) === null,
    'and nothing recorded near here means no rhythm, not an invented one');

  // The live loop: record a walk, save it, and find it waiting next visit.
  const store = stub();
  const g1 = createGhost(store);
  ok(g1.loaded === false, 'the first walk has no ghost');
  ok(g1.save() === false, 'and an empty walk refuses to become one');
  let now = 0;
  for (let i = 0; i < 120; i++) { g1.step(i / 120, now); now += 0.55 + (i % 3) * 0.04; }
  ok(g1.walked() === 119, 'footsteps are recorded as gaps between steps', `${g1.walked()}`);
  ok(g1.save() === true, 'a real walk is worth remembering');

  const g2 = createGhost(store);
  ok(g2.loaded && g2.count === 119, 'the next visit finds the previous walker', `${g2.count} steps`);
  const gr = g2.rhythmNear(0.4);
  ok(gr && gr.every(dt => dt > 0.5 && dt < 0.7), 'walking in their rhythm', gr && gr.map(x => x.toFixed(2)).join(', '));

  // Standing still is not walking: long gaps never enter the record.
  const g3 = createGhost(stub());
  g3.step(0.1, 0); g3.step(0.1, 8); g3.step(0.11, 8.6);
  ok(g3.walked() === 1, 'the ghost keeps the gait, not the sightseeing');

  ok(GHOST_KEY === 'blue-hour-last-walk', 'the key is project-local — gvb-save.js stays untouched');
}

group('the motif engine writes only woe');
{
  const { motifPhrase } = await import(
    pathToFileURL(path.join(HERE, '..', 'js', 'audio.js')).href);

  // A little LCG so a failure names a reproducible seed, not a mood.
  const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  const LOW = [146.83, 164.81, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66, 110.0];
  const HIGH = [146.83, 155.56, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66, 110.0];

  let lengths = true, endings = true, inLow = true, inHigh = true;
  let sawFlatTwo = false, sawNaturalTwoHigh = false;
  for (let seed = 1; seed <= 400; seed++) {
    const low = motifPhrase(lcg(seed), 0);
    const high = motifPhrase(lcg(seed), 1);
    for (const [phrase, scale, isHigh] of [[low, LOW, false], [high, HIGH, true]]) {
      if (phrase.length < 3 || phrase.length > 5) lengths = false;
      const last = phrase[phrase.length - 1].freq;
      if (last !== 146.83 && last !== 110.0) endings = false;
      const off = phrase.some(n => !scale.includes(n.freq));
      if (isHigh) {
        if (off) inHigh = false;
        if (phrase.some(n => n.freq === 155.56)) sawFlatTwo = true;
        if (phrase.some(n => n.freq === 164.81)) sawNaturalTwoHigh = true;
      } else if (off) inLow = false;
    }
  }
  ok(lengths, 'every phrase is 3 to 5 notes');
  ok(endings, 'and every one of them falls home to D3 or A2');
  ok(inLow, 'low phrases stay in D aeolian');
  ok(inHigh && !sawNaturalTwoHigh, 'high phrases stay in D phrygian — no E natural above the fog line');
  ok(sawFlatTwo, 'and the flat second actually gets used up there');
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
