// sample.js — the first-run demo school.
//
// Lives outside grid.js because it draws from every representation the editor
// has: a rectilinear grid core (fast to lay out, and what the grid is for), one
// polygon room hung off the east end of the hall, furniture in Room 101, and —
// since Phase 4 — a second storey reached by a real staircase, with a railed
// mezzanine over the main hall and glazed partitions on both levels. Opening
// the tool should show you what it can do, not a blank lattice.
//
// Phase 2 of the second arc adds the rest of a believable shell to it: windows
// down every exterior classroom wall, a double door at the main entrance, an
// elevator beside the stair, a curved wall on the Learning Commons, and a
// floor finish per room. All of it is placed the same way anyone would place
// it with the tools — no sample-only shortcuts.
//
// Phase 5 adds the twenty acres it stands on: a bus loop up to the west
// entrance, a staff lot, walks, a blacktop with a full-size basketball court,
// a playground, a soccer pitch, planting, and enough grade on it that the
// field sits a few feet above the car park. Same rule as everything else here
// — every one of them is a region anyone could draw with the site tool, and
// every marking on them is computed rather than placed.

import {
  ROOM_COLORS, createState, setTile, floodRegion, cellIdx, edgeHIdx, edgeVIdx,
  EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_WINDOW, addFloor,
} from './grid.js';
import {
  addShape, setSegWall, addOpening, curveSegment, SEG_GLASS, LEAF_SINGLE, OP_WINDOW,
} from './shapes.js';
import { addProp } from './props.js';
import { addStair } from './stairs.js';
import { applyFinish } from './finish.js';
import { addRegion } from './site.js';
import { terrainFor, raiseTerrain, smoothTerrain } from './terrain.js';
import { ensureRoof } from './roof.js';

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

