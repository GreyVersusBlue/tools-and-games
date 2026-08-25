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
// plus builder parameters (`top`, `style`, `device`, `rows`, ...) documented
// beside each geometry builder in render.js.

export const CATEGORIES = [
  'Tables & Desks', 'Seating', 'Storage', 'Fixtures', 'Lighting',
  'Subject Rooms', 'Cafeteria', 'Gym & Stage', 'Library & Office', 'Restroom',
  'Decor', 'Outdoor',
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
  'picnic', 'bikerack', 'flagpole', 'slide', 'swing', 'dumpster', 'polesign',
  'troffer', 'pendant', 'sconce', 'polelight',
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
  { type: 'student-chair', name: 'Student Chair', category: 'Seating', icon: '💺', w: 1.4, d: 1.5, h: 2.7, y: 0, color: '#3f6fae', mount: 'floor', geo: 'chair' },
  { type: 'chair-stack', name: 'Stackable Chair', category: 'Seating', icon: '🪑', w: 1.6, d: 1.6, h: 2.7, y: 0, color: '#7a3f3f', mount: 'floor', geo: 'chair', style: 'stack' },
  { type: 'teacher-chair', name: 'Teacher Chair', category: 'Seating', icon: '🧑‍🏫', w: 2, d: 2, h: 3.3, y: 0, color: '#2c2c34', mount: 'floor', geo: 'chair', style: 'task' },
  { type: 'chair-task', name: 'Rolling Task Chair', category: 'Seating', icon: '🌀', w: 2, d: 2, h: 3, y: 0, color: '#37474f', mount: 'floor', geo: 'chair', style: 'task' },
  { type: 'chair-rocking', name: 'Rocking Chair', category: 'Seating', icon: '🧶', w: 2, d: 2.5, h: 3.3, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'chair', style: 'rocker' },
  { type: 'stool-lab-24', name: 'Lab Stool 24in', category: 'Seating', icon: '🥼', w: 1.2, d: 1.2, h: 2, y: 0, color: '#31363c', mount: 'floor', geo: 'stool' },
  { type: 'stool-lab-30', name: 'Lab Stool 30in', category: 'Seating', icon: '🧫', w: 1.2, d: 1.2, h: 2.5, y: 0, color: '#31363c', mount: 'floor', geo: 'stool' },
  { type: 'bench-hall', name: 'Hallway Bench', category: 'Seating', icon: '🛋️', w: 6, d: 1.25, h: 1.5, y: 0, color: '#9c7248', mount: 'floor', geo: 'bench' },
  { type: 'seat-auditorium', name: 'Auditorium Seat', category: 'Seating', icon: '🎟️', w: 1.8, d: 2, h: 3.2, y: 0, color: '#7c2f3e', mount: 'floor', geo: 'audseat' },
  { type: 'chair-lounge', name: 'Lounge Chair', category: 'Seating', icon: '🧘', w: 2.8, d: 2.8, h: 2.6, y: 0, color: '#4f6f52', mount: 'floor', geo: 'softseat', kind: 'lounge' },
  { type: 'sofa', name: 'Sofa', category: 'Seating', icon: '🛋', w: 6, d: 2.8, h: 2.7, y: 0, color: '#54617a', mount: 'floor', geo: 'softseat', kind: 'sofa' },
  { type: 'beanbag', name: 'Bean Bag', category: 'Seating', icon: '🫧', w: 2.5, d: 2.5, h: 1.3, y: 0, color: '#b0503f', mount: 'floor', geo: 'softseat', kind: 'beanbag' },
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
  { type: 'book-cart', name: 'Book Cart', category: 'Storage', icon: '🛒', w: 3, d: 1.5, h: 3.5, y: 0, color: '#606a75', mount: 'floor', geo: 'cart' },
  { type: 'hook-rail', name: 'Backpack Rail', category: 'Storage', icon: '🪝', w: 4, d: 0.3, h: 0.5, y: 3.5, color: '#8a6a48', mount: 'wall', geo: 'hookrail' },

  // ---- Fixtures ----
  { type: 'floor-lamp', name: 'Floor Lamp', category: 'Fixtures', icon: '💡', w: 1, d: 1, h: 5.5, y: 0, color: '#d8cba0', mount: 'floor', geo: 'lamp', emit: { lm: 1200, color: '#ffe3b4', range: 18, dy: 5 } },
  { type: 'tv', name: 'TV / Smart Board', category: 'Fixtures', icon: '📺', w: 5.5, d: 0.3, h: 2.7, y: 3.4, color: '#15161a', mount: 'wall', geo: 'panel' },
  { type: 'whiteboard', name: 'Whiteboard', category: 'Fixtures', icon: '🖊️', w: 6, d: 0.15, h: 4, y: 2.8, color: '#f4f4f2', mount: 'wall', geo: 'panel' },
  { type: 'board-cork', name: 'Bulletin Board', category: 'Fixtures', icon: '📌', w: 6, d: 0.1, h: 4, y: 3.5, color: '#a9805a', mount: 'wall', geo: 'panel' },
  { type: 'clock-wall', name: 'Wall Clock', category: 'Fixtures', icon: '🕐', w: 1.2, d: 0.15, h: 1.2, y: 7, color: '#e8e6df', mount: 'wall', geo: 'clock' },
  { type: 'screen-pulldown', name: 'Projection Screen', category: 'Fixtures', icon: '🎬', w: 7, d: 0.3, h: 5.5, y: 2.5, color: '#efefec', mount: 'wall', geo: 'pulldown' },
  { type: 'projector-ceiling', name: 'Ceiling Projector', category: 'Fixtures', icon: '📽️', w: 1.5, d: 1.2, h: 2, y: 8, color: '#d9d9d4', mount: 'ceiling', geo: 'projector' },
  { type: 'case-display', name: 'Display Case', category: 'Fixtures', icon: '🏆', w: 6, d: 1.5, h: 6.5, y: 0, color: '#6a5636', mount: 'floor', geo: 'displaycase' },
  { type: 'fountain', name: 'Water Fountain', category: 'Fixtures', icon: '⛲', w: 1.5, d: 1.3, h: 3.3, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'fountain' },
  { type: 'cabinet-fire', name: 'Fire Extinguisher Cabinet', category: 'Fixtures', icon: '🧯', w: 1, d: 0.6, h: 2.3, y: 3, color: '#b03a30', mount: 'wall', geo: 'wallbox', style: 'fire' },
  { type: 'cabinet-aed', name: 'AED Cabinet', category: 'Fixtures', icon: '🫀', w: 1.2, d: 0.6, h: 1.5, y: 4, color: '#e6e8ea', mount: 'wall', geo: 'wallbox', style: 'aed' },
  { type: 'sign-exit', name: 'Exit Sign', category: 'Fixtures', icon: '🏃', w: 1, d: 0.2, h: 0.7, y: 7.5, color: '#2e8b46', mount: 'wall', geo: 'panel', emit: { lm: 90, color: '#8dffb0', range: 9, dy: 0.35 } },
  { type: 'speaker-pa', name: 'PA Speaker', category: 'Fixtures', icon: '🔊', w: 1, d: 0.8, h: 1, y: 8, color: '#3a3f45', mount: 'wall', geo: 'wallbox', style: 'grille' },
  { type: 'flag-wall', name: 'Flag on Bracket', category: 'Fixtures', icon: '🚩', w: 1, d: 2.5, h: 3, y: 6, color: '#8a2f3a', mount: 'wall', geo: 'flagwall' },
  { type: 'radiator', name: 'Radiator', category: 'Fixtures', icon: '♨️', w: 4, d: 0.8, h: 2, y: 0, color: '#c9c4b8', mount: 'floor', geo: 'radiator' },
  { type: 'dispenser', name: 'Towel Dispenser', category: 'Fixtures', icon: '🧻', w: 1, d: 0.5, h: 1.2, y: 4, color: '#d7dadd', mount: 'wall', geo: 'wallbox' },
  { type: 'trash-can', name: 'Trash Can', category: 'Fixtures', icon: '🗑️', w: 1.2, d: 1.2, h: 2, y: 0, color: '#4a4f57', mount: 'floor', geo: 'bin' },
  { type: 'sink', name: 'Classroom Sink', category: 'Fixtures', icon: '🚰', w: 2, d: 1.8, h: 3, y: 0, color: '#dfe3e6', mount: 'floor', geo: 'sink' },

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
  { type: 'light-track', name: 'Track Lighting', category: 'Lighting', icon: '🎯', w: 6, d: 0.5, h: 1.1, y: 8.9, color: '#3a3f45', mount: 'ceiling', geo: 'troffer', style: 'track', heads: 4, emit: { lm: 3200, color: '#ffeccb', range: 20, dy: -0.7 } },
  { type: 'pendant-dome', name: 'Pendant Light', category: 'Lighting', icon: '🏮', w: 1.8, d: 1.8, h: 3, y: 7, color: '#d8cba0', mount: 'ceiling', geo: 'pendant', emit: { lm: 1600, color: '#ffe6bd', range: 20, dy: 0.5 } },
  { type: 'light-highbay', name: 'Gym High Bay', category: 'Lighting', icon: '🛸', w: 2.2, d: 2.2, h: 2.2, y: 7.8, color: '#b9bfc6', mount: 'ceiling', geo: 'pendant', style: 'highbay', emit: { lm: 20000, color: '#fbfaf4', range: 70, dy: 0.4 } },
  { type: 'sconce-wall', name: 'Wall Sconce', category: 'Lighting', icon: '🕯️', w: 1, d: 0.7, h: 1.4, y: 6, color: '#c8ccd2', mount: 'wall', geo: 'sconce', emit: { lm: 800, color: '#ffe2b6', range: 16, dy: 0.7 } },
  { type: 'light-wallpack', name: 'Exterior Wall Pack', category: 'Lighting', icon: '🔦', w: 1.4, d: 1, h: 1.2, y: 8.6, color: '#4a4f57', mount: 'wall', geo: 'sconce', style: 'pack', site: true, emit: { lm: 6000, color: '#fdf3dd', range: 40, dy: -0.2 } },
  { type: 'light-pole', name: 'Parking Lot Light', category: 'Lighting', icon: '🛣️', w: 2, d: 2, h: 22, y: 0, color: '#5a6068', mount: 'floor', geo: 'polelight', site: true, emit: { lm: 12000, color: '#f6f2e4', range: 90, dy: 21 } },
  { type: 'light-bollard', name: 'Path Bollard', category: 'Lighting', icon: '📍', w: 0.8, d: 0.8, h: 3.5, y: 0, color: '#5a6068', mount: 'floor', geo: 'polelight', style: 'bollard', site: true, emit: { lm: 900, color: '#ffeecd', range: 16, dy: 3.1 } },
  { type: 'lamp-desk', name: 'Desk Lamp', category: 'Lighting', icon: '🪔', w: 0.9, d: 0.9, h: 1.6, y: 2.5, color: '#c9a06a', mount: 'floor', geo: 'lamp', surface: true, emit: { lm: 450, color: '#ffe0aa', range: 9, dy: 1.4 } },

  // ---- Subject Rooms ----
  { type: 'piano-upright', name: 'Upright Piano', category: 'Subject Rooms', icon: '🎹', w: 5, d: 2, h: 4, y: 0, color: '#241f1d', mount: 'floor', geo: 'piano' },
  { type: 'music-stand', name: 'Music Stand', category: 'Subject Rooms', icon: '🎼', w: 1.5, d: 1.5, h: 4, y: 0, color: '#2c2c34', mount: 'floor', geo: 'musicstand' },
  { type: 'riser-choir', name: 'Choir Riser', category: 'Subject Rooms', icon: '🎶', w: 6, d: 3, h: 1.3, y: 0, color: '#7a6248', mount: 'floor', geo: 'riser', rows: 3 },
  { type: 'easel-art', name: 'Art Easel', category: 'Subject Rooms', icon: '🖼️', w: 2, d: 2, h: 5.5, y: 0, color: '#a9825a', mount: 'floor', geo: 'easel' },
  { type: 'rack-drying', name: 'Drying Rack', category: 'Subject Rooms', icon: '🖌️', w: 2.5, d: 1.5, h: 4, y: 0, color: '#8a8f96', mount: 'floor', geo: 'dryrack' },
  { type: 'kiln', name: 'Kiln', category: 'Subject Rooms', icon: '🔥', w: 2.5, d: 2.5, h: 3, y: 0, color: '#8f8a80', mount: 'floor', geo: 'kiln' },
  { type: 'pottery-wheel', name: 'Pottery Wheel', category: 'Subject Rooms', icon: '🏺', w: 2.5, d: 2, h: 1.8, y: 0, color: '#5f6a72', mount: 'floor', geo: 'wheel' },
  { type: 'bench-lab', name: 'Lab Bench', category: 'Subject Rooms', icon: '🧪', w: 6, d: 2.5, h: 3, y: 0, color: '#20242a', mount: 'floor', geo: 'labbench' },
  { type: 'table-demo', name: 'Demo Table', category: 'Subject Rooms', icon: '🔬', w: 8, d: 2.5, h: 3, y: 0, color: '#20242a', mount: 'floor', geo: 'labbench' },
  { type: 'bench-robotics', name: 'Robotics Workbench', category: 'Subject Rooms', icon: '🤖', w: 6, d: 2.5, h: 3, y: 0, color: '#9c7248', mount: 'floor', geo: 'labbench', pegboard: true },
  { type: 'fume-hood', name: 'Fume Hood', category: 'Subject Rooms', icon: '🌫️', w: 4, d: 2.5, h: 8, y: 0, color: '#cfd4d9', mount: 'floor', geo: 'fumehood' },
  { type: 'eyewash', name: 'Eyewash Station', category: 'Subject Rooms', icon: '🚿', w: 1.2, d: 1.2, h: 3.6, y: 0, color: '#3f9e4f', mount: 'floor', geo: 'eyewash' },
  { type: 'skeleton', name: 'Anatomy Skeleton', category: 'Subject Rooms', icon: '💀', w: 1.5, d: 1.5, h: 5.8, y: 0, color: '#e3ded2', mount: 'floor', geo: 'skeleton' },
  { type: 'globe', name: 'Globe', category: 'Subject Rooms', icon: '🌍', w: 1.5, d: 1.5, h: 3, y: 0, color: '#3a6fae', mount: 'floor', geo: 'globe' },
  { type: 'printer-3d', name: '3D Printer Bench', category: 'Subject Rooms', icon: '🖨️', w: 2, d: 2, h: 4, y: 0, color: '#5a6068', mount: 'floor', geo: 'workstation', device: 'printer' },
  { type: 'table-sewing', name: 'Sewing Table', category: 'Subject Rooms', icon: '🧵', w: 4, d: 2, h: 2.5, y: 0, color: '#8a5a3a', mount: 'floor', geo: 'workstation', device: 'sewing' },

  // ---- Cafeteria ----
  { type: 'counter-serving', name: 'Serving Counter', category: 'Cafeteria', icon: '🍲', w: 6, d: 2.5, h: 3, y: 0, color: '#aab2ba', mount: 'floor', geo: 'counter', guard: true },
  { type: 'tray-return', name: 'Tray Return', category: 'Cafeteria', icon: '🍽', w: 4, d: 2, h: 4, y: 0, color: '#aab2ba', mount: 'floor', geo: 'counter', style: 'tray' },
  { type: 'cooler-milk', name: 'Milk Cooler', category: 'Cafeteria', icon: '🥛', w: 3, d: 2.5, h: 3, y: 0, color: '#d7dadd', mount: 'floor', geo: 'machine', style: 'cooler' },
  { type: 'vending', name: 'Vending Machine', category: 'Cafeteria', icon: '🥤', w: 3.3, d: 2.8, h: 6, y: 0, color: '#a23a45', mount: 'floor', geo: 'machine', style: 'vending' },
  { type: 'fridge-commercial', name: 'Commercial Fridge', category: 'Cafeteria', icon: '❄️', w: 4.5, d: 2.7, h: 6.8, y: 0, color: '#c8ccd2', mount: 'floor', geo: 'machine', style: 'fridge' },
  { type: 'table-prep', name: 'Prep Table', category: 'Cafeteria', icon: '🔪', w: 6, d: 2.5, h: 3, y: 0, color: '#c2c7cd', mount: 'floor', geo: 'table' },
  { type: 'station-recycle', name: 'Recycling Station', category: 'Cafeteria', icon: '♻️', w: 4, d: 2, h: 3.5, y: 0, color: '#5a6a5f', mount: 'floor', geo: 'recycle' },

  // ---- Gym & Stage ----
  { type: 'hoop-wall', name: 'Basketball Hoop (Wall)', category: 'Gym & Stage', icon: '🏀', w: 6, d: 4, h: 3.5, y: 9, color: '#e8e6df', mount: 'wall', geo: 'hoop', tall: true },
  { type: 'bleacher', name: 'Bleacher Section', category: 'Gym & Stage', icon: '🏟️', w: 8, d: 7, h: 5.5, y: 0, color: '#9c7248', mount: 'floor', geo: 'riser', rows: 3, seats: true },
  { type: 'volleyball-net', name: 'Volleyball Net', category: 'Gym & Stage', icon: '🏐', w: 30, d: 1, h: 8, y: 0, color: '#3a3f45', mount: 'floor', geo: 'volleyball' },
  { type: 'mat-wall', name: 'Wall Mat', category: 'Gym & Stage', icon: '🥋', w: 6, d: 0.3, h: 6, y: 0.2, color: '#3f5fae', mount: 'wall', geo: 'panel' },
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
  { type: 'rug', name: 'Rug', category: 'Decor', icon: '▦', w: 6, d: 4, h: 0.08, y: 0, color: '#b0503f', mount: 'floor', geo: 'rug' },
  { type: 'plant-floor', name: 'Potted Plant', category: 'Decor', icon: '🪴', w: 1.5, d: 1.5, h: 4, y: 0, color: '#3f7a48', mount: 'floor', geo: 'plant' },
  { type: 'plant-desk', name: 'Desk Plant', category: 'Decor', icon: '🌱', w: 0.6, d: 0.6, h: 0.9, y: 2.5, color: '#3f7a48', mount: 'floor', geo: 'plant', surface: true },
  { type: 'aquarium', name: 'Aquarium', category: 'Decor', icon: '🐠', w: 3, d: 1.3, h: 4, y: 0, color: '#3a6a8a', mount: 'floor', geo: 'aquarium' },
  { type: 'pet-cage', name: 'Class Pet Cage', category: 'Decor', icon: '🐹', w: 2.5, d: 1.5, h: 3, y: 0, color: '#8a8f96', mount: 'floor', geo: 'cage' },
  { type: 'poster', name: 'Poster', category: 'Decor', icon: '📃', w: 2, d: 0.05, h: 3, y: 4, color: '#3f6fae', mount: 'wall', geo: 'panel' },
  { type: 'desk-clutter', name: 'Desk Clutter', category: 'Decor', icon: '📝', w: 1.5, d: 1, h: 0.5, y: 2.5, color: '#b0503f', mount: 'floor', geo: 'clutter', surface: true },
  { type: 'hooks-coats', name: 'Coats on Hooks', category: 'Decor', icon: '🎒', w: 4, d: 0.4, h: 2.5, y: 3, color: '#7a6248', mount: 'wall', geo: 'hookrail', hung: true },
  { type: 'blinds', name: 'Window Blinds', category: 'Decor', icon: '🪟', w: 4, d: 0.2, h: 5, y: 3.5, color: '#d8d3c8', mount: 'wall', geo: 'pulldown', sheet: 0.6 },

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
