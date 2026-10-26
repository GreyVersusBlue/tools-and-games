// The sample school with every field of ARCHITECTURE 17.2 to 17.4 in use,
// for the validate, repair and migrate tests, and one way to break each rule
// those fields have. Invented data only.

import { sampleSchool } from '../../data/sample-school.js';
import { defaultWeekdays } from '../../engine/schema.js';

export const A = 'dsample00a';
export const B = 'dsample00b';
export const C = 'dsample00c';
export const D = 'dsample00d';
export const ER = 'bsample0er';
export const AS = 'bsample0as';

// A and B Day their own; C Day the same as B Day with a typed short "C"; D Day
// the same as A Day by an absent sameAs. Early Release (Periods 6 to 8 off)
// on Wednesdays, an Assembly schedule on one date; a rotation of A and B
// from 31 August 2026 to 11 June 2027 with a snow day, a re-sync, a
// Saturday make-up day and Thanksgiving.
export function withEverything() {
  const project = sampleSchool();
  const bells = project.dayTypes[0].bells;
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: B, short: 'C', bells: Array(8).fill(null) });
  project.dayTypes.push({ id: D, name: 'D Day', own: false, bells: Array(8).fill(null) });
  project.bellSchedules = [
    { id: ER, name: 'Early Release', short: '', bells: bells.map((bell) => (bell ? { ...bell } : null)), off: [5, 6, 7] },
    { id: AS, name: 'Assembly', short: 'AS', bells: bells.map((bell) => (bell ? { ...bell } : null)), off: [] },
  ];
  const weekdays = defaultWeekdays();
  weekdays[2] = { day: 'rotation', bells: ER };
  project.calendar = {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays,
    rotation: [A, B],
    dates: [
      { date: '2026-10-03', day: 'rotation', bells: null, label: 'Make-up day' },
      { date: '2026-10-14', day: C, bells: AS, label: 'Assembly' },
      { date: '2026-11-26', day: 'closed', bells: null, label: 'Thanksgiving' },
      { date: '2027-01-12', day: 'closed', bells: null, label: 'Snow day' },
      { date: '2027-01-13', day: B, bells: 'regular', label: '' },
    ],
    changedAt: '2026-09-01T12:00:00.000Z',
  };
  project.publish = { ...project.publish, views: { ...project.publish.views, calendar: false }, staleAtCalendarEnd: false };
  return project;
}

const many = (n, make) => Array.from({ length: n }, (unused, i) => make(i));

