// timetable.js — this school's day, rather than a plausible one.
//
// Phase 6 gave every student a room per period that wasn't the one they were
// just in, said out loud that it was random, and said the real timetable
// belonged with the generator because it is the same problem as laying out the
// building: a thing that needs a place, a place that can only hold one thing at
// a time, and a report on what would not fit. Phase 15 is that promise kept.
//
// The vocabulary is four words. A **cohort** is a group of children who move
// together. A **teacher** is somebody who can only be in one room at a time. A
// **section** is one cohort, in one room, with one teacher, in one period — the
// atom, and the only one of the four that is a row in the file. A **room** is
// a room, named by the id Phase 12 gave it, which is the whole reason a
// binding survives somebody renaming "Room 104" to "Art Studio".
//
// Two things follow from that and both are deliberate:
//
// **The packing reports what it could not satisfy.** A school with one gym and
// twenty-four cohorts cannot give everybody PE at once, and the honest answer
// is to say which sections went into a room of the wrong kind, which found no
// room at all, and which are standing in a room smaller than the class — not to
// quietly widen the gym. `timetableIssues` is that answer, it is recomputed
// against the building as it stands rather than stored, and it is what
// `utilisation.js` and the report read.
//
// **A timetable can come from outside.** `Tools/` in this repository already
// holds a schedule browser and a visualiser that read a real school's real
// timetable, and their CSV is one row per group with a room in each period
// column. `importTimetableCSV` reads exactly that, binds each cell to a room by
// id first and by name second, and lists what it could not bind rather than
// dropping it — which is the item that makes this phase worth anything at all
// to somebody who already has a timetable and wants to know whether their
// building suits it.
//
// Pure module: no three.js, no DOM. Exercised by test/timetable.test.mjs.

import { rng } from './agents.js';
import { normalizeSchedule } from './schedule.js';
import { teachingRooms } from './navgraph.js';
import { roomOccupancy, occupancyIndex } from './occupancy.js';
import { csvRows } from './takeoff.js';

// ---------- what a school teaches ----------
//
// `wants` is an occupancy group from occupancy.js, not a second vocabulary:
// "science wants a lab" is answerable because `classify` already decides which
// rooms are labs, and a table with its own idea of what a lab is would drift
// away from the one the report prints.
export const SUBJECTS = [
  { key: 'ela', label: 'English', wants: 'classroom' },
  { key: 'math', label: 'Mathematics', wants: 'classroom' },
  { key: 'science', label: 'Science', wants: 'lab' },
  { key: 'social', label: 'Social Studies', wants: 'classroom' },
  { key: 'world', label: 'World Language', wants: 'classroom' },
  { key: 'art', label: 'Art', wants: 'lab' },
  { key: 'music', label: 'Music', wants: 'stage' },
  { key: 'pe', label: 'Physical Education', wants: 'gym' },
  { key: 'tech', label: 'Technology', wants: 'lab' },
];

const SUBJECT_BY_KEY = new Map(SUBJECTS.map((s) => [s.key, s]));
export const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);
export const subjectEntry = (key) => SUBJECT_BY_KEY.get(key) || null;

// The one room kind every school has enough of. A subject whose own kind is
// full falls back here before it falls back to nothing.
export const FALLBACK_USE = 'classroom';

// The rooms a class can be timetabled into at all. `teachingRooms` filters by
// *size and name* — it has to, because it predates the occupancy table — and
// that lets a 300 ft² Main Office through as somewhere to put a maths lesson.
// A class in a library or a cafeteria is a real school making do; a class in
// the principal's office is the packing having run out of ideas and not said
// so, which is the one thing this module is not allowed to do.
export const TEACHABLE = [
  'classroom', 'lab', 'gym', 'stage', 'library', 'assembly-seats', 'assembly-tables',
];

// Which grades a band's cohorts are named for. K is 0, which is why these are
// numbers rather than strings — `gradeLabel` puts the K back.
export const BAND_GRADES = {
  elementary: [0, 1, 2, 3, 4, 5],
  middle: [6, 7, 8],
  high: [9, 10, 11, 12],
};

export const gradeLabel = (g) => (g === 0 ? 'K' : String(g));

