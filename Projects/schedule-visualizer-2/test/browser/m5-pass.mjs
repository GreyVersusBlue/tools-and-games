// M5 after the walk-through of it, in a real browser (spec 9, 10, 18;
// DESIGN 5.4 and 5.5): node test/browser/m5-pass.mjs
//
// The spec 18 journeys "run a scenario and apply it" and "print door
// cards", and Fix… to Try it to Apply, each driven by the keyboard alone at
// 1280 by 800 and by a finger alone at 390 by 844. A journey counts the
// pointer and key events the page received and fails on any of the other
// kind: a keyboard journey that clicked once, or a touch journey that
// pressed a key or moved a mouse, is not the journey it says it is; nor is
// one that turned a wheel, or had a script click, type into a field or move
// the focus for it (an untrusted click, input, change or focus event).
// What stands in for a person still, and why:
// - a native select is chosen with page.select() after the finger's tap on
//   it, as the phone's own picker would (a headless browser draws none); its
//   input and change, one pair a select, are the only untrusted events
//   allowed, counted by tapSelect;
// - tap() brings what it taps into view with scrollIntoView() before the
//   finger comes down: a finger reaches it by a swipe of the scroller it is
//   in (every one of them scrolls by touch, nothing is under a fixed layer
//   once in view, and the wait after it asserts nothing lies over the
//   control), and a swipe's length depends on the device's own scrolling;
// - the touch Safety journey's map is brought into view the same way.
// Fixtures are put in through the store's actions before a journey starts;
// nothing a journey checks is done that way.
//
// Also, from batch 17 and SV2-72e: at 844 by 390 with touch Movement and the
// lab put every floor on the stage at Fit and none under the sticky foot,
// and the layout settles (the fit and the legend's dock counted); the shell's
// own Show, on the message an Undo leaves, opens a group's address marked as
// having the list under it, so a Delete on a phone leaves the list once.
// From SV2-72h: Fit settles at 900 by 500 with touch, keeps the first line
// where the floors fit with it, falls back to the whole stage at 1100 by
// 450, holds still under a browser bar's 56 px, and from the section's top
// with the zoom buttons lifted gives the fit the section opened with.
// From SV2-72i: the turns counted take in the layout and the zoom; an
// on-screen keyboard over the lab's scenario name moves nothing, whether the
// scroll is armed from opening or the reader had scrolled; and the scroll is
// armed again by height changes that pass REARM_HEIGHT together, by a change
// of width alone, and cleared on a small change while still armed.
// From SV2-72j: in the lab at 1280 by 300 the scroll held while the scenario
// name has the focus is made when a click on the map takes the focus, and by
// Fit with the focus left in the field; a readonly field holds nothing.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, launch, startServer, waitForSection } from './harness.mjs';

const DAY_A = 'dsample00a';
const C6 = 'gsample06c';
const CLASH = 'room-double:' + DAY_A + ':2:rsample103';
const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };
const SIDE = { width: 844, height: 390, mobile: true };
const CLEAN = { errors: [], blocked: [], shimmed: [] };

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- helpers

// A page of its own for a case, closed after, and what the page itself said
// went wrong asserted empty.
async function on(hash, size, run) {
  const session = await openPlanner({ server, browser, hash, theme: 'light', ...size });
  let failed = null;
  try {
    await run(session.page, session);
  } catch (error) {
    failed = error;
  }
  const found = session.problems();
  await session.page.close().catch(() => {});
  if (failed) {
    const said = found.errors.concat(found.blocked, found.shimmed);
    if (said.length > 0 && failed instanceof Error) failed.message += '\n(and the page said: ' + said.join(' | ') + ')';
    throw failed;
  }
  assert.deepEqual(found, CLEAN);
}

// A wait for a state the page sets that an assertion depends on: when the
// state never comes, the case fails saying `why`.
async function until(page, why, fn, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: 15000 }, ...args);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    assert.fail(why + ' (waited 15 s for: ' + String(fn).replace(/\s+/g, ' ').slice(0, 160) + ')');
  }
}

// A module of the tool put on the page as globalThis.sv2modules[key] by a
// module script the page loads itself, and waited for by its key; a failed
// load is kept as `{ error }` and said (SV2-72e2). An import() awaited inside
// page.evaluate came back "Promise was collected" (SV2-72e). A load of the
// page empties the globals; the module is loaded again.
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
  if (state.error !== null) {
    await page.evaluate((wanted) => delete globalThis.sv2modules[wanted], key);
    throw new Error('loadModule: ' + file + ' did not load: ' + state.error);
  }
}

// A fixture: the sample school, `alter` (a function body over `project`)
// applied to it, put in with the store's replace; then each action given.
async function fixture(page, alter, actions) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'sample', 'data/sample-school.js');
  await page.evaluate((body, steps) => {
    const { actions } = globalThis.sv2modules;
    const project = globalThis.sv2modules.sample.sampleSchool();
    project.onboarding.dismissed = true;
    if (body) new Function('project', body)(project);
    globalThis.sv2.store.replace(project);
    for (const [name, payload] of steps || []) globalThis.sv2.store.apply(actions[name], payload);
  }, alter || null, actions || []);
}

// Every pointer, key and wheel event the page gets from here on, counted by
// kind, and every click, input, change and focus a script made (untrusted)
// rather than a person; a journey reads it at its end (journeyWas).
async function countInput(page) {
  page.__m5selects = 0;
  await page.evaluate(() => {
    const seen = { keys: 0, touch: 0, mouse: 0, pen: 0, wheel: 0, scripted: { click: 0, input: 0, change: 0, focus: 0 } };
    globalThis.__m5input = seen;
    window.addEventListener('keydown', () => {
      seen.keys += 1;
    }, true);
    window.addEventListener('pointerdown', (event) => {
      seen[event.pointerType] = (seen[event.pointerType] || 0) + 1;
    }, true);
    window.addEventListener('mousemove', (event) => {
      // a mouse moved over the page with no pointer down; a touch's own compatibility events come with a touch pointer
      if (!event.sourceCapabilities || !event.sourceCapabilities.firesTouchEvents) seen.mousemoved = (seen.mousemoved || 0) + 1;
    }, true);
    window.addEventListener('wheel', () => {
      seen.wheel += 1;
    }, { capture: true, passive: true });
    for (const type of ['click', 'input', 'change', 'focus']) {
      window.addEventListener(type, (event) => {
        if (!event.isTrusted) seen.scripted[type] += 1;
      }, true);
    }
  });
}
async function journeyWas(page, kind) {
  const seen = await page.evaluate(() => globalThis.__m5input);
  // page.select's own pair, an input and a change on the select, once for each tapSelect
  const selects = page.__m5selects || 0;
  assert.deepEqual(seen.scripted, { click: 0, input: selects, change: selects, focus: 0 }, 'the ' + kind + ' journey had a script click, type or focus for it (' + selects + ' page.select pairs allowed): ' + JSON.stringify(seen));
  assert.equal(seen.wheel, 0, 'the ' + kind + ' journey turned a wheel: ' + JSON.stringify(seen));
  if (kind === 'keyboard') {
    assert.equal(seen.mouse + seen.touch + seen.pen + (seen.mousemoved || 0), 0, 'the keyboard journey used a pointer: ' + JSON.stringify(seen));
    assert.ok(seen.keys > 0, 'no key was pressed: ' + JSON.stringify(seen));
  } else {
    assert.equal(seen.keys + seen.mouse + seen.pen + (seen.mousemoved || 0), 0, 'the touch journey used a key or a mouse: ' + JSON.stringify(seen));
    assert.ok(seen.touch > 0, 'no finger touched the page: ' + JSON.stringify(seen));
  }
}

// What the focus is on, as a selector would find it.
const focusIs = (page, selector) => page.evaluate((wanted) => {
  const el = document.activeElement;
  return Boolean(el) && el !== document.body && el.matches(wanted);
}, selector);

// Tab (or Shift+Tab) until the focus is on what `selector` finds, at most
// `most` presses: the control is reached by the keyboard, in the page's
// own order.
async function tabTo(page, selector, options) {
  const { back = false, most = 80 } = options || {};
  for (let press = 0; press <= most; press += 1) {
    if (await focusIs(page, selector)) return press;
    if (back) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
    } else {
      await page.keyboard.press('Tab');
    }
  }
  const at = await page.evaluate(() => document.activeElement && (document.activeElement.outerHTML || '').slice(0, 160));
  throw new Error(most + ' presses of ' + (back ? 'Shift+Tab' : 'Tab') + ' did not reach ' + selector + '; the focus is on ' + at);
}

// A section's digit, pressed with nothing in a field: Tab moves the focus out
// of one first, as a person would (a digit typed in a field is the field's).
async function sectionKey(page, digit, id) {
  for (let press = 0; press < 20; press += 1) {
    const typing = await page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el) && (el.isContentEditable || el.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"], [data-editing]') !== null);
    });
    if (!typing) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press(String(digit));
  await waitForSection(page, id);
}

// The box of what a selector finds, or null when it has none.
const box = (page, selector) => page.evaluate((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}, selector);

// A finger's tap on the middle of what a selector finds, brought into the
// middle of its scroller first and waited for until nothing lies over it.
async function tap(page, selector) {
  await until(page, selector + ' has no box', (wanted) => {
    const el = document.querySelector(wanted);
    return Boolean(el) && el.getClientRects().length > 0;
  }, selector);
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await until(page, 'something lies over ' + selector, (wanted) => {
    const el = document.querySelector(wanted);
    if (!el || el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && (el === hit || el.contains(hit) || (el.labels && Array.from(el.labels).some((label) => label.contains(hit))));
  }, selector);
  const at = await box(page, selector);
  await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
}

// A native select chosen by a finger: the tap on it, then the value, as the
// phone's own picker would set it.
async function tapSelect(page, selector, value) {
  await tap(page, selector);
  await page.select(selector, value);
  page.__m5selects = (page.__m5selects || 0) + 1;
}

const slotRoom = (page, groupId, dayTypeId, period) => page.evaluate((g, d, p) => globalThis.sv2.store.project.groups.find((each) => each.id === g).days[d][p].room, groupId, dayTypeId, period);
const scenarioOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));

// The lab drawn for the store's project and its comparison settled
// (answered for the store as it is, or nothing open).
async function labReady(page) {
  await until(page, 'the lab did not settle', () => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  });
}

// Safety drawn for the store's project, its picture worked out and painted.
async function safetyReady(page) {
  await until(page, 'Safety did not settle', () => {
    const el = document.querySelector('.sfy');
    if (!el || el.dataset.styled !== 'true' || !el.safety || !el.safety.picture) return false;
    if (el.safety.plan.project !== globalThis.sv2.store.project) return false;
    const canvas = document.getElementById('safety-plan');
    return canvas.getClientRects().length > 0 && el.safety.plan.view.width > 0 && Number(canvas.dataset.drawn || 0) > 0;
  });
}

