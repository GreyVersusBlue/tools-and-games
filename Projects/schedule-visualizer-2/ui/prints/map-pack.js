// The map pack on paper (spec 10.3, "a building map pack as one PDF"; spec 17; DESIGN 14.6;
// ARCHITECTURE 20.5 and 20.9 item 4): the floor plans, the lockdown maps, the evacuation posters,
// a table of the exits and assembly points, and, when asked, the door cards and the step-free
// report, in one document: one paper size, one orientation (one @page), each section starting on a
// new sheet. "As one PDF" is the print dialog's Save as PDF, as for every print (ARCHITECTURE 11).
//
//   the cover      the school, "Building map pack", the date and the sections with their real
//                  sheet counts (one a floor for the plans, the maps and the posters; the cards'
//                  from their own fitting, cover sheet and second sheets included)
//   the sections   each composed module's pages(): floor-plan.js, lockdown-map.js,
//                  evacuation-poster.js (by floor), door-cards.js and step-free.js; nothing here
//                  draws a plan or works a route twice
//   the exits      a table of every exit (its number as everywhere, door name, floor, assembly
//                  point, rooms, people at full capacity and, when heavy, "Far more than the
//                  others" in words), then the rooms with no way out under "Rooms with no way
//                  out: fix before posting" (engine/exit-load.js's exitLoad, engine/evacuation.js)
//
// Every sheet's running head is its page's `what` under "Map pack · ". Door cards keep room for
// the closing line only on the pack's last sheet (their `last`, from this module).
//
// The pack prints the building as built, never a Safety trial (ui/safety/ways.js AS_BUILT_LINE).
// It takes `sections` (ids in SECTIONS; default DEFAULT_SECTIONS) and `floorIds` (the floors of
// the plans, the maps and the posters; the preview sheet forces `floorId`, which is not read here).
// Every name is escaped and set in a span with dir="auto".
//
// render(project, derived, options) → { title, html }; options as document.js.

import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, byExit, noRoute } from '../../engine/evacuation.js';
import { exitLoad, exitNumbers, exitName, basisWords } from '../../engine/exit-load.js';
import { count } from '../components/words.js';
import { labelOn } from '../colour.js';
import { HEAVY_WORDS } from '../safety/exits.js';
import { esc, frame, paperOf, printDate, schoolName } from './document.js';
import { printExitColour, PLAN_INK, PLAN_PAPER } from './plan-svg.js';
import * as floorPlan from './floor-plan.js';
import * as lockdownMap from './lockdown-map.js';
import * as evacuationPoster from './evacuation-poster.js';
import * as doorCards from './door-cards.js';
import * as stepFree from './step-free.js';

export const id = 'map-pack';
export const name = 'Map pack';
// as the lockdown maps and the posters: across the sheet
export const orientation = 'landscape';

// The sections, in the order they print. `label` is the Prints tab's tick and the cover's line.
export const SECTIONS = [
  { id: 'plans', label: 'Floor plans' },
  { id: 'lockdown', label: 'Lockdown maps' },
  { id: 'posters', label: 'Evacuation posters' },
  { id: 'exits', label: 'Exits and assembly points' },
  { id: 'cards', label: 'Door cards' },
  { id: 'step-free', label: 'Step-free ways out' },
];
export const DEFAULT_SECTIONS = ['plans', 'lockdown', 'posters', 'exits'];

export const COVER_WHAT = 'Building map pack';
export const NO_WAY_OUT_HEAD = 'Rooms with no way out: fix before posting';
export const ALL_HAVE_WAY = 'Every room has a way out.';
export const NO_EXIT_SAYS = evacuationPoster.NO_EXIT;
// exit rows and no-way-out lines to a sheet, so a table's head is repeated by a new sheet
// and the cover's counts are the sheets' own
export const ROWS_PER_SHEET = { landscape: 10, portrait: 18 };
export const MISSING_PER_SHEET = { landscape: 14, portrait: 26 };

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

// The sections asked for, as ids in the order they print; the default ones when none is.
export function sectionsFor(options) {
  const asked = options && Array.isArray(options.sections) ? options.sections : [];
  const some = SECTIONS.filter((section) => asked.includes(section.id)).map((section) => section.id);
  return some.length > 0 ? some : DEFAULT_SECTIONS.slice();
}

function chunks(list, size) {
  const out = [];
  for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size));
  return out;
}

function blank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

