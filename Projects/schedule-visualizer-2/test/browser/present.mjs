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

import { openPlanner, TOOL_DIR, launch, startServer, loadModule } from './harness.mjs';

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
      // the mode's own Fit (present.js fitMode), and where it put the panel
      presentFitted: root.present.fitted,
      panelAt: root.dataset.presentPanel || null,
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
    return root.present.presenting && Boolean(root.dataset.present) && root.present.fitted && movement.view.width === stage.clientWidth && movement.view.height === stage.clientHeight && stage.clientHeight > 0;
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

// What lies round the stage, by height, so a failure names what changed:
// the section, its room for the map (--mov-room), the stage and the map's
// measure of it, the controls folded or open, the legend docked, and every
// row above and under the map (the sentence, the controls, the floors row,
// the playback bar with its lines, the docked legend line).
function rows(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.mov');
    const movement = root.movement;
    const tall = (el) => (el && el.getClientRects().length > 0 ? Math.round(el.getBoundingClientRect().height) : 0);
    return {
      section: root.clientHeight,
      room: root.style.getPropertyValue('--mov-room') || null,
      stage: movement.plan.stage.clientHeight,
      measured: movement.view.height,
      folded: document.querySelector('.mov-top').dataset.folded,
      docked: document.querySelector('.mov-legend').dataset.docked,
      sentence: tall(document.querySelector('.mov-line')),
      controls: tall(document.querySelector('.mov-controls')),
      floors: tall(document.querySelector('.mov-floors')),
      bar: tall(document.querySelector('[data-bar="playback"]')),
      barLines: Array.from(document.querySelectorAll('.mov-pb__line')).map(tall),
      legendLine: tall(document.querySelector('.mov-legend-line')),
      scroll: root.scrollTop,
    };
  });
}

// Measured: the map's view is the size of the stage it has now. A read of
// the map straight after the controls are unfolded can come before the
// plan map has measured the smaller stage (SV2-31f: on GitHub's runner the
// phone case's `before` was the view of the folded section, 390 by 512,
// and the section put back after Leave, 390 by 380, failed against it).
async function measured(page, what) {
  await page.waitForFunction(() => {
    const movement = document.querySelector('.mov').movement;
    const stage = movement.plan.stage;
    return stage.clientHeight > 0 && movement.view.width === stage.clientWidth && movement.view.height === stage.clientHeight;
  }, { timeout: 10000 }).catch(async (error) => {
    throw new Error(what + ': the map was not measured on its stage: ' + JSON.stringify(await rows(page)) + ' (' + error.message + ')');
  });
}
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
      assert.equal(now.presentFitted, true, 'the map is not at the mode\'s Fit');
      assert.equal(now.panelAt, 'beside', 'at 1280 by 800 the panel is not beside the map');
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
      // and the map measured on the stage the open controls leave it (SV2-31f)
      await measured(page, 'before Present');
      const before = await read(page);
      const rowsBefore = await rows(page);
      // the timers handed over first: entering by a tap asks for the controls' fade at once
      await handTimers(page);
      await page.tap('[data-action="present"]');
      await inMode(page);
      let now = await read(page);
      assert.ok(now.present === 'fullscreen' || now.present === 'window');
      t.diagnostic('full screen here: ' + now.how);
      assert.deepEqual([now.root.width, now.root.height], [now.window.width, now.window.height]);
      assert.equal(now.labelScale, 1.5);
      assert.equal(now.presentFitted, true);
      const parts = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
        return { stage: box('.mov-stage'), panel: box('[data-part="present-panel"]') };
      });
      // the panel under the map on a phone, upright or on its side (SV2-31c: beside it, at 844 by 390 no floor layout is whole); never over it
      assert.equal(now.panelAt, 'under', 'the panel is not under the map');
      assert.ok(parts.panel.top >= parts.stage.bottom - 1, 'the panel lies over the map');
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
      // the rows round the stage before Present and after Leave, in every message that compares the map (SV2-31f)
      const around = ' (before Present ' + JSON.stringify(rowsBefore) + ', after Leave ' + JSON.stringify(await rows(page)) + ')';
      assert.equal(now.transition, before.transition, 'the transition');
      assert.equal(before.fitted, true, 'the phone opened off Fit: the case tests the wrong thing');
      assert.equal(now.fitted, true, 'the map is not at Fit again' + around);
      assert.equal(now.fit, before.fit, 'the stage\'s fit' + around);
      assert.deepEqual(now.view, before.view, 'the zoom and place' + around);
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
    // every change of full screen, by the element it made full screen (SV2-31c: the case had read only the end state)
    await page.evaluate(() => {
      globalThis.__fullscreenSeen = [];
      document.addEventListener('fullscreenchange', () => {
        globalThis.__fullscreenSeen.push(document.fullscreenElement === document.querySelector('.mov') ? 'section' : document.fullscreenElement ? 'other' : 'none');
      });
    });
    await page.focus('[data-action="present"]');
    await page.keyboard.press('p');
    await page.waitForFunction(() => document.querySelector('.mov').dataset.present === 'window');
    const count = await restoredCount(page);
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).presenting, false, 'Escape did not leave');
    // the browser says yes now (evaluate carries a user gesture, as the press did)
    await page.evaluate(() => globalThis.__releaseFullscreen());
    await outOfMode(page, count);
    await page.waitForFunction(() => document.fullscreenElement === null, { timeout: 5000 });
    // the grant came, to the section, and was given back: the branch that gives it back ran
    assert.deepEqual(await page.evaluate(() => globalThis.__fullscreenSeen), ['section', 'none'], 'the late grant was not seen and given back');
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
    // and it stands beside its cell on the map as it is now, not where the mode's map had it (SV2-31c)
    const off = await cardBesideCell(page);
    assert.ok(off <= 1, 'the card stands ' + off.toFixed(1) + ' px further from its cell than card.js lays it');
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

