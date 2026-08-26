// utilisation.js — does this building work for this timetable?
//
// Every reader before this one asks a question a drawing can answer on its
// own: how many people fit, how far to a door, how much glass, how long the
// room rings. This one cannot be asked without a timetable, which is why it
// did not exist until Phase 15 and why it is the prize the phase was for.
// "How far is it to an exit" is a fact about a building. "How far does 9th
// grade walk between second and third period, every day, for a year" is a fact
// about a school, and it needs both halves.
//
// Four readings, and each of them is the same shape the rest of the analysis
// is — a finding, a rule, a measurement, worst-first:
//
// - **Utilisation.** Which rooms are used, how much of the day, and which sit
//   empty in the period the building is fullest. An empty room at peak is the
//   most expensive thing a school can own.
// - **Capacity.** A cohort timetabled into a room whose occupant load is
//   smaller than the cohort. The report already knows every room's load; the
//   timetable is what puts a number of children in front of it.
// - **Passing-period travel.** Measured over Phase 10's nav mesh, room to
//   room, per cohort, per bell — and then against the passing time the bell
//   schedule actually allows, which turns an honest distance into a claim
//   somebody can check with a stopwatch.
// - **Corridor load.** Whose route crosses which corridor at the same bell,
//   and how many square feet each of those people gets while it happens.
//
// Nothing here is stored. A timetable is in the file; every number below is
// derived from it and the building on the day it is asked, exactly like the
// occupant loads it leans on.
//
// Pure module: no three.js, no DOM. Exercised by test/utilisation.test.mjs.

import { floorLabel } from './grid.js';
import { buildNav, findPath, pathDistance } from './navgraph.js';
import { buildingOccupancy, occupancyIndex, useEntry } from './occupancy.js';
import { normalizeSchedule } from './schedule.js';
import {
  normalizeTimetable, isEmptyTimetable, periodsOf, roomPool, poolIndex,
  timetableIssues, subjectEntry,
} from './timetable.js';

// The pace a passing period is walked at. Same number `agents.js` gives a
// student between bells, quoted here rather than imported so that a reading
// about a corridor doesn't drag the whole crowd simulation in behind it —
// and asserted equal to it in the suite, which is the honest way to keep two
// constants in step without coupling two modules.
export const PASSING_SPEED = 5.2;      // ft/s

// What a corridor gives each person while a passing period is going through
// it. Not a code limit — egress width is the code's question and `egress.js`
// answers it — but the rule of thumb a facilities planner uses for comfort:
// under 10 ft² a head is a crush you can feel, under 5 is a crowd that stops
// moving. Printed with every finding that quotes it, like every other number
// in this codebase that came from a rule of thumb rather than a table.
export const CROWD_ROOMY = 10;         // ft² per person
export const CROWD_CRUSH = 5;          // ft² per person

// A room used fewer than this many periods out of the day is idle enough to
// be worth naming. Two of seven is the figure school-district facility
// guidelines use for "underused"; it is a planning convention, not a rule.
export const IDLE_SHARE = 0.4;

const finding = (level, code, title, detail, extra = {}) =>
  ({ level, code, title, detail, ...extra });

const ft = (n) => `${Math.round(n)} ft`;
const pct = (n) => `${Math.round(n * 100)}%`;
const roomLabel = (r) => (r && r.name) || (r ? `an unnamed room on ${floorLabel(r.floor)}` : 'a room');

// ---------- the day, period by period ----------

// Who is where, when. One pass over the sections, and everything below reads
// this rather than the timetable — which is what keeps a section's cohort
// looked up once rather than once per reading.
function periodTable(tt, cohortSize, periods) {
  const out = [];
  for (let p = 1; p <= periods; p++) {
    out.push({ period: p, label: `Period ${p}`, sections: [], rooms: new Map(), seated: 0, placed: 0 });
  }
  for (const s of tt.sections) {
    const slot = out[s.period - 1];
    if (!slot) continue;
    const size = cohortSize.get(s.cohort) || 0;
    slot.sections.push(s);
    if (!s.room) continue;
    slot.placed++;
    slot.seated += size;
    const prev = slot.rooms.get(s.room);
    if (prev) { prev.people += size; prev.sections.push(s); }
    else slot.rooms.set(s.room, { people: size, sections: [s] });
  }
  return out;
}

