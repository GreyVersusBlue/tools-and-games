// The Clear… card (spec 13.6): "Clear the building", "Clear the schedule" and
// "Replace with a new empty project". Each says beside its button exactly what it removes
// and what stays, takes a snapshot first (storage/snapshots.js) and a
// recovery point 'replace' (ARCHITECTURE 7: before every replace-everything
// action), and takes effect on screen at once as one undo step
// (actions.replaceProject with the cleared project and its own label), with a
// toast that says what was done and offers Undo.
//
// It asks nothing when the snapshot is taken: spec 3.8 asks only before what
// cannot be undone, and a clear with a snapshot and an undo step can be. When
// no snapshot can be taken (the device keeps the most it keeps, or keeps no
// snapshots at all) it asks, saying so, because going on without one is the
// person's call.
//
// What each one removes, decided here (SV2-28):
//   the building   everything drawn on every floor: rooms, other spaces,
//                  corridor and stairs cells, corridor names, exits, stairs
//                  connections and the areas left out of the colour scale.
//                  The floors stay, empty, with their names, sizes, levels
//                  and traced images (a traced photo is what a new drawing
//                  starts from). Slots in a room that is gone keep its
//                  number as text, as deleting a room does (detachRooms).
//   the schedule   every group with its schedule, every teacher (so no room
//                  has teachers), the accepted findings, the open scenario
//                  and the kept ones. The building, the subjects, the day
//                  types with their bell times and the settings stay.
//   a new project  everything: an empty project as a first visit makes,
//                  with a new identity; only the theme is kept, as removing
//                  the sample school keeps it. It replaces the open project
//                  (spec 13.6); Start another project, in Projects on this
//                  device, is the one that keeps it (DESIGN 15.9 item 2).
//   The building's clear leaves the scenarios as it leaves the open one: the
//   lab's reconcile drops what no longer applies (ARCHITECTURE 21.10).
//
// The pure parts (cleared projects and the words) are exported for the Node
// test, test/engine/snapshots.test.mjs.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count, list } from '../components/words.js';
import { detachRooms, replaceProject } from '../../engine/actions.js';
import { newProject, DEFAULT_DAY_TYPE_NAMES, ELEVATOR_KIND, isLiftCell } from '../../engine/schema.js';
import { keptScenarios } from '../../engine/scenario.js';
import { dateWords } from '../../engine/calendar.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { pageSnapshots, AUTO_SNAPSHOT_NAMES, READ_ONLY_SENTENCE } from '../../storage/snapshots.js';
import { keepNeverShow } from '../help/progress.js';

function quote(text) {
  return '“' + text + '”';
}

// A typed name inside a sentence that can only be text: in quotation marks
// and isolated (U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL
// ISOLATE), so a name with a right-to-left override cannot turn the words
// after it round.
function quoteName(text) {
  return '“\u2068' + text + '\u2069”';
}

// What is drawn in the building, counted.
export function buildingContents(project) {
  const found = { floors: project.building.floors.length, rooms: 0, otherSpaces: 0, corridorCells: 0, stairsCells: 0, liftCells: 0, corridorNames: 0, exits: 0, connections: 0, elevatorConnections: 0, steps: 0, refuges: 0, zones: project.building.zones.length };
  // by kind: an elevator's connection is not a stairs connection (ARCHITECTURE 19.11)
  for (const connection of project.building.connections) {
    if (connection.kind === ELEVATOR_KIND) found.elevatorConnections += 1;
    else found.connections += 1;
  }
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') found.rooms += 1;
      else found.otherSpaces += 1;
    }
    for (let at = 0; at < floor.cells.length; at += 1) {
      const character = floor.cells[at];
      if (character === '#') found.corridorCells += 1;
      else if (character === 'S') {
        // a stop is the end of an elevator connection; a stale lifts index on a stairs end is stairs
        if (isLiftCell(project.building, floor.id, at)) found.liftCells += 1;
        else found.stairsCells += 1;
      }
    }
    found.steps += (floor.notStepFree || []).length;
    found.refuges += (floor.refuges || []).length;
    found.corridorNames += floor.corridors.length;
    found.exits += floor.exits.length;
  }
  return found;
}

// What is in the schedule that clearing it removes, counted.
export function scheduleContents(project) {
  return { groups: project.groups.length, teachers: project.teachers.length, accepted: project.accepted.length, scenario: project.scenario ? project.scenario.name : null, kept: keptScenarios(project).length };
}

