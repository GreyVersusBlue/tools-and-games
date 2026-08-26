// phasing.js — what gets built, and in what order.
//
// Every real school building project starts from this question and no version
// of this tool has ever been able to answer it: the money arrives in
// instalments, the school has to keep teaching while the work happens, and so
// the thing that gets drawn as one building gets built as three. A tool that
// can only price the whole thing at once is a tool that can only price the
// version nobody is building.
//
// **A phase is an ordered, named set of rooms.** That is the whole data model,
// and it is deliberately the smallest one that covers the three cases the
// wishlist named:
//
//   a storey    every room on Level 2 — `phaseByStorey` builds it in one call.
//   a wing      whatever somebody selected, which is what a wing actually is.
//   a block     a scheme's own blocks are rooms too. Since Phase 12 there is
//               one kind of room and it has an id, so "the science block" is a
//               list of ids the same as everything else is.
//
// **What is not a room's stays out of the phases.** The roof, the sitework,
// the stairs and the lift are the `shared` bucket `cost.js` already keeps
// separate, and pretending they can be split by room is how a phasing plan
// starts lying. One phase may *claim* the bucket — usually the first, because
// that is when the site gets built — and if none does it prints as its own
// row. Either way it is visible, and either way the phases plus the bucket add
// up to the whole estimate, which is the only arithmetic promise this file
// makes.
//
// Pure module: no three.js, no DOM. Exercised by test/phasing.test.mjs.

import { floorLabel } from './grid.js';
import { shapesOf, interiorPoint, shapeAt } from './shapes.js';
import {
  normalizeRates, currencySymbol, ratesSummary, assemblyEntry, assemblyLabel, rateIndex,
} from './rates.js';
import { quantities } from './cost.js';

export const MAX_PHASES = 20;
export const MAX_PHASE_ROOMS = 2000;
const MAX_NAME = 60;

const round = (n, places = 1) => {
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

// A room id, as navgraph.js and cost.js write it. Matched rather than parsed,
// because a phasing record is the one place in the file that stores a
// *reference* to a room and a malformed one has to be droppable.
const ROOM_ID = /^r\d+:s\d+$/;
export const isRoomId = (v) => typeof v === 'string' && ROOM_ID.test(v);
export const roomFloor = (id) => (isRoomId(id) ? Number(id.slice(1, id.indexOf(':'))) : -1);

export const roomIdOf = (floorIndex, shape) => `r${floorIndex}:s${shape.id}`;

export const roomIdsOnFloor = (state, floorIndex) => {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  return floor ? shapesOf(floor).map((s) => roomIdOf(floorIndex, s)) : [];
};

// Every room id in the design, in storey order. The set a phasing plan is
// checked against — an id not in here is a room somebody deleted.
export function allRoomIds(state) {
  const out = [];
  const count = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < count; i++) out.push(...roomIdsOnFloor(state, i));
  return out;
}

// ---------- the record ----------

const text = (v, max = MAX_NAME) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};

export const emptyPhasing = () => ({ phases: [] });

export const isEmptyPhasing = (p) => !p || !Array.isArray(p.phases) || p.phases.length === 0;

// Ids are positional — `p1`, `p2`, … assigned on normalize. A phasing plan is
// a short ordered list edited in place, so position *is* identity; giving it a
// second, allocated identity would mean an id allocator, a save field and a
// class of bug (two phases, one id) in exchange for nothing.
export function normalizePhasing(raw) {
  if (!raw || typeof raw !== 'object') return emptyPhasing();
  const phases = [];
  const claimed = new Set();
  let sharedTaken = false;
  for (const p of Array.isArray(raw.phases) ? raw.phases : []) {
    if (phases.length >= MAX_PHASES) break;
    if (!p || typeof p !== 'object') continue;
    const rooms = [];
    for (const id of Array.isArray(p.rooms) ? p.rooms : []) {
      if (rooms.length >= MAX_PHASE_ROOMS) break;
      // A room belongs to exactly one phase. Two phases that both claim it
      // would be a plan that builds the same wall twice, and the earlier
      // phase is the one that meant it.
      if (!isRoomId(id) || claimed.has(id)) continue;
      claimed.add(id);
      rooms.push(id);
    }
    const shared = !sharedTaken && p.shared === true;
    if (shared) sharedTaken = true;
    phases.push({
      id: `p${phases.length + 1}`,
      name: text(p.name) || `Phase ${phases.length + 1}`,
      note: text(p.note, 200),
      rooms,
      shared,
    });
  }
  return { phases };
}

export const phasingOf = (state) => normalizePhasing(state && state.phasing);

