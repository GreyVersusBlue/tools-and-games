// games.mjs — one description per playable project on the board: where it lives,
// what size frame it wants, which copy of three.js its import map resolves, which
// overlays count as "intro", where it keeps its save, and the moves that get a
// fresh page from the URL to a state where the game is actually being played.
//
// Two scripts need all of that and then diverge: capture-previews.mjs frames a
// screenshot, play-games.mjs asserts the game works. Session 6 wrote the openings
// inside capture-previews' recipes; session 7 needed the same seven openings for
// the regression suite, which is the second copy drive.mjs's whole existence is an
// argument against. So they live here once.
//
// What belongs in an `open()`: the clicks and waits between a blank page and the
// first frame of play, and nothing else. No framing, no assertions beyond "this
// didn't happen, so stop" — the callers own those.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitFor, setFiles } from './drive.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Waits for an element that is hidden BY DEFINITION — see the note in enter(). */
const attached = { state: 'attached' };
const wait = ms => new Promise(r => setTimeout(r, ms));

export const GAMES = {
  // ---- Integer Foundry: a factory-line idle game in one HTML file. Nothing to
  // dismiss; the grid is up as soon as the script has run.
  'integer-foundry': {
    title: 'Integer Foundry',
    url: '/Projects/integer-foundry.html',
    vw: 990, vh: 600, dsf: 2,
    saveKey: 'integer-foundry-save-v1',
    intro: [],
    async open(p) {
      await p.waitForSelector('#grid .cell');
      await p.waitForSelector('#tools .tool-btn');
    },
  },

  // ---- Closing Time: a DOM career sim behind a brokerage-choice modal.
  'closing-time': {
    title: 'Closing Time',
    url: '/Projects/Closing Time/',
    vw: 990, vh: 600, dsf: 2,
    saveKey: 'closingTime.save.v1',
    intro: ['.start-screen'],
    live: false,
    async open(p, { brokerage = 'bk_hearthstone' } = {}) {
      // boot() awaits loadAll() before it renders anything, so wait for whichever
      // of the two openings turns up: main.js shows the brokerage modal only when
      // there is no save to resume, and play-games reloads mid-career on purpose.
      // Testing for `.start-screen` without waiting first finds neither and then
      // waits out the full timeout on a nav that is never coming.
      await p.waitForSelector('.start-screen, #nav [data-nav]');
      if (await p.$('.start-screen')) await p.click(`[data-bk="${brokerage}"]`);
      await p.waitForSelector('#nav [data-nav="mls"]');
    },
  },

  // ---- Faire Weekend: the site plan and the desk, side by side. 1320 wide on
  // purpose: style.css drops #board to one column below 1080px, and at 990 the
  // site plan stacks above the desk and scrolls out of frame entirely.
  'faire-weekend': {
    title: 'Faire Weekend',
    url: '/Projects/Ren-Faire-Claude/',
    vw: 1320, vh: 800, dsf: 2,
    saveKey: 'renn-faire-sim-save-v1',
    intro: [],
    live: false,
    // A report is on disk while it's on screen as of this session (Stage 21),
    // so a reload can legitimately resume on a report/weekendEnd/victory/
    // gameOver phase — `.ticket-stub` — rather than the planning phase's
    // `.grounds-map`. Wait for whichever the saved phase actually is.
    async open(p) {
      await p.waitForSelector('.grounds-map, .ticket-stub');
    },
  },

  // ---- Golden Hour: click the overlay, not the canvas. main.js binds `begin` to
  // #overlay, and while it's up it covers #scene, so a canvas click never lands.
  'golden-hour': {
    title: 'Golden Hour',
    url: '/Projects/golden-hour-beach/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/golden-hour-beach/libs/three.module.js',
    intro: ['#overlay'],
    // No `allow` list any more: session 7 vendored the sand texture terrain.js
    // used to hotlink from dl.polyhaven.org, so this page is served entirely from
    // the site like every other one. `prepPage`'s allow option stays in the
    // harness — it's general, and it is now unused.
    async open(p, { probe } = {}) {
      await p.waitForSelector('#scene');
      if (probe) await probe();
      await p.click('#overlay');                       // trusted click: begins + locks
      await p.waitForSelector('#overlay.hidden', attached);
      await wait(1200);
    },
  },

  // ---- Aphelion: title card, then a 2 s fade from black.
  'aphelion': {
    title: 'Aphelion',
    url: '/Projects/aphelion/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/aphelion/libs/three.module.js',
    saveKey: 'aphelion-save-v1',
    intro: ['#title'],
    async open(p, { probe } = {}) {
      await p.waitForSelector('#title:not(.hidden)');
      if (probe) await probe();
      await p.click('#title');
      await p.waitForSelector('#title.hidden', attached);
      await wait(2600);                                 // UI.fade(false, 2) plus a beat
    },
  },

  // ---- Castle Conundrum. play-castle.mjs deliberately keeps its own richer boot
  // (it asserts the loading status, the rigs and the pointer lock on the way in);
  // this is the plain version, for the two scripts that just want to be inside.
  'castle-conundrum': {
    title: 'Castle Conundrum',
    url: '/Projects/Castle%20Conundrum/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/Castle%20Conundrum/libs/three.module.js',
    intro: ['#start-overlay', '#loading-screen'],
    async open(p, { probe } = {}) {
      await p.waitForSelector('#start-overlay:not(.hidden)', { timeout: 90000 });
      if (probe) await probe();
      await p.click('#start-button');
      await wait(600);
      if (!(await p.evaluate(() => !!document.pointerLockElement)))
        throw new Error('no pointer lock — is this running headed?');
    },
  },

  // ---- The Fourth Quarter: the start overlay, then the day phase.
  'fourth-quarter': {
    title: 'The Fourth Quarter',
    url: '/Projects/fourth-quarter/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/fourth-quarter/libs/three.module.js',
    saveKey: 'fq3d-save',
    intro: ['#startOverlay'],
    // `start: false` stops at the start overlay instead of taking the floor. The
    // overlay is where the shared save bar lives, so the regression suite needs
    // it up; a screenshot needs it gone.
    async open(p, { probe, start = true } = {}) {
      await p.waitForSelector('#startBtn');
      if (probe) await probe();
      if (!start) return;
      await p.click('#startBtn');
      await wait(800);
    },
  },

  // ---- The Absalom Inheritance: no title screen and no intro overlay — the
  // isometric board is up as soon as window.__absalom exists. Plain canvas, no
  // three.js.
  'absalom-inheritance': {
    title: 'The Absalom Inheritance',
    url: '/Projects/absalom_inheritance.html',
    vw: 1280, vh: 800, dsf: 1,
    saveKey: 'absalom-inheritance-save-v1',
    intro: [],
    // Turn-based: the engine resolves a whole turn instantly and hands back a
    // script for ui.js to play back, but the board sits still between inputs.
    // Locked decision #29.
    live: false,
    async open(p) {
      await waitFor(p, () => !!window.__absalom);
    },
  },

  // ---- Daredevil: the title screen, the setup screen (default name/town), then
  // the first chapter card. Turn-based prose — see locked decision #29.
  'daredevil': {
    title: 'Daredevil',
    url: '/Projects/daredevil/index.html',
    vw: 1280, vh: 800, dsf: 1,
    saveKey: 'daredevil-save-v1',
    intro: [],
    live: false,
    async open(p) {
      await p.waitForSelector('#btn-begin');
      await p.click('#btn-begin');
      await wait(200);
      await p.click('#btn-start');       // accepts the default name and town
      await wait(600);
      await p.click('#ct-btn');          // the chapter card
      await wait(700);
    },
  },

  // ---- The Fracture Cycle: a single-file CYOA. First frame of play is the
  // intro node with its choices rendered — nothing to dismiss before it.
  'fracture-cycle': {
    title: 'The Fracture Cycle',
    url: '/Projects/the-fracture-cycle.html',
    vw: 1280, vh: 800, dsf: 1,
    saveKey: 'fracture-cycle-v1',
    intro: [],
    live: false,
    async open(p) {
      await p.waitForSelector('#choices button');
    },
  },

  // ---- Corner & Kettle: click a waiting customer, open the Base station, pull
  // a shot. Three clicks to a filled cup, per locked decision #28.
  'corner-and-kettle': {
    title: 'Corner & Kettle',
    url: '/Projects/coffee_shop_sim.html',
    vw: 1280, vh: 800, dsf: 1,
    saveKey: 'cornerKettleSave_v1',
    intro: [],
    live: false,
    async open(p) {
      await p.waitForSelector('.customer');
      await p.click('.customer');
      await p.click('.stationTab[data-tab="base"]');
      await p.click('#btnEspresso');
      await waitFor(p,
        () => window.__CK_DEBUG__?.state?.slots?.[0]?.cup?.shots >= 1,
        { timeout: 10000 });
    },
  },

  // ---- Torchbearer: Shelf-load the Thornwake Vigil pack, then import the
  // committed mid-combat save rather than building a hero from scratch. Lands
  // straight on the Vanguard's Watch encounter (a 13x7 grid, 5 tokens) — the
  // fixture torchbearer/js/save.js's own test suite already asserts round-trips
  // clean, generated by actually playing the builder, per that project's own
  // notes on why a blind-built save was refused for two rounds.
  'torchbearer': {
    title: 'Torchbearer',
    url: '/Projects/torchbearer.html',
    vw: 1280, vh: 800, dsf: 1,
    saveKey: 'torchbearer-save',
    intro: [],
    live: false,
    async open(p) {
      await p.waitForSelector('[data-shelf="thornwake-vigil"]');
      await p.click('[data-shelf="thornwake-vigil"]');
      await waitFor(p,
        () => document.querySelector('[data-shelf="thornwake-vigil"]')?.getAttribute('aria-disabled') === 'true',
        { timeout: 10000 });
      // applyPack() opens a "Content Loaded" modal on success. #modal-veil is a
      // full-screen overlay (inset:0, z-index:100) — left open, it sits on top
      // of #save-bar and a click meant for the import button lands on the veil
      // instead, so no file chooser ever opens. Close it before importing.
      await waitFor(p, () => document.getElementById('modal-veil')?.classList.contains('open'), { timeout: 10000 });
      await p.click('#modal-foot button');
      await waitFor(p, () => !document.getElementById('modal-veil')?.classList.contains('open'), { timeout: 5000 });
      await setFiles(p, path.join(SITE, 'Projects/torchbearer/test/sera-voss.torchsave.json'),
        () => p.click('#save-bar [data-gvb="import"]'));
      await waitFor(p, () => window.__torchbearer?.sceneId === 'bridge-fog', { timeout: 10000 });
    },
  },

  // ---- Orbital: a gravity flight-plan puzzle. Sector grid cells unlock only
  // once the previous level has a progress record (buildGrid()'s own rule,
  // js/game.js) — cell 21 (deepspace#11, "Deep Field") needs deepspace#10
  // played first, so seed just that one key rather than the whole chain.
  'orbital': {
    title: 'Orbital',
    url: '/Projects/orbital/',
    vw: 1320, vh: 800, dsf: 1,
    saveKey: 'orbital_progress_v2',
    intro: ['#introScrim'],
    async open(p, { probe } = {}) {
      await p.evaluate(key => localStorage.setItem(key, JSON.stringify({ 'deepspace#10': 1 })),
        'orbital_progress_v2');
      await p.reload({ waitUntil: 'load' });
      await p.waitForSelector('#btnStart');
      if (probe) await probe();
      await p.click('#btnStart');
      await waitFor(p, () => !document.getElementById('introScrim').classList.contains('show'),
        { timeout: 5000 });
      await p.click('#btnLevels');
      await waitFor(p, () => document.getElementById('lvlScrim').classList.contains('show'),
        { timeout: 5000 });
      // 0-based: ten `basics` cells then deepspace#11 is the 12th of that pack.
      const cells = await p.$$('#lvlGrid .cell');
      if (cells.length < 22) throw new Error(`sector grid has ${cells.length} cells, expected >= 22`);
      await cells[21].click();
      await waitFor(p, () => !document.getElementById('lvlScrim').classList.contains('show'),
        { timeout: 5000 });
    },
  },
};

