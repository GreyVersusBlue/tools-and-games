// Tests for save-load.js's named save slots (Phase 7) — a small localStorage
// index of {id, name, updatedAt} plus one JSON blob per slot, independent of
// the autosave key and the save-format version. `node --test` has no
// localStorage, so this file installs a minimal in-memory shim before
// importing the module under test, the same way a browser's would behave for
// getItem/setItem/removeItem.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  return store;
}

installFakeLocalStorage();

const { createState } = await import('../js/grid.js');
const { sheet } = await import('./build.mjs');
const {
  listDesigns, saveDesign, loadDesign, deleteDesign, renameDesign, MAX_SLOTS,
} = await import('../js/save-load.js');

test('a fresh install has no saved designs', () => {
  globalThis.localStorage.clear();
  assert.deepEqual(listDesigns(), []);
});

test('saving a design returns an id that lists and loads it back', () => {
  globalThis.localStorage.clear();
  const s = createState(10, 10);
  sheet(s, 0).fill(2, 2, 2, 2).bake();
  const id = saveDesign(s, 'My School');
  const list = listDesigns();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, 'My School');
  const loaded = loadDesign(id);
  assert.equal(loaded.floors[0].w, 10);
  assert.equal(loaded.floors[0].shapes.length, 1, 'the room came back with it');
});

test('saving again with the same id overwrites in place rather than adding a slot', () => {
  globalThis.localStorage.clear();
  const s = createState(10, 10);
  const id = saveDesign(s, 'Draft');
  const s2 = createState(20, 20);
  saveDesign(s2, 'Draft', id);
  const list = listDesigns();
  assert.equal(list.length, 1);
  const loaded = loadDesign(id);
  assert.equal(loaded.floors[0].w, 20);
});

test('an empty or blank name falls back to "Untitled"', () => {
  globalThis.localStorage.clear();
  const id = saveDesign(createState(), '   ');
  assert.equal(listDesigns()[0].name, 'Untitled');
  renameDesign(id, '');
  assert.equal(listDesigns()[0].name, 'Untitled');
});

test('a long name is trimmed rather than rejected', () => {
  globalThis.localStorage.clear();
  const id = saveDesign(createState(), 'x'.repeat(500));
  assert.ok(listDesigns()[0].name.length <= 60);
  renameDesign(id, 'y'.repeat(500));
  assert.ok(listDesigns()[0].name.length <= 60);
});

test('deleting a slot removes it from the list and its data', () => {
  globalThis.localStorage.clear();
  const id = saveDesign(createState(), 'Gone soon');
  deleteDesign(id);
  assert.deepEqual(listDesigns(), []);
  assert.throws(() => loadDesign(id));
});

test('renaming an unknown id is a no-op that reports failure', () => {
  globalThis.localStorage.clear();
  assert.equal(renameDesign('nope', 'x'), false);
});

test('listDesigns is newest-first', async () => {
  globalThis.localStorage.clear();
  const idA = saveDesign(createState(), 'First');
  await new Promise((r) => setTimeout(r, 2));
  const idB = saveDesign(createState(), 'Second');
  const list = listDesigns();
  assert.equal(list[0].id, idB);
  assert.equal(list[1].id, idA);
});

test('the slot limit is enforced for new slots but not for overwriting an existing one', () => {
  globalThis.localStorage.clear();
  const ids = [];
  for (let i = 0; i < MAX_SLOTS; i++) ids.push(saveDesign(createState(), `Design ${i}`));
  assert.equal(listDesigns().length, MAX_SLOTS);
  assert.throws(() => saveDesign(createState(), 'One too many'));
  // Overwriting one already in the list is still fine at the limit.
  saveDesign(createState(20, 20), 'Design 0 v2', ids[0]);
  assert.equal(listDesigns().length, MAX_SLOTS);
});

test('loading a missing slot throws rather than returning a blank design', () => {
  globalThis.localStorage.clear();
  assert.throws(() => loadDesign('never-saved'));
});
