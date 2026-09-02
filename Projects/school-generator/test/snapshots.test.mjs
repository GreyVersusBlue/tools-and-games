// snapshots.test.mjs — the named pasts beside the autosave. Both faces, the
// way bakestore's suite tests them: no storage at all, and a fake that keeps
// IndexedDB's request shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveSnapshot, listSnapshots, loadSnapshot, deleteSnapshot, renameSnapshot,
  whenLabel, snapName, MAX_SNAPSHOTS, MAX_SNAP_NAME, NO_STORAGE, TOO_MANY,
} from '../js/snapshots.js';

function fakeIDB() {
  const tables = new Map();
  const request = (fn) => {
    const req = {};
    queueMicrotask(() => {
      try { req.result = fn(); if (req.onsuccess) req.onsuccess(); }
      catch (err) { req.error = err; if (req.onerror) req.onerror(); }
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
        close() {},
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
      queueMicrotask(() => { req.result = db; if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); });
      return req;
    },
  };
}

const entry = (name, at) => ({ name, json: `{"version":12,"n":"${name}"}`, thumb: { w: 1, h: 1, rooms: [] }, facts: { rooms: 2 }, at });

test('with no storage, nothing throws and every answer is the honest miss', async () => {
  assert.deepEqual(await saveSnapshot(entry('x'), null), { ok: false, reason: NO_STORAGE });
  assert.deepEqual(await listSnapshots(null), []);
  assert.equal(await loadSnapshot('s1', null), null);
  assert.equal(await deleteSnapshot('s1', null), false);
  assert.equal(await renameSnapshot('s1', 'y', null), false);
  assert.equal((await saveSnapshot(null, fakeIDB())).ok, false, 'nothing to snapshot');
  assert.equal((await saveSnapshot({ name: 'x', json: '' }, fakeIDB())).ok, false);
});

test('a snapshot round-trips: listed newest first without its design, loaded with it', async () => {
  const idb = fakeIDB();
  const a = await saveSnapshot(entry('Tuesday', 1000), idb);
  const b = await saveSnapshot(entry('Before the meeting', 2000), idb);
  assert.ok(a.ok && b.ok && a.id !== b.id);
  const list = await listSnapshots(idb);
  assert.deepEqual(list.map((s) => s.name), ['Before the meeting', 'Tuesday']);
  assert.equal(list[0].json, undefined, 'a listing does not carry the designs');
  assert.equal(list[1].bytes, entry('Tuesday').json.length);
  assert.deepEqual(list[1].facts, { rooms: 2 });
  const got = await loadSnapshot(a.id, idb);
  assert.equal(got.name, 'Tuesday');
  assert.equal(got.json, entry('Tuesday').json);
  assert.equal(await loadSnapshot('nope', idb), null);
});

test('rename and delete, and a name is trimmed and capped', async () => {
  const idb = fakeIDB();
  const { id } = await saveSnapshot(entry('   ', 1), idb);
  assert.equal((await loadSnapshot(id, idb)).name, 'Untitled');
  assert.equal(await renameSnapshot(id, ` ${'x'.repeat(200)} `, idb), true);
  assert.equal((await loadSnapshot(id, idb)).name.length, MAX_SNAP_NAME);
  assert.equal(await renameSnapshot('nope', 'y', idb), false);
  assert.equal(await deleteSnapshot(id, idb), true);
  assert.deepEqual(await listSnapshots(idb), []);
  assert.equal(snapName(undefined), 'Untitled');
});

test('the cap is a refusal with a sentence, never a silent prune', async () => {
  const idb = fakeIDB();
  for (let i = 0; i < MAX_SNAPSHOTS; i++) assert.ok((await saveSnapshot(entry(`s${i}`, i), idb)).ok);
  assert.deepEqual(await saveSnapshot(entry('one more', 99), idb), { ok: false, reason: TOO_MANY });
  assert.equal((await listSnapshots(idb)).length, MAX_SNAPSHOTS);
  assert.ok((await listSnapshots(idb)).some((s) => s.name === 's0'), 'the oldest is still there');
});

test('whenLabel says how long ago in the words a person would use', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);
  assert.equal(whenLabel(now - 10 * 1000, now), 'just now');
  assert.equal(whenLabel(now - 7 * 60 * 1000, now), '7 min ago');
  assert.match(whenLabel(now - 3 * 60 * 60 * 1000, now), /^today, /);
  assert.match(whenLabel(now - 3 * 24 * 60 * 60 * 1000, now), /^\w{3}, \w{3} \d+, /);
  assert.equal(whenLabel(NaN, now), '');
});
