// Presentation mode (spec 15; SV2-31), in a real browser: node test/browser/present.mjs
//
// Opens the sample school's movement view and presents it the way a person
// does: by keyboard at 1280 by 800 (P in, the arrows, Space, A, H, Escape
// out), and by touch on a phone upright at 390 by 844 and on its side at 844
// by 390 (Present tapped, the on-screen previous, next and leave). What is
// checked is the state the page sets, never a screen size it was given:
// data-present on the section's element ("fullscreen" with
// document.fullscreenElement the element when the browser granted it,
// "window" when it did not), the boxes of what is hidden and what is shown,
// the map's labelScale and Fit, the transition chosen, the playback's own
// state, and the section put back as it was. The auto-advance and the fading
// run on timers the test is handed (root.present.timers), so nothing here
// waits on a sleep. A refused full screen is made so in the page (the
// element's requestFullscreen rejects) and the window layer checked on its
// own. axe runs inside the mode in both themes.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, TOOL_DIR, launch, startServer } from './harness.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const REFUSED_SAYS = 'This browser did not open full screen, so the map fills the window instead.';

let browser;
let server;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---- helpers, each on the page given

// The view on screen has its answer for the project as it is, and the map is measured.
async function settled(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.mov');
    if (!root || root.dataset.styled !== 'true' || root.dataset.pending === 'true' || !root.movement || !root.present) return false;
    const movement = root.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 15000 });
}

// What the page says of the mode and the map, read in one go.
function read(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.mov');
    const movement = root.movement;
    const view = movement.view;
    const stage = movement.plan.stage;
    const box = (el) => (el && el.getClientRects().length > 0 ? el.getBoundingClientRect().toJSON() : null);
    return {
      present: root.dataset.present || null,
      presenting: root.present.presenting,
      how: root.present.how,
      full: document.fullscreenElement === root,
      anyFull: document.fullscreenElement !== null,
      refused: root.dataset.presentRefused === 'true',
      root: box(root),
      window: { width: innerWidth, height: innerHeight },
      stage: { width: stage.clientWidth, height: stage.clientHeight },
      view: { width: view.width, height: view.height, zoom: view.zoom, x: view.x, y: view.y },
      fitted: movement.fitted,
      fit: stage.dataset.fit || null,
      labelScale: movement.plan.labelScale,
      transition: movement.choice.transition,
      floors: movement.choice.floors,
      advance: root.present.advance,
      hotspots: root.present.hotspots,
      controls: document.querySelector('[data-part="present-touch"]').dataset.shown,
      line: (() => {
        const el = document.querySelector('[data-part="present-line"]');
        return { text: el.textContent, shown: el.dataset.shown };
      })(),
      caption: (() => {
        const el = document.querySelector('[data-part="present-caption"]');
        return el.getClientRects().length > 0 ? el.textContent : null;
      })(),
      focus: document.activeElement ? (document.activeElement.dataset.action || document.activeElement.dataset.part || document.activeElement.tagName) : null,
      scroll: root.scrollTop,
      playing: document.querySelector('[data-bar="playback"]').playback.playing,
      rail: document.querySelector('.rail') ? document.querySelector('.rail').inert || Boolean(document.querySelector('.rail').closest('[inert]')) : null,
      topbar: document.querySelector('.topbar') ? Boolean(document.querySelector('.topbar').closest('[inert]')) : null,
      inspector: document.getElementById('inspector') ? Boolean(document.getElementById('inspector').closest('[inert]')) : null,
      inertCount: document.querySelectorAll('[inert]').length,
    };
  });
}

