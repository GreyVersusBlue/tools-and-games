// main.js — the only place that touches `document`. Keeps a single mutable
// `state` reference (game state) and a tiny `ui` reference (transient view
// state like which tab is active) and re-renders in full after every action.
// Full re-render is deliberately simple for stage 1's scale; see WISHLIST.md
// before optimizing this into a diffing renderer.

import * as State from './state.js';
import * as UI from './ui.js';
import { validateSchedule, summarizeWeekend, currentGridSize, terrainAt } from './engine.js';
import { CONFIG } from './data.js';
import * as MapView from './mapview.js';
import { paintPlat } from './plat.js';
import { mountSaveBar } from '../../../assets/js/gvb-save.js';

// Phase 2: newGame(), not createInitialState() — the latter is deterministic
// on purpose (see state.js) and would give every first-time player the same
// season. This is the one call that draws a real one.
let state = State.loadState() || State.newGame();
// Phase 3: `negotiating` is { kind, id, commitDays, cancelFeeMult } while an
// offer row is open on Backstage, and null otherwise. View state, not save.
// Phase 6: `view` is the plat's pan and zoom (mapview.js), session state
// like the rest of this object and never saved; layoutMap() below keeps it
// across renders while the tier and the stage width hold, and refits it
// when either moves.
const ui = { activeTab: 'office', flash: null, pendingBuild: null, pendingMove: null, negotiating: null, view: null };

const $ = (sel) => document.querySelector(sel);

function render() {
  // Stage 21: this used to sit at the very bottom of the function, below the
  // early return the report/victory/gameOver/weekendEnd phases take — so the
  // game never wrote a save while a report was on screen, and reloading on a
  // day's takings rewound to before the gates opened. That was not a forgiving
  // replay, it was a free reroll: runDay() seeds off Date.now(), so the same
  // day replayed came back with different numbers. Measured on a developed
  // grounds across 400 seeds, one day's net ran -$301 to +$1,265 and its
  // reputation gain 0 to +5, so F5 was worth 3x the median day's profit and
  // could reach the win condition's reputation floor in a quarter of the days.
  // Saving first means the save always matches the screen, in every phase.
  State.saveState(state);

  $('#ledger').innerHTML = UI.renderLedger(state);

  // Stage 19: phases that show a full-bleed ticket stub (report, weekend
  // summary, victory, game over) hide the site plan and take the whole
  // board; the planning phase shows the plan permanently beside the desk.
  const board = $('#board');
  const terminalPhases = { report: 1, victory: 1, gameOver: 1, weekendEnd: 1 };
  const isTerminal = !!terminalPhases[state.phase] && (state.phase !== 'report' || !!state.lastResult);
  board.classList.toggle('is-fullwidth', isTerminal);
  // Phase 5: the plat column is sized off the tier the player has
  // reached, not the widest one (#246). style.css reads --cols here in a
  // calc(); ui.js already sets the same number on .grounds-map, but a
  // custom property only flows down, and #board is the ancestor.
  board.style.setProperty('--cols', String(currentGridSize(state).cols));

  if (isTerminal) {
    $('#grounds').innerHTML = '';
    $('#tabs').innerHTML = '';
    if (state.phase === 'report') $('#content').innerHTML = UI.renderReport(state, state.lastResult);
    else if (state.phase === 'victory') $('#content').innerHTML = UI.renderVictory(state);
    else if (state.phase === 'gameOver') $('#content').innerHTML = UI.renderGameOver(state);
    else $('#content').innerHTML = UI.renderWeekendEnd(state, summarizeWeekend(state.history, CONFIG.seasonLength));
    return;
  }

  // A refusal from clicking a map cell needs to appear next to the map, not
  // in whichever tab happens to be open. When a build/move is in progress
  // the grounds panel owns the flash; otherwise the tab panel does. Never
  // both, so a message can't render twice.
  const placing = !!(ui.pendingBuild || ui.pendingMove);
  const groundsFlash = placing ? ui.flash : null;
  const panelFlash = placing ? null : ui.flash;

  $('#grounds').innerHTML = UI.renderGroundsPanel(state, ui.pendingBuild, ui.pendingMove, groundsFlash);
  $('#tabs').innerHTML = UI.renderTabs(ui.activeTab, state.phase);

  const conflicts = validateSchedule(state.schedule);
  let panel = '';
  if (ui.activeTab === 'office') panel = UI.renderOffice(state, panelFlash);
  else if (ui.activeTab === 'backstage') panel = UI.renderBackstage(state, panelFlash, ui.negotiating);
  else panel = UI.renderFairFloor(state, conflicts, panelFlash);

  $('#content').innerHTML = `
    ${panel}
    <div class="run-bar">
      <button class="btn primary" data-action="openGates">Open the Gates \u2192</button>
    </div>
  `;
  ui.flash = null;
  layoutMap(false);
}

