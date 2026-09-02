// csv.test.mjs — the one CSV rule, now that there is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRows, parseCSV } from '../js/csv.js';

test('a cell is quoted only when it has to be', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(12), '12');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
});

test('rows join with CRLF and quote what needs quoting', () => {
  assert.equal(csvRows([['a,b', 'c"d', 'e']]), '"a,b","c""d",e');
  assert.equal(csvRows([['k', 'v'], [1, 2]]), 'k,v\r\n1,2');
  assert.equal(csvRows([]), '');
});

test('parseCSV handles quotes, embedded commas and blank lines', () => {
  const rows = parseCSV('a,b,c\r\n"one, two",three,""\n\n"say ""hi""",x,y\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['one, two', 'three', ''],
    ['say "hi"', 'x', 'y'],
  ]);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV(null), []);
});

test('what csvRows writes, parseCSV reads back', () => {
  const rows = [['Key', 'Rate', 'Source'], ['wall,ext', '12.5', 'a "quoted" note'], ['', '', '']];
  // A row of empty cells is `,,`, which is not a blank line, so it survives;
  // only a line with nothing on it at all is skipped.
  assert.deepEqual(parseCSV(csvRows(rows)), rows);
  assert.deepEqual(parseCSV(csvRows([['a'], [''], ['b']])), [['a'], ['b']]);
});
