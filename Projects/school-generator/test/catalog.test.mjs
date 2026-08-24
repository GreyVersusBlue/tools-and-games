// Prop catalog: shape and uniqueness of the data table itself, and the
// lookup helpers `render.js`/`propedit.js` build on. Run `node --test` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MOUNTS } from '../js/props.js';
import { CATEGORIES, PROP_CATALOG, catalogEntry, catalogByCategory } from '../js/catalog.js';

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
    assert.equal(typeof e.geo, 'string');
    assert.ok(e.icon && e.icon.length > 0, `${e.type} needs a palette icon`);
  }
});

test('catalog types are unique', () => {
  const types = PROP_CATALOG.map((e) => e.type);
  assert.equal(new Set(types).size, types.length);
});

test('a wall-mounted entry sits above the floor; a floor-standing one does not', () => {
  for (const e of PROP_CATALOG) {
    if (e.mount === 'wall') assert.ok(e.y > 0, `${e.type} is wall-mounted but y is 0`);
    else assert.equal(e.y, 0, `${e.type} is floor-standing but has a non-zero y`);
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
