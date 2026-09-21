/*
 * js/sprites.js - procedural top-down car sprites for Signal City.
 *
 * Every car is drawn in METRES, centred on the origin, nose pointing +x, with
 * +y to the car's right (canvas y is down, so -y is the side the light comes
 * from and the side the roof gloss sits on). Nothing here reads the DOM at
 * module level: the file imports clean in Node, and only spriteFor() needs a
 * canvas to exist.
 *
 * Flat shading, one silhouette shape per archetype, four palettes each. The
 * paint reads glossy from two passes clipped to the body: a white light-catch
 * gradient running back from the front of the roof, and a darker band along the
 * lower body edge. Glass is a darker rounded shape, and four wheel stubs peek
 * out past the corners.
 *
 * The gallery that renders all of this is sprites.html, one row per archetype.
 */

export const ARCHETYPES = [
  'standard', 'granny', 'aggressive', 'tourist',
  'trucker', 'student', 'rideshare', 'emergency',
];

/* The only two archetypes whose draw() reads `t`. spriteFor caches on a frame
   index for these and on 0 for everything else. */
const ANIMATED = new Set(['rideshare', 'emergency']);

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/* ------------------------------------------------------------- primitives -- */

/* ctx.roundRect is not everywhere, and the test's fake ctx does not have it.
   Both paths leave a closed current path and neither fills or strokes. */
function rr(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/* A closed polygon with every corner rounded to r. Corner radii are what make
   one silhouette a land yacht and another a hatchback, so the hulls below are
   plain point lists and this does the rest. */
function roundPoly(ctx, pts, r) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % n]);
    ctx.arcTo(cur[0], cur[1], m[0], m[1], r);
    ctx.lineTo(m[0], m[1]);
  }
  ctx.closePath();
}

