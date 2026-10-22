// Every empty screen, in a real browser: node test/browser/empty-states.mjs
//
// One list, EMPTY_SCREENS: every screen of every section that can have
// nothing to show, with its sentence and its button, word for word. Spec 14
// asks that every empty screen say what it is for and what to do first; the
// words are a judgement (SV2-30b), written down here so that a change to
// them is a change to this list. Each case opens the screen on the project
// it needs, reads what the page drew under its [data-empty] mark, presses
// the button and checks it does what it says.
//
// The list is held to the page, not the page to the list: on an empty
// project every section of the rail, every tab of the Schedule section and
// every row choice of the grid is visited, read from the page itself, and
// each must show an empty screen that is in the list (Project, a page of
// cards, is never empty and is the one exception). Every mark met in any of
// the projects must be in the list, and every entry of the list must be met.
//
// Building's card has three buttons, as DESIGN 5.1 says: its first step
// needs none, since the Corridor tool is already in hand.
//
// Every wait is on a state the page sets: the section's data-section, a
// [data-empty] mark drawn, the address.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch, go } from './harness.mjs';

// The projects a screen is opened on.
//   empty        a new project: one empty floor, the starter subjects, two day types
//   rooms        the sample school with no groups and no exits: rooms, teachers
//   no-subjects  a new project with every subject deleted
const FACTS = {
  movementRooms: 'There is nothing to draw yet: this project has no rooms and no groups.',
};

export const EMPTY_SCREENS = [
  {
    id: 'building', project: 'empty', hash: '#building',
    text: 'This is the building. Draw each floor here: a corridor first, then rooms along it.',
    buttons: ['Trace over a photo of your floor plan', 'Change the size (Floor 1 is 40 × 30 squares)', 'Load the sample school'],
  },
  {
    id: 'groups', project: 'empty', hash: '#schedule/groups',
    text: 'No groups yet. A group is a set of students who travel together all day, and this is where each group gets a room for every period. Add the first group to begin.',
    buttons: ['Add a group'], adds: 'groups',
  },
  {
    id: 'grid-groups', project: 'empty', hash: '#schedule/grid', rows: 'groups',
    text: 'No groups yet. The grid is the whole schedule in one table, a row for each group and a column for each period. Add the first group here, or paste a block from a spreadsheet.',
    buttons: ['Add a group'], stages: true,
  },
  {
    id: 'grid-teachers', project: 'empty', hash: '#schedule/grid', rows: 'teachers',
    text: 'No teachers yet. With the rows set to Teachers, the grid shows each teacher’s day. Add teachers in the Teachers tab first.',
    buttons: ['Go to Teachers'], goes: '#schedule/teachers',
  },
  {
    id: 'grid-rooms', project: 'empty', hash: '#schedule/grid', rows: 'rooms',
    text: 'No rooms yet. With the rows set to Rooms, the grid shows who is in each room every period. Draw rooms in the building first.',
    buttons: ['Go to the building'], goes: '#building',
  },
  {
    id: 'teachers', project: 'empty', hash: '#schedule/teachers',
    text: 'No teachers yet. A teacher is a named member of staff, with a subject and one or more rooms, and this is the list of them. Add the first teacher to begin.',
    buttons: ['Add a teacher'], adds: 'teachers',
  },
  {
    id: 'subjects', project: 'no-subjects', hash: '#schedule/subjects',
    text: 'No subjects yet. A subject is a department. It has a code, a name and a colour, and the colour is how its rooms are drawn. Add the first subject to begin.',
    buttons: ['Add a subject'], adds: 'subjects',
  },
  {
    id: 'checks', project: 'empty', hash: '#schedule/checks',
    text: 'Nothing to check yet. Checks look through the schedule for problems, warnings and notes: two groups in one room, a teacher in two places, a walk too long for the passing time. Add a group first.',
    buttons: ['Go to Groups'], goes: '#schedule/groups',
  },
  {
    id: 'movement-rooms', project: 'empty', hash: '#movement',
    text: 'This is the movement view. It draws every group’s walk between one period and the next, so you can see where the corridors fill and who cannot make it in time. Draw the building and its rooms first. ' + FACTS.movementRooms,
    buttons: ['Go to the building'], goes: '#building',
  },
  {
    id: 'movement-groups', project: 'rooms', hash: '#movement',
    text: 'This is the movement view. It draws every group’s walk between one period and the next, so you can see where the corridors fill and who cannot make it in time. Add a group and give it its rooms first. There is nothing to draw yet: this project has 13 rooms and no groups.',
    buttons: ['Go to Groups'], goes: '#schedule/groups',
  },
  {
    id: 'scenarios-rooms', project: 'empty', hash: '#scenarios',
    text: 'This is the scenario lab. Try a change to the schedule here, see what it does to the corridors, then apply it or discard it. A scenario needs a building with rooms first. There are no groups and no rooms.',
    buttons: ['Go to the building'], goes: '#building',
  },
  {
    id: 'scenarios-groups', project: 'rooms', hash: '#scenarios',
    text: 'This is the scenario lab. Try a change to the schedule here, see what it does to the corridors, then apply it or discard it. A scenario changes a schedule: add groups first. There are no groups and 13 rooms.',
    buttons: ['Go to Groups'], goes: '#schedule/groups',
  },
  {
    id: 'safety-rooms', project: 'empty', hash: '#safety',
    text: 'This is the safety section. It shows the way out from every room to its nearest exit, and prints a door card for each room. Draw the building and its rooms first. No exits are marked yet, for no rooms.',
    buttons: ['Go to the building'], goes: '#building',
  },
  {
    id: 'safety-exits', project: 'rooms', hash: '#safety',
    text: 'This is the safety section. It shows the way out from every room to its nearest exit, and prints a door card for each room. Mark at least one exit on a corridor first: the Exit tool (X) in the Building section. No exits are marked yet, for 13 rooms.',
    buttons: ['Go to the building'], goes: '#building',
  },
  {
    id: 'staff', project: 'empty', hash: '#staff',
    text: 'There is nothing in the file yet: it shows your staff the building and the schedule you enter in the planner. Draw the building first, then add teachers and groups.',
    buttons: ['Go to the building'], goes: '#building',
  },
];

