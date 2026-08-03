/* viz-playback.js — part of the School Layout Visualizer.
   Was lines 12233-15962 of Tools/schedule-visualizer.html. Cut out verbatim; the
   text below is byte-identical to what was inline, because the publish path
   puts br* function source into published files via Function.prototype.toString()
   and because the acorn equivalence check in schedule/test/structure.mjs
   compares this source against the original.

   Classic <script>, not a module. Top-level const/let bind in the shared
   global lexical scope, so declarations here are visible to every later file.
   LOAD ORDER IS SOURCE ORDER and must stay that way: the tool runs 19
   top-level statements, including DOM listener wiring that binds at parse time.
   See the <script src> list at the bottom of schedule-visualizer.html. */

/* ==============================================================
   ROUND 9 — PATH VISUALIZATION MODULE (Module 4, part 1)
   ──────────────────────────────────────────────────────────────
   Renders student-group day paths on a read-only copy of the
   blueprint canvas. Implements:
     • Four display modes (single / comparison≤4 / by-grade / all)
     • Per-group colored polylines through hallway-cell centers
     • Parallel offset rendering so paths sharing a corridor sit
       side-by-side instead of overlapping
     • Classroom endpoint dots + optional mod-transition labels
     • Independent zoom / pan that mirrors the Blueprint canvas
   The green→red congestion gradient + congestion summary panel
   land in Round 10; this round colors each path by its group.
=============================================================== */

/* ---- Visualization state ---- */
AppState.viz = {
  zoom:          1.0,
  displayMode:   'single',     // 'single' | 'comparison' | 'grade' | 'all'
  singleGroupId: null,
  comparisonIds: [],           // up to 4 group ids
  gradeFilter:   null,
  showMarkers:   true,
  constantWidth: false,
  rendered:      null,         // { entries, laneMap, stats, congestion, maxCongestion, hotspots } or null
  congestionOpen: true,        // congestion dock expanded? (default open; overridden by saved pref)
  vizDay:        'A',          // 'A' or 'B' — which schedule day to render
  transitionFilter: null,      // null = all; or integer 1..N meaning "mod N → mod N+1"
  exportScale:   'high',       // Round 22: 'standard' | 'high' | 'print'
  // Round 30: animated path playback state (kept inside this block so it is
  // created atomically with the rest of viz state — no separate init race).
  playback: {
    active:       false,           // is the playback bar visible/enabled
    playing:      false,           // currently animating
    currentStep:  0,               // transition index (0 = mod1→mod2, …)
    mode:         'simultaneous',  // 'simultaneous' | 'sequential'
    speed:        1.0,             // 0.5 | 1.0 | 2.0
    raf:          null,            // requestAnimationFrame handle
    progress:     0,               // 0..1 within current animation cycle
    seqGroupIdx:  0,               // active group in sequential mode
    loopAll:      false,           // R32: loop entire day continuously
    loopOne:      false,           // R32: loop only the current transition
    animStyle:    'comet',         // R53: comet mode on by default ('trail' | 'comet')
    realtimeCycle: true,           // R50: real-time mode on by default
    _r50CycleMs:  0,               // R50: collision-sim cycle duration (ms), 0 = not yet computed
    cometScale:   1.5,             // R52: group icon (comet/head dot) size multiplier
  },
};

const VIZ_MAX_COMPARE = 4;
const VIZ_BASE_STROKE = 4.5;   // native px (cellSize 40 baseline)
const VIZ_BASE_LANE   = 5.0;   // native px lane spacing
const VIZ_DIM_ALPHA   = 0.42;  // white veil over the blueprint

/* ── Round 31: stacked multi-floor layout ── */
const FLOOR_GAP     = 56;   // logical px gap between stacked floor panels
const FLOOR_LABEL_H = 26;   // logical px height of each floor's label bar

/** Vertical pixel offset (logical px) of a floor panel's top edge within the viz canvas. */
function floorOffsetY(floorId) {
  const cellSize = getEffectiveCellSize();
  let y = 0;
  for (const f of AppState.blueprint.floors) {
    y += FLOOR_LABEL_H; // label bar sits above each floor's grid
    if (f.id === floorId) return y;
    y += f.gridRows * cellSize + FLOOR_GAP;
  }
  return y; // fallback (shouldn't happen)
}

/** Total logical-pixel height needed to stack every floor panel. */
function totalVizCanvasHeight() {
  const cellSize = getEffectiveCellSize();
  const floors = AppState.blueprint.floors;
  let h = 0;
  floors.forEach((f, i) => {
    h += FLOOR_LABEL_H + f.gridRows * cellSize;
    if (i < floors.length - 1) h += FLOOR_GAP;
  });
  return h;
}

/** Max grid width (logical px) across all floors. */
function maxFloorWidthPx() {
  const cellSize = getEffectiveCellSize();
  return Math.max(...AppState.blueprint.floors.map(f => f.gridCols * cellSize), cellSize);
}

/** Map a logical-pixel y on the stacked viz canvas → { floorId, row } or null (gap/label). */
function vizFloorAtY(y) {
  const cellSize = getEffectiveCellSize();
  let top = 0;
  for (const f of AppState.blueprint.floors) {
    const gridTop = top + FLOOR_LABEL_H;
    const gridBot = gridTop + f.gridRows * cellSize;
    if (y >= gridTop && y < gridBot) {
      return { floorId: f.id, row: Math.floor((y - gridTop) / cellSize) };
    }
    top = gridBot + FLOOR_GAP;
  }
  return null;
}

let vizCanvas, vizCtx;
let _vizCanvasInit = false;

/* Pulse overlay (top-3 hotspots) */
let vizPulseCanvas, vizPulseCtx;
let _vizPulseRAF = null;
let _vizPulseCells = [];       // [{x,y,color}] top-3 cells to pulse

/* --------------------------------------------------------------
   ROUND 10 — CONGESTION COLOR + LABEL HELPERS
-------------------------------------------------------------- */
/**
 * HEAT_STOPS — perceptual 5-stop palette for corridor congestion.
 *   Quantized by load ratio so each band is a clean, unambiguous color;
 *   avoids the muddy brown midtones of linear RGB interpolation.
 *   stop[0] → lightest load (green), stop[4] → heaviest (red).
 */
const HEAT_STOPS = ['#22c55e', '#84cc16', '#facc15', '#f97316', '#ef4444'];

/**
 * congestionColor(load, maxC) — maps a hallway cell's path count to a color.
 *   Signature is unchanged; callers pass (count, max) as before.
 *   load 1 → HEAT_STOPS[0] (green); load === maxC → HEAT_STOPS[4] (red).
 */
function congestionColor(load, maxC) {
  if (!maxC || maxC < 1) return HEAT_STOPS[0];
  const ratio = Math.min(load / maxC, 1);
  const idx   = Math.min(Math.floor(ratio * HEAT_STOPS.length), HEAT_STOPS.length - 1);
  return HEAT_STOPS[idx];
}

/* ── R59: congestion display helpers ──
   Internally all loads are student-weighted (each segment contributes
   groupWeight instead of 1). When no group has an explicit size that is a
   uniform ×defaultGroupSize scaling, so dividing back out reproduces the
   exact pre-R59 group counts for display; when sizes exist we surface the
   weighted number as an estimated student count. */
function congestionDisplayLoad(meta, weightedLoad) {
  const dgs = (meta && meta.defaultGroupSize) || AppState.settings.defaultGroupSize || 25;
  return (meta && meta.weighted) ? Math.round(weightedLoad) : Math.round(weightedLoad / dgs);
}
function congestionDisplayText(meta, weightedLoad) {
  const n = congestionDisplayLoad(meta, weightedLoad);
  return (meta && meta.weighted) ? ('~' + n) : String(n);
}

/**
 * cellCongestionLabel(x, y) — a human-friendly label for a hallway cell.
 *   Priority: corridorLabel on cell (±2 radius) > wing of nearest room > "Hallway by RoomNumber" > "Hallway"
 *   Sub-line: nearest doored rooms within 8 cells, else nearest room within 4 cells.
 */
function cellCongestionLabel(x, y, floorId) {
  const fid = floorId || getActiveFloorData().id;
  const floorObj = (AppState.blueprint.floors || []).find(f => f.id === fid) || getActiveFloorData();
  const gridData = floorObj.gridData || [];
  const f0id = AppState.blueprint.floors[0] && AppState.blueprint.floors[0].id;
  // Only consider rooms registered on this same floor.
  const rooms = roomRegistry.filter(r => (r.floorId || f0id) === fid);

  // 1) Check for a corridorLabel on this cell or within Manhattan distance 2.
  let label = null;
  let bestLabelDist = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > 2) continue;
      const row = y + dy, col = x + dx;
      const t = gridData[row] && gridData[row][col];
      if (t && t.corridorLabel) {
        if (d < bestLabelDist) { bestLabelDist = d; label = t.corridorLabel; }
      }
    }
  }

  // If no corridor label, fall back to wing/room approach for the primary label.
  if (!label) {
    let best = null, bestD = Infinity;
    for (const room of rooms) {
      if (!room.wing) continue;
      const d = Math.abs(room.cellCoordinates.col - x) + Math.abs(room.cellCoordinates.row - y);
      if (d < bestD) { bestD = d; best = room; }
    }
    if (best && bestD <= 4) {
      label = best.wing;
    } else {
      // Nearest any room
      let nr = null, nd = Infinity;
      for (const room of rooms) {
        const d = Math.abs(room.cellCoordinates.col - x) + Math.abs(room.cellCoordinates.row - y);
        if (d < nd) { nd = d; nr = room; }
      }
      label = (nr && nd <= 4) ? `Hallway by ${nr.roomNumber}` : 'Hallway';
    }
  }

  // 2) Build sub-line: rooms with at least one door, within 8 cells.
  const DOOR_THRESHOLD = 8;
  const FALLBACK_THRESHOLD = 4;
  const dooredRooms = [];
  for (const room of rooms) {
    const { col, row } = room.cellCoordinates;
    const tile = gridData[row] && gridData[row][col];
    const hasDoor = tile && tile.doors && tile.doors.length > 0;
    if (!hasDoor) continue;
    const d = Math.abs(col - x) + Math.abs(row - y);
    if (d <= DOOR_THRESHOLD) dooredRooms.push({ room, d });
  }
  dooredRooms.sort((a, b) => a.d - b.d);
  const nearest2 = dooredRooms.slice(0, 2);

  let sub = null;
  if (nearest2.length === 1) {
    sub = `Door: ${nearest2[0].room.roomNumber}`;
  } else if (nearest2.length >= 2) {
    sub = `Doors: ${nearest2[0].room.roomNumber}, ${nearest2[1].room.roomNumber}`;
  } else {
    // Fallback: nearest room (with or without door) within 4 cells
    let nr = null, nd = Infinity;
    for (const room of rooms) {
      const d = Math.abs(room.cellCoordinates.col - x) + Math.abs(room.cellCoordinates.row - y);
      if (d < nd) { nd = d; nr = room; }
    }
    if (nr && nd <= FALLBACK_THRESHOLD) sub = `near ${nr.roomNumber}`;
  }

  return { label, sub };
}

/* --------------------------------------------------------------
   CANVAS SETUP
-------------------------------------------------------------- */
function initVizCanvas() {
  vizCanvas = document.getElementById('viz-canvas');
  if (!vizCanvas) return;
  vizCtx = vizCanvas.getContext('2d');
  vizPulseCanvas = document.getElementById('viz-pulse-canvas');
  if (vizPulseCanvas) vizPulseCtx = vizPulseCanvas.getContext('2d');
  sizeVizCanvas();
  bindVizCanvasEvents();
  _vizCanvasInit = true;
}

function sizeVizCanvas() {
  if (!vizCanvas) return;
  const logicalW = maxFloorWidthPx();
  const logicalH = totalVizCanvasHeight();
  const dpr = window.devicePixelRatio || 1;
  const needW = logicalW * dpr;
  const needH = logicalH * dpr;
  if (vizCanvas.width !== needW || vizCanvas.height !== needH) {
    vizCanvas.width  = needW;
    vizCanvas.height = needH;
    vizCtx = vizCanvas.getContext('2d');
    vizCtx.scale(dpr, dpr);
    vizCanvas.style.width  = logicalW + 'px';
    vizCanvas.style.height = logicalH + 'px';
    if (vizPulseCanvas) {
      vizPulseCanvas.width  = needW;
      vizPulseCanvas.height = needH;
      vizPulseCtx = vizPulseCanvas.getContext('2d');
      vizPulseCtx.scale(dpr, dpr);
      vizPulseCanvas.style.width  = vizCanvas.style.width;
      vizPulseCanvas.style.height = vizCanvas.style.height;
    }
    applyVizZoom();
  }
}
/** Round 31: alias used by FloorManager. */
function resizeVizCanvas() { sizeVizCanvas(); }

function applyVizZoom() {
  if (!vizCanvas) return;
  const z = AppState.viz.zoom;
  const logicalW = maxFloorWidthPx();
  const logicalH = totalVizCanvasHeight();
  vizCanvas.style.transformOrigin = 'top left';
  vizCanvas.style.transform = `scale(${z})`;
  if (vizPulseCanvas) {
    vizPulseCanvas.style.transformOrigin = 'top left';
    vizPulseCanvas.style.transform = `scale(${z})`;
  }
  const wrapper = document.getElementById('viz-canvas-wrapper');
  if (wrapper) {
    wrapper.style.width  = Math.max((logicalW * z) + 48, 0) + 'px';
    wrapper.style.height = Math.max((logicalH * z) + 48, 0) + 'px';
  }
  const disp = document.getElementById('viz-zoom-display');
  if (disp) disp.textContent = `Zoom: ${Math.round(z * 100)}%`;
}

function adjustVizZoom(delta) {
  AppState.viz.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, AppState.viz.zoom + delta));
  applyVizZoom();
  // Constant-width mode needs a redraw so strokes re-scale to the new zoom.
  if (AppState.viz.constantWidth) renderVizCanvas();
}

function bindVizCanvasEvents() {
  const area = document.getElementById('viz-canvas-area');

  // Ctrl + wheel zoom (matches Blueprint behaviour).
  area.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    adjustVizZoom(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  }, { passive: false });

  // Click-drag panning over the read-only canvas.
  let panning = false, startX = 0, startY = 0, startL = 0, startT = 0;
  vizCanvas.addEventListener('mousedown', (e) => {
    panning = true;
    startX = e.clientX; startY = e.clientY;
    startL = area.scrollLeft; startT = area.scrollTop;
    vizCanvas.classList.add('panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    area.scrollLeft = startL - (e.clientX - startX);
    area.scrollTop  = startT - (e.clientY - startY);
  });
  window.addEventListener('mouseup', () => {
    panning = false;
    if (vizCanvas) vizCanvas.classList.remove('panning');
  });

  // ── Round 21: Hover tooltip ──────────────────────────────────────────────
  const tooltip    = document.getElementById('viz-hover-tooltip');
  const vhtCoord   = document.getElementById('vht-coord');
  const vhtLabel   = document.getElementById('vht-label');
  const vhtCrossing = document.getElementById('vht-crossing');   // R30
  const vhtGroups  = document.getElementById('vht-groups');
  let _tooltipRAF  = null;

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove('visible');
  }

  const vhtGroupsTitle = document.getElementById('vht-groups-title');

  vizCanvas.addEventListener('mousemove', (e) => {
    if (panning || !tooltip) return;
    tooltip._lastXY = { x: e.clientX, y: e.clientY };   // R53: for playback-loop refresh

    // Cancel any pending frame to avoid stale updates.
    if (_tooltipRAF) cancelAnimationFrame(_tooltipRAF);
    _tooltipRAF = requestAnimationFrame(() => {
      const rendered = AppState.viz.rendered;
      if (!rendered || !rendered.entries.length) { hideTooltip(); return; }

      // Map mouse position → (floor, grid cell) across stacked panels.
      const rect = vizCanvas.getBoundingClientRect();
      const z = AppState.viz.zoom;
      const cellSize = getEffectiveCellSize();
      const localX = (e.clientX - rect.left) / z;
      const localY = (e.clientY - rect.top)  / z;
      const cx = Math.floor(localX / cellSize);
      const hit = vizFloorAtY(localY);
      if (!hit) { hideTooltip(); return; }
      const cy2 = hit.row;
      const hitFloorId = hit.floorId;

      const floorObj = AppState.blueprint.floors.find(f => f.id === hitFloorId);
      const tile = floorObj && floorObj.gridData[cy2] ? floorObj.gridData[cy2][cx] : null;
      if (!tile || tile.type !== 'hallway') { hideTooltip(); return; }

      // Identify which groups traverse this specific hallway cell.
      const k = floorCellKey(hitFloorId, cx, cy2);

      // R53: live occupants — comet heads currently inside this square.
      // Shown only while playback is active; tails are ignored by design
      // (drawPlaybackFrame registers head cells only).
      const liveTitle = document.getElementById('vht-live-title');
      const liveBox   = document.getElementById('vht-live-groups');
      const liveSep   = document.getElementById('vht-live-sep');
      if (liveTitle && liveBox && liveSep) {
        const pbT   = AppState.viz.playback;
        const heads = (pbT && pbT.active && pbT._liveHeads) ? pbT._liveHeads.get(k) : null;
        const showLive = !!(pbT && pbT.active && pbT._liveHeads);
        if (showLive) {
          if (heads && heads.length) {
            liveBox.innerHTML = heads.map(h => `
              <div class="vht-group-row">
                <span class="vht-group-dot" style="background:${h.color}"></span>
                <span class="vht-group-name">${h.name}</span>
                <span class="vht-load-chip">here</span>
              </div>`).join('');
          } else {
            liveBox.innerHTML = '<div class="vht-no-groups">No groups here right now</div>';
          }
        }
        liveTitle.style.display = showLive ? '' : 'none';
        liveBox.style.display   = showLive ? '' : 'none';
        liveSep.style.display   = showLive ? '' : 'none';
      }

      const cmap = rendered && rendered.contributors ? rendered.contributors.get(k) : null;
      const colorByName = new Map();
      for (const g of (rendered.entries || [])) colorByName.set(g.name, g.color || '#3b82f6');

      // Build sorted list: groups that pass through this cell.
      const groupsHere = [];
      if (cmap) {
        for (const [name, count] of cmap.entries()) {
          groupsHere.push({ name, count, color: colorByName.get(name) || '#3b82f6' });
        }
        groupsHere.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      }

      // Populate tooltip content.
      vhtCoord.textContent = `Col ${cx + 1}, Row ${cy2 + 1}`;
      const loc = cellCongestionLabel(cx, cy2, hitFloorId);
      vhtLabel.textContent = loc.label + (loc.sub ? ` — ${loc.sub}` : '');

      // R30: estimated single-tile crossing time + how many groups pass here.
      if (vhtCrossing) {
        const walkSec = (AppState.settings.tileWalkTime != null) ? AppState.settings.tileWalkTime : 3;
        const nHere   = groupsHere.length;
        vhtCrossing.textContent = `Est. crossing: ~${walkSec}s · ${nHere} group${nHere === 1 ? '' : 's'}`;
      }

      // Update the title line to reflect active mod filter.
      const tf = AppState.viz.transitionFilter;
      if (vhtGroupsTitle) {
        if (tf !== null) {
          const labels = getAllModLabels();
          const fromLabel = labels[tf - 1] || ('Mod ' + tf);
          const toLabel   = labels[tf]     || ('Mod ' + (tf + 1));
          vhtGroupsTitle.textContent = `${fromLabel} → ${toLabel}`;
        } else {
          vhtGroupsTitle.textContent = 'Groups using this corridor';
        }
      }

      if (groupsHere.length === 0) {
        vhtGroups.innerHTML = '<div class="vht-no-groups">No active paths here</div>';
      } else {
        const maxCount = Math.max(...groupsHere.map(g => g.count), 1);
        vhtGroups.innerHTML = groupsHere.map(g => `
          <div class="vht-group-row">
            <span class="vht-group-dot" style="background:${g.color}"></span>
            <span class="vht-group-name">${g.name}</span>
            <span class="vht-load-chip">${g.count}×</span>
          </div>`).join('');
      }

      // Position tooltip near cursor, keeping it within viewport.
      // TH is a fixed upper bound — avoids reading offsetHeight on a just-mutated
      // element whose layout may not yet reflect the new innerHTML.
      const TW = 230, TH = 210;   // R53: taller bound — live-occupants section
      const MARGIN = 14;
      let tx = e.clientX + MARGIN;
      let ty = e.clientY + MARGIN;
      if (tx + TW > window.innerWidth  - 8) tx = e.clientX - TW - MARGIN;
      if (ty + TH > window.innerHeight - 8) ty = e.clientY - TH - MARGIN;
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
      tooltip.classList.add('visible');
    });
  });

  vizCanvas.addEventListener('mouseleave', hideTooltip);
  area.addEventListener('mouseleave', hideTooltip);
  // Hide while panning.
  vizCanvas.addEventListener('mousedown', hideTooltip);
}

