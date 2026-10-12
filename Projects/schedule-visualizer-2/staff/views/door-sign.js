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
// Korean, the fullwidth forms, emoji): each takes the room of two Latin ones.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];

function widthOf(text) {
  let width = 0;
  for (const character of String(text)) {
    const point = character.codePointAt(0);
    width += WIDE.some(([from, to]) => point >= from && point <= to) ? 2 : 1;
  }
  return width;
}

// The number is set at 120 pt when it is as short as a number is. A longer
// one ("Cafeteria") is set smaller by this much, so it stays on one line.
// Seven Latin characters fit at full size; a full-square character counts as
// two of them.
export function signFit(text) {
  return Math.max(0.3, Math.min(1, 7 / Math.max(1, widthOf(text))));
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
  return el('section', { class: 'sign', 'aria-label': 'The sign' },
    el('div', { class: 'sign__card' },
      worded ? el('p', { class: 'sign__word' }, 'Room') : null,
      el('p', { class: 'sign__number', style: '--sign-fit: ' + signFit(big), 'data-sign': 'number' }, numbered ? typedName(big) : big),
      teachers.length > 0 ? el('p', { class: 'sign__teacher', 'data-sign': 'teacher' }, wordsJoined(teachers.map((teacher) => typedName(teacher.name)))) : null,
      subject ? el('p', { class: 'sign__subject', 'data-sign': 'subject' }, typedName(subject.name)) : null,
      el('p', { class: 'sign__school', 'data-sign': 'school' }, typedName(typeof opts.school === 'string' ? opts.school : school.name))),
    opts.day === true ? dayOf(school, room) : null);
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
