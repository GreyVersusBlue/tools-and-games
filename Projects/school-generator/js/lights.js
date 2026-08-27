// lights.js — the building's own lights: which props emit, and which of those
// the renderer can afford to make real.
//
// Phase 3's third bullet is "placeable light fixtures that actually emit —
// with a budget strategy, since three.js point/spot counts are finite". Both
// halves of that sentence live here, and neither of them imports three.
//
// **Which props emit** is catalog data, the same way a prop's footprint and
// mount are: a row with an `emit` block is a light, a row without one isn't.
// So adding a fixture stays "add a row", and a save file still never has to
// know this module exists — `type` is an open string, and a fixture from a
// newer catalog loads as an ordinary prop that this build simply doesn't light
// with.
//
// **Output is in lumens**, because Phase 1 committed to real numbers and there
// is no reason lighting should be the exception: a 2x4 LED troffer is 4,000lm,
// a corridor pendant 1,600lm, a gym high bay 20,000lm, a parking-lot pole
// 12,000lm. The renderer converts to whatever three.js wants; the catalog
// states the fact.
//
// **The budget** is two stages, and the first one does most of the work:
//
//   1. *Cluster.* A classroom is eight troffers in a 30ft room. As eight point
//      lights that is eight times the per-fragment cost for a result nobody
//      can tell from one brighter light in the middle of the ceiling — so
//      co-located fixtures on the same storey merge into one source at their
//      lumen-weighted centroid. A hundred-fixture school routinely comes out
//      of this under twenty clusters.
//   2. *Rank and cap.* What survives is sorted by distance from the eye and
//      the nearest `cap` become real lights. Everything past the cap is not
//      dropped: its remaining output folds into a flat ambient term, which is
//      the "bake" half of the strategy — the far end of a lit corridor stays
//      bright, it just stops being bright *from a direction*.
//
// Both stages are ordinary pure functions over plain objects, so the whole
// budget is testable without a canvas — which matters, because a budget you
// can't test is a budget you find out about on someone else's GPU.
//
// Pure module: no three.js. Exercised by test/lights.test.mjs.

import { FLOOR_H, WALL_H, CELL } from './grid.js';
import { shapesOf, shapeBBox, pointInShape } from './shapes.js';
import { floorCuts, inFloorCut } from './stairs.js';

// How many real lights the scene will carry at once. The pool is fixed rather
// than grown and shrunk on demand: three.js compiles a shader program per
// light count, so a pool that changes size stalls on a recompile every time
// the walker turns a corner. Twelve always-present lights is one program and
// one predictable per-fragment cost.
export const MAX_DYNAMIC_LIGHTS = 12;

// The spot pool. Directional fixtures — high bays, track heads, pole lights —
// are rarer than troffers and cost a little more per light, so they get a
// smaller, separate fixed pool: the light-count shape the renderer compiles
// against still never changes at runtime.
export const MAX_SPOT_LIGHTS = 4;

// How close two fixtures have to be to be treated as one. 12ft is about a
// classroom bay: a row of troffers merges, a fixture in the next room doesn't.
export const CLUSTER_FT = 12;

// Lumens per candela-ish, for the renderer's benefit. A point source radiating
// L lumens uniformly is L/4pi candela; three.js's physically-based lights take
// candela, so this is the honest conversion and the gain beside it is the
// artistic one.
export const LUMENS_TO_CANDELA = 1 / (4 * Math.PI);

// ---------- reading the catalog ----------