// Name, tint and finish a whole grid region at once — the same four fields the
// room tool writes, since a grid room is a flood-fill label rather than an
// object to hang them on.
function assignRoom(f, x, y, name, color, fin = null, paint = null) {
  for (const c of floodRegion(f, x, y)) {
    const cell = f.cells[cellIdx(f, c.x, c.y)];
    cell.room = name;
    cell.color = color;
    applyFinish(cell, fin, paint);
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
  // Main entrance on the west end of the hall: a pair, which is what an
  // entrance is, and what the lattice's EDGE_DOOR2 exists for.
  f.edgesV[edgeVIdx(f, 6, 14)] = EDGE_DOOR2;
  // Windows down every exterior classroom wall — the north face for the four
  // rooms above the hall, the south face for the three below it. A window is
  // a glazed band in a wall, not a hole in it: it lights the room and you
  // still can't walk out of one.
  for (let r = 0; r < 4; r++) edgeRunH(f, 7 + r * 7, 11 + r * 7, 7, EDGE_WINDOW);
  edgeRunH(f, 7, 11, 22, EDGE_WINDOW);    // office
  edgeRunH(f, 14, 21, 22, EDGE_WINDOW);   // room 105
  edgeRunH(f, 24, 32, 22, EDGE_WINDOW);   // room 106
  // The office fronts the hall in glass, with its door left where it was — the
  // partition still bounds the room for flood fill, it just isn't opaque.
  edgeRunH(f, 6, 12, 16, EDGE_GLASS);
  f.edgesH[edgeHIdx(f, 9, 16)] = EDGE_DOOR;
  // Labels and finishes. Classrooms are VCT (the default, so they say nothing
  // about it), the halls are terrazzo, the office is carpet — which is roughly
  // how a real school is specified, and enough to put three rows in the plan's
  // finish schedule.
  assignRoom(f, 7, 8, 'Room 101', ROOM_COLORS[0]);
  assignRoom(f, 14, 8, 'Room 102', ROOM_COLORS[1]);
  assignRoom(f, 21, 8, 'Room 103', ROOM_COLORS[2]);
  // The east classroom is the stair hall — it's where the run to Level 2 lands,
  // and a school puts its stairs in a room built for them rather than in the
  // corner of a classroom.
  assignRoom(f, 28, 8, 'Stair Hall', '#dcd7cc', 'terrazzo');
  assignRoom(f, 8, 14, 'Main Hall', '#e9e4da', 'terrazzo');
  assignRoom(f, 8, 18, 'Office', ROOM_COLORS[4], 'carpet', '#dfe7ea');
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
  ], { name: 'Learning Commons', color: ROOM_COLORS[7], fin: 'wood' });
  if (commons) {
    const ring = commons.rings[0];
    const n0 = ring.pts.length;
    const shared = ring.pts.findIndex((p, i) => {
      const q = ring.pts[(i + 1) % n0];
      return p.x === 136 && q.x === 136;
    });
    if (shared >= 0) setSegWall(commons, 0, shared, 0);
    // ...and an exterior door on the far side, so the room reads as a room.
    addOpening(commons, 0, (shared + 2) % n0, 0.5, null, { leaf: LEAF_SINGLE });
    // Its north-east wall is a glazed curtain wall: a polygon segment carrying
    // SEG_GLASS, the polygon half of the same feature the office front is.
    setSegWall(commons, 0, (shared + 1) % n0, SEG_GLASS);
    // ...and a window in the wall opposite, because a room this size with one
    // glazed face and no other opening is a corridor with ambitions.
    addOpening(commons, 0, (shared + 4) % n0, 0.5, 10, { k: OP_WINDOW, sill: 2.5 });
    // The south wall bows out. Curving tessellates it into chords in place
    // (see shapes.js), so from here on it is an ordinary polygon wall that
    // happens to have a lot of corners — which is exactly the point.
    curveSegment(commons, 0, (shared + 3) % n0, 0.3);
  }
  f.edgesV[edgeVIdx(f, 34, 14)] = 2;

  // Room 101 (x 24-52ft, z 28-52ft) gets furnished — a first exercise of the
  // prop layer, and proof it renders before anything else gets built on top of
  // it. The room faces the corridor wall rather than the exterior one, which
  // is what a classroom with windows down one side actually does: the board
  // goes on the solid wall, and nobody teaches into the daylight.
  const chairFacingSouth = 0;       // local +Z toward +Z world
  const facingNorth = Math.PI;      // ...and the other way, back at the class
  [30, 36, 42].forEach((x) => {
    [37, 43].forEach((z) => {
      addProp(s, 'student-desk', { x, z, floor: 0 });
      addProp(s, 'student-chair', { x, z: z - 1.6, rotationY: chairFacingSouth, floor: 0 });
    });
  });
  addProp(s, 'teacher-desk', { x: 44, z: 48.5, rotationY: facingNorth, floor: 0 });
  addProp(s, 'teacher-chair', { x: 44, z: 50.2, rotationY: facingNorth, floor: 0 });
  addProp(s, 'bookshelf-full', { x: 25, z: 34, rotationY: HALF_PI, floor: 0 }); // faces east, into the room
  addProp(s, 'rug', { x: 36, z: 41, floor: 0 });
  // Flush against the corridor wall at z = 52 (half a partition plus the
  // panel's own depth out from it), facing back into the room.
  addProp(s, 'whiteboard', { x: 44, z: 51.7, y: 3.6, rotationY: facingNorth, mount: 'wall', floor: 0 });
  // Phase 3: the room is lit by its own fixtures rather than by an assumption.
  // Four 2x4 troffers on a 12ft bay, plus an exit sign over the doorway and a
  // pole light out front, so the sample school has something to *show* the
  // moment somebody drags the clock to the evening.
  [30, 46].forEach((x) => {
    [35, 47].forEach((z) => {
      addProp(s, 'troffer-2x4', { x, z, y: 9.5, mount: 'ceiling', floor: 0 });
    });
  });
  addProp(s, 'sign-exit', { x: 38, z: 51.8, y: 7.5, rotationY: facingNorth, mount: 'wall', floor: 0 });
  addProp(s, 'light-pole', { x: 12, z: 74, floor: 0 });
  addProp(s, 'light-pole', { x: 12, z: 106, floor: 0 });

  // Phase 4 of the second arc: the things that make the noise, so the sample
  // school has something to *hear* the moment somebody presses B — the same
  // argument the troffers above got for the sun. Everything here is on the
  // hall's north wall (z = 52) or the ceiling above it, facing south into the
  // hall at rotationY 0.
  const facingSouth = 0;
  addProp(s, 'bell-corridor', { x: 56, z: 52.3, y: 8.4, rotationY: facingSouth, mount: 'wall', floor: 0 });
  addProp(s, 'speaker-pa', { x: 100, z: 52.3, y: 8, rotationY: facingSouth, mount: 'wall', floor: 0 });
  addProp(s, 'fountain', { x: 84, z: 53.2, rotationY: facingSouth, floor: 0 });
  addProp(s, 'vending', { x: 118, z: 53.6, rotationY: facingSouth, floor: 0 });
  addProp(s, 'clock-wall', { x: 40, z: 51.7, y: 7, rotationY: facingNorth, mount: 'wall', floor: 0 });
  addProp(s, 'diffuser-hvac', { x: 38, z: 41, y: 9.6, mount: 'ceiling', floor: 0 });
  addProp(s, 'diffuser-hvac', { x: 40, z: 54, y: 9.6, mount: 'ceiling', floor: 0 });
  // ...and two panels of the one product that makes a room quieter, on the
  // wall of the loudest room in the building. Walk in, look at the sound
  // panel, delete them, and watch the number go up.
  addProp(s, 'panel-acoustic', { x: 32, z: 52.3, y: 3, rotationY: facingSouth, mount: 'wall', floor: 0 });
  addProp(s, 'panel-acoustic', { x: 128, z: 52.3, y: 3, rotationY: facingSouth, mount: 'wall', floor: 0 });

  buildUpperLevel(s);
  buildSampleSite(s);
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
  // The upper floor gets the same window walls as the one below it.
  for (let r = 0; r < 4; r++) edgeRunH(up, 7 + r * 7, 11 + r * 7, 7, EDGE_WINDOW);
  edgeRunH(up, 7, 14, 22, EDGE_WINDOW);
  edgeRunH(up, 17, 32, 22, EDGE_WINDOW);

  assignRoom(up, 8, 8, 'Room 201', ROOM_COLORS[1]);
  assignRoom(up, 16, 8, 'Media Center', ROOM_COLORS[2], 'carpet');
  assignRoom(up, 23, 8, 'Room 203', ROOM_COLORS[3]);
  assignRoom(up, 30, 8, 'Stair Hall', '#dcd7cc', 'terrazzo');
  assignRoom(up, 8, 14, 'Upper Hall', '#e9e4da', 'terrazzo');
  assignRoom(up, 10, 18, 'Room 205', ROOM_COLORS[5]);
  assignRoom(up, 24, 18, 'Room 206', ROOM_COLORS[6]);

  // The upper hall gets its own speaker — a PA that only reaches one storey is
  // half a PA, and it is the second source in the design far enough from the
  // first to prove the slab between them costs something.
  addProp(s, 'speaker-pa', { x: 60, z: 52.3, y: 8, rotationY: 0, mount: 'wall', floor: at });

  // The stair: bottom step at (110, 40) in the ground-floor stair hall, climbing
  // east. Its run and the opening it cuts upstairs both come out of stairs.js —
  // nothing here picks a length, because the storey height already decided it.
  addStair(s, 0, { x: 110, z: 40, rotationY: HALF_PI, width: 4 });

  // ...and a lift beside it, because a school with a stair and no elevator has
  // an upper floor half its occupants can't reach. It cuts nothing: the car
  // stands on the slab at each end, and `E` inside it rides between them.
  addStair(s, 0, { type: 'elevator', x: 124, z: 30, rotationY: HALF_PI });

  // ...and the atrium: 32ft of the hall left open through both storeys, with
  // 4ft of corridor either side of it to walk round.
  addStair(s, 0, { type: 'opening', x: 72, z: 58, w: 32, d: 4 });
}