/* --------------------------------------------------------------
   GROUP SELECTION PER MODE
-------------------------------------------------------------- */
function vizGroupById(id) {
  return AppState.schedules.groups.find(g => g.id === id) || null;
}

/** Returns the ordered list of group objects to render for the active mode. */
function vizGroupsForMode() {
  const groups = AppState.schedules.groups;
  const v = AppState.viz;
  switch (v.displayMode) {
    case 'single': {
      const g = vizGroupById(v.singleGroupId);
      return g ? [g] : [];
    }
    case 'comparison':
      return v.comparisonIds.map(vizGroupById).filter(Boolean).slice(0, VIZ_MAX_COMPARE);
    case 'grade':
      return groups.filter(g => String(g.grade ?? '') === String(v.gradeFilter ?? '') && v.gradeFilter != null && v.gradeFilter !== '');
    case 'all':
      return groups.slice();
    default:
      return [];
  }
}

/* --------------------------------------------------------------
   BUILD RENDER DATA
   For each group, resolve its full day into drawable sub-polylines
   (teleport jumps split into separate strokes), collect every cell
   it occupies (for the lane map), and gather room markers + stats.
-------------------------------------------------------------- */
function buildVizRenderData(groups) {
  const graph = getPathfindingGraph();
  const entries = [];
  const day = AppState.viz.vizDay || 'A';

  groups.forEach((group, rank) => {
    const segments = findGroupDayPath(group.name, day) || [];
    const subPaths   = [];   // [ {cells:[{x,y,floorId}…], fromMod, floorId}, … ]
    const allCells   = [];   // every cell the group occupies (for lanes)
    const roomCellMap = new Map(); // "floorId:x,y" -> { x, y, floorId, mods:[modNum…] }
    let routed = 0, noTravel = 0, warnings = 0, errors = 0, usesStairs = false;

    // Room markers come straight from the schedule (mod 1..N), independent
    // of routing success, so an unreachable room still shows where it is.
    // R34: use the same day-appropriate mods array that findGroupDayPath uses
    // so B-day marker dots land on the correct rooms instead of A-day rooms.
    const vizMods = (day === 'B')
      ? ((group.modsB && group.modsB.length > 0) ? group.modsB : (group.mods || []))
      : (group.modsA || group.mods || []);
    vizMods.forEach((room, idx) => {
      const r = (room || '').trim();
      if (!r) return;
      const key = graph.roomToKey.get(r);
      if (!key) return;
      const { x, y, floorId } = parseKey(key);
      const ck = floorCellKey(floorId, x, y);
      if (!roomCellMap.has(ck)) roomCellMap.set(ck, { x, y, floorId, mods: [] });
      roomCellMap.get(ck).mods.push(idx + 1);
    });

    for (const seg of segments) {
      if (seg.error) { (seg.severity === 'error' ? errors++ : warnings++); continue; }
      if (seg.noTravel) { noTravel++; continue; }
      if (!seg.path || seg.path.length < 2) continue;
      routed++;
      if (seg.usesStaircase) usesStairs = true;

      // Split the segment path at teleport jumps (non-adjacent consecutive
      // cells) AND at floor transitions, dropping consecutive duplicates.
      // Each sub-path is single-floor and carries fromMod + floorId.
      let cur = [];
      const flush = () => {
        if (cur.length >= 2) subPaths.push({ cells: cur, fromMod: seg.fromMod, floorId: cur[0].floorId });
        cur = [];
      };
      for (let i = 0; i < seg.path.length; i++) {
        const c = seg.path[i];
        if (i > 0) {
          const prev = seg.path[i - 1];
          const sameFloor = c.floorId === prev.floorId;
          const d = sameFloor ? (Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y)) : 99;
          if (sameFloor && d === 0) continue;  // duplicate
          if (!sameFloor || d > 1) flush();     // teleport / floor change — break stroke
        }
        cur.push({ x: c.x, y: c.y, floorId: c.floorId });
        allCells.push({ x: c.x, y: c.y, floorId: c.floorId });
      }
      flush();
    }

    // Make sure room cells participate in the lane map too (endpoint dots).
    for (const m of roomCellMap.values()) allCells.push({ x: m.x, y: m.y, floorId: m.floorId });

    entries.push({
      rank, group,
      color: group.color || '#3b82f6',
      name: group.name,
      grade: group.grade,
      subPaths,
      allCells,
      roomMarkers: [...roomCellMap.values()],
      // Cache raw segments so buildCongestionData can reuse them without
      // re-running A* when only the transition filter changes.
      rawSegments: segments,
      stats: { routed, noTravel, warnings, errors, usesStairs,
               segments: segments.length },
    });
  });

  // ---- Stable lane ordering ----
  // Sort entries by group.id lexicographically so that checking/unchecking
  // groups in Comparison mode (which changes the `groups` array slice passed
  // in) never reshuffles which lane index a group occupies. IDs are assigned
  // once at group-creation time (generateGroupId) and never change.
  entries.sort((a, b) => (a.group.id || '').localeCompare(b.group.id || ''));
  // Bake the stable position into each entry so vizLaneOffset can look it up
  // directly without re-scanning the sorted array on every cell render.
  entries.forEach((e, i) => { e.laneIndex = i; });

  // ---- Global lane map: "floorId:x,y" -> sorted array of laneIndexes ----
  const cellRanks = new Map();
  for (const e of entries) {
    const seen = new Set();
    for (const c of e.allCells) {
      const k = floorCellKey(c.floorId, c.x, c.y);
      if (seen.has(k)) continue;  // one lane per group per cell
      seen.add(k);
      if (!cellRanks.has(k)) cellRanks.set(k, []);
      cellRanks.get(k).push(e.laneIndex);
    }
  }
  const laneMap = new Map();
  let maxConcurrency = 0;
  for (const [k, idxs] of cellRanks) {
    idxs.sort((a, b) => a - b);
    laneMap.set(k, idxs);
    if (idxs.length > maxConcurrency) maxConcurrency = idxs.length;
  }

  // Aggregate stats
  let totRouted = 0, totNoTravel = 0, totWarn = 0, totErr = 0;
  for (const e of entries) {
    totRouted   += e.stats.routed;
    totNoTravel += e.stats.noTravel;
    totWarn     += e.stats.warnings;
    totErr      += e.stats.errors;
  }

  // Build the initial congestion data using the current transitionFilter.
  const { congestion, maxCongestion, hotspots, contributors, colorByName,
          weighted, defaultGroupSize } =
    buildCongestionData(entries, AppState.viz.transitionFilter);

  return {
    entries, laneMap,
    congestion, maxCongestion, hotspots,
    contributors,   // Map<"x,y", Map<groupName, count>> — used by hover tooltip
    colorByName,
    weighted, defaultGroupSize,   // R59: student-weighting metadata for display sites
    stats: {
      groups: entries.length, routed: totRouted, noTravel: totNoTravel,
      warnings: totWarn, errors: totErr, maxConcurrency,
    },
  };
}

/**
 * buildCongestionData(entries, transitionFilter)
 *
 * Computes congestion, contributors, maxCongestion and hotspots from the
 * already-cached rawSegments on each entry. Called both from buildVizRenderData
 * (initial render) and from the transition-filter change handler (filter change
 * only — no A* re-run needed).
 *
 * transitionFilter: null = all mods, integer N = only seg.fromMod === N.
 */