// ---------------------------------------------------------------------
// Phase 6: the map is a canvas under a DOM marker layer, both under one
// view. The canvas paints the ground; the grid keeps the markers, because
// they are the focus targets, the refusal titles and the 25 data-action
// wirings Section 22 guards, and nothing about a canvas makes those better.
// ---------------------------------------------------------------------

// --cell is CSS's number (46, or 48 on a phone or a coarse pointer), and the
// canvas has to draw at exactly the size the grid lays out at, so it is read
// off the document rather than assumed. A boot with no layout engine (jsdom)
// answers '' and gets the desktop cell.
function readCell() {
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--cell');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 46;
}

function isCoarsePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// After every render: size the stage, keep or refit the view, apply it.
function layoutMap(refit) {
  const stage = $('.plat-stage');
  if (!stage) { ui.view = null; return; }
  const size = currentGridSize(state);
  const cell = readCell();
  const stageW = Math.round(stage.getBoundingClientRect().width);
  const minScale = MapView.minScaleFor({ cell, coarse: isCoarsePointer() });
  let view = ui.view;
  const same = view && view.cols === size.cols && view.rows === size.rows && view.cell === cell
    && view.viewport.w === stageW && view.minScale === minScale;
  if (!same || refit) {
    view = MapView.createView({ cols: size.cols, rows: size.rows, cell, viewport: { w: stageW, h: 0 }, minScale });
    view = MapView.fit(MapView.withViewport(view, { w: stageW, h: MapView.stageHeight(view) }));
  }
  stage.style.height = `${view.viewport.h}px`;
  applyView(view);
}

