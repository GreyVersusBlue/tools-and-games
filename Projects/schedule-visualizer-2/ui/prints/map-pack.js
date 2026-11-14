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
//                  The rows to a sheet are measured from their text, as fitPlan does (the first
//                  sheet's room is less by the lines it carries; the pack's last sheet keeps room
//                  for the closing line), and the section's text scales with the paper
//                  (--exits-scale, as the lockdown index's --lockdown-scale).
//
// Every sheet's running head is its page's `what` under "Map pack · ". Door cards keep room for
// the closing line only on the pack's last sheet (their `last`, from this module).
//
// The pack prints the building as built, never a Safety trial (ui/safety/ways.js AS_BUILT_LINE).
// It takes `sections` (ids in SECTIONS; default DEFAULT_SECTIONS) and `floorIds` (the floors of
// the plans, the maps and the posters; the preview sheet forces `floorId`, which is not read here).
// Every name is escaped and set in a span with dir="auto"; inside a sentence it is isolated with
// U+2068 and U+2069 as the poster does (the pinned tag list of a print has no <bdi>), and in a
// running head too when the name holds anything but ASCII.
//
// render(project, derived, options) → { title, html }; options as document.js.

import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, byExit, noRoute } from '../../engine/evacuation.js';
import { exitLoad, exitNumbers, exitName, basisWords } from '../../engine/exit-load.js';
import { nameOfRoom } from '../../engine/schema.js';
import { count } from '../components/words.js';
import { labelOn } from '../colour.js';
import { HEAVY_WORDS } from '../safety/exits.js';
import { esc, frame, paperOf, printableBox, printDate, schoolName } from './document.js';
import { printExitColour, PLAN_INK, PLAN_PAPER } from './plan-svg.js';
import * as floorPlan from './floor-plan.js';
import * as lockdownMap from './lockdown-map.js';
import * as evacuationPoster from './evacuation-poster.js';
import { sheetScale, headerMm, wrapped } from './evacuation-poster.js';
import * as doorCards from './door-cards.js';
import { FOOT_MM } from './door-cards.js';
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
const FSI = '\u2068';
const PDI = '\u2069';

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
  const named = new Map();
  let rooms = 0;
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind !== 'room') continue;
      rooms += 1;
      named.set(space.id, [nameOfRoom(space, true), nameOfRoom(space, false), floor.name]);
    }
  }
  const missing = noRoute(project, evacuation).map((row) => ({ roomId: row.roomId, names: named.get(row.roomId) || [], sentence: row.sentence, onlyByElevator: row.onlyByElevator === true }));
  return { exits, missing, load, rooms };
}

// The words of each cell of an exit's row, as plain text: the row is set from them, and the
// sheet's chunking measures them.
function cellsOf(exit) {
  const people = exit.rooms === 0 ? '0' : String(exit.people) + (exit.uncounted > 0 ? ' (' + exit.uncounted + ' with no capacity set)' : '');
  const percent = exit.share > 0 ? ' · ' + Math.round(exit.share * 100) + ' %' : '';
  const load = exit.heavy ? HEAVY_WORDS + percent : (exit.rooms === 0 ? 'No room goes out this way.' : percent.replace(/^ · /, ''));
  return {
    exit: String(exit.number) + ' ' + exit.name,
    floor: exit.floor,
    assembly: exit.assembly === '' ? 'Assembly point not set' : exit.assembly,
    rooms: String(exit.rooms),
    people,
    load,
    percent,
  };
}

function exitRow(exit) {
  const ink = labelOn(exit.colour, PLAN_INK, PLAN_PAPER);
  const badge = '<span style="display: inline-block; min-width: 5mm; padding: 0 1mm; border-radius: 2.5mm; text-align: center; font-weight: 700; background: ' + esc(exit.colour) + '; color: ' + esc(ink) + ';">' + exit.number + '</span>';
  const cells = cellsOf(exit);
  const heavy = exit.heavy ? '<span data-heavy="true" style="font-weight: 700;">' + esc(HEAVY_WORDS) + '</span>' + esc(cells.percent) : esc(cells.load);
  return '<tr data-exit="' + esc(exit.exitId) + '"' + (exit.heavy ? ' data-heavy="true"' : '') + '>'
    + '<th scope="row">' + badge + ' ' + typed(exit.name) + '</th>'
    + '<td>' + typed(exit.floor) + '</td>'
    + '<td>' + (exit.assembly === '' ? '<span class="is-missing">' + esc(cells.assembly) + '</span>' : typed(exit.assembly)) + '</td>'
    + '<td class="is-number">' + exit.rooms + '</td>'
    + '<td class="is-number">' + esc(cells.people) + '</td>'
    + '<td>' + heavy + '</td>'
    + '</tr>';
}

