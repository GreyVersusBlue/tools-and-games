// #/door/r…  Door sign
//
// A card for a classroom door: the room's number large, the teacher, the
// subject, and, when the box is ticked (?day=1), who is in the room each
// period. What is on screen is the sheet as it prints, drawn as paper
// whatever the theme; on paper the sheet is all there is (the door sign's
// rules in the @media print block of staff/staff.css).
// Who is in the room is the room page's own answer (roomUse).
//
// The sign is made once, as a tree of plain objects (signTree), and written
// two ways from it: as elements for this page, and as markup with every name
// escaped (doorSignMarkup) for the planner's batch of door signs, which is a
// print document and so a string. Neither can say something the other does
// not.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage, printButton } from '../page.js';
import { wordsJoined, dayKindsOf } from './teacher.js';
import { roomUse } from './room.js';

// Scripts whose characters are set a full square wide (Chinese, Japanese,
// Korean, the leading consonants of Hangul written in parts, the fullwidth
// forms, the hexagrams, the vertical and the small forms of punctuation,
// Tangut, the kana supplements, emoji, the symbols and tiles that are drawn
// as emoji, in their two blocks and where they stand alone: the watch, the
// hourglass, the small squares): each takes the room of two Latin ones.
const WIDE = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2600, 0x27bf], [0x2b00, 0x2bff], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4dc0, 0x4dff], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97c],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe4f], [0xfe50, 0xfe6b], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x17000, 0x18d8f], [0x1b000, 0x1b2ff], [0x1f000, 0x1f2ff], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];
// What takes no room of its own: the spaces and marks that are not drawn,
// the marks that choose between forms of the character before (U+FE0F is
// the one that can widen it, below), and the tags that spell out a flag's
// region after a black flag.
const NONE = [[0x200b, 0x200c], [0x2060, 0x2060], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xe0020, 0xe007f]];
// An accent, a vowel sign or a ring that sits on, under or around the
// character before it: every nonspacing and enclosing mark, in any script.
const MARK = /^[\p{Mn}\p{Me}]$/u;
// The two letters of a flag: a pair is one picture.
const FLAG = [[0x1f1e6, 0x1f1ff]];
// The symbols that are narrow when their plain, text form is asked for.
const SYMBOLS = [[0x2190, 0x2bff]];
// The pictures a joiner can join, and a skin tone can colour.
const PICTURE = [[0x2600, 0x27bf], [0x1f000, 0x1ffff]];
// The five skin tones: none after a picture, a square of colour anywhere else.
const TONE = [[0x1f3fb, 0x1f3ff]];
// Hangul written in parts: a leading consonant opens a square, a vowel after
// it is drawn inside that square, and a final after a vowel (or after a whole
// syllable of a consonant and a vowel) too. Standing alone, a vowel or a final
// is a glyph of its own, counted as the square it can take.
const LEADING = [[0x1100, 0x115f], [0xa960, 0xa97c]];
const VOWEL = [[0x1160, 0x11a7], [0xd7b0, 0xd7c6]];
const FINAL = [[0x11a8, 0x11ff], [0xd7cb, 0xd7fb]];
const JOINER = 0x200d;
const AS_TEXT = 0xfe0e;
const AS_EMOJI = 0xfe0f;
const KEYCAP = 0x20e3;

const within = (ranges, point) => ranges.some(([from, to]) => point >= from && point <= to);
// a whole Hangul syllable of a consonant and a vowel, with no final yet
const openSyllable = (point) => point >= 0xac00 && point <= 0xd7a3 && (point - 0xac00) % 28 === 0;

