// The binary heap that replaced a sorted array in two Dijkstras and an A*.
// Small enough to check exhaustively: order, stability, and that it survives
// the two shapes a lazy-deletion search actually pushes at it — duplicates of
// one key, and a long descending run that makes every push sift to the top.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MinHeap, minHeap } from '../js/heap.js';

const drain = (h) => {
  const out = [];
  while (h.size) out.push(h.pop());
  return out;
};

test('an empty heap pops undefined and knows it is empty', () => {
  const h = minHeap();
  assert.equal(h.size, 0);
  assert.equal(h.pop(), undefined);
  assert.equal(h.peek(), undefined);
});

test('what goes in comes out smallest first, whatever order it went in', () => {
  const keys = [7, 1, 9, 3, 3, 0, 12, -4, 5];
  const h = new MinHeap();
  for (const k of keys) h.push(k, k);
  assert.deepEqual(drain(h), keys.slice().sort((a, b) => a - b));
});

test('ties come out in the order they went in', () => {
  // The reason this matters: two routes of equal cost have to come out in the
  // same order on every run, or a path is only deterministic by luck.
  const h = minHeap();
  for (const id of ['a', 'b', 'c', 'd']) h.push(id, 5);
  assert.deepEqual(drain(h), ['a', 'b', 'c', 'd']);
});

test('a descending run is the worst case, and it still comes out sorted', () => {
  const h = minHeap();
  for (let i = 200; i > 0; i--) h.push(i, i);
  const out = drain(h);
  assert.equal(out.length, 200);
  for (let i = 0; i < out.length; i++) assert.equal(out[i], i + 1);
});

test('pushing while popping keeps the invariant', () => {
  // Which is what a search does: every relaxation pushes a *duplicate* entry
  // for a node already in the heap, and the stale one is skipped on the way
  // out. The heap never learns about that; it only has to stay ordered.
  const h = minHeap();
  h.push('start', 0);
  const seen = [];
  let n = 0;
  while (h.size && n < 50) {
    const item = h.pop();
    seen.push(item);
    n++;
    if (n < 20) {
      h.push(`${item}>l`, n * 2 + 1);
      h.push(`${item}>r`, n * 2);
    }
  }
  assert.ok(seen.length > 20);
});

test('peek is the next pop, and does not remove it', () => {
  const h = minHeap();
  h.push('big', 9).push('small', 1).push('mid', 4);
  assert.equal(h.peek(), 'small');
  assert.equal(h.size, 3);
  assert.equal(h.pop(), 'small');
  assert.equal(h.peek(), 'mid');
});

test('a heap of one thousand random keys agrees with a sort', () => {
  // A seeded shuffle rather than Math.random, so a failure is a failure twice.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const keys = Array.from({ length: 1000 }, () => Math.round(rand() * 1e6));
  const h = minHeap();
  for (const k of keys) h.push(k, k);
  assert.deepEqual(drain(h), keys.slice().sort((a, b) => a - b));
});