// [what, how to break withEverything(), where validate finds it, and true
// when repair puts it right with no note: a field that is absent gets its
// default and no note, as everywhere in repair]
export const NEW_BREAKS = [
  ['a sameAs that is not text', (p) => { p.dayTypes[2].sameAs = 7; }, /^dayTypes\[2\]\.sameAs$/],
  ['a day type the same as itself', (p) => { p.dayTypes[2].sameAs = C; }, /^dayTypes\[2\]\.sameAs$/],
  ['a day type the same as one that is itself the same as another', (p) => { p.dayTypes[2].sameAs = D; }, /^dayTypes\[2\]\.sameAs$/],
  ['a day type the same as one that is not there', (p) => { p.dayTypes[2].sameAs = 'dnowhere00'; }, /^dayTypes\[2\]\.sameAs$/],
  ['an own day type that says it is the same as another', (p) => { p.dayTypes[1].sameAs = A; }, /^dayTypes\[1\]\.sameAs$/],
  ['a short name that is not text', (p) => { p.dayTypes[2].short = 5; }, /^dayTypes\[2\]\.short$/],
  ['a short name of five characters', (p) => { p.dayTypes[2].short = 'CDAYS'; }, /^dayTypes\[2\]\.short$/],
  ['two day types typed the same short name, whatever the capitals', (p) => { p.dayTypes[3].short = 'c'; }, /^dayTypes\[3\]\.short$/],
  ['bell schedules that are not a list', (p) => { p.bellSchedules = 'Early Release'; }, /^bellSchedules$/],
  ['thirteen bell schedules', (p) => { p.bellSchedules = many(13, (i) => ({ id: 'bsample' + String(i).padStart(3, '0'), name: 'Bells ' + i, short: '', bells: Array(8).fill(null), off: [] })); }, /^bellSchedules$/],
  ['a bell schedule that is not an object', (p) => { p.bellSchedules[0] = 'Early Release'; }, /^bellSchedules\[0\]$/],
  ['a bell schedule with an id of another kind', (p) => { p.bellSchedules[0].id = 'xsample0er'; }, /^bellSchedules\[0\]\.id$/],
  ['a bell schedule with no name', (p) => { p.bellSchedules[0].name = '  '; }, /^bellSchedules\[0\]\.name$/],
  ['a bell schedule name of 41 characters', (p) => { p.bellSchedules[0].name = 'E'.repeat(41); }, /^bellSchedules\[0\]\.name$/],
  ['two bell schedules of one name, whatever the capitals and spaces', (p) => { p.bellSchedules[1].name = 'early  release'; }, /^bellSchedules\[1\]\.name$/],
  ['a bell schedule short name of five characters', (p) => { p.bellSchedules[0].short = 'EARLY'; }, /^bellSchedules\[0\]\.short$/],
  ['two bell schedules typed the same short name', (p) => { p.bellSchedules[0].short = 'as'; }, /^bellSchedules\[1\]\.short$/],
  ['a bell schedule with no short name field', (p) => { delete p.bellSchedules[0].short; }, /^bellSchedules\[0\]\.short$/, true],
  ['a bell schedule with a time for each of 9 periods', (p) => { p.bellSchedules[0].bells.push(null); }, /^bellSchedules\[0\]\.bells$/],
  ['a bell schedule time that is not a time', (p) => { p.bellSchedules[0].bells[0] = { start: '8 am', end: '09:00' }; }, /^bellSchedules\[0\]\.bells\[0\]$/],
  ['periods that do not meet out of order', (p) => { p.bellSchedules[0].off = [7, 5, 6]; }, /^bellSchedules\[0\]\.off$/],
  ['a period that does not meet listed twice', (p) => { p.bellSchedules[0].off = [5, 5]; }, /^bellSchedules\[0\]\.off$/],
  ['a period that does not meet past the end of the day', (p) => { p.bellSchedules[0].off = [5, 8]; }, /^bellSchedules\[0\]\.off$/],
  ['periods that do not meet that are not a list', (p) => { p.bellSchedules[0].off = 5; }, /^bellSchedules\[0\]\.off$/],
  ['a calendar that is not an object', (p) => { p.calendar = [p.calendar]; }, /^calendar$/],
  ['a calendar whose first day is not a date', (p) => { p.calendar.start = '2026-02-30'; }, /^calendar\.start$/],
  ['a calendar whose last day is not a date', (p) => { p.calendar.end = '11 June 2027'; }, /^calendar\.end$/],
  ['a calendar that ends before it starts', (p) => { p.calendar.end = '2026-08-30'; }, /^calendar\.end$/],
  ['a calendar of 732 days', (p) => { p.calendar.end = '2028-08-31'; }, /^calendar\.end$/],
  ['a calendar with six weekday rules', (p) => { p.calendar.weekdays.pop(); }, /^calendar\.weekdays$/],
  ['a weekday rule that is not an object', (p) => { p.calendar.weekdays[0] = 'rotation'; }, /^calendar\.weekdays\[0\]$/],
  ['a weekday naming a day type that is not there', (p) => { p.calendar.weekdays[4].day = 'dnowhere00'; }, /^calendar\.weekdays\[4\]\.day$/],
  ['a weekday naming a bell schedule that is not there', (p) => { p.calendar.weekdays[2].bells = 'bnowhere00'; }, /^calendar\.weekdays\[2\]\.bells$/],
  ['a weekday whose bells are "regular", which is for dates', (p) => { p.calendar.weekdays[2].bells = 'regular'; }, /^calendar\.weekdays\[2\]\.bells$/],
  ['an empty rotation', (p) => { p.calendar.rotation = []; }, /^calendar\.rotation$/],
  ['a rotation of 25', (p) => { p.calendar.rotation = many(25, (i) => (i % 2 ? A : B)); }, /^calendar\.rotation$/],
  ['a rotation naming a day type that is not there', (p) => { p.calendar.rotation.push('dnowhere00'); }, /^calendar\.rotation\[2\]$/],
  ['dated changes that are not a list', (p) => { p.calendar.dates = {}; }, /^calendar\.dates$/],
  ['a dated change that is not an object', (p) => { p.calendar.dates[0] = '2026-10-03'; }, /^calendar\.dates\[0\]$/],
  ['a dated change on a date that is not one', (p) => { p.calendar.dates[0].date = '2026-10-32'; }, /^calendar\.dates\[0\]\.date$/],
  ['dated changes out of order', (p) => { p.calendar.dates.reverse(); }, /^calendar\.dates\[1\]\.date$/],
  ['two dated changes on one date', (p) => { p.calendar.dates[1].date = p.calendar.dates[0].date; }, /^calendar\.dates\[1\]\.date$/],
  ['a dated change naming a day type that is not there', (p) => { p.calendar.dates[1].day = 'dnowhere00'; }, /^calendar\.dates\[1\]\.day$/],
  ['a dated change naming a bell schedule that is not there', (p) => { p.calendar.dates[1].bells = 'bnowhere00'; }, /^calendar\.dates\[1\]\.bells$/],
  ['a dated change whose note is not text', (p) => { p.calendar.dates[2].label = null; }, /^calendar\.dates\[2\]\.label$/],
  ['a dated change whose note is 61 characters', (p) => { p.calendar.dates[2].label = 'T'.repeat(61); }, /^calendar\.dates\[2\]\.label$/],
  ['a calendar change time that is not a time', (p) => { p.calendar.changedAt = 'last week'; }, /^calendar\.changedAt$/],
  ['staleAtCalendarEnd that is not true or false', (p) => { p.publish.staleAtCalendarEnd = 'yes'; }, /^publish\.staleAtCalendarEnd$/],
  ['the calendar view switched on with something not true or false', (p) => { p.publish.views.calendar = 1; }, /^publish\.views\.calendar$/],
];
