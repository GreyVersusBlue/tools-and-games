// theme.js — the palette, in one place, for every surface that draws.
//
// Three surfaces render color: the chrome (CSS custom properties in
// index.html), the printed sheet and the minimap (2D canvas ink), and the 3D
// scene (vertex colors and materials). They grew up separately, and the same
// idea — "this is a failure", "this is secondary" — was spelled with a
// different literal on each of them. The literals live here now. The CSS
// :root block mirrors UI below because a stylesheet cannot import a module;
// test/theme.test.mjs reads index.html and fails if the two drift.
//
// The transforms live here too. Room colors themselves stay in grid.js
// (ROOM_COLORS is part of the save format's story — a room stores its hex),
// but what every surface *does* to a stored hex — wash it onto paper, fade
// it, hand it to a three.js color buffer — goes through the functions below,
// so the viewport swatch, the plan tint and the legend all derive from the
// same hex the same way.

// The chrome's palette, mirrored from index.html's :root block.
export const UI = {
  panel: 'rgba(22,26,34,0.88)',
  text: '#e8ecf2',
  textDim: '#9aa5b5',
  accent: '#4da3ff',
  ok: '#5db07a',
  warn: '#e8a33d',
  fail: '#e05c48',
};

// The printed sheet's ink, and the minimap's — dark line work on white
// paper, deliberately not the chrome's light-on-dark palette.
export const INK = {
  line: '#1a2029',    // heavy ink: walls, the title block, primary text
  dim: '#5a6472',     // secondary ink: labels, dimension text
  faint: '#9aa5b5',   // light ink: gridlines, ticks, hatching
  accent: '#4da3ff',  // door swings, window bands, the highlighted thing
  paper: '#ffffff',
  miniPaper: '#f4f2ec',
};

// A stored color is a hex string; normalize it to '#rrggbb' or give back
// null. This is also the coloredGeo rule from render.js: a malformed string
// handed to a three.js color buffer silently writes NaN, which reads back as
// black and poisons the bloom pass downstream — normalize first, always.
export function normHex(c) {
  if (typeof c !== 'string') return null;
  const m = c.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h;
}

// A hex plus an alpha, as a canvas-ready rgba() string. Replaces the
// `hex + '40'` string concatenation the sheet used to do, which was only
// correct because every ROOM_COLOR happened to be six digits.
export function withAlpha(c, a) {
  const h = normHex(c);
  if (!h) return `rgba(204,204,204,${a})`;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// A room's stored hex, washed onto white paper: the plan and the legend
// tint with this so a room reads as the same color on the sheet as in the
// viewport, only printed.
export function paperTint(c, amount = 0.25) {
  return withAlpha(c ?? '#cccccc', amount);
}
