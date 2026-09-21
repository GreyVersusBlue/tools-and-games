// Signal City: the seeded random source. Everything in the simulation that
// rolls a die rolls this one, so a run is a function of its seed and the
// player's inputs and nothing else. The suites lean on that: the same seed
// stepped twice has to hash the same (test/sim.mjs).
//
// mulberry32, the same generator hearth/js/core.js carries. Copied, not
// imported: nothing is shared across projects (locked decision #17).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small toolkit over one generator so callers never touch Math.random.
export function makeRng(seed = 1) {
  const r = mulberry32(seed);
  return {
    seed,
    next: r,
    // uniform in [lo, hi)
    range(lo, hi) { return lo + (hi - lo) * r(); },
    // integer in [lo, hi]
    int(lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); },
    chance(p) { return r() < p; },
    pick(arr) { return arr[Math.floor(r() * arr.length)]; },
    // weighted pick over [{ w, ... }] or a { key: weight } map
    weighted(entries) {
      const list = Array.isArray(entries)
        ? entries.map(e => [e, e.w])
        : Object.entries(entries).map(([k, w]) => [k, w]);
      let total = 0;
      for (const [, w] of list) total += w;
      let x = r() * total;
      for (const [v, w] of list) { x -= w; if (x < 0) return v; }
      return list[list.length - 1][0];
    },
    // exponential inter-arrival for a Poisson process with rate per second
    exp(rate) { return rate <= 0 ? Infinity : -Math.log(1 - r()) / rate; },
  };
}
