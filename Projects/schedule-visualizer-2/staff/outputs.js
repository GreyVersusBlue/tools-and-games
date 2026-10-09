// What a reader can take away from a teacher's page: the page on paper, the
// schedule as an image for a phone's lock screen, and the door sign for the
// teacher's room. And, beside them, the reader saying "this is me".
//
// The image is 1170 by 2532 pixels, the screen of a current phone held
// upright, whatever device makes it. It is laid out in a space a third of
// that (390 by 844) and drawn three times the size. A lock screen puts its
// clock over the top third and two buttons in the bottom corners, so the top
// is left empty, the schedule sits in the middle with a column for each kind
// of day, and the school's name and the date the schedule was published go
// between the buttons. It carries no time of its own: nothing on it says when
// it was made, only what was published and when. Notes are not on it: a lock
// screen is seen by whoever picks the phone up.
//
// The layout is worked out with no canvas (lockScreenLayout), so it can be
// read as a list of what is written where; paintLockScreen draws that list.

import { h, typed } from './dom.js';
import { makeHash } from './router.js';
import { dayText } from './dates.js';
import { printButton } from './page.js';
import { isMe, chooseMe, forgetMe } from './notes.js';

export const LOCK_WIDTH = 1170;
export const LOCK_HEIGHT = 2532;
export const LOCK_SCALE = 3;
// In the 390 by 844 space: nothing is written above LOCK_TOP (the clock's
// place) and the schedule ends by LOCK_BOTTOM (the buttons' place).
export const LOCK_TOP = 290;
export const LOCK_BOTTOM = 728;

const SIDE = 24;
const GAP = 14;
const MAX_COLUMNS = 3;

// "Ms. Okafor" → "ms-okafor-schedule.png". Letters and digits of any script
// are kept; everything else is a hyphen.
export function imageName(name) {
  const words = String(name).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return (words === '' ? 'teacher' : words) + '-schedule.png';
}

// What a teacher has in a period, as plain words for the image:
// "6A · 101", "6C, 7C · 203", "Planning".
function entryText(school, entry) {
  if (!entry || entry.kind !== 'teaching') return 'Planning';
  const groups = entry.groups.map((taught) => {
    const group = school.group(taught.groupId);
    return group ? group.name : 'a group';
  });
  const rooms = [];
  for (const taught of entry.groups) {
    const room = taught.roomId ? school.room(taught.roomId) : null;
    const text = room ? (room.number.trim() === '' ? school.roomName(room) : room.number) : taught.roomText || '';
    if (text !== '' && !rooms.includes(text)) rooms.push(text);
  }
  return groups.join(', ') + (rooms.length > 0 ? ' · ' + rooms.join(', ') : '');
}

