/* app-shell.js — part of the School Layout Visualizer.
   Was lines 15963-17609 of Tools/schedule-visualizer.html. Cut out verbatim; the
   text below is byte-identical to what was inline, because the publish path
   puts br* function source into published files via Function.prototype.toString()
   and because the acorn equivalence check in schedule/test/structure.mjs
   compares this source against the original.

   Classic <script>, not a module. Top-level const/let bind in the shared
   global lexical scope, so declarations here are visible to every later file.
   LOAD ORDER IS SOURCE ORDER and must stay that way: the tool runs 11
   top-level statements, including DOM listener wiring that binds at parse time.
   See the <script src> list at the bottom of schedule-visualizer.html. */

/* ==============================================
   ROUND 11 — ONBOARDING & HELP MODALS
=============================================== */
const ONBOARDING_KEY = 'stviz_onboarded';
let _lastFocusedBeforeModal = null;

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  _lastFocusedBeforeModal = document.activeElement;
  overlay.classList.add('open');
  // Move focus into the dialog for keyboard + screen-reader users.
  const focusTarget = overlay.querySelector('.modal-btn.primary, button, [tabindex]');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 60);
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
    _lastFocusedBeforeModal.focus();
  }
}

function initOnboardingAndHelp() {
  // Onboarding — shown on first load unless the user dismissed it.
  let onboarded = false;
  try { onboarded = localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { onboarded = false; }
  if (!onboarded) {
    setTimeout(() => openModal('onboarding-modal'), 350);
  }

  const persistDismiss = () => {
    // The welcome dialog only auto-shows on first load, so any dismissal
    // records it. The checkbox is an explicit reassurance for the user.
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
  };

  document.getElementById('onboarding-start')?.addEventListener('click', () => {
    persistDismiss(); closeModal('onboarding-modal');
  });
  document.getElementById('onboarding-x')?.addEventListener('click', () => {
    persistDismiss(); closeModal('onboarding-modal');
  });

  // Help — opened from the header button, available any time.
  document.getElementById('btn-open-help')?.addEventListener('click', () => openModal('help-modal'));
  document.getElementById('help-x')?.addEventListener('click', () => closeModal('help-modal'));
  document.getElementById('help-done')?.addEventListener('click', () => closeModal('help-modal'));

  // Dismiss on overlay backdrop click + Escape key.
  ['onboarding-modal', 'help-modal'].forEach(id => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        if (id === 'onboarding-modal') persistDismiss();
        closeModal(id);
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['onboarding-modal', 'help-modal'].forEach(id => {
      const overlay = document.getElementById(id);
      if (overlay && overlay.classList.contains('open')) {
        if (id === 'onboarding-modal') persistDismiss();
        closeModal(id);
      }
    });
  });
}

/* ==============================================
   ROUND 11 — FULL PROJECT EXPORT / IMPORT
   One JSON bundle: blueprint + groups + settings.
=============================================== */
const PROJECT_FILE_TYPE = 'stviz-project';

function serializeFullProject() {
  return {
    fileType: PROJECT_FILE_TYPE,
    version:  1,
    schemaVersion: 31,
    savedAt:  new Date().toISOString(),
    settings: { ...AppState.settings },
    blueprint: serializeBlueprint(),
    groups: AppState.schedules.groups.map(g => ({
      name: g.name, grade: g.grade, color: g.color,
      size: (Number.isFinite(Number(g.size)) && Number(g.size) > 0) ? Math.round(Number(g.size)) : null,  // R59
      modsA: g.modsA || g.mods || [],
      modsB: g.modsB || [],
      mods: g.modsA || g.mods || [],
    })),
    // R58: What-If scenario payload. Overrides are keyed by group ARRAY INDEX
    // (not group id) because applyFullProject regenerates every group id on
    // import — index order matches the groups[] array exported above.
    whatif: serializeWhatIfForProject(),
  };
}

function exportFullProject() {
  try {
    const payload  = serializeFullProject();
    const school   = AppState.settings.schoolName
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    const date     = new Date().toISOString().slice(0, 10);
    const filename = `${school}-full-project-${date}.json`;
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const groupCount = AppState.schedules.groups.length;
    showToast(`Full project exported (${roomRegistry.length} room${roomRegistry.length !== 1 ? 's' : ''}, ${groupCount} group${groupCount !== 1 ? 's' : ''}).`, 'success');
  } catch (err) {
    showToast('Export failed: could not build the project file.', 'error');
  }
}

function applyFullProject(data) {
  if (!data || typeof data !== 'object')
    throw new Error('file is not a valid project.');
  if (data.fileType && data.fileType !== PROJECT_FILE_TYPE)
    throw new Error('this JSON is not a full-project file.');
  if (!data.blueprint || typeof data.blueprint !== 'object')
    throw new Error('project file is missing its blueprint.');

  // Validate the blueprint payload first so we fail before mutating state.
  validateBlueprintData(data.blueprint);

  // Settings (merge over defaults; keep schema clean).
  if (data.settings && typeof data.settings === 'object') {
    AppState.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  }
  normalizeSettings(AppState.settings);  // R59: pre-R59 files → clean bell/subjects/size defaults

  // Blueprint.
  applyBlueprintData(data.blueprint);

  // Groups (validate, then replace wholesale).
  const rawGroups = Array.isArray(data.groups) ? data.groups : [];
  const cleanGroups = [];
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    cleanGroups.push({
      id:    generateGroupId(),
      name:  raw.name.trim(),
      grade: (raw.grade !== undefined && raw.grade !== null && raw.grade !== '') ? (Number(raw.grade) || null) : null,
      color: raw.color || getNextGroupColor(),
      size:  (Number.isFinite(Number(raw.size)) && Number(raw.size) > 0) ? Math.round(Number(raw.size)) : null,  // R59
      modsA: Array.isArray(raw.modsA) ? raw.modsA.slice(0, 20) : (Array.isArray(raw.mods) ? raw.mods.slice(0, 20) : []),
      modsB: Array.isArray(raw.modsB) ? raw.modsB.slice(0, 20) : [],
      mods:  Array.isArray(raw.modsA) ? raw.modsA.slice(0, 20) : (Array.isArray(raw.mods) ? raw.mods.slice(0, 20) : []),
    });
  }
  AppState.schedules.groups = cleanGroups;
  AppState.schedules.editingGroupId = null;

  // R58: Restore What-If scenario overrides. Pre-R58 project files have no
  // `whatif` key — applyWhatIfFromProject treats that as "clear the sandbox"
  // so imports of older files succeed cleanly with an empty scenario.
  applyWhatIfFromProject(data.whatif, cleanGroups);

  // Persist + refresh UI everywhere.
  saveSettings();
  saveLastSavedTime();
  saveSchedules();
  saveBlueprintToLocalStorage();
  populateSettingsForm();
  populateDeptDropdown();   // R59: imported subjects → refresh dept options
  syncHeader();
  renderGroupList();
  if (AppState.ui.activeTab === 'visualize') onVizTabActivated();

  return { rooms: roomRegistry.length, groups: cleanGroups.length };
}

function initFullProjectIO() {
  document.getElementById('btn-export-all')?.addEventListener('click', exportFullProject);

  const fileInput = document.getElementById('all-import-file');
  document.getElementById('btn-import-all')?.addEventListener('click', () => {
    const hasBlueprint = !!localStorage.getItem(BLUEPRINT_KEY);
    const hasGroups = AppState.schedules.groups.length > 0;
    if (hasBlueprint || hasGroups) {
      if (!confirm('Importing a full project will REPLACE your current blueprint, all student groups, and settings.\n\nYour exported JSON files are not affected.\n\nContinue?')) return;
    }
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => {
      let data;
      try { data = JSON.parse(evt.target.result); }
      catch { showToast('Import failed: file is not valid JSON.', 'error'); return; }
      try {
        const res = applyFullProject(data);
        showToast(`Project imported: ${res.rooms} room${res.rooms !== 1 ? 's' : ''}, ${res.groups} group${res.groups !== 1 ? 's' : ''}.`, 'success');
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      }
    };
    reader.onerror = () => showToast('Import failed: could not read file.', 'error');
    reader.readAsText(file);
  });
}

/* ==============================================
   ROUND 20 — COLLAPSIBLE SIDEBAR PANELS
=============================================== */
/**
 * Updates the status bar left/right offsets to match the panel states,
 * and triggers a canvas resize so the blueprint fills the new space.
 */
function updateStatusBarForPanels() {
  const bar = document.getElementById('bp-status-bar');
  if (!bar) return;
  const leftCollapsed  = document.getElementById('bp-sidebar')?.classList.contains('collapsed');
  const rightCollapsed = document.getElementById('bp-right-panel')?.classList.contains('collapsed');
  bar.style.left  = leftCollapsed  ? '0'                : 'var(--bp-left-w)';
  bar.style.right = rightCollapsed ? '0'                : 'var(--bp-right-w)';
  // Re-size the blueprint canvas after the CSS transition settles
  setTimeout(() => {
    if (typeof initCanvas === 'function') {
      // Recalculate canvas wrapper dimensions; a full re-init isn't needed —
      // just fire a window resize so any listeners (zoom/layout) update.
      window.dispatchEvent(new Event('resize'));
    }
  }, 220);
}

