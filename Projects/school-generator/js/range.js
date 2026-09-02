// range.js — a number that knows how sure it is.
//
// Phase 41. Half of what the report measures is drawn — a wall is where it
// is, a door is as wide as it is — and half is assumed: the use a room is
// put to when nobody named it, the absorption of a ceiling nobody specified.
// Until this phase every reader answered both kinds with one number, and the
// arc-four closeout said what was wrong with that: "the model knows what it
// does not know", and should say so. So an analysis whose input is a guess
// answers low–high, and this is the arithmetic it answers with.
//
// A range is `{ low, high }`, low ≤ high, and a point is a range whose ends
// meet. Nothing here is clever — the whole file is the four things every
// caller was about to write for itself: make one, add them up, say which end
// is the bad one, and print it. Worst-first sorting reads `worst()`, because
// a range sorts by its bad end (the Phase 41 rule), and a printer reads
// `fmtRange()`, so "34" and "3–129" come out of the same call.
//
// Pure module: no three.js, no DOM. Exercised by test/range.test.mjs.

const num = (v) => (Number.isFinite(v) ? v : 0);

// A range from two ends, in either order. Non-finite ends read as zero, the
// same defensive default `roomOccupancy` applies to an area.
export function range(a, b = a) {
  const x = num(a), y = num(b);
  return x <= y ? { low: x, high: y } : { low: y, high: x };
}

export const point = (v) => range(v, v);

export const isRange = (r) => !!r && Number.isFinite(r.low) && Number.isFinite(r.high) && r.low <= r.high;

// True when the ends differ — when there is something to say.
export const isSpread = (r) => isRange(r) && r.high > r.low;

export const spanOf = (r) => (isRange(r) ? r.high - r.low : 0);

// Sum, end for end. A total of ranges is a range whose low is every low and
// whose high is every high — which is the honest total, and wider than the
// truth (the rooms will not all be at their worst at once), which is why the
// report also says which single input would narrow it most.
export function addRanges(list) {
  let low = 0, high = 0;
  for (const r of list || []) {
    if (!isRange(r)) continue;
    low += r.low; high += r.high;
  }
  return { low, high };
}

// Which end is the bad one depends on the question: more occupants is worse,
// so is a longer tail, so is *less* glazing. `direction` is 'high' when a
// bigger number is worse (the default), 'low' when a smaller one is.
export const worst = (r, direction = 'high') => {
  if (!isRange(r)) return num(r);
  return direction === 'low' ? r.low : r.high;
};
export const best = (r, direction = 'high') => {
  if (!isRange(r)) return num(r);
  return direction === 'low' ? r.high : r.low;
};

// Does a limit fall inside the range — is the answer "maybe"? Both tests
// are strict at the bad end and inclusive at the good one, so a range that
// ends exactly on the limit passes rather than teeters.
export function against(r, limit, direction = 'high') {
  if (!isRange(r) || !Number.isFinite(limit)) return { over: false, maybe: false };
  const w = worst(r, direction), b = best(r, direction);
  const over = direction === 'low' ? b < limit : b > limit;       // even the good end fails
  const maybe = !over && (direction === 'low' ? w < limit : w > limit);   // only the bad end does
  return { over, maybe };
}

// "34", or "3–129". `fmt` renders one end; the default rounds. A unit goes
// on once, after the pair, the way a person writes it.
export function fmtRange(r, opts = {}) {
  const fmt = opts.fmt || ((v) => String(Math.round(v)));
  const unit = opts.unit ? ` ${opts.unit}` : '';
  if (!isRange(r)) return `${fmt(num(r))}${unit}`;
  const lo = fmt(r.low), hi = fmt(r.high);
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
}
