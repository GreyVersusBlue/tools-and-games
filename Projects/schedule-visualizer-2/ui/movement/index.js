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
// worked out for, and the section reads as pending (`data-pending`). When an
// answer cannot be worked out the first line says so; a last answer that is
// still on the map is then from before the change, and the section reads as
// stale (`data-stale`) until an answer comes.
//
// Where a later unit plugs in. A panel of the inspector and the playback bar
// are each a function of `env` returning { element, update(state) }:
//
//   env    { ctx,
//            choice(), change(patch, { keepCard })   what is chosen on screen (model.js), and changing it
//            show(floorId, cells)         bring cells onto the map
//            overlays                     [(g, view, floor, theme) => {}] drawn over a floor after the lanes
//            marks                        [(g, map) => {}] drawn over the whole map, on a canvas of their
//                                         own laid over the map's (env.layer): map.point(floorId, cell)
//                                         gives a cell's middle in pixels, or null. A mark with a higher
//                                         `order` is drawn over one with a lower (playback's markers 1,
//                                         the hotspot rings 2); the keyboard cursor is over them all.
//            paint()                      draw the map again (an overlay changed); the marks with it
//            paintMarks()                 draw the marks again, now, and nothing else: what a frame of
//                                         playback or a tick of the pulse costs does not grow with the
//                                         building
//            layer                        the marks' canvas
//            card                         the cell card (card.extra is playback's place in it)
//            fix(where) }                 follow a "fix it" link of route health
//   state  { project, results, graph, picture, health, stale }: the project
//          the results are for, the results (null until the first answer),
//          buildGraph's graph, model.js's picture, routeHealth's list, and
//          whether all of it is from before a change whose answer failed
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
import { slotHash } from '../schedule/index.js';
import { readMovement, writeMovement } from '../../storage/device.js';
import { defaultChoice, settleChoice, addGroup, pictureOf, sentenceOf, routeHealth, cellCard, standingOf, failedSentence, answerCounts, NO_ENGINE } from './model.js';
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

// The keyboard cursor's ring is never smaller than this, in CSS pixels.
export const CURSOR_LEAST = 14;

// How much of the floors' box, in CSS pixels, a pan or a zoom always leaves
// on the stage each way.
export const KEEP_ON_STAGE = 48;

// With nothing attached to work out the routes, how often the view looks
// again for something that is.
export const ENGINE_LOOK_MS = 1000;

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
const memory = { projectId: null, choice: null, tab: 'hotspots', legendFolded: false, controls: null, refused: false };

// The controls are open from this width and folded under it, until the
// reader chooses (DESIGN 5.3); under PHONE the floors' row folds with them.
export const CONTROLS_OPEN_FROM = '(min-width: 900px)';
export const PHONE = '(max-width: 640px)';
export const REFUSED_CHOICE = 'This browser did not keep that choice: it lasts until the page is closed.';

function first(project) {
  const one = periodWords(project.settings).one;
  return 'It draws every group’s walk between one ' + one + ' and the next, so you can see where the corridors fill and who cannot make it in time. Draw the building and give a group its rooms first.';
}

function facts(project) {
  const f = figures(project);
  return 'There is nothing to draw yet: this project has ' + count(f.rooms, 'room') + ' and ' + count(f.groups, 'group') + '.';
}