// The print preview's document once it is laid out: the cards in print
// order, the paper, the number of sheets.
async function preview(page) {
  await until(page, 'the print preview did not lay its document out', () => Boolean(document.querySelector('#print-preview[open][data-ready="true"]')));
  return page.evaluate(() => {
    const sheet = document.getElementById('print-preview');
    const doc = sheet.querySelector('iframe').contentDocument;
    const cards = [];
    for (const card of doc.querySelectorAll('.card[data-card]')) if (!cards.includes(card.dataset.card)) cards.push(card.dataset.card);
    return {
      output: doc.documentElement.dataset.output,
      paper: doc.documentElement.dataset.paper + ' ' + doc.documentElement.dataset.orientation,
      cards,
      cover: Array.from(doc.querySelectorAll('.card-cover__list li')).map((li) => li.dataset.room),
      names: Array.from(doc.querySelectorAll('.card__name')).map((el) => el.textContent),
      text: doc.body.textContent,
    };
  });
}

// The engine's findings for the store as it is now, by id.
const findingIds = (page) => page.evaluate(async () => {
  const answer = await globalThis.sv2.store.derived.results();
  return answer.findings.findings.map((finding) => finding.id);
});

// ------------------------------------------- batch 17: Fit at 844 by 390

// Where every floor lies on a mounted plan map now, against its stage and
// the sticky foot over it, in the page's pixels; and what the fit chose.
const floorsAt = (page, which) => page.evaluate((name) => {
  const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
  const stage = plan.stage.getBoundingClientRect();
  const foot = (name === 'movement' ? document.querySelector('[data-bar="playback"]') : document.querySelector('.scn-bar'));
  const footTop = foot && foot.getClientRects().length > 0 ? foot.getBoundingClientRect().top : Infinity;
  const size = 24 * plan.view.zoom;
  // a floor's box with its name row (two cells over it)
  const floors = plan.world.slots.map((slot) => ({
    name: slot.floor.name,
    left: stage.left + plan.view.x + slot.x * size,
    right: stage.left + plan.view.x + (slot.x + slot.w) * size,
    top: stage.top + plan.view.y + (slot.y - 2) * size,
    bottom: stage.top + plan.view.y + (slot.y + slot.h) * size,
  }));
  return { stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom }, footTop, fit: plan.stage.dataset.fit, zoom: plan.view.zoom, floors, scroll: plan.root.scrollTop };
}, which);

function offStage(at) {
  const off = [];
  for (const floor of at.floors) {
    if (floor.left < at.stage.left - 0.5 || floor.right > at.stage.right + 0.5 || floor.top < at.stage.top - 0.5 || floor.bottom > at.stage.bottom + 0.5) off.push(floor.name + ' off the stage');
    if (floor.bottom > at.footTop + 0.5) off.push(floor.name + ' under the foot by ' + (floor.bottom - at.footTop).toFixed(1) + ' px');
  }
  return off;
}

// The map laid out and painted, and measured where the section is scrolled
// now (data-docked-at: dock() ran since the last scroll).
async function mapSettled(page, which) {
  await until(page, which + '\'s map did not lay itself out', (name) => {
    const plan = name === 'movement' ? document.querySelector('.mov')?.movement?.plan : document.querySelector('.scn')?.scenarios?.plan;
    if (!plan || plan.root.dataset.styled !== 'true' || !plan.world || !plan.stage.dataset.fit) return false;
    return Number(plan.canvas.dataset.drawn || 0) > 0 && plan.root.dataset.dockedAt === String(Math.round(plan.root.scrollTop));
  }, which);
}

// Counted from here, before the section is opened: each change of a plan
// stage's fit (data-fit), its layout of the floors (data-layout, side by
// side or stacked) and the zoom Fit took (data-zoom), and of Movement's
// legend dock (data-docked; SV2-72i: a side by side and stacked flip, or a
// zoom set again and again, changed neither of the first two), on
// whatever element carries them, so the first layout's turns count too
// (SV2-72f2: counted after go() a layout that turned while the section
// opened was not seen). A fit or a dock that judges the layout it made can
// make two layouts choose each other (SV2-72c3).
const countTurns = (page) => page.evaluate(() => {
  if (globalThis.__m5turnsWatch) globalThis.__m5turnsWatch.disconnect();
  const turns = { fit: 0, dock: 0, layout: 0, zoom: 0 };
  const keyOf = { 'data-fit': 'fit', 'data-docked': 'dock', 'data-layout': 'layout', 'data-zoom': 'zoom' };
  globalThis.__m5turns = turns;
  // a record holds the value before; the value a set left is the next
  // record's for the same element, or the attribute as it is now for the
  // last. A set to the value already there (the legend draws its dock each
  // time) is no turn.
  globalThis.__m5turnsWatch = new MutationObserver((records) => {
    records.forEach((record, at) => {
      const next = records.slice(at + 1).find((later) => later.target === record.target && later.attributeName === record.attributeName);
      const value = next ? next.oldValue : record.target.getAttribute(record.attributeName);
      if (record.oldValue !== value) turns[keyOf[record.attributeName]] += 1;
    });
  });
  globalThis.__m5turnsWatch.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-fit', 'data-docked', 'data-layout', 'data-zoom'], attributeOldValue: true });
});

// The map settled (mapSettled), and then the turns counted, the stage's fit
// and the legend's dock unchanged over two animation frames running: a
// layout still turning is not asserted on (SV2-72f2). The wait is on the
// page's state, a frame at a time.
async function turnsSettled(page, which) {
  await mapSettled(page, which);
  await page.evaluate(() => {
    globalThis.__m5settle = null;
  });
  await until(page, which + '\'s fit or the legend\'s dock is still turning', (name) => {
    const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
    const legend = document.querySelector('.mov-legend');
    const now = JSON.stringify([globalThis.__m5turns, plan.stage.dataset.fit, plan.stage.dataset.layout, plan.stage.dataset.zoom, legend ? legend.dataset.docked : null]);
    const was = globalThis.__m5settle;
    if (!was || was.now !== now) {
      globalThis.__m5settle = { now, frames: 0 };
      return false;
    }
    was.frames += 1;
    return was.frames >= 2;
  }, which);
  return page.evaluate(() => ({ ...globalThis.__m5turns }));
}

for (const which of ['movement', 'scenarios']) {
  test('batch 17: at 844 by 390 with touch ' + (which === 'movement' ? 'Movement' : 'the lab, a scenario open,') + ' puts every floor on the stage at Fit and none under the sticky foot, as it opens and when Fit is tapped, and the layout settles', async () => {
    await on('#project', SIDE, async (page) => {
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is not a touch screen’s');
      await fixture(page, null, which === 'scenarios' ? [['newScenario', { name: 'Trial' }]] : []);
      await countTurns(page);
      await go(page, '#' + which);
      const first = await turnsSettled(page, which);
      const opened = await floorsAt(page, which);
      assert.ok(opened.zoom < 0.3, 'the floors are not near the least zoom: the case tests nothing: ' + JSON.stringify(opened));
      assert.deepEqual(offStage(opened), [], 'as it opens: ' + JSON.stringify(opened));
      await tap(page, '#section [data-action="fit"]');
      const turns = await turnsSettled(page, which);
      const fitted = await floorsAt(page, which);
      assert.deepEqual(offStage(fitted), [], 'after Fit: ' + JSON.stringify(fitted));
      // the stage's fit set once as the map is laid out, and once more at most as the section settles; the legend docked once
      assert.ok(first.fit >= 1, 'no fit was counted: the count tests nothing: ' + JSON.stringify(first));
      assert.ok(turns.fit <= 2 && turns.dock <= 1 && turns.layout <= 1 && turns.zoom <= 2, 'the layout did not settle: ' + JSON.stringify({ first, turns }));
    });
  });
}

// SV2-72f2 item 1: Fit is meant to bring the stage clear of the foot again
// after the reader scrolled, but the scroll the map had last made still
// differed from the section's, so the map took Fit's own scroll for the
// reader's and left the section where it was. Fit is pressed by its key and
// by a finger, the finger on the button where it is (no scrollIntoView
// stand-in to move the section first).
test('SV2-72f2 item 1: at 844 by 390 with touch, Movement scrolled back to its top by the reader, Fit by its key and by a tap brings the stage clear of the sticky foot again', async () => {
  await on('#project', SIDE, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await mapSettled(page, 'movement');
    // where the map's own scroll left the section as it opened (the Tab to
    // the map may scroll it further, to the canvas)
    const clear = await floorsAt(page, 'movement');
    await tabTo(page, '#movement-plan');
    await mapSettled(page, 'movement');
    assert.ok(clear.scroll > 0, 'the map did not scroll the section clear of the foot as it opened: the case tests nothing: ' + JSON.stringify(clear));
    for (const way of ['key', 'tap']) {
      // the reader's scroll back to the section's top (the stand-in for a swipe)
      await page.evaluate(() => {
        document.querySelector('.mov').movement.plan.root.scrollTop = 0;
      });
      await until(page, 'the section did not take the scroll to its top', () => {
        const plan = document.querySelector('.mov').movement.plan;
        return plan.root.scrollTop === 0 && plan.root.dataset.dockedAt === '0';
      });
      const scrolled = await floorsAt(page, 'movement');
      assert.ok(scrolled.stage.bottom > scrolled.footTop + 0.5, 'scrolled to the top, the foot is not over the stage: the case tests nothing: ' + JSON.stringify(scrolled));
      if (way === 'key') {
        assert.equal(await focusIs(page, '#movement-plan'), true, 'the focus left the map');
        await page.keyboard.press('0');
      } else {
        const fitButton = '.mov [data-action="fit"]';
        const at = await box(page, fitButton);
        assert.ok(at, 'the Fit button has no box');
        const hit = await page.evaluate((wanted, x, y) => {
          const hitEl = document.elementFromPoint(x, y);
          return Boolean(hitEl) && document.querySelector(wanted).contains(hitEl);
        }, fitButton, at.left + at.width / 2, at.top + at.height / 2);
        assert.equal(hit, true, 'something lies over the Fit button where it is: ' + JSON.stringify(at));
        await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
      }
      await turnsSettled(page, 'movement');
      const fitted = await floorsAt(page, 'movement');
      assert.equal(fitted.scroll, clear.scroll, 'Fit by ' + way + ' did not scroll the section clear of the foot again: ' + JSON.stringify({ clear, scrolled, fitted }));
      assert.deepEqual(offStage(fitted), [], 'after Fit by ' + way + ': ' + JSON.stringify(fitted));
    }
  });
});

