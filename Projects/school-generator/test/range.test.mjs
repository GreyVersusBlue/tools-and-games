// Ranges (Phase 41): the four things every reader that answers low–high
// needs, and the two rules — a range sorts by its bad end, and a limit inside
// the range is "maybe" rather than a verdict.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  range, point, isRange, isSpread, spanOf, addRanges, worst, best, against, fmtRange,
} from '../js/range.js';

test('a range is ordered however it was handed over, and a point is a range', () => {
  assert.deepEqual(range(3, 9), { low: 3, high: 9 });
  assert.deepEqual(range(9, 3), { low: 3, high: 9 });
  assert.deepEqual(range(5), { low: 5, high: 5 });
  assert.deepEqual(point(5), { low: 5, high: 5 });
  assert.deepEqual(range(NaN, Infinity), { low: 0, high: 0 }, 'nothing finite reads as zero');
  assert.ok(isRange(range(1, 2)));
  assert.ok(!isRange({ low: 2, high: 1 }));
  assert.ok(!isRange(null));
  assert.ok(isSpread(range(1, 2)));
  assert.ok(!isSpread(point(2)));
  assert.equal(spanOf(range(1, 4)), 3);
  assert.equal(spanOf(null), 0);
});

test('a total of ranges is low to low and high to high', () => {
  assert.deepEqual(addRanges([range(1, 2), point(3), range(0, 10)]), { low: 4, high: 15 });
  assert.deepEqual(addRanges([]), { low: 0, high: 0 });
  assert.deepEqual(addRanges([null, range(1, 1)]), { low: 1, high: 1 });
});

test('the bad end depends on the question', () => {
  const r = range(2, 8);
  assert.equal(worst(r), 8);
  assert.equal(worst(r, 'low'), 2);
  assert.equal(best(r), 2);
  assert.equal(best(r, 'low'), 8);
  assert.equal(worst(5), 5, 'a bare number is its own worst');
});

test('a limit inside the range is a maybe, past both ends a verdict', () => {
  assert.deepEqual(against(range(0.4, 0.9), 0.6), { over: false, maybe: true });
  assert.deepEqual(against(range(0.7, 0.9), 0.6), { over: true, maybe: false });
  assert.deepEqual(against(range(0.2, 0.5), 0.6), { over: false, maybe: false });
  assert.deepEqual(against(range(0.2, 0.6), 0.6), { over: false, maybe: false }, 'on the line passes');
  // ...and the other way round, for a rule where less is worse.
  assert.deepEqual(against(range(0.05, 0.12), 0.08, 'low'), { over: false, maybe: true });
  assert.deepEqual(against(range(0.02, 0.05), 0.08, 'low'), { over: true, maybe: false });
  assert.deepEqual(against(null, 1), { over: false, maybe: false });
});

test('a range prints as a pair, a point as one number, the unit once', () => {
  assert.equal(fmtRange(range(3, 129)), '3–129');
  assert.equal(fmtRange(point(34)), '34');
  assert.equal(fmtRange(range(3.4, 3.6)), '3–4');
  assert.equal(fmtRange(range(0.41, 0.93), { fmt: (v) => v.toFixed(1), unit: 's' }), '0.4–0.9 s');
  assert.equal(fmtRange(range(0.44, 0.42), { fmt: (v) => v.toFixed(1) }), '0.4', 'rounding can close a range');
  assert.equal(fmtRange(7, { unit: 'ft' }), '7 ft');
});
