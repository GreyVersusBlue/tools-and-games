import { CFG } from '../config.js';
import { createRng } from './rng.js';
import { adjacencyOf, gridDesks } from './chart.js';

// Phase 2 — THE TELL SCHEDULE, COMPOSED.
//
// An authored schedule is eight to ten rows of "at minute m, this kid, that
// kind of thing, for this long." The rows were never the hard part; the hard
// part was the promises between them, which nobody wrote down until now:
//
//   - a WHISPER or COPYING needs two kids who can reach each other in the
//     August chart, or the chart screen's separation rule has nothing to do;
//   - a NOTE needs two kids who cannot, or it is a handoff you will never see;
//   - exactly one QUIET, in the middle of the period, on a kid you would not
//     have picked;
//   - nothing lands on a seat that is still carrying the last thing;
//   - the August chart swallows at most a couple of them — a steady neighbour
//     absorbing a tell is the chart screen's best trick, and a roster whose
//     stabilisers happen to sit next to all the noise is a period where
//     nothing happens;
//   - the total unresolved-tell pressure — seconds of tell, summed — sits
//     inside a band, so a period is neither a Tuesday nor a riot;
//   - and every start is a clear gap after the one before.
//
// scheduleProblems() is that list, and generateSchedule() draws until the
// list is empty. What it does not promise is where the meters land: that is
// the band check in systems/generate.js, which runs the result through the
// headless sim and re-rolls this whole schedule if the numbers come out wrong.
//
// Pure. The seed here is normally mixSeed(classSeed, day, attempt), so one
// class has a different Tuesday and the same kids.

const round1 = v => Math.round(v * 10) / 10;

// Would the August chart quietly absorb this one? The same question
// createChart.resolveSchedule asks — the steadiest neighbour, not counting the
// partner in crime, weighted by how close they sit — asked on paper before
// there is a chart. The suite holds the two answers to each other.
function swallowed(row, roster, desks, { tellTypes, rules }) {
  const def = tellTypes[row.type] || {};
  if (!def.suppressible) return false;
  let best = 0;
  for (let j = 0; j < roster.length; j++) {
    if (j === row.seat || j === row.with) continue;
    const w = adjacencyOf(desks[row.seat], desks[j]);
    if (w > 0) best = Math.max(best, (roster[j].steady ?? 0) * w);
  }
  return best >= rules.suppressThreshold;
}