// SV2-72f2 item 3: a rotation that clamps the section's scroll is not the
// reader's scroll. On a phone turned on its side, back, and on its side again
// the map had taken the clamp to 0 for the reader's and never cleared the
// foot again: 24 px of it over the stage and the floors put beside the zoom
// buttons.
test('SV2-72f2 item 3: a phone at 390 by 844 turned on its side, back, and on its side again: Movement\'s stage clears the sticky foot each time it is on its side', async () => {
  await on('#project', PHONE, async (page) => {
    await fixture(page);
    await countTurns(page);
    await go(page, '#movement');
    await turnsSettled(page, 'movement');
    const turn = (size) => page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: true, isMobile: true, isLandscape: size.width > size.height });
    const sides = [];
    for (const size of [SIDE, PHONE, SIDE]) {
      await turn(size);
      await until(page, 'the page is not ' + size.width + ' wide', (w) => window.innerWidth === w, size.width);
      await turnsSettled(page, 'movement');
      if (size === SIDE) sides.push(await floorsAt(page, 'movement'));
    }
    assert.ok(sides[0].scroll > 0, 'on its side the first time the map did not scroll the section: the case tests nothing: ' + JSON.stringify(sides[0]));
    assert.equal(sides[1].scroll, sides[0].scroll, 'on its side again the section was not scrolled as the first time: ' + JSON.stringify(sides));
    assert.ok(sides[1].stage.bottom - sides[1].footTop <= sides[0].stage.bottom - sides[0].footTop + 0.5, 'on its side again the foot lies further over the stage: ' + JSON.stringify(sides));
    assert.deepEqual(offStage(sides[1]), [], 'on its side again: ' + JSON.stringify(sides[1]));
  });
});

// SV2-72f2 item 2: Movement's legend asked fitAt where Fit puts the floors,
// and fitAt asked fitClear on the whole stage, while Fit fits above the
// sticky foot where the floors are whole there and falls back to the whole
// stage only where they are not: the legend judged one layout and the map
// showed another (at 1280 by 600 the floors 19 px apart). Both ask choose().
// SV2-72g: 900 by 500 was where the floors could not be whole above the
// foot; the section now scrolls past the first line there, and they are.
// SV2-72h item 5: 1100 by 450 with a mouse is a size where they still
// cannot (the section scrolled to the stage's top, the stage 207 px with
// the playback bar over its foot), so fitIn 'stage' keeps a browser case.
for (const size of [{ width: 900, height: 500, fallback: false }, { width: 1280, height: 600, fallback: false }, { width: 1100, height: 450, fallback: true }]) {
  test('SV2-72f2 item 2: Movement at ' + size.width + ' by ' + size.height + (size.fallback ? ', where the floors cannot be whole above the foot,' : '') + ' fitAt answers the fit the map took, the legend\'s card lies on no floor, and the layout settles', async () => {
    await on('#project', { width: size.width, height: size.height }, async (page) => {
      await fixture(page);
      await countTurns(page);
      await go(page, '#movement');
      const turns = await turnsSettled(page, 'movement');
      const got = await page.evaluate(() => {
        const plan = document.querySelector('.mov').movement.plan;
        const at = plan.fitAt(plan.view.width, plan.view.height);
        const card = document.querySelector('.mov-legend');
        const c = card.getBoundingClientRect();
        const st = plan.stage.getBoundingClientRect();
        const size = 24 * plan.view.zoom;
        const floors = plan.world.slots.map((slot) => ({ left: st.left + plan.view.x + slot.x * size, right: st.left + plan.view.x + (slot.x + slot.w) * size, top: st.top + plan.view.y + slot.y * size, bottom: st.top + plan.view.y + (slot.y + slot.h) * size }));
        return {
          fitIn: plan.stage.dataset.fitIn,
          view: { zoom: plan.view.zoom, x: plan.view.x, y: plan.view.y },
          at: at && { zoom: at.zoom, x: at.x, y: at.y, in: at.in },
          docked: card.dataset.docked,
          onFloor: card.dataset.docked !== 'true' && floors.some((f) => f.left < c.right && c.left < f.right && f.top < c.bottom && c.top < f.bottom),
          fitted: plan.fitted,
        };
      });
      assert.equal(got.fitted, true, 'the map is not fitted: ' + JSON.stringify(got));
      if (size.fallback) assert.equal(got.fitIn, 'stage', 'the floors were fitted above the foot: the case tests nothing: ' + JSON.stringify(got));
      assert.ok(got.at, 'fitAt answered nothing');
      for (const key of ['zoom', 'x', 'y']) assert.ok(Math.abs(got.at[key] - got.view[key]) < 1e-6, 'fitAt\'s ' + key + ' is not the fit the map took: ' + JSON.stringify(got));
      assert.equal(got.onFloor, false, 'the legend\'s card lies on a floor: ' + JSON.stringify(got));
      assert.ok(turns.fit >= 1 && turns.fit <= 2 && turns.dock <= 1 && turns.layout <= 1 && turns.zoom <= 2, 'the layout did not settle: ' + JSON.stringify(turns));
    });
  });
}

// ------------------------------------------- SV2-72g: Fit at the narrow and short edges

// Two edges SV2-72f2 saw and left. At 1024 wide Movement's stage is 648 px
// and the floors side by side are 744 at the least zoom, 25 %, so Fit put
// them 48 px off the stage's left edge: the layout was chosen by the zoom
// each arrangement fits at, clamped, and both clamp to 25 % there, a tie
// that went to side by side while stacked, 240 by 282, fits. And from 900 px
// wide Movement's controls are open, 224 px of them under the first line:
// the map scrolled the section never past the first line's own box, so at
// 900 by 500 the sticky foot lay 171 px over a 216 px stage, the floors
// under it. Each case presses Fit where the button is and counts the fit's
// and the legend's turns from before the section opens. 900 by 500 with
// touch is here too, its edge asserted, and SV2-72h item 1's count below.
const EDGES = [
  { width: 1024, height: 768 },
  { width: 1024, height: 768, mobile: true },
  { width: 1024, height: 600 },
  { width: 1024, height: 600, mobile: true },
  { width: 900, height: 500 },
  // kept here with its edge asserted as every size's is, beside SV2-72h item 1's own count (SV2-72i)
  { width: 900, height: 500, mobile: true },
];

// What would have gone wrong here before: the floors side by side at the
// least zoom wider than the stage, or the foot, with the section at its top,
// over more of the stage than a scroll that keeps the first line can clear.
const edgeOf = (page) => page.evaluate(() => {
  const plan = document.querySelector('.mov').movement.plan;
  const slots = plan.world.slots;
  const across = (slots.reduce((sum, slot) => sum + slot.w, 0) + 2 * (slots.length - 1)) * 24 * 0.25;
  const stage = plan.stage.getBoundingClientRect();
  const root = plan.root.getBoundingClientRect();
  const line = document.querySelector('.mov-line').getBoundingClientRect();
  const foot = document.querySelector('[data-bar="playback"]').getBoundingClientRect();
  const scroll = plan.root.scrollTop;
  return { sideTooWide: across > stage.width, footPastLine: stage.bottom + scroll - foot.top > line.top + scroll - root.top, across, stageWidth: stage.width };
});

for (const size of EDGES) {
  test('SV2-72g: Movement at ' + size.width + ' by ' + size.height + (size.mobile ? ' with touch' : ' with a mouse') + ' puts every floor on the stage and none under the sticky foot at Fit, as it opens and when Fit is pressed, and the layout settles', async () => {
    await on('#project', size, async (page) => {
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), Boolean(size.mobile), 'the page\'s pointer is not the case\'s');
      await fixture(page);
      await countTurns(page);
      await go(page, '#movement');
      const first = await turnsSettled(page, 'movement');
      const opened = await floorsAt(page, 'movement');
      const edge = await edgeOf(page);
      assert.ok(edge.sideTooWide || edge.footPastLine, 'neither edge is here: the case tests nothing: ' + JSON.stringify(edge));
      assert.deepEqual(offStage(opened), [], 'as it opens: ' + JSON.stringify({ opened, edge }));
      const fitButton = '.mov [data-action="fit"]';
      const at = await box(page, fitButton);
      assert.ok(at, 'the Fit button has no box');
      const hit = await page.evaluate((wanted, x, y) => {
        const hitEl = document.elementFromPoint(x, y);
        return Boolean(hitEl) && document.querySelector(wanted).contains(hitEl);
      }, fitButton, at.left + at.width / 2, at.top + at.height / 2);
      assert.equal(hit, true, 'something lies over the Fit button where it is: ' + JSON.stringify(at));
      if (size.mobile) await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
      else await page.mouse.click(at.left + at.width / 2, at.top + at.height / 2);
      const turns = await turnsSettled(page, 'movement');
      const fitted = await floorsAt(page, 'movement');
      assert.deepEqual(offStage(fitted), [], 'after Fit: ' + JSON.stringify({ fitted, edge }));
      assert.ok(first.fit >= 1, 'no fit was counted: the count tests nothing: ' + JSON.stringify(first));
      assert.ok(turns.fit <= 2 && turns.dock <= 1 && turns.layout <= 1 && turns.zoom <= 2, 'the layout did not settle: ' + JSON.stringify({ first, turns }));
    });
  });
}

// ------------------------------------------- SV2-72h: Fit settles everywhere

// Item 1. At 900 by 500 with touch Movement opened with 5 dock and 5 fit
// turns (3 and 2 before SV2-72g): the legend judged its card on the stage
// with the docked line away as view.height plus undockedGain(), the one read
// at the last measure and the other at the last room(), so a judgement made
// between the line being shown or hidden and the stage measured again asked
// a stage 241 px or 151 px tall where the stage without the line is 196, and
// each answer turned the other. Counted from before the section opens, and
// again after Fit is tapped where the button is.
// Movement's answer is in and drawn (the legend's card is judged with its
// bands in it: before them it is 70 px, after them 172 at 900 by 500)
const answered = (page) => until(page, 'Movement\'s answer did not come', () => {
  const mov = document.querySelector('.mov');
  return Boolean(mov && mov.movement && mov.dataset.pending !== 'true' && mov.movement.state && mov.movement.state.results && mov.movement.state.project === globalThis.sv2.store.project);
});

test('SV2-72h item 1: Movement at 900 by 500 with touch opens with the fit set at most twice and the legend docked at most once, and settles so again when Fit is tapped', async () => {
  await on('#project', { width: 900, height: 500, mobile: true }, async (page) => {
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is not a touch screen’s');
    await fixture(page);
    await countTurns(page);
    await go(page, '#movement');
    await answered(page);
    const first = await turnsSettled(page, 'movement');
    const opened = await floorsAt(page, 'movement');
    assert.ok(first.fit >= 1, 'no fit was counted: the count tests nothing: ' + JSON.stringify(first));
    assert.ok(first.fit <= 2 && first.dock <= 1 && first.layout <= 1 && first.zoom <= 2, 'the layout did not settle as Movement opened: ' + JSON.stringify(first));
    assert.deepEqual(offStage(opened), [], 'as it opens: ' + JSON.stringify(opened));
    await countTurns(page);
    const fitButton = '.mov [data-action="fit"]';
    const at = await box(page, fitButton);
    assert.ok(at, 'the Fit button has no box');
    const hit = await page.evaluate((wanted, x, y) => {
      const hitEl = document.elementFromPoint(x, y);
      return Boolean(hitEl) && document.querySelector(wanted).contains(hitEl);
    }, fitButton, at.left + at.width / 2, at.top + at.height / 2);
    assert.equal(hit, true, 'something lies over the Fit button where it is: ' + JSON.stringify(at));
    await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
    const turns = await turnsSettled(page, 'movement');
    const fitted = await floorsAt(page, 'movement');
    assert.ok(turns.fit <= 2 && turns.dock <= 1 && turns.layout <= 1 && turns.zoom <= 2, 'the layout did not settle after Fit: ' + JSON.stringify(turns));
    assert.deepEqual(offStage(fitted), [], 'after Fit: ' + JSON.stringify(fitted));
  });
});

