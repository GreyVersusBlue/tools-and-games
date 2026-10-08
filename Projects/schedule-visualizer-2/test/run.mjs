// Runs the tool's suites, one child process each, and exits non-zero if any
// failed. Every suite runs even after one fails.
//
//   node test/run.mjs            every group
//   node test/run.mjs --node     the plain-Node suites (no install, no browser)
//   node test/run.mjs --timing   the budgets at the promised size (plain Node too) // SV2-05
//
// The files are listed here by hand (`node --test dir/` fails on Node 22). A
// test file on disk that is missing from the list is itself a failure, so a
// suite cannot be forgotten. Later units add the --browser, --a11y and
// --timing groups to GROUPS.

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = path.dirname(TEST_DIR);

const GROUPS = {
  node: [
    'engine/purity.test.mjs',
    'engine/ids.test.mjs',
    'engine/schema.test.mjs',
    'engine/validate.test.mjs',
    'engine/migrate.test.mjs',
    'engine/repair.test.mjs',
    'engine/day-types.test.mjs',
    'engine/bells.test.mjs',
    'engine/actions.test.mjs',
    'engine/history.test.mjs',
    'engine/store.test.mjs',
    'engine/sample-school.test.mjs',
    'engine/csv.test.mjs',
    'engine/building.test.mjs', // SV2-04
    'engine/graph.test.mjs', // SV2-04
    'engine/building-checks.test.mjs', // SV2-04
    'engine/teacher-day.test.mjs', // SV2-09
    'engine/checks.test.mjs', // SV2-09
    'engine/routing.test.mjs', // SV2-05
    'engine/directions.test.mjs', // SV2-05
    'engine/import-groups.test.mjs', // SV2-10
    'engine/exports.test.mjs', // SV2-10
    'engine/project-file.test.mjs', // SV2-10
  ],
  browser: [],
  a11y: [],
  timing: [
    'timing/routing.mjs', // SV2-05
  ],
};

// Folders whose every *.test.mjs has to be in a group above.
const LISTED_FOLDERS = ['engine'];

const flags = process.argv.slice(2);
const unknown = flags.filter((flag) => !flag.startsWith('--') || !(flag.slice(2) in GROUPS));
if (unknown.length > 0) {
  console.error('Unknown argument: ' + unknown.join(' ') + '. Use any of ' + Object.keys(GROUPS).map((name) => '--' + name).join(', ') + ', or nothing for every group.');
  process.exit(2);
}
const chosen = flags.length === 0 ? Object.keys(GROUPS) : Object.keys(GROUPS).filter((name) => flags.includes('--' + name));

function tally(output, name) {
  const match = output.match(new RegExp('^# ' + name + ' (\\d+)$', 'm'));
  return match ? Number(match[1]) : null;
}

let failed = 0;
let ran = 0;
let cases = 0;

const listed = new Set(Object.values(GROUPS).flat());
for (const folder of LISTED_FOLDERS) {
  const dir = path.join(TEST_DIR, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.test.mjs') || listed.has(folder + '/' + file)) continue;
    console.log('FAIL  ' + folder + '/' + file + '  is on disk and not listed in test/run.mjs');
    failed += 1;
  }
}

for (const group of chosen) {
  for (const file of GROUPS[group]) {
    const started = process.hrtime.bigint();
    const result = spawnSync(process.execPath, ['--test-reporter=tap', path.join(TEST_DIR, ...file.split('/'))], {
      cwd: TOOL_DIR,
      env: { ...process.env, TZ: 'UTC' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const seconds = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
    const output = (result.stdout || '') + (result.stderr || '');
    const passed = tally(output, 'pass');
    const failures = tally(output, 'fail');
    const ok = result.status === 0 && !result.error;
    ran += 1;
    cases += passed === null ? 0 : passed;
    if (ok) {
      console.log('ok    ' + file + '  ' + (passed === null ? 'passed' : passed + ' passed') + '  ' + seconds + ' s');
    } else {
      failed += 1;
      const why = result.error ? result.error.message : 'exit ' + result.status + (failures ? ', ' + failures + ' failed' : '');
      console.log('FAIL  ' + file + '  ' + why + '  ' + seconds + ' s');
      console.log(output.split(/\r?\n/).map((line) => '      ' + line).join('\n'));
    }
  }
}

console.log('');
console.log(ran + ' test files, ' + cases + ' cases passed, ' + failed + ' failed (' + chosen.map((name) => '--' + name).join(' ') + ')');
process.exit(failed === 0 ? 0 : 1);
