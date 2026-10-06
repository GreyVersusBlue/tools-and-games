// tests/mapview.mjs — the plat's geometry and its painter, pure. Phase 6.
//
// The half of the map where a wrong answer is silent: the page still draws,
// the stall is just one cell over. So every function in js/mapview.js is
// round-tripped here against its inverse or its invariant, and js/plat.js
// is painted into a recorder that counts what it drew and where. Nothing
// here touches a DOM. Run with `node tests/mapview.mjs`; `npm test` runs it
// after the smoke and guest suites.

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const mod = p => pathToFileURL(path.join(root, p)).href;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const M = await import(mod('js/mapview.js'));
const { paintPlat, TERRAIN_FILL, INK, EDGE_SHADE } = await import(mod('js/plat.js'));
const { terrainAt, currentGridSize } = await import(mod('js/engine.js'));
const { GRID_EXPANSIONS } = await import(mod('js/data.js'));

// ---------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------
{
  const t = M.trackSize(10, 7, 46);
  assert(t.w === 10 * 46 + 9 + 2 && t.h === 7 * 46 + 6 + 2, `trackSize is cols x cell plus the gaps plus the border each side (got ${t.w} x ${t.h})`);
  const c = M.contentSize(10, 7, 46);
  assert(c.w === t.w + M.FRAME.left + M.FRAME.right && c.h === t.h + M.FRAME.top + M.FRAME.bottom, 'contentSize is the tracks plus the frame');
  const o = M.cellOrigin(0, 0, 46);
  assert(o.x === M.FRAME.left + M.TRACK.border && o.y === M.FRAME.top + M.TRACK.border, 'cell (0,0) starts inside the frame and the border');
  const o2 = M.cellOrigin(3, 2, 46);
  assert(o2.x === o.x + 3 * 47 && o2.y === o.y + 2 * 47, 'each cell east or south is one cell plus one gap further');
}

// ---------------------------------------------------------------------
// The floor: 44px on a coarse pointer, whatever the stage
// ---------------------------------------------------------------------
{
  assert(M.minScaleFor({ cell: 48, coarse: true }) === 1, 'a 48px cell on a coarse pointer floors at exactly scale 1: 48 - 2 x 2 = 44');
  assert(near(M.minScaleFor({ cell: 46, coarse: true }), 44 / 42), 'a 46px cell on a coarse pointer floors above 1 (44/42), so a touch laptop at the desktop cell zooms in slightly rather than under 44');
  assert(M.minScaleFor({ cell: 48, coarse: false }) === M.SCALE.min, 'a fine pointer may shrink to SCALE.min');
  for (const stageW of [280, 330, 375, 600, 1000]) {
    for (const tier of GRID_EXPANSIONS) {
      const v = M.createView({ cols: tier.cols, rows: tier.rows, cell: 48, viewport: { w: stageW, h: 0 }, minScale: M.minScaleFor({ cell: 48, coarse: true }) });
      assert(M.markerSize(v) >= 44, `${tier.label} on a ${stageW}px coarse stage: markers ${M.markerSize(v)}px`);
      assert(v.scale <= 1, `${tier.label} on a ${stageW}px stage never rests above scale 1 (got ${v.scale})`);
    }
  }
  // A zoom out on a coarse pointer cannot go under the floor.
  const v = M.createView({ cols: 10, rows: 7, cell: 48, viewport: { w: 330, h: 300 }, minScale: 1 });
  const out = M.zoomAt(v, 100, 100, 0.5);
  assert(out.scale === 1 && M.markerSize(out) === 44, 'zooming out on a coarse pointer stops at the floor');
}

