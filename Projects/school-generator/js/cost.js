// cost.js — what it costs, and which room it costs it in.
//
// The takeoff counts what is drawn. The rate table says what a unit of it is
// worth. This is the multiplication, and almost all of the interesting work is
// in one question the multiplication doesn't answer on its own: **whose cost
// is this?**
//
// A number without a decomposition is a number nobody can act on. "Four point
// one million dollars" is not a finding; "the gym is eleven percent of it and
// nine tenths of that is the roof over it" is. So every quantity here is
// attributed to a room where a room can honestly own it:
//
//   slab, floor finish       the room's own area — exact.
//   partitions, glazing      probed for the room on each side and split
//                            between them, because a wall between two
//                            classrooms belongs to both. The probe is
//                            finish.js's `wallPaint` probe, at walls.js's own
//                            distance, so "which room is this wall's" gets the
//                            same answer as "what colour is this wall".
//   doors and windows        probed the same way, at the opening's midpoint.
//   furniture                `shapeAt` on the prop's own position.
//
// ...and everything that genuinely isn't a room's — the roof, the site, the
// stairs and the lift — is left in a `shared` bucket rather than smeared over
// the rooms pro rata. Smearing would make every room's number look precise and
// none of them be. A shared bucket is honest and it is also what a phasing
// plan needs, which is the next file along.
//
// **The quantities are the takeoff's quantities.** Wall runs come from
// `computeFloorPlan`, the same call `takeoff.js` reads, so the wall the
// drawing prints is the wall the schedule prices *and* the wall the estimate
// charges to a room — the third link in the chain Phase 7 started.
//
// Pure module: no three.js, no DOM. Exercised by test/cost.test.mjs.

import { CELL, WALL_H, floorLabel, wallHeightOf } from './grid.js';
import { WALL_T_EXT, PROBE } from './walls.js';
import { shapesOf, shapeArea, shapeAt } from './shapes.js';
import { readFinish, DEFAULT_FINISH } from './finish.js';
import { propsOnFloor } from './props.js';
import { catalogEntry as defaultCatalogEntry } from './catalog.js';
import { computeFloorPlan } from './blueprint.js';
import { normalizeRoof, ensureRoof, roofStyleEntry, roofMask, maskCount } from './roof.js';
import { siteSchedule, regionsOf, markingEntry } from './site.js';
import { stairsOf, stairMetrics, runMetrics, stairWidth, isRun, isElevator } from './stairs.js';
import {
  assemblyKey, assemblyEntry, assemblyLabel, systemEntry,
  normalizeRates, rateIndex, ratesSummary, isEmptyRates, currencySymbol, SYSTEMS,
} from './rates.js';
import { csvRows } from './csv.js';

const round = (n, places = 1) => {
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

const isExterior = (t) => t >= WALL_T_EXT - 0.001;

// ---------- a tally ----------

// Quantities keyed by assembly. A plain Map with an `add` in front of it,
// because every accumulator below wants the same three lines.
const tally = () => new Map();
const add = (map, key, qty) => {
  if (!key || !(qty > 0)) return;
  map.set(key, (map.get(key) || 0) + qty);
};
const merge = (into, from) => { for (const [k, v] of from) add(into, k, v); };

// ---------- who owns a wall ----------

// The rooms on either side of a boundary. One for an exterior wall, two for a
// partition, and — occasionally — none, when a free-standing wall has been
// drawn with nothing behind it either way. `walls.js` calls that case exterior
// and so does this: the cost goes to the storey rather than to a room.
function roomsBeside(floor, ax, az, bx, bz, probe = PROBE) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [];
  const mx = ax + dx / 2, mz = az + dz / 2;
  const nx = (-dz / len) * probe, nz = (dx / len) * probe;
  const a = shapeAt(floor, mx + nx, mz + nz);
  const b = shapeAt(floor, mx - nx, mz - nz);
  const out = [];
  if (a) out.push(a);
  if (b && b !== a) out.push(b);
  return out;
}

// ---------- one storey, room by room ----------

