// generate.js — the parametric school generator: a brief in, an ordinary
// design out.
//
// The name of the tool, finally cashed in. `program.js` decided how many
// rooms of what kind; this file decides where they go, and then writes them
// with the same calls anybody using the editor would make — `setTile`,
// `addStair`, `addRegion`, `addProp`. There is no "generated" flag, no
// parallel representation and nothing the tools treat specially. **Generate-
// then-edit is sacred**: what comes out is a design like any other, and the
// first thing you do to it is move a wall.
//
// ## The scheme
//
// One scheme, chosen because it is what a school of this size actually is: a
// **spine with wings**, the finger plan every district built between about
// 1955 and now.
//
//   * A **spine** corridor runs east–west across the top of the site.
//   * The **blocks** — gym, cafeteria, kitchen, library, locker rooms — sit
//     north of the spine in a row. They are single-storey by construction: a
//     classroom over a gym is a floor with nothing under it for eighty feet.
//   * **Wings** hang south off the spine at a regular pitch, each a
//     double-loaded corridor with rooms east and west of it and a stair hall
//     with an exit door at its far end.
//   * The **gaps between the wings** are light courts, with the admin suite
//     and the small service rooms lining the spine's south side.
//   * **Upper storeys repeat the wings exactly** — same corridors, same bays,
//     nothing else. Which means the shadow rule of shadow.js holds by
//     construction rather than by checking: an upper storey of this building
//     cannot be outside the footprint below it, because it is drawn from the
//     same rectangles.
//
// The scheme is a decision, not a search. There is no optimizer here and no
// scoring: this file lays out one plan, deterministically, and Phase 7's
// report is what tells you whether the plan is any good. Seed a school, read
// the report, move a door, read it again — that loop is the whole of
// parametric design and both halves of it now exist.
//
// ## Two passes
//
// `layoutSchool` is pure geometry: a brief in, a list of rectangles in *cells*
// out, with nothing from grid.js written to. `buildSchool` takes that plan and
// writes a state. Splitting them is what makes the layout testable without a
// design, and what makes it possible to see what the generator intends before
// it builds anything.
//
// Pure module: no three.js, no DOM. Exercised by test/generate.test.mjs.

import { CELL, ROOM_COLORS, MAX_FLOORS, createState, addFloor } from './grid.js';
import {
  createLattice, setTile, cellIdx, edgeHIdx, edgeVIdx, bake,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_WINDOW, EDGE_GLASS, EDGE_OPENING,
} from './lattice.js';
import { shapesOf, segEnds, isBuilt, isDoorOpening } from './shapes.js';
import { wallProbe } from './walls.js';
import { addProp, MAX_PROPS } from './props.js';
import { addStair } from './stairs.js';
import { applyFinish } from './finish.js';
import { addRegion } from './site.js';
import { terrainFor, raiseTerrain, smoothTerrain } from './terrain.js';
import { normalizeRoof } from './roof.js';
import { FACADE_KEYS } from './finish.js';
import { rng } from './agents.js';
import { buildProgram, bandEntry, DEFAULT_SCHEME, schemeEntry } from './program.js';
import { roomOccupancy } from './occupancy.js';
import { STAIR_IN_PER_OCC } from './egress.js';
import { MIN_STAIR_W, MAX_STAIR_W } from './stairs.js';
import { furnishRoom, roomGeometry } from './autofurnish.js';
import { floorRooms } from './navgraph.js';

// ---------- the dimensions the scheme is made of ----------
//
// All in cells (4ft). These are the scheme's proportions rather than the
// program's numbers, which is why they are constants here and ratios there.
export const SPINE_W = 3;        // 12ft — a main corridor with lockers on it
export const WING_CORR_W = 3;    // 12ft
export const WING_BAY_D = 8;     // 32ft — the depth of a classroom off a wing corridor
export const SPINE_BAY_D = 7;    // 28ft — admin rooms lining the spine
export const STAIR_HALL_D = 8;   // 32ft — a 19ft run, its landing, and a lift beside it
export const COURT_W = 10;       // 40ft — the light court between two wings
export const MARGIN = 5;         // cells of lattice around the building
export const MAX_WINGS = 6;
// The shared lattice is capped at 200 cells a side by the save format, so a
// brief that wants more building than 800ft square gets what fits and is told
// what didn't. Nothing here silently shrinks a school.
export const LATTICE_MAX = 200;
// How many rooms a wing side wants before another wing is worth having. Five
// classrooms down one side of a corridor is 160ft of wing, which is about as
// far as anybody wants to walk from the spine.
export const ROOMS_PER_SIDE = 4;
// How long a stretch of corridor gets before a cross-corridor door assembly
// breaks it. Eighty feet is a smoke compartment in a school, and it is also
// what keeps the nav graph honest: a portal graph flattens a room to one hub,
// so a corridor left whole as a two-hundred-foot "room" routes every trip in
// the building through its midpoint and reports travel distances nobody walks.
// The doors are real, the compartments are real, and the table means something.
export const CORRIDOR_SEG = 30;  // cells — 120ft
// The first bay on the west side of every wing is a stair tower rather than a
// classroom. A wing with its only stair at the far end makes every upper-storey
// room walk the length of the wing before it can start going down, which is a
// travel-distance failure the report finds and a plan nobody draws: a school
// puts a stair where the wing meets the spine *and* one at the end of it.
export const HEAD_STAIR_W = 6;   // cells — 24ft, a 19ft run plus its landing

const ceilCells = (ft) => Math.max(1, Math.ceil(ft / CELL));

// Fisher–Yates against a seeded generator, in place. The only randomness in
// this file, and it decides adjacencies rather than dimensions: the program
// still gets exactly the rooms it asked for.
function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------- expanding the program ----------
//
// A program row says "20 × Room, 32 × 28". A layout needs twenty rooms with
// twenty names. Numbering is per storey and per row, so classrooms come out
// 101, 102, ... on the ground and 201, 202, ... above it — which is what a
// school does and, not incidentally, what occupancy.js's classroom rule
// matches on.
export function expandProgram(program) {
  const out = [];
  for (const r of program.rooms) {
    for (let i = 0; i < r.count; i++) {
      out.push({
        key: r.key,
        base: r.name,
        // The stem as it stands, for the "these didn't fit" report. What
        // actually gets lettered onto the plan is `roomName(room, storey)`,
        // which needs the storey and so can't be settled here.
        name: r.name,
        seq: i + 1,
        numbered: r.number,
        w: ceilCells(r.w),
        d: ceilCells(r.d),
        group: r.group,
        tpl: r.tpl,
      });
    }
  }
  return out;
}

// The order rooms are offered to the layout in. Restrooms first so they land
// at the head of a wing where everybody passes them; then the specials, which
// want to be near each other; then general classrooms, which are
// interchangeable and so are what absorbs the rounding.
const WING_ORDER = ['restroom-g', 'restroom-b', 'science', 'computer', 'art', 'music', 'shop', 'sped', 'classroom'];
const SPINE_ORDER = ['office', 'principal', 'health', 'counsel', 'workroom', 'custodial', 'mech'];
const BLOCK_ORDER = ['gym', 'locker-g', 'locker-b', 'cafeteria', 'kitchen', 'library'];

const rank = (list, key) => {
  const i = list.indexOf(key);
  return i < 0 ? list.length : i;
};

// ---------- the layout ----------

// A rectangle in cells, inclusive of both ends, tagged with what it is.
function rect(kind, x0, y0, x1, y1, extra = {}) {
  return { kind, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, ...extra };
}

// One corridor rectangle, cut into compartments no longer than `CORRIDOR_SEG`
// with a full-width pair of doors between each. The first segment keeps
// whatever door the caller gave it — the wing corridor's arch into the spine —
// and every segment after it opens back toward the one before.
function splitCorridor(r, axis) {
  const len = axis === 'x' ? r.w : r.h;
  const parts = Math.max(1, Math.ceil(len / CORRIDOR_SEG));
  if (parts === 1) return [r];
  // Everything about the corridor except where it is — `rect` spreads its
  // extras last, so leaving the geometry in here would put every segment back
  // on top of the original.
  // eslint-disable-next-line no-unused-vars -- w and h are destructured to
  // *exclude* them from `tags`, which is the whole point of this line.
  const { kind, x0, y0, x1, y1, w, h, ...tags } = r;
  // The two sides that lie at the *ends* of the run being cut. A junction the
  // caller asked for on one of them belongs to the segment that still has that
  // end — put it on all of them and the middle of a corridor opens into a
  // classroom; drop it and a ring corridor comes back as a horseshoe, which is
  // what this used to do and what nothing noticed until a scheme had a loop in
  // it. (The south half of a courtyard was reachable only by going outside.)
  const along = axis === 'x' ? ['w', 'e'] : ['n', 's'];
  const want = Array.isArray(r.door) ? r.door : (r.door ? [r.door] : []);
  const cross = want.filter((d) => !along.includes(d));
  const out = [];
  for (let i = 0; i < parts; i++) {
    const a = Math.round((len * i) / parts);
    const b = Math.round((len * (i + 1)) / parts) - 1;
    const seg = axis === 'x'
      ? rect(kind, x0 + a, y0, x0 + b, y1, tags)
      : rect(kind, x0, y0 + a, x1, y0 + b, tags);
    const sides = [...cross];
    if (i === 0 && want.includes(along[0])) sides.push(along[0]);
    if (i === parts - 1 && want.includes(along[1])) sides.push(along[1]);
    if (i > 0) {
      seg.name = `${r.name} ${i + 1}`;
      // The cut itself: a full-width pair of doors back to the segment before,
      // which is the smoke compartment this whole function exists to draw.
      // A junction inherited from the caller comes through as a pair too — one
      // rectangle carries one kind of opening, and a pair of doors where an
      // arch was asked for is a compartment line rather than a mistake.
      sides.push(along[0]);
      seg.doorKind = 'double';
      seg.doorFull = true;
    }
    seg.door = sides.length ? sides : null;
    out.push(seg);
  }
  return out;
}

// The four schemes share this door: a brief (or a program) in, a plan out,
// and nothing downstream knows which of them drew it. `buildSchool` reads
// `rects`, `links`, `exits`, `footprint`, `entry`, `envelope` and `style`, and
// that list is the contract — the fourth scheme was a fourth function against
// it, and the prediction Phase 8 made when it wrote that sentence held: the
// campus added one optional key (`walks`, which `buildSite` reads) and changed
// nothing else in this file's plumbing.
export function layoutSchool(briefOrProgram) {
  const program = briefOrProgram && briefOrProgram.rooms
    ? briefOrProgram
    : buildProgram(briefOrProgram);
  const scheme = (program.brief && program.brief.scheme) || DEFAULT_SCHEME;
  if (scheme === 'courtyard') return layoutCourtyard(program);
  if (scheme === 'compact') return layoutCompact(program);
  if (scheme === 'campus') return layoutCampus(program);
  return layoutSpine(program);
}

// ---------- the spine, and the two that are not it ----------

