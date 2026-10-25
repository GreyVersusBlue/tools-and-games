// The main journeys by touch alone, on a phone: node test/browser/journeys-touch.mjs
//
// A page 390 by 844 with touch (the harness's phone), driven by taps, drags
// and long-presses that go in through the browser's own input pipeline (the
// DevTools protocol), so the page receives real touch Pointer Events. Four
// journeys, each from a fresh page: enter a schedule (a teacher, then a group
// with rooms for two periods), see movement (open Movement, play, tap the
// busiest place), publish and open the file from disk (find a teacher and a
// door sign in the published file, on the same phone), and recover after a
// crash (by the start-up recovery dialog).
//
// page.evaluate reads what the page shows or holds, to assert on and to find
// where a finger goes; it never clicks, focuses or scrolls. The keyboard is
// used only to type into a field a tap focused, with the keys a phone's
// keyboard has, and each journey asserts that: every keydown the page saw
// was a printable character or Backspace (Enter only where a journey says
// it needs it) and had as its target an editable field that got the focus
// within a moment of a finger lifting and has kept it since; and every
// pointer the page saw was a finger. Each journey's first page starts with
// nothing kept on the device: no saved project and no localStorage.
//
// Every tap is held to what a finger needs. The target is brought into view
// by a swipe of the page (never by a script), then its middle is hit-tested:
// whatever is on top there has to be the target or inside it (nothing over
// it, not the sheet, not a message), and its smaller side has to be at least
// 44 px. A target that fails either is a barrier and the journey fails there,
// naming it.
//
// Each journey runs SV2_TOUCH_REPEAT times in a row (default 1; the unit was
// proved at 10, `SV2_TOUCH_REPEAT=10 node test/browser/journeys-touch.mjs`).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, startServer, launch, waitForSection, assertTouch, sameOrigin, TOOL_DIR, TOOL_PATH } from './harness.mjs';

export const PHONE = { width: 390, height: 844, mobile: true };
// The least a finger's target may measure in its smaller side (spec 3.11, DESIGN: 44 px).
export const FINGER = 44;
const REPEAT = Math.max(1, Number(process.env.SV2_TOUCH_REPEAT) || 1);
const CLEAN = { errors: [], blocked: [], shimmed: [] };

const SCRATCH_ROOT = process.env.SV2_SCRATCH ? path.resolve(process.env.SV2_SCRATCH) : path.join(TOOL_DIR, 'test', '.scratch');

let server;
let browser;
let scratch;

before(async () => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(path.join(SCRATCH_ROOT, 'touch-'));
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  try {
    rmdirSync(SCRATCH_ROOT);
  } catch (error) {
    // another suite's files are still in it, or the machine named it
  }
});

// ---------------------------------------------------------------- what the page saw

// Listen, from the capture phase of the window, for every pointer, key and
// wheel the page receives. A field records whether its focus came within
// 1.5 s of a finger lifting (a tap on it, or a button the tap pressed that
// put the focus there): typing is allowed only into such a field.
function listen() {
  if (globalThis.__touchLog) return;
  const log = { pointers: [], keys: [], wheels: 0 };
  globalThis.__touchLog = log;
  let lifted = -1e9;
  const editable = (el) => Boolean(el) && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'range', 'reset', 'file', 'color'].includes(el.type)));
  const named = (el) => (el && el.tagName ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.isConnected ? '' : ' (gone)') : String(el));
  // what each finger met, for a failure to say
  log.trail = [];
  const note = (what) => {
    log.trail.push(what);
    if (log.trail.length > 40) log.trail.shift();
  };
  addEventListener('pointerdown', (event) => {
    log.pointers.push(event.pointerType);
    note('down ' + named(event.target));
  }, true);
  addEventListener('click', (event) => note('click ' + named(event.target) + (event.target.isConnected ? '' : ' (gone)')), true);
  addEventListener('focusout', (event) => note('blur ' + named(event.target)), true);
  addEventListener('focusin', (event) => note('focus ' + named(event.target)), true);
  addEventListener('pointercancel', (event) => note('cancel ' + named(event.target)), true);
  addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') return;
    lifted = performance.now();
    // a finger on a field that already had the focus (one focused as its page opened) puts it there too
    if (editable(event.target)) event.target.__tapFocus = true;
  }, true);
  addEventListener('focusin', (event) => {
    if (editable(event.target)) event.target.__tapFocus = performance.now() - lifted < 1500;
  }, true);
  // a field that loses the focus has to be tapped again to be typed in
  addEventListener('focusout', (event) => {
    if (event.target) event.target.__tapFocus = false;
  }, true);
  addEventListener('keydown', (event) => {
    const el = event.target;
    log.keys.push({ key: event.key, field: editable(el), tapped: Boolean(el && el.__tapFocus), what: el ? el.tagName + (el.id ? '#' + el.id : '') : '' });
  }, true);
  addEventListener('wheel', () => {
    log.wheels += 1;
  }, true);
}

async function hear(page) {
  await page.evaluate(listen);
}

// The keys a phone's keyboard sends while a word is typed: one printable
// character, or Backspace. Enter is a key a journey has to ask for.
export function phoneKey(key, options) {
  if (key === 'Backspace') return true;
  if (key === 'Enter') return Boolean(options && options.enter);
  return [...key].length === 1;
}

// Every pointer was a finger, there was no wheel, and every key was one a
// phone's keyboard has and went into a field a tap focused. No journey here
// presses Enter; one that needs it passes { enter: true }.
export async function onlyTouch(page, what, options) {
  const log = await page.evaluate(() => globalThis.__touchLog);
  assert.ok(log, what + ': the page was not listening');
  assert.ok(log.pointers.length > 0, what + ': no pointer reached the page at all');
  assert.deepEqual([...new Set(log.pointers)], ['touch'], what + ': a pointer that was not a finger');
  assert.equal(log.wheels, 0, what + ': a wheel turned');
  const stray = log.keys.filter((key) => !key.field || !key.tapped);
  assert.deepEqual(stray, [], what + ': a key went somewhere a tap had not put a field');
  const unknown = log.keys.filter((key) => !phoneKey(key.key, options));
  assert.deepEqual(unknown, [], what + ': a key a phone\'s keyboard does not send while typing');
}