// ---------------------------------------------------------------------
// Rest scale and the stage's height
// ---------------------------------------------------------------------
{
  const c = M.contentSize(10, 7, 46);
  const exact = M.createView({ cols: 10, rows: 7, cell: 46, viewport: { w: c.w, h: 0 } });
  assert(exact.scale === 1 && exact.tx === 0 && exact.ty === 0, 'a stage exactly the content’s width rests at scale 1 with the content at its origin');
  const wide = M.createView({ cols: 10, rows: 7, cell: 46, viewport: { w: c.w + 200, h: 0 } });
  assert(wide.scale === 1 && near(wide.tx, 100), `a wider stage does not enlarge the map (#247): scale ${wide.scale}, centred at tx ${wide.tx}`);
  const narrow = M.createView({ cols: 14, rows: 10, cell: 46, viewport: { w: 400, h: 0 } });
  const cn = M.contentSize(14, 10, 46);
  assert(near(narrow.scale, Math.max(M.SCALE.min, 400 / cn.w)) && narrow.tx === 0, `a narrower stage with a mouse fits the map to its width (scale ${narrow.scale.toFixed(3)}), west edge at the origin`);
  const zero = M.createView({ cols: 10, rows: 7, cell: 46, viewport: { w: 0, h: 0 } });
  assert(zero.scale === 1 && zero.tx === 0 && zero.ty === 0, 'a stage of zero width (a jsdom boot) reads as the content’s own width: scale 1, origin');
  assert(M.stageHeight(exact) === c.h, 'stageHeight at scale 1 is the content’s height');
  assert(M.stageHeight(narrow) === Math.round(cn.h * narrow.scale), 'stageHeight at a fitted scale is the content’s height at that scale');
  // The height is a rest property: zooming does not change it.
  const zoomed = M.zoomAt(M.withViewport(exact, { w: c.w, h: c.h }), 10, 10, 2);
  assert(M.stageHeight(zoomed) === c.h, 'the stage height does not grow with a zoom');
}

// ---------------------------------------------------------------------
// Pan clamping
// ---------------------------------------------------------------------
{
  const c = M.contentSize(10, 7, 48);
  const v = M.createView({ cols: 10, rows: 7, cell: 48, viewport: { w: 330, h: c.h }, minScale: 1 });
  assert(v.tx === 0 && v.ty === 0, 'a map wider than its stage starts at its west edge, where the gate is (#132)');
  const east = M.panBy(v, -10000, 0);
  assert(near(east.tx, 330 - c.w) && east.ty === 0, `panning east stops at the east edge (tx ${east.tx})`);
  const west = M.panBy(east, 10000, 0);
  assert(west.tx === 0, 'panning back west stops at the origin');
  const vert = M.panBy(v, 0, -50);
  assert(vert.ty === 0, 'the map is not taller than the stage, so it does not pan vertically');
  const mid = M.panBy(v, -50, 0);
  assert(near(mid.tx, -50), 'a pan inside the bounds is applied as given');
  const e = M.edges(mid);
  assert(e.west && e.east && !e.north && !e.south, 'mid-pan the content runs past both the west and east edges and neither vertical one');
  assert(!M.edges(v).west && M.edges(v).east, 'at the origin only the east edge has more map past it');
  assert(M.edges(east).west && !M.edges(east).east, 'at the east end only the west edge does');
}

