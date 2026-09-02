// csv.js — the interchange format, read and written.
//
// Five modules used to carry their own copy of `csvCell` and `csvRows` (the
// takeoff, the rate table, the estimate, the phasing plan and the
// specification each wrote a spreadsheet, and each had pasted the same four
// lines to do it), and the reader lived in timetable.js because the timetable
// was the first thing anybody imported. That put the CSV rule in six places —
// and, worse, it put timetable.js on the road to takeoff.js and takeoff.js on
// the road to blueprint.js, so a module that wanted a room number dragged the
// printable sheet into the boot of the tool (Phase 42's finding; the
// conventions' "a rule two readers share belongs to neither").
//
// Pure module: no DOM, no three.js. Exercised by test/csv.test.mjs.

// One cell, quoted only when it has to be: a comma, a quote or a newline in
// the text, which is the whole of what a spreadsheet needs to see quoted.
export const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Rows to a file. CRLF, because that is what every spreadsheet writes and the
// one thing they all read back without asking.
export const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// A minimal CSV reader. Quoted fields with commas and doubled quotes inside
// them, which is the whole of what a spreadsheet emits and the whole of what
// `Tools/schedule`'s own importer handles. Blank lines are skipped; a row is
// an array of strings, untrimmed, so a caller decides what a space means.
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
