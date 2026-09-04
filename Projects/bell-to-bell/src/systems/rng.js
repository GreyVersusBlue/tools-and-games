// Phase 2. One integer in, the same class out, forever.
//
// Math.random is fine for a granola bar and useless for a roster: a seed you
// can print on the report screen and type back in is the whole reason the
// generator exists, so everything in it draws from this and nothing in it
// touches Math.random. mulberry32, because it is eleven lines and good enough
// for twelve kids.

export function createRng(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));   // inclusive
  const between = (min, max) => min + next() * (max - min);
  const pick = arr => arr[Math.floor(next() * arr.length)];
  // Fisher-Yates on a copy; the caller's array is not touched.
  const shuffle = arr => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  // Weighted pick over [{ item, weight }]. A weight of 0 never comes up.
  const weighted = entries => {
    let total = 0;
    for (const e of entries) total += Math.max(0, e.weight);
    if (!(total > 0)) return null;
    let r = next() * total;
    for (const e of entries) {
      r -= Math.max(0, e.weight);
      if (r < 0) return e.item;
    }
    return entries[entries.length - 1].item;
  };
  return { next, int, between, pick, shuffle, weighted };
}

// Fold any number of integers into one seed, so "seed 4821, day 3, attempt 2"
// is a stream of its own and re-running it gives the same stream. FNV-1a
// over the arguments, then one avalanche step so 4821/3 and 4821/4 do not
// look like neighbours.
export function mixSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h ^= (p >>> 0);
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B);
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B);
  return (h ^ (h >>> 16)) >>> 0;
}

// A seed a person can read off a report screen and type back in: six digits,
// never zero. Takes any 0..1 source so main.js can hand it Math.random and the
// suite can hand it something fixed.
export const SEED_MAX = 999999;
export const drawSeed = (rand = Math.random) => 1 + Math.floor(rand() * SEED_MAX);