function layoutSpine(briefOrProgram) {
  const program = briefOrProgram && briefOrProgram.rooms
    ? briefOrProgram
    : buildProgram(briefOrProgram);
  const brief = program.brief;
  const storeys = Math.min(MAX_FLOORS, Math.max(1, brief.storeys));
  const rand = rng(brief.seed);

  const all = expandProgram(program);
  const blocks = orderBlocks(all.filter((r) => r.group === 'block' || BLOCK_ORDER.includes(r.key))
    .sort((a, b) => rank(BLOCK_ORDER, a.key) - rank(BLOCK_ORDER, b.key) || a.seq - b.seq),
  brief.adjacency);
  const spineRooms = all.filter((r) => SPINE_ORDER.includes(r.key))
    .sort((a, b) => rank(SPINE_ORDER, a.key) - rank(SPINE_ORDER, b.key) || a.seq - b.seq);
  const wingRooms = all.filter((r) => !blocks.includes(r) && !spineRooms.includes(r))
    .sort((a, b) => rank(WING_ORDER, a.key) - rank(WING_ORDER, b.key) || a.seq - b.seq);

  // --- how many wings, and how long ---
  //
  // Every storey gets the same wings, because that is what makes an upper
  // storey stand on the one below it. So the wings are sized for the busiest
  // storey and the others simply have a bay or two spare.
  const perStorey = Math.ceil(wingRooms.length / storeys);
  const widest = wingRooms.reduce((n, r) => Math.max(n, r.w), 6);
  const demand = wingRooms.slice(0, perStorey).reduce((n, r) => n + r.w, 0) + HEAD_STAIR_W * 2;
  const wingW = WING_BAY_D * 2 + WING_CORR_W;

  // The blocks are sized before the wings because the deepest of them sets how
  // far down the sheet the spine starts, and that is half the height budget.
  const blockDepth = blocks.reduce((n, r) => Math.max(n, r.d), 0);
  const blockSpan = blocks.reduce((n, r) => n + r.w, 0);

  // How many wings, and therefore how long each of them is. More wings is a
  // wider building and a shorter walk; fewer is a narrower one and a longer
  // walk. The heuristic is "about four rooms down each side of a corridor",
  // and then the lattice gets a vote: a wing long enough to run off the bottom
  // of the grid is split into another wing instead, as far as the width will
  // take it.
  const bayFor = (n) => Math.max(widest, Math.ceil(demand / (n * 2)) + 1);
  const fitsHeight = (n) => MARGIN * 2 + blockDepth + SPINE_W + bayFor(n) + STAIR_HALL_D <= LATTICE_MAX;
  const widthCap = Math.max(1, Math.floor(
    (LATTICE_MAX - MARGIN * 2 + COURT_W) / (wingW + COURT_W)));
  const maxWings = Math.min(MAX_WINGS, widthCap);
  let wings = Math.min(maxWings, Math.max(1, Math.ceil(perStorey / (ROOMS_PER_SIDE * 2))));
  while (wings < maxWings && !fitsHeight(wings)) wings++;
  // Bay length demanded of one wing side by the busiest storey, plus a room's
  // slack so rounding never pushes the last classroom off the end — and never
  // longer than the lattice can hold, which is the one place this file will
  // leave a room over rather than draw off the edge of the grid.
  const bayCap = LATTICE_MAX - MARGIN * 2 - blockDepth - SPINE_W - STAIR_HALL_D;
  const bayLen0 = Math.min(bayCap, bayFor(wings));

  // --- which storey each room lands on ---
  //
  // Dealt round-robin *within each kind*, so a two-storey school gets half its
  // classrooms, half its labs and half its restrooms upstairs rather than a
  // ground floor of specials and an upper floor of nothing but homerooms.
  // Classrooms are renumbered afterwards, which is why the number a room
  // carries out of `expandProgram` is only a tie-break: on the plan the
  // ground floor is the hundreds and the storey above is the two hundreds,
  // both running in order along the corridor.
  const byStorey = Array.from({ length: storeys }, () => []);
  const byKind = new Map();
  for (const r of wingRooms) {
    if (!byKind.has(r.key)) byKind.set(r.key, []);
    byKind.get(r.key).push(r);
  }
  let turn = 0;
  for (const list of byKind.values()) {
    // The seed's first job: which of twenty interchangeable classrooms lands
    // on which storey, and therefore in which wing. Same program, same room
    // count, a different school to walk through.
    shuffle(list, rand);
    for (const r of list) byStorey[turn++ % storeys].push(r);
  }
  for (const list of byStorey) {
    list.sort((a, b) => rank(WING_ORDER, a.key) - rank(WING_ORDER, b.key) || a.seq - b.seq);
  }

  // --- filling the wings ---
  //
  // Rooms are dealt round-robin across (wing, side) slots so a school with
  // three wings doesn't fill the first one and leave the third empty; within a
  // slot they stack from the spine outward, which puts the restrooms — first
  // in the order — at the head of each wing where everybody walks past them.
  //
  // The bay length is grown until nothing is left over rather than guessed
  // right first time: the demand arithmetic above is an estimate that ignores
  // how rooms pack, and a school that quietly dropped four classrooms would be
  // a school that doesn't hold the students it was asked for.
  let bayLen = bayLen0;
  let storeyPlans = null;
  let unplaced = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    storeyPlans = [];
    unplaced = [];
    for (let s = 0; s < storeys; s++) {
      const slots = [];
      for (let i = 0; i < wings; i++) {
        for (const side of [-1, 1]) {
          // The west side starts below the head stair tower; the east side
          // starts at the spine.
          slots.push({ wing: i, side, offset: side < 0 ? HEAD_STAIR_W : 0, used: 0, rooms: [] });
        }
      }
      let si = 0;
      for (const room of byStorey[s]) {
        // The next slot with room for this one, starting from the last slot
        // used — round-robin, but never skipping a room that would fit.
        let found = -1;
        for (let k = 0; k < slots.length; k++) {
          const slot = slots[(si + k) % slots.length];
          if (slot.used + room.w <= bayLen - slot.offset) { found = (si + k) % slots.length; break; }
        }
        if (found < 0) { unplaced.push(room); continue; }
        slots[found].rooms.push(room);
        slots[found].used += room.w;
        si = (found + 1) % slots.length;
      }
      storeyPlans.push({ slots });
    }
    if (!unplaced.length) break;
    // A cell at a time, so the wing ends up as short as it can be: the demand
    // estimate above ignores how rooms pack into a side, and overshooting it
    // buys a corridor nobody walks down. It stops at the lattice, and what is
    // still left over is reported as `unplaced` rather than drawn off the grid.
    if (bayLen >= bayCap) break;
    bayLen += 1;
  }

  // --- every storey but the top is built out solid ---
  //
  // All the storeys share one set of wings, but they don't fill them to the
  // same depth: deal nineteen rooms on Level 2 and eighteen on Level 1 and one
  // bay upstairs ends up over open air. So whatever is left at the end of a bay
  // becomes a room — storage where the remainder is small, a flex room where it
  // is a room's worth — on every storey that has another one above it. The
  // wings are then complete rectangles all the way up to the top floor, and
  // every storey is inside the one below it by construction. That is what makes
  // shadow.js's rule hold for a generated school without anything having to
  // check it, and it is why the *top* storey is the only one allowed to be
  // short — which is also the only place a real school builds a part floor.
  const fillers = [];
  for (let s = 0; s + 1 < storeys; s++) {
    for (const slot of storeyPlans[s].slots) {
      const spare = bayLen - slot.offset - slot.used;
      if (spare <= 0) continue;
      if (spare < 3 && slot.rooms.length) {
        // Too small to be a room: give it to the last one, which is a
        // classroom four feet deeper than the program asked for and nobody's
        // problem.
        slot.rooms[slot.rooms.length - 1].w += spare;
        slot.used += spare;
        continue;
      }
      const big = spare >= 5;
      const room = {
        key: big ? 'flex' : 'storage',
        base: big ? 'Flex Room' : 'Storeroom',
        name: big ? 'Flex Room' : 'Storeroom',
        seq: fillers.length + 1,
        numbered: true,
        w: spare,
        d: WING_BAY_D,
        group: 'wing',
        tpl: null,
      };
      fillers.push(room);
      slot.rooms.push(room);
      slot.used += spare;
    }
  }

  // Classroom numbers, assigned once the storeys are settled: along the
  // corridor, wing by wing, ground floor in the hundreds.
  for (let s = 0; s < storeys; s++) {
    let n = 1;
    for (const slot of storeyPlans[s].slots) {
      for (const room of slot.rooms) if (room.key === 'classroom') room.seq = n++;
    }
  }

  const wingH = bayLen + STAIR_HALL_D;

  // --- the spine ---
  // Court widths vary with the seed: a light court is the one dimension in the
  // scheme nothing else depends on, so it is where a second run of the same
  // brief gets to look different without becoming a different building.
  const courts = [];
  for (let i = 0; i + 1 < wings; i++) {
    courts.push(COURT_W + Math.round((rand() - 0.5) * 6));
  }
  const courtSpan = courts.reduce((a, b) => a + b, 0);
  const wingSpan = wings * wingW + courtSpan;
  const spineLen = Math.max(blockSpan, wingSpan, 12);

  const originX = MARGIN;
  const spineY = MARGIN + blockDepth;
  const footprint = {
    w: Math.min(LATTICE_MAX, originX + spineLen + MARGIN),
    h: Math.min(LATTICE_MAX, spineY + SPINE_W + wingH + MARGIN),
  };
  // The brief asked for more building than the shared lattice can hold. The
  // only two ways that shows up are a footprint that had to be clipped and a
  // wing that ran out of room before the last classrooms went in — and the
  // second is why `unplaced` counts as oversize even when the numbers fit.
  const oversize = unplaced.length > 0
    || originX + spineLen + MARGIN > LATTICE_MAX
    || spineY + SPINE_W + wingH + MARGIN > LATTICE_MAX;

  const rects = [];
  const spine = rect('corridor', originX, spineY, originX + spineLen - 1, spineY + SPINE_W - 1, {
    key: 'spine', name: 'Main Hall', color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway',
    storey: 0,
  });

  // --- blocks, north of the spine ---
  //
  // Laid left to right in program order, each the full depth it asked for, so
  // the north elevation steps in and out the way a real gym-and-cafeteria
  // frontage does.
  const blockRects = [];
  let bx = originX;
  for (const b of blocks) {
    const y1 = spineY - 1;
    const y0 = y1 - b.d + 1;
    blockRects.push(rect('room', bx, y0, bx + b.w - 1, y1, {
      key: b.key, name: b.base, tpl: b.tpl, door: 's', storey: 0, daylight: b.key !== 'kitchen',
    }));
    bx += b.w;
  }

  // --- wings, south of the spine ---
  //
  // Centred under the spine, so a short block row and a long wing row still
  // read as one building rather than two that met.
  const wingX = [];
  let wx = originX + Math.floor((spineLen - wingSpan) / 2);
  for (let i = 0; i < wings; i++) {
    wingX.push(wx);
    wx += wingW + (courts[i] || 0);
  }

  const wingY0 = spineY + SPINE_W;
  const wingRectsFor = (storey) => {
    const out = [];
    for (let i = 0; i < wings; i++) {
      const x = wingX[i];
      const corrX0 = x + WING_BAY_D;
      // The head stair, in the first bay on the west side, opening east onto
      // the wing corridor a few feet from the spine.
      out.push(rect('room', x, wingY0, x + WING_BAY_D - 1, wingY0 + HEAD_STAIR_W - 1, {
        key: 'stair-hall', name: `${wingName(i)} Stair N`, color: '#dcd7cc', fin: 'terrazzo',
        wing: i, storey, stairHall: true, head: true, door: 'e', daylight: true,
      }));
      out.push(...splitCorridor(rect('corridor', corrX0, wingY0, corrX0 + WING_CORR_W - 1, wingY0 + bayLen - 1, {
        key: `wing-corr-${i}`, name: `${wingName(i)} Hall`, color: '#e9e4da', fin: 'terrazzo',
        tpl: 'locker-hallway', wing: i, storey,
        // The junction with the spine is a cased opening across the whole
        // width — an arch, not a doorway. It is there because a corridor that
        // simply merges into another is one room to `floodRegion`, and a
        // portal graph flattens a room to a single hub: a spine and two wings
        // as one 400ft "room" put every trip in the building through its
        // middle. Separating them is architecturally what a school does
        // anyway, and it is what lets the travel-distance table mean anything.
        door: 'n', doorKind: 'opening', doorFull: true,
      }), 'z'));
      out.push(rect('room', x, wingY0 + bayLen, x + wingW - 1, wingY0 + wingH - 1, {
        key: 'stair-hall', name: `${wingName(i)} Stair S`, color: '#dcd7cc', fin: 'terrazzo',
        wing: i, storey, stairHall: true, door: 'n', daylight: true, exit: 's',
      }));
    }
    return out;
  };

  // --- rects per storey ---
  const storeyRects = [];
  for (let s = 0; s < storeys; s++) {
    const list = [];
    if (s === 0) {
      list.push(...splitCorridor(spine, 'x'), ...blockRects);
      // Admin along the spine's south side, in the courts between the wings.
      list.push(...spineSideRects(spineRooms, wingX, wingW, originX, spineLen, spineY));
    } else {
      // Every upper storey gets the spine again — the corridor above the
      // corridor, which is what the wings hang off and, not coincidentally,
      // exactly inside the footprint below. Trimmed to the wings it actually
      // serves, since upstairs there are no blocks and no admin suite for the
      // rest of its length to reach.
      const x0 = wingX[0];
      const x1 = wingX[wings - 1] + wingW - 1;
      list.push(...splitCorridor({
        ...spine, storey: s, name: `${floorWord(s)} Hall`,
        x0, x1, w: x1 - x0 + 1,
      }, 'x'));
    }
    list.push(...wingRectsFor(s));
    // The rooms themselves.
    const plan = storeyPlans[s];
    for (const slot of plan.slots) {
      const x0 = slot.side < 0 ? wingX[slot.wing] : wingX[slot.wing] + WING_BAY_D + WING_CORR_W;
      const x1 = x0 + WING_BAY_D - 1;
      let y = wingY0 + slot.offset;
      for (const room of slot.rooms) {
        list.push(rect('room', x0, y, x1, y + room.w - 1, {
          key: room.key,
          name: roomName(room, s),
          tpl: room.tpl,
          door: slot.side < 0 ? 'e' : 'w',
          daylight: !['custodial', 'mech', 'restroom-g', 'restroom-b'].includes(room.key),
          wing: slot.wing, side: slot.side, storey: s,
        }));
        y += room.w;
      }
    }
    storeyRects.push(list.map((r) => ({ ...r, storey: s })));
  }

  // --- how many people are on each storey ---
  //
  // The layout can price its own rooms, because an occupant load is a name and
  // an area and it has just written both. That is the wishlist's promise about
  // Phase 7 cashed in: the number a wing is sized from is one call away, and
  // here it is the number the stairs are sized from.
  // "Put the band room away from the library", acted on before anything is
  // counted, so the occupant loads and the stair widths below are the ones the
  // building actually has.
  const adjacency = applyAdjacency(storeyRects, brief.adjacency);

  const storeyOcc = storeyRects.map((list) => list
    .filter((r) => r.kind === 'room')
    .reduce((n, r) => n + roomOccupancy({
      name: r.name, area: r.w * r.h * CELL * CELL,
    }).occ, 0));
  const upperOcc = storeyOcc.slice(1).reduce((a, b) => a + b, 0);

  // --- vertical circulation ---
  //
  // One stair per wing per storey transition, standing in the stair hall the
  // wing ends in; one lift, beside the first of them, because a school with an
  // upper floor and no lift has an upper floor half its occupants can't reach.
  //
  // The stair's *width* is the one dimension in this file that comes from the
  // occupant load rather than from the scheme: IBC gives 0.3in of stair per
  // person above, shared between however many stairs there are. A generator
  // that drew a 4ft stair for nine hundred people upstairs would be producing
  // a building it could have known was wrong.
  const stairW = storeys > 1
    ? Math.min(MAX_STAIR_W, Math.max(MIN_STAIR_W + 1,
      Math.ceil((upperOcc * STAIR_IN_PER_OCC) / 12 / wings * 2) / 2))
    : MIN_STAIR_W + 1;
  const links = [];
  const liftWing = Math.floor(rand() * wings) % wings;
  const centre = (x0, y0, x1, y1) => ({
    x: (x0 + x1 + 1) / 2 * CELL, z: (y0 + y1 + 1) / 2 * CELL,
  });
  for (let s = 0; s + 1 < storeys; s++) {
    for (let i = 0; i < wings; i++) {
      // The foot: the run climbs east across the hall, starting west of centre
      // so its top lands inside rather than through the far wall.
      const foot = centre(wingX[i], wingY0 + bayLen, wingX[i] + wingW - 1, wingY0 + wingH - 1);
      links.push({
        type: 'stair', from: s, x: foot.x - 11, z: foot.z,
        rotationY: Math.PI / 2, width: stairW,
      });
      // The head: the same run in a smaller tower, and turned the same way for
      // the same reason. A 19ft run wants four feet of landing at each end, so
      // it has to climb along the bay's 32ft depth — swing it the other way and
      // the bottom landing is out in the spine on the far side of a wall,
      // which is a stair the nav graph correctly refuses to use.
      const head = centre(wingX[i], wingY0, wingX[i] + WING_BAY_D - 1, wingY0 + HEAD_STAIR_W - 1);
      links.push({
        type: 'stair', from: s, x: head.x - 11, z: head.z,
        rotationY: Math.PI / 2, width: Math.min(stairW, HEAD_STAIR_W * CELL - 8),
      });
      if (i === liftWing) {
        // One lift, in a stair hall — which one is the seed's choice, since
        // every wing is as good as the next and this is the difference between
        // two runs having the same plan and having the same building.
        links.push({ type: 'elevator', from: s, x: foot.x + 20, z: foot.z, rotationY: Math.PI / 2 });
      }
    }
  }

  // --- the ways out ---
  //
  // Both ends of the spine, the foot of every wing, and the main entrance —
  // which is the west end of the spine, because that is where the buses come
  // in and everything on the site downstream of that decision follows from it.
  const exits = [
    { edge: 'w', x: originX, y: spineY + 1, kind: EDGE_DOOR2, main: true },
    { edge: 'e', x: originX + spineLen, y: spineY + 1, kind: EDGE_DOOR2 },
  ];
  for (let i = 0; i < wings; i++) {
    exits.push({
      edge: 's', x: wingX[i] + Math.floor(wingW / 2), y: wingY0 + wingH, kind: EDGE_DOOR2,
    });
  }

  return {
    program,
    brief,
    scheme: 'spine',
    storeys,
    wings,
    bayLen,
    wingW,
    wingH,
    wingX,
    wingY0,
    spine: { x0: originX, y0: spineY, len: spineLen, w: SPINE_W },
    // The box the grounds are laid out around. Every scheme has one; only this
    // one also has a spine, which is why the site builder reads the envelope
    // rather than the spine it used to. The numbers are the spine's own, so a
    // spine-scheme site is the site it always was.
    envelope: {
      x0: originX, y0: spineY,
      x1: originX + spineLen, y1: wingY0 + wingH,
    },
    footprint,
    rects: storeyRects,
    storeyOcc,
    upperOcc,
    stairW,
    links,
    exits,
    unplaced,
    adjacency,
    oversize,
    entry: { x: originX * CELL, z: (spineY + SPINE_W / 2) * CELL },
    liftWing,
    courts,
    // What the seed chose about the shell rather than about the plan. Kept on
    // the plan so the same seed produces the same building down to its bricks.
    style: {
      north: Math.round(rand() * 8) * 45,
      facade: FACADE_KEYS[Math.floor(rand() * FACADE_KEYS.length) % FACADE_KEYS.length],
      roof: brief.storeys > 1 || rand() > 0.4 ? 'parapet' : 'gable',
      fieldEast: rand() > 0.35,
    },
  };
}


