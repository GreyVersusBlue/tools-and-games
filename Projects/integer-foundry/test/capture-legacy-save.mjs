// capture-legacy-save.mjs — write out a save produced by whatever build of
// Integer Foundry is currently in the working tree.
//
//   node Projects/integer-foundry/test/capture-legacy-save.mjs [outfile]
//
// It exists because "old saves still load" is only worth asserting against a blob
// a real build actually wrote. `test/fixtures/legacy-save-v0.json` was captured
// with this script from the pre-gvb-save build: hand-rolled `localStorage`, no
// `__v` stamp, no validation. Do not regenerate that file — the point of it is
// that it predates the current loader.
//
// Borrows Tools/board-check's harness rather than copying it. Bare specifiers
// inside harness.mjs resolve from ITS folder, so no install is needed here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { GAMES, enter, savedState, wait } from '../../../Tools/board-check/games.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(HERE, 'fixtures', 'legacy-save-v0.json');
const PORT = 8129; // 8123 checks, 8124 play-castle, 8125 previews, 8126 games
const BASE = `http://127.0.0.1:${PORT}`;

const server = await serve(PORT);
const browser = await launch({ headed: false });
const g = GAMES['integer-foundry'];
const p = await prepPage(browser, BASE, { width: g.vw, height: g.vh, dsf: 1 });
await enter(p, 'integer-foundry', { base: BASE });

const place = async (tool, x, y) => {
  await p.click(`[data-tool="${tool}"]`);
  await p.click(`#grid .cell[data-x="${x}"][data-y="${y}"]`);
};

// The same eight-tile line play-games.mjs builds, plus one orphan belt so the
// fixture has something on a second row.
await place('source', 0, 2);
for (const x of [1, 2]) await place('belt', x, 2);
await place('add1', 3, 2);
for (const x of [4, 5]) await place('belt', x, 2);
await place('add1', 6, 2);
await place('sink', 7, 2);
await place('belt', 2, 4);

await wait(14000); // long enough for the old 8-second interval autosave to fire
const s = await savedState(p, 'integer-foundry');
if (!s) throw new Error('no save was written');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(s, null, 2));

console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
console.log('top-level keys:', Object.keys(s).join(' '));
console.log('cols/rows:', s.cols, s.rows, '| grid:', s.grid.length, 'rows x', s.grid[0].length, 'cols');
console.log('sinks:', JSON.stringify(s.sinks), '|', '__v' in s ? 'HAS __v' : 'no __v stamp');
console.log('page errors:', p.__errs.length, '| offsite blocked:', p.__blocked.length);

await p.close();
await browser.close();
server.close();
