// node test/smoke.mjs
//
// Checks the half of the beach that is arithmetic: the heightfield, and the
// layout of everything standing on it. Exits non-zero on any failure.
//
// It imports js/field.js and nothing else, deliberately. The rest of js/ imports
// the bare specifier `three`, which only resolves through index.html's import
// map — Node refuses it outright, and that is the reason field.js exists as a
// separate file rather than living at the top of terrain.js.
//
// WHAT THIS CANNOT SEE, so you still run `npm run games` after touching this
// project: whether any of it is wired up, whether the meshes render, whether the
// textures load, whether the controls move anybody. Same argument play-games.mjs
// makes about the other five Node suites in this repo.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Absolute paths on Windows start with a drive letter, which Node reads as the
// URL scheme `c:` and rejects (v7 §7). Same fix Faire Weekend's suite needed.
const { groundHeight, BOUNDS, LAYOUT, wadeLimitZ } =
  await import(pathToFileURL(path.join(HERE, '..', 'js', 'field.js')).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
};
const group = name => console.log(`\n${name}`);

/* ------------------------------------------------------------- heightfield -- */

group('the heightfield');

ok(Math.abs(groundHeight(0, -6)) < 1e-9, 'sea level meets the beach at z = -6',
  `h = ${groundHeight(0, -6)}`);
ok(groundHeight(0, -40) < -3, 'the sea floor drops away offshore',
  `h(0,-40) = ${groundHeight(0, -40).toFixed(2)}`);
ok(groundHeight(0, 40) > 3, 'the dunes rise inland',
  `h(0,40) = ${groundHeight(0, 40).toFixed(2)}`);

{
  // Monotonic enough to walk: no cliff the walker can fall off, anywhere.
  let worst = 0, at = null;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 2) {
    for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 1) {
      const d = Math.abs(groundHeight(x, z + 1) - groundHeight(x, z));
      if (d > worst) { worst = d; at = [x, z]; }
    }
  }
  ok(worst < 1.2, 'no step in the walkable ground is a cliff',
    `worst rise ${worst.toFixed(2)} m/m at ${at}`);
}

{
  // Determinism: this is what lets the layout below mean anything.
  const a = [groundHeight(12.5, -3.25), groundHeight(-88, 31), groundHeight(140, 46)];
  const b = [groundHeight(12.5, -3.25), groundHeight(-88, 31), groundHeight(140, 46)];
  ok(a.every((v, i) => v === b[i]), 'the same coordinates give the same height twice');
  ok(a.every(Number.isFinite), 'and the corners are finite numbers', a.map(v => v.toFixed(2)).join(', '));
}

group('wading');
{
  // ocean.js's water surface breathes between roughly -0.19 and 0.13 over the
  // swash cycle (level 0.06 + s*0.32, minus 0.25). The wading limit should
  // track it: a calmer trough lets a walker get closer to shore before hitting
  // knee depth than a run-up crest does, not the other way round.
  const trough = wadeLimitZ(-0.19), crest = wadeLimitZ(0.13);
  ok(trough < crest, 'the limit moves seaward when the water is higher',
    `trough ${trough.toFixed(2)}, crest ${crest.toFixed(2)}`);

  // The point it solves for actually is knee depth, on the slope the walker is
  // standing on when they hit the limit.
  for (const waterLevel of [-0.19, 0, 0.13]) {
    const z = wadeLimitZ(waterLevel, 0.45);
    const depth = waterLevel - groundHeight(0, z);
    ok(Math.abs(depth - 0.45) < 1e-6, `depth at the limit is 0.45 m (waterLevel ${waterLevel})`,
      `z = ${z.toFixed(2)}, depth = ${depth.toFixed(3)}`);
  }

  // However the tide breathes, the real limit has to be tighter than the old
  // static wall at BOUNDS.minZ, -60 — that wall is what let a walker reach eye
  // height 3.8 m underwater in the first place.
  ok(wadeLimitZ(-0.19) > BOUNDS.minZ && wadeLimitZ(0.13) > BOUNDS.minZ,
    'the wading limit is well short of the old -60 wall');
}

/* -------------------------------------------------------------- the layout -- */

group('the layout');

const all = [
  ...LAYOUT.groyne.map(p => ({ kind: 'groyne', ...p })),
  ...LAYOUT.driftwood.map(p => ({ kind: 'driftwood', ...p })),
  ...LAYOUT.rocks.map(p => ({ kind: 'rocks', ...p })),
  ...LAYOUT.wrack.map(p => ({ kind: 'wrack', ...p })),
];

ok(all.length > 450, 'there is something on the beach', `${all.length} placed objects`);
ok(LAYOUT.groyne.length >= 12 && LAYOUT.driftwood.length >= 3 && LAYOUT.rocks.length >= 6,
  'all four kinds are populated',
  `${LAYOUT.groyne.length} posts, ${LAYOUT.driftwood.length} logs, ` +
  `${LAYOUT.rocks.length} rocks, ${LAYOUT.wrack.length} wrack`);