// ---------- the walk between bells ----------

// Every move a cohort makes, measured. A move is a period boundary where the
// room changes; staying put is not a walk and does not belong in a mean that
// is trying to say what a passing period costs.
//
// The distances come off `pathDistance` rather than off the cost `findPath`
// optimised, because a lift's forty-five-foot-equivalent wait is a wait and
// not a walk, and printing it as feet would make the one number this phase
// exists to produce a lie.
export function travelAnalysis(nav, tt, opts = {}) {
  const sched = normalizeSchedule(opts.schedule);
  const periods = opts.periods || periodsOf(tt);
  const speed = opts.speed || PASSING_SPEED;
  const allowed = sched.passingMin * 60;
  const byCohort = new Map();
  for (const c of tt.cohorts) byCohort.set(c.id, { cohort: c, moves: [], total: 0, worst: null });
  const slots = new Map();
  for (const s of tt.sections) slots.set(`${s.cohort}|${s.period}`, s);

  const moves = [];
  const unreachable = [];
  // One cache per pair of rooms: a school of twenty-four cohorts over seven
  // periods asks for a hundred and sixty-eight routes and most of them are the
  // same dozen corridors twice.
  const cache = new Map();
  const measure = (from, to) => {
    const key = `${from}>${to}`;
    if (cache.has(key)) return cache.get(key);
    const path = findPath(nav, from, to);
    const out = path ? { ...pathDistance(nav, path), path } : null;
    cache.set(key, out);
    return out;
  };

  for (const c of tt.cohorts) {
    const row = byCohort.get(c.id);
    for (let p = 1; p < periods; p++) {
      const a = slots.get(`${c.id}|${p}`);
      const b = slots.get(`${c.id}|${p + 1}`);
      if (!a || !b || !a.room || !b.room || a.room === b.room) continue;
      const walk = measure(a.room, b.room);
      if (!walk) {
        unreachable.push({ cohort: c, from: a.room, to: b.room, period: p });
        continue;
      }
      const seconds = walk.dist / speed;
      const move = {
        cohort: c.id, cohortName: c.name, size: c.size,
        period: p, to: p + 1,
        from: a.room, room: b.room,
        dist: walk.dist, seconds, links: walk.links,
        crosses: walk.rooms,
        // The claim a stopwatch can check: at a passing-period pace, does this
        // group get there before the bell?
        late: allowed > 0 && seconds > allowed,
      };
      moves.push(move);
      row.moves.push(move);
      row.total += walk.dist;
      if (!row.worst || walk.dist > row.worst.dist) row.worst = move;
    }
  }

  moves.sort((a, b) => b.dist - a.dist);
  const walked = moves.reduce((n, m) => n + m.dist, 0);
  const cohorts = [...byCohort.values()].sort((a, b) => b.total - a.total);
  return {
    moves,
    cohorts,
    unreachable,
    allowed,
    speed,
    summary: {
      moves: moves.length,
      // Per student, per day: the number a parent asks about and the only one
      // of these that is about a person rather than about a plan.
      perDay: cohorts.length ? walked / cohorts.length : 0,
      mean: moves.length ? walked / moves.length : 0,
      worst: moves[0] || null,
      late: moves.filter((m) => m.late).length,
      // A year of school days. Printed because "nine hundred feet a day" is a
      // number nobody has a feel for and "thirty-four miles a year" is one
      // everybody does.
      milesPerYear: cohorts.length
        ? (walked / cohorts.length) * (opts.schoolDays || 180) / 5280
        : 0,
    },
  };
}