// ---------------------------------------------------------------- a finger

// One protocol session per page, kept for the page's life: detaching one
// takes the page's touch emulation with it (harness.mjs, clearSaved).
// SV2_TOUCH_CPU=4 slows each page's CPU four times, to look for races.
async function cdpOf(page) {
  if (!page.__touchSession) {
    page.__touchSession = await page.createCDPSession();
    if (Number(process.env.SV2_TOUCH_CPU) > 1) await page.__touchSession.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SV2_TOUCH_CPU) });
  }
  return page.__touchSession;
}

async function touch(page, type, fingers) {
  const cdp = await cdpOf(page);
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map((finger) => ({ x: Math.round(finger.x), y: Math.round(finger.y), id: finger.id || 1, radiusX: 4, radiusY: 4, force: 1 })) });
}

// The page has stopped moving: whatever the selector names (the document when
// none) has the same box over two frames, and the window has not scrolled.
// Not harness.mjs's still(), which is a wait for Building's plan alone (its
// view measured to its canvas's box): this one waits for any target on any
// page, the published file's and Movement's map included, and for the
// window's scroll, which still() does not read (SV2-32h1).
async function settle(page, selector) {
  const rest = await page.evaluate((wanted) => new Promise((resolve) => {
    const read = () => {
      const el = wanted ? document.querySelector(wanted) : null;
      const box = el ? el.getBoundingClientRect() : null;
      return [box ? [box.left, box.top, box.width, box.height].join(',') : '-', scrollX, scrollY, innerWidth, innerHeight].join(' ');
    };
    let last = read();
    let same = 0;
    let frames = 0;
    const next = () => requestAnimationFrame(() => {
      const now = read();
      frames += 1;
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= 2) resolve(true);
      else if (frames >= 180) resolve(false);
      else next();
    });
    next();
  }), selector || null);
  assert.ok(rest, 'the page did not come to rest within 180 frames' + (selector ? ' (' + selector + ')' : ''));
}

// Where a target is, and what a finger at its middle would land on.
function where(page, selector, index) {
  return page.evaluate((wanted, at) => {
    const el = typeof wanted === 'string' ? document.querySelectorAll(wanted)[at || 0] : null;
    if (!el) return { found: false };
    const rects = el.getClientRects();
    if (rects.length === 0) return { found: true, shown: false };
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const inside = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const hit = inside ? document.elementFromPoint(x, y) : null;
    const label = el.closest('label');
    const ok = Boolean(hit) && (hit === el || el.contains(hit) || (label !== null && label.contains(hit)));
    const name = (node) => (node ? node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : '') : 'nothing');
    // every ancestor that scrolls each way, innermost first: the box of its
    // visible part (cut by the window and by every scrolling box around it),
    // and how far it can still go each way
    const scrollers = (axis) => {
      const out = [];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const flow = axis === 'y' ? style.overflowY : style.overflowX;
        const page = node === document.scrollingElement;
        const more = axis === 'y' ? node.scrollHeight > node.clientHeight + 1 : node.scrollWidth > node.clientWidth + 1;
        if (!more || !(flow === 'auto' || flow === 'scroll' || page)) continue;
        const r = page ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : node.getBoundingClientRect();
        let box = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) };
        for (let outer = node.parentElement; outer && outer !== document.documentElement; outer = outer.parentElement) {
          const os = getComputedStyle(outer);
          if (os.overflowX === 'visible' && os.overflowY === 'visible') continue;
          const o = outer.getBoundingClientRect();
          box = { left: Math.max(box.left, o.left), top: Math.max(box.top, o.top), right: Math.min(box.right, o.right), bottom: Math.min(box.bottom, o.bottom) };
        }
        const position = axis === 'y' ? node.scrollTop : node.scrollLeft;
        const most = axis === 'y' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
        out.push({ ...box, back: position > 0.5, on: position < most - 0.5, name: name(node) });
      }
      return out;
    };
    return {
      found: true,
      shown: true,
      x,
      y,
      width: box.width,
      height: box.height,
      inside,
      ok,
      on: name(hit),
      name: name(el) + (el.textContent ? ' "' + el.textContent.trim().slice(0, 40) + '"' : ''),
      sy: scrollers('y'),
      sx: scrollers('x'),
    };
  }, selector, index || 0);
}

// A point inside `area` where a finger can start a swipe that scrolls by
// `delta` (the content's move; the finger moves against it): a point whose
// element, up to the area, lets the browser pan (no touch-action: none, no
// field, no canvas), placed so the whole move stays inside the area.
function swipeSpot(page, area, axis, delta) {
  return page.evaluate((box, which, move) => {
    const free = (node) => {
      for (let el = node; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.touchAction === 'none') return false;
        if (which === 'y' && /pan-x/.test(style.touchAction) && !/pan-y/.test(style.touchAction)) return false;
        if (which === 'x' && /pan-y/.test(style.touchAction) && !/pan-x/.test(style.touchAction)) return false;
        if (/^(INPUT|SELECT|TEXTAREA|CANVAS)$/.test(el.tagName)) return false;
      }
      return true;
    };
    // along the swipe: start at the end the finger moves away from
    const along = move > 0 ? [0.85, 0.75, 0.65] : [0.15, 0.25, 0.35];
    const across = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (const fa of along) {
      for (const fc of across) {
        const fx = which === 'x' ? fa : fc;
        const fy = which === 'y' ? fa : fc;
        const x = box.left + (box.right - box.left) * fx;
        const y = box.top + (box.bottom - box.top) * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && free(hit)) return { x, y };
      }
    }
    return null;
  }, area, axis, delta);
}

