// Prop catalog: shape and uniqueness of the data table itself, and the
// lookup helpers `render.js`/`propedit.js` build on. Run `node --test` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MOUNTS } from '../js/props.js';
import { WALL_H, FLOOR_H } from '../js/grid.js';
import {
  CATEGORIES, GEO_KEYS, PROP_CATALOG, PROP_PAINTS,
  catalogEntry, catalogByCategory, normalizeColor, propColor, variantKey,
} from '../js/catalog.js';
import { normalizeProp } from '../js/props.js';

test('every catalog entry has the fields render.js and propplace.js rely on', () => {
  for (const e of PROP_CATALOG) {
    assert.equal(typeof e.type, 'string');
    assert.ok(e.type.length > 0);
    assert.ok(CATEGORIES.includes(e.category), `${e.type} has an unlisted category`);
    assert.ok(MOUNTS.includes(e.mount), `${e.type} has an invalid mount`);
    assert.ok(Number.isFinite(e.w) && e.w > 0, `${e.type} needs a positive width`);
    assert.ok(Number.isFinite(e.d) && e.d > 0, `${e.type} needs a positive depth`);
    assert.ok(Number.isFinite(e.h) && e.h > 0, `${e.type} needs a positive height`);
    assert.ok(Number.isFinite(e.y) && e.y >= 0, `${e.type} needs a non-negative mount height`);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(e.color), `${e.type} needs a hex color`);
    assert.ok(GEO_KEYS.includes(e.geo), `${e.type} names an unknown geo key "${e.geo}"`);
    assert.ok(e.icon && e.icon.length > 0, `${e.type} needs a palette icon`);
  }
});

test('every entry fits the building it will be placed in', () => {
  for (const e of PROP_CATALOG) {
    if (e.mount === 'wall') {
      // A wall mount hangs on a 10ft wall — unless flagged `tall` (the gym
      // hoop, whose rim wants a two-storey volume over the court).
      if (!e.tall) assert.ok(e.y + e.h <= WALL_H, `${e.type} overruns the wall (y ${e.y} + h ${e.h})`);
    } else if (e.mount === 'ceiling') {
      assert.ok(e.y + e.h <= FLOOR_H, `${e.type} overruns the plenum`);
    } else {
      // Floor-standing and indoors: it has to fit under the ceiling. `site`
      // marks the outdoor pieces (flagpole, swing set) that don't.
      if (!e.site) assert.ok(e.y + e.h <= WALL_H, `${e.type} is taller than the room (h ${e.h})`);
    }
  }
});

test('catalog types are unique', () => {
  const types = PROP_CATALOG.map((e) => e.type);
  assert.equal(new Set(types).size, types.length);
});

test('a mounted entry sits above the floor; a floor-standing one does not', () => {
  for (const e of PROP_CATALOG) {
    if (e.mount === 'wall' || e.mount === 'ceiling') {
      assert.ok(e.y > 0, `${e.type} is ${e.mount}-mounted but y is 0`);
    } else if (e.surface) {
      // Floor-standing but meant for a desk or counter top (a desk plant,
      // desk clutter) — its default y is furniture height, not 0.
      assert.ok(e.y > 0, `${e.type} is surface-standing but y is 0`);
    } else {
      assert.equal(e.y, 0, `${e.type} is floor-standing but has a non-zero y`);
    }
  }
});

test('catalogEntry looks up by type, or returns null', () => {
  const desk = catalogEntry('student-desk');
  assert.equal(desk.name, 'Student Desk');
  assert.equal(catalogEntry('nonexistent-type'), null);
  assert.equal(catalogEntry(), null);
});

