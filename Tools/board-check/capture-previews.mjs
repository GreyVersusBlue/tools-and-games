// capture-previews.mjs — drive each of the board's games into a real gameplay
// frame and screenshot it.
//
//   npm run previews              every game in RECIPES
//   npm run previews aphelion     just one
//
// Output: ./candidates/<name>-<n>.png plus candidates/report.json. Promote a
// chosen frame with `npm run promote` (see promote-previews.mjs) — nothing here
// writes to assets/previews/.
//
// WHAT CHANGED IN SESSION 6: the `drive` steps used to be guesses at each game's
// UI, and several of them captured an idle title screen. Each recipe now plays
// its game with the selectors and world coordinates the game actually uses, and
// the script ASSERTS it got there rather than screenshotting whatever was on
// screen. Three assertions per game:
//
//   1. `intro` — every named overlay is gone. Catches "we never got past the
//      title", which is exactly the failure the previews spec warns about.
//   2. `moving` — two frames 1.6 s apart hash differently, for the games that
//      have a running clock. Catches the live-looking still: a loaded scene with
//      a stalled render loop. (The old check compared
//      `statSync().size + ':' + readFileSync().length`, which is the same number
//      twice — a file-size comparison wearing a hash's clothes, and two visually
//      different frames of equal size sailed through it.) Closing Time and Faire
//      Weekend are turn-based and set `live: false`: a still frame is their
//      correct playing state, and for them the positive DOM assertion inside
//      `play` (a populated MLS board, plots actually built on the grounds) is the
//      evidence instead.
//   3. no console errors.
//
// Exits non-zero if any game misses any of those, so this is now a real check
// and not just a screenshot dumper.
//
// WHAT CHANGED IN SESSION 7: everything that isn't about framing a picture moved
// to games.mjs — each game's URL, frame size, three.js specifier, intro overlays,
// save key, and the clicks that get from a blank page to the first frame of play.
// play-games.mjs needs exactly those, and a second copy of seven openings is what
// drive.mjs exists to prevent. `enter()` also clears the game's save before the
// page boots, which is why the Fourth Quarter recipe no longer clicks #wipeBtn.
//
// WHY HEADED: the four three.js games need a browser that composites to a real
// screen — pointer lock doesn't engage otherwise and requestAnimationFrame may
// never fire at all, which hangs rather than fails. Same reason play-castle.mjs
// runs headed; see drive.mjs and README.md. A window opens and visibly plays
// seven games. That is expected.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from './harness.mjs';
import { attachSceneProbe, waitForProbe, camState, aimAt, setYaw, turnBy, lookAt, walkTo, waitFor, textContent } from './drive.mjs';
import { GAMES, enter } from './games.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'candidates');
const PORT = 8125; // 8123 is check-collisions/shoot, 8124 is play-castle
const BASE = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- recipes --- */

