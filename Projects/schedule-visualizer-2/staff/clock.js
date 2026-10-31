// "Now", for every page that asks: which period it is by the reader's own
// clock and the school's bells, which day type and which bells today has, and
// the pickers that go with them. The pages that show "right now" ask to be
// told when the answer changes; the clock is read again every 30 seconds and
// whenever the page comes back into view, since a sleeping phone stops timers.
// A date that changes while a page is open is a change like any other.
//
// No rule about the school is written here. A bell time is engine/bells.js's,
// a teacher's day is engine/teacher-day.js's and the day a date is is
// engine/calendar.js's, all asked through the school of model.js.
//
// Which day today is (DESIGN 11.8, ARCHITECTURE 17.9), in this order:
//
//   1. the reader's own answer to "Not right?" for today's date
//      (sv2staff:<schoolId>:dayOn, which holds two: "just today" and "the
//      days after follow on from it", each with the moment it was given);
//   2. the calendar, with an earlier answer that said "the days after follow
//      on from it" laid over it as a dated change of the reader's own, until
//      the shell clears it, at the moment it moves the device's `seen` on to
//      a newer file (a file's time is compared with a file's time, never with
//      the phone's clock; reading an answer compares nothing);
//   3. where the calendar does not say (no calendar, or a date outside it),
//      the day type chosen by hand (sv2staff:<schoolId>:day) and the bells
//      chosen beside it (sv2staff:<schoolId>:bells), as before there was a
//      calendar.
//
// For the tests: a page that has `globalThis.sv2StaffClock = { now, every }`
// takes the time from now() (a Date, or milliseconds, or an ISO string) and
// reads it again every `every` milliseconds. Nothing else is changed by it.

import { h, typed } from './dom.js';
import { makeHash } from './router.js';
import { teacherDays } from '../engine/teacher-day.js';
import { meetingSlots } from '../engine/runs.js';
import { markFor, schoolMarkFor, dutyIsSometimes, teacherDuties } from '../engine/marks.js';

export const CLOCK_EVERY_MS = 30000;
export const DAY_TYPE_KEY = 'day';
export const BELLS_KEY = 'bells';
export const DAY_ON_KEY = 'dayOn';
export const SEEN_KEY = 'seen';

function hook() {
  const given = globalThis.sv2StaffClock;
  return given && typeof given === 'object' ? given : null;
}

