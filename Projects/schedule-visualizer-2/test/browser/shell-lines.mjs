// What the shell owed the units after it, in a real browser:
// node test/browser/shell-lines.mjs
//
// The engine client is attached at start, so a screen opened the way every
// suite opens one really gets its answers from the worker. The test pages are
// opened plain and their requests counted. The device's choices are written
// through storage/device.js, so nobody's are lost. A banner is styled by
// ui/app.css. The Building section's stylesheet is linked by index.html and
// what it asked of the shell's layout is in ui/app.css. The plan's keys are
// in Help whichever section is open. A section is told when it leaves the
// page. A drawing gesture runs its action once.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openPlanner, go, sameOrigin, TOOL_DIR } from './harness.mjs';

let session;
let page;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const source = (file) => readFileSync(path.join(TOOL_DIR, ...file.split('/')), 'utf8');

before(async () => {
  // straight to Project: the Building section has not been on screen
  session = await openPlanner({ hash: '#project', theme: 'light' });
  page = session.page;
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- item 18

test('a screen opened through openPlanner is answered by the worker, with nothing attached by the test', async () => {
  const result = await page.evaluate(async () => {
    const answer = await globalThis.sv2.store.derived.results();
    return { where: answer.where, loud: answer.findings.findings.filter((finding) => finding.severity !== 'note').map((finding) => finding.id).sort(), routes: answer.routes.transitions };
  });
  assert.equal(result.where, 'worker', 'the answer came from the main thread: the worker never loaded');
  assert.deepEqual(result.loud, ['group-walk:dsample00a:5:gsample08a', 'room-double:dsample00a:1:rsample203']);
  assert.ok(result.routes > 50, 'the school was really routed: ' + result.routes + ' walks');
});

test('openPlanner counts every request itself, and all of them stayed inside the page\'s origin', () => {
  assert.ok(session.requests.length > 40, 'the requests were recorded: ' + session.requests.length);
  assert.ok(session.requests.some((url) => url.endsWith('/engine/worker.js')), 'the worker\'s own file among them');
  assert.ok(session.requests.some((url) => url.endsWith('/engine/routing.js')), 'and what the worker imports');
  assert.deepEqual(session.offsite, []);
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});

test('what counts as inside the origin: the server\'s own addresses and what the page makes itself', () => {
  const base = 'http://127.0.0.1:8123';
  for (const url of [base, base + '/Projects/x/index.html', 'blob:' + base + '/1234', 'data:font/woff2;base64,AAAA', 'about:blank']) assert.equal(sameOrigin(url, base), true, url);
  for (const url of ['http://127.0.0.1:81234/x', 'http://127.0.0.1:8124/x', 'https://127.0.0.1:8123/x', 'http://example.invalid/', 'https://fonts.googleapis.com/css?family=x', 'ws://127.0.0.1:8123/x']) assert.equal(sameOrigin(url, base), false, url);
});

test('a page that asks for an address outside its origin fails the session when it is closed', async () => {
  // keep: true, because emptying the saved project would take it from under the first page
  const other = await openPlanner({ hash: '#project', browser: session.browser, server: session.server, keep: true });
  // an address nothing answers: the request is made, counted, and fails at once
  await other.page.evaluate(() => fetch('http://127.0.0.1:9/offsite.json').catch(() => null));
  assert.deepEqual(other.offsite, ['http://127.0.0.1:9/offsite.json']);
  assert.ok(other.problems().errors.some((line) => line === 'offsite: http://127.0.0.1:9/offsite.json'), other.problems().errors.join(' | '));
  await assert.rejects(() => other.close(), /asked for 1 address outside http:\/\/127\.0\.0\.1:\d+: http:\/\/127\.0\.0\.1:9\/offsite\.json/);
});

test('with intercept: true the page is opened through the site\'s harness, as before', async () => {
  const other = await openPlanner({ hash: '#project', browser: session.browser, server: session.server, keep: true, intercept: true });
  await other.page.evaluate(() => fetch('http://example.invalid/offsite.json').catch(() => null));
  assert.deepEqual(other.problems().blocked, ['http://example.invalid/offsite.json'], 'the harness refused it');
  other.offsite.length = 0; // refused before it left; this session is closed clean
  await other.close();
});

// ---------------------------------------------------------------- item 15

test('the device\'s choices are written through storage/device.js: a choice remembered since the page loaded is kept', async () => {
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('sv2:device'));
    localStorage.setItem('sv2:device', JSON.stringify({ ...stored, playback: { speed: 2 }, paper: 'a4' }));
  });
  await go(page, '#schedule');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')));
  assert.equal(stored.lastSection, 'schedule', 'the section was remembered');
  assert.deepEqual([stored.playback, stored.paper], [{ speed: 2 }, 'a4'], 'and what another part of the page had stored was not written over');
  assert.doesNotMatch(source('ui/app.js'), /localStorage/, 'ui/app.js has no copy of its own');
  await go(page, '#project');
});

