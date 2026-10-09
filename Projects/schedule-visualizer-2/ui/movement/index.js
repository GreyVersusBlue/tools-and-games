// The Movement section (DESIGN 5.3): a read-only map of the whole building
// with every group's walk drawn on it.
//
//   top       the screen's first line, a sentence; then who, the day type,
//             the transition strip, the two drawing options and Clear (./controls.js)
//   the map   every floor on one canvas (./layout.js), drawn by the plan's
//             own renderer with the lanes, the load colouring and the room
//             markers laid over it (ui/surface/overlays/lanes.js), and the
//             stairs links from floor to floor; the legend card bottom right
//             (./legend.js); a card for the cell under the pointer, the cell
//             tapped, or the cell the keyboard cursor rests on (./card.js)
//   bottom    the playback bar's place (./playback.js)
//   top bar   which floors are on the map, and side by side or stacked
//   inspector Hotspots, Travel time, Summary, Export (./hotspots.js,
//             ./tables.js, ./summary.js, ./export.js)
//
// What is drawn comes from ./model.js, which reads the derived results
// (store.derived.results(): routes, crowd, loads, places, walks). They are
// asked for once per state of the project. Until the answer for a change
// comes the last answer stays on the map, drawn against the project it was
// worked out for, and the section reads as pending (`data-pending`).
//
// Where a later unit plugs in. A panel of the inspector and the playback bar
// are each a function of `env` returning { element, update(state) }:
//
//   env    { ctx,
//            choice(), change(patch)      what is chosen on screen (model.js), and changing it
//            show(floorId, cells)         bring cells onto the map
//            overlays                     [(g, view, floor, theme) => {}] drawn over a floor after the lanes
//            marks                        [(g, map) => {}] drawn over the whole map after the stairs links;
//                                         map.point(floorId, cell) gives a cell's middle in pixels, or null
//            paint()                      draw the map again (an overlay changed)
//            card                         the cell card (card.extra is playback's place in it)
//            fix(where) }                 follow a "fix it" link of route health
//   state  { project, results, graph, picture, health }: the project the
//          results are for, the results (null until the first answer),
//          buildGraph's graph, model.js's picture and routeHealth's list
//
// The view on screen is at document.querySelector('.mov').movement, for the
// tests and for the console.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { choice as segmented } from '../components/choice.js';
import { count, figures, periodWords } from '../components/words.js';
import { singleKeyAllowed } from '../components/shortcuts.js';
import { createViewport, ZOOM_STEP } from '../surface/viewport.js';
import { createRenderer } from '../surface/renderer.js';
import { attachInput } from '../surface/input.js';
import { attachCursor } from '../surface/cursor.js';
import { lanesOverlay, drawStairLink, lanePoint, lineWidth } from '../surface/overlays/lanes.js';
import { parse, readable } from '../colour.js';
import { buildGraph } from '../../engine/graph.js';
import { ActionError, setSetting, setOnboarding } from '../../engine/actions.js';
import { MOVEMENT_STEP } from '../help/progress.js';
import { defaultChoice, settleChoice, addGroup, pictureOf, sentenceOf, routeHealth, cellCard } from './model.js';
import { layoutFloors, bestLayout, slotAt, placeOf } from './layout.js';
import { controls } from './controls.js';
import { legend } from './legend.js';
import { cellCardView } from './card.js';
import { summaryPanel } from './summary.js';
import { hotspotsPanel } from './hotspots.js';
import { tablesPanel } from './tables.js';
import { exportPanel } from './export.js';
import { playbackBar } from './playback.js';

const HEADLINE = 'This is the movement view.';
const KEYS = 'Arrow keys move the cursor one cell and say what crosses it. Hold Space and press the arrows to move the map. = and - zoom in and out, 0 fits the map to the window. Escape puts the card away.';

