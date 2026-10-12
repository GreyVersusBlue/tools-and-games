// The rules of the room picker that need no page: what typed text means, and
// which rooms a list shows for it. room-picker.js draws by them, and a plain
// Node test pins them (test/ui/room-picker.test.mjs).
//
// A room here is one of the picker's options, { id, number, label }: the
// label is "204 — Ms. Okafor", the number then the room's teachers.

import { roomNumberKey } from '../../engine/schema.js';

// What typed text means, read when the field is left or Enter is pressed
// with nothing chosen in the list. One of
//
//   { kind: 'none' }               nothing typed: no room
//   { kind: 'room', option }       one room: its number, its whole label, or
//                                  text that names it alone by its teacher
//   { kind: 'several', options }   a number or label two rooms share, or text
//                                  in the teachers of two: none is chosen
//   { kind: 'keep', text }         no room: kept as typed
//
// Spaces around the text and the case of its letters do not count. A number
// is never turned into another number: "10" is not Room 101, however few
// rooms there are, since only the part of a label after the number is looked
// through for a teacher. Two rooms are never settled between here: whoever
// asked says so and lets the user pick (DECISIONS 2026-10-12 14:47).
export function readTyped(typed, rooms) {
  const text = String(typed).trim();
  if (text === '') return { kind: 'none' };
  const wanted = text.toLowerCase();
  const exact = rooms.filter((option) => roomNumberKey(option.number) === roomNumberKey(text) || option.label.trim().toLowerCase() === wanted);
  if (exact.length === 1) return { kind: 'room', option: exact[0] };
  if (exact.length > 1) return { kind: 'several', options: exact };
  const byTeacher = rooms.filter((option) => option.label.slice(option.number.length).toLowerCase().includes(wanted));
  if (byTeacher.length === 1) return { kind: 'room', option: byTeacher[0] };
  if (byTeacher.length > 1) return { kind: 'several', options: byTeacher };
  return { kind: 'keep', text };
}

// The options a list shows for what is in the field: all of them for no
// text, otherwise the rooms with the text anywhere in their label. "No room"
// (id null) is offered only with every room.
export function listFor(typed, options) {
  const wanted = String(typed).trim().toLowerCase();
  if (wanted === '') return options.slice();
  return options.filter((option) => option.id !== null && option.label.toLowerCase().includes(wanted));
}

// "2 rooms match. Pick one from the list."
export function severalWords(n) {
  return n + ' rooms match. Pick one from the list.';
}