// The emit block a catalog row may carry:
//   { lm, color, range, dy, kind }
//     lm     output in lumens
//     color  '#rrggbb' of the lamp itself
//     range  ft at which the light has fallen to nothing (three's `distance`)
//     dy     ft from the prop's own origin up to the emitter — usually
//            negative for a ceiling fixture, whose origin is its mount height
//     kind   'point', or 'spot' for a directional downlight — a high bay, a
//            track head, a pole light. A spot also reads:
//     angle     full cone width in degrees (default 65)
//     penumbra  0..1 softness of the cone's edge (default 0.4)
export function emitOf(entry) {
  const e = entry && entry.emit;
  if (!e || typeof e !== 'object') return null;
  const lm = typeof e.lm === 'number' && Number.isFinite(e.lm) ? Math.max(0, e.lm) : 0;
  if (lm <= 0) return null;
  const kind = e.kind === 'spot' ? 'spot' : 'point';
  const out = {
    lm,
    color: typeof e.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color.toLowerCase() : '#fff2d8',
    range: typeof e.range === 'number' && e.range > 0 ? e.range : 30,
    dy: typeof e.dy === 'number' && Number.isFinite(e.dy) ? e.dy : 0,
    kind,
  };
  if (kind === 'spot') {
    out.angle = typeof e.angle === 'number' && e.angle > 0 && e.angle < 180 ? e.angle : 65;
    out.penumbra = typeof e.penumbra === 'number' && e.penumbra >= 0 && e.penumbra <= 1 ? e.penumbra : 0.4;
  }
  return out;
}

export const isEmitter = (entry) => emitOf(entry) !== null;

// ---------- the sources in a design ----------

// Every emitting prop, in world feet. `catalogEntry` is passed in rather than
// imported for the same reason `buildCollider` takes it: this module has no
// opinion about where prop types come from, and a test can hand it a table of
// three rows.
//
// `outdoor` sources are the ones on the site rather than in the building — a
// pole light and a wall pack burn on the same schedule as everything else but
// shouldn't be counted as interior fill.
export function lightSources(state, catalogEntry, floorHt = null) {
  if (!state || !Array.isArray(state.props)) return [];
  const ht = floorHt || state.floorHt || FLOOR_H;
  const out = [];
  for (const p of state.props) {
    const entry = catalogEntry(p.type);
    const emit = emitOf(entry);
    if (!emit) continue;
    const scale = p.scale > 0 ? p.scale : 1;
    out.push({
      id: p.id,
      type: p.type,
      floor: p.floor,
      x: p.x,
      y: p.floor * ht + (p.y || 0) + emit.dy * scale,
      z: p.z,
      // Output scales with the fixture: a troffer stamped at half size is half
      // the luminaire, not the same lamp in a smaller housing.
      lm: emit.lm * scale * scale,
      color: emit.color,
      range: emit.range * scale,
      kind: emit.kind,
      angle: emit.angle,
      penumbra: emit.penumbra,
      outdoor: !!(entry && entry.site),
      count: 1,
    });
  }
  return out;
}

// ---------- the ceiling's own troffers ----------
//
// Phase 20. Every room's ceiling has carried generic recessed troffers since
// Phase 1 — the renderer bakes one emissive pan per 8ft lattice bay, clipped
// to the room — and for seventeen phases they glowed without emitting: the
// only light they shed was a flat ambient guess (`HOUSE_FILL`, render-side).
// This makes them sources like any placed fixture, walking the *same* 8ft
// lattice the renderer bakes (odd cells both ways, centre of the cell,
// skipping stair cuts), so the light in a room comes from exactly the pans
// you can see in its ceiling. The clustering stage then does what it has
// always done — a classroom's four pans merge into one source in the middle
// of the room — which is the "clustered per room" the budget was built for.
//
// The output per pan is deliberately below a real 2x4 troffer's 4,000lm:
// these are the building's unspecified base lighting, and a placed fixture
// should always read brighter than the wallpaper it is competing with.
// Tuned against the night walkthrough rather than a photometry table: a pan
// per 8ft bay at a real troffer's 4,000lm blew a corridor out to white the
// moment the clusters, the spill and the night exposure lift all arrived at
// once. 1,000lm a pan puts a four-pan classroom cluster at about one real
// 2x4's output, which is what the eye actually expects of base lighting.
export const GENERIC_TROFFER = { lm: 1000, color: '#fff4e2', range: 22 };

