// switchback.js: a ramp folded into lanes, so it fits inside a building.
//
// stairs.js knows one ramp: a single straight run, `slope` feet of run per
// foot of rise. At 1:12 over a 12ft storey that is 144ft of floor, which is
// longer than most of the schools this tool draws, and it breaks a rule the
// straight run cannot keep: ADA 405.6 lets one run rise 30in and no more
// before it has to stop on a level landing. A real floor-to-floor ramp is
// therefore never one run. It is five or more, folded back on themselves.
//
// This module is the geometry of that fold and nothing else (#824). It reads
// plain numbers and returns boxes, heights and segments in the stair's own
// local frame, so the footprint, the walkable surface, the hole in the floor
// above and the guards are one description. stairs.js is the one caller: a
// ramp link with `data.runs` of two or more is folded through here (#825), and
// everything else reads the fold from stairs.js.
//
// The shape is a serpentine, not a stack:
//
//        far end (z = L .. L + D)
//      +-------+-------+
//      | turn 0        |   <- level, spans lanes 0 and 1
//      +-------+-------+
//      |   ^   |   |   |
//      | lane0 | lane1 |   lane 0 climbs toward +Z, lane 1 comes back
//      |   |   |   v   |
//      +-------+-------+
//        entry | top   |   <- level, at the floor above (2 runs)
//              +-------+
//        near end (z = -D .. 0)
//
// Each run takes a lane of its own beside the last one, so no part of the
// ramp is over another part. That costs floor (five lanes of 4ft is 20ft
// wide) and buys two things a stacked dog-leg cannot have here: the surface
// is one height at every point in plan, which is what `stairSurfaceAt` and
// everything that walks on it assume, and the hole in the floor above is a
// set of plain boxes.
//
// Local frame, the same as stairs.js: local (0, 0) is the middle of the foot
// of the first run and that run climbs toward +Z. Later lanes stack toward
// +X, or toward -X with `side: -1`.
//
// Pure module: no three.js, no state. Exercised by test/switchback.test.mjs.

// The numbers a ramp is made of. They are stairs.js's by name and every caller
// still reads them from there (it re-exports them); they are written down here
// because stairs.js imports this module to fold a ramp, and the walk export's
// bundler refuses an import cycle (#825).
//
// Clear height a tread needs under the floor above. Where the run gets closer
// to the ceiling than this, the floor above has to be open — which is what
// decides where the cut starts rather than a number someone picked.
export const HEADROOM = 6.8;          // ft
// Ramps. 1:12 is the ADA maximum and the default; the shallower options exist
// because a floor-to-floor ramp at 1:12 is 144ft of run, which is a real
// number a real building has to find room for and this tool should say out
// loud rather than quietly steepen.
export const RAMP_SLOPE = 12;              // ft of run per ft of rise
export const MIN_RAMP_SLOPE = 4;
export const MAX_RAMP_SLOPE = 20;
export const RAMP_W = 4;                   // ft — 3ft clear plus the rails
export const MIN_RAMP_W = 3;
export const MAX_RAMP_W = 12;

// ADA 2010 405.6: the rise of any one ramp run is 30in at most.
export const MAX_RUN_RISE = 2.5;      // ft
// ADA 2010 405.7.3 and 405.7.4: a landing is 60in long at least, and where
// the ramp changes direction it is 60in by 60in at least. A turn landing here
// spans two lanes, so its width is never the short side.
export const LANDING_D = 5;           // ft
// More lanes than this is a car park, not a ramp: twelve lanes of 4ft is 48ft
// of width to climb one storey.
export const MAX_RUNS = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A rise that is an exact multiple of 30in must not round up a run on float
// noise: 10ft is four runs, not five.
const EPS = 1e-9;

// The fewest runs a rise can be climbed in under 405.6.
export function minRuns(rise) {
  if (!(rise > 0)) return 1;
  return Math.max(1, Math.ceil(rise / MAX_RUN_RISE - EPS));
}