// The time, as a Date.
export function clockNow(ctx) {
  const given = hook();
  if (given && typeof given.now === 'function') {
    const value = given.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return ctx.now();
}

function clockEvery() {
  const given = hook();
  return given && Number.isFinite(given.every) && given.every > 0 ? given.every : CLOCK_EVERY_MS;
}

// A moment as the reader's own date, "YYYY-MM-DD", in the device's zone: the
// date the school means when it says "today".
export function localDate(date) {
  return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// Today's date by the reader's clock.
export function todayDate(ctx) {
  return localDate(clockNow(ctx));
}

function dayTypeById(school, id) {
  return typeof id === 'string' ? school.dayTypes.find((dayType) => dayType.id === id) || null : null;
}

function bellsById(school, id) {
  return typeof id === 'string' && school.bellSchedule(id) ? id : null;
}

// The reader's "Not right?" answers as they were kept: { just, follow }, each
// null or { date, dayTypeId, bellsId, at } (`at`, the moment it was given as
// an ISO string, or null on an answer from before it was recorded). "Just
// today" and "the days after follow on from it" are two answers and neither
// removes the other. The shape this key had first, one answer with
// `follow: true | false`, reads as whichever it was. Anything kept that is
// not an answer (a day type this copy does not have, a damaged value) reads
// as no answer and is left where it is.
function keptAnswers(ctx) {
  let raw = null;
  try {
    raw = JSON.parse(ctx.store.get(DAY_ON_KEY));
  } catch (error) {
    raw = null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { just: null, follow: null };
  if (typeof raw.date === 'string') return raw.follow === true ? { just: null, follow: raw } : { just: raw, follow: null };
  return { just: raw.just && typeof raw.just === 'object' ? raw.just : null, follow: raw.follow && typeof raw.follow === 'object' ? raw.follow : null };
}

function answerOf(school, raw) {
  if (raw === null || !school.isDate(raw.date) || !dayTypeById(school, raw.dayTypeId)) return null;
  const moment = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
  return { date: raw.date, dayTypeId: raw.dayTypeId, bellsId: bellsById(school, raw.bellsId), at: moment(raw.at) };
}

function writeAnswers(ctx, kept) {
  if (kept.just === null && kept.follow === null) ctx.store.remove(DAY_ON_KEY);
  else ctx.store.set(DAY_ON_KEY, JSON.stringify({ just: kept.just, follow: kept.follow }));
}

// The reader's answers as they stand. Nothing is cleared here: a follow answer
// is removed by the shell, once, where it moves `seen` forward to a newer open
// file (`dropFollowOnNewer`), so what is read cannot depend on which page was
// opened, how many tabs are open or how many times this was called.
export function readDayOn(ctx) {
  const kept = keptAnswers(ctx);
  return { just: answerOf(ctx.school, kept.just), follow: answerOf(ctx.school, kept.follow) };
}

// Called by the shell with the file now open and the `seen` the device held
// before it. A newer file than any this device had opened ends a kept follow
// answer (the office's newer word on the calendar, and a correction made the
// same day counts); a copy no newer clears nothing, and a device that had
// opened nothing has nothing to be newer than.
export function dropFollowOnNewer(ctx, publishedAt, seen) {
  const newer = Date.parse(publishedAt);
  const before = typeof seen === 'string' ? Date.parse(seen) : NaN;
  if (!Number.isFinite(newer) || !Number.isFinite(before) || newer <= before) return;
  if (keptAnswers(ctx).follow !== null) forgetDayOn(ctx, 'follow');
}

// The answer that settles `date` itself, if either does: the one given last
// (the follow answer, on a tie, since it says more).
export function answerFor(answers, date) {
  const both = [answers.follow, answers.just].filter((answer) => answer !== null && answer.date === date);
  if (both.length < 2) return both[0] || null;
  const [follow, just] = both;
  return follow.at !== null && just.at !== null && Date.parse(just.at) > Date.parse(follow.at) ? just : follow;
}

// Keeps one answer, "just" or "follow", beside the other. The answer is
// dated by the moment it is given, which is the caller's clock, not the date
// a page was drawn with.
export function keepDayOn(ctx, kind, answer) {
  const kept = keptAnswers(ctx);
  kept[kind] = { date: answer.date, dayTypeId: answer.dayTypeId, bellsId: answer.bellsId, at: answer.at };
  writeAnswers(ctx, kept);
}

// Takes back one answer, "just" or "follow", and leaves the other.
export function forgetDayOn(ctx, kind) {
  const kept = keptAnswers(ctx);
  kept[kind] = null;
  writeAnswers(ctx, kept);
}

// Which day today is, and who says so:
//
//   { date, calendar, known, school, dayType, bellsId, label, by, since }
//
//   calendar  'known' (the calendar covers today), 'outside', or 'none'
//   known     the calendar or the reader has settled today: nothing is asked
//   school    false on a date with no school (dayType is then null)
//   dayType   today's day type; where nothing settles it, the one chosen by
//             hand, else the school's first
//   bellsId   today's bell schedule, or null for the day type's regular bells
//   label     the calendar's note for today ("Thanksgiving"), or ''
//   by        'reader' (an answer for today), 'follow' (the calendar, following
//             on from an answer given on `since`), 'calendar', 'hand' (chosen
//             by hand) or null (nobody has said)
export function todayOf(ctx) {
  const school = ctx.school;
  const date = todayDate(ctx);
  const answers = readDayOn(ctx);
  const answer = answerFor(answers, date);
  const earlier = answers.follow !== null && answers.follow.date < date ? answers.follow : null;
  const day = school.dayOn(date, earlier);
  const calendar = day.known ? 'known' : day.why;
  const label = day.known && typeof day.label === 'string' ? day.label : '';
  if (answer !== null) {
    return { date, calendar, known: true, school: true, dayType: dayTypeById(school, answer.dayTypeId), bellsId: answer.bellsId, label, by: 'reader', since: null };
  }
  if (day.known) {
    const dayType = day.school ? dayTypeById(school, day.dayTypeId) : null;
    return { date, calendar, known: true, school: dayType !== null, dayType, bellsId: dayType ? bellsById(school, day.bellsId) : null, label, by: earlier ? 'follow' : 'calendar', since: earlier ? earlier.date : null };
  }
  const hand = dayTypeById(school, ctx.store.get(DAY_TYPE_KEY));
  return { date, calendar, known: false, school: true, dayType: hand || school.dayTypes[0], bellsId: bellsById(school, ctx.store.get(BELLS_KEY)), label: '', by: hand ? 'hand' : null, since: null };
}

// What makes two answers about today the same: a page drawn for one is drawn
// again when this changes (past midnight, or a newer answer).
export function todayKey(today) {
  return [today.date, today.calendar, today.school, today.dayType ? today.dayType.id : '', today.bellsId || '', today.by || ''].join(':');
}

// The day type a page shows when nobody chose one for it: today's when the
// calendar or the reader says, else the one chosen by hand, else the first.
export function chosenDayType(ctx) {
  const today = todayOf(ctx);
  if (today.known && today.dayType) return today.dayType;
  return dayTypeById(ctx.school, ctx.store.get(DAY_TYPE_KEY)) || ctx.school.dayTypes[0];
}

// Today's bells in the same way: null for the regular bells.
export function chosenBells(ctx) {
  const today = todayOf(ctx);
  // a date with no school has no bells of its own: the regular bells, which
  // leave out no period, whatever was chosen by hand
  if (today.known && !today.school) return null;
  if (today.known && today.dayType) return today.bellsId;
  return bellsById(ctx.school, ctx.store.get(BELLS_KEY));
}

// The bells a day type rings when it is picked on a page that asked for none:
// today's, where the day type is the one today is (or nothing has said which
// day today is, so the bells chosen by hand go with the day type chosen by
// hand), else the regular bells.
export function bellsOnPick(ctx, dayTypeId) {
  const today = todayOf(ctx);
  if (!today.known) return today.bellsId;
  return today.school && today.dayType !== null && today.dayType.id === dayTypeId ? today.bellsId : null;
}

// The day type and bells a page shows for `date` when nobody picked either
// for it: { dayType, bellsId }.
//
//   today          what the page shows for today (chosenDayType, chosenBells)
//   another date   what the calendar says of it, with the reader's answers
//                  laid over it as every other page has them; where the
//                  calendar does not know the date (or it has no school) the
//                  school's first day type with the regular bells. What was
//                  chosen by hand is for today, and is not looked at.
export function dayOnDate(ctx, date) {
  const school = ctx.school;
  if (!school.isDate(date) || date === todayDate(ctx)) return { dayType: chosenDayType(ctx), bellsId: chosenBells(ctx) };
  const answers = readDayOn(ctx);
  const answer = answerFor(answers, date);
  if (answer !== null) return { dayType: dayTypeById(school, answer.dayTypeId), bellsId: answer.bellsId };
  const day = school.dayOn(date, answers.follow !== null && answers.follow.date < date ? answers.follow : null);
  const dayType = day.known && day.school ? dayTypeById(school, day.dayTypeId) : null;
  return dayType === null ? { dayType: school.dayTypes[0], bellsId: null } : { dayType, bellsId: bellsById(school, day.bellsId) };
}

// The periods that meet under these bells, as a Set of indexes.
export function meetingPeriods(school, dayTypeId, bellsId) {
  const meets = new Set();
  school.bells(dayTypeId, bellsId).forEach((bell, period) => {
    if (!bell || bell.off !== true) meets.add(period);
  });
  return meets;
}

export function rememberDayType(ctx, dayTypeId) {
  if (ctx.school.dayTypes.some((dayType) => dayType.id === dayTypeId)) ctx.store.set(DAY_TYPE_KEY, dayTypeId);
}

export function rememberBells(ctx, bellsId) {
  if (bellsId === null) ctx.store.remove(BELLS_KEY);
  else if (ctx.school.bellSchedule(bellsId)) ctx.store.set(BELLS_KEY, bellsId);
}

// The day type an address names with ?d=…, else the reader's own.
export function dayTypeFor(ctx, route) {
  const named = route.query.d ? ctx.school.dayTypes.find((dayType) => dayType.id === route.query.d) : null;
  return named || chosenDayType(ctx);
}

// The bells an address names with ?b=… beside its ?d=… (none is the regular
// bells), else today's.
export function bellsIdFor(ctx, route) {
  if (route.query.d && dayTypeById(ctx.school, route.query.d)) return bellsById(ctx.school, route.query.b);
  return chosenBells(ctx);
}

// "Tuesday, 1 September 2026" from "2026-09-01", in the reader's own language;
// null when the text is not a date.
export function longDate(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!parts) return null;
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
}

// "A Day", or "A Day with Early Release bells": pieces for a sentence.
export function dayWords(school, dayType, bellsId) {
  const schedule = bellsId ? school.bellSchedule(bellsId) : null;
  return schedule ? [typed(dayType.name), ' with ', typed(schedule.name), ' bells'] : [typed(dayType.name)];
}

// "a" or "an" before a day type's name, as it is said: "an A Day", "an
// Early Release day", "an H Day", "a B Day".
export function articleFor(name) {
  const text = String(name).trim();
  const first = text.split(/\s+/u)[0] || '';
  if (/^[A-Za-z]$/.test(first)) return /^[AEFHILMNORSX]$/i.test(first) ? 'an' : 'a';
  return /^[AEIOU]/i.test(first) ? 'an' : 'a';
}

// "9:44 AM to 10:32 AM", or '' when the period has no bell times (or, with
// bell schedule B, does not meet under it).
export function periodTimes(school, dayTypeId, period, bellsId) {
  const bell = school.bells(dayTypeId, bellsId)[period];
  if (!bell || !bell.start || !bell.end) return '';
  return school.time(bell.start) + ' to ' + school.time(bell.end);
}

// Where a moment falls in a day type's bells:
//
//   { state, period, next, shown, minutes }
//
//   state   'in'       inside period `period`
//           'passing'  between two periods; `next` is the one about to start
//           'before'   before the first bell; `next` is the first period
//           'after'    after the last bell
//           'unknown'  the day type has no bell times
//   shown   the period a page shows when nobody chose one: the period it is,
//           the one about to start, or the first of the day
//
// With bell schedule B the times are B's, and a period B leaves out is never
// the one it is.
export function momentOf(school, dayTypeId, date, bellsId) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const timed = [];
  school.bells(dayTypeId, bellsId).forEach((bell, period) => {
    const start = bell ? school.parseTime(bell.start) : null;
    const end = bell ? school.parseTime(bell.end) : null;
    if (start !== null && end !== null && end > start) timed.push({ period, start, end });
  });
  timed.sort((a, b) => a.start - b.start);
  const first = timed.length > 0 ? timed[0].period : 0;
  if (timed.length === 0) return { state: 'unknown', period: null, next: null, shown: 0, minutes };
  for (const bell of timed) {
    if (minutes >= bell.start && minutes < bell.end) return { state: 'in', period: bell.period, next: null, shown: bell.period, minutes };
  }
  const coming = timed.find((bell) => bell.start > minutes);
  if (!coming) return { state: 'after', period: null, next: null, shown: first, minutes };
  if (coming === timed[0]) return { state: 'before', period: null, next: coming.period, shown: coming.period, minutes };
  return { state: 'passing', period: null, next: coming.period, shown: coming.period, minutes };
}

// What makes two moments the same answer: a page is drawn again only when
// this changes. `more` is anything else the page's answer hangs on (today's
// key, the bells).
export function momentKey(dayTypeId, moment, more) {
  return [dayTypeId, moment.state, moment.period, moment.next, more === undefined ? '' : more].join(':');
}

// The moment in words, as pieces for a sentence: "It is Period 3 on A Day,
// 9:44 AM to 10:32 AM.", or with bell schedule B "on A Day with Early
// Release bells".
export function momentWords(school, dayType, moment, bellsId) {
  const day = dayWords(school, dayType, bellsId);
  const start = (period) => {
    const bell = school.bells(dayType.id, bellsId)[period];
    return bell && bell.start ? school.time(bell.start) : '';
  };
  if (moment.state === 'in') return ['It is ', school.periodName(moment.period), ' on ', day, ', ', periodTimes(school, dayType.id, moment.period, bellsId), '.'];
  if (moment.state === 'passing') return ['It is passing time on ', day, '. ', school.periodName(moment.next), ' starts at ', start(moment.next), '.'];
  if (moment.state === 'before') return ['The day has not started on ', day, '. ', school.periodName(moment.next), ' starts at ', start(moment.next), '.'];
  if (moment.state === 'after') return ['The last bell on ', day, ' has gone.'];
  return [day, ' has no bell times in this schedule, so the current ', school.data.settings.periodWord.toLowerCase(), ' is not known.'];
}

// One watcher at a time: the page on screen. `tick()` is called every 30
// seconds and when the page comes back into view, for as long as `node` is on
// the page; a watcher whose node has gone stops itself.
let watching = null;

function stopWatching() {
  if (!watching) return;
  globalThis.clearInterval(watching.timer);
  document.removeEventListener('visibilitychange', watching.seen);
  watching = null;
}

export function watchClock(node, tick) {
  stopWatching();
  const mine = { timer: 0, seen: null };
  const run = () => {
    if (watching !== mine) return;
    if (!node.isConnected) {
      stopWatching();
      return;
    }
    tick();
  };
  mine.seen = () => {
    if (!document.hidden) run();
  };
  // the node is put on the page after render() returns, so the first look is
  // a whole interval away
  mine.timer = globalThis.setInterval(run, clockEvery());
  document.addEventListener('visibilitychange', mine.seen);
  watching = mine;
}

// Every teacher's day on a day type, worked out once per school, day type and
// date: a Map of teacher id to the day engine/teacher-day.js gives. With a
// date, a duty that holds only on some days takes the period when the date
// matches it and is left out when not; without one it is listed with its
// words and takes nothing (ARCHITECTURE 17.6).
const days = new WeakMap();

export function everyTeacherDay(school, dayTypeId, date) {
  if (!days.has(school)) days.set(school, new Map());
  const kept = days.get(school);
  const key = dayTypeId + '|' + (typeof date === 'string' ? date : '');
  if (!kept.has(key)) {
    const found = teacherDays(school.data, dayTypeId, typeof date === 'string' ? { date } : undefined);
    const made = new Map();
    for (const teacher of school.teachers) made.set(teacher.id, (found && found.get(teacher.id)) || []);
    kept.set(key, made);
  }
  return kept.get(key);
}

// The date a page applies a day type's sometimes-duties for: today's, when
// the calendar or the reader has settled today and the day type is today's;
// otherwise none, and such a duty is listed with its words.
export function dutyDate(ctx, dayTypeId) {
  const today = todayOf(ctx);
  return today.known && today.school && today.dayType !== null && today.dayType.id === dayTypeId ? today.date : null;
}

// Where is group G on day type D, for the bells given (none: the regular
// ones)? engine/runs.js's one answer: a No class period or one the bells
// leave out is an empty slot.
export function groupSlots(school, groupId, dayTypeId, bellsId) {
  return meetingSlots(school.data, groupId, dayTypeId, bellsId || null) || [];
}

// The mark a group has in a period, or null. A school without marks has none.
export function groupMark(school, groupId, dayTypeId, period) {
  return markFor(school.data, groupId, dayTypeId, period);
}

const MARK_WORDS = { lunch: 'Lunch', advisory: 'Advisory', activity: 'Activity', noclass: 'No class' };
const DUTY_WORDS = { duty: 'Duty', meeting: 'Meeting', lunch: 'Their own lunch' };
const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

// A mark's words as typed, else its kind's: "Lunch", "Homeroom", "No class".
export function markWords(mark) {
  if (!mark) return '';
  return typeof mark.label === 'string' && mark.label.trim() !== '' ? mark.label : MARK_WORDS[mark.kind] || '';
}

// A duty's words as typed, else its kind's: "Lunch duty", "Duty".
export function dutyWords(duty) {
  return typeof duty.label === 'string' && duty.label.trim() !== '' ? duty.label : DUTY_WORDS[duty.kind] || 'Duty';
}

// Where a duty is: its room's name, or the words kept for a place.
export function dutyPlace(school, duty) {
  const room = typeof duty.roomId === 'string' ? school.room(duty.roomId) : null;
  if (room) return school.roomName(room, true);
  return typeof duty.place === 'string' ? duty.place : '';
}

// When a duty runs, in the school's time format: "2:45 PM to 3:05 PM",
// "from 2:45 PM", "until 3:05 PM", or '' when it gives no times.
export function dutyTimes(school, duty) {
  const start = typeof duty.start === 'string' && duty.start !== '' ? school.time(duty.start) : '';
  const end = typeof duty.end === 'string' && duty.end !== '' ? school.time(duty.end) : '';
  if (start !== '' && end !== '') return start + ' to ' + end;
  if (start !== '') return 'from ' + start;
  return end === '' ? '' : 'until ' + end;
}

// The days a duty that holds only on some days holds on: "Wednesdays",
// "Mondays and Fridays, from 1 December to 18 December"; '' for one that
// holds every day.
export function sometimesWords(school, duty) {
  if (!dutyIsSometimes(duty)) return '';
  const names = (Array.isArray(duty.weekdays) ? duty.weekdays : []).filter((day) => Number.isInteger(day) && day >= 0 && day < 7).sort((a, b) => a - b).map((day) => WEEKDAYS[day]);
  const parts = [];
  if (names.length > 0) parts.push(names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
  const from = school.isDate(duty.from) ? school.dateWords(duty.from, { year: false }) : '';
  const to = school.isDate(duty.to) ? school.dateWords(duty.to, { year: false }) : '';
  if (from !== '' && to !== '') parts.push('from ' + from + ' to ' + to);
  else if (from !== '') parts.push('from ' + from);
  else if (to !== '') parts.push('until ' + to);
  return parts.join(', ');
}

// What takes a free period, or null when nothing does (or the entry is a
// class): { eyebrow, title, place, times, reason } as plain text.
//
//   an always duty (or, with `date`, one that holds that day) comes first,
//   then a school mark. `eyebrow` is the small word over a duty's title
//   ("Duty", "Meeting"), '' for a mark. `reason` is why the teacher is not
//   free, for Coverage's list: "On duty: Lunch duty", "At lunch".
export function takenBy(school, entry, dayTypeId, date) {
  if (!entry || entry.kind !== 'planning' || !entry.marked) return null;
  const duty = takingDuty(entry, date);
  if (duty) {
    const title = dutyWords(duty);
    const named = typeof duty.label === 'string' && duty.label.trim() !== '';
    const lead = { duty: 'On duty', meeting: 'At a meeting', lunch: 'At their own lunch' }[duty.kind] || 'On duty';
    return { eyebrow: DUTY_WORDS[duty.kind] === title ? '' : DUTY_WORDS[duty.kind], title, place: dutyPlace(school, duty), times: dutyTimes(school, duty), reason: named ? lead + ': ' + title : lead };
  }
  const mark = schoolMarkFor(school.data, dayTypeId, entry.period);
  const title = mark ? markWords(mark) : MARK_WORDS[entry.marked] || 'Taken';
  const lead = { lunch: 'At lunch', advisory: 'In advisory', activity: 'At an activity', noclass: 'No class' }[entry.marked] || 'Busy';
  return { eyebrow: '', title, place: '', times: '', reason: title === MARK_WORDS[entry.marked] ? lead : lead + ': ' + title };
}

// The duty that takes a free period, by teacher-day.js's order: an always
// duty first, and with a date also one that holds that day.
export function takingDuty(entry, date) {
  if (!entry || entry.kind !== 'planning' || !entry.marked) return null;
  return (entry.duties || []).find((each) => !dutyIsSometimes(each) || typeof date === 'string') || null;
}

// The duties in a period that hold on some days only and are not what takes
// the period: listed with their words ("Lunch duty (Wednesdays)").
export function sometimesIn(entry, date) {
  const taking = takingDuty(entry, date);
  return (entry && entry.duties ? entry.duties : []).filter((duty) => dutyIsSometimes(duty) && duty !== taking);
}

// One duty as a line of text: "Lunch duty · Cafeteria · 12:00 PM to 12:30 PM",
// with "(Wednesdays)" after a duty that holds on some days only.
export function dutyLine(school, duty) {
  const sometimes = sometimesWords(school, duty);
  return [dutyWords(duty) + (sometimes === '' ? '' : ' (' + sometimes + ')'), dutyPlace(school, duty), dutyTimes(school, duty)].filter((part) => part !== '').join(' · ');
}

// A teacher's duties before and after the school day, on a day type and
// date: { before, after } lists of duties (a duty that holds only on some
// days is in the list for a date that matches, and for no date at all).
export function edgeDuties(school, teacherId, dayTypeId, date) {
  const found = teacherDuties(school.data, teacherId, dayTypeId, typeof date === 'string' ? { date } : undefined);
  return found ? { before: found.before, after: found.after } : { before: [], after: [] };
}

let serial = 0;

// "Day type": one button a day type, the chosen one marked. Choosing one keeps
// it on the device and calls onChoose(dayType). A school with one day type
// has nothing to choose and gets no picker. A page choosing for another date
// than today passes { remember: false }: what is chosen by hand is today's.
export function dayTypePicker(ctx, chosenId, onChoose, options) {
  const school = ctx.school;
  if (school.dayTypes.length < 2) return null;
  serial += 1;
  const group = 'day-type-' + serial;
  return h('fieldset', { class: 'pick', dataset: { pick: 'day' } },
    h('legend', { class: 'field__label' }, 'Day type'),
    h('div', { class: 'pick__items' }, school.dayTypes.map((dayType) => {
      const input = h('input', { class: 'pick__input', type: 'radio', name: group, value: dayType.id, checked: dayType.id === chosenId });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        if (!options || options.remember !== false) rememberDayType(ctx, dayType.id);
        onChoose(dayType);
      });
      return h('label', { class: 'pick__item' }, input, h('span', { class: 'pick__name' }, typed(dayType.name)));
    })));
}