// What the project is called in a sentence about it (ARCHITECTURE 21.5): its
// label; blank, the school's name; both blank, "Untitled project (started
// 14 November 2026)", the date of its `created` time, in UTC. The name is
// isolated (U+2068 … U+2069) so a right-to-left override in it cannot turn
// the words after it round.
export function openProjectName(project) {
  const label = typeof project.label === 'string' ? project.label.trim() : '';
  const school = project.settings && typeof project.settings.schoolName === 'string' ? project.settings.schoolName.trim() : '';
  if (label !== '') return '\u2068' + label + '\u2069';
  if (school !== '') return '\u2068' + school + '\u2069';
  const started = typeof project.created === 'string' ? dateWords(project.created.slice(0, 10)) : '';
  return 'Untitled project' + (started === '' ? '' : ' (started ' + started + ')');
}

// The project with every floor emptied and the building's links gone. The
// floors keep their ids, names, sizes, levels and traced images.
export function clearedBuilding(project) {
  const rooms = [];
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.push(space);
  const detached = detachRooms(project, rooms);
  // the step-free lists go with the cells they mark; a floor that had none keeps having none
  const floors = project.building.floors.map((floor) => {
    const { lifts, notStepFree, refuges, ...rest } = floor;
    const emptied = { ...rest, cells: '.'.repeat(floor.width * floor.height), spaces: [], corridors: [], exits: [] };
    if (lifts) emptied.lifts = [];
    if (notStepFree) emptied.notStepFree = [];
    if (refuges) emptied.refuges = [];
    return emptied;
  });
  return { ...detached, building: { ...project.building, floors, connections: [], zones: [] } };
}

// The project with no groups, no teachers, no accepted findings and no
// scenario, open or kept. Every room's teacher list is emptied with the
// teachers.
export function clearedSchedule(project) {
  const floors = project.building.floors.map((floor) => (floor.spaces.some((space) => space.kind === 'room' && space.teacherIds.length > 0)
    ? { ...floor, spaces: floor.spaces.map((space) => (space.kind === 'room' && space.teacherIds.length > 0 ? { ...space, teacherIds: [] } : space)) }
    : floor));
  // `scenarios` goes with `scenario`: a project that had none has none still
  const { scenarios, ...rest } = project;
  return { ...rest, building: { ...project.building, floors }, groups: [], teachers: [], accepted: [], scenario: null };
}

// An empty project in place of this one. Only the theme comes across, and
// "Don't show this again" for Getting started (ui/help/progress.js).
export function freshProject(project, ids, clock, paperSize) {
  const next = keepNeverShow(project, newProject(ids, clock, { paperSize, passcode: DEFAULT_PASSCODE }));
  next.settings.theme = project.settings.theme;
  return next;
}

// What clearing the building would say: { empty, removes, keeps }.
export function buildingWords(project) {
  const c = buildingContents(project);
  const parts = [
    c.rooms > 0 ? count(c.rooms, 'room') : null,
    c.otherSpaces > 0 ? count(c.otherSpaces, 'other space') : null,
    c.corridorCells > 0 ? count(c.corridorCells, 'corridor cell') : null,
    c.stairsCells > 0 ? count(c.stairsCells, 'stairs cell') : null,
    c.liftCells > 0 ? count(c.liftCells, 'elevator stop') : null,
    c.corridorNames > 0 ? count(c.corridorNames, 'corridor name') : null,
    c.exits > 0 ? count(c.exits, 'exit') : null,
    c.connections > 0 ? count(c.connections, 'stairs connection') : null,
    c.elevatorConnections > 0 ? count(c.elevatorConnections, 'elevator connection') : null,
    c.steps > 0 ? count(c.steps, 'step mark') : null,
    c.refuges > 0 ? count(c.refuges, 'area of refuge', 'areas of refuge') : null,
    c.zones > 0 ? count(c.zones, 'area left out of the colour scale', 'areas left out of the colour scale') : null,
  ].filter(Boolean);
  return {
    empty: parts.length === 0,
    removes: parts.length === 0
      ? 'Nothing is drawn on ' + (c.floors === 1 ? 'the floor' : 'any of the ' + c.floors + ' floors') + ', so there is nothing to clear.'
      : 'Removes everything drawn on ' + (c.floors === 1 ? 'the floor' : 'all ' + c.floors + ' floors') + ': ' + list(parts) + '.',
    keeps: (c.floors === 1 ? 'The floor stays, empty, with its name, size and any traced image.' : 'The floors stay, empty, with their names, sizes and any traced images.')
      + ' The schedule stays: a group in a room that is gone keeps the room\'s number, which reads "not in the building", and teachers keep their names but no longer have rooms.',
  };
}