test('the auto-advance lets a running playback finish: the step waits through a pause and a seek, and comes when the playback reaches its end', async () => {
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
    const due = () => page.evaluate(() => document.querySelector('.mov').present.due);
    const pb = (what, value) => page.evaluate((w, v) => {
      const playback = document.querySelector('[data-bar="playback"]').playback;
      return w === 'seek' ? playback.seek(v * playback.end) : w === 'at' ? playback.seconds / playback.end : null;
    }, what, value);
    // half way through the transition when the step's time comes
    await pb('seek', 0.5);
    assert.equal(await runTimer(page, 'advance'), 5000);
    let now = await read(page);
    assert.equal(now.transition, 1, 'the step came with the playback running');
    assert.equal(await due(), true, 'no step is waiting');
    // the scrubber moved back is not the playback finishing (SV2-31c: a seek back brought the step)
    await pb('seek', 0.1);
    await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').playback.seconds > 0, { timeout: 5000 });
    now = await read(page);
    assert.equal(now.transition, 1, 'a seek back brought the step');
    assert.equal(await due(), true, 'a seek back let the waiting step go');
    // Space to pause mid-transition holds the step until Play (SV2-31c: it came at once)
    await page.keyboard.press(' ');
    now = await read(page);
    assert.equal(now.playing, false);
    assert.equal(now.transition, 1, 'a pause mid-transition brought the step');
    assert.equal(await due(), true, 'a pause let the waiting step go');
    await page.keyboard.press(' ');
    assert.equal((await read(page)).playing, true, 'Space did not play again');
    assert.equal((await read(page)).transition, 1);
    // played to its end: the step comes, and the next is timed from there
    await pb('seek', 0.98);
    await page.waitForFunction(() => document.querySelector('.mov').movement.choice.transition === 2, { timeout: 15000 });
    now = await read(page);
    assert.equal(now.playing, false, 'the playback did not stop at its end');
    assert.equal(await due(), false);
    assert.deepEqual(await waiting(page, 'advance'), [5000], 'the next step is not asked for');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the waiting step comes when a playback looping its transition goes round from its end, and not when it is sought back', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await settled(page);
    await page.evaluate(() => {
      const m = document.querySelector('.mov').movement;
      m.change({ transition: 1 });
      document.querySelector('[data-bar="playback"]').playback.set({ loop: 'transition' });
    });
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    await handTimers(page);
    await page.keyboard.press('a');
    await page.keyboard.press(' ');
    await page.evaluate(() => { const p = document.querySelector('[data-bar="playback"]').playback; p.seek(p.end * 0.5); });
    await runTimer(page, 'advance');
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.due), true, 'no step is waiting');
    // near the end: it goes round to its start by itself, and that is the transition played
    await page.evaluate(() => { const p = document.querySelector('[data-bar="playback"]').playback; p.seek(p.end * 0.98); });
    await page.waitForFunction(() => document.querySelector('.mov').movement.choice.transition === 2, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.due), false);
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    // the loop is kept on this device: the cases after this one play once
    await page.evaluate(() => document.querySelector('[data-bar="playback"]').playback.set({ loop: 'once' })).catch(() => {});
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
      globalThis.__arcs = [];
      const real = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function written(text, x, y, most) {
        const canvas = this.canvas;
        if (canvas.matches('#movement-plan, .mov-marks')) globalThis.__written.push({ on: canvas.id || 'marks', text: String(text), font: this.font, x, y, width: this.measureText(String(text)).width });
        return real.call(this, text, x, y, most);
      };
      // the discs the ranks are written on: arcs on the marks' canvas
      const arc = CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc = function drawn(x, y, r, ...rest) {
        if (this.canvas.matches('.mov-marks')) globalThis.__arcs.push({ x, y, r });
        return arc.call(this, x, y, r, ...rest);
      };
    });
    const drawn = async (wait) => {
      await page.evaluate(() => { globalThis.__written = []; globalThis.__arcs = []; });
      await wait();
      return page.evaluate(() => globalThis.__written.slice());
    };
    // each rank's digit and the disc it is written on (the arc centred where it is written, half a pixel up)
    const discs = () => page.evaluate(() => globalThis.__written.filter((w) => w.on === 'marks' && /^\d$/.test(w.text)).map((w) => {
      const disc = globalThis.__arcs.find((a) => Math.abs(a.x - w.x) < 0.01 && Math.abs(a.y - (w.y - 0.5)) < 0.01);
      return { size: Number(/(\d+(?:\.\d+)?)px/.exec(w.font)[1]), width: w.width, r: disc ? disc.r : null };
    }));
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
    const outDiscs = await discs();
    const count = await restoredCount(page);
    await page.keyboard.press('p');
    await inMode(page);
    // written from here: a paint of the marks asked before P (the scale 1) is not this one's
    const inside = read2(await drawn(() => page.evaluate(() => new Promise((resolve) => {
      document.querySelector('.mov').movement.plan.paint();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }))));
    assert.deepEqual(inside, { ranks: [17], links: [17] }, 'in the mode: ' + JSON.stringify(inside));
    // the disc grows with its digit (SV2-31c: an 8 px disc under a 17 px digit): as large against it as out of the mode, and the digit fits in it
    const inDiscs = await discs();
    assert.ok(outDiscs.length >= 3 && inDiscs.length >= 3, 'the ranks\' discs were not found: ' + JSON.stringify({ outDiscs, inDiscs }));
    const ratio = (all) => all[0].r / all[0].size;
    for (const each of inDiscs) {
      assert.ok(each.r !== null, 'a rank is written on no disc');
      assert.ok(Math.abs(each.r / each.size - ratio(outDiscs)) <= 0.1 * ratio(outDiscs), 'the disc is ' + each.r + ' px round a ' + each.size + ' px digit; out of the mode ' + outDiscs[0].r + ' round ' + outDiscs[0].size);
      assert.ok(each.width + 4 <= 2 * each.r && each.size <= 2 * each.r - 4, 'the ' + each.size + ' px digit (' + each.width.toFixed(1) + ' wide) does not fit a ' + each.r + ' px disc with 2 px about it');
    }
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
    // the section that leaves, held: its picture now, and how often its floors were laid out
    await page.evaluate(() => {
      const root = document.querySelector('.mov');
      globalThis.__left = { root, picture: root.movement.picture, layouts: root.present.layouts };
    });
    // another address of Movement's own: the section is mounted again
    await page.evaluate(() => { location.hash = '#movement/again'; });
    await page.waitForFunction(() => document.querySelectorAll('.mov').length === 1 && document.querySelector('.mov').present && !document.querySelector('.mov').present.presenting && Array.from(document.querySelectorAll('[inert]')).every((el) => el.closest('.mov')) && document.fullscreenElement === null, { timeout: 10000 }).catch(async (error) => {
      const found = await page.evaluate(() => ({ movs: document.querySelectorAll('.mov').length, presenting: document.querySelector('.mov') && document.querySelector('.mov').present ? document.querySelector('.mov').present.presenting : null, inert: Array.from(document.querySelectorAll('[inert]')).map((el) => el.className || el.tagName), full: document.fullscreenElement ? document.fullscreenElement.className : null, hash: location.hash }));
      throw new Error('the mode was not left on the change of address: ' + JSON.stringify(found) + ' (' + error.message + ')');
    });
    await settled(page);
    assert.equal((await read(page)).transition, saved, 'the section mounted again does not have the transition from before the mode');
    // the transition was put back in memory, not by drawing the section that left again (SV2-31c)
    const left = await page.evaluate(() => {
      const held = globalThis.__left;
      const sameRoot = held.root === document.querySelector('.mov');
      const samePicture = held.root.movement.picture === held.picture;
      // its plan map laid out again by hand: the mode's listener is no longer on it (onLayout's unregister)
      const before = held.root.present.layouts;
      held.root.movement.plan.setProject(held.root.movement.plan.project, held.root.movement.plan.graph);
      return { sameRoot, samePicture, layoutsAfter: held.root.present.layouts - before };
    });
    assert.equal(left.sameRoot, false, 'the section was not mounted again: the case tests nothing');
    assert.equal(left.samePicture, true, 'the section that left was drawn again on its way out');
    assert.equal(left.layoutsAfter, 0, 'the section that left still listens to its plan map\'s layout');
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