// Item 1, the judgement itself: the stage with the docked line away is
// measured now. Between the line shown or hidden and the observers' next
// round, view.height was the last measure's and undockedGain() the last
// room()'s, and their sum, what the legend judged on, was a stage that is
// not there. Read in the same task as the line is shown or hidden, before
// any observer runs.
test('SV2-72h item 1: Movement at 900 by 500 with touch: the stage with the docked line away, asked in the same task as the line is shown or hidden, is the stage the line leaves', async () => {
  await on('#project', { width: 900, height: 500, mobile: true }, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    const line = '.mov-legend-line';
    assert.equal(await page.evaluate((sel) => !document.querySelector(sel).hidden, line), true, 'the legend is not docked here: the case tests nothing');
    // the stage as it is laid out with the line away, once the map has measured it
    const settledWith = async (hidden) => {
      // the height before is forgotten, so the wait sees the stage over two frames from here
      await page.evaluate((sel, value) => {
        globalThis.__m5stage = null;
        document.querySelector(sel).hidden = value;
      }, line, hidden);
      await until(page, 'the stage did not settle with the line ' + (hidden ? 'away' : 'shown'), () => {
        const plan = document.querySelector('.mov').movement.plan;
        const now = plan.stage.getBoundingClientRect().height;
        const was = globalThis.__m5stage;
        globalThis.__m5stage = now;
        return plan.view.height === Math.round(now) && was === now;
      });
      return page.evaluate(() => document.querySelector('.mov').movement.plan.stage.getBoundingClientRect().height);
    };
    const away = await settledWith(true);
    const shown = await settledWith(false);
    assert.ok(away > shown, 'the line takes nothing from the stage here: the case tests nothing: ' + JSON.stringify({ away, shown }));
    const asked = await page.evaluate((sel) => {
      const plan = document.querySelector('.mov').movement.plan;
      const el = document.querySelector(sel);
      const out = {};
      for (const hidden of [true, false]) {
        el.hidden = hidden;
        out[hidden ? 'away' : 'shown'] = { now: plan.undockedHeight(), sum: plan.view.height + (hidden ? 0 : plan.undockedGain()) };
      }
      return out;
    }, line);
    // the sum of the last measures was another stage at least once: the case would have caught it
    assert.ok(Math.abs(asked.away.sum - away) > 1 || Math.abs(asked.shown.sum - away) > 1, 'the last measures already agree here: the case tests nothing: ' + JSON.stringify({ away, asked }));
    for (const way of ['away', 'shown']) assert.ok(Math.abs(asked[way].now - away) <= 1, 'with the line ' + way + ' the stage without it was asked as ' + asked[way].now + ' px, not ' + away + ': ' + JSON.stringify({ away, shown, asked }));
  });
});

// Item 4. A change of the window's height alone, a touch browser's bar
// coming or going (56 px in Chrome on Android) or the keyboard, was taken
// for a new layout like a rotation: the foot-clearing scroll was armed again
// and moved the section under a reader who had scrolled it. Only a change of
// width, or of height by more than REARM_HEIGHT, arms it again.
test('SV2-72h item 4: at 844 by 390 with touch, Movement scrolled to its top by the reader stays there when the browser\'s bar takes 56 px of the window\'s height, and is scrolled clear of the foot again after a change of 130 px', async () => {
  await on('#project', SIDE, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    const opened = await floorsAt(page, 'movement');
    assert.ok(opened.scroll > 0, 'the map did not scroll the section clear of the foot as it opened: the case tests nothing: ' + JSON.stringify(opened));
    // the reader's scroll back to the section's top (the stand-in for a swipe)
    await page.evaluate(() => {
      document.querySelector('.mov').movement.plan.root.scrollTop = 0;
    });
    await until(page, 'the section did not take the scroll to its top', () => {
      const plan = document.querySelector('.mov').movement.plan;
      return plan.root.scrollTop === 0 && plan.root.dataset.dockedAt === '0';
    });
    // the wait is for the map measured in the new window, not the window alone (resizeTo, SV2-72i)
    const resize = (height) => resizeTo(page, 'movement', { width: SIDE.width, height });
    const barGone = await resize(SIDE.height - 56);
    assert.equal(barGone.scroll, 0, 'the bar\'s 56 px moved the section under the reader: ' + JSON.stringify(barGone));
    // at the top the foot lies over the stage: what a foot-clearing scroll would have moved
    assert.ok(barGone.stage.bottom > barGone.footTop + 0.5, 'with the bar\'s 56 px gone the foot is not over the stage at the section\'s top: the case tests nothing: ' + JSON.stringify(barGone));
    const barBack = await resize(SIDE.height);
    assert.equal(barBack.scroll, 0, 'the bar coming back moved the section under the reader: ' + JSON.stringify(barBack));
    // a change of 130 px is a new layout: 130 px taller, where the foot is
    // clear of the stage, and back, where the stage is brought clear of the
    // foot again
    const taller = await resize(SIDE.height + 130);
    assert.ok(taller.stage.bottom <= taller.footTop + 0.5, '130 px taller the foot still lies over the stage: ' + JSON.stringify(taller));
    const back = await resize(SIDE.height);
    assert.ok(back.scroll > 0, 'a window 130 px lower was not scrolled clear of the foot: ' + JSON.stringify({ taller, back }));
    assert.equal(back.scroll, opened.scroll, 'a window 130 px lower was not scrolled as Movement opened at that size: ' + JSON.stringify({ opened, back }));
    assert.deepEqual(offStage(back), [], 'a window 130 px lower: ' + JSON.stringify(back));
  });
});

// Item 2. Where the floors are whole above the sticky foot with the first
// line kept, the map's own scroll stops at the line (SV2-72g's rule); no case
// held that half. At 844 by 390 with touch both Movement and the lab scroll
// the section, by less than the line's top.
for (const which of ['movement', 'scenarios']) {
  test('SV2-72h item 2: at 844 by 390 with touch ' + (which === 'movement' ? 'Movement' : 'the lab, a scenario open,') + ' scrolls clear of the foot and keeps its first line in view, every floor above the foot', async () => {
    await on('#project', SIDE, async (page) => {
      await fixture(page, null, which === 'scenarios' ? [['newScenario', { name: 'Trial' }]] : []);
      await go(page, '#' + which);
      if (which === 'movement') await answered(page);
      await turnsSettled(page, which);
      const at = await floorsAt(page, which);
      const line = await page.evaluate((name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        const el = plan.root.querySelector('.mov-line');
        if (!el || el.getClientRects().length === 0) return null;
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, rootTop: plan.root.getBoundingClientRect().top };
      }, which);
      assert.ok(line, 'the first line has no box');
      assert.ok(at.scroll > 0, 'the map did not scroll the section: the case tests nothing: ' + JSON.stringify(at));
      assert.ok(line.top >= line.rootTop - 0.5, 'the map scrolled past the first line where the floors fit with it: ' + JSON.stringify({ line, at }));
      assert.deepEqual(offStage(at), [], JSON.stringify(at));
    });
  });
}

// Item 6. Fit pressed with the zoom buttons lifted over the sticky foot, the
// section at its top where the reader scrolled it: Fit scrolls the section
// clear of the foot again, keeps the first line where the floors fit with
// it, and fits round the buttons where they rest after that scroll, which
// is the fit the section opened with. What the stage says of the zoom box
// (data-fit-clear) is checked against the painted cells under the box as
// drawn, with the module's own paintedUnder. At this size the lab keeps
// its first line with the foot 15 px over the stage's foot, so its buttons
// stay lifted and lie over part of a floor.
for (const which of ['movement', 'scenarios']) {
  test('SV2-72h item 6: at 844 by 390 with touch, ' + (which === 'movement' ? 'Movement' : 'the lab, a scenario open,') + ' at its top with the zoom buttons lifted over the foot, Fit tapped gives the fit it opened with: the first line in view, every floor above the foot, the zoom box as clear as the stage says', async () => {
    await on('#project', SIDE, async (page) => {
      await fixture(page, null, which === 'scenarios' ? [['newScenario', { name: 'Trial' }]] : []);
      await loadModule(page, 'layout', 'ui/surface/plan-layout.js');
      await go(page, '#' + which);
      if (which === 'movement') await answered(page);
      await turnsSettled(page, which);
      const opened = await floorsAt(page, which);
      const viewOf = () => page.evaluate((name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        return { zoom: plan.view.zoom, x: plan.view.x, y: plan.view.y, fit: plan.stage.dataset.fit, clear: plan.stage.dataset.fitClear };
      }, which);
      const openedView = await viewOf();
      // the reader's scroll back to the section's top (the stand-in for a swipe)
      await page.evaluate((name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        plan.root.scrollTop = 0;
      }, which);
      await until(page, 'the section did not take the scroll to its top', (name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        return plan.root.scrollTop === 0 && plan.root.dataset.dockedAt === '0';
      }, which);
      const lifted = await page.evaluate((name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        return parseFloat(plan.stage.style.getPropertyValue('--mov-under')) || 0;
      }, which);
      assert.ok(lifted > 0, 'at the top the zoom buttons are not lifted over the foot: the case tests nothing');
      const fitButton = '#section [data-action="fit"]';
      const at = await box(page, fitButton);
      assert.ok(at, 'the Fit button has no box');
      await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
      await until(page, 'Fit did not scroll the section', (name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        return plan.root.scrollTop > 0;
      }, which);
      await turnsSettled(page, which);
      const fitted = await floorsAt(page, which);
      const fittedView = await viewOf();
      const got = await page.evaluate((name) => {
        const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
        const el = plan.root.querySelector('.mov-line');
        const line = el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
        const stage = plan.stage.getBoundingClientRect();
        const zoom = plan.stage.querySelector('.mov-zoom').getBoundingClientRect();
        const rect = { x: zoom.left - stage.left, y: zoom.top - stage.top, w: zoom.width, h: zoom.height };
        const under = globalThis.sv2modules.layout.paintedUnder(plan.world, { zoom: plan.view.zoom, x: plan.view.x, y: plan.view.y }, rect);
        return { line: line && { top: line.top }, rootTop: plan.root.getBoundingClientRect().top, clearSaid: plan.stage.dataset.fitClear, under, rect, fitted: plan.fitted };
      }, which);
      assert.equal(got.fitted, true, 'the map is not fitted');
      assert.equal(fitted.scroll, opened.scroll, 'Fit did not scroll the section as it opened: ' + JSON.stringify({ opened: opened.scroll, fitted: fitted.scroll }));
      assert.ok(got.line && got.line.top >= got.rootTop - 0.5, 'Fit scrolled past the first line: ' + JSON.stringify(got));
      assert.deepEqual(offStage(fitted), [], 'after Fit: ' + JSON.stringify(fitted));
      assert.equal(got.under, got.clearSaid !== 'true', 'the stage says the zoom box is ' + (got.clearSaid === 'true' ? '' : 'not ') + 'clear, and the cells under it as drawn say otherwise: ' + JSON.stringify(got));
      // and the fit is the one the section opened with at that scroll, not one made round the buttons where they were lifted at the top
      assert.deepEqual(fittedView, openedView, 'Fit from the top is not the fit the section opened with: ' + JSON.stringify({ openedView, fittedView }));
    });
  });
}

