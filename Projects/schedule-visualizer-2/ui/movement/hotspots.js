// The Hotspots tab of the movement view's inspector (spec 7.4): the busiest
// places, ranked. A row gives where, the load, the transition in which it
// peaks, the groups that walk there and the delay the crowd model found
// there. A row opens to its cells; a click on a row moves the map to the
// place and outlines it; the top few places carry a ring on the map, which
// pulses a few times when the ranking changes and is still under reduced
// motion.
//
//   hotspotsPanel(env) -> { element, update(state), unmount() }
//
// `env` and `state` are described at the top of ./index.js. The panel's
// element carries `hotspots` for the tests and the console:
//   { rows, elsewhere, selected, rings, moving, layer, frames }: the rows on
//   show, how many ranked places are on floors not shown, the id of the place
//   a click chose, the rings last drawn [{ rank, x, y, r }] in the map's own
//   pixels, whether they are pulsing, the canvas the rings and the pulse are
//   drawn on (the map's marks', env.layer), and how many ticks of the pulse
//   asked for it to be drawn.
//
// What is ranked is what is on the map: the groups shown, the day type, the
// busiest moment, the total over the day or the one transition chosen, and
// the floors shown. A place is a row when an end of it is on a floor shown,
// so the first row is the legend's busiest load and a band here is a band
// there; the places on other floors are counted in one line under the table.
// The ranking itself, what a place is and what it is called are the engine's
// (engine/places.js hotspots(), places()); a band is engine/load.js bandOf().
// The delay is the crowd model's, and that model always walks every group.
//
//   hotspotRows(project, results, graph, picture) -> rows, busiest first: the
//     places with an end on a floor the picture shows, ranked from 1
//     { rank, id, place, parts, floorName, load, unit, band, peak, when,
//       groups: [{ group, times, count }], delay, dayDelay,
//       cells: [{ floorId, cell, load, excluded }],   busiest first; none for a stairs connection
//       ends:  [{ floorId, cell }] }                  where the map goes: the place's cells, or a connection's two ends
//     floorName is the floor's name when another place has the same name
//     ("West" on two floors), else ''.
//   placesElsewhere(project, results, graph, picture) -> how many ranked
//     places have no end on a floor the picture shows
//   rankedPlaces(project, results, graph, asked) -> the same rows for anything
//     that names what it wants ranked without a picture (the congestion
//     report): every place of the building
//   hotspotsCsv(project, rows, picture) -> rows of cells for engine/csv.js
//   groupHeadings(groups) -> the headings of the file's group columns
//   pulseFrame(g, rings, left, theme)   one frame of the pulse: the ring that
//     travels out from each ring, and nothing else
//   createPulse(options) -> { start(), stop(), moving }   the pulse's clock
//   cellWords(floor, cell) -> "Column 6, row 4"
//   placeWords(row), groupWords(row)   a row's place and its groups as words

import { h, uid } from '../components/dom.js';
import { count } from '../components/words.js';
import { hotspots } from '../../engine/places.js';
import { bandOf } from '../../engine/load.js';
import { formatDuration } from '../../engine/findings.js';
import { unitWord, runOf } from './model.js';

// How many places carry a ring on the map.
export const PULSE_TOP = 3;
// How many rows the table opens with.
export const TABLE_FIRST = 10;
// One pulse, and how many of them follow a change of the ranking.
export const PULSE_MS = 2400;
export const PULSE_TIMES = 3;
const PULSE_FRAME_MS = 60;

const kept = new WeakMap();

// The load with every transition but one emptied, so that hotspots() ranks
// that transition alone by its own rule.
function loadIn(load, period) {
  const only = (part) => ({ ...part, byTransition: part.byTransition.map((counts, t) => (t === period ? counts : new Int32Array(counts.length))) });
  return { ...load, cells: only(load.cells), connections: only(load.connections) };
}

