// ci-touched.test.mjs — the guard on ci-touched.mjs and ci-yaml.mjs.
//
//   node ci-touched.test.mjs        (from Tools/board-check; Node only, no browser)
//
// Three layers. The YAML reader against hand-made fixtures and against every
// real workflow file. The selection rules against the real workflows with
// pretend change lists (a change to Aphelion must select Site CI's Aphelion
// entry; a change nobody's filter covers must select only the board-check job).
// And the command line against a scratch repo whose one job is made to pass,
// to fail, and to fail with the failure listed as known, checking the exit code
// each time: a check that only prints is a check that gets ignored (#13).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './ci-yaml.mjs';
import { globToRegExp, expand, loadUnits, whySelected, unitsOf, HARNESS_FILES } from './ci-touched.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
let n = 0, bad = 0;
function check(name, ok, detail) {
  n++;
  if (ok) console.log(`  ok    ${name}`);
  else { bad++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = f => { try { f(); return false; } catch { return true; } };

console.log('\nci-yaml.mjs');
{
  const y = parseYaml(`# top
name: Demo # trailing
on:
  pull_request:
    paths:
      - "a/**"
      - 'b c/*.html'
  push:
    branches: [main, dev]
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: say: hello
        run: |
          echo "# not a comment"

          echo two
      - run: npm ci
  two:
    strategy:
      matrix:
        include:
          - name: A
            dir: .
          - name: B
            timeout: 30
`);
  check('on stays the string "on", and null values are null', eq(Object.keys(y), ['name', 'on', 'jobs']) && y.on.pull_request.paths.length === 2);
  check('quoted and flow scalars', eq(y.on.pull_request.paths, ['a/**', 'b c/*.html']) && eq(y.on.push.branches, ['main', 'dev']));
  check('a trailing comment is dropped', y.name === 'Demo');
  check('a "- key: value" item opens a map and a later key joins it', y.jobs.one.steps[1].name === 'say: hello' && y.jobs.one.steps[0].uses === 'actions/checkout@v4');
  check('a | block keeps # lines and blank lines inside', y.jobs.one.steps[1].run === 'echo "# not a comment"\n\necho two\n', JSON.stringify(y.jobs.one.steps[1].run));
  check('matrix include reads as a list of maps, numbers as numbers', y.jobs.two.strategy.matrix.include[1].timeout === 30 && y.jobs.two.strategy.matrix.include.length === 2);
  check('a folded scalar is refused, not misread', throws(() => parseYaml('a: >\n  x\n')));
  check('a flow map is refused, not misread', throws(() => parseYaml('a: {b: 1}\n')));
  check('a duplicate key is refused', throws(() => parseYaml('a: 1\na: 2\n')));
  check('a plain scalar continued on the next line is refused', throws(() => parseYaml('a: one\n  two\n')));
}

console.log('\nthe real workflows');
const files = readdirSync(join(ROOT, '.github/workflows')).filter(f => /\.ya?ml$/.test(f));
let units;
try {
  for (const f of files) parseYaml(readFileSync(join(ROOT, '.github/workflows', f), 'utf8'));
  check(`all ${files.length} workflow files parse`, true);
  units = loadUnits(ROOT);
} catch (e) { check('all workflow files parse', false, e.message); process.exit(1); }
{
  const site = parseYaml(readFileSync(join(ROOT, '.github/workflows/site-ci.yml'), 'utf8'));
  const entries = site.jobs.suites.strategy.matrix.include.length;
  check(`site-ci.yml: one unit per matrix entry (${entries})`, units.filter(u => u.file === 'site-ci.yml' && u.jobId === 'suites').length === entries);
  const dd = units.filter(u => u.file === 'daredevil-ci.yml' && u.jobId === 'transcripts');
  check('daredevil transcripts expands its nine matrix runs, each with ${{ matrix.run }} filled in', dd.length === 9 && dd.every(u => /transcript\.mjs \w+ --check/.test(u.commands[0].cmd)), JSON.stringify(dd[0] && dd[0].commands));
  const sv = units.filter(u => u.file === 'schedule-visualizer-2-ci.yml' && u.jobId === 'browser');
  check('SV2 browser expands two shards with the shard number in the command', sv.length === 2 && /--shard 1\/2/.test(sv[0].commands[0].cmd) && /--shard 2\/2/.test(sv[1].commands[0].cmd));
  const bad0 = units.filter(u => !u.skipReason && !u.commands.length).map(u => u.label);
  check('every job that is not skipped has at least one command', bad0.length === 0, bad0.join(', '));
  const unresolved = units.filter(u => u.commands.some(c => /\$\{\{/.test(c.cmd)) || /\$\{\{/.test(u.dir) || /\$\{\{/.test(u.install)).map(u => u.label);
  check('no ${{ }} is left unexpanded in a command, dir or install', unresolved.length === 0, unresolved.join(', '));
  const hd = units.find(u => u.file === 'hearth-ci.yml' && u.jobId === 'deep');
  check('hearth deep (schedule only) is a skipped job', hd && hd.skipReason !== '');
  check('hearth deep is marked schedule-only, so --scheduled can turn it on', hd && hd.scheduleOnly === true);
  {
    const ct = args => spawnSync(process.execPath, [join(HERE, 'ci-touched.mjs'), '--list', '--files', 'Projects/hearth/js/life.js', ...args], { encoding: 'utf8' });
    const off = ct([]), on = ct(['--scheduled', '--only', 'hearth-ci.yml / deep [decade]']);
    check('a skipped schedule-only job prints the command that runs it', /^SKIP +hearth-ci\.yml \/ deep/m.test(off.stdout) && /to run it now: node Tools\/board-check\/ci-touched\.mjs --scheduled --only "hearth-ci\.yml \/ deep"/.test(off.stdout), off.stdout);
    check('--scheduled lists the deep entry and no longer skips it', /^hearth-ci\.yml \/ deep \[decade\]/m.test(on.stdout) && /harness\.mjs decade/.test(on.stdout) && !/^SKIP .*deep/m.test(on.stdout), on.stdout);
  }
  const hg = units.find(u => u.file === 'hearth-ci.yml' && u.jobId === 'gate');
  check('hearth gate skips npm ci and playwright install but keeps the harness runs', hg && hg.skippedSteps.some(s => /npm ci/.test(s)) && hg.skippedSteps.some(s => /playwright install/.test(s)) && hg.commands.some(c => /harness\.mjs determinism/.test(c.cmd)) && hg.dir === 'Projects/hearth/test');
}

console.log('\nglobs and ${{ }}');
check('** crosses slashes', globToRegExp('Projects/x/**').test('Projects/x/a/b/c.js'));
check('* does not', !globToRegExp('Tools/*.html').test('Tools/a/b.html') && globToRegExp('Tools/*.html').test('Tools/b.html'));
check('a literal dot is not a wildcard', !globToRegExp('a.js').test('axjs'));
check('expand: matrix value, fallback literal, empty string', expand('${{ matrix.a }}', { a: 'x' }) === 'x' && expand("${{ matrix.t || 20 }}", {}) === '20' && expand("${{ matrix.i || '' }}", {}) === '');

console.log('\nselection');
const pick = changed => units.filter(u => !u.skipReason && whySelected(u, changed)).map(u => u.label);
const has = (list, s) => list.some(l => l.includes(s));
{
  const aph = pick(['Projects/aphelion/index.html']);
  check('an Aphelion file selects Site CI\'s Aphelion entry', has(aph, 'site-ci.yml / suites [Aphelion]'), aph.join(' | '));
  check('...and not another project\'s entry or workflow', !has(aph, '[Bell to Bell]') && !has(aph, 'torchbearer') && !has(aph, 'hearth'));
  check('...and always the board-check job, which has no folder', has(aph, 'site-ci.yml / board-check'));
  const sg = pick(['Projects/school-generator/js/main.js']);
  check('a School Generator file selects both of its jobs through the workflow path filter', has(sg, 'school-generator-ci.yml / suite') && has(sg, 'school-generator-ci.yml / browser'));
  const hz = pick(['Projects/hearth/test/harness.mjs']);
  check('a Hearth file selects the gate and not the schedule-only deep job', has(hz, 'hearth-ci.yml / gate') && !has(hz, 'hearth-ci.yml / deep'), hz.join(' | '));
  const gs = pick(['assets/js/gvb-save.js']);
  check('gvb-save.js selects the workflows that list it and the matrix entries that run its tests', has(gs, 'absalom-ci.yml') && has(gs, 'torchbearer-ci.yml') && has(gs, '[gvb-save.js]'), gs.join(' | '));
  const hs = pick([HARNESS_FILES[0]]);
  check('harness.mjs selects the matrix entries that install Tools/board-check', has(hs, '[Aphelion]') && has(hs, '[Signal City]') && !has(hs, '[Bell to Bell]'), hs.join(' | '));
  const nb = pick(['Tools/board-check/known-failures.json']);
  check('another board-check file selects only the entries rooted there', has(nb, '[Tavern click targets]') && !has(nb, '[Aphelion]'));
  const wf = pick(['.github/workflows/torchbearer-ci.yml']);
  check('a workflow file selects its own jobs', has(wf, 'torchbearer-ci.yml / suite'));
  const none = pick(['HISTORY.md']);
  check('a change no filter covers selects only board-check', none.length === 1 && has(none, 'board-check'), none.join(' | '));
  const sc = pick(['.github/workflows/suite.yml']);
  check('suite.yml selects everything that calls it', has(sc, 'absalom-ci.yml / suite') && has(sc, '[Aphelion]'));
}

{
  // A command that names no script (npm test) can only be tied to its folder by `dir`.
  const wf = parseYaml('name: X\non:\n  pull_request:\njobs:\n  suites:\n    strategy:\n      matrix:\n        include:\n          - name: Q\n            dir: Projects/quux\n            commands: |\n              npm test\n    uses: ./.github/workflows/suite.yml\n    with:\n      working-directory: ${{ matrix.dir }}\n      commands: ${{ matrix.commands }}\n');
  const [q] = unitsOf('x.yml', wf);
  check('an unfiltered entry is tied to its dir when its commands name no script', whySelected(q, ['Projects/quux/a.html']) !== '' && whySelected(q, ['Projects/other/a.html']) === '');
}

console.log('\nthe command line, against a scratch repo');
const scratch = mkdtempSync(join(tmpdir(), 'ci-touched-'));
try {
  mkdirSync(join(scratch, '.github/workflows'), { recursive: true });
  mkdirSync(join(scratch, 'proj'), { recursive: true });
  const wf = cmd => `name: Fixture CI
on:
  pull_request:
    paths:
      - "proj/**"
jobs:
  suite:
    name: fixture
    uses: ./.github/workflows/suite.yml
    with:
      working-directory: proj
      commands: |
        ${cmd}
`;
  const knownFile = join(scratch, 'known.json');
  const run = (cmd, known, extra = []) => {
    writeFileSync(join(scratch, '.github/workflows/fixture-ci.yml'), wf(cmd));
    writeFileSync(knownFile, JSON.stringify({ known }));
    return spawnSync(process.execPath, [join(HERE, 'ci-touched.mjs'), '--root', scratch, '--files', 'proj/a.js', ...extra], {
      encoding: 'utf8',
      env: { ...process.env, CI_TOUCHED_KNOWN: knownFile, CI_TOUCHED_LOCK: join(scratch, 'no-such-dir/lock'), CI_TOUCHED_LOGS: join(scratch, 'logs') },
    });
  };
  const fail = 'node -e "process.exit(3)"';
  writeFileSync(join(scratch, '.github/workflows/fixture-ci.yml'), wf(fail) + `  after:
    name: after
    needs: suite
    uses: ./.github/workflows/suite.yml
    with:
      working-directory: proj
      commands: |
        node -e "process.exit(0)"
`);
  writeFileSync(knownFile, JSON.stringify({ known: [] }));
  let r0 = spawnSync(process.execPath, [join(HERE, 'ci-touched.mjs'), '--root', scratch, '--files', 'proj/a.js'], { encoding: 'utf8', env: { ...process.env, CI_TOUCHED_KNOWN: knownFile, CI_TOUCHED_LOCK: join(scratch, 'x/lock'), CI_TOUCHED_LOGS: join(scratch, 'logs') } });
  check('a job whose needs: job failed is skipped, not run', r0.status === 1 && /^SKIP .*after.*needs suite/m.test(r0.stdout), r0.stdout);
  let r = run('node -e "process.exit(0)"', []);
  check('a passing job prints PASS and exits 0', r.status === 0 && /^PASS /m.test(r.stdout), r.stdout + r.stderr);
  r = run(fail, []);
  check('a failing command prints FAIL with the command and exits 1', r.status === 1 && /^FAIL /m.test(r.stdout) && /failed \(exit 3\)/.test(r.stdout), r.stdout + r.stderr);
  r = run(fail, [{ workflow: 'fixture-ci.yml', job: 'suite', command: fail, reason: 'fixture' }]);
  check('a listed failure prints KNOWN with its reason and exits 0', r.status === 0 && /^KNOWN /m.test(r.stdout) && /known \(fixture\)/.test(r.stdout), r.stdout + r.stderr);
  r = run('node -e "process.exit(0)"', [{ workflow: 'fixture-ci.yml', job: 'suite', command: 'node -e "process.exit(0)"', reason: 'fixture' }]);
  check('a listed command that now passes says to delete its entry', r.status === 0 && /delete its entry/.test(r.stdout), r.stdout);
  r = run('node -e "process.exit(0)"\n        ' + fail, []);
  check('every command runs even after one fails, and the job still fails', r.status === 1 && /\(2 commands/.test(r.stdout), r.stdout);
  r = run('node -e "process.exit(0)"', [], ['--only', 'nothing-matches-this']);
  check('--only that matches nothing runs nothing and exits 0', r.status === 0 && /0 of 1 CI jobs selected/.test(r.stdout), r.stdout);
  writeFileSync(join(scratch, '.github/workflows/fixture-ci.yml'), wf('node -e "process.exit(0)"').replace('uses: ./.github/workflows/suite.yml', 'uses: ./.github/workflows/suite.yml').replace('      working-directory: proj\n', '      working-directory: proj\n      install: proj\n'));
  r = spawnSync(process.execPath, [join(HERE, 'ci-touched.mjs'), '--root', scratch, '--files', 'proj/a.js'], { encoding: 'utf8', env: { ...process.env, CI_TOUCHED_KNOWN: knownFile, CI_TOUCHED_LOCK: join(scratch, 'x/lock'), CI_TOUCHED_LOGS: join(scratch, 'logs') } });
  check('an install folder with no node_modules fails the job instead of running it', r.status === 1 && /node_modules missing/.test(r.stdout), r.stdout);
} finally { rmSync(scratch, { recursive: true, force: true }); }

console.log(`\n${n} checks, ${bad} FAILED`);
process.exit(bad ? 1 : 0);