// Timers the test runs itself: what the mode asks to have done later, by what it is for.
async function handTimers(page) {
  await page.evaluate(() => {
    const queue = [];
    let id = 0;
    globalThis.__presentTimers = queue;
    document.querySelector('.mov').present.timers({
      set(fn, ms, what) {
        id += 1;
        queue.push({ id, fn, ms, what });
        return id;
      },
      clear(which) {
        const at = queue.findIndex((each) => each.id === which);
        if (at !== -1) queue.splice(at, 1);
      },
    });
  });
}
const waiting = (page, what) => page.evaluate((wanted) => globalThis.__presentTimers.filter((each) => each.what === wanted).map((each) => each.ms), what);
// Run the one timer asked for `what`, as its time came: its delay, or null when none was asked.
function runTimer(page, what) {
  return page.evaluate((wanted) => {
    const queue = globalThis.__presentTimers;
    const at = queue.findIndex((each) => each.what === wanted);
    if (at === -1) return null;
    const [entry] = queue.splice(at, 1);
    entry.fn();
    return entry.ms;
  }, what);
}

// In: the mode is on and the map has been measured and fitted on the stage it has now.
async function inMode(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.mov');
    const movement = root.movement;
    const stage = movement.plan.stage;
    return root.present.presenting && Boolean(root.dataset.present) && movement.fitted && movement.view.width === stage.clientWidth && movement.view.height === stage.clientHeight && stage.clientHeight > 0;
  }, { timeout: 10000 });
  // the browser's answer to the request has come: full screen granted (the event), or refused (the line)
  await page.waitForFunction(() => {
    const root = document.querySelector('.mov');
    return root.dataset.present === 'fullscreen' ? document.fullscreenElement === root : root.dataset.presentRefused === 'true';
  }, { timeout: 10000 });
}

// Out: the mode is off, full screen is over, and the map has been put back
// where it was once its stage was measured in the section again.
async function outOfMode(page, restoredBefore) {
  await page.waitForFunction((count) => {
    const root = document.querySelector('.mov');
    const movement = root.movement;
    return !root.present.presenting && !root.dataset.present && document.fullscreenElement === null
      && Number(root.dataset.presentRestored || 0) > count
      && movement.view.width === movement.plan.stage.clientWidth && movement.view.height === movement.plan.stage.clientHeight;
  }, { timeout: 10000 }, restoredBefore);
}
const place = (view) => ({ zoom: view.zoom, x: view.x, y: view.y });
const restoredCount = (page) => page.evaluate(() => Number(document.querySelector('.mov').dataset.presentRestored || 0));

// Is the element's box inside the window and not covered, at its middle, by something else?
function onTop(page, selector) {
  return page.evaluate((wanted) => {
    const el = document.querySelector(wanted);
    if (!el || el.getClientRects().length === 0) return false;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  }, selector);
}

// A module of the tool put on the page as globalThis.sv2modules[key] by a
// module script the page loads itself, and waited for by its key (as
// m5-pass.mjs does: an import() awaited inside page.evaluate came back
// "Promise was collected", SV2-72e).
async function loadModule(page, key, file) {
  const held = (wanted) => {
    const value = globalThis.sv2modules && globalThis.sv2modules[wanted];
    if (!value) return null;
    return { error: value[Symbol.toStringTag] === 'Module' ? null : String(value.error) };
  };
  let state = await page.evaluate(held, key);
  if (state === null) {
    const name = JSON.stringify(key);
    await page.addScriptTag({ type: 'module', content: 'const modules = (globalThis.sv2modules ||= {}); import(' + JSON.stringify('./' + file) + ').then((module) => { modules[' + name + '] = module; }, (error) => { modules[' + name + '] = { error: String((error && error.message) || error) }; });' });
    state = await (await page.waitForFunction(held, { timeout: 10000 }, key)).jsonValue();
  }
  if (state.error !== null) throw new Error('loadModule: ' + file + ' did not load: ' + state.error);
}

async function axeFinds(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  assert.ok(found.passes.length > 10, 'axe ran very few rules');
  return found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', '));
}

// ---- by keyboard, at 1280 by 800