// The ranking for anything that can say what it wants ranked:
//   asked = { dayTypeId, bellsId (null for regular bells), groups, load (loads()'s result for those groups),
//             max (the load the relative bands are fifths of),
//             transition (a period, or null), measure, transitions (transitionsOf()) }
export function rankedPlaces(project, results, graph, asked) {
  if (!project || !results || !graph || !asked || !asked.load || !results.places) return [];
  const bellsId = typeof asked.bellsId === 'string' ? asked.bellsId : null;
  const run = runOf(results, asked.dayTypeId, bellsId);
  const day = run.routes;
  if (!day) return [];
  const shown = new Set(asked.groups.map((group) => group.id));
  // the routes of the groups shown, in the shape routesByRun gives: the run's own entry, under bells when there are some
  const mine = { days: [], bells: [] };
  (bellsId === null ? mine.days : mine.bells).push({ ...day, groups: day.groups.filter((entry) => shown.has(entry.groupId)) });
  const period = Number.isInteger(asked.transition) ? asked.transition : null;
  const crowd = run.crowd;
  const ranked = hotspots(project, mine, asked.dayTypeId, {
    graph,
    places: results.places,
    load: period === null ? asked.load : loadIn(asked.load, period),
    crowd: crowd || undefined,
    measure: period === null && asked.measure === 'total' ? 'total' : 'busiest',
    bellsId,
  });

  const names = new Map();
  for (const place of results.places.places) {
    if (place.kind !== 'connection') names.set(place.name, (names.get(place.name) || 0) + 1);
  }
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const groups = new Map(project.groups.map((group) => [group.id, group]));
  const connections = new Map(project.building.connections.map((connection) => [connection.id, connection]));
  const scale = project.settings.colourScale;

  return ranked.map((row, index) => {
    const place = row.place;
    const floor = floors.get(place.floorId);
    const connection = place.kind === 'connection' ? connections.get(place.connectionId) : null;
    return {
      rank: index + 1,
      id: place.id,
      place,
      parts: place.parts,
      floorName: place.kind !== 'connection' && names.get(place.name) > 1 && floor && floor.name !== place.name ? floor.name : '',
      load: row.load,
      unit: row.unit,
      band: bandOf(row.load, scale, asked.max),
      peak: row.peak,
      when: row.peak === null ? '' : (asked.transitions.find((each) => each.period === row.peak) || { name: '' }).name,
      groups: row.groups.filter((each) => groups.has(each.groupId)).map((each) => ({ group: groups.get(each.groupId), times: each.times, count: each.count })),
      delay: row.delay,
      dayDelay: row.dayDelay,
      cells: row.cells.map((cell) => ({ floorId: place.floorId, cell: cell.cell, load: cell.load, excluded: cell.excluded })),
      ends: connection ? [connection.a, connection.b].map((end) => ({ floorId: end.floorId, cell: end.cell })) : place.cells.map((cell) => ({ floorId: place.floorId, cell })),
    };
  });
}

// The ranking of what a picture of the map shows (model.js pictureOf): the
// places with an end on a floor shown, and how many places are elsewhere.
function ranking(project, results, graph, picture) {
  if (!picture || !picture.load) return { rows: [], elsewhere: 0 };
  const held = kept.get(picture);
  if (held) return held;
  const all = rankedPlaces(project, results, graph, {
    dayTypeId: picture.dayTypeId,
    bellsId: picture.bellsId,
    groups: picture.groups,
    load: picture.load.source,
    max: picture.load.max,
    transition: picture.choice.transition,
    measure: picture.choice.measure,
    transitions: picture.transitions,
  });
  const shown = new Set(picture.floors.map((floor) => floor.id));
  const rows = all.filter((row) => row.ends.some((end) => shown.has(end.floorId))).map((row, index) => ({ ...row, rank: index + 1 }));
  const found = { rows, elsewhere: all.length - rows.length };
  if (results) kept.set(picture, found);
  return found;
}

export function hotspotRows(project, results, graph, picture) {
  return ranking(project, results, graph, picture).rows;
}

export function placesElsewhere(project, results, graph, picture) {
  return ranking(project, results, graph, picture).elsewhere;
}

// A cell the way the building editor's status line names one.
export function cellWords(floor, cell) {
  return 'Column ' + ((cell % floor.width) + 1) + ', row ' + (Math.floor(cell / floor.width) + 1);
}

// A place's name as one string, with its floor when the name alone is shared.
export function placeWords(row) {
  return row.place.name + (row.floorName ? ' on ' + row.floorName : '');
}

// The groups of a row, each as typed, with "×3" after a group that crosses
// in more than one transition.
export function groupWords(row) {
  return row.groups.map((each) => each.group.name + (each.times > 1 ? ' ×' + each.times : ''));
}

