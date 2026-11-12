// ci-touched.mjs — run on this machine what CI will run for the files a change
// touched.
//
//   node ci-touched.mjs                      (from anywhere; diffs origin/main...HEAD)
//   node ci-touched.mjs --base <ref> [--head <ref>]
//   node ci-touched.mjs --files a,b,c        (skip git; pretend these changed)
//   node ci-touched.mjs --list               (print the plan, run nothing)
//   node ci-touched.mjs --only aphelion      (jobs whose "file / job [entry]" label contains this)
//   node ci-touched.mjs --skip hearth        (the opposite; both may repeat)
//   node ci-touched.mjs --dirty              (also count uncommitted and untracked files)
//   node ci-touched.mjs --verbose            (stream every command's output)
//
// Why it exists (HISTORY #1048): `npm run check`, `social:check` and
// ci-check.mjs are the only things a session's definition of done runs, and none
// of them runs a project suite. On 2026-11-05 TG-62 added a
// `@media (pointer: coarse)` rule to Aphelion, Site CI's Aphelion job failed
// `test/desktop-input.mjs` at the landing, and nothing local had ever run it.
//
// What it does: reads every .github/workflows/*.yml, works out which jobs the
// changed files would start, and runs those jobs' commands here, in order, from
// the directory CI runs them in. One line per job; exit 1 if any job failed.
//
//   - A workflow with `on.pull_request.paths` starts, in full, when a changed
//     file matches one of its globs (GitHub's `*`, `**`, `?` rules).
//   - site-ci.yml has no path filter: CI runs all of it on every PR. Running
//     every matrix entry for every change would take an hour, so an entry is
//     selected when a changed file is under its `dir`, under the folder of any
//     script its commands name, or is one of the harness files
//     (HARNESS_FILES) and the entry installs Tools/board-check. The
//     `board-check` job, which has no folder, is always selected.
//   - A change to a workflow file selects that workflow; a change to suite.yml
//     selects every job that calls it.
//   - Jobs only for schedule or workflow_dispatch are skipped and say so, with the
//     command that runs them; `--scheduled` runs them for the touched paths.
//
// What it will not do, and says it did not: `npm ci`, `npm install` and
// `playwright install` steps (this machine has its dependencies and its
// browsers, and an install has deleted the cached browsers before), `uses:`
// steps, and `if: failure()` steps. A job whose `install:` folder has no
// node_modules fails loudly, since CI would have run `npm ci` there.
//
// Browser commands run under flock on the suites lock, one at a time across
// every session on the machine, with the Playwright 1.56.1 prefix and the
// Chromium 1194 folder (the ones CI's baselines were made with). That recipe is
// huginn's; each part is overridable and is skipped, with a notice, where the
// folder is absent:
//
//   CI_TOUCHED_LOCK        default ~/.cache/selector-locks/tools-and-games-suites.lock
//   CI_TOUCHED_PW_PREFIX   default ~/.cache/selector-scratch/selector/pwprefix
//   CI_TOUCHED_PW_BROWSERS default ~/projects/.pw-1194
//   CI_TOUCHED_KNOWN       default Tools/board-check/ci-touched-known.json
//   CI_TOUCHED_LOGS        default ~/.cache/ci-touched/<timestamp>/  (one log per job)
//
// "A browser command" is every command of a job that has an `install:` folder
// or installs Playwright; in any other job, a command whose script file names
// harness, playwright, puppeteer or chromium.
//
// Failures that are known on this machine live in ci-touched-known.json, one
// entry per command. A listed command that fails prints KNOWN and does not fail
// the run; one that passes prints a note asking for its line to be deleted.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseYaml } from './ci-yaml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Files that every harness-using matrix entry depends on (the ones the per-project workflows list). */
export const HARNESS_FILES = [
  'Tools/board-check/harness.mjs',
  'Tools/board-check/drive.mjs',
  'Tools/board-check/package.json',
  'Tools/board-check/package-lock.json',
];
const HARNESS_INSTALL = 'Tools/board-check';