test('a banner is styled by ui/app.css, with an edge in the colour of its kind', async () => {
  const shown = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'banners';
    host.innerHTML = '<div class="banner banner--problem"><p class="banner__text">x</p></div><div class="banner banner--warning"></div><div class="banner banner--note"></div>';
    document.getElementById('surface').prepend(host);
    const token = (name) => {
      const probe = document.createElement('i');
      probe.style.color = 'var(' + name + ')';
      host.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    const edges = Array.from(host.querySelectorAll('.banner'), (el) => getComputedStyle(el).borderLeftColor);
    const first = getComputedStyle(host.firstChild);
    const out = { edges, tokens: [token('--problem'), token('--warning'), token('--note')], display: first.display, width: first.borderLeftWidth, sticky: getComputedStyle(host).position, margin: getComputedStyle(host.querySelector('.banner__text')).marginTop };
    host.remove();
    return out;
  });
  assert.deepEqual(shown.edges, shown.tokens);
  assert.equal(new Set(shown.edges).size, 3, 'three kinds, three edges');
  assert.deepEqual([shown.display, shown.width, shown.sticky, shown.margin], ['flex', '4px', 'sticky', '0px']);
});

test('the storage banners use that rule and carry no style of their own', async () => {
  await page.evaluate(() => {
    globalThis.sv2.storage.setTiming({ retry: 400 });
    globalThis.sv2.storage.hooks.failWrite = 'The disk is full (a test made this up)';
  });
  await page.click('#school-name');
  await page.keyboard.type('Banner Test School');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#banner-save-failed');
  const banner = await page.$eval('#banner-save-failed', (el) => ({ classes: el.className, style: el.getAttribute('style'), text: el.querySelector('p').className, textStyle: el.querySelector('p').getAttribute('style'), host: el.parentNode.className, hostStyle: el.parentNode.getAttribute('style'), edge: getComputedStyle(el).borderLeftColor }));
  assert.deepEqual(banner, { classes: 'banner banner--problem', style: null, text: 'banner__text', textStyle: null, host: 'banners', hostStyle: null, edge: 'rgb(179, 38, 30)' });
  await page.evaluate(() => {
    globalThis.sv2.storage.hooks.failWrite = null;
  });
  await page.waitForFunction(() => document.getElementById('banner-save-failed') === null, { timeout: 5000 });
});

test('the Project section\'s header comment names the five cards it has', () => {
  const comment = source('ui/project/index.js').split('\nimport ')[0];
  for (const card of ['Saved on this device', 'Recovery points', 'Settings', 'Sample school', 'About']) assert.match(comment, new RegExp(card), card);
  assert.doesNotMatch(comment, /three of them/);
});

// ---------------------------------------------------------------- item 16

test('index.html links the Building section\'s stylesheet: it is there before the section has ever been on screen', async () => {
  const links = await page.$$eval('link[rel="stylesheet"]', (all) => all.map((link) => ({ href: link.getAttribute('href'), inHead: link.parentNode === document.head, injected: link.dataset.sv2 || null, loaded: Boolean(link.sheet) })));
  assert.deepEqual(links, [
    { href: 'ui/tokens.css', inHead: true, injected: null, loaded: true },
    { href: 'ui/app.css', inHead: true, injected: null, loaded: true },
    { href: 'ui/building/building.css', inHead: true, injected: null, loaded: true },
  ]);
  assert.match(source('index.html'), /<link rel="stylesheet" href="ui\/building\/building\.css">/);
  assert.doesNotMatch(source('ui/building/index.js'), /document\.head\.append/, 'the section no longer puts a link in the page');
});

