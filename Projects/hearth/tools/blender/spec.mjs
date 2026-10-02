// node tools/blender/spec.mjs
//
// Prints what the building sheet is drawn from, as JSON, straight out of the
// game. Hearth's scripts are classic and touch the DOM as they load, so
// nothing here imports them: the values are read out of the source text.
//
//   T        the tile size, js/core.js's `const W=..,H=..,T=8`
//   BLD      every kind in js/core.js's BLD with its footprint in tiles
//   ROOFS    the colours sim.js picks a new house's roof from
//   PALETTE  every #rrggbb js/render.js writes, the only colours a frame may
//            be drawn in (BACKLOG.md "Blender assets: the common plan",
//            style sheet item 2), before the shading tiers in budget.json,
//            and budget.json's `lifted`: the colours that left render.js
//            when the frames replaced the drawings that used them
//
// common.py reads it, so the palette and the list have one home and it is the
// game's. validate.mjs builds the same thing with spec(), so the two cannot
// drift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, '..', '..', 'js', f), 'utf8');

export function spec() {
  const core = read('core.js'), render = read('render.js'), sim = read('sim.js');
  const t = core.match(/const W=\d+,H=\d+,T=(\d+)/);
  if (!t) throw new Error('spec.mjs: no `const W=..,H=..,T=` in js/core.js');
  const body = core.match(/const BLD=\{([\s\S]*?)\}\};/);
  if (!body) throw new Error('spec.mjs: no `const BLD={...}};` in js/core.js');
  const BLD = {};
  for (const m of body[1].matchAll(/(\w+):\{name:'[^']*',w:(\d+),h:(\d+)/g)) BLD[m[1]] = { w: +m[2], h: +m[3] };
  if (!Object.keys(BLD).length) throw new Error('spec.mjs: BLD parsed empty');
  const roof = sim.match(/r:pick\(\[([^\]]*)\]\)/);
  if (!roof) throw new Error('spec.mjs: no `r:pick([...])` for a house roof in js/sim.js');
  const ROOFS = [...roof[1].matchAll(/'(#[0-9a-f]{6})'/gi)].map(m => m[1].toLowerCase());
  // render.js's colours, and the ones the frames took out of it when they replaced the drawings that used them (budget.json's lifted)
  const lifted = JSON.parse(fs.readFileSync(path.join(HERE, 'budget.json'), 'utf8')).lifted || [];
  const PALETTE = [...new Set([...render.matchAll(/'(#[0-9a-f]{6})'/gi)].map(m => m[1].toLowerCase()).concat(lifted))].sort();
  return { T: +t[1], BLD, ROOFS, PALETTE };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(spec()) + '\n');
}