/* ---------------- globs ------------------------------------------------------ */

/** GitHub path filter → RegExp: `**` crosses slashes, `*` and `?` do not. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/* ---------------- ${{ }} ----------------------------------------------------- */

/** Substitute `${{ matrix.x }}` and `${{ matrix.x || literal }}`; leave anything else alone. */
export function expand(value, matrix) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (whole, expr) => {
    const parts = expr.split('||').map(s => s.trim());
    for (const part of parts) {
      const m = /^matrix\.([\w-]+)$/.exec(part);
      if (m) { if (matrix && matrix[m[1]] !== undefined && matrix[m[1]] !== '') return String(matrix[m[1]]); continue; }
      const lit = /^'(.*)'$/.exec(part);
      if (lit) return lit[1];
      if (/^-?\d+(\.\d+)?$/.test(part)) return part;
      return whole;
    }
    return '';
  });
}

function combos(matrix) {
  if (!matrix) return [null];
  const dims = Object.keys(matrix).filter(k => k !== 'include' && k !== 'exclude');
  if (matrix.exclude) throw new Error('matrix.exclude is not supported by ci-touched.mjs');
  let out = dims.length ? [{}] : [];
  for (const d of dims) out = out.flatMap(c => (matrix[d] || []).map(v => ({ ...c, [d]: v })));
  for (const inc of matrix.include || []) out.push({ ...inc });
  return out.length ? out : [null];
}

/* ---------------- workflows → units ------------------------------------------ */

const SKIPPED_RUN = [
  [/^\s*npm\s+(ci|install|i)\b/, 'npm ci/install'],
  [/playwright\s+install\b/, 'playwright install'],
];
const QUIET_USES = /^actions\/(checkout|setup-node|upload-artifact|cache)@/;

function lines(text) {
  return String(text).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}

/**
 * Every job a workflow defines, one unit per matrix entry:
 *   { file, workflow, jobId, label, needs, dir, install, commands: [{ cmd, browser? }],
 *     skippedSteps: [], timeout, skipReason, usesSuite, unfiltered, roots }
 */
