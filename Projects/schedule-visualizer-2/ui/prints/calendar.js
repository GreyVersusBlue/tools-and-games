// The calendar on paper (DESIGN 11.4): the year as a grid of months, twelve
// to a sheet (4 across and 3 down on a landscape sheet, 3 across and 4 down
// upright), a key of the day types and bell schedules, "No" (or the note's
// first word) in every square with no school so it reads without
// backgrounds, and the corner mark of a date changed by hand, in the key.
// The tints are printed where the browser prints backgrounds
// (print-color-adjust: exact asks for it); nothing relies on them. No
// selection and no today ring: the document is built from the model, not
// from the screen.
//
// render(project, derived, options) → { title, html }
//   options.firstDay   the weekday a week starts on, 0 Monday to 6 Sunday;
//                      Sunday when left out (the planner passes its locale's)
//   and what every output takes (document.js)

import { calendarDays, dateWords } from '../../engine/calendar.js';
import { calendarOf, bellSchedulesOf } from '../../engine/schema.js';
import { esc, frame, paperOf } from './document.js';
import { monthsOf, shortOfDay, shortOfBells, tintOf, closedWord, WEEKDAY_NAMES } from '../schedule/calendar/model.js';

export const id = 'calendar';
export const name = 'Calendar';

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS_A_SHEET = 12;

// The sheet's own rules: print.css is shared by every output and knows
// nothing of months.
const STYLE = [
  '.cal-print { display: grid; gap: 4mm 5mm; }',
  '.cal-print--wide { grid-template-columns: repeat(4, minmax(0, 1fr)); }',
  '.cal-print--tall { grid-template-columns: repeat(3, minmax(0, 1fr)); }',
  '.cal-print__month h2 { margin: 0 0 1mm; font-size: 10pt; }',
  '.cal-print__month table { width: 100%; table-layout: fixed; border-collapse: collapse; font-variant-numeric: tabular-nums; }',
  '.cal-print__month th { font-size: 6.5pt; font-weight: 500; color: #515761; padding: 0 0 0.5mm; }',
  '.cal-print__month td { position: relative; height: 7.5mm; border: 0.2mm solid #b9b3a7; text-align: center; vertical-align: middle; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  '.cal-print__month td.is-blank { border: 0; }',
  '.cal-print__month td.is-out { border-style: dotted; }',
  '.cal-print__n { position: absolute; top: 0.3mm; left: 0.6mm; font-size: 5pt; line-height: 1; }',
  '.cal-print__t { display: block; padding-top: 1.6mm; font-size: 8pt; font-weight: 600; line-height: 1; }',
  '.cal-print__b { display: block; font-size: 5.5pt; line-height: 1.1; }',
  '.cal-print__month td.is-closed { background: repeating-linear-gradient(135deg, transparent 0 1.2mm, #d8d3c8 1.2mm 1.45mm); }',
  '.cal-print__month td.is-closed .cal-print__t { font-size: 6pt; font-weight: 500; }',
  '.cal-print__mark { position: absolute; top: 0; right: 0; width: 0; height: 0; border-top: 2mm solid #1f2328; border-left: 2mm solid transparent; }',
  '.cal-print__key { display: flex; flex-wrap: wrap; gap: 1mm 5mm; margin: 0 0 3mm; padding: 0; list-style: none; font-size: 8pt; }',
  '.cal-print__key li { display: flex; align-items: center; gap: 1.5mm; }',
  '.cal-print__swatch { position: relative; display: inline-block; min-width: 6mm; height: 4.5mm; border: 0.2mm solid #b9b3a7; font-size: 7pt; font-weight: 600; line-height: 4.5mm; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  '.cal-print__swatch.is-closed { background: repeating-linear-gradient(135deg, transparent 0 1.2mm, #d8d3c8 1.2mm 1.45mm); font-weight: 500; }',
  '.cal-print__summary { margin: 0 0 2mm; font-size: 9pt; }',
].join('\n');

// A day type's tint as a light background on paper: the colour at 30% over
// white, so ink reads on it whatever the hue.
function paperTint(hex) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!value) return '';
  const n = parseInt(value[1], 16);
  const mix = (c) => Math.round(c * 0.3 + 255 * 0.7);
  return 'rgb(' + mix((n >> 16) & 255) + ', ' + mix((n >> 8) & 255) + ', ' + mix(n & 255) + ')';
}

