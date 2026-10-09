// The first milestone's design and journey pass: node test/browser/m1-pass.mjs
//
// What a counsellor meets first. The keyboard reaches the plan through the
// shell (F6, the skip link, a card or a message going away), the Building
// section is usable on a 390 px phone, the plan is drawn in the theme on
// screen, messages sit clear of the controls, the inspector folds to a strip
// and is a sheet along the bottom of a narrow window, the floor's level can
// be typed, and an open print sheet is what Ctrl+P puts on paper.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openPlanner, go, launch, startServer, TOOL_DIR } from './harness.mjs';
import { planReady, state, point } from './draw-pointer.mjs';

const source = (file) => readFileSync(path.join(TOOL_DIR, ...file.split('/')), 'utf8');

let server;
let browser;
let wide; // 1280 by 800, a mouse
let phone; // 390 by 844, a finger
let page;
let wideClosed = false;
let wideProblems = null;

const frames = (target) => target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// An empty project as a new device has it: nothing drawn, Getting started showing.
async function newProject(target) {
  await target.evaluate(async () => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const { newProject: make } = await import('./engine/schema.js');
    const { createIds, seededRandom } = await import('./engine/ids.js');
    store.apply(actions.replaceProject, { project: make(createIds(seededRandom(8)), () => new Date('2026-09-01T12:00:00Z')), label: 'Start an empty project' });
    if (!location.hash.startsWith('#building')) location.hash = '#building';
    document.querySelector('.toast__close')?.click();
  });
  await planReady(target);
}

async function blurAll(target) {
  await target.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
}

const focusId = (target) => target.evaluate(() => (document.activeElement ? document.activeElement.id : ''));

// Where things are in the window, by name.
function boxes(target) {
  return target.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0 ? null : { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      window: { width: window.innerWidth, height: window.innerHeight },
      topbar: box('#topbar'),
      tabs: box('.bld-floors'),
      strip: box('.bld-strip'),
      stage: box('.bld-stage'),
      status: box('.bld-status'),
      inspector: box('#inspector'),
      inspectorBody: box('#inspector-body'),
      handle: box('#inspector-toggle'),
      rail: box('#rail'),
      card: box('#empty-floor'),
      started: box('#getting-started'),
      toast: box('.toast'),
      tools: Array.from(document.querySelectorAll('.bld-tool'), (el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.tool, left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
      }),
    };
  });
}

const overlaps = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (inner, outer) => inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;

// The colour the canvas shows at the middle of a cell, as it stands: nothing
// here asks the plan to draw.
function shown(target, x, y) {
  return target.evaluate((cx, cy) => {
    const editor = document.querySelector('.bld').editor;
    const at = editor.view.toScreen(cx + 0.5, cy + 0.5);
    const ratio = editor.canvas.width / editor.view.width;
    const data = editor.canvas.getContext('2d').getImageData(Math.round(at.x * ratio), Math.round(at.y * ratio), 1, 1).data;
    return '#' + [data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, '0')).join('');
  }, x, y);
}

// A cell of the floor on screen that holds `what`: '.', '#' or 'S'. Away from
// the edge, so the middle of the cell is on the canvas.
function cellOf(target, what) {
  return target.evaluate((wanted) => {
    const { floor, view } = document.querySelector('.bld').editor;
    const owned = new Set(floor.spaces.flatMap((space) => space.cells));
    for (let i = 0; i < floor.cells.length; i += 1) {
      if (floor.cells[i] !== wanted || owned.has(i)) continue;
      const x = i % floor.width;
      const y = Math.floor(i / floor.width);
      const at = view.toScreen(x + 0.5, y + 0.5);
      if (at.x > 4 && at.y > 4 && at.x < view.width - 4 && at.y < view.height - 4) return [x, y];
    }
    return null;
  }, what);
}

const token = (target, name) => target.evaluate((wanted) => getComputedStyle(document.documentElement).getPropertyValue('--' + wanted).trim().toLowerCase(), name);

before(async () => {
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ server, browser, theme: 'light', width: 1280, height: 800 });
  page = wide.page;
  await planReady(page);
});

