// The movement view after the walk-through of it, in a real browser:
// node test/browser/m3-pass.mjs
//
// The walk-through used the sample school at 390 by 844, 768 by 1024, 1280 by
// 800 and 1440 by 900, and so do these. Each case measures one thing it
// found: how much of the window the map has, whether the page scrolls, where
// a message lies against what the section docks at the bottom. A case reads
// boxes on the screen; the device's storage is read for what a reload has to
// keep.
//
// Every case has a page of its own, and the browser's `sv2:device` is emptied
// before each, so a case starts as a new device does whatever ran before it.
// A wait is on something the page sets (an attribute, a box), never on a
// count of frames.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openPlanner, go, startServer, launch, TOOL_PATH } from './harness.mjs';

const PHONE = { width: 390, height: 844, mobile: true };
const TABLET = { width: 768, height: 1024 };
const DESK = { width: 1280, height: 800 };
const WIDE = { width: 1440, height: 900 };
const SIZES = [['390 by 844', PHONE], ['768 by 1024', TABLET], ['1280 by 800', DESK], ['1440 by 900', WIDE]];
const CLEAN = { errors: [], blocked: [], shimmed: [] };
const HINT = 'Playback walks one transition at a time. Press Play for the first, or choose one above.';
const HINT_REDUCED = 'Playback walks one transition at a time. Choose one above, or press Next for the first.';
const HIDDEN_TOAST = 'Getting started is hidden. Help brings it back.';
const LONG = 'Imported “Marrowby Middle School (sample) - teachers - 2026-09-01.csv”: 14 teachers added, 3 teachers changed, 2 rows left out because they had no name.';

let server;
let browser;

const shows = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
// The box of what a selector finds, or null when it has none on screen.
const box = (page, selector) => page.evaluate((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}, selector);
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const device = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sv2:device')));
const closeToast = (page) => page.evaluate(() => document.querySelector('.toast__close')?.click());

// The movement view has the answer for the project as it is, and its map has
// been drawn at the size the stage has now.
function drawn(page) {
  return page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    if (movement.state === null || movement.state.results === null || movement.state.project !== globalThis.sv2.store.project) return false;
    const stage = document.querySelector('.mov-stage');
    const canvas = document.getElementById('movement-plan');
    return stage.clientHeight > 0 && movement.view.width === stage.clientWidth && movement.view.height === stage.clientHeight && Number(canvas.dataset.drawn || 0) > 0;
  }, { timeout: 15000 });
}

// Empty what this browser remembers of the device: the cases share a browser.
async function forget() {
  const page = await browser.newPage();
  try {
    await page.goto(server.base + TOOL_PATH + 'icon.svg', { waitUntil: 'load' });
    await page.evaluate(() => localStorage.removeItem('sv2:device'));
  } finally {
    await page.close();
  }
}

// Run a case on a page of its own, on a device that remembers nothing (or
// `options.device`), and hold the page to having had no error. A failure of
// the case is the one reported; the page's own errors are reported when the
// case passed.
async function on(hash, size, run, options) {
  await forget();
  const session = await openPlanner({ server, browser, hash, theme: 'light', ...size, ...(options || {}) });
  let failed = null;
  try {
    if (hash === '#movement') await drawn(session.page);
    await run(session.page, session);
  } catch (error) {
    failed = error;
  }
  const found = session.problems();
  await session.page.close();
  if (failed) throw failed;
  assert.deepEqual(found, CLEAN);
}

// Getting started put away by its own button; the message it brings is
// closed unless the case is about it.
async function dismissStarted(page, keepToast) {
  await page.evaluate(() => document.querySelector('#getting-started [data-action="dismiss"]').click());
  await shows(page, () => document.getElementById('getting-started').hidden && document.querySelector('.toast') !== null);
  if (!keepToast) {
    await closeToast(page);
    await shows(page, () => document.querySelector('.toast') === null);
  }
}

// What the window gives the map: the stage's box, the window, and whether
// anything scrolled.
const mapRoom = (page) => page.evaluate(() => {
  const stage = document.querySelector('.mov-stage').getBoundingClientRect();
  const plan = document.getElementById('movement-plan').getBoundingClientRect();
  const surface = document.getElementById('surface');
  const section = document.querySelector('.mov');
  return {
    stage: Math.round(stage.height),
    plan: Math.round(plan.height),
    top: Math.round(stage.top),
    bottom: Math.round(stage.bottom),
    window: [innerWidth, innerHeight],
    surfaceBottom: Math.round(surface.getBoundingClientRect().bottom),
    scrolled: [surface.scrollTop, section.scrollTop, scrollY],
    sectionScrolls: section.scrollHeight - section.clientHeight,
    folded: document.querySelector('.mov-top').dataset.folded,
  };
});

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- W1: the map first

for (const [name, size] of SIZES) {
  test('the map first, at ' + name + ': the stage has at least 45 % of the window’s height and 320 px, with Getting started up and with it put away', async () => {
    await on('#movement', size, async (p) => {
      const floor = Math.max(320, Math.ceil(size.height * 0.45));
      for (const step of ['Getting started up', 'Getting started put away']) {
        if (step === 'Getting started put away') {
          await dismissStarted(p);
          await drawn(p);
        } else {
          assert.equal(await p.$eval('#getting-started', (el) => el.hidden), false, 'the sample school opens with Getting started up');
        }
        const room = await mapRoom(p);
        assert.deepEqual(room.window, [size.width, size.height]);
        assert.ok(room.stage >= floor, step + ': the stage is ' + room.stage + ' px high, under ' + floor + ': ' + JSON.stringify(room));
        assert.equal(room.plan, room.stage, step + ': the canvas is not the stage’s height');
        // and it is on screen, not below the fold: nothing is scrolled and the stage ends inside the surface
        assert.deepEqual(room.scrolled, [0, 0, 0], step + ': something is scrolled');
        assert.ok(room.bottom <= room.surfaceBottom, step + ': the stage runs under the foot of the surface: ' + JSON.stringify(room));
        assert.equal(room.sectionScrolls, 0, step + ': the section scrolls inside itself with the controls as they open');
      }
      // Getting started was under the map, not beside it and not over it
      assert.equal(await p.evaluate(() => document.querySelector('.mov-stage').clientWidth === document.getElementById('surface').clientWidth), true, 'the map is not the surface’s full width');
    });
  });
}

test('Getting started is under the map at full width, and the surface scrolls down to it', async () => {
  await on('#movement', DESK, async (p) => {
    const map = await box(p, '.mov');
    const card = await box(p, '#getting-started');
    const surface = await box(p, '#surface');
    assert.ok(card.top >= map.bottom, 'the card is not under the map: ' + JSON.stringify({ map, card }));
    assert.ok(card.top >= surface.bottom, 'the card is on the first screen, over the map');
    assert.ok(card.width > surface.width - 80, 'the card is ' + card.width + ' px wide in a surface of ' + surface.width);
    // Help brings it into view
    await p.evaluate(() => document.querySelector('#getting-started .steps a').scrollIntoView({ block: 'nearest' }));
    await shows(p, () => document.getElementById('surface').scrollTop > 0);
    const shown = await box(p, '#getting-started');
    assert.ok(shown.top < surface.bottom, 'the surface did not scroll to the card');
    assert.equal(await p.evaluate(() => scrollY), 0, 'the page itself scrolled');
  });
});

test('the controls fold behind Change: folded under 900 px, open from it, and the reader’s choice is kept on the device', async () => {
  // a phone: folded, the sentence alone, and the floors’ row folded with it
  await on('#movement', PHONE, async (p) => {
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'Showing 8 groups on A Day, all transitions. No route failed.');
    assert.equal(await p.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded')), 'false');
    assert.equal(await box(p, '.mov-controls'), null, 'the controls are on screen');
    assert.equal(await box(p, '.mov-floors'), null, 'the floors’ row is on screen on a phone with the controls folded');
    assert.equal(await device(p).then((kept) => kept && kept.movement), undefined, 'nothing is kept until the reader chooses');

    await p.tap('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'false');
    assert.equal(await p.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded')), 'true');
    for (const selector of ['[data-control="who"]', '[data-control="day"]', '[data-control="transition"]', '[data-control="labels"]', '[data-action="clear"]', '.mov-floors']) {
      assert.ok(await box(p, selector), selector + ' is not on screen with the controls shown');
    }
    assert.deepEqual((await device(p)).movement, { controls: 'open' });
    // the stage keeps its height: the section scrolls inside itself, and the page does not.
    // Its height is all the section has under the first line and over the bar
    // (SV2-52: the floors' row in the top bar takes some of the window on a phone)
    await drawn(p);
    const room = await mapRoom(p);
    const has = await p.$eval('.mov', (el) => parseFloat(el.style.getPropertyValue('--mov-room')));
    assert.ok(has >= 300 && room.stage >= has, 'with the controls shown the stage is ' + room.stage + ' px of the ' + has + ' the section has');
    assert.ok(room.sectionScrolls > 0, 'the section does not scroll inside itself: ' + JSON.stringify(room));
    assert.equal(await p.evaluate(() => document.scrollingElement.scrollHeight === document.scrollingElement.clientHeight), true, 'the page scrolls');

    // kept: the same after a reload, on this device
    await p.reload({ waitUntil: 'load' });
    await drawn(p);
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false');
    // folded again with the focus in a control: the focus goes to Change, and that is kept too
    await p.focus('[data-control="day"]');
    await p.evaluate(() => document.querySelector('[data-action="change"]').click());
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    assert.equal(await p.evaluate(() => document.activeElement.dataset.action), 'change');
    assert.deepEqual((await device(p)).movement, { controls: 'folded' });
    assert.equal(await box(p, '.mov-floors'), null);
  });

  // 1280: open by default, and a choice to fold is kept
  await on('#movement', DESK, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false');
    assert.ok(await box(p, '[data-control="transition"]'));
    const before = (await mapRoom(p)).stage;
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await drawn(p);
    assert.ok((await mapRoom(p)).stage > before + 100, 'folding the controls gave the map nothing');
    assert.ok(await box(p, '.mov-floors'), 'above 640 px the floors’ row stays');
    assert.deepEqual((await device(p)).movement, { controls: 'folded' });
  });

  // a device that has other things stored and not this field: the width decides
  await on('#movement', DESK, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false');
    assert.deepEqual(await device(p).then((kept) => [kept.theme, kept.movement]), ['dark', undefined]);
  }, { device: { theme: 'dark', playback: { speed: 2 }, lastSection: 'movement' }, theme: 'dark' });

  // the one field, not a key of its own
  await on('#movement', TABLET, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'true', '768 px is under 900');
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'false');
    assert.deepEqual(await p.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sv2')).sort()), ['sv2:device']);
  });
});

test('a window that crosses 900 px folds or shows the controls until the reader has chosen, and never after', async () => {
  await on('#movement', DESK, async (p) => {
    await p.setViewport({ width: 800, height: 800 });
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await p.setViewport({ width: 1280, height: 800 });
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'false');
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await p.setViewport({ width: 800, height: 800 });
    await shows(p, () => innerWidth === 800 && document.querySelector('.mov').movement.view.width === document.querySelector('.mov-stage').clientWidth);
    await p.setViewport({ width: 1280, height: 800 });
    await shows(p, () => innerWidth === 1280 && document.querySelector('.mov').movement.view.width === document.querySelector('.mov-stage').clientWidth);
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'true', 'the window undid the reader’s choice');
  });
});

// The parts of the bar's row, and where each is.
const barRow = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-bar="playback"]');
  const row = bar.querySelector('.mov-pb__row');
  const at = (selector) => {
    const el = bar.querySelector(selector);
    if (!el || el.getClientRects().length === 0) return null;
    const rect = el.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), middle: Math.round((rect.top + rect.bottom) / 2), width: Math.round(rect.width), height: Math.round(rect.height), inRow: row.contains(el), inMore: Boolean(el.closest('[data-part="more"]')) };
  };
  return {
    compact: bar.dataset.compact,
    bar: Math.round(bar.getBoundingClientRect().height),
    row: Math.round(row.getBoundingClientRect().height),
    play: at('[data-action="play"]'),
    previous: at('[data-action="previous"]'),
    next: at('[data-action="next"]'),
    scrubber: at('[data-control="scrubber"]'),
    clock: at('[data-part="clock"]'),
    speed: at('[data-control="speed"]'),
    loop: at('[data-control="loop"]'),
    more: at('[data-action="more"]'),
  };
});

