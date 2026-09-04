// main.js — the only place that touches `document`. Keeps a single mutable
// `state` reference (game state) and a tiny `ui` reference (transient view
// state like which tab is active) and re-renders in full after every action.
// Full re-render is deliberately simple for stage 1's scale; see WISHLIST.md
// before optimizing this into a diffing renderer.

import * as State from './state.js';
import * as UI from './ui.js';
import { validateSchedule, summarizeWeekend } from './engine.js';
import { CONFIG } from './data.js';
import { mountSaveBar } from '../../../assets/js/gvb-save.js';

let state = State.loadState() || State.createInitialState();
const ui = { activeTab: 'office', flash: null, pendingBuild: null, pendingMove: null };

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
  else if (ui.activeTab === 'backstage') panel = UI.renderBackstage(state, panelFlash);
  else panel = UI.renderFairFloor(state, conflicts, panelFlash);

  $('#content').innerHTML = `
    ${panel}
    <div class="run-bar">
      <button class="btn primary" data-action="openGates">Open the Gates \u2192</button>
    </div>
  `;
  ui.flash = null;
}

function handleAction(action, el) {
  const id = el.dataset.id;
  let res;
  switch (action) {
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
    case 'openGates':
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
mountSave();
render();