// One phase per storey, ground first — the plan nine out of ten buildings get
// phased on, and the one worth a button. The first phase claims the shared
// bucket: the site is built when the site is built.
export function phaseByStorey(state) {
  const count = state && state.floors ? state.floors.length : 0;
  const phases = [];
  for (let i = 0; i < count; i++) {
    phases.push({
      name: floorLabel(i),
      rooms: roomIdsOnFloor(state, i),
      shared: i === 0,
      note: i === 0 ? 'Site, roof and vertical circulation ride with this phase.' : null,
    });
  }
  return normalizePhasing({ phases });
}

// ---------- editing ----------

export function addPhase(phasing, name = null) {
  const out = normalizePhasing(phasing);
  if (out.phases.length >= MAX_PHASES) return out;
  out.phases.push({
    id: `p${out.phases.length + 1}`,
    name: text(name) || `Phase ${out.phases.length + 1}`,
    note: null,
    rooms: [],
    shared: out.phases.length === 0,
  });
  return normalizePhasing(out);
}

export function removePhase(phasing, id) {
  const out = normalizePhasing(phasing);
  return normalizePhasing({ phases: out.phases.filter((p) => p.id !== id) });
}

// Up or down one place. Order is the plan, so this is the edit that gets used
// most and the one that has to keep every room where it was.
export function movePhase(phasing, id, delta) {
  const out = normalizePhasing(phasing);
  const i = out.phases.findIndex((p) => p.id === id);
  const j = i + (delta < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= out.phases.length) return out;
  const list = out.phases.slice();
  [list[i], list[j]] = [list[j], list[i]];
  return normalizePhasing({ phases: list });
}

export function renamePhase(phasing, id, name) {
  const out = normalizePhasing(phasing);
  const p = out.phases.find((q) => q.id === id);
  if (p) p.name = text(name) || p.name;
  return out;
}

// Which phase carries the roof, the site and the lifts — or none of them, in
// which case the bucket prints on its own. Passing the id that already has it
// clears it, which is what a toggle in a panel wants.
export function claimShared(phasing, id) {
  const out = normalizePhasing(phasing);
  const had = out.phases.find((p) => p.shared);
  for (const p of out.phases) p.shared = false;
  if (!had || had.id !== id) {
    const p = out.phases.find((q) => q.id === id);
    if (p) p.shared = true;
  }
  return out;
}

// Put rooms in a phase, taking them out of whichever phase had them. Passing
// null for `id` un-assigns them, which is how a room comes back out of a plan.
export function assignRooms(phasing, id, roomIds) {
  const out = normalizePhasing(phasing);
  const ids = (Array.isArray(roomIds) ? roomIds : [roomIds]).filter(isRoomId);
  if (!ids.length) return out;
  const set = new Set(ids);
  for (const p of out.phases) p.rooms = p.rooms.filter((r) => !set.has(r));
  const target = out.phases.find((p) => p.id === id);
  if (target) for (const r of ids) if (target.rooms.length < MAX_PHASE_ROOMS) target.rooms.push(r);
  return normalizePhasing(out);
}

// Rooms that were deleted out from under a plan. Called on load and after any
// edit that removes a room, because a phase holding an id nothing answers to
// is a phase whose cost silently shrank.
export function pruneToDesign(phasing, state) {
  const live = new Set(allRoomIds(state));
  const out = normalizePhasing(phasing);
  for (const p of out.phases) p.rooms = p.rooms.filter((r) => live.has(r));
  return out;
}

// ---------- pricing a plan ----------

const tally = () => new Map();
const addQty = (map, key, qty) => {
  if (!key || !(qty > 0)) return;
  map.set(key, (map.get(key) || 0) + qty);
};

function priceTally(map, rates) {
  const idx = rateIndex(rates);
  const lines = [];
  let cost = 0;
  for (const [key, qty] of map) {
    const a = assemblyEntry(key);
    const row = idx.get(key) || null;
    const rate = row ? row.rate : null;
    const c = rate === null ? 0 : rate * qty;
    cost += c;
    lines.push({
      key, label: assemblyLabel(key), system: a ? a.system : 'other',
      unit: a ? a.unit : '', qty, rate, priced: rate !== null, cost: c,
    });
  }
  lines.sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
  return { lines, cost };
}

// The room a room sits on. Used only by the out-of-order check below, and it
// asks the model the same way everything else does: take the room's own
// interior point and ask the storey underneath what is there.
function roomBelow(state, id) {
  const floorIndex = roomFloor(id);
  if (floorIndex <= 0) return null;
  const floor = state.floors[floorIndex];
  const under = state.floors[floorIndex - 1];
  if (!floor || !under) return null;
  const shapeId = Number(id.slice(id.indexOf(':') + 2));
  const shape = shapesOf(floor).find((s) => s.id === shapeId);
  if (!shape) return null;
  const p = interiorPoint(shape);
  const below = shapeAt(under, p.x, p.z);
  return below ? roomIdOf(floorIndex - 1, below) : null;
}