test('by keyboard at 1280 by 800: P in, the arrows, Space, A, H, Escape out, and the section as it was', async (t) => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);

    await t.test('Help lists Present and every key of the mode, with words', async () => {
      const listed = await page.evaluate(() => globalThis.sv2.shortcuts.list());
      const want = { 'movement-present': ['Movement', 'P'], 'present-step': ['Presentation mode', 'Left, Right'], 'present-play': ['Presentation mode', 'Space'], 'present-advance': ['Presentation mode', 'A'], 'present-hotspots': ['Presentation mode', 'H'], 'present-leave': ['Presentation mode', 'Esc'] };
      for (const [id, [group, keys]] of Object.entries(want)) {
        const entry = listed.find((each) => each.id === id);
        assert.ok(entry, id + ' is not on the shortcuts list');
        assert.equal(entry.group, group, id + "'s group");
        assert.equal(entry.keys, keys, id + "'s keys");
        assert.ok(entry.does.length > 10, id + ' has no words');
      }
      const button = await page.$eval('#movement-line [data-action="present"]', (el) => ({ text: el.textContent, keys: el.getAttribute('aria-keyshortcuts'), box: el.getClientRects().length }));
      assert.deepEqual(button, { text: 'Present', keys: 'P', box: 1 }, 'Present is not on the first line');
    });

    // the map zoomed in by the reader first, and a transition chosen, so that putting back is tested on a state that is not the default
    await page.evaluate(() => document.querySelector('.mov').movement.change({ transition: 2 }));
    await settled(page);
    await page.focus('#movement-plan');
    await page.keyboard.press('=');
    await page.waitForFunction(() => document.querySelector('.mov').movement.fitted === false);
    const before = await read(page);
    assert.equal(before.present, null);
    assert.equal(before.fitted, false, 'the zoom did not take the map off Fit');
    const labelSizeBefore = await page.$eval('.mov-legend', (el) => parseFloat(getComputedStyle(el).fontSize));

    await t.test('P in: true full screen, or the window layer where it is refused; the controls hidden, the map at Fit, large type', async () => {
      await page.focus('#movement-line [data-action="present"]');
      await page.keyboard.press('p');
      await inMode(page);
      await handTimers(page);
      const now = await read(page);
      assert.ok(now.present === 'fullscreen' || now.present === 'window', 'data-present is ' + now.present);
      if (now.present === 'fullscreen') assert.equal(now.full, true, 'full screen said, but the document has another fullscreen element');
      else assert.equal(now.refused, true, 'the window layer without a refusal');
      assert.deepEqual([now.root.x, now.root.y, now.root.width, now.root.height], [0, 0, now.window.width, now.window.height], 'the section does not cover the window');
      // the tool's controls: the rail, top bar and inspector are out of reach, the section's own controls have no box
      assert.deepEqual([now.rail, now.topbar, now.inspector], [true, true, true], 'the shell is not inert under the mode');
      for (const selector of ['.mov-top', '[data-bar="playback"]', '.mov-zoom', '.mov-legend', '.mov-legend-line']) {
        assert.equal(await page.$eval(selector, (el) => el.getClientRects().length), 0, selector + ' is still drawn');
      }
      // the map fills what the panel and the caption leave, at Fit, with its labels 1.5 times as large
      const parts = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
        return { stage: box('.mov-stage'), panel: box('[data-part="present-panel"]'), caption: box('[data-part="present-caption"]') };
      });
      assert.ok(Math.abs(parts.stage.right - parts.panel.left) <= 1, 'the map does not reach the panel');
      assert.ok(Math.abs(parts.stage.top - parts.caption.bottom) <= 1 && Math.abs(parts.stage.bottom - now.window.height) <= 1, 'the map does not fill the column under the caption');
      assert.ok(parts.stage.width * parts.stage.height >= 0.6 * now.window.width * now.window.height, 'the map takes under 60 % of the screen');
      assert.equal(now.fitted, true, 'the map is not at Fit');
      assert.ok(['whole', 'above', 'beside'].includes(now.fit), 'no fit recorded on the stage');
      assert.equal(now.labelScale, 1.5, "the map's labels are not 1.5 times as large");
      assert.ok(now.view.zoom > before.view.zoom * 0.9, 'the map is smaller on the whole screen than in the section');
      const panelSize = await page.$eval('[data-part="present-panel"]', (el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(panelSize >= labelSizeBefore * 1.5 - 0.01, "the panel's type (" + panelSize + ' px) is not 1.5 times the legend\'s (' + labelSizeBefore + ')');
      assert.equal(now.focus, 'present-panel', 'the focus is not in the mode');
      assert.equal(await onTop(page, '[data-part="present-panel"]'), true, 'something lies over the panel');
    });

    await t.test('the key of the groups on the map, the load bands and the five busiest places stay beside it', async () => {
      const shown = await page.evaluate(() => {
        const movement = document.querySelector('.mov').movement;
        return {
          groups: movement.picture.groups.map((group) => group.name),
          key: Array.from(document.querySelectorAll('[data-present="groups"] li')).map((li) => li.textContent),
          bands: document.querySelectorAll('[data-present="bands"] li').length,
          hot: Array.from(document.querySelectorAll('[data-present="hotspot-rows"] li')).map((li) => li.querySelector('.mov-pres__place').textContent),
          box: document.querySelector('[data-present="hotspots"]').getClientRects().length,
        };
      });
      assert.deepEqual(shown.key, shown.groups, 'the key is not the groups on the map');
      assert.equal(shown.bands, 5, 'the load bands');
      assert.equal(shown.box, 1, 'the busiest places are not shown');
      await loadModule(page, 'hotspots', 'ui/movement/hotspots.js');
      const ranked = await page.evaluate(() => {
        const { hotspotRows, placeWords } = globalThis.sv2modules.hotspots;
        const m = document.querySelector('.mov').movement;
        return hotspotRows(m.state.project, m.state.results, m.state.graph, m.picture).slice(0, 5).map(placeWords);
      });
      assert.ok(ranked.length >= 3, 'the sample school ranks ' + ranked.length + ' places: the case tests nothing');
      assert.deepEqual(shown.hot, ranked, 'the summary is not the Hotspots ranking');
    });

    await t.test('Left and Right step through the transitions, said in the corner line and the caption', async () => {
      await page.keyboard.press('ArrowRight');
      let now = await read(page);
      assert.equal(now.transition, 3, 'Right did not step on');
      assert.match(now.caption, /Period 4 to Period 5/);
      assert.equal(now.line.shown, 'true');
      assert.match(now.line.text, /^Period 4 to Period 5/);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      now = await read(page);
      assert.equal(now.transition, 0, 'Left did not step back');
      await page.keyboard.press('ArrowLeft');
      now = await read(page);
      assert.equal(now.transition, 0, 'Left stepped past the first transition');
      assert.equal(now.line.text, 'This is the first transition of the day.');
      // the line fades when its time is up
      assert.deepEqual(await waiting(page, 'line'), [2500]);
      await runTimer(page, 'line');
      assert.equal((await read(page)).line.shown, 'false', 'the corner line did not fade');
      // the map was not moved by the arrows (the keyboard cursor does not take them in the mode)
      assert.equal(await page.$eval('.mov-marks', (el) => el.dataset.cursor || ''), '');
    });

    await t.test('Space plays and pauses the section\'s own playback, whose clock is copied over the map', async () => {
      await page.keyboard.press(' ');
      assert.equal((await read(page)).playing, true, 'Space did not play');
      await page.waitForFunction(() => document.querySelector('[data-present="clock"]').textContent !== '', { timeout: 5000 });
      const clock = await page.evaluate(() => ({ mine: document.querySelector('[data-present="clock"]').textContent, bar: document.querySelector('[data-bar="playback"] [data-part="clock"]').textContent }));
      assert.ok(clock.mine.startsWith(clock.bar.slice(0, 4)), 'the clock over the map is not the bar\'s: ' + JSON.stringify(clock));
      await page.keyboard.press(' ');
      assert.equal((await read(page)).playing, false, 'Space did not pause');
    });

    await t.test('A cycles the auto-advance off, 5, 10, 15 and off, and a step comes when its timer does', async () => {
      assert.deepEqual(await waiting(page, 'advance'), [], 'an auto-advance is running before A');
      const seen = [];
      for (const seconds of [5, 10, 15]) {
        await page.keyboard.press('a');
        const now = await read(page);
        seen.push(now.advance);
        assert.equal(now.line.text, 'Steps on every ' + seconds + ' seconds.');
        assert.deepEqual(await waiting(page, 'advance'), [seconds * 1000], 'the step is not asked for in ' + seconds + ' s');
      }
      assert.deepEqual(seen, [5, 10, 15]);
      const at = (await read(page)).transition;
      assert.equal(await runTimer(page, 'advance'), 15000);
      let now = await read(page);
      assert.equal(now.transition, at + 1, 'the auto-advance did not step');
      assert.deepEqual(await waiting(page, 'advance'), [15000], 'the next step is not asked for');
      // at the last transition it goes round to the first
      await page.evaluate(() => document.querySelector('.mov').movement.change({ transition: document.querySelector('.mov').movement.picture.transitions.length - 1 }));
      await runTimer(page, 'advance');
      now = await read(page);
      assert.equal(now.transition, 0, 'the auto-advance did not go round from the last transition');
      await page.keyboard.press('a');
      now = await read(page);
      assert.equal(now.advance, 0);
      assert.equal(now.line.text, 'Auto-advance is off.');
      assert.deepEqual(await waiting(page, 'advance'), [], 'the auto-advance is still asked for when off');
    });

    await t.test('H hides the hotspot summary and shows it again', async () => {
      await page.keyboard.press('h');
      let now = await read(page);
      assert.equal(now.hotspots, false);
      assert.equal(await page.$eval('[data-present="hotspots"]', (el) => el.getClientRects().length), 0, 'the summary is still drawn');
      assert.equal(await page.$eval('[data-part="present-panel"]', (el) => el.dataset.hotspots), 'hidden');
      await page.keyboard.press('h');
      now = await read(page);
      assert.equal(now.hotspots, true);
      assert.equal(await page.$eval('[data-present="hotspots"]', (el) => el.getClientRects().length), 1, 'the summary did not come back');
    });

    await t.test('a digit and Ctrl+Z do nothing under the mode: no section is opened and the project does not change', async () => {
      const changed = await page.evaluate(() => globalThis.sv2.store.project.modified);
      await page.keyboard.press('1');
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');
      assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.section), 'movement');
      assert.equal(await page.evaluate(() => globalThis.sv2.store.project.modified), changed);
      assert.equal((await read(page)).presenting, true);
    });

    for (const theme of ['light', 'dark']) {
      await t.test('axe finds nothing inside the mode in the ' + theme + ' theme', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.waitForFunction((wanted) => getComputedStyle(document.documentElement).colorScheme === wanted, {}, theme);
        // the touch controls shown too, so that their buttons are checked
        await page.mouse.move(200, 300);
        await page.mouse.move(210, 310);
        await page.waitForFunction(() => document.querySelector('[data-part="present-touch"]').dataset.shown === 'true');
        assert.deepEqual(await axeFinds(page), []);
      });
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    await t.test('the touch controls take the keyboard: Tab reaches them, and they stay while the focus is in them', async () => {
      await runTimer(page, 'controls');
      assert.equal((await read(page)).controls, 'false');
      // the map, then the controls over it, then the panel: Tab from the map reaches the first
      await page.focus('#movement-plan');
      await page.keyboard.press('Tab');
      const now = await read(page);
      assert.equal(now.focus, 'present-previous', 'Tab from the panel does not reach the controls');
      assert.equal(now.controls, 'true', 'the controls are not shown for the keyboard');
      await runTimer(page, 'controls');
      assert.equal((await read(page)).controls, 'true', 'the controls faded with the keyboard in them');
      await page.focus('[data-part="present-panel"]');
    });

    await t.test('Escape leaves, and the section is as it was: transition, floors, zoom and place, scroll, playback, focus on Present', async () => {
      const count = await restoredCount(page);
      await page.keyboard.press('Escape');
      await outOfMode(page, count);
      const now = await read(page);
      assert.equal(now.present, null);
      assert.equal(now.anyFull, false, 'still full screen');
      assert.equal(now.transition, before.transition, 'the transition');
      assert.equal(now.floors, before.floors, 'the floors');
      // the stage may be a pixel shorter: the playback's hint line goes once it has played
      assert.deepEqual(place(now.view), place(before.view), 'the zoom and place of the map');
      assert.equal(now.view.width, before.view.width);
      assert.equal(now.fitted, false, 'the map is at Fit again, which it was not');
      assert.equal(now.scroll, before.scroll, 'the section\'s scroll');
      assert.equal(now.playing, false);
      assert.equal(now.labelScale, 1, 'the labels are still large');
      assert.equal(now.focus, 'present', 'the focus is not on Present');
      assert.equal(now.inertCount, before.inertCount, 'something is still inert');
      for (const selector of ['.mov-top', '[data-bar="playback"]', '.mov-zoom']) {
        assert.equal(await page.$eval(selector, (el) => el.getClientRects().length), 1, selector + ' did not come back');
      }
      assert.equal(await page.$eval('[data-part="present-panel"]', (el) => el.getClientRects().length), 0, 'the panel is still drawn');
    });

    await t.test('leaving full screen by the browser\'s own means leaves the mode too', async () => {
      await page.keyboard.press('p');
      await inMode(page);
      const how = (await read(page)).how;
      const count = await restoredCount(page);
      if (how === 'fullscreen') {
        await page.evaluate(() => document.exitFullscreen());
      } else {
        // refused here: the window layer has no browser way out but Escape
        await page.keyboard.press('Escape');
      }
      await outOfMode(page, count);
      assert.equal((await read(page)).present, null);
      t.diagnostic('full screen here: ' + how);
    });

    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---- refused: the window layer is whole on its own, and said once

