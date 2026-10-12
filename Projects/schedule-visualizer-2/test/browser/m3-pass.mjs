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
    // the stage keeps its height: the section scrolls inside itself, and the page does not
    await drawn(p);
    const room = await mapRoom(p);
    assert.ok(room.stage >= Math.ceil(844 * 0.45), 'with the controls shown the stage is ' + room.stage + ' px');
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

test('W7: the keyboard cursor is a ring never under 14 px, a 2 px line in the focus colour between two lines of the surface’s: read at 25 % and at 100 %', async () => {
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
    for (const zoom of [0.25, 1]) {
      const seen = await p.evaluate(async (wanted) => {
        const movement = document.querySelector('.mov').movement;
        const layer = movement.env.layer;
        const was = layer.dataset.cursor.split(',').map(Number);
        // zoom about the cursor, so that it stays on screen
        movement.view.zoomAbout(wanted, was[0] + was[2] / 2, was[1] + was[2] / 2);
        const drawnBefore = Number(movement.canvas.dataset.drawn);
        movement.env.paint();
        await new Promise((resolve) => {
          const wait = () => (Number(movement.canvas.dataset.drawn) > drawnBefore ? resolve() : requestAnimationFrame(wait));
          wait();
        });
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
      const what = 'at ' + Math.round(seen.zoom * 100) + ' % (a cell is ' + seen.size + ' px)';
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
      // on the first ring's line, where the line of a ring it overlaps would put its light edge
      const first = rings[0];
      const under = [];
      for (const other of rings.slice(1)) {
        if (Math.hypot(other.x - first.x, other.y - first.y) >= first.r + other.r) continue;
        for (let angle = 0; angle < 360; angle += 0.5) {
          const px = first.x + first.r * Math.cos((angle * Math.PI) / 180);
          const py = first.y + first.r * Math.sin((angle * Math.PI) / 180);
          const off = Math.abs(Math.hypot(px - other.x, py - other.y) - other.r);
          // inside the other's 5 px light line and clear of its 3 px dark one; and clear of every rank's disc
          if (off >= 1.9 && off <= 2.2 && rings.every((ring) => Math.hypot(px - ring.bx, py - ring.by) > 9.5)) under.push({ angle, other: other.rank, got: at(px, py) });
        }
      }
      const style = getComputedStyle(document.documentElement);
      return { rings, discs, under, zoom: movement.view.zoom, accent: style.getPropertyValue('--accent').trim(), pulse: panel.dataset.pulse };
    });
    const hex = (value) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
    const accent = hex(seen.accent);
    const isAccent = (got) => got[3] === 255 && got.slice(0, 3).every((value, index) => Math.abs(value - accent[index]) <= 30);
    assert.equal(Math.round(seen.zoom * 100), 25);
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
    // the busiest place's ring is over the others
    assert.ok(seen.under.length > 0, 'no spot was found where ring 1 crosses another ring’s light edge: the case tests nothing');
    for (const spot of seen.under) assert.ok(isAccent(spot.got), 'ring ' + spot.other + ' is drawn over ring 1 at ' + spot.angle + '°: ' + spot.got);
  });
});

// ---------------------------------------------------------------- W9: a finger's targets

// Every control of the movement surface that is on screen, with the smaller
// side of what a finger has to hit: the control, or the label a box or a
// radio button sits in.
const targets = (page) => page.evaluate(() => {
  const found = [];
  const seen = new Set();
  for (const root of document.querySelectorAll('.mov, .mov-floors')) {
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
});

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

test('W10: on the movement map two fingers pinch about the point between them, and one finger moves the map and leaves the zoom alone', async () => {
  await on('#movement', { ...TABLET, mobile: true }, async (p) => {
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
