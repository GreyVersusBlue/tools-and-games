// clearance.js — the chair: what a seated body needs of a building, said once.
//
// Phase 40. "Accessibility stops at routes" was the backlog's own sentence:
// the accessible graph knew which stairs to leave out and which doorways were
// too narrow, and nothing else in the tool had ever sat in the chair — no
// turning circles, no reach ranges, no counter heights, and a walkthrough with
// exactly one body in it, a tall adult standing up.
//
// This module is the two gaps closed as one thing. Everything the analysis
// needs to know about a seated person — how wide, how high the eye, what a
// wheel rolls over, how steep a ramp may be, how big a circle it turns in, how
// far an arm reaches — is a constant here, and everything the *walkthrough*
// needs to know about the same person is the same constant read through
// `seatedStep()`. The report and the first-person camera derive from one
// contract, which is the only way they can never disagree about a doorway:
//
//   doorRolls(w, leaf)   the accessible graph keeps a doorway iff this says so,
//                        and a seated walker is refused at a doorway iff this
//                        says so — the same function, called from both sides.
//   rampRolls(link)      the same for a ramp: 1:12 is the most a chair climbs.
//   seatedStep()         the body, as the options collide.js's `moveWalker`
//                        takes — radius, threshold, grade, headroom, the door
//                        rule above.
//
// The numbers are the 2010 ADA Standards, cited beside each. They are not
// stored anywhere: every finding below is derived from the design as drawn,
// so nothing in the save format moved.
//
// Pure module: no three.js, no DOM. Exercised by test/clearance.test.mjs.

import { floorLabel } from './grid.js';
import { LEAF_NONE, floorSolidAt, shapeAt } from './shapes.js';
import {
  floorCuts, inFloorCut, stairsOf, stairMetrics, stairSurfaceAt, rampSlope,
} from './stairs.js';
import { MAX_RAMP_GRADE } from './sitemesh.js';
import { buildCollider, candidates } from './collide.js';
import { emptyField } from './terrain.js';
import { propsOnFloor } from './props.js';

// ---------- the doorway ----------
//
// The clear width a doorway offers is not the hole in the wall: a leaf parked
// at 90° and its stop eat into the opening, which is why a 36in door is the
// smallest one that gives the 32in clear ADA asks for. These four lived in
// navgraph.js from Phase 7 to Phase 39; they moved here because the walker
// now reads them too, and a contract two readers share belongs to neither.
export const CLEAR_LOSS = 0.33;          // ft — leaf and stop, off a doorway's width
export const MIN_CLEAR_W = 32 / 12;      // ft — ADA 404.2.3
// ...so the narrowest *opening* that passes, which is exactly a 3ft door.
export const MIN_ACCESSIBLE_W = MIN_CLEAR_W + CLEAR_LOSS;

// The clear width a doorway of this opening width actually offers. An opening
// with no leaf in it (a cased opening, a corridor mouth) loses nothing.
export const clearWidth = (w, leafed = true) =>
  Math.max(0, w - (leafed ? CLEAR_LOSS : 0));

// The clear width of a doorway *as hung*. A cased opening is all clear; a
// leaf loses its stop. A pair is measured with both leaves open — which is
// what the walkthrough does with one, and is the one place this reads more
// generously than a plan checker would: ADA 404.2.3 measures a pair at its
// active leaf alone, because the other may be bolted, and by that reading the
// lattice's 4ft pair (two 2ft leaves, and every generated school's front
// door) is not an accessible door. It rolls here, with both leaves open, and
// the backlog says so.
export function doorClear(w, leaf = 1) {
  if (leaf === LEAF_NONE) return Math.max(0, w);
  return clearWidth(w);
}

// **The contract.** Does a chair go through this doorway? The accessible graph
// (navgraph.js) keeps a doorway iff this is true, and a seated walker
// (collide.js, via `seatedStep`) is refused at a doorway iff it is false.
export const doorRolls = (w, leaf = 1) => doorClear(w, leaf) >= MIN_CLEAR_W - 1e-9;