// ---------- what the schemes share ----------
//
// `layoutSpine` above is Phase 8's, untouched. The two below it are Phase
// 10's, and between writing them the pieces that were never about a spine came
// out into these four functions: how rooms are dealt across the storeys, how
// they are dealt into runs, what happens to the remainder of a run on a storey
// with another one above it, and how the classrooms get numbered afterwards. A
// fourth scheme is those four calls and its own geometry — which Phase 17's
// campus turned out to be, seven phases after this comment predicted it.

// A run is a straight line of rooms with their doors all on one side of it —
// one side of a wing, one band of a ring, one edge of a corridor. `axis` is
// the way rooms are stacked along it and `depth` is how deep they are; between
// them that is every rectangle the run will ever produce.
function makeRun(key, opts) {
  return {
    key,
    axis: opts.axis,
    x0: opts.x0, y0: opts.y0,
    depth: opts.depth,
    cap: Math.max(0, Math.floor(opts.cap)),
    door: opts.door,
    daylight: opts.daylight !== false,
    skipExit: opts.skipExit || null,
    used: 0,
    rooms: [],
  };
}

// The run, as rectangles. Rooms stack from the run's own origin outward, which
// is why a run that has to start clear of something (a stair tower, a lobby)
// says so by starting somewhere else rather than by carrying an offset.
function runRects(run, storey) {
  const out = [];
  let at = 0;
  for (const room of run.rooms) {
    const base = {
      key: room.key,
      name: roomName(room, storey),
      tpl: room.tpl,
      door: run.door,
      daylight: run.daylight
        && !['custodial', 'mech', 'restroom-g', 'restroom-b'].includes(room.key),
      storey,
      run: run.key,
      skipExit: run.skipExit,
    };
    out.push(run.axis === 'x'
      ? rect('room', run.x0 + at, run.y0, run.x0 + at + room.w - 1, run.y0 + run.depth - 1, base)
      : rect('room', run.x0, run.y0 + at, run.x0 + run.depth - 1, run.y0 + at + room.w - 1, base));
    at += room.w;
  }
  return out;
}

// Which storey each room lands on, dealt round-robin *within each kind* so a
// two-storey school gets half its classrooms, half its labs and half its
// restrooms upstairs rather than a ground floor of specials. The seed's first
// job, and the same one it has in the spine.
function dealStoreys(rooms, storeys, rand) {
  const byStorey = Array.from({ length: storeys }, () => []);
  const byKind = new Map();
  for (const r of rooms) {
    if (!byKind.has(r.key)) byKind.set(r.key, []);
    byKind.get(r.key).push(r);
  }
  let turn = 0;
  for (const list of byKind.values()) {
    shuffle(list, rand);
    for (const r of list) byStorey[turn++ % storeys].push(r);
  }
  for (const list of byStorey) {
    list.sort((a, b) => rank(WING_ORDER, a.key) - rank(WING_ORDER, b.key) || a.seq - b.seq);
  }
  return byStorey;
}

// Deal a storey's rooms into its runs, round-robin but never skipping a room
// that would fit, and grow the runs a cell at a time until nothing is left
// over. The estimate that sized them ignores how rooms pack; growing rather
// than guessing is what keeps a school from quietly dropping four classrooms.
function packRuns(byStorey, makeRuns, len0, lenCap) {
  let len = Math.max(1, len0);
  let plans = [];
  let unplaced = [];
  for (let attempt = 0; attempt < 96; attempt++) {
    plans = [];
    unplaced = [];
    for (let s = 0; s < byStorey.length; s++) {
      const runs = makeRuns(len, s);
      let si = 0;
      for (const room of byStorey[s]) {
        let found = -1;
        for (let k = 0; k < runs.length; k++) {
          const i = (si + k) % runs.length;
          if (runs[i].used + room.w <= runs[i].cap) { found = i; break; }
        }
        if (found < 0) { unplaced.push(room); continue; }
        runs[found].rooms.push(room);
        runs[found].used += room.w;
        si = (found + 1) % runs.length;
      }
      plans.push(runs);
    }
    if (!unplaced.length || len >= lenCap) break;
    len += 1;
  }
  return { len, plans, unplaced };
}

// Whatever is left at the end of a run on a storey that has another one above
// it becomes a room — storage where the remainder is small, a flex room where
// it is a room's worth. That is what makes every storey a complete rectangle
// and every upper one inside the footprint below by construction, which is
// shadow.js's rule held rather than checked.
function fillRuns(plans) {
  const fillers = [];
  for (let s = 0; s + 1 < plans.length; s++) {
    for (const run of plans[s]) {
      const spare = run.cap - run.used;
      if (spare <= 0) continue;
      if (spare < 3 && run.rooms.length) {
        run.rooms[run.rooms.length - 1].w += spare;
        run.used += spare;
        continue;
      }
      const big = spare >= 5;
      const room = {
        key: big ? 'flex' : 'storage',
        base: big ? 'Flex Room' : 'Storeroom',
        name: big ? 'Flex Room' : 'Storeroom',
        seq: fillers.length + 1,
        numbered: true,
        w: spare,
        d: WING_BAY_D,
        group: 'wing',
        tpl: null,
      };
      fillers.push(room);
      run.rooms.push(room);
      run.used += spare;
    }
  }
  return fillers;
}

// Classroom numbers, assigned once the storeys are settled: along the runs in
// order, ground floor in the hundreds.
function numberRooms(plans) {
  for (const runs of plans) {
    let n = 1;
    for (const run of runs) {
      for (const room of run.rooms) if (room.key === 'classroom') room.seq = n++;
    }
  }
}

// The three room lists every scheme starts from: what is too deep for a bay,
// what lines a main hall, and what fills the ordinary runs.
function sortProgram(all) {
  const blocks = all.filter((r) => r.group === 'block' || BLOCK_ORDER.includes(r.key))
    .sort((a, b) => rank(BLOCK_ORDER, a.key) - rank(BLOCK_ORDER, b.key) || a.seq - b.seq);
  const spineRooms = all.filter((r) => SPINE_ORDER.includes(r.key))
    .sort((a, b) => rank(SPINE_ORDER, a.key) - rank(SPINE_ORDER, b.key) || a.seq - b.seq);
  const wingRooms = all.filter((r) => !blocks.includes(r) && !spineRooms.includes(r))
    .sort((a, b) => rank(WING_ORDER, a.key) - rank(WING_ORDER, b.key) || a.seq - b.seq);
  return { blocks, spineRooms, wingRooms };
}

// A way *through* a band of rooms: two or three cells of corridor cut from the
// band's middle, joining the hall behind it to the outside in front of it.
// One line of geometry, and the difference between a four-hundred-foot
// building whose only ways out are at its corners and one where nobody walks
// more than half a wing. `cutShellExits` finds the door at the far end of it
// once the walls are standing, because a passage is a corridor with an
// exposed run and that is exactly what it looks for.
// Wide enough to be a way out *and* to stand a stair in: an exit passage
// through a four-hundred-foot band is where the upper storeys want to come
// down, and a stair that discharges straight into one is the arrangement the
// travel-distance table is asking for rather than a compromise with it.
export const PASSAGE_W = 6;      // cells — 24ft

function passage(key, name, x0, y0, x1, y1, storey, doors) {
  return rect('corridor', x0, y0, x1, y1, {
    key, name, color: '#e9e4da', fin: 'terrazzo', storey,
    door: doors, doorKind: 'opening', doorFull: true,
  });
}

// The blocks, reordered to suit whatever the brief said about them. They are
// laid in a row in every scheme, so a row is the whole lever: "the gym
// next to the cafeteria" is the cafeteria moved to sit behind the gym, and
// "the kitchen away from the library" is the kitchen moved to the far end.
// Nothing else can act on a pair of blocks — they are all different sizes, so
// the swap pass below cannot touch them.
function orderBlocks(blocks, rules) {
  if (!rules || !rules.length) return blocks;
  const out = [...blocks];
  const take = (key) => {
    const got = out.filter((b) => b.key === key);
    for (const b of got) out.splice(out.indexOf(b), 1);
    return got;
  };
  for (const rule of rules) {
    const has = (key) => blocks.some((b) => b.key === key);
    if (!has(rule.a) || !has(rule.b)) continue;
    const moved = take(rule.b);
    if (rule.want === 'near') {
      const after = out.map((b) => b.key).lastIndexOf(rule.a);
      out.splice(after + 1, 0, ...moved);
    } else {
      const first = out.map((b) => b.key).indexOf(rule.a);
      // The far end from wherever `a` ended up: the front of the row if `a` is
      // in the back half of it, the back if it is in the front.
      if (first > out.length / 2) out.unshift(...moved);
      else out.push(...moved);
    }
  }
  return out;
}

// The half of a plan the seed decides about the shell rather than about the
// rooms. Identical for every scheme, and drawn in the same order so that
// one seed gives one building whichever scheme is asked for.
function shellStyle(brief, rand) {
  return {
    north: Math.round(rand() * 8) * 45,
    facade: FACADE_KEYS[Math.floor(rand() * FACADE_KEYS.length) % FACADE_KEYS.length],
    roof: brief.storeys > 1 || rand() > 0.4 ? 'parapet' : 'gable',
    fieldEast: rand() > 0.35,
  };
}

// ---------- adjacency ----------
//
// "Put the band room away from the library" is a sentence `parseBrief` can now
// read, and this is the half that acts on it. It is deliberately a *pass over
// the finished layout* rather than a constraint threaded through the dealing:
// the schemes deal rooms into runs round-robin by kind, and teaching a
// round-robin about pairs turns one legible loop into three scheme-specific
// ones. Swapping two rooms of the same size after the fact costs nothing, is
// the same operation in every scheme, and — this is the part that
// matters — can *say whether it worked*, which a constraint buried in a
// dealing loop cannot.
//
// A swap exchanges only what a room *is*: its key, its name and the template
// it will be furnished from. Where it is, which corridor it faces and whether
// its slot has an outside wall all stay with the slot, because those are
// properties of the hole and not of the thing in it.

// What the two relations mean in feet, measured **between the rooms' edges
// rather than between their middles**. A ninety-foot gym beside a sixty-foot
// cafeteria has a hundred and thirty feet between their centres and a shared
// wall between the rooms, and only one of those two numbers is what anybody
// means by "next to". So: touching, or a corridor's width apart, is next to;
// a hundred and fifty feet of building in between is away from.
export const ADJACENT_FT = 24;
export const APART_FT = 150;
// What a storey between two rooms is worth. More than the stair is long,
// because "upstairs from" is the strongest form of "away from" a building has.
export const STOREY_FT = 40;

// Rooms whose identity is structural rather than programmatic: a stair tower
// is a stair tower because of where it is.
const UNSWAPPABLE = new Set(['stair-hall', 'lobby']);

// The clear gap between two rectangles, in feet — zero when they share a wall.
const spread = (a, b) => {
  const dx = Math.max(0, a.x0 - b.x1 - 1, b.x0 - a.x1 - 1);
  const dz = Math.max(0, a.y0 - b.y1 - 1, b.y0 - a.y1 - 1);
  return Math.hypot(dx, dz) * CELL
    + Math.abs((a.storey || 0) - (b.storey || 0)) * STOREY_FT;
};

// How far apart two kinds of room are, as the *nearest* pair. "Away from the
// library" is broken by the one band room next door to it and not satisfied by
// the other three being at the far end; "next to" is satisfied by one of them
// being there. Both are the same minimum.
export function nearestPair(A, B) {
  let best = Infinity;
  for (const a of A) {
    for (const b of B) best = Math.min(best, spread(a, b));
  }
  return best;
}