function initPanelToggles() {
  const leftPanel   = document.getElementById('bp-sidebar');
  const rightPanel  = document.getElementById('bp-right-panel');
  const leftToggle  = document.getElementById('bp-left-toggle');
  const rightToggle = document.getElementById('bp-right-toggle');
  const leftIcon    = document.getElementById('bp-left-toggle-icon');
  const rightIcon   = document.getElementById('bp-right-toggle-icon');

  if (!leftToggle || !rightToggle) return;

  function updateLeftIcon(collapsed) {
    if (!leftIcon) return;
    // When left panel is collapsed, show right-pointing chevron (to expand)
    leftIcon.innerHTML = collapsed
      ? '<polyline points="9 18 15 12 9 6"/>'   // chevron-right = expand
      : '<polyline points="15 18 9 12 15 6"/>'; // chevron-left  = collapse
  }

  function updateRightIcon(collapsed) {
    if (!rightIcon) return;
    rightIcon.innerHTML = collapsed
      ? '<polyline points="15 18 9 12 15 6"/>'  // chevron-left  = expand
      : '<polyline points="9 18 15 12 9 6"/>';  // chevron-right = collapse
  }

  leftToggle.addEventListener('click', () => {
    const nowCollapsed = !leftPanel.classList.contains('collapsed');
    leftPanel.classList.toggle('collapsed', nowCollapsed);
    updateLeftIcon(nowCollapsed);
    leftToggle.title = nowCollapsed ? 'Expand tools panel' : 'Collapse tools panel';
    updateStatusBarForPanels();
  });

  rightToggle.addEventListener('click', () => {
    const nowCollapsed = !rightPanel.classList.contains('collapsed');
    rightPanel.classList.toggle('collapsed', nowCollapsed);
    updateRightIcon(nowCollapsed);
    rightToggle.title = nowCollapsed ? 'Expand properties panel' : 'Collapse properties panel';
    updateStatusBarForPanels();
  });
}

function init() {
  loadSettings();
  loadVizPrefs();  // Round 24: restore viz panel prefs (congestionOpen, etc.) before modules init
  applyTheme(AppState.settings.palette || 'default');  // R38: apply saved palette on boot

  const { gridCols, gridRows } = AppState.settings;
  AppState.blueprint.gridCols = gridCols || 30;
  AppState.blueprint.gridRows = gridRows || 20;
  initGridData(AppState.blueprint.gridCols, AppState.blueprint.gridRows, false);

  populateSettingsForm();
  populateDeptDropdown();   // R59: dept options follow the loaded subjects list
  syncHeader();
  initCanvas();
  switchTab('blueprint');
  setActiveTool('classroom');

  // Initialize dummy room tool swatch
  updateDummyToolSwatch();

  // Attempt to restore blueprint from localStorage
  const restored = loadBlueprintFromLocalStorage();
  if (restored) {
    updateTileStats();
    // Show a subtle, dismissible notification
    setTimeout(() => {
      showToast('Blueprint loaded from saved data.', 'info');
    }, 400);
  } else {
    rebuildRoomRegistry();
  }

  updateStatusBar();
  updateUndoRedoButtons();

  // Round 31: floor manager
  document.getElementById('btn-add-floor')?.addEventListener('click', () => FloorManager.addFloor());
  FloorManager.renderTabs();

  initSchedulesModule();
  initVizModule();
  initOnboardingAndHelp();
  initCorridorLabelModal();
  initFullProjectIO();
  initPanelToggles();
  initSnapshotManager(); // R39
  initRoomSearch();      // R39
  initWhatIfModule();    // R51
  initPresentationMode(); // R58
}

document.addEventListener('DOMContentLoaded', init);

/* ==============================================
   R39 — MODULE 5: PROJECT SNAPSHOTS
=============================================== */
const SNAPSHOT_KEY_PREFIX = 'STVIZ_SNAPSHOT_';
const SNAPSHOT_USER_SLOTS = 4;   // slots 1–4 are user slots; slot 0 is auto
const SNAPSHOT_TOTAL      = 5;   // 0..4

function snapshotKey(slot) {
  return SNAPSHOT_KEY_PREFIX + slot;
}

function saveSnapshot(name, slot) {
  try {
    const data = serializeFullProject();
    const payload = JSON.stringify({ name, timestamp: new Date().toISOString(), data });
    localStorage.setItem(snapshotKey(slot !== undefined ? slot : _nextUserSnapshotSlot()), payload);
    renderSnapshotList();
    return true;
  } catch (e) {
    console.warn('[STVIZ] Snapshot save failed:', e);
    // R58: surface the failure instead of dying silently in the console.
    const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 ||
                          e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    showToast(isQuota
      ? 'Snapshot not saved — browser storage is full. Delete an old snapshot and try again.'
      : 'Snapshot not saved — could not write to browser storage.', 'error');
    return false;
  }
}

/** Find the next available user slot (1-4), or the oldest one if all full. */
function _nextUserSnapshotSlot() {
  for (let i = 1; i <= SNAPSHOT_USER_SLOTS; i++) {
    if (!localStorage.getItem(snapshotKey(i))) return i;
  }
  // All full — evict the oldest
  let oldest = null, oldestSlot = 1;
  for (let i = 1; i <= SNAPSHOT_USER_SLOTS; i++) {
    try {
      const snap = JSON.parse(localStorage.getItem(snapshotKey(i)));
      if (!snap) continue;
      if (!oldest || snap.timestamp < oldest) { oldest = snap.timestamp; oldestSlot = i; }
    } catch { /* skip */ }
  }
  return oldestSlot;
}

function listSnapshots() {
  const snaps = [];
  for (let i = 0; i < SNAPSHOT_TOTAL; i++) {
    try {
      const raw = localStorage.getItem(snapshotKey(i));
      if (!raw) continue;
      const snap = JSON.parse(raw);
      // R58: localStorage stores UTF-16, so approximate bytes = 2 × chars.
      snaps.push({ slot: i, name: snap.name, timestamp: snap.timestamp,
                   isAuto: i === 0, sizeBytes: raw.length * 2 });
    } catch { /* skip corrupt entry */ }
  }
  // User slots sorted newest-first; auto slot always last
  const user = snaps.filter(s => !s.isAuto).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const auto = snaps.filter(s => s.isAuto);
  return [...user, ...auto];
}

function restoreSnapshot(slot) {
  try {
    const raw = localStorage.getItem(snapshotKey(slot));
    if (!raw) { showToast('Snapshot not found.', 'error'); return; }
    const snap = JSON.parse(raw);
    applyFullProject(snap.data);
    showToast(`Snapshot "${snap.name}" restored.`, 'success');
  } catch (e) {
    showToast('Restore failed: snapshot data is corrupt.', 'error');
  }
}

function deleteSnapshot(slot) {
  localStorage.removeItem(snapshotKey(slot));
  renderSnapshotList();
  showToast('Snapshot deleted.', 'info');
}

function renderSnapshotList() {
  const listEl = document.getElementById('snapshot-list');
  if (!listEl) return;
  const snaps = listSnapshots();
  if (snaps.length === 0) {
    listEl.innerHTML = '<div class="snapshot-empty">No snapshots yet. Save one above.</div>';
    return;
  }
  listEl.innerHTML = snaps.map(snap => {
    const ts = (() => {
      try {
        const d = new Date(snap.timestamp);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
               ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } catch { return snap.timestamp; }
    })();
    return `<div class="snapshot-item${snap.isAuto ? ' auto' : ''}">
      <span class="snapshot-item-icon">
        <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${snap.isAuto
            ? '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
            : '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'}
        </svg>
      </span>
      <div class="snapshot-item-info">
        <div class="snapshot-item-name">${escHtml(snap.name)}</div>
        <div class="snapshot-item-ts">${escHtml(ts)} · ${(snap.sizeBytes / 1024).toFixed(1)} KB</div>
      </div>
      <div class="snapshot-item-actions">
        <button class="snapshot-action-btn restore" data-snapshot-slot="${snap.slot}">Restore</button>
        <button class="snapshot-action-btn del" data-snapshot-delete="${snap.slot}">Delete</button>
      </div>
    </div>`;
  }).join('') +
  // R58: total-usage footer — approximate share of the typical ~5 MB quota.
  (() => {
    const totalKB = snaps.reduce((s, x) => s + x.sizeBytes, 0) / 1024;
    return `<div class="snapshot-usage-line">Snapshots using ~${totalKB >= 1024
      ? (totalKB / 1024).toFixed(2) + ' MB' : totalKB.toFixed(1) + ' KB'} of ~5 MB browser storage</div>`;
  })();

  // Wire buttons via delegation
  listEl.querySelectorAll('[data-snapshot-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.snapshotSlot, 10);
      if (!confirm('Restore this snapshot? Current project will be replaced.')) return;
      restoreSnapshot(slot);
    });
  });
  listEl.querySelectorAll('[data-snapshot-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.snapshotDelete, 10);
      if (!confirm('Delete this snapshot? This cannot be undone.')) return;
      deleteSnapshot(slot);
    });
  });
}