// Everything the image says and where, in the 390 by 844 space:
//
//   { width, height, items: [
//       { kind: 'text', text, x, y, size, weight, face, tone, align, fit }
//       { kind: 'rule', x, y, w } ] }
//
// `face` is 'ui' or 'plan', `tone` is 'ink', 'soft' or 'accent', `fit` is the
// width the text has (the painter shortens what is longer, with an ellipsis).
// `kinds` is dayKindsOf()'s answer for the teacher: the day types, with those
// that are the same day put together. `when` is { locale, zone } for the
// tests; left out, the date is in the reader's own language and zone.
export function lockScreenLayout(school, teacher, kinds, when) {
  const width = LOCK_WIDTH / LOCK_SCALE;
  const height = LOCK_HEIGHT / LOCK_SCALE;
  const items = [];
  const text = (value, x, y, size, more) => items.push({ kind: 'text', text: value, x, y, size, weight: 400, face: 'ui', tone: 'ink', align: 'left', fit: width - SIDE * 2, ...more });

  text(teacher.name, SIDE, LOCK_TOP + 26, 24, { weight: 700 });
  const subject = school.subject(teacher.subjectId);
  const rooms = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean).map((room) => school.roomName(room, true));
  const under = [subject ? subject.name : null].concat(rooms).filter(Boolean).join(' · ');
  if (under !== '') text(under, SIDE, LOCK_TOP + 48, 13, { tone: 'soft' });

  // the kinds of day, three to a band; bands one under another
  const top = LOCK_TOP + 68;
  const bands = [];
  for (let at = 0; at < kinds.length; at += MAX_COLUMNS) bands.push(kinds.slice(at, at + MAX_COLUMNS));
  const bandHeight = bands.length > 0 ? (LOCK_BOTTOM - top - GAP * (bands.length - 1)) / bands.length : 0;
  bands.forEach((band, bandAt) => {
    const columnWidth = (width - SIDE * 2 - GAP * (band.length - 1)) / band.length;
    const bandTop = top + bandAt * (bandHeight + GAP);
    band.forEach((kind, columnAt) => {
      const x = SIDE + columnAt * (columnWidth + GAP);
      const day = school.teacherDay(teacher.id, kind.first.id) || [];
      const bells = school.bells(kind.first.id);
      const head = 22;
      const rowHeight = Math.min(34, (bandHeight - head) / Math.max(1, day.length));
      const size = Math.max(7, Math.min(14, Math.floor(rowHeight * 0.54)));
      text(kind.dayTypes.map((dayType) => dayType.name).join(' and '), x, bandTop + 13, 13, { weight: 700, tone: 'accent', fit: columnWidth });
      items.push({ kind: 'rule', x, y: bandTop + head - 3, w: columnWidth });
      const labelWidth = Math.max(...day.map((entry) => school.periodLabel(entry.period).length), 1) * size * 0.62 + 6;
      // a lone column has room for the whole time; side by side, the start
      const wide = band.length === 1;
      const timeWidth = size * (wide ? 9.6 : 4.6);
      day.forEach((entry, rowAt) => {
        const y = bandTop + head + rowAt * rowHeight + rowHeight * 0.68;
        const bell = bells[entry.period];
        let time = '';
        if (bell && bell.start && bell.end) time = wide ? school.time(bell.start) + ' to ' + school.time(bell.end) : school.time(bell.start);
        text(school.periodLabel(entry.period), x, y, size, { weight: 600, face: 'plan', fit: labelWidth });
        if (time !== '') text(time, x + labelWidth, y, size, { tone: 'soft', fit: timeWidth });
        text(entryText(school, entry), x + labelWidth + timeWidth, y, size, { weight: entry.kind === 'teaching' ? 600 : 400, tone: entry.kind === 'teaching' ? 'ink' : 'soft', fit: columnWidth - labelWidth - timeWidth });
      });
    });
  });

  const options = when || {};
  text(school.name, width / 2, LOCK_BOTTOM + 28, 11, { weight: 600, align: 'center', fit: 220 });
  text('Published ' + dayText(school.data.publishedAt, null, options.locale, options.zone), width / 2, LOCK_BOTTOM + 44, 10, { tone: 'soft', align: 'center', fit: 220 });
  return { width, height, items };
}

function shortened(g, value, fit) {
  if (g.measureText(value).width <= fit) return value;
  let kept = Array.from(value);
  while (kept.length > 1 && g.measureText(kept.join('') + '…').width > fit) kept = kept.slice(0, -1);
  return kept.join('').trimEnd() + '…';
}

// Draw a layout on a canvas at 1170 by 2532. `theme` is the page's colours and
// faces: { paper, ink, soft, accent, line, ui, plan }.
export function paintLockScreen(canvas, layout, theme) {
  canvas.width = LOCK_WIDTH;
  canvas.height = LOCK_HEIGHT;
  const g = canvas.getContext('2d');
  g.setTransform(LOCK_SCALE, 0, 0, LOCK_SCALE, 0, 0);
  g.fillStyle = theme.paper;
  g.fillRect(0, 0, layout.width, layout.height);
  g.textBaseline = 'alphabetic';
  for (const item of layout.items) {
    if (item.kind === 'rule') {
      g.fillStyle = theme.line;
      g.fillRect(item.x, item.y, item.w, 1);
      continue;
    }
    g.font = item.weight + ' ' + item.size + 'px ' + (item.face === 'plan' ? theme.plan : theme.ui);
    g.textAlign = item.align;
    g.fillStyle = theme[item.tone];
    g.fillText(shortened(g, item.text, item.fit), item.x, item.y);
  }
  return canvas;
}