// Where each game lives, how big a frame it wants and how to play it in all come
// from games.mjs — shared with play-games.mjs so the two can't drift. What's left
// here is only the part that is specific to taking a *picture*: what to build,
// where to stand, which way to look.
//
// (On the frame sizes in games.mjs: 990x600 and 1320x800 are both 33:20, so a
// plain downscale lands on the spec's 330x200 with no cropping. UI-heavy games
// take the smaller frame so text survives; the three.js games take the larger one
// at dsf 1, because dsf 2 makes the renderer draw at 2640x1600 for no benefit at
// 330 px wide.)
const RECIPES = {
  // ---- Integer Foundry: a factory-line idle game. An empty grid is the
  // opening state, so build an actual production line — source, belts, a +1,
  // a sink — and let packets start moving down it. Default tile direction is
  // 'E', so a straight left-to-right row needs no rotation clicks.
  'integer-foundry': {
    async play(p, { shot }) {
      const place = async (tool, x, y) => {
        await p.click(`[data-tool="${tool}"]`);
        await p.click(`#grid .cell[data-x="${x}"][data-y="${y}"]`);
      };
      const ROW = 2;
      await place('source', 0, ROW);
      for (const x of [1, 2]) await place('belt', x, ROW);
      await place('add1', 3, ROW);
      for (const x of [4, 5]) await place('belt', x, ROW);
      await place('add1', 6, ROW);
      await place('sink', 7, ROW);
      // A second, shorter line one row down so the grid doesn't read as a
      // single stripe.
      await place('source', 0, ROW + 2);
      for (const x of [1, 2, 3]) await place('belt', x, ROW + 2);
      await place('add1', 4, ROW + 2);

      // TICK_MS is 550 and the source fires every 3 ticks; ~10 s is enough for
      // packets to be strung down both lines and for the log to fill.
      await wait(10000);
      await shot('line-running');
      const filled = await textContent(p, '#stat-orders');
      const cells = await p.$$eval('#grid .cell:not(.empty)', els => els.length);
      if (cells < 10) throw new Error(`only ${cells} tiles placed — palette or grid selectors moved`);
      return `${cells} tiles down, orders filled ${filled.trim()}`;
    },
  },

  // ---- Closing Time: the MLS Board is the screen that reads as the game — a
  // grid of listing cards with prices, neighbourhoods and days-on-market.
  'closing-time': {
    async play(p, { shot }) {
      // Burn a day so the ledger and the dashboard aren't day-one empty, then
      // land on the MLS board.
      await p.click('#endDayBtn').catch(() => {});
      await wait(400);
      await p.click('#nav [data-nav="mls"]');
      await p.waitForSelector('.mls-grid');
      await wait(600);
      await shot('mls-board');
      const cards = await p.$$eval('.mls-grid > *', els => els.length);
      if (cards < 3) throw new Error(`MLS board rendered ${cards} listings`);
      return `${cards} listings on the board`;
    },
  },

  // ---- Faire Weekend: builtPlots starts empty, so the site plan opens as a
  // bare field. Place four structures, commit them, and sit on the Fair Floor
  // tab — the grounds map with plots on it beside the running order is the
  // frame that says "management sim".
  'faire-weekend': {
    async play(p, { shot }) {
      // Cheapest kinds first — startingCash is 5200 and a Stage alone is 1700.
      for (const kind of ['demo', 'food', 'vendor', 'stage']) {
        await p.click(`[data-action="selectBuild"][data-kind="${kind}"]`);
        const ghost = await p.$('.plot-marker.ghost');
        if (!ghost) { await p.click('[data-action="cancelBuild"]').catch(() => {}); continue; }
        await ghost.click();
        await wait(150);
      }
      // Commit AFTER opening Fair Floor: the commit banner is rendered by
      // renderFairFloor, so clicking it while the Office tab is up finds nothing
      // and every plot stays a dashed "planned" outline.
      await p.click('[data-tab="fairfloor"]');
      await wait(300);
      await p.click('[data-action="commitAll"]').catch(() => {});
      await wait(400);
      // Clicking down the page scrolls it; the site plan is the subject.
      await p.evaluate(() => window.scrollTo(0, 0));
      await wait(400);
      await shot('grounds-and-floor');
      const plots = await p.$$eval('.plot-marker:not(.ghost):not(.blocked)', els => els.length);
      const built = await p.$$eval('.plot-card', els =>
        els.filter(e => /BUILT/i.test(e.textContent)).length);
      if (plots < 3) throw new Error(`only ${plots} plots on the grounds — build palette selectors moved`);
      return `${plots} plots on the plan, ${built} built`;
    },
  },

  // ---- Golden Hour: walk down the beach. This recipe used to need an `allow`
  // list so the hotlinked Poly Haven sand came through and the capture showed the
  // beach a visitor actually gets; session 7 vendored the texture, so there is
  // nothing left to allow.
  'golden-hour': {
    async play(p, { shot }) {
      // Walk toward the water, then swing round to put the sun and the waterline
      // in frame rather than a wall of empty beach. controls.js starts at
      // yaw = 0.15π (≈0.47) facing down the beach at the sun; +0.5 rad brings the
      // sea in on the right while keeping the sun's light in shot. +0.9 puts the
      // sun off-frame and the whole left half goes to unlit dune.
      await p.keyboard.down('KeyW'); await wait(3200); await p.keyboard.up('KeyW');
      await turnBy(p, { dyaw: 0.5, dpitch: -0.06, sens: 0.0022 });
      await wait(2500);                   // let the ocean settle into a wave
      await shot('shoreline');
      const c = await camState(p);
      return `walking at ${c.pos.join(', ')}, yaw ${c.yaw}`;
    },
  },

  // ---- Aphelion: click the title card, wait out the 2 s fade-from-black, walk
  // into the hab so the frame has ship interior in it, and catch the CERES
  // toast that lands at ~1.2 s — the HUD gauges plus that toast are the whole
  // identity of the game.
  'aphelion': {
    async play(p, { shot }) {
      await p.keyboard.down('KeyW'); await wait(1400); await p.keyboard.up('KeyW');
      await wait(1200);                   // toast lands at ~1.2 s after boarding
      await shot('aboard');
      const fade = await p.$eval('#fade', el => getComputedStyle(el).opacity);
      if (+fade > 0.15) throw new Error(`still faded to black (opacity ${fade})`);
      const c = await camState(p);
      return `aboard at ${c.pos.join(', ')}, fade ${fade}`;
    },
  },

  // ---- Castle Conundrum: the gatehouse across the courtyard, Guard in frame.
  // Coordinates match data/npcs.json, same as play-castle.mjs.
  //
  // The player does NOT walk to the Guard here — scene-config.json spawns them at
  // z = 8 and the Guard stands at z = 9.2, so the game opens 2.16 m from him,
  // already inside interaction.js's 3.2 m INTERACT_RANGE with "Press E to talk to
  // the Guard" on screen. So this backs AWAY up the courtyard and then turns
  // round: it gets the arch, the tower walls and a whole visible body in frame
  // instead of a chest-up crop behind a tooltip.
  'castle-conundrum': {
    async play(p, { shot }) {
      const GUARD = [1.8, 9.2];
      const NORTH = [0, -2];              // up the courtyard, away from the gate
      const STANDOFF = 6.4;               // comfortably outside INTERACT_RANGE
      const distToGuard = async () => {
        const c = await camState(p);
        return Math.hypot(c.pos[0] - GUARD[0], c.pos[1] - GUARD[1]);
      };

      // nearAt above any real distance keeps every stride short: WALK_SPEED is
      // 5.2 m/s, so a 400 ms stride is 2 m and overshoots a 6.4 m mark badly.
      const backed = await walkTo(p, NORTH, async () => (await distToGuard()) > STANDOFF,
                                  { nearAt: 999 });
      if (!backed) throw new Error(`never got ${STANDOFF}m clear of the gatehouse`);

      // A little pitch up: at pitch 0 the horizon lands dead centre and the
      // bottom 40% of the frame is empty courtyard flagstone.
      await aimAt(p, GUARD, 0.1);
      await wait(900);                    // let the Guard's idle clip breathe
      await shot('gatehouse');
      if (await p.evaluate(() =>
        !document.getElementById('interact-prompt').classList.contains('hidden')))
        throw new Error('an interact prompt is in the frame — too close to someone');
      const c = await camState(p);
      return `${(await distToGuard()).toFixed(2)}m off the gatehouse at ${c.pos.join(', ')}`;
    },
  },

  // ---- The Fourth Quarter: the day phase is an empty room with glowing
  // station rings; the night is the game. The player spawns at z=3.4 and the
  // door station sits at z=4.3 with a 1.6 m radius, so it's already the nearest
  // station — E opens Tonight straight away. Stock and crew come from the dev
  // menu first, or the night opens with bare shelves and nobody orders anything.
  'fourth-quarter': {
    async play(p, { shot }) {
      // (`enter()` cleared fq3d-save before the page booted, so this is day one
      // at the Corner Tap rather than whatever campaign was left in this browser.)
      //
      // Dev menu: cash and a full cellar. Debug-only by design (dev.js), which
      // is exactly what a capture should use rather than grinding a real night.
      await p.keyboard.press('Backquote');
      await p.waitForSelector('#devOverlay');
      await p.click('[data-cash="10000"]');
      await p.click('[data-fillstock="1"]');
      await p.click('#devClose');
      await wait(300);

      await p.keyboard.press('KeyE');     // door station — Tonight panel
      await p.waitForSelector('#panelOverlay [data-opendoors]', { timeout: 10000 });
      await p.click('[data-opendoors="1"]');
      await wait(1000);

      // Patrons trickle in over the first hour (hourLenSec 45). Wait for the
      // room to actually fill before shooting, and speed the clock up while
      // waiting.
      await p.click('[data-speed="2"]').catch(() => {});
      await waitFor(p,
        () => {
          const n = document.getElementById('hCrowd')?.textContent || '';
          return /\d/.test(n) && parseInt(n, 10) >= 4;
        },
        { timeout: 60000 }
      );
      await wait(2500);

      // Aim LAST, and only after re-locking the pointer.
      //
      // player.js starts at yaw = PI, facing the door the player just walked in
      // through — a blank wall — so aiming is not optional. Two things pin it to
      // the end: player.js's mousemove handler returns early unless pointer lock
      // is held, and every intervening Playwright click drags the real cursor
      // across the page, which while locked feeds movementX/Y straight into yaw
      // and pitch. This capture arrives having clicked through the dev menu and
      // the Tonight panel, and it lands about four whole turns of yaw away with
      // the pitch tipped at the floor. lookAt() measures first, so none of that
      // matters — turning by a fixed -PI from the assumed start does not work.
      await p.click('canvas');            // re-acquire lock; no MOUSE input after this
      await wait(200);
      // Step out of the doorway lane first: the spawn point is a metre inside the
      // door patrons come through, so standing there puts a passing head in the
      // lens. Keyboard is safe — only mouse movement disturbs the aim.
      await p.keyboard.down('KeyD'); await wait(700); await p.keyboard.up('KeyD');
      await wait(400);
      const c = await lookAt(p, { facing: 0, pitch: 0, sens: 0.0023 });
      if (Math.abs(c.facing) > 0.15 || Math.abs(c.pitch) > 0.15)
        throw new Error(`aim didn't take — facing ${c.facing}, pitch ${c.pitch}, wanted ~0/0`);
      await wait(600);

      // Three frames a few seconds apart, because where the patrons are standing
      // is not deterministic: they walk in through the door the camera is next to
      // and pick their own seats, so one roll of this puts a head in the lens and
      // the next has them all at the bar. chosen.json exists for exactly this —
      // pick the frame with a clear floor.
      await shot('open-for-business');
      for (const label of ['crowd-b', 'crowd-c']) {
        await wait(4000);
        await shot(label);
      }
      const crowd = (await textContent(p, '#hCrowd')).trim();
      const hour = (await textContent(p, '#hHour')).trim();
      return `night open, ${crowd} in the bar at ${hour}, facing ${c.facing}`;
    },
  },

  // ---- The Absalom Inheritance: the spawn is a lone figure in an unlit room;
  // the good frame is mid-encounter, with a woken sentinel, gold pillar
  // capstones in view, and the HP bars up. window.__absalom.renderer.screenToGrid
  // inverts the live isometric projection, so scan the canvas for the pixel
  // that maps to the square that wakes exactly one sentinel rather than
  // hardcoding tile math this recipe doesn't own.
  'absalom-inheritance': {
    async play(p, { shot }) {
      const canvas = await p.$('canvas');
      const box = await canvas.boundingBox();
      const target = await p.evaluate(({ w, h }) => {
        const r = window.__absalom?.renderer;
        if (!r || typeof r.screenToGrid !== 'function') return null;
        for (let y = 8; y < h; y += 6) {
          for (let x = 8; x < w; x += 6) {
            const g = r.screenToGrid(x, y);
            if (g && g.x === 10 && g.y === 13) return { x, y };
          }
        }
        return null;
      }, { w: box.width, h: box.height });
      if (!target) throw new Error('no canvas pixel maps to grid square (10,13) — projection or map moved');
      await p.mouse.click(box.x + target.x, box.y + target.y);
      const woke = await waitFor(p,
        () => window.__absalom?.game?.mode === 'combat'
          && window.__absalom.game.awake?.().length === 1,
        { timeout: 8000 }).then(() => true, () => false);
      await wait(300);
      await shot('encounter');
      if (!woke) throw new Error('walking to (10,13) did not start a single-sentinel encounter');
      return 'one sentinel woken, mid-encounter';
    },
  },

  // ---- Daredevil: the cold open's first choice screen is what the game is —
  // narration plus a branching decision — not the bare opening panel.
  'daredevil': {
    async play(p, { shot }) {
      // The cold open is nine scenes deep before the first real fork; measured
      // by hand at 14 Continues from the chapter card this session.
      let reached = false;
      for (let i = 0; i < 20; i++) {
        if (await p.$('.choices-list button')) { reached = true; break; }
        await p.click('.panel-continue').catch(() => {});
        await wait(450);
      }
      await shot('origin-choice');
      const choices = await p.$$eval('.choices-list button', els => els.length).catch(() => 0);
      if (!reached || !choices) throw new Error('never reached a choice screen — panel selectors moved');
      return `${choices} choices on screen`;
    },
  },

  // ---- The Fracture Cycle: the intro alone doesn't show what the game is.
  // Always taking the first option is a deterministic way to reach a real
  // ending screen without hand-authoring one path through the branch map.
  'fracture-cycle': {
    async play(p, { shot }) {
      let clicks = 0;
      for (; clicks < 10; clicks++) {
        const btn = await p.$('#choices button');
        if (!btn) break;
        await btn.click();
        await wait(300);
      }
      await wait(400);
      await shot('ending');
      const title = await p.$eval('#nodeTitle', el => el.textContent.trim()).catch(() => '');
      if (!title) throw new Error('no #nodeTitle text on the reached screen — node selectors moved');
      return `reached "${title}" after ${clicks} choices`;
    },
  },

  // ---- Corner & Kettle: games.mjs's open() already reaches the money shot —
  // a queue of waiting customers with a filled espresso cup at the Base
  // station — so this recipe is just the screenshot and the proof.
  'corner-and-kettle': {
    async play(p, { shot }) {
      await wait(500);
      await shot('first-shot');
      const shots = await p.evaluate(() => window.__CK_DEBUG__?.state?.slots?.[0]?.cup?.shots ?? 0);
      if (!(shots >= 1)) throw new Error(`cup only has ${shots} shots — station selectors moved`);
      return `first shot pulled, cup at ${shots} shot(s)`;
    },
  },

  // ---- Torchbearer: games.mjs's `open()` lands on the bridge-fog scene, the
  // committed save's checkpoint. One click into "Engage the pickets" starts
  // the Vanguard's Watch encounter — a 13x7 grid with 5 tokens, the shot
  // locked decision #28 wants (a frame that proves this is a tactical engine).
  'torchbearer': {
    async play(p, { shot }) {
      await p.click('.choice-btn');
      await waitFor(p, () => document.querySelectorAll('#grid .token').length > 0, { timeout: 10000 });
      await wait(400);
      await shot('vanguards-watch');
      const cells = await p.$$eval('#grid .cell', els => els.length);
      const tokens = await p.$$eval('#grid .token', els => els.length);
      if (cells !== 91 || tokens !== 5) throw new Error(`grid is ${cells} cells, ${tokens} tokens — recipe or map moved`);
      return `${cells}-cell grid, ${tokens} tokens, Vanguard's Watch`;
    },
  },

  // ---- Orbital: Deep Field (deepspace#11), games.mjs's open() already
  // loaded it. A real winning aim drag — world-space (dx:200, dy:-350) from
  // this level's own start — grazes a blackhole and a wormhole before the
  // goal (verified live, Claude Prompts/notes/21-orbital-notes.md), a real
  // curve rather than a straight line, so the preview reads as "this game
  // rewards reading the curve." Screenshot before pointerup: aim mode draws
  // the dotted flight plan; firing would replace it with the flight itself.
  'orbital': {
    async play(p, { shot }) {
      const view = await p.evaluate(() => ({ s: view.s, ox: view.ox, oy: view.oy }));
      const start = await p.evaluate(() => ({ x: probe.x, y: probe.y }));
      const toScreen = (wx, wy) => ({ x: wx * view.s + view.ox, y: wy * view.s + view.oy });
      const p0 = toScreen(start.x, start.y);
      const p1 = toScreen(start.x + 200, start.y - 350);

      await p.evaluate(({ x, y }) => {
        document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown',
          { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));
      }, p0);
      await wait(150);
      await p.evaluate(({ x, y }) => {
        document.getElementById('cv').dispatchEvent(new PointerEvent('pointermove',
          { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));
      }, p1);
      await wait(300);

      await shot('deep-field-aim');
      const outcome = await p.evaluate(() => plan?.outcome || null);
      if (outcome !== 'WIN') throw new Error(`drag plan outcome was "${outcome}", expected WIN — level or physics moved`);
      return `Deep Field, aim drawn, plan outcome ${outcome}`;
    },
  },
};

