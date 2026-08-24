// Furniture layout presets: every stamp names a real catalog type, and
// placing a template just translates/rotates its stamps like a single prop
// would. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROP_CATALOG, catalogEntry } from '../js/catalog.js';
import { ROOM_TEMPLATES, templateByKey, templatePlacements } from '../js/templates.js';

test('every stamp in every template names a real catalog type', () => {
  for (const tpl of ROOM_TEMPLATES) {
    assert.ok(tpl.stamps.length > 0, `${tpl.key} has no stamps`);
    for (const st of tpl.stamps) {
      assert.ok(catalogEntry(st.type), `${tpl.key} stamps an unknown type "${st.type}"`);
    }
  }
});

test('templates have unique keys and a footprint for the ghost preview', () => {
  const keys = new Set(ROOM_TEMPLATES.map((t) => t.key));
  assert.equal(keys.size, ROOM_TEMPLATES.length, 'template keys collide');
  for (const tpl of ROOM_TEMPLATES) {
    assert.ok(tpl.footprint.w > 0 && tpl.footprint.d > 0);
    assert.ok(tpl.name && tpl.icon);
  }
});

test('templateByKey finds a template or returns null', () => {
  assert.equal(templateByKey('classroom').key, 'classroom');
  assert.equal(templateByKey('nope'), null);
});

test('placements land at the anchor plus each stamp offset, unrotated', () => {
  const tpl = templateByKey('reading-corner');
  const placed = templatePlacements(tpl, 100, 50, 0);
  assert.equal(placed.length, tpl.stamps.length);
  placed.forEach((p, i) => {
    const st = tpl.stamps[i];
    assert.ok(Math.abs(p.x - (100 + st.dx)) < 1e-9);
    assert.ok(Math.abs(p.z - (50 + st.dz)) < 1e-9);
    assert.equal(p.type, st.type);
    assert.equal(p.mount, catalogEntry(st.type).mount);
  });
});

test('a template rotates as one piece: stamp offsets and their own facing both turn', () => {
  const tpl = { key: 't', name: 't', icon: 'x', footprint: { w: 1, d: 1 }, stamps: [
    { type: 'student-desk', dx: 2, dz: 0, rotationY: 0 },
  ] };
  // 90 degrees, propplace.js convention: local +X ends up along world -Z
  // (world = (lx·cosθ + lz·sinθ, -lx·sinθ + lz·cosθ)).
  const [p] = templatePlacements(tpl, 0, 0, Math.PI / 2);
  assert.ok(Math.abs(p.x - 0) < 1e-9, `x should land near 0, got ${p.x}`);
  assert.ok(Math.abs(p.z + 2) < 1e-9, `z should land near -2, got ${p.z}`);
  assert.ok(Math.abs(p.rotationY - Math.PI / 2) < 1e-9, 'the stamp inherited the template rotation');
});

test('an unknown stamp type is skipped rather than placed blind', () => {
  const tpl = { key: 't', name: 't', icon: 'x', footprint: { w: 1, d: 1 }, stamps: [
    { type: 'not-a-real-type', dx: 0, dz: 0 },
    { type: PROP_CATALOG[0].type, dx: 1, dz: 1 },
  ] };
  const placed = templatePlacements(tpl, 0, 0, 0);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].type, PROP_CATALOG[0].type);
});