// How much of a line a text takes, in Latin characters. A joiner between two
// pictures draws them as one, so the second takes no room: a family of three
// is one emoji, two wide. Between letters, with nothing before it, or after
// another joiner, a joiner joins nothing and each character keeps its room.
// Two flag letters are one flag; "e" with an accent after it is one letter.
// A narrow character asked for as an emoji (U+FE0F), or made a keycap, is
// drawn as an emoji, two wide. Where the count is unsure it counts more, never
// less: a number counted short is set too large and wraps to a second line.
export function signWidth(text) {
  let width = 0;
  let last = 0; // the room the character before took: 1, 2, or 0 at the start
  let lastPoint = 0; // the character drawn last (a joined or toned one keeps the picture's)
  let previous = 0; // the code point just before, whatever it was
  let picture = false; // what was drawn last is a picture
  let toned = false; // and it has its skin tone already
  let joining = false; // a joiner stands after a picture
  let flag = false; // the character before is the first letter of a flag
  for (const character of String(text)) {
    const point = character.codePointAt(0);
    const before = previous;
    previous = point;
    if (point === JOINER) {
      joining = picture && before !== JOINER;
      continue;
    }
    if (point === AS_TEXT) {
      if (last === 2 && within(SYMBOLS, lastPoint)) {
        width -= 1;
        last = 1;
      }
      continue;
    }
    if ((point === AS_EMOJI || point === KEYCAP) && last === 1) {
      width += 1;
      last = 2;
      continue;
    }
    if (within(TONE, point) && picture && !toned && !joining) {
      toned = true;
      continue;
    }
    if (within(VOWEL, point) && within(LEADING, before)) continue;
    if (within(FINAL, point) && (within(VOWEL, before) || openSyllable(before))) continue;
    if (within(NONE, point) || MARK.test(character)) continue;
    const pictured = within(PICTURE, point) && !within(TONE, point);
    const joined = joining && pictured;
    joining = false;
    if (joined) {
      flag = false;
      toned = false;
      continue;
    }
    const second = flag && within(FLAG, point);
    flag = !second && within(FLAG, point);
    if (second) continue;
    const wide = within(WIDE, point) || within(VOWEL, point) || within(FINAL, point);
    last = wide ? 2 : 1;
    lastPoint = point;
    picture = pictured;
    toned = false;
    width += last;
  }
  return width;
}

// The number is set at 120 pt when it is as short as a number is. A longer
// one ("Cafeteria") is set smaller by this much, so it stays on one line.
// Seven Latin characters fit at full size; a full-square character counts as
// two of them.
export function signFit(text) {
  return Math.max(0.3, Math.min(1, 7 / Math.max(1, signWidth(text))));
}

// ---- the sign as a tree: { tag, attrs, children }, a child being a node or text

function el(tag, attrs, ...children) {
  return { tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) };
}

// A name somebody typed, kept apart from the words around it so a name in a
// right-to-left script does not reorder its neighbours. dom.js's typed() is a
// <bdi>; here it is a span with dir="auto", which isolates the same way,
// because the planner's print documents are held to a fixed list of tags
// (test/engine/prints.test.mjs) and <bdi> is not one of them. The sign is
// the same markup on the page and in the batch.
const typedName = (text) => el('span', { dir: 'auto' }, String(text));

// The subject the sign names: the room's own; with none, the one its
// teachers share. Teachers of different subjects share none, so none is named.
function subjectOf(school, room, teachers) {
  const own = school.subject(room.subjectId);
  if (own) return own;
  const ids = new Set(teachers.map((teacher) => teacher.subjectId || ''));
  return ids.size === 1 ? school.subject(teachers[0].subjectId) : null;
}

function dayOf(school, room) {
  const uses = new Map(school.dayTypes.map((dayType) => [dayType.id, roomUse(school, room.id, dayType.id)]));
  const kinds = dayKindsOf(school, (dayType) => uses.get(dayType.id).map((period) => period.map((use) => [use.group.id, use.label, use.teachers.map((teacher) => teacher.id)])));
  return el('div', { class: 'sign__day', 'data-sign': 'day', 'data-count': String(kinds.length) }, kinds.map((kind) => {
    const bells = school.bells(kind.first.id);
    return el('section', { class: 'sign__kind' },
      el('h2', { class: 'sign__kindname' }, wordsJoined(kind.dayTypes.map((dayType) => typedName(dayType.name)))),
      el('table', { class: 'sign__table' },
        el('tbody', null, uses.get(kind.first.id).map((here, period) => {
          const bell = bells[period];
          const who = [];
          for (const use of here) {
            for (const teacher of use.teachers) {
              if (!who.some((each) => each.id === teacher.id)) who.push(teacher);
            }
          }
          return el('tr', null,
            el('th', { scope: 'row' }, school.periodName(period)),
            el('td', null, bell && bell.start && bell.end ? school.time(bell.start) + ' to ' + school.time(bell.end) : ''),
            el('td', null, here.length === 0 ? 'Empty' : wordsJoined(here.map((use) => typedName(use.group.name)))),
            el('td', null, wordsJoined(who.map((teacher) => typedName(teacher.name)))));
        }))));
  }));
}

