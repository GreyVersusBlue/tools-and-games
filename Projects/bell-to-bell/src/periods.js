// The school day, read out of data/periods.json.
//
// Phase 1. This used to be `periodFor()` in main.js with two hardcoded branches
// and a fallthrough, which was honest when there were exactly two classes and
// stops being honest at three. A period is now a row in data/periods.json:
// literal presentation fields, and pointers at the content files that hold the
// roster, the tell schedule and the lesson. Adding a period is that row plus a
// content file. It is not a JavaScript edit, and if it ever becomes one again
// the seam has moved to the wrong place.
//
// Three-free and DOM-free on purpose, so the Node suites can read the whole day.
//
// Phase 2. A row can also say `"generate": true` and carry no roster or
// schedule pointer at all: then its twelve kids and their tell schedule come
// out of src/systems/generate.js, from one integer seed the caller supplies,
// plus the day so the same class does different things on Tuesday. The lesson
// is still a pointer, because the lesson is still authored.
import { generateClass } from './systems/generate.js';
import { subjectFor, weightedMix } from './systems/subject.js';
import { SEED_MAX } from './systems/rng.js';

// The row fields that are pointers rather than literals. src/loader.js reads
// this to work out which content files a day actually needs.
export const CONTENT_FIELDS = ['seatGrid', 'roster', 'schedule', 'lesson', 'seatingCopy'];

// Phase 5: `subject` is a row field too, but it names an id in
// data/subjects.json rather than a path into a content file, so it is not one
// of the pointers above and src/loader.js fetches it its own way.

// "period5.lesson" -> data.period5.lesson. A bare "lesson" is the whole file.
export function deref(data, pointer) {
  return pointer.split('.').reduce((v, key) => (v == null ? v : v[key]), data);
}

// The first segment of a pointer is the data file it lives in.
export const fileOf = pointer => pointer.split('.')[0];

export const periodRows = data => data.periods.periods;

export const periodIds = data => periodRows(data).map(r => r.id);

export const firstPeriodId = data => periodRows(data)[0].id;

export const rowFor = (id, data) => periodRows(data).find(r => r.id === id) || null;

// A `period` key written by an older build, or by a data file that has since
// dropped a row, must not strand the player on a period that no longer exists.
export const resolvePeriodId = (id, data) =>
  (rowFor(id, data) ? id : firstPeriodId(data));

export const isGenerated = row => !!row?.generate;

// Seed format 2 (#893): the three authored classes, reachable by number.
//
// A seed the generator draws from is 1..SEED_MAX and that is format 1; nothing
// below changes what one of those means. data/periods.json's `classSeeds`
// table names a handful of seeds above that range, and each is an authored
// roster and schedule read as they are. It is a lookup, not a draw: no integer
// fed to systems/roster.js comes out as Dorian, because Dorian is not in the
// pool. An entry at or under SEED_MAX is ignored here rather than trusted, so
// a bad row in the table cannot change a class somebody already has.
export const classSeeds = data =>
  (data.periods.classSeeds?.classes || []).filter(c => Number.isInteger(c.seed) && c.seed > SEED_MAX);

export const classSeedFor = (data, seed) => classSeeds(data).find(c => c.seed === seed) || null;

// What main.js will keep in a slot and take from the start screen: a drawable
// seed or one the table names. Anything else is redrawn or put back.
export const isSeed = (data, seed) =>
  Number.isInteger(seed) && ((seed > 0 && seed <= SEED_MAX) || !!classSeedFor(data, seed));

