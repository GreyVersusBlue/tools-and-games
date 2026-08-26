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
//
// Every dimension is real: 1 world unit = 1 foot, and each row's numbers come
// from published furniture sizes (a 30in desk top is h 2.5, a locker is 12in
// wide and 72in tall, counters run 36in). Optional flags a builder or test
// reads off a row:
//   site: true    — an outdoor piece; may stand taller than a 10ft interior
//   tall: true    — a wall mount allowed to run past WALL_H (the gym hoop,
//                   whose rim wants a two-storey volume — an upper floor left
//                   open over the court, which the mezzanine machinery covers)
//   surface: true — floor-mounted but meant to sit on furniture, so its
//                   default y is a desk/counter height instead of 0
//   emit: {...}   — Phase 3: this row is a light. `lm` is its real output in
//                   lumens, `color` the lamp's own colour, `range` how far it
//                   reaches in feet and `dy` the offset from the prop's origin
//                   up to the emitter. lights.js reads it; the renderer turns
//                   lumens into whatever three.js wants. A row without `emit`
//                   is furniture, however lamp-shaped it looks.
//   sound: {...}  — Phase 4: this row makes noise. `kind` names the voice
//                   ('hum', 'hiss', 'burble', 'tick', 'pa', 'bell'), `db` is
//                   its real level in dBA at three feet, `hz`/`q` are what
//                   that noise is centred on and how peaky it is, and `dy`
//                   offsets the emitter the way `emit.dy` does. sound.js
//                   reads it; a row without one is silent, however mechanical
//                   it looks. Note how many of these landed on rows that were
//                   already here — a vending machine was always going to hum.
//   light: true|n — Phase 11: a person walking into this shoves it. `true` is
//                   the ordinary case; a number 0..1 says this one is heavier
//                   than that (a lounge chair slides half as far as a stool).
//                   Only meaningful on a floor-standing row tall enough to be
//                   an obstacle at all — a floor cushion is light and is also
//                   something you walk straight over, so it isn't flagged.
//                   shove.js reads it; nothing is stored, so a shoved chair is
//                   back where it was drawn the moment the walk ends.
//   absorb: n     — Phase 4: this row's sound absorption coefficient, 0..1,
//                   overriding the per-category default in acoustics.js. Only
//                   worth stating on the rows where the category lies: soft
//                   furniture in a hard category, or a product whose entire
//                   purpose is absorption.
// plus builder parameters (`top`, `style`, `device`, `rows`, ...) documented
// beside each geometry builder in render.js.

export const CATEGORIES = [
  'Tables & Desks', 'Seating', 'Storage', 'Fixtures', 'Lighting',
  'Subject Rooms', 'Cafeteria', 'Gym & Stage', 'Library & Office', 'Restroom',
  'Decor', 'Outdoor', 'Landscape',
  // Phase 9. Not a table of rows — the category an imported glTF file lands
  // in, kept last so the palette reads as "everything this build ships, then
  // everything you brought".
  'Imported',
];

// Every geometry key a catalog row may name. render.js's builder table must
// cover each of these; catalog.test.mjs holds rows to this list so a typo'd
// `geo` fails a test instead of silently falling back to a desk.
export const GEO_KEYS = [
  'desk', 'chair', 'cabinet', 'shelf', 'cubby', 'lamp', 'panel', 'rug',
  'bin', 'sink',
  'table', 'workstation', 'carrel', 'podium', 'labbench',
  'stool', 'bench', 'softseat', 'audseat',
  'locker', 'coatrack', 'cart', 'stack', 'hookrail',
  'clock', 'pulldown', 'projector', 'displaycase', 'fountain', 'wallbox',
  'flagwall', 'radiator',
  'piano', 'musicstand', 'riser', 'easel', 'dryrack', 'kiln', 'wheel',
  'fumehood', 'eyewash', 'skeleton', 'globe',
  'machine', 'counter', 'recycle',
  'hoop', 'volleyball', 'ballrack',
  'toiletstall', 'urinal', 'sinkcounter',
  'plant', 'aquarium', 'cage', 'clutter',
  // Phase 11: the decor packs. Three builders, because the fourth through
  // twentieth things a season needs are these three (and `tree`, and `panel`,
  // and `plant`) in a different colour.
  'garland', 'wreath', 'gourd',
  'picnic', 'bikerack', 'flagpole', 'slide', 'swing', 'dumpster', 'polesign',
  'goal', 'backstop', 'fence', 'shelter', 'pergola', 'sandbox', 'climber',
  'tetherball', 'bollard',
  'tree', 'hedge', 'shrub', 'planter', 'boulder',
  'troffer', 'pendant', 'sconce', 'polelight',
  'gongbell', 'diffuser',
  // Phase 9: not a builder at all. A row with `geo: 'model'` carries a glTF
  // file instead (see models.js), and render.js reads its geometry out of the
  // library rather than out of PROP_GEO_BUILDERS.
  'model',
];

