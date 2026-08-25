// The scavenger hunt. Pure module, so all of it runs headless: what gets
// hidden where, what the hint says about it, and what counts as finding it.
//
// The claims worth holding are the ones a player would notice and a reader
// would not: the same seed hides the same things in the same places, a hunt
// spreads itself across the building rather than filling one corridor, a hint
// names a room and a corner rather than a coordinate, and standing directly
// above something is not finding it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, setTile, edgeHIdx, edgeVIdx, EDGE_WALL, CELL } from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import {
  HUNT_ITEMS, WARMTH_BANDS, DEFAULT_COUNT, MIN_COUNT, MAX_COUNT,
  FIND_R, REVEAL_R, MIN_TILE_SIDE, FLOOR_FEET,
  roomBounds, quadrantOf, describePlace, huntCandidates, hidingPlaces,
  startHunt, checkFind, huntWarmth, nearestHidden, revealAt, huntSummary,
  bandFor, apparentDistance, unfound,
} from '../js/hunt.js';

const school = () => buildSampleSchool(createState(40, 40));
const navOf = (s) => buildNav(s);

// One walled room, for the tests that want to know exactly where the corners
// are: cells 2..11 in both axes, so 8ft in from x = 8 and z = 8.
function oneRoom() {
  const s = createState(20, 20);
  const f = s.floors[0];
  for (let y = 2; y <= 11; y++) for (let x = 2; x <= 11; x++) setTile(f, x, y, true);
  for (let x = 2; x <= 11; x++) {
    f.edgesH[edgeHIdx(f, x, 2)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 12)] = EDGE_WALL;
  }
  for (let y = 2; y <= 11; y++) {
    f.edgesV[edgeVIdx(f, 2, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 12, y)] = EDGE_WALL;
  }
  return s;
}

// ---------- the table ----------

test('the items are distinct, named and iconed', () => {
  const keys = new Set();
  for (const i of HUNT_ITEMS) {
    assert.ok(i.key && !keys.has(i.key), `${i.key} is missing or repeated`);
    keys.add(i.key);
    assert.ok(i.name && i.icon, `${i.key} needs a name and an icon`);
  }
  assert.ok(HUNT_ITEMS.length >= DEFAULT_COUNT, 'a default hunt has no repeats in it');
});

test('the warmth bands run coldest last and end at infinity', () => {
  let last = -1;
  for (const b of WARMTH_BANDS) {
    assert.ok(b.within > last, `${b.key} is not further out than the one before it`);
    last = b.within;
  }
  assert.equal(WARMTH_BANDS[WARMTH_BANDS.length - 1].within, Infinity, 'nothing is off the scale');
  assert.equal(bandFor(0).key, 'burning');
  assert.equal(bandFor(1e9).key, 'freezing');
});

// ---------- where a room is ----------

test('a room bounds to the union of its tiles', () => {
  const nav = navOf(oneRoom());
  const roomId = [...nav.mesh[0].byRoom.keys()][0];
  const b = roomBounds(nav.mesh[0], roomId);
  assert.equal(b.x0, 2 * CELL);
  assert.equal(b.z0, 2 * CELL);
  assert.equal(b.x1, 12 * CELL);
  assert.equal(b.z1, 12 * CELL);
});

test('the quadrant is north-west at the low corner and empty in the middle', () => {
  const b = { x0: 0, z0: 0, x1: 90, z1: 90 };
  assert.equal(quadrantOf(b, 5, 5), 'north-west');
  assert.equal(quadrantOf(b, 85, 85), 'south-east');
  assert.equal(quadrantOf(b, 45, 5), 'north', '+z is south, the way the plan sheet has it');
  assert.equal(quadrantOf(b, 85, 45), 'east');
  assert.equal(quadrantOf(b, 45, 45), '');
  assert.equal(quadrantOf(null, 1, 1), '');
});

test('a hint names a room, a corner and — only when there is one — a storey', () => {
  const b = { x0: 0, z0: 0, x1: 90, z1: 90 };
  assert.equal(describePlace(b, 5, 5, 'the Gym', 0, 1), 'the north-west corner of the Gym');
  assert.equal(describePlace(b, 45, 45, 'the Gym', 1, 3), 'the middle of the Gym, on Level 2');
  assert.equal(describePlace(b, 85, 45, 'the Gym', 0, 2), 'the east end of the Gym, on Level 1');
  assert.equal(describePlace(b, 45, 45, '', 0, 1), 'the middle of an unnamed room');
});

