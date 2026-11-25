// The addresses of the Movement section that name a choice, written and read
// (ARCHITECTURE 23.12). No page is needed for either, so a plain Node test
// can ask (test/ui/movement-filters.test.mjs).
//
//   #movement/teacher/<teacherId>[/<dayTypeId>[/<period>]]   a teacher's day
//   #movement/to/<roomId>                                    only walks into a room
//
// with the period counted from 0 as the model counts it, naming the
// transition out of that period. `#movement` alone is the view as it was.
// Choosing in the controls writes no address: these are for a link from
// another section (a teacher's name, a room's card), and Back returns to
// where the link was followed from.

import { findDayType, effectiveDayType } from '../../engine/day-types.js';
import { findById, findRoom } from '../../engine/schema.js';

export const MOVEMENT_HASH = '#movement';

function encoded(part) {
  return encodeURIComponent(String(part));
}

function decoded(part) {
  try {
    return decodeURIComponent(part);
  } catch (error) {
    return part;
  }
}

// The part of an address after "#movement/" ('' for "#movement" alone), or
// null for an address of another section.
export function movementRest(hash) {
  const match = /^#\/?movement(?:\/(.*))?$/.exec(String(hash));
  return match ? match[1] || '' : null;
}

// The choice an address names, as the fields of the movement choice to lay
// over the current one (settleChoice puts the rest right), or null when it
// names nothing the project has: a teacher or room that is gone (deleted
// since the address was written, or never there), a kind of address that is
// not one of these.
//
//   { who: 'teacher', teacherId, dayTypeId?, transition? }
//   { toRoomId }
//
// `dayTypeId` is there when the address names a day type the project has (a
// day type that is the same as another gives the day it copies, since that is
// the one with the classes); `transition` only with it, when the period is a
// whole number that has a walk out of it (the last period has none). A day
// type or period the project does not have is left out and the teacher is
// still shown. `rest` is what follows "#movement/".
export function readMovementAddress(project, rest) {
  const parts = String(rest === undefined || rest === null ? '' : rest).split('/').map(decoded);
  if (parts[0] === 'teacher' && parts[1]) {
    const teacher = findById(project.teachers, parts[1]);
    if (!teacher) return null;
    const choice = { who: 'teacher', teacherId: teacher.id };
    const dayType = parts[2] ? findDayType(project, parts[2]) : null;
    if (!dayType) return choice;
    choice.dayTypeId = effectiveDayType(project, dayType.id).id;
    const period = /^\d+$/.test(parts[3] || '') ? Number(parts[3]) : -1;
    if (period >= 0 && period + 1 < project.settings.periods) choice.transition = period;
    return choice;
  }
  if (parts[0] === 'to' && parts[1]) {
    const room = findRoom(project, parts[1]);
    return room ? { toRoomId: room.id } : null;
  }
  return null;
}

// The address of a choice (or of what readMovementAddress gave): a teacher's
// when the choice shows one, else the room's when it has a destination room,
// else "#movement". The day type and the transition follow the teacher's id
// when they are set, the transition only after the day type.
export function movementHash(choice) {
  if (choice && choice.who === 'teacher' && typeof choice.teacherId === 'string' && choice.teacherId !== '') {
    const parts = [MOVEMENT_HASH, 'teacher', encoded(choice.teacherId)];
    if (typeof choice.dayTypeId === 'string' && choice.dayTypeId !== '') {
      parts.push(encoded(choice.dayTypeId));
      if (Number.isInteger(choice.transition) && choice.transition >= 0) parts.push(String(choice.transition));
    }
    return parts.join('/');
  }
  if (choice && choice.who !== 'teacher' && typeof choice.toRoomId === 'string' && choice.toRoomId !== '') return MOVEMENT_HASH + '/to/' + encoded(choice.toRoomId);
  return MOVEMENT_HASH;
}