// ---------------------------------------------------------------------
// Cell <-> screen round trip, at several scales and pans
// ---------------------------------------------------------------------
{
  for (const cell of [46, 48]) {
    for (const scale of [0.5, 0.8, 1, 1.5, 2.3]) {
      const c = M.contentSize(14, 12, cell);
      let v = M.createView({ cols: 14, rows: 12, cell, viewport: { w: 500, h: 400 } });
      v = { ...v, scale };
      v = M.panBy(v, -37.5, -21);
      let ok = true, centreOk = true, cornerOk = true, gapOk = true;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 14; x++) {
          const r = M.cellToRect(v, x, y);
          const hit = M.screenToCell(v, r.x + r.w / 2, r.y + r.h / 2);
          if (!hit || hit.x !== x || hit.y !== y) centreOk = false;
          const corner = M.screenToCell(v, r.x + 0.01, r.y + 0.01);
          if (!corner || corner.x !== x || corner.y !== y) cornerOk = false;
          const far = M.screenToCell(v, r.x + r.w - 0.01, r.y + r.h - 0.01);
          if (!far || far.x !== x || far.y !== y) cornerOk = false;
          if (!near(r.w, cell * scale) || !near(r.h, cell * scale)) ok = false;
          // The 1px gap east of a cell belongs to nobody.
          if (x < 13) {
            const gap = M.screenToCell(v, r.x + r.w + (M.TRACK.gap * scale) / 2, r.y + r.h / 2);
            if (gap !== null) gapOk = false;
          }
        }
      }
      assert(ok, `cellToRect at cell ${cell} scale ${scale}: every cell is cell x scale on screen`);
      // A cell origin that drops the gap passes this one: 46x + 23 still
      // floors to x under a 47px pitch for 23 columns. It is the gap
      // assertion below, the origin arithmetic in Sizes and the layer
      // agreement further down that catch that drift (#147).
      assert(centreOk, `screenToCell at cell ${cell} scale ${scale}: the centre of every cell’s rect maps back to that cell`);
      assert(cornerOk, `screenToCell at cell ${cell} scale ${scale}: both corners of every rect map back to that cell, not its neighbour`);
      assert(gapOk, `screenToCell at cell ${cell} scale ${scale}: the gap between two cells is null, not the next cell`);
      assert(M.screenToCell(v, v.tx + 1, v.ty + 1) === null, `the frame is not a cell (scale ${scale})`);
      const last = M.cellToRect(v, 13, 11);
      assert(M.screenToCell(v, last.x + last.w + 5 * scale, last.y) === null, `past the east edge is null (scale ${scale})`);
      assert(M.screenToCell(v, -1000, -1000) === null && M.screenToCell(v, c.w * scale + 1000, 0) === null, `far outside is null (scale ${scale})`);
    }
  }
  // A 2x2 footprint spans two cells and the gap between them.
  const v = M.createView({ cols: 10, rows: 7, cell: 46, viewport: { w: 0, h: 0 } });
  const r = M.cellToRect(v, 3, 0, 2, 2);
  assert(r.w === 2 * 46 + 1 && r.h === 2 * 46 + 1, 'a 2x2 footprint is two cells and one gap wide and tall');
  const single = M.cellToRect(v, 3, 0);
  const next = M.cellToRect(v, 4, 0);
  assert(near(next.x - single.x, 47), 'neighbouring cells are one cell plus one gap apart on screen');
}

// ---------------------------------------------------------------------
// Zoom about a point, and the transform the marker layer gets
// ---------------------------------------------------------------------
{
  const c = M.contentSize(14, 12, 46);
  let v = M.createView({ cols: 14, rows: 12, cell: 46, viewport: { w: c.w, h: c.h } });
  const r0 = M.cellToRect(v, 5, 4);
  const px = r0.x + 10, py = r0.y + 20;
  const before = M.screenToCell(v, px, py);
  const z = M.zoomAt(v, px, py, 1.6);
  assert(near(z.scale, 1.6), `zoomAt applies the factor (scale ${z.scale})`);
  const after = M.screenToCell(z, px, py);
  assert(before && after && before.x === after.x && before.y === after.y, 'the cell under the cursor is still under the cursor after a zoom');
  // The exact content point, not just the cell: invert both transforms.
  const cx0 = (px - v.tx) / v.scale, cx1 = (px - z.tx) / z.scale;
  const cy0 = (py - v.ty) / v.scale, cy1 = (py - z.ty) / z.scale;
  assert(near(cx0, cx1) && near(cy0, cy1), 'the content point under the cursor does not slide during a zoom');
  const capped = M.zoomAt(v, px, py, 100);
  assert(capped.scale === M.SCALE.max, 'a zoom cannot pass SCALE.max');
  const back = M.zoomAt(z, px, py, 1 / 1.6);
  assert(near(back.scale, 1) && near(back.tx, 0) && near(back.ty, 0), 'zooming back out by the inverse factor returns to the rest transform');
  const t = M.trackTransform(z);
  assert(near(t.x, z.tx + M.FRAME.left * z.scale) && near(t.y, z.ty + M.FRAME.top * z.scale) && t.scale === z.scale, 'the marker layer’s transform puts the tracks’ top-left FRAME in from the content origin, scaled');
  // With the layer transformed that way, its cell (x, y) at scale s lands
  // exactly where cellToRect says.
  const layerCell = (view, x, y) => {
    const tt = M.trackTransform(view);
    return { x: tt.x + (M.TRACK.border + x * (view.cell + M.TRACK.gap)) * tt.scale, y: tt.y + (M.TRACK.border + y * (view.cell + M.TRACK.gap)) * tt.scale };
  };
  let agree = true;
  for (let y = 0; y < 12; y += 3) for (let x = 0; x < 14; x += 4) {
    const a = layerCell(z, x, y), b = M.cellToRect(z, x, y);
    if (!near(a.x, b.x) || !near(a.y, b.y)) agree = false;
  }
  assert(agree, 'the DOM layer under trackTransform() and cellToRect() put every sampled cell in the same place — the marker sits on its terrain');
  const centred = M.zoomCentred(v, 2);
  assert(near(centred.scale, 2), 'zoomCentred zooms about the stage centre');
  // The stage centre of a 683px sheet is in a gap, so compare the content
  // point rather than the cell.
  const mid0 = { x: (c.w / 2 - v.tx) / v.scale, y: (c.h / 2 - v.ty) / v.scale };
  const mid1 = { x: (c.w / 2 - centred.tx) / centred.scale, y: (c.h / 2 - centred.ty) / centred.scale };
  assert(near(mid0.x, mid1.x) && near(mid0.y, mid1.y), 'and the content point at the centre stays at the centre');
}

