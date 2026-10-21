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
      // what the mode makes inert is outside the section; the legend card inside it docks by its own rule
      inertCount: Array.from(document.querySelectorAll('[inert]')).filter((el) => !root.contains(el)).length,
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
  }, { timeout: 10000 }, restoredBefore).catch(async (error) => {
    const found = await page.evaluate(() => {
      const root = document.querySelector('.mov');
      const movement = root.movement;
      return { presenting: root.present.presenting, present: root.dataset.present || null, full: document.fullscreenElement !== null, restored: root.dataset.presentRestored || '0', view: [movement.view.width, movement.view.height], stage: [movement.plan.stage.clientWidth, movement.plan.stage.clientHeight], timers: (globalThis.__presentTimers || []).map((each) => each.what) };
    });
    throw new Error('out of the mode not reached: ' + JSON.stringify(found) + ' (' + error.message + ')');
  });
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
      const want = { 'movement-present': ['Movement', 'P'], 'present-step': ['Movement', 'Left, Right'], 'present-play': ['Movement', 'Space'], 'present-advance': ['Movement', 'A'], 'present-hotspots': ['Movement', 'H'], 'present-leave': ['Movement', 'Esc'] };
      for (const [id, [group, keys]] of Object.entries(want)) {
        const entry = listed.find((each) => each.id === id);
        assert.ok(entry, id + ' is not on the shortcuts list');
        assert.equal(entry.group, group, id + "'s group");
        assert.equal(entry.keys, keys, id + "'s keys");
        assert.ok(entry.does.length > 10, id + ' has no words');
      }
      const button = await page.$eval('[data-bar="playback"] .mov-pb__row > [data-action="present"]:last-child', (el) => ({ text: el.textContent, keys: el.getAttribute('aria-keyshortcuts'), box: el.getClientRects().length, place: el.dataset.place }));
      assert.deepEqual(button, { text: 'Present', keys: 'P', box: 1, place: 'bar' }, 'Present does not end the playback bar\'s row at 1280');
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
      await page.focus('[data-action="present"]');
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

    // faded and at rest: the fade's own transition over, so nothing is read halfway (SV2-31b)
    const faded = () => page.waitForFunction(() => {
      const el = document.querySelector('[data-part="present-touch"]');
      return el.dataset.shown === 'false' && el.getAnimations().length === 0 && getComputedStyle(el).opacity === '0';
    }, { timeout: 5000 });

    for (const motion of ['no-preference', 'reduce']) {
      await t.test('the touch controls take the keyboard once faded (' + motion + ' motion): Tab reaches them, and they stay while the focus is in them', async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
        await page.focus('[data-part="present-panel"]');
        await runTimer(page, 'controls');
        assert.equal((await read(page)).controls, 'false');
        await faded();
        // the map, then the controls over it, then the panel: Tab from the map reaches the first
        await page.focus('#movement-plan');
        await page.keyboard.press('Tab');
        const now = await read(page);
        assert.equal(now.focus, 'present-previous', 'Tab from the map does not reach the faded controls');
        assert.equal(now.controls, 'true', 'the controls are not shown for the keyboard');
        await runTimer(page, 'controls');
        assert.equal((await read(page)).controls, 'true', 'the controls faded with the keyboard in them');
        await page.focus('[data-part="present-panel"]');
        await runTimer(page, 'controls');
      });
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);

    await t.test('faded, the controls are still in what a screen reader reads: Leave is a button it can reach with no Escape', async () => {
      await runTimer(page, 'controls');
      await faded();
      const tree = await page.accessibility.snapshot({ interestingOnly: true });
      const names = [];
      (function walk(node) {
        if (!node) return;
        if (node.role === 'button') names.push(node.name);
        for (const child of node.children || []) walk(child);
      })(tree);
      for (const name of ['Previous transition', 'Next transition', 'Leave presentation mode']) assert.ok(names.includes(name), name + ' is not read with the controls faded: ' + JSON.stringify(names));
      // and a tap on where they lie goes to the map, not to an unseen button
      const style = await page.$eval('[data-part="present-touch"]', (el) => getComputedStyle(el).pointerEvents);
      assert.equal(style, 'none', 'the faded controls still take taps');
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
    await page.click('[data-action="present"]');
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
    await page.click('[data-action="present"]');
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
    await page.click('[data-action="present"]');
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
      // on a phone (640 px and under) Present stands beside Clear in the
      // controls, one tap behind Change (folded unless the reader opened them on
      // this device before: the run at the other size, in this browser); wider,
      // it ends the playback bar's row, on screen with the controls folded
      const where = await page.$eval('[data-action="present"]', (el) => el.dataset.place);
      assert.equal(where, size.width <= 640 ? 'controls' : 'bar', 'Present stands in the wrong place');
      const folded = await page.$eval('.mov-top', (el) => el.dataset.folded === 'true');
      assert.equal(await page.$eval('[data-action="present"]', (el) => el.getClientRects().length), where === 'controls' && folded ? 0 : 1, 'Present is drawn where it should not be, or not where it should');
      if (where === 'controls' && folded) await page.tap('[data-action="change"]');
      await page.waitForFunction(() => document.querySelector('[data-action="present"]').getClientRects().length > 0);
      // the tap would scroll the section to the button first: bring it into view, then read where things are
      await page.$eval('[data-action="present"]', (el) => el.scrollIntoView({ block: 'nearest' }));
      await settled(page);
      const before = await read(page);
      // the timers handed over first: entering by a tap asks for the controls' fade at once
      await handTimers(page);
      await page.tap('[data-action="present"]');
      await inMode(page);
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
      // entered by a tap, the controls are there for the next one, and go 3 s after (SV2-31b)
      assert.equal(now.controls, 'true', 'entered by a tap, the controls are not shown');
      assert.deepEqual(await waiting(page, 'controls'), [3000]);
      await runTimer(page, 'controls');
      assert.equal((await read(page)).controls, 'false');
      // then a touch brings them again
      const middle = { x: parts.stage.left + parts.stage.width / 2, y: parts.stage.top + parts.stage.height / 3 };
      await page.touchscreen.tap(middle.x, middle.y);
      now = await read(page);
      assert.equal(now.controls, 'true', 'a touch did not bring the controls');
      assert.deepEqual(await waiting(page, 'controls'), [3000]);
      const targets = await page.$$eval('[data-part="present-touch"] button', (all) => all.map((el) => [el.dataset.action, Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]));
      assert.deepEqual(targets.map((each) => each[0]), ['present-previous', 'present-play', 'present-next', 'present-leave']);
      // the size present.css gives them (DECISIONS 2026-10-21: 56 px), not only a finger's 44
      for (const [name, w, h] of targets) assert.ok(w >= 56 && h >= 56, name + ' is ' + w + ' by ' + h + ', under 56');
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
      // and are gone from sight once their fade is over, and only from sight: Leave can still take the focus
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-part="present-touch"]');
        const style = getComputedStyle(el);
        return el.getAnimations().length === 0 && style.opacity === '0' && style.pointerEvents === 'none';
      }, { timeout: 5000 });
      const leave = await page.$eval('[data-action="present-leave"]', (el) => { el.focus(); return { focused: document.activeElement === el, visibility: getComputedStyle(el).visibility, box: el.getClientRects().length }; });
      assert.deepEqual(leave, { focused: true, visibility: 'visible', box: 1 }, 'faded, Leave cannot take the focus');
      assert.equal((await read(page)).controls, 'true', 'the focus come to them does not show them');
      await runTimer(page, 'controls');
      for (const theme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.waitForFunction((wanted) => getComputedStyle(document.documentElement).colorScheme === wanted, {}, theme);
        await page.touchscreen.tap(middle.x, middle.y);
        await page.waitForFunction(() => document.querySelector('[data-part="present-touch"]').getAnimations().length === 0);
        assert.deepEqual(await axeFinds(page), [], 'axe at ' + size.width + ' by ' + size.height + ' in the ' + theme + ' theme');
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      // Leave: tap to bring them, then Leave
      await page.touchscreen.tap(middle.x, middle.y);
      const count = await restoredCount(page);
      await page.tap('[data-action="present-leave"]');
      await outOfMode(page, count);
      now = await read(page);
      assert.equal(now.transition, before.transition, 'the transition');
      assert.equal(before.fitted, true, 'the phone opened off Fit: the case tests the wrong thing');
      assert.equal(now.fitted, true, 'the map is not at Fit again');
      assert.equal(now.fit, before.fit, 'the stage\'s fit');
      assert.deepEqual(now.view, before.view, 'the zoom and place');
      assert.equal(now.scroll, before.scroll);
      assert.equal(now.focus, 'present');
      assert.equal(now.labelScale, 1);
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}