// ---------- the corridor at the bell ----------

// What every route crosses, added up per period boundary. A cohort walking
// from a lab to a gym puts its whole size into every circulation space on the
// way, and the space that carries three cohorts at one bell is the one a
// building actually gets tight in — measured off the routes rather than
// guessed off the plan, which is the only way a bottleneck nobody predicted
// ever shows up.
export function corridorLoad(travel, occIndex, opts = {}) {
  const by = new Map();
  for (const move of travel.moves) {
    for (const id of move.crosses) {
      const room = occIndex.get(id);
      if (!room) continue;
      // Only the spaces that carry other rooms' people. A route that crosses
      // a classroom to get to the door is a route through somebody's lesson,
      // and that is a finding about the plan rather than about the crowd.
      if (!room.circulation) continue;
      const key = `${move.period}|${id}`;
      let row = by.get(key);
      if (!row) {
        row = {
          id, period: move.period, name: room.name, floor: room.floor,
          area: room.area, people: 0, cohorts: [],
        };
        by.set(key, row);
      }
      row.people += move.size;
      row.cohorts.push(move.cohortName);
    }
  }
  const rows = [...by.values()].map((r) => ({
    ...r,
    // Square feet a head, while the bell is going. Small is bad.
    perHead: r.people > 0 ? r.area / r.people : Infinity,
  }));
  rows.sort((a, b) => a.perHead - b.perHead);
  const roomy = opts.roomy ?? CROWD_ROOMY;
  const crush = opts.crush ?? CROWD_CRUSH;
  return {
    rows,
    worst: rows[0] || null,
    tight: rows.filter((r) => r.perHead < roomy).length,
    crushed: rows.filter((r) => r.perHead < crush).length,
    roomy,
    crush,
  };
}

// ---------- the whole reading ----------