// ---------------------------------------------------------------------
// Pinch
// ---------------------------------------------------------------------
{
  const c = M.contentSize(14, 12, 48);
  const v = M.createView({ cols: 14, rows: 12, cell: 48, viewport: { w: c.w, h: c.h }, minScale: 1 });
  const a0 = { x: 200, y: 200 }, b0 = { x: 300, y: 200 };
  const a1 = { x: 150, y: 200 }, b1 = { x: 350, y: 200 };
  const p = M.pinch(v, [a0, b0], [a1, b1]);
  assert(near(p.scale, 2), `fingers twice as far apart double the scale (got ${p.scale})`);
  const mid0 = M.screenToCell(v, 250, 200);
  const mid1 = M.screenToCell(p, 250, 200);
  assert(mid0 && mid1 && mid0.x === mid1.x && mid0.y === mid1.y, 'the cell under the pinch midpoint stays under it');
  const drag = M.pinch(p, [a1, b1], [{ x: 130, y: 190 }, { x: 330, y: 190 }]);
  assert(near(drag.scale, p.scale) && near(drag.tx, p.tx - 20) && near(drag.ty, p.ty - 10), 'two fingers moving together at a fixed distance pan without zooming');
  const same = M.pinch(v, [a0, a0], [a0, a0]);
  assert(same.scale === v.scale, 'two fingers at the same point (zero distance) do not divide by zero');
  const floor = M.pinch(p, [a1, b1], [{ x: 240, y: 200 }, { x: 260, y: 200 }]);
  assert(floor.scale === 1, 'a pinch in cannot pass the floor');
}

// ---------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------
{
  const c = M.contentSize(14, 12, 48);
  const v = M.createView({ cols: 14, rows: 12, cell: 48, viewport: { w: 400, h: c.h }, minScale: 1 });
  assert(M.keyboardStep(v, 'ArrowRight').tx === -M.KEY_PAN, 'ArrowRight reveals the east: content moves west by KEY_PAN');
  assert(M.keyboardStep(M.keyboardStep(v, 'ArrowRight'), 'ArrowLeft').tx === 0, 'ArrowLeft undoes it');
  assert(M.keyboardStep(v, 'ArrowDown').ty === 0, 'ArrowDown on a map no taller than its stage stays put');
  assert(near(M.keyboardStep(v, '+').scale, M.KEY_ZOOM) && near(M.keyboardStep(v, '=').scale, M.KEY_ZOOM), '+ and = zoom in by KEY_ZOOM');
  assert(M.keyboardStep(M.keyboardStep(v, '+'), '-').scale === 1, '- zooms back out');
  const zoomedPanned = M.panBy(M.keyboardStep(v, '+'), -30, 0);
  const home = M.keyboardStep(zoomedPanned, '0');
  assert(home.scale === 1 && home.tx === 0, '0 fits the map again');
  assert(M.keyboardStep(v, 'a') === null && M.keyboardStep(v, 'Enter') === null, 'any other key is left to the page');
}

