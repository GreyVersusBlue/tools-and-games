// node tools/blender/spec.mjs
//
// Prints what the marker sheet is drawn from, as JSON, straight out of the
// game: js/plat.js's INK, TERRAIN_FILL and PAPER, and every marker the plat
// shows a glyph for today (js/data.js's STRUCTURE_TYPES, with its footprint,
// and the front gate) with the glyph it stands in for. common.py reads it, so
// the palette and the list have one home and it is the game's (BACKLOG.md
// "Blender assets: the common plan", style sheet items 1 and 2). validate.mjs
// builds the same list with markers(), so the two cannot drift.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const js = (f) => pathToFileURL(path.join(HERE, '..', '..', 'js', f)).href;
const { INK, TERRAIN_FILL, PAPER } = await import(js('plat.js'));
const { STRUCTURE_TYPES } = await import(js('data.js'));

// The gate is a frame like a 1 x 1 plot; ui.js's gate marker shows it.
export const GATE = { name: 'gate', icon: '⛲', w: 1, h: 1 };

export function markers() {
  const out = Object.entries(STRUCTURE_TYPES).map(([name, t]) => ({
    name, icon: t.icon, w: t.footprint?.w || 1, h: t.footprint?.h || 1,
  }));
  return [...out, GATE];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({ INK, TERRAIN_FILL, PAPER, markers: markers() }) + '\n');
}
