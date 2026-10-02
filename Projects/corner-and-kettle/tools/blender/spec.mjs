// node tools/blender/spec.mjs
//
// Prints what the cup and food sheet is drawn from, as JSON, straight out of
// the game: js/content.js's MILKS, SYRUPS, TOPPINGS, BASE_COLORS and FOODS,
// and the cup the old cupSvg drew (its box and its ink). common.py reads it,
// so the palette and the list have one home and it is the game's (BACKLOG.md
// "Blender assets: the common plan", style sheet items 1 and 2). validate.mjs
// builds the same frame list with frames(), so the two cannot drift.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const content = await import(pathToFileURL(path.join(HERE, '..', '..', 'js', 'content.js')).href);
const { MILKS, SYRUPS, TOPPINGS, BASE_COLORS, FOODS } = content;

// The cup the hand-built SVG drew, in its 100 x 130 viewBox: the body from the
// rim's top (y 34) to the foot's curve (y 124), the handle out to x 92, and
// the 2.5-unit stroke in INK. The sheet's cup is held to this box within 10%
// (style sheet item 1), and its lines are this INK.
export const INK = '#3B2418';
export const VIEW = { w: 100, h: 130 };
export const CUP_BOX = { x0: 22, y0: 34, x1: 92, y1: 124 };

// The cup's layers, stacked in this order at draw time: every one is the same
// frame size, rendered through the same camera, so they line up by being drawn
// at the same place. `tint` frames are drawn in white and greys and take
// their colour from a multiply at draw time (the liquid's mix of base, milk
// and syrup; a drizzle's sauce).
export const LAYERS = [
  { name: 'cup_back' },
  { name: 'straw' },
  { name: 'liquid_low', tint: true },
  { name: 'liquid_full', tint: true },
  { name: 'ice' },
  { name: 'foam' },
  { name: 'cinnamon' },
  { name: 'drizzle', tint: true },
  { name: 'sprinkles' },
  { name: 'whip' },
  { name: 'cup_front' },
];

// Which frame draws each topping, and the colour a tinted one takes. The two
// drizzles are one drawing in two sauces, the colours the old SVG stroked
// them in (a caramel and a chocolate that are SYRUPS' caramel and mocha).
export const TOPPING_FRAMES = {
  whip: { frame: 'whip' },
  cinnamon: { frame: 'cinnamon' },
  caramelDrizzle: { frame: 'drizzle', tint: '#c98a3a' },
  chocoDrizzle: { frame: 'drizzle', tint: '#4a2a1c' },
  sprinkles: { frame: 'sprinkles' },
};

export function frames() {
  return [
    ...LAYERS.map(l => ({ name: l.name, kind: 'layer', tint: !!l.tint })),
    ...FOODS.map(f => ({ name: `food_${f.id}`, kind: 'food', id: f.id })),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({
    INK, VIEW, CUP_BOX, LAYERS, TOPPING_FRAMES, MILKS, SYRUPS, TOPPINGS, BASE_COLORS,
    FOODS: FOODS.map(f => ({ id: f.id, name: f.name })),
  }) + '\n');
}
