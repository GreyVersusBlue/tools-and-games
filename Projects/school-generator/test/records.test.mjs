// records.test.mjs — the registry of optional records: who owns what, what
// happens before the owner arrives, and that an adoption happens once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRecord, recordOwner, registeredRecords, readRecord, adoptRecords, isSettled,
} from '../js/records.js';

// A private key per test, so the suites can run in any order without one
// test's owner answering another's question.
let n = 0;
const fresh = () => `test-record-${++n}`;

test('an owner needs a key, a normalize and an isEmpty', () => {
  assert.throws(() => registerRecord('', { normalize: () => 1, isEmpty: () => false }), /key/);
  assert.throws(() => registerRecord('x', { normalize: () => 1 }), /isEmpty/);
  assert.throws(() => registerRecord('x', null), /normalize/);
  assert.equal(recordOwner('nobody-owns-this'), null);
});

test('a record with no owner is carried as it came, and junk is dropped', () => {
  const key = fresh();
  assert.ok(!registeredRecords().includes(key));
  const raw = { anything: [1, 2, 3] };
  const read = readRecord(key, raw);
  assert.equal(read.keep, true);
  assert.equal(read.value, raw, 'the same object, not a copy — nothing looked inside');
  assert.equal(read.carried, true);
  assert.equal(isSettled(raw), false);
  for (const junk of [undefined, null, 'a string', 42, true]) {
    assert.deepEqual(readRecord(key, junk), { keep: false, carried: true }, String(junk));
  }
});

test('a record with an owner is normalized, and an empty one is not kept', () => {
  const key = fresh();
  registerRecord(key, {
    normalize: (raw) => ({ count: Math.max(0, Math.min(10, Number(raw && raw.count) || 0)) }),
    isEmpty: (r) => r.count === 0,
  });
  assert.ok(registeredRecords().includes(key));
  const read = readRecord(key, { count: 1e9 });
  assert.equal(read.keep, true);
  assert.deepEqual(read.value, { count: 10 });
  assert.equal(read.carried, false);
  assert.equal(isSettled(read.value), true, 'the owner has read it');
  assert.deepEqual(readRecord(key, { count: -3 }), { keep: false, carried: false });
  assert.deepEqual(readRecord(key, undefined), { keep: false, carried: false });
});

test('adoptRecords normalizes what was carried, once the owner is here — once', () => {
  const key = fresh();
  const state = { w: 10, [key]: { count: '7', junk: true } };
  // Before the owner: nothing to do, nothing touched.
  assert.deepEqual(adoptRecords(state), []);
  assert.equal(state[key].junk, true);
  let calls = 0;
  registerRecord(key, {
    normalize: (raw) => { calls += 1; return { count: Number(raw && raw.count) || 0 }; },
    isEmpty: (r) => r.count === 0,
  });
  assert.deepEqual(adoptRecords(state), [key]);
  assert.deepEqual(state[key], { count: 7 });
  assert.equal(calls, 1);
  // Again: the record is settled, so the owner is not asked twice.
  assert.deepEqual(adoptRecords(state), []);
  assert.equal(calls, 1);
  // A record somebody wrote onto the state by hand is not settled, so the
  // next adoption reads it — exactly once as well.
  state[key] = { count: 3 };
  assert.deepEqual(adoptRecords(state), [key]);
  assert.equal(calls, 2);
  assert.deepEqual(adoptRecords(state), []);
  assert.equal(calls, 2);
});

test('adoptRecords deletes a carried record its owner calls empty, and leaves absent keys absent', () => {
  const key = fresh();
  const state = { [key]: { count: 0 } };
  registerRecord(key, {
    normalize: (raw) => ({ count: Number(raw && raw.count) || 0 }),
    isEmpty: (r) => r.count === 0,
  });
  assert.deepEqual(adoptRecords(state), [key]);
  assert.equal(key in state, false);
  assert.deepEqual(adoptRecords({}), []);
  assert.deepEqual(adoptRecords(null), []);
  assert.deepEqual(adoptRecords('nope'), []);
});

test('the seven owners register themselves when they load', async () => {
  const before = new Set(registeredRecords());
  await Promise.all([
    import('../js/agents.js'), import('../js/tour.js'), import('../js/models.js'),
    import('../js/timetable.js'), import('../js/rates.js'), import('../js/phasing.js'),
    import('../js/haunt.js'),
  ]);
  for (const key of ['life', 'tours', 'models', 'timetable', 'rates', 'phasing', 'haunt']) {
    assert.ok(registeredRecords().includes(key), `${key} has an owner once its module is loaded`);
  }
  // ...and nothing else this suite did not register.
  const extra = registeredRecords().filter((k) => !before.has(k) && !k.startsWith('test-record-'));
  assert.deepEqual(extra.sort(),
    ['haunt', 'life', 'models', 'phasing', 'rates', 'timetable', 'tours']);
});
