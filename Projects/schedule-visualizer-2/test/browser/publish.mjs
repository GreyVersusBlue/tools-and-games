// The Staff browser section of the planner, driven in Chromium:
//   node test/browser/publish.mjs
//
// The preview frame (the assembled staff browser at a blob address, fed by
// message, live as the project changes, at a phone's width and a desktop's),
// the publish form line by line, a file published behind a changed passcode
// and opened from disk with it, a file published with protection off, the
// staff browser's files read once and good for publishing with the network
// gone, batch printing through the preview sheet, hostile names, and axe on
// the section in both themes at a desktop's width and a phone's. And the
// fixes of SV2-42: the list of what readers will see following two changes
// made at once, the passcode screen every time its tick goes on, a passcode
// that was refused keeping Publish from going ahead, a second project never
// taking the first one's passcode, and a tab that cannot change the project.
//
// Each case opens the planner afresh on the sample school.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, TOOL_DIR } from './harness.mjs';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const DEFAULT = 'bulldogs2015';
const CHANGED = 'heron-lantern-42';
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';

// Published files are written to a folder of this suite's own and taken away
// when it ends: SV2_SCRATCH when the machine names a place, otherwise
// test/.scratch inside the tool. Never the system's temporary folder, which
// on some machines is memory.
const SCRATCH_ROOT = process.env.SV2_SCRATCH ? path.resolve(process.env.SV2_SCRATCH) : path.join(TOOL_DIR, 'test', '.scratch');
mkdirSync(SCRATCH_ROOT, { recursive: true });
const scratch = mkdtempSync(path.join(SCRATCH_ROOT, 'publish-'));
let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  rmSync(scratch, { recursive: true, force: true });
  try {
    // the folder above it too, once the last suite using it has gone
    rmdirSync(SCRATCH_ROOT);
  } catch (error) {
    // another suite's files are still in it, or the machine named it
  }
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- the planner's side

async function previewLive(page) {
  await page.waitForFunction(() => document.querySelector('.stf-preview')?.dataset.preview === 'live', { timeout: 30000 });
}

async function checksDrawn(page) {
  await page.waitForFunction(() => document.querySelector('.pub') && document.querySelector('.pub').dataset.checksPending !== 'true');
}

// The planner on the Staff browser section, its preview fed.
async function open(options) {
  const session = await openPlanner({ browser, server, hash: '#staff', ...options });
  await previewLive(session.page);
  await checksDrawn(session.page);
  return session;
}

async function closing(session, run) {
  try {
    await run(session.page, session);
    assert.deepEqual(session.problems().errors, [], 'the page reported something wrong');
  } finally {
    await session.close();
  }
}

// The preview frame, as Puppeteer sees it.
function frameOf(page) {
  const frame = page.frames().find((each) => each.url().startsWith('blob:'));
  assert.ok(frame, 'the preview frame is at a blob address');
  return frame;
}

const ROOM_101 = 'Room 101 has two groups in Period 3 on A Day: both will be shown.';
const ROOM_203 = 'Room 203 has two groups in Period 2 on A Day: both will be shown.';
const NOT_SENT = 'Nothing was sent anywhere: send the file on yourself, by mail or on a shared drive.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The views and the map's names are folded under "What is in it": open it, as a click on the line does.
async function openFold(page) {
  if (!(await page.evaluate(() => document.getElementById('publish-contents').open))) await page.click('#publish-contents > summary');
  await page.waitForFunction(() => document.querySelector('.pub input[data-view="teacher"]').getClientRects().length > 0);
}

const checkLines = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.pub__checks li'), (el) => el.textContent));

const sent = (page) => page.evaluate(() => Number(document.querySelector('.stf-preview').dataset.sent));
const project = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const undoSteps = (page) => page.evaluate(() => globalThis.sv2.store.history.past.length);
const undoLabel = (page) => page.evaluate(() => globalThis.sv2.store.undoLabel);
const says = (page, what) => page.evaluate((name) => document.querySelector('[data-says="' + name + '"]').textContent, what);

function apply(page, action, payload) {
  return page.evaluate(async (name, given) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(actions[name], given);
  }, action, payload);
}

// Wait until the frame has been fed again after `before` feeds.
async function fedAfter(page, before) {
  await page.waitForFunction((count) => Number(document.querySelector('.stf-preview').dataset.sent) > count, { timeout: 15000 }, before);
}

// Type into one of the form's fields as a person would, and leave it by Enter.
async function typeInto(page, selector, text) {
  await page.focus(selector);
  await page.evaluate((s) => document.querySelector(s).select(), selector);
  await page.keyboard.press('Backspace');
  if (text !== '') await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

// Take the next published file through the test hook instead of the download.
async function publishThroughHook(page) {
  return page.evaluate(async () => {
    const view = document.querySelector('.stf').staff;
    let got = null;
    view.hooks.deliver = (published) => {
      got = { html: published.html, fileName: published.fileName, locked: published.locked };
      return { fileName: published.fileName, bytes: published.html.length };
    };
    try {
      await view.form.publish();
    } finally {
      view.hooks.deliver = null;
    }
    return got;
  });
}

async function atRest(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function axe(page, name) {
  await atRest(page);
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  assert.ok(result.passes.length > 10, 'axe ran very few rules on ' + name);
  const said = result.violations.map((violation) => violation.id + ': ' + violation.help + ' at ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
  assert.deepEqual(said, [], 'axe on ' + name);
}

// ---------------------------------------------------------------- a published file, from disk

// A page in a browser profile of its own: no kept key, nothing remembered.
async function openFile(url) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 760, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  const own = url.split('#')[0];
  return {
    page,
    errors,
    // what the file asked for beyond itself; a font inside the file is "loaded" from a data: address, which is no request
    asked: () => requests.filter((each) => each !== own && !each.startsWith(own + '#') && !each.startsWith('data:')),
    close: () => context.close(),
  };
}

const fileState = (page) => page.evaluate(() => document.getElementById('app').dataset.state);

async function fileIs(page, wanted) {
  await page.waitForFunction((want) => document.getElementById('app').dataset.state === want, { timeout: 30000 }, wanted);
}

function save(name, html) {
  const file = path.join(scratch, name);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

// ---------------------------------------------------------------- the preview

test('the section opens on the preview: the assembled staff browser in a phone-sized frame at a blob address, fed by message', async () => {
  await closing(await open(), async (page, session) => {
    assert.equal(await page.evaluate(() => document.querySelector('.stf h1').textContent), 'This is the staff browser.');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.stub').length), 0, 'the stub is gone');
    const frame = await page.evaluate(() => {
      const el = document.querySelector('.stf-frame');
      return { src: el.src.slice(0, 5), width: el.style.width, height: el.style.height, title: el.title, scale: el.dataset.scale, sandbox: el.getAttribute('sandbox') };
    });
    assert.deepEqual(frame, { src: 'blob:', width: '390px', height: '760px', title: 'Preview of the staff browser', scale: '1', sandbox: null });

    const inside = frameOf(page);
    await inside.waitForFunction(() => document.getElementById('app').dataset.state === 'open');
    const shown = await inside.evaluate(() => ({
      school: document.querySelector('.top__school').textContent,
      heading: document.querySelector('h1').textContent,
      // the document is the published one with no data in it: one inline module script, one inline sheet, nothing to fetch
      data: document.getElementById('sv2-published'),
      scripts: Array.from(document.scripts, (script) => script.src),
      links: document.querySelectorAll('link[rel="stylesheet"]').length,
      styles: document.querySelectorAll('style').length,
      width: innerWidth,
    }));
    assert.deepEqual(shown, { school: SCHOOL, heading: 'Search', data: null, scripts: [''], links: 0, styles: 1, width: 390 });
    assert.equal(await sent(page), 1, 'fed once, on the frame\'s first knock');
    assert.equal(await says(page, 'preview'), 'This is the file as staff see it. It follows the project as you change it.');
    // the frame asked the server for nothing: its whole page came from the blob
    assert.deepEqual(session.requests.filter((url) => url.startsWith('blob:')).length, 1);
    assert.deepEqual(session.offsite, []);
  });
});

test('the preview follows the project: a published change reaches the frame, a change readers never see does not', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    let before = await sent(page);
    await apply(page, 'setSetting', { key: 'schoolName', value: 'Kestrel Vale Academy' });
    await fedAfter(page, before);
    await inside.waitForFunction(() => document.querySelector('.top__school').textContent === 'Kestrel Vale Academy');

    // three quick changes are one feed (the frame is told 250 ms after the last)
    before = await sent(page);
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Hallo' });
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Hallor' });
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran-Voss' });
    await fedAfter(page, before);
    await wait(600);
    assert.equal(await sent(page), before + 1);
    await inside.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await inside.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Halloran-Voss');

    // the passcode and the publish time are not in what an unlocked reader holds
    before = await sent(page);
    await apply(page, 'setPublishSetting', { key: 'passcode', value: 'something-else' });
    await apply(page, 'setPublishSetting', { key: 'lastPublishedAt', value: '2026-09-01T12:00:00.000Z' });
    await wait(900);
    assert.equal(await sent(page), before, 'nothing a reader sees changed, so the frame was left alone');
    assert.equal(await inside.evaluate(() => document.querySelector('h1').textContent), 'Ms. Halloran-Voss', 'and it is still on the page it was on');

    // undo is a change like any other
    await page.evaluate(() => { globalThis.sv2.store.undo(); globalThis.sv2.store.undo(); globalThis.sv2.store.undo(); });
    await fedAfter(page, before);
    await inside.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Hallor');
  });
});

test('the frame switches to a desktop width, scaled to the room there is, and back', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    await page.click('.stf-bar input[value="desktop"] + .seg__label');
    await inside.waitForFunction(() => innerWidth === 1180);
    const wide = await page.evaluate(() => {
      const el = document.querySelector('.stf-frame');
      const fit = document.querySelector('.stf-fit').getBoundingClientRect();
      const stage = document.querySelector('.stf-stage').getBoundingClientRect();
      return { width: el.style.width, scale: Number(el.dataset.scale), fit: fit.width, stage: stage.width, shownAs: el.getBoundingClientRect().width };
    });
    assert.equal(wide.width, '1180px');
    assert.ok(wide.scale < 1 && wide.scale > 0.2, 'a 1180 px page does not fit beside the inspector at 1280, so it is scaled: ' + wide.scale);
    assert.ok(wide.fit <= wide.stage + 1, 'the scaled frame is inside the stage: ' + wide.fit + ' in ' + wide.stage);
    assert.ok(Math.abs(wide.shownAs - 1180 * wide.scale) < 2, 'drawn at its width times the scale');
    assert.equal(await page.evaluate(() => document.querySelector('.surface').scrollWidth <= document.querySelector('.surface').clientWidth), true, 'and the surface does not scroll sideways');
    // the desktop layout of the staff browser is what shows: the bar is a rail on the left
    assert.equal(await inside.evaluate(() => document.getElementById('app').dataset.state), 'open');

    await page.click('.stf-bar input[value="phone"] + .seg__label');
    await inside.waitForFunction(() => innerWidth === 390);
    assert.equal(await page.evaluate(() => document.querySelector('.stf-frame').dataset.scale), '1');
  });
});