// ---------- the body ----------

// Half the clear width: the chair is exactly as wide as the doorway it is
// entitled to, and that is what makes a 3ft door the narrowest it rolls
// through in the walk as well as on the graph.
export const SEATED_R = MIN_CLEAR_W / 2;            // ft — 16in
// Eye height. ADA 308 puts a seated eye between 43 and 51in; four feet is the
// middle of that, and the drop from 5.5ft is the whole of what the first
// person view has to say about the chair.
export const SEATED_EYE_H = 4;                      // ft — 48in
// The top of a seated head — what ducks under a stair soffit.
export const SEATED_HEAD_H = 4.4;                   // ft
// ADA 303.2: a vertical change of half an inch is the most a wheel rolls over
// without a bevel. This is the seated walker's step-up *and* step-down — a
// curb is a curb from either side.
export const THRESHOLD = 0.5 / 12;                  // ft
// ADA 405.2: 1:12 is the steepest running slope a ramp may have. The same
// number sitemesh.js measures a discharge route against, imported rather than
// restated so the site and the chair cannot drift apart.
export const MAX_SEATED_GRADE = MAX_RAMP_GRADE;
// How far ahead a grade is measured. A walker takes steps a few inches long,
// and a rule that tested each step on its own would let a chair creep up a
// bank in tiny steps each of which rose less than a threshold. Measured over
// a foot, a bank is a bank however slowly you approach it.
export const GRADE_PROBE = 1;                       // ft

// Is this ramp one a chair can use? Its slope is stored as feet of run per
// foot of rise (stairs.js), so 12 is the limit and anything under it is
// steeper.
export const rampRolls = (link) =>
  !!link && link.type === 'ramp' && 1 / rampSlope(link) <= MAX_SEATED_GRADE + 1e-9;

// The seated walker, as `moveWalker` options. `extra` is the per-step state
// the caller owns (`grounded`, `bodies`); everything about the body is here.
export function seatedStep(extra = {}) {
  return {
    radius: SEATED_R,
    stepUp: THRESHOLD,
    stepDown: THRESHOLD,
    headH: SEATED_HEAD_H,
    noStairs: true,
    maxGrade: MAX_SEATED_GRADE,
    gradeProbe: GRADE_PROBE,
    doorRule: (d) => doorRolls(d.w, d.leaf),
    ...extra,
  };
}

// The refusal, as a sentence — never a silent stop. `refusal` is what
// `moveWalker` hands back when the seated rules, rather than a wall, are what
// stopped the step.
export function refusalText(refusal) {
  if (!refusal || !refusal.reason) return '';
  switch (refusal.reason) {
    case 'stair':
      return 'A stair. Seated, the ramps and the lift are the way between storeys.';
    case 'door': {
      const w = refusal.doorway ? Math.round(refusal.doorway.w * 12) : null;
      return w
        ? `A ${w} in door. A chair needs 32 in clear, which is a 3 ft leaf.`
        : 'Too narrow a door. A chair needs 32 in clear, which is a 3 ft leaf.';
    }
    case 'grade':
      return Number.isFinite(refusal.grade) && refusal.grade > 0
        ? `Too steep for a chair — 1:${Math.max(1, Math.round(1 / refusal.grade))}, and 1:12 is the most a ramp may climb.`
        : 'A step. Half an inch is the most a wheel rolls over.';
    default:
      return '';
  }
}

// ---------- the turning circle ----------

// ADA 304.3.1: a circle 60in across is the space a chair turns round in. It is
// asked for where a route turns or ends — both sides of every doorway, and
// somewhere in every room a chair can enter.
export const TURN_D = 60 / 12;                      // ft
export const TURN_R = TURN_D / 2;
// ADA 403.5.1: 36in is the narrowest a route may be along its length. Asked
// at every corner the mesh knows about, which is where a corridor pinches.
export const PASSAGE_D = 36 / 12;                   // ft
export const PASSAGE_R = PASSAGE_D / 2;
// How finely a circle is tested against the floor's edge: rings of samples,
// each ring a fraction of the radius. Walls and furniture are exact.
const RINGS = 6;
const SAMPLES = 16;