export const NAMES = Object.keys(GAMES);

/**
 * Load a game and play it in.
 *
 * `wipe` clears the game's save BEFORE the page that reads it boots, which is why
 * it reloads: the module has already read localStorage and built its state by the
 * time this runs, so removing the key without a reload leaves the stale campaign
 * in memory. Passing `wipe: false` is how a script tests that a save resumes.
 *
 * `probe` is the caller's scene-probe hook (drive.mjs's attachSceneProbe +
 * waitForProbe). It runs inside `open()` at the point that game is ready for it,
 * which for the three.js games is before the click that starts them.
 *
 * A trap worth knowing, since three of these openings depend on it:
 * `waitForSelector('#title.hidden')` defaults to `state: 'visible'`, and an
 * element that is hidden by definition never becomes visible — so the default
 * waits out the entire timeout instead of resolving immediately.
 */
export async function enter(page, name, { base, probe = null, wipe = true, open = {} } = {}) {
  const g = GAMES[name];
  if (!g) throw new Error(`no such game: ${name}`);
  await page.goto(base + g.url, { waitUntil: 'load', timeout: 45000 });
  if (wipe && g.saveKey) {
    const had = await page.evaluate(k => {
      const h = localStorage.getItem(k) !== null;
      localStorage.removeItem(k);
      return h;
    }, g.saveKey);
    if (had) await page.reload({ waitUntil: 'load', timeout: 45000 });
  }
  await g.open(page, { probe, ...open });
  return g;
}

/** The game's save as the game left it, parsed, or null. */
export const savedState = (page, name) =>
  page.evaluate(k => {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }, GAMES[name].saveKey);

export { wait };
