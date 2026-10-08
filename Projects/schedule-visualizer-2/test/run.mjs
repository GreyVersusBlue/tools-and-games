// Runs the tool's suites, one child process each, and exits non-zero if any
// failed. Every suite runs even after one fails.
//
//   node test/run.mjs            every group
//   node test/run.mjs --node     the plain-Node suites (no install, no browser)
//   node test/run.mjs --browser  the journeys in Chromium, and the axe sweep
//   node test/run.mjs --a11y     token contrast (Node) and the axe sweep (Chromium)
//   node test/run.mjs --timing   the budgets at the promised size (plain Node too) // SV2-05
//   node test/run.mjs --browser --base http://127.0.0.1:8123
//                                against a server that is already running
//
// The files are listed here by hand (`node --test dir/` fails on Node 22). A
// test file on disk that is missing from the list is itself a failure, so a
// suite cannot be forgotten: every *.test.mjs anywhere under test/, and every
// .mjs in the folders whose files are all suites. A suite that runs and
// reports no case at all is a failure too, since an empty file would
// otherwise read as "ok". A file may be in two groups; it runs once however
// many of its groups are asked for. The browser suites need
// Tools/board-check installed (the site's harness); on a machine shared with
// other browser jobs, run them under that machine's lock.

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = path.dirname(TEST_DIR);

export const GROUPS = {
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
    'engine/load.test.mjs', // SV2-15
    'engine/places.test.mjs', // SV2-15
    'engine/crowd.test.mjs', // SV2-15
    'engine/import-groups.test.mjs', // SV2-10
    'engine/exports.test.mjs', // SV2-10
    'engine/project-file.test.mjs', // SV2-10
    'engine/presets.test.mjs', // SV2-02
    'engine/worker.test.mjs', // SV2-16, moved here from timing/pipeline.mjs by SV2-35
    'engine/runner.test.mjs', // SV2-35
    'engine/import-teachers.test.mjs', // SV2-35
    'engine/finding-ids.test.mjs', // SV2-35
    'ui/progress.test.mjs', // SV2-02
    'ui/helpers.test.mjs', // SV2-02
    'a11y/contrast.mjs', // SV2-33, listed by SV2-02
  ],
  browser: [
    'browser/shell.mjs',
    'browser/no-offsite.mjs',
    'browser/shell-lines.mjs', // SV2-35
    'browser/draw-pointer.mjs', // SV2-06
    'browser/draw-keyboard.mjs', // SV2-06
    'browser/draw-touch.mjs', // SV2-06
    'browser/storage.mjs', // SV2-03
    'browser/recovery.mjs', // SV2-03
    'browser/tabs.mjs', // SV2-03
    'browser/worker.mjs', // SV2-16
    'a11y/axe.mjs',
  ],
  a11y: [
    'a11y/contrast.mjs',
    'a11y/axe.mjs',
  ],
  timing: [
    'timing/routing.mjs', // SV2-05
    'timing/crowd.mjs', // SV2-15
    'timing/pipeline.mjs', // SV2-16
  ],
};

// Folders whose every .mjs is a suite and has to be in a group above, apart
// from the helpers named here, which the suites import. A *.test.mjs has to
// be in a group wherever under test/ it is.
export const SUITE_FOLDERS = { browser: ['harness.mjs', 'screens.mjs'], a11y: [], timing: [] };
// Groups whose suites take `--base <url>`.
const TAKES_BASE = ['browser', 'a11y'];

// Every file under `dir`, as paths from it with forward slashes, sorted.
export function filesUnder(dir, prefix) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = (prefix ? prefix + '/' : '') + entry.name;
    if (entry.isDirectory()) found.push(...filesUnder(path.join(dir, entry.name), name));
    else found.push(name);
  }
  return found;
}

// The suite files on disk that no group lists. `files` are paths from test/.
export function unlisted(files, groups, suiteFolders) {
  const listed = new Set(Object.values(groups).flat());
  return files.filter((file) => {
    if (listed.has(file)) return false;
    if (file.endsWith('.test.mjs')) return true;
    const slash = file.indexOf('/');
    const folder = slash === -1 ? '' : file.slice(0, slash);
    const rest = file.slice(slash + 1);
    return file.endsWith('.mjs') && folder in suiteFolders && !rest.includes('/') && !suiteFolders[folder].includes(rest);
  });
}

// What one suite's run comes to: { ok, why }. `passed` and `failures` are the
// counts its output gave, or null when it gave none.
export function verdict(run, passed, failures) {
  if (run.error) return { ok: false, why: run.error.message };
  if (run.status !== 0) return { ok: false, why: 'exit ' + run.status + (failures ? ', ' + failures + ' failed' : '') };
  if (!passed) return { ok: false, why: 'ran and reported no test case' };
  return { ok: true, why: '' };
}

function tally(output, name) {
  const match = output.match(new RegExp('^# ' + name + ' (\\d+)$', 'm'));
  return match ? Number(match[1]) : null;
}

function main(argv) {
  const flags = argv.slice();
  let base = null;
  const baseAt = flags.indexOf('--base');
  if (baseAt !== -1) {
    base = flags[baseAt + 1];
    if (!base || !/^https?:\/\//.test(base)) {
      console.error('--base needs an address after it, for example --base http://127.0.0.1:8123');
      return 2;
    }
    flags.splice(baseAt, 2);
  }
  const unknown = flags.filter((flag) => !flag.startsWith('--') || !(flag.slice(2) in GROUPS));
  if (unknown.length > 0) {
    console.error('Unknown argument: ' + unknown.join(' ') + '. Use any of ' + Object.keys(GROUPS).map((name) => '--' + name).join(', ') + ', or nothing for every group.');
    return 2;
  }
  const chosen = flags.length === 0 ? Object.keys(GROUPS) : Object.keys(GROUPS).filter((name) => flags.includes('--' + name));

  let failed = 0;
  let ran = 0;
  let cases = 0;

  for (const file of unlisted(filesUnder(TEST_DIR), GROUPS, SUITE_FOLDERS)) {
    console.log('FAIL  ' + file + '  is on disk and not listed in test/run.mjs');
    failed += 1;
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
      const outcome = verdict(result, passed, tally(output, 'fail'));
      ran += 1;
      cases += passed === null ? 0 : passed;
      if (outcome.ok) {
        console.log('ok    ' + file + '  ' + passed + ' passed  ' + seconds + ' s');
      } else {
        failed += 1;
        console.log('FAIL  ' + file + '  ' + outcome.why + '  ' + seconds + ' s');
        console.log(output.split(/\r?\n/).map((line) => '      ' + line).join('\n'));
      }
    }
  }

  console.log('');
  console.log(ran + ' test files, ' + cases + ' cases passed, ' + failed + ' failed (' + chosen.map((name) => '--' + name).join(' ') + ')');
  return failed === 0 ? 0 : 1;
}

// Run when this file is the program; test/engine/runner.test.mjs imports it
// for the rules above and nothing runs then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