// The headings of the group columns of the hotspots file. A group's column
// is headed by its name exactly as typed, which is all there is to it for a
// school whose groups have names of their own. Three things are told apart,
// so that no two headings of the file are the same and none is empty:
//   a group with no name            "(group with no name)"
//   a name that is a fixed heading  "Rank (group)", "Groups (group)"
//   a name another group has        the second and later, in the project's
//                                   order: "7A (2nd of that name)"
// Two headings are the same when they differ only by case or by spaces at
// either end, since a spreadsheet reads them as one ("7a", " 7A "), and a
// heading made here is never a name a group has as typed: a group really
// named "7A (2nd of that name)" keeps it, and the made one goes on to
// "(again)" (SV2-52).
// `fixed` is the headings of the columns before them.
function nth(n) {
  const tens = n % 100;
  const ones = n % 10;
  return n + (tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th');
}
const headingKey = (text) => text.trim().toLowerCase();
export function groupHeadings(groups, fixed) {
  const nameOf = (group) => (typeof group.name === 'string' ? group.name : '');
  const fixedKeys = new Set(fixed.map(headingKey));
  const typed = new Set(groups.map((group) => headingKey(nameOf(group))).filter((key) => key !== ''));
  const taken = new Set(fixedKeys);
  const seen = new Map();
  return groups.map((group) => {
    const name = nameOf(group);
    let heading = name.trim() === '' ? '(group with no name)' : name;
    if (fixedKeys.has(headingKey(heading))) heading += ' (group)';
    // a made heading that is another group's real name is not that name's first: it is kept apart below
    const borrowed = heading !== name && typed.has(headingKey(heading));
    const times = borrowed ? 1 : (seen.get(headingKey(heading)) || 0) + 1;
    if (!borrowed) seen.set(headingKey(heading), times);
    if (times > 1) heading += ' (' + nth(times) + ' of that name)';
    // a heading made here that another group has as its name, or one already used, is kept apart
    const made = heading !== name;
    while (taken.has(headingKey(heading)) || (made && typed.has(headingKey(heading)))) heading += ' (again)';
    taken.add(headingKey(heading));
    return heading;
  });
}

// The table as a file. After the fixed columns there is one column a group
// on the map, headed by the group's name exactly as typed (groupHeadings,
// above, for the names that would not tell two columns apart), holding in
// how many transitions that group crosses the place (1 when one transition
// is counted) and nothing where it does not. A name is always a cell of its
// own: no separator a name could hold stands between two of them.
//   "When" is the transition a place peaks in (the busiest moment), the one
//   transition on the map, or "the whole day" when the map adds the day up.
export function hotspotsCsv(project, rows, picture) {
  const unit = rows.length > 0 ? rows[0].unit : picture && picture.load ? picture.load.unit : 'students';
  const shown = picture && Array.isArray(picture.groups) ? picture.groups : [];
  const fixed = ['Rank', 'Place', 'Floor', 'Kind', 'Load (' + unit + ')', 'When', 'Delay (seconds)', 'Delay over the day (seconds)', 'Cells', 'Groups'];
  const table = [[...fixed, ...groupHeadings(shown, fixed)]];
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const choice = picture && picture.choice ? picture.choice : { transition: null, measure: 'busiest' };
  const wholeDay = choice.transition === null && choice.measure === 'total';
  for (const row of rows) {
    const times = new Map(row.groups.map((each) => [each.group.id, each.times]));
    const place = row.place;
    const where = place.kind === 'connection'
      ? (place.floorIds || []).map((id) => (floors.get(id) ? floors.get(id).name : '')).filter((name, index, all) => all.indexOf(name) === index).join('; ')
      : floors.get(place.floorId) ? floors.get(place.floorId).name : '';
    table.push([
      row.rank,
      place.name,
      where,
      place.kind === 'connection' ? 'stairs' : place.kind,
      row.load,
      wholeDay ? 'the whole day' : picture && picture.transition ? picture.transition.name : row.when,
      row.delay === null ? '' : row.delay,
      row.dayDelay === null ? '' : row.dayDelay,
      place.kind === 'connection' ? '' : row.cells.length,
      row.groups.length,
      ...shown.map((group) => (times.has(group.id) ? times.get(group.id) : '')),
    ]);
  }
  return table;
}

// The state the map is drawn from now. The panel is told of a change only
// while its tab is the one on show, and the rings are on the map whatever
// the tab, so the map's own state is read where it is kept.
function stateNow(last) {
  const section = typeof document === 'undefined' ? null : document.querySelector('.mov');
  const movement = section ? section.movement : null;
  return movement && movement.state ? movement.state : last;
}

// A ring's rank is a small disc on the ring's line. Its place is the upper
// right; where another ring's rank is already there (two places a few cells
// apart, the map zoomed far out) it takes the next place round the ring that
// is free, so every number can be read. The rings themselves stay on their
// cells. The places are tried a third of the way round first, since three
// discs of this size are the most that stand clear of one another on the
// smallest ring, and then the places between.
//   rings   [{ rank, x, y, r }] in rank order; each gains { bx, by }
//   radius  the discs' radius: RANK_RADIUS, times the map's label scale in
//           presentation mode, where the number is larger (SV2-31c)
export const RANK_RADIUS = 8;
// A ring's radius on a map `size` px a cell: nine tenths of a cell, and at
// least 10 px times the label scale, so three discs of RANK_RADIUS times
// that scale still stand clear on the smallest ring (a 120 degree chord of
// 17.3 at 1, 26 at 1.5, against discs 17 and 25 apart; SV2-31d: at 1.5 the
// least stayed 10 and no two discs fitted clear on it).
export function ringRadius(size, scale = 1) {
  const k = scale > 0 ? scale : 1;
  return Math.max(Math.round(10 * k), Math.round(size * 0.9));
}
const RANK_PLACES = [-45, -165, 75, 135, -105, 15, -135, 45, 180, 0, 90, -90].map((degrees) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]);
export function placeRanks(rings, radius = RANK_RADIUS) {
  const placed = [];
  const clear = radius * 2 + 1;
  for (const ring of rings) {
    let best = null;
    let room = -1;
    for (const [dx, dy] of RANK_PLACES) {
      const at = { x: ring.x + ring.r * dx, y: ring.y + ring.r * dy };
      const nearest = placed.reduce((least, other) => Math.min(least, Math.hypot(other.x - at.x, other.y - at.y)), Infinity);
      if (nearest >= clear) {
        best = at;
        break;
      }
      // none is free: the one with the most room
      if (nearest > room) {
        room = nearest;
        best = at;
      }
    }
    ring.bx = best.x;
    ring.by = best.y;
    placed.push(best);
  }
  return rings;
}