// Distance from (x, z) to segment a->b.
function segDist(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
}

// Distance from (x, z) to a rotated box (the prop obstacle shape collide.js
// makes), zero inside it. Same frame as `pushOutOfBox`.
function boxDist(o, x, z) {
  const c = Math.cos(o.rotationY || 0), s = Math.sin(o.rotationY || 0);
  const wx = x - o.x, wz = z - o.z;
  const lx = wx * c - wz * s, lz = wx * s + wz * c;
  const ex = Math.max(Math.abs(lx) - o.hw, 0);
  const ez = Math.max(Math.abs(lz) - o.hd, 0);
  return Math.hypot(ex, ez);
}

// Everything on one storey a circle can be tested against: the collider's
// walls, rails, shaft walls and furniture (door leaves deliberately not — they
// swing, and a clearance is measured with the door out of the way), plus what
// the collider does not carry because a walker never needs it all at once —
// where the slab is, where it is cut, and where a stair run climbs off it.
export function clearanceWorld(state, floorIndex, catalogGet = null) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  return {
    floor: floorIndex,
    record: floor,
    collider: buildCollider(state, floorIndex, catalogGet, { site: emptyField() }),
    cuts: floorCuts(state, floorIndex),
    runs: stairsOf(state).filter((l) => l.from === floorIndex),
    metrics: stairMetrics(state),
  };
}

// Is there level floor to stand on at (x, z) — slab, not a hole, not a stair
// run climbing away under the wheel? Null when there is; otherwise what is
// there instead, which is what a finding names.
function notLevelAt(world, x, z) {
  if (!world.record || !floorSolidAt(world.record, x, z)) return 'edge';
  if (inFloorCut(world.cuts, x, z)) return 'edge';
  for (const run of world.runs) {
    const h = stairSurfaceAt(run, world.metrics, x, z);
    if (h !== null && h > THRESHOLD) return run.type === 'ramp' ? 'ramp' : 'stair';
  }
  return null;
}