test('"Start at the passcode screen" feeds the locked file: the unlock screen, and the project\'s passcode opens it', async () => {
  const session = await open();
  await closing(session, async (page) => {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
    const inside = frameOf(page);
    const before = await sent(page);
    await page.click('.stf-bar .stf-check');
    await fedAfter(page, before);
    await inside.waitForFunction(() => document.getElementById('app').dataset.state === 'locked', { timeout: 30000 });
    assert.equal(await says(page, 'preview'), 'This is the file as a reader first meets it. It follows the project as you change it.');
    const body = await inside.evaluate(() => document.body.textContent);
    assert.match(body, /This schedule is for staff\. Enter the staff passcode\./);
    assert.ok(!body.includes('Marrowby'), 'a locked file names no school');
    await inside.type('#passcode', DEFAULT);
    await inside.evaluate(() => document.getElementById('passcode').form.requestSubmit());
    await inside.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
    assert.equal(await inside.evaluate(() => document.querySelector('.top__school').textContent), SCHOOL);

    // with protection off there is no passcode screen to start at
    await page.click('#publish-protect');
    await page.waitForFunction(() => document.querySelector('.stf-bar .stf-check__box').disabled);
    assert.equal(await page.evaluate(() => document.querySelector('.stf-bar .stf-check__box').checked), false);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

// ---------------------------------------------------------------- the form

test('the publish form, line by line: views, names on the map, staleness, the passcode and its one-line truth, what readers will see, the notes line, the mail line', async () => {
  await closing(await open(), async (page) => {
    assert.equal(await page.evaluate(() => document.querySelector('.inspector__title').textContent), 'Publish');
    const form = await page.evaluate(() => ({
      groups: Array.from(document.querySelectorAll('.pub__group .pub__title'), (el) => el.textContent),
      views: Array.from(document.querySelectorAll('.pub input[data-view]'), (el) => [el.dataset.view, el.checked, el.labels[0].textContent]),
      names: document.querySelector('.pub input[name="names"]').checked,
      stale: document.getElementById('publish-stale').value,
      staleLabel: document.getElementById('publish-stale').labels[0].textContent,
      staleLabels: [document.getElementById('publish-stale').labels.length, document.getElementById('publish-stale').labels[0].closest('.pub__title') !== null],
      fold: { open: document.getElementById('publish-contents').open, says: document.querySelector('#publish-contents > summary').textContent, boxes: document.querySelectorAll('#publish-contents input[type="checkbox"]').length },
      protect: document.getElementById('publish-protect').checked,
      passcode: document.getElementById('publish-passcode').value,
      passcodeAttrs: ['type', 'autocapitalize', 'autocorrect', 'autocomplete', 'spellcheck'].map((name) => document.getElementById('publish-passcode').getAttribute(name)),
      described: document.getElementById(document.getElementById('publish-passcode').getAttribute('aria-describedby')).textContent,
      button: document.getElementById('publish-file').textContent,
      headings: Array.from(document.querySelectorAll('.pub h2'), (el) => el.textContent),
    }));
    // the passcode, what readers will see and the button first; what is in the file folded under one line; no heading reads "Staleness"
    assert.deepEqual(form.groups, ['Passcode', 'Before you publish', 'Views to include', 'The map', 'Days until the file counts as out of date']);
    assert.deepEqual(form.fold, { open: false, says: 'What is in it · All 11 views', boxes: 12 });
    assert.deepEqual(form.staleLabels, [1, true], 'the heading is the field\'s label: it is not said twice');
    assert.deepEqual(form.views, [
      ['teacher', true, 'Teacher pages'], ['group', true, 'Group pages'], ['room', true, 'Room pages and door signs'], ['map', true, 'Building map'],
      ['free', true, 'Free right now'], ['now', true, 'Where is this group right now'], ['common', true, 'Common planning'], ['coverage', true, 'Coverage'],
      ['sub', true, 'Substitute plan'], ['directions', true, 'Directions'], ['staffing', true, 'Staffing overview'],
    ]);
    assert.equal(form.names, true);
    assert.equal(form.stale, '60');
    assert.equal(form.staleLabel, 'Days until the file counts as out of date');
    assert.equal(form.protect, true);
    assert.equal(form.passcode, DEFAULT, 'the passcode the tool starts with, in plain sight: the publisher has to be able to pass it on');
    assert.deepEqual(form.passcodeAttrs, ['text', 'off', 'off', 'off', 'false']);
    assert.equal(form.described, 'This is the passcode the tool starts with, so it is public. Change it, then tell staff the new one.', 'under the passcode the tool starts with, the line says what to do');
    assert.equal(form.button, 'Publish a file');
    assert.deepEqual(form.headings, ['Publish', 'Print for the whole school']);
    assert.equal(await says(page, 'notes'), 'Teacher notes are published: the substitute plan shows them.');
    assert.equal(await says(page, 'mail'), 'On a phone, open the file in Safari or Chrome, or save it to Files first; a mail app’s preview will not work.');

    // the sample school has one problem left, and the form says what readers will see of it
    assert.deepEqual(await checkLines(page), [ROOM_203]);
    assert.equal(await page.evaluate(() => document.querySelector('.pub__checks li').dataset.kind), 'room-double');

    // in a 1280 px window the passcode and the button are on screen before anything is scrolled, in this order
    for (const height of [900, 720]) {
      await page.setViewport({ width: 1280, height, deviceScaleFactor: 1 });
      const seen = await page.evaluate(() => {
        const body = document.querySelector('.pub').closest('.inspector__body') || document.querySelector('.inspector');
        const box = body.getBoundingClientRect();
        const within = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.height > 0 && rect.top >= box.top && rect.bottom <= Math.min(box.bottom, innerHeight);
        };
        const top = (id) => document.getElementById(id).getBoundingClientRect().top;
        return {
          scrolled: body.scrollTop,
          passcode: within(document.getElementById('publish-passcode')),
          protect: within(document.getElementById('publish-protect')),
          button: within(document.getElementById('publish-file')),
          order: top('publish-passcode') < top('publish-file') && top('publish-file') < top('publish-contents') && top('publish-contents') < top('publish-stale'),
        };
      });
      assert.deepEqual(seen, { scrolled: 0, passcode: true, protect: true, button: true, order: true }, 'at 1280 by ' + height);
    }

    // a changed passcode gets the plain truth about short ones, and whom to tell
    await typeInto(page, '#publish-passcode', CHANGED);
    assert.equal(await says(page, 'passcode'), 'A short or guessable passcode stops a casual look, not someone set on guessing it. Tell staff this passcode: the file asks for it once on each device.');
  });
});

test('each choice is the project\'s own setting: saved through the publish action, one undo step, and the control follows an undo', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    const start = await undoSteps(page);

    // a view left out: the project says so, the preview drops it, the folded line counts it
    await openFold(page);
    let before = await sent(page);
    await page.click('.pub input[data-view="coverage"]');
    assert.equal((await project(page)).publish.views.coverage, false);
    assert.equal(await says(page, 'views'), '10 of 11 views');
    assert.equal(await undoSteps(page), start + 1);
    assert.equal(await undoLabel(page), 'Change a publish setting');
    await fedAfter(page, before);
    await inside.waitForFunction(() => !Array.from(document.querySelectorAll('a')).some((a) => a.getAttribute('href') === '#/coverage'));
    await page.evaluate(() => globalThis.sv2.store.undo());
    await page.waitForFunction(() => document.querySelector('.pub input[data-view="coverage"]').checked);
    assert.equal((await project(page)).publish.views.coverage, true);
    await page.evaluate(() => globalThis.sv2.store.redo());
    await page.waitForFunction(() => !document.querySelector('.pub input[data-view="coverage"]').checked);

    await page.click('.pub input[name="names"]');
    assert.equal((await project(page)).publish.teacherNamesOnMap, false);
    assert.equal(await undoSteps(page), start + 2);

    // staleness: a number of days, committed on Enter, with the day it runs out
    await typeInto(page, '#publish-stale', '30');
    assert.equal((await project(page)).publish.stalenessDays, 30);
    assert.equal(await undoSteps(page), start + 3);
    const hint = await page.evaluate(() => document.getElementById(document.getElementById('publish-stale').getAttribute('aria-describedby').split(' ')[0]).textContent);
    // the day is read from the line itself and checked against the page's clock a day either side, so midnight between the two reads is not a failure
    const said = /^Readers see a notice once the file is older than this\. Published today, it is current until (\d{1,2} [A-Z][a-z]+ \d{4})\. From 1 to 3650 days\.$/.exec(hint);
    assert.ok(said, hint);
    const around = await page.evaluate((months) => [-1, 0].map((shift) => {
      const date = new Date(Date.now() + (30 + shift) * 24 * 60 * 60 * 1000);
      return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
    }), MONTHS);
    assert.ok(around.includes(said[1]), said[1] + ' is 30 days on: ' + around.join(' or '));
    // a refusal is a sentence under the field, and nothing changes
    await typeInto(page, '#publish-stale', '0');
    assert.equal((await project(page)).publish.stalenessDays, 30);
    assert.equal(await page.evaluate(() => document.getElementById('publish-stale').getAttribute('aria-invalid')), 'true');
    assert.match(await page.evaluate(() => document.getElementById('publish-stale-refusal').textContent), /staleness period in days/i);
    await typeInto(page, '#publish-stale', 'soon');
    assert.equal(await page.evaluate(() => document.getElementById('publish-stale-refusal').textContent), 'The number of days is a whole number. "soon" is not one.');
    assert.equal(await undoSteps(page), start + 3);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('publish-stale').value), '30');

    // the passcode: changed in the field, saved in the project, one step
    await typeInto(page, '#publish-passcode', CHANGED);
    assert.equal((await project(page)).publish.passcode, CHANGED);
    assert.equal(await undoSteps(page), start + 4);
    assert.equal(await undoLabel(page), 'Change a publish setting');
    // an empty field is refused with the way to turn protection off
    await typeInto(page, '#publish-passcode', '');
    assert.equal((await project(page)).publish.passcode, CHANGED);
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode-refusal').textContent), 'A passcode cannot be empty. To publish without one, untick "Ask for a staff passcode".');
    await page.keyboard.press('Escape');

    // off: the field goes, the line says what that means; on again brings the passcode back
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, '');
    assert.equal(await undoSteps(page), start + 5);
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').closest('.field').hidden), true);
    assert.equal(await says(page, 'passcode'), 'With no passcode, anyone who has the file can read the schedule.');
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, CHANGED, 'the passcode it had, not the tool\'s default');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').value), CHANGED);

    // and it travels in the project file
    const file = await page.evaluate(async () => {
      const { writeProjectFile } = await import(new URL('engine/project-file.js', location.href).href);
      return JSON.parse(writeProjectFile(globalThis.sv2.store.project, { images: {} })).publish;
    });
    assert.equal(file.passcode, CHANGED);
    assert.equal(file.stalenessDays, 30);
  });
});

test('what readers will see: a sentence per remaining problem, redrawn as the schedule changes, with accepted ones counted apart', async () => {
  await closing(await open(), async (page) => {
    const lines = () => checkLines(page);
    assert.deepEqual(await lines(), [ROOM_203]);

    // a second problem: 7A goes where 6A already is
    const slot = await page.evaluate(() => {
      const school = globalThis.sv2.store.project;
      const day = school.dayTypes[0].id;
      const six = school.groups.find((group) => group.name === '6A');
      return { dayTypeId: day, period: 2, room: six.days[day][2].room, groupId: school.groups.find((group) => group.name === '7A').id };
    });
    await apply(page, 'setSlot', { groupId: slot.groupId, dayTypeId: slot.dayTypeId, period: slot.period, slot: { room: slot.room } });
    await checksDrawn(page);
    assert.deepEqual(await lines(), [ROOM_203, ROOM_101]);

    // accepted, the first is no longer a line; it is still published, and the form says so
    const id = await page.evaluate(() => document.querySelector('.pub__checks li[data-kind="room-double"]').dataset.finding);
    await apply(page, 'acceptFinding', { findingId: id, reason: 'Both coaches are there' });
    await checksDrawn(page);
    assert.deepEqual(await lines(), [ROOM_101]);
    assert.equal(await says(page, 'checks-summary'), 'One problem you accepted is published as it is too.');

    // Two undos at once. The list still holds one line until the checks
    // answer, and it is the line of the project before: a wait for "one
    // line" is met by that stale line (SV2-42 item 0), so the wait is for
    // the answer, which the form marks with data-checks-pending.
    await page.evaluate(() => { globalThis.sv2.store.undo(); globalThis.sv2.store.undo(); });
    await checksDrawn(page);
    assert.deepEqual(await lines(), [ROOM_203]);
    // with nothing left, one plain sentence
    const only = await page.evaluate(() => document.querySelector('.pub__checks li').dataset.finding);
    await apply(page, 'acceptFinding', { findingId: only, reason: 'Team taught' });
    await checksDrawn(page);
    assert.equal(await page.evaluate(() => document.querySelector('.pub__checks').hidden), true);
    assert.equal(await says(page, 'checks-summary'), 'The checks found no problem that readers will see. One problem you accepted is published as it is.');

    // a check that is switched off was not looked at, and the line says so
    await page.evaluate(() => globalThis.sv2.store.undo());
    await apply(page, 'setSetting', { key: 'checks.off', value: ['room-double', 'over-capacity'] });
    await checksDrawn(page);
    assert.deepEqual(await lines(), []);
    assert.equal(await says(page, 'checks-summary'), 'The checks found no problem that readers will see. One check is switched off and was not looked at.');

    // a teacher based in two rooms is said as the reader meets it
    const rooms = await page.evaluate(() => globalThis.sv2.store.project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.number === '101' || space.number === '102').map((space) => space.id));
    await apply(page, 'editTeacher', { id: 'tsample001', roomIds: rooms });
    await checksDrawn(page);
    const based = await page.evaluate(() => Array.from(document.querySelectorAll('.pub__checks li[data-kind="teacher-multi-room"]'), (el) => el.textContent));
    assert.deepEqual(based, ['Ms. Halloran is based in two rooms: both are shown on the teacher\'s page.']);
  });
});

