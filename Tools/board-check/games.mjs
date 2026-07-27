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
    async open(p) {
      await p.waitForSelector('.grounds-map');
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