// Invented, and they have to stay that way: this file's output is printed in a
// tool served from a public domain, and a surname list scraped off a real staff
// directory is a data leak with a pleasant name.
const SURNAMES = [
  'Ashdown', 'Berrycloth', 'Coldwater', 'Dunmore', 'Eastbrook', 'Fernwood',
  'Greenhollow', 'Hartwell', 'Ivywood', 'Jessamine', 'Kirkfell', 'Larkspur',
  'Marchbanks', 'Northgate', 'Oakhurst', 'Pemberton', 'Quillfeather', 'Ravensworth',
  'Stonebridge', 'Thornbury', 'Underhill', 'Voxley', 'Whitlock', 'Yarrowby',
];
const TITLES = ['Ms.', 'Mr.', 'Mx.', 'Dr.'];

// ---------- bounds ----------
//
// Wide enough for a real school and narrow enough that nothing downstream has
// to defend itself. A timetable is saved with the design, so these are also
// what stops a hostile file from being a denial of service.
export const MAX_COHORTS = 120;
export const MAX_TEACHERS = 400;
export const MAX_SECTIONS = 2400;
export const MAX_PERIODS = 12;
export const MAX_COHORT_SIZE = 400;

const clampInt = (v, lo, hi, dflt) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

const text = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : null);

// ---------- the record ----------

export const emptyTimetable = () => ({ cohorts: [], teachers: [], sections: [] });

export const isEmptyTimetable = (tt) =>
  !tt || !Array.isArray(tt.sections) || tt.sections.length === 0;

// Any candidate timetable — a save file, a CSV import, a hostile object — made
// canonical. Same promise `normalizeSchedule` and `normalizeLife` make: never
// throws, never null, and a section that names a cohort the file doesn't
// contain is dropped rather than carried, because every reader downstream joins
// on that id.
export function normalizeTimetable(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const cohorts = [];
  const seenCohort = new Set();
  for (const c of Array.isArray(src.cohorts) ? src.cohorts : []) {
    if (!c || typeof c !== 'object') continue;
    const id = text(c.id, 24);
    if (!id || seenCohort.has(id)) continue;
    seenCohort.add(id);
    cohorts.push({
      id,
      name: text(c.name) || id,
      grade: Number.isFinite(c.grade) ? clampInt(c.grade, 0, 13, 0) : null,
      size: clampInt(c.size, 1, MAX_COHORT_SIZE, 25),
      home: text(c.home, 40),
    });
    if (cohorts.length >= MAX_COHORTS) break;
  }

  const teachers = [];
  const seenTeacher = new Set();
  for (const t of Array.isArray(src.teachers) ? src.teachers : []) {
    if (!t || typeof t !== 'object') continue;
    const id = text(t.id, 24);
    if (!id || seenTeacher.has(id)) continue;
    seenTeacher.add(id);
    teachers.push({
      id,
      name: text(t.name) || id,
      subject: SUBJECT_BY_KEY.has(t.subject) ? t.subject : null,
    });
    if (teachers.length >= MAX_TEACHERS) break;
  }

  const sections = [];
  const seenSection = new Set();
  for (const s of Array.isArray(src.sections) ? src.sections : []) {
    if (!s || typeof s !== 'object') continue;
    const id = text(s.id, 24);
    const cohort = text(s.cohort, 24);
    if (!id || seenSection.has(id) || !cohort || !seenCohort.has(cohort)) continue;
    seenSection.add(id);
    sections.push({
      id,
      period: clampInt(s.period, 1, MAX_PERIODS, 1),
      cohort,
      // A teacher the file doesn't list is no teacher: the whole point of the
      // id is that something can be looked up by it.
      teacher: seenTeacher.has(s.teacher) ? s.teacher : null,
      subject: SUBJECT_BY_KEY.has(s.subject) ? s.subject : null,
      // The binding, both ways round. `room` is the id and wins; `roomName` is
      // what it was bound *by*, kept so a design regenerated from scratch can
      // be rebound to rooms that have the same names and new ids.
      room: text(s.room, 40),
      roomName: text(s.roomName),
    });
    if (sections.length >= MAX_SECTIONS) break;
  }

  const out = { cohorts, teachers, sections };
  if (src.source === 'csv' || src.source === 'generated') out.source = src.source;
  if (text(src.name)) out.name = text(src.name);
  return out;
}

export const periodsOf = (tt) =>
  (isEmptyTimetable(tt) ? 0 : tt.sections.reduce((n, s) => Math.max(n, s.period), 0));

