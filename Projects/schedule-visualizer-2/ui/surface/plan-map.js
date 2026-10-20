// The plan map: every floor of the building on one canvas, with one zoom and
// one pan, a canvas of marks over it, the keyboard cursor, the zoom buttons
// and the top bar's row of floors. Movement draws its walks on it; Scenarios
// and Safety mount the same map with their own overlay (ARCHITECTURE 6.6).
//
//   const map = createPlanMap({ ctx, label, name, frame, floorsRow, keys })
//     ctx         the shell's section context
//     label       the map's accessible name ("The movement map")
//     name        required: the prefix of the ids ('movement': #movement-plan,
//                 #movement-keys); two maps on one page need two names
//     frame       required: the section around the map, an object or a
//                 function returning one, asked once (at the first
//                 setProject or remeasure, or straight after the code that
//                 made the map, whichever is first):
//                 { before, after, inside, head, line, foot, more, under },
//                 every one optional, so {} is a bare map. `before` and
//                 `after` are lists put above and under the stage in
//                 map.element, `inside` a list put on the stage under the
//                 zoom buttons; the rest are what the stage's room is
//                 measured with (stageRoom): `head` the box of the first line
//                 and the controls, `line` the first line (what the head
//                 folds to), `foot` the bar sticky at the section's foot,
//                 `more` what of the foot may grow over the map, `under` a
//                 line docked under the stage
//     floorsRow   { value(), change(value) }: which floors are on the map
//                 ('auto', 'side', 'stacked' or a floor's id) and choosing
//                 another; the map then puts its row of floors in the top
//                 bar's second row. Without it every floor is on the map, laid
//                 out as fits the window best, and there is no row.
//     keys        the sentence a screen reader is given for the map's keys
//
// A name or a frame left out is a TypeError naming it. The map makes its own
// root, map.root (div.mov, the section's scrolling element, with map.element
// in it): it loads movement.css, whose .mov-* rules style it, sets
// data-styled="true" on the root once the sheet is in, and measures itself
// then. While it is mounted the shell's layout element carries data-plan-map
// (the name), which is what puts the layout of a plan (ui/app.css, "The plan
// map's sections in the shell") on Scenarios and Safety. What a section that
// mounts it still has to do:
//   - put map.root (or something holding it) in the element it returns;
//   - call map.setProject(project, graph) from its update, which is also how
//     a change of theme is drawn (the theme is a setting of the project);
//   - call map.unmount() from its own unmount.
//
//   map.root                the section's scrolling element (div.mov)
//   map.element             the column the stage stands in (.mov-map)
//   map.stage               the stage (.mov-stage): the map's canvas, the marks' canvas, the zoom buttons
//   map.setProject(project, graph)   draw this project (the one the section's
//                           answer is for, which can be older than the store's)
//   map.overlays            [(g, view, floor, theme) => {}] drawn over each floor, in order
//   map.across              [(g, map) => {}] drawn on the map's canvas over every floor (stairs links)
//   map.marks               [(g, map) => {}] drawn on the marks' canvas, by `order`, the cursor last;
//                           map.point(floorId, cell) is a cell's middle in pixels, or null
//   map.paint()             draw the map again, at the next frame; the marks with it
//   map.paintMarks()        draw the marks again, now, and nothing else
//   map.show(floorId, cells)   bring cells to the middle of the map
//   map.fit(quiet)          fit the map to the stage
//   map.focus()             put the focus on the map; false when it is hidden
//   map.cellAt(floorId, cell)  a cell's middle in pixels, or null
//   map.onCell(fn)          fn({ kind, x, y, inside }) for what is done to a cell:
//                           'tap', 'hover', 'keyboard' (the cursor moved there),
//                           'enter' (Enter on the cursor's cell; SV2-72c),
//                           'escape' (fn returns true when it used the key),
//                           'view' (the map moved under the pointer) and
//                           'resize' (the stage changed size); x and y are in
//                           the map's cells
//   map.unmount()
//
// What Movement needed besides (SV2-65):
//   map.view, map.canvas, map.layer, map.cursor, map.world, map.fitted,
//   map.graph, map.project
//   map.theme()             the renderer's colours
//   map.hover(floorId, cell)   the cell drawn as hovered (null for none)
//   map.showFloors(shown)   put the row of floors in the top bar or take it
//                           away; true when the focus was in the row taken away
//   map.onLayout(fn)        fn() each time the floors are laid out, before
//                           a fitted map is fitted again
//   map.remeasure()         measure the section again
//   map.dock()              measure again where a message may lie (the
//                           section's head moved with no change of size)
//
// The rules of the stage (DESIGN 5.3; DECISIONS 2026-10-14 23:53,
// 2026-10-15 11:54 and 2026-10-16 01:15) are here, for every section: the
// stage is never under its least (stageLeast in ./plan-layout.js, never
// under what the zoom box needs as drawn), a section with less scrolls with
// the bar sticky at its foot, the zoom buttons and a docked line lift over
// the bar, no pan or zoom leaves under KEEP_ON_STAGE px of the floors, and a
// message of the shell lies above what is docked at the bottom
// (--toast-clear, owned by the map mounted last of those still mounted).

