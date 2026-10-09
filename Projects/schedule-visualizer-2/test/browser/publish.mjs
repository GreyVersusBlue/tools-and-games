// The Staff browser section of the planner, driven in Chromium:
//   node test/browser/publish.mjs
//
// The preview frame (the assembled staff browser at a blob address, fed by
// message, live as the project changes, at a phone's width and a desktop's),
// the publish form line by line, a file published behind a changed passcode
// and opened from disk with it, a file published with protection off, the
// staff browser's files read once and good for publishing with the network
// gone, batch printing through the preview sheet, hostile names, and axe on
// the section in both themes at a desktop's width and a phone's.
//
// Each case opens the planner afresh on the sample school.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, TOOL_DIR } from './harness.mjs';

const AXE = readFileSync(path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SCHOOL = 'Marrowby Middle School (sample)';
const DEFAULT = 'bulldogs2015';
const CHANGED = 'heron-lantern-42';
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-publish-'));
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
      protect: document.getElementById('publish-protect').checked,
      passcode: document.getElementById('publish-passcode').value,
      passcodeAttrs: ['type', 'autocapitalize', 'autocorrect', 'autocomplete', 'spellcheck'].map((name) => document.getElementById('publish-passcode').getAttribute(name)),
      described: document.getElementById(document.getElementById('publish-passcode').getAttribute('aria-describedby')).textContent,
      button: document.getElementById('publish-file').textContent,
      headings: Array.from(document.querySelectorAll('.pub h2'), (el) => el.textContent),
    }));
    assert.deepEqual(form.groups, ['Views to include', 'The map', 'Staleness', 'Passcode', 'Before you publish']);
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
    assert.equal(form.described, 'A short or guessable passcode stops a casual look, not someone set on guessing it; the passcode this tool starts with is public.');
    assert.equal(form.button, 'Publish a file');
    assert.deepEqual(form.headings, ['Publish', 'Print for the whole school']);
    assert.equal(await says(page, 'notes'), 'Teacher notes are published: the substitute plan shows them.');
    assert.equal(await says(page, 'mail'), 'On a phone, open the file in Safari or Chrome, or save it to Files first; a mail app’s preview will not work.');

    // the sample school has one problem left, and the form says what readers will see of it
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.pub__checks li'), (el) => el.textContent)), ['Room 203 has two groups in Period 2 on A Day: both will be shown.']);
    assert.equal(await page.evaluate(() => document.querySelector('.pub__checks li').dataset.kind), 'room-double');
  });
});

test('each choice is the project\'s own setting: saved through the publish action, one undo step, and the control follows an undo', async () => {
  await closing(await open(), async (page) => {
    const inside = frameOf(page);
    const start = await undoSteps(page);

    // a view left out: the project says so, the preview drops it
    let before = await sent(page);
    await page.click('.pub input[data-view="coverage"]');
    assert.equal((await project(page)).publish.views.coverage, false);
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
    const until = await page.evaluate(() => {
      const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return date.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getMonth()] + ' ' + date.getFullYear();
    });
    assert.equal(hint, 'Readers see a notice once the file is older than this. Published today, it is current until ' + until + '. From 1 to 3650 days.');
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
    const lines = () => page.evaluate(() => Array.from(document.querySelectorAll('.pub__checks li'), (el) => el.textContent));
    assert.deepEqual(await lines(), ['Room 203 has two groups in Period 2 on A Day: both will be shown.']);

    // a second problem: 7A goes where 6A already is
    const slot = await page.evaluate(() => {
      const school = globalThis.sv2.store.project;
      const day = school.dayTypes[0].id;
      const six = school.groups.find((group) => group.name === '6A');
      return { dayTypeId: day, period: 2, room: six.days[day][2].room, groupId: school.groups.find((group) => group.name === '7A').id };
    });
    await apply(page, 'setSlot', { groupId: slot.groupId, dayTypeId: slot.dayTypeId, period: slot.period, slot: { room: slot.room } });
    await page.waitForFunction(() => document.querySelectorAll('.pub__checks li').length >= 2);
    const now = await lines();
    assert.ok(now.includes('Room 101 has two groups in Period 3 on A Day: both will be shown.'), now.join(' | '));
    assert.ok(now.includes('Room 203 has two groups in Period 2 on A Day: both will be shown.'));

    // accepted, the first is no longer a line; it is still published, and the form says so
    const id = await page.evaluate(() => document.querySelector('.pub__checks li[data-kind="room-double"]').dataset.finding);
    await apply(page, 'acceptFinding', { findingId: id, reason: 'Both coaches are there' });
    await page.waitForFunction(() => /accepted/.test(document.querySelector('[data-says="checks-summary"]').textContent));
    assert.equal(await says(page, 'checks-summary'), 'One problem you accepted is published as it is too.');

    // with nothing left, one plain sentence
    await page.evaluate(() => { globalThis.sv2.store.undo(); globalThis.sv2.store.undo(); });
    await page.waitForFunction(() => document.querySelectorAll('.pub__checks li').length === 1);
    const only = await page.evaluate(() => document.querySelector('.pub__checks li').dataset.finding);
    await apply(page, 'acceptFinding', { findingId: only, reason: 'Team taught' });
    await page.waitForFunction(() => document.querySelector('.pub__checks').hidden);
    assert.equal(await says(page, 'checks-summary'), 'The checks found no problem that readers will see. One problem you accepted is published as it is.');
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
    const today = await page.evaluate(() => {
      const now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    });
    assert.ok(names[0].endsWith(' - ' + today + '.html'), 'the day it was published, on this device');
    const said = await says(page, 'published');
    assert.match(said, /^Published Marrowby Middle School \(sample\) - staff schedule - \d{4}-\d{2}-\d{2}\.html \(\d+ KB\)\. It asks for the staff passcode\.$/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-says="published"]').getAttribute('role')), 'status');

    // publishing is not an undo step, and the project remembers that a file went out
    assert.equal(await undoSteps(page), steps);
    assert.match((await project(page)).publish.lastPublishedAt, /^\d{4}-\d{2}-\d{2}T/);
    await page.waitForFunction(() => document.querySelector('.stf-facts').textContent.startsWith('A file has been published from this project.'));

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
        const number = doc.querySelector('.batch-sign__number');
        const day = doc.querySelector('.batch-days');
        return {
          output: sheet.dataset.output,
          sheets: Number(sheet.dataset.sheets),
          what: doc.querySelector('.doc-head__what').textContent,
          school: doc.querySelector('.doc-head__school').textContent,
          newSheets: Array.from(doc.querySelectorAll('.new-sheet'), (el) => el.dataset.sheet),
          breaks: Array.from(doc.querySelectorAll('.new-sheet'), (el) => view.getComputedStyle(el).breakBefore),
          numberPx: number ? parseFloat(view.getComputedStyle(number).fontSize) : null,
          columns: day ? view.getComputedStyle(day).gridTemplateColumns.split(' ').length : null,
          tallest: Math.max(...Array.from(doc.querySelectorAll('.new-sheet'), (el) => el.getBoundingClientRect().height)),
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
      return { number: Array.from(doc.querySelectorAll('.batch-sign__number'), (el) => el.textContent), school: doc.querySelector('.batch-sign__school').textContent, stray: doc.querySelectorAll('img, b, script').length };
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
      const targets = await page.evaluate(() => Array.from(document.querySelectorAll('.pub .stf-check, .pub .btn'), (el) => Math.round(el.getBoundingClientRect().height)));
      assert.ok(targets.every((height) => height >= 28), 'every target in the form is tall enough for a finger: ' + targets.join(' '));
    });
  });
}