// The largest circle centred at (x, z) that touches nothing, up to `maxR`, and
// what stopped it growing. `clear` is exact against walls and furniture and
// sampled against the floor's edge.
export function clearRadiusAt(world, x, z, maxR = TURN_R) {
  let clear = maxR;
  let blocker = null;
  const here = notLevelAt(world, x, z);
  if (here) return { clear: 0, blocker: here };
  const near = candidates(world.collider, x - maxR, z - maxR, x + maxR, z + maxR);
  for (const s of near.segs) {
    const d = segDist(s, x, z) - (s.pad ?? 0);
    if (d < clear) { clear = Math.max(0, d); blocker = 'wall'; }
  }
  for (const p of near.props) {
    const d = boxDist(p, x, z);
    if (d < clear) { clear = Math.max(0, d); blocker = p.type ? `furniture:${p.type}` : 'furniture'; }
  }
  // The floor's edge, by rings: the largest ring whose every sample stands on
  // level floor is how far the circle reaches before it hangs over a hole, a
  // stair, or the outside of the building. Rings past what a wall or a desk
  // already stopped are not asked — they could only agree.
  let floorR = 0;
  for (let k = 1; k <= RINGS; k++) {
    const r = (maxR * k) / RINGS;
    if (r > clear + 1e-9) break;
    let hit = null;
    for (let i = 0; i < SAMPLES && !hit; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      hit = notLevelAt(world, x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    if (hit) { clear = floorR; blocker = hit; break; }
    floorR = r;
  }
  return { clear, blocker };
}

// The same, remembered: a sweep asks about the same foot of corridor from
// several lines, and a clearance does not change between askings. Keyed on
// the foot, which is the pitch a sweep moves at.
function clearCached(world, x, z, maxR) {
  if (!world.cache) world.cache = new Map();
  const key = `${Math.round(x)}|${Math.round(z)}|${maxR}`;
  let hit = world.cache.get(key);
  if (!hit) { hit = clearRadiusAt(world, Math.round(x), Math.round(z), maxR); world.cache.set(key, hit); }
  return hit;
}

// The best of several candidate centres — a door approach may sit anywhere
// beside the door, and a room's turning space anywhere on its floor.
function bestOf(world, points, need) {
  let best = null;
  for (const p of points) {
    const r = clearRadiusAt(world, p.x, p.z, need);
    if (!best || r.clear > best.clear) best = { x: p.x, z: p.z, ...r };
    if (best.clear >= need - 1e-9) break;
  }
  return best;
}

const inches = (ft) => `${Math.round(ft * 12)} in`;
// A spot carries the name of the room it is in as `roomName`; a room row
// carries its own as `name`. Both read the same way here.
const roomName = (r) => (r && (r.roomName || r.name))
  || (r ? `an unnamed room on ${floorLabel(r.floor)}` : 'a room');

// Points spread over a tile at a pitch, centre first, for a search that stops
// at the first one that passes. A tile is convex and inside its room, so
// every one of them is somewhere a chair could actually be.
const TILE_PITCH = 4;   // ft
const MAX_TILE_POINTS = 64;
function tilePoints(t) {
  const out = [{ x: t.cx, z: t.cz }];
  const nx = Math.max(1, Math.min(8, Math.floor((t.x1 - t.x0) / TILE_PITCH)));
  const nz = Math.max(1, Math.min(8, Math.floor((t.z1 - t.z0) / TILE_PITCH)));
  if (nx * nz <= 1) return out;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      out.push({
        x: t.x0 + ((i + 0.5) / nx) * (t.x1 - t.x0),
        z: t.z0 + ((j + 0.5) / nz) * (t.z1 - t.z0),
      });
      if (out.length >= MAX_TILE_POINTS) return out;
    }
  }
  return out;
}
const blockerName = (b) => {
  if (!b) return 'nothing';
  if (b === 'wall') return 'a wall';
  if (b === 'edge') return 'the edge of the floor';
  if (b === 'stair') return 'a stair';
  if (b === 'ramp') return 'a ramp';
  if (b.startsWith('furniture:')) return `the ${b.slice('furniture:'.length).replace(/-/g, ' ')}`;
  return 'furniture';
};