export function timetableSummary(tt) {
  const t = normalizeTimetable(tt);
  const rooms = new Set();
  for (const s of t.sections) if (s.room) rooms.add(s.room);
  return {
    cohorts: t.cohorts.length,
    teachers: t.teachers.length,
    sections: t.sections.length,
    periods: periodsOf(t),
    rooms: rooms.size,
    students: t.cohorts.reduce((n, c) => n + c.size, 0),
    source: t.source || null,
    name: t.name || null,
  };
}

// ---------- the rooms a timetable can use ----------

// The pool a section can be placed in: the teaching spaces the graph found,
// each with the occupant load the report gave it and the use its name reads as.
// Handed the report's own `occupancy` it agrees with the report by
// construction, which is the point — a timetable that thinks a room holds
// thirty while the report says twenty-four is two tools arguing in public.
export function roomPool(nav, opts = {}) {
  if (!nav || !nav.rooms) return [];
  const index = opts.occupancy ? occupancyIndex(opts.occupancy) : null;
  const out = [];
  for (const r of teachingRooms(nav, opts)) {
    const o = (index && index.get(r.id)) || roomOccupancy(r);
    if (opts.teachable !== false && !TEACHABLE.includes(o.use)) continue;
    out.push({
      id: r.id,
      name: r.name || null,
      floor: r.floor,
      area: r.area,
      use: o.use,
      capacity: o.occ,
      x: r.x, z: r.z,
    });
  }
  return out;
}

export const poolIndex = (pool) => new Map((pool || []).map((r) => [r.id, r]));

// How many students a building can actually timetable, which is not the same
// number as how many it is allowed to hold.
//
// `program.js` sizes a school the other way round — enrollment over class size
// over utilisation gives the teaching stations to build — and this is that
// arithmetic run backwards over the rooms somebody has actually drawn. The two
// numbers disagree on purpose and the disagreement is the point: an occupant
// load says how many people may stand in a room, a roll says how many children
// can be given a lesson in one, and a tool that used the first where it meant
// the second timetables the fire code.
export function rollFor(pool, opts = {}) {
  const rooms = (pool || []).length;
  const classSize = clampInt(opts.classSize, 5, 60, 25);
  const utilization = Number.isFinite(opts.utilization) && opts.utilization > 0.1
    ? Math.min(1, opts.utilization) : 0.85;
  return {
    students: Math.max(0, Math.round(rooms * classSize * utilization)),
    rooms,
    classSize,
    utilization,
    rule: `${rooms} teaching rooms × ${classSize} per class × ` +
      `${Math.round(utilization * 100)}% utilization`,
  };
}

// ---------- generating one ----------

const shuffled = (rand, list) => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Cohorts, sized so they add up. A school of 613 in classes of 25 is
// twenty-five cohorts of 24 and one of 13 if you divide badly; spreading the
// remainder one head at a time is the difference between a plausible roll and
// an arithmetic artefact.
function makeCohorts(students, classSize, band) {
  const n = Math.max(1, Math.ceil(students / classSize));
  const grades = BAND_GRADES[band] || BAND_GRADES.middle;
  const base = Math.floor(students / n);
  let extra = students - base * n;
  const out = [];
  const perGrade = new Map();
  for (let i = 0; i < n && out.length < MAX_COHORTS; i++) {
    const grade = grades[i % grades.length];
    const seq = (perGrade.get(grade) || 0) + 1;
    perGrade.set(grade, seq);
    const size = Math.max(1, base + (extra-- > 0 ? 1 : 0));
    out.push({
      id: `c${i + 1}`,
      name: `${gradeLabel(grade)}-${seq}`,
      grade,
      size,
      home: null,
    });
  }
  return out;
}

// Which room this section should stand in. Best fit among the free rooms of
// the kind the subject wants: the smallest room that still holds the class, so
// a cohort of twenty doesn't take the lecture theatre and leave the cohort of
// sixty with a seminar room.
function pickRoom(pool, use, size, taken) {
  let best = null, biggest = null;
  for (const r of pool) {
    if (taken.has(r.id)) continue;
    if (r.use !== use) continue;
    if (!biggest || r.capacity > biggest.capacity) biggest = r;
    if (r.capacity < size) continue;
    if (!best || r.capacity < best.capacity) best = r;
  }
  return best || biggest;
}

