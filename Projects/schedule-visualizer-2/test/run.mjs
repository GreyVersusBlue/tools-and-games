// Runs the tool's suites, one child process each, and exits non-zero if any
// failed. Every suite runs even after one fails.
//
//   node test/run.mjs            every group
//   node test/run.mjs --node     the plain-Node suites (no install, no browser)
//   node test/run.mjs --browser  the journeys in Chromium, and the axe sweep
//   node test/run.mjs --a11y     token contrast (Node) and the axe sweep (Chromium)
//   node test/run.mjs --timing   the budgets at the promised size (plain Node, and timing/page.mjs in Chromium) // SV2-05, SV2-32i
//   node test/run.mjs --browser --base http://127.0.0.1:8123
//                                against a server that is already running
//   node test/run.mjs --browser --shard 1/2
//                                the first of two parts of the browser group (CI runs
//                                both, one job each); every file is in exactly one part
//   node test/run.mjs --browser --list
//                                print the files a run would execute, run none
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
    'engine/calendar.test.mjs',
    'engine/runs.test.mjs',
    'engine/marks.test.mjs', // SV2-83
    'engine/release.test.mjs', // SV2-88
    'engine/runs-today.test.mjs', // SV2-76
    'engine/bell-runs.test.mjs', // SV2-76
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
    'engine/checks-duties.test.mjs', // SV2-84
    'engine/routing.test.mjs', // SV2-05
    'engine/directions.test.mjs', // SV2-05
    'engine/load.test.mjs', // SV2-15
    'engine/places.test.mjs', // SV2-15
    'engine/crowd.test.mjs', // SV2-15
    'engine/import-groups.test.mjs', // SV2-10
    'engine/exports.test.mjs', // SV2-10
    'engine/project-file.test.mjs', // SV2-10
    'engine/import-calendar.test.mjs', // SV2-77
    'engine/publish-data.test.mjs', // SV2-20
    'engine/publish-crypto.test.mjs', // SV2-20
    'publish/linker.test.mjs', // SV2-20
    'publish/manifest.test.mjs', // SV2-20
    'publish/staff.test.mjs', // SV2-20
    'publish/baseline.mjs', // SV2-20
    'engine/presets.test.mjs', // SV2-02
    'engine/worker.test.mjs', // SV2-16, moved here from timing/pipeline.mjs by SV2-35
    'engine/runner.test.mjs', // SV2-35
    'engine/import-teachers.test.mjs', // SV2-35
    'engine/finding-ids.test.mjs', // SV2-35
    'engine/prints.test.mjs', // SV2-14
    'engine/plan-svg-safety.test.mjs', // SV2-108
    'engine/prints-batch.test.mjs', // SV2-24
    'engine/readers.test.mjs', // SV2-42
    'engine/prints-movement.test.mjs', // SV2-18
    'engine/grid-edits.test.mjs', // SV2-12
    'engine/import-subjects.test.mjs', // SV2-13
    'engine/scenario.test.mjs', // SV2-60
    'engine/evacuation.test.mjs', // SV2-62
    'engine/exit-load.test.mjs', // SV2-107
    'engine/blocked.test.mjs', // SV2-107
    'engine/step-free.test.mjs', // SV2-100
    'engine/scenario-actions.test.mjs', // SV2-61
    'engine/scenarios-kept.test.mjs', // SV2-113
    'engine/project-label.test.mjs', // SV2-113
    'engine/prints-door-cards.test.mjs', // SV2-66
    'engine/prints-step-free.test.mjs', // SV2-104
    'engine/prints-route-sheet.test.mjs', // SV2-103
    'engine/prints-lockdown-map.test.mjs', // SV2-110
    'engine/prints-evacuation-poster.test.mjs', // SV2-110
    'engine/prints-map-pack.test.mjs', // SV2-111
    'engine/prints-calendar.test.mjs', // SV2-80
    'engine/suggest.test.mjs', // SV2-63
    'engine/prints-congestion-scenario.test.mjs', // SV2-71
    'engine/snapshots.test.mjs', // SV2-28
    'engine/transfer.test.mjs', // SV2-29a
    'engine/transfer-qr.test.mjs', // SV2-29a
    'engine/help.test.mjs', // SV2-30a
    'engine/prints-schedule.test.mjs', // SV2-32d
    'engine/prints-travel.test.mjs', // SV2-32d
    'engine/vocabulary.test.mjs', // SV2-32f
    'ui/progress.test.mjs', // SV2-02
    'ui/helpers.test.mjs', // SV2-02
    'ui/building-inspector.test.mjs', // SV2-07
    'ui/movement.test.mjs', // SV2-17
    'ui/movement-across.test.mjs', // SV2-79b
    'ui/walk-across.test.mjs', // SV2-79c
    'ui/playback.test.mjs', // SV2-44
    'ui/room-picker.test.mjs', // SV2-48
    'ui/marks-duties.test.mjs', // SV2-85
    'ui/schedule-address.test.mjs', // SV2-54
    'ui/staff-pass.test.mjs', // SV2-45
    'ui/engine-client.test.mjs', // SV2-49
    'ui/plan-map.test.mjs', // SV2-65
    'ui/scenario-lane.test.mjs', // SV2-64
    'ui/safety.test.mjs', // SV2-67b
    'ui/exit-colours.test.mjs', // SV2-72c
    'ui/renderer-labels.test.mjs', // SV2-72c
    'ui/scenarios-model.test.mjs', // SV2-68b
    'ui/difference.test.mjs', // SV2-69
    'ui/fix-kinds.test.mjs', // SV2-70b
    'ui/lab-fixes.test.mjs', // SV2-72d
    'ui/label-scale.test.mjs', // SV2-31
    'ui/elevator-plan.test.mjs', // SV2-101e
    'ui/set-view.test.mjs', // SV2-31c
    'ui/auto-snapshots.test.mjs', // SV2-28b
    'ui/scale-tool.test.mjs', // SV2-73a
    'ui/picker.test.mjs', // SV2-32q
    'a11y/contrast.mjs', // SV2-33, listed by SV2-02
  ],
  browser: [
    'browser/shell.mjs',
    'browser/no-offsite.mjs',
    'browser/shell-lines.mjs', // SV2-35
    'browser/shell-owed.mjs', // SV2-36
    'browser/m1-pass.mjs', // SV2-08
    'browser/draw-pointer.mjs', // SV2-06
    'browser/draw-keyboard.mjs', // SV2-06
    'browser/draw-touch.mjs', // SV2-06
    'browser/doors-stairs.mjs', // SV2-07
    'browser/elevators.mjs', // SV2-101
    'browser/inspector.mjs', // SV2-07
    'browser/search.mjs', // SV2-07
    'browser/storage.mjs', // SV2-03
    'browser/storage-shelf.mjs', // SV2-115
    'browser/recovery.mjs', // SV2-03
    'browser/tabs.mjs', // SV2-03
    'browser/schedule.mjs', // SV2-11
    'browser/grid.mjs', // SV2-12
    'browser/day-types.mjs', // SV2-78
    'browser/calendar.mjs', // SV2-80
    'browser/calendar-review.mjs', // SV2-80b
    'browser/marks-duties.mjs', // SV2-85
    'browser/release.mjs', // SV2-93
    'browser/one-way.mjs', // SV2-91
    'browser/step-marks.mjs', // SV2-101b
    'browser/step-free-movement.mjs', // SV2-102
    'browser/calendar-faults.mjs', // SV2-80c
    'browser/grid-pass.mjs', // SV2-40, SV2-46
    'browser/m2-pass.mjs', // SV2-38
    'browser/sample-whole.mjs', // SV2-87b
    'browser/import.mjs', // SV2-13
    'browser/project-file.mjs', // SV2-13
    'browser/worker.mjs', // SV2-16
    'browser/print.mjs', // SV2-14
    'browser/building-files.mjs', // SV2-32c
    'browser/staff-shell.mjs', // SV2-20
    'browser/staff-views-a.mjs', // SV2-21
    'browser/staff-views-b.mjs', // SV2-22
    'browser/staff-step-free.mjs', // SV2-105
    'browser/staff-outputs.mjs', // SV2-23
    'browser/staff-pictures.mjs', // SV2-32e
    'browser/staff-calendar.mjs', // SV2-81
    'browser/staff-duties.mjs', // SV2-86
    'browser/publish.mjs', // SV2-24
    'browser/m4-pass.mjs', // SV2-45
    'browser/movement.mjs', // SV2-17
    'browser/movement-bells.mjs', // SV2-79
    'browser/hotspots.mjs', // SV2-18
    'browser/playback.mjs', // SV2-19
    'browser/m3-pass.mjs', // SV2-43
    'browser/plan-map.mjs', // SV2-65b
    'browser/safety.mjs', // SV2-67
    'browser/step-free-safety.mjs', // SV2-104
    'browser/safety-what-if.mjs', // SV2-109
    'browser/safety-prints.mjs', // SV2-111
    'browser/route-sheet.mjs', // SV2-103
    'browser/scenario.mjs', // SV2-68
    'browser/scenario-levers.mjs', // SV2-92
    'browser/congestion-scenario.mjs', // SV2-71
    'browser/difference.mjs', // SV2-69
    'browser/fix.mjs', // SV2-70
    'browser/m5-pass.mjs', // SV2-72f
    'browser/snapshots.mjs', // SV2-28
    'browser/transfer.mjs', // SV2-29b
    'browser/help.mjs', // SV2-30a
    'browser/present.mjs', // SV2-31
    'browser/auto-snapshots.mjs', // SV2-28b
    'browser/getting-started.mjs', // SV2-30b
    'browser/empty-states.mjs', // SV2-30b
    'browser/trace-scale.mjs', // SV2-73a
    'browser/journeys-touch.mjs', // SV2-32h2
    'browser/journeys-keys.mjs', // SV2-32h1
    'a11y/axe.mjs',
    'a11y/staff-axe.mjs', // SV2-32g2
  ],
  a11y: [
    'a11y/contrast.mjs',
    'a11y/axe.mjs',
    'a11y/staff-axe.mjs', // SV2-32g2
  ],
  timing: [
    'timing/routing.mjs', // SV2-05
    'timing/crowd.mjs', // SV2-15
    'timing/pipeline.mjs', // SV2-16
    'timing/movement.mjs', // SV2-39
    'timing/playback.mjs', // SV2-44
    'timing/evacuation.mjs', // SV2-62
    'timing/suggest.mjs', // SV2-63
    'timing/scenario-lane.mjs', // SV2-64
    'timing/difference-card.mjs', // SV2-69c
    'timing/checks.mjs', // SV2-32i
    'timing/worker.mjs', // SV2-32i
    'timing/page.mjs', // SV2-32i: starts Chromium (Tools/board-check installed)
  ],
};

