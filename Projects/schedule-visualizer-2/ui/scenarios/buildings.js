// Comparing two buildings, in the scenario lab (spec 9.3 wish; ARCHITECTURE 21.3
// and 21.10; DESIGN 15.7 and 15.9 items 4, 11, 12, 13).
//
// A second project that describes another building (this year's and a proposal
// with a new wing) cannot be made into a scenario: its rooms differ. It can
// still be asked questions of. engine/compare-buildings.js answers them from
// two worked-out results; this is what the lab shows while one is held:
//
//   the band     above the panel's first section: "Comparing with <file>,
//                another building" and "Stop comparing", then the line that
//                says it is not saved and the radio switch "Building shown on
//                the map" (This project / <file>)
//   the map      one building at a time, each painted with its own load on
//                one scale (the larger of the two sides' busiest decides the
//                bands), through the lab's own plan map: map.setProject(other,
//                buildGraph(other)) for the file's side
//   the inspector the legend with its one line, the matched day types' select,
//                the figures, groups by name with "Only in this project" and
//                "Only in <file>", places by name with "New" and "Gone" and
//                the sentence about corridors without names, findings new,
//                resolved and unchanged, the rooms, and the line that says
//                it is not saved
//
// What it never does: Apply (another building is not a set of changes), carry
// into the congestion report, or save the other project anywhere. It is view
// state: never written, never undone, ended by Stop comparing, by another
// project opening and by leaving the lab (the other lane is closed each time:
// store.derived.closeOther()).
//
// buildingsPanel(env) -> { band, inspector, held(), start(read, fileName),
//                          stop(options), update(project), paint(), unmount() }
//   env.ctx, env.plan() (the lab's plan map, once mounted), env.graph() (the
//   open project's graph), env.redraw() (the lab draws itself again),
//   env.focusFile() (where the focus goes after Stop comparing)
//   start(read, fileName) -> Promise of { ok: true } or { ok: false, sentence }
//   (a refusal of the engine, or why the other side could not be worked out):
//   nothing is held after a refusal. `read` is { project } (what
//   readProjectFile or projects.read gave).
//   paint() draws the map for the held comparison and answers true, or does
//   nothing and answers false when none is held (the lab then draws its own).
//
// The band's data-held is "true" while a comparison is held, data-working
// "true" while one is being worked out (the first answer, and again after a
// change in the open project), data-side the building the map shows
// ('this' or 'other'), data-day the day type's name compared, data-painted the
// cells painted on the map and data-scale the busiest load that scale was made from.

import { h } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { count } from '../components/words.js';
import { buildGraph } from '../../engine/graph.js';
import { bandOf, bandEdges } from '../../engine/load.js';
import { compareBuildings } from '../../engine/compare-buildings.js';
import { lanesOverlay, BAND_EXCLUDED } from '../surface/overlays/lanes.js';
import { parse } from '../colour.js';
import { figureRows, timeFigures, duration, signedDuration, signed } from './model.js';

export const ONE_SCALE = 'One scale for both buildings: the same colour means the same crowd.';
export const NOT_SAVED = 'Not saved: it ends when you leave this page or open another project.';
export const NOT_SAVED_FOOT = 'This comparison is not saved: it ends when you close the page. To keep the other building, open it as a project (Project › Start another project › A project file).';
export const EDIT_LINE = 'Stop comparing to edit the scenario.';
export const REFUSED_ENGINE = 'The two buildings could not be compared, and nothing has changed. ';

const SEVERITY = { problem: 'Problem', warning: 'Warning', note: 'Note' };

function bdi(text) {
  return h('bdi', null, text);
}

function parts(list) {
  return list.map((part) => (part.name ? bdi(part.text) : part.text));
}

function names(items) {
  const out = [];
  items.forEach((name, i) => {
    if (i > 0) out.push(i === items.length - 1 ? ' and ' : ', ');
    out.push(bdi(name));
  });
  return out;
}

