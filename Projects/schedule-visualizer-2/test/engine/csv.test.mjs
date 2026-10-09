// engine/csv.js: parse and write. Run on its own: node test/engine/csv.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse, write } from "../../engine/csv.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "csv");
const read = (name) => readFileSync(path.join(FIXTURES, name), "utf8");

const kinds = (result) => result.warnings.map((w) => w.kind);

// What each fixture file must parse to, and what its bytes must hold for the
// file to be the case its name says. `bytes` is checked first: a checkout that
// rewrote a line ending would otherwise leave the case passing while testing
// nothing.
const EXPECTED = {
  "bom.csv": {
    bytes: (t) => t.startsWith("﻿"),
    rows: [
      ["Group", "Grade", "Head count"],
      ["7-1", "7", "24"],
      ["7-2", "7", "26"],
    ],
  },
  "crlf.csv": {
    bytes: (t) => t.includes("\r\n") && !/[^\r]\n/.test(t) && !/\r[^\n]/.test(t) && t.endsWith("\r\n"),
    rows: [
      ["Group", "Period 1", "Period 2"],
      ["7-1", "204", "118"],
      ["7-2", "118", "204"],
    ],
  },
  "cr-only.csv": {
    bytes: (t) => t.includes("\r") && !t.includes("\n"),
    rows: [
      ["Group", "Period 1", "Period 2"],
      ["7-1", "204", "118"],
      ["7-2", "118", "204"],
    ],
  },
  "lf-no-final-newline.csv": {
    bytes: (t) => t.includes("\n") && !t.includes("\r") && !t.endsWith("\n"),
    rows: [
      ["Group", "Period 1", "Period 2"],
      ["7-1", "204", "118"],
      ["7-2", "118", "204"],
    ],
  },
  "embedded-newlines.csv": {
    bytes: (t) => t.includes('"Meets in 204\nthen') && t.includes("one\r\nLine two\rLine"),
    rows: [
      ["Group", "Note"],
      ["7-1", "Meets in 204\nthen walks to the gym"],
      ["7-2", "Line one\r\nLine two\rLine three"],
      ["8-1", "plain"],
    ],
  },
  "quotes-and-commas.csv": {
    bytes: (t) => t.includes('""Bee""') && t.includes('" padded "'),
    rows: [
      ["Teacher", "Room"],
      ['Ms. "Bee" Okonjo-Vale', "Lab, north wing"],
      ['"Quoted from the start"', ""],
      [" padded ", " tail "],
    ],
  },
  "non-latin.csv": {
    bytes: (t) => /[^\u0000-ɏ]/.test(t),
    rows: [
      ["Group", "Grade"],
      ["七年级一班", "7"],
      ["Седьмой А", "7"],
      ["الصف السابع ب", "7"],
      ["7-β Ωmega", "7"],
      ["कक्षा सात", "7"],
    ],
  },
  "angle-brackets.csv": {
    bytes: (t) => t.includes("<script>") && t.includes('""Owls""'),
    rows: [
      ["Group", "Note"],
      ['<b>7-1</b> the "Owls"', "<script>alert(1)</script>"],
      ['Tam & "Jory" <tj>', "</td><td>"],
      ["'single' <i>7-3</i>", "&lt;kept&gt;"],
    ],
  },
  "formula-cells.csv": {
    bytes: (t) => t.includes("\n=SUM") && t.includes("\n\t"),
    rows: [
      ["Group", "Note"],
      ["=SUM(A1:A2)", "+1"],
      ["-5", "@home"],
      ["=A1&B1", "'=already quoted"],
      ["\tstarts with a tab", "ends plain"],
    ],
  },
  "ragged.csv": {
    bytes: () => true,
    rows: [
      ["Group", "Period 1", "Period 2"],
      ["7-1", "204"],
      ["7-2", "118", "204", "extra"],
      ["7-3", "101", "102"],
    ],
    warnings: ["ragged", "ragged"],
  },
  "blank-lines.csv": {
    bytes: (t) => t.includes("\n\n") && t.includes("\r\n\r\n") && t.endsWith("\n\n\n"),
    rows: [["Group", "Grade"], ["7-1", "7"], [""], ["7-2", "7"]],
    warnings: ["ragged"],
  },
};

const fixtureFiles = readdirSync(FIXTURES).filter((name) => name.endsWith(".csv")).sort();

test("every fixture file has an expectation, and every expectation a file", () => {
  assert.deepEqual(fixtureFiles, Object.keys(EXPECTED).sort());
});

