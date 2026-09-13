// ci-check.mjs — `npm run check` and `npm run social:check`, graded against
// the failures main already has.
//
//   node ci-check.mjs            (from Tools/board-check, after npm ci)
//
// Every session's definition of done says both checks pass. On 2026-09-13 they
// did not: check-integrity.mjs failed on Tools/prompt-builder.html, and
// sync-social-tags.mjs --check failed on four pages and drifted on two more.
// Sessions had been writing "the same one broken" and "the same four failures"
// into their PR bodies for days. A CI job that ran the checks as they stand
// would be red on every pull request from its first run, and a job that is
// always red is a job that gets ignored (#13).
//
// So this runs all three checks, pulls every FAIL and DRIFT line out of their
// output, and compares that set to known-failures.json. It exits 1 when:
//
//   - a check reports a failure that is not on the list (you broke something);
//   - a failure on the list no longer appears (you fixed something: take it off
//     the list in the same PR, so the list can only shrink honestly);
//   - a check exits non-zero with no FAIL or DRIFT line at all (it crashed —
//     an ERR_MODULE_NOT_FOUND is not a known failure).
//
// It does not re-implement any check. It reads what they print.
//
// collisions runs even when integrity is red. Under `npm run check` the `&&`
// meant nobody had seen collisions' result in CI-shaped conditions at all.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const known = JSON.parse(readFileSync(join(HERE, 'known-failures.json'), 'utf8'));

const CHECKS = [
  ['integrity', ['check-integrity.mjs']],
  ['collisions', ['check-collisions.mjs']],
  ['social', ['sync-social-tags.mjs', '--check']],
];

// "  FAIL Tools\prompt-builder.html" → "FAIL Tools/prompt-builder.html".
// The reason text after the path is left off the key, so rewording a message
// does not read as a new failure.
const LINE = /^\s*(FAIL|DRIFT)\s+(\S+)/;

let bad = 0;
const problem = msg => { bad++; console.log(`  PROBLEM  ${msg}`); };

for (const [name, args] of CHECKS) {
  console.log(`\n===== ${name}: node ${args.join(' ')}\n`);
  const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out);

  const seen = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) seen.add(`${m[1]} ${m[2].replace(/\\/g, '/')}`);
  }
  const expected = new Set(Object.keys(known[name] || {}));

  console.log(`\n----- ${name}: exit ${r.status}, ${seen.size} FAIL/DRIFT line(s), ${expected.size} known`);
  if (r.error) problem(`${name} did not start: ${r.error.message}`);
  if (r.status !== 0 && seen.size === 0) {
    problem(`${name} exited ${r.status} without a FAIL or DRIFT line; that is a crash, not a known failure`);
  }
  for (const key of seen) {
    if (!expected.has(key)) problem(`${name}: new failure  ${key}`);
  }
  for (const key of expected) {
    if (!seen.has(key)) problem(`${name}: fixed, so remove it from known-failures.json  ${key}`);
  }
}

console.log(bad
  ? `\nci-check: ${bad} problem(s)`
  : '\nci-check: every failure is a known one, and every known one still fails');
process.exit(bad ? 1 : 0);
