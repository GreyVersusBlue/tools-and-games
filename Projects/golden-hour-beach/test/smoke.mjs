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
        sandHeight, shorelineZ, seabedSlope, beachSlope, regionAt, regionWeights, walkLimits, trailX,
        riverX, PIER, onPier, pierDeckY, CAVE,
        TIDE, tideLevel, tideY, seaLevel, waterLineZ, sandAt, poolIsClear,
        WET_REACH, WET_STRIP,
        BAR, inBarZone, barCrestS, seaOver, shoreEdgeZ, barEdges, barStep } =
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

  // The planking is ground to a walker and is not the beach to anything that
  // paints the beach. The wet strip and the foam line both used to read
  // groundHeight and both climbed the pier because of it.
  const deckZ = PIER.deckEnd + 0.5;
  ok(groundHeight(PIER.x, deckZ) - sandHeight(PIER.x, deckZ) > 3,
    'the sand under the pier is the sand, not the deck',
    `deck ${groundHeight(PIER.x, deckZ).toFixed(2)} m, sand ${sandHeight(PIER.x, deckZ).toFixed(2)} m`);
  let split = 0, splitAt = null;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 3) {
    for (let z = -40; z <= 110; z += 3) {
      if (onPier(x, z)) continue;
      const d = Math.abs(groundHeight(x, z) - sandHeight(x, z));
      if (d > split) { split = d; splitAt = [x, z]; }
    }
  }
  ok(split === 0, 'and everywhere off the planking the two are the same ground',
    `worst difference ${split} at ${splitAt}`);
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
  // Against the highest water the sea ever reaches now — the crest of the wave
  // at high tide — rather than the old figure of 0.2, which was the swash's
  // own ceiling and is no longer the sea's.
  const highestSea = seaLevel(1, 3 * TIDE.period / 4);
  ok(inCave > highestSea, 'and its floor stays dry at the top of the highest tide',
    `floor y = ${inCave.toFixed(3)}, highest sea ${highestSea.toFixed(3)}`);
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
  // The sea's whole vertical range, off the same function ocean.js sets the
  // water plane from: the 9.5 s slap at both ends of the tide. Nothing here is
  // a copy of that arithmetic — seaLevel is the one writer.
  const LOW = seaLevel(0, TIDE.period / 4);      // trough of the wave at low water
  const HIGH = seaLevel(1, 3 * TIDE.period / 4); // crest of the wave at high water

  // The wading limit should track it: a calmer trough lets a walker get closer
  // to shore before hitting knee depth than a run-up crest does, not the other
  // way round.
  const trough = wadeLimitZ(LOW), crest = wadeLimitZ(HIGH);
  ok(trough < crest, 'the limit moves seaward when the water is higher',
    `trough ${trough.toFixed(2)}, crest ${crest.toFixed(2)}`);

  // The point it solves for actually is knee depth, on the slope the walker is
  // standing on when they hit the limit.
  for (const waterLevel of [LOW, seaLevel(0), 0, seaLevel(1), HIGH]) {
    const z = wadeLimitZ(waterLevel, 0.45);
    const depth = waterLevel - groundHeight(0, z);
    ok(Math.abs(depth - 0.45) < 1e-6,
      `depth at the limit is 0.45 m (waterLevel ${waterLevel.toFixed(2)})`,
      `z = ${z.toFixed(2)}, depth = ${depth.toFixed(3)}`);
  }

  // However the tide breathes, the real limit has to be tighter than the old
  // static wall at BOUNDS.minZ, -60 — that wall is what let a walker reach eye
  // height 3.8 m underwater in the first place. Checked at low water along the
  // whole coast now, because that is the deepest the sea ever gets to be, and
  // the seabed under the headland is steeper than the one at home.
  let worstLimit = Infinity, worstAt = 0;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 4) {
    const z = wadeLimitZ(LOW, 0.45, x);
    if (z < worstLimit) { worstLimit = z; worstAt = x; }
  }
  ok(worstLimit > BOUNDS.minZ, 'the wading limit is well short of the old -60 wall',
    `furthest out ${worstLimit.toFixed(2)} at x = ${worstAt}`);
}

/* ---------------------------------------------------------------- the tide -- */