// ------------------------------------------- SV2-72i: the keyboard, and when the scroll is armed again

// The window set to `size` (touch), and the map measured in it: the window
// compared (data-window, set on every resize of the window, rearm), the
// stage measured at the size it is laid out at, the dock taken where the
// section is scrolled, and the turns settled. A wait on the window alone
// came back before the stage was measured at the new size (SV2-72h's review).
async function resizeTo(page, which, size) {
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, hasTouch: true, isMobile: true, isLandscape: size.width > size.height });
  await until(page, 'the map was not measured in a window ' + size.width + ' by ' + size.height, (name, w, h) => {
    const plan = (name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan);
    if (window.innerWidth !== w || window.innerHeight !== h || plan.root.dataset.window !== w + 'x' + h) return false;
    const stage = plan.stage.getBoundingClientRect();
    return plan.view.width === Math.round(stage.width) && plan.view.height === Math.round(stage.height) && plan.root.dataset.dockedAt === String(Math.round(plan.root.scrollTop));
  }, which, size.width, size.height);
  await turnsSettled(page, which);
  return floorsAt(page, which);
}

// The reader's scroll to `top` (the stand-in for a swipe), by way of
// another place first so the map sees a scroll it did not make even where
// the section is at `top` already.
async function readerScrolls(page, which, top) {
  for (const to of [top + 10, top]) {
    await page.evaluate((name, value) => {
      (name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan).root.scrollTop = value;
    }, which, to);
    await until(page, 'the section did not take the scroll to ' + to, (name, value) => {
      const plan = (name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan);
      return Math.round(plan.root.scrollTop) === value && plan.root.dataset.dockedAt === String(value);
    }, which, to);
  }
}

// The lab's scenario name field, the section and its stage, and the foot.
const nameAt = (page) => page.evaluate(() => {
  const plan = document.querySelector('.scn').scenarios.plan;
  const field = document.getElementById('scenario-name');
  const f = field.getClientRects().length > 0 ? field.getBoundingClientRect() : null;
  const r = plan.root.getBoundingClientRect();
  const st = plan.stage.getBoundingClientRect();
  const foot = document.querySelector('.scn-bar').getBoundingClientRect();
  return {
    scroll: plan.root.scrollTop,
    field: f && { top: f.top, bottom: f.bottom },
    root: { top: r.top, bottom: r.bottom },
    stage: { top: st.top, bottom: st.bottom },
    footTop: foot.top,
    focused: document.activeElement === field,
  };
});
const inView = (at) => Boolean(at.field) && at.field.top >= at.root.top - 0.5 && at.field.bottom <= Math.min(at.root.bottom, at.footTop) + 0.5;

// A tablet held on its side, 1280 by 720 with a finger: the lab's panel
// stands beside the map, its scenario name at the section's top. An
// on-screen keyboard takes 400 px of the window. Two things moved the
// section under the reader typing there: the scroll still armed from the
// section opening (clearFoot made it as the stage came to lie under the
// foot: the name 73 px up, out of view), and a keyboard over REARM_HEIGHT
// arming it again, so the section was moved once the field let the focus
// go with the keyboard still up. One case each.
const TABLET = { width: 1280, height: 720, mobile: true };
const KEYBOARD = 400;

async function labWithName(page) {
  await fixture(page, null, [['newScenario', { name: 'Trial' }]]);
  await go(page, '#scenarios');
  await labReady(page);
  await turnsSettled(page, 'scenarios');
}

// the field tapped where it is, with no scroll to bring it (it is in view)
async function tapName(page) {
  const at = await nameAt(page);
  assert.ok(inView(at), 'the scenario name is not in view where the section is: the case tests nothing: ' + JSON.stringify(at));
  const field = await box(page, '#scenario-name');
  await page.touchscreen.tap(field.left + field.width / 2, field.top + field.height / 2);
  await until(page, 'the tap did not put the focus in the scenario name', () => document.activeElement && document.activeElement.id === 'scenario-name');
}

test('SV2-72i item 3: the lab at 1280 by 720 with a finger, the scroll still armed from opening: a 400 px keyboard over the scenario name moves nothing, and the name stays in view', async () => {
  await on('#project', TABLET, async (page) => {
    await labWithName(page);
    const opened = await nameAt(page);
    assert.equal(opened.scroll, 0, 'the lab scrolled as it opened at 1280 by 720: ' + JSON.stringify(opened));
    await tapName(page);
    const up = await resizeTo(page, 'scenarios', { width: TABLET.width, height: TABLET.height - KEYBOARD });
    const typed = await nameAt(page);
    assert.equal(typed.focused, true, 'the focus left the scenario name');
    assert.equal(typed.scroll, 0, 'the keyboard moved the section under the reader typing: ' + JSON.stringify({ typed, up }));
    // what a scroll would have cleared, with the section where it is: the foot over the stage, the stage's top in the section
    assert.ok(typed.stage.bottom > typed.footTop + 0.5 && typed.stage.top > typed.root.top + 0.5, 'with the keyboard up the foot is not over the stage, or the stage\'s top not in the section: the case tests nothing: ' + JSON.stringify(typed));
    assert.ok(inView(typed), 'the scenario name left the view with the keyboard up: ' + JSON.stringify(typed));
    // the reader types, Enter renames: a change of project, the map laid out again, and still nothing moved
    await page.keyboard.type(' two');
    await page.keyboard.press('Enter');
    await until(page, 'Enter did not rename the scenario', () => globalThis.sv2.store.project.scenario.name === 'Trial two');
    await labReady(page);
    await turnsSettled(page, 'scenarios');
    const renamed = await nameAt(page);
    assert.equal(renamed.scroll, 0, 'the rename moved the section under the reader typing: ' + JSON.stringify(renamed));
    assert.ok(inView(renamed), 'the scenario name left the view on the rename: ' + JSON.stringify(renamed));
  });
});

test('SV2-72i item 3: the lab at 1280 by 720 with a finger, scrolled by the reader while typing: the keyboard put away and brought back does not arm the scroll again, and leaving the name with it up moves nothing', async () => {
  await on('#project', TABLET, async (page) => {
    await labWithName(page);
    await tapName(page);
    const up = { width: TABLET.width, height: TABLET.height - KEYBOARD };
    await resizeTo(page, 'scenarios', up);
    // the reader's own scroll, with the keyboard up (the section has none to
    // give at 720 px): the scroll armed as the lab opened is off from here
    await readerScrolls(page, 'scenarios', 0);
    // the keyboard put away and brought back with the focus kept, each a
    // change of 400 px: neither may arm the scroll again
    await resizeTo(page, 'scenarios', TABLET);
    await resizeTo(page, 'scenarios', up);
    const typed = await nameAt(page);
    assert.equal(typed.focused, true, 'the focus left the scenario name');
    assert.ok(typed.stage.bottom > typed.footTop + 0.5 && typed.stage.top > typed.root.top + 0.5, 'with the keyboard up the foot is not over the stage, or the stage\'s top not in the section: the case tests nothing: ' + JSON.stringify(typed));
    await page.keyboard.type(' two');
    // the field lets the focus go with the keyboard still up (a tap on the
    // panel's heading under it): the blur renames, the map is laid out again
    const heading = await box(page, '#scenario-chips-title');
    assert.ok(heading && heading.bottom <= typed.footTop, 'the panel\'s heading is not where a finger can tap it: ' + JSON.stringify({ heading, typed }));
    await page.touchscreen.tap(heading.left + 4, heading.top + heading.height / 2);
    await until(page, 'leaving the field did not rename the scenario', () => globalThis.sv2.store.project.scenario.name === 'Trial two' && document.activeElement && document.activeElement.id !== 'scenario-name');
    await labReady(page);
    await turnsSettled(page, 'scenarios');
    const left = await nameAt(page);
    assert.equal(left.scroll, 0, 'the keyboard armed the scroll again and the section moved once the field let the focus go: ' + JSON.stringify(left));
  });
});

// The window compared on every resize, and from the size it was last armed
// in: three changes of 45 px are no change until together they pass 120;
// a change of width alone arms it; and a change under 120 px while it is
// still armed (the reader has not scrolled) is cleared like any other.
test('SV2-72i: Movement at 900 by 500 with a finger, at its top where the reader scrolled it: two height changes of 45 px leave it there, a third, 135 px from where it was armed, scrolls it clear of the foot', async () => {
  await on('#project', { width: 900, height: 500, mobile: true }, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    await readerScrolls(page, 'movement', 0);
    let height = 500;
    for (const [step, armed] of [[1, false], [2, false], [3, true]]) {
      height -= 45;
      const at = await resizeTo(page, 'movement', { width: 900, height });
      if (!armed) {
        assert.equal(at.scroll, 0, 'step ' + step + ' (' + (500 - height) + ' px in all) moved the section under the reader: ' + JSON.stringify(at));
        // what a scroll would have cleared, so the step tests something
        assert.ok(at.stage.bottom > at.footTop + 0.5, 'at ' + height + ' px the foot does not lie over the stage at the section\'s top: the case tests nothing: ' + JSON.stringify(at));
      } else {
        // the stage judged, not every floor: at 365 px with the controls
        // open the stage is 85 px and neither layout is whole on it (DESIGN
        // 5.4's limit for a window this low)
        assert.ok(at.scroll > 0, '135 px from where it was armed the section was not scrolled clear of the foot: ' + JSON.stringify(at));
        assert.ok(at.stage.bottom <= at.footTop + 0.5, '135 px from where it was armed the foot still lies over the stage: ' + JSON.stringify(at));
      }
    }
  });
});

test('SV2-72i: Movement at 844 by 390 with a finger, at its top where the reader scrolled it: a change of the width alone, 1 px, scrolls it clear of the foot again', async () => {
  await on('#project', SIDE, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    const opened = await floorsAt(page, 'movement');
    assert.ok(opened.scroll > 0, 'the map did not scroll the section clear of the foot as it opened: the case tests nothing: ' + JSON.stringify(opened));
    await readerScrolls(page, 'movement', 0);
    const narrower = await resizeTo(page, 'movement', { width: SIDE.width - 1, height: SIDE.height });
    assert.ok(narrower.scroll > 0, 'a change of width did not arm the scroll again: ' + JSON.stringify(narrower));
    assert.deepEqual(offStage(narrower), [], JSON.stringify(narrower));
  });
});

