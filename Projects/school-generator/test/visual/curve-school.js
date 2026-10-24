// test/visual/curve-school.js — the school the `roof-curve` capture draws:
// no shipped design has a curved roof, so the visual harness builds one.
//
// Two buildings on one site. West: a 40 by 24 hall whose east wall the curve
// tool bows out to x 73.6, with a 16ft room on its west side (the L of
// test/roof-parapet.test.mjs). East: a 40 by 32 hall whose east end is a
// semicircle of 16 chords, with a 12 by 8 court cut in it (the apse of
// test/roof-holes.test.mjs). Both take the curved path under a hipped roof
// (the straight skeleton, #967, round the court #999) and under a parapet
// (the chords, #973, the court a hole in the deck #998).
//
// Pure: grid.js and shapes.js only, no Math.random, so it runs in the
// harness page and in Node alike.

import { createState } from '../../js/grid.js';
import { addShape, curveSegment } from '../../js/shapes.js';

const R4 = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

export function curveSchool(style) {
  const s = createState(50, 30);
  const hall = addShape(s, 0, R4(24, 8, 64, 32));
  addShape(s, 0, R4(8, 8, 24, 32));
  curveSegment(hall, 0, 1, -0.4);
  const arc = Array.from({ length: 17 }, (_, k) => {
    const t = -Math.PI / 2 + (Math.PI * k) / 16;
    return { x: 128 + 16 * Math.cos(t), z: 60 + 16 * Math.sin(t) };
  });
  const apse = addShape(s, 0, [{ x: 88, z: 44 }, ...arc, { x: 88, z: 76 }]);
  apse.rings.push({ pts: R4(100, 56, 112, 64), walls: [], openings: [] });
  s.roof = { style, pitch: 6, facade: 'brick' };
  return s;
}

// The capture: for each style a row of the roof seen from above (every face
// shaded by its slope against one fixed light, the deck, the parapet line)
// over the south elevation's paints. No text anywhere, on purpose: the other
// sheets' type is rasterized differently on a desk and on CI, and this
// picture is about the roof's shape. `roof` and `elevation` are the modules
// themselves, passed in by the harness page.
const PAD = 12, S = 5;                     // px; px per ft
const VIEW = { x0: 0, z0: 0, x1: 152, z1: 84 };
const INK = '#2a2a2a', PAPER = '#ffffff', DECK = '#d9d6cf';
const ELEV = { wall: '#f0eeea', parapet: '#eae7e2', roof: '#c9c4ba', gable: '#eae7e2', door: '#fbfaf8', window: '#d6e7f7' };
const LIGHT = (() => { const v = [-0.45, 1, -0.3]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

function shade(pts) {
  let nx = 0, ny = 0, nz = 0;              // Newell's normal
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const n = Math.hypot(nx, ny, nz) || 1;
  const d = Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / n);
  const g = Math.round(120 + 120 * d);
  return `rgb(${g},${g - 6},${g - 14})`;
}

export function drawCurveRoofs(document, roof, elevation) {
  const rows = ['hip', 'parapet'].map((style) => {
    const state = curveSchool(style);
    const plan = roof.roofPlan(state);
    const elev = elevation.computeElevation(state, 'south');
    if (style === 'hip' && plan.blocks.filter((b) => b.skeleton).length !== 2) throw new Error('hip: both buildings should stand on the skeleton');
    if (style === 'parapet' && (plan.deckPolys || []).length !== 2) throw new Error('parapet: both buildings should take the chord deck');
    let top = 0;
    for (const p of elev.paints) for (const q of p.poly) top = Math.max(top, q.y);
    return { plan, elev, top };
  });
  const planW = (VIEW.x1 - VIEW.x0) * S, planH = (VIEW.z1 - VIEW.z0) * S;
  const elevH = rows.map((r) => Math.ceil(r.top * S) + 4);
  const canvas = document.createElement('canvas');
  canvas.width = planW + PAD * 2;
  canvas.height = PAD + rows.reduce((a, r, i) => a + planH + PAD + elevH[i] + PAD, 0);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = 'round';
  let y0 = PAD;
  rows.forEach(({ plan, elev }, i) => {
    const px = (p) => [PAD + (p.x - VIEW.x0) * S, y0 + (p.z - VIEW.z0) * S];
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach((p, k) => { const [x, y] = px(p); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    };
    for (const d of plan.deckPolys || []) {
      const pts = [...d.pts, ...(d.holes || []).flat()];
      // Each triangle stroked in its own fill too, or the antialiased seams
      // between them show as hairlines.
      ctx.fillStyle = ctx.strokeStyle = DECK;
      ctx.lineWidth = 1;
      for (const t of d.tris) { poly(t.map((k) => pts[k])); ctx.fill(); ctx.stroke(); }
    }
    for (const r of plan.deckRects) {
      ctx.fillStyle = DECK;
      poly([{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }]);
      ctx.fill();
    }
    // Low faces first, so a ridge is never under a lower face.
    const faces = plan.blocks.flatMap((b) => b.faces)
      .map((f) => ({ f, y: f.pts.reduce((a, p) => a + p.y, 0) / f.pts.length }))
      .sort((a, b) => a.y - b.y);
    for (const { f } of faces) {
      poly(f.pts);
      ctx.fillStyle = shade(f.pts);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    if (plan.parapetH > 0) for (const o of plan.outlines) { poly(o); ctx.stroke(); }
    for (const d of plan.deckPolys || []) for (const h of d.holes || []) { poly(h); ctx.stroke(); }
    y0 += planH + PAD;
    // The south elevation, far to near as elevation.js sorted it, grade at
    // the bottom of the band.
    const base = y0 + elevH[i] - 2;
    for (const p of elev.paints) {
      ctx.beginPath();
      p.poly.forEach((q, k) => {
        const x = PAD + (q.u - VIEW.x0) * S, y = base - q.y * S;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = ELEV[p.kind] || ELEV.wall;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    y0 += elevH[i] + PAD;
  });
  return canvas;
}
