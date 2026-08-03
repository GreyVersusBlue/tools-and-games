/* data-model.js — part of the School Layout Visualizer.
   Was lines 4825-6160 of Tools/schedule-visualizer.html. Cut out verbatim; the
   text below is byte-identical to what was inline, because the publish path
   puts br* function source into published files via Function.prototype.toString()
   and because the acorn equivalence check in schedule/test/structure.mjs
   compares this source against the original.

   Classic <script>, not a module. Top-level const/let bind in the shared
   global lexical scope, so declarations here are visible to every later file.
   LOAD ORDER IS SOURCE ORDER and must stay that way: the tool runs 17
   top-level statements, including DOM listener wiring that binds at parse time.
   See the <script src> list at the bottom of schedule-visualizer.html. */

/* ==============================================
   APP STATE
=============================================== */
const AppState = {
  settings: {
    schoolName: 'Student Travel Visualizer',
    modCount:   8,
    modLabel:   'mod',
    gridSize:   40,
    gridCols:   30,
    gridRows:   20,
    tileWalkTime:  3,   // R30: seconds to cross one hallway tile at normal pace
    staircaseTime: 8,   // R30: fixed overhead (seconds) to traverse a staircase portal
    defaultGroupSize: 25,  // R59: assumed students per group when group.size is blank
    bellSchedule: { A: null, B: null },  // R59: { A: [{start,end}|null,…]|null, B: same|null (null = same as A) }
    subjects: null,     // R59: [{code,name,color}] — normalized/seeded by normalizeSettings()
  },
  blueprint: {
    // LEGACY MIRRORS — always re-pointed (by reference) to the active floor's
    // data by switchActiveFloor() / initGridData(). Existing read-sites keep working.
    gridData:      null,
    gridCols:      30,
    gridRows:      20,
    staircasePairs: [], // [ ['col,row', 'col,row'], ... ] — derived same-floor mirror
    heatExcludeZones: [], // [ {id, col, row, cols, rows, label}, ... ]
    // ── Round 31: Multi-floor architecture ──
    floors: [
      { id: 'floor_0', label: 'Floor 1', gridData: null, gridCols: 30, gridRows: 20, heatExcludeZones: [] },
    ],
    activeFloorIdx:  0,
    crossFloorPairs: [], // [ { a:{floorId,col,row}, b:{floorId,col,row} }, ... ] — source of truth for pairs
  },
  schedules: {
    groups: [],           // array of group objects
    editingGroupId: null, // id of group currently in editor, or null for new
    searchQuery:    '',   // R6: current search filter
    _pendingImport: null, // R6: groups awaiting conflict resolution
    activeDayTab:   'A',  // R13: 'A' or 'B' day
  },
  ui: {
    activeTab:       'blueprint',
    activeTool:      'classroom',
    zoom:            1.0,
    isDragging:      false,
    contextMenuCell: null,
    selectedCell:    null,  // {col, row} — for select/edit panel
    moveSource:      null,  // {col, row, tile} — tile picked up in move mode (legacy)
    isPairingMode:   false, // waiting to click a second staircase
    pairingSource:   null,  // {col, row} — first staircase in pairing
    panning:         false, // currently dragging the canvas to pan
    tileDrag:        null,  // {startCol,startRow,tile,startX,startY,active,hoverCol,hoverRow} — Select-tool tile move
    classroomDragging:   false, // classroom multi-cell drag-select in progress
    classroomDragStart:  null,  // {col, row} — where the classroom drag started
    isDoorwayMode:       false, // placing doorways on a classroom
    doorwayTarget:       null,  // {col, row} — anchor cell of the classroom being edited
    corridorLabelCells:  new Set(), // "col,row" keys selected in corridor-label tool
    corridorLabelDragging: false,   // currently drag-selecting for corridor-label
    heatExcludeDragging:   false,   // currently drag-drawing a heat-exclude zone
    heatExcludeDragStart:  null,    // {col, row} — drag origin
    selectedExcludeZoneId: null,    // id of the currently selected exclude zone
    searchHighlightCell:   null,    // R39: { col, row } — briefly highlighted by room search
  },
};

/* ==============================================
   STORAGE KEYS / CONSTANTS
=============================================== */

/* The build number. It used to live in the filename — the page was
   "Schedule Visualizer and Browser Generator v60.html" — which meant every
   version bump was also an edit to the board's href and a broken bookmark for
   anyone holding the old one. It is shown in the header instead, and stamped
   into the footnote of every file the tool publishes, so a teacher holding a
   printout can still say which build produced it.

   Bump this when the tool changes. v61 is session 8: vendored fonts and
   jsPDF, stable filenames, the naming reconciled to "School Layout
   Visualizer". */
const TOOL_VERSION = 'v61';

const SETTINGS_KEY  = 'stviz_settings';
const BLUEPRINT_KEY = 'stviz_blueprint';
const SCHEDULES_KEY = 'stviz_schedules';
const VIZ_PREFS_KEY = 'stviz_viz_prefs';  // Round 24: persists viz panel preferences

const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 3.0;
const ZOOM_STEP = 0.15;
const GRID_LINE_COLOR = 'rgba(180,190,205,0.55)';

// Staircase pair colors (for badges on tiles)
const PAIR_COLORS = [
  '#7c3aed','#0ea5e9','#d97706','#10b981',
  '#f43f5e','#6366f1','#0891b2','#84cc16',
];

// Dummy room color presets
const DUMMY_COLOR_PRESETS = [
  '#e9d5ff', // soft purple (default)
  '#fce7f3', // soft pink (bathroom)
  '#d1fae5', // soft green (garden/outdoor)
  '#fef3c7', // soft amber (storage)
  '#dbeafe', // soft blue (office)
  '#fee2e2', // soft red (utility)
  '#f3f4f6', // light grey (generic)
  '#fef9c3', // soft yellow (library)
];
let activeDummyColor = DUMMY_COLOR_PRESETS[0];

const TILE_COLORS = {
  classroom: { fill: '#bfdbfe', stroke: '#3b82f6' },
  hallway:   { fill: '#d1d5db', stroke: '#6b7280' },
  staircase: { fill: '#fde68a', stroke: '#d97706', stripe: '#fbbf24' },
  dummy:     { fill: '#e9d5ff', stroke: '#7c3aed' },
};