function draw(rng, roster, { tellTypes, seatGrid, rules, gen }) {
  const S = gen.schedule;
  const n = roster.length;
  const desks = gridDesks(seatGrid, n);
  const reach = (i, j) => adjacencyOf(desks[i], desks[j]);
  const canReach = (i, j) => reach(i, j) >= rules.minAdjacency;

  // 1. How many, and of what. Every type gets its minimum; the rest of the
  //    count is a weighted draw over whatever is still under its cap.
  const count = rng.int(S.count.min, S.count.max);
  const types = [];
  for (const [type, m] of Object.entries(S.mix)) for (let k = 0; k < m.min; k++) types.push(type);
  while (types.length < count - 1) {
    const open = Object.entries(S.mix)
      .filter(([type, m]) => types.filter(t => t === type).length < m.max)
      .map(([type, m]) => ({ item: type, weight: m.weight }));
    const t = rng.weighted(open);
    if (!t) break;
    types.push(t);
  }
  if (types.length !== count - 1) return null;

  // 2. When. The window is cut into `count` slots and each tell lands in its
  //    own, at least minGapMinutes before the next slot opens. The curveball
  //    takes whichever slot overlaps its own window the most.
  const w = (S.lastMinute - S.firstMinute) / count;
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({ lo: S.firstMinute + i * w, hi: S.firstMinute + (i + 1) * w - S.minGapMinutes });
  }
  const cb = S.curveball;
  let qi = -1, best = 0;
  slots.forEach((s, i) => {
    const overlap = Math.min(s.hi, cb.minute.max) - Math.max(s.lo, cb.minute.min);
    if (overlap > best) { best = overlap; qi = i; }
  });
  if (qi < 0) return null;
  const order = rng.shuffle(types);
  const rows = [];
  let ti = 0;
  for (let i = 0; i < count; i++) {
    const s = slots[i];
    if (i === qi) {
      const lo = Math.max(s.lo, cb.minute.min), hi = Math.min(s.hi, cb.minute.max);
      rows.push({ type: cb.type, atMinute: round1(rng.between(lo, hi)) });
    } else {
      rows.push({ type: order[ti++], atMinute: round1(rng.between(s.lo, s.hi)) });
    }
  }

  // 3. Who. In time order, so "is this seat still busy" is a question about
  //    rows already placed.
  const busy = roster.map(() => []);           // per seat: [start, end] in game seconds
  const uses = roster.map(() => 0);
  const free = (i, start, end) =>
    uses[i] < S.maxPerSeat && busy[i].every(([a, b]) => end <= a || start >= b);
  const take = (i, start, end) => { busy[i].push([start, end]); uses[i]++; };
  const calmHalf = new Set(roster.map((s, i) => i)
    .sort((a, b) => roster[a].tension - roster[b].tension).slice(0, Math.ceil(n / 2)));

  // Seats the August chart would swallow a tell at are still allowed — one
  // thing that never happens is the report's best line — just rare, and
  // capped, so the period is not all stabiliser.
  let swallowedSoFar = 0;
  const swallowWeight = (type, seat, partner) => {
    if (!swallowed({ type, seat, with: partner }, roster, desks, { tellTypes, rules })) return 1;
    return swallowedSoFar >= S.maxSwallowed ? 0 : S.swallowedWeight;
  };

  for (const row of rows) {
    const def = tellTypes[row.type] || {};
    const lifeRange = S.life[row.type];
    if (!lifeRange) return null;
    row.life = rng.int(lifeRange.min, lifeRange.max);
    const start = row.atMinute * 60, end = start + row.life;

    if (def.anchor === 'pair') {
      const pairs = [];
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (a === b || !free(a, start, end) || !free(b, start, end)) continue;
          const together = canReach(a, b);
          if (def.needsAdjacency ? !together : together) continue;
          const A = roster[a], B = roster[b];
          let weight;
          if (row.type === 'COPYING') {
            // {b}'s answers arrive on {a}'s paper: a is the one who needs them.
            weight = Math.max(0, B.aptitude - A.aptitude);
          } else {
            // The instigator is the louder one, most of the time.
            weight = A.tension >= B.tension ? A.tension + B.tension : 0;
          }
          weight *= swallowWeight(row.type, a, b);
          if (weight > 0) pairs.push({ item: [a, b], weight });
        }
      }
      const pair = rng.weighted(pairs);
      if (!pair) return null;
      row.seat = pair[0]; row.with = pair[1];
      take(row.seat, start, end); take(row.with, start, end);
    } else if (def.curveball) {
      // Never the kid you were already watching.
      const seats = [...calmHalf].filter(i => free(i, start, end));
      if (!seats.length) return null;
      row.seat = rng.pick(seats);
      take(row.seat, start, end);
    } else {
      const seats = roster.map((s, i) => ({
        item: i,
        weight: free(i, start, end) ? (0.2 + s.tension) * swallowWeight(row.type, i, null) : 0
      }));
      const seat = rng.weighted(seats);
      if (seat == null) return null;
      row.seat = seat;
      take(seat, start, end);
    }
    if (swallowed(row, roster, desks, { tellTypes, rules })) swallowedSoFar++;
  }
  return rows;
}