export function unitsOf(file, wf) {
  const units = [];
  const onPr = wf.on && Object.hasOwn(wf.on, 'pull_request');
  const prPaths = onPr && wf.on.pull_request ? wf.on.pull_request.paths : null;
  if (onPr && wf.on.pull_request && wf.on.pull_request['paths-ignore']) {
    throw new Error(`${file}: paths-ignore is not supported by ci-touched.mjs`);
  }
  for (const [jobId, job] of Object.entries(wf.jobs || {})) {
    for (const m of combos(job.strategy && job.strategy.matrix)) {
      const x = v => expand(v, m);
      const label = `${file} / ${jobId}${m ? ` [${m.name || Object.values(m).filter(v => typeof v !== 'object').join(' ').slice(0, 40)}]` : ''}`;
      const unit = {
        file, workflow: wf.name || file, jobId, label, matrix: m,
        needs: [].concat(job.needs || []),
        paths: prPaths, onPr, commands: [], skippedSteps: [],
        dir: '.', install: '', timeout: 20, skipReason: '', usesSuite: false,
        hasMatrixPaths: !!(job.strategy && job.strategy.matrix),
      };
      if (job.if) {
        const cond = String(job.if);
        if (!/pull_request|'push'/.test(cond)) {
          unit.skipReason = `if: ${cond.slice(0, 60)}`;
          // Only a job whose condition names schedule or workflow_dispatch can be turned on by --scheduled.
          unit.scheduleOnly = /schedule|workflow_dispatch/.test(cond);
        }
      }
      if (job.uses) {
        const w = job.with || {};
        unit.usesSuite = String(job.uses).endsWith('/suite.yml');
        if (!unit.usesSuite) unit.skipReason = unit.skipReason || `calls ${job.uses}, which ci-touched.mjs does not read`;
        unit.dir = x(w['working-directory'] || '.') || '.';
        unit.install = x(w.install || '');
        unit.timeout = Number(x(w['timeout-minutes'] || 20)) || 20;
        unit.commands = lines(x(w.commands)).map(cmd => ({ cmd }));
        if (unit.install) unit.skippedSteps.push(`npm ci in ${unit.install}`);
      } else {
        const defDir = (job.defaults && job.defaults.run && job.defaults.run['working-directory'])
          || (wf.defaults && wf.defaults.run && wf.defaults.run['working-directory']) || '.';
        unit.dir = defDir;
        unit.timeout = Number(x(job['timeout-minutes'] || 20)) || 20;
        for (const step of job.steps || []) {
          const sdir = x(step['working-directory'] || defDir);
          if (step.uses) {
            if (!QUIET_USES.test(step.uses)) unit.skippedSteps.push(`uses ${step.uses}`);
            continue;
          }
          if (!step.run) continue;
          const run = x(step.run).replace(/\s+$/, '');
          if (step.if && /failure\(\)|always\(\)|cancelled\(\)/.test(String(step.if))) {
            unit.skippedSteps.push(`if ${step.if}`);
            continue;
          }
          const skip = SKIPPED_RUN.find(([re]) => re.test(run));
          if (skip) {
            unit.skippedSteps.push(skip[1] + (sdir !== '.' ? ` in ${sdir}` : ''));
            if (/^\s*npm\s+ci\b/.test(run)) unit.needNodeModules = [...(unit.needNodeModules || []), sdir];
            if (/playwright\s+install/.test(run)) unit.playwright = true;
            continue;
          }
          unit.commands.push({ cmd: run, dir: sdir });
        }
        if (unit.commands.some(c => /playwright/.test(c.cmd)) || unit.playwright) unit.playwright = true;
        unit.skippedSteps = [...new Set(unit.skippedSteps)];
      }
      units.push(unit);
    }
  }
  return units;
}

/** The folders a matrix entry is about: its dir, and the folder of every script its commands name. */
export function rootsOf(unit) {
  const roots = new Set();
  if (unit.dir && unit.dir !== '.') roots.add(unit.dir);
  for (const { cmd, dir } of unit.commands) {
    for (const tok of cmd.match(/[\w@./\-]+\.(?:mjs|js|cjs)\b/g) || []) {
      const p = posix.normalize(posix.join(dir || unit.dir || '.', tok));
      if (p.startsWith('..')) continue;
      const seg = p.split('/');
      if (['Projects', 'Tools'].includes(seg[0]) && seg.length > 2) roots.add(seg.slice(0, 2).join('/'));
      else if (seg[0] === 'Pathfinder' || seg[0] === 'Numina') roots.add(seg[0]);
      else if (seg.length > 1) roots.add(seg.slice(0, -1).join('/'));
    }
  }
  return [...roots];
}

/* ---------------- selection --------------------------------------------------- */

const under = (file, dir) => dir === '.' ? true : file === dir || file.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

/** Why `unit` is selected by `changed`, or '' when it is not. */
export function whySelected(unit, changed) {
  if (!unit.onPr) return '';
  const wfFile = `.github/workflows/${unit.file}`;
  if (changed.includes(wfFile)) return `${unit.file} itself changed`;
  if (unit.usesSuite && changed.includes('.github/workflows/suite.yml')) return 'suite.yml changed';
  if (unit.paths) {
    for (const g of unit.paths) {
      const re = globToRegExp(g);
      const hit = changed.find(f => re.test(f));
      if (hit) return `${hit} matches ${g}`;
    }
    return '';
  }
  // No path filter: CI runs every job on every PR. Narrow it to what the change could reach.
  if (!unit.hasMatrixPaths) return 'no path filter: runs on every pull request';
  const roots = rootsOf(unit);
  for (const r of roots) {
    const hit = changed.find(f => under(f, r));
    if (hit) return `${hit} is under ${r}`;
  }
  if (unit.install === HARNESS_INSTALL) {
    const hit = changed.find(f => HARNESS_FILES.includes(f));
    if (hit) return `${hit} is the harness this entry installs`;
  }
  return '';
}