// Choose a transition and scrub into it, so the clock and the countdown have words.
async function scrubInto(page, period, seconds) {
  await page.evaluate((at) => document.querySelector('.mov').movement.change({ transition: at }), period);
  await shows(page, () => document.querySelector('[data-control="scrubber"]').disabled === false);
  await page.$eval('[data-control="scrubber"]', (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await shows(page, (value) => document.querySelector('[data-bar="playback"]').dataset.seconds === String(value) && document.querySelector('[data-part="clock"]').textContent !== '', seconds);
}

for (const [name, size, onRow] of [['1280 by 800', DESK, true], ['1440 by 900', WIDE, true], ['1000 by 800', { width: 1000, height: 800 }, false], ['768 by 1024', TABLET, false], ['390 by 844', PHONE, false]]) {
  test('the playback bar is one row at ' + name + ': Play, Previous, Next, the scrubber, the clock' + (onRow ? ', Speed, Loop' : '') + ' and More' + (onRow ? '' : ', with Speed and Loop behind More'), async () => {
    await on('#movement', size, async (p) => {
      await scrubInto(p, 5, 120);
      const row = await barRow(p);
      const parts = ['play', 'previous', 'next', 'scrubber', 'clock', ...(onRow ? ['speed', 'loop'] : []), 'more'];
      for (const part of parts) assert.ok(row[part] && row[part].inRow, part + ' is not on the row: ' + JSON.stringify(row));
      // one row: every part's middle is beside Play (the clock is the upper of two lines of words), and each starts where the one before it ended
      for (const part of parts) assert.ok(row[part].middle > row.play.top && row[part].middle < row.play.bottom, part + ' is on another line: ' + JSON.stringify(row));
      for (let at = 1; at < parts.length; at += 1) assert.ok(row[parts[at]].left >= row[parts[at - 1]].right, parts[at] + ' is not after ' + parts[at - 1] + ': ' + JSON.stringify(row));
      // the scrubber has the spare width, and enough of it to be moved
      assert.ok(row.scrubber.width >= 56, 'the scrubber is ' + row.scrubber.width + ' px wide');
      assert.equal(row.compact, String(!onRow));
      if (!onRow) {
        assert.equal(row.speed, null, 'Speed is on screen with More shut');
        await p.evaluate(() => document.querySelector('[data-action="more"]').click());
        const open = await barRow(p);
        assert.ok(open.speed && open.speed.inMore && open.loop && open.loop.inMore, 'Speed and Loop are not behind More: ' + JSON.stringify(open));
        for (const control of ['pace', 'style', 'size', 'order']) assert.ok(await box(p, '[data-part="more"] [data-control="' + control + '"]'), control + ' is not behind More');
        await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      }
      // with More shut the bar is the row and at most the countdown and one line of words: nowhere near the 231 px it was on a phone
      assert.ok(row.bar <= 120, 'the bar is ' + row.bar + ' px high');
      // the row does not run out of the bar
      const bar = await box(p, '[data-bar="playback"]');
      assert.ok(row.more.right <= bar.right && row.play.left >= bar.left, 'the row runs past the bar: ' + JSON.stringify({ row, bar }));
    });
  });
}

test('a bar squeezed by the inspector in a window of 1100 px or more puts Speed and Loop behind More, and takes them back when the inspector folds', async () => {
  await on('#movement', { width: 1120, height: 800 }, async (p) => {
    await scrubInto(p, 5, 120);
    const squeezed = await barRow(p);
    assert.equal(await p.evaluate(() => matchMedia('(min-width: 1100px)').matches), true);
    assert.ok((await box(p, '[data-bar="playback"]')).width < 872, 'the bar is not squeezed: the case tests nothing');
    assert.equal(squeezed.compact, 'true', 'Speed and Loop are on a row that cannot hold them: ' + JSON.stringify(squeezed));
    assert.equal(squeezed.speed, null);
    assert.ok(squeezed.scrubber.width >= 56, 'the scrubber is ' + squeezed.scrubber.width + ' px wide');
    assert.ok(squeezed.more.right <= (await box(p, '[data-bar="playback"]')).right, 'More runs out of the bar');
    // the inspector folded away: the bar has the room, and the two are on the row again
    await p.click('#inspector-toggle');
    await shows(p, () => document.querySelector('[data-bar="playback"]').dataset.compact === 'false');
    const roomy = await barRow(p);
    assert.ok(roomy.speed && roomy.speed.inRow && roomy.loop && roomy.loop.inRow, JSON.stringify(roomy));
    for (const part of ['scrubber', 'clock', 'speed', 'loop', 'more']) assert.ok(roomy[part].middle > roomy.play.top && roomy[part].middle < roomy.play.bottom, part + ' is on another line: ' + JSON.stringify(roomy));
  });
});

test('the bar says how to start until playback has been started once on this device', async () => {
  await on('#movement', DESK, async (p) => {
    const note = () => p.$eval('[data-bar="playback"] [data-part="note"]', (el) => (el.hidden ? null : el.textContent));
    assert.equal(await note(), HINT);
    assert.equal(await device(p).then((kept) => kept && kept.movement), undefined);
    await scrubInto(p, 5, 30);
    assert.equal(await note(), null, 'a transition is chosen: the bar has nothing to say');
    assert.deepEqual((await device(p)).movement, { played: true });
    // back to All: the hint is not said again, now or after a reload
    await p.evaluate(() => document.querySelector('.mov').movement.change({ transition: null }));
    await shows(p, () => document.querySelector('[data-bar="playback"]').dataset.started === 'false');
    assert.equal(await note(), null, 'the hint is said again after playback was started');
    await p.reload({ waitUntil: 'load' });
    await drawn(p);
    assert.equal(await note(), null, 'the hint is said again after a reload');
    assert.equal(await p.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), null, 'Play can still be pressed');
  });
});

test('with reduced motion the line names Next, not Play, and is put away by the scrubber as well', async () => {
  await on('#movement', DESK, async (p) => {
    const note = () => p.$eval('[data-bar="playback"] [data-part="note"]', (el) => (el.hidden ? null : el.textContent));
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await shows(p, () => document.querySelector('[data-bar="playback"]').dataset.reduced === 'true');
    assert.equal(await note(), HINT_REDUCED);
    await scrubInto(p, 2, 10);
    await p.evaluate(() => document.querySelector('.mov').movement.change({ transition: null }));
    await shows(p, () => document.querySelector('[data-bar="playback"]').dataset.started === 'false');
    assert.equal(await note(), null);
  });
});

// ---------------------------------------------------------------- W4: the page does not scroll

const pageScroll = (page) => page.evaluate(() => {
  const root = document.scrollingElement;
  scrollTo(0, 500);
  const moved = scrollY;
  scrollTo(0, 0);
  const body = document.getElementById('inspector-body');
  return { scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, moved, panel: body ? [body.scrollHeight, body.clientHeight] : null, header: Math.round(document.querySelector('.topbar').getBoundingClientRect().top) };
});

for (const [name, size] of [['1280 by 800', DESK], ['1440 by 900', WIDE]]) {
  test('the page does not scroll at ' + name + ': on every inspector tab of the movement view the document is the window’s height, and the panel scrolls inside itself', async () => {
    await on('#movement', size, async (p) => {
      await dismissStarted(p);
      let scrolledInside = 0;
      for (const tab of ['hotspots', 'tables', 'summary', 'export']) {
        await p.evaluate((id) => document.querySelector('#inspector [role="tab"][data-tab="' + id + '"]').click(), tab);
        await shows(p, (id) => document.querySelector('#inspector [role="tab"][data-tab="' + id + '"]').getAttribute('aria-selected') === 'true' && document.querySelector('#inspector [role="tabpanel"]:not([hidden])') !== null, tab);
        const found = await pageScroll(p);
        assert.equal(found.scrollHeight, found.clientHeight, tab + ': the document is ' + found.scrollHeight + ' px tall in a window of ' + found.clientHeight);
        assert.equal(found.moved, 0, tab + ': scrollTo(0, 500) moved the page');
        assert.equal(found.header, 0, tab + ': the header is not at the top of the window');
        if (found.panel[0] > found.panel[1]) scrolledInside += 1;
      }
      // the case would be empty if no panel were taller than its box
      assert.ok(scrolledInside >= 1, 'no tab’s panel is taller than the inspector: nothing was tested');
    });
  });
}

test('the page does not scroll on the other sections either: the inspector’s panel holds what it scrolls', async () => {
  await on('#building', DESK, async (p) => {
    for (const hash of ['#building', '#schedule/groups', '#schedule/checks', '#staff', '#project', '#movement']) {
      await go(p, hash);
      const found = await pageScroll(p);
      assert.equal(found.scrollHeight, found.clientHeight, hash + ': the document is ' + found.scrollHeight + ' px tall in a window of ' + found.clientHeight);
      assert.equal(found.moved, 0, hash + ': the page moved');
    }
    assert.equal(await p.$eval('#inspector-body', (el) => getComputedStyle(el).position), 'relative');
  });
});

// ---------------------------------------------------------------- W5: a message clears the bottom dock

// How far the section says its dock reaches up from the surface's foot.
const dockClear = (page) => page.$eval('#surface', (el) => el.style.getPropertyValue('--toast-clear'));

// `since`: what the section's measure was before the dock changed. The case
// waits for the section to have measured again, and then judges the boxes.
async function clearOfDock(page, what, since) {
  await shows(page, (was) => {
    const now = document.getElementById('surface').style.getPropertyValue('--toast-clear');
    return now !== '' && now !== was;
  }, since === undefined ? '' : since);
  const toast = await box(page, '.toast');
  const zoom = await box(page, '.mov-zoom');
  const bar = await box(page, '[data-bar="playback"]');
  const surface = await box(page, '#surface');
  assert.ok(toast && zoom && bar, what + ': the message, the zoom buttons or the bar is not on screen');
  assert.equal(overlap(toast, zoom), false, what + ': the message lies on the zoom buttons: ' + JSON.stringify({ toast, zoom }));
  assert.equal(overlap(toast, bar), false, what + ': the message lies on the playback bar: ' + JSON.stringify({ toast, bar }));
  assert.ok(toast.left >= surface.left && toast.right <= surface.right && toast.top >= surface.top && toast.bottom <= surface.bottom, what + ': the message is out of the surface: ' + JSON.stringify({ toast, surface }));
  // bottom left, as everywhere: just above the dock, not up the page
  assert.ok(Math.min(zoom.top, bar.top) - toast.bottom <= 24, what + ': the message is ' + (Math.min(zoom.top, bar.top) - toast.bottom) + ' px above the dock');
  assert.ok(toast.left - surface.left <= 24, what + ': the message is not at the left of the surface');
}

for (const [name, size] of [['390 by 844', PHONE], ['1280 by 800', DESK], ['1440 by 900', WIDE]]) {
  test('a message clears what the movement view docks at the bottom, at ' + name + ': it meets neither the zoom buttons nor the playback bar', async () => {
    await on('#movement', size, async (p) => {
      await dismissStarted(p, true);
      assert.equal(await text(p, '.toast .toast__text'), HIDDEN_TOAST);
      await clearOfDock(p, 'Getting started hidden');
      // lifted over the dock, a message of one line asks no taller band of the page (on a phone it is two lines, and may)
      if (size.width >= 1280) assert.equal(await p.$eval('#surface', (el) => el.style.getPropertyValue('--toast-room')), '', 'the lift over the dock was counted as part of the band');
      await closeToast(p);

      // the bar grows (More, and a transition's lines): the message is still clear of it
      await scrubInto(p, 5, 250);
      const shut = await dockClear(p);
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      await shows(p, () => document.querySelector('[data-part="more"]').hidden === false);
      const open = (await box(p, '[data-bar="playback"]')).height;
      await shows(p, (was) => document.getElementById('surface').style.getPropertyValue('--toast-clear') !== was, shut);
      await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words, action: { label: 'Undo', run: () => {} } }), LONG);
      await clearOfDock(p, 'More open, a long message');
      // and while the message is up: the bar shrinks and grows under it
      const tall = await dockClear(p);
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      await shows(p, () => document.querySelector('[data-part="more"]').hidden === true);
      assert.ok((await box(p, '[data-bar="playback"]')).height < open, 'the bar is no shorter with More shut: the case tests nothing');
      await clearOfDock(p, 'More shut again', tall);
      await closeToast(p);

      // the section's measure leaves with the section
      await go(p, '#project');
      assert.equal(await p.$eval('#surface', (el) => el.style.getPropertyValue('--toast-clear')), '');
    });
  });
}

// ---------------------------------------------------------------- 38a: the band a message lies on

test('the band a tall message raised at the page’s end is the sheet’s own again when the message leaves', async () => {
  await on('#schedule/teachers', { width: 390, height: 760, mobile: true }, async (p) => {
    const band = () => p.evaluate(() => {
      const surface = document.getElementById('surface');
      return { inline: surface.style.getPropertyValue('--toast-room'), padding: parseFloat(getComputedStyle(document.querySelector('.surface__layout')).paddingBottom), scrollHeight: surface.scrollHeight };
    });
    const base = await band();
    assert.equal(base.inline, '');
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words + ' ' + words, action: { label: 'Undo', run: () => {} } }), LONG);
    const up = await band();
    assert.notEqual(up.inline, '', 'a message of several lines did not raise the band: the case tests nothing');
    assert.ok(up.padding > base.padding, 'the band is no taller: ' + JSON.stringify({ base, up }));
    await closeToast(p);
    await shows(p, () => document.querySelector('.toast') === null);
    const after = await band();
    assert.equal(after.inline, '', 'the band was left raised: --toast-room is still ' + after.inline);
    assert.equal(after.padding, base.padding);
    assert.equal(after.scrollHeight, base.scrollHeight, 'the page is taller than before the message');
    // the next section does not inherit a band either
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words + ' ' + words }), LONG);
    await go(p, '#schedule/subjects');
    await closeToast(p);
    await shows(p, () => document.querySelector('.toast') === null);
    assert.equal(await p.$eval('#surface', (el) => el.style.getPropertyValue('--toast-room')), '');
  });
});

test('a page too short to scroll is not moved by a tall message', async () => {
  await on('#schedule/teachers', { width: 1280, height: 2400 }, async (p) => {
    // a window in which the page just fits, with 10 px to spare
    const fit = await p.evaluate(() => {
      const surface = document.getElementById('surface');
      const layout = document.querySelector('.surface__layout');
      const last = Array.from(layout.children).filter((el) => el.getClientRects().length > 0).pop();
      const content = last.getBoundingClientRect().bottom - surface.getBoundingClientRect().top + surface.scrollTop + parseFloat(getComputedStyle(layout).paddingBottom);
      return { content: Math.ceil(content), chrome: innerHeight - surface.clientHeight };
    });
    const height = fit.chrome + fit.content + 10;
    await p.setViewport({ width: 1280, height });
    await shows(p, (wanted) => innerHeight === wanted, height);
    const before = await p.evaluate(() => {
      const surface = document.getElementById('surface');
      return { over: surface.scrollHeight - surface.clientHeight, top: surface.scrollTop };
    });
    assert.deepEqual(before, { over: 0, top: 0 }, 'the page scrolls before any message: the window was not fitted');
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words + ' ' + words + ' ' + words, action: { label: 'Undo', run: () => {} } }), LONG);
    const up = await p.evaluate(() => {
      const surface = document.getElementById('surface');
      return { inline: surface.style.getPropertyValue('--toast-room'), over: surface.scrollHeight - surface.clientHeight, top: surface.scrollTop };
    });
    assert.notEqual(up.inline, '', 'the message did not raise the band: the case tests nothing');
    assert.ok(up.over > 0, 'the raised band did not make the page taller than the window: the case tests nothing');
    assert.equal(up.top, 0, 'a page that did not scroll was scrolled to its new end');
  });
});

// ---------------------------------------------------------------- W2: the legend never covers a floor

// The drawn box of every floor on the map, the legend's card (null when it is
// away) and its line (null when the card stands), in the page's pixels.
const legendAndFloors = (page) => page.evaluate(() => {
  const movement = document.querySelector('.mov').movement;
  const plan = document.getElementById('movement-plan').getBoundingClientRect();
  const size = movement.view.size;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const card = document.querySelector('.mov-legend');
  const line = document.querySelector('.mov-legend-line');
  return {
    floors: movement.world.slots.map((slot) => ({ name: slot.floor.name, left: plan.left + movement.view.x + slot.x * size, top: plan.top + movement.view.y + slot.y * size, right: plan.left + movement.view.x + (slot.x + slot.w) * size, bottom: plan.top + movement.view.y + (slot.y + slot.h) * size })),
    how: movement.world.how,
    fitted: movement.fitted,
    zoom: Math.round(movement.view.zoom * 100),
    card: card.getClientRects().length > 0 && getComputedStyle(card).visibility === 'visible' ? rect(card) : null,
    laidOut: card.getClientRects().length > 0 ? rect(card) : null,
    docked: card.dataset.docked,
    line: line.getClientRects().length > 0 ? { ...rect(line), text: line.querySelector('[data-legend="line"]').textContent } : null,
    stage: rect(document.querySelector('.mov-stage')),
  };
});

const changeMap = async (page, patch) => {
  await page.evaluate((next) => document.querySelector('.mov').movement.change(next), patch);
  await drawn(page);
};

test('W2: the legend never covers a floor: its card lies on no floor’s drawn box at the fitted zoom, or it is one line under the map', async () => {
  const seen = { card: 0, line: 0 };
  for (const [name, size] of [['768 by 1024', TABLET], ['1280 by 800', DESK], ['1440 by 900', WIDE]]) {
    await on('#movement', size, async (p) => {
      await dismissStarted(p);
      for (const floors of ['auto', 'stacked', 'side', 'fsample002']) {
        await changeMap(p, { floors });
        const at = await legendAndFloors(p);
        const what = name + ', ' + floors + ' (' + at.how + ', ' + at.zoom + ' %)';
        assert.equal(at.fitted, true, what + ': the map is not at its fitted zoom');
        if (at.card) {
          seen.card += 1;
          assert.equal(at.line, null, what + ': the card and the line are both up');
          for (const floor of at.floors) assert.equal(overlap(at.card, floor), false, what + ': the legend’s card lies on ' + floor.name + ': ' + JSON.stringify({ card: at.card, floor }));
          assert.ok(at.card.right <= at.stage.right && at.card.bottom <= at.stage.bottom, what + ': the card is out of the stage');
        } else {
          seen.line += 1;
          assert.ok(at.line, what + ': neither the card nor the line is on screen');
          assert.equal(at.docked, 'true');
          assert.match(at.line.text, /^Load · 1 to \d+ · Relative$/, what);
          assert.ok(at.line.top >= at.stage.bottom - 1, what + ': the line is not under the stage: ' + JSON.stringify({ line: at.line, stage: at.stage }));
          for (const floor of at.floors) assert.equal(overlap(at.line, floor), false, what + ': the line lies on ' + floor.name);
          // it was docked for a reason: where the card would stand is on a floor (the stage is a line's height shorter than it was measured at)
          const grown = { left: at.laidOut.left - at.line.height, top: at.laidOut.top - at.line.height, right: at.laidOut.right + at.line.height, bottom: at.laidOut.bottom + at.line.height };
          assert.ok(at.floors.some((floor) => overlap(grown, floor)), what + ': the card was docked though it would lie on no floor: ' + JSON.stringify({ card: at.laidOut, floors: at.floors }));
        }
      }
      if (size === TABLET) {
        // the walk-through's own measure: stacked at 768, the card covered the right third of Floors 2 and 3
        await changeMap(p, { floors: 'stacked' });
        assert.equal((await legendAndFloors(p)).docked, 'true', '768 by 1024 stacked: the card stands on the map');
      }
    });
  }
  assert.ok(seen.card > 0 && seen.line > 0, 'the case saw ' + seen.card + ' cards and ' + seen.line + ' lines: one of the two was never tested');
});