export function trofferSources(state, floorHt = null) {
  if (!state || !Array.isArray(state.floors)) return [];
  const ht = floorHt || state.floorHt || FLOOR_H;
  const out = [];
  state.floors.forEach((floor, i) => {
    const ceilCuts = floorCuts(state, i + 1);
    for (const shape of shapesOf(floor)) {
      const bb = shapeBBox(shape);
      for (let z = Math.floor(bb.z0 / CELL) | 0; z <= Math.ceil(bb.z1 / CELL); z++) {
        for (let x = Math.floor(bb.x0 / CELL) | 0; x <= Math.ceil(bb.x1 / CELL); x++) {
          if (x % 2 !== 1 || z % 2 !== 1) continue;
          const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL;
          if (!pointInShape(shape, cx, cz)) continue;
          if (inFloorCut(ceilCuts, cx, cz)) continue;
          out.push({
            id: 0, type: 'ceiling-troffer', floor: i,
            x: cx, y: i * ht + WALL_H - 0.3, z: cz,
            lm: GENERIC_TROFFER.lm, color: GENERIC_TROFFER.color,
            range: GENERIC_TROFFER.range, kind: 'point',
            outdoor: false, count: 1,
          });
        }
      }
    }
  });
  return out;
}

// ---------- stage one: cluster ----------

// Merge sources that sit close together on the same storey into one.
//
// The first version of this bucketed on a lattice — O(n), obviously stable,
// and wrong in a way that showed up immediately in a test: a row of troffers
// 6in apart lands either side of a bucket line and comes out as two clusters
// of four. A lattice can't express "near", only "in the same square".
//
// So it is a greedy sweep instead. Sources are put in a fixed order (storey,
// then x, then z, then id — never their order in `props[]`, which changes
// every time somebody deletes a chair), and each one joins the first open
// cluster whose *seed* it is within `cellFt` of, or starts a new one. The seed
// is frozen at the first member, so a cluster's catchment never drifts as it
// grows and the same design always produces the same clusters — which is what
// stops a light flickering between two positions as the camera moves.
//
// O(n x clusters). A school with four hundred fixtures in thirty rooms is
// twelve thousand distance checks, once, on a rebuild.
//
// Colour is *not* averaged across a cluster: a warm pendant next to a cool
// troffer would come out an unconvincing grey. The brightest member's colour
// wins, which is the one the eye would have read anyway.
export function clusterSources(sources, cellFt = CLUSTER_FT) {
  const reach = cellFt > 0 ? cellFt : CLUSTER_FT;
  const r2 = reach * reach;
  const ordered = [...sources].sort((a, b) =>
    a.floor - b.floor ||
    (a.outdoor ? 1 : 0) - (b.outdoor ? 1 : 0) ||
    a.x - b.x || a.z - b.z || a.y - b.y || (a.id || 0) - (b.id || 0));

  const clusters = [];
  for (const s of ordered) {
    let hit = null;
    for (const c of clusters) {
      if (c.floor !== s.floor || c.outdoor !== s.outdoor || c.kind !== (s.kind || 'point')) continue;
      const dx = s.x - c.seedX, dy = s.y - c.seedY, dz = s.z - c.seedZ;
      if (dx * dx + dy * dy + dz * dz <= r2) { hit = c; break; }
    }
    if (!hit) {
      hit = {
        id: s.id, floor: s.floor, outdoor: s.outdoor, kind: s.kind || 'point',
        seedX: s.x, seedY: s.y, seedZ: s.z,
        wx: 0, wy: 0, wz: 0, lm: 0, range: 0, color: s.color, count: 0, bright: -1,
        angle: s.angle, penumbra: s.penumbra,
      };
      clusters.push(hit);
    }
    // Lumen-weighted centroid: a high bay among four sconces sits under the
    // high bay, which is where the light in the room is actually coming from.
    hit.wx += s.x * s.lm; hit.wy += s.y * s.lm; hit.wz += s.z * s.lm;
    hit.lm += s.lm;
    hit.range = Math.max(hit.range, s.range);
    hit.count += s.count || 1;
    if (s.lm > hit.bright) {
      hit.bright = s.lm; hit.color = s.color; hit.id = s.id;
      hit.angle = s.angle; hit.penumbra = s.penumbra;
    }
  }

  return clusters.map((c) => {
    const w = c.lm > 0 ? c.lm : 1;
    return {
      id: c.id, floor: c.floor, outdoor: c.outdoor, kind: c.kind,
      angle: c.angle, penumbra: c.penumbra,
      x: c.lm > 0 ? c.wx / w : c.seedX,
      y: c.lm > 0 ? c.wy / w : c.seedY,
      z: c.lm > 0 ? c.wz / w : c.seedZ,
      lm: c.lm, color: c.color,
      // A merged cluster lights a bigger volume than any one of its members.
      // Grow the reach with the cube root of how many fixtures went into it —
      // eight troffers reach twice as far as one, which is about right and,
      // more importantly, doesn't run away at a hundred.
      range: c.range * Math.cbrt(c.count),
      count: c.count,
    };
  });
}

