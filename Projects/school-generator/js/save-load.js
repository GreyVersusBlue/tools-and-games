// save-load.js — JSON serialization, file download/upload, localStorage autosave.

const AUTOSAVE_KEY = 'school-generator-autosave-v1';

export function serialize(state) {
  return JSON.stringify(state);
}

// Validate + normalize loaded data; returns a state object or throws.
export function deserialize(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || typeof d.w !== 'number' || typeof d.h !== 'number') {
    throw new Error('Not a school-generator save file');
  }
  const w = Math.min(200, Math.max(4, Math.floor(d.w)));
  const h = Math.min(200, Math.max(4, Math.floor(d.h)));
  const state = {
    version: 1,
    cellFt: 4,
    w, h,
    cells: new Array(w * h).fill(null),
    edgesH: new Array(w * (h + 1)).fill(0),
    edgesV: new Array((w + 1) * h).fill(0),
  };
  if (Array.isArray(d.cells)) {
    for (let i = 0; i < Math.min(d.cells.length, state.cells.length); i++) {
      const c = d.cells[i];
      if (c) {
        state.cells[i] = {
          room: typeof c.room === 'string' ? c.room.slice(0, 60) : null,
          color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : null,
        };
      }
    }
  }
  const copyEdges = (src, dst) => {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < Math.min(src.length, dst.length); i++) {
      dst[i] = src[i] === 1 || src[i] === 2 ? src[i] : 0;
    }
  };
  copyEdges(d.edgesH, state.edgesH);
  copyEdges(d.edgesV, state.edgesV);
  return state;
}

export function downloadSave(state, filename = 'school.json') {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function loadFromFile(file) {
  return file.text().then((text) => deserialize(text));
}

let autosaveTimer = null;
export function autosave(state) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(state));
    } catch (e) { /* storage full or blocked — skip */ }
  }, 400);
}

export function autosaveNow(state) {
  clearTimeout(autosaveTimer);
  try { localStorage.setItem(AUTOSAVE_KEY, serialize(state)); } catch (e) { /* ignore */ }
}

export function loadAutosave() {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserialize(json) : null;
  } catch (e) {
    return null;
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
}