import { h } from '../components/dom.js';
import { choice as segmented } from '../components/choice.js';
import { singleKeyAllowed } from '../components/shortcuts.js';
import { createViewport, ZOOM_STEP } from './viewport.js';
import { createRenderer } from './renderer.js';
import { attachInput } from './input.js';
import { attachCursor } from './cursor.js';
import { layoutFloors, bestLayout, placeOf, stageLeast, keepShift, FIT_MARGIN } from './plan-layout.js';

// The map's stylesheet: movement.css's .mov-* rules, for every section that
// mounts it. A page that links it (data-sheet="movement", as index.html does)
// is left alone; otherwise it is added here.
const SHEET = new URL('../movement/movement.css', import.meta.url).href;
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

// The maps mounted now, in the order they were made: { name, layout,
// surface, clear }. The surface's --toast-clear is the last one's; a map
// under it measures its own value and keeps it, and gets the surface back
// when the one over it is unmounted. The shell's layout keeps data-plan-map
// while any map mounted on it is.
const mounted = [];
function setClear(entry) {
  if (!entry || !entry.surface) return;
  if (entry.clear === null) entry.surface.style.removeProperty('--toast-clear');
  else if (entry.surface.style.getPropertyValue('--toast-clear') !== entry.clear) entry.surface.style.setProperty('--toast-clear', entry.clear);
}

// The keyboard cursor's ring is never smaller than this, in CSS pixels.
export const CURSOR_LEAST = 14;

// How much of the floors' box, in CSS pixels, a pan or a zoom always leaves
// on the stage each way.
export const KEEP_ON_STAGE = 48;

// The map is never moved off the stage (SV2-52): a wheel meant for the
// section, a long drag or a zoom far in leaves at least KEEP_ON_STAGE px of
// the floors' box on screen each way (all of it, when it is smaller), so the
// stage is never a blank field with nothing to say where the floors went.
// The keep is capped by the stage's own size (keepShift), and it is applied
// after the stage changes size as well (SV2-55). True when the map moved.
export function keepOnStage(view, world) {
  if (!world || view.width === 0) return false;
  const { dx, dy } = keepShift(view, world, KEEP_ON_STAGE);
  if (dx !== 0 || dy !== 0) view.panBy(dx, dy);
  return dx !== 0 || dy !== 0;
}

// What the section has for the map (DESIGN 5.3; SV2-52): its height less the
// first line, as it is with the controls folded, and less what is docked
// under the map (the foot's own height without what may grow over the map,
// and the docked line). The stage's floor of 45 % and 320 px is never more
// than that (--mov-room), so in a short window the first line, the map and
// the bar are all on screen and nothing scrolls until the controls are
// shown. What the stage gets is never under its least (stageLeast, SV2-55
// and SV2-57): a section with less scrolls, rather than the map becoming a
// strip with the zoom over it. Nor is the least more than the section has
// over the foot and the docked line, so with the first line scrolled away
// the whole stage is on screen (110 px at 844 by 390 on a touch screen).
//
//   m = { world, width, zoomRoom, height, line, foot, docked, gap, bar }
//     world, width, zoomRoom   the floors' layout, the stage's width, the zoom box's need
//     height        the section's height (with an open sheet's height given back)
//     line          the first line with the head's padding and edge
//     foot          the foot as it is docked plus the docked line
//     docked        the docked line alone
//     gap           the foot's gap over what may grow over the map
//     bar           the foot's whole height
//   -> { room, more, bar }   --mov-room, --mov-more and --mov-bar, in px
export function stageRoom(m) {
  const has = Math.max(0, Math.floor(m.height - m.line - m.foot));
  const least = Math.min(stageLeast(m.world, m.width, m.zoomRoom), Math.max(0, Math.floor(m.height - m.foot)));
  return {
    room: Math.max(has, least),
    // what may grow over the map takes the map's height and the docked line, never the first line's
    more: Math.max(0, has + m.docked - m.gap),
    // a control brought into view is brought clear of the foot (scroll-padding-bottom)
    bar: Math.ceil(m.bar),
  };
}