function toRGB(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(hex, other, k) {
  const a = toRGB(hex), b = toRGB(other);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

const darken = (hex, k) => mix(hex, '#000000', k);
const lighten = (hex, k) => mix(hex, '#ffffff', k);

const CHROME = '#dfe3e7';
const RUBBER = '#16181b';

/* The gloss. Called inside a clip of the body, so it never spills past the
   silhouette. Two gradients: the roofline light-catch running back from the
   nose, and the shade along the lower edge. */
function gloss(ctx, len, wid) {
  const halfL = len / 2, halfW = wid / 2;
  const g = ctx.createLinearGradient(halfL, -halfW, -halfL * 0.55, halfW * 0.15);
  g.addColorStop(0, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-halfL, -halfW, len, halfW * 1.05);

  const d = ctx.createLinearGradient(0, halfW * 0.2, 0, halfW);
  d.addColorStop(0, 'rgba(0,0,0,0)');
  d.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = d;
  ctx.fillRect(-halfL, halfW * 0.2, len, halfW * 0.8);
}

/* Body fill, gloss pass, outline. Every archetype's draw() goes through here,
   which is what guarantees a createLinearGradient and a fill in palette.body
   for all eight of them. */
function paint(ctx, pts, r, palette, len, wid) {
  roundPoly(ctx, pts, r);
  ctx.fillStyle = palette.body;
  ctx.fill();

  ctx.save();
  ctx.clip();
  gloss(ctx, len, wid);
  ctx.restore();

  roundPoly(ctx, pts, r);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = darken(palette.body, 0.5);
  ctx.stroke();
}

/* Wheel stubs. Drawn before the body so they peek out at the corners rather
   than sitting on top of the paint. */
function wheels(ctx, opts) {
  const { axleX, halfW, len = 0.72, thick = 0.30, peek = 0.10 } = opts;
  ctx.fillStyle = RUBBER;
  for (const x of axleX) {
    for (const s of [-1, 1]) {
      const y = s < 0 ? -halfW - peek : halfW + peek - thick;
      rr(ctx, x - len / 2, y, len, thick, 0.09);
      ctx.fill();
    }
  }
}

function glassShape(ctx, x, y, w, h, r, palette) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = palette.glass;
  ctx.fill();
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = lighten(palette.glass, 0.22);
  ctx.stroke();
}

/* --------------------------------------------------------------- palettes -- */

const P = (name, body, glass, accent) => ({ name, body, glass, accent });

/* ------------------------------------------------------------------ draws -- */

function drawStandard(ctx, palette) {
  const len = 4.6, wid = 1.8, halfW = wid / 2;
  wheels(ctx, { axleX: [1.35, -1.35], halfW });
  paint(ctx, [
    [2.30, -0.58], [2.30, 0.58], [1.60, 0.90], [-1.75, 0.90],
    [-2.30, 0.64], [-2.30, -0.64], [-1.75, -0.90], [1.60, -0.90],
  ], 0.34, palette, len, wid);

  glassShape(ctx, -0.95, -0.62, 1.85, 1.24, 0.30, palette);
  // Bonnet seam and boot lid, the two lines that make it read as a sedan.
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 0.04;
  ctx.beginPath(); ctx.moveTo(1.00, -0.70); ctx.lineTo(1.00, 0.70);
  ctx.moveTo(-1.35, -0.70); ctx.lineTo(-1.35, 0.70); ctx.stroke();

  ctx.fillStyle = palette.accent;
  rr(ctx, 2.06, -0.52, 0.22, 1.04, 0.09); ctx.fill();
  rr(ctx, -2.26, -0.56, 0.20, 1.12, 0.08); ctx.fill();
}

function drawGranny(ctx, palette) {
  /* 5.8 m, not the 5.6 the brief started from: the land yacht has to out-
     measure the 5.6 m emergency van for the sprite sheet to stay ordered by
     length, and a 1970s full-size sedan is genuinely this long. */
  const len = 5.8, wid = 1.9, halfW = wid / 2;
  wheels(ctx, { axleX: [1.80, -1.80], halfW, len: 0.78 });
  paint(ctx, [
    [2.90, -0.70], [2.90, 0.70], [2.55, 0.95], [-2.70, 0.95],
    [-2.90, 0.80], [-2.90, -0.80], [-2.70, -0.95], [2.55, -0.95],
  ], 0.16, palette, len, wid);

  glassShape(ctx, -0.80, -0.66, 1.70, 1.32, 0.22, palette);
  // Squared trunk lid.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 0.045;
  ctx.beginPath(); ctx.moveTo(-1.10, -0.82); ctx.lineTo(-1.10, 0.82);
  ctx.moveTo(-2.55, -0.82); ctx.lineTo(-2.55, 0.82); ctx.stroke();

  // Chrome side trim, one line down each flank, and chrome bumpers.
  ctx.fillStyle = CHROME;
  for (const s of [-1, 1]) {
    rr(ctx, -2.45, s * 0.86 - 0.045, 4.95, 0.09, 0.045); ctx.fill();
  }
  rr(ctx, 2.74, -0.74, 0.20, 1.48, 0.07); ctx.fill();
  rr(ctx, -2.94, -0.74, 0.20, 1.48, 0.07); ctx.fill();
  ctx.fillStyle = palette.accent;
  rr(ctx, 2.40, -0.90, 0.26, 0.34, 0.08); ctx.fill();
  rr(ctx, 2.40, 0.56, 0.26, 0.34, 0.08); ctx.fill();
}

function drawAggressive(ctx, palette) {
  const len = 5.0, wid = 2.2, halfW = wid / 2;
  wheels(ctx, { axleX: [1.55, -1.55], halfW, len: 0.86, thick: 0.34, peek: 0.12 });
  paint(ctx, [
    [2.50, -0.86], [2.50, 0.86], [2.35, 1.10], [-2.35, 1.10],
    [-2.50, 0.86], [-2.50, -0.86], [-2.35, -1.10], [2.35, -1.10],
  ], 0.20, palette, len, wid);

  // Near-black glass, one long windscreen and a tailgate pane.
  const dark = darken(palette.glass, 0.35);
  glassShape(ctx, -0.55, -0.80, 1.65, 1.60, 0.20, { glass: dark });
  glassShape(ctx, -2.05, -0.74, 0.60, 1.48, 0.16, { glass: dark });

  // Roof rails.
  ctx.fillStyle = darken(palette.accent, 0.1);
  for (const s of [-1, 1]) {
    rr(ctx, -1.60, s * 0.70 - 0.06, 3.00, 0.12, 0.06); ctx.fill();
  }
  ctx.fillStyle = palette.accent;
  rr(ctx, 2.28, -0.78, 0.22, 1.56, 0.08); ctx.fill();
}

function drawTourist(ctx, palette) {
  const len = 5.0, wid = 2.0, halfW = wid / 2;
  wheels(ctx, { axleX: [1.60, -1.50], halfW, len: 0.78 });
  paint(ctx, [
    [2.50, -0.62], [2.50, 0.62], [1.90, 1.00], [-2.00, 1.00],
    [-2.50, 0.72], [-2.50, -0.72], [-2.00, -1.00], [1.90, -1.00],
  ], 0.52, palette, len, wid);

  // One long pane from windscreen to tailgate, the minivan giveaway.
  glassShape(ctx, -1.95, -0.70, 3.35, 1.40, 0.42, palette);

  // Roof rack with a bag strapped to it.
  ctx.strokeStyle = 'rgba(30,32,36,0.75)';
  ctx.lineWidth = 0.08;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-1.70, s * 0.72); ctx.lineTo(1.10, s * 0.72); ctx.stroke();
  }
  ctx.fillStyle = palette.accent;
  rr(ctx, -1.30, -0.58, 2.05, 1.16, 0.22); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.moveTo(-0.70, -0.58); ctx.lineTo(-0.70, 0.58);
  ctx.moveTo(0.20, -0.58); ctx.lineTo(0.20, 0.58); ctx.stroke();
}

