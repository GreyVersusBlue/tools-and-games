// The code editions as data (Phase 41): every offered edition carries a
// complete table, the settings a design stores still normalise the way they
// did when occupancy.js owned them, and — the point of the phase — a reader
// handed a different table gets different numbers.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDITIONS, CODE_EDITIONS, DEFAULT_EDITION, editionEntry, editionOf,
  defaultCode, normalizeCode, isDefaultCode, codeOf,
  factorOf, factorSpan, limitsOf, exitsRequired, widthRequired, citeFor,
} from '../js/codes.js';
import { USES } from '../js/occupancy.js';

const RULES = ['travel', 'deadEnd', 'commonPath', 'widthPerOcc', 'singleExitOcc', 'exits',
  'minExitClear', 'minEgressStairW', 'glazing', 'factors', 'cites'];

test('every offered edition has a complete table', () => {
  assert.equal(EDITIONS.length, CODE_EDITIONS.length);
  for (const e of EDITIONS) {
    assert.ok(CODE_EDITIONS.some((m) => m.key === e.key), `${e.key} is not on the menu`);
    for (const k of RULES) assert.ok(e[k] !== undefined, `${e.key} has no ${k}`);
    assert.ok(e.travel.sprinklered >= e.travel.plain);
    assert.ok(e.deadEnd.sprinklered >= e.deadEnd.plain);
    assert.ok(e.commonPath.sprinklered > 0 && e.commonPath.plain > 0);
    assert.ok(e.widthPerOcc.stair > e.widthPerOcc.level);
    assert.ok(e.glazing > 0 && e.glazing < 1);
    assert.ok(Array.isArray(e.changes));
    // The exit thresholds read top down, so they have to be sorted that way.
    for (let i = 1; i < e.exits.length; i++) assert.ok(e.exits[i - 1].over > e.exits[i].over);
  }
});

test('every use the occupancy table names has a factor in every edition', () => {
  for (const e of EDITIONS) {
    for (const u of USES) {
      if (u.circulation) continue;
      assert.ok(factorOf(e, u.key) > 0, `${e.key} prices no ${u.key}`);
    }
    assert.ok(factorOf(e, 'unassigned') > 0, 'the placeholder is in the table too');
    assert.equal(factorOf(e, 'circulation'), 0);
    assert.equal(factorOf(e, 'nonsense'), 0);
  }
});

test('the three editions agree on every Group E number this tool applies — checked, not assumed', () => {
  // The phase's premise was "not one of them changes a number", and carrying
  // the tables in full is what shows that for a school the code did not
  // move between 2018 and 2024. If a future row differs, this test is the
  // one to change, and `changes` on that row is where to say why.
  const [a, ...rest] = EDITIONS;
  for (const b of rest) {
    for (const k of RULES) {
      if (k === 'cites') continue;
      assert.deepEqual(b[k], a[k], `${b.key}.${k} differs from ${a.key} and says nothing about it`);
    }
    assert.equal(b.changes.length, 0);
  }
});

test('the settings normalise the way they always did', () => {
  assert.deepEqual(defaultCode(), { edition: DEFAULT_EDITION, sprinklered: true });
  assert.deepEqual(normalizeCode(null), defaultCode());
  assert.deepEqual(normalizeCode({ edition: 'ibc2018' }), { edition: 'ibc2018', sprinklered: true });
  assert.deepEqual(normalizeCode({ edition: 'ibc1999', sprinklered: false }),
    { edition: DEFAULT_EDITION, sprinklered: false });
  assert.ok(isDefaultCode(undefined));
  assert.ok(!isDefaultCode({ sprinklered: false }));
  assert.deepEqual(codeOf({ code: { edition: 'ibc2024' } }), { edition: 'ibc2024', sprinklered: true });
  assert.equal(editionEntry('nonsense').key, DEFAULT_EDITION);
});

test('a reader can be handed an edition in any of four forms', () => {
  const table = editionEntry('ibc2018');
  assert.equal(editionOf(table).key, 'ibc2018');
  assert.equal(editionOf('ibc2018').key, 'ibc2018');
  assert.equal(editionOf({ edition: 'ibc2018' }).key, 'ibc2018');
  assert.equal(editionOf(null, { code: { edition: 'ibc2024' } }).key, 'ibc2024');
  assert.equal(editionOf(undefined, {}).key, DEFAULT_EDITION);
});

test('limits, exits and widths are read off the table', () => {
  const e = editionEntry(DEFAULT_EDITION);
  assert.deepEqual(limitsOf(e, true), { travel: 250, deadEnd: 50, commonPath: 75 });
  assert.deepEqual(limitsOf(e, false), { travel: 200, deadEnd: 20, commonPath: 75 });
  assert.equal(exitsRequired(e, 1), 1);
  assert.equal(exitsRequired(e, 49), 1);
  assert.equal(exitsRequired(e, 50), 2);
  assert.equal(exitsRequired(e, 501), 3);
  assert.equal(exitsRequired(e, 1001), 4);
  assert.equal(widthRequired(e, 60), 1);              // 60 × 0.2in = 12in
  assert.equal(widthRequired(e, 60, { stair: true }), 1.5);
});

test('a hypothetical edition changes the numbers, which is what "applied" means', () => {
  const e = editionEntry(DEFAULT_EDITION);
  const strict = {
    ...e, key: 'test', label: 'Test Code',
    factors: { ...e.factors, classroom: 10 },
    travel: { sprinklered: 150, plain: 100 },
    exits: [{ over: 20, need: 2 }],
    widthPerOcc: { level: 0.4, stair: 0.6 },
  };
  assert.equal(factorOf(strict, 'classroom'), 10);
  assert.equal(limitsOf(strict, true).travel, 150);
  assert.equal(exitsRequired(strict, 21), 2);
  assert.equal(widthRequired(strict, 30), 1);
});

test('the span of factors is the widest and narrowest use, leaving out the placeholder', () => {
  const span = factorSpan(editionEntry(DEFAULT_EDITION));
  assert.equal(span.min, 7);       // assembly, fixed seating
  assert.equal(span.max, 300);     // storage
});

test('a citation names the edition and the table, or the edition alone', () => {
  assert.equal(citeFor(editionEntry('ibc2021'), 'travel'), 'IBC 2021 · Table 1017.2');
  assert.equal(citeFor('ibc2018', 'glazing'), 'IBC 2018 · §1205.2');
  assert.equal(citeFor(editionEntry('ibc2024'), 'nonsense'), 'IBC 2024');
});
