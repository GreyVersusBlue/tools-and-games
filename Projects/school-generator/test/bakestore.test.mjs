// Tests for bakestore.js — where a bake rests between walks.
//
// Node has no IndexedDB, which is exactly the situation the module has to
// survive anyway (private windows, storage refused), so the suite tests both
// faces: with no factory at all, every save is a no-op and every load a miss
// and nothing throws; with a fake that keeps IndexedDB's onsuccess/onerror
// shape, the round trip, the keying and the pruning all hold.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAKE_DB, BAKE_STORE, BAKE_KEEP, saveBake, loadBake, clearBakes,
} from '../js/bakestore.js';

// ---------- a minimal IndexedDB, one Map deep ----------
//
// Only what bakestore actually calls: open (upgrade + success), transaction
// → objectStore → put/get/getAll/delete/clear, requests answered on a
// microtask so the onsuccess handlers are wired before they fire — the same
// order the real thing guarantees.

function fakeIDB() {
  const tables = new Map();   // dbName -> Map(key -> record)
  const request = (fn) => {
    const req = {};
    queueMicrotask(() => {
      try {
        req.result = fn();
        if (req.onsuccess) req.onsuccess();
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror();
      }
    });
    return req;
  };
  return {
    tables,
    open(name) {
      if (!tables.has(name)) tables.set(name, new Map());
      const rows = tables.get(name);
      const db = {
        objectStoreNames: { contains: () => true },
        close() { /* nothing held open */ },
        transaction: () => ({
          objectStore: () => ({
            put: (rec) => request(() => { rows.set(rec.key, structuredClone(rec)); return rec.key; }),
            get: (key) => request(() => (rows.has(key) ? structuredClone(rows.get(key)) : undefined)),
            getAll: () => request(() => [...rows.values()].map((r) => structuredClone(r))),
            delete: (key) => request(() => { rows.delete(key); }),
            clear: () => request(() => { rows.clear(); }),
          }),
        }),
      };
      const req = {};
      queueMicrotask(() => {
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

const packedFixture = (key, n = 4) => ({
  version: 1,
  key,
  cell: 2,
  fixScale: 1.5,
  floors: [{
    f: 0, x0: 0, z0: 0, w: 2, h: 2,
    day: new Uint8Array(n).fill(200),
    fix: new Uint8Array(n * 3).fill(60),
  }],
});

// ---------- no storage at all ----------

test('with no IndexedDB, saves decline and loads miss — quietly', async () => {
  assert.equal(await saveBake(packedFixture('abc'), null), false);
  assert.equal(await loadBake('abc', null), null);
  assert.equal(await clearBakes(null), false);
});

test('a factory whose open() throws is the same weather', async () => {
  const angry = { open() { throw new Error('quota'); } };
  assert.equal(await saveBake(packedFixture('abc'), angry), false);
  assert.equal(await loadBake('abc', angry), null);
});

test('a bake with no key never lands', async () => {
  const idb = fakeIDB();
  assert.equal(await saveBake({ version: 1 }, idb), false);
  assert.equal(await saveBake(null, idb), false);
});

// ---------- the round trip ----------

test('a packed bake goes in under its key and comes back whole', async () => {
  const idb = fakeIDB();
  const packed = packedFixture('deadbeefcafef00d');
  assert.equal(await saveBake(packed, idb), true);
  const back = await loadBake('deadbeefcafef00d', idb);
  assert.ok(back, 'a hit');
  assert.equal(back.key, packed.key);
  assert.equal(back.fixScale, packed.fixScale);
  assert.deepEqual([...back.floors[0].day], [...packed.floors[0].day]);
  assert.deepEqual([...back.floors[0].fix], [...packed.floors[0].fix]);
  assert.equal(await loadBake('someotherkey', idb), null, 'a different structure is a miss');
});

test('saving under the same key replaces, not duplicates', async () => {
  const idb = fakeIDB();
  await saveBake(packedFixture('k1'), idb);
  const second = packedFixture('k1');
  second.fixScale = 9;
  await saveBake(second, idb);
  const rows = idb.tables.get(BAKE_DB);
  assert.equal(rows.size, 1);
  assert.equal((await loadBake('k1', idb)).fixScale, 9);
});

// ---------- the pruning ----------

test(`only the newest ${BAKE_KEEP} bakes survive`, async () => {
  const idb = fakeIDB();
  for (let i = 0; i < BAKE_KEEP + 3; i++) {
    await saveBake(packedFixture(`key-${i}`), idb);
    // The prune sorts on wall-clock stamps; make sure they differ.
    await new Promise((r) => setTimeout(r, 2));
  }
  const rows = idb.tables.get(BAKE_DB);
  assert.equal(rows.size, BAKE_KEEP, 'the store holds its stated count');
  assert.ok(rows.has(`key-${BAKE_KEEP + 2}`), 'the newest is kept');
  assert.ok(!rows.has('key-0'), 'the oldest went first');
});

test('clearBakes forgets everything', async () => {
  const idb = fakeIDB();
  await saveBake(packedFixture('k1'), idb);
  await saveBake(packedFixture('k2'), idb);
  assert.equal(await clearBakes(idb), true);
  assert.equal(idb.tables.get(BAKE_DB).size, 0);
  assert.equal(await loadBake('k1', idb), null);
});

// The store's names are part of the contract with the page that owns the
// origin — renaming one silently orphans every stored bake.
test('the store keeps its names', () => {
  assert.equal(BAKE_DB, 'school-generator-bakes');
  assert.equal(BAKE_STORE, 'bakes');
});
