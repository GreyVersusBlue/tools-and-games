// Tests for bakelight.js — light that stops at walls, computed offline.
//
// The fixtures are drawn on a scratch lattice and baked, the state the
// editor actually produces. What is worth being sure of is exactly what the
// live path gets wrong: a wall is dark on its far side, a doorway spills, a
// window admits the sky at its band and a clerestory still counts, the two
// channels recombine without re-running, and the whole thing is
// deterministic enough to be a cache — same design, same bytes, same key.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import { EDGE_DOOR, EDGE_GLASS } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addOpening, OP_WINDOW } from '../js/shapes.js';
import { addProp } from '../js/props.js';
import { buildSampleSchool } from '../js/sample.js';
import { catalogEntry } from '../js/catalog.js';
import {
  BAKE_VERSION, BAKE_CELL, BAKE_TINT_MIN,
  bakeKey, bakeLight, dayApertures, sampleBake, bakedTint,
  packBake, unpackBake, encodeBakeText, decodeBakeText,
  bytesToB64, b64ToBytes,
} from '../js/bakelight.js';

// A tiny stand-in catalog, same bargain as the lights suite: the tests
// shouldn't depend on the real table's lumens staying put.
const TEST_ROWS = {
  troffer: { type: 'troffer', emit: { lm: 4000, color: '#fff4e2', range: 26, dy: -0.2 } },
  redlamp: { type: 'redlamp', emit: { lm: 3000, color: '#ff2010', range: 24, dy: 0 } },
  pole: { type: 'pole', site: true, emit: { lm: 12000, color: '#f6f2e4', range: 90, dy: 21 } },
  desk: { type: 'desk' },
};
const testCatalog = (t) => TEST_ROWS[t] || null;

// Two rooms sharing a partition — solid, doored, or glazed, the caller's
// choice — with a fixture in the middle of A and nothing in B.
//
//   A (8..24, 8..24) | B (24..40, 8..24)
function twoRooms(partition = null) {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(2, 2, 5, 5, { name: 'A' });
  sh.box(6, 2, 9, 5, { name: 'B' });
  if (partition) sh.edgeV(6, 3, partition);
  sh.bake();
  addProp(s, 'troffer', { x: 16, z: 16, floor: 0, y: 9 });
  return s;
}

const bakeOf = (s, opts = {}) =>
  bakeLight(s, testCatalog, { troffers: false, ...opts });
const fixAt = (bake, x, z) => {
  const p = sampleBake(bake, 0, x, z);
  return (p.r + p.g + p.b) / 3;
};
const dayAt = (bake, x, z) => sampleBake(bake, 0, x, z).day;

// ---------- the point of the phase ----------

test('a wall is dark on its far side; a doorway spills through', () => {
  const sealed = bakeOf(twoRooms());
  const doored = bakeOf(twoRooms(EDGE_DOOR));

  const inA = fixAt(sealed, 16, 16);
  assert.ok(inA > 0, 'the room with the fixture is lit');
  const inB = fixAt(sealed, 32, 16);
  assert.ok(inB < inA * 0.05,
    `the sealed room stays dark (${inB} vs ${inA}) — this is the whole phase`);

  const inBDoored = fixAt(doored, 32, 16);
  assert.ok(inBDoored > inB, 'a doorway lets light through');
  // ...and what comes through pools by the door rather than filling the room.
  const nearDoor = fixAt(doored, 26, 14);
  const farCorner = fixAt(doored, 38, 22);
  assert.ok(nearDoor > farCorner, 'the spill pools at the doorway');
});

test('glass stops a body and not a photon', () => {
  const sealed = bakeOf(twoRooms());
  const glazed = bakeOf(twoRooms(EDGE_GLASS));
  assert.ok(fixAt(glazed, 32, 16) > fixAt(sealed, 32, 16) * 10,
    'a glazed partition passes what a solid one blocks');
});

test('light falls off with distance from the fixture', () => {
  const b = bakeOf(twoRooms());
  const under = fixAt(b, 16, 16);
  const corner = fixAt(b, 10, 10);
  assert.ok(under > corner, 'brightest under the pan');
  assert.ok(corner > 0, 'the corner of the same room still reads');
});

test('outdoor fixtures stay out of the bake — they remain real lights', () => {
  const s = twoRooms();
  addProp(s, 'pole', { x: 60, z: 60, floor: 0 });
  const b = bakeOf(s);
  // The pole is 20ft outside the grid's padded bounds anyway; the honest
  // check is that a second bake with the pole differs nowhere.
  const plain = bakeOf(twoRooms());
  assert.deepEqual([...b.floors[0].fix], [...plain.floors[0].fix]);
});

// ---------- the day channel ----------