// What clearing the schedule would say: { empty, removes, keeps }.
export function scheduleWords(project) {
  const c = scheduleContents(project);
  const parts = [
    c.groups > 0 ? count(c.groups, 'group') + ' with ' + (c.groups === 1 ? 'its schedule' : 'their schedules') : null,
    c.teachers > 0 ? count(c.teachers, 'teacher') : null,
    c.accepted > 0 ? count(c.accepted, 'accepted finding') : null,
    c.scenario !== null ? 'the open scenario ' + quoteName(c.scenario) : null,
    c.kept > 0 ? count(c.kept, 'kept scenario') : null,
  ].filter(Boolean);
  return {
    empty: parts.length === 0,
    removes: parts.length === 0 ? 'There are no groups, teachers, accepted findings or scenario, so there is nothing to clear.' : 'Removes ' + list(parts) + '.',
    keeps: 'The building stays with its rooms, which no longer have teachers. The subjects, the day types with their bell times, the other bell schedules, the calendar and the settings stay too.',
  };
}

// What replacing the project with a new empty one would say: { empty, removes,
// replaces, keeps }; `replaces` is the line that says it takes the open
// project and where to go to keep it.
export function newProjectWords(project) {
  const b = buildingContents(project);
  const s = scheduleContents(project);
  const parts = [count(b.floors, 'floor'), count(b.rooms, 'room'), count(s.teachers, 'teacher'), count(s.groups, 'group'), count(project.subjects.length, 'subject'), count(project.dayTypes.length, 'day type')];
  if (s.kept > 0) parts.push(count(s.kept, 'kept scenario'));
  return {
    empty: false,
    removes: 'Replaces the whole project with an empty one: the building, the schedule, the scenario, the publish settings and every other setting. This project has ' + list(parts) + '.',
    replaces: 'This replaces ' + openProjectName(project) + ' (the open project). To keep it, use Start another project in Projects on this device.',
    keeps: 'The new project has one empty floor, the day types a new project starts with (' + list(DEFAULT_DAY_TYPE_NAMES) + '), the starter subjects and the settings a new project starts with. Only the theme stays as it is.',
  };
}

// The three, in the order the card shows them.
export const CLEARS = [
  {
    id: 'building',
    reason: 'clear-building',
    button: 'Clear the building',
    title: 'Clear the building?',
    action: 'Clear the building',
    keep: 'Keep the building',
    label: 'Clear the building',
    done: 'Cleared the building.',
    words: buildingWords,
    make: (project) => clearedBuilding(project),
  },
  {
    id: 'schedule',
    reason: 'clear-schedule',
    button: 'Clear the schedule',
    title: 'Clear the schedule?',
    action: 'Clear the schedule',
    keep: 'Keep the schedule',
    label: 'Clear the schedule',
    done: 'Cleared the schedule.',
    words: scheduleWords,
    make: (project) => clearedSchedule(project),
  },
  {
    id: 'new',
    reason: 'new-project',
    button: 'Replace with a new empty project',
    title: 'Replace this project with a new empty project?',
    action: 'Replace with a new empty project',
    keep: 'Keep this project',
    label: 'Replace with a new empty project',
    done: 'Replaced the project with a new empty project.',
    words: newProjectWords,
    make: (project, ctx) => freshProject(project, ctx.ids, ctx.clock, ctx.devicePaper ? ctx.devicePaper() : undefined),
  },
];

// The question's last line: whether a snapshot is taken first. `room` is
// what snapshots.room() answered, null when there are no snapshots here.
export function snapshotLine(room, name, what) {
  if (!room || room.error) return 'No snapshot can be taken first' + (room && room.error ? ': ' + room.error : '.') + ' Undo still brings ' + what + ' back while this tab stays open.';
  if (room.full) return 'No snapshot can be taken first: this device already keeps ' + room.limit + ' snapshots, the most it keeps, and none is replaced to make room. Undo still brings ' + what + ' back while this tab stays open. To have a snapshot as well, keep this, delete one under Snapshots, and come back.';
  return 'A snapshot of the project as it is now, ' + quote(name) + ', is taken first, so you can restore it from Snapshots at any time. Undo brings ' + what + ' back too, while this tab stays open.';
}