function buildCongestionData(entries, transFilt) {
  const colorByName = new Map();
  for (const e of entries) colorByName.set(e.name, e.color || '#3b82f6');

  const congestion  = new Map();   // "floorId:x,y" -> student-weighted load (R59)
  const contributors = new Map();  // "floorId:x,y" -> Map(groupName -> segment count)

  // R59: loads are weighted by group headcount (groupWeight). With every size
  // blank this is a uniform ×defaultGroupSize scaling of the R58 counts, so
  // relative heat and hotspot ordering are unchanged. Display sites divide by
  // defaultGroupSize to recover exact group counts when no group has a size.
  const dgs = (Number.isFinite(AppState.settings.defaultGroupSize) && AppState.settings.defaultGroupSize > 0)
    ? AppState.settings.defaultGroupSize : 25;
  const weighted = anyGroupSized();

  for (const e of entries) {
    const w = groupWeight(e.group || AppState.schedules.groups.find(g => g.name === e.name));
    const segs = e.rawSegments || [];
    for (const seg of segs) {
      if (seg.error || seg.noTravel || !seg.hallwayCells || !seg.hallwayCells.length) continue;
      // Respect the active transition filter — skip non-matching segments.
      if (transFilt !== null && seg.fromMod !== transFilt) continue;

      const seenThisSeg = new Set();
      for (const cell of seg.hallwayCells) {
        if (isCellHeatExcluded(cell.x, cell.y, cell.floorId)) continue;
        const k = floorCellKey(cell.floorId, cell.x, cell.y);
        if (seenThisSeg.has(k)) continue;   // one tally per segment per cell
        seenThisSeg.add(k);

        // Congestion load (student-weighted)
        congestion.set(k, (congestion.get(k) || 0) + w);

        // Contributor map (for tooltip and hotspot table) — raw segment counts
        if (!contributors.has(k)) contributors.set(k, new Map());
        const m = contributors.get(k);
        m.set(e.name, (m.get(e.name) || 0) + 1);
      }
    }
  }

  let maxCongestion = 0;
  for (const v of congestion.values()) if (v > maxCongestion) maxCongestion = v;

  // Sorted hotspots (descending by load, stable on coords) for the summary table.
  const hotspots = [...congestion.entries()].map(([k, count]) => {
    const { x, y, floorId } = parseKey(k);
    const cmap = contributors.get(k) || new Map();
    const groupsArr = [...cmap.entries()]
      .map(([name, n]) => ({ name, n, color: colorByName.get(name) || '#3b82f6' }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const lab = cellCongestionLabel(x, y, floorId);
    return { key: k, x, y, floorId, count, groups: groupsArr, label: lab.label, sub: lab.sub };
  }).sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x);

  return { congestion, maxCongestion, hotspots, contributors, colorByName,
           weighted, defaultGroupSize: dgs };   // R59
}

/* --------------------------------------------------------------
   LANE OFFSET
   Perpendicular offset (native px) for a given group entry at a cell.
-------------------------------------------------------------- */
function vizLaneOffset(entry, x, y, laneSpacing, floorId) {
  const fid = floorId || (AppState.blueprint.floors[0] && AppState.blueprint.floors[0].id);
  const laneIdxs = AppState.viz.rendered ? AppState.viz.rendered.laneMap.get(floorCellKey(fid, x, y)) : null;
  if (!laneIdxs || laneIdxs.length <= 1) return 0;
  // entry.laneIndex is the stable position baked in by buildVizRenderData
  // after sorting entries by group.id — so it never shifts when groups are
  // toggled on/off in Comparison mode.
  const pos = laneIdxs.indexOf(entry.laneIndex);
  if (pos < 0) return 0;
  // Centering formula: lane 0 of N offsets by -(N-1)/2 * laneSpacing.
  return (pos - (laneIdxs.length - 1) / 2) * laneSpacing;
}

/* --------------------------------------------------------------
   MAIN RENDER
-------------------------------------------------------------- */
function renderVizCanvas() {
  if (!vizCtx) return;
  sizeVizCanvas();

  // Round 30: when playback is active, delegate to the playback renderer
  // (draws the blueprint + only the current transition's animating paths).
  if (AppState.viz.playback && AppState.viz.playback.active) {
    drawVizBlueprint();
    drawPlaybackFrame(AppState.viz.rendered, AppState.viz.playback);
    updateVizEmptyState();
    return;
  }

  drawVizBlueprint();

  const data = AppState.viz.rendered;
  if (data && data.entries.length) {
    drawVizPaths(data);
  }
  updateVizEmptyState();
  syncVizPulseCells();
}

/** Draw the blueprint (read-only) + a soft veil so paths read clearly.
 *
 *  Hallway rendering difference vs. the Blueprint editor:
 *  In the editor each hallway tile is drawn as an individual rounded block
 *  with a border, making distinct cells visible. In the Visualizer, adjacent
 *  hallway tiles are merged into a continuous corridor: they are drawn flush
 *  (no inset padding, no per-tile border) so the hallway network reads as
 *  solid connected corridors rather than a mosaic of separate blocks.
 *  Classrooms and staircases are still drawn with their normal appearance.
 */
function drawVizBlueprint() {
  const cellSize = getEffectiveCellSize();
  const totalW = maxFloorWidthPx();
  const totalH = totalVizCanvasHeight();

  const saved = ctx;
  ctx = vizCtx;
  try {
    // Clear the whole stacked canvas once, then paint the inter-panel gaps.
    ctx.clearRect(0, 0, totalW, totalH);
    ctx.fillStyle = '#eef2f7';
    ctx.fillRect(0, 0, totalW, totalH);
  } finally {
    ctx = saved;
  }

  const floors = AppState.blueprint.floors;
  for (const floor of floors) {
    const offY = floorOffsetY(floor.id);
    drawFloorLabelBar(floor.label, offY - FLOOR_LABEL_H, floor.gridCols * cellSize, cellSize);
    drawFloorPanel(floor, offY, vizCtx);
  }
}

/** Draw a floor's label bar just above its grid panel. */
function drawFloorLabelBar(label, topY, panelW, cellSize) {
  const saved = ctx;
  ctx = vizCtx;
  try {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, topY, Math.max(panelW, 120), FLOOR_LABEL_H);
    ctx.fillStyle = '#f8fafc';
    ctx.font = `600 ${Math.max(11, Math.min(14, cellSize * 0.34))}px 'DM Sans', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 10, topY + FLOOR_LABEL_H / 2);
  } finally {
    ctx = saved;
  }
}

/**
 * Round 31: draw one floor's blueprint panel at vertical offset offY.
 * Temporarily re-points the legacy mirror at this floor (so getTile/drawTile/
 * label helpers read it) and translates the context so cell (0,0) lands at offY.
 */
function drawFloorPanel(floor, offY, targetCtx) {
  const cellSize = getEffectiveCellSize();
  const gridCols = floor.gridCols, gridRows = floor.gridRows;
  const W = gridCols * cellSize, H = gridRows * cellSize;

  // Save + repoint mirror at this floor.
  const bp = AppState.blueprint;
  const savedMirror = {
    gridData: bp.gridData, gridCols: bp.gridCols, gridRows: bp.gridRows,
    heatExcludeZones: bp.heatExcludeZones,
  };
  bp.gridData = floor.gridData; bp.gridCols = gridCols; bp.gridRows = gridRows;
  bp.heatExcludeZones = floor.heatExcludeZones;

  const saved = ctx;
  ctx = targetCtx;
  ctx.save();
  ctx.translate(0, offY);
  try {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // ── Step 1: hallways as merged solid fill ──
    ctx.fillStyle = TILE_COLORS.hallway.fill;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (tile && tile.type === 'hallway') ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
    ctx.strokeStyle = TILE_COLORS.hallway.stroke;
    ctx.lineWidth = 1.5; ctx.globalAlpha = 0.45;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (!tile || tile.type !== 'hallway') continue;
        const x = c * cellSize, y = r * cellSize;
        const up = getTile(c, r - 1), down = getTile(c, r + 1), left = getTile(c - 1, r), right = getTile(c + 1, r);
        ctx.beginPath();
        if (!up    || up.type    !== 'hallway') { ctx.moveTo(x, y);            ctx.lineTo(x + cellSize, y); }
        if (!down  || down.type  !== 'hallway') { ctx.moveTo(x, y + cellSize); ctx.lineTo(x + cellSize, y + cellSize); }
        if (!left  || left.type  !== 'hallway') { ctx.moveTo(x, y);            ctx.lineTo(x, y + cellSize); }
        if (!right || right.type !== 'hallway') { ctx.moveTo(x + cellSize, y); ctx.lineTo(x + cellSize, y + cellSize); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ── Step 1.5 (R56): dummy cells as merged blocks (like hallways) ──
    // Adjacent same-colour dummies share a seamless fill with the dashed border
    // suppressed on shared edges, so a run of dummy tiles reads as one wall
    // instead of separate rounded chips. Different-colour neighbours keep their
    // divider. Drawn before classrooms/labels and under the mute veil, exactly
    // like the hallway merge above.
    const dummyDefault = DUMMY_COLOR_PRESETS[0];
    const dummyColorAt = (t) => (t && t.type === 'dummy') ? (t.dummyColor || dummyDefault) : null;
    // Fill pass — edge-to-edge so adjacent cells touch with no gap.
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (!tile || tile.type !== 'dummy') continue;
        ctx.fillStyle = tile.dummyColor || dummyDefault;
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
    // Dashed outline pass — only on edges that face a non-dummy or a
    // different-coloured dummy (interior same-colour edges stay seamless).
    ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (!tile || tile.type !== 'dummy') continue;
        const fillColor = tile.dummyColor || dummyDefault;
        ctx.strokeStyle = darkenHex(fillColor, 0.35);
        const x = c * cellSize, y = r * cellSize;
        const up = dummyColorAt(getTile(c, r - 1)) === fillColor;
        const dn = dummyColorAt(getTile(c, r + 1)) === fillColor;
        const lf = dummyColorAt(getTile(c - 1, r)) === fillColor;
        const rt = dummyColorAt(getTile(c + 1, r)) === fillColor;
        ctx.beginPath();
        if (!up) { ctx.moveTo(x, y + 0.5);            ctx.lineTo(x + cellSize, y + 0.5); }
        if (!dn) { ctx.moveTo(x, y + cellSize - 0.5); ctx.lineTo(x + cellSize, y + cellSize - 0.5); }
        if (!lf) { ctx.moveTo(x + 0.5, y);            ctx.lineTo(x + 0.5, y + cellSize); }
        if (!rt) { ctx.moveTo(x + cellSize - 0.5, y); ctx.lineTo(x + cellSize - 0.5, y + cellSize); }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // Label pass — per-cell, on top of the merged fill.
    if (cellSize >= 24) {
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          const tile = getTile(c, r);
          if (!tile || tile.type !== 'dummy' || !tile.dummyLabel) continue;
          const fillColor = tile.dummyColor || dummyDefault;
          const x = c * cellSize, y = r * cellSize;
          const fontSize = Math.max(7, Math.min(11, cellSize * 0.22));
          ctx.fillStyle = darkenHex(fillColor, 0.5);
          ctx.font = `600 ${fontSize}px 'DM Sans', sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.save();
          ctx.beginPath(); ctx.rect(x + 2, y + 2, cellSize - 4, cellSize - 4); ctx.clip();
          ctx.fillText(tile.dummyLabel, x + cellSize / 2, y + cellSize / 2);
          ctx.restore();
        }
      }
    }

    // ── Step 2: classrooms + staircases ──
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (tile && tile.type !== 'hallway' && tile.type !== 'dummy') drawTile(c, r, tile, cellSize, true);
      }
    }

    // ── Step 3: grid lines over non-hallway regions ──
    ctx.strokeStyle = GRID_LINE_COLOR; ctx.lineWidth = 0.75; ctx.beginPath();
    for (let c = 1; c < gridCols; c++) {
      for (let r = 0; r < gridRows; r++) {
        const tL = getTile(c - 1, r), tR = getTile(c, r);
        const bothHall = tL && tL.type === 'hallway' && tR && tR.type === 'hallway';
        // R56: also suppress the divider between two same-colour dummies so the
        // merged wall stays seamless.
        const bothDummy = tL && tR && tL.type === 'dummy' && tR.type === 'dummy' &&
          (tL.dummyColor || dummyDefault) === (tR.dummyColor || dummyDefault);
        if (!bothHall && !bothDummy) { const px = c * cellSize + 0.5; ctx.moveTo(px, r * cellSize); ctx.lineTo(px, (r + 1) * cellSize); }
      }
    }
    for (let r = 1; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tU = getTile(c, r - 1), tD = getTile(c, r);
        const bothHall = tU && tU.type === 'hallway' && tD && tD.type === 'hallway';
        const bothDummy = tU && tD && tU.type === 'dummy' && tD.type === 'dummy' &&
          (tU.dummyColor || dummyDefault) === (tD.dummyColor || dummyDefault);
        if (!bothHall && !bothDummy) { const py = r * cellSize + 0.5; ctx.moveTo(c * cellSize, py); ctx.lineTo((c + 1) * cellSize, py); }
      }
    }
    ctx.stroke();

    // ── Step 4: mute veil ──
    ctx.fillStyle = `rgba(248,250,252,${VIZ_DIM_ALPHA})`;
    ctx.fillRect(0, 0, W, H);

    // ── Step 5: re-stamp room labels ──
    const stampedGroups = new Set();
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const tile = getTile(c, r);
        if (!tile || tile.type !== 'classroom') continue;
        if (tile.groupId) {
          if (stampedGroups.has(tile.groupId)) continue;
          if (!isGroupAnchor(c, r, tile.groupId)) continue;
          if (!tile.roomNumber) continue;
          stampedGroups.add(tile.groupId);
          const lx = getGroupCenterX(c, r, tile.groupId, cellSize);
          const ly = getGroupCenterY(c, r, tile.groupId, cellSize);
          const groupW = getGroupPixelWidth(c, r, tile.groupId, cellSize);
          const groupH = getGroupPixelHeight(c, r, tile.groupId, cellSize);
          const fontSize = Math.max(8, Math.min(14, Math.min(groupW, groupH) * 0.28));
          ctx.fillStyle = '#1e3a8a';
          ctx.font = `600 ${fontSize}px 'DM Mono', monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(tile.roomNumber, lx, ly);
        } else if (tile.roomNumber && cellSize >= 24) {
          drawRoomLabel(tile.roomNumber, c * cellSize + 1, r * cellSize + 1, cellSize - 2, cellSize - 2, cellSize);
        }
      }
    }

    // ── Step 6: heat-exclude overlays ──
    drawHeatExcludeZones(cellSize, ctx);
  } finally {
    ctx.restore();
    ctx = saved;
    // Restore mirror.
    bp.gridData = savedMirror.gridData; bp.gridCols = savedMirror.gridCols;
    bp.gridRows = savedMirror.gridRows; bp.heatExcludeZones = savedMirror.heatExcludeZones;
  }
}

/** Draw every group's offset polylines, then endpoint dots + mod labels. */
function drawVizPaths(data) {
  const cellSize = getEffectiveCellSize();
  const z = AppState.viz.zoom;
  const scaleComp = AppState.viz.constantWidth ? (1 / z) : 1;
  const sizeFactor = cellSize / 40;                 // scale to non-default grids

  // ── Adaptive lane geometry ──────────────────────────────────────────────
  // When many groups share a hallway tile the fixed 4.5 px stroke / 5 px lane
  // gap causes lanes to overlap and spill outside the tile.  We now compute
  // how many groups can coexist in the busiest cell and shrink both the stroke
  // width and the inter-lane pitch so the full bundle always fits inside ~65 %
  // of a cell's width.
  const maxConc   = (data && data.stats && data.stats.maxConcurrency) ? data.stats.maxConcurrency : 1;
  const budgetPx  = cellSize * 0.65;                // max corridor width for all lanes
  // Ideal spacing: leave at least 1 px gap between line edges.
  // laneSpace × (N-1) + strokeW = budgetPx  =>  laneSpace = (budgetPx - strokeW) / max(N-1, 1)
  // But also cap stroke so each line is never wider than the gap.
  let strokeW, laneSpace;
  if (maxConc <= 1) {
    strokeW   = VIZ_BASE_STROKE * sizeFactor * scaleComp;
    laneSpace = VIZ_BASE_LANE   * sizeFactor * scaleComp;
  } else {
    // Max stroke width we allow: budget / (N + 0.5) so there's visible gap between lines.
    const maxStroke = budgetPx / (maxConc + 0.5);
    strokeW   = Math.min(VIZ_BASE_STROKE * sizeFactor, maxStroke) * scaleComp;
    // Lane pitch = stroke + at least 1 px gap, but never wider than budget / (N-1).
    const pitch = Math.min(
      strokeW + Math.max(1, strokeW * 0.3),          // stroke + gap
      budgetPx / Math.max(maxConc - 1, 1)
    );
    laneSpace = pitch * scaleComp;
  }
  // ────────────────────────────────────────────────────────────────────────

  const cx = (c) => (c + 0.5) * cellSize;
  const cy = (r) => (r + 0.5) * cellSize;

  vizCtx.lineCap = 'round';
  vizCtx.lineJoin = 'round';

  // Single Group keeps the group's own color; all multi-group modes color each
  // line segment by the congestion of the hallway cell(s) it spans.
  const useCongestion = AppState.viz.displayMode !== 'single';
  const congestion = data.congestion || new Map();
  const maxC = data.maxCongestion || 1;

  // ---- Pass 1: polylines (translucent so overlaps stay readable) ----
  const transFilt = AppState.viz.transitionFilter; // null or integer 1..N
  const f0id = AppState.blueprint.floors[0] && AppState.blueprint.floors[0].id;
  for (const entry of data.entries) {
    for (const subPath of entry.subPaths) {
      const poly = subPath.cells;          // [{x,y,floorId}…]
      const fid  = subPath.floorId || (poly[0] && poly[0].floorId) || f0id;
      const offY = floorOffsetY(fid);
      const cyF  = (r) => (r + 0.5) * cellSize + offY;   // floor-shifted y
      const isActive = transFilt === null || subPath.fromMod === transFilt;
      vizCtx.lineWidth = isActive ? strokeW : strokeW * 0.5;
      vizCtx.globalAlpha = isActive ? 0.82 : 0.13;

      const pts = offsetPolyline(poly, entry, laneSpace, cx, cyF, fid);
      if (pts.length < 2) continue;

      if (!useCongestion) {
        // Group-colored continuous stroke.
        vizCtx.strokeStyle = entry.color;
        vizCtx.beginPath();
        vizCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) vizCtx.lineTo(pts[i].x, pts[i].y);
        vizCtx.stroke();
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = poly[i], b = poly[i + 1];
          const ca = congestion.get(floorCellKey(fid, a.x, a.y)) || 0;
          const cb = congestion.get(floorCellKey(fid, b.x, b.y)) || 0;
          // R59: loads are student-weighted, so the "at least one group" floor
          // is one default-group's worth of students (ratio-identical to R58).
          const loadFloor = data.defaultGroupSize || 1;
          const load = Math.max(ca, cb, loadFloor);
          vizCtx.strokeStyle = isActive ? congestionColor(load, maxC) : '#b0bec5';
          vizCtx.beginPath();
          vizCtx.moveTo(pts[i].x, pts[i].y);
          vizCtx.lineTo(pts[i + 1].x, pts[i + 1].y);
          vizCtx.stroke();
        }
      }
    }
  }
  vizCtx.globalAlpha = 1;

  // ---- Cross-floor portal connectors (dashed lines between paired stairs) ----
  drawCrossFloorPortalConnectors(data, cx, cy);

  // ---- Pass 2: endpoint dots + optional mod labels ----
  const dotR     = Math.max(3.5, 4.4 * sizeFactor * scaleComp);
  const showMark = AppState.viz.showMarkers;
  const labelGroups = data.entries.length <= 4; // avoid clutter when many groups

  for (const entry of data.entries) {
    for (const m of entry.roomMarkers) {
      const mFid = m.floorId || f0id;
      const off = vizLaneOffset(entry, m.x, m.y, laneSpace, mFid);
      // Endpoint dots offset perpendicular to the room (here: vertical lane)
      const px = cx(m.x) + off;
      const py = cy(m.y) + floorOffsetY(mFid);

      // Contrast check: in congestion modes the corridor under this dot may
      // share a similar hue to the dot color, making it invisible. When the
      // Euclidean RGB distance is below 60 we widen the halo and add a
      // semi-transparent outer ring so the dot stays legible at all times.
      let haloR = dotR + 1.4;
      let extraRing = false;
      if (useCongestion) {
        const cellLoad = congestion.get(floorCellKey(mFid, m.x, m.y)) || 0;
        if (cellLoad > 0) {
          const bgColor = congestionColor(cellLoad, maxC);
          if (colorDistance(entry.color, bgColor) < 60) {
            haloR = dotR + 3;
            extraRing = true;
          }
        }
      }

      // Outer contrast ring (only when dot color clashes with congestion bg)
      if (extraRing) {
        vizCtx.beginPath();
        vizCtx.arc(px, py, dotR + 2.2, 0, Math.PI * 2);
        vizCtx.fillStyle = 'rgba(255,255,255,0.6)';
        vizCtx.fill();
      }

      // White halo + colored fill
      vizCtx.beginPath();
      vizCtx.arc(px, py, haloR, 0, Math.PI * 2);
      vizCtx.fillStyle = '#ffffff';
      vizCtx.fill();
      vizCtx.beginPath();
      vizCtx.arc(px, py, dotR, 0, Math.PI * 2);
      vizCtx.fillStyle = entry.color;
      vizCtx.fill();

      // Mod label(s) — e.g. "M1", or "M1·5" if the room repeats.
      if (showMark && labelGroups && cellSize >= 22) {
        const label = 'M' + m.mods.join('·');
        const fs = Math.max(8, Math.min(12, cellSize * 0.26)) * (AppState.viz.constantWidth ? (1 / z) : 1);
        vizCtx.font = `600 ${fs}px 'DM Mono', monospace`;
        vizCtx.textAlign = 'center';
        vizCtx.textBaseline = 'middle';
        const lx = px, ly = py - dotR - fs * 0.85;
        const tw = vizCtx.measureText(label).width;
        // chip
        vizCtx.fillStyle = 'rgba(255,255,255,0.92)';
        roundRectPath(vizCtx, lx - tw / 2 - 3, ly - fs * 0.62, tw + 6, fs * 1.25, 3);
        vizCtx.fill();
        vizCtx.fillStyle = entry.color;
        vizCtx.fillText(label, lx, ly);
      }
    }
  }
}

/**
 * colorDistance(hex1, hex2) — Euclidean RGB distance between two hex colors.
 *   Used in Pass 2 of drawVizPaths to detect when an endpoint dot color is
 *   visually similar to the congestion color under it.
 *   Returns 0 (identical) to ~441 (black vs. white).
 */
function colorDistance(hex1, hex2) {
  function parseHex(h) {
    h = h.replace(/^#/, '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Handle rgb(...) strings emitted by old callers (HEAT_STOPS are hex, but guard anyway)
  function parseColor(c) {
    if (typeof c === 'string' && c.startsWith('rgb')) {
      const m = c.match(/\d+/g);
      return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
    }
    return parseHex(c);
  }
  const [r1, g1, b1] = parseColor(hex1);
  const [r2, g2, b2] = parseColor(hex2);
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

/** Helper: roundRect path without stroking (own impl to avoid touching shared one). */
function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  if (typeof c.roundRect === 'function') { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Convert a cell-center polyline into offset points. Each vertex is shifted
 * perpendicular to its *local* travel direction (averaged across the
 * incoming/outgoing legs) by this group's lane offset at that cell, so
 * parallel paths stay parallel through straights AND corners.
 */
/**
 * Round 31: draw dashed connectors between cross-floor staircase pairs so the
 * vertical links between stacked floor panels are visible. Each pair drawn once.
 */
function drawCrossFloorPortalConnectors(data, cx, cy) {
  const allPairs = (AppState.blueprint.crossFloorPairs || []).filter(p => p.a.floorId !== p.b.floorId);
  if (!allPairs.length) return;

  // Build a set of staircase cell keys actually traversed by any rendered group.
  // A group uses a cross-floor staircase when its path contains two consecutive
  // cells on different floors (i.e. a legBreak teleport point). We record the
  // grid coords of both endpoints of each such jump.
  const usedCells = new Set();
  if (data && data.entries) {
    for (const entry of data.entries) {
      for (const seg of (entry.rawSegments || [])) {
        if (!seg.path || seg.path.length < 2) continue;
        for (let i = 1; i < seg.path.length; i++) {
          const a = seg.path[i - 1], b = seg.path[i];
          if (a.floorId && b.floorId && a.floorId !== b.floorId) {
            usedCells.add(`${a.floorId}:${a.x},${a.y}`);
            usedCells.add(`${b.floorId}:${b.x},${b.y}`);
          }
        }
      }
    }
  }

  // Only draw connector arcs for pairs where at least one endpoint is used.
  const pairs = allPairs.filter(p =>
    usedCells.has(`${p.a.floorId}:${p.a.col},${p.a.row}`) ||
    usedCells.has(`${p.b.floorId}:${p.b.col},${p.b.row}`)
  );
  if (!pairs.length) return;

  vizCtx.save();
  vizCtx.setLineDash([6, 5]);
  vizCtx.lineWidth = 1.6;
  vizCtx.strokeStyle = 'rgba(100,116,139,0.7)';
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const ax = cx(p.a.col), ay = cy(p.a.row) + floorOffsetY(p.a.floorId);
    const bx = cx(p.b.col), by = cy(p.b.row) + floorOffsetY(p.b.floorId);
    vizCtx.beginPath();
    vizCtx.moveTo(ax, ay);
    vizCtx.lineTo(bx, by);
    vizCtx.stroke();
    // small portal end-glyphs
    vizCtx.setLineDash([]);
    for (const [gx, gy] of [[ax, ay], [bx, by]]) {
      vizCtx.beginPath();
      vizCtx.arc(gx, gy, 3.2, 0, Math.PI * 2);
      vizCtx.fillStyle = 'rgba(100,116,139,0.85)';
      vizCtx.fill();
    }
    vizCtx.setLineDash([6, 5]);
  }
  vizCtx.restore();
}

function offsetPolyline(poly, entry, laneSpace, cx, cy, floorId) {
  const n = poly.length;
  const center = (i) => ({ x: cx(poly[i].x), y: cy(poly[i].y) });
  const norm = (vx, vy) => { const m = Math.hypot(vx, vy) || 1; return { x: vx / m, y: vy / m }; };
  // R54: keep-right bias — every group hugs the right half of the square
  // relative to its local travel direction (American traffic rules), so
  // opposing flows in the same corridor render on opposite halves with no
  // head-to-head detection. Lane spreading (vizLaneOffset) is then centered
  // on this right-lane line rather than the corridor centerline. Tapered to
  // zero at the first/last point so paths still emerge from / arrive at the
  // classroom-cell center (matching the endpoint room-marker dots).
  const rlBiasPx = getEffectiveCellSize() * 0.20;

  const out = [];
  for (let i = 0; i < n; i++) {
    let dir;
    if (n === 1) dir = { x: 1, y: 0 };
    else if (i === 0)      { const a = center(0),     b = center(1);     dir = norm(b.x - a.x, b.y - a.y); }
    else if (i === n - 1)  { const a = center(n - 2), b = center(n - 1); dir = norm(b.x - a.x, b.y - a.y); }
    else {
      const a = center(i - 1), b = center(i), c2 = center(i + 1);
      const d1 = norm(b.x - a.x, b.y - a.y);
      const d2 = norm(c2.x - b.x, c2.y - b.y);
      let sx = d1.x + d2.x, sy = d1.y + d2.y;
      if (Math.hypot(sx, sy) < 1e-4) { sx = d1.x; sy = d1.y; } // 180° reversal fallback
      dir = norm(sx, sy);
    }
    const perp = { x: -dir.y, y: dir.x };   // right of travel (screen coords, y-down)
    const off = vizLaneOffset(entry, poly[i].x, poly[i].y, laneSpace, floorId || poly[i].floorId);
    const bias = (i === 0 || i === n - 1) ? 0 : rlBiasPx;   // R54 endpoint taper
    const ctr = center(i);
    out.push({ x: ctr.x + perp.x * (off + bias), y: ctr.y + perp.y * (off + bias) });
  }
  return out;
}

/* --------------------------------------------------------------
   ROUND 10 — TOP-3 HOTSPOT PULSE OVERLAY
   A separate transparent canvas draws animated rings over the three
   busiest hallway cells without re-rendering the heavy blueprint.
-------------------------------------------------------------- */
function syncVizPulseCells() {
  const data = AppState.viz.rendered;
  const maxC = data ? (data.maxCongestion || 0) : 0;
  // R59: threshold in group-equivalents so weighting doesn't change when the
  // pulse fires (loads are student-weighted; divide by the default size).
  const maxGroupsEquiv = data ? maxC / (data.defaultGroupSize || AppState.settings.defaultGroupSize || 25) : 0;
  // Only pulse when there is meaningful, comparative congestion to flag.
  if (!data || !data.hotspots || !data.hotspots.length || maxGroupsEquiv < 2 ||
      AppState.viz.displayMode === 'single') {
    _vizPulseCells = [];
  } else {
    _vizPulseCells = data.hotspots.slice(0, 3).map(h => ({
      x: h.x, y: h.y, floorId: h.floorId, color: congestionColor(h.count, maxC),
    }));
  }
  if (_vizPulseCells.length) startVizPulse();
  else stopVizPulse();
}

function startVizPulse() {
  if (_vizPulseRAF != null) return;       // already running
  const loop = () => { drawVizPulseFrame(); _vizPulseRAF = requestAnimationFrame(loop); };
  _vizPulseRAF = requestAnimationFrame(loop);
}

function stopVizPulse() {
  if (_vizPulseRAF != null) { cancelAnimationFrame(_vizPulseRAF); _vizPulseRAF = null; }
  if (vizPulseCtx && vizPulseCanvas) {
    vizPulseCtx.clearRect(0, 0, maxFloorWidthPx(), totalVizCanvasHeight());
  }
}

function drawVizPulseFrame() {
  if (!vizPulseCtx || !vizPulseCanvas) return;
  const panel = document.getElementById('panel-visualize');
  const cellSize = getEffectiveCellSize();
  vizPulseCtx.clearRect(0, 0, maxFloorWidthPx(), totalVizCanvasHeight());
  if (!_vizPulseCells.length || (panel && !panel.classList.contains('active'))) return;
  const sizeFactor = cellSize / 40;
  const t = (performance.now() % 1600) / 1600;   // 0..1 loop
  const ease = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);

  for (const cell of _vizPulseCells) {
    const px = (cell.x + 0.5) * cellSize;
    const py = (cell.y + 0.5) * cellSize + floorOffsetY(cell.floorId);
    const baseR = Math.max(7, cellSize * 0.34);

    // Expanding fading ring
    const ringR = baseR + ease * baseR * 0.9;
    vizPulseCtx.globalAlpha = 0.55 * (1 - ease);
    vizPulseCtx.lineWidth = Math.max(2, 2.6 * sizeFactor);
    vizPulseCtx.strokeStyle = cell.color;
    vizPulseCtx.beginPath();
    vizPulseCtx.arc(px, py, ringR, 0, Math.PI * 2);
    vizPulseCtx.stroke();

    // Steady core ring with white halo for contrast
    vizPulseCtx.globalAlpha = 0.95;
    vizPulseCtx.lineWidth = Math.max(2.5, 3.2 * sizeFactor);
    vizPulseCtx.strokeStyle = '#ffffff';
    vizPulseCtx.beginPath();
    vizPulseCtx.arc(px, py, baseR, 0, Math.PI * 2);
    vizPulseCtx.stroke();
    vizPulseCtx.lineWidth = Math.max(1.6, 2 * sizeFactor);
    vizPulseCtx.strokeStyle = cell.color;
    vizPulseCtx.beginPath();
    vizPulseCtx.arc(px, py, baseR, 0, Math.PI * 2);
    vizPulseCtx.stroke();
  }
  vizPulseCtx.globalAlpha = 1;
}

/** Scroll the canvas so a given cell is centered, and briefly emphasize it.
 *  R34: accepts optional floorId so the vertical offset accounts for stacked
 *  floor panels; without it the scroll lands at the wrong position on floor 2+. */
function vizLocateCell(x, y, floorId) {
  const area = document.getElementById('viz-canvas-area');
  if (!area) return;
  const cellSize = getEffectiveCellSize();
  const z = AppState.viz.zoom;
  const px = (x + 0.5) * cellSize * z + 24;   // +24 = wrapper padding
  const floorOff = floorId ? floorOffsetY(floorId) : 0;
  const py = ((y + 0.5) * cellSize + floorOff) * z + 24;
  area.scrollTo({
    left: Math.max(0, px - area.clientWidth / 2),
    top:  Math.max(0, py - area.clientHeight / 2),
    behavior: 'smooth',
  });
}

/* --------------------------------------------------------------
   EMPTY-STATE OVERLAY
-------------------------------------------------------------- */
function updateVizEmptyState() {
  const overlay = document.getElementById('viz-empty');
  const titleEl = document.getElementById('viz-empty-title');
  const descEl  = document.getElementById('viz-empty-desc');
  if (!overlay) return;

  const hasRooms  = roomRegistry.length > 0;
  const hasGroups = AppState.schedules.groups.length > 0;
  const rendered  = AppState.viz.rendered && AppState.viz.rendered.entries.length;

  let show = true, title = '', desc = '';
  if (!hasRooms) {
    title = 'No blueprint yet';
    desc  = 'Add classrooms (with room numbers) and connecting hallways in the Blueprint tab. The visualizer renders paths across that layout.';
  } else if (!hasGroups) {
    title = 'No student groups';
    desc  = 'Create groups and assign their mod-by-mod schedule in the Schedule tab, then come back to visualize how they move.';
  } else if (rendered) {
    show = false;
  } else {
    title = 'Ready to visualize';
    desc  = 'Pick a display mode and choose your group(s) — paths will render automatically.';
  }
  overlay.style.display = show ? 'flex' : 'none';
  if (show) { titleEl.textContent = title; descEl.textContent = desc; }
}

/* --------------------------------------------------------------
   CONTROL PANEL — populate & wire
-------------------------------------------------------------- */
function refreshVizControls() {
  populateVizGroupSelect();
  populateVizComparisonPicker();
  populateVizGradeSelect();
  populateVizTransitionSelect();
  syncVizModeUI();
}

/** Single-group dropdown. */
function populateVizGroupSelect() {
  const sel = document.getElementById('viz-group-select');
  if (!sel) return;
  const groups = AppState.schedules.groups;
  const prev = AppState.viz.singleGroupId;
  if (!groups.length) {
    sel.innerHTML = '<option value="">No student groups defined</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = groups.map(g =>
    `<option value="${escHtml(g.id)}">${escHtml(g.name)}${g.grade ? ' · Grade ' + escHtml(String(g.grade)) : ''}</option>`
  ).join('');
  if (prev && groups.some(g => g.id === prev)) sel.value = prev;
  else { sel.selectedIndex = 0; AppState.viz.singleGroupId = sel.value; }
}

/** Comparison checkbox list (max 4). */
function populateVizComparisonPicker() {
  const host = document.getElementById('viz-comparison-picker');
  if (!host) return;
  const groups = AppState.schedules.groups;
  // Drop stale ids
  AppState.viz.comparisonIds = AppState.viz.comparisonIds.filter(id => groups.some(g => g.id === id));

  if (!groups.length) {
    host.innerHTML = '<div class="viz-legend-empty">No student groups defined.</div>';
    return;
  }
  const selected = new Set(AppState.viz.comparisonIds);
  const atMax = selected.size >= VIZ_MAX_COMPARE;
  host.innerHTML = groups.map(g => {
    const on = selected.has(g.id);
    const dis = !on && atMax;
    return `<label class="viz-check ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}" data-gid="${escHtml(g.id)}">
      <span class="viz-check-box"><svg viewBox="0 0 24 24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
      <span class="viz-check-swatch" style="background:${escHtml(g.color || '#3b82f6')}"></span>
      <span class="viz-check-name">${escHtml(g.name)}</span>
      <span class="viz-check-grade">${g.grade ? 'G' + escHtml(String(g.grade)) : '—'}</span>
    </label>`;
  }).join('');

  host.querySelectorAll('.viz-check').forEach(el => {
    el.addEventListener('click', () => {
      const gid = el.dataset.gid;
      const set = new Set(AppState.viz.comparisonIds);
      if (set.has(gid)) set.delete(gid);
      else {
        if (set.size >= VIZ_MAX_COMPARE) { showToast(`Comparison shows at most ${VIZ_MAX_COMPARE} groups.`, 'warn'); return; }
        set.add(gid);
      }
      AppState.viz.comparisonIds = [...set];
      populateVizComparisonPicker();
      // Rerender whenever the selection changes (add OR remove)
      if (AppState.viz.comparisonIds.length > 0) vizRender();
      else vizClear();
    });
  });

  // Round 22: show/hide the cap notice
  const capEl = document.getElementById('viz-comparison-cap');
  if (capEl) capEl.classList.toggle('visible', selected.size >= VIZ_MAX_COMPARE);

  const tip = document.getElementById('viz-comparison-tip');
  if (tip) tip.textContent = `${selected.size} of ${VIZ_MAX_COMPARE} selected.`;
}

/** Grade dropdown. */
function populateVizGradeSelect() {
  const sel = document.getElementById('viz-grade-select');
  if (!sel) return;
  const grades = [...new Set(
    AppState.schedules.groups.map(g => g.grade).filter(v => v !== null && v !== undefined && v !== '')
  )].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  if (!grades.length) {
    sel.innerHTML = '<option value="">No grades assigned</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = grades.map(gr =>
    `<option value="${escHtml(String(gr))}">Grade ${escHtml(String(gr))} · ${AppState.schedules.groups.filter(g => String(g.grade) === String(gr)).length} group(s)</option>`
  ).join('');
  if (AppState.viz.gradeFilter != null && grades.some(g => String(g) === String(AppState.viz.gradeFilter))) {
    sel.value = String(AppState.viz.gradeFilter);
  } else {
    AppState.viz.gradeFilter = sel.value;
  }
}

/** Transition filter dropdown — "Mod N → Mod N+1" entries. */
function populateVizTransitionSelect() {
  const sel = document.getElementById('viz-transition-select');
  if (!sel) return;
  const { modCount, modLabel: style } = AppState.settings;
  const prev = AppState.viz.transitionFilter;
  // Build options: blank = all, then 1..modCount-1 for each transition
  const opts = ['<option value="">All transitions</option>'];
  const tfDay = AppState.viz.vizDay || 'A';   // R59: bell times follow the viz day
  for (let i = 1; i < modCount; i++) {
    const from = modLabel(i, style);
    const to   = modLabel(i + 1, style);
    const win  = formatTransitionWindow(tfDay, i);   // R59: "8:42–8:46" or ''
    opts.push(`<option value="${i}">${from} → ${to}${win ? ' · ' + win : ''}</option>`);
  }
  sel.innerHTML = opts.join('');
  // Restore prior selection if still valid
  if (prev !== null && prev >= 1 && prev < modCount) {
    sel.value = String(prev);
    AppState.viz.transitionFilter = prev;
  } else {
    sel.value = '';
    AppState.viz.transitionFilter = null;
  }
}

/** Show the right selection control for the active mode, then auto-render. */
function syncVizModeUI() {
  const mode = AppState.viz.displayMode;
  document.querySelectorAll('.viz-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.vizMode === mode));

  const fields = {
    single:     'viz-single-field',
    comparison: 'viz-comparison-field',
    grade:      'viz-grade-field',
    all:        'viz-all-field',
  };
  Object.entries(fields).forEach(([m, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (m === mode) ? '' : 'none';
  });

  // Round 22: hide cap notice when leaving comparison mode
  const capEl = document.getElementById('viz-comparison-cap');
  if (capEl && mode !== 'comparison') capEl.classList.remove('visible');

  const labels = { single: 'Student Group', comparison: 'Select Groups',
                   grade: 'Choose Grade', all: 'All Groups' };
  const labEl = document.getElementById('viz-selection-label');
  if (labEl) labEl.textContent = labels[mode] || 'Selection';

  // Auto-render if there is a meaningful selection available.
  if (mode === 'all') {
    vizRender();
  } else if (mode === 'single') {
    if (AppState.viz.singleGroupId) vizRender();
  } else if (mode === 'comparison') {
    if (AppState.viz.comparisonIds.length > 0) vizRender();
  } else if (mode === 'grade') {
    if (AppState.viz.gradeFilter) vizRender();
  }
}

/* --------------------------------------------------------------
   RENDER ACTION
-------------------------------------------------------------- */
function vizRender() {
  // Pull current selection from the active control.
  const v = AppState.viz;
  if (v.displayMode === 'single') {
    const sel = document.getElementById('viz-group-select');
    if (sel) v.singleGroupId = sel.value || null;
  } else if (v.displayMode === 'grade') {
    const sel = document.getElementById('viz-grade-select');
    if (sel) v.gradeFilter = sel.value || null;
  }

  const groups = vizGroupsForMode();
  if (!groups.length) {
    // Round 22: grade mode gets a specific empty-state nudge
    if (v.displayMode === 'grade' && v.gradeFilter != null && v.gradeFilter !== '') {
      const gradeStr = String(v.gradeFilter);
      const msg = `No groups are assigned to Grade ${gradeStr}. You can set grades in the Schedule tab.`;
      showToast(msg, 'warn');
      // Also show on the canvas via the empty-state overlay
      const titleEl = document.getElementById('viz-empty-title');
      const descEl  = document.getElementById('viz-empty-desc');
      const overlay = document.getElementById('viz-empty');
      if (titleEl) titleEl.textContent = `No groups in Grade ${gradeStr}`;
      if (descEl)  descEl.textContent  = 'Open the Schedule tab → edit any group → set its Grade field.';
      if (overlay) overlay.style.display = 'flex';
      v.rendered = null;
      renderVizCanvas();
      renderVizLegend();
      updateVizCompletenessBar();
      return;
    }
    const msg = {
      single: 'Select a student group first.',
      comparison: 'Select at least one group to compare.',
      grade: 'No groups found for that grade.',
      all: 'No student groups to render.',
    }[v.displayMode] || 'Nothing to render.';
    showToast(msg, 'warn');
    v.rendered = null;
    renderVizCanvas();
    renderVizLegend();
    updateVizCompletenessBar();
    return;
  }

  // For large jobs (big grid × many groups) show a loading indicator so the
  // UI doesn't appear frozen while paths compute. We defer the heavy work one
  // frame so the spinner can paint first.
  const cells = AppState.blueprint.gridCols * AppState.blueprint.gridRows;
  const heavy = (cells >= 1200 && groups.length >= 6) || groups.length >= 12;
  const loading = document.getElementById('viz-loading');

  const doRender = () => {
    // R30: if playback is mid-flight, stop its RAF loop before swapping data
    // so the animation never reads a half-replaced render object.
    const playbackWasActive = AppState.viz.playback.active;
    if (playbackWasActive) PlaybackController.pause();

    v.rendered = buildVizRenderData(groups);
    computeTravelTimes(v.rendered);   // R30: annotate segments with travel + delay seconds

    if (playbackWasActive) {
      // Mod/group counts may have changed — clamp the step and re-sync the bar.
      const cnt = PlaybackController.stepCount();
      if (cnt === 0) {
        PlaybackController.close();
      } else {
        if (AppState.viz.playback.currentStep >= cnt) AppState.viz.playback.currentStep = 0;
        AppState.viz.playback.progress = 0;
        PlaybackController.syncUI();
      }
    }

    renderVizCanvas();
    renderVizLegend();
    updateVizCompletenessBar();

    const s = v.rendered.stats;
    if (s.errors)        showToast(`Rendered ${s.groups} group(s) — ${s.errors} unreachable segment(s) skipped.`, 'warn');
    else if (s.warnings) showToast(`Rendered ${s.groups} group(s) — ${s.warnings} mod(s) need attention.`, 'info');
    else                 showToast(`Rendered ${s.groups} group${s.groups === 1 ? '' : 's'}.`, 'success');

    if (loading) loading.classList.remove('show');
  };

  if (heavy && loading) {
    loading.classList.add('show');
    setTimeout(doRender, 30);
  } else {
    doRender();
  }
}

function vizClear() {
  // R30: tear down any active playback before discarding render data.
  if (AppState.viz.playback && AppState.viz.playback.active) PlaybackController.close();
  AppState.viz.rendered = null;
  AppState.viz.congestionOpen = false;
  stopVizPulse();
  renderVizCanvas();
  renderVizLegend();
}

/* --------------------------------------------------------------
   LEGEND + SUMMARY
-------------------------------------------------------------- */
function renderVizLegend() {
  const list = document.getElementById('viz-legend-list');
  const count = document.getElementById('viz-legend-count');
  const sumSection = document.getElementById('viz-summary-section');
  const sumGrid = document.getElementById('viz-summary-grid');
  if (!list) return;

  const data = AppState.viz.rendered;
  const mode = AppState.viz.displayMode;

  renderVizGradient(data, mode);
  renderCongestionSummary(data, mode);

  if (!data || !data.entries.length) {
    list.innerHTML = '<div class="viz-legend-empty">No paths rendered yet. Pick a display mode and choose your group(s) to begin.</div>';
    if (count) count.textContent = '';
    if (sumSection) sumSection.style.display = 'none';
    return;
  }

  if (count) count.textContent = `${data.entries.length} group${data.entries.length === 1 ? '' : 's'}`;
  const note = (mode !== 'single')
    ? '<div class="viz-legend-note">Swatches identify each group; line colors show corridor congestion.</div>'
    : '';
  list.innerHTML = data.entries.map(e => {
    const st = e.stats;
    const bits = [`${st.routed} leg${st.routed === 1 ? '' : 's'}`];
    if (st.usesStairs) bits.push('stairs');
    const errBit = st.errors ? `<span class="err">${st.errors}✕</span>` : '';
    // R30: per-group estimated travel time (only when computeTravelTimes ran).
    let timeLine = '';
    if (typeof e.totalTravelSec === 'number' && (e.totalTravelSec > 0 || (e.totalDelaySec || 0) > 0)) {
      const total = e.totalTravelSec + (e.totalDelaySec || 0);
      const cong  = (e.totalDelaySec || 0) > 0
        ? ` <span class="vlt-cong">(+${e.totalDelaySec}s congestion)</span>` : '';
      timeLine = `<span class="viz-legend-time">${total}s total${cong}</span>`;
    }
    return `<div class="viz-legend-item">
      <span class="viz-legend-line" style="background:${escHtml(e.color)}"></span>
      <span class="viz-legend-namewrap">
        <span class="viz-legend-name">${escHtml(e.name)}</span>
        ${timeLine}
      </span>
      <span class="viz-legend-meta">${bits.join(' · ')} ${errBit}</span>
    </div>`;
  }).join('') + note;

  // Summary stat tiles
  if (sumSection && sumGrid) {
    const s = data.stats;
    sumSection.style.display = '';
    sumGrid.innerHTML = `
      <div class="viz-stat"><div class="viz-stat-num">${s.routed}</div><div class="viz-stat-label">Routed legs</div></div>
      <div class="viz-stat ${data.maxCongestion >= 4 ? 'err' : (data.maxCongestion >= 2 ? 'warn' : '')}"><div class="viz-stat-num">${data.maxCongestion || 0}</div><div class="viz-stat-label">Peak corridor load</div></div>
      <div class="viz-stat ${s.warnings ? 'warn' : ''}"><div class="viz-stat-num">${s.warnings}</div><div class="viz-stat-label">Warnings</div></div>
      <div class="viz-stat ${s.errors ? 'err' : ''}"><div class="viz-stat-num">${s.errors}</div><div class="viz-stat-label">Unreachable</div></div>
    `;
  }
}

/** Congestion scale section: gradient bar (multi modes) or group color (single). */
function renderVizGradient(data, mode) {
  const body = document.getElementById('viz-grad-body');
  if (!body) return;

  if (!data || !data.entries.length) {
    body.innerHTML = '<div class="viz-grad-caption">Render a multi-group mode to map corridor load. Single Group mode uses the group\'s own color.</div>';
    return;
  }

  if (mode === 'single') {
    const e = data.entries[0];
    body.innerHTML = `
      <div class="viz-grad-single">
        <span class="viz-legend-line" style="background:${escHtml(e ? e.color : '#3b82f6')}"></span>
        <span>${escHtml(e ? e.name : 'Group')} — group color</span>
      </div>
      <div class="viz-grad-caption">Single Group mode draws the path in the group's own color. Switch to a multi-group mode for the congestion gradient.</div>`;
    return;
  }

  // Build 5 discrete swatches that exactly mirror the quantized HEAT_STOPS
  // palette used by congestionColor(). Labels show the load-ratio band each
  // stop covers so the legend stays truthful (not a decorative gradient bar).
  // R59: loads are student-weighted internally. With no explicit sizes we
  // divide back to exact group counts (identical to R58); with sizes we show
  // estimated student counts and say so.
  const weighted = !!data.weighted;
  const max = Math.max(1, congestionDisplayLoad(data, data.maxCongestion || 1));
  const labels = HEAT_STOPS.map((color, i) => {
    const loRatio = i / HEAT_STOPS.length;
    const hiRatio = (i + 1) / HEAT_STOPS.length;
    const lo = Math.ceil(loRatio * max) || 1;
    const hi = Math.ceil(hiRatio * max);
    const label = lo === hi ? `${lo}` : `${lo}\u2013${hi}`;
    return { color, label };
  });
  const swatchHtml = labels.map(({ color, label }) =>
    `<div class="viz-heat-swatch-item">` +
    `<span class="viz-heat-swatch" style="background:${color}"></span>` +
    `<span class="viz-heat-swatch-label">${label}</span>` +
    `</div>`
  ).join('');
  const caption = weighted
    ? `Each band ≈ students crossing that corridor cell, weighted by group size. Red = peak (~${max} students).`
    : `Each band = path overlap (group counts) on that corridor cell. Red = peak (${max} group${max === 1 ? '' : 's'}).`;
  body.innerHTML =
    `<div class="viz-heat-stops" title="${weighted ? 'Weighted by group size' : 'Path overlap (group counts)'}">${swatchHtml}</div>` +
    `<div class="viz-grad-caption">${caption}</div>`;
}