// Everything a schedule promises the period. Empty means it keeps every
// promise. Structural only — where the meters land is generate.js's question.
export function scheduleProblems(rows, roster, { tellTypes, seatGrid, rules, gen }) {
  const S = gen.schedule, out = [];
  if (!Array.isArray(rows)) return ['not a schedule'];
  if (rows.length < S.count.min || rows.length > S.count.max) {
    out.push(`${rows.length} tells; wanted ${S.count.min}..${S.count.max}`);
  }
  const n = roster.length;
  const desks = gridDesks(seatGrid, n);
  const canReach = (i, j) => adjacencyOf(desks[i], desks[j]) >= rules.minAdjacency;
  const nameOf = i => roster[i]?.name ?? `seat ${i}`;

  const counts = {};
  let pressure = 0, lastAt = -Infinity, swallowedCount = 0;
  const busy = roster.map(() => []);
  for (const r of rows) {
    const def = tellTypes[r.type];
    if (!def) { out.push(`${r.type} is not a tell type`); continue; }
    counts[r.type] = (counts[r.type] || 0) + 1;
    if (!Number.isInteger(r.seat) || r.seat < 0 || r.seat >= n) { out.push(`${r.type} at ${r.atMinute} names no real seat`); continue; }
    if (r.with != null && (!Number.isInteger(r.with) || r.with < 0 || r.with >= n || r.with === r.seat)) {
      out.push(`${r.type} at ${r.atMinute} names no real partner`); continue;
    }
    if (def.anchor === 'pair' && r.with == null) out.push(`${r.type} at ${r.atMinute} has no partner`);
    if (def.anchor !== 'pair' && r.with != null) out.push(`${r.type} at ${r.atMinute} should not have a partner`);
    if (r.with != null && def.needsAdjacency && !canReach(r.seat, r.with)) {
      out.push(`${nameOf(r.seat)} and ${nameOf(r.with)} cannot ${r.type} across the room`);
    }
    if (r.with != null && !def.needsAdjacency && canReach(r.seat, r.with)) {
      out.push(`${nameOf(r.seat)} to ${nameOf(r.with)} is a handoff, not a ${r.type}`);
    }
    if (def.curveball) {
      if (r.atMinute < S.curveball.minute.min || r.atMinute > S.curveball.minute.max) {
        out.push(`the curveball is at ${r.atMinute}, outside ${S.curveball.minute.min}..${S.curveball.minute.max}`);
      }
    }
    const lr = S.life[r.type];
    if (!lr || !Number.isInteger(r.life) || r.life < lr.min || r.life > lr.max) {
      out.push(`${r.type} at ${r.atMinute} lives ${r.life}s`);
    }
    if (!Number.isFinite(r.atMinute) || r.atMinute < S.firstMinute || r.atMinute > S.lastMinute) {
      out.push(`${r.type} at ${r.atMinute} is outside ${S.firstMinute}..${S.lastMinute}`);
    }
    if (r.atMinute * 60 + (r.life || 0) >= CFG.periodSeconds) out.push(`${r.type} at ${r.atMinute} outlives the bell`);
    if (r.atMinute < lastAt) out.push('the schedule is not in time order');
    else if (r.atMinute - lastAt < S.minGapMinutes - 1e-9) {
      out.push(`${r.type} at ${r.atMinute} is ${round1(r.atMinute - lastAt)} min after the last one`);
    }
    lastAt = r.atMinute;
    pressure += r.life || 0;
    if (swallowed(r, roster, desks, { tellTypes, rules })) swallowedCount++;

    const start = r.atMinute * 60, end = start + (r.life || 0);
    for (const i of [r.seat, r.with]) {
      if (i == null) continue;
      if (busy[i].some(([a, b]) => !(end <= a || start >= b))) {
        out.push(`${nameOf(i)} is already carrying something at minute ${r.atMinute}`);
      }
      busy[i].push([start, end]);
      if (busy[i].length > S.maxPerSeat) out.push(`${nameOf(i)} is in it ${busy[i].length} times`);
    }
  }
  const q = counts[S.curveball.type] || 0;
  if (q !== 1) out.push(`${q} curveballs; wanted exactly one`);
  for (const [type, m] of Object.entries(S.mix)) {
    const c = counts[type] || 0;
    if (c < m.min || c > m.max) out.push(`${c} ${type}; wanted ${m.min}..${m.max}`);
  }
  for (const type of Object.keys(counts)) {
    if (type !== S.curveball.type && !S.mix[type]) out.push(`${type} is not in the mix`);
  }
  if (pressure < S.pressure.min || pressure > S.pressure.max) {
    out.push(`${pressure}s of tell; wanted ${S.pressure.min}..${S.pressure.max}`);
  }
  if (swallowedCount > S.maxSwallowed) {
    out.push(`the August chart swallows ${swallowedCount} of these; at most ${S.maxSwallowed}`);
  }
  return out;
}

// One schedule for one seed and one roster. Rows look exactly like an authored
// schedule's — type, seat, with, atMinute, life — so createChart.resolveSchedule
// and the tell system cannot tell the difference, which is the point.
export function generateSchedule(seed, roster, deps) {
  const rng = createRng(seed);
  let last = ['no draw'];
  for (let attempt = 0; attempt < deps.gen.schedule.rerollCap; attempt++) {
    const rows = draw(rng, roster, deps);
    if (!rows) { last = ['the draw ran out of seats']; continue; }
    last = scheduleProblems(rows, roster, deps);
    if (!last.length) return rows;
  }
  throw new Error(`Schedule seed ${seed}: no schedule kept its promises in ` +
    `${deps.gen.schedule.rerollCap} draws. Last problems: ${last.join('; ')}`);
}