// Swipe the content by about (dx, dy): a positive dy brings what is below
// into view. A finger goes down, moves in steps of 20 px or less, and is
// held still for two frames before it lifts, so the page scrolls by the
// move and does not fling on. (The protocol's synthesizeScrollGesture
// scrolls nothing in this Chromium: measured 2026-10-25, 0 px for 300.)
//
// A swipe is for moving the page and nothing else: on the planner, a swipe
// that changed the project (an option picked by the finger that landed on
// it, SV2-32h2) fails here, naming what it did.
const projectMark = (page) => page.evaluate(() => {
  const store = globalThis.sv2 && globalThis.sv2.store;
  return store ? { steps: store.history.past.length, label: store.undoLabel, modified: store.project.modified } : null;
});

async function swipe(page, spot, dx, dy) {
  const before = await projectMark(page);
  await swipeOnly(page, spot, dx, dy);
  const after = await projectMark(page);
  assert.deepEqual(after, before, 'a swipe to scroll, from ' + Math.round(spot.x) + ', ' + Math.round(spot.y) + ' by ' + Math.round(dx) + ', ' + Math.round(dy) + ', changed the project: ' + (after ? after.label : ''));
}

async function swipeOnly(page, spot, dx, dy) {
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 20));
  await touch(page, 'touchStart', [{ x: spot.x, y: spot.y }]);
  for (let i = 1; i <= steps; i += 1) await touch(page, 'touchMove', [{ x: spot.x - (dx * i) / steps, y: spot.y - (dy * i) / steps }]);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await touch(page, 'touchMove', [{ x: spot.x - dx, y: spot.y - dy }]);
  await touch(page, 'touchEnd', []);
}

// Bring a target where a finger can reach it, by swiping what scrolls it.
// `clear` is the band of the window a target is moved to (the top bar and
// the bottom bar and sheet are outside it).
async function reveal(page, selector, index, clear) {
  const band = clear || { top: 120, bottom: 600 };
  for (let tries = 0; tries < 20; tries += 1) {
    const at = await where(page, selector, index);
    assert.ok(at.found, 'nothing on the page is ' + selector);
    assert.ok(at.shown, selector + ' is on the page and not shown');
    if (at.ok) return at;
    // Which way the target has to come, and the innermost scrolling box
    // that can bring it that way and that a finger can reach (its visible
    // part is big enough to swipe in).
    let dx = 0;
    let dy = 0;
    let area = null;
    const across = at.sx.find((box) => box.bottom - box.top >= 44 && box.right - box.left >= 60 && ((at.x < box.left + 20 && box.back) || (at.x > box.right - 20 && box.on)));
    if (across) {
      dx = at.x - (across.left + across.right) / 2;
      area = across;
    } else {
      // The innermost scrolling box the target lies outside of (above or
      // below what it shows), moved so the target comes to its middle: a
      // field in the sheet is brought into the sheet, not the page under it.
      // With the target inside every box but covered or out of the band,
      // the outermost box moves it into the band.
      const inside = (box) => at.y >= box.top + 10 && at.y <= box.bottom - 10;
      const tall = (box) => box.bottom - box.top >= 60;
      const out = at.sy.find((box) => tall(box) && !inside(box));
      if (out) {
        dy = at.y - (out.top + out.bottom) / 2;
        if (dy > 0 ? out.on : out.back) area = out;
      }
      if (!area) {
        dy = at.y - (band.top + band.bottom) / 2;
        area = at.sy.slice().reverse().find((box) => tall(box) && (dy > 0 ? box.on : box.back)) || null;
      }
    }
    assert.ok(area, selector + ' (' + at.name + ') is covered by ' + at.on + ' at ' + Math.round(at.x) + ', ' + Math.round(at.y) + ' and nothing a finger can swipe would move it');
    // a finger swipes at most half the area at once
    const reach = dx !== 0 ? (area.right - area.left) * 0.5 : (area.bottom - area.top) * 0.5;
    const clamp = (value) => Math.max(-reach, Math.min(reach, value));
    const spot = await swipeSpot(page, area, dx !== 0 ? 'x' : 'y', dx !== 0 ? dx : dy);
    assert.ok(spot, 'no place in ' + area.name + ' where a finger could swipe it');
    await swipe(page, spot, clamp(dx), clamp(dy));
    await settle(page, typeof selector === 'string' ? selector : null);
  }
  const last = await where(page, selector, index);
  assert.fail(selector + ' (' + last.name + ') could not be brought under a finger: at ' + Math.round(last.x) + ', ' + Math.round(last.y) + ' a finger lands on ' + last.on);
}

