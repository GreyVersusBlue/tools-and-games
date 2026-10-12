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

// The section has measured its dock as it is on screen now: --toast-clear is
// how far the zoom buttons and the bar reach up from the surface's foot.
const dockMeasured = (page) => shows(page, () => {
  const surface = document.getElementById('surface');
  const foot = surface.getBoundingClientRect().top + surface.clientTop + surface.clientHeight;
  const tops = [document.querySelector('.mov-zoom'), document.querySelector('[data-bar="playback"]')].map((el) => el.getBoundingClientRect().top);
  return surface.style.getPropertyValue('--toast-clear') === Math.max(0, Math.round(foot - Math.min(...tops))) + 'px';
});

async function clearOfDock(page, what) {
  await dockMeasured(page);
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
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      await shows(p, () => document.querySelector('[data-part="more"]').hidden === false);
      const open = (await box(p, '[data-bar="playback"]')).height;
      await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words, action: { label: 'Undo', run: () => {} } }), LONG);
      await clearOfDock(p, 'More open, a long message');
      // and while the message is up: the bar shrinks and grows under it
      await p.evaluate(() => document.querySelector('[data-action="more"]').click());
      await shows(p, () => document.querySelector('[data-part="more"]').hidden === true);
      assert.ok((await box(p, '[data-bar="playback"]')).height < open, 'the bar is no shorter with More shut: the case tests nothing');
      await clearOfDock(p, 'More shut again');
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
