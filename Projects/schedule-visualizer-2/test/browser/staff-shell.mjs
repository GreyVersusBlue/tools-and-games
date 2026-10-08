// The staff browser, driven in Chromium: node test/browser/staff-shell.mjs
//
// A published file is assembled here, in Node, exactly as the planner
// assembles it, written to a scratch folder and opened from disk. Pages are
// opened with launch() and browser.newPage() and nothing between the page and
// the network: the site harness's request interception is not used, so what
// page.on('request') counts is what the page asked for.
//
// From disk: the unlock screen, a wrong passcode, bulldogs2015, the key kept
// so the passcode is asked once, a key from a changed passcode thrown away,
// addresses and Back and Forward, the search by keyboard, the notice on an old
// copy, the storage fallback, the <noscript> block, and zero requests.
// Served: the page with no schedule, the preview handshake through a frame at
// a blob address, the newer-file notice, the newer-format refusal, and the
// assembler and the lock running in the page with the same result as in Node.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch, startServer, TOOL_DIR, TOOL_PATH } from './harness.mjs';
import { diskReader, partsOf } from '../publish/reader.mjs';
import { assemble } from '../../ui/staff/assemble.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { publishedModel } from '../../engine/publish-data.js';
import { lockPublished } from '../../engine/publish-crypto.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';

// No file here depends on today's date: one copy is published far in the
// future, so it is never out of date, and one in the past, so it always is.
const future = () => new Date('2999-01-01T12:00:00Z');
const past = () => new Date('2020-01-15T12:00:00Z');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-'));
const read = diskReader();
const files = {};
let server;
let browser;

async function write(name, change, clock) {
  const project = sampleSchool();
  if (change) change(project);
  const published = await publishDocument(read, project, { clock: clock || future, random: seededRandom('staff-shell ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href, html: published.html };
  return files[name];
}

before(async () => {
  await write('locked');
  await write('open', (project) => { project.publish.passcode = ''; });
  await write('old', (project) => { project.publish.passcode = ''; }, past);
  await write('hostile', (project) => {
    project.publish.passcode = '';
    project.settings.schoolName = HOSTILE;
    project.teachers[0].name = HOSTILE + ' T';
  });
  await write('partial', (project) => {
    project.publish.passcode = '';
    project.publish.views.map = false;
    project.publish.views.coverage = false;
  });
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a browser profile of its own (no kept key, no settings), with
// everything it asks for and everything that goes wrong written down.
async function openPage(options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: opts.width === undefined, isMobile: opts.width === undefined });
  if (opts.js === false) await page.setJavaScriptEnabled(false);
  if (opts.theme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme }]);
  if (opts.init) await page.evaluateOnNewDocument(opts.init);
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, requests, errors, close: () => context.close() };
}

// What a page asked for beyond its own file. A `data:` address is in the count
// Chromium keeps (each font inside the file is "loaded" from its own text), and
// is not a request to anywhere, so it is left out by name and nothing else is.
const asked = (session, own) => session.requests.filter((url) => url !== own && !url.startsWith(own + '#') && !url.startsWith('data:'));

const state = (page) => page.evaluate(() => document.getElementById('app').dataset.state);
const heading = (page) => page.evaluate(() => document.querySelector('h1').textContent);
const school = (page) => page.evaluate(() => document.querySelector('.top__school').textContent);
const text = (page, selector) => page.evaluate((s) => Array.from(document.querySelectorAll(s), (el) => el.textContent), selector);

async function ready(page, wanted) {
  await page.waitForFunction((want) => document.getElementById('app').dataset.state === want, { timeout: 20000 }, wanted);
}

async function goto(page, url, wanted) {
  await page.goto(url, { waitUntil: 'load' });
  await ready(page, wanted);
  await page.evaluate(() => document.fonts.ready);
}

async function unlock(page, passcode) {
  await page.type('#passcode', passcode);
  await page.keyboard.press('Enter');
}

async function axe(page, name) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

// ---------------------------------------------------------------- from disk, locked

