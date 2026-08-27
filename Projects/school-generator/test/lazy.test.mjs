// lazy.test.mjs — the deferred-module helper. Small file, but the two
// properties every call site leans on are both easy to get wrong: loading
// once, and not caching a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lazy } from '../js/lazy.js';

test('the loader runs once however many times it is asked', async () => {
  let calls = 0;
  const get = lazy(async () => { calls += 1; return { value: 42 }; });
  const [a, b, c] = await Promise.all([get(), get(), get()]);
  assert.equal(calls, 1);
  assert.equal(a.value, 42);
  assert.equal(a, b);
  assert.equal(b, c, 'every caller gets the same module namespace');
  await get();
  assert.equal(calls, 1, 'and a later ask does not fetch it again');
});

test('concurrent asks before the first settles still share one load', async () => {
  let calls = 0;
  let release;
  const held = new Promise((r) => { release = r; });
  const get = lazy(() => { calls += 1; return held.then(() => ({ ok: true })); });
  const all = Promise.all([get(), get(), get(), get()]);
  assert.equal(calls, 1, 'the fourth ask must not start a second request');
  release();
  const mods = await all;
  assert.equal(calls, 1);
  assert.ok(mods.every((m) => m === mods[0]));
});

test('a load that failed is retried rather than remembered', async () => {
  let calls = 0;
  const get = lazy(async () => {
    calls += 1;
    if (calls === 1) throw new Error('network blinked');
    return { value: 'second time lucky' };
  });
  await assert.rejects(get(), /network blinked/);
  // Somebody whose click did nothing will click again; the second click has
  // to be a second attempt, not the first failure handed back.
  const mod = await get();
  assert.equal(mod.value, 'second time lucky');
  assert.equal(calls, 2);
});

test('a loader that throws synchronously rejects rather than blowing up', async () => {
  const get = lazy(() => { throw new Error('bad specifier'); });
  await assert.rejects(get(), /bad specifier/);
  // ...and is still retryable.
  await assert.rejects(get(), /bad specifier/);
});

test('the rejection reaches every caller waiting on that one load', async () => {
  let calls = 0;
  const get = lazy(async () => { calls += 1; throw new Error('nope'); });
  const results = await Promise.allSettled([get(), get(), get()]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.ok(results.every((r) => /nope/.test(String(r.reason))));
});

test('it really does defer — nothing runs until the first ask', async () => {
  let ran = false;
  const get = lazy(async () => { ran = true; return {}; });
  assert.equal(ran, false, 'constructing the accessor must not load anything');
  await get();
  assert.equal(ran, true);
});