// Where a chair has to be able to turn, tested. `opts.nav` is the accessible
// graph (the doorways it kept are the ones a chair reaches); `opts.reachable`
// says which rooms are on the route at all, so a wing only stairs reach does
// not pile clearance findings on top of the finding that already says so;
// `opts.circulation` says which rooms are corridors, whose routes are swept
// for pinches.
export function turningAnalysis(state, opts = {}) {
  const nav = opts.nav;
  const reachable = opts.reachable || (() => true);
  const circulation = opts.circulation || (() => false);
  const catalogGet = opts.catalogGet || null;
  const spots = [];
  if (!nav || !state || !state.floors) return { spots, fails: [], tested: 0, findings: [] };
  const worlds = new Map();
  const worldFor = (i) => {
    let w = worlds.get(i);
    if (!w) { w = clearanceWorld(state, i, catalogGet); worlds.set(i, w); }
    return w;
  };
  const rooms = new Map(nav.rooms.map((r) => [r.id, r]));
  const spot = (kind, need, best, extra) => {
    spots.push({
      kind, need, x: best.x, z: best.z, clear: best.clear, blocker: best.blocker,
      ok: best.clear >= need - 1e-9,
      ...extra,
    });
  };

  // Both sides of every doorway on the route. The approach is a circle beside
  // the door — allowed to slide a little along the wall and in or out, since
  // ADA 404.2.4's clearance is a rectangle at the door rather than a point.
  for (const p of nav.portals) {
    const along = { x: -p.nz, z: p.nx };
    for (const [roomId, at] of [[p.a, p.pa], [p.b, p.pb]]) {
      if (!roomId || !at || !reachable(roomId)) continue;
      const room = rooms.get(roomId);
      const world = worldFor(p.floor);
      const out = { x: at.x - p.x, z: at.z - p.z };
      const len = Math.hypot(out.x, out.z) || 1;
      const ux = out.x / len, uz = out.z / len;
      // Three feet off the door and then further out, a foot at a time, and
      // a step either way along the wall at each: the lockers flanking a
      // corridor door are beside it, not in front of it, and a chair turns
      // in front of it.
      const points = [];
      for (const o of [0, 1, 2, 0.5, 1.5]) {
        for (const a of [0, 1.5, -1.5]) {
          points.push({
            x: at.x + ux * o + along.x * a,
            z: at.z + uz * o + along.z * a,
          });
        }
      }
      spot('door', TURN_R, bestOf(world, points, TURN_R), {
        id: p.id, floor: p.floor, room: roomId, roomName: room ? room.name || null : null,
      });
    }
  }

  // The corridors, swept. A route through a corridor is the straight line
  // between two things standing on one convex tile of it — a door to a door,
  // a door to the bend — which is exactly how navgraph.js wired the graph.
  // The passage circle is slid along each such line, and at every station it
  // may step sideways across the corridor looking for room, because a chair
  // goes round a fountain rather than through it: what is measured is the
  // narrowest *cross-section* the route has to get through, and a pinch is a
  // station where no point across the corridor clears 36in — a bench and a
  // locker bank facing each other, a jog in the wall, a void's guardrail. Only
  // circulation is swept: a classroom's route is its door, and the room test
  // below is what asks about its floor. The room's own node is not an anchor
  // here — nobody's route goes to the middle of a corridor.
  const SWEEP = 2;        // ft between stations along a line
  // Either side a station may look for room. Twelve feet is a wide corridor,
  // and half the length of the open stair a route through a stair hall has
  // to go round the end of — the answer the cache makes cheap.
  const ASIDE = 12;       // ft
  for (const m of nav.mesh || []) {
    for (const t of m.tiles) {
      if (!reachable(t.room) || !circulation(t.room)) continue;
      const room = rooms.get(t.room);
      const world = worldFor(t.floor);
      const as = t.anchors.filter((a) => a.id !== t.room);
      let worst = null;
      for (let i = 0; i < as.length; i++) {
        for (let j = i + 1; j < as.length; j++) {
          if (as[i].id === as[j].id) continue;
          const dx = as[j].x - as[i].x, dz = as[j].z - as[i].z;
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          const px = -dz / len, pz = dx / len;
          const n = Math.max(1, Math.ceil(len / SWEEP));
          for (let k = 0; k <= n; k++) {
            const x = as[i].x + (dx * k) / n, z = as[i].z + (dz * k) / n;
            let best = null;
            for (let o = 0; o <= ASIDE && !(best && best.clear >= PASSAGE_R - 1e-9); o++) {
              for (const side of (o ? [1, -1] : [1])) {
                const sx = x + px * o * side, sz = z + pz * o * side;
                const r = clearCached(world, sx, sz, PASSAGE_R);
                if (!best || r.clear > best.clear) best = { x: sx, z: sz, ...r };
                if (best.clear >= PASSAGE_R - 1e-9) break;
              }
            }
            if (!worst || best.clear < worst.clear) worst = best;
          }
        }
      }
      if (!worst || worst.clear >= PASSAGE_R - 1e-9) continue;
      spot('pinch', PASSAGE_R, worst, {
        id: t.id, floor: t.floor, room: t.room, roomName: room ? room.name || null : null,
      });
    }
  }

  // Somewhere in every room the route reaches. The candidates are the room's
  // own point and a spread of points over each convex tile the mesh cut it
  // into — a room passes if a chair can turn round anywhere in it, and the
  // search stops at the first place it can.
  for (const r of nav.rooms) {
    if (!reachable(r.id)) continue;
    const mesh = nav.mesh && nav.mesh[r.floor];
    const tiles = (mesh && mesh.byRoom.get(r.id)) || [];
    let points = [{ x: r.x, z: r.z }];
    for (const t of tiles) if (t.rect) points = points.concat(tilePoints(t));
    spot('room', TURN_R, bestOf(worldFor(r.floor), points, TURN_R), {
      id: r.id, floor: r.floor, room: r.id, roomName: r.name || null,
    });
  }

  const fails = spots.filter((s) => !s.ok);
  return { spots, fails, tested: spots.length, findings: turningFindings(spots, fails) };
}