const ruleCost = (want, d) => (want === 'near'
  ? Math.max(0, d - ADJACENT_FT)
  : Math.max(0, APART_FT - d));

export function applyAdjacency(storeyRects, rules) {
  const out = [];
  if (!rules || !rules.length) return out;
  const rooms = storeyRects.flat().filter((r) => r.kind === 'room' && r.key);
  const of = (key) => rooms.filter((r) => r.key === key);
  const swap = (p, q) => {
    for (const f of ['key', 'name', 'tpl']) {
      const t = p[f]; p[f] = q[f]; q[f] = t;
    }
  };
  for (const rule of rules) {
    if (!of(rule.a).length || !of(rule.b).length) {
      out.push({ ...rule, done: false, why: 'not in this program' });
      continue;
    }
    const before = nearestPair(of(rule.a), of(rule.b));
    let cost = ruleCost(rule.want, before);
    // Move whichever kind there are fewer of: one band room is easier to place
    // than twenty classrooms, and moving the many to suit the few is how a
    // school ends up with its labs scattered.
    const moving = of(rule.a).length <= of(rule.b).length ? rule.a : rule.b;
    for (let pass = 0; pass < 4 && cost > 0; pass++) {
      let best = null;
      for (const r of of(moving)) {
        for (const slot of rooms) {
          if (slot === r || slot.key === moving) continue;
          if (slot.w !== r.w || slot.h !== r.h) continue;
          if (UNSWAPPABLE.has(slot.key) || UNSWAPPABLE.has(r.key)) continue;
          swap(r, slot);
          const c = ruleCost(rule.want, nearestPair(of(rule.a), of(rule.b)));
          swap(r, slot);
          if (c < cost - 0.5 && (!best || c < best.c)) best = { r, slot, c };
        }
      }
      if (!best) break;
      swap(best.r, best.slot);
      cost = best.c;
    }
    const after = nearestPair(of(rule.a), of(rule.b));
    // Reported whether it worked or not. A generator that quietly failed to
    // honour a sentence somebody typed is a generator you cannot trust with
    // the next one.
    out.push({ ...rule, done: cost <= 0, before, after });
  }
  return out;
}

// ---------- the courtyard ----------
//
// A ring of rooms round an open court, with the corridor loop on the inside of
// the ring so that every room has an outside wall and every corridor has the
// court to look at. The blocks take the north band, where they are deep enough
// to need it; a stair tower stands at each of the four corners, which is what
// gives this scheme four remote ways out without a single stub corridor.
//
// **The court is not a way out.** It is enclosed on all four sides, and this
// tool's outside is one node — so a door onto the court would read to
// `egressField` as a door onto the street, and a fire drill would "evacuate"
// into a sealed yard. The corridors get windows onto it and `skipExit` says
// why.

export const COURT_MIN = 8;      // cells — 32ft, the smallest court worth having
export const LOBBY_W = 5;        // cells — 20ft of entrance hall

function layoutCourtyard(program) {
  const brief = program.brief;
  const storeys = Math.min(MAX_FLOORS, Math.max(1, brief.storeys));
  const rand = rng(brief.seed);
  const sorted = sortProgram(expandProgram(program));
  const blocks = orderBlocks(sorted.blocks, brief.adjacency);
  const { spineRooms, wingRooms } = sorted;

  const bay = WING_BAY_D;
  const corr = WING_CORR_W;
  const stair = HEAD_STAIR_W;
  // The north band is as deep as the deepest block, because that is what it
  // is for; never shallower than an ordinary bay.
  const blockDepth = Math.max(bay, blocks.reduce((n, r) => Math.max(n, r.d), 0));
  const blockSpan = blocks.reduce((n, r) => n + r.w, 0);

  // Admin lines the ring with everything else — a courtyard school has no
  // spine to put a suite on, and the office wants to be beside the front door
  // rather than at the back of a wing, which is what the lobby's position
  // arranges for it.
  const rooms = [...spineRooms, ...wingRooms];
  const byStorey = dealStoreys(rooms, storeys, rand);

  // **The ring is double-loaded**, which is the one decision that makes this
  // scheme a courtyard rather than a very expensive corridor. Rooms line both
  // faces of the loop: the outer ones look out at the site, the inner ones
  // look into the court. Single-loaded, the ring's capacity grows with the
  // court's *perimeter* while its area grows with the square of it, and a
  // six-hundred-pupil school comes out with a two-hundred-foot quad and a walk
  // right round it. Double-loaded it comes out with a light court, which is
  // what the plan this is named after actually has.
  //
  //   outer band | corridor | inner band | COURT | inner | corridor | outer
  //
  // Every extra cell of court buys seven cells of run, and that ratio is the
  // whole of the sizing below.
  const ring = bay + corr + bay;             // one side of the ring, court aside
  // **Width is set by the frontage, height by the roll.** The blocks want a
  // long north face and there is only one of it, so the building's width comes
  // out of them exactly the way the spine's length does; the court is then as
  // wide as whatever is left between the two sides of the ring, and the only
  // dimension still free is how far down the sides run. A square court is not
  // worth insisting on: what makes this scheme a courtyard is the loop, and
  // insisting on the square is what turns a school with a gym in it into a
  // four-hundred-foot quad.
  // The north band has to hold every block *and* the passage through the
  // middle of it, and a block cannot straddle the passage — so the width
  // carries the widest of them as slack, which is the worst a first-fit into
  // two stretches can waste.
  const widestBlock = blocks.reduce((n, r) => Math.max(n, r.w), 0);
  const W = Math.min(LATTICE_MAX - 2 * MARGIN,
    Math.max(blockSpan + 2 * stair + PASSAGE_W + widestBlock, 2 * ring + COURT_MIN));
  const courtW = Math.max(COURT_MIN, W - 2 * ring);
  const sideOf = (h) => h + 2 * bay;         // the ring's own north-south run
  const heightOf = (h) => blockDepth + corr + sideOf(h) + corr + bay;
  const perStorey = Math.ceil(rooms.length / storeys);
  const demand = rooms.slice(0, perStorey).reduce((n, r) => n + r.w, 0);
  // Every extra cell down the sides buys four cells of run — one on each face
  // of the two side corridors — and the north and south bands are already as
  // long as they are going to get.
  const fixed = 2 * courtW + (W - 2 * stair - PASSAGE_W) - LOBBY_W;
  let court = Math.max(COURT_MIN, Math.ceil((demand - fixed) / 4) - 2 * bay);
  const courtCap = Math.max(COURT_MIN,
    LATTICE_MAX - 2 * MARGIN - (blockDepth + 2 * corr + 3 * bay));
  court = Math.min(court, courtCap);

  const x0 = MARGIN;
  const y0 = MARGIN;
  const runsFor = (c, storey) => {
    const H = heightOf(c);
    const top = y0 + blockDepth + corr;       // the first row of the ring's sides
    const bottom = y0 + H - bay - corr - 1;   // ...and the last
    const L = bottom - top + 1;
    const list = [];
    // Upstairs the blocks are not there — a gym with a classroom over it is a
    // floor with nothing under it for eighty feet — so the north band becomes
    // a run like any other, pushed against the corridor so that it stays
    // inside the footprint below.
    const half = Math.floor((W - 2 * stair - PASSAGE_W) / 2);
    const gate = x0 + stair + half;          // where the passage cuts the band
    if (storey > 0) {
      list.push(makeRun('north-w', {
        axis: 'x', x0: x0 + stair, y0: y0 + blockDepth - bay, depth: bay,
        cap: half, door: 's',
      }));
      list.push(makeRun('north-e', {
        axis: 'x', x0: gate + PASSAGE_W, y0: y0 + blockDepth - bay, depth: bay,
        cap: W - 2 * stair - half - PASSAGE_W, door: 's',
      }));
    }
    list.push(makeRun('north-court', {
      axis: 'x', x0: x0 + ring, y0: top, depth: bay,
      cap: courtW, door: 'n', skipExit: ['s'],
    }));
    list.push(makeRun('south-court', {
      axis: 'x', x0: x0 + ring, y0: bottom - bay + 1, depth: bay,
      cap: courtW, door: 's', skipExit: ['n'],
    }));
    list.push(makeRun('south-w', {
      axis: 'x', x0: x0 + stair, y0: y0 + H - bay, depth: bay,
      cap: half, door: 'n',
    }));
    list.push(makeRun('south-e', {
      axis: 'x', x0: gate + PASSAGE_W, y0: y0 + H - bay, depth: bay,
      cap: W - 2 * stair - half - PASSAGE_W, door: 'n',
    }));
    list.push(makeRun('west', {
      axis: 'y', x0, y0: top + LOBBY_W, depth: bay,
      cap: L - LOBBY_W, door: 'e',
    }));
    list.push(makeRun('west-court', {
      axis: 'y', x0: x0 + bay + corr, y0: top, depth: bay,
      cap: L, door: 'w', skipExit: ['e'],
    }));
    list.push(makeRun('east', {
      axis: 'y', x0: x0 + W - bay, y0: top, depth: bay,
      cap: L, door: 'w',
    }));
    list.push(makeRun('east-court', {
      axis: 'y', x0: x0 + W - ring, y0: top, depth: bay,
      cap: L, door: 'e', skipExit: ['w'],
    }));
    return list;
  };

  const packed = packRuns(byStorey, runsFor, court, Math.max(court, courtCap));
  court = packed.len;
  const fillers = fillRuns(packed.plans);
  numberRooms(packed.plans);

  const H = heightOf(court);
  const top = y0 + blockDepth + corr;
  const side = sideOf(court);
  // A block that will not fit the north band, if it comes to that. Reported
  // rather than dropped: a school that quietly lost its library is exactly
  // what the spine's `unplaced` list exists to prevent.
  const leftover = [];
  const oversize = packed.unplaced.length > 0
    || x0 + W + MARGIN > LATTICE_MAX || y0 + H + MARGIN > LATTICE_MAX;
  const footprint = {
    w: Math.min(LATTICE_MAX, x0 + W + MARGIN),
    h: Math.min(LATTICE_MAX, y0 + H + MARGIN),
  };

  // --- the ring, drawn once and repeated on every storey ---
  const ringFor = (storey) => {
    const out = [];
    const halls = [
      ['NW', x0, y0, x0 + stair - 1, y0 + blockDepth - 1, 's'],
      ['NE', x0 + W - stair, y0, x0 + W - 1, y0 + blockDepth - 1, 's'],
      ['SW', x0, y0 + H - bay, x0 + stair - 1, y0 + H - 1, 'n'],
      ['SE', x0 + W - stair, y0 + H - bay, x0 + W - 1, y0 + H - 1, 'n'],
    ];
    for (const [name, ax, ay, bx, by, door] of halls) {
      out.push(rect('room', ax, ay, bx, by, {
        key: 'stair-hall', name: `${name} Stair`, color: '#dcd7cc', fin: 'terrazzo',
        storey, stairHall: true, door, daylight: true, corner: name,
      }));
    }
    out.push(...splitCorridor(rect('corridor', x0, y0 + blockDepth, x0 + W - 1, y0 + blockDepth + corr - 1, {
      key: 'ring-n', name: 'North Hall', color: '#e9e4da', fin: 'terrazzo',
      tpl: 'locker-hallway', storey,
    }), 'x'));
    out.push(...splitCorridor(rect('corridor', x0, y0 + H - bay - corr, x0 + W - 1, y0 + H - bay - 1, {
      key: 'ring-s', name: 'South Hall', color: '#e9e4da', fin: 'terrazzo',
      tpl: 'locker-hallway', storey,
    }), 'x'));
    // The two sides of the loop, each opening into the halls at both ends of
    // it across the full width of the junction. A corridor that merely merged
    // into another would be one room to `floodRegion`, and a ring left whole
    // is a single four-hundred-foot "room" with every trip in the building
    // routed through wherever its middle happened to land.
    // The two ways through the outer bands, north and south, so that the
    // middle of a four-hundred-foot band is not a two-hundred-foot walk to the
    // nearest corner tower. On the ground floor the north band is blocks and
    // the passage runs between two of them.
    const half = Math.floor((W - 2 * stair - PASSAGE_W) / 2);
    const gate = x0 + stair + half;
    out.push(passage('pass-s', 'South Exit Hall', gate, y0 + H - bay, gate + PASSAGE_W - 1, y0 + H - 1, storey, ['n']));
    out.push(passage('pass-n', 'North Exit Hall', gate, y0 + blockDepth - bay, gate + PASSAGE_W - 1, y0 + blockDepth - 1, storey, ['s']));
    for (const [key, cx, name] of [
      ['ring-w', x0 + bay, 'West Hall'],
      ['ring-e', x0 + W - bay - corr, 'East Hall'],
    ]) {
      out.push(...splitCorridor(rect('corridor', cx, top, cx + corr - 1, top + side - 1, {
        key, name, color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway', storey,
        door: ['n', 's'], doorKind: 'opening', doorFull: true,
      }), 'z'));
    }
    return out;
  };

  const storeyRects = [];
  for (let s = 0; s < storeys; s++) {
    const list = ringFor(s);
    if (s === 0) {
      // The blocks, left to right along the north band, each the full depth of
      // it, fronting the north hall — in the two stretches the north passage
      // leaves, so that the way out through the middle stays a way out.
      const half = Math.floor((W - 2 * stair - PASSAGE_W) / 2);
      const gate = x0 + stair + half;
      const stretches = [
        { at: x0 + stair, end: gate - 1 },
        { at: gate + PASSAGE_W, end: x0 + W - stair - 1 },
      ];
      for (const b of blocks) {
        const at = stretches.find((st) => st.at + b.w - 1 <= st.end);
        if (!at) { leftover.push(b); continue; }
        list.push(rect('room', at.at, y0, at.at + b.w - 1, y0 + blockDepth - 1, {
          key: b.key, name: b.base, tpl: b.tpl, door: 's', storey: 0,
          daylight: b.key !== 'kitchen',
        }));
        at.at += b.w;
      }
      // Whatever the blocks left of the north band, so the band is solid.
      for (const st of stretches) {
        const spare = st.end - st.at + 1;
        if (spare <= 0) continue;
        list.push(rect('room', st.at, y0, st.end, y0 + blockDepth - 1, {
          key: spare >= 5 ? 'flex' : 'storage',
          name: spare >= 5 ? 'Flex Room' : 'Storeroom',
          door: 's', storey: 0, daylight: true,
        }));
      }
    }
    // The entrance hall, at the north end of the west band, where the buses
    // come in — which is the one thing about the site that every scheme has to
    // agree on, since `buildSite` puts the loop west of the building.
    list.push(rect('room', x0, top, x0 + bay - 1, top + LOBBY_W - 1, {
      key: 'lobby', name: s === 0 ? 'Entrance Hall' : `${floorWord(s)} Lobby`,
      color: '#e9e4da', fin: 'terrazzo', door: 'e', storey: s, daylight: true,
    }));
    for (const run of packed.plans[s]) list.push(...runRects(run, s));
    storeyRects.push(list.map((r) => ({ ...r, storey: s })));
  }

  // "Put the band room away from the library", acted on before anything is
  // counted, so the occupant loads and the stair widths below are the ones the
  // building actually has.
  const adjacency = applyAdjacency(storeyRects, brief.adjacency);

  const storeyOcc = storeyRects.map((list) => list
    .filter((r) => r.kind === 'room')
    .reduce((n, r) => n + roomOccupancy({
      name: r.name, area: r.w * r.h * CELL * CELL,
    }).occ, 0));
  const upperOcc = storeyOcc.slice(1).reduce((a, b) => a + b, 0);

  // A stair in each corner tower, and one lift beside whichever of them the
  // seed picked. The runs climb north–south, because a corner tower is deeper
  // than it is wide and a 19ft run plus two landings has to lie down somewhere.
  const stairW = storeys > 1
    ? Math.min(MAX_STAIR_W, Math.max(MIN_STAIR_W + 1,
      Math.ceil((upperOcc * STAIR_IN_PER_OCC) / 12 / 6 * 2) / 2))
    : MIN_STAIR_W + 1;
  const links = [];
  const liftCorner = Math.floor(rand() * 4) % 4;
  const gate = x0 + stair + Math.floor((W - 2 * stair - PASSAGE_W) / 2);
  const towers = [
    { x: x0 + stair / 2, y: y0 + blockDepth / 2, down: true },
    { x: x0 + W - stair / 2, y: y0 + blockDepth / 2, down: true },
    { x: x0 + stair / 2, y: y0 + H - bay / 2, down: false },
    { x: x0 + W - stair / 2, y: y0 + H - bay / 2, down: false },
    // ...and one in each exit passage, halfway along the two long bands.
    { x: gate + PASSAGE_W / 2, y: y0 + blockDepth - bay / 2, down: true, plain: true },
    { x: gate + PASSAGE_W / 2, y: y0 + H - bay / 2, down: false, plain: true },
  ];
  for (let s = 0; s + 1 < storeys; s++) {
    towers.forEach((t, i) => {
      const cx = t.x * CELL;
      const cz = t.y * CELL;
      links.push({
        type: 'stair', from: s,
        x: t.plain ? cx : cx - 4, z: t.down ? cz - 11 : cz + 11,
        rotationY: t.down ? 0 : Math.PI,
        width: Math.min(stairW, (t.plain ? PASSAGE_W : stair) * CELL - 10),
      });
      if (i === liftCorner) {
        links.push({
          type: 'elevator', from: s,
          x: cx + 7, z: cz,
          rotationY: t.down ? 0 : Math.PI,
        });
      }
    });
  }

  // The front door, through the entrance hall. Every other way out is a corner
  // tower, and `cutShellExits` finds those once the walls are standing.
  const exits = [
    { edge: 'w', x: x0, y: top + Math.floor(LOBBY_W / 2), kind: EDGE_DOOR2, main: true },
  ];

  return {
    program,
    brief,
    scheme: 'courtyard',
    storeys,
    wings: 4,
    court: { x0: x0 + ring, y0: top + bay, w: courtW, h: court },
    envelope: { x0, y0, x1: x0 + W, y1: y0 + H },
    footprint,
    rects: storeyRects,
    storeyOcc,
    upperOcc,
    stairW,
    links,
    exits,
    unplaced: [...packed.unplaced, ...leftover],
    fillers,
    adjacency,
    oversize: oversize || leftover.length > 0,
    entry: { x: x0 * CELL, z: (top + LOBBY_W / 2) * CELL },
    style: shellStyle(brief, rand),
  };
}