// The safe area (a phone's notch, rounded corners and home bar), by
// geometry: every word of the caption, the corner line and the panel (as
// far as the panel shows it), and every touch control, lies inside the
// window less the insets. On a phone on its side and upright (the panel
// under the map), and on a tablet on its side (the panel beside it, so its
// own top is the screen's top).
for (const size of [
  { width: 844, height: 390, insets: { top: 20, left: 44, right: 44, bottom: 21 } },
  { width: 390, height: 844, insets: { top: 47, left: 12, right: 12, bottom: 34 } },
  { width: 1180, height: 820, insets: { top: 24, left: 0, right: 20, bottom: 20 } },
  // a phone on its side in a shorter window, with an upright phone's home bar: there the panel's least is its height (SV2-31d: the row was cut 18 px)
  { width: 844, height: 360, insets: { top: 0, left: 0, right: 0, bottom: 34 } },
]) {
  test('at ' + size.width + ' by ' + size.height + ' the touch controls, the corner line, the caption and the panel keep clear of the safe area', async () => {
    const session = await openPlanner({ browser, server, hash: '#movement', width: size.width, height: size.height, mobile: true });
    const { page } = session;
    try {
      await settled(page);
      const insets = size.insets;
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
      await page.evaluate(() => document.querySelector('.mov').present.enter());
      await inMode(page);
      await page.evaluate((says) => {
        document.querySelector('[data-part="present-touch"]').dataset.shown = 'true';
        document.querySelector('[data-part="present-line"]').dataset.shown = 'true';
        document.querySelector('[data-part="present-line"]').textContent = says;
      }, REFUSED_SAYS);
      const found = await page.evaluate(() => {
        const out = [];
        // the boxes of the words in an element, cut to the box it scrolls
        // them in (inside its borders): what of them is on the screen
        const words = (el, name, shownIn) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let seen = null;
          if (shownIn) {
            const outer = shownIn.getBoundingClientRect();
            const top = outer.top + shownIn.clientTop;
            const left = outer.left + shownIn.clientLeft;
            seen = { top, left, bottom: top + shownIn.clientHeight, right: left + shownIn.clientWidth };
          }
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.textContent.trim() === '' || node.parentElement.closest('[hidden], .vh')) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.width === 0 || rect.height === 0) continue;
              const box = seen ? { left: Math.max(rect.left, seen.left), top: Math.max(rect.top, seen.top), right: Math.min(rect.right, seen.right), bottom: Math.min(rect.bottom, seen.bottom) } : rect;
              if (box.right <= box.left || box.bottom <= box.top) continue;
              out.push({ name, text: node.textContent.slice(0, 20), left: box.left, top: box.top, right: box.right, bottom: box.bottom });
            }
          }
        };
        const panel = document.querySelector('[data-part="present-panel"]');
        words(document.querySelector('[data-part="present-caption"]'), 'caption');
        words(document.querySelector('[data-part="present-line"]'), 'line');
        words(panel, 'panel', panel);
        for (const button of document.querySelectorAll('[data-part="present-touch"] button')) {
          const rect = button.getBoundingClientRect();
          out.push({ name: 'touch', text: button.textContent, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        }
        return { boxes: out, window: { width: innerWidth, height: innerHeight }, panelAt: document.querySelector('.mov').dataset.presentPanel };
      });
      const names = new Set(found.boxes.map((box) => box.name));
      for (const name of ['caption', 'line', 'panel', 'touch']) assert.ok(names.has(name), 'nothing of the ' + name + ' was measured');
      for (const box of found.boxes) {
        const where = box.name + ' "' + box.text + '" at ' + JSON.stringify([Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)]);
        assert.ok(box.left >= insets.left - 0.5 && box.right <= found.window.width - insets.right + 0.5, where + ' runs into the left or right inset (panel ' + found.panelAt + ')');
        assert.ok(box.top >= insets.top - 0.5 && box.bottom <= found.window.height - insets.bottom + 0.5, where + ' runs into the top or bottom inset (panel ' + found.panelAt + ')');
      }
      // no floor under a notch on either side (SV2-31d: the mode's fit kept 20 px off the edges against a 44 px inset)
      const floors = await page.evaluate(() => {
        const m = document.querySelector('.mov').movement;
        const stage = m.plan.stage.getBoundingClientRect();
        const size = m.view.size;
        return m.world.slots.map((slot) => ({ name: slot.floor.name, left: stage.left + m.view.x + slot.x * size, right: stage.left + m.view.x + (slot.x + slot.w) * size }));
      });
      for (const floor of floors) {
        assert.ok(floor.left >= insets.left - 0.5 && floor.right <= found.window.width - insets.right + 0.5, floor.name + ' runs into the left or right inset: ' + JSON.stringify([Math.round(floor.left), Math.round(floor.right)]));
      }
      // under the map the panel shows its first row of groups whole, inside
      // the box it scrolls in and above the bottom inset (SV2-31d: its
      // least left out the inset's border, and a 38dvh cap cut the row)
      if (found.panelAt === 'under') {
        const row = await page.evaluate(() => {
          const panel = document.querySelector('[data-part="present-panel"]');
          const items = Array.from(panel.querySelectorAll('[data-present="groups"] li'));
          const top = items[0].getBoundingClientRect().top;
          const first = items.filter((li) => Math.abs(li.getBoundingClientRect().top - top) < 1);
          const outer = panel.getBoundingClientRect();
          return { bottom: Math.max(...first.map((li) => li.getBoundingClientRect().bottom)), shown: outer.top + panel.clientTop + panel.clientHeight, count: first.length };
        });
        assert.ok(row.count > 0, 'no row of groups');
        assert.ok(row.bottom <= row.shown + 0.5, 'the first row of groups is cut: its foot at ' + row.bottom.toFixed(1) + ', the panel shows to ' + row.shown.toFixed(1));
        assert.ok(row.bottom <= found.window.height - insets.bottom + 0.5, 'the first row of groups runs into the bottom inset');
      }
      // the CDP session is not detached: a detach once took the page's touch emulation with it (SV2-72b)
      await page.keyboard.press('Escape');
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}