// On the sample school at 390 px the card would lie on a floor whichever
// floors are shown (it is 224 px of the 390), so this case stays green with
// the phone's rule taken out and the measure left to decide: it holds what
// the phone shows, and the rule itself is held by reading it (index.js,
// dockLegend: `phone.matches ||`). Said here so that nobody takes the case
// for a guard on that line.
test('W2: under 640 px the legend is always the line; Scale brings the card out over the map until its own button puts it away', async () => {
  await on('#movement', PHONE, async (p) => {
    await dismissStarted(p);
    for (const floors of ['auto', 'fsample003']) {
      await changeMap(p, { floors });
      const at = await legendAndFloors(p);
      assert.equal(at.card, null, floors + ': the card stands on a phone’s map');
      assert.match(at.line.text, /^Load · 1 to \d+ · Relative$/);
    }
    await changeMap(p, { floors: 'auto' });
    // Scale: the card, with its choices, over the map
    assert.equal(await p.$eval('[data-action="scale"]', (el) => el.getAttribute('aria-expanded')), 'false');
    await p.tap('[data-action="scale"]');
    await shows(p, () => getComputedStyle(document.querySelector('.mov-legend')).visibility === 'visible');
    assert.equal(await p.$eval('[data-action="scale"]', (el) => el.getAttribute('aria-expanded')), 'true');
    assert.equal(await p.evaluate(() => document.activeElement.dataset.action), 'fold-legend', 'the focus goes into the card');
    assert.deepEqual(await p.$$eval('.mov-legend__range', (all) => all.map((each) => each.textContent)), ['1–35', '36–70', '71–106', '107–141', '142–177']);
    // a choice made in it is made: the line follows
    await p.evaluate(() => document.querySelector('.mov-legend input[name="movement-measure"][value="total"]').click());
    await shows(p, () => document.querySelector('.mov-legend').dataset.measure === 'total');
    assert.equal(await text(p, '[data-legend="line"]'), 'Load · 1 to 800 · Relative');
    assert.equal(await p.$eval('.mov-legend', (el) => getComputedStyle(el).visibility), 'visible', 'the card went away on a choice');
    // its own button puts it away; the focus goes back to Scale
    assert.equal(await text(p, '.mov-legend [data-action="fold-legend"]'), 'Hide');
    await p.tap('.mov-legend [data-action="fold-legend"]');
    await shows(p, () => getComputedStyle(document.querySelector('.mov-legend')).visibility === 'hidden');
    assert.equal(await p.evaluate(() => document.activeElement.dataset.action), 'scale');
    assert.ok(await box(p, '.mov-legend-line'), 'the line went with the card');
    // away, nothing of the card can be reached
    assert.equal(await p.$eval('.mov-legend', (el) => el.inert), true);
    // one group: no load to give
    await changeMap(p, { who: 'groups', groupIds: ['gsample08a'], measure: 'busiest' });
    assert.equal(await text(p, '[data-legend="line"]'), 'One group · its own colour');
  });
});

// ---------------------------------------------------------------- W3: the inspector on a phone

test('W3: on a phone the inspector is a sheet over the lower 55 % with the map’s top above it, and "Show its N cells" shuts it and moves the map to the place', async () => {
  await on('#movement', PHONE, async (p) => {
    await dismissStarted(p);
    await p.tap('#inspector-toggle');
    await shows(p, () => document.getElementById('inspector').dataset.open === 'true' && document.querySelectorAll('#inspector .mov-hot__row').length > 0);
    const sheet = await box(p, '#inspector');
    const rail = await box(p, '.rail');
    assert.ok(Math.abs(sheet.height - 844 * 0.55) <= 2, 'the sheet is ' + sheet.height + ' px of 844');
    assert.ok(Math.abs(sheet.bottom - rail.top) <= 1, 'the sheet does not stand on the bottom bar');
    // above it: the first line, and the top of the map
    const line = await box(p, '#movement-line');
    const stage = await box(p, '.mov-stage');
    assert.ok(line.bottom <= sheet.top, 'the first line is under the sheet');
    assert.ok(sheet.top - stage.top >= 150, 'only ' + (sheet.top - stage.top) + ' px of the map show above the sheet');
    assert.ok(stage.height >= 379, 'the map was squeezed to ' + stage.height + ' px, not kept');
    assert.equal(await p.evaluate(() => document.scrollingElement.scrollHeight === document.scrollingElement.clientHeight), true, 'the page scrolls');

    // the link of the second place: not a disclosure here
    const link = '#inspector .mov-hot__row[data-rank="2"] [data-action="cells"]';
    assert.match(await text(p, link), /^Show its \d+ cells$/);
    assert.equal(await p.$eval(link, (el) => el.getAttribute('aria-expanded')), null);
    const place = await p.$eval('#inspector .mov-hot__row[data-rank="2"]', (el) => el.dataset.place);
    await p.$eval(link, (el) => el.scrollIntoView({ block: 'center' }));
    const at = await box(p, link);
    await p.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
    // the sheet is shut, the place is chosen, and it is in the middle of the map as the map is now
    await shows(p, (wanted) => {
      const panel = document.querySelector('#inspector [data-panel="hotspots"]');
      const movement = document.querySelector('.mov').movement;
      const stageNow = document.querySelector('.mov-stage');
      if (document.getElementById('inspector').dataset.open !== 'false' || panel.hotspots.selected !== wanted) return false;
      if (movement.view.height !== stageNow.clientHeight || movement.view.width !== stageNow.clientWidth) return false;
      const row = panel.hotspots.rows.find((each) => each.id === wanted);
      const points = row.ends.map((end) => movement.cellAt(end.floorId, end.cell)).filter(Boolean);
      const x = points.reduce((sum, each) => sum + each.x, 0) / points.length;
      const y = points.reduce((sum, each) => sum + each.y, 0) / points.length;
      return Math.abs(x - movement.view.width / 2) < 1 && Math.abs(y - movement.view.height / 2) < 1;
    }, place);
    assert.ok((await box(p, '.mov-stage')).height > stage.height - 1, 'the map did not get its height back');
    assert.equal(await p.$eval('#inspector [data-panel="hotspots"]', (el) => el.dataset.pulse), 'moving', 'the rings are not pulsing');
    assert.equal(await p.$$eval('#inspector .mov-hot__cells:not([hidden])', (all) => all.length), 0, 'the list of cells was opened in the shut sheet');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'movement-plan', 'the focus was left in the shut sheet');
    assert.match(await text(p, '#announcer'), /^The map moved to /);
  });
  // wider than a phone the same link is the disclosure it was: the cells, in the panel
  await on('#movement', DESK, async (p) => {
    const link = '#inspector .mov-hot__row[data-rank="2"] [data-action="cells"]';
    assert.equal(await p.$eval(link, (el) => el.getAttribute('aria-expanded')), 'false');
    await p.evaluate((selector) => document.querySelector(selector).click(), link);
    await shows(p, () => document.querySelectorAll('#inspector .mov-hot__cells:not([hidden]) li').length > 0);
    assert.equal(await p.$eval('#inspector', (el) => el.dataset.open), 'true');
    assert.match(await text(p, link), /^Hide its \d+ cells$/);
  });
});

test('the inspector’s four tabs are one row at 1280 px', async () => {
  await on('#movement', DESK, async (p) => {
    const tops = await p.$$eval('#inspector [role="tab"]', (all) => all.map((tab) => Math.round(tab.getBoundingClientRect().top)));
    assert.equal(tops.length, 4);
    assert.equal(new Set(tops).size, 1, 'the tabs are on ' + new Set(tops).size + ' rows: ' + tops);
    const right = await p.$$eval('#inspector [role="tab"]', (all) => Math.max(...all.map((tab) => tab.getBoundingClientRect().right)));
    assert.ok(right <= (await box(p, '#inspector')).right, 'the row of tabs runs out of the panel');
  });
});

// ---------------------------------------------------------------- W6: the transition strip is one Tab stop

// Tab from the Who control until the map has the focus: what took it on the way.
async function tabsToMap(page) {
  await page.focus('input[name="movement-who"]:checked');
  const stops = [];
  for (let n = 0; n < 40; n += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      return el.id === 'movement-plan' ? 'the map' : el.dataset.control || el.dataset.action || (el.dataset.transition !== undefined ? 'transition ' + el.dataset.transition : el.tagName);
    });
    stops.push(stop);
    if (stop === 'the map') break;
  }
  return stops;
}

test('W6: from Who to the map is six Tabs whatever the number of periods: the transition strip is a radio group with one Tab stop, arrows, Home and End', async () => {
  await on('#movement', DESK, async (p) => {
    assert.deepEqual(await tabsToMap(p), ['day', 'transition all', 'labels', 'constant-width', 'clear', 'the map']);
    const strip = () => p.evaluate(() => ({
      role: document.querySelector('[data-control="transition"]').getAttribute('role'),
      roles: Array.from(new Set(Array.from(document.querySelectorAll('.mov-strip__item')).map((item) => item.getAttribute('role')))),
      stops: Array.from(document.querySelectorAll('.mov-strip__item')).filter((item) => item.tabIndex === 0).map((item) => item.dataset.transition),
      checked: Array.from(document.querySelectorAll('.mov-strip__item[aria-checked="true"]')).map((item) => item.dataset.transition),
      focus: document.activeElement.dataset.transition || null,
      chosen: document.querySelector('.mov').movement.picture.choice.transition,
      count: document.querySelectorAll('.mov-strip__item').length,
    }));
    assert.deepEqual(await strip(), { role: 'radiogroup', roles: ['radio'], stops: ['all'], checked: ['all'], focus: null, chosen: null, count: 8 });
    // the arrows move the choice, and the focus stays on the strip while the map changes
    await p.focus('.mov-strip__item[aria-checked="true"]');
    for (const [key, to, chosen] of [['ArrowRight', '0', 0], ['ArrowRight', '1', 1], ['ArrowDown', '2', 2], ['ArrowLeft', '1', 1], ['End', '6', 6], ['ArrowRight', 'all', null], ['ArrowUp', '6', 6], ['Home', 'all', null]]) {
      await p.keyboard.press(key);
      await drawn(p);
      assert.deepEqual(await strip(), { role: 'radiogroup', roles: ['radio'], stops: [to], checked: [to], focus: to, chosen, count: 8 }, 'after ' + key);
    }
    // with a transition chosen it is that one the Tab lands on, and still six Tabs
    await p.keyboard.press('ArrowRight');
    await drawn(p);
    assert.deepEqual(await tabsToMap(p), ['day', 'transition 0', 'labels', 'constant-width', 'clear', 'the map']);
    // a day of twelve periods: eleven transitions and All, and six Tabs
    await p.evaluate(async () => {
      const actions = await import('./engine/actions.js');
      globalThis.sv2.store.apply(actions.setSetting, { key: 'periods', value: 12 });
    });
    await drawn(p);
    assert.equal((await strip()).count, 12);
    assert.deepEqual(await tabsToMap(p), ['day', 'transition 0', 'labels', 'constant-width', 'clear', 'the map']);
  });
});

// ---------------------------------------------------------------- W7: the keyboard cursor reads at any zoom

test('W7: the keyboard cursor is a ring never under 14 px, a 2 px line in the focus colour between two lines of the surface’s: read at 25 % and at 100 %, and at 100 % under reduced motion', async () => {
  await on('#movement', DESK, async (p) => {
    await dismissStarted(p);
    await p.focus('#movement-plan');
    for (let n = 0; n < 8; n += 1) await p.keyboard.press('ArrowRight');
    await shows(p, () => document.querySelector('.mov-marks').dataset.cursor !== undefined);
    const colours = await p.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { accent: style.getPropertyValue('--accent').trim(), card: style.getPropertyValue('--card').trim() };
    });
    const hex = (value) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
    const near = (got, want) => got[3] === 255 && got.slice(0, 3).every((value, index) => Math.abs(value - want[index]) <= 14);
    // SV2-52 item 11: the last reading is with the device asking for reduced motion
    for (const [zoom, still] of [[0.25, false], [1, false], [1, true]]) {
      if (still) {
        await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
        assert.equal(await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true, 'reduced motion was not asked for: the reading tests nothing');
      }
      const seen = await p.evaluate(async (wanted) => {
        const movement = document.querySelector('.mov').movement;
        const layer = movement.env.layer;
        if (layer.dataset.cursor === undefined) return { missing: true };
        const was = layer.dataset.cursor.split(',').map(Number);
        // zoom about the cursor, so that it stays on screen
        movement.view.zoomAbout(wanted, was[0] + was[2] / 2, was[1] + was[2] / 2);
        const drawnBefore = Number(movement.canvas.dataset.drawn);
        movement.env.paint();
        await new Promise((resolve) => {
          const wait = () => (Number(movement.canvas.dataset.drawn) > drawnBefore ? resolve() : requestAnimationFrame(wait));
          wait();
        });
        if (layer.dataset.cursor === undefined) return { missing: true };
        const [x, y, side] = layer.dataset.cursor.split(',').map(Number);
        const g = layer.getContext('2d');
        const at = (px, py) => Array.from(g.getImageData(Math.round(px), Math.round(py), 1, 1).data);
        const mid = side / 2;
        return {
          size: movement.view.size,
          zoom: movement.view.zoom,
          side,
          cell: [movement.cursor.x, movement.cursor.y],
          corner: movement.view.toScreen(movement.cursor.x, movement.cursor.y),
          x,
          y,
          // the middle of each of the four lines; the line is 2 px wide, centred a pixel inside the ring's box
          lines: [at(x + 1, y + mid), at(x + side - 1.5, y + mid), at(x + mid, y + 1), at(x + mid, y + side - 1.5)],
          // the pixel either side of the line's two: the surface's colour
          outside: [at(x - 1, y + mid), at(x + mid, y - 1)],
          inside: [at(x + 2, y + mid), at(x + mid, y + 2)],
          // and the pixel beyond those is the map's again: the halo is one pixel, not a slab
          beyond: [at(x - 2, y + mid), at(x + 3, y + mid)],
          middle: at(x + mid, y + mid),
        };
      }, zoom);
      assert.notEqual(seen.missing, true, 'no keyboard cursor is drawn' + (still ? ' under reduced motion' : '') + ' with the focus on the map');
      const what = 'at ' + Math.round(seen.zoom * 100) + ' % (a cell is ' + seen.size + ' px)' + (still ? ', reduced motion' : '');
      assert.equal(seen.side, Math.max(14, Math.round(seen.size) - 2), what + ': the ring is ' + seen.side + ' px across');
      assert.ok(seen.side >= 14, what);
      // round the cursor's own cell
      assert.ok(Math.abs(seen.x + seen.side / 2 - (seen.corner.x + seen.size / 2)) <= 1 && Math.abs(seen.y + seen.side / 2 - (seen.corner.y + seen.size / 2)) <= 1, what + ': the ring is not round the cursor’s cell: ' + JSON.stringify(seen));
      for (const got of seen.lines) assert.ok(near(got, hex(colours.accent)), what + ': the ring’s line is ' + got + ', not the focus colour ' + colours.accent);
      for (const got of [...seen.outside, ...seen.inside]) assert.ok(near(got, hex(colours.card)), what + ': beside the line is ' + got + ', not the surface’s ' + colours.card);
      for (const got of seen.beyond) assert.equal(got[3], 0, what + ': the light edge is wider than a pixel: ' + got);
      assert.equal(seen.middle[3], 0, what + ': the ring is filled in: ' + seen.middle);
    }
    // it goes with the focus
    await p.evaluate(() => document.getElementById('movement-plan').blur());
    await shows(p, () => document.querySelector('.mov-marks').dataset.cursor === undefined);
  });
});