function drawTruckerCab(ctx, palette) {
  const len = 2.6, wid = 2.4, halfW = wid / 2;
  wheels(ctx, { axleX: [0.80, -0.70], halfW, len: 0.82, thick: 0.36, peek: 0.12 });

  // Exhaust stacks stand behind the cab, outside the paint.
  ctx.fillStyle = '#3c4148';
  for (const s of [-1, 1]) {
    rr(ctx, -1.42, s * 0.92 - 0.11, 0.30, 0.22, 0.10); ctx.fill();
  }

  paint(ctx, [
    [1.30, -0.92], [1.30, 0.92], [1.18, 1.20], [-1.30, 1.20],
    [-1.30, -1.20], [1.18, -1.20],
  ], 0.18, palette, len, wid);

  glassShape(ctx, 0.35, -0.86, 0.80, 1.72, 0.16, palette);
  ctx.fillStyle = CHROME;
  rr(ctx, 1.10, -0.84, 0.22, 1.68, 0.07); ctx.fill();
  // The fifth wheel the trailer hinges on.
  ctx.fillStyle = '#2a2e34';
  rr(ctx, -1.15, -0.42, 0.70, 0.84, 0.16); ctx.fill();
}

function drawTrailer(ctx, palette) {
  const len = 9.0, wid = 2.5, halfW = wid / 2;
  wheels(ctx, { axleX: [-3.30, -4.05], halfW, len: 0.78, thick: 0.34, peek: 0.10 });
  paint(ctx, [
    [4.50, -1.18], [4.50, 1.18], [-4.50, 1.18], [-4.50, -1.18],
  ], 0.16, { body: palette.accent, glass: palette.glass, accent: palette.body }, len, wid);

  // The side stripe runs the length of the box in the cab's colour.
  ctx.fillStyle = palette.body;
  for (const s of [-1, 1]) {
    rr(ctx, -4.20, s * 0.96 - 0.10, 8.40, 0.20, 0.09); ctx.fill();
  }
  // Rear doors and the landing legs.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.moveTo(-4.34, -1.10); ctx.lineTo(-4.34, 1.10); ctx.stroke();
  ctx.fillStyle = '#2a2e34';
  for (const s of [-1, 1]) {
    rr(ctx, 1.70, s * 0.90 - 0.09, 0.36, 0.18, 0.07); ctx.fill();
  }
}

