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
  LAYOUT, buildLayout,
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

group('determinism');
{
  const a = buildLayout(), b = buildLayout();
  ok(JSON.stringify(a) === JSON.stringify(b),
    'two builds of the layout are byte-identical');
  ok(a.trees.length === LAYOUT.trees.length, 'and match the exported layout',
    `${a.trees.length} trees`);
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
