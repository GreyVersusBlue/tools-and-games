// Step-free ways out, as words (spec 10.1, 11; DESIGN 13.6): what a door card
// says under its main block, and how an area of refuge is named. No DOM and no
// canvas: the Safety section, the door cards and the step-free sheet all read
// these, so a sentence is written once.
//
//   UNMARKED_SAYS, TWO_VIEWS_SAYS, ALL_REACHED_SAYS, EVACUATION_NO_ELEVATORS
//     the report's fixed lines
//   hasStepMarks(building) -> boolean
//     true when the building has an area of refuge or any step mark: a
//     corridor cell with a step, a door or an exit with a step. It is the
//     door cards' "Step-free ways out" default (DESIGN 13.6)
//   refugeFor(building, refugeId) -> { id, floorId, cell, name } | null
//   refugeBy(building, refuge) -> 'Stairs B' | 'Elevator D' | null
//     what an area of refuge stands by: the stairs or elevator whose stop is
//     on its cell or on a cell beside it (the nearest; ties go to the first
//     connection in the building's order)
//   refugeEnd(building, refuge) -> { text, parts }
//     "Wait at Area of refuge 2, by Stairs B, for help." (parts: name: true
//     marks what a user typed: the refuge's name and the letter)
//   sameWay(a, b) -> boolean   two routes walk the very same cells
//   stepFreeBlock(project, entry, ordinary) -> block | null
//     entry     one room of stepFreeWaysOut() ({ way, route, refugeId, … })
//     ordinary  the room's evacuation entry ({ route }) from evacuationRoutes()
//     the second block of a door card: null when the card needs none (the
//     step-free way is the main route), else
//       { kind: 'exit' | 'refuge' | 'none', steps: [{ n, kind, text, parts }],
//         sentence }
//     for 'exit' and 'refuge' the steps are the card's own, numbered from 1 and
//     ending at the exit ("Exit at Door A.") or at the refuge; for 'none' there
//     are no steps and `sentence` says why, as the routing engine words it
//
// Every name in a sentence is as typed; whoever prints one escapes it.

import { directions } from '../../engine/directions.js';
import { cardSteps } from '../../engine/evacuation.js';

export const BLOCK_HEAD = 'Step-free way out';
// The report's lines (DESIGN 13.6), said the same on screen and on paper.
export const UNMARKED_SAYS = 'Nothing step-free is marked yet, so this assumes every door and corridor is level. Mark steps, doors with a step, elevators and areas of refuge in Building first.';
export const TWO_VIEWS_SAYS = 'Reaching a room may use an elevator; leaving in an emergency may not.';
export const ALL_REACHED_SAYS = 'Every room can be reached without stairs.';
export const EVACUATION_NO_ELEVATORS = 'An evacuation never uses elevators.';
export const NO_WAY_SAYS = 'There is no step-free way out from this room.';

export function hasStepMarks(building) {
  for (const floor of building.floors) {
    if ((floor.refuges || []).length > 0 || (floor.notStepFree || []).length > 0) return true;
    if ((floor.exits || []).some((exit) => exit && exit.stepFree === false)) return true;
    if (floor.spaces.some((space) => space.kind === 'room' && (space.doors || []).some((door) => door && door.stepFree === false))) return true;
  }
  return false;
}

export function refugeFor(building, refugeId) {
  for (const floor of building.floors) {
    const found = (floor.refuges || []).find((refuge) => refuge && refuge.id === refugeId);
    if (found) return { id: found.id, floorId: floor.id, cell: found.cell, name: found.name };
  }
  return null;
}

export function refugeBy(building, refuge) {
  const floor = building.floors.find((each) => each.id === refuge.floorId);
  if (!floor) return null;
  const x = refuge.cell % floor.width;
  const y = Math.floor(refuge.cell / floor.width);
  let best = null;
  for (const connection of building.connections || []) {
    if (!connection) continue;
    for (const end of [connection.a, connection.b]) {
      if (!end || end.floorId !== floor.id) continue;
      const away = Math.abs((end.cell % floor.width) - x) + Math.abs(Math.floor(end.cell / floor.width) - y);
      if (away > 1 || (best !== null && away >= best.away)) continue;
      const lift = connection.kind === 'elevator';
      const letter = lift ? (connection.car || connection.label) : connection.label;
      best = { away, text: (lift ? 'Elevator ' : 'Stairs ') + (typeof letter === 'string' ? letter : ''), lift, letter: typeof letter === 'string' ? letter : '' };
    }
  }
  return best ? { text: best.text, lift: best.lift, letter: best.letter } : null;
}

export function refugeEnd(building, refuge) {
  const by = refugeBy(building, refuge);
  const parts = [{ text: 'Wait at ', name: false }, { text: refuge.name, name: true }];
  if (by) parts.push({ text: ', by ' + (by.lift ? 'Elevator ' : 'Stairs '), name: false }, { text: by.letter, name: true });
  parts.push({ text: ', for help.', name: false });
  return { text: parts.map((part) => part.text).join(''), parts };
}

export function sameWay(a, b) {
  if (!a || !b || a.ok !== true || b.ok !== true || !Array.isArray(a.cells) || !Array.isArray(b.cells)) return false;
  if (a.cells.length !== b.cells.length) return false;
  return a.cells.every((place, i) => place.floorId === b.cells[i].floorId && place.cell === b.cells[i].cell);
}

export function stepFreeBlock(project, entry, ordinary) {
  const plain = ordinary && ordinary.route ? ordinary.route : null;
  if (entry.way === 'none') {
    // a room with no way out at all has a card that says so already
    if (!plain || plain.ok !== true) return null;
    return { kind: 'none', steps: [], sentence: entry.why ? 'There is no step-free way out from this room: ' + entry.why + '.' : NO_WAY_SAYS, why: entry.why };
  }
  if (entry.way === 'exit') {
    if (sameWay(plain, entry.route)) return null;
    const steps = cardSteps(directions(project, entry.route).steps);
    return { kind: 'exit', steps, sentence: null };
  }
  // a refuge: directions() ends a route at a room, so its last step is replaced
  const refuge = refugeFor(project.building, entry.refugeId);
  if (!refuge) return null;
  const raw = directions(project, entry.route).steps.filter((step) => step.kind !== 'arrive');
  const end = refugeEnd(project.building, refuge);
  const steps = cardSteps(raw);
  steps.push({ n: steps.length + 1, kind: 'refuge', text: end.text, parts: end.parts, refugeId: refuge.id });
  return { kind: 'refuge', steps, sentence: null };
}
