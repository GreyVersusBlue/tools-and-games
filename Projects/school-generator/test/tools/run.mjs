#!/usr/bin/env node
// test/tools/run.mjs — the fourteen drawing tools, driven on the real page —
// and, since Phase 42, what the page costs to boot.
//
//   node test/tools/run.mjs               run every check
//   node test/tools/run.mjs --only wall   run one
//   node test/tools/run.mjs --only floor-rect,prop      run a few, in
//                                        declaration order, not typed order
//   node test/tools/run.mjs --headed      watch it happen
//
// Why this exists, when there are already seventy-five suites: none of them
// can load a tool. Every one of `editor.js` and the six `*edit.js` modules
// opens with `import * as THREE from 'three'`, so the whole tool layer — 3,867
// lines of "which segment did that click land on", "does this prop snap to the
// wall or to the lattice", "is this loop closed" — is invisible to Node. The
// pure suite proves the *numbers* are right; the visual harness proves the
// *pictures* are right; this proves the *tools* are wired to them.
//
// The trick that makes it possible is small: `window.app` (main.js's debug
// hook) exposes the state and the render API, and the render API's edit camera
// is an ordinary orthographic camera, so a world point in feet can be
// projected to a screen point in pixels and handed to a real mouse. Nothing
// here reaches inside a tool; every check is a gesture in, a state delta out —
// which is the same contract a person has with the toolbar.
//
// Deliberately **outside** `node --test`, on the same terms as test/visual: it
// needs a browser, and a machine without one loses the tools pass rather than
// the suite. Exit 0 all passed, 1 something failed, 2 no Playwright.
//
// A note on aim. Panels float over the canvas, so a world point can be behind
// one; every gesture below is aimed at the open middle of the plan, and
// `assertClear` fails loudly rather than quietly missing if that ever stops
// being true.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));       // .../test/tools
const PROJECT = dirname(dirname(HERE));                     // .../school-generator
const REPO = dirname(dirname(PROJECT));                     // the site root (serves /assets)

// A whole check, not a single operation. Playwright bounds each evaluate and
// each click; nothing bounds a check made of thirty of them, and one stuck
// check used to take the run down with it.
const CHECK_DEADLINE = 180000;   // ms

// Rejects if the work has not settled in time, so the run reports a stuck
// check as a failure and carries on to the rest.
function withDeadline(work, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(work).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} gave up after ${ms / 1000}s`)), ms);
    }),
  ]);
}

const HEADED = process.argv.includes('--headed');
// `--only wall` runs one check; `--only floor-rect,prop` runs several, in the
// order they are declared below rather than the order they are typed — some
// checks want what an earlier one drew, and this is a filter, not a plan.
const only = process.argv.includes('--only')
  ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',').map((t) => t.trim()))
  : null;

// ---------- find playwright without owning a package.json ----------

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* keep looking */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'x'))('playwright');
  } catch { /* keep looking */ }
  return null;
}

// ---------- the same static server test/visual uses ----------

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json',
  // Phase 30: the app manifest, so the install path is served the way a real
  // host serves it rather than as a blob the browser declines to parse.
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = p.startsWith('/assets/') ? join(REPO, p) : join(PROJECT, p);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- what the page lends us ----------
//
// Installed once, after boot. All of it reads; none of it writes. `w2c` is the
// whole harness in four lines: project a world point through the live edit
// camera to normalized device coordinates, then map those onto the canvas rect.

const HELPERS = `
window.__w2c = (x, z) => {
  const cam = window.app.renderApi.editCamera;
  const V = cam.position.constructor;                 // THREE.Vector3, unnamed here
  const v = new V(x, 0, z).project(cam);
  const r = document.getElementById('view').getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
};
// Everything a check might want to compare, in one shape, so a delta is a
// plain object diff and a check never has to reach for a private field.
window.__fp = () => {
  const s = window.app.state;
  const f = s.floors[s.currentFloor];
  const sh = f.shapes || [];
  return {
    shapes: sh.length,
    verts: sh.reduce((n, x) => n + x.rings.reduce((k, r) => k + r.pts.length, 0), 0),
    rings: sh.reduce((n, x) => n + x.rings.length, 0),
    openings: sh.reduce((n, x) => n + x.rings.reduce((k, r) => k + r.openings.length, 0), 0),
    walls: (f.walls || []).length,
    // Openings cut into free-standing walls — the ones a room's rings know
    // nothing about, and the ones "put a door in the wall I just drew" is made
    // of. Counted apart from the rings' own openings for exactly that reason.
    lineOpenings: (f.walls || []).reduce((n, l) => n + (l.openings || []).length, 0),
    props: (s.props || []).length,
    links: (s.links || []).length,
    sections: (s.sections || []).length,
    // Phase 38's per-storey annotations, summed across storeys the way a
    // check wants them: one number that moves when a record lands.
    dims: s.floors.reduce((n, fl) => n + (fl.dims || []).length, 0),
    notes: s.floors.reduce((n, fl) => n + (fl.notes || []).length, 0),
    floors: s.floors.length,
    names: sh.map((x) => x.name || '').join('|'),
    json: JSON.stringify(s).length,
  };
};
window.__shapes = () => window.app.state.floors[window.app.state.currentFloor].shapes
  .map((sh) => ({
    id: sh.id, name: sh.name,
    pts: sh.rings[0].pts.map((p) => [p.x, p.z]),
    openings: sh.rings[0].openings.length,
  }));
