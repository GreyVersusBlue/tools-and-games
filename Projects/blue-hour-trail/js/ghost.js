// The mountain remembers your last walk. One record, one key, no UI:
// the footstep rhythm and route timing of the PREVIOUS visit, replayed into
// the phantom-steps beat on this one. The steps that aren't yours are your
// own, from last time, descending. Nothing surfaces it, nothing explains it,
// and no player can tell it apart from the scheduler's invention — which is
// the point. This is the HTML-sized shadow of the north star's asynchronous
// truth: the mountain is full of people, and one of them is you.
//
// GRANT 3, session 4 — read the prompt file's amendment before "fixing" this
// as a privacy leftover or a missing save feature. It is neither. The piece
// still saves no progress, no score, no position. This file owns the one
// deliberate exception: a project-local localStorage key holding step
// timings, written only when a walk was long enough to have a gait worth
// remembering. It does NOT use assets/js/gvb-save.js, on purpose — that
// module implies a save, and this is not a save.
//
// Imports nothing, so test/smoke.mjs can hold the whole thing under bare
// Node with a stub storage.

export const GHOST_KEY = 'blue-hour-last-walk';

// A walk has to be at least this many steps before it is worth being a
// ghost. Forty steps is ~30 m — below that it was a door opened and closed.
const MIN_STEPS = 40;
const MAX_STEPS = 900;

/** [[t, dt], ...] → compact JSON. Trail t to 3 places, step gap to 2. */
export function encodeWalk(steps) {
  return JSON.stringify({
    v: 1,
    steps: steps.map(([t, dt]) => [Math.round(t * 1000) / 1000, Math.round(dt * 100) / 100]),
  });
}

/** JSON → [[t, dt], ...], or null for anything malformed, foreign or empty.
 *  A corrupt record is silently nobody — the mountain does not complain. */
export function decodeWalk(json) {
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    if (!data || data.v !== 1 || !Array.isArray(data.steps)) return null;
    const steps = data.steps.filter(s =>
      Array.isArray(s) && s.length === 2 &&
      Number.isFinite(s[0]) && s[0] >= 0 && s[0] <= 1 &&
      Number.isFinite(s[1]) && s[1] > 0 && s[1] < 10);
    return steps.length >= MIN_STEPS ? steps : null;
  } catch {
    return null;
  }
}

/**
 * The rhythm the previous walker had NEAR this point on the trail: the gaps
 * between their next `n` steps from the recorded step closest to trail t.
 * Null when there is no ghost, or nothing recorded anywhere near here —
 * "near" is a tenth of the mountain, because a rhythm borrowed from the
 * wrong altitude is still a human rhythm, but a rhythm borrowed from nowhere
 * is an invention, and inventions are the scheduler's job.
 */
export function rhythmNear(steps, trailT, n = 3) {
  if (!steps || !steps.length) return null;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(steps[i][0] - trailT);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (bestD > 0.1) return null;
  const out = [];
  for (let i = best; i < steps.length && out.length < n; i++) out.push(steps[i][1]);
  return out.length ? out : null;
}

/**
 * The live half: records this visit's walk, serves the previous one.
 * `storage` is localStorage in play and a stub in the smoke suite; a storage
 * that throws (privacy modes do) degrades to a mountain with no memory,
 * which is exactly what the piece was before this grant.
 */
export function createGhost(storage) {
  let last = null;
  try { last = decodeWalk(storage.getItem(GHOST_KEY)); } catch { /* no memory, fine */ }

  const walk = [];
  let prevNow = null;

  return {
    loaded: !!last,
    count: last ? last.length : 0,

    /** Call on every real footstep with the walker's trail t and a clock. */
    step(trailT, nowSec) {
      if (prevNow !== null) {
        const dt = nowSec - prevNow;
        // Gaps longer than a few seconds are standing still, not walking —
        // the ghost keeps the gait, not the sightseeing.
        if (dt > 0.2 && dt < 4 && walk.length < MAX_STEPS) walk.push([trailT, dt]);
      }
      prevNow = nowSec;
    },

    walked: () => walk.length,

    /** Persist this visit as the next visit's ghost. Quietly refuses walks
     *  too short to have been a walk. */
    save() {
      if (walk.length < MIN_STEPS) return false;
      try { storage.setItem(GHOST_KEY, encodeWalk(walk)); return true; }
      catch { return false; }
    },

    /** The previous walker's gait near this trail t, or null. */
    rhythmNear: (trailT, n = 3) => rhythmNear(last, trailT, n),
  };
}