function keyMarkup(project, days) {
  const usedDays = new Set(days.filter((day) => day.school).map((day) => day.dayTypeId));
  const usedBells = new Set(days.filter((day) => day.school && day.bellsId !== null).map((day) => day.bellsId));
  const items = [];
  for (const dayType of project.dayTypes) {
    if (!usedDays.has(dayType.id)) continue;
    items.push('<li><span class="cal-print__swatch" style="background: ' + paperTint(tintOf(project, dayType.id)) + '">' + esc(shortOfDay(project, dayType.id)) + '</span>' + esc(dayType.name) + '</li>');
  }
  for (const schedule of bellSchedulesOf(project)) {
    if (!schedule || !usedBells.has(schedule.id)) continue;
    items.push('<li><span class="cal-print__swatch">' + esc(shortOfBells(project, schedule.id)) + '</span>' + esc(schedule.name) + ' bells</li>');
  }
  items.push('<li><span class="cal-print__swatch is-closed">No</span>No school</li>');
  items.push('<li><span class="cal-print__swatch"><span class="cal-print__mark"></span></span>Changed by hand</li>');
  return '<ul class="cal-print__key" aria-label="Key">' + items.join('') + '</ul>';
}

function monthMarkup(project, month, byDate, order) {
  const head = '<tr>' + order.map((weekday) => '<th scope="col" title="' + WEEKDAY_NAMES[weekday] + '">' + SHORT_DAYS[weekday] + '</th>').join('') + '</tr>';
  const rows = month.weeks.map((week) => '<tr>' + week.map((date) => {
    if (date === null) return '<td class="is-blank"></td>';
    const n = '<span class="cal-print__n">' + Number(date.slice(8, 10)) + '</span>';
    const day = byDate.get(date);
    if (!day) return '<td class="is-out">' + n + '</td>';
    const mark = day.changed ? '<span class="cal-print__mark"></span>' : '';
    if (!day.school) return '<td class="is-closed">' + n + '<span class="cal-print__t">' + esc(closedWord(day)) + '</span>' + mark + '</td>';
    const tint = paperTint(tintOf(project, day.dayTypeId));
    return '<td' + (tint ? ' style="background: ' + tint + '"' : '') + '>' + n
      + '<span class="cal-print__t">' + esc(shortOfDay(project, day.dayTypeId)) + '</span>'
      + (day.bellsId === null ? '' : '<span class="cal-print__b">' + esc(shortOfBells(project, day.bellsId)) + '</span>')
      + mark + '</td>';
  }).join('') + '</tr>').join('');
  return '<section class="cal-print__month"><h2>' + esc(month.name) + '</h2><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></section>';
}

export function render(project, derived, options) {
  const opts = options || {};
  const calendar = calendarOf(project);
  const days = calendarDays(project);
  if (!calendar || days.length === 0) {
    return frame(project, { output: id, what: 'Calendar', options: opts, pages: [{ body: '<p>This project has no calendar yet. Make one under Schedule › Calendar.</p>' }] });
  }
  const firstDay = Number.isInteger(opts.firstDay) && opts.firstDay >= 0 && opts.firstDay <= 6 ? opts.firstDay : 6;
  const order = Array.from({ length: 7 }, (unused, i) => (firstDay + i) % 7);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const months = monthsOf(days[0].date, days[days.length - 1].date, firstDay);
  const wide = paperOf(project, opts).orientation === 'landscape';
  const school = days.filter((day) => day.school).length;
  const summary = '<p class="cal-print__summary">' + school + (school === 1 ? ' school day' : ' school days') + ' from ' + esc(dateWords(days[0].date)) + ' to ' + esc(dateWords(days[days.length - 1].date)) + '.</p>';
  const key = keyMarkup(project, days);
  const pages = [];
  for (let i = 0; i < months.length; i += MONTHS_A_SHEET) {
    const some = months.slice(i, i + MONTHS_A_SHEET);
    pages.push({
      what: months.length > MONTHS_A_SHEET ? 'Calendar, ' + some[0].name + (some.length > 1 ? ' to ' + some[some.length - 1].name : '') : null,
      body: (i === 0 ? '<style>' + STYLE + '</style>' + summary : '') + key
        + '<div class="cal-print ' + (wide ? 'cal-print--wide' : 'cal-print--tall') + '">' + some.map((month) => monthMarkup(project, month, byDate, order)).join('') + '</div>',
    });
  }
  return frame(project, { output: id, what: 'Calendar', options: opts, pages });
}