for (const [name, expected] of Object.entries(EXPECTED)) {
  test(`fixture ${name}: the file still holds the bytes its name promises`, () => {
    assert.equal(expected.bytes(read(name)), true);
  });

  test(`fixture ${name}: parses to the expected rows and warnings`, () => {
    const result = parse(read(name));
    assert.deepEqual(result.rows, expected.rows);
    assert.deepEqual(kinds(result), expected.warnings ?? []);
  });

  for (const eol of ["\r\n", "\n", "\r"]) {
    test(`fixture ${name}: parse(write(rows)) gives the same rows back, eol ${JSON.stringify(eol)}`, () => {
      const { rows } = parse(read(name));
      const again = parse(write(rows, { eol }));
      assert.deepEqual(again.rows, rows);
    });
  }
}

// ---- parse ----

test("parse: plain cells split on commas", () => {
  assert.deepEqual(parse("a,b,c\n1,2,3\n"), { rows: [["a", "b", "c"], ["1", "2", "3"]], warnings: [] });
});

test("parse: an empty text is no rows", () => {
  assert.deepEqual(parse(""), { rows: [], warnings: [] });
});

test("parse: a byte-order mark alone is no rows", () => {
  assert.deepEqual(parse("﻿"), { rows: [], warnings: [] });
});

test("parse: the byte-order mark is dropped from the first cell", () => {
  assert.equal(parse("﻿Group,Grade\n").rows[0][0], "Group");
});

test("parse: only the first U+FEFF is a byte-order mark; one inside the text is kept", () => {
  assert.deepEqual(parse("﻿﻿a,b﻿\n").rows, [["﻿a", "b﻿"]]);
});

test("parse: a byte-order mark before a quoted first cell still opens the quotes", () => {
  assert.deepEqual(parse('﻿"a,b",c\n').rows, [["a,b", "c"]]);
});

test("parse: a trailing newline and none give the same rows", () => {
  const withNewline = parse("a,b\n1,2\n");
  const without = parse("a,b\n1,2");
  assert.deepEqual(withNewline, without);
  assert.equal(withNewline.rows.length, 2);
});