export const PROP_CATALOG = [
  // ---- Tables & Desks ----
  { type: 'student-desk', name: 'Student Desk', category: 'Tables & Desks', icon: '🪑', w: 2, d: 1.5, h: 2.5, y: 0, color: '#c9a06a', mount: 'floor', geo: 'desk' },
  { type: 'desk-double', name: 'Double Student Desk', category: 'Tables & Desks', icon: '👥', w: 5, d: 2, h: 2.5, y: 0, color: '#c9a06a', mount: 'floor', geo: 'desk' },
  { type: 'teacher-desk', name: 'Teacher Desk', category: 'Tables & Desks', icon: '🗄️', w: 5, d: 2.5, h: 2.5, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'desk' },
  { type: 'desk-standing', name: 'Standing Desk', category: 'Tables & Desks', icon: '🧍', w: 4, d: 2, h: 3.6, y: 0, color: '#9c7248', mount: 'floor', geo: 'desk' },
  { type: 'desk-computer', name: 'Computer Workstation', category: 'Tables & Desks', icon: '🖥️', w: 4, d: 2.5, h: 2.5, y: 0, color: '#b08a5f', mount: 'floor', geo: 'workstation', device: 'monitor' },
  { type: 'carrel', name: 'Study Carrel', category: 'Tables & Desks', icon: '📖', w: 3, d: 2, h: 4, y: 0, color: '#a9825a', mount: 'floor', geo: 'carrel' },
  { type: 'table-seminar-6', name: 'Seminar Table 6ft', category: 'Tables & Desks', icon: '▭', w: 6, d: 2.5, h: 2.4, y: 0, color: '#b08a5f', mount: 'floor', geo: 'table' },
  { type: 'table-seminar-8', name: 'Seminar Table 8ft', category: 'Tables & Desks', icon: '▬', w: 8, d: 3, h: 2.4, y: 0, color: '#b08a5f', mount: 'floor', geo: 'table' },
  { type: 'table-round-4', name: 'Round Table 4ft', category: 'Tables & Desks', icon: '⚪', w: 4, d: 4, h: 2.4, y: 0, color: '#b08a5f', mount: 'floor', geo: 'table', top: 'round' },
  { type: 'table-round-5', name: 'Round Table 5ft', category: 'Tables & Desks', icon: '🔵', w: 5, d: 5, h: 2.4, y: 0, color: '#b08a5f', mount: 'floor', geo: 'table', top: 'round' },
  { type: 'table-trapezoid', name: 'Trapezoid Table', category: 'Tables & Desks', icon: '⬠', w: 5, d: 2.5, h: 2.4, y: 0, color: '#caa26b', mount: 'floor', geo: 'table', top: 'trapezoid' },
  { type: 'table-kidney', name: 'Kidney Table', category: 'Tables & Desks', icon: '🫘', w: 6, d: 4, h: 2.2, y: 0, color: '#caa26b', mount: 'floor', geo: 'table', top: 'kidney' },
  { type: 'table-art', name: 'Art Table', category: 'Tables & Desks', icon: '🎨', w: 5, d: 3, h: 2.9, y: 0, color: '#8f8a80', mount: 'floor', geo: 'table' },
  { type: 'table-cafeteria', name: 'Folding Cafeteria Table', category: 'Tables & Desks', icon: '🍽️', w: 12, d: 2.5, h: 2.4, y: 0, color: '#d8d3c8', mount: 'floor', geo: 'table', base: 'folding' },
  { type: 'podium', name: 'Lectern', category: 'Tables & Desks', icon: '🎤', w: 2, d: 1.5, h: 4, y: 0, color: '#7a5230', mount: 'floor', geo: 'podium' },

  // ---- Seating ----
  { type: 'student-chair', name: 'Student Chair', category: 'Seating', icon: '💺', w: 1.4, d: 1.5, h: 2.7, y: 0, color: '#3f6fae', mount: 'floor', geo: 'chair', light: true },
  { type: 'chair-stack', name: 'Stackable Chair', category: 'Seating', icon: '🪑', w: 1.6, d: 1.6, h: 2.7, y: 0, color: '#7a3f3f', mount: 'floor', geo: 'chair', style: 'stack', light: true },
  { type: 'teacher-chair', name: 'Teacher Chair', category: 'Seating', icon: '🧑‍🏫', w: 2, d: 2, h: 3.3, y: 0, color: '#2c2c34', mount: 'floor', geo: 'chair', style: 'task', light: 0.8 },
  { type: 'chair-task', name: 'Rolling Task Chair', category: 'Seating', icon: '🌀', w: 2, d: 2, h: 3, y: 0, color: '#37474f', mount: 'floor', geo: 'chair', style: 'task', light: true },
  { type: 'chair-rocking', name: 'Rocking Chair', category: 'Seating', icon: '🧶', w: 2, d: 2.5, h: 3.3, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'chair', style: 'rocker', light: 0.8 },
  { type: 'stool-lab-24', name: 'Lab Stool 24in', category: 'Seating', icon: '🥼', w: 1.2, d: 1.2, h: 2, y: 0, color: '#31363c', mount: 'floor', geo: 'stool', light: true },
  { type: 'stool-lab-30', name: 'Lab Stool 30in', category: 'Seating', icon: '🧫', w: 1.2, d: 1.2, h: 2.5, y: 0, color: '#31363c', mount: 'floor', geo: 'stool', light: true },
  { type: 'bench-hall', name: 'Hallway Bench', category: 'Seating', icon: '🛋️', w: 6, d: 1.25, h: 1.5, y: 0, color: '#9c7248', mount: 'floor', geo: 'bench' },
  { type: 'seat-auditorium', name: 'Auditorium Seat', category: 'Seating', icon: '🎟️', w: 1.8, d: 2, h: 3.2, y: 0, color: '#7c2f3e', mount: 'floor', geo: 'audseat' },
  { type: 'chair-lounge', name: 'Lounge Chair', category: 'Seating', icon: '🧘', w: 2.8, d: 2.8, h: 2.6, y: 0, color: '#4f6f52', mount: 'floor', geo: 'softseat', kind: 'lounge', light: 0.5 },
  { type: 'sofa', name: 'Sofa', category: 'Seating', icon: '🛋', w: 6, d: 2.8, h: 2.7, y: 0, color: '#54617a', mount: 'floor', geo: 'softseat', kind: 'sofa' },
  { type: 'beanbag', name: 'Bean Bag', category: 'Seating', icon: '🫧', w: 2.5, d: 2.5, h: 1.3, y: 0, color: '#b0503f', mount: 'floor', geo: 'softseat', kind: 'beanbag', light: true },
  { type: 'cushion', name: 'Floor Cushion', category: 'Seating', icon: '🔶', w: 1.8, d: 1.8, h: 0.4, y: 0, color: '#c99a3f', mount: 'floor', geo: 'softseat', kind: 'cushion' },

  // ---- Storage ----
  { type: 'file-cabinet', name: 'File Cabinet', category: 'Storage', icon: '🗃️', w: 1.25, d: 2, h: 4.3, y: 0, color: '#6b7280', mount: 'floor', geo: 'cabinet' },
  { type: 'cabinet-supply', name: 'Supply Cabinet', category: 'Storage', icon: '🚪', w: 3, d: 1.5, h: 6, y: 0, color: '#6f7a72', mount: 'floor', geo: 'cabinet', front: 'doors' },
  { type: 'bookshelf-full', name: 'Bookshelf (Full)', category: 'Storage', icon: '📚', w: 3, d: 1, h: 6, y: 0, color: '#7a5230', mount: 'floor', geo: 'shelf' },
  { type: 'bookshelf-low', name: 'Bookshelf (Low)', category: 'Storage', icon: '📗', w: 3, d: 1, h: 3, y: 0, color: '#7a5230', mount: 'floor', geo: 'shelf' },
  { type: 'cubby-unit', name: 'Cubby Unit', category: 'Storage', icon: '🗂️', w: 4, d: 1.25, h: 3.5, y: 0, color: '#c17a4f', mount: 'floor', geo: 'cubby' },
  { type: 'tote-rack', name: 'Tote Bin Rack', category: 'Storage', icon: '🧺', w: 3, d: 1.3, h: 3, y: 0, color: '#8a8f96', mount: 'floor', geo: 'cubby', bins: true },
  { type: 'locker-bank', name: 'Locker Bank (Tall)', category: 'Storage', icon: '🔒', w: 6, d: 1.25, h: 6, y: 0, color: '#3f6fae', mount: 'floor', geo: 'locker', doors: 6 },
  { type: 'locker-bank-half', name: 'Locker Bank (Half)', category: 'Storage', icon: '🔐', w: 6, d: 1.25, h: 6, y: 0, color: '#a24a3f', mount: 'floor', geo: 'locker', doors: 6, tiers: 2 },
  { type: 'coat-rack', name: 'Coat Rack', category: 'Storage', icon: '🧥', w: 4, d: 1.5, h: 5.5, y: 0, color: '#7a6248', mount: 'floor', geo: 'coatrack' },
  { type: 'book-cart', name: 'Book Cart', category: 'Storage', icon: '🛒', w: 3, d: 1.5, h: 3.5, y: 0, color: '#606a75', mount: 'floor', geo: 'cart', light: true },
  { type: 'hook-rail', name: 'Backpack Rail', category: 'Storage', icon: '🪝', w: 4, d: 0.3, h: 0.5, y: 3.5, color: '#8a6a48', mount: 'wall', geo: 'hookrail' },

  // ---- Fixtures ----
  { type: 'floor-lamp', name: 'Floor Lamp', category: 'Fixtures', icon: '💡', w: 1, d: 1, h: 5.5, y: 0, color: '#d8cba0', mount: 'floor', geo: 'lamp', emit: { lm: 1200, color: '#ffe3b4', range: 18, dy: 5 } },
  { type: 'tv', name: 'TV / Smart Board', category: 'Fixtures', icon: '📺', w: 5.5, d: 0.3, h: 2.7, y: 3.4, color: '#15161a', mount: 'wall', geo: 'panel' },
  { type: 'whiteboard', name: 'Whiteboard', category: 'Fixtures', icon: '🖊️', w: 6, d: 0.15, h: 4, y: 2.8, color: '#f4f4f2', mount: 'wall', geo: 'panel', absorb: 0.02 },
  { type: 'board-cork', name: 'Bulletin Board', category: 'Fixtures', icon: '📌', w: 6, d: 0.1, h: 4, y: 3.5, color: '#a9805a', mount: 'wall', geo: 'panel', absorb: 0.30 },
  { type: 'clock-wall', name: 'Wall Clock', category: 'Fixtures', icon: '🕐', w: 1.2, d: 0.15, h: 1.2, y: 7, color: '#e8e6df', mount: 'wall', geo: 'clock', sound: { kind: 'tick', db: 38, hz: 2600, q: 6, every: 1 } },
  { type: 'screen-pulldown', name: 'Projection Screen', category: 'Fixtures', icon: '🎬', w: 7, d: 0.3, h: 5.5, y: 2.5, color: '#efefec', mount: 'wall', geo: 'pulldown' },
  { type: 'projector-ceiling', name: 'Ceiling Projector', category: 'Fixtures', icon: '📽️', w: 1.5, d: 1.2, h: 2, y: 8, color: '#d9d9d4', mount: 'ceiling', geo: 'projector' },
  { type: 'case-display', name: 'Display Case', category: 'Fixtures', icon: '🏆', w: 6, d: 1.5, h: 6.5, y: 0, color: '#6a5636', mount: 'floor', geo: 'displaycase' },
  { type: 'fountain', name: 'Water Fountain', category: 'Fixtures', icon: '⛲', w: 1.5, d: 1.3, h: 3.3, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'fountain', sound: { kind: 'hum', db: 52, hz: 110, q: 5, dy: 1 } },
  { type: 'cabinet-fire', name: 'Fire Extinguisher Cabinet', category: 'Fixtures', icon: '🧯', w: 1, d: 0.6, h: 2.3, y: 3, color: '#b03a30', mount: 'wall', geo: 'wallbox', style: 'fire' },
  { type: 'cabinet-aed', name: 'AED Cabinet', category: 'Fixtures', icon: '🫀', w: 1.2, d: 0.6, h: 1.5, y: 4, color: '#e6e8ea', mount: 'wall', geo: 'wallbox', style: 'aed' },
  { type: 'sign-exit', name: 'Exit Sign', category: 'Fixtures', icon: '🏃', w: 1, d: 0.2, h: 0.7, y: 7.5, color: '#2e8b46', mount: 'wall', geo: 'panel', emit: { lm: 90, color: '#8dffb0', range: 9, dy: 0.35 } },
  { type: 'speaker-pa', name: 'PA Speaker', category: 'Fixtures', icon: '🔊', w: 1, d: 0.8, h: 1, y: 8, color: '#3a3f45', mount: 'wall', geo: 'wallbox', style: 'grille', sound: { kind: 'pa', db: 88, hz: 1200, q: 1 } },
  { type: 'flag-wall', name: 'Flag on Bracket', category: 'Fixtures', icon: '🚩', w: 1, d: 2.5, h: 3, y: 6, color: '#8a2f3a', mount: 'wall', geo: 'flagwall' },
  { type: 'radiator', name: 'Radiator', category: 'Fixtures', icon: '♨️', w: 4, d: 0.8, h: 2, y: 0, color: '#c9c4b8', mount: 'floor', geo: 'radiator', sound: { kind: 'hiss', db: 42, hz: 520, q: 1.2, dy: 1 } },
  { type: 'dispenser', name: 'Towel Dispenser', category: 'Fixtures', icon: '🧻', w: 1, d: 0.5, h: 1.2, y: 4, color: '#d7dadd', mount: 'wall', geo: 'wallbox' },
  { type: 'trash-can', name: 'Trash Can', category: 'Fixtures', icon: '🗑️', w: 1.2, d: 1.2, h: 2, y: 0, color: '#4a4f57', mount: 'floor', geo: 'bin', light: true },
  { type: 'sink', name: 'Classroom Sink', category: 'Fixtures', icon: '🚰', w: 2, d: 1.8, h: 3, y: 0, color: '#dfe3e6', mount: 'floor', geo: 'sink' },

  // Phase 4. Three rows the building needed before it could make a noise, and
  // one it needed before it could stop making one.
  { type: 'bell-corridor', name: 'Corridor Bell', category: 'Fixtures', icon: '🔔', w: 0.9, d: 0.7, h: 0.9, y: 8.4, color: '#8a2f2f', mount: 'wall', geo: 'gongbell', sound: { kind: 'bell', db: 100, hz: 660, q: 1 } },
  { type: 'diffuser-hvac', name: 'HVAC Diffuser', category: 'Fixtures', icon: '🌬️', w: 2, d: 2, h: 0.4, y: 9.6, color: '#dfe1e3', mount: 'ceiling', geo: 'diffuser', sound: { kind: 'hiss', db: 38, hz: 700, q: 0.9, dy: -0.2 } },
  { type: 'speaker-ceiling', name: 'Ceiling Speaker', category: 'Fixtures', icon: '📢', w: 1.1, d: 1.1, h: 0.35, y: 9.65, color: '#e4e6e8', mount: 'ceiling', geo: 'diffuser', style: 'speaker', sound: { kind: 'pa', db: 84, hz: 1200, q: 1 } },
  { type: 'panel-acoustic', name: 'Acoustic Wall Panel', category: 'Fixtures', icon: '🧱', w: 4, d: 0.25, h: 4, y: 3, color: '#6f7a86', mount: 'wall', geo: 'panel', absorb: 0.85 },
  { type: 'baffle-acoustic', name: 'Acoustic Ceiling Baffle', category: 'Fixtures', icon: '☁️', w: 8, d: 1, h: 0.3, y: 9, color: '#7c8794', mount: 'ceiling', geo: 'panel', absorb: 0.90 },

  // ---- Lighting ----
  //
  // Phase 3's emitters. Ceiling mounts are dimensioned so the housing's top
  // lands on the 10ft ceiling plane (`y` is the bottom of the piece, `h` its
  // depth), and every `lm` is a real product figure: a 2x4 LED troffer runs
  // about 4,000lm, a corridor pendant 1,600, a gym high bay 20,000, a
  // parking-lot pole 12,000.
  { type: 'troffer-2x4', name: 'Troffer 2×4', category: 'Lighting', icon: '🔆', w: 4, d: 2, h: 0.5, y: 9.5, color: '#e8e9ea', mount: 'ceiling', geo: 'troffer', emit: { lm: 4000, color: '#fff4e2', range: 26, dy: -0.2 } },
  { type: 'troffer-2x2', name: 'Troffer 2×2', category: 'Lighting', icon: '🔅', w: 2, d: 2, h: 0.5, y: 9.5, color: '#e8e9ea', mount: 'ceiling', geo: 'troffer', emit: { lm: 2400, color: '#fff4e2', range: 22, dy: -0.2 } },
  { type: 'light-strip', name: 'Strip Light', category: 'Lighting', icon: '➖', w: 4, d: 0.6, h: 0.45, y: 9.55, color: '#d9dbdd', mount: 'ceiling', geo: 'troffer', style: 'strip', emit: { lm: 3000, color: '#fdf6e6', range: 24, dy: -0.2 } },
  { type: 'light-track', name: 'Track Lighting', category: 'Lighting', icon: '🎯', w: 6, d: 0.5, h: 1.1, y: 8.9, color: '#3a3f45', mount: 'ceiling', geo: 'troffer', style: 'track', heads: 4, emit: { lm: 3200, color: '#ffeccb', range: 20, dy: -0.7, kind: 'spot', angle: 55, penumbra: 0.5 } },
  { type: 'pendant-dome', name: 'Pendant Light', category: 'Lighting', icon: '🏮', w: 1.8, d: 1.8, h: 3, y: 7, color: '#d8cba0', mount: 'ceiling', geo: 'pendant', emit: { lm: 1600, color: '#ffe6bd', range: 20, dy: 0.5 } },
  { type: 'light-highbay', name: 'Gym High Bay', category: 'Lighting', icon: '🛸', w: 2.2, d: 2.2, h: 2.2, y: 7.8, color: '#b9bfc6', mount: 'ceiling', geo: 'pendant', style: 'highbay', emit: { lm: 20000, color: '#fbfaf4', range: 70, dy: 0.4, kind: 'spot', angle: 75, penumbra: 0.35 } },
  { type: 'sconce-wall', name: 'Wall Sconce', category: 'Lighting', icon: '🕯️', w: 1, d: 0.7, h: 1.4, y: 6, color: '#c8ccd2', mount: 'wall', geo: 'sconce', emit: { lm: 800, color: '#ffe2b6', range: 16, dy: 0.7 } },
  { type: 'light-wallpack', name: 'Exterior Wall Pack', category: 'Lighting', icon: '🔦', w: 1.4, d: 1, h: 1.2, y: 8.6, color: '#4a4f57', mount: 'wall', geo: 'sconce', style: 'pack', site: true, emit: { lm: 6000, color: '#fdf3dd', range: 40, dy: -0.2, kind: 'spot', angle: 80, penumbra: 0.5 } },
  { type: 'light-pole', name: 'Parking Lot Light', category: 'Lighting', icon: '🛣️', w: 2, d: 2, h: 22, y: 0, color: '#5a6068', mount: 'floor', geo: 'polelight', site: true, emit: { lm: 12000, color: '#f6f2e4', range: 90, dy: 21, kind: 'spot', angle: 72, penumbra: 0.4 } },
  { type: 'light-bollard', name: 'Path Bollard', category: 'Lighting', icon: '📍', w: 0.8, d: 0.8, h: 3.5, y: 0, color: '#5a6068', mount: 'floor', geo: 'polelight', style: 'bollard', site: true, emit: { lm: 900, color: '#ffeecd', range: 16, dy: 3.1 } },
  { type: 'lamp-desk', name: 'Desk Lamp', category: 'Lighting', icon: '🪔', w: 0.9, d: 0.9, h: 1.6, y: 2.5, color: '#c9a06a', mount: 'floor', geo: 'lamp', surface: true, emit: { lm: 450, color: '#ffe0aa', range: 9, dy: 1.4 } },

  // ---- Subject Rooms ----
  { type: 'piano-upright', name: 'Upright Piano', category: 'Subject Rooms', icon: '🎹', w: 5, d: 2, h: 4, y: 0, color: '#241f1d', mount: 'floor', geo: 'piano' },
  { type: 'music-stand', name: 'Music Stand', category: 'Subject Rooms', icon: '🎼', w: 1.5, d: 1.5, h: 4, y: 0, color: '#2c2c34', mount: 'floor', geo: 'musicstand', light: true },
  { type: 'riser-choir', name: 'Choir Riser', category: 'Subject Rooms', icon: '🎶', w: 6, d: 3, h: 1.3, y: 0, color: '#7a6248', mount: 'floor', geo: 'riser', rows: 3 },
  { type: 'easel-art', name: 'Art Easel', category: 'Subject Rooms', icon: '🖼️', w: 2, d: 2, h: 5.5, y: 0, color: '#a9825a', mount: 'floor', geo: 'easel', light: 0.6 },
  { type: 'rack-drying', name: 'Drying Rack', category: 'Subject Rooms', icon: '🖌️', w: 2.5, d: 1.5, h: 4, y: 0, color: '#8a8f96', mount: 'floor', geo: 'dryrack' },
  { type: 'kiln', name: 'Kiln', category: 'Subject Rooms', icon: '🔥', w: 2.5, d: 2.5, h: 3, y: 0, color: '#8f8a80', mount: 'floor', geo: 'kiln' },
  { type: 'pottery-wheel', name: 'Pottery Wheel', category: 'Subject Rooms', icon: '🏺', w: 2.5, d: 2, h: 1.8, y: 0, color: '#5f6a72', mount: 'floor', geo: 'wheel' },
  { type: 'bench-lab', name: 'Lab Bench', category: 'Subject Rooms', icon: '🧪', w: 6, d: 2.5, h: 3, y: 0, color: '#20242a', mount: 'floor', geo: 'labbench' },
  { type: 'table-demo', name: 'Demo Table', category: 'Subject Rooms', icon: '🔬', w: 8, d: 2.5, h: 3, y: 0, color: '#20242a', mount: 'floor', geo: 'labbench' },
  { type: 'bench-robotics', name: 'Robotics Workbench', category: 'Subject Rooms', icon: '🤖', w: 6, d: 2.5, h: 3, y: 0, color: '#9c7248', mount: 'floor', geo: 'labbench', pegboard: true },
  { type: 'fume-hood', name: 'Fume Hood', category: 'Subject Rooms', icon: '🌫️', w: 4, d: 2.5, h: 8, y: 0, color: '#cfd4d9', mount: 'floor', geo: 'fumehood' },
  { type: 'eyewash', name: 'Eyewash Station', category: 'Subject Rooms', icon: '🚿', w: 1.2, d: 1.2, h: 3.6, y: 0, color: '#3f9e4f', mount: 'floor', geo: 'eyewash' },
  { type: 'skeleton', name: 'Anatomy Skeleton', category: 'Subject Rooms', icon: '💀', w: 1.5, d: 1.5, h: 5.8, y: 0, color: '#e3ded2', mount: 'floor', geo: 'skeleton' },
  { type: 'globe', name: 'Globe', category: 'Subject Rooms', icon: '🌍', w: 1.5, d: 1.5, h: 3, y: 0, color: '#3a6fae', mount: 'floor', geo: 'globe', light: 0.7 },
  { type: 'printer-3d', name: '3D Printer Bench', category: 'Subject Rooms', icon: '🖨️', w: 2, d: 2, h: 4, y: 0, color: '#5a6068', mount: 'floor', geo: 'workstation', device: 'printer' },
  { type: 'table-sewing', name: 'Sewing Table', category: 'Subject Rooms', icon: '🧵', w: 4, d: 2, h: 2.5, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'workstation', device: 'sewing' },

  // ---- Cafeteria ----
  { type: 'counter-serving', name: 'Serving Counter', category: 'Cafeteria', icon: '🍲', w: 6, d: 2.5, h: 3, y: 0, color: '#aab2ba', mount: 'floor', geo: 'counter', guard: true },
  { type: 'tray-return', name: 'Tray Return', category: 'Cafeteria', icon: '🍽', w: 4, d: 2, h: 4, y: 0, color: '#aab2ba', mount: 'floor', geo: 'counter', style: 'tray' },
  { type: 'cooler-milk', name: 'Milk Cooler', category: 'Cafeteria', icon: '🥛', w: 3, d: 2.5, h: 3, y: 0, color: '#d7dadd', mount: 'floor', geo: 'machine', style: 'cooler', sound: { kind: 'hum', db: 54, hz: 120, q: 7, dy: 1 } },
  { type: 'vending', name: 'Vending Machine', category: 'Cafeteria', icon: '🥤', w: 3.3, d: 2.8, h: 6, y: 0, color: '#a23a45', mount: 'floor', geo: 'machine', style: 'vending', sound: { kind: 'hum', db: 55, hz: 120, q: 8, dy: 2 } },
  { type: 'fridge-commercial', name: 'Commercial Fridge', category: 'Cafeteria', icon: '❄️', w: 4.5, d: 2.7, h: 6.8, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'machine', style: 'fridge', sound: { kind: 'hum', db: 58, hz: 120, q: 7, dy: 2 } },
  { type: 'table-prep', name: 'Prep Table', category: 'Cafeteria', icon: '🔪', w: 6, d: 2.5, h: 3, y: 0, color: '#c2c7cd', mount: 'floor', geo: 'table' },
  { type: 'station-recycle', name: 'Recycling Station', category: 'Cafeteria', icon: '♻️', w: 4, d: 2, h: 3.5, y: 0, color: '#5a6a5f', mount: 'floor', geo: 'recycle', light: 0.45 },

  // ---- Gym & Stage ----
  { type: 'hoop-wall', name: 'Basketball Hoop (Wall)', category: 'Gym & Stage', icon: '🏀', w: 6, d: 4, h: 3.5, y: 9, color: '#e8e6df', mount: 'wall', geo: 'hoop', tall: true },
  { type: 'bleacher', name: 'Bleacher Section', category: 'Gym & Stage', icon: '🏟️', w: 8, d: 7, h: 5.5, y: 0, color: '#9c7248', mount: 'floor', geo: 'riser', rows: 3, seats: true },
  { type: 'volleyball-net', name: 'Volleyball Net', category: 'Gym & Stage', icon: '🏐', w: 30, d: 1, h: 8, y: 0, color: '#3a3f45', mount: 'floor', geo: 'volleyball' },
  { type: 'mat-wall', name: 'Wall Mat', category: 'Gym & Stage', icon: '🥋', w: 6, d: 0.3, h: 6, y: 0.2, color: '#3f5fae', mount: 'wall', geo: 'panel', absorb: 0.35 },
  { type: 'rack-ball', name: 'Ball Rack', category: 'Gym & Stage', icon: '⚽', w: 4, d: 2, h: 3, y: 0, color: '#5a6068', mount: 'floor', geo: 'ballrack' },
  { type: 'scoreboard', name: 'Scoreboard', category: 'Gym & Stage', icon: '🔢', w: 6, d: 0.5, h: 3, y: 6, color: '#22262c', mount: 'wall', geo: 'panel' },
  { type: 'stage-section', name: 'Stage Platform', category: 'Gym & Stage', icon: '🎭', w: 8, d: 4, h: 2, y: 0, color: '#4a3a2e', mount: 'floor', geo: 'riser', rows: 1 },

  // ---- Library & Office ----
  { type: 'library-stack', name: 'Library Stack', category: 'Library & Office', icon: '🏛️', w: 3, d: 2, h: 5.5, y: 0, color: '#6a5636', mount: 'floor', geo: 'stack' },
  { type: 'rack-display', name: 'Book Display Rack', category: 'Library & Office', icon: '📰', w: 2.5, d: 1.5, h: 5, y: 0, color: '#7a5230', mount: 'floor', geo: 'shelf' },
  { type: 'desk-circulation', name: 'Circulation Desk', category: 'Library & Office', icon: '📇', w: 6, d: 2.5, h: 3.2, y: 0, color: '#8a6a48', mount: 'floor', geo: 'counter' },
  { type: 'counter-reception', name: 'Reception Counter', category: 'Library & Office', icon: '🛎️', w: 6, d: 2.5, h: 3.5, y: 0, color: '#8a6a48', mount: 'floor', geo: 'counter', tier: 2 },
  { type: 'copier', name: 'Copier', category: 'Library & Office', icon: '📠', w: 2, d: 2.3, h: 3.8, y: 0, color: '#d7dadd', mount: 'floor', geo: 'machine', style: 'copier' },
  { type: 'mail-cubbies', name: 'Staff Mail Cubbies', category: 'Library & Office', icon: '📬', w: 3, d: 1, h: 3, y: 0, color: '#a9825a', mount: 'floor', geo: 'cubby' },

  // ---- Restroom ----
  { type: 'toilet-stall', name: 'Toilet + Stall', category: 'Restroom', icon: '🚽', w: 3, d: 5, h: 5, y: 0, color: '#b9bfc6', mount: 'floor', geo: 'toiletstall' },
  { type: 'urinal', name: 'Urinal', category: 'Restroom', icon: '🚹', w: 1.5, d: 1.2, h: 2, y: 1.3, color: '#e6e8ea', mount: 'wall', geo: 'urinal' },
  { type: 'counter-sink', name: 'Sink Counter', category: 'Restroom', icon: '🧼', w: 5, d: 1.8, h: 2.8, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'sinkcounter' },
  { type: 'mirror', name: 'Mirror', category: 'Restroom', icon: '🪞', w: 4, d: 0.05, h: 3, y: 3.5, color: '#b8ccd4', mount: 'wall', geo: 'panel' },
  { type: 'hand-dryer', name: 'Hand Dryer', category: 'Restroom', icon: '💨', w: 1, d: 0.7, h: 1.2, y: 3.5, color: '#c8ccd2', mount: 'wall', geo: 'wallbox' },

  // ---- Decor ----
  { type: 'rug', name: 'Rug', category: 'Decor', icon: '▦', w: 6, d: 4, h: 0.08, y: 0, color: '#b0503f', mount: 'floor', geo: 'rug', absorb: 0.28 },
  { type: 'plant-floor', name: 'Potted Plant', category: 'Decor', icon: '🪴', w: 1.5, d: 1.5, h: 4, y: 0, color: '#3f7a48', mount: 'floor', geo: 'plant', light: 0.5 },
  { type: 'plant-desk', name: 'Desk Plant', category: 'Decor', icon: '🌱', w: 0.6, d: 0.6, h: 0.9, y: 2.5, color: '#3f7a48', mount: 'floor', geo: 'plant', surface: true },
  { type: 'aquarium', name: 'Aquarium', category: 'Decor', icon: '🐠', w: 3, d: 1.3, h: 4, y: 0, color: '#3a6a8a', mount: 'floor', geo: 'aquarium', sound: { kind: 'burble', db: 44, hz: 900, q: 2, dy: 3 } },
  { type: 'pet-cage', name: 'Class Pet Cage', category: 'Decor', icon: '🐹', w: 2.5, d: 1.5, h: 3, y: 0, color: '#8a8f96', mount: 'floor', geo: 'cage' },
  { type: 'poster', name: 'Poster', category: 'Decor', icon: '📃', w: 2, d: 0.05, h: 3, y: 4, color: '#3f6fae', mount: 'wall', geo: 'panel' },
  { type: 'desk-clutter', name: 'Desk Clutter', category: 'Decor', icon: '📝', w: 1.5, d: 1, h: 0.5, y: 2.5, color: '#b0503f', mount: 'floor', geo: 'clutter', surface: true },
  { type: 'hooks-coats', name: 'Coats on Hooks', category: 'Decor', icon: '🎒', w: 4, d: 0.4, h: 2.5, y: 3, color: '#7a6248', mount: 'wall', geo: 'hookrail', hung: true },
  { type: 'blinds', name: 'Window Blinds', category: 'Decor', icon: '🪟', w: 4, d: 0.2, h: 5, y: 3.5, color: '#d8d3c8', mount: 'wall', geo: 'pulldown', sheet: 0.6 },

  // ---- Decor: the seasonal kit (Phase 11) ----
  //
  // Nine rows, no season named on any of them. `decor.js` holds the packs,
  // and a pack is a palette over exactly these: the same garland is October
  // orange or December evergreen depending on the paint the prop carries, and
  // the paint is `data.color`, which the whole of this phase's first item
  // exists to make real. Shipping "Halloween Garland" and "Christmas Garland"
  // and "Spring Garland" as three rows would have been the other way to do it,
  // and would have been thirty rows by the fourth pack.
  { type: 'garland', name: 'Garland', category: 'Decor', icon: '🎄', w: 8, d: 0.5, h: 1.6, y: 8.3, color: '#2f6b3a', mount: 'wall', geo: 'garland', trim: '#c0392b' },
  { type: 'bunting', name: 'Pennant Bunting', category: 'Decor', icon: '🎏', w: 10, d: 0.4, h: 1.8, y: 8.1, color: '#3f6fae', mount: 'wall', geo: 'garland', style: 'pennant', trim: '#f2ece0' },
  { type: 'streamers', name: 'Crepe Streamers', category: 'Decor', icon: '🎀', w: 9, d: 0.4, h: 2.2, y: 7.7, color: '#c9508a', mount: 'wall', geo: 'garland', style: 'streamer' },
  { type: 'string-lights', name: 'String Lights', category: 'Decor', icon: '💡', w: 10, d: 0.4, h: 1.2, y: 8.7, color: '#3a4048', mount: 'wall', geo: 'garland', emit: { lm: 110, color: '#ffd9a0', range: 11, dy: 0.6 } },
  { type: 'wreath', name: 'Wreath', category: 'Decor', icon: '🎍', w: 2.4, d: 0.5, h: 2.4, y: 4.5, color: '#2f6b3a', mount: 'wall', geo: 'wreath', trim: '#c0392b' },
  { type: 'cutout', name: 'Paper Cutout', category: 'Decor', icon: '❄️', w: 1.6, d: 0.04, h: 1.6, y: 5, color: '#eef3f7', mount: 'wall', geo: 'panel' },
  { type: 'banner', name: 'Banner', category: 'Decor', icon: '🚩', w: 8, d: 0.06, h: 2.5, y: 7, color: '#c0392b', mount: 'wall', geo: 'panel' },
  { type: 'pumpkin', name: 'Pumpkin', category: 'Decor', icon: '🎃', w: 1.4, d: 1.4, h: 1.1, y: 0, color: '#d2691e', mount: 'floor', geo: 'gourd', light: true },
  { type: 'gourd', name: 'Gourd', category: 'Decor', icon: '🍐', w: 0.8, d: 0.8, h: 1, y: 2.5, color: '#c8a13a', mount: 'floor', geo: 'gourd', style: 'gourd', surface: true },
  { type: 'tree-festive', name: 'Festive Tree', category: 'Decor', icon: '🌲', w: 4, d: 4, h: 7.5, y: 0, color: '#2f6b3a', mount: 'floor', geo: 'tree', style: 'conifer', trim: '#e5b33a' },

  // ---- Outdoor ----
  { type: 'picnic-table', name: 'Picnic Table', category: 'Outdoor', icon: '🧺', w: 6, d: 6, h: 2.5, y: 0, color: '#8a6a48', mount: 'floor', geo: 'picnic', site: true },
  { type: 'bench-outdoor', name: 'Outdoor Bench', category: 'Outdoor', icon: '🌳', w: 6, d: 2, h: 2.8, y: 0, color: '#5a6a5f', mount: 'floor', geo: 'bench', back: true, site: true },
  { type: 'bike-rack', name: 'Bike Rack', category: 'Outdoor', icon: '🚲', w: 6, d: 2.5, h: 2.5, y: 0, color: '#8a8f96', mount: 'floor', geo: 'bikerack', site: true },
  { type: 'flagpole', name: 'Flagpole', category: 'Outdoor', icon: '🏳️', w: 1, d: 1, h: 25, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'flagpole', site: true },
  { type: 'slide', name: 'Playground Slide', category: 'Outdoor', icon: '🛝', w: 8, d: 3, h: 6, y: 0, color: '#c9563f', mount: 'floor', geo: 'slide', site: true },
  { type: 'swing-set', name: 'Swing Set', category: 'Outdoor', icon: '🤸', w: 10, d: 6, h: 8, y: 0, color: '#3f6fae', mount: 'floor', geo: 'swing', site: true },
  { type: 'hoop-pole', name: 'Basketball Hoop (Pole)', category: 'Outdoor', icon: '⛹️', w: 4, d: 4, h: 12, y: 0, color: '#5a6068', mount: 'floor', geo: 'hoop', pole: true, site: true },
  { type: 'dumpster', name: 'Dumpster', category: 'Outdoor', icon: '🚛', w: 6, d: 3.5, h: 4.5, y: 0, color: '#3f5a46', mount: 'floor', geo: 'dumpster', site: true },
  { type: 'sign-school', name: 'School Zone Sign', category: 'Outdoor', icon: '🚸', w: 1, d: 1, h: 7, y: 0, color: '#d8b13f', mount: 'floor', geo: 'polesign', site: true },

  // Phase 5 of the second arc. Everything a site needs standing on it once
  // there is a site to stand on: the things that edge a lot, the things that
  // shelter a queue, and the things a field is not a field without. All
  // `site: true`, all mount 'floor' — which is what makes them obstacles to a
  // walker and what puts them on the terrain rather than on a slab.
  { type: 'soccer-goal', name: 'Soccer Goal', category: 'Outdoor', icon: '🥅', w: 24, d: 8, h: 8, y: 0, color: '#e4e6e8', mount: 'floor', geo: 'goal', site: true },
  { type: 'backstop', name: 'Backstop', category: 'Outdoor', icon: '⚾', w: 30, d: 12, h: 16, y: 0, color: '#8a8f96', mount: 'floor', geo: 'backstop', site: true },
  { type: 'bleacher-outdoor', name: 'Outdoor Bleachers', category: 'Outdoor', icon: '🏟', w: 24, d: 12, h: 9, y: 0, color: '#8a8f96', mount: 'floor', geo: 'riser', rows: 5, seats: true, site: true },
  { type: 'fence-chain', name: 'Chain-link Fence', category: 'Outdoor', icon: '🔗', w: 10, d: 0.3, h: 6, y: 0, color: '#9aa1a8', mount: 'floor', geo: 'fence', site: true },
  { type: 'fence-gate', name: 'Chain-link Gate', category: 'Outdoor', icon: '🚧', w: 8, d: 0.3, h: 6, y: 0, color: '#9aa1a8', mount: 'floor', geo: 'fence', style: 'gate', site: true },
  { type: 'bus-shelter', name: 'Bus Shelter', category: 'Outdoor', icon: '🚌', w: 12, d: 5, h: 8, y: 0, color: '#5a6068', mount: 'floor', geo: 'shelter', site: true },
  { type: 'pergola', name: 'Shade Structure', category: 'Outdoor', icon: '⛱️', w: 20, d: 12, h: 10, y: 0, color: '#8a6a48', mount: 'floor', geo: 'pergola', site: true },
  { type: 'sandbox', name: 'Sandbox', category: 'Outdoor', icon: '🏖️', w: 10, d: 10, h: 1.2, y: 0, color: '#8a6a48', mount: 'floor', geo: 'sandbox', site: true },
  { type: 'climber', name: 'Climbing Structure', category: 'Outdoor', icon: '🧗', w: 14, d: 12, h: 9, y: 0, color: '#3f8f7a', mount: 'floor', geo: 'climber', site: true },
  { type: 'tetherball', name: 'Tetherball Pole', category: 'Outdoor', icon: '🎾', w: 2, d: 2, h: 10, y: 0, color: '#5a6068', mount: 'floor', geo: 'tetherball', site: true },
  { type: 'bollard', name: 'Bollard', category: 'Outdoor', icon: '🟡', w: 1, d: 1, h: 3.5, y: 0, color: '#d8b13f', mount: 'floor', geo: 'bollard', site: true },
  { type: 'trash-outdoor', name: 'Outdoor Receptacle', category: 'Outdoor', icon: '🗑', w: 2.2, d: 2.2, h: 3.2, y: 0, color: '#3f4a44', mount: 'floor', geo: 'bin', site: true },
  { type: 'sign-marquee', name: 'Marquee Sign', category: 'Outdoor', icon: '🪧', w: 10, d: 2, h: 8, y: 0, color: '#7a5230', mount: 'floor', geo: 'polesign', style: 'marquee', site: true },

  // ---- Landscape ----
  //
  // Planting, at the size the nursery tag says it will be in twenty years
  // rather than the size it is on the day it goes in — a school's shade trees
  // are the one thing on the site drawn at maturity, because a site plan is a
  // promise about what the place will look like. `tree-young` is the exception
  // and is staked, which is what makes it read as new.
  { type: 'tree-shade', name: 'Shade Tree', category: 'Landscape', icon: '🌳', w: 26, d: 26, h: 32, y: 0, color: '#4a7a3a', mount: 'floor', geo: 'tree', site: true },
  { type: 'tree-conifer', name: 'Evergreen', category: 'Landscape', icon: '🌲', w: 16, d: 16, h: 34, y: 0, color: '#2f5c3f', mount: 'floor', geo: 'tree', style: 'conifer', site: true },
  { type: 'tree-ornamental', name: 'Ornamental Tree', category: 'Landscape', icon: '🌸', w: 14, d: 14, h: 16, y: 0, color: '#7a9a4a', mount: 'floor', geo: 'tree', style: 'ornamental', site: true },
  { type: 'tree-columnar', name: 'Columnar Tree', category: 'Landscape', icon: '🎋', w: 8, d: 8, h: 26, y: 0, color: '#3f6b3a', mount: 'floor', geo: 'tree', style: 'columnar', site: true },
  { type: 'tree-young', name: 'Young Tree (staked)', category: 'Landscape', icon: '🌱', w: 8, d: 8, h: 12, y: 0, color: '#5c8a44', mount: 'floor', geo: 'tree', style: 'young', site: true },
  { type: 'hedge-run', name: 'Hedge', category: 'Landscape', icon: '🌿', w: 6, d: 3, h: 4, y: 0, color: '#3f6b3f', mount: 'floor', geo: 'hedge', site: true, absorb: 0.40 },
  { type: 'shrub-round', name: 'Shrub', category: 'Landscape', icon: '🪺', w: 4, d: 4, h: 3.5, y: 0, color: '#4a7a4a', mount: 'floor', geo: 'shrub', site: true, absorb: 0.40 },
  { type: 'grass-ornamental', name: 'Ornamental Grass', category: 'Landscape', icon: '🌾', w: 3, d: 3, h: 3, y: 0, color: '#9c9450', mount: 'floor', geo: 'shrub', style: 'grass', site: true },
  { type: 'planter-concrete', name: 'Concrete Planter', category: 'Landscape', icon: '🪴', w: 4, d: 4, h: 2.5, y: 0, color: '#a8a49a', mount: 'floor', geo: 'planter', site: true },
  { type: 'boulder', name: 'Landscape Boulder', category: 'Landscape', icon: '🪨', w: 5, d: 4, h: 3, y: 0, color: '#8a8478', mount: 'floor', geo: 'boulder', site: true },
];