// ---- SV2-31c: the second review's faults, each a case

// How far the cell card stands from the cell it is open on, in px past
// what card.js leaves between them: it lays the card a cell and 10 px from
// the cell's middle (or 10 px the other side), so a card beside its cell
// reads 0 here or less; the cell is found where the map draws it now.
function cardBesideCell(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.mov').movement;
    const card = document.querySelector('.mov-card');
    if (!m.point || !card || card.hidden || card.getClientRects().length === 0) return Infinity;
    const at = m.cellAt(m.point.floorId, m.point.cell);
    const canvas = m.plan.canvas.getBoundingClientRect();
    const x = canvas.left + at.x;
    const y = canvas.top + at.y;
    const box = card.getBoundingClientRect();
    const across = Math.max(0, box.left - x, x - box.right);
    const down = Math.max(0, box.top - y, y - box.bottom);
    return Math.max(across, down) - (m.view.size + 10);
  });
}

// What lies over a drawn floor in the mode: each floor's box on the screen
// (its slot at the map's zoom and place, its name over it), against the
// caption, the panel, the touch controls and the corner line, shown and
// saying the longest it says (the refusal); and a floor off the screen.
function overFloors(page) {
  return page.evaluate((says) => {
    const root = document.querySelector('.mov');
    const m = root.movement;
    document.querySelector('[data-part="present-touch"]').dataset.shown = 'true';
    const line = document.querySelector('[data-part="present-line"]');
    line.dataset.shown = 'true';
    line.textContent = says;
    const stage = m.plan.stage.getBoundingClientRect();
    const size = m.view.size;
    const floors = m.world.slots.map((slot) => ({ name: slot.floor.name, left: stage.left + m.view.x + slot.x * size, top: stage.top + m.view.y + slot.y * size, right: stage.left + m.view.x + (slot.x + slot.w) * size, bottom: stage.top + m.view.y + (slot.y + slot.h) * size }));
    const parts = {};
    for (const part of ['caption', 'panel', 'touch', 'line']) {
      const el = document.querySelector('[data-part="present-' + part + '"]');
      parts[part] = el.getClientRects().length > 0 ? el.getBoundingClientRect().toJSON() : null;
    }
    const hits = [];
    for (const floor of floors) {
      for (const [name, box] of Object.entries(parts)) {
        if (box && floor.left < box.right && box.left < floor.right && floor.top < box.bottom && box.top < floor.bottom) hits.push(floor.name + ' under the ' + name);
      }
      if (floor.left < 0 || floor.top < 0 || floor.right > innerWidth || floor.bottom > innerHeight) hits.push(floor.name + ' off the screen');
    }
    return { hits, panelAt: root.dataset.presentPanel, how: m.world.how, zoom: m.view.zoom, floors: floors.length };
  }, REFUSED_SAYS);
}

// Which parts of the mode lie over one another: the caption, the corner
// line, the panel and the touch controls, by their boxes as they are now
// (overFloors shows the line and the controls first).
function partsOver(page) {
  return page.evaluate(() => {
    const boxes = {};
    for (const part of ['caption', 'line', 'panel', 'touch']) {
      const el = document.querySelector('[data-part="present-' + part + '"]');
      if (el.getClientRects().length > 0) boxes[part] = el.getBoundingClientRect().toJSON();
    }
    const names = Object.keys(boxes);
    const hits = [];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = boxes[names[i]];
        const b = boxes[names[j]];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) hits.push(names[i] + ' over ' + names[j] + ' ' + JSON.stringify([Math.round(Math.max(a.left, b.left)), Math.round(Math.max(a.top, b.top)), Math.round(Math.min(a.right, b.right)), Math.round(Math.min(a.bottom, b.bottom))]));
      }
    }
    if (names.length < 4) hits.push('only ' + names.join(', ') + ' drawn');
    return hits;
  });
}

