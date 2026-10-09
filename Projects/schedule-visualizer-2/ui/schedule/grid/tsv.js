// Tab-separated text, the way a spreadsheet puts cells on the clipboard and
// takes them back: one line per row, a tab between cells, and a cell holding
// a tab, a line break or a quote wrapped in quotes with its quotes doubled.

// Text to rows of cells. Any line ending; the one line break a spreadsheet
// adds after the last row is not a row.
export function parseTsv(text) {
  const source = String(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let at = 0;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (at < source.length) {
    const ch = source[at];
    if (quoted) {
      if (ch === '"' && source[at + 1] === '"') {
        cell += '"';
        at += 2;
      } else if (ch === '"') {
        quoted = false;
        at += 1;
      } else {
        cell += ch;
        at += 1;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
      at += 1;
    } else if (ch === '\t') {
      endCell();
      at += 1;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      at += ch === '\r' && source[at + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch;
      at += 1;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

// Rows of cells to text, with CRLF between rows as spreadsheets write it.
export function writeTsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell);
    return /["\t\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }).join('\t')).join('\r\n');
}