/* ---------------- running ----------------------------------------------------- */

function env(name, dflt) { return process.env[name] !== undefined ? process.env[name] : dflt; }

export function loadKnown() {
  const p = env('CI_TOUCHED_KNOWN', join(HERE, 'ci-touched-known.json'));
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return j.known || [];
}

function isBrowserCommand(unit, c, root) {
  if (unit.install || unit.playwright) return true;
  for (const tok of c.cmd.match(/[\w@./\-]+\.(?:mjs|js|cjs)\b/g) || []) {
    const f = join(root, c.dir || unit.dir, tok);
    if (existsSync(f) && /harness|playwright|puppeteer|chromium/.test(readFileSync(f, 'utf8'))) return true;
  }
  return false;
}

function tail(text, n) {
  const l = text.replace(/\n+$/, '').split('\n');
  return l.slice(-n).join('\n');
}

function parseArgs(argv) {
  const a = { only: [], skip: [], base: 'origin/main', head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value`); return argv[++i]; };
    if (k === '--base') a.base = val();
    else if (k === '--head') a.head = val();
    else if (k === '--files') a.files = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--only') a.only.push(val());
    else if (k === '--skip') a.skip.push(val());
    else if (k === '--root') a.root = resolve(val());
    else if (k === '--list') a.list = true;
    else if (k === '--scheduled') a.scheduled = true;
    else if (k === '--dirty') a.dirty = true;
    else if (k === '--verbose') a.verbose = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function changedFiles(root, { base, head, dirty }) {
  const out = new Set();
  for (const f of git(root, ['diff', '--name-only', '--no-renames', `${base}...${head}`]).split('\n')) if (f) out.add(f);
  if (dirty) {
    for (const f of git(root, ['diff', '--name-only', '--no-renames', 'HEAD']).split('\n')) if (f) out.add(f);
    for (const f of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n')) if (f) out.add(f);
  }
  return [...out].sort();
}

export function loadUnits(root) {
  const dir = join(root, '.github/workflows');
  const out = [];
  for (const f of readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).sort()) {
    if (f === 'suite.yml') continue;
    out.push(...unitsOf(f, parseYaml(readFileSync(join(dir, f), 'utf8'))));
  }
  return out;
}

function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`ci-touched: ${e.message}`); process.exit(2); }
  if (a.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 12).map(l => l.slice(3)).join('\n'));
    return;
  }
  const root = a.root || resolve(HERE, '../..');
  let changed;
  try { changed = a.files || changedFiles(root, a); } catch (e) { console.error(`ci-touched: cannot diff ${a.base}...${a.head}: ${e.message.split('\n')[0]}`); process.exit(2); }
  const known = loadKnown();
  const all = loadUnits(root);

  const label = (u) => u.label.toLowerCase();
  const selected = [];
  for (const u of all) {
    // --scheduled runs the jobs CI starts only on schedule or workflow_dispatch (Hearth's deep matrix) as if they were on the PR.
    if (a.scheduled && u.scheduleOnly) u.skipReason = '';
    const why = whySelected(u, changed);
    if (!why) continue;
    if (a.only.length && !a.only.some(s => label(u).includes(s.toLowerCase()))) continue;
    if (a.skip.some(s => label(u).includes(s.toLowerCase()))) continue;
    selected.push({ u, why });
  }

  // Jobs CI would not run for a pull request (schedule-only and the like) are one line each, however many matrix entries they have.
  const skippedJobs = new Map();
  for (const sel of selected.filter(x => x.u.skipReason)) {
    const k = `${sel.u.file} / ${sel.u.jobId}`;
    skippedJobs.set(k, { reason: sel.u.skipReason, scheduleOnly: !!sel.u.scheduleOnly, n: (skippedJobs.has(k) ? skippedJobs.get(k).n : 0) + 1 });
  }
  selected.splice(0, selected.length, ...selected.filter(x => !x.u.skipReason));

  console.log(`ci-touched: ${changed.length} changed file(s)${a.files ? '' : ` in ${a.base}...${a.head}${a.dirty ? ' + uncommitted' : ''}`}; ${selected.length} of ${all.length} CI jobs selected${skippedJobs.size ? `, ${skippedJobs.size} more skipped` : ''}`);
  const reportSkipped = () => {
    for (const [k, v] of skippedJobs) console.log(`SKIP   ${k}${v.n > 1 ? ` (${v.n} matrix entries)` : ''}  ${v.reason}`);
    // A schedule-only job skipped here still runs at 3am on main: say how to run it now, since nothing on a PR does (TG-48, TG-67).
    for (const [k, v] of skippedJobs) if (v.scheduleOnly) console.log(`       to run it now: node Tools/board-check/ci-touched.mjs --scheduled --only "${k}"${a.base !== 'origin/main' ? ` --base ${a.base}` : ''}${a.files ? ` --files ${a.files.join(',')}` : ''}`);
  };
  if (!selected.length) { reportSkipped(); console.log('ci-touched: no workflow job covers these files; nothing to run'); return; }

  const lock = env('CI_TOUCHED_LOCK', join(homedir(), '.cache/selector-locks/tools-and-games-suites.lock'));
  const pwPrefix = env('CI_TOUCHED_PW_PREFIX', join(homedir(), '.cache/selector-scratch/selector/pwprefix'));
  const pwBrowsers = env('CI_TOUCHED_PW_BROWSERS', join(homedir(), 'projects/.pw-1194'));
  const useLock = process.platform === 'linux' && existsSync(dirname(lock));
  const usePrefix = process.platform === 'linux' && existsSync(pwPrefix);
  const useBrowsers = process.platform === 'linux' && existsSync(pwBrowsers);

  if (a.list) {
    reportSkipped();
    for (const { u, why } of selected) {
      console.log(`\n${u.label}\n    because: ${why}\n    dir: ${u.dir}${u.install ? `   install: ${u.install}` : ''}   timeout: ${u.timeout} min`);
      if (u.skipReason) console.log(`    SKIPPED JOB: ${u.skipReason}`);
      if (u.skippedSteps.length) console.log(`    skipped steps: ${u.skippedSteps.join('; ')}`);
      for (const c of u.commands) console.log(`    ${isBrowserCommand(u, c, root) ? '[browser] ' : ''}${c.cmd.split('\n')[0]}${c.cmd.includes('\n') ? ' ...' : ''}`);
    }
    return;
  }

  if (process.platform === 'linux') {
    if (!useLock) console.log(`ci-touched: no lock folder at ${dirname(lock)}; browser commands run without flock`);
    if (!usePrefix) console.log(`ci-touched: no Playwright prefix at ${pwPrefix}; npm_config_prefix left alone`);
    if (!useBrowsers) console.log(`ci-touched: no browsers folder at ${pwBrowsers}; PLAYWRIGHT_BROWSERS_PATH left alone`);
  }
  const logDir = env('CI_TOUCHED_LOGS', join(homedir(), '.cache/ci-touched', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(logDir, { recursive: true });

  const status = new Map();
  const tally = { PASS: 0, KNOWN: 0, FAIL: 0, SKIP: skippedJobs.size };
  reportSkipped();
  const skipped = new Set();
  for (const { u } of selected) for (const s of u.skippedSteps) skipped.add(s);

  for (const { u } of selected) {
    const t0 = Date.now();
    const done = (st, note, detail) => {
      status.set(`${u.file}/${u.jobId}`, st === 'PASS' || st === 'KNOWN' ? 'ok' : st);
      tally[st]++;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`${st.padEnd(5)}  ${u.label}  (${u.commands.length} command${u.commands.length === 1 ? '' : 's'}, ${secs}s)${note ? `  ${note}` : ''}${u.skippedSteps.length ? `  [skipped: ${u.skippedSteps.join('; ')}]` : ''}`);
      if (detail) console.log(detail);
    };
    if (u.skipReason) { done('SKIP', u.skipReason); continue; }
    const blocked = u.needs.find(n => status.get(`${u.file}/${n}`) !== 'ok');
    if (blocked) { done('SKIP', `needs ${blocked}, which did not pass`); continue; }
    if (!u.commands.length) { done('FAIL', 'no commands: a job that checks nothing is not a pass'); continue; }

    const missing = [];
    if (u.install && !existsSync(join(root, u.install, 'node_modules'))) missing.push(join(u.install, 'node_modules'));
    for (const d of u.needNodeModules || []) if (!existsSync(join(root, d, 'node_modules'))) missing.push(join(d, 'node_modules'));
    if (missing.length) { done('FAIL', `${missing.join(', ')} missing: CI runs npm ci there and this script never does`); continue; }

    let failed = 0, knownFailed = 0;
    const details = [];
    const log = [];
    for (const c of u.commands) {
      const cwd = join(root, c.dir || u.dir);
      const browser = isBrowserCommand(u, c, root);
      const cenv = { ...process.env, CI: 'true' };
      if (browser && usePrefix && !process.env.npm_config_prefix) cenv.npm_config_prefix = pwPrefix;
      if (browser && useBrowsers && !process.env.PLAYWRIGHT_BROWSERS_PATH) cenv.PLAYWRIGHT_BROWSERS_PATH = pwBrowsers;
      const run = ['timeout', '-k', '10', `${u.timeout * 60}s`, 'bash', '-c', c.cmd];
      const argv = browser && useLock ? ['flock', lock, ...run] : run;
      if (a.verbose) console.log(`  $ ${c.cmd.split('\n')[0]}  (${u.dir}${browser ? ', browser' : ''})`);
      const r = spawnSync(argv[0], argv.slice(1), { cwd, env: cenv, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      log.push(`$ ${c.cmd}\n${out}\n[exit ${r.status === null ? `signal ${r.signal}` : r.status}${r.error ? `, ${r.error.message}` : ''}]\n`);
      if (a.verbose) process.stdout.write(out);
      const ok = r.status === 0;
      const entry = known.find(k => k.workflow === u.file && k.job === u.jobId && k.command === c.cmd.trim());
      if (ok) {
        if (entry) details.push(`      note: ${c.cmd.split('\n')[0]} is listed in ci-touched-known.json and passed; delete its entry`);
        continue;
      }
      const how = r.status === null ? `killed by ${r.signal}${r.signal === 'SIGTERM' ? ` (timeout ${u.timeout} min)` : ''}` : `exit ${r.status}`;
      if (entry) {
        knownFailed++;
        details.push(`      known (${entry.reason}): ${c.cmd.split('\n')[0]}`);
      } else {
        failed++;
        details.push(`      failed (${how}): ${c.cmd.split('\n')[0]}`, tail(out, 25).split('\n').map(l => `        | ${l}`).join('\n'));
      }
    }
    const logFile = join(logDir, `${u.label.replace(/[^\w.-]+/g, '_')}.log`);
    writeFileSync(logFile, log.join('\n'));
    if (failed) done('FAIL', `${failed} command(s) failed; log ${logFile}`, details.join('\n'));
    else if (knownFailed) done('KNOWN', `${knownFailed} known failure(s)`, details.join('\n'));
    else done('PASS', '', details.join('\n'));
  }

  console.log(`\nci-touched: ${tally.PASS} passed, ${tally.KNOWN} known, ${tally.FAIL} failed, ${tally.SKIP} skipped. Logs in ${logDir}`);
  if (skipped.size) console.log(`ci-touched: never run here: ${[...skipped].join('; ')}`);
  process.exit(tally.FAIL ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
