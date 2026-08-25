// schedule.js — the bell schedule, and the clock that answers to it.
//
// A school is not a building with people in it; it is a building with people
// in it *at particular times*. Everything the crowd does — where it is, how
// fast it is moving, whether the corridors are empty or impassable — comes off
// one small table of minutes, and this module is that table plus the two
// questions anyone asks of it: **what is happening now**, and **when does the
// next bell go**.
//
// It is pure arithmetic over a plain record, so it tests headless and can be
// read by anything: the crowd, the panel that draws a clock, and Phase 3's sun,
// which the school day now drives rather than the other way round.
//
// The day is described rather than enumerated: a start time, a period length,
// a passing time, a period count and where lunch falls. `blocks()` turns those
// five numbers into the run of blocks the day actually is, back to back with
// no gaps, and everything else reads that. Nobody edits a list of periods,
// which is what keeps an eight-period day one number away from a seven.

const MIN_PER_DAY = 24 * 60;

export const DEFAULT_SCHEDULE = {
  start: 8 * 60,      // first bell, minutes since midnight
  periods: 7,
  periodMin: 47,
  passingMin: 5,
  lunchAfter: 4,      // lunch follows this period (0 = no lunch block)
  lunchMin: 30,
  homeroomMin: 12,    // before first period, after the arrival bell
};

// Bounds wide enough for a real timetable and narrow enough that nothing
// downstream has to defend itself: a period is between five minutes and three
// hours, a day is between one period and twelve.
const LIMITS = {
  start: [0, MIN_PER_DAY - 60],
  periods: [1, 12],
  periodMin: [5, 180],
  passingMin: [0, 30],
  lunchAfter: [0, 12],
  lunchMin: [0, 90],
  homeroomMin: [0, 60],
};

const clampInt = (v, [lo, hi], dflt) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

// Any candidate schedule — a save file, a slider, a hostile object — made
// canonical. Same promise `normalizeEnv` makes: never throws, never null. A
// design cannot fail to have a school day.
export function normalizeSchedule(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_SCHEDULE)) {
    out[k] = clampInt(src[k], LIMITS[k], DEFAULT_SCHEDULE[k]);
  }
  // Lunch after a period that doesn't exist is lunch at the end of the day,
  // which is dismissal. Clamp it into the day rather than dropping it.
  out.lunchAfter = Math.min(out.lunchAfter, out.periods);
  return out;
}

export const defaultSchedule = () => ({ ...DEFAULT_SCHEDULE });

// True when a schedule is the default in every field — which is what lets the
// save layer leave it out of the file entirely, the same trick `env`, `roof`
// and a plain doorway already play.
export const isDefaultSchedule = (sched) => {
  const s = normalizeSchedule(sched);
  return Object.keys(DEFAULT_SCHEDULE).every((k) => s[k] === DEFAULT_SCHEDULE[k]);
};

// ---------- the day, as blocks ----------

export const BLOCK_KINDS = ['before', 'homeroom', 'passing', 'class', 'lunch', 'after'];

// Every block of the school day, back to back, from the arrival bell to
// dismissal. `index` counts class periods only — a passing period belongs to
// the period it leads into, which is what makes "where should I be during
// passing" answerable without looking either side of it.
export function blocks(sched) {
  const s = normalizeSchedule(sched);
  const out = [];
  let at = s.start;
  const push = (kind, min, index, label) => {
    if (min <= 0) return;
    out.push({ kind, index, start: at, end: at + min, label });
    at += min;
  };

  push('homeroom', s.homeroomMin, 0, 'Homeroom');
  for (let p = 1; p <= s.periods; p++) {
    if (p > 1 || s.homeroomMin > 0) push('passing', s.passingMin, p, `Passing to ${p}`);
    push('class', s.periodMin, p, `Period ${p}`);
    if (s.lunchAfter && p === s.lunchAfter) {
      push('passing', s.passingMin, p, 'Passing to lunch');
      push('lunch', s.lunchMin, p, 'Lunch');
    }
  }
  return out;
}

export const dayStart = (sched) => normalizeSchedule(sched).start;

export function dayEnd(sched) {
  const b = blocks(sched);
  return b.length ? b[b.length - 1].end : dayStart(sched);
}

// What is happening at a minute of the day. Before the first bell and after
// the last one are blocks too — an empty building at seven in the morning is a
// state the crowd has to have an answer for, not a gap in the table.
export function blockAt(sched, minutes) {
  const s = normalizeSchedule(sched);
  const m = wrapMinutes(minutes);
  const list = blocks(s);
  const end = list.length ? list[list.length - 1].end : s.start;
  if (!list.length || m < s.start) {
    return { kind: 'before', index: 0, start: 0, end: s.start, label: 'Before school' };
  }
  for (const b of list) if (m < b.end) return b;
  return { kind: 'after', index: s.periods, start: end, end: MIN_PER_DAY, label: 'After school' };
}

