// The spec 3.13 fixture grown as ARCHITECTURE 17.8 says, for the timing
// suites: test/fixtures/big.mjs's building, rooms, teachers and 80 groups,
// with six day types and two bell schedules, so twelve runs.
//
//   A Day, B Day     the fixture's own two
//   C Day            its own classes: each group's A Day, turned round by one
//                    to three periods, so its transitions are not A Day's
//   D Day            its own classes: each group's B Day backwards
//   E Day            the same as C Day
//   F Day            the same as B Day
//   Early Release    six periods of 30 minutes, 3 minutes between them, the
//                    last four periods not meeting
//   Assembly         ten periods of 40 minutes, 5 minutes between them
//
// So 4 own day types × (regular bells, Early Release, Assembly) = 12 runs.
// A helper, not a suite (test/run.mjs names it among the timing folder's
// helpers).

import { bigProject, BIG } from '../fixtures/big.mjs';

export const BIG_RUNS = { ...BIG, dayTypes: 6, ownDayTypes: 4, bellSchedules: 2, offPeriods: 4, runs: 12 };

function bellTime(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function times(periods, start, length, between) {
  return Array.from({ length: periods }, (unused, p) => ({ start: bellTime(start + p * (length + between)), end: bellTime(start + p * (length + between) + length) }));
}

export function bigRunsProject(options) {
  const project = bigProject(options);
  const [dayA, dayB] = project.dayTypes;
  const periods = BIG.periods;
  const blank = () => Array.from({ length: periods }, () => null);
  const dayC = { id: 'dbig00000c', name: 'C Day', own: true, sameAs: null, short: '', bells: dayA.bells.map((bell) => ({ ...bell })) };
  const dayD = { id: 'dbig00000d', name: 'D Day', own: true, sameAs: null, short: '', bells: dayB.bells.map((bell) => ({ ...bell })) };
  const dayE = { id: 'dbig00000e', name: 'E Day', own: false, sameAs: dayC.id, short: '', bells: blank() };
  const dayF = { id: 'dbig00000f', name: 'F Day', own: false, sameAs: dayB.id, short: '', bells: blank() };
  project.dayTypes = [dayA, dayB, dayC, dayD, dayE, dayF];
  project.groups.forEach((group, g) => {
    const turn = 1 + (g % 3);
    const a = group.days[dayA.id];
    const b = group.days[dayB.id];
    group.days[dayC.id] = a.map((unused, p) => ({ ...a[(p + turn) % periods] }));
    group.days[dayD.id] = b.map((unused, p) => ({ ...b[periods - 1 - p] }));
  });
  const early = times(6, 8 * 60, 30, 3).concat(Array.from({ length: periods - 6 }, () => null));
  project.bellSchedules = [
    { id: 'bbig0000er', name: 'Early Release', short: '', bells: early, off: [6, 7, 8, 9] },
    { id: 'bbig0000as', name: 'Assembly', short: '', bells: times(periods, 8 * 60, 40, 5), off: [] },
  ];
  return project;
}
