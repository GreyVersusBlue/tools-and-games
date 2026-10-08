// CSV parse and write (RFC 4180, a byte-order mark, any line ending).
//
// Pure: no imports, no DOM, no Node API. It runs in the page and in Node.
//
// All text is data (spec 3.5). `parse` returns every cell exactly as typed and
// interprets none of them: nothing is trimmed, nothing becomes a number, and a
// cell starting with `=`, `+`, `-` or `@` is an ordinary string. `write` changes
// a cell in one case only, when the caller turns `guard` on.
//
// What `parse` reads:
// - fields separated by commas, rows by CRLF, LF or CR, with or without a line
//   ending after the last row;
// - a double-quoted field, in which a comma or a line break is part of the cell
//   and `""` is one quote. A quote opens a field only as its first character;
// - one byte-order mark (U+FEFF) at the very start, which is dropped;
// - a line with nothing on it, which is skipped. A line holding `""` is a row
//   with one empty cell, and that is how `write` writes such a row.
//
// What `parse` does with a file that is not well formed. It never refuses one;
// it keeps what is there and says so in `warnings`:
// - `ragged`: a row whose cell count differs from the first row's. Kept as is.
// - `stray-quote`: a quote inside an unquoted field, or text after a closing
//   quote. The characters are kept as typed.
// - `unclosed-quote`: a quoted field that never closes. It runs to the end of
//   the text.
//
// A warning is `{ kind, row, line, message }`. `row` counts from 1 in `rows`;
// `line` counts from 1 in the text and is the line the row starts on.

const BOM = "﻿";
const QUOTE = '"';
const COMMA = ",";
const CR = "\r";
const LF = "\n";
const TAB = "\t";

const EOLS = [CR + LF, LF, CR];

// A spreadsheet reads a cell starting with one of these as a formula.
const GUARDED_STARTS = ["=", "+", "-", "@", TAB, CR];

export function parse(text) {
  if (typeof text !== "string") {
    throw new TypeError("parse needs the file's text as a string.");
  }

  const rows = [];
  // The line each kept row starts on, beside `rows`.
  const lines = [];
  const warnings = [];
  const end = text.length;
  let i = text.startsWith(BOM) ? BOM.length : 0;

  let row = [];
  let cell = "";
  // True once the current field has been opened by a quote, so that `""` is
  // an empty cell and not a blank line.
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  // One warning of a kind for a row is enough.
  const warn = (kind, message) => {
    const last = warnings[warnings.length - 1];
    if (last && last.kind === kind && last.row === rows.length + 1) return;
    warnings.push({ kind, row: rows.length + 1, line: rowLine, message });
  };

  const endCell = () => {
    row.push(cell);
    cell = "";
    quoted = false;
  };

  const endRow = () => {
    const blank = row.length === 0 && cell === "" && !quoted;
    if (!blank) {
      endCell();
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
    cell = "";
    quoted = false;
  };

  while (i < end) {
    const ch = text[i];

    if (ch === QUOTE && cell === "" && !quoted) {
      // A quoted field: read to its closing quote.
      quoted = true;
      i += 1;
      let closed = false;
      while (i < end) {
        const next = text.indexOf(QUOTE, i);
        if (next === -1) break;
        cell += text.slice(i, next);
        if (text[next + 1] === QUOTE) {
          cell += QUOTE;
          i = next + 2;
        } else {
          i = next + 1;
          closed = true;
          break;
        }
      }
      if (!closed) {
        cell += text.slice(i);
        i = end;
        warn(
          "unclosed-quote",
          `Row ${rows.length + 1} has a quoted cell that never closes. Everything after its opening quote was read as one cell.`,
        );
      }
      // Line breaks inside the quotes still count as lines of the file.
      for (let k = 0; k < cell.length; k += 1) {
        if (cell[k] === LF || (cell[k] === CR && cell[k + 1] !== LF)) line += 1;
      }
      if (closed && i < end && text[i] !== COMMA && text[i] !== CR && text[i] !== LF) {
        warn(
          "stray-quote",
          `Row ${rows.length + 1} has text after a closing quote. The text was kept as typed.`,
        );
      }
      continue;
    }

    if (ch === COMMA) {
      endCell();
      i += 1;
      continue;
    }

    if (ch === CR || ch === LF) {
      i += ch === CR && text[i + 1] === LF ? 2 : 1;
      line += 1;
      endRow();
      rowLine = line;
      continue;
    }

    if (ch === QUOTE) {
      warn(
        "stray-quote",
        `Row ${rows.length + 1} has a quote in the middle of a cell that is not quoted. The quote was kept as typed.`,
      );
    }
    cell += ch;
    i += 1;
  }

  // The last row, when the text does not end with a line ending.
  endRow();

  const width = rows.length > 0 ? rows[0].length : 0;
  let ragged = false;
  for (let r = 1; r < rows.length; r += 1) {
    if (rows[r].length === width) continue;
    ragged = true;
    warnings.push({
      kind: "ragged",
      row: r + 1,
      line: lines[r],
      message: `Row ${r + 1} has ${count(rows[r].length)}; the first row has ${count(width)}. The row was kept as it is.`,
    });
  }
  if (ragged) warnings.sort((a, b) => a.row - b.row);

  return { rows, warnings };
}

export function write(rows, options = {}) {
  const { eol = CR + LF, guard = false, bom = false } = options;
  if (!EOLS.includes(eol)) {
    throw new TypeError("write needs eol to be CRLF, LF or CR.");
  }
  if (!Array.isArray(rows)) {
    throw new TypeError("write needs rows as an array of arrays of cells.");
  }

  let out = bom ? BOM : "";
  for (const row of rows) {
    if (!Array.isArray(row)) {
      throw new TypeError("write needs rows as an array of arrays of cells.");
    }
    const alone = row.length === 1;
    const cells = row.map((value) => {
      let cell = value === null || value === undefined ? "" : String(value);
      if (guard && GUARDED_STARTS.includes(cell[0])) cell = "'" + cell;
      return needsQuotes(cell, alone) ? QUOTE + cell.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE : cell;
    });
    out += cells.join(COMMA) + eol;
  }
  return out;
}

// Quote only what would not read back as typed: a cell holding a quote, a
// comma or a line break; a cell starting with U+FEFF, which at the start of the
// file would be taken for the byte-order mark; and an empty cell alone on its
// row, which would otherwise be a blank line.
function needsQuotes(cell, alone) {
  if (cell === "") return alone;
  return (
    cell.includes(QUOTE) ||
    cell.includes(COMMA) ||
    cell.includes(LF) ||
    cell.includes(CR) ||
    cell.startsWith(BOM)
  );
}

function count(n) {
  return n === 1 ? "1 cell" : `${n} cells`;
}
