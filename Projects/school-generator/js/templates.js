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
      { type: 'whiteboard', dx: 0, dz: -10.7, y: 3.6, rotationY: 0 },
      { type: 'teacher-desk', dx: -7, dz: -8.5, rotationY: 0 },
      { type: 'teacher-chair', dx: -7, dz: -6.9, rotationY: Math.PI },
      ...[-6, 0, 6].flatMap((dx) => [-1, 5].map((dz) => ({ dx, dz }))).flatMap(({ dx, dz }) => [
        { type: 'student-desk', dx, dz, rotationY: 0 },
        { type: 'student-chair', dx, dz: dz + 1.6, rotationY: Math.PI },
      ]),
      { type: 'bookshelf-low', dx: 9, dz: 8, rotationY: -Math.PI / 2 },
      { type: 'trash-can', dx: 9, dz: -9, rotationY: 0 },
    ],
  },
  {
    key: 'computer-lab-row',
    name: 'Computer Lab Row',
    icon: '💻',
    footprint: { w: 22, d: 6 },
    stamps: [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].flatMap((dx) => [
      { type: 'student-desk', dx, dz: -2, rotationY: 0 },
      { type: 'student-chair', dx, dz: -0.4, rotationY: Math.PI },
    ]),
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
