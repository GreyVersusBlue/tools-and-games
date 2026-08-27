// grid.js — the design's own dimensions, and the storeys it is made of.
//
// Units are feet. Until Phase 12 this file also held the 4ft cell lattice a
// room used to be — cells, wall edges, flood fill — and every module in the
// codebase carried a branch for it. The lattice is now a *drawing surface*
// rather than a representation (see lattice.js), so what is left here is what
// was always true of the design as a whole: how big it is, how many levels it
// has, how high they stand, and the constants everything measures against.
//
// State shape (v11):
//   { version, cellFt, floorHt, w, h,
//     floors: [ { w, h, shapes[] }, ... ],
//     currentFloor, props: [], links: [], env, code?, roof?, terrain?, site?,
//     life?, overlay?, tours?, models?, nextId }
//
// `env` is Phase 3's one addition: the date, hour, latitude and compass
// orientation the design is lit by, plus whether its own lights are burning.
// It lives on the state rather than in the renderer because it is part of the
// design — "this wing faces the morning sun" is a fact about the building, not
// a view setting — and it defaults to a bright mid-morning, which is the fixed
// rig every earlier version drew with. See sky.js.
//
// A floor is a list of **rooms**, and every room is a polygon with an id (see
// shapes.js). There is one kind of room. That sentence is the whole of Phase
// 12, and the reason this file is a third of the length it was.
//
// All floors share one footprint (w x h) and one origin. That is a deliberate
// constraint: stairs, mezzanine openings and floor cuts all need to line up
// between levels, and a shared origin makes "the same place on the level
// above" a trivial lookup instead of a coordinate transform. Each floor record
// still carries its own w/h so every pure helper below takes a *floor* and
// reads exactly the fields the v1 state had.

import { defaultEnv } from './sky.js';

// The drawing lattice's pitch, and the unit the footprint's w/h are counted
// in. It is no longer what a room is made of; it is still what a plan is drawn
// on, what the brush snaps to, and what a scheme's rectangles are measured in.
export const CELL = 4;        // ft
export const WALL_H = 10;     // wall height (ceiling plane), ft
// Guardrail height. Waist-high on purpose: a railing has to read as an edge you
// can see over, never as an enclosure the way a wall does.
export const RAIL_H = 3.5;    // ft — a school's code minimum
export const FLOOR_H = 12;    // floor-to-floor height, ft (10ft ceiling + 2ft plenum)
// Wall thickness. `WALL_T` stays the nominal figure every pre-Phase-2 caller
// used and is still the fallback where nothing better is known; the two below
// are what a boundary is *actually* built at once walls.js has looked at what
// is on either side of it. An interior partition is a stud wall between two
// rooms; an exterior wall carries the building and is drawn thicker for it.
export const WALL_T = 0.5;    // wall thickness, ft — nominal / fallback
export const WALL_T_INT = 0.4;  // ft — a partition with rooms on both sides
export const WALL_T_EXT = 0.8;  // ft — a wall with weather on one side
export const DOOR_W = 3;      // door opening width, ft
export const DOOR_H = 7;      // door opening height, ft
export const DOUBLE_DOOR_W = 6; // ft — a corridor/egress pair
export const EYE_H = 5.5;     // first-person eye height, ft

export const DEFAULT_W = 40;  // cells
export const DEFAULT_H = 30;  // cells
export const MAX_FLOORS = 8;

// How small and how large the drawing surface may be, in cells. Since v1 these
// were two private numbers in `save-load.js` that clamped a loaded design, and
// nothing in the tool could reach the range because nothing in the tool could
// change the size. Phase 13 made the footprint something somebody sets, so the
// range belongs here, where the loader and the editor both read it: four cells
// is a room and a corridor, two hundred is eight hundred feet square.
export const MIN_CELLS = 4;
export const MAX_CELLS = 200;

// Pastel floor tints for rooms
export const ROOM_COLORS = [
  '#f5d491', '#b8dfa2', '#a9d3e8', '#e8b4c8',
  '#d4c5f9', '#f5b891', '#9fdcd0', '#e6e08e',
];

// ---------- construction ----------

export function createFloor(w = DEFAULT_W, h = DEFAULT_H) {
  return {
    w, h,
    // Every room on this storey, as a polygon with an id — see shapes.js.
    // Rooms are free-floating outlines in world feet; the footprint above is
    // what the *drawing* surface covers, not a box a room has to fit inside.
    shapes: [],
  };
}