// ---- SV2-31b: the review's faults and risks, each a case

// The browser's answer to a full screen request held back until the test
// lets it go: the request reaches the browser only at release
// (globalThis.__releaseFullscreen()), as a slow browser's answer would.
async function holdFullscreen(page) {
  await page.evaluate(() => {
    const real = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function held(options) {
      const element = this;
      return new Promise((resolve, reject) => {
        globalThis.__releaseFullscreen = () => real.call(element, options).then(resolve, reject);
      });
    };
  });
}

test('Escape before the browser grants full screen: the grant that comes after is given back, and the page is not left full screen with the mode off', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await holdFullscreen(page);
    await page.focus('[data-action="present"]');
    await page.keyboard.press('p');
    await page.waitForFunction(() => document.querySelector('.mov').dataset.present === 'window');
    const count = await restoredCount(page);
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).presenting, false, 'Escape did not leave');
    // the browser says yes now (evaluate carries a user gesture, as the press did)
    await page.evaluate(() => globalThis.__releaseFullscreen());
    await outOfMode(page, count);
    // it may take the grant and give it back: what counts is where it ends
    await page.waitForFunction(() => document.fullscreenElement === null, { timeout: 5000 });
    const now = await read(page);
    assert.equal(now.anyFull, false, 'the page is full screen with the mode off');
    assert.equal(now.present, null);
    assert.equal(now.inertCount, 0, 'something is left inert');
    assert.equal(now.focus, 'present');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('WebKit\'s prefixed full screen, which says no by an event and returns no promise: the refusal is said as one', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.evaluate(() => {
      Element.prototype.requestFullscreen = undefined;
      Element.prototype.webkitRequestFullscreen = function refuse() {
        setTimeout(() => document.dispatchEvent(new Event('webkitfullscreenerror')), 0);
        return undefined;
      };
    });
    await page.click('[data-action="present"]');
    await page.waitForFunction(() => document.querySelector('.mov').dataset.presentRefused === 'true', { timeout: 5000 });
    const now = await read(page);
    assert.equal(now.present, 'window');
    assert.equal(now.line.text, REFUSED_SAYS);
    await page.keyboard.press('p');
    assert.equal((await read(page)).presenting, false, 'P again does not leave');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('a reader\'s zoom is put back as it was without a press of Zoom in: a card open on a cell stays open', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.focus('#movement-plan');
    await page.keyboard.press('=');
    await page.waitForFunction(() => document.querySelector('.mov').movement.fitted === false);
    // a card tapped open on a corridor cell of the hotspots' first place
    await loadModule(page, 'hotspots', 'ui/movement/hotspots.js');
    const at = await page.evaluate(() => {
      const { hotspotRows } = globalThis.sv2modules.hotspots;
      const m = document.querySelector('.mov').movement;
      const row = hotspotRows(m.state.project, m.state.results, m.state.graph, m.picture).find((each) => each.cells.length > 0);
      const cell = row.cells[0];
      return m.cellAt(cell.floorId, cell.cell);
    });
    const box = await page.$eval('#movement-plan', (el) => el.getBoundingClientRect().toJSON());
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await page.waitForFunction(() => document.querySelector('.mov').movement.point !== null);
    const card = await page.evaluate(() => {
      const point = document.querySelector('.mov').movement.point;
      return { floorId: point.floorId, cell: point.cell, source: point.source };
    });
    assert.equal(card.source, 'tap', 'the click did not open a card: the case tests nothing');
    const before = await read(page);
    const count = await restoredCount(page);
    await page.keyboard.press('p');
    await inMode(page);
    await page.keyboard.press('Escape');
    await outOfMode(page, count);
    const now = await read(page);
    assert.deepEqual(place(now.view), place(before.view), 'the zoom and place of the map');
    assert.equal(now.fitted, false);
    const after = await page.evaluate(() => {
      const point = document.querySelector('.mov').movement.point;
      return point ? { floorId: point.floorId, cell: point.cell, source: point.source } : null;
    });
    assert.deepEqual(after, card, 'the card open on the cell was shut by putting the zoom back');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('a dialog opened over the mode has its own keys: Escape shuts the dialog, and the mode stays', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    await handTimers(page);
    await page.evaluate(() => {
      globalThis.__dialog = globalThis.sv2.ctx.openDialog({ title: 'A question', body: 'Something the tool asks.', buttons: [{ label: 'Keep going', value: 'keep', kind: 'primary' }] });
    });
    await page.waitForFunction(() => document.querySelector('dialog[open]') !== null);
    const at = (await read(page)).transition;
    await page.keyboard.press('ArrowRight');
    assert.equal((await read(page)).transition, at, 'an arrow in the dialog stepped the map');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null, { timeout: 5000 });
    assert.equal((await read(page)).presenting, true, 'Escape in the dialog left the mode');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.mov').present.presenting);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the auto-advance lets a running playback finish: the step waits, and comes when it stops', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await settled(page);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ transition: 1 }));
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    await handTimers(page);
    await page.keyboard.press('a');
    await page.keyboard.press(' ');
    assert.equal((await read(page)).playing, true, 'Space did not play');
    assert.equal(await runTimer(page, 'advance'), 5000);
    let now = await read(page);
    assert.equal(now.transition, 1, 'the step came with the playback running');
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.due), true, 'no step is waiting');
    await page.keyboard.press(' ');
    now = await read(page);
    assert.equal(now.playing, false);
    assert.equal(now.transition, 2, 'the step did not come when the playback stopped');
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.due), false);
    assert.deepEqual(await waiting(page, 'advance'), [5000], 'the next step is not asked for');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('in the mode the hotspot ranks and a stair link\'s words are 1.5 times as large, and 11 px again out of it', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    // one floor on the map, so a stair link runs off it with its words
    await page.evaluate(() => {
      const m = document.querySelector('.mov').movement;
      m.change({ floors: m.state.project.building.floors[0].id });
    });
    await settled(page);
    // what the map's two canvases are told to write, with the font
    await page.evaluate(() => {
      globalThis.__written = [];
      const real = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function written(text, x, y, most) {
        const canvas = this.canvas;
        if (canvas.matches('#movement-plan, .mov-marks')) globalThis.__written.push({ on: canvas.id || 'marks', text: String(text), font: this.font });
        return real.call(this, text, x, y, most);
      };
    });
    const drawn = async (wait) => {
      await page.evaluate(() => { globalThis.__written = []; });
      await wait();
      return page.evaluate(() => globalThis.__written.slice());
    };
    const sizeOf = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
    const read2 = (writes) => ({
      ranks: [...new Set(writes.filter((w) => w.on === 'marks' && /^\d$/.test(w.text)).map((w) => sizeOf(w.font)))],
      links: [...new Set(writes.filter((w) => w.on === 'movement-plan' && / to Floor /.test(w.text)).map((w) => sizeOf(w.font)))],
    });
    const out = read2(await drawn(() => page.evaluate(() => new Promise((resolve) => {
      document.querySelector('.mov').movement.plan.paint();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }))));
    assert.deepEqual(out, { ranks: [11], links: [11] }, 'out of the mode: ' + JSON.stringify(out));
    const count = await restoredCount(page);
    await page.keyboard.press('p');
    await inMode(page);
    // written from here: a paint of the marks asked before P (the scale 1) is not this one's
    const inside = read2(await drawn(() => page.evaluate(() => new Promise((resolve) => {
      document.querySelector('.mov').movement.plan.paint();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }))));
    assert.deepEqual(inside, { ranks: [17], links: [17] }, 'in the mode: ' + JSON.stringify(inside));
    await page.keyboard.press('Escape');
    await outOfMode(page, count);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('a change of address inside Movement while presenting leaves the mode, puts the transition back, and lets go of every listener and observer', async () => {
  const session = await openPlanner({ browser, server, hash: '#schedule/groups', width: 1280, height: 800 });
  const { page } = session;
  try {
    // counted from before Movement is mounted: the size listeners, the
    // stage's observers and the document's full screen listeners alive
    await page.evaluate(() => {
      const live = { media: 0, observers: new Set(), fullscreen: 0 };
      globalThis.__live = live;
      const add = MediaQueryList.prototype.addEventListener;
      const remove = MediaQueryList.prototype.removeEventListener;
      MediaQueryList.prototype.addEventListener = function counted(type, fn, options) { if (type === 'change') live.media += 1; return add.call(this, type, fn, options); };
      MediaQueryList.prototype.removeEventListener = function counted(type, fn, options) { if (type === 'change') live.media -= 1; return remove.call(this, type, fn, options); };
      const observe = ResizeObserver.prototype.observe;
      const disconnect = ResizeObserver.prototype.disconnect;
      ResizeObserver.prototype.observe = function counted(...args) { live.observers.add(this); return observe.apply(this, args); };
      ResizeObserver.prototype.disconnect = function counted() { live.observers.delete(this); return disconnect.call(this); };
      const on = EventTarget.prototype.addEventListener;
      const off = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function counted(type, fn, options) { if (this === document && /fullscreen/.test(type)) live.fullscreen += 1; return on.call(this, type, fn, options); };
      EventTarget.prototype.removeEventListener = function counted(type, fn, options) { if (this === document && /fullscreen/.test(type)) live.fullscreen -= 1; return off.call(this, type, fn, options); };
    });
    const alive = () => page.evaluate(() => ({ media: globalThis.__live.media, observers: globalThis.__live.observers.size, fullscreen: globalThis.__live.fullscreen }));
    const outside = await alive();
    await page.evaluate(() => { location.hash = '#movement'; });
    await settled(page);
    const once = await alive();
    await page.keyboard.press('p');
    await inMode(page);
    await page.keyboard.press('ArrowRight');
    const saved = await page.evaluate(() => document.querySelector('.mov').present.saved.transition);
    assert.notEqual((await read(page)).transition, saved, 'the step did not move: the case tests nothing');
    // another address of Movement's own: the section is mounted again
    await page.evaluate(() => { location.hash = '#movement/again'; });
    await page.waitForFunction(() => document.querySelectorAll('.mov').length === 1 && document.querySelector('.mov').present && !document.querySelector('.mov').present.presenting && Array.from(document.querySelectorAll('[inert]')).every((el) => el.closest('.mov')) && document.fullscreenElement === null, { timeout: 10000 }).catch(async (error) => {
      const found = await page.evaluate(() => ({ movs: document.querySelectorAll('.mov').length, presenting: document.querySelector('.mov') && document.querySelector('.mov').present ? document.querySelector('.mov').present.presenting : null, inert: Array.from(document.querySelectorAll('[inert]')).map((el) => el.className || el.tagName), full: document.fullscreenElement ? document.fullscreenElement.className : null, hash: location.hash }));
      throw new Error('the mode was not left on the change of address: ' + JSON.stringify(found) + ' (' + error.message + ')');
    });
    await settled(page);
    assert.equal((await read(page)).transition, saved, 'the section mounted again does not have the transition from before the mode');
    // what the section that left held is let go: the new one holds as many as the first did
    assert.deepEqual(await alive(), once, 'the section that left still holds listeners or observers (outside Movement: ' + JSON.stringify(outside) + ')');
    // P on the new one presents it, and only it
    await page.keyboard.press('p');
    await inMode(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.mov').present.presenting);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('at 390 by 844 with the controls folded, leaving puts the focus on Change (Present is folded with them), not on the page', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 390, height: 844, mobile: true });
  const { page } = session;
  try {
    await settled(page);
    // folded, as a phone opens them unless the reader opened them before on this device
    if (await page.$eval('.mov-top', (el) => el.dataset.folded !== 'true')) await page.click('[data-action="change"]');
    await page.waitForFunction(() => document.querySelector('.mov-top').dataset.folded === 'true');
    assert.equal(await page.$eval('[data-action="present"]', (el) => el.getClientRects().length), 0, 'Present has a box with the controls folded');
    await page.focus('#movement-plan');
    const count = await restoredCount(page);
    await page.keyboard.press('p');
    await inMode(page);
    await page.keyboard.press('Escape');
    await outOfMode(page, count);
    assert.equal((await read(page)).focus, 'change', 'the focus fell to the page');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the touch controls, the corner line, the caption and the panel keep clear of a phone\'s safe area', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 844, height: 390, mobile: true });
  const { page } = session;
  try {
    await settled(page);
    const insets = { top: 0, left: 44, right: 44, bottom: 21 };
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await page.evaluate(() => document.querySelector('.mov').present.enter());
    await inMode(page);
    await page.evaluate(() => {
      document.querySelector('[data-part="present-touch"]').dataset.shown = 'true';
      document.querySelector('[data-part="present-line"]').dataset.shown = 'true';
      document.querySelector('[data-part="present-line"]').textContent = 'A line.';
    });
    const boxes = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
      const pad = (s) => { const style = getComputedStyle(document.querySelector(s)); return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom) }; };
      return { touch: box('[data-part="present-touch"]'), line: box('[data-part="present-line"]'), caption: pad('[data-part="present-caption"]'), panel: pad('[data-part="present-panel"]'), window: { width: innerWidth, height: innerHeight } };
    });
    assert.ok(boxes.touch.bottom <= boxes.window.height - insets.bottom, 'the controls lie in the home bar\'s inset: ' + JSON.stringify(boxes.touch));
    assert.ok(boxes.line.left >= insets.left && boxes.line.bottom <= boxes.window.height - insets.bottom, 'the corner line lies in the inset: ' + JSON.stringify(boxes.line));
    assert.ok(boxes.caption.left >= insets.left, 'the caption\'s words start in the left inset: ' + JSON.stringify(boxes.caption));
    assert.ok(boxes.panel.right >= insets.right && boxes.panel.bottom >= insets.bottom, 'the panel\'s words run into the right or bottom inset: ' + JSON.stringify(boxes.panel));
    // the CDP session is not detached: a detach once took the page's touch emulation with it (SV2-72b)
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});