after(async () => {
  if (phone) await phone.close();
  if (wide && !wideClosed) await wide.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- the keyboard reaches the plan

test('from a fresh page, F6 to the section puts the keyboard on the plan, and c, the arrows, Shift and the arrows, r, a number and Enter draw a corridor and a numbered room', async () => {
  await newProject(page);
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), false, 'a new project shows Getting started');
  await blurAll(page);
  const stops = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('F6');
    stops.push(await focusId(page));
  }
  assert.deepEqual(stops, ['rail', 'topbar', 'plan'], 'the third stop of F6 is the plan, not the region round it');
  assert.deepEqual((await state(page)).cursor, [20, 15], 'the cursor is not showing on the plan');

  const before = (await state(page)).entries;
  await page.keyboard.press('c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  assert.equal((await state(page)).entries, before + 1, 'Shift and the arrows drew nothing');
  await page.keyboard.press('r');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  assert.equal(await focusId(page), 'room-number', 'the new room\'s number does not have the focus');
  await page.keyboard.type('204');
  await page.keyboard.press('Enter');
  assert.equal(await focusId(page), 'plan', 'Enter in the number did not go back to the plan');
  const drawn = await page.evaluate(() => {
    const floor = globalThis.sv2.store.project.building.floors[0];
    return { corridor: (floor.cells.match(/#/g) || []).length, rooms: floor.spaces.map((space) => [space.number, space.cells.length]) };
  });
  assert.deepEqual(drawn, { corridor: 6, rooms: [['204', 3]] });
});

test('with Getting started showing, the section\'s stop of F6 rings the plan: the scroll region round the column is not what looks selected', async () => {
  await blurAll(page);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('F6');
  const ring = await page.evaluate(() => ({
    started: !document.getElementById('getting-started').hidden,
    surface: document.getElementById('surface').matches(':focus-visible'),
    plan: document.getElementById('plan').matches(':focus-visible'),
    planOutline: getComputedStyle(document.getElementById('plan')).outlineStyle,
    column: getComputedStyle(document.getElementById('getting-started')).outlineStyle,
  }));
  assert.deepEqual(ring, { started: true, surface: false, plan: true, planOutline: 'solid', column: 'none' });
});

test('Dismiss on Getting started, the skip link, and a message closed from the keyboard each leave the keyboard on the plan', async () => {
  await page.focus('#getting-started [data-action="dismiss"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#getting-started', (el) => el.hidden), true);
  assert.equal(await focusId(page), 'plan', 'dismissing the card left the keyboard beside the plan');
  // the message that says so: its close button has the focus, then it goes
  await page.keyboard.press('F6');
  await page.keyboard.press('F6');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'toast__close');
  await page.keyboard.press('Enter');
  assert.equal(await focusId(page), 'plan', 'closing the message left the keyboard beside the plan');
  await page.focus('.skip');
  await page.keyboard.press('Enter');
  assert.equal(await focusId(page), 'plan', 'the skip link did not go to the plan');
  // a section with no surface of its own still takes the focus as a region
  await go(page, '#project');
  await blurAll(page);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('F6');
  assert.equal(await focusId(page), 'surface');
  await go(page, '#building');
  await planReady(page);
});

// ---------------------------------------------------------------- the theme on the plan

test('the plan takes the dark theme the moment it is chosen, and the device\'s own change while the planner follows it: the field and the corridors are drawn in the theme\'s colours', async () => {
  await page.evaluate(async () => {
    const { replaceProject } = await import('./engine/actions.js');
    const { sampleSchool } = await import('./data/sample-school.js');
    globalThis.sv2.store.apply(replaceProject, { project: sampleSchool(), label: 'Load the sample school' });
  });
  await planReady(page);
  const empty = await cellOf(page, '.');
  const corridor = await cellOf(page, '#');
  assert.ok(empty && corridor, 'the sample floor has an empty cell and a corridor cell on screen');
  const setTheme = (theme) => page.evaluate(async (value) => {
    const { setSetting } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(setSetting, { key: 'theme', value });
  }, theme);
  const colours = async () => ({ field: await shown(page, empty[0], empty[1]), corridor: await shown(page, corridor[0], corridor[1]) });

  await setTheme('light');
  await frames(page);
  assert.deepEqual(await colours(), { field: '#e8e3d8', corridor: '#ffffff' });
  await setTheme('dark');
  await frames(page);
  assert.equal(await token(page, 'grid'), '#1a1e23');
  assert.deepEqual(await colours(), { field: '#1a1e23', corridor: '#2a2f36' }, 'the plan kept the light colours under the dark theme');

  // following the device: nothing in the project changes when the device goes dark
  await setTheme('auto');
  await frames(page);
  assert.deepEqual(await colours(), { field: '#e8e3d8', corridor: '#ffffff' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await frames(page);
  assert.deepEqual(await colours(), { field: '#1a1e23', corridor: '#2a2f36' }, 'the device went dark and the plan was not drawn again');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await frames(page);
  assert.deepEqual(await colours(), { field: '#e8e3d8', corridor: '#ffffff' });
  await setTheme('light');
});

// ---------------------------------------------------------------- messages keep clear of the controls

test('a message on the Building section is over the plan\'s corner: not on the tool strip, the status line, the inspector or the rail', async () => {
  await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'Getting started is hidden. Help brings it back.' }));
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const at = await boxes(page);
  assert.ok(at.toast, 'the message is on the page');
  for (const name of ['strip', 'status', 'inspector', 'rail', 'topbar']) assert.equal(overlaps(at.toast, at[name]), false, 'the message is over the ' + name);
  assert.equal(inside(at.toast, at.stage), true, 'the message is not inside the plan\'s own area');
  assert.ok(at.status.top - at.toast.bottom >= 8, 'the message touches the status line');
  await page.click('.toast__close');
  // and on a section that is a page it is at the bottom left of the surface
  await go(page, '#project');
  await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'A message.' }));
  // a message rises into place over 120 ms; it is measured where it stops
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const there = await page.evaluate(() => {
    const toast = document.querySelector('.toast').getBoundingClientRect();
    const surface = document.getElementById('surface').getBoundingClientRect();
    return { left: Math.round(toast.left - surface.left), bottom: Math.round(surface.bottom - toast.bottom) };
  });
  assert.deepEqual(there, { left: 16, bottom: 16 });
  await page.click('.toast__close');
  await go(page, '#building');
  await planReady(page);
});