export function utilisationAnalysis(state, opts = {}) {
  const tt = normalizeTimetable(opts.timetable || (state && state.timetable));
  const sched = normalizeSchedule(opts.schedule
    || (state && state.life && state.life.schedule));
  const nav = opts.nav || buildNav(state);
  const occupancy = opts.occupancy || buildingOccupancy(state, { nav });
  const occIndex = occupancyIndex(occupancy);
  const pool = opts.pool || roomPool(nav, { occupancy });
  const rooms = poolIndex(pool);
  const periods = Math.max(periodsOf(tt), 0);

  const empty = {
    has: false,
    periods: [],
    rooms: [],
    travel: null,
    corridors: null,
    issues: null,
    summary: {
      cohorts: 0, sections: 0, placed: 0, students: 0, periods: 0,
      rooms: pool.length, used: 0, utilisation: 0, peak: null,
      idleAtPeak: 0, over: 0, late: 0,
    },
    findings: [],
  };
  if (isEmptyTimetable(tt) || !pool.length) return empty;

  const cohortSize = new Map(tt.cohorts.map((c) => [c.id, c.size]));
  const table = periodTable(tt, cohortSize, periods);
  const issues = timetableIssues(tt, pool);

  // Per room: how much of the day it works, and how full it is when it does.
  const roomRows = pool.map((r) => ({
    id: r.id, name: r.name, floor: r.floor, area: r.area,
    use: r.use, useLabel: useEntry(r.use).label, capacity: r.capacity,
    used: 0, peak: 0, peakPeriod: null, over: 0, people: 0,
  }));
  const roomRowIndex = new Map(roomRows.map((r) => [r.id, r]));
  for (const slot of table) {
    for (const [id, cell] of slot.rooms) {
      const row = roomRowIndex.get(id);
      if (!row) continue;
      row.used++;
      row.people += cell.people;
      if (cell.people > row.peak) { row.peak = cell.people; row.peakPeriod = slot.period; }
      if (cell.people > row.capacity) row.over++;
    }
  }
  for (const row of roomRows) {
    row.share = periods ? row.used / periods : 0;
    row.mean = row.used ? row.people / row.used : 0;
    row.spare = row.capacity - row.peak;
  }
  roomRows.sort((a, b) => a.share - b.share || b.area - a.area);

  // The period the building is fullest, and what is standing empty during it.
  let peak = null;
  for (const slot of table) if (!peak || slot.seated > peak.seated) peak = slot;
  const idleAtPeak = peak
    ? roomRows.filter((r) => !peak.rooms.has(r.id))
    : [];

  const travel = travelAnalysis(nav, tt, { schedule: sched, periods, ...opts.travel });
  const corridors = corridorLoad(travel, occIndex, opts.corridor || {});

  const used = roomRows.filter((r) => r.used > 0).length;
  const capacity = roomRows.reduce((n, r) => n + r.capacity, 0);
  const summary = {
    cohorts: tt.cohorts.length,
    sections: tt.sections.length,
    placed: tt.sections.filter((s) => s.room).length,
    students: tt.cohorts.reduce((n, c) => n + c.size, 0),
    periods,
    rooms: roomRows.length,
    used,
    // Room-periods filled over room-periods available: the one number a
    // facilities office asks a building for, and the one this whole reading
    // is arranged around.
    utilisation: periods && roomRows.length
      ? roomRows.reduce((n, r) => n + r.used, 0) / (periods * roomRows.length)
      : 0,
    peak: peak ? { period: peak.period, seated: peak.seated, rooms: peak.rooms.size } : null,
    seatedShare: capacity ? (peak ? peak.seated / capacity : 0) : 0,
    idleAtPeak: idleAtPeak.length,
    over: issues.over.length,
    late: travel.summary.late,
  };

  return {
    has: true,
    timetable: tt,
    periods: table.map((slot) => ({
      period: slot.period, label: slot.label,
      sections: slot.sections.length, placed: slot.placed,
      seated: slot.seated, rooms: slot.rooms.size,
    })),
    rooms: roomRows,
    idleAtPeak,
    travel,
    corridors,
    issues,
    summary,
    findings: utilisationFindings({
      tt, rooms, roomRows, issues, travel, corridors, summary, sched, idleAtPeak, peak,
    }),
  };
}