const finding = (level, code, title, detail, extra = {}) =>
  ({ level, code, title, detail, ...extra });

// A failing spot, as the mark a plan draws: the circle that *does* fit, and
// the one that was wanted.
const circleOf = (s) => ({
  id: s.id, floor: s.floor, x: s.x, z: s.z, r: s.clear, need: s.need, kind: s.kind,
});

function turningFindings(spots, fails) {
  const out = [];
  if (!spots.length) return out;
  const doors = fails.filter((s) => s.kind === 'door');
  const pinches = fails.filter((s) => s.kind === 'pinch');
  const rooms = fails.filter((s) => s.kind === 'room');
  if (doors.length) {
    const w = doors.reduce((a, b) => (b.clear < a.clear ? b : a));
    out.push(finding('warn', 'door-approach',
      `${doors.length} door approach${doors.length === 1 ? '' : 'es'} with no room to turn a chair`,
      `Beside the door into ${roomName(w)} the clear circle is ${inches(w.clear * 2)} across ` +
      `against the 60 in a chair turns in, and ${blockerName(w.blocker)} is what is in the way. ` +
      'Moving what stands beside the door is usually the answer; a wider corridor is the other one.',
      { circles: doors.slice(0, 12).map(circleOf) }));
  }
  if (pinches.length) {
    const w = pinches.reduce((a, b) => (b.clear < a.clear ? b : a));
    out.push(finding('warn', 'route-pinch',
      `${pinches.length} pinch${pinches.length === 1 ? '' : 'es'} on the accessible route under 36 in`,
      `In ${roomName(w)} the route narrows to ${inches(w.clear * 2)}, ` +
      `where ${blockerName(w.blocker)} closes it in. A route is 36 in at its narrowest, ` +
      'and 60 in wherever two chairs have to pass.',
      { circles: pinches.slice(0, 12).map(circleOf) }));
  }
  if (rooms.length) {
    out.push(finding('warn', 'turning-space',
      `${rooms.length} room${rooms.length === 1 ? '' : 's'} a chair can enter and not turn round in`,
      `${rooms.slice(0, 4).map(roomName).join(', ')}` +
      `${rooms.length > 4 ? `, and ${rooms.length - 4} more` : ''} — nowhere on the floor ` +
      'holds a 60 in circle once the walls and the furniture are counted.',
      {
        rooms: rooms.slice(0, 8).map((s) => ({ id: s.room, floor: s.floor, name: s.roomName })),
        circles: rooms.slice(0, 12).map(circleOf),
      }));
  }
  if (!fails.length) {
    out.push(finding('ok', 'clearance', 'A chair turns everywhere it was tried',
      `${spots.length} places tested: both sides of every doorway on the route, every ` +
      'bend, and the open floor of every room a chair can reach.'));
  }
  return out;
}

// ---------- reach and heights ----------
//
// The catalog already knows every counter and shelf: `h` is a floor-standing
// row's top and `y` a wall-mounted row's bottom, both in feet, and a prop may
// scale one or move the other. The rules are ADA's, in inches, keyed on the
// geometry family a row draws with — the same key the renderer picks a
// builder by — so a new counter row is checked the day it is added.
//
//   904.4.1  a sales or service counter tops out at 36 in
//   606.3    a lavatory rim at 34 in; a classroom sink is a lavatory
//   602.4    a drinking fountain's spout at 36 in
//   308      an operable part between 15 and 48 in off the floor
//   902.3    a work surface between 28 and 34 in — one per room is the 5%
//   225.2.1  lockers: some of them have to be within reach
export const REACH_MIN = 15 / 12;                   // ft
export const REACH_MAX = 48 / 12;                   // ft
export const COUNTER_MAX = 36 / 12;                 // ft
export const LAVATORY_MAX = 34 / 12;                // ft
export const SPOUT_MAX = 36 / 12;                   // ft
export const WORK_MIN = 28 / 12;                    // ft
export const WORK_MAX = 34 / 12;                    // ft
// A fountain's spout sits a few inches under the unit's top.
const SPOUT_BELOW_TOP = 0.3;                        // ft