// Every room still free this period, regardless of kind — what is left when a
// subject cannot have the room it wanted and the alternative is no lesson.
function anyRoom(pool, size, taken) {
  let best = null, biggest = null;
  for (const r of pool) {
    if (taken.has(r.id)) continue;
    if (!biggest || r.capacity > biggest.capacity) biggest = r;
    if (r.capacity < size) continue;
    if (!best || r.capacity < best.capacity) best = r;
  }
  return best || biggest;
}

// The staff room, sized to demand and then cut to whatever the school can
// actually afford. Peak concurrent demand per subject is the number of
// teachers that subject needs to never clash; `opts.teachers` is the number of
// adults the program says are on the payroll, and when it is the smaller of the
// two the shortfall lands on the sections as `unstaffed` rather than being
// wished away.
function makeTeachers(demand, rand, cap) {
  const need = [...demand.entries()]
    .map(([subject, peak]) => ({ subject, peak }))
    .filter((d) => d.peak > 0)
    .sort((a, b) => b.peak - a.peak || a.subject.localeCompare(b.subject));
  const total = need.reduce((n, d) => n + d.peak, 0);
  const limit = Number.isFinite(cap) && cap > 0 ? Math.min(MAX_TEACHERS, Math.round(cap)) : total;
  let budget = Math.min(total, limit);
  const names = shuffled(rand, SURNAMES);
  const out = [];
  // Largest first, one each, round and round: cutting a staff of thirty to
  // twenty should thin every department rather than delete the smallest one.
  const share = new Map(need.map((d) => [d.subject, 0]));
  let progress = true;
  while (budget > 0 && progress) {
    progress = false;
    for (const d of need) {
      if (budget <= 0) break;
      if (share.get(d.subject) >= d.peak) continue;
      share.set(d.subject, share.get(d.subject) + 1);
      budget--;
      progress = true;
    }
  }
  for (const d of need) {
    for (let i = 0; i < share.get(d.subject); i++) {
      const idx = out.length;
      out.push({
        id: `t${idx + 1}`,
        name: `${TITLES[idx % TITLES.length]} ${names[idx % names.length]}` +
          (idx >= names.length ? ` ${Math.floor(idx / names.length) + 1}` : ''),
        subject: d.subject,
      });
      if (out.length >= MAX_TEACHERS) return out;
    }
  }
  return out;
}

