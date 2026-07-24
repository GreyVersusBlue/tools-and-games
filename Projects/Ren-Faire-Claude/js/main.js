// main.js — the only place that touches `document`. Keeps a single mutable
// `state` reference (game state) and a tiny `ui` reference (transient view
// state like which tab is active) and re-renders in full after every action.
// Full re-render is deliberately simple for stage 1's scale; see HANDOFF.md
// before optimizing this into a diffing renderer.

import * as State from './state.js';
import * as UI from './ui.js';
import { validateSchedule, summarizeWeekend } from './engine.js';
import { CONFIG } from './data.js';

let state = State.loadState() || State.createInitialState();
const ui = { activeTab: 'office', flash: null, pendingBuild: null, pendingMove: null };

const $ = (sel) => document.querySelector(sel);

function render() {
  $('#ledger').innerHTML = UI.renderLedger(state);

  if (state.phase === 'report' && state.lastResult) {
    $('#tabs').innerHTML = '';
    $('#content').innerHTML = UI.renderReport(state, state.lastResult);
    return;
  }

  if (state.phase === 'victory') {
    $('#tabs').innerHTML = '';
    $('#content').innerHTML = UI.renderVictory(state);
    return;
  }

  if (state.phase === 'gameOver') {
    $('#tabs').innerHTML = '';
    $('#content').innerHTML = UI.renderGameOver(state);
    return;
  }

  if (state.phase === 'weekendEnd') {
    $('#tabs').innerHTML = '';
    const summary = summarizeWeekend(state.history, CONFIG.seasonLength);
    $('#content').innerHTML = UI.renderWeekendEnd(state, summary);
    return;
  }

  $('#tabs').innerHTML = UI.renderTabs(ui.activeTab, state.phase);
  const conflicts = validateSchedule(state.schedule);
  let panel = '';
  if (ui.activeTab === 'office') panel = UI.renderOffice(state, ui.flash);
  else if (ui.activeTab === 'backstage') panel = UI.renderBackstage(state, ui.flash);
  else panel = UI.renderFairFloor(state, conflicts, ui.pendingBuild, ui.pendingMove);

  $('#content').innerHTML = `
    ${panel}
    <div class="run-bar">
      <button class="btn primary" data-action="openGates">Open the Gates \u2192</button>
    </div>
  `;
  ui.flash = null;
  State.saveState(state);
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
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    ui.activeTab = btn.dataset.tab;
    ui.pendingBuild = null;
    ui.pendingMove = null;
    render();
  });

  $('#content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleAction(btn.dataset.action, btn);
  });

  $('#content').addEventListener('change', (e) => {
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

wire();
render();
