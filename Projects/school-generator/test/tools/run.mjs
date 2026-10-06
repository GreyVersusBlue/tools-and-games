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

// The page draws at this many device pixels per CSS pixel. See where the
// context is made for what it buys; `--headed` keeps 1, because a person
// watching wants to see the school and not a quarter of its pixels.
const RASTER_SCALE = process.argv.includes('--headed') ? 1 : 0.5;

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
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json',
  // Phase 30: the app manifest, so the install path is served the way a real
  // host serves it rather than as a blob the browser declines to parse.
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    // The site's /assets/ is the repo's; the Blender pack's is this project's.
    const file = p.startsWith('/assets/') && !p.startsWith('/assets/models/')
      ? join(REPO, p) : join(PROJECT, p);
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
  'snapshots', 'designdiff',                                     // Phase 34: the history
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
    name: 'builtin-pack',
    what: 'the Blender files the sample school\'s props name were fetched, and nothing failed loudly',
    async run(d) {
      // The page fetches them after its first draw; give that a few seconds.
      return d.page.evaluate(`(async () => {
        const { catalogEntry } = await import('./js/catalog.js');
        const want = [...new Set(window.app.state.props
          .map((p) => catalogEntry(p.type)).filter((e) => e && e.file).map((e) => e.file))];
        for (let i = 0; i < 50; i++) {
          const have = window.app.renderApi.builtinModelIds;
          if (want.every((id) => have.includes(id))) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        return { want, have: window.app.renderApi.builtinModelIds };
      })()`);
    },
    expect: ({ ctx }) => {
      if (!ctx.want.length) throw new Error('the sample school has no prop that names a file to check');
      const missing = ctx.want.filter((id) => !ctx.have.includes(id));
      if (missing.length) throw new Error(`never fetched: ${missing.join(', ')}`);
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
  // ---------- #823: a wall has two faces ----------
  //
  // finish.test.mjs proves which room each face of a run belongs to. Nothing
  // in Node can say whether render.js then wrote that colour onto *that* face
  // of the box: `addOriented` turns a box built along +X, and the claim that
  // its +Z face ends up on the run's left is a claim about three.js. So this
  // reads the triangles back out of the scene and asks each one which way it
  // faces and what colour it is.
  {
    name: 'wall-faces',
    what: 'a partition between a red room and a blue one is red on one face and blue on the other',
    async run(d) {
      return d.page.evaluate(`(async () => {
        const THREE = await import('three');
        const { shapesOf, shapeAt, isBuilt, SEG_WALL } = await import('./js/shapes.js');
        const { floorBaseY } = await import('./js/grid.js');
        const s = window.app.state, fi = s.currentFloor, floor = s.floors[fi];
        // A plain partition: built, solid, nothing cut into it, and one room
        // (the same one, end to end) in front of each face.
        let pick = null;
        for (const shape of shapesOf(floor)) {
          for (const ring of shape.rings) {
            for (let i = 0; i < ring.pts.length && !pick; i++) {
              if (ring.walls[i] !== SEG_WALL || !isBuilt(ring.walls[i])) continue;
              if (ring.openings.some((o) => o.seg === i)) continue;
              const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
              const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
              if (len < 8) continue;
              const nx = -dz / len, nz = dx / len;
              const rooms = (side) => new Set([0.1, 0.3, 0.5, 0.7, 0.9].map((t) =>
                shapeAt(floor, a.x + dx * t + nx * side * 0.3, a.z + dz * t + nz * side * 0.3)));
              const l = rooms(1), r = rooms(-1);
              if (l.size !== 1 || r.size !== 1) continue;
              const [left] = l, [right] = r;
              if (!left || !right || left === right) continue;
              pick = { a, b, dx, dz, len, nx, nz, left, right };
            }
          }
        }
        if (!pick) return { found: false };
        const { a, dx, dz, len, nx, nz, left, right } = pick;
        const was = [left.paint, right.paint];
        left.paint = '#aa0000';
        right.paint = '#0000aa';
        window.app.renderApi.buildFromState(s);
        const want = { left: new THREE.Color('#aa0000'), right: new THREE.Color('#0000aa') };
        const out = { found: true, left: { n: 0, bad: [] }, right: { n: 0, bad: [] } };
        const y0 = floorBaseY(s, fi), y1 = floorBaseY(s, fi + 1);
        window.app.renderApi.scene.traverse((o) => {
          const g = o.isMesh && o.geometry;
          if (!g || !g.attributes.color || !g.attributes.normal || !o.userData.baked) return;
          const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
          const I = g.index;
          const tris = (I ? I.count : P.count) / 3;
          for (let k = 0; k < tris; k++) {
            const tri = [0, 1, 2].map((j) => (I ? I.getX(k * 3 + j) : k * 3 + j));
            // One triangle of one long face of this wall: every corner faces
            // across the run, sits on this storey and within a wall's
            // thickness of the run's line — and the triangle lies inside the
            // run and spans most of it, which the next wall along the same
            // line does not, nor the end cap of a wall that butts into this
            // one (same normal, same place).
            const at = tri.map((i) => {
              const rx = P.getX(i) - a.x, rz = P.getZ(i) - a.z;
              return {
                i, y: P.getY(i),
                facing: N.getX(i) * nx + N.getZ(i) * nz,
                along: (rx * dx + rz * dz) / len,
                off: rx * nx + rz * nz,
              };
            });
            if (at.some((v) => v.y < y0 - 0.01 || v.y > y1 + 0.01)) continue;
            if (at.some((v) => Math.abs(v.facing) < 0.99 || Math.abs(v.off) > 0.6)) continue;
            if (at.some((v) => Math.sign(v.off) !== Math.sign(v.facing))) continue;
            const alongs = at.map((v) => v.along);
            if (Math.min(...alongs) < -0.6 || Math.max(...alongs) > len + 0.6) continue;
            if (Math.max(...alongs) - Math.min(...alongs) < len / 2) continue;
            const side = at[0].facing > 0 ? 'left' : 'right';
            const w = want[side];
            for (const v of at) {
              out[side].n++;
              const c = [C.getX(v.i), C.getY(v.i), C.getZ(v.i)];
              if (Math.abs(c[0] - w.r) + Math.abs(c[1] - w.g) + Math.abs(c[2] - w.b) > 0.003) {
                out[side].bad.push(c.map((x) => x.toFixed(3)).join(' '));
              }
            }
          }
        });
        // Put the school back the way the next check expects to find it.
        left.paint = was[0];
        right.paint = was[1];
        window.app.renderApi.buildFromState(s);
        return out;
      })()`);
    },
    expect: ({ ctx, before, after }) => {
      if (!ctx.found) throw new Error('the sample school has no plain partition between two rooms');
      for (const side of ['left', 'right']) {
        if (ctx[side].n < 6) {
          throw new Error(`found ${ctx[side].n} corners on the ${side} face, and a face is two triangles`);
        }
        if (ctx[side].bad.length) {
          throw new Error(`${ctx[side].bad.length} of ${ctx[side].n} corners on the ${side} face ` +
            `are ${ctx[side].bad[0]}, not that room's paint`);
        }
      }
      if (after.json !== before.json) throw new Error('the check left its paint on the design');
    },
  },
  // An accent wall, drawn (#827). test/accent.test.mjs proves which face of
  // which run takes the colour; this builds the scene and reads the corners
  // back, the way 'wall-faces' does, with one wall of the red room green.
  {
    name: 'accent-wall',
    what: 'a red room with one wall accented green is green on that face, and the blue room behind it is still blue',
    async run(d) {
      return d.page.evaluate(`(async () => {
        const THREE = await import('three');
        const { shapesOf, shapeAt, isBuilt, setSegAccent, SEG_WALL } = await import('./js/shapes.js');
        const { floorBaseY } = await import('./js/grid.js');
        const s = window.app.state, fi = s.currentFloor, floor = s.floors[fi];
        // The partition 'wall-faces' picks: built, solid, nothing cut into
        // it, one room in front of each face. The ring it is found on is the
        // room on its left, and that room is the one that gets the accent.
        let pick = null;
        for (const shape of shapesOf(floor)) {
          for (const ring of shape.rings) {
            for (let i = 0; i < ring.pts.length && !pick; i++) {
              if (ring.walls[i] !== SEG_WALL || !isBuilt(ring.walls[i])) continue;
              if (ring.openings.some((o) => o.seg === i)) continue;
              const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
              const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
              if (len < 8) continue;
              const nx = -dz / len, nz = dx / len;
              const rooms = (side) => new Set([0.1, 0.3, 0.5, 0.7, 0.9].map((t) =>
                shapeAt(floor, a.x + dx * t + nx * side * 0.3, a.z + dz * t + nz * side * 0.3)));
              const l = rooms(1), r = rooms(-1);
              if (l.size !== 1 || r.size !== 1) continue;
              const [left] = l, [right] = r;
              if (!left || !right || left === right || left !== shape) continue;
              pick = { a, b, dx, dz, len, nx, nz, left, right, ri: shape.rings.indexOf(ring), i };
            }
          }
        }
        if (!pick) return { found: false };
        const { a, dx, dz, len, nx, nz, left, right, ri, i: seg } = pick;
        const was = [left.paint, right.paint];
        left.paint = '#aa0000';
        right.paint = '#0000aa';
        const set = setSegAccent(left, ri, seg, '#00aa00');
        window.app.renderApi.buildFromState(s);
        const want = { left: new THREE.Color('#00aa00'), right: new THREE.Color('#0000aa') };
        // Every other wall face of the red room is still red: count the
        // green corners on the storey that are not on this wall's left face.
        const green = new THREE.Color('#00aa00');
        const out = { found: true, set, stray: 0, left: { n: 0, bad: [] }, right: { n: 0, bad: [] } };
        const y0 = floorBaseY(s, fi), y1 = floorBaseY(s, fi + 1);
        window.app.renderApi.scene.traverse((o) => {
          const g = o.isMesh && o.geometry;
          if (!g || !g.attributes.color || !g.attributes.normal || !o.userData.baked) return;
          const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
          const I = g.index;
          const tris = (I ? I.count : P.count) / 3;
          for (let k = 0; k < tris; k++) {
            const tri = [0, 1, 2].map((j) => (I ? I.getX(k * 3 + j) : k * 3 + j));
            // One triangle of one long face of this wall: every corner faces
            // across the run, sits on this storey and within a wall's
            // thickness of the run's line — and the triangle lies inside the
            // run and spans most of it, which the next wall along the same
            // line does not, nor the end cap of a wall that butts into this
            // one (same normal, same place).
            const at = tri.map((i) => {
              const rx = P.getX(i) - a.x, rz = P.getZ(i) - a.z;
              return {
                i, y: P.getY(i),
                facing: N.getX(i) * nx + N.getZ(i) * nz,
                along: (rx * dx + rz * dz) / len,
                off: rx * nx + rz * nz,
              };
            });
            if (at.some((v) => v.y < y0 - 0.01 || v.y > y1 + 0.01)) continue;
            const isGreen = (v) => Math.abs(C.getX(v.i) - green.r) + Math.abs(C.getY(v.i) - green.g) +
              Math.abs(C.getZ(v.i) - green.b) < 0.003;
            const onLeftFace = at.every((v) => v.facing > 0.99 && v.off > 0 && v.off < 0.6 &&
              v.along > -0.6 && v.along < len + 0.6);
            if (!onLeftFace) out.stray += at.filter(isGreen).length;
            if (at.some((v) => Math.abs(v.facing) < 0.99 || Math.abs(v.off) > 0.6)) continue;
            if (at.some((v) => Math.sign(v.off) !== Math.sign(v.facing))) continue;
            const alongs = at.map((v) => v.along);
            if (Math.min(...alongs) < -0.6 || Math.max(...alongs) > len + 0.6) continue;
            if (Math.max(...alongs) - Math.min(...alongs) < len / 2) continue;
            const side = at[0].facing > 0 ? 'left' : 'right';
            const w = want[side];
            for (const v of at) {
              out[side].n++;
              const c = [C.getX(v.i), C.getY(v.i), C.getZ(v.i)];
              if (Math.abs(c[0] - w.r) + Math.abs(c[1] - w.g) + Math.abs(c[2] - w.b) > 0.003) {
                out[side].bad.push(c.map((x) => x.toFixed(3)).join(' '));
              }
            }
          }
        });
        // Put the school back the way the next check expects to find it.
        setSegAccent(left, ri, seg, null);
        left.paint = was[0];
        right.paint = was[1];
        window.app.renderApi.buildFromState(s);
        return out;
      })()`);
    },
    expect: ({ ctx, before, after }) => {
      if (!ctx.found) throw new Error('the sample school has no plain partition on the ring of the room to its left');
      if (!ctx.set) throw new Error('setSegAccent refused the wall');
      for (const side of ['left', 'right']) {
        if (ctx[side].n < 6) {
          throw new Error(`found ${ctx[side].n} corners on the ${side} face, and a face is two triangles`);
        }
        if (ctx[side].bad.length) {
          throw new Error(`${ctx[side].bad.length} of ${ctx[side].n} corners on the ${side} face ` +
            `are ${ctx[side].bad[0]}, not ${side === 'left' ? 'the accent' : "that room's paint"}`);
        }
      }
      if (ctx.stray) throw new Error(`${ctx.stray} corners off the accent wall are the accent's colour`);
      if (after.json !== before.json) throw new Error('the check left its paint on the design');
    },
  },
  // A folded ramp, drawn (#825). test/ramp-fold.test.mjs proves the layout,
  // the hole and the guards as numbers; none of it can see render.js. This
  // builds a two-storey slab with a five-run ramp on it, straight into the
  // scene, and drops a ray on it from above at five places.
  {
    name: 'ramp-fold',
    what: 'a five-run ramp is drawn lane by lane, under a hole in the floor above',
    async run(d) {
      return d.page.evaluate(`(async () => {
        const THREE = await import('three');
        const { createState, addFloor } = await import('./js/grid.js');
        const { createLattice, setTile, bake } = await import('./js/lattice.js');
        const { addStair } = await import('./js/stairs.js');
        const s = createState(60, 60);
        addFloor(s);
        for (const i of [0, 1]) {
          const lat = createLattice(60, 60);
          for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) setTile(lat, x, y, true);
          bake(s, i, lat);
        }
        addStair(s, 0, { type: 'ramp', x: 100, z: 100, rotationY: 0, runs: 5 });
        const api = window.app.renderApi;
        api.buildFromState(s);
        api.scene.updateMatrixWorld(true);
        const ray = new THREE.Raycaster();
        // The highest thing under a point, looking down from \`from\` feet.
        // Only the storeys' own merged meshes: a sprite left in the scene by
        // an earlier check cannot be hit without a camera, and throws.
        const baked = [];
        api.scene.traverse((o) => { if (o.isMesh && o.userData.baked) baked.push(o); });
        const top = (x, z, from) => {
          ray.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObjects(baked, false)[0];
          return hit ? hit.point.y : null;
        };
        const out = {
          lane0: top(100, 107.2, 6),         // a quarter of the way up the first run
          lane3: top(112, 107.2, 12.5),      // through the hole, onto the fourth
          landing: top(116, 131, 12.5),      // the top landing, in the hole
          slab: top(100, 114.4, 12.5),       // the floor above, whole over lane 0
          rail: top(102, 114.4, 11),         // the guard between lanes 0 and 1
        };
        api.buildFromState(window.app.state);
        return out;
      })()`);
    },
    expect: ({ ctx, before, after }) => {
      // Five runs of 28.8ft rising 2.4ft each. A quarter of the way along,
      // lane 0 is at 0.6ft; lane 3 climbs coming back, 7.2 to 9.6, so it is three
      // quarters up there, 9.0 (off the middle, so a deck pitched the wrong way
      // reads wrong); the top landing is the
      // floor above, 12; the slab sits a hair over that; the guard stands
      // 3.5ft over lane 1's 3.6ft, under a cap 0.18 thick.
      const want = { lane0: 0.6, lane3: 9.0, landing: 12, slab: 12, rail: 3.6 + 3.5 + 0.09 };
      for (const [k, y] of Object.entries(want)) {
        if (ctx[k] === null || Math.abs(ctx[k] - y) > 0.12) {
          throw new Error(`${k}: the highest thing there is at ${ctx[k]}ft, not ${y}ft`);
        }
      }
      if (after.json !== before.json) throw new Error('the check left its ramp on the design');
    },
  },
  // The two controls of #832, driven the way a person drives them: the panel's
  // own buttons, then a click on the plan. test/ramp-controls.test.mjs has the
  // arithmetic; this is whether the page reaches it.
  {
    name: 'ramp-panel',
    what: 'the stairs panel folds the next ramp and re-folds the selected one, and undo takes a step back',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      const press = async (id, times = 1) => {
        for (let i = 0; i < times; i++) await q(`document.getElementById('${id}').click(); 1`);
      };
      const panel = () => q(`({
        hidden: document.getElementById('ramp-fold').classList.contains('hidden'),
        label: document.getElementById('ramp-fold-label').textContent,
        runs: document.getElementById('ramp-runs').textContent,
        side: document.getElementById('ramp-side').textContent,
        sideOff: document.getElementById('ramp-side').disabled,
        lessOff: document.getElementById('ramp-runs-less').disabled,
        readout: document.getElementById('stair-readout').textContent,
      })`);
      const last = () => q(`(() => {
        const l = window.app.state.links[window.app.state.links.length - 1];
        return { id: l.id, type: l.type, data: { ...l.data }, selected: window.app.editor.stairSelectedId === l.id };
      })()`);
      await d.pick('stair');
      await q(`document.querySelector('#stair-kinds [data-type="stair"]').click(); 1`);
      const onStair = await panel();
      await q(`document.querySelector('#stair-kinds [data-type="ramp"]').click(); 1`);
      const straight = await panel();
      await press('ramp-runs-more', 4);
      await press('ramp-side');
      const armed = await panel();
      const links0 = (await d.fp()).links;
      await d.assertClear([[100, 112]]);
      await d.click(100, 112);
      const placed = await last();
      const links1 = (await d.fp()).links;
      const picked = await panel();
      await press('ramp-runs-less');
      const fewer = { link: await last(), panel: await panel(), status: await d.status() };
      await press('ramp-side');
      const righted = await last();
      await q(`document.getElementById('undo-btn').click(); 1`);
      await d.page.waitForTimeout(300);
      const undone = await last();
      // Leave the storey as it was found: later checks count its links.
      await q(`window.app.editor.stairSelect(${placed.id}); 1`);
      await press('stair-delete');
      const next = await panel();
      await press('ramp-runs-less', 4);
      await press('ramp-side');
      await q(`document.querySelector('#stair-kinds [data-type="stair"]').click(); 1`);
      return { onStair, straight, armed, links0, links1, placed, picked, fewer, righted, undone, next };
    },
    expect: ({ ctx, before, after }) => {
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (!ctx.onStair.hidden) throw new Error('the fold row shows while a staircase is what the tool places');
      if (ctx.straight.hidden) throw new Error('picking Ramp did not show the fold row');
      if (ctx.straight.runs !== '1' || !ctx.straight.sideOff || !ctx.straight.lessOff) {
        throw new Error(`a ramp starts as one run with nothing to hand: ${JSON.stringify(ctx.straight)}`);
      }
      if (!/over the 30in a run may rise/.test(ctx.straight.readout) || !/5 runs is the fewest/.test(ctx.straight.readout)) {
        throw new Error(`one run up 12ft is not called out: ${ctx.straight.readout}`);
      }
      if (ctx.armed.runs !== '5' || ctx.armed.side !== 'Folds left' || ctx.armed.sideOff) {
        throw new Error(`four presses and a flip should read 5, left: ${JSON.stringify(ctx.armed)}`);
      }
      if (!/5 runs of 28\.8ft, 29in of rise each, inside the 30in/.test(ctx.armed.readout)) {
        throw new Error(`five runs are not read back as legal: ${ctx.armed.readout}`);
      }
      if (ctx.links1 !== ctx.links0 + 1) throw new Error('the click placed no ramp');
      if (ctx.placed.type !== 'ramp' || !same(ctx.placed.data, { width: 4, slope: 12, runs: 5, side: -1 })) {
        throw new Error(`the ramp placed is not the one the panel showed: ${JSON.stringify(ctx.placed)}`);
      }
      if (!ctx.placed.selected || ctx.picked.label !== "This ramp's runs") {
        throw new Error(`the placed ramp is not what the row now edits: ${ctx.picked.label}`);
      }
      if (!same(ctx.fewer.link.data, { width: 4, slope: 12, runs: 4, side: -1 })) {
        throw new Error(`one run fewer did not re-fold the selected ramp: ${JSON.stringify(ctx.fewer.link.data)}`);
      }
      if (ctx.fewer.panel.runs !== '4' || !/4 runs of 36\.0ft at 1:12, 36in of rise each.*over the 30in/.test(ctx.fewer.status)) {
        throw new Error(`four runs are not read back as over: ${ctx.fewer.panel.runs} | ${ctx.fewer.status}`);
      }
      if (!/4 runs of 36\.0ft, 36in of rise each: over the 30in a run may rise\. 5 runs is the fewest/.test(ctx.fewer.panel.readout)) {
        throw new Error(`the panel does not call four runs out: ${ctx.fewer.panel.readout}`);
      }
      if (!same(ctx.righted.data, { width: 4, slope: 12, runs: 4 })) {
        throw new Error(`folding right should drop the side field: ${JSON.stringify(ctx.righted.data)}`);
      }
      if (!same(ctx.undone.data, { width: 4, slope: 12, runs: 4, side: -1 })) {
        throw new Error(`undo did not take the flip back alone: ${JSON.stringify(ctx.undone.data)}`);
      }
      // Re-folding the selected ramp is not a change to the next one placed.
      if (ctx.next.label !== 'Ramp runs' || ctx.next.runs !== '5' || ctx.next.side !== 'Folds left') {
        throw new Error(`with the ramp gone the row should be back on the next one, 5 and left: ${JSON.stringify(ctx.next)}`);
      }
      if (after.links !== before.links) throw new Error('the check left its ramp on the design');
    },
  },
  {
    name: 'ramp-size',
    what: 'the stairs panel sets the next ramp\'s width and slope from the keyboard, re-sizes the selected one, stops at 4ft and 1:12, and undo takes a step back',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      const press = async (id, times = 1) => {
        for (let i = 0; i < times; i++) await q(`document.getElementById('${id}').click(); 1`);
      };
      // The keyboard's way in: focus the button, press Enter. Nothing is clicked.
      const keyOn = async (id, times = 1) => {
        await d.page.focus(`#${id}`);
        for (let i = 0; i < times; i++) await d.page.keyboard.press('Enter');
      };
      const off = (id) => `document.getElementById('${id}').disabled`;
      const panel = () => q(`({
        hidden: document.getElementById('ramp-fold').classList.contains('hidden'),
        wLabel: document.getElementById('ramp-width-label').textContent,
        sLabel: document.getElementById('ramp-slope-label').textContent,
        width: document.getElementById('ramp-width').textContent,
        slope: document.getElementById('ramp-slope').textContent,
        lessOff: ${off('ramp-width-less')}, moreOff: ${off('ramp-width-more')},
        steeperOff: ${off('ramp-slope-steeper')}, gentlerOff: ${off('ramp-slope-gentler')},
        readout: document.getElementById('stair-readout').textContent,
      })`);
      const last = () => q(`(() => {
        const l = window.app.state.links[window.app.state.links.length - 1];
        return { id: l.id, type: l.type, data: { ...l.data }, selected: window.app.editor.stairSelectedId === l.id };
      })()`);
      await d.pick('stair');
      await q(`document.querySelector('#stair-kinds [data-type="ramp"]').click(); 1`);
      const fresh = await panel();
      await keyOn('ramp-width-more', 4);
      await keyOn('ramp-slope-gentler', 4);
      const armed = await panel();
      const links0 = (await d.fp()).links;
      await d.assertClear([[100, 112]]);
      await d.click(100, 112);
      const placed = { link: await last(), panel: await panel(), status: await d.status() };
      const links1 = (await d.fp()).links;
      await press('ramp-width-less');
      const narrower = await last();
      await press('ramp-slope-steeper');
      const steeper = { link: await last(), status: await d.status() };
      await q(`document.getElementById('undo-btn').click(); 1`);
      await d.page.waitForTimeout(300);
      const undone = await last();
      // Leave the storey as it was found: later checks count its links.
      await q(`window.app.editor.stairSelect(${placed.link.id}); 1`);
      await press('stair-delete');
      const next = await panel();
      // Past either end: twenty presses each way stop on the limit.
      await press('ramp-width-less', 20);
      await press('ramp-slope-steeper', 20);
      const floor = await panel();
      await q(`document.querySelector('#stair-kinds [data-type="stair"]').click(); 1`);
      return { fresh, armed, links0, links1, placed, narrower, steeper, undone, next, floor };
    },
    expect: ({ ctx, before, after }) => {
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const f = ctx.fresh;
      if (f.hidden || f.width !== '4ft' || f.slope !== '1:12' || f.wLabel !== 'Ramp width' || f.sLabel !== 'Ramp slope') {
        throw new Error(`a ramp starts 4ft wide at 1:12: ${JSON.stringify(f)}`);
      }
      if (!f.lessOff || !f.steeperOff || f.moreOff || f.gentlerOff) {
        throw new Error(`at 4ft and 1:12 only wider and gentler are live: ${JSON.stringify(f)}`);
      }
      if (ctx.armed.width !== '6ft' || ctx.armed.slope !== '1:16') {
        throw new Error(`four Enters on each should read 6ft and 1:16: ${JSON.stringify(ctx.armed)}`);
      }
      if (!/1:16 over a 12ft rise · 192ft of run, 6ft wide/.test(ctx.armed.readout)) {
        throw new Error(`the readout is not the ramp the steppers show: ${ctx.armed.readout}`);
      }
      if (ctx.links1 !== ctx.links0 + 1) throw new Error('the click placed no ramp');
      if (ctx.placed.link.type !== 'ramp' || !same(ctx.placed.link.data, { width: 6, slope: 16 })) {
        throw new Error(`the ramp placed is not the one the panel showed: ${JSON.stringify(ctx.placed.link)}`);
      }
      if (!ctx.placed.link.selected || ctx.placed.panel.wLabel !== "This ramp's width" || ctx.placed.panel.sLabel !== "This ramp's slope") {
        throw new Error(`the placed ramp is not what the rows now edit: ${JSON.stringify(ctx.placed.panel)}`);
      }
      if (!/Ramp — 192\.0ft of run at 1:16, 6ft wide/.test(ctx.placed.status)) {
        throw new Error(`the status line does not describe the ramp placed: ${ctx.placed.status}`);
      }
      if (!same(ctx.narrower.data, { width: 5.5, slope: 16 })) {
        throw new Error(`one press narrower did not take 6in off the selected ramp alone: ${JSON.stringify(ctx.narrower.data)}`);
      }
      if (!same(ctx.steeper.link.data, { width: 5.5, slope: 15 }) || !/180\.0ft of run at 1:15, 5\.5ft wide/.test(ctx.steeper.status)) {
        throw new Error(`one press steeper should read 1:15, 180ft: ${JSON.stringify(ctx.steeper)}`);
      }
      if (!same(ctx.undone.data, { width: 5.5, slope: 16 })) {
        throw new Error(`undo did not take the slope back alone: ${JSON.stringify(ctx.undone.data)}`);
      }
      // Re-sizing the selected ramp is not a change to the next one placed.
      if (ctx.next.wLabel !== 'Ramp width' || ctx.next.width !== '6ft' || ctx.next.slope !== '1:16') {
        throw new Error(`with the ramp gone the rows should be back on the next one, 6ft at 1:16: ${JSON.stringify(ctx.next)}`);
      }
      if (ctx.floor.width !== '4ft' || ctx.floor.slope !== '1:12' || !ctx.floor.lessOff || !ctx.floor.steeperOff) {
        throw new Error(`twenty presses down should stop at 4ft and 1:12: ${JSON.stringify(ctx.floor)}`);
      }
      if (after.links !== before.links) throw new Error('the check left its ramp on the design');
    },
  },
  {
    name: 'accent-brush',
    what: 'a swatch in the wall panel paints one face of one wall, the same click takes it off, the eraser takes the accent with the wall, a face with no wall is refused, and no wall is drawn',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      const swatch = (hex) => q(`document.querySelector('#accent-swatches [data-paint="${hex}"]').click(); 1`);
      await d.pick('wall');
      // A wall of a room with a foot of that room clear in front of it.
      const aim = await q(`(async () => {
        const { shapesOf, shapeAt, accentFaceAt, isBuilt, nearestSegment } = await import('./js/shapes.js');
        const { wallAlongSeg, wallLineAt } = await import('./js/wallrun.js');
        const s = window.app.state, floor = s.floors[s.currentFloor];
        // The wall has to be the ring's own and the only one on its line, so
        // taking it down below leaves a face with nothing to paint (#857).
        const alone = (shape, ring, i) => {
          const kind = ring.walls[i];
          if (!isBuilt(kind)) return false;
          ring.walls[i] = 0;
          const other = wallAlongSeg(floor, shape, 0, i);
          ring.walls[i] = kind;
          return !other;
        };
        for (const shape of shapesOf(floor)) {
          const ring = shape.rings[0];
          if (ring.accents) continue;
          for (let i = 0; i < ring.pts.length; i++) {
            const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
            const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
            if (len < 8) continue;
            for (const side of [1, -1]) {
              const x = (a.x + b.x) / 2 - (dz / len) * side, z = (a.z + b.z) / 2 + (dx / len) * side;
              if (shapeAt(floor, x, z) !== shape || !window.__clear(x, z)) continue;
              const face = accentFaceAt(floor, x, z, 3);
              if (!face || face.shape !== shape || face.ring !== 0 || face.seg !== i) continue;
              if (!alone(shape, ring, i)) continue;
              // ...and the one the eraser finds at its midpoint (#859).
              const wx = (a.x + b.x) / 2, wz = (a.z + b.z) / 2;
              const hit = nearestSegment(floor, wx, wz, 0.5);
              if (!hit || hit.shape !== shape || hit.seg !== i || wallLineAt(floor, wx, wz, 0.5)) continue;
              return { x, z, wx, wz, id: shape.id, seg: i, n: ring.pts.length };
            }
          }
        }
        return null;
      })()`);
      if (!aim) throw new Error('no wall on this storey to aim at');
      const read = () => q(`(() => {
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const ring = floor.shapes.find((sh) => sh.id === ${aim.id}).rings[0];
        const lit = [...document.querySelectorAll('#accent-swatches .swatch[aria-pressed="true"]')].map((b) => b.dataset.paint);
        const kinds = [...document.querySelectorAll('#wall-kinds .kind-item[aria-pressed="true"]')].length;
        return {
          accents: ring.accents ? ring.accents.slice() : null, lit, kinds,
          wall: ring.walls[${aim.seg}],
          armed: window.app.editor.accentPaint === undefined ? 'off' : window.app.editor.accentPaint,
          status: document.getElementById('status').textContent,
        };
      })()`);
      const idle = await read();
      await swatch('#2f5d8a');
      const armed = await read();
      await d.click(aim.x, aim.z);
      const painted = await read();
      await d.click(aim.x, aim.z);
      const toggled = await read();
      // The wall rubbed out with the accent on it (#859): the accent goes with
      // the wall, and one undo brings both back. A second undo takes the paint
      // off again, so this leaves the undo stack as long as it found it: the
      // `undo-redo` check below counts on six undos reaching another design.
      await d.click(aim.x, aim.z);
      await d.pick('erase');
      await d.click(aim.wx, aim.wz);
      const erased = await read();
      await q('window.app.editor.undo(); 1');
      const undone = await read();
      await q('window.app.editor.undo(); 1');
      await d.pick('wall');
      if ((await read()).armed !== '#2f5d8a') await swatch('#2f5d8a');
      const rearmed = await read();
      // The wall taken down behind the editor's back: the same click on the
      // same face has nothing to paint now, and has to say so (#857).
      const wall = (kind) => q(`(() => {
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const ring = floor.shapes.find((sh) => sh.id === ${aim.id}).rings[0];
        const was = ring.walls[${aim.seg}];
        ring.walls[${aim.seg}] = ${kind};
        return was;
      })()`);
      const kind = await wall(0);
      await d.click(aim.x, aim.z);
      const refused = await read();
      await wall(kind);
      await d.click(aim.x, aim.z);
      await swatch('');
      await d.click(aim.x, aim.z);
      const cleared = await read();
      await d.page.keyboard.press('Escape');
      const down = await read();
      // A wall type is the other way down.
      await swatch('#2f5d8a');
      await q(`document.querySelector('#wall-kinds [data-kind="wall"]').click(); 1`);
      const kinded = await read();
      return { aim, idle, armed, painted, toggled, erased, undone, rearmed, refused, cleared, down, kinded };
    },
    expect: ({ ctx, before, after }) => {
      const { aim } = ctx;
      if (ctx.idle.armed !== 'off' || ctx.idle.lit.length || ctx.idle.kinds !== 1) {
        throw new Error(`the wall tool should open drawing, with no swatch lit: ${JSON.stringify(ctx.idle)}`);
      }
      if (ctx.armed.armed !== '#2f5d8a' || ctx.armed.lit.join() !== '#2f5d8a' || ctx.armed.kinds !== 0) {
        throw new Error(`a swatch did not arm the brush: ${JSON.stringify(ctx.armed)}`);
      }
      const want = new Array(aim.n).fill(null);
      want[aim.seg] = '#2f5d8a';
      if (JSON.stringify(ctx.painted.accents) !== JSON.stringify(want)) {
        throw new Error(`the click should paint segment ${aim.seg} and no other: ${JSON.stringify(ctx.painted.accents)}`);
      }
      if (!/painted #2f5d8a/.test(ctx.painted.status)) throw new Error(`the tool did not say so: ${ctx.painted.status}`);
      if (ctx.toggled.accents !== null) {
        throw new Error(`the same colour again should take it off and drop the key: ${JSON.stringify(ctx.toggled.accents)}`);
      }
      if (ctx.erased.wall !== 0 || ctx.erased.accents !== null) {
        throw new Error(`the eraser should take the wall and its accent together: ${JSON.stringify(ctx.erased)}`);
      }
      if (ctx.undone.wall !== ctx.painted.wall || JSON.stringify(ctx.undone.accents) !== JSON.stringify(want)) {
        throw new Error(`one undo should bring the wall and its accent back: ${JSON.stringify(ctx.undone)}`);
      }
      if (ctx.rearmed.accents !== null || ctx.rearmed.armed !== '#2f5d8a') {
        throw new Error(`a second undo should take the paint off, and the brush should be up again: ${JSON.stringify(ctx.rearmed)}`);
      }
      if (ctx.refused.accents !== null || !/has no wall on that side/.test(ctx.refused.status)) {
        throw new Error(`a face with no wall on its line should be refused, out loud: ${JSON.stringify(ctx.refused)}`);
      }
      if (ctx.cleared.accents !== null || ctx.cleared.armed !== null || ctx.cleared.lit.length !== 1 || ctx.cleared.lit[0] !== '') {
        throw new Error(`the dashed swatch should clear a painted wall: ${JSON.stringify(ctx.cleared)}`);
      }
      if (ctx.down.armed !== 'off' || ctx.down.lit.length || ctx.down.kinds !== 1) {
        throw new Error(`Esc should put the brush down and light a wall type: ${JSON.stringify(ctx.down)}`);
      }
      if (ctx.kinded.armed !== 'off' || ctx.kinded.lit.length || ctx.kinded.kinds !== 1) {
        throw new Error(`picking a wall type should put the brush down: ${JSON.stringify(ctx.kinded)}`);
      }
      if (after.walls !== before.walls) throw new Error('four clicks with the brush up drew a wall');
      if (after.json !== before.json) throw new Error('the design is not back to the bytes it started with');
    },
  },
  // An accent on a free-standing wall (#910, wallrun.js's `line.accents`).
  // test/wall-accent.test.mjs states the rule; this draws a screen in a room
  // with the wall tool, paints each side of it with the brush, and reads the
  // two faces back out of the scene. Four undo steps go on (the wall, three
  // clicks of paint) and four come off, so `undo-redo` finds the stack as
  // long as `accent-brush` left it.
  {
    name: 'accent-line',
    what: 'a free-standing wall takes an accent on each side from the same swatches, glass is refused, and the scene shows both',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      // An 8ft screen on the grid, running toward +z, with the same room all
      // round it, no side of that room within 4ft, and no other wall near.
      const aim = await q(`(async () => {
        const { shapesOf, shapeAt, shapeBBox, accentFaceAt } = await import('./js/shapes.js');
        const { wallLineAt } = await import('./js/wallrun.js');
        const s = window.app.state, floor = s.floors[s.currentFloor];
        for (const shape of shapesOf(floor)) {
          const bb = shapeBBox(shape);
          for (let x = Math.ceil(bb.x0 / 4) * 4; x <= bb.x1; x += 4) {
            for (let z = Math.ceil(bb.z0 / 4) * 4; z <= bb.z1; z += 4) {
              const pts = [];
              for (let k = -6; k <= 6; k += 2) for (const o of [-2, 0, 2]) pts.push([x + o, z + k]);
              if (pts.some(([px, pz]) => shapeAt(floor, px, pz) !== shape)) continue;
              if (pts.some(([px, pz]) => accentFaceAt(floor, px, pz, 4) || wallLineAt(floor, px, pz, 4))) continue;
              if (![[x, z - 4], [x, z + 4], [x - 1, z], [x + 1, z]].every(([px, pz]) => window.__clear(px, pz))) continue;
              return { x, z, id: shape.id, lines: (floor.walls || []).length };
            }
          }
        }
        return null;
      })()`);
      if (!aim) throw new Error('no room on this storey with space for a screen');
      const read = () => q(`(() => {
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const line = (floor.walls || []).find((l) => l.ax === ${aim.x} && l.bx === ${aim.x}
          && Math.min(l.az, l.bz) === ${aim.z - 4} && Math.max(l.az, l.bz) === ${aim.z + 4});
        const room = floor.shapes.find((sh) => sh.id === ${aim.id});
        return {
          lines: (floor.walls || []).length,
          line: line ? { az: line.az, bz: line.bz, kind: line.kind, accents: line.accents ? line.accents.slice() : null } : null,
          room: room.rings.some((r) => r.accents),
          armed: window.app.editor.accentPaint === undefined ? 'off' : window.app.editor.accentPaint,
          status: document.getElementById('status').textContent,
        };
      })()`);
      const swatch = (hex) => q(`document.querySelector('#accent-swatches [data-paint="${hex}"]').click(); 1`);
      await d.pick('wall');
      await d.click(aim.x, aim.z - 4);
      await d.click(aim.x, aim.z + 4);
      const drawn = await read();
      // The swatch by the keyboard: focus and Enter, as Tab would reach it.
      await q(`document.querySelector('#accent-swatches [data-paint="#2f5d8a"]').focus(); 1`);
      await d.page.keyboard.press('Enter');
      const armed = await read();
      await d.click(aim.x - 1, aim.z);
      const west = await read();
      await swatch('#d9a441');
      await d.click(aim.x + 1, aim.z);
      const both = await read();
      // The two long faces of the screen, read out of the scene.
      const scene = await q(`(async () => {
        const THREE = await import('three');
        const { floorBaseY } = await import('./js/grid.js');
        const s = window.app.state, fi = s.currentFloor;
        window.app.renderApi.buildFromState(s);
        const a = { x: ${aim.x}, z: ${aim.z - 4} }, len = 8, dx = 0, dz = 8, nx = -1, nz = 0;
        const want = { left: new THREE.Color('#2f5d8a'), right: new THREE.Color('#d9a441') };
        const out = { left: { n: 0, bad: [] }, right: { n: 0, bad: [] } };
        const y0 = floorBaseY(s, fi), y1 = floorBaseY(s, fi + 1);
        window.app.renderApi.scene.traverse((o) => {
          const g = o.isMesh && o.geometry;
          if (!g || !g.attributes.color || !g.attributes.normal || !o.userData.baked) return;
          const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, I = g.index;
          const tris = (I ? I.count : P.count) / 3;
          for (let k = 0; k < tris; k++) {
            const at = [0, 1, 2].map((j) => (I ? I.getX(k * 3 + j) : k * 3 + j)).map((i) => {
              const rx = P.getX(i) - a.x, rz = P.getZ(i) - a.z;
              return {
                i, y: P.getY(i), facing: N.getX(i) * nx + N.getZ(i) * nz,
                along: (rx * dx + rz * dz) / len, off: rx * nx + rz * nz,
              };
            });
            if (at.some((v) => v.y < y0 - 0.01 || v.y > y1 + 0.01)) continue;
            if (at.some((v) => Math.abs(v.facing) < 0.99 || Math.abs(v.off) > 0.6)) continue;
            if (at.some((v) => Math.sign(v.off) !== Math.sign(v.facing))) continue;
            const alongs = at.map((v) => v.along);
            if (Math.min(...alongs) < -0.6 || Math.max(...alongs) > len + 0.6) continue;
            if (Math.max(...alongs) - Math.min(...alongs) < len / 2) continue;
            const side = at[0].facing > 0 ? 'left' : 'right';
            for (const v of at) {
              out[side].n++;
              const c = [C.getX(v.i), C.getY(v.i), C.getZ(v.i)], w = want[side];
              if (Math.abs(c[0] - w.r) + Math.abs(c[1] - w.g) + Math.abs(c[2] - w.b) > 0.003) {
                out[side].bad.push(c.map((x) => x.toFixed(3)).join(' '));
              }
            }
          }
        });
        return out;
      })()`);
      // The screen made glass behind the editor's back: a third colour on it
      // has nothing to paint and has to say so.
      const kind = (k) => q(`(() => {
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const line = floor.walls.find((l) => l.ax === ${aim.x} && l.bx === ${aim.x}
          && Math.min(l.az, l.bz) === ${aim.z - 4} && Math.max(l.az, l.bz) === ${aim.z + 4});
        const was = line.kind; line.kind = ${k}; return was;
      })()`);
      const was = await kind(2);
      await swatch('#3f7d6b');
      await d.click(aim.x - 1, aim.z);
      const refused = await read();
      await kind(was);
      // The colour a face already is, clicked again, takes it off.
      await swatch('#2f5d8a');
      await d.click(aim.x - 1, aim.z);
      const toggled = await read();
      await d.page.keyboard.press('Escape');
      for (let i = 0; i < 3; i++) await q('window.app.editor.undo(); 1');
      const bare = await read();
      await q('window.app.editor.undo(); 1');
      const gone = await read();
      return { aim, drawn, armed, west, both, scene, refused, toggled, bare, gone };
    },
    expect: ({ ctx, before, after }) => {
      const { aim } = ctx;
      const say = (o) => JSON.stringify(o);
      if (ctx.drawn.lines !== aim.lines + 1 || !ctx.drawn.line || ctx.drawn.line.accents !== null) {
        throw new Error(`two clicks should draw one unpainted screen: ${say(ctx.drawn)}`);
      }
      if (ctx.drawn.line.az !== aim.z - 4 || ctx.drawn.line.bz !== aim.z + 4) {
        throw new Error(`the screen should run the way it was drawn: ${say(ctx.drawn.line)}`);
      }
      if (ctx.armed.armed !== '#2f5d8a') throw new Error(`Enter on a focused swatch did not arm the brush: ${say(ctx.armed)}`);
      // The screen runs toward +z, so its left face looks west, at -x.
      if (say(ctx.west.line.accents) !== say(['#2f5d8a', null]) || ctx.west.lines !== ctx.drawn.lines) {
        throw new Error(`a click west of the screen should paint its left face and draw nothing: ${say(ctx.west)}`);
      }
      if (!/free-standing wall painted #2f5d8a/.test(ctx.west.status)) throw new Error(`the tool did not say so: ${ctx.west.status}`);
      if (say(ctx.both.line.accents) !== say(['#2f5d8a', '#d9a441'])) {
        throw new Error(`a click east of it should paint the other face and leave the first: ${say(ctx.both)}`);
      }
      if (ctx.west.room || ctx.both.room) throw new Error('the room took an accent that was the screen\'s');
      for (const side of ['left', 'right']) {
        if (ctx.scene[side].n < 6) {
          throw new Error(`found ${ctx.scene[side].n} corners on the screen's ${side} face, and a face is two triangles`);
        }
        if (ctx.scene[side].bad.length) {
          throw new Error(`${ctx.scene[side].bad.length} of ${ctx.scene[side].n} corners on the screen's ${side} face ` +
            `are ${ctx.scene[side].bad[0]}, not that face's accent`);
        }
      }
      if (say(ctx.refused.line.accents) !== say(['#2f5d8a', '#d9a441']) || !/glass and railings are not painted/.test(ctx.refused.status)) {
        throw new Error(`glass should be refused, out loud: ${say(ctx.refused)}`);
      }
      if (say(ctx.toggled.line.accents) !== say([null, '#d9a441'])) {
        throw new Error(`the same colour again should take that face's accent off: ${say(ctx.toggled)}`);
      }
      if (!ctx.bare.line || ctx.bare.line.accents !== null) {
        throw new Error(`three undos should leave the screen unpainted: ${say(ctx.bare)}`);
      }
      if (ctx.gone.line || ctx.gone.lines !== aim.lines) throw new Error(`a fourth undo should take the screen away: ${say(ctx.gone)}`);
      if (after.json !== before.json) throw new Error('the design is not back to the bytes it started with');
    },
  },
  // A corner dragged with the vertex tool (#862). test/accent.test.mjs states
  // which accent the settle takes and which it leaves; this proves the tool
  // settles at all, and only when the corner is let go. Two undo steps go on
  // (the paint, the drag) and two come off, so `undo-redo` below finds the
  // stack as long as `accent-brush` left it.
  {
    name: 'accent-drag',
    what: 'a corner dragged off the neighbour\'s wall takes that face\'s accent off, says so, and one undo brings both back',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      // A face whose wall is another ring's: the segment itself is empty, a
      // neighbour's wall is on its line, and the corner it starts at has 4ft
      // of clear canvas inside the room to be dragged to.
      const aim = await q(`(async () => {
        const { shapesOf, shapeAt, accentFaceAt, isBuilt } = await import('./js/shapes.js');
        const { wallAlongSeg } = await import('./js/wallrun.js');
        const s = window.app.state, floor = s.floors[s.currentFloor];
        for (const shape of shapesOf(floor)) {
          const ring = shape.rings[0];
          if (ring.accents || shape.rings.length !== 1) continue;
          for (let i = 0; i < ring.pts.length; i++) {
            if (isBuilt(ring.walls[i]) || !wallAlongSeg(floor, shape, 0, i)) continue;
            const a = ring.pts[i], b = ring.pts[(i + 1) % ring.pts.length];
            const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
            if (len < 8) continue;
            for (const side of [1, -1]) {
              const nx = -(dz / len) * side, nz = (dx / len) * side;
              const x = (a.x + b.x) / 2 + nx, z = (a.z + b.z) / 2 + nz;
              if (shapeAt(floor, x, z) !== shape || !window.__clear(x, z)) continue;
              const face = accentFaceAt(floor, x, z, 3);
              if (!face || face.shape !== shape || face.ring !== 0 || face.seg !== i) continue;
              // The corner goes 4ft into the room and 1ft along the wall, so
              // the side it starts leans off the line whatever it snaps to.
              const to = { x: a.x + nx * 4 + (dx / len), z: a.z + nz * 4 + (dz / len) };
              if (shapeAt(floor, to.x, to.z) !== shape) continue;
              if (!window.__clear(a.x, a.z) || !window.__clear(to.x, to.z)) continue;
              return { x, z, id: shape.id, seg: i, n: ring.pts.length, from: { x: a.x, z: a.z }, to };
            }
          }
        }
        return null;
      })()`);
      if (!aim) throw new Error('no face on this storey whose wall is a neighbour\'s');
      const read = () => q(`(async () => {
        const { wallAlongSeg } = await import('./js/wallrun.js');
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const shape = floor.shapes.find((sh) => sh.id === ${aim.id});
        const ring = shape.rings[0], p = ring.pts[${aim.seg}];
        return {
          accents: ring.accents ? ring.accents.slice() : null,
          corner: [p.x, p.z], n: ring.pts.length,
          walled: wallAlongSeg(floor, shape, 0, ${aim.seg}),
          status: document.getElementById('status').textContent,
        };
      })()`);
      await d.pick('wall');
      await q(`document.querySelector('#accent-swatches [data-paint="#2f5d8a"]').click(); 1`);
      await d.click(aim.x, aim.z);
      const painted = await read();
      await d.page.keyboard.press('Escape');
      await d.pick('vertex');
      await d.click(aim.x, aim.z);              // select the room
      await d.drag([[aim.from.x, aim.from.z], [aim.to.x, aim.to.z]]);
      const dragged = await read();
      await q('window.app.editor.undo(); 1');
      const undone = await read();
      await q('window.app.editor.undo(); 1');
      const bare = await read();
      await d.page.keyboard.press('Escape');
      return { aim, painted, dragged, undone, bare };
    },
    expect: ({ ctx, before, after }) => {
      const { aim } = ctx;
      const want = new Array(aim.n).fill(null);
      want[aim.seg] = '#2f5d8a';
      if (JSON.stringify(ctx.painted.accents) !== JSON.stringify(want) || !ctx.painted.walled) {
        throw new Error(`the brush should paint the face a neighbour's wall stands on: ${JSON.stringify(ctx.painted)}`);
      }
      const moved = Math.hypot(ctx.dragged.corner[0] - aim.from.x, ctx.dragged.corner[1] - aim.from.z);
      if (ctx.dragged.n !== aim.n || moved < 1) {
        throw new Error(`the drag should move the corner and add none: ${JSON.stringify(ctx.dragged)}`);
      }
      if (ctx.dragged.walled) {
        throw new Error(`the drag left the face on its wall's line, so it proves nothing: ${JSON.stringify(ctx.dragged)}`);
      }
      if (ctx.dragged.accents !== null) {
        throw new Error(`the accent should come off with the corner let go: ${JSON.stringify(ctx.dragged.accents)}`);
      }
      if (!/An accent came off/.test(ctx.dragged.status)) throw new Error(`the tool did not say so: ${ctx.dragged.status}`);
      if (ctx.undone.corner[0] !== aim.from.x || ctx.undone.corner[1] !== aim.from.z ||
          JSON.stringify(ctx.undone.accents) !== JSON.stringify(want)) {
        throw new Error(`one undo should put the corner and the accent back together: ${JSON.stringify(ctx.undone)}`);
      }
      if (ctx.bare.accents !== null) throw new Error(`a second undo should take the paint off: ${JSON.stringify(ctx.bare)}`);
      if (after.json !== before.json) throw new Error('the design is not back to the bytes it started with');
    },
  },
  // The other four gestures that settle (#862): a corner removed with
  // Alt-click, R, M, and a copy laid down with Ctrl+D. Each is one call in
  // polyedit.js that `accent-drag` does not reach. The face is picked per
  // gesture, by doing the gesture to a copy of the storey with the pure
  // transforms and keeping a face the gesture takes off its wall's line; the
  // assertions read what the tool then did to the real one. M is the one
  // exception: no room of the sample school mirrors a face off its wall (the
  // side along x stays on its line, the side along z lands on the wall
  // opposite), so its face is the room's own wall, taken down behind the
  // editor's back the way \`accent-brush\` does it, which leaves M's settle the
  // only thing that can take the accent off. Each gesture puts
  // two undo steps on (the paint, the gesture) and takes two off, so
  // `undo-redo` below finds the stack as long as it was.
  {
    name: 'accent-settle',
    what: 'a corner removed, a room turned, a room mirrored and a room duplicated each take off the accent whose wall stayed behind, say so, and one undo brings it back',
    async run(d) {
      const q = (js) => d.page.evaluate(js);
      const find = (op) => q(`(async () => {
        const { shapesOf, shapeAt, accentFaceAt, isBuilt, rotateShape90, mirrorShapeX, deleteVertex } =
          await import('./js/shapes.js');
        const { wallAlongSeg } = await import('./js/wallrun.js');
        const { sectionBounds } = await import('./js/section.js');
        const s = window.app.state, real = s.floors[s.currentFloor];
        const mirror = ${JSON.stringify(op)} === 'mirror';
        const shapes = shapesOf(real);
        for (let k = 0; k < shapes.length; k++) {
          const shape = shapes[k], ring = shape.rings[0], n = ring.pts.length;
          if (ring.accents || shape.rings.length !== 1 || n < 4) continue;
          for (let i = 0; i < n - 1; i++) {
            const own = ring.walls[i];
            if (mirror) {
              // The ring's own wall, and the only one on its line.
              if (!isBuilt(own)) continue;
              ring.walls[i] = 0;
              const other = wallAlongSeg(real, shape, 0, i);
              ring.walls[i] = own;
              if (other) continue;
            } else if (isBuilt(own) || !wallAlongSeg(real, shape, 0, i)) continue;
            const a = ring.pts[i], b = ring.pts[i + 1];
            const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
            if (len < 8) continue;
            for (const side of [1, -1]) {
              const x = (a.x + b.x) / 2 - (dz / len) * side, z = (a.z + b.z) / 2 + (dx / len) * side;
              if (shapeAt(real, x, z) !== shape || !window.__clear(x, z)) continue;
              const face = accentFaceAt(real, x, z, 3);
              if (!face || face.shape !== shape || face.ring !== 0 || face.seg !== i) continue;
              if (${JSON.stringify(op)} === 'corner' && !window.__clear(b.x, b.z)) continue;
              // The gesture, done to a copy: the face has to come off its line.
              const floor = JSON.parse(JSON.stringify(real));
              const copy = shapesOf(floor).find((sh) => sh.id === shape.id);
              const tag = '#000001';
              copy.rings[0].accents = new Array(n).fill(null);
              copy.rings[0].accents[i] = tag;
              // M's wall comes down first, as it will on the real one, and the
              // face must not land on another wall: a side along z lands on
              // the wall opposite, and half a split side lands on the other half.
              const bb = sectionBounds([copy]), cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
              if (mirror) { copy.rings[0].walls[i] = 0; mirrorShapeX(copy, cx); }
              if (${JSON.stringify(op)} === 'corner') deleteVertex(copy, 0, i + 1);
              if (${JSON.stringify(op)} === 'turn') rotateShape90(copy, cx, cz, true);
              if (${JSON.stringify(op)} === 'dup') for (const p of copy.rings[0].pts) { p.x += 3; p.z += 3; }
              const at = (copy.rings[0].accents || []).indexOf(tag);
              if (at < 0 || isBuilt(copy.rings[0].walls[at]) || wallAlongSeg(floor, copy, 0, at)) continue;
              return { x, z, id: shape.id, seg: i, n, corner: { x: b.x, z: b.z } };
            }
          }
        }
        return null;
      })()`);
      const read = (aim) => q(`(async () => {
        const { wallAlongSeg } = await import('./js/wallrun.js');
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const seen = (shape) => {
          const ring = shape.rings[0];
          const acc = ring.accents ? ring.accents.slice() : null;
          return {
            id: shape.id, n: ring.pts.length, accents: acc,
            pts: ring.pts.map((p) => [p.x, p.z]),
            // Every accent left has a wall on its line, or the settle missed it.
            stranded: (acc || []).filter((c, i) => c && !wallAlongSeg(floor, shape, 0, i)).length,
          };
        };
        return {
          room: seen(floor.shapes.find((sh) => sh.id === ${aim.id})),
          rooms: floor.shapes.map(seen),
          report: !document.getElementById('report-panel').classList.contains('hidden'),
          status: document.getElementById('status').textContent,
        };
      })()`);
      const wall = (aim, kind) => q(`(() => {
        const s = window.app.state, floor = s.floors[s.currentFloor];
        const ring = floor.shapes.find((sh) => sh.id === ${aim.id}).rings[0];
        const was = ring.walls[${aim.seg}];
        ring.walls[${aim.seg}] = ${kind};
        return was;
      })()`);
      const gestures = {
        corner: async (aim) => {
          const c = await d.at(aim.corner.x, aim.corner.z);
          await d.page.mouse.move(c.x, c.y);
          await d.page.keyboard.down('Alt');
          await d.click(aim.corner.x, aim.corner.z);
          await d.page.keyboard.up('Alt');
        },
        turn: () => d.page.keyboard.press('r'),
        mirror: () => d.page.keyboard.press('m'),
        dup: () => d.page.keyboard.press('Control+d'),
      };
      const out = {};
      for (const op of ['corner', 'turn', 'mirror', 'dup']) {
        const aim = await find(op);
        if (!aim) throw new Error(`no face on this storey that "${op}" takes off its neighbour's wall`);
        await d.pick('wall');
        await q(`document.querySelector('#accent-swatches [data-paint="#2f5d8a"]').click(); 1`);
        await d.click(aim.x, aim.z);
        const painted = await read(aim);
        await d.page.keyboard.press('Escape');
        await d.pick('vertex');
        await d.click(aim.x, aim.z);              // select the room
        if (op === 'mirror') await wall(aim, 0);
        await gestures[op](aim);
        await d.page.waitForTimeout(300);
        const done = await read(aim);
        await q('window.app.editor.undo(); 1');
        const undone = await read(aim);
        await q('window.app.editor.undo(); 1');
        const bare = await read(aim);
        await d.page.keyboard.press('Escape');
        out[op] = { aim, painted, done, undone, bare };
      }
      return out;
    },
    expect: ({ ctx, before, after }) => {
      const j = JSON.stringify;
      // Each gesture is judged on its own, so one that fails does not hide
      // the next.
      const failed = [];
      const judge = (op) => {
        const { aim, painted, done, undone, bare } = ctx[op];
        const want = new Array(aim.n).fill(null);
        want[aim.seg] = '#2f5d8a';
        if (j(painted.room.accents) !== j(want)) {
          throw new Error(`${op}: the brush should paint segment ${aim.seg}: ${j(painted.room.accents)}`);
        }
        // The gesture happened: a corner fewer, the corners somewhere else,
        // or a room more.
        if (op === 'corner' && done.room.n !== aim.n - 1) {
          throw new Error(`${op}: Alt-click should remove one corner of ${aim.n}: ${done.room.n} left`);
        }
        if (op === 'turn' && j(done.room.pts) === j(painted.room.pts)) {
          throw new Error(`${op}: R did not move the room`);
        }
        // A rectangle mirrored about its own centre lands on its own corners,
        // so the status line is the evidence that M was heard.
        // With a room selected in the Shape tool M is the mirror and not the
        // report panel, which had the key from Phase 7 until #866.
        if (op === 'mirror' && (!/^Mirrored 1 room/.test(done.status) || done.report)) {
          throw new Error(`${op}: M did not mirror the room${done.report ? ', it opened the report' : ''}: ${done.status}`);
        }
        if (op === 'dup' && done.rooms.length !== painted.rooms.length + 1) {
          throw new Error(`${op}: Ctrl+D should add one room: ${painted.rooms.length} became ${done.rooms.length}`);
        }
        // The original of a duplicate has not moved and keeps its accent; the
        // copy came with the accent and not with the neighbour's wall.
        const held = done.rooms.filter((r) => r.accents);
        if (op === 'dup') {
          if (held.length !== 1 || held[0].id !== aim.id || j(held[0].accents) !== j(want)) {
            throw new Error(`${op}: the accent should be on the original alone: ${j(held)}`);
          }
        } else if (held.length) {
          throw new Error(`${op}: the accent should come off with its wall left behind: ${j(held)}`);
        }
        const stranded = done.rooms.reduce((k, r) => k + r.stranded, 0);
        if (stranded) throw new Error(`${op}: ${stranded} accent left on a line with no wall`);
        if (!/An accent came off/.test(done.status)) throw new Error(`${op}: the tool did not say so: ${done.status}`);
        // M's undo goes back to the storey M found, wall down and accent on;
        // the second undo is the one that stands the wall up again.
        if (undone.room.stranded !== (op === 'mirror' ? 1 : 0)) {
          throw new Error(`${op}: undo left ${undone.room.stranded} accent with no wall: ${j(undone.room)}`);
        }
        if (j(undone.room.accents) !== j(want) || j(undone.room.pts) !== j(painted.room.pts) ||
            undone.rooms.length !== painted.rooms.length) {
          throw new Error(`${op}: one undo should put the room and its accent back together: ${j(undone.room)}`);
        }
        if (bare.room.accents !== null || j(bare.room.pts) !== j(painted.room.pts)) throw new Error(`${op}: a second undo should take the paint off: ${j(bare.room)}`);
      };
      for (const op of ['corner', 'turn', 'mirror', 'dup']) {
        try { judge(op); } catch (e) { failed.push(e.message); }
      }
      if (failed.length) throw new Error(failed.join(' | '));
      if (after.json !== before.json) throw new Error('the design is not back to the bytes it started with');
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
  // ---------- Phase 34: a history somebody else can read ----------
  //
  // The pure suite proves the differ's sentences and the store's round trip;
  // this proves the tool is wired to them: a snapshot kept, a room drawn, the
  // change read back as a sentence with a mark behind it, the snapshot
  // restored as an edit, and undo taking the restore back.
  {
    name: 'history',
    what: 'a snapshot is kept, a change reads back as a sentence, and restoring it is an undoable edit',
    async run(d) {
      const a = await d.page.evaluate(`window.app.snapshotNow('before')`);
      const before = await d.fp();
      await d.pick('floor');
      await d.page.evaluate('window.app.editor.setFloorRect(true); 1');
      // The strip above the sample school's rooms, a clear cell or more east
      // of where floor-rect drew: tiles that touch merge into the room beside
      // them, and this has to make a room of its own.
      await d.assertClear([[140, 8], [156, 20]]);
      await d.drag([[140, 8], [156, 20]]);
      const drawn = await d.fp();
      const b = await d.page.evaluate(`window.app.snapshotNow('after')`);
      const cmp = await d.page.evaluate(
        `window.app.compareSnapshots(${JSON.stringify(a)}, ${JSON.stringify(b)})` +
        `.then((c) => c && ({ headline: c.headline, sentences: c.diff.sentences, marks: c.diff.marks.length }))`);
      const restored = await d.page.evaluate(`window.app.restoreSnapshot(${JSON.stringify(a)})`);
      const back = await d.fp();
      await d.page.evaluate(`document.getElementById('undo-btn').click(); 1`);
      await d.page.waitForTimeout(400);
      const undone = await d.fp();
      const listed = await d.page.evaluate('window.app.history.map((s) => s.name)');
      return { a, b, before, drawn, cmp, restored, back, undone, listed };
    },
    expect: ({ ctx }) => {
      if (!ctx.a || !ctx.b) throw new Error('a snapshot was not kept — is IndexedDB refusing?');
      if (ctx.drawn.shapes <= ctx.before.shapes) throw new Error('the rectangle drew no room');
      if (!ctx.cmp) throw new Error('the comparison found no snapshots');
      if (!/1 room appeared/.test(ctx.cmp.headline)) {
        throw new Error(`the headline says "${ctx.cmp.headline}", not that one room appeared`);
      }
      if (!ctx.cmp.sentences.some((t) => /appeared — \d+ ft², Level 1/.test(t))) {
        throw new Error(`no sentence says the room appeared: ${ctx.cmp.sentences.join(' | ')}`);
      }
      if (ctx.cmp.marks < 1) throw new Error('the change has no mark for the sheet');
      if (!ctx.restored) throw new Error('the snapshot did not restore');
      if (ctx.back.shapes !== ctx.before.shapes) {
        throw new Error(`restoring left ${ctx.back.shapes} rooms, not the ${ctx.before.shapes} the snapshot had`);
      }
      if (ctx.undone.shapes !== ctx.drawn.shapes) throw new Error('undo did not take the restore back');
      for (const name of ['before', 'after']) {
        if (!ctx.listed.includes(name)) throw new Error(`the timeline does not list "${name}"`);
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
// ...and says how long it took, because the suite is twenty-odd minutes on a
// CI runner and the only way to know which check to look at is to be told.
let lapFrom = performance.now();
function record(r) {
  const now = performance.now();
  r.seconds = (now - lapFrom) / 1000;
  lapFrom = now;
  results.push(r);
  console.log(`${r.status === 'FAIL' ? '✗' : '✓'} ${r.name} (${r.seconds.toFixed(1)}s): ` +
    `${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
}

try {
  // The same 1600 by 950 page in CSS pixels, so every panel sits where it sat
  // and every gesture lands where it landed, drawn into a canvas a quarter the
  // size. The software rasterizer is fill-bound (measured: 970ms a frame at
  // 1600x950, 640ms at 1280x760, 290ms at 800x475, the same scene), every
  // round trip to the page queues behind one frame, and no check here reads a
  // pixel: that is test/visual's job, at its own scale.
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 }, deviceScaleFactor: RASTER_SCALE,
  });
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
