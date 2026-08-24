// catalog.js — the prop catalog: every placeable type, in one table.
//
// Deliberately just data. `props.js` (Phase 1) keeps `type` an open string so
// a save file never has to know this table exists; this is the layer above it
// that gives those strings a footprint, a mount, a default height and a way to
// draw them (`geo`, matched to a builder in render.js). Adding a new prop is
// adding a row here — a rug or a trash can doesn't need a new code path.
//
// w/d are the footprint in feet at rotationY = 0 (w along local x, d along
// local z — the axis a wall-mounted panel's face points along is d). `h` is
// the prop's own height, used for procedural geometry, not for placement.
// `y` is the default mount height off the floor (0 for anything floor-standing).

export const CATEGORIES = ['Desks', 'Seating', 'Storage', 'Fixtures', 'Extras'];

export const PROP_CATALOG = [
  // ---- Desks ----
  { type: 'student-desk', name: 'Student Desk', category: 'Desks', icon: '🪑', w: 2, d: 1.5, h: 2.3, y: 0, color: '#c9a06a', mount: 'floor', geo: 'desk' },
  { type: 'teacher-desk', name: 'Teacher Desk', category: 'Desks', icon: '🗄️', w: 5, d: 2.5, h: 2.4, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'desk' },

  // ---- Seating ----
  { type: 'student-chair', name: 'Student Chair', category: 'Seating', icon: '💺', w: 1.5, d: 1.5, h: 2.6, y: 0, color: '#3f6fae', mount: 'floor', geo: 'chair' },
  { type: 'teacher-chair', name: 'Teacher Chair', category: 'Seating', icon: '🪑', w: 2, d: 2, h: 3.3, y: 0, color: '#2c2c34', mount: 'floor', geo: 'chair' },

  // ---- Storage ----
  { type: 'file-cabinet', name: 'File Cabinet', category: 'Storage', icon: '🗃️', w: 1.5, d: 2, h: 4.2, y: 0, color: '#6b7280', mount: 'floor', geo: 'cabinet' },
  { type: 'bookshelf-full', name: 'Bookshelf (Full)', category: 'Storage', icon: '📚', w: 3, d: 1, h: 6.5, y: 0, color: '#7a5230', mount: 'floor', geo: 'shelf' },
  { type: 'bookshelf-low', name: 'Bookshelf (Low)', category: 'Storage', icon: '📗', w: 3, d: 1, h: 3, y: 0, color: '#7a5230', mount: 'floor', geo: 'shelf' },
  { type: 'cubby-unit', name: 'Cubby Unit', category: 'Storage', icon: '🗂️', w: 4, d: 1.25, h: 3.5, y: 0, color: '#c17a4f', mount: 'floor', geo: 'cubby' },

  // ---- Fixtures ----
  { type: 'floor-lamp', name: 'Floor Lamp', category: 'Fixtures', icon: '💡', w: 1, d: 1, h: 5.5, y: 0, color: '#d8cba0', mount: 'floor', geo: 'lamp' },
  { type: 'tv', name: 'TV / Smart Board', category: 'Fixtures', icon: '📺', w: 4, d: 0.3, h: 2.4, y: 3.2, color: '#15161a', mount: 'wall', geo: 'panel' },
  { type: 'whiteboard', name: 'Whiteboard', category: 'Fixtures', icon: '🖊️', w: 4, d: 0.15, h: 3, y: 3.6, color: '#f4f4f2', mount: 'wall', geo: 'panel' },

  // ---- Extras ----
  { type: 'rug', name: 'Rug', category: 'Extras', icon: '▦', w: 6, d: 4, h: 0.08, y: 0, color: '#b0503f', mount: 'floor', geo: 'rug' },
  { type: 'trash-can', name: 'Trash Can', category: 'Extras', icon: '🗑️', w: 1.2, d: 1.2, h: 2, y: 0, color: '#4a4f57', mount: 'floor', geo: 'bin' },
  { type: 'sink', name: 'Sink', category: 'Extras', icon: '🚰', w: 2, d: 1.8, h: 3, y: 0, color: '#dfe3e6', mount: 'floor', geo: 'sink' },
];

const BY_TYPE = new Map(PROP_CATALOG.map((e) => [e.type, e]));

export const catalogEntry = (type) => BY_TYPE.get(type) || null;

export function catalogByCategory() {
  const out = CATEGORIES.map((category) => ({ category, entries: [] }));
  const idx = new Map(out.map((g) => [g.category, g]));
  for (const entry of PROP_CATALOG) {
    const g = idx.get(entry.category);
    if (g) g.entries.push(entry);
  }
  return out.filter((g) => g.entries.length);
}