/* ==============================================
   MOD LABEL HELPERS
=============================================== */
const BLOCK_LETTERS  = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const ORDINAL_SUFFIX = ['st','nd','rd','th','th','th','th','th','th','th','th','th'];

function modLabel(index, style) {
  switch (style) {
    case 'period': return `Period ${index}`;
    case 'block':  return `Block ${BLOCK_LETTERS[index - 1] || index}`;
    case 'hour':   return `${index}${ORDINAL_SUFFIX[index - 1] || 'th'} Hour`;
    default:       return `Mod ${index}`;
  }
}

function getAllModLabels() {
  const { modCount, modLabel: style } = AppState.settings;
  return Array.from({ length: modCount }, (_, i) => modLabel(i + 1, style));
}

/* ==============================================
   LOCALSTORAGE — Settings
=============================================== */
const DEFAULT_SETTINGS = {
  schoolName: 'Student Travel Visualizer',
  palette: 'default',
  modCount:   8,
  modLabel:   'mod',
  gridSize:   40,
  gridCols:   30,
  gridRows:   20,
  tileWalkTime:  3,   // R30
  staircaseTime: 8,   // R30
  defaultGroupSize: 25,                 // R59
  bellSchedule: { A: null, B: null },   // R59
  subjects: null,                       // R59 (null → seeded by normalizeSettings)
};

/* ── Round 59: Subjects seed — carries the pre-R59 BR_DEPT colors so
   existing classroom data renders unchanged in the Schedule Browser. ── */
const SUBJECT_SEED = [
  { code: 'ELA',    name: 'English / ELA',              color: '#2563eb' },
  { code: 'MATH',   name: 'Mathematics',                color: '#c2520f' },
  { code: 'SCI',    name: 'Science',                    color: '#0d7c69' },
  { code: 'SS',     name: 'Social Studies',             color: '#7c3aa8' },
  { code: 'SCI/SS', name: 'Science / Social Studies',   color: '#71641f' },
];

/* R59: coerce one bell-schedule day payload into [{start,end}|null,…] or null. */
function _r59NormalizeBellDay(day) {
  if (!Array.isArray(day)) return null;
  const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;
  return day.map(e => {
    if (!e || typeof e !== 'object') return null;
    const start = (typeof e.start === 'string' && timeRe.test(e.start)) ? e.start : null;
    const end   = (typeof e.end   === 'string' && timeRe.test(e.end))   ? e.end   : null;
    return (start || end) ? { start, end } : null;
  });
}

/* R59: normalize settings in place after any load / reset / import so old
   files (no defaultGroupSize / bellSchedule / subjects keys) get clean
   defaults with no migration errors. Deep-clones seeds so DEFAULT_SETTINGS
   is never mutated by reference. */
function normalizeSettings(s) {
  if (!s || typeof s !== 'object') return s;
  const dgs = parseInt(s.defaultGroupSize, 10);
  s.defaultGroupSize = (Number.isFinite(dgs) && dgs >= 1 && dgs <= 999) ? dgs : 25;

  const bs = (s.bellSchedule && typeof s.bellSchedule === 'object') ? s.bellSchedule : {};
  s.bellSchedule = { A: _r59NormalizeBellDay(bs.A), B: _r59NormalizeBellDay(bs.B) };

  const validSubjects = Array.isArray(s.subjects) && s.subjects.length > 0 &&
    s.subjects.every(sub => sub && typeof sub === 'object' && typeof sub.code === 'string' && sub.code.trim());
  s.subjects = validSubjects
    ? s.subjects.map(sub => ({
        code:  sub.code.trim(),
        name:  (typeof sub.name === 'string' && sub.name.trim()) ? sub.name.trim() : sub.code.trim(),
        color: (typeof sub.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sub.color)) ? sub.color : '#64748b',
      }))
    : SUBJECT_SEED.map(sub => ({ ...sub }));
  return s;
}

/* ── R59 shared helpers — all group-size consumers (weighted heat, travel
   delay, Stage-4 dot counts) route through these. ── */

/** Effective headcount of a group: explicit size, else settings default. */
function groupWeight(group) {
  const sz = group ? Number(group.size) : NaN;
  if (Number.isFinite(sz) && sz > 0) return Math.round(sz);
  const d = AppState.settings.defaultGroupSize;
  return (Number.isFinite(d) && d > 0) ? d : 25;
}

/** True when at least one group has an explicit size — controls whether
    congestion figures are displayed as "~N students" vs. raw group counts. */
function anyGroupSized(groups) {
  const list = groups || AppState.schedules.groups || [];
  return list.some(g => Number.isFinite(Number(g && g.size)) && Number(g.size) > 0);
}

/** Congestion-delay multiplier from "effective other groups" on a tile.
    Piecewise-linear through the R30 anchor points (0,0) (1,0.2) (2,0.5)
    (3,0.8), clamped at 0.8 — agrees exactly with the R58 discrete steps at
    every integer, so the all-sizes-null regression holds. */
function congestionDelayMult(effOthers) {
  if (!(effOthers > 0)) return 0;
  if (effOthers >= 3) return 0.8;
  if (effOthers >= 2) return 0.5 + (effOthers - 2) * 0.3;
  if (effOthers >= 1) return 0.2 + (effOthers - 1) * 0.3;
  return effOthers * 0.2;
}

/* ── R59 bell-schedule helpers ── */

/** "HH:MM" 24h → compact display ("08:05" → "8:05", "13:40" → "1:40"). */
function formatClockTime(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return '';
  let [h, m] = hhmm.split(':').map(Number);
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Resolve the bell-schedule array for a day ('B' falls back to A when null). */
function getBellDay(day) {
  const bs = AppState.settings.bellSchedule || {};
  if (day === 'B' && Array.isArray(bs.B)) return bs.B;
  return Array.isArray(bs.A) ? bs.A : null;
}

/** formatModTime('A', 0) → "8:00–8:42", or '' when no times exist. */
function formatModTime(day, modIdx) {
  const arr = getBellDay(day);
  const e = arr && arr[modIdx];
  if (!e || !e.start || !e.end) return '';
  return `${formatClockTime(e.start)}\u2013${formatClockTime(e.end)}`;
}

/** Passing window for transition fromMod→fromMod+1 (1-based fromMod):
    prevMod.end → nextMod.start, e.g. "8:42–8:46". '' when unavailable. */
function formatTransitionWindow(day, fromMod) {
  const arr = getBellDay(day);
  if (!arr) return '';
  const prev = arr[fromMod - 1], next = arr[fromMod];
  if (!prev || !prev.end || !next || !next.start) return '';
  return `${formatClockTime(prev.end)}\u2013${formatClockTime(next.start)}`;
}

/* ── R59 subjects helpers ── */
function getSubjects() {
  if (!Array.isArray(AppState.settings.subjects)) normalizeSettings(AppState.settings);
  return AppState.settings.subjects;
}
function subjectByCode(code) {
  if (!code) return null;
  return getSubjects().find(s => s.code === code) || null;
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(AppState.settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) AppState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch(e) { console.warn('[STVIZ] Could not load settings:', e); }
  normalizeSettings(AppState.settings);   // R59: old/absent payloads → clean defaults
}

function getLastSavedTime() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY + '_time');
    return raw ? new Date(JSON.parse(raw)).toLocaleTimeString() : 'Never';
  } catch { return 'Never'; }
}

