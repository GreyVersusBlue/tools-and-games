// Room finishes: the floor material and wall paint a room carries, and the
// schedule the plan legend prints. Run `node --test` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState, setTile, cellIdx } from '../js/grid.js';
import { addShape, convertRegion } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import {
  FLOOR_FINISHES, FINISH_KEYS, DEFAULT_FINISH, DEFAULT_PAINT,
  finishEntry, readFinish, readPaint, finishAt, paintAt, wallPaint,
  applyFinish, finishSchedule,
} from '../js/finish.js';

function room(state, x0, y0, x1, y1, props = {}) {
  const f = state.floors[0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setTile(f, x, y, true);
      Object.assign(f.cells[cellIdx(f, x, y)], props);
    }
  }
  return f;
}

test('the finish table is well formed and every key is unique', () => {
  assert.equal(new Set(FINISH_KEYS).size, FINISH_KEYS.length);
  assert.ok(FINISH_KEYS.includes(DEFAULT_FINISH));
  for (const f of FLOOR_FINISHES) {
    assert.equal(typeof f.label, 'string');
    assert.ok(f.label.length > 0, `${f.key} needs a label for the legend`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(f.color), `${f.key} needs a hex colour`);
    assert.ok(f.tile > 0, `${f.key} needs a texture scale`);
  }
  assert.ok(/^#[0-9a-f]{6}$/i.test(DEFAULT_PAINT));
});

test('an unknown finish or a hostile colour reads as nothing, not as a default', () => {
  assert.equal(readFinish('carpet'), 'carpet');
  assert.equal(readFinish('astroturf'), null);
  assert.equal(readFinish(7), null);
  assert.equal(readPaint('#AABBCC'), '#aabbcc');
  assert.equal(readPaint('javascript:alert(1)'), null);
  assert.equal(readPaint('#abc'), null);
  // ...and a reader turns that nothing into the default itself.
  assert.equal(finishEntry('astroturf').key, DEFAULT_FINISH);
});

test('a room with no opinion is VCT and off-white', () => {
  const s = createState(10, 10);
  const f = room(s, 1, 1, 4, 4);
  assert.equal(finishAt(f, 8, 8), DEFAULT_FINISH);
  assert.equal(paintAt(f, 8, 8), null, 'no paint said is no paint stored');
  assert.equal(wallPaint(f, 4, 4, 20, 4), DEFAULT_PAINT, 'but a wall still gets painted');
});

test('a polygon room drawn over cells answers first, the way it does everywhere', () => {
  const s = createState(20, 20);
  const f = room(s, 0, 0, 9, 9, { fin: 'vct' });
  const shape = addShape(s, 0, [
    { x: 4, z: 4 }, { x: 20, z: 4 }, { x: 20, z: 20 }, { x: 4, z: 20 },
  ], {});
  applyFinish(shape, 'wood', '#223344');
  assert.equal(finishAt(f, 12, 12), 'wood');
  assert.equal(paintAt(f, 12, 12), '#223344');
  assert.equal(finishAt(f, 2, 2), 'vct', 'and the cells outside it are still cells');
});

test('a wall takes the paint of the room beside it', () => {
  const s = createState(20, 20);
  const f = room(s, 1, 1, 4, 2, { paint: '#204060' });
  // The block's south face: room on one side, car park on the other.
  const y = 3 * CELL;
  assert.equal(wallPaint(f, 1 * CELL, y, 5 * CELL, y), '#204060');
  // A boundary with nothing either side falls back rather than guessing.
  assert.equal(wallPaint(f, 0, 60, 20, 60), DEFAULT_PAINT);
});

test('a wall between two painted rooms picks one, and always the same one', () => {
  const s = createState(20, 20);
  const f = room(s, 1, 1, 4, 1, { paint: '#aa0000' });
  room(s, 1, 2, 4, 2, { paint: '#0000aa' });
  const y = 2 * CELL;
  const a = wallPaint(f, 1 * CELL, y, 5 * CELL, y);
  const b = wallPaint(f, 5 * CELL, y, 1 * CELL, y);   // the same wall, read backwards
  assert.equal(a, b, 'a wall does not change colour with which way you read it');
  assert.ok(a === '#aa0000' || a === '#0000aa');
});

test('applyFinish sets, clears, and reports whether anything changed', () => {
  const target = { fin: null, paint: null };
  assert.equal(applyFinish(target, 'carpet', '#123456'), true);
  assert.equal(applyFinish(target, 'carpet', '#123456'), false, 'no change is no change');
  assert.equal(applyFinish(target, undefined, '#654321'), true);
  assert.equal(target.fin, 'carpet', 'undefined leaves a field alone');
  assert.equal(applyFinish(target, null, null), true);
  assert.equal(target.fin, null);
  assert.equal(applyFinish(target, 'astroturf'), false, 'an unknown key is already null');
});

test('finishes survive a save round trip, on both halves of the room model', () => {
  const s = createState(20, 20);
  room(s, 1, 1, 3, 3, { room: 'Gym', fin: 'wood', paint: '#334455' });
  const shape = addShape(s, 0, [
    { x: 40, z: 40 }, { x: 60, z: 40 }, { x: 60, z: 60 }, { x: 40, z: 60 },
  ], { name: 'Library' });
  applyFinish(shape, 'carpet', '#556677');

  const back = deserialize(serialize(s));
  assert.deepEqual(back.floors[0].cells, s.floors[0].cells);
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  assert.equal(back.floors[0].shapes[0].fin, 'carpet');
});

test('a finish a newer build invented loads as the default, not as no floor', () => {
  const s = createState(10, 10);
  room(s, 1, 1, 2, 2, { fin: 'moon-rock', paint: 'not-a-colour' });
  const back = deserialize(serialize(s));
  const cell = back.floors[0].cells[cellIdx(back.floors[0], 1, 1)];
  assert.equal(cell.fin, null);
  assert.equal(cell.paint, null);
  assert.equal(finishAt(back.floors[0], 6, 6), DEFAULT_FINISH);
});

test('promoting a grid room to a polygon keeps its finishes', () => {
  const s = createState(20, 20);
  room(s, 1, 1, 3, 3, { room: 'Art', color: '#f5d491', fin: 'concrete', paint: '#889988' });
  const shape = convertRegion(s, 0, 2, 2);
  assert.ok(shape);
  assert.equal(shape.fin, 'concrete');
  assert.equal(shape.paint, '#889988');
  assert.equal(shape.name, 'Art', 'along with everything it already kept');
});

test('the schedule totals area by finish and names the rooms using it', () => {
  const s = createState(20, 20);
  room(s, 0, 0, 3, 3, { room: 'Room 101', fin: 'carpet' });   // 16 cells
  room(s, 5, 0, 5, 0, { room: 'Store', fin: 'carpet' });      // 1 cell
  room(s, 7, 0, 8, 0, { room: 'Corridor' });                  // 2 cells, default
  const shape = addShape(s, 0, [
    { x: 40, z: 40 }, { x: 50, z: 40 }, { x: 50, z: 50 }, { x: 40, z: 50 },
  ], { name: 'Gym' });
  applyFinish(shape, 'wood');

  const rows = finishSchedule(s.floors[0]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.carpet.sqft, 17 * CELL * CELL);
  assert.deepEqual(by.carpet.rooms, ['Room 101', 'Store']);
  assert.equal(by[DEFAULT_FINISH].sqft, 2 * CELL * CELL);
  assert.equal(by.wood.sqft, 100);
  assert.deepEqual(by.wood.rooms, ['Gym']);
  assert.equal(by.carpet.label, finishEntry('carpet').label);
  // Biggest first — a legend leads with what the building is mostly made of.
  assert.deepEqual(rows.map((r) => r.key), ['carpet', 'wood', DEFAULT_FINISH]);
});

test('an empty floor schedules nothing at all', () => {
  assert.deepEqual(finishSchedule(createState(6, 6).floors[0]), []);
  assert.deepEqual(finishSchedule(null), []);
});