test('catalogByCategory groups every entry under its category, in CATEGORIES order', () => {
  const groups = catalogByCategory();
  const seen = new Set();
  let total = 0;
  let lastCategoryIndex = -1;
  for (const g of groups) {
    const idx = CATEGORIES.indexOf(g.category);
    assert.ok(idx > lastCategoryIndex, 'groups follow CATEGORIES order');
    lastCategoryIndex = idx;
    assert.ok(g.entries.length > 0, `${g.category} group should not be empty`);
    for (const e of g.entries) {
      assert.equal(e.category, g.category);
      seen.add(e.type);
    }
    total += g.entries.length;
  }
  assert.equal(total, PROP_CATALOG.length, 'every entry appears in exactly one group');
  assert.equal(seen.size, PROP_CATALOG.length);
});

// --- Phase 11: colour variants ---
//
// The reader `data.color` was waiting for since Phase 1. What matters here is
// less the happy path than the two edges: a variant that *equals* the row's
// own colour must not cost a second geometry, and junk in `data.color` must
// fall back rather than reach a colour parser.

test('a prop with no data wears its catalog row colour', () => {
  const chair = catalogEntry('student-chair');
  assert.equal(propColor(chair, normalizeProp({ type: 'student-chair' })), chair.color);
  assert.equal(variantKey(chair, normalizeProp({ type: 'student-chair' })), '');
});

test('data.color overrides the row, and is the variant key', () => {
  const chair = catalogEntry('student-chair');
  const red = normalizeProp({ type: 'student-chair', data: { color: '#C0392B' } });
  assert.equal(propColor(chair, red), '#c0392b', 'normalized to lowercase');
  assert.equal(variantKey(chair, red), '#c0392b');
});

test('three-digit shorthand is expanded rather than dropped', () => {
  assert.equal(normalizeColor('#F00'), '#ff0000');
  assert.equal(normalizeColor('  #abc '), '#aabbcc');
});

test('anything that is not a hex colour reads as no variant at all', () => {
  for (const junk of ['red', '#12345', 'rgb(1,2,3)', '', '#gggggg', 42, null, undefined]) {
    assert.equal(normalizeColor(junk), '', `${String(junk)} is not a colour`);
  }
  const chair = catalogEntry('student-chair');
  const junked = normalizeProp({ type: 'student-chair', data: { color: 'crimson' } });
  assert.equal(propColor(chair, junked), chair.color);
  assert.equal(variantKey(chair, junked), '');
});

test('a variant that matches the row exactly is not a variant', () => {
  // Otherwise every prop a template stamped with an explicit colour would
  // build (and draw) its own copy of geometry identical to the shared one.
  const chair = catalogEntry('student-chair');
  const same = normalizeProp({ type: 'student-chair', data: { color: chair.color.toUpperCase() } });
  assert.equal(variantKey(chair, same), '', 'same paint, same bucket');
  assert.equal(propColor(chair, same), chair.color.toLowerCase());
});

test('propColor answers for a bare row, and never hands back undefined', () => {
  assert.equal(propColor(catalogEntry('student-desk')), catalogEntry('student-desk').color);
  assert.equal(propColor(null), '#8a8f96');
  assert.equal(propColor({ type: 'x' }), '#8a8f96', 'a row with no colour is grey, not undefined');
});

test('the paint row is one clear cell followed by real colours', () => {
  assert.equal(PROP_PAINTS[0], null, 'the first cell clears the override');
  const colors = PROP_PAINTS.slice(1);
  assert.ok(colors.length >= 6, 'enough paints to be worth a row');
  for (const c of colors) {
    assert.equal(normalizeColor(c), c, `${c} is already a normalized hex`);
  }
  assert.equal(new Set(colors).size, colors.length, 'no duplicate paints');
});

test('cleanData keeps a colour through a normalize round trip', () => {
  // The whole chain this phase depends on: props.js validated the field long
  // before anybody read it, and it still has to survive a save and a load.
  const p = normalizeProp({ type: 'student-chair', data: { color: '#c0392b' } });
  assert.equal(normalizeProp(JSON.parse(JSON.stringify(p))).data.color, '#c0392b');
});
