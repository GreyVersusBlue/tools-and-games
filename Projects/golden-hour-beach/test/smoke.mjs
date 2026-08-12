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
const { groundHeight, BOUNDS, LAYOUT, wadeLimitZ, SHELL_KINDS,
        shorelineZ, seabedSlope, regionAt, regionWeights, walkLimits, trailX,
        riverX, PIER, onPier, pierDeckY, CAVE } =
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
  // Monotonic enough to walk: no cliff on the HOME BEACH, the original
  // rectangle. The coast beyond it has a real cliff now, on purpose — the
  // step rule fences it, and its own checks are below.
  let worst = 0, at = null;
  for (let x = -140; x <= 140; x += 2) {
    for (let z = -60; z <= 46; z += 1) {
      const d = Math.abs(groundHeight(x, z + 1) - groundHeight(x, z));
      if (d > worst) { worst = d; at = [x, z]; }
    }
  }
  ok(worst < 1.2, 'no step in the home beach is a cliff',
    `worst rise ${worst.toFixed(2)} m/m at ${at}`);
}

group('the home beach has not moved');
{
  // Twelve heights sampled from the pre-coast heightfield, recorded before the
  // shoreline-curve refactor. groundHeight must reduce to the old formula
  // bit-identically inside the original beach — this is what lets every layout
  // above survive a 10x world without re-checking a single placement.
  const GOLDEN = [
    [0, -6, 0],
    [0, -40, -3.4000000000000004],
    [0, 40, 7.421109201089736],
    [12.5, -3.25, 0.15184892001530434],
    [-88, 31, 3.7412681213040124],
    [140, 46, 9.108256083408317],
    [-140, -60, -5.4],
    [100, -8, -0.2],
    [-44, 10, 0.7540483207130297],
    [20, 34, 5.369915814530072],
    [68, -2, 0.2389386886784141],
    [-24, 2.5, 0.4164979353745456],
  ];
  let worst = 0;
  for (const [x, z, want] of GOLDEN) worst = Math.max(worst, Math.abs(groundHeight(x, z) - want));
  ok(worst < 1e-12, 'twelve golden heights are bit-identical to the pre-coast beach',
    `worst drift ${worst.toExponential(1)}`);
}

group('the coast');
{
  ok(Math.abs(shorelineZ(0) + 6) < 1e-12 && Math.abs(shorelineZ(140) + 6) < 1e-12,
    'the home waterline is still exactly -6');
  ok(shorelineZ(-560) < -38, 'the headland pushes the shoreline well out to sea',
    `shorelineZ(-560) = ${shorelineZ(-560).toFixed(1)}`);

  // Curvature cap: the foam strip folds over itself if the shoreline bends
  // faster than ~0.5 m of z per m of x. Verify a guard-rail by holding the
  // whole curve under it.
  let worstBend = 0, bendAt = 0;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 1) {
    const d = Math.abs(shorelineZ(x + 1) - shorelineZ(x));
    if (d > worstBend) { worstBend = d; bendAt = x; }
  }
  ok(worstBend < 0.5, 'the shoreline never bends sharply enough to fold the foam',
    `worst ${worstBend.toFixed(3)} m/m at x = ${bendAt}`);

  // The cliff is a cliff and the flank is a ramp: the step rule (0.9 m) must
  // block the seaward face and pass the eastern approach.
  let cliffMax = 0;
  for (let z = -35; z <= 30; z += 1) {
    cliffMax = Math.max(cliffMax, groundHeight(-560, z + 1) - groundHeight(-560, z));
  }
  ok(cliffMax > 0.9, "the headland's seaward face refuses a stride", `steepest ${cliffMax.toFixed(2)} m/m`);
  let flankMax = 0;
  for (let z = -20; z <= 60; z += 1) {
    flankMax = Math.max(flankMax, Math.abs(groundHeight(-465, z + 1) - groundHeight(-465, z)));
  }
  ok(flankMax < 0.9, 'and its eastern flank can be climbed', `steepest ${flankMax.toFixed(2)} m/m`);

  // The shelf under the cliff stays walkable at the waterline the whole way
  // round — that is the route to the pools.
  let shelfOk = true;
  for (let x = -440; x >= -600; x -= 4) {
    const s3 = groundHeight(x, shorelineZ(x) + 3);
    if (s3 > 1.4) shelfOk = false;
  }
  ok(shelfOk, 'the tide-pool shelf stays low along the whole cliff base');

  ok(regionAt(0, 0) === 'home' && regionAt(-500) === 'headland' &&
     regionAt(300) === 'pier' && regionAt(600) === 'estuary' && regionAt(10, 60) === 'dunes',
    'the regions are where they say they are');
  const w = regionWeights(-500), wh = regionWeights(0);
  ok(Math.abs(w.headland + w.home + w.estuary - 1) < 1e-9 && w.headland > 0.9 && wh.home > 0.9,
    'region weights blend to one and peak in the right places');

  const lim = walkLimits(0, 0);
  ok(Math.abs(lim.minZ - wadeLimitZ(0, 0.45, 0)) < 1e-9 && lim.maxZ === BOUNDS.maxZ,
    'walkLimits is the wading limit plus the world edge');
  // Off the headland the seabed is steeper, so the wading limit hugs the
  // (shifted) shoreline closer than the same water does at home.
  const homeReach = wadeLimitZ(0) - shorelineZ(0);
  const headReach = wadeLimitZ(0, 0.45, -560) - shorelineZ(-560);
  ok(headReach > homeReach, 'wading off the headland stops sooner (steeper seabed)',
    `${(-headReach).toFixed(1)} m vs ${(-homeReach).toFixed(1)} m of water`);
}