// How long each browser suite took on CI's runner (seconds, from the green run
// of 2026-11-04 18:01 UTC, https://github.com/GreyVersusBlue/tools-and-games
// actions run 41882849430), which is what `--shard` balances by. Only the split
// reads it: a file missing here is given DEFAULT_SECONDS, and a file listed here
// that is not in the browser group fails runner.test.mjs, so the table cannot
// go stale unnoticed. Re-read it from a CI log when a suite's cost changes much.
export const BROWSER_SECONDS = {
  'browser/no-offsite.mjs': 1104,
  'a11y/axe.mjs': 705,
  'a11y/staff-axe.mjs': 299,
  'browser/publish.mjs': 119,
  'browser/m3-pass.mjs': 106,
  'browser/transfer.mjs': 75,
  'browser/m2-pass.mjs': 58,
  'browser/present.mjs': 57,
  'browser/m5-pass.mjs': 42,
  'browser/staff-outputs.mjs': 36,
  'browser/journeys-touch.mjs': 36,
  'browser/journeys-keys.mjs': 27,
  'browser/hotspots.mjs': 27,
  'browser/plan-map.mjs': 26,
  'browser/storage.mjs': 24,
  'browser/storage-shelf.mjs': 10,
  'browser/recovery.mjs': 23,
  'browser/scenario.mjs': 21,
  'browser/fix.mjs': 21,
  'browser/safety.mjs': 20,
  'browser/step-free-safety.mjs': 20,
  'browser/safety-what-if.mjs': 25,
  'browser/safety-prints.mjs': 25,
  'browser/route-sheet.mjs': 10,
  'browser/scenario-levers.mjs': 20,
  'browser/playback.mjs': 19,
  'browser/shell.mjs': 19,
  'browser/sample-whole.mjs': 19,
  'browser/day-types.mjs': 19,
  'browser/print.mjs': 18,
  'browser/staff-pictures.mjs': 16,
  'browser/staff-shell.mjs': 16,
  'browser/help.mjs': 16,
  'browser/getting-started.mjs': 15,
  'browser/release.mjs': 14,
  'browser/staff-calendar.mjs': 13,
  'browser/movement.mjs': 13,
  'browser/staff-views-a.mjs': 13,
  'browser/calendar-review.mjs': 13,
  'browser/snapshots.mjs': 12,
  'browser/tabs.mjs': 12,
  'browser/auto-snapshots.mjs': 12,
  'browser/trace-scale.mjs': 12,
  'browser/one-way.mjs': 12,
  'browser/step-marks.mjs': 10,
  'browser/step-free-movement.mjs': 11,
  'browser/draw-pointer.mjs': 12,
  'browser/staff-views-b.mjs': 11,
  'browser/schedule.mjs': 11,
  'browser/marks-duties.mjs': 11,
  'browser/grid-pass.mjs': 10,
  'browser/movement-bells.mjs': 10,
  'browser/draw-keyboard.mjs': 9,
  'browser/grid.mjs': 9,
  'browser/inspector.mjs': 7,
  'browser/m4-pass.mjs': 7,
  'browser/calendar.mjs': 6,
  'browser/import.mjs': 6,
  'browser/draw-touch.mjs': 6,
  'browser/difference.mjs': 6,
  'browser/staff-duties.mjs': 5,
  'browser/calendar-faults.mjs': 5,
  'browser/doors-stairs.mjs': 5,
  'browser/elevators.mjs': 6,
  'browser/m1-pass.mjs': 5,
  'browser/congestion-scenario.mjs': 5,
  'browser/shell-owed.mjs': 4,
  'browser/building-files.mjs': 4,
  'browser/empty-states.mjs': 4,
  'browser/shell-lines.mjs': 4,
  'browser/search.mjs': 3,
  'browser/project-file.mjs': 2,
  'browser/worker.mjs': 1,
};
export const DEFAULT_SECONDS = 30;