// The keys of the map. The map answers them itself, so they are listed for
// Help only (spec 3.15).
export const MOVEMENT_KEYS = [
  { id: 'movement-arrows', does: 'Move the cursor one cell, and say what crosses it', shown: 'Arrows' },
  { id: 'movement-pan', does: 'Move the map', shown: 'Space+Arrows' },
  { id: 'movement-zoom-in', does: 'Zoom in', shown: '=' },
  { id: 'movement-zoom-out', does: 'Zoom out', shown: '-' },
  { id: 'movement-fit', does: 'Fit the map to the window', shown: '0' },
  { id: 'movement-escape', does: 'Put the cell card away', shown: 'Esc' },
];

export const MOVEMENT_TABS = [
  { id: 'hotspots', label: 'Hotspots' },
  { id: 'tables', label: 'Travel time' },
  { id: 'summary', label: 'Summary' },
  { id: 'export', label: 'Export' },
];

// The section's own stylesheet. A page that links it (data-sheet="movement")
// is left alone; otherwise it is added here.
const SHEET = new URL('./movement.css', import.meta.url).href;
function loadSheet() {
  let link = document.querySelector('link[data-sheet="movement"]');
  if (!link) {
    link = h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'movement' } });
    document.head.append(link);
  }
  return new Promise((resolve) => {
    if (link.sheet) resolve();
    else {
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
    }
  });
}

// What is chosen here. It outlives a visit to another section, for the
// project that is open.
const memory = { projectId: null, choice: null, tab: 'summary', legendFolded: false };

// One graph a building, kept by the building object: a change to the
// schedule gives a new project with the same building.
const graphs = new WeakMap();
function graphOf(project) {
  let graph = graphs.get(project.building);
  if (!graph) {
    graph = buildGraph(project);
    graphs.set(project.building, graph);
  }
  return graph;
}

function first(project) {
  const one = periodWords(project.settings).one;
  return 'It draws every group’s walk between one ' + one + ' and the next, so you can see where the corridors fill and who cannot make it in time. Draw the building and give a group its rooms first.';
}

function facts(project) {
  const f = figures(project);
  return 'There is nothing to draw yet: this project has ' + count(f.rooms, 'room') + ' and ' + count(f.groups, 'group') + '.';
}

// Open a group's slot in the Schedule section's Groups tab. The section has
// no address for a slot, so this presses the group's own button once the tab
// is drawn and puts the focus in the period's row.
function openSlot(slot) {
  let tries = 0;
  const step = () => {
    const section = document.querySelector('.sch');
    const ready = section && section.dataset.pending !== 'true';
    const button = ready ? Array.from(section.querySelectorAll('.sch-group')).find((each) => each.dataset.group === slot.groupId) : null;
    if (!button) {
      tries += 1;
      if (tries < 40) setTimeout(step, 50);
      return;
    }
    if (button.getAttribute('aria-current') !== 'true') button.click();
    setTimeout(() => {
      const day = Array.from(document.querySelectorAll('.sch-day')).find((each) => each.dataset.day === slot.dayTypeId);
      const row = day ? day.querySelector('.sch-slot[data-period="' + slot.period + '"]') : null;
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      const control = row.querySelector('input, select, button');
      if (control) control.focus({ preventScroll: true });
    }, 80);
  };
  step();
}