group('the tide');
{
  // The opening frame is the shipped one. tideLevel(0) is exactly zero, so a
  // fresh visit puts the water plane where it has been since round one and the
  // walker's first minute is the ebb rather than a beach they never saw.
  ok(Math.abs(tideLevel(0)) === 0, 'a visit opens at mid-tide, to the millimetre',
    `tideLevel(0) = ${tideLevel(0)}`);
  ok(tideLevel(1) < 0, 'and it is going out, not coming in',
    `tideLevel(1) = ${tideLevel(1).toFixed(5)}`);

  const low = tideLevel(TIDE.period / 4), high = tideLevel(3 * TIDE.period / 4);
  ok(Math.abs(low + TIDE.range / 2) < 1e-12 && Math.abs(high - TIDE.range / 2) < 1e-12,
    'low water is a quarter cycle in and high water three quarters',
    `low ${low.toFixed(3)}, high ${high.toFixed(3)}`);

  // It is a cycle, and it does not stop where the sun does. main.js holds the
  // descent at SUN_TOTAL = 1560 because the palette has a bottom; the sea has
  // no bottom, so a walker who stays out past the last keyframe still gets a
  // beach that moves.
  let worstPeriod = 0;
  for (let t = 0; t < TIDE.period; t += 7) {
    worstPeriod = Math.max(worstPeriod, Math.abs(tideLevel(t) - tideLevel(t + TIDE.period)));
  }
  ok(worstPeriod < 1e-12, 'the cycle repeats', `worst drift ${worstPeriod.toExponential(1)}`);
  // Past SUN_TOTAL the tide has to still reach both ends of its range, which
  // is the claim "the sun holds and the sea does not" actually makes. The
  // first version of this compared t = 1560 with t = 2000 and wanted 0.1 m
  // between them — both sit near high water, 0.01 m apart, so it failed while
  // the tide was running perfectly well.
  let afterLo = Infinity, afterHi = -Infinity;
  for (let t = 1560; t <= 1560 + TIDE.period; t++) {
    afterLo = Math.min(afterLo, tideLevel(t));
    afterHi = Math.max(afterHi, tideLevel(t));
  }
  ok(Math.abs(afterLo + TIDE.range / 2) < 1e-3 && Math.abs(afterHi - TIDE.range / 2) < 1e-3,
    "the sea keeps both ends of its range after the sun's last keyframe",
    `t > 1560 reaches ${afterLo.toFixed(3)} and ${afterHi.toFixed(3)}`);

  // What the axis is worth, in metres of beach. The swash alone moved the home
  // waterline 4.3 m and always between the same two marks; the tide carries
  // that window up and down the beach face under it.
  const LOW = seaLevel(0, TIDE.period / 4), HIGH = seaLevel(1, 3 * TIDE.period / 4);
  const shippedSwing = waterLineZ(0, seaLevel(1)) - waterLineZ(0, seaLevel(0));
  const tidalSwing = waterLineZ(0, HIGH) - waterLineZ(0, LOW);
  ok(tidalSwing > 2 * shippedSwing, 'the tide more than doubles the waterline\'s reach',
    `${shippedSwing.toFixed(1)} m of swash → ${tidalSwing.toFixed(1)} m, ` +
    `z ${waterLineZ(0, LOW).toFixed(1)} to ${waterLineZ(0, HIGH).toFixed(1)}`);

  // The water's edge is where the water meets the ground, and that is checked
  // against groundHeight rather than against a second copy of the slope: solve
  // for the line, stand on it, and the sea should be exactly at your feet.
  //
  // Three stretches are not the beach profile and are left out by name, not by
  // luck: the pier deck (groundHeight returns planking there, 1.9 m up, which
  // is what makes it walkable), the pool basins carved into the headland
  // shelf, and the river channel, which is cut below sea level on purpose.
  // A fourth since #953: the bar east of the pier, whose ford is dry at low
  // water where this line says the edge is. It has a group of its own below.
  // Picking sample points that happened to miss them would have been the same
  // test with nothing holding it there.
  const plainCoast = x =>
    Math.abs(x - PIER.x) > PIER.halfW + 1 &&
    (x < 545 || x > 675) &&
    !inBarZone(x) &&
    LAYOUT.headland.pools.every(p => Math.abs(x - p.x) > p.r + 1);
  let worstEbb = 0, ebbAt = null, worstFlood = 0, floodAt = null, sampled = 0;
  for (let x = -760; x <= 760; x += 5) {
    if (!plainCoast(x)) continue;
    sampled++;
    for (const level of [LOW, seaLevel(0.25, 0), seaLevel(0), 0]) {
      const d = Math.abs(groundHeight(x, waterLineZ(x, level)) - level);
      if (d > worstEbb) { worstEbb = d; ebbAt = [x, level.toFixed(2)]; }
    }
    for (const level of [seaLevel(1, 0), seaLevel(0.5, 1800), HIGH]) {
      const d = Math.abs(groundHeight(x, waterLineZ(x, level)) - level);
      if (d > worstFlood) { worstFlood = d; floodAt = [x, level.toFixed(2)]; }
    }
  }
  // At or below sea level the ground is a clean wedge — the dune ramp and the
  // beach's long undulation both switch on well up the shore — so the solver
  // is exact there, and that is the half of the cycle the ebb spends and the
  // half the old dry-beach-slope formula got wrong.
  ok(worstEbb < 1e-9, "on the ebb the water's edge is exactly where the water meets the ground",
    `worst miss ${worstEbb.toExponential(1)} m at ${ebbAt}, over ${sampled} x`);
  // Up the beach face it is a wedge with a 0.25 m undulation written over it
  // (groundHeight's sin(x * 0.012) term, which fades in from s = 2), so the
  // edge lands within that and not on it. 0.075 m at x = -655 is the whole of
  // it; wanting 1e-9 here is what caught the term in the first place.
  ok(worstFlood < 0.10, 'and on the flood it lands inside the beach\'s own undulation',
    `worst miss ${worstFlood.toFixed(3)} m at ${floodAt}`);

  // The old hand-rolled version (shorelineZ + level / beachSlope) is wrong
  // below sea level, which is where the tide now spends most of its cycle.
  const wrong = shorelineZ(0) + LOW / beachSlope();
  ok(Math.abs(wrong - waterLineZ(0, LOW)) > 3,
    'and it is not the dry-beach slope that three call sites used to divide by',
    `old formula ${wrong.toFixed(1)}, ground ${waterLineZ(0, LOW).toFixed(1)}`);

  // The static wet strip has to cover everywhere the water goes, along the
  // whole coast — terrain.js builds it from WET_STRIP and nothing re-deforms
  // it per frame, so a tide that outran it would leave a dry seam where the
  // sea just was.
  let worstOut = -Infinity, outAt = null;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 4) {
    const sz = shorelineZ(x);
    for (const level of [LOW, HIGH]) {
      const s = waterLineZ(x, level) - sz;
      const out = Math.max(WET_STRIP.seaward - s, s - WET_STRIP.inland);
      if (out > worstOut) { worstOut = out; outAt = [x, level.toFixed(2), s.toFixed(2)]; }
    }
  }
  ok(worstOut < 0, "the tide never runs off the end of the wet sand",
    `closest approach ${(-worstOut).toFixed(2)} m of margin, worst at ${outAt}`);

  // The range is set by the beach's furniture, not by taste. The flat-stone
  // patches are where the skipping happens and they are meant to be stood on.
  let dryest = Infinity, stoneAt = null;
  for (const patch of LAYOUT.stones) {
    for (const st of patch.stones) {
      const m = st.z - waterLineZ(st.x, HIGH);
      if (m < dryest) { dryest = m; stoneAt = [st.x.toFixed(1), st.z.toFixed(1)]; }
    }
  }
  ok(dryest > 0.5, 'high water still leaves dry sand to skip a stone from',
    `closest stone ${dryest.toFixed(2)} m clear, at ${stoneAt}`);

  // And it does reach the wrack line, which is the whole point of a wrack
  // line: the mark the sea leaves at the top of its reach.
  const home = LAYOUT.wrack.filter(w => Math.abs(w.x) < 140);
  const reachedNow = home.filter(w => w.z < waterLineZ(w.x, seaLevel(1))).length;
  const reachedHigh = home.filter(w => w.z < waterLineZ(w.x, HIGH)).length;
  ok(reachedHigh > home.length * 0.8 && reachedNow < home.length * 0.1,
    'the wrack line is dry at mid-tide and washed at high water',
    `${reachedNow}/${home.length} reached at mid-tide, ${reachedHigh}/${home.length} at high`);
}

