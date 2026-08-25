// report.js — the whole analysis, in one call.
//
// Phase 7's readers each answer one question: how many people, how far to the
// door, can a wheelchair get there, is there enough glass, how long does the
// room ring, what is it made of. This composes them, because every one of them
// wants the same nav graph and the same occupant loads and building six of
// each is six times the work for the same answer.
//
// It is also where the findings become *a* finding list — one flat, sorted,
// levelled list a panel can print top-down and a reader can scan. The house
// style throughout Phase 7 is that a check says what rule it applied and what
// it measured; the ordering here says which of them to read first.
//
// The one section with no module of its own is acoustics, and deliberately:
// `roomsOnFloor` has existed since Phase 4 with a comment saying it was
// written for this report. All that was missing was somebody to call it.
//
// Pure module: no three.js, no DOM. Exercised by test/report.test.mjs.

import { floorLabel } from './grid.js';
import { catalogEntry as defaultCatalogEntry } from './catalog.js';
import { buildNav, navSummary } from './navgraph.js';
import { buildingOccupancy } from './occupancy.js';
import { egressAnalysis, accessibleAnalysis } from './egress.js';
import { daylightAnalysis } from './daylight.js';
import { takeoff, takeoffCSV, csvRows } from './takeoff.js';
import { roomsOnFloor } from './acoustics.js';

// Worst first. A panel prints this order and a title block prints the first
// row of it, so it is the one piece of editorial judgement in the phase.
export const LEVELS = ['fail', 'warn', 'note', 'ok'];
const rank = (level) => {
  const i = LEVELS.indexOf(level);
  return i < 0 ? LEVELS.length : i;
};

// ---------- acoustics, as a section ----------

const navRoomId = (floorIndex, ac) => (ac.kind === 'shape'
  ? `r${floorIndex}:s${ac.id.slice(1)}`
  : `r${floorIndex}:g${ac.id.slice(ac.id.indexOf(':') + 1)}`);

// Phase 4's reader, rolled up. Nothing new is computed here: `roomAcoustics`
// already answers volume, absorption, reverberation and the ANSI limit for a
// point, and `roomsOnFloor` already walks every room on a storey asking it.
export function acousticsSection(state, opts = {}) {
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  const rooms = [];
  const count = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < count; i++) {
    for (const ac of roomsOnFloor(state, i, catalogGet)) {
      rooms.push({
        // Two modules name the same room two ways: acoustics.js was written
        // before there was a graph and calls it `s7` / `g0:184`, navgraph.js
        // calls it `r0:s7` / `r0:g184`. The parts are the same parts — a
        // shape's id, or a region's lowest cell — so the translation is a
        // rewrite rather than a lookup, and everything downstream gets to
        // join a room's reverberation to its occupant load by id.
        id: navRoomId(i, ac),
        acId: ac.id,
        floor: i,
        name: ac.name || null,
        area: ac.area,
        volume: ac.volume,
        rt60: ac.rt60,
        limit: ac.limit,
        overLimit: !!ac.overLimit,
        verdict: ac.verdict,
        sabins: ac.sabins,
      });
    }
  }
  rooms.sort((a, b) => b.rt60 - a.rt60);
  const graded = rooms.filter((r) => r.limit !== null);
  const over = graded.filter((r) => r.overLimit);
  const summary = {
    rooms: rooms.length,
    graded: graded.length,
    over: over.length,
    worst: rooms[0] || null,
  };
  const findings = [];
  if (over.length) {
    findings.push({
      level: 'warn', code: 'reverberation',
      title: `${over.length} room${over.length === 1 ? '' : 's'} over the ANSI reverberation limit`,
      detail: `${over[0].name || `an unnamed room on ${floorLabel(over[0].floor)}`} rings for ` +
        `${over[0].rt60.toFixed(2)} s against a ${over[0].limit.toFixed(1)} s limit. ` +
        'Soft floor, an acoustic ceiling or more furniture is what brings it down — ' +
        'the estimate is Sabine, which is honest about volume and rough about shape.',
      rooms: over.slice(0, 8),
    });
  } else if (graded.length) {
    findings.push({
      level: 'ok', code: 'reverberation', title: 'Every graded room is within the ANSI limit',
      detail: `${graded.length} rooms measured by Sabine reverberation over their ` +
        'own volume and surfaces.',
    });
  }
  return { rooms, summary, findings };
}

// ---------- the report ----------

