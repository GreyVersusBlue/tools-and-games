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
import { codeOf, editionOf, citeFor } from './codes.js';
import { isSpread, fmtRange } from './range.js';
import { egressAnalysis, accessibleAnalysis } from './egress.js';
import { daylightAnalysis } from './daylight.js';
import { takeoff, takeoffCSV } from './takeoff.js';
import { csvRows } from './csv.js';
import { roomsOnFloor } from './acoustics.js';
import { buildingOverhang } from './shadow.js';
import { utilisationAnalysis } from './utilisation.js';
import { isEmptyTimetable, normalizeTimetable, roomPool } from './timetable.js';
import { normalizeRates } from './rates.js';
import { quantities, costing, costCSV } from './cost.js';
import { specSheet, specCSV } from './spec.js';
import { phasingOf, phasingCosts, phasingCSV } from './phasing.js';

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

// What the reverberation is measured against — not a building code, and the
// finding says which standard rather than which edition.
const ANSI = 'ANSI/ASA S12.60 · §5.3';

// Phase 4's reader, rolled up. Nothing new is computed here: `roomAcoustics`
// already answers volume, absorption, reverberation and the ANSI limit for a
// point, and `roomsOnFloor` already walks every room on a storey asking it.
//
// Phase 41: every row carries the range beside the point, the list sorts by
// the range's bad end, and a room over the limit only at that end is a note
// of its own — with the surface that decides it named, because "might be
// over" is only useful with "and this is what to pin down".
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
        rt60Low: ac.rt60Low,
        rt60High: ac.rt60High,
        limit: ac.limit,
        overLimit: !!ac.overLimit,
        maybeOver: !!ac.maybeOver,
        surelyOver: !!ac.surelyOver,
        narrows: ac.narrows || null,
        verdict: ac.verdict,
        sabins: ac.sabins,
      });
    }
  }
  // Worst first, by the bad end of the range — then by the point, so two
  // rooms with the same ceiling still sort by how they actually ring.
  rooms.sort((a, b) => b.rt60High - a.rt60High || b.rt60 - a.rt60);
  const graded = rooms.filter((r) => r.limit !== null);
  const over = graded.filter((r) => r.overLimit);
  const maybe = graded.filter((r) => r.maybeOver);
  const summary = {
    rooms: rooms.length,
    graded: graded.length,
    over: over.length,
    maybe: maybe.length,
    worst: rooms[0] || null,
  };
  const name = (r) => r.name || `an unnamed room on ${floorLabel(r.floor)}`;
  const tail = (r) => `${r.rt60.toFixed(2)} s (${fmtRange({ low: r.rt60Low, high: r.rt60High }, { fmt: (v) => v.toFixed(1) })} s)`;
  const pin = (r) => (r.narrows
    ? ` The ${r.narrows.what.toLowerCase().replace(/ \(.*\)$/, '')}'s coefficient ` +
      `(${r.narrows.low.toFixed(2)}–${r.narrows.high.toFixed(2)}` +
      `${r.narrows.area ? ` over ${Math.round(r.narrows.area)} ft²` : ''}) is the input that narrows it most.`
    : '');
  const findings = [];
  if (over.length) {
    findings.push({
      level: 'warn', code: 'reverberation',
      title: `${over.length} room${over.length === 1 ? '' : 's'} over the ANSI reverberation limit`,
      detail: `${name(over[0])} rings for ${tail(over[0])} against a ` +
        `${over[0].limit.toFixed(1)} s limit. ` +
        'Soft floor, an acoustic ceiling or more furniture is what brings it down — ' +
        'the estimate is Sabine, which is honest about volume and rough about shape.' +
        (over[0].surelyOver ? '' : pin(over[0])),
      rooms: over.slice(0, 8),
      cite: ANSI,
    });
  }
  if (maybe.length) {
    findings.push({
      level: 'note', code: 'reverberation-range',
      title: `${maybe.length} ${over.length ? 'more ' : ''}room${maybe.length === 1 ? '' : 's'} could be over the reverberation limit`,
      detail: `${name(maybe[0])} rings for ${tail(maybe[0])} against ${maybe[0].limit.toFixed(1)} s — ` +
        'under at the estimate, over if the surfaces reflect more than the tables assume.' +
        pin(maybe[0]),
      rooms: maybe.slice(0, 8),
      cite: ANSI,
    });
  }
  if (!over.length && graded.length) {
    findings.push({
      level: 'ok', code: 'reverberation',
      title: maybe.length
        ? 'Every graded room is within the ANSI limit at the estimate'
        : 'Every graded room is within the ANSI limit',
      detail: `${graded.length} rooms measured by Sabine reverberation over their ` +
        `own volume and surfaces${maybe.length ? '' : ', at every end of the coefficients\' range'}.`,
      cite: ANSI,
    });
  }
  return { rooms, summary, findings };
}