export function createState(w = DEFAULT_W, h = DEFAULT_H) {
  return {
    version: 12,
    cellFt: CELL,
    floorHt: FLOOR_H,
    w, h,
    floors: [createFloor(w, h)],
    currentFloor: 0,
    // Free-floating objects in world feet — see props.js
    props: [],
    // Inter-floor connections — stairs and the floor openings they cut. See
    // props.js for the record shape and stairs.js for what one means.
    links: [],
    // When and where this building stands, for the sun. See sky.js.
    env: defaultEnv(),
    // `code` (occupancy.js — which edition the analysis is read against and
    // whether the building is sprinklered), `roof` (roof.js), `terrain`
    // (terrain.js) and `site` (site.js) are deliberately *not* here, and
    // neither are `tours` (tour.js) or `models` (models.js). All of them are
    // absent until somebody answers a question about the code, grades
    // something, draws something, asks for a roof other than the default,
    // records a camera path or imports a file — which is what keeps a design
    // that has none of them byte-identical to an older one, and why grid.js
    // stays a leaf module that imports only the sky.
    nextId: 1,
  };
}

export const floorLabel = (i) => `Level ${i + 1}`;

// ---------- floor access ----------

export const activeFloor = (s) => s.floors[s.currentFloor] || s.floors[0];
export const floorAt = (s, i) => s.floors[i] || null;
export const floorBaseY = (s, i) => i * (s.floorHt || FLOOR_H);
export const topOfBuilding = (s) => floorBaseY(s, s.floors.length - 1) + WALL_H;

// Walls run full floor-to-floor height on any level that has a level above it,
// so the building has no gap band between storeys when seen from outside.
export const wallHeightOf = (s, i) => (i < s.floors.length - 1 ? (s.floorHt || FLOOR_H) : WALL_H);

// Is a cell inside the drawing surface? The lattice is not a room any more,
// but it is still the sheet the plan is laid out on.
export const inGrid = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h;

export const floorShapeCount = (f) => (f && Array.isArray(f.shapes) ? f.shapes.length : 0);

// Ids for props, links and rooms all come off one monotonic counter so
// nothing in a save file can collide.
function nextShapeId(s) {
  const id = Math.max(1, Math.floor(s.nextId || 1));
  s.nextId = id + 1;
  return id;
}

// ---------- floor management ----------
//
// Inserting or removing a level renumbers everything above it, so props and
// inter-floor links are remapped here rather than left for callers to fix up.

function remapFloorRefs(s, map) {
  s.props = s.props.filter((p) => map(p.floor) !== null);
  for (const p of s.props) p.floor = map(p.floor);
  s.links = s.links.filter((l) => map(l.from) !== null && map(l.to) !== null);
  for (const l of s.links) { l.from = map(l.from); l.to = map(l.to); }
}

// Insert an empty floor at `index` (defaults to just above the current one).
// Returns the new floor's index, or -1 if the building is already at MAX_FLOORS.
export function addFloor(s, index = s.currentFloor + 1) {
  if (s.floors.length >= MAX_FLOORS) return -1;
  const at = Math.min(Math.max(0, Math.floor(index)), s.floors.length);
  s.floors.splice(at, 0, createFloor(s.w, s.h));
  remapFloorRefs(s, (i) => (i >= at ? i + 1 : i));
  s.currentFloor = at;
  return at;
}

// Copy an existing floor's rooms onto a new level above it.
export function duplicateFloor(s, index = s.currentFloor) {
  if (s.floors.length >= MAX_FLOORS) return -1;
  const src = s.floors[index];
  if (!src) return -1;
  const at = index + 1;
  s.floors.splice(at, 0, {
    w: src.w, h: src.h,
    // Copied rooms are new rooms: same outline, fresh ids, so a tool holding a
    // selection can't end up editing both storeys at once — and so nothing
    // outside the file can name one room and reach two. Cloned here rather
    // than through shapes.js so grid.js stays a leaf module.
    shapes: (src.shapes || []).map((sh) => ({
      id: nextShapeId(s),
      name: sh.name,
      color: sh.color,
      fin: sh.fin || null,
      paint: sh.paint || null,
      group: sh.group || null,
      load: Number.isFinite(sh.load) ? sh.load : null,
      rings: sh.rings.map((r) => ({
        pts: r.pts.map((p) => ({ x: p.x, z: p.z })),
        walls: r.walls.slice(),
        // Spread rather than pick: an opening carries optional door/window
        // fields (see shapes.js) and a duplicated floor has to keep all of them.
        openings: r.openings.map((o) => ({ ...o })),
      })),
    })),
  });
  remapFloorRefs(s, (i) => (i >= at ? i + 1 : i));
  s.currentFloor = at;
  return at;
}

// Remove a floor along with anything anchored to it. The ground floor of a
// one-storey building can't be removed — there has to be something to edit.
export function removeFloor(s, index = s.currentFloor) {
  if (s.floors.length <= 1 || !s.floors[index]) return false;
  s.floors.splice(index, 1);
  remapFloorRefs(s, (i) => (i === index ? null : i > index ? i - 1 : i));
  s.currentFloor = Math.min(s.currentFloor, s.floors.length - 1);
  return true;
}

export function setCurrentFloor(s, i) {
  const n = Math.min(Math.max(0, Math.floor(i)), s.floors.length - 1);
  if (n === s.currentFloor) return false;
  s.currentFloor = n;
  return true;
}
