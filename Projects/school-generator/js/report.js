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
import { buildingOccupancy, codeOf, editionEntry } from './occupancy.js';
import { egressAnalysis, accessibleAnalysis } from './egress.js';
import { daylightAnalysis } from './daylight.js';
import { takeoff, takeoffCSV, csvRows } from './takeoff.js';
import { roomsOnFloor } from './acoustics.js';
import { buildingOverhang } from './shadow.js';
import { utilisationAnalysis } from './utilisation.js';
import { isEmptyTimetable, normalizeTimetable, roomPool } from './timetable.js';

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
  // Which code the numbers are read against, and whether the building is
  // sprinklered. Both are facts about the design and live in the file since
  // v11 (see occupancy.js); `opts` still overrides, for a caller asking a
  // hypothetical rather than reading the design.
  const code = codeOf(state);
  const sprinklered = opts.sprinklered === undefined ? code.sprinklered : opts.sprinklered !== false;
  const edition = editionEntry(code.edition);

  const egress = egressAnalysis(state, { nav, occupancy, sprinklered });
  const accessible = accessibleAnalysis(state, { nav, occupancy, field: egress.field });
  const daylight = daylightAnalysis(state, { nav, occupancy });
  const acoustics = opts.acoustics === false
    ? { rooms: [], summary: { rooms: 0, graded: 0, over: 0, worst: null }, findings: [] }
    : acousticsSection(state, { catalogGet });
  const materials = opts.takeoff === false ? null : takeoff(state, { catalogGet });
  // Phase 8's one addition to the report, and the only structural question the
  // tool asks: is every storey standing on the one below it. It reads nothing
  // the other sections read — no graph, no occupant loads, just two footprints
  // compared cell by cell — which is why it costs almost nothing to include.
  const structure = buildingOverhang(state);
  // Phase 15's section, and the only one in the report that can be absent: it
  // reads a timetable, and a design that has not been given one has nothing
  // here to say. `utilisationAnalysis` answers with `has: false` rather than
  // with null so a panel can print "no timetable" from the same shape it
  // prints everything else from.
  const timetable = normalizeTimetable(opts.timetable || (state && state.timetable));
  const utilisation = opts.utilisation === false || isEmptyTimetable(timetable)
    ? null
    : utilisationAnalysis(state, {
      nav, occupancy, timetable,
      pool: roomPool(nav, { occupancy }),
      schedule: opts.schedule || (state && state.life && state.life.schedule),
    });

  const sections = [
    ['egress', egress],
    ['accessible', accessible],
    ['daylight', daylight],
    ['acoustics', acoustics],
    ['structure', structure],
    ['utilisation', utilisation || { findings: [] }],
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
    // Printed beside every table that quotes a limit: a sheet that says 250ft
    // without saying under what is a sheet nobody can check.
    edition: edition.key,
    editionLabel: edition.label,
    occupancy,
    egress,
    accessible,
    daylight,
    acoustics,
    structure,
    utilisation,
    takeoff: materials,
    findings,
    summary: {
      occupants: occupancy.total,
      area: occupancy.area,
      storeys: state && state.floors ? state.floors.length : 0,
      rooms: occupancy.rooms.length,
      exits: egress.summary.exits,
      travel: egress.summary.worst ? egress.summary.worst.travel : 0,
      // Null rather than zero when there is no timetable: a school day nobody
      // has described is not a school day of no length.
      utilisation: utilisation ? utilisation.summary.utilisation : null,
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
  // What the limits below are quoted from. A sheet that says 250ft without
  // saying under what is a sheet nobody can check.
  rows.push(['Code', report.editionLabel, '',
    report.sprinklered ? 'sprinklered' : 'unsprinklered', '', '']);
  rows.push(['Occupant load', s.occupants, 'people', '', '', '']);
  rows.push(['Floor area', round(s.area), 'ft²', '', '', '']);
  rows.push(['Storeys', s.storeys, '', '', '', '']);
  rows.push(['Exits', s.exits, '', '', '', '']);
  rows.push(['Longest travel distance', round(s.travel), 'ft',
    `limit ${report.egress.limits.travel} ft`, '', '']);
  if (report.structure) {
    rows.push(['Unsupported upper storey', round(report.structure.area), 'ft²',
      'outside the footprint below', '', '']);
  }
  rows.push([]);

  rows.push(['Findings', 'Level', 'Section', 'Detail', '', '']);
  for (const f of report.findings) rows.push([f.title, f.level, f.section, f.detail, '', '']);
  rows.push([]);

  // Phase 15's section, and the only one the sheet leaves out entirely when it
  // has nothing to say. A design with no timetable has no school day, and a
  // column of zeroes would read as a school that never uses its rooms.
  const u = report.utilisation;
  if (u && u.has) {
    rows.push(['School day', '', '', '', '', '']);
    rows.push(['Groups', u.summary.cohorts, '', `${u.summary.students} students`, '', '']);
    rows.push(['Sections', u.summary.sections, '',
      `${u.summary.placed} placed in a room`, '', '']);
    rows.push(['Room utilisation', round(u.summary.utilisation * 100), '%',
      `${u.summary.used} of ${u.summary.rooms} teaching rooms used`, '', '']);
    if (u.summary.peak) {
      rows.push(['Busiest period', u.summary.peak.period, '',
        `${u.summary.peak.seated} seated in ${u.summary.peak.rooms} rooms, ` +
        `${u.summary.idleAtPeak} rooms empty`, '', '']);
    }
    rows.push(['Walk per student per day', round(u.travel.summary.perDay), 'ft',
      `${round(u.travel.summary.milesPerYear)} miles a year`, '', '']);
    if (u.travel.summary.worst) {
      const w = u.travel.summary.worst;
      rows.push(['Longest move', round(w.dist), 'ft',
        `${w.cohortName}, period ${w.period} to ${w.to}, ${Math.round(w.seconds)} s`, '', '']);
    }
    rows.push([]);

    rows.push(['Room', 'Level', 'Use', 'Area ft²', 'Holds', 'Periods used',
      'Of the day', 'Busiest', 'Mean class', 'Over load']);
    for (const r of u.rooms) {
      rows.push([
        r.name || '(unnamed)', floorLabel(r.floor), r.useLabel, round(r.area), r.capacity,
        r.used, round(r.share * 100), r.peak, round(r.mean), r.over,
      ]);
    }
    rows.push([]);

    rows.push(['Group', 'Period', 'To period', 'From', 'To', 'Walk ft', 'Seconds',
      'Fits the bell', '', '']);
    for (const m of u.travel.moves) {
      const from = u.rooms.find((r) => r.id === m.from);
      const to = u.rooms.find((r) => r.id === m.room);
      rows.push([
        m.cohortName, m.period, m.to,
        (from && from.name) || m.from, (to && to.name) || m.room,
        round(m.dist), Math.round(m.seconds), m.late ? 'no' : 'yes', '', '',
      ]);
    }
    rows.push([]);
  }

  const day = new Map(report.daylight.rooms.map((r) => [r.id, r]));
  const ac = new Map(report.acoustics.rooms.map((r) => [r.id, r]));
  const eg = new Map(report.egress.rooms.map((r) => [r.id, r]));
  const acc = new Map(report.accessible.rooms.map((r) => [r.id, r]));
  rows.push(['Rooms', 'Level', 'Use', 'Use from', 'Area ft²', 'Occupants',
    'Load from', 'Travel ft', 'Doors', 'Clear door in', 'Glazing %', 'RT60 s',
    'Accessible']);
  for (const r of report.occupancy.rooms) {
    const e = eg.get(r.id);
    const d = day.get(r.id);
    const a = ac.get(r.id);
    const x = acc.get(r.id);
    rows.push([
      r.name || '(unnamed)',
      floorLabel(r.floor),
      r.useLabel,
      // Since v11 a room can be *told* what it is and how many it holds, so
      // the sheet says which of the two numbers beside it was decided by a
      // person and which was read off the plan.
      r.chosen ? 'chosen' : r.guess ? 'unnamed' : 'name',
      round(r.area),
      r.occ,
      r.stated === null ? 'area' : 'stated',
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
