// heap.js — a binary min-heap, because a sorted array stopped being the right
// trade.
//
// Every Dijkstra and A* in this codebase kept its open set as an array and
// sorted it before every pop. That is not laziness, it was a measurement: at
// three hundred nodes the sort is a few microseconds and a heap is a page of
// code somebody has to read. The comment in `findPath` said so out loud.
//
// Phase 17 is the size where that stops being true. A campus is more than one
// building, the site around it is now meshed as well, and `egressField` walks
// every node in all of it from every exit at once — three thousand nodes
// rather than three hundred. `sort()` on every pop makes the whole thing
// quadratic-with-a-log on top; a heap makes it linearithmic, and the crossover
// is somewhere around a thousand.
//
// Deliberately small: push, pop, size. No decrease-key — every search here
// pushes a duplicate entry and skips the stale one on the way out (the `done`
// set), which is the standard lazy-deletion Dijkstra and needs no handles.
//
// Pure module: no three.js, no DOM. Exercised by test/heap.test.mjs.

// Ordered by `key`, smallest out first. Ties are broken by insertion order so
// that two routes of equal cost come out in the order they were found, which
// is what keeps a path deterministic across runs.
export class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
    this.seq = [];
    this.n = 0;
  }

  get size() { return this.items.length; }

  push(item, key) {
    const i = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    this.seq.push(this.n++);
    this.up(i);
    return this;
  }

  pop() {
    const n = this.items.length;
    if (!n) return undefined;
    const top = this.items[0];
    const last = n - 1;
    if (last > 0) {
      this.items[0] = this.items[last];
      this.keys[0] = this.keys[last];
      this.seq[0] = this.seq[last];
    }
    this.items.pop(); this.keys.pop(); this.seq.pop();
    if (this.items.length > 1) this.down(0);
    return top;
  }

  peek() { return this.items.length ? this.items[0] : undefined; }

  // `a` sorts before `b`: cheaper first, and at equal cost the one pushed
  // first.
  before(a, b) {
    return this.keys[a] < this.keys[b]
      || (this.keys[a] === this.keys[b] && this.seq[a] < this.seq[b]);
  }

  swap(a, b) {
    const it = this.items[a]; this.items[a] = this.items[b]; this.items[b] = it;
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const s = this.seq[a]; this.seq[a] = this.seq[b]; this.seq[b] = s;
  }

  up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  down(i) {
    const n = this.items.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < n && this.before(l, best)) best = l;
      if (r < n && this.before(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }
}

// The one-liner both searches want: a fresh heap seeded with nothing.
export const minHeap = () => new MinHeap();