// Tap a target the way a finger does, after holding it to what a finger needs.
export async function tap(page, selector, options) {
  const opts = options || {};
  // a target still moving (a sheet sliding up, a list opening) is read once it has stopped
  await settle(page, selector);
  const at = await reveal(page, selector, opts.index, opts.clear);
  const small = Math.min(at.width, at.height);
  if (opts.size !== false) assert.ok(small >= FINGER, 'a target under ' + FINGER + ' px: ' + at.name + ' is ' + Math.round(at.width) + ' by ' + Math.round(at.height));
  let x = at.x;
  if (opts.end) {
    // near the field's right edge, past its text: where a finger puts the caret at the end
    x = at.x + at.width / 2 - 12;
    const on = await page.evaluate((px, py, wanted, index) => {
      const el = document.querySelectorAll(wanted)[index || 0];
      const hit = document.elementFromPoint(px, py);
      return { ok: Boolean(hit) && (hit === el || el.contains(hit)), on: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing' };
    }, x, at.y, selector, opts.index || 0);
    assert.ok(on.ok, 'the end of ' + at.name + ' is covered by ' + on.on);
  }
  await touch(page, 'touchStart', [{ x, y: at.y }]);
  await touch(page, 'touchEnd', []);
  return at;
}

// A tap at a point the test worked out (a cell of a map), held to the same rule: nothing over it.
export async function tapAt(page, x, y, under) {
  const on = await page.evaluate((px, py, wanted) => {
    const hit = document.elementFromPoint(px, py);
    return { ok: Boolean(hit) && Boolean(hit.closest(wanted)), on: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + '.' + String(hit.className) : 'nothing' };
  }, x, y, under);
  assert.ok(on.ok, 'a finger at ' + Math.round(x) + ', ' + Math.round(y) + ' lands on ' + on.on + ', not on ' + under);
  await touch(page, 'touchStart', [{ x, y }]);
  await touch(page, 'touchEnd', []);
}

// Tap a field and type into it, as the phone's keyboard does. `replace`
// clears what it held first the way a phone can: the field is tapped at its
// end, so the caret is after the last character (or the text is selected to
// the end), and Backspace takes the text away. A phone's keyboard has no
// Delete key.
export async function typeInto(page, selector, text, options) {
  const opts = options || {};
  await tap(page, selector, { ...opts, end: opts.replace === true });
  await page.waitForFunction((wanted, at) => document.activeElement === document.querySelectorAll(wanted)[at || 0], { timeout: 5000 }, selector, opts.index || 0);
  if (opts.replace) {
    const caret = () => page.evaluate(() => ({ value: document.activeElement.value, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }));
    const first = await caret();
    assert.equal(first.end, first.value.length, 'a tap at the end of ' + selector + ' put the caret at ' + first.end + ' of ' + JSON.stringify(first.value));
    for (let i = 0; i < first.value.length && (await caret()).value !== ''; i += 1) await page.keyboard.press('Backspace');
    assert.equal((await caret()).value, '', selector + ' was not emptied by Backspace');
  }
  await page.keyboard.type(text);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tap a field that has a list under it (a picker), and hold it to opening
// the list: a tap that only focused the field is a tap a finger has to make
// twice.
export async function tapList(page, selector, options) {
  await tap(page, selector, options);
  await page.waitForFunction((wanted, at) => {
    const field = document.querySelectorAll(wanted)[at || 0];
    return Boolean(field) && field.getAttribute('aria-expanded') === 'true';
  }, { timeout: 3000 }, selector, (options && options.index) || 0).catch(async () => {
    const state = await page.evaluate((wanted, at) => {
      const field = document.querySelectorAll(wanted)[at || 0];
      return field ? { focused: document.activeElement === field, expanded: field.getAttribute('aria-expanded') } : null;
    }, selector, (options && options.index) || 0);
    throw new Error('a tap on ' + selector + ' opened no list: ' + JSON.stringify(state));
  });
}

// ---------------------------------------------------------------- pages

// This origin's localStorage emptied (sv2:device: the theme, the tab lock,
// what the last journey's page remembered), from a page of the origin's own
// that is closed again. openPlanner empties IndexedDB and leaves
// localStorage alone, for suites that set a device on purpose.
async function forgetDevice() {
  const probe = await browser.newPage();
  try {
    await probe.goto(server.base + TOOL_PATH + 'icon.svg', { waitUntil: 'load' });
    const left = await probe.evaluate(() => {
      localStorage.clear();
      return localStorage.length;
    });
    assert.equal(left, 0, 'localStorage was not emptied');
  } finally {
    await probe.close();
  }
}

// A fresh planner on the phone, listening: nothing kept on the device from
// an earlier journey or repeat.
async function phonePlanner(hash) {
  await forgetDevice();
  const session = await openPlanner({ server, browser, hash: hash || '#building', theme: 'light', ...PHONE });
  await cdpOf(session.page);
  await hear(session.page);
  return session;
}

async function finish(session, run) {
  let failed = null;
  try {
    await run(session.page, session);
  } catch (error) {
    failed = error;
    if (process.env.SV2_TOUCH_SHOTS) await session.page.screenshot({ path: path.join(process.env.SV2_TOUCH_SHOTS, 'failed-' + Date.now() + '.png') }).catch(() => {});
  }
  const found = session.problems();
  await session.close();
  if (failed) throw failed;
  assert.deepEqual(found, CLEAN);
}

// ---------------------------------------------------------------- what the device kept

// One read of a store of the page's IndexedDB: `key` one record, or null for
// all of them. It refuses, saying why, when the database is not there (and
// makes none: an open with no version that would create one is aborted),
// when it has no such store, when the read fails, and after `ms`; the
// database is closed in every case.
function readStore(page, name, store, key, ms) {
  return page.evaluate((db, storeName, wanted, limit) => new Promise((resolve, reject) => {
    let opened = null;
    let done = false;
    const end = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (opened) opened.close();
      fn(value);
    };
    const timer = setTimeout(() => end(reject, new Error('reading ' + db + ' / ' + storeName + ' took over ' + limit + ' ms')), limit);
    let open;
    try {
      open = indexedDB.open(db);
    } catch (error) {
      end(reject, error);
      return;
    }
    open.onupgradeneeded = () => {
      opened = open.result;
      open.transaction.abort();
    };
    open.onblocked = () => end(reject, new Error('opening ' + db + ' was blocked'));
    open.onerror = () => end(reject, new Error('there is no database ' + db + ' (' + (open.error ? open.error.name : 'no error') + ')'));
    open.onsuccess = () => {
      opened = open.result;
      if (!opened.objectStoreNames.contains(storeName)) {
        end(reject, new Error(db + ' has no store ' + storeName + ': ' + Array.from(opened.objectStoreNames).join(', ')));
        return;
      }
      try {
        const source = opened.transaction(storeName, 'readonly').objectStore(storeName);
        const read = wanted === null ? source.getAll() : source.get(wanted);
        read.onsuccess = () => end(resolve, read.result);
        read.onerror = () => end(reject, new Error('reading ' + db + ' / ' + storeName + ' failed: ' + (read.error ? read.error.name : 'no error')));
      } catch (error) {
        end(reject, error);
      }
    };
  }), name, store, key === undefined ? null : key, ms || 5000);
}

// Read until `ok(result)` holds, for up to `ms`; a read that refuses is
// tried again, and the last refusal is in the failure.
async function readUntil(page, name, store, key, ok, ms, what) {
  const until = Date.now() + ms;
  let last = 'nothing was read';
  for (;;) {
    try {
      const result = await readStore(page, name, store, key, 2000);
      if (ok(result)) return result;
      last = 'read, and not yet';
    } catch (error) {
      last = error.message;
    }
    if (Date.now() > until) assert.fail(what + ' within ' + ms + ' ms: ' + last);
    await pause(200);
  }
}

// ---------------------------------------------------------------- 1. enter a schedule

const DAY_A = 'dsample00a';
const TEACHER = 'Mx. Quennell-Abara';
const GROUP = '7 Larch';

// Wait for the schedule to have drawn again after a change (data-pending).
const scheduleSettled = (page) => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });

