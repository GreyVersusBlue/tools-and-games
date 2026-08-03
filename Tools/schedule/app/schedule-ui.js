/* schedule-ui.js — part of the School Layout Visualizer.
   Was lines 9240-11532 of Tools/schedule-visualizer.html. Cut out verbatim; the
   text below is byte-identical to what was inline, because the publish path
   puts br* function source into published files via Function.prototype.toString()
   and because the acorn equivalence check in schedule/test/structure.mjs
   compares this source against the original.

   Classic <script>, not a module. Top-level const/let bind in the shared
   global lexical scope, so declarations here are visible to every later file.
   LOAD ORDER IS SOURCE ORDER and must stay that way: the tool runs 31
   top-level statements, including DOM listener wiring that binds at parse time.
   See the <script src> list at the bottom of schedule-visualizer.html. */

/* ==============================================
   SETTINGS PANEL DOM BINDINGS
=============================================== */
const els = {
  schoolNameInput:  document.getElementById('setting-school-name'),
  modCountInput:    document.getElementById('setting-mod-count'),
  modCountRange:    document.getElementById('setting-mod-count-range'),
  modCountDisplay:  document.getElementById('mod-count-display'),
  modLabelSelect:   document.getElementById('setting-mod-label'),
  gridSizeRange:    document.getElementById('setting-grid-size-range'),
  gridSizeDisplay:  document.getElementById('grid-size-display'),
  tileWalkInput:    document.getElementById('setting-tile-walk-time'),        // R30
  tileWalkRange:    document.getElementById('setting-tile-walk-time-range'),  // R30
  tileWalkDisplay:  document.getElementById('tile-walk-time-display'),        // R30
  staircaseInput:   document.getElementById('setting-staircase-time'),        // R30
  staircaseRange:   document.getElementById('setting-staircase-time-range'),  // R30
  staircaseDisplay: document.getElementById('staircase-time-display'),        // R30
  defaultGroupSizeInput: document.getElementById('setting-default-group-size'), // R59
  modPreviewChips:  document.getElementById('mod-preview-chips'),
  headerSchoolName: document.getElementById('header-school-name'),
  headerModCount:   document.getElementById('header-mod-count'),
  lastSavedTime:    document.getElementById('last-saved-time'),
  btnSave:          document.getElementById('btn-save-settings'),
  btnReset:         document.getElementById('btn-reset-settings'),
};

function populateSettingsForm() {
  const s = AppState.settings;
  els.schoolNameInput.value       = s.schoolName;
  els.modCountInput.value         = s.modCount;
  els.modCountRange.value         = s.modCount;
  els.modCountDisplay.textContent = s.modCount;
  els.modLabelSelect.value        = s.modLabel;
  els.gridSizeRange.value         = s.gridSize;
  els.gridSizeDisplay.textContent = `${s.gridSize} px`;
  // R30: travel-time fields
  if (els.tileWalkInput) {
    const tw = (s.tileWalkTime != null) ? s.tileWalkTime : DEFAULT_SETTINGS.tileWalkTime;
    els.tileWalkInput.value       = tw;
    els.tileWalkRange.value       = tw;
    els.tileWalkDisplay.textContent = `${tw} sec`;
  }
  if (els.staircaseInput) {
    const st = (s.staircaseTime != null) ? s.staircaseTime : DEFAULT_SETTINGS.staircaseTime;
    els.staircaseInput.value       = st;
    els.staircaseRange.value       = st;
    els.staircaseDisplay.textContent = `${st} sec`;
  }
  els.lastSavedTime.textContent   = getLastSavedTime();

  // R59: default group size + bell schedule + subjects
  if (els.defaultGroupSizeInput) els.defaultGroupSizeInput.value = AppState.settings.defaultGroupSize ?? 25;
  renderBellScheduleEditor();
  renderSubjectsEditor();

  renderPaletteGrid(); // R38: refresh palette selector to match current setting

  const gcols = s.gridCols || 30;
  document.querySelectorAll('.grid-size-opt').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cols) === gcols);
  });

  renderModPreview();
}

function renderModPreview() {
  const labels = getAllModLabels();
  const show   = labels.slice(0, 6);
  const extra  = labels.length - show.length;
  els.modPreviewChips.innerHTML = show.map(l => `<span class="mod-chip">${l}</span>`).join('') +
    (extra > 0 ? `<span class="mod-chip" style="opacity:0.5">+${extra} more</span>` : '');
}

function syncHeader() {
  const s = AppState.settings;
  els.headerSchoolName.textContent = s.schoolName || DEFAULT_SETTINGS.schoolName;
  const footerSchool = document.getElementById('footer-school');
  if (footerSchool) footerSchool.textContent = s.schoolName || DEFAULT_SETTINGS.schoolName;
  const labelWord = s.modLabel === 'block' ? 'Blocks'
    : s.modLabel === 'period' ? 'Periods'
    : s.modLabel === 'hour'   ? 'Hours'
    : 'Mods';
  els.headerModCount.textContent = `${s.modCount} ${labelWord}/day`;
  /* Written from the constant so the version in the markup cannot drift away
     from the one stamped into published files. */
  const ver = document.getElementById('header-version');
  if (ver) ver.textContent = TOOL_VERSION;
}

els.schoolNameInput.addEventListener('input', () => {
  const v = els.schoolNameInput.value.trim() || DEFAULT_SETTINGS.schoolName;
  els.headerSchoolName.textContent = v;
  const footerSchool = document.getElementById('footer-school');
  if (footerSchool) footerSchool.textContent = v;
});

els.modCountRange.addEventListener('input', () => {
  const v = parseInt(els.modCountRange.value, 10);
  els.modCountInput.value         = v;
  els.modCountDisplay.textContent = v;
  AppState.settings.modCount      = v;
  renderBellScheduleEditor();   // R59: bell table resizes with the count, entries preserved
  syncHeader(); renderModPreview();
});

els.modCountInput.addEventListener('input', () => {
  let v = parseInt(els.modCountInput.value, 10);
  if (isNaN(v)) return;
  v = Math.max(1, Math.min(12, v));
  els.modCountRange.value         = v;
  els.modCountDisplay.textContent = v;
  AppState.settings.modCount      = v;
  renderBellScheduleEditor();   // R59
  syncHeader(); renderModPreview();
});

els.modLabelSelect.addEventListener('change', () => {
  AppState.settings.modLabel = els.modLabelSelect.value;
  renderBellScheduleEditor();   // R59: row labels follow the label style
  syncHeader(); renderModPreview();
});

els.gridSizeRange.addEventListener('input', () => {
  const v = parseInt(els.gridSizeRange.value, 10);
  els.gridSizeDisplay.textContent = `${v} px`;
  AppState.settings.gridSize = v;
  if (canvas) {
    const { gridCols, gridRows } = AppState.blueprint;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = gridCols * v * dpr;
    canvas.height = gridRows * v * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    applyZoom();
    renderCanvas();
  }
});

/* R30: Travel-time inputs — keep range + number in sync and update AppState live. */
function _r30ClampWalk(v) { v = parseFloat(v); if (isNaN(v)) return null; return Math.max(1, Math.min(10, Math.round(v * 2) / 2)); }
function _r30ClampStair(v) { v = parseInt(v, 10); if (isNaN(v)) return null; return Math.max(2, Math.min(30, v)); }
if (els.tileWalkRange) els.tileWalkRange.addEventListener('input', () => {
  const v = _r30ClampWalk(els.tileWalkRange.value); if (v == null) return;
  els.tileWalkInput.value = v; els.tileWalkDisplay.textContent = `${v} sec`;
  AppState.settings.tileWalkTime = v;
});
if (els.tileWalkInput) els.tileWalkInput.addEventListener('input', () => {
  const v = _r30ClampWalk(els.tileWalkInput.value); if (v == null) return;
  els.tileWalkRange.value = v; els.tileWalkDisplay.textContent = `${v} sec`;
  AppState.settings.tileWalkTime = v;
});
if (els.staircaseRange) els.staircaseRange.addEventListener('input', () => {
  const v = _r30ClampStair(els.staircaseRange.value); if (v == null) return;
  els.staircaseInput.value = v; els.staircaseDisplay.textContent = `${v} sec`;
  AppState.settings.staircaseTime = v;
});
if (els.staircaseInput) els.staircaseInput.addEventListener('input', () => {
  const v = _r30ClampStair(els.staircaseInput.value); if (v == null) return;
  els.staircaseRange.value = v; els.staircaseDisplay.textContent = `${v} sec`;
  AppState.settings.staircaseTime = v;
});

document.getElementById('grid-size-options').addEventListener('click', (e) => {
  const btn = e.target.closest('.grid-size-opt');
  if (!btn) return;
  const cols = parseInt(btn.dataset.cols, 10);
  const rows = parseInt(btn.dataset.rows, 10);

  const counts = AppState.blueprint.gridData ? getTileCounts() : { total: 0 };
  if (counts.total > 0) {
    if (!confirm(`Changing grid size will clear all ${counts.total} existing tiles. Continue?`)) return;
    saveSnapshot('Auto — before grid resize', 0); // R39: auto-snapshot slot 0
  }

  document.querySelectorAll('.grid-size-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  AppState.settings.gridCols = cols;
  AppState.settings.gridRows = rows;

  if (canvas) { resizeCanvas(cols, rows, true); showToast(`Grid resized to ${cols} × ${rows}.`, 'success'); }
});

els.btnSave.addEventListener('click', () => {
  AppState.settings.schoolName = els.schoolNameInput.value.trim() || DEFAULT_SETTINGS.schoolName;
  AppState.settings.modCount   = parseInt(els.modCountInput.value, 10) || DEFAULT_SETTINGS.modCount;
  AppState.settings.modLabel   = els.modLabelSelect.value;
  AppState.settings.gridSize   = parseInt(els.gridSizeRange.value, 10);
  // R30: persist travel-time settings
  {
    const tw = _r30ClampWalk(els.tileWalkInput ? els.tileWalkInput.value : DEFAULT_SETTINGS.tileWalkTime);
    const st = _r30ClampStair(els.staircaseInput ? els.staircaseInput.value : DEFAULT_SETTINGS.staircaseTime);
    AppState.settings.tileWalkTime  = (tw != null) ? tw : DEFAULT_SETTINGS.tileWalkTime;
    AppState.settings.staircaseTime = (st != null) ? st : DEFAULT_SETTINGS.staircaseTime;
  }
  // R59: default group size (bell schedule + subjects mutate AppState live)
  if (els.defaultGroupSizeInput) {
    const dgs = parseInt(els.defaultGroupSizeInput.value, 10);
    AppState.settings.defaultGroupSize = (Number.isFinite(dgs) && dgs >= 1 && dgs <= 999) ? dgs : DEFAULT_SETTINGS.defaultGroupSize;
    els.defaultGroupSizeInput.value = AppState.settings.defaultGroupSize;
  }
  saveSettings();
  saveLastSavedTime();
  syncHeader();
  renderModPreview();
  els.lastSavedTime.textContent = new Date().toLocaleTimeString();
  showToast('Settings saved successfully.', 'success');
  // If schedule editor is open, rebuild mod rows to reflect new count/label
  const schedForm = document.getElementById('sch-editor-form');
  if (schedForm && schedForm.style.display !== 'none') {
    const currentModsA = collectModAssignmentsForDay('A');
    const currentModsB = collectModAssignmentsForDay('B');
    buildModRows(currentModsA, currentModsB);
  }
});

els.btnReset.addEventListener('click', () => {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
  AppState.settings = normalizeSettings({ ...DEFAULT_SETTINGS });  // R59: normalize deep-clones bell/subject seeds
  applyTheme('default'); // R38: reset palette
  populateSettingsForm();
  syncHeader();
  saveSettings();
  saveLastSavedTime();
  if (canvas) resizeCanvas(DEFAULT_SETTINGS.gridCols, DEFAULT_SETTINGS.gridRows, false);
  showToast('Settings reset to defaults.', 'success');
});

/* ==============================================================
   ROUND 59 — BELL SCHEDULE EDITOR (Settings)
   ──────────────────────────────────────────────────────────────
   Lives directly beneath the mod-count control. Renders one
   start/end time row per mod for the active day tab; the B tab
   offers a "Same as A Day" checkbox that nulls B. Edits mutate
   AppState.settings.bellSchedule live (persisted by Save
   Settings, same contract as modCount). Validation is inline
   and non-blocking: end ≤ start flags red, overlaps flag amber.
=============================================================== */
let _bellActiveDay = 'A';

/** Materialize the stored day array (may be null / short) to modCount rows. */
function _bellDayRows(day) {
  const bs  = AppState.settings.bellSchedule || { A: null, B: null };
  const src = (day === 'B') ? bs.B : bs.A;
  const n   = AppState.settings.modCount || 8;
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = Array.isArray(src) ? src[i] : null;
    out.push(e && (e.start || e.end) ? { start: e.start || null, end: e.end || null } : null);
  }
  return out;
}

