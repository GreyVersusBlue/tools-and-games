// Auto-number (spec 4.3's wish; ARCHITECTURE 22.5; DESIGN 16.3 and 16.12 item 5):
// the next room number in a sequence. Plain Node, no state: the switch is the
// device's and the next number is the building section's view state, so
// nothing here is saved or undone.
//
//   splitNumber(number)             { prefix, digits, suffix } at the last run of digits, or null
//   plainNext(number)               the number after this one, used or not, or null
//   nextRoomNumber(project, seed)   the number after the seed that no room has, or null
//   firstRoomNumber(project, floorId)  where a floor's sequence starts
//   copyNumber(number, used)        a duplicate's own number: "Library" is "Library 2"
//
// A number splits at its last run of digits: "B-12" is B-, 12, "" and "1004A"
// is "", 1004, A. The next is the digits plus one at the same width or wider
// ("099" becomes "100", "9" becomes "10") with the prefix and suffix kept.

import { roomNumberKey, allRooms } from './schema.js';

// How many used numbers it will step over before giving up.
export const SKIP_MOST = 999;

// { prefix, digits, suffix } for a number with digits in it, else null.
export function splitNumber(number) {
  if (typeof number !== 'string') return null;
  const text = number.trim();
  const match = /^(.*?)([0-9]+)([^0-9]*)$/su.exec(text);
  if (!match) return null;
  return { prefix: match[1], digits: match[2], suffix: match[3] };
}

function bump(parts, by) {
  const value = (BigInt(parts.digits) + BigInt(by)).toString();
  return parts.prefix + value.padStart(parts.digits.length, '0') + parts.suffix;
}

// The number after this one, whether or not a room has it. Null with no digits.
export function plainNext(number) {
  const parts = splitNumber(number);
  return parts === null ? null : bump(parts, 1);
}

function usedKeys(project) {
  return new Set(allRooms(project).filter((room) => typeof room.number === 'string' && room.number.trim() !== '').map((room) => roomNumberKey(room.number)));
}

// The first number after `seed` that no room in the building has, stepping at
// most SKIP_MOST times; null for a seed with no digits ("Auto-number needs a
// number with digits in it, such as 101.") or when every step is taken.
export function nextRoomNumber(project, seed) {
  const parts = splitNumber(seed);
  if (parts === null) return null;
  const used = usedKeys(project);
  for (let step = 1; step <= SKIP_MOST; step += 1) {
    const candidate = bump(parts, step);
    if (!used.has(roomNumberKey(candidate))) return candidate;
  }
  return null;
}

// Where the sequence on a floor starts: one past the highest number on the
// floor, by the same split (the digits compared as numbers), stepping over used
// numbers; with none numbered, the level times 100 plus 1 ("301" on level 3),
// and for a level of 0 or below "1" and up (a basement's "B01" is the user's to
// type). Null for a floor that is not there, or when every step is taken.
export function firstRoomNumber(project, floorId) {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId);
  if (!floor) return null;
  let highest = null;
  for (const space of floor.spaces) {
    if (space.kind !== 'room') continue;
    const parts = splitNumber(space.number);
    if (parts === null) continue;
    if (highest === null || BigInt(parts.digits) > BigInt(highest.parts.digits)) highest = { parts, number: space.number.trim() };
  }
  if (highest !== null) return nextRoomNumber(project, highest.number);
  return nextRoomNumber(project, String(Math.max(0, floor.level) * 100));
}

// A duplicated room's own number when its number cannot follow the floor
// (ARCHITECTURE 22.17, Devon 2026-11-21): the number as typed with " 2" after
// it, or " 3" and on when that is taken; a number already ending in a space and
// a count ("Library 2", a copy's copy) goes on counting ("Library 3"). `used`
// is a Set of roomNumberKey's keys; the one returned is added to it.
export function copyNumber(number, used) {
  const text = String(number).trim();
  const counted = /^(.*\S) ([0-9]+)$/su.exec(text);
  const base = counted ? counted[1] : text;
  let n = counted ? BigInt(counted[2]) + 1n : 2n;
  for (;;) {
    const candidate = base + ' ' + n.toString();
    if (!used.has(roomNumberKey(candidate))) {
      used.add(roomNumberKey(candidate));
      return candidate;
    }
    n += 1n;
  }
}