const BY_TYPE = new Map(PROP_CATALOG.map((e) => [e.type, e]));

// --- Phase 9: rows that came from a file ---
//
// The table above is what this build ships. A design may also carry imported
// glTF models (models.js), and every one of them has to look like a catalog
// row to the eight modules that ask `catalogEntry(type)` a question —
// propplace for its footprint, collide for its obstacle, blueprint for its
// symbol, takeoff for its count, lights and sound for the emitters it hasn't
// got. Rather than teach all eight about a second table, the design's rows
// are *registered* here and the two lookups below see them.
//
// It's a registry rather than a merge because the rows belong to the open
// design: `registerRows` replaces the whole set on load, on New and on undo,
// which is exactly the lifetime a design has. `type` is namespaced by
// models.js, so an imported row can never shadow a built-in one.
let extraRows = [];
const BY_EXTRA = new Map();

export function registerRows(rows) {
  extraRows = [];
  BY_EXTRA.clear();
  for (const row of rows || []) {
    if (!row || typeof row.type !== 'string' || BY_TYPE.has(row.type)) continue;
    extraRows.push(row);
    BY_EXTRA.set(row.type, row);
  }
  return extraRows.length;
}

export const registeredRows = () => extraRows.slice();

export const catalogEntry = (type) => BY_TYPE.get(type) || BY_EXTRA.get(type) || null;