// A window change that leaves the stage the size it was: the stage's
// observer never measures, and only the window's own resize compares the
// window (SV2-72i: measure() returned before it looked, so a stage held at
// its least in a window 130 px lower was never armed again). The stage is
// pinned at its size for the case, the stand-in for a stage held at its
// least: in the sample at 844 by 260 Movement's stage has no height at all.
test('SV2-72i: Movement at 844 by 390 with a finger, at its top where the reader scrolled it: 130 px lower with the stage the same size, the scroll is armed again', async () => {
  await on('#project', SIDE, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    await page.evaluate(() => {
      const stage = document.querySelector('.mov').movement.plan.stage;
      const shown = stage.getBoundingClientRect();
      stage.style.flex = 'none';
      stage.style.height = shown.height + 'px';
      stage.style.minHeight = shown.height + 'px';
      stage.style.maxHeight = shown.height + 'px';
    });
    await readerScrolls(page, 'movement', 0);
    const before = await floorsAt(page, 'movement');
    const lower = await resizeTo(page, 'movement', { width: SIDE.width, height: SIDE.height - 130 });
    const same = (a, b) => Math.abs((a.stage.bottom - a.stage.top) - (b.stage.bottom - b.stage.top)) < 0.5 && Math.abs((a.stage.right - a.stage.left) - (b.stage.right - b.stage.left)) < 0.5;
    assert.ok(same(before, lower), 'the stage changed size: the case tests nothing: ' + JSON.stringify({ before: before.stage, lower: lower.stage }));
    // armed again, the map scrolls the section toward clearing the foot, as
    // far as the stage's top (the stage cannot be whole above the foot in
    // a window this low, so the scroll, not the stage, is judged)
    assert.ok(lower.scroll > 0, 'a window 130 px lower with the stage the same size did not arm the scroll again: ' + JSON.stringify(lower));
  });
});

test('SV2-72i: Movement at 844 by 390 with a finger, still armed as it opened: a change of 40 px of height, under REARM_HEIGHT, is still cleared', async () => {
  await on('#project', SIDE, async (page) => {
    await fixture(page);
    await go(page, '#movement');
    await answered(page);
    await turnsSettled(page, 'movement');
    const opened = await floorsAt(page, 'movement');
    assert.ok(opened.scroll > 0, 'the map did not scroll the section clear of the foot as it opened: the case tests nothing: ' + JSON.stringify(opened));
    const lower = await resizeTo(page, 'movement', { width: SIDE.width, height: SIDE.height - 40 });
    // the scroll it opened with leaves the foot over the stage at the lower
    // size, so only a scroll of the map's clears it. Not every floor: at 350
    // px the stage is the zoom box's 70 and neither layout is whole on it
    // (DESIGN 5.4's limit under about 360 px tall), so the stage is judged
    assert.ok(lower.scroll > opened.scroll, 'the section did not scroll further 40 px lower: ' + JSON.stringify({ opened, lower }));
    assert.ok(lower.stage.bottom <= lower.footTop + 0.5, '40 px lower the foot lies over the stage: ' + JSON.stringify(lower));
  });
});

// ------------------------------------------- SV2-72j: the scroll held while typing is made after it

// SV2-72i held the foot-clearing scroll while any text field had the focus
// and said it was made "at the next look" once the field let the focus go,
// but nothing looked: a scenario started from its name field (Enter) puts
// the focus in the scenario name (changes.js), the bar opens over the stage
// held at its least, and a click on the map left the foot over the floors.
// The scroll is made as the focus leaves for anything but another text field
// (onFocusOut); Fit makes it even with a field focused (a tap on a button
// moves no focus on iOS); and a readonly field holds nothing. LAB_LOW is a
// desktop window, a mouse, where the opened bar lies 32 px over the stage
// at its least (160 px) with the section where it is. Started by the Start
// button instead, the map clears the foot as the scenario opens (the focus
// is on the button, nothing typed) and focusing the name then scrolls the
// section 32 px back to show it, a scroll the map did not make; it comes in
// the frame the focus moved into the field, so it is the focus's, not the
// reader's, and the clearing stays held (SV2-72k's cases).
const LAB_LOW = { width: 1280, height: 300 };

// The lab opened with no scenario, then one started by Enter in its name
// field: the focus in the scenario name, the bar open over the stage, the
// map settled, and the scroll held.
async function labStarted(page) {
  await fixture(page);
  await go(page, '#scenarios');
  await labReady(page);
  await turnsSettled(page, 'scenarios');
  await page.click('#scenario-start-name');
  await page.keyboard.press('Enter');
  await until(page, 'starting a scenario did not put the focus in the scenario name', () => document.activeElement && document.activeElement.id === 'scenario-name' && Boolean(globalThis.sv2.store.project.scenario));
  await labReady(page);
  await turnsSettled(page, 'scenarios');
  const held = await nameAt(page);
  assert.equal(held.focused, true, 'the focus is not in the scenario name');
  assert.ok(!footClear(held), 'with the scenario name focused the foot does not lie over the stage: the case tests nothing: ' + JSON.stringify(held));
  return held;
}
// the foot clear of the stage, by their boxes
const footClear = (at) => at.stage.bottom <= at.footTop + 0.5;

test('SV2-72j: the lab at 1280 by 300 with a mouse, a scenario started with the bar over the stage, then a click on the map: the stage is scrolled clear of the foot', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStarted(page);
    // the map clicked where it shows above the foot
    const spot = await page.evaluate(() => {
      const plan = document.querySelector('.scn').scenarios.plan;
      const canvas = plan.canvas.getBoundingClientRect();
      const top = Math.max(canvas.top, plan.root.getBoundingClientRect().top);
      const bottom = Math.min(canvas.bottom, document.querySelector('.scn-bar').getBoundingClientRect().top);
      return { x: canvas.left + canvas.width / 2, y: (top + bottom) / 2, room: bottom - top };
    });
    assert.ok(spot.room > 4, 'no part of the map shows above the foot to click: ' + JSON.stringify({ spot, held }));
    await page.mouse.click(spot.x, spot.y);
    await until(page, 'the click on the map did not take the focus from the scenario name', () => document.activeElement && document.activeElement.id !== 'scenario-name');
    await turnsSettled(page, 'scenarios');
    const after = await nameAt(page);
    assert.ok(after.scroll > held.scroll, 'the focus left the scenario name and the section was not scrolled: ' + JSON.stringify({ held, after }));
    assert.ok(footClear(after), 'the focus left the scenario name and the foot still lies over the stage: ' + JSON.stringify(after));
  });
});

test('SV2-72j: the lab at 1280 by 300 with a mouse, the scenario name focused, Fit clicked by a script that moves no focus: the stage is scrolled clear of the foot', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStarted(page);
    const scrolled = await page.evaluate(() => {
      document.querySelector('#section [data-action="fit"]').click();
      return document.querySelector('.scn').scenarios.plan.root.scrollTop;
    });
    assert.ok(scrolled > held.scroll, 'Fit with the scenario name focused did not scroll the section: ' + JSON.stringify({ held, scrolled }));
    await turnsSettled(page, 'scenarios');
    const after = await nameAt(page);
    assert.equal(after.focused, true, 'the script\'s click moved the focus: the case tests nothing');
    assert.ok(footClear(after), 'after Fit with the scenario name focused the foot still lies over the stage: ' + JSON.stringify(after));
  });
});

// The window's comparison held while typing is made as the focus leaves too
// (SV2-72i had left it for the next resize, whenever that came): the reader
// scrolled the section, so the scroll is off; the window 1 px narrower with
// the name focused arms nothing; the click on the map that takes the focus
// compares the window, a change of width, and the scroll is made.
test('SV2-72j: the lab at 1280 by 300 with a mouse, scrolled by the reader with the scenario name focused: a window 1 px narrower arms nothing until the focus leaves, then the stage is scrolled clear of the foot', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStarted(page);
    await readerScrolls(page, 'scenarios', Math.round(held.scroll));
    const width = LAB_LOW.width - 1;
    await page.setViewport({ width, height: LAB_LOW.height, deviceScaleFactor: 1 });
    await until(page, 'the map was not measured in a window ' + width + ' by ' + LAB_LOW.height, (w, h) => {
      const plan = document.querySelector('.scn').scenarios.plan;
      if (window.innerWidth !== w || plan.root.dataset.window !== w + 'x' + h) return false;
      const stage = plan.stage.getBoundingClientRect();
      return plan.view.width === Math.round(stage.width) && plan.root.dataset.dockedAt === String(Math.round(plan.root.scrollTop));
    }, width, LAB_LOW.height);
    await turnsSettled(page, 'scenarios');
    const narrower = await nameAt(page);
    assert.equal(narrower.focused, true, 'the focus left the scenario name');
    assert.equal(narrower.scroll, held.scroll, 'a window 1 px narrower moved the section under the reader typing: ' + JSON.stringify({ held, narrower }));
    assert.ok(!footClear(narrower), 'the foot does not lie over the stage 1 px narrower: the case tests nothing: ' + JSON.stringify(narrower));
    const spot = await page.evaluate(() => {
      const canvas = document.querySelector('.scn').scenarios.plan.canvas.getBoundingClientRect();
      const bottom = Math.min(canvas.bottom, document.querySelector('.scn-bar').getBoundingClientRect().top);
      return { x: canvas.left + canvas.width / 2, y: (canvas.top + bottom) / 2 };
    });
    await page.mouse.click(spot.x, spot.y);
    await until(page, 'the click on the map did not take the focus from the scenario name', () => document.activeElement && document.activeElement.id !== 'scenario-name');
    await turnsSettled(page, 'scenarios');
    const after = await nameAt(page);
    assert.ok(after.scroll > narrower.scroll && footClear(after), 'the change of width made while typing was not compared as the focus left: ' + JSON.stringify({ narrower, after }));
  });
});

// The name made readonly with the focus kept in it, then a change of
// project, which lays the map out again (arrange, clearFoot): a field that
// takes no typing raises no keyboard, and the scroll is made.
test('SV2-72j: the lab at 1280 by 300 with a mouse, the scenario name focused and made readonly: the next change of project scrolls the stage clear of the foot', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStarted(page);
    await page.evaluate(() => {
      document.getElementById('scenario-name').readOnly = true;
      globalThis.sv2.store.apply(globalThis.sv2modules.actions.renameScenario, { name: 'Trial' });
    });
    await until(page, 'the rename did not come', () => globalThis.sv2.store.project.scenario.name === 'Trial');
    await labReady(page);
    await turnsSettled(page, 'scenarios');
    const after = await nameAt(page);
    assert.equal(after.focused, true, 'the focus left the scenario name: the case tests nothing');
    assert.equal(await page.$eval('#scenario-name', (el) => el.readOnly), true, 'the scenario name is not readonly: the case tests nothing');
    assert.ok(after.scroll > held.scroll && footClear(after), 'a readonly scenario name held the scroll: the foot lies over the stage: ' + JSON.stringify({ held, after }));
  });
});

// ------------------------------------------- SV2-72k: the focus's own scroll is not the reader's