// The index among `selector`'s matches of the one whose text starts with `label`.
async function indexOf(page, selector, label) {
  const at = await page.$$eval(selector, (all, wanted) => all.findIndex((el) => el.textContent.trim().startsWith(wanted)), label);
  assert.notEqual(at, -1, 'no ' + selector + ' reads ' + label + ': ' + (await page.$$eval(selector, (all) => all.map((el) => el.textContent.trim()).join(' | '))));
  return at;
}

// Rooms nobody is in on A Day in each of the first two periods, read from the store.
function freeRooms(page) {
  return page.evaluate((dayId) => {
    const project = globalThis.sv2.store.project;
    const rooms = project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room' && /^\d+$/.test(space.number));
    return [0, 1].map((period) => {
      const used = new Set(project.groups.map((group) => group.days[dayId][period].room));
      return rooms.find((room) => !used.has(room.id)).number;
    });
  }, DAY_A);
}

export async function enterSchedule(page) {
  // to the Schedule section by the bottom bar, and its Teachers tab
  await tap(page, '.rail__item[data-section="schedule"]');
  await waitForSection(page, 'schedule');
  await tap(page, '#surface [role="tab"][data-tab="teachers"]');
  await page.waitForSelector('[data-action="add-teacher"]');
  const before = await page.evaluate(() => globalThis.sv2.store.project.teachers.length);

  // a teacher: Add, the name typed into the field it opens, a room picked from the list
  await tap(page, '[data-action="add-teacher"]');
  await page.waitForFunction((count) => globalThis.sv2.store.project.teachers.length === count + 1, { timeout: 5000 }, before);
  const teacherId = await page.evaluate(() => globalThis.sv2.store.project.teachers.at(-1).id);
  await scheduleSettled(page);
  await typeInto(page, '[data-key="teacher:' + teacherId + ':name"]', TEACHER, { replace: true });
  await tapList(page, '[data-key="teacher:' + teacherId + ':room"]');
  await page.waitForFunction((id, name) => globalThis.sv2.store.project.teachers.find((t) => t.id === id).name === name, { timeout: 5000 }, teacherId, TEACHER).catch(async (error) => {
    throw new Error('the name was not kept: the store has ' + JSON.stringify(await page.evaluate((id) => globalThis.sv2.store.project.teachers.find((t) => t.id === id).name, teacherId)) + ', the field ' + JSON.stringify(await page.$eval('[data-key="teacher:' + teacherId + ':name"]', (el) => el.value)) + ' (' + error.message + ')');
  });
  const options = 'tr[data-teacher="' + teacherId + '"] .picker__option';
  await page.waitForSelector(options);
  await tap(page, options, { index: await indexOf(page, options, '303') });
  await page.waitForFunction((id) => globalThis.sv2.store.project.teachers.find((t) => t.id === id).roomIds.length === 1, { timeout: 5000 }, teacherId);
  await scheduleSettled(page);
  // what the page shows: the name as typed and the room's chip
  assert.equal(await page.$eval('[data-key="teacher:' + teacherId + ':name"]', (el) => el.value), TEACHER);
  assert.deepEqual(await page.$$eval('tr[data-teacher="' + teacherId + '"] .chip > span:first-child', (all) => all.map((el) => el.textContent)), ['303']);

  // a group: Add, its name, then a room in each of the first two periods of A Day by the list, and the teacher in the first
  await tap(page, '#surface [role="tab"][data-tab="groups"]');
  await page.waitForSelector('[data-action="add-group"]');
  await tap(page, '[data-action="add-group"]');
  await page.waitForFunction(() => globalThis.sv2.store.project.groups.at(-1).name === 'New group', { timeout: 5000 });
  const groupId = await page.evaluate(() => globalThis.sv2.store.project.groups.at(-1).id);
  await scheduleSettled(page);
  await typeInto(page, '[data-key="group-name"]', GROUP, { replace: true });
  const rooms = await freeRooms(page);
  for (const period of [0, 1]) {
    const field = '[data-key="slot:' + DAY_A + ':' + period + ':room"]';
    await tapList(page, field);
    const listed = '.sch-day[data-day="' + DAY_A + '"] tr[data-period="' + period + '"] .sch-room .picker__option';
    await page.waitForSelector(listed);
    await tap(page, listed, { index: await indexOf(page, listed, rooms[period]) });
    await page.waitForFunction((id, day, at, number) => {
      const project = globalThis.sv2.store.project;
      const group = project.groups.find((each) => each.id === id);
      const room = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === group.days[day][at].room);
      return Boolean(room) && room.number === number;
    }, { timeout: 5000 }, groupId, DAY_A, period, rooms[period]).catch(async (error) => {
      const seen = await page.evaluate((wanted) => ({ value: document.querySelector(wanted).value, expanded: document.querySelector(wanted).getAttribute('aria-expanded'), trail: globalThis.__touchLog.trail.slice(-12) }), field);
      throw new Error('room ' + rooms[period] + ' was not picked for period ' + (period + 1) + ': ' + JSON.stringify(seen) + ' (' + error.message + ')');
    });
    await scheduleSettled(page);
  }
  // the teacher of the first period, from the list of teachers
  await tapList(page, '[data-key="slot:' + DAY_A + ':0:teacher"]');
  const teachers = '.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .sch-slot__teacher .picker__option';
  await page.waitForSelector(teachers);
  await tap(page, teachers, { index: await indexOf(page, teachers, TEACHER) });
  await page.waitForFunction((id, day, teacher) => globalThis.sv2.store.project.groups.find((each) => each.id === id).days[day][0].teacherIds.includes(teacher), { timeout: 5000 }, groupId, DAY_A, teacherId);
  await scheduleSettled(page);

  // what the page shows: the group's name, both rooms, the teacher's chip, and two periods done
  assert.equal(await page.$eval('.sch-editor__title', (el) => el.textContent), GROUP);
  for (const period of [0, 1]) assert.equal((await page.$eval('[data-key="slot:' + DAY_A + ':' + period + ':room"]', (el) => el.value)).split(' — ')[0], rooms[period]);
  assert.deepEqual(await page.$$eval('.sch-day[data-day="' + DAY_A + '"] tr[data-period="0"] .sch-slot__teacher .chip > span:first-child', (all) => all.map((el) => el.textContent)), [TEACHER]);
  return { teacherId, groupId, rooms };
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('enter a schedule by touch: a teacher, then a group with rooms for two periods (run ' + run + ' of ' + REPEAT + ')', async () => {
    await finish(await phonePlanner('#building'), async (page) => {
      const made = await enterSchedule(page);
      // and what a reload has to keep: the saved project has both
      await page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved', { timeout: 10000 });
      const record = await readStore(page, 'sv2', 'project', 'current');
      assert.ok(record && record.project, 'the saved project is not in sv2 / project');
      const saved = record.project;
      assert.equal(saved.teachers.find((each) => each.id === made.teacherId).name, TEACHER);
      assert.equal(saved.groups.find((each) => each.id === made.groupId).name, GROUP);
      await onlyTouch(page, 'enter a schedule');
    });
  });
}