export function clearCard(ctx) {
  const lead = h('p', { class: 'card__lead' }, 'Each of these takes effect at once. A snapshot of the project is taken first, and Undo brings back what was removed. Only when no snapshot can be taken does it ask before going on.');
  const result = h('div', { data: { line: 'result' }, hidden: true });
  const rows = new Map();

  function say(kind, text) {
    result.hidden = false;
    result.dataset.result = kind;
    result.replaceChildren(h('p', { role: kind === 'refused' ? 'alert' : 'status' }, text));
  }

  const WHAT = { building: 'the building', schedule: 'the schedule', new: 'this project' };

  // Ask before going on without a snapshot. `why` is what snapshots.room()
  // answered, or what the take said when it failed. Resolves true to go on.
  function askWithout(entry, project, why, opener) {
    const words = entry.words(project);
    return ctx.confirm({
      title: entry.title,
      body: [h('p', null, words.removes), ...(words.replaces ? [h('p', null, words.replaces)] : []), h('p', null, words.keeps), h('p', null, snapshotLine(why, AUTO_SNAPSHOT_NAMES[entry.reason], WHAT[entry.id]))],
      action: entry.action,
      keep: entry.keep,
      danger: true,
      opener,
    });
  }

  async function clear(entry, opener) {
    if (entry.words(ctx.store.project).empty) {
      say('done', entry.words(ctx.store.project).removes);
      return;
    }
    if (ctx.storage && ctx.storage.state.readOnly) {
      say('refused', READ_ONLY_SENTENCE);
      return;
    }
    const snapshots = pageSnapshots();
    let why = snapshots ? await snapshots.room() : null;
    let taken = null;
    if (why && !why.error && !why.full) {
      const answer = await snapshots.takeAuto(entry.reason);
      if (answer.ok) taken = answer.snapshot;
      // the take's own sentence, after "No snapshot can be taken first:"
      else why = answer.code === 'full' ? { ...why, full: true } : { ...why, error: answer.text.charAt(0).toLowerCase() + answer.text.slice(1) };
    }
    // the question, when there is one, describes the project it was asked of;
    // what is cleared is made from that same project, read after every wait
    let asked = null;
    if (!taken) {
      asked = ctx.store.project;
      if (entry.words(asked).empty) {
        say('done', entry.words(asked).removes);
        return;
      }
      if (!(await askWithout(entry, asked, why, opener))) {
        say('done', 'Nothing was cleared.');
        return;
      }
    }
    // everything replaced gets a recovery point (null when the device keeps none: it goes on)
    if (ctx.storage) await ctx.storage.takeRecoveryPoint('replace');
    const project = ctx.store.project;
    if (asked && project !== asked) {
      say('refused', 'Nothing was cleared, because the project changed while the question was open. Press ' + quote(entry.label) + ' again to clear it as it is now.');
      return;
    }
    if (entry.words(project).empty) {
      say('done', entry.words(project).removes);
      return;
    }
    ctx.store.apply(replaceProject, { project: entry.make(project, ctx), label: entry.label });
    if (ctx.store.project === project) {
      say('refused', 'Nothing was cleared.');
      return;
    }
    const where = taken ? ' The snapshot ' + quoteName(taken.name) + ' has what was there.' : '';
    say('done', entry.done + where + ' Undo brings it back.');
    ctx.toast({ text: entry.done + where, action: { label: 'Undo', run: ctx.undo } });
  }

  // One clear at a time: a double press, or a press while one is under way,
  // does nothing, so a clear never runs twice or takes two snapshots.
  let busy = false;
  async function run(entry, opener) {
    if (busy) return;
    busy = true;
    try {
      await clear(entry, opener);
    } finally {
      busy = false;
    }
  }

  const element = card({ id: 'clear', title: 'Clear…' },
    lead,
    CLEARS.map((entry) => {
      const says = h('p', { data: { says: entry.id } });
      const replaces = entry.id === 'new' ? h('p', { class: 'clear__replaces', data: { replaces: entry.id } }) : null;
      const keeps = h('p', { class: 'clear__keeps', data: { keeps: entry.id } });
      const button = h('button', { type: 'button', class: 'btn', data: { action: 'clear-' + entry.id } }, entry.button);
      button.addEventListener('click', () => run(entry, button));
      rows.set(entry.id, { says, replaces, keeps });
      return h('div', { class: 'clear__row', data: { clear: entry.id } }, says, replaces, keeps, h('div', { class: 'card__buttons' }, button));
    }),
    result,
  );

  function update(project) {
    for (const entry of CLEARS) {
      const words = entry.words(project);
      const row = rows.get(entry.id);
      row.says.textContent = words.removes;
      if (row.replaces) row.replaces.textContent = words.replaces || '';
      row.keeps.textContent = words.empty ? '' : words.keeps;
      row.keeps.hidden = words.empty;
    }
  }

  update(ctx.store.project);
  return { element, update };
}
