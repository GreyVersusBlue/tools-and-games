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
// Folding uses no locale, so it says the same on every device.

export function fold(text) {
  return String(text).normalize('NFKC').trim().toLowerCase();
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
//   { kind: 'room', option }       one room: its number, its whole label, or
//                                  text that names it alone by its teacher
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
  const wanted = fold(text);
  const number = withoutRoomWord(wanted);
  const exact = rooms.filter((option) => {
    const own = fold(option.number);
    return (own !== '' && (own === wanted || own === number)) || fold(option.label) === wanted;
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
// room. A room with no number has no label of its own to start: its label
// is the tool's words for it, and only its teachers find it. "No room" (id
// null) is offered only with every room.
export function listFor(typed, options) {
  const wanted = fold(typed);
  if (wanted === '') return options.slice();
  const number = withoutRoomWord(wanted);
  return options.filter((option) => {
    if (option.id === null) return false;
    const own = fold(option.number);
    if (own === '') return fold(option.teachers || '').includes(wanted);
    const label = fold(option.label);
    return own.includes(wanted) || own.includes(number) || label.startsWith(wanted) || label.startsWith(number) || fold(option.teachers || '').includes(wanted);
  });
}

// "2 rooms match. Pick one from the list."
export function severalWords(n) {
  return n + ' rooms match. Pick one from the list.';
}
