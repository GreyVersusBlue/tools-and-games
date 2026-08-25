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

import {
  CELL, ROOM_COLORS, MAX_FLOORS,
  createState, setTile, getCell, cellIdx, edgeHIdx, edgeVIdx, addFloor, isDoorEdge,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_WINDOW, EDGE_GLASS, EDGE_OPENING,
} from './grid.js';
import { addProp, MAX_PROPS } from './props.js';
import { addStair } from './stairs.js';
import { applyFinish } from './finish.js';
import { addRegion } from './site.js';
import { terrainFor, raiseTerrain, smoothTerrain } from './terrain.js';
import { normalizeRoof } from './roof.js';
import { FACADE_KEYS } from './finish.js';
import { rng } from './agents.js';
import { buildProgram, bandEntry } from './program.js';
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
  const out = [];
  for (let i = 0; i < parts; i++) {
    const a = Math.round((len * i) / parts);
    const b = Math.round((len * (i + 1)) / parts) - 1;
    const seg = axis === 'x'
      ? rect(kind, x0 + a, y0, x0 + b, y1, tags)
      : rect(kind, x0, y0 + a, x1, y0 + b, tags);
    if (i > 0) {
      seg.name = `${r.name} ${i + 1}`;
      seg.door = axis === 'x' ? 'w' : 'n';
      seg.doorKind = 'double';
      seg.doorFull = true;
    }
    out.push(seg);
  }
  return out;
}

export function layoutSchool(briefOrProgram) {
  const program = briefOrProgram && briefOrProgram.rooms
    ? briefOrProgram
    : buildProgram(briefOrProgram);
  const brief = program.brief;
  const storeys = Math.min(MAX_FLOORS, Math.max(1, brief.storeys));
  const rand = rng(brief.seed);

  const all = expandProgram(program);
  const blocks = all.filter((r) => r.group === 'block' || BLOCK_ORDER.includes(r.key))
    .sort((a, b) => rank(BLOCK_ORDER, a.key) - rank(BLOCK_ORDER, b.key) || a.seq - b.seq);
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
    storeys,
    wings,
    bayLen,
    wingW,
    wingH,
    wingX,
    wingY0,
    spine: { x0: originX, y0: spineY, len: spineLen, w: SPINE_W },
    footprint,
    rects: storeyRects,
    storeyOcc,
    upperOcc,
    stairW,
    links,
    exits,
    unplaced,
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

const WING_NAMES = ['North', 'East', 'South', 'West', 'Center'];
const wingName = (i) => `${WING_NAMES[i % WING_NAMES.length]} Wing`;
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

function fillRect(state, floorIndex, r, tint) {
  const f = state.floors[floorIndex];
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
function zoneMap(state, floorIndex, rects) {
  const f = state.floors[floorIndex];
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
function buildWalls(state, floorIndex, rects, zone) {
  const f = state.floors[floorIndex];
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

function cutDoors(state, floorIndex, rects, zone) {
  const f = state.floors[floorIndex];
  for (const r of rects) {
    if (!r.door) continue;
    const run = sideRun(r, r.door);
    if (!run.length) continue;
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
    for (const pos of spots) setSide(f, r, r.door, pos, kind);
    // The rooms a hall should be able to see into front it in glass, with the
    // door left exactly where it was: the partition still bounds the room, it
    // just isn't opaque.
    if (GLAZED_FRONT.has(r.key)) {
      for (const pos of run) {
        if (!spots.includes(pos)) setSide(f, r, r.door, pos, EDGE_GLASS);
      }
    }
  }
}

function glazeWindows(state, floorIndex, rects, zone) {
  const f = state.floors[floorIndex];
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

function cutExits(state, exits) {
  const f = state.floors[0];
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

function cutShellExits(state, rects, zone) {
  const f = state.floors[0];
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
  const x0 = plan.spine.x0 * CELL;
  const x1 = (plan.spine.x0 + plan.spine.len) * CELL;
  const north = plan.spine.y0 * CELL;
  const south = (plan.wingY0 + plan.wingH) * CELL;
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

  // The bus loop comes in from the west to the main entrance.
  const entryZ = plan.entry.z;
  addRegion(state, siteRect(x0 - 200, entryZ - 22, x0 - 4, entryZ + 22), {
    surf: 'asphalt', mark: 'lane', name: 'Bus loop',
  });
  addRegion(state, siteRect(x0 - 90, entryZ - 22, x0 - 76, entryZ + 22), {
    surf: 'asphalt', mark: 'crosswalk', name: 'Crossing',
  });
  addRegion(state, siteRect(x0 - 30, entryZ - 40, x0 - 2, entryZ + 40), {
    surf: 'concrete', name: 'Entry plaza',
  });

  // Staff and visitor parking, south-west of the entrance and clear of it.
  const lotX1 = x0 - 60;
  const lotZ0 = entryZ + 70;
  addRegion(state, siteRect(lotX1 - lot.w, lotZ0, lotX1, lotZ0 + lot.d), {
    surf: 'asphalt', mark: 'stalls', name: 'Staff lot',
  });
  addRegion(state, siteRect(lotX1, entryZ + 30, lotX1 + 14, lotZ0 + lot.d), {
    surf: 'concrete', name: 'Lot walk',
  });

  // Walks: one along the north face, one down the east, and one across the
  // foot of the wings so every wing exit discharges onto something.
  addRegion(state, siteRect(x0 - 12, north - 22, x1 + 12, north - 8), { surf: 'concrete', name: 'North walk' });
  addRegion(state, siteRect(x1 + 8, north - 22, x1 + 22, south + 22), { surf: 'concrete', name: 'East walk' });
  addRegion(state, siteRect(x0 - 12, south + 8, x1 + 22, south + 22), { surf: 'concrete', name: 'South walk' });

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
    rects.forEach((r, i) => fillRect(state, s, r, tintFor(r, i)));
    const zone = zoneMap(state, s, rects);
    buildWalls(state, s, rects, zone);
    cutDoors(state, s, rects, zone);
    glazeWindows(state, s, rects, zone);
    if (s === 0) shellExits = cutShellExits(state, rects, zone);
  }
  cutExits(state, plan.exits);

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
  const f = state && state.floors ? state.floors[0] : null;
  if (!f) return 0;
  const on = (x, y) => !!getCell(f, x, y);
  let n = 0;
  for (let y = 0; y <= f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const v = f.edgesH[edgeHIdx(f, x, y)];
      if (isDoorEdge(v) && on(x, y - 1) !== on(x, y)) n++;
    }
  }
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x <= f.w; x++) {
      const v = f.edgesV[edgeVIdx(f, x, y)];
      if (isDoorEdge(v) && on(x - 1, y) !== on(x, y)) n++;
    }
  }
  return n;
}

export function generationSummary(plan, state) {
  const rooms = plan.rects.flat().filter((r) => r.kind === 'room');
  return {
    students: plan.brief.students,
    band: plan.program.band.label,
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
  };
}
