// postcard.js — the faire as one picture to keep. Pure.
//
// postcardModel(state) reads a state and answers everything the card says:
// the tier, the weekend and the day, the weekend's figures off
// summarizeWeekend, and where the gate and each built plot stand.
// paintPostcard(ctx, model, opts) paints that onto a 2D context at
// POSTCARD's fixed size: plat.js's own sheet on the left under one view
// from mapview.js, the marker sheet's frames on top of it, and the figures
// in a column on the right.
//
// Nothing here reads the document or the save. The ctx is a parameter, the
// way it is for paintPlat, so tests/mapview.mjs hands this a recorder; the
// image itself and the download are main.js's, and tools/postcard-check.mjs
// looks at the pixels in a real browser. The same state paints the same
// calls in the same order: no clock, no rng, and the plots in the order the
// state holds them.

import { CONFIG, ENTRANCE } from './data.js';
import { summarizeWeekend, currentGridSize, renownOf, terrainAt as engineTerrainAt } from './engine.js';
import { FRAME, MARKER_MARGIN, contentSize, cellToRect } from './mapview.js';
import { paintPlat, INK, RULE_INK, PAPER } from './plat.js';
import MARKER_SHEET from '../assets/sprites/markers.json' with { type: 'json' };

// 6 x 4 inches at 200 to the inch.
export const POSTCARD = { w: 1200, h: 800 };
// The box the plat is fitted into, and the column the figures are set in.
export const PLAT_BOX = { x: 36, y: 36, w: 744, h: 728 };
export const COLUMN = { x: 816, w: 344 };
// The page's cell at rest on a desk (style.css's --cell). The card is one
// size whatever the page it was saved from, so it does not read the page's.
export const POSTCARD_CELL = 46;
export const TOKEN = { fill: '#E7CE97', edge: '#7A5E2E' };
export const DARK_INK = '#3B2A1A';

const DAY_NAMES = ['Friday', 'Saturday', 'Sunday'];
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n, text) => `${n >= 0 ? '+' : ''}${text}`;

// The days of the weekend the state is in, played so far. state.day is the
// day on the desk (not advanced until the next weekend opens), so the
// weekend's Friday is weekendDay - 1 behind it and every result from there
// on is this weekend's: none before Friday's gates, all of them once the
// weekend has closed.
export function weekendDaysSoFar(state) {
  const friday = (state.day || 1) - ((state.weekendDay || 1) - 1);
  return (state.history || []).filter(d => d && d.day >= friday);
}

export function postcardModel(state) {
  const size = currentGridSize(state);
  const days = weekendDaysSoFar(state);
  const summary = summarizeWeekend(days, days.length);
  const run = (state.carryover && state.carryover.run) || 1;
  const dayName = DAY_NAMES[(state.weekendDay || 1) - 1] || DAY_NAMES[0];
  const built = (state.builtPlots || []).filter(p => p.status === 'built');
  const played = days.length;
  const rows = [
    ['Through the gate', played ? summary.totalAttendance.toLocaleString('en-US') : '—'],
    ['Crowd mood', played ? `${summary.avgSatisfaction}/100` : '—'],
    ['Weekend net', played ? signed(summary.totalNet, money(summary.totalNet)) : '—'],
    ['Reputation', String(Math.round(state.reputation || 0))],
    ['Renown', String(renownOf(state))],
    ['Plots built', String(built.length)],
    ['Acts on the bill', String((state.roster || []).length)],
  ];
  return {
    title: 'Faire Weekend',
    tier: size.label,
    cols: size.cols,
    rows: size.rows,
    season: state.season || 1,
    run,
    dayName,
    when: `Season ${run} · Weekend ${state.season || 1} · ${dayName}`,
    played,
    heading: played === 0 ? 'Before the gates open'
      : played >= CONFIG.seasonLength ? 'The weekend, gates closed'
        : `The weekend so far, ${played} of ${CONFIG.seasonLength} days`,
    figures: rows.map(([label, value]) => ({ label, value })),
    gate: ENTRANCE.x < size.cols && ENTRANCE.y < size.rows ? { x: ENTRANCE.x, y: ENTRANCE.y } : null,
    plots: built.map(p => ({ kind: p.kind, x: p.x, y: p.y, w: p.w || 1, h: p.h || 1 })),
  };
}

export function postcardFileName(model) {
  return `faire-weekend-season-${model.run}-weekend-${model.season}-${model.dayName.toLowerCase()}.png`;
}