test('two changes at once, ten times over, with the checks answering late: the list and the line under it are the last project\'s every time', async () => {
  await closing(await open(), async (page) => {
    // every answer from the checks comes 120 ms late, so each change below is made while one is still on its way
    await page.evaluate(() => {
      const engine = globalThis.sv2.store.derived.engine;
      const results = engine.results.bind(engine);
      engine.results = () => results().then((result) => new Promise((resolve) => { setTimeout(() => resolve(result), 120); }));
    });
    const slot = await page.evaluate(() => {
      const school = globalThis.sv2.store.project;
      const day = school.dayTypes[0].id;
      const six = school.groups.find((group) => group.name === '6A');
      return { dayTypeId: day, period: 2, slot: { room: six.days[day][2].room }, groupId: school.groups.find((group) => group.name === '7A').id };
    });
    for (let round = 1; round <= 10; round += 1) {
      // three changes in one turn of the page: a second problem, one of the two accepted, and both taken back
      const during = await page.evaluate(async (given) => {
        const actions = await import(new URL('engine/actions.js', location.href).href);
        const store = globalThis.sv2.store;
        store.apply(actions.setSlot, given);
        store.apply(actions.acceptFinding, { findingId: 'room-double:dsample00a:1:rsample203', reason: 'Both coaches are there' });
        store.undo();
        store.undo();
        return document.querySelector('.pub').dataset.checksPending;
      }, slot);
      assert.equal(during, 'true', 'round ' + round + ': the form says an answer is on its way');
      await checksDrawn(page);
      assert.deepEqual(await checkLines(page), [ROOM_203], 'round ' + round);
      assert.equal(await page.evaluate(() => document.querySelector('[data-says="checks-summary"]').hidden), true, 'round ' + round + ': nothing was accepted in the project as it stands');
      assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.checks), '1');

      // and the other way: ending on a project with something accepted
      await page.evaluate(async (given) => {
        const actions = await import(new URL('engine/actions.js', location.href).href);
        const store = globalThis.sv2.store;
        store.apply(actions.setSlot, given);
        store.undo();
        store.redo();
        store.apply(actions.acceptFinding, { findingId: 'room-double:dsample00a:1:rsample203', reason: 'Both coaches are there' });
      }, slot);
      await checksDrawn(page);
      assert.deepEqual(await checkLines(page), [ROOM_101], 'round ' + round + ', ending accepted');
      assert.equal(await says(page, 'checks-summary'), 'One problem you accepted is published as it is too.', 'round ' + round);
      await page.evaluate(() => { globalThis.sv2.store.undo(); globalThis.sv2.store.undo(); });
    }
    await checksDrawn(page);
    assert.deepEqual(await checkLines(page), [ROOM_203]);
  });
});

// ---------------------------------------------------------------- publishing

test('a changed passcode, Publish a file: the download is named for the school and the day, and opens from disk with the changed passcode on a teacher\'s page', async () => {
  const folder = mkdtempSync(path.join(scratch, 'download-'));
  let url;
  await closing(await open(), async (page) => {
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });

    await typeInto(page, '#publish-passcode', CHANGED);
    assert.equal((await project(page)).publish.passcode, CHANGED);
    const steps = await undoSteps(page);

    await page.click('#publish-file');
    await page.waitForFunction(() => /^Published /.test(document.querySelector('[data-says="published"]').textContent), { timeout: 30000 });
    let names = [];
    for (let tries = 0; tries < 100 && !(names.length === 1 && names[0].endsWith('.html')); tries += 1) {
      await wait(100);
      names = readdirSync(folder);
    }
    assert.equal(names.length, 1, 'one file was downloaded: ' + names.join(', '));
    assert.match(names[0], /^Marrowby Middle School \(sample\) - staff schedule - \d{4}-\d{2}-\d{2}\.html$/);
    // The day in the name is the day the planner's clock gave when it made
    // the file, which the project kept: that one reading is what the name
    // is held to. The page's clock is moved on a day first, as it is when
    // midnight falls between the publish and this line, so nothing below
    // can pass by asking the clock again.
    await page.evaluate(() => {
      const Real = Date;
      const DAY = 24 * 60 * 60 * 1000;
      globalThis.Date = class extends Real {
        constructor(...given) {
          if (given.length === 0) super(Real.now() + DAY);
          else super(...given);
        }

        static now() {
          return Real.now() + DAY;
        }
      };
    });
    const made = (await project(page)).publish.lastPublishedAt;
    assert.match(made, /^\d{4}-\d{2}-\d{2}T/, 'the project remembers that a file went out');
    const day = await page.evaluate((at, months) => {
      const date = new Date(at);
      return {
        name: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
        words: date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear(),
      };
    }, made, MONTHS);
    assert.ok(names[0].endsWith(' - ' + day.name + '.html'), 'the day it was published, on this device: ' + names[0] + ' against ' + day.name);
    // what the status says: the file, that nothing was sent, and the passcode it asks for
    const said = await says(page, 'published');
    assert.equal(said, 'Published ' + names[0] + ' (' + (/\((\d+ KB)\)/.exec(said) || [])[1] + '). ' + NOT_SENT + ' It asks for the staff passcode: ' + CHANGED);
    assert.equal(await says(page, 'published-passcode'), CHANGED, 'the passcode stands alone, as typed');
    assert.equal(await page.evaluate(() => document.querySelector('[data-says="published"]').getAttribute('role')), 'status');

    // publishing is not an undo step: the time is noted by a quiet action of the engine's, and the form makes none of its own
    assert.equal(await undoSteps(page), steps);
    const noted = await page.evaluate(async () => {
      const actions = await import(new URL('engine/actions.js', location.href).href);
      const form = await (await fetch(new URL('ui/staff/form.js', location.href))).text();
      return { quiet: Boolean(actions.notePublished) && actions.notePublished.quiet, label: actions.notePublished && actions.notePublished.label, formMakesOne: /\baction\(/.test(form) };
    });
    assert.deepEqual(noted, { quiet: true, label: 'Note when the file was published', formMakesOne: false });
    assert.equal(await page.evaluate(() => document.querySelector('.stf-facts').textContent), 'The last file from this project was made on ' + day.words + '. It has 12 teachers, 8 groups and 13 rooms to show.');

    const html = readFileSync(path.join(folder, names[0]), 'utf8');
    for (const word of ['Marrowby', 'Halloran', 'tsample001', CHANGED, DEFAULT]) assert.ok(!html.includes(word), word + ' can be read in the file without the passcode');
    assert.ok(html.includes('"format":"sv2-published-locked"'));
    url = pathToFileURL(path.join(folder, names[0])).href;
  });

  const reader = await openFile(url + '#/teacher/tsample001');
  try {
    const { page } = reader;
    await fileIs(page, 'locked');
    assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('Marrowby'));
    // the passcode the tool starts with no longer opens it
    await page.type('#passcode', DEFAULT);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('passcode-says').textContent !== '', { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.getElementById('passcode-says').textContent), 'That passcode did not open this schedule. Check it and try again.');
    assert.equal(await fileState(page), 'locked');
    // the changed one does, on the page that was asked for
    await page.evaluate(() => { document.getElementById('passcode').value = ''; });
    await page.type('#passcode', CHANGED);
    await page.keyboard.press('Enter');
    await fileIs(page, 'open');
    assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), 'Ms. Halloran');
    assert.equal(await page.evaluate(() => document.querySelector('.top__school').textContent), SCHOOL);
    assert.ok((await page.evaluate(() => document.querySelectorAll('.day .row').length)) >= 8, 'the teacher\'s day is on the page');
    assert.deepEqual(reader.asked(), [], 'the file asked for nothing');
    assert.deepEqual(reader.errors, []);
  } finally {
    await reader.close();
  }
});

test('protection off, Publish a file: the file opens from disk on a teacher\'s page with no unlock screen', async () => {
  let published;
  await closing(await open(), async (page) => {
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, '');
    published = await publishThroughHook(page);
    assert.equal(published.locked, false);
    assert.match(await says(page, 'published'), /\. It opens with no passcode\.$/);
    // the choices on the form are in the file: a view left out is left out
    assert.equal(await says(page, 'published'), 'Published ' + published.fileName + ' (' + (/\((\d+ KB)\)/.exec(await says(page, 'published')) || [])[1] + '). ' + NOT_SENT + ' It opens with no passcode.');
    await openFold(page);
    await page.click('.pub input[data-view="staffing"]');
    const second = await publishThroughHook(page);
    assert.ok(second.html.includes('"staffing":false') && published.html.includes('"staffing":true'));
  });
  assert.ok(published.html.includes('"format":"sv2-published"') && !published.html.includes('sv2-published-locked"'));
  assert.ok(published.html.includes('Marrowby Middle School (sample)'));
  assert.ok(!published.html.includes(DEFAULT), 'an open file does not carry the passcode it does not use');

  const reader = await openFile(save('open.html', published.html) + '#/teacher/tsample001');
  try {
    const { page } = reader;
    await fileIs(page, 'open');
    assert.equal(await page.evaluate(() => document.getElementById('passcode')), null, 'no unlock screen');
    assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), 'Ms. Halloran');
    assert.ok((await page.evaluate(() => document.querySelectorAll('.day .row').length)) >= 8);
    assert.deepEqual(reader.asked(), []);
    assert.deepEqual(reader.errors, []);
  } finally {
    await reader.close();
  }
});

test('the staff browser\'s files are read once, and a file is still published with the network gone', async () => {
  const session = await open();
  await closing(session, async (page) => {
    const asked = (piece) => session.requests.filter((url) => url.endsWith(piece)).length;
    assert.equal(asked('/staff/main.js'), 1);
    assert.equal(asked('/staff/staff.css'), 1);
    assert.equal(asked('/staff/index.html'), 1);
    const toServer = () => session.requests.filter((url) => url.startsWith(session.base + '/'));
    const before = toServer().length;
    await page.setOfflineMode(true);
    const first = await publishThroughHook(page);
    const second = await publishThroughHook(page);
    await page.setOfflineMode(false);
    assert.ok(first && first.html.length > 100000, 'a whole file was made with the network gone');
    assert.ok(second && second.locked === true);
    assert.deepEqual(toServer().slice(before), [], 'publishing asked the server for nothing');
    assert.equal(asked('/staff/main.js'), 1);
  });
});

