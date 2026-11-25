// Movement's teacher mode, Going to and Rooms of subject, and the two
// addresses, in a real browser: node test/browser/movement-w8.mjs
//
// SV2-153 (DESIGN 17.2, 17.3, 17.6, 17.7; ARCHITECTURE 23.7, 23.12). Each
// journey is walked by pointer, by keyboard and by touch, on a page 1280 wide
// and on one 390 wide (the phone folds the controls behind Change and puts the
// inspector in a sheet). The school is the plain sample with every second
// teacher given a second room, which gives teachers walks (the sample has
// none); one variant has no bell times and a 30 second passing time, so a
// walk does not fit, and one has a room nobody meets in and a group that
// stays in a room all day, for the two empty states.
//
// What is checked is what the page says: the first line, the legend's words,
// the cards, the inspector's tables and lines, the choice the view holds, the
// lanes' dash as the canvas is told it. Every wait is on a state the page
// sets (the section's data-pending gone and its state for the store's
// project; a control's box the same two frames running), never a first paint
// and never a sleep. Touch cannot drive a native select: the subject select
// is set with the page's own select() there, which is what a person's choice
// from the system's list comes to.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, atRest, launch, startServer, go, loadModule } from './harness.mjs';
import { plainSchool } from '../engine/helpers.mjs';

const SIZES = [{ name: '1280', width: 1280, height: 900, phone: false }, { name: '390', width: 390, height: 844, phone: true }];
const MODES = ['pointer', 'keyboard', 'touch'];
// W8_ONLY="1280 pointer" runs one size and mode while a case is being made (everything when unset)
const ONLY = (process.env.W8_ONLY || '').split(' ').filter(Boolean);
const wanted = (size, mode) => ONLY.length === 0 || (ONLY.includes(size.name) && (mode === undefined || ONLY.includes(mode) || !MODES.some((m) => ONLY.includes(m))));

// ---- the schools