// ---------- the compact block ----------
//
// One deep rectangle. Two corridors run its length with three bands of rooms
// between and either side of them, a hall crosses at each end joining the two,
// and the blocks take the north face where they can be as deep as they like.
// It is the shortest walk and the smallest footprint of the three, and the
// middle band's rooms have no outside wall at all — which is a real trade a
// real school makes, and which the daylight section of the report will say out
// loud rather than this file pretending otherwise.

export const CROSS_W = 6;        // cells — 24ft of end hall, wide enough to hold a stair

function layoutCompact(program) {
  const brief = program.brief;
  const storeys = Math.min(MAX_FLOORS, Math.max(1, brief.storeys));
  const rand = rng(brief.seed);
  const sorted = sortProgram(expandProgram(program));
  const blocks = orderBlocks(sorted.blocks, brief.adjacency);
  const { spineRooms, wingRooms } = sorted;

  const bay = WING_BAY_D;
  const corr = WING_CORR_W;
  const stairD = STAIR_HALL_D;
  const blockDepth = Math.max(bay, blocks.reduce((n, r) => Math.max(n, r.d), 0));
  const blockSpan = blocks.reduce((n, r) => n + r.w, 0);

  const rooms = [...spineRooms, ...wingRooms];
  const byStorey = dealStoreys(rooms, storeys, rand);

  // Depth is fixed by the section — block band, corridor, two bays back to
  // back, corridor, bay — and only the length is free. Four runs to a storey
  // and no light court to pay for, which is what makes this the smallest
  // footprint of the three and the one whose middle band never sees a window.
  const depth = blockDepth + corr + bay + bay + corr + bay;
  const perStorey = Math.ceil(rooms.length / storeys);
  const demand = rooms.slice(0, perStorey).reduce((n, r) => n + r.w, 0);

  // **How often it is cut through.** A compact block long enough to hold a
  // gym is four hundred feet long, and a four-hundred-foot block with its
  // only ways out at the ends is a travel-distance failure in the report and
  // a building nobody would be allowed to build. So a cross hall runs the
  // whole depth every hundred feet or so: through the north band to the
  // street, across between the two main corridors, and out through the south
  // band to the street again. Segments of the bands sit between them.
  const segCap = (n) => Math.floor(
    (LATTICE_MAX - 2 * MARGIN - 2 * CROSS_W - n * CROSS_W) / (n + 1));
  const widestBlock = blocks.reduce((n, r) => Math.max(n, r.w), 0);
  let crosses = 0;
  let seg = 0;
  for (; crosses <= 6; crosses++) {
    seg = Math.max(6,
      Math.ceil(demand / (3 * (crosses + 1))),
      // The blocks are dealt into the stretches between the cross halls and
      // none of them may straddle one, so every cross costs the row the widest
      // block as slack. Without this the library quietly fell off the end.
      Math.ceil((blockSpan + crosses * widestBlock) / (crosses + 1)));
    if (seg <= CORRIDOR_SEG || seg >= segCap(crosses)) break;
  }
  const segMax = Math.max(6, segCap(crosses));

  const x0 = MARGIN;
  const y0 = MARGIN;
  const bandX = x0 + CROSS_W;
  const rowA = y0;                                  // block band (rooms upstairs)
  const rowC1 = y0 + blockDepth;                    // corridor one
  const rowB = rowC1 + corr;                        // the inner pair, back to back
  const rowC2 = rowB + 2 * bay;                     // corridor two
  const rowD = rowC2 + corr;                        // the south band
  const segAt = (n, i) => bandX + i * (n + CROSS_W);
  const crossAt = (n, i) => segAt(n, i) + n;
  const lenOf = (n) => (crosses + 1) * n + crosses * CROSS_W;

  const runsFor = (n, storey) => {
    const list = [];
    for (let i = 0; i <= crosses; i++) {
      const at = segAt(n, i);
      if (storey > 0) {
        list.push(makeRun(`north-${i}`, {
          axis: 'x', x0: at, y0: rowC1 - bay, depth: bay, cap: n, door: 's',
        }));
      }
      list.push(makeRun(`inner-n-${i}`, {
        axis: 'x', x0: at, y0: rowB, depth: bay, cap: n, door: 'n', daylight: false,
      }));
      list.push(makeRun(`inner-s-${i}`, {
        axis: 'x', x0: at, y0: rowB + bay, depth: bay, cap: n, door: 's', daylight: false,
      }));
      list.push(makeRun(`south-${i}`, {
        axis: 'x', x0: at, y0: rowD, depth: bay, cap: n, door: 'n',
      }));
    }
    return list;
  };

  const packed = packRuns(byStorey, runsFor, Math.min(seg, segMax), segMax);
  seg = packed.len;
  const fillers = fillRuns(packed.plans);
  numberRooms(packed.plans);

  const len = lenOf(seg);
  const W = len + 2 * CROSS_W;
  const leftover = [];
  const oversize = packed.unplaced.length > 0
    || x0 + W + MARGIN > LATTICE_MAX || y0 + depth + MARGIN > LATTICE_MAX;
  const footprint = {
    w: Math.min(LATTICE_MAX, x0 + W + MARGIN),
    h: Math.min(LATTICE_MAX, y0 + depth + MARGIN),
  };

  const shellFor = (storey) => {
    const out = [];
    for (const [side, hx] of [['W', x0], ['E', x0 + W - CROSS_W]]) {
      out.push(rect('room', hx, y0, hx + CROSS_W - 1, y0 + stairD - 1, {
        key: 'stair-hall', name: `${side} Stair N`, color: '#dcd7cc', fin: 'terrazzo',
        storey, stairHall: true, door: 's', daylight: true,
      }));
      out.push(rect('room', hx, y0 + depth - stairD, hx + CROSS_W - 1, y0 + depth - 1, {
        key: 'stair-hall', name: `${side} Stair S`, color: '#dcd7cc', fin: 'terrazzo',
        storey, stairHall: true, door: 'n', daylight: true,
      }));
      out.push(...splitCorridor(rect('corridor', hx, y0 + stairD, hx + CROSS_W - 1, y0 + depth - stairD - 1, {
        key: `cross-${side}`, name: `${side === 'W' ? 'West' : 'East'} Hall`,
        color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway', storey,
      }), 'z'));
    }
    for (const [key, row, name] of [['hall-1', rowC1, 'Main Hall'], ['hall-2', rowC2, 'South Hall']]) {
      out.push(...splitCorridor(rect('corridor', bandX, row, bandX + len - 1, row + corr - 1, {
        key, name: storey === 0 ? name : `${floorWord(storey)} ${name}`,
        color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway', storey,
        // Both ends open across the whole width into the end halls, which is
        // the junction this scheme is built out of.
        door: ['w', 'e'], doorKind: 'opening', doorFull: true,
      }), 'x'));
    }
    // The cross halls, in three pieces because a rectangle cannot cross a
    // corridor without being drawn on top of it: north band to the street,
    // between the two main corridors, and south band to the street.
    for (let i = 0; i < crosses; i++) {
      const cx = crossAt(seg, i);
      const cx1 = cx + CROSS_W - 1;
      out.push(passage(`cross-n-${i}`, `North Exit Hall ${i + 1}`, cx, rowA, cx1, rowC1 - 1, storey, ['s']));
      out.push(passage(`cross-m-${i}`, `Cross Hall ${i + 1}`, cx, rowB, cx1, rowC2 - 1, storey, ['n', 's']));
      out.push(passage(`cross-s-${i}`, `South Exit Hall ${i + 1}`, cx, rowD, cx1, y0 + depth - 1, storey, ['n']));
    }
    return out;
  };

  const storeyRects = [];
  for (let s = 0; s < storeys; s++) {
    const list = shellFor(s);
    if (s === 0) {
      // The blocks take the whole north band, dealt into the stretches the
      // cross halls leave between them — first stretch that will hold the
      // thing, which is the same rule the runs use and for the same reason.
      const stretches = [];
      for (let i = 0; i <= crosses; i++) {
        stretches.push({ at: segAt(seg, i), end: segAt(seg, i) + seg - 1 });
      }
      for (const b of blocks) {
        const at = stretches.find((st) => st.at + b.w - 1 <= st.end);
        if (!at) { leftover.push(b); continue; }
        list.push(rect('room', at.at, rowA, at.at + b.w - 1, rowC1 - 1, {
          key: b.key, name: b.base, tpl: b.tpl, door: 's', storey: 0,
          daylight: b.key !== 'kitchen',
        }));
        at.at += b.w;
      }
      for (const st of stretches) {
        const spare = st.end - st.at + 1;
        if (spare <= 0) continue;
        list.push(rect('room', st.at, rowA, st.end, rowC1 - 1, {
          key: spare >= 5 ? 'flex' : 'storage',
          name: spare >= 5 ? 'Flex Room' : 'Storeroom',
          door: 's', storey: 0, daylight: true,
        }));
      }
    }
    for (const run of packed.plans[s]) list.push(...runRects(run, s));
    storeyRects.push(list.map((r) => ({ ...r, storey: s })));
  }

  // "Put the band room away from the library", acted on before anything is
  // counted, so the occupant loads and the stair widths below are the ones the
  // building actually has.
  const adjacency = applyAdjacency(storeyRects, brief.adjacency);

  const storeyOcc = storeyRects.map((list) => list
    .filter((r) => r.kind === 'room')
    .reduce((n, r) => n + roomOccupancy({
      name: r.name, area: r.w * r.h * CELL * CELL,
    }).occ, 0));
  const upperOcc = storeyOcc.slice(1).reduce((a, b) => a + b, 0);

  // A stair in each corner tower *and* one in every cross hall. The towers
  // alone would leave the middle of an upper storey a two-hundred-foot walk
  // from anything that goes down, which is the same failure the cross halls
  // fix on the ground and the same fix.
  const towerCount = 4 + crosses;
  const stairW = storeys > 1
    ? Math.min(MAX_STAIR_W, Math.max(MIN_STAIR_W + 1,
      Math.ceil((upperOcc * STAIR_IN_PER_OCC) / 12 / towerCount * 2) / 2))
    : MIN_STAIR_W + 1;
  const links = [];
  const liftTower = Math.floor(rand() * 4) % 4;
  const towers = [
    { x: x0 + CROSS_W / 2, y: y0 + stairD / 2, down: true },
    { x: x0 + W - CROSS_W / 2, y: y0 + stairD / 2, down: true },
    { x: x0 + CROSS_W / 2, y: y0 + depth - stairD / 2, down: false },
    { x: x0 + W - CROSS_W / 2, y: y0 + depth - stairD / 2, down: false },
  ];
  for (let s = 0; s + 1 < storeys; s++) {
    towers.forEach((t, i) => {
      const cx = t.x * CELL;
      const cz = t.y * CELL;
      // The run and the car stand *beside* each other across the tower's
      // width, not one behind the other along its depth: a 19ft run and an
      // 8ft car in line need forty feet of hall and the tower has thirty-two.
      links.push({
        type: 'stair', from: s,
        x: cx - 6, z: t.down ? cz - 11 : cz + 11,
        rotationY: t.down ? 0 : Math.PI,
        width: Math.min(stairW, CROSS_W * CELL / 2 - 2),
      });
      if (i === liftTower) {
        links.push({
          type: 'elevator', from: s,
          x: cx + 7, z: cz,
          rotationY: t.down ? 0 : Math.PI,
        });
      }
    });
    // ...and one in the middle of every cross hall, which is what keeps an
    // upper storey's walk to a stair the same length as the ground floor's
    // walk to a door.
    for (let i = 0; i < crosses; i++) {
      links.push({
        type: 'stair', from: s,
        x: (crossAt(seg, i) + CROSS_W / 2) * CELL - 6,
        z: (rowB + bay) * CELL - 11,
        rotationY: 0,
        width: Math.min(stairW, CROSS_W * CELL / 2 - 2),
      });
    }
  }

  const entryY = y0 + Math.floor(depth / 2);
  const exits = [
    { edge: 'w', x: x0, y: entryY, kind: EDGE_DOOR2, main: true },
    { edge: 'e', x: x0 + W, y: entryY, kind: EDGE_DOOR2 },
  ];

  return {
    program,
    brief,
    scheme: 'compact',
    storeys,
    wings: crosses + 1,
    bandLen: len,
    crosses,
    envelope: { x0, y0, x1: x0 + W, y1: y0 + depth },
    footprint,
    rects: storeyRects,
    storeyOcc,
    upperOcc,
    stairW,
    links,
    exits,
    unplaced: [...packed.unplaced, ...leftover],
    fillers,
    adjacency,
    oversize: oversize || leftover.length > 0,
    entry: { x: x0 * CELL, z: entryY * CELL },
    style: shellStyle(brief, rand),
  };
}