// ---------- the report ----------

// The phasing plan a report is read against: the design's own, unless the
// caller is asking a what-if. `opts.phasing === false` turns the section off
// the same way `opts.takeoff === false` turns the takeoff off.
function normalizePhasingOpt(opts, state) {
  if (opts.phasing === false) return { phases: [] };
  return opts.phasing ? phasingOf({ phasing: opts.phasing }) : phasingOf(state);
}

export function buildReport(state, opts = {}) {
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  // One graph, one set of occupant loads, shared by every section below —
  // which is the whole reason this file exists rather than a panel calling
  // five modules itself.
  const nav = opts.nav || buildNav(state);
  // Which code the numbers are read against, and whether the building is
  // sprinklered. Both are facts about the design and live in the file since
  // v11 (see codes.js); `opts` still overrides, for a caller asking a
  // hypothetical rather than reading the design. Since Phase 41 the edition
  // is *applied*: every reader below is handed the same table and reads its
  // factors and limits off it, which is what makes the sheet's sentence true.
  const code = codeOf(state);
  const sprinklered = opts.sprinklered === undefined ? code.sprinklered : opts.sprinklered !== false;
  const edition = editionOf(opts.edition, state);
  const occupancy = buildingOccupancy(state, { nav, edition });

  const egress = egressAnalysis(state, { nav, occupancy, sprinklered, edition });
  const accessible = accessibleAnalysis(state, { nav, occupancy, field: egress.field, catalogGet, edition });
  const daylight = daylightAnalysis(state, { nav, occupancy, edition });
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

  // Phase 16. One pass over the model produces the quantities, and the cost,
  // the spec sheet and the phasing plan are three readings of that one pass —
  // the same bargain this file struck with the nav graph in Phase 7. A design
  // with no rate table still gets a spec sheet, because a spec sheet is about
  // what a thing *is*.
  const rates = normalizeRates(opts.rates !== undefined ? opts.rates : (state && state.rates));
  const qty = opts.takeoff === false ? null : quantities(state, { catalogGet });
  const cost = qty ? costing(state, { rates, quantities: qty, catalogGet }) : null;
  const spec = qty ? specSheet(state, { quantities: qty }) : null;
  const phasing = normalizePhasingOpt(opts, state);
  const phases = qty
    ? phasingCosts(state, { rates, quantities: qty, phasing, catalogGet })
    : null;

  const sections = [
    ['egress', egress],
    ['accessible', accessible],
    ['daylight', daylight],
    ['acoustics', acoustics],
    ['structure', structure],
    ['utilisation', utilisation || { findings: [] }],
    ['cost', cost || { findings: [] }],
    // A phasing plan nobody has made has one thing to say and says it once;
    // the note is suppressed here rather than in the module, because
    // `phasingCosts` called on its own by a panel *should* say it.
    ['phasing', phases && phases.has ? phases : { findings: [] }],
  ];
  const findings = [];
  for (const [section, part] of sections) {
    for (const f of part.findings || []) findings.push({ ...f, section });
  }
  // Occupancy has one finding of its own, and it is about the input rather
  // than the building: a room nobody named was counted at a made-up factor,
  // and every number downstream of it inherits that.
  if (occupancy.unnamed > 0) {
    const n = occupancy.narrows;
    const load = { low: occupancy.low, high: occupancy.high };
    findings.push({
      section: 'occupancy', level: 'note', code: 'unnamed-rooms',
      title: `${occupancy.unnamed} room${occupancy.unnamed === 1 ? '' : 's'} with no name`,
      detail: `Counted at ${edition.factors.unassigned} ft² per person because nothing said what ` +
        `they are, so the building holds ${occupancy.total} at the estimate and ` +
        `${fmtRange(load)} depending on what they turn out to be. ` +
        (n
          ? `Naming ${n.name || `the ${Math.round(n.area)} ft² room on ${floorLabel(n.floor)}`} ` +
            `narrows that most, by ${n.spread}.`
          : 'Name a room and its occupant load comes from what it is for.'),
      rooms: n ? [n] : [],
      cite: citeFor(edition, 'factors'),
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
    // Phase 16's three. `cost` is null only when the caller asked for no
    // takeoff at all; `cost.has` is the flag that says whether anybody has
    // priced anything, the same way `utilisation.has` reads a timetable.
    rates,
    cost,
    spec,
    phasing: phases,
    findings,
    summary: {
      occupants: occupancy.total,
      // Phase 41: the same number as a range. The ends meet when every room
      // is named; a panel prints the pair only when they do not.
      occupantsLow: occupancy.low,
      occupantsHigh: occupancy.high,
      area: occupancy.area,
      storeys: state && state.floors ? state.floors.length : 0,
      rooms: occupancy.rooms.length,
      exits: egress.summary.exits,
      travel: egress.summary.worst ? egress.summary.worst.travel : 0,
      commonPath: egress.summary.commonPath ? egress.summary.commonPath.common : 0,
      // Null rather than zero when there is no timetable: a school day nobody
      // has described is not a school day of no length.
      utilisation: utilisation ? utilisation.summary.utilisation : null,
      // Null rather than zero when nobody has given the design a rate table:
      // a building nobody has priced does not cost nothing.
      cost: cost && cost.has ? cost.summary.total : null,
      perSqft: cost && cost.has ? cost.summary.perSqft : null,
      fails,
      warns,
      // The headline. "Passes" only ever means "passes the checks this tool
      // knows how to make", which is the phrase the panel prints with it.
      verdict: fails ? 'fail' : warns ? 'warn' : 'ok',
    },
  };
}

// ---------- the title-block code panel ----------
//
// Phase 7's own last unticked item, and the reason it was left: a drawing that
// quotes a limit without saying which code it is quoting is a drawing nobody
// can check, and until v11 the design had nowhere to record that. It does now,
// so the panel that goes on the sheet can lead with the edition.
//
// This returns *data*, not pixels. `blueprint.js` draws it, and the split is
// the same one `computeFloorPlan` made: the module that knows the numbers has
// no canvas in it, and the module with the canvas in it makes up no numbers.
// The findings a title block has room to say out loud: the worst few, title
// only. Phase 19's "findings go where the eye is" — the panels carried a
// verdict and a count, and the count made somebody open a different tool to
// learn what the "2 FAIL" actually were. Three is the editorial judgement:
// the panel is a title block, not the report, and the report is one M away.
const PANEL_FINDINGS = 3;

export function panelFindings(findings, opts = {}) {
  const max = opts.max ?? PANEL_FINDINGS;
  const worth = (findings || []).filter((f) => f.level === 'fail' || f.level === 'warn');
  return {
    lines: worth.slice(0, max).map((f) => ({ level: f.level, title: f.title })),
    more: Math.max(0, worth.length - max),
  };
}

export function codePanel(report, opts = {}) {
  const s = report.summary;
  const e = report.egress;
  const here = Number.isFinite(opts.floor) ? opts.floor : null;
  // Exits are counted where they are: a title block that says "4 exits" on the
  // second-floor sheet, where there are none, is a title block that has been
  // copied rather than read.
  const exitsOn = new Map();
  for (const x of e.exits) exitsOn.set(x.floor, (exitsOn.get(x.floor) || 0) + 1);
  const storeys = report.occupancy.floors.map((f) => ({
    floor: f.floor,
    label: f.label,
    area: f.area,
    occ: f.occ,
    exits: exitsOn.get(f.floor) || 0,
    current: here !== null && f.floor === here,
  }));
  const worst = e.summary.worst;
  const load = { low: s.occupantsLow, high: s.occupantsHigh };
  const cp = e.summary.commonPath;
  const rows = [
    // The range in brackets when there is one: a title block that prints
    // "437" for a building with three unnamed rooms is a title block that
    // knows something it is not saying.
    ['Occupant load', isSpread(load) ? `${s.occupants} (${fmtRange(load)})` : `${s.occupants}`],
    ['Building area', `${Math.round(s.area).toLocaleString()} ft²`],
    ['Storeys', `${s.storeys}`],
    ['Exits', `${e.summary.exits} of ${e.summary.exitsRequired} required`],
    ['Exit capacity', `${e.summary.capacity} / ${e.summary.occupants} people`],
    ['Longest travel', worst
      ? `${Math.round(worst.travel)} ft / ${e.limits.travel} ft`
      : `— / ${e.limits.travel} ft`],
    ['Dead end', e.deadEnds.length
      ? `${Math.round(e.deadEnds[0].depth)} ft / ${e.limits.deadEnd} ft`
      : `none / ${e.limits.deadEnd} ft`],
    // Phase 41: the walk to a choice, which used to be a constant that
    // nothing measured and is now the longest one in the building.
    ['Common path', cp
      ? `${Math.round(cp.common)} ft / ${e.limits.commonPath} ft`
      : `— / ${e.limits.commonPath} ft`],
  ];
  // The half of the walk that used to stop at the threshold. No limit column,
  // because the code sets no number for it — but a panel that quotes a travel
  // distance and says nothing about the two hundred feet of car park after the
  // door has told half the story.
  const dis = e.discharge;
  if (dis && dis.summary.worst) {
    rows.push(['Exit discharge', `${Math.round(dis.summary.worst.dist)} ft to the ` +
      `${dis.summary.rule === 'paved' ? 'paved boundary' : 'site boundary'}`]);
  } else if (dis && dis.summary.stranded) {
    rows.push(['Exit discharge', `${dis.summary.stranded} of ${dis.summary.exits} reach nothing`]);
  }
  return {
    title: 'CODE INFORMATION',
    // "IBC 2021 applied": the sentence the phase was for. Every row above
    // was read against this table, so the panel says so rather than merely
    // naming it.
    edition: `${report.editionLabel} applied`,
    sprinklered: report.sprinklered,
    rows,
    storeys,
    verdict: s.verdict,
    fails: s.fails,
    warns: s.warns,
    // Phase 19: the finding text itself, not just the count of it — the worst
    // few, worst first, the order buildReport already sorted them into.
    findings: panelFindings(report.findings),
    // Printed small under the panel. The tool has said this in the report
    // panel since Phase 7; a sheet that leaves the room goes without it, and
    // a sheet is the thing that ends up in front of somebody with authority.
    caveat: 'Checked only against the rules this tool knows how to apply. ' +
      'Not a code review.',
  };
}

// ---------- the title-block school-day panel ----------
//
// Phase 16 put the report on the sheet and left exactly one section off it,
// and said so in the same breath: *"The school-day section is still not on the
// sheet, and now it is the only one that isn't."* This is that section, in the
// same shape as `codePanel` and for the same reason — a set of drawings that
// quotes an occupant load and says nothing about the school timetabled into it
// has told half the story, and the half it left out is the one the building
// was drawn for.
//
// **Null rather than an empty panel when there is no timetable**, which is the
// distinction `reportCSV` already makes by leaving its own School day block
// out entirely. A design nobody has described a day for does not have a school
// day of no length, and a box of zeroes on a sheet reads as a school that
// never uses its rooms.
export function dayPanel(report, opts = {}) {
  const u = report && report.utilisation;
  if (!u || !u.has) return null;
  const s = u.summary;
  const t = u.travel.summary;
  const here = Number.isFinite(opts.floor) ? opts.floor : null;

  const rows = [
    ['Groups', `${s.cohorts} · ${s.students} students`],
    ['Sections', `${s.placed} of ${s.sections} in a room`],
    ['Room use', `${Math.round(s.utilisation * 100)}% of ${s.rooms} rooms`],
  ];
  if (s.peak) {
    rows.push(['Busiest period', `${s.peak.period} · ${s.peak.seated} seated`]);
    rows.push(['Empty at that bell', `${s.idleAtPeak} of ${s.rooms}`]);
  }
  rows.push(['Walk per student', `${Math.round(t.perDay)} ft a day`]);
  rows.push(['Over a school year', `${Math.round(t.milesPerYear)} miles`]);
  if (t.worst) {
    rows.push(['Longest move', `${Math.round(t.worst.dist)} ft · ${Math.round(t.worst.seconds)} s`]);
  }
  // Printed whether or not anything fails it, because "none late" is a result
  // rather than an absence — and because it is the one claim on this panel
  // somebody can check with a stopwatch and the bell schedule.
  rows.push(['Late for the bell', t.late
    ? `${t.late} of ${t.moves} moves`
    : `none of ${t.moves} moves`]);
  const tight = u.corridors && u.corridors.worst;
  if (tight && Number.isFinite(tight.perHead)) {
    rows.push(['Tightest corridor', `${Math.round(tight.perHead)} ft² a head`]);
  }
  if (s.over) rows.push(['Class over the load', `${s.over} section${s.over === 1 ? '' : 's'}`]);

  // Which sheet you are holding, the same trick the code panel plays with
  // area and exits: a storey's teaching rooms, how many of them work at all,
  // and how many stand empty in the period the building is fullest. An idle
  // room at peak is the most expensive thing a school can own, and which
  // *floor* it is on is a fact about the sheet in your hand.
  const byFloor = new Map();
  for (const r of u.rooms) {
    let row = byFloor.get(r.floor);
    if (!row) {
      row = { floor: r.floor, label: floorLabel(r.floor), rooms: 0, used: 0, idle: 0 };
      byFloor.set(r.floor, row);
    }
    row.rooms++;
    if (r.used > 0) row.used++;
  }
  for (const r of u.idleAtPeak) {
    const row = byFloor.get(r.floor);
    if (row) row.idle++;
  }
  const storeys = [...byFloor.values()]
    .sort((a, b) => a.floor - b.floor)
    .map((r) => ({ ...r, current: here !== null && r.floor === here }));

  const findings = u.findings || [];
  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return {
    title: 'THE SCHOOL DAY',
    // The two facts every number below is read against, on one line under the
    // title — the same place the code panel puts its edition.
    edition: `${s.periods} period${s.periods === 1 ? '' : 's'}`,
    passing: Math.round(u.travel.allowed / 60),
    rows,
    storeys,
    verdict: fails ? 'fail' : warns ? 'warn' : 'ok',
    fails,
    warns,
    // Phase 19, same as the code panel's: this panel's own findings, in text.
    findings: panelFindings(findings),
    // The caveat that matters here is not about the code, it is about which
    // two things were measured against each other. A timetable is not part of
    // a building — it is in the file beside it — so a sheet that prints these
    // numbers has to say that either one of them could have moved.
    caveat: 'Measured over this timetable and this building as drawn. A timetable is not ' +
      'part of the building: change either and these numbers change.',
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
  rows.push(['Code', `${report.editionLabel} applied`, '',
    report.sprinklered ? 'sprinklered' : 'unsprinklered', '', '']);
  const load = { low: s.occupantsLow, high: s.occupantsHigh };
  rows.push(['Occupant load', s.occupants, 'people',
    isSpread(load) ? `${fmtRange(load)} counting the unnamed rooms` : '', '', '']);
  rows.push(['Floor area', round(s.area), 'ft²', '', '', '']);
  rows.push(['Storeys', s.storeys, '', '', '', '']);
  rows.push(['Exits', s.exits, '', '', '', '']);
  rows.push(['Longest travel distance', round(s.travel), 'ft',
    `limit ${report.egress.limits.travel} ft`, '', '']);
  rows.push(['Longest common path', round(s.commonPath), 'ft',
    `limit ${report.egress.limits.commonPath} ft`, '', '']);
  if (report.structure) {
    rows.push(['Unsupported upper storey', round(report.structure.area), 'ft²',
      'outside the footprint below', '', '']);
  }
  rows.push([]);

  // The fifth column is the provenance — which edition and table, or which
  // standard, the finding was measured against.
  rows.push(['Findings', 'Level', 'Section', 'Detail', 'Measured against', '']);
  for (const f of report.findings) rows.push([f.title, f.level, f.section, f.detail, f.cite || '', '']);
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
  const cpRows = new Map(((report.egress.common && report.egress.common.rows) || []).map((r) => [r.id, r]));
  rows.push(['Rooms', 'Level', 'Use', 'Use from', 'Area ft²', 'Occupants',
    'Load from', 'Travel ft', 'Common path ft', 'Doors', 'Clear door in', 'Glazing %',
    'RT60 s', 'RT60 low–high', 'Accessible']);
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
      // A guessed room's load as its range, so the sheet says "3–129" where
      // the panel says "9": the honest number is the pair.
      r.spread > 0 ? fmtRange({ low: r.low, high: r.high }) : r.occ,
      r.stated === null ? (r.guess ? 'guess' : 'area') : 'stated',
      e && e.reached ? round(e.travel) : 'unreachable',
      cpRows.has(r.id) ? round(cpRows.get(r.id).common) : '',
      e ? e.doors : '',
      e ? round(e.doorWidth * 12) : '',
      d ? round(d.ratio * 100, 1) : '',
      a ? round(a.rt60, 2) : '',
      a ? fmtRange({ low: a.rt60Low, high: a.rt60High }, { fmt: (v) => round(v, 2) }) : '',
      x ? (x.rollable ? 'yes' : 'stairs only') : '',
    ]);
  }
  rows.push([]);

  const csv = csvRows(rows);
  const parts = [csv];
  if (report.takeoff) parts.push(takeoffCSV(report.takeoff));
  // Phase 16's three, appended in the order a set is read: what it is made of,
  // what that is, what it costs, and when it gets built.
  if (report.spec) parts.push(specCSV(report.spec));
  if (report.cost && report.cost.has) parts.push(costCSV(report.cost));
  if (report.phasing && report.phasing.has) parts.push(phasingCSV(report.phasing));
  return parts.join('\r\n');
}