// The whole fold. `runs` is how many lanes to use; it is clamped to
// 1..MAX_RUNS and is NOT raised to `minRuns(rise)`, because a design mid-edit
// is allowed to be wrong and the report is where that gets said: `legal` is
// false when a run rises more than 30in.
//
//   runs[i]      { i, box, dir, y0, y1 }   the sloped lanes; `dir` is +1 when
//                                          the lane climbs toward +Z
//   landings[]   { kind, box, y, lanes }   'turn' between lanes i and i + 1,
//                                          'top' at the floor above
//   box          everything above, bounded
//   entry, exit  the two edges left open: where you step on from the lower
//                floor and where you step off onto the upper one
//
// Every box is local { x0, x1, z0, z1 } with x0 < x1 and z0 < z1.
export function switchbackLayout(opts = {}) {
  const rise = opts.rise > 0 ? opts.rise : 0;
  const slope = clamp(Number.isFinite(opts.slope) ? opts.slope : RAMP_SLOPE, MIN_RAMP_SLOPE, MAX_RAMP_SLOPE);
  const width = clamp(Number.isFinite(opts.width) ? opts.width : RAMP_W, MIN_RAMP_W, MAX_RAMP_W);
  const n = clamp(Math.round(Number.isFinite(opts.runs) ? opts.runs : minRuns(rise)), 1, MAX_RUNS);
  const side = opts.side === -1 ? -1 : 1;
  const D = LANDING_D;
  const runLen = (rise * slope) / n;
  const runRise = rise / n;

  // Built for side +1 and mirrored at the end, so there is one set of
  // arithmetic to get wrong rather than two.
  const X0 = -width / 2;
  const laneX = (i) => X0 + i * width;
  const runs = [];
  const landings = [];
  for (let i = 0; i < n; i++) {
    runs.push({
      i,
      box: { x0: laneX(i), x1: laneX(i + 1), z0: 0, z1: runLen },
      dir: i % 2 === 0 ? 1 : -1,
      y0: i * runRise,
      y1: (i + 1) * runRise,
    });
    const far = i % 2 === 0;            // this run ends at the far end
    const z0 = far ? runLen : -D, z1 = far ? runLen + D : 0;
    if (i < n - 1) {
      landings.push({
        kind: 'turn', lanes: [i, i + 1], y: (i + 1) * runRise,
        box: { x0: laneX(i), x1: laneX(i + 2), z0, z1 },
      });
    } else {
      landings.push({
        kind: 'top', lanes: [i], y: rise,
        box: { x0: laneX(i), x1: laneX(i + 1), z0, z1 },
      });
    }
  }
  const top = landings[landings.length - 1].box;
  const topFar = (n - 1) % 2 === 0;
  const layout = {
    n, side, rise, slope, width, runLen, runRise, landingD: D,
    legal: runRise <= MAX_RUN_RISE + EPS,
    runs, landings,
    // A single run has nothing at its near end; two or more always do (the
    // top landing of an even count, or the second turn of an odd one).
    box: { x0: X0, x1: laneX(n), z0: n > 1 ? -D : 0, z1: runLen + D },
    entry: { a: { x: X0, z: 0 }, b: { x: laneX(1), z: 0 } },
    exit: {
      a: { x: top.x0, z: topFar ? top.z1 : top.z0 },
      b: { x: top.x1, z: topFar ? top.z1 : top.z0 },
    },
    // What a walker covers bottom to top down the middle of it: every run,
    // and across each turn half a landing in, one lane over, half a landing
    // back. The top landing is the floor above and is not counted.
    travel: n * runLen + (n - 1) * (width + D),
  };
  return side === 1 ? layout : mirror(layout);
}

const mirrorBox = (b) => ({ x0: -b.x1, x1: -b.x0, z0: b.z0, z1: b.z1 });
const mirrorSeg = (s) => ({ ...s, a: { x: -s.a.x, z: s.a.z }, b: { x: -s.b.x, z: s.b.z } });

function mirror(layout) {
  return {
    ...layout,
    runs: layout.runs.map((r) => ({ ...r, box: mirrorBox(r.box) })),
    landings: layout.landings.map((l) => ({ ...l, box: mirrorBox(l.box) })),
    box: mirrorBox(layout.box),
    entry: mirrorSeg(layout.entry),
    exit: mirrorSeg(layout.exit),
  };
}

const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