// The plan, priced, in order. Every phase gets its own quantities and its own
// cost — which is the point — plus the running total, because "what does it
// cost to have got this far" is the question a funding schedule is written
// against.
export function phasingCosts(state, opts = {}) {
  const phasing = pruneToDesign(opts.phasing || phasingOf(state), state);
  const rates = normalizeRates(opts.rates !== undefined ? opts.rates : (state && state.rates));
  const q = opts.quantities || quantities(state, opts);

  // Room lines, by id, across every storey — plus the per-storey `loose`
  // tally, which is cost.js's name for what could not be pinned on a room and
  // therefore belongs with the shared bucket rather than with a phase.
  const roomLines = new Map();
  const roomArea = new Map();
  const roomName = new Map();
  const sharedQty = tally();
  for (const f of q.floors) {
    for (const r of f.rooms) {
      roomLines.set(r.id, r.lines);
      roomArea.set(r.id, r.area);
      roomName.set(r.id, r.name);
    }
    for (const [k, v] of f.loose) addQty(sharedQty, k, v);
  }
  for (const [k, v] of q.shared) addQty(sharedQty, k, v);

  const assigned = new Set();
  const phases = phasing.phases.map((p) => {
    const map = tally();
    let area = 0;
    for (const id of p.rooms) {
      const lines = roomLines.get(id);
      if (!lines) continue;
      assigned.add(id);
      area += roomArea.get(id) || 0;
      for (const [k, v] of lines) addQty(map, k, v);
    }
    return { ...p, map, area, rooms: p.rooms.filter((id) => roomLines.has(id)) };
  });

  const unassigned = [...roomLines.keys()].filter((id) => !assigned.has(id));
  const sharedPriced = priceTally(sharedQty, rates);

  const rows = [];
  let running = 0;
  let runningArea = 0;
  for (const p of phases) {
    const priced = priceTally(p.map, rates);
    let cost = priced.cost;
    let lines = priced.lines;
    if (p.shared) {
      const merged = tally();
      for (const [k, v] of p.map) addQty(merged, k, v);
      for (const [k, v] of sharedQty) addQty(merged, k, v);
      const both = priceTally(merged, rates);
      cost = both.cost;
      lines = both.lines;
    }
    running += cost;
    runningArea += p.area;
    rows.push({
      id: p.id,
      name: p.name,
      note: p.note,
      shared: p.shared,
      rooms: p.rooms.length,
      roomIds: p.rooms,
      area: p.area,
      cost,
      perSqft: p.area > 0 ? cost / p.area : 0,
      lines,
      // What it has cost to have got this far. A funding schedule is written
      // against this column, not against the one to its left.
      cumulative: running,
      cumulativeArea: runningArea,
    });
  }

  const orphanRow = unassigned.length ? (() => {
    const map = tally();
    let area = 0;
    for (const id of unassigned) {
      area += roomArea.get(id) || 0;
      for (const [k, v] of roomLines.get(id)) addQty(map, k, v);
    }
    const priced = priceTally(map, rates);
    return {
      id: 'unassigned', name: 'Not in any phase', note: null, shared: false,
      rooms: unassigned.length, roomIds: unassigned, area,
      cost: priced.cost, perSqft: area > 0 ? priced.cost / area : 0,
      lines: priced.lines, cumulative: null, cumulativeArea: null,
    };
  })() : null;

  const sharedRow = phases.some((p) => p.shared) ? null : {
    id: 'shared', name: 'Shared & sitework', note: null, shared: true,
    rooms: 0, roomIds: [], area: 0,
    cost: sharedPriced.cost, perSqft: 0, lines: sharedPriced.lines,
    cumulative: null, cumulativeArea: null,
  };

  const total = rows.reduce((n, r) => n + r.cost, 0)
    + (orphanRow ? orphanRow.cost : 0) + (sharedRow ? sharedRow.cost : 0);

  return {
    has: !isEmptyPhasing(phasing),
    phasing,
    rows,
    unassigned: orphanRow,
    shared: sharedRow,
    sharedCost: sharedPriced.cost,
    total,
    currency: rates.currency,
    symbol: currencySymbol(rates.currency),
    summary: {
      phases: rows.length,
      rooms: assigned.size,
      unassigned: unassigned.length,
      area: rows.reduce((n, r) => n + r.area, 0),
      total,
      biggest: rows.slice().sort((a, b) => b.cost - a.cost)[0] || null,
      rates: ratesSummary(rates),
    },
    findings: phasingFindings(state, phasing, rows, unassigned, roomName),
  };
}