export function floorQuantities(state, floorIndex, opts = {}) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  const plan = opts.plan || computeFloorPlan(state, floorIndex);
  const height = wallHeightOf(state, floorIndex);
  const facade = normalizeRoof(state.roof || ensureRoof(state)).facade;

  const rooms = new Map();
  const room = (shape) => {
    const id = `r${floorIndex}:s${shape.id}`;
    let r = rooms.get(id);
    if (!r) {
      r = {
        id, floor: floorIndex, shapeId: shape.id,
        name: shape.name || null,
        area: shapeArea(shape),
        lines: tally(),
      };
      rooms.set(id, r);
    }
    return r;
  };
  // What could not be pinned on a room: a wall with air on both sides, a prop
  // dropped in a corridor that isn't a room. It stays on the storey.
  const loose = tally();

  // Slab and floor finish, exactly: a room's own area, twice.
  for (const shape of shapesOf(floor)) {
    const r = room(shape);
    add(r.lines, 'slab', r.area);
    add(r.lines, assemblyKey('finish', readFinish(shape.fin) || DEFAULT_FINISH), r.area);
  }

  // Walls. The run is as drawn — doorways already cut out of it, because the
  // plan cut them out of it — and the area is that run times the storey's own
  // wall height.
  for (const w of plan.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (len < 0.01) continue;
    const ext = isExterior(w.t);
    const area = len * height;
    const owners = roomsBeside(floor, w.ax, w.az, w.bx, w.bz);
    const into = owners.length ? owners.map((s) => room(s).lines) : [loose];
    const each = (key, qty) => { for (const m of into) add(m, key, qty / into.length); };

    if (w.kind === 'glass') each(ext ? 'glazing' : 'wall-glass', area);
    else if (w.kind === 'rail') each('wall-rail', len);
    else each(ext ? assemblyKey('facade', facade) : 'wall-int', area);

    // Paint goes on both faces of a partition and on the inside face of an
    // exterior wall. Same rule as `takeoff.js`'s `paintArea`, including its
    // one oddity — a guardrail's face counts — because two panels in the same
    // tool printing two different square footages of paint is worse than one
    // guardrail priced as if somebody rolled it.
    if (w.kind !== 'glass') each('paint', area * (ext ? 1 : 2));
  }

  // Openings, at the midpoint of the gap they cut.
  for (const o of plan.doors) {
    const mx = o.hx + o.ux * (o.w / 2), mz = o.hz + o.uz * (o.w / 2);
    const nx = -o.uz * PROBE, nz = o.ux * PROBE;
    const a = shapeAt(floor, mx + nx, mz + nz);
    const b = shapeAt(floor, mx - nx, mz - nz);
    const owners = [a, b && b !== a ? b : null].filter(Boolean);
    const into = owners.length ? owners.map((s) => room(s).lines) : [loose];
    // `leaves` is the list of swinging panels the plan drew, so its length is
    // the leaf count `takeoff.js` groups a schedule by: two is a pair, one is
    // a single, none is a cased opening.
    const leaves = o.leaves ? o.leaves.length : 0;
    const key = o.kind === 'window'
      ? 'window'
      : assemblyKey('door', leaves === 2 ? 'double' : leaves === 1 ? 'single' : 'cased');
    for (const m of into) add(m, key, 1 / into.length);
  }

  // Furniture, by catalog category — the shape of a purchasing schedule, and
  // not four hundred rows of "one stacking chair".
  for (const p of propsOnFloor(state, floorIndex)) {
    const entry = catalogGet(p.type);
    const key = assemblyKey('furniture', (entry && entry.category) || 'Unknown');
    const shape = shapeAt(floor, p.x, p.z);
    add(shape ? room(shape).lines : loose, key, 1);
  }

  const list = [...rooms.values()];
  const lines = tally();
  for (const r of list) merge(lines, r.lines);
  merge(lines, loose);
  return {
    floor: floorIndex,
    label: floorLabel(floorIndex),
    height,
    rooms: list,
    loose,
    lines,
    area: list.reduce((n, r) => n + r.area, 0),
  };
}

// ---------- what belongs to no room ----------