// ---------------------------------------------------------------- the inspector folds

test('the inspector folds to a 32 px strip with an icon for each of its tabs, the plan takes the room, and an icon opens the panel at its tab', async () => {
  const before = await boxes(page);
  assert.equal(before.inspector.width, 320);
  assert.equal(await page.$eval('#inspector-toggle', (el) => el.getAttribute('aria-expanded')), 'true');
  await page.click('#inspector-toggle');
  await frames(page);
  const folded = await boxes(page);
  assert.equal(folded.inspector.width, 32, 'the folded inspector is not a 32 px strip');
  assert.equal(folded.inspectorBody, null, 'the panel is still on the page');
  assert.equal(folded.stage.width, before.stage.width + 288, 'the plan did not take the room the panel left');
  assert.equal(await page.$eval('#inspector-toggle', (el) => el.getAttribute('aria-expanded')), 'false');
  const icons = await page.$$eval('.inspector__icon', (all) => all.map((el) => [el.dataset.openTab, el.getAttribute('aria-label'), Math.round(el.getBoundingClientRect().width), el.querySelector('svg') !== null]));
  assert.deepEqual(icons, [['properties', 'Properties', 32, true], ['rooms', 'Rooms', 32, true], ['floor', 'Floor', 32, true], ['checks', 'Checks', 32, true], ['exits', 'Exits', 32, true]]);
  await page.click('.inspector__icon[data-open-tab="rooms"]');
  await frames(page);
  assert.equal((await boxes(page)).inspector.width, 320);
  assert.equal(await page.$eval('.bld-inspector [role="tab"][aria-selected="true"]', (el) => el.dataset.tab), 'rooms');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'rooms', 'the tab that was asked for has the focus');
  // folded again, a room drawn with the mouse opens it for the number
  await page.click('#inspector-toggle');
  await newProject(page);
  await page.evaluate(() => document.querySelector('#getting-started [data-action="dismiss"]').click());
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.keyboard.press('r');
  const at = await point(page, 12, 8);
  await page.mouse.click(at.x, at.y);
  assert.equal(await focusId(page), 'room-number');
  assert.equal(await page.$eval('#inspector', (el) => el.dataset.open), 'true', 'the number field has the focus inside a folded panel');
  assert.match(await page.$eval('.inspector__title', (el) => el.textContent), /^Inspector: /);
});