window.__status = () => document.getElementById('status').textContent;
// Is this world point actually the canvas, or is a panel floating over it? A
// check that silently clicks a panel is a check that silently passes.
window.__clear = (x, z) => {
  const c = window.__w2c(x, z);
  const el = document.elementFromPoint(c.x, c.y);
  return !!el && el.id === 'view';
};
// A whole path in one call. Projecting is arithmetic; the round trip to the
// page is what costs, and a drag used to pay for one per waypoint.
window.__path = (pts) => pts.map(([x, z]) => window.__w2c(x, z));
window.__allClear = (pts) => pts.map(([x, z]) => window.__clear(x, z));
// Phase 30. The lessons, read out of the module that declares them, so the
// check below asserts each demo's *own* claim rather than a copy of it kept
// here — which is the whole reason the tutorial cannot rot.
window.__demos = async () => {
  const m = await import('./js/demo.js');
  return m.DEMOS.map((d) => ({
    id: d.id, title: d.title, changes: d.changes, duration: m.demoEvents(d).duration,
  }));
};
1`;

// ---------- the driver ----------

function makeDriver(page) {
  const at = (x, z) => page.evaluate(`window.__w2c(${x}, ${z})`);
  const fp = () => page.evaluate('window.__fp()');
  const status = () => page.evaluate('window.__status()');
  const shapes = () => page.evaluate('window.__shapes()');

  // Tools are picked through the toolbar rather than through editor.setTool,
  // because selecting a tool is also what opens its panel — and a panel that
  // did not open is a tool half-selected.
  const pick = (t) => page.evaluate(
    `document.querySelector('#toolbar .tool[data-tool="${t}"]').click(); 1`);

  async function assertClear(pts) {
    const ok = await page.evaluate((p) => window.__allClear(p), pts);
    const bad = pts.filter((_, i) => !ok[i]);
    if (bad.length) {
      throw new Error(
        `${bad.map(([x, z]) => `(${x}, ${z})`).join(', ')} ` +
        `${bad.length === 1 ? 'is' : 'are'} behind a panel — the gesture would miss the canvas`);
    }
  }

  async function click(x, z) {
    const c = await at(x, z);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(260);
  }

  // A press, a path, a release. The waits are for the rebuild each sample
  // triggers, which on a software rasterizer is not fast.
  async function drag(pts) {
    // The camera does not move during a gesture, so the whole path can be
    // projected up front — one round trip instead of one per waypoint.
    const path = await page.evaluate((p) => window.__path(p), pts);
    await page.mouse.move(path[0].x, path[0].y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    for (const c of path.slice(1)) {
      await page.mouse.move(c.x, c.y);
      await page.waitForTimeout(140);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  const centre = (sh) => [
    sh.pts.reduce((a, p) => a + p[0], 0) / sh.pts.length,
    sh.pts.reduce((a, p) => a + p[1], 0) / sh.pts.length,
  ];

  return { at, fp, status, shapes, pick, click, drag, assertClear, centre, page };
}

// ---------- Phase 42: what the boot costs ----------
//
// The tool used to download 3.5 MB over a hundred requests before the first
// frame, most of it for features behind a button nobody had pressed. Phase 42
// put the report and its tail, the printable set and the session stack
// behind `import()`; this is the ceiling that keeps them there, and the check
// that each still arrives when its button is pressed. Measured here rather
// than in the unit suite because the boot is a property of the page, not of
// any module: the static import graph says what *could* load, and only a
// browser says what did.
//
// The budget is the walk template's 4 MB rule applied to the tool itself,
// with the number set from what this tree measures (see BOOT_BUDGET) so a
// phase that quietly re-pins a module fails here rather than in a user's
// first ten seconds.
let bootLoad = null;         // { requests, bytes, jsBytes, modules } once booted
const fetched = [];          // every same-origin response, boot and after

function watchResponses(page) {
  page.on('response', (r) => {
    const url = r.url();
    if (!url.startsWith('http://127.0.0.1')) return;
    const entry = { path: new URL(url).pathname, bytes: 0, at: performance.now(), done: null };
    // The body is the honest size; a response the browser will not hand
    // back (a 304, one served by the worker) falls back to its own header.
    entry.done = r.body().then((b) => { entry.bytes = b.length; }, () => {
      entry.bytes = Number(r.headers()['content-length']) || 0;
    });
    fetched.push(entry);
  });
}
const settleResponses = () => Promise.all(fetched.map((e) => e.done));
const moduleName = (path) => (path.match(/\/js\/([\w.-]+)\.js$/) || [])[1] || null;
const modulesFetched = (since = 0) =>
  new Set(fetched.filter((e) => e.at >= since).map((e) => moduleName(e.path)).filter(Boolean));

// Bytes and requests to the first frame. Measured here when Phase 42 landed:
// 4117 KB over 121 requests before it, 3805 KB over 109 after — three.js is
// 1274 KB of that and main.js and render.js another 678 KB. The byte ceiling
// is the walk template's own 4 MB rule; the request ceiling leaves room for a
// phase's worth of new modules above the measurement, because a budget that
// is exactly the measurement is a budget that fails on a comment.
const BOOT_BUDGET = { bytes: 4 * 1024 * 1024, requests: 115 };
// Modules the boot must not fetch: each is behind a button, and the phase
// that put it there is named so the next reader knows what re-pinning costs.
const DEFERRED = [
  'generate', 'gallerystock',                                    // the audit's pass
  'report', 'egress', 'daylight', 'utilisation', 'takeoff',      // Phase 42: the report tail
  'cost', 'spec', 'rates', 'phasing', 'commonpath',
  'blueprint',                                                   // Phase 42: the printable set
  'session', 'presence', 'wire', 'cloud',                        // Phase 42: the session stack
];

// ---------- the checks ----------
//
// Each one says what it drove and what it expects to have changed. `expect` is
// given the before/after fingerprints and the status line, and throws — with a
// sentence — when the tool did not do its job. They run in order against one
// page, which is also how a person uses the tool.

const CHECKS = [
  {
    name: 'boot-budget',
    what: 'the boot stays under its budget, and the deferred modules stay out of it',
    async run() { return bootLoad; },
    expect: ({ ctx }) => {
      if (!ctx) throw new Error('the boot was not measured');
      const kb = (n) => `${Math.round(n / 1024)} KB`;
      if (ctx.bytes > BOOT_BUDGET.bytes) {
        throw new Error(`the boot is ${kb(ctx.bytes)}, over the ${kb(BOOT_BUDGET.bytes)} budget`);
      }
      if (ctx.requests > BOOT_BUDGET.requests) {
        throw new Error(`the boot is ${ctx.requests} requests, over the budget of ${BOOT_BUDGET.requests}`);
      }
      const pinned = DEFERRED.filter((m) => ctx.modules.has(m));
      if (pinned.length) {
        throw new Error(`${pinned.join(', ')} loaded at boot — something on the boot path imports ` +
          `${pinned.length === 1 ? 'it' : 'them'} again`);
      }
    },
  },
  {
    name: 'floor-brush',
    what: 'the 4ft brush lays floor and bakes it into a room',
    async run(d) {
      await d.pick('floor');
      await d.page.evaluate('window.app.editor.setFloorRect(false); 1');
      await d.assertClear([[64, 8], [88, 8], [88, 20]]);
      await d.drag([[64, 8], [88, 8], [88, 20]]);
    },
    expect: ({ before, after }) => {
      if (after.shapes <= before.shapes) throw new Error('no new room was baked');
      if (after.verts <= before.verts) throw new Error('the new room has no corners');
    },
  },
  {
    name: 'floor-rect',
    what: 'a dragged rectangle lays a block of floor and reports its area',
    async run(d) {
      await d.pick('floor');
      await d.page.evaluate('window.app.editor.setFloorRect(true); 1');
      await d.assertClear([[96, 8], [128, 24]]);
      await d.drag([[96, 8], [128, 24]]);
    },
    expect: ({ before, after, status }) => {
      if (after.shapes <= before.shapes) throw new Error('no room appeared');
      if (!/ft²/.test(status)) throw new Error(`no area reported: ${status}`);
    },
  },
  {
    name: 'room-name',
    what: 'the room tool writes a name and a colour where you click',
    async run(d) {
      await d.pick('room');
      await d.page.evaluate(`window.app.editor.setRoom('Audit Room', '#ff0000'); 1`);
      const sh = (await d.shapes())[0];
      const [cx, cz] = d.centre(sh);
      await d.assertClear([[cx, cz]]);
      await d.click(cx, cz);
    },
    expect: ({ after, status }) => {
      if (!after.names.includes('Audit Room')) throw new Error('the name was not applied');
      if (!/Audit Room/.test(status)) throw new Error(`the status did not name it: ${status}`);
    },
  },
  {
    name: 'room-numbering',
    what: 'each room drawn by hand gets a number nobody has used',
    async run(d) {
      await d.pick('floor');
      await d.page.evaluate('window.app.editor.setFloorRect(true); 1');
      await d.assertClear([[16, 8], [32, 24], [40, 8], [56, 24]]);
      await d.drag([[16, 8], [32, 24]]);
      await d.drag([[40, 8], [56, 24]]);
    },
    // The regression this exists for: the name field was seeded with the
    // literal 'Room 101' and never advanced, so every hand-drawn room in a
    // building carried the same name and bindRoom had a coin toss to make.
    expect: ({ after }) => {
      const names = after.names.split('|').filter((n) => /^Room \d+$/.test(n));
      const seen = new Set(names);
      if (seen.size !== names.length) {
        throw new Error(`two rooms share a name: ${names.join(', ')}`);
      }
    },
  },
  {
    name: 'wall',
    what: 'two clicks draw a free-standing wall and report its length',
    async run(d) {
      await d.pick('wall');
      await d.assertClear([[100, 100], [128, 100]]);
      await d.click(100, 100);
      await d.click(128, 100);
    },
    expect: ({ before, after, status }) => {
      if (after.walls <= before.walls) throw new Error('no wall was added to the storey');
      if (!/\d+ ft/.test(status)) throw new Error(`no length reported: ${status}`);
    },
  },
  {
    name: 'section',
    what: 'two clicks draw a named section line, and a third click on it removes it',
    async run(d) {
      await d.pick('section');
      await d.assertClear([[100, 108], [128, 108]]);
      await d.click(100, 108);
      await d.click(128, 108);
    },
    expect: ({ before, after, status }) => {
      if (after.sections !== before.sections + 1) throw new Error('no section line was recorded');
      if (!/Section [A-L]-[A-L]/.test(status)) throw new Error(`the tool did not name the cut: ${status}`);
    },
  },
  {
    name: 'section-remove',
    what: 'clicking a drawn section line takes it back off the design',
    async run(d) {
      await d.pick('section');
      await d.assertClear([[114, 108]]);
      await d.click(114, 108);
    },
    expect: ({ before, after, status }) => {
      if (after.sections !== before.sections - 1) throw new Error('the line is still there');
      if (!/removed/.test(status)) throw new Error(`the tool did not say so: ${status}`);
    },
  },
  {
    name: 'anno-dim',
    what: 'three clicks hang a dimension whose number is measured, never typed',
    async run(d) {
      await d.pick('anno');
      await d.assertClear([[96, 40], [124, 40], [110, 46]]);
      await d.click(96, 40);
      await d.click(124, 40);
      await d.click(110, 46);
    },
    expect: ({ before, after, status }) => {
      if (after.dims !== before.dims + 1) throw new Error('no dimension was recorded');
      if (!/28'-0"/.test(status)) throw new Error(`the measured number is missing: ${status}`);
    },
  },
  {
    name: 'anno-note',
    what: 'two clicks pin a note whose sentence comes from the panel',
    async run(d) {
      await d.pick('anno');
      await d.page.evaluate(`window.app.editor.setAnnoMode('note');
        const t = document.getElementById('anno-text');
        t.value = 'existing column here';
        t.dispatchEvent(new Event('change')); 1`);
      await d.assertClear([[100, 52], [112, 56]]);
      await d.click(100, 52);
      await d.click(112, 56);
    },
    expect: ({ before, after, status }) => {
      if (after.notes !== before.notes + 1) throw new Error('no note was recorded');
      if (!/existing column here/.test(status)) throw new Error(`the sentence didn't make it: ${status}`);
    },
  },
  {
    name: 'anno-delete',
    what: 'clicking a drawn dimension selects it and Delete removes it',
    async run(d) {
      await d.pick('anno');
      // The dimension drawn by anno-dim stands 6ft off its anchors, at z=46.
      await d.assertClear([[110, 46]]);
      await d.click(110, 46);
      await d.page.keyboard.press('Delete');
      await d.page.waitForTimeout(260);
    },
    expect: ({ before, after, status }) => {
      if (after.dims !== before.dims - 1) throw new Error('the dimension is still there');
      if (!/removed/.test(status)) throw new Error(`the tool did not say so: ${status}`);
    },
  },
  {
    name: 'door',
    what: 'a click on a wall cuts an opening in it',
    async run(d) {
      await d.pick('door');
      const sh = (await d.shapes()).find((s) => s.name === 'Audit Room') || (await d.shapes())[0];
      const [p0, p1] = [sh.pts[0], sh.pts[1]];
      const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      await d.assertClear([m]);
      await d.click(m[0], m[1]);
    },
    expect: ({ status }) => {
      if (!/cut into a .* wall|removed/.test(status)) {
        throw new Error(`the door tool said nothing about an opening: ${status}`);
      }
    },
  },
  {
    name: 'erase',
    what: 'a dragged rectangle takes floor away and says how much',
    async run(d) {
      await d.pick('erase');
      await d.page.evaluate('window.app.editor.setFloorRect(true); 1');
      // The far corner of the block floor-rect laid, well clear of the spot
      // the prop check will want floor under later.
      await d.assertClear([[120, 16], [128, 24]]);
      await d.drag([[120, 16], [128, 24]]);
    },
    expect: ({ before, after, status }) => {
      if (after.json === before.json) throw new Error('nothing was erased');
      if (!/Erased/.test(status)) throw new Error(`no erasure reported: ${status}`);
    },
  },
  {
    name: 'poly',
    what: 'clicked corners closed on the first make a polygon room',
    async run(d) {
      await d.pick('poly');
      await d.page.evaluate(`window.app.editor.setRoom('Poly Room', '#00ff00'); 1`);
      const loop = [[36, 96], [48, 96], [48, 112], [36, 112]];
      await d.assertClear(loop);
      for (const [x, z] of loop) await d.click(x, z);
      await d.click(36, 96);                    // close on the first corner
      await d.page.waitForTimeout(400);
    },
    expect: ({ before, after, status }) => {
      if (after.shapes <= before.shapes) throw new Error('the loop did not close into a room');
      if (!/corners/.test(status)) throw new Error(`no corner count reported: ${status}`);
    },
  },
  {
    name: 'vertex',
    what: 'a selected room lets a corner be dragged somewhere else',
    async run(d) {
      await d.pick('vertex');
      const sh = (await d.shapes()).find((s) => s.name === 'Poly Room');
      if (!sh) throw new Error('the polygon room from the previous check is gone');
      const [cx, cz] = d.centre(sh);
      await d.assertClear([[cx, cz]]);
      await d.click(cx, cz);                    // select it
      const v = sh.pts[0];
      await d.assertClear([[v[0], v[1]], [v[0] - 5, v[1] - 5]]);
      await d.drag([[v[0], v[1]], [v[0] - 5, v[1] - 5]]);
      return { id: sh.id, was: v };
    },
    expect: async ({ ctx, d }) => {
      const now = (await d.shapes()).find((s) => s.id === ctx.id);
      if (!now) throw new Error('the room disappeared');
      const moved = now.pts.some(
        (p) => Math.hypot(p[0] - ctx.was[0], p[1] - ctx.was[1]) > 1);
      if (!moved) throw new Error('no corner moved');
    },
  },
  {
    name: 'repeat',
    what: 'a marquee catches a room, Ctrl+V pastes it under a ghost, a drag stamps a row, and the storey slides',
    async run(d) {
      // Phase 32, end to end on the real page: draw a classroom, box-select
      // it, copy, paste one at the pointer, stamp a row of three, then slide
      // the storey out and back. Everything placed here is deleted again so
      // the later checks meet the storey they expect.
      await d.pick('poly');
      await d.page.evaluate(`window.app.editor.setRoom('Repeat Room', '#88ccff'); 1`);
      const loop = [[60, 96], [76, 96], [76, 108], [60, 108]];
      await d.assertClear(loop);
      for (const [x, z] of loop) await d.click(x, z);
      await d.click(60, 96);                    // close on the first corner
      const drawn = await d.fp();

      await d.pick('vertex');
      await d.assertClear([[56, 92], [80, 112]]);
      await d.drag([[56, 92], [80, 112]]);      // the marquee
      const selStatus = await d.status();

      await d.page.keyboard.press('Control+c');
      const copyStatus = await d.status();
      await d.page.keyboard.press('Control+v');
      await d.assertClear([[104, 102]]);
      await d.click(104, 102);                  // the ghost lands where you click
      const pasted = await d.fp();

      // The clipboard survives a paste: paste again, and this time drag —
      // a 16ft-wide room dragged 36ft east is a row of three at 16ft pitch.
      await d.page.keyboard.press('Control+v');
      await d.assertClear([[64, 118], [100, 118]]);
      await d.drag([[64, 118], [100, 118]]);
      const stamped = await d.fp();
      const stampStatus = await d.status();

      // Tidy up: the stamp left its row selected; the paste and the original
      // are one marquee each.
      await d.page.keyboard.press('Delete');
      await d.drag([[92, 92], [116, 110]]);
      await d.page.keyboard.press('Delete');
      await d.drag([[56, 92], [80, 112]]);
      await d.page.keyboard.press('Delete');

      // The storey slides as one set, and slides back.
      const before = await d.shapes();
      const slide = async (dx) => d.page.evaluate(`
        document.getElementById('slide-dx').value = '${dx}';
        document.getElementById('slide-dz').value = '0';
        document.getElementById('sheet-slide').click(); 1`);
      await slide(8);
      const slid = await d.shapes();
      const slideStatus = await d.status();
      await slide(-8);
      const home = await d.shapes();
      return { drawn, selStatus, copyStatus, pasted, stamped, stampStatus, before, slid, slideStatus, home };
    },
    expect: ({ ctx, before, after }) => {
      if (ctx.drawn.shapes !== before.shapes + 1) throw new Error('the classroom was not drawn');
      if (!/1 room selected/.test(ctx.selStatus)) {
        throw new Error(`the marquee did not report a selection: ${ctx.selStatus}`);
      }
      if (!/Copied 1 room/.test(ctx.copyStatus)) {
        throw new Error(`nothing reported copied: ${ctx.copyStatus}`);
      }
      if (ctx.pasted.shapes !== ctx.drawn.shapes + 1) throw new Error('the ghost paste placed nothing');
      if (ctx.stamped.shapes !== ctx.pasted.shapes + 3) {
        throw new Error(`the stamp made ${ctx.stamped.shapes - ctx.pasted.shapes} rooms, expected a row of 3`);
      }
      if (!/Stamped 3 copies/.test(ctx.stampStatus)) {
        throw new Error(`the stamp did not say what it did: ${ctx.stampStatus}`);
      }
      if (after.shapes !== before.shapes) {
        throw new Error(`the check did not tidy up after itself: ${before.shapes} -> ${after.shapes} rooms`);
      }
      if (!/Slid Level 1/.test(ctx.slideStatus)) {
        throw new Error(`the slide did not report itself: ${ctx.slideStatus}`);
      }
      const was = ctx.before[0], moved = ctx.slid.find((s) => s.id === was.id),
        back = ctx.home.find((s) => s.id === was.id);
      if (!moved || Math.abs(moved.pts[0][0] - was.pts[0][0] - 8) > 1e-6) {
        throw new Error('sliding the storey did not move its rooms by 8ft');
      }
      if (!back || Math.abs(back.pts[0][0] - was.pts[0][0]) > 1e-6) {
        throw new Error('sliding back did not bring the rooms home');
      }
    },
  },
  {
    name: 'prop',
    what: 'a click on clear floor places the selected piece of furniture',
    async run(d) {
      await d.pick('prop');
      await d.assertClear([[112, 16]]);
      await d.click(112, 16);          // inside the block floor-rect laid, which is empty
    },
    expect: ({ before, after, status }) => {
      if (after.props !== before.props + 1) {
        throw new Error(`props went ${before.props} -> ${after.props}, expected one more`);
      }
      if (!/placed/.test(status)) throw new Error(`nothing reported placed: ${status}`);
    },
  },
  {
    name: 'prop-select',
    what: 'clicking a piece that is already there selects it, and says so',
    async run(d) {
      await d.pick('prop');
      await d.click(112, 16);                   // onto the one just placed
    },
    // The regression: this was the one selection path in propedit.js that
    // updated the status line not at all, so a click on a prop was
    // indistinguishable from a click the tool ignored.
    expect: ({ before, after, status }) => {
      if (after.props !== before.props) throw new Error('a second prop was placed on top');
      if (!/selected/.test(status)) {
        throw new Error(`selecting a prop said nothing: ${status}`);
      }
    },
  },
  {
    name: 'stair',
    what: 'a click places a run that opens a hole in the storey above',
    async run(d) {
      await d.pick('stair');
      await d.assertClear([[60, 100]]);
      await d.click(60, 100);
    },
    expect: ({ before, after, status }) => {
      if (after.links <= before.links) throw new Error('no link was added');
      if (!/risers|Opens|opening/i.test(status)) {
        throw new Error(`no stair readout: ${status}`);
      }
    },
  },
  {
    name: 'template',
    what: 'a stamped layout places its whole furniture list at once',
    async run(d) {
      await d.pick('template');
      await d.assertClear([[100, 104]]);
      await d.click(100, 104);
    },
    expect: ({ before, after, status }) => {
      if (after.props <= before.props + 1) {
        throw new Error(`a layout should place several props, got ${after.props - before.props}`);
      }
      if (!/placed/.test(status)) throw new Error(`nothing reported placed: ${status}`);
    },
  },
  {
    name: 'site',
    what: 'the site tool answers for what is under the cursor outdoors',
    async run(d) {
      await d.pick('site');
      const hidden = await d.page.evaluate(
        `document.getElementById('site-panel').classList.contains('hidden')`);
      if (hidden) throw new Error('picking the site tool did not open its panel');
      await d.assertClear([[20, 20]]);
      await d.click(20, 20);
    },
    expect: ({ status }) => {
      if (!/ft²|corner|Grade|region/i.test(status)) {
        throw new Error(`the site tool said nothing usable: ${status}`);
      }
    },
  },
  {
    name: 'overlay',
    what: 'the overlay tool opens its panel and asks for an image first',
    async run(d) {
      await d.pick('overlay');
      const panel = await d.page.evaluate(`(() => {
        const p = document.getElementById('overlay-panel');
        return { hidden: p.classList.contains('hidden'),
                 controls: [...p.querySelectorAll('button,input')].length };
      })()`);
      if (panel.hidden) throw new Error('picking the overlay tool did not open its panel');
      if (panel.controls < 4) throw new Error('the overlay panel lost its controls');
      await d.assertClear([[52, 96], [76, 96]]);
      await d.drag([[52, 96], [76, 96]]);
    },
    // Nothing to move without a picture, and the tool has to say which button
    // loads one rather than silently doing nothing.
    expect: ({ before, after, status }) => {
      if (after.json !== before.json) throw new Error('a drag with no image changed the design');
      if (!/[Ll]oad an image/.test(status)) {
        throw new Error(`no instruction offered: ${status}`);
      }
    },
  },
  // ---------- Phase 35: the square you pointed at ----------
  //
  // Both of these are gestures rather than arithmetic, which is why they are
  // here: `snapgrid.js`, `gridref.js` and `paint.js` all have suites that
  // prove the numbers, and neither of the two things a person actually
  // notices — the tile following the zoom, and the grid refusing to move
  // under a plan — is visible from Node.
  {
    name: 'floor-tile-follows-the-zoom',
    what: 'a floor tile is one square of the drawing grid, however far in you are',
    async run(d) {
      await d.pick('floor');
      await d.page.evaluate('window.app.editor.setFloorRect(true); 1');
      // Right in, on an empty corner of the sheet: the finest pitch is 2ft.
      const view = await d.page.evaluate(`(() => {
        const v = window.app.renderApi.editView;
        const was = { x: v.x, z: v.z, height: v.height };
        v.x = 140; v.z = 100; v.height = 30;
        return was;
      })()`);
      await d.page.waitForTimeout(300);
      const pitch = await d.page.evaluate('window.app.editor.gridPitch');
      if (pitch !== 2) throw new Error(`the closest zoom drew a ${pitch}ft grid, not a 2ft one`);
      await d.assertClear([[141, 101]]);
      await d.click(141, 101);
      await d.page.waitForTimeout(200);
      const laid = await d.page.evaluate(`(() => {
        const s = window.app.state;
        const sh = s.floors[s.currentFloor].shapes;
        const last = sh[sh.length - 1];
        const xs = last.rings[0].pts.map((p) => p.x), zs = last.rings[0].pts.map((p) => p.z);
        return {
          cellFt: s.cellFt,
          w: Math.max(...xs) - Math.min(...xs),
          d: Math.max(...zs) - Math.min(...zs),
        };
      })()`);
      // ...and put the design and the view back, so nothing after this has to
      // be written around a 2ft cupboard in the corner.
      await d.page.evaluate('window.app.editor.undo(); 1');
      await d.page.evaluate((v) => {
        Object.assign(window.app.renderApi.editView, v);
        return 1;
      }, view);
      await d.page.waitForTimeout(300);
      const back = await d.page.evaluate('window.app.state.cellFt');
      return { laid, back };
    },
    expect: ({ ctx, before, after }) => {
      if (ctx.laid.w !== 2 || ctx.laid.d !== 2) {
        throw new Error(`a click at the 2ft grid laid a ${ctx.laid.w} x ${ctx.laid.d} ft tile`);
      }
      if (ctx.laid.cellFt !== 2) throw new Error('the design did not refine its raster to hold it');
      if (ctx.back !== 4) throw new Error('undo left the raster refined');
      if (after.json !== before.json) throw new Error('the tile survived its own undo');
    },
  },
  {
    name: 'grid-reference-is-refused-once-drawn',
    what: 'the grid will not re-phase itself under a plan somebody has already drawn',
    async run(d) {
      await d.pick('overlay');
      await d.page.evaluate(`window.app.editor.setOverlayMode('origin'); 1`);
      await d.assertClear([[140, 100]]);
      await d.click(140, 100);
    },
    // The whole safety of the feature: moving the grid under an existing plan
    // takes every room off it, and there is no gesture that puts it back.
    expect: ({ before, after, status }) => {
      if (after.json !== before.json) throw new Error('a locked grid moved anyway');
      if (!/empty plan|first floor or wall/.test(status)) {
        throw new Error(`no refusal offered: ${status}`);
      }
    },
  },
  // ---------- Phase 26: putting things in, and taking them out again ----------
  //
  // Five checks against four sentences of feedback: *"we need a way to delete
  // placed walls, staircases, elevators"*, *"I'd like to be able to place
  // doors on existing walls — same with windows"*, *"walking mode still does
  // not respond to WASD"*, and *"I'd also like to select a starting point"*.
  // They are driven here rather than reasoned about in the pure suite because
  // every one of them is a gesture: the arithmetic underneath all four was
  // already right, and every one of the four was reported as broken anyway.
  {
    name: 'door-on-a-drawn-wall',
    what: 'a wall drawn between two points takes a door, then a window',
    async run(d) {
      await d.pick('wall');
      await d.assertClear([[36, 56], [76, 56]]);
      await d.click(36, 56);
      await d.click(76, 56);
      await d.page.keyboard.press('Escape');       // end the run, keep the wall
      const drawn = await d.fp();
      await d.pick('door');
      await d.page.evaluate(`window.app.editor.setDoorKind('single'); 1`);
      await d.click(48, 56);
      const doored = await d.fp();
      await d.page.evaluate(`window.app.editor.setDoorKind('window'); 1`);
      await d.click(64, 56);
      return { drawn, doored };
    },
    expect: ({ ctx, after, status }) => {
      if (ctx.drawn.walls <= 0) throw new Error('the wall tool drew no free-standing wall');
      if (ctx.doored.lineOpenings <= ctx.drawn.lineOpenings) {
        throw new Error('a click on the drawn wall cut no door into it');
      }
      if (after.lineOpenings <= ctx.doored.lineOpenings) {
        throw new Error('a click on the drawn wall cut no window into it');
      }
      if (!/cut into a .* wall/.test(status)) {
        throw new Error(`the window said nothing about the wall it went in: ${status}`);
      }
    },
  },
  {
    name: 'door-with-nothing-under-it',
    what: 'a door click that lands on no wall says so instead of doing nothing',
    async run(d) {
      await d.pick('door');
      await d.assertClear([[36, 40]]);
      await d.click(36, 40);
    },
    expect: ({ before, after, status }) => {
      if (after.json !== before.json) throw new Error('a miss changed the design');
      if (!/no wall there/i.test(status)) {
        throw new Error(`a missed door click said nothing: ${status}`);
      }
    },
  },
  {
    name: 'erase-anything',
    what: 'one eraser click deletes a wall, a stair and a piece of furniture',
    async run(d) {
      // A wall of its own to take away, well clear of everything else drawn.
      await d.pick('wall');
      await d.assertClear([[36, 72], [76, 72]]);
      await d.click(36, 72);
      await d.click(76, 72);
      await d.page.keyboard.press('Escape');
      const withWall = await d.fp();

      await d.pick('erase');
      await d.click(56, 72);
      const noWall = await d.fp();

      // A stair, placed by its own tool and deleted by the eraser — which is
      // the whole point: you should not have to remember which tool made it.
      await d.pick('stair');
      await d.assertClear([[100, 56]]);
      await d.click(100, 56);
      const withStair = await d.fp();
      await d.pick('erase');
      await d.click(100, 56);
      const noStair = await d.fp();

      await d.pick('prop');
      await d.page.evaluate(`window.app.editor.setPropType('student-desk'); 1`);
      await d.assertClear([[108, 20]]);
      await d.click(108, 20);
      const withProp = await d.fp();
      await d.pick('erase');
      await d.click(108, 20);
      return { withWall, noWall, withStair, noStair, withProp };
    },
    expect: ({ ctx, after, status }) => {
      if (ctx.noWall.walls >= ctx.withWall.walls) {
        throw new Error('the eraser left the free-standing wall standing');
      }
      if (ctx.withStair.links <= ctx.noWall.links) throw new Error('no stair was placed to erase');
      if (ctx.noStair.links >= ctx.withStair.links) {
        throw new Error('the eraser left the staircase where it was');
      }
      if (ctx.withProp.props <= ctx.noStair.props) throw new Error('no prop was placed to erase');
      if (after.props >= ctx.withProp.props) throw new Error('the eraser left the furniture');
      if (!/Deleted —/.test(status)) throw new Error(`the eraser said nothing: ${status}`);
    },
  },
  {
    name: 'walk-moves',
    what: 'a frame with a movement key held spends the whole of its own elapsed time',
    async run(d) {
      // Ghost mode, so what is being measured is the timestep rather than the
      // furniture: a walker who bumps into a desk has still walked.
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(600);
      await d.page.evaluate(`document.getElementById('walk-start').click(); 1`);
      await d.page.waitForTimeout(1200);
      await d.page.keyboard.press('KeyF');
      await d.page.waitForTimeout(300);
      // **What is asserted, and why it is not distance over wall-clock time.**
      // A CI runner rasterizing a whole school in software can take *five
      // seconds* to draw one frame, and no timestep can hand back movement in
      // a frame that never ran — so "did you walk 36ft in three seconds" is a
      // question about the rasterizer, not about the walker.
      //
      // The walker's own promise is per frame: given a frame that really took
      // `wall` seconds with a movement key held, spend `min(wall, 0.5)` of
      // them at walking pace. That is exactly what was broken — every frame
      // spent a tenth of a second however long it took — and it is true or
      // false in one frame, at any frame rate.
      //
      // `wall` is timed here rather than read off the argument on purpose.
      // The argument *was* the bug: the page's loop handed the walker
      // `min(delta, 0.1)`, so a harness that trusted it would have measured a
      // tenth of a second, found a tenth of a second's movement, and declared
      // the starved walker healthy.
      await d.page.evaluate(`(() => {
        const w = window.app.walk;
        const inner = w.update.bind(w);
        window.__log = [];
        window.__last = performance.now();
        w.update = (dt) => {
          const now = performance.now();
          const wall = (now - window.__last) / 1000;
          window.__last = now;
          const p = window.app.renderApi.walkCamera.position;
          const x0 = p.x, z0 = p.z;
          const out = inner(dt);
          window.__log.push({ wall, gone: Math.hypot(p.x - x0, p.z - z0) });
          return out;
        };
      })(); 1`);
      const leg = async (key, ms) => {
        await d.page.evaluate('window.__log.length = 0; 1');
        await d.page.keyboard.down(key);
        await d.page.waitForTimeout(ms);
        await d.page.keyboard.up(key);
        return d.page.evaluate('window.__log');
      };
      // Long holds: at a fifth of a frame a second, a short one can end
      // inside the frame it started in and measure nothing at all.
      const w = await leg('KeyW', 4000);
      // ...and the arrows are the same four keys.
      const left = await leg('ArrowLeft', 4000);
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(600);
      return { w, left };
    },
    expect: ({ ctx }) => {
      for (const [name, frames] of [['W', ctx.w], ['the left arrow', ctx.left]]) {
        const moved = frames.filter((f) => f.gone > 0.01);
        if (!moved.length) {
          throw new Error(
            `${name} held across ${frames.length} frames moved the camera in none of them`);
        }
        for (const f of moved) {
          // 12 ft/s is the walking speed; 0.5s is the walker's catch-up bound.
          const owed = 12 * Math.min(f.wall, 0.5);
          if (f.gone < owed * 0.6) {
            throw new Error(
              `a ${f.wall.toFixed(2)}s frame with ${name} held moved ${f.gone.toFixed(1)}ft, ` +
              `not the ${owed.toFixed(1)}ft it was owed. The timestep is starving the walker.`);
          }
        }
      }
    },
  },
  {
    // Phase 40: the chair. The toggle is a walkthrough-only key with a button
    // behind it, and the promise is three-fold — the eye drops, the feet stay
    // where they were, and the HUD says so — none of which a pure suite can
    // see, because the eye is the camera and the HUD is the page.
    name: 'walk-seated',
    what: 'Z sits the walker in the chair, keeps the feet put, and the HUD says so',
    async run(d) {
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(600);
      await d.page.evaluate(`document.getElementById('walk-start').click(); 1`);
      await d.page.waitForTimeout(1200);
      const read = `(() => ({
        on: window.app.walk.seated,
        eye: window.app.walk.eyeH,
        y: window.app.renderApi.walkCamera.position.y,
        hud: document.getElementById('walk-hud').textContent,
        btn: document.getElementById('walk-seated').getAttribute('aria-pressed'),
      }))()`;
      const before = await d.page.evaluate(read);
      await d.page.keyboard.press('KeyZ');
      await d.page.waitForTimeout(500);
      const seated = await d.page.evaluate(read);
      await d.page.keyboard.press('KeyZ');
      await d.page.waitForTimeout(500);
      const up = await d.page.evaluate(read);
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(600);
      return { before, seated, up };
    },
    expect: ({ ctx }) => {
      if (ctx.before.on) throw new Error('the walk started seated');
      if (!ctx.seated.on) throw new Error('Z did not sit the walker down');
      if (!(ctx.seated.eye < ctx.before.eye)) {
        throw new Error(`the seated eye is ${ctx.seated.eye}ft; standing was ${ctx.before.eye}ft`);
      }
      const feetBefore = ctx.before.y - ctx.before.eye;
      const feetAfter = ctx.seated.y - ctx.seated.eye;
      if (Math.abs(feetBefore - feetAfter) > 0.05) {
        throw new Error(`sitting down moved the feet from ${feetBefore.toFixed(2)} to ${feetAfter.toFixed(2)}`);
      }
      if (!/seated/.test(ctx.seated.hud)) throw new Error(`the HUD says "${ctx.seated.hud}"`);
      if (ctx.seated.btn !== 'true') throw new Error('the overlay button did not follow the key');
      if (ctx.up.on || ctx.up.eye !== ctx.before.eye || ctx.up.btn !== 'false') {
        throw new Error('Z again did not stand the walker back up');
      }
    },
  },
  {
    name: 'walk-start-point',
    what: 'a chosen start point is where the next walk begins',
    async run(d) {
      // The overlay fills the list when it opens, so walk first and read after.
      // The last entry is the smallest room on the storey — precisely the one
      // the default "biggest room" rule would never choose.
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(600);
      const sel = await d.page.evaluate(`(() => {
        const el = document.getElementById('walk-spawn-room');
        const last = el.options[el.options.length - 1];
        el.value = last.value;
        el.dispatchEvent(new Event('change'));
        return last.value;
      })()`);
      await d.page.waitForTimeout(400);
      const spawn = await d.page.evaluate(`(() => {
        const s = window.app.state;
        return s.floors[s.currentFloor].spawn || null;
      })()`);
      const cam = await d.page.evaluate(
        `(() => { const p = window.app.renderApi.walkCamera.position; return [p.x, p.z]; })()`);
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(500);
      return { sel, spawn, cam };
    },
    expect: ({ ctx }) => {
      if (!ctx.spawn) throw new Error('choosing a room in the overlay recorded no start point');
      const off = Math.hypot(ctx.cam[0] - ctx.spawn.x, ctx.cam[1] - ctx.spawn.z);
      if (off > 1) {
        throw new Error(
          `the walk stands ${off.toFixed(1)}ft from the start point it was told to use`);
      }
    },
  },
  {
    name: 'baked-light',
    what: 'entering a walk bakes the light in a worker, and the editor takes it off again',
    async run(d) {
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      // The bake runs in a module worker and lands whenever it lands — poll
      // the renderer rather than the clock. Ten seconds is an eternity for a
      // building this size; on a hit in IndexedDB it is one lap.
      let worn = false;
      for (let i = 0; i < 40 && !worn; i++) {
        await d.page.waitForTimeout(250);
        worn = await d.page.evaluate('window.app.renderApi.bakeWorn');
      }
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(400);
      const shed = await d.page.evaluate('window.app.renderApi.bakeWorn');
      return { worn, shed };
    },
    expect: ({ ctx }) => {
      if (!ctx.worn) throw new Error('the walk never wore a bake — worker, store or key broke');
      if (ctx.shed) throw new Error("the drafting board is wearing the walk's bake");
    },
  },
  {
    name: 'crowd-talks',
    what: 'a walk with the crowd on runs the murmur wiring, and people pair up to chat',
    async run(d) {
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(400);
      const on = await d.page.evaluate('window.app.lifeStart()');
      // Everyone willing to stop right now, so the check waits on the pairing
      // logic rather than on the seeded cooldowns.
      await d.page.evaluate(
        'window.app.life.agents.forEach((a) => { a.chatIn = 0; }); 1');
      let chatting = 0;
      for (let i = 0; i < 40 && !chatting; i++) {
        await d.page.waitForTimeout(250);
        chatting = await d.page.evaluate(
          `window.app.life.agents.filter((a) => a.state === 'chat').length`);
      }
      await d.page.evaluate('window.app.lifeStop(); 1');
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(400);
      return { on, chatting };
    },
    expect: ({ ctx }) => {
      if (!ctx.on) throw new Error('the crowd never started — the drawn school has no teaching rooms');
      if (!ctx.chatting) throw new Error('ten seconds of willing people produced no conversation');
      if (ctx.chatting % 2) throw new Error(`chats come in pairs, not ${ctx.chatting}`);
    },
  },
  {
    name: 'weather',
    what: 'one click of rain thickens the deck and wets the ground; the same click clears it',
    async run(d) {
      const btn = `document.querySelector('#env-weather button[data-weather="rain"]')`;
      await d.page.evaluate(`${btn}.click(); 1`);
      await d.page.waitForTimeout(300);
      const rec = await d.page.evaluate('window.app.state.weather || null');
      const wx = await d.page.evaluate(`(() => {
        const w = window.app.renderApi.weather;
        return { kind: w.kind, wet: w.wet, cover: w.cover, fall: w.fall ? w.fall.kind : null };
      })()`);
      // Into the walk and back: the falling half belongs there, and the real
      // point of the lap is that the precip shaders and the weatherized
      // ground compile clean on the page (a GLSL error lands in pageErrors).
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(900);
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(400);
      await d.page.evaluate(`${btn}.click(); 1`);
      await d.page.waitForTimeout(200);
      const cleared = await d.page.evaluate('window.app.state.weather || null');
      return { rec, wx, cleared };
    },
    expect: ({ ctx }) => {
      if (!ctx.rec || ctx.rec.kind !== 'rain') {
        throw new Error('clicking the rain button wrote no weather record');
      }
      if (!(ctx.wx.wet > 0)) throw new Error('rain left the paving dry');
      if (!(ctx.wx.cover > 0.7)) throw new Error(`rain under a fair-weather deck (cover ${ctx.wx.cover})`);
      if (ctx.wx.fall !== 'rain') throw new Error('nothing scheduled to fall');
      if (ctx.cleared) throw new Error('the same click did not put the sky back');
    },
  },
  {
    name: 'signage',
    what: 'rooms sign themselves, the way out glows, and the glass refracts only for a photograph',
    // Phase 31's four claims on the real page, because every one of them is a
    // fact about the *scene* rather than about the state: signage.js and
    // relief.js are proved arithmetically by their own suites, and nothing
    // there can tell you whether a plate ended up on a wall.
    async run(d) {
      // The building the earlier checks drew, plus a room whose name asks for
      // privacy — which is the only way a frosted material is ever built.
      await d.pick('room');
      const sh = (await d.shapes())[0];
      const [cx, cz] = d.centre(sh);
      await d.page.evaluate(`window.app.editor.setRoom('Girls Restroom', '#88aacc'); 1`);
      await d.assertClear([[cx, cz]]);
      await d.click(cx, cz);
      await d.page.waitForTimeout(400);

      const editing = await d.page.evaluate('window.app.renderApi.signReport()');
      // Into the walk: the exit signs arrive there, and the glass does *not*
      // start refracting — see the shutter, below.
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(1200);
      const walking = await d.page.evaluate('window.app.renderApi.signReport()');
      // Open the shutter: refraction is a photo-mode luxury, because a
      // transmissive material costs a second scene render and that more than
      // doubles the cost of a walk on a fill-bound machine. Measured, not
      // guessed — 547ms to 1,186ms a frame on the rasterizer this harness
      // runs on, which is why `walk-moves` went red the one time it wasn't.
      await d.page.evaluate('window.app.renderApi.setPhoto({ on: true })');
      await d.page.waitForTimeout(1500);
      const shooting = await d.page.evaluate('window.app.renderApi.signReport()');
      await d.page.evaluate('window.app.renderApi.setPhoto({ on: false })');
      await d.page.waitForTimeout(800);
      const shutClosed = await d.page.evaluate('window.app.renderApi.signReport()');
      // ...and the relief. Counted off the live scene rather than off the
      // module, so a map that was built and never attached fails here.
      //
      // The population asked about is *the surfaces that already carried a
      // sheen map* — floors, finishes and walls, the three that have a
      // `roughnessMap` — because those are exactly the ones Phase 20 gave a
      // roughness and did not give a shape. A sign, a sprite, the sky and the
      // contact blob are textured too and have no business with either.
      const relief = await d.page.evaluate(`(() => {
        const out = { flat: [], maps: 0 };
        const seen = new Set(), normals = new Set();
        window.app.renderApi.scene.traverse((o) => {
          const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of list) {
            if (seen.has(m.uuid)) continue;
            seen.add(m.uuid);
            if (m.normalMap) normals.add(m.normalMap.uuid);
            if (m.roughnessMap && !m.normalMap) out.flat.push(m.type);
          }
        });
        out.maps = normals.size;
        return out;
      })()`);
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(600);
      const back = await d.page.evaluate('window.app.renderApi.signReport()');
      return { editing, walking, shooting, shutClosed, back, relief };
    },
    expect: ({ ctx }) => {
      const { editing, walking, shooting, shutClosed, back, relief } = ctx;
      if (!(editing.placards > 0)) {
        throw new Error('a building full of named rooms put no plate on any door');
      }
      // The lazy half, and the reason it is lazy: building the egress graph on
      // every wall drag is twenty milliseconds the drawing board should not
      // pay for a sign nobody is at eye level to read.
      if (editing.exits !== 0) throw new Error('the drawing board built the egress graph');
      if (!(walking.exits > 0)) throw new Error('the walk found no way out to sign');
      // The cost rule, from both sides. An ordinary walk must not be paying
      // for a second scene render; a photograph must be.
      if (walking.refracting) {
        throw new Error('an ordinary walk is paying for the transmission pass');
      }
      if (!shooting.refracting) throw new Error('photo mode did not refract the glass');
      if (shutClosed.refracting) throw new Error('closing the shutter left transmission on');
      if (back.refracting) throw new Error('the drawing board is still paying for transmission');
      if (!walking.glazings.includes('frosted')) {
        throw new Error(`a restroom did not frost its glass: ${walking.glazings.join(', ')}`);
      }
      if (relief.flat.length) {
        throw new Error(`${relief.flat.length} surfaces have a sheen map and no shape: ` +
          relief.flat.slice(0, 4).join(', '));
      }
      // Floors, walls and ground at the very least, each its own family.
      if (relief.maps < 3) throw new Error(`only ${relief.maps} relief maps are in the scene`);
    },
  },
  {
    name: 'undo-redo',
    what: 'undo and redo round-trip the design byte for byte',
    async run(d) {
      const at = (await d.fp()).json;
      for (let i = 0; i < 6; i++) await d.page.evaluate('window.app.editor.undo(); 1');
      await d.page.waitForTimeout(300);
      const undone = (await d.fp()).json;
      for (let i = 0; i < 6; i++) await d.page.evaluate('window.app.editor.redo(); 1');
      await d.page.waitForTimeout(300);
      return { at, undone };
    },
    expect: ({ ctx, after }) => {
      if (ctx.undone === ctx.at) throw new Error('six undos changed nothing');
      if (after.json !== ctx.at) {
        throw new Error(`redo landed on ${after.json} bytes, not the ${ctx.at} it started from`);
      }
    },
  },
  // ---------- Phase 42: what arrives when it is asked for ----------
  //
  // The other half of the budget: a module kept out of the boot is only a
  // saving if it still turns up when its button is pressed. Each of these
  // presses the button and watches the network.
  {
    name: 'report-on-demand',
    what: 'the report panel fetches the analysis the first time it opens, and builds',
    async run(d) {
      const since = performance.now();
      const loaded = await d.page.evaluate('window.app.analysisLoaded');
      await d.page.evaluate(`document.getElementById('report-btn').click(); 1`);
      await d.page.waitForFunction(
        'window.app.analysisLoaded && !window.app.report.stale && !!window.app.report.data',
        { timeout: 90000 });
      const findings = await d.page.evaluate(
        `document.querySelectorAll('#report-findings .finding').length`);
      const verdict = await d.page.evaluate(
        `document.getElementById('report-verdict').textContent`);
      await d.page.evaluate(`document.getElementById('report-btn').click(); 1`);
      await settleResponses();
      return { loaded, findings, verdict, modules: modulesFetched(since) };
    },
    expect: ({ ctx }) => {
      if (ctx.loaded) throw new Error('the analysis was loaded before anybody opened the report');
      for (const m of ['report', 'egress', 'daylight', 'cost', 'spec', 'utilisation', 'takeoff', 'rates', 'phasing']) {
        if (!ctx.modules.has(m)) throw new Error(`opening the report did not fetch ${m}.js`);
      }
      if (!ctx.findings && !/Passes every check/.test(ctx.verdict)) {
        throw new Error(`the report built but says "${ctx.verdict}" with no findings`);
      }
    },
  },
  {
    name: 'cost-on-demand',
    what: 'the cost sheet opens with its currencies and rate rows once its modules land',
    async run(d) {
      await d.page.evaluate(`document.getElementById('cost-open').click(); 1`);
      await d.page.waitForFunction(
        `!document.getElementById('cost-overlay').classList.contains('hidden')`, { timeout: 60000 });
      const rows = await d.page.evaluate(`document.querySelectorAll('#cost-rows .rate-row').length`);
      const currencies = await d.page.evaluate(`document.getElementById('cost-currency').options.length`);
      await d.page.evaluate(`document.getElementById('cost-close').click(); 1`);
      await d.page.waitForTimeout(200);
      return { rows, currencies };
    },
    expect: ({ ctx }) => {
      if (ctx.currencies < 1) throw new Error('the currency list is empty — it is filled from rates.js on first open');
      if (ctx.rows < 10) throw new Error(`${ctx.rows} rate rows — the sheet did not render its assemblies`);
    },
  },
  {
    name: 'minimap-on-demand',
    what: 'walk mode fetches the plan builder and the minimap fills its plan cache',
    async run(d) {
      const since = performance.now();
      await d.page.evaluate(`document.getElementById('mode-btn').click(); 1`);
      await d.page.waitForTimeout(600);
      await d.page.evaluate(`document.getElementById('walk-start').click(); 1`);
      await d.page.waitForFunction('window.app.miniPlanned > 0', { timeout: 90000 });
      const planned = await d.page.evaluate('window.app.miniPlanned');
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(600);
      await settleResponses();
      // The report's tail imports blueprint.js too (the takeoff measures
      // areas off the plan), so an earlier check may already have fetched
      // it; what has to hold is that the boot did not, and the map has it.
      return { planned, modules: modulesFetched(since), everFetched: modulesFetched() };
    },
    expect: ({ ctx }) => {
      if (bootLoad && bootLoad.modules.has('blueprint')) throw new Error('blueprint.js was in the boot');
      if (!ctx.everFetched.has('blueprint')) throw new Error('nothing fetched blueprint.js');
      if (ctx.planned < 1) throw new Error('the minimap never filled a plan');
    },
  },
  {
    name: 'session-on-demand',
    what: 'the Session panel fetches the session stack the first time it opens',
    async run(d) {
      const since = performance.now();
      const loaded = await d.page.evaluate('window.app.netLoaded');
      await d.page.evaluate(`document.getElementById('session-btn').click(); 1`);
      await d.page.waitForFunction('window.app.netLoaded', { timeout: 60000 });
      await d.page.waitForTimeout(200);
      const text = await d.page.evaluate(`document.getElementById('session-state').textContent`);
      await d.page.evaluate(`document.getElementById('session-btn').click(); 1`);
      await settleResponses();
      return { loaded, text, modules: modulesFetched(since) };
    },
    expect: ({ ctx }) => {
      if (ctx.loaded) throw new Error('the session stack was loaded before anybody opened the panel');
      for (const m of ['session', 'presence', 'wire', 'cloud']) {
        if (!ctx.modules.has(m)) throw new Error(`opening the panel did not fetch ${m}.js`);
      }
      if (!/Not in a session/.test(ctx.text)) throw new Error(`the panel says "${ctx.text}"`);
    },
  },
  // ---------- Phase 30 ----------
  //
  // Deliberately last. The lessons draw on the sheet and the gallery replaces
  // the design outright, and neither is a state the checks above should have
  // to be written around.
  {
    name: 'show-me',
    what: 'every lesson in the palette draws, on the real canvas, what it claims to draw',
    async run(d) {
      // The claim is read out of demo.js, not restated here — that is what
      // makes the tutorial and the smoke test one artifact rather than two
      // that agree until they don't.
      const demos = await d.page.evaluate('window.__demos()');
      if (!demos.length) throw new Error('the palette offers no lessons');
      const runs = [];
      for (const demo of demos) {
        const before = await d.fp();
        const started = await d.page.evaluate(`!!window.app.demoStart(${JSON.stringify(demo.id)})`);
        if (!started) throw new Error(`${demo.id} would not start`);
        await d.page.waitForFunction('!window.app.demoing', { timeout: demo.duration + 30000 });
        await d.page.waitForTimeout(700);
        runs.push({ demo, before, after: await d.fp(), status: await d.status() });
      }
      // ...and Escape gives the pointer back mid-gesture, which is the one
      // thing a person watching something move on its own will reach for.
      await d.page.evaluate(`window.app.demoStart(${JSON.stringify(demos[0].id)}); 1`);
      await d.page.waitForTimeout(900);
      const during = await d.page.evaluate('window.app.demoing');
      await d.page.keyboard.press('Escape');
      await d.page.waitForTimeout(400);
      const stopped = !(await d.page.evaluate('window.app.demoing'));
      const ghostGone = await d.page.evaluate(
        `document.getElementById('ghost').classList.contains('hidden')`);
      return { runs, during, stopped, ghostGone };
    },
    expect: ({ ctx }) => {
      for (const { demo, before, after, status } of ctx.runs) {
        for (const [key, delta] of Object.entries(demo.changes)) {
          const got = after[key] - before[key];
          if (got < delta) {
            throw new Error(
              `${demo.id} claims ${key} +${delta} and drew ${key} +${got} — `
              + `the lesson has rotted (status: ${status})`);
          }
        }
      }
      if (!ctx.during) throw new Error('a lesson ended before Escape could reach it');
      if (!ctx.stopped) throw new Error('Escape did not give the pointer back');
      if (!ctx.ghostGone) throw new Error('the ghost is still on screen');
    },
  },
  {
    name: 'gallery',
    what: 'the welcome fills with three embedded schools and one click walks into one',
    async run(d) {
      await d.page.evaluate('window.app.openWelcome(); 1');
      await d.page.waitForFunction(
        `document.querySelectorAll('#welcome-gallery .card').length === 3`, { timeout: 60000 });
      const titles = await d.page.evaluate(
        `[...document.querySelectorAll('#welcome-gallery .card b')].map((b) => b.textContent)`);
      // The thumbnails are geometry, not images: a card with no paths in it
      // shipped a picture of nothing.
      const paths = await d.page.evaluate(
        `document.querySelectorAll('#welcome-gallery .thumb path').length`);
      const facts = await d.page.evaluate(
        `[...document.querySelectorAll('#welcome-gallery .facts')].map((f) => f.textContent)`);
      await d.page.evaluate(`document.querySelector('#welcome-gallery .card').click(); 1`);
      await d.page.waitForFunction(
        `window.app.file && window.app.file.source === 'card'`, { timeout: 90000 });
      await d.page.waitForTimeout(2500);
      const mode = await d.page.evaluate('document.body.dataset.mode');
      const after = await d.fp();
      await d.page.evaluate(`document.getElementById('walk-exit').click(); 1`);
      await d.page.waitForTimeout(600);
      return { titles, paths, facts, mode, after };
    },
    expect: ({ ctx }) => {
      if (new Set(ctx.titles).size !== 3) {
        throw new Error(`three cards, ${new Set(ctx.titles).size} names: ${ctx.titles.join(', ')}`);
      }
      if (ctx.paths < 30) throw new Error(`only ${ctx.paths} rooms drawn across three thumbnails`);
      for (const f of ctx.facts) {
        if (!/\d+ rooms on \w+ storeys? · [\d,]+ sq ft/.test(f)) {
          throw new Error(`a card counted nothing: "${f}"`);
        }
      }
      if (ctx.mode !== 'walk') throw new Error(`a card landed in ${ctx.mode}, not in a walk`);
      if (ctx.after.shapes < 20) {
        throw new Error(`the card opened a design with ${ctx.after.shapes} rooms on the storey`);
      }
    },
  },
  {
    name: 'document',
    what: 'the design is a document: opening one is clean, editing it is not, and the title says so',
    async run(d) {
      // Runs straight after `gallery`, which has just adopted a card — a
      // design that arrived, has a name, and has been edited by nobody.
      const opened = await d.page.evaluate(
        '({ title: document.title, dirty: window.app.file.dirty, name: window.app.file.name,'
        + ' source: window.app.file.source, world: window.app.fileWorld })');
      // An edit with no aim in it: the same rain button the weather check
      // proves, so this check is about the file session rather than about
      // hitting a canvas under a panel.
      await d.page.evaluate(
        `document.querySelector('#env-weather button[data-weather="rain"]').click(); 1`);
      await d.page.waitForTimeout(400);
      const edited = await d.page.evaluate(
        '({ title: document.title, dirty: window.app.file.dirty })');
      await d.page.evaluate(
        `document.querySelector('#env-weather button[data-weather="rain"]').click(); 1`);
      await d.page.waitForTimeout(200);
      return { opened, edited };
    },
    expect: ({ ctx }) => {
      if (ctx.opened.source !== 'card') throw new Error(`the session says ${ctx.opened.source}`);
      if (ctx.opened.dirty) throw new Error('a design nobody has edited is already dirty');
      if (!ctx.opened.name) throw new Error('the opened card left the document unnamed');
      if (!ctx.opened.title.startsWith(ctx.opened.name)) {
        throw new Error(`the title bar says "${ctx.opened.title}", not "${ctx.opened.name}"`);
      }
      if (!ctx.edited.dirty) throw new Error('an edit did not reach the file session');
      if (!/^• /.test(ctx.edited.title)) {
        throw new Error(`the title bar does not mark the unsaved design: "${ctx.edited.title}"`);
      }
      if (!['direct', 'download'].includes(ctx.opened.world)) {
        throw new Error(`the file world is "${ctx.opened.world}"`);
      }
    },
  },
  {
    name: 'offline',
    what: 'the page registers its worker, it takes control, and the vendored libs are in its cache',
    async run(d) {
      // 127.0.0.1 is a secure context, so the registration this page makes at
      // boot is the real one — not a stub the harness arranges.
      await d.page.waitForFunction(
        'window.app.offline.registered || window.app.offline.error', { timeout: 60000 });
      const offline = await d.page.evaluate('({ ...window.app.offline, prompt: undefined })');
      const controlled = await d.page.waitForFunction(
        'navigator.serviceWorker.controller !== null', { timeout: 60000 })
        .then(() => true).catch(() => false);
      const cached = await d.page.evaluate(`(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names.find((n) => n.startsWith('school-generator-')));
        const keys = await cache.keys();
        return { names, urls: keys.map((r) => new URL(r.url).pathname) };
      })()`);
      return { offline, controlled, cached };
    },
    expect: ({ ctx }) => {
      if (ctx.offline.error) throw new Error(`registration failed: ${ctx.offline.error}`);
      if (!ctx.offline.registered) throw new Error('the worker never registered');
      if (!ctx.controlled) throw new Error('the worker registered but never took control');
      if (!ctx.cached.names.some((n) => n.startsWith('school-generator-'))) {
        throw new Error(`no cache of this tool's own: ${ctx.cached.names.join(', ')}`);
      }
      // The complaint this phase closes: `libs/` cached hard, by the worker's
      // own revision rather than by a version in the path.
      if (!ctx.cached.urls.some((u) => u.includes('/libs/three.module.js'))) {
        throw new Error('three.js is not in the cache, which was the whole point');
      }
    },
  },
];