// The roof, the ground and the vertical. Every one of these is a fact about
// the building rather than about a room in it, and pretending otherwise is how
// an estimate ends up saying a classroom costs $310/ft² because it happened to
// be under the gym roof.
export function sharedQuantities(state) {
  const out = tally();
  const top = state && state.floors ? state.floors[state.floors.length - 1] : null;
  if (top) {
    const roof = normalizeRoof(state.roof || ensureRoof(state));
    const entry = roofStyleEntry(roof.style);
    const footprint = maskCount(roofMask(top, top.w, top.h)) * CELL * CELL;
    const slope = entry.pitched ? Math.hypot(12, roof.pitch) / 12 : 1;
    add(out, assemblyKey('roof', entry.pitched ? 'shingle' : 'membrane'), footprint * slope);
  }
  for (const s of siteSchedule(state)) add(out, assemblyKey('paving', s.key), s.sqft);
  const marks = new Map();
  for (const r of regionsOf(state)) {
    if (!r.mark || !markingEntry(r.mark)) continue;
    marks.set(r.mark, (marks.get(r.mark) || 0) + 1);
  }
  for (const [key, n] of marks) add(out, assemblyKey('marking', key), n);

  const metrics = stairMetrics(state);
  for (const link of stairsOf(state)) {
    if (isElevator(link)) { add(out, 'elevator', 1); continue; }
    if (!isRun(link)) continue;               // a plain floor opening costs a hole, not money
    if (link.type === 'ramp') {
      const m = runMetrics(link, metrics);
      add(out, 'ramp', stairWidth(link) * m.run);
      continue;
    }
    add(out, 'stair', 1);
  }
  return out;
}

// ---------- pricing ----------

// One priced line. `priced` is the field that matters: a rate of zero is "this
// costs nothing", no rate at all is "nobody has said", and a reader that
// conflates the two prints a total that is missing a roof without saying so.
function priceLines(quantities, rates) {
  const idx = rateIndex(rates);
  const out = [];
  for (const [key, qty] of quantities) {
    const a = assemblyEntry(key);
    const row = idx.get(key) || null;
    const rate = row ? row.rate : null;
    out.push({
      key,
      label: assemblyLabel(key),
      system: a ? a.system : 'other',
      unit: a ? a.unit : (row && row.unit) || '',
      qty,
      rate,
      priced: rate !== null,
      cost: rate === null ? 0 : rate * qty,
      date: row ? (row.date || rates.date) : null,
      source: row ? (row.source || rates.source) : null,
    });
  }
  return out.sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}

const totalOf = (lines) => lines.reduce((n, l) => n + l.cost, 0);

// The three or four lines that explain a number. "What is driving each" — the
// phase's own words — is the top of the room's own decomposition, and the tail
// is rolled into one row rather than truncated, so the parts still add up.
function drivers(lines, keep = 3) {
  const priced = lines.filter((l) => l.cost > 0);
  if (priced.length <= keep + 1) return priced;
  const head = priced.slice(0, keep);
  const rest = priced.slice(keep);
  return [...head, {
    key: '…', label: `${rest.length} more`, system: 'other', unit: '',
    qty: 0, rate: null, priced: true, cost: totalOf(rest),
  }];
}

// ---------- the whole estimate ----------

// Every quantity in the design, attributed, with no prices anywhere near it.
// Split out from `costing` because the spec sheet wants exactly this and has
// no business requiring somebody to have filled in a rate table first.
export function quantities(state, opts = {}) {
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  const floors = [];
  const count = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < count; i++) {
    const f = floorQuantities(state, i, { catalogGet, plan: opts.plans ? opts.plans[i] : null });
    if (f) floors.push(f);
  }
  const shared = sharedQuantities(state);
  const all = tally();
  for (const f of floors) merge(all, f.lines);
  merge(all, shared);
  return { floors, shared, all, area: floors.reduce((n, f) => n + f.area, 0) };
}

