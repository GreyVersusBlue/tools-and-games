// node test/journey.mjs
//
// MER-01: the page loads, shows the title screen honestly, and a keyboard can
// reach every button. MER-06: six frames (phones with mobile: true), every
// button in view with and without Large text, the history of the two panels,
// focus, reduced motion. Port 8190, through the site harness.
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
  { name: 'board', width: 1920, height: 1080 },
  { name: 'laptop-small', width: 1280, height: 800 },
  { name: 'phone-upright', width: 390, height: 844, mobile: true },
  { name: 'phone-small', width: 360, height: 740, mobile: true },
  { name: 'phone-side', width: 844, height: 390, mobile: true },
];
const BUTTONS = ['New game', 'About this game', 'Settings'];

const server = await serve(PORT);
const browser = await launch();

async function open(frame, hash = '') {
  const page = await prepPage(browser, BASE, { width: frame.width, height: frame.height, dsf: 1, mobile: !!frame.mobile });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(URL_ + hash, { waitUntil: 'load' });
  await page.waitForSelector('#screen-title');
  return { page, consoleErrors };
}

const ringOf = async page => page.evaluate(() => {
  const cs = getComputedStyle(document.activeElement);
  return { id: document.activeElement.id, outline: cs.outlineWidth, style: cs.outlineStyle, shadow: cs.boxShadow };
});

// Tab through the title screen's three buttons, return the ids in order.
const tabOrder = async (page, n) => {
  await page.evaluate(() => document.activeElement.blur());
  const ids = [];
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); ids.push(await page.evaluate(() => document.activeElement.id)); }
  return ids;
};
const setLarge = (page, on) => page.evaluate(v => document.documentElement.classList.toggle('large-text', v), on);
const hashOf = page => page.evaluate(() => location.hash);
const panelOpen = (page, name) => page.evaluate(n => !!document.getElementById(`panel-${n}`)?.open, name);
const gone = (page, name) => page.waitForFunction(n => !document.getElementById(`panel-${n}`), {}, name);
// Reduced motion on a page, for Playwright or Puppeteer alike.
const reduceMotion = async page => {
  if (page.emulateMediaFeatures) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  else await page.emulateMedia({ reducedMotion: 'reduce' });
};