function drawStudent(ctx, palette) {
  const len = 3.8, wid = 1.7, halfW = wid / 2;
  wheels(ctx, { axleX: [1.10, -1.10], halfW, len: 0.66, thick: 0.28 });
  paint(ctx, [
    [1.90, -0.56], [1.90, 0.56], [1.35, 0.85], [-1.70, 0.85],
    [-1.90, 0.66], [-1.90, -0.66], [-1.70, -0.85], [1.35, -0.85],
  ], 0.40, palette, len, wid);

  // Hatchback: short bonnet, glass carried right back to the chopped tail.
  glassShape(ctx, -1.45, -0.60, 2.15, 1.20, 0.30, palette);
  ctx.fillStyle = palette.accent;
  rr(ctx, 1.66, -0.50, 0.22, 1.00, 0.08); ctx.fill();

  // The roof placard. Drawn as a shape first so it still reads at 12 px/m,
  // with the lettering on top for anyone looking closer.
  ctx.save();
  ctx.translate(-0.20, 0);
  ctx.fillStyle = '#ffd21e';
  rr(ctx, -0.62, -0.44, 1.24, 0.88, 0.10);
  ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = '#7a5c00';
  ctx.stroke();
  ctx.fillStyle = '#241c00';
  ctx.save();
  // Font sizes below 1 px render badly, so the lettering is drawn at 48x and
  // scaled back down: 11 px here is 0.23 m on the roof.
  ctx.scale(1 / 48, 1 / 48);
  ctx.font = `700 11px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STUDENT', 0, -6.5);
  ctx.fillText('DRIVER', 0, 6.5);
  ctx.restore();
  ctx.restore();
}

function drawRideshare(ctx, palette, t) {
  const len = 4.4, wid = 1.7, halfW = wid / 2;
  const pulse = 0.62 + 0.38 * Math.sin(t * 3.4);

  // The halo goes down first so the paint sits inside it.
  const halo = ctx.createRadialGradient(-0.10, 0, 0.15, -0.10, 0, 1.9);
  halo.addColorStop(0, `rgba(255,255,255,${(0.30 * pulse).toFixed(3)})`);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-2.4, -1.9, 4.8, 3.8);

  wheels(ctx, { axleX: [1.25, -1.25], halfW, len: 0.68, thick: 0.28 });
  paint(ctx, [
    [2.20, -0.54], [2.20, 0.54], [1.50, 0.85], [-1.65, 0.85],
    [-2.20, 0.60], [-2.20, -0.60], [-1.65, -0.85], [1.50, -0.85],
  ], 0.36, palette, len, wid);

  glassShape(ctx, -0.85, -0.58, 1.70, 1.16, 0.28, palette);
  ctx.fillStyle = palette.accent;
  rr(ctx, 2.00, -0.46, 0.20, 0.92, 0.08); ctx.fill();

  // The lit roof sign.
  ctx.fillStyle = lighten(palette.accent, 0.35 * pulse);
  rr(ctx, -0.48, -0.30, 0.96, 0.60, 0.12); ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = darken(palette.accent, 0.35);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${(0.55 * pulse).toFixed(3)})`;
  rr(ctx, -0.30, -0.16, 0.60, 0.32, 0.08); ctx.fill();
}