// A whole timetable, packed.
//
// One pass per period, cohorts biggest-first so the class of thirty gets its
// pick of the rooms that hold thirty, and the starting cohort rotated by the
// period so the same group is not first in the queue every time. Within a
// cohort the subject is chosen rather than imposed: it works down the list of
// subjects it has not had yet today and takes the first one whose room kind is
// still free, which is how a real timetable decides that this cohort has PE
// third and that one has it fifth.
export function buildTimetable(pool, opts = {}) {
  const rooms = Array.isArray(pool) ? pool : [];
  const periods = clampInt(opts.periods, 1, MAX_PERIODS, 7);
  const classSize = clampInt(opts.classSize, 5, 60, 25);
  const students = clampInt(opts.students, 1, MAX_COHORTS * MAX_COHORT_SIZE, 600);
  const rand = rng(opts.seed ?? 1);
  const cohorts = makeCohorts(students, classSize, opts.band);
  const sections = [];
  if (!rooms.length || !cohorts.length) {
    return { ...emptyTimetable(), cohorts, source: 'generated' };
  }

  // **A school teaches what it has rooms for.** A building with no gym does
  // not timetable PE into a classroom and then report a mismatch; it does not
  // timetable PE. Without this the packing produces a page of findings about
  // a building whose only fault is being a corridor of classrooms, which is
  // noise standing exactly where the real findings have to be read.
  const kinds = new Set(rooms.map((r) => r.use));
  const taught = SUBJECTS.filter((s) => kinds.has(s.wants));
  const syllabus = taught.length ? taught : SUBJECTS;

  // Each cohort's own rotation through the subjects, so two cohorts of the
  // same grade are not the same child twice.
  const wheel = new Map(cohorts.map((c) => [c.id, shuffled(rand, syllabus)]));
  const left = new Map(cohorts.map((c) => [c.id, wheel.get(c.id).slice()]));
  const bySize = cohorts.slice().sort((a, b) => b.size - a.size);
  const demand = new Map(syllabus.map((s) => [s.key, 0]));

  for (let p = 1; p <= periods; p++) {
    const taken = new Set();
    const thisPeriod = new Map(syllabus.map((s) => [s.key, 0]));
    const order = bySize.slice(p % bySize.length).concat(bySize.slice(0, p % bySize.length));
    for (const cohort of order) {
      let queue = left.get(cohort.id);
      if (!queue.length) { queue = wheel.get(cohort.id).slice(); left.set(cohort.id, queue); }
      // The first subject in the queue whose own kind of room is still free.
      let subject = null;
      const at = queue.findIndex((s) => pickRoom(rooms, s.wants, cohort.size, taken));
      if (at >= 0) {
        subject = queue[at];
        queue.splice(at, 1);
      } else {
        // Nothing it has left today fits a free room of its own kind. A real
        // timetable repeats a subject rather than holding a science lesson in
        // a room with no sink, so this looks past the queue at the whole
        // syllabus before it settles for the wrong kind of room. The repeat is
        // not taken off the queue: the cohort still owes itself that subject.
        subject = syllabus.find((sub) => pickRoom(rooms, sub.wants, cohort.size, taken))
          || queue[0];
        if (subject === queue[0]) queue.splice(0, 1);
      }
      const room = pickRoom(rooms, subject.wants, cohort.size, taken)
        || pickRoom(rooms, FALLBACK_USE, cohort.size, taken)
        || anyRoom(rooms, cohort.size, taken);
      if (room) taken.add(room.id);
      thisPeriod.set(subject.key, thisPeriod.get(subject.key) + 1);
      sections.push({
        id: `s${sections.length + 1}`,
        period: p,
        cohort: cohort.id,
        teacher: null,
        subject: subject.key,
        room: room ? room.id : null,
        roomName: room ? room.name : null,
      });
      if (sections.length >= MAX_SECTIONS) break;
    }
    for (const [key, n] of thisPeriod) demand.set(key, Math.max(demand.get(key), n));
    if (sections.length >= MAX_SECTIONS) break;
  }

  const teachers = makeTeachers(demand, rand, opts.teachers);
  staffSections(sections, teachers, periods);

  // A cohort's homeroom is where its day starts — the room of its first
  // period, which is what index 0 of every timetable in this codebase means.
  const firstOf = new Map();
  for (const s of sections) {
    if (!s.room) continue;
    const prev = firstOf.get(s.cohort);
    if (!prev || s.period < prev.period) firstOf.set(s.cohort, s);
  }
  for (const c of cohorts) {
    const s = firstOf.get(c.id);
    c.home = s ? s.room : null;
  }

  return normalizeTimetable({ cohorts, teachers, sections, source: 'generated' });
}

// Who is standing in front of each section. Written as its own pass rather
// than inside the packing because it is a different scarcity: a room is
// scarce per period and a teacher is scarce per subject, and mixing the two
// loops made both of them harder to read and neither of them better.
function staffSections(sections, teachers, periods) {
  const bySubject = new Map();
  for (const t of teachers) {
    if (!t.subject) continue;
    if (!bySubject.has(t.subject)) bySubject.set(t.subject, []);
    bySubject.get(t.subject).push(t);
  }
  for (let p = 1; p <= periods; p++) {
    const busy = new Set();
    for (const s of sections) {
      if (s.period !== p) continue;
      const pool = bySubject.get(s.subject) || [];
      const free = pool.find((t) => !busy.has(t.id));
      if (!free) continue;
      busy.add(free.id);
      s.teacher = free.id;
    }
  }
}

// ---------- checking one against the building ----------