// ---------------------------------------------------------------- 2. see movement

// The movement view has the answer for the project as it is, and its map has
// been drawn at the size the stage has now.
function movementDrawn(page) {
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

// Where on screen the busiest cell of what the map shows is, and what the map says of it.
function busiestSpot(page) {
  return page.evaluate(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    if (!busiest || busiest.cell === null) return null;
    const plan = document.getElementById('movement-plan').getBoundingClientRect();
    const at = movement.cellAt(busiest.floorId, busiest.cell);
    if (!at) return null;
    return { x: plan.left + at.x, y: plan.top + at.y, cell: busiest.cell, floorId: busiest.floorId, load: busiest.load, floor: busiest.floorName };
  });
}

export async function seeMovement(page) {
  await tap(page, '.rail__item[data-section="movement"]');
  await waitForSection(page, 'movement');
  await movementDrawn(page);
  // Play: the first transition walks, and the button turns to Pause
  await tap(page, '.mov-pb__play');
  await page.waitForFunction(() => document.querySelector('.mov-pb__play').textContent === 'Pause', { timeout: 5000 });
  await settle(page, '#movement-plan');
  // the busiest place on the map, tapped while the groups walk
  const spot = await busiestSpot(page);
  assert.ok(spot, 'the map has no busiest cell on screen');
  await tapAt(page, spot.x, spot.y, '.mov-stage');
  await page.waitForFunction((wanted) => {
    const card = document.querySelector('.mov-card');
    return !card.hidden && card.dataset.cell === String(wanted.cell) && card.dataset.floor === wanted.floorId;
  }, { timeout: 5000 }, spot);
  const card = await page.evaluate(() => ({
    place: document.querySelector('.mov-card__place').textContent,
    load: document.querySelector('.mov-card__load').textContent,
    playing: document.querySelector('.mov-pb__play').textContent,
  }));
  assert.match(card.place, new RegExp(' · ' + spot.floor + '$'));
  assert.ok(card.load.startsWith(spot.load + ' '), 'the card gives the busiest load, ' + spot.load + ': ' + card.load);
  return { spot, card };
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('see movement by touch: open Movement, play, tap the busiest place (run ' + run + ' of ' + REPEAT + ')', async () => {
    await finish(await phonePlanner('#building'), async (page) => {
      await seeMovement(page);
      await onlyTouch(page, 'see movement');
    });
  });
}

// ---------------------------------------------------------------- 3. publish, and open the file from disk

const PASSCODE = 'bulldogs2015';
const FIND = 'Larkspur';

// Publish a file by taps, into `folder`; the file's path.
export async function publishFile(page, folder) {
  const client = await cdpOf(page);
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
  await tap(page, '.rail__item[data-section="staff"]');
  await waitForSection(page, 'staff');
  // the publish form is in the sheet: open it by its handle
  await tap(page, '#inspector-toggle');
  await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.pub') && document.querySelector('.pub').dataset.checksPending !== 'true', { timeout: 30000 });
  await tap(page, '#publish-file');
  await page.waitForFunction(() => /^Published /.test(document.querySelector('[data-says="published"]').textContent), { timeout: 30000 });
  let names = [];
  for (let tries = 0; tries < 100 && !(names.length === 1 && names[0].endsWith('.html')); tries += 1) {
    await pause(100);
    names = readdirSync(folder);
  }
  assert.equal(names.length, 1, 'one file was downloaded: ' + names.join(', '));
  return path.join(folder, names[0]);
}

// A published file opened from disk on a phone of its own: no kept key,
// nothing remembered, every request counted.
async function openFileOnPhone(file) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: PHONE.width, height: PHONE.height, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await page.evaluateOnNewDocument(listen);
  await cdpOf(page);
  const url = pathToFileURL(file).href;
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await assertTouch(page, 'the published file on a phone');
  return {
    page,
    errors,
    // what the file asked for beyond itself; a font inside the file comes from a data: address
    asked: () => requests.filter((each) => each !== url && !each.startsWith(url + '#') && !each.startsWith('data:')),
    close: () => context.close(),
  };
}

const fileIs = (page, wanted) => page.waitForFunction((want) => document.getElementById('app').dataset.state === want, { timeout: 30000 }, wanted);

