// Runs the tool's suites, one child process each, and exits non-zero if any
// failed. Every suite runs even after one fails.
//
//   node test/run.mjs            every group
//   node test/run.mjs --node     the plain-Node suites (no install, no browser)
//   node test/run.mjs --browser  the journeys in Chromium, and the axe sweep
//   node test/run.mjs --a11y     token contrast (Node) and the axe sweep (Chromium)
//   node test/run.mjs --browser --base http://127.0.0.1:8123
//                                against a server that is already running
//
// The files are listed here by hand (`node --test dir/` fails on Node 22). A
// test file on disk that is missing from the list is itself a failure, so a
// suite cannot be forgotten. A file may be in two groups; it runs once however
// many of its groups are asked for. The browser suites need
// Tools/board-check installed (the site's harness); on a machine shared with
// other browser jobs, run them under that machine's lock. A later unit adds
// the --timing group.

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
    'engine/import-groups.test.mjs', // SV2-10
    'engine/exports.test.mjs', // SV2-10
    'engine/project-file.test.mjs', // SV2-10
    'engine/presets.test.mjs', // SV2-02
    'ui/progress.test.mjs', // SV2-02
    'ui/helpers.test.mjs', // SV2-02
    'a11y/contrast.mjs', // SV2-33, listed by SV2-02
  ],
  browser: [
    'browser/shell.mjs',
    'browser/no-offsite.mjs',
    'a11y/axe.mjs',
  ],
  a11y: [
    'a11y/contrast.mjs',
    'a11y/axe.mjs',
  ],
  timing: [],
};

// Folders whose every *.test.mjs has to be in a group above.
const LISTED_FOLDERS = ['engine', 'ui'];
// Folders whose every .mjs is a suite and has to be in a group above, apart
// from the helpers named here, which the suites import.
const SUITE_FOLDERS = { browser: ['harness.mjs', 'screens.mjs'], a11y: [] };
// Groups whose suites take `--base <url>`.
const TAKES_BASE = ['browser', 'a11y'];

const flags = process.argv.slice(2);
let base = null;
const baseAt = flags.indexOf('--base');
if (baseAt !== -1) {
  base = flags[baseAt + 1];
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('--base needs an address after it, for example --base http://127.0.0.1:8123');
    process.exit(2);
  }
  flags.splice(baseAt, 2);
}
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
for (const [folder, helpers] of Object.entries(SUITE_FOLDERS)) {
  const dir = path.join(TEST_DIR, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.mjs') || helpers.includes(file) || listed.has(folder + '/' + file)) continue;
    console.log('FAIL  ' + folder + '/' + file + '  is on disk and not listed in test/run.mjs');
    failed += 1;
  }
}

const done = new Set();

for (const group of chosen) {
  for (const file of GROUPS[group]) {
    if (done.has(file)) continue;
    done.add(file);
    const started = process.hrtime.bigint();
    const args = ['--test-reporter=tap', path.join(TEST_DIR, ...file.split('/'))];
    if (base && TAKES_BASE.includes(group)) args.push('--base', base);
    const result = spawnSync(process.execPath, args, {
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