test('where full screen is refused, the window layer is whole on its own, said once a visit', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.evaluate(() => {
      Element.prototype.requestFullscreen = function refuse() {
        return Promise.reject(new TypeError('Permissions check failed'));
      };
    });
    await page.click('#movement-line [data-action="present"]');
    await inMode(page);
    let now = await read(page);
    assert.equal(now.present, 'window');
    assert.equal(now.refused, true);
    assert.equal(now.anyFull, false);
    assert.deepEqual([now.root.x, now.root.y, now.root.width, now.root.height], [0, 0, 1280, 800], 'the layer does not cover the window');
    assert.equal(now.line.text, REFUSED_SAYS);
    assert.deepEqual([now.rail, now.topbar, now.inspector], [true, true, true]);
    // nothing of the shell lies over it
    for (const selector of ['[data-part="present-panel"]', '[data-part="present-caption"]', '#movement-plan']) assert.equal(await onTop(page, selector), true, selector + ' is under something');
    let count = await restoredCount(page);
    await page.keyboard.press('Escape');
    await outOfMode(page, count);
    await page.click('#movement-line [data-action="present"]');
    await inMode(page);
    now = await read(page);
    assert.equal(now.present, 'window');
    assert.notEqual(now.line.text, REFUSED_SAYS, 'the refusal is said a second time');
    count = await restoredCount(page);
    await page.keyboard.press('Escape');
    await outOfMode(page, count);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the section taken away while presenting (Back to another section) lets go: nothing of the shell is left inert', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.evaluate(() => {
      Element.prototype.requestFullscreen = function refuse() {
        return Promise.reject(new TypeError('Permissions check failed'));
      };
    });
    await page.click('#movement-line [data-action="present"]');
    await inMode(page);
    await page.evaluate(() => {
      location.hash = '#schedule/groups';
    });
    await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'schedule' && document.querySelectorAll('[inert]').length === 0, { timeout: 10000 });
    // and P there is nobody's
    await page.keyboard.press('p');
    assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.section), 'schedule');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---- by touch, upright and on its side

