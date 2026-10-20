// The Clear… card (spec 13.6): "Clear the building", "Clear the schedule" and
// "Start a new project". Each says exactly what it removes and what stays,
// asks, takes a snapshot first (storage/snapshots.js), and takes effect on
// screen at once as one undo step (actions.replaceProject with the cleared
// project and its own label).
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
//                  has teachers), the accepted findings and the open
//                  scenario. The building, the subjects, the day types with
//                  their bell times and the settings stay.
//   a new project  everything: an empty project as a first visit makes,
//                  with a new identity; only the theme is kept, as removing
//                  the sample school keeps it.
//
// The pure parts (cleared projects and the words) are exported for the Node
// test, test/engine/snapshots.test.mjs.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count, list } from '../components/words.js';
import { detachRooms, replaceProject } from '../../engine/actions.js';
import { newProject } from '../../engine/schema.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { pageSnapshots, AUTO_SNAPSHOT_NAMES, READ_ONLY_SENTENCE } from '../../storage/snapshots.js';

function quote(text) {
  return '“' + text + '”';
}

// What is drawn in the building, counted.
export function buildingContents(project) {
  const found = { floors: project.building.floors.length, rooms: 0, otherSpaces: 0, corridorCells: 0, stairsCells: 0, corridorNames: 0, exits: 0, connections: project.building.connections.length, zones: project.building.zones.length };
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') found.rooms += 1;
      else found.otherSpaces += 1;
    }
    for (const character of floor.cells) {
      if (character === '#') found.corridorCells += 1;
      else if (character === 'S') found.stairsCells += 1;
    }
    found.corridorNames += floor.corridors.length;
    found.exits += floor.exits.length;
  }
  return found;
}

// What is in the schedule that clearing it removes, counted.
export function scheduleContents(project) {
  return { groups: project.groups.length, teachers: project.teachers.length, accepted: project.accepted.length, scenario: project.scenario ? project.scenario.name : null };
}

// The project with every floor emptied and the building's links gone. The
// floors keep their ids, names, sizes, levels and traced images.
export function clearedBuilding(project) {
  const rooms = [];
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.push(space);
  const detached = detachRooms(project, rooms);
  const floors = project.building.floors.map((floor) => ({ ...floor, cells: '.'.repeat(floor.width * floor.height), spaces: [], corridors: [], exits: [] }));
  return { ...detached, building: { ...project.building, floors, connections: [], zones: [] } };
}

// The project with no groups, no teachers, no accepted findings and no
// scenario. Every room's teacher list is emptied with the teachers.
export function clearedSchedule(project) {
  const floors = project.building.floors.map((floor) => (floor.spaces.some((space) => space.kind === 'room' && space.teacherIds.length > 0)
    ? { ...floor, spaces: floor.spaces.map((space) => (space.kind === 'room' && space.teacherIds.length > 0 ? { ...space, teacherIds: [] } : space)) }
    : floor));
  return { ...project, building: { ...project.building, floors }, groups: [], teachers: [], accepted: [], scenario: null };
}

// An empty project in place of this one. Only the theme comes across.
export function freshProject(project, ids, clock, paperSize) {
  const next = newProject(ids, clock, { paperSize, passcode: DEFAULT_PASSCODE });
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
    c.corridorNames > 0 ? count(c.corridorNames, 'corridor name') : null,
    c.exits > 0 ? count(c.exits, 'exit') : null,
    c.connections > 0 ? count(c.connections, 'stairs connection') : null,
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
    c.scenario !== null ? 'the open scenario ' + quote(c.scenario) : null,
  ].filter(Boolean);
  return {
    empty: parts.length === 0,
    removes: parts.length === 0 ? 'There are no groups, teachers, accepted findings or scenario, so there is nothing to clear.' : 'Removes ' + list(parts) + '.',
    keeps: 'The building stays with its rooms, which no longer have teachers. The subjects, the day types with their bell times, and the settings stay too.',
  };
}

