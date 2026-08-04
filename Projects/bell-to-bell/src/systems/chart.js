import { CFG } from '../config.js';
import { classifySight, occluderRects } from './sightlines.js';

// T4 — THE SEATING CHART.
//
// A desk is a place. A student is a person. Until now those were the same index
// and the game could get away with it. They are separate here: `seatOf[student]`
// is the desk that student is sitting at, and everything downstream still reads
// `student.x` / `student.z`, which this module writes.
//
// Four things the chart decides, none of which are printed on it:
//   1. What you can see from the front — the furniture (T5: draggable) decides it.
//   2. Who can reach whom — a whisper needs a neighbour, and a note does not.
//   3. Who calms whom, and what that costs the person doing the calming.
//   4. Who is close enough to the front to get the most out of you talking.
export function createChart({ seatGrid, room, roster, tellTypes, rules, plan = [], saved = null, layout = null }) {
  const S = CFG.seating;
  const cols = seatGrid.cols, rows = seatGrid.rows;
  const rects = occluderRects(room.occluders || []);
  const viewpoints = room.viewpoints || [{ id: 'front', x: 0, z: room.spawn?.z ?? -2.4 }];
  const B = room.bounds;

  // A rectangle's centre may not leave the room, and the room's centre is not
  // yours to give away: everything is clamped to the room's own footprint.
  function clampOccluder(r, x, z) {
    return {
      x: Math.min(B.x - r.halfW, Math.max(-B.x + r.halfW, x)),
      z: Math.min(B.zBack - r.halfD, Math.max(B.zFront + r.halfD, z))
    };
  }

  // T5: a chart carried over from last period may have moved the furniture too.
  if (Array.isArray(layout)) {
    for (const entry of layout) {
      const r = rects.find(o => o.id === entry.id);
      if (!r || !Number.isFinite(entry.x) || !Number.isFinite(entry.z)) continue;
      const c = clampOccluder(r, entry.x, entry.z);
      r.x = c.x; r.z = c.z;
    }
  }

  // ---- the desks -------------------------------------------------------
  const desks = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      if (desks.length >= roster.length) break;
      const x = cols[c], z = rows[r], bodyZ = z + seatGrid.bodyOffsetZ;
      // The point the raycast actually asks about at run time (systems/tells.js).
      const target = { x: x + 0.18, z: bodyZ - 0.1 };
      desks.push({
        index: desks.length, col: c, row: r, x, z, bodyZ, target,
        rowGain: S.rowGain[Math.min(r, S.rowGain.length - 1)],
        sight: classifySight(target, viewpoints, rects)
      });
    }
  }

  // ---- T5: the classroom builder — push the furniture around ---------------
  // Moves one occluder and reclassifies every desk against the new layout.
  // Nothing else about the chart changes: seatOf, the schedule, none of it —
  // this only recomputes what the furniture hides, live.
  function moveOccluder(id, x, z) {
    const r = rects.find(o => o.id === id);
    if (!r) return null;
    const c = clampOccluder(r, x, z);
    r.x = c.x; r.z = c.z;
    for (const d of desks) d.sight = classifySight(d.target, viewpoints, rects);
    return { id: r.id, x: r.x, z: r.z };
  }

  // What the room actually looks like right now, for the next period to load.
  function occluderLayout() {
    return rects.map(r => ({ id: r.id, x: r.x, z: r.z }));
  }

  const defaultAssignment = desks.map((_, i) => i);
  let seatOf = validate(saved) || defaultAssignment.slice();

  function validate(a) {
    if (!Array.isArray(a) || a.length !== desks.length) return null;
    const seen = new Set(a);
    if (seen.size !== desks.length) return null;
    if (a.some(d => !Number.isInteger(d) || d < 0 || d >= desks.length)) return null;
    return a.slice();
  }

  const deskOf = i => desks[seatOf[i]];
  const studentAt = deskIndex => seatOf.indexOf(deskIndex);

  function assign(a) {
    const ok = validate(a);
    if (ok) seatOf = ok;
    return !!ok;
  }
  function reset() { seatOf = defaultAssignment.slice(); }
  function swapDesks(dA, dB) {
    const a = studentAt(dA), b = studentAt(dB);
    if (a < 0 || b < 0 || a === b) return false;
    seatOf[a] = dB; seatOf[b] = dA;
    return true;
  }

  // ---- who can reach whom -------------------------------------------------
  // Side by side is the loud one. In front / behind is next. Diagonal is the
  // one people forget about, which is why it is worth half.
  function adjacency(i, j) {
    if (i === j || i == null || j == null) return 0;
    const a = deskOf(i), b = deskOf(j);
    const dc = Math.abs(a.col - b.col), dr = Math.abs(a.row - b.row);
    if (dc > 1 || dr > 1) return 0;
    if (dr === 0) return S.adjacency.side;
    if (dc === 0) return S.adjacency.frontBack;
    return S.adjacency.diagonal;
  }

  function neighbours(i) {
    const out = [];
    for (let j = 0; j < roster.length; j++) {
      const w = adjacency(i, j);
      if (w > 0) out.push({ index: j, weight: w, name: roster[j].name });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The strongest calming influence sitting next to this kid, ignoring anyone
  // they are currently in it with — your partner in crime is not settling you.
  function steadiestNeighbour(i, exclude = null) {
    let best = null;
    for (const n of neighbours(i)) {
      if (n.index === exclude) continue;
      const value = (roster[n.index].steady ?? 0) * n.weight;
      if (!best || value > best.value) best = { index: n.index, value, weight: n.weight };
    }
    return best;
  }

  // ---- what the chart does to the period ----------------------------------
  // Runs the authored tell schedule through the seating and returns the
  // schedule that this room, seated this way, is actually going to produce.
  function resolveSchedule(schedule) {
    const out = [], separated = [], suppressed = [], load = new Map();

    for (const row of schedule) {
      let type = row.type, seat = row.seat, seat2 = row.with, life = row.life;
      const def = tellTypes[type] || {};
      let substituted = null;

      if (seat2 != null) {
        const w = adjacency(seat, seat2);
        if (def.needsAdjacency && w < rules.minAdjacency) {
          // They cannot do this one together any more. They do not become
          // saints; the instigator finds something to do on their own, and it
          // is a duller thing that sits still where you can find it.
          const sub = rules.separationSubstitute;
          separated.push({ seat, was: type, becomes: sub.type, partner: seat2 });
          substituted = type;
          type = sub.type;
          life = Math.round(life * sub.lifeScale);
          seat2 = undefined;
        } else if (!def.needsAdjacency && w >= rules.minAdjacency) {
          // A note that only has to travel one desk is a handoff. Blink and it
          // is gone — which sounds like a win and is not one.
          life = Math.round(life * rules.handoffLifeScale);
        }
      }

      const finalDef = tellTypes[type] || {};
      const calm = finalDef.suppressible ? steadiestNeighbour(seat, seat2) : null;
      if (calm && calm.value >= rules.suppressThreshold) {
        suppressed.push({ by: calm.index, seat, type, atMinute: row.atMinute });
        load.set(calm.index, (load.get(calm.index) || 0) + 1);
        continue;                                  // it never happens. Nobody sees that.
      }

      out.push({ type, seat, seat2, atMinute: row.atMinute, life, substituted });
    }
    return { rows: out, separated, suppressed, load };
  }

  // Write the chart onto the student objects. Everything downstream — tells,
  // Room Temp quadrants, collision, the lesson — reads these.
  function apply(students, plan = null) {
    for (const s of students) {
      const d = deskOf(s.seat);
      s.desk = d.index; s.col = d.col; s.row = d.row;
      s.x = d.x; s.z = d.z; s.bodyZ = d.bodyZ;
      s.rowGain = d.rowGain;
      s.sight = d.sight.kind;
      // Not "invisible" — invisible from the spot you actually deliver from,
      // which is the one that matters when you are mid-sentence.
      s.hidden = !d.sight.from.includes(viewpoints[0].id);
      s.steadyLoad = 0;
    }
    if (plan) {
      for (const [index, count] of plan.load) {
        const s = students.find(k => k.seat === index);
        if (s) s.steadyLoad = Math.min(S.steadyLoadCap, count * S.steadyCompPenalty);
      }
    }
    return students;
  }

  // ---- "we JUST moved" ----------------------------------------------------
  function movesFrom(previous) {
    const prev = validate(previous) || defaultAssignment;
    let n = 0;
    for (let i = 0; i < seatOf.length; i++) if (seatOf[i] !== prev[i]) n++;
    return n;
  }

  // They complain about being moved from where they were sitting yesterday. A
  // chart they have never sat in is not a move, it is just the chart.
  function rechartCost(previous) {
    const novel = !validate(previous);
    const moved = movesFrom(previous);
    const billable = novel ? 0 : Math.max(0, moved - S.freeMoves);
    const rapport = Math.max(S.rapportMoveCap, billable * S.rapportPerMove);
    return { moved, billable, novel, rapport: Math.round(rapport * 10) / 10 };
  }

  // ---- what the chart is allowed to show you ------------------------------
  // Volatility edges and stabilisers are not given. They are what you saw last
  // time, handed back to you.
  function viewModel(known = { edges: [], steadies: [] }) {
    const edgeSet = new Set(known.edges || []);
    const steadySet = new Set(known.steadies || []);
    const seats = roster.map((r, i) => {
      const d = deskOf(i);
      return {
        index: i, name: r.name, note: r.note || '',
        desk: d.index, col: d.col, row: d.row, x: d.x, z: d.z,
        sight: d.sight.kind, sightFrom: d.sight.from,
        sightFromLabels: d.sight.from
          .map(id => (viewpoints.find(v => v.id === id) || {}).label || id),
        rowGain: d.rowGain,
        steadyKnown: steadySet.has(i)
      };
    });
    const edges = [];
    for (const key of edgeSet) {
      const [a, b] = key.split('-').map(Number);
      if (roster[a] && roster[b]) edges.push({ a, b, live: adjacency(a, b) >= rules.minAdjacency });
    }
    // The bits of furniture worth drawing on a paper chart, named in data.
    const byId = Object.fromEntries((room.fixtures || []).map(f => [f.id, f]));
    const furniture = plan
      .filter(f => byId[f.id])
      .map(f => ({
        id: f.id, label: f.label,
        x: byId[f.id].pos[0], z: byId[f.id].pos[2],
        w: byId[f.id].size[0], d: byId[f.id].size[2]
      }));
    const occluders = rects.map(r => ({ ...r, w: r.halfW * 2, d: r.halfD * 2 }));

    return { seats, edges, desks, furniture, occluders, viewpoints, bounds: room.bounds };
  }

  return {
    desks, defaultAssignment, viewpoints, rects,
    get seatOf() { return seatOf.slice(); },
    deskOf, studentAt, assign, reset, swapDesks,
    adjacency, neighbours, steadiestNeighbour,
    resolveSchedule, apply, movesFrom, rechartCost, viewModel,
    moveOccluder, occluderLayout
  };
}

// Edge keys are order-independent: the chart does not care who started it.
export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// What the period taught you about the room, for the next chart.
export function learnFrom({ tells = [], plan, known = { edges: [], steadies: [] }, rules }) {
  const edges = new Set(known.edges || []);
  const steadies = new Set(known.steadies || []);
  const fresh = { edges: [], steadies: [] };

  for (const t of tells) {
    if (t.born === null || t.seat2 == null) continue;
    const key = edgeKey(t.seat, t.seat2);
    if (!edges.has(key)) { edges.add(key); fresh.edges.push([t.seat, t.seat2]); }
  }
  const need = rules?.discoverSuppressAfter ?? 1;
  for (const [index, count] of (plan?.load || new Map())) {
    if (count < need || steadies.has(index)) continue;
    steadies.add(index);
    fresh.steadies.push(index);
  }
  return { known: { edges: [...edges], steadies: [...steadies] }, fresh };
}