// "Bells": "Regular" and each of the school's other bell schedules, the chosen
// one marked. Choosing one keeps it on the device and calls onChoose(bellsId),
// null for the regular bells. A school with no other bell schedules gets no
// picker.
export function bellsPicker(ctx, chosenId, onChoose) {
  const school = ctx.school;
  if (school.bellSchedules.length === 0) return null;
  serial += 1;
  const group = 'bells-' + serial;
  const item = (bellsId, name) => {
    const input = h('input', { class: 'pick__input', type: 'radio', name: group, value: bellsId || '', checked: bellsId === chosenId });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      rememberBells(ctx, bellsId);
      onChoose(bellsId);
    });
    return h('label', { class: 'pick__item' }, input, h('span', { class: 'pick__name' }, name));
  };
  return h('fieldset', { class: 'pick', dataset: { pick: 'bells' } },
    h('legend', { class: 'field__label' }, 'Bells'),
    h('div', { class: 'pick__items' }, item(null, 'Regular'), school.bellSchedules.map((schedule) => item(schedule.id, typed(schedule.name)))));
}

// "Period": "Now" and then every period with its times, under bell schedule
// B when one is given (a period B leaves out says so). `value` is '' for
// now, or a period's index. onChoose('' | index).
export function periodPicker(school, dayTypeId, value, onChoose, bellsId) {
  serial += 1;
  const id = 'period-' + serial;
  const bells = school.bells(dayTypeId, bellsId);
  const options = [h('option', { value: '', selected: value === '' }, 'Now')];
  for (let period = 0; period < school.data.settings.periods; period += 1) {
    const times = periodTimes(school, dayTypeId, period, bellsId);
    const off = bells[period] && bells[period].off === true;
    options.push(h('option', { value: String(period), selected: value === period }, school.periodName(period) + (off ? ', no class' : times ? ', ' + times : '')));
  }
  const select = h('select', { class: 'field__input', id, dataset: { pick: 'period' } }, options);
  select.addEventListener('change', () => onChoose(select.value === '' ? '' : Number(select.value)));
  return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, school.data.settings.periodWord), select);
}