// One room with outdoors on every side. `win` adds a window on the left wall.
function windowRoom(win = null) {
  const s = createState(20, 20);
  const sh = sheet(s, 0);
  sh.box(3, 3, 8, 8, { name: 'A' });
  sh.bake();
  if (win) {
    const shape = s.floors[0].shapes[0];
    // Find the segment whose run lies on x = 12ft (the left wall).
    const ring = shape.rings[0];
    let seg = -1;
    for (let i = 0; i < ring.pts.length; i++) {
      const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
      if (a.x === 12 && b.x === 12) { seg = i; break; }
    }
    assert.ok(seg >= 0, 'the fixture found its wall');
    assert.ok(addOpening(shape, 0, seg, 0.5, 8, { k: OP_WINDOW, ...win }));
  }
  return s;
}

test('outdoors is full sky; a windowless room is not', () => {
  const b = bakeOf(windowRoom());
  assert.equal(dayAt(b, 4, 4), 1, 'outdoors reads the whole sky');
  const inside = dayAt(b, 24, 24);
  assert.ok(inside < 0.15, `a sealed room barely reads the sky (${inside})`);
});

test('a window admits the sky, most where the window is', () => {
  const dark = bakeOf(windowRoom());
  const lit = bakeOf(windowRoom({}));
  const centre = dayAt(lit, 24, 24);
  assert.ok(centre > dayAt(dark, 24, 24) + 0.1, 'the window admits daylight');
  assert.ok(dayAt(lit, 16, 24) > dayAt(lit, 32, 24),
    'brighter by the window than across the room');
});

test('a clerestory counts for daylight — the sky does not stand at eye height', () => {
  const b = bakeOf(windowRoom({ sill: 6, h: 3 }));
  assert.ok(dayAt(b, 24, 24) > 0.15, 'the high band still admits the sky');
});

test('dayApertures reports the exterior openings and only those', () => {
  const s = windowRoom({});
  const aps = dayApertures(s.floors[0]);
  assert.equal(aps.length, 1, 'one window, one aperture');
  assert.equal(aps[0].x, 12, 'on the left wall');
  // An interior partition's window is not an aperture — borrowed light is
  // the bounce's job, not the sky's.
  const two = twoRooms();
  const shape = two.floors[0].shapes[0];
  const ring = shape.rings[0];
  let seg = -1;
  for (let i = 0; i < ring.pts.length; i++) {
    const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
    if (a.x === 24 && b.x === 24) { seg = i; break; }
  }
  if (seg >= 0 && addOpening(shape, 0, seg, 0.5, 6, { k: OP_WINDOW })) {
    const before = dayApertures(twoRooms().floors[0]).length;
    assert.equal(dayApertures(two.floors[0]).length, before,
      'a window between two rooms adds no sky');
  }
});

// ---------- recombining ----------

test('the channels recombine instead of re-running: sun and lamps scale apart', () => {
  const b = bakeOf(twoRooms());
  const inRoom = sampleBake(b, 0, 16, 16);
  const noon = bakedTint(inRoom, 1, 0);
  const night = bakedTint(inRoom, 0, 1);
  const dead = bakedTint(inRoom, 0, 0);
  assert.ok(night.r > dead.r, 'lamp level lights the fixture channel');
  assert.equal(dead.r, Math.min(1, BAKE_TINT_MIN),
    'both levels at zero is the tint floor, not black');
  assert.ok(noon.r >= dead.r, 'day level never darkens');
  // The floor is a floor everywhere.
  const t = bakedTint({ day: 0, r: 0, g: 0, b: 0 }, 1, 1);
  assert.equal(t.r, BAKE_TINT_MIN);
});

// ---------- a cache has to be honest ----------

test('the bake is deterministic — same design, same numbers', () => {
  const a = bakeOf(twoRooms(EDGE_DOOR));
  const b = bakeOf(twoRooms(EDGE_DOOR));
  assert.equal(a.key, b.key);
  assert.deepEqual([...a.floors[0].day], [...b.floors[0].day]);
  assert.deepEqual([...a.floors[0].fix], [...b.floors[0].fix]);
});

test('the key moves with the structure and with nothing else', () => {
  const base = bakeKey(twoRooms(), testCatalog);
  assert.equal(bakeKey(twoRooms(), testCatalog), base, 'stable across builds');

  const doored = bakeKey(twoRooms(EDGE_DOOR), testCatalog);
  assert.notEqual(doored, base, 'a doorway is a different bake');

  const renamed = twoRooms();
  renamed.floors[0].shapes[0].name = 'Art Room';
  renamed.floors[0].shapes[0].paint = '#ff0000';
  renamed.env = { ...renamed.env, minutes: 1200 };
  assert.equal(bakeKey(renamed, testCatalog), base,
    'a rename, a repaint and an hour change none of the light');

  const chair = twoRooms();
  addProp(chair, 'desk', { x: 20, z: 20, floor: 0 });
  assert.equal(bakeKey(chair, testCatalog), base, 'furniture is not a light');

  const lamp = twoRooms();
  addProp(lamp, 'redlamp', { x: 20, z: 20, floor: 0 });
  assert.notEqual(bakeKey(lamp, testCatalog), base, 'a fixture is');

  const moved = twoRooms();
  moved.props[0].x += 4;
  assert.notEqual(bakeKey(moved, testCatalog), base, 'a moved fixture is too');
});