// What the exits table needs: every exit's figures and the rooms with no way out.
function exitsData(project) {
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  const rows = byExit(project, evacuation);
  const load = exitLoad(project, rows);
  const figures = new Map(load.exits.map((entry) => [entry.exitId, entry]));
  const numbers = exitNumbers(project);
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const exits = rows.map((row) => {
    const figure = figures.get(row.exitId);
    const number = numbers.get(row.exitId);
    return {
      exitId: row.exitId,
      number,
      colour: printExitColour(number - 1),
      name: exitName(project, row.exitId),
      floor: floors.has(row.floorId) ? floors.get(row.floorId).name : '',
      assembly: blank(row.assembly) ? '' : row.assembly,
      rooms: row.rooms,
      people: row.people,
      uncounted: row.uncounted,
      heavy: Boolean(figure && figure.heavy),
      share: figure ? figure.share : 0,
    };
  });
  const names = new Map();
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') names.set(space.id, { floor: floor.name });
  const missing = noRoute(project, evacuation).map((row) => ({ roomId: row.roomId, floor: names.has(row.roomId) ? names.get(row.roomId).floor : '', sentence: row.sentence, onlyByElevator: row.onlyByElevator === true }));
  return { exits, missing, load };
}

function exitRow(exit) {
  const ink = labelOn(exit.colour, PLAN_INK, PLAN_PAPER);
  const badge = '<span style="display: inline-block; min-width: 5mm; padding: 0 1mm; border-radius: 2.5mm; text-align: center; font-weight: 700; background: ' + esc(exit.colour) + '; color: ' + esc(ink) + ';">' + exit.number + '</span>';
  const people = exit.rooms === 0 ? '0' : String(exit.people) + (exit.uncounted > 0 ? ' (' + exit.uncounted + ' with no capacity set)' : '');
  const percent = exit.share > 0 ? ' · ' + Math.round(exit.share * 100) + ' %' : '';
  const heavy = exit.heavy ? '<span data-heavy="true" style="font-weight: 700;">' + esc(HEAVY_WORDS) + '</span>' + esc(percent) : (exit.rooms === 0 ? esc('No room goes out this way.') : esc(percent.replace(/^ · /, '')));
  return '<tr data-exit="' + esc(exit.exitId) + '"' + (exit.heavy ? ' data-heavy="true"' : '') + '>'
    + '<th scope="row">' + badge + ' ' + typed(exit.name) + '</th>'
    + '<td>' + typed(exit.floor) + '</td>'
    + '<td>' + (exit.assembly === '' ? '<span class="is-missing">' + esc('Assembly point not set') + '</span>' : typed(exit.assembly)) + '</td>'
    + '<td class="is-number">' + exit.rooms + '</td>'
    + '<td class="is-number">' + esc(people) + '</td>'
    + '<td>' + heavy + '</td>'
    + '</tr>';
}

const TABLE_HEAD = '<thead><tr><th scope="col">Exit</th><th scope="col">Floor</th><th scope="col">Assembly point</th><th scope="col">Rooms</th><th scope="col">People at full capacity</th><th scope="col">Load</th></tr></thead>';

// The exits section's sheets: the table (a sheet of rows at a time), then the missing rooms.
function exitsPages(project, orientationOf) {
  const { exits, missing, load } = exitsData(project);
  const rowsAt = ROWS_PER_SHEET[orientationOf];
  const missingAt = MISSING_PER_SHEET[orientationOf];
  const what = 'Exits and assembly points';
  const out = [];
  const lead = [];
  if (exits.length === 0) lead.push('<p class="doc-lead" data-line="no-exit">' + esc(NO_EXIT_SAYS) + '</p>');
  if (load.sentence) lead.push('<p class="doc-lead" data-line="heavy"><span style="font-weight: 700;">Warning</span> ' + esc(load.sentence) + '</p>');
  const basis = basisWords(load);
  if (basis !== '') lead.push('<p class="doc-meaning" data-line="basis">' + esc(basis) + '</p>');
  const groups = exits.length === 0 ? [[]] : chunks(exits, rowsAt);
  groups.forEach((group, index) => {
    const body = ['<section class="doc-section" data-section="exits"><h2>' + esc(what) + (index > 0 ? esc(' (continued)') : '') + '</h2>'];
    if (index === 0) body.push(...lead);
    if (group.length > 0) body.push('<table class="doc-table doc-table--exits">' + TABLE_HEAD + '<tbody>' + group.map(exitRow).join('') + '</tbody></table>');
    body.push('</section>');
    out.push({ what, body: body.join('\n') });
  });
  if (missing.length === 0) {
    // a line, on the table's last sheet, so a building with every way out says so
    const last = out[out.length - 1];
    last.body = last.body.replace(/<\/section>$/, '<p class="doc-meaning" data-line="all-out" style="margin-top: 3mm;">' + esc(ALL_HAVE_WAY) + '</p></section>');
    return out;
  }
  chunks(missing, missingAt).forEach((group, index) => {
    const head = index === 0 ? NO_WAY_OUT_HEAD : NO_WAY_OUT_HEAD + ' (continued)';
    const items = group.map((row) => '<li data-room="' + esc(row.roomId) + '">' + typed(row.sentence) + (row.onlyByElevator ? ' ' + esc(doorCards.ELEVATOR_SAYS) : '') + '</li>').join('');
    const intro = index === 0 ? '<p class="doc-lead">' + esc(count(missing.length, 'room') + (missing.length === 1 ? ' has' : ' have') + ' no way out, so its door card says so and its route is missing from the posters.') + '</p>' : '';
    out.push({ what, body: '<section class="doc-section" data-section="no-way-out"><h2>' + esc(head) + '</h2>' + intro + '<ul class="card-cover__missing">' + items + '</ul></section>' });
  });
  return out;
}

