// The Hotspots tab of the movement view's inspector (spec 7.4): the busiest
// places, ranked. A row gives where, the load, the transition in which it
// peaks, the groups that walk there and the delay the crowd model found
// there. A row opens to its cells; a click on a row moves the map to the
// place and outlines it; the top few places carry a ring on the map, which
// pulses a few times when the ranking changes and is still under reduced
// motion.
//
//   hotspotsPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js. The panel's
// element carries `hotspots` for the tests and the console:
//   { rows, selected, rings, moving }: the rows on show, the id of the place a
//   click chose, the rings last drawn [{ rank, x, y, r }] in the map's own
//   pixels, and whether they are pulsing.
//
// What is ranked is what is on the map: the groups shown, the day type, and
// the busiest moment, the total over the day or the one transition chosen.
// The ranking itself, what a place is and what it is called are the engine's
// (engine/places.js hotspots(), places()); a band is engine/load.js bandOf().
// The delay is the crowd model's, and that model always walks every group.
//
//   hotspotRows(project, results, graph, picture) -> rows, busiest first
//     { rank, id, place, parts, floorName, load, unit, band, peak, when,
//       groups: [{ group, times, count }], delay, dayDelay,
//       cells: [{ floorId, cell, load, excluded }],   busiest first; none for a stairs connection
//       ends:  [{ floorId, cell }] }                  where the map goes: the place's cells, or a connection's two ends
//     floorName is the floor's name when another place has the same name
//     ("West" on two floors), else ''.
//   rankedPlaces(project, results, graph, asked) -> the same rows for anything
//     that names what it wants ranked without a picture (the congestion report)
//   hotspotsCsv(project, rows, picture) -> rows of cells for engine/csv.js
//   cellWords(floor, cell) -> "Column 6, row 4"
//   placeWords(row), groupWords(row)   a row's place and its groups as words

import { h, uid } from '../components/dom.js';
import { count } from '../components/words.js';
import { hotspots } from '../../engine/places.js';
import { bandOf } from '../../engine/load.js';
import { formatDuration } from '../../engine/findings.js';
import { unitWord } from './model.js';

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
//   asked = { dayTypeId, groups, load (loads()'s result for those groups),
//             max (the load the relative bands are fifths of),
//             transition (a period, or null), measure, transitions (transitionsOf()) }
export function rankedPlaces(project, results, graph, asked) {
  if (!project || !results || !graph || !asked || !asked.load || !results.places) return [];
  const day = results.routes && Array.isArray(results.routes.days) ? results.routes.days.find((each) => each.dayTypeId === asked.dayTypeId) : null;
  if (!day) return [];
  const shown = new Set(asked.groups.map((group) => group.id));
  const mine = { days: [{ dayTypeId: asked.dayTypeId, groups: day.groups.filter((entry) => shown.has(entry.groupId)) }] };
  const period = Number.isInteger(asked.transition) ? asked.transition : null;
  const crowd = results.crowd && Array.isArray(results.crowd.days) ? results.crowd.days.find((each) => each.dayTypeId === asked.dayTypeId) : null;
  const ranked = hotspots(project, mine, asked.dayTypeId, {
    graph,
    places: results.places,
    load: period === null ? asked.load : loadIn(asked.load, period),
    crowd: crowd || undefined,
    measure: period === null && asked.measure === 'total' ? 'total' : 'busiest',
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
      when: row.peak === null || !asked.transitions[row.peak] ? '' : asked.transitions[row.peak].name,
      groups: row.groups.filter((each) => groups.has(each.groupId)).map((each) => ({ group: groups.get(each.groupId), times: each.times, count: each.count })),
      delay: row.delay,
      dayDelay: row.dayDelay,
      cells: row.cells.map((cell) => ({ floorId: place.floorId, cell: cell.cell, load: cell.load, excluded: cell.excluded })),
      ends: connection ? [connection.a, connection.b].map((end) => ({ floorId: end.floorId, cell: end.cell })) : place.cells.map((cell) => ({ floorId: place.floorId, cell })),
    };
  });
}