function drawEmergency(ctx, palette, t) {
  const len = 5.6, wid = 2.2, halfW = wid / 2;
  wheels(ctx, { axleX: [1.80, -1.70], halfW, len: 0.84, thick: 0.34, peek: 0.11 });
  paint(ctx, [
    [2.80, -0.88], [2.80, 0.88], [2.62, 1.10], [-2.62, 1.10],
    [-2.80, 0.88], [-2.80, -0.88], [-2.62, -1.10], [2.62, -1.10],
  ], 0.22, palette, len, wid);

  glassShape(ctx, 1.35, -0.82, 0.85, 1.64, 0.18, palette);

  // Body stripe down both flanks.
  ctx.fillStyle = palette.accent;
  for (const s of [-1, 1]) {
    rr(ctx, -2.50, s * 0.82 - 0.14, 5.00, 0.28, 0.12); ctx.fill();
  }

  // The light bar: two halves swapping twice a second, so t = 0 and t = 0.3
  // lay down different colours in a different order.
  const phase = Math.floor(t * 4) % 2 === 0;
  const RED = '#e8332b', BLUE = '#2f6fe6';
  const leftColour = phase ? RED : BLUE;
  const rightColour = phase ? BLUE : RED;
  ctx.fillStyle = '#2a2e34';
  rr(ctx, 0.55, -0.98, 0.42, 1.96, 0.10); ctx.fill();
  ctx.fillStyle = leftColour;
  rr(ctx, 0.60, -0.92, 0.32, 0.86, 0.08); ctx.fill();
  ctx.fillStyle = rightColour;
  rr(ctx, 0.60, 0.06, 0.32, 0.86, 0.08); ctx.fill();

  const flare = ctx.createLinearGradient(0.76, -0.98, 0.76, 0.98);
  flare.addColorStop(0, `${phase ? 'rgba(232,51,43,0.45)' : 'rgba(47,111,230,0.45)'}`);
  flare.addColorStop(0.5, 'rgba(255,255,255,0)');
  flare.addColorStop(1, `${phase ? 'rgba(47,111,230,0.45)' : 'rgba(232,51,43,0.45)'}`);
  ctx.fillStyle = flare;
  ctx.fillRect(0.30, -1.35, 0.92, 2.70);
}

/* --------------------------------------------------------------- the table -- */