{
  const off = all.filter(p =>
    p.x < BOUNDS.minX - 2 || p.x > BOUNDS.maxX + 2 ||
    p.z < BOUNDS.minZ - 2 || p.z > BOUNDS.maxZ + 2);
  ok(off.length === 0, 'nothing is placed outside the ground the walker can reach',
    off.length ? `${off.length} stray, first ${off[0].kind} at ${off[0].x.toFixed(1)},${off[0].z.toFixed(1)}` : '');
}

{
  const bad = all.filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.z));
  ok(bad.length === 0, 'every placement is a real coordinate');
}

group('the groyne walks into the sea');
{
  const g = LAYOUT.groyne;
  ok(g.every(p => p.top > p.base), 'no post is inside out');
  ok(g.every(p => p.base < groundHeight(p.x, p.z) - 0.5),
    'every post is sunk into the sand, not resting on it');
  const first = g[0], last = g[g.length - 1];
  ok(first.z > last.z, 'the row runs seaward', `z ${first.z.toFixed(1)} to ${last.z.toFixed(1)}`);

  // Measured against SEA LEVEL, not against the ground under each post. The
  // version of this check that measured off the local ground reported "tops
  // descend from head height to awash, 2.50 m down to 0.03 m" and passed, while
  // the far six posts sat entirely underwater — the seabed was falling faster
  // than the posts were shortening. Height above the water is the thing a player
  // can see, so it is the thing to assert.
  ok(first.top > 2.5, 'the landward end stands above head height',
    `top y = ${first.top.toFixed(2)}`);
  ok(last.top < 0.1 && last.top > -0.9, 'the seaward end finishes just under the water',
    `top y = ${last.top.toFixed(2)}`);

  const proud = g.filter(p => p.top > 0.15);
  ok(proud.length >= 8 && proud.length < g.length,
    'most of the row is visible above the water and the tail of it is not',
    `${proud.length} of ${g.length} posts break the surface`);

  const descends = g.every((p, i) => i === 0 || p.top < g[i - 1].top + 0.25);
  ok(descends, 'and they get shorter the further out they go, with no post taller than the last');
}

group('the wrack line sits on the tide mark');
{
  // The swash reaches z ≈ -3.6 at its highest (ocean.js: zLine = level/0.055 - 6
  // with level topping out near 0.13). Wrack below that gets washed away; wrack
  // far above it is litter on dry sand.
  const zs = LAYOUT.wrack.map(w => w.z);
  const lo = Math.min(...zs), hi = Math.max(...zs);
  ok(lo > -8 && hi < 4, 'the whole line is within a few metres of the waterline',
    `z ${lo.toFixed(1)} to ${hi.toFixed(1)}`);

  const xs = LAYOUT.wrack.map(w => w.x);
  ok(Math.min(...xs) < -120 && Math.max(...xs) > 120,
    'and it runs the full width of the beach',
    `x ${Math.min(...xs).toFixed(0)} to ${Math.max(...xs).toFixed(0)}`);

  const kinds = new Set(LAYOUT.wrack.map(w => w.kind));
  ok(kinds.size === 3, 'shells, pebbles and weed are all represented', [...kinds].join(', '));
  ok(LAYOUT.wrack.every(w => w.s > 0.02 && w.s < 0.4), 'nothing in it is the size of a car');
}

group('the rocks are half in the water');
{
  const r = LAYOUT.rocks;
  ok(r.every(b => b.sink > 0 && b.sink < b.r), 'every boulder is bedded, none is buried');

  // The first version of this check asked how many boulders were *submerged*,
  // answered "11 of 11", and passed — the whole cluster was under the surface and
  // the check was congratulating it. What matters is that some stand clear.
  // `flat` comes from the layout so this formula and buildRocks cannot disagree.
  const topY = b => groundHeight(b.x, b.z) - b.sink + b.r * b.flat;
  const proud = r.filter(b => topY(b) > 0.25);
  ok(proud.length >= 4, 'several boulders stand clear of the water',
    `${proud.length} of ${r.length}, tallest ${Math.max(...r.map(topY)).toFixed(2)} m above sea level`);
  ok(r.some(b => topY(b) < 0.25), 'and at least one is awash, so the cluster meets the sea');
  ok(r.every(b => groundHeight(b.x, b.z) < 0.6),
    'the whole cluster is below the dry-sand line, not sitting up the beach');
}

group('the driftwood lies on the sand');
{
  for (const d of LAYOUT.driftwood) {
    const g = groundHeight(d.x, d.z);
    const axis = g + d.r - d.sink;      // buildDriftwood puts the trunk axis here
    ok(axis + d.r > g + 0.12,
      `the log at ${d.x},${d.z} shows above the sand rather than being buried in it`,
      `${(axis + d.r - g).toFixed(2)} m of trunk proud`);
    ok(axis - d.r < g + 0.02,
      `the log at ${d.x},${d.z} touches the sand rather than floating over it`,
      `underside ${(axis - d.r - g).toFixed(2)} m relative to ground`);
  }
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