// The period an address names with ?p=…: '' for now, or an index that exists.
export function periodFor(school, route) {
  const text = route.query.p;
  if (text === undefined || text === '' || !/^\d+$/.test(text)) return '';
  const period = Number(text);
  return period < school.data.settings.periods ? period : '';
}

// "A Day", "A Day and B Day", "A Day, B Day and C Day", each name as typed.
export function dayTypeNames(dayTypes) {
  const pieces = [];
  dayTypes.forEach((dayType, index) => {
    if (index > 0) pieces.push(index === dayTypes.length - 1 ? ' and ' : ', ');
    pieces.push(typed(dayType.name));
  });
  return pieces;
}

// ---- pieces the pages built on this module share

// A link to a teacher's, a group's or a room's page; plain text where the
// publisher left that view out of the file.
export function viewLink(school, view, id, children, className) {
  if (!school.has(view)) return h('span', { class: className || null }, children);
  return h('a', { class: className || null, href: makeHash(view, id) }, children);
}

// Does this copy have a calendar page to show? Only with a calendar.
export function hasCalendar(school) {
  return school.has('calendar') && school.calendarDays().length > 0;
}

// "Where right now", "Free right now" and the calendar are the pages behind
// the bar's Now: each carries the row, with its own marked.
export function nowTabs(school, current) {
  const tabs = [['now', 'Where right now', school.has('now')], ['free', 'Free right now', school.has('free')], ['calendar', 'Calendar', hasCalendar(school)]].filter((tab) => tab[2]);
  if (tabs.length < 2) return null;
  const tab = (view, name) => h('a', { class: 'tab', href: makeHash(view), 'aria-current': view === current ? 'page' : null }, name);
  return h('nav', { class: 'tabs', 'aria-label': 'Now' }, tabs.map(([view, name]) => tab(view, name)));
}