// A sheet count in words, "1 sheet", "3 sheets".
function sheets(n) {
  return count(n, 'sheet');
}

// The sheets a list of pages takes: each page one, and each second sheet of a long door card
// (an element with the class "new-sheet" starts a sheet too: document.js).
function sheetsOf(list) {
  return list.reduce((sum, page) => sum + 1 + (String(page.body).split('class="card__more new-sheet"').length - 1), 0);
}

function coverBody(project, opts, listed) {
  const date = printDate(opts.now);
  const lines = listed.map((entry) => {
    const said = entry.sheets === 0 ? 'nothing to print yet' : sheets(entry.sheets) + (entry.note ? ', ' + entry.note : '');
    return '<li data-section="' + esc(entry.id) + '" data-sheets="' + entry.sheets + '"><span style="font-weight: 700;">' + esc(entry.label) + '</span> <span class="card-cover__to">' + esc(said) + '</span></li>';
  });
  const total = listed.reduce((sum, entry) => sum + entry.sheets, 0) + 1;
  return [
    '<div class="mpack__cover" style="margin-top: 14mm;">',
    '<p class="mpack__school" style="margin: 0 0 3mm; font-size: 28pt; line-height: 1.15; font-weight: 700;">' + typed(schoolName(project)) + '</p>',
    '<h2 style="margin: 0 0 3mm; font-size: 18pt;">' + esc(COVER_WHAT) + '</h2>',
    date === '' ? '' : '<p class="doc-lead" data-line="date">' + esc(date) + '</p>',
    '<h2 style="margin: 8mm 0 2mm; font-size: 12pt;">In this pack</h2>',
    '<ul class="card-cover__list" data-list="contents">' + lines.join('') + '</ul>',
    '<p class="doc-meaning" data-line="total">' + esc(sheets(total) + ' in all, with this cover. Choose Save as PDF in the print dialog to keep the pack as one file.') + '</p>',
    '</div>',
  ].join('\n');
}

// The sheets of the pack: [{ what, body }]. Each module's sheet keeps its own `what` under "Map pack · ".
export function pages(project, derived, options) {
  const opts = options || {};
  const wanted = sectionsFor(opts);
  // the document has one orientation and one paper; the modules read them from the options as given
  const paper = paperOf(project, opts);
  const base = { ...opts, floorId: 'all', traceImage: false, traceImages: undefined, roomIds: undefined, by: 'floor', corridorIds: undefined, sections: undefined };
  const out = [];
  const listed = [];
  const run = (section, made, note) => {
    const label = SECTIONS.find((each) => each.id === section).label;
    listed.push({ id: section, label, sheets: sheetsOf(made), note });
    for (const page of made) out.push({ what: 'Map pack · ' + (page.what || label), body: page.body });
  };
  for (const section of wanted) {
    if (section === 'plans') run(section, floorPlan.pages(project, derived, base), 'one a floor');
    else if (section === 'lockdown') run(section, lockdownMap.pages(project, derived, base), 'one a floor');
    else if (section === 'posters') run(section, evacuationPoster.pages(project, derived, base), 'one a floor');
    else if (section === 'exits') run(section, exitsPages(project, paper.orientation), '');
    else if (section === 'cards') {
      const made = doorCards.pages(project, derived, { ...base, last: wanted[wanted.length - 1] === 'cards' });
      run(section, made, 'one or two sheets a room');
    } else if (section === 'step-free') run(section, stepFree.pages(project, derived, base), '');
  }
  return [{ what: 'Map pack', body: coverBody(project, opts, listed) }].concat(out);
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