function initSnapshotManager() {
  // Render list on page load
  renderSnapshotList();

  // Save snapshot button
  document.getElementById('btn-save-snapshot')?.addEventListener('click', () => {
    const input = document.getElementById('snapshot-name-input');
    const name  = (input?.value || '').trim() || `Snapshot ${new Date().toLocaleTimeString()}`;
    const ok = saveSnapshot(name);
    if (input) input.value = '';
    if (ok) showToast(`Snapshot "${name}" saved.`, 'success');
  });
}

/* ==============================================
   R58 — PRESENTATION MODE (Option P1)
   One-click projector view for the Visualize tab: hides editing chrome via
   body.presentation-mode, mirrors the legend into a floating card, pins the
   congestion summary open, and optionally auto-cycles transition mods.
   All hiding is CSS-only, so exit restores the normal layout; the only
   stateful bit (congestion open/collapsed) is snapshotted and restored.
============================================== */
const PresentationMode = {
  active: false,
  _prevCongestionOpen: null,
  _cycleTimer: null,

  toggle() { this.active ? this.exit() : this.enter(); },

  enter() {
    if (this.active || AppState.ui.activeTab !== 'visualize') return;
    this.active = true;
    // Snapshot + pin the congestion dock open for the demo.
    this._prevCongestionOpen = AppState.viz.congestionOpen;
    AppState.viz.congestionOpen = true;
    document.getElementById('viz-congestion-panel')?.classList.remove('collapsed');
    document.body.classList.add('presentation-mode');
    this.syncLegend();
    this._dispatchResize();
  },

  exit() {
    if (!this.active) return;
    this.active = false;
    this._stopCycle();
    document.body.classList.remove('presentation-mode');
    // Restore the exact prior congestion dock state.
    if (this._prevCongestionOpen !== null) {
      AppState.viz.congestionOpen = this._prevCongestionOpen;
      document.getElementById('viz-congestion-panel')
        ?.classList.toggle('collapsed', !this._prevCongestionOpen);
      this._prevCongestionOpen = null;
    }
    this._dispatchResize();
  },

  /** Mirror the live legend list into the floating card. */
  syncLegend() {
    if (!this.active) return;
    const src = document.getElementById('viz-legend-list');
    const dst = document.getElementById('pres-legend-list');
    if (src && dst) dst.innerHTML = src.innerHTML;
  },

  _dispatchResize() {
    // Same settle pattern as the blueprint panel toggles: let the layout
    // reflow, then force the canvas fit recalculation.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  },

  _startCycle() {
    this._stopCycle();
    const sec = parseInt(document.getElementById('pres-cycle-interval')?.value, 10) || 10;
    this._cycleTimer = setInterval(() => this._advanceTransition(), sec * 1000);
    document.getElementById('pres-cycle-play')?.classList.add('active');
    const btn = document.getElementById('pres-cycle-play');
    if (btn) { btn.textContent = '❚❚'; btn.title = 'Pause auto-cycle'; }
  },

  _stopCycle() {
    if (this._cycleTimer) { clearInterval(this._cycleTimer); this._cycleTimer = null; }
    const btn = document.getElementById('pres-cycle-play');
    if (btn) { btn.classList.remove('active'); btn.textContent = '▶'; btn.title = 'Auto-cycle through transitions (off by default)'; }
  },

  /** Advance the transition-mod filter to the next concrete option (wraps). */
  _advanceTransition() {
    const sel = document.getElementById('viz-transition-select');
    if (!sel) return;
    const opts = Array.from(sel.options).filter(o => o.value !== '');
    if (!opts.length) return;
    const idx = opts.findIndex(o => o.value === sel.value);
    sel.value = opts[(idx + 1) % opts.length].value;
    sel.dispatchEvent(new Event('change'));
  },
};

function initPresentationMode() {
  document.getElementById('viz-present-btn')?.addEventListener('click', () => PresentationMode.enter());
  document.getElementById('pres-exit')?.addEventListener('click', () => PresentationMode.exit());
  document.getElementById('pres-cycle-play')?.addEventListener('click', () => {
    PresentationMode._cycleTimer ? PresentationMode._stopCycle() : PresentationMode._startCycle();
  });
  // Changing the interval while cycling restarts the timer at the new pace.
  document.getElementById('pres-cycle-interval')?.addEventListener('change', () => {
    if (PresentationMode._cycleTimer) PresentationMode._startCycle();
  });

  // Keep the mirrored legend fresh — renderVizLegend rewrites #viz-legend-list,
  // so observe it rather than threading a hook through the renderer.
  const legendSrc = document.getElementById('viz-legend-list');
  if (legendSrc && window.MutationObserver) {
    new MutationObserver(() => PresentationMode.syncLegend())
      .observe(legendSrc, { childList: true, subtree: true });
  }

  // Keyboard: P toggles (Visualize tab, not in a field); Esc exits.
  document.addEventListener('keydown', (e) => {
    if (AppState.ui.activeTab !== 'visualize') return;
    if (e.key === 'Escape') { if (PresentationMode.active) PresentationMode.exit(); return; }
    const t = e.target;
    const tag = (t && t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      PresentationMode.toggle();
    }
  });
}

/* ==============================================
   R39 — MODULE 1: ROOM SEARCH & JUMP-TO
=============================================== */
let _searchHighlightTimer = null;

function initRoomSearch() {
  const overlay   = document.getElementById('bp-room-search');
  const input     = document.getElementById('bp-room-search-input');
  const dropdown  = document.getElementById('bp-room-search-dropdown');
  const closeBtn  = document.getElementById('bp-room-search-close');
  const inputRow  = document.getElementById('bp-room-search-input-row');
  if (!overlay || !input || !dropdown) return;

  // Keyboard shortcut: Ctrl/Cmd+F while blueprint tab is active
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      if (AppState.ui.activeTab !== 'blueprint') return;
      e.preventDefault();
      openRoomSearch();
    }
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      closeRoomSearch();
    }
  });

  // Close on outside click
  document.addEventListener('mousedown', e => {
    if (overlay.style.display !== 'none' && !overlay.contains(e.target)) {
      closeRoomSearch();
    }
  });

  closeBtn.addEventListener('click', closeRoomSearch);

  input.addEventListener('input', () => {
    renderRoomSearchDropdown(input.value.trim());
    inputRow.classList.toggle('has-results',
      dropdown.children.length > 0 && input.value.trim().length > 0);
  });

  // Close & clear highlight on canvas click
  const canvasEl = document.getElementById('bp-canvas');
  if (canvasEl) {
    canvasEl.addEventListener('mousedown', () => {
      if (AppState.ui.searchHighlightCell) {
        AppState.ui.searchHighlightCell = null;
        renderCanvas();
      }
    });
  }
}

function openRoomSearch() {
  const overlay = document.getElementById('bp-room-search');
  const input   = document.getElementById('bp-room-search-input');
  if (!overlay) return;
  overlay.style.display = '';
  input.value = '';
  document.getElementById('bp-room-search-dropdown').innerHTML = '';
  document.getElementById('bp-room-search-input-row')?.classList.remove('has-results');
  requestAnimationFrame(() => input.focus());
}

function closeRoomSearch() {
  const overlay = document.getElementById('bp-room-search');
  if (overlay) overlay.style.display = 'none';
}

function renderRoomSearchDropdown(query) {
  const dropdown = document.getElementById('bp-room-search-dropdown');
  if (!dropdown) return;
  if (!query) { dropdown.innerHTML = ''; return; }

  const q = query.toLowerCase();
  const allRooms = roomRegistry; // global

  // Rank: exact prefix first, then substring
  const exactPrefix = [];
  const substring   = [];
  for (const room of allRooms) {
    const rn = (room.roomNumber || '').toLowerCase();
    const tn = (room.teacherName || '').toLowerCase();
    if (rn.startsWith(q)) { exactPrefix.push(room); }
    else if (rn.includes(q) || tn.includes(q)) { substring.push(room); }
  }
  const results = [...exactPrefix, ...substring].slice(0, 8);

  if (results.length === 0) {
    dropdown.innerHTML = `<div class="bp-search-no-results">No rooms match "${escHtml(query)}"</div>`;
    return;
  }

  const floors = AppState.blueprint.floors;
  dropdown.innerHTML = results.map(room => {
    const floorLabel = floors.length > 1
      ? (floors.find(f => f.id === (room.floorId || floors[0].id))?.label || '')
      : '';
    return `<div class="bp-search-item" data-col="${room.anchorCol}" data-row="${room.anchorRow}" data-floor-id="${room.floorId || ''}">
      <span class="bp-search-item-room">${escHtml(room.roomNumber)}</span>
      <span class="bp-search-item-teacher">${room.teacherName ? escHtml(room.teacherName) : '<span style="color:var(--slate-300)">No teacher assigned</span>'}</span>
      ${floorLabel ? `<span class="bp-search-item-floor">${escHtml(floorLabel)}</span>` : ''}
    </div>`;
  }).join('');

  dropdown.querySelectorAll('.bp-search-item').forEach(el => {
    el.addEventListener('click', () => {
      const col     = parseInt(el.dataset.col, 10);
      const row     = parseInt(el.dataset.row, 10);
      const floorId = el.dataset.floorId;
      jumpToRoomSearchResult(col, row, floorId);
      closeRoomSearch();
    });
  });
}