export const wrapMinutes = (m) => {
  const n = typeof m === 'number' && Number.isFinite(m) ? m : 0;
  return ((Math.round(n) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
};

// Is the building supposed to have anyone in it? Everything the crowd does at
// other times ("go home") reads this rather than testing three kinds.
export const inSession = (sched, minutes) => {
  const k = blockAt(sched, minutes).kind;
  return k !== 'before' && k !== 'after';
};

// ---------- bells ----------

export const BELL_KINDS = ['arrival', 'period', 'lunch', 'dismissal'];

// Every bell in the day, in order. A bell rings at the *start* of a block that
// people have to be somewhere for — the end of a period is the start of the
// passing time, and that is the bell everyone means when they say "the bell".
export function bells(sched) {
  const s = normalizeSchedule(sched);
  const list = blocks(s);
  const out = [];
  if (list.length) out.push({ at: list[0].start, kind: 'arrival', label: 'First bell' });
  for (const b of list) {
    if (b.kind === 'passing') out.push({ at: b.start, kind: 'period', label: b.label });
    else if (b.kind === 'lunch') out.push({ at: b.start, kind: 'lunch', label: 'Lunch' });
  }
  const end = list.length ? list[list.length - 1].end : s.start;
  out.push({ at: end, kind: 'dismissal', label: 'Dismissal' });
  // A day with no passing time can ring two bells on the same minute; one is
  // enough, and the first one to claim the minute is the one that means more.
  const seen = new Set();
  return out.filter((b) => (seen.has(b.at) ? false : (seen.add(b.at), true)));
}

// The bells crossed by advancing the clock from `from` to `to`. The half-open
// interval `(from, to]` is deliberate: a clock that lands exactly on a bell
// rings it once, on the tick that arrives, and never again.
//
// A wrapped interval (a clock run past midnight) is handled as two, because a
// simulation left running overnight should still ring the morning bell rather
// than silently skipping a day.
export function bellsBetween(sched, from, to) {
  const list = bells(sched);
  const a = wrapMinutes(from), b = wrapMinutes(to);
  const hit = (lo, hi) => list.filter((x) => x.at > lo && x.at <= hi);
  if (b >= a) return hit(a, b);
  return [...hit(a, MIN_PER_DAY), ...hit(-1, b)];
}

export function nextBell(sched, minutes) {
  const m = wrapMinutes(minutes);
  const list = bells(sched);
  for (const b of list) if (b.at > m) return { ...b, in: b.at - m };
  const first = list[0];
  return first ? { ...first, in: MIN_PER_DAY - m + first.at } : null;
}

// ---------- timetables ----------

// One person's day, as a room per period. Index 0 is homeroom; index p is
// period p, so `timetable[block.index]` answers "where should you be" for
// every class block without arithmetic at the call site.
//
// `rand` is passed in rather than made here: a population has to be
// reproducible from a seed, and a module that reaches for `Math.random` can't
// promise that. Same reason `roomAcoustics` takes a catalog lookup.
export function makeTimetable(rand, roomIds, sched, opts = {}) {
  const s = normalizeSchedule(sched);
  const n = s.periods;
  const out = new Array(n + 1).fill(null);
  if (!roomIds || !roomIds.length) return out;
  const home = opts.home || roomIds[Math.floor(rand() * roomIds.length)];
  out[0] = home;
  // A student's day is a walk around the building, so consecutive periods
  // deliberately avoid landing in the same room twice: a timetable that keeps
  // you where you are makes a passing period with nobody in the corridor.
  let prev = home;
  for (let p = 1; p <= n; p++) {
    let pick = prev;
    for (let tries = 0; tries < 6 && pick === prev; tries++) {
      pick = roomIds[Math.floor(rand() * roomIds.length)];
    }
    out[p] = pick;
    prev = pick;
  }
  return out;
}

// A teacher stays put: the room is theirs, and the crowd that changes around
// them is the whole of what a passing period looks like from inside a
// classroom.
export function fixedTimetable(roomId, sched) {
  const s = normalizeSchedule(sched);
  return new Array(s.periods + 1).fill(roomId);
}

// ---------- describing it ----------

const pad = (n) => String(n).padStart(2, '0');

// A clock face. Same 12-hour form `sky.js`'s `formatClock` uses, kept here so
// this module has no reason to import the sun.
export function clockText(minutes) {
  const m = wrapMinutes(minutes);
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mm)} ${ampm}`;
}

export function countdownText(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 1) return 'any second';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

// One line about the school day, for a panel: what block it is and how long is
// left of it.
export function scheduleText(sched, minutes) {
  const b = blockAt(sched, minutes);
  const left = Math.max(0, b.end - wrapMinutes(minutes));
  if (b.kind === 'before') return `Before school · first bell ${clockText(dayStart(sched))}`;
  if (b.kind === 'after') return 'After school · the building is empty';
  return `${b.label} · ${countdownText(left)} left`;
}