group('what the tide uncovers');
{
  const LOWY = tideY(TIDE.period / 4), HIGHY = tideY(3 * TIDE.period / 4);
  const pools = LAYOUT.headland.pools;

  ok(pools.every(p => poolIsClear(p, LOWY)), 'every pool on the shelf stands clear at low water');
  ok(pools.some(p => !poolIsClear(p, HIGHY)), 'and the sea takes the low ones at high water',
    `${pools.filter(p => !poolIsClear(p, HIGHY)).length} of ${pools.length} under at high water`);

  // The shelf is never bare, though. The first version of poolIsClear asked
  // whether the water's edge had passed the pool's seaward rim, which left a
  // 14 minute window — 36% of the cycle — with not one pool holding water; a
  // visitor who walked the headland inside it would have read an empty shelf
  // rather than a high tide.
  let bare = 0;
  for (let t = 0; t < TIDE.period; t++) if (!pools.some(p => poolIsClear(p, tideY(t)))) bare++;
  ok(bare === 0, 'and there is never a minute with nothing on the shelf at all',
    `${bare} of ${TIDE.period} seconds bare`);

  // Which pool holds water is a fact about the tide, so it has to change.
  const clearAt = t => pools.filter(p => poolIsClear(p, tideY(t))).length;
  ok(clearAt(TIDE.period / 4) > clearAt(3 * TIDE.period / 4),
    'the count of pools changes with the tide',
    `${clearAt(TIDE.period / 4)} at low water, ${clearAt(3 * TIDE.period / 4)} at high`);

  // Sand: where a footprint may be left, asked of the tide rather than of this
  // second's wave.
  const level = tideY(0);
  const line = waterLineZ(0, level);
  ok(sandAt(0, line - 0.5, level) === 'sea' &&
     sandAt(0, line + 0.5, level) === 'wet' &&
     sandAt(0, line + WET_REACH + 0.5, level) === 'dry',
    'sea below the line, wet just above it, dry past the reach');

  // And the band has to fit inside the strip terrain.js painted, at the top of
  // the tide, along the whole coast: 0.27 m of margin is what sets WET_REACH
  // at 7, and three numbers in two files that only agree by luck do not stay
  // agreeing.
  let tightest = Infinity, tightAt = null;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 4) {
    const m = (shorelineZ(x) + WET_STRIP.inland) -
              (waterLineZ(x, tideY(3 * TIDE.period / 4)) + WET_REACH);
    if (m < tightest) { tightest = m; tightAt = x; }
  }
  ok(tightest > 0, 'a print at high water is still on sand the strip darkened',
    `${tightest.toFixed(2)} m of margin at its tightest, x = ${tightAt}`);

  const HIGH = tideY(3 * TIDE.period / 4);
  let taken = 0, dry = 0, total = 0;
  for (let z = line; z < line + WET_REACH; z += 0.25) {
    total++;
    const then = sandAt(0, z, HIGH);
    if (then === 'sea') taken++;
    if (then === 'dry') dry++;
  }
  // Most of it, not all of it: WET_REACH is 7 m and the tide's own rise moves
  // the line 3.0 m, so prints stamped at the top of the mid-tide band outlive
  // the high water that takes the ones nearest the sea. That is what a beach
  // looks like at dusk. The first version of this assertion asked for all of
  // them and failed at 24 of 28.
  ok(taken > total * 0.3 && dry === 0,
    'the tide comes back for the prints nearest the water',
    `${taken}/${total} of the mid-tide wet band is sea at high water, ${dry} dry`);
  ok(sandAt(0, line + 0.25, HIGH) === 'sea',
    'including the ones right at the mid-tide edge');
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

