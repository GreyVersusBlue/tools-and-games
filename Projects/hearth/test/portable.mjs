// Hearth, portable arithmetic (C2): Node and the pinned Chromium now grow the same island. Runs the seeds of hashes.json for the
// pinned number of days through load.mjs (Node only, no browser) and compares the FNV hash:length with hashes.json, which
// `harness.mjs pinned --write` wrote from Chromium 1194. A differing hash means an engine-dependent function (Math.sin, cos, pow, hypot,
// a random sort comparator) is back in the simulation.
//
//   node portable.mjs            (from Projects/hearth/test; about 70 s)
import { loadHearth } from './load.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(HERE, 'hashes.json'), 'utf8'));
const DT = 0.05;
let failed = false;
for (const seed of Object.keys(pin.seeds).map(Number)) {
  const { H, ev } = loadHearth();
  H.newWorld(seed);
  ev(`for(let d=0;d<${pin.days};d++){const d0=dayCount;let n=0;while(dayCount===d0&&n++<6000)step(${DT})}`);
  const s = JSON.stringify(H.pack());
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const got = h.toString(16) + ':' + s.length, want = pin.seeds[seed], same = got === want;
  if (!same) failed = true;
  console.log(`  seed ${seed}: ${got}${same ? '  = pinned' : `  != pinned ${want}`}`);
}
console.log(failed ? '\nFAIL: Node and the pinned Chromium grew different islands' : `\nPASS: Node agrees with the pinned Chromium on ${Object.keys(pin.seeds).length} islands at day ${pin.days}`);
process.exit(failed ? 1 : 0);
