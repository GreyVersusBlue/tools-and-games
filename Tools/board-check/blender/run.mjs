// node blender/run.mjs [script ...] [-- script args]      (`npm run tavern`)
//
// Runs the site's Blender scripts headless and then validate.mjs --rendered.
// Blender is found from $BLENDER, then PATH, then the Steam install on
// Devon's Windows machine. It runs on huginn too (Linux, CPU only): there
// every run gets -t 4 (or $BLENDER_THREADS), and each script waits until no
// other Blender is running on the machine, because huginn renders one thing
// at a time. With no arguments it runs calibrate.py and tavern.py, in that
// order; with names it runs those. Anything after `--` goes to each script
// (tavern.py takes --preview and --samples N). Exits with the first non-zero
// status it meets (#13).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEAM = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe';
const LINUX = process.platform === 'linux';

function findBlender() {
  if (process.env.BLENDER && fs.existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const onPath = probe.status === 0 && probe.stdout.trim().split(/\r?\n/)[0];
  if (onPath) return onPath;
  if (fs.existsSync(STEAM)) return STEAM;
  console.error('run.mjs: no Blender: set $BLENDER, put blender on PATH, or install it through Steam');
  process.exit(1);
}

// Another session's render, on Linux: any process whose name is blender.
function othersRunning() {
  if (!LINUX) return [];
  const r = spawnSync('pgrep', ['-a', 'blender'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
}

function waitForMachine() {
  let said = false;
  for (;;) {
    const others = othersRunning();
    if (!others.length) return;
    if (!said) { console.log(`run.mjs: waiting for ${others.length} other Blender process(es) to finish:\n  ${others.join('\n  ')}`); said = true; }
    spawnSync('sleep', ['20']);
  }
}

const blender = findBlender();
const argv = process.argv.slice(2);
const cut = argv.indexOf('--');
const scripts = cut < 0 ? argv : argv.slice(0, cut);
const extra = cut < 0 ? [] : argv.slice(cut);
const threads = process.env.BLENDER_THREADS || (LINUX ? '4' : '0');
const runs = scripts.length ? scripts : ['calibrate.py', 'tavern.py'];
for (const s of runs) {
  const file = path.join(HERE, s.endsWith('.py') ? s : `${s}.py`);
  waitForMachine();
  console.log(`\n== ${path.basename(file)}`);
  const t0 = Date.now();
  const r = spawnSync(blender, ['-b', '--factory-startup', '-t', threads, '-P', file, ...extra], { stdio: 'inherit' });
  console.log(`== ${path.basename(file)}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('\n== validate.mjs --rendered');
const v = spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), '--rendered'], { stdio: 'inherit' });
process.exit(v.status ?? 1);