export function costing(state, opts = {}) {
  const rates = normalizeRates(opts.rates !== undefined ? opts.rates : (state && state.rates));
  const summaryOfRates = ratesSummary(rates);
  const q = opts.quantities || quantities(state, opts);
  const { floors, shared, all } = q;

  const lines = priceLines(all, rates);
  const sharedLines = priceLines(shared, rates);
  // What is on a storey but in no room on it: a length of exterior wall with
  // open air on both probes, a bench dropped on the lawn. Small, and worth a
  // number of its own — otherwise the per-room table quietly fails to add up
  // and nobody can say by how much.
  const looseLines = priceLines((() => {
    const m = tally();
    for (const f of floors) merge(m, f.loose);
    return m;
  })(), rates);
  const total = totalOf(lines);

  const byStorey = floors.map((f) => {
    const fl = priceLines(f.lines, rates);
    const cost = totalOf(fl);
    return {
      floor: f.floor,
      label: f.label,
      area: f.area,
      cost,
      perSqft: f.area > 0 ? cost / f.area : 0,
      lines: fl,
    };
  });

  const byRoom = [];
  for (const f of floors) {
    for (const r of f.rooms) {
      const rl = priceLines(r.lines, rates);
      const cost = totalOf(rl);
      byRoom.push({
        id: r.id,
        floor: r.floor,
        shapeId: r.shapeId,
        name: r.name,
        area: r.area,
        cost,
        perSqft: r.area > 0 ? cost / r.area : 0,
        share: total > 0 ? cost / total : 0,
        lines: rl,
        drivers: drivers(rl),
      });
    }
  }
  byRoom.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));

  const bySystem = SYSTEMS.map((s) => {
    const sl = lines.filter((l) => l.system === s.key);
    const cost = totalOf(sl);
    return { system: s.key, label: s.label, cost, share: total > 0 ? cost / total : 0, lines: sl };
  }).filter((s) => s.lines.length).sort((a, b) => b.cost - a.cost);

  // Everything with a quantity and no rate. This is the list the phase means
  // by "says loudly what it does not know", and it is printed before the
  // total rather than after it.
  const unpriced = lines.filter((l) => !l.priced)
    .map((l) => ({ key: l.key, label: l.label, qty: l.qty, unit: l.unit, system: l.system }));

  const area = q.area;
  const summary = {
    has: !isEmptyRates(rates),
    currency: rates.currency,
    symbol: currencySymbol(rates.currency),
    total,
    area,
    perSqft: area > 0 ? total / area : 0,
    assemblies: lines.length,
    priced: lines.filter((l) => l.priced).length,
    unpriced: unpriced.length,
    shared: totalOf(sharedLines),
    loose: totalOf(looseLines),
    // The share of the estimate nobody can attribute to a room. High is not
    // wrong — a small building on a large site really is mostly sitework —
    // but it is the number that says how much of the per-room table to trust.
    sharedShare: total > 0 ? totalOf(sharedLines) / total : 0,
    worst: byRoom[0] || null,
    rates: summaryOfRates,
  };

  return {
    has: summary.has,
    rates,
    lines,
    bySystem,
    byStorey,
    byRoom,
    // Worst first, the same editorial rule the report applies to everything
    // else. Five, because that is how many a person reads.
    worstRooms: byRoom.slice(0, 5),
    shared: sharedLines,
    loose: looseLines,
    unpriced,
    summary,
    findings: costFindings({ rates: summaryOfRates, unpriced, summary, lines }),
  };
}

// ---------- findings ----------

// English, badly, but correctly for the four words this file uses it on.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function costFindings({ rates, unpriced, summary, lines }) {
  const out = [];
  if (rates.empty) {
    out.push({
      level: 'note', code: 'no-rates',
      title: 'No rate table, so nothing is priced',
      detail: 'This tool does not know what a square foot of anything costs where ' +
        'you are building. Give it a rate table — dated, sourced, saved with the ' +
        'design — and every number below gets a price beside it.',
    });
    return out;
  }
  if (rates.example) {
    out.push({
      level: 'warn', code: 'example-rates',
      title: 'The prices are still the worked example',
      detail: 'Nobody has changed a rate yet. The shipped numbers are ' +
        'order-of-magnitude US figures dated ' + rates.newest + ', they are not a ' +
        'bid, and they are not local to you. Every total on this page inherits that.',
    });
  }
  if (unpriced.length) {
    const worst = [...unpriced].sort((a, b) => b.qty - a.qty)[0];
    out.push({
      level: 'warn', code: 'unpriced',
      title: `${plural(unpriced.length, 'assembly', 'assemblies')} in the building with no rate`,
      detail: `The largest is ${worst.label} at ${round(worst.qty)} ${worst.unit}. ` +
        'Unpriced work is counted as zero, so the total below is a floor rather ' +
        'than an estimate.',
      rows: unpriced.slice(0, 8),
    });
  }
  const undated = lines.filter((l) => l.priced && !l.date).length;
  if (undated) {
    out.push({
      level: 'note', code: 'undated-rates',
      title: `${plural(undated, 'rate', 'rates')} with no date on them`,
      detail: 'A unit price is only true on a day. An undated rate is one nobody ' +
        'can check against a market, and it will still be here in three years.',
    });
  }
  const unsourced = lines.filter((l) => l.priced && !l.source).length;
  if (unsourced) {
    out.push({
      level: 'note', code: 'unsourced-rates',
      title: `${plural(unsourced, 'rate', 'rates')} with no source`,
      detail: 'Where a number came from is half of what it means — a bid, a ' +
        'published table, a guess. Say which.',
    });
  }
  if (summary.sharedShare > 0.4 && summary.total > 0) {
    out.push({
      level: 'note', code: 'shared-heavy',
      title: `${Math.round(summary.sharedShare * 100)}% of the cost is not in any room`,
      detail: 'Roof, sitework and vertical circulation belong to the building ' +
        'rather than to a room, and they are left out of the per-room table ' +
        'rather than smeared over it. At this share the room numbers describe ' +
        'less than half the money.',
    });
  }
  return out;
}

