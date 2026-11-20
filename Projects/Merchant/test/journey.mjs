// node test/journey.mjs
//
// MER-01: the page loads, shows the title screen honestly, and a keyboard can
// reach every button. MER-06: six frames (phones with mobile: true), every
// button in view with and without Large text, the history of the two panels,
// focus, reduced motion. Port 8190, through the site harness.
// MER-43: New game, the desk and its papers: a game started by pointer and by keyboard, the
// first season answered, ended, reloaded and continued, with the DOM checked against the engine
// run on the same seed in Node. Asserts against the DOM (#39), exits non-zero on any failure (#13).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, eq, ok, done } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, '..', '..', '..', 'Tools', 'board-check', 'harness.mjs');
const { serve, launch, prepPage } = await import(pathToFileURL(HARNESS).href);

// The same game, run in Node by the engine on the same seed (ARCHITECTURE 7.4).
const MER = path.join(HERE, '..', 'js');
const eng = await import(pathToFileURL(path.join(MER, 'engine', 'index.js')).href);
const { loadContent } = await import(pathToFileURL(path.join(MER, 'data.js')).href);
const nodeContent = eng.validateContent(await loadContent('cairo', { fs: await import('node:fs/promises') }));
const SEED = 1324;
const { SAVE_VERSION } = await import(pathToFileURL(path.join(MER, 'engine', 'state.js')).href);
const cap = w => w[0].toUpperCase() + w.slice(1);
const withCommas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

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
// A back is settled when it lies flat: desk.js keeps `data-flip` on it from its first frame until the
// turn ends. Pressing Next on a sheet that is edge-on clicks on nothing (the CI flake of PR #603: a
// slow runner kept the sheet edge-on at the click, and answerFirst then waited 30 s for a paper to
// leave a back it had never pressed).
const BACK = '.sheet[data-face="back"]:not([data-flip])';
const BUTTONS = ['New game', 'About this game', 'Settings'];

const server = await serve(PORT);
const browser = await launch();