test('under 900 px the inspector is a sheet along the bottom: shut until its handle is used, then at most half the window, with the plan above it', async () => {
  await page.setViewport({ width: 800, height: 800 });
  await frames(page);
  const shut = await boxes(page);
  assert.equal(await page.$eval('#inspector', (el) => el.dataset.mode + ':' + el.dataset.open), 'sheet:false');
  assert.equal(shut.inspectorBody, null);
  assert.ok(shut.inspector.top >= shut.status.bottom - 1, 'the sheet is not under the plan\'s status line');
  assert.equal(shut.inspector.right - shut.inspector.left, 800 - shut.rail.width, 'the sheet does not run the width of the section');
  assert.ok(shut.inspector.height <= 48, 'the shut sheet is more than its handle: ' + shut.inspector.height);
  await page.click('#inspector-toggle');
  await frames(page);
  const open = await boxes(page);
  assert.ok(open.inspectorBody && open.inspectorBody.height > 100, 'the sheet did not open');
  assert.ok(open.inspector.height <= 400, 'the open sheet is more than half the window: ' + open.inspector.height);
  assert.ok(open.stage.height >= 150, 'the plan has ' + open.stage.height + ' px left above the open sheet');
  assert.equal(overlaps(open.inspector, open.stage), false, 'the sheet lies over the plan');
  await page.click('#inspector-toggle');
  await page.setViewport({ width: 1280, height: 800 });
  await frames(page);
  assert.equal(await page.$eval('#inspector', (el) => el.dataset.mode + ':' + el.dataset.open), 'wide:true', 'wide again, the panel is as it was left when wide');
});

// ---------------------------------------------------------------- the floor's level

test('the Floor tab has the floor\'s level: a whole number typed there is one undo step, and anything else is refused under the field', async () => {
  await page.evaluate(() => document.querySelector('.bld').editor.inspector.showTab('floor'));
  assert.equal(await page.$eval('#floor-level', (el) => el.value), '1');
  assert.match(await page.$eval('#floor-level-hint', (el) => el.textContent), /Stairs take longer for each level they change/);
  const versionBefore = await page.evaluate(() => globalThis.sv2.store.geometryVersion);
  await page.click('#floor-level', { clickCount: 3 });
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => ({ level: globalThis.sv2.store.project.building.floors[0].level, label: globalThis.sv2.store.undoLabel, geometry: globalThis.sv2.store.geometryVersion }));
  assert.deepEqual({ level: after.level, label: after.label }, { level: 3, label: 'Change the level of Floor 1' });
  assert.ok(after.geometry > versionBefore, 'a level changes what the stairs cost, so the routes are worked out again');
  await page.click('#floor-level', { clickCount: 3 });
  await page.keyboard.type('top');
  await page.keyboard.press('Enter');
  assert.match(await page.$eval('#floor-level-refusal', (el) => (el.hidden ? '' : el.textContent)), /A level is a whole number/);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].level), 3);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#floor-level', (el) => el.value), '3');
  await page.click('#undo');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].level), 1);
  await frames(page);
  assert.equal(await page.$eval('#floor-level', (el) => el.value), '1', 'the field did not follow the undo');
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
});

// ---------------------------------------------------------------- what the page links, and printing