// What this timetable asks of this building that this building cannot give.
// Recomputed rather than stored, for the same reason nothing else in this
// codebase is baked: a wall moves, a room is renamed, a design is loaded into a
// newer build, and every one of these answers changes without the timetable
// itself having changed at all.
export function timetableIssues(tt, pool) {
  const t = normalizeTimetable(tt);
  const rooms = poolIndex(pool);
  const out = {
    unplaced: [],      // no room at all
    missing: [],       // a room id this building no longer has
    over: [],          // more children than the room's occupant load
    mismatched: [],    // a lab subject in a room that is not a lab
    unstaffed: [],     // nobody to teach it
    roomClash: [],     // two sections in one room in one period
    teacherClash: [],  // one teacher in two places
    cohortClash: [],   // one cohort in two places
  };
  const size = new Map(t.cohorts.map((c) => [c.id, c.size]));
  const seenRoom = new Map(), seenTeacher = new Map(), seenCohort = new Map();
  const staffed = t.teachers.length > 0;

  for (const s of t.sections) {
    const room = s.room ? rooms.get(s.room) : null;
    if (!s.room) out.unplaced.push(s);
    else if (!room && rooms.size) out.missing.push(s);
    if (room) {
      const n = size.get(s.cohort) || 0;
      if (n > room.capacity) out.over.push({ section: s, room, size: n });
      const want = subjectEntry(s.subject);
      if (want && want.wants !== room.use) out.mismatched.push({ section: s, room, want: want.wants });
    }
    if (staffed && !s.teacher) out.unstaffed.push(s);
    const key = (a) => `${s.period}|${a}`;
    if (s.room) {
      const prev = seenRoom.get(key(s.room));
      if (prev) out.roomClash.push({ a: prev, b: s });
      else seenRoom.set(key(s.room), s);
    }
    if (s.teacher) {
      const prev = seenTeacher.get(key(s.teacher));
      if (prev) out.teacherClash.push({ a: prev, b: s });
      else seenTeacher.set(key(s.teacher), s);
    }
    const prevC = seenCohort.get(key(s.cohort));
    if (prevC) out.cohortClash.push({ a: prevC, b: s });
    else seenCohort.set(key(s.cohort), s);
  }
  out.count = out.unplaced.length + out.missing.length + out.over.length
    + out.mismatched.length + out.unstaffed.length
    + out.roomClash.length + out.teacherClash.length + out.cohortClash.length;
  out.ok = out.count === 0;
  return out;
}

// ---------- binding it to the rooms that are actually there ----------

const normName = (s) => String(s ?? '').trim().toLowerCase();

// The trailing number in a room's name. "Room 104" and "104" are the same room
// to everybody except a string comparison, and a schedule exported from a
// school office is full of bare room numbers.
//
// Exported since Phase 31, because signage.js needs the same answer: the
// number a placard puts on a door has to be the number a timetable binds by,
// or the sign on 104 and the schedule for 104 are about different rooms. One
// function, one regex, one rule — see the conventions on two numbers that mean
// the same thing.
export const roomNumber = (s) => {
  const m = /(\d{1,4}[a-z]?)\s*$/i.exec(String(s ?? '').trim());
  return m ? m[1].toLowerCase() : null;
};

// One token from a spreadsheet cell, as a room. **Id first, name second** —
// which is the whole difference Phase 12 makes here: a binding that went by
// name alone breaks the moment somebody renames a room, and one that goes by
// id survives it and can still fall back to the name when the design was
// regenerated from scratch.
export function bindRoom(pool, token, opts = {}) {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  const list = pool || [];
  const byId = list.find((r) => r.id === raw);
  if (byId) return byId;
  // A name is only an answer if it is *the* answer. Two rooms called the same
  // thing used to bind to whichever came first in the array and report
  // success, which is a wrong room reported as a right one — the worst
  // available outcome, and strictly worse than saying "I couldn't tell". The
  // number branch below has always refused ambiguity for exactly this reason;
  // the name branch now refuses it too. (The editor no longer *makes*
  // duplicates — see nextRoomName in shapes.js — but a design drawn before
  // that, or one with deliberately repeated names, still arrives here.)
  const want = normName(raw);
  const named = list.filter((r) => normName(r.name) === want);
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  if (opts.byNumber === false) return null;
  const num = roomNumber(raw);
  if (!num) return null;
  const numbered = list.filter((r) => roomNumber(r.name) === num);
  return numbered.length === 1 ? numbered[0] : null;
}

// Re-point every section at the building as it stands now: keep an id that
// still resolves, otherwise look the room up by the name it was bound by, and
// otherwise leave the section unplaced with its name intact so a later
// rebinding can still find it. Nothing is dropped — a timetable that has lost
// its building is still a timetable, and the report says so.
export function bindTimetable(tt, pool) {
  const t = normalizeTimetable(tt);
  const rooms = poolIndex(pool);
  let bound = 0, lost = 0;
  for (const s of t.sections) {
    if (s.room && rooms.has(s.room)) { bound++; continue; }
    const found = s.roomName ? bindRoom(pool, s.roomName) : null;
    if (found) { s.room = found.id; s.roomName = found.name; bound++; }
    else { s.room = null; lost++; }
  }
  for (const c of t.cohorts) {
    if (c.home && rooms.has(c.home)) continue;
    const first = t.sections
      .filter((s) => s.cohort === c.id && s.room)
      .sort((a, b) => a.period - b.period)[0];
    c.home = first ? first.room : null;
  }
  return { timetable: t, bound, lost };
}

