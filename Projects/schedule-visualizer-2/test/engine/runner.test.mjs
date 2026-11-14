// The two rules test/run.mjs holds every suite to: a suite file on disk that
// no group lists is a failure, and so is a suite that runs and reports no
// test case. The rules are plain functions, so they are checked here on lists
// of names, without a file being written anywhere. The same goes for the split
// of the browser group into parts (`--shard 1/2`) that CI runs as separate jobs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlisted, verdict, filesUnder, shardOf, parseShard, BROWSER_SECONDS, GROUPS as REAL_GROUPS, SUITE_FOLDERS as REAL_FOLDERS } from '../run.mjs';

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
  assert.deepEqual(REAL_GROUPS.timing, ['timing/routing.mjs', 'timing/crowd.mjs', 'timing/pipeline.mjs', 'timing/movement.mjs', 'timing/playback.mjs', 'timing/evacuation.mjs', 'timing/suggest.mjs', 'timing/scenario-lane.mjs', 'timing/kept-lane.mjs', 'timing/difference-card.mjs', 'timing/checks.mjs', 'timing/worker.mjs', 'timing/page.mjs']);
  for (const helper of REAL_FOLDERS.browser) assert.ok(files.includes('browser/' + helper), helper + ' is named as a helper and is not on disk');
});

test('--shard: the parts of the browser group are disjoint and together are the whole group, for 2 and for 3 (SV2-95)', () => {
  const whole = REAL_GROUPS.browser;
  for (const count of [2, 3]) {
    const parts = Array.from({ length: count }, (_, at) => shardOf(whole, at + 1, count));
    const seen = new Map();
    parts.forEach((part, at) => {
      assert.ok(part.length > 0, 'part ' + (at + 1) + ' of ' + count + ' is empty');
      for (const file of part) {
        assert.equal(seen.has(file), false, file + ' is in part ' + seen.get(file) + ' and part ' + (at + 1) + ' of ' + count);
        seen.set(file, at + 1);
      }
    });
    assert.deepEqual([...seen.keys()].sort(), [...whole].sort(), 'the union of the ' + count + ' parts is not the browser group');
    // a part keeps the group's own order
    for (const part of parts) assert.deepEqual(part, whole.filter((file) => part.includes(file)));
  }
});

test('--shard: the same list always splits the same way, and a count of 1 is the whole list', () => {
  assert.deepEqual(shardOf(REAL_GROUPS.browser, 1, 2), shardOf(REAL_GROUPS.browser.slice(), 1, 2));
  assert.deepEqual(shardOf(REAL_GROUPS.browser, 1, 1), REAL_GROUPS.browser);
});

test('--shard: a file with no recorded time still lands in exactly one part, and the heavy files are spread', () => {
  const files = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'new.mjs'];
  const seconds = { 'a.mjs': 100, 'b.mjs': 100, 'c.mjs': 10, 'd.mjs': 10 };
  const one = shardOf(files, 1, 2, seconds);
  const two = shardOf(files, 2, 2, seconds);
  assert.equal(one.length + two.length, files.length);
  assert.equal(new Set([...one, ...two]).size, files.length);
  assert.ok(one.includes('a.mjs') !== one.includes('b.mjs'), 'the two heavy files share a part');
});

test('--shard: the real browser group splits within 25% on the recorded CI times, for 2 and for 3', () => {
  for (const count of [2, 3]) {
    const totals = Array.from({ length: count }, (_, at) => shardOf(REAL_GROUPS.browser, at + 1, count).reduce((sum, file) => sum + (BROWSER_SECONDS[file] ?? 30), 0));
    // three parts cannot beat the biggest file (no-offsite, about 1100 s of 3300), so the bound is the larger of 25% and that file
    const bound = Math.max(Math.min(...totals) * 1.25, Math.max(...Object.values(BROWSER_SECONDS)));
    assert.ok(Math.max(...totals) <= bound, 'parts of ' + count + ' take ' + totals.join(', ') + ' s');
  }
});

test('--shard: every file in the recorded times is still in the browser group, so the table cannot go stale', () => {
  const listed = new Set(REAL_GROUPS.browser);
  for (const file of Object.keys(BROWSER_SECONDS)) assert.ok(listed.has(file), file + ' has a recorded time in test/run.mjs and is not in the browser group');
});

test('--shard: only "part/count" with the part from 1 to the count is accepted', () => {
  assert.deepEqual(parseShard('1/2'), { index: 1, count: 2 });
  assert.deepEqual(parseShard('3/3'), { index: 3, count: 3 });
  for (const bad of ['0/2', '3/2', '1', '1/0', 'a/b', '', undefined, '1/2/3', '-1/2']) assert.equal(parseShard(bad), null, String(bad));
});
