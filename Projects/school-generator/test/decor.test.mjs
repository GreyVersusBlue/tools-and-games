// The seasonal packs: that every type a pack names is a real catalog row,
// every colour it names is a colour, and the two accessors answer the way the
// panel expects. There is no geometry here and no save format — a pack is a
// palette over rows that already exist, which is the whole claim this file is
// checking.

import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogEntry, normalizeColor } from '../js/catalog.js';
import {
  DECOR_PACKS, DECOR_TYPES, packByKey, packPaint, packTypes,
} from '../js/decor.js';

test('every decor type names a real catalog row in the Decor category', () => {
  for (const type of DECOR_TYPES) {
    const entry = catalogEntry(type);
    assert.ok(entry, `${type} is not in the catalog`);
    assert.equal(entry.category, 'Decor', `${type} is not decor`);
  }
  assert.equal(new Set(DECOR_TYPES).size, DECOR_TYPES.length, 'no duplicates');
});

test('every pack has a key, a name, a six-colour palette and real colours in it', () => {
  const keys = new Set();
  for (const p of DECOR_PACKS) {
    assert.ok(p.key && !keys.has(p.key), `${p.key} is missing or repeated`);
    keys.add(p.key);
    assert.ok(p.name && p.icon && p.note, `${p.key} needs a name, an icon and a note`);
    assert.equal(p.palette.length, 6, `${p.key}'s palette is the width of the panel`);
    for (const c of p.palette) {
      assert.equal(normalizeColor(c), c, `${p.key} palette entry ${c} is not a normalized hex`);
    }
    assert.equal(new Set(p.palette).size, 6, `${p.key} repeats a swatch`);
  }
});

test('every paint a pack names is a colour, on a type the pack can place', () => {
  for (const p of DECOR_PACKS) {
    for (const [type, color] of Object.entries(p.paints)) {
      assert.ok(DECOR_TYPES.includes(type), `${p.key} paints ${type}, which is not decor`);
      assert.equal(normalizeColor(color), color, `${p.key}'s ${type} paint is not a hex`);
    }
  }
});

test('packPaint answers for a key or a pack, and empty for anything else', () => {
  assert.equal(packPaint('winter', 'wreath'), '#1f5c33');
  assert.equal(packPaint(packByKey('winter'), 'wreath'), '#1f5c33');
  assert.equal(packPaint('winter', 'pumpkin'), '', 'winter has no opinion about pumpkins');
  assert.equal(packPaint('no-such-pack', 'wreath'), '');
  assert.equal(packPaint(null, 'wreath'), '');
  assert.equal(packPaint('', ''), '');
});

test('a pack offers its own pieces first, then the rest of the kit', () => {
  const harvest = packByKey('harvest');
  const types = packTypes(harvest);
  assert.deepEqual([...new Set(types)], types, 'each piece once');
  assert.equal(types.length, DECOR_TYPES.length, 'a pack narrows the order, not the list');
  assert.deepEqual(types.slice(0, harvest.pieces.length), harvest.pieces, 'its own, in its own order');
  assert.equal(types[0], 'pumpkin', 'and a harvest pack leads with a pumpkin');
});

test('every piece a pack leads with is one of the decor rows', () => {
  for (const p of DECOR_PACKS) {
    assert.ok(p.pieces.length >= 4, `${p.key} needs a kit worth picking`);
    assert.equal(new Set(p.pieces).size, p.pieces.length, `${p.key} repeats a piece`);
    for (const t of p.pieces) {
      assert.ok(DECOR_TYPES.includes(t), `${p.key} leads with ${t}, which is not decor`);
    }
  }
});

test('packTypes is empty for a pack that does not exist', () => {
  assert.deepEqual(packTypes('no-such-pack'), []);
  assert.deepEqual(packTypes(null), []);
});

test('a pack paint is a real variant — never the colour the row already is', () => {
  // A pack that "paints" a row the colour it already has would cost a second
  // cached geometry and a second draw call for no visible difference.
  for (const p of DECOR_PACKS) {
    for (const [type, color] of Object.entries(p.paints)) {
      assert.notEqual(color, catalogEntry(type).color,
        `${p.key} paints ${type} the colour it already is`);
    }
  }
});