for (const size of [{ width: 390, height: 844, upright: true }, { width: 844, height: 390, upright: false }]) {
  test('by touch at ' + size.width + ' by ' + size.height + ': Present tapped, the on-screen controls, and Leave', async (t) => {
    const session = await openPlanner({ browser, server, hash: '#movement', width: size.width, height: size.height, mobile: true });
    const { page } = session;
    try {
      await settled(page);
      const before = await read(page);
      await page.tap('#movement-line [data-action="present"]');
      await inMode(page);
      await handTimers(page);
      let now = await read(page);
      assert.ok(now.present === 'fullscreen' || now.present === 'window');
      t.diagnostic('full screen here: ' + now.how);
      assert.deepEqual([now.root.width, now.root.height], [now.window.width, now.window.height]);
      assert.equal(now.labelScale, 1.5);
      assert.equal(now.fitted, true);
      const parts = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
        return { stage: box('.mov-stage'), panel: box('[data-part="present-panel"]') };
      });
      // the panel under the map upright, beside it on its side; never over it
      if (size.upright) assert.ok(parts.panel.top >= parts.stage.bottom - 1, 'upright, the panel is not under the map');
      else assert.ok(parts.panel.left >= parts.stage.right - 1, 'on its side, the panel is not beside the map');
      assert.ok(parts.stage.height >= 0.5 * now.window.height, 'the map has under half the screen\'s height');
      // the controls come with a touch, and go 3 s after it
      assert.equal(now.controls, 'false', 'the controls are shown before a touch');
      const middle = { x: parts.stage.left + parts.stage.width / 2, y: parts.stage.top + parts.stage.height / 3 };
      await page.touchscreen.tap(middle.x, middle.y);
      now = await read(page);
      assert.equal(now.controls, 'true', 'a touch did not bring the controls');
      assert.deepEqual(await waiting(page, 'controls'), [3000]);
      const targets = await page.$$eval('[data-part="present-touch"] button', (all) => all.map((el) => [el.dataset.action, Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]));
      assert.deepEqual(targets.map((each) => each[0]), ['present-previous', 'present-play', 'present-next', 'present-leave']);
      for (const [name, w, h] of targets) assert.ok(w >= 44 && h >= 44, name + ' is ' + w + ' by ' + h + ', under a finger\'s 44');
      await page.tap('[data-action="present-next"]');
      now = await read(page);
      assert.equal(now.transition, 0, 'Next from all the day is not the first transition');
      await page.tap('[data-action="present-next"]');
      assert.equal((await read(page)).transition, 1, 'Next did not step');
      await page.tap('[data-action="present-previous"]');
      assert.equal((await read(page)).transition, 0, 'Previous did not step back');
      // a tapped button takes the focus; the controls still go when the time is up
      await runTimer(page, 'controls');
      now = await read(page);
      assert.equal(now.controls, 'false', 'the controls did not fade after a touch');
      // and are gone from the screen once their fade is over
      await page.waitForFunction(() => {
        const style = getComputedStyle(document.querySelector('[data-part="present-touch"]'));
        return style.opacity === '0' && style.visibility === 'hidden';
      }, { timeout: 5000 });
      // Leave: tap to bring them, then Leave
      await page.touchscreen.tap(middle.x, middle.y);
      const count = await restoredCount(page);
      await page.tap('[data-action="present-leave"]');
      await outOfMode(page, count);
      now = await read(page);
      assert.equal(now.transition, before.transition, 'the transition');
      assert.deepEqual(now.view, before.view, 'the zoom and place');
      assert.equal(now.fitted, before.fitted);
      assert.equal(now.scroll, before.scroll);
      assert.equal(now.focus, 'present');
      assert.equal(now.labelScale, 1);
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}