// Started by its Start button (a mouse click), the map clears the foot as the
// scenario opens (the focus on the button, nothing typed), then start() puts
// the focus in the scenario name and the browser scrolls the section back
// 32 px to show it. That scroll is the focus's, not the reader's: the
// clearing stays armed, held while the name has the focus, and is made as
// the focus leaves. Before SV2-72k it turned the clearing off, and a click on
// the map left the foot 32 px over the stage.
async function labStartedByButton(page) {
  await fixture(page);
  await go(page, '#scenarios');
  await labReady(page);
  await turnsSettled(page, 'scenarios');
  await page.click('.scn [data-action="start"]');
  await until(page, 'the Start button did not start a scenario with the focus in its name', () => document.activeElement && document.activeElement.id === 'scenario-name' && Boolean(globalThis.sv2.store.project.scenario));
  await labReady(page);
  await turnsSettled(page, 'scenarios');
  const held = await nameAt(page);
  assert.equal(held.focused, true, 'the focus is not in the scenario name');
  assert.ok(inView(held), 'the scenario name is not in view after Start: ' + JSON.stringify(held));
  return held;
}
// a spot on the map that shows above the foot, clicked; the focus leaves
// the name, and the map has looked at the section where it is now
async function clickMap(page, held) {
  const spot = await page.evaluate(() => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const canvas = plan.canvas.getBoundingClientRect();
    const top = Math.max(canvas.top, plan.root.getBoundingClientRect().top);
    const bottom = Math.min(canvas.bottom, document.querySelector('.scn-bar').getBoundingClientRect().top);
    return { x: canvas.left + canvas.width / 2, y: (top + bottom) / 2, room: bottom - top };
  });
  assert.ok(spot.room > 4, 'no part of the map shows above the foot to click: ' + JSON.stringify({ spot, held }));
  await page.mouse.click(spot.x, spot.y);
  await until(page, 'the click on the map did not take the focus from the scenario name', () => document.activeElement && document.activeElement.id !== 'scenario-name');
  await turnsSettled(page, 'scenarios');
  await until(page, 'the map did not look at the section where it is after the click', () => {
    const plan = document.querySelector('.scn').scenarios.plan;
    return plan.root.dataset.dockedAt === String(Math.round(plan.root.scrollTop));
  });
  return nameAt(page);
}

test('SV2-72k: the lab at 1280 by 300 with a mouse, a scenario started by a click on its Start button, then a click on the map: the stage is clear of the foot', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStartedByButton(page);
    const after = await clickMap(page, held);
    assert.ok(footClear(after), 'started by its Start button, the focus\'s scroll to the scenario name turned the clearing off: after a click on the map the foot still lies over the stage: ' + JSON.stringify({ held, after }));
  });
});

// The name focused for longer than that frame, a scroll is the reader's
// again: a wheel over the lab's panel scrolls the section to its top, and
// the click on the map that takes the focus leaves it there.
test('SV2-72k: the lab at 1280 by 300 with a mouse, the scenario name focused for a while, then the reader\'s wheel to the top: the click on the map that takes the focus leaves the section where the reader put it', async () => {
  await on('#project', LAB_LOW, async (page) => {
    const held = await labStartedByButton(page);
    assert.ok(held.scroll > 0, 'the section is at its top already: the case tests nothing: ' + JSON.stringify(held));
    const field = await box(page, '#scenario-name');
    await page.mouse.move(field.left + field.width / 2, field.top + field.height / 2);
    await page.mouse.wheel({ deltaY: -400 });
    await until(page, 'the reader\'s wheel did not scroll the section to its top', () => {
      const plan = document.querySelector('.scn').scenarios.plan;
      return plan.root.scrollTop === 0 && plan.root.dataset.dockedAt === '0';
    });
    const wheeled = await nameAt(page);
    assert.equal(wheeled.focused, true, 'the wheel moved the focus: the case tests nothing');
    assert.ok(!footClear(wheeled), 'at its top the foot does not lie over the stage: the case tests nothing: ' + JSON.stringify(wheeled));
    const after = await clickMap(page, wheeled);
    assert.equal(after.scroll, 0, 'the reader wheeled the section to its top with the name focused, and the focus leaving scrolled it away: ' + JSON.stringify({ held, wheeled, after }));
  });
});

// ------------------------------------------- SV2-72e's open line: the toast's Show

// The shell's own Show, on the message an Undo leaves, opened its address
// with navigate(), unmarked, so on a phone a Show over the list and then a
// Delete wrote the list in the slot's place: Back from the list was the list
// again. A group or slot address goes through openAddress (SV2-72e's rule).
const hashOf = (page) => page.evaluate(() => location.hash);
const listIs = (page, folded) => until(page, 'the list is not ' + (folded ? 'folded' : 'shown'), (wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.sch-groups')?.dataset.folded === wanted, String(folded));
const step = (page) => page.evaluate(() => new Promise((resolve) => {
  window.addEventListener('popstate', () => resolve(), { once: true });
  history.back();
}));
async function backTo(page, start, most) {
  const seen = [await hashOf(page)];
  while (seen[seen.length - 1] !== start && seen.length <= most) {
    await step(page);
    seen.push(await hashOf(page));
  }
  return seen;
}
const closeToast = (page) => page.evaluate(() => document.querySelector('.toast__close')?.click());

test('SV2-72e\'s open line: Undo, then the message\'s Show, then a Delete on a phone at the list: Back from the list is the page before it, the list once', async () => {
  await on('#project', PHONE, async (page) => {
    await go(page, '#schedule/groups');
    await listIs(page, false);
    await loadModule(page, 'actions', 'engine/actions.js');
    await page.evaluate((groupId, dayTypeId) => {
      globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSlot, { groupId, dayTypeId, period: 3, slot: { label: 'Choir' } });
    }, C6, DAY_A);
    await listIs(page, false);
    await page.evaluate(() => globalThis.sv2.ctx.undo());
    await until(page, 'the Undo left no Show', () => document.querySelector('.toast .toast__action')?.textContent === 'Show');
    await tap(page, '.toast .toast__action');
    const slot = '#schedule/groups/' + C6 + '/' + DAY_A + '/3';
    await until(page, 'Show did not go to the slot\'s address', (hash) => location.hash === hash && document.querySelector('.sch').dataset.pending !== 'true', slot);
    await listIs(page, true);
    await closeToast(page);
    assert.deepEqual(await page.evaluate(() => history.state), { scheduleListUnder: true }, 'the message\'s Show over the list made an entry with no mark');
    await tap(page, '[data-action="delete"]');
    await closeToast(page);
    await listIs(page, false);
    await until(page, 'the page is not at the list, or is on a spent entry', () => location.hash === '#schedule/groups' && !(history.state && history.state.scheduleSpent) && document.querySelector('.sch').dataset.pending !== 'true');
    assert.deepEqual(await backTo(page, '#project', 4), ['#schedule/groups', '#project'], 'Back from the list showed the list twice');
  });
});

// ------------------------------------------- spec 18: run a scenario and apply it

// 8A's long walk out of the Gym in Period 6 on A Day, tried in the Library.
test('spec 18, run a scenario and apply it, by the keyboard alone at 1280 by 800', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page);
    await countInput(page);
    await sectionKey(page, 4, 'scenarios');
    await labReady(page);
    await tabTo(page, '#scenario-start-name');
    await page.keyboard.type('Library swap');
    await page.keyboard.press('Enter');
    await until(page, 'Enter in the name field did not start a scenario', () => document.querySelector('.scn').dataset.mode === 'open');
    await labReady(page);
    await tabTo(page, '#scenario-move-group');
    await page.keyboard.type('8A');
    await tabTo(page, '#scenario-move-period');
    await page.keyboard.type('Period 6');
    await until(page, 'the form does not say where 8A is in Period 6', () => document.querySelector('.scn-form__now')?.textContent === 'Now: Gym.');
    await tabTo(page, '.scn-field--room input');
    await page.keyboard.type('Library');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await tabTo(page, '[data-action="add-change"]');
    await page.keyboard.press('Enter');
    await until(page, 'the change was not added as a chip', () => document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.match(await page.$eval('.scn-chip .scn-chip__words', (el) => el.textContent), /8A/);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplegym', 'nothing is applied before Apply');
    await tabTo(page, '[data-action="apply"]');
    await page.keyboard.press('Enter');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#scenario-apply'))), true, 'the focus is not in the summary');
    await tabTo(page, '#scenario-apply .btn--primary', { most: 8 });
    await page.keyboard.press('Enter');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplelib');
    await journeyWas(page, 'keyboard');
  });
});

test('spec 18, run a scenario and apply it, by a finger alone at 390 by 844', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page);
    await countInput(page);
    await tap(page, '.rail a[href="#scenarios"]');
    await waitForSection(page, 'scenarios');
    await labReady(page);
    await tap(page, '[data-action="start"]');
    await until(page, 'the button did not start a scenario', () => document.querySelector('.scn').dataset.mode === 'open');
    await labReady(page);
    await tapSelect(page, '#scenario-move-group', 'gsample08a');
    await tapSelect(page, '#scenario-move-period', '5');
    await until(page, 'the form does not say where 8A is in Period 6', () => document.querySelector('.scn-form__now')?.textContent === 'Now: Gym.');
    await tap(page, '.scn-field--room input');
    await until(page, 'the room picker did not open its list', () => Boolean(document.querySelector('.scn-field--room .picker__list:not([hidden])')));
    const option = await page.$$eval('.scn-field--room .picker__option', (items) => items.findIndex((item) => item.textContent.startsWith('Library')));
    assert.ok(option >= 0, 'the picker offers no Library');
    await tap(page, '.scn-field--room .picker__option:nth-child(' + (option + 1) + ')');
    await tap(page, '[data-action="add-change"]');
    await until(page, 'the change was not added as a chip', () => document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplegym', 'nothing is applied before Apply');
    await tap(page, '[data-action="apply"]');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tap(page, '#scenario-apply .btn--primary');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplelib');
    await journeyWas(page, 'touch');
  });
});

