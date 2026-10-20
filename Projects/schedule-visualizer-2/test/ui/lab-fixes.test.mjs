// The M5 pass's lab and Fix dialog follow-ups that need no browser (SV2-72d):
// what is gone stays gone, and what the README says of Try it is what it does.
// The rest of SV2-72d's cases are in the files of what they check
// (scenario-actions, prints-congestion-scenario, difference, and the browser
// files scenario.mjs, difference.mjs, fix.mjs, congestion-scenario.mjs).
//
//   node test/ui/lab-fixes.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as common from '../../ui/schedule/common.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('notYet is gone from ui/schedule/common.js: Fix… is built, and nothing else used it', () => {
  assert.equal('notYet' in common, false);
});

test('README\'s fix.mjs row says Try it lands on the scenario\'s name field, as it does, not on the new chip', () => {
  const readme = fs.readFileSync(path.join(TOOL, 'README.md'), 'utf8');
  const row = readme.split('\n').find((line) => line.startsWith('| `test/browser/fix.mjs` |'));
  assert.ok(row, 'the row is there');
  assert.ok(row.includes('#scenario-name'), 'it names the field the focus goes to');
  assert.ok(!/new chip/.test(row), 'and no longer says the new chip');
});