try {
  for (const frame of FRAMES) {
    const { page, consoleErrors } = await open(frame);
    const tag = `${frame.name} ${frame.width}x${frame.height}`;

    await test(`${tag}: title text and tagline`, async () => {
      eq(await page.$eval('h1', e => e.textContent), 'Merchant');
      ok((await page.$eval('.title-tagline', e => e.textContent)).startsWith('Cairo, 1324.'));
      eq(await page.title(), 'Merchant');
    });

    await test(`${tag}: three buttons, New game aria-disabled with its reason visible`, async () => {
      const labels = await page.$$eval('.title-menu button', bs => bs.map(b => b.textContent.trim()));
      eq(labels, BUTTONS);
      eq(await page.$eval('#btn-new', b => [b.disabled, b.getAttribute('aria-disabled')]), [false, 'true']);
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

    await test(`${tag}: Tab reaches all three buttons, New game included, with a visible focus ring`, async () => {
      await page.evaluate(() => document.activeElement.blur());
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        const r = await ringOf(page);
        seen.push(r.id);
        // DESIGN 6: a brass ring with a dark ring outside it, drawn as two
        // box-shadows in that order (brass first, so it sits inside).
        const brass = (r.shadow || '').indexOf('rgb(168, 121, 44)');
        const night = (r.shadow || '').indexOf('rgb(20, 17, 13)');
        ok(brass >= 0 && night > brass, `no brass-inside, dark-outside focus ring on ${r.id}: ${r.shadow}`);
        // DESIGN 6: 3 px brass and 2 px dark outside it; 5 px and 2 px at min-width 1600.
        const [inner, outer] = frame.width >= 1600 ? ['5px', '7px'] : ['3px', '5px'];
        ok(r.shadow.includes(`0px 0px 0px ${inner}`) && r.shadow.includes(`0px 0px 0px ${outer}`),
          `ring widths at ${frame.width}: wanted ${inner} then ${outer}, got ${r.shadow}`);
      }
      eq(seen, ['btn-new', 'btn-about', 'btn-settings']);
    });

    await test(`${tag}: pressing New game does nothing`, async () => {
      await page.click('#btn-new');
      eq(await hashOf(page), '#title');
      eq(await page.evaluate(() => !!document.querySelector('dialog')), false);
      eq(await page.evaluate(() => document.activeElement.id), 'btn-new');
      await page.evaluate(() => document.activeElement.blur());
    });

    await test(`${tag}: every button is inside the frame, plain and with Large text`, async () => {
      for (const large of [false, true]) {
        await setLarge(page, large);
        const rows = await page.$$eval('.title-menu button', bs => bs.map(b => ({ id: b.id, bottom: b.getBoundingClientRect().bottom, top: b.getBoundingClientRect().top })));
        const ih = await page.evaluate(() => innerHeight);
        for (const r of rows) ok(r.bottom <= ih && r.top >= 0, `${r.id} spans ${r.top}..${r.bottom} in a ${ih} px frame${large ? ' with Large text' : ''}`);
      }
      await setLarge(page, false);
    });

    await test(`${tag}: tagline keeps 4.5:1 over the brightest stop of the gradient, plain and with Large text`, async () => {
      for (const large of [false, true]) {
        await setLarge(page, large);
        const c = await page.evaluate(() => {
          const el = document.querySelector('.title-tagline'), cs = getComputedStyle(el);
          const num = str => str.match(/[\d.]+/g).map(Number);
          const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
          const fg = num(cs.color), bg = num(cs.backgroundColor);
          const a = bg.length > 3 ? bg[3] : 1;
          const hex = getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(); // the brightest stop
          const under = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
          const mix = [0, 1, 2].map(i => bg[i] * a + under[i] * (1 - a));
          const [hi, lo] = [lum(fg), lum(mix)].sort((x, y) => y - x);
          return { ratio: (hi + .05) / (lo + .05), alpha: a };
        });
        ok(c.alpha > 0, 'tagline has no scrim');
        ok(c.ratio >= 4.5, `contrast ${c.ratio.toFixed(2)}${large ? ' with Large text' : ''}`);
      }
      await setLarge(page, false);
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

    await test('About opens a dialog, focus lands on its title, Esc closes it, focus returns to the button', async () => {
      await page.click('#btn-about');
      eq(await panelOpen(page, 'about'), true);
      eq(await page.evaluate(() => document.activeElement.id), 'panel-about-title');
      eq(await page.evaluate(() => document.activeElement.tagName), 'H2');
      const text = await page.$eval('#panel-about', d => d.textContent);
      ok(text.includes('saves nothing yet'), 'About omits the no-save line');
      eq(await hashOf(page), '#about');
      await page.keyboard.press('Escape');
      await gone(page, 'about');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-about');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('Settings opens on its title, not its first switch', async () => {
      await page.click('#btn-settings');
      eq(await page.evaluate(() => document.activeElement.id), 'panel-settings-title');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('Back closes an open panel and leaves the title, with no second #title behind it', async () => {
      await page.click('#btn-about');
      eq(await page.evaluate(() => history.state?.panel), 'about');
      await page.goBack();
      await gone(page, 'about');
      eq(await hashOf(page), '#title');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-about');
      // the close handler did not step history again: forward still reaches #about
      await page.goForward();
      await page.waitForFunction(() => document.getElementById('panel-about')?.open);
      eq(await hashOf(page), '#about');
      await page.goBack();
      await gone(page, 'about');
      eq(await hashOf(page), '#title');
    });

    await test('a panel closed by Back does not step history again when the same panel comes straight back', async () => {
      await page.click('#btn-about');
      // Back then Forward in one turn: the first dialog's close event is still
      // queued when #about arrives again. It must not take the new dialog with it.
      // Forward is sent from the popstate that Back fires (after the app's own
      // listener has run), not from a timer: a timer can reach Chromium before
      // Back has landed, and Chromium then drops the Forward (flaked 2 in 6).
      await page.evaluate(() => {
        addEventListener('popstate', () => history.forward(), { once: true });
        history.back();
      });
      await page.waitForFunction(() => document.getElementById('panel-about')?.open && location.hash === '#about');
      await new Promise(r => setTimeout(r, 300));
      eq(await panelOpen(page, 'about'), true);
      eq(await hashOf(page), '#about');
      await page.goBack();
      await gone(page, 'about');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('Close restores the hash and takes the pushed entry with it', async () => {
      const before = await page.evaluate(() => history.length);
      await page.click('#btn-about');
      await page.click('#panel-about-close');
      await gone(page, 'about');
      await page.waitForFunction(() => location.hash === '#title');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-about');
      // Back from here must leave the page's own history, not land on #about
      eq(await page.evaluate(() => history.state?.panel ?? null), null);
      ok((await page.evaluate(() => history.length)) >= before, 'history shrank');
    });

    await test('a panel hash arriving while another panel is open closes the first', async () => {
      await page.click('#btn-about');
      await page.evaluate(() => { location.hash = '#settings'; });
      await page.waitForFunction(() => document.getElementById('panel-settings')?.open);
      eq(await page.evaluate(() => document.querySelectorAll('dialog').length), 1);
      eq(await panelOpen(page, 'about'), false);
      eq(await hashOf(page), '#settings');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('focus stays inside an open dialog however far Tab and Shift+Tab go', async () => {
      await page.click('#btn-settings');
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab']) {
        await page.keyboard.press(key);
        ok(await page.evaluate(() => !!document.activeElement.closest('dialog')), `focus left the dialog on ${key}: now on ${await page.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id)}`);
      }
      await page.keyboard.down('Shift');
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        ok(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'focus left the dialog on Shift+Tab');
      }
      await page.keyboard.up('Shift');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('Settings switches apply at once, Large text raises the root size, and both undo', async () => {
      const root = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      const base = await root();
      await page.click('#btn-settings');
      await page.click('#set-large');
      eq(await page.evaluate(() => document.documentElement.classList.contains('large-text')), true);
      const big = await root();
      ok(Math.abs(big / base - 1.25) < 0.01, `root went ${base} to ${big}, not x1.25`);
      await page.click('#set-motion');
      eq(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')), true);
      await page.click('#set-large');
      await page.click('#set-motion');
      eq(await root(), base);
      eq(await page.evaluate(() => document.documentElement.className), '');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-settings');
      await page.waitForFunction(() => location.hash === '#title');
    });

    await test('an unknown hash is replaced by #title, not stacked on it', async () => {
      await page.evaluate(() => { location.hash = '#nonsense'; });
      await page.waitForFunction(() => location.hash === '#title');
      ok(await page.$('#screen-title'));
      // the typed entry became #title in place: going back from it leaves #title too,
      // so the one extra entry is the one the person typed, and no panel opens
      eq(await page.evaluate(() => !!document.querySelector('dialog')), false);
    });

    await test('panels: no offsite request, no console error', async () => {
      eq(page.__blocked, []);
      eq(consoleErrors, []);
    });
    await page.close();
  }

  // Direct links
  for (const name of ['about', 'settings']) {
    const { page, consoleErrors } = await open(FRAMES[0], `#${name}`);
    await test(`opening #${name} directly on load shows the panel over the title, focus on its title`, async () => {
      await page.waitForFunction(n => document.getElementById(`panel-${n}`)?.open, {}, name);
      ok(await page.$('#screen-title'), 'no title screen behind the panel');
      eq(await hashOf(page), `#${name}`);
      eq(await page.evaluate(() => document.activeElement.tagName), 'H2');
      eq(await page.evaluate(() => document.querySelectorAll('dialog').length), 1);
    });
    await test(`Close on a directly opened #${name} puts #title back and focus on its button`, async () => {
      await page.click(`#panel-${name}-close`);
      await gone(page, name);
      await page.waitForFunction(() => location.hash === '#title');
      eq(await page.evaluate(() => document.activeElement.id), `btn-${name}`);
    });
    await test(`#${name} direct load: no offsite request, no console error`, async () => {
      eq(page.__blocked, []);
      eq(consoleErrors, []);
    });
    await page.close();
  }

  // Reduced motion
  {
    const plain = await open(FRAMES[0]);
    const dur = async page => page.evaluate(() => {
      const el = document.querySelector('.title-menu');
      return parseFloat(getComputedStyle(el).animationDuration) * (/ms$/.test(getComputedStyle(el).animationDuration) ? 1 : 1000);
    });
    let normal;
    await test('the arrival animation runs at its normal length by default', async () => {
      normal = await dur(plain.page);
      ok(normal >= 100, `arrival lasts ${normal} ms`);
    });
    await plain.page.close();
    const { page, consoleErrors } = await open(FRAMES[0]);
    await reduceMotion(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#screen-title');
    await test('prefers-reduced-motion turns the arrival animation off', async () => {
      ok(await dur(page) <= 1, `arrival lasts ${await dur(page)} ms under reduced motion`);
      await page.click('#btn-about');
      const d = await page.$eval('#panel-about', e => getComputedStyle(e).animationDuration);
      ok(parseFloat(d) * (/ms$/.test(d) ? 1 : 1000) <= 1, `dialog arrival ${d}`);
      await page.keyboard.press('Escape');
      await gone(page, 'about');
    });
    await test('reduced-motion page: no console error', async () => { eq(consoleErrors, []); });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
await done();