test('a locked file opened from disk shows the unlock screen and nothing of the school', async () => {
  const session = await openPage();
  try {
    await goto(session.page, files.locked.url, 'locked');
    const body = await session.page.evaluate(() => document.body.innerText);
    assert.match(body, /This schedule is for staff\. Enter the staff passcode\./);
    assert.match(body, /Published 1 January 2999|Published January 1, 2999/);
    assert.ok(!body.includes('Marrowby'), 'the school is named before the passcode is typed');
    const inside = partsOf(files.locked.html).data;
    for (const word of ['Marrowby', 'Halloran', 'rsample101', 'Gym', 'bulldogs']) assert.ok(!inside.includes(word), word + ' can be read in the file without the passcode');
    assert.ok(!files.locked.html.includes('Marrowby'), 'the school is named somewhere else in the file');
    assert.equal(await session.page.title(), 'Staff schedule');
    const field = await session.page.evaluate(() => {
      const input = document.getElementById('passcode');
      return {
        type: input.type,
        autocapitalize: input.getAttribute('autocapitalize'),
        autocorrect: input.getAttribute('autocorrect'),
        size: parseFloat(getComputedStyle(input).fontSize),
        focused: document.activeElement === input,
        label: input.labels[0].textContent,
        button: document.querySelector('.gate button').textContent,
        bar: document.querySelector('.bar') === null,
      };
    });
    assert.deepEqual(field, { type: 'password', autocapitalize: 'off', autocorrect: 'off', size: 17, focused: true, label: 'Staff passcode', button: 'Unlock', bar: true });
    await axe(session.page, 'the unlock screen');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a wrong passcode is refused in a sentence; bulldogs2015 opens the file; nothing is requested', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.locked.url, 'locked');
    // every text the button shows, from now on
    await page.evaluate(() => {
      globalThis.sv2Button = [];
      const button = document.querySelector('.gate button');
      new MutationObserver(() => globalThis.sv2Button.push(button.textContent)).observe(button, { childList: true, characterData: true, subtree: true });
    });
    await unlock(page, 'bulldogs2016');
    await page.waitForFunction(() => document.getElementById('passcode-says').textContent !== '', { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.getElementById('passcode-says').textContent), 'That passcode did not open this schedule. Check it and try again.');
    assert.equal(await page.evaluate(() => document.getElementById('passcode-says').getAttribute('role')), 'alert');
    assert.equal(await state(page), 'locked');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'passcode', 'focus is back in the field');
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:key')), null, 'a wrong passcode keeps nothing');

    await page.evaluate(() => { document.getElementById('passcode').value = ''; });
    await unlock(page, 'bulldogs2015');
    await ready(page, 'open');
    assert.deepEqual(await page.evaluate(() => globalThis.sv2Button), ['Unlocking…', 'Unlock', 'Unlocking…'], 'the button says Unlocking… while the key is made');
    assert.equal(await school(page), SCHOOL);
    assert.equal(await page.title(), 'Search · ' + SCHOOL);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('h1')), true, 'focus moves to the page\'s heading');
    const key = await page.evaluate(() => localStorage.getItem('sv2staff:psample001:key'));
    assert.match(key, /^[A-Za-z0-9+/]{43}=$/, 'the key the passcode made is kept, as 32 bytes of base64');
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:seen')), '2999-01-01T12:00:00.000Z');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((name) => localStorage.getItem(name).includes('bulldogs'))), false, 'the passcode itself is kept nowhere');

    assert.ok(session.requests.includes(files.locked.url), 'the page\'s own load was counted, so the counting works');
    assert.deepEqual(asked(session, files.locked.url), [], 'a published file asks for nothing');
    assert.ok(session.requests.every((url) => url === files.locked.url || url.startsWith('data:font/woff2;base64,')), 'the only other things loaded are the fonts inside the file');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the passcode is asked once per device: the same file opens straight away the second time', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.locked.url, 'locked');
    await unlock(page, 'bulldogs2015');
    await ready(page, 'open');
    await page.goto('about:blank');
    await goto(page, files.locked.url, 'open');
    assert.equal(await school(page), SCHOOL);
    assert.equal(await page.evaluate(() => document.getElementById('passcode')), null);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a kept key that does not open a newer file is thrown away and the passcode asked again', async () => {
  const session = await openPage();
  const original = files.locked.html;
  try {
    const { page } = session;
    await goto(page, files.locked.url, 'locked');
    await unlock(page, 'bulldogs2015');
    await ready(page, 'open');
    const kept = await page.evaluate(() => localStorage.getItem('sv2staff:psample001:key'));
    assert.ok(kept);

    // the school changes its passcode and sends a newer file, saved over the old one
    const project = sampleSchool();
    project.publish.passcode = 'wolverines1987';
    const changed = await publishDocument(read, project, { clock: () => new Date('2999-02-01T12:00:00Z'), random: seededRandom('changed') });
    writeFileSync(files.locked.file, changed.html);
    await page.goto('about:blank');
    await goto(page, files.locked.url, 'locked');
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:key')), null, 'the old key is deleted');
    await unlock(page, 'bulldogs2015');
    await page.waitForFunction(() => document.getElementById('passcode-says').textContent !== '', { timeout: 20000 });
    assert.equal(await state(page), 'locked', 'the old passcode no longer opens it');
    await page.evaluate(() => { document.getElementById('passcode').value = ''; });
    await unlock(page, 'wolverines1987');
    await ready(page, 'open');
    assert.notEqual(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:key')), kept, 'the new key is kept in its place');
    assert.deepEqual(session.errors, []);
  } finally {
    writeFileSync(files.locked.file, original);
    await session.close();
  }
});