test('the files are read in the background a few seconds after the page loads, whatever section is open, and not again when the section opens', async () => {
  const session = await openPlanner({ browser, server, hash: '#building' });
  await closing(session, async (page) => {
    const asked = (piece) => session.requests.filter((url) => url.endsWith(piece)).length;
    assert.equal(asked('/staff/main.js'), 0, 'not while the page is loading');
    for (let tries = 0; tries < 150 && asked('/staff/main.js') === 0; tries += 1) await wait(100);
    assert.equal(asked('/staff/main.js'), 1, 'read without the Staff browser section ever being opened');
    await page.waitForFunction(async () => {
      const { inputsFor, pageReader } = await import(new URL('ui/staff/assemble.js', location.href).href);
      return Boolean(await inputsFor(pageReader()));
    }, { timeout: 30000 });
    // what went to the server: the frame's own page is a blob: address and the faces inside it data: ones
    const toServer = () => session.requests.filter((url) => url.startsWith(session.base + '/'));
    const before = toServer().length;
    await go(page, '#staff');
    await previewLive(page);
    assert.equal(asked('/staff/main.js'), 1);
    assert.deepEqual(toServer().slice(before), [], 'opening the section asked the server for nothing more');
  });
});

// ---------------------------------------------------------------- SV2-42: the passcode screen, the passcode, the re-feed

const frameState = (inside, wanted) => inside.waitForFunction((want) => document.getElementById('app').dataset.state === want, { timeout: 30000 }, wanted);

async function unlockIn(inside, passcode) {
  await inside.evaluate(() => { document.getElementById('passcode').value = ''; });
  await inside.type('#passcode', passcode);
  await inside.evaluate(() => document.getElementById('passcode').form.requestSubmit());
}

test('"Start at the passcode screen" shows the passcode screen every time it is ticked, though the frame kept the key the first time', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    const kept = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sv2staff:') && key.endsWith(':key')).length);
    for (const time of ['the first time', 'the second time', 'the third time']) {
      const before = await sent(page);
      await page.click('.stf-bar .stf-check');
      await fedAfter(page, before);
      await frameState(inside, 'locked');
      assert.match(await inside.evaluate(() => document.body.textContent), /Enter the staff passcode\./, time);
      assert.equal(await kept(), 0, time + ': the key this device kept is forgotten when the tick goes on');
      await unlockIn(inside, DEFAULT);
      await frameState(inside, 'open');
      assert.equal(await kept(), 1, time + ': unlocking keeps a key, as it does on a reader\'s device');
      // while the tick stays on, a change to the project does not ask again: the key is kept, as on a reader's device
      const fed = await sent(page);
      await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran ' + time });
      await fedAfter(page, fed);
      await inside.evaluate(() => { location.hash = '#/teacher/tsample001'; });
      await inside.waitForFunction((name) => document.querySelector('h1') && document.querySelector('h1').textContent === name, { timeout: 30000 }, 'Ms. Halloran ' + time);
      assert.equal(await inside.evaluate(() => document.getElementById('app').dataset.state), 'open', time);
      // untick: the open file again
      const again = await sent(page);
      await page.click('.stf-bar .stf-check');
      await fedAfter(page, again);
      await frameState(inside, 'open');
    }
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

test('the passcode changed while the locked preview is open: the old one no longer opens it, the new one does', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    let before = await sent(page);
    await page.click('.stf-bar .stf-check');
    await fedAfter(page, before);
    await frameState(inside, 'locked');
    // changed on the form while the passcode screen is up
    before = await sent(page);
    await typeInto(page, '#publish-passcode', CHANGED);
    await fedAfter(page, before);
    await unlockIn(inside, DEFAULT);
    await inside.waitForFunction(() => document.getElementById('passcode-says').textContent !== '', { timeout: 30000 });
    assert.equal(await inside.evaluate(() => document.getElementById('passcode-says').textContent), 'That passcode did not open this schedule. Check it and try again.');
    await unlockIn(inside, CHANGED);
    await frameState(inside, 'open');
    assert.equal(await inside.evaluate(() => document.querySelector('.top__school').textContent), SCHOOL);
    // and changed again once it is open: the key the frame kept no longer fits, so it asks, and the newest passcode opens it
    before = await sent(page);
    await typeInto(page, '#publish-passcode', 'wren-ladder-7');
    await fedAfter(page, before);
    await frameState(inside, 'locked');
    await unlockIn(inside, 'wren-ladder-7');
    await frameState(inside, 'open');
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

test('another project loaded with protection off never takes the last project\'s passcode: ticking protect gives the tool\'s own', async () => {
  await closing(await open(), async (page) => {
    await typeInto(page, '#publish-passcode', CHANGED);
    assert.equal((await project(page)).publish.passcode, CHANGED);
    // another school's file, opened on this section: its own id, and no passcode
    await page.evaluate(async () => {
      const actions = await import(new URL('engine/actions.js', location.href).href);
      const other = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
      other.id = 'psecond0001';
      other.settings.schoolName = 'Tollgate Lane School';
      other.publish.passcode = '';
      globalThis.sv2.store.apply(actions.replaceProject, { project: other, label: 'Open Tollgate Lane School' });
    });
    await page.waitForFunction(() => !document.getElementById('publish-protect').checked);
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, DEFAULT, 'the tool\'s own passcode, not the one typed for the other school');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').value), DEFAULT);
    // within one project the box still brings back what that project had
    await typeInto(page, '#publish-passcode', 'wren-ladder-7');
    await page.click('#publish-protect');
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, 'wren-ladder-7');
    // and back in the first project (an undo of the load and of what followed), its own
    await page.evaluate(() => { for (let n = 0; n < 5; n += 1) globalThis.sv2.store.undo(); });
    assert.equal((await project(page)).settings.schoolName, SCHOOL);
    assert.equal((await project(page)).publish.passcode, CHANGED);
    await page.click('#publish-protect');
    await page.click('#publish-protect');
    assert.equal((await project(page)).publish.passcode, CHANGED);
  });
});

test('a passcode is trimmed, a blank one is refused, and Publish does nothing while the box holds a refused one', async () => {
  await closing(await open(), async (page) => {
    await typeInto(page, '#publish-passcode', '  ' + CHANGED + ' ');
    assert.equal((await project(page)).publish.passcode, CHANGED, 'the spaces either side are not part of it');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').value), CHANGED);
    const steps = await undoSteps(page);

    await typeInto(page, '#publish-passcode', '   ');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode-refusal').textContent), 'A passcode cannot be empty. To publish without one, untick "Ask for a staff passcode".');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').getAttribute('aria-invalid')), 'true');
    assert.equal((await project(page)).publish.passcode, CHANGED);

    // the box shows no passcode and the project holds one: nothing goes out until that is settled
    assert.equal(await publishThroughHook(page), null);
    assert.equal(await says(page, 'published'), 'Nothing was published: the passcode in the box was not taken. Change it, or press Escape in the box to go back to the last one.');
    assert.equal((await project(page)).publish.lastPublishedAt, null);
    await page.click('#publish-file');
    assert.equal(await page.evaluate(() => document.querySelector('.stf').staff.hooks.published), null, 'a real click is refused the same way');

    // Escape in the box puts the last passcode back, and then the file is made, and says which passcode it asks for
    await page.focus('#publish-passcode');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').value), CHANGED);
    const published = await publishThroughHook(page);
    assert.equal(published.locked, true);
    assert.equal(await says(page, 'published-passcode'), CHANGED);
    assert.match(await says(page, 'published'), /^Published .+\.html \(\d+ KB\)\. Nothing was sent anywhere: send the file on yourself, by mail or on a shared drive\. It asks for the staff passcode: heron-lantern-42$/);
    assert.equal(await undoSteps(page), steps);

    // a passcode that is markup is text on that line
    await typeInto(page, '#publish-passcode', HOSTILE);
    await publishThroughHook(page);
    assert.equal(await says(page, 'published-passcode'), HOSTILE);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pub img, .pub b').length), 0);
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
  });
});

test('the frame is fed again for the seven settings a file carries and for no other, and "Try again" lets the page before it go', async () => {
  await closing(await open(), async (page) => {
    // the list preview.js compares is the list publishedModel copies
    const lists = await page.evaluate(async () => {
      const { PUBLISHED_SETTINGS } = await import(new URL('ui/staff/preview.js', location.href).href);
      const { publishedModel } = await import(new URL('engine/publish-data.js', location.href).href);
      return { compared: PUBLISHED_SETTINGS || null, published: Object.keys(publishedModel(globalThis.sv2.store.project, { clock: () => new Date() }).settings) };
    });
    assert.deepEqual(lists.compared, lists.published);
    assert.equal(lists.published.length, 7);

    // settings only the planner uses: the theme, the paper, a default head count, a check's limit
    const before = await sent(page);
    try {
      await apply(page, 'setSetting', { key: 'theme', value: 'dark' });
      await apply(page, 'setSetting', { key: 'paper.size', value: 'a4' });
      await apply(page, 'setSetting', { key: 'defaultHeadCount', value: 31 });
      await apply(page, 'setSetting', { key: 'checks.consecutiveLimit', value: 5 });
      await wait(900);
      assert.equal(await sent(page), before, 'nothing a reader sees changed, so the frame was left alone');
    } finally {
      // the theme is kept on the device as well as in the project: put it back for the cases that follow
      await apply(page, 'setSetting', { key: 'theme', value: 'auto' });
    }
    await wait(600);
    assert.equal(await sent(page), before);
    // one a file carries
    await apply(page, 'setSetting', { key: 'timeFormat', value: '24h' });
    await fedAfter(page, before);

    // "Try again" makes the page anew: the address of the one before is let go
    await page.evaluate(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      globalThis.__revoked = [];
      URL.revokeObjectURL = (address) => {
        globalThis.__revoked.push(address);
        revoke(address);
      };
    });
    const first = await page.evaluate(() => document.querySelector('.stf-frame').src);
    const fed = await sent(page);
    await page.evaluate(() => document.querySelector('[data-action="preview-again"]').click());
    await page.waitForFunction((was) => document.querySelector('.stf-frame').src !== was && document.querySelector('.stf-frame').src.startsWith('blob:'), { timeout: 30000 }, first);
    await fedAfter(page, fed);
    assert.deepEqual(await page.evaluate(() => globalThis.__revoked), [first]);
    await frameOf(page).waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
  });
});

// ---------------------------------------------------------------- SV2-42: what the preview and the form do at the edges

test('room pages left out: the preview has no link to a room or a door sign, and the room\'s address says the view was left out', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    const links = () => inside.evaluate(() => Array.from(document.querySelectorAll('a[href]'), (a) => a.getAttribute('href')).filter((href) => /^#\/(room|door)\//.test(href)));
    await inside.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await inside.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Ms. Halloran');
    assert.ok((await links()).length > 0, 'with room pages in the file, a teacher\'s page links to rooms');

    await openFold(page);
    const before = await sent(page);
    await page.click('.pub input[data-view="room"]');
    await fedAfter(page, before);
    await inside.waitForFunction(() => !Array.from(document.querySelectorAll('a[href]')).some((a) => /^#\/(room|door)\//.test(a.getAttribute('href'))), { timeout: 15000 });
    assert.deepEqual(await links(), []);
    assert.equal(await inside.evaluate(() => document.querySelector('h1').textContent), 'Ms. Halloran', 'still on the page it was on');
    for (const address of ['#/room/rsample203', '#/door/rsample203']) {
      await inside.evaluate((hash) => { location.hash = hash; }, address);
      await inside.waitForFunction(() => /This view was not included when this schedule was published\./.test(document.getElementById('app').textContent), { timeout: 15000 });
      assert.deepEqual(await links(), [], address);
    }
  });
});

test('the teacher whose page the frame is on is deleted: after the re-feed the frame says the page is not in this schedule', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    await inside.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await inside.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Ms. Halloran');
    const before = await sent(page);
    await apply(page, 'deleteTeacher', { id: 'tsample001' });
    await fedAfter(page, before);
    await inside.waitForFunction(() => document.querySelector('h1').textContent === 'Not in this schedule', { timeout: 15000 });
    assert.match(await inside.evaluate(() => document.getElementById('app').textContent), /This copy of the schedule has no teacher at this address\. It may be from an older or a newer copy\./);
    assert.equal(await inside.evaluate(() => location.hash), '#/teacher/tsample001');
    // undone, the page is back where it was
    const again = await sent(page);
    await page.evaluate(() => globalThis.sv2.store.undo());
    await fedAfter(page, again);
    await inside.waitForFunction(() => document.querySelector('h1').textContent === 'Ms. Halloran', { timeout: 15000 });
  });
});