export async function useFile(page) {
  await fileIs(page, 'locked');
  await typeInto(page, '#passcode', PASSCODE);
  await tap(page, '#app form button[type="submit"]');
  await fileIs(page, 'open');
  // find a teacher: the search box, the name, the result
  await typeInto(page, '#find', FIND);
  const result = 'a.list__link[data-result="teacher"]';
  await page.waitForSelector(result);
  await tap(page, result, { index: await indexOf(page, result, 'Mr. Larkspur') });
  await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Mr. Larkspur', { timeout: 5000 });
  // the teacher's room, and its door sign
  const roomLink = 'main a[href^="#/room/"]';
  await tap(page, roomLink);
  await page.waitForFunction(() => location.hash.startsWith('#/room/') && document.querySelector('[data-output="door"]') && document.querySelector('h1').textContent !== 'Mr. Larkspur', { timeout: 5000 });
  const room = await page.evaluate(() => document.querySelector('h1').textContent);
  await tap(page, '[data-output="door"]');
  await page.waitForFunction(() => location.hash.startsWith('#/door/') && document.querySelector('.sign__number'), { timeout: 5000 });
  return {
    room,
    number: await page.$eval('.sign__number', (el) => el.textContent),
    sign: await page.$eval('.sign', (el) => el.textContent),
  };
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('publish by touch and open the file from disk: find a teacher and a door sign by taps on the phone (run ' + run + ' of ' + REPEAT + ')', async () => {
    const folder = mkdtempSync(path.join(scratch, 'publish-'));
    let file;
    await finish(await phonePlanner('#building'), async (page) => {
      file = await publishFile(page, folder);
      await onlyTouch(page, 'publish');
    });
    const reader = await openFileOnPhone(file);
    try {
      const found = await useFile(reader.page);
      assert.match(found.room, /302/);
      assert.equal(found.number, '302');
      assert.ok(found.sign.includes('Mr. Larkspur'), 'the door sign names the teacher: ' + found.sign);
      await onlyTouch(reader.page, 'the published file');
      assert.deepEqual(reader.asked(), [], 'the file asked for nothing beyond itself');
      assert.deepEqual(reader.errors, []);
    } finally {
      await reader.close();
    }
  });
}

// ---------------------------------------------------------------- 4. recover after a crash

const SCHOOL = 'Fennick Lane School';