for (const size of [{ width: 1280, height: 800, touch: false }, { width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true }]) {
  test('at ' + size.width + ' by ' + size.height + (size.touch ? ' by touch' : '') + ', at the mode\'s Fit no floor lies under the caption, the panel, the touch controls or the corner line, and every floor is on the screen', async () => {
    const session = await openPlanner({ browser, server, hash: '#movement', width: size.width, height: size.height, mobile: size.touch });
    const { page } = session;
    try {
      await settled(page);
      if (size.touch) {
        // tapped, as the Foreman's screens of 03d529aa were taken
        if (await page.$eval('[data-action="present"]', (el) => el.getClientRects().length === 0)) await page.tap('[data-action="change"]');
        await page.waitForFunction(() => document.querySelector('[data-action="present"]').getClientRects().length > 0);
        await page.$eval('[data-action="present"]', (el) => el.scrollIntoView({ block: 'nearest' }));
        // the fade's timer the test's own, so the controls are read before it, whatever the machine's speed
        await handTimers(page);
        await page.tap('[data-action="present"]');
      } else {
        await page.focus('[data-action="present"]');
        await page.keyboard.press('p');
      }
      await inMode(page);
      if (size.touch) {
        // entered by a tap, the controls are in view: every one inside the
        // window, drawn whole (opacity 1 once their fade in is over) and
        // the thing a finger at its middle reaches (SV2-31d: at 390 by 844
        // they were not to be seen after a tapped entry)
        await page.waitForFunction(() => document.querySelector('[data-part="present-touch"]').getAnimations().length === 0, { timeout: 5000 });
        const seen = await page.evaluate(() => Array.from(document.querySelectorAll('[data-part="present-touch"] button')).map((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { action: el.dataset.action, inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, opacity: getComputedStyle(el.parentElement).opacity, reached: hit !== null && (hit === el || el.contains(hit)) };
        }));
        for (const each of seen) assert.deepEqual([each.inside, each.opacity, each.reached], [true, '1', true], each.action + ' is not in view after a tapped entry at ' + size.width + ' by ' + size.height + ': ' + JSON.stringify(each));
      }
      // and a step on, the caption saying a transition
      await page.keyboard.press('ArrowRight');
      await inMode(page);
      const found = await overFloors(page);
      assert.equal(found.floors, 3, 'the sample school\'s three floors are not on the map: the case tests the wrong thing');
      assert.deepEqual(found.hits, [], 'at ' + size.width + ' by ' + size.height + ' (panel ' + found.panelAt + ', floors ' + found.how + ', zoom ' + found.zoom.toFixed(3) + ')');
      // and no part of the mode over another, the line saying its longest (SV2-31d: at 844 by 390 the controls lay over the line's end)
      assert.deepEqual(await partsOver(page), [], 'at ' + size.width + ' by ' + size.height + ' (panel ' + found.panelAt + ')');
      assert.ok(found.zoom >= 0.25, 'the map is under 25 %');
      // the arrangement the mode chose there, for the record of why: beside on a desk, under on a phone either way up
      assert.equal(found.panelAt, size.touch ? 'under' : 'beside');
      if (size.width === 844) assert.equal(found.how, 'side', 'on its side the floors are not side by side');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.mov').present.presenting);
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}

test('P held down presents once: its repeats neither leave nor enter again, and Escape held leaves once', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    // the presses the mode saw, by what each did
    await page.evaluate(() => {
      globalThis.__presents = [];
      new MutationObserver(() => globalThis.__presents.push(document.querySelector('.mov').dataset.present ? 'in' : 'out')).observe(document.querySelector('.mov'), { attributes: true, attributeFilter: ['data-present'] });
    });
    await page.focus('body');
    // a held key: the first press, then the keyboard's repeats (event.repeat)
    await page.keyboard.down('p');
    await page.keyboard.down('p');
    await page.keyboard.down('p');
    await page.keyboard.up('p');
    // the observer has seen the mode go in
    await page.waitForFunction(() => globalThis.__presents.includes('in'), { timeout: 10000 });
    const seen = await page.evaluate(() => globalThis.__presents.filter((each, i, all) => i === 0 || each !== all[i - 1]));
    assert.deepEqual(seen, ['in'], 'P held went in and out: ' + JSON.stringify(seen));
    assert.equal((await read(page)).presenting, true, 'P held left the mode again');
    await inMode(page);
    const count = await restoredCount(page);
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    await page.keyboard.up('Escape');
    await outOfMode(page, count);
    assert.equal((await read(page)).presenting, false);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('a full screen the browser will not give up when the mode is left: the map is not looked for every frame, and is put back when full screen does end', async (t) => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    if ((await read(page)).how !== 'fullscreen') {
      // no full screen here: nothing can refuse to end it, and the run says so (SV2-31d: it returned green)
      await page.keyboard.press('Escape');
      t.skip('this browser did not grant full screen, so it cannot refuse to end it');
      return;
    }
    await handTimers(page);
    // the browser refuses to leave full screen
    await page.evaluate(() => {
      globalThis.__exit = Document.prototype.exitFullscreen;
      Document.prototype.exitFullscreen = function refuse() {
        return Promise.reject(new TypeError('Not now'));
      };
    });
    const count = await restoredCount(page);
    await page.keyboard.press('Escape');
    assert.equal((await read(page)).presenting, false, 'Escape did not leave');
    assert.equal(await page.evaluate(() => document.fullscreenElement === document.querySelector('.mov')), true, 'full screen ended: the case tests nothing');
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.looking), true, 'the map is not being looked for');
    // the time to put it back is up while full screen still holds: the looking stops (SV2-31c: it went on a frame at a time)
    assert.equal(await runTimer(page, 'restore'), 1000);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.looking), false, 'the map is still looked for each frame');
    assert.equal(await restoredCount(page), count, 'the map was put back while the screen was still full');
    // full screen ends at last: the map is put back then
    await page.evaluate(() => globalThis.__exit.call(document));
    await outOfMode(page, count);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the project left with nothing to draw while presenting: the mode is left, and the focus goes to the section, not the page', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await loadModule(page, 'actions', 'engine/actions.js');
    await page.keyboard.press('p');
    await inMode(page);
    // every group deleted (from another tab, or a script): the map has nothing to show
    await page.evaluate(() => {
      const { deleteGroup } = globalThis.sv2modules.actions;
      const store = globalThis.sv2.store;
      for (const group of store.project.groups.slice()) store.apply(deleteGroup, { id: group.id });
    });
    await page.waitForFunction(() => !document.querySelector('.mov').present.presenting && document.fullscreenElement === null, { timeout: 10000 });
    // the section has its answer for the empty project and has drawn its empty card (which it draws again on each change)
    await page.waitForFunction(() => document.querySelector('.mov-map').hidden === true && document.querySelector('.mov').dataset.pending !== 'true' && !document.querySelector('.mov-empty').hidden);
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      return { body: el === document.body || el === null, card: Boolean(el && el.matches('.mov-empty')), heading: el ? (el.querySelector('h1') || { textContent: '' }).textContent : null, tag: el ? el.tagName : null, box: el ? el.getClientRects().length : 0 };
    });
    assert.equal(focus.body, false, 'the focus fell to the page');
    // the section's empty card, its heading first, which says what the section needs; not the shell's region (main) (SV2-31d)
    assert.equal(focus.card, true, 'the focus is not on the section\'s empty card: ' + JSON.stringify(focus));
    assert.equal(focus.heading, 'This is the movement view.', 'the card in focus does not start with the section\'s heading');
    assert.ok(focus.box > 0, 'the focus is on something with no box: ' + JSON.stringify(focus));
    assert.equal((await read(page)).inertCount, 0, 'something is left inert');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---- SV2-31d: the third review's faults and risks, each a case