test('index.html links the building inspector\'s stylesheet and the print sheet: both are loaded before Building or a preview has been opened, and neither is linked twice', async () => {
  assert.match(source('index.html'), /<link rel="stylesheet" href="ui\/building\/inspector\/inspector\.css" data-sheet="building-inspector">/);
  assert.match(source('index.html'), /<link rel="stylesheet" href="ui\/print\.css" data-sheet="print">/);
  assert.match(source('index.html'), /<link rel="stylesheet" href="ui\/building\/building\.css">/);
  assert.match(source('index.html'), /<link rel="stylesheet" href="ui\/schedule\/schedule\.css" data-sheet="schedule">/);
  const fresh = await openPlanner({ server, browser, hash: '#project', width: 1280, height: 800 });
  try {
    const linked = () => fresh.page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (link) => [link.getAttribute('href').replace(/^.*\/ui\//, 'ui/'), link.sheet !== null]).filter(([href]) => /inspector\.css$|print\.css$/.test(href)));
    assert.deepEqual(await linked(), [['ui/building/inspector/inspector.css', true], ['ui/print.css', true]]);
    await go(fresh.page, '#building');
    await planReady(fresh.page);
    assert.deepEqual(await linked(), [['ui/building/inspector/inspector.css', true], ['ui/print.css', true]], 'opening Building put a second link in the page');
  } finally {
    await fresh.close();
  }
});

test('a button that cannot be used yet is styled by ui/app.css, on any section', async () => {
  assert.match(source('ui/app.css'), /\.btn\[aria-disabled="true"\] \{\n  border-style: dashed;/);
  assert.doesNotMatch(source('ui/schedule/schedule.css').replace(/\/\*[\s\S]*?\*\//g, ''), /^\.btn\[aria-disabled/m, 'the Schedule section\'s sheet still carries the shell\'s rule');
  const style = await page.evaluate(() => {
    const button = document.createElement('button');
    button.className = 'btn';
    button.setAttribute('aria-disabled', 'true');
    document.getElementById('surface').append(button);
    const found = getComputedStyle(button).borderTopStyle;
    button.remove();
    return found;
  });
  assert.equal(style, 'dashed');
});

test('with a print sheet open, printing the page leaves the planner off the paper and prints the sheet without its controls', async () => {
  const display = () => page.evaluate(() => ({
    planner: getComputedStyle(document.getElementById('app')).display,
    head: document.querySelector('.preview__head') ? getComputedStyle(document.querySelector('.preview__head')).display : null,
    sheet: document.querySelector('dialog.preview') ? getComputedStyle(document.querySelector('dialog.preview')).display : null,
  }));
  await page.emulateMediaType('print');
  assert.equal((await display()).planner, 'block', 'with no sheet open the page prints as before');
  await page.emulateMediaType('screen');
  await page.evaluate(async () => {
    const { openPrintPreview } = await import('./ui/components/print-preview.js');
    openPrintPreview(globalThis.sv2.ctx, 'room-list', {});
  });
  await page.waitForFunction(() => document.querySelector('dialog.preview[open]')?.dataset.ready === 'true', { timeout: 15000 });
  assert.equal((await display()).planner, 'grid', 'on screen the planner stays behind the sheet');
  await page.emulateMediaType('print');
  assert.deepEqual(await display(), { planner: 'none', head: 'none', sheet: 'block' });
  await page.emulateMediaType('screen');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog.preview') === null);
});

// ---------------------------------------------------------------- a 390 px phone

test('on a 390 px phone the Building section is the plan: every tool on screen in two rows under the floor tabs, the plan above the status line, nothing to scroll', async () => {
  // one planner at a time: a second tab on the same project is read-only
  wideProblems = wide.problems();
  await wide.close();
  wideClosed = true;
  phone = await openPlanner({ server, browser, theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  await planReady(p);
  await p.evaluate(() => document.querySelector('#getting-started [data-action="dismiss"]').click());
  await p.evaluate(() => document.querySelector('.toast__close')?.click());
  await frames(p);
  const at = await boxes(p);
  assert.equal(at.tools.length, 11);
  for (const tool of at.tools) {
    assert.ok(inside(tool, at.strip) && tool.right <= 390 && tool.bottom <= 844, 'the ' + tool.id + ' tool is not on screen');
    assert.ok(tool.width >= 44 && tool.height >= 44, 'the ' + tool.id + ' tool is ' + tool.width + ' by ' + tool.height + ', too small for a finger');
  }
  assert.equal(new Set(at.tools.map((tool) => tool.top)).size, 2, 'the tools are not in two rows');
  assert.deepEqual(await p.$eval('.bld-strip', (el) => [el.scrollWidth <= el.clientWidth, el.scrollHeight <= el.clientHeight, el.getAttribute('aria-orientation')]), [true, true, 'horizontal'], 'the strip scrolls');
  assert.ok(at.strip.top >= at.tabs.bottom - 1 && at.strip.bottom <= at.stage.top + 1, 'the strip is not between the floor tabs and the plan');
  assert.equal(at.stage.width, 390, 'the plan is not the width of the phone');
  assert.ok(at.stage.height >= 380, 'the plan is ' + at.stage.height + ' px high');
  assert.ok(at.status.top >= at.stage.bottom - 1 && at.status.height <= 120, 'the status line is ' + at.status.height + ' px high');
  assert.ok(at.rail.top >= at.inspector.bottom - 1 && at.inspector.top >= at.status.bottom - 1, 'the sheet\'s handle is not between the plan and the bottom bar');
  assert.equal(at.inspectorBody, null, 'the sheet starts shut');
  assert.deepEqual(await p.evaluate(() => {
    const surface = document.getElementById('surface');
    return [document.documentElement.scrollWidth <= window.innerWidth, surface.scrollHeight <= surface.clientHeight, document.getElementById('topbar').getBoundingClientRect().height <= 100];
  }), [true, true, true], 'the page scrolls, or the top bar is more than two rows');
  // the counts are there in few words, and every one of them is on the line
  const counts = await p.$$eval('#plan-counts li', (all) => all.map((li) => {
    const r = li.getBoundingClientRect();
    const host = document.getElementById('plan-counts').getBoundingClientRect();
    return [li.dataset.short, r.right <= host.right + 1 && r.bottom <= host.bottom + 1];
  }));
  assert.equal(counts.length, 5);
  for (const [short, fits] of counts) assert.ok(fits, '"' + short + '" is cut off in the status line');
});

test('on the phone a new project\'s empty-floor card fits the plan whole, with Getting started folded to a line above it', async () => {
  const p = phone.page;
  await newProject(p);
  await frames(p);
  const at = await boxes(p);
  assert.ok(at.started && at.started.height <= 64, 'Getting started is ' + (at.started && at.started.height) + ' px high above the plan');
  assert.equal(await p.$eval('#getting-started [data-action="steps"]', (el) => el.getAttribute('aria-expanded') + ':' + el.textContent), 'false:Show the steps');
  assert.equal(await p.$eval('#getting-started .steps', (el) => el.getBoundingClientRect().height), 0, 'the steps show while folded');
  assert.ok(at.stage.height >= 340, 'the plan is ' + at.stage.height + ' px high under the folded card');
  assert.ok(at.card, 'the empty floor\'s card is showing');
  assert.equal(inside(at.card, at.stage), true, 'the card runs past the plan');
  assert.deepEqual(await p.$eval('#empty-floor', (el) => [el.scrollHeight <= el.clientHeight, Array.from(el.querySelectorAll('button'), (button) => button.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom).every(Boolean)]), [true, true], 'the card is clipped');
  // unfolded, the steps are there and the page still does not scroll
  await p.click('#getting-started [data-action="steps"]');
  await frames(p);
  const open = await boxes(p);
  assert.ok(await p.$eval('#getting-started .steps', (el) => el.getBoundingClientRect().height) > 100, 'the steps did not unfold');
  assert.ok(open.started.height <= 422, 'the unfolded card is more than half the window');
  assert.equal(await p.evaluate(() => document.getElementById('surface').scrollHeight <= document.getElementById('surface').clientHeight), true, 'the page scrolls under a finger that can only draw');
  await p.click('#getting-started [data-action="steps"]');
});

test('on the phone a message is over the plan, clear of the tools, the status line, the sheet and the bottom bar', async () => {
  const p = phone.page;
  await p.evaluate(() => document.querySelector('#getting-started [data-action="dismiss"]').click());
  await frames(p);
  const at = await boxes(p);
  assert.ok(at.toast, 'dismissing the card says so');
  for (const name of ['strip', 'status', 'inspector', 'rail', 'topbar']) assert.equal(overlaps(at.toast, at[name]), false, 'the message is over the ' + name);
  assert.ok(at.toast.left >= 0 && at.toast.right <= 390, 'the message runs off the phone');
  await p.evaluate(() => document.querySelector('.toast__close')?.click());
});

test('on the phone the sheet opens from its handle with the plan still above it, and a room drawn with a finger does not open it', async () => {
  const p = phone.page;
  await p.evaluate(() => document.getElementById('inspector-toggle').click());
  await frames(p);
  const open = await boxes(p);
  assert.ok(open.inspectorBody && open.inspector.height <= 422, 'the open sheet is ' + open.inspector.height + ' px of 844');
  assert.ok(open.stage.height >= 100, 'the plan has ' + open.stage.height + ' px above the open sheet');
  assert.equal(await p.evaluate(() => document.getElementById('surface').scrollHeight <= document.getElementById('surface').clientHeight), true);
  await p.evaluate(() => document.getElementById('inspector-toggle').click());
  await frames(p);
  await p.keyboard.press('r');
  const at = await point(p, 12, 8);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].spaces.length === 1);
  assert.equal(await p.$eval('#inspector', (el) => el.dataset.open), 'false', 'the sheet rose over the plan for a room drawn by a finger');
  assert.notEqual(await focusId(p), 'room-number');
  assert.equal(await p.$eval('.inspector__title', (el) => el.textContent), 'Inspector: a room with no number');
});

test('after all of that neither page has logged an error', () => {
  assert.deepEqual(wideProblems, { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(phone.problems(), { errors: [], blocked: [], shimmed: [] });
});
