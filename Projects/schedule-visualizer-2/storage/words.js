// How storage says a size and a moment. Pure: the date and the time format
// are passed in.

import { formatTime } from '../engine/bells.js';

// 1536 -> "1.5 KB". Decimal steps of 1024, one decimal place under 10.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return value + (value === 1 ? ' byte' : ' bytes');
  return (value < 10 ? value.toFixed(1) : String(Math.round(value))) + ' ' + units[unit];
}

// The time of day of a Date, in the project's time format: "10:42 AM", "10:42".
export function clockTime(date, timeFormat, options) {
  return formatTime(date.getHours() * 60 + date.getMinutes(), timeFormat, options);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "8 Sep" in the device's own language.
export function dayWords(date) {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// A moment for a list: "10:42 AM" when it is today, "8 Sep, 10:42 AM" otherwise.
// `iso` is an ISO string; anything unreadable gives "an unknown time".
export function whenWords(iso, now, timeFormat) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown time';
  const time = clockTime(date, timeFormat);
  return sameDay(date, now) ? time : dayWords(date) + ', ' + time;
}

// "at 10:42 AM" today, "on 8 Sep at 10:42 AM" otherwise: the same moment
// inside a sentence.
export function whenInSentence(iso, now, timeFormat) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'at an unknown time';
  const time = clockTime(date, timeFormat);
  return sameDay(date, now) ? 'at ' + time : 'on ' + dayWords(date) + ' at ' + time;
}