// Height of the ramp's surface above the lower floor at a local point, or
// null off it. Runs are asked before landings so a point on the line where a
// run meets its landing reads the run, which is the same height there anyway.
export function switchbackSurfaceAt(layout, lx, lz) {
  for (const r of layout.runs) {
    if (!inBox(r.box, lx, lz)) continue;
    if (layout.runLen <= 0) return r.y1;
    const t = (lz - r.box.z0) / layout.runLen;
    return r.y0 + (r.dir === 1 ? t : 1 - t) * (r.y1 - r.y0);
  }
  for (const l of layout.landings) if (inBox(l.box, lx, lz)) return l.y;
  return null;
}

// The parts of the floor above that have to be open: everywhere the ramp's
// surface is closer to it than `headroom`. Local boxes, exact, with no slack
// added (stairs.js's CUT_MARGIN is the caller's to add). The lane that
// crosses the headroom line is cut from where it crosses, so the low end of
// it keeps its ceiling.
export function switchbackCut(layout, headroom = HEADROOM) {
  const line = layout.rise - headroom;      // surface heights above this need air
  const out = [];
  for (const r of layout.runs) {
    if (r.y1 <= line + EPS) continue;
    if (r.y0 >= line - EPS || r.y1 === r.y0) { out.push({ ...r.box }); continue; }
    const t = (line - r.y0) / (r.y1 - r.y0);
    const z = r.dir === 1
      ? r.box.z0 + t * layout.runLen
      : r.box.z1 - t * layout.runLen;
    out.push(r.dir === 1
      ? { x0: r.box.x0, x1: r.box.x1, z0: z, z1: r.box.z1 }
      : { x0: r.box.x0, x1: r.box.x1, z0: r.box.z0, z1: z });
  }
  for (const l of layout.landings) if (l.y > line + EPS) out.push({ ...l.box });
  return out;
}

// Where a guard has to stand, as local segments { a, b, kind }:
//
//   'edge'     the outside of the whole thing, less the entry and the exit
//   'divider'  between two lanes, where the neighbour is up to two runs
//              higher or lower
//   'landing'  between two landings side by side at one end, which are two
//              runs apart in height
//
// A divider stops where its turn landing starts: that landing is the way
// through. ADA 405.8 and 405.9 ask for a handrail and edge protection on
// both sides of every run, and this is where those go.
export function switchbackRails(layout) {
  if (layout.side === -1) {
    return switchbackRails(mirror({ ...layout, side: 1 })).map(mirrorSeg);
  }
  const { n, width, runLen: L, landingD: D } = layout;
  const X0 = -width / 2, Xn = X0 + n * width;
  const at = (k) => X0 + k * width;
  const seg = (x0, z0, x1, z1, kind) => ({ a: { x: x0, z: z0 }, b: { x: x1, z: z1 }, kind });
  const out = [];
  const near = n > 1 ? -D : 0;      // how far the right-hand side reaches back
  const topFar = (n - 1) % 2 === 0;

  // The two long outsides. The first lane has nothing at its near end (that
  // is the entry), so the left one starts at the foot of the run.
  out.push(seg(X0, 0, X0, L + D, 'edge'));
  if (n > 1) out.push(seg(Xn, near, Xn, L + D, 'edge'));
  else out.push(seg(Xn, 0, Xn, L + D, 'edge'));

  // The far end, shut except under the top landing when the count is odd.
  const farEnd = topFar ? at(n - 1) : Xn;
  if (farEnd > X0) out.push(seg(X0, L + D, farEnd, L + D, 'edge'));
  // The near end: nothing across the first lane, and shut from there on
  // except under the top landing when the count is even.
  if (n > 1) {
    const nearEnd = topFar ? Xn : at(n - 1);
    if (nearEnd > at(1)) out.push(seg(at(1), -D, nearEnd, -D, 'edge'));
    // The side of the first near landing that faces the entry.
    out.push(seg(at(1), -D, at(1), 0, 'edge'));
  }

  for (let k = 1; k < n; k++) {
    out.push(seg(at(k), 0, at(k), L, 'divider'));
    // Landings pair lanes (0,1), (2,3) at the far end and (1,2), (3,4) at
    // the near end, so two of them meet on every even line far and every odd
    // line near. Line 1 near is the entry's side, already placed.
    if (k % 2 === 0) out.push(seg(at(k), L, at(k), L + D, 'landing'));
    else if (k > 1) out.push(seg(at(k), -D, at(k), 0, 'landing'));
  }
  return out;
}