// Which floors a choice puts on the map: one floor by its id, else all.
// Movement's picture has the same rule as shownFloors (ui/movement/model.js),
// which reads the choice whole; a change to one is a change to the other.
export function floorsShown(project, value) {
  const one = project.building.floors.find((floor) => floor.id === value);
  return one ? [one] : project.building.floors.slice();
}

export function createPlanMap(asked) {
  const options = asked || {};
  if (typeof options.name !== 'string' || options.name === '') throw new TypeError('createPlanMap needs a name: the prefix of the map\'s ids (\'movement\' gives #movement-plan).');
  const frameOption = options.frame;
  if (frameOption === null || (typeof frameOption !== 'function' && typeof frameOption !== 'object')) throw new TypeError('createPlanMap needs a frame: the section around the map, { before, after, inside, head, line, foot, more, under } or a function returning it ({} for a bare map).');
  const ctx = options.ctx;
  const name = options.name;
  const floorsChoice = options.floorsRow || null;
  let project = null;
  let graph = null;
  let world = null;
  let worldKey = '';
  let floorsValue = null;
  let fitted = true;
  let queued = false;
  let gone = false;
  let hovered = null;
  let parts = null;
  const cellFns = [];
  const layoutFns = [];

  const view = createViewport();
  const canvas = h('canvas', { class: 'mov-plan', id: name + '-plan', tabindex: '0', role: 'application', 'aria-label': options.label, 'aria-describedby': name + '-keys' });
  const renderer = createRenderer(canvas);
  const g = canvas.getContext('2d');
  // The marks' canvas: over the map's own, the same size, letting every
  // pointer through. It is this map's, made once and never moved, so a
  // paint of the map changes nothing in the document.
  const layer = h('canvas', { class: 'mov-marks', 'aria-hidden': 'true', data: { layer: 'marks', drawn: '0' } });
  const pen = layer.getContext('2d');
  const zoomText = h('span', { class: 'mov-zoom__text', 'aria-live': 'off' });
  const zoomBox = h('div', { class: 'mov-zoom', role: 'group', 'aria-label': 'Zoom' },
    h('button', { type: 'button', class: 'mov-zoom__btn', 'aria-label': 'Zoom out', title: 'Zoom out (-)', data: { action: 'zoom-out' }, on: { click: () => zoomBy(1 / ZOOM_STEP) } }, '−'),
    zoomText,
    h('button', { type: 'button', class: 'mov-zoom__btn', 'aria-label': 'Zoom in', title: 'Zoom in (=)', data: { action: 'zoom-in' }, on: { click: () => zoomBy(ZOOM_STEP) } }, '+'),
    h('button', { type: 'button', class: 'mov-zoom__btn mov-zoom__btn--fit', title: 'Fit the map to the window (0)', data: { action: 'fit' }, on: { click: () => fit() } }, 'Fit'));
  const stage = h('div', { class: 'mov-stage' }, canvas, layer, h('p', { class: 'vh', id: name + '-keys' }, options.keys || ''), zoomBox);
  const element = h('div', { class: 'mov-map' }, stage);
  // the section's scrolling element, hidden (movement.css) until its sheet is in
  const root = h('div', { class: 'mov', data: { styled: 'false' } }, element);

  // this map in the list of those mounted, and the shell's layout marked as holding one
  const layout = document.querySelector('.surface__layout');
  const me = { name, layout, surface: null, clear: null };
  mounted.push(me);
  if (layout) layout.dataset.planMap = name;

  const overlays = [];
  const across = [];
  const marks = [];

  function emit(event) {
    let used = false;
    for (const fn of cellFns) if (fn(event) === true) used = true;
    return used;
  }

  // ---- the top bar's second row: which floors, and how they are laid out
  const floorsRow = h('div', { class: 'mov-floors' });
  let floorsKey = '';
  function drawFloors() {
    if (!floorsChoice) return;
    const floors = ctx.store.project.building.floors;
    const value = floorsChoice.value();
    const next = JSON.stringify(floors.map((floor) => [floor.id, floor.name]));
    if (next !== floorsKey) {
      floorsKey = next;
      const which = segmented({
        name: name + '-floors',
        labelledBy: name + '-floors-label',
        value,
        onChange: (chosen) => floorsChoice.change(chosen === 'all' ? 'auto' : chosen),
        options: [{ value: 'all', label: floors.length === 1 ? 'The floor' : 'All ' + floors.length + ' floors' }, ...(floors.length > 1 ? floors.map((floor) => ({ value: floor.id, label: floor.name })) : [])],
      });
      const how = segmented({
        name: name + '-arrange',
        labelledBy: name + '-arrange-label',
        value: 'side',
        onChange: (chosen) => floorsChoice.change(chosen),
        options: [{ value: 'side', label: 'Side by side' }, { value: 'stacked', label: 'Stacked' }],
      });
      floorsRow.replaceChildren(
        h('span', { class: 'mov-floors__label', id: name + '-floors-label' }, 'Floors'), which.element,
        h('span', { class: 'vh', id: name + '-arrange-label' }, 'How the floors are laid out'), how.element);
      floorsRow.which = which;
      floorsRow.how = how;
    }
    const one = floors.some((floor) => floor.id === value);
    floorsRow.which.set(one ? value : 'all');
    floorsRow.how.element.hidden = one || floors.length < 2;
    floorsRow.how.set(world ? world.how : 'side');
  }
  let floorsOn = null;
  function showFloors(shown) {
    if (!floorsChoice || shown === floorsOn) return false;
    const held = !shown && floorsRow.contains(document.activeElement);
    floorsOn = shown;
    ctx.setSecondRow(shown ? floorsRow : null);
    return held;
  }

  // ---- where the floors sit
  function arrange() {
    if (!project) return;
    const value = floorsChoice ? floorsChoice.value() : 'auto';
    const floors = floorsShown(project, value);
    // another choice of floors is fitted to the window again
    if (floorsValue !== null && value !== floorsValue) fitted = true;
    floorsValue = value;
    const how = value === 'side' || value === 'stacked' ? value : bestLayout(floors, view.width, view.height);
    const next = layoutFloors(floors, how);
    const nextKey = JSON.stringify([next.how, next.slots.map((slot) => [slot.floor.id, slot.x, slot.y, slot.w, slot.h, slot.box.x, slot.box.y])]);
    // the floors' views are kept by the slot, for the renderer
    for (const slot of next.slots) slot.view = createViewport();
    if (nextKey !== worldKey) {
      // a map of another shape: an arrangement the window chose is fitted again
      if (worldKey === '' || value === 'auto') fitted = true;
      worldKey = nextKey;
    }
    world = next;
    for (const fn of layoutFns) fn();
    if (fitted) fit(true);
    // the stage's least follows the floors' box (stageLeast)
    if (parts) room();
  }

  function setProject(next, nextGraph) {
    framed();
    project = next;
    graph = nextGraph || null;
    arrange();
    drawFloors();
    queuePaint();
  }

  function fit(quiet) {
    if (!world || view.width === 0) return;
    view.fit({ x: 0, y: 0, w: world.width, h: world.height }, FIT_MARGIN);
    fitted = true;
    shownLast = null;
    if (!quiet) {
      emit({ kind: 'view' });
      queuePaint();
    }
  }

  function zoomBy(factor) {
    view.zoomAbout(view.zoom * factor, view.width / 2, view.height / 2);
    keepOnStage(view, world);
    fitted = false;
    shownLast = null;
    emit({ kind: 'view' });
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
    if (floorsChoice && !world.slots.some((slot) => slot.floor.id === floorId)) floorsChoice.change(floorId);
    if (!centre(floorId, cells)) return;
    shownLast = { floorId, cells: cells.slice() };
    queuePaint();
  }

  function pixel(floorId, cell) {
    const place = world ? placeOf(world, floorId, cell) : null;
    return place ? view.toScreen(place.x + 0.5, place.y + 0.5) : null;
  }

  // ---- the canvas
  function paint() {
    queued = false;
    if (gone || !world || !project || view.width === 0 || element.hidden) return;
    const theme = renderer.theme();
    const ratio = window.devicePixelRatio || 1;
    const size = view.size;
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
        project,
        floor: slot.floor,
        view: floorView,
        selection: [],
        hover: hovered && hovered.floorId === slot.floor.id ? hovered.cell : null,
        cursor: null,
        preview: null,
        overlays: overlays.slice(),
      });
      g.restore();
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.strokeStyle = theme.line;
      g.lineWidth = 1;
      g.strokeRect(left + 0.5, topEdge + 0.5, right - left - 1, bottom - topEdge - 1);
    }
    const given = { view, theme, point: pixel };
    for (const draw of across) {
      g.save();
      draw(g, given);
      g.restore();
    }
    paintMarks();
    zoomText.textContent = Math.round(view.zoom * 100) + '%';
    canvas.dataset.drawn = String(Number(canvas.dataset.drawn || 0) + 1);
  }

  // ---- the marks: what moves or changes without the map changing under it
  // (playback's markers, the hotspot rings and their pulse, the keyboard
  // cursor), drawn in that order on their own canvas.
  function paintMarks() {
    if (gone || !world || !project || view.width === 0 || element.hidden) return;
    const theme = renderer.theme();
    const ratio = window.devicePixelRatio || 1;
    // the same pixels as the map's canvas, whatever the renderer rounded them to
    if (layer.width !== canvas.width) layer.width = canvas.width;
    if (layer.height !== canvas.height) layer.height = canvas.height;
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.clearRect(0, 0, layer.width, layer.height);
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const given = { view, theme, point: pixel };
    for (const mark of marks.slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
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

  // ---- the pointer and the keyboard cursor
  const worldFloor = { get width() { return world ? Math.ceil(world.width) : 1; }, get height() { return world ? Math.ceil(world.height) : 1; } };
  const host = {
    view,
    floor: () => worldFloor,
    // nothing is drawn here: a drag moves the map
    down: () => 'pan',
    move() {},
    up() {},
    cancel() {},
    tap: (ev) => emit({ ...ev, kind: 'tap' }),
    hover: (ev) => emit({ ...(ev || { inside: false }), kind: 'hover' }),
    hasMenu: () => false,
    menu() {},
    spaceHeld: () => cursor.spaceHeld,
    viewChanged() {
      keepOnStage(view, world);
      fitted = false;
      shownLast = null;
      emit({ kind: 'view' });
      queuePaint();
    },
    moved(ev) {
      emit({ ...ev, kind: 'keyboard' });
      queuePaint();
    },
    escape: () => emit({ kind: 'escape' }),
    // Enter on the cursor's cell: a press here would be a pan, so it is said as itself
    enter: (ev) => emit({ ...ev, kind: 'enter' }),
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
    arrange();
    // what was brought to the middle is still in the middle of the window as it is now
    if (shownLast && !fitted && world) centre(shownLast.floorId, shownLast.cells);
    // and a map the reader moved is still on the stage at its new size
    if (!fitted) keepOnStage(view, world);
    // a card under the pointer goes with the old size; one tapped open is put back (the section's)
    emit({ kind: 'resize' });
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
  // docked at the bottom of the surface, the foot and the zoom buttons. How
  // far that reaches up from the surface's bottom edge is --toast-clear on
  // the surface, measured as it is on screen now: when the stage changes
  // size (the foot under it grew or shrank, the window changed) and when
  // either of them is scrolled.
  // The frame's foot as it is on screen: none when it has no box (not
  // rendered, or a section's bar laid out as display: none), whose
  // getBoundingClientRect() would read 0 everywhere, as if the foot stood
  // at the window's top and lay over the whole stage (SV2-68's review)
  function footShown() {
    const foot = parts && parts.foot;
    return foot && foot.getClientRects().length > 0 ? foot : null;
  }

  let dockHost = null;
  function dock() {
    if (gone || !parts) return;
    const surface = dockHost || parts.root.closest('.surface');
    if (!surface) return;
    dockHost = surface;
    lift();
    // where the section was scrolled to when this was measured, for a test to wait on
    parts.root.dataset.dockedAt = String(Math.round(parts.root.scrollTop));
    const edge = surface.getBoundingClientRect();
    const foot = edge.top + surface.clientTop + surface.clientHeight;
    let top = foot;
    for (const each of [zoomBox, footShown()]) {
      if (!each) continue;
      const box = each.getBoundingClientRect();
      if (box.height > 0 && box.bottom > edge.top && box.top < foot) top = Math.min(top, box.top);
    }
    me.surface = surface;
    me.clear = Math.max(0, Math.round(foot - top)) + 'px';
    // the surface's value is the last map's mounted (mounted, above)
    if (mounted[mounted.length - 1] === me) setClear(me);
  }
  // ---- the zoom buttons (and a card of the section's) stand above the foot
  // (SV2-55). Where the section scrolls (a short window, the controls shown)
  // the foot, sticky at the section's foot, lies over the stage's foot until
  // the section is at its end. How far it reaches up into the stage is
  // --mov-under on the stage, and they lift by that much, but never out of
  // the stage's top.
  function lift() {
    if (element.hidden) return;
    const shown = stage.getBoundingClientRect();
    const foot = footShown();
    const footTop = foot ? foot.getBoundingClientRect().top : shown.bottom;
    const margin = parseFloat(getComputedStyle(zoomBox).left) || 0;
    const most = Math.max(0, shown.height - zoomBox.offsetHeight - margin * 2);
    const under = Math.round(Math.min(most, Math.max(0, shown.bottom - footTop))) + 'px';
    if (stage.style.getPropertyValue('--mov-under') !== under) stage.style.setProperty('--mov-under', under);
  }

  // what the zoom box needs of the stage: its height and its margin above
  // and below (SV2-57), as drawn: 70 px under a finger, 62 under a mouse
  function zoomRoom() {
    const margin = parseFloat(getComputedStyle(zoomBox).left) || 0;
    return zoomBox.offsetHeight + margin * 2;
  }
  // ---- the stage's room (stageRoom). Two things lie over the section for a
  // while and take nothing from the map: the inspector's sheet (under 900 px;
  // the section scrolls under it with the map's top showing above it) and
  // what of the foot may grow (playback's More grows up over the map's foot).
  // The section is measured as with both shut.
  function room() {
    const root = parts && parts.root;
    if (gone || !root || element.hidden || root.clientHeight === 0) return;
    let height = root.clientHeight;
    const sheet = document.getElementById('inspector');
    if (sheet && !sheet.hidden && sheet.dataset.mode === 'sheet' && sheet.dataset.open === 'true') {
      const handle = sheet.querySelector('.inspector__bar');
      height += sheet.getBoundingClientRect().height - (handle ? handle.getBoundingClientRect().height : 0);
    }
    // boxes as drawn, not rounded: whole pixels taken apart again can be one out
    const tall = (el) => (el ? el.getBoundingClientRect().height : 0);
    let line = 0;
    if (parts.line) {
      const shape = parts.head ? getComputedStyle(parts.head) : null;
      line = tall(parts.line) + (shape ? (parseFloat(shape.paddingTop) || 0) + (parseFloat(shape.paddingBottom) || 0) + (parseFloat(shape.borderBottomWidth) || 0) : 0);
    }
    const foot = footShown();
    const gap = foot ? parseFloat(getComputedStyle(foot).rowGap) || 0 : 0;
    const more = foot && parts.more && !parts.more.hidden ? tall(parts.more) + gap : 0;
    const docked = parts.under && !parts.under.hidden ? tall(parts.under) : 0;
    const bar = tall(foot);
    const next = stageRoom({ world, width: stage.clientWidth, zoomRoom: zoomRoom(), height, line, foot: bar - more + docked, docked, gap, bar });
    const set = (key, value) => {
      if (root.style.getPropertyValue(key) !== value) root.style.setProperty(key, value);
    };
    set('--mov-room', next.room + 'px');
    set('--mov-more', next.more + 'px');
    set('--mov-bar', next.bar + 'px');
    // the foot's height this was measured with, for a test to wait on
    root.dataset.measuredBar = String(foot ? foot.offsetHeight : 0);
  }
  // and where a message may lie, which moves with the foot's height whether
  // or not the stage changes size
  const roomWatcher = new ResizeObserver(() => {
    room();
    dock();
  });

  // A wheel over the map scrolls the section while the section has some way
  // to go that way and the map is not all on screen (the controls are shown
  // in a short window); after that it moves the map, as it does everywhere
  // else. Ctrl or Cmd with the wheel always zooms the map.
  function sectionTakes(event) {
    const root = parts && parts.root;
    if (!root || event.ctrlKey || event.metaKey || event.deltaY === 0) return false;
    const most = root.scrollHeight - root.clientHeight;
    if (most <= 0) return false;
    const edge = root.getBoundingClientRect();
    const shown = stage.getBoundingClientRect();
    // the foot lies over the map's foot until the section is at its end; the
    // map's foot is the docked line under it when it is there, so the wheel
    // brings that line above the foot too (SV2-55)
    const shownFoot = footShown();
    const foot = shownFoot ? Math.min(edge.bottom, shownFoot.getBoundingClientRect().top) : edge.bottom;
    const mapFoot = !parts.under || parts.under.hidden ? shown.bottom : Math.max(shown.bottom, parts.under.getBoundingClientRect().bottom);
    if (event.deltaY > 0) return root.scrollTop < most - 1 && mapFoot > foot + 1;
    return root.scrollTop > 0 && shown.top < edge.top - 1;
  }
  function onStageWheel(event) {
    // the map's own handler (ui/surface/input.js) is not reached, and the browser scrolls the section
    if (sectionTakes(event)) event.stopPropagation();
  }
  stage.addEventListener('wheel', onStageWheel, { capture: true, passive: true });

  // the surface scrolls down to Getting started, and the section inside
  // itself on a small window: the dock moves with both
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

  // ---- the section around the map (the frame option), asked for once
  function framed() {
    if (parts || gone) return;
    const around = (typeof frameOption === 'function' ? frameOption() : frameOption) || {};
    parts = { root, head: around.head || null, line: around.line || null, foot: around.foot || null, more: around.more || null, under: around.under || null };
    if (around.before) element.prepend(...around.before);
    if (around.after) element.append(...around.after);
    if (around.inside) for (const each of around.inside) stage.insertBefore(each, zoomBox);
    root.addEventListener('scroll', dock, { passive: true });
    for (const each of [root, parts.line, parts.foot, parts.under]) if (each) roomWatcher.observe(each);
  }
  // the code that made the map has the rest of its section made by then
  queueMicrotask(framed);

  function remeasure() {
    framed();
    room();
    measure();
    dock();
  }
  loadSheet().then(() => {
    if (gone) return;
    root.dataset.styled = 'true';
    remeasure();
  });

  return {
    root,
    element,
    stage,
    view,
    canvas,
    layer,
    cursor,
    overlays,
    across,
    marks,
    get world() { return world; },
    get fitted() { return fitted; },
    get graph() { return graph; },
    get project() { return project; },
    setProject,
    paint: () => queuePaint(),
    paintMarks: () => paintMarks(),
    show,
    fit: (quiet) => fit(quiet === true),
    focus() {
      // with nothing to draw there is no map: the shell takes the region
      if (element.hidden) return false;
      canvas.focus();
      return true;
    },
    cellAt: pixel,
    onCell(fn) {
      cellFns.push(fn);
    },
    onLayout(fn) {
      layoutFns.push(fn);
    },
    theme: () => renderer.theme(),
    hover(floorId, cell) {
      hovered = floorId === null || floorId === undefined ? null : { floorId, cell };
    },
    showFloors,
    remeasure,
    dock,
    unmount() {
      if (gone) return;
      gone = true;
      if (parts) root.removeEventListener('scroll', dock);
      document.removeEventListener('scroll', onSurfaceScroll, { capture: true });
      // the surface's --toast-clear: this map's goes, and the map mounted
      // before it, if one still is, has its own back
      const at = mounted.indexOf(me);
      const last = at === mounted.length - 1;
      if (at !== -1) mounted.splice(at, 1);
      if (last && me.surface) {
        const under = mounted[mounted.length - 1];
        if (under && under.surface === me.surface) setClear(under);
        else me.surface.style.removeProperty('--toast-clear');
      }
      if (layout) {
        const still = mounted.filter((each) => each.layout === layout);
        if (still.length === 0) delete layout.dataset.planMap;
        else layout.dataset.planMap = still[still.length - 1].name;
      }
      watcher.disconnect();
      roomWatcher.disconnect();
      stage.removeEventListener('wheel', onStageWheel, { capture: true });
      dark.removeEventListener('change', queuePaint);
      if (ratioQuery) ratioQuery.removeEventListener('change', onRatio);
      input.detach();
      cursor.detach();
      canvas.removeEventListener('keydown', onKey);
    },
  };
}