test('the staff browser\'s files cannot be read: the preview says so with "Try again", and trying again brings it up', async () => {
  const session = await openPlanner({ browser, server, hash: '#building' });
  await closing(session, async (page) => {
    // the server stops answering for the staff browser's files (the connection has gone)
    await page.evaluate(() => {
      const real = globalThis.fetch.bind(globalThis);
      globalThis.__fetch = real;
      globalThis.fetch = (address, ...rest) => (/\/(staff|fonts)\//.test(String(address && address.url ? address.url : address)) ? Promise.reject(new TypeError('Failed to fetch')) : real(address, ...rest));
    });
    await go(page, '#staff');
    await page.waitForFunction(() => document.querySelector('.stf-preview')?.dataset.preview === 'failed', { timeout: 30000 });
    const failed = await page.evaluate(() => ({
      says: document.querySelector('[data-says="preview"]').textContent,
      again: document.querySelector('[data-action="preview-again"]').hidden,
      label: document.querySelector('[data-action="preview-again"]').textContent,
      src: document.querySelector('.stf-frame').getAttribute('src'),
      sent: document.querySelector('.stf-preview').dataset.sent,
    }));
    assert.equal(failed.again, false);
    assert.equal(failed.label, 'Try again');
    assert.equal(failed.says, 'The preview could not be put together: the staff browser\'s files could not be read. Check the connection and try again.', 'a sentence of the tool\'s own, not the browser\'s "Failed to fetch"');
    assert.equal(failed.src, null, 'no page was made');
    assert.equal(failed.sent, '0');
    // and a file cannot be made either: the form says so and notes nothing
    assert.equal(await publishThroughHook(page), null);
    assert.equal(await says(page, 'published'), 'The file could not be made, so nothing was published. Check the connection and try again.');
    assert.equal((await project(page)).publish.lastPublishedAt, null);

    await page.evaluate(() => { globalThis.fetch = globalThis.__fetch; });
    await page.click('[data-action="preview-again"]');
    await previewLive(page);
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="preview-again"]').hidden), true);
    await frameOf(page).waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
    assert.equal(await says(page, 'preview'), 'This is the file as staff see it. It follows the project as you change it.');
  });
});

test('a tab that cannot change the project: each control on the form goes back to what the project holds, and the tab says why once', async () => {
  const first = await open();
  let second = null;
  try {
    await apply(first.page, 'setSetting', { key: 'schoolName', value: 'First Tab School' });
    await first.page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });
    second = await open({ keep: true });
    const page = second.page;
    await page.waitForSelector('#banner-read-only');
    const held = await project(page);
    assert.equal(held.publish.passcode, DEFAULT);

    // a tick box
    await openFold(page);
    await page.click('.pub input[data-view="coverage"]');
    await page.waitForFunction(() => document.querySelector('.toast .toast__text'));
    assert.equal(await page.$eval('.toast .toast__text', (el) => el.textContent), 'Nothing changed: this tab is read-only while the project is open in another tab.');
    assert.equal(await page.evaluate(() => document.querySelector('.pub input[data-view="coverage"]').checked), true, 'the box is ticked again');
    assert.equal(await says(page, 'views'), 'All 11 views');
    // the protect box: still on, the field still there
    await page.click('#publish-protect');
    assert.equal(await page.evaluate(() => document.getElementById('publish-protect').checked), true);
    assert.equal(await page.evaluate(() => document.getElementById('publish-passcode').closest('.field').hidden), false);
    // the two fields: what was typed is not left looking as if it had been taken
    await typeInto(page, '#publish-passcode', CHANGED);
    await page.waitForFunction((want) => document.getElementById('publish-passcode').value === want, { timeout: 5000 }, DEFAULT);
    await typeInto(page, '#publish-stale', '30');
    await page.waitForFunction(() => document.getElementById('publish-stale').value === '60', { timeout: 5000 });
    assert.deepEqual((await project(page)).publish, held.publish, 'and nothing in the project changed');
    assert.equal(await undoSteps(page), 0);
    assert.deepEqual(second.problems().errors, []);
    assert.deepEqual(first.problems().errors, []);
  } finally {
    if (second) await second.close();
    await first.close();
  }
});

// ---------------------------------------------------------------- SV2-45: the M4 pass on the form and the preview

const CHECKS_WAIT = 'Waiting for the checks of the project as it is now.';
const CHECKS_PENDING = 'Working out what readers will see.';
const CHECKS_FAILED = 'The checks could not be run just now, so this form cannot say what readers will see. Look at Schedule › Checks.';
const CHECKS_REFUSED = 'Nothing was published: the checks could not be run, so the file would go out with nothing said about what readers will see. Try again in a moment, or reload the page.';
const NO_ENCRYPTION = 'This browser cannot open a locked file here: it has no encryption for pages opened this way. Open the file in Safari, Chrome, Edge or Firefox.';

// 7A into the room 6A already has in Period 3: a second problem readers will see.
const secondProblem = (page) => page.evaluate(() => {
  const school = globalThis.sv2.store.project;
  const day = school.dayTypes[0].id;
  const six = school.groups.find((group) => group.name === '6A');
  return { dayTypeId: day, period: 2, slot: { room: six.days[day][2].room }, groupId: school.groups.find((group) => group.name === '7A').id };
});

// Every answer from the checks comes `ms` late from here on.
const lateChecks = (page, ms) => page.evaluate((late) => {
  const engine = globalThis.sv2.store.derived.engine;
  const results = engine.results.bind(engine);
  engine.results = () => results().then((result) => new Promise((resolve) => { setTimeout(() => resolve(result), late); }));
}, ms);

// Press Publish without waiting for it: what the form says in the same turn.
// The file, when it comes, is taken by the hook, which also notes what the
// list held at that moment; `publishHeld` collects it.
const pressPublish = (page) => page.evaluate(() => {
  const view = document.querySelector('.stf').staff;
  const pub = document.querySelector('.pub');
  globalThis.__handed = null;
  view.hooks.deliver = (published) => {
    globalThis.__handed = {
      pending: pub.dataset.checksPending || null,
      lines: Array.from(document.querySelectorAll('.pub__checks li'), (el) => el.textContent),
      checks: pub.dataset.checks,
      periodThree: published.model.groups.find((group) => group.name === '7A').days[published.model.dayTypes[0].id][2].room,
    };
    return { fileName: published.fileName, bytes: published.html.length };
  };
  globalThis.__press = view.form.publish().finally(() => { view.hooks.deliver = null; });
  return {
    pending: pub.dataset.checksPending || null,
    says: document.querySelector('[data-says="published"]').textContent,
    busy: document.querySelector('.pub__checks').getAttribute('aria-busy'),
    disabled: document.getElementById('publish-file').getAttribute('aria-disabled'),
  };
});
const publishHeld = (page) => page.evaluate(() => globalThis.__press.then((published) => ({ made: published !== null, handed: globalThis.__handed })));

test('Publish waits for the checks of the project it publishes: a press while they are on their way is held, says so, and the file goes out beside its own list', async () => {
  await closing(await open(), async (page) => {
    await lateChecks(page, 1500);
    const slot = await secondProblem(page);
    assert.deepEqual(await checkLines(page), [ROOM_203]);

    // a second problem, and Publish pressed before its checks have answered
    await apply(page, 'setSlot', slot);
    const during = await pressPublish(page);
    assert.deepEqual(during, { pending: 'true', says: CHECKS_WAIT, busy: 'true', disabled: 'true' });
    // an answer that takes this long has words in the list's own place
    await page.waitForFunction((words) => {
      const line = document.querySelector('[data-says="checks-summary"]');
      return !line.hidden && line.textContent === words;
    }, { timeout: 5000 }, CHECKS_PENDING);
    assert.deepEqual(await checkLines(page), [ROOM_203], 'the lines of the project before stay until the answer, marked busy');
    const first = await publishHeld(page);
    assert.equal(first.made, true);
    assert.deepEqual(first.handed, { pending: null, lines: [ROOM_203, ROOM_101], checks: '2', periodThree: slot.slot.room }, 'when the file was handed over, the list was the list of the project in it');
    assert.match(await says(page, 'published'), /^Published /);
    // (noting the publish time is a change too, so the list is asked for once more)
    await checksDrawn(page);
    assert.equal(await page.evaluate(() => document.querySelector('.pub__checks').getAttribute('aria-busy')), null);

    // the project changes again while the press is held: the file is the last project's, and so is the list
    await apply(page, 'setSlot', { ...slot, slot: { room: null } });
    assert.equal((await pressPublish(page)).says, CHECKS_WAIT);
    await apply(page, 'setSlot', slot);
    await page.evaluate(() => globalThis.sv2.store.undo());
    await page.evaluate(() => globalThis.sv2.store.undo());
    const second = await publishHeld(page);
    assert.equal(second.made, true);
    assert.deepEqual(second.handed, { pending: null, lines: [ROOM_203, ROOM_101], checks: '2', periodThree: slot.slot.room });

    // with the answer already drawn a press waits for nothing
    await checksDrawn(page);
    const settled = await pressPublish(page);
    assert.equal(settled.pending, null);
    assert.equal(settled.says, 'Putting the file together.');
    assert.equal((await publishHeld(page)).made, true);
  });
});

// The real engine client (ui/engine-client.js) on a worker this case can
// make refuse: every request reaches the real module worker, except while
// `__worker.refuse` is set, when it is answered the way engine/worker.js
// answers a run that threw. Nothing of the client is replaced, so what it
// remembers of a failed run is what a person's browser would remember.
const refusingWorker = (page) => page.evaluate(async () => {
  const { engineFor } = await import(new URL('ui/engine-client.js', location.href).href);
  const { ANSWER } = await import(new URL('engine/worker.js', location.href).href);
  const store = globalThis.sv2.store;
  engineFor(store).close();
  const state = { refuse: false, posted: 0, refused: 0 };
  globalThis.__worker = state;
  const listeners = [];
  const start = () => {
    const made = new Worker(new URL('engine/worker.js', location.href), { type: 'module' });
    for (const [type, listener] of listeners) made.addEventListener(type, listener);
    return made;
  };
  let real = start();
  engineFor(store, {
    worker: () => ({
      addEventListener(type, listener) {
        listeners.push([type, listener]);
        real.addEventListener(type, listener);
      },
      terminate() {
        real.terminate();
      },
      postMessage(message) {
        state.posted += 1;
        if (!state.refuse) {
          real.postMessage(message);
          return;
        }
        state.refused += 1;
        // a worker that failed has forgotten what it sent: this one starts again
        real.terminate();
        real = start();
        setTimeout(() => {
          for (const [type, listener] of listeners) if (type === 'message') listener({ data: { type: ANSWER, generation: message.generation, ok: false, error: 'The worker has gone.' } });
        }, 0);
      },
    }),
  });
});
const workerSaw = (page) => page.evaluate(() => ({ ...globalThis.__worker }));