// The one place the view reaches the page: the marker layer's transform and
// the canvas repaint. Cheap enough to run on every pointer move.
function applyView(view) {
  ui.view = view;
  const stage = $('.plat-stage');
  if (!stage) return;
  const map = stage.querySelector('.grounds-map');
  const t = MapView.trackTransform(view);
  // The grid sits in flow at (FRAME.left, FRAME.top) inside the stage's
  // padding, so the translate is measured from there.
  const dx = t.x - MapView.FRAME.left, dy = t.y - MapView.FRAME.top;
  if (map) map.style.transform = `translate(${dx}px, ${dy}px) scale(${t.scale})`;

  const canvas = stage.querySelector('.plat-canvas');
  // jsdom has no 2D context and says so on stderr for every getContext();
  // a window without CanvasRenderingContext2D cannot paint, so don't ask.
  if (!canvas || typeof window.CanvasRenderingContext2D !== 'function') return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(view.viewport.w * dpr)), h = Math.max(1, Math.round(view.viewport.h * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = currentGridSize(state);
  paintPlat(ctx, view, { terrainAt, dpr, cell: view.cell, label: size.label, sub: `${size.cols} \u00d7 ${size.rows} \u00b7 Weekend ${state.season}` });
}

// Drag to pan, pinch to zoom, Ctrl+wheel to zoom at the cursor, arrow keys
// and +/-/0 on the focused stage. A drag that moves more than DRAG_SLOP
// screen px swallows the click that follows it, so a pan that ends over a
// ghost "+" does not place a stall there; a tap or a still click goes to
// the button underneath as it always has. No pointer capture: with it,
// Chromium retargets the click to the capturing element and every ghost
// button on the map goes dead.
const DRAG_SLOP = 6;
const gesture = { pointers: new Map(), moved: 0, stage: null, suppressClick: false };

function stagePoint(e) {
  const r = gesture.stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onMapPointerDown(e) {
  const stage = e.target.closest('.plat-stage');
  if (!stage || !ui.view) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  gesture.stage = stage;
  if (gesture.pointers.size === 0) {
    gesture.moved = 0;
    window.addEventListener('pointermove', onMapPointerMove);
    window.addEventListener('pointerup', onMapPointerUp);
    window.addEventListener('pointercancel', onMapPointerUp);
  }
  gesture.pointers.set(e.pointerId, stagePoint(e));
}

function onMapPointerMove(e) {
  const prev = gesture.pointers.get(e.pointerId);
  if (!prev || !ui.view) return;
  const next = stagePoint(e);
  if (gesture.pointers.size >= 2) {
    const [idA, idB] = [...gesture.pointers.keys()];
    const a0 = gesture.pointers.get(idA), b0 = gesture.pointers.get(idB);
    const a1 = e.pointerId === idA ? next : a0, b1 = e.pointerId === idB ? next : b0;
    gesture.moved = DRAG_SLOP + 1;
    applyView(MapView.pinch(ui.view, [a0, b0], [a1, b1]));
  } else {
    const dx = next.x - prev.x, dy = next.y - prev.y;
    gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.moved > DRAG_SLOP) applyView(MapView.panBy(ui.view, dx, dy));
  }
  gesture.pointers.set(e.pointerId, next);
  if (gesture.moved > DRAG_SLOP && e.cancelable) e.preventDefault();
}

function onMapPointerUp(e) {
  gesture.pointers.delete(e.pointerId);
  if (gesture.moved > DRAG_SLOP) {
    gesture.suppressClick = true;
    setTimeout(() => { gesture.suppressClick = false; }, 0);
  }
  if (gesture.pointers.size === 0) {
    window.removeEventListener('pointermove', onMapPointerMove);
    window.removeEventListener('pointerup', onMapPointerUp);
    window.removeEventListener('pointercancel', onMapPointerUp);
  }
}

function onMapWheel(e) {
  const stage = e.target.closest('.plat-stage');
  if (!stage || !ui.view || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  gesture.stage = stage;
  const p = stagePoint(e);
  applyView(MapView.zoomAt(ui.view, p.x, p.y, Math.exp(-e.deltaY * 0.01)));
}

function onMapKey(e) {
  if (!ui.view || !e.target.classList || !e.target.classList.contains('plat-stage')) return;
  const next = MapView.keyboardStep(ui.view, e.key);
  if (!next) return;
  e.preventDefault();
  applyView(next);
}

function wireMap() {
  const grounds = $('#grounds');
  grounds.addEventListener('pointerdown', onMapPointerDown);
  grounds.addEventListener('wheel', onMapWheel, { passive: false });
  grounds.addEventListener('keydown', onMapKey);
  grounds.addEventListener('click', (e) => {
    if (!gesture.suppressClick || !e.target.closest('.plat-stage')) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  window.addEventListener('resize', () => layoutMap(false));
}

function handleAction(action, el) {
  const id = el.dataset.id;
  let res;
  switch (action) {
    // Phase 6: the three zoom buttons touch the view and nothing else, so
    // they apply it without a render (a render would drop nothing, but
    // it would repaint a map that only needed its transform changed).
    case 'mapZoomIn':
      if (ui.view) applyView(MapView.zoomCentred(ui.view, MapView.KEY_ZOOM));
      return;
    case 'mapZoomOut':
      if (ui.view) applyView(MapView.zoomCentred(ui.view, 1 / MapView.KEY_ZOOM));
      return;
    case 'mapFit':
      if (ui.view) applyView(MapView.fit(ui.view));
      return;
    case 'selectBuild':
      ui.pendingBuild = el.dataset.kind;
      render();
      return;
    case 'cancelBuild':
      ui.pendingBuild = null;
      render();
      return;
    case 'placeAt': {
      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      // Stage 10: fresh placement is free and non-final — see placePlot.
      res = State.placePlot(state, el.dataset.kind, x, y);
      if (res.error) { ui.flash = res.error; } else { state = res.state; ui.pendingBuild = null; }
      break;
    }
    case 'commitPlot':
      res = State.commitPlot(state, id);
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'commitAll':
      res = State.commitAllPlots(state);
      if (res.error) { ui.flash = res.error; } else { state = res.state; ui.flash = `Committed ${res.count} plot${res.count === 1 ? '' : 's'} for $${res.total}.`; }
      break;
    case 'deletePlanningPlot':
      res = State.deletePlanningPlot(state, id);
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'selectMove':
      ui.pendingMove = { plotId: id, kind: el.dataset.kind };
      ui.pendingBuild = null;
      render();
      return;
    case 'cancelMove':
      ui.pendingMove = null;
      render();
      return;
    case 'moveTo': {
      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      const plot = state.builtPlots.find(p => p.id === el.dataset.plot);
      res = plot && plot.status === 'planning'
        ? State.movePlanningPlot(state, el.dataset.plot, x, y)
        : State.relocatePlot(state, el.dataset.plot, x, y);
      if (res.error) {
        ui.flash = res.error;
      } else {
        state = res.state;
        ui.pendingMove = null;
        if (res.fee) ui.flash = `Relocated \u2014 $${res.fee} spent on demolition and a discounted rebuild.`;
      }
      break;
    }
    case 'demolishPlot':
      res = State.demolishPlot(state, id);
      state = res.state;
      if (res.fee > 0) ui.flash = `Demolished \u2014 $${res.fee} teardown fee.`;
      break;
    case 'renamePlot': {
      const plot = state.builtPlots.find(p => p.id === id);
      if (!plot) return;
      const proposed = window.prompt('New name for this plot:', plot.name);
      if (proposed === null) return;
      res = State.renamePlot(state, id, proposed);
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    }
    case 'unassignVendor':
      res = State.unassignVendorFromPlot(state, id);
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'autoFillStalls':
      res = State.autoFillStalls(state);
      state = res.state;
      ui.flash = res.filled > 0 ? `Seated ${res.filled} vendor${res.filled === 1 ? '' : 's'}.` : 'No open stalls and unseated vendors to match up right now.';
      break;
    case 'contract':
      res = State.contractPerformer(state, id, el.dataset.contract || 'open');
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'release':
      res = State.releasePerformer(state, id);
      state = res.state;
      if (res.fee > 0) ui.flash = `Broke the Weekend Package early \u2014 $${res.fee} cancellation fee.`;
      break;
    case 'hireVendor':
      res = State.hireVendor(state, id, el.dataset.contract || 'open');
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'launchCampaign':
      res = State.launchCampaign(state, id);
      if (res.error) ui.flash = res.error; else state = res.state;
      break;
    case 'fireVendor':
      res = State.fireVendor(state, id);
      state = res.state;
      if (res.fee > 0) ui.flash = `Let a contracted vendor go early \u2014 $${res.fee} cancellation fee.`;
      break;
    case 'negotiate':
      ui.negotiating = { kind: el.dataset.kind, id, commitDays: 0, cancelFeeMult: 0 };
      break;
    case 'cancelOffer':
      ui.negotiating = null;
      break;
    case 'signOffer': {
      if (!ui.negotiating || ui.negotiating.id !== id) return;
      const terms = { commitDays: ui.negotiating.commitDays, cancelFeeMult: ui.negotiating.cancelFeeMult };
      res = ui.negotiating.kind === 'vendor' ? State.hireVendor(state, id, terms) : State.contractPerformer(state, id, terms);
      if (res.error) ui.flash = res.error; else { state = res.state; ui.negotiating = null; }
      break;
    }
    case 'resolveBeat':
      res = State.resolveBeat(state, id, el.dataset.choice);
      if (res.error) ui.flash = res.error;
      else { state = res.state; ui.flash = res.choice.note ? `${res.choice.note}` : null; }
      break;
    case 'openGates':
      ui.negotiating = null;
      res = State.runDay(state);
      state = res.state;
      break;
    case 'nextDay':
      res = State.nextDay(state);
      state = res.state;
      ui.activeTab = 'office';
      ui.pendingBuild = null;
      ui.pendingMove = null;
      break;
    case 'startNextWeekend':
      res = State.startNextWeekend(state);
      state = res.state;
      ui.activeTab = 'office';
      ui.pendingBuild = null;
      ui.pendingMove = null;
      break;
    case 'acknowledgeVictory':
      res = State.acknowledgeVictory(state);
      state = res.state;
      break;
    case 'closeSeason': {
      // Phase 4: the run boundary. The new run replaces the state outright,
      // so every piece of view state pointing at the old grounds goes too.
      res = State.closeSeason(state);
      if (res.error) { ui.flash = res.error; break; }
      state = res.state;
      ui.activeTab = 'office';
      ui.pendingBuild = null;
      ui.pendingMove = null;
      ui.negotiating = null;
      ui.flash = `Season ${res.record.run} closed and banked. Season ${state.carryover.run} opens with $${state.cash.toLocaleString()}, ${state.reputation} reputation and ${state.renown} renown.`;
      break;
    }
    case 'newFaire':
      state = State.resetSave();
      ui.activeTab = 'office';
      ui.pendingBuild = null;
      ui.pendingMove = null;
      break;
    default:
      return;
  }
  render();
}

function wire() {
  $('#app').addEventListener('input', (e) => {
    if (e.target.id !== 'ticketPrice') return;
    const readout = document.getElementById('priceReadout');
    if (readout) readout.textContent = `$${e.target.value}`;
  });

  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    ui.activeTab = btn.dataset.tab;
    ui.pendingBuild = null;
    ui.pendingMove = null;
    render();
  });

  // Stage 19: the grounds map moved out of #content into its own persistent
  // #grounds section, so delegation binds to the shared #app ancestor
  // instead. Every data-action/data-tab hook keeps working unchanged.
  $('#app').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleAction(btn.dataset.action, btn);
  });

  $('#app').addEventListener('change', (e) => {
    const target = e.target;
    if (target.id === 'ticketPrice') {
      const res = State.setTicketPrice(state, Number(target.value));
      state = res.state;
      render();
      return;
    }
    if (target.dataset.action === 'schedule') {
      const { block, stage } = target.dataset;
      const performerId = target.value;
      const res = performerId
        ? State.assignSchedule(state, block, stage, performerId)
        : State.unassignSchedule(state, block, stage);
      if (res.error) ui.flash = res.error; else state = res.state;
      render();
      return;
    }
    if (target.dataset.action === 'offerTerm') {
      if (!ui.negotiating) return;
      ui.negotiating[target.dataset.term] = Number(target.value);
      render();
      return;
    }
    if (target.dataset.action === 'assignVendor') {
      const vendorId = target.value;
      if (!vendorId) return;
      const res = State.assignVendorToPlot(state, target.dataset.plot, vendorId);
      if (res.error) ui.flash = res.error; else state = res.state;
      render();
    }
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all progress? This cannot be undone.')) return;
    state = State.resetSave();
    ui.activeTab = 'office';
    ui.pendingBuild = null;
    ui.pendingMove = null;
    render();
  });
}

// Stage 22: mounted in #footer rather than a title screen — this game has
// no start screen, and #footer is visible in every phase, including
// mid-report, closing v7 §9's other open item (The Fourth Quarter's bar was
// stranded on its start overlay). #resetBtn stays untouched: mounting gvb's
// "Start over" beside "Reset progress" would be two erasers side by side,
// so only export/import are mounted here (locked decision #48's `buttons`
// option is exactly for this).
function mountSave() {
  const slot = State.saveSlot();
  mountSaveBar(document.getElementById('save-bar'), slot, {
    buttons: ['export', 'import'],
    getState: () => state,
    setState: (next) => {
      // An import replaces the grounds outright — a pending placement or
      // move against the plots that just vanished is meaningless, and a
      // stale tab selection (Backstage on a save with no vendors yet, say)
      // is a worse first impression than just landing on the Office desk.
      state = next;
      ui.pendingBuild = null;
      ui.pendingMove = null;
      ui.activeTab = 'office';
      render();
    },
  });
}

wire();
wireMap();
mountSave();
render();