// ---------------------------------------------------------------- W8: rings that lie over one another

test('W8: zoomed far out the rings of two places lie over one another: the busiest place’s is on top, and every rank is on a spot of its own with no line through it', async () => {
  await on('#movement', DESK, async (p) => {
    await dismissStarted(p);
    // the rings as they stand: the ring that travels out of each would be drawn over the very lines read here
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p.evaluate(() => document.querySelector('.mov').movement.change({ transition: null, measure: 'busiest' }));
    await shows(p, () => document.querySelector('#inspector [data-panel="hotspots"]').dataset.pulse === 'still');
    const seen = await p.evaluate(async () => {
      const movement = document.querySelector('.mov').movement;
      movement.view.zoomAbout(0.25, movement.view.width / 2, movement.view.height / 2);
      const drawnBefore = Number(movement.canvas.dataset.drawn);
      movement.env.paint();
      await new Promise((resolve) => {
        const wait = () => (Number(movement.canvas.dataset.drawn) > drawnBefore ? resolve() : requestAnimationFrame(wait));
        wait();
      });
      const panel = document.querySelector('#inspector [data-panel="hotspots"]');
      // the rings as they stand, without the ring that travels
      const rings = panel.hotspots.rings.map((ring) => ({ rank: ring.rank, x: ring.x, y: ring.y, r: ring.r, bx: ring.bx, by: ring.by }));
      const layer = movement.env.layer;
      const g = layer.getContext('2d');
      const at = (px, py) => Array.from(g.getImageData(Math.round(px), Math.round(py), 1, 1).data);
      // round each rank's disc, 6 px from its middle (the number is inside that)
      const discs = rings.map((ring) => [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => at(ring.bx + 6 * Math.cos((angle * Math.PI) / 180), ring.by + 6 * Math.sin((angle * Math.PI) / 180))));
      // what is drawn over what: every circle the marks draw, in the order they are drawn
      const arcs = [];
      const real = CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc = function arc(x, y, r, ...rest) {
        if (this.canvas === layer) arcs.push({ x, y, r });
        return real.call(this, x, y, r, ...rest);
      };
      try {
        movement.env.paintMarks();
      } finally {
        CanvasRenderingContext2D.prototype.arc = real;
      }
      const rankAt = (arc, key) => {
        const ring = rings.find((each) => Math.abs(each[key[0]] - arc.x) < 0.01 && Math.abs(each[key[1]] - arc.y) < 0.01);
        return ring ? ring.rank : null;
      };
      const order = arcs.map((arc) => (arc.r === rings[0].r && rankAt(arc, ['x', 'y']) !== null ? 'ring ' + rankAt(arc, ['x', 'y']) : rankAt(arc, ['bx', 'by']) !== null ? 'rank ' + rankAt(arc, ['bx', 'by']) : 'other'));
      const style = getComputedStyle(document.documentElement);
      return { rings, discs, order, zoom: movement.view.zoom, accent: style.getPropertyValue('--accent').trim(), pulse: panel.dataset.pulse };
    });
    const hex = (value) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
    const accent = hex(seen.accent);
    const isAccent = (got) => got[3] === 255 && got.slice(0, 3).every((value, index) => Math.abs(value - accent[index]) <= 30);
    assert.equal(Math.round(seen.zoom * 100), 25);
    assert.equal(seen.pulse, 'still', 'a ring is travelling: the lines read are not the rings’ own');
    assert.deepEqual(seen.rings.map((ring) => ring.rank).filter((rank, index, all) => all.indexOf(rank) === index), [1, 2, 3]);
    const overlapping = seen.rings.some((a, i) => seen.rings.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r));
    assert.ok(overlapping, 'no two rings lie over one another at 25 %: the case tests nothing. ' + JSON.stringify(seen.rings));
    // every rank on a spot of its own
    seen.rings.forEach((a, i) => seen.rings.forEach((b, j) => {
      if (j > i) assert.ok(Math.hypot(a.bx - b.bx, a.by - b.by) >= 17, 'the ranks of ' + a.rank + ' and ' + b.rank + ' lie on one another: ' + JSON.stringify([a, b]));
    }));
    // and whole: its disc is its own colour all the way round, with no ring's light edge through it
    seen.rings.forEach((ring, index) => {
      for (const got of seen.discs[index]) assert.ok(isAccent(got), 'a line runs through the rank of place ' + ring.rank + ': ' + got);
    });
    // the busiest place's ring is drawn last of the rings, so it is over the others; and every rank after every ring, the busiest's last
    assert.deepEqual(seen.order, ['ring 3', 'ring 2', 'ring 1', 'rank 3', 'rank 2', 'rank 1'], 'what the marks drew, in order');
  });
});

// ---------------------------------------------------------------- W9: a finger's targets

// Every control of the movement surface that is on screen, with the smaller
// side of what a finger has to hit: the control, or the label a box or a
// radio button sits in.
const targets = (page, roots) => page.evaluate((wanted) => {
  const found = [];
  const seen = new Set();
  for (const root of document.querySelectorAll(wanted)) {
    for (const el of root.querySelectorAll('button, select, input, [role="radio"]')) {
      const target = el.matches('input[type="radio"], input[type="checkbox"]') ? el.closest('label') : el;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.getClientRects().length === 0 || getComputedStyle(target).visibility !== 'visible' || target.closest('[inert]')) continue;
      const rect = target.getBoundingClientRect();
      found.push({ what: (el.dataset.action || el.dataset.control || el.name || el.getAttribute('aria-label') || el.dataset.transition || el.className || el.tagName) + ' "' + target.textContent.trim().slice(0, 24) + '"', width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 });
    }
  }
  return found;
}, roots || '.mov, .mov-floors');

