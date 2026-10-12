// The movement picture on paper (spec 7.7, 17): what the movement view shows,
// under a header that says the school, what is shown, the day type, the
// transition and its passing time; then, each by choice, the legend of the
// groups on the map, the colour scale in numbers, and the hotspot table.
//
// render(project, derived, options) → { title, html }
//   derived            the results the planner already has: { results, graph }
//                      (store.derived.results() and buildGraph's graph), or
//                      the results alone. Left out, they are worked out here
//                      from the project by the same pipeline the planner uses.
//   options.movement   { choice, parts, picture }
//     choice    what the map shows (ui/movement/model.js); left out, every
//               group on the first day type, all transitions
//     parts     { legend, scale, hotspots }: false leaves a part off the
//               paper; each is on when left out
//     picture   { url, width, height }: the map as an image, a data: address
//               of a PNG or JPEG drawn by the Export tab from the model.
//               Anything else is not put in the document.
//   and what every output takes (document.js)
//
// The preview sheet hands an output its paper, the date and where the
// stylesheets are, and nothing else. What the Export tab chose is therefore
// left here by it before the sheet opens (`askFor`), and read when
// options.movement is not given. A caller that gives options.movement gets
// exactly that.
//
// Shared with the congestion report (./congestion.js):
//   movementResults(project, derived) → { results, graph }
//   keepResults(project, results, graph)   hand it the planner's own answer
//   shownSentence(project, picture), colourSentence(picture)   what is shown, in words
//   placesTable(rows, options)        the hotspot table as markup
//   bandLines(band)                   the pattern that stands beside a band's
//                                     colour on paper: [[x1, y1, x2, y2], …] in a unit square
//                                     (the Export tab draws them on the picture; lineWords(band) says them)
//   seconds(n)                        "4 min 35 s"

import { createPipeline } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { formatDuration } from '../../engine/findings.js';
import { LOAD_BANDS, parse, toHex } from '../colour.js';
import { count, list } from '../components/words.js';
import { defaultChoice, settleChoice, pictureOf, groupRows, routeHealth, unitWord } from '../movement/model.js';
import { hotspotRows, groupWords } from '../movement/hotspots.js';
import { bandText } from '../movement/legend.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';

export const id = 'movement';
export const name = 'Movement picture';

// How many places the table on paper holds.
export const PLACES_ON_PAPER = 10;
// Room on the sheet for the header and the sentences above the picture.
const HEADER_MM = 44;
const CAPTION_MM = 10;

const BAND_WORDS = ['quiet', '', '', '', 'busy'];

let held = null;

// What the Export tab chose, for the next document the preview sheet asks for.
export function askFor(movement) {
  held = movement || null;
}

export const seconds = formatDuration;

// ---------------------------------------------------------------- the results

let memo = null;

function settingsKey(project) {
  const s = project.settings;
  return [s.periods, s.secondsPerCell, s.secondsPerStair, s.defaultHeadCount, s.defaultPassingSeconds, s.checks ? s.checks.passingMarginSeconds : 0].join('|');
}

// The routes, loads, crowd results, places and walks of a project, and its
// graph. What the planner has is used as it is; otherwise the pipeline runs
// here, and its last answer is kept while the building, the groups, the day
// types and the settings it reads are the same objects and values.
export function movementResults(project, derived) {
  if (derived && derived.results && derived.results.routes) return { results: derived.results, graph: derived.graph || buildGraph(project) };
  if (derived && derived.routes) return { results: derived, graph: buildGraph(project) };
  const key = settingsKey(project);
  if (memo && memo.building === project.building && memo.groups === project.groups && memo.dayTypes === project.dayTypes && memo.key === key) return memo.value;
  const value = { results: createPipeline().run(project), graph: buildGraph(project) };
  memo = { building: project.building, groups: project.groups, dayTypes: project.dayTypes, key, value };
  return value;
}

// The planner's own answer for a project, kept so that the document the
// preview sheet asks for next does not work it out a second time.
export function keepResults(project, results, graph) {
  if (!project || !results || !graph) return;
  memo = { building: project.building, groups: project.groups, dayTypes: project.dayTypes, key: settingsKey(project), value: { results, graph } };
}

// ---------------------------------------------------------------- pieces

// A square of a data colour. It is a border, which a browser prints whether
// or not it prints backgrounds, and the only value in its style is a colour
// this module wrote out itself (toHex, or a band's own).
function square(fill) {
  return '<span class="doc-swatch" style="display: inline-block; width: 0; height: 3mm; border-left: 3mm solid ' + esc(fill) + '; outline: 0.2mm solid #1f2328; vertical-align: -0.5mm;"></span>';
}

function colourOf(value) {
  return parse(value) ? toHex(value) : '#888888';
}