test('what the Building section asks of the shell\'s layout and of the toasts is in ui/app.css, and still applies', async () => {
  const own = source('ui/building/building.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(own, /\.surface__layout/, 'building.css reaches into the shell\'s layout');
  assert.doesNotMatch(own, /\.toasts/, 'building.css moves the shell\'s toasts');
  const shell = source('ui/app.css');
  assert.match(shell, /\.surface__layout\[data-section="building"\] \{\n  height: 100%;\n  padding: 0;/);
  assert.match(shell, /\.surface__layout\[data-section="building"\] ~ \.toasts \{\n  left: calc\(56px \+ 64px \+ var\(--s-3\)\);/);
  await go(page, '#building');
  await page.waitForFunction(() => document.querySelector('.bld')?.dataset.styled === 'true');
  const drawn = await page.evaluate(() => {
    const layout = getComputedStyle(document.querySelector('.surface__layout'));
    const toasts = getComputedStyle(document.getElementById('toasts'));
    return { padding: layout.padding, grid: layout.backgroundImage, gap: layout.rowGap, left: toasts.left };
  });
  assert.deepEqual(drawn, { padding: '0px', grid: 'none', gap: '0px', left: '132px' });
  await go(page, '#schedule');
  const elsewhere = await page.evaluate(() => getComputedStyle(document.getElementById('toasts')).left);
  assert.equal(elsewhere, '72px', 'and on another section the toasts are where the shell puts them');
});

test('Help lists the plan\'s keys whichever section is open, registered through ctx.shortcuts', async () => {
  await go(page, '#project');
  const listed = await page.evaluate(() => globalThis.sv2.shortcuts.list());
  assert.equal(await page.evaluate(() => globalThis.sv2.ctx.shortcuts === globalThis.sv2.shortcuts), true);
  const plan = listed.filter((entry) => entry.group === 'Building');
  for (const id of ['tool-select', 'tool-corridor', 'tool-room', 'plan-arrows', 'plan-enter', 'plan-drag', 'plan-pan', 'plan-escape', 'plan-floors', 'plan-zoom-in', 'plan-zoom-out', 'plan-fit', 'plan-delete', 'plan-copy', 'plan-paste']) assert.ok(plan.some((entry) => entry.id === id), 'Help does not list ' + id);
  assert.equal(new Set(listed.map((entry) => entry.id)).size, listed.length, 'each key is listed once');
  await page.click('#help');
  await page.waitForSelector('#help-dialog[open]');
  const rows = await page.$$eval('#help-dialog tbody tr', (all) => all.map((row) => [row.dataset.key, row.cells[0].textContent, row.cells[2].textContent]));
  assert.deepEqual(rows.map((row) => row[0]), listed.map((entry) => entry.id));
  assert.ok(rows.some((row) => row[0] === 'plan-pan' && row[1] === 'Space+Arrows' && row[2] === 'Building'));
  await page.keyboard.press('Escape');
  // visiting the section twice does not list them twice
  await go(page, '#building');
  await go(page, '#project');
  await go(page, '#building');
  assert.equal(await page.evaluate(() => globalThis.sv2.shortcuts.list().length), listed.length);
});

test('a section is told when it leaves the page: the Building section takes its listeners off the document at once', async () => {
  await go(page, '#building');
  await page.waitForFunction(() => document.querySelector('.bld')?.dataset.styled === 'true');
  await page.keyboard.press('c');
  assert.equal(await page.evaluate(() => document.querySelector('.bld').editor.tool.id), 'corridor', 'the plan answers its keys while it is on the page');
  // count what is taken off the document while the section leaves, with no
  // key pressed: it used to wait for the next key to find itself gone
  await page.evaluate(() => {
    const removed = [];
    const remove = document.removeEventListener;
    document.removeEventListener = function removeEventListener(type, ...rest) {
      removed.push(type);
      return remove.call(this, type, ...rest);
    };
    globalThis.sv2test = { removed, restore: () => { document.removeEventListener = remove; } };
  });
  await go(page, '#schedule');
  const removed = await page.evaluate(() => {
    globalThis.sv2test.restore();
    return globalThis.sv2test.removed.slice().sort();
  });
  assert.deepEqual(removed.filter((type) => type === 'keydown' || type === 'keyup'), ['keydown', 'keyup'], 'the section was not told it had left: its key listeners are still on the document');
  await go(page, '#building');
});

test('a drawing gesture runs its action once: one id is taken for one room', async () => {
  await go(page, '#building');
  await page.waitForFunction(() => document.querySelector('.bld')?.dataset.styled === 'true');
  const made = await page.evaluate(async () => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const { store, ctx } = globalThis.sv2;
    const editor = document.querySelector('.bld').editor;
    const floor = store.project.building.floors[2];
    let asked = 0;
    const ids = ctx.ids;
    const counting = (prefix) => {
      asked += 1;
      return ids(prefix);
    };
    counting.reserve = ids.reserve;
    let runs = 0;
    const once = actions.action({ label: actions.placeRoom.label, bumps: actions.placeRoom.bumps, focus: actions.placeRoom.focus }, (project, payload, context) => {
      runs += 1;
      return actions.placeRoom(project, payload, { ...context, ids: counting });
    });
    const before = store.history.past.length;
    const outcome = editor.commit(once, { floorId: floor.id, rect: { x: 1, y: 9, w: 3, h: 3 } });
    const placed = store.project.building.floors[2].spaces.find((space) => space.id === outcome.spaceId);
    return { runs, asked, entries: store.history.past.length - before, placed: Boolean(placed), cells: outcome.cells.length, label: store.undoLabel };
  });
  assert.deepEqual(made, { runs: 1, asked: 1, entries: 1, placed: true, cells: 9, label: 'Place a room on Floor 3' });
});