/* ---------------------------------------------------------------- the night -- */

// Rank 5 on 2026-09-24: the fireflies drift toward the fire and the owl hunts.
// Both are pure clocks in nightpaths.js, so the paths are held here against the
// ground and the camp. play-games.mjs holds what the page does with them.
group('some of the fireflies go to the fire');
{
  const N = await import(pathToFileURL(path.join(HERE, '..', 'js', 'creatures', 'nightpaths.js')).href);
  const { CAMP } = await import(pathToFileURL(path.join(HERE, '..', 'js', 'field.js')).href);
  const flies = N.fireflyField();
  const toCamp = p => Math.hypot(p.x - CAMP.x, p.z - CAMP.z);
  const drawn = flies.filter(f => f.fire), kept = flies.filter(f => !f.fire);
  const steps = Array.from({ length: 201 }, (_, i) => i / 200);

  ok(flies.length === 40 && drawn.length === 14, 'fourteen of the forty are drawn',
    `${drawn.length} of ${flies.length}`);
  ok(Math.max(...drawn.map(toCamp)) <= Math.min(...kept.map(toCamp)),
    'and they are the fourteen nearest the camp',
    `drawn from ${Math.min(...drawn.map(toCamp)).toFixed(0)} to ${Math.max(...drawn.map(toCamp)).toFixed(0)} m, the nearest kept one ${Math.min(...kept.map(toCamp)).toFixed(0)} m`);
  ok(flies.every(f => { const a = N.fireflyAnchor(f, 0.15); return a.x === f.x && a.z === f.z && a.y === f.y; }),
    'every fly rises in its hollow');
  ok(kept.every(f => steps.every(t => { const a = N.fireflyAnchor(f, t); return a.x === f.x && a.z === f.z; })),
    'the other twenty-six never leave it');
  const arrived = drawn.map(f => {
    const a = N.fireflyAnchor(f, 0.66);
    return { d: toCamp(a), k: a.k };
  });
  ok(arrived.every(a => a.k === 1 && a.d >= N.FIREFLY.ringMin - 1e-9 && a.d <= N.FIREFLY.ringMax + 1e-9),
    'by nightT 0.66, before their window shuts at 0.7, all fourteen are round the fire',
    `${arrived.filter(a => a.k === 1).length} arrived, ${Math.min(...arrived.map(a => a.d)).toFixed(1)} to ${Math.max(...arrived.map(a => a.d)).toFixed(1)} m out`);
  const reach = Math.min(...arrived.map(a => a.d)) - N.FIREFLY.wanderFire * Math.SQRT2;
  ok(reach >= 1.7, 'and none wanders into the flames or the stone ring',
    `closest a fly can get: ${reach.toFixed(2)} m from the fire's centre`);
  let flock = false;
  for (const t of steps) {
    const ks = drawn.map(f => N.fireflyPull(f, t));
    if (ks.some(k => k === 0) && ks.some(k => k > 0 && k < 1) && ks.some(k => k === 1)) flock = true;
  }
  ok(flock, 'they come in ones and twos: at some point one is home, one on the way and one there');
  let closes = true, above = true, worst = Infinity;
  for (const f of drawn) {
    let prev = Infinity;
    for (const t of steps) {
      const a = N.fireflyAnchor(f, t);
      const d = Math.hypot(a.x - f.fire.x, a.z - f.fire.z);
      if (d > prev + 1e-9) closes = false;
      prev = d;
      const c = a.y - groundHeight(a.x, a.z);
      worst = Math.min(worst, c);
      if (c < 0.4 - 1e-9) above = false;
    }
  }
  ok(closes, 'the drift only ever closes on the fire');
  ok(above, 'and never goes into a dune on the way', `lowest ${worst.toFixed(2)} m over the sand`);
}