export const SPRITES = {
  standard: {
    length: 4.6, width: 1.8,
    palettes: [
      P('silver', '#c9ced6', '#303a48', '#7c8494'),
      P('navy', '#23365e', '#14202f', '#9aa7bd'),
      P('white', '#eef1f5', '#38414d', '#b6bcc6'),
      P('red', '#b23a32', '#2e2a2c', '#e2c9c4'),
    ],
    draw(ctx, palette) { drawStandard(ctx, palette); },
  },
  granny: {
    length: 5.8, width: 1.9,
    palettes: [
      P('beige', '#d8c9a4', '#4a4636', '#8d7a4e'),
      P('maroon', '#6e2b32', '#2c2226', '#c9a2a6'),
      P('silver', '#b9bdc0', '#3a4046', '#7d8388'),
      P('pale blue', '#a9c3d6', '#34424e', '#5f7f95'),
    ],
    draw(ctx, palette) { drawGranny(ctx, palette); },
  },
  aggressive: {
    length: 5.0, width: 2.2,
    palettes: [
      P('black', '#17181b', '#0b0c0e', '#2a2d33'),
      P('gunmetal', '#454b52', '#0d0f12', '#6a727c'),
      P('matte green', '#3b4a36', '#0c0f0c', '#5f7057'),
      P('white', '#e6e8ea', '#101216', '#8d949c'),
    ],
    draw(ctx, palette) { drawAggressive(ctx, palette); },
  },
  tourist: {
    length: 5.0, width: 2.0,
    palettes: [
      P('teal', '#2a7f86', '#23343a', '#d8b45a'),
      P('gold', '#c9a13c', '#3a3326', '#7a5b2e'),
      P('grey', '#9aa0a6', '#333a40', '#4d5358'),
      P('forest', '#2f5a3a', '#23302a', '#c2a06a'),
    ],
    draw(ctx, palette) { drawTourist(ctx, palette); },
  },
  trucker: {
    length: 2.6, width: 2.4,
    palettes: [
      P('red cab', '#b3352e', '#2b2f36', '#eef0f2'),
      P('blue cab', '#22466f', '#1b2836', '#c4c9ce'),
      P('green cab', '#2f5a3c', '#1f2a24', '#cbb489'),
      P('yellow cab', '#d8a41f', '#2e2a20', '#f0f2f4'),
    ],
    draw(ctx, palette) { drawTruckerCab(ctx, palette); },
    trailer: {
      length: 9.0, width: 2.5,
      draw(ctx, palette) { drawTrailer(ctx, palette); },
    },
  },
  student: {
    length: 3.8, width: 1.7,
    palettes: [
      P('yellow', '#f2c53d', '#3a3628', '#8a6d18'),
      P('mint', '#9ed8bd', '#2f4038', '#4e8f74'),
      P('coral', '#e97b5f', '#3c2c28', '#a44b34'),
      P('sky', '#7fb4dd', '#2c3a46', '#3d6d95'),
    ],
    draw(ctx, palette) { drawStudent(ctx, palette); },
  },
  rideshare: {
    length: 4.4, width: 1.7,
    palettes: [
      P('white', '#eceff2', '#2b313a', '#3ad07f'),
      P('black', '#1b1d21', '#0e1013', '#ffb02e'),
      P('grey', '#8d949c', '#2f353d', '#44b6ff'),
      P('blue', '#2b5fa8', '#1d2a3c', '#f0f3f6'),
    ],
    draw(ctx, palette, t = 0) { drawRideshare(ctx, palette, t); },
  },
  emergency: {
    length: 5.6, width: 2.2,
    palettes: [
      P('ambulance', '#f0f2f4', '#2b3138', '#cf2f2a'),
      P('fire engine', '#c2211c', '#241f20', '#f0f2f4'),
      P('police', '#f2f4f6', '#232a33', '#1d49a8'),
      P('rescue orange', '#eef0f2', '#2a2e33', '#e3701a'),
    ],
    draw(ctx, palette, t = 0) { drawEmergency(ctx, palette, t); },
  },
};

/* ----------------------------------------------------------------- drawing -- */

export function drawCar(ctx, archetype, variant, t = 0) {
  const spec = SPRITES[archetype];
  if (!spec) throw new Error(`drawCar: unknown archetype "${archetype}"`);
  const palettes = spec.palettes;
  const idx = ((variant | 0) % palettes.length + palettes.length) % palettes.length;
  spec.draw(ctx, palettes[idx], t);
}

/* ------------------------------------------------------------ sprite cache -- */

const PAD = 2;
const cache = new Map();

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('spriteFor: no canvas here (no OffscreenCanvas and no document). Draw with drawCar into a ctx you own instead.');
}

export function spriteFor(archetype, variant, pxPerMetre, t = 0) {
  const spec = SPRITES[archetype];
  if (!spec) throw new Error(`spriteFor: unknown archetype "${archetype}"`);
  const animated = ANIMATED.has(archetype);
  const animFrame = animated ? ((Math.floor(t * 4) % 4) + 4) % 4 : 0;
  const key = `${archetype}/${variant}/${pxPerMetre}/${animFrame}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.ceil(spec.length * pxPerMetre) + PAD * 2;
  const h = Math.ceil(spec.width * pxPerMetre) + PAD * 2;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const ox = w / 2, oy = h / 2;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(pxPerMetre, pxPerMetre);
  drawCar(ctx, archetype, variant, animated ? animFrame / 4 : 0);
  ctx.restore();

  const sprite = { canvas, w, h, ox, oy };
  cache.set(key, sprite);
  return sprite;
}

export function clearSpriteCache() {
  cache.clear();
}