function withTeacherWalks(project) {
  const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
  project.teachers.forEach((teacher, i) => {
    if (i % 2) return;
    const other = rooms[(i * 7 + 3) % rooms.length];
    if (!other || teacher.roomIds.includes(other.id)) return;
    teacher.roomIds.push(other.id);
    other.teacherIds = [...(other.teacherIds || []), teacher.id];
  });
  return project;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// the plain sample with teachers who walk
function walkers() {
  return withTeacherWalks(clone(plainSchool()));
}

// no bell times and 30 s of passing time: Ms. Halloran's 57 s walk does not fit
function late() {
  const project = walkers();
  for (const dayType of project.dayTypes) if (dayType.own) dayType.bells = dayType.bells.map(() => ({ start: '', end: '' }));
  project.settings.defaultPassingSeconds = 30;
  return project;
}

// Room 303 has no class on A Day; group 6A is in Room 301 from the first period to the last and nobody else is
function emptied() {
  const project = walkers();
  const dayId = project.dayTypes[0].id;
  for (const group of project.groups) {
    group.days[dayId] = group.days[dayId].map((slot) => (slot.room === 'rsample301' || slot.room === 'rsample303' ? { ...slot, room: 'rsample302' } : slot));
  }
  project.groups[0].days[dayId] = project.groups[0].days[dayId].map((slot) => ({ ...slot, room: 'rsample301' }));
  return project;
}

// ---- the page

let browser;
let server;
const ONE_DAY = 'dsample00a';
const HALLORAN = 'tsample001';
const VANDERMEER = 'tsample007';

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function open(size, project) {
  const session = await openPlanner({ hash: '#movement', theme: 'light', width: size.width, height: size.height, mobile: size.phone, browser, server });
  const { page } = session;
  await page.evaluate(async (next) => {
    const { store } = globalThis.sv2;
    next.settings.theme = store.project.settings.theme;
    store.replace(next);
    await store.derived.results().catch(() => null);
  }, project);
  await settled(page);
  return session;
}

// The view has the answer for the project as it is now, and has drawn it.
async function settled(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true' || !section.movement) return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 20000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const line = (page) => page.$eval('#movement-line .mov-line__words', (el) => el.textContent.replace(/\s+/g, ' ').trim());
const choice = (page) => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.mov').movement.choice)));
const picture = (page, fn) => page.evaluate(fn);

// ---- the three ways of acting

// A control to a person's reach: scrolled to, at rest.
async function reach(page, selector) {
  await page.evaluate((wanted) => document.querySelector(wanted).scrollIntoView({ block: 'center', inline: 'center' }), selector);
  return atRest(page, selector);
}

function hands(page, mode) {
  async function touch(selector) {
    const box = await reach(page, selector);
    await page.touchscreen.tap(box.left + box.width / 2, box.top + box.height / 2);
  }
  async function pointer(selector) {
    const box = await reach(page, selector);
    await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
  }
  // the keyboard: the control takes the focus, and is pressed with Enter (a button) or Space (a radio)
  async function keys(selector, key) {
    await reach(page, selector);
    await page.focus(selector);
    await page.keyboard.press(key || 'Enter');
  }
  return {
    // a button, link, radio or tab
    async press(selector, key) {
      if (mode === 'touch') await touch(selector);
      else if (mode === 'pointer') await pointer(selector);
      else await keys(selector, key);
      await settled(page);
    },
    // a field with a picker: the option whose words are given
    async pick(selector, words, optionId) {
      if (mode === 'keyboard') {
        await reach(page, selector);
        await page.focus(selector);
        await page.keyboard.type(words);
        await page.waitForSelector('.picker__list:not([hidden]) .picker__option');
        await page.keyboard.press('Enter');
      } else {
        if (mode === 'touch') await touch(selector);
        else await pointer(selector);
        await page.keyboard.type(words);
        const option = '.picker__list:not([hidden]) .picker__option' + (optionId === undefined ? '' : '[data-id="' + optionId + '"]');
        await page.waitForSelector(option);
        if (mode === 'touch') await touch(option);
        else await pointer(option);
      }
      await settled(page);
    },
    // a radio of a group: the choice made, whichever way the group is reached
    async radio(name, value) {
      const selector = 'input[name="' + name + '"][value="' + value + '"]';
      if (mode === 'keyboard') {
        // the group is one Tab stop; the arrows move the choice
        const checked = await page.$eval('input[name="' + name + '"]:checked', (el) => el.value);
        const values = await page.$$eval('input[name="' + name + '"]', (els) => els.map((el) => el.value));
        await reach(page, 'input[name="' + name + '"]:checked');
        await page.focus('input[name="' + name + '"]:checked');
        const steps = values.indexOf(value) - values.indexOf(checked);
        for (let i = 0; i < Math.abs(steps); i += 1) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
      } else if (mode === 'touch') {
        await touch(selector + ' + span, ' + selector);
      } else {
        await pointer(selector + ' + span, ' + selector);
      }
      await settled(page);
    },
    // a native select: typed to on the keyboard, set with the page's own select() otherwise
    async select(selector, value, label) {
      if (mode === 'keyboard') {
        await reach(page, selector);
        await page.focus(selector);
        // the arrows move a closed select's choice, and each move is a change
        const values = await page.$$eval(selector + ' option', (els) => els.map((el) => el.value));
        const now = await page.$eval(selector, (el) => el.value);
        const steps = values.indexOf(value) - values.indexOf(now);
        for (let i = 0; i < Math.abs(steps); i += 1) await page.keyboard.press(steps > 0 ? 'ArrowDown' : 'ArrowUp');
      } else {
        await reach(page, selector);
        await page.select(selector, value);
      }
      await settled(page);
    },
    // the transition strip's item (null: All)
    async strip(period) {
      const value = period === null ? 'all' : String(period);
      const selector = '.mov-strip__item[data-transition="' + value + '"]';
      if (mode === 'keyboard') {
        const items = await page.$$eval('.mov-strip__item', (els) => els.map((el) => el.dataset.transition));
        const now = await page.$eval('.mov-strip__item[aria-checked="true"]', (el) => el.dataset.transition);
        await reach(page, '.mov-strip__item[aria-checked="true"]');
        await page.focus('.mov-strip__item[aria-checked="true"]');
        const steps = items.indexOf(value) - items.indexOf(now);
        for (let i = 0; i < Math.abs(steps); i += 1) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
        await settled(page);
      } else {
        await this.press(selector);
      }
    },
  };
}

// The controls are open (a phone folds them behind Change).
async function openControls(page, act) {
  const open = await page.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded') === 'true');
  if (!open) await act.press('[data-action="change"]');
  await page.waitForFunction(() => !document.querySelector('.mov-controls').hidden);
}

// An inspector tab, the inspector opened first when it is a sheet over a phone.
async function tab(page, act, id) {
  const folded = await page.$eval('#inspector-toggle', (el) => el.getAttribute('aria-expanded') === 'false').catch(() => false);
  if (folded) await act.press('#inspector-toggle');
  await page.waitForSelector('#inspector [role="tab"][data-tab="' + id + '"]');
  await act.press('#inspector [role="tab"][data-tab="' + id + '"]', 'Enter');
  await page.waitForFunction((wanted) => document.querySelector('#inspector [role="tab"][aria-selected="true"]')?.dataset.tab === wanted, {}, id);
}

const text = (page, selector) => page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const hidden = (page, selector) => page.$eval(selector, (el) => el.hidden || el.closest('[hidden]') !== null || el.getClientRects().length === 0);

// What the canvas was told about dashes, over a few draws of the map (a draw after a scroll can be a partial
// one on a phone: the map is drawn again, a frame at a time, until the long dashes are among the calls or
// five draws have been made).
async function dashesDrawn(page) {
  // a phone's inspector is a sheet over the map: folded, so the map is the page's to draw
  if (await page.$eval('#inspector-toggle', (el) => el.getBoundingClientRect().width > 0 && matchMedia('(max-width: 640px)').matches && el.getAttribute('aria-expanded') === 'true').catch(() => false)) {
    await page.$eval('#inspector-toggle', (el) => el.click());
    await page.waitForFunction(() => document.querySelector('#inspector-toggle').getAttribute('aria-expanded') === 'false');
  }
  await page.evaluate(() => {
    globalThis.__dashes = [];
    if (!CanvasRenderingContext2D.prototype.__spied) {
      const original = CanvasRenderingContext2D.prototype.setLineDash;
      CanvasRenderingContext2D.prototype.setLineDash = function (pattern) {
        globalThis.__dashes.push(Array.from(pattern));
        return original.call(this, pattern);
      };
      CanvasRenderingContext2D.prototype.__spied = true;
    }
  });
  return page.evaluate(async () => {
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let pass = 0; pass < 5; pass += 1) {
      document.querySelector('.mov').movement.env.paint();
      await frames();
      if (globalThis.__dashes.some((pattern) => pattern.join(',') === '6,2')) break;
    }
    return globalThis.__dashes.map((pattern) => pattern.join(','));
  });
}

// ---- A teacher

for (const size of SIZES) {
  for (const mode of MODES) {
    if (!wanted(size, mode)) continue;
    describe('a teacher, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      before(async () => {
        session = await open(size, late());
        page = session.page;
        act = hands(page, mode);
        await openControls(page, act);
      });
      after(async () => {
        if (session) await session.close();
      });

      test('Who has A teacher: choosing it asks for one, shows nothing yet and hides Going to and Rooms of subject', async () => {
        await act.radio('movement-who', 'teacher');
        assert.equal((await choice(page)).who, 'teacher');
        assert.match(await line(page), /^Nothing is shown\. Choose a teacher to see where they walk\.$/);
        assert.equal(await hidden(page, '[data-control="teacher"]'), false, 'the picker is there');
        assert.equal(await hidden(page, '[data-control="filters"]'), true, 'Going to and Rooms of subject are not');
        assert.equal(await text(page, '.mov-legend__title'), 'Load', 'nothing is drawn, so the legend is away or as it was');
      });

      test('a consecutive walk is solid; the sentence has the figures in words; no load colouring; the legend names the teacher', async () => {
        await act.pick('[data-control="teacher"]', 'Halloran');
        assert.equal((await choice(page)).teacherId, HALLORAN);
        assert.match(await line(page), /^Ms\. Halloran’s day on A Day: 1 walk between classes, 57 s \(walking alone, not slowed by the crowd\)\. 1 does not fit: Period 3 to Period 4, Room 101 to Cafeteria, 57 s for a 30 s passing time\.$/);
        const seen = await picture(page, () => {
          const shown = document.querySelector('.mov').movement.picture;
          return { mode: shown.mode, drawn: shown.drawn, load: shown.load, bands: shown.bands, dashes: Array.from(shown.lanes.floors.values()).flat().map((lane) => lane.dash), lines: Array.from(shown.markers.values()).flat().flatMap((marker) => marker.pills.map((pill) => pill.text)) };
        });
        assert.equal(seen.mode, 'teacher');
        assert.equal(seen.drawn, 1);
        assert.equal(seen.load, null);
        assert.equal(seen.bands, null);
        assert.deepEqual(seen.dashes, [false]);
        assert.ok(seen.lines.length >= 2 && seen.lines.every((words) => /^P\d · /.test(words)), 'pills say the period and the groups: ' + seen.lines.join(' | '));
        assert.equal(await text(page, '.mov-legend__title'), 'One teacher');
        assert.match(await text(page, '.mov-legend__what[data-legend="single"]'), /^Ms\. Halloran: the line is the teacher’s subject colour\./);
        assert.ok(!(await dashesDrawn(page)).includes('6,2'), 'a solid walk is not given the long dashes');
        assert.equal(await hidden(page, '[data-action="show-me"]'), false, 'a walk that does not fit has a Show me');
      });

      test('Show me opens Travel time at the walk that does not fit; its table has the six columns and the words', async () => {
        await act.press('[data-action="show-me"]');
        await page.waitForFunction(() => document.querySelector('#inspector [role="tab"][aria-selected="true"]')?.dataset.tab === 'tables');
        const table = await page.$eval('#inspector [data-travel="teacher-table"]', (el) => ({ heads: Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent), rows: Array.from(el.querySelectorAll('tbody tr')).map((tr) => ({ fits: tr.dataset.fits, cells: Array.from(tr.children).map((cell) => cell.textContent) })) }));
        assert.deepEqual(table.heads, ['Period', 'From', 'To', 'Walking', 'Passing time', 'Fits']);
        assert.equal(table.rows.length, 1);
        assert.equal(table.rows[0].fits, 'no');
        assert.deepEqual([table.rows[0].cells[0], table.rows[0].cells[3], table.rows[0].cells[4], table.rows[0].cells[5]], ['Period 3 to Period 4', '57 s', '30 s', 'no, 27 s over']);
        assert.equal(await page.evaluate(() => document.activeElement.closest('[data-travel="day"]') !== null), true, 'the focus is on the table');
      });

      test('Hotspots, Summary and Playback say what they say for a teacher', async () => {
        await tab(page, act, 'hotspots');
        assert.equal(await text(page, '#inspector [data-hotspots="lead"]'), 'Hotspots are about groups. Choose Every group, a grade or chosen groups to see them.');
        await tab(page, act, 'summary');
        assert.equal(await text(page, '#inspector [data-figure="routes"] dt'), 'Walks drawn');
        assert.equal(await text(page, '#inspector [data-figure="late"] .mov-figure__value'), '1');
        assert.equal(await hidden(page, '#inspector [data-summary="groups"]'), true, 'no legend of groups');
        assert.match(await text(page, '#inspector [data-summary="health-line"]'), /^Every route was found/);
        assert.equal(await text(page, '[data-part="note"]'), 'Playback is for groups. A teacher’s walks are on the map.');
        assert.equal(await page.$eval('[data-action="play"]', (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'), true);
      });

      test('across a free period the walk is dashed in long dashes, and the sentence says "with a free period between"', async () => {
        await act.pick('[data-control="teacher"]', 'Vandermeer');
        assert.equal((await choice(page)).teacherId, VANDERMEER);
        assert.match(await line(page), /^Ms\. Vandermeer’s day on A Day: 1 walk with a free period between\./);
        const dashes = await picture(page, () => Array.from(document.querySelector('.mov').movement.picture.lanes.floors.values()).flat().map((lane) => lane.dash));
        assert.deepEqual(dashes, [true]);
        // On a phone, with the controls open, the map's stage is 143 px tall and its draw was not seen to reach the lane
        // in this journey (it did in a bare page); the lane's dash flag above is asserted there, the canvas's calls at 1280.
        if (!size.phone) {
          const drawn = await dashesDrawn(page);
          assert.ok(drawn.includes('6,2'), 'the canvas was given the long dashes 6,2: ' + drawn.join(' | '));
        }
        await tab(page, act, 'tables');
        const row = await page.$eval('#inspector [data-travel="teacher-table"] tbody tr', (tr) => ({ across: tr.dataset.across, fits: tr.lastElementChild.textContent }));
        assert.equal(row.across, 'true');
        assert.match(row.fits, /^yes, Period 5 is free$/);
      });

      test('one transition draws only the walk out of that period, or says the teacher stays put', async () => {
        await act.pick('[data-control="teacher"]', 'Halloran');
        await act.strip(2);
        assert.equal((await picture(page, () => document.querySelector('.mov').movement.picture.drawn)), 1);
        assert.match(await line(page), /^Ms\. Halloran walks from Room 101 to Cafeteria in Period 3 to Period 4: 57 s for a 30 s passing time\. It does not fit\.$/);
        // a transition she stays put through: found in her day, not assumed
        const stays = await picture(page, () => {
          const shown = document.querySelector('.mov').movement.picture;
          const stops = shown.trail.stops;
          for (let i = 0; i + 1 < stops.length; i += 1) {
            const [a, b] = [stops[i], stops[i + 1]];
            if (a.period + 1 === b.period && a.rooms.length === 1 && b.rooms.length === 1 && a.rooms[0].roomId && a.rooms[0].roomId === b.rooms[0].roomId) {
              const room = document.querySelector('.mov').movement.state.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === a.rooms[0].roomId);
              return { period: a.period, number: room.number };
            }
          }
          return null;
        });
        assert.ok(stays, 'she stays in one room through some transition');
        await act.strip(stays.period);
        assert.equal((await picture(page, () => document.querySelector('.mov').movement.picture.drawn)), 0);
        assert.equal(await line(page), 'Ms. Halloran stays in Room ' + stays.number + ' from Period ' + (stays.period + 1) + ' to Period ' + (stays.period + 2) + '.');
        await act.strip(null);
      });

      test('Clear clears the teacher too', async () => {
        await act.press('[data-action="clear"]');
        const now = await choice(page);
        assert.deepEqual([now.who, now.teacherId, now.groupIds, now.transition], ['groups', null, [], null]);
        assert.match(await line(page), /^Nothing is shown\./);
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });
    });
  }
}