test("parse: CRLF, LF and CR in one text each end a row", () => {
  assert.deepEqual(parse("a,b\r\nc,d\ne,f\rg,h").rows, [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
});

// The rows cannot tell CRLF read once from CRLF read as CR then LF, because
// the blank line between them would be skipped. The line number can.
test("parse: CRLF is one line ending, so a warning's line counts each CRLF once", () => {
  const result = parse("a,b\r\n1,2\r\n3\r\n");
  assert.deepEqual(result.warnings.map((w) => [w.kind, w.row, w.line]), [["ragged", 3, 3]]);
});

test("parse: a doubled quote inside quotes is one quote", () => {
  assert.deepEqual(parse('"say ""hi""",x\n').rows, [['say "hi"', "x"]]);
});

test("parse: a comma inside quotes does not split the cell", () => {
  assert.deepEqual(parse('"Lab, north",204\n').rows, [["Lab, north", "204"]]);
});

test("parse: line breaks inside quotes stay in the cell exactly as typed", () => {
  assert.deepEqual(parse('"a\nb","c\r\nd","e\rf"\n').rows, [["a\nb", "c\r\nd", "e\rf"]]);
});

test("parse: empty cells are kept, at the start, the middle and the end of a row", () => {
  assert.deepEqual(parse(",a,,b,\n").rows, [["", "a", "", "b", ""]]);
});

test('parse: "" is an empty cell, and alone on a line it is a row of one empty cell', () => {
  assert.deepEqual(parse('a\n""\nb\n').rows, [["a"], [""], ["b"]]);
});

test("parse: a line with nothing on it is skipped without a warning", () => {
  assert.deepEqual(parse("a,b\n\n\r\n1,2\n\n"), { rows: [["a", "b"], ["1", "2"]], warnings: [] });
});

test("parse: spaces around a cell are kept", () => {
  assert.deepEqual(parse(" a , b \n").rows, [[" a ", " b "]]);
});

test("parse: a cell starting with =, +, - or @ comes back as typed", () => {
  const result = parse("=1+1,+2,-3,@x\n");
  assert.deepEqual(result.rows, [["=1+1", "+2", "-3", "@x"]]);
  assert.deepEqual(result.warnings, []);
});

test("parse: every cell is a string; nothing becomes a number or a boolean", () => {
  for (const cell of parse("007,1e3,true,null,2026-09-01\n").rows[0]) assert.equal(typeof cell, "string");
  assert.deepEqual(parse("007,1e3,true,null,2026-09-01\n").rows[0], ["007", "1e3", "true", "null", "2026-09-01"]);
});

test("parse: markup in a cell is returned as typed", () => {
  assert.deepEqual(parse("<b>7-1</b>,&amp;\n").rows, [["<b>7-1</b>", "&amp;"]]);
});

test("parse: a ragged row is kept and warned, with its row and line", () => {
  const result = parse("a,b,c\n1,2\n\n1,2,3\n1,2,3,4\n");
  assert.deepEqual(result.rows, [["a", "b", "c"], ["1", "2"], ["1", "2", "3"], ["1", "2", "3", "4"]]);
  assert.deepEqual(result.warnings, [
    { kind: "ragged", row: 2, line: 2, message: "Row 2 has 2 cells; the first row has 3 cells. The row was kept as it is." },
    { kind: "ragged", row: 4, line: 5, message: "Row 4 has 4 cells; the first row has 3 cells. The row was kept as it is." },
  ]);
});

test("parse: a warning's line counts line breaks inside quoted cells", () => {
  const result = parse('a,b\n"x\ny\r\nz",2\n3\n');
  assert.deepEqual(result.warnings.map((w) => [w.kind, w.row, w.line]), [["ragged", 3, 5]]);
  assert.match(result.warnings[0].message, /^Row 3 has 1 cell; /);
});

test("parse: a quote in the middle of an unquoted cell is kept and warned once for the row", () => {
  const result = parse('a,5" pipe, 6" pipe\n');
  assert.deepEqual(result.rows, [["a", '5" pipe', ' 6" pipe']]);
  assert.deepEqual(kinds(result), ["stray-quote"]);
  assert.equal(result.warnings[0].row, 1);
});

test("parse: text after a closing quote is kept and warned", () => {
  const result = parse('"a"b,c\n');
  assert.deepEqual(result.rows, [["ab", "c"]]);
  assert.deepEqual(kinds(result), ["stray-quote"]);
});

test("parse: a quoted cell that never closes runs to the end and is warned", () => {
  const result = parse('a,b\n1,"never closed\n2,3\n');
  assert.deepEqual(result.rows, [["a", "b"], ["1", "never closed\n2,3\n"]]);
  assert.deepEqual(kinds(result), ["unclosed-quote"]);
  assert.equal(result.warnings[0].row, 2);
  assert.equal(result.warnings[0].line, 2);
});

test("parse: warnings come in row order when kinds mix", () => {
  const result = parse('a,b\n1\n2,x"y\n');
  assert.deepEqual(result.warnings.map((w) => [w.kind, w.row]), [["ragged", 2], ["stray-quote", 3]]);
});

test("parse: a value that is not a string is refused", () => {
  assert.throws(() => parse(undefined), TypeError);
  assert.throws(() => parse(new Uint8Array(3)), TypeError);
});

// ---- write ----

test("write: plain cells are not quoted, and every row ends with the line ending", () => {
  assert.equal(write([["Group", "Grade"], ["7-1", "7"]]), "Group,Grade\r\n7-1,7\r\n");
});

test("write: the line ending is CRLF unless eol says otherwise", () => {
  const rows = [["a", "b"], ["c", "d"]];
  assert.equal(write(rows), "a,b\r\nc,d\r\n");
  assert.equal(write(rows, { eol: "\n" }), "a,b\nc,d\n");
  assert.equal(write(rows, { eol: "\r" }), "a,b\rc,d\r");
});

test("write: an eol that is not a line ending is refused", () => {
  assert.throws(() => write([["a"]], { eol: ";" }), TypeError);
  assert.throws(() => write([["a"]], { eol: "" }), TypeError);
});

test("write: quotes only a cell holding a comma, a quote or a line break", () => {
  assert.equal(
    write([["plain", "with space", "a,b", 'say "hi"', "two\nlines", "cr\rhere", "<b>&</b>", "'apostrophe'", " padded "]], { eol: "\n" }),
    'plain,with space,"a,b","say ""hi""","two\nlines","cr\rhere",<b>&</b>,\'apostrophe\', padded \n',
  );
});

test("write: a line break inside a cell is written as typed whatever eol is", () => {
  assert.equal(write([["a\nb", "c\r\nd"]], { eol: "\r\n" }), '"a\nb","c\r\nd"\r\n');
});

test("write: empty cells are written bare, but a row of one empty cell is written as \"\"", () => {
  assert.equal(write([["", "a", ""], [""], ["b"]], { eol: "\n" }), ',a,\n""\nb\n');
});

test("write: no rows is an empty text", () => {
  assert.equal(write([]), "");
});

test("write: with guard off, a cell starting with =, +, -, @, tab or CR is written as typed", () => {
  assert.equal(
    write([["=SUM(A1)", "+1", "-5", "@home", "\ttab", "\rcr"]], { eol: "\n" }),
    '=SUM(A1),+1,-5,@home,\ttab,"\rcr"\n',
  );
  assert.equal(write([["=SUM(A1)"]], { eol: "\n", guard: false }), "=SUM(A1)\n");
});

test("write: with guard on, a cell starting with =, +, -, @, tab or CR gets one single quote in front", () => {
  assert.equal(
    write([["=SUM(A1)", "+1", "-5", "@home", "\ttab", "\rcr"]], { eol: "\n", guard: true }),
    "'=SUM(A1),'+1,'-5,'@home,'\ttab,\"'\rcr\"\n",
  );
});

test("write: guard touches only the first character, and only those six", () => {
  const rows = [["a=b", "1+1", "7-1", "x@y", "a\tb", "'=kept", "", " =spaced", "<b>", "七年级一班"]];
  assert.equal(write(rows, { eol: "\n", guard: true }), write(rows, { eol: "\n" }));
});

test("write: a guarded cell that also needs quoting is guarded inside the quotes", () => {
  assert.equal(write([['=A1,"x"']], { eol: "\n", guard: true }), '"\'=A1,""x"""\n');
});

test("write: a guarded cell reads back with its single quote, since parse never interprets", () => {
  assert.deepEqual(parse(write([["=1+1", "-5"]], { guard: true })).rows, [["'=1+1", "'-5"]]);
});

test("write: bom puts one byte-order mark first, and parse drops it again", () => {
  const text = write([["七年级一班", "7"]], { bom: true, eol: "\n" });
  assert.equal(text, "﻿七年级一班,7\n");
  assert.deepEqual(parse(text).rows, [["七年级一班", "7"]]);
  assert.equal(write([["a"]], { eol: "\n" }).startsWith("﻿"), false);
});

test("write: a cell starting with U+FEFF is quoted so it is not taken for the byte-order mark", () => {
  const rows = [["﻿odd", "x"]];
  assert.equal(write(rows, { eol: "\n" }), '"﻿odd",x\n');
  assert.deepEqual(parse(write(rows)).rows, rows);
});

test("write: null and undefined are empty cells; other values are written as their text", () => {
  assert.equal(write([[null, undefined, 24, 0, false]], { eol: "\n" }), ",,24,0,false\n");
});

test("write: rows that are not arrays of arrays are refused", () => {
  assert.throws(() => write("a,b"), TypeError);
  assert.throws(() => write(["a,b"]), TypeError);
});

// ---- round trips ----

const AWKWARD = [
  ["Group", "Teacher", "Note"],
  ['<b>7-1</b> the "Owls"', "Ms. O'Dala-Reyes", "a,b"],
  ["七年级一班", "Седьмой А", "الصف السابع ب"],
  ["=SUM(A1:A2)", "+1", "-5"],
  ["@home", "\ttab", "\rcr"],
  ["line\nbreak", "line\r\nbreak", "line\rbreak"],
  ["", "", ""],
  [" lead", "trail ", "  "],
  ['"', '""', '","'],
  ["﻿mark", "a﻿b", "𝔘𝔫𝔦 🏫"],
];

for (const eol of ["\r\n", "\n", "\r"]) {
  test(`round trip: awkward cells survive write then parse unchanged, eol ${JSON.stringify(eol)}`, () => {
    const result = parse(write(AWKWARD, { eol }));
    assert.deepEqual(result.rows, AWKWARD);
    assert.deepEqual(result.warnings, []);
  });
}

test("round trip: with a byte-order mark written, the rows still come back unchanged", () => {
  assert.deepEqual(parse(write(AWKWARD, { bom: true })).rows, AWKWARD);
});

test("round trip: rows of one cell, including one empty cell, come back unchanged", () => {
  const rows = [["a"], [""], ["b"], [""]];
  assert.deepEqual(parse(write(rows)).rows, rows);
});

test("round trip: ragged rows come back ragged", () => {
  const rows = [["a", "b", "c"], ["1"], ["1", "2", "3", "4"], ["", ""]];
  assert.deepEqual(parse(write(rows)).rows, rows);
});

test("round trip: a well-formed CRLF file is written back byte for byte", () => {
  const text = read("crlf.csv");
  assert.equal(write(parse(text).rows), text);
});

test("round trip: the input rows are not changed by write", () => {
  const rows = [["=1", 'a"b'], [null, 5]];
  const before = JSON.stringify(rows);
  write(rows, { guard: true });
  assert.equal(JSON.stringify(rows), before);
});