function themeNow() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: read('--paper', '#f6f3ec'),
    ink: read('--ink', '#1f2328'),
    soft: read('--ink-2', '#515761'),
    accent: read('--accent', '#0f6e66'),
    line: read('--line', '#d8d3c8'),
    ui: read('--font-ui', 'sans-serif'),
    plan: read('--font-plan', 'sans-serif'),
  };
}

// The teacher's schedule as a PNG, as a Blob.
export async function lockScreenImage(school, teacher, kinds) {
  if (document.fonts && document.fonts.load) {
    const faces = ['400 12px "Public Sans"', '600 12px "Public Sans"', '700 12px "Public Sans"', '600 12px "Barlow Semi Condensed"'];
    await Promise.all(faces.map((face) => document.fonts.load(face))).catch(() => {
      // drawn in the device's own face where the school's cannot be loaded
    });
  }
  const canvas = paintLockScreen(document.createElement('canvas'), lockScreenLayout(school, teacher, kinds), themeNow());
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The image could not be made.'));
    }, 'image/png');
  });
}

// Hand an image to the reader: through the device's share sheet where it
// takes a file (so it can go to Photos on a phone), else as a download.
// → 'shared', 'saved', or 'cancelled' when the share sheet was closed.
export async function handOver(blob, name, title) {
  const nav = globalThis.navigator;
  let file = null;
  try {
    file = new File([blob], name, { type: 'image/png' });
  } catch (error) {
    file = null;
  }
  if (file && nav && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      // a share sheet that fails for any other reason: the download below
    }
  }
  const address = URL.createObjectURL(blob);
  const link = h('a', { href: address, download: name, hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(address), 60000);
  return 'saved';
}

// The row under a teacher's day: print, the image, the door sign of each of
// the teacher's rooms, and "This is me". Choosing draws the page again, now
// the reader's own.
export function teacherOutputs(ctx, teacher, kinds) {
  const school = ctx.school;
  const says = h('p', { class: 'muted', role: 'status', dataset: { says: 'image' } });
  const image = h('button', { class: 'btn', type: 'button', dataset: { output: 'image' } }, 'Download as image');
  image.addEventListener('click', () => {
    const name = imageName(teacher.name);
    says.textContent = 'Making the image…';
    lockScreenImage(school, teacher, kinds).then((blob) => handOver(blob, name, teacher.name + ' · ' + school.name)).then((how) => {
      if (how === 'shared') says.textContent = 'Shared. Save it to your photos, then set it as your lock screen.';
      else if (how === 'saved') says.textContent = 'Saved as ' + name + '. Set it as your lock screen from your photos or files.';
      else says.textContent = '';
    }, () => {
      says.textContent = 'The image could not be made on this device. Print the page instead.';
    });
  });

  const rooms = school.has('room') ? (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean) : [];
  const signs = rooms.map((room) => h('a', { class: 'btn', href: makeHash('door', room.id), dataset: { output: 'door' } },
    rooms.length > 1 ? h('span', null, 'Door sign: ', typed(school.roomName(room, true))) : 'Door sign'));

  const mine = isMe(ctx, teacher.id);
  const again = (selector) => {
    ctx.redraw();
    const next = document.querySelector(selector);
    if (next) next.focus();
  };
  const me = mine
    ? h('p', { class: 'outputs__row', dataset: { actions: 'me' } },
      h('span', { class: 'muted' }, 'This is your schedule on this device.'),
      h('button', { class: 'btn', type: 'button', dataset: { me: 'forget' }, onclick: () => {
        forgetMe(ctx);
        again('[data-me="choose"]');
      } }, 'This is not me'))
    : h('p', { class: 'outputs__row', dataset: { actions: 'me' } },
      h('button', { class: 'btn', type: 'button', dataset: { me: 'choose' }, onclick: () => {
        chooseMe(ctx, teacher.id);
        again('[data-me="forget"]');
      } }, 'This is me'));

  return h('div', { class: 'outputs no-print', dataset: { part: 'outputs' } },
    h('p', { class: 'outputs__row', dataset: { actions: 'outputs' } }, printButton('Print this schedule'), image, signs),
    says,
    me);
}