group('the river, the pier, and the cave');
{
  // The estuary notches the shoreline inland, and returns it before the edge.
  ok(shorelineZ(600) > 4, 'the estuary carries the shoreline inland',
    `shorelineZ(600) = ${shorelineZ(600).toFixed(1)}`);
  ok(Math.abs(shorelineZ(780) + 6) < 1.5, 'and lets it back out by the world edge',
    `shorelineZ(780) = ${shorelineZ(780).toFixed(1)}`);

  // The river runs below its banks, and crossing it is always a wade, never a
  // climb: no half-metre stride across the channel rises past the step rule.
  let carved = 0, worstStride = 0;
  for (let z = 10; z <= 100; z += 6) {
    const cx = riverX(z);
    const bed = groundHeight(cx, z);
    const bank = groundHeight(cx + 12, z);
    if (bank - bed > 0.3) carved++;
    for (let dx = -10; dx < 10; dx += 0.5) {
      const rise = groundHeight(cx + dx + 0.5, z) - groundHeight(cx + dx, z);
      worstStride = Math.max(worstStride, rise);
    }
  }
  ok(carved >= 12, 'the channel is carved below its banks', `${carved} of 16 samples`);
  ok(worstStride < 0.85, 'and crossing it never needs a stride the step rule refuses',
    `worst rise ${worstStride.toFixed(2)} m per half-metre`);

  // The pier deck is ground, sloping gently seaward, entered at beach level.
  ok(onPier(PIER.x, 0) && !onPier(PIER.x, PIER.deckEnd - 1) && !onPier(PIER.x + 5, 0),
    'onPier knows the deck from the gap and the beach beside it');
  const entryRise = groundHeight(PIER.x, PIER.deckStart - 0.5) - groundHeight(PIER.x, PIER.deckStart + 1);
  ok(entryRise < 0.9, 'stepping onto the deck clears the step rule',
    `rise ${entryRise.toFixed(2)} m`);
  ok(pierDeckY(PIER.deckEnd) > pierDeckY(PIER.deckStart), 'the deck rises as it goes out');
  ok(groundHeight(PIER.x, PIER.deckEnd + 0.5) > 1.5,
    'the deck end stands well above the water');
  // The collapsed span is not walkable: the wading limit past the deck end
  // pulls z back toward shore at any tide.
  const lim = walkLimits(PIER.x, 0.13);
  ok(lim.minZ <= PIER.deckEnd, 'walkLimits lets a walker reach the broken end');
  const limOff = walkLimits(PIER.x + PIER.halfW + 1, 0.13);
  ok(limOff.minZ > PIER.deckEnd + 4, 'but not the water beside the pier',
    `limit off-deck ${limOff.minZ.toFixed(1)}`);

  // The cave is a real recess: it backs INTO the cliff — the ground a few
  // strides inland of the floor rises like a wall — while the floor itself
  // stays dry above the highest swash.
  const inCave = groundHeight(CAVE.x, CAVE.z);
  const backWall = groundHeight(CAVE.x, CAVE.z + 10);
  ok(backWall - inCave > 2, 'the cave backs into the cliff',
    `${(backWall - inCave).toFixed(1)} m of wall behind the floor`);
  ok(inCave > 0.2, 'and its floor stays above the highest swash',
    `floor y = ${inCave.toFixed(2)}`);
  let entryOk = true;
  for (let s = 2; s <= 8; s += 0.5) {
    const z0 = shorelineZ(CAVE.x) + s, z1 = shorelineZ(CAVE.x) + s + 0.5;
    if (groundHeight(CAVE.x, z1) - groundHeight(CAVE.x, z0) > 0.85) entryOk = false;
  }
  ok(entryOk, 'and the walk in from the shelf clears the step rule');
}