// What starting a new project would say: { empty, removes, keeps }.
export function newProjectWords(project) {
  const b = buildingContents(project);
  const s = scheduleContents(project);
  const parts = [count(b.floors, 'floor'), count(b.rooms, 'room'), count(s.teachers, 'teacher'), count(s.groups, 'group'), count(project.subjects.length, 'subject'), count(project.dayTypes.length, 'day type')];
  return {
    empty: false,
    removes: 'Replaces the whole project with an empty one: the building, the schedule, the scenario, the publish settings and every other setting. This project has ' + list(parts) + '.',
    keeps: 'The new project has one empty floor, an A Day and a B Day, the starter subjects and the settings a new project starts with. Only the theme stays as it is.',
  };
}

// The three, in the order the card shows them.
export const CLEARS = [
  {
    id: 'building',
    reason: 'clear-building',
    button: 'Clear the building…',
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
    button: 'Clear the schedule…',
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
    button: 'Start a new project…',
    title: 'Start a new project in place of this one?',
    action: 'Start a new project',
    keep: 'Keep this project',
    label: 'Start a new project',
    done: 'Started a new project.',
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
  const lead = h('p', { class: 'card__lead' }, 'Each of these takes effect at once, after asking. A snapshot of the project is taken first, and Undo brings back what was removed.');
  const result = h('div', { data: { line: 'result' }, hidden: true });
  const rows = new Map();

  function say(kind, text) {
    result.hidden = false;
    result.dataset.result = kind;
    result.replaceChildren(h('p', { role: kind === 'refused' ? 'alert' : 'status' }, text));
  }

  const WHAT = { building: 'the building', schedule: 'the schedule', new: 'this project' };

  async function run(entry, opener) {
    const project = ctx.store.project;
    const words = entry.words(project);
    if (words.empty) {
      say('done', words.removes);
      return;
    }
    if (ctx.storage && ctx.storage.state.readOnly) {
      say('refused', READ_ONLY_SENTENCE);
      return;
    }
    const snapshots = pageSnapshots();
    const name = AUTO_SNAPSHOT_NAMES[entry.reason];
    const room = snapshots ? await snapshots.room() : null;
    const ok = await ctx.confirm({
      title: entry.title,
      body: [h('p', null, words.removes), h('p', null, words.keeps), h('p', null, snapshotLine(room, name, WHAT[entry.id]))],
      action: entry.action,
      keep: entry.keep,
      danger: true,
      opener,
    });
    if (!ok) {
      say('done', 'Nothing was cleared.');
      return;
    }
    let taken = null;
    if (snapshots && room && !room.error && !room.full) {
      const answer = await snapshots.takeAuto(entry.reason);
      if (!answer.ok) {
        say('refused', 'Nothing was cleared, because the snapshot could not be taken first. ' + answer.text);
        return;
      }
      taken = answer.snapshot;
    }
    // a new project replaces everything, and everything replaced gets a recovery point
    if (entry.id === 'new' && ctx.storage) await ctx.storage.takeRecoveryPoint('replace');
    const before = ctx.store.project;
    ctx.store.apply(replaceProject, { project: entry.make(before, ctx), label: entry.label });
    if (ctx.store.project === before) {
      say('refused', 'Nothing was cleared.');
      return;
    }
    const where = taken ? ' The snapshot ' + quote(taken.name) + ' has what was there.' : '';
    say('done', entry.done + where + ' Undo brings it back.');
    ctx.toast({ text: entry.done + where, action: { label: 'Undo', run: ctx.undo } });
  }

  const element = card({ id: 'clear', title: 'Clear…' },
    lead,
    CLEARS.map((entry) => {
      const says = h('p', { data: { says: entry.id } });
      const button = h('button', { type: 'button', class: 'btn', data: { action: 'clear-' + entry.id } }, entry.button);
      button.addEventListener('click', () => run(entry, button));
      rows.set(entry.id, says);
      return [says, h('div', { class: 'card__buttons' }, button)];
    }),
    result,
  );

  function update(project) {
    for (const entry of CLEARS) rows.get(entry.id).textContent = entry.words(project).removes;
  }

  update(ctx.store.project);
  return { element, update };
}