function jumpToRoomSearchResult(col, row, floorId) {
  // If the result is on a different floor, switch to it first
  if (floorId) {
    const floorIdx = AppState.blueprint.floors.findIndex(f => f.id === floorId);
    if (floorIdx >= 0 && floorIdx !== AppState.blueprint.activeFloorIdx) {
      if (typeof switchActiveFloor === 'function') switchActiveFloor(floorIdx);
    }
  }

  const cellSize  = getEffectiveCellSize();
  const tile      = getTile(col, row);
  const groupId   = tile && tile.groupId;

  // Compute anchor pixel center
  const px = groupId ? getGroupCenterX(col, row, groupId, cellSize) : (col + 0.5) * cellSize;
  const py = groupId ? getGroupCenterY(col, row, groupId, cellSize) : (row + 0.5) * cellSize;

  // Scroll bp-canvas-area so the cell is centered in the viewport
  const area = document.getElementById('bp-canvas-area');
  if (area) {
    const z = AppState.ui.zoom || 1;
    area.scrollLeft = px * z - area.clientWidth  / 2;
    area.scrollTop  = py * z - area.clientHeight / 2;
  }

  // Set highlight and auto-clear after 2000 ms
  if (_searchHighlightTimer) clearTimeout(_searchHighlightTimer);
  AppState.ui.searchHighlightCell = { col, row };
  renderCanvas();
  _searchHighlightTimer = setTimeout(() => {
    AppState.ui.searchHighlightCell = null;
    renderCanvas();
    _searchHighlightTimer = null;
  }, 2000);
}

/* ══════════════════════════════════════════════════════════════
   ROUND 51 — WHAT-IF SCHEDULE LAB
   ──────────────────────────────────────────────────────────────
   A constraint-aware schedule simulator layered on the existing
   A* pathfinding and congestion engines. Reassignments live in a
   sandbox ("overrides") that NEVER mutates the real group objects;
   every edit recomputes baseline-vs-scenario metrics:
     • per-group and total travel time (walk + congestion delay,
       same multiplier model as computeTravelTimes / R49-R50)
     • per-transition corridor concurrency + whole-day congestion
     • room double-booking conflicts (excluded rooms respected)
     • routing violations (unreachable rooms / unassigned mods)
   The diff renders as summary cards, a red/blue congestion-delta
   map over the stacked floor blueprint (export-canvas redirect
   pattern), per-group tables, hotspot lists, and a constraint
   panel. "Apply Scenario" commits overrides to the live schedule.
══════════════════════════════════════════════════════════════ */

const WHATIF_KEY = 'stviz_whatif';

AppState.whatif = {
  day: 'A',
  overrides: {},          // { [groupId]: { [modIdx]: room | '' } } — sandbox only
  selectedGroupId: null,
  transitionFilter: null, // null = all transitions (summed) | 1..modCount-1
  lastDiff: null,         // cached diff (drives map tooltip hit-testing)
  _mapLayout: null,       // { scale, cellSize } — blit geometry for tooltip math
};

let _wiSaveTimer   = null;
let _wiRenderTimer = null;

/* ── Persistence ─────────────────────────────────────────────── */
function saveWhatIf(immediate) {
  const write = () => {
    try {
      localStorage.setItem(WHATIF_KEY, JSON.stringify({
        day: AppState.whatif.day,
        overrides: AppState.whatif.overrides,
      }));
    } catch (e) { /* quota — non-fatal */ }
  };
  if (immediate) { if (_wiSaveTimer) clearTimeout(_wiSaveTimer); _wiSaveTimer = null; write(); return; }
  if (_wiSaveTimer) clearTimeout(_wiSaveTimer);
  _wiSaveTimer = setTimeout(() => { _wiSaveTimer = null; write(); }, 400);
}

function loadWhatIf() {
  try {
    const raw = localStorage.getItem(WHATIF_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      if (data.day === 'A' || data.day === 'B') AppState.whatif.day = data.day;
      if (data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)) {
        AppState.whatif.overrides = data.overrides;
      }
    }
  } catch (e) { /* corrupt blob — start clean */ }
}

/* ── R58: What-If ↔ full-project bridge ─────────────────────────
   Live overrides are keyed by group id, but applyFullProject
   regenerates every id on import. The project file therefore
   stores overrides keyed by group ARRAY INDEX (stable in export
   order); these two helpers remap in each direction. */
function serializeWhatIfForProject() {
  const out = { version: 1, day: AppState.whatif.day, overridesByIndex: {} };
  const groups = AppState.schedules.groups;
  const src = AppState.whatif.overrides || {};
  for (const gid in src) {
    const idx = groups.findIndex(g => g.id === gid);
    if (idx === -1) continue;                       // orphaned override — drop
    const mods = src[gid];
    if (!mods || typeof mods !== 'object' || !Object.keys(mods).length) continue;
    out.overridesByIndex[idx] = { ...mods };
  }
  return out;
}

