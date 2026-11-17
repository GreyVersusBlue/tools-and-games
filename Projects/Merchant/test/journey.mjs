// node test/journey.mjs
//
// MER-01: the page loads at three frames, shows the title screen honestly,
// and a keyboard can reach every button. Port 8190, through the site harness.
// Asserts against the DOM (#39), exits non-zero on any failure (#13).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, eq, ok, done } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, '..', '..', '..', 'Tools', 'board-check', 'harness.mjs');
const { serve, launch, prepPage } = await import(pathToFileURL(HARNESS).href);

const PORT = 8190;
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/Projects/Merchant/`;
const SHOTS = process.env.MERCHANT_SHOTS || path.join(os.homedir(), '.cache', 'merchant-scratch', 'MER-01');
fs.mkdirSync(SHOTS, { recursive: true });

const FRAMES = [
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'phone-upright', width: 390, height: 844 },
  { name: 'phone-side', width: 844, height: 390 },
];
const BUTTONS = ['New game', 'About this game', 'Settings'];

const server = await serve(PORT);
const browser = await launch();

async function open(frame) {
  const page = await prepPage(browser, BASE, { width: frame.width, height: frame.height, dsf: 1 });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForSelector('#screen-title');
  return { page, consoleErrors };
}

const ringOf = async page => page.evaluate(() => {
  const cs = getComputedStyle(document.activeElement);
  return { id: document.activeElement.id, outline: cs.outlineWidth, style: cs.outlineStyle, shadow: cs.boxShadow };
});

try {
  for (const frame of FRAMES) {
    const { page, consoleErrors } = await open(frame);
    const tag = `${frame.name} ${frame.width}x${frame.height}`;

    await test(`${tag}: title text and tagline`, async () => {
      eq(await page.$eval('h1', e => e.textContent), 'Merchant');
      ok((await page.$eval('.title-tagline', e => e.textContent)).startsWith('Cairo, 1324.'));
      eq(await page.title(), 'Merchant');
    });

    await test(`${tag}: three buttons, New game disabled with its reason visible`, async () => {
      const labels = await page.$$eval('.title-menu button', bs => bs.map(b => b.textContent.trim()));
      eq(labels, BUTTONS);
      eq(await page.$eval('#btn-new', b => b.disabled), true);
      eq(await page.$eval('#btn-about', b => b.disabled), false);
      eq(await page.$eval('#btn-settings', b => b.disabled), false);
      const reason = await page.$eval('#new-game-reason', e => ({
        text: e.textContent, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height,
        vis: getComputedStyle(e).visibility, desc: document.getElementById('btn-new').getAttribute('aria-describedby') }));
      eq(reason.text, 'The first playable season is being built. Come back soon.');
      ok(reason.w > 0 && reason.h > 0 && reason.vis === 'visible', 'reason line is not visible');
      eq(reason.desc, 'new-game-reason');
    });

    await test(`${tag}: no horizontal overflow`, async () => {
      const m = await page.evaluate(() => ({
        doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        body: [document.body.scrollWidth, document.body.clientWidth] }));
      eq(m.doc[0], m.doc[1], 'documentElement scrollWidth vs clientWidth');
      eq(m.body[0], m.body[1], 'body scrollWidth vs clientWidth');
    });

    await test(`${tag}: Tab reaches each enabled button with a visible focus ring`, async () => {
      await page.evaluate(() => document.activeElement.blur());
      const seen = [];
      for (let i = 0; i < 2; i++) { // New game is disabled, so two stops
        await page.keyboard.press('Tab');
        const r = await ringOf(page);
        seen.push(r.id);
        // DESIGN 6: a brass ring with a dark ring outside it, drawn as two
        // box-shadows in that order (brass first, so it sits inside).
        const brass = (r.shadow || '').indexOf('rgb(168, 121, 44)');
        const night = (r.shadow || '').indexOf('rgb(20, 17, 13)');
        ok(brass >= 0 && night > brass, `no brass-inside, dark-outside focus ring on ${r.id}: ${r.shadow}`);
      }
      ok(seen.includes('btn-about') && seen.includes('btn-settings'), `Tab visited ${seen.join(', ')}`);
      ok(!seen.includes('btn-new'), 'a disabled button took focus');
    });

    await test(`${tag}: no offsite request, no console error`, async () => {
      eq(page.__blocked, []);
      eq(page.__shimmed, []);
      eq(consoleErrors, []);
    });

    await page.screenshot({ path: path.join(SHOTS, `title-${frame.name}.png`) });
    await page.close();
  }

  // The two panels, at the laptop frame
  {
    const { page, consoleErrors } = await open(FRAMES[0]);
    await test('About opens a dialog, Esc closes it, focus returns to the button', async () => {
      await page.click('#btn-about');
      eq(await page.$eval('#panel-about', d => d.open), true);
      const text = await page.$eval('#panel-about', d => d.textContent);
      ok(text.includes('saves nothing yet'), 'About omits the no-save line');
      eq(await page.evaluate(() => location.hash), '#about');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('panel-about'));
      eq(await page.evaluate(() => document.activeElement.id), 'btn-about');
      await page.waitForFunction(() => location.hash === '#title');
    });
    await test('Settings switches apply at once', async () => {
      await page.click('#btn-settings');
      await page.click('#set-large');
      eq(await page.evaluate(() => document.documentElement.classList.contains('large-text')), true);
      await page.click('#set-motion');
      eq(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')), true);
      await page.click('#panel-settings-close');
      await page.waitForFunction(() => !document.getElementById('panel-settings'));
      eq(await page.evaluate(() => document.activeElement.id), 'btn-settings');
    });
    await test('an unknown hash goes to #title', async () => {
      await page.evaluate(() => { location.hash = '#nonsense'; });
      await page.waitForFunction(() => location.hash === '#title');
      ok(await page.$('#screen-title'));
    });
    await test('panels: no offsite request, no console error', async () => {
      eq(page.__blocked, []);
      eq(consoleErrors, []);
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
await done();