export function catalogByCategory() {
  const out = CATEGORIES.map((category) => ({ category, entries: [] }));
  const idx = new Map(out.map((g) => [g.category, g]));
  for (const entry of PROP_CATALOG.concat(extraRows)) {
    const g = idx.get(entry.category);
    if (g) g.entries.push(entry);
  }
  return out.filter((g) => g.entries.length);
}

// --- Phase 11: colour variants ---
//
// A row's `color` is the colour that type is *usually* painted; a prop may
// override it by carrying `data.color`. `cleanData()` (props.js) has validated
// that field as a string since Phase 1 — what was missing until now was
// anybody reading it, which is what these three do.
//
// They live here rather than in props.js because the fallback is the catalog
// row's own colour, and here is the only place that knows it. Everything that
// paints a prop — the renderer's geometry cache, the blueprint's fill, the
// editor's swatch — goes through `propColor`, so a variant can never be
// honoured in one view and ignored in another.

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

// Normalize a candidate colour to a lowercase `#rrggbb`, or '' if it isn't a
// colour at all. Three-digit shorthand is expanded, because a save file edited
// by hand is allowed to be terse and a `#f00` chair should still be red rather
// than silently grey.
export function normalizeColor(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  if (HEX6.test(s)) return s;
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return '';
}

// The colour a given prop should actually be drawn in. `prop` is optional, so
// a caller holding only a row (the palette, a legend) can ask the same
// question. The last fallback matches `missingModelGeo`'s: a prop whose row
// has lost its colour is grey, never `undefined` handed to a colour parser.
export function propColor(entry, prop = null) {
  const own = prop && prop.data ? normalizeColor(prop.data.color) : '';
  return own || (entry && normalizeColor(entry.color)) || '#8a8f96';
}

// '' for a prop wearing its row's own colour, the variant hex otherwise. The
// renderer's geometry cache appends this to the type, so the common case —
// every desk in the building the same brown — is still one cache entry and one
// draw call, and only a recoloured prop costs a second of each.
export function variantKey(entry, prop) {
  const own = prop && prop.data ? normalizeColor(prop.data.color) : '';
  return own && own !== normalizeColor(entry && entry.color) ? own : '';
}

// The swatch row itself. Eleven paints and the absence of one — school
// furniture colours rather than a colour wheel, because the point of the row
// is to let somebody colour-code a wing or brighten a kindergarten, not to
// match a brand. `null` is the first cell and is not a colour: it clears
// `data.color` so the prop goes back to whatever its catalog row says, which
// is a different thing from painting it that colour.
export const PROP_PAINTS = [
  null,
  '#d9d5cc', // bone
  '#c0392b', // schoolhouse red
  '#e07b39', // orange
  '#e5b33a', // marigold
  '#5d8a4e', // fern
  '#2f8f83', // teal
  '#3f6fae', // the blue every student chair in this catalog already is
  '#5b4b8a', // violet
  '#b8567f', // rose
  '#8a5a3a', // oak
  '#3a4048', // charcoal
];