export const REACH_RULES = [
  { geo: 'counter', kind: 'counter', label: 'counter', max: COUNTER_MAX, cite: 'ADA 904.4.1' },
  { geo: 'sinkcounter', kind: 'counter', label: 'sink counter', max: LAVATORY_MAX, cite: 'ADA 606.3' },
  { geo: 'sink', kind: 'counter', label: 'sink', max: LAVATORY_MAX, cite: 'ADA 606.3' },
  { geo: 'fountain', kind: 'counter', label: 'drinking fountain', max: SPOUT_MAX, cite: 'ADA 602.4',
    at: (top) => top - SPOUT_BELOW_TOP },
  { geo: 'wallbox', kind: 'control', label: 'wall-mounted control', min: REACH_MIN, max: REACH_MAX, cite: 'ADA 308',
    // A speaker is a wall box with nothing on it to operate.
    unless: (entry) => entry.style === 'grille' },
  { geo: 'hookrail', kind: 'control', label: 'coat hook', min: REACH_MIN, max: REACH_MAX, cite: 'ADA 308' },
  { geo: ['desk', 'table', 'workstation', 'carrel', 'labbench'], kind: 'work', label: 'work surface',
    min: WORK_MIN, max: WORK_MAX, cite: 'ADA 902.3' },
  { geo: 'locker', kind: 'locker', label: 'locker bank', cite: 'ADA 225.2.1' },
];

const ruleFor = (entry) => {
  if (!entry || !entry.geo) return null;
  const rule = REACH_RULES.find((r) => (Array.isArray(r.geo) ? r.geo.includes(entry.geo) : r.geo === entry.geo));
  if (!rule || (rule.unless && rule.unless(entry))) return null;
  return rule;
};

// The height a rule measures, in feet: a floor-standing row's top (scaled), a
// wall-mounted row's bottom — the operable part of a dispenser or a cabinet
// is at the bottom of the box, and 48 in at the bottom is the generous
// reading.
function heightOf(entry, prop) {
  const scale = (typeof prop.scale === 'number' && prop.scale > 0) ? prop.scale : 1;
  const y = Number.isFinite(prop.y) ? prop.y : (entry.y || 0);
  if (entry.mount === 'wall' || entry.mount === 'ceiling') return y;
  return y + (entry.h || 0) * scale;
}

