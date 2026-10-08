// Bell schedule arithmetic: period names, time formatting, the passing time
// of each transition, and the inline checks on a bell schedule. Times are
// stored as 24-hour "HH:MM" and shown in the school's chosen form.

import { isBellTime } from './schema.js';
import { effectiveDayType } from './day-types.js';

// A gap between two periods longer than this is pointed out, since the
// passing time worked out from it is too long to mean anything.
export const LONG_GAP_MINUTES = 30;

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return n + 'th';
  const ones = n % 10;
  if (ones === 1) return n + 'st';
  if (ones === 2) return n + 'nd';
  if (ones === 3) return n + 'rd';
  return n + 'th';
}

function letters(index) {
  let label = '';
  let rest = index;
  do {
    label = String.fromCharCode(65 + (rest % 26)) + label;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return label;
}

// The short form: "3", "C", "3rd".
export function periodLabel(settings, index) {
  const word = settings.periodWord;
  if (word === 'Block') return letters(index);
  if (word === 'Hour') return ordinal(index + 1);
  return String(index + 1);
}

// The name of period `index` (from 0) in the school's word: "Period 3",
// "Mod 3", "Block C", "3rd Hour".
export function periodName(settings, index) {
  const word = settings.periodWord;
  if (word === 'Hour') return ordinal(index + 1) + ' Hour';
  if (word === 'Block') return 'Block ' + letters(index);
  if (word === 'Mod') return 'Mod ' + (index + 1);
  return 'Period ' + (index + 1);
}

// "HH:MM" to minutes after midnight, or null when it is not a bell time.
export function parseTime(value) {
  if (!isBellTime(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

// Minutes after midnight to "HH:MM".
export function toBellTime(minutes) {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(wrapped / 60)).padStart(2, '0') + ':' + String(wrapped % 60).padStart(2, '0');
}

// A time for the screen. `value` is "HH:MM" or minutes after midnight.
// 24h gives "08:42" and "14:05"; 12h gives "8:42 AM" and "2:05 PM", or
// "8:42" and "2:05" with `options.suffix` false. Anything else gives "".
export function formatTime(value, timeFormat, options) {
  const minutes = typeof value === 'number' ? (Number.isFinite(value) ? value : null) : parseTime(value);
  if (minutes === null) return '';
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = String(wrapped % 60).padStart(2, '0');
  if (timeFormat === '24h') return String(hours).padStart(2, '0') + ':' + mins;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = options && options.suffix === false ? '' : hours < 12 ? ' AM' : ' PM';
  return hour12 + ':' + mins + suffix;
}

// When does each period start and end on day type D, and what is the passing
// time into the next one? One entry per period:
// { start, end, passingAfter, passingFromBells }.
// start and end are "HH:MM" or null. passingAfter is seconds, null after the
// last period. It comes from the bells when both times are entered and the
// next period starts after this one ends; otherwise it is the school default,
// and passingFromBells is false.
export function bellsFor(project, dayTypeId) {
  const dayType = effectiveDayType(project, dayTypeId);
  const periods = project.settings.periods;
  const fallback = project.settings.defaultPassingSeconds;
  const bells = dayType && Array.isArray(dayType.bells) ? dayType.bells : [];
  const result = [];
  for (let p = 0; p < periods; p += 1) {
    const bell = bells[p] || null;
    result.push({
      start: bell && isBellTime(bell.start) ? bell.start : null,
      end: bell && isBellTime(bell.end) ? bell.end : null,
      passingAfter: null,
      passingFromBells: false,
    });
  }
  for (let p = 0; p < periods - 1; p += 1) {
    const end = parseTime(result[p].end);
    const next = parseTime(result[p + 1].start);
    if (end !== null && next !== null && next > end) {
      result[p].passingAfter = (next - end) * 60;
      result[p].passingFromBells = true;
    } else {
      result[p].passingAfter = fallback;
    }
  }
  return result;
}

// The inline checks on one day type's bell schedule. They warn and never
// block. Each finding is { path, message, kind, period } with kind one of
// 'end-before-start', 'overlap', 'gap'.
export function bellFindings(project, dayTypeId) {
  const dayType = effectiveDayType(project, dayTypeId);
  if (!dayType) return [];
  const settings = project.settings;
  const index = project.dayTypes.indexOf(dayType);
  const bells = bellsFor(project, dayTypeId);
  const findings = [];
  const add = (kind, period, message) => {
    findings.push({ path: 'dayTypes[' + index + '].bells[' + period + ']', message, kind, period });
  };
  const times = bells.map((bell) => ({ start: parseTime(bell.start), end: parseTime(bell.end) }));
  const entered = times.map((time) => time.start !== null && time.end !== null);
  const sound = times.map((time, p) => entered[p] && time.end > time.start);
  const show = (minutes) => formatTime(minutes, settings.timeFormat);

  for (let p = 0; p < times.length; p += 1) {
    if (entered[p] && !sound[p]) {
      add('end-before-start', p, periodName(settings, p) + ' ends at ' + show(times[p].end) + ', which is not after its start at ' + show(times[p].start) + '. Check the two times.');
    }
  }
  for (let a = 0; a < times.length; a += 1) {
    for (let b = a + 1; b < times.length; b += 1) {
      if (!sound[a] || !sound[b]) continue;
      if (times[a].start < times[b].end && times[b].start < times[a].end) {
        add('overlap', b, periodName(settings, b) + ' (' + show(times[b].start) + ' to ' + show(times[b].end) + ') overlaps ' + periodName(settings, a) + ' (' + show(times[a].start) + ' to ' + show(times[a].end) + '). One of them needs different times.');
      }
    }
  }
  if (entered.some(Boolean)) {
    for (let p = 0; p < times.length; p += 1) {
      if (!entered[p]) {
        add('gap', p, periodName(settings, p) + ' has no times. The passing time around it uses the default of ' + settings.defaultPassingSeconds + ' seconds.');
      }
    }
  }
  for (let p = 0; p < times.length - 1; p += 1) {
    if (!sound[p] || !sound[p + 1]) continue;
    const gap = times[p + 1].start - times[p].end;
    if (gap === 0) {
      add('gap', p, 'There is no passing time between ' + periodName(settings, p) + ' and ' + periodName(settings, p + 1) + ': one ends at ' + show(times[p].end) + ' and the next starts then. The default of ' + settings.defaultPassingSeconds + ' seconds is used.');
    } else if (gap > LONG_GAP_MINUTES) {
      add('gap', p, 'There are ' + gap + ' minutes between ' + periodName(settings, p) + ' and ' + periodName(settings, p + 1) + '. If something happens in that time, it may need a period of its own.');
    }
  }
  return findings;
}