// ---------- choosing the places ----------

test('every candidate room has a tile big enough to hide something on', () => {
  const nav = navOf(school());
  const rooms = huntCandidates(nav);
  assert.ok(rooms.length >= 6, 'the sample school has rooms in it');
  for (const r of rooms) {
    assert.ok(r.tiles.length, `${r.room} has tiles`);
    for (const t of r.tiles) {
      assert.ok(t.x1 - t.x0 >= MIN_TILE_SIDE && t.z1 - t.z0 >= MIN_TILE_SIDE,
        'a tile too small to have corners is not a hiding place');
    }
    assert.ok(r.tiles[0].area >= r.tiles[r.tiles.length - 1].area, 'biggest tile first');
  }
});

test('the same seed hides the same things in the same places', () => {
  const nav = navOf(school());
  const a = hidingPlaces(nav, { seed: 12 });
  const b = hidingPlaces(nav, { seed: 12 });
  assert.deepEqual(a, b);
  const c = hidingPlaces(nav, { seed: 13 });
  assert.notDeepEqual(a.map((p) => `${p.x},${p.z}`), c.map((p) => `${p.x},${p.z}`));
});

test('a hunt spreads across the building rather than filling one room', () => {
  const nav = navOf(school());
  for (const seed of [1, 2, 3, 4, 5]) {
    const places = hidingPlaces(nav, { seed });
    assert.equal(places.length, DEFAULT_COUNT, `seed ${seed} dealt a full hunt`);
    const rooms = new Set(places.map((p) => p.room));
    assert.equal(rooms.size, places.length, `seed ${seed} used a different room for each`);
    assert.equal(new Set(places.map((p) => p.id)).size, places.length, 'ids are unique');
    assert.equal(new Set(places.map((p) => p.item)).size, places.length, 'so are the things');
  }
});

test('a two-storey school hides things on both storeys', () => {
  const nav = navOf(school());
  // Not every seed has to, but over a handful of them both floors must appear —
  // a hunt that never sends anybody upstairs is a hunt around one floor.
  const floors = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    for (const p of hidingPlaces(nav, { seed })) floors.add(p.floor);
  }
  assert.ok(floors.size > 1, 'both storeys get used');
});

test('a one-room design still gets a hunt, just a shorter one', () => {
  const places = hidingPlaces(navOf(oneRoom()), { seed: 4, count: 8 });
  assert.ok(places.length >= 1 && places.length <= 2,
    `one room holds one or two places, not ${places.length}`);
  const spots = new Set(places.map((p) => `${p.x},${p.z}`));
  assert.equal(spots.size, places.length, 'and never two in the same spot');
});

test('a design with nothing drawn in it hides nothing rather than throwing', () => {
  assert.deepEqual(hidingPlaces(navOf(createState(10, 10)), { seed: 1 }), []);
  assert.deepEqual(hidingPlaces(null, { seed: 1 }), []);
  const h = startHunt(navOf(createState(10, 10)));
  assert.deepEqual(h.places, []);
  assert.equal(huntWarmth(h, { x: 0, z: 0, floor: 0 }), null);
  assert.deepEqual(huntSummary(h), { found: 0, total: 0, done: false });
});

test('the count is clamped rather than believed', () => {
  const nav = navOf(school());
  assert.equal(hidingPlaces(nav, { seed: 1, count: 0 }).length, MIN_COUNT);
  assert.ok(hidingPlaces(nav, { seed: 1, count: 500 }).length <= MAX_COUNT);
  assert.equal(hidingPlaces(nav, { seed: 1, count: NaN }).length, DEFAULT_COUNT);
});

test('a spot the caller refuses is never used', () => {
  const nav = navOf(school());
  // Refuse the whole ground floor: everything must end up upstairs.
  const places = hidingPlaces(nav, { seed: 5, clear: (x, z, floor) => floor > 0 });
  assert.ok(places.length, 'there is still somewhere to hide things');
  for (const p of places) assert.ok(p.floor > 0, `${p.name} is on a floor the caller allowed`);
  // Refuse everything and the hunt is empty rather than wrong.
  assert.deepEqual(hidingPlaces(nav, { seed: 5, clear: () => false }), []);
});