// options.day     true puts the room's day on the sign
// options.school  the line at the foot, when it is not the school's own name
function signTree(school, room, options) {
  const opts = options || {};
  const name = school.roomName(room, true);
  const numbered = room.number.trim() !== '';
  // "Room 204" is the word and the number; "Gym" is the number alone
  const worded = numbered && name === 'Room ' + room.number;
  const teachers = (room.teacherIds || []).map((id) => school.teacher(id)).filter(Boolean);
  const subject = subjectOf(school, room, teachers);
  const big = numbered ? room.number : 'Room';
  const day = opts.day === true;
  // The school's name is the sheet's foot. With the room's day on the sign it
  // comes after the day, so on a phone, where the card and the day are two
  // boxes, it is under the periods and not at the foot of the card above
  // them. On paper and from 640 px the card is no box at all (display:
  // contents) and the name is last either way.
  const foot = el('p', { class: 'sign__school', 'data-sign': 'school' }, typedName(typeof opts.school === 'string' ? opts.school : school.name));
  return el('section', { class: 'sign', 'aria-label': 'The sign' },
    el('div', { class: 'sign__card' },
      worded ? el('p', { class: 'sign__word' }, 'Room') : null,
      el('p', { class: 'sign__number', style: '--sign-fit: ' + signFit(big), 'data-sign': 'number' }, numbered ? typedName(big) : big),
      teachers.length > 0 ? el('p', { class: 'sign__teacher', 'data-sign': 'teacher' }, wordsJoined(teachers.map((teacher) => typedName(teacher.name)))) : null,
      subject ? el('p', { class: 'sign__subject', 'data-sign': 'subject' }, typedName(subject.name)) : null,
      day ? null : foot),
    day ? dayOf(school, room) : null,
    day ? foot : null);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escaped(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function markupOf(node) {
  if (typeof node === 'string') return escaped(node);
  const attrs = Object.entries(node.attrs).map(([key, value]) => ' ' + key + '="' + escaped(value) + '"').join('');
  return '<' + node.tag + attrs + '>' + node.children.map(markupOf).join('') + '</' + node.tag + '>';
}

function nodeOf(node) {
  return typeof node === 'string' ? node : h(node.tag, node.attrs, node.children.map(nodeOf));
}

// The sign's body as markup, every name escaped: what goes inside a sheet.
// `school` is openSchool()'s answer. It reads nothing but its arguments.
export function doorSignMarkup(school, room, options) {
  return markupOf(signTree(school, room, options));
}

export const doorView = {
  id: 'door',
  flag: 'room',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.room(route.id);
    return found ? 'Door sign: ' + ctx.school.roomName(found, true) : 'Door sign';
  },
  render(ctx, route) {
    const school = ctx.school;
    const room = school.room(route.id);
    if (!room) return missingPage('room');
    const name = school.roomName(room, true);

    const sheet = h('div', { class: 'sheet', 'data-theme': 'light', dataset: { sheet: 'door' } });
    const box = h('input', { class: 'check__input', id: 'door-day', type: 'checkbox', checked: route.query.day === '1' });
    const draw = () => sheet.replaceChildren(nodeOf(signTree(school, room, { day: box.checked })));
    box.addEventListener('change', () => {
      ctx.replace(makeHash('door', room.id, { day: box.checked ? '1' : '' }));
      draw();
    });
    draw();

    return pageOf(['Door sign: ', typed(name)], 'This is the sign as it prints: one sheet for the door.',
      h('div', { class: 'controls no-print' },
        h('label', { class: 'check', for: 'door-day' }, box, h('span', null, 'Show the room\'s day on the sign')),
        h('p', { class: 'actions' },
          printButton('Print the sign', true),
          school.has('room') ? h('a', { class: 'btn', href: makeHash('room', room.id) }, h('span', null, 'Back to ', typed(name))) : null)),
      sheet);
  },
};