/** Congestion summary dock: scrollable, ranked table of busiest hallway cells. */
function renderCongestionSummary(data, mode) {
  const panel  = document.getElementById('viz-congestion-panel');
  const scroll = document.getElementById('viz-cong-scroll');
  const countE = document.getElementById('viz-cong-count');
  const peakE  = document.getElementById('viz-cong-peak');
  if (!panel || !scroll) return;

  const hotspots = (data && data.hotspots) ? data.hotspots : [];

  if (!hotspots.length) {
    if (countE) countE.textContent = '—';
    if (peakE)  peakE.innerHTML = '';
    const msg = (data && data.entries.length)
      ? 'These groups never share a hallway cell — no congestion to report.'
      : 'Render any mode to see the busiest hallway cells, ranked by how many group paths pass through them.';
    scroll.innerHTML = `<div class="viz-cong-empty">${msg}</div>`;
    panel.classList.add('collapsed');
    AppState.viz.congestionOpen = false;
    return;
  }

  const maxC = data.maxCongestion || 1;
  const weighted = !!data.weighted;   // R59: any group has an explicit size
  if (countE) countE.textContent = `${hotspots.length} cell${hotspots.length === 1 ? '' : 's'}`;
  // R59: peak displayed as exact group count (no sizes) or ~students (sized);
  // plus the bell-schedule passing window when a transition filter is active.
  if (peakE) {
    const peakTxt = weighted
      ? `Peak load <strong>${congestionDisplayText(data, maxC)} students</strong>`
      : `Peak load <strong>${congestionDisplayLoad(data, maxC)}</strong>`;
    const tfNow = AppState.viz.transitionFilter;
    const windowTxt = (tfNow !== null) ? formatTransitionWindow(AppState.viz.vizDay || 'A', tfNow) : '';
    peakE.innerHTML = peakTxt + (windowTxt ? ` · <span style="font-family:var(--font-mono);font-size:10px;">${windowTxt}</span>` : '');
  }

  // R34: sum exclusion zones across every floor (not just the active-floor mirror)
  const zoneCount = AppState.blueprint.floors.reduce((sum, f) => sum + (f.heatExcludeZones || []).length, 0);
  if (zoneCount > 0 && peakE) {
    peakE.innerHTML += ` · <span style="color:var(--warn); font-size:10px;">${zoneCount} zone${zoneCount > 1 ? 's' : ''} excluded</span>`;
  }

  // R30: best-effort average crossing time per cell (respects transition filter).
  // A cell's "time" = average of (travelSec + delaySec) over the segments crossing it.
  const transFilt = AppState.viz.transitionFilter;
  const cellTimeAgg = new Map();   // "floorId:x,y" -> { sum, n }
  let anyTimeData = false;
  for (const e of (data.entries || [])) {
    for (const seg of (e.rawSegments || [])) {
      if (seg.error || seg.noTravel || !seg.hallwayCells || !seg.hallwayCells.length) continue;
      if (transFilt !== null && seg.fromMod !== transFilt) continue;
      if (typeof seg.travelSec !== 'number') continue;
      anyTimeData = true;
      const t = seg.travelSec + (seg.delaySec || 0);
      const seen = new Set();
      for (const cell of seg.hallwayCells) {
        const k = floorCellKey(cell.floorId, cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        const a = cellTimeAgg.get(k) || { sum: 0, n: 0 };
        a.sum += t; a.n += 1;
        cellTimeAgg.set(k, a);
      }
    }
  }
  const cellAvgTime = (x, y, floorId) => {
    const a = cellTimeAgg.get(floorCellKey(floorId, x, y));
    return (a && a.n) ? Math.round(a.sum / a.n) : null;
  };

  const rows = hotspots.map((h, i) => {
    const topClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const dotColor = congestionColor(h.count, maxC);
    // R59: "5" (group count) when no sizes exist; "~87" (est. students) when they do.
    const loadTxt = congestionDisplayText(data, h.count);
    const chips = h.groups.map(g =>
      `<span class="viz-cong-chip"><span class="viz-cong-chip-swatch" style="background:${escHtml(g.color)}"></span>${escHtml(g.name)}${g.n > 1 ? `<span class="viz-cong-chip-x">×${g.n}</span>` : ''}</span>`
    ).join('');
    const sub = h.sub ? `<div class="viz-cong-cell-coord">${escHtml(h.sub)}</div>`
                      : '';
    const timeCell = anyTimeData
      ? `<td><span class="viz-cong-num">${(() => { const t = cellAvgTime(h.x, h.y, h.floorId); return t != null ? '~' + t + 's' : '—'; })()}</span></td>`
      : '';
    return `<tr class="${topClass}" data-x="${h.x}" data-y="${h.y}" data-floor-id="${escHtml(h.floorId || '')}">
      <td><span class="viz-cong-rank">${i + 1}</span></td>
      <td><div class="viz-cong-cell-label">${escHtml(h.label)}</div>${sub}</td>
      <td><div class="viz-cong-load"><span class="viz-cong-dot" style="background:${escHtml(dotColor)}"></span><span class="viz-cong-num" title="${weighted ? 'Estimated students (weighted by group size)' : 'Group paths through this cell'}">${loadTxt}</span></div></td>
      ${timeCell}
      <td><div class="viz-cong-groups">${chips}</div></td>
    </tr>`;
  }).join('');

  const timeHeader = anyTimeData ? `<th class="num" style="width:64px;">Avg. time</th>` : '';
  scroll.innerHTML = `
    <table class="viz-cong-table">
      <thead><tr>
        <th style="width:38px;">#</th>
        <th>Location</th>
        <th class="num" style="width:74px;" title="${weighted ? 'Weighted by group size' : 'Path overlap (group counts)'}">${weighted ? 'Students' : 'Paths'}</th>
        ${timeHeader}
        <th>Contributing groups</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Row click → locate the cell on the canvas.
  scroll.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      vizLocateCell(+tr.dataset.x, +tr.dataset.y, tr.dataset.floorId || null);
    });
  });

  panel.classList.toggle('collapsed', !AppState.viz.congestionOpen);
}

/* --------------------------------------------------------------
   ROUND 16 — EXPORT VIZ AS PNG / PDF
-------------------------------------------------------------- */
/**
 * Builds a short descriptor of what groups/grade is shown in the current
 * visualizer mode, for use in the export header block.
 */
function buildExportGroupsLabel() {
  const v = AppState.viz;
  const groups = AppState.schedules.groups;
  switch (v.displayMode) {
    case 'single': {
      const g = groups.find(g => g.id === v.singleGroupId);
      return g ? g.name : 'Single Group';
    }
    case 'comparison': {
      const names = v.comparisonIds
        .map(id => groups.find(g => g.id === id))
        .filter(Boolean)
        .map(g => g.name);
      return names.length ? names.join(', ') : 'Comparison';
    }
    case 'grade': {
      const gr = v.gradeFilter;
      if (!gr && gr !== 0) return 'By Grade';
      const count = groups.filter(g => String(g.grade) === String(gr)).length;
      return `Grade ${gr} (${count} group${count === 1 ? '' : 's'})`;
    }
    case 'all': {
      const grades = [...new Set(groups.map(g => g.grade).filter(x => x != null && x !== ''))];
      if (!grades.length) return 'All Groups';
      grades.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      return `All Grades (${grades.map(g => 'G' + g).join(', ')})`;
    }
    default: return 'All Groups';
  }
}

/**
 * Renders the current visualization to a fresh offscreen canvas at high
 * resolution (EXPORT_SCALE × logical pixels) without touching or resizing
 * the live vizCanvas. Overlays a metadata info block in the top-left corner.
 * Returns { dataURL, w, h } in physical pixel units.
 */
function renderExportCanvas() {
  const EXPORT_SCALE = { standard: 1.5, high: 2.5, print: 4.0 }[AppState.viz.exportScale || 'high'];
  const cellSizeBase = getEffectiveCellSize();
  const cellSize = cellSizeBase * EXPORT_SCALE;
  // Round 31: span every stacked floor panel.
  const logicalW = maxFloorWidthPx();
  const logicalH = totalVizCanvasHeight();
  const W = logicalW * EXPORT_SCALE;
  const H = logicalH * EXPORT_SCALE;

  // Offscreen canvas at export resolution
  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const offCtx = off.getContext('2d');
  offCtx.scale(EXPORT_SCALE, EXPORT_SCALE);

  // Temporarily retarget all drawing helpers to the offscreen context
  const savedCtx    = ctx;
  const savedVizCtx = vizCtx;
  ctx    = offCtx;
  vizCtx = offCtx;

  // Draw blueprint + paths + info overlay inside try/finally so that the
  // live globals are always restored even if a drawing call throws.
  const data = AppState.viz.rendered;
  try {
    // Draw blueprint layer
    drawVizBlueprint();

    // Draw paths layer (if rendered data exists)
    if (data && data.entries.length) {
      // drawVizPaths reads AppState.viz.zoom for constantWidth compensation;
      // at zoom=1 this is a no-op, so save/restore around a unit zoom.
      const savedZoom = AppState.viz.zoom;
      AppState.viz.zoom = 1.0;
      drawVizPaths(data);
      AppState.viz.zoom = savedZoom;
    }

    // ── Info block overlay (top-left corner) ───────────────────────────────
    // Draw after paths so it's always on top.
    const floorCount = AppState.blueprint.floors.length;
    const schoolName  = AppState.settings.schoolName || 'Student Travel Visualizer';
    const groupsLabel = buildExportGroupsLabel();

    // Build transition time label string
    const tf = AppState.viz.transitionFilter;
    const modCount = AppState.settings.modCount || 8;
    let transLabel = 'All Transitions';
    if (tf && tf >= 1) {
      const fromLabel = modLabel(tf, AppState.settings.modLabel);
      const toLabel   = tf < modCount ? modLabel(tf + 1, AppState.settings.modLabel) : null;
      transLabel = toLabel ? `${fromLabel} → ${toLabel}` : fromLabel;
      const win = formatTransitionWindow(AppState.viz.vizDay || 'A', tf);   // R59
      if (win) transLabel += ` · ${win}`;
    }
    const dayLabel = (AppState.viz.vizDay === 'B') ? 'B Day' : 'A Day';
    const floorLabel = floorCount > 1 ? ` · ${floorCount} Floors` : '';

    // Render at 1× scale because offCtx has already been scaled by EXPORT_SCALE
    // (so everything we draw in logical units comes out 2× physical — correct)
    const logicalScale = 1;   // we're inside the already-scaled context
    const blockX = 12;
    const blockY = 12;
    const padding = 10;
    const lineH   = 16;
    const lines = [schoolName, groupsLabel, `${dayLabel} · ${transLabel}${floorLabel}`];

    // Measure the widest line to size the background box
    offCtx.save();
    offCtx.font = `600 11px 'DM Sans', sans-serif`;
    let maxW = 0;
    for (const line of lines) {
      const w = offCtx.measureText(line).width;
      if (w > maxW) maxW = w;
    }
    const boxW = maxW + padding * 2;
    const boxH = lines.length * lineH + padding * 2;

    // Background
    offCtx.globalAlpha = 0.88;
    offCtx.fillStyle = '#0f1a2e';  // navy-900 matching app header
    const bx = blockX, by = blockY, br = 6;
    offCtx.beginPath();
    if (typeof offCtx.roundRect === 'function') {
      offCtx.roundRect(bx, by, boxW, boxH, br);
    } else {
      offCtx.rect(bx, by, boxW, boxH);
    }
    offCtx.fill();
    offCtx.globalAlpha = 1;

    // Text lines
    lines.forEach((line, i) => {
      const isFirst = i === 0;
      offCtx.font = isFirst
        ? `600 11px 'DM Sans', sans-serif`
        : `400 10px 'DM Sans', sans-serif`;
      offCtx.fillStyle = isFirst ? '#ffffff' : '#a8c4de';  // white / navy-200
      offCtx.textAlign  = 'left';
      offCtx.textBaseline = 'top';
      offCtx.fillText(line, bx + padding, by + padding + i * lineH);
    });

    offCtx.restore();
    // ── End info block ──────────────────────────────────────────────────────
  } finally {
    // Guaranteed restore of live globals regardless of any drawing error above.
    ctx    = savedCtx;
    vizCtx = savedVizCtx;
  }

  return { dataURL: off.toDataURL('image/png'), canvas: off, w: W, h: H };
}

// R62: PDF export quality. The export canvas is painted with an opaque
// background (#eef2f7) before anything else draws, so there is no alpha
// channel a JPEG could lose — safe to recompress for the PDF path even
// though the PNG export next to it stays lossless. 0.82 held up visually
// against the map's flat fills and thin lines at print scale (4x) while
// cutting the file by roughly 40x; see the notes file for the fixture
// before/after.
const PDF_EXPORT_JPEG_QUALITY = 0.82;

function exportVizAsPNG() {
  if (!vizCanvas) { showToast('Canvas not ready.', 'warn'); return; }
  showToast('Exporting…', 'info');
  try {
    const { dataURL } = renderExportCanvas();
    const schoolName = (AppState.settings.schoolName || 'School').replace(/[^\w\s-]/g, '').trim() || 'School';
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = `School Layout — ${schoolName}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Saved as PNG', 'success');
  } catch (err) {
    showToast('PNG export failed.', 'error');
    console.warn('[STVIZ] PNG export error:', err);
  }
}