// ---------- the campus ----------
//
// The fourth scheme, and the interesting one: **the first where the building
// is not one connected thing.**
//
// Everything before this laid one figure on the lattice — a spine with wings
// hanging off it, a ring round a court, one deep block — and every room in it
// could be walked to from every other without going outside. That was never a
// rule anybody wrote down; it was a consequence of `navgraph.js` flattening
// the outdoors into a single node, which made a route between two blocks a
// forty-five-foot lie in each direction and a covered walk a thing the model
// had no way to measure. Phase 17 meshes the site, so a walk between two
// buildings is a route over real ground, and this scheme is what that buys.
//
// The arrangement is the one a warm-climate district actually builds: a front
// building holding everything the public comes for — admin at the street, the
// gym, cafeteria, kitchen and library behind it — then a quadrangle, then a
// row of teaching pavilions across the back, each a double-loaded bar with a
// stair hall at each end. The walks between them are concrete on the plan and
// tiles on the site mesh, which is the same thing said twice.
//
// The contract is unchanged, which was the point of stating it in Phase 8:
// `rects`, `links`, `exits`, `footprint`, `entry`, `envelope` and `style`, and
// one optional addition — `walks`, the paving this scheme wants laid between
// its buildings, which `buildSite` reads and every other scheme leaves empty.

// How far apart two buildings stand. Forty feet is a fire lane, a covered walk
// and the width the site mesh needs to keep a tile in the gap once the walls
// either side of it have taken their clearance.
export const PAV_GAP = 10;       // cells — 40ft
// The quadrangle between the front building and the teaching row.
export const QUAD_D = 12;        // cells — 48ft
// The covered walk along a building's face.
export const WALK_D = 4;         // cells — 16ft
// A pavilion longer than this is a corridor scheme wearing a campus's clothes.
export const PAV_MAX_LEN = 30;   // cells — 120ft of run
export const MAX_PAVILIONS = 12;

function layoutCampus(program) {
  const brief = program.brief;
  const storeys = Math.min(MAX_FLOORS, Math.max(1, brief.storeys));
  const rand = rng(brief.seed);
  const sorted = sortProgram(expandProgram(program));
  const blocks = orderBlocks(sorted.blocks, brief.adjacency);
  const { spineRooms, wingRooms } = sorted;

  const bay = WING_BAY_D;
  const corr = WING_CORR_W;
  const stair = CROSS_W;
  const adminD = SPINE_BAY_D;
  const blockDepth = Math.max(bay, blocks.reduce((n, r) => Math.max(n, r.d), 0));
  const blockSpan = blocks.reduce((n, r) => n + r.w, 0);
  const adminSpan = spineRooms.reduce((n, r) => n + r.w, 0);

  // Only the teaching rooms are dealt across the storeys. The front building
  // is one storey by construction — a gym is one storey whatever the brief
  // says, and admin sits at the door because that is what it is for — so the
  // upper storeys of a campus are pavilions and nothing else, which is also
  // what keeps every one of them standing on the one below.
  const byStorey = dealStoreys(wingRooms, storeys, rand);
  const widest = wingRooms.reduce((n, r) => Math.max(n, r.w), 1);
  const perStorey = Math.ceil(wingRooms.length / storeys);
  const demand = wingRooms.slice(0, perStorey).reduce((n, r) => n + r.w, 0);

  // The front building, sized by whichever of its two bands is longer.
  const commonsW = Math.max(12, blockSpan, adminSpan);
  const commonsH = adminD + corr + blockDepth;

  // How many pavilions. Each offers two runs a storey, so the count is the
  // smallest that keeps a run under a hundred and twenty feet — past that a
  // pavilion is a wing and this is the spine scheme with gaps in it.
  const lenFor = (n) => Math.min(PAV_MAX_LEN,
    Math.max(widest, Math.ceil(demand / (2 * n))));
  let pavs = Math.min(MAX_PAVILIONS,
    Math.max(2, Math.ceil(demand / (2 * PAV_MAX_LEN))));
  const pavDepth = 2 * bay + corr;
  const pavW = (n) => 2 * stair + n;
  // ...laid out in as many rows as it takes. A campus that would not fit
  // across the lattice in one row does not get shorter pavilions, it gets a
  // second row of them: the lattice is square, the front building and one row
  // use a third of its depth, and a school of eight pavilions in two rows is a
  // real arrangement where eight in a line eight hundred feet long is not.
  const perRow = (n) => Math.max(1, Math.floor(
    (LATTICE_MAX - 2 * MARGIN + PAV_GAP) / (pavW(n) + PAV_GAP)));
  const rowsOf = (n) => Math.ceil(pavs / perRow(n));

  const x0 = MARGIN;
  const y0 = MARGIN;
  const rowAdmin = y0;
  const rowCCorr = y0 + adminD;
  const rowBlock = rowCCorr + corr;
  const quadY0 = y0 + commonsH;
  const pavY0 = quadY0 + QUAD_D;
  // Where pavilion `i` sits: along the row until the row is full, then the
  // next row down.
  const pavAt = (n, i) => {
    const per = perRow(n);
    return {
      x: x0 + (i % per) * (pavW(n) + PAV_GAP),
      y: pavY0 + Math.floor(i / per) * (pavDepth + PAV_GAP),
    };
  };

  const runsFor = (n, storey) => {
    const list = [];
    for (let i = 0; i < pavs; i++) {
      const at = pavAt(n, i);
      list.push(makeRun(`pav-${i}-n`, {
        axis: 'x', x0: at.x + stair, y0: at.y, depth: bay, cap: n, door: 's',
      }));
      list.push(makeRun(`pav-${i}-s`, {
        axis: 'x', x0: at.x + stair, y0: at.y + bay + corr, depth: bay, cap: n, door: 'n',
      }));
    }
    return list;
  };

  // Pack, and if anything is left over add a pavilion and pack again. The
  // other three schemes grow a corridor when the rooms don't fit; this one
  // grows a *building*, which is the one lever a campus has and the reason the
  // estimate above only has to be close.
  let packed = packRuns(byStorey, runsFor, lenFor(pavs), PAV_MAX_LEN);
  while (packed.unplaced.length && pavs < MAX_PAVILIONS) {
    pavs++;
    packed = packRuns(byStorey, runsFor, lenFor(pavs), PAV_MAX_LEN);
  }
  const len = packed.len;
  const fillers = fillRuns(packed.plans);
  numberRooms(packed.plans);

  const rows = rowsOf(len);
  const rowW = Math.min(pavs, perRow(len)) * pavW(len)
    + (Math.min(pavs, perRow(len)) - 1) * PAV_GAP;
  const W = Math.max(commonsW, rowW);
  const H = commonsH + QUAD_D + rows * pavDepth + (rows - 1) * PAV_GAP;
  const leftover = [];
  const oversize = packed.unplaced.length > 0
    || x0 + W + MARGIN > LATTICE_MAX || y0 + H + MARGIN > LATTICE_MAX;
  const footprint = {
    w: Math.min(LATTICE_MAX, x0 + W + MARGIN),
    h: Math.min(LATTICE_MAX, y0 + H + MARGIN),
  };

  // One pavilion: a stair hall at each end and a double-loaded corridor
  // between them. Nothing joins it to the pavilion beside it, which is the
  // whole scheme in one sentence.
  const pavilionShell = (i, n, storey) => {
    const out = [];
    const at = pavAt(n, i);
    const px = at.x;
    const name = pavilionName(i);
    for (const [side, hx] of [['W', px], ['E', px + pavW(n) - stair]]) {
      out.push(rect('room', hx, at.y, hx + stair - 1, at.y + pavDepth - 1, {
        key: 'stair-hall', name: `${name} ${side === 'W' ? 'West' : 'East'} Stair`,
        color: '#dcd7cc', fin: 'terrazzo', storey, stairHall: true, daylight: true,
      }));
    }
    out.push(...splitCorridor(rect('corridor', px + stair, at.y + bay,
      px + pavW(n) - stair - 1, at.y + bay + corr - 1, {
        key: `pav-hall-${i}`,
        name: storey === 0 ? `${name} Hall` : `${floorWord(storey)} ${name} Hall`,
        color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway', storey,
        // Full-width openings into the stair hall at each end, which is how a
        // pavilion is entered and how it is left.
        door: ['w', 'e'], doorKind: 'opening', doorFull: true,
      }), 'x'));
    return out;
  };

  const commonsShell = () => {
    const out = [];
    out.push(...splitCorridor(rect('corridor', x0, rowCCorr, x0 + commonsW - 1, rowCCorr + corr - 1, {
      key: 'commons-hall', name: 'Main Hall',
      color: '#e9e4da', fin: 'terrazzo', tpl: 'locker-hallway', storey: 0,
    }), 'x'));
    // Admin at the street, north of the hall...
    let at = x0;
    for (const r of spineRooms) {
      if (at + r.w - 1 > x0 + commonsW - 1) { leftover.push(r); continue; }
      out.push(rect('room', at, rowAdmin, at + r.w - 1, rowCCorr - 1, {
        key: r.key, name: r.base, tpl: r.tpl, door: 's', storey: 0, daylight: true,
      }));
      at += r.w;
    }
    if (x0 + commonsW - at >= 3) {
      out.push(rect('room', at, rowAdmin, x0 + commonsW - 1, rowCCorr - 1, {
        key: 'flex', name: 'Flex Room', door: 's', storey: 0, daylight: true,
      }));
    }
    // ...and the big rooms behind it, facing the quad.
    at = x0;
    for (const b of blocks) {
      if (at + b.w - 1 > x0 + commonsW - 1) { leftover.push(b); continue; }
      out.push(rect('room', at, rowBlock, at + b.w - 1, rowBlock + blockDepth - 1, {
        key: b.key, name: b.base, tpl: b.tpl, door: 'n', storey: 0,
        daylight: b.key !== 'kitchen',
      }));
      at += b.w;
    }
    if (x0 + commonsW - at >= 3) {
      out.push(rect('room', at, rowBlock, x0 + commonsW - 1, rowBlock + blockDepth - 1, {
        key: 'flex', name: 'Flex Room', door: 'n', storey: 0, daylight: true,
      }));
    }
    return out;
  };

  const storeyRects = [];
  for (let s = 0; s < storeys; s++) {
    const list = [];
    if (s === 0) list.push(...commonsShell());
    for (let i = 0; i < pavs; i++) list.push(...pavilionShell(i, len, s));
    for (const run of packed.plans[s]) list.push(...runRects(run, s));
    storeyRects.push(list.map((r) => ({ ...r, storey: s })));
  }

  const adjacency = applyAdjacency(storeyRects, brief.adjacency);

  const storeyOcc = storeyRects.map((list) => list
    .filter((r) => r.kind === 'room')
    .reduce((n, r) => n + roomOccupancy({
      name: r.name, area: r.w * r.h * CELL * CELL,
    }).occ, 0));
  const upperOcc = storeyOcc.slice(1).reduce((a, b) => a + b, 0);

  // Two stairs to a pavilion, one in each end hall — which for a campus is not
  // a redundancy argument but a geometry one: a pavilion is its own building,
  // so an upper storey with one stair in it has one way down full stop.
  const towerCount = pavs * 2;
  const stairW = storeys > 1
    ? Math.min(MAX_STAIR_W, Math.max(MIN_STAIR_W + 1,
      Math.ceil((upperOcc * STAIR_IN_PER_OCC) / 12 / towerCount * 2) / 2))
    : MIN_STAIR_W + 1;
  const links = [];
  const liftPav = Math.floor(rand() * pavs) % pavs;
  for (let s = 0; s + 1 < storeys; s++) {
    for (let i = 0; i < pavs; i++) {
      const at = pavAt(len, i);
      for (const [side, hx] of [['W', at.x], ['E', at.x + pavW(len) - stair]]) {
        const cx = (hx + stair / 2) * CELL;
        const cz = (at.y + pavDepth / 2) * CELL;
        links.push({
          type: 'stair', from: s, x: cx - 6, z: cz - 11, rotationY: 0,
          width: Math.min(stairW, stair * CELL / 2 - 2),
        });
        if (i === liftPav && side === 'W') {
          links.push({ type: 'elevator', from: s, x: cx + 7, z: cz + 8, rotationY: 0 });
        }
      }
    }
  }

  // The front door is the front building's, at the street end of its hall.
  // Everything else the shell wants is cut once the walls are standing —
  // every pavilion has four exposed faces, which is the one thing a campus is
  // never short of.
  const exits = [
    { edge: 'w', x: x0, y: rowCCorr + 1, kind: EDGE_DOOR2, main: true },
    { edge: 'e', x: x0 + commonsW, y: rowCCorr + 1, kind: EDGE_DOOR2 },
  ];

  // The paving between the buildings: along the quad face of the front
  // building, along the north face of the teaching row, and one link down the
  // middle joining the two. On the plan it is concrete; on the site mesh it is
  // the ground a route between two blocks is measured over, and it is what
  // tells `publicWay` which edge of the site is a way off it.
  const midX = x0 + Math.floor(W / 2) - Math.floor(WALK_D / 2);
  const walks = [
    { x0, y0: quadY0, x1: x0 + W - 1, y1: quadY0 + WALK_D - 1, name: 'Quad walk' },
  ];
  for (let r = 0; r < rows; r++) {
    const top = pavY0 + r * (pavDepth + PAV_GAP);
    walks.push({
      x0, y0: top - WALK_D, x1: x0 + W - 1, y1: top - 1,
      name: r ? `Pavilion walk ${r + 1}` : 'Pavilion walk',
    });
  }
  walks.push({
    x0: midX, y0: quadY0, x1: midX + WALK_D - 1,
    y1: pavY0 + (rows - 1) * (pavDepth + PAV_GAP) - 1, name: 'Quad crossing',
  });

  return {
    program,
    brief,
    scheme: 'campus',
    storeys,
    wings: pavs,
    pavilions: pavs,
    pavRows: rows,
    pavLen: len,
    quad: { x0, y0: quadY0, w: W, h: QUAD_D },
    envelope: { x0, y0, x1: x0 + W, y1: y0 + H },
    footprint,
    rects: storeyRects,
    storeyOcc,
    upperOcc,
    stairW,
    links,
    exits,
    walks,
    unplaced: [...packed.unplaced, ...leftover],
    fillers,
    adjacency,
    oversize: oversize || leftover.length > 0,
    entry: { x: x0 * CELL, z: (rowCCorr + corr / 2) * CELL },
    style: shellStyle(brief, rand),
  };
}