for (const [name, size] of [['under 640 px (390 by 844)', PHONE], ['with a coarse pointer at 768 by 1024', { ...TABLET, mobile: true }]]) {
  test('W9: ' + name + ' every control of the movement surface is at least 44 px in its smaller dimension', async () => {
    await on('#movement', size, async (p) => {
      // openPlanner's own protocol session can leave this Chromium saying the pointer is fine: say again that it is a touch device
      if (!(await p.evaluate(() => matchMedia('(pointer: coarse)').matches))) {
        await p.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        await p.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        await drawn(p);
      }
      assert.equal(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'this page is not a touch device, so the sizes prove nothing');
      await dismissStarted(p);
      // everything out: the controls, a chosen group with its chip and the picker, More, the legend
      if (await p.$eval('.mov-top', (el) => el.dataset.folded === 'true')) await p.evaluate(() => document.querySelector('[data-action="change"]').click());
      await changeMap(p, { who: 'groups', groupIds: ['gsample06a', 'gsample07a'], transition: 5 });
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      const docked = await p.$eval('.mov-legend', (el) => el.dataset.docked === 'true');
      if (docked) await p.evaluate(() => document.querySelector('[data-action="scale"]').click());
      await shows(p, () => !document.querySelector('[data-part="more"]').hidden && getComputedStyle(document.querySelector('.mov-legend')).visibility === 'visible' && document.querySelectorAll('.mov-chips .chip').length === 2);
      const all = await targets(p);
      // the case names what it looked at: every kind the design lists is among them
      const names = all.map((each) => each.what).join(' | ');
      for (const wanted of ['change', 'movement-who', 'day', 'labels', 'constant-width', 'clear', 'add-group', 'Take 6A off the map', 'play', 'previous', 'next', 'scrubber', 'speed', 'loop', 'more', 'playback-pace', 'playback-size', 'zoom-in', 'zoom-out', 'fit', 'fold-legend', 'movement-scale', 'movement-floors', 'movement-arrange']) {
        assert.ok(names.includes(wanted), wanted + ' was not measured: ' + names);
      }
      assert.ok(all.filter((each) => each.what.startsWith('5 ') || /^\d+ "/.test(each.what) || each.what.startsWith('all "')).length >= 8, 'the transition strip’s segments were not measured: ' + names);
      const small = all.filter((each) => Math.min(each.width, each.height) < 43.5);
      assert.deepEqual(small, [], small.length + ' of ' + all.length + ' controls are under 44 px');

      // SV2-52 item 6: and the inspector's sheet, on each of its four tabs
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      if (await p.$eval('#inspector', (el) => el.dataset.open !== 'true')) await p.evaluate(() => document.getElementById('inspector-toggle').click());
      await shows(p, () => document.getElementById('inspector').dataset.open === 'true');
      const sheet = [];
      for (const tab of ['hotspots', 'tables', 'summary', 'export']) {
        await p.evaluate((id) => document.querySelector('.mov-inspector [role="tab"][data-tab="' + id + '"], .mov-inspector #tab-' + id + ', .mov-inspector [aria-controls$="' + id + '"]')?.click(), tab);
        await shows(p, (id) => {
          const panel = document.querySelector('[data-panel="' + id + '"]');
          return panel && panel.getClientRects().length > 0;
        }, tab);
        // above 640 px a place's cells open under it (on a phone its button is
        // "Show its N cells", which shuts the sheet: measured as it stands)
        if (tab === 'hotspots' && size.width > 640) {
          await p.evaluate(() => document.querySelector('[data-panel="hotspots"] [data-action="cells"]')?.click());
          await shows(p, () => document.querySelector('[data-panel="hotspots"] [data-action="show-cell"]') !== null || document.querySelector('[data-panel="hotspots"] [data-action="cells"]') === null);
        }
        sheet.push(...(await targets(p, '#inspector')));
      }
      const sheetNames = sheet.map((each) => each.what).join(' | ');
      for (const wanted of ['show "', 'cells "', ...(size.width > 640 ? ['show-cell "'] : []), 'png', 'print-picture', 'print-congestion', 'tabs__tab']) {
        assert.ok(sheetNames.includes(wanted), wanted + ' was not measured on the inspector’s sheet: ' + sheetNames);
      }
      const smallSheet = sheet.filter((each) => Math.min(each.width, each.height) < 43.5);
      assert.deepEqual(smallSheet, [], smallSheet.length + ' of ' + sheet.length + ' controls of the inspector’s sheet are under 44 px');
    });
  });
}

// ---------------------------------------------------------------- W10 and item 4: touch

function touch(cdp, type, fingers) {
  return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map((finger) => ({ x: Math.round(finger.x), y: Math.round(finger.y), id: finger.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

const mapView = (page) => page.evaluate(() => {
  const movement = document.querySelector('.mov').movement;
  const plan = document.getElementById('movement-plan').getBoundingClientRect();
  return { zoom: movement.view.zoom, x: movement.view.x, y: movement.view.y, fitted: movement.fitted, plan: { left: plan.left, top: plan.top, width: plan.width, height: plan.height } };
});

for (const [name, size] of [['768 by 1024', { ...TABLET, mobile: true }], ['390 by 844', PHONE]]) {
  test('W10 and item 4, at ' + name + ': on the movement map two fingers pinch about the point between them, and one finger moves the map and leaves the zoom alone', async () => {
  await on('#movement', size, async (p) => {
    await dismissStarted(p);
    const cdp = await p.createCDPSession();
    try {
      const before = await mapView(p);
      const mid = { x: before.plan.left + before.plan.width / 2, y: before.plan.top + before.plan.height / 2 };
      // two fingers 80 px apart, drawn out to 280
      await touch(cdp, 'touchStart', [{ x: mid.x - 40, y: mid.y, id: 1 }]);
      await touch(cdp, 'touchStart', [{ x: mid.x - 40, y: mid.y, id: 1 }, { x: mid.x + 40, y: mid.y, id: 2 }]);
      for (const reach of [60, 80, 100, 120, 140]) await touch(cdp, 'touchMove', [{ x: mid.x - reach, y: mid.y, id: 1 }, { x: mid.x + reach, y: mid.y, id: 2 }]);
      await touch(cdp, 'touchEnd', []);
      await shows(p, (was) => document.querySelector('.mov').movement.view.zoom > was * 3, before.zoom);
      const pinched = await mapView(p);
      assert.ok(Math.abs(pinched.zoom / before.zoom - 3.5) < 0.2, 'the zoom went from ' + before.zoom + ' to ' + pinched.zoom + ', not by the 3.5 the fingers drew out');
      assert.equal(pinched.fitted, false);
      // about the point between the fingers: what was under it still is
      const still = await p.evaluate((was, at) => {
        const view = document.querySelector('.mov').movement.view;
        // the cell that was under the middle before, where it is now
        const cell = { x: (at.x - was.plan.left - was.x) / (24 * was.zoom), y: (at.y - was.plan.top - was.y) / (24 * was.zoom) };
        const now = view.toScreen(cell.x, cell.y);
        return { dx: now.x - (at.x - was.plan.left), dy: now.y - (at.y - was.plan.top), size: view.size / view.zoom };
      }, before, mid);
      assert.equal(still.size, 24, 'a cell is not 24 px at 100 %: the arithmetic of this case is off');
      assert.ok(Math.abs(still.dx) <= 3 && Math.abs(still.dy) <= 3, 'the map slid under the fingers by ' + JSON.stringify(still));

      // one finger, 90 px right and 60 down
      const from = { x: mid.x - 100, y: mid.y - 80 };
      await touch(cdp, 'touchStart', [{ ...from, id: 1 }]);
      for (let i = 1; i <= 6; i += 1) await touch(cdp, 'touchMove', [{ x: from.x + 15 * i, y: from.y + 10 * i, id: 1 }]);
      await touch(cdp, 'touchEnd', []);
      await shows(p, (was) => Math.abs(document.querySelector('.mov').movement.view.x - was) > 50, pinched.x);
      const moved = await mapView(p);
      assert.equal(moved.zoom, pinched.zoom, 'a one-finger drag changed the zoom');
      assert.ok(Math.abs(moved.x - pinched.x - 90) <= 12 && Math.abs(moved.y - pinched.y - 60) <= 12, 'the map moved by ' + (moved.x - pinched.x) + ', ' + (moved.y - pinched.y) + ', not by the finger’s 90, 60');
      // the drag opened no card
      assert.equal(await p.$eval('.mov-card', (el) => el.hidden), true);
    } finally {
      await cdp.detach();
    }
  });
  });
}

test('item 4: at 390 px a tap on a corridor cell opens its card and keeps it; a tap on the same cell, or off the corridors, puts it away', async () => {
  await on('#movement', PHONE, async (p) => {
    await dismissStarted(p);
    assert.ok((await box(p, '#movement-plan')).height >= 380, 'the map has no height to tap on');
    // a corridor cell of Floor 1 that is on screen, clear of the zoom buttons and of the map's edge
    const spot = await p.evaluate(() => {
      const movement = document.querySelector('.mov').movement;
      const floor = movement.state.project.building.floors[0];
      const plan = document.getElementById('movement-plan').getBoundingClientRect();
      const zoom = document.querySelector('.mov-zoom').getBoundingClientRect();
      for (let cell = 0; cell < floor.cells.length; cell += 1) {
        if (floor.cells[cell] !== '#') continue;
        const at = movement.cellAt(floor.id, cell);
        if (!at || at.x < 30 || at.x > plan.width - 30 || at.y < 30 || at.y > plan.height - 30) continue;
        const x = plan.left + at.x;
        const y = plan.top + at.y;
        if (x >= zoom.left - 10 && x <= zoom.right + 10 && y >= zoom.top - 10 && y <= zoom.bottom + 10) continue;
        return { floorId: floor.id, cell, x, y, floor: floor.name };
      }
      return null;
    });
    assert.ok(spot, 'no corridor cell of Floor 1 is on the phone’s map');
    await p.touchscreen.tap(spot.x, spot.y);
    await shows(p, (wanted) => {
      const card = document.querySelector('.mov-card');
      return !card.hidden && card.dataset.cell === String(wanted.cell) && card.dataset.floor === wanted.floorId;
    }, spot);
    // read through what is really on screen: the card has a box, and it is inside the map
    const card = await box(p, '.mov-card');
    const stage = await box(p, '.mov-stage');
    assert.ok(card, 'the card has no box');
    assert.ok(card.left >= stage.left && card.right <= stage.right && card.top >= stage.top && card.bottom <= stage.bottom, 'the card runs out of the map: ' + JSON.stringify({ card, stage }));
    assert.equal(await p.$eval('.mov-card__place', (el) => el.getClientRects().length > 0), true);
    assert.match(await text(p, '.mov-card__place'), new RegExp(' · ' + spot.floor + '$'));
    assert.match(await text(p, '.mov-card__load'), /^(\d+ students at its busiest|Nobody on screen crosses here)/);
    assert.equal(await p.evaluate(() => document.querySelector('.mov').movement.point.source), 'tap');
    // it is kept: a moment later, with nothing touched, it is still there
    await p.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.equal(await p.$eval('.mov-card', (el) => el.hidden), false);
    // the same cell again: away
    await p.touchscreen.tap(spot.x, spot.y);
    await shows(p, () => document.querySelector('.mov-card').hidden);
    // up again, then a tap between the floors: away
    await p.touchscreen.tap(spot.x, spot.y);
    await shows(p, () => !document.querySelector('.mov-card').hidden);
    const empty = await p.evaluate(() => {
      const movement = document.querySelector('.mov').movement;
      const plan = document.getElementById('movement-plan').getBoundingClientRect();
      const slot = movement.world.slots[0];
      // above the first floor's box, in the row of its name
      const at = movement.view.toScreen(slot.x + 1, slot.y - 0.6);
      return { x: plan.left + at.x, y: plan.top + at.y };
    });
    await p.touchscreen.tap(empty.x, empty.y);
    await shows(p, () => document.querySelector('.mov-card').hidden);
    // none of it moved the map or zoomed it
    assert.equal(await p.evaluate(() => document.querySelector('.mov').movement.fitted), true);
  });
});

// ---------------------------------------------------------------- item 2: the map from before a change that could not be answered

// Stand in for the engine: an answer that fails, one that waits to be let go, or the real one again.
const engine = (page, kind) => page.evaluate((which) => {
  const derived = globalThis.sv2.store.derived;
  if (!globalThis.sv2Kept) globalThis.sv2Kept = derived.engine;
  const real = globalThis.sv2Kept;
  if (which === 'fails') derived.use({ results: () => new Promise((resolve, reject) => { setTimeout(() => reject(new Error('The engine stopped')), 0); }) });
  else if (which === 'waits') {
    const gate = new Promise((resolve) => { globalThis.sv2LetGo = resolve; });
    derived.use({ results: () => gate.then(() => real.results()) });
  } else derived.use(real);
}, kind);

const renameGroup = (page, name) => page.evaluate(async (next) => {
  const { editGroup } = await import('./engine/actions.js');
  globalThis.sv2.store.apply(editGroup, { id: 'gsample07a', name: next });
}, name);

test('item 2: a map from before a change that could not be answered is muted under a band that says so, and the Summary says it of its figures', async () => {
  await on('#movement', DESK, async (p) => {
    await dismissStarted(p);
    const look = () => p.evaluate(() => {
      const band = document.querySelector('.mov-stale');
      const note = document.querySelector('#inspector [data-summary="stale"]');
      return {
        stale: document.querySelector('.mov').dataset.stale || null,
        band: band.getClientRects().length > 0 ? band.textContent : null,
        plan: getComputedStyle(document.getElementById('movement-plan')).filter,
        marks: getComputedStyle(document.querySelector('.mov-marks')).filter,
        note: note && note.getClientRects().length > 0 ? note.textContent : null,
        role: note ? note.getAttribute('role') : null,
      };
    });
    await p.evaluate(() => document.querySelector('#inspector [role="tab"][data-tab="summary"]').click());
    await shows(p, () => document.querySelector('#inspector [data-panel="summary"]') !== null);
    assert.deepEqual(await look(), { stale: null, band: null, plan: 'none', marks: 'none', note: null, role: 'status' });

    await engine(p, 'fails');
    await renameGroup(p, '7A West');
    await shows(p, () => document.querySelector('.mov').dataset.stale === 'true');
    const stale = await look();
    assert.equal(stale.band, 'From before your last change');
    assert.match(stale.plan, /grayscale\(0\.85\).*opacity\(0\.6\)/, 'the picture is not muted: ' + stale.plan);
    assert.equal(stale.marks, stale.plan, 'the marks are not muted with the map');
    assert.equal(stale.note, 'The routes could not be worked out after your last change. Every figure here is from before it.');
    // the band is along the top of the map, inside it, and takes no pointer from it
    const band = await box(p, '.mov-stale');
    const stage = await box(p, '.mov-stage');
    assert.ok(Math.abs(band.top - stage.top) <= 1 && Math.abs(band.width - stage.width) <= 1, JSON.stringify({ band, stage }));
    assert.equal(await p.$eval('.mov-stale', (el) => getComputedStyle(el).pointerEvents), 'none');
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'The routes could not be worked out: The engine stopped. The map and the figures are from before your last change.');

    // an answer comes: the band, the muting and the line go
    await engine(p, 'real');
    await renameGroup(p, '7A East');
    await drawn(p);
    assert.deepEqual(await look(), { stale: null, band: null, plan: 'none', marks: 'none', note: null, role: 'status' });
  });
});

// ---------------------------------------------------------------- item 3: an answer after the view has gone, and no engine at all

test('item 3: an answer that arrives after the view has gone changes nothing and breaks nothing', async () => {
  await on('#movement', DESK, async (p, session) => {
    await engine(p, 'waits');
    await renameGroup(p, '7A East');
    await shows(p, () => document.querySelector('.mov').dataset.pending === 'true');
    // the view is left with its answer still on the way
    await p.evaluate(() => {
      globalThis.sv2gone = document.querySelector('.mov');
    });
    await go(p, '#project');
    // from here on, with the shell's own word for the new section said: what is announced
    await p.evaluate(() => {
      globalThis.sv2said = [];
      globalThis.sv2watch = new MutationObserver(() => globalThis.sv2said.push(document.getElementById('announcer').textContent));
      globalThis.sv2watch.observe(document.getElementById('announcer'), { childList: true, characterData: true, subtree: true });
    });
    const before = await p.evaluate(() => ({ connected: globalThis.sv2gone.isConnected, pending: globalThis.sv2gone.dataset.pending, name: globalThis.sv2gone.movement.state.project.groups.find((group) => group.id === 'gsample07a').name, drawn: globalThis.sv2gone.querySelector('#movement-plan').dataset.drawn, clear: document.getElementById('surface').style.getPropertyValue('--toast-clear') }));
    assert.deepEqual([before.connected, before.pending, before.name, before.clear], [false, 'true', '7A', '']);
    // now it comes
    await p.evaluate(() => globalThis.sv2LetGo());
    await p.evaluate(() => globalThis.sv2.store.derived.results());
    const after = await p.evaluate(() => {
      globalThis.sv2watch.disconnect();
      return { pending: globalThis.sv2gone.dataset.pending, name: globalThis.sv2gone.movement.state.project.groups.find((group) => group.id === 'gsample07a').name, drawn: globalThis.sv2gone.querySelector('#movement-plan').dataset.drawn, said: globalThis.sv2said, section: document.querySelector('.surface__layout').dataset.section, clear: document.getElementById('surface').style.getPropertyValue('--toast-clear') };
    });
    assert.equal(after.name, '7A', 'the view that left took the answer and drew it');
    assert.equal(after.pending, 'true', 'it was touched after it had gone');
    assert.equal(after.drawn, before.drawn, 'it painted after it had gone');
    assert.deepEqual(after.said, [], 'it spoke after it had gone');
    assert.equal(after.clear, '', 'it measured its dock into another section’s surface');
    assert.equal(after.section, 'project');
    // back on the view: a new one, with the answer
    await engine(p, 'real');
    await go(p, '#movement');
    await drawn(p);
    assert.equal(await p.evaluate(() => document.querySelector('.mov').movement.state.project.groups.find((group) => group.id === 'gsample07a').name), '7A East');
    assert.deepEqual(session.problems(), CLEAN);
  });
});

test('item 3: with no engine attached the first line says the routes cannot be worked out, and nothing waits', async () => {
  await on('#project', DESK, async (p) => {
    await p.evaluate(() => {
      const derived = globalThis.sv2.store.derived;
      globalThis.sv2Kept = derived.engine;
      derived.use(null);
    });
    assert.equal(await p.evaluate(() => globalThis.sv2.store.derived.engine), null, 'the engine could not be taken away: the case tests nothing');
    await go(p, '#movement');
    await shows(p, () => document.querySelector('.mov')?.dataset.styled === 'true' && document.querySelector('#movement-line .mov-line__words').textContent !== '');
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'The routes could not be worked out: Nothing is attached to work out the routes.');
    assert.equal(await p.$eval('.mov', (el) => [el.dataset.pending || null, el.dataset.stale || null].join()), ',', 'nothing is awaited, and nothing older is drawn to be stale');
    assert.equal(await p.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await p.$eval('.mov-stale', (el) => el.hidden), true);
    // the engine attached again: the next look at the view has its routes
    await p.evaluate(() => globalThis.sv2.store.derived.use(globalThis.sv2Kept));
    await go(p, '#project');
    await go(p, '#movement');
    await drawn(p);
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'Showing 8 groups on A Day, all transitions. No route failed.');
  });
});

// ---------------------------------------------------------------- SV2-52: a short window, a scroll, 320 px

const SIDEWAYS = { width: 844, height: 390, mobile: true };
// two measures of one box, one rounded and one floored, agree to a pixel
const near = (a, b) => Math.abs(a - b) <= 1;
const SHORT = { width: 1280, height: 480 };

// Where the first line, the stage, the bar and the section's foot are, and
// what scrolls.
const short = (page) => page.evaluate(() => {
  const r = (selector) => {
    const el = document.querySelector(selector);
    if (!el || el.getClientRects().length === 0) return null;
    const rect = el.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) };
  };
  const section = document.querySelector('.mov');
  return {
    section: r('.mov'),
    surface: r('#surface'),
    line: r('#movement-line'),
    stage: r('.mov-stage'),
    bar: r('[data-bar="playback"]'),
    row: r('.mov-pb__row'),
    room: parseFloat(section.style.getPropertyValue('--mov-room')),
    scrolls: section.scrollHeight - section.clientHeight,
    scrolled: section.scrollTop,
    window: innerHeight,
  };
});
// the bar is wholly on the window, inside the section, and nothing (the inspector's handle) lies on its row
async function barOnScreen(page, step) {
  const at = await short(page);
  assert.ok(at.bar.top >= at.section.top && at.bar.bottom <= at.section.bottom, step + ': the bar is not inside the section: ' + JSON.stringify(at));
  assert.ok(at.bar.bottom <= at.window && at.section.bottom <= at.surface.bottom, step + ': the bar runs under the window or the surface: ' + JSON.stringify(at));
  const cut = await page.evaluate(() => {
    const row = document.querySelector('.mov-pb__row').getBoundingClientRect();
    return [0.25, 0.5, 0.75].map((y) => {
      const el = document.elementFromPoint(row.left + 4, row.top + row.height * y);
      return el && el.closest('[data-bar="playback"]') ? null : (el ? el.className || el.tagName : 'nothing');
    }).filter(Boolean);
  });
  assert.deepEqual(cut, [], step + ': something lies on the bar’s row');
  return at;
}

// The view has measured what the bar lies over (--mov-under, --toast-clear)
// with the section scrolled as it is now: after a scroll, the scroll event has come.
const lifted = (page) => shows(page, () => {
  const section = document.querySelector('.mov');
  return section.dataset.dockedAt === String(Math.round(section.scrollTop));
});

// The zoom buttons: wholly on the stage, above the bar, and what a finger
// meets at the middle of each is the button.
async function zoomClear(page, step) {
  await lifted(page);
  const at = await page.evaluate(() => {
    const r = (el) => {
      const rect = el.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) };
    };
    const zoom = document.querySelector('.mov-zoom');
    const met = [...zoom.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return el === button || button.contains(el) ? null : (el ? el.className || el.tagName : 'nothing');
    }).filter(Boolean);
    return { zoom: r(zoom), stage: r(document.querySelector('.mov-stage')), bar: r(document.querySelector('[data-bar="playback"]')), line: r(document.querySelector('.mov-top')), met };
  });
  assert.deepEqual(at.met, [], step + ': something lies on the zoom buttons: ' + JSON.stringify(at));
  assert.ok(at.zoom.bottom <= at.bar.top, step + ': the zoom buttons run under the bar: ' + JSON.stringify(at));
  assert.ok(at.zoom.top >= at.stage.top && at.zoom.bottom <= at.stage.bottom, step + ': the zoom buttons are not on the stage: ' + JSON.stringify(at));
  return at;
}