function exportVizAsPDF() {
  if (!vizCanvas) { showToast('Canvas not ready.', 'warn'); return; }
  showToast('Exporting…', 'info');
  try {
    const { canvas, w, h } = renderExportCanvas();
    if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
      showToast('PDF export unavailable — try PNG instead.', 'warn');
      return;
    }
    const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const mmW = w * 0.264583;
    const mmH = h * 0.264583;
    const orientation = w > h ? 'landscape' : 'portrait';
    const doc = new jsPDF({ orientation, unit: 'mm', format: [mmW, mmH] });
    // JPEG, not the uncompressed PNG renderExportCanvas() also returns — see
    // PDF_EXPORT_JPEG_QUALITY above for why that's safe here.
    const jpegDataURL = canvas.toDataURL('image/jpeg', PDF_EXPORT_JPEG_QUALITY);
    doc.addImage(jpegDataURL, 'JPEG', 0, 0, mmW, mmH);
    const schoolName = (AppState.settings.schoolName || 'School').replace(/[^\w\s-]/g, '').trim() || 'School';
    doc.save(`School Layout — ${schoolName}.pdf`);
    showToast('Saved as PDF', 'success');
  } catch (err) {
    showToast('PDF export failed — try PNG instead.', 'error');
    console.warn('[STVIZ] PDF export error:', err);
  }
}

/* --------------------------------------------------------------
   ROUND 22 — SCHEDULE COMPLETENESS BAR
   Reads already-computed rendered data (no extra pathfinding).
   Falls back to a lightweight group scan if nothing is rendered.
-------------------------------------------------------------- */
function updateVizCompletenessBar() {
  const bar = document.getElementById('viz-completeness-bar');
  if (!bar) return;

  const groups = AppState.schedules.groups;
  if (!groups.length) {
    bar.className = 'cb-err visible';
    bar.textContent = '🔴 0 groups configured — add schedules in the Schedule tab';
    return;
  }

  const rendered = AppState.viz.rendered;
  let total = groups.length, ok = 0, bad = 0;

  if (rendered && rendered.entries && rendered.entries.length) {
    // Read off existing render entries
    for (const entry of rendered.entries) {
      const s = entry.stats;
      if (s.errors > 0 || s.warnings > 0) bad++;
      else ok++;
    }
    // Groups not included in this render are not assessed here
    // (single/comparison mode may only show a subset)
  } else {
    // Lightweight scan: check if rooms exist in blueprint without routing
    const graph = getPathfindingGraph();
    const day = AppState.viz.vizDay || 'A';
    for (const g of groups) {
      const mods = (day === 'B' && g.modsB && g.modsB.length > 0) ? g.modsB : (g.modsA || g.mods || []);
      const hasRoom = mods.some(r => r && r.trim() && graph.roomToKey.has(r.trim()));
      if (hasRoom) ok++; else bad++;
    }
  }

  if (bad === 0 && ok === total) {
    bar.className = 'cb-ok visible';
    bar.textContent = `✅ ${total} of ${total} group${total === 1 ? '' : 's'} fully routed`;
  } else if (ok === 0) {
    bar.className = 'cb-err visible';
    bar.textContent = `🔴 0 groups configured — add schedules in the Schedule tab`;
  } else {
    bar.className = 'cb-warn visible';
    bar.textContent = `⚠️ ${ok} of ${total} group${total === 1 ? '' : 's'} fully routed · ${bad} have missing rooms`;
  }
}

/* --------------------------------------------------------------
   INIT / WIRING
-------------------------------------------------------------- */
function initVizModule() {
  initVizCanvas();

  // Round 24: Apply the restored congestionOpen preference to the panel's DOM
  // immediately so the panel starts in the correct open/collapsed state.
  const congPanel = document.getElementById('viz-congestion-panel');
  if (congPanel) congPanel.classList.toggle('collapsed', !AppState.viz.congestionOpen);

  // Display-mode buttons
  document.querySelectorAll('.viz-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.viz.displayMode = btn.dataset.vizMode;
      syncVizModeUI();
    });
  });

  // Selection inputs — auto-render on change (Change 1)
  const gsel = document.getElementById('viz-group-select');
  if (gsel) gsel.addEventListener('change', () => {
    AppState.viz.singleGroupId = gsel.value || null;
    vizRender();
  });
  const grsel = document.getElementById('viz-grade-select');
  if (grsel) grsel.addEventListener('change', () => {
    AppState.viz.gradeFilter = grsel.value || null;
    vizRender();
  });
  // Comparison picker — delegate since checkboxes are injected dynamically
  const compPicker = document.getElementById('viz-comparison-picker');
  if (compPicker) compPicker.addEventListener('change', () => {
    if (AppState.viz.comparisonIds.length > 0) vizRender();
  });

  // Transition filter select
  const transSel = document.getElementById('viz-transition-select');
  if (transSel) transSel.addEventListener('change', () => {
    const v = transSel.value;
    AppState.viz.transitionFilter = v ? parseInt(v, 10) : null;
    if (AppState.viz.rendered) {
      // Rebuild only the congestion/contributor data from cached path segments
      // (no A* re-run). Then redraw so heatmap and tooltip reflect the filter.
      const { congestion, maxCongestion, hotspots, contributors, colorByName,
              weighted, defaultGroupSize } =
        buildCongestionData(AppState.viz.rendered.entries, AppState.viz.transitionFilter);
      AppState.viz.rendered.congestion    = congestion;
      AppState.viz.rendered.maxCongestion = maxCongestion;
      AppState.viz.rendered.hotspots      = hotspots;
      AppState.viz.rendered.contributors  = contributors;
      AppState.viz.rendered.colorByName   = colorByName;
      AppState.viz.rendered.weighted         = weighted;          // R59
      AppState.viz.rendered.defaultGroupSize = defaultGroupSize;  // R59
      renderVizCanvas();
      renderVizLegend();
    }
  });

  // Clear
  const clearBtn = document.getElementById('viz-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', vizClear);

  // A/B Day toggle — behaves as a true toggle; every click fires vizRender
  const dayA = document.getElementById('viz-day-a');
  const dayB = document.getElementById('viz-day-b');
  function setVizDay(day) {
    AppState.viz.vizDay = day;
    if (dayA) dayA.classList.toggle('active', day === 'A');
    if (dayB) dayB.classList.toggle('active', day === 'B');
    populateVizTransitionSelect();   // mod count may differ per day
    updateVizCompletenessBar();      // Round 22: refresh bar on day change
    if (AppState.viz.rendered) vizRender();
  }
  if (dayA) dayA.addEventListener('click', () => setVizDay('A'));
  if (dayB) dayB.addEventListener('click', () => setVizDay('B'));

  // Options
  const optMark = document.getElementById('viz-opt-markers');
  if (optMark) optMark.addEventListener('change', () => {
    AppState.viz.showMarkers = optMark.checked; renderVizCanvas();
  });
  const optConst = document.getElementById('viz-opt-constant');
  if (optConst) optConst.addEventListener('change', () => {
    AppState.viz.constantWidth = optConst.checked; renderVizCanvas();
  });

  // Zoom
  const zin = document.getElementById('viz-zoom-in');
  if (zin) zin.addEventListener('click', () => adjustVizZoom(ZOOM_STEP));
  const zout = document.getElementById('viz-zoom-out');
  if (zout) zout.addEventListener('click', () => adjustVizZoom(-ZOOM_STEP));
  const zreset = document.getElementById('viz-zoom-reset');
  if (zreset) zreset.addEventListener('click', () => { AppState.viz.zoom = 1.0; applyVizZoom(); if (AppState.viz.constantWidth) renderVizCanvas(); });

  // Export (Change 6)
  const pngBtn = document.getElementById('viz-export-png');
  if (pngBtn) pngBtn.addEventListener('click', exportVizAsPNG);
  const pdfBtn = document.getElementById('viz-export-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', exportVizAsPDF);

  // Round 22: Export scale radio buttons
  const scaleRow = document.getElementById('viz-export-scale-row');
  if (scaleRow) {
    // Initialize button states from AppState
    scaleRow.querySelectorAll('.viz-scale-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scale === (AppState.viz.exportScale || 'high'));
    });
    scaleRow.addEventListener('click', (e) => {
      const btn = e.target.closest('.viz-scale-btn');
      if (!btn) return;
      AppState.viz.exportScale = btn.dataset.scale || 'high';
      scaleRow.querySelectorAll('.viz-scale-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
    });
  }

  // Congestion dock collapse / expand
  const congHeader = document.getElementById('viz-cong-header');
  if (congHeader) congHeader.addEventListener('click', () => {
    AppState.viz.congestionOpen = !AppState.viz.congestionOpen;
    const panel = document.getElementById('viz-congestion-panel');
    if (panel) panel.classList.toggle('collapsed', !AppState.viz.congestionOpen);
    saveVizPrefs();  // Round 24: persist the user's choice across reloads
  });

  // Round 28: Path Health — validate all paths from within the Visualizer panel
  const vizValBtn    = document.getElementById('viz-validate-btn');
  const vizValResult = document.getElementById('viz-validate-result');
  if (vizValBtn && vizValResult) {
    vizValBtn.addEventListener('click', () => {
      const groups = AppState.schedules.groups;
      if (!groups.length) {
        vizValResult.style.display = 'block';
        vizValResult.style.color   = 'var(--slate-400)';
        vizValResult.textContent   = 'No groups defined yet.';
        return;
      }

      // Spinner feedback during synchronous computation
      const origHTML = vizValBtn.innerHTML;
      vizValBtn.disabled = true;
      vizValBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"/></svg>Checking…`;

      // Defer one tick so the browser can paint the spinner before the
      // synchronous A* loop blocks the thread on large grids.
      setTimeout(() => {
        const day = AppState.viz.vizDay || 'A';
        let routed = 0, errored = 0;

        for (const g of groups) {
          const segments = findGroupDayPath(g.name, day);
          if (!segments) { errored++; continue; }
          const hasError = segments.some(s => s.error && !s.noTravel);
          const allNoTravel = segments.every(s => s.noTravel || (!s.fromRoom && !s.toRoom));
          if (hasError) { errored++; }
          else if (!allNoTravel) { routed++; }
          // groups that are all-no-travel count as neither errored nor routed
        }

        const total = groups.length;
        vizValResult.style.display = 'block';
        if (errored === 0 && routed + (total - routed - errored) === total) {
          // All groups either fully routed or intentionally no-travel — green
          vizValResult.style.color = 'var(--success)';
          vizValResult.textContent = `✅ ${routed} of ${total} group${total !== 1 ? 's' : ''} fully routed`;
        } else if (errored > 0 && routed > 0) {
          vizValResult.style.color = 'var(--warn)';
          vizValResult.textContent = `⚠️ ${routed} of ${total} routed · ${errored} have errors`;
        } else if (errored > 0 && routed === 0) {
          vizValResult.style.color = 'var(--error)';
          vizValResult.textContent = `🔴 0 groups routed · ${errored} have errors`;
        } else {
          vizValResult.style.color = 'var(--slate-400)';
          vizValResult.textContent = `${routed} of ${total} group${total !== 1 ? 's' : ''} routed`;
        }

        vizValBtn.disabled = false;
        vizValBtn.innerHTML = origHTML;
      }, 16);
    });
  }

  // ── Round 30: Playback controls ──────────────────────────────────────────
  const openPbBtn = document.getElementById('viz-open-playback');
  if (openPbBtn) openPbBtn.addEventListener('click', () => {
    if (!AppState.viz.rendered || !AppState.viz.rendered.entries.length) {
      showToast('Render paths first before using playback.', 'warn');
      return;
    }
    PlaybackController.open();
  });
  document.getElementById('vpb-toggle-active')?.addEventListener('click', () => PlaybackController.close());
  document.getElementById('vpb-play-pause')?.addEventListener('click',   () => PlaybackController.togglePlayPause());
  document.getElementById('vpb-prev')?.addEventListener('click',         () => PlaybackController.prev());
  document.getElementById('vpb-next')?.addEventListener('click',         () => PlaybackController.next());

  document.querySelectorAll('.vpb-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.viz.playback.speed = parseFloat(btn.dataset.speed);
      document.querySelectorAll('.vpb-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveVizPrefs();   // R30: persist chosen speed
    });
  });

  // R32: Loop mode buttons
  document.querySelectorAll('.vpb-loop-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.loop;
      AppState.viz.playback.loopAll = (mode === 'all');
      AppState.viz.playback.loopOne = (mode === 'one');
      document.querySelectorAll('.vpb-loop-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('vpb-mode-btn')?.addEventListener('click', () => {
    const pb = AppState.viz.playback;
    pb.mode = (pb.mode === 'simultaneous') ? 'sequential' : 'simultaneous';
    pb.seqGroupIdx = 0;
    PlaybackController.syncUI();
    saveVizPrefs();   // R30: persist chosen mode
  });

  // R48: Comet style toggle
  document.getElementById('vpb-comet-btn')?.addEventListener('click', () => {
    const pb = AppState.viz.playback;
    pb.animStyle = (pb.animStyle === 'comet') ? 'trail' : 'comet';
    const btn = document.getElementById('vpb-comet-btn');
    if (btn) btn.classList.toggle('active', pb.animStyle === 'comet');
    saveVizPrefs();
    if (!pb.playing) renderVizCanvas();
  });

  // R48: Real-time toggle
  document.getElementById('vpb-realtime-btn')?.addEventListener('click', () => {
    const pb = AppState.viz.playback;
    pb.realtimeCycle = !pb.realtimeCycle;
    const btn = document.getElementById('vpb-realtime-btn');
    if (btn) btn.classList.toggle('active', pb.realtimeCycle);
    // Restart RAF if currently playing so new cycle duration takes effect immediately
    if (pb.playing) { PlaybackController.pause(); PlaybackController.play(); }
    saveVizPrefs();
  });

  // R52: Group icon (comet) size slider — live redraw while dragging, persist on release
  const cometSizeEl = document.getElementById('vpb-comet-size');
  if (cometSizeEl) {
    cometSizeEl.addEventListener('input', () => {
      AppState.viz.playback.cometScale = parseFloat(cometSizeEl.value) || 1.5;
      if (!AppState.viz.playback.playing) renderVizCanvas();
    });
    cometSizeEl.addEventListener('change', () => saveVizPrefs());
  }

  // Track scrubbing — click anywhere on the track to jump to that transition.
  const pbTrack = document.getElementById('vpb-track');
  if (pbTrack) {
    pbTrack.addEventListener('click', (e) => {
      const count = PlaybackController.stepCount();
      if (count <= 1) return;
      const rect = pbTrack.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const step = Math.round(pct * (count - 1));
      PlaybackController.pause();
      PlaybackController.goToStep(step);
    });
  }

  // R39: Progress scrubber input range — drag to scrub within the current transition
  let _scrubberWasPlaying = false;
  const scrubberEl = document.getElementById('vpb-scrubber');
  if (scrubberEl) {
    scrubberEl.addEventListener('mousedown', () => {
      _scrubberWasPlaying = AppState.viz.playback.playing;
    });
    scrubberEl.addEventListener('input', () => {
      if (AppState.viz.playback.playing) PlaybackController.pause();
      AppState.viz.playback.progress = scrubberEl.value / 100;
      renderVizCanvas();
    });
    scrubberEl.addEventListener('change', () => {
      if (_scrubberWasPlaying) PlaybackController.play();
    });
  }

  // R50: Travel-time panel toggle
  const travelToggle = document.getElementById('viz-travel-toggle');
  const travelClose  = document.getElementById('viz-travel-close');
  const travelPanel  = document.getElementById('viz-travel-panel');
  const _syncTravelToggleIcon = () => {
    if (!travelToggle) return;
    const isOpen = travelPanel && travelPanel.classList.contains('open');
    travelToggle.title = isOpen ? 'Hide travel times' : 'Show group travel times';
    travelToggle.innerHTML = isOpen
      ? `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
      : `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  };
  if (travelToggle && travelPanel) {
    travelToggle.addEventListener('click', () => {
      travelPanel.classList.toggle('open');
      _syncTravelToggleIcon();
      setTimeout(() => { if (typeof resizeVizCanvas === 'function') resizeVizCanvas(); renderVizCanvas(); }, 240);
    });
  }
  if (travelClose && travelPanel) {
    travelClose.addEventListener('click', () => {
      travelPanel.classList.remove('open');
      _syncTravelToggleIcon();
      setTimeout(() => { if (typeof resizeVizCanvas === 'function') resizeVizCanvas(); renderVizCanvas(); }, 240);
    });
  }
}