group('the owl hunts the dunes');
{
  const N = await import(pathToFileURL(path.join(HERE, '..', 'js', 'creatures', 'nightpaths.js')).href);
  const { mulberry32 } = await import(pathToFileURL(path.join(HERE, '..', 'js', 'field.js')).href);
  const H = N.HUNT;
  const perches = N.owlPerches();
  ok(perches.every(p => regionAt(p.x, p.z) === 'dunes'), 'both snags stand in the dunes');

  const rnd = mulberry32(0x5eed);
  let found = 0, onSand = true, onSnags = true, under = Infinity, lowest = -Infinity, grassFor = Infinity, fastest = 0;
  const SAMPLES = 2000;
  for (let h = 0; h < 200; h++) {
    const from = perches[h % 2];
    const walker = { x: from.x + (rnd() - 0.5) * 80, z: from.z + (rnd() - 0.5) * 80 };
    const target = N.huntTarget(from, walker, rnd);
    if (!target) continue;
    found++;
    const r = Math.hypot(target.x - from.x, target.z - from.z);
    if (regionAt(target.x, target.z) !== 'dunes' || groundHeight(target.x, target.z) < 1.5
        || r < H.reachLo - 1e-9 || r > H.reachHi + 1e-9) onSand = false;
    const to = perches[N.huntReturn(perches, target)];
    const start = N.huntPos(from, target, to, 0), end = N.huntPos(from, target, to, 1);
    if (Math.hypot(start.x - from.x, start.y - from.y, start.z - from.z) > 1e-9
        || Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) > 1e-9) onSnags = false;
    let low = Infinity, down = 0, prev = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const q = N.huntPos(from, target, to, i / SAMPLES);
      const c = q.y - groundHeight(q.x, q.z);
      low = Math.min(low, c);
      if (c < H.grass + 0.05) down++;
      if (prev) fastest = Math.max(fastest, Math.hypot(q.x - prev.x, q.z - prev.z) / (H.dur / SAMPLES));
      prev = q;
    }
    under = Math.min(under, low);
    lowest = Math.max(lowest, low);
    grassFor = Math.min(grassFor, down / SAMPLES * H.dur);
  }
  ok(found === 200, 'every hunt finds somewhere to drop', `${found} of 200`);
  ok(onSand, `and it is dry dune sand ${H.reachLo} to ${H.reachHi} m from the snag`);
  ok(onSnags, 'each hunt leaves from a snag and ends on one');
  // Said out loud (#147): the path's own curve already clears these dunes, so
  // this line is a floor more than a catch. With huntPos's ground clamp deleted
  // the least clearance was 0.149 m, a millimetre under, and it failed by that.
  // A dune in the way of a future snag is what the clamp and this line are for.
  ok(under >= H.grass - 1e-9, 'the owl never goes into the dunes', `least clearance ${under.toFixed(3)} m`);
  ok(lowest <= 0.2, 'every swoop goes all the way down into the grass', `highest low point ${lowest.toFixed(3)} m`);
  ok(grassFor >= 1, 'and stays down there a moment, out of sight', `shortest ${grassFor.toFixed(2)} s`);
  ok(fastest < 8, 'no faster than a barn owl flies', `${fastest.toFixed(2)} m/s at the most`);

  // Wary: a walker 15 m off the snag in any of eight directions, and the owl
  // drops on the far side of its snag from them.
  const wary = [];
  for (const from of perches) {
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const walker = { x: from.x + Math.cos(a) * 15, z: from.z + Math.sin(a) * 15 };
      const t = N.huntTarget(from, walker, mulberry32(k + 1));
      wary.push(t ? Math.hypot(t.x - walker.x, t.z - walker.z) : 0);
    }
  }
  ok(wary.every(d => d > 15), 'it hunts the ground the walker is not standing on',
    `drops ${Math.min(...wary).toFixed(1)} m from the walker at the nearest`);
}

/* ------------------------------------------------------ the bar and runnel -- */

