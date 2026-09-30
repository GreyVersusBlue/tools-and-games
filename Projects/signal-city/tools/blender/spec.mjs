// node tools/blender/spec.mjs
//
// Prints what the car sheet is drawn from, as JSON, straight out of
// js/sprites.js: every archetype's length, width and four palettes, and the
// trailer's size. cars.py reads it, so the palette has one home and it is the
// game's (BACKLOG.md "Blender assets: the common plan", style sheet item 2).

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { ARCHETYPES, SPRITES } = await import(
  pathToFileURL(path.join(HERE, '..', '..', 'js', 'sprites.js')).href);

const out = {
  archetypes: ARCHETYPES.map(name => ({
    name,
    length: SPRITES[name].length,
    width: SPRITES[name].width,
    palettes: SPRITES[name].palettes.map(({ name: n, body, glass, accent }) => ({ name: n, body, glass, accent })),
  })),
  trailer: { length: SPRITES.trucker.trailer.length, width: SPRITES.trucker.trailer.width },
};
process.stdout.write(JSON.stringify(out) + '\n');