/* ==============================================================
   ROUND 30 — PLAYBACK ENGINE + TRAVEL TIME ESTIMATOR
   ──────────────────────────────────────────────────────────────
   PlaybackController animates each mod transition's paths on the
   viz canvas; computeTravelTimes annotates rendered segments with
   per-leg travel + congestion-delay seconds.

   NOTE on data shape (differs from the original spec draft):
     • Each entry stores its routed segments as `entry.rawSegments`
       (NOT `entry.segments`).
     • `seg.path` is an array of {x,y,floorId} cell objects (NOT [c,r] pairs).
   Both adaptations are reflected throughout this section.
=============================================================== */
const PlaybackController = {

  /* Duration of one full animation cycle at speed 1.0, in milliseconds */
  CYCLE_MS: 5000,

  open() {
    if (!AppState.viz.rendered || !AppState.viz.rendered.entries.length) {
      showToast('Render paths first before using playback.', 'warn');
      return;
    }
    AppState.viz.playback.active      = true;
    AppState.viz.playback.currentStep = 0;
    AppState.viz.playback.progress    = 0;
    AppState.viz.playback.playing     = false;
    AppState.viz.playback.seqGroupIdx = 0;
    AppState.viz.playback._r50CycleMs = 0;   // R50: reset collision-sim cycle
    const bar = document.getElementById('viz-playback-bar');
    if (bar) bar.style.display = '';
    // Reflect the persisted speed on the speed buttons.
    document.querySelectorAll('.vpb-speed-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === AppState.viz.playback.speed);
    });
    // R32: Reflect loop state — default to "Once" if neither loop flag is set.
    document.querySelectorAll('.vpb-loop-btn').forEach(b => b.classList.remove('active'));
    const pb = AppState.viz.playback;
    const activeLoopId = pb.loopOne ? 'vpb-loop-one' : pb.loopAll ? 'vpb-loop-all' : 'vpb-loop-none';
    document.getElementById(activeLoopId)?.classList.add('active');
    // R48: Reflect comet / realtime button states.
    const cometBtn = document.getElementById('vpb-comet-btn');
    if (cometBtn) cometBtn.classList.toggle('active', pb.animStyle === 'comet');
    // R52: Reflect comet size slider position (restored prefs, external changes).
    const sizeEl = document.getElementById('vpb-comet-size');
    if (sizeEl && typeof pb.cometScale === 'number') sizeEl.value = String(pb.cometScale);
    const rtBtn = document.getElementById('vpb-realtime-btn');
    if (rtBtn) rtBtn.classList.toggle('active', pb.realtimeCycle);
    this._syncPlayIcons();
    this.syncUI();
    renderVizCanvas();   // draw in static (progress 0) state first
  },

  close() {
    this.pause();
    AppState.viz.playback.active = false;
    AppState.viz.playback._liveHeads = null;   // R53: clear live tooltip data
    const bar = document.getElementById('viz-playback-bar');
    if (bar) bar.style.display = 'none';
    renderVizCanvas();   // restore full static render
  },

  play() {
    if (!AppState.viz.playback.active) return;
    AppState.viz.playback.playing = true;
    this._syncPlayIcons();
    this._startRAF();
  },

  pause() {
    AppState.viz.playback.playing = false;
    this._syncPlayIcons();
    if (AppState.viz.playback.raf) {
      cancelAnimationFrame(AppState.viz.playback.raf);
      AppState.viz.playback.raf = null;
    }
  },

  togglePlayPause() {
    if (AppState.viz.playback.playing) this.pause();
    else this.play();
  },

  _syncPlayIcons() {
    const playing = AppState.viz.playback.playing;
    const pi = document.getElementById('vpb-play-icon');
    const pa = document.getElementById('vpb-pause-icon');
    if (pi) pi.style.display = playing ? 'none' : '';
    if (pa) pa.style.display = playing ? '' : 'none';
  },

  stepCount() {
    const data = AppState.viz.rendered;
    if (!data || !data.entries.length) return 0;
    // Number of transitions = modCount - 1 (never negative)
    return Math.max(0, AppState.settings.modCount - 1);
  },

  goToStep(idx) {
    const count = this.stepCount();
    if (count === 0) return;
    AppState.viz.playback.currentStep = Math.max(0, Math.min(count - 1, idx));
    AppState.viz.playback.progress    = 0;
    AppState.viz.playback.seqGroupIdx = 0;
    AppState.viz.playback._r50CycleMs = 0;   // R50: clear stale collision-sim cycle
    this.syncUI();
    renderVizCanvas();
  },

  prev() { this.pause(); this.goToStep(AppState.viz.playback.currentStep - 1); },
  next() { this.pause(); this.goToStep(AppState.viz.playback.currentStep + 1); },

  /* Average (travelSec + delaySec) across the current transition's segments. */
  _stepTimeLabel(step) {
    const data = AppState.viz.rendered;
    if (!data || !data.entries || !data.entries.length) return '';
    const modIdx = step + 1;
    let sumTotal = 0, sumDelay = 0, n = 0;
    for (const entry of data.entries) {
      for (const seg of (entry.rawSegments || [])) {
        if (seg.fromMod !== modIdx) continue;
        if (seg.error || seg.noTravel) continue;
        if (typeof seg.travelSec !== 'number') continue;
        sumTotal += seg.travelSec + (seg.delaySec || 0);
        sumDelay += (seg.delaySec || 0);
        n++;
      }
    }
    if (n === 0) return '';
    const avgTotal = Math.round(sumTotal / n);
    const avgDelay = Math.round(sumDelay / n);
    return `  ·  ~${avgTotal}s avg` + (avgDelay > 0 ? `  (+${avgDelay}s congestion)` : '');
  },

  syncUI() {
    const pb = AppState.viz.playback;
    const count = this.stepCount();
    const labels = getAllModLabels();
    const s = pb.currentStep;
    const baseLabel = (s < labels.length - 1)
      ? `${labels[s]} → ${labels[s + 1]}`
      : (labels[s] || `Step ${s + 1}`);
    const el = document.getElementById('vpb-step-label');
    if (el) el.textContent = baseLabel + this._stepTimeLabel(s);

    const pct = count > 1 ? (s / (count - 1)) * 100 : 0;
    const fill  = document.getElementById('vpb-fill');
    const thumb = document.getElementById('vpb-thumb');
    if (fill)  fill.style.width = `${pct}%`;
    if (thumb) thumb.style.left = `${pct}%`;

    const modeBtnEl = document.getElementById('vpb-mode-btn');
    if (modeBtnEl) {
      const isSeq = pb.mode === 'sequential';
      // Preserve the leading icon; only swap the trailing text node.
      const txt = isSeq ? 'Sequential' : 'Simultaneous';
      const lastNode = modeBtnEl.childNodes[modeBtnEl.childNodes.length - 1];
      if (lastNode && lastNode.nodeType === Node.TEXT_NODE) lastNode.textContent = ' ' + txt;
      else modeBtnEl.appendChild(document.createTextNode(' ' + txt));
      modeBtnEl.classList.toggle('sequential', isSeq);
    }
  },

  /* R48/R50: Compute the cycle duration for the current step.
   * R50: In real-time mode, prefer the collision-simulation cycle written by
   * drawPlaybackFrame into pb._r50CycleMs (includes occupancy wait time), so
   * the RAF loop advances at exactly the same rate the simulation uses.
   * Falls back to the simple tile-count estimate when no simulation data exists. */
  _stepCycleMs() {
    const pb = AppState.viz.playback;
    if (!pb.realtimeCycle) return this.CYCLE_MS;
    // R50: Use collision-simulation cycle if drawPlaybackFrame already computed it.
    if (pb._r50CycleMs && pb._r50CycleMs > 0) {
      return Math.min(Math.max(pb._r50CycleMs, 1000), 120000);
    }
    const data = AppState.viz.rendered;
    if (!data || !data.entries.length) return this.CYCLE_MS;
    const modIdx = pb.currentStep + 1;
    const walkSec  = (AppState.settings.tileWalkTime  != null) ? AppState.settings.tileWalkTime  : 3;
    const stairSec = (AppState.settings.staircaseTime != null) ? AppState.settings.staircaseTime : 8;
    let maxMs = 0;
    for (const entry of data.entries) {
      for (const seg of (entry.rawSegments || [])) {
        if (seg.fromMod !== modIdx || seg.error || seg.noTravel) continue;
        const tiles  = (seg.hallwayCells || []).length;
        const stairs = seg.usesStaircase ? 1 : 0;
        const ms = (tiles * walkSec + stairs * stairSec) * 1000;
        if (ms > maxMs) maxMs = ms;
      }
    }
    // Clamp: at least 1 s, at most 120 s (waits can extend beyond 60 s)
    return Math.min(Math.max(maxMs, 1000), 120000);
  },

  _lastTimestamp: null,

  _startRAF() {
    this._lastTimestamp = null;
    const loop = (ts) => {
      if (!AppState.viz.playback.playing) return;   // pause() cleanly stops the loop
      if (!this._lastTimestamp) this._lastTimestamp = ts;
      const elapsed = ts - this._lastTimestamp;
      this._lastTimestamp = ts;

      const cycleDuration = this._stepCycleMs() / AppState.viz.playback.speed;
      AppState.viz.playback.progress += elapsed / cycleDuration;

      if (AppState.viz.playback.progress >= 1) {
        AppState.viz.playback.progress = 0;
        const pb = AppState.viz.playback;

        if (pb.loopOne) {
          // Stay on the same step, replay from 0.
          pb.seqGroupIdx = 0;
          this.syncUI();
        } else {
          const next = pb.currentStep + 1;
          if (next >= this.stepCount()) {
            if (pb.loopAll) {
              // Restart from step 0.
              pb.currentStep = 0;
              pb.seqGroupIdx = 0;
              this.syncUI();
            } else {
              // Original behavior: stop and reset to first transition.
              this.pause();
              pb.currentStep = 0;
              this.syncUI();
              renderVizCanvas();
              return;
            }
          } else {
            pb.currentStep = next;
            pb.seqGroupIdx = 0;
            this.syncUI();
          }
        }
      }

      renderVizCanvas();  // draws the animated frame
      // R53: keep the hover tooltip's live-occupants list fresh while the
      // cursor is parked over a square — re-drive the (RAF-coalesced)
      // mousemove handler with the last known cursor position.
      const tipEl = document.getElementById('viz-hover-tooltip');
      if (tipEl && tipEl.classList.contains('visible') && tipEl._lastXY && vizCanvas) {
        vizCanvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: tipEl._lastXY.x, clientY: tipEl._lastXY.y, bubbles: false,
        }));
      }
      // R39: sync scrubber position to current progress
      const scrubEl = document.getElementById('vpb-scrubber');
      if (scrubEl) scrubEl.value = Math.round(AppState.viz.playback.progress * 100);
      AppState.viz.playback.raf = requestAnimationFrame(loop);
    };
    AppState.viz.playback.raf = requestAnimationFrame(loop);
  },
};

/**
 * buildTeleportLegs(pts, segLens, legBreak)
 * R58: Collects endpoint metadata for each teleport (staircase) leg so the
 * playback renderer can key localized portal effects (R57 pulse rings, R58
 * sequential dwell arc) to the paired tiles. The R33-era quadratic-bezier
 * control point (cx/cy) was dead weight after the R57 pulse-ring rewrite —
 * nothing consumed it — and has been removed.
 * Returns an array of leg descriptors: { i, ax, ay, bx, by }
 * where i is the segment index of the break, (ax, ay) the entry tile center,
 * and (bx, by) the exit tile center.
 */
function buildTeleportLegs(pts, segLens, legBreak) {
  const legs = [];
  for (let i = 0; i < legBreak.length; i++) {
    if (!legBreak[i]) continue;
    legs.push({
      i,                              // index of the break
      ax: pts[i].x,   ay: pts[i].y,   // entry tile center
      bx: pts[i+1].x, by: pts[i+1].y, // exit tile center
    });
  }
  return legs;
}

/* ── R58: Sequential staircase dwell ────────────────────────────
   In sequential playback each group owns a 1/N time slice and the head used
   to sweep it length-linearly — staircase legs are zero-length, so dwell time
   was invisible. mapSequentialDwell converts the slice's time fraction into a
   piecewise drawn-length: the head walks, PAUSES at each staircase entry for
   a dwell share (stairSec expressed in walk-speed pixel-equivalents), then
   resumes. drawPortalDwellArc renders the pause as a clock-fill ring sweep
   (Option C1) in the group's color, matching the R57 pulse-ring language. */