// The table's columns, as shares of the sheet's width: print.css sets the same widths on the head's cells
// (table-layout: fixed; the pinned tag list of a print has no <col>), so the measure below is the layout.
const COLUMNS = [
  ['Exit', 0.25, 'exit'], ['Floor', 0.12, 'floor'], ['Assembly point', 0.31, 'assembly'],
  ['Rooms', 0.07, 'rooms'], ['People at full capacity', 0.13, 'people'], ['Load', 0.12, 'load'],
];
const TABLE_HEAD = '<thead><tr>' + COLUMNS.map(([label]) => '<th scope="col">' + esc(label) + '</th>').join('') + '</tr></thead>';

// ---- measuring what a sheet holds, in millimetres, from the text as fitPlan does (evacuation-poster.js)
const MM_PER_PT = 25.4 / 72;
// the pack's own rows and lines are never taller than this fraction of a sheet's room: the estimate errs long
const SLACK_MM = 3;
const SLACK_SHARE = 0.03;

// characters counted by width: a CJK character is about two Latin ones
function weigh(text) {
  let n = 0;
  for (const character of String(text)) n += character.codePointAt(0) >= 0x2e80 ? 1.8 : 1;
  return n;
}

// the lines of `text` in a column `width` mm wide, set `size` mm high
function linesOf(text, width, size) {
  return wrapped(weigh(text), width, size);
}

// A heading line cannot be shorter than the head the sheet draws: the school line, the headline, the rule.
function headMm(box) {
  return headerMm(box, 1, 'Map pack · ' + EXITS_WHAT + ' (continued)', 18);
}

// Greedy: items (their heights) into sheets, the first with `first` mm of room and the rest `later`;
// `after` mm of something that follows the last item (a line, or the closing line) must fit on the
// last sheet too, else the last item goes to a sheet of its own, so nothing falls onto a sheet nobody counted.
function chunkBy(heights, first, later, after) {
  const groups = [{ items: [], used: 0, room: first }];
  heights.forEach((height, index) => {
    let at = groups[groups.length - 1];
    if (at.items.length > 0 && at.used + height > at.room) {
      at = { items: [], used: 0, room: later };
      groups.push(at);
    }
    at.items.push(index);
    at.used += height;
  });
  const last = groups[groups.length - 1];
  if (after > 0 && last.items.length > 1 && last.used + after > last.room) {
    const moved = last.items.pop();
    last.used -= heights[moved];
    groups.push({ items: [moved], used: heights[moved], room: later });
  }
  return groups.map((group) => group.items);
}

const EXITS_WHAT = 'Exits and assembly points';

// A name inside a sentence, isolated from the words round it (U+2068, U+2069), as the poster does: a
// right-to-left name, or a number first, cannot reorder the sentence. The pinned tag list of a print has no <bdi>.
function iso(value) {
  return FSI + esc(value) + PDI;
}