function saveLastSavedTime() {
  localStorage.setItem(SETTINGS_KEY + '_time', JSON.stringify(new Date().toISOString()));
}

/* Round 24 — Viz panel preferences (separate key so settings churn doesn't clobber them) */
function saveVizPrefs() {
  try {
    localStorage.setItem(VIZ_PREFS_KEY, JSON.stringify({
      congestionOpen: AppState.viz.congestionOpen,
      playbackSpeed:  AppState.viz.playback.speed,   // R30
      playbackMode:   AppState.viz.playback.mode,    // R30
      animStyle:      AppState.viz.playback.animStyle,     // R48
      realtimeCycle:  AppState.viz.playback.realtimeCycle, // R48
      cometScale:     AppState.viz.playback.cometScale,    // R52
      r53Defaults:    true,                                // R53: comet+realtime defaults applied
    }));
  } catch(e) { console.warn('[STVIZ] Could not save viz prefs:', e); }
}

function loadVizPrefs() {
  try {
    const raw = localStorage.getItem(VIZ_PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (typeof prefs.congestionOpen === 'boolean') {
      AppState.viz.congestionOpen = prefs.congestionOpen;
    }
    // R30: restore playback preferences
    if (prefs.playbackSpeed === 0.5 || prefs.playbackSpeed === 1 || prefs.playbackSpeed === 2) {
      AppState.viz.playback.speed = prefs.playbackSpeed;
    }
    if (prefs.playbackMode === 'simultaneous' || prefs.playbackMode === 'sequential') {
      AppState.viz.playback.mode = prefs.playbackMode;
    }
    // R48: restore comet/realtime prefs
    if (prefs.animStyle === 'trail' || prefs.animStyle === 'comet') {
      AppState.viz.playback.animStyle = prefs.animStyle;
    }
    if (typeof prefs.realtimeCycle === 'boolean') {
      AppState.viz.playback.realtimeCycle = prefs.realtimeCycle;
    }
    // R52: restore comet size
    if (typeof prefs.cometScale === 'number' && prefs.cometScale >= 0.75 && prefs.cometScale <= 4.5) {
      AppState.viz.playback.cometScale = prefs.cometScale;
    }
    // R53: one-time migration — comet + real-time become the defaults. Prefs
    // saved before R53 lack the flag, so we override their stored values once;
    // any toggle after this point re-saves with r53Defaults and is respected.
    if (prefs.r53Defaults !== true) {
      AppState.viz.playback.animStyle     = 'comet';
      AppState.viz.playback.realtimeCycle = true;
    }
  } catch(e) { console.warn('[STVIZ] Could not load viz prefs:', e); }
}

/* ── Round 38: Palette / Theme System ── */
const PALETTES = [
  {
    id: 'default',
    label: 'Classic Navy',
    tag: 'Default',
    swatches: ['#0f1a2e','#264068','#3b82f6','#dbeafe'],
  },
  {
    id: 'green-gold',
    label: 'Green & Gold',
    tag: 'Bulldogs 🐾',
    swatches: ['#0f2409','#317323','#c8961a','#d2edca'],
  },
  {
    id: 'dark',
    label: 'Dark Mode',
    tag: 'Navy Dark',
    swatches: ['#0d141f','#304466','#60a5fa','#1e3a5f'],
  },
  {
    id: 'green-gold-dark',
    label: 'Dark Bulldogs',
    tag: 'Green & Gold 🌙',
    swatches: ['#071508','#275829','#e8b01a','#1a3518'],
  },
];

function applyTheme(paletteId) {
  const valid = PALETTES.some(p => p.id === paletteId);
  const id = valid ? paletteId : 'default';
  const root = document.documentElement;
  if (id === 'default') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', id);
  }
  // Sync active state in palette grid if rendered
  document.querySelectorAll('.palette-card').forEach(card => {
    card.classList.toggle('active', card.dataset.paletteId === id);
  });
}

