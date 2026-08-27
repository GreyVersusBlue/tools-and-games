// The walk export (Phase 23). The suite is the three promises the wishlist
// item makes: the import graph from walk-main.js closes and severs cleanly
// (nothing editor-shaped comes along), the bundle the house bundler writes
// actually parses as one script, and the committed walk-template.html is the
// one this source tree would produce — the staleness test, so the template
// ships inside the deployed tool without a build step and without drifting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  buildBundle, buildTemplate, spliceDesign,
  DESIGN_MARKER, TEMPLATE_BUDGET, TEMPLATE_PATH, resolveSpec, parseModule, bindingFor,
} from '../tools/export-walk.mjs';
import { serialize, deserialize } from '../js/save-load.js';
import { encodeShare, decodeShare } from '../js/share.js';
import { buildSampleSchool } from '../js/sample.js';

// The bundle is the expensive half, so it is built once and every test reads
// the same run — which is also the determinism the staleness test relies on.
const built = await buildTemplate();
const { bundle, files } = await buildBundle();

// ---------- the pieces ----------

test('specifiers resolve the three forms the import map serves, and no others', () => {
  assert.match(resolveSpec('three', '/x/js/a.js'), /libs\/three\.module\.js$/);
  assert.match(resolveSpec('three/addons/controls/PointerLockControls.js', '/x/js/a.js'),
    /libs\/addons\/controls\/PointerLockControls\.js$/);
  assert.match(resolveSpec('./grid.js', resolveSpec('three', '/x.js')), /libs\/grid\.js$/);
  assert.throws(() => resolveSpec('lodash', '/x/js/a.js'), /Unresolvable/);
});

test('parseModule reads the house export forms and refuses the rest', () => {
  const mod = parseModule([
    "import * as THREE from 'three';",
    "import { a, b as c } from './x.js';",
    'export function f() {}',
    'export const K = 1;',
    'const inner = 2;',
    'export { inner as out };',
  ].join('\n'), 'fixture');
  assert.equal(mod.imports.length, 2);
  assert.deepEqual(mod.exports, [
    { local: 'f', exported: 'f' },
    { local: 'K', exported: 'K' },
    { local: 'inner', exported: 'out' },
  ]);
  assert.ok(!/^import|^export/m.test(mod.body), 'nothing modular survives');
  assert.throws(() => parseModule('export default 1;', 'fixture'), /refuses/);
  assert.throws(() => parseModule("export { x } from './y.js';", 'fixture'), /refuses/);
});

test('import clauses become the destructures that replace them', () => {
  assert.equal(bindingFor('* as THREE', '__m_t'), 'const THREE = __m_t;');
  assert.equal(bindingFor('{ a, b as c }', '__m_x'), 'const { a, b: c } = __m_x;');
  assert.equal(bindingFor(null, '__m_x'), 'void __m_x;');
});

// ---------- the graph ----------

test('the graph closes, and it is the walk severed from the editor', () => {
  assert.ok(files.includes('js/walk-main.js'), 'the entry point is in it');
  assert.ok(files.includes('libs/three.module.js'), 'three rides along');
  assert.ok(files.includes('js/save-load.js'), 'the export embeds its own deserializer');
  assert.ok(files.includes('js/share.js'), '…and its own codec');
  assert.equal(files[files.length - 1], 'js/walk-main.js', 'entry evaluates last');
  // The severance the twenty-phase discipline paid for: nothing the walk
  // doesn't need came along. A new import in a walk module that drags one of
  // these in should be a decision, not an accident.
  for (const out of ['js/main.js', 'js/editor.js', 'js/polyedit.js', 'js/propedit.js',
    'js/generate.js', 'js/program.js', 'js/brief.js', 'js/history.js',
    'js/session.js', 'js/presence.js', 'js/wire.js', 'js/cloud.js',
    'js/report.js', 'js/egress.js', 'js/daylight.js', 'js/spec.js',
    'js/carry.js', 'js/paint.js']) {
    assert.ok(!files.includes(out), `${out} stayed home`);
  }
});

// ---------- the bundle ----------

test('the bundle parses as one strict script with nothing modular left in it', () => {
  assert.ok(!/^import\s/m.test(bundle), 'no import statements');
  assert.ok(!/^export\s/m.test(bundle), 'no export statements');
  assert.ok(!/<\/script/i.test(bundle), 'cannot close its own script tag');
  // Module scripts are strict; the concatenation must survive the same goal.
  assert.doesNotThrow(() => new vm.Script(`'use strict';\n${bundle}`));
});

test('bundling is deterministic — same tree, same bytes', async () => {
  const again = await buildTemplate();
  assert.equal(again.html, built.html);
});

// ---------- the template ----------

test('the committed template is the one this tree builds (stale? run: node tools/export-walk.mjs)', async () => {
  const committed = await readFile(TEMPLATE_PATH, 'utf8');
  assert.ok(committed === built.html,
    'walk-template.html is stale — rebuild it with `node tools/export-walk.mjs` and commit the result');
});

test('the template keeps its design slot, and stays under the stated budget', () => {
  assert.ok(built.html.includes(DESIGN_MARKER), 'the design marker survives bundling');
  assert.ok(built.html.length <= TEMPLATE_BUDGET,
    `template is ${built.html.length} bytes, budget ${TEMPLATE_BUDGET}`);
});

// ---------- a design in it ----------

test('the sample school splices in, and the payload it carries opens again', async () => {
  const json = serialize(buildSampleSchool(), { omitOverlay: true });
  const payload = await encodeShare(json);
  const exported = spliceDesign(built.html, payload);
  assert.ok(!exported.includes(DESIGN_MARKER), 'the marker was replaced');
  assert.ok(exported.includes(payload), 'the payload is in the file');
  // The embedded page reads the payload back through the same codec and
  // deserializer the bundle carries — round-tripped here through the very
  // modules the graph test proved are in it.
  const m = exported.match(/<script id="sg-design" type="text\/plain">([^<]*)<\/script>/);
  assert.ok(m, 'the design rides in its own text script tag');
  const state = deserialize(await decodeShare(m[1]));
  assert.equal(state.floors.length, buildSampleSchool().floors.length);
});