// The one view the card's plat is painted under: the whole content, as
// large as PLAT_BOX allows, centred in it. Built by hand rather than with
// createView because a card is not a stage: it may rest above scale 1 and
// it has no pointer to floor it.
export function postcardView(model) {
  const c = contentSize(model.cols, model.rows, POSTCARD_CELL);
  const scale = Math.min(PLAT_BOX.w / c.w, PLAT_BOX.h / c.h);
  return {
    cols: model.cols, rows: model.rows, cell: POSTCARD_CELL,
    viewport: { w: POSTCARD.w, h: POSTCARD.h },
    minScale: scale, maxScale: scale, scale,
    tx: PLAT_BOX.x + (PLAT_BOX.w - c.w * scale) / 2,
    ty: PLAT_BOX.y + (PLAT_BOX.h - c.h * scale) / 2,
  };
}

// opts.sprite is the marker sheet as something drawImage takes; without it
// the plots are their tokens with no drawing on them. opts.terrainAt is
// for a test that wants a different ground.
export function paintPostcard(ctx, model, opts = {}) {
  const view = postcardView(model);
  const terrainAt = opts.terrainAt || engineTerrainAt;

  // The plat first: paintPlat clears the whole context before it draws.
  paintPlat(ctx, view, { terrainAt, dpr: 1, cell: POSTCARD_CELL, label: model.tier, sub: `${model.cols} × ${model.rows} · Weekend ${model.season}` });
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const art = (name, r) => {
    const f = MARKER_SHEET.frames[name];
    if (opts.sprite && f) ctx.drawImage(opts.sprite, f.x, f.y, f.w, f.h, r.x, r.y, r.w, r.h);
  };
  const inset = MARKER_MARGIN * view.scale;
  for (const p of model.plots) {
    const r = cellToRect(view, p.x, p.y, p.w, p.h);
    const box = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset };
    ctx.fillStyle = TOKEN.fill;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = TOKEN.edge;
    ctx.lineWidth = view.scale;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    art(p.kind, box);
  }
  if (model.gate) art('gate', cellToRect(view, model.gate.x, model.gate.y));

  // The paper goes under everything already painted, which is how the
  // plat's margin and cartouche band come to sit on it.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, POSTCARD.w, POSTCARD.h);
  ctx.globalCompositeOperation = 'source-over';

  // The card's own double rule, the plat sheet's at card size.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(10.5, 10.5, POSTCARD.w - 21, POSTCARD.h - 21);
  ctx.lineWidth = 1;
  ctx.strokeRect(18.5, 18.5, POSTCARD.w - 37, POSTCARD.h - 37);

  const left = COLUMN.x, right = COLUMN.x + COLUMN.w;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = DARK_INK;
  ctx.font = `600 60px 'Grenze Gotisch', 'Cinzel', serif`;
  ctx.fillText(model.title, left, 112);
  ctx.font = `600 24px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.fillStyle = INK;
  ctx.fillText(model.tier.toUpperCase(), left, 156);
  ctx.font = `400 22px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.fillStyle = RULE_INK;
  ctx.fillText(model.when, left, 186);

  ctx.fillStyle = INK;
  ctx.fillRect(left, 212, COLUMN.w, 2);
  ctx.font = `600 18px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.fillText(model.heading.toUpperCase(), left, 250);

  let y = 300;
  for (const row of model.figures) {
    ctx.textAlign = 'left';
    ctx.font = `400 24px 'Barlow Semi Condensed', system-ui, sans-serif`;
    ctx.fillStyle = RULE_INK;
    ctx.fillText(row.label, left, y);
    ctx.textAlign = 'right';
    ctx.font = `600 26px 'Barlow Semi Condensed', system-ui, sans-serif`;
    ctx.fillStyle = DARK_INK;
    ctx.fillText(row.value, right, y);
    ctx.fillStyle = 'rgba(107, 84, 51, 0.3)';
    ctx.fillRect(left, y + 14, COLUMN.w, 1);
    y += 54;
  }

  ctx.textAlign = 'left';
  ctx.font = `italic 400 30px 'Fraunces', Georgia, serif`;
  ctx.fillStyle = INK;
  ctx.fillText('Wish you were here.', left, POSTCARD.h - FRAME.bottom - 30);
  return view;
}

// What the card's three typefaces are called to document.fonts.load, so
// main.js can wait for them before it paints.
export const POSTCARD_FONTS = [
  `600 60px 'Grenze Gotisch'`,
  `600 24px 'Barlow Semi Condensed'`,
  `400 24px 'Barlow Semi Condensed'`,
  `italic 400 30px 'Fraunces'`,
];
