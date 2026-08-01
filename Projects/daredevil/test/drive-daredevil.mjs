// drive-daredevil.mjs — the way into Daredevil and the way through it.
//
// Daredevil is a branching narrative with four canvas stunt runs bolted into
// the middle of it. Playing it by hand to an ending is ~700 clicks, and the two
// things a regression suite has to prove — that a branch still exists, and that
// a stunt still routes to the right outcome scene — are exactly the two things
// that fail silently when a refactor goes wrong. So the driver reads the live
// DOM every step, decides what screen it is looking at, and acts.
//
// Nothing here re-implements game logic. `pick()` matches the visible label of
// a real button and clicks it; if the button is gone, the run stops and says so.
//
// The stunt runs are played, not stubbed. `autopilot()` is a closed loop over
// `mgActive.tele` — the same telemetry the renderer draws from — holding the
// approach in the green band and steering the body angle toward the landing
// slope in the air. It scores SUCCESS reliably, which is what makes a triumph
// branch reachable at all from a script.

import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';

export const URL_PATH = '/Projects/daredevil/index.html';
export const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- screens */

// The two overlays float ON TOP of a layer that is still `.active` —
// `showChapter()` and `showMgResult()` never call `showScreen()`. So the set of
// things a player can actually click is the overlay's buttons when an overlay
// is up and the active layer's only when one isn't. Scanning both at once is
// how the first version of this driver clicked "Hit the Road" behind a chapter
// card six times and reported the game as dead-ended.
const PAGE_SCAN = function () {
  const on = id => document.getElementById(id)?.classList.contains('active');
  const reporter = document.getElementById('reporter');
  const chapter = document.getElementById('chapter-transition');
  if (reporter && reporter.classList.contains('on')) return { screen: 'reporter', root: reporter };
  if (chapter && chapter.classList.contains('visible')) return { screen: 'chapter', root: chapter };
  for (const id of ['title', 'setup', 'panel', 'stats', 'minigame', 'hub', 'end'])
    if (on('screen-' + id)) return { screen: id, root: document.getElementById('screen-' + id) };
  return { screen: 'none', root: null };
};

const PAGE_CONTROLS = function (scan) {
  const { root } = scan();
  if (!root) return [];
  return [...root.querySelectorAll('button, .hub-card')].filter(b => b.offsetParent !== null);
};

// A hub card that has been used keeps its full label and gains `.completed`,
// not `.disabled` — buildHubCard() just never attaches an onclick. So "is this
// clickable" has to ask three questions, and a driver that asks only about
// `.disabled` re-clicks a spent evening forever.
const PAGE_LOCKED = function (b) {
  if (b.disabled || b.classList.contains('disabled')) return true;
  if (b.classList.contains('completed')) return true;
  if (b.classList.contains('hub-card') && !b.onclick) return true;
  return false;
};

const TRIM = s => (s || '').replace(/\s+/g, ' ').trim();

/** Which of the seven layers is on screen, plus the two overlays. */
export const where = page => page.evaluate(scanSrc => {
  const scan = eval('(' + scanSrc + ')');
  return scan().screen;
}, PAGE_SCAN.toString());

/** Everything a decision needs: the screen, the text on it, the clickable labels. */
export const snapshot = page => page.evaluate(([scanSrc, ctlSrc, lockSrc]) => {
  const scan = eval('(' + scanSrc + ')');
  const controls = eval('(' + ctlSrc + ')');
  const locked = eval('(' + lockSrc + ')');
  const t = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const dd = window.__dd || {};
  return {
    screen: scan().screen,
    scene: typeof dd.scene === 'string' ? dd.scene : null,
    speaker: t(document.getElementById('speaker-tag')),
    text: t(document.getElementById('panel-text')),
    chapter: t(document.getElementById('ct-title')),
    update: t(document.getElementById('stat-update-h')),
    reason: t(document.getElementById('stat-update-reason')),
    hub: t(document.getElementById('hub-title')),
    verdict: t(document.getElementById('rVerdict')),
    score: t(document.getElementById('rScore')),
    detail: t(document.getElementById('rDetail')),
    stats: dd.GS ? { ...dd.GS.stats } : null,
    rels: dd.GS ? { ...dd.GS.rels } : null,
    flags: dd.GS ? { ...dd.GS.flags } : null,
    // `save` flags the gvb-save bar's own controls. They are real buttons on a
    // real screen, but clicking one is not a move in the story — a driver that
    // treats them as playable spends every hub turn exporting a file.
    buttons: controls(scan).map(b => ({ label: t(b), locked: locked(b), save: !!b.dataset.gvb })),
  };
}, [PAGE_SCAN.toString(), PAGE_CONTROLS.toString(), PAGE_LOCKED.toString()]);