async function open(frame, hash = '') {
  const page = await prepPage(browser, BASE, { width: frame.width, height: frame.height, dsf: 1, mobile: !!frame.mobile });
  const consoleErrors = [];
  // data/cairo/sources.json does not exist (the city has no sources of its own, and the loader
  // treats a 404 as an empty list), but Chromium logs every 404 as a console error. That one
  // file is the only 404 allowed; anything else missing is still an error. See the report.
  page.__notFound = [];
  page.on('response', r => { if (r.status() === 404) page.__notFound.push(r.url().replace(BASE, '')); });
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource.*404/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(URL_ + hash, { waitUntil: 'load' });
  // Puppeteer's pages share one profile: start each page without a save or settings.
  await page.evaluate(() => localStorage.clear());
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
/** The one-press paper (DESIGN 7): Next on a card whose choice said `outfit-first` lands on the map
    table with the outfitting sheet open on the first stop. Send it, then go back to the desk.
    Returns false when Next stayed on the desk, true when a sheet was sent or the map had nothing to send. */
const sendFromMap = async page => {
  if (!['#map', '#outfit'].includes(await hashOf(page))) return false;
  await page.waitForSelector('#outfit-send, #map-toast:not([hidden])');
  if (await page.$('#outfit-send')) { await page.click('#outfit-send'); await page.waitForSelector('#map-toast:not([hidden])'); }
  await page.click('#map-desk-top');
  await page.waitForSelector('#screen-desk');
  return true;
};
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

    await test(`${tag}: three buttons, New game live and no Continue without a save`, async () => {
      const labels = await page.$$eval('.title-menu button', bs => bs.map(b => b.textContent.trim()));
      eq(labels, BUTTONS);
      eq(await page.$eval('#btn-new', b => [b.disabled, b.getAttribute('aria-disabled')]), [false, null]);
      eq(await page.$eval('#btn-about', b => b.disabled), false);
      eq(await page.$eval('#btn-settings', b => b.disabled), false);
      eq(await page.$('#new-game-reason'), null);
      eq(await page.$('#btn-continue'), null);
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

    await test(`${tag}: pressing New game opens the New game paper, Cancel closes it and returns focus`, async () => {
      await page.click('#btn-new');
      eq(await panelOpen(page, 'newgame'), true);
      eq(await hashOf(page), '#newgame');
      await page.click('#newgame-cancel');
      await gone(page, 'newgame');
      await page.waitForFunction(() => location.hash === '#title');
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

    await test(`${tag}: no offsite request, no console error, nothing missing but the city's own sources.json`, async () => {
      eq([...new Set(page.__notFound)].filter(u => u !== '/Projects/Merchant/data/cairo/sources.json'), []);
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
      ok(text.includes('saves only in this browser'), 'About omits the save line');
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
      await page.click('#set-motion-on');
      eq(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')), true);
      await page.click('#set-motion-off');
      eq(await page.evaluate(() => document.documentElement.classList.contains('motion-ok')), true);
      await page.click('#set-large');
      await page.click('#set-motion-device');
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
  // A popstate that arrives while the content is still loading must not throw (found by a double
  // goto to #about in this suite: the router ran with no save slot yet).
  {
    const page = await prepPage(browser, BASE, { width: 1366, height: 768, dsf: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const early = () => { const id = setInterval(() => dispatchEvent(new PopStateEvent('popstate')), 1); setTimeout(() => clearInterval(id), 400); };
    await (page.evaluateOnNewDocument ?? page.addInitScript).call(page, early);
    await page.goto(URL_, { waitUntil: 'load' });
    await test('a popstate during loading does not throw, and the title still comes up', async () => {
      await page.waitForSelector('#screen-title');
      eq(errors, []);
    });
    await page.close();
  }

  // ---- MER-43: the game. The engine runs the same seed in Node; the DOM must say what it says.
  const titleOf = (s, p) => {
    if (p.kind === 'return' || p.kind === 'lost') return p.data.headline;
    if (p.kind === 'accounts') return 'Accounts';
    if (p.kind === 'news') return p.letters.length === 1 ? `News from ${nodeContent.stops.find(x => x.id === p.letters[0].stop).name}` : `News from ${p.letters.length} cities`;
    if (p.kind === 'notice') return nodeContent.events.find(e => e.id === p.ref).notice.title;
    return nodeContent.cards.find(c => c.id === p.ref).title;
  };
  // what the page shows now: date, money, count line, the papers still open, the counter
  const screenOf = page => page.evaluate(() => ({
    date: document.getElementById('bar-date')?.textContent,
    count: document.getElementById('bar-count')?.textContent,
    money: document.getElementById('bar-money')?.textContent.trim(),
    left: document.querySelector('.stack-count')?.textContent,
    raised: document.querySelector('.sheet-title')?.textContent,
    face: document.querySelector('.sheet')?.dataset.face,
    edges: [...document.querySelectorAll('.edge')].map(e => e.textContent.trim()),
    endDisabled: document.getElementById('btn-end')?.getAttribute('aria-disabled'),
    endReason: document.getElementById('end-reason')?.textContent,
  }));
  const expected = s => {
    const v = eng.view(s, nodeContent);
    const open = s.desk.filter(p => p.state === 'open').map(p => titleOf(s, p));
    return {
      date: `${cap(v.season)} ${v.year}`, count: `Season ${s.t + 1} of 24 · Act ${['one', 'two', 'three'][v.act - 1]}`,
      money: `${withCommas(s.money)} dinars`, open,
      left: open.length ? `${open.length} ${open.length === 1 ? 'paper' : 'papers'} left` : 'No papers left',
    };
  };
  const sameScreen = async (page, s, label, { raisedFirst = true } = {}) => {
    const got = await screenOf(page), want = expected(s);
    eq([got.date, got.count, got.money, got.left], [want.date, want.count, want.money, want.left], `${label}: bar and counter`);
    if (want.open.length) {
      eq([got.raised, ...got.edges].sort(), [...want.open].sort(), `${label}: papers on the desk`);
      if (raisedFirst) eq(got.raised, want.open[0], `${label}: raised paper`);
    }
  };
  const engineState = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__merchant.state)));
  const GAME = URL_ + `?test=1&seed=${SEED}`;
  const start = async (page, how) => {
    await page.goto(GAME, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(GAME, { waitUntil: 'load' });
    await page.waitForSelector('#screen-title');
    if (how === 'pointer') {
      await page.click('#btn-new');
      await page.click('#newgame-begin');
    } else {
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('Tab');   // New game
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('panel-newgame')?.open);
      for (let i = 0; i < 4; i++) await page.keyboard.press('Tab'); // acts, house, Cancel, Begin
      eq(await page.evaluate(() => document.activeElement.id), 'newgame-begin');
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('#screen-desk .sheet-title');
  };
  const liveText = page => page.evaluate(() => document.getElementById('live').textContent);
  const focusId = page => page.evaluate(() => document.activeElement.id || document.activeElement.className);

  {
    const { page, consoleErrors } = await open(FRAMES[0]);

    await test('New game: three acts chosen, every year shown disabled as "Coming later", three houses with a difficulty word', async () => {
      await page.click('#btn-new');
      eq(await page.$eval('#length-acts', i => [i.checked, i.disabled]), [true, false]);
      eq(await page.$eval('#length-full', i => [i.checked, i.disabled]), [false, true]);
      ok((await page.$eval('.how-long', e => e.textContent)).includes('Coming later'), 'no "Coming later"');
      ok((await page.$eval('.how-long', e => e.textContent)).includes('Every year, 1324 to 1347'));
      const houses = await page.$$eval('.which-house .option', os => os.map(o => o.textContent.replace(/\s+/g, ' ').trim()));
      eq(houses.length, 3);
      ok(houses[0].startsWith('The spice house') && houses[0].includes('Easier'), houses[0]);
      ok(houses[1].includes('The cloth merchant') && houses[1].includes('Middle'), houses[1]);
      ok(houses[2].includes('The newcomer') && houses[2].includes('Harder'), houses[2]);
      eq(await page.$eval('#house-spice', i => i.checked), true);
      await page.click('#newgame-cancel');
      await gone(page, 'newgame');
    });

    await test('pointer: Begin opens the desk on the engine\'s first season (date, count, money, three papers)', async () => {
      await start(page, 'pointer');
      eq(await hashOf(page), '#desk');
      eq(await page.evaluate(() => document.querySelectorAll('dialog').length), 0);
      let s = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
      await sameScreen(page, s, 'season 1');
      eq(await engineState(page), JSON.parse(JSON.stringify(s)), 'the page ran the same game as Node');
      const got = await screenOf(page);
      eq([got.date, got.count, got.money, got.left], ['Spring 1324', 'Season 1 of 24 · Act one', '1,500 dinars', '3 papers left']);
      eq(await page.$eval('#bar-money', e => !!e.querySelector('svg')), true, 'coin icon');
      eq((await page.$eval('#btn-warehouse', e => e.textContent)), '24 loads in the warehouse');
      // DESIGN 6: the first paper is raised and focus is on its title, a heading
      const f = await page.evaluate(() => ({ tag: document.activeElement.tagName, title: document.activeElement.classList.contains('sheet-title'), txt: document.activeElement.textContent }));
      eq([f.tag, f.title, f.txt], ['H2', true, 'Welcome to the house']);
      eq((await screenOf(page)).edges, ['Yusuf is ready to go', 'A neighbour wants your linen']);
    });

    await test('the still comes from the season and its safe box holds the stack', async () => {
      const r = await page.evaluate(() => {
        const img = document.querySelector('.desk-still'), st = document.querySelector('.stack').getBoundingClientRect();
        return { src: img.getAttribute('src'), alt: img.alt, left: st.left, width: st.width, vw: innerWidth };
      });
      eq(r.src, 'assets/art/desk-day.webp');
      ok(r.alt.startsWith('A low dark wooden writing table'), r.alt);
      // 1366 wide: the still is cover-fitted to 1366 x 768, so the safe box starts at 22% and is 56% wide
      ok(Math.abs(r.left - 0.22 * r.vw) < 4 && Math.abs(r.width - 0.56 * r.vw) < 4, `stack at ${r.left}, ${r.width}`);
    });

    await test('top bar: Ledger, Notebook and the warehouse count are live buttons, and Notebook carries the count', async () => {
      for (const id of ['btn-ledger', 'btn-notebook', 'btn-warehouse']) {
        eq(await page.$eval(`#${id}`, b => [b.disabled, b.getAttribute('aria-disabled'), b.getAttribute('aria-haspopup')]), [false, null, 'dialog'], id);
      }
      eq(await page.$eval('#btn-notebook', b => b.textContent.trim()), `Notebook${(await engineState(page)).notebook.length}`);
    });

    await test('End the season is disabled with its reason as visible text, and pressing it does nothing', async () => {
      const g = await screenOf(page);
      eq(g.endDisabled, 'true');
      eq(g.endReason, eng.canEndSeason(eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' })).reason);
      ok(await page.$eval('#end-reason', e => e.getBoundingClientRect().height > 0), 'reason not visible');
      await page.click('#btn-end');
      await sameScreen(page, eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' }), 'after a refused End');
    });

    let model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    await test('a choice button carries its cost line, a key badge, and a disabled one says why', async () => {
      // raise the second paper, which has a cost
      await page.click('.edge');
      const t = await page.$$eval('.sheet .choice', cs => cs.map(c => ({ label: c.querySelector('.label').textContent, cost: c.querySelector('.cost')?.textContent ?? null,
        key: c.querySelector('.key').textContent, disabled: c.getAttribute('aria-disabled') })));
      eq(t[0].label, 'Send Yusuf with ten loads of linen');
      eq(t[0].cost, '−20 dinars now');
      eq(t[0].key, '1'); eq(t[1].key, '2');
      eq(t[1].cost, null);
      eq(t[0].disabled, null);
      // DESIGN 7: the card shows both prices, from what the house knows (view().prices)
      const line = await page.$eval('.sheet .choice .prices', e => e.textContent);
      ok(/^Cairo pays \d+ a load of linen\./.test(line), line);
      // put the first paper back on top
      await page.click('.edge');
      eq((await screenOf(page)).raised, 'Welcome to the house');
    });

    await test('answering by pointer: front goes inert, the back says what happened, the note and the source, focus on its heading', async () => {
      await page.click('#choice-p0-0-begin');
      await page.waitForSelector(BACK);
      const b = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet');
        return { heading: document.activeElement.textContent, tag: document.activeElement.tagName,
          note: sheet.querySelector('.note p')?.textContent, fresh: sheet.querySelector('.fresh')?.textContent,
          source: sheet.querySelector('.source')?.textContent, next: !!document.getElementById('btn-next'),
          order: [...sheet.children].map(c => c.className || c.tagName) };
      });
      eq(b.tag, 'H2'); eq(b.heading, 'Nothing changed at once.');
      ok(b.note.startsWith('Ibn Battuta wrote that Cairo surged'), b.note);
      ok(b.fresh.startsWith('New in your notebook: '), b.fresh);
      ok(b.source.startsWith('Source: Ibn Battuta, The Travels of Ibn Battuta') && !/https?:|www\./.test(b.source), b.source);
      eq(b.next, true);
      eq(b.order.at(-1), 'source', 'the source line is last, under the button');
      // ARCHITECTURE 8.4: saved at once after the action, not on a timer or only on leaving
      const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('merchant-save')));
      delete saved.__v;
      eq(saved, JSON.parse(JSON.stringify(eng.choose(model, nodeContent, 'p0-0', 'begin'))), 'the save after the first answer');
    });

    // The engine model for the rest of the pointer flow: letter 1, expedition 1 (opens the sheet over the map), neighbour 2.
    model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    await test('Next raises the next paper and the page matches the engine; the first expedition opens the sheet over the map table; then End is live', async () => {
      const m0 = eng.choose(model, nodeContent, 'p0-0', 'begin');
      await page.click('#btn-next');
      await sameScreen(page, m0, 'after the letter');
      eq(await engineState(page), JSON.parse(JSON.stringify(m0)));
      eq(await page.evaluate(() => document.activeElement.classList.contains('sheet-title')), true, 'focus is on the raised paper\'s title');

      // the expedition card: first choice, outfit-first
      await page.click('#choice-p0-1-go');
      await page.waitForSelector(BACK);
      const m1 = eng.choose(m0, nodeContent, 'p0-1', 'go');
      eq(await page.$eval('.sheet-title', e => e.textContent), 'You paid 20 dinars.');
      await page.click('#btn-next');
      // the one-press first expedition (DESIGN 7): the sheet over the map table, filled in for Damascus
      await page.waitForSelector('#outfit-send');
      eq(await hashOf(page), '#outfit');
      eq(await page.$eval('#outfit-send', b => [b.textContent, b.getAttribute('aria-disabled')]), ['Send Yusuf to Damascus', 'false']);
      eq(await engineState(page), JSON.parse(JSON.stringify(m1)), 'nothing is sent until the button is pressed');
      const plan = eng.suggestPlan(m1, nodeContent, 'damascus');
      await page.click('#outfit-send');
      const m1b = eng.outfit(m1, nodeContent, plan);
      await page.waitForSelector('#map-toast:not([hidden])');
      eq(await engineState(page), JSON.parse(JSON.stringify(m1b)), 'the expedition on the road is the engine\'s');
      await page.click('#map-desk-top');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.kind === 'card');
      await sameScreen(page, m1b, 'after the expedition is sent');
      eq(await hashOf(page), '#desk');
      eq(await page.$eval('#end-reason', e => e.textContent), eng.canEndSeason(m1b).reason, 'the desk says why it cannot end the season yet');
      eq(await page.$eval('#bar-money', e => e.textContent.trim()), '1,480 dinars');

      // the neighbour, second choice ("Keep them")
      await page.click('#choice-p0-2-keep');
      await page.waitForSelector(BACK);
      const m2 = eng.choose(m1b, nodeContent, 'p0-2', 'keep');
      await page.click('#btn-next');
      await page.waitForFunction(() => document.activeElement.id === 'btn-end');
      model = m2;
      eq(await engineState(page), JSON.parse(JSON.stringify(m2)));
      const g = await screenOf(page);
      eq([g.endDisabled, g.endReason, g.left], ['false', '', 'No papers left']);
      ok(await page.$eval('#btn-end', b => b.classList.contains('pulse')), 'End the season did not pulse when it went live');
    });

    await test('pointer: End the season opens season two exactly as the engine does, and says so once in the live region', async () => {
      await page.click('#btn-end');
      model = eng.endSeason(model, nodeContent);
      await page.waitForFunction(() => document.getElementById('bar-count')?.textContent.startsWith('Season 2'));
      await sameScreen(page, model, 'season 2');
      eq(await engineState(page), JSON.parse(JSON.stringify(model)));
      const n = model.desk.filter(p => p.state === 'open').length;
      await page.waitForFunction(() => document.getElementById('live').textContent !== '');
      eq(await liveText(page), `Summer 1324. ${['No', 'One', 'Two', 'Three'][n]} ${n === 1 ? 'paper' : 'papers'} on your desk.`);
      eq(await page.evaluate(() => document.querySelectorAll('[aria-live], [role="status"]').length), 1, 'one polite live region');
      eq(await page.$eval('#live', e => e.getAttribute('aria-live')), 'polite');
      eq(await page.$eval('.sheet-title', e => e === document.activeElement), true);
      eq(await page.$eval('#btn-end', b => b.classList.contains('pulse')), false, 'the pulse is for the first season only');
    });

    await test('the save was written after every action: a reload and Continue land on the same season', async () => {
      const raw = await page.evaluate(() => localStorage.getItem('merchant-save'));
      ok(raw && raw.includes('"seed":1324'), 'no save in storage');
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-desk .sheet-title'); // a reload on #desk picks the game up
      await sameScreen(page, model, 'after reload on #desk');
      // and from the title: Menu, Save and quit, then Continue
      await page.click('#btn-menu');
      eq(await page.evaluate(() => document.activeElement.id), 'panel-menu-title');
      await page.click('#menu-quit');
      await page.waitForSelector('#screen-title');
      eq(await hashOf(page), '#title');
      eq(await page.$eval('#btn-continue .hint', e => e.textContent), 'Summer 1324, Act one');
      await page.click('#btn-continue');
      await page.waitForSelector('#screen-desk .sheet-title');
      await sameScreen(page, model, 'after Continue');
      eq(await engineState(page), JSON.parse(JSON.stringify(model)));
    });

    await test('a hard reload from the title shows Continue, and New game over a save asks first', async () => {
      await page.goto(URL_ + '?test=1&seed=1324#title', { waitUntil: 'load' });
      await page.waitForSelector('#screen-title');
      ok(await page.$('#btn-continue'), 'no Continue with a save');
      const labels = await page.$$eval('.title-menu button', bs => bs.map(b => b.textContent.trim()));
      eq(labels, ['New game', 'ContinueSummer 1324, Act one', 'About this game', 'Settings']);
      await page.click('#btn-new');
      await page.click('#newgame-begin');
      await page.waitForSelector('dialog.confirm[open]');
      const t = await page.$eval('dialog.confirm', d => ({ title: d.querySelector('h2').textContent, text: d.querySelector('p').textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) }));
      eq(t.title, 'Start again?');
      eq(t.text, 'Your game in Summer 1324, Act one will be lost. You can export it first.');
      eq(t.buttons, ['Cancel', 'Export', 'Start again']);
      await page.click('#confirm-cancel');
      await page.waitForFunction(() => !document.querySelector('dialog.confirm'));
      eq(await hashOf(page), '#newgame');
      await page.click('#newgame-cancel');
      await gone(page, 'newgame');
      // the save is untouched
      await page.click('#btn-continue');
      await page.waitForSelector('#screen-desk .sheet-title');
      await sameScreen(page, model, 'after a cancelled Start again');
    });

    await test('pointer game: no offsite request, no console error', async () => {
      eq(page.__blocked, []);
      eq(page.__shimmed, []);
      eq(consoleErrors, []);
    });
    await page.close();
  }

  // ---- the same first season by keyboard alone
  {
    const { page, consoleErrors } = await open(FRAMES[0]);
    await test('keyboard: Tab to New game, Enter, Tab to Begin, Enter opens the same first season', async () => {
      await start(page, 'keys');
      let s = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
      await sameScreen(page, s, 'keyboard season 1');
      eq(await engineState(page), JSON.parse(JSON.stringify(s)));
    });

    await test('keyboard: held keys never act (event.repeat is ignored)', async () => {
      await page.evaluate(() => {
        for (const key of ['1', '2', 'e', 'E']) document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true }));
      });
      // the engine's state changes the moment a key acts, before any flip finishes on screen
      eq(await engineState(page), JSON.parse(JSON.stringify(eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' }))), 'a held key changed the game');
      await sameScreen(page, eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' }), 'after held keys');
      eq((await screenOf(page)).face, 'front');
    });

    let model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    await test('keyboard: 1 answers, Enter presses Next, 1 on the expedition, Enter on Send in the sheet, Esc back to the desk, 1 on the neighbour, E ends the season', async () => {
      await page.keyboard.press('1');
      await page.waitForSelector(BACK);
      model = eng.choose(model, nodeContent, 'p0-0', 'begin');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.face === 'front' && document.querySelector('.sheet-title').textContent === 'Yusuf is ready to go');
      await sameScreen(page, model, 'keyboard after letter');
      await page.keyboard.press('1');
      await page.waitForSelector(BACK);
      model = eng.choose(model, nodeContent, 'p0-1', 'go');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#outfit-send');
      model = eng.outfit(model, nodeContent, eng.suggestPlan(model, nodeContent, 'damascus'));
      await page.focus('#outfit-send');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#map-toast:not([hidden])');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.kind === 'card');
      await page.keyboard.press('1');
      await page.waitForSelector(BACK);
      model = eng.choose(model, nodeContent, 'p0-2', 'sell');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement.id === 'btn-end');
      eq(await engineState(page), JSON.parse(JSON.stringify(model)));
      await page.keyboard.press('e');
      model = eng.endSeason(model, nodeContent);
      await page.waitForFunction(() => document.getElementById('bar-count')?.textContent.startsWith('Season 2'));
      await sameScreen(page, model, 'keyboard season 2');
      eq(await engineState(page), JSON.parse(JSON.stringify(model)));
    });

    await test('keyboard: L and N open the ledger and the notebook, Esc returns focus to their buttons; E does nothing while papers wait', async () => {
      for (const [k, name] of [['l', 'ledger'], ['n', 'notebook']]) {
        await page.keyboard.press(k);
        await page.waitForFunction(n => document.getElementById(`panel-${n}`)?.open, {}, name);
        eq(await hashOf(page), `#${name}`);
        await page.keyboard.press('Escape');
        await gone(page, name);
        eq(await focusId(page), `btn-${name}`, `${k}: focus back on its button`);
        eq(await hashOf(page), '#desk');
      }
      const before = await engineState(page);
      await page.keyboard.press('e');
      eq(await engineState(page), before);
    });

    await test('the Map button and the M key open the map table, and Esc and Back to the desk come back', async () => {
      eq(await page.$eval('#btn-map', b => [b.disabled, b.getAttribute('aria-disabled'), b.getAttribute('aria-describedby')]), [false, null, null], 'Map is a live button');
      await page.click('#btn-map');
      await page.waitForSelector('#screen-map[data-ready]');
      eq(await hashOf(page), '#map');
      eq(await page.$('#outfit-send'), null, 'a plain Map press opens no sheet');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#screen-desk');
      eq(await hashOf(page), '#desk');
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('m');
      await page.waitForSelector('#screen-map[data-ready]');
      eq(await hashOf(page), '#map');
      await page.click('#map-desk');
      await page.waitForSelector('#screen-desk');
      eq(await hashOf(page), '#desk');
    });

    await test('Settings: turning single-key shortcuts off stops the digits and E, and the setting survives a reload', async () => {
      await page.click('#btn-menu');
      await page.click('#menu-settings');
      eq(await page.$eval('#set-keys', i => i.checked), true);
      await page.click('#set-keys');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      await page.waitForFunction(() => location.hash === '#desk');
      const before = await engineState(page);
      await page.keyboard.press('1');
      await page.keyboard.press('e');
      eq(await engineState(page), before, 'a shortcut acted with shortcuts off');
      eq((await screenOf(page)).face, 'front');
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-desk .sheet-title');
      eq(await page.evaluate(() => window.__merchant.settings.shortcuts), false);
      await page.keyboard.press('1');
      eq(await engineState(page), before, 'a shortcut acted after a reload');
      // the button still works (season two opens on a paper the engine wrote, which has one button)
      await page.click('.sheet .choice, .sheet .next');
      await page.waitForFunction(b => JSON.stringify(window.__merchant.state) !== b, {}, JSON.stringify(before));
    });

    await test('Settings: Large text and Reduce motion are saved and applied again after a reload', async () => {
      await page.click('#btn-menu');
      await page.click('#menu-settings');
      await page.click('#set-large');
      await page.click('#set-motion-on');
      await page.click('#panel-settings-close');
      await gone(page, 'settings');
      const raw = await page.evaluate(() => localStorage.getItem('merchant-settings'));
      ok(raw && raw.includes('largeText') && raw.includes('"on"'), raw);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-desk .sheet-title');
      eq(await page.evaluate(() => [...document.documentElement.classList].sort()), ['large-text', 'reduce-motion']);
    });

    await test('keyboard game: no offsite request, no console error', async () => {
      eq(page.__blocked, []);
      eq(consoleErrors, []);
    });
    await page.close();
  }

  // ---- seasons played through to a return: the engine's own papers (price letters, a return, accounts)
  {
    const { page, consoleErrors } = await open(FRAMES[0]);
    await start(page, 'pointer');
    // Both sides play the same policy: the first choice that is open to the player; the first
    // expedition is sent with the engine's own plan; every other paper is set aside.
    const nodeSeason = s => {
      for (const p of s.desk) {
        if (p.state !== 'open') continue;
        const cs = eng.paperChoices(s, nodeContent, p.id);
        const c = cs.find(x => { try { eng.choose(s, nodeContent, p.id, x.id); return true; } catch { return false; } });
        s = eng.choose(s, nodeContent, p.id, c.id);
        if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(s, nodeContent, 'damascus'); if (plan) s = eng.outfit(s, nodeContent, plan); }
      }
      return eng.endSeason(s, nodeContent);
    };
    const uiSeason = async () => {
      for (let guard = 0; guard < 12; guard++) {
        if (await page.$eval('#btn-end', b => b.getAttribute('aria-disabled') === 'false')) break;
        const k = await page.evaluate(() => ({ kind: document.querySelector('.sheet')?.dataset.kind, face: document.querySelector('.sheet')?.dataset.face }));
        if (k.face === 'back') { await page.click('#btn-next'); await sendFromMap(page); continue; }
        if (['return', 'lost', 'news', 'accounts'].includes(k.kind)) { await page.click('#btn-next'); continue; }
        await page.click('.sheet .choice:not([aria-disabled="true"])');
        await page.waitForSelector(BACK);
      }
      await page.click('#btn-end');
    };
    let model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    let sawReturn = null;
    await test('play to the first return: the page matches the engine every season, and the return paper leads with its sentence', async () => {
      for (let season = 1; season <= 10 && !sawReturn; season++) {
        const ret = model.desk.find(p => p.kind === 'return');
        if (ret) {
          // raise it and read it before the season is played
          await page.waitForFunction(() => document.querySelector('.stack'));
          sawReturn = ret;
          const rid = ret.id;
          // the engine's other papers sit first or after; raise the return
          await page.$$eval('.edge, .sheet', () => {});
          const raised = await page.$eval('.sheet-title', e => e.textContent);
          if (raised !== ret.data.headline) await page.click(`.edge[data-paper="${rid}"]`);
            await page.waitForFunction(h => document.querySelector('.sheet-title')?.textContent === h, {}, ret.data.headline);
          eq(await page.$eval('.sheet', e => e.dataset.kind), 'return');
          eq(await page.$eval('.account', d => d.open), false, 'the account is folded shut on the first return of a game');
          ok((await page.$eval('.account summary', e => e.textContent)) === 'Show the account');
          await page.click('.account summary');
          const rows = await page.$$eval('.account tr', trs => trs.map(t => t.textContent));
          ok(rows.length >= 3 && rows.some(r => r.includes('Profit') || r.includes('Back home')), rows.join(' | '));
          eq(await page.$eval('#btn-next', b => b.textContent), 'Into the ledger');
          // the End bar never sits over a button of the paper: after scrolling it into view, the
          // button is what a press at its middle would hit
          const hit = await page.$eval('#btn-next', b => { b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === b || b.contains(top); });
          eq(hit, true, 'Into the ledger is covered by something else');
        }
        await sameScreen(page, model, `season ${season}`, { raisedFirst: false });
        // both sides answer in the desk's own order: put the first paper back on top if we read another
        const first = model.desk.find(p => p.state === 'open').id;
        if (await page.$eval('.sheet', (e, id) => e.dataset.paper !== id, first)) await page.click(`.edge[data-paper="${first}"]`);
        model = nodeSeason(model);
        await uiSeason();
        await page.waitForFunction(n => window.__merchant.state.t === n, {}, model.t);
        eq(await engineState(page), JSON.parse(JSON.stringify(model)), `after season ${season}`);
      }
      ok(sawReturn, 'no expedition came home in ten seasons');
    });
    await test('play to the first return: no console error, nothing offsite', async () => { eq(consoleErrors, []); eq(page.__blocked, []); });
    await page.close();
  }

  // ---- the desk at the six frames: nothing spills sideways, End the season and the choices can be reached
  for (const frame of FRAMES) {
    const { page, consoleErrors } = await open(frame);
    await start(page, 'pointer');
    // the fixed End bar can cover the edges on a phone, as a thumb would find: scroll to one first
    const raiseEdge = async () => { await page.$eval('.edge', e => e.scrollIntoView({ block: 'center' })); await page.click('.edge'); };
    await raiseEdge(); // the expedition card, which has a cost line
    await page.screenshot({ path: path.join(SHOTS, `card-${frame.name}.png`) });
    await raiseEdge(); // and back to the letter
    await test(`${frame.name} ${frame.width}x${frame.height}: the desk has no horizontal overflow and every control of the raised paper can be scrolled to`, async () => {
      const m = await page.evaluate(() => ({ doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        body: [document.body.scrollWidth, document.body.clientWidth],
        hits: [...document.querySelectorAll('.sheet .choice, #btn-end, .topbar .bar-btn.menu')].map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className, Math.round(r.height), Math.round(r.width)]; }) }));
      eq(m.doc[0], m.doc[1]); eq(m.body[0], m.body[1]);
      for (const [id, h, w] of m.hits) ok(h >= 44 && w >= 44, `${id} is ${w} x ${h}`);
    });
    await test(`${frame.name}: the whole first season can be answered by pointer at this size`, async () => {
      for (const id of ['begin', 'go', 'keep']) {
        const p = id === 'begin' ? 'p0-0' : id === 'go' ? 'p0-1' : 'p0-2';
        await page.$eval(`#choice-${p}-${id}`, b => b.scrollIntoView({ block: 'center' }));
        await page.click(`#choice-${p}-${id}`);
        await page.waitForSelector(BACK);
        await page.$eval('#btn-next', b => b.scrollIntoView({ block: 'center' }));
        await page.click('#btn-next');
        if (id === 'go') { await page.waitForSelector('#outfit-send'); await sendFromMap(page); }
      }
      await page.waitForFunction(() => document.getElementById('btn-end').getAttribute('aria-disabled') === 'false');
      const r = await page.$eval('#btn-end', b => { const x = b.getBoundingClientRect(); return [x.bottom <= innerHeight + 1, x.top >= 0]; });
      eq(r, [true, true], 'End the season is outside the frame');
    });
    await page.screenshot({ path: path.join(SHOTS, `desk-${frame.name}.png`) });
    await test(`${frame.name}: desk, no offsite request, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
    await page.close();
  }

  // ---- MER-44: the map table, the price board and outfitting.
  // These cases arrive at the map table by its hash, as a bookmark or the back button would;
  // the desk's Map button and M key have their own case in the keyboard game above.
  const FIRST = { 'opening-letter': 'begin', 'first-expedition': 'wait', 'linen-neighbour': 'keep' };
  const goMap = async page => { await page.evaluate(() => { location.hash = '#map'; }); await page.waitForSelector('#screen-map[data-ready]'); };
  const goDesk = async page => { await page.evaluate(() => { location.hash = '#desk'; }); await page.waitForSelector('#screen-desk .sheet, #screen-desk #btn-end'); };
  const answerFirst = async (page, how) => {
    const picks = [['p0-0', 'begin', 1], ['p0-1', 'wait', 2], ['p0-2', 'keep', 2]];
    for (const [p, id, n] of picks) {
      if (how === 'pointer') { await page.$eval(`#choice-${p}-${id}`, b => b.scrollIntoView({ block: 'center' })); await page.click(`#choice-${p}-${id}`); }
      else { await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press(String(n)); }
      await page.waitForSelector(BACK);
      if (how === 'pointer') { await page.$eval('#btn-next', b => b.scrollIntoView({ block: 'center' })); await page.click('#btn-next'); } else await page.keyboard.press('Enter');
      await page.waitForFunction(pp => !document.querySelector(`[data-paper="${pp}"][data-face="back"]`), {}, p);
    }
  };
  const modelFirst = s => { for (const p of s.desk) if (p.state === 'open') s = eng.choose(s, nodeContent, p.id, FIRST[p.ref]); return s; };
  // the same policy both sides play every later season: the first choice that is open, other papers set aside
  const modelSeason = s => {
    for (const p of s.desk) {
      if (p.state !== 'open') continue;
      const cs = eng.paperChoices(s, nodeContent, p.id);
      const c = cs.find(x => { try { eng.choose(s, nodeContent, p.id, x.id); return true; } catch { return false; } });
      s = eng.choose(s, nodeContent, p.id, c.id);
      if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(s, nodeContent, 'damascus'); if (plan) s = eng.outfit(s, nodeContent, plan); }
    }
    return eng.endSeason(s, nodeContent);
  };
  const uiSeason = async (page, how) => {
    for (let guard = 0; guard < 14; guard++) {
      if (await page.$eval('#btn-end', b => b.getAttribute('aria-disabled') === 'false')) break;
      const k = await page.evaluate(() => ({ kind: document.querySelector('.sheet')?.dataset.kind, face: document.querySelector('.sheet')?.dataset.face }));
      if (k.face === 'back') { await page.click('#btn-next'); await sendFromMap(page); continue; }
      if (['return', 'lost', 'news', 'accounts'].includes(k.kind)) { await page.click('#btn-next'); continue; }
      await page.click('.sheet .choice:not([aria-disabled="true"])');
      await page.waitForSelector(BACK);
    }
    if (how === 'keyboard') { await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('e'); } else await page.click('#btn-end');
  };
  const tokens = page => page.$$eval('.token', ts => ts.map(t => ({ ids: t.dataset.expedition, count: t.dataset.count, left: parseFloat(t.style.left), top: parseFloat(t.style.top), label: t.querySelector('.token-label').textContent })));
  const FRAME = FRAMES[0];

  // one expedition, sent from the map table and followed home, by pointer then by keyboard
  for (const how of ['pointer', 'keyboard']) {
    const { page, consoleErrors } = await open(FRAME);
    await start(page, how);
    await answerFirst(page, how);
    let model = modelFirst(eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' }));
    await goMap(page);

    await test(`${how}: the map table opens on Damascus, with a label from stops.json on every stop and the title focused`, async () => {
      eq(await hashOf(page), '#map');
      eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Damascus');
      eq(await page.evaluate(() => document.activeElement.id), 'board-title');
      const labels = await page.$$eval('.stop-label[data-stop]', ls => ls.map(l => [l.dataset.stop, l.textContent]));
      eq(labels.sort((a, b) => (a[0] < b[0] ? -1 : 1)), nodeContent.stops.map(s => [s.id, s.name]).sort((a, b) => (a[0] < b[0] ? -1 : 1)), 'one label per stop, its name');
      // the label sits where stops.json says: its anchor and offset are the data's
      const cairo = nodeContent.stops.find(s => s.id === 'cairo');
      const st = await page.$eval('.stop-label[data-stop="cairo"]', l => ({ dx: l.style.getPropertyValue('--dx'), ax: l.style.getPropertyValue('--ax') }));
      eq([st.dx, st.ax], [String(cairo.label.dx), '0%'], 'Cairo label offset and anchor');
      eq(await page.$$eval('.dot[data-stop]', ds => ds.every(d => d.getAttribute('tabindex') === '-1')), true, 'dots are not tab stops');
      eq((await tokens(page)), [], 'nothing is on the road yet');
    });

    if (how === 'pointer') {
      await test('pointer: a press goes to the nearest stop within 48 px and to none beyond it', async () => {
        const at = async id => page.$eval(`.dot[data-stop="${id}"]`, d => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        const [ax, ay] = await at('samarkand');
        await page.mouse.click(ax + 30, ay + 10); // 31.6 px away: a dot is 14 px wide, so this misses the dot itself
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Samarkand');
        eq(await page.$eval('#stop-samarkand', e => e.getAttribute('aria-selected')), 'true');
        const [bx, by] = await at('aden');
        await page.mouse.click(bx - 40, by + 30);   // 50 px away: nothing is that close
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Samarkand', 'a press 50 px from every stop selects nothing');
        const [dx, dy] = await at('damascus');
        await page.mouse.click(dx + 20, dy - 6);
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Damascus');
      });
    } else {
      await test('keyboard: the stop list is a listbox, typeahead jumps and Enter selects', async () => {
        await page.keyboard.press('Tab');
        eq(await page.evaluate(() => document.activeElement.id), 'stoplist');
        eq(await page.$eval('#stoplist', e => e.getAttribute('role')), 'listbox');
        for (const ch of 'alex') await page.keyboard.press(ch);
        eq(await page.$eval('#stoplist', e => e.getAttribute('aria-activedescendant')), 'stop-alexandria');
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Damascus', 'moving the highlight selects nothing');
        await page.keyboard.press('Enter');
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Alexandria');
        await page.keyboard.press('ArrowDown');
        eq(await page.$eval('#stoplist', e => e.getAttribute('aria-activedescendant')), 'stop-aydhab');
        await page.waitForFunction(() => true); await new Promise(r => setTimeout(r, 1100)); // the typeahead buffer clears
        for (const ch of 'dam') await page.keyboard.press(ch);
        eq(await page.$eval('#stoplist', e => e.getAttribute('aria-activedescendant')), 'stop-damascus');
        await page.keyboard.press('Enter');
        eq(await page.$eval('#board-title', e => e.textContent), 'Prices in Damascus');
      });
    }

    await test(`${how}: the price board says each price with the season it was written and its age, from the engine's view`, async () => {
      const v = await page.evaluate(() => window.__merchant.view.prices);
      const rows = await page.$$eval('#prices tbody tr', trs => trs.map(t => ({ good: t.querySelector('th').textContent, here: t.querySelector('td.here').textContent, there: t.querySelector('td.there')?.textContent })));
      const goods = nodeContent.stops.find(s => s.id === 'damascus').sells;
      eq(rows.map(r => r.good).sort(), Object.keys(goods).map(g => nodeContent.goods.find(x => x.id === g).name).sort());
      const linen = rows.find(r => r.good === 'Linen');
      const pd = v.damascus.linen, pc = v.cairo.linen;
      ok(pd.p == null ? linen.here === 'no news' : linen.here.includes(`${pd.p} dinars`) && linen.here.includes(pd.written) && linen.here.includes(pd.ageWords), `Damascus linen: ${linen.here}`);
      ok(linen.there.includes(`${pc.p} dinars`) && linen.there.includes(pc.written) && linen.there.includes(pc.ageWords), `Cairo linen: ${linen.there}`);
      ok(rows.some(r => r.here === 'no news'), 'a good with no news says so');
    });

    await test(`${how}: Outfit opens #outfit, one press, filled in; the contract is not on the sheet`, async () => {
      if (how === 'pointer') await page.click('#btn-outfit');
      else { await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement.id), 'btn-outfit'); await page.keyboard.press('Enter'); }
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      eq(await hashOf(page), '#outfit');
      eq(await page.evaluate(() => document.activeElement.id), 'panel-outfit-title');
      eq(await page.$eval('#panel-outfit-title', e => e.textContent), 'Outfit an expedition to Damascus');
      eq(await page.$eval('#panel-outfit', d => d.getAttribute('aria-labelledby')), 'panel-outfit-title');
      const plan = eng.suggestPlan(model, nodeContent, 'damascus');
      eq(await page.$eval('#summary-who', e => e.textContent), 'Yusuf (careful, knows Damascus).');
      ok((await page.$eval('#summary-carry', e => e.textContent)).startsWith(`${plan.cargo.linen} loads of linen`), 'cargo is the engine plan');
      eq(await page.$$eval('#panel-outfit .step', s => s.map(x => x.id)), ['outfit-who', 'outfit-where', 'outfit-carry'], 'three sections: the contract is met at the second expedition');
      eq(await page.$eval('#outfit-send', b => [b.textContent, b.getAttribute('aria-disabled')]), ['Send Yusuf to Damascus', 'false']);
    });

    await test(`${how}: a reload on #outfit returns to the map table with nothing sent`, async () => {
      const before = await engineState(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-map[data-ready]');
      eq(await hashOf(page), '#map');
      eq(await page.evaluate(() => !!document.getElementById('panel-outfit')), false);
      eq(await engineState(page), before, 'the reload sent nothing');
      if (how === 'pointer') await page.click('#btn-outfit'); else { await page.evaluate(() => document.getElementById('btn-outfit').focus()); await page.keyboard.press('Enter'); }
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
    });

    await test(`${how}: Send sends the engine's plan, the sheet closes to the map and a token stands in Cairo`, async () => {
      if (how === 'pointer') await page.click('#outfit-send');
      else {
        // Tab order on the sheet: three Change links, Back to the map, Send
        await page.evaluate(() => document.getElementById('panel-outfit-title').focus());
        for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
        eq(await page.evaluate(() => document.activeElement.id), 'outfit-send');
        await page.keyboard.press('Enter');
      }
      await page.waitForFunction(() => !document.getElementById('panel-outfit'));
      eq(await hashOf(page), '#map');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-outfit', 'focus returns to the button that opened the sheet');
      model = eng.outfit(model, nodeContent, eng.suggestPlan(model, nodeContent, 'damascus'));
      eq(await engineState(page), JSON.parse(JSON.stringify(model)), 'the page sent what the engine would');
      const ts = await tokens(page);
      eq(ts.length, 1);
      ok(ts[0].label.startsWith('Yusuf, home about '), ts[0].label);
      const cairoDot = await page.$eval('.dot[data-stop="cairo"]', d => [parseFloat(d.style.left), parseFloat(d.style.top)]);
      eq([ts[0].left, ts[0].top], cairoDot, 'a sent expedition is at its first stop');
      ok((await page.$eval('#map-toast', e => e.textContent)).includes('Yusuf set out for Damascus'));
    });

    await test(`${how}: the expedition is followed home season by season, and the token leaves the map when it arrives`, async () => {
      let lastLeft = null, moved = 0;
      for (let season = 0; season < 14 && model.expeditions.length; season++) {
        if (how === 'pointer') await page.click('#map-desk'); else await page.keyboard.press('Escape');
        await page.waitForSelector('#screen-desk #btn-end');
        eq(await hashOf(page), '#desk');
        model = modelSeason(model);
        await uiSeason(page, how);
        await page.waitForFunction(n => window.__merchant.state.t === n, {}, model.t);
        eq(await engineState(page), JSON.parse(JSON.stringify(model)), `after season ${model.t}`);
        await goMap(page);
        const ts = await tokens(page);
        eq(ts.length, model.expeditions.length, 'one token for each expedition on the road');
        if (ts.length) {
          ok(ts[0].label.startsWith('Yusuf, home about '));
          const x = model.expeditions[0], route = nodeContent.routes.find(r => r.id === x.route), leg = route.legs[x.leg];
          const sp = id => page.$eval(`.dot[data-stop="${id}"]`, d => [parseFloat(d.style.left), parseFloat(d.style.top)]);
          const [a, b] = [await sp(leg.from), await sp(leg.to)];
          const frac = x.status === 'out' ? 1 - x.left / leg.seasons : 0;
          ok(Math.abs(ts[0].left - (a[0] + (b[0] - a[0]) * frac)) < 0.15 && Math.abs(ts[0].top - (a[1] + (b[1] - a[1]) * frac)) < 0.15, `token ${JSON.stringify(ts[0])} is not at ${frac} of ${leg.from} to ${leg.to}`);
          if (lastLeft !== null && ts[0].left !== lastLeft) moved++;
          lastLeft = ts[0].left;
        }
      }
      eq(model.expeditions.length, 0, 'it came home within fourteen seasons');
      ok(moved >= 1, 'the token moved at least once on the way');
      eq(await tokens(page), [], 'no token once it is home');
      ok(model.desk.some(p => p.kind === 'return'), 'a return paper waits on the desk');
    });
    await test(`${how}: map table, no console error, nothing offsite`, async () => { eq(consoleErrors, []); eq(page.__blocked, []); });
    if (how === 'pointer') {
      // the second expedition: four sections, steppers as buttons with role spinbutton, refusals in words, a qirad in words
      await test('second expedition: four sections, steppers, refusals in words and the qirad written out', async () => {
        await page.click('#btn-outfit');
        await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
        eq(await page.$$eval('#panel-outfit .step', s => s.map(x => x.id)), ['outfit-who', 'outfit-where', 'outfit-carry', 'outfit-contract']);
        eq(await page.$$eval('.agent', a => a.length) >= 1, true, 'free agents are seal cards');
        // steppers: a group with role spinbutton, minus and plus as buttons, the number as text
        const st = await page.$eval('#step-cargo-linen', e => ({ role: e.getAttribute('role'), kids: [...e.children].map(c => c.tagName), val: e.getAttribute('aria-valuenow'), input: !!e.querySelector('input') }));
        eq([st.role, st.kids, st.input], ['spinbutton', ['BUTTON', 'SPAN', 'BUTTON'], false]);
        await page.focus('#step-cargo-linen');
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        eq(await page.$eval('#step-cargo-linen', e => e.getAttribute('aria-valuenow')), String(Number(st.val) + 2), 'arrow keys raise the number');
        await page.click('#step-cargo-linen-minus');
        eq(await page.$eval('#step-cargo-linen', e => e.getAttribute('aria-valuenow')), String(Number(st.val) + 1), 'the minus button lowers it');
        // nothing carried: a refusal in words, and Send says it cannot
        for (const id of await page.$$eval('[id^="step-cargo-"][role="spinbutton"]', es => es.map(e => e.id))) { await page.focus(`#${id}`); await page.keyboard.press('Home'); }
        eq(await page.$eval('#outfit-send', b => b.getAttribute('aria-disabled')), 'true', 'nothing carried: Send is disabled');
        ok((await page.$eval('#outfit-reasons', e => e.textContent)).includes('Send some goods or some dinars'), await page.$eval('#outfit-reasons', e => e.textContent));
        // a qirad: the share in words, partners as a stepper
        await page.$eval('#contract-qirad', b => b.scrollIntoView({ block: 'center' }));
        eq(await page.$eval('#contract-qirad', b => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(t); }), true, 'the qirad choice is not under the Send bar');
        await page.click('#contract-qirad');
        ok((await page.$eval('#contract-qirad', e => e.textContent)).includes('keeps one third of the profit'), await page.$eval('#contract-qirad', e => e.textContent));
        eq(await page.$eval('#contract-qirad', e => e.getAttribute('aria-checked')), 'true', 'the qirad is the chosen contract');
        eq(await page.$eval('#step-partners', e => e.getAttribute('role')), 'spinbutton');
        await page.focus('#step-purse'); await page.keyboard.press('PageUp');
        eq(await page.$eval('#step-purse', e => e.getAttribute('aria-valuenow')), '250', 'PageUp moves the purse by 250 (MER-72)');
        await page.click('#outfit-send');
        await page.waitForFunction(() => !document.getElementById('panel-outfit'));
        const x = await page.evaluate(() => window.__merchant.state.expeditions.at(-1));
        eq([x.contract.kind, x.contract.agentShare, x.contract.of, x.purse], ['qirad', 1, 3, 250]);
        ok(x.staked.partners > 0, 'partners put money in');
      });
      // Cairo's legs are all one season, so no seeded game ever stands a token part way along one.
      // Lengthen the live leg in the page and look again: the token sits at the fraction done, and
      // two expeditions at the same place on a leg are one token with a count.
      await test('tokens stand at the fraction of their leg done, and two on the same spot stack with a count', async () => {
        await page.evaluate(() => {
          const m = window.__merchant, x = m.state.expeditions.at(-1), leg = m.content.routes.find(r => r.id === x.route).legs[x.leg];
          leg.seasons = 4; x.left = 3; x.status = 'out';
          m.state.expeditions.push({ ...structuredClone(x), id: 'x-twin', agent: 'ali' });
        });
        await goDesk(page); await goMap(page);
        const ts = await tokens(page);
        eq(ts.length, 1, 'two expeditions on one spot are one token');
        eq([ts[0].count, ts[0].ids.split(' ').length], ['2', 2]);
        const info = await page.evaluate(() => {
          const x = window.__merchant.state.expeditions.at(-1), leg = window.__merchant.content.routes.find(r => r.id === x.route).legs[x.leg];
          const at = id => { const d = document.querySelector(`.dot[data-stop="${id}"]`); return [parseFloat(d.style.left), parseFloat(d.style.top)]; };
          return { a: at(leg.from), b: at(leg.to) };
        });
        const want = [info.a[0] + (info.b[0] - info.a[0]) * 0.25, info.a[1] + (info.b[1] - info.a[1]) * 0.25];
        ok(Math.abs(ts[0].left - want[0]) < 0.15 && Math.abs(ts[0].top - want[1]) < 0.15, `token at ${ts[0].left}, ${ts[0].top}, a quarter along is ${want}`);
        ok(ts[0].label.startsWith('2 expeditions, home about '), ts[0].label);
      });
    }
    await page.close();
  }

  // ---- MER-72: the outfit sheet's money. Starts apart from the games above: this one chooses "Send Yusuf"
  // at the first expedition card, which the cases above never do.
  {
    const M72 = await import(pathToFileURL(path.join(MER, 'engine', 'market.js')).href);
    const moneyOf = page => page.evaluate(() => window.__merchant.state.money);
    const numOf = t => Number(t.match(/[\d,]+(?= dinars?)/)[0].replace(/,/g, ''));
    const { page, consoleErrors } = await open(FRAME);
    await start(page, 'pointer');
    // the first card's choice is the one on `go`; the opening letter first
    let before = null;
    for (const [p, id] of [['p0-0', 'begin'], ['p0-1', 'go']]) {
      if (id === 'go') before = await moneyOf(page);
      await page.$eval(`#choice-${p}-${id}`, b => b.scrollIntoView({ block: 'center' }));
      await page.click(`#choice-${p}-${id}`);
      await page.waitForSelector(BACK);
      await page.$eval('#btn-next', b => b.scrollIntoView({ block: 'center' }));
      await page.click('#btn-next');
      if (id === 'begin') await page.waitForFunction(pp => !document.querySelector(`[data-paper="${pp}"][data-face="back"]`), {}, p);
    }
    await page.waitForSelector('#outfit-send');

    await test('MER-72: the purse moves by 50 a press, 10 with Shift, and a typed amount is taken, commas and all', async () => {
      await goMap(page);
      await page.click('#btn-outfit');
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await page.click('#change-carry');
      await page.waitForSelector('#step-purse');
      const val = () => page.$eval('#step-purse', e => e.getAttribute('aria-valuenow'));
      eq(await val(), '0');
      await page.click('#step-purse-plus'); eq(await val(), '50', 'one press, 50');
      await page.click('#step-purse-plus'); eq(await val(), '100');
      await page.keyboard.down('Shift'); await page.click('#step-purse-plus'); await page.keyboard.up('Shift');
      eq(await val(), '110', 'Shift, 10');
      await page.keyboard.down('Shift'); await page.click('#step-purse-minus'); await page.keyboard.up('Shift');
      eq(await val(), '100');
      await page.focus('#step-purse'); await page.keyboard.press('ArrowUp'); eq(await val(), '150', 'the arrow key is 50 as well');
      await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift'); eq(await val(), '140');
      await page.$eval('#typed-purse', e => { e.focus(); e.select(); });
      await page.keyboard.type('1,250'); await page.keyboard.press('Enter');
      await page.waitForSelector('#step-purse');
      eq(await val(), '1250', 'a typed amount is taken');
      eq(await page.$eval('#typed-purse', e => e.value), '1250');
      eq(await page.evaluate(() => document.activeElement.id), 'typed-purse', 'focus stays in the box');
      // an amount the house does not have is taken as typed and refused in words, with commas
      await page.$eval('#typed-purse', e => { e.focus(); e.select(); });
      await page.keyboard.type('99999'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /99,999 dinars/.test(document.getElementById('outfit-reasons').textContent));
      eq(await page.$eval('#outfit-send', b => b.getAttribute('aria-disabled')), 'true');
      ok((await page.$eval('#outfit-reasons', e => e.textContent)).includes('costs 99,999 dinars'), await page.$eval('#outfit-reasons', e => e.textContent));
    });

    await test('MER-72: the sheet lists what makes the cost up, and the number it shows is the number Send takes', async () => {
      await page.$eval('#typed-purse', e => { e.focus(); e.select(); });
      await page.keyboard.type('100'); await page.keyboard.press('Enter');
      await page.waitForSelector('#step-purse');
      // more linen than the warehouse holds, so some is bought in Cairo at a price that rises with each load
      await page.focus('#step-cargo-linen');
      for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowUp');
      const rows = await page.$$eval('#outfit-costs li', ls => ls.map(l => l.textContent));
      ok(rows.length >= 2, JSON.stringify(rows));
      ok(rows.some(r => /linen/.test(r) && /from the warehouse/.test(r) && /bought in Cairo/.test(r)), JSON.stringify(rows));
      ok(rows.some(r => /Money to buy with on the way/.test(r) && /100 dinars/.test(r)), JSON.stringify(rows));
      const shown = numOf(await page.$eval('#outfit-cost-total', e => e.textContent));
      const money0 = await moneyOf(page);
      ok(shown > 100, `the bought linen is in the number: ${shown}`);
      const later = await page.$$eval('#outfit-costs .cost-later', ps => ps.map(p => p.textContent));
      ok(later.some(t => /wage, about [\d,]+ dinars/.test(t)), `what comes later is listed apart: ${JSON.stringify(later)}`);
      await page.click('#outfit-send');
      await page.waitForFunction(() => !document.getElementById('panel-outfit'));
      eq(money0 - await moneyOf(page), shown, 'the number shown is the number taken, to the dinar');
    });
    await test('MER-72: no console error, nothing offsite', async () => { eq(consoleErrors, []); eq(page.__blocked, []); });
    await page.close();

    // the far end: what the house last heard, its date, and a guess from the engine's own function
    const q = await open(FRAME);
    await start(q.page, 'pointer');
    await answerFirst(q.page, 'pointer');
    await goMap(q.page);
    await test('MER-72: with no news, a good says so plainly and offers no guess; after a letter, the last price, its date and the engine\'s guess', async () => {
      await q.page.click('#btn-outfit');
      await q.page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await q.page.click('#change-carry');
      await q.page.waitForSelector('#step-cargo-linen');
      const far0 = await q.page.$eval('#step-cargo-linen', e => e.closest('li').querySelector('.far').textContent);
      ok(/^No news of what linen fetches in Damascus\.$/.test(far0), far0);
      eq(await q.page.$eval('#step-cargo-linen', e => e.closest('li').querySelector('.might')), null, 'no news, no guess');
      await q.page.click('#outfit-cancel');
      await q.page.waitForFunction(() => !document.getElementById('panel-outfit'));
      await goDesk(q.page);
      await uiSeason(q.page, 'pointer');
      await q.page.waitForFunction(() => window.__merchant.state.t === 1);
      await goMap(q.page);
      await q.page.click('#btn-outfit');
      await q.page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await q.page.click('#change-carry');
      await q.page.waitForSelector('#step-cargo-linen');
      const li = await q.page.$eval('#step-cargo-linen', e => ({ far: e.closest('li').querySelector('.far').textContent, might: e.closest('li').querySelector('.might')?.textContent }));
      const st = await engineState(q.page);
      const k = st.known.damascus.linen, want = M72.expectedPrice(st, nodeContent, 'damascus', 'linen');
      ok(k && want, 'a letter from Damascus has come');
      ok(li.far.includes(`Damascus paid ${withCommas(k.p)}`) && li.far.includes(want.written), li.far);
      eq(li.might, `Linen might sell for about ${withCommas(want.p)} there.`);
    });
    await test('MER-72: the first season\'s one-line price letter names the linen the house holds, not only the pepper', async () => {
      const v = await q.page.evaluate(() => window.__merchant.state.desk.filter(p => p.kind === 'news').map(p => p.line));
      ok(v.length === 1 && /for linen/.test(v[0]) && /for pepper/.test(v[0]), JSON.stringify(v));
    });
    await q.page.close();
  }

  // the board needs no horizontal scroll and the map table can be used at every frame
  for (const frame of FRAMES) {
    const { page, consoleErrors } = await open(frame);
    await start(page, 'pointer');
    await answerFirst(page, 'pointer');
    await goMap(page);
    await page.screenshot({ path: path.join(SHOTS, `map-${frame.name}.png`) });
    await test(`${frame.name}: the map table has no horizontal overflow, its buttons are 44 px, the picture is whole`, async () => {
      const m = await page.evaluate(() => {
        const f = document.getElementById('map-frame').getBoundingClientRect();
        return { doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth], frame: [Math.round(f.width / f.height * 100) / 100, f.left >= -1, f.right <= innerWidth + 1],
          hits: [...document.querySelectorAll('#btn-outfit, #map-desk, #map-desk-top, .stoplist .option')].map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className, Math.round(r.height)]; }) };
      });
      eq(m.doc[0], m.doc[1]);
      eq(m.frame, [1.78, true, true], 'the 16:9 picture is shown whole');
      for (const [id, hgt] of m.hits) ok(hgt >= 44, `${id} is ${hgt} px tall`);
    });
    // DESIGN 4.7 and MER-44b: labels are placed by collision avoidance. The four frames the unit names.
    if (['laptop', 'board', 'laptop-small', 'phone-upright'].includes(frame.name)) {
      await test(`${frame.name} ${frame.width}x${frame.height}: no two map labels overlap, none is cut by the picture or lies under the price panel, and every dot names its stop`, async () => {
        const r = await page.evaluate(() => {
          const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
          const key = e => e.dataset.stop ?? `cluster:${e.dataset.cluster}`;
          return {
            frame: box(document.getElementById('map-frame')), board: box(document.getElementById('board')),
            labels: [...document.querySelectorAll('.stop-label')].map(l => ({ id: key(l), hidden: l.hidden, ...box(l) })),
            dots: [...document.querySelectorAll('.dot')].map(d => ({ id: key(d), name: d.getAttribute('aria-label'), role: d.getAttribute('role'), ...box(d) })),
          };
        });
        const shown = r.labels.filter(l => !l.hidden);
        const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
        for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) ok(!hit(shown[i], shown[j]), `${shown[i].id} overlaps ${shown[j].id}`);
        for (const l of shown) {
          ok(l.l >= r.frame.l - 0.5 && l.r <= r.frame.r + 0.5 && l.t >= r.frame.t - 0.5 && l.b <= r.frame.b + 0.5, `${l.id} is cut by the picture's edge`);
          ok(!hit(l, r.board), `${l.id} is under the price panel`);
        }
        eq(r.dots.map(d => d.id).sort(), r.labels.map(l => l.id).sort(), 'every label has its dot');
        for (const d of r.dots) ok(d.role === 'img' && d.name && d.name.length > 1, `the dot for ${d.id} has no name`);
        // not vacuous: a placement that hides everything would pass the overlap check
        if (frame.width >= 1280) eq(r.labels.filter(l => l.hidden).map(l => l.id), [], 'room for every label at this size');
        else ok(shown.length >= 10, `only ${shown.length} labels shown`);
        if (frame.width >= 1280) {
          // the picture sits beside the price panel, so the far stops are on the picture and named
          ok(r.frame.r <= r.board.l + 0.5, `the picture (right edge ${r.frame.r}) runs under the panel (left edge ${r.board.l})`);
          for (const id of ['calicut', 'samarkand']) {
            const d = r.dots.find(x => x.id === id), l = r.labels.find(x => x.id === id);
            ok(d.l >= r.frame.l && d.r <= r.frame.r && d.t >= r.frame.t && d.b <= r.frame.b, `${id}'s dot is off the picture`);
            ok(!l.hidden, `${id} has no label`);
          }
        }
      });
      await test(`${frame.name}: the stop list starts on a whole row, keeps the lit row whole, and Home shows Cairo`, async () => {
        const rows = () => page.evaluate(() => {
          const lr = document.getElementById('stoplist').getBoundingClientRect();
          const seen = [...document.querySelectorAll('#stoplist .option')].map(o => ({ id: o.dataset.stop, ...o.getBoundingClientRect().toJSON() })).filter(o => o.bottom > lr.top + 1 && o.top < lr.bottom - 1);
          return { top: lr.top, bottom: lr.bottom, first: seen[0], lit: document.querySelector('#stoplist .option.lit')?.getBoundingClientRect().toJSON() };
        });
        let v = await rows();
        ok(v.first.top >= v.top - 0.5, `the first row in view starts ${Math.round(v.top - v.first.top)} px above the list`);
        await page.focus('#stoplist');
        await page.keyboard.press('End');
        v = await rows();
        // (at the very end of a scrolled list the top row may be cut: there is no boundary left to stop on)
        ok(v.lit.top >= v.top - 0.5 && v.lit.bottom <= v.bottom + 0.5, 'the lit row is whole in the list');
        await page.keyboard.press('Home');
        v = await rows();
        eq(v.first.id, 'cairo', 'Home shows the first row, Cairo');
        ok(v.first.top >= v.top - 0.5 && v.first.top <= v.top + 1, 'and it is not scrolled under a blank strip');
      });
    }
    if (frame.width < 700) {
      await test(`${frame.name}: close stops are one cluster label and pressing it zooms to an inset`, async () => {
        const cl = await page.$$eval('.cluster-label:not([hidden])', ls => ls.map(l => l.textContent));
        // the names are city.json's `clusters`, one label for each group of close stops
        const want = Object.entries(nodeContent.city.clusters).map(([id, name]) => `${name}: ${nodeContent.stops.filter(x => x.cluster === id).length} stops`);
        eq(want.length, 5, 'Cairo names five clusters');
        eq(cl.slice().sort(), want.slice().sort(), 'every cluster is labelled by its name from city.json');
        eq(await page.$('.stop-label[data-stop="cairo"]'), null, 'Cairo has no label of its own until the inset');
        const [x, y] = await page.$eval('.dot.cluster[data-cluster="delta"]', d => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        await page.mouse.click(x + 10, y + 6);
        await page.waitForSelector('#map-unzoom:not([hidden])');
        ok(await page.$('.stop-label[data-stop="cairo"]') && await page.$('.stop-label[data-stop="alexandria"]'), 'both stops are named in the inset');
        const [cx, cy] = await page.$eval('.dot[data-stop="alexandria"]', d => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        await page.mouse.click(cx + 12, cy - 12);
        eq(await page.$eval('#stop-alexandria', e => e.getAttribute('aria-selected')), 'true');
        await page.click('#map-unzoom');
        eq(await page.$('.stop-label[data-stop="cairo"]'), null);
      });
    }
    if (frame.name === 'phone-upright') {
      await test('phone upright: the price board is a full-screen dialog opened by a button, closed by Esc, focus back on the button', async () => {
        eq(await page.$eval('#prices-box', e => getComputedStyle(e).display), 'none');
        await page.click('#btn-prices');
        eq(await page.$eval('#prices-box', e => [e.getAttribute('role'), e.getAttribute('aria-modal'), Math.round(e.getBoundingClientRect().width) === innerWidth]), ['dialog', 'true', true]);
        await page.keyboard.press('Escape');
        eq(await page.$eval('#prices-box', e => getComputedStyle(e).display), 'none');
        eq(await page.evaluate(() => document.activeElement.id), 'btn-prices');
      });
    }
    await test(`${frame.name}: map table, no offsite request, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
    await page.close();
  }

  // ---- MER-46: a whole three-act game, once by pointer and once by keyboard alone, on the fixed seed.
  // After every season the page is compared with the engine run in Node on the same seed (the bar,
  // the counter, the papers, and the whole saved state), the years between acts are read off the
  // interlude page, and the last page is the ending stub. A reload in the middle of act two must
  // pick the game up where it was. Reduced motion is on so 24 seasons do not wait on card flips;
  // the flips themselves are covered by the cases above.
  const RELOAD_AT = 12; // season 13 of 24, the fifth of act two (acts run t 0-7, 8-15, 16-23)
  const playWhole = async (page, how) => {
    await reduceMotion(page);
    await start(page, how === 'pointer' ? 'pointer' : 'keys');
    let model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    const state = () => engineState(page);
    // the engine's side of a season: the first choice that is open to the player, the first
    // expedition sent on the engine's own plan, every other paper set aside, then End the season
    const nodeSeason = s => {
      for (const p of s.desk) {
        if (p.state !== 'open') continue;
        const cs = eng.paperChoices(s, nodeContent, p.id);
        const c = cs.find(x => { try { eng.choose(s, nodeContent, p.id, x.id); return true; } catch { return false; } });
        s = eng.choose(s, nodeContent, p.id, c.id);
        if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(s, nodeContent, 'damascus'); if (plan) s = eng.outfit(s, nodeContent, plan); }
      }
      return eng.endSeason(s, nodeContent);
    };
    const faceOf = () => page.evaluate(() => ({ kind: document.querySelector('.sheet')?.dataset.kind, face: document.querySelector('.sheet')?.dataset.face }));
    const sendByKeys = async () => {
      await page.waitForSelector('#outfit-send, #map-toast:not([hidden])');
      if (await page.$('#outfit-send')) { await page.focus('#outfit-send'); await page.keyboard.press('Enter'); await page.waitForSelector('#map-toast:not([hidden])'); }
      await page.keyboard.press('Escape');
      await page.waitForSelector('#screen-desk');
    };
    const pointerSeason = async () => {
      for (let guard = 0; guard < 14; guard++) {
        if (await page.$eval('#btn-end', b => b.getAttribute('aria-disabled') === 'false')) break;
        const k = await faceOf();
        if (k.face === 'back') { await page.click('#btn-next'); await sendFromMap(page); continue; }
        if (['return', 'lost', 'news', 'accounts'].includes(k.kind)) { await page.click('#btn-next'); continue; }
        await page.click('.sheet .choice:not([aria-disabled="true"])');
        await page.waitForSelector(BACK);
      }
      await page.click('#btn-end');
    };
    const keySeason = async () => {
      for (let guard = 0; guard < 14; guard++) {
        if (await page.$eval('#btn-end', b => b.getAttribute('aria-disabled') === 'false')) break;
        const k = await faceOf();
        if (k.face === 'back') {
          await page.keyboard.press('Enter');
          if (['#map', '#outfit'].includes(await hashOf(page))) await sendByKeys();
          continue;
        }
        if (['return', 'lost', 'news', 'accounts'].includes(k.kind)) {
          // a record paper has no digit and Enter on its heading does nothing: Tab from the heading reaches Next
          if (await page.evaluate(() => document.activeElement.id) !== 'btn-next') {
            for (let i = 0; i < 6 && await page.evaluate(() => document.activeElement.id) !== 'btn-next'; i++) await page.keyboard.press('Tab');
          }
          eq(await page.evaluate(() => document.activeElement.id), 'btn-next', 'Tab reaches Next on a record paper');
          await page.keyboard.press('Enter'); continue;
        }
        const n = await page.$$eval('.sheet .choice', cs => cs.findIndex(c => c.getAttribute('aria-disabled') !== 'true'));
        await page.keyboard.press(String(n + 1));
        await page.waitForSelector(BACK);
      }
      await page.keyboard.press('e');
    };
    const season = how === 'pointer' ? pointerSeason : keySeason;
    const seasonsSeen = [], interludes = [];
    let reloaded = false;
    for (let guard = 0; guard < 60 && model.phase !== 'recall'; guard++) {
      if (model.phase === 'interlude') {
        const gap = eng.view(model, nodeContent).interlude;
        await page.waitForSelector('#btn-open-house');
        eq(await page.$eval('#phase-title', e => e.textContent), 'Years pass', 'the interlude page');
        eq(await page.$eval('#interlude-span', e => e.textContent), `${gap.from} to ${gap.to}`, 'the years named on the interlude page');
        eq(await state(), JSON.parse(JSON.stringify(model)), `at the interlude before t=${model.t}`);
        interludes.push({ page: `${gap.from} to ${gap.to}`, engine: gap });
        model = eng.openSeason(model, nodeContent);
        if (how === 'pointer') await page.click('#btn-open-house');
        else { await page.focus('#btn-open-house'); await page.keyboard.press('Enter'); }
        await page.waitForFunction(t => document.getElementById('bar-count')?.textContent.startsWith(`Season ${t + 1} `), {}, model.t);
        continue;
      }
      await sameScreen(page, model, `${how} season ${model.t + 1}`, { raisedFirst: false });
      seasonsSeen.push(model.t);
      model = nodeSeason(model);
      await season();
      if (model.phase === 'desk') await page.waitForFunction(t => document.getElementById('bar-count')?.textContent.startsWith(`Season ${t + 1} `), {}, model.t);
      eq(await state(), JSON.parse(JSON.stringify(model)), `${how}: engine state after season ${seasonsSeen.length}`);
      if (model.t === RELOAD_AT && !reloaded) {
        reloaded = true;
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('#screen-desk .sheet-title');
        await sameScreen(page, model, `${how} after the reload in act two`, { raisedFirst: false });
        eq(await state(), JSON.parse(JSON.stringify(model)), `${how}: state after the reload`);
        await reduceMotion(page);
      }
    }
    // the end: phase recall, the stub page, and the same saved game as the engine's
    await page.waitForSelector('#btn-to-title');
    eq(await page.$eval('#phase-title', e => e.textContent), 'The last season is over');
    eq(await state(), JSON.parse(JSON.stringify(model)), `${how}: the ended game`);
    return { seasonsSeen, interludes, reloaded, model };
  };

  for (const how of ['pointer', 'keyboard']) {
    const { page, consoleErrors } = await open(FRAMES[0]);
    let out;
    await test(`whole game by ${how}: three acts, 24 seasons, the page matches the engine after each, reload in act two`, async () => {
      try { out = await playWhole(page, how); }
      catch (e) { // say where the page was, so a stuck game names its screen and not just a timeout
        const where = await page.evaluate(() => ({ hash: location.hash, t: window.__merchant?.state.t, phase: window.__merchant?.state.phase, sheet: document.querySelector('.sheet')?.dataset, title: document.querySelector('.sheet-title')?.textContent, focus: document.activeElement.id || document.activeElement.className, end: document.getElementById('btn-end')?.getAttribute('aria-disabled') })).catch(() => ({}));
        throw new Error(`${e.message} (page at ${JSON.stringify(where)})`);
      }
      eq(out.seasonsSeen, Array.from({ length: 24 }, (_, i) => i), 'every season of the three acts was played on screen');
      eq(out.reloaded, true, 'the reload in act two happened');
      eq(out.interludes.length, 2, 'two interludes, between acts one and two and acts two and three');
      eq(out.model.phase, 'recall');
    });
    await test(`whole game by ${how}: nothing offsite, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
    await page.screenshot({ path: path.join(SHOTS, `ending-stub-${how}.png`) });
    await page.close();
  }

  // ---- MER-62: the ledger and the notebook, by pointer and by keyboard. The save is built in Node by the
  // engine on this seed (two seasons played: an expedition out, goods in the warehouse, notebook entries met),
  // given a loan and the `season` log entries the ledger's money trail reads, and loaded as a player would.
  {
    const policy = s => {
      for (const p of s.desk) {
        if (p.state !== 'open') continue;
        const c = eng.paperChoices(s, nodeContent, p.id).find(x => { try { eng.choose(s, nodeContent, p.id, x.id); return true; } catch { return false; } });
        s = eng.choose(s, nodeContent, p.id, c.id);
        if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(s, nodeContent, 'damascus'); if (plan) s = eng.outfit(s, nodeContent, plan); }
      }
      return eng.endSeason(s, nodeContent);
    };
    let book = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    while (book.t < 2) book = policy(book);
    book.loans.push({ id: 'nell-1', from: 'nell', principal: 100, due: book.t + 4, rate: 0.1 });
    for (const [i, change] of [[0, -60], [1, 120], [2, -45], [3, 80], [4, 300]]) book.log.push({ at: i, kind: 'season', change });
    book.agents.yusuf.trust = -1; book.rep.court = 3; book.rep.partners = -3; book.rep.agents = 1;
    const view = eng.view(book, nodeContent);
    const total = nodeContent.notebook.length;
    const found = nodeContent.notebook.filter(e => book.notebook.includes(e.id));
    const loadBook = async (page, hash = '#desk') => {
      await page.goto(GAME, { waitUntil: 'load' });
      await page.evaluate((st, v) => { localStorage.clear(); localStorage.setItem('merchant-save', JSON.stringify({ ...st, __v: v })); }, JSON.parse(JSON.stringify(book)), SAVE_VERSION);
      await page.goto(GAME + hash, { waitUntil: 'load' });
      await page.waitForSelector('#screen-desk .sheet-title');
    };
    const closed = (page, name) => page.waitForFunction(n => !document.getElementById(`panel-${n}`), {}, name);
    const opened = (page, name) => page.waitForFunction(n => document.getElementById(`panel-${n}`)?.open, {}, name);
    const texts = (page, sel) => page.$$eval(sel, es => es.map(e => e.textContent.replace(/\s+/g, ' ').trim()));

    for (const how of ['pointer', 'keyboard']) {
      const { page, consoleErrors } = await open(FRAMES[0]);
      await loadBook(page);
      const openBy = async (name, key) => {
        if (how === 'pointer') await page.click(`#btn-${name}`);
        else { await page.focus('body'); await page.keyboard.press(key); }
        await opened(page, name);
      };
      const closeBy = async (name, route) => {
        if (route === 'Esc') await page.keyboard.press('Escape');
        else if (route === 'Back') await page.goBack();
        else await page.click(`#panel-${name}-close`);
        await closed(page, name);
      };

      await test(`${how}: the ledger opens as a dialog on its title, and says the money, the loan and the last four seasons from the log`, async () => {
        await openBy('ledger', 'l');
        eq(await hashOf(page), '#ledger');
        eq(await focusId(page), 'panel-ledger-title');
        eq(await page.$eval('#panel-ledger', d => [d.tagName, d.getAttribute('aria-labelledby'), d.matches(':modal')]), ['DIALOG', 'panel-ledger-title', true]);
        eq(await texts(page, '#panel-ledger h3'), ['Money', 'Warehouse', 'Out on the road', 'People']);
        eq(await texts(page, '#ledger-have'), [`The house has ${withCommas(book.money)} dinars.`]);
        eq(await texts(page, '#ledger-loans li'), ['Owes 100 dinars to Nell, due Autumn 1325.']);
        eq(await texts(page, '#ledger-trail li'), ['Summer 1324 +120 dinars', 'Autumn 1324 −45 dinars', 'Winter 1324 +80 dinars', 'Spring 1325 +300 dinars'], 'the last four of the five log entries, oldest first');
        eq(await page.$$eval('#ledger-trail li', es => es.map(e => e.dataset.change)), ['120', '-45', '80', '300'], 'the last four of the five entries, oldest first, each as the log wrote it');
        ok((await texts(page, '#ledger-trail li')).every(t => /[+−]\d+ dinars$/.test(t)), 'signed with a real minus');
      });

      await test(`${how}: the ledger's warehouse shows each good with Cairo's price as last known and its date, from the engine's view`, async () => {
        const want = Object.entries(book.stock).filter(([, q]) => q > 0).map(([id, q]) => {
          const g = nodeContent.goods.find(x => x.id === id), p = view.prices.cairo[id];
          return `${q} ${q === 1 ? g.unit : g.unit + 's'} of ${g.name.toLowerCase()} Cairo price ${p.p} ${p.p === 1 ? 'dinar' : 'dinars'} a ${g.unit}, ${p.written}, ${p.ageWords}`;
        });
        ok(want.length >= 2, 'the saved game holds at least two goods');
        eq(await texts(page, '#ledger-stock li'), want);
      });

      await test(`${how}: the ledger's road and people sections name where each is, when due, the traits and trust in words, and the four reputations with numbers`, async () => {
        const trip = (await texts(page, '#ledger-trips li'))[0];
        ok(trip.startsWith('Yusuf to Damascus Last heard of on the '), trip);
        ok(/Due home about (Spring|Summer|Autumn|Winter) \d{4}\.$/.test(trip), trip);
        eq(await page.$$eval('#ledger-trips li', es => es.length), book.expeditions.length);
        const yusuf = await page.$eval('[data-agent="yusuf"]', e => e.textContent.replace(/\s+/g, ' ').trim());
        eq(yusuf, 'Yusuf careful, knows Damascus Yusuf is uneasy with the house. On the road to Damascus.');
        ok(await page.$eval('[data-agent="yusuf"] img.seal', i => i.complete && i.naturalWidth > 0), 'the seal shows');
        eq(await texts(page, '#ledger-reps li'), ['Partners They will not deal with you −3', 'Agents They speak well of you +1',
          'The court They come to you first +3', 'Foreign merchants They deal with you as with anyone 0']);
      });

      await test(`${how}: Esc, Back and Close each close the ledger, step the hash back and return focus to its button`, async () => {
        await closeBy('ledger', 'Esc');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-ledger'], 'Esc');
        await openBy('ledger', 'l'); await closeBy('ledger', 'Back');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-ledger'], 'Back');
        await openBy('ledger', 'l'); await closeBy('ledger', 'Close');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-ledger'], 'Close');
        eq(await page.evaluate(() => history.length > 0 && !document.querySelector('dialog[open]')), true);
      });

      await test(`${how}: the warehouse button opens the ledger at Warehouse and Esc puts focus back on it`, async () => {
        if (how === 'pointer') await page.click('#btn-warehouse');
        else { await page.focus('#btn-warehouse'); await page.keyboard.press('Enter'); }
        await opened(page, 'ledger');
        eq(await focusId(page), 'ledger-warehouse-h');
        ok(await page.$eval('#ledger-warehouse-h', e => { const r = e.getBoundingClientRect(), d = document.getElementById('panel-ledger').getBoundingClientRect(); return r.top >= d.top && r.bottom <= d.bottom; }), 'the Warehouse heading is on screen');
        await page.keyboard.press('Escape'); await closed(page, 'ledger');
        eq(await focusId(page), 'btn-warehouse');
      });

      await test(`${how}: the notebook opens as a tab list; the count on its button and its heading are the engine's`, async () => {
        await openBy('notebook', 'n');
        eq(await hashOf(page), '#notebook');
        eq(await focusId(page), 'panel-notebook-title');
        eq(await texts(page, '[role="tab"]'), ['terms', 'places', 'people', 'goods'].map(t => `${cap(t)} ${found.filter(e => e.tab === t).length}`));
        eq(await texts(page, '#nb-count'), [`${found.length} of ${total} found`]);
        eq(await page.$eval('[role="tablist"]', e => e.getAttribute('aria-label')), 'Notebook');
        eq(await page.$$eval('[role="tab"]', ts => ts.map(t => [t.getAttribute('aria-selected'), t.tabIndex])), [['true', 0], ['false', -1], ['false', -1], ['false', -1]]);
        eq(await page.$eval('[role="tabpanel"]', p => p.getAttribute('aria-labelledby')), 'nb-tab-terms');
      });

      await test(`${how}: arrow keys, Home and End move between the tabs; each tab lists its entries in the order met, then a blank line for each not met`, async () => {
        await page.focus('#nb-tab-terms');
        const order = [];
        for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) {
          await page.keyboard.press(key);
          order.push(await focusId(page));
        }
        eq(order, ['nb-tab-places', 'nb-tab-people', 'nb-tab-goods', 'nb-tab-terms', 'nb-tab-goods', 'nb-tab-goods', 'nb-tab-terms']);
        for (const tab of ['terms', 'places', 'people', 'goods']) {
          if (how === 'pointer') await page.click(`#nb-tab-${tab}`);
          else { await page.focus('#nb-tab-terms'); for (let n = 0; n < ['terms', 'places', 'people', 'goods'].indexOf(tab); n++) await page.keyboard.press('ArrowRight'); }
          eq(await page.$eval(`#nb-tab-${tab}`, t => t.getAttribute('aria-selected')), 'true');
          const here = nodeContent.notebook.filter(e => e.tab === tab);
          const metOrder = book.notebook.map(id => nodeContent.notebook.find(e => e.id === id)).filter(e => e.tab === tab).map(e => e.title);
          eq(await texts(page, '.nb-entry h4'), metOrder, `${tab}: the entries met, in the order met`);
          eq(await page.$$eval('.nb-blank', b => b.length), here.length - metOrder.length, `${tab}: one blank line for each not met`);
          eq(await texts(page, '#nb-tab-count'), [`${metOrder.length} of ${here.length} found`]);
          if (here.length > metOrder.length) eq(await page.$eval('.nb-blanks', e => e.getAttribute('aria-hidden')), 'true', `${tab}: the blank lines are not read out`);
        }
      });

      await test(`${how}: an entry shows its title, its body and a source line written as author, title, year and page, with no web address`, async () => {
        await page.click('#nb-tab-places');
        const e = found.find(x => x.tab === 'places');
        const entry = await page.$eval(`[data-entry="${e.id}"]`, n => ({ title: n.querySelector('h4').textContent, body: n.querySelector('.nb-body').textContent, source: n.querySelector('.source').textContent }));
        eq([entry.title, entry.body], [e.title, e.body]);
        const src = nodeContent.sources.find(x => x.id === e.sources[0].src);
        ok(entry.source.startsWith(`Source: ${src.author}, ${src.title}, ${src.year}`), entry.source);
        ok(/, (vol\. \d+, )?pp?\. \d/.test(entry.source), `a page: ${entry.source}`);
        ok(!/https?:|www\.|\.com|\.org/.test(entry.source), 'no address');
        eq(await page.$$eval('.nb-entry .source', ss => ss.every(s => s.textContent.startsWith('Source: ') && s.textContent.endsWith('.'))), true, 'every source line is written the same way');
      });

      await test(`${how}: Esc, Back and Close each close the notebook and put focus back on the Notebook button`, async () => {
        await closeBy('notebook', 'Esc');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-notebook'], 'Esc');
        await openBy('notebook', 'n'); await closeBy('notebook', 'Back');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-notebook'], 'Back');
        await openBy('notebook', 'n'); await closeBy('notebook', 'Close');
        eq([await hashOf(page), await focusId(page)], ['#desk', 'btn-notebook'], 'Close');
      });

      await test(`${how}: a reload on #ledger and on #notebook shows the panel over the desk`, async () => {
        for (const name of ['ledger', 'notebook']) {
          await loadBook(page, `#${name}`);
          await opened(page, name);
          ok(await page.$('#screen-desk'), `${name}: the desk is behind it`);
          eq(await focusId(page), `panel-${name}-title`);
          await page.keyboard.press('Escape'); await closed(page, name);
        }
      });

      await test(`${how}: #ledger with no game goes to the title and is not left in history`, async () => {
        await page.goto(GAME, { waitUntil: 'load' });
        await page.evaluate(() => localStorage.clear());
        await page.goto(GAME + '#ledger', { waitUntil: 'load' });
        await page.waitForSelector('#screen-title');
        eq(await hashOf(page), '#title');
        eq(await page.$('#panel-ledger'), null);
      });

      await test(`${how}: ledger and notebook, no offsite request, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }

    // the phone frames hold only Menu in the bar (DESIGN 5.2, 5.3): the ledger and the notebook are in it
    for (const frame of [FRAMES[3], FRAMES[5]]) {
      const { page, consoleErrors } = await open(frame);
      await loadBook(page);
      await test(`${frame.name}: Menu holds Ledger and Notebook; each closes back to Menu, and neither dialog overflows`, async () => {
        for (const name of ['ledger', 'notebook']) {
          eq(await page.$eval(`#btn-${name}`, e => e.checkVisibility()), false, 'the bar holds only Menu here');
          await page.click('#btn-menu'); await page.waitForSelector(`#menu-${name}`); await page.click(`#menu-${name}`);
          await opened(page, name);
          await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
          const m = await page.$eval(`#panel-${name}`, d => ({ x: [d.scrollWidth, d.clientWidth], r: d.getBoundingClientRect().toJSON(), w: innerWidth, h: innerHeight }));
          eq(m.x[0], m.x[1], `${name}: no sideways scroll`);
          ok(m.r.left >= 0 && m.r.right <= m.w + 1 && m.r.bottom <= m.h + 1, `${name}: inside the screen ${JSON.stringify(m.r)}`);
          await page.keyboard.press('Escape'); await closed(page, name);
          eq(await focusId(page), 'btn-menu', `${name}: focus back on Menu`);
        }
      });
      await test(`${frame.name}: ledger and notebook, no offsite request, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
  }

  // ---- MER-63: letters from the road on the desk, an agent's leave notice, the outfit sheet's refusal
  // and the flip that a click has to wait out. The engine runs the same seed in Node. A letter is put
  // in `state.post` (its written season, lag and arrival) and the engine's own endSeason delivers it,
  // so the paper, view().letters and choose() are the engine's; only the draw (every cairo letter has
  // weight 0 until MER-66 lands its ten) is placed by hand.
  {
    const FIRSTC = { 'opening-letter': 'begin', 'first-expedition': 'wait', 'linen-neighbour': 'keep' };
    const afterFirst = () => {
      let s = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
      for (const p of s.desk) if (p.state === 'open') {
        s = eng.choose(s, nodeContent, p.id, FIRSTC[p.ref]);
        if (p.ref === 'first-expedition') s = eng.outfit(s, nodeContent, eng.suggestPlan(s, nodeContent, 'damascus'));
      }
      return s;
    };
    const withLetter = (id, kind, stop, lag, standing) => {
      const s = afterFirst(), x = s.expeditions[0];
      s.post.push({ id, kind, expedition: x.id, agent: x.agent, stop, standing, written: s.t, lag, arrive: s.t + 1 });
      return eng.endSeason(s, nodeContent);
    };
    const question = withLetter('first-road-letter', 'question', 'damascus', 2, false);
    const report = withLetter('toll-at-aydhab', 'report', 'aydhab', 1, true);
    const letterOf = s => s.desk.find(p => p.kind === 'letter' && p.state === 'open');
    const loadSave = async (page, st, hash = '#desk') => {
      await page.goto(GAME, { waitUntil: 'load' });
      await page.evaluate((x, v) => { localStorage.clear(); localStorage.setItem('merchant-save', JSON.stringify({ ...x, __v: v })); }, JSON.parse(JSON.stringify(st)), SAVE_VERSION);
      await page.goto(GAME + hash, { waitUntil: 'load' });
      await page.waitForSelector('#screen-desk .sheet-title, #screen-map');
    };
    // the parts of a letter in the order a screen reader meets them
    const partsOf = page => page.evaluate(() => {
      const sheet = document.querySelector('.sheet[data-kind="letter"]');
      const q = s => sheet.querySelector(s);
      const parts = ['.sheet-head', '.letter-line', '.sheet-title', '.sheet-body', '.choices', '.letter-answer'].map(s => q(s));
      const order = parts.map((e, i) => e ? i : -1).filter(i => i >= 0);
      const inOrder = parts.filter(Boolean).every((e, i, a) => !i || (a[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
      return {
        inOrder, order, id: sheet.dataset.paper, seal: !!q('.sheet-head .seal'), sender: q('.sender')?.textContent,
        line: q('.letter-line')?.textContent, answer: q('.letter-answer')?.textContent, title: q('.sheet-title').textContent,
        body: q('.sheet-body').textContent, labels: [...sheet.querySelectorAll('.choice .label')].map(l => l.textContent),
        described: q('.choices').getAttribute('aria-describedby'), answerId: q('.letter-answer')?.id ?? null,
      };
    });

    {
      const { page, consoleErrors } = await open(FRAMES[0]);
      const p = letterOf(question), v = eng.view(question, nodeContent), def = nodeContent.letters.find(l => l.id === p.ref);
      await loadSave(page, question);
      await test('a question on the desk: seal, where and when it was written, when it came, the choices, then how long the answer takes, in that order', async () => {
        const got = await partsOf(page);
        eq(got.id, p.id);
        eq(got.order, [0, 1, 2, 3, 4, 5], 'all six parts are there');
        ok(got.inOrder, 'the parts follow each other in the document');
        ok(got.seal, 'the agent\'s seal is at the head');
        eq(got.line, v.letters[p.id].line, 'the line is the engine\'s');
        eq(got.line, 'From Yusuf, on the road to Damascus. Written in Spring 1324. It reached you in Summer 1324.');
        eq(got.answer, v.letters[p.id].answer, 'the answer line is the engine\'s');
        eq(got.answer, 'Your answer will reach Yusuf in two seasons.');
        eq([got.title, got.body, got.labels], [def.title, def.body, def.choices.map(c => c.label)]);
        eq(got.described, got.answerId, 'the choices are described by the answer line');
      });
      await test('a question answered by keyboard: the engine\'s order reaches the expedition and the back says what changed', async () => {
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('2');                       // "Take the quicker road"
        await page.waitForSelector(BACK);
        const model = eng.choose(question, nodeContent, p.id, 'go-on');
        const got = await engineState(page);
        eq(got.expeditions, JSON.parse(JSON.stringify(model.expeditions)), 'orders on the expedition');
        eq(got.expeditions[0].orders.map(o => o.go), ['on']);
        eq(got.desk, JSON.parse(JSON.stringify(model.desk)), 'the desk');
        eq(await page.$eval('.sheet-title', e => e.textContent), 'Nothing changed at once.');
        eq(await page.$eval('.sheet .note p', e => e.textContent), def.note);
        await page.keyboard.press('Enter');
        await page.waitForFunction(pp => !document.querySelector(`[data-paper="${pp}"]`) || document.querySelector(`[data-paper="${pp}"][data-face="front"]`) === null, {}, p.id);
        await sameScreen(page, model, 'after the question', { raisedFirst: false });
      });
      await test('letters: no offsite request, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
    {
      const { page, consoleErrors } = await open(FRAMES[0]);
      const p = letterOf(report), v = eng.view(report, nodeContent), def = nodeContent.letters.find(l => l.id === p.ref);
      await loadSave(page, report);
      await test('a report on the desk: its line, no answer line, and the three responses', async () => {
        const got = await partsOf(page);
        eq(got.order, [0, 1, 2, 3, 4], 'five parts, no answer line');
        ok(got.inOrder);
        eq(got.line, v.letters[p.id].line);
        eq(got.line, 'From Yusuf, at Aydhab. Written in Spring 1324. It reached you in Summer 1324.');
        eq(got.answer, undefined);
        eq(got.labels, ['You did right', 'You should have waited', 'Complain to the court in Cairo']);
        eq(got.labels, def.choices.map(c => c.label));
        eq(got.described, null);
      });
      await test('a report answered by pointer: trust and money are the engine\'s, after the report\'s own cost was taken on arrival', async () => {
        await page.click(`#choice-${p.id}-waited`);
        await page.waitForSelector(BACK);
        const model = eng.choose(report, nodeContent, p.id, 'waited');
        const got = await engineState(page);
        eq([got.money, got.agents.yusuf.trust], [model.money, model.agents.yusuf.trust]);
        eq([got.money, got.agents.yusuf.trust], [report.money, -1], 'a lesser reply costs nothing and costs one trust');
        await page.click('#btn-next');
        await page.waitForFunction(pp => !document.querySelector(`[data-paper="${pp}"][data-face="back"]`), {}, p.id);
        eq((await engineState(page)).desk, JSON.parse(JSON.stringify(model.desk)));
      });
      await test('report: no offsite request, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
    // a notice whose words are in paper.data (MER-61b's leave notice): the engine writes it at the opening
    {
      const { page, consoleErrors } = await open(FRAMES[0]);
      let s = afterFirst(); s.agents.ali.trust = -3; s = eng.endSeason(s, nodeContent);
      const n = s.desk.find(x => x.kind === 'notice' && x.ref === 'agent-left' && x.state === 'open');
      await test('the engine writes the leave notice when an agent at home has lost faith (setup for the page case)', async () => { ok(n, 'no agent-left notice on the desk'); eq(n.data.title, 'Ali has left'); });
      await loadSave(page, s);
      await page.click(`.edge[data-paper="${n.id}"]`).catch(() => {});
      await test('the leave notice shows its own title and words, not "A paper"', async () => {
        await page.waitForFunction(i => document.querySelector('.sheet')?.dataset.paper === i, {}, n.id);
        eq(await page.$eval('.sheet-title', e => e.textContent), n.data.title);
        eq(await page.$eval('.sheet .sheet-body', e => e.textContent), n.data.body);
        ok(!(await page.$$eval('.edge', es => es.map(e => e.textContent))).includes('A paper'), 'an edge still says "A paper"');
      });
      await test('leave notice: no offsite request, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
    // the outfit sheet says the engine's refusal for an agent who has lost faith (MER-61b)
    {
      const { page, consoleErrors } = await open(FRAMES[0]);
      let s = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
      for (const p of s.desk) if (p.state === 'open') s = eng.choose(s, nodeContent, p.id, FIRSTC[p.ref]);
      s.agents.yusuf.trust = -2;
      const reason = eng.checkPlan(s, nodeContent, { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 10 }, purse: 0, contract: 'own' }).reasons;
      await test('the engine refuses a trip for an agent at trust -2, in words (setup for the page case)', async () => { eq(reason, ['Yusuf has lost faith in the house and will not go out again.']); });
      await loadSave(page, s, '#map');
      await page.waitForSelector('#screen-map[data-ready]');
      await page.click('#btn-outfit');
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await test('the outfit sheet shows the refusal in the reasons, beside a Send that is disabled, and the agents\' trust words are the engine\'s', async () => {
        await page.click('#change-who');
        await page.waitForSelector('#agent-yusuf');
        const trust = eng.view(s, nodeContent).trust;
        eq(await page.$eval('#agent-ali .trust', e => e.textContent), `Ali ${trust.ali.words}.`);
        eq(await page.$eval('#agent-yusuf .trust', e => e.textContent), `Yusuf ${trust.yusuf.words}.`);
        await page.click('#agent-yusuf');
        await page.waitForFunction(() => document.getElementById('agent-yusuf')?.getAttribute('aria-checked') === 'true');
        eq(await page.$$eval('#outfit-reasons p', ps => ps.map(p => p.textContent)), reason);
        eq(await page.$eval('#outfit-send', b => b.getAttribute('aria-disabled')), 'true');
      });
      await test('outfit refusal: no offsite request, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
    // the way back (MER-61d): in a city with no qirad, an agent who will not go for a wage again goes if the house pays first
    {
      const { page, consoleErrors } = await open(FRAMES[0]);
      // Cairo has a qirad, so this case serves the page and the engine the same Cairo with the qirad taken out
      const noQ = structuredClone(nodeContent); noQ.city.contracts = {};
      await page.evaluateOnNewDocument(() => {
        const real = window.fetch.bind(window);
        window.fetch = async (u, ...rest) => {
          const res = await real(u, ...rest);
          if (!String(u).endsWith('data/cairo/city.json')) return res;
          const city = await res.json();
          city.contracts = {};
          return new Response(JSON.stringify(city), { status: 200, headers: { 'content-type': 'application/json' } });
        };
      });
      let s = eng.newGame(noQ, { seed: SEED, length: 'acts', house: 'spice' });
      for (const p of s.desk) if (p.state === 'open') s = eng.choose(s, noQ, p.id, FIRSTC[p.ref]);
      s.log.push({ at: 0, kind: 'outfit', ref: 'x0', choice: 'cairo-damascus' });      // not the first expedition, so the contract is on the sheet
      s.agents.yusuf.memory.push({ at: 0, kind: 'unfair' }, { at: 1, kind: 'unfair' });
      s.money = 5000;
      const plan = { agent: 'yusuf', route: 'cairo-damascus', cargo: { linen: 10 }, purse: 0, contract: 'own' };
      const wage = eng.prepayCost(s, noQ, 'cairo-damascus', 'yusuf');
      await loadSave(page, s, '#map');
      await page.waitForSelector('#screen-map[data-ready]');
      await page.click('#btn-outfit');
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await test('prepay: the sheet offers the wage first in words for an agent who refuses a wage, and sending it charges the engine\'s sum', async () => {
        ok(wage > 0, 'the engine names a wage');
        await page.click('#agent-yusuf');
        await page.waitForFunction(() => document.getElementById('agent-yusuf')?.getAttribute('aria-checked') === 'true');
        ok((await page.$$eval('#outfit-reasons p', ps => ps.map(p => p.textContent))).includes(eng.checkPlan(s, noQ, plan).reasons[0]), 'the engine\'s refusal is among the reasons while the own contract stands');
        eq(await page.$eval('#outfit-send', b => b.getAttribute('aria-disabled')), 'true');
        await page.$eval('#contract-prepay', b => b.scrollIntoView({ block: 'center' }));
        const words = await page.$eval('#contract-prepay', e => e.textContent);
        ok(words.includes('Pay the wage first') && words.includes('did not pay what it promised before'), words);
        ok(words.includes(String(wage)), `the words name the wage, ${wage}: ${words}`);
        eq(await page.$$eval('#contract-qirad', e => e.length), 0, 'no qirad is offered');
        await page.click('#contract-prepay');
        await page.waitForFunction(() => document.getElementById('contract-prepay')?.getAttribute('aria-checked') === 'true');
        await page.focus('#step-cargo-linen');
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        const linen = Number(await page.$eval('#step-cargo-linen', e => e.getAttribute('aria-valuenow')));
        ok(linen > 0, 'some linen is carried');
        eq(await page.$eval('#outfit-send', b => b.getAttribute('aria-disabled')), 'false', 'with the wage paid first, Send is open');
        await page.click('#outfit-send');
        await page.waitForFunction(() => !document.getElementById('panel-outfit'));
        const model = eng.outfit(s, noQ, { ...plan, cargo: { linen }, prepay: true });
        const got = await engineState(page);
        eq([got.money, got.expeditions[0].contract], [model.money, { kind: 'own', prepaid: true }]);
      });
      await test('prepay: no offsite request, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
      await page.close();
    }
    // a click on Next cannot land on a sheet that is edge-on: the back says `data-flip` until it lies flat
    {
      const { page } = await open(FRAMES[0]);
      await loadSave(page, question);
      await test('the back of an answered paper carries data-flip while it turns and loses it when it lies flat', async () => {
        await page.evaluate(() => document.documentElement.style.setProperty('--flip-time', '1600ms'));
        await page.click('#choice-' + letterOf(question).id + '-go-on');
        await page.waitForSelector('.sheet[data-face="back"][data-flip="in"]', { timeout: 5000 });
        await page.waitForSelector(BACK, { timeout: 5000 });
        eq(await page.$eval('.sheet[data-face="back"]', e => e.getAnimations().filter(a => a.constructor.name === 'Animation').length), 0, 'the turn itself is over once the attribute is gone');
      });
      await page.close();
    }

    // the one-press outfit sheet's Change links sit on their own row's line at 360 and 390 wide (LOG 10:22)
    for (const frame of [FRAMES[3], FRAMES[4]]) {
      const { page } = await open(frame);
      let s = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
      for (const p of s.desk) if (p.state === 'open') s = eng.choose(s, nodeContent, p.id, FIRSTC[p.ref]);
      await loadSave(page, s, '#map');
      await page.waitForSelector('#screen-map[data-ready]');
      await page.click('#btn-outfit');
      await page.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await test(`${frame.name} ${frame.width} wide: each Change link is beside its row's words, on the same line, with none under them`, async () => {
        const rows = await page.$$eval('#panel-outfit .summary', ps => ps.map(p => {
          const t = p.firstElementChild.getBoundingClientRect(), c = p.querySelector('.change').getBoundingClientRect();
          return { id: p.firstElementChild.id, textRight: t.right, linkLeft: c.left, textTop: t.top, textBottom: t.bottom, linkTop: c.top, linkBottom: c.bottom, line: parseFloat(getComputedStyle(p.firstElementChild).lineHeight) };
        }));
        eq(rows.map(r => r.id), ['summary-who', 'summary-where', 'summary-carry']);
        for (const r of rows) {
          ok(r.linkLeft >= r.textRight - 1, `${r.id}: the link starts at ${r.linkLeft}, the words end at ${r.textRight}`);
          ok(r.linkTop < r.textBottom && r.linkBottom > r.textTop, `${r.id}: the link (${r.linkTop} to ${r.linkBottom}) is not on the words' lines (${r.textTop} to ${r.textBottom})`);
        }
      });
      await page.close();
    }
  }


  // ---- MER-73: the page between acts says what your people did. Seed 1324 played in Node to the last season
  // of act one with one more trip sent in it, so the jump has an expedition to settle and an agent who retires.
  // Each line on the page is checked against the jump's own log entry, and the order is trips, the money line,
  // who left, then the history.
  {
    let g = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    for (let guard = 0; guard < 20 && g.phase !== 'interlude'; guard++) {
      for (const p of g.desk) {
        if (p.state !== 'open') continue;
        const c = eng.paperChoices(g, nodeContent, p.id).find(x => { try { eng.choose(g, nodeContent, p.id, x.id); return true; } catch { return false; } });
        g = eng.choose(g, nodeContent, p.id, c.id);
        if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(g, nodeContent, 'damascus'); if (plan) g = eng.outfit(g, nodeContent, plan); }
      }
      if (g.t === 7) g = eng.outfit(g, nodeContent, eng.suggestPlan(g, nodeContent, 'damascus'));
      g = eng.endSeason(g, nodeContent);
    }
    const entry = g.log.find(e => e.kind === 'jump');
    const { page, consoleErrors } = await open(FRAMES[0]);
    await test('the page between acts lists each settled trip, the money from trips, who left and why, before the history', async () => {
      ok(entry.settled.length > 0 && entry.agents.length > 0, 'the seeded jump settles a trip and loses an agent, or this case checks nothing');
      await page.goto(GAME, { waitUntil: 'load' });
      await page.evaluate((st, v) => { localStorage.clear(); localStorage.setItem('merchant-save', JSON.stringify({ ...st, __v: v })); }, JSON.parse(JSON.stringify(g)), SAVE_VERSION);
      await page.goto(GAME + '#desk', { waitUntil: 'load' });
      await page.waitForSelector('#btn-open-house');
      const lines = await page.$$eval('.kind-phase .sheet-body', ps => ps.map(p => ({ text: p.textContent.replace(/\s+/g, ' ').trim(), settled: p.dataset.settled ?? null, left: p.dataset.left ?? null, id: p.id })));
      const settledOnPage = lines.filter(l => l.settled !== null).map(l => l.text);
      eq(settledOnPage, entry.settled.map(x => x.text), 'each settled trip, in the jump\'s words');
      const net = entry.settled.reduce((n, x) => n + x.houseNet, 0);
      eq(lines.find(l => l.id === 'interlude-trips').text, `Your people's trips brought ${net.toLocaleString('en-US')} ${net === 1 ? 'dinar' : 'dinars'}.`, 'the money line from the trips');
      const leftOnPage = lines.filter(l => l.left);
      eq(leftOnPage.map(l => l.left), entry.agents.map(a => (a.left === 'retired' ? 'retired' : 'house')), 'each agent who left, with the reason');
      eq(leftOnPage.map(l => l.text), entry.agents.map(a => `${nodeContent.agents.find(x => x.id === a.id).name} ${a.left === 'retired' ? 'has retired' : 'has gone to work for another house'}.`), 'the reason in words');
      const hist = lines.findIndex(l => !l.settled && !l.left && !l.id);
      ok(hist > lines.findIndex(l => l.left) && hist > lines.findIndex(l => l.id === 'interlude-trips') && lines.findIndex(l => l.id === 'interlude-trips') > lines.findIndex(l => l.settled !== null), `order: trips, money, who left, then history (${JSON.stringify(lines.map(l => l.id || l.settled || l.left || 'h'))})`);
    });
    await test('the page between acts: nothing offsite, no console error', async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
    await page.close();
  }

} finally {
  await browser.close();
  server.close();
}
await done();
