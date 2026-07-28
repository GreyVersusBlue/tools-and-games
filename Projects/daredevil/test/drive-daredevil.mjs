// drive-daredevil.mjs — the way into Daredevil and the way through it.
//
// Daredevil is a branching narrative with four canvas stunt runs bolted into
// the middle of it. Playing it by hand to an ending is ~250 clicks, and the
// two things a regression suite has to prove — that a branch still exists, and
// that a stunt still routes to the right outcome scene — are exactly the two
// things that fail silently when a refactor goes wrong. So the driver reads the
// live DOM every step, decides what screen it is looking at, and acts.
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

export const URL_PATH = '/Projects/daredevil_r4.html';
export const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- screens */

/** Which of the seven layers is on screen, plus the two overlays. */
export const where = page => page.evaluate(() => {
  const on = id => document.getElementById(id)?.classList.contains('active');
  if (document.getElementById('reporter')?.classList.contains('on')) return 'reporter';
  if (document.getElementById('chapter-transition')?.classList.contains('visible')) return 'chapter';
  for (const id of ['title', 'setup', 'panel', 'stats', 'minigame', 'hub', 'end'])
    if (on('screen-' + id)) return id;
  return 'none';
});

/** Everything a decision needs: the screen, the text on it, the clickable labels. */
export const snapshot = page => page.evaluate(() => {
  const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const on = id => document.getElementById(id)?.classList.contains('active');
  let screen = 'none';
  if (document.getElementById('reporter')?.classList.contains('on')) screen = 'reporter';
  else if (document.getElementById('chapter-transition')?.classList.contains('visible')) screen = 'chapter';
  else for (const id of ['title', 'setup', 'panel', 'stats', 'minigame', 'hub', 'end'])
    if (on('screen-' + id)) { screen = id; break; }

  const buttons = [...document.querySelectorAll(
    '.screen-layer.active button, .screen-layer.active .hub-card, ' +
    '#reporter.on button, .chapter-transition.visible button')]
    .filter(b => b.offsetParent !== null)
    .map(b => ({
      label: txt(b),
      locked: b.classList.contains('disabled') || b.disabled,
    }));

  return {
    screen,
    scene: typeof currentScene === 'string' ? currentScene : null,
    speaker: txt(document.getElementById('speaker-tag')),
    text: txt(document.getElementById('panel-text')),
    heading: txt(document.getElementById('ct-title')) || txt(document.getElementById('stat-update-h')),
    reason: txt(document.getElementById('stat-update-reason')),
    hub: txt(document.getElementById('hub-title')),
    verdict: txt(document.getElementById('rVerdict')),
    score: txt(document.getElementById('rScore')),
    detail: txt(document.getElementById('rDetail')),
    stats: typeof GS === 'object' ? { ...GS.stats } : null,
    rels: typeof GS === 'object' ? { ...GS.rels } : null,
    buttons,
  };
});

/** Click the first visible, unlocked control whose label contains `needle`. */
export async function pick(page, needle) {
  const hit = await page.evaluate(n => {
    const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const els = [...document.querySelectorAll(
      '.screen-layer.active button, .screen-layer.active .hub-card, ' +
      '#reporter.on button, .chapter-transition.visible button')]
      .filter(b => b.offsetParent !== null);
    const el = els.find(b =>
      txt(b).toLowerCase().includes(n.toLowerCase()) &&
      !b.classList.contains('disabled') && !b.disabled);
    if (!el) return null;
    el.click();
    return txt(el).slice(0, 120);
  }, needle);
  if (!hit) {
    const s = await snapshot(page);
    throw new Error(
      `no clickable "${needle}" on screen "${s.screen}" (scene ${s.scene}).\n` +
      `  visible: ${s.buttons.map(b => (b.locked ? '[locked] ' : '') + b.label.slice(0, 60)).join(' | ') || '(nothing)'}`);
  }
  await wait(90);
  return hit;
}

/* ------------------------------------------------------------- minigames */

/**
 * Play the active canvas minigame to its result ticket.
 *
 * `mode` is "good" (aim for a clean landing) or "crash" (pin the throttle and
 * let the drift take it). The stunt run's own numbers decide the rest: the
 * approach wants v near GREEN_C=485 at the lip, and the air wants the body
 * angle at the landing slope, -18deg. `w` is fed into the error term because a
 * plain proportional loop on angle alone oscillates straight through the band.
 *
 * The recovery minigame is a timing exercise; the driver lets it time out,
 * which is a legitimate way to finish it and only ever happens after a crash.
 */
export async function autopilot(page, mode = 'good', timeoutMs = 45000) {
  await page.evaluate(m => {
    window.__apStop = false;
    const TARGET_V = m === 'crash' ? 999 : 485;
    const TARGET_TH = -18;
    const tick = () => {
      if (window.__apStop) return;
      const a = typeof mgActive !== 'undefined' ? mgActive : null;
      const t = a && a.tele;
      if (a && t) {
        if (t.phase === 'approach') {
          a.onGas && a.onGas(t.v < TARGET_V - 8);
          a.onLean && a.onLean(m !== 'crash' && t.v > TARGET_V + 8);
        } else if (t.phase === 'air') {
          if (m === 'crash') { a.onGas && a.onGas(true); a.onLean && a.onLean(false); }
          else {
            const err = (t.th - TARGET_TH) + 0.22 * (t.w || 0);
            a.onGas && a.onGas(err < -1.5);
            a.onLean && a.onLean(err > 1.5);
          }
        } else {
          a.onGas && a.onGas(false);
          a.onLean && a.onLean(false);
        }
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
    const tele = await page.evaluate(() => (typeof mgActive !== 'undefined' && mgActive ? mgActive.tele : null));
    throw new Error(`minigame never finished in ${timeoutMs}ms; tele=${JSON.stringify(tele)}`);
  }
  return snapshot(page);
}

/* ------------------------------------------------------------------ boot */

export async function open(page, base, { name = '', town = '' } = {}) {
  await page.goto(base + URL_PATH, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await wait(250);
  await pick(page, 'Begin');
  if (name || town) {
    await page.evaluate(([n, t]) => {
      if (n) document.getElementById('inp-name').value = n;
      if (t) document.getElementById('inp-town').value = t;
    }, [name, town]);
  }
  await pick(page, 'Hit the Road');
  await wait(500);            // chapter overlay fades in
}

export async function boot({ headed = false, port = 8137 } = {}) {
  const srv = serve(port);
  const base = `http://127.0.0.1:${port}`;
  const browser = await launch({ headed });
  const page = await prepPage(browser, base, { width: 1280, height: 1000, dsf: 1 });
  return { srv, base, browser, page, async done() { await page.close(); await browser.close(); srv.close(); } };
}