export function buildReport(state, opts = {}) {
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  // One graph, one set of occupant loads, shared by every section below —
  // which is the whole reason this file exists rather than a panel calling
  // five modules itself.
  const nav = opts.nav || buildNav(state);
  const occupancy = buildingOccupancy(state, { nav });
  const sprinklered = opts.sprinklered !== false;

  const egress = egressAnalysis(state, { nav, occupancy, sprinklered });
  const accessible = accessibleAnalysis(state, { nav, occupancy, field: egress.field });
  const daylight = daylightAnalysis(state, { nav, occupancy });
  const acoustics = opts.acoustics === false
    ? { rooms: [], summary: { rooms: 0, graded: 0, over: 0, worst: null }, findings: [] }
    : acousticsSection(state, { catalogGet });
  const materials = opts.takeoff === false ? null : takeoff(state, { catalogGet });

  const sections = [
    ['egress', egress],
    ['accessible', accessible],
    ['daylight', daylight],
    ['acoustics', acoustics],
  ];
  const findings = [];
  for (const [section, part] of sections) {
    for (const f of part.findings || []) findings.push({ ...f, section });
  }
  // Occupancy has one finding of its own, and it is about the input rather
  // than the building: a room nobody named was counted at a made-up factor,
  // and every number downstream of it inherits that.
  if (occupancy.unnamed > 0) {
    findings.push({
      section: 'occupancy', level: 'note', code: 'unnamed-rooms',
      title: `${occupancy.unnamed} room${occupancy.unnamed === 1 ? '' : 's'} with no name`,
      detail: 'Counted at 100 ft² per person because nothing said what they are. ' +
        'Name a room and its occupant load comes from what it is for.',
    });
  }
  findings.sort((a, b) => rank(a.level) - rank(b.level));

  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return {
    nav: navSummary(nav),
    sprinklered,
    occupancy,
    egress,
    accessible,
    daylight,
    acoustics,
    takeoff: materials,
    findings,
    summary: {
      occupants: occupancy.total,
      area: occupancy.area,
      storeys: state && state.floors ? state.floors.length : 0,
      rooms: occupancy.rooms.length,
      exits: egress.summary.exits,
      travel: egress.summary.worst ? egress.summary.worst.travel : 0,
      fails,
      warns,
      // The headline. "Passes" only ever means "passes the checks this tool
      // knows how to make", which is the phrase the panel prints with it.
      verdict: fails ? 'fail' : warns ? 'warn' : 'ok',
    },
  };
}

// ---------- the spreadsheet ----------

const round = (n, places = 1) => {
  if (!Number.isFinite(n)) return '';
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

// One row per room, with every per-room number the report knows, followed by
// the takeoff. This is the "spreadsheet-ish export beside the blueprint" the
// phase asked for: a flat table, no merged cells, no formatting, ready to
// paste into whatever a spreadsheet is being used for.
export function reportCSV(report) {
  const rows = [];
  const s = report.summary;
  rows.push(['School Generator — analysis', '', '', '', '', '']);
  rows.push(['Occupant load', s.occupants, 'people', '', '', '']);
  rows.push(['Floor area', round(s.area), 'ft²', '', '', '']);
  rows.push(['Storeys', s.storeys, '', '', '', '']);
  rows.push(['Exits', s.exits, '', '', '', '']);
  rows.push(['Longest travel distance', round(s.travel), 'ft',
    `limit ${report.egress.limits.travel} ft`, '', '']);
  rows.push([]);

  rows.push(['Findings', 'Level', 'Section', 'Detail', '', '']);
  for (const f of report.findings) rows.push([f.title, f.level, f.section, f.detail, '', '']);
  rows.push([]);

  const day = new Map(report.daylight.rooms.map((r) => [r.id, r]));
  const ac = new Map(report.acoustics.rooms.map((r) => [r.id, r]));
  const eg = new Map(report.egress.rooms.map((r) => [r.id, r]));
  const acc = new Map(report.accessible.rooms.map((r) => [r.id, r]));
  rows.push(['Rooms', 'Level', 'Use', 'Area ft²', 'Occupants', 'Travel ft',
    'Doors', 'Clear door in', 'Glazing %', 'RT60 s', 'Accessible']);
  for (const r of report.occupancy.rooms) {
    const e = eg.get(r.id);
    const d = day.get(r.id);
    const a = ac.get(r.id);
    const x = acc.get(r.id);
    rows.push([
      r.name || '(unnamed)',
      floorLabel(r.floor),
      r.useLabel,
      round(r.area),
      r.occ,
      e && e.reached ? round(e.travel) : 'unreachable',
      e ? e.doors : '',
      e ? round(e.doorWidth * 12) : '',
      d ? round(d.ratio * 100, 1) : '',
      a ? round(a.rt60, 2) : '',
      x ? (x.rollable ? 'yes' : 'stairs only') : '',
    ]);
  }
  rows.push([]);

  const csv = csvRows(rows);
  return report.takeoff ? `${csv}\r\n${takeoffCSV(report.takeoff)}` : csv;
}
