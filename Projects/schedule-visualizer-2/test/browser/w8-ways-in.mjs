// The ways into a teacher's movement, in a real browser: node test/browser/w8-ways-in.mjs
//
// SV2-156 (DESIGN 17.2 and 17.7 item 10). Each row of Schedule › Teachers has a
// Movement button, named for the teacher (Movement for Ms. Halloran), and the
// Checks finding about a teacher's walk has a Show: both open Movement at
// `#movement/teacher/<id>`, the finding's on its own day type and the period
// the walk leaves, and Back goes to the tab they were pressed on. Pointer and
// keyboard at 1280, touch at 390 (the phone's Teachers table is the same
// table). The school is the plain sample with every second teacher given a
// second room, which gives teachers walks; for the finding it has no bell
// times and 30 seconds of passing time, so Ms. Halloran's walk does not fit.
//
// Every wait is on a state the page sets: the schedule section's `data-pending`
// gone, the movement view holding the answer for the store's project and the
// choice the address names; never a first paint and never a sleep.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, atRest, launch, startServer } from './harness.mjs';
import { plainSchool } from '../engine/helpers.mjs';

const HALLORAN = 'tsample001';
const DAY_A = 'dsample00a';
const clone = (value) => JSON.parse(JSON.stringify(value));

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

// the plain sample, with every second teacher given a second room
function walkers() {
  const project = clone(plainSchool());
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

// no bell times and 30 s of passing time: Ms. Halloran's 57 s walk does not fit
function late() {
  const project = walkers();
  for (const dayType of project.dayTypes) if (dayType.own) dayType.bells = dayType.bells.map(() => ({ start: '', end: '' }));
  project.settings.defaultPassingSeconds = 30;
  return project;
}

async function open(hash, size, project) {
  const session = await openPlanner({ hash, theme: 'light', width: size.width, height: size.height, mobile: size.phone, browser, server });
  const { page } = session;
  await page.evaluate(async (next) => {
    const { store } = globalThis.sv2;
    next.settings.theme = store.project.settings.theme;
    store.replace(next);
    // the answer the checks on walks are made from
    await store.derived.results().catch(() => null);
  }, project);
  return session;
}

const scheduleSettled = (page) => page.waitForFunction(() => {
  const section = document.querySelector('.sch');
  return Boolean(section) && section.dataset.pending !== 'true' && document.querySelector('link[data-sheet="schedule"]')?.sheet !== null;
}, { timeout: 30000 });

// the movement view holds the answer for the store's project, and the choice it was given is the one wanted
function movementShows(page, wanted) {
  return page.waitForFunction((expected) => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true' || !section.movement) return false;
    const { movement } = section;
    if (movement.state === null || movement.state.results === null || movement.state.project !== globalThis.sv2.store.project) return false;
    const choice = movement.choice;
    return Object.keys(expected).every((key) => choice[key] === expected[key]);
  }, { timeout: 30000 }, wanted);
}

const choiceOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.mov').movement.choice)));
const hashOf = (page) => page.evaluate(() => location.hash);

// Back: the page goes to the address before, and the section it names has drawn
async function back(page, hash) {
  await page.goBack();
  await page.waitForFunction((wanted) => location.hash === wanted, { timeout: 30000 }, hash);
}

// A control pressed the way a person reaches it: a mouse, a finger, or the keyboard.
async function press(page, mode, selector) {
  await page.evaluate((wanted) => document.querySelector(wanted).scrollIntoView({ block: 'center', inline: 'center' }), selector);
  if (mode === 'keyboard') {
    await page.focus(selector);
    await page.keyboard.press('Enter');
    return;
  }
  const box = await atRest(page, selector);
  if (mode === 'touch') await page.touchscreen.tap(box.left + box.width / 2, box.top + box.height / 2);
  else await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
}

const CASES = [
  { size: { name: '1280', width: 1280, height: 900, phone: false }, mode: 'pointer' },
  { size: { name: '1280', width: 1280, height: 900, phone: false }, mode: 'keyboard' },
  { size: { name: '390', width: 390, height: 844, phone: true }, mode: 'touch' },
];

for (const { size, mode } of CASES) {
  describe('the ways into a teacher’s movement, ' + mode + ' at ' + size.name, () => {
    test('the Teachers tab’s Movement button is named for the teacher, opens that teacher in Movement, and Back returns', async () => {
      const session = await open('#schedule/teachers', size, walkers());
      try {
        const { page } = session;
        await scheduleSettled(page);
        const row = '.sch-teachers tr[data-teacher="' + HALLORAN + '"]';
        const button = row + ' [data-action="movement"]';
        assert.equal(await page.$eval(button, (el) => el.textContent.replace(/\s+/g, ' ').trim()), 'Movement for Ms. Halloran', 'the button’s name does not say whose movement it opens');
        assert.equal(await page.$$eval('.sch-teachers [data-action="movement"]', (all) => all.length), await page.$$eval('.sch-teachers tr[data-teacher]', (all) => all.length), 'a row has no Movement button');
        await press(page, mode, button);
        await movementShows(page, { who: 'teacher', teacherId: HALLORAN });
        assert.equal(await hashOf(page), '#movement/teacher/' + HALLORAN);
        const picture = await page.evaluate(() => document.querySelector('.mov').movement.picture.mode);
        assert.equal(picture, 'teacher', 'Movement does not draw the teacher’s day');
        assert.match(await page.$eval('#movement-line .mov-line__words', (el) => el.textContent.replace(/\s+/g, ' ').trim()), /^Ms\. Halloran’s day on A Day: /);
        await back(page, '#schedule/teachers');
        await scheduleSettled(page);
        await page.waitForSelector(row);
      } finally {
        await session.close();
      }
    });

    test('the Show of a teacher’s walk that does not fit opens that teacher on its day type and transition, and Back returns to Checks', async () => {
      const session = await open('#schedule/checks', size, late());
      try {
        const { page } = session;
        await scheduleSettled(page);
        const finding = '.sch-findings tr[data-finding^="teacher-walk:' + DAY_A + ':"][data-finding$=":' + HALLORAN + '"]';
        await page.waitForSelector(finding, { timeout: 30000 });
        const id = await page.$eval(finding, (el) => el.dataset.finding);
        const period = Number(id.split(':')[2]);
        assert.ok(Number.isInteger(period), 'the finding’s id has no period: ' + id);
        await press(page, mode, finding + ' [data-action="show"]');
        await movementShows(page, { who: 'teacher', teacherId: HALLORAN, dayTypeId: DAY_A, transition: period });
        assert.equal(await hashOf(page), '#movement/teacher/' + HALLORAN + '/' + DAY_A + '/' + period);
        const choice = await choiceOf(page);
        assert.equal(choice.who, 'teacher');
        // one transition: the walk out of that period, or the sentence that the teacher stays put
        const said = await page.$eval('#movement-line .mov-line__words', (el) => el.textContent.replace(/\s+/g, ' ').trim());
        assert.match(said, /Ms\. Halloran/);
        await back(page, '#schedule/checks');
        await scheduleSettled(page);
        await page.waitForSelector(finding);
      } finally {
        await session.close();
      }
    });
  });
}
