// The rules of the room picker that need no page: what typed text means, and
// which rooms a list shows for it. room-picker.js draws by them, and a plain
// Node test pins them (test/ui/room-picker.test.mjs).
//
// A room here is one of the picker's options, { id, number, label, teachers }:
// the label is "204 — Ms. Okafor", the number then the room's teachers, and
// `teachers` is the teachers alone ("Ms. Okafor"), so that nothing else in
// the label is read as a teacher: not the words that stand for a room with no
// number ("a room with no number"), and not a number with spaces round it.
//
// Text is compared folded: spaces round it and the case of its letters do
// not count, and neither do the forms of one letter (NFKC: a full-width
// "１０１" is "101", and an "é" typed as two code points is the one "é").
// Inside it, a run of spaces is one space, and a run of hyphens or dashes
// with the spaces round it is the label's " — ", since a keyboard has no
// em dash: "101 - Ms. Okafor", "101-Ms. Okafor" and "101  —  ms. okafor"
// are all the label "101 — Ms. Okafor" (SV2-56 item 4). Both sides of every
// comparison are folded by this one function, so a hyphen inside a name
// ("Okonjo-Reyes") or a number ("B-12") still meets itself. Folding uses no
// locale, so it says the same on every device.
//
// Folding is for finding a room; it never makes two rooms one. The engine
// keeps "B-12" and "B–12", "Portable 1" and "Portable  1", and "Gym-North"
// and Gym (whose label is "Gym — North") apart, since its key for a number
// is only trimmed and lower case (engine/schema.js, `roomNumberKey`). So a
// typed text that is exactly one room's number by that key (with NFKC, as
// above) is that room before anything is folded (`byNumber`, SV2-56b).

import { roomNumberKey } from '../../engine/schema.js';

const DASHES = /\s*[-\u2010-\u2015\u2212]+\s*/gu;

export function fold(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(DASHES, ' \u2014 ').replace(/\s+/gu, ' ').trim();
}

// The one room whose number is the typed text by the engine's key (NFKC,
// trimmed, lower case, nothing inside it folded), or "Room " and that
// number; null when no room's number is, or two are (two numbers NFKC makes
// one, which the engine keeps apart: then the folded rules below decide).
export function byNumber(typed, rooms) {
  const key = numberKey(typed);
  if (key === '') return null;
  for (const wanted of [key, withoutRoomWord(key)]) {
    const found = rooms.filter((option) => option.id !== null && numberKey(option.number) === wanted);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

function numberKey(text) {
  return roomNumberKey(String(text).normalize('NFKC'));
}

// "Room 101" is how the tool names Room 101 in a sentence (engine/schema.js,
// nameOfRoom), so it is Room 101 when typed. The word alone is nothing.
function withoutRoomWord(folded) {
  const match = /^room\s+(.+)$/u.exec(folded);
  return match ? match[1] : folded;
}

// What typed text means, read when the field is left or Enter is pressed
// with nothing chosen in the list. One of
//
//   { kind: 'none' }               nothing typed: no room
//   { kind: 'room', option }       one room: its number as the engine keys it
//                                  (`byNumber`, before anything is folded),
//                                  its number or whole label folded, or
//                                  text that names it alone by its teacher
//                                  (the whole label of a room with no number
//                                  only when it carries teachers: "a room
//                                  with no number" alone is nobody's room)
//   { kind: 'several', options }   a number or label two rooms share, or text
//                                  in the teachers of two: none is chosen
//   { kind: 'keep', text }         no room: kept as typed
//
// A number is never turned into another number: "10" is not Room 101,
// however few rooms there are, since only a room's teachers are looked
// through for part of what was typed. Two rooms are never settled between
// here: whoever asked says so and lets the user pick (DECISIONS 2026-10-12
// 14:47).
export function readTyped(typed, rooms) {
  const text = String(typed).trim();
  if (text === '') return { kind: 'none' };
  const own = byNumber(text, rooms);
  if (own) return { kind: 'room', option: own };
  const wanted = fold(text);
  const number = withoutRoomWord(wanted);
  const exact = rooms.filter((option) => {
    const own = fold(option.number);
    if (own !== '') return own === wanted || own === number || fold(option.label) === wanted;
    // a room with no number: its label is the tool's words for it, and
    // names it only where it carries the room's teachers
    return fold(option.teachers || '') !== '' && fold(option.label) === wanted;
  });
  if (exact.length === 1) return { kind: 'room', option: exact[0] };
  if (exact.length > 1) return { kind: 'several', options: exact };
  const byTeacher = rooms.filter((option) => fold(option.teachers || '').includes(wanted));
  if (byTeacher.length === 1) return { kind: 'room', option: byTeacher[0] };
  if (byTeacher.length > 1) return { kind: 'several', options: byTeacher };
  return { kind: 'keep', text };
}

// The options a list shows for what is in the field: all of them for no
// text, otherwise the rooms with the text in their number or their teachers
// ("Room 101" finds 101), or at the start of their label, so that a label
// typed or picked and then cut short ("101 — Ms. Okafo") still lists its
// room. A room with no number is found by its teachers, and by the start of
// its label only once the text reaches into them ("a room with no number —
// Ms. Pelle"): the words before them are the tool's, and name no room
// (readTyped picks its whole label, so the list shows it for that too).
// "No room" (id null) is offered only with every room.
export function listFor(typed, options) {
  const wanted = fold(typed);
  if (wanted === '') return options.slice();
  const number = withoutRoomWord(wanted);
  return options.filter((option) => {
    if (option.id === null) return false;
    const own = fold(option.number);
    if (own === '') return fold(option.teachers || '').includes(wanted) || startsIntoTeachers(wanted, option);
    const label = fold(option.label);
    return own.includes(wanted) || own.includes(number) || label.startsWith(wanted) || label.startsWith(number) || fold(option.teachers || '').includes(wanted);
  });
}

// Whether folded text starts the label of a room with no number and goes on
// past the tool's words into its teachers. A label that does not end in its
// teachers is matched whole only, as readTyped matches it.
function startsIntoTeachers(wanted, option) {
  const teachers = fold(option.teachers || '');
  if (teachers === '') return false;
  const label = fold(option.label);
  if (!label.endsWith(teachers)) return label === wanted;
  return label.startsWith(wanted) && wanted.length > label.length - teachers.length;
}

// "2 rooms match. Pick one from the list."
export function severalWords(n) {
  return n + ' rooms match. Pick one from the list.';
}