function utilisationFindings(ctx) {
  const { issues, travel, corridors, summary, sched, idleAtPeak } = ctx;
  const out = [];
  const name = (id) => roomLabel(ctx.rooms.get(id));

  // A class that does not fit in the room it was given. The hardest of these
  // to argue with: the occupant load is the report's own number and the class
  // size is the timetable's own number.
  if (issues.over.length) {
    const worst = issues.over.slice().sort((a, b) =>
      (b.size - b.room.capacity) - (a.size - a.room.capacity))[0];
    out.push(finding('fail', 'over-load',
      `${issues.over.length} section${issues.over.length === 1 ? '' : 's'} in a room too small for the class`,
      `${roomLabel(worst.room)} holds ${worst.room.capacity} by its occupant load and is ` +
      `timetabled for ${worst.size}. Occupant load is area over the factor for what the room ` +
      'is — so the fix is a bigger room, a smaller section, or telling the room what it really is.',
      { rooms: issues.over.slice(0, 8).map((o) => o.room) }));
  }

  if (issues.unplaced.length || issues.missing.length) {
    const n = issues.unplaced.length + issues.missing.length;
    out.push(finding('warn', 'unplaced',
      `${n} section${n === 1 ? '' : 's'} with nowhere to be`,
      issues.missing.length
        ? `${issues.missing.length} of them name a room this building no longer has — the ` +
          'design was edited under the timetable. The rest found no free room of any kind ' +
          'in their period.'
        : 'Every room of every kind was already busy in that period. A school that cannot ' +
          'place a section needs another teaching space, not another try at the packing.'));
  }

  if (issues.mismatched.length) {
    const first = issues.mismatched[0];
    out.push(finding('warn', 'wrong-room',
      `${issues.mismatched.length} section${issues.mismatched.length === 1 ? '' : 's'} in a room of the wrong kind`,
      `${(subjectEntry(first.section.subject) || {}).label || 'A subject'} wants ` +
      `a ${useEntry(first.want).label.toLowerCase()} and got ${roomLabel(first.room)}, which reads as ` +
      `${useEntry(first.room.use).label.toLowerCase()}. Science in a room with no gas and no sink is ` +
      'the timetable saying the building is short of labs.'));
  }

  if (issues.roomClash.length || issues.teacherClash.length || issues.cohortClash.length) {
    const n = issues.roomClash.length + issues.teacherClash.length + issues.cohortClash.length;
    out.push(finding('fail', 'double-booked',
      `${n} double booking${n === 1 ? '' : 's'}`,
      `${issues.roomClash.length} room, ${issues.teacherClash.length} teacher and ` +
      `${issues.cohortClash.length} cohort clash${issues.cohortClash.length === 1 ? '' : 'es'}. ` +
      'A generated timetable cannot produce these; an imported one can, and this is what ' +
      'it looks like when a spreadsheet has two groups in one room at one bell.'));
  }

  // The one the phase was for.
  if (travel.summary.late) {
    const worst = travel.moves.find((m) => m.late) || travel.summary.worst;
    out.push(finding('warn', 'passing-time',
      `${travel.summary.late} move${travel.summary.late === 1 ? '' : 's'} that don't fit the passing period`,
      `${worst.cohortName} walks ${ft(worst.dist)} between periods ${worst.period} and ${worst.to} — ` +
      `${Math.round(worst.seconds)} s at ${travel.speed} ft/s, against ${sched.passingMin} minutes of ` +
      'passing time. Measured over the nav mesh, door to door, so it is the walk rather than ' +
      'the straight line.',
      { rooms: [worst.from, worst.room].map((id) => ctx.rooms.get(id)).filter(Boolean) }));
  } else if (travel.summary.worst) {
    const w = travel.summary.worst;
    out.push(finding('ok', 'passing-time', 'Every group makes it between bells',
      `The longest move is ${w.cohortName}'s ${ft(w.dist)} into period ${w.to} — ` +
      `${Math.round(w.seconds)} s of the ${sched.passingMin * 60} s the bell schedule allows.`));
  }

  if (travel.unreachable.length) {
    out.push(finding('fail', 'no-route',
      `${travel.unreachable.length} move${travel.unreachable.length === 1 ? '' : 's'} with no route at all`,
      'The graph has no way from one of these rooms to the next. A room reachable only ' +
      'through another room that has no door is the usual cause, and the accessible-route ' +
      'check upstairs is normally saying the same thing about the same room.'));
  }

  if (corridors.crushed) {
    const w = corridors.worst;
    out.push(finding('warn', 'corridor-crush',
      `${corridors.crushed} corridor${corridors.crushed === 1 ? '' : 's'} carrying more than they can hold`,
      `${roomLabel(w)} carries ${w.people} people from ${w.cohorts.length} groups at the bell into ` +
      `period ${w.period + 1} — ${w.perHead.toFixed(1)} ft² each, against ${corridors.crush} ft² ` +
      'as the point a crowd stops moving. A planning rule of thumb, not a code limit: egress ' +
      'width is the code question and the egress section answers it.',
      { rooms: corridors.rows.slice(0, 6) }));
  } else if (corridors.tight) {
    const w = corridors.worst;
    out.push(finding('note', 'corridor-tight',
      `${corridors.tight} corridor${corridors.tight === 1 ? '' : 's'} tight at the bell`,
      `${roomLabel(w)} gives each of ${w.people} people ${w.perHead.toFixed(1)} ft² between ` +
      `periods ${w.period} and ${w.period + 1}. Under ${corridors.roomy} ft² a head is a corridor ` +
      'you can feel; it is comfort rather than code.'));
  }

  // Rooms standing empty while the school is at its fullest.
  if (idleAtPeak.length && summary.peak) {
    const level = idleAtPeak.length > summary.rooms / 2 ? 'warn' : 'note';
    out.push(finding(level, 'idle-at-peak',
      `${idleAtPeak.length} teaching room${idleAtPeak.length === 1 ? '' : 's'} empty at the busiest period`,
      `Period ${summary.peak.period} seats ${summary.peak.seated} of ${summary.students} students in ` +
      `${summary.peak.rooms} rooms, and ${idleAtPeak.length} more sit empty — ` +
      `${name(idleAtPeak[0].id)} among them. Whole-day utilisation is ${pct(summary.utilisation)}.`,
      { rooms: idleAtPeak.slice(0, 8) }));
  }

  if (summary.utilisation && summary.utilisation < IDLE_SHARE) {
    out.push(finding('note', 'low-utilisation',
      `The building works ${pct(summary.utilisation)} of the day`,
      `${summary.used} of ${summary.rooms} teaching rooms are used at all, across ` +
      `${summary.periods} periods. Under ${pct(IDLE_SHARE)} is the figure facility guidelines ` +
      'call underused — which is a planning convention rather than a rule, and is usually a ' +
      'school with more rooms than it has classes to put in them.'));
  }

  if (issues.unstaffed.length) {
    out.push(finding('warn', 'unstaffed',
      `${issues.unstaffed.length} section${issues.unstaffed.length === 1 ? '' : 's'} with no teacher free`,
      'Every teacher of that subject is already in another room that period. The staff ' +
      'establishment comes off the program\'s own students-per-adult ratio, so this is the ' +
      'timetable saying the school is short of that department rather than short of rooms.'));
  }

  if (!out.length) {
    out.push(finding('ok', 'timetable', 'This building suits this timetable',
      `${summary.sections} sections, ${summary.cohorts} groups and ${summary.students} students ` +
      `over ${summary.periods} periods, at ${pct(summary.utilisation)} utilisation, every one ` +
      'of them in a room big enough and near enough to get to before the bell.'));
  }
  return out;
}