// ---- today

// The line that says which day today is, with "Not right?" beside it (DESIGN
// 11.8), or null where there is nothing to say (no calendar, and no answer
// of the reader's for today). `onChange()` is called after the reader has
// answered, to draw what depends on today again; focus then goes to the
// line, rewritten.
//
//   "Today is a B Day with Early Release bells."            the calendar says
//   "No school today: Thanksgiving."                        a date with no school
//   "Today is a C Day. You said so on this device."         the reader's answer
//   "Today is not in this schedule's calendar, which runs from … to …."
//
// "Not right?" opens, in place, the day types (and the bells, where the
// school has other bell schedules) and two buttons: "Just today", and "Today,
// and the days after follow on from it" (the rotation follows on from the
// answer). The two answers are separate: "As the calendar says" takes back
// today's "just today" and nothing else, and "Forget what I said on 1
// September" takes back the standing one.
export function todayLine(ctx, onChange) {
  const school = ctx.school;
  const today = todayOf(ctx);
  const answers = readDayOn(ctx);
  const justToday = answers.just !== null && answers.just.date === today.date;
  const answered = today.by === 'reader' || today.by === 'follow' || justToday || answers.follow !== null;
  if (today.calendar === 'none' && !answered) return null;
  // Where the calendar does not say (a date outside it, or no calendar) and
  // the reader has not answered for today, nothing asserts which day it is,
  // whatever standing answer is kept: the sentence below stands, or nothing
  // does, and a kept standing answer can still be taken back by name.
  if (today.calendar !== 'known' && today.by !== 'reader') {
    const forgetting = answers.follow !== null ? h('p', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', dataset: { today: 'forget' }, onclick: () => {
        forgetDayOn(ctx, 'follow');
        onChange();
        const again = document.querySelector('.today__says');
        if (again) again.focus();
      } }, 'Forget what I said on ', school.dateWords(answers.follow.date, { year: false }))) : null;
    const calendar = school.calendar;
    const outside = today.calendar === 'outside'
      ? h('p', { class: 'today__says', tabindex: '-1' }, 'Today, ', school.dateWords(today.date), ', is not in this schedule\'s calendar, which runs from ', school.dateWords(calendar.start), ' to ', school.dateWords(calendar.end), '.')
      : null;
    return h('div', { class: 'today', dataset: { today: 'outside' } }, outside, forgetting);
  }
  const says = today.school
    ? ['Today is ', articleFor(today.dayType.name), ' ', dayWords(school, today.dayType, today.bellsId), today.label ? [': ', typed(today.label)] : null, '.']
    : ['No school today', today.label ? [': ', typed(today.label)] : null, '.'];
  if (today.by === 'reader') says.push(' You said so on this device.');
  if (today.by === 'follow') says.push(' It follows on from what you said on ', school.dateWords(today.since, { year: false }), '.');

  serial += 1;
  const panelId = 'today-' + serial;
  const toggle = h('button', { class: 'today__not', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId, dataset: { today: 'not-right' } }, 'Not right?');
  const line = h('p', { class: 'today__says', tabindex: '-1' }, says, ' ', toggle);

  const days = 'today-day-' + serial;
  const bells = 'today-bells-' + serial;
  const shownDay = today.dayType || school.dayTypes[0];
  const dayChoice = h('fieldset', { class: 'pick', dataset: { pick: 'today-day' } },
    h('legend', { class: 'field__label' }, 'Which day is today?'),
    h('div', { class: 'pick__items' }, school.dayTypes.map((dayType) => h('label', { class: 'pick__item' },
      h('input', { class: 'pick__input', type: 'radio', name: days, value: dayType.id, checked: dayType.id === shownDay.id }),
      h('span', { class: 'pick__name' }, typed(dayType.name))))));
  const bellsChoice = school.bellSchedules.length === 0 ? null : h('fieldset', { class: 'pick', dataset: { pick: 'today-bells' } },
    h('legend', { class: 'field__label' }, 'Bells'),
    h('div', { class: 'pick__items' }, [null].concat(school.bellSchedules.map((schedule) => schedule.id)).map((bellsId) => h('label', { class: 'pick__item' },
      h('input', { class: 'pick__input', type: 'radio', name: bells, value: bellsId || '', checked: bellsId === (today.school ? today.bellsId : null) }),
      h('span', { class: 'pick__name' }, bellsId === null ? 'Regular' : typed(school.bellSchedule(bellsId).name))))));

  const answer = (kind) => {
    const picked = dayChoice.querySelector('input:checked');
    const pickedBells = bellsChoice ? bellsChoice.querySelector('input:checked') : null;
    // the date and the moment of the click, not of the drawing: a page left
    // open past midnight has not ticked yet
    const given = clockNow(ctx);
    keepDayOn(ctx, kind, { date: localDate(given), dayTypeId: picked ? picked.value : shownDay.id, bellsId: pickedBells && pickedBells.value !== '' ? pickedBells.value : null, at: given.toISOString() });
    settle();
  };
  const settle = () => {
    onChange();
    const again = document.querySelector('.today__says');
    if (again) again.focus();
  };
  const just = h('button', { class: 'btn', type: 'button', dataset: { today: 'just' }, onclick: () => answer('just') }, 'Just today');
  const follow = h('button', { class: 'btn', type: 'button', dataset: { today: 'follow' }, onclick: () => answer('follow') }, 'Today, and the days after follow on from it');
  const back = justToday ? h('button', { class: 'btn', type: 'button', dataset: { today: 'calendar' }, onclick: () => {
    forgetDayOn(ctx, 'just');
    settle();
  } }, 'As the calendar says') : null;
  const forget = answers.follow !== null ? h('button', { class: 'btn', type: 'button', dataset: { today: 'forget' }, onclick: () => {
    forgetDayOn(ctx, 'follow');
    settle();
  } }, 'Forget what I said on ', school.dateWords(answers.follow.date, { year: false })) : null;
  const panel = h('div', { class: 'today__panel', id: panelId, hidden: true, role: 'group', 'aria-label': 'Which day is today?' },
    dayChoice, bellsChoice, h('p', { class: 'actions' }, just, follow, back, forget));

  const close = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  };
  toggle.addEventListener('click', () => {
    if (!panel.hidden) {
      close();
      return;
    }
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('input:checked') || panel.querySelector('input');
    if (first) first.focus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  });
  return h('div', { class: 'today', dataset: { today: today.school ? 'school' : 'closed', by: today.by || '' } }, line, panel);
}