function renderPaletteGrid() {
  const grid = document.getElementById('palette-grid');
  if (!grid) return;
  const current = AppState.settings.palette || 'default';
  grid.innerHTML = PALETTES.map(p => `
    <div class="palette-card${p.id === current ? ' active' : ''}" data-palette-id="${p.id}" role="button" aria-pressed="${p.id === current}" tabindex="0" title="Apply ${p.label} palette">
      <div class="palette-swatches">
        ${p.swatches.map(s => `<div class="palette-swatch" style="background:${s};"></div>`).join('')}
      </div>
      <div class="palette-card-label">${p.label}</div>
      <div class="palette-card-tag">${p.tag}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.palette-card').forEach(card => {
    const handler = () => {
      const id = card.dataset.paletteId;
      AppState.settings.palette = id;
      applyTheme(id);
      saveSettings();
      showToast(`Palette applied: ${PALETTES.find(p=>p.id===id)?.label || id}`, 'success');
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}


/* ==============================================
   ROOM REGISTRY
   A clean list of all assigned rooms.
   Consumed by Schedule Module (Round 5).
=============================================== */

/**
 * Rebuild the global roomRegistry from the current gridData.
 * Each entry: { roomNumber, teacherName, wing, cellCoordinates: {col, row} }
 * For multi-cell grouped classrooms, only the anchor cell is registered once.
 */
let roomRegistry = [];

function rebuildRoomRegistry() {
  roomRegistry = [];
  const seenGroups = new Set();

  // Round 31: iterate every floor so rooms on all floors register, each tagged
  // with its floorId. groupId uniqueness is global, so seenGroups spans floors.
  for (const floor of AppState.blueprint.floors) {
    const gridData = floor.gridData;
    const gridCols = floor.gridCols;
    const gridRows = floor.gridRows;
    if (!gridData) continue;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = gridData[r] && gridData[r][c];
        if (!tile || tile.type !== 'classroom') continue;
        if (tile.groupId) {
          if (seenGroups.has(tile.groupId)) continue;
          if (!isGroupAnchorOn(gridData, gridCols, gridRows, c, r, tile.groupId)) continue;
          seenGroups.add(tile.groupId);
        }
        if (!tile.roomNumber) continue;
        roomRegistry.push({
          roomNumber:           tile.roomNumber,
          teacherName:          tile.teacher || null,
          teacherDept:          tile.dept    || null,
          wing:                 tile.wing    || null,
          excludeFromConflict:  !!(tile.excludeFromConflict),
          floorId:         floor.id,
          cellCoordinates: { col: c, row: r },
        });
      }
    }
  }

  // Sort alphabetically by room number for clean UX downstream
  roomRegistry.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));

  // Notify Schedules module of updated room list
  if (typeof scheduleModuleOnRoomRegistryUpdate === 'function') {
    scheduleModuleOnRoomRegistryUpdate();
  }
  return roomRegistry;
}

/* ==============================================
   LOCALSTORAGE — Blueprint Persistence
=============================================== */
let _autosaveTimer = null;
let _lastBlueprintSaveTime = null;

/**
 * Serialize the full blueprint state into a portable object.
 */
function serializeBlueprint() {
  const bp = AppState.blueprint;
  const s  = AppState.settings;

  // Round 31: serialize each floor as a sparse cells array.
  const floors = bp.floors.map(f => {
    const cells = [];
    if (f.gridData) {
      for (let r = 0; r < f.gridRows; r++) {
        for (let c = 0; c < f.gridCols; c++) {
          const tile = f.gridData[r] && f.gridData[r][c];
          if (tile) cells.push({ col: c, row: r, tile: { ...tile } });
        }
      }
    }
    return {
      id:               f.id,
      label:            f.label,
      gridCols:         f.gridCols,
      gridRows:         f.gridRows,
      cells,
      heatExcludeZones: JSON.parse(JSON.stringify(f.heatExcludeZones || [])),
    };
  });

  // Top-level fields mirror floors[0] so legacy/external readers (and
  // validateBlueprintData) still see a valid single-floor payload.
  const f0 = floors[0] || { gridCols: bp.gridCols, gridRows: bp.gridRows, cells: [], heatExcludeZones: [] };

  return {
    version:          5,
    savedAt:          new Date().toISOString(),
    gridCols:         f0.gridCols,
    gridRows:         f0.gridRows,
    cells:            f0.cells,
    staircasePairs:   deriveSameFloorPairs(bp.floors[0] ? bp.floors[0].id : 'floor_0'),
    heatExcludeZones: f0.heatExcludeZones,
    // Round 31 multi-floor payload:
    floors,
    activeFloorIdx:   bp.activeFloorIdx || 0,
    crossFloorPairs:  JSON.parse(JSON.stringify(bp.crossFloorPairs || [])),
    settings: {
      schoolName: s.schoolName,
      gridSize:   s.gridSize,
      gridCols:   s.gridCols,
      gridRows:   s.gridRows,
      // R59: carried in the blueprint file so a blueprint-only import keeps
      // bell times + subject palette in sync with the building it describes.
      bellSchedule: JSON.parse(JSON.stringify(s.bellSchedule || { A: null, B: null })),
      subjects:     JSON.parse(JSON.stringify(s.subjects || null)),
    },
  };
}

/**
 * Round 31: normalize any blueprint payload (old or new) into a floors[] +
 * crossFloorPairs shape. Mutates `data` in place and returns it.
 */
function migrateBlueprintToFloors(data) {
  if (data && Array.isArray(data.floors) && data.floors.length) {
    if (!Array.isArray(data.crossFloorPairs)) data.crossFloorPairs = [];
    if (typeof data.activeFloorIdx !== 'number') data.activeFloorIdx = 0;
    return data;
  }
  // Pre-Round-31 single-floor payload (top-level cells array).
  data.floors = [{
    id:               'floor_0',
    label:            'Floor 1',
    gridCols:         data.gridCols || 30,
    gridRows:         data.gridRows || 20,
    cells:            Array.isArray(data.cells) ? data.cells : [],
    heatExcludeZones: data.heatExcludeZones || [],
  }];
  data.crossFloorPairs = (data.staircasePairs || []).map(([ka, kb]) => {
    const [ac, ar] = String(ka).split(',').map(Number);
    const [bc, br] = String(kb).split(',').map(Number);
    return { a: { floorId: 'floor_0', col: ac, row: ar },
             b: { floorId: 'floor_0', col: bc, row: br } };
  });
  data.activeFloorIdx = 0;
  return data;
}

/**
 * Apply a deserialized blueprint object to the application state and re-render.
 * Returns true on success, throws on validation failure.
 */
function applyBlueprintData(data) {
  validateBlueprintData(data); // throws if invalid
  migrateBlueprintToFloors(data); // normalize old/new into floors[] shape

  // Reset transient UI state.
  AppState.ui.selectedCell  = null;
  AppState.ui.moveSource    = null;
  AppState.ui.isPairingMode = false;
  AppState.ui.pairingSource = null;
  AppState.ui.editorTarget  = null;

  // Rebuild every floor object from its serialized cells array.
  const floors = data.floors.map((sf, i) => {
    const floor = {
      id:               sf.id || ('floor_' + i),
      label:            sf.label || ('Floor ' + (i + 1)),
      gridCols:         sf.gridCols || 30,
      gridRows:         sf.gridRows || 20,
      gridData:         null,
      heatExcludeZones: JSON.parse(JSON.stringify(sf.heatExcludeZones || [])),
    };
    initFloorGridData(floor);
    for (const entry of (sf.cells || [])) {
      if (entry.col >= 0 && entry.col < floor.gridCols &&
          entry.row >= 0 && entry.row < floor.gridRows) {
        floor.gridData[entry.row][entry.col] = { ...entry.tile };
      }
    }
    return floor;
  });

  AppState.blueprint.floors          = floors;
  AppState.blueprint.crossFloorPairs = JSON.parse(JSON.stringify(data.crossFloorPairs || []));
  AppState.blueprint.activeFloorIdx  = Math.min(data.activeFloorIdx || 0, floors.length - 1);
  syncLegacyMirror(getActiveFloorData());
  _blueprintDirty = true;

  // Re-sync the heat-exclude id counter across ALL floors so new zones don't collide.
  let maxCounter = 0;
  for (const f of floors) {
    for (const z of (f.heatExcludeZones || [])) {
      const n = parseInt((z.id || '').replace('hz_', ''), 10);
      if (!isNaN(n) && n > maxCounter) maxCounter = n;
    }
  }
  _heatExcludeIdCounter = maxCounter + 1;

  // Restore relevant settings (grid dimensions + cell size)
  if (data.settings) {
    if (data.settings.gridSize)   AppState.settings.gridSize   = data.settings.gridSize;
    if (data.settings.gridCols)   AppState.settings.gridCols   = data.settings.gridCols;
    if (data.settings.gridRows)   AppState.settings.gridRows   = data.settings.gridRows;
    // R59: restore bell schedule + subjects when the blueprint file carries them.
    if (data.settings.bellSchedule) AppState.settings.bellSchedule = data.settings.bellSchedule;
    if (Array.isArray(data.settings.subjects)) AppState.settings.subjects = data.settings.subjects;
    normalizeSettings(AppState.settings);
  }

  // Re-render the editor canvas to the active floor's dimensions.
  if (canvas) {
    const af = getActiveFloorData();
    const cellSize = AppState.settings.gridSize;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = af.gridCols * cellSize * dpr;
    canvas.height = af.gridRows * cellSize * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    applyZoom();
    renderCanvas();
  }

  updateTileStats();
  updateStatusBar();
  showRightPanel('empty');
  rebuildRoomRegistry();
  if (typeof FloorManager !== 'undefined') FloorManager.renderTabs();
  if (typeof sizeVizCanvas === 'function') sizeVizCanvas();
  if (typeof clearHistory === 'function') clearHistory();

  return true;
}

/**
 * Validate that a parsed JSON object is a valid blueprint payload.
 * Throws an Error with a user-friendly message if invalid.
 */
function validateBlueprintData(data) {
  if (!data || typeof data !== 'object')
    throw new Error('Invalid file: not a JSON object.');
  // Round 31: a floors-based payload is valid on its own.
  const hasFloors = Array.isArray(data.floors) && data.floors.length > 0;
  if (!hasFloors) {
    if (typeof data.gridCols !== 'number' || typeof data.gridRows !== 'number')
      throw new Error('Invalid file: missing grid dimensions.');
    if (data.gridCols < 5 || data.gridRows < 5 || data.gridCols > 200 || data.gridRows > 200)
      throw new Error('Invalid file: grid dimensions out of range (5–200).');
    if (!Array.isArray(data.cells))
      throw new Error('Invalid file: missing cells array.');
    if (!Array.isArray(data.staircasePairs))
      throw new Error('Invalid file: missing staircasePairs array.');
    if (data.cells.length > 0) {
      const first = data.cells[0];
      if (typeof first.col !== 'number' || typeof first.row !== 'number' || !first.tile)
        throw new Error('Invalid file: malformed cell entry.');
    }
  } else {
    const f0 = data.floors[0];
    if (!f0 || typeof f0.gridCols !== 'number' || typeof f0.gridRows !== 'number')
      throw new Error('Invalid file: malformed floor entry.');
    if (!Array.isArray(f0.cells))
      throw new Error('Invalid file: floor missing cells array.');
  }
}

/**
 * Save blueprint to localStorage (debounced, called automatically on every change).
 */
function saveBlueprintToLocalStorage() {
  try {
    const payload = serializeBlueprint();
    localStorage.setItem(BLUEPRINT_KEY, JSON.stringify(payload));
    _lastBlueprintSaveTime = new Date();
    updateSaveIndicator();
    rebuildRoomRegistry();
  } catch(e) {
    console.warn('[STVIZ] Blueprint auto-save failed:', e);
  }
}

/**
 * Debounce wrapper — saves within 800ms of the last change.
 */
function scheduleBlueprintAutosave() {
  const indicator = document.getElementById('bp-autosave-indicator');
  if (indicator) { indicator.className = 'bp-autosave-indicator saving'; }
  const textEl = document.getElementById('bp-autosave-text');
  if (textEl) textEl.textContent = 'Saving…';

  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    saveBlueprintToLocalStorage();
  }, 800);
}

/**
 * Update the auto-save indicator and status bar badge.
 */
function updateSaveIndicator() {
  const indicator = document.getElementById('bp-autosave-indicator');
  const textEl    = document.getElementById('bp-autosave-text');
  const sbarSaved = document.getElementById('sbar-saved');

  if (_lastBlueprintSaveTime) {
    const timeStr = _lastBlueprintSaveTime.toLocaleTimeString();
    if (indicator) { indicator.className = 'bp-autosave-indicator saved'; }
    if (textEl) textEl.textContent = `Saved ${timeStr}`;
    if (sbarSaved) {
      sbarSaved.style.display = '';
      sbarSaved.title = `Blueprint auto-saved at ${timeStr}`;
    }
  }
}

/**
 * Load blueprint from localStorage on startup.
 */
function loadBlueprintFromLocalStorage() {
  try {
    const raw = localStorage.getItem(BLUEPRINT_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    validateBlueprintData(data);
    applyBlueprintData(data);

    // Restore settings from blueprint if present
    if (data.settings && data.settings.schoolName) {
      // Don't overwrite schoolName if settings were also loaded; settings win
    }

    _lastBlueprintSaveTime = data.savedAt ? new Date(data.savedAt) : new Date();
    updateSaveIndicator();
    return true;
  } catch(e) {
    console.warn('[STVIZ] Could not restore blueprint from localStorage:', e);
    return false;
  }
}

/* ==============================================
   JSON EXPORT
=============================================== */
document.getElementById('btn-export-blueprint').addEventListener('click', () => {
  const payload  = serializeBlueprint();
  const filename = generateExportFilename();
  const json     = JSON.stringify(payload, null, 2);
  const blob     = new Blob([json], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);

  const a  = document.createElement('a');
  a.href   = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const counts = getTileCounts();
  showToast(`Blueprint exported: ${counts.total} tiles, ${roomRegistry.length} rooms.`, 'success');
});

function generateExportFilename() {
  const school = AppState.settings.schoolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'blueprint';
  const date = new Date().toISOString().slice(0, 10);
  return `${school}-blueprint-${date}.json`;
}

/* ==============================================
   JSON IMPORT
=============================================== */
document.getElementById('btn-import-blueprint').addEventListener('click', () => {
  // Check if there's anything on the canvas — warn before overwriting
  const counts = getTileCounts();
  if (counts.total > 0) {
    if (!confirm(
      `Importing a blueprint will replace your current canvas (${counts.total} tile${counts.total !== 1 ? 's' : ''}).\n\nThis cannot be undone. Continue?`
    )) return;
  }
  document.getElementById('bp-import-file').click();
});

document.getElementById('bp-import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Reset input so the same file can be re-imported if needed
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = (evt) => {
    let data;
    try {
      data = JSON.parse(evt.target.result);
    } catch {
      showToast('Import failed: file is not valid JSON.', 'error');
      return;
    }

    try {
      applyBlueprintData(data);
      saveBlueprintToLocalStorage(); // Persist the imported state immediately
      const counts = getTileCounts();
      showToast(
        `Blueprint imported: ${counts.total} tiles, ${roomRegistry.length} assigned room${roomRegistry.length !== 1 ? 's' : ''}.`,
        'success'
      );
    } catch(err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
  };
  reader.onerror = () => showToast('Import failed: could not read file.', 'error');
  reader.readAsText(file);
});

/* ==============================================
   CLEAR SAVED BLUEPRINT (Settings danger zone)
=============================================== */
document.getElementById('btn-clear-saved-blueprint').addEventListener('click', () => {
  const hasData = !!localStorage.getItem(BLUEPRINT_KEY);
  if (!hasData) {
    showToast('No saved blueprint data found in this browser.', 'info');
    return;
  }
  if (!confirm(
    'This will permanently delete the blueprint saved in your browser.\n\nYour exported JSON files are not affected.\n\nContinue?'
  )) return;

  localStorage.removeItem(BLUEPRINT_KEY);
  _lastBlueprintSaveTime = null;
  updateSaveIndicator();

  const indicator = document.getElementById('bp-autosave-indicator');
  const textEl    = document.getElementById('bp-autosave-text');
  if (indicator) { indicator.className = 'bp-autosave-indicator'; }
  if (textEl) textEl.textContent = 'Auto-save on';

  const sbarSaved = document.getElementById('sbar-saved');
  if (sbarSaved) sbarSaved.style.display = 'none';

  showToast('Saved blueprint cleared from browser storage.', 'info');
});

document.getElementById('btn-clear-saved-groups')?.addEventListener('click', () => {
  if (AppState.schedules.groups.length === 0) {
    showToast('No groups to clear.', 'info');
    return;
  }
  if (!confirm(
    `This will permanently delete all ${AppState.schedules.groups.length} student group${AppState.schedules.groups.length !== 1 ? 's' : ''} from your browser.\n\nYour exported JSON files are not affected.\n\nContinue?`
  )) return;

  AppState.schedules.groups = [];
  AppState.schedules.editingGroupId = null;
  AppState.schedules.searchQuery = '';
  const searchInput = document.getElementById('sch-search-input');
  if (searchInput) searchInput.value = '';
  const searchClear = document.getElementById('sch-search-clear');
  if (searchClear) searchClear.style.display = 'none';

  saveSchedules();
  hideEditorForm();
  renderGroupList();
  showToast('All student groups cleared from browser storage.', 'info');
});

/* ==============================================
   BLUEPRINT DATA
=============================================== */
/* ── Round 31: Multi-floor helpers ───────────────────────────────── */

/** The floor object currently shown in the blueprint editor. */
function getActiveFloorData() {
  const floors = AppState.blueprint.floors;
  const idx    = AppState.blueprint.activeFloorIdx;
  return floors[idx] || floors[0];
}

/** Initialize a floor object's gridData 2D array (rows × cols of nulls). */
function initFloorGridData(floor) {
  floor.gridData = Array.from({ length: floor.gridRows }, () =>
    Array.from({ length: floor.gridCols }, () => null)
  );
}

/**
 * Re-point the legacy mirror fields at a floor object (BY REFERENCE so that
 * in-place tile mutations through the mirror persist to the floor).
 */
function syncLegacyMirror(floor) {
  const bp = AppState.blueprint;
  bp.gridData         = floor.gridData;
  bp.gridCols         = floor.gridCols;
  bp.gridRows         = floor.gridRows;
  bp.heatExcludeZones = floor.heatExcludeZones;
  bp.staircasePairs   = deriveSameFloorPairs(floor.id);
  AppState.settings.gridCols = floor.gridCols;
  AppState.settings.gridRows = floor.gridRows;
}

/** Legacy staircasePairs format (['col,row','col,row']) for same-floor pairs on one floor. */
function deriveSameFloorPairs(floorId) {
  return (AppState.blueprint.crossFloorPairs || [])
    .filter(p => p.a.floorId === floorId && p.b.floorId === floorId)
    .map(p => [`${p.a.col},${p.a.row}`, `${p.b.col},${p.b.row}`]);
}

/** Switch which floor the blueprint editor shows; re-syncs all legacy mirrors. */
function switchActiveFloor(idx) {
  const floors = AppState.blueprint.floors;
  if (idx < 0 || idx >= floors.length) return;

  // Close playback before switching floors (Round 30 integration).
  if (AppState.viz && AppState.viz.playback && AppState.viz.playback.active &&
      typeof PlaybackController !== 'undefined') {
    PlaybackController.close();
  }

  AppState.blueprint.activeFloorIdx = idx;
  syncLegacyMirror(floors[idx]);

  _blueprintDirty = true; // invalidate pathfinding cache (Round 27 dirty flag)

  // Resize the editor canvas to the floor's dimensions before redrawing.
  if (canvas) {
    const cellSize = getEffectiveCellSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = floors[idx].gridCols * cellSize * dpr;
    canvas.height = floors[idx].gridRows * cellSize * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    applyZoom();
  }

  AppState.ui.selectedCell  = null;

  // R43: If pairing mode is active, PRESERVE it across the floor switch so the
  // user can pair staircases across floors. The right panel closes (we don't
  // know which cell is selected on the new floor), but pairing remains armed.
  // The floor-pairing-banner (added in the floor-manager-strip) provides the
  // persistent visual cue.
  if (AppState.ui.isPairingMode) {
    // Just close the right panel; keep isPairingMode + pairingSource intact.
    showRightPanel('empty');
    updateFloorPairingBanner();
  } else {
    AppState.ui.isPairingMode = false;
    AppState.ui.pairingSource = null;
    showRightPanel('empty');
  }

  renderCanvas();
  updateTileStats();
  updateStatusBar();
  if (typeof FloorManager !== 'undefined') FloorManager.renderTabs();
}

function initGridData(cols, rows, clear = false) {
  const bp = AppState.blueprint;
  const floor = getActiveFloorData();
  const prevData = floor.gridData;
  const prevCols = floor.gridCols;
  const prevRows = floor.gridRows;

  floor.gridCols = cols;
  floor.gridRows = rows;
  AppState.settings.gridCols = cols;
  AppState.settings.gridRows = rows;

  const newGrid = Array.from({ length: rows }, () => Array(cols).fill(null));

  if (!clear && prevData && prevData.length > 0) {
    const copyRows = Math.min(prevRows, rows);
    const copyCols = Math.min(prevCols, cols);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        if (prevData[r] && prevData[r][c]) {
          newGrid[r][c] = { ...prevData[r][c] };
        }
      }
    }
  }

  if (clear) {
    // Remove every cross-floor pair that touches this floor.
    bp.crossFloorPairs = (bp.crossFloorPairs || []).filter(
      p => p.a.floorId !== floor.id && p.b.floorId !== floor.id
    );
  }

  floor.gridData = newGrid;
  syncLegacyMirror(floor); // re-point mirrors at the (now resized) floor
  _blueprintDirty = true;
}

/* ── Round 31: FloorManager — blueprint floor tabs ───────────────── */
const FloorManager = {
  generateFloorId() {
    return 'floor_' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  },

  addFloor() {
    const floors  = AppState.blueprint.floors;
    const current = floors[AppState.blueprint.activeFloorIdx] || floors[0];
    const newFloor = {
      id:               this.generateFloorId(),
      label:            `Floor ${floors.length + 1}`,
      gridData:         null,
      gridCols:         current.gridCols,
      gridRows:         current.gridRows,
      heatExcludeZones: [],
    };
    initFloorGridData(newFloor);
    beginAction();
    floors.push(newFloor);
    _blueprintDirty = true;
    switchActiveFloor(floors.length - 1);
    commitAction();
    if (typeof sizeVizCanvas === 'function') sizeVizCanvas();
    scheduleBlueprintAutosave();
    showToast(`${newFloor.label} added.`, 'success');
  },

  removeFloor(idx) {
    const floors = AppState.blueprint.floors;
    if (floors.length <= 1) { showToast('Cannot remove the last floor.', 'warn'); return; }
    if (!confirm(`Remove "${floors[idx].label}"? All tiles on this floor will be erased. Cannot be undone.`)) return;
    const removedId = floors[idx].id;
    floors.splice(idx, 1);
    AppState.blueprint.crossFloorPairs = (AppState.blueprint.crossFloorPairs || []).filter(
      p => p.a.floorId !== removedId && p.b.floorId !== removedId
    );
    _blueprintDirty = true;
    const newIdx = Math.min(idx, floors.length - 1);
    switchActiveFloor(newIdx);
    if (typeof sizeVizCanvas === 'function') sizeVizCanvas();
    clearHistory(); // floor removal is non-undoable; clear stale snapshots
    scheduleBlueprintAutosave();
    showToast('Floor removed.', 'info');
  },

  renameFloor(idx, newLabel) {
    const f = AppState.blueprint.floors[idx];
    if (!f || !newLabel.trim()) return;
    f.label = newLabel.trim();
    scheduleBlueprintAutosave();
  },

  renderTabs() {
    const list = document.getElementById('floor-tab-list');
    if (!list) return;
    const floors = AppState.blueprint.floors;
    const active = AppState.blueprint.activeFloorIdx;

    list.innerHTML = floors.map((f, i) => `
      <div class="floor-tab ${i === active ? 'active' : ''}" data-floor-idx="${i}">
        <span class="floor-tab-label" ${i === active ? 'contenteditable="true"' : ''}
              data-floor-idx="${i}">${escHtml(f.label)}</span>
        ${floors.length > 1
          ? `<button class="floor-tab-remove" data-remove-idx="${i}" title="Remove this floor">
               <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round">
                 <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
               </svg>
             </button>`
          : ''}
      </div>
    `).join('');

    list.querySelectorAll('.floor-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.floor-tab-remove')) return;
        if (e.target.closest('[contenteditable="true"]')) return;
        switchActiveFloor(+tab.dataset.floorIdx);
      });
    });

    list.querySelectorAll('.floor-tab-label[contenteditable]').forEach(el => {
      el.addEventListener('blur',    () => FloorManager.renameFloor(+el.dataset.floorIdx, el.textContent));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });

    list.querySelectorAll('.floor-tab-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        FloorManager.removeFloor(+btn.dataset.removeIdx);
      });
    });
  },
};

function getTile(col, row) {
  const { gridData, gridCols, gridRows } = AppState.blueprint;
  if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) return null;
  return gridData[row][col] || null;
}

function setTile(col, row, tileData) {
  const { gridData, gridCols, gridRows } = AppState.blueprint;
  if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) return;
  gridData[row][col] = tileData;
  _blueprintDirty = true;
}

function getTileCounts() {
  const { gridData, gridCols, gridRows } = AppState.blueprint;
  const counts = { classroom: 0, hallway: 0, staircase: 0, dummy: 0, total: 0 };
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const t = gridData[r][c];
      if (t) { counts[t.type] = (counts[t.type] || 0) + 1; counts.total++; }
    }
  }
  return counts;
}

/* ==============================================
   STAIRCASE PAIRING
=============================================== */

/**
 * Returns the pair index (into crossFloorPairs) for a staircase on the ACTIVE
 * floor, or -1 if unpaired. crossFloorPairs is the source of truth.
 */
function getPairIndex(col, row) {
  const fid = getActiveFloorData().id;
  const pairs = AppState.blueprint.crossFloorPairs || [];
  return pairs.findIndex(p =>
    (p.a.floorId === fid && p.a.col === col && p.a.row === row) ||
    (p.b.floorId === fid && p.b.col === col && p.b.row === row));
}

/**
 * Returns the pair letter label ('A', 'B', etc.)
 */
function getPairLabel(pairIndex) {
  return String.fromCharCode(65 + (pairIndex % 26));
}

/**
 * Get the partner cell for a staircase on the ACTIVE floor, or null.
 * Returns { col, row, floorId } so callers can show the partner's floor.
 */
function getPairPartner(col, row) {
  const fid = getActiveFloorData().id;
  for (const p of (AppState.blueprint.crossFloorPairs || [])) {
    if (p.a.floorId === fid && p.a.col === col && p.a.row === row)
      return { col: p.b.col, row: p.b.row, floorId: p.b.floorId };
    if (p.b.floorId === fid && p.b.col === col && p.b.row === row)
      return { col: p.a.col, row: p.a.row, floorId: p.a.floorId };
  }
  return null;
}

/** Floor label for a given floor id (falls back to the id). */
function floorLabelById(floorId) {
  const f = (AppState.blueprint.floors || []).find(fl => fl.id === floorId);
  return f ? f.label : floorId;
}

/**
 * Pair two staircase tiles. floorIdA/floorIdB default to the active floor.
 * Writes to crossFloorPairs (source of truth) and re-derives the mirror.
 */
function pairStaircases(colA, rowA, colB, rowB, floorIdA, floorIdB) {
  const fidA = floorIdA || getActiveFloorData().id;
  const fidB = floorIdB || getActiveFloorData().id;

  // Remove any existing pairs for these specific (floor,cell) endpoints.
  unpairStaircaseOn(fidA, colA, rowA);
  unpairStaircaseOn(fidB, colB, rowB);

  AppState.blueprint.crossFloorPairs.push({
    a: { floorId: fidA, col: colA, row: rowA },
    b: { floorId: fidB, col: colB, row: rowB },
  });
  // Keep the legacy same-floor mirror current for the active floor.
  AppState.blueprint.staircasePairs = deriveSameFloorPairs(getActiveFloorData().id);
  _blueprintDirty = true;
}

/** Remove pairing for a staircase endpoint on a specific floor. */
function unpairStaircaseOn(floorId, col, row) {
  const pairs = AppState.blueprint.crossFloorPairs || [];
  const idx = pairs.findIndex(p =>
    (p.a.floorId === floorId && p.a.col === col && p.a.row === row) ||
    (p.b.floorId === floorId && p.b.col === col && p.b.row === row));
  if (idx !== -1) pairs.splice(idx, 1);
}

/** Remove pairing for a staircase on the ACTIVE floor. */
function unpairStaircase(col, row) {
  unpairStaircaseOn(getActiveFloorData().id, col, row);
  AppState.blueprint.staircasePairs = deriveSameFloorPairs(getActiveFloorData().id);
  _blueprintDirty = true;
}

/* ==============================================
   UNDO / REDO HISTORY (blueprint mutations)
=============================================== */
const HISTORY_LIMIT = 10;
let undoStack = [];
let redoStack = [];
let pendingSnapshot = null; // snapshot captured at the start of a gesture

function _snapGrid() {
  // Deep-copy the full multi-floor state for the undo stack.
  // Named _snapGrid (R46) — distinct from the named-project saveSnapshot/restoreSnapshot system.
  return JSON.stringify({
    floors:          AppState.blueprint.floors,
    crossFloorPairs: AppState.blueprint.crossFloorPairs,
    activeFloorIdx:  AppState.blueprint.activeFloorIdx,
  });
}

// Renamed _restoreGrid (R46): was restoreSnapshot(snap) — that name collides with the
// named-project restoreSnapshot(slot) in the snapshot-manager section, causing
// undoBlueprint() to call the wrong function and show "Snapshot not found."
function _restoreGrid(snap) {
  const obj = JSON.parse(snap);
  AppState.blueprint.floors          = obj.floors || [];
  AppState.blueprint.crossFloorPairs = obj.crossFloorPairs || [];
  AppState.blueprint.activeFloorIdx  =
    Math.min(obj.activeFloorIdx || 0, AppState.blueprint.floors.length - 1);
  syncLegacyMirror(getActiveFloorData());
  rebuildRoomRegistry();
  _blueprintDirty = true;
}

/** Capture the state just before a mutating action begins. */
function beginAction() {
  pendingSnapshot = _snapGrid();
}

/** Commit the pending action onto the undo stack if anything actually changed. */
function commitAction() {
  if (pendingSnapshot === null) return;
  const now = _snapGrid();
  if (now !== pendingSnapshot) {
    undoStack.push(pendingSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }
  pendingSnapshot = null;
}

/** Convenience wrapper for a discrete (non-gesture) mutation. */
function runAction(fn) {
  beginAction();
  fn();
  commitAction();
}

function undoBlueprint() {
  if (!undoStack.length) return;
  redoStack.push(_snapGrid());
  _restoreGrid(undoStack.pop());
  afterHistoryRestore();
  showToast('Undo.', 'info');
}

function redoBlueprint() {
  if (!redoStack.length) return;
  undoStack.push(_snapGrid());
  _restoreGrid(redoStack.pop());
  afterHistoryRestore();
  showToast('Redo.', 'info');
}

function afterHistoryRestore() {
  // A restored selection may now point at a different/absent tile — clear it.
  AppState.ui.selectedCell  = null;
  AppState.ui.moveSource    = null;
  AppState.ui.isPairingMode = false;
  AppState.ui.pairingSource = null;
  AppState.ui.tileDrag      = null;
  if (canvas) canvas.classList.remove('tile-dragging', 'has-pickup');
  // Round 31: floors/dimensions may have changed — resize the editor canvas.
  if (canvas) {
    const f = getActiveFloorData();
    const cellSize = getEffectiveCellSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = f.gridCols * cellSize * dpr;
    canvas.height = f.gridRows * cellSize * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    applyZoom();
  }
  if (typeof FloorManager !== 'undefined') FloorManager.renderTabs();
  renderCanvas();
  updateTileStats();
  updateStatusBar();
  showRightPanel('empty');
  scheduleBlueprintAutosave();
  updateUndoRedoButtons();
}

/** Wipe history — used after loading/importing/resetting a whole blueprint. */
function clearHistory() {
  undoStack = [];
  redoStack = [];
  pendingSnapshot = null;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