// SV2-55 item 0. On the live site after #562 a phone on its side (844 by
// 390, with touch) had a 41 px map with the zoom over it. The 44 px finger
// targets take 61 px more than a mouse's (the floors' row 16, the first line
// 20, the legend's line 17, the bar 8), and the stage had what was left. Its
// least is now 120 px (or the floors' box at Fit, when that is less): the
// section scrolls instead, the bar sticky at its foot, the zoom above it.
test('SV2-55 item 0: a phone on its side with touch, 844 by 390: the stage keeps its least of 120 px, the section scrolls with the bar at its foot, and the zoom buttons stand above the bar, at the top and at the end', async () => {
  await on('#movement', SIDEWAYS, async (p) => {
    assert.deepEqual(await p.evaluate(() => [matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints > 0]), [true, true], 'the page is not a touch screen’s: the case measures the wrong page');
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'true', 'under 900 px the controls open folded: the case tests the folded view');
    await dismissStarted(p);
    await drawn(p);
    // closing the message gave the map the focus, which brings it above the bar: back to the top
    await p.evaluate(() => {
      document.querySelector('.mov').scrollTop = 0;
    });
    await lifted(p);
    // the sample's floors fitted across 844 px are taller than 120 px, so the
    // least is 120 itself, or what the section has over the bar and the
    // legend's line when that is less: with the first line scrolled away the
    // whole stage is then on screen
    const top = await barOnScreen(p, 'at the top');
    const under = await p.evaluate(() => {
      const tall = (selector) => document.querySelector(selector).getBoundingClientRect().height;
      return Math.floor(document.querySelector('.mov').clientHeight - tall('[data-bar="playback"]') - tall('.mov-legend-line'));
    });
    const least = Math.min(120, under);
    assert.ok(least >= 100, 'the section has ' + under + ' px over the bar and the legend’s line: the case tests a smaller window than it says');
    assert.ok(top.stage.height >= least - 1, 'the stage is a strip under its least: ' + JSON.stringify(top));
    assert.ok(top.scrolls > 0, 'the section has less than the least and does not scroll: the stage was squeezed: ' + JSON.stringify(top));
    assert.equal(await p.evaluate(async () => {
      const { stageLeast } = await import('./ui/movement/layout.js');
      return stageLeast(document.querySelector('.mov').movement.world, document.querySelector('.mov-stage').clientWidth);
    }), 120, 'the view’s own rule gives another least for the sample at 844 px');
    assert.ok(top.line.top >= top.section.top, 'the first line is not on screen at the top');
    await zoomClear(p, 'at the top');
    // at the end the whole stage is on screen over the bar, the zoom in its corner
    await p.evaluate(() => {
      const section = document.querySelector('.mov');
      section.scrollTop = section.scrollHeight;
    });
    await shows(p, () => {
      const section = document.querySelector('.mov');
      return section.scrollTop >= section.scrollHeight - section.clientHeight - 1;
    });
    await drawn(p);
    const end = await barOnScreen(p, 'at the end');
    assert.ok(end.stage.top >= end.section.top - 1 && end.stage.bottom <= end.bar.top + 1, 'at the end the map is not all on screen: ' + JSON.stringify(end));
    const zoomEnd = await zoomClear(p, 'at the end');
    assert.ok(zoomEnd.stage.bottom - zoomEnd.zoom.bottom <= 13, 'at the end the zoom is not back in the stage’s corner: ' + JSON.stringify(zoomEnd));
    assert.ok(await inked(p) > 0.02, 'at the end the map is blank');
    // playing (the hint goes) and More open: the bar stays on screen, the zoom above it
    await p.evaluate(() => {
      const section = document.querySelector('.mov');
      section.scrollTop = 0;
    });
    await p.tap('[data-action="more"]');
    await shows(p, () => document.querySelector('[data-part="more"]').hidden === false);
    await shows(p, () => document.querySelector('.mov').dataset.measuredBar === String(document.querySelector('[data-bar="playback"]').offsetHeight));
    await barOnScreen(p, 'More open');
    await p.tap('[data-action="more"]');
    await shows(p, () => document.querySelector('[data-part="more"]').hidden === true);
  });
});

// SV2-57 item 3 (the review of SV2-55, probe.mjs): a building one row high
// and 200 cells long, on its floor's first row, is a box two cells high (the
// row and the margin drawnBox keeps under it) under the floor's name: fitted
// across 844 px, 4 x 24 x 25 % + 40 = 64 px, and the stage's
// least was that box: under the zoom box with its margins (70 px with
// touch), so the zoom lay over the whole map. The least is now never under
// what the zoom needs.
const lowBuilding = (page) => page.evaluate(() => {
  // not awaited by the evaluate: on a page with touch emulated Puppeteer drops the awaited promise
  import('./engine/actions.js').then(({ replaceProject }) => {
    const project = structuredClone(globalThis.sv2.store.project);
    const floor = project.building.floors[0];
    const width = 200;
    const row = 0;
    const cells = Array.from({ length: width * 5 }, (unused, index) => (Math.floor(index / width) === row && index % width >= 2 && index % width < width - 2 ? '#' : '.'));
    const room = (id, number, at, side) => ({ id, kind: 'room', cells: [row * width + at, row * width + at + 1], number, teacherIds: [], subjectId: null, wing: '', capacity: null, shared: false, doors: [{ cell: row * width + at + (side === 'e' ? 1 : 0), side }] });
    project.building.floors = [{ ...floor, width, height: 5, cells: cells.join(''), spaces: [room('rlowroom01', 'L1', 0, 'e'), room('rlowroom02', 'L2', width - 2, 'w')], corridors: [], exits: [], image: null }];
    project.building.connections = [];
    project.building.zones = [];
    project.onboarding.dismissed = true;
    globalThis.sv2.store.apply(replaceProject, { project, label: 'A building one row high' });
  });
});

test('SV2-57 item 3: a building one row high on a phone on its side with touch, 844 by 390: the stage is never under what the zoom buttons need, and at the section’s end they lie on it above the bar', async () => {
  await on('#movement', SIDEWAYS, async (p) => {
    assert.equal(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is not a touch screen’s: the case measures the wrong page');
    await dismissStarted(p);
    await drawn(p);
    await lowBuilding(p);
    await shows(p, () => document.querySelector('.mov').movement.world?.height === 4);
    await drawn(p);
    const at = await p.evaluate(async () => {
      const { fitZoom, FIT_MARGIN } = await import('./ui/movement/layout.js');
      const movement = document.querySelector('.mov').movement;
      const stage = document.querySelector('.mov-stage');
      const zoom = document.querySelector('.mov-zoom');
      const margin = parseFloat(getComputedStyle(zoom).left);
      const across = fitZoom({ width: movement.world.width, height: 1 }, stage.clientWidth, 10000, FIT_MARGIN);
      return { stage: stage.clientHeight, zoom: zoom.offsetHeight, margin, box: Math.ceil(movement.world.height * 24 * across + FIT_MARGIN * 2) };
    });
    assert.equal(at.zoom, 46, 'the zoom buttons are not a finger’s 44 px: ' + JSON.stringify(at));
    assert.ok(at.box < at.zoom + at.margin * 2, 'the floors’ box at Fit is not under what the zoom needs: the case tests nothing: ' + JSON.stringify(at));
    assert.ok(at.stage < 120, 'the stage is not at its least: the case tests nothing: ' + JSON.stringify(at));
    assert.ok(at.stage >= at.zoom + at.margin * 2, 'the stage is under what the zoom buttons need: ' + JSON.stringify(at));
    await p.evaluate(() => {
      const section = document.querySelector('.mov');
      section.scrollTop = section.scrollHeight;
    });
    await shows(p, () => {
      const section = document.querySelector('.mov');
      return section.scrollTop >= section.scrollHeight - section.clientHeight - 1;
    });
    await drawn(p);
    await zoomClear(p, 'at the end');
  });
});

// Press Tab until the focus is on what `selector` finds (at most 80 times).
async function tabTo(page, selector) {
  for (let press = 0; press < 80; press += 1) {
    if (await page.evaluate((wanted) => document.activeElement === document.querySelector(wanted), selector)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('80 Tabs did not reach ' + selector);
}
// what the focus is on: its box, the bar's, and whether a finger at its middle meets it
const focusedClear = (page) => page.evaluate(() => {
  const el = document.activeElement;
  const rect = el.getBoundingClientRect();
  const met = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const bar = document.querySelector('[data-bar="playback"]').getBoundingClientRect();
  return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), barTop: Math.round(bar.top), onTop: met === el || el.contains(met), what: el.getAttribute('aria-label') || el.textContent };
});

// SV2-55 item 1 (reproduced by the Foreman, s52/f1-1280x480-controls.png): at
// 1280 by 480 with the controls shown and the section at its top the bar,
// sticky at the section's foot, lay over the zoom buttons (465 to 503 under a
// bar from 400) and the docked legend line, and a focused Zoom in stayed
// under it. Now the zoom stands above the bar, and what the focus brings into
// view lands above it (scroll-padding-bottom).
for (const [name, size] of [['1280 by 480', SHORT], ['844 by 390 with touch', SIDEWAYS]]) {
  test('SV2-55 item 1: ' + name + ' with the controls shown and the section at its top: the zoom buttons are above the bar, Zoom in with the focus is above it, and the legend’s Scale with the focus is brought above it', async () => {
    await on('#movement', size, async (p) => {
      await dismissStarted(p);
      if (await p.$eval('.mov-top', (el) => el.dataset.folded) === 'true') {
        await p.click('[data-action="change"]');
        await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'false');
      }
      await drawn(p);
      // the section at its top (the map took the focus when the message closed, and came above the bar)
      await p.evaluate(() => {
        document.querySelector('.mov').scrollTop = 0;
      });
      await lifted(p);
      const at = await short(p);
      assert.ok(at.scrolls > 0, 'with the controls shown the section does not scroll: the case tests nothing: ' + JSON.stringify(at));
      assert.equal(at.scrolled, 0, 'the section is not at its top');
      assert.ok(at.stage.bottom > at.bar.top, 'the bar does not lie over the stage’s foot at the top: the case tests nothing: ' + JSON.stringify(at));
      // where some of the stage is on screen over the bar the zoom stands on that part; at 844 by
      // 390 the shown controls fill the window and the whole stage starts under the bar
      if (at.stage.top < at.bar.top) await zoomClear(p, 'controls shown, at the top');
      else assert.equal(size, SIDEWAYS, 'at 1280 by 480 none of the stage is on screen at the top: ' + JSON.stringify(at));

      // Tab from Change to Zoom in: it has the focus, on screen, above the bar
      await p.focus('[data-action="change"]');
      await tabTo(p, '[data-action="zoom-in"]');
      await lifted(p);
      const zoomIn = await focusedClear(p);
      assert.equal(zoomIn.what, 'Zoom in');
      assert.ok(zoomIn.bottom <= zoomIn.barTop && zoomIn.onTop, 'Zoom in has the focus under the bar: ' + JSON.stringify(zoomIn));

      // the docked legend's Scale, under the bar at the top, comes above it with the focus
      if (await p.$eval('.mov-legend-line', (el) => !el.hidden)) {
        await p.evaluate(() => {
          document.querySelector('.mov').scrollTop = 0;
        });
        await lifted(p);
        const under = await p.evaluate(() => document.querySelector('.mov-legend-line').getBoundingClientRect().bottom > document.querySelector('[data-bar="playback"]').getBoundingClientRect().top);
        assert.equal(under, true, 'the legend’s line is not under the bar at the top: the case tests nothing');
        await tabTo(p, '.mov-legend-line__open');
        await lifted(p);
        const scale = await focusedClear(p);
        assert.ok(scale.bottom <= scale.barTop && scale.onTop, 'Scale has the focus under the bar: ' + JSON.stringify(scale));
      } else {
        assert.equal(size, SHORT, 'at 844 by 390 the legend is docked');
      }
    });
  });
}

// SV2-55 items 2 and 4: a storage banner is stuck to the surface's top over
// the section. The section had the surface's whole height under it, so the
// bar at its foot went below the window by the banner's height.
const saveFails = async (page) => {
  // the import is not awaited by the evaluate: on a page with touch emulated
  // Puppeteer drops the awaited promise ("Promise was collected")
  await page.evaluate(() => {
    globalThis.sv2.storage.hooks.failWrite = 'The disk is full (a test made this up)';
    import('./engine/actions.js').then(({ setSetting }) => {
      const mode = globalThis.sv2.store.project.settings.colourScale.mode;
      globalThis.sv2.store.apply(setSetting, { key: 'colourScale.mode', value: mode === 'relative' ? 'absolute' : 'relative' });
    });
  });
  await shows(page, () => document.getElementById('banner-save-failed') !== null);
};
// measured as drawn, rounded up (SV2-57 item 4): offsetHeight rounds, and a
// banner 57.4 px tall left 0.4 px of it over what the room was kept for
const bannerMeasured = (page) => shows(page, () => {
  const host = document.getElementById('storage-banners');
  return document.getElementById('surface').style.getPropertyValue('--banners-height') === Math.ceil(host.getBoundingClientRect().height) + 'px';
});

for (const [name, size] of [['1280 by 800', DESK], ['1280 by 480', SHORT], ['844 by 390 with touch', SIDEWAYS], ['390 by 844 with touch', PHONE]]) {
  test('SV2-55 items 2 and 4: at ' + name + ' the not-saved banner never pushes the bar below the window: the section has what the banner leaves, measured (--banners-height)', async () => {
    await on('#movement', size, async (p) => {
      await dismissStarted(p);
      await drawn(p);
      await saveFails(p);
      await bannerMeasured(p);
      await shows(p, () => document.querySelector('.mov').dataset.measuredBar === String(document.querySelector('[data-bar="playback"]').offsetHeight));
      const banner = await box(p, '#banner-save-failed');
      assert.ok(banner && banner.height > 40, 'the banner is not on screen');
      const at = await barOnScreen(p, 'under the banner');
      assert.ok(at.section.top >= Math.round(banner.bottom) - 1, 'the section starts under the banner’s top, behind it: ' + JSON.stringify({ banner, section: at.section }));
      assert.equal(await p.$eval('#surface', (el) => el.scrollHeight - el.clientHeight), 0, 'the surface scrolls: the banner pushed the section down');
      await p.evaluate(() => {
        globalThis.sv2.storage.hooks.failWrite = null;
      });
    });
  });
}

// SV2-57 item 4: the banners' height is their box as drawn, rounded up, so a
// fraction of a pixel never lies over the room kept for it. offsetHeight
// rounds to the nearest: a box 10.4 px taller read as 10 px.
test('SV2-57 item 4: --banners-height is the banners’ box rounded up, not offsetHeight: a box 0.4 px over a whole pixel counts the next pixel', async () => {
  await on('#movement', DESK, async (p) => {
    await dismissStarted(p);
    await drawn(p);
    await saveFails(p);
    await bannerMeasured(p);
    const was = await p.evaluate(() => document.getElementById('surface').style.getPropertyValue('--banners-height'));
    await p.evaluate(() => {
      const host = document.getElementById('storage-banners');
      host.style.minHeight = (Math.ceil(host.getBoundingClientRect().height) + 10.4) + 'px';
    });
    // the banners' observer has run for the new box
    await shows(p, (old) => document.getElementById('surface').style.getPropertyValue('--banners-height') !== old, was);
    const at = await p.evaluate(() => {
      const host = document.getElementById('storage-banners');
      return { set: document.getElementById('surface').style.getPropertyValue('--banners-height'), box: host.getBoundingClientRect().height, offset: host.offsetHeight };
    });
    assert.ok(at.box % 1 > 0.2 && at.box % 1 < 0.5, 'the box is not a fraction under a half over a whole pixel: the case tests nothing: ' + JSON.stringify(at));
    assert.equal(at.set, Math.ceil(at.box) + 'px', 'the banners’ height is not their box rounded up: ' + JSON.stringify(at));
    await p.evaluate(() => {
      document.getElementById('storage-banners').style.minHeight = '';
      globalThis.sv2.storage.hooks.failWrite = null;
    });
  });
});

// SV2-55 item 4: until --banners-height is set, the surface keeps an
// allowance for the banners at the top of what it scrolls to; the allowance
// is never more than half the surface (13rem at 640 px wide was 208 px of a
// 222 px surface on a small phone on its side).
test('SV2-55 item 4: a control brought into view lands under the banners by their measured height, and by no more than half the surface when it is not measured, at 640 by 360 with touch', async () => {
  await on('#movement', { width: 640, height: 360, mobile: true }, async (p) => {
    await dismissStarted(p);
    await drawn(p);
    await saveFails(p);
    await bannerMeasured(p);
    // a tall block on the surface with a target at its top, brought into view as the focus brings a control
    const landed = (unset) => p.evaluate((drop) => {
      const surface = document.getElementById('surface');
      if (drop) surface.style.removeProperty('--banners-height');
      const block = document.createElement('div');
      block.style.height = '3000px';
      const target = document.createElement('span');
      target.textContent = 'target';
      block.append(target);
      surface.append(block);
      surface.scrollTop = surface.scrollHeight;
      target.scrollIntoView({ block: 'start' });
      const at = target.getBoundingClientRect().top - surface.getBoundingClientRect().top;
      block.remove();
      surface.scrollTop = 0;
      return { at: Math.round(at), half: Math.round(surface.clientHeight / 2), banners: document.getElementById('storage-banners').offsetHeight };
    }, unset);
    const measured = await landed(false);
    assert.ok(Math.abs(measured.at - measured.banners) <= 1, 'the room kept is not the banners’ measured height: ' + JSON.stringify(measured));
    const fallback = await landed(true);
    assert.ok(fallback.at <= fallback.half + 1, 'the allowance pads more than half the surface: ' + JSON.stringify(fallback));
    assert.ok(fallback.at > 0, 'no allowance at all for the banners: ' + JSON.stringify(fallback));
    await p.evaluate(() => {
      globalThis.sv2.storage.hooks.failWrite = null;
    });
  });
});

