import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, record, undo, redo, canUndo, canRedo, peekUndo, peekRedo, HISTORY_LIMIT } from '../../engine/history.js';

const entry = (n) => ({ label: 'Step ' + n, before: { n: n - 1 }, after: { n }, focus: null, bumps: [] });

test('the limit is 200 entries', () => {
  assert.equal(HISTORY_LIMIT, 200);
});

test('a new history has nothing to undo or redo', () => {
  const history = createHistory();
  assert.deepEqual(history, { past: [], future: [] });
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
  assert.equal(undo(history), null);
  assert.equal(redo(history), null);
  assert.equal(peekUndo(history), null);
  assert.equal(peekRedo(history), null);
});

test('undo gives back the newest entry and moves it to the redo side', () => {
  let history = record(record(createHistory(), entry(1)), entry(2));
  const step = undo(history);
  assert.equal(step.entry.label, 'Step 2');
  assert.deepEqual(step.entry.before, { n: 1 });
  history = step.history;
  assert.deepEqual(history.past.map((e) => e.label), ['Step 1']);
  assert.deepEqual(history.future.map((e) => e.label), ['Step 2']);
  assert.equal(peekUndo(history).label, 'Step 1');
  assert.equal(peekRedo(history).label, 'Step 2');
});

test('redo brings the entries back in the order they were undone', () => {
  let history = createHistory();
  for (let n = 1; n <= 3; n += 1) history = record(history, entry(n));
  history = undo(undo(history).history).history;
  const first = redo(history);
  assert.equal(first.entry.label, 'Step 2');
  const second = redo(first.history);
  assert.equal(second.entry.label, 'Step 3');
  assert.equal(redo(second.history), null);
  assert.deepEqual(second.history.past.map((e) => e.label), ['Step 1', 'Step 2', 'Step 3']);
});

test('a new entry after an undo clears what could have been redone', () => {
  let history = record(record(createHistory(), entry(1)), entry(2));
  history = undo(history).history;
  history = record(history, entry(9));
  assert.equal(canRedo(history), false);
  assert.deepEqual(history.past.map((e) => e.label), ['Step 1', 'Step 9']);
});

test('the cap: after 250 entries the newest 200 are kept and the oldest 50 are gone', () => {
  let history = createHistory();
  for (let n = 1; n <= 250; n += 1) history = record(history, entry(n));
  assert.equal(history.past.length, 200);
  assert.equal(history.past[0].label, 'Step 51');
  assert.equal(history.past[199].label, 'Step 250');
  let undone = 0;
  while (canUndo(history)) {
    history = undo(history).history;
    undone += 1;
  }
  assert.equal(undone, 200);
});

test('exactly 200 entries are all kept; the 201st pushes out the first', () => {
  let history = createHistory();
  for (let n = 1; n <= 200; n += 1) history = record(history, entry(n));
  assert.equal(history.past[0].label, 'Step 1');
  history = record(history, entry(201));
  assert.equal(history.past.length, 200);
  assert.equal(history.past[0].label, 'Step 2');
});

test('a smaller limit can be asked for', () => {
  let history = createHistory();
  for (let n = 1; n <= 5; n += 1) history = record(history, entry(n), 3);
  assert.deepEqual(history.past.map((e) => e.label), ['Step 3', 'Step 4', 'Step 5']);
});

test('no function changes the history it is given', () => {
  const history = record(record(createHistory(), entry(1)), entry(2));
  const frozen = Object.freeze({ past: Object.freeze(history.past.slice()), future: Object.freeze([]) });
  const afterUndo = undo(frozen);
  record(frozen, entry(3));
  redo(afterUndo.history);
  assert.equal(frozen.past.length, 2);
  assert.equal(frozen.future.length, 0);
});