// ---------- the interchange format ----------

// A minimal CSV reader. Quoted fields with commas and doubled quotes inside
// them, which is the whole of what a spreadsheet emits and the whole of what
// `Tools/schedule`'s own importer handles.
export function parseCSV(csv) {
  const rows = [];
  const src = String(csv ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const line of src.split('\n')) {
    if (!line.trim()) continue;
    const row = [];
    let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else field += ch;
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const SIZE_HEADERS = ['size', 'students', 'student count', 'headcount'];
const SKIP_HEADERS = ['color', 'colour', 'day', 'notes', 'note'];

// A timetable out of a spreadsheet. The shape is `Tools/schedule`'s own
// template — a row per group, a `Name`, an optional `Grade` and headcount, and
// then one column per period holding the room that group is in — because that
// is the file a person already has when they come to this tool with a
// timetable and a question about a building.
//
// Everything it could not bind comes back beside the timetable rather than
// being dropped: an import that silently loses four sections is an import that
// answers a question about a school that isn't the one in the file.
export function importTimetableCSV(csv, pool, opts = {}) {
  const rows = parseCSV(csv);
  const empty = { timetable: emptyTimetable(), rooms: 0, unbound: [], periods: 0, rowCount: 0 };
  if (rows.length < 2) return { ...empty, error: 'A timetable needs a header row and at least one group.' };

  const header = rows[0].map((h) => normName(h));
  const nameIdx = header.findIndex((h) => h === 'name' || h === 'group' || h === 'cohort');
  if (nameIdx < 0) return { ...empty, error: 'No "Name" column — the header has to say which group each row is.' };
  const gradeIdx = header.findIndex((h) => h === 'grade' || h === 'year');
  const sizeIdx = header.findIndex((h) => SIZE_HEADERS.includes(h));
  const subjectIdx = header.findIndex((h) => h === 'subject' || h === 'subjects');

  // Every column that isn't one of the fixed ones is a period, in the order it
  // appears — which is how the Tools template lays a day out and the only
  // ordering a spreadsheet ever promises.
  const periodCols = [];
  for (let i = 0; i < header.length; i++) {
    if (i === nameIdx || i === gradeIdx || i === sizeIdx || i === subjectIdx) continue;
    if (SKIP_HEADERS.includes(header[i])) continue;
    periodCols.push({ index: i, label: rows[0][i].trim() || `Period ${periodCols.length + 1}` });
  }
  if (!periodCols.length) return { ...empty, error: 'No period columns — a timetable needs at least one.' };

  const defaultSize = clampInt(opts.classSize, 1, MAX_COHORT_SIZE, 25);
  const cohorts = [], sections = [], unbound = [];
  const usedRooms = new Set();

  for (let r = 1; r < rows.length && cohorts.length < MAX_COHORTS; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] ?? '').trim();
    if (!name) continue;
    const gradeRaw = gradeIdx >= 0 ? parseInt(String(row[gradeIdx] ?? '').trim(), 10) : NaN;
    const sizeRaw = sizeIdx >= 0 ? parseInt(String(row[sizeIdx] ?? '').trim(), 10) : NaN;
    const subject = subjectIdx >= 0 ? normName(row[subjectIdx]) : null;
    const cohort = {
      id: `c${cohorts.length + 1}`,
      name: name.slice(0, 60),
      grade: Number.isFinite(gradeRaw) ? clampInt(gradeRaw, 0, 13, 0) : null,
      size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.min(sizeRaw, MAX_COHORT_SIZE) : defaultSize,
      home: null,
    };
    cohorts.push(cohort);
    periodCols.forEach((col, p) => {
      const token = String(row[col.index] ?? '').trim();
      // A blank cell is a period this group does not travel to — a free
      // period, lunch off site, a half day. Not an error, and not a section.
      if (!token) return;
      const room = bindRoom(pool, token);
      if (!room) unbound.push({ row: r + 1, cohort: cohort.name, period: p + 1, token });
      else usedRooms.add(room.id);
      sections.push({
        id: `s${sections.length + 1}`,
        period: p + 1,
        cohort: cohort.id,
        teacher: null,
        subject: SUBJECT_BY_KEY.has(subject) ? subject : null,
        room: room ? room.id : null,
        roomName: room ? room.name : token,
      });
    });
  }

  const timetable = normalizeTimetable({ cohorts, sections, teachers: [], source: 'csv', name: opts.name });
  const bound = bindTimetable(timetable, pool);
  return {
    timetable: bound.timetable,
    rooms: usedRooms.size,
    unbound,
    periods: periodCols.length,
    periodLabels: periodCols.map((c) => c.label),
    rowCount: cohorts.length,
    error: null,
  };
}