// ---------- stage two: rank and cap ----------

const dist2 = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

// The `cap` clusters worth being real lights, nearest first, plus what was left
// over. A cluster the eye is standing outside the reach of is skipped before
// anything closer is: being 20ft from a desk lamp with a 12ft range is not
// nearer, in the only sense that matters, than being 60ft from a high bay that
// throws 90ft.
//
// `spillLm` is everything that didn't make it — the number the renderer turns
// into a flat ambient lift so a hall full of unbudgeted fixtures reads as lit
// rather than as black.
export function budgetLights(clusters, eye, cap = MAX_DYNAMIC_LIGHTS, spotCap = MAX_SPOT_LIGHTS) {
  const at = eye && Number.isFinite(eye.x) ? eye : { x: 0, y: 0, z: 0 };
  const ranked = clusters
    .map((c) => {
      const d2 = dist2(c, at);
      const reach = c.range > 0 ? c.range : 30;
      return { c, d2, inRange: d2 <= reach * reach };
    })
    // In range beats out of range; within each group, nearer wins.
    .sort((a, b) => (a.inRange === b.inRange ? a.d2 - b.d2 : (a.inRange ? -1 : 1)));

  // Two pools, one ranking: a spot cluster takes a spot slot, everything else
  // a point slot, and whatever finds no slot joins the spill like it always
  // did. `lit` stays the point list existing callers read.
  const lit = [];
  const litSpots = [];
  let spillLm = 0;
  for (const r of ranked) {
    const isSpot = r.c.kind === 'spot';
    const pool = isSpot ? litSpots : lit;
    const poolCap = isSpot ? spotCap : cap;
    if (pool.length < poolCap && r.inRange) pool.push(r.c);
    else spillLm += r.c.lm;
  }
  return { lit, litSpots, spillLm, total: clusters.length, clustered: clusters.length };
}

// The whole budget in one call, for a renderer that just wants the answer.
//
// Since Phase 20 the ceiling's generic troffers are in it by default —
// `opts.troffers: false` is for a caller asking only about placed fixtures.
// `sources` still counts what somebody placed; `troffers` counts the pans
// the building came with, so a readout can keep the two apart.
export function budgetFor(state, catalogEntry, eye, opts = {}) {
  const sources = lightSources(state, catalogEntry, opts.floorHt);
  const troffers = opts.troffers === false ? [] : trofferSources(state, opts.floorHt);
  const clusters = clusterSources(sources.concat(troffers), opts.cellFt);
  const out = budgetLights(clusters, eye, opts.cap ?? MAX_DYNAMIC_LIGHTS,
    opts.spotCap ?? MAX_SPOT_LIGHTS);
  out.sources = sources.length;
  out.troffers = troffers.length;
  return out;
}

// How much flat fill the spill is worth. Deliberately shallow and capped:
// this is the term that keeps an unbudgeted corridor from going black, not a
// global illumination solution, and letting it run with total lumens would
// wash the whole building out the moment somebody stamped fifty troffers.
//
// Phase 20 lowered the ceiling on it: with the generic troffers in the
// budget, every school saturates the spill — a whole building's ceiling is
// always over SPILL_FULL_LM — so the cap *is* the night-time fill level, and
// 0.55 on top of twelve real lights washed the interior out. 0.30 sits where
// the old flat house guess (0.32) sat, now earned instead of invented.
export const SPILL_FULL_LM = 60000;   // lumens at which the fill is maxed out
export const SPILL_MAX = 0.30;

export function spillAmbient(spillLm) {
  const lm = Number.isFinite(spillLm) && spillLm > 0 ? spillLm : 0;
  return SPILL_MAX * (1 - Math.exp(-lm / SPILL_FULL_LM));
}
