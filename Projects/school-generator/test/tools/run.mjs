#!/usr/bin/env node
// test/tools/run.mjs — the twelve drawing tools, driven on the real page.
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

// ---------- the checks ----------
//
// Each one says what it drove and what it expects to have changed. `expect` is
// given the before/after fingerprints and the status line, and throws — with a
// sentence — when the tool did not do its job. They run in order against one
// page, which is also how a person uses the tool.

const CHECKS = [
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

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  // Not networkidle: the page settles long before the scene finishes building,
  // and `window.app` is the only honest signal that the editor exists.
  await page.waitForFunction('window.app && window.app.state && window.app.renderApi',
    { timeout: 120000 });
  await page.waitForTimeout(1500);
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