test('pack, unpack: a byte a channel and the shape survives', () => {
  const b = bakeOf(twoRooms(EDGE_DOOR));
  const packed = packBake(b);
  assert.equal(packed.version, BAKE_VERSION);
  assert.equal(packed.key, b.key);
  assert.ok(packed.floors[0].day instanceof Uint8Array);
  const back = unpackBake(packed);
  assert.ok(back, 'a packed bake unpacks');
  assert.equal(back.key, b.key);
  // Quantization error is bounded by half a step per channel.
  const tol = (packed.fixScale || 1) / 255;
  for (let i = 0; i < b.floors[0].fix.length; i += 97) {
    assert.ok(Math.abs(back.floors[0].fix[i] - b.floors[0].fix[i]) <= tol);
  }
  for (let i = 0; i < b.floors[0].day.length; i += 41) {
    assert.ok(Math.abs(back.floors[0].day[i] - b.floors[0].day[i]) <= 1 / 255);
  }
});

test('a bake from another version, or a damaged one, is a cache miss', () => {
  const packed = packBake(bakeOf(twoRooms()));
  assert.equal(unpackBake({ ...packed, version: BAKE_VERSION + 1 }), null);
  assert.equal(unpackBake(null), null);
  const short = { ...packed, floors: [{ ...packed.floors[0], day: new Uint8Array(3) }] };
  assert.equal(unpackBake(short), null, 'an array the wrong length is refused');
  assert.equal(decodeBakeText('not json'), null);
  assert.equal(decodeBakeText('{"version":99}'), null);
});

test('a bake as text round-trips byte for byte', () => {
  const packed = packBake(bakeOf(twoRooms(EDGE_DOOR)));
  const back = decodeBakeText(encodeBakeText(packed));
  assert.ok(back);
  assert.equal(back.key, packed.key);
  assert.equal(back.fixScale, packed.fixScale);
  assert.deepEqual([...back.floors[0].day], [...packed.floors[0].day]);
  assert.deepEqual([...back.floors[0].fix], [...packed.floors[0].fix]);
});

test('base64 helpers round-trip every byte value and refuse junk', () => {
  const bytes = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual([...b64ToBytes(bytesToB64(bytes))], [...bytes]);
  assert.deepEqual([...b64ToBytes(bytesToB64(new Uint8Array(0)))], []);
  for (const n of [1, 2, 3, 4, 5]) {
    const b = new Uint8Array(n).fill(200);
    assert.deepEqual([...b64ToBytes(bytesToB64(b))], [...b], `length ${n}`);
  }
  assert.throws(() => b64ToBytes('***'));
});

// ---------- sampling ----------

test('sampleBake: cell centres read back exactly; off-grid is outdoors', () => {
  const b = bakeOf(twoRooms());
  const fl = b.floors[0];
  const i = Math.floor(fl.h / 2) * fl.w + Math.floor(fl.w / 2);
  const x = fl.x0 + ((i % fl.w) + 0.5) * BAKE_CELL;
  const z = fl.z0 + (Math.floor(i / fl.w) + 0.5) * BAKE_CELL;
  const p = sampleBake(b, 0, x, z);
  assert.ok(Math.abs(p.day - fl.day[i]) < 1e-6);
  assert.ok(Math.abs(p.r - fl.fix[i * 3]) < 1e-6);

  const far = sampleBake(b, 0, 4000, 4000);
  assert.ok(far.day > 0.99, 'far off the grid is under the open sky');
  const noFloor = sampleBake(b, 7, 16, 16);
  assert.equal(noFloor.day, 1, 'a storey with no grid is outdoors too');
  assert.equal(noFloor.r, 0);
});

// ---------- run the thing ----------
//
// The whole sample school, real catalog, generic troffers and all — the
// state the export button actually bakes. Slower than everything above put
// together, and worth it: this is the test that catches the case the
// calculating ones missed.

test('the sample school bakes end to end', () => {
  const s = buildSampleSchool();
  const progress = [];
  const b = bakeLight(s, catalogEntry, { onProgress: (f) => progress.push(f) });
  assert.equal(b.key, bakeKey(s, catalogEntry));
  assert.equal(b.floors.length, s.floors.length);
  assert.equal(progress[progress.length - 1], 1, 'progress reaches the end');
  for (const fl of b.floors) {
    assert.ok(fl.w > 0 && fl.h > 0, 'every storey got a grid');
    let lit = 0;
    for (let i = 0; i < fl.fix.length; i++) if (fl.fix[i] > 0.01) lit++;
    assert.ok(lit > 0, 'the ceiling lattice lit something on every storey');
  }
  // A grid cell is CELL/2: the bake resolves below the drawing grid.
  assert.equal(BAKE_CELL * 2, CELL);
});