const WING_NAMES = ['North', 'East', 'South', 'West', 'Center'];
const wingName = (i) => `${WING_NAMES[i % WING_NAMES.length]} Wing`;
// A campus's buildings are lettered rather than compassed: a row of pavilions
// has no north one, and "Building C" is what the sign on it says.
const PAV_LETTERS = 'ABCDEFGHJKLM';   // no I, the same reason a lift has no 13
const pavilionName = (i) => `Building ${PAV_LETTERS[i % PAV_LETTERS.length]}`;
const FLOOR_WORDS = ['Main', 'Upper', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const floorWord = (s) => FLOOR_WORDS[Math.min(s, FLOOR_WORDS.length - 1)];

// "Room 204" on the second storey, "Science Lab 2" wherever it lands. A
// numbered room takes its storey's hundred; a named one just counts.
function roomName(room, storey) {
  if (!room.numbered) return room.base;
  if (room.key === 'classroom') return `Room ${(storey + 1) * 100 + room.seq}`;
  return `${room.base} ${room.seq}`;
}

// The admin suite, lining the spine's south side in the light courts between
// the wings. Rooms are dealt into the courts left to right; anything that
// doesn't fit in a court is dropped rather than overlapping a wing, which is
// the one place this layout would rather lose a room than lie about one.
function spineSideRects(rooms, wingX, wingW, originX, spineLen, spineY) {
  const courts = [];
  let cursor = originX;
  for (const x of wingX) {
    if (x - cursor >= 4) courts.push({ x0: cursor, x1: x - 1 });
    cursor = x + wingW;
  }
  if (originX + spineLen - cursor >= 4) courts.push({ x0: cursor, x1: originX + spineLen - 1 });

  const out = [];
  const y0 = spineY + SPINE_W;
  let ci = 0, cx = courts.length ? courts[0].x0 : 0;
  for (const r of rooms) {
    while (ci < courts.length && cx + r.w - 1 > courts[ci].x1) {
      ci++;
      if (ci < courts.length) cx = courts[ci].x0;
    }
    if (ci >= courts.length) break;
    out.push(rect('room', cx, y0, cx + r.w - 1, y0 + Math.min(SPINE_BAY_D, r.d) - 1, {
      key: r.key, name: r.base, tpl: r.tpl, door: 'n', storey: 0, daylight: true,
    }));
    cx += r.w;
  }
  return out;
}

// ---------- writing the design ----------
//
// Everything below turns the plan's rectangles into the calls a person makes
// with the tools. Nothing here knows it is a generator: `setTile` sets a tile,
// `addStair` places a stair, `addProp` places a prop. That is the whole of the
// generate-then-edit promise — there is no other kind of state to produce.
//
// Since Phase 12 the tiles and edges go onto a **scratch lattice** (see
// lattice.js) rather than onto the floor, and each storey is baked into rooms
// when its walls are standing. Nothing about the code below changed for that:
// laying a school out on a 4ft grid of rectangles is exactly what the lattice
// is still good at, and the bake is the same one the paint brush and the save
// loader go through. What changed is that a storey ends up as rooms with ids
// on them rather than as a raster somebody has to flood-fill to read.

const ROOM_TINTS = {
  gym: '#cfe2d8', cafeteria: '#f0e2c8', kitchen: '#e6dccd', library: '#d8dcef',
  'locker-g': '#e2d8e8', 'locker-b': '#d8e0e8',
  office: '#e4e8ef', principal: '#e4e8ef', health: '#f0dede', counsel: '#e4e8ef',
  workroom: '#e8e6de', custodial: '#dcd7cc', mech: '#d4d4d4',
  'restroom-g': '#ecdfe8', 'restroom-b': '#dde6ee',
  science: '#d6e8e2', computer: '#dde3ee', art: '#f0dfe6', music: '#e6dff0',
  shop: '#e3ded2', sped: '#e8e4d8',
};
const ROOM_FINISH = {
  gym: 'wood', cafeteria: 'terrazzo', kitchen: 'tile', library: 'carpet',
  office: 'carpet', principal: 'carpet', counsel: 'carpet', health: 'tile',
  'restroom-g': 'tile', 'restroom-b': 'tile', 'locker-g': 'tile', 'locker-b': 'tile',
  music: 'wood',
};

const tintFor = (r, i) => r.color || ROOM_TINTS[r.key] || ROOM_COLORS[i % ROOM_COLORS.length];

// Rooms big enough that one door onto the corridor is a finding rather than a
// design: an assembly space empties through two.
const PAIRED_DOORS = new Set(['gym', 'cafeteria']);

// Rooms that get the corridor wall in glass rather than block: the ones a
// school wants to be able to see into from the hall.
const GLAZED_FRONT = new Set(['office', 'library']);
// ...and the ones that emphatically do not.
const NO_WINDOWS = new Set(['restroom-g', 'restroom-b', 'custodial', 'mech', 'kitchen']);

function fillRect(f, r, tint) {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      setTile(f, x, y, true);
      const cell = f.cells[cellIdx(f, x, y)];
      if (!cell) continue;
      cell.room = r.name;
      cell.color = tint;
      applyFinish(cell, r.fin || ROOM_FINISH[r.key] || null, r.paint || null);
    }
  }
}

// Which rectangle owns each cell, so a wall can be decided by asking whether
// the two sides of an edge belong to the same room. This is the same question
// `computeLabels` answers after the fact; doing it from the plan means the
// walls are right the first time rather than being discovered.
function zoneMap(f, rects) {
  const zone = new Int32Array(f.w * f.h).fill(-1);
  rects.forEach((r, i) => {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
        zone[cellIdx(f, x, y)] = i;
      }
    }
  });
  return zone;
}

// Every boundary between two different rooms, and every boundary between a
// room and the weather. Corridors are walled from each other like anything
// else and then opened across the full width of the junction — see the note
// on `door: 'n'` in the wing corridor above for why that is worth doing.
function buildWalls(f, rects, zone) {
  const at = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? -1 : zone[cellIdx(f, x, y)]);
  const need = (a, b) => {
    if (a === b) return false;
    return a >= 0 || b >= 0;
  };
  for (let y = 0; y <= f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (need(at(x, y - 1), at(x, y))) f.edgesH[edgeHIdx(f, x, y)] = EDGE_WALL;
    }
  }
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x <= f.w; x++) {
      if (need(at(x - 1, y), at(x, y))) f.edgesV[edgeVIdx(f, x, y)] = EDGE_WALL;
    }
  }
}

// A run of edges on one side of a rectangle, as [x or y, ...] positions —
// used for both the window bands and the glazed fronts.
function sideRun(r, side) {
  const out = [];
  if (side === 'n' || side === 's') {
    for (let x = r.x0; x <= r.x1; x++) out.push(x);
  } else {
    for (let y = r.y0; y <= r.y1; y++) out.push(y);
  }
  return out;
}

const setSide = (f, r, side, pos, val) => {
  if (side === 'n') f.edgesH[edgeHIdx(f, pos, r.y0)] = val;
  else if (side === 's') f.edgesH[edgeHIdx(f, pos, r.y1 + 1)] = val;
  else if (side === 'w') f.edgesV[edgeVIdx(f, r.x0, pos)] = val;
  else f.edgesV[edgeVIdx(f, r.x1 + 1, pos)] = val;
};

const getSide = (f, r, side, pos) => (
  side === 'n' ? f.edgesH[edgeHIdx(f, pos, r.y0)]
    : side === 's' ? f.edgesH[edgeHIdx(f, pos, r.y1 + 1)]
      : side === 'w' ? f.edgesV[edgeVIdx(f, r.x0, pos)]
        : f.edgesV[edgeVIdx(f, r.x1 + 1, pos)]
);

// Whether the cell on the far side of this edge is outside the building. An
// exterior wall is where the windows go, and it is the only thing that
// decides — a wall between two rooms never gets glazed however much daylight
// the room would like.
function outsideAcross(f, zone, r, side, pos) {
  const at = (x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? -1 : zone[cellIdx(f, x, y)]);
  if (side === 'n') return at(pos, r.y0 - 1) < 0;
  if (side === 's') return at(pos, r.y1 + 1) < 0;
  if (side === 'w') return at(r.x0 - 1, pos) < 0;
  return at(r.x1 + 1, pos) < 0;
}

// The middle of a side, which is where a door goes unless something is
// already there.
const midOf = (run) => run[Math.floor((run.length - 1) / 2)];

function cutDoors(f, rects) {
  for (const r of rects) {
    if (!r.door) continue;
    // A room has one door onto its corridor; a corridor can have a way into
    // another one at each end of it, which is what a scheme with a corridor
    // *loop* rather than a corridor tree needs. So `door` is a side or a list
    // of them, and everything below runs once per side.
    for (const side of (Array.isArray(r.door) ? r.door : [r.door])) cutSide(f, r, side);
  }
}

function cutSide(f, r, door) {
  const run = sideRun(r, door);
  if (!run.length) return;
  const pair = PAIRED_DOORS.has(r.key);
  const kind = r.doorKind === 'opening' ? EDGE_OPENING
    : r.doorKind === 'double' || pair ? EDGE_DOOR2 : EDGE_DOOR;
  // A room the size of a gym or a cafeteria gets two doors rather than one,
  // and they go a third of the way in from each end — one 3ft door on an
  // assembly space is the first finding Phase 7 prints. Every other room
  // gets one door in the middle of the side that faces its corridor, which
  // is the only position guaranteed to *be* on the corridor: a wide room
  // whose corridor is narrower than it is has walls at both ends of that
  // side, and a door placed out there opens into the next classroom.
  const spots = r.doorFull ? run
    : pair && run.length >= 12
      ? [run[Math.floor(run.length * 0.28)], run[Math.floor(run.length * 0.72)]]
      : [midOf(run)];
  for (const pos of spots) setSide(f, r, door, pos, kind);
  // The rooms a hall should be able to see into front it in glass, with the
  // door left exactly where it was: the partition still bounds the room, it
  // just isn't opaque.
  if (GLAZED_FRONT.has(r.key)) {
    for (const pos of run) {
      if (!spots.includes(pos)) setSide(f, r, door, pos, EDGE_GLASS);
    }
  }
}

function glazeWindows(f, rects, zone) {
  for (const r of rects) {
    if (r.kind !== 'room' || !r.daylight || NO_WINDOWS.has(r.key)) continue;
    for (const side of ['n', 's', 'e', 'w']) {
      const run = sideRun(r, side).filter((pos) => outsideAcross(f, zone, r, side, pos));
      if (run.length < 3) continue;
      // Leave a cell of solid wall at each corner: a window that runs into the
      // return of a wall reads as a mistake, and a building needs something to
      // stand on at its corners.
      for (const pos of run.slice(1, -1)) {
        if (getSide(f, r, side, pos) === EDGE_WALL) setSide(f, r, side, pos, EDGE_WINDOW);
      }
    }
  }
}

function cutExits(f, exits) {
  for (const e of exits) {
    if (e.edge === 'w' || e.edge === 'e') f.edgesV[edgeVIdx(f, e.x, e.y)] = e.kind;
    else f.edgesH[edgeHIdx(f, e.x, e.y)] = e.kind;
  }
}