// ---------- the crowd, at the number the analysis worked out ----------

// How many people the building is *for*, as a population size. The report
// knows the occupant load room by room; `life.students` has been a slider
// since Phase 6 with nothing to check it against, and this is the one line
// that connects them.
//
// Teaching spaces only, and the staff come out: a fire drill of everybody the
// occupant load allows is a fire drill including the four hundred people the
// cafeteria could seat if the whole school ate at once, which is not a school
// day. A timetable, when there is one, is the better answer still — it says
// how many children are actually in the building.
export function crowdSize(occupancy, opts = {}) {
  const tt = opts.timetable ? normalizeTimetable(opts.timetable) : null;
  if (tt && !isEmptyTimetable(tt)) {
    const students = tt.cohorts.reduce((n, c) => n + c.size, 0);
    return { students, from: 'timetable', detail: `${tt.cohorts.length} groups in the timetable` };
  }
  if (!occupancy || !occupancy.rooms) return { students: 0, from: 'none', detail: 'nothing drawn yet' };
  let seats = 0;
  for (const r of occupancy.rooms) {
    if (r.circulation || r.tiny) continue;
    const use = useEntry(r.use);
    // The rooms a class is timetabled into. A gym, a cafeteria and an
    // auditorium each hold a crowd, and each of them holds the *same* crowd
    // the classrooms hold — counting all three is counting the school four
    // times, which is exactly the mistake `circulation` exists to prevent
    // one storey down.
    if (!['classroom', 'lab', 'stage'].includes(use.key)) continue;
    seats += r.occ;
  }
  return {
    students: seats,
    from: 'occupancy',
    detail: 'the occupant load of every classroom, lab and studio',
  };
}