// The load of a day type from a worked-out result (trimResult's or a pipeline
// run's): the entry with no bell schedule, as the movement view reads it.
function loadOf(result, dayTypeId) {
  const list = result && Array.isArray(result.loads) ? result.loads : [];
  return list.find((each) => each && each.dayTypeId === dayTypeId && !each.bellsId) || list.find((each) => each && each.dayTypeId === dayTypeId) || null;
}

// The busiest cell load outside the exclusion zones, the number the shared
// scale is made from.
function busiestCell(load) {
  if (!load) return 0;
  let most = 0;
  const cells = load.cells.busiest;
  for (let node = 0; node < cells.length; node += 1) if (!load.excluded[node] && cells[node] > most) most = cells[node];
  return most;
}

function bandsOf(graph, load, max, scale) {
  const out = new Map();
  if (!load) return out;
  const cells = load.cells.busiest;
  for (const floor of graph.floors) {
    const bands = new Uint8Array(floor.width * floor.height);
    for (let i = 0; i < floor.count; i += 1) {
      const node = floor.offset + i;
      if (!(cells[node] > 0)) continue;
      bands[graph.nodeCell[node]] = load.excluded[node] ? BAND_EXCLUDED : bandOf(cells[node], scale, max);
    }
    out.set(floor.id, bands);
  }
  return out;
}

function busiestWords(side) {
  if (!side) return 'Nothing is busy.';
  return 'Busiest: ' + side.name + ', ' + side.load + ' ' + (side.load === 1 ? side.unit.replace(/s$/, '') : side.unit) + '.';
}

// The comparison worked out for the matched day type, and what the map needs of
// it: { answer, scales: { this, other }, bands: { this, other }, edges }. `a` is the
// open project and `b` the other, each { project, graph, result }. The scale is
// shared (the larger of the two sides' busiest cell decides the bands) unless the
// two count in different units, when each side keeps its own. Plain Node: nothing
// here reads the page.
export function shapeOf(a, b, dayTypeName) {
  const answer = compareBuildings(a.project, a.result, b.project, b.result, dayTypeName === null || dayTypeName === undefined ? {} : { dayTypeName });
  if (answer.refused) return { answer, scales: null, bands: null, edges: null };
  const loadA = loadOf(a.result, answer.matched.dayTypeIdA);
  const loadB = loadOf(b.result, answer.matched.dayTypeIdB);
  const maxA = busiestCell(loadA);
  const maxB = busiestCell(loadB);
  const scale = a.project.settings.colourScale;
  const top = answer.unitsDiffer ? null : Math.max(maxA, maxB);
  const scales = { this: top === null ? maxA : top, other: top === null ? maxB : top };
  return {
    answer,
    scales,
    bands: { this: bandsOf(a.graph, loadA, scales.this, scale), other: bandsOf(b.graph, loadB, scales.other, scale) },
    edges: { this: bandEdges(scale, scales.this), other: bandEdges(scale, scales.other) },
  };
}

