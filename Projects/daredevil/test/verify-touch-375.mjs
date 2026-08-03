// verify-touch-375.mjs — one-off manual check, not part of the committed suite.
//
// Round 2 read bindHold() in engine.js and found it already uses pointer
// events (pointerdown/pointerup/pointercancel/pointerleave) plus touch-action:
// none on the canvas, pedals and D-pad, but explicitly declined to assert
// "fixed" on a code read alone. This drives the real Stunt Run pedal at a
// 375px, touch-enabled viewport (Playwright's hasTouch/isMobile context) and
// dispatches genuine pointerType:'touch' pointerdown/pointerup, then reads
// the DOM and mgActive.tele to confirm the hold actually registered and
// released. It is still not a physical device — see the readout at the
// bottom for exactly what this does and doesn't prove.
//
//   node Projects/daredevil/test/verify-touch-375.mjs

import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { open, pick, snapshot, wait, SAVE_KEY } from './drive-daredevil.mjs';

const PORT = 8151;

async function main() {
  const srv = await serve(PORT);
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await launch({ headed: false });
  const page = await prepPage(browser, base, { width: 375, height: 812, dsf: 2, mobile: true });

  let ok = true;
  const report = (label, pass, detail) => {
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!pass) ok = false;
  };

  try {
    await page.goto(base + '/Projects/daredevil/index.html', { waitUntil: 'load' });
    await page.evaluate(k => localStorage.removeItem(k), SAVE_KEY);
    await page.reload({ waitUntil: 'load' });
    await open(page, base, { name: 'Touch Test', town: 'Fingertip' });

    // Drain the cold open and Milestone 1 beats the same way the "clean" plan
    // does — take the first unlocked, non-continue option every time — until
    // the Stunt Run minigame is on screen.
    for (let i = 0; i < 80; i++) {
      const s = await snapshot(page);
      if (s.screen === 'minigame') break;
      if (s.screen === 'chapter') { await pick(page, s.buttons[0].label); await wait(650); continue; }
      if (s.screen === 'stats') { await pick(page, 'Continue'); await wait(200); continue; }
      if (s.screen === 'panel') {
        const choices = s.buttons.filter(b => !b.save && !/^— Continue —$|^Continue ›$/.test(b.label));
        if (choices.length === 0) { await pick(page, 'Continue'); await wait(120); continue; }
        const first = choices.find(c => !c.locked);
        await pick(page, first.label);
        await wait(120);
        continue;
      }
      throw new Error(`unexpected screen "${s.screen}" (scene ${s.scene}) while driving to the minigame. buttons: ${s.buttons.map(b=>b.label).join(' | ')}`);
    }

    const atMinigame = (await snapshot(page)).screen === 'minigame';
    report('reached the Stunt Run minigame', atMinigame);
    if (!atMinigame) throw new Error('never reached the minigame — see above');

    // Confirm the deck actually rendered pedals, not a different control type.
    const hasPedals = await page.evaluate(() => !!document.querySelector('.pedal.gas'));
    report('deck rendered pedal controls', hasPedals);

    // No horizontal overflow at 375px with the minigame's own deck on screen —
    // the same assertion smoke-page.mjs makes on the title/panel screens, now
    // checked against the minigame screen specifically.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report('no horizontal overflow with the minigame deck visible', overflow <= 0, `${overflow}px`);

    // touch-action:none actually computed on the elements a finger lands on.
    const touchAction = await page.evaluate(() => {
      const gas = document.querySelector('.pedal.gas');
      const canvas = document.querySelector('canvas');
      return {
        pedal: getComputedStyle(gas).touchAction,
        canvas: getComputedStyle(canvas).touchAction,
      };
    });
    report('pedal computed touch-action is none', touchAction.pedal === 'none', touchAction.pedal);
    report('canvas computed touch-action is none', touchAction.canvas === 'none', touchAction.canvas);

    // Hit-target size against the 44px/24px CSS-pixel guidance (WCAG 2.5.5/2.5.8).
    const box = await page.evaluate(() => {
      const r = document.querySelector('.pedal.gas').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    report('gas pedal hit target is at least 44x44 CSS px', box.w >= 44 && box.h >= 44, `${box.w}x${box.h}`);

    // The real check: dispatch pointerType:'touch' pointerdown, hold, read
    // telemetry, release, and confirm the hold both started and stopped.
    const before = await page.evaluate(() => window.__dd.mg.tele.v);
    await page.evaluate(() => {
      const el = document.querySelector('.pedal.gas');
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    });
    await wait(500);
    const heldMidway = await page.evaluate(() => document.querySelector('.pedal.gas').classList.contains('held'));
    const midway = await page.evaluate(() => window.__dd.mg.tele.v);
    await page.evaluate(() => {
      const el = document.querySelector('.pedal.gas');
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    });
    await wait(200);
    const releasedAfter = await page.evaluate(() => document.querySelector('.pedal.gas').classList.contains('held'));

    report('a touch pointerdown adds the .held class', heldMidway);
    report('the throttle speed rose while the touch pointer held gas', midway > before, `${before.toFixed(1)} -> ${midway.toFixed(1)}`);
    report('a touch pointerup removes the .held class', !releasedAfter);

    // pointercancel is the other release path (finger drags off the button,
    // or the OS interrupts the gesture) — confirm it also releases the hold.
    await page.evaluate(() => {
      const el = document.querySelector('.pedal.gas');
      const r = el.getBoundingClientRect();
      const down = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 2, isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', down));
    });
    await wait(150);
    const heldBeforeCancel = await page.evaluate(() => document.querySelector('.pedal.gas').classList.contains('held'));
    await page.evaluate(() => {
      const el = document.querySelector('.pedal.gas');
      el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 2 }));
    });
    await wait(100);
    const heldAfterCancel = await page.evaluate(() => document.querySelector('.pedal.gas').classList.contains('held'));
    report('pointercancel releases a held touch the same as pointerup', heldBeforeCancel && !heldAfterCancel);

  } finally {
    console.log(ok ? '\n  touch-control checks passed' : '\n  touch-control checks FAILED');
    await page.close();
    await browser.close();
    srv.close();
    process.exitCode = ok ? 0 : 1;
  }
}

await main();