function applyWhatIfFromProject(wi, cleanGroups) {
  // Always reset the sandbox first so a pre-R58 file (no `whatif` key)
  // imports with a clean scenario instead of stale, orphaned overrides.
  AppState.whatif.overrides = {};
  AppState.whatif.day = 'A';
  if (wi && typeof wi === 'object') {
    if (wi.day === 'A' || wi.day === 'B') AppState.whatif.day = wi.day;
    const byIdx = wi.overridesByIndex;
    if (byIdx && typeof byIdx === 'object' && !Array.isArray(byIdx)) {
      for (const key in byIdx) {
        const idx = parseInt(key, 10);
        const group = Number.isInteger(idx) ? cleanGroups[idx] : null;
        const mods = byIdx[key];
        if (!group || !mods || typeof mods !== 'object' || Array.isArray(mods)) continue;
        AppState.whatif.overrides[group.id] = { ...mods };
      }
    }
  }
  AppState.whatif.selectedGroupId = null;
  AppState.whatif.lastDiff = null;
  saveWhatIf(true);
  // Day toggle buttons live outside onWhatIfTabActivated — sync them here.
  document.querySelectorAll('.wi-day-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.wiDay === 'B' ? 'B' : 'A') === AppState.whatif.day));
  // Refresh the What-If tab UI. If the tab is active, run the full
  // activation pipeline (repopulates selects, editor, chips, results);
  // otherwise just keep the tab badge honest.
  if (AppState.ui.activeTab === 'whatif') {
    onWhatIfTabActivated();
  } else if (typeof wiUpdateBadge === 'function') {
    wiUpdateBadge();
  }
}

/* ── Override bookkeeping ────────────────────────────────────── */
function wiOverrideCount() {
  let n = 0;
  for (const gid in AppState.whatif.overrides) n += Object.keys(AppState.whatif.overrides[gid]).length;
  return n;
}

/**
 * Baseline (live-schedule) mods for a group on a day, padded/trimmed to
 * modCount. Day-fallback rules mirror findGroupDayPath exactly so the
 * What-If baseline always matches what the Visualize tab renders.
 */
function wiBaseMods(group, day) {
  const modCount = AppState.settings.modCount;
  let raw;
  if (day === 'B') {
    raw = (group.modsB && group.modsB.length > 0) ? group.modsB : (group.mods || []);
  } else {
    raw = group.modsA || group.mods || [];
  }
  const mods = [];
  for (let i = 0; i < modCount; i++) mods.push(((raw[i] || '') + '').trim());
  return mods;
}

/** Baseline mods with sandbox overrides applied. Pure — never mutates the group. */
function wiEffectiveMods(group, day, overrides) {
  const mods = wiBaseMods(group, day);
  const ov = overrides && overrides[group.id];
  if (ov) {
    for (const k in ov) {
      const idx = +k;
      if (idx >= 0 && idx < mods.length) mods[idx] = ((ov[k] || '') + '').trim();
    }
  }
  return mods;
}

/* ── Metrics engine ──────────────────────────────────────────── */
/**
 * wiComputeMetrics(day, overridesOrNull)
 * Full schedule evaluation against the current blueprint graph.
 * Pass overrides = null for the live baseline. Returns:
 *   { day, perGroup, congPerT, congAll, totals:{travelSec,delaySec},
 *     peak:{load,cellKey,transition}, conflicts, routingErrors, unassigned }
 */
function wiComputeMetrics(day, overrides) {
  const groups   = AppState.schedules.groups;
  const modCount = AppState.settings.modCount;
  const labels   = getAllModLabels();
  const walkSec  = (AppState.settings.tileWalkTime  != null) ? AppState.settings.tileWalkTime  : 3;
  const stairSec = (AppState.settings.staircaseTime != null) ? AppState.settings.staircaseTime : 8;
  const floor0Id = AppState.blueprint.floors[0] && AppState.blueprint.floors[0].id;
  // R59: student-weighting — mirrors computeTravelTimes / buildCongestionData
  // exactly so baseline and scenario reconcile with the live Visualizer.
  const dgs = (Number.isFinite(AppState.settings.defaultGroupSize) && AppState.settings.defaultGroupSize > 0)
    ? AppState.settings.defaultGroupSize : 25;
  const weighted = anyGroupSized(groups);

  // Pass 1 — segments per group from effective mods (graph self-validates).
  const perGroup = groups.map(g => {
    const mods = wiEffectiveMods(g, day, overrides);
    const segments = [];
    for (let i = 0; i < modCount - 1; i++) {
      const seg = {
        fromMod: i + 1, toMod: i + 2,
        fromModLabel: labels[i]     || ('Mod ' + (i + 1)),
        toModLabel:   labels[i + 1] || ('Mod ' + (i + 2)),
        fromRoom: mods[i] || null, toRoom: mods[i + 1] || null,
        path: null, pathLength: 0, usesStaircase: false, staircasePairsUsed: [], hallwayCells: [],
      };
      Object.assign(seg, resolveRoomPath(mods[i], mods[i + 1]));
      if (seg.error) seg.path = null;
      segments.push(seg);
    }
    return { id: g.id, name: g.name, grade: g.grade, color: g.color, mods, segments,
             weight: groupWeight(g) };   // R59
  });

  // Pass 2 — per-transition tile occupancy (who shares which corridor cell).
  const transitionTileSets = [];
  for (let t = 0; t < modCount - 1; t++) transitionTileSets.push(new Map());
  perGroup.forEach((pg, gi) => {
    pg.segments.forEach(seg => {
      if (seg.error || seg.noTravel || !seg.hallwayCells || !seg.hallwayCells.length) return;
      const tileMap = transitionTileSets[seg.fromMod - 1];
      const seen = new Set();
      for (const cell of seg.hallwayCells) {
        const k = floorCellKey(cell.floorId || floor0Id, cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!tileMap.has(k)) tileMap.set(k, new Set());
        tileMap.get(k).add(gi);
      }
    });
  });

  // Pass 3 — walk + congestion-delay times. Multipliers identical to
  // computeTravelTimes so What-If numbers reconcile with the travel panel.
  let totalTravel = 0, totalDelay = 0, routingErrors = 0, unassigned = 0;
  perGroup.forEach(pg => {
    let t = 0, d = 0;
    pg.segments.forEach(seg => {
      if (seg.error) {
        seg.travelSec = 0; seg.delaySec = 0;
        if (seg.severity === 'error') routingErrors++; else unassigned++;
        return;
      }
      if (seg.noTravel) { seg.travelSec = 0; seg.delaySec = 0; return; }
      const baseSec = (seg.hallwayCells || []).length * walkSec + (seg.usesStaircase ? stairSec : 0);
      let delaySec = 0;
      const tileMap = transitionTileSets[seg.fromMod - 1];
      const seen = new Set();
      for (const cell of (seg.hallwayCells || [])) {
        const k = floorCellKey(cell.floorId || floor0Id, cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        const sharers = tileMap.get(k);
        if (!sharers) continue;
        // R59: student-weighted "others" — identical to computeTravelTimes.
        let othersWeight = 0;
        for (const oIdx of sharers) if (perGroup[oIdx] !== pg) othersWeight += perGroup[oIdx].weight;
        if (othersWeight <= 0) continue;
        delaySec += walkSec * congestionDelayMult(othersWeight / dgs);
      }
      seg.travelSec = Math.round(baseSec);
      seg.delaySec  = Math.round(delaySec);
      t += baseSec; d += delaySec;
    });
    pg.totalTravelSec = Math.round(t);
    pg.totalDelaySec  = Math.round(d);
    totalTravel += t; totalDelay += d;
  });

  // Pass 4 — congestion maps: one per transition + whole-day sum.
  // Mirrors computeCongestionMap: one tally per segment, exclude zones skipped.
  const congPerT = [];
  for (let t = 0; t < modCount - 1; t++) congPerT.push(new Map());
  const congAll = new Map();
  perGroup.forEach(pg => pg.segments.forEach(seg => {
    if (seg.error || seg.noTravel || !seg.hallwayCells || !seg.hallwayCells.length) return;
    const m = congPerT[seg.fromMod - 1];
    const seen = new Set();
    for (const cell of seg.hallwayCells) {
      if (isCellHeatExcluded(cell.x, cell.y, cell.floorId)) continue;
      const k = floorCellKey(cell.floorId || floor0Id, cell.x, cell.y);
      if (seen.has(k)) continue;
      seen.add(k);
      m.set(k, (m.get(k) || 0) + pg.weight);        // R59: student-weighted
      congAll.set(k, (congAll.get(k) || 0) + pg.weight);
    }
  }));

  // Peak single-transition load — most groups sharing one tile in one window.
  let peakLoad = 0, peakCellKey = null, peakT = 0;
  congPerT.forEach((m, tIdx) => m.forEach((v, k) => {
    if (v > peakLoad) { peakLoad = v; peakCellKey = k; peakT = tIdx + 1; }
  }));

  // Pass 5 — room double-bookings on EFFECTIVE mods (excluded rooms respected).
  const excludedRooms = new Set(roomRegistry.filter(r => r.excludeFromConflict).map(r => r.roomNumber));
  const cMap = new Map();
  perGroup.forEach(pg => pg.mods.forEach((room, idx) => {
    if (!room || excludedRooms.has(room)) return;
    const key = idx + '|' + room;
    if (!cMap.has(key)) cMap.set(key, []);
    cMap.get(key).push(pg.name);
  }));
  const conflicts = [];
  for (const [key, names] of cMap) {
    if (names.length < 2) continue;
    const bar = key.indexOf('|');
    const idx = +key.slice(0, bar), room = key.slice(bar + 1);
    conflicts.push({ key, mod: idx + 1, modLabel: labels[idx] || ('Mod ' + (idx + 1)), room, groupNames: names });
  }
  conflicts.sort((a, b) => a.mod - b.mod);

  return {
    day, perGroup, congPerT, congAll,
    totals: { travelSec: Math.round(totalTravel), delaySec: Math.round(totalDelay) },
    peak: { load: peakLoad, cellKey: peakCellKey, transition: peakT },
    conflicts, routingErrors, unassigned,
    weighted, defaultGroupSize: dgs,   // R59: display metadata for cards/hotspots
  };
}

function wiCongForFilter(metrics, tf) {
  if (tf && tf >= 1 && tf <= metrics.congPerT.length) return metrics.congPerT[tf - 1];
  return metrics.congAll;
}

/** Baseline vs scenario evaluation + per-cell congestion deltas + conflict diff. */
function wiComputeDiff() {
  const day  = AppState.whatif.day;
  const base = wiComputeMetrics(day, null);
  const scen = wiComputeMetrics(day, AppState.whatif.overrides);

  const groupRows = base.perGroup.map((bg, i) => {
    const sg = scen.perGroup[i];
    const before = bg.totalTravelSec + bg.totalDelaySec;
    const after  = sg.totalTravelSec + sg.totalDelaySec;
    const ov = AppState.whatif.overrides[bg.id];
    return {
      id: bg.id, name: bg.name, color: bg.color, grade: bg.grade,
      before, after, delta: after - before,
      changed: !!(ov && Object.keys(ov).length),
    };
  });

  const tf = AppState.whatif.transitionFilter;
  const baseMap = wiCongForFilter(base, tf);
  const scenMap = wiCongForFilter(scen, tf);
  const deltas = new Map();
  const keys = new Set([...baseMap.keys(), ...scenMap.keys()]);
  let maxAbs = 0;
  for (const k of keys) {
    const d = (scenMap.get(k) || 0) - (baseMap.get(k) || 0);
    if (d !== 0) { deltas.set(k, d); if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d); }
  }

  const bKeys = new Set(base.conflicts.map(c => c.key));
  const sKeys = new Set(scen.conflicts.map(c => c.key));
  return {
    day, base, scen, groupRows, deltas, maxAbs, baseMap, scenMap,
    newConflicts:        scen.conflicts.filter(c => !bKeys.has(c.key)),
    resolvedConflicts:   base.conflicts.filter(c => !sKeys.has(c.key)),
    persistingConflicts: scen.conflicts.filter(c =>  bKeys.has(c.key)),
  };
}

/* ── Override mutations ──────────────────────────────────────── */
function wiSetOverride(groupId, modIdx, room) {
  const group = AppState.schedules.groups.find(g => g.id === groupId);
  if (!group) return;
  const baseRoom = wiBaseMods(group, AppState.whatif.day)[modIdx] || '';
  const next = ((room || '') + '').trim();
  const ov = AppState.whatif.overrides;
  if (next === baseRoom) {
    if (ov[groupId]) { delete ov[groupId][modIdx]; if (!Object.keys(ov[groupId]).length) delete ov[groupId]; }
  } else {
    if (!ov[groupId]) ov[groupId] = {};
    ov[groupId][modIdx] = next;
  }
  wiAfterOverridesChanged();
}

function wiRemoveOverride(groupId, modIdx) {
  const ov = AppState.whatif.overrides;
  if (ov[groupId]) {
    delete ov[groupId][modIdx];
    if (!Object.keys(ov[groupId]).length) delete ov[groupId];
  }
  wiAfterOverridesChanged();
}

function wiResetScenario() {
  const n = wiOverrideCount();
  if (!n) return;
  if (!window.confirm(`Discard all ${n} scenario change${n === 1 ? '' : 's'}? The live schedule is unaffected either way.`)) return;
  AppState.whatif.overrides = {};
  wiAfterOverridesChanged();
  showToast('Scenario reset — back to the live schedule.', 'info');
}

/** Commit sandbox overrides into the real group schedules. */
function wiApplyScenario() {
  const count = wiOverrideCount();
  if (!count) return;
  const day = AppState.whatif.day;
  if (!window.confirm(
    `Apply ${count} change${count === 1 ? '' : 's'} to the live ${day} Day schedule?\n\n` +
    `This rewrites the affected groups' room assignments (you can edit them back in the Schedules tab).`
  )) return;

  const modCount = AppState.settings.modCount;
  for (const gid of Object.keys(AppState.whatif.overrides)) {
    const group = AppState.schedules.groups.find(g => g.id === gid);
    if (!group) continue;
    const eff = wiEffectiveMods(group, day, AppState.whatif.overrides);
    if (day === 'B') {
      group.modsB = eff.slice(0, modCount);
    } else {
      group.modsA = eff.slice(0, modCount);
      if (Array.isArray(group.mods)) group.mods = eff.slice(0, modCount); // keep legacy mirror coherent
    }
  }
  AppState.whatif.overrides = {};
  saveWhatIf(true);
  saveSchedules();
  if (typeof scheduleGroupsAutosave === 'function') scheduleGroupsAutosave();
  if (typeof renderGroupList === 'function') renderGroupList();
  if (typeof renderConflictBanner === 'function') renderConflictBanner();
  showToast(`Scenario applied to the ${day} Day schedule.`, 'success');
  wiAfterOverridesChanged();
}

/** Drop overrides that no longer point at anything real (deleted groups,
 *  shrunk mod counts, or edits that converged back to the baseline). */
function wiPruneOverrides() {
  const ov = AppState.whatif.overrides;
  const modCount = AppState.settings.modCount;
  let dirty = false;
  for (const gid of Object.keys(ov)) {
    const group = AppState.schedules.groups.find(g => g.id === gid);
    if (!group) { delete ov[gid]; dirty = true; continue; }
    const baseMods = wiBaseMods(group, AppState.whatif.day);
    for (const k of Object.keys(ov[gid])) {
      const idx = +k;
      if (!(idx >= 0 && idx < modCount) || ((ov[gid][k] || '') + '').trim() === baseMods[idx]) {
        delete ov[gid][k]; dirty = true;
      }
    }
    if (!Object.keys(ov[gid]).length) { delete ov[gid]; dirty = true; }
  }
  if (dirty) saveWhatIf();
}

/* ── Shared render plumbing ──────────────────────────────────── */
function wiAfterOverridesChanged() {
  saveWhatIf();
  wiUpdateBadge();
  wiRenderChips();
  wiRenderModEditor();
  wiUpdateActionButtons();
  wiScheduleRender();
}

function wiUpdateBadge() {
  const badge = document.getElementById('badge-whatif');
  if (!badge) return;
  const n = wiOverrideCount();
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'inline-flex' : 'none';
  const cnt = document.getElementById('wi-change-count');
  if (cnt) cnt.textContent = n > 0 ? `(${n})` : '';
}

function wiUpdateActionButtons() {
  const n = wiOverrideCount();
  const apply = document.getElementById('wi-apply-btn');
  const reset = document.getElementById('wi-reset-btn');
  if (apply) apply.disabled = n === 0;
  if (reset) reset.disabled = n === 0;
}

function wiScheduleRender() {
  if (_wiRenderTimer) clearTimeout(_wiRenderTimer);
  _wiRenderTimer = setTimeout(() => { _wiRenderTimer = null; wiRenderAll(); }, 30);
}

function wiFmtSec(s) {
  s = Math.round(Math.abs(s));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

/* ── Left panel: editor UI ───────────────────────────────────── */
function wiPopulateGroupSelect() {
  const sel = document.getElementById('wi-group-select');
  if (!sel) return;
  const groups = AppState.schedules.groups.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!groups.length) {
    sel.innerHTML = '<option value="">— no groups defined —</option>';
    AppState.whatif.selectedGroupId = null;
    return;
  }
  if (!groups.find(g => g.id === AppState.whatif.selectedGroupId)) {
    AppState.whatif.selectedGroupId = groups[0].id;
  }
  sel.innerHTML = groups.map(g =>
    `<option value="${escHtml(g.id)}"${g.id === AppState.whatif.selectedGroupId ? ' selected' : ''}>` +
    `${escHtml(g.name)}${g.grade ? ' · Grade ' + escHtml(String(g.grade)) : ''}</option>`
  ).join('');
}

function wiRenderModEditor() {
  const host = document.getElementById('wi-mod-editor');
  if (!host) return;
  const group = AppState.schedules.groups.find(g => g.id === AppState.whatif.selectedGroupId);
  if (!group) {
    host.innerHTML = '<div class="wi-empty-note">Add groups in the Schedules tab to start experimenting.</div>';
    return;
  }
  const day      = AppState.whatif.day;
  const modCount = AppState.settings.modCount;
  const labels   = getAllModLabels();
  const baseMods = wiBaseMods(group, day);
  const ov       = AppState.whatif.overrides[group.id] || {};
  const roomNums = roomRegistry.map(r => r.roomNumber);
  const roomSet  = new Set(roomNums);

  let html = '';
  for (let i = 0; i < modCount; i++) {
    const baseRoom = baseMods[i];
    const hasOv    = Object.prototype.hasOwnProperty.call(ov, i);
    const effRoom  = hasOv ? ((ov[i] || '') + '').trim() : baseRoom;
    // Keep baseline/effective rooms selectable even if they left the registry.
    const extras = [effRoom, baseRoom].filter(r => r && !roomSet.has(r));
    const opts = [`<option value=""${effRoom === '' ? ' selected' : ''}>— unassigned —</option>`]
      .concat(roomNums.concat(extras).map(r =>
        `<option value="${escHtml(r)}"${r === effRoom ? ' selected' : ''}>${escHtml(r)}</option>`));
    html += `
      <div class="wi-mod-row${hasOv ? ' modified' : ''}">
        <span class="wi-mod-label">${escHtml(labels[i] || ('Mod ' + (i + 1)))}</span>
        <select class="viz-select wi-mod-select" data-mod-idx="${i}" aria-label="Room for ${escHtml(labels[i] || ('Mod ' + (i + 1)))}">${opts.join('')}</select>
        <button class="wi-revert-btn" data-mod-idx="${i}" title="Revert to scheduled room (${escHtml(baseRoom || 'unassigned')})">&#8634;</button>
      </div>`;
    if (hasOv) html += `<div class="wi-base-hint">scheduled: ${escHtml(baseRoom || 'unassigned')}</div>`;
  }
  host.innerHTML = html;
  host.querySelectorAll('.wi-mod-select').forEach(s => s.addEventListener('change', e => {
    wiSetOverride(group.id, +e.target.dataset.modIdx, e.target.value);
  }));
  host.querySelectorAll('.wi-revert-btn').forEach(b => b.addEventListener('click', e => {
    wiRemoveOverride(group.id, +e.currentTarget.dataset.modIdx);
  }));
}

function wiRenderChips() {
  const host = document.getElementById('wi-override-chips');
  if (!host) return;
  const ov = AppState.whatif.overrides;
  const labels = getAllModLabels();
  const day = AppState.whatif.day;
  const chips = [];
  for (const gid of Object.keys(ov)) {
    const group = AppState.schedules.groups.find(g => g.id === gid);
    if (!group) continue;
    const baseMods = wiBaseMods(group, day);
    const idxs = Object.keys(ov[gid]).map(Number).sort((a, b) => a - b);
    for (const idx of idxs) {
      const from = baseMods[idx] || '—';
      const to   = ((ov[gid][idx] || '') + '').trim() || '—';
      chips.push(
        `<div class="wi-chip"><span>${escHtml(group.name)} · ${escHtml(labels[idx] || ('Mod ' + (idx + 1)))}: ` +
        `<b>${escHtml(from)}</b> &rarr; <b>${escHtml(to)}</b></span>` +
        `<button class="wi-chip-x" data-gid="${escHtml(gid)}" data-idx="${idx}" title="Remove this change">&times;</button></div>`
      );
    }
  }
  host.innerHTML = chips.length
    ? chips.join('')
    : '<div class="wi-empty-note">No changes yet. The scenario currently mirrors the live schedule.</div>';
  host.querySelectorAll('.wi-chip-x').forEach(b => b.addEventListener('click', e => {
    wiRemoveOverride(e.currentTarget.dataset.gid, +e.currentTarget.dataset.idx);
  }));
}

function wiPopulateTransitionSelect() {
  const sel = document.getElementById('wi-transition-select');
  if (!sel) return;
  const labels = getAllModLabels();
  const modCount = AppState.settings.modCount;
  const opts = ['<option value="">All transitions (whole day)</option>'];
  for (let t = 1; t <= modCount - 1; t++) {
    const win = formatTransitionWindow(AppState.whatif.day || 'A', t);   // R59
    const lbl = `${labels[t - 1] || ('Mod ' + t)} \u2192 ${labels[t] || ('Mod ' + (t + 1))}${win ? ' \u00b7 ' + win : ''}`;
    opts.push(`<option value="${t}"${AppState.whatif.transitionFilter === t ? ' selected' : ''}>${escHtml(lbl)}</option>`);
  }
  sel.innerHTML = opts.join('');
}

/* ── Right panel: results rendering ──────────────────────────── */
function wiRenderAll() {
  const emptyEl = document.getElementById('wi-results-empty');
  const innerEl = document.getElementById('wi-results-inner');
  if (!emptyEl || !innerEl) return;
  if (!AppState.schedules.groups.length || !roomRegistry.length) {
    emptyEl.style.display = '';
    innerEl.style.display = 'none';
    AppState.whatif.lastDiff = null;
    return;
  }
  emptyEl.style.display = 'none';
  innerEl.style.display = '';

  const diff = wiComputeDiff();
  AppState.whatif.lastDiff = diff;
  wiRenderCards(diff);
  wiRenderDiffMap(diff);
  wiRenderGroupTable(diff);
  wiRenderHotspots(diff);
  wiRenderConflicts(diff);
}

function wiDeltaPill(delta, fmt) {
  const cls  = delta === 0 ? 'flat' : (delta > 0 ? 'up' : 'down');
  const sign = delta > 0 ? '+' : (delta < 0 ? '\u2212' : '\u00b1');
  return `<span class="wi-delta ${cls}">${sign}${fmt(Math.abs(delta))}</span>`;
}

function wiRenderCards(diff) {
  const host = document.getElementById('wi-cards');
  if (!host) return;
  const b = diff.base, s = diff.scen;
  const cards = [
    { title: 'Total Travel Time \u00b7 All Groups',
      before: b.totals.travelSec + b.totals.delaySec,
      after:  s.totals.travelSec + s.totals.delaySec, fmt: wiFmtSec },
    { title: 'Congestion Delay',
      before: b.totals.delaySec, after: s.totals.delaySec, fmt: wiFmtSec },
    { title: 'Peak Transition Load',
      // R59: loads are student-weighted — show ~students when any group has a
      // size, otherwise divide back to exact group counts (pre-R59 display).
      before: b.peak.load, after: s.peak.load,
      fmt: v => b.weighted
        ? `~${Math.round(v)} students`
        : (() => { const n = Math.round(v / (b.defaultGroupSize || 25)); return n + (n === 1 ? ' group' : ' groups'); })() },
    { title: 'Room Double-Bookings',
      before: b.conflicts.length, after: s.conflicts.length, fmt: v => String(v) },
  ];
  host.innerHTML = cards.map(c => {
    const d = c.after - c.before;
    return `<div class="wi-card">
      <div class="wi-card-title">${c.title}</div>
      <div class="wi-card-vals">${d !== 0 ? `<span class="wi-card-before">${c.fmt(c.before)}</span>` : ''}<span class="wi-card-after">${c.fmt(c.after)}</span></div>
      ${wiDeltaPill(d, c.fmt)}
    </div>`;
  }).join('');
}

/**
 * Red/blue congestion-delta map over the stacked floor blueprint.
 * Uses the export-canvas pattern: drawVizBlueprint() against an offscreen
 * canvas with ctx/vizCtx temporarily redirected inside try/finally, then
 * a per-cell delta overlay, then a DPR-aware scaled blit into #wi-diff-canvas.
 */
function wiRenderDiffMap(diff) {
  const canvas = document.getElementById('wi-diff-canvas');
  const wrap   = document.getElementById('wi-map-wrap');
  if (!canvas || !wrap) return;
  const cellSize = getEffectiveCellSize();
  const logicalW = maxFloorWidthPx();
  const logicalH = totalVizCanvasHeight();
  if (!logicalW || !logicalH) return;
  const floor0Id = AppState.blueprint.floors[0] && AppState.blueprint.floors[0].id;

  const off = document.createElement('canvas');
  off.width = logicalW; off.height = logicalH;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;

  const savedCtx = ctx, savedVizCtx = vizCtx;
  ctx = offCtx; vizCtx = offCtx;
  try {
    drawVizBlueprint();
  } finally {
    ctx = savedCtx; vizCtx = savedVizCtx;
  }

  // Soften the blueprint so the delta overlay reads clearly.
  offCtx.fillStyle = 'rgba(255,255,255,0.45)';
  offCtx.fillRect(0, 0, logicalW, logicalH);

  const maxAbs = Math.max(1, diff.maxAbs);
  for (const [k, d] of diff.deltas) {
    const { x, y, floorId } = parseKey(k);
    const offY = floorOffsetY(floorId || floor0Id);
    const px = x * cellSize, py = offY + y * cellSize;
    const a = 0.28 + 0.55 * (Math.abs(d) / maxAbs);
    offCtx.fillStyle = d > 0 ? `rgba(220,38,38,${a.toFixed(3)})` : `rgba(37,99,235,${a.toFixed(3)})`;
    offCtx.fillRect(px, py, cellSize, cellSize);
    offCtx.strokeStyle = d > 0 ? 'rgba(153,27,27,0.55)' : 'rgba(30,64,175,0.55)';
    offCtx.lineWidth = 1;
    offCtx.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1);
  }

  const availW = Math.max(280, wrap.clientWidth - 2 || 0);
  const scale  = Math.min(1, availW / logicalW);
  const dispW  = Math.max(1, Math.round(logicalW * scale));
  const dispH  = Math.max(1, Math.round(logicalH * scale));
  const dpr    = window.devicePixelRatio || 1;
  canvas.width = dispW * dpr; canvas.height = dispH * dpr;
  canvas.style.width = dispW + 'px'; canvas.style.height = dispH + 'px';
  const dctx = canvas.getContext('2d');
  if (!dctx) return;
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dctx.imageSmoothingEnabled = true;
  dctx.clearRect(0, 0, dispW, dispH);
  dctx.drawImage(off, 0, 0, dispW, dispH);

  AppState.whatif._mapLayout = { scale, cellSize };
}