// ---------- main ----------

const pw = await loadPlaywright();
if (!pw) {
  console.log('playwright is not installed — the tool harness needs it.');
  console.log('It is optional tooling: `npm i -g playwright && npx playwright install chromium`,');
  console.log('or run in an environment that already has it. The pure suite does not need it.');
  process.exit(2);
}

const server = await startServer();
const port = server.address().port;
const browser = await pw.chromium.launch({
  headless: !HEADED,
  // Software rendering is the norm on a CI runner, and the tools do not care
  // which rasterizer drew the frame they were aimed at.
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
let pageErrors = [];

// Each check reports the moment it lands. The whole run takes minutes on a
// software rasterizer, and a job that prints nothing for that long is
// indistinguishable from a hung one.
function record(r) {
  results.push(r);
  console.log(`${r.status === 'FAIL' ? '✗' : '✓'} ${r.name}: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  // A fresh context is a first visit, and a first visit gets the opening
  // moment (Phase 19) over the top of everything. Seed it away.
  await context.addInitScript(`try { localStorage.setItem('sg-welcome-seen', '1'); } catch {}`);
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });

  watchResponses(page);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  // Not networkidle: the page settles long before the scene finishes building,
  // and `window.app` is the only honest signal that the editor exists.
  await page.waitForFunction('window.app && window.app.state && window.app.renderApi',
    { timeout: 120000 });
  await page.waitForTimeout(1500);
  // Phase 42: everything fetched to this point is the boot.
  await settleResponses();
  bootLoad = {
    requests: fetched.length,
    bytes: fetched.reduce((n, e) => n + e.bytes, 0),
    jsBytes: fetched.filter((e) => /\.js$/.test(e.path)).reduce((n, e) => n + e.bytes, 0),
    modules: modulesFetched(),
  };
  console.log(`  boot: ${bootLoad.requests} requests, ${Math.round(bootLoad.bytes / 1024)} KB ` +
    `(${Math.round(bootLoad.jsBytes / 1024)} KB of JavaScript, ${bootLoad.modules.size} modules)`);
  await page.evaluate(HELPERS);

  record(pageErrors.length
    ? { name: 'boot', status: 'FAIL', detail: pageErrors.join(' | ') }
    : { name: 'boot', status: 'ok', detail: 'no page or console errors' });

  const d = makeDriver(page);
  for (const check of CHECKS) {
    if (only && !only.has(check.name)) continue;
    pageErrors = [];
    const before = await d.fp();
    try {
      const ctx = await withDeadline(check.run(d), CHECK_DEADLINE, check.name);
      const after = await d.fp();
      const status = await d.status();
      await check.expect({ before, after, status, ctx, d });
      if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
      record({ name: check.name, status: 'ok', detail: check.what });
    } catch (e) {
      record({
        name: check.name, status: 'FAIL',
        detail: `${String(e.message || e)}${pageErrors.length ? ` | ${pageErrors.join(' | ')}` : ''}`,
      });
    }
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
if (!results.length) console.log(only ? `no check named ${[...only].join(', ')}` : 'nothing driven');
else if (failed.length) {
  console.log(`\n${failed.length} of ${results.length} failed: ${failed.map((r) => r.name).join(', ')}`);
} else {
  console.log(`\nall ${results.length} passed`);
}
process.exit(failed.length ? 1 : 0);