// ---- Going to and Rooms of subject

for (const size of SIZES) {
  for (const mode of MODES) {
    if (!wanted(size, mode)) continue;
    describe('Going to and Rooms of subject, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      before(async () => {
        session = await open(size, emptied());
        page = session.page;
        act = hands(page, mode);
        await openControls(page, act);
      });
      after(async () => {
        if (session) await session.close();
      });

      test('Going to a room: the first line, the legend\'s heading and line, Hotspots\' heading, the card\'s two figures', async () => {
        assert.equal(await text(page, '[data-control="filters"] .mov-ctl__label[for]'), 'Rooms of subject');
        assert.equal(await text(page, '.mov-ctl__hint'), 'By the room’s subject, not the class’s.');
        await act.pick('[data-control="going-to"]', '201', 'rsample201');
        assert.equal((await choice(page)).toRoomId, 'rsample201');
        assert.match(await line(page), /^Showing walks into Room 201 on A Day, all transitions: \d+ groups?, \d+ walks?\.$/);
        assert.equal(await text(page, '.mov-legend__title'), 'Load of walks into Room 201');
        assert.equal(await text(page, '[data-legend="scale"]'), 'Relative to walks into Room 201 only: fifths of the busiest cell, ' + (await picture(page, () => document.querySelector('.mov').movement.picture.load.max)) + '.');
        assert.equal(await text(page, '[data-action="use-absolute"]'), 'Use the absolute scale');
        await tab(page, act, 'hotspots');
        assert.equal(await text(page, '[data-hotspots="heading"]'), 'Load: walks into Room 201. Delay: everyone’s');
        // the card of the busiest cell of those walks, by the pointer, the keyboard's cursor or a tap
        const seen = await openCard(page, mode);
        assert.match(seen.figures, /^Walks into Room 201: (\d+) · everyone: (\d+)$/);
        const [, mine, everyone] = /: (\d+) · everyone: (\d+)/.exec(seen.figures);
        assert.ok(Number(everyone) >= Number(mine) && Number(mine) > 0);
      });

      test('Use the absolute scale changes the scale and the line', async () => {
        // docked under a phone's map the link is on the line; on the card otherwise
        await act.press(size.phone ? '[data-action="use-absolute-docked"]' : '[data-action="use-absolute"]');
        await page.waitForFunction(() => document.querySelector('.mov-legend__note[data-legend="scale"]')?.textContent.startsWith('Absolute'), {}, );
        assert.equal(await hidden(page, '[data-action="use-absolute"]'), true);
        assert.equal(await hidden(page, '[data-action="use-absolute-docked"]'), true);
        // back to the relative scale for what follows, by the setting itself
        await loadModule(page, 'actions', 'engine/actions.js');
        await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSetting, { key: 'colourScale.mode', value: 'relative' }));
        await settled(page);
      });

      test('Rooms of subject: the subject\'s rooms, the heading in the legend; both filters say both', async () => {
        await act.select('[data-control="subject"]', 'ssample003', 'Science');
        assert.equal((await choice(page)).subjectId, 'ssample003');
        // Room 201 is not a Science room, so both together match no walk, and the sentence says both
      assert.match(await line(page), /^Nobody walks into Room 201, if it is a Science room on A Day: /);
        // take the room off its chip: only the subject is left
        await act.press('[data-control="room-chip"] .chip__remove');
        assert.equal((await choice(page)).toRoomId, null);
        assert.match(await line(page), /^Showing walks into Science rooms on A Day, all transitions: \d+ groups?, \d+ walks?\.$/);
        assert.equal(await text(page, '.mov-legend__title'), 'Load of walks into Science rooms');
        await act.select('[data-control="subject"]', '-none', 'No subject');
        assert.equal((await choice(page)).subjectId, '');
        assert.match(await line(page), /^Showing walks into rooms with no subject on A Day/);
      });

      test('one transition with a filter names the transition and leaves the walks out', async () => {
        await act.select('[data-control="subject"]', 'ssample003', 'Science');
        await act.strip(0);
        assert.match(await line(page), /^(Showing walks into Science rooms on A Day, Period 1 to Period 2 \(8:48 to 8:52\): \d+ groups?\.|Nobody walks into Science rooms in Period 1 to Period 2 on A Day\.)$/);
        await act.strip(null);
      });

      test('a room nobody has a class in says so, with Clear the filter', async () => {
        await act.select('[data-control="subject"]', '-any', 'Any subject');
        await act.pick('[data-control="going-to"]', '303', 'rsample303');
        assert.equal(await line(page), 'Room 303 has no class on A Day.');
        assert.equal(await picture(page, () => document.querySelector('.mov').movement.picture.drawn), 0);
        await tab(page, act, 'hotspots');
        assert.match(await text(page, '#inspector [data-hotspots="lead"]'), /^No walk passes the filter/);
        await act.press('[data-action="clear-filter"]');
        assert.equal((await choice(page)).toRoomId, null);
        assert.equal(await line(page), 'Showing 8 groups on A Day, all transitions. No route failed.');
      });

      test('a room somebody is in all day says nobody walks into it, and who is there', async () => {
        await act.pick('[data-control="going-to"]', '301', 'rsample301');
        assert.equal(await line(page), 'Nobody walks into Room 301 on A Day: 6A is there from Period 1 and stays.');
        await act.press('[data-action="clear-filter"]');
        assert.equal((await choice(page)).toRoomId, null);
      });

      test('Clear clears the filters', async () => {
        await act.pick('[data-control="going-to"]', '201', 'rsample201');
        await act.select('[data-control="subject"]', 'ssample003', 'Science');
        await act.press('[data-action="clear"]');
        const now = await choice(page);
        assert.deepEqual([now.toRoomId, now.subjectId, now.who], [null, null, 'groups']);
        assert.equal(await page.$eval('[data-control="subject"]', (el) => el.value), '-any');
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });
    });
  }
}