// Window sizes the mode is entered at, desk and tablet, wide and short and
// upright, where the panel's place and the floors' layout could each go
// either way.
const SWEEP = [];
for (const width of [640, 800, 960, 1120, 1280, 1440]) for (const height of [360, 480, 600, 720, 840, 960]) SWEEP.push([width, height]);

test('a p held down in a text field types on: its repeats are the field\'s while Movement is mounted, and the mode is not entered', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    // a field of the page's (a dialog's or the search box would do as well), and what reaches the window from it
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.type = 'text';
      field.id = 'held-p-field';
      field.setAttribute('aria-label', 'A field');
      document.body.append(field);
      globalThis.__pKeys = [];
      window.addEventListener('keydown', (event) => {
        if (event.key === 'p') globalThis.__pKeys.push({ repeat: event.repeat, cancelled: event.defaultPrevented });
      });
    });
    await page.focus('#held-p-field');
    await page.keyboard.down('p');
    await page.keyboard.down('p');
    await page.keyboard.down('p');
    await page.keyboard.up('p');
    const keys = await page.evaluate(() => globalThis.__pKeys);
    assert.deepEqual(keys.map((each) => each.repeat), [false, true, true], 'the held p was not seen as a press and two repeats: the case tests the wrong thing');
    assert.deepEqual(keys.filter((each) => each.cancelled), [], 'a repeat of the held p was cancelled in the field');
    assert.equal(await page.$eval('#held-p-field', (el) => el.value), 'ppp');
    assert.equal((await read(page)).presenting, false, 'p in a field presented');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('Escape held down to leave: its repeats after the leave reach neither the map nor the shell, until it comes up', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    // what of Escape gets past the mode to the page's own listeners
    await page.evaluate(() => {
      globalThis.__escapes = [];
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') globalThis.__escapes.push(event.repeat ? 'repeat' : 'press');
      });
    });
    const count = await restoredCount(page);
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    assert.equal((await read(page)).presenting, false, 'Escape did not leave');
    assert.deepEqual(await page.evaluate(() => globalThis.__escapes), [], 'the held Escape\'s repeats reached the page after the leave');
    await page.keyboard.up('Escape');
    await outOfMode(page, count);
    // up, and pressed again: the page's own again
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => globalThis.__escapes), ['press'], 'an Escape pressed afresh after the leave is still kept from the page');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('by touch at 844 by 390: a tap whose finger moves a pixel or two leaves the mode\'s Fit, a drag ends it, and a window of another size brings it back', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 844, height: 390, mobile: true });
  const { page } = session;
  try {
    await settled(page);
    await page.evaluate(() => document.querySelector('.mov').present.enter());
    await inMode(page);
    await handTimers(page);
    const fitView = (await read(page)).view;
    const stage = await page.$eval('.mov-stage', (el) => el.getBoundingClientRect().toJSON());
    const at = { x: stage.left + stage.width / 2, y: stage.top + stage.height / 3 };
    // the map's own 'view' said under the finger, counted: the small move did move the map
    await page.evaluate(() => {
      globalThis.__views = 0;
      document.querySelector('.mov').movement.plan.onCell((event) => { if (event.kind === 'view') globalThis.__views += 1; });
    });
    const drag = async (by) => {
      await page.touchscreen.touchStart(at.x, at.y);
      await page.touchscreen.touchMove(at.x + by, at.y + by / 2);
      await page.touchscreen.touchEnd();
    };
    await drag(2);
    let now = await read(page);
    assert.ok(await page.evaluate(() => globalThis.__views) > 0, 'a 2 px move did not move the map: the case tests nothing');
    assert.equal(now.presentFitted, true, 'a tap that moved 2 px ended the mode\'s Fit');
    assert.deepEqual(place(now.view), place(fitView), 'after the tap the map is not at the mode\'s Fit');
    // a drag is the reader's: the map stays where they took it
    await drag(40);
    now = await read(page);
    assert.equal(now.presentFitted, false, 'a 40 px drag left the mode\'s Fit on');
    assert.notDeepEqual(place(now.view), place(fitView), 'the drag did not move the map');
    // turned upright: fitted again, every floor whole and clear of the parts
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.waitForFunction(() => {
      const root = document.querySelector('.mov');
      const m = root.movement;
      return root.present.fitted && root.clientWidth === innerWidth && m.view.width === m.plan.stage.clientWidth && m.view.height === m.plan.stage.clientHeight;
    }, { timeout: 10000 });
    await inMode(page);
    const found = await overFloors(page);
    assert.deepEqual(found.hits, [], 'after the turn (panel ' + found.panelAt + ', floors ' + found.how + ')');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('at every size the mode chooses its panel\'s place by the layout the plan map draws there, and no floor lies under a part of the mode or off the screen', async (t) => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    const failed = [];
    const seenLeast = [];
    for (const [width, height] of SWEEP) {
      await page.setViewport({ width, height });
      await settled(page);
      await page.evaluate(() => document.querySelector('.mov').present.enter());
      await inMode(page);
      const found = await overFloors(page);
      const told = await page.evaluate(() => ({ judged: document.querySelector('.mov').dataset.presentHow || null, drawn: document.querySelector('.mov').movement.world.how }));
      // a window where no layout is whole at 25 % in either place (the map at its least) has floors past the stage whatever is chosen
      const least = found.zoom <= 0.25 + 1e-9;
      if (least) seenLeast.push(width + ' by ' + height);
      if ((!least && found.hits.length > 0) || told.judged !== told.drawn) failed.push(width + ' by ' + height + ': ' + JSON.stringify({ hits: found.hits, panel: found.panelAt, judged: told.judged, drawn: told.drawn, zoom: Number(found.zoom.toFixed(3)) }));
      await page.evaluate(() => document.querySelector('.mov').present.leave());
      await page.waitForFunction(() => !document.querySelector('.mov').dataset.present && document.fullscreenElement === null, { timeout: 10000 });
    }
    t.diagnostic(SWEEP.length + ' sizes; at 25 %, floors not judged: ' + (seenLeast.join(', ') || 'none'));
    assert.deepEqual(failed, [], 'the panel\'s place judged by another layout than the map draws, or a floor under a part');
    assert.ok(seenLeast.length <= 4, 'the map is at its least at ' + seenLeast.length + ' sizes: the sweep judges little');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('a full screen that ends late, after the reader zoomed the map: their zoom stands, and the map is not put back over it', async (t) => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    if ((await read(page)).how !== 'fullscreen') {
      await page.keyboard.press('Escape');
      t.skip('this browser did not grant full screen, so it cannot end late');
      return;
    }
    await handTimers(page);
    await page.evaluate(() => {
      globalThis.__exit = Document.prototype.exitFullscreen;
      Document.prototype.exitFullscreen = function refuse() {
        return Promise.reject(new TypeError('Not now'));
      };
    });
    const count = await restoredCount(page);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.fullscreenElement === document.querySelector('.mov')), true, 'full screen ended: the case tests nothing');
    // the reader zooms the map, full screen still on
    await page.focus('#movement-plan');
    await page.keyboard.press('=');
    const zoomed = (await read(page)).view.zoom;
    // full screen ends at last
    await page.evaluate(() => globalThis.__exit.call(document));
    await page.waitForFunction(() => {
      const m = document.querySelector('.mov').movement;
      return document.fullscreenElement === null && m.view.width === m.plan.stage.clientWidth && m.view.height === m.plan.stage.clientHeight;
    }, { timeout: 10000 });
    // the frame the put-back would look on, and its timer had it waited
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await runTimer(page, 'restore');
    const now = await read(page);
    assert.equal(await restoredCount(page), count, 'the map was put back over the reader\'s zoom');
    assert.equal(now.view.zoom, zoomed, 'the reader\'s zoom was changed');
    assert.equal(now.focus, 'CANVAS', 'the focus was taken from the map');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('the waiting step comes when a playback is taken back to within 2 % of its start from the middle (AROUND), and not to 10 %', async () => {
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
    const seek = (to) => page.evaluate((v) => { const p = document.querySelector('[data-bar="playback"]').playback; p.seek(v * p.end); }, to);
    await seek(0.5);
    await runTimer(page, 'advance');
    assert.equal(await page.evaluate(() => document.querySelector('.mov').present.due), true, 'no step is waiting');
    // two frames on from the middle, so a stride is known and is far under 2 % of the transition
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await seek(0.1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await read(page)).transition, 1, 'back to 10 % brought the step');
    // from the middle to 1 %: neither near the end nor a frame's stride, only AROUND says it went round
    await seek(0.01);
    await page.waitForFunction(() => document.querySelector('.mov').movement.choice.transition === 2, { timeout: 5000 }).catch((error) => {
      throw new Error('back to 1 % from the middle did not bring the waiting step (' + error.message + ')');
    });
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---- SV2-31e: the reader's zoom against the mode's Fit, and keys held past a leave

// The mode entered at 844 by 390 by touch, the map's own 'view' counted
// (globalThis.__views), and where a finger goes on the stage.
async function phoneInMode(page) {
  await settled(page);
  await page.evaluate(() => document.querySelector('.mov').present.enter());
  await inMode(page);
  await handTimers(page);
  await page.evaluate(() => {
    globalThis.__views = 0;
    document.querySelector('.mov').movement.plan.onCell((event) => { if (event.kind === 'view') globalThis.__views += 1; });
  });
  const stage = await page.$eval('.mov-stage', (el) => el.getBoundingClientRect().toJSON());
  return { x: stage.left + stage.width / 2, y: stage.top + stage.height / 3 };
}

// The reader zooms in with Ctrl and the wheel over the map, as the map's
// input takes it; the mode's Fit is over once the map says it moved.
async function zoomIn(page, at) {
  const before = (await read(page)).view.zoom;
  await page.evaluate((x, y) => {
    document.getElementById('movement-plan').dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, at.x, at.y);
  await page.waitForFunction((was) => {
    const root = document.querySelector('.mov');
    return !root.present.fitted && root.movement.view.zoom > was;
  }, { timeout: 5000 }, before);
  return (await read(page)).view;
}

test('by touch at 844 by 390: a reader who zoomed in the mode and taps a cell with a 2 px move keeps their zoom', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 844, height: 390, mobile: true });
  const { page } = session;
  try {
    const at = await phoneInMode(page);
    const zoomed = await zoomIn(page, at);
    const views = await page.evaluate(() => globalThis.__views);
    await page.touchscreen.touchStart(at.x, at.y);
    await page.touchscreen.touchMove(at.x + 2, at.y + 1);
    await page.touchscreen.touchEnd();
    assert.ok(await page.evaluate(() => globalThis.__views) > views, 'a 2 px move did not move the map: the case tests nothing');
    const now = await read(page);
    assert.equal(now.presentFitted, false, 'a tap put the mode\'s Fit back over the reader\'s zoom');
    assert.equal(now.view.zoom, zoomed.zoom, 'the reader\'s zoom did not stand through a tap');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('by touch at 844 by 390: the floors laid out again in the middle of a drag (a step) do not move the map under the finger', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 844, height: 390, mobile: true });
  const { page } = session;
  try {
    const at = await phoneInMode(page);
    const fitView = (await read(page)).view;
    const step = await page.evaluate(() => ({ layouts: document.querySelector('.mov').present.layouts, transition: document.querySelector('.mov').movement.choice.transition }));
    await page.touchscreen.touchStart(at.x, at.y);
    await page.touchscreen.touchMove(at.x + 40, at.y + 20);
    const dragged = (await read(page)).view;
    assert.notDeepEqual(place(dragged), place(fitView), 'the drag did not move the map: the case tests nothing');
    // a step with the finger still down: the floors are laid out again
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((was) => document.querySelector('.mov').present.layouts > was, { timeout: 5000 }, step.layouts).catch((error) => {
      throw new Error('the step did not lay the floors out again: the case tests nothing (' + error.message + ')');
    });
    let now = await read(page);
    assert.notEqual(now.transition, step.transition, 'the step did not step: the case tests nothing');
    assert.deepEqual(place(now.view), place(dragged), 'the map jumped under the finger when the floors were laid out mid-drag');
    await page.touchscreen.touchEnd();
    now = await read(page);
    assert.equal(now.presentFitted, false, 'a drag over a layout left the mode\'s Fit on');
    assert.deepEqual(place(now.view), place(dragged), 'the map moved as the finger lifted');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('by touch: a 56 px change of the window\'s height (a toolbar) keeps the reader\'s zoom, and a turn of the phone fits the mode again', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 844, height: 390, mobile: true });
  const { page } = session;
  try {
    const at = await phoneInMode(page);
    const zoomed = await zoomIn(page, at);
    // the arrangement made for the window as it is now, and the map measured there
    const arranged = (width, height) => page.waitForFunction((w, h) => {
      const root = document.querySelector('.mov');
      const m = root.movement;
      return innerWidth === w && innerHeight === h && root.dataset.presentArranged === w + 'x' + h && m.view.width === m.plan.stage.clientWidth && m.view.height === m.plan.stage.clientHeight;
    }, { timeout: 10000 }, width, height);
    await page.setViewport({ width: 844, height: 446, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await arranged(844, 446);
    let now = await read(page);
    assert.equal(now.presentFitted, false, 'a 56 px change of the window\'s height put the mode\'s Fit back');
    assert.equal(now.view.zoom, zoomed.zoom, 'the reader\'s zoom did not stand through a 56 px change of height');
    // turned: another width, the mode's Fit again
    await page.setViewport({ width: 446, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await arranged(446, 844);
    now = await read(page);
    assert.equal(now.presentFitted, true, 'a turn of the phone did not fit the mode again');
    assert.notEqual(now.view.zoom, zoomed.zoom, 'after the turn the map is at the reader\'s zoom still');
    await page.keyboard.press('Escape');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('Enter held down on Leave leaves once: its repeats on Present do not enter again, and a fresh Enter there does', async () => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    await page.evaluate(() => {
      globalThis.__presents = [];
      new MutationObserver(() => globalThis.__presents.push(document.querySelector('.mov').dataset.present ? 'in' : 'out')).observe(document.querySelector('.mov'), { attributes: true, attributeFilter: ['data-present'] });
    });
    await page.focus('[data-action="present-leave"]');
    const count = await restoredCount(page);
    await page.keyboard.down('Enter');
    assert.equal((await read(page)).presenting, false, 'Enter on Leave did not leave');
    assert.equal((await read(page)).focus, 'present', 'the focus is not on Present after the leave: the case tests nothing');
    // the keyboard's repeats (autoRepeat), on Present now
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    assert.deepEqual(await page.evaluate(() => globalThis.__presents), ['out'], 'Enter held on Leave went out and in again');
    await page.keyboard.up('Enter');
    await outOfMode(page, count);
    // up, and pressed afresh on Present: it presents
    await page.keyboard.press('Enter');
    await inMode(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.mov').present.presenting);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('full screen ended by the browser\'s own Escape: the held key\'s repeats reach nothing on the page until it comes up', async (t) => {
  const session = await openPlanner({ browser, server, hash: '#movement', width: 1280, height: 800 });
  const { page } = session;
  try {
    await settled(page);
    await page.keyboard.press('p');
    await inMode(page);
    if ((await read(page)).how !== 'fullscreen') {
      await page.keyboard.press('Escape');
      t.skip('this browser did not grant full screen, so it cannot end it by its own Escape');
      return;
    }
    await page.evaluate(() => {
      globalThis.__escapes = [];
      // the browser's own Escape: it takes the first press, which the page never sees, and ends full screen
      window.addEventListener('keydown', function browserEscape(event) {
        if (event.key !== 'Escape' || event.repeat) return;
        window.removeEventListener('keydown', browserEscape, true);
        event.stopImmediatePropagation();
        event.preventDefault();
        document.exitFullscreen();
      }, true);
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') globalThis.__escapes.push(event.repeat ? 'repeat' : 'press');
      });
    });
    const count = await restoredCount(page);
    await page.keyboard.down('Escape');
    await page.waitForFunction(() => !document.querySelector('.mov').present.presenting && document.fullscreenElement === null, { timeout: 10000 });
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    assert.deepEqual(await page.evaluate(() => globalThis.__escapes), [], 'the held Escape\'s repeats reached the page after the browser ended full screen');
    await page.keyboard.up('Escape');
    await outOfMode(page, count);
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => globalThis.__escapes), ['press'], 'an Escape pressed afresh after the leave is still kept from the page');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});