// ---------- findings ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function phasingFindings(state, phasing, rows, unassigned, roomName) {
  const out = [];
  if (isEmptyPhasing(phasing)) {
    out.push({
      level: 'note', code: 'no-phasing',
      title: 'No phasing plan — the whole building at once',
      detail: 'Every number here assumes the school is built in one go. If the ' +
        'money arrives in instalments, or the school has to keep teaching ' +
        'through the work, say which rooms are in which phase and each one ' +
        'gets its own takeoff and its own cost.',
    });
    return out;
  }
  if (unassigned.length) {
    const named = unassigned.map((id) => roomName.get(id)).filter(Boolean).slice(0, 4);
    out.push({
      level: 'warn', code: 'unphased-rooms',
      title: `${plural(unassigned.length, 'room', 'rooms')} in no phase at all`,
      detail: (named.length ? `${named.join(', ')}${unassigned.length > named.length ? ' and others' : ''} ` : '') +
        'never get built by this plan. Their cost is listed separately rather ' +
        'than folded into a phase, because a plan that quietly drops a wing is ' +
        'worse than one that says it did.',
      rooms: unassigned.slice(0, 8),
    });
  }
  const empty = rows.filter((r) => r.rooms === 0 && !r.shared);
  if (empty.length) {
    out.push({
      level: 'note', code: 'empty-phase',
      title: `${plural(empty.length, 'phase', 'phases')} with nothing in them`,
      detail: `${empty.map((r) => r.name).join(', ')} — no rooms assigned yet.`,
    });
  }

  // The one buildability check this file can honestly make: a room cannot be
  // built before the room holding it up. `roomBelow` asks the storey
  // underneath what is at this room's own interior point, which is the same
  // question `buildingOverhang` asks about the whole footprint — so a room
  // that overhangs into thin air is already somebody else's finding.
  const phaseOf = new Map();
  rows.forEach((r, i) => { for (const id of r.roomIds) phaseOf.set(id, i); });
  const inverted = [];
  for (const [id, i] of phaseOf) {
    const below = roomBelow(state, id);
    if (!below) continue;
    const j = phaseOf.get(below);
    if (j === undefined || j <= i) continue;
    inverted.push({ id, below, phase: rows[i].name, after: rows[j].name });
  }
  if (inverted.length) {
    const first = inverted[0];
    out.push({
      level: 'fail', code: 'phase-order',
      title: `${plural(inverted.length, 'room', 'rooms')} scheduled before what holds them up`,
      detail: `${roomName.get(first.id) || first.id} is in ${first.phase}, and the ` +
        `room underneath it (${roomName.get(first.below) || first.below}) is not ` +
        `built until ${first.after}. Reorder the phases, or move the room.`,
      rooms: inverted.slice(0, 8),
    });
  }
  if (!rows.some((r) => r.shared)) {
    out.push({
      level: 'note', code: 'shared-unclaimed',
      title: 'Roof, sitework and lifts are in no phase',
      detail: 'They are listed on their own row rather than split across the ' +
        'phases, because splitting them by room would be an invention. Give ' +
        'one phase the shared bucket if the plan has an answer.',
    });
  }
  return out;
}

// ---------- the spreadsheet ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export function phasingCSV(plan) {
  const rows = [['Phasing', '', '', '', '', '']];
  rows.push(['Phase', 'Rooms', 'Area ft²', 'Cost', 'Per ft²', 'Cumulative']);
  for (const r of plan.rows) {
    rows.push([r.name + (r.shared ? ' (carries shared & sitework)' : ''),
      r.rooms, round(r.area), round(r.cost), round(r.perSqft, 2), round(r.cumulative)]);
  }
  if (plan.shared) {
    rows.push([plan.shared.name, '', '', round(plan.shared.cost), '', '']);
  }
  if (plan.unassigned) {
    rows.push([plan.unassigned.name, plan.unassigned.rooms, round(plan.unassigned.area),
      round(plan.unassigned.cost), round(plan.unassigned.perSqft, 2), '']);
  }
  rows.push(['Total', '', round(plan.summary.area), round(plan.total), '', '']);
  rows.push([]);

  rows.push(['Phase', 'Assembly', 'Quantity', 'Unit', 'Rate', 'Cost']);
  for (const r of plan.rows) {
    for (const l of r.lines) {
      rows.push([r.name, l.label, round(l.qty), l.unit,
        l.priced ? l.rate : 'no rate', l.priced ? round(l.cost) : '']);
    }
  }
  return csvRows(rows);
}