// Open a group's slot in the Schedule section's Groups tab: a slot has an
// address there (the top of ui/schedule/index.js), and the section does the
// rest.
function openSlot(ctx, slot) {
  ctx.navigate(slotHash(slot.groupId, slot.dayTypeId, slot.period));
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
    // the last answer, the project it was worked out for, and that project's graph
    let derived = { asked: null, project: null, results: null, graph: null, failed: null };
    // The graph of the building as it is: the store keeps one a building (ARCHITECTURE 16, SV2-16).
    const graphNow = () => store.derived.get('graph', ['building'], (project) => buildGraph(project));
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
    // The marks' canvas: over the map's own, the same size, letting every
    // pointer through. It is this view's, made once and never moved, so a
    // paint of the map changes nothing in the document.
    const layer = h('canvas', { class: 'mov-marks', 'aria-hidden': 'true', data: { layer: 'marks', drawn: '0' } });
    const pen = layer.getContext('2d');
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
      paintMarks: () => paintMarks(),
      layer,
      card,
      fix(where) {
        if (where.slot) openSlot(ctx, where.slot);
        else ctx.navigate(where.hash);
      },
    };

    // ---- the controls, shown or folded away behind "Change": the reader's
    // choice on this device (sv2:device, `movement.controls`), and the
    // window's width until there is one
    const wide = matchMedia(CONTROLS_OPEN_FROM);
    const phone = matchMedia(PHONE);
    if (memory.controls === null) memory.controls = readMovement().controls;
    const foldedByDefault = () => (memory.controls === null ? !wide.matches : memory.controls === 'folded');

    const top = controls({
      folded: foldedByDefault(),
      fold(folded) {
        memory.controls = folded ? 'folded' : 'open';
        try {
          writeMovement({ controls: memory.controls });
        } catch (error) {
          // the browser keeps nothing: said once, and the choice holds for the visit
          if (!memory.refused) ctx.toast({ kind: 'warning', text: REFUSED_CHOICE });
          memory.refused = true;
        }
        placeFloors();
        // the map and its zoom buttons moved up or down with no change to the stage's size
        dock();
        ctx.announce(folded ? 'The controls are folded away.' : 'The controls are shown.');
      },
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
      // the card shown whole again may now lie on a floor (it was measured
      // folded): then it docks, and is brought out over the map, since the
      // reader asked to see it, until its own button puts it away
      fold(folded) {
        memory.legendFolded = folded;
        if (folded) return;
        dockLegend();
        key.bringOut();
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
    // over the map while it is the last answer after a derive that failed: the picture is muted under it (movement.css)
    const staleBand = h('p', { class: 'mov-stale', hidden: true, data: { part: 'stale' } }, 'From before your last change');
    const stage = h('div', { class: 'mov-stage' }, canvas, layer, staleBand, h('p', { class: 'vh', id: 'movement-keys' }, KEYS), key.element, card.element, zoomBox);
    const headline = h('h1', { class: 'vh' }, HEADLINE);
    const map = h('div', { class: 'mov-map' }, headline, top.element, stage, key.line, bar.element);
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
    // On a phone the floors' row folds with the controls.
    let floorsShown = null;
    function placeFloors() {
      const shown = !map.hidden && !(top.folded && phone.matches);
      if (shown === floorsShown) return;
      // the row put away with the focus in it (a window narrowed under 640 px):
      // the focus goes to what brings it back
      const held = !shown && floorsRow.contains(document.activeElement);
      floorsShown = shown;
      ctx.setSecondRow(shown ? floorsRow : null);
      if (held) {
        if (map.hidden) ctx.focusSurface();
        else top.element.querySelector('[data-action="change"]').focus();
      }
    }
    function onWidth() {
      if (memory.controls === null) top.setFolded(!wide.matches);
      placeFloors();
      dockLegend();
    }
    wide.addEventListener('change', onWidth);
    phone.addEventListener('change', onWidth);
    placeFloors();

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
    //   options.keepCard   a card the reader tapped open stays on its cell,
    //                      saying what the new choice makes of it (playback
    //                      going on from one transition to the next)
    function change(patch, options) {
      choice = settleChoice(store.project, { ...choice, ...patch });
      // a new arrangement of the floors is fitted to the window again
      if (patch && 'floors' in patch) fitted = true;
      const held = options && options.keepCard === true && !(patch && 'floors' in patch) ? tapped() : null;
      clearPoint();
      refresh();
      reopen(held);
    }

    // A card the reader tapped open, and putting it back on its cell after
    // something that clears the card (the map drawn for another choice, or
    // at another size).
    function tapped() {
      return point && point.source === 'tap' ? { floorId: point.floorId, cell: point.cell } : null;
    }
    function reopen(held) {
      const at = held && world && state ? placeOf(world, held.floorId, held.cell) : null;
      if (at) pointAt(at.x + 0.5, at.y + 0.5, 'tap');
    }

    // ---- the results
    let engineWait = null;
    function lookForEngine() {
      engineWait = null;
      if (gone) return;
      if (store.derived && store.derived.engine) {
        derived.failed = null;
        ask();
        refresh();
      } else {
        engineWait = setTimeout(lookForEngine, ENGINE_LOOK_MS);
      }
    }
    function ask() {
      const project = store.project;
      if (derived.asked === project) return;
      derived.asked = project;
      if (!store.derived || !store.derived.engine) {
        // nothing to ask, and nothing is awaited: the first line says so. The
        // project is not marked asked, and the view looks again now and then,
        // so an engine attached later is asked for this same project.
        derived.asked = null;
        derived.failed = NO_ENGINE;
        if (engineWait === null) engineWait = setTimeout(lookForEngine, ENGINE_LOOK_MS);
        return;
      }
      element.dataset.pending = 'true';
      const settle = (results, failed) => {
        // an answer for a state the project has left is not for the screen
        if (!answerCounts({ gone, asked: derived.asked, answered: project, now: store.project })) return;
        // store.project is `project` here, so the store's graph is this answer's
        derived = { asked: project, project: results ? project : derived.project, results: results || derived.results, graph: results ? graphNow() : derived.graph, failed };
        // the answer is in: nothing is awaited by the time the panels are told (the Export tab reads this)
        delete element.dataset.pending;
        refresh();
        if (failed) ctx.announce(failedSentence(standingOf(project, derived)).parts.map((part) => part.text).join(''));
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
        placeFloors();
        state = null;
        delete element.dataset.stale;
        return;
      }
      if (empty.firstChild) {
        empty.replaceChildren();
        ctx.setInspector(inspector.element.parentElement);
      }
      placeFloors();
      // the last answer is drawn against the project it was worked out for,
      // on that project's graph; after a derive that failed it is stale
      const standing = standingOf(project, derived);
      const shown = standing.project;
      const graph = standing.results && derived.graph ? derived.graph : graphNow();
      picture = pictureOf(shown, standing.results, graph, choice);
      const health = routeHealth(shown, standing.results);
      const sentence = standing.failed ? failedSentence(standing) : sentenceOf(shown, picture, health);
      state = { project: shown, results: standing.results, graph, picture, health, stale: standing.stale };
      if (standing.stale) element.dataset.stale = 'true';
      else delete element.dataset.stale;
      staleBand.hidden = !standing.stale;
      lineColours.clear();
      element.dataset.mode = picture.mode;
      element.dataset.groups = String(picture.groups.length);
      top.update(project, picture, sentence);
      // the scale's toggle shows the setting as it is now, not as the picture on screen had it
      key.update(shown, picture, { mode: project.settings.colourScale && project.settings.colourScale.mode === 'absolute' ? 'absolute' : 'relative' });
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
      dockLegend();
      if (fitted) fit(true);
    }

    // ---- the legend never covers a floor (DESIGN 5.3). Its card stands on
    // the map's bottom right corner only where, with the map fitted to the
    // window, it would lie on no floor; otherwise, and always on a phone, it
    // is docked as one line under the map. The stage is measured as it is
    // without that line, so that docking does not itself decide the answer.
    const probe = createViewport();
    function coversFloor() {
      if (!world || view.width === 0) return false;
      const height = view.height + (key.line.hidden ? 0 : key.line.offsetHeight);
      const card = key.element;
      const width = card.offsetWidth;
      const tall = card.offsetHeight;
      if (width === 0 || tall === 0) return false;
      probe.resize(view.width, height);
      probe.fit({ x: 0, y: 0, w: world.width, h: world.height }, 20);
      const style = getComputedStyle(card);
      const right = view.width - (parseFloat(style.right) || 0);
      const bottom = height - (parseFloat(style.bottom) || 0);
      const box = { left: right - width, top: bottom - tall, right, bottom };
      const size = probe.size;
      return world.slots.some((slot) => {
        const left = probe.x + slot.x * size;
        const topEdge = probe.y + slot.y * size;
        return left < box.right && box.left < left + slot.w * size && topEdge < box.bottom && box.top < topEdge + slot.h * size;
      });
    }
    function dockLegend() {
      if (gone || key.element.hidden) return;
      key.setDocked(phone.matches || coversFloor());
    }

    function fit(quiet) {
      if (!world || view.width === 0) return;
      view.fit({ x: 0, y: 0, w: world.width, h: world.height }, 20);
      fitted = true;
      shownLast = null;
      if (!quiet) {
        clearPoint();
        queuePaint();
      }
    }

    // The map is never moved off the stage (SV2-52): a wheel meant for the
    // section, a long drag or a zoom far in leaves at least KEEP_ON_STAGE px
    // of the floors' box on screen each way (all of it, when it is smaller),
    // so the stage is never a blank field with nothing to say where the
    // floors went.
    function keepOnStage() {
      if (!world || view.width === 0) return;
      const size = view.size;
      const across = world.width * size;
      const down = world.height * size;
      const keepX = Math.min(KEEP_ON_STAGE, across);
      const keepY = Math.min(KEEP_ON_STAGE, down);
      let dx = 0;
      let dy = 0;
      if (view.x + across < keepX) dx = keepX - (view.x + across);
      else if (view.x > view.width - keepX) dx = view.width - keepX - view.x;
      if (view.y + down < keepY) dy = keepY - (view.y + down);
      else if (view.y > view.height - keepY) dy = view.height - keepY - view.y;
      if (dx !== 0 || dy !== 0) view.panBy(dx, dy);
    }

    function zoomBy(factor) {
      view.zoomAbout(view.zoom * factor, view.width / 2, view.height / 2);
      keepOnStage();
      fitted = false;
      shownLast = null;
      clearPoint();
      queuePaint();
    }

    // Bring cells of a floor onto the map, in the middle of the window. They
    // stay in the middle if the window then changes size (the inspector's
    // sheet shut over them, the bar grew), until the reader moves the map.
    let shownLast = null;
    function centre(floorId, cells) {
      const places = (cells || []).map((cell) => placeOf(world, floorId, cell)).filter(Boolean);
      if (places.length === 0) return false;
      const x = places.reduce((sum, place) => sum + place.x + 0.5, 0) / places.length;
      const y = places.reduce((sum, place) => sum + place.y + 0.5, 0) / places.length;
      const at = view.toScreen(x, y);
      view.panBy(view.width / 2 - at.x, view.height / 2 - at.y);
      fitted = false;
      return true;
    }
    function show(floorId, cells) {
      if (!world) return;
      if (!world.slots.some((slot) => slot.floor.id === floorId)) change({ floors: floorId });
      if (!centre(floorId, cells)) return;
      shownLast = { floorId, cells: cells.slice() };
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
      paintMarks();
      zoomText.textContent = Math.round(view.zoom * 100) + '%';
      canvas.dataset.drawn = String(Number(canvas.dataset.drawn || 0) + 1);
    }

    // ---- the marks: what moves or changes without the map changing under
    // it (playback's markers, the hotspot rings and their pulse, the keyboard
    // cursor), drawn in that order on their own canvas.
    function paintMarks() {
      if (gone || !world || !state || view.width === 0 || map.hidden) return;
      const theme = renderer.theme();
      const ratio = window.devicePixelRatio || 1;
      // the same pixels as the map's canvas, whatever the renderer rounded them to
      if (layer.width !== canvas.width) layer.width = canvas.width;
      if (layer.height !== canvas.height) layer.height = canvas.height;
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.clearRect(0, 0, layer.width, layer.height);
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      const given = { view, theme, point: pixel };
      for (const mark of env.marks.slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
        pen.save();
        mark(pen, given);
        pen.restore();
      }
      drawCursor(pen, theme);
      layer.dataset.drawn = String(Number(layer.dataset.drawn) + 1);
    }

    // The keyboard cursor (DESIGN 5.3): a ring round its cell, never under
    // CURSOR_LEAST px across however far the map is zoomed out, a 2 px line in
    // the focus colour between two 1 px lines of the surface's, so it reads
    // on a corridor, on a lane, on a marker and on a hotspot's ring alike.
    function drawCursor(c, theme) {
      delete layer.dataset.cursor;
      if (!cursor.showing || document.activeElement !== canvas) return;
      const at = view.toScreen(cursor.x + 0.5, cursor.y + 0.5);
      const side = Math.max(CURSOR_LEAST, Math.round(view.size) - 2);
      const x = Math.round(at.x - side / 2);
      const y = Math.round(at.y - side / 2);
      c.lineJoin = 'round';
      c.strokeStyle = theme.card;
      c.lineWidth = 4;
      c.strokeRect(x + 1, y + 1, side - 2, side - 2);
      c.strokeStyle = theme.accent;
      c.lineWidth = 2;
      c.strokeRect(x + 1, y + 1, side - 2, side - 2);
      layer.dataset.cursor = [x, y, side].join(',');
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
      point = { floorId: found.slot.floor.id, cell: found.cell, source, picture };
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
        if (!ev || !ev.inside) {
          clearPoint();
          return;
        }
        // still in the cell whose card is up, over the same picture: nothing to work out again
        const found = point && point.source === 'hover' && point.picture === picture && world ? slotAt(world, ev.x, ev.y) : null;
        if (found && found.slot.floor.id === point.floorId && found.cell === point.cell) return;
        pointAt(ev.x, ev.y, 'hover');
      },
      hasMenu: () => false,
      menu() {},
      spaceHeld: () => cursor.spaceHeld,
      viewChanged() {
        keepOnStage();
        fitted = false;
        shownLast = null;
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
    // the cursor comes and goes with the focus: the marks alone are drawn again
    canvas.addEventListener('focus', paintMarks);
    canvas.addEventListener('blur', paintMarks);

    // ---- the window
    function measure() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (gone || width === 0 || height === 0) return;
      if (width === view.width && height === view.height && canvas.dataset.ratio === String(window.devicePixelRatio || 1)) return;
      view.resize(width, height);
      renderer.resize(width, height, window.devicePixelRatio || 1);
      canvas.dataset.ratio = String(window.devicePixelRatio || 1);
      // a card under the pointer goes with the old size; one the reader tapped open is put back on its cell
      const held = tapped();
      clearPoint();
      arrange();
      // what was brought to the middle is still in the middle of the window as it is now
      if (shownLast && !fitted && world) centre(shownLast.floorId, shownLast.cells);
      reopen(held);
      if (floorsRow.how) floorsRow.how.set(world ? world.how : 'side');
      queued = false;
      paint();
    }
    const watcher = new ResizeObserver(() => {
      measure();
      dock();
    });
    watcher.observe(stage);

    // ---- where a message of the shell may lie (DESIGN 5.3): above what is
    // docked at the bottom of the surface, the playback bar and the zoom
    // buttons. How far that reaches up from the surface's bottom edge is
    // --toast-clear on the surface, measured as it is on screen now: when
    // the stage changes size (the bar under it grew or shrank, the window
    // changed) and when either of them is scrolled.
    let dockHost = null;
    function dock() {
      const host = dockHost || element.closest('.surface');
      if (gone || !host) return;
      dockHost = host;
      const edge = host.getBoundingClientRect();
      const foot = edge.top + host.clientTop + host.clientHeight;
      let top = foot;
      for (const each of [zoomBox, bar.element]) {
        const box = each.getBoundingClientRect();
        if (box.height > 0 && box.bottom > edge.top && box.top < foot) top = Math.min(top, box.top);
      }
      const clear = Math.max(0, Math.round(foot - top)) + 'px';
      if (host.style.getPropertyValue('--toast-clear') !== clear) host.style.setProperty('--toast-clear', clear);
    }
    // ---- what the section has for the map (DESIGN 5.3; SV2-52): its height
    // less the first line, as it is with the controls folded, and less what
    // is docked under the map (the legend's line and the playback bar). The
    // stage's floor of 45 % and 320 px is never more than that (--mov-room,
    // movement.css), so in a short window the first line, the map and the
    // bar are all on screen and nothing scrolls until the controls are shown.
    // Two things lie over the section for a while and take nothing from the
    // map: the inspector's sheet (under 900 px; the section scrolls under it
    // with the map's top showing above it) and the bar's More (the bar grows
    // up over the map's foot). The section is measured as with both shut.
    const firstLine = top.element.querySelector('.mov-line');
    const barMore = bar.element.querySelector('[data-part="more"]');
    function room() {
      if (gone || map.hidden || element.clientHeight === 0) return;
      let height = element.clientHeight;
      const sheet = document.getElementById('inspector');
      if (sheet && !sheet.hidden && sheet.dataset.mode === 'sheet' && sheet.dataset.open === 'true') {
        const handle = sheet.querySelector('.inspector__bar');
        height += sheet.getBoundingClientRect().height - (handle ? handle.getBoundingClientRect().height : 0);
      }
      const shape = getComputedStyle(top.element);
      const line = firstLine.getBoundingClientRect().height + (parseFloat(shape.paddingTop) || 0) + (parseFloat(shape.paddingBottom) || 0) + (parseFloat(shape.borderBottomWidth) || 0);
      const gap = parseFloat(getComputedStyle(bar.element).rowGap) || 0;
      // boxes as drawn, not rounded: whole pixels taken apart again can be one out
      const tall = (el) => el.getBoundingClientRect().height;
      const more = barMore && !barMore.hidden ? tall(barMore) + gap : 0;
      const docked = key.line.hidden ? 0 : tall(key.line);
      const foot = tall(bar.element) - more + docked;
      const has = Math.max(0, Math.floor(height - line - foot));
      const next = has + 'px';
      if (element.style.getPropertyValue('--mov-room') !== next) element.style.setProperty('--mov-room', next);
      // More may take the map's height and the legend's line, never the first line's
      const moreRoom = Math.max(0, has + docked - gap) + 'px';
      if (element.style.getPropertyValue('--mov-more') !== moreRoom) element.style.setProperty('--mov-more', moreRoom);
      // the bar's height this was measured with, for a test to wait on
      element.dataset.measuredBar = String(bar.element.offsetHeight);
    }
    // and where a message may lie, which moves with the bar's height (More,
    // a line of words under the row) whether or not the stage changes size
    const roomWatcher = new ResizeObserver(() => {
      room();
      dock();
    });
    for (const each of [element, firstLine, bar.element, key.line]) roomWatcher.observe(each);

    // A wheel over the map scrolls the section while the section has some
    // way to go that way and the map is not all on screen (the controls are
    // shown in a short window); after that it moves the map, as it does
    // everywhere else. Ctrl or Cmd with the wheel always zooms the map.
    function sectionTakes(event) {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return false;
      const most = element.scrollHeight - element.clientHeight;
      if (most <= 0) return false;
      const edge = element.getBoundingClientRect();
      const shown = stage.getBoundingClientRect();
      // the bar lies over the map's foot until the section is at its end
      const foot = Math.min(edge.bottom, bar.element.getBoundingClientRect().top);
      if (event.deltaY > 0) return element.scrollTop < most - 1 && shown.bottom > foot + 1;
      return element.scrollTop > 0 && shown.top < edge.top - 1;
    }
    function onStageWheel(event) {
      // the map's own handler (ui/surface/input.js) is not reached, and the browser scrolls the section
      if (sectionTakes(event)) event.stopPropagation();
    }
    stage.addEventListener('wheel', onStageWheel, { capture: true, passive: true });

    // the surface scrolls down to Getting started, and the section inside
    // itself on a small window: the dock moves with both
    element.addEventListener('scroll', dock, { passive: true });
    const onSurfaceScroll = (event) => {
      if (event.target === dockHost) dock();
    };
    document.addEventListener('scroll', onSurfaceScroll, { passive: true, capture: true });
    const dark = matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', queuePaint);
    // The pixels a CSS pixel is made of change with no change of size (the
    // window moved to another screen, the browser's zoom): the canvases are
    // made again at the new ratio. A query matches one ratio, so it is asked
    // again each time.
    let ratioQuery = null;
    function onRatio() {
      watchRatio();
      measure();
    }
    function watchRatio() {
      if (ratioQuery) ratioQuery.removeEventListener('change', onRatio);
      ratioQuery = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      ratioQuery.addEventListener('change', onRatio);
    }
    watchRatio();

    loadSheet().then(() => {
      if (gone) return;
      element.dataset.styled = 'true';
      room();
      measure();
      dock();
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
      // the keyboard cursor (ui/surface/cursor.js): where it is, and moveTo(x, y, visible)
      cursor,
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
      // where the shell's "to the surface" goes: the map
      focus() {
        // with nothing to draw there is no map: the shell takes the region
        if (map.hidden) return false;
        canvas.focus();
        return true;
      },
      update() {
        ask();
        refresh();
      },
      unmount() {
        gone = true;
        if (engineWait !== null) clearTimeout(engineWait);
        element.removeEventListener('scroll', dock);
        document.removeEventListener('scroll', onSurfaceScroll, { capture: true });
        if (dockHost) dockHost.style.removeProperty('--toast-clear');
        bar.unmount();
        watcher.disconnect();
        roomWatcher.disconnect();
        stage.removeEventListener('wheel', onStageWheel, { capture: true });
        dark.removeEventListener('change', queuePaint);
        if (ratioQuery) ratioQuery.removeEventListener('change', onRatio);
        wide.removeEventListener('change', onWidth);
        phone.removeEventListener('change', onWidth);
        input.detach();
        cursor.detach();
        canvas.removeEventListener('keydown', onKey);
        panels.hotspots.unmount();
      },
    };
  },
};