/** Write one field back into settings, creating the day array on demand. */
function _bellWrite(day, idx, field, value) {
  const bs = AppState.settings.bellSchedule || (AppState.settings.bellSchedule = { A: null, B: null });
  const key = (day === 'B') ? 'B' : 'A';
  if (!Array.isArray(bs[key])) bs[key] = _bellDayRows(key === 'B' ? 'A' : key).map(e => e ? { ...e } : null);
  const n = AppState.settings.modCount || 8;
  while (bs[key].length < n) bs[key].push(null);
  bs[key].length = Math.max(bs[key].length, n);
  const entry = bs[key][idx] || (bs[key][idx] = { start: null, end: null });
  entry[field] = value || null;
  if (!entry.start && !entry.end) bs[key][idx] = null;
}

function renderBellScheduleEditor() {
  const host = document.getElementById('bell-schedule-table');
  if (!host) return;
  const bs   = AppState.settings.bellSchedule || { A: null, B: null };
  const day  = _bellActiveDay;
  const sameWrap = document.getElementById('bell-same-as-a-wrap');
  const sameChk  = document.getElementById('bell-same-as-a');
  document.querySelectorAll('.bell-day-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.bellDay === day));

  if (sameWrap) sameWrap.style.display = (day === 'B') ? 'flex' : 'none';
  const bIsSame = !Array.isArray(bs.B);
  if (sameChk) sameChk.checked = bIsSame;

  if (day === 'B' && bIsSame) {
    host.innerHTML = `<div style="font-size:11.5px;color:var(--slate-400);padding:6px 0;">B Day uses the A Day times.</div>`;
    _bellValidate();
    return;
  }

  const labels = getAllModLabels();
  const rows   = _bellDayRows(day);
  host.innerHTML = `<table class="bell-table"><tbody>${rows.map((e, i) => `
    <tr data-bell-idx="${i}">
      <td class="bell-mod-label">${escHtml(labels[i] || ('Mod ' + (i + 1)))}</td>
      <td><input type="time" class="bell-time-input" data-field="start" value="${e && e.start ? escHtml(e.start) : ''}"/></td>
      <td style="color:var(--slate-300);">–</td>
      <td><input type="time" class="bell-time-input" data-field="end" value="${e && e.end ? escHtml(e.end) : ''}"/></td>
      <td class="bell-row-warn" data-bell-warn></td>
    </tr>`).join('')}</tbody></table>`;

  host.querySelectorAll('.bell-time-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr  = inp.closest('tr');
      const idx = parseInt(tr.dataset.bellIdx, 10);
      _bellWrite(day, idx, inp.dataset.field, inp.value);
      _bellValidate();
    });
  });
  _bellValidate();
}

/** Inline, non-blocking validation: end > start per row (red), and warn on
    overlaps between consecutive mods (amber). */
function _bellValidate() {
  const host = document.getElementById('bell-schedule-table');
  const warnEl = document.getElementById('bell-schedule-warn');
  if (!host) return;
  const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const rows = _bellDayRows(_bellActiveDay);
  const problems = [];
  host.querySelectorAll('tr[data-bell-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.bellIdx, 10);
    const e = rows[idx];
    const warn = tr.querySelector('[data-bell-warn]');
    const inputs = tr.querySelectorAll('.bell-time-input');
    inputs.forEach(i => i.classList.remove('bell-invalid', 'bell-overlap'));
    if (warn) { warn.textContent = ''; warn.classList.remove('overlap'); }
    if (!e) return;
    const s = toMin(e.start), en = toMin(e.end);
    if (s != null && en != null && en <= s) {
      inputs.forEach(i => i.classList.add('bell-invalid'));
      if (warn) warn.textContent = 'end ≤ start';
      problems.push('invalid');
      return;
    }
    const prev = idx > 0 ? rows[idx - 1] : null;
    const prevEnd = prev ? toMin(prev.end) : null;
    if (prevEnd != null && s != null && s < prevEnd) {
      inputs.forEach(i => i.classList.add('bell-overlap'));
      if (warn) { warn.textContent = 'overlaps prior'; warn.classList.add('overlap'); }
      problems.push('overlap');
    }
  });
  if (warnEl) {
    const hasOverlap = problems.includes('overlap');
    warnEl.style.display = hasOverlap ? '' : 'none';
    warnEl.textContent = hasOverlap ? '⚠ Some periods overlap — allowed, but transition windows may look odd.' : '';
  }
}

function initBellScheduleEditor() {
  document.querySelectorAll('.bell-day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _bellActiveDay = tab.dataset.bellDay === 'B' ? 'B' : 'A';
      renderBellScheduleEditor();
    });
  });
  document.getElementById('bell-same-as-a')?.addEventListener('change', (e) => {
    const bs = AppState.settings.bellSchedule || (AppState.settings.bellSchedule = { A: null, B: null });
    if (e.target.checked) {
      bs.B = null;                                             // null = same as A
    } else {
      bs.B = _bellDayRows('A').map(en => en ? { ...en } : null); // fork a copy of A
    }
    renderBellScheduleEditor();
  });
}
initBellScheduleEditor();

/* ==============================================================
   ROUND 59 — SUBJECTS EDITOR (Settings)
   ──────────────────────────────────────────────────────────────
   Add / rename / recolor / reorder / delete the subject list in
   settings.subjects. Codes are fixed after creation (they are
   the identity classroom tiles reference). Deleting a subject a
   classroom still uses shows a protection warning first.
=============================================================== */
function _subjectCodeUsage(code) {
  let n = 0;
  for (const floor of AppState.blueprint.floors || []) {
    if (!floor.gridData) continue;
    const seenGroups = new Set();
    for (let r = 0; r < floor.gridRows; r++) {
      for (let c = 0; c < floor.gridCols; c++) {
        const t = floor.gridData[r] && floor.gridData[r][c];
        if (!t || t.type !== 'classroom' || t.dept !== code) continue;
        if (t.groupId) { if (seenGroups.has(t.groupId)) continue; seenGroups.add(t.groupId); }
        n++;
      }
    }
  }
  return n;
}

