import test from 'node:test';
import assert from 'node:assert/strict';
import { createIds, seededRandom, isId, collectIds, ID_LENGTH, ID_PREFIXES } from '../../engine/ids.js';
import { school } from './helpers.mjs';

test('an id is ten characters of a-z and 0-9 and starts with its prefix', () => {
  const ids = createIds(seededRandom(1));
  for (const prefix of Object.values(ID_PREFIXES)) {
    const id = ids(prefix);
    assert.equal(id.length, ID_LENGTH);
    assert.match(id, /^[a-z][a-z0-9]{9}$/);
    assert.equal(id[0], prefix);
    assert.ok(isId(id, prefix));
  }
});

test('the same seed gives the same ids, and another seed gives others', () => {
  const a = createIds(seededRandom(42));
  const b = createIds(seededRandom(42));
  const c = createIds(seededRandom(43));
  const listA = [a('r'), a('r'), a('g')];
  assert.deepEqual(listA, [b('r'), b('r'), b('g')]);
  assert.notDeepEqual(listA, [c('r'), c('r'), c('g')]);
  assert.deepEqual([createIds(seededRandom('north'))('f')], [createIds(seededRandom('north'))('f')]);
});

test('an id is never handed out twice, even from a random source that repeats', () => {
  let calls = 0;
  // 18 identical draws, then moving on: the first two ids would be equal
  const ids = createIds(() => {
    calls += 1;
    return calls <= 18 ? 0 : ((calls * 7) % 36) / 36;
  });
  const first = ids('r');
  const second = ids('r');
  assert.equal(first, 'raaaaaaaaa');
  assert.notEqual(second, first);
});

test('a reserved id is never handed out', () => {
  const ids = createIds(() => 0);
  ids.reserve(['raaaaaaaaa']);
  let calls = 0;
  const moving = createIds(() => {
    calls += 1;
    return calls <= 9 ? 0 : 0.5;
  });
  moving.reserve(['raaaaaaaaa']);
  assert.notEqual(moving('r'), 'raaaaaaaaa');
});

test('a prefix has to be one lowercase letter', () => {
  const ids = createIds(seededRandom(1));
  assert.throws(() => ids('room'), TypeError);
  assert.throws(() => ids('R'), TypeError);
  assert.throws(() => createIds(null), TypeError);
});

test('isId refuses the wrong shape and the wrong prefix', () => {
  assert.equal(isId('rsample101'), true);
  assert.equal(isId('rsample101', 'g'), false);
  assert.equal(isId('RSAMPLE101'), false);
  assert.equal(isId('r-sample10'), false);
  assert.equal(isId('rshort'), false);
  assert.equal(isId(12), false);
});

test('collectIds finds every id in the sample school, each once', () => {
  const found = collectIds(school());
  assert.equal(new Set(found).size, found.length);
  for (const id of ['psample001', 'fsample003', 'rsamplegym', 'osample010', 'ksample005', 'xsample00b', 'csample00b', 'zsample001', 'ssample009', 'tsample012', 'gsample08b', 'dsample00b']) {
    assert.ok(found.includes(id), id);
  }
  assert.ok(found.every((id) => isId(id)));
});