test('the checks cannot be run: the lines of the project before are cleared, Publish asks the worker again and refuses with a sentence, and publishes once it answers, with no edit and no reload', async () => {
  await closing(await open(), async (page) => {
    assert.deepEqual(await checkLines(page), [ROOM_203]);
    await refusingWorker(page);
    await page.evaluate(() => { globalThis.__worker.refuse = true; });
    await apply(page, 'setSlot', await secondProblem(page));
    await checksDrawn(page);
    assert.deepEqual(await checkLines(page), [], 'the line of the project before does not stand beside a run that gave no answer');
    assert.equal(await page.evaluate(() => document.querySelector('.pub__checks').hidden), true);
    assert.equal(await says(page, 'checks-summary'), CHECKS_FAILED);
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.checks), 'none');
    const before = await workerSaw(page);
    assert.ok(before.refused >= 1);

    // Publish asks for them again (twice: a refusal is tried once more) and refuses.
    // Each asking reaches the worker: the client does not hand back the run that failed.
    assert.equal(await publishThroughHook(page), null);
    assert.equal(await says(page, 'published'), CHECKS_REFUSED);
    const after = await workerSaw(page);
    assert.equal(after.posted - before.posted, 2, 'the press asked the worker again, and once more');
    assert.equal(after.refused - before.refused, 2);
    assert.equal(await page.evaluate(() => document.querySelector('.stf').staff.hooks.published), null, 'no file was made');
    assert.equal((await project(page)).publish.lastPublishedAt, null);
    assert.equal(await page.evaluate(() => document.getElementById('publish-file').getAttribute('aria-disabled')), null, 'the button can be pressed again');

    // the worker answers again: the next press, with nothing edited, runs the checks, draws the list and publishes
    await page.evaluate(() => { globalThis.__worker.refuse = false; });
    const made = await publishThroughHook(page);
    assert.ok(made && made.fileName.endsWith('.html'), 'a file was made on the press after the failure');
    assert.deepEqual(await checkLines(page), [ROOM_203, ROOM_101]);
    assert.match(await says(page, 'published'), /^Published /);
    assert.equal((await workerSaw(page)).posted - after.posted >= 1, true);
  });
});

const MOVED_ON = 'The schedule changed while the file was being made. The file is of the schedule as it was when Publish was pressed, and the changes made since are not in it: publish again to send them.';
const NOT_NOTED = 'The project could not record that a file was made.';

// Press Publish and stop the file between its making and its handing over,
// so a case can change the project in the gap. `letGo` hands it over and
// gives what went out and what the form held at that moment.
const pressAndHold = (page) => page.evaluate(async () => {
  const view = document.querySelector('.stf').staff;
  const pub = document.querySelector('.pub');
  const gate = {};
  globalThis.__gate = gate;
  const made = new Promise((resolve) => { gate.made = resolve; });
  view.hooks.assembled = () => {
    gate.made();
    return new Promise((resolve) => { gate.open = resolve; });
  };
  view.hooks.deliver = (published) => {
    const day = published.model.dayTypes[0].id;
    gate.handed = {
      periodThree: published.model.groups.find((group) => group.name === '7A').days[day][2].room,
      publishedAt: published.model.publishedAt,
      lines: Array.from(document.querySelectorAll('.pub__checks li'), (el) => el.textContent),
      pending: pub.dataset.checksPending || null,
    };
    return { fileName: published.fileName, bytes: published.html.length };
  };
  gate.press = view.form.publish().finally(() => {
    view.hooks.deliver = null;
    view.hooks.assembled = null;
  });
  await made;
});
const letGo = (page) => page.evaluate(async () => {
  globalThis.__gate.open();
  const published = await globalThis.__gate.press;
  return { made: published !== null, ...globalThis.__gate.handed };
});
const periodThree = (page) => page.evaluate(() => {
  const school = globalThis.sv2.store.project;
  return school.groups.find((group) => group.name === '7A').days[school.dayTypes[0].id][2].room;
});

test('the project changes while the file is being made: the file is of the project Publish was pressed on, the status says so, the list is the screen\'s, and the publish is noted', async () => {
  await closing(await open(), async (page) => {
    const slot = await secondProblem(page);
    const pressedOn = await periodThree(page);
    assert.notEqual(pressedOn, slot.slot.room);
    assert.deepEqual(await checkLines(page), [ROOM_203]);

    await pressAndHold(page);
    // the file is made and not yet handed over: a second problem goes into the schedule
    await apply(page, 'setSlot', slot);
    await checksDrawn(page);
    assert.deepEqual(await checkLines(page), [ROOM_203, ROOM_101]);
    const first = await letGo(page);
    assert.equal(first.made, true, 'the file still goes out');
    assert.equal(first.periodThree, pressedOn, 'the file holds the schedule as it was when Publish was pressed');
    const status = await says(page, 'published');
    assert.match(status, /^Published /);
    assert.ok(status.includes('. ' + MOVED_ON + ' ' + NOT_SENT + ' It asks for the staff passcode: '), status);
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.publishedOf), 'earlier');
    // the edit is still in the project, the publish time is noted on it, and the list is that project's
    assert.equal(await periodThree(page), slot.slot.room);
    assert.equal((await project(page)).publish.lastPublishedAt, first.publishedAt);
    await checksDrawn(page);
    assert.deepEqual(await checkLines(page), [ROOM_203, ROOM_101], 'the list is of the project on screen, not of the file');
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.checks), '2');

    // pressed again with nothing changing meanwhile: the later change is in the file and nothing is said about an earlier schedule
    await pressAndHold(page);
    const second = await letGo(page);
    assert.equal(second.periodThree, slot.slot.room);
    assert.deepEqual(second.lines, [ROOM_203, ROOM_101]);
    const next = await says(page, 'published');
    assert.ok(!next.includes('as it was when Publish was pressed'), next);
    assert.ok(next.includes('). ' + NOT_SENT + ' It asks for the staff passcode: '), next);
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.publishedOf), undefined);
  });
});

// SV2-51 item 2. A theme, a paper size or a planner-only setting changed
// while the file is being made is a new project object, and until SV2-51
// that alone made the status say the schedule changed. It says so only when
// something a reader would see changed (preview.js's partsOf and sameParts).
test('a theme, a paper size or a head count changed while the file is being made: nothing a reader sees changed, and the status says nothing about an earlier schedule', async () => {
  await closing(await open(), async (page) => {
    await pressAndHold(page);
    const before = await page.evaluate(() => globalThis.sv2.store.project);
    await apply(page, 'setSetting', { key: 'theme', value: 'dark' });
    await apply(page, 'setSetting', { key: 'paper.size', value: 'a4' });
    await apply(page, 'setSetting', { key: 'defaultHeadCount', value: 31 });
    const after = await page.evaluate(() => globalThis.sv2.store.project);
    assert.notDeepEqual(after.settings, before.settings, 'the project did change');
    const out = await letGo(page);
    assert.equal(out.made, true);
    const status = await says(page, 'published');
    assert.ok(!status.includes(MOVED_ON), status);
    assert.ok(status.includes('). ' + NOT_SENT + ' It asks for the staff passcode: '), status);
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.publishedOf), undefined);
    // and a setting the file carries, changed in the gap, is said
    await pressAndHold(page);
    await apply(page, 'setSetting', { key: 'periodWord', value: 'Hour' });
    await letGo(page);
    assert.ok((await says(page, 'published')).includes('. ' + MOVED_ON + ' '), 'the period word is on every page of the file');
    assert.equal(await page.evaluate(() => document.querySelector('.pub').dataset.publishedOf), 'earlier');
  });
});

test('the file went out and the project then would not record it: the status says Published and that it is not recorded, never that nothing was published', async () => {
  await closing(await open(), async (page) => {
    await page.evaluate(async () => {
      const { notePublished } = await import(new URL('engine/actions.js', location.href).href);
      const store = globalThis.sv2.store;
      const apply = store.apply;
      globalThis.__thrown = 0;
      store.apply = function (action, payload) {
        if (action === notePublished) {
          globalThis.__thrown += 1;
          throw new Error('The project would not take the note.');
        }
        return apply.call(store, action, payload);
      };
    });
    const made = await publishThroughHook(page);
    assert.equal(await page.evaluate(() => globalThis.__thrown), 1, 'the note was offered to the project, which threw');
    assert.ok(made && made.fileName.endsWith('.html'), 'the file was handed over');
    const status = await says(page, 'published');
    assert.ok(status.startsWith('Published ' + made.fileName + ' ('), status);
    assert.ok(status.includes(NOT_SENT + ' ' + NOT_NOTED + ' It asks for the staff passcode: '), status);
    assert.ok(!/nothing was published/i.test(status), status);
    assert.equal((await project(page)).publish.lastPublishedAt, null);
    assert.notEqual(await page.evaluate(() => document.querySelector('.stf').staff.hooks.published), null);
  });
});

test('a file or a preview that could not be made says the tool\'s own sentence when it has one, the form and the preview alike, and the cause is in the console', async () => {
  const session = await open();
  const warned = [];
  session.page.on('console', (message) => {
    if (message.type() === 'warn' || message.type() === 'warning') warned.push(message.text());
  });
  await closing(session, async (page) => {
    // a page with no encryption, as on a plain http address that is not this machine's own
    await page.evaluate(() => {
      Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, get: () => globalThis.__subtle });
      globalThis.__subtle = undefined;
    });
    assert.equal(await publishThroughHook(page), null);
    assert.equal(await says(page, 'published'), NO_ENCRYPTION, 'not "Check the connection": the connection is fine');
    assert.equal((await project(page)).publish.lastPublishedAt, null);
    // the locked preview needs the same lock, and says the same
    await page.click('.stf-bar .stf-check');
    await page.waitForFunction(() => document.querySelector('.stf-preview').dataset.previewSays === 'stale', { timeout: 15000 });
    assert.equal(await says(page, 'preview'), 'The preview could not be brought up to date. ' + NO_ENCRYPTION);
    assert.ok(warned.some((text) => text.includes('the file could not be made')), 'the cause of the failed file is logged: ' + warned.join(' | '));
    assert.ok(warned.some((text) => text.includes('the preview could not be brought up to date')), 'and the preview\'s');

    // something the browser threw in its own words is not shown, and is not blamed on the connection
    await page.evaluate(() => {
      Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, get: () => { throw new TypeError('Illegal invocation'); } });
    });
    assert.equal(await publishThroughHook(page), null);
    assert.equal(await says(page, 'published'), 'The file could not be made, so nothing was published. Reload the page and try again.');

    // with encryption back, both recover
    await page.evaluate(() => { delete globalThis.crypto.subtle; });
    const before = await sent(page);
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran again' });
    await fedAfter(page, before);
    assert.equal(await page.evaluate(() => document.querySelector('.stf-preview').dataset.previewSays), undefined);
    assert.ok(await publishThroughHook(page));
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

test('"Start at the passcode screen" reaches a key the frame could only keep in its memory: the screen is shown the second time too', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    // the frame's storage refuses every write, as a file opened from a mail app's own viewer does
    await inside.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    });
    const kept = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sv2staff:') && key.endsWith(':key')).length);
    for (const time of ['the first time', 'the second time']) {
      const before = await sent(page);
      await page.click('.stf-bar .stf-check');
      await fedAfter(page, before);
      await frameState(inside, 'locked');
      assert.match(await inside.evaluate(() => document.body.textContent), /Enter the staff passcode\./, time);
      await unlockIn(inside, DEFAULT);
      await frameState(inside, 'open');
      assert.equal(await kept(), 0, time + ': the key is nowhere but the frame\'s memory');
      // and it is kept there: a change to the project does not ask again
      const fed = await sent(page);
      await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran ' + time });
      await fedAfter(page, fed);
      await frameState(inside, 'open');
      const again = await sent(page);
      await page.click('.stf-bar .stf-check');
      await fedAfter(page, again);
      await frameState(inside, 'open');
    }
  });
});

test('a read-only tab publishes its file and says nothing false: no "Nothing changed", the status and the section\'s first line say the project does not record it', async () => {
  const first = await open();
  let second = null;
  try {
    await apply(first.page, 'setSetting', { key: 'schoolName', value: 'First Tab School' });
    await first.page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 10000 });
    second = await open({ keep: true });
    const page = second.page;
    await page.waitForSelector('#banner-read-only');
    assert.match(await page.evaluate(() => document.querySelector('.stf-facts').textContent), /^No file has been made from this project yet\./);
    const made = await publishThroughHook(page);
    assert.ok(made && made.fileName.startsWith('First Tab School - staff schedule - '));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.toast').length), 0, 'no toast says "Nothing changed" about a file that was made');
    const status = await says(page, 'published');
    assert.ok(status.startsWith('Published ' + made.fileName + ' ('), status);
    assert.ok(status.includes(NOT_SENT + ' This tab is read-only, so the project does not record that a file was made. It asks for the staff passcode: '), status);
    assert.equal((await project(page)).publish.lastPublishedAt, null, 'the project was not changed');
    assert.match(await page.evaluate(() => document.querySelector('.stf-facts').textContent), /^This tab made a file just now\. The project does not record it while the tab is read-only\. It has /);
    assert.deepEqual(second.problems().errors, []);
  } finally {
    if (second) await second.close();
    await first.close();
  }
});