// A heading inside a page, with a count when there is one: "Teachers free (5)".
export function sectionHeading(text, count) {
  return h('h2', { class: 'results__heading' }, text, typeof count === 'number' ? ' (' + count + ')' : null);
}

// A teacher's subject and rooms, for the small line under a name:
// "Science · Room 103".
export function teacherDetail(school, teacher) {
  const pieces = [];
  const subject = school.subject(teacher.subjectId);
  if (subject) pieces.push(typed(subject.name));
  const rooms = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean);
  if (rooms.length > 0) {
    if (pieces.length > 0) pieces.push(' · ');
    rooms.forEach((room, index) => pieces.push(index > 0 ? ', ' : null, typed(school.roomName(room, true))));
  }
  return pieces;
}

// What a teacher has in one period of their day, as pieces: "6A in Room 103",
// "6C and 7C in Room 203", or "Planning". A free period that a duty or a mark
// takes reads as it does: "Lunch duty · Cafeteria", "Lunch". `options`
// ({ dayTypeId, date }) lets a school mark be named as typed and a duty that
// holds on some days count when the date matches.
export function entryWords(school, entry, options) {
  if (!entry || entry.kind !== 'teaching') {
    const taken = takenBy(school, entry, options && options.dayTypeId, options && options.date);
    if (taken === null) return ['Planning'];
    return [typed(taken.title)].concat(taken.place === '' ? [] : [' · ', typed(taken.place)]);
  }
  const pieces = [];
  const roomIds = [];
  entry.groups.forEach((taught, index) => {
    const group = school.group(taught.groupId);
    if (index > 0) pieces.push(index === entry.groups.length - 1 ? ' and ' : ', ');
    pieces.push(viewLink(school, 'group', taught.groupId, typed(group ? group.name : 'a group')));
    if (taught.roomId !== null && !roomIds.includes(taught.roomId)) roomIds.push(taught.roomId);
  });
  if (roomIds.length === 0) return pieces.concat(' in a room that is not in the building');
  pieces.push(' in ');
  roomIds.forEach((roomId, index) => {
    if (index > 0) pieces.push(index === roomIds.length - 1 ? ' and ' : ', ');
    pieces.push(viewLink(school, 'room', roomId, typed(school.roomName(school.room(roomId)))));
  });
  return pieces;
}