// Sections that are never empty, and why.
const NEVER_EMPTY = { project: 'a page of cards: settings, files, snapshots and the sample school are always there' };
// Schedule tabs that are never empty, and why.
const TAB_NEVER_EMPTY = {
  day: 'a project always has its periods and its day types',
  import: 'a form for a file, which has nothing to be empty of',
  subjects: 'a new project starts with the starter subjects; its empty screen is the no-subjects project\'s, in the list',
};

// Each project put in place has an id of its own: the grid keeps staged
// edits per project id, and a row staged on one screen must not be the next
// screen's.
let seed = 100;

let server;
let browser;
let session;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ hash: '#building', server, browser, theme: 'light' });
  page = session.page;
});

after(async () => {
  try {
    if (session) {
      assert.deepEqual(session.problems().errors, [], 'the page reported errors');
      await session.close();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
});

// Put one of the projects above in place, through the store.
async function useProject(kind) {
  seed += 1;
  await page.evaluate(async (wanted, n) => {
    const [{ replaceProject }, { sampleSchool }, { newProject }, { createIds, seededRandom }] = await Promise.all(
      ['engine/actions.js', 'data/sample-school.js', 'engine/schema.js', 'engine/ids.js'].map((file) => import(new URL(file, location.href).href)));
    const clock = () => new Date('2026-09-01T12:00:00Z');
    let project;
    if (wanted === 'rooms') {
      project = sampleSchool();
      project.id = 'p' + String(n).padStart(9, '0');
      project.groups = [];
      project.scenario = null;
      project.accepted = [];
      project.building = { ...project.building, floors: project.building.floors.map((floor) => ({ ...floor, exits: [] })) };
    } else {
      project = newProject(createIds(seededRandom(n)), clock, { passcode: 'p' });
      if (wanted === 'no-subjects') project.subjects = [];
    }
    project.onboarding = { ...project.onboarding, dismissed: true };
    globalThis.sv2.store.apply(replaceProject, { project, label: 'A project for the empty screens' });
  }, kind, seed);
  await page.waitForFunction((wanted) => {
    const project = globalThis.sv2.store.project;
    return wanted === 'rooms' ? project.groups.length === 0 && project.building.floors.length === 3 : project.building.floors.length === 1 && project.subjects.length === (wanted === 'no-subjects' ? 0 : project.subjects.length);
  }, {}, kind);
}

// Set the grid's rows to Groups, Teachers or Rooms, by its own control.
async function gridRows(value) {
  await page.waitForSelector('.grd input[name][value="' + value + '"]');
  await page.click('.grd input[name][value="' + value + '"]');
  await page.waitForFunction((wanted) => document.querySelector('.grd input[value="' + wanted + '"]').checked, {}, value);
}

// What the shown empty screen says: its marks, and the one shown's words and buttons.
function readEmpty() {
  return page.evaluate(() => {
    const shown = Array.from(document.querySelectorAll('#surface [data-empty]')).filter((el) => !el.hidden && el.getClientRects().length > 0);
    const el = shown[0];
    if (!el) return { ids: [] };
    const words = Array.from(el.querySelectorAll('h1, p')).filter((p) => p.getClientRects().length > 0 && !p.closest('button')).map((p) => p.textContent.trim()).filter(Boolean);
    const buttons = Array.from(el.querySelectorAll('button, a.btn')).filter((b) => b.getClientRects().length > 0);
    return {
      ids: shown.map((x) => x.dataset.empty),
      text: words.join(' '),
      buttons: buttons.map((b) => b.textContent.trim()),
      primary: buttons.filter((b) => b.classList.contains('btn--primary')).length,
    };
  });
}

async function openScreen(screen) {
  await useProject(screen.project);
  await go(page, screen.hash);
  if (screen.rows) await gridRows(screen.rows);
  await page.waitForFunction((id) => {
    const el = document.querySelector('#surface [data-empty="' + id + '"]');
    return el !== null && !el.hidden && el.getClientRects().length > 0;
  }, { timeout: 15000 }, screen.id);
}

const seen = new Set();

for (const screen of EMPTY_SCREENS) {
  test('the empty screen "' + screen.id + '" says what it is for and what to do first, and its button does it', async () => {
    await openScreen(screen);
    const read = await readEmpty();
    for (const id of read.ids) seen.add(id);
    assert.deepEqual(read.ids, [screen.id], 'one empty screen at a time, and the one wanted');
    assert.equal(read.text, screen.text);
    assert.deepEqual(read.buttons, screen.buttons);
    // DESIGN 1 rule 3 and 2: a full sentence in spec 2's words
    assert.ok(!/!/.test(read.text), 'an exclamation mark');
    assert.ok(!/\b(error|issue|conflict)s?\b/i.test(read.text), 'a word DESIGN 2 does not use');
    assert.ok(/\.$/.test(screen.text), 'not a full sentence');
    if (screen.buttons.length === 1) assert.equal(read.primary, 1, 'the one button is the primary one');

    if (screen.goes) {
      await page.click('#surface [data-empty="' + screen.id + '"] .btn--primary');
      await page.waitForFunction((hash) => location.hash === hash, {}, screen.goes);
      await page.waitForFunction((section) => document.querySelector('.surface__layout')?.dataset.section === section, {}, screen.goes.slice(1).split('/')[0]);
    } else if (screen.adds) {
      const before = await page.evaluate((what) => globalThis.sv2.store.project[what].length, screen.adds);
      await page.click('#surface [data-empty="' + screen.id + '"] .btn--primary');
      await page.waitForFunction((what, n) => globalThis.sv2.store.project[what].length === n + 1, {}, screen.adds, before);
      await page.waitForFunction((id) => document.querySelector('#surface [data-empty="' + id + '"]') === null, {}, screen.id);
    } else if (screen.stages) {
      // the grid stages its changes: the row is there, not applied, and the empty screen gone
      await page.click('#surface [data-empty="' + screen.id + '"] .btn--primary');
      await page.waitForFunction((id) => document.querySelector('.grd')?.dataset.staged === 'true' && document.querySelector('#surface [data-empty="' + id + '"]') === null, {}, screen.id);
      assert.equal(await page.evaluate(() => globalThis.sv2.store.project.groups.length), 0, 'the grid applied a row nobody applied');
    }
  });
}

test('on an empty project every section, Schedule tab and grid row choice shows an empty screen from the list', async () => {
  const listed = new Set(EMPTY_SCREENS.map((screen) => screen.id));
  await useProject('empty');
  await go(page, '#building');
  const sections = await page.$$eval('#rail a[data-section]', (all) => all.map((a) => a.dataset.section));
  assert.ok(sections.length >= 7, 'the rail: ' + sections.join(', '));
  const missing = [];
  // A screen that draws no empty screen within the wait is recorded as
  // missing (the assertion below names it), not let pass.
  const check = async (where) => {
    try {
      await page.waitForFunction(() => Array.from(document.querySelectorAll('#surface [data-empty]')).some((el) => !el.hidden && el.getClientRects().length > 0), { timeout: 8000 });
    } catch (error) {
      missing.push(where + ': no empty screen drawn in 8 s');
      return;
    }
    const read = await readEmpty();
    if (read.ids.length !== 1 || !listed.has(read.ids[0])) missing.push(where + ': ' + (read.ids.join(', ') || 'no empty screen'));
    for (const id of read.ids) seen.add(id);
  };
  for (const id of sections) {
    if (NEVER_EMPTY[id]) continue;
    await go(page, '#' + id);
    if (id === 'schedule') {
      const tabs = await page.$$eval('#surface [role="tab"]', (all) => all.map((tab) => tab.dataset.tab || tab.getAttribute('aria-controls')));
      assert.ok(tabs.length >= 6, 'the Schedule tabs: ' + tabs.join(', '));
      for (const tab of tabs) {
        if (TAB_NEVER_EMPTY[tab]) continue;
        await go(page, '#schedule/' + tab);
        if (tab === 'grid') {
          const rows = await page.$$eval('.grd input[name][value]', (all) => all.map((input) => input.value));
          assert.deepEqual(rows, ['groups', 'teachers', 'rooms']);
          for (const value of rows) {
            await gridRows(value);
            await check('#schedule/grid, rows ' + value);
          }
        } else {
          await check('#schedule/' + tab);
        }
      }
    } else {
      await check('#' + id);
    }
  }
  assert.deepEqual(missing, [], 'a screen with nothing to show and no empty screen in the list');
});

test('every empty screen in the list was met, and nothing met is missing from it', () => {
  assert.deepEqual([...seen].filter((id) => !EMPTY_SCREENS.some((screen) => screen.id === id)), []);
  assert.deepEqual(EMPTY_SCREENS.map((screen) => screen.id).filter((id) => !seen.has(id)), []);
});