test('"What is in it": the line has a mark that turns when it opens, a separator in its name, and says when the map carries no names', async () => {
  await closing(await open(), async (page) => {
    const mark = () => page.evaluate(() => {
      const summary = document.querySelector('#publish-contents > summary');
      const style = getComputedStyle(summary, '::before');
      return { content: style.content, width: style.borderLeftWidth, transform: style.transform, text: summary.textContent, list: getComputedStyle(summary).listStyleType };
    });
    const folded = await mark();
    assert.equal(folded.text, 'What is in it · All 11 views');
    assert.equal(folded.content, '""', 'the mark is drawn');
    assert.equal(folded.width, '7px');
    assert.equal(folded.transform, 'none');
    assert.equal(folded.list, 'none', 'one mark, not the browser\'s as well');
    await openFold(page);
    const open_ = await mark();
    assert.notEqual(open_.transform, 'none', 'the mark points down when the line is open');
    await page.click('.pub input[name="names"]');
    await page.waitForFunction(() => document.querySelector('[data-says="views"]').textContent === 'All 11 views, no teacher names on the map');
    await page.click('.pub input[data-view="coverage"]');
    await page.waitForFunction(() => document.querySelector('[data-says="views"]').textContent === '10 of 11 views, no teacher names on the map');
    await page.click('.pub input[name="names"]');
    await page.waitForFunction(() => document.querySelector('[data-says="views"]').textContent === '10 of 11 views');
  });
});

test('the published file\'s name never breaks inside its day, however long the school\'s name, and the name is on the line whole', async () => {
  await closing(await open(), async (page) => {
    const seen = new Set();
    // each name is one letter longer, so the day meets the edge of the line at every offset
    for (let extra = 0; extra < 14; extra += 1) {
      const name = 'Marrowby Middle ' + 'm'.repeat(extra) + ' School';
      await apply(page, 'setSetting', { key: 'schoolName', value: name });
      const made = await publishThroughHook(page);
      const laid = await page.evaluate(() => {
        const file = document.querySelector('[data-says="published-file"]');
        const day = file.querySelector('.pub__file-day');
        const status = document.querySelector('[data-says="published"]');
        return { text: file.textContent, day: day.textContent, lines: day.getClientRects().length, over: status.scrollWidth > status.clientWidth, fileLines: file.getClientRects().length };
      });
      assert.equal(laid.text, made.fileName);
      assert.match(laid.day, /^\d{4}-\d{2}-\d{2}\.html$/);
      assert.equal(laid.lines, 1, name + ': the day is on one line');
      assert.equal(laid.over, false, name + ': and nothing runs off the form');
      seen.add(laid.fileLines);
    }
    assert.ok(seen.size > 1, 'the names tried did move the break: ' + Array.from(seen).join(', ') + ' lines');
  });
});

test('a preview that was given its page and never opened says so with "Try again", which makes the page anew and lets the one before it go', async () => {
  const session = await openPlanner({ browser, server, hash: '#building' });
  await closing(session, async (page) => {
    await page.evaluate(async () => {
      const { PREVIEW_TIMES } = await import(new URL('ui/staff/preview.js', location.href).href);
      PREVIEW_TIMES.open = 600;
      // the first page the frame is given never asks for its data: a blank page stands in for one that failed to start
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      globalThis.__made = [];
      globalThis.__revoked = [];
      URL.createObjectURL = (blob) => {
        const address = create(globalThis.__made.length === 0 && blob.type.startsWith('text/html') ? new Blob(['<!doctype html><title>blank</title>'], { type: 'text/html' }) : blob);
        if (blob.type.startsWith('text/html')) globalThis.__made.push(address);
        return address;
      };
      URL.revokeObjectURL = (address) => {
        globalThis.__revoked.push(address);
        revoke(address);
      };
    });
    await go(page, '#staff');
    await page.waitForFunction(() => document.querySelector('.stf-preview')?.dataset.preview === 'failed', { timeout: 30000 });
    assert.equal(await says(page, 'preview'), 'The preview has not opened. Try again; publishing a file does not depend on it.');
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="preview-again"]').getClientRects().length > 0), true, 'the button is on screen');
    const first = await page.evaluate(() => document.querySelector('.stf-frame').src);
    await page.click('[data-action="preview-again"]');
    await previewLive(page);
    assert.deepEqual(await page.evaluate(() => globalThis.__revoked.filter((address) => globalThis.__made.includes(address))), [first], 'the page that never opened is let go, by a press a person can make');
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="preview-again"]').hidden), true);
    await frameOf(page).waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
    // and a file was never held up by it
    assert.ok(await publishThroughHook(page));
  });
});

// SV2-49 item 6
test('a preview whose page opened and could not be given its data keeps the sentence that says why: the wait for it to open ends when the page asks, and "has not opened" never follows', async () => {
  const session = await openPlanner({ browser, server, hash: '#building' });
  await closing(session, async (page) => {
    await page.evaluate(async () => {
      const { PREVIEW_TIMES } = await import(new URL('ui/staff/preview.js', location.href).href);
      PREVIEW_TIMES.open = 2500;
      // no encryption: the locked copy cannot be made
      Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, get: () => undefined });
      // the passcode screen is asked for the moment the section is drawn, before its first copy is made
      location.hash = '#staff';
      await new Promise((resolve) => {
        const look = () => {
          const box = document.querySelector('.stf-bar .stf-check input');
          if (!box) return void requestAnimationFrame(look);
          box.click();
          resolve();
        };
        look();
      });
    });
    // the page has opened and asked (the wait is over) with the reason on screen
    await page.waitForFunction(() => {
      const preview = document.querySelector('.stf-preview');
      return preview.dataset.previewSays === 'stale' && preview.dataset.waiting === undefined && document.querySelector('.stf').staff.preview.state.loaded;
    }, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelector('.stf').staff.preview.state.opened), true, 'the frame\'s page asked for its data');
    assert.equal(await page.evaluate(() => document.querySelector('.stf').staff.preview.state.sent), 0, 'and was given none');
    assert.equal(await says(page, 'preview'), 'The preview could not be brought up to date. ' + NO_ENCRYPTION);
    assert.notEqual(await page.evaluate(() => document.querySelector('.stf-preview').dataset.preview), 'failed', 'the wait did not run out on a page that had opened');
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="preview-again"]').hidden), true);

    // with encryption back the next change reaches the page that has been waiting
    await page.evaluate(() => { delete globalThis.crypto.subtle; });
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran again' });
    await previewLive(page);
    assert.equal(await page.evaluate(() => document.querySelector('.stf-preview').dataset.previewSays), undefined);
    await frameOf(page).waitForFunction(() => document.getElementById('app').dataset.state === 'locked', { timeout: 30000 });
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

// SV2-49 item 9
test('a map\'s listeners leave when its page gives way to a screen that is not a schedule: a copy the frame cannot read, and the passcode screen', async () => {
  await closing(await open(), async (page) => {
    const frame = frameOf(page);
    await frame.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 30000 });
    // count what listens for printing and for a change of media inside the frame, from here on
    await frame.evaluate(() => {
      const held = { beforeprint: 0, afterprint: 0, change: 0 };
      globalThis.sv2Held = held;
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      window.addEventListener = (type, ...rest) => {
        if (type === 'beforeprint' || type === 'afterprint') held[type] += 1;
        return add(type, ...rest);
      };
      window.removeEventListener = (type, ...rest) => {
        if (type === 'beforeprint' || type === 'afterprint') held[type] -= 1;
        return remove(type, ...rest);
      };
      const queryAdd = MediaQueryList.prototype.addEventListener;
      const queryRemove = MediaQueryList.prototype.removeEventListener;
      MediaQueryList.prototype.addEventListener = function added(type, ...rest) {
        if (type === 'change') held.change += 1;
        return queryAdd.call(this, type, ...rest);
      };
      MediaQueryList.prototype.removeEventListener = function removed(type, ...rest) {
        if (type === 'change') held.change -= 1;
        return queryRemove.call(this, type, ...rest);
      };
    });
    const held = () => frame.evaluate(() => ({ ...globalThis.sv2Held }));
    const onMap = async () => {
      await frame.waitForFunction(() => document.getElementById('app').dataset.state === 'open' && document.querySelector('.page[data-view="map"] .map canvas') !== null, { timeout: 30000 });
    };
    await frame.evaluate(() => { location.hash = '#/map/fsample001'; });
    await onMap();
    assert.deepEqual(await held(), { beforeprint: 1, afterprint: 1, change: 2 }, 'the map on the page listens on the window twice and on two media queries');

    // a copy in a format this staff browser does not know: the page gives way to the card that says so
    await page.evaluate(() => {
      const inner = document.querySelector('.stf-frame').contentWindow;
      inner.postMessage({ type: 'sv2-published', data: { format: 'sv2-published', version: 99 } }, location.origin);
    });
    await frame.waitForFunction(() => document.getElementById('app').dataset.state === 'newer', { timeout: 15000 });
    assert.deepEqual(await held(), { beforeprint: 0, afterprint: 0, change: 0 }, 'nothing of the map is left listening behind the card');

    // the schedule again, on its map; then the passcode screen takes its place
    const before = await sent(page);
    await apply(page, 'editTeacher', { id: 'tsample001', name: 'Ms. Halloran again' });
    await fedAfter(page, before);
    await onMap();
    assert.deepEqual(await held(), { beforeprint: 1, afterprint: 1, change: 2 });
    await page.click('.stf-bar .stf-check');
    await frame.waitForFunction(() => document.getElementById('app').dataset.state === 'locked', { timeout: 30000 });
    assert.deepEqual(await held(), { beforeprint: 0, afterprint: 0, change: 0 }, 'nor behind the passcode screen');
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sv2staff:')) localStorage.removeItem(key);
    });
  });
});

// ---------------------------------------------------------------- batch printing

