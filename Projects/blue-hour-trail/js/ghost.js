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
// And no more than this many, ever — but as a SAMPLING BUDGET, not a stop.
// Measured in session 6: the climb is 975 steps and the way back down is 839,
// so a whole visit is ~1,814 and the old hard stop ended the record at t 0.917
// of the CLIMB. Every walker who went up and came back down again saved a
// memory in which they never came down — and the beat this feeds is
// descending by authorship. The record thins by half instead (see step()), so
// a walk of any length is remembered along its whole route at a coarser
// sampling rather than remembered in full and then cut off halfway.
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

/** A step whose t is lower than the one before it was a step DOWN the
 *  mountain. Nothing else in the record knows which way anybody was going. */
const wentDown = (steps, i) => i > 0 && steps[i][0] < steps[i - 1][0];

/** The nearest recorded step to trail t, and the gaps that follow it. Set
 *  `descending` and only steps taken on the way down are eligible. */
function gapsNear(steps, trailT, n, descending) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    if (descending && !wentDown(steps, i)) continue;
    const d = Math.abs(steps[i][0] - trailT);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0 || bestD > 0.1) return null;
  const out = [];
  for (let i = best; i < steps.length && out.length < n; i++) out.push(steps[i][1]);
  return out.length ? out : null;
}

/**
 * The rhythm the previous walker had NEAR this point on the trail: the gaps
 * between their next `n` steps from the recorded step closest to trail t.
 * Null when there is no ghost, or nothing recorded anywhere near here —
 * "near" is a tenth of the mountain, because a rhythm borrowed from the
 * wrong altitude is still a human rhythm, but a rhythm borrowed from nowhere
 * is an invention, and inventions are the scheduler's job.
 *
 * The descending pass gets asked first. A whole visit's record crosses every
 * stretch of trail twice — once climbing, once coming back down — and nearest
 * t alone answers with the climb every time: it is walked slower (0.88 m a
 * step against 1.02), so its steps lie denser in t, and it is recorded first,
 * which settles the ties. The beat these gaps feed is descending by
 * authorship — pitch falling, panned downhill — so it asks the half of the
 * walk that was going the same way. A walker who climbed and never came back
 * down leaves no descending pass, and then the climb is all there is; that is
 * the fallback, and it is also the older behaviour exactly.
 */
export function rhythmNear(steps, trailT, n = 3) {
  if (!steps || !steps.length) return null;
  return gapsNear(steps, trailT, n, true) || gapsNear(steps, trailT, n, false);
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
  // How many real steps one recorded step now stands for. Doubles every time
  // the record fills up; a walk short enough never to fill it is remembered
  // step for step, exactly as before.
  let perKept = 1, sinceKept = 0;

  return {
    loaded: !!last,
    count: last ? last.length : 0,

    /** Call on every real footstep with the walker's trail t and a clock. */
    step(trailT, nowSec) {
      if (prevNow !== null) {
        const dt = nowSec - prevNow;
        // Gaps longer than a few seconds are standing still, not walking —
        // the ghost keeps the gait, not the sightseeing.
        if (dt > 0.2 && dt < 4 && ++sinceKept >= perKept) {
          sinceKept = 0;
          walk.push([trailT, dt]);
          // Full. Keep every other one and halve the sampling rate from here,
          // so the walk stays whole and only gets grainier. Each survivor is
          // still a gap that was genuinely walked — nothing is averaged, and
          // a pause is either kept or dropped, never smeared into the gait.
          if (walk.length >= MAX_STEPS) {
            for (let i = 1, j = 2; j < walk.length; i++, j += 2) walk[i] = walk[j];
            walk.length = Math.ceil(walk.length / 2);
            perKept *= 2;
          }
        }
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