// Everything the table promises. Empty means it keeps every promise.
export function classSeedProblems(data) {
  const out = [];
  const cs = data.periods.classSeeds;
  if (!cs) return out;
  if (cs.format !== 2) out.push(`classSeeds is format ${cs.format}, not 2`);
  const seen = new Set();
  for (const c of cs.classes || []) {
    if (!Number.isInteger(c.seed) || c.seed <= SEED_MAX) {
      out.push(`class seed ${c.seed} is a seed the generator can draw`); continue;
    }
    if (seen.has(c.seed)) out.push(`class seed ${c.seed} is in the table twice`);
    seen.add(c.seed);
    if (!rowFor(c.of, data)) out.push(`class seed ${c.seed} is of "${c.of}", which is not a period`);
    const roster = c.roster ? deref(data, c.roster) : null;
    const schedule = c.schedule ? deref(data, c.schedule) : null;
    if (!Array.isArray(roster) || !roster.length) { out.push(`class seed ${c.seed} points at no roster`); continue; }
    if (!Array.isArray(schedule) || !schedule.length) { out.push(`class seed ${c.seed} points at no schedule`); continue; }
    for (const r of schedule) {
      for (const i of [r.seat, r.with]) {
        if (i != null && !(Number.isInteger(i) && i >= 0 && i < roster.length)) {
          out.push(`class seed ${c.seed}: ${r.type} at ${r.atMinute} names no real seat`);
        }
      }
    }
  }
  return out;
}

// The seed's copy deck for the report and the start screen. A drawn class
// says nobody authored it; a class seed says whose twelve these are.
export function seedCopyFor(period, data) {
  const copy = data.periods.copy.seed;
  const of = period.generated?.authored ? rowFor(period.generated.authored, data) : null;
  if (!of) return copy;
  return { ...copy, report: copy.reportAuthored.replace('{ordinal}', of.ordinal) };
}

export function periodFor(id, data, opts = {}) {
  const row = rowFor(id, data);
  if (!row) throw new Error(`No period "${id}" in data/periods.json`);

  // The lesson's shared furniture — the toast copy and the objective on the
  // wall — belongs to the day, not to one class. A period's own lesson file
  // overrides unit, beats and filler on top of it.
  const lessonData = { ...data.lesson, ...deref(data, row.lesson) };
  const seatGrid = deref(data, row.seatGrid);

  // Phase 5: what this room teaches. A row names a subject or takes the
  // manifest's default; the subject is content all the way down, and the only
  // thing it reaches from in here is which tells are common.
  const subject = subjectFor(data, row);

  let roster, schedule, generated = null;
  if (isGenerated(row)) {
    if (!Number.isInteger(opts.seed) || opts.seed <= 0) {
      throw new Error(`Period "${id}" is generated and needs a seed`);
    }
    const day = Number.isInteger(opts.day) ? opts.day : 0;
    const named = classSeedFor(data, opts.seed);
    if (named) {
      // An authored class by number: the same twelve and the same schedule on
      // every day, never drawn and never held to the bands.
      roster = deref(data, named.roster);
      schedule = deref(data, named.schedule);
      generated = { seed: named.seed, day, rerolls: 0, results: null, authored: named.of };
    } else {
      // The subject leans on the mix weights rather than the promises: a
      // COPYING-heavy room still gets its minimum WHISPER, because that
      // minimum is a promise the schedule made to the seating chart.
      const genData = {
        ...data.generation,
        schedule: { ...data.generation.schedule, mix: weightedMix(data.generation.schedule.mix, subject) }
      };
      const cls = generateClass({ seed: opts.seed, day, data: { ...data, generation: genData }, lessonData, seatGrid });
      roster = cls.roster;
      schedule = cls.schedule;
      generated = { seed: cls.seed, day, rerolls: cls.rerolls, results: cls.results };
    }
  } else {
    roster = deref(data, row.roster);
    schedule = deref(data, row.schedule);
  }

  // Same deal for the chart screen: one base copy deck, per-period overrides.
  const sc = deref(data, row.seatingCopy);
  const seatingCopy = {
    ...data.seating, ...sc,
    buttons: { ...data.seating.buttons, ...(sc.buttons || {}) }
  };

  const nextRow = row.next ? rowFor(row.next, data) : null;
  const copy = data.periods.copy;

  return {
    id: row.id,
    periodLabel: row.label,
    periodTag: row.tag,
    ordinal: row.ordinal,
    short: row.short,
    seatGrid,
    roster,
    schedule,
    generated,
    subject,
    lessonData,
    seatingCopy,
    nextPeriodId: nextRow ? nextRow.id : null,
    // What the button at the bottom of the report says. Data, so a seventh
    // period does not need a string literal in main.js either.
    nextLabel: nextRow ? copy.next.replace('{short}', nextRow.short) : null,
    restartLabel: copy.restart
  };
}