/* ------------------------------------------------------------------- run ---- */

const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);

const only = process.argv[2];
const names = Object.keys(RECIPES).filter(n => !only || n === only);
if (!names.length) {
  console.error(`no such recipe: ${only}\nknown: ${Object.keys(RECIPES).join(', ')}`);
  process.exit(2);
}

// Clear only what this run will replace. Wiping the whole folder would throw away
// six good captures every time someone re-runs one recipe to tune its framing,
// which is exactly what tuning framing involves.
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (names.some(n => f.startsWith(n + '-'))) fs.rmSync(path.join(OUT, f));
}

const server = await serve(PORT);
const browser = await launch({ headed: true });
// Merge, for the same reason: a single-recipe run shouldn't erase the report for
// the other six.
const reportPath = path.join(OUT, 'report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
let failures = 0;

for (const name of names) {
  // Everything but `play` comes from games.mjs.
  const rec = { ...GAMES[name], ...RECIPES[name] };
  console.log(`\n${name}`);
  const page = await prepPage(browser, BASE, {
    width: rec.vw, height: rec.vh, dsf: rec.dsf ?? 1, allow: rec.allow ?? [],
  });
  page.setDefaultTimeout(45000);

  const files = [];
  const shot = async label => {
    const f = path.join(OUT, `${name}-${String(files.length).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: f });
    files.push(f);
    return f;
  };
  const probe = async () => {
    if (!rec.three) return;
    await attachSceneProbe(page, rec.three);
    await waitForProbe(page);
  };

  const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); };
  const entry = report[name] = { files: [], checks: {} };

  try {
    // Load it, wipe any save this browser had for it, and play it in — games.mjs.
    await enter(page, name, { base: BASE, probe });
    const reached = await rec.play(page, { shot, probe, camState, aimAt, setYaw, walkTo, wait });
    ok('played into gameplay', reached);
    entry.reached = reached;

    // 1. Nothing that names itself an intro is still on screen.
    const upStill = await page.evaluate(sels => sels.filter(s => {
      const el = document.querySelector(s);
      if (!el) return false;
      const cs = getComputedStyle(el);
      return el.getClientRects().length > 0 && cs.opacity !== '0' && cs.visibility !== 'hidden';
    }), rec.intro);
    entry.checks.introGone = upStill.length === 0;
    if (upStill.length) bad('intro overlays gone', `still up: ${upStill.join(', ')}`);
    else ok('intro overlays gone', rec.intro.length ? rec.intro.join(', ') : '(none declared)');

    // 2. The frame is genuinely live, not a loaded-but-stalled still. Only
    //    meaningful for the games with a clock — see `live` in games.mjs.
    if (rec.live === false) {
      entry.checks.moving = null;
      console.log('  n/a   frame is moving  turn-based; a still frame is the playing state');
    } else {
      const a = await shot('motion-a');
      await wait(1600);
      const b = await shot('motion-b');
      entry.checks.moving = sha(a) !== sha(b);
      if (sha(a) === sha(b)) bad('frame is moving', 'two frames 1.6s apart are byte-identical');
      else ok('frame is moving');
    }

    // 3. Clean console.
    entry.checks.noErrors = page.__errs.length === 0;
    if (page.__errs.length) bad('no console errors', page.__errs.slice(0, 3).join(' | '));
    else ok('no console errors');

    entry.files = files.map(f => path.basename(f));
    entry.blocked = [...new Set(page.__blocked)];
    entry.allowedThrough = [...new Set(page.__allowed)];
    if (entry.blocked.length) console.log(`  note  refused offsite: ${entry.blocked.slice(0, 3).join(', ')}`);
    if (entry.allowedThrough.length) console.log(`  note  allowed offsite: ${entry.allowedThrough.slice(0, 2).join(', ')}`);
  } catch (e) {
    failures++;
    entry.error = String(e.message || e).slice(0, 200);
    console.log(`  FAIL  never reached gameplay  ${entry.error}`);
    await shot('aborted').catch(() => {});
    entry.files = files.map(f => path.basename(f));
    entry.errs = page.__errs.slice(0, 4);
  }
  await page.close();
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
await browser.close();
server.close();

console.log(`\n${failures ? `${failures} failure(s)` : `all ${names.length} reached gameplay`}`);
console.log(`candidates in ${path.relative(HERE, OUT)} — LOOK at them, then \`npm run promote\`.`);
process.exit(failures ? 1 : 0);