// Band 1 has no lines; each band after it has one more, evenly spread,
// running up from left to right. On paper with no colour the bands still
// read apart, and the busier the band the denser its lines.
export function bandLines(band) {
  const n = Math.max(0, Math.min(4, band - 1));
  const lines = [];
  for (let i = 1; i <= n; i += 1) {
    // the line x + y = c, for c spread over (0, 2)
    const c = (2 * i) / (n + 1);
    lines.push(c <= 1 ? [0, c, c, 0] : [c - 1, 1, 1, c - 1]);
  }
  return lines;
}

// The pattern in words, for the scale's table.
export function lineWords(band) {
  const n = bandLines(band).length;
  return n === 0 ? 'No lines' : n === 1 ? '1 line' : n + ' lines';
}

function typed(parts) {
  return parts.map((part) => esc(part.text)).join('');
}

// The hotspot table. options: { limit, total } (total: the day's total, where
// no one transition is the peak).
export function placesTable(rows, options) {
  const opts = options || {};
  const shown = rows.slice(0, Number.isInteger(opts.limit) ? opts.limit : PLACES_ON_PAPER);
  const out = ['<table class="doc-table doc-table--places">',
    '<thead><tr><th scope="col" class="is-number">Rank</th><th scope="col">Place</th><th scope="col" class="is-number">Load</th><th scope="col">Band</th>'
      + (opts.total ? '' : '<th scope="col">Peaks in</th>') + '<th scope="col">Groups</th><th scope="col" class="is-number">Delay</th></tr></thead>',
    '<tbody>'];
  for (const row of shown) {
    out.push('<tr>'
      + '<td class="is-number">' + row.rank + '</td>'
      + '<th scope="row">' + typed(row.parts) + (row.floorName ? ' on ' + esc(row.floorName) : '') + '</th>'
      + '<td class="is-number">' + row.load + ' ' + unitWord(row.unit, row.load) + '</td>'
      + '<td>' + square(LOAD_BANDS[Math.max(1, row.band) - 1]) + ' ' + row.band + '</td>'
      + (opts.total ? '' : '<td>' + esc(row.when) + '</td>')
      + '<td>' + esc(groupWords(row).join(', ')) + '</td>'
      + '<td class="is-number">' + (row.delay === null ? '' : row.delay === 0 ? 'none' : esc(seconds(row.delay))) + '</td>'
      + '</tr>');
  }
  out.push('</tbody></table>');
  return out.join('\n');
}

// "every group (8)", "3 groups of grade 7", "6A", "6A, 6B and 7A"
function whoWords(project, picture) {
  const n = picture.groups.length;
  if (n === 1) return picture.groups[0].name;
  if (picture.choice.who === 'grade') return count(n, 'group') + ' of grade ' + (picture.choice.grade === '' ? '(none)' : picture.choice.grade);
  if (n === project.groups.length) return 'every group (' + n + ')';
  return list(picture.groups.map((group) => group.name));
}

export function shownSentence(project, picture) {
  if (picture.groups.length === 0) return 'Nothing is shown: no group is chosen.';
  const t = picture.transition;
  const when = t
    ? t.name + (t.times ? ', ' + t.times : '') + ', ' + seconds(t.seconds) + ' of passing time'
    : 'all ' + count(picture.transitions.length, 'transition') + ' of the day';
  return 'Showing ' + whoWords(project, picture) + ' on ' + picture.dayTypeName + ': ' + when + '.';
}

export function colourSentence(picture) {
  if (picture.mode === 'single') return 'The line is the group\'s own colour.';
  if (!picture.load) return '';
  const many = unitWord(picture.load.unit, 2);
  if (picture.load.measure === 'transition') return 'Corridors are coloured by the ' + many + ' crossing each cell in this transition.';
  return picture.load.measure === 'total'
    ? 'Corridors are coloured by the total over the day: the ' + many + ' crossing each cell, every transition added up.'
    : 'Corridors are coloured by the busiest moment: the most ' + many + ' crossing each cell in any one transition.';
}

const PICTURE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

function figure(project, picture, image, options) {
  const ok = image && typeof image.url === 'string' && PICTURE.test(image.url) && image.width > 0 && image.height > 0;
  if (!ok) return '<p class="doc-none">The map itself is added when this is printed from the Export tab of the movement view.</p>';
  const box = printableBox(paperOf(project, options));
  const scale = Math.min(box.width / image.width, (box.height - HEADER_MM - CAPTION_MM) / image.height);
  const floors = picture.floors.map((floor) => floor.name);
  const words = 'The movement map: ' + list(floors) + '.';
  return '<figure class="plan-figure">'
    + '<div class="plan-figure__plan" style="width: ' + mm(image.width * scale) + '; height: ' + mm(image.height * scale) + ';">'
    + '<svg class="plan" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + Math.round(image.width) + ' ' + Math.round(image.height) + '" role="img" aria-label="' + esc(words) + '">'
    + '<image width="' + Math.round(image.width) + '" height="' + Math.round(image.height) + '" href="' + esc(image.url) + '"/></svg>'
    + '</div>'
    + '<figcaption class="plan-figure__caption">' + esc(words) + '</figcaption>'
    + '</figure>';
}

