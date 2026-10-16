// The design diff names a ramp's width, slope and fold. `diffLinks`
// (designdiff.js) compared a link's type, storeys, place and turn, so a ramp
// set wider, gentler or folded from the Stairs panel (#907, #832) read as
// nothing changed at all. Run `node --test 'test/*.test.mjs'` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { serialize, deserialize } from '../js/save-load.js';
import { clone } from '../js/history.js';
import { setRampFold } from '../js/stairs.js';
import { designDiff, marksOn } from '../js/designdiff.js';

const roundTrip = (s) => deserialize(serialize(s));

// Two storeys and one straight ramp between them, 4ft at 1:12 by default.
function twoStoreysAndARamp(type = 'ramp', data = {}) {
  const s = createState();
  sheet(s, 0).box(2, 2, 7, 7, { name: 'Room 101' }).bake();
  addFloor(s);
  sheet(s, 1).box(2, 2, 7, 7, { name: 'Room 201' }).bake();
  s.links.push({ id: 900, type, from: 0, to: 1, x: 40, z: 40, rotationY: 0, data });
  return roundTrip(s);
}

function diffAfter(edit, type, data) {
  const before = twoStoreysAndARamp(type, data);
  const after = clone(before);
  edit(after.links[0]);
  return designDiff(roundTrip(before), roundTrip(after));
}

const RAMP = 'A ramp between Level 1 and Level 2';

test('a ramp made wider or narrower says so, in feet', () => {
  let d = diffAfter((l) => { l.data.width = 6; });
  assert.deepEqual(d.sentences, [`${RAMP} widened from 4 to 6 ft.`]);
  assert.equal(d.changes[0].change, 'changed');
  assert.ok(marksOn(d, 0).some((m) => m.kind === 'link' && m.change === 'changed'));
  assert.ok(marksOn(d, 1).some((m) => m.kind === 'link' && m.change === 'changed'));
  d = diffAfter((l) => { l.data.width = 4.5; }, 'ramp', { width: 6 });
  assert.deepEqual(d.sentences, [`${RAMP} narrowed from 6 to 4.5 ft.`]);
});

test('a ramp made gentler or steeper says so, as a ratio', () => {
  let d = diffAfter((l) => { l.data.slope = 16; });
  assert.deepEqual(d.sentences, [`${RAMP} eased from 1:12 to 1:16.`]);
  d = diffAfter((l) => { l.data.slope = 12; }, 'ramp', { slope: 20 });
  assert.deepEqual(d.sentences, [`${RAMP} steepened from 1:20 to 1:12.`]);
});

test('a ramp folded, refolded, straightened or turned the other way says so', () => {
  let d = diffAfter((l) => setRampFold(l, { runs: 3 }));
  assert.deepEqual(d.sentences, [`${RAMP} folded into 3 runs.`]);
  d = diffAfter((l) => setRampFold(l, { runs: 4 }), 'ramp', { runs: 3 });
  assert.deepEqual(d.sentences, [`${RAMP} refolded from 3 to 4 runs.`]);
  d = diffAfter((l) => setRampFold(l, { runs: 1 }), 'ramp', { runs: 3, side: -1 });
  assert.deepEqual(d.sentences, [`${RAMP} straightened into one run.`]);
  d = diffAfter((l) => setRampFold(l, { side: -1 }), 'ramp', { runs: 3 });
  assert.deepEqual(d.sentences, [`${RAMP} turned its runs to the other side.`]);
});

test('several at once read as one sentence, after the old word when it moved too', () => {
  let d = diffAfter((l) => { l.data.width = 5; l.data.slope = 16; setRampFold(l, { runs: 2 }); });
  assert.deepEqual(d.sentences, [`${RAMP} widened from 4 to 5 ft, eased from 1:12 to 1:16, folded into 2 runs.`]);
  d = diffAfter((l) => { l.x += 10; l.data.width = 5; });
  assert.deepEqual(d.sentences, [`${RAMP} changed, widened from 4 to 5 ft.`]);
});

test('what is not a ramp change reads exactly as it did', () => {
  // A default written out is the same ramp.
  assert.deepEqual(diffAfter((l) => { l.data.width = 4; l.data.slope = 12; }).sentences, []);
  // A side with no fold is nothing a walker can see (rampSide only turns lanes).
  assert.deepEqual(diffAfter((l) => { l.data.side = -1; }).sentences, []);
  // Moved and nothing else: the old sentence, word for word.
  assert.deepEqual(diffAfter((l) => { l.x += 10; }).sentences, [`${RAMP} changed.`]);
  // A stair's width is not this change: unchanged as before.
  assert.deepEqual(diffAfter((l) => { l.data.width = 6; }, 'stair').sentences, []);
});