// One frame of the pulse: from each ring, the ring that travels out and
// fades as it goes. `left` is 1 as a pulse sets out and 0 as it ends. A tick
// of the pulse draws the map's marks again (the rings, this, and playback's
// markers when there are any) on their own canvas and never the map, so what
// a tick costs does not grow with the building.
//   rings   [{ x, y, r }] in the map's own pixels
export function pulseFrame(g, rings, left, theme) {
  g.strokeStyle = theme.accent;
  g.lineWidth = 2;
  g.globalAlpha = left;
  for (const ring of rings) {
    g.beginPath();
    g.arc(ring.x, ring.y, ring.r * (1 + 0.7 * (1 - left)), 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
}

// The pulse's clock: PULSE_TIMES pulses of PULSE_MS from start(), a frame
// every PULSE_FRAME_MS, and nothing at all under reduced motion.
//   options   { now(), later(fn, ms) -> handle, cancel(handle), still() -> boolean,
//               frame(left), done() }
//   start()   set the pulses going (again); false when motion is reduced
//   stop()    no more frames: the timer is cleared
//   moving    are pulses still to come?
//   left()    how much of the pulse now running is left, 1 to 0
export function createPulse(options) {
  let until = 0;
  let timer = null;
  const left = () => (until === 0 ? 0 : ((until - options.now()) % PULSE_MS) / PULSE_MS);
  function tick() {
    timer = null;
    if (options.now() >= until || options.still()) {
      until = 0;
      options.done();
      return;
    }
    options.frame(left());
    timer = options.later(tick, PULSE_FRAME_MS);
  }
  return {
    start() {
      if (options.still()) {
        this.stop();
        return false;
      }
      until = options.now() + PULSE_MS * PULSE_TIMES;
      if (timer === null) tick();
      return true;
    },
    stop() {
      if (timer !== null) options.cancel(timer);
      timer = null;
      if (until !== 0) {
        until = 0;
        options.done();
      }
    },
    get moving() {
      return until !== 0;
    },
    left,
  };
}

function cellsLabel(row, isOpen) {
  return (isOpen ? 'Hide ' : 'Show ') + (row.cells.length === 1 ? 'its 1 cell' : 'its ' + row.cells.length + ' cells');
}

export function hotspotsPanel(env) {
  const base = uid('hot');
  const lead = h('p', { class: 'mov-hot__lead', data: { hotspots: 'lead' } });
  const body = h('tbody');
  const loadHead = h('th', { scope: 'col', class: 'table__num' }, 'Load');
  const table = h('table', { class: 'table mov-hot__table', data: { hotspots: 'table' } },
    h('caption', { class: 'vh' }, 'The busiest places, busiest first'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Place'),
      loadHead,
      h('th', { scope: 'col', class: 'table__num' }, 'Delay'))),
    body);
  const scroller = h('div', { class: 'mov-hot' }, table);
  const all = h('button', { type: 'button', class: 'mov-link mov-hot__all', hidden: true, data: { action: 'all-places' } });
  // the places the table leaves out because their floors are not on the map
  const elsewhereText = h('span');
  const allFloors = h('button', { type: 'button', class: 'mov-link', data: { action: 'all-floors' } }, 'Show all floors');
  const elsewhereLine = h('p', { class: 'mov-panel__note', hidden: true, data: { hotspots: 'elsewhere' } }, elsewhereText, ' ', allFloors);
  const notes = h('p', { class: 'mov-panel__note', data: { hotspots: 'notes' } });
  const element = h('div', { class: 'mov-panel', data: { panel: 'hotspots', pulse: 'none' } },
    h('h2', { class: 'mov-panel__title' }, 'Hotspots'),
    lead, scroller, all, elsewhereLine, notes);

  let last = null;
  let rows = [];
  let elsewhere = 0;
  let selected = null;
  let whole = false;
  const open = new Set();
  let topKey = '';
  let rings = [];
  const still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };
  // the inspector is a sheet over the map (ui/app.css): a phone
  const sheet = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px)') : { matches: false };

  function show(row, cells) {
    selected = row.id;
    // a stairs connection has an end on each of two floors: the one on the map is where the map goes
    const now = stateNow(last);
    const onMap = new Set(now ? now.picture.floors.map((floor) => floor.id) : []);
    const end = row.ends.find((each) => onMap.has(each.floorId)) || row.ends[0];
    if (end) env.show(end.floorId, cells || row.ends.filter((each) => each.floorId === end.floorId).map((each) => each.cell));
    env.paint();
    for (const each of body.querySelectorAll('.mov-hot__row')) {
      if (each.dataset.place === row.id) each.setAttribute('aria-current', 'true');
      else each.removeAttribute('aria-current');
    }
    env.ctx.announce('The map moved to ' + placeWords(row) + '.');
  }

  // A window that crosses 640 px: above it a place's cells open under its
  // row, and its button says whether they are open (aria-expanded); under it
  // the button shuts the sheet and moves the map, and says nothing of the
  // kind. The rows are drawn again for the width they are on, and a button
  // that had the focus has it again.
  function onSheet() {
    if (!last) return;
    const focused = document.activeElement;
    const held = focused && element.contains(focused) && focused.dataset.action ? { action: focused.dataset.action, place: focused.closest('[data-place]')?.dataset.place || null } : null;
    draw(last);
    if (!held) return;
    const again = [...element.querySelectorAll('[data-action="' + held.action + '"]')].find((each) => (each.closest('[data-place]')?.dataset.place || null) === held.place);
    if (again) again.focus();
  }
  if (typeof sheet.addEventListener === 'function') sheet.addEventListener('change', onSheet);

  function draw(state) {
    const picture = state.picture;
    const floors = new Map(state.project.building.floors.map((floor) => [floor.id, floor]));
    scroller.hidden = rows.length === 0;
    if (!picture.ready) {
      lead.textContent = 'Working out the routes.';
    } else if (picture.mode === 'empty') {
      lead.textContent = 'Nothing is shown, so there is nothing to rank. Choose a group, a grade or every group.';
    } else if (rows.length === 0) {
      lead.textContent = elsewhere > 0 ? 'Nobody on screen crosses a corridor on the floor shown, so there is nothing to rank here.' : 'Nobody on screen crosses a corridor, so there is nothing to rank.';
    } else {
      const what = picture.transition ? 'in ' + picture.transition.name : picture.choice.measure === 'total' ? 'added up over the day' : 'at its busiest moment';
      const who = picture.groups.length === state.project.groups.length ? 'every group' : count(picture.groups.length, 'group');
      // with one floor on the map, the table is that floor's
      const floor = picture.floors.length < state.project.building.floors.length && picture.floors.length === 1 ? [' on ', h('bdi', null, picture.floors[0].name)] : [];
      lead.replaceChildren(rows.length === 1 ? 'The one place anyone crosses' : 'The ' + rows.length + ' places anyone crosses', ...floor, (rows.length === 1 ? '' : ', busiest first') + ': ' + who + ' on ', h('bdi', null, picture.dayTypeName), ', each place ' + what + '. Choose a place to see it on the map.');
    }
    elsewhereLine.hidden = !picture.ready || elsewhere === 0;
    elsewhereText.textContent = count(elsewhere, 'more place') + ' on floors not shown.';

    // the unit is said once, at the head of the column
    loadHead.textContent = rows.length === 0 ? 'Load' : rows[0].unit === 'groups' ? 'Groups' : 'Students';
    const list = whole ? rows : rows.slice(0, TABLE_FIRST);
    all.hidden = rows.length <= TABLE_FIRST;
    all.textContent = whole ? 'Show the first ' + TABLE_FIRST + ' only' : 'Show all ' + rows.length + ' places';
    body.replaceChildren(...list.flatMap((row) => {
      const cellsId = base + '-cells-' + row.rank;
      const isOpen = open.has(row.id);
      const cellsRow = h('tr', { class: 'mov-hot__cells', id: cellsId, hidden: !isOpen || sheet.matches, data: { cellsOf: row.id } });
      const fill = () => {
        const floor = floors.get(row.place.floorId);
        cellsRow.replaceChildren(h('td', { colspan: '3' },
          h('ul', { class: 'mov-hot__cell-list' }, row.cells.map((cell) => h('li', { data: { cell: String(cell.cell), load: String(cell.load) } },
            h('button', { type: 'button', class: 'mov-link', data: { action: 'show-cell' }, on: { click: () => show(row, [cell.cell]) } }, floor ? cellWords(floor, cell.cell) : 'Cell ' + cell.cell),
            ': ' + cell.load + (cell.excluded ? ', left out of the scale' : ''))))));
      };
      if (isOpen && !sheet.matches) fill();
      // on a phone the link opens nothing here (see its click): it is not a disclosure there
      const more = row.cells.length === 0 ? null : h('button', { type: 'button', class: 'mov-link mov-hot__more', 'aria-expanded': sheet.matches ? null : String(isOpen), 'aria-controls': sheet.matches ? null : cellsId, data: { action: 'cells' } }, cellsLabel(row, isOpen && !sheet.matches));
      if (more) {
        more.addEventListener('click', () => {
          // On a phone the inspector is a sheet over the map: the place's
          // cells are shown where they are, on the map. The sheet shuts, the
          // map moves to the place and outlines it, and the rings pulse.
          if (sheet.matches) {
            env.ctx.closeInspector();
            show(row);
            pulse.start();
            env.ctx.focusSurface();
            return;
          }
          const next = !open.has(row.id);
          if (next) {
            open.add(row.id);
            fill();
          } else {
            open.delete(row.id);
          }
          cellsRow.hidden = !next;
          more.setAttribute('aria-expanded', String(next));
          more.textContent = cellsLabel(row, next);
        });
      }
      const who = groupWords(row);
      const tr = h('tr', { class: 'mov-hot__row', 'aria-current': row.id === selected ? 'true' : null, data: { place: row.id, rank: String(row.rank), band: String(row.band), load: String(row.load), kind: row.place.kind } },
        h('th', { scope: 'row' }, h('div', { class: 'mov-hot__place' },
          h('span', { class: 'mov-hot__rank', 'aria-hidden': 'true' }, String(row.rank)),
          h('div', null,
            h('button', { type: 'button', class: 'mov-link mov-hot__name', data: { action: 'show' } }, row.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text))),
            row.floorName ? h('span', { class: 'mov-hot__floor' }, ' on ', h('bdi', null, row.floorName)) : null,
            // with one transition on the map there is no other for a place to peak in
            row.when && !picture.transition ? h('span', { class: 'mov-hot__when' }, 'Peaks in ' + row.when) : null,
            h('span', { class: 'mov-hot__groups' }, count(who.length, 'group') + ': ', who.flatMap((name, index) => [index > 0 ? ', ' : null, h('bdi', null, name)])),
            more))),
        h('td', { class: 'table__num' },
          h('span', { class: 'mov-hot__band', data: { band: String(row.band) }, 'aria-hidden': 'true' }, String(row.band)),
          h('span', { class: 'mov-hot__load' }, String(row.load)),
          h('span', { class: 'vh' }, ' ' + unitWord(row.unit, row.load) + ', band ' + row.band + ' of 5')),
        h('td', { class: 'table__num', data: { delay: row.delay === null ? '' : String(row.delay) } }, row.delay === null ? '' : row.delay === 0 ? 'none' : formatDuration(row.delay)));
      // the whole row answers a click; the name is the button the keyboard reaches
      tr.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="cells"]')) return;
        show(row);
      });
      return [tr, cellsRow];
    }));

    const zones = picture.load ? picture.load.source.zones : 0;
    notes.textContent = rows.length === 0 ? '' : 'The number in the square is the colour band, 1 quiet to 5 busy. Delay is the waiting the crowd model found at the place'
      + (rows[0].peak === null ? ' over the day' : picture.transition ? ' in that transition' : ' in the transition named') + ', with every group of the school walking.'
      + (zones > 0 ? ' ' + count(zones, 'exclusion zone') + (zones === 1 ? ' is' : ' are') + ' left out of this table.' : '');
  }

  all.addEventListener('click', () => {
    whole = !whole;
    if (last) draw(last);
    all.focus();
  });

  allFloors.addEventListener('click', () => {
    env.change({ floors: 'auto' });
    env.ctx.announce('Every floor is on the map.');
    const first = body.querySelector('[data-action="show"]');
    if (first) first.focus();
  });

  // ---- the map: the place a click chose, and a ring on each of the top places
  //
  // The rings, their ranks and the ring that travels out of each are one of
  // the map's marks (mark, below; env.marks), on the marks' canvas over the
  // map's. A tick of the pulse asks for the marks to be drawn again
  // (env.paintMarks) and never for the floors.
  let frames = 0;
  let marking = false;

  function frame() {
    frames += 1;
    env.paintMarks();
  }

  const pulse = createPulse({
    now: () => performance.now(),
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle),
    still: () => still.matches,
    frame,
    done() {
      element.dataset.pulse = rings.length === 0 ? 'none' : 'still';
      // the travelling rings are taken off: the marks without them (unless
      // the marks are being drawn this moment, and stopped the pulse themselves)
      if (!marking) env.paintMarks();
    },
  });

  // The ranking the rings are drawn from: worked out once for a state of the
  // map, not once a frame.
  let ranked = { results: null, picture: null, graph: null, list: [] };
  function rankedNow(state) {
    if (!state) return [];
    if (ranked.results !== state.results || ranked.picture !== state.picture || ranked.graph !== state.graph) {
      ranked = { results: state.results, picture: state.picture, graph: state.graph, list: hotspotRows(state.project, state.results, state.graph, state.picture) };
    }
    return ranked.list;
  }

  function outline(g, map, row, floors) {
    const size = map.view.size;
    g.strokeStyle = map.theme.accent;
    g.lineWidth = Math.max(2, Math.round(size / 10));
    g.lineCap = 'square';
    if (row.place.kind === 'connection') {
      for (const end of row.ends) {
        const at = map.point(end.floorId, end.cell);
        if (at) g.strokeRect(at.x - size / 2 + 1, at.y - size / 2 + 1, size - 2, size - 2);
      }
      return;
    }
    const floor = floors.get(row.place.floorId);
    if (!floor) return;
    const inside = new Set(row.place.cells);
    g.beginPath();
    for (const cell of row.place.cells) {
      const at = map.point(floor.id, cell);
      if (!at) continue;
      const x = cell % floor.width;
      const left = at.x - size / 2;
      const top = at.y - size / 2;
      if (!inside.has(cell - floor.width)) {
        g.moveTo(left, top);
        g.lineTo(left + size, top);
      }
      if (!inside.has(cell + floor.width)) {
        g.moveTo(left, top + size);
        g.lineTo(left + size, top + size);
      }
      if (x === 0 || !inside.has(cell - 1)) {
        g.moveTo(left, top);
        g.lineTo(left, top + size);
      }
      if (x === floor.width - 1 || !inside.has(cell + 1)) {
        g.moveTo(left + size, top);
        g.lineTo(left + size, top + size);
      }
    }
    g.stroke();
  }

  function mark(g, map) {
    const state = stateNow(last);
    const list = rankedNow(state);
    rings = [];
    if (list.length === 0) {
      marking = true;
      pulse.stop();
      marking = false;
      element.dataset.pulse = 'none';
      return;
    }
    const floors = new Map(state.project.building.floors.map((floor) => [floor.id, floor]));
    const chosen = list.find((row) => row.id === selected);
    if (chosen) outline(g, map, chosen, floors);

    // the disc grows with its number (presentation mode's labelScale, SV2-31c), and the least ring with it
    const scale = env.labelScale > 0 ? env.labelScale : 1;
    const r = ringRadius(map.view.size, scale);
    for (const row of list.slice(0, PULSE_TOP)) {
      // the busiest cell of the place that the scale counts; both ends of a stairs connection
      const busiest = row.cells.find((cell) => !cell.excluded);
      const points = (row.place.kind === 'connection' ? row.ends : busiest ? [busiest] : []).map((end) => map.point(end.floorId, end.cell)).filter(Boolean);
      for (const at of points) rings.push({ rank: row.rank, x: at.x, y: at.y, r });
    }
    const radius = RANK_RADIUS * scale;
    placeRanks(rings, radius);
    // Zoomed out, the rings of two places lie over one another. They are
    // drawn last rank first, so the busiest place's is on top, and every
    // rank after every ring, so no ring's line runs through a number.
    const backToFront = rings.slice().reverse();
    for (const ring of backToFront) {
      g.beginPath();
      g.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      g.strokeStyle = map.theme.card;
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = map.theme.accent;
      g.lineWidth = 3;
      g.stroke();
    }
    for (const ring of backToFront) {
      g.beginPath();
      g.arc(ring.bx, ring.by, radius, 0, Math.PI * 2);
      g.fillStyle = map.theme.accent;
      g.fill();
      g.strokeStyle = map.theme.card;
      g.lineWidth = 1;
      g.stroke();
      // the number grows with the map's labels (presentation mode; SV2-31b)
      g.font = '600 ' + Math.round(11 * scale) + 'px ' + map.theme.font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = map.theme.accentInk;
      g.fillText(String(ring.rank), ring.bx, ring.by + 0.5);
    }
    // the travelling rings, where the map now has the places
    const moving = pulse.moving && !still.matches;
    element.dataset.pulse = moving ? 'moving' : 'still';
    if (moving) pulseFrame(g, rings, pulse.left(), map.theme);
  }
  // named, so that whoever needs the map without the rings can find this
  // entry; drawn over playback's markers
  mark.id = 'hotspots';
  mark.order = 2;
  env.marks.push(mark);

  element.hotspots = {
    get rows() { return rows; },
    get elsewhere() { return elsewhere; },
    get selected() { return selected; },
    get rings() { return rings; },
    get moving() { return element.dataset.pulse === 'moving'; },
    get layer() { return env.layer; },
    get frames() { return frames; },
  };

  return {
    element,
    update(state) {
      last = state;
      rows = hotspotRows(state.project, state.results, state.graph, state.picture);
      elsewhere = placesElsewhere(state.project, state.results, state.graph, state.picture);
      if (selected !== null && !rows.some((row) => row.id === selected)) selected = null;
      for (const id of Array.from(open)) if (!rows.some((row) => row.id === id)) open.delete(id);
      draw(state);
      // a new ranking at the top is what the pulse is for
      const next = rows.slice(0, PULSE_TOP).map((row) => row.id + ':' + row.load).join('|');
      if (next !== topKey) {
        topKey = next;
        // The pulse sets out now and draws the marks itself, tick by tick: it
        // does not wait for the map to be drawn again, which it is not when
        // this tab is opened onto a change made while another tab was shown.
        if (next !== '') pulse.start();
      }
    },
    // The view is leaving: no timer is left running, and nothing of the panel stays on the map.
    unmount() {
      pulse.stop();
      if (typeof sheet.removeEventListener === 'function') sheet.removeEventListener('change', onSheet);
      const at = env.marks.indexOf(mark);
      if (at !== -1) env.marks.splice(at, 1);
    },
  };
}