test('the address asked for is kept through the unlock screen, and Back and Forward move between views', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.locked.url + '#/room/rsample101', 'locked');
    await unlock(page, 'bulldogs2015');
    await ready(page, 'open');
    assert.equal(await heading(page), 'Room 101');
    assert.equal(await page.title(), 'Room 101 · ' + SCHOOL);
    assert.equal(await page.evaluate(() => location.hash), '#/room/rsample101');

    await page.click('.bar a[data-item="map"]');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Building map: Floor 1');
    assert.equal(await page.evaluate(() => location.hash), '#/map');
    assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), 'map');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('h1')), true);

    await page.evaluate(() => { location.hash = '#/teacher/tsample005'; });
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Oyelaran');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Building map: Floor 1');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Room 101');
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Building map: Floor 1');
    assert.deepEqual(asked(session, files.locked.url), [], 'moving between views asks for nothing');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- from disk, not locked

test('every address has a page, and an address that names nothing says so', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url, 'open');
    const cases = [
      ['#/teacher/tsample001', 'Ms. Halloran', 'search'],
      ['#/group/gsample06a', '6A', 'search'],
      ['#/room/rsamplegym', 'Gym', 'search'],
      ['#/map/fsample002', 'Building map: Floor 2', 'map'],
      ['#/free', 'Free right now', 'now'],
      ['#/now', 'Where right now', 'now'],
      ['#/common?t=tsample001,tsample002', 'Common planning', 'search'],
      ['#/coverage/tsample003', 'Coverage: Dr. Quillfeather', 'search'],
      ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather', 'search'],
      ['#/directions?from=rsample101&to=rsample303', 'Directions', 'search'],
      ['#/staffing', 'Staffing', 'search'],
      ['#/me', 'My schedule', 'me'],
      ['#/teacher/tnobody000', 'Not in this schedule', 'search'],
      ['#/room/', 'Not in this schedule', 'search'],
      ['#/nonsense', 'Search', 'search'],
      ['#/search', 'Search', 'search'],
    ];
    for (const [hash, title, item] of cases) {
      await page.evaluate((next) => { location.hash = next; }, hash);
      await page.waitForFunction((want, where) => location.hash === where && document.querySelector('h1').textContent === want, { timeout: 5000 }, title, hash).catch(() => {});
      assert.equal(await heading(page), title, hash);
      assert.equal(await page.evaluate(() => document.querySelector('.bar a[aria-current="page"]').dataset.item), item, hash);
    }
    assert.deepEqual(await text(page, '.bar__label'), ['Search', 'Map', 'Now', 'Me']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the search finds teachers, groups and rooms grouped by kind, and works from the keyboard', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url, 'open');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'opening the file does not put the keyboard up');
    await page.focus('#find');
    await page.keyboard.type('math');
    assert.deepEqual(await text(page, '.results__kind h2'), ['Teachers', 'Rooms']);
    assert.deepEqual(await text(page, '.results a .list__name'), ['Mr. Brightwater', 'Ms. Halloran', 'Room 101', 'Room 102']);
    assert.equal(await page.evaluate(() => document.getElementById('find-count').textContent), 'Found 2 teachers, 2 rooms.');
    assert.equal(await page.evaluate(() => document.getElementById('find-count').getAttribute('role')), 'status');
    assert.equal(await page.evaluate(() => location.hash), '#/search?q=math', 'what was typed is in the address');

    const focused = () => page.evaluate(() => (document.activeElement.querySelector('.list__name') || document.activeElement).textContent || document.activeElement.id);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Mr. Brightwater');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Room 101', 'Down crosses from one kind to the next');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Room 102', 'Down stops at the last');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'find', 'Up from the first goes back to the box');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Halloran');
    assert.equal(await page.evaluate(() => location.hash), '#/teacher/tsample001');
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('find') !== null);
    assert.equal(await page.evaluate(() => document.getElementById('find').value), 'math', 'Back returns to what was typed');
    assert.equal((await text(page, '.results a')).length, 4);

    await page.focus('#find');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('find').value), '');
    assert.deepEqual(await text(page, '.results a'), []);
    assert.equal(await page.evaluate(() => location.hash), '#/search');
    await page.keyboard.type('6b');
    assert.deepEqual(await text(page, '.results__kind h2'), ['Groups']);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('h1').textContent === '6B');
    assert.equal(await page.evaluate(() => location.hash), '#/group/gsample06b', 'Enter in the box opens the first result');

    await page.goBack();
    await page.waitForFunction(() => document.getElementById('find') !== null);
    await page.focus('#find');
    await page.evaluate(() => { document.getElementById('find').value = ''; });
    await page.keyboard.type('zzzz');
    assert.equal(await page.evaluate(() => document.getElementById('find-count').textContent), 'Nothing in this schedule matches that. Try part of a name, a room number or a subject.');
    assert.deepEqual(await text(page, '.more a .list__name'), ['Directions', 'Common planning', 'Coverage', 'Substitute plan', 'Staffing']);
    assert.deepEqual(asked(session, files.open.url), [], 'searching asks for nothing');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('on a phone: 17 px base, fields at 16 px or more, a 56 px bar that leaves while a field has focus', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url, 'open');
    const measure = () => page.evaluate(() => {
      const bar = document.querySelector('.bar');
      const box = bar.getBoundingClientRect();
      const items = Array.from(document.querySelectorAll('.bar__item'), (item) => item.getBoundingClientRect());
      return {
        base: getComputedStyle(document.documentElement).fontSize,
        field: parseFloat(getComputedStyle(document.getElementById('find')).fontSize),
        fieldHeight: document.getElementById('find').getBoundingClientRect().height,
        bar: getComputedStyle(bar).display === 'none' ? null : { height: box.height, bottom: Math.round(innerHeight - box.bottom), width: box.width },
        items: items.map((item) => Math.round(item.width)),
        wide: document.documentElement.scrollWidth > innerWidth,
        family: getComputedStyle(document.body).fontFamily.split(',')[0],
        fonts: Array.from(document.fonts).filter((font) => font.status === 'loaded').map((font) => font.family.replace(/"/g, '') + ' ' + font.weight).sort(),
      };
    });
    const idle = await measure();
    assert.equal(idle.base, '17px');
    assert.ok(idle.field >= 16, 'the search field is ' + idle.field + ' px');
    assert.ok(idle.fieldHeight >= 44);
    assert.deepEqual(idle.bar, { height: 56, bottom: 0, width: 390 });
    assert.equal(idle.items.length, 4);
    assert.ok(idle.items.every((width) => width >= 44), 'every bar item is wide enough for a finger');
    assert.equal(idle.wide, false, 'the page does not scroll sideways');
    assert.equal(idle.family, '"Public Sans"');
    assert.ok(idle.fonts.includes('Public Sans 400') && idle.fonts.includes('Public Sans 700'), 'the fonts inside the file loaded: ' + idle.fonts.join(', '));

    await page.focus('#find');
    assert.equal((await measure()).bar, null, 'the bar is gone while the field has focus');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('app')).paddingBottom), '0px');
    await page.evaluate(() => document.activeElement.blur());
    assert.deepEqual((await measure()).bar, { height: 56, bottom: 0, width: 390 });
    await axe(page, 'the search page');
    await page.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Halloran');
    await axe(page, 'a view');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('on a desktop the bar is a rail on the left and a page sits in a 720 px column; dark follows the device', async () => {
  const session = await openPage({ width: 1280, height: 800, theme: 'dark' });
  try {
    const { page } = session;
    await goto(page, files.open.url, 'open');
    const seen = await page.evaluate(() => {
      const bar = document.querySelector('.bar').getBoundingClientRect();
      const main = document.getElementById('page').getBoundingClientRect();
      return {
        base: getComputedStyle(document.documentElement).fontSize,
        bar: { left: bar.left, top: bar.top, width: bar.width, height: bar.height },
        column: main.width,
        clear: main.left >= bar.right,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        paper: getComputedStyle(document.body).backgroundColor,
      };
    });
    assert.equal(seen.base, '16px');
    assert.deepEqual(seen.bar, { left: 0, top: 0, width: 88, height: 800 });
    assert.equal(seen.column, 720);
    assert.equal(seen.clear, true, 'the page is beside the rail, not under it');
    assert.equal(seen.scheme, 'dark');
    assert.equal(seen.paper, 'rgb(21, 24, 28)');
    await page.focus('#find');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.bar')).display), 'flex', 'the rail stays while a field has focus');
    await page.evaluate(() => document.activeElement.blur());
    await axe(page, 'the search page in the dark theme');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the unlock screen in the dark theme passes axe too', async () => {
  const session = await openPage({ theme: 'dark' });
  try {
    await goto(session.page, files.locked.url, 'locked');
    assert.equal(await session.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
    await axe(session.page, 'the unlock screen in the dark theme');
  } finally {
    await session.close();
  }
});

test('an old copy says so in a band that does not block; a current one says nothing', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.old.url, 'open');
    const bands = await text(page, '.band');
    assert.equal(bands.length, 1);
    assert.match(bands[0], /^This copy is from (15 January 2020|January 15, 2020) and may be out of date\. Ask the office for a newer one\.$/);
    assert.equal(await page.evaluate(() => document.querySelector('.band').dataset.band), 'stale');
    assert.equal(await school(page), SCHOOL, 'the schedule is still there under the band');
    await page.focus('#find');
    await page.keyboard.type('gym');
    assert.deepEqual(await text(page, '.results__kind h2'), ['Teachers', 'Rooms'], 'and still works');
    await axe(page, 'the page with the old-copy band');
    await goto(page, files.open.url, 'open');
    assert.deepEqual(await text(page, '.band--stale'), []);
    assert.match(await page.evaluate(() => document.querySelector('.foot').textContent), /published (1 January 2999|January 1, 2999)/);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a view the publisher left out is not offered, and its address says why', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.partial.url, 'open');
    assert.deepEqual(await text(page, '.bar__label'), ['Search', 'Now', 'Me']);
    assert.deepEqual(await text(page, '.more a .list__name'), ['Directions', 'Common planning', 'Substitute plan', 'Staffing']);
    await page.evaluate(() => { location.hash = '#/coverage/tsample003'; });
    await page.waitForFunction(() => /not included/.test(document.querySelector('.lede').textContent));
    assert.equal(await page.evaluate(() => document.querySelector('.lede').textContent), 'This view was not included when this schedule was published.');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('every name is shown exactly as typed and never read as markup', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.hostile.url, 'open');
    assert.equal(await page.evaluate(() => document.querySelector('.top__school').textContent), HOSTILE);
    assert.equal(await page.title(), 'Search · ' + HOSTILE);
    await page.focus('#find');
    await page.keyboard.type('東京');
    assert.deepEqual(await text(page, '.results a[data-result="teacher"] .list__name'), [HOSTILE + ' T']);
    assert.deepEqual(await text(page, '.results a[data-result="room"] .list__detail'), ['Floor 1 · ' + HOSTILE + ' T · Mathematics'], 'the teacher\'s room is found with them');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/teacher/tsample001');
    assert.equal(await heading(page), HOSTILE + ' T');
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined, 'a name ran as script');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#app img, #app b').length), 0, 'a name became elements');
    assert.equal(await page.evaluate(() => document.querySelectorAll('script').length), 2, 'the data and the code, and nothing a name added');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('where the browser keeps nothing, the file still opens and says so once', async () => {
  const session = await openPage({
    init: () => {
      Storage.prototype.setItem = function setItem() {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    },
  });
  try {
    const { page } = session;
    await goto(page, files.locked.url, 'locked');
    await unlock(page, 'bulldogs2015');
    await ready(page, 'open');
    assert.deepEqual(await text(page, '.band .band__text'), ['This browser does not keep settings for files opened this way.']);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await page.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Halloran');
    assert.equal((await text(page, '.band')).length, 1, 'said once, not on every page');
    await page.click('.band__close');
    assert.deepEqual(await text(page, '.band'), []);
    await page.evaluate(() => { location.hash = '#/search'; });
    await page.waitForFunction(() => document.getElementById('find') !== null);
    assert.deepEqual(await text(page, '.band'), [], 'and not again once dismissed');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('where the browser refuses to say whether it has storage, the file still opens', async () => {
  const session = await openPage({
    init: () => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Access is denied.', 'SecurityError'); } });
    },
  });
  try {
    await goto(session.page, files.open.url, 'open');
    assert.equal(await school(session.page), SCHOOL);
    assert.deepEqual(await text(session.page, '.band .band__text'), ['This browser does not keep settings for files opened this way.']);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a reader who chose themselves opens on their own page, and Back does not loop', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url, 'open');
    await page.evaluate(() => localStorage.setItem('sv2staff:psample001:me', 'tsample005'));
    await page.goto('about:blank');
    await goto(page, files.open.url, 'open');
    assert.equal(await heading(page), 'Ms. Oyelaran');
    assert.equal(await page.evaluate(() => location.hash), '#/teacher/tsample005');
    const before = await page.evaluate(() => history.length);
    await page.goBack();
    assert.equal(await page.evaluate(() => location.href), 'about:blank', 'one Back leaves the file: the address was replaced, not added');
    await page.goForward();
    await ready(page, 'open');
    assert.equal(await page.evaluate(() => history.length), before);

    // an address that was asked for wins over "me", and a "me" who has left is ignored
    await page.goto('about:blank');
    await goto(page, files.open.url + '#/room/rsample101', 'open');
    assert.equal(await heading(page), 'Room 101');
    await page.evaluate(() => localStorage.setItem('sv2staff:psample001:me', 'tnobody000'));
    await page.goto('about:blank');
    await goto(page, files.open.url, 'open');
    assert.equal(await school(page), SCHOOL);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('with scripts off the page says in plain words how to open the file', async () => {
  const session = await openPage({ js: false });
  try {
    await session.page.goto(files.locked.url, { waitUntil: 'load' });
    const body = await session.page.evaluate(() => document.body.innerText);
    assert.match(body, /This is a staff schedule/);
    assert.match(body, /open this file in Safari or Chrome/);
    assert.match(body, /Mail, Files, Gmail or Drive/);
    assert.ok(!body.includes('Marrowby'));
    assert.deepEqual(asked(session, files.locked.url), []);
  } finally {
    await session.close();
  }
});

test('a file cut short on its way says it is damaged', async () => {
  const session = await openPage();
  try {
    const whole = files.open.html;
    const at = whole.indexOf('"teachers":');
    const cut = whole.slice(0, at) + whole.slice(whole.indexOf('</script>', at));
    const file = path.join(scratch, 'cut.html');
    writeFileSync(file, cut);
    await goto(session.page, pathToFileURL(file).href, 'damaged');
    assert.equal(await heading(session.page), 'This file cannot be opened');
    assert.match(await session.page.evaluate(() => document.querySelector('[role="alert"]').textContent), /^This file is damaged: part of it is missing or was changed\. Ask the office for a new copy\.$/);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- served: the page itself, and the preview

const staffUrl = () => server.base + TOOL_PATH + 'staff/index.html';

test('served from the tool\'s folder with no schedule, the page says there is none', async () => {
  const session = await openPage();
  try {
    await goto(session.page, staffUrl(), 'none');
    assert.equal(await heading(session.page), 'Staff browser');
    assert.match(await session.page.evaluate(() => document.querySelector('.lede').textContent), /There is no schedule in this page/);
    const own = server.base + TOOL_PATH;
    assert.ok(session.requests.length > 20, 'the modules were loaded one by one');
    assert.deepEqual(session.requests.filter((url) => !url.startsWith(own) && !url.startsWith('data:')), [], 'requests outside the tool\'s folder');
    assert.deepEqual(session.requests.filter((url) => url.endsWith('published.json')), [], 'no hosted data file is asked for yet');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// Everything the preview cases need, set up in the host page: the planner's
// own functions, and a frame at a blob address holding the assembled document
// with no data in it.
async function openPreview(session) {
  const { page } = session;
  await goto(page, staffUrl(), 'none');
  await page.evaluate(async (toolPath) => {
    const at = (file) => new URL(toolPath + file, location.origin).href;
    const { assemble, pageReader, feedPreview } = await import(at('ui/staff/assemble.js'));
    const { publishedModel } = await import(at('engine/publish-data.js'));
    const { lockPublished } = await import(at('engine/publish-crypto.js'));
    const { seededRandom } = await import(at('engine/ids.js'));
    const { sampleSchool } = await import(at('data/sample-school.js'));
    const html = await assemble(pageReader(), null);
    const frame = document.createElement('iframe');
    frame.title = 'Preview';
    frame.style.cssText = 'width:390px;height:700px;border:0';
    frame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    document.body.appendChild(frame);
    const kit = { frame, html, data: null, sampleSchool, publishedModel, lockPublished, seededRandom, assemble, pageReader };
    kit.model = (iso, change) => {
      const project = sampleSchool();
      if (change) change(project);
      return publishedModel(project, { clock: () => new Date(iso) });
    };
    kit.feed = feedPreview(window, frame, () => kit.data);
    kit.show = (data) => {
      kit.data = data;
      return kit.feed.send();
    };
    kit.inside = () => frame.contentDocument;
    globalThis.kit = kit;
  }, TOOL_PATH);
}

const inFrame = (page, wanted) => page.waitForFunction((want) => {
  const doc = globalThis.kit.inside();
  const app = doc && doc.getElementById('app');
  return Boolean(app) && app.dataset.state === want;
}, { timeout: 20000 }, wanted);

test('the preview frame at a blob address asks until it is fed, then shows the schedule and follows it', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    await inFrame(page, 'waiting');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('.lede').textContent), 'Waiting for the planner…');
    assert.equal(await page.evaluate(() => globalThis.kit.frame.src.startsWith('blob:')), true);

    // nothing is sent until the frame has said it is ready, and then what there is to send
    await page.evaluate(() => { globalThis.kit.data = globalThis.kit.model('2999-01-01T12:00:00Z'); });
    await inFrame(page, 'open');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('.top__school').textContent), SCHOOL);

    // the planner changes; the preview follows and stays on the page it was on
    await page.evaluate(() => { globalThis.kit.frame.contentWindow.location.hash = '#/teacher/tsample001'; });
    await page.waitForFunction(() => globalThis.kit.inside().querySelector('h1').textContent === 'Ms. Halloran');
    assert.equal(await page.evaluate(() => globalThis.kit.show(globalThis.kit.model('2999-01-02T12:00:00Z', (project) => { project.teachers[0].name = 'Ms. Halloran-Reyes'; }))), true);
    await page.waitForFunction(() => globalThis.kit.inside().querySelector('h1').textContent === 'Ms. Halloran-Reyes');
    assert.equal(await page.evaluate(() => globalThis.kit.frame.contentWindow.location.hash), '#/teacher/tsample001');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelectorAll('.band').length), 0);

    const own = server.base + TOOL_PATH;
    assert.deepEqual(session.requests.filter((url) => !url.startsWith(own) && !url.startsWith('data:') && !url.startsWith('blob:' + server.base)), [], 'the planner asked for something outside its own folder');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the preview takes nothing from a window that is not its parent', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    await inFrame(page, 'waiting');
    // the frame talking to itself, and a second frame talking to the first
    await page.evaluate(() => {
      const kit = globalThis.kit;
      const data = kit.model('2999-01-01T12:00:00Z');
      const inner = kit.frame.contentWindow;
      inner.eval('window.postMessage(' + JSON.stringify({ type: 'sv2-published', data }) + ', "*")');
      const other = document.createElement('iframe');
      other.srcdoc = '<script>parent.frames[0].postMessage(' + JSON.stringify({ type: 'sv2-published', data }).split('<').join('\\u003c') + ', "*")</' + 'script>';
      document.body.appendChild(other);
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await page.evaluate(() => globalThis.kit.inside().getElementById('app').dataset.state), 'waiting', 'a message from elsewhere was taken as the schedule');
    await page.evaluate(() => { globalThis.kit.data = globalThis.kit.model('2999-01-01T12:00:00Z'); });
    await inFrame(page, 'open');
  } finally {
    await session.close();
  }
});

test('a reader who has opened a newer copy is told which is newer', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    await page.evaluate(() => { globalThis.kit.data = globalThis.kit.model('2999-03-20T12:00:00Z'); });
    await inFrame(page, 'open');
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:seen')), '2999-03-20T12:00:00.000Z');
    await page.evaluate(() => globalThis.kit.show(globalThis.kit.model('2999-03-12T12:00:00Z')));
    await page.waitForFunction(() => globalThis.kit.inside().querySelectorAll('.band').length === 1);
    const band = await page.evaluate(() => globalThis.kit.inside().querySelector('.band').textContent);
    assert.match(band, /^A newer copy of this schedule has been opened on this device, published (20 March 2999|March 20, 2999)\. This one is from (12 March 2999|March 12, 2999)\.$/);
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:seen')), '2999-03-20T12:00:00.000Z', 'the older copy does not move the mark back');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('.top__school').textContent), SCHOOL, 'the older copy is still shown');
    await page.evaluate(() => globalThis.kit.show(globalThis.kit.model('2999-04-01T12:00:00Z')));
    await page.waitForFunction(() => globalThis.kit.inside().querySelectorAll('.band').length === 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('sv2staff:psample001:seen')), '2999-04-01T12:00:00.000Z');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a schedule in a newer format is refused with advice, and the next good copy is shown', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    await page.evaluate(() => { globalThis.kit.data = { ...globalThis.kit.model('2999-01-01T12:00:00Z'), version: 2 }; });
    await inFrame(page, 'newer');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('h1').textContent), 'This schedule needs a newer copy');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('[role="alert"]').textContent), 'This schedule was made for a newer staff browser than the one in this file. Ask the office for a new copy.');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('.bar')), null);
    await page.evaluate(() => globalThis.kit.show({ format: 'sv2-project', version: 1 }));
    await inFrame(page, 'damaged');
    assert.equal(await page.evaluate(() => globalThis.kit.inside().querySelector('[role="alert"]').textContent), 'This is not a staff schedule. Ask the office for the file again.');
    await page.evaluate(() => globalThis.kit.show(globalThis.kit.model('2999-01-01T12:00:00Z')));
    await inFrame(page, 'open');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a locked schedule in the preview shows the unlock screen, and a newer copy does not wipe what was typed', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    const lock = (iso) => page.evaluate(async (when) => {
      const kit = globalThis.kit;
      return kit.show(await kit.lockPublished(kit.model(when), 'bulldogs2015', { random: kit.seededRandom(when), iterations: 2000 }));
    }, iso);
    await page.evaluate(async () => {
      const kit = globalThis.kit;
      kit.data = await kit.lockPublished(kit.model('2999-01-01T12:00:00Z'), 'bulldogs2015', { random: kit.seededRandom('one'), iterations: 2000 });
    });
    await inFrame(page, 'locked');
    await page.evaluate(() => { globalThis.kit.inside().getElementById('passcode').value = 'bulldogs20'; });
    await lock('2999-01-02T12:00:00Z');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await page.evaluate(() => globalThis.kit.inside().getElementById('passcode').value), 'bulldogs20', 'the field was rebuilt under the typist');
    await page.evaluate(() => {
      const doc = globalThis.kit.inside();
      doc.getElementById('passcode').value = 'bulldogs2015';
      doc.querySelector('form').requestSubmit();
    });
    await inFrame(page, 'open');
    assert.match(await page.evaluate(() => globalThis.kit.inside().querySelector('.foot').textContent), /published (2 January 2999|January 2, 2999)/, 'it opened the newer of the two copies');
    // with the key kept, the next locked copy opens without asking
    await lock('2999-01-03T12:00:00Z');
    await page.waitForFunction(() => /published (3 January 2999|January 3, 2999)/.test(globalThis.kit.inside().querySelector('.foot').textContent), { timeout: 20000 });
    assert.equal(await page.evaluate(() => globalThis.kit.inside().getElementById('app').dataset.state), 'open');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------- served: the assembler and the lock in the page