// ...and back out again, in the shape it came in. A room is written by the
// name a person would recognise, falling back to its id for a room nobody has
// named — which is the one case where the id is also the only name it has.
export function timetableCSV(tt, pool, opts = {}) {
  const t = normalizeTimetable(tt);
  const rooms = poolIndex(pool);
  const n = Math.max(1, periodsOf(t));
  const labels = opts.labels && opts.labels.length === n
    ? opts.labels
    : Array.from({ length: n }, (_, i) => `Period ${i + 1}`);
  const out = [['Name', 'Grade', 'Students', ...labels]];
  const byCohort = new Map(t.cohorts.map((c) => [c.id, new Map()]));
  for (const s of t.sections) {
    const slot = byCohort.get(s.cohort);
    if (slot) slot.set(s.period, s);
  }
  for (const c of t.cohorts) {
    const slot = byCohort.get(c.id) || new Map();
    const cells = [];
    for (let p = 1; p <= n; p++) {
      const s = slot.get(p);
      if (!s) { cells.push(''); continue; }
      const room = s.room ? rooms.get(s.room) : null;
      cells.push((room && room.name) || s.roomName || s.room || '');
    }
    out.push([c.name, c.grade === null ? '' : gradeLabel(c.grade), c.size, ...cells]);
  }
  return csvRows(out);
}

// ---------- what the crowd needs from it ----------

// A timetable, as the two lists `makePopulation` builds people out of: a room
// per period for each cohort and each teacher, index 0 being homeroom exactly
// as `makeTimetable` has meant it since Phase 6.
//
// Handed over as plain data rather than as this module, so agents.js never has
// to import a timetable to have one — the same split that keeps the crowd
// ignorant of the generator.
export function timetablePlan(tt, sched) {
  const t = normalizeTimetable(tt);
  const s = normalizeSchedule(sched);
  const periods = Math.min(s.periods, MAX_PERIODS);
  const slot = (rooms, p, room) => { if (p >= 1 && p <= periods) rooms[p] = room; };

  const cohorts = t.cohorts.map((c) => ({
    id: c.id, name: c.name, grade: c.grade, size: c.size,
    rooms: new Array(periods + 1).fill(null),
    home: c.home || null,
  }));
  const byCohort = new Map(cohorts.map((c) => [c.id, c]));
  const teachers = t.teachers.map((row) => ({
    id: row.id, name: row.name, subject: row.subject,
    rooms: new Array(periods + 1).fill(null),
    home: null,
  }));
  const byTeacher = new Map(teachers.map((row) => [row.id, row]));

  for (const sec of t.sections) {
    if (!sec.room) continue;
    const c = byCohort.get(sec.cohort);
    if (c) slot(c.rooms, sec.period, sec.room);
    const teacher = sec.teacher ? byTeacher.get(sec.teacher) : null;
    if (teacher) slot(teacher.rooms, sec.period, sec.room);
  }
  // Homeroom, and the gaps. A free period is spent where you were, not
  // nowhere: an agent with a null goal stands still in a corridor, which is
  // the one thing a real school never looks like.
  for (const list of [cohorts, teachers]) {
    for (const person of list) {
      const first = person.rooms.slice(1).find((r) => r);
      person.home = person.home || first || null;
      person.rooms[0] = person.home;
      let last = person.home;
      for (let p = 1; p <= periods; p++) {
        if (person.rooms[p]) last = person.rooms[p];
        else person.rooms[p] = last;
      }
    }
  }
  return { cohorts, teachers, periods };
}
