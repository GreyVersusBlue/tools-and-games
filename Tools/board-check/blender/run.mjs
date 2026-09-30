// node blender/run.mjs [script ...]      (`npm run tavern`)
//
// Runs the site's Blender scripts headless and then validate.mjs --rendered.
// Blender is found from $BLENDER, then PATH, then the Steam install on
// Devon's machine (#642: Blender runs there and nowhere else). With no
// arguments it runs calibrate.py and tavern.py, in that order; with names it
// runs those. Exits with the first non-zero status it meets (#13).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEAM = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe';

function findBlender() {
  if (process.env.BLENDER && fs.existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const onPath = probe.status === 0 && probe.stdout.trim().split(/\r?\n/)[0];
  if (onPath) return onPath;
  if (fs.existsSync(STEAM)) return STEAM;
  console.error('run.mjs: no Blender: set $BLENDER, put blender on PATH, or install it through Steam');
  process.exit(1);
}

const blender = findBlender();
const scripts = process.argv.slice(2);
const runs = scripts.length ? scripts : ['calibrate.py', 'tavern.py'];
for (const s of runs) {
  const file = path.join(HERE, s.endsWith('.py') ? s : `${s}.py`);
  console.log(`\n== ${path.basename(file)}`);
  const r = spawnSync(blender, ['-b', '--factory-startup', '-P', file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('\n== validate.mjs --rendered');
const v = spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), '--rendered'], { stdio: 'inherit' });
process.exit(v.status ?? 1);
