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

// The row fields that are pointers rather than literals. src/loader.js reads
// this to work out which content files a day actually needs.
export const CONTENT_FIELDS = ['seatGrid', 'roster', 'schedule', 'lesson', 'seatingCopy'];

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

export function periodFor(id, data) {
  const row = rowFor(id, data);
  if (!row) throw new Error(`No period "${id}" in data/periods.json`);

  // The lesson's shared furniture — the toast copy and the objective on the
  // wall — belongs to the day, not to one class. A period's own lesson file
  // overrides unit, beats and filler on top of it.
  const lessonData = { ...data.lesson, ...deref(data, row.lesson) };

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
    seatGrid: deref(data, row.seatGrid),
    roster: deref(data, row.roster),
    schedule: deref(data, row.schedule),
    lessonData,
    seatingCopy,
    nextPeriodId: nextRow ? nextRow.id : null,
    // What the button at the bottom of the report says. Data, so a seventh
    // period does not need a string literal in main.js either.
    nextLabel: nextRow ? copy.next.replace('{short}', nextRow.short) : null,
    restartLabel: copy.restart
  };
}