export const section = {
  id: 'movement',
  label: 'Movement',
  name: 'Movement',
  key: '3',
  icon: 'movement',
  // Once, before anything is mounted: the map's keys go on the shell's list.
  start(ctx) {
    for (const key of MOVEMENT_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Movement', does: key.does, shown: key.shown });
  },
  mount(ctx) {
    const store = ctx.store;
    let choice = settleChoice(store.project, memory.projectId === store.project.id && memory.choice ? memory.choice : defaultChoice(store.project));
    // the last answer, and the project it was worked out for
    let derived = { asked: null, project: null, results: null, failed: null };
    let state = null;
    let picture = null;
    let world = null;
    let worldKey = '';
    let fitted = true;
    let queued = false;
    let gone = false;
    // the cell whose card shows: { floorId, cell, source }
    let point = null;
    let bandColours = null;
    let bandKey = null;
    const lineColours = new Map();

    const view = createViewport();
    const canvas = h('canvas', { class: 'mov-plan', id: 'movement-plan', tabindex: '0', role: 'application', 'aria-label': 'The movement map', 'aria-describedby': 'movement-keys' });
    const renderer = createRenderer(canvas);
    const g = canvas.getContext('2d');
    const card = cellCardView();
    const zoomText = h('span', { class: 'mov-zoom__text', 'aria-live': 'off' });
    const zoomBox = h('div', { class: 'mov-zoom', role: 'group', 'aria-label': 'Zoom' },
      h('button', { type: 'button', class: 'mov-zoom__btn', 'aria-label': 'Zoom out', title: 'Zoom out (-)', data: { action: 'zoom-out' }, on: { click: () => zoomBy(1 / ZOOM_STEP) } }, '−'),
      zoomText,
      h('button', { type: 'button', class: 'mov-zoom__btn', 'aria-label': 'Zoom in', title: 'Zoom in (=)', data: { action: 'zoom-in' }, on: { click: () => zoomBy(ZOOM_STEP) } }, '+'),
      h('button', { type: 'button', class: 'mov-zoom__btn mov-zoom__btn--fit', title: 'Fit the map to the window (0)', data: { action: 'fit' }, on: { click: () => fit() } }, 'Fit'));

    const env = {
      ctx,
      choice: () => choice,
      change,
      show,
      overlays: [],
      marks: [],
      paint: () => queuePaint(),
      card,
      fix(where) {
        ctx.navigate(where.hash);
        if (where.slot) openSlot(where.slot);
      },
    };

    const top = controls({
      change,
      add(groupId) {
        const answer = addGroup(choice, groupId);
        // the reason is on screen under the chips already: it is said, not put up again
        if (answer.refused) ctx.announce(answer.refused);
        else change(answer.choice);
      },
      remove: (groupId) => change({ groupIds: choice.groupIds.filter((id) => id !== groupId) }),
      clear() {
        change({ who: 'groups', groupIds: [], transition: null });
        ctx.announce('Cleared: nothing is shown.');
      },
      showMe() {
        inspector.select('summary');
        memory.tab = 'summary';
        drawPanel();
        panels.summary.focusHealth();
      },
    });
    const key = legend({
      folded: memory.legendFolded,
      fold(folded) {
        memory.legendFolded = folded;
      },
      measure: (value) => change({ measure: value }),
      scale(value) {
        try {
          store.apply(setSetting, { key: 'colourScale.mode', value });
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          ctx.toast({ kind: 'problem', text: error.message });
        }
      },
    });
    const bar = playbackBar(env);
    const stage = h('div', { class: 'mov-stage' }, canvas, h('p', { class: 'vh', id: 'movement-keys' }, KEYS), key.element, card.element, zoomBox);
    const headline = h('h1', { class: 'vh' }, HEADLINE);
    const map = h('div', { class: 'mov-map' }, headline, top.element, stage, bar.element);
    const empty = h('div', { class: 'mov-empty stub', hidden: true });
    const element = h('div', { class: 'mov', data: { styled: 'false' } }, map, empty);

    // ---- the top bar's second row: which floors, and how they are laid out
    const floorsRow = h('div', { class: 'mov-floors' });
    let floorsKey = '';
    function drawFloors(project) {
      const floors = project.building.floors;
      const next = JSON.stringify(floors.map((floor) => [floor.id, floor.name]));
      if (next !== floorsKey) {
        floorsKey = next;
        const which = segmented({
          name: 'movement-floors',
          labelledBy: 'movement-floors-label',
          value: choice.floors,
          onChange: (value) => change({ floors: value === 'all' ? 'auto' : value }),
          options: [{ value: 'all', label: floors.length === 1 ? 'The floor' : 'All ' + floors.length + ' floors' }, ...(floors.length > 1 ? floors.map((floor) => ({ value: floor.id, label: floor.name })) : [])],
        });
        const how = segmented({
          name: 'movement-arrange',
          labelledBy: 'movement-arrange-label',
          value: 'side',
          onChange: (value) => change({ floors: value }),
          options: [{ value: 'side', label: 'Side by side' }, { value: 'stacked', label: 'Stacked' }],
        });
        floorsRow.replaceChildren(
          h('span', { class: 'mov-floors__label', id: 'movement-floors-label' }, 'Floors'), which.element,
          h('span', { class: 'vh', id: 'movement-arrange-label' }, 'How the floors are laid out'), how.element);
        floorsRow.which = which;
        floorsRow.how = how;
      }
      const one = floors.some((floor) => floor.id === choice.floors);
      floorsRow.which.set(one ? choice.floors : 'all');
      floorsRow.how.element.hidden = one || floors.length < 2;
      floorsRow.how.set(world ? world.how : 'side');
    }
    ctx.setSecondRow(floorsRow);

    // ---- the inspector
    const panels = { hotspots: hotspotsPanel(env), tables: tablesPanel(env), summary: summaryPanel(env), export: exportPanel(env) };
    const inspector = tabs({
      label: 'What the movement view found',
      selected: MOVEMENT_TABS.some((tab) => tab.id === memory.tab) ? memory.tab : 'summary',
      onSelect(id) {
        memory.tab = id;
        drawPanel();
      },
      items: MOVEMENT_TABS.map((tab) => ({ id: tab.id, label: tab.label, panel: () => panels[tab.id].element })),
    });
    ctx.setInspector(h('div', { class: 'mov-inspector' }, inspector.element));
    function drawPanel() {
      if (state) panels[inspector.selected].update(state);
    }

    // ---- what is chosen
    function change(patch) {
      choice = settleChoice(store.project, { ...choice, ...patch });
      // a new arrangement of the floors is fitted to the window again
      if (patch && 'floors' in patch) fitted = true;
      clearPoint();
      refresh();
    }

    // ---- the results
    function ask() {
      const project = store.project;
      if (derived.asked === project) return;
      derived.asked = project;
      if (!store.derived || !store.derived.engine) {
        derived.failed = 'Nothing is attached to work out the routes.';
        return;
      }
      element.dataset.pending = 'true';
      const settle = (results, failed) => {
        // an answer for a state the project has left is not for the screen
        if (gone || derived.asked !== project || store.project !== project) return;
        derived = { asked: project, project: results ? project : derived.project, results: results || derived.results, failed };
        refresh();
        delete element.dataset.pending;
      };
      store.derived.results().then((results) => settle(results, null), (error) => settle(null, error && error.message ? error.message : String(error)));
    }

    // ---- everything but the canvas
    function refresh() {
      const project = store.project;
      choice = settleChoice(project, choice);
      memory.projectId = project.id;
      memory.choice = choice;
      const f = figures(project);
      const nothing = f.groups === 0 || f.rooms === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      if (nothing) {
        empty.replaceChildren(intro({ headline: HEADLINE, first: first(project), facts: facts(project) }));
        key.element.hidden = true;
        ctx.setInspector(null);
        ctx.setSecondRow(null);
        state = null;
        return;
      }
      if (empty.firstChild) {
        empty.replaceChildren();
        ctx.setInspector(inspector.element.parentElement);
        ctx.setSecondRow(floorsRow);
      }
      // the last answer is drawn against the project it was worked out for
      const shown = derived.results && derived.project ? derived.project : project;
      const graph = graphOf(shown);
      picture = pictureOf(shown, derived.results, graph, choice);
      const health = routeHealth(shown, derived.results);
      const sentence = derived.failed && !derived.results
        ? { parts: [{ text: 'The routes could not be worked out: ' + derived.failed }], showMe: false }
        : sentenceOf(shown, picture, health);
      state = { project: shown, results: derived.results, graph, picture, health };
      lineColours.clear();
      element.dataset.mode = picture.mode;
      element.dataset.groups = String(picture.groups.length);
      top.update(project, picture, sentence);
      key.update(shown, picture);
      bar.update(state);
      drawPanel();
      arrange();
      drawFloors(project);
      queuePaint();
    }

    // ---- where the floors sit
    function arrange() {
      if (!picture) return;
      const floors = picture.floors;
      const how = choice.floors === 'side' || choice.floors === 'stacked' ? choice.floors : bestLayout(floors, view.width, view.height);
      const next = layoutFloors(floors, how);
      const nextKey = JSON.stringify([next.how, next.slots.map((slot) => [slot.floor.id, slot.x, slot.y, slot.w, slot.h, slot.box.x, slot.box.y])]);
      // the floors' views are kept by the slot, for the renderer
      for (const slot of next.slots) slot.view = createViewport();
      if (nextKey !== worldKey) {
        // a map of another shape: an arrangement the window chose is fitted again
        if (worldKey === '' || choice.floors === 'auto') fitted = true;
        worldKey = nextKey;
      }
      world = next;
      if (fitted) fit(true);
    }

    function fit(quiet) {
      if (!world || view.width === 0) return;
      view.fit({ x: 0, y: 0, w: world.width, h: world.height }, 20);
      fitted = true;
      if (!quiet) {
        clearPoint();
        queuePaint();
      }
    }

    function zoomBy(factor) {
      view.zoomAbout(view.zoom * factor, view.width / 2, view.height / 2);
      fitted = false;
      clearPoint();
      queuePaint();
    }

    // Bring cells of a floor onto the map, in the middle of the window.
    function show(floorId, cells) {
      if (!world) return;
      if (!world.slots.some((slot) => slot.floor.id === floorId)) change({ floors: floorId });
      const places = (cells || []).map((cell) => placeOf(world, floorId, cell)).filter(Boolean);
      if (places.length === 0) return;
      const x = places.reduce((sum, place) => sum + place.x + 0.5, 0) / places.length;
      const y = places.reduce((sum, place) => sum + place.y + 0.5, 0) / places.length;
      const at = view.toScreen(x, y);
      view.panBy(view.width / 2 - at.x, view.height / 2 - at.y);
      fitted = false;
      queuePaint();
    }

    // ---- the colours
    function themeColours(theme) {
      const next = (document.documentElement.dataset.theme || '') + ':' + theme.paper;
      if (next !== bandKey) {
        bandKey = next;
        const style = getComputedStyle(canvas);
        bandColours = [1, 2, 3, 4, 5].map((band) => {
          const value = style.getPropertyValue('--load-' + band).trim();
          return parse(value) ? value : '#888888';
        });
        lineColours.clear();
      }
      return bandColours;
    }

    // A group's colour as a line: the group's own, strengthened where it
    // would not show on a corridor of this theme.
    function lineColour(groupId, theme) {
      let colour = lineColours.get(groupId);
      if (!colour) {
        const group = state.project.groups.find((each) => each.id === groupId);
        colour = group && parse(group.colour) ? readable(group.colour, theme.corridor, 3) : theme.ink2;
        lineColours.set(groupId, colour);
      }
      return colour;
    }

    // ---- the canvas
    const overlay = lanesOverlay(() => {
      if (!picture) return null;
      const theme = renderer.theme();
      return {
        bands: picture.bands,
        bandColours: themeColours(theme),
        lanes: picture.lanes,
        markers: picture.markers,
        labels: choice.labels,
        constantWidth: choice.constantWidth,
        colourOf: (groupId) => lineColour(groupId, theme),
      };
    });

    function pixel(floorId, cell) {
      const place = world ? placeOf(world, floorId, cell) : null;
      return place ? view.toScreen(place.x + 0.5, place.y + 0.5) : null;
    }

    function paint() {
      queued = false;
      if (gone || !world || !state || view.width === 0 || map.hidden) return;
      const theme = renderer.theme();
      const ratio = window.devicePixelRatio || 1;
      const size = view.size;
      themeColours(theme);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.fillStyle = theme.paper;
      g.fillRect(0, 0, view.width, view.height);
      for (const slot of world.slots) {
        const left = Math.round(view.x + slot.x * size);
        const topEdge = Math.round(view.y + slot.y * size);
        const right = Math.round(view.x + (slot.x + slot.w) * size);
        const bottom = Math.round(view.y + (slot.y + slot.h) * size);
        // the floor's name, over its top left corner
        const nameSize = Math.max(11, Math.min(18, Math.round(size * 0.7)));
        g.font = '600 ' + nameSize + 'px ' + theme.font;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.fillStyle = theme.ink;
        g.fillText(slot.floor.name, left, topEdge - Math.max(4, Math.round(size * 0.3)));
        if (right < 0 || bottom < 0 || left > view.width || topEdge > view.height) continue;
        const floorView = slot.view;
        floorView.resize(view.width, view.height);
        floorView.zoom = view.zoom;
        floorView.x = view.x + (slot.x - slot.box.x) * size;
        floorView.y = view.y + (slot.y - slot.box.y) * size;
        g.save();
        g.beginPath();
        g.rect(left, topEdge, right - left, bottom - topEdge);
        g.clip();
        renderer.draw({
          project: state.project,
          floor: slot.floor,
          view: floorView,
          selection: [],
          hover: point && point.source !== 'keyboard' && point.floorId === slot.floor.id ? point.cell : null,
          cursor: null,
          preview: null,
          overlays: [overlay, ...env.overlays],
        });
        g.restore();
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.strokeStyle = theme.line;
        g.lineWidth = 1;
        g.strokeRect(left + 0.5, topEdge + 0.5, right - left - 1, bottom - topEdge - 1);
      }

      // the stairs links in use: a dotted arc from one end to the other
      const alone = picture.groups.length === 1 ? lineColour(picture.groups[0].id, theme) : null;
      const linkWidth = Math.max(2, Math.min(4, size * 0.14));
      for (const link of picture.links) {
        const a = pixel(link.a.floorId, link.a.cell);
        const b = pixel(link.b.floorId, link.b.cell);
        if (!a && !b) continue;
        const style = { colour: alone || theme.ink, edge: theme.card, width: linkWidth, font: theme.font, ink: theme.ink };
        if (a && b) {
          drawStairLink(g, a, b, style);
        } else {
          const other = state.project.building.floors.find((floor) => floor.id === (a ? link.b.floorId : link.a.floorId));
          drawStairLink(g, a || b, null, { ...style, text: link.label + (other ? ' to ' + other.name : '') });
        }
      }
      for (const mark of env.marks) {
        g.save();
        mark(g, { view, theme, point: pixel });
        g.restore();
      }

      // the keyboard cursor: dotted, with a light line under the dots
      if (cursor.showing && document.activeElement === canvas) {
        const at = view.toScreen(cursor.x, cursor.y);
        const x = Math.round(at.x) + 1.5;
        const y = Math.round(at.y) + 1.5;
        const side = Math.round(size) - 3;
        g.lineWidth = 3;
        g.strokeStyle = theme.card;
        g.strokeRect(x, y, side, side);
        g.setLineDash([2, 2]);
        g.lineWidth = 2;
        g.strokeStyle = theme.ink;
        g.strokeRect(x, y, side, side);
        g.setLineDash([]);
      }
      zoomText.textContent = Math.round(view.zoom * 100) + '%';
      canvas.dataset.drawn = String(Number(canvas.dataset.drawn || 0) + 1);
    }

    function queuePaint() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    }

    // ---- the cell card
    function clearPoint() {
      if (!point && card.element.hidden) return;
      point = null;
      card.hide();
      queuePaint();
    }

    // The card for a cell of the map. Returns what was found there.
    function pointAt(x, y, source) {
      const found = world ? slotAt(world, x, y) : null;
      const info = found && state ? cellCard(state.project, state.results, state.graph, picture, found.slot.floor.id, found.cell) : null;
      if (!info) {
        clearPoint();
        return { found, info: null };
      }
      point = { floorId: found.slot.floor.id, cell: found.cell, source };
      const at = view.toScreen(x, y);
      card.show(info, { x: at.x, y: at.y, size: view.size }, picture, state.project.settings);
      card.element.dataset.floor = point.floorId;
      card.element.dataset.cell = String(point.cell);
      queuePaint();
      return { found, info };
    }

    const worldFloor = { get width() { return world ? Math.ceil(world.width) : 1; }, get height() { return world ? Math.ceil(world.height) : 1; } };
    const host = {
      view,
      floor: () => worldFloor,
      // nothing is drawn here: a drag moves the map
      down: () => 'pan',
      move() {},
      up() {},
      cancel() {},
      // a tap shows a cell's card and keeps it; a tap on the same cell, or on nothing, puts it away
      tap(ev) {
        const found = world && ev.inside ? slotAt(world, ev.x, ev.y) : null;
        if (!found || (point && point.source === 'tap' && point.floorId === found.slot.floor.id && point.cell === found.cell)) clearPoint();
        else pointAt(ev.x, ev.y, 'tap');
      },
      hover(ev) {
        if (point && point.source === 'tap') return;
        if (!ev || !ev.inside) clearPoint();
        else pointAt(ev.x, ev.y, 'hover');
      },
      hasMenu: () => false,
      menu() {},
      spaceHeld: () => cursor.spaceHeld,
      viewChanged() {
        fitted = false;
        clearPoint();
        queuePaint();
      },
      moved(ev) {
        const { found, info } = pointAt(ev.x, ev.y, 'keyboard');
        if (info) ctx.announce(card.text(info, picture, state.project.settings));
        else ctx.announce(found ? found.slot.floor.name + ': not a corridor.' : 'Between floors.');
        queuePaint();
      },
      escape() {
        if (!point) return false;
        clearPoint();
        return true;
      },
      shown: () => queuePaint(),
    };
    const input = attachInput(canvas, host);
    const cursor = attachCursor(canvas, host);

    function onKey(event) {
      if (!singleKeyAllowed(event)) return;
      if (event.key === '=' || event.key === '+') zoomBy(ZOOM_STEP);
      else if (event.key === '-') zoomBy(1 / ZOOM_STEP);
      else if (event.key === '0') fit();
      else return;
      event.preventDefault();
    }
    canvas.addEventListener('keydown', onKey);
    canvas.addEventListener('focus', queuePaint);
    canvas.addEventListener('blur', queuePaint);

    // ---- the window
    function measure() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (gone || width === 0 || height === 0) return;
      if (width === view.width && height === view.height && canvas.dataset.ratio === String(window.devicePixelRatio || 1)) return;
      view.resize(width, height);
      renderer.resize(width, height, window.devicePixelRatio || 1);
      canvas.dataset.ratio = String(window.devicePixelRatio || 1);
      clearPoint();
      arrange();
      if (floorsRow.how) floorsRow.how.set(world ? world.how : 'side');
      queued = false;
      paint();
    }
    const watcher = new ResizeObserver(measure);
    watcher.observe(stage);
    const dark = matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', queuePaint);

    loadSheet().then(() => {
      if (gone) return;
      element.dataset.styled = 'true';
      measure();
    });

    // Looking at this view is the last step of Getting started. The tick is
    // quiet: no undo entry, and the project does not read as changed.
    setTimeout(() => {
      if (gone || store.project.onboarding.steps[MOVEMENT_STEP] === true) return;
      if (ctx.storage && ctx.storage.state && ctx.storage.state.readOnly) return;
      const f = figures(store.project);
      if (f.groups === 0 || f.rooms === 0) return;
      store.apply(setOnboarding, { step: MOVEMENT_STEP });
    }, 0);

    ask();
    refresh();

    element.movement = {
      view,
      canvas,
      env,
      get choice() { return choice; },
      get picture() { return picture; },
      get world() { return world; },
      get state() { return state; },
      get fitted() { return fitted; },
      get point() { return point; },
      change,
      fit,
      // Where on the canvas a group's lane runs through a cell, and how wide
      // the line is, in CSS pixels; null when the group does not walk there.
      laneAt(groupId, floorId, cell) {
        const at = picture && picture.lanes ? lanePoint(picture.lanes, groupId, floorId, cell) : null;
        const slot = at && world ? world.slots.find((each) => each.floor.id === floorId) : null;
        if (!slot) return null;
        const place = view.toScreen(slot.x + at[0] - slot.box.x, slot.y + at[1] - slot.box.y);
        return { x: place.x, y: place.y, width: lineWidth(picture.lanes, view.size, choice.constantWidth), colour: lineColour(groupId, renderer.theme()) };
      },
      cellAt: pixel,
    };

    return {
      element,
      update() {
        ask();
        refresh();
      },
      unmount() {
        gone = true;
        watcher.disconnect();
        dark.removeEventListener('change', queuePaint);
        input.detach();
        cursor.detach();
        canvas.removeEventListener('keydown', onKey);
      },
    };
  },
};