// The exits the finished shell turns out to want, as opposed to the ones the
// plan asked for.
//
// The plan puts a door at each end of the spine and at the foot of every wing,
// which is what a scheme drawing shows. What it can't know until the walls are
// standing is where else the building actually touches the outside: a spine
// with a light court on one side has two hundred feet of exterior wall in the
// middle of it, and a gym with its only door onto the corridor makes everybody
// inside it walk the length of the school to leave. Both are travel-distance
// findings in Phase 7's report and both are a door.
//
// So this walks the exposed runs of every corridor and every big room and puts
// a pair of doors in the middle of each one long enough to take them. It runs
// on the ground floor only — an exit is a door to the *outside*, and on Level 2
// that is a window.
const EXIT_RUN = 3;          // cells of exposed wall a corridor exit needs
const BLOCK_EXIT_RUN = 5;    // ...and what a gym or a cafeteria wants

function cutShellExits(f, rects, zone) {
  let added = 0;
  const runsOn = (r, side) => {
    const out = [];
    let run = [];
    for (const pos of sideRun(r, side)) {
      if (outsideAcross(f, zone, r, side, pos)) { run.push(pos); continue; }
      if (run.length) out.push(run);
      run = [];
    }
    if (run.length) out.push(run);
    return out;
  };
  for (const r of rects) {
    // Corridors, assembly rooms, and every stair tower. The last of those is
    // the one that matters most for a multi-storey scheme: a stair that
    // discharges straight to the outside is what stops an upper storey's walk
    // to safety from continuing through the whole ground floor once it gets
    // down there.
    const big = r.kind === 'room' && (PAIRED_DOORS.has(r.key) || r.key === 'library' || r.stairHall);
    if (r.kind !== 'corridor' && !big) continue;
    const need = r.kind === 'corridor' ? EXIT_RUN : r.stairHall ? EXIT_RUN : BLOCK_EXIT_RUN;
    for (const side of ['n', 's', 'e', 'w']) {
      // A courtyard is not a way out. `egressField` treats every exterior door
      // as discharging to a public way, and a school that "evacuates" into a
      // sealed court is a school with an egress table nobody should believe —
      // so a scheme that wraps a room in the building says which sides face
      // it, and gets windows there rather than doors.
      if (r.skipExit && r.skipExit.includes(side)) continue;
      for (const run of runsOn(r, side)) {
        if (run.length < need) continue;
        setSide(f, r, side, midOf(run), EDGE_DOOR2);
        added++;
        // One per exposed run: a corridor that opens onto a court wants a way
        // out of it, not a colonnade.
        if (r.kind !== 'corridor') break;
      }
    }
  }
  return added;
}

// ---------- the grounds ----------

const siteRect = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];

// A car park sized by the program's own stall count rather than by eye: 9x18ft
// stalls in double-loaded bays either side of a 24ft aisle, which is 63ft of
// depth per bay and the reason a staff lot is always deeper than it looks.
function parkingSize(stalls) {
  const perBay = Math.max(4, Math.round(Math.sqrt(stalls * 2)));
  const bays = Math.max(1, Math.ceil(stalls / (perBay * 2)));
  return { w: perBay * 9 + 20, d: bays * 63 + 20 };
}

function buildSite(state, plan) {
  const b = plan.brief;
  const band = bandEntry(b.band);
  const x0 = plan.envelope.x0 * CELL;
  const x1 = plan.envelope.x1 * CELL;
  const north = plan.envelope.y0 * CELL;
  const south = plan.envelope.y1 * CELL;
  const lot = parkingSize(plan.program.parking);

  // Room for the building, a car park to the west, and a field to the east —
  // `terrainFor`'s margin is the whole site, so it is sized off the biggest
  // thing that has to fit beside the building rather than off the building.
  const margin = Math.max(300, lot.w + 140, band.key === 'high' ? 460 : 340);
  state.terrain = terrainFor(state, margin);
  // Enough relief to read as ground rather than as a table: the field sits up
  // on a shelf and the car park a little below the entrance, so the walk to
  // the door runs downhill for a bus and up for a car.
  raiseTerrain(state.terrain, x1 + 220, (north + south) / 2, 240, 5);
  raiseTerrain(state.terrain, x0 - lot.w / 2 - 90, south + 60, 200, -3);
  smoothTerrain(state.terrain, (x0 + x1) / 2, (north + south) / 2, margin, 0.5);

  // Lawn first, everything else on top of it — regions stack in list order.
  addRegion(state, siteRect(x0 - margin, north - margin, x1 + margin, south + margin), {
    surf: 'turf', name: 'Lawn',
  });

  // The bus loop comes in from the west to the main entrance. Its kind is
  // what tells the crowd where the buses stop (Phase 39): the bays fall out
  // of the region's own geometry, so nothing here places a single one.
  const entryZ = plan.entry.z;
  addRegion(state, siteRect(x0 - 200, entryZ - 22, x0 - 4, entryZ + 22), {
    surf: 'asphalt', mark: 'lane', kind: 'busloop', name: 'Bus loop',
  });
  addRegion(state, siteRect(x0 - 90, entryZ - 22, x0 - 76, entryZ + 22), {
    surf: 'asphalt', mark: 'crosswalk', name: 'Crossing',
  });
  addRegion(state, siteRect(x0 - 30, entryZ - 40, x0 - 2, entryZ + 40), {
    surf: 'concrete', name: 'Entry plaza',
  });
  // A drop-off lane for the cars, just south of the loop, so the morning has
  // both of a real school's arrivals: the bus crowd in threes and fours, and
  // the car doors going one at a time.
  addRegion(state, siteRect(x0 - 170, entryZ + 26, x0 - 8, entryZ + 58), {
    surf: 'asphalt', kind: 'dropoff', name: 'Drop-off',
  });

  // Staff and visitor parking, south-west of the entrance and clear of it.
  const lotX1 = x0 - 60;
  const lotZ0 = entryZ + 70;
  addRegion(state, siteRect(lotX1 - lot.w, lotZ0, lotX1, lotZ0 + lot.d), {
    surf: 'asphalt', mark: 'stalls', kind: 'parking', name: 'Staff lot',
  });
  addRegion(state, siteRect(lotX1, entryZ + 30, lotX1 + 14, lotZ0 + lot.d), {
    surf: 'concrete', name: 'Lot walk',
  });

  // Walks: one along the north face, one down the east, and one across the
  // foot of the wings so every wing exit discharges onto something.
  addRegion(state, siteRect(x0 - 12, north - 22, x1 + 12, north - 8), { surf: 'concrete', name: 'North walk' });
  addRegion(state, siteRect(x1 + 8, north - 22, x1 + 22, south + 22), { surf: 'concrete', name: 'East walk' });
  addRegion(state, siteRect(x0 - 12, south + 8, x1 + 22, south + 22), { surf: 'concrete', name: 'South walk' });

  // ...and whatever paving the scheme itself asked for. Only the campus does:
  // its buildings are joined by walks rather than by corridors, and a walk
  // that exists on the plan and not on the ground is a route the site mesh
  // would measure across a lawn. Given in cells, like every other rectangle a
  // plan carries.
  for (const w of plan.walks || []) {
    addRegion(state, siteRect(w.x0 * CELL, w.y0 * CELL, (w.x1 + 1) * CELL, (w.y1 + 1) * CELL), {
      surf: 'concrete', name: w.name || 'Covered walk',
    });
  }

  // What the band actually plays on, on whichever side of the building the
  // seed put it: east of the wings, or south below them. Both are real
  // arrangements and which one you get is the difference two runs of the same
  // brief are allowed to have.
  const east = plan.style.fieldEast;
  const px = east ? x1 + 60 : x0;
  const pz = east ? north : south + 60;
  if (b.band === 'elementary') {
    addRegion(state, siteRect(px, pz, px + 160, pz + 120), {
      surf: 'court', mark: 'basketball', name: 'Blacktop',
    });
    addRegion(state, siteRect(px, pz + 140, px + 140, pz + 250), {
      surf: 'mulch', name: 'Playground',
    });
  } else {
    addRegion(state, siteRect(px, pz, px + 360, pz + 220), {
      surf: 'turf', mark: 'soccer', name: 'Playing field',
    });
    addRegion(state, siteRect(px, pz + 250, px + 130, pz + 340), {
      surf: 'court', mark: 'basketball', name: 'Blacktop',
    });
  }
  addRegion(state, siteRect(x0 - 46, north - 60, x0 + 60, north - 26), {
    surf: 'garden', name: 'Entry planting',
  });
}

// ---------- furnishing ----------
//
// The generator furnishes by calling autofurnish.js on the rooms it just
// wrote, rather than by remembering what it meant each room to be. That is
// deliberate: the layout's idea of a science lab and the *plan's* idea of one
// have to agree, and the only way to be sure they do is to read the plan back.
function furnishAll(state, opts = {}) {
  const budget = opts.budget ?? MAX_PROPS;
  let placed = 0;
  for (let i = 0; i < state.floors.length; i++) {
    for (const room of floorRooms(state, i).rooms) {
      if (!room.name) continue;
      const geo = roomGeometry(state, i, room);
      if (!geo) continue;
      const r = furnishRoom(state, i, room, { ...opts, geometry: geo });
      for (const pl of r.placements) {
        if (state.props.length >= budget) return placed;
        const prop = addProp(state, pl.type, {
          x: pl.x, z: pl.z, y: pl.y, rotationY: pl.rotationY, mount: pl.mount, floor: i, scale: 1,
        });
        if (prop) placed++;
      }
    }
  }
  return placed;
}

// ---------- the whole thing ----------

export function buildSchool(briefOrPlan, opts = {}) {
  const plan = briefOrPlan && briefOrPlan.rects ? briefOrPlan : layoutSchool(briefOrPlan);
  const brief = plan.brief;

  const state = createState(plan.footprint.w, plan.footprint.h);
  for (let i = 1; i < plan.storeys; i++) addFloor(state, i);
  // Reported to the caller, never stored on the design.
  let shellExits = 0;

  for (let s = 0; s < plan.storeys; s++) {
    const rects = plan.rects[s];
    // One scratch lattice per storey, baked the moment its walls are up. The
    // bake is what gives every room its id, and it is the same call the save
    // loader and the paint brush make.
    const lat = createLattice(plan.footprint.w, plan.footprint.h);
    rects.forEach((r, i) => fillRect(lat, r, tintFor(r, i)));
    const zone = zoneMap(lat, rects);
    buildWalls(lat, rects, zone);
    cutDoors(lat, rects);
    glazeWindows(lat, rects, zone);
    if (s === 0) {
      shellExits = cutShellExits(lat, rects, zone);
      cutExits(lat, plan.exits);
    }
    bake(state, s, lat);
  }

  for (const l of plan.links) {
    addStair(state, l.from, {
      type: l.type, x: l.x, z: l.z, rotationY: l.rotationY, width: l.width,
    });
  }

  // The shell the seed chose: a parapet or a gable, a facade off finish.js's
  // list, and a compass bearing, so two runs of the same brief are two
  // buildings rather than one building twice.
  state.roof = normalizeRoof({ style: plan.style.roof, pitch: 4, facade: plan.style.facade });
  state.env = { ...state.env, north: plan.style.north };
  // The crowd that belongs in it. The report knows the building holds a
  // number; the brief said what that number was meant to be, and this is the
  // one line that makes the two agree on the first run.
  state.life = { students: Math.min(1200, brief.students), seed: brief.seed };

  if (opts.furnish !== false) furnishAll(state, opts);
  if (brief.site && opts.site !== false) buildSite(state, plan);

  state.currentFloor = 0;
  // Deliberately nothing else. There is no `state.generated`, no marker and
  // no provenance field: the moment a design carries one, some tool starts
  // reading it, and generate-then-edit stops being sacred. What the run did
  // is reported to the panel and thrown away — see `generationSummary`.
  return state;
}

// What the generator did, in the terms somebody asked for it — printed by the
// panel beside the design so a run is legible without walking it.
// Doors in the outside wall of the ground floor: the thing a reader wants to
// know about a generated shell and the one number that isn't in the plan,
// since half of them are cut once the walls are standing.
export function exteriorDoors(state) {
  const floor = state && state.floors ? state.floors[0] : null;
  if (!floor) return 0;
  // A door is exterior when the wall it is cut into has weather on one side —
  // which is the question walls.js already answers, and answers the same way
  // for the renderer's facade and the thickness of the wall itself. Asking it
  // here rather than comparing two cells is what makes this survive the room
  // model no longer being a raster.
  const thickness = wallProbe(floor);
  let n = 0;
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (const o of ring.openings) {
        if (!isDoorOpening(o) || !isBuilt(ring.walls[o.seg])) continue;
        const [a, b] = segEnds(ring, o.seg);
        if (thickness.exterior(a.x, a.z, b.x, b.z)) n++;
      }
    }
  }
  return n;
}

export function generationSummary(plan, state) {
  const rooms = plan.rects.flat().filter((r) => r.kind === 'room');
  const scheme = schemeEntry(plan.scheme);
  return {
    students: plan.brief.students,
    band: plan.program.band.label,
    scheme: scheme.key,
    schemeLabel: scheme.label,
    storeys: plan.storeys,
    wings: plan.wings,
    rooms: rooms.length,
    stations: plan.program.stations,
    footprintFt: {
      w: plan.footprint.w * CELL,
      d: plan.footprint.h * CELL,
    },
    parking: plan.program.parking,
    staff: plan.program.staff,
    props: state ? state.props.length : 0,
    links: state ? state.links.length : 0,
    exits: state ? exteriorDoors(state) : 0,
    stairWidth: plan.stairW,
    occupants: plan.storeyOcc.reduce((a, b) => a + b, 0),
    unplaced: plan.unplaced.map((r) => r.name),
    // What the brief asked for about where two rooms sit, and whether the
    // layout managed it. Reported either way: a generator that quietly failed
    // to honour a sentence somebody typed is one you cannot trust with the
    // next one.
    adjacency: (plan.adjacency || []).map((r) => ({
      a: r.a, b: r.b, want: r.want, done: !!r.done, why: r.why || null,
      gap: Number.isFinite(r.after) ? Math.round(r.after) : null,
    })),
  };
}