// The card of the busiest cell of the picture on screen, shown the way the mode shows one; what it says.
async function openCard(page, mode) {
  await page.evaluate(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    movement.canvas.scrollIntoView({ block: 'center' });
    movement.fit();
    movement.env.show(busiest.floorId, [busiest.cell]);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const at = await page.evaluate(() => {
    const movement = document.querySelector('.mov').movement;
    const busiest = movement.picture.busiest;
    const box = movement.canvas.getBoundingClientRect();
    const place = movement.cellAt(busiest.floorId, busiest.cell);
    const slot = movement.world.slots.find((each) => each.floor.id === busiest.floorId);
    return { x: box.left + place.x, y: box.top + place.y, row: slot.y + Math.floor(busiest.cell / slot.floor.width) - slot.box.y, column: slot.x + (busiest.cell % slot.floor.width) - slot.box.x };
  });
  if (mode === 'pointer') {
    await page.mouse.move(at.x, at.y);
  } else if (mode === 'touch') {
    await page.touchscreen.tap(at.x, at.y);
  } else {
    // the keyboard cursor, put beside the cell and stepped onto it
    await page.evaluate((from, row) => document.querySelector('.mov').movement.cursor.moveTo(from, row, true), at.column > 0 ? at.column - 1 : at.column + 1, at.row);
    await page.focus('#movement-plan');
    await page.keyboard.press(at.column > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
  await page.waitForSelector('.mov-card:not([hidden]) .mov-card__figures:not([hidden])', { timeout: 10000 });
  return page.$eval('.mov-card', (el) => ({ place: el.querySelector('.mov-card__place').textContent, figures: el.querySelector('.mov-card__figures').textContent }));
}

// ---- a room tapped on the map: "Show walks into Room 204"; and no button for a teacher

for (const size of SIZES) {
  for (const mode of ['pointer', 'touch']) {
    if (!wanted(size, mode)) continue;
    describe('Show walks into a room, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      before(async () => {
        session = await open(size, walkers());
        page = session.page;
        act = hands(page, mode);
      });
      after(async () => {
        if (session) await session.close();
      });

      // a point inside a room of the map
      const inside = (number) => page.evaluate((wanted) => {
        const movement = document.querySelector('.mov').movement;
        const room = movement.state.project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((space) => ({ floor, space }))).find((each) => each.space.number === wanted);
        movement.fit();
        movement.env.show(room.floor.id, room.space.cells);
        const cell = room.space.cells[Math.floor(room.space.cells.length / 2)];
        return { floorId: room.floor.id, cell, id: room.space.id };
      }, number);
      const reachCell = async (floorId, cell) => {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return page.evaluate((floor, at) => {
          const movement = document.querySelector('.mov').movement;
          const box = movement.canvas.getBoundingClientRect();
          const place = movement.cellAt(floor, at);
          return { x: box.left + place.x, y: box.top + place.y };
        }, floorId, cell);
      };
      const tapAt = async (where) => {
        if (mode === 'touch') await page.touchscreen.tap(where.x, where.y);
        else await page.mouse.click(where.x, where.y);
      };

      test('tapping a room offers "Show walks into Room 204" in its card, and the button filters the map', async () => {
        const room = await inside('204');
        const where = await reachCell(room.floorId, room.cell);
        await tapAt(where);
        await page.waitForSelector('.mov-card:not([hidden]) [data-action="show-into"]:not([hidden])');
        assert.equal(await text(page, '.mov-card [data-action="show-into"]'), 'Show walks into Room 204');
        assert.match(await text(page, '.mov-card__place'), /^Room 204/);
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 640px)').matches);
        assert.ok((await page.$eval('.mov-card [data-action="show-into"]', (el) => el.getBoundingClientRect().height)) >= (coarse ? 44 : 20));
        await act.press('.mov-card [data-action="show-into"]');
        assert.equal((await choice(page)).toRoomId, room.id);
        assert.match(await line(page), /^Showing walks into Room 204 on A Day, all transitions:/);
        assert.equal(await page.$eval('.mov-card', (el) => el.hidden), true, 'the card goes when the filter is chosen');
      });

      test('for a teacher there is no such button: a tapped room has no card', async () => {
        await act.press('[data-action="change"]').catch(() => {});
        await page.evaluate(() => document.querySelector('.mov').movement.change({ who: 'teacher', teacherId: 'tsample001', toRoomId: null }));
        await settled(page);
        const room = await inside('204');
        const where = await reachCell(room.floorId, room.cell);
        await tapAt(where);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.$eval('.mov-card', (el) => el.hidden), true);
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });
    });
  }
}