// ---------------------------------------------------------------------
// The painter, into a recorder
// ---------------------------------------------------------------------
function recorder() {
  const calls = [];
  const state = {};
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'state') return state;
      if (name === 'createLinearGradient') return (...args) => ({ gradient: args, addColorStop() {} });
      return (...args) => { calls.push({ name, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle }); };
    },
    set(_, name, value) { state[name] = value; return true; },
  });
  return ctx;
}
{
  const size = GRID_EXPANSIONS[0];
  const c = M.contentSize(size.cols, size.rows, 46);
  const v = M.createView({ cols: size.cols, rows: size.rows, cell: 46, viewport: { w: c.w, h: c.h } });
  const ctx = recorder();
  const e = paintPlat(ctx, v, { terrainAt, dpr: 2, cell: 46, label: size.label, sub: '10 x 7' });
  const calls = ctx.calls;
  const cellFills = calls.filter(k => k.name === 'fillRect' && k.args[2] === 46 && k.args[3] === 46);
  assert(cellFills.length === size.cols * size.rows, `one 46x46 fill per cell of the unlocked tier (${cellFills.length} for ${size.cols}x${size.rows})`);
  let placed = true, coloured = true;
  for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.cols; x++) {
    const o = M.cellOrigin(x, y, 46);
    const f = cellFills.find(k => k.args[0] === o.x && k.args[1] === o.y);
    if (!f) placed = false;
    else if (f.fillStyle !== TERRAIN_FILL[terrainAt(x, y)]) coloured = false;
  }
  assert(placed, 'every cell is filled at cellOrigin(), the same origin the marker layer uses');
  assert(coloured, 'every cell is filled in its terrain’s colour, read from terrainAt()');
  const t = M.trackSize(size.cols, size.rows, 46);
  const slab = calls.find(k => k.name === 'fillRect' && k.args[0] === M.FRAME.left && k.args[1] === M.FRAME.top && k.args[2] === t.w && k.args[3] === t.h);
  assert(slab && slab.fillStyle === INK, 'the tracks’ brown rule is one fill exactly trackSize() big, in ink, and not a pixel wider (#247)');
  const rules = calls.filter(k => k.name === 'strokeRect');
  assert(rules.length === 2 && rules.every(k => k.strokeStyle === INK), 'the sheet gets a double rule: two stroked rectangles in ink');
  const transforms = calls.filter(k => k.name === 'setTransform');
  assert(transforms.some(k => near(k.args[0], 2 * v.scale) && near(k.args[4], 2 * v.tx) && near(k.args[5], 2 * v.ty)), 'the content is painted under dpr x scale with the pan in device pixels');
  assert(transforms[0].args[0] === 2 && transforms[0].args[4] === 0 && calls[1].name === 'clearRect', 'the viewport is cleared in screen space first');
  assert(calls.some(k => k.name === 'fillText' && k.args[0] === size.label.toUpperCase()), 'the cartouche carries the tier’s label');
  assert(calls.some(k => k.name === 'fillText' && k.args[0] === 'N'), 'and the compass its N');
  const shades = calls.filter(k => k.name === 'fillRect' && k.fillStyle && k.fillStyle.gradient);
  assert(shades.length === 0 && !e.east && !e.west, 'a map that fits its stage paints no edge shade');
}
{
  // Panned mid-way on a narrow stage: shade on both sides, none above or below.
  const size = GRID_EXPANSIONS[2];
  const c = M.contentSize(size.cols, size.rows, 48);
  let v = M.createView({ cols: size.cols, rows: size.rows, cell: 48, viewport: { w: 330, h: c.h }, minScale: 1 });
  v = M.panBy(v, -100, 0);
  const ctx = recorder();
  paintPlat(ctx, v, { terrainAt, dpr: 1, cell: 48, label: size.label, sub: '' });
  const shades = ctx.calls.filter(k => k.name === 'fillRect' && k.fillStyle && k.fillStyle.gradient);
  assert(shades.length === 2, `a map panned into the middle shades two edges (${shades.length})`);
  const xs = shades.map(k => k.args[0]).sort((a, b) => a - b);
  assert(xs[0] === 0 && xs[1] === 330 - EDGE_SHADE && shades.every(k => k.args[2] === EDGE_SHADE && k.args[3] === c.h), 'one at the west edge, one at the east, each EDGE_SHADE wide and the stage tall');
  const atOrigin = recorder();
  paintPlat(atOrigin, M.fit(v), { terrainAt, dpr: 1, cell: 48, label: size.label, sub: '' });
  const originShades = atOrigin.calls.filter(k => k.name === 'fillRect' && k.fillStyle && k.fillStyle.gradient);
  assert(originShades.length === 1 && originShades[0].args[0] === 330 - EDGE_SHADE, 'at the west edge only the east is shaded');
  const cellFills = atOrigin.calls.filter(k => k.name === 'fillRect' && k.args[2] === 48 && k.args[3] === 48);
  assert(cellFills.length === size.cols * size.rows, `the whole tier is painted even when most of it is off the stage (${cellFills.length} cells)`);
}
{
  // The painter draws what currentGridSize says, tier by tier: a state at
  // Weekend 4 paints 14 x 10 cells, not the authored 14 x 12.
  const State = await import(mod('js/state.js'));
  const s = { ...State.createInitialState(), season: 4 };
  const size = currentGridSize(s);
  assert(size.cols === 14 && size.rows === 10, 'Weekend 4 is Deep Woods Trail');
  const v = M.createView({ cols: size.cols, rows: size.rows, cell: 46, viewport: { w: 0, h: 0 } });
  const ctx = recorder();
  paintPlat(ctx, v, { terrainAt, dpr: 1, cell: 46 });
  const cellFills = ctx.calls.filter(k => k.name === 'fillRect' && k.args[2] === 46 && k.args[3] === 46);
  assert(cellFills.length === 140, `Deep Woods Trail paints 140 cells (${cellFills.length}), and no South Meadow row`);
}