function wiRenderGroupTable(diff) {
  const host = document.getElementById('wi-group-table-wrap');
  if (!host) return;
  const rows = diff.groupRows.slice().sort((a, b) =>
    Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  host.innerHTML =
    `<table class="wi-table"><thead><tr><th>Group</th><th style="text-align:right;">Before</th><th style="text-align:right;">After</th><th style="text-align:right;">&Delta;</th></tr></thead><tbody>` +
    rows.map(r => {
      const col  = r.delta > 0 ? '#b91c1c' : r.delta < 0 ? '#047857' : 'var(--slate-400)';
      const sign = r.delta > 0 ? '+' : r.delta < 0 ? '\u2212' : '\u00b1';
      return `<tr>
        <td><span class="wi-dot" style="background:${escHtml(r.color || '#64748b')};"></span>${escHtml(r.name)}${r.changed ? ' <span style="color:var(--warn);font-size:10px;font-weight:600;">&#9679; edited</span>' : ''}</td>
        <td class="num">${wiFmtSec(r.before)}</td>
        <td class="num">${wiFmtSec(r.after)}</td>
        <td class="num" style="color:${col};font-weight:600;">${sign}${wiFmtSec(Math.abs(r.delta))}</td>
      </tr>`;
    }).join('') + '</tbody></table>';
}

function wiRenderHotspots(diff) {
  const host = document.getElementById('wi-hotspots');
  if (!host) return;
  const entries = [...diff.deltas.entries()];
  if (!entries.length) {
    host.innerHTML = '<div class="wi-empty-note">No corridor-level changes \u2014 the scenario routes match the live schedule.</div>';
    return;
  }
  const worsened = entries.filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const improved = entries.filter(e => e[1] < 0).sort((a, b) => a[1] - b[1]).slice(0, 5);
  const item = (e) => {
    const k = e[0], d = e[1];
    const { x, y, floorId } = parseKey(k);
    const lbl = cellCongestionLabel(x, y, floorId);
    const floor = (AppState.blueprint.floors.find(f => f.id === floorId) || {}).label || '';
    const before = diff.baseMap.get(k) || 0, after = diff.scenMap.get(k) || 0;
    // R59: hotspot loads are student-weighted — display via the shared helper
    // ("~87 students" when sized, exact group counts otherwise).
    const wm = { weighted: diff.base.weighted, defaultGroupSize: diff.base.defaultGroupSize };
    const beforeTxt = congestionDisplayText(wm, before), afterTxt = congestionDisplayText(wm, after);
    const unit = diff.base.weighted ? ' students' : '';
    const col = d > 0 ? '#b91c1c' : '#047857';
    return `<div class="wi-hot-item"><span><b>${escHtml(lbl.label || 'Hallway')}</b>` +
      `${lbl.sub ? ` <span style="color:var(--slate-400);">\u00b7 ${escHtml(lbl.sub)}</span>` : ''}` +
      `${floor ? ` <span style="color:var(--slate-400);">\u00b7 ${escHtml(floor)}</span>` : ''}</span>` +
      `<span class="wi-hot-delta" style="color:${col};">${beforeTxt} \u2192 ${afterTxt}${unit}</span></div>`;
  };
  let html = '';
  if (worsened.length) html += '<div class="viz-section-label" style="margin-bottom:4px;">More crowded</div>' + worsened.map(item).join('');
  if (improved.length) html += `<div class="viz-section-label" style="margin:${worsened.length ? '12px' : '0'} 0 4px;">Less crowded</div>` + improved.map(item).join('');
  host.innerHTML = html;
}

function wiRenderConflicts(diff) {
  const host = document.getElementById('wi-conflicts');
  if (!host) return;
  const rows = [];
  const conflictLine = (tag, c) =>
    `<div class="wi-hot-item"><span><span class="wi-conflict-tag ${tag}">${tag === 'new' ? 'New' : 'Resolved'}</span>` +
    `${escHtml(c.modLabel)} \u00b7 Room <b style="font-family:var(--font-mono);">${escHtml(c.room)}</b> \u2014 ` +
    `${c.groupNames.map(escHtml).join(', ')}</span></div>`;
  diff.newConflicts.forEach(c => rows.push(conflictLine('new', c)));
  diff.resolvedConflicts.forEach(c => rows.push(conflictLine('resolved', c)));
  if (diff.persistingConflicts.length) {
    rows.push(`<div class="wi-hot-item"><span><span class="wi-conflict-tag existing">Existing</span>` +
      `${diff.persistingConflicts.length} pre-existing double-booking${diff.persistingConflicts.length === 1 ? '' : 's'} unaffected by this scenario</span></div>`);
  }
  const rb = diff.base.routingErrors + diff.base.unassigned;
  const rs = diff.scen.routingErrors + diff.scen.unassigned;
  if (rb !== rs) {
    rows.push(`<div class="wi-hot-item"><span><span class="wi-conflict-tag ${rs > rb ? 'new' : 'resolved'}">${rs > rb ? 'Warning' : 'Improved'}</span>` +
      `Routing issues (no path / unassigned mods): ${rb} \u2192 ${rs}</span></div>`);
  }
  host.innerHTML = rows.length
    ? rows.join('')
    : '<div class="wi-empty-note">No double-bookings or routing violations introduced by this scenario. \u2713</div>';
}

/* ── Map tooltip ─────────────────────────────────────────────── */
function wiOnMapMove(e) {
  const tip    = document.getElementById('wi-tooltip');
  const diff   = AppState.whatif.lastDiff;
  const layout = AppState.whatif._mapLayout;
  if (!tip || !diff || !layout || !layout.scale) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const lx = (e.clientX - rect.left) / layout.scale;
  const ly = (e.clientY - rect.top)  / layout.scale;
  const cellSize = layout.cellSize;

  let hit = null;
  for (const f of AppState.blueprint.floors) {
    const offY = floorOffsetY(f.id);
    if (ly >= offY && ly < offY + f.gridRows * cellSize) { hit = { f, offY }; break; }
  }
  if (!hit) { tip.style.display = 'none'; return; }
  const x = Math.floor(lx / cellSize);
  const y = Math.floor((ly - hit.offY) / cellSize);
  if (x < 0 || y < 0 || x >= hit.f.gridCols || y >= hit.f.gridRows) { tip.style.display = 'none'; return; }

  const k = floorCellKey(hit.f.id, x, y);
  const before = diff.baseMap.get(k) || 0;
  const after  = diff.scenMap.get(k) || 0;
  if (!before && !after) { tip.style.display = 'none'; return; }

  const lbl = cellCongestionLabel(x, y, hit.f.id);
  const d = after - before;
  const dTxt = d === 0 ? '\u00b10' : (d > 0 ? '+' + d : String(d));
  tip.innerHTML =
    `<div><b>${escHtml(lbl.label || 'Hallway')}</b>${lbl.sub ? ` <span class="tt-sub">\u00b7 ${escHtml(lbl.sub)}</span>` : ''}</div>` +
    `<div class="tt-sub">${escHtml(hit.f.label || '')} \u00b7 ${before} \u2192 ${after} group path${after === 1 ? '' : 's'} (${dTxt})</div>`;
  tip.style.display = 'block';
  tip.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
  tip.style.top  = (e.clientY + 14) + 'px';
}

function wiOnMapLeave() {
  const tip = document.getElementById('wi-tooltip');
  if (tip) tip.style.display = 'none';
}

/* ── Activation + init ───────────────────────────────────────── */
function onWhatIfTabActivated() {
  rebuildRoomRegistry();   // fresh room → cell map; graph self-validates via dirty flag
  wiPruneOverrides();      // schedules/blueprint may have changed underneath us
  wiPopulateGroupSelect();
  wiPopulateTransitionSelect();
  wiRenderModEditor();
  wiRenderChips();
  wiUpdateBadge();
  wiUpdateActionButtons();
  wiScheduleRender();
}

function initWhatIfModule() {
  loadWhatIf();
  wiUpdateBadge();

  document.querySelectorAll('.wi-day-btn').forEach(btn => btn.addEventListener('click', () => {
    const day = btn.dataset.wiDay === 'B' ? 'B' : 'A';
    if (day === AppState.whatif.day) return;
    AppState.whatif.day = day;
    document.querySelectorAll('.wi-day-btn').forEach(b => b.classList.toggle('active', b === btn));
    saveWhatIf();
    wiPruneOverrides();    // overrides are validated against the new day's baseline
    wiRenderModEditor();
    wiRenderChips();
    wiUpdateBadge();
    wiUpdateActionButtons();
    wiScheduleRender();
  }));
  // Reflect persisted day on the toggle.
  document.querySelectorAll('.wi-day-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.wiDay === 'B' ? 'B' : 'A') === AppState.whatif.day));

  const groupSel = document.getElementById('wi-group-select');
  if (groupSel) groupSel.addEventListener('change', e => {
    AppState.whatif.selectedGroupId = e.target.value || null;
    wiRenderModEditor();
  });

  const transSel = document.getElementById('wi-transition-select');
  if (transSel) transSel.addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    AppState.whatif.transitionFilter = Number.isFinite(v) && v >= 1 ? v : null;
    wiScheduleRender();
  });

  const applyBtn = document.getElementById('wi-apply-btn');
  if (applyBtn) applyBtn.addEventListener('click', wiApplyScenario);
  const resetBtn = document.getElementById('wi-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', wiResetScenario);

  const mapCanvas = document.getElementById('wi-diff-canvas');
  if (mapCanvas) {
    mapCanvas.addEventListener('mousemove', wiOnMapMove);
    mapCanvas.addEventListener('mouseleave', wiOnMapLeave);
  }

  // Re-fit the diff map when the window resizes while the tab is active.
  let _wiResizeTimer = null;
  window.addEventListener('resize', () => {
    if (AppState.ui.activeTab !== 'whatif') return;
    if (_wiResizeTimer) clearTimeout(_wiResizeTimer);
    _wiResizeTimer = setTimeout(() => {
      _wiResizeTimer = null;
      if (AppState.whatif.lastDiff) wiRenderDiffMap(AppState.whatif.lastDiff);
    }, 120);
  });
}

// Expose engine for console-driven analysis / external tooling.
window.wiComputeMetrics = wiComputeMetrics;
window.wiComputeDiff    = wiComputeDiff;
/* ═══ END ROUND 51 — WHAT-IF SCHEDULE LAB ═══ */