export function buildingsPanel(env) {
  const ctx = env.ctx;
  const store = ctx.store;
  // the held comparison, or null
  let state = null;
  // the asking in progress (start, a change in the open project): an older answer is dropped
  let token = 0;
  let saved = null;
  let colours = null;
  let coloursKey = '';

  // ---- the band
  const stopButton = h('button', { type: 'button', class: 'btn scn-bld__stop', data: { action: 'stop-comparing' }, on: { click: () => stop({ refocus: true, say: true }) } }, 'Stop comparing');
  const text = h('p', { class: 'scn-bld__text', data: { part: 'band-text' } });
  const head = h('div', { class: 'scn-bld__head' }, text, stopButton);
  const notSaved = h('p', { class: 'scn-bld__note', data: { part: 'not-saved' } }, NOT_SAVED);
  const editLine = h('p', { class: 'scn-bld__edit', id: 'scenario-building-edit', tabindex: '-1', data: { part: 'edit-line' } }, EDIT_LINE);
  const legendName = h('span', { class: 'scn-bld__legend', id: 'scenario-building-switch-label' }, 'Building shown on the map');
  const sideChoice = { current: null };
  const switchBox = h('div', { class: 'scn-bld__switch', data: { part: 'switch' } });
  const band = h('section', { class: 'scn-bld', hidden: true, 'aria-label': 'Comparing two buildings', data: { part: 'building-band', held: 'false' } }, head, notSaved, editLine, legendName, switchBox);

  function drawSwitch(fileName) {
    sideChoice.current = choice({
      name: 'scenario-building-side',
      labelledBy: 'scenario-building-switch-label',
      options: [{ value: 'this', label: 'This project' }, { value: 'other', label: fileName }],
      value: state ? state.side : 'this',
      onChange: (value) => showSide(value),
    });
    for (const label of sideChoice.current.element.querySelectorAll('.seg__label')) label.dir = 'auto';
    switchBox.replaceChildren(sideChoice.current.element);
  }

  // ---- the inspector
  const dayField = h('div', { class: 'field', data: { field: 'building-day' } });
  const daySelect = h('select', { class: 'field__input', id: 'scenario-building-day', data: { key: 'scenario-building-day' } });
  dayField.append(h('label', { class: 'field__label', for: 'scenario-building-day' }, 'Day type'), daySelect);
  daySelect.addEventListener('change', () => {
    if (!state) return;
    state.dayTypeName = daySelect.value;
    shape();
    band.dataset.day = state.dayTypeName;
    drawInspector();
    paint();
    const what = state.answer ? 'Compared on ' + state.dayTypeName + '. ' + busiestWords(state.side === 'this' ? state.answer.figures.busiest.before : state.answer.figures.busiest.after) : '';
    status.textContent = what;
  });
  const legend = h('div', { class: 'scn-bld__key', data: { part: 'legend' } });
  const status = h('p', { class: 'scn-compare__status', role: 'status', data: { part: 'building-status' } });
  const body = h('div', { class: 'scn-compare__body', data: { part: 'building-body' } });
  const inspector = h('div', { class: 'scn-compare scn-bld__inspector', hidden: true, data: { part: 'building-inspector' } },
    h('h2', { class: 'scn-compare__title', id: 'scenario-building-title' }, 'Two buildings'), legend, h('div', { class: 'scn-compare__options' }, dayField), status, body);

  // ---- the answer's shape: day type, the shared scale, the bands of each side
  function shape() {
    const s = state;
    Object.assign(s, shapeOf({ project: store.project, graph: env.graph(), result: s.mainResult }, { project: s.other, graph: s.otherGraph, result: s.otherResult }, s.dayTypeName));
    if (!s.answer.refused) s.dayTypeName = s.answer.matched.dayTypeName;
  }

  function colourOfBands() {
    const plan = env.plan();
    const next = (document.documentElement.dataset.theme || '') + ':' + plan.theme().paper;
    if (next !== coloursKey || !colours) {
      coloursKey = next;
      const style = getComputedStyle(plan.canvas);
      colours = [1, 2, 3, 4, 5].map((band) => {
        const value = style.getPropertyValue('--load-' + band).trim();
        return parse(value) ? value : '#888888';
      });
    }
    return colours;
  }

  const overlay = lanesOverlay(() => (state && state.bands ? { bands: state.bands[state.side], bandColours: colourOfBands() } : null));

  // The map: the building of the side shown, painted on the shared scale. The
  // lab's own overlays (the closed corridors, the difference map) are set aside
  // while a comparison is held: they paint the open scenario, not this.
  function paint() {
    if (!state || !state.answer || state.answer.refused) return false;
    const plan = env.plan();
    if (!plan) return false;
    if (saved === null) {
      saved = plan.overlays.splice(0);
      plan.overlays.push(overlay);
    }
    if (state.side === 'this') plan.setProject(store.project, env.graph());
    else plan.setProject(state.other, state.otherGraph);
    plan.paint();
    // for the tests: how many cells are painted, and the busiest load the scale was made from
    let painted = 0;
    for (const bands of state.bands[state.side].values()) for (const value of bands) if (value > 0 && value !== BAND_EXCLUDED) painted += 1;
    band.dataset.painted = String(painted);
    band.dataset.scale = String(state.scales[state.side]);
    return true;
  }

  function showSide(value) {
    if (!state || (value !== 'this' && value !== 'other')) return;
    state.side = value;
    band.dataset.side = value;
    paint();
    drawLegend();
    const which = value === 'this' ? 'this project’s' : state.fileName + '’s';
    const side = state.answer && !state.answer.refused ? (value === 'this' ? state.answer.figures.busiest.before : state.answer.figures.busiest.after) : null;
    ctx.announce('Showing ' + which + ' building. ' + busiestWords(side));
  }

  function drawLegend() {
    if (!state || !state.answer || state.answer.refused) {
      legend.replaceChildren();
      return;
    }
    const edges = state.edges[state.side];
    const unit = (state.answer.figures.busiest[state.side === 'this' ? 'before' : 'after'] || state.answer.figures.busiest.before || state.answer.figures.busiest.after || { unit: 'students' }).unit;
    const sentence = state.answer.unitsDiffer ? state.answer.unitsDiffer.sentence : ONE_SCALE;
    legend.replaceChildren(
      h('ul', { class: 'scn-bld__bands', 'aria-label': 'Colours, from quiet to busy, in ' + unit }, edges.map((edge) => h('li', { data: { band: String(edge.band) } },
        h('span', { class: 'scn-bld__swatch', style: 'background: var(--load-' + edge.band + ')', 'aria-hidden': 'true' }),
        edge.from > (edge.to === null ? Infinity : edge.to) ? '–' : edge.to === null ? edge.from + '+' : edge.from === edge.to ? String(edge.from) : edge.from + '–' + edge.to))),
      h('p', { class: 'scn-bld__line', data: { part: 'one-scale' } }, sentence));
  }

  // ---- the inspector's tables
  function drawInspector() {
    const s = state;
    if (!s || !s.answer) return;
    const answer = s.answer;
    const file = s.fileName;
    // the day types both buildings have
    const days = answer.refused ? [] : answer.matched.dayTypes;
    const key = JSON.stringify(days);
    if (daySelect.dataset.key !== key) {
      daySelect.dataset.key = key;
      daySelect.replaceChildren(...days.map((day) => h('option', { value: day }, day)));
    }
    if (!answer.refused) daySelect.value = answer.matched.dayTypeName;
    if (answer.refused) {
      body.replaceChildren(h('p', { role: 'alert' }, answer.sentence));
      return;
    }
    drawLegend();
    const unitsDiffer = Boolean(answer.unitsDiffer);
    body.replaceChildren(roomsBlock(answer, file), figuresBlock(answer, file, unitsDiffer), groupsBlock(answer, file, unitsDiffer), placesBlock(answer, file, unitsDiffer), findingsBlock(answer), h('p', { class: 'scn-compare__note', data: { part: 'not-saved-foot' } }, NOT_SAVED_FOOT));
  }

  function roomsBlock(answer, file) {
    const rooms = answer.rooms;
    const only = (label, list) => (list.length === 0 ? null : h('li', { data: { rooms: label } }, label === 'added' ? ['Only in ', bdi(file), ' (' + list.length + '): ', ...names(list.map(String))] : ['Only in this project (' + list.length + '): ', ...names(list.map(String))]));
    return h('section', { 'aria-labelledby': 'scenario-building-rooms-title', data: { part: 'rooms' } },
      h('h3', { class: 'scn-compare__heading', id: 'scenario-building-rooms-title' }, 'Rooms'),
      h('p', null, count(rooms.same, 'room') + (rooms.same === 1 ? ' has' : ' have') + ' the same number in both buildings.'),
      rooms.added.length + rooms.removed.length === 0 ? null : h('ul', { class: 'scn-bld__list' }, only('removed', rooms.removed), only('added', rooms.added)));
  }

  function figuresBlock(answer, file, unitsDiffer) {
    const rows = figureRows(answer);
    const heading = (extra) => h('tr', { role: 'row' },
      h('th', { scope: 'col', role: 'columnheader', class: 'scn-figures__corner' }, 'Figure'),
      h('th', { scope: 'col', role: 'columnheader', class: 'scn-figures__before' }, 'This project'),
      h('th', { scope: 'col', role: 'columnheader', dir: 'auto' }, bdi(file)),
      extra ? h('th', { scope: 'col', role: 'columnheader' }, 'Difference') : null);
    const table = h('table', { class: 'scn-table scn-figures' + (unitsDiffer ? ' scn-figures--two' : ''), role: 'table', 'aria-label': 'The two buildings’ figures, and the difference', data: { part: 'building-figures' } },
      h('thead', { role: 'rowgroup' }, heading(!unitsDiffer)),
      h('tbody', { role: 'rowgroup' }, rows.map((row) => {
        const noDifference = unitsDiffer && row.id === 'busiest';
        return h('tr', { role: 'row', data: { figure: row.id, trend: row.worse === null ? 'same' : row.worse ? 'worse' : 'better' } },
          h('th', { scope: 'row', role: 'rowheader' }, row.label),
          h('td', { class: 'num', role: 'cell' }, row.before),
          h('td', { class: 'num', role: 'cell' }, row.after),
          unitsDiffer ? null : h('td', { class: 'num', role: 'cell' }, noDifference ? '—' : row.difference));
      })));
    const only = answer.figures.onlyAfter;
    const before = answer.figures.onlyBefore;
    const explain = [];
    if (only.groups > 0) explain.push(count(only.groups, 'group') + ' only in ' + file + ' add ' + signedDuration(only.walking + only.waiting) + ' of travel' + (only.late > 0 ? ' and ' + count(only.late, 'late arrival') : '') + '.');
    if (before.groups > 0) explain.push(count(before.groups, 'group') + ' only in this project account for ' + duration(before.walking + before.waiting) + ' of its travel.');
    return h('section', { 'aria-labelledby': 'scenario-building-figures-title', data: { part: 'figures-block' } },
      h('h3', { class: 'scn-compare__heading', id: 'scenario-building-figures-title' }, 'Before and after'),
      unitsDiffer ? h('p', { role: 'note', data: { part: 'units-differ' } }, answer.unitsDiffer.sentence) : null,
      table,
      h('p', { class: 'scn-compare__busiest', data: { part: 'busiest' } }, 'The busiest place in this project: ', ...busiestPlace(answer.figures.busiest.before), '; in ', bdi(file), ': ', ...busiestPlace(answer.figures.busiest.after), '.'),
      explain.length === 0 ? null : h('p', { class: 'scn-compare__note', data: { part: 'only-figures' } }, explain.join(' ')));
  }

  function busiestPlace(side) {
    return side ? [...parts(side.parts || [{ text: side.name }]), ' (' + side.load + ')'] : ['nowhere'];
  }

  function groupsBlock(answer, file) {
    const shown = [];
    let same = 0;
    for (const row of answer.groups.rows) {
      const times = row.failedChange === 0 && row.before && row.after ? timeFigures(row.before.total, row.after.total) : null;
      let change;
      if (row.failedChange > 0) change = count(row.failedChange, 'walk') + ' more with no way through';
      else if (row.failedChange < 0) change = count(-row.failedChange, 'walk') + ' fewer with no way through';
      else change = times ? times.difference : signedDuration(row.difference || 0);
      if (row.failedChange === 0 && (times ? times.n === 0 : !row.difference)) {
        same += 1;
        continue;
      }
      const worse = row.failedChange !== 0 ? row.failedChange > 0 : times ? times.n > 0 : row.difference > 0;
      shown.push({ row, change, worse, before: row.before ? (times ? times.before : duration(row.before.total)) : '—', after: row.after ? (times ? times.after : duration(row.after.total)) : '—' });
    }
    const heading = h('h3', { class: 'scn-compare__heading', id: 'scenario-building-groups-title' }, 'Travel time by group');
    const only = (label, list, nameless) => (list.length === 0 && nameless === 0 ? null : h('p', { class: 'scn-compare__note', data: { part: label === 'before' ? 'only-here' : 'only-there' } },
      label === 'before' ? 'Only in this project: ' : ['Only in ', bdi(file), ': '], ...names(list), nameless > 0 ? (list.length > 0 ? '; ' : '') + count(nameless, 'group') + ' with no name, which cannot be matched' : '', '.'));
    return h('section', { 'aria-labelledby': 'scenario-building-groups-title', data: { part: 'building-groups' } }, heading,
      shown.length === 0 ? h('p', null, 'No matched group’s travel time changes.') : h('table', { class: 'scn-table scn-groups' },
        h('caption', { class: 'vh' }, 'Each matched group’s travel time over the day, biggest change first'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Group'), h('th', { scope: 'col' }, 'This project'), h('th', { scope: 'col' }, bdi(file)), h('th', { scope: 'col' }, 'Change'))),
        h('tbody', null, shown.map((each) => h('tr', { data: { group: each.row.name, trend: each.worse ? 'worse' : 'better' } },
          h('th', { scope: 'row', dir: 'auto' }, bdi(each.row.name), each.row.mergedBefore > 1 || each.row.mergedAfter > 1 ? h('span', { class: 'scn-tag' }, 'one name, ' + Math.max(each.row.mergedBefore, each.row.mergedAfter) + ' groups') : null),
          h('td', { class: 'num' }, each.before),
          h('td', { class: 'num' }, each.after),
          h('td', { class: 'num' }, each.change))))),
      same > 0 ? h('p', { class: 'scn-compare__note' }, count(same, 'other group') + (same === 1 ? ' walks' : ' walk') + ' as before.') : null,
      only('before', answer.groups.onlyBefore, 0), only('after', answer.groups.onlyAfter, 0));
  }

  function placesBlock(answer, file, unitsDiffer) {
    const places = answer.places;
    const unit = (answer.figures.busiest.after || answer.figures.busiest.before || { unit: 'students' }).unit;
    const row = (each) => h('li', { data: { place: each.key } }, h('span', { dir: 'auto' }, bdi(each.name), each.floorNames && each.floorNames.length > 0 ? ' (' + each.floorNames.join(', ') + ')' : ''), ': ' + each.before + ' → ' + each.after + ' ' + unit + (unitsDiffer ? '' : ' (' + signed(each.difference) + ')'));
    const list = (rows, label, part, total) => h('div', { class: 'scn-places', data: { part } },
      h('h4', { class: 'scn-places__title' }, label + ' (' + (total === undefined ? rows.length : total) + ')'),
      rows.length === 0 ? h('p', { class: 'scn-compare__note' }, 'None.') : h('ul', { class: 'scn-places__list' }, rows.map(row)));
    const plain = (rows, label, part, text) => h('div', { class: 'scn-places', data: { part } },
      h('h4', { class: 'scn-places__title' }, label + ' (' + rows.length + ')'),
      rows.length === 0 ? h('p', { class: 'scn-compare__note' }, 'None.') : h('ul', { class: 'scn-places__list' }, rows.map((each) => h('li', { data: { place: each.key } }, h('span', { dir: 'auto' }, bdi(each.name), each.floorNames && each.floorNames.length > 0 ? ' (' + each.floorNames.join(', ') + ')' : ''), text(each)))));
    return h('section', { 'aria-labelledby': 'scenario-building-places-title', data: { part: 'building-places' } },
      h('h3', { class: 'scn-compare__heading', id: 'scenario-building-places-title' }, 'Places, matched by name'),
      unitsDiffer ? list(places.changed, 'Changed, not ranked', 'changed', places.changedTotal) : [list(places.busier, 'Busier', 'busier', places.busierTotal), list(places.quieter, 'Quieter', 'quieter', places.quieterTotal)],
      plain(places.new, ['New, only in ', file].join(''), 'new', (each) => ': ' + each.load + ' ' + unit),
      plain(places.gone, 'Gone, only in this project', 'gone', (each) => ': ' + each.load + ' ' + unit),
      places.ambiguous.length === 0 ? null : h('div', { class: 'scn-places', data: { part: 'ambiguous' } },
        h('h4', { class: 'scn-places__title' }, 'Named alike, so not matched (' + places.ambiguous.length + ')'),
        h('ul', { class: 'scn-places__list' }, places.ambiguous.map((each) => h('li', { dir: 'auto' }, bdi(each.name), ': ' + each.before + ' here, ' + each.after + ' there')))),
      places.unnamed.sentence ? h('p', { class: 'scn-compare__note', data: { part: 'unnamed' } }, places.unnamed.sentence) : null);
  }

  function findingsBlock(answer) {
    const item = (finding) => h('li', { data: { finding: finding.id, severity: finding.severity } }, h('span', { class: 'scn-severity' }, SEVERITY[finding.severity] + ': '), h('span', { dir: 'auto' }, finding.text));
    const listOf = (findings, label, part, open) => {
      const inner = findings.length === 0 ? h('p', { class: 'scn-compare__note' }, 'None.') : h('ul', { class: 'scn-findings__list' }, findings.map(item));
      if (open) return h('div', { class: 'scn-findings', data: { part } }, h('h4', { class: 'scn-findings__title' }, label + ' (' + findings.length + ')'), inner);
      return h('details', { class: 'scn-findings', data: { part } }, h('summary', null, label + ' (' + findings.length + ')'), inner);
    };
    return h('section', { 'aria-labelledby': 'scenario-building-findings-title', data: { part: 'building-findings' } },
      h('h3', { class: 'scn-compare__heading', id: 'scenario-building-findings-title' }, 'Findings'),
      listOf(answer.findings.new, 'New', 'new', true),
      listOf(answer.findings.resolved, 'Resolved', 'resolved', true),
      listOf(answer.findings.unchanged, 'Unchanged', 'unchanged', false));
  }

  // ---- the band's words
  function drawBand() {
    if (!state) return;
    text.replaceChildren('Comparing with ', bdi(state.fileName), ', another building');
    drawSwitch(state.fileName);
  }

  function counters() {
    return store.geometryVersion + ':' + store.buildingVersion + ':' + store.scheduleVersion;
  }

  // Both sides worked out: { main, other }, or null when a newer asking took
  // over, or { failed } with why.
  async function work() {
    const mine = ++token;
    band.dataset.working = 'true';
    try {
      const [theirs, ours] = await Promise.all([store.derived.other(), store.derived.results()]);
      if (mine !== token) return null;
      if (!theirs || !ours) throw new Error('the engine did not answer. Try again.');
      band.dataset.working = 'false';
      return { main: ours, other: theirs };
    } catch (error) {
      if (mine !== token) return null;
      band.dataset.working = 'false';
      return { failed: error && error.message ? error.message : String(error) };
    }
  }

  // Hold the other project and compare. One already held is let go first.
  async function start(read, fileName) {
    if (!read || !read.project) throw new TypeError('start needs the other project.');
    if (state) stop({ say: false });
    const other = read.project;
    const name = typeof fileName === 'string' ? fileName : '';
    const refuse = (sentence, extra) => {
      store.derived.closeOther();
      return { ok: false, sentence, ...extra };
    };
    // the lane holds it from here; a refusal lets it go again
    try {
      store.derived.setOther(other, name);
    } catch (error) {
      return refuse(REFUSED_ENGINE + (error && error.message ? error.message : String(error)));
    }
    const found = await work();
    if (found === null) return { ok: false, sentence: REFUSED_ENGINE + 'Another comparison was started meanwhile.', superseded: true };
    if (found.failed) return refuse(REFUSED_ENGINE + 'It could not be worked out: ' + found.failed);
    let graph;
    try {
      graph = buildGraph(other);
    } catch (error) {
      return refuse(REFUSED_ENGINE + (error && error.message ? error.message : String(error)));
    }
    state = { projectId: store.project.id, counters: counters(), fileName: name, other, otherGraph: graph, mainResult: found.main, otherResult: found.other.result, dayTypeName: null, side: 'this', answer: null, scales: null, bands: null, edges: null };
    try {
      shape();
    } catch (error) {
      state = null;
      return refuse(REFUSED_ENGINE + (error && error.message ? error.message : String(error)));
    }
    if (state.answer.refused) {
      const sentence = state.answer.sentence;
      state = null;
      return refuse(sentence);
    }
    band.hidden = false;
    inspector.hidden = false;
    band.dataset.held = 'true';
    band.dataset.side = 'this';
    band.dataset.day = state.dayTypeName;
    drawBand();
    drawInspector();
    paint();
    status.textContent = 'Comparing with ' + name + ', another building. ' + busiestWords(state.answer.figures.busiest.before);
    env.redraw();
    ctx.announce('Comparing with ' + name + ', another building. ' + EDIT_LINE);
    return { ok: true };
  }

  // Held no more: the lab's overlays and project back, the lane let go.
  function endState(redraw) {
    token += 1;
    state = null;
    band.hidden = true;
    inspector.hidden = true;
    band.dataset.held = 'false';
    band.dataset.working = 'false';
    delete band.dataset.side;
    delete band.dataset.day;
    legend.replaceChildren();
    body.replaceChildren();
    status.textContent = '';
    const plan = env.plan();
    if (saved !== null && plan) {
      plan.overlays.splice(0);
      plan.overlays.push(...saved);
      saved = null;
      plan.setProject(store.project, env.graph());
      plan.paint();
    }
    saved = null;
    if (redraw) env.redraw();
  }

  function stop(options) {
    const opts = options || {};
    if (!state) return;
    const name = state.fileName;
    store.derived.closeOther();
    endState(true);
    if (opts.say) ctx.announce('Stopped comparing with ' + name + '.');
    if (opts.refocus) env.focusFile();
  }

  // The lab draws itself: a comparison for another project ends; a change in the
  // open project is compared again, the other side as it was.
  function update(project) {
    if (!state) return;
    // another project: the lab is being drawn, so no second drawing is asked for
    if (project.id !== state.projectId) {
      store.derived.closeOther();
      endState(false);
      return;
    }
    if (counters() === state.counters) return;
    const s = state;
    s.counters = counters();
    const mine = ++token;
    band.dataset.working = 'true';
    store.derived.results().then((ours) => {
      if (mine !== token || state !== s) return;
      band.dataset.working = 'false';
      if (!ours) return;
      s.mainResult = ours;
      try {
        shape();
      } catch (error) {
        status.textContent = 'The comparison could not be worked out again: ' + (error && error.message ? error.message : String(error));
        return;
      }
      if (s.answer.refused) {
        status.textContent = s.answer.sentence;
        body.replaceChildren(h('p', { role: 'alert' }, s.answer.sentence));
        return;
      }
      drawInspector();
      paint();
    }, (error) => {
      if (mine !== token || state !== s) return;
      band.dataset.working = 'false';
      status.textContent = 'The comparison could not be worked out again: ' + (error && error.message ? error.message : String(error));
    });
  }

  return {
    band,
    inspector,
    held: () => state !== null,
    start,
    stop,
    update,
    paint,
    // the sentence where the focus goes when a form it was in is hidden
    editLine,
    // after a comparison starts: the switch's checked radio
    focusSwitch() {
      const checked = switchBox.querySelector('input:checked');
      if (checked) checked.focus();
    },
    unmount() {
      token += 1;
      if (state) {
        store.derived.closeOther();
        state = null;
      } else {
        // a start still working out when the section goes: let the lane go too
        store.derived.closeOther();
      }
      const plan = env.plan();
      if (saved !== null && plan) {
        plan.overlays.splice(0);
        plan.overlays.push(...saved);
      }
      saved = null;
    },
  };
}
