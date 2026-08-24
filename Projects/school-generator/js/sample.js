// sample.js — the first-run demo school.
//
// Lives outside grid.js because it draws from every representation the editor
// has: a rectilinear grid core (fast to lay out, and what the grid is for), one
// polygon room hung off the east end of the hall, furniture in Room 101, and —
// since Phase 4 — a second storey reached by a real staircase, with a railed
// mezzanine over the main hall and glazed partitions on both levels. Opening
// the tool should show you what it can do, not a blank lattice.

import {
  ROOM_COLORS, createState, setTile, floodRegion, cellIdx, edgeHIdx, edgeVIdx,
  EDGE_WALL, EDGE_DOOR, EDGE_GLASS, addFloor,
} from './grid.js';
import { addShape, setSegWall, addOpening, SEG_GLASS } from './shapes.js';
import { addProp } from './props.js';
import { addStair } from './stairs.js';

const HALF_PI = Math.PI / 2;

function floorRect(f, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) setTile(f, x, y, true);
}

function wallRect(f, x0, y0, x1, y1) {
  for (let x = x0; x <= x1; x++) {
    f.edgesH[edgeHIdx(f, x, y0)] = 1;
    f.edgesH[edgeHIdx(f, x, y1 + 1)] = 1;
  }
  for (let y = y0; y <= y1; y++) {
    f.edgesV[edgeVIdx(f, x0, y)] = 1;
    f.edgesV[edgeVIdx(f, x1 + 1, y)] = 1;
  }
}

// A run of edges set to one kind, so a glazed front or a guardrail reads as one
// gesture here rather than a loop at each call site.
function edgeRunH(f, x0, x1, y, val) {
  for (let x = x0; x <= x1; x++) f.edgesH[edgeHIdx(f, x, y)] = val;
}

function edgeRunV(f, x, y0, y1, val) {
  for (let y = y0; y <= y1; y++) f.edgesV[edgeVIdx(f, x, y)] = val;
}

function assignRoom(f, x, y, name, color) {
  for (const c of floodRegion(f, x, y)) {
    const cell = f.cells[cellIdx(f, c.x, c.y)];
    cell.room = name;
    cell.color = color;
  }
}

export function buildSampleSchool() {
  const s = createState();
  const f = s.floors[0];
  // Main hall: x 6..33, y 13..15
  floorRect(f, 6, 13, 33, 15);
  // Classrooms north of the hall: four 7x6 rooms, y 7..12
  for (let r = 0; r < 4; r++) floorRect(f, 6 + r * 7, 7, 12 + r * 7, 12);
  // South side: office + two classrooms, y 16..21
  floorRect(f, 6, 16, 12, 21);   // office
  floorRect(f, 13, 16, 22, 21);  // room 105
  floorRect(f, 23, 16, 33, 21);  // room 106
  // Outer shell + interior partitions
  wallRect(f, 6, 7, 33, 21);
  for (let r = 1; r < 4; r++)
    for (let y = 7; y <= 12; y++) f.edgesV[edgeVIdx(f, 6 + r * 7, y)] = 1;
  for (let x = 6; x <= 33; x++) {
    f.edgesH[edgeHIdx(f, x, 13)] = 1;
    f.edgesH[edgeHIdx(f, x, 16)] = 1;
  }
  for (let y = 16; y <= 21; y++) {
    f.edgesV[edgeVIdx(f, 13, y)] = 1;
    f.edgesV[edgeVIdx(f, 23, y)] = 1;
  }
  // Doors: each north room into the hall
  for (let r = 0; r < 4; r++) f.edgesH[edgeHIdx(f, 8 + r * 7, 13)] = 2;
  // South rooms into the hall
  f.edgesH[edgeHIdx(f, 9, 16)] = 2;
  f.edgesH[edgeHIdx(f, 17, 16)] = 2;
  f.edgesH[edgeHIdx(f, 28, 16)] = 2;
  // Main entrance on the west end of the hall
  f.edgesV[edgeVIdx(f, 6, 14)] = 2;
  // The office fronts the hall in glass, with its door left where it was — the
  // partition still bounds the room for flood fill, it just isn't opaque.
  edgeRunH(f, 6, 12, 16, EDGE_GLASS);
  f.edgesH[edgeHIdx(f, 9, 16)] = EDGE_DOOR;
  // Labels
  assignRoom(f, 7, 8, 'Room 101', ROOM_COLORS[0]);
  assignRoom(f, 14, 8, 'Room 102', ROOM_COLORS[1]);
  assignRoom(f, 21, 8, 'Room 103', ROOM_COLORS[2]);
  // The east classroom is the stair hall — it's where the run to Level 2 lands,
  // and a school puts its stairs in a room built for them rather than in the
  // corner of a classroom.
  assignRoom(f, 28, 8, 'Stair Hall', '#dcd7cc');
  assignRoom(f, 8, 14, 'Main Hall', '#e9e4da');
  assignRoom(f, 8, 18, 'Office', ROOM_COLORS[4]);
  assignRoom(f, 16, 18, 'Room 105', ROOM_COLORS[5]);
  assignRoom(f, 28, 18, 'Room 106', ROOM_COLORS[6]);

  // A polygon room off the east end of the hall: five walls, none of them
  // square to the grid. Its west wall lands exactly on the grid's east shell
  // (x = 34 cells = 136ft), so the two systems share one line — the grid keeps
  // that wall and the doorway through it, and the polygon leaves the segment
  // open rather than drawing a second wall in the same place.
  const commons = addShape(s, 0, [
    { x: 136, z: 52 }, { x: 160, z: 44 }, { x: 172, z: 60 },
    { x: 154, z: 74 }, { x: 136, z: 64 },
  ], { name: 'Learning Commons', color: ROOM_COLORS[7] });
  if (commons) {
    const ring = commons.rings[0];
    const shared = ring.pts.findIndex((p, i) => {
      const q = ring.pts[(i + 1) % ring.pts.length];
      return p.x === 136 && q.x === 136;
    });
    if (shared >= 0) setSegWall(commons, 0, shared, 0);
    // ...and an exterior door on the far side, so the room reads as a room.
    addOpening(commons, 0, (shared + 2) % ring.pts.length, 0.5);
    // Its north-east wall is a glazed curtain wall: a polygon segment carrying
    // SEG_GLASS, the polygon half of the same feature the office front is.
    setSegWall(commons, 0, (shared + 1) % ring.pts.length, SEG_GLASS);
  }
  f.edgesV[edgeVIdx(f, 34, 14)] = 2;

  // Room 101 (x 24-52ft, z 28-52ft; the door is on its south wall into the
  // hall) gets furnished — a first exercise of the prop layer, and proof it
  // renders before anything else gets built on top of it. Two rows of desks
  // facing the teacher's, up front by the north wall.
  const chairFacingNorth = Math.PI; // local +Z toward -Z world = faceDirection(0, -1)
  [30, 36, 42].forEach((x) => {
    [37, 43].forEach((z) => {
      addProp(s, 'student-desk', { x, z, floor: 0 });
      addProp(s, 'student-chair', { x, z: z + 1.6, rotationY: chairFacingNorth, floor: 0 });
    });
  });
  addProp(s, 'teacher-desk', { x: 38, z: 30.5, floor: 0 });
  addProp(s, 'teacher-chair', { x: 38, z: 32.2, rotationY: chairFacingNorth, floor: 0 });
  addProp(s, 'bookshelf-full', { x: 25, z: 40, rotationY: HALF_PI, floor: 0 }); // faces east, into the room
  addProp(s, 'rug', { x: 36, z: 41, floor: 0 });
  // Flush against the north wall (WALL_T/2 + the panel's own depth/2 out from it).
  addProp(s, 'whiteboard', { x: 38, z: 28.325, y: 3.6, rotationY: 0, mount: 'wall', floor: 0 });

  buildUpperLevel(s);
  s.currentFloor = 0;   // open on the ground floor whatever the builder left
  return s;
}