/** Cached prefers-reduced-motion check for canvas animations (CSS can't reach these). */
let _vizReducedMotionMQ = null;
function prefersReducedMotionViz() {
  if (!_vizReducedMotionMQ && window.matchMedia) {
    _vizReducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return !!(_vizReducedMotionMQ && _vizReducedMotionMQ.matches);
}

/**
 * mapSequentialDwell(t01, totalLen, stairLegs, prefix, dwellPx)
 * Piecewise time→length mapping for sequential mode with staircase pauses.
 * t01       — 0..1 time fraction through the group's slice
 * totalLen  — geometric path length (walkable px; teleports are zero)
 * stairLegs — buildTeleportLegs output (ascending leg index order)
 * prefix    — cumulative drawn-length at each point (prefix[leg.i] = entry)
 * dwellPx   — pause size in pixel-equivalents (stairSec ÷ walkSec × cellSize)
 * Returns { drawnLen, dwellLeg, dwellFrac } — dwellLeg is non-null (with
 * dwellFrac 0..1) only while the head is paused at that leg's entry tile.
 */
function mapSequentialDwell(t01, totalLen, stairLegs, prefix, dwellPx) {
  const clamped = Math.max(0, Math.min(1, t01));
  if (!stairLegs.length || dwellPx <= 0 || totalLen <= 0) {
    return { drawnLen: totalLen * clamped, dwellLeg: null, dwellFrac: 0 };
  }
  const timeLen = totalLen + stairLegs.length * dwellPx;
  let t = clamped * timeLen;
  for (const leg of stairLegs) {
    const entry = prefix[leg.i];
    if (t <= entry) return { drawnLen: t, dwellLeg: null, dwellFrac: 0 };
    if (t <= entry + dwellPx) {
      return { drawnLen: entry, dwellLeg: leg, dwellFrac: (t - entry) / dwellPx };
    }
    t -= dwellPx;   // consume this pause and keep walking
  }
  return { drawnLen: Math.min(t, totalLen), dwellLeg: null, dwellFrac: 0 };
}

/**
 * drawPortalDwellArc — Option C1 clock-fill sweep at a staircase entry tile.
 * A faint full-circle track plus a group-colored arc that sweeps clockwise
 * from 12 o'clock, filling in proportion to dwellFrac (0..1). Under
 * prefers-reduced-motion the sweep is replaced by a static ring for the
 * whole dwell so the pause still reads without animated geometry.
 */
function drawPortalDwellArc(ctx, leg, dwellFrac, baseR, color, alphaScale) {
  const r = baseR * 1.5;
  const w = Math.max(1.5, baseR * 0.45);
  ctx.save();
  ctx.lineCap = 'round';
  if (prefersReducedMotionViz()) {
    ctx.globalAlpha = 0.6 * alphaScale;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(leg.ax, leg.ay, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Track ring (subtle, full circle)
  ctx.globalAlpha = 0.18 * alphaScale;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(leg.ax, leg.ay, r, 0, Math.PI * 2);
  ctx.stroke();
  // Progress sweep from 12 o'clock, clockwise
  const start = -Math.PI / 2;
  ctx.globalAlpha = 0.85 * alphaScale;
  ctx.beginPath();
  ctx.arc(leg.ax, leg.ay, r, start, start + Math.PI * 2 * Math.max(0, Math.min(1, dwellFrac)));
  ctx.stroke();
  ctx.restore();
}

/**
 * R57: drawPortalPulse — elegant staircase teleport rendering.
 * Replaces the old map-spanning dashed bezier arcs. For each staircase
 * (teleport) leg we draw a localized, group-colored pulse at the two paired
 * tiles, keyed statelessly to how far the animated head (drawnLen) is from the
 * leg's entry point (legDist = geometric path length up to the entry tile):
 *   • Approaching the entry tile (descent): a ring CONTRACTS into it.
 *   • Just after teleporting out the exit tile (ascent): a ring EXPANDS from it
 *     with a brief inner core flash at the moment of emergence.
 * Outside a short window on either side nothing is drawn, so passed/arrived
 * groups leave no persistent artifact — the map stays quiet.
 *
 * leg:     { ax,ay, bx,by } endpoint screen coords from buildTeleportLegs.
 * legDist: cumulative drawn-length at the entry endpoint (ax,ay).
 * drawnLen: current animated head length along the path.
 * baseR:   ring radius unit (px); alphaScale: arrival tail-fade multiplier.
 */
function drawPortalPulse(ctx, leg, legDist, drawnLen, baseR, color, alphaScale) {
  const W = baseR * 3.2;          // descent/ascent window length (px along path)
  const d = drawnLen - legDist;   // <0 approaching entry, >0 past exit
  if (d < -W || d > W) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, baseR * 0.5);

  if (d <= 0) {
    // Descent — ring contracts into the ENTRY tile as the head nears it.
    const p = 1 + d / W;                          // 0 (far) → 1 (at portal)
    const r = baseR * (1.9 - 1.5 * p);            // shrinks inward
    ctx.globalAlpha = Math.max(0, Math.sin(p * Math.PI) * 0.55 * alphaScale);
    ctx.beginPath(); ctx.arc(leg.ax, leg.ay, Math.max(0.5, r), 0, Math.PI * 2); ctx.stroke();
  } else {
    // Ascent — ring expands out of the EXIT tile just after emergence.
    const q = d / W;                              // 0 (just emerged) → 1 (gone)
    const r = baseR * (0.4 + 1.6 * q);            // grows outward
    ctx.globalAlpha = Math.max(0, (1 - q) * 0.6 * alphaScale);
    ctx.beginPath(); ctx.arc(leg.bx, leg.by, Math.max(0.5, r), 0, Math.PI * 2); ctx.stroke();
    if (q < 0.5) {                                // soft core flash at emergence
      ctx.globalAlpha = Math.max(0, (1 - q * 2) * 0.5 * alphaScale);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(leg.bx, leg.by, baseR * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * R50: buildCollisionSimulation(activeEntries, segForEntry, cellSize, walkSec, stairSec)
 *
 * Pre-computes per-entry cell-occupancy timelines so drawPlaybackFrame can:
 *   1. Hold groups at cell boundaries when a tile is occupied — R53 quadrant
 *      rules: each cell is split into 4 quadrants and a group reserves only
 *      the right half of the cell relative to its heading (entry + exit
 *      quadrants). Opposing flows occupy disjoint halves and never block;
 *      same-direction followers need 50% leader clearance on their shared
 *      quadrants; perpendicular crossings overlap one quadrant (75% rule).
 *      R54: reservations are JUST-IN-TIME per square — a slot only blocks
 *      while its group physically occupies the square; groups freely pass
 *      ahead of others that haven't arrived yet, and a waiting group keeps
 *      holding its current square so followers queue behind it.
 *   2. Return per-entry arrival times for the travel-time panel.
 *
 * Returns: Map<entry, { timelineMs: [{cellIdx, enterMs, exitMs}], totalMs, arrivedMs, waitEvents }>
 * waitEvents: [{cellIdx, waitMs}] for visual wait indicators.
 */
function buildCollisionSimulation(activeEntries, segForEntry, walkSec, stairSec) {
  // Build per-entry ordered hallway cell arrays (de-duplicated).
  const entryPaths = new Map();
  for (const e of activeEntries) {
    const s = segForEntry(e);
    if (!s) continue;
    const cells = [];
    const seen  = new Set();
    for (const c of (s.hallwayCells || [])) {
      const k = `${c.floorId}:${c.x},${c.y}`;
      if (!seen.has(k)) { seen.add(k); cells.push({ x: c.x, y: c.y, floorId: c.floorId }); }
    }
    entryPaths.set(e, cells);
  }

  // Per-cell occupancy slots: Map<"fid:x,y", [{entry, enterMs, exitMs}]>
  const occupancy = new Map();
  const result    = new Map();

  // Priority order: alphabetical by group.id (or name as fallback).
  const sorted = [...activeEntries].sort((a, b) =>
    (a.group.id || a.group.name || '').localeCompare(b.group.id || b.group.name || ''));

  // R53: Quadrant occupancy — clearance applies only on quadrant overlap.
  //   • Opposite direction: disjoint right-lane halves, mask overlap = 0 →
  //     NO wait. The head-to-head right-side nudge handles the visual pass.
  //   • Same direction (dot > 0): both quadrants shared — follow like trains
  //     in successive block sections; leader only needs 50% slot clearance.
  //   • Crossing / turning / unknown (dot <= 0 with overlap): cautious 75%.
  const SAME_DIR_FRAC = 0.50;
  const CROSS_FRAC    = 0.75;
  const durMs         = walkSec * 1000;

  // Direction of travel through cell i (unit-ish grid vector toward next cell;
  // last cell inherits the approach direction). Cross-floor hops yield {0,0}.
  const dirAt = (cells, i) => {
    const a = cells[i];
    const b = (i + 1 < cells.length) ? cells[i + 1] : null;
    const p = (i > 0) ? cells[i - 1] : null;
    if (b && b.floorId === a.floorId) return { dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
    if (p && p.floorId === a.floorId) return { dx: Math.sign(a.x - p.x), dy: Math.sign(a.y - p.y) };
    return { dx: 0, dy: 0 };
  };

  // R53: Quadrant occupancy — each hallway cell is split into 4 quadrants
  // (NW=1, NE=2, SW=4, SE=8 bitmask). A travelling group keeps to the RIGHT
  // half of the cell (American traffic rules): it reserves the quadrant it
  // enters through (right side of its incoming heading) plus the quadrant it
  // exits through (right side of its outgoing heading). Example: heading
  // north, a group enters via the SE quadrant and reserves SE+NE. Heading
  // east, it enters via SW and reserves SW+SE. Opposing straight-line traffic
  // therefore occupies the disjoint other half and never conflicts; turns
  // reserve the true corner crossed (a left turn cuts the oncoming lane and
  // correctly blocks against it).
  // Screen coords: y grows downward, so right-perp of heading (dx,dy) = (-dy, dx).
  const quadBit = (qx, qy) => (qy < 0 ? (qx < 0 ? 1 : 2) : (qx < 0 ? 4 : 8));
  const quadMaskAt = (cells, i) => {
    const a  = cells[i];
    const nb = (i + 1 < cells.length) ? cells[i + 1] : null;
    const pv = (i > 0) ? cells[i - 1] : null;
    const adj = (o) => o && o.floorId === a.floorId &&
                       (Math.abs(o.x - a.x) + Math.abs(o.y - a.y)) === 1;
    const inDir  = adj(pv) ? { dx: a.x - pv.x,  dy: a.y - pv.y  } : null;
    const outDir = adj(nb) ? { dx: nb.x - a.x,  dy: nb.y - a.y  } : null;
    const dIn  = inDir  || outDir;
    const dOut = outDir || inDir;
    if (!dIn) return 15;   // teleport hop / isolated cell — reserve all 4 quadrants
    let mask = 0;
    // Entry quadrant: right side of incoming heading, back half of the cell.
    mask |= quadBit(-dIn.dy  - dIn.dx,   dIn.dx  - dIn.dy);
    // Exit quadrant: right side of outgoing heading, front half of the cell.
    mask |= quadBit(-dOut.dy + dOut.dx,  dOut.dx + dOut.dy);
    return mask;
  };

  for (const e of sorted) {
    const cells = entryPaths.get(e);
    if (!cells || cells.length === 0) {
      result.set(e, { timelineMs: [], cellCount: 0, totalMs: 0, arrivedMs: 0, waitMs: 0 });
      continue;
    }

    const timeline  = [];
    let curMs       = 0;
    let totalWaitMs = 0;
    let prevOcc     = null;   // R54: this group's occupancy record for the square it last entered

    for (let i = 0; i < cells.length; i++) {
      const c    = cells[i];
      const k    = `${c.floorId}:${c.x},${c.y}`;
      const dir  = dirAt(cells, i);
      const mask = quadMaskAt(cells, i);   // R53: right-lane quadrant footprint

      // Find earliest entry time respecting quadrant-overlap block rules.
      // R54: JUST-IN-TIME reservation — a square is only blocked while a
      // conflicting group is PHYSICALLY inside it. A booked slot whose
      // enterMs lies in the future does NOT block: if this group can fully
      // transit the square before that group arrives (enterMs + durMs <=
      // slot.enterMs) it passes ahead freely, regardless of priority order.
      // Otherwise it waits for that slot's clearance fraction:
      //   • disjoint quadrant masks → never a conflict (opposing right-lane
      //     halves pass freely);
      //   • same direction (dot > 0) → train-block 50% leader clearance;
      //   • crossing / turning (dot <= 0 with overlap) → cautious 75%.
      // Delaying enterMs can create conflicts with slots already examined,
      // so we iterate to a fixed point (enterMs is monotonically increasing
      // and bounded by the max clearance time, so this always terminates;
      // the guard is belt-and-braces).
      const slots  = occupancy.get(k) || [];
      let enterMs  = curMs;

      let _jitGuard = 0, _jitChanged = true;
      while (_jitChanged && _jitGuard++ < 64) {
        _jitChanged = false;
        for (const slot of slots) {
          if ((mask & slot.mask) === 0) continue;          // disjoint quadrants — no block
          if (enterMs + durMs <= slot.enterMs) continue;   // we fully clear before they arrive
          const dot     = dir.dx * slot.dir.dx + dir.dy * slot.dir.dy;
          const frac    = (dot > 0) ? SAME_DIR_FRAC : CROSS_FRAC;
          const clearMs = slot.enterMs + (slot.exitMs - slot.enterMs) * frac;
          if (enterMs < clearMs) { enterMs = clearMs; _jitChanged = true; }
        }
      }
      totalWaitMs += enterMs - curMs;

      // R54: hold-current-square — while this group waits at the boundary it
      // is still standing in its PREVIOUS square, so extend that occupancy
      // record through the wait. Followers behind it queue realistically.
      // (The timeline entry keeps its walk-time exitMs so the renderer still
      // freezes the comet hard at the cell boundary during the wait.)
      if (prevOcc && enterMs > curMs) prevOcc.exitMs = enterMs;

      const exitMs = enterMs + durMs;
      if (!occupancy.has(k)) occupancy.set(k, []);
      const occRec = { entry: e, enterMs, exitMs, dir, mask };
      occupancy.get(k).push(occRec);
      prevOcc = occRec;

      // cumCells = 1-based count of cells completed when this slot exits
      timeline.push({ cellIdx: i, cell: c, enterMs, exitMs, cumCells: i + 1 });
      curMs = exitMs;
    }

    result.set(e, {
      timelineMs: timeline,
      cellCount:  cells.length,
      totalMs:    curMs,
      arrivedMs:  curMs,
      waitMs:     totalWaitMs,
    });
  }

  return result;
}

/**
 * drawPlaybackFrame(data, pb)
 * Draws only the current transition's paths, each "drawing itself" up to
 * pb.progress (0..1). Simultaneous mode advances all groups together;
 * sequential mode gives each group a 1/N slice of the cycle.
 *
 * R50 additions:
 *   • Per-group real-time localProgress derived from collision simulation timelines.
 *   • Groups wait at cell boundaries per occupancy rules; tail fades after arrival.
 * R54: groups always render on the right half of each square relative to
 *   their travel direction (keep-right bias inside offsetPolyline); the old
 *   R50 head-to-head nudge and getHeadToHeadNudge helper were removed.
 *
 * Coordinate system matches drawVizPaths: cell (c,r) center = ((c+0.5)*cellSize,(r+0.5)*cellSize).
 * The blueprint veil is already applied by drawVizBlueprint() (Step 4).
 * R57/R58: Teleport (staircase) legs render as localized portal effects at the
 *   paired tiles — contracting/expanding pulse rings (drawPortalPulse), plus a
 *   sweeping dwell arc at the entry tile in sequential mode (drawPortalDwellArc).
 */
function drawPlaybackFrame(data, pb) {
  if (!data || !data.entries.length) return;
  const step     = pb.currentStep;
  const progress = pb.progress;
  const cellSize = getEffectiveCellSize();
  // R52: group icon size multiplier (comet head/tail + trail head dots)
  const iconScale = (typeof pb.cometScale === 'number' && pb.cometScale > 0) ? pb.cometScale : 1.5;
  const modIdx   = step + 1;

  const segForEntry = (entry) =>
    (entry.rawSegments || []).find(s => s.fromMod === modIdx && s.path && s.path.length > 1);

  const activeEntries = data.entries.filter(e => !!segForEntry(e));
  if (!activeEntries.length) return;

  // R53: Live head-cell registry for the hover tooltip. Rebuilt every frame;
  // maps "floorId:x,y" → [{name, color}] for each comet HEAD currently inside
  // that grid cell (tails never count). Cleared by PlaybackController.close().
  const liveHeads = new Map();
  pb._liveHeads = liveHeads;

  const isSeq      = pb.mode === 'sequential';
  const entryCount = activeEntries.length;

  // Adaptive lane/stroke sizing matching drawVizPaths
  const z = AppState.viz.zoom;
  const scaleComp = AppState.viz.constantWidth ? (1 / z) : 1;
  const sizeFactor = cellSize / 40;
  const maxConc_pb = (data && data.stats && data.stats.maxConcurrency) ? data.stats.maxConcurrency : 1;
  let laneSpace, strokeW;
  if (maxConc_pb <= 1) {
    strokeW   = VIZ_BASE_STROKE * sizeFactor * scaleComp;
    laneSpace = VIZ_BASE_LANE   * sizeFactor * scaleComp;
  } else {
    const budgetPx_pb  = cellSize * 0.65;
    const maxStroke_pb = budgetPx_pb / (maxConc_pb + 0.5);
    strokeW   = Math.min(VIZ_BASE_STROKE * sizeFactor, maxStroke_pb) * scaleComp;
    const pitch_pb = Math.min(strokeW + Math.max(1, strokeW * 0.3), budgetPx_pb / Math.max(maxConc_pb - 1, 1));
    laneSpace = pitch_pb * scaleComp;
  }

  // R56: Head-dot radius base. The per-lane strokeW above is squeezed hard when
  // many groups share a corridor (budget / (maxConc + 0.5)), which collapsed the
  // comet head/travel dots to a couple of pixels at 30+ groups. The dots are
  // position markers, not lanes, so we floor their base to a cell-relative size
  // that survives the squeeze. At low concurrency strokeW already exceeds the
  // floor, so the look there is unchanged. The size slider (iconScale) then
  // multiplies this for a much more aggressive top end.
  const dotStroke = Math.max(strokeW, cellSize * 0.10 * scaleComp);

  const cxFn = (c) => (c + 0.5) * cellSize;

  // R50: Collision-aware simulation
  const isRealtime = pb.realtimeCycle;
  const rtWalkSec  = (AppState.settings.tileWalkTime  != null) ? AppState.settings.tileWalkTime  : 3;
  const rtStairSec = (AppState.settings.staircaseTime != null) ? AppState.settings.staircaseTime : 8;

  let collisionMap = null;
  let rtCycleMs = 1000;

  if (!isSeq) {
    collisionMap = buildCollisionSimulation(activeEntries, segForEntry, rtWalkSec, rtStairSec);
    for (const [, sim] of collisionMap) {
      if (sim.arrivedMs > rtCycleMs) rtCycleMs = sim.arrivedMs;
    }
    pb._r50CycleMs = rtCycleMs;
  }

  // Update the travel-time side panel every frame
  updateTravelTimePanel(activeEntries, segForEntry, collisionMap, step, progress, rtCycleMs);

  activeEntries.forEach((entry, entryIdx) => {
    const seg = segForEntry(entry);
    if (!seg) return;

    // R50: Derive position directly from collision-simulation timeline.
    // elapsedMs = how many ms have elapsed since this transition started.
    // For collision mode: walk the timeline to find which cell we're in and
    // interpolate fractionally within it. This produces hard stops at cell
    // boundaries during wait intervals — the group truly freezes.
    const sim = collisionMap && collisionMap.get(entry);
    const elapsedMs = progress * rtCycleMs;

    // isArrived: the group has finished its last scheduled cell.
    let isArrived = false;
    // localProgress: 0..1 fraction of the full path for sequential/fallback use.
    let localProgress;
    // drawnLenOverride: when set, overrides the localProgress→drawnLen pipeline.
    let drawnLenOverride = null;

    if (isSeq) {
      const sliceStart = entryIdx / entryCount;
      const sliceEnd   = (entryIdx + 1) / entryCount;
      localProgress = Math.max(0, Math.min(1, (progress - sliceStart) / (sliceEnd - sliceStart)));
      isArrived = localProgress >= 1.0;
    } else if (sim && sim.timelineMs.length > 0) {
      const tl = sim.timelineMs;
      if (elapsedMs >= sim.arrivedMs) {
        // Group has finished — fully arrived.
        isArrived     = true;
        localProgress = 1.0;
        drawnLenOverride = Infinity;  // draw full path (tail fade will clip it)
      } else {
        // Find which cell slot we are currently inside.
        let activeCellIdx = -1;
        let cellFrac      = 0;   // 0..1 fraction through this cell's own slot

        for (let ti = 0; ti < tl.length; ti++) {
          const slot = tl[ti];
          if (elapsedMs < slot.enterMs) {
            // We are waiting BEFORE this cell — freeze at end of previous cell.
            activeCellIdx = ti - 1;
            cellFrac      = 1.0;   // fully through previous cell (held at exit)
            break;
          } else if (elapsedMs <= slot.exitMs) {
            // We are INSIDE this cell — interpolate.
            activeCellIdx = ti;
            cellFrac      = (elapsedMs - slot.enterMs) / (slot.exitMs - slot.enterMs);
            break;
          }
        }
        if (activeCellIdx === -1 && elapsedMs < tl[0].enterMs) {
          // Before the very first cell — waiting at the origin.
          activeCellIdx = -1;
          cellFrac      = 0;
        }

        // Convert (activeCellIdx, cellFrac) to a fraction of the full cellCount.
        const cellCount  = sim.cellCount || tl.length;
        const cellsDrawn = (activeCellIdx < 0) ? 0 : (activeCellIdx + cellFrac);
        localProgress    = cellsDrawn / cellCount;
        // drawnLenOverride will be computed from localProgress after totalLen is known.
        // We set a marker so the code below uses cell-linear interpolation not stair-phase logic.
        drawnLenOverride = null;   // computed below from localProgress once totalLen known
      }
    } else {
      // No collision data (sequential or no sim) — original linear progress.
      localProgress = Math.min(1, progress);
      isArrived     = localProgress >= 1.0;
    }

    // R50: Tail fade after arrival
    let tailAlphaScale  = 1.0;
    let tailFadeProgress = 0;
    if (isArrived && sim) {
      const FADE_MS    = Math.min(rtCycleMs * 0.15, 1800);
      const fadedSince = elapsedMs - sim.arrivedMs;
      tailFadeProgress = Math.min(1, fadedSince / FADE_MS);
      tailAlphaScale   = 1 - tailFadeProgress;
      if (tailAlphaScale <= 0) return;
    }

    // R54: the R50 head-to-head nudge (first-cell-only detection, whole-path
    // uniform offset) is removed — superseded by the per-point keep-right
    // bias now applied inside offsetPolyline for every group, every cell.

    const rawCells = seg.path.map(p => ({ x: p.x, y: p.y, floorId: p.floorId }));
    if (rawCells.length < 2) return;

    const segFloorId = rawCells[0].floorId;
    const offY = floorOffsetY(segFloorId);
    const cyFn = (r) => (r + 0.5) * cellSize + offY;

    let offsetPts = offsetPolyline(rawCells, entry, laneSpace, cxFn, cyFn, segFloorId);

    const annotatedPts = offsetPts.map((op, i) => ({
      x: op.x, y: op.y,
      floorId: rawCells[i].floorId,
      gx: rawCells[i].x,
      gy: rawCells[i].y,
    }));
    if (annotatedPts.length < 2) return;

    let totalLen = 0;
    const segLens = [];
    const legBreak = [];
    for (let i = 1; i < annotatedPts.length; i++) {
      const sameFloor = annotatedPts[i].floorId === annotatedPts[i-1].floorId;
      const gd = sameFloor ? (Math.abs(annotatedPts[i].gx - annotatedPts[i-1].gx) + Math.abs(annotatedPts[i].gy - annotatedPts[i-1].gy)) : 99;
      const teleport = !sameFloor || gd > 1;
      const dx = annotatedPts[i].x - annotatedPts[i-1].x;
      const dy = annotatedPts[i].y - annotatedPts[i-1].y;
      const l = teleport ? 0 : Math.sqrt(dx*dx + dy*dy);
      segLens.push(l);
      legBreak.push(teleport);
      totalLen += l;
    }

    const stairLegs = buildTeleportLegs(annotatedPts, segLens, legBreak);
    // R57: cumulative drawn-length up to each point — used to key portal pulses
    // to the head's distance from each staircase entry tile (_prefix[i] = drawn
    // length when the head reaches annotatedPts[i]).
    const _prefix = [0];
    for (let i = 0; i < segLens.length; i++) _prefix.push(_prefix[i] + segLens[i]);

    // R57: drawnLen is length-linear with progress. Staircase hops are
    // zero-length teleport legs; descent/ascent is shown locally at the
    // paired tiles by drawPortalPulse instead of map-spanning geometry.
    // R58: in SEQUENTIAL mode the slice's time fraction is now routed through
    // mapSequentialDwell, which pauses the head at each staircase entry for a
    // dwell share (stairSec in walk-speed pixel-equivalents) while a clock-fill
    // arc sweeps at the portal tile — restoring visible dwell time.
    // drawnLenOverride=Infinity means fully arrived (draw entire path for tail-fade).
    const clampedLP = Math.min(localProgress, 1);
    let drawnLen, dwellLeg = null, dwellFrac = 0;
    if (drawnLenOverride === Infinity) {
      drawnLen = totalLen;
    } else if (isSeq && stairLegs.length && !isArrived) {
      const dwellPx = (rtWalkSec > 0 ? (rtStairSec / rtWalkSec) : 2) * cellSize;
      const m = mapSequentialDwell(clampedLP, totalLen, stairLegs, _prefix, dwellPx);
      drawnLen = m.drawnLen; dwellLeg = m.dwellLeg; dwellFrac = m.dwellFrac;
    } else {
      drawnLen = Math.min(totalLen * clampedLP, totalLen);
    }

    const color = entry.group.color || '#3b82f6';
    const isComet = pb.animStyle === 'comet';

    // Trail mode drawing (with arrival tail-fade)
    if (!isComet) {
      const trailAlpha  = isArrived ? (0.92 * tailAlphaScale) : 0.92;
      // Arrived tail: clip from origin side proportional to fade progress
      const revealFrom  = isArrived ? (totalLen * tailFadeProgress * 0.85) : 0;

      vizCtx.save();
      vizCtx.strokeStyle = color;
      vizCtx.lineWidth   = strokeW;
      vizCtx.lineCap     = 'round';
      vizCtx.lineJoin    = 'round';
      vizCtx.globalAlpha = trailAlpha;
      vizCtx.beginPath();

      let accumulated = 0;
      let penDown = false;
      for (let i = 0; i < segLens.length; i++) {
        if (legBreak[i]) {
          penDown = false;
          vizCtx.moveTo(annotatedPts[i+1].x, annotatedPts[i+1].y);
          continue;
        }
        const segStart = accumulated;
        const segEnd   = accumulated + segLens[i];
        const remaining = drawnLen - accumulated;
        if (remaining <= 0) break;

        const frac = Math.min(remaining / segLens[i], 1);
        const tx = annotatedPts[i].x + (annotatedPts[i+1].x - annotatedPts[i].x) * frac;
        const ty = annotatedPts[i].y + (annotatedPts[i+1].y - annotatedPts[i].y) * frac;

        if (segEnd <= revealFrom) {
          vizCtx.moveTo(tx, ty);
          penDown = false;
        } else if (segStart < revealFrom) {
          const sf = (revealFrom - segStart) / segLens[i];
          const sx = annotatedPts[i].x + (annotatedPts[i+1].x - annotatedPts[i].x) * sf;
          const sy = annotatedPts[i].y + (annotatedPts[i+1].y - annotatedPts[i].y) * sf;
          vizCtx.moveTo(sx, sy);
          vizCtx.lineTo(tx, ty);
          penDown = true;
        } else {
          if (!penDown) { vizCtx.moveTo(annotatedPts[i].x, annotatedPts[i].y); penDown = true; }
          vizCtx.lineTo(tx, ty);
        }
        accumulated += segLens[i];
        if (accumulated >= drawnLen) break;
      }
      vizCtx.stroke();
      vizCtx.restore();
    }

    // Comet mode drawing
    if (isComet && clampedLP > 0) {
      const TAIL_TILES = 2;
      const tailLen = TAIL_TILES * cellSize;
      const tailStart = Math.max(0, drawnLen - tailLen);
      const TAIL_SEGMENTS = 18;
      const tailPoints = [];
      let acc = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (legBreak[i]) { acc += 0; continue; }
        const segStart = acc, segEnd = acc + segLens[i];
        if (segEnd < tailStart) { acc = segEnd; continue; }
        if (segStart > drawnLen) break;
        const clampA = Math.max(segStart, tailStart);
        const clampB = Math.min(segEnd, drawnLen);
        if (segLens[i] === 0) { acc = segEnd; continue; }
        const steps = Math.max(2, Math.ceil(TAIL_SEGMENTS * (clampB - clampA) / tailLen));
        for (let s = 0; s <= steps; s++) {
          const d = clampA + (clampB - clampA) * (s / steps);
          const f = (d - segStart) / segLens[i];
          tailPoints.push({
            x: annotatedPts[i].x + (annotatedPts[i+1].x - annotatedPts[i].x) * f,
            y: annotatedPts[i].y + (annotatedPts[i+1].y - annotatedPts[i].y) * f,
            t: (d - tailStart) / Math.max(drawnLen - tailStart, 1),
          });
        }
        acc = segEnd;
      }
      if (tailPoints.length >= 2) {
        vizCtx.save();
        vizCtx.lineCap = 'round'; vizCtx.lineJoin = 'round';
        for (let i = 1; i < tailPoints.length; i++) {
          const tMid = (tailPoints[i-1].t + tailPoints[i].t) * 0.5;
          vizCtx.globalAlpha = Math.pow(tMid, 1.4) * 0.88 * tailAlphaScale;
          vizCtx.strokeStyle = color;
          vizCtx.lineWidth = strokeW * (0.3 + 0.7 * tMid) * iconScale;
          vizCtx.beginPath();
          vizCtx.moveTo(tailPoints[i-1].x, tailPoints[i-1].y);
          vizCtx.lineTo(tailPoints[i].x,   tailPoints[i].y);
          vizCtx.stroke();
        }
        vizCtx.restore();
      }
    }

    // R57: Staircase teleports — localized descend/emerge pulses at the paired
    // tiles instead of map-spanning bezier arcs. portalR tracks the head-dot
    // size so the pulse reads at any zoom / icon-size setting. Nothing is drawn
    // outside the head's approach/emerge window, so the map stays quiet.
    const portalR = dotStroke * 2.4 * iconScale;
    for (const leg of stairLegs) {
      drawPortalPulse(vizCtx, leg, _prefix[leg.i], drawnLen, portalR, color, tailAlphaScale);
    }
    // R58: sequential dwell — clock-fill sweep at the entry tile while the
    // head is paused there (dwellLeg is only ever set in sequential mode).
    if (dwellLeg) {
      drawPortalDwellArc(vizCtx, dwellLeg, dwellFrac, portalR, color, tailAlphaScale);
    }

    // Head position — always interpolated along the hallway. Staircase hops are
    // instantaneous teleports (the pulse above conveys the descent/ascent).
    let headX = annotatedPts[0].x, headY = annotatedPts[0].y;
    {
      let acc2 = 0;
      let headCell = annotatedPts[0];                                   // R53
      for (let i = 0; i < segLens.length; i++) {
        if (legBreak[i]) { headX = annotatedPts[i+1].x; headY = annotatedPts[i+1].y; headCell = annotatedPts[i+1]; continue; }
        const rem = drawnLen - acc2;
        if (rem <= 0) break;
        const frac = Math.min(rem / segLens[i], 1);
        headX = annotatedPts[i].x + (annotatedPts[i+1].x - annotatedPts[i].x) * frac;
        headY = annotatedPts[i].y + (annotatedPts[i+1].y - annotatedPts[i].y) * frac;
        headCell = (frac < 0.5) ? annotatedPts[i] : annotatedPts[i+1];  // R53: nearest grid cell
        acc2 += segLens[i];
        if (acc2 >= drawnLen) break;
      }
      // R53: register this group's head cell for the hover tooltip. Arrived
      // groups are excluded (they're inside their room — only travelling
      // heads occupy hallway squares), and the fading tail never counts.
      if (!isArrived && clampedLP > 0 && headCell && headCell.gx != null) {
        const hk = floorCellKey(headCell.floorId, headCell.gx, headCell.gy);
        if (!liveHeads.has(hk)) liveHeads.set(hk, []);
        liveHeads.get(hk).push({ name: entry.group.name, color: entry.group.color || '#3b82f6' });
      }
    }

    // Head dot — only while travelling, not after arrival
    if (!isArrived && clampedLP > 0) {
      if (isComet) {
        vizCtx.save();
        vizCtx.globalAlpha = 0.25; vizCtx.fillStyle = color;
        vizCtx.beginPath(); vizCtx.arc(headX, headY, dotStroke * 2.2 * iconScale, 0, Math.PI * 2); vizCtx.fill();
        vizCtx.globalAlpha = 1.0; vizCtx.fillStyle = '#ffffff';
        vizCtx.beginPath(); vizCtx.arc(headX, headY, dotStroke * 1.2 * iconScale, 0, Math.PI * 2); vizCtx.fill();
        vizCtx.fillStyle = color;
        vizCtx.beginPath(); vizCtx.arc(headX, headY, dotStroke * 0.7 * iconScale, 0, Math.PI * 2); vizCtx.fill();
        vizCtx.restore();
      } else {
        vizCtx.fillStyle = '#ffffff';
        vizCtx.beginPath(); vizCtx.arc(headX, headY, dotStroke * 0.9 * iconScale, 0, Math.PI * 2); vizCtx.fill();
        vizCtx.fillStyle = color;
        vizCtx.beginPath(); vizCtx.arc(headX, headY, dotStroke * 0.55 * iconScale, 0, Math.PI * 2); vizCtx.fill();
      }
    }

    // R50: Amber waiting ring when held at a cell boundary
    if (!isArrived && !isComet && sim && sim.timelineMs.length > 0 && clampedLP > 0.01) {
      const elapsedMs = progress * rtCycleMs;
      let isWaiting = false;
      for (let ti = 0; ti < sim.timelineMs.length; ti++) {
        const slot = sim.timelineMs[ti];
        const prevExit = ti > 0 ? sim.timelineMs[ti-1].exitMs : 0;
        if (elapsedMs < slot.enterMs - 10 && elapsedMs >= prevExit) {
          isWaiting = true; break;
        }
      }
      if (isWaiting) {
        const pulsePhase = (Date.now() % 900) / 900;
        const pulseR = (dotStroke * 1.6 + dotStroke * 0.5 * Math.sin(pulsePhase * Math.PI * 2)) * iconScale;
        vizCtx.save();
        vizCtx.globalAlpha = 0.45;
        vizCtx.strokeStyle = '#fbbf24';
        vizCtx.lineWidth = 1.5;
        vizCtx.beginPath(); vizCtx.arc(headX, headY, pulseR, 0, Math.PI * 2); vizCtx.stroke();
        vizCtx.restore();
      }
    }

  });

  // Origin dots (trail mode)
  if (pb.animStyle !== 'comet') {
    activeEntries.forEach(entry => {
      const seg = segForEntry(entry);
      if (!seg || !seg.path.length) return;
      const rawCells0 = seg.path.map(p => ({ x: p.x, y: p.y, floorId: p.floorId }));
      const segFloorId0 = rawCells0[0].floorId;
      const offY0 = floorOffsetY(segFloorId0);
      const cyFn0 = (r) => (r + 0.5) * cellSize + offY0;
      const offsetPts0 = offsetPolyline(rawCells0, entry, laneSpace, cxFn, cyFn0, segFloorId0);
      const px = offsetPts0.length ? offsetPts0[0].x : (rawCells0[0].x + 0.5) * cellSize;
      const py = offsetPts0.length ? offsetPts0[0].y : (rawCells0[0].y + 0.5) * cellSize + offY0;
      const dotR = strokeW * 1.1;
      vizCtx.save();
      vizCtx.fillStyle = '#ffffff';
      vizCtx.beginPath(); vizCtx.arc(px, py, dotR + 2, 0, Math.PI * 2); vizCtx.fill();
      vizCtx.fillStyle = entry.group.color || '#3b82f6';
      vizCtx.beginPath(); vizCtx.arc(px, py, dotR, 0, Math.PI * 2); vizCtx.fill();
      vizCtx.restore();
    });
  }
}

/**
 * R50: updateTravelTimePanel
 * Populates the right-side travel-time panel with per-group rows sorted
 * alphabetically, showing total walk + wait time and a progress bar.
 * Called every animation frame from drawPlaybackFrame.
 */
function updateTravelTimePanel(activeEntries, segForEntry, collisionMap, step, progress, rtCycleMs) {
  const panel = document.getElementById('viz-travel-panel');
  if (!panel || !panel.classList.contains('open')) return;

  const list = document.getElementById('viz-travel-list');
  const stepLabel = document.getElementById('viz-travel-step-label');
  if (!list) return;

  const labels = getAllModLabels();
  const s = step;
  if (stepLabel) {
    stepLabel.textContent = (s < labels.length - 1)
      ? `${labels[s]} \u2192 ${labels[s + 1]}`
      : (labels[s] || `Step ${s + 1}`);
  }

  if (!activeEntries || activeEntries.length === 0) {
    list.innerHTML = '<div class="vtp-no-data">No active groups in this transition.</div>';
    return;
  }

  const sorted = [...activeEntries].sort((a, b) =>
    (a.group.name || '').localeCompare(b.group.name || ''));

  let maxMs = 1;
  for (const e of sorted) {
    const sim = collisionMap && collisionMap.get(e);
    if (sim && sim.arrivedMs > maxMs) maxMs = sim.arrivedMs;
  }

  const elapsedMs = progress * rtCycleMs;

  let html = '';
  for (const entry of sorted) {
    const color   = entry.group.color || '#3b82f6';
    const sim     = collisionMap && collisionMap.get(entry);
    const totalMs = sim ? sim.arrivedMs : 0;
    const waitMs  = sim ? sim.waitMs   : 0;
    const isGroupArrived = elapsedMs >= totalMs && totalMs > 0;
    const inProgress     = elapsedMs < totalMs;

    let timeStr, timeClass;
    if (totalMs === 0) {
      timeStr = '\u2014'; timeClass = '';
    } else {
      const waitSec = Math.round(waitMs / 1000);
      const totSec  = Math.round(totalMs / 1000);
      if (waitSec > 0) {
        timeStr  = `${totSec}s (+${waitSec}s wait)`;
        timeClass = 'has-delay';
      } else {
        timeStr  = `${totSec}s`;
        timeClass = '';
      }
      if (inProgress) {
        const pct = Math.round(Math.min(100, (elapsedMs / totalMs) * 100));
        timeStr  = `${pct}%\u2026 / ${timeStr}`;
        timeClass = 'waiting';
      }
    }

    const barPct    = maxMs > 0 ? Math.round((totalMs / maxMs) * 100) : 0;
    const arrivedBadge = isGroupArrived ? ' \u2713' : '';

    html += `
      <div class="vtp-row">
        <div class="vtp-swatch" style="background:${color}"></div>
        <div class="vtp-name" title="${entry.group.name}">${entry.group.name}${arrivedBadge}</div>
        <div class="vtp-time ${timeClass}">${timeStr}</div>
      </div>
      <div class="vtp-bar-wrap">
        <div class="vtp-bar-bg">
          <div class="vtp-bar-fill" style="width:${barPct}%;background:${color};opacity:0.5;"></div>
        </div>
      </div>`;
  }

  list.innerHTML = html;
}

/**
 * computeTravelTimes(data)
 * Mutates each rendered segment to add:
 *   seg.travelSec — base tile traversal + staircase overhead
 *   seg.delaySec  — congestion delay from tiles shared with other groups
 *                   within the SAME transition window.
 * Also sets entry.totalTravelSec / entry.totalDelaySec.
 * Safe to call with null / empty data.
 *
 * Per-tile congestion multiplier (concurrent OTHER groups on a tile):
 *   1 other  → +0.2× walkSec     2 others → +0.5× walkSec     3+ → +0.8× walkSec
 * R59: "others" is now student-weighted — effOthers = (sum of the other
 *   groups' headcounts on the tile) / defaultGroupSize, fed through the
 *   shared congestionDelayMult() curve (piecewise-linear through the same
 *   anchor points). With every size blank this reproduces the R58 integer
 *   behavior exactly.
 */
function computeTravelTimes(data) {
  if (!data || !data.entries || !data.entries.length) return;
  const walkSec  = (AppState.settings.tileWalkTime  != null) ? AppState.settings.tileWalkTime  : 3;
  const stairSec = (AppState.settings.staircaseTime != null) ? AppState.settings.staircaseTime : 8;
  const dgs = (Number.isFinite(AppState.settings.defaultGroupSize) && AppState.settings.defaultGroupSize > 0)
    ? AppState.settings.defaultGroupSize : 25;   // R59
  const entryWeights = data.entries.map(e =>
    groupWeight(e.group || AppState.schedules.groups.find(g => g.name === e.name)));  // R59

  const modCount = AppState.settings.modCount;
  const transitionTileSets = [];     // index = fromMod - 1 → Map<"x,y", Set<entryIdx>>
  for (let t = 0; t < modCount - 1; t++) transitionTileSets.push(new Map());

  // Pass 1 — register each group's hallway tiles per transition.
  data.entries.forEach((entry, eIdx) => {
    (entry.rawSegments || []).forEach(seg => {
      if (seg.error || seg.noTravel || !seg.hallwayCells || !seg.hallwayCells.length) return;
      const tIdx = seg.fromMod - 1;
      if (tIdx < 0 || tIdx >= transitionTileSets.length) return;
      const tileMap = transitionTileSets[tIdx];
      const seen = new Set();
      for (const cell of seg.hallwayCells) {
        const k = floorCellKey(cell.floorId, cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!tileMap.has(k)) tileMap.set(k, new Set());
        tileMap.get(k).add(eIdx);
      }
    });
  });

  // Pass 2 — compute times per segment.
  data.entries.forEach((entry, eIdx) => {
    let totalTravel = 0, totalDelay = 0;
    (entry.rawSegments || []).forEach(seg => {
      if (seg.error || seg.noTravel) { seg.travelSec = 0; seg.delaySec = 0; return; }
      const hallwayTiles = (seg.hallwayCells || []).length;
      const usesStair    = seg.usesStaircase ? 1 : 0;
      const baseSec      = hallwayTiles * walkSec + usesStair * stairSec;

      const tIdx = seg.fromMod - 1;
      let delaySec = 0;
      if (tIdx >= 0 && tIdx < transitionTileSets.length) {
        const tileMap = transitionTileSets[tIdx];
        const seen = new Set();
        for (const cell of (seg.hallwayCells || [])) {
          const k = floorCellKey(cell.floorId, cell.x, cell.y);
          if (seen.has(k)) continue;
          seen.add(k);
          const sharers = tileMap.get(k);
          if (!sharers) continue;
          // R59: sum the other sharers' headcounts, normalize by the default
          // group size, then map through the shared multiplier curve.
          let othersWeight = 0;
          for (const oIdx of sharers) if (oIdx !== eIdx) othersWeight += entryWeights[oIdx];
          if (othersWeight <= 0) continue;
          delaySec += walkSec * congestionDelayMult(othersWeight / dgs);
        }
      }

      seg.travelSec = Math.round(baseSec);
      seg.delaySec  = Math.round(delaySec);
      totalTravel  += baseSec;
      totalDelay   += delaySec;
    });
    entry.totalTravelSec = Math.round(totalTravel);
    entry.totalDelaySec  = Math.round(totalDelay);
  });
}

/** Called when the Visualize tab becomes active. */
function onVizTabActivated() {
  if (!_vizCanvasInit) initVizCanvas();
  rebuildRoomRegistry();        // ensure room → cell map is fresh
  refreshVizControls();
  // Round 22: sync export scale buttons with AppState
  const scaleRow = document.getElementById('viz-export-scale-row');
  if (scaleRow) {
    scaleRow.querySelectorAll('.viz-scale-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.scale === (AppState.viz.exportScale || 'high')));
  }
  // A stale render referencing deleted rooms/groups is rebuilt cleanly.
  if (AppState.viz.rendered) {
    vizRender();  // auto-refresh the prior render
  } else {
    renderVizCanvas();
    renderVizLegend();
    updateVizCompletenessBar();
  }
  // Round 29: Auto-trigger path health check if groups are present
  const _valBtn = document.getElementById('viz-validate-btn');
  if (_valBtn && AppState.schedules.groups.length > 0) {
    setTimeout(() => _valBtn.click(), 50);
  }
}

// Expose render hooks for the visualization module.
window.renderVizCanvas = renderVizCanvas;
window.buildVizRenderData = buildVizRenderData;