/** Click the first visible, unlocked control whose label contains `needle`. */
export async function pick(page, needle) {
  const hit = await page.evaluate(([scanSrc, ctlSrc, lockSrc, n]) => {
    const scan = eval('(' + scanSrc + ')');
    const controls = eval('(' + ctlSrc + ')');
    const locked = eval('(' + lockSrc + ')');
    const t = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const el = controls(scan).find(b => t(b).toLowerCase().includes(n.toLowerCase()) && !locked(b));
    if (!el) return null;
    el.click();
    return t(el).slice(0, 140);
  }, [PAGE_SCAN.toString(), PAGE_CONTROLS.toString(), PAGE_LOCKED.toString(), needle]);

  if (!hit) {
    const s = await snapshot(page);
    throw new Error(
      `no clickable "${needle}" on screen "${s.screen}" (scene ${s.scene}).\n` +
      `  visible: ${s.buttons.map(b => (b.locked ? '[locked] ' : '') + b.label.slice(0, 60)).join(' | ') || '(nothing)'}`);
  }
  await wait(80);
  return TRIM(hit);
}

/* ------------------------------------------------------------- minigames */

/**
 * Play the active canvas minigame to its result ticket.
 *
 * `mode` is "good" (aim for a clean landing) or "crash" (pin the throttle and
 * let the drift take it). The stunt run's own numbers decide the rest: the
 * approach wants speed near GREEN_C=485 at the lip, and the air wants the body
 * angle at the landing slope, -18deg. `w` is in the error term because a plain
 * proportional loop on angle alone swings straight through the band and back.
 *
 * The recovery minigame is a timing exercise with a per-round clock; the driver
 * lets it time out, which finishes it honestly with a low score and only ever
 * happens after a crash anyway.
 *
 * Work the Crowd (new this round, wired to `_minigame_crowd_m1`) is a
 * "choices" minigame, not a "pedals" one: there is no `tele` to read a phase
 * off of, and the only way to know the right card is `mg.correctCall`, a
 * getter added to the game object for exactly this — the same move round 1
 * made adding `tele.w` for the stunt run. Without it, `good` mode has nothing
 * to click, the game self-resolves on its own per-round timeout into FAIL
 * every time, and `smoke-page.mjs`'s "every stunt the autopilot was asked to
 * land, it landed" assertion breaks the moment this minigame became
 * reachable — confirmed by running the suite before this branch existed.
 */
export async function autopilot(page, mode = 'good', timeoutMs = 60000) {
  await page.evaluate(m => {
    window.__apStop = false;
    const TARGET_V = m === 'crash' ? 9999 : 485;
    const TARGET_TH = -18;
    const tick = () => {
      if (window.__apStop) return;
      const a = (window.__dd && window.__dd.mg) || null;
      const t = a && a.tele;
      if (a && a.controlSpec && a.controlSpec.type === 'choices') {
        if (m !== 'crash' && typeof a.correctCall === 'string') a.onChoice(a.correctCall);
      } else if (a && t && a.onGas) {
        if (t.phase === 'approach') {
          a.onGas(t.v < TARGET_V - 8);
          a.onLean(m !== 'crash' && t.v > TARGET_V + 8);
        } else if (t.phase === 'air') {
          if (m === 'crash') { a.onGas(true); a.onLean(false); }
          else {
            const err = (t.th - TARGET_TH) + 0.22 * (t.w || 0);
            a.onGas(err < -1.5);
            a.onLean(err > 1.5);
          }
        } else { a.onGas(false); a.onLean(false); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, mode);

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await where(page) === 'reporter') break;
    await wait(200);
  }
  await page.evaluate(() => { window.__apStop = true; });
  if (await where(page) !== 'reporter') {
    const tele = await page.evaluate(() => (window.__dd && window.__dd.mg ? window.__dd.mg.tele : null));
    throw new Error(`minigame never finished in ${timeoutMs}ms; tele=${JSON.stringify(tele)}`);
  }
  return snapshot(page);
}

/* ------------------------------------------------------------------ boot */

export const SAVE_KEY = 'daredevil-save-v1';

export async function open(page, base, { name = '', town = '', wipe = true } = {}) {
  await page.goto(base + URL_PATH, { waitUntil: 'load' });
  if (wipe) {
    // Clear the key and reload. Clearing without a reload does nothing: the
    // module has already read the save and put Continue on the title screen.
    await page.evaluate(k => localStorage.removeItem(k), SAVE_KEY);
    await page.reload({ waitUntil: 'load' });
  }
  await page.evaluate(() => document.fonts.ready);
  await wait(200);
  await pick(page, 'Begin');
  if (name || town) {
    await page.evaluate(([n, t]) => {
      if (n) document.getElementById('inp-name').value = n;
      if (t) document.getElementById('inp-town').value = t;
    }, [name, town]);
  }
  await pick(page, 'Hit the Road');
  await wait(450);            // the chapter overlay fades in over 400ms
}

export async function boot({ headed = false, port = 8137 } = {}) {
  const srv = await serve(port);
  const base = `http://127.0.0.1:${port}`;
  const browser = await launch({ headed });
  const page = await prepPage(browser, base, { width: 1280, height: 1000, dsf: 1 });
  return {
    srv, base, browser, page,
    async done() { await page.close(); await browser.close(); srv.close(); },
  };
}