group('the tide pools and the trail');
{
  const pools = LAYOUT.headland.pools;
  ok(pools.length >= 4, 'there are pools on the shelf', `${pools.length}`);
  ok(pools.every(p => {
    const s = p.z - shorelineZ(p.x);
    return s > 0.5 && s < 7;
  }), 'every pool sits on the shelf strip above the waterline');
  ok(pools.every(p => groundHeight(p.x, p.z) < groundHeight(p.x + p.r + 1, p.z) + 0.05 ||
                      groundHeight(p.x, p.z) < groundHeight(p.x - p.r - 1, p.z) + 0.05),
    'every pool basin is carved below its rim');
  ok(pools.every(p => p.depth > 0.2 && p.depth < 1), 'pool depths are pool-like');

  const fence = LAYOUT.dunes.fence;
  ok(fence.length > 10, 'the trail has a fence', `${fence.length} posts`);
  ok(fence.every(f => Math.abs(f.x - trailX(f.z) - 5) < 1.5),
    'every post paces the trail centreline');
  // The carved trail is genuinely lower than the dune shoulder beside it.
  let carved = 0;
  for (let z = 56; z <= 108; z += 4) {
    const onTrail = groundHeight(trailX(z), z);
    const beside = groundHeight(trailX(z) + 12, z);
    if (beside - onTrail > 0.8) carved++;
  }
  ok(carved >= 8, 'the trail runs below the dunes beside it', `${carved} of 14 samples clearly carved`);
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
  // The tide mark is shore-relative now: the line has to hug the shoreline
  // CURVE, bending out to sea around the headland with the water. Measured as
  // distance from where the highest swash reaches at that x.
  const rel = LAYOUT.wrack.map(w => w.z - shorelineZ(w.x));
  const lo = Math.min(...rel), hi = Math.max(...rel);
  ok(lo > -2 && hi < 10, 'the whole line hugs the tide mark, wherever the coast bends',
    `s ${lo.toFixed(1)} to ${hi.toFixed(1)}`);

  const xs = LAYOUT.wrack.map(w => w.x);
  ok(Math.min(...xs) < -600 && Math.max(...xs) > 600,
    'and it runs the full length of the coast',
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

group('the skipping stones are worth walking to');
{
  const patches = LAYOUT.stones;
  ok(patches.length >= 3, 'there are several patches', `${patches.length} patches`);
  // A skipping stone has to start on walkable sand above the swash's reach
  // (z ≈ -3.6 at the highest run-up) — a patch underwater can't be picked up,
  // and one up in the dunes is a pile of rocks, not a skipping spot.
  const everyStone = patches.flatMap(p => p.stones);
  ok(everyStone.every(s => s.z > -3 && s.z < 12),
    'every stone lies on sand between the swash and the dunes',
    `z ${Math.min(...everyStone.map(s => s.z)).toFixed(1)} to ${Math.max(...everyStone.map(s => s.z)).toFixed(1)}`);
  ok(everyStone.every(s => s.x > BOUNDS.minX && s.x < BOUNDS.maxX),
    'and inside the walkable strip');
  ok(everyStone.every(s => s.s > 0.02 && s.s < 0.12), 'every stone is hand-sized');
  // Throwing range: a patch more than ~25 m from the waterline makes the verb
  // pointless. The waterline sits near z = -6.
  ok(patches.every(p => p.z < 20), 'every patch is within a throw of the water',
    `nearest-to-dune patch at z = ${Math.max(...patches.map(p => p.z)).toFixed(1)}`);
}

group('the forty shells');
{
  const s = LAYOUT.shells;
  ok(s.length === 40, 'there are exactly forty finds', `${s.length}`);
  ok(s.every(sh => SHELL_KINDS.includes(sh.kind)), 'every find is a known kind');
  const kinds = new Set(s.map(sh => sh.kind));
  ok(kinds.size === SHELL_KINDS.length, 'all four kinds occur', [...kinds].join(', '));
  // Above the swash line (nothing examinable underwater), below the deep dunes
  // (z 46 is the wall; leave headroom so nothing sits against it).
  ok(s.every(sh => sh.z > -5 && sh.z < 40), 'every shell lies on reachable sand',
    `z ${Math.min(...s.map(x => x.z)).toFixed(1)} to ${Math.max(...s.map(x => x.z)).toFixed(1)}`);
  ok(s.every(sh => sh.x > BOUNDS.minX && sh.x < BOUNDS.maxX), 'and inside the walkable strip');
  ok(s.every(sh => sh.s > 0.05 && sh.s < 0.4), 'every shell is shell-sized');
  const spread = new Set(s.map(sh => Math.round(sh.x / 40)));
  ok(spread.size >= 5, 'the finds spread across the beach rather than clumping in one spot',
    `${spread.size} of 7 possible 40 m bands occupied`);
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

/* ------------------------------------------------------------- the journal -- */

group('the journal survives what a reload throws at it');
{
  const jc = await import(pathToFileURL(path.join(HERE, '..', 'js', 'journal-core.js')).href);
  const { createSaveSlot } = await import(
    pathToFileURL(path.join(HERE, '..', '..', '..', 'assets', 'js', 'gvb-save.js')).href);

  ok(jc.isJournalShape({ species: [], shells: [], places: [] }), 'the empty journal is a journal');
  ok(!jc.isJournalShape(null) && !jc.isJournalShape({ species: 'gull' }),
    'garbage is not a journal');

  const dirty = {
    species: ['gull', 'gull', 'dragon', 'dolphin', 42],
    shells: ['Banded Cockle', 'Banded Cockle', 'The Hope Diamond'],
    places: ['camp', 'atlantis'],
  };
  const clean = jc.normalizeJournal(dirty);
  ok(clean.species.join(',') === 'gull,dolphin',
    'normalize dedupes and drops unknown species', clean.species.join(','));
  ok(clean.shells.join(',') === 'Banded Cockle', 'and unknown shells');
  ok(clean.places.join(',') === 'camp', 'and unknown places');
  ok(JSON.stringify(jc.normalizeJournal(clean)) === JSON.stringify(clean),
    'normalize is idempotent');

  const list = [];
  ok(jc.record(list, 'gull') === true && jc.record(list, 'gull') === false && list.length === 1,
    'record adds an entry exactly once');

  // The full slot round-trip, storage stubbed — the same pure path journal.js
  // rides in the browser.
  const mem = new Map();
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  };
  const slot = createSaveSlot({
    game: 'golden-hour', version: 1,
    validate: jc.isJournalShape, repair: jc.normalizeJournal,
    defaults: { species: [], shells: [], places: [] },
    storage,
  });
  const state = slot.fresh();
  jc.record(state.species, 'dolphin');
  jc.record(state.shells, 'Sand Dollar');
  ok(slot.save(state) === true, 'a journal saves');
  const back = slot.load();
  ok(back && back.species.includes('dolphin') && back.shells.includes('Sand Dollar'),
    'and loads back intact');

  const exported = slot.serialize(state);
  const reimported = slot.deserialize(exported);
  ok(reimported && reimported.species.includes('dolphin'),
    'the export envelope round-trips');
  const foreign = slot.deserialize(exported.replace('"golden-hour"', '"fourth-quarter"'));
  ok(foreign === null, "another game's save is refused");

  // Every shell name shells.js can hand out has a slot on the beachcombing
  // page — the grouping is the single source both sides read.
  ok(jc.SHELL_NAMES.length === Object.values(jc.SHELL_NAMES_BY_KIND).flat().length &&
     jc.SHELL_NAMES.length === new Set(jc.SHELL_NAMES).size,
    'shell names are complete and unique', `${jc.SHELL_NAMES.length} names`);
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
