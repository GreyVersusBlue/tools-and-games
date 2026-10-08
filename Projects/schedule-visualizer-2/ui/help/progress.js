// Getting started: the five steps of a new project, and which are done.
// Pure: it reads the project and nothing else, so it runs in Node tests too.
// A step is ticked when the project has what the step asks for, not when a
// button was pressed, so loading a file or the sample school ticks them too.
// The one exception is the last: "look at the movement view" is ticked by the
// movement view itself, through `onboarding.steps.movement`.

import { CELL_CORRIDOR, resolveSlotRoom } from '../../engine/schema.js';

export const MOVEMENT_STEP = 'movement';

function rooms(project) {
  const found = [];
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') found.push(space);
  }
  return found;
}

// A corridor and a room, on the same floor.
function hasDrawnFloor(project) {
  return project.building.floors.some((floor) => floor.cells.includes(CELL_CORRIDOR) && floor.spaces.some((space) => space.kind === 'room'));
}

// At least one room, and none without a number.
function everyRoomNumbered(project) {
  const all = rooms(project);
  return all.length > 0 && all.every((room) => typeof room.number === 'string' && room.number.trim() !== '');
}

// A group with at least one period in a room that is in the building.
function hasGroupWithRoom(project) {
  return project.groups.some((group) => Object.values(group.days).some((day) => day.some((slot) => resolveSlotRoom(project, slot).room !== null)));
}

export const STEPS = [
  { id: 'floor', label: 'Draw or trace a floor', where: 'Building', hash: '#building', done: hasDrawnFloor },
  { id: 'rooms', label: 'Number the rooms', where: 'Building › Rooms', hash: '#building', done: everyRoomNumbered },
  { id: 'teachers', label: 'Add teachers', where: 'Schedule › Teachers', hash: '#schedule/teachers', done: (project) => project.teachers.length > 0 },
  { id: 'groups', label: 'Add groups', where: 'Schedule › Groups', hash: '#schedule/groups', done: hasGroupWithRoom },
  { id: MOVEMENT_STEP, label: 'Look at the movement view', where: 'Movement', hash: '#movement', done: (project) => project.onboarding.steps[MOVEMENT_STEP] === true },
];

// [{ id, label, where, hash, done }] for this project, in order.
export function progress(project) {
  return STEPS.map((step) => ({ id: step.id, label: step.label, where: step.where, hash: step.hash, done: step.done(project) === true }));
}

// Should the card be on screen?
export function showGettingStarted(project) {
  return !project.onboarding.dismissed && !project.onboarding.neverShow;
}