function legendSection(project, results, picture) {
  const rows = groupRows(project, results, picture);
  if (rows.length === 0) return '';
  const out = ['<section class="doc-section">', '<h2>Groups on the map</h2>',
    '<table class="doc-table doc-table--groups">',
    '<thead><tr><th scope="col">Group</th><th scope="col" class="is-number">Walking over the day</th><th scope="col" class="is-number">Lost to crowds</th><th scope="col">Stairs</th><th scope="col">Late</th><th scope="col">Failed routes</th></tr></thead>',
    '<tbody>'];
  for (const row of rows) {
    out.push('<tr><th scope="row">' + square(colourOf(row.group.colour)) + ' ' + esc(row.group.name) + '</th>'
      + '<td class="is-number">' + esc(seconds(row.walking)) + '</td>'
      + '<td class="is-number">' + (row.waiting === 0 ? 'none' : esc(seconds(row.waiting))) + '</td>'
      + '<td>' + (row.stairs ? 'Yes' : 'No') + '</td>'
      + '<td>' + (row.late === 0 ? 'Never' : row.late === 1 ? 'Once' : row.late + ' times') + '</td>'
      + '<td>' + (row.failed === 0 ? 'None' : row.failed) + '</td></tr>');
  }
  out.push('</tbody></table>', '</section>');
  return out.join('\n');
}

function scaleSection(picture) {
  if (picture.mode !== 'load' || !picture.load) return '';
  const load = picture.load;
  const many = unitWord(load.unit, 2);
  const how = load.mode === 'absolute'
    ? 'The scale is absolute: fixed loads the school set, so two pictures compare.'
    : 'The scale is relative: fifths of the busiest cell on the map, ' + load.max + '.';
  const zones = load.zones === 0 ? 'No exclusion zones.' : count(load.zones, 'exclusion zone') + (load.zones === 1 ? ' is' : ' are') + ' left out of the scale.';
  const out = ['<section class="doc-section">', '<h2>Colour scale</h2>',
    '<p class="doc-meaning">' + esc(how + ' ' + zones + ' On the map each band has its own number of slanting lines in a cell, for paper with no colour.') + '</p>',
    '<table class="doc-table doc-table--scale">',
    '<thead><tr><th scope="col">Band</th><th scope="col">' + esc(many[0].toUpperCase() + many.slice(1)) + ' crossing a cell</th><th scope="col">Lines on the map</th></tr></thead>',
    '<tbody>'];
  for (const edge of load.edges) {
    out.push('<tr><th scope="row">' + square(LOAD_BANDS[edge.band - 1]) + ' ' + edge.band + (BAND_WORDS[edge.band - 1] ? ', ' + BAND_WORDS[edge.band - 1] : '') + '</th>'
      + '<td>' + esc(bandText(edge, true)) + '</td><td>' + esc(lineWords(edge.band)) + '</td></tr>');
  }
  out.push('</tbody></table>', '</section>');
  return out.join('\n');
}

function placesSection(project, results, graph, picture) {
  const rows = hotspotRows(project, results, graph, picture);
  if (rows.length === 0) return '<section class="doc-section">\n<h2>Busiest places</h2>\n<p class="doc-none">Nobody on the map crosses a corridor.</p>\n</section>';
  const total = picture.choice.transition === null && picture.choice.measure === 'total';
  const tail = rows.length > PLACES_ON_PAPER ? 'The ' + PLACES_ON_PAPER + ' busiest of ' + rows.length + ' places anyone crosses. ' : '';
  return ['<section class="doc-section">', '<h2>Busiest places</h2>',
    '<p class="doc-meaning">' + esc(tail + 'Delay is the waiting the crowd model found at the place' + (total ? ' over the day' : ' in the transition named') + ', with every group of the school walking.') + '</p>',
    placesTable(rows, { total }),
    '</section>'].join('\n');
}

export function render(project, derived, options) {
  const opts = options || {};
  const asked = opts.movement || held || {};
  const parts = asked.parts || {};
  const { results, graph } = movementResults(project, derived);
  const choice = settleChoice(project, asked.choice || defaultChoice(project));
  const picture = pictureOf(project, results, graph, choice);

  const lines = [shownSentence(project, picture), colourSentence(picture)];
  if (picture.failed.length > 0) lines.push(count(picture.failed.length, 'route') + ' failed and ' + (picture.failed.length === 1 ? 'is' : 'are') + ' not drawn.');
  else if (routeHealth(project, results).length > 0 && picture.groups.length > 0) lines.push('No route failed here.');
  const body = ['<p class="doc-lead">' + esc(lines.filter((line) => line !== '').join(' ')) + '</p>'];
  if (picture.groups.length > 0) {
    body.push(figure(project, picture, asked.picture, opts));
    if (parts.legend !== false) body.push(legendSection(project, results, picture));
    if (parts.scale !== false) body.push(scaleSection(picture));
    if (parts.hotspots !== false) body.push(placesSection(project, results, graph, picture));
  }
  return frame(project, { output: id, what: name, pages: [{ body: body.filter((part) => part !== '').join('\n') }], options: opts });
}