// The `index`th (1-based) of `count` parts of `files`: heaviest first, each file
// to the part with the least so far (the lower-numbered on a tie), so the same
// list always splits the same way; the part comes back in the list's own order.
// Every file is in exactly one part.
export function shardOf(files, index, count, seconds = BROWSER_SECONDS) {
  const load = new Array(count).fill(0);
  const part = new Map();
  const weight = (file) => (file in seconds ? seconds[file] : DEFAULT_SECONDS);
  const order = files.map((file, at) => ({ file, at })).sort((a, b) => weight(b.file) - weight(a.file) || a.at - b.at);
  for (const { file } of order) {
    let lightest = 0;
    for (let n = 1; n < count; n += 1) if (load[n] < load[lightest]) lightest = n;
    load[lightest] += weight(file);
    part.set(file, lightest + 1);
  }
  return files.filter((file) => part.get(file) === index);
}

// '2/3' as { index: 2, count: 3 }, or null when it is not one.
export function parseShard(text) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(text || '');
  if (!match || Number(match[1]) > Number(match[2])) return null;
  return { index: Number(match[1]), count: Number(match[2]) };
}

// Folders whose every .mjs is a suite and has to be in a group above, apart
// from the helpers named here, which the suites import. A *.test.mjs has to
// be in a group wherever under test/ it is.
export const SUITE_FOLDERS = { browser: ['harness.mjs', 'screens.mjs'], a11y: [], timing: ['big-runs.mjs'] };
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
  let shard = null;
  const shardAt = flags.indexOf('--shard');
  if (shardAt !== -1) {
    shard = parseShard(flags[shardAt + 1]);
    if (!shard) {
      console.error('--shard needs a part and a count after it, for example --shard 1/2 (the part is 1 to the count)');
      return 2;
    }
    flags.splice(shardAt, 2);
  }
  const listAt = flags.indexOf('--list');
  const listOnly = listAt !== -1;
  if (listOnly) flags.splice(listAt, 1);
  const unknown = flags.filter((flag) => !flag.startsWith('--') || !(flag.slice(2) in GROUPS));
  if (unknown.length > 0) {
    console.error('Unknown argument: ' + unknown.join(' ') + '. Use any of ' + Object.keys(GROUPS).map((name) => '--' + name).join(', ') + ', or nothing for every group.');
    return 2;
  }
  const chosen = flags.length === 0 ? Object.keys(GROUPS) : Object.keys(GROUPS).filter((name) => flags.includes('--' + name));

  if (shard && (chosen.length !== 1 || chosen[0] !== 'browser')) {
    console.error('--shard splits the browser group, so it goes with --browser and no other group.');
    return 2;
  }

  let failed = 0;
  let ran = 0;
  let cases = 0;

  // The unlisted-file rule looks at the whole of test/, not at a part: with a
  // shard it runs in part 1 only, so a forgotten file fails once, not once per part.
  if (!shard || shard.index === 1) {
    for (const file of unlisted(filesUnder(TEST_DIR), GROUPS, SUITE_FOLDERS)) {
      console.log('FAIL  ' + file + '  is on disk and not listed in test/run.mjs');
      failed += 1;
    }
  }

  const done = new Set();

  for (const group of chosen) {
    const files = shard ? shardOf(GROUPS[group], shard.index, shard.count) : GROUPS[group];
    for (const file of files) {
      if (done.has(file)) continue;
      done.add(file);
      if (listOnly) {
        console.log(file);
        continue;
      }
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

  if (listOnly) {
    console.log('');
    console.log(done.size + ' test files would run (' + chosen.map((name) => '--' + name).join(' ') + (shard ? ' --shard ' + shard.index + '/' + shard.count : '') + ')');
    return failed === 0 ? 0 : 1;
  }

  if (ran === 0) {
    console.log('FAIL  no test file ran: a run that checks nothing is not a pass');
    failed += 1;
  }

  console.log('');
  console.log(ran + ' test files, ' + cases + ' cases passed, ' + failed + ' failed (' + chosen.map((name) => '--' + name).join(' ') + (shard ? ' --shard ' + shard.index + '/' + shard.count : '') + ')');
  return failed === 0 ? 0 : 1;
}

// Run when this file is the program; test/engine/runner.test.mjs imports it
// for the rules above and nothing runs then.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