test('a hiding place sits inside the room it names', () => {
  const nav = navOf(school());
  for (const p of hidingPlaces(nav, { seed: 9 })) {
    const b = roomBounds(nav.mesh[p.floor], p.room);
    assert.ok(p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1,
      `${p.name} is inside ${p.roomName || p.room}`);
    assert.ok(p.hint.includes(p.roomName || 'an unnamed room'), 'and the hint says so');
  }
});

// ---------- playing it ----------

test('finding something needs the right storey as well as the right spot', () => {
  const nav = navOf(school());
  const h = startHunt(nav, { seed: 2 });
  const p = h.places[0];
  assert.equal(checkFind(h, { x: p.x, z: p.z, floor: p.floor + 1 }), null,
    'standing directly above the hamster is not finding the hamster');
  assert.equal(h.found.size, 0);
  assert.equal(checkFind(h, { x: p.x, z: p.z, floor: p.floor }).id, p.id);
  assert.equal(h.found.size, 1);
  assert.equal(checkFind(h, { x: p.x, z: p.z, floor: p.floor }), null, 'and only once');
});

test('you have to get within the find radius', () => {
  const nav = navOf(school());
  const h = startHunt(nav, { seed: 2 });
  const p = h.places[0];
  assert.equal(checkFind(h, { x: p.x + FIND_R + 0.5, z: p.z, floor: p.floor }), null);
  assert.ok(checkFind(h, { x: p.x + FIND_R - 0.5, z: p.z, floor: p.floor }));
});

test('warmth reads off the nearest thing still hidden', () => {
  const nav = navOf(school());
  const h = startHunt(nav, { seed: 2 });
  const p = h.places[0];
  const on = { x: p.x, z: p.z, floor: p.floor };
  assert.equal(huntWarmth(h, on).key, 'burning');
  assert.equal(nearestHidden(h, on).place.id, p.id);
  // Find it, and the reading is about something else — further away.
  checkFind(h, on);
  assert.notEqual(nearestHidden(h, on).place.id, p.id);
  assert.ok(huntWarmth(h, on).dist > 0);
  assert.equal(unfound(h).length, h.places.length - 1);
});

test('a storey between you and it counts as distance', () => {
  const a = { id: 'x', floor: 2, x: 0, z: 0 };
  assert.equal(apparentDistance(a, { x: 0, z: 0, floor: 2 }), 0);
  assert.equal(apparentDistance(a, { x: 0, z: 0, floor: 1 }), FLOOR_FEET);
  assert.equal(apparentDistance(a, { x: 3, z: 4, floor: 0 }), 5 + 2 * FLOOR_FEET);
});

test('warmth is null once everything has been found, and the hunt says done', () => {
  const nav = navOf(school());
  const h = startHunt(nav, { seed: 2 });
  for (const p of [...h.places]) checkFind(h, { x: p.x, z: p.z, floor: p.floor });
  assert.equal(huntWarmth(h, { x: 0, z: 0, floor: 0 }), null);
  const sum = huntSummary(h);
  assert.equal(sum.found, sum.total);
  assert.equal(sum.done, true);
});

test('a token fades in over the last stretch and never through a slab', () => {
  const p = { id: 'x', floor: 1, x: 0, z: 0 };
  assert.equal(revealAt(p, { x: 0, z: REVEAL_R, floor: 1 }), 0, 'right at the edge, nothing');
  assert.equal(revealAt(p, { x: 0, z: REVEAL_R + 5, floor: 1 }), 0);
  assert.equal(revealAt(p, { x: 0, z: 0, floor: 1 }), 1, 'on top of it, all of it');
  assert.equal(revealAt(p, { x: 0, z: FIND_R, floor: 1 }), 1, 'and by the time you could find it');
  const half = revealAt(p, { x: 0, z: (REVEAL_R + FIND_R) / 2, floor: 1 });
  assert.ok(half > 0.4 && half < 0.6, `halfway is halfway (${half})`);
  assert.equal(revealAt(p, { x: 0, z: 0, floor: 0 }), 0, 'a storey away is invisible');
});