test('batch printing: each button opens the preview sheet on one document, a sheet per teacher or room after the cover', async () => {
  await closing(await open(), async (page) => {
    assert.equal(await says(page, 'batch'), 'One document each, a sheet for every teacher or room after a cover sheet: 12 teachers, 13 rooms. Choose "Save as PDF" in the print dialog for one file.');
    const expected = [
      ['teacher-schedules', 'Print every teacher’s schedule', 'Teacher schedules', 12, 'teacher'],
      ['door-signs', 'Print every door sign', 'Door signs', 13, 'door'],
      ['door-signs-day', 'Print every door sign with the room’s day', 'Door signs with each room’s day', 13, 'door'],
    ];
    for (const [output, label, what, sheets, kind] of expected) {
      const selector = '.pub [data-print="' + output + '"]';
      assert.equal(await page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector), label, 'the button for ' + output);
      await page.click(selector);
      await page.waitForSelector('#print-preview[open][data-ready="true"]');
      const shown = await page.evaluate(() => {
        const sheet = document.getElementById('print-preview');
        const doc = sheet.querySelector('iframe').contentDocument;
        const view = sheet.querySelector('iframe').contentWindow;
        const number = doc.querySelector('.sign__number');
        const day = doc.querySelector('.batch-days, .sign__day');
        return {
          output: sheet.dataset.output,
          sheets: Number(sheet.dataset.sheets),
          what: doc.querySelector('.doc-head__what').textContent,
          school: doc.querySelector('.doc-head__school').textContent,
          newSheets: Array.from(doc.querySelectorAll('.new-sheet'), (el) => el.dataset.sheet),
          breaks: Array.from(doc.querySelectorAll('.new-sheet'), (el) => view.getComputedStyle(el).breakBefore),
          numberPx: number ? parseFloat(view.getComputedStyle(number).fontSize) : null,
          // how many kinds of day stand side by side: the tables that start on the first one's line
          columns: day ? Array.from(day.children).filter((kind) => Math.abs(kind.getBoundingClientRect().top - day.children[0].getBoundingClientRect().top) < 1).length : null,
          // as paper: without the dashed line and the room under it that the preview draws where a sheet starts
          tallest: Math.max(...Array.from(doc.querySelectorAll('.new-sheet'), (el) => el.getBoundingClientRect().height - parseFloat(view.getComputedStyle(el).paddingTop) - parseFloat(view.getComputedStyle(el).borderTopWidth))),
          scripts: doc.scripts.length,
        };
      });
      assert.equal(shown.output, output);
      assert.equal(shown.what, what);
      assert.equal(shown.school, SCHOOL);
      assert.deepEqual(shown.newSheets, new Array(sheets).fill(kind), output + ': one new sheet each');
      assert.ok(shown.breaks.every((value) => value === 'page'), output + ': each starts a sheet of paper');
      assert.equal(shown.sheets, sheets + 1, output + ': the cover and one sheet each, none running on to a second');
      // a US Letter sheet's printable height is 251.4 mm, 950 px
      assert.ok(shown.tallest < 950, output + ': the tallest sheet fits the paper: ' + shown.tallest);
      if (kind === 'door') assert.equal(shown.numberPx, 160, 'the room number at 120 pt');
      if (output !== 'door-signs') assert.equal(shown.columns, 2, output + ': the two day types side by side');
      assert.equal(shown.scripts, 0);
      await page.click('#print-preview [data-action="close"]');
      await page.waitForFunction(() => document.getElementById('print-preview') === null);
      assert.equal(await page.evaluate((s) => document.activeElement === document.querySelector(s), selector), true, 'focus is back on the button');
    }
  });
});

// What the preview sheet says of the document on show.
const previewOf = (page) => page.evaluate(() => {
  const sheet = document.getElementById('print-preview');
  const doc = sheet.querySelector('iframe').contentDocument;
  const view = sheet.querySelector('iframe').contentWindow;
  const papers = Array.from(doc.querySelectorAll('.new-sheet'), (el) => el.getBoundingClientRect().height - parseFloat(view.getComputedStyle(el).paddingTop) - parseFloat(view.getComputedStyle(el).borderTopWidth));
  return {
    sheets: Number(sheet.dataset.sheets),
    paper: sheet.dataset.paper,
    status: sheet.querySelector('.preview__status').textContent,
    signs: doc.querySelectorAll('[data-sheet="door"]').length,
    tallest: Math.round(Math.max(...papers)),
    root: doc.documentElement.dataset.orientation,
    rule: doc.getElementById('page-size').textContent,
    lead: doc.querySelector('.doc-lead').textContent,
    turn: sheet.querySelectorAll('.preview__head input[type="radio"]').length,
    upright: sheet.querySelector('[data-says="upright"]') ? sheet.querySelector('[data-says="upright"]').textContent : null,
  };
});

async function openBatch(page, output) {
  await page.click('.pub [data-print="' + output + '"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
}

async function closeBatch(page) {
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
}

// Choose a paper size in the open sheet and wait for the document drawn on it.
async function choosePaper(page, size) {
  await page.evaluate((value) => {
    const radio = document.querySelector('#print-preview .preview__head input[type="radio"][value="' + value + '"]');
    radio.click();
  }, size);
  await page.waitForFunction((value) => {
    const sheet = document.getElementById('print-preview');
    return sheet.dataset.ready === 'true' && sheet.dataset.paper.startsWith(value + ' ');
  }, { timeout: 15000 }, size);
}

test('the preview counts the sheets that go on paper: a door sign with ten periods, or with a thirty-character number and the room\'s day, is one sheet at Letter and at A4', async () => {
  await closing(await open(), async (page) => {
    // ten periods a day: the sign's day is two rows longer on each kind of day
    await apply(page, 'setSetting', { key: 'periods', value: 10 });
    await openBatch(page, 'door-signs-day');
    for (const [size, most] of [['letter', 950], ['a4', 1017]]) {
      await choosePaper(page, size);
      const shown = await previewOf(page);
      assert.equal(shown.signs, 13);
      assert.ok(shown.tallest <= most, size + ', ten periods: the tallest sign is ' + shown.tallest + ' px of paper, and a sheet holds ' + most);
      assert.equal(shown.sheets, 14, size + ', ten periods: the cover and one sheet a sign: ' + shown.status);
      assert.match(shown.status, /About 14 sheets\.$/);
    }
    await closeBatch(page);

    // a number of thirty characters wraps to a second and third line of the sign
    const room = await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].spaces.find((space) => space.kind === 'room').id);
    await apply(page, 'setRoomFields', { roomId: room, number: 'PORTABLE-CLASSROOM-ANNEX-NO-12' });
    await openBatch(page, 'door-signs-day');
    for (const [size, most] of [['a4', 1017], ['letter', 950]]) {
      await choosePaper(page, size);
      const shown = await previewOf(page);
      assert.ok(shown.tallest <= most, size + ', a long number: the tallest sign is ' + shown.tallest + ' px of paper, and a sheet holds ' + most);
      assert.equal(shown.sheets, 14, size + ', a long number and ten periods: ' + shown.status);
    }
    await closeBatch(page);
    // and a document that does run on is still counted as running on: every teacher's schedule on one sheet each, plus the cover
    await openBatch(page, 'teacher-schedules');
    assert.equal((await previewOf(page)).sheets, 13);
    await closeBatch(page);
  });
});

test('door signs are upright sheets: with landscape chosen for the project the batch prints in portrait, says so, and offers no orientation; other documents keep theirs', async () => {
  await closing(await open(), async (page) => {
    await apply(page, 'setSetting', { key: 'paper.orientation', value: 'landscape' });
    const steps = await undoSteps(page);
    for (const output of ['door-signs', 'door-signs-day']) {
      await openBatch(page, output);
      const shown = await previewOf(page);
      assert.equal(shown.upright, 'Door signs are upright sheets: they print in portrait.', output);
      assert.equal(shown.turn, 2, output + ': the two paper sizes, and no orientation to choose');
      assert.equal(shown.paper, 'letter portrait');
      assert.equal(shown.root, 'portrait');
      assert.equal(shown.rule, '@page { size: letter portrait; }');
      assert.match(shown.status, /^US Letter, portrait\. About 14 sheets\.$/);
      assert.equal(shown.sheets, 14, output + ': one sheet a sign, not two across a sheet on its side');
      assert.ok(shown.lead.endsWith('Landscape is chosen for this project. Door signs are upright sheets, so these print in portrait.'), shown.lead);
      await closeBatch(page);
    }
    // the project's own setting is as it was: nothing was changed to print a sign
    assert.equal((await project(page)).settings.paper.orientation, 'landscape');
    assert.equal(await undoSteps(page), steps);
    await openBatch(page, 'teacher-schedules');
    const teachers = await previewOf(page);
    assert.equal(teachers.upright, null);
    assert.equal(teachers.turn, 4, 'two sizes and two orientations');
    assert.equal(teachers.paper, 'letter landscape');
    assert.equal(teachers.root, 'landscape');
    await closeBatch(page);
  });
});

// ---------------------------------------------------------------- hostile names

test('hostile names are text in the form, in the preview, in the batch sheets and in the file\'s name', async () => {
  const session = await open();
  const dialogs = [];
  session.page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });
  await closing(session, async (page) => {
    const inside = frameOf(page);
    const before = await sent(page);
    const roomId = await page.evaluate(() => globalThis.sv2.store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.number === '203').id);
    await apply(page, 'setSetting', { key: 'schoolName', value: HOSTILE });
    await apply(page, 'editTeacher', { id: 'tsample001', name: HOSTILE + ' T' });
    await apply(page, 'setRoomFields', { roomId, number: HOSTILE + ' R' });
    await fedAfter(page, before);
    await inside.waitForFunction((name) => document.querySelector('.top__school').textContent === name, {}, HOSTILE);
    await inside.evaluate(() => { location.hash = '#/teacher/tsample001'; });
    await inside.waitForFunction((name) => document.querySelector('h1').textContent === name, {}, HOSTILE + ' T');

    // the room's sentence carries its number as typed
    await page.waitForFunction((name) => Array.from(document.querySelectorAll('.pub__checks li')).some((li) => li.textContent.startsWith(name)), {}, HOSTILE + ' R has two groups');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pub img, .pub b, .stf img, .stf b').length), 0);

    const published = await publishThroughHook(page);
    assert.doesNotMatch(published.fileName, /[<>:"/\\|?*]/, 'a name a file system will take');
    assert.match(published.fileName, / - staff schedule - \d{4}-\d{2}-\d{2}\.html$/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pub img, .pub b').length), 0, 'the line that names the file is text');

    await page.click('.pub [data-print="door-signs-day"]');
    await page.waitForSelector('#print-preview[open][data-ready="true"]');
    const sheet = await page.evaluate(() => {
      const doc = document.querySelector('#print-preview iframe').contentDocument;
      return { number: Array.from(doc.querySelectorAll('.sign__number'), (el) => el.textContent), school: doc.querySelector('.sign__school').textContent, stray: doc.querySelectorAll('img, b, script').length };
    });
    assert.ok(sheet.number.includes(HOSTILE + ' R'));
    assert.equal(sheet.school, HOSTILE);
    assert.equal(sheet.stray, 0);
    await page.click('#print-preview [data-action="close"]');

    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    assert.equal(await inside.evaluate(() => globalThis.__pwned), undefined);
    assert.deepEqual(dialogs, []);
  });
});

// ---------------------------------------------------------------- accessibility

for (const theme of ['light', 'dark']) {
  test('axe on the section in the ' + theme + ' theme, at a desktop\'s width and a phone\'s', async () => {
    await closing(await open({ theme }), async (page) => {
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
      await axe(page, 'the Staff browser section, ' + theme + ', 1280 px');
      // with a refusal showing and protection off
      await typeInto(page, '#publish-stale', '0');
      await axe(page, 'the form with a refusal, ' + theme);
      // with what is in the file unfolded, and a file published
      await openFold(page);
      await typeInto(page, '#publish-stale', '60');
      await publishThroughHook(page);
      await axe(page, 'the form unfolded after publishing, ' + theme);
    });
    await closing(await open({ theme, width: 390, height: 760, mobile: true }), async (page) => {
      const fits = await page.evaluate(() => {
        const frame = document.querySelector('.stf-frame');
        const stage = document.querySelector('.stf-stage').getBoundingClientRect();
        return { scale: Number(frame.dataset.scale), fit: document.querySelector('.stf-fit').getBoundingClientRect().width, stage: stage.width, sideways: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(fits.scale <= 1 && fits.fit <= fits.stage + 1, 'the phone frame is scaled into a phone\'s own width: ' + JSON.stringify(fits));
      assert.equal(fits.sideways, false, 'the page does not scroll sideways');
      await axe(page, 'the Staff browser section, ' + theme + ', 390 px');
      // the form is the inspector, a sheet along the bottom at this width: open it
      await page.click('#inspector-toggle');
      await page.waitForFunction(() => document.getElementById('publish-file').getClientRects().length > 0);
      await axe(page, 'the publish form as a sheet, ' + theme + ', 390 px');
      await openFold(page);
      const targets = await page.evaluate(() => Array.from(document.querySelectorAll('.pub .stf-check, .pub .btn, .pub summary'), (el) => Math.round(el.getBoundingClientRect().height)));
      assert.equal(targets.length, 18, 'twelve boxes, the protect box, four buttons and the folded line');
      assert.ok(targets.every((height) => height >= 28), 'every target in the form is tall enough for a finger: ' + targets.join(' '));
    });
  });
}
