// Words that depend on the project. The school picks its word for a period
// (Period, Mod, Block or Hour) and the interface uses it everywhere.

import { ELEVATOR_KIND, elevatorCars, nextConnectionLabel } from '../../engine/schema.js';

// { One: 'Period', one: 'period', Many: 'Periods', many: 'periods' }
export function periodWords(settings) {
  const word = settings && typeof settings.periodWord === 'string' && settings.periodWord !== '' ? settings.periodWord : 'Period';
  return { One: word, one: word.toLowerCase(), Many: word + 's', many: word.toLowerCase() + 's' };
}

// count(3, 'room') -> "3 rooms"; count(1, 'room') -> "1 room"; count(0, 'room') -> "no rooms".
// A plural that is not the word plus "s" is given as the third argument.
export function count(n, one, many) {
  const plural = many || one + 's';
  if (n === 0) return 'no ' + plural;
  return n + ' ' + (n === 1 ? one : plural);
}

// list(['a', 'b', 'c']) -> "a, b and c"
export function list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

// The letter the next elevator will take, which an elevator stop not yet
// connected shows from the moment it is placed (DESIGN 13.2): the first one
// no connection label and no car letter uses, as describeConnect picks it.
export function pendingElevatorLetter(building) {
  return nextConnectionLabel(building.connections.flatMap((connection) => [{ label: connection.label }, { label: connection.car === undefined ? '' : connection.car }]));
}

// The figures of a project: what is in it, counted from the data. `connections`
// counts stairs only; the elevators, each one however many floors it serves,
// are counted apart (a connected elevator is one).
export function figures(project) {
  let rooms = 0;
  let otherSpaces = 0;
  let exits = 0;
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') rooms += 1;
      else otherSpaces += 1;
    }
    exits += floor.exits.length;
  }
  return {
    floors: project.building.floors.length,
    rooms,
    otherSpaces,
    exits,
    connections: project.building.connections.filter((connection) => connection.kind !== ELEVATOR_KIND).length,
    elevators: elevatorCars(project.building).filter((car) => car.connectionIds.length > 0).length,
    teachers: project.teachers.length,
    groups: project.groups.length,
    subjects: project.subjects.length,
    dayTypes: project.dayTypes.length,
  };
}