// `text` as markup with the first appearance of each of `names` isolated.
function isolated(text, names) {
  const list = Array.from(new Set(names.filter((each) => typeof each === 'string' && each.trim() !== ''))).sort((a, b) => b.length - a.length);
  if (list.length === 0) return esc(text);
  const pattern = new RegExp(list.map((each) => each.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const used = new Set();
  let out = '';
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    if (used.has(match[0])) continue;
    used.add(match[0]);
    out += esc(text.slice(from, match.index)) + iso(match[0]);
    from = match.index + match[0].length;
  }
  return out + esc(text.slice(from));
}

// A running head: the typed names in it are isolated when they hold anything but ASCII (a plain
// name needs none, and the head stays the words it reads as).
function headOf(what, names) {
  const risky = names.filter((each) => typeof each === 'string' && each.trim() !== '' && /[^ -~]/.test(each) && what.includes(each));
  if (risky.length === 0) return what;
  const list = risky.sort((a, b) => b.length - a.length);
  let out = '';
  let rest = what;
  while (rest !== '') {
    const hit = list.find((each) => rest.startsWith(each));
    if (hit) {
      out += FSI + hit + PDI;
      rest = rest.slice(hit.length);
    } else {
      out += rest[0];
      rest = rest.slice(1);
    }
  }
  return out;
}

// The exits section's sheets: the table (as many rows to a sheet as the sheet holds, measured), then the missing rooms.
//   context { paper, last (the pack ends with this section), cards, posters (those sections are in the pack) }
function exitsPages(project, context) {
  const { exits, missing, load, rooms } = exitsData(project);
  const box = printableBox(context.paper);
  const scale = sheetScale(box);
  const size = (pt) => pt * scale * MM_PER_PT;
  const style = ' style="--exits-scale: ' + Math.round(scale * 100) / 100 + ';"';
  const room = box.height - headMm(box) - (SLACK_MM + SLACK_SHARE * box.height) - (size(12) * 1.25 + 1.5);
  const foot = context.last ? FOOT_MM : 0;
  const what = EXITS_WHAT;
  const out = [];
  // the lines over the table, with the room each takes
  const lead = [];
  let leadMm = 0;
  const say = (html, plain, pt, across) => {
    lead.push(html);
    leadMm += linesOf(plain, Math.min(box.width, across), size(pt)) * size(pt) * 1.4 + 2.5;
  };
  if (exits.length === 0) say('<p class="doc-lead" data-line="no-exit">' + esc(NO_EXIT_SAYS) + '</p>', NO_EXIT_SAYS, 11, 170 * scale);
  // far more than the others is a warning; a building with one way out gets the same sentence as a note
  if (load.sentence) {
    const heavy = load.heavy.length > 0;
    const words = load.sentenceParts.map((part) => (part.name ? iso(part.text) : esc(part.text))).join('');
    say('<p class="doc-lead" data-line="' + (heavy ? 'heavy' : 'one-exit') + '">' + (heavy ? '<span style="font-weight: 700;">Warning</span> ' : '') + words + '</p>', (heavy ? 'Warning ' : '') + load.sentence, 11, 170 * scale);
  }
  const basis = basisWords(load);
  if (basis !== '') say('<p class="doc-meaning" data-line="basis">' + esc(basis) + '</p>', basis, 9, box.width);
  // a building with every way out says so, on the table's last sheet: only when it has an exit and a room to say it of
  const allOut = missing.length === 0 && exits.length > 0 && rooms > 0;
  const allOutMm = allOut ? 3 + linesOf(ALL_HAVE_WAY, box.width, size(9)) * size(9) * 1.4 + 2.5 : 0;

  const cellsMm = (key, text, bold) => {
    const share = COLUMNS.find(([, , id]) => id === key)[1];
    const type = size(9) * (bold ? 1.1 : 1);
    return linesOf(text, box.width * share - 4 * scale, type) * type * 1.4 + 2.4 * scale + 0.2;
  };
  const headMmRow = Math.max(...COLUMNS.map(([label, share]) => linesOf(label, box.width * share - 4 * scale, size(8) * 1.1) * size(8) * 1.1 * 1.4 + 2.4 * scale + 0.2));
  const heights = exits.map((exit) => {
    const cells = cellsOf(exit);
    return Math.max(cellsMm('exit', cells.exit, true), ...['floor', 'assembly', 'rooms', 'people', 'load'].map((key) => cellsMm(key, key === 'load' ? cells.load : cells[key], false)));
  });
  const groups = chunkBy(heights, room - leadMm - (exits.length > 0 ? headMmRow : 0), room - headMmRow, allOutMm + (missing.length === 0 ? foot : 0));
  groups.forEach((group, index) => {
    const body = ['<section class="doc-section mpack__exits" data-section="exits"' + style + '><h2>' + esc(what) + (index > 0 ? esc(' (continued)') : '') + '</h2>'];
    if (index === 0) body.push(...lead);
    if (group.length > 0) body.push('<table class="doc-table doc-table--exits">' + TABLE_HEAD + '<tbody>' + group.map((at) => exitRow(exits[at])).join('') + '</tbody></table>');
    if (allOut && index === groups.length - 1) body.push('<p class="doc-meaning" data-line="all-out" style="margin-top: 3mm;">' + esc(ALL_HAVE_WAY) + '</p>');
    body.push('</section>');
    out.push({ what, body: body.join('\n') });
  });
  if (missing.length === 0) return out;

  const n = missing.length;
  const because = [];
  if (context.cards) because.push(n === 1 ? 'its door card says so' : 'their door cards say so');
  if (context.posters) because.push(n === 1 ? 'its route is missing from the posters' : 'their routes are missing from the posters');
  const intro = count(n, 'room') + (n === 1 ? ' has' : ' have') + ' no way out' + (because.length > 0 ? ', so ' + because.join(' and ') : '') + '.';
  const introMm = linesOf(intro, Math.min(box.width, 170 * scale), size(11)) * size(11) * 1.4 + 2.5;
  const itemsMm = missing.map((row) => linesOf(row.sentence + (row.onlyByElevator ? ' ' + doorCards.ELEVATOR_SAYS : ''), box.width - 6 * scale, size(10)) * size(10) * 1.4);
  chunkBy(itemsMm, room - introMm, room, foot).forEach((group, index) => {
    const head = index === 0 ? NO_WAY_OUT_HEAD : NO_WAY_OUT_HEAD + ' (continued)';
    const items = group.map((at) => {
      const row = missing[at];
      return '<li data-room="' + esc(row.roomId) + '"><span dir="auto">' + isolated(row.sentence, row.names) + '</span>' + (row.onlyByElevator ? ' ' + esc(doorCards.ELEVATOR_SAYS) : '') + '</li>';
    }).join('');
    const lead = index === 0 ? '<p class="doc-lead">' + esc(intro) + '</p>' : '';
    out.push({ what, body: '<section class="doc-section mpack__exits" data-section="no-way-out"' + style + '><h2>' + esc(head) + '</h2>' + lead + '<ul class="card-cover__missing">' + items + '</ul></section>' });
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
    '<ul class="card-cover__list mpack__list" data-list="contents">' + lines.join('') + '</ul>',
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
  const named = [];
  for (const floor of project.building.floors) {
    named.push(floor.name);
    for (const corridor of floor.corridors || []) named.push(corridor.name);
  }
  const base = { ...opts, floorId: 'all', traceImage: false, traceImages: undefined, roomIds: undefined, by: 'floor', corridorIds: undefined, sections: undefined };
  const out = [];
  const listed = [];
  const run = (section, made, note) => {
    const label = SECTIONS.find((each) => each.id === section).label;
    listed.push({ id: section, label, sheets: sheetsOf(made), note });
    for (const page of made) out.push({ what: headOf('Map pack · ' + (page.what || label), named), body: page.body });
  };
  for (const section of wanted) {
    if (section === 'plans') run(section, floorPlan.pages(project, derived, base), 'one a floor');
    else if (section === 'lockdown') run(section, lockdownMap.pages(project, derived, base), 'one a floor');
    else if (section === 'posters') run(section, evacuationPoster.pages(project, derived, base), 'one a floor');
    else if (section === 'exits') run(section, exitsPages(project, { paper, last: wanted[wanted.length - 1] === 'exits', cards: wanted.includes('cards'), posters: wanted.includes('posters') }), '');
    else if (section === 'cards') {
      const made = doorCards.pages(project, derived, { ...base, last: wanted[wanted.length - 1] === 'cards' });
      // a building with no room has no card: the module's one sheet saying so is not printed, the cover says it
      run(section, made.length === 1 && !made[0].what ? [] : made, 'one or two sheets a room');
    } else if (section === 'step-free') run(section, stepFree.pages(project, derived, base), '');
  }
  return [{ what: 'Map pack', body: coverBody(project, opts, listed) }].concat(out);
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