// ---------- the spreadsheet ----------


// The estimate as a spreadsheet: the table that priced it first, because a
// column of costs whose rates nobody can see is a column of costs nobody can
// argue with.
export function costCSV(cost) {
  const rows = [];
  const cur = cost.summary.currency;
  rows.push(['Cost estimate', '', '', '', '', '']);
  rows.push(['Currency', cur, '', '', '', '']);
  if (cost.rates.source) rows.push(['Rates from', cost.rates.source, '', '', '', '']);
  if (cost.rates.date) rows.push(['Rates dated', cost.rates.date, '', '', '', '']);
  if (cost.summary.rates.example) {
    rows.push(['WARNING', 'These are the shipped worked-example rates, not a quote.',
      '', '', '', '']);
  }
  rows.push(['Total', round(cost.summary.total), cur,
    `${round(cost.summary.perSqft, 2)} per ft²`, '', '']);
  rows.push(['Unpriced assemblies', cost.summary.unpriced, '',
    'counted as zero', '', '']);
  rows.push([]);

  rows.push(['System', 'Cost', 'Share %', '', '', '']);
  for (const s of cost.bySystem) {
    rows.push([s.label, round(s.cost), round(s.share * 100, 1), '', '', '']);
  }
  rows.push([]);

  rows.push(['Storey', 'Area ft²', 'Cost', 'Per ft²', '', '']);
  for (const f of cost.byStorey) {
    rows.push([f.label, round(f.area), round(f.cost), round(f.perSqft, 2), '', '']);
  }
  rows.push([]);

  rows.push(['Assembly', 'System', 'Quantity', 'Unit', 'Rate', 'Cost',
    'Rate dated', 'Rate source']);
  for (const l of cost.lines) {
    rows.push([l.label, systemEntry(l.system).label, round(l.qty), l.unit,
      l.priced ? l.rate : 'no rate', l.priced ? round(l.cost) : '',
      l.date || '', l.source || '']);
  }
  rows.push([]);

  rows.push(['Room', 'Level', 'Area ft²', 'Cost', 'Per ft²', 'Share %',
    'Driven by', '', '', '']);
  for (const r of cost.byRoom) {
    rows.push([
      r.name || '(unnamed)', floorLabel(r.floor), round(r.area), round(r.cost),
      round(r.perSqft, 2), round(r.share * 100, 1),
      r.drivers.map((d) => `${d.label} ${round(d.cost)}`).join(' · '), '', '', '',
    ]);
  }
  rows.push([]);

  rows.push(['Not in any room', 'Quantity', 'Unit', 'Rate', 'Cost', '']);
  for (const l of cost.shared) {
    rows.push([l.label, round(l.qty), l.unit, l.priced ? l.rate : 'no rate',
      l.priced ? round(l.cost) : '', '']);
  }
  for (const l of cost.loose) {
    rows.push([`${l.label} (on a storey, in no room)`, round(l.qty), l.unit,
      l.priced ? l.rate : 'no rate', l.priced ? round(l.cost) : '', '']);
  }
  return csvRows(rows);
}

export { round as roundMoney, WALL_H };