// ---------------------------------------------------------------------
// The postcard: one fixed-size picture of the faire, painted from a model
// ---------------------------------------------------------------------
{
  const State = await import(mod('js/state.js'));
  const { summarizeWeekend } = await import(mod('js/engine.js'));
  const { CONFIG, ENTRANCE } = await import(mod('js/data.js'));
  const P = await import(mod('js/postcard.js'));
  const { PAPER } = await import(mod('js/plat.js'));
  const fs = await import('node:fs');
  const atlas = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'sprites', 'markers.json'), 'utf8'));

  // A recorder that also keeps what each call was drawn with: the paper
  // is told from every other fill by its composite mode, and the text by
  // its font.
  const rec = () => {
    const calls = [], st = { globalCompositeOperation: 'source-over' };
    return new Proxy({}, {
      get(_, name) {
        if (name === 'calls') return calls;
        if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args) => { calls.push({ name, args, fill: st.fillStyle, stroke: st.strokeStyle, font: st.font, op: st.globalCompositeOperation, align: st.textAlign }); };
      },
      set(_, name, value) { st[name] = value; return true; },
    });
  };
  const paint = (model, opts) => { const ctx = rec(); const view = P.paintPostcard(ctx, model, opts); return { calls: ctx.calls, view }; };
  const SHEET = { sheet: true };
  const figure = (m, label) => m.figures.find(f => f.label === label)?.value;

  assert(P.POSTCARD.w === 1200 && P.POSTCARD.h === 800, 'a postcard is 1200 x 800, whatever the page');

  // A fresh faire, before anything has happened.
  const fresh = State.createInitialState();
  const m0 = P.postcardModel(fresh);
  assert(m0.title === 'Faire Weekend' && m0.tier === 'Home Grounds' && m0.cols === 10 && m0.rows === 7, 'the card names the game and the tier the faire has reached');
  assert(m0.when === 'Season 1 · Weekend 1 · Friday', `and its season, weekend and day (${m0.when})`);
  assert(m0.played === 0 && m0.heading === 'Before the gates open', 'a Friday morning card says no day has been played');
  assert(figure(m0, 'Through the gate') === '—' && figure(m0, 'Crowd mood') === '—' && figure(m0, 'Weekend net') === '—', 'and prints a dash for the three figures a day would have filled');
  assert(figure(m0, 'Reputation') === String(CONFIG.startingReputation) && figure(m0, 'Plots built') === '0', 'the standing figures are the state’s own');
  assert(m0.plots.length === 0 && m0.gate.x === ENTRANCE.x && m0.gate.y === ENTRANCE.y, 'an empty grounds has the gate and no plots');
  assert(P.postcardFileName(m0) === 'faire-weekend-season-1-weekend-1-friday.png', `the file is named for the season, weekend and day (${P.postcardFileName(m0)})`);

  // A weekend played with fixed seeds.
  let s = State.createInitialState();
  s = State.buildPlot(s, 'stage', 8, 5).state;
  s = State.buildPlot(s, 'food', 6, 3).state;
  s = State.buildPlot(s, 'vendor', 4, 3).state;
  s = State.placePlot(s, 'food', 1, 3).state;
  assert(s.builtPlots.length === 4 && s.builtPlots.filter(p => p.status === 'built').length === 3, 'sanity: three built plots and one still a plan');
  const planned = P.postcardModel(s);
  assert(planned.plots.length === 3 && !planned.plots.some(p => p.x === 1 && p.y === 3), 'a plot that is only a plan is not on the card');
  assert(planned.plots.find(p => p.kind === 'stage').w === 2 && planned.plots.find(p => p.kind === 'stage').h === 2, 'a stage keeps its 2 x 2 footprint');

  s = State.runDay(s, 4101).state;
  const friday = s.history[0];
  let m = P.postcardModel(s);
  assert(m.played === 1 && m.dayName === 'Friday' && m.heading === 'The weekend so far, 1 of 3 days', `the report of Friday is Friday with one day played (${m.heading})`);
  assert(figure(m, 'Through the gate') === friday.attendance.toLocaleString('en-US') && figure(m, 'Crowd mood') === `${friday.satisfaction}/100`,
    'one day played prints that day’s gate and mood');
  const net = Math.round(friday.cashDelta);
  assert(figure(m, 'Weekend net') === `${net >= 0 ? '+' : ''}${net < 0 ? '-' : ''}$${Math.abs(net).toLocaleString('en-US')}`, `and its net, signed (${figure(m, 'Weekend net')})`);
  s = State.nextDay(s).state;
  m = P.postcardModel(s);
  assert(m.played === 1 && m.dayName === 'Saturday', 'Saturday morning still counts one day, and says Saturday');
  s = State.nextDay(State.runDay(s, 4102).state).state;
  s = State.nextDay(State.runDay(s, 4103).state).state;
  assert(s.phase === 'weekendEnd' || s.phase === 'victory', `sanity: three days in, the weekend has closed (${s.phase})`);
  m = P.postcardModel(s);
  const whole = summarizeWeekend(s.history, CONFIG.seasonLength);
  assert(m.played === 3 && m.heading === 'The weekend, gates closed' && m.dayName === 'Sunday', 'a closed weekend counts all three days');
  assert(figure(m, 'Through the gate') === whole.totalAttendance.toLocaleString('en-US') && figure(m, 'Crowd mood') === `${whole.avgSatisfaction}/100`,
    'and its figures are summarizeWeekend’s, the ones the weekend-end stub prints');
  const closed = s;
  const next = State.startNextWeekend(s).state;
  const mNext = P.postcardModel(next);
  assert(next.history.length === 3 && mNext.played === 0 && figure(mNext, 'Through the gate') === '—' && mNext.when === 'Season 1 · Weekend 2 · Friday',
    'the next Friday starts the count again: last weekend’s three days are not this weekend’s');

  // The view: the whole plat inside its box, on every tier.
  for (const tier of GRID_EXPANSIONS) {
    const v = P.postcardView({ cols: tier.cols, rows: tier.rows });
    const c = M.contentSize(tier.cols, tier.rows, P.POSTCARD_CELL);
    const w = c.w * v.scale, h = c.h * v.scale, B = P.PLAT_BOX;
    assert(v.tx >= B.x - 1e-9 && v.ty >= B.y - 1e-9 && v.tx + w <= B.x + B.w + 1e-9 && v.ty + h <= B.y + B.h + 1e-9, `${tier.label}: the plat sits inside the card’s box`);
    assert(near(w, B.w) || near(h, B.h), `${tier.label}: and fills it on one axis (${w.toFixed(1)} x ${h.toFixed(1)})`);
    // Every tier fills the box's width, so only the height can tell a
    // centred plat from one pushed to the top.
    assert(near(w, B.w) && h < B.h - 20 && near(v.ty - B.y, B.y + B.h - (v.ty + h)), `${tier.label}: as wide as the box, and centred in its height`);
    assert(B.x + B.w < P.COLUMN.x && P.COLUMN.x + P.COLUMN.w < P.POSTCARD.w, 'the box and the column do not overlap');
  }

  // The paint.
  const { calls, view } = paint(P.postcardModel(closed), { sprite: SHEET });
  const cellFills = calls.filter(k => k.name === 'fillRect' && k.args[2] === 46 && k.args[3] === 46);
  assert(cellFills.length === 70, `the card paints the plat’s 70 cells (${cellFills.length})`);
  const paper = calls.filter(k => k.name === 'fillRect' && k.op === 'destination-over');
  assert(paper.length === 1 && paper[0].fill === PAPER && paper[0].args.join() === '0,0,1200,800', 'one sheet of paper the size of the card, laid under everything already painted');
  assert(calls.indexOf(paper[0]) > calls.indexOf(cellFills[69]), 'after the plat, which clears the whole canvas first');
  const tokens = calls.filter(k => k.name === 'fillRect' && k.fill === P.TOKEN.fill);
  assert(tokens.length === 3, `one token per built plot (${tokens.length})`);
  const stageRect = M.cellToRect(view, 8, 5, 2, 2), inset = M.MARKER_MARGIN * view.scale;
  const stageToken = tokens.find(k => near(k.args[0], stageRect.x + inset) && near(k.args[1], stageRect.y + inset));
  assert(!!stageToken && near(stageToken.args[2], stageRect.w - 2 * inset) && near(stageToken.args[3], stageRect.h - 2 * inset), 'the stage’s token covers its four cells, less the marker margin');
  const draws = calls.filter(k => k.name === 'drawImage');
  assert(draws.length === 4 && draws.every(k => k.args[0] === SHEET), `the marker sheet is drawn once per built plot and once for the gate (${draws.length})`);
  const frameOf = k => Object.entries(atlas.frames).find(([, f]) => f.x === k.args[1] && f.y === k.args[2] && f.w === k.args[3] && f.h === k.args[4])?.[0];
  assert(draws.map(frameOf).join() === 'stage,food,vendor,gate', `each from its own frame of markers.json (${draws.map(frameOf).join()})`);
  const gateRect = M.cellToRect(view, ENTRANCE.x, ENTRANCE.y);
  assert(!!draws[3] && near(draws[3].args[5], gateRect.x) && near(draws[3].args[6], gateRect.y) && near(draws[3].args[7], gateRect.w), 'the gate is drawn on the gate’s cell');
  const texts = calls.filter(k => k.name === 'fillText');
  const said = t => texts.some(k => k.args[0] === t);
  const mc = P.postcardModel(closed);
  assert(said('Faire Weekend') && said('HOME GROUNDS') && said(mc.when) && said('THE WEEKEND, GATES CLOSED'), 'the card says the game, the tier, the day and what the figures cover');
  assert(mc.figures.length === 7 && mc.figures.every(f => said(f.label) && said(f.value)), 'and every figure, label and value');
  assert(texts.find(k => k.args[0] === 'Faire Weekend').font.includes('Grenze Gotisch'), 'the name is in the signboard face');
  const column = texts.filter(k => /px 'Barlow/.test(k.font) && k.args[1] >= P.COLUMN.x);
  assert(column.length >= 17 && column.every(k => k.args[1] <= P.COLUMN.x + P.COLUMN.w && k.args[2] < P.POSTCARD.h - 40), 'the column’s lines start inside the column and above the card’s rule');

  // No sheet (it failed to load): tokens, no drawings, nothing thrown.
  const bare = paint(P.postcardModel(closed), {});
  assert(bare.calls.filter(k => k.name === 'drawImage').length === 0 && bare.calls.filter(k => k.name === 'fillRect' && k.fill === P.TOKEN.fill).length === 3,
    'without the marker sheet the plots are their tokens and nothing is drawn from it');

  // The same state is the same card, call for call; a different day is not.
  const log = st => JSON.stringify(paint(P.postcardModel(st), { sprite: 'sheet' }).calls);
  const again = JSON.parse(JSON.stringify(closed));
  assert(log(closed) === log(again), 'the same state paints the same calls in the same order, through a save and back');
  assert(log(closed) !== log(next), 'and the next Friday paints a different card');
  const before = JSON.stringify(closed);
  P.postcardModel(closed);
  assert(JSON.stringify(closed) === before, 'reading a state for its card changes nothing in it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