test('SV2-52 item 1: a short desktop window, 1280 by 480: with the controls shown the section scrolls and the bar stays at its foot, top or end; folded, nothing scrolls', async () => {
  await on('#movement', SHORT, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false', 'from 900 px the controls open shown: the case tests the shown view');
    const top = await barOnScreen(p, 'scrolled to the top');
    assert.ok(top.scrolls > 0, 'with the controls shown the section does not scroll: the case tests nothing: ' + JSON.stringify(top));
    assert.ok(top.room > 100, 'what the section has for the map is not measured (--mov-room): ' + JSON.stringify(top));
    assert.ok(top.stage.height >= top.room, 'the stage was squeezed under what the section has: ' + JSON.stringify(top));
    await p.evaluate(() => {
      const section = document.querySelector('.mov');
      section.scrollTop = section.scrollHeight;
    });
    await shows(p, () => {
      const section = document.querySelector('.mov');
      return section.scrollTop >= section.scrollHeight - section.clientHeight - 1;
    });
    const end = await barOnScreen(p, 'scrolled to the end');
    // at the end the whole stage is on screen over the bar
    assert.ok(end.stage.top >= end.section.top && end.stage.bottom <= end.bar.top, 'at the end the map is not all on screen: ' + JSON.stringify(end));
    // folded: the first line, the map and the bar in the window, nothing to scroll
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await drawn(p);
    const folded = await barOnScreen(p, 'folded');
    assert.equal(folded.scrolls, 0, 'folded, the section scrolls: ' + JSON.stringify(folded));
    assert.ok(near(folded.stage.height, folded.room), 'folded, the stage is not what the section has: ' + JSON.stringify(folded));
  });
});

// How much of the map's canvas is floors and lanes rather than the empty
// field it is drawn on: the share of sampled pixels that are not the field's colour.
const inked = (page) => page.evaluate(() => {
  const canvas = document.getElementById('movement-plan');
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const field = [data[0], data[1], data[2]].join();
  let ink = 0;
  let all = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    all += 1;
    if ([data[i], data[i + 1], data[i + 2]].join() !== field) ink += 1;
  }
  return ink / all;
});
const viewAt = (page) => page.evaluate(() => {
  const view = document.querySelector('.mov').movement.view;
  return { x: Math.round(view.x), y: Math.round(view.y), zoom: view.zoom };
});
// one turn of a mouse wheel over the stage, at a point of it that is on screen
async function wheelOverMap(page, deltaY) {
  const at = await page.evaluate(() => {
    const stage = document.querySelector('.mov-stage').getBoundingClientRect();
    const section = document.querySelector('.mov').getBoundingClientRect();
    const top = Math.max(stage.top, section.top);
    return { x: Math.round(stage.left + stage.width / 2), y: Math.round(top + 20) };
  });
  const before = await page.evaluate(() => [document.querySelector('.mov').scrollTop, document.getElementById('movement-plan').dataset.drawn]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel({ deltaY });
  // the wheel has done what it does when the section has scrolled or the map has been drawn again
  await shows(page, (was) => document.querySelector('.mov').scrollTop !== was[0] || document.getElementById('movement-plan').dataset.drawn !== was[1], before);
}

// the floors' box against the stage: how far it reaches into it from above and below
const floorsOnStage = (page) => page.evaluate(() => {
  const movement = document.querySelector('.mov').movement;
  const view = movement.view;
  const world = movement.world;
  return { top: Math.round(view.y), bottom: Math.round(view.y + world.height * view.size), left: Math.round(view.x), right: Math.round(view.x + world.width * view.size), width: view.width, height: view.height };
});
const onStage = (box) => box.bottom >= 47 && box.top <= box.height - 47 && box.right >= 47 && box.left <= box.width - 47;

test('SV2-52 item 2: a wheel over the map scrolls the section while the map is not all on screen, then moves the map, and never off the stage: 1280 by 480 with the controls shown', async () => {
  await on('#movement', SHORT, async (p) => {
    await dismissStarted(p);
    await drawn(p);
    // closing the message gave the map the focus, which brought it above the bar (SV2-55): back to the top
    await p.evaluate(() => {
      document.querySelector('.mov').scrollTop = 0;
    });
    await lifted(p);
    const ink = await inked(p);
    assert.ok(ink > 0.02, 'the map has no floors drawn on arrival: the case tests nothing (' + ink + ')');
    const start = await viewAt(p);
    assert.ok((await short(p)).scrolls > 0, 'the section does not scroll with the controls shown: the case tests nothing');

    // the wheel scrolls the section, and the map stays where it was on the stage
    await wheelOverMap(p, 120);
    assert.ok(await p.$eval('.mov', (el) => el.scrollTop > 0), 'a wheel over the map did not scroll the section');
    assert.deepEqual(await viewAt(p), start, 'the wheel moved the map while the section had more to scroll');
    for (let turn = 0; turn < 10 && (await p.$eval('.mov', (el) => el.scrollTop < el.scrollHeight - el.clientHeight - 1)); turn += 1) await wheelOverMap(p, 120);
    assert.deepEqual(await viewAt(p), start, 'the map moved before the section reached its end');
    const end = await short(p);
    assert.ok(end.stage.top >= end.section.top - 1 && end.stage.bottom <= end.bar.top + 1, 'at the end the map is not all on screen: ' + JSON.stringify(end));
    // the floors are drawn on the map after the scroll, as before it
    await drawn(p);
    assert.ok(await inked(p) > ink * 0.8, 'after the section scrolled the map is blank');

    // the map all on screen: the wheel moves it, however far it turns, and the floors stay on the stage
    await wheelOverMap(p, 400);
    assert.notDeepEqual(await viewAt(p), start, 'with the map all on screen the wheel did not move it');
    for (let turn = 0; turn < 4; turn += 1) await wheelOverMap(p, 4000);
    const kept = await floorsOnStage(p);
    assert.ok(onStage(kept), 'the floors were moved off the stage: ' + JSON.stringify(kept));
    assert.ok(await inked(p) > 0.002, 'the map is blank after a long wheel');
  });
});

test('SV2-52 item 2: a phone on its side, 844 by 390: after a wheel over the map and the section scrolled to its end the floors are drawn on the stage, not only the hotspot rings', async () => {
  await on('#movement', SIDEWAYS, async (p) => {
    // the Foreman's steps on 5de6562 (land844-at-end.png)
    await dismissStarted(p);
    await drawn(p);
    assert.ok(await inked(p) > 0.02, 'the map has no floors drawn on arrival: the case tests nothing');
    await wheelOverMap(p, 400);
    await p.evaluate(() => {
      const section = document.querySelector('.mov');
      section.scrollTop = section.scrollHeight;
    });
    await drawn(p);
    const kept = await floorsOnStage(p);
    assert.ok(onStage(kept), 'the wheel took the floors off the stage: ' + JSON.stringify(kept));
    const ink = await inked(p);
    assert.ok(ink > 0.01, 'after the wheel and the scroll the map is blank (' + ink + ' of it drawn on)');
    // and the rings the hotspots draw are where the map has their places: on the stage too
    const rings = await p.evaluate(() => document.querySelector('[data-panel="hotspots"]').hotspots.rings.map((ring) => [Math.round(ring.x), Math.round(ring.y)]));
    const stage = await floorsOnStage(p);
    assert.ok(rings.length > 0 && rings.every(([x, y]) => x >= 0 && y >= 0 && x <= stage.width && y <= stage.height), 'a ring is off the stage: ' + JSON.stringify(rings));
  });
});

test('SV2-52 item 3: at 320 by 640 the bar fits: Play, the steps, the scrubber and More on the row, the clock on the countdown’s line, and nothing scrolls', async () => {
  await on('#movement', { width: 320, height: 640, mobile: true }, async (p) => {
    for (const step of ['before playback', 'playing']) {
      if (step === 'playing') {
        await p.evaluate(() => document.querySelector('[data-action="play"]').click());
        await shows(p, () => document.querySelector('[data-part="clock"]').textContent !== '' && document.querySelector('[data-action="play"]').textContent === 'Pause');
        await drawn(p);
      }
      const at = await barOnScreen(p, step);
      assert.equal(at.scrolls, 0, step + ': the section scrolls: ' + JSON.stringify(at));
      const row = await barRow(p);
      const parts = ['play', 'previous', 'next', 'scrubber', 'more'];
      for (const part of parts) assert.ok(row[part] && row[part].middle > row.play.top && row[part].middle < row.play.bottom, step + ': ' + part + ' is not on the row: ' + JSON.stringify(row));
      for (let i = 1; i < parts.length; i += 1) assert.ok(row[parts[i]].left >= row[parts[i - 1]].right, step + ': ' + parts[i] + ' is not after ' + parts[i - 1] + ': ' + JSON.stringify(row));
      assert.ok(row.play.left >= at.bar.left && row.more.right <= at.bar.right, step + ': the row runs out of the bar: ' + JSON.stringify(row));
      assert.ok(row.scrubber.width >= 64, step + ': the scrubber is ' + row.scrubber.width + ' px wide');
      if (step === 'playing') {
        const words = await p.evaluate(() => [...document.querySelectorAll('[data-part="clock"], [data-part="countdown"]')].map((el) => {
          const rect = el.getBoundingClientRect();
          return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) };
        }));
        const [clock, countdown] = words;
        assert.ok(clock.width > 30, 'the clock has no width: ' + JSON.stringify(words));
        assert.ok(clock.top >= row.play.bottom, 'the clock is still on the row: ' + JSON.stringify({ words, row }));
        assert.ok(clock.top < countdown.bottom && countdown.top < clock.bottom, 'the clock is not on the countdown’s line: ' + JSON.stringify(words));
      }
    }
  });
});

// ---------------------------------------------------------------- SV2-52 item 4: the legend's own Show, and the focus

test('SV2-52 item 4: the card folded while it stood on the map and shown again where it would lie on a floor docks and is brought out over the map, with the focus on its own button', async () => {
  await on('#movement', WIDE, async (p) => {
    await dismissStarted(p);
    assert.equal(await p.$eval('.mov-legend', (el) => el.dataset.docked), 'false', 'at 1440 by 900 the card stands on the map: the case tests nothing');
    // folded to its title, it is small enough to stand on a narrower map
    await p.click('[data-action="fold-legend"]');
    await shows(p, () => document.querySelector('.mov-legend').dataset.folded === 'true');
    await p.setViewport({ width: 1100, height: 800 });
    await drawn(p);
    assert.equal(await p.$eval('.mov-legend', (el) => el.dataset.docked), 'false', 'the folded card docked at 1100 by 800: the case tests nothing');
    await p.click('[data-action="fold-legend"]');
    await shows(p, () => document.querySelector('.mov-legend').dataset.folded === 'false');
    const at = await legendAndFloors(p);
    assert.equal(at.docked, 'true', 'shown whole at 1100 by 800 the card stands on the map: ' + JSON.stringify({ card: at.card, floors: at.floors }));
    assert.equal(await p.$eval('.mov-legend', (el) => el.dataset.open), 'true', 'Show put the card away into the line: the reader asked to see it');
    assert.equal(await focusedAs(p), 'fold-legend', 'the focus is not on the card’s own button');
    // its own button puts it away into the line, with the focus on Scale
    await p.click('[data-action="fold-legend"]');
    await shows(p, () => document.querySelector('.mov-legend').dataset.open === 'false');
    assert.equal(await focusedAs(p), 'scale');
  });
});

test('SV2-52 item 4: a card that docks with the focus in it gives the focus to Scale, and the line gives it back to the card when it stands on the map again', async () => {
  await on('#movement', WIDE, async (p) => {
    await dismissStarted(p);
    assert.equal(await p.$eval('.mov-legend', (el) => el.dataset.docked), 'false');
    await p.focus('.mov-legend input[name="movement-scale"]');
    await p.setViewport({ width: 1280, height: 900 });
    await shows(p, () => document.querySelector('.mov-legend').dataset.docked === 'true');
    assert.equal(await focusedAs(p), 'scale', 'docking the card dropped the focus');
    await p.setViewport({ width: 1440, height: 900 });
    await shows(p, () => document.querySelector('.mov-legend').dataset.docked === 'false');
    assert.equal(await focusedAs(p), 'fold-legend', 'the line put away dropped the focus');
  });
});

// ---------------------------------------------------------------- SV2-52 item 7: the dock, measured again

// What this case cannot tell apart, said out loud (#147): the view now
// measures the dock after a fold and whenever the bar changes height
// (ui/movement/index.js), and taking both of those calls out leaves the case
// green, because in this layout a fold and More each move the stage by a
// fraction of a pixel (237 to 237.22 px at 1280 by 480) and a fold scrolls
// the section back to its top, so the stage's observer and the scroll
// listener measure it too. The case holds the outcome: the message is clear
// of the dock after both.
test('SV2-52 item 7: a message clears the dock after the controls fold and after the bar grows, when the stage keeps its size', async () => {
  // 1280 by 480: the stage is what the section has, shown or folded, so a fold moves the map and its zoom buttons without resizing it
  await on('#movement', SHORT, async (p) => {
    await dismissStarted(p);
    await drawn(p);
    const shown = (await short(p)).stage.height;
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await drawn(p);
    assert.ok(near((await short(p)).stage.height, shown), 'folding changed the stage’s size: the case tests nothing');
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words }), HIDDEN_TOAST);
    await clearOfDock(p, 'folded');
    await closeToast(p);
  });
  // 1280 by 560, folded: the stage is all the section has, so More makes the bar taller and leaves the stage as it is
  await on('#movement', { width: 1280, height: 560 }, async (p) => {
    await dismissStarted(p);
    await p.click('[data-action="change"]');
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    await drawn(p);
    const before = (await short(p)).stage.height;
    await p.tap('[data-action="more"]');
    await shows(p, () => document.querySelector('.mov').dataset.measuredBar === String(document.querySelector('[data-bar="playback"]').offsetHeight));
    assert.ok(near((await short(p)).stage.height, before), 'More changed the stage’s size: the case tests nothing');
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words }), HIDDEN_TOAST);
    await clearOfDock(p, 'More open');
  });
});

// ---------------------------------------------------------------- SV2-52 item 9: crossings with the focus inside

const focusedAs = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? (el.dataset.action || el.dataset.control || el.name || el.tagName.toLowerCase()) : null;
});

test('SV2-52 item 9: under 640 px the floors’ row folds away with the focus in it, and the focus goes to Change', async () => {
  await on('#movement', { width: 700, height: 800 }, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'true', '700 px is under 900: the controls open folded');
    await p.focus('.mov-floors input[name="movement-floors"]');
    assert.equal(await focusedAs(p), 'movement-floors');
    await p.setViewport({ width: 600, height: 800 });
    await shows(p, () => !document.querySelector('.mov-floors')?.isConnected);
    assert.equal(await focusedAs(p), 'change', 'the focus went with the floors’ row');
  });
});