function renderSubjectsEditor() {
  const host = document.getElementById('subjects-list');
  if (!host) return;
  const subjects = getSubjects();
  host.innerHTML = subjects.map((s, i) => {
    const used = _subjectCodeUsage(s.code);
    return `
    <div class="subject-row" draggable="true" data-subject-idx="${i}">
      <span class="subject-grip" title="Drag to reorder">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      </span>
      <span class="subject-code" title="${escHtml(s.code)}">${escHtml(s.code)}</span>
      <input type="text" class="subject-name-input" value="${escHtml(s.name)}" maxlength="40"/>
      ${used > 0 ? `<span class="subject-inuse-badge">${used} room${used === 1 ? '' : 's'}</span>` : ''}
      <span class="subject-color-dot" style="background:${escHtml(s.color)};" title="Change color">
        <input type="color" value="${escHtml(s.color)}"/>
      </span>
      <button class="subject-del-btn" title="Delete subject">
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('') || `<div style="font-size:12px;color:var(--slate-400);">No subjects yet — add one below.</div>`;

  // Rename / recolor / delete wiring
  host.querySelectorAll('.subject-row').forEach(row => {
    const idx = parseInt(row.dataset.subjectIdx, 10);
    row.querySelector('.subject-name-input')?.addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) getSubjects()[idx].name = v; else e.target.value = getSubjects()[idx].name;
      _subjectsChanged();
    });
    row.querySelector('.subject-color-dot input[type=color]')?.addEventListener('input', (e) => {
      getSubjects()[idx].color = e.target.value;
      row.querySelector('.subject-color-dot').style.background = e.target.value;
      _subjectsChanged(true);   // color-only: skip full re-render so the picker stays open
    });
    row.querySelector('.subject-del-btn')?.addEventListener('click', () => {
      const s = getSubjects()[idx];
      const used = _subjectCodeUsage(s.code);
      const msg = used > 0
        ? `"${s.name}" (${s.code}) is assigned to ${used} classroom${used === 1 ? '' : 's'}.\n\nDeleting it will leave those rooms with an unknown subject code (they keep working, with a neutral color).\n\nDelete anyway?`
        : `Delete subject "${s.name}" (${s.code})?`;
      if (!confirm(msg)) return;
      getSubjects().splice(idx, 1);
      _subjectsChanged();
    });
    // Drag-to-reorder
    row.addEventListener('dragstart', (e) => {
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (!Number.isFinite(from) || from === idx) return;
      const list = getSubjects();
      const [moved] = list.splice(from, 1);
      list.splice(idx, 0, moved);
      _subjectsChanged();
    });
  });
}

/** Propagate subject edits to every consumer, then persist. */
function _subjectsChanged(skipRerender) {
  saveSettings();
  if (!skipRerender) renderSubjectsEditor();
  populateDeptDropdown();                      // classroom editor select
  if (typeof brSyncDeptFromSettings === 'function') brSyncDeptFromSettings();  // Schedule Browser palette
}

function initSubjectsEditor() {
  document.getElementById('btn-add-subject')?.addEventListener('click', () => {
    const codeEl  = document.getElementById('subject-new-code');
    const nameEl  = document.getElementById('subject-new-name');
    const colorEl = document.getElementById('subject-new-color');
    const code = (codeEl?.value || '').trim().toUpperCase();
    if (!code) { showToast('Enter a subject code (e.g. ART).', 'warn'); return; }
    if (getSubjects().some(s => s.code === code)) { showToast(`Subject code "${code}" already exists.`, 'warn'); return; }
    const name = (nameEl?.value || '').trim() || code;
    getSubjects().push({ code, name, color: colorEl?.value || '#64748b' });
    if (codeEl) codeEl.value = '';
    if (nameEl) nameEl.value = '';
    _subjectsChanged();
    showToast(`Subject "${name}" added.`, 'success');
  });
}
initSubjectsEditor();

/** R59: (re)populate the classroom editor's Department dropdown from
    settings.subjects, preserving the current value even if its code is no
    longer in the list (shown as an "unknown" option so data isn't lost). */
function populateDeptDropdown(currentValue) {
  const sel = document.getElementById('rp-teacher-dept');
  if (!sel) return;
  const keep = (currentValue !== undefined) ? currentValue : sel.value;
  const subjects = getSubjects();
  let html = '<option value="">— None —</option>' +
    subjects.map(s => `<option value="${escHtml(s.code)}">${escHtml(s.name)}</option>`).join('');
  if (keep && !subjects.some(s => s.code === keep)) {
    html += `<option value="${escHtml(keep)}">${escHtml(keep)} (unknown subject)</option>`;
  }
  sel.innerHTML = html;
  sel.value = keep || '';
}
populateDeptDropdown();

/* ==============================================
   TAB NAVIGATION
=============================================== */
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels  = document.querySelectorAll('.tab-panel');

function switchTab(tabId) {
  AppState.ui.activeTab = tabId;
  tabButtons.forEach(btn => {
    const on = btn.dataset.tab === tabId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  });
  tabPanels.forEach(p  => p.classList.toggle('active', p.id === `panel-${tabId}`));
  if (tabId === 'blueprint' && canvas) applyZoom();
  // When switching to the Visualize tab, refresh controls and (re)draw.
  if (tabId === 'visualize') {
    onVizTabActivated();
  }
  // When switching to schedules, refresh mod rows (mod count may have changed in Settings)
  if (tabId === 'schedules') {
    const form = document.getElementById('sch-editor-form');
    if (form && form.style.display !== 'none') {
      const currentModsA = collectModAssignmentsForDay('A');
      const currentModsB = collectModAssignmentsForDay('B');
      buildModRows(currentModsA, currentModsB);
    }
  }
  // Round 51: What-If Lab — refresh sandbox controls and recompute the diff.
  if (tabId === 'whatif') {
    onWhatIfTabActivated();
  }
}

tabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// Keyboard navigation for the tab interface (ARIA tablist pattern):
// Left/Right arrows move between tabs, Home/End jump to ends.
const tabOrder = ['blueprint', 'schedules', 'visualize', 'whatif', 'settings'];
document.getElementById('tab-bar').addEventListener('keydown', (e) => {
  const current = AppState.ui.activeTab;
  let idx = tabOrder.indexOf(current);
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabOrder[(idx + 1) % tabOrder.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length];
  else if (e.key === 'Home') next = tabOrder[0];
  else if (e.key === 'End') next = tabOrder[tabOrder.length - 1];
  if (next) {
    e.preventDefault();
    switchTab(next);
    const btn = document.querySelector(`.tab-btn[data-tab="${next}"]`);
    if (btn) btn.focus();
  }
});

/* ==============================================
   TOAST NOTIFICATIONS
=============================================== */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const icons = {
    success: `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    warn:    `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`,
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3100);
}

/* ==============================================
   SCHEDULES MODULE — Data & Storage
=============================================== */

/* R39: Compute room double-booking conflicts for a given day ('A' or 'B').
   Returns array of { mod (1-based), modLabel, room, groupNames[] } */
function computeScheduleConflicts(day) {
  // Build a fast lookup set of rooms excluded from conflict detection
  const excludedRooms = new Set(
    roomRegistry.filter(r => r.excludeFromConflict).map(r => r.roomNumber)
  );

  const labels = getAllModLabels();
  const map = new Map(); // key `${modIndex}-${room}` → [groupName, ...]
  for (const group of AppState.schedules.groups) {
    const mods = day === 'B'
      ? (group.modsB || [])
      : (group.modsA || group.mods || []);
    mods.forEach((room, idx) => {
      if (!room || room === '') return;
      if (excludedRooms.has(room)) return; // skip rooms flagged as excluded
      const key = `${idx}-${room}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group.name);
    });
  }
  const conflicts = [];
  for (const [key, names] of map) {
    if (names.length < 2) continue;
    const [idxStr, ...roomParts] = key.split('-');
    const idx  = parseInt(idxStr, 10);
    const room = roomParts.join('-');
    conflicts.push({
      mod:      idx + 1,
      modLabel: labels[idx] || `Mod ${idx + 1}`,
      room,
      groupNames: names,
    });
  }
  conflicts.sort((a, b) => a.mod - b.mod);
  return conflicts;
}

/* R39: Render conflict banner above group list */
function renderConflictBanner() {
  const banner   = document.getElementById('sch-conflict-banner');
  const countEl  = document.getElementById('sch-conflict-count');
  const tbody    = document.getElementById('sch-conflict-tbody');
  const header   = document.getElementById('sch-conflict-banner-header');
  const tableWrap = document.getElementById('sch-conflict-table-wrap');
  if (!banner || !countEl || !tbody) return;

  // Check both days
  const day = AppState.schedules.activeDayTab || 'A';
  const conflicts = computeScheduleConflicts(day);

  if (conflicts.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = '';
  countEl.textContent = conflicts.length;
  tbody.innerHTML = conflicts.map(c =>
    `<tr><td>${escHtml(c.modLabel)}</td><td style="font-family:var(--font-mono);font-weight:600;">${escHtml(c.room)}</td><td>${c.groupNames.map(escHtml).join(', ')}</td></tr>`
  ).join('');

  // Wire toggle only once
  if (!header.dataset.conflictWired) {
    header.dataset.conflictWired = '1';
    header.addEventListener('click', () => {
      const isOpen = tableWrap.classList.toggle('open');
      header.classList.toggle('open', isOpen);
    });
  }
}

/* Set of group IDs that have conflicts — built by renderConflictBanner */
function getConflictGroupIds(day) {
  const conflicts = computeScheduleConflicts(day);
  const ids = new Set();
  for (const conflict of conflicts) {
    for (const group of AppState.schedules.groups) {
      const mods = day === 'B'
        ? (group.modsB || [])
        : (group.modsA || group.mods || []);
      if (mods[conflict.mod - 1] === conflict.room) ids.add(group.id);
    }
  }
  return ids;
}

// Preset group colors
const GROUP_COLOR_PRESETS = [
  '#3b82f6','#ef4444','#10b981','#f59e0b',
  '#8b5cf6','#ec4899','#06b6d4','#f97316',
  '#14b8a6','#6366f1','#84cc16','#a855f7',
];

// Auto-assign next unused preset color
function getNextGroupColor() {
  const used = new Set(AppState.schedules.groups.map(g => g.color));
  for (const c of GROUP_COLOR_PRESETS) {
    if (!used.has(c)) return c;
  }
  // All used — generate a hue-spaced color
  const hue = (AppState.schedules.groups.length * 47) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// Generate a unique group ID
function generateGroupId() {
  return 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveSchedules() {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(AppState.schedules.groups));
  } catch(e) { console.warn('[STVIZ] Could not save schedules:', e); }
}

function loadSchedules() {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    if (!raw) return;
    const groups = JSON.parse(raw);
    if (Array.isArray(groups)) AppState.schedules.groups = groups;
  } catch(e) { console.warn('[STVIZ] Could not load schedules:', e); }
}

/* Called by rebuildRoomRegistry so dropdowns stay fresh */
function scheduleModuleOnRoomRegistryUpdate() {
  // If the editor is open, refresh its room dropdowns
  const form = document.getElementById('sch-editor-form');
  if (form && form.style.display !== 'none') {
    rebuildModDropdowns();
  }
  // Re-render group list (shows missing room warnings when blueprint changes)
  renderGroupList();
}

/* ==============================================
   SCHEDULES MODULE — Rendering
=============================================== */

function renderGroupList(filterQuery) {
  const groups = AppState.schedules.groups;
  const listEl = document.getElementById('sch-group-list');
  const countEl = document.getElementById('sch-group-count');
  const badge  = document.getElementById('badge-groups');

  if (countEl) countEl.textContent = groups.length;
  if (badge)   badge.textContent   = groups.length;

  // R39: update conflict banner on every render
  renderConflictBanner();

  if (!listEl) return;

  const query = (filterQuery !== undefined ? filterQuery : AppState.schedules.searchQuery || '').toLowerCase().trim();

  const filtered = query
    ? groups.filter(g =>
        g.name.toLowerCase().includes(query) ||
        (g.grade !== null && g.grade !== undefined && String(g.grade).includes(query))
      )
    : groups;

  if (groups.length === 0) {
    listEl.innerHTML = `
      <div class="sch-list-empty">
        <div class="sch-list-empty-icon">
          <svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div class="sch-list-empty-title">No groups yet</div>
        <div class="sch-list-empty-desc">Click <strong>New Group</strong> above to create your first student group.</div>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="sch-search-no-results">
        <strong>No results found</strong>
        No groups match "${escHtml(query)}". Try a different name or grade.
      </div>`;
    return;
  }

  const editingId = AppState.schedules.editingGroupId;
  // R39: compute conflict group IDs once for this render pass
  const day = AppState.schedules.activeDayTab || 'A';
  const conflictGroupIds = getConflictGroupIds(day);

  const html = filtered.map(group => {
    const isActive  = group.id === editingId;
    const hasConflict = conflictGroupIds.has(group.id);
    const total     = AppState.settings.modCount;
    const modsA     = group.modsA || group.mods || [];
    const modsB     = group.modsB || [];
    const assignedA = modsA.filter(r => r && r !== '').length;
    const assignedB = modsB.filter(r => r && r !== '').length;
    const hasBDay   = modsB.some(r => r && r !== '');

    // Check for missing rooms
    const missingRooms = [...modsA, ...modsB].filter(r => r && r !== '' && !roomRegistry.some(reg => reg.roomNumber === r));
    const hasMissing = missingRooms.length > 0;

    const pct = total > 0 ? Math.round((assignedA / total) * 100) : 0;
    const progressClass = assignedA === total ? 'complete' : assignedA === 0 ? 'empty' : 'partial';
    const badgeClass = assignedA === total ? 'complete' : assignedA === 0 ? 'none' : 'partial';
    const badgeText = assignedA === 0 ? 'None assigned' : assignedA === total ? 'Complete' : `${assignedA}/${total}`;

    const gradeStr = group.grade ? `Grade ${group.grade}` : 'No grade';

    const warnIcon = hasMissing ? `
      <span class="group-card-warn-icon" title="Some rooms assigned to this group no longer exist in the blueprint">
        <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>` : '';

    // R39: amber conflict icon
    const conflictIcon = hasConflict ? `
      <span class="group-card-warn-icon conflict" title="This group shares a room with another group in the same mod">
        <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>` : '';

    const bDayBadge = hasBDay
      ? `<span style="background:#ede9fe;color:#5b21b6;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;font-family:var(--font-mono);">A+B</span>`
      : `<span style="background:var(--slate-100);color:var(--slate-400);font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;font-family:var(--font-mono);">A only</span>`;

    return `
    <div class="group-card${isActive ? ' active' : ''}${hasConflict ? ' has-conflict' : ''}" data-group-id="${group.id}">
      <div class="group-card-top">
        <div class="group-color-swatch" style="background:${escHtml(group.color)};"></div>
        <div class="group-card-info">
          <div class="group-card-name">${escHtml(group.name)}${warnIcon}${conflictIcon}</div>
          <div class="group-card-meta">
            <span class="group-card-grade">${escHtml(gradeStr)}</span>
            ${bDayBadge}
          </div>
        </div>
      </div>
      <div class="group-card-progress">
        <div class="group-progress-bar-track">
          <div class="group-progress-bar-fill ${progressClass}" style="width:${pct}%;"></div>
        </div>
        <div class="group-progress-label">
          <span class="group-progress-text">A: ${assignedA}/${total}${hasBDay ? ` · B: ${assignedB}/${total}` : ''}</span>
          <span class="group-progress-badge ${badgeClass}">${badgeText}</span>
        </div>
      </div>
      <div class="group-card-actions">
        <button class="group-card-btn edit" data-action="edit" data-group-id="${group.id}">Edit</button>
        <button class="group-card-btn duplicate" data-action="duplicate" data-group-id="${group.id}">Copy</button>
        <button class="group-card-btn delete" data-action="delete" data-group-id="${group.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  listEl.innerHTML = html;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ==============================================
   SCHEDULES MODULE — Editor
=============================================== */

function openEditorForNew() {
  AppState.schedules.editingGroupId = null;
  AppState.schedules.activeDayTab = 'A';
  renderGroupList();

  const modeLabel = document.getElementById('sch-editor-mode-label');
  const title     = document.getElementById('sch-editor-title');
  if (modeLabel) { modeLabel.textContent = 'New Group'; modeLabel.className = 'sch-editor-mode-label'; }
  if (title)     title.textContent = 'Create Group';

  const nameInput  = document.getElementById('sch-input-name');
  const gradeInput = document.getElementById('sch-input-grade');
  const colorInput = document.getElementById('sch-input-color');
  const sizeInput  = document.getElementById('sch-input-size');   // R59
  const nextColor  = getNextGroupColor();
  if (nameInput)  { nameInput.value = ''; nameInput.classList.remove('error'); }
  if (gradeInput) gradeInput.value = '';
  if (colorInput) colorInput.value = nextColor;
  if (sizeInput)  sizeInput.value = '';   // R59

  updateGradeBtnGroup(null);
  updateColorPresetSelection(nextColor);
  document.getElementById('sch-color-custom-btn')?.classList.remove('selected');
  setActiveDayTab('A');
  buildModRows(null, null);
  showEditorForm();
  if (nameInput) nameInput.focus();
}

function openEditorForEdit(groupId) {
  const group = AppState.schedules.groups.find(g => g.id === groupId);
  if (!group) return;

  AppState.schedules.editingGroupId = groupId;
  AppState.schedules.activeDayTab = 'A';
  renderGroupList();

  const modeLabel = document.getElementById('sch-editor-mode-label');
  const title     = document.getElementById('sch-editor-title');
  if (modeLabel) { modeLabel.textContent = 'Editing'; modeLabel.className = 'sch-editor-mode-label editing'; }
  if (title)     title.textContent = group.name;

  const nameInput  = document.getElementById('sch-input-name');
  const gradeInput = document.getElementById('sch-input-grade');
  const colorInput = document.getElementById('sch-input-color');
  const sizeInput  = document.getElementById('sch-input-size');   // R59
  const col = group.color || '#3b82f6';
  if (nameInput)  { nameInput.value = group.name; nameInput.classList.remove('error'); }
  if (gradeInput) gradeInput.value = group.grade ?? '';
  if (colorInput) colorInput.value = col;
  if (sizeInput)  sizeInput.value = (Number.isFinite(Number(group.size)) && Number(group.size) > 0) ? group.size : '';   // R59

  // updateGradeBtnGroup handles the "other" case — non-6/7/8 grades show the text input
  updateGradeBtnGroup(group.grade ?? null);
  updateColorPresetSelection(col);
  const isPreset = GROUP_COLOR_PRESETS.includes(col);
  document.getElementById('sch-color-custom-btn')?.classList.toggle('selected', !isPreset);

  setActiveDayTab('A');
  const modsA = group.modsA || group.mods || [];
  const modsB = group.modsB || [];
  buildModRows(modsA, modsB);
  showEditorForm();
}

function showEditorForm() {
  document.getElementById('sch-editor-idle').style.display = 'none';
  document.getElementById('sch-editor-form').style.display = 'flex';
  clearFormError();
}

function hideEditorForm() {
  document.getElementById('sch-editor-idle').style.display = '';
  document.getElementById('sch-editor-form').style.display = 'none';
  AppState.schedules.editingGroupId = null;
  renderGroupList();
}

/* Build the color preset swatches */
function buildColorPresets() {
  const container = document.getElementById('sch-color-presets');
  if (!container) return;
  container.innerHTML = GROUP_COLOR_PRESETS.map(c =>
    `<div class="sch-color-preset" style="background:${c};" data-color="${c}" title="${c}"></div>`
  ).join('');
  container.addEventListener('click', e => {
    const preset = e.target.closest('.sch-color-preset');
    if (!preset) return;
    const color = preset.dataset.color;
    const colorInput = document.getElementById('sch-input-color');
    if (colorInput) colorInput.value = color;
    updateColorPresetSelection(color);
    // Deselect custom btn
    document.getElementById('sch-color-custom-btn')?.classList.remove('selected');
  });
}

function updateColorPresetSelection(color) {
  document.querySelectorAll('.sch-color-preset').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === color);
  });
}

/* No-op stubs for removed helpers — keep callers from erroring */
function updateColorSwatchPreview() {}

/* Grade button group */
function updateGradeBtnGroup(grade) {
  const knownGrades = ['6', '7', '8'];
  const gradeStr = (grade !== null && grade !== '') ? String(grade) : '';
  const isKnown = knownGrades.includes(gradeStr);
  const isOther = gradeStr !== '' && !isKnown;

  document.querySelectorAll('.sch-grade-btn').forEach(btn => {
    if (btn.dataset.grade === 'other') {
      btn.classList.toggle('active', isOther);
    } else {
      btn.classList.toggle('active', isKnown && btn.dataset.grade === gradeStr);
    }
  });
  const hidden = document.getElementById('sch-input-grade');
  if (hidden) hidden.value = gradeStr;

  const otherInput = document.getElementById('sch-input-grade-other');
  if (otherInput) {
    if (isOther) {
      otherInput.style.display = '';
      otherInput.value = gradeStr;
    } else {
      otherInput.style.display = 'none';
      otherInput.value = '';
    }
  }
}

/* A/B Day: both columns are always visible — no tab switching needed */
function setActiveDayTab() { /* no-op: side-by-side layout, no tabs */ }

/* Collect mod assignments for a given day panel */
function collectModAssignmentsForDay(day) {
  const tbodyId = `sch-mod-tbody-${day}`;
  const selects = document.querySelectorAll(`#${tbodyId} .sch-mod-room-select`);
  return Array.from(selects).map(s => s.value);
}

/* Build the mod rows in the schedule table for both A and B days */
function buildModRows(existingModsA, existingModsB) {
  const countNote     = document.getElementById('sch-mod-count-note');
  const noRoomsWarn   = document.getElementById('sch-no-rooms-warn');
  const mismatchWarn  = document.getElementById('sch-mod-mismatch-warn');
  const mismatchText  = document.getElementById('sch-mod-mismatch-text');

  const modCount  = AppState.settings.modCount;
  const modStyle  = AppState.settings.modLabel;
  const rooms     = roomRegistry;

  if (countNote) countNote.textContent = `${modCount} periods per day`;
  if (noRoomsWarn) noRoomsWarn.style.display = rooms.length === 0 ? '' : 'none';

  // Mismatch warning based on A day (primary)
  if (mismatchWarn && mismatchText && existingModsA !== null && existingModsA !== undefined) {
    const prevCount = (existingModsA || []).length;
    if (prevCount > 0 && prevCount !== modCount) {
      mismatchWarn.style.display = '';
      if (prevCount < modCount) {
        mismatchText.textContent = `The global period count increased from ${prevCount} to ${modCount}. New rows have been added — please assign rooms.`;
      } else {
        mismatchText.textContent = `The global period count decreased from ${prevCount} to ${modCount}. The last ${prevCount - modCount} assignment${prevCount - modCount !== 1 ? 's were' : ' was'} removed.`;
      }
    } else {
      mismatchWarn.style.display = 'none';
    }
  } else if (mismatchWarn) {
    mismatchWarn.style.display = 'none';
  }

  buildDayModRows('A', existingModsA, modCount, modStyle, rooms);
  buildDayModRows('B', existingModsB, modCount, modStyle, rooms);
}

function buildDayModRows(day, existingMods, modCount, modStyle, rooms) {
  const tbody = document.getElementById(`sch-mod-tbody-${day}`);
  if (!tbody) return;

  tbody.innerHTML = '';
  for (let i = 1; i <= modCount; i++) {
    const label       = modLabel(i, modStyle);
    const modTime     = formatModTime(day, i - 1);   // R59: bell schedule display
    const existingVal = existingMods ? (existingMods[i - 1] || '') : '';
    const isMissing   = existingVal && !rooms.some(r => r.roomNumber === existingVal);

    const tr = document.createElement('tr');
    tr.className = 'sch-mod-row';
    tr.dataset.modIndex = i - 1;
    tr.draggable = true;

    const missingOpt = isMissing
      ? `<option value="${escHtml(existingVal)}" selected disabled style="color:var(--warn);">⚠ ${escHtml(existingVal)} (not in blueprint)</option>`
      : '';

    const missingNote = isMissing
      ? `<span class="sch-mod-room-warn" title="Room '${escHtml(existingVal)}' no longer exists in the blueprint">
           <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
             <line x1="12" y1="9" x2="12" y2="13"/>
           </svg>Missing: ${escHtml(existingVal)}
         </span>`
      : '';

    tr.innerHTML = `
      <td class="sch-mod-grip-cell">
        <div class="sch-mod-grip" title="Drag to reorder">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </div>
      </td>
      <td class="sch-mod-label-cell">
        <span class="sch-mod-label">${escHtml(label)}</span>
        ${modTime ? `<div style="font-family:var(--font-mono);font-size:9.5px;color:var(--slate-400);margin-top:2px;">${escHtml(modTime)}</div>` : ''}
      </td>
      <td>
        <select class="sch-mod-room-select${existingVal && !isMissing ? ' assigned' : ''}${isMissing ? ' missing' : ''}" data-mod-index="${i - 1}">
          <option value="">— Unassigned —</option>
          ${missingOpt}
          ${rooms.map(r => `<option value="${escHtml(r.roomNumber)}"${r.roomNumber === existingVal ? ' selected' : ''}>${escHtml(r.roomNumber)}${r.teacherName ? ' — ' + escHtml(r.teacherName) : ''}</option>`).join('')}
        </select>
        ${missingNote}
      </td>`;
    tbody.appendChild(tr);
  }

  // Select change → assigned class
  tbody.querySelectorAll('.sch-mod-room-select').forEach(sel => {
    sel.addEventListener('change', () => sel.classList.toggle('assigned', sel.value !== ''));
  });

  // Drag-to-reorder
  initModRowDrag(tbody);
}

let _dragSrcRow = null;
let _dragSrcTbody = null;

function initModRowDrag(tbody) {
  tbody.addEventListener('dragstart', e => {
    const row = e.target.closest('.sch-mod-row');
    if (!row) return;
    _dragSrcRow = row;
    _dragSrcTbody = tbody;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  tbody.addEventListener('dragend', e => {
    const row = e.target.closest('.sch-mod-row');
    if (row) row.classList.remove('dragging');
    tbody.querySelectorAll('.sch-mod-row').forEach(r => {
      r.classList.remove('drag-over-above', 'drag-over-below');
    });
    _dragSrcRow = null;
    _dragSrcTbody = null;
    // Renumber labels after drop
    renumberModRows(tbody);
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.sch-mod-row');
    if (!target || target === _dragSrcRow) return;
    tbody.querySelectorAll('.sch-mod-row').forEach(r => r.classList.remove('drag-over-above', 'drag-over-below'));
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    target.classList.add(e.clientY < mid ? 'drag-over-above' : 'drag-over-below');
    e.dataTransfer.dropEffect = 'move';
  });

  tbody.addEventListener('dragleave', e => {
    const row = e.target.closest('.sch-mod-row');
    if (row) { row.classList.remove('drag-over-above', 'drag-over-below'); }
  });

  tbody.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.sch-mod-row');
    if (!target || target === _dragSrcRow || !_dragSrcRow) return;
    const isAbove = target.classList.contains('drag-over-above');
    target.classList.remove('drag-over-above', 'drag-over-below');
    if (isAbove) {
      tbody.insertBefore(_dragSrcRow, target);
    } else {
      tbody.insertBefore(_dragSrcRow, target.nextSibling);
    }
    renumberModRows(tbody);
  });
}

function renumberModRows(tbody) {
  const modStyle = AppState.settings.modLabel;
  const rows = tbody.querySelectorAll('.sch-mod-row');
  rows.forEach((row, idx) => {
    row.dataset.modIndex = idx;
    const labelEl = row.querySelector('.sch-mod-label');
    const sel = row.querySelector('.sch-mod-room-select');
    if (labelEl) labelEl.textContent = modLabel(idx + 1, modStyle);
    if (sel) sel.dataset.modIndex = idx;
  });
}

/* Rebuild dropdowns in-place when rooms change without closing the editor */
function rebuildModDropdowns() {
  const rooms = roomRegistry;
  const noRoomsWarn = document.getElementById('sch-no-rooms-warn');
  if (noRoomsWarn) noRoomsWarn.style.display = rooms.length === 0 ? '' : 'none';

  ['A', 'B'].forEach(day => {
    const tbody = document.getElementById(`sch-mod-tbody-${day}`);
    if (!tbody) return;
    tbody.querySelectorAll('.sch-mod-room-select').forEach(sel => {
      const currentVal = sel.value;
      const newOpts    = rooms.map(r =>
        `<option value="${escHtml(r.roomNumber)}"${r.roomNumber === currentVal ? ' selected' : ''}>${escHtml(r.roomNumber)}${r.teacherName ? ' — ' + escHtml(r.teacherName) : ''}</option>`
      ).join('');
      sel.innerHTML = '<option value="">— Unassigned —</option>' + newOpts;
      sel.value = currentVal;
      sel.classList.toggle('assigned', sel.value !== '');
    });
  });
}

/* ==============================================
   SCHEDULES MODULE — Save / Validate
=============================================== */

function collectModAssignments() {
  return collectModAssignmentsForDay('A');
}

function validateGroupForm() {
  const name = (document.getElementById('sch-input-name')?.value || '').trim();
  if (!name) {
    showFormError('Group name is required.');
    document.getElementById('sch-input-name')?.classList.add('error');
    return null;
  }

  // Check for duplicate name (excluding the currently-editing group)
  const editingId = AppState.schedules.editingGroupId;
  const duplicate = AppState.schedules.groups.some(g => g.id !== editingId && g.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showFormError(`A group named "${name}" already exists.`);
    document.getElementById('sch-input-name')?.classList.add('error');
    return null;
  }

  // Resolve grade: if "other" button is active, read from the text input
  let grade = document.getElementById('sch-input-grade')?.value.trim() || '';
  const activeGradeBtn = document.querySelector('.sch-grade-btn.active');
  if (activeGradeBtn && activeGradeBtn.dataset.grade === 'other') {
    const otherVal = (document.getElementById('sch-input-grade-other')?.value || '').trim();
    grade = otherVal; // may be empty — grade is optional
    // Update the hidden field so downstream logic is consistent
    const hidden = document.getElementById('sch-input-grade');
    if (hidden) hidden.value = grade;
  }

  const color     = document.getElementById('sch-input-color')?.value || getNextGroupColor();
  // R59: optional headcount — positive integer or null
  const sizeRaw = (document.getElementById('sch-input-size')?.value || '').trim();
  const sizeNum = parseInt(sizeRaw, 10);
  const size    = (sizeRaw !== '' && Number.isFinite(sizeNum) && sizeNum > 0) ? Math.min(sizeNum, 999) : null;
  const modsA     = collectModAssignmentsForDay('A');
  const modsB     = collectModAssignmentsForDay('B');
  const hasRoom   = modsA.some(r => r !== '');

  if (!hasRoom && roomRegistry.length > 0) {
    showFormError('Assign at least one room in A Day before saving.');
    return null;
  }

  // Store grade as a number if it's a pure number, otherwise keep as string
  const gradeVal = grade ? (isNaN(Number(grade)) ? grade : Number(grade)) : null;
  return { name, grade: gradeVal, color, size, modsA, modsB, mods: modsA };
}

function saveGroup() {
  const data = validateGroupForm();
  if (!data) return;

  const editingId = AppState.schedules.editingGroupId;

  if (editingId) {
    const idx = AppState.schedules.groups.findIndex(g => g.id === editingId);
    if (idx >= 0) {
      AppState.schedules.groups[idx] = { ...AppState.schedules.groups[idx], ...data };
      showToast(`Group "${data.name}" saved.`, 'success');
    }
  } else {
    // New group — create it and stay in edit mode for it
    const newId = generateGroupId();
    const group = { id: newId, ...data };
    AppState.schedules.groups.push(group);
    AppState.schedules.editingGroupId = newId;
    // Switch mode label to "Editing" now that it's been created
    const modeLabel = document.getElementById('sch-editor-mode-label');
    const title     = document.getElementById('sch-editor-title');
    if (modeLabel) { modeLabel.textContent = 'Editing'; modeLabel.className = 'sch-editor-mode-label editing'; }
    if (title)     title.textContent = data.name;
    showToast(`Group "${data.name}" created.`, 'success');
  }

  scheduleGroupsAutosave();
  saveSchedules();
  renderGroupList(); // refresh the list card without closing the form
}

function deleteGroup(groupId) {
  const group = AppState.schedules.groups.find(g => g.id === groupId);
  if (!group) return;
  if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;

  AppState.schedules.groups = AppState.schedules.groups.filter(g => g.id !== groupId);
  saveSchedules();
  // If editing this group, close editor
  if (AppState.schedules.editingGroupId === groupId) hideEditorForm();
  renderGroupList();
  showToast(`Group "${group.name}" deleted.`, 'info');
}

function duplicateGroup(groupId) {
  const group = AppState.schedules.groups.find(g => g.id === groupId);
  if (!group) return;

  let baseName = group.name + ' (Copy)';
  let newName  = baseName;
  let i = 2;
  while (AppState.schedules.groups.some(g => g.name.trim().toLowerCase() === newName.toLowerCase())) {
    newName = baseName + ' ' + i;
    i++;
  }

  const newGroup = {
    id:    generateGroupId(),
    name:  newName,
    grade: group.grade,
    size:  (Number.isFinite(Number(group.size)) && Number(group.size) > 0) ? Number(group.size) : null,  // R59
    color: getNextGroupColor(),
    modsA: [...(group.modsA || group.mods || [])],
    modsB: [...(group.modsB || [])],
    mods:  [...(group.modsA || group.mods || [])],
  };

  const idx = AppState.schedules.groups.findIndex(g => g.id === groupId);
  AppState.schedules.groups.splice(idx + 1, 0, newGroup);

  saveSchedules();
  renderGroupList();
  showToast(`Group duplicated as "${newName}".`, 'success');
}

function showFormError(msg) {
  const el = document.getElementById('sch-form-error');
  if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function clearFormError() {
  const el = document.getElementById('sch-form-error');
  if (el) { el.textContent = ''; el.classList.remove('visible'); }
  document.getElementById('sch-input-name')?.classList.remove('error');
}

/* ==============================================
   SCHEDULES MODULE — Event Wiring
=============================================== */

/* ==============================================
   SCHEDULES MODULE — Export / Import
=============================================== */

function exportGroups() {
  if (AppState.schedules.groups.length === 0) {
    showToast('No groups to export.', 'warn');
    return;
  }

  const payload = AppState.schedules.groups.map(g => ({
    name:  g.name,
    grade: g.grade,
    color: g.color,
    size:  (Number.isFinite(Number(g.size)) && Number(g.size) > 0) ? Math.round(Number(g.size)) : null,  // R59
    modsA: g.modsA || g.mods || [],
    modsB: g.modsB || [],
    mods:  g.modsA || g.mods || [],
  }));

  const school = AppState.settings.schoolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'school';
  const date     = new Date().toISOString().slice(0, 10);
  const filename = `${school}-groups-${date}.json`;

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${payload.length} group${payload.length !== 1 ? 's' : ''} to ${filename}.`, 'success');
}

function validateGroupsImport(data) {
  if (!Array.isArray(data)) throw new Error('Import file must contain an array of groups.');
  if (data.length === 0)    throw new Error('Import file contains no groups.');
  if (data.length > 200)    throw new Error('Import file contains too many groups (max 200).');
  for (let i = 0; i < Math.min(3, data.length); i++) {
    const g = data[i];
    if (!g || typeof g !== 'object') throw new Error(`Item ${i} is not an object.`);
    if (typeof g.name !== 'string' || !g.name.trim()) throw new Error(`Item ${i} is missing a valid name.`);
    if (!Array.isArray(g.modsA) && !Array.isArray(g.mods)) throw new Error(`Item ${i} is missing a schedule array.`);
  }
}

function startGroupImport(rawData) {
  try {
    validateGroupsImport(rawData);
  } catch(err) {
    showToast(`Import failed: ${err.message}`, 'error');
    return;
  }

  // Find conflicts
  const existingNames = new Set(AppState.schedules.groups.map(g => g.name.trim().toLowerCase()));
  const conflicts = rawData.filter(g => existingNames.has(g.name.trim().toLowerCase()));

  if (conflicts.length === 0) {
    // No conflicts — import directly
    applyGroupImport(rawData, 'skip');
    return;
  }

  // Show conflict resolution modal
  AppState.schedules._pendingImport = rawData;

  const subtitle = document.getElementById('conflict-modal-subtitle');
  const list     = document.getElementById('conflict-name-list');
  if (subtitle) subtitle.textContent =
    `${conflicts.length} of ${rawData.length} imported group${rawData.length !== 1 ? 's' : ''} have conflicting names.`;
  if (list) list.innerHTML = conflicts.slice(0, 20).map(g =>
    `<div class="sch-conflict-item">• ${escHtml(g.name)}</div>`
  ).join('') + (conflicts.length > 20 ? `<div class="sch-conflict-item" style="opacity:0.6;">…and ${conflicts.length - 20} more</div>` : '');

  // Reset radio to skip
  const radios = document.querySelectorAll('input[name="conflict-resolution"]');
  radios.forEach(r => r.checked = r.value === 'skip');

  openConflictModal();
}

function applyGroupImport(rawData, resolution) {
  if (!rawData) return;
  AppState.schedules._pendingImport = null;

  const existingByName = new Map(AppState.schedules.groups.map(g => [g.name.trim().toLowerCase(), g]));
  const missingRoomWarnings = [];
  let added = 0, skipped = 0, overwritten = 0, renamed = 0;

  for (const raw of rawData) {
    const nameKey = raw.name.trim().toLowerCase();
    const conflict = existingByName.has(nameKey);

    // Check for rooms that don't exist
    const badRooms = (raw.mods || []).filter(r => r && r !== '' && !roomRegistry.some(reg => reg.roomNumber === r));
    if (badRooms.length > 0) {
      missingRoomWarnings.push(`"${raw.name}": rooms [${badRooms.join(', ')}] not in blueprint`);
    }

    if (conflict && resolution === 'skip') {
      skipped++; continue;
    }

    const newGroup = {
      id:    generateGroupId(),
      name:  raw.name.trim(),
      grade: raw.grade !== undefined && raw.grade !== null ? Number(raw.grade) || null : null,
      color: raw.color || getNextGroupColor(),
      size:  (Number.isFinite(Number(raw.size)) && Number(raw.size) > 0) ? Math.round(Number(raw.size)) : null,  // R59
      modsA: Array.isArray(raw.modsA) ? raw.modsA.slice(0, 20) : (Array.isArray(raw.mods) ? raw.mods.slice(0, 20) : []),
      modsB: Array.isArray(raw.modsB) ? raw.modsB.slice(0, 20) : [],
      mods:  Array.isArray(raw.modsA) ? raw.modsA.slice(0, 20) : (Array.isArray(raw.mods) ? raw.mods.slice(0, 20) : []),
    };

    if (conflict && resolution === 'overwrite') {
      const idx = AppState.schedules.groups.findIndex(g => g.name.trim().toLowerCase() === nameKey);
      if (idx >= 0) { AppState.schedules.groups[idx] = newGroup; overwritten++; }
    } else if (conflict && resolution === 'rename') {
      let suffix = '(Import)';
      let finalName = `${newGroup.name} ${suffix}`;
      let attempt = 2;
      while (AppState.schedules.groups.some(g => g.name.trim().toLowerCase() === finalName.toLowerCase())) {
        finalName = `${newGroup.name} ${suffix} ${attempt++}`;
      }
      newGroup.name = finalName;
      AppState.schedules.groups.push(newGroup);
      existingByName.set(finalName.toLowerCase(), newGroup);
      renamed++;
    } else {
      // No conflict, or resolution led here
      AppState.schedules.groups.push(newGroup);
      existingByName.set(nameKey, newGroup);
      added++;
    }
  }

  saveSchedules();
  renderGroupList();

  // Build result message
  const parts = [];
  if (added > 0)       parts.push(`${added} added`);
  if (overwritten > 0) parts.push(`${overwritten} overwritten`);
  if (renamed > 0)     parts.push(`${renamed} renamed`);
  if (skipped > 0)     parts.push(`${skipped} skipped`);
  showToast(`Import complete: ${parts.join(', ')}.`, 'success');

  if (missingRoomWarnings.length > 0) {
    setTimeout(() => {
      showToast(`⚠ ${missingRoomWarnings.length} group${missingRoomWarnings.length !== 1 ? 's have' : ' has'} rooms not in the current blueprint. Check the editor for details.`, 'warn');
    }, 600);
  }
}

function openConflictModal() {
  document.getElementById('sch-conflict-modal').classList.add('open');
}
function closeConflictModal() {
  document.getElementById('sch-conflict-modal').classList.remove('open');
  AppState.schedules._pendingImport = null;
}

/* ==============================================
   SCHEDULES MODULE — Autosave indicator
=============================================== */
let _scheduleAutosaveTimer = null;

function scheduleGroupsAutosave() {
  const dot  = document.getElementById('sch-autosave-dot');
  const text = document.getElementById('sch-autosave-text');
  if (dot)  { dot.style.background = 'var(--warn)'; }
  if (text) text.textContent = 'Saving…';

  clearTimeout(_scheduleAutosaveTimer);
  _scheduleAutosaveTimer = setTimeout(() => {
    saveSchedules();
    if (dot)  { dot.style.background = 'var(--success)'; }
    if (text) text.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  }, 600);
}

function initSchedulesModule() {
  buildColorPresets();
  loadSchedules();
  renderGroupList();

  // ── NEW GROUP BUTTON ──
  document.getElementById('btn-new-group')?.addEventListener('click', openEditorForNew);

  // ── SAVE BUTTON ──
  document.getElementById('sch-btn-save')?.addEventListener('click', saveGroup);

  // ── CANCEL BUTTON ──
  document.getElementById('sch-btn-cancel')?.addEventListener('click', hideEditorForm);

  // ── Group name input — clear error on input ──
  document.getElementById('sch-input-name')?.addEventListener('input', () => {
    document.getElementById('sch-input-name').classList.remove('error');
    clearFormError();
  });

  // ── Grade buttons ──
  document.querySelectorAll('.sch-grade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hidden = document.getElementById('sch-input-grade');
      const otherInput = document.getElementById('sch-input-grade-other');

      if (btn.dataset.grade === 'other') {
        // Activate "other" and show text input
        document.querySelectorAll('.sch-grade-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (otherInput) {
          otherInput.style.display = '';
          otherInput.focus();
          // Update hidden field from current text value
          if (hidden) hidden.value = otherInput.value.trim();
        }
      } else {
        const g = btn.dataset.grade;
        const currentVal = hidden ? hidden.value : '';
        // Toggle off if already selected
        if (currentVal === g) {
          updateGradeBtnGroup(null);
        } else {
          // Hide other input when switching to 6/7/8
          if (otherInput) { otherInput.style.display = 'none'; otherInput.value = ''; }
          updateGradeBtnGroup(g);
        }
      }
    });
  });

  // ── Other grade text input: update hidden field live ──
  document.getElementById('sch-input-grade-other')?.addEventListener('input', () => {
    const otherInput = document.getElementById('sch-input-grade-other');
    const hidden = document.getElementById('sch-input-grade');
    if (hidden && otherInput) hidden.value = otherInput.value.trim();
  });

  // ── Color picker (native, hidden behind custom dot) ──
  document.getElementById('sch-input-color')?.addEventListener('input', e => {
    const c = e.target.value;
    updateColorPresetSelection(c);
    // Mark custom btn as selected (not a preset)
    const isPreset = GROUP_COLOR_PRESETS.includes(c);
    document.getElementById('sch-color-custom-btn')?.classList.toggle('selected', !isPreset);
    if (isPreset) document.getElementById('sch-color-custom-btn')?.classList.remove('selected');
  });

  // ── Copy A → B button ──
  document.getElementById('sch-copy-a-to-b')?.addEventListener('click', () => {
    const modsA = collectModAssignmentsForDay('A');
    const selectsB = document.querySelectorAll('#sch-mod-tbody-B .sch-mod-room-select');
    selectsB.forEach((sel, idx) => {
      const val = modsA[idx] || '';
      sel.value = val;
      sel.classList.toggle('assigned', val !== '');
    });
    showToast('A Day schedule copied to B Day.', 'success');
  });

  // ── SEARCH BAR ──
  const searchInput = document.getElementById('sch-search-input');
  const searchClear = document.getElementById('sch-search-clear');
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value;
    AppState.schedules.searchQuery = q;
    searchClear.style.display = q ? '' : 'none';
    renderGroupList();
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    AppState.schedules.searchQuery = '';
    searchClear.style.display = 'none';
    renderGroupList();
    searchInput.focus();
  });

  // ── EXPORT GROUPS ──
  document.getElementById('btn-export-groups')?.addEventListener('click', exportGroups);

  // ── IMPORT GROUPS ──
  document.getElementById('btn-import-groups')?.addEventListener('click', () => {
    document.getElementById('sch-import-file').click();
  });
  document.getElementById('sch-import-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => {
      let data;
      try { data = JSON.parse(evt.target.result); }
      catch { showToast('Import failed: file is not valid JSON.', 'error'); return; }
      startGroupImport(data);
    };
    reader.onerror = () => showToast('Import failed: could not read file.', 'error');
    reader.readAsText(file);
  });

  // ── CONFLICT MODAL ──
  document.getElementById('conflict-modal-cancel')?.addEventListener('click', () => {
    closeConflictModal();
    showToast('Import cancelled.', 'info');
  });
  document.getElementById('conflict-modal-confirm')?.addEventListener('click', () => {
    const resolution = document.querySelector('input[name="conflict-resolution"]:checked')?.value || 'skip';
    applyGroupImport(AppState.schedules._pendingImport, resolution);
    closeConflictModal();
  });

  // ── GROUP LIST: delegated click ──
  document.getElementById('sch-group-list')?.addEventListener('click', e => {
    const editBtn      = e.target.closest('[data-action="edit"]');
    const deleteBtn    = e.target.closest('[data-action="delete"]');
    const duplicateBtn = e.target.closest('[data-action="duplicate"]');
    const card         = e.target.closest('.group-card');

    if (deleteBtn) {
      e.stopPropagation();
      deleteGroup(deleteBtn.dataset.groupId);
      return;
    }
    if (duplicateBtn) {
      e.stopPropagation();
      duplicateGroup(duplicateBtn.dataset.groupId);
      return;
    }
    if (editBtn) {
      e.stopPropagation();
      openEditorForEdit(editBtn.dataset.groupId);
      return;
    }
    if (card) {
      const gid = card.dataset.groupId;
      if (AppState.schedules.editingGroupId === gid) {
        hideEditorForm();
      } else {
        openEditorForEdit(gid);
      }
    }
  });

  // ── R39: CSV IMPORT ──
  document.getElementById('btn-import-csv')?.addEventListener('click', () => {
    document.getElementById('sch-import-csv-file').click();
  });
  document.getElementById('sch-import-csv-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => handleCsvImport(evt.target.result);
    reader.onerror = () => showToast('CSV import failed: could not read file.', 'error');
    reader.readAsText(file);
  });

  // ── R39: CSV TEMPLATE DOWNLOAD ──
  document.getElementById('btn-download-csv-template')?.addEventListener('click', downloadCsvTemplate);

  // ── BULK EDITOR ──
  document.getElementById('btn-bulk-editor')?.addEventListener('click', openBulkEditor);
  initBulkEditor();
}

/* ==============================================================
   R39 — MODULE 4: CSV BULK IMPORT FOR GROUPS
=============================================================== */

/**
 * Minimal CSV parser. Handles quoted fields with commas.
 * Returns array of row arrays (all strings).
 */
function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { row.push(field); field = ''; }
        else { field += ch; }
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function handleCsvImport(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    showToast('CSV import failed: file must have a header row and at least one data row.', 'error');
    return;
  }

  // Parse header
  const header = rows[0].map(h => h.trim().toLowerCase());
  const nameIdx  = header.findIndex(h => h === 'name');
  const gradeIdx = header.findIndex(h => h === 'grade');
  const colorIdx = header.findIndex(h => h === 'color');
  // R59: optional headcount column — tolerate several header spellings
  const sizeIdx  = header.findIndex(h => h === 'size' || h === 'students' || h === 'student count' || h === 'headcount');

  if (nameIdx < 0) {
    showToast('CSV import failed: missing required "Name" column.', 'error');
    return;
  }

  // Mod columns: all headers after the fixed ones (Name, Grade, Color) that start with Mod/Period/Block/Hour
  // Actually: any column not named name/grade/color is treated as a mod column in order
  const modCols = [];
  for (let i = 0; i < header.length; i++) {
    if (i === nameIdx || i === gradeIdx || i === colorIdx || i === sizeIdx) continue;
    modCols.push(i);
  }

  const newGroups = [];
  const warnings  = [];
  const knownRooms = new Set(roomRegistry.map(r => r.roomNumber));

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    const name = (row[nameIdx] || '').trim();
    if (!name) continue;

    const gradeRaw = gradeIdx >= 0 ? (row[gradeIdx] || '').trim() : '';
    const grade    = gradeRaw ? (parseInt(gradeRaw, 10) || null) : null;
    const color    = (colorIdx >= 0 && (row[colorIdx] || '').trim())
      ? row[colorIdx].trim()
      : getNextGroupColor();
    // R59: optional headcount — positive integer or null
    const sizeRaw = sizeIdx >= 0 ? (row[sizeIdx] || '').trim() : '';
    const sizeNum = parseInt(sizeRaw, 10);
    const size    = (sizeRaw !== '' && Number.isFinite(sizeNum) && sizeNum > 0) ? Math.min(sizeNum, 999) : null;

    const modsA = modCols.map(ci => (row[ci] || '').trim());

    // Warn about unknown rooms (but still import)
    modsA.forEach(room => {
      if (room && !knownRooms.has(room)) {
        warnings.push(`Row ${ri + 1} ("${name}"): room "${room}" not found in blueprint`);
      }
    });

    newGroups.push({
      id:    generateGroupId(),
      name,
      grade,
      color,
      size,   // R59
      modsA,
      modsB: [],
      mods:  modsA,
    });
  }

  if (newGroups.length === 0) {
    showToast('CSV import: no valid rows found.', 'warn');
    return;
  }

  // Prompt merge strategy
  const existing = AppState.schedules.groups.length;
  let strategy = 'append';
  if (existing > 0) {
    const choice = confirm(
      `Import ${newGroups.length} group${newGroups.length !== 1 ? 's' : ''} from CSV.\n\n` +
      `OK = Replace all ${existing} existing group${existing !== 1 ? 's' : ''}\n` +
      `Cancel = Append to existing groups`
    );
    strategy = choice ? 'replace' : 'append';
  }

  if (strategy === 'replace') {
    AppState.schedules.groups = newGroups;
  } else {
    AppState.schedules.groups.push(...newGroups);
  }

  saveSchedules();
  renderGroupList();
  showToast(
    `CSV import: ${newGroups.length} group${newGroups.length !== 1 ? 's' : ''} ${strategy === 'replace' ? 'imported' : 'appended'}.`,
    'success'
  );

  // Show warnings as a second toast if any
  if (warnings.length > 0) {
    setTimeout(() => {
      showToast(`${warnings.length} room${warnings.length !== 1 ? 's' : ''} not found in blueprint (groups still imported).`, 'warn');
    }, 600);
  }
}

function downloadCsvTemplate() {
  const labels = getAllModLabels();
  const header = ['Name', 'Grade', 'Color', 'Students', ...labels].join(',');
  const exampleA = ['Homeroom A', '9', '#3b82f6', '24', ...labels.map((_, i) => i === 0 ? '101' : '')].join(',');
  const exampleB = ['Homeroom B', '10', '#ef4444', '', ...labels.map((_, i) => i === 0 ? '205' : i === 1 ? '110' : '')].join(',');
  const csv = [header, exampleA, exampleB].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'groups-template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==============================================================
   ROUND 40 — BULK EDITOR MODULE
   ──────────────────────────────────────────────────────────────
   Full-screen spreadsheet-style editor for all groups at once.
   Stages edits in a local beState copy; writes to AppState only
   on "Apply Changes". Mirrors A/B Day column structure from the
   Schedule Manager companion tool.
=============================================================== */

const beState = {
  modCount: 8,         // local copy, sync'd from AppState.settings on open
  groups: [],          // deep-copy of AppState.schedules.groups while editing
};

const AUTO_COLORS_BE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#a78bfa','#fb923c','#34d399','#f472b6','#60a5fa',
  '#fbbf24','#4ade80','#c084fc','#38bdf8','#fb7185',
];

function uid_be() {
  return 'be_' + Math.random().toString(36).slice(2, 10);
}

function initBulkEditor() {
  const overlay = document.getElementById('bulk-editor-overlay');

  // Mod count stepper
  const modInput = document.getElementById('be-mod-input');
  document.getElementById('be-mod-dec')?.addEventListener('click', () => {
    const v = Math.max(1, parseInt(modInput.value, 10) - 1);
    modInput.value = v;
    beState.modCount = v;
    renderBulkEditor();
  });
  document.getElementById('be-mod-inc')?.addEventListener('click', () => {
    const v = Math.min(12, parseInt(modInput.value, 10) + 1);
    modInput.value = v;
    beState.modCount = v;
    renderBulkEditor();
  });
  modInput?.addEventListener('change', () => {
    let v = parseInt(modInput.value, 10);
    if (isNaN(v)) v = 1;
    v = Math.max(1, Math.min(12, v));
    modInput.value = v;
    beState.modCount = v;
    renderBulkEditor();
  });

  // Copy A → B
  document.getElementById('be-btn-copy-a-to-b')?.addEventListener('click', () => {
    beState.groups.forEach(g => {
      g.modsB = [...(g.modsA || g.mods || [])];
    });
    renderBulkEditor();
    showToast('A Day copied to B Day (not yet applied).', 'info');
  });

  // Clear rooms
  document.getElementById('be-btn-clear-all')?.addEventListener('click', () => {
    if (!confirm('Clear all room assignments for every group? This cannot be undone in the editor.')) return;
    beState.groups.forEach(g => { g.modsA = []; g.modsB = []; g.mods = []; });
    renderBulkEditor();
    showToast('All room assignments cleared (not yet applied).', 'info');
  });

  // Add group
  document.getElementById('be-btn-add-group')?.addEventListener('click', () => {
    const used = new Set(beState.groups.map(g => g.color));
    const color = AUTO_COLORS_BE.find(c => !used.has(c)) || AUTO_COLORS_BE[beState.groups.length % AUTO_COLORS_BE.length];
    beState.groups.push({ id: uid_be(), name: 'New Group', grade: '', color, size: null, modsA: [], modsB: [], mods: [] });
    renderBulkEditor();
    // Scroll to bottom
    const main = document.getElementById('bulk-editor-main');
    if (main) setTimeout(() => { main.scrollTop = main.scrollHeight; }, 50);
  });

  // Discard & Close
  document.getElementById('be-btn-discard')?.addEventListener('click', closeBulkEditor);

  // Apply Changes
  document.getElementById('be-btn-apply')?.addEventListener('click', applyBulkEdits);

  // Close on overlay background click (panel is full screen, so this won't fire)
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closeBulkEditor();
  });

  // Keyboard shortcut — Escape to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay?.classList.contains('open')) {
      closeBulkEditor();
    }
  });
}

function openBulkEditor() {
  // Deep-copy groups from AppState
  beState.modCount = AppState.settings.modCount || 8;
  beState.groups = AppState.schedules.groups.map(g => ({
    id: g.id,
    name: g.name,
    grade: g.grade || '',
    color: g.color,
    size: (Number.isFinite(Number(g.size)) && Number(g.size) > 0) ? Number(g.size) : null,  // R59
    modsA: [...(g.modsA || g.mods || [])],
    modsB: [...(g.modsB || [])],
    mods:  [...(g.modsA || g.mods || [])],
  }));

  // Sync mod count input to settings
  const modInput = document.getElementById('be-mod-input');
  if (modInput) modInput.value = beState.modCount;

  renderBulkEditor();
  document.getElementById('bulk-editor-overlay')?.classList.add('open');
}

function closeBulkEditor() {
  document.getElementById('bulk-editor-overlay')?.classList.remove('open');
}

function applyBulkEdits() {
  // Flush any focused input so its value is captured in beState
  // (inputs sync on blur/input; the apply commit reads beState.groups directly)
  // Update AppState.schedules.groups from beState
  const modCount = beState.modCount;

  // Build indexed map of existing groups for merge
  const existingById = new Map(AppState.schedules.groups.map(g => [g.id, g]));

  const updated = beState.groups.map(bg => {
    const modsA = (bg.modsA || bg.mods || []).slice(0, modCount);
    while (modsA.length < modCount) modsA.push('');
    const modsB = (bg.modsB || []).slice(0, modCount);
    while (modsB.length < modCount) modsB.push('');

    // Trim trailing empty strings
    while (modsA.length > 0 && modsA[modsA.length - 1] === '') modsA.pop();
    while (modsB.length > 0 && modsB[modsB.length - 1] === '') modsB.pop();

    const base = existingById.get(bg.id) || {};
    return {
      ...base,
      id:    bg.id,
      name:  bg.name || 'Unnamed',
      grade: bg.grade || '',
      color: bg.color,
      size:  (Number.isFinite(Number(bg.size)) && Number(bg.size) > 0) ? Math.round(Number(bg.size)) : null,  // R59
      modsA, modsB,
      mods: modsA,  // backward compat
    };
  });

  AppState.schedules.groups = updated;

  // Also sync modCount to settings if it changed
  if (AppState.settings.modCount !== modCount) {
    AppState.settings.modCount = modCount;
    // Update settings UI inputs if visible
    const sc = document.getElementById('setting-mod-count');
    const sr = document.getElementById('setting-mod-count-range');
    const sd = document.getElementById('mod-count-display');
    if (sc) sc.value = modCount;
    if (sr) sr.value = modCount;
    if (sd) sd.textContent = modCount;
  }

  saveSchedules();
  renderGroupList();
  closeBulkEditor();
  showToast(`Applied changes to ${updated.length} group${updated.length !== 1 ? 's' : ''}.`, 'success');
}

function renderBulkEditor() {
  const modCount = beState.modCount;
  const groups   = beState.groups;
  const container = document.getElementById('be-grade-sections');
  if (!container) return;
  container.innerHTML = '';

  // Update counts
  const countEl  = document.getElementById('be-header-count');
  const infoEl   = document.getElementById('be-info-count');
  if (countEl)  countEl.textContent  = `${groups.length} group${groups.length !== 1 ? 's' : ''}`;
  if (infoEl)   infoEl.textContent   = `${groups.length} group${groups.length !== 1 ? 's' : ''}`;

  // Group by grade
  const byGrade = { '6': [], '7': [], '8': [] };
  const other   = [];
  groups.forEach(g => {
    if (byGrade[g.grade]) byGrade[g.grade].push(g);
    else other.push(g);
  });

  ['6','7','8'].forEach(grade => {
    if (byGrade[grade].length === 0) return;
    renderBeGradeSection(container, grade, byGrade[grade], modCount);
  });
  if (other.length > 0) {
    renderBeGradeSection(container, 'Other', other, modCount, true);
  }

  if (groups.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--slate-400);">
        <svg width="40" height="40" viewBox="0 0 24 24" stroke="var(--slate-300)" fill="none" stroke-width="1.5" style="display:block;margin:0 auto 12px;">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
          <line x1="9" y1="9" x2="9" y2="21"/>
        </svg>
        <p style="font-size:13px;">No groups yet. Click <strong>Add Group</strong> above.</p>
      </div>`;
  }
}

function renderBeGradeSection(container, grade, groups, modCount, isOther = false) {
  const section = document.createElement('div');
  section.className = 'be-grade-section';

  const badgeClass = isOther ? 'g8' : `g${grade}`;
  const header = document.createElement('div');
  header.className = 'be-grade-header';
  header.innerHTML = `
    <span class="be-grade-badge ${badgeClass}">${isOther ? 'Other' : `Grade ${grade}`}</span>
    <span class="be-grade-count">${groups.length} group${groups.length !== 1 ? 's' : ''}</span>
  `;
  section.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'be-table-wrap';

  const table = document.createElement('table');
  table.className = 'be-table';

  // ── Build header rows ──
  const thead = document.createElement('thead');

  // Row 1: Group | Color | A Day (colspan) | B Day (colspan) | Del
  const row1 = document.createElement('tr');

  const thGroup = document.createElement('th');
  thGroup.className = 'be-th-group';
  thGroup.rowSpan = 2;
  thGroup.innerHTML = `<div style="display:flex;align-items:center;gap:5px;">
    <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
    Group
  </div>`;
  row1.appendChild(thGroup);

  const thColor = document.createElement('th');
  thColor.rowSpan = 2;
  thColor.style.cssText = 'width:28px;min-width:28px;padding:3px;';
  thColor.style.color = 'rgba(255,255,255,0.4)';
  thColor.textContent = '●';
  row1.appendChild(thColor);

  // R59: headcount column
  const thSize = document.createElement('th');
  thSize.rowSpan = 2;
  thSize.style.cssText = 'width:46px;min-width:46px;padding:3px 4px;font-size:9.5px;letter-spacing:0.04em;';
  thSize.textContent = 'SIZE';
  thSize.title = 'Students in this group (blank = default from Settings)';
  row1.appendChild(thSize);

  const thA = document.createElement('th');
  thA.colSpan = modCount;
  thA.className = 'be-th-day-a';
  thA.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:0.08em;">
    <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.5"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/></svg>
    A DAY
  </div>`;
  row1.appendChild(thA);

  const thB = document.createElement('th');
  thB.colSpan = modCount;
  thB.className = 'be-th-day-b';
  thB.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:0.08em;">
    <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    B DAY
  </div>`;
  row1.appendChild(thB);

  const thDel = document.createElement('th');
  thDel.rowSpan = 2;
  thDel.style.cssText = 'width:28px;min-width:28px;background:var(--navy-900);';
  row1.appendChild(thDel);

  thead.appendChild(row1);

  // Row 2: mod sub-headers
  const row2 = document.createElement('tr');
  const labels = getAllModLabels ? getAllModLabels() : Array.from({ length: modCount }, (_, i) => `Mod ${i + 1}`);
  for (let m = 0; m < modCount; m++) {
    const th = document.createElement('th');
    th.className = `be-th-mod day-a-mod${m === 0 ? '' : ''}`;
    th.textContent = labels[m] || `Mod ${m + 1}`;
    row2.appendChild(th);
  }
  for (let m = 0; m < modCount; m++) {
    const th = document.createElement('th');
    th.className = `be-th-mod day-b-mod${m === 0 ? ' day-divider' : ''}`;
    th.textContent = labels[m] || `Mod ${m + 1}`;
    row2.appendChild(th);
  }
  thead.appendChild(row2);
  table.appendChild(thead);

  // ── Build body rows ──
  const tbody = document.createElement('tbody');
  groups.forEach(group => {
    const tr = document.createElement('tr');

    // Group name cell
    const tdGroup = document.createElement('td');
    tdGroup.className = 'be-cell-group';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = group.name;
    nameInput.placeholder = 'Group name';
    nameInput.addEventListener('input', () => { group.name = nameInput.value; });
    tdGroup.appendChild(nameInput);
    tr.appendChild(tdGroup);

    // Color cell
    const tdColor = document.createElement('td');
    tdColor.className = 'be-cell-color';
    const dot = document.createElement('span');
    dot.className = 'be-color-dot';
    dot.style.background = group.color;
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = group.color;
    colorPicker.addEventListener('input', () => { group.color = colorPicker.value; dot.style.background = group.color; });
    dot.appendChild(colorPicker);
    tdColor.appendChild(dot);
    tr.appendChild(tdColor);

    // R59: headcount cell
    const tdSize = document.createElement('td');
    tdSize.className = 'be-cell-mod';
    const sizeInp = document.createElement('input');
    sizeInp.type = 'number';
    sizeInp.min = '1'; sizeInp.max = '999'; sizeInp.step = '1';
    sizeInp.value = (Number.isFinite(Number(group.size)) && Number(group.size) > 0) ? group.size : '';
    sizeInp.placeholder = '—';
    sizeInp.style.width = '42px';
    sizeInp.addEventListener('input', () => {
      const v = parseInt(sizeInp.value, 10);
      group.size = (Number.isFinite(v) && v > 0) ? Math.min(v, 999) : null;
    });
    tdSize.appendChild(sizeInp);
    tr.appendChild(tdSize);

    // A Day mod cells
    for (let m = 0; m < modCount; m++) {
      const td = document.createElement('td');
      td.className = `be-cell-mod day-a-col`;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = (group.modsA || group.mods || [])[m] || '';
      inp.placeholder = '—';
      inp.addEventListener('input', () => {
        if (!group.modsA) group.modsA = [];
        while (group.modsA.length <= m) group.modsA.push('');
        group.modsA[m] = inp.value.trim();
        group.mods = group.modsA; // keep compat
      });
      td.appendChild(inp);
      tr.appendChild(td);
    }

    // B Day mod cells
    for (let m = 0; m < modCount; m++) {
      const td = document.createElement('td');
      td.className = `be-cell-mod day-b-col${m === 0 ? ' day-divider' : ''}`;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = (group.modsB || [])[m] || '';
      inp.placeholder = '—';
      inp.addEventListener('input', () => {
        if (!group.modsB) group.modsB = [];
        while (group.modsB.length <= m) group.modsB.push('');
        group.modsB[m] = inp.value.trim();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    }

    // Delete cell
    const tdDel = document.createElement('td');
    tdDel.className = 'be-cell-del';
    const delBtn = document.createElement('button');
    delBtn.className = 'be-del-btn';
    delBtn.title = 'Remove this group';
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener('click', () => {
      const idx = beState.groups.indexOf(group);
      if (idx !== -1) beState.groups.splice(idx, 1);
      renderBulkEditor();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });

  // Add group row
  const addRow = document.createElement('tr');
  addRow.className = 'be-add-row';
  const addTd = document.createElement('td');
  addTd.colSpan = 3 + modCount * 2 + 2;   // R59: +1 for the Size column
  const addBtn = document.createElement('button');
  addBtn.className = 'be-add-btn';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Group (Grade ${isOther ? 'Other' : grade})`;
  addBtn.addEventListener('click', () => {
    const used = new Set(beState.groups.map(g => g.color));
    const color = AUTO_COLORS_BE.find(c => !used.has(c)) || AUTO_COLORS_BE[beState.groups.length % AUTO_COLORS_BE.length];
    beState.groups.push({ id: uid_be(), name: `Grade ${isOther ? 'Other' : grade} Group`, grade: isOther ? '' : grade, color, size: null, modsA: [], modsB: [], mods: [] });
    renderBulkEditor();
  });
  addTd.appendChild(addBtn);
  addRow.appendChild(addTd);
  tbody.appendChild(addRow);

  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  container.appendChild(section);
}

