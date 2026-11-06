// rng.js — the seeded generator, on its own so that a module wanting four lines
// of randomness does not pull the 85 KB crowd in with it (TG-40: hunt, murmur,
// haunt, timetable, creature and generate all imported agents.js for this).

// mulberry32: thirty-two bits of state, four lines, and the same sequence
// everywhere. A seeded population is the difference between "watch this again"
// and "watch something like this again".
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