test('SV2-52 item 9: under 900 px the controls fold away with the focus in them, and the focus goes to Change', async () => {
  await on('#movement', { width: 1000, height: 800 }, async (p) => {
    assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false');
    await p.focus('[data-control="day"]');
    await p.setViewport({ width: 800, height: 800 });
    await shows(p, () => document.querySelector('.mov-top').dataset.folded === 'true');
    assert.equal(await focusedAs(p), 'change', 'the focus went with the controls');
  });
});

test('SV2-52 item 9: under 1100 px Speed goes behind More with the focus on it, More opens, and the focus stays on Speed', async () => {
  await on('#movement', WIDE, async (p) => {
    assert.equal(await p.$eval('[data-bar="playback"]', (el) => el.dataset.compact), 'false', 'Speed is not on the row at 1440: the case tests nothing');
    await p.focus('[data-control="speed"]');
    await p.setViewport({ width: 1050, height: 900 });
    await shows(p, () => document.querySelector('[data-bar="playback"]').dataset.compact === 'true');
    assert.equal(await focusedAs(p), 'speed', 'the focus went with Speed');
    assert.equal(await p.$eval('[data-part="more"]', (el) => el.hidden), false, 'Speed is behind a shut More');
  });
});

test('SV2-52 item 9: a place’s cells button says it opens them (aria-expanded) above 640 px and says nothing of the kind under it, after the window crosses either way', async () => {
  await on('#movement', { width: 700, height: 800 }, async (p) => {
    await dismissStarted(p);
    await p.evaluate(() => document.getElementById('inspector-toggle').click());
    await shows(p, () => document.getElementById('inspector').dataset.open === 'true' && document.querySelector('[data-panel="hotspots"] [data-action="cells"]') !== null);
    const expanded = () => p.$eval('[data-panel="hotspots"] [data-action="cells"]', (el) => el.getAttribute('aria-expanded'));
    assert.equal(await expanded(), 'false');
    await p.setViewport({ width: 600, height: 800 });
    await shows(p, () => matchMedia('(max-width: 640px)').matches);
    await shows(p, () => document.querySelector('[data-panel="hotspots"] [data-action="cells"]')?.getAttribute('aria-expanded') !== 'false').catch(() => {});
    assert.equal(await expanded(), null, 'under 640 px the button that shuts the sheet still says it opens the cells under the row');
    await p.setViewport({ width: 700, height: 800 });
    await shows(p, () => document.querySelector('[data-panel="hotspots"] [data-action="cells"]')?.getAttribute('aria-expanded') === 'false').catch(() => {});
    assert.equal(await expanded(), 'false', 'above 640 px again the button does not say whether the cells are open');
  });
});

test('SV2-52 item 9: an engine attached after the view opened with none is asked, with no visit elsewhere', async () => {
  await on('#project', DESK, async (p) => {
    await p.evaluate(() => {
      globalThis.sv2Kept = globalThis.sv2.store.derived.engine;
      globalThis.sv2.store.derived.use(null);
    });
    await go(p, '#movement');
    await shows(p, () => document.querySelector('.mov')?.dataset.styled === 'true' && document.querySelector('#movement-line .mov-line__words').textContent !== '');
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'The routes could not be worked out: Nothing is attached to work out the routes.', 'the view did open with no engine: the case tests nothing');
    await p.evaluate(() => globalThis.sv2.store.derived.use(globalThis.sv2Kept));
    const asked = await drawn(p).then(() => true, () => false);
    assert.equal(asked, true, 'the engine attached afterwards was never asked: the map has no routes');
    assert.equal(await text(p, '#movement-line .mov-line__words'), 'Showing 8 groups on A Day, all transitions. No route failed.');
  });
});

// ---------------------------------------------------------------- SV2-52 item 10: twelve periods at 900 to 1100 px

for (const width of [920, 1080]) {
  test('SV2-52 item 10: at ' + width + ' by 800, with the controls shown, a strip of eleven transitions keeps the stage’s floor', async () => {
    await on('#movement', { width, height: 800 }, async (p) => {
      assert.equal(await p.$eval('.mov-top', (el) => el.dataset.folded), 'false', 'from 900 px the controls are shown: the case tests nothing');
      await p.evaluate(async () => {
        globalThis.sv2Actions = await import('./engine/actions.js');
      });
      await p.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'periods', value: 12 }));
      await drawn(p);
      assert.equal(await p.$$eval('[data-control="transition"] [role="radio"], [data-control="transition"] input[type="radio"]', (els) => els.length >= 12), true, 'the strip has not twelve segments (All and eleven transitions)');
      const at = await short(p);
      const floor = Math.max(320, Math.ceil(800 * 0.45));
      // the section's own height at 800 holds the floor: it is the floor that is asked for, not the cap
      assert.ok(at.stage.height >= floor - 1, 'the strip squeezed the stage to ' + at.stage.height + ' px (floor ' + floor + ', the section has ' + at.room + '): ' + JSON.stringify(at));
    });
  });
}

// ---------------------------------------------------------------- SV2-52: scroll-padding-top on the surface (from SV2-50)

for (const [name, size] of [['1280 by 800', DESK], ['390 by 844', PHONE]]) {
  test('SV2-52: at ' + name + ', with a banner up, what is brought into view at the surface’s top is under the banner, not behind it', async () => {
    await on('#movement', size, async (p) => {
      // the import and the change in two evaluates: one that awaits an import and then applies can lose its promise (ARCHITECTURE 16, SV2-39)
      await p.evaluate(async () => {
        globalThis.sv2Actions = await import('./engine/actions.js');
      });
      await p.evaluate(() => {
        globalThis.sv2.storage.setTiming({ retry: 400 });
        globalThis.sv2.storage.hooks.failWrite = 'The disk is full (a test made this up)';
        globalThis.sv2.store.apply(globalThis.sv2Actions.setSetting, { key: 'schoolName', value: 'Banner Test School' });
      });
      await shows(p, () => document.getElementById('banner-save-failed') !== null);
      // the surface scrolled down to Getting started, then the first line asked for at the top
      await p.evaluate(() => {
        const surface = document.getElementById('surface');
        surface.scrollTop = surface.scrollHeight;
      });
      await shows(p, () => document.getElementById('surface').scrollTop > 0);
      await p.evaluate(() => document.getElementById('movement-line').scrollIntoView({ block: 'start' }));
      await shows(p, () => document.getElementById('movement-line').getBoundingClientRect().top < document.getElementById('surface').getBoundingClientRect().bottom);
      const banner = await box(p, '#storage-banners');
      const line = await box(p, '#movement-line');
      assert.ok(banner.height > 0, 'the banner has no height: the case tests nothing');
      assert.ok(line.top >= banner.bottom, 'the first line is behind the banner: ' + JSON.stringify({ banner, line }));
      await p.evaluate(() => {
        globalThis.sv2.storage.hooks.failWrite = null;
      });
      await shows(p, () => document.getElementById('banner-save-failed') === null);
    });
  });
}

// ---------------------------------------------------------------- SV2-52 item 13: the harness

// A suite whose first page never shows its section once held the machine's
// browser lock for 20 minutes (SV2-43): openPlanner threw and left its server
// and browser running, so the process never ended. Here a process of its own
// opens the planner at an address whose section never comes, and has to end
// by itself once openPlanner has thrown.
test('SV2-52 item 13: openPlanner closes its server and browser when the first page never shows its section, and the process ends', () => {
  const harness = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness.mjs')).href;
  const code = [
    'const { openPlanner } = await import(' + JSON.stringify(harness) + ');',
    "try { await openPlanner({ hash: '#nowhere' }); console.log('opened'); }",
    "catch (error) { console.log('threw: ' + String(error.message).split('\\n')[0]); }",
  ].join('\n');
  const env = { ...process.env };
  delete env.SV2_BASE;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60000, env });
  assert.match(child.stdout, /^threw: /m, 'openPlanner did not throw for a section that never came: ' + child.stdout + child.stderr);
  assert.equal(child.signal, null, 'the process was still running a minute after openPlanner threw: its server or browser was left open');
  assert.equal(child.status, 0, child.stderr);
});

// SV2-55 item 3: the view's clamp after the stage changes size under a map
// the reader moved, and on a stage shorter than the keep. (The swing the
// Foreman measured needs the stage and the floors' box together under 96 px
// with the box the taller; the sample's box is about 180 px even at 25 %, so
// the swing itself is held by the Node case on keepShift, which index.js calls.)
const stageTo = async (page, px) => {
  await page.evaluate((height) => {
    document.querySelector('.mov-stage').style.flex = '0 0 ' + height + 'px';
  }, px);
  await shows(page, (height) => document.querySelector('.mov').movement.view.height === height, px);
};
const keptOnStage = (box) => {
  const keepY = Math.min(48, box.bottom - box.top, box.height);
  const keepX = Math.min(48, box.right - box.left, box.width);
  return box.bottom >= keepY - 0.5 && box.top <= box.height - keepY + 0.5 && box.right >= keepX - 0.5 && box.left <= box.width - keepX + 0.5;
};

test('SV2-55 item 3: a stage made smaller under a map the reader moved keeps the floors on it, and on a 30 px stage wheel turns leave them still and on it', async () => {
  await on('#movement', DESK, async (p) => {
    await dismissStarted(p);
    await drawn(p);
    // a map the reader moved down to the stage's foot, 50 px of the floors
    // showing: moved as a reader moves it, a drag with the middle button
    // through the map's own input, so the view knows the map is no longer
    // fitted (SV2-57 item 1: a pan of the viewport alone left it fitted, and
    // the resize then fitted the map again whatever the clamp did)
    await stageTo(p, 300);
    const from = await p.evaluate(() => {
      const rect = document.querySelector('.mov-stage').getBoundingClientRect();
      const movement = document.querySelector('.mov').movement;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 40), by: Math.round(250 - movement.view.y) };
    });
    await p.mouse.move(from.x, from.y);
    await p.mouse.down({ button: 'middle' });
    await p.mouse.move(from.x, from.y + from.by / 2);
    await p.mouse.move(from.x, from.y + from.by);
    await p.mouse.up({ button: 'middle' });
    await shows(p, () => document.querySelector('.mov').movement.fitted === false);
    const moved = await floorsOnStage(p);
    assert.ok(moved.height - moved.top < 60 && moved.height - moved.top >= 47, 'the drag did not leave the floors at the stage’s foot: ' + JSON.stringify(moved));
    await p.mouse.move(640, 120);
    // the stage made smaller: the floors are brought back onto it
    await stageTo(p, 30);
    await drawn(p);
    assert.equal(await p.evaluate(() => document.querySelector('.mov').movement.fitted), false, 'the map was fitted again when the stage changed size: the case does not reach the clamp');
    const resized = await floorsOnStage(p);
    assert.ok(keptOnStage(resized), 'after the stage was made smaller the floors are off it: ' + JSON.stringify(resized));

    // wheel turns that would take the floors up and away: the map settles and stays
    const at = await p.evaluate(() => {
      const rect = document.querySelector('.mov-stage').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 10) };
    });
    await p.mouse.move(at.x, at.y);
    const ys = [];
    for (let turn = 0; turn < 5; turn += 1) {
      await wheelOverMap(p, 4000);
      ys.push((await floorsOnStage(p)).top);
    }
    assert.ok(new Set(ys.slice(1)).size === 1, 'the map went one way and back under the same wheel: ' + ys.join(', '));
    const kept = await floorsOnStage(p);
    assert.ok(kept.bottom - kept.top > 30, 'the floors’ box is not taller than the stage: the case tests nothing: ' + JSON.stringify(kept));
    assert.ok(keptOnStage(kept), 'the wheel took the floors off the stage: ' + JSON.stringify(kept));
  });
});

// SV2-55 item 5: openPlanner closes what it opened when an earlier step
// throws as well: launching the browser (the server was already up), and
// making and setting up the page (the browser and the server were). And the
// cleanup itself cannot hang on a page that never closes. Each runs in a
// process of its own, which has to end by itself once openPlanner has thrown.
function harnessChild(lines, extraEnv, timeout) {
  const harness = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness.mjs')).href;
  const code = ['const { openPlanner, launch } = await import(' + JSON.stringify(harness) + ');', ...lines].join('\n');
  const env = { ...process.env, ...(extraEnv || {}) };
  delete env.SV2_BASE;
  const started = Date.now();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: timeout || 45000, env });
  return { ...child, took: Date.now() - started };
}

test('SV2-55 item 5: openPlanner closes its server when the browser cannot be launched, and the process ends', () => {
  // a temporary folder inside a file, which cannot be made: the browser is unpacked and its
  // profile made in the temporary folder, so launch() throws
  // (the browser's unpacker raises a stray error of its own a moment after
  // launch() has thrown; it is noted, so the process ends of itself or not
  // by what openPlanner left open)
  const child = harnessChild([
    "process.on('uncaughtException', (error) => console.log('stray: ' + error.code));",
    "try { await openPlanner({ hash: '#movement' }); console.log('opened'); }",
    "catch (error) { console.log('threw: ' + String(error.message).split('\\n')[0]); }",
  ], { TMPDIR: path.join(fileURLToPath(import.meta.url), 'no-folder-here') });
  assert.match(child.stdout, /^threw: /m, 'openPlanner did not throw with no browser to launch: ' + child.stdout + child.stderr);
  assert.equal(child.signal, null, 'the process was still running after openPlanner threw: its server was left open (' + child.stdout + ')');
  assert.equal(child.status, 0, child.stderr);
});

test('SV2-55 item 5: openPlanner closes its page, browser and server when the page’s set-up throws, and the process ends', () => {
  // a device setting that cannot be written as JSON: the set-up throws after the page is made
  const child = harnessChild([
    "try { await openPlanner({ hash: '#movement', theme: 'light', device: { n: 1n } }); console.log('opened'); }",
    "catch (error) { console.log('threw: ' + String(error.message).split('\\n')[0]); }",
  ]);
  assert.match(child.stdout, /^threw: .*BigInt/m, 'openPlanner did not throw on the device setting: ' + child.stdout + child.stderr);
  assert.equal(child.signal, null, 'the process was still running after openPlanner threw: its browser or server was left open (' + child.stdout + ')');
  assert.equal(child.status, 0, child.stderr);
});

test('SV2-55 item 5: a page that never closes holds openPlanner’s cleanup for PAGE_CLOSE_MS at most, and the error still goes on', () => {
  // a browser of the caller's whose pages never close; the set-up throws, so the cleanup closes the page
  const child = harnessChild([
    'const real = await launch();',
    'const pages = [];',
    "const browser = { __engine: real.__engine, newPage: async () => { const page = await real.newPage(); pages.push(page); page.close = () => new Promise(() => {}); return page; } };",
    'const started = Date.now();',
    "try { await openPlanner({ browser, hash: '#movement', device: { n: 1n } }); console.log('opened'); }",
    "catch (error) { console.log('threw after ' + (Date.now() - started) + ' ms: ' + String(error.message).split('\\n')[0]); }",
    'await real.close();',
  ], {}, 40000);
  assert.match(child.stdout, /^threw after \d+ ms: .*BigInt/m, 'openPlanner did not throw past a page that never closes: ' + child.stdout + child.stderr);
  const took = Number(/threw after (\d+) ms/.exec(child.stdout)[1]);
  assert.ok(took >= 4500 && took < 15000, 'the cleanup waited ' + took + ' ms on the page, not the 5 s it is given');
  assert.equal(child.signal, null, 'the process did not end: ' + child.stdout);
  assert.equal(child.status, 0, child.stderr);
});