// Kill the page's process (no pagehide, no flush), then wait until the
// editing tab's lock is free, as recovery.mjs's crash() does.
async function crash(session) {
  const { page } = session;
  const client = await cdpOf(page);
  const { targetInfo } = await client.send('Target.getTargetInfo');
  const probe = await browser.newPage();
  await probe.goto(server.base + TOOL_PATH + 'icon.svg', { waitUntil: 'load' });
  const lockHeld = () => probe.evaluate(async () => (await navigator.locks.query()).held.some((lock) => lock.name === 'sv2:project'));
  assert.equal(await lockHeld(), true, 'the probe sees the editing tab holding the lock');
  client.send('Page.crash').catch(() => {});
  await pause(500);
  await Promise.race([page.close().catch(() => {}), pause(3000)]);
  const connection = (await probe.createCDPSession()).connection();
  await connection.send('Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
  await probe.waitForFunction(async () => !(await navigator.locks.query()).held.some((lock) => lock.name === 'sv2:project'), { timeout: 15000, polling: 250 });
  await probe.close();
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('recover after a crash by touch: the work is in a recovery point, the page dies, and a tap on the start-up dialog brings it back (run ' + run + ' of ' + REPEAT + ')', async () => {
    const session = await phonePlanner('#project');
    const { page } = session;
    await page.waitForFunction(() => globalThis.sv2.storage && globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
    // The crash comes after the recovery point and before the save: the
    // save is held back a minute and a point is taken every 300 ms, which is
    // the harness standing in for a page that died inside the save's delay.
    await page.evaluate(() => globalThis.sv2.storage.setTiming({ delay: 60000, maxWait: 60000, recoveryMs: 300 }));
    // the work, by touch: the school's name, typed into its field
    await typeInto(page, 'input[name="schoolName"]', SCHOOL, { replace: true });
    // leaving the field commits it: a tap on the section's heading
    await tap(page, '#section h1', { size: false });
    await page.waitForFunction((name) => globalThis.sv2.store.project.settings.schoolName === name, { timeout: 5000 }, SCHOOL);
    await readUntil(page, 'sv2-recovery', 'recovery', null, (points) => points.some((point) => point.project.settings.schoolName === SCHOOL), 10000, 'no recovery point holds the school\'s new name');
    await onlyTouch(page, 'the work before the crash');
    const problems = session.problems();
    await crash(session);
    assert.deepEqual(problems, CLEAN);

    // the next start, on a phone: the planner waits for the answer before it draws
    const next = await browser.newPage();
    try {
      await next.setViewport({ width: PHONE.width, height: PHONE.height, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      await next.evaluateOnNewDocument(listen);
      await cdpOf(next);
      const errors = [];
      next.on('pageerror', (error) => errors.push('page error: ' + error.message));
      const offsite = [];
      next.on('request', (request) => {
        if (!sameOrigin(request.url(), server.base)) offsite.push(request.url());
      });
      await next.goto(server.base + TOOL_PATH + '#project', { waitUntil: 'load' });
      await assertTouch(next, 'the page after the crash');
      await next.waitForSelector('#recovery-dialog[open]');
      // the sample school was never saved (nothing is saved until the first
      // change, and the change's save was held back), so the offer is the one
      // for a device with a point and no saved project
      assert.equal(await next.$eval('#recovery-dialog .dialog__title', (el) => el.textContent), 'No saved project was found, but there is a recovery point.');
      const restore = await indexOf(next, '#recovery-dialog .dialog__buttons button', 'Restore the recovery point');
      await tap(next, '#recovery-dialog .dialog__buttons button', { index: restore });
      await waitForSection(next, 'project');
      assert.equal(await next.evaluate(() => globalThis.sv2.store.project.settings.schoolName), SCHOOL);
      assert.match(await next.$eval('.school__text', (el) => el.textContent), new RegExp(SCHOOL));
      await onlyTouch(next, 'the recovery dialog');
      assert.deepEqual(errors, []);
      assert.deepEqual(offsite, []);
    } finally {
      await next.close();
    }
  });
}

// ---------------------------------------------------------------- 5. the lists a finger picks from

// Every option `selector` names is a target a finger can take: at least 44
// px in its smaller side, its text inside its box, and its words apart: a
// name and its detail (two spans) on one line with a gap between them, or on
// two lines. app.css gives every .picker__option on a coarse pointer
// display: flex (SV2-32h2), which also reaches the Building search's results
// and the grid sheet's rooms; a flex item's leading space is dropped, so the
// gap is the rule's column-gap.
async function fitsAFinger(page, selector, what) {
  const options = await page.$$eval(selector, (all) => all.map((el) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const parts = Array.from(el.children).map((child) => child.getBoundingClientRect());
    const [a, b] = parts;
    return {
      label: el.textContent.trim().slice(0, 50),
      width: box.width,
      height: box.height,
      inside: text.left >= box.left - 0.5 && text.right <= box.right + 0.5 && text.top >= box.top - 0.5 && text.bottom <= box.bottom + 0.5,
      parts: parts.length,
      apart: parts.length < 2 ? null : b.top >= a.bottom - 1 ? 'two lines' : b.left - a.right,
    };
  }));
  assert.ok(options.length > 0, what + ': no option is on the page');
  for (const option of options) {
    assert.ok(Math.min(option.width, option.height) >= FINGER, what + ' under ' + FINGER + ' px: "' + option.label + '" is ' + Math.round(option.width) + ' by ' + Math.round(option.height));
    assert.ok(option.inside, what + ': the text of "' + option.label + '" runs out of its box');
    if (option.parts >= 2) assert.ok(option.apart === 'two lines' || option.apart >= 2, what + ': the name and the detail of "' + option.label + '" run together (' + option.apart + ' px apart)');
  }
  return options;
}

// What was measured, in one line: the smallest side, and the least gap between a name and its detail.
const measured = (what, options) => what + ': ' + options.length + ' options, smallest side ' + Math.round(Math.min(...options.map((o) => Math.min(o.width, o.height)))) + ' px'
  + (options.some((o) => o.parts >= 2) ? ', name to detail ' + options.filter((o) => o.parts >= 2).map((o) => (o.apart === 'two lines' ? 'two lines' : Math.round(o.apart * 10) / 10 + ' px')).filter((v, i, all) => all.indexOf(v) === i).join(' or ') : '');

// A finger that lands on an option and swipes the list or the page: it
// picks nothing, so a swipe leaves what `state` reads as it was.
async function swipeFromOption(page, selector, index, state, what) {
  const at = await reveal(page, selector, index);
  const before = await state();
  await swipeOnly(page, { x: at.x, y: at.y }, 0, 40);
  await settle(page);
  assert.deepEqual(await state(), before, what + ': a swipe that began on an option picked it');
}

test('the Building search\'s results and the grid sheet\'s rooms by touch at 390 by 844: each option 44 px with its words apart, a swipe that starts on one picks nothing, a tap picks it', async (t) => {
  await finish(await phonePlanner('#building'), async (page) => {
    // the search: its mark tapped, a number typed, the results measured
    await tap(page, '#search');
    await page.waitForFunction(() => document.activeElement === document.getElementById('search'), { timeout: 5000 });
    await page.keyboard.type('10');
    const results = '#search-results [role="option"]';
    await page.waitForSelector(results);
    await settle(page, '#search-results');
    const found = await fitsAFinger(page, results, 'a result of the Building search');
    t.diagnostic(measured('search', found));
    assert.ok(found.length >= 2 && found.every((option) => option.parts === 2), 'the case needs two results with a detail each: ' + JSON.stringify(found));
    const searchState = () => page.evaluate(() => ({ hash: location.hash, open: !document.getElementById('search-results').hidden }));
    await swipeFromOption(page, results, 1, searchState, 'the Building search');
    const wanted = await page.$$eval(results, (all) => all[1].dataset.room);
    await tap(page, results, { index: 1 });
    await page.waitForFunction((room) => location.hash.endsWith('?room=' + room), { timeout: 5000 }, wanted);

    // the grid sheet: a slot's cell tapped, tapped again to edit, its rooms measured
    await tap(page, '.rail__item[data-section="schedule"]');
    await waitForSection(page, 'schedule');
    await tap(page, '#surface [role="tab"][data-tab="grid"]');
    await page.waitForSelector('.grd-table');
    const slot = await page.evaluate((day) => {
      const group = globalThis.sv2.store.project.groups[0];
      return { key: 'grid:' + group.id + ':' + day + ':1', room: group.days[day][1].room };
    }, DAY_A);
    const cell = '[data-key="' + slot.key + '"]';
    await tap(page, cell);
    await page.waitForFunction((wanted) => document.activeElement === document.querySelector(wanted), { timeout: 5000 }, cell);
    await tap(page, cell);
    const rooms = '.grd-list:not([hidden]) .picker__option';
    await page.waitForSelector(rooms);
    await settle(page, '.grd-list');
    t.diagnostic(measured('grid sheet', await fitsAFinger(page, rooms, 'a room in the grid sheet\'s list')));
    const gridState = () => page.evaluate(() => ({ staged: document.querySelector('.grd').dataset.staged, open: Boolean(document.querySelector('.grd-list:not([hidden])')) }));
    const other = await page.$$eval(rooms, (all, now) => all.findIndex((el, index) => index > 0 && el.dataset.room !== now), slot.room);
    assert.notEqual(other, -1, 'the case needs a room other than the cell\'s');
    await swipeFromOption(page, rooms, other, gridState, 'the grid sheet');
    const number = await page.$$eval(rooms, (all, at) => all[at].textContent.split(' — ')[0], other);
    await tap(page, rooms, { index: other });
    await page.waitForFunction(() => document.querySelector('.grd').dataset.staged === 'true', { timeout: 5000 });
    assert.equal(await page.$eval(cell + ' .grd-cell__text', (el) => el.textContent), number);
    await onlyTouch(page, 'the lists');
  });
});