// Seen in SV2-72f's screens: at 844 by 390 Apply's summary of three changes
// scrolled as a whole and opened scrolled to its buttons (the focus is on the
// safe one, last), its question 69 px above the window's top.
test('SV2-72f: Apply…\'s summary on a phone on its side with touch keeps its question and both buttons in view, its list scrolling between them', async () => {
  await on('#project', SIDE, async (page) => {
    const changes = [
      { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07a', period: 2, roomId: 'rsample101' },
      { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample06a', period: 0, roomId: 'rsamplecaf' },
      { kind: 'swapRooms', dayTypeId: DAY_A, groupA: 'gsample08a', groupB: 'gsample08b', period: 1 },
    ];
    await fixture(page, null, [['newScenario', { name: 'Library swap' }], ...changes.map((change) => ['addScenarioChange', { change }])]);
    await go(page, '#scenarios');
    await labReady(page);
    // SV2-72f2 item 5: the lab's class is on the summary when it is shown
    // and its button focused, not added after (the focus scrolled a dialog
    // laid out without it)
    await page.evaluate(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function showModal() {
        if (this.id === 'scenario-apply') globalThis.__m5applyClassAtShow = this.classList.contains('scn-apply');
        return show.call(this);
      };
    });
    await tap(page, '[data-action="apply"]');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    assert.equal(await page.evaluate(() => globalThis.__m5applyClassAtShow), true, 'the summary was shown and focused before it had the lab\'s class .scn-apply');
    const at = await page.evaluate(() => {
      const dialog = document.getElementById('scenario-apply');
      const inView = (el) => {
        const rect = el.getBoundingClientRect();
        return el.getClientRects().length > 0 && rect.top >= -0.5 && rect.bottom <= window.innerHeight + 0.5;
      };
      const body = dialog.querySelector('.dialog__body');
      return {
        title: inView(dialog.querySelector('.dialog__title')),
        buttons: Array.from(dialog.querySelectorAll('.dialog__buttons .btn')).map(inView),
        dialog: [dialog.getBoundingClientRect().top, dialog.getBoundingClientRect().bottom, dialog.scrollTop],
        body: [body.scrollHeight, body.clientHeight],
      };
    });
    assert.ok(at.body[0] > at.body[1] || at.dialog[2] > 0, 'the summary fits the window: the case tests nothing: ' + JSON.stringify(at));
    assert.equal(at.title, true, 'the question is out of view: ' + JSON.stringify(at));
    assert.deepEqual(at.buttons, [true, true], 'a button is out of view: ' + JSON.stringify(at));
  });
});

// ------------------------------------------- spec 18: print door cards

test('spec 18, print door cards, by the keyboard alone at 1280 by 800: one room shown from the list, a choice of two, then every room, on A4', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page);
    await countInput(page);
    await sectionKey(page, 5, 'safety');
    await safetyReady(page);
    // the inspector's tabs are one Tab stop with arrows between them
    await tabTo(page, '.sfy-inspector .tabs__tab[aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    await until(page, 'ArrowRight did not open Door cards', () => document.querySelector('.sfy-inspector .tabs__tab[data-tab="cards"]').getAttribute('aria-selected') === 'true');
    // Room 303 shown from the list: picked, then its card printed
    await tabTo(page, '.sfy-panel [data-action="show"][id$="-rsample303-show"]');
    await page.keyboard.press('Enter');
    await until(page, 'Show did not pick Room 303', () => document.querySelector('.sfy')?.dataset.picked === 'rsample303');
    await tabTo(page, '.sfy-panel [data-print="picked"]');
    await page.keyboard.press('Enter');
    let read = await preview(page);
    assert.equal(read.output, 'door-cards');
    assert.deepEqual(read.cards, ['rsample303']);
    assert.ok(read.text.includes('Take stairs B down to Floor 2.'), 'Room 303 is on Floor 3: its card says to take the stairs');
    // A4, by the arrows in the paper's radio group
    await tabTo(page, '#print-preview input[name$="size"]:checked, #print-preview input[value="letter"]', { most: 20 });
    await page.keyboard.press('ArrowRight');
    await until(page, 'the arrow did not choose A4', () => Boolean(document.querySelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]')));
    read = await preview(page);
    assert.equal(read.paper, 'a4 portrait');
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'picked', 'the focus is not back on the button that opened the preview');
    // two rooms ticked, printed in room order behind a cover sheet
    for (const room of ['rsample302', 'rsample301']) {
      await tabTo(page, '.sfy-panel input[type="checkbox"][id$="-' + room + '"]', { back: true });
      await page.keyboard.press('Space');
    }
    await tabTo(page, '.sfy-panel [data-print="chosen"]', { back: true });
    await page.keyboard.press('Enter');
    read = await preview(page);
    assert.deepEqual(read.cards, ['rsample301', 'rsample302']);
    assert.deepEqual(read.cover, ['rsample301', 'rsample302']);
    assert.equal(read.paper, 'a4 portrait', 'the paper chosen last time is the one offered');
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await tabTo(page, '.sfy-panel [data-print="all"]');
    await page.keyboard.press('Enter');
    read = await preview(page);
    assert.equal(read.cards.length, 13);
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await journeyWas(page, 'keyboard');
  });
});

// Where a room's middle cell is on the page, in CSS pixels.
const roomPoint = (page, roomId) => page.evaluate((id) => {
  const view = document.querySelector('.sfy').safety;
  const row = view.picture.byRoom.get(id);
  const cell = row.cells[Math.floor(row.cells.length / 2)];
  const at = view.plan.cellAt(row.floorId, cell);
  const rect = document.getElementById('safety-plan').getBoundingClientRect();
  return at ? { x: rect.left + at.x, y: rect.top + at.y } : null;
}, roomId);

test('spec 18, print door cards, by a finger alone at 390 by 844: a room tapped on the map, its card on A4, then every room', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page);
    await countInput(page);
    await tap(page, '.rail a[href="#safety"]');
    await waitForSection(page, 'safety');
    await safetyReady(page);
    await page.$eval('#safety-plan', (el) => el.scrollIntoView({ block: 'center' }));
    const at = await roomPoint(page, 'rsample303');
    assert.ok(at, 'Room 303 is not on the map at Fit');
    await page.touchscreen.tap(at.x, at.y);
    await until(page, 'the tap did not pick Room 303', () => document.querySelector('.sfy')?.dataset.picked === 'rsample303');
    // the inspector is a sheet on a phone
    await tap(page, '#inspector-toggle');
    await until(page, 'the sheet did not open', () => document.getElementById('inspector').dataset.open === 'true');
    await tap(page, '.sfy-inspector .tabs__tab[data-tab="cards"]');
    await until(page, 'Door cards did not open', () => document.querySelector('.sfy-inspector .tabs__tab[data-tab="cards"]').getAttribute('aria-selected') === 'true');
    await tap(page, '.sfy-panel [data-print="picked"]');
    let read = await preview(page);
    assert.deepEqual(read.cards, ['rsample303']);
    assert.deepEqual(read.names, ['Room 303']);
    await tap(page, '#print-preview input[value="a4"]');
    await until(page, 'the tap did not choose A4', () => Boolean(document.querySelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]')));
    await tap(page, '#print-preview [data-action="close"]');
    await until(page, 'Close did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await tap(page, '.sfy-panel [data-print="all"]');
    read = await preview(page);
    assert.equal(read.cards.length, 13);
    assert.equal(read.paper, 'a4 portrait', 'the paper chosen last time is the one offered');
    await tap(page, '#print-preview [data-action="close"]');
    await until(page, 'Close did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await journeyWas(page, 'touch');
  });
});

// ------------------------------------------- Fix… to Try it to Apply

// 6A put in Room 103 in Period 3 on A Day, where 6B is: a problem the
// suggestion engine can work on (test/browser/fix.mjs's fixture).
const CLASHED = [['setSlot', { groupId: 'gsample06a', dayTypeId: DAY_A, period: 2, slot: { room: 'rsample103' } }]];
const fixOf = '.sch-checks .sch-findings tbody tr[data-finding="' + CLASH + '"] [data-action="fix"]';

async function checksReady(page) {
  await until(page, 'the Checks tab did not list the clash', (id) => {
    const sch = document.querySelector('.sch');
    return sch && sch.dataset.pending !== 'true' && Boolean(document.querySelector('.sch-checks tr[data-finding="' + id + '"]'));
  }, CLASH);
}
const fixState = (page, state) => until(page, 'the Fix dialog is not ' + state, (wanted) => {
  const dialog = document.getElementById('fix-dialog');
  return Boolean(dialog) && dialog.open && dialog.dataset.state === wanted;
}, state);
// The change the first suggestion makes, as the lane gives it.
const firstChange = (page) => page.evaluate(async (id) => (await globalThis.sv2.store.derived.suggest(id, { otherTeachersRooms: false, limit: 5 })).suggestions[0].change, CLASH);
// What a change puts in each slot it names, read from the store as it is.
const slotsOf = (page, change) => page.evaluate((c) => {
  const rooms = (g) => globalThis.sv2.store.project.groups.find((each) => each.id === g).days[c.dayTypeId].map((slot) => slot.room);
  if (c.kind === 'move') return [rooms(c.groupId)[c.period]];
  if (c.kind === 'swapPeriods') return [rooms(c.groupId)[c.periodA], rooms(c.groupId)[c.periodB]];
  return [rooms(c.groupA)[c.period], rooms(c.groupB)[c.period]];
}, change);

test('Fix… to Try it to Apply, by the keyboard alone at 1280 by 800: the clash is cleared in the schedule', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page, null, CLASHED);
    await countInput(page);
    await sectionKey(page, 2, 'schedule');
    // the Checks tab, by the schedule's own tabs: one Tab stop, arrows between them
    await tabTo(page, '.sch .tabs__tab[aria-selected="true"]');
    // the arrows select as they go; Checks is the one before Import, the last
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await until(page, 'the keyboard did not open Checks', () => location.hash === '#schedule/checks');
    await checksReady(page);
    await tabTo(page, fixOf);
    await page.keyboard.press('Enter');
    await fixState(page, 'answered');
    const change = await firstChange(page);
    const before = await slotsOf(page, change);
    await tabTo(page, '#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]', { most: 12 });
    await page.keyboard.press('Enter');
    await until(page, 'Try it did not land on the scenario\'s name', () => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.activeElement?.id === 'scenario-name');
    await labReady(page);
    assert.deepEqual((await scenarioOf(page)).changes, [change]);
    assert.deepEqual(await slotsOf(page, change), before, 'Try it changed the schedule');
    await tabTo(page, '[data-action="apply"]');
    await page.keyboard.press('Enter');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tabTo(page, '#scenario-apply .btn--primary', { most: 8 });
    await page.keyboard.press('Enter');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    assert.notDeepEqual(await slotsOf(page, change), before, 'Apply left the slots as they were');
    assert.equal((await findingIds(page)).includes(CLASH), false, 'the clash is still a finding after Apply');
    await journeyWas(page, 'keyboard');
  });
});

test('Fix… to Try it to Apply, by a finger alone at 390 by 844: the clash is cleared in the schedule', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page, null, CLASHED);
    await countInput(page);
    await tap(page, '.rail a[href="#schedule"]');
    await waitForSection(page, 'schedule');
    await tap(page, '.sch .tabs__tab[data-tab="checks"]');
    await until(page, 'the tap did not open Checks', () => location.hash === '#schedule/checks');
    await checksReady(page);
    await tap(page, fixOf);
    await fixState(page, 'answered');
    const change = await firstChange(page);
    const before = await slotsOf(page, change);
    await tap(page, '#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await until(page, 'Try it did not open the scenario', () => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.deepEqual((await scenarioOf(page)).changes, [change]);
    assert.deepEqual(await slotsOf(page, change), before, 'Try it changed the schedule');
    await tap(page, '[data-action="apply"]');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tap(page, '#scenario-apply .btn--primary');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    assert.notDeepEqual(await slotsOf(page, change), before, 'Apply left the slots as they were');
    assert.equal((await findingIds(page)).includes(CLASH), false, 'the clash is still a finding after Apply');
    await journeyWas(page, 'touch');
  });
});