// ---------- the site ----------

// A rectangle in world feet, wound the way `makeRegion` wants it.
const rect = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];

// The building runs x 24..136, z 28..88, and its main entrance is the double
// door on the *west* face at (24, 58) — which is what decides where the bus
// loop goes and, downstream of that, where everything else does.
function buildSampleSite(s) {
  // A site big enough for a pitch. `terrainFor`'s default margin is 200ft,
  // which is a car park; a soccer field needs twice that.
  s.terrain = terrainFor(s, 400);
  // Gentle relief, and all of it in the right places: the playing field sits
  // up on a shelf, the car park sits a little below the entrance so the walk
  // to the door runs downhill for a bus and up for a car, and a berm screens
  // the lot from the road. Nothing steeper than a walk can take.
  raiseTerrain(s.terrain, 360, 115, 200, 6);
  raiseTerrain(s.terrain, -120, 180, 190, -3.5);
  raiseTerrain(s.terrain, -250, 60, 140, 7);
  smoothTerrain(s.terrain, 60, 120, 200, 0.6);

  // Lawn first, everything else on top of it: regions stack in list order, so
  // the ground cover is simply the one drawn underneath.
  addRegion(s, rect(-260, -240, 560, 420), { surf: 'turf', name: 'Lawn' });

  // The bus loop, running west to east up to the entrance, with a dashed
  // centre line and a crossing where the walk cuts it.
  addRegion(s, rect(-150, 40, 22, 78), { surf: 'asphalt', mark: 'lane', name: 'Bus loop' });
  addRegion(s, rect(-62, 40, -48, 78), { surf: 'asphalt', mark: 'crosswalk', name: 'Crossing' });

  // Staff and visitor parking, south of the loop.
  addRegion(s, rect(-212, 110, -32, 250), { surf: 'asphalt', mark: 'stalls', name: 'Staff lot' });
  addRegion(s, rect(-48, 78, -32, 250), { surf: 'concrete', name: 'Lot walk' });

  // The entrance plaza and the walks off it.
  addRegion(s, rect(-2, 38, 26, 82), { surf: 'concrete', name: 'Entry plaza' });
  addRegion(s, rect(12, 16, 22, 100), { surf: 'concrete', name: 'West walk' });
  addRegion(s, rect(18, 16, 146, 26), { surf: 'concrete', name: 'North walk' });
  addRegion(s, rect(136, 26, 146, 100), { surf: 'concrete', name: 'East walk' });
  addRegion(s, rect(28, 92, 74, 104), { surf: 'garden', name: 'Entry planting' });

  // The blacktop: a full-size court at 84 by 50, and it fits because the
  // region is bigger than one — draw it smaller and the court shrinks with it.
  addRegion(s, rect(20, 150, 136, 236), { surf: 'court', mark: 'basketball', name: 'Blacktop' });
  addRegion(s, rect(148, 158, 180, 190), { surf: 'asphalt', mark: 'foursquare', name: 'Games' });
  addRegion(s, rect(148, 200, 182, 216), { surf: 'asphalt', mark: 'hopscotch', name: 'Games' });

  // Playground, on the safety surface a playground stands on.
  addRegion(s, rect(16, 252, 116, 336), { surf: 'mulch', name: 'Playground' });

  // ...and the field, up on its shelf.
  addRegion(s, rect(190, 14, 530, 214), { surf: 'field', mark: 'soccer', name: 'Playing field' });
  addRegion(s, rect(190, 226, 300, 260), { surf: 'gravel', name: 'Maintenance yard' });

  // --- what stands on it ---
  const P = (type, x, z, rotationY = 0) => addProp(s, type, { x, z, rotationY, floor: 0 });

  // Shade trees down the bus loop and through the car park islands, an
  // evergreen screen on the berm, and something ornamental at the door.
  for (let i = 0; i < 6; i++) P('tree-shade', -140 + i * 30, 22, 0);
  for (let i = 0; i < 4; i++) P('tree-shade', -196 + i * 46, 96, 0);
  for (let i = 0; i < 5; i++) P('tree-conifer', -246, 20 + i * 34, 0);
  P('tree-ornamental', 34, 34, 0);
  P('tree-ornamental', 34, 86, 0);
  P('tree-young', 152, 120, 0);
  P('tree-columnar', 150, 32, 0);
  P('tree-columnar', 150, 60, 0);
  for (let i = 0; i < 5; i++) P('hedge-run', 30 + i * 7, 98, 0);
  for (let i = 0; i < 3; i++) P('shrub-round', 6 + i * 6, 36, 0);
  P('planter-concrete', 6, 46, 0);
  P('planter-concrete', 6, 74, 0);
  P('boulder', 122, 104, 0.6);
  P('grass-ornamental', 128, 110, 0);

  // The entrance itself.
  P('flagpole', 2, 58, 0);
  P('bike-rack', 30, 108, 0);
  P('bike-rack', 38, 108, 0);
  P('bench-outdoor', 16, 40, 0);
  P('bus-shelter', -40, 30, 0);
  P('sign-marquee', -70, 96, 0);
  P('trash-outdoor', 20, 84, 0);
  for (let i = 0; i < 4; i++) P('bollard', -6 + i * 8, 36, 0);

  // Parking lot lighting and the service yard.
  P('light-pole', -122, 148, 0);
  P('light-pole', -122, 212, 0);
  P('light-pole', -60, 58, 0);
  P('dumpster', 214, 240, Math.PI / 2);
  for (let i = 0; i < 4; i++) P('fence-chain', 190 + i * 10, 226, 0);

  // The playground.
  P('climber', 46, 288, 0);
  P('slide', 88, 276, Math.PI);
  P('swing-set', 84, 316, 0);
  P('sandbox', 26, 320, 0);
  P('picnic-table', 24, 262, 0);
  P('picnic-table', 24, 276, 0);
  P('pergola', 96, 244, 0);

  // The court and the field.
  P('hoop-pole', 32, 193, HALF_PI);
  P('hoop-pole', 124, 193, -HALF_PI);
  P('tetherball', 168, 230, 0);
  P('soccer-goal', 200, 114, HALF_PI);
  P('soccer-goal', 520, 114, -HALF_PI);
  P('bleacher-outdoor', 360, 224, Math.PI);
  P('bleacher-outdoor', 388, 224, Math.PI);

  // The sample is brick, because a school built in the years this plan comes
  // from is brick.
  ensureRoof(s).facade = 'brick';
}