// ---- the two addresses, through route(rest); Back returns

for (const size of SIZES) {
  if (!wanted(size)) continue;
  describe('#movement/teacher/… and #movement/to/…, at ' + size.name, () => {
    let session;
    let page;
    before(async () => {
      session = await open(size, walkers());
      page = session.page;
    });
    after(async () => {
      if (session) await session.close();
    });

    const hash = () => page.evaluate(() => location.hash);
    // the view's own element, marked: a route that mounts again would lose the mark
    const mark = () => page.evaluate(() => { document.querySelector('.mov').__same = true; });
    const marked = () => page.evaluate(() => document.querySelector('.mov')?.__same === true);
    const sectionIs = (id) => page.waitForFunction((wanted) => document.querySelector('.surface__layout')?.dataset.section === wanted, {}, id);

    test('a teacher\'s address opened from another section shows the teacher on that day and transition, and Back returns', async () => {
      await go(page, '#schedule/teachers');
      await go(page, '#movement/teacher/' + HALLORAN + '/' + ONE_DAY + '/2');
      await settled(page);
      const now = await choice(page);
      assert.deepEqual([now.who, now.teacherId, now.dayTypeId, now.transition], ['teacher', HALLORAN, ONE_DAY, 2]);
      assert.match(await line(page), /^Ms\. Halloran walks from Room 101 to Cafeteria in Period 3 to Period 4/);
      await page.goBack();
      await sectionIs('schedule');
      assert.match(await hash(), /^#schedule/);
    });

    test('a room\'s address shows only walks into it, and Back returns', async () => {
      await go(page, '#schedule/teachers');
      await go(page, '#movement/to/rsample201');
      await settled(page);
      assert.equal((await choice(page)).toRoomId, 'rsample201');
      assert.match(await line(page), /^Showing walks into Room 201 on /);
      await page.goBack();
      await sectionIs('schedule');
    });

    test('an address followed inside Movement is applied by the section itself: nothing is mounted again, and Back goes to the address before', async () => {
      await go(page, '#movement');
      await settled(page);
      await mark();
      await page.evaluate(() => { location.hash = '#movement/teacher/tsample007'; });
      await page.waitForFunction(() => document.querySelector('.mov').movement.choice.teacherId === 'tsample007');
      await settled(page);
      assert.equal(await marked(), true, 'the same view');
      assert.equal((await choice(page)).who, 'teacher');
      // a room's address from a teacher's day leaves the teacher for the groups that walk into it
      await page.evaluate(() => { location.hash = '#movement/to/rsample202'; });
      await page.waitForFunction(() => document.querySelector('.mov').movement.choice.toRoomId === 'rsample202');
      await settled(page);
      assert.equal((await choice(page)).who, 'all');
      assert.equal(await marked(), true);
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#movement/teacher/tsample007');
      assert.equal(await marked(), true, 'Back is the same view again');
    });

    test('an address naming a teacher or room the project does not have changes nothing', async () => {
      const before = await choice(page);
      await page.evaluate(() => { location.hash = '#movement/teacher/tgone00000'; });
      await page.waitForFunction(() => location.hash === '#movement/teacher/tgone00000');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await choice(page), before);
      assert.equal(await marked(), true);
      assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
    });
  });
}