// Level 2: the same footprint again — a school's upper floor usually is — with
// the middle of the hall left open as a two-storey atrium. That void is what
// makes the upper corridor a mezzanine: a railed edge you can look over into
// the hall below, which is the Phase 4 feature that has no geometry of its own.
// The guardrail around it isn't drawn here; placing the opening is what puts it
// there, on every side that has floor to stand on.
function buildUpperLevel(s) {
  const at = addFloor(s);
  if (at < 0) return;
  const up = s.floors[at];

  floorRect(up, 6, 13, 33, 15);                                   // upper hall
  for (let r = 0; r < 4; r++) floorRect(up, 6 + r * 7, 7, 12 + r * 7, 12);
  floorRect(up, 6, 16, 15, 21);
  floorRect(up, 16, 16, 33, 21);

  wallRect(up, 6, 7, 33, 21);
  for (let r = 1; r < 4; r++) edgeRunV(up, 6 + r * 7, 7, 12, EDGE_WALL);
  edgeRunV(up, 16, 16, 21, EDGE_WALL);
  edgeRunH(up, 6, 33, 13, EDGE_WALL);
  edgeRunH(up, 6, 33, 16, EDGE_WALL);
  // The media centre fronts the corridor in glass — the upstairs echo of the
  // office below, and the case the wishlist called out: it separates the two
  // rooms visually while still bounding both of them.
  edgeRunH(up, 13, 19, 13, EDGE_GLASS);
  for (const x of [8, 16, 23, 30]) up.edgesH[edgeHIdx(up, x, 13)] = EDGE_DOOR;
  for (const x of [10, 24]) up.edgesH[edgeHIdx(up, x, 16)] = EDGE_DOOR;

  assignRoom(up, 8, 8, 'Room 201', ROOM_COLORS[1]);
  assignRoom(up, 16, 8, 'Media Center', ROOM_COLORS[2]);
  assignRoom(up, 23, 8, 'Room 203', ROOM_COLORS[3]);
  assignRoom(up, 30, 8, 'Stair Hall', '#dcd7cc');
  assignRoom(up, 8, 14, 'Upper Hall', '#e9e4da');
  assignRoom(up, 10, 18, 'Room 205', ROOM_COLORS[5]);
  assignRoom(up, 24, 18, 'Room 206', ROOM_COLORS[6]);

  // The stair: bottom step at (110, 40) in the ground-floor stair hall, climbing
  // east. Its run and the opening it cuts upstairs both come out of stairs.js —
  // nothing here picks a length, because the storey height already decided it.
  addStair(s, 0, { x: 110, z: 40, rotationY: HALF_PI, width: 4 });

  // ...and the atrium: 32ft of the hall left open through both storeys, with
  // 4ft of corridor either side of it to walk round.
  addStair(s, 0, { type: 'opening', x: 72, z: 58, w: 32, d: 4 });
}
