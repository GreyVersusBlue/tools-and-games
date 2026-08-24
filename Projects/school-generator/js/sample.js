// sample.js — the first-run demo school.
//
// Lives outside grid.js because it draws from both room representations: a
// rectilinear grid core (fast to lay out, and what the grid is for) plus one
// polygon room hung off the east end of the hall, so the polygon tools have
// something angled to open with rather than a blank lattice.

import {
  ROOM_COLORS, createState, setTile, floodRegion, cellIdx, edgeHIdx, edgeVIdx,
} from './grid.js';
import { addShape, setSegWall, addOpening } from './shapes.js';
import { addProp } from './props.js';

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
  // Labels
  assignRoom(f, 7, 8, 'Room 101', ROOM_COLORS[0]);
  assignRoom(f, 14, 8, 'Room 102', ROOM_COLORS[1]);
  assignRoom(f, 21, 8, 'Room 103', ROOM_COLORS[2]);
  assignRoom(f, 28, 8, 'Room 104', ROOM_COLORS[3]);
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

  return s;
}
