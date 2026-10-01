// browser.mjs — Throneshard boots, plays a whole bot match, and ends it.
//
//   node Projects/throneshard/test/browser.mjs
//
// Exits non-zero on any failed check (#13). Screenshots in ./shots/.
//
// Borrows Tools/board-check's harness, as Orbital's suite does. The page runs
// under the harness's headless Chromium, which on Linux is software-rendered,
// so nothing here is timed (#53): the match is stepped with `game.fixedDt`
// and `game.tick()` from a stopped animation loop, with the renderer's draw
// calls stubbed out, and the checks are about what happened in game time.
//
// The player's hero is put on autoplay, so all ten heroes are bots. A match
// that has not ended by 70 game minutes is a failure: bot matches here end
// between roughly 25 and 50.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { waitFor } from '../../../Tools/board-check/drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const PORT = 8171; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = '/Projects/throneshard/';
const HERO = 'sera';
const CAP_MINUTES = 70;

fs.mkdirSync(OUT, { recursive: true });

let checks = 0, failures = 0;
function ok(cond, label, detail = '') {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
}

const srv = await serve(PORT);
const browser = await launch();
const problems = [];
try {
  const page = await prepPage(browser, BASE, { width: 1280, height: 720, dsf: 1 });
  page.on('pageerror', (e) => problems.push('pageerror: ' + (e?.message ?? e)));
  page.on('console', (m) => {
    const type = typeof m.type === 'function' ? m.type() : m.type;
    if (type === 'error' || type === 'warn' || type === 'warning') problems.push(`${type}: ${m.text()}`);
  });
  await page.goto(BASE + PAGE_URL, { waitUntil: 'load', timeout: 60000 });

  console.log('\nboot');
  let booted = true;
  try {
    await waitFor(page, () => !!(window.game?.ui && document.querySelector('.btn-play')), { timeout: 180000 });
  } catch { booted = false; }
  ok(booted, 'the loading screen gives way to the main menu');
  const title = await page.title();
  ok(title === 'Throneshard', 'the page is titled Throneshard', JSON.stringify(title));
  await page.screenshot({ path: path.join(OUT, '1-menu.png') });

  if (booted) {
    console.log('\nmatch');
    const start = await page.evaluate((heroId) => {
      const g = window.game;
      g.startMatch({ heroId });
      g.ai.setPlayerAutoplay?.(true);
      return { heroes: g.heroes.length, player: g.player.hero?.heroId, name: g.player.hero?.name };
    }, HERO);
    ok(start.heroes === 10, 'ten heroes take the field', `got ${start.heroes}`);
    ok(start.player === HERO, `the player is ${HERO}`, `got ${start.player} (${start.name})`);

    // Step in chunks so one evaluate never runs long enough to trip a protocol timeout.
    await page.evaluate(() => {
      const g = window.game;
      g.renderer.setAnimationLoop(null);
      g.__render = g.renderer.render.bind(g.renderer);
      g.__composer = g.composer;
      g.renderer.render = () => {};
      g.composer = null;
      g.fixedDt = 0.05;
    });
    let state = { time: 0, over: false };
    const capTicks = CAP_MINUTES * 60 * 20;
    for (let done = 0; done < capTicks && !state.over; done += 2400) {
      state = await page.evaluate((n) => {
        const g = window.game;
        for (let i = 0; i < n && !g.matchOver; i++) g.tick();
        return { time: g.time, over: g.matchOver, winner: g.winner, units: g.units.filter((u) => u.alive).length };
      }, 2400);
      if (done % 12000 === 0) console.log(`        ${(state.time / 60).toFixed(1)} min, ${state.units} units alive`);
    }
    const minutes = state.time / 60;
    ok(state.over, `the match ends inside ${CAP_MINUTES} game minutes`, `${minutes.toFixed(1)} min`);
    ok(state.winner === 'sunward' || state.winner === 'duskward', 'one team wins', String(state.winner));
    ok(minutes >= 15, 'the match lasts at least 15 game minutes', `${minutes.toFixed(1)} min`);

    // UI.js puts the end screen up 2.5 s of wall clock after match:end (a setTimeout,
    // not game time), so this waits on the DOM rather than ticking.
    let endAppeared = true;
    try { await waitFor(page, () => !!document.querySelector('.scr-end'), { timeout: 20000 }); }
    catch { endAppeared = false; }
    ok(endAppeared, 'the end screen appears within 20 s of the match ending');
    const after = await page.evaluate(() => {
      const g = window.game;
      g.renderer.render = g.__render;
      g.composer = g.__composer;
      const sc = g.rules?.score ?? {};
      const end = document.querySelector('.scr-end');
      return {
        endShown: !!end,
        endText: end?.textContent ?? '',
        kills: (sc.sunward ?? 0) + (sc.duskward ?? 0),
        levels: g.heroes.map((h) => h.level),
        items: g.heroes.map((h) => h.inventory.filter(Boolean).length),
      };
    });
    ok(after.endShown, 'the victory/defeat screen is shown');
    ok(/Victory|Defeat/.test(after.endText), 'the end screen says Victory or Defeat');
    ok(after.kills > 0, 'heroes died along the way', `${after.kills} kills`);
    ok(Math.min(...after.levels) >= 6, 'every hero reached level 6', `levels ${after.levels.join(',')}`);
    ok(Math.min(...after.items) >= 3, 'every hero holds at least three items', `items ${after.items.join(',')}`);
    await page.evaluate(() => window.game.renderer.render(window.game.scene, window.game.camera));
    await page.screenshot({ path: path.join(OUT, '2-end.png') });
  }

  console.log('\nconsole');
  ok(problems.length === 0, 'no page errors, console errors or warnings', problems.slice(0, 5).join(' | '));
  await page.close();
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