test('the planner assembles the same document as Node does, reads its inputs once, and only from its own folder', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    const own = server.base + TOOL_PATH;
    const loaded = session.requests.filter((url) => url.startsWith(own));
    for (const input of ['staff/index.html', 'staff/staff.css', 'fonts/public-sans-latin-400-normal.woff2', 'staff/main.js', 'engine/routing.js']) {
      assert.ok(loaded.filter((url) => url === own + input).length >= 1, input + ' was read');
    }
    const empty = await page.evaluate(() => globalThis.kit.html);
    assert.equal(empty, await assemble(read, null), 'the document the page assembled is not the one Node assembled');

    session.requests.length = 0;
    const model = publishedModel(sampleSchool(), { clock: future });
    const full = await page.evaluate(async () => {
      const kit = globalThis.kit;
      const one = await kit.assemble(kit.pageReader(), kit.model('2999-01-01T12:00:00Z'));
      const two = await kit.assemble(kit.pageReader(), kit.model('2999-01-01T12:00:00Z'));
      return { one, same: one === two };
    });
    assert.equal(full.same, true);
    assert.equal(full.one, await assemble(read, model));
    assert.deepEqual(JSON.parse(partsOf(full.one).data), model);
    assert.deepEqual(session.requests, [], 'publishing again asked for a file a second time');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the lock made in the browser is byte for byte the lock made in Node, and each opens the other\'s', async () => {
  const session = await openPage({ width: 1000, height: 800 });
  try {
    const { page } = session;
    await openPreview(session);
    const model = publishedModel(sampleSchool(), { clock: future });
    const here = await lockPublished(model, 'bulldogs2015', { random: seededRandom('both'), iterations: 3000 });
    const there = await page.evaluate(async (toolPath) => {
      const kit = globalThis.kit;
      const { unlockPublished } = await import(new URL(toolPath + 'engine/publish-crypto.js', location.origin).href);
      const envelope = await kit.lockPublished(kit.model('2999-01-01T12:00:00Z'), 'bulldogs2015', { random: kit.seededRandom('both'), iterations: 3000 });
      const opened = await unlockPublished(envelope, 'bulldogs2015');
      const wrong = await unlockPublished(envelope, 'bulldogs2016');
      return { envelope, name: opened.model.settings.schoolName, wrong, secure: isSecureContext, subtle: Boolean(crypto.subtle) };
    }, TOOL_PATH);
    assert.deepEqual(there.envelope, here);
    assert.equal(there.name, SCHOOL);
    assert.equal(there.wrong, null);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});