group('the bar and the runnel (#953)');
{
  // The sea's own four corners: the water plane at the bottom and top of the
  // swash, at low and at high water.
  const LOW0 = seaLevel(0, 600), LOW1 = seaLevel(1, 600);
  const HIGH0 = seaLevel(0, 1800), HIGH1 = seaLevel(1, 1800);
  const KNEE = 0.45;
  const X0 = BAR.x - BAR.half, X1 = BAR.x + BAR.half;
  const sAt = (x, s) => sandHeight(x, shorelineZ(x) + s);

  // Nothing else moved. Every height on the coast that is not the bar's own
  // seabed, as one FNV-1a hash over the float bits, taken from field.js as it
  // stood before the bar (27,711 heights; git show 8e7fedf:.../js/field.js).
  {
    const buf = new DataView(new ArrayBuffer(8));
    let h = 0x811c9dc5, n = 0;
    for (let x = -780; x <= 780; x += 5) for (let z = -60; z <= 118; z += 2) {
      if (inBarZone(x) && z < shorelineZ(x)) continue;
      buf.setFloat64(0, groundHeight(x, z)); n++;
      for (let i = 0; i < 8; i++) { h ^= buf.getUint8(i); h = Math.imul(h, 0x01000193) >>> 0; }
    }
    ok(n === 27711 && h === 0x4257ff5a, 'the rest of the coast is the heights it was, bit for bit',
      `${n} heights, hash ${h.toString(16)}`);
  }
  ok(regionAt(X0) === 'pier' && regionAt(X1) === 'pier' && X0 > PIER.x + PIER.halfW + 20 && X0 > 140,
    'it lies on the pier beach, clear of the pier and nowhere near home', `x ${X0} to ${X1}`);
  // At its two ends the bar has run out: the seabed there is the plain wedge.
  let seam = 0;
  for (let s = 0; s >= -40; s -= 0.25) {
    for (const x of [X0 + 1e-6, X1 - 1e-6, X0 + 2, X1 - 2]) {
      seam = Math.max(seam, Math.abs(sAt(x, s) - s * seabedSlope(x)));
    }
  }
  ok(seam === 0, 'and has run out to the plain seabed 2 m inside either end', `worst lift ${seam}`);

  // The crest, read off the ground and not off BAR.crest.
  let top = -Infinity, topAt = null;
  for (let x = X0; x <= X1; x += 0.5) for (let s = -8; s >= -20; s -= 0.25) {
    const h = sAt(x, s);
    if (h > top) { top = h; topAt = [x, s]; }
  }
  ok(top > LOW1 && top < HIGH0, 'the bar is dry through every wave of low water and under every wave of high',
    `crest ${top.toFixed(3)} at s ${topAt[1]}, low water tops at ${LOW1.toFixed(2)}, high bottoms at ${HIGH0.toFixed(2)}`);
  let dryLen = 0;
  for (let x = X0; x <= X1; x += 0.5) if (sAt(x, barCrestS(x)) > tideY(600)) dryLen += 0.5;
  ok(dryLen > 50 && dryLen < 2 * BAR.half - 10, 'at low water it is a bar, tens of metres long, with sea round both tips',
    `${dryLen} m of crest above ${tideY(600).toFixed(2)}`);

  // The ford: the deepest step between the beach and the crest, down the
  // middle columns, at the highest water there ever is.
  const fordW = BAR.half * BAR.fordHalf;
  let deepest = 0;
  for (let x = BAR.x - fordW; x <= BAR.x + fordW; x += 0.5) {
    for (let s = 0; s >= BAR.s; s -= 0.25) deepest = Math.max(deepest, HIGH1 - sAt(x, s));
  }
  ok(deepest < KNEE && deepest > 0.3, 'the ford is under the knee at the top of the highest wave of high water',
    `${deepest.toFixed(3)} m at the deepest, ${(2 * fordW).toFixed(1)} m wide`);
  let worstTide = 0;
  for (let t = 0; t < TIDE.period; t += 20) for (let w = 0; w <= 1; w += 0.125) {
    for (let s = 0; s >= BAR.s; s -= 0.5) worstTide = Math.max(worstTide, seaLevel(w, t) - sAt(BAR.x, s));
  }
  ok(worstTide < KNEE, 'and at every minute of the tide and every height of the wave', `${worstTide.toFixed(3)} m`);

  // The channel either side of the ford is a channel: it holds water at low
  // water, and at high it is over the knee, which is what cuts a walker off.
  const chan = x => { let m = Infinity; for (let s = -2; s >= BAR.s; s -= 0.25) m = Math.min(m, sAt(x, s)); return m; };
  const chanX = BAR.x + BAR.half * 0.45;
  ok(chan(chanX) < LOW0 && HIGH1 - chan(chanX) > KNEE && sAt(chanX, barCrestS(chanX)) > LOW1,
    'either side of the ford the channel holds water at low water beside a dry bar, and is over the knee at high',
    `floor ${chan(chanX).toFixed(2)} at x ${chanX.toFixed(0)}`);

  // Flooding. One flat plane is drawn wherever it is above the sand, so the
  // seabed has to be one where that is true of real water: every wet cell
  // must be reachable from the open sea through wet cells. And the channel
  // has to fill from its ends.
  const GX = 0.25, GS = 0.25, NX = Math.round((X1 - X0 + 20) / GX) + 1, NS = Math.round(30 / GS) + 1;
  const gh = new Float64Array(NX * NS);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NS; j++) gh[i * NS + j] = sAt(X0 - 10 + i * GX, -j * GS);
  const stranded = level => {
    const seen = new Uint8Array(NX * NS), stack = [];
    for (let i = 0; i < NX; i++) { seen[i * NS + NS - 1] = 1; stack.push(i * NS + NS - 1); }   // s = -30, open sea
    while (stack.length) {
      const c = stack.pop(), i = (c / NS) | 0, j = c % NS;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || a >= NX || b < 0 || b >= NS) continue;
        const k = a * NS + b;
        if (!seen[k] && gh[k] < level) { seen[k] = 1; stack.push(k); }
      }
    }
    let n = 0;
    // 2 cm of slack: the channel's deepest line is a groove running across
    // the grid at a slant, and a 0.25 m grid reads millimetre pockets into it
    // (six of 1 mm on the shape as shipped). A basin is one a walker could see.
    for (let k = 0; k < NX * NS; k++) if (gh[k] < level - 0.02 && !seen[k]) n++;
    return n;
  };
  let ponds = 0, levels = 0;
  for (let level = LOW0; level <= HIGH1 + 1e-9; level += 0.005) { ponds += stranded(level); levels++; }
  ok(ponds === 0, 'no water is ever drawn in a basin the sea could not have got to', `${ponds} cells stranded 2 cm deep or more, over ${levels} levels`);

  // The dry part of the channel, along the line halfway between beach and
  // bar: one stretch about the ford, shrinking as the water rises, gone
  // before the crest is.
  const midS = BAR.s / 2;
  const dryRun = level => {
    let a = null, b = null, runs = 0, was = false;
    for (let x = X0; x <= X1; x += 0.25) {
      const dry = sAt(x, midS) >= level;
      if (dry && !was) runs++;
      if (dry) { if (a === null) a = x; b = x; }
      was = dry;
    }
    return { a, b, runs };
  };
  let fromEnds = true, last = null, closedAt = null;
  for (let level = LOW0; level <= HIGH1 + 1e-9; level += 0.01) {
    const d = dryRun(level);
    if (d.runs > 1) fromEnds = false;
    if (d.runs === 1 && !(d.a < BAR.x && d.b > BAR.x)) fromEnds = false;
    if (last && d.runs === 1 && (d.a < last.a - 1e-9 || d.b > last.b + 1e-9)) fromEnds = false;
    if (last && last.runs === 0 && d.runs > 0) fromEnds = false;
    if (d.runs === 0 && closedAt === null) closedAt = level;
    last = d;
  }
  const first = dryRun(LOW0);
  ok(fromEnds && first.runs === 1 && first.b - first.a > 20 && closedAt !== null && closedAt < top,
    'the channel fills from its two ends toward the ford, and the ford goes under before the bar does',
    `dry ${first.a} to ${first.b} at ${LOW0.toFixed(2)}, closed at ${closedAt?.toFixed(2)}, crest ${top.toFixed(2)}`);

  // The edges the foam rides. Each is held to the ground, as the coast's is.
  let miss = 0, seaN = 0, landN = 0, deadShore = 0, falseShore = 0;
  for (const level of [LOW0, tideY(600), LOW1, tideY(0), seaLevel(1, 0), HIGH0, HIGH1]) {
    for (let x = X0 + 0.5; x < X1; x += 0.5) {
      const e = barEdges(x, level);
      if (e.sea !== null) { seaN++; miss = Math.max(miss, Math.abs(sandHeight(x, e.sea) - level)); }
      if (e.land !== null) { landN++; miss = Math.max(miss, Math.abs(sandHeight(x, e.land) - level)); }
      const z = shoreEdgeZ(x, level);
      if (z === null) { deadShore++; if (sandHeight(x, waterLineZ(x, level)) <= level) falseShore++; }
      else miss = Math.max(miss, level < 0 ? Math.abs(sandHeight(x, z) - level) : 0);
    }
  }
  ok(miss < 1e-9 && seaN > 300 && landN > 100, "the bar's two edges and the beach's are where the water meets the sand",
    `worst miss ${miss.toExponential(1)} m, ${seaN} seaward and ${landN} channel-side`);
  ok(deadShore > 50 && falseShore === 0, 'and the beach has no edge across the dry ford', `${deadShore} columns with none`);
  {
    const lo = barEdges(BAR.x, tideY(600)), hi = barEdges(BAR.x, tideY(1800)), side = barEdges(chanX, tideY(600));
    ok(lo.sea !== null && lo.land === null && shoreEdgeZ(BAR.x, tideY(600)) === null &&
       side.sea !== null && side.land !== null && shoreEdgeZ(chanX, tideY(600)) !== null &&
       hi.sea === null && hi.land === null && shoreEdgeZ(BAR.x, tideY(1800)) !== null,
      'low water: one edge at the ford (the far side of the bar), three beside it; high water: the beach alone');
    ok(barEdges(X0 - 1, 0).sea === null && barEdges(0, -0.3).sea === null && shoreEdgeZ(0, -0.3) === waterLineZ(0, -0.3),
      'off the bar there are no bar edges and the beach edge is the line it was');
  }
  const crestZ = shorelineZ(BAR.x) + BAR.s;
  ok(sandAt(BAR.x, crestZ, tideY(600)) === 'wet' && sandAt(BAR.x, crestZ, tideY(1800)) === 'sea' &&
     sandAt(BAR.x, crestZ + 6, tideY(600)) === 'wet' && sandAt(chanX, crestZ + 6, tideY(600)) === 'sea' &&
     !seaOver(BAR.x, crestZ, LOW1) && seaOver(BAR.x, crestZ, HIGH0) && seaOver(chanX, crestZ + 6, LOW1),
    'the bar and the dry ford take footprints at low water and the sea takes them back');
  ok(seaOver(0, -8, -0.1) === (-8 < waterLineZ(0, -0.1)) && seaOver(0, -6.5, -0.1) === (-6.5 < waterLineZ(0, -0.1)) &&
     sandAt(0, -5, -0.1) === 'wet' && sandAt(0, -8, -0.1) === 'sea',
    'and on the home beach both are the questions they were');

  // The walker. barStep is the whole rule on this stretch; controls.js adds
  // the stride and nothing else.
  const SPEED = 2.1, DT = 1 / 60;
  const walk = (x, z, dirX, dirZ, levelAt, seconds, stop) => {
    let t = 0;
    for (; t < seconds; t += DT) {
      const to = barStep(x, z, x + dirX * SPEED * DT, z + dirZ * SPEED * DT, levelAt(t));
      x = to.x; z = to.z;
      if (stop && stop(x, z)) break;
    }
    return { x, z, t };
  };
  const ashore = (x, z) => z >= shorelineZ(x);
  // Home from the crest across the ford: 13 m at 2.1 m/s, at high water with
  // the wave running, and at each minute of the tide. Not once held up.
  let slowest = 0;
  for (let t0 = 0; t0 < TIDE.period; t0 += 60) {
    const r = walk(BAR.x, crestZ, 0, 1, t => seaLevel(0.5 - 0.5 * Math.cos(t * 2 * Math.PI / 9.5), t0), 30, ashore);
    slowest = Math.max(slowest, r.t);
  }
  ok(Math.abs(slowest - -BAR.s / SPEED) < 0.05, 'the way back over the ford is a walk at walking speed at every tide',
    `${slowest.toFixed(2)} s for ${-BAR.s} m`);
  // Cut off: straight ashore from the bar beside the ford at high water is
  // refused at the channel, and the walker is still where the bar is.
  const cut = walk(chanX, shorelineZ(chanX) + barCrestS(chanX), 0, 1, () => HIGH1, 30, ashore);
  ok(!ashore(cut.x, cut.z) && HIGH1 - groundHeight(cut.x, cut.z) <= KNEE + 1e-9,
    'beside the ford at high water the channel turns a walker back, at the knee',
    `stopped at s ${(cut.z - shorelineZ(cut.x)).toFixed(2)}, ${(HIGH1 - groundHeight(cut.x, cut.z)).toFixed(3)} m deep`);
  // ...and round by the ford they are home.
  const along = walk(cut.x, shorelineZ(cut.x) + BAR.s, -1, 0, () => HIGH1, 60, x => x <= BAR.x);
  const home = walk(along.x, along.z, 0, 1, () => HIGH1, 30, ashore);
  ok(ashore(home.x, home.z), 'and back along the bar to the ford, they walk ashore',
    `${(cut.t + along.t + home.t).toFixed(1)} s in all`);
  // Seaward off the bar the old rule holds: the walker stops at the knee.
  const out = walk(BAR.x, crestZ, 0, -1, () => LOW0, 30);
  ok(Math.abs(LOW0 - groundHeight(out.x, out.z) - KNEE) < 0.02 && out.z < crestZ - 2,
    "the bar's far side is a wade to the knee and no further", `${(crestZ - out.z).toFixed(2)} m past the crest`);
  // A wave over the knee does nothing to a walker but stop them going deeper.
  {
    // A spot where the channel's own floor is the ground, so it deepens along the shore.
    const x = BAR.x + BAR.half * 0.3, z = shorelineZ(x) - 6;
    const deepNow = HIGH1 - groundHeight(x, z);
    const stay = barStep(x, z, x, z, HIGH1);
    const deeper = barStep(x, z, x + 0.035, z, HIGH1);           // toward the channel's end
    const shallower = barStep(x, z, x - 0.035, z, HIGH1);        // toward the ford
    ok(deepNow > KNEE && stay.x === x && stay.z === z && deeper.x === x && shallower.x < x,
      'a walker the water rises over is not moved, cannot go deeper, and can walk to the ford',
      `${deepNow.toFixed(2)} m deep`);
    const r = walk(x, z, -1, 0, () => HIGH1, 30, ax => ax <= BAR.x);
    ok(r.x <= BAR.x && HIGH1 - groundHeight(r.x, r.z) < KNEE, 'which they reach');
  }
  // Leaving the stretch out of depth is refused: the old limit rules there,
  // and it would snap them.
  {
    const z = shorelineZ(X1) - 6;                                  // 0.6 m down, 0.91 m of water at HIGH1
    const leave = barStep(X1 - 0.01, z, X1 + 0.02, z, HIGH1);
    const wade = barStep(X1 - 0.01, shorelineZ(X1) - 1, X1 + 0.02, shorelineZ(X1) - 1, HIGH1);
    ok(leave.x === X1 - 0.01 && wade.x === X1 + 0.02 &&
       shorelineZ(X1) - 1 >= walkLimits(X1 + 0.02, HIGH1).minZ && z < walkLimits(X1 + 0.02, HIGH1).minZ,
      'a walker leaves the stretch only where the old wading limit would have them');
  }
}

/* --------------------------------------------------------------------------- */

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
