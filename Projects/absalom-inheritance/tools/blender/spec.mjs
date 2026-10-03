// node tools/blender/spec.mjs
//
// Prints what the sheets are drawn against, as JSON, straight out of
// js/render.js: PALETTE, the board's colours, and SOLIDS, the height and
// footprint of everything it stands up. common.py reads it, so the colours
// and the boxes have one home and it is the game's (BACKLOG.md "Blender
// assets: the common plan", style sheet items 1 and 2).

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { PALETTE, SOLIDS } = await import(
  pathToFileURL(path.join(HERE, '..', '..', 'js', 'render.js')).href);

process.stdout.write(JSON.stringify({ PALETTE, SOLIDS }) + '\n');