export function reachAnalysis(state, opts = {}) {
  const catalogGet = opts.catalogGet || null;
  const nav = opts.nav || null;
  const items = [];
  const work = new Map();       // room id -> { room, surfaces: [], within: n }
  let lockers = 0, lockersLow = 0, tested = 0;
  const count = state && state.floors ? state.floors.length : 0;
  if (!catalogGet) return { items, fails: [], tested: 0, lockers: 0, lockersLow: 0, findings: [] };

  for (let i = 0; i < count; i++) {
    const floor = state.floors[i];
    for (const p of propsOnFloor(state, i)) {
      const entry = catalogGet(p.type);
      const rule = ruleFor(entry);
      if (!rule || entry.site) continue;
      const shape = shapeAt(floor, p.x, p.z);
      const roomId = shape ? `r${i}:s${shape.id}` : null;
      const name = shape ? shape.name || null : null;
      if (rule.kind === 'locker') {
        lockers++;
        if ((entry.tiers || 1) >= 2) lockersLow++;
        continue;
      }
      const top = heightOf(entry, p);
      const at = rule.at ? rule.at(top) : top;
      tested++;
      if (rule.kind === 'work') {
        if (!roomId) continue;
        let w = work.get(roomId);
        if (!w) { w = { room: roomId, floor: i, name, surfaces: 0, within: 0, x: p.x, z: p.z }; work.set(roomId, w); }
        w.surfaces++;
        if (at >= rule.min - 1e-9 && at <= rule.max + 1e-9) w.within++;
        continue;
      }
      const high = Number.isFinite(rule.max) && at > rule.max + 1e-9;
      const low = Number.isFinite(rule.min) && at < rule.min - 1e-9;
      if (!high && !low) continue;
      items.push({
        id: p.id, type: p.type, name: entry.name || p.type, label: rule.label, kind: rule.kind,
        floor: i, x: p.x, z: p.z, room: roomId, roomName: name,
        at, limit: high ? rule.max : rule.min, high, cite: rule.cite,
      });
    }
  }
  const rooms = [...work.values()].filter((w) => w.surfaces > 0 && w.within === 0);
  const fails = items.concat(rooms.map((w) => ({
    id: w.room, kind: 'work', floor: w.floor, x: w.x, z: w.z, room: w.room, roomName: w.name,
  })));
  return {
    items, rooms, fails, tested, lockers, lockersLow,
    findings: reachFindings({ items, rooms, tested, lockers, lockersLow }),
  };
}

const propMark = (it) => ({ id: it.id, floor: it.floor, x: it.x, z: it.z, w: 0 });

function reachFindings({ items, rooms, tested, lockers, lockersLow }) {
  const out = [];
  const counters = items.filter((it) => it.kind === 'counter');
  const controls = items.filter((it) => it.kind === 'control');
  if (counters.length) {
    const w = counters.reduce((a, b) => (b.at - b.limit > a.at - a.limit ? b : a));
    out.push(finding('warn', 'counter-height',
      `${counters.length} counter${counters.length === 1 ? '' : 's'} too high for a seated person`,
      `The ${w.name.toLowerCase()}${w.roomName ? ` in ${w.roomName}` : ''} is ${inches(w.at)} ` +
      `where ${inches(w.limit)} is the limit (${w.cite}). A lower section, or a lower unit, is the fix.`,
      { doors: counters.slice(0, 8).map(propMark) }));
  }
  if (controls.length) {
    const w = controls[0];
    out.push(finding('warn', 'reach-range',
      `${controls.length} control${controls.length === 1 ? '' : 's'} outside the 15–48 in reach range`,
      `The ${w.name.toLowerCase()}${w.roomName ? ` in ${w.roomName}` : ''} is mounted at ${inches(w.at)}; ` +
      `${w.high ? 'the highest' : 'the lowest'} an operable part may be is ${inches(w.limit)} (${w.cite}).`,
      { doors: controls.slice(0, 8).map(propMark) }));
  }
  if (rooms.length) {
    out.push(finding('warn', 'work-surface',
      `${rooms.length} room${rooms.length === 1 ? '' : 's'} with no work surface at a seated height`,
      `${rooms.slice(0, 4).map(roomName).join(', ')}` +
      `${rooms.length > 4 ? `, and ${rooms.length - 4} more` : ''} — every desk, table or bench ` +
      'in the room is outside 28–34 in (ADA 902.3). One at that height per room is enough.',
      { rooms: rooms.slice(0, 8).map((w) => ({ id: w.room, floor: w.floor, name: w.name })) }));
  }
  if (lockers && !lockersLow) {
    out.push(finding('note', 'lockers',
      `${lockers} locker bank${lockers === 1 ? '' : 's'}, none within reach`,
      'Every bank is full-height, so no locker has a hook or a shelf a seated person ' +
      'reaches. Some of them (ADA 225.2.1 says 5%) want to be the half-height kind.'));
  }
  if (tested && !items.length && !rooms.length) {
    out.push(finding('ok', 'reach', 'Every counter, control and work surface is within reach',
      `${tested} of them checked against the catalog's own heights.`));
  }
  return out;
}
