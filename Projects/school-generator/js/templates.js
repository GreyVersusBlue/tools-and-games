// templates.js — furniture layout presets: a named group of catalog props
// stamped at once, the way a "standard classroom" or a "computer lab row" get
// laid out over and over by hand otherwise. A template doesn't describe a
// room's walls — it furnishes whatever room you click, the same way a real
// layout gets dropped into a shell that was already built.
//
// Pure module (no three.js), like catalog.js and propplace.js: `templateedit.js`
// is the tool that turns this into pointer events and a ghost preview.

import { catalogEntry } from './catalog.js';
import { wrapAngle } from './props.js';

// Each stamp sits at (dx, dz) feet from the template's anchor point — the
// spot you click — before the template's own placement rotation is applied.
// +dz is "into the room, away from the front wall", which is where the
// whiteboard/instructor stamps in `classroom` sit at negative dz. Rotation
// follows propplace.js's convention throughout this file: local (dx, dz)
// maps to world (dx·cosθ + dz·sinθ, -dx·sinθ + dz·cosθ), same as a prop's own
// `rotationY` — so composing a stamp's rotation with the template's is a
// plain sum (see `templatePlacements`), and a template author can place a
// prop by eye the same way `sample.js` places one directly.
export const ROOM_TEMPLATES = [
  {
    key: 'classroom',
    name: 'Standard Classroom',
    icon: '🏫',
    footprint: { w: 22, d: 22 },
    stamps: [
      { type: 'whiteboard', dx: 0, dz: -10.7, rotationY: 0 },
      { type: 'teacher-desk', dx: -7, dz: -8.5, rotationY: 0 },
      { type: 'teacher-chair', dx: -7, dz: -6.9, rotationY: Math.PI },
      ...[-6, 0, 6].flatMap((dx) => [-1, 5].map((dz) => ({ dx, dz }))).flatMap(({ dx, dz }) => [
        { type: 'student-desk', dx, dz, rotationY: 0 },
        { type: 'student-chair', dx, dz: dz + 1.6, rotationY: Math.PI },
      ]),
      { type: 'bookshelf-low', dx: 9, dz: 8, rotationY: -Math.PI / 2 },
      { type: 'trash-can', dx: 9, dz: -9, rotationY: 0 },
      // Phase 3: a room's own lighting is part of its layout. Four 2x4
      // troffers on a 10ft bay is what a 22ft classroom actually has, and
      // stamping them here means a layout arrives already lit rather than
      // going dark the first time somebody scrubs to the evening.
      ...[-5, 5].flatMap((dx) => [-5, 5].map((dz) => ({ type: 'troffer-2x4', dx, dz, rotationY: 0 }))),
    ],
  },
  {
    key: 'computer-lab-row',
    name: 'Computer Lab Row',
    icon: '💻',
    footprint: { w: 22, d: 6 },
    stamps: [
      ...[-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].flatMap((dx) => [
        { type: 'student-desk', dx, dz: -2, rotationY: 0 },
        { type: 'student-chair', dx, dz: -0.4, rotationY: Math.PI },
      ]),
      ...[-6, 0, 6].map((dx) => ({ type: 'troffer-2x4', dx, dz: -1, rotationY: 0 })),
    ],
  },
  {
    // Nothing but light: a 2x3 bay of troffers on a 10ft grid, for lighting a
    // room whose furniture came from somewhere else (or from nowhere — a
    // corridor is a room too). It stands beside the furnished layouts rather
    // than inside them because "light this space" is its own act.
    key: 'lighting-bay',
    name: 'Lighting Bay',
    icon: '🔆',
    footprint: { w: 24, d: 24 },
    stamps: [-10, 0, 10].flatMap((dx) =>
      [-8, 8].map((dz) => ({ type: 'troffer-2x4', dx, dz, rotationY: 0 }))),
  },
  {
    key: 'reading-corner',
    name: 'Reading Corner',
    icon: '📖',
    footprint: { w: 8, d: 8 },
    stamps: [
      { type: 'rug', dx: 0.5, dz: 0.5, rotationY: 0 },
      { type: 'bookshelf-low', dx: -3.2, dz: -2.7, rotationY: 0 },
      { type: 'floor-lamp', dx: 3, dz: -2.8, rotationY: 0 },
    ],
  },
  {
    key: 'science-lab',
    name: 'Science Lab',
    icon: '🧪',
    footprint: { w: 26, d: 24 },
    stamps: [
      { type: 'table-demo', dx: 0, dz: -8.5, rotationY: 0 },
      { type: 'fume-hood', dx: -10.5, dz: -8.5, rotationY: 0 },
      { type: 'eyewash', dx: 11, dz: -9, rotationY: 0 },
      { type: 'whiteboard', dx: 0, dz: -11.7, rotationY: 0 },
      // Two rows of benches, three stools along the working edge of each.
      ...[-7, 0, 7].flatMap((dx) => [-2, 4].flatMap((dz) => [
        { type: 'bench-lab', dx, dz, rotationY: 0 },
        ...[-1.8, 0, 1.8].map((sx) => ({ type: 'stool-lab-24', dx: dx + sx, dz: dz + 2, rotationY: Math.PI })),
      ])),
      { type: 'sink', dx: 11, dz: 8, rotationY: -Math.PI / 2 },
      { type: 'cabinet-supply', dx: -11, dz: 8, rotationY: Math.PI / 2 },
    ],
  },
  {
    key: 'cafeteria-block',
    name: 'Cafeteria Block',
    icon: '🍽️',
    footprint: { w: 30, d: 22 },
    stamps: [-7, 0, 7].flatMap((dz) => [
      { type: 'table-cafeteria', dx: 0, dz, rotationY: 0 },
      { type: 'bench-hall', dx: -3.2, dz: dz + 2, rotationY: 0 },
      { type: 'bench-hall', dx: 3.2, dz: dz + 2, rotationY: 0 },
      { type: 'bench-hall', dx: -3.2, dz: dz - 2, rotationY: Math.PI },
      { type: 'bench-hall', dx: 3.2, dz: dz - 2, rotationY: Math.PI },
    ]),
  },
  {
    key: 'library-aisle',
    name: 'Library Aisle',
    icon: '📚',
    footprint: { w: 16, d: 16 },
    stamps: [
      ...[-6, 0, 6].map((dx) => ({ type: 'library-stack', dx, dz: 0, rotationY: Math.PI / 2 })),
      { type: 'rack-display', dx: -6, dz: -6.5, rotationY: 0 },
      { type: 'book-cart', dx: 6, dz: -6.5, rotationY: 0 },
    ],
  },
  {
    // Phase 40 moved the banks to the walls and took the bench out of the
    // fairway. Until then the banks stood 1.4ft off each wall of a 12ft
    // corridor with a bench down the middle, which left 33in between them —
    // the first thing the chair found on every generated school, and a
    // corridor no wheelchair (and, at 36in, no code) gets down. A bank's back
    // is on the wall's face: half the corridor, less the interior wall's
    // half-thickness, less half the bank's depth.
    key: 'locker-hallway',
    name: 'Locker Hallway',
    icon: '🔒',
    footprint: { w: 16, d: 12 },
    stamps: [
      { type: 'locker-bank', dx: -4, dz: -5.175, rotationY: 0 },
      { type: 'locker-bank', dx: 4, dz: -5.175, rotationY: 0 },
      { type: 'locker-bank-half', dx: -4, dz: 5.175, rotationY: Math.PI },
      { type: 'locker-bank-half', dx: 4, dz: 5.175, rotationY: Math.PI },
    ],
  },
  {
    key: 'gym-court',
    name: 'Gym Court',
    icon: '🏀',
    footprint: { w: 60, d: 42 },
    stamps: [
      { type: 'hoop-wall', dx: -27, dz: 0, rotationY: Math.PI / 2 },
      { type: 'hoop-wall', dx: 27, dz: 0, rotationY: -Math.PI / 2 },
      { type: 'volleyball-net', dx: 0, dz: 0, rotationY: Math.PI / 2 },
      { type: 'bleacher', dx: -10, dz: -17, rotationY: 0 },
      { type: 'bleacher', dx: 10, dz: -17, rotationY: 0 },
      { type: 'rack-ball', dx: 26, dz: -18, rotationY: 0 },
      { type: 'mat-wall', dx: -27.5, dz: 12, rotationY: Math.PI / 2 },
      { type: 'mat-wall', dx: -27.5, dz: -12, rotationY: Math.PI / 2 },
      // A gym is lit by a handful of very bright fixtures rather than a grid
      // of small ones, which is exactly what the budget's clustering wants.
      ...[-20, 0, 20].flatMap((dx) => [-11, 11].map((dz) => ({ type: 'light-highbay', dx, dz, rotationY: 0 }))),
    ],
  },
  {
    key: 'kindergarten-corner',
    name: 'Kindergarten Corner',
    icon: '🧸',
    footprint: { w: 14, d: 14 },
    stamps: [
      { type: 'rug', dx: 0, dz: 2.5, rotationY: 0 },
      { type: 'table-kidney', dx: 0, dz: -3, rotationY: Math.PI },
      ...[-2, -0.7, 0.7, 2].map((dx) => ({ type: 'student-chair', dx, dz: -1.2, rotationY: Math.PI })),
      { type: 'chair-rocking', dx: 0, dz: -4.6, rotationY: 0 },
      { type: 'tote-rack', dx: -5.5, dz: 5.5, rotationY: Math.PI / 2 },
      { type: 'cubby-unit', dx: 5, dz: 6.2, rotationY: Math.PI },
      { type: 'bookshelf-low', dx: -5.8, dz: -0.5, rotationY: Math.PI / 2 },
    ],
  },
  {
    key: 'restroom',
    name: 'Restroom',
    icon: '🚻',
    footprint: { w: 16, d: 12 },
    stamps: [
      ...[-4.5, -1.5, 1.5, 4.5].map((dx) => ({ type: 'toilet-stall', dx, dz: -3, rotationY: 0 })),
      { type: 'counter-sink', dx: -3, dz: 4.8, rotationY: Math.PI },
      { type: 'mirror', dx: -3, dz: 5.9, rotationY: Math.PI },
      { type: 'hand-dryer', dx: 3.5, dz: 5.7, rotationY: Math.PI },
      { type: 'trash-can', dx: 6, dz: 4.5, rotationY: 0 },
    ],
  },
  {
    key: 'front-office',
    name: 'Front Office',
    icon: '🛎️',
    footprint: { w: 16, d: 14 },
    stamps: [
      { type: 'counter-reception', dx: 0, dz: -2, rotationY: Math.PI },
      { type: 'chair-task', dx: 0, dz: -4, rotationY: 0 },
      ...[-3, -1.5, 0, 1.5, 3].map((dx) => ({ type: 'chair-stack', dx, dz: 5, rotationY: Math.PI })),
      { type: 'mail-cubbies', dx: -6.5, dz: -5.8, rotationY: 0 },
      { type: 'copier', dx: 6, dz: -5.5, rotationY: 0 },
      { type: 'file-cabinet', dx: 4.2, dz: -5.8, rotationY: 0 },
      { type: 'plant-floor', dx: -6.5, dz: 4.5, rotationY: 0 },
    ],
  },
  {
    key: 'music-room',
    name: 'Music Room',
    icon: '🎵',
    footprint: { w: 22, d: 18 },
    stamps: [
      { type: 'piano-upright', dx: -6, dz: -6, rotationY: Math.PI / 4 },
      { type: 'riser-choir', dx: 3, dz: 6, rotationY: Math.PI },
      { type: 'riser-choir', dx: -3.5, dz: 6.5, rotationY: Math.PI - Math.PI / 8 },
      ...[-4, -1.5, 1, 3.5].map((dx, i) => ({ type: 'music-stand', dx, dz: 0 - (i % 2), rotationY: 0 })),
      ...[-4, -1.5, 1, 3.5].map((dx, i) => ({ type: 'chair-stack', dx, dz: 1.5 - (i % 2), rotationY: 0 })),
      { type: 'whiteboard', dx: 0, dz: -8.7, rotationY: 0 },
    ],
  },
];

const BY_KEY = new Map(ROOM_TEMPLATES.map((t) => [t.key, t]));
export const templateByKey = (key) => BY_KEY.get(key) || null;

// World-space `{ type, x, z, y, rotationY, mount }` for every stamp in `tpl`,
// placed at (x, z) and turned by `rotationY` — the same shape `propedit.js`
// hands to `addProp` for a single piece, so the template tool can just loop
// over the result. A stamp naming a type the catalog doesn't have is skipped
// rather than placed blind; that only happens if a template is edited wrong,
// since every entry above is checked in templates.test.mjs.
export function templatePlacements(tpl, x, z, rotationY = 0) {
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const out = [];
  for (const st of tpl.stamps) {
    const entry = catalogEntry(st.type);
    if (!entry) continue;
    out.push({
      type: st.type,
      x: x + st.dx * c + st.dz * s,
      z: z - st.dx * s + st.dz * c,
      y: st.y ?? entry.y ?? 0,
      rotationY: wrapAngle((st.rotationY || 0) + rotationY),
      mount: entry.mount,
    });
  }
  return out;
}
