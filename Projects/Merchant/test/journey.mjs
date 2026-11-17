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
  // ---- MER-43: the game. The engine runs the same seed in Node; the DOM must say what it says.
  const titleOf = (s, p) => {
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

    await test('top bar: Map, Ledger and Notebook are disabled with their reasons, and pressing one says why', async () => {
      for (const [key, word] of [['map', 'map table'], ['ledger', 'ledger'], ['notebook', 'notebook']]) {
        eq(await page.$eval(`#btn-${key}`, b => [b.disabled, b.getAttribute('aria-disabled'), b.getAttribute('aria-describedby')]), [false, 'true', `reason-${key}`]);
        await page.click(`#btn-${key}`);
        const note = await page.$eval('#bar-note', e => e.textContent);
        ok(note.toLowerCase().includes(word), `${key}: ${note}`);
        ok(await page.$eval('#bar-note', e => e.getBoundingClientRect().height > 0), `${key}: the reason is not visible`);
        eq(await hashOf(page), '#desk');
      }
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
      // put the first paper back on top
      await page.click('.edge');
      eq((await screenOf(page)).raised, 'Welcome to the house');
    });

    await test('answering by pointer: front goes inert, the back says what happened, the note and the source, focus on its heading', async () => {
      await page.click('#choice-p0-0-begin');
      await page.waitForSelector('.sheet[data-face="back"]');
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
    });

    // The engine model for the rest of the pointer flow: letter 1, expedition 1 (opens the stub), neighbour 2.
    model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    await test('Next raises the next paper and the page matches the engine; the first expedition opens the stub; then End is live', async () => {
      const m0 = eng.choose(model, nodeContent, 'p0-0', 'begin');
      await page.click('#btn-next');
      await sameScreen(page, m0, 'after the letter');
      eq(await engineState(page), JSON.parse(JSON.stringify(m0)));
      eq(await page.evaluate(() => document.activeElement.classList.contains('sheet-title')), true, 'focus is on the raised paper\'s title');

      // the expedition card: first choice, outfit-first
      await page.click('#choice-p0-1-go');
      await page.waitForSelector('.sheet[data-face="back"]');
      const m1 = eng.choose(m0, nodeContent, 'p0-1', 'go');
      eq(await page.$eval('.sheet-title', e => e.textContent), 'You paid 20 dinars.');
      await page.click('#btn-next');
      // a stub paper stands in for the map table until MER-44
      await page.waitForSelector('.sheet[data-kind="outfit"]');
      eq(await page.evaluate(() => document.querySelector('.stack-count').textContent), '2 papers left');
      eq(await page.$eval('#btn-end', b => b.getAttribute('aria-disabled')), 'true');
      eq(await page.$eval('#end-reason', e => e.textContent), '2 papers still need an answer.');
      await page.click('#btn-stub-dismiss');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.kind === 'card');
      await sameScreen(page, m1, 'after the expedition card');
      eq(await page.$eval('#bar-money', e => e.textContent.trim()), '1,480 dinars');

      // the neighbour, second choice ("Keep them")
      await page.click('#choice-p0-2-keep');
      await page.waitForSelector('.sheet[data-face="back"]');
      const m2 = eng.choose(m1, nodeContent, 'p0-2', 'keep');
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
      await sameScreen(page, eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' }), 'after held keys');
      eq((await screenOf(page)).face, 'front');
    });

    let model = eng.newGame(nodeContent, { seed: SEED, length: 'acts', house: 'spice' });
    await test('keyboard: 1 answers, Enter presses Next, 1 on the expedition, Tab and Enter past the stub, 1 on the neighbour, E ends the season', async () => {
      await page.keyboard.press('1');
      await page.waitForSelector('.sheet[data-face="back"]');
      model = eng.choose(model, nodeContent, 'p0-0', 'begin');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.face === 'front' && document.querySelector('.sheet-title').textContent === 'Yusuf is ready to go');
      await sameScreen(page, model, 'keyboard after letter');
      await page.keyboard.press('1');
      await page.waitForSelector('.sheet[data-face="back"]');
      model = eng.choose(model, nodeContent, 'p0-1', 'go');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sheet[data-kind="outfit"]');
      await page.keyboard.press('Tab');
      eq(await focusId(page), 'btn-stub-dismiss');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.sheet')?.dataset.kind === 'card');
      await page.keyboard.press('1');
      await page.waitForSelector('.sheet[data-face="back"]');
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

    await test('keyboard: M, L and N tell why they cannot open yet; E does nothing while papers wait', async () => {
      for (const [k, word] of [['m', 'map table'], ['l', 'ledger'], ['n', 'notebook']]) {
        await page.keyboard.press(k);
        ok((await page.$eval('#bar-note', e => e.textContent)).toLowerCase().includes(word), k);
      }
      const before = await engineState(page);
      await page.keyboard.press('e');
      eq(await engineState(page), before);
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
      // the button still works
      await page.click('.sheet .choice');
      await page.waitForSelector('.sheet[data-face="back"]');
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
        await page.waitForSelector('.sheet[data-face="back"]');
        await page.$eval('#btn-next', b => b.scrollIntoView({ block: 'center' }));
        await page.click('#btn-next');
        if (id === 'go') { await page.waitForSelector('#btn-stub-dismiss'); await page.click('#btn-stub-dismiss'); }
      }
      await page.waitForFunction(() => document.getElementById('btn-end').getAttribute('aria-disabled') === 'false');
      const r = await page.$eval('#btn-end', b => { const x = b.getBoundingClientRect(); return [x.bottom <= innerHeight + 1, x.top >= 0]; });
      eq(r, [true, true], 'End the season is outside the frame');
    });
    await page.screenshot({ path: path.join(SHOTS, `desk-${frame.name}.png`) });
    await test(`${frame.name}: desk, no offsite request, no console error`, async () => { eq(page.__blocked, []); eq(consoleErrors, []); });
    await page.close();
  }

} finally {
  await browser.close();
  server.close();
}
await done();
