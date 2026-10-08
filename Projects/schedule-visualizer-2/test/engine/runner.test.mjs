// The two rules test/run.mjs holds every suite to: a suite file on disk that
// no group lists is a failure, and so is a suite that runs and reports no
// test case. The rules are plain functions, so they are checked here on lists
// of names, without a file being written anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlisted, verdict, filesUnder, GROUPS as REAL_GROUPS, SUITE_FOLDERS as REAL_FOLDERS } from '../run.mjs';

const GROUPS = { node: ['engine/a.test.mjs', 'a11y/contrast.mjs'], browser: ['browser/shell.mjs'], timing: ['timing/routing.mjs'] };
const SUITE_FOLDERS = { browser: ['harness.mjs'], a11y: [], timing: [] };

test('a *.test.mjs in any folder under test/ has to be listed, however deep it is', () => {
  const files = ['engine/a.test.mjs', 'engine/b.test.mjs', 'ui/c.test.mjs', 'publish/d.test.mjs', 'publish/baseline/e.test.mjs', 'f.test.mjs', 'timing/g.test.mjs'];
  assert.deepEqual(unlisted(files, GROUPS, SUITE_FOLDERS), ['engine/b.test.mjs', 'ui/c.test.mjs', 'publish/d.test.mjs', 'publish/baseline/e.test.mjs', 'f.test.mjs', 'timing/g.test.mjs']);
});

test('in a folder whose files are all suites, every .mjs has to be listed, apart from its named helpers', () => {
  const files = ['browser/shell.mjs', 'browser/harness.mjs', 'browser/new-journey.mjs', 'a11y/contrast.mjs', 'a11y/axe.mjs', 'timing/routing.mjs', 'timing/pipeline.mjs'];
  assert.deepEqual(unlisted(files, GROUPS, SUITE_FOLDERS), ['browser/new-journey.mjs', 'a11y/axe.mjs', 'timing/pipeline.mjs']);
});

test('helpers, fixtures and files that are not modules are left alone', () => {
  const files = ['engine/helpers.mjs', 'fixtures/big.mjs', 'fixtures/formats/project-v1.json', 'vendor/axe-core/axe.min.js', 'a11y/README.md', 'browser/shots/x.mjs', 'run.mjs'];
  assert.deepEqual(unlisted(files, GROUPS, SUITE_FOLDERS), []);
});

test('a suite that exits clean and reports no case is a failure', () => {
  assert.deepEqual(verdict({ status: 0 }, 0, 0), { ok: false, why: 'ran and reported no test case' });
  assert.deepEqual(verdict({ status: 0 }, null, null), { ok: false, why: 'ran and reported no test case' });
  assert.deepEqual(verdict({ status: 0 }, 3, 0), { ok: true, why: '' });
});

test('a suite that exits non-zero, or could not be started, is a failure whatever it counted', () => {
  assert.deepEqual(verdict({ status: 1 }, 4, 2), { ok: false, why: 'exit 1, 2 failed' });
  assert.deepEqual(verdict({ status: 1 }, null, null), { ok: false, why: 'exit 1' });
  assert.deepEqual(verdict({ status: null, error: new Error('spawn ENOENT') }, null, null), { ok: false, why: 'spawn ENOENT' });
});

test('filesUnder walks the real test folder into its folders, with forward slashes on every machine', () => {
  const files = filesUnder(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  assert.ok(files.includes('engine/runner.test.mjs') && files.includes('fixtures/big.mjs'), 'the walk goes into folders and uses forward slashes');
  assert.ok(files.filter((file) => file.endsWith('.test.mjs')).length > 25);
});

test('the runner\'s own lists: every suite on disk is listed, and browser/, a11y/ and timing/ are each policed', () => {
  const files = filesUnder(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  assert.deepEqual(unlisted(files, REAL_GROUPS, REAL_FOLDERS), []);
  for (const folder of ['browser', 'a11y', 'timing']) {
    assert.deepEqual(unlisted([folder + '/a-new-suite.mjs'], REAL_GROUPS, REAL_FOLDERS), [folder + '/a-new-suite.mjs'], 'a new file in test/' + folder + '/ would not have to be listed');
  }
  assert.ok(REAL_GROUPS.node.includes('engine/worker.test.mjs'), 'the pipeline\'s correctness cases run with the plain-Node suites');
  assert.deepEqual(REAL_GROUPS.timing, ['timing/routing.mjs', 'timing/crowd.mjs', 'timing/pipeline.mjs']);
  for (const helper of REAL_FOLDERS.browser) assert.ok(files.includes('browser/' + helper), helper + ' is named as a helper and is not on disk');
});
