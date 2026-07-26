// shoot-board.mjs — render the board to PNGs you can actually look at.
//
// Writes into ./shots/ (gitignored). Covers the states that are easy to break
// and impossible to check by reading CSS:
//
//   board-<w>.png     full page at each breakpoint
//   cards-new.png     the four data-new cards, where three corner elements meet
//   services.png      Town Services stamps
//   filter-sim.png    ledger rail with a tag active
//   suite-lit.png     the PF2e cross-link lit
//   nojs.png          JS disabled: no rail, no ribbons, no flags, still usable
//   404.png           served for a subpath, which is how Pages serves it
//
// Also prints any offsite URL the page tried to reach. Those are real runtime
// dependencies on somebody else's uptime.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage, settle } from './harness.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const pause = ms => new Promise(r => setTimeout(r, ms));

const server = await serve(PORT);
const browser = await launch();
const offsite = new Set();
const note = [];

/* --- full page at each breakpoint ---------------------------------------- */
for (const w of [390, 700, 1024, 1280]) {
  const page = await prepPage(browser, BASE, { width: w, height: 1000, dsf: 2, mobile: w < 500 });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await settle(page);
  await page.screenshot({ path: `${OUT}/board-${w}.png`, fullPage: true });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  note.push(`board-${w}.png  horizontal overflow: ${overflow}`);
  page.__blocked.forEach(u => offsite.add(u));
  await page.close();
}

/* --- detail states -------------------------------------------------------- */
const page = await prepPage(browser, BASE, { width: 1024, height: 1100, dsf: 3 });
await page.goto(BASE + '/', { waitUntil: 'load' });
await settle(page);

// the four data-new cards in one frame
const band = await page.evaluate(() => {
  const ns = [...document.querySelectorAll('.notice[data-new]')];
  const boxes = ns.map(n => n.getBoundingClientRect());
  const top = Math.min(...boxes.map(b => b.top)) + window.scrollY;
  const bot = Math.max(...boxes.map(b => b.bottom)) + window.scrollY;
  return { top: top - 30, height: bot - top + 60, count: ns.length };
});
await page.screenshot({ path: `${OUT}/cards-new.png`,
  clip: { x: 0, y: band.top, width: 1024, height: band.height } });
note.push(`cards-new.png  ${band.count} data-new cards`);

// ledger filter
const filt = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#ledger button')];
  const sim = chips.find(c => /SIM/i.test(c.textContent));
  sim.click();
  return {
    visible: [...document.querySelectorAll('#quest-board .notice')].filter(n => !n.classList.contains('filtered-out')).length,
    live: document.querySelector('#ledger [aria-live]')?.textContent.trim(),
    pressed: chips.filter(c => c.getAttribute('aria-pressed') === 'true').length,
  };
});
await pause(400);
await page.screenshot({ path: `${OUT}/filter-sim.png` });
note.push(`filter-sim.png  ${filt.visible} visible, ${filt.pressed} chip pressed, live="${filt.live}"`);
await page.evaluate(() => [...document.querySelectorAll('#ledger button')].find(c => /ALL/i.test(c.textContent)).click());

// suite cross-link
const suite = await page.evaluate(() => {
  const m = document.querySelector('.suite');
  m?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { marks: document.querySelectorAll('.suite').length, lit: document.querySelectorAll('.suite-lit').length };
});
await pause(500);
await page.screenshot({ path: `${OUT}/suite-lit.png` });
note.push(`suite-lit.png  ${suite.lit} of ${suite.marks} lit`);
await page.evaluate(() => document.querySelector('.suite')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

// town services
const svc = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.board')].pop();
  const r = b.getBoundingClientRect();
  window.scrollTo(0, r.top + window.scrollY - 110);
  return b.querySelectorAll('.notice').length;
});
await pause(400);
await page.screenshot({ path: `${OUT}/services.png` });
note.push(`services.png  ${svc} service cards`);

// hover unfurl, if any preview images exist yet
const unfurl = await page.evaluate(() => document.querySelectorAll('.unfurl').length);
if (unfurl) {
  const el = await page.$('.notice[data-preview]');
  await el.hover();
  await pause(700);
  const b = await el.boundingBox();
  await page.screenshot({ path: `${OUT}/hover-unfurl.png`,
    clip: { x: Math.max(0, b.x - 60), y: Math.max(0, b.y - 60), width: b.width + 260, height: b.height + 160 } });
}
note.push(`.unfurl elements attached: ${unfurl}  (0 means no preview JPEGs exist yet)`);
page.__blocked.forEach(u => offsite.add(u));
await page.close();

/* --- no JS ---------------------------------------------------------------- */
{
  const p = await prepPage(browser, BASE, { width: 1024, height: 1000, dsf: 2 });
  await p.setJavaScriptEnabled(false);
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await pause(900);
  await p.screenshot({ path: `${OUT}/nojs.png`, fullPage: true });
  note.push('nojs.png  rail, ribbons and flags should all be absent; seals and cards should not be');
  await p.close();
}

/* --- 404 on a subpath ----------------------------------------------------- */
{
  const p = await prepPage(browser, BASE, { width: 1024, height: 900, dsf: 2 });
  await p.goto(BASE + '/Projects/nope/', { waitUntil: 'load' });
  await settle(p);
  await p.screenshot({ path: `${OUT}/404.png` });
  const links = await p.evaluate(() => [...document.querySelectorAll('a')].map(a => a.getAttribute('href')));
  const relative = links.filter(h => h && !h.startsWith('/'));
  note.push(`404.png  links ${links.join(' ')}${relative.length ? '   RELATIVE LINKS WILL BREAK: ' + relative.join(' ') : ''}`);
  await p.close();
}

console.log(note.join('\n'));
console.log('\noffsite requests attempted:', offsite.size ? '\n  ' + [...offsite].join('\n  ') : 'none');
console.log('\nwrote', fs.readdirSync(OUT).length, 'files to', OUT);

await browser.close();
server.close();