// The ranking of what a picture of the map shows (model.js pictureOf).
export function hotspotRows(project, results, graph, picture) {
  if (!picture || !picture.load) return [];
  const held = kept.get(picture);
  if (held) return held;
  const rows = rankedPlaces(project, results, graph, {
    dayTypeId: picture.dayTypeId,
    groups: picture.groups,
    load: picture.load.source,
    max: picture.load.max,
    transition: picture.choice.transition,
    measure: picture.choice.measure,
    transitions: picture.transitions,
  });
  if (results) kept.set(picture, rows);
  return rows;
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

export function hotspotsCsv(project, rows, picture) {
  const unit = rows.length > 0 ? rows[0].unit : picture && picture.load ? picture.load.unit : 'students';
  const table = [['Rank', 'Place', 'Floor', 'Kind', 'Load (' + unit + ')', 'Peaks in', 'Groups', 'Delay (seconds)', 'Delay over the day (seconds)', 'Cells']];
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  for (const row of rows) {
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
      row.when === '' ? 'the whole day' : row.when,
      row.groups.map((each) => each.group.name + (each.times > 1 ? ' x' + each.times : '')).join('; '),
      row.delay === null ? '' : row.delay,
      row.dayDelay === null ? '' : row.dayDelay,
      place.kind === 'connection' ? '' : row.cells.length,
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
  const notes = h('p', { class: 'mov-panel__note', data: { hotspots: 'notes' } });
  const element = h('div', { class: 'mov-panel', data: { panel: 'hotspots', pulse: 'none' } },
    h('h2', { class: 'mov-panel__title' }, 'Hotspots'),
    lead, scroller, all, notes);

  let last = null;
  let rows = [];
  let selected = null;
  let whole = false;
  const open = new Set();
  let topKey = '';
  let until = 0;
  let timer = null;
  let rings = [];
  const still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };

  function show(row, cells) {
    selected = row.id;
    const end = row.ends[0];
    if (end) env.show(end.floorId, cells || row.ends.filter((each) => each.floorId === end.floorId).map((each) => each.cell));
    env.paint();
    for (const each of body.querySelectorAll('.mov-hot__row')) {
      if (each.dataset.place === row.id) each.setAttribute('aria-current', 'true');
      else each.removeAttribute('aria-current');
    }
    env.ctx.announce('The map moved to ' + placeWords(row) + '.');
  }

  function draw(state) {
    const picture = state.picture;
    const floors = new Map(state.project.building.floors.map((floor) => [floor.id, floor]));
    scroller.hidden = rows.length === 0;
    if (!picture.ready) {
      lead.textContent = 'Working out the routes.';
    } else if (picture.mode === 'empty') {
      lead.textContent = 'Nothing is shown, so there is nothing to rank. Choose a group, a grade or every group.';
    } else if (rows.length === 0) {
      lead.textContent = 'Nobody on screen crosses a corridor, so there is nothing to rank.';
    } else {
      const what = picture.transition ? 'in ' + picture.transition.name : picture.choice.measure === 'total' ? 'added up over the day' : 'at its busiest moment';
      const who = picture.groups.length === state.project.groups.length ? 'every group' : count(picture.groups.length, 'group');
      lead.replaceChildren((rows.length === 1 ? 'The one place anyone crosses' : 'The ' + rows.length + ' places anyone crosses, busiest first') + ': ' + who + ' on ', h('bdi', null, picture.dayTypeName), ', each place ' + what + '. Choose a place to see it on the map.');
    }

    // the unit is said once, at the head of the column
    loadHead.textContent = rows.length === 0 ? 'Load' : rows[0].unit === 'groups' ? 'Groups' : 'Students';
    const list = whole ? rows : rows.slice(0, TABLE_FIRST);
    all.hidden = rows.length <= TABLE_FIRST;
    all.textContent = whole ? 'Show the first ' + TABLE_FIRST + ' only' : 'Show all ' + rows.length + ' places';
    body.replaceChildren(...list.flatMap((row) => {
      const cellsId = base + '-cells-' + row.rank;
      const isOpen = open.has(row.id);
      const cellsRow = h('tr', { class: 'mov-hot__cells', id: cellsId, hidden: !isOpen, data: { cellsOf: row.id } });
      const fill = () => {
        const floor = floors.get(row.place.floorId);
        cellsRow.replaceChildren(h('td', { colspan: '3' },
          h('ul', { class: 'mov-hot__cell-list' }, row.cells.map((cell) => h('li', { data: { cell: String(cell.cell), load: String(cell.load) } },
            h('button', { type: 'button', class: 'mov-link', data: { action: 'show-cell' }, on: { click: () => show(row, [cell.cell]) } }, floor ? cellWords(floor, cell.cell) : 'Cell ' + cell.cell),
            ': ' + cell.load + (cell.excluded ? ', left out of the scale' : ''))))));
      };
      if (isOpen) fill();
      const more = row.cells.length === 0 ? null : h('button', { type: 'button', class: 'mov-link mov-hot__more', 'aria-expanded': String(isOpen), 'aria-controls': cellsId, data: { action: 'cells' } }, cellsLabel(row, isOpen));
      if (more) {
        more.addEventListener('click', () => {
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
            row.when ? h('span', { class: 'mov-hot__when' }, 'Peaks in ' + row.when) : null,
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
      + (rows[0].peak === null ? ' over the day' : ' in the transition named') + ', with every group of the school walking.'
      + (zones > 0 ? ' ' + count(zones, 'exclusion zone') + (zones === 1 ? ' is' : ' are') + ' left out of this table.' : '');
  }

  all.addEventListener('click', () => {
    whole = !whole;
    if (last) draw(last);
    all.focus();
  });

  // ---- the map: the place a click chose, and a ring on each of the top places
  function tick() {
    timer = null;
    env.paint();
    if (performance.now() < until && !still.matches) timer = setTimeout(tick, PULSE_FRAME_MS);
  }

  function pulse() {
    if (still.matches) {
      until = 0;
      env.paint();
      return;
    }
    until = performance.now() + PULSE_MS * PULSE_TIMES;
    if (timer === null) tick();
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
    const list = state ? hotspotRows(state.project, state.results, state.graph, state.picture) : [];
    rings = [];
    if (list.length === 0) {
      element.dataset.pulse = 'none';
      return;
    }
    const floors = new Map(state.project.building.floors.map((floor) => [floor.id, floor]));
    const chosen = list.find((row) => row.id === selected);
    if (chosen) outline(g, map, chosen, floors);

    const now = performance.now();
    const moving = !still.matches && now < until;
    element.dataset.pulse = moving ? 'moving' : 'still';
    const r = Math.max(10, Math.round(map.view.size * 0.9));
    // 1 as a pulse sets out, 0 as it ends
    const left = moving ? ((until - now) % PULSE_MS) / PULSE_MS : 0;
    for (const row of list.slice(0, PULSE_TOP)) {
      // the busiest cell of the place that the scale counts; both ends of a stairs connection
      const busiest = row.cells.find((cell) => !cell.excluded);
      const points = (row.place.kind === 'connection' ? row.ends : busiest ? [busiest] : []).map((end) => map.point(end.floorId, end.cell)).filter(Boolean);
      for (const at of points) {
        if (moving) {
          // the ring that travels: out from the still one, fading as it goes
          g.beginPath();
          g.arc(at.x, at.y, r * (1 + 0.7 * (1 - left)), 0, Math.PI * 2);
          g.globalAlpha = left;
          g.strokeStyle = map.theme.accent;
          g.lineWidth = 2;
          g.stroke();
          g.globalAlpha = 1;
        }
        g.beginPath();
        g.arc(at.x, at.y, r, 0, Math.PI * 2);
        g.strokeStyle = map.theme.card;
        g.lineWidth = 5;
        g.stroke();
        g.strokeStyle = map.theme.accent;
        g.lineWidth = 3;
        g.stroke();
        // its rank, on the ring's upper right
        const bx = at.x + r * 0.71;
        const by = at.y - r * 0.71;
        g.beginPath();
        g.arc(bx, by, 8, 0, Math.PI * 2);
        g.fillStyle = map.theme.accent;
        g.fill();
        g.font = '600 11px ' + map.theme.font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = map.theme.accentInk;
        g.fillText(String(row.rank), bx, by + 0.5);
        rings.push({ rank: row.rank, x: at.x, y: at.y, r });
      }
    }
  }
  // named, so that whoever needs the map without the rings can find this entry
  mark.id = 'hotspots';
  env.marks.push(mark);

  element.hotspots = {
    get rows() { return rows; },
    get selected() { return selected; },
    get rings() { return rings; },
    get moving() { return element.dataset.pulse === 'moving'; },
  };

  return {
    element,
    update(state) {
      last = state;
      rows = hotspotRows(state.project, state.results, state.graph, state.picture);
      if (selected !== null && !rows.some((row) => row.id === selected)) selected = null;
      for (const id of Array.from(open)) if (!rows.some((row) => row.id === id)) open.delete(id);
      draw(state);
      // a new ranking at the top is what the pulse is for
      const next = rows.slice(0, PULSE_TOP).map((row) => row.id + ':' + row.load).join('|');
      if (next !== topKey) {
        topKey = next;
        if (next !== '') pulse();
      }
    },
  };
}
