// decor.js — the seasonal decoration packs.
//
// Phase 11, and the smallest module in the project, which is the point. A pack
// is *a palette and a list*: which of the catalog's Decor rows a season leans
// on, and what colour each of them wants to be. It ships no geometry, no
// builders and — deliberately — no catalog rows of its own.
//
// That shape is only possible because the colour variants landed first. Before
// them, "Halloween Garland" and "Winter Garland" had to be two rows with two
// baked-in colours, and four seasons times nine pieces is thirty-six rows of
// near-duplicate table. After them there is one Garland, and a pack is the
// sentence "in October, a garland is rust".
//
// Nothing here is stored in a save file. A pack is a state of the editor's
// prop tool — which paint the next placement wears — and the thing that
// survives is the prop, wearing the colour the pack put on it. Switch packs
// after decorating for Halloween and the pumpkins stay orange.

// The rows a pack draws from. Every one of these is an ordinary catalog row
// (`decor.test.mjs` holds this list to the catalog); six of them are the
// seasonal kit Phase 11 added and the last three were already here, because a
// potted plant painted red is a poinsettia and a poster is whatever you print.
export const DECOR_TYPES = [
  'garland', 'bunting', 'streamers', 'string-lights', 'wreath',
  'cutout', 'banner', 'pumpkin', 'gourd', 'tree-festive',
  'plant-floor', 'poster', 'rug',
];

// `pieces` is what the pack is *about*, in the order the palette should offer
// them. `paints` names a colour only where the pack disagrees with the catalog
// row — a type left out of it is placed in whatever colour the row says, which
// is why a pumpkin is in harvest's `pieces` and not in its `paints`: it is
// already orange, and repainting it orange would buy a second cached geometry
// and a second draw call for no visible difference. `palette` is the swatch row
// the pack puts under the palette — six colours, because six is what the prop
// panel is wide enough for and more than six is a colour picker rather than a
// season.
export const DECOR_PACKS = [
  {
    key: 'harvest',
    name: 'Harvest',
    icon: '🍂',
    note: 'Rust, gold and oak — the September-to-November end of the year.',
    palette: ['#d2691e', '#8c3b1a', '#c8a13a', '#6b4a2f', '#7d2b2b', '#efe3cc'],
    pieces: ['pumpkin', 'gourd', 'garland', 'wreath', 'bunting', 'cutout', 'banner'],
    paints: {
      garland: '#8c3b1a',
      bunting: '#d2691e',
      streamers: '#c8a13a',
      wreath: '#6b4a2f',
      cutout: '#d2691e',
      banner: '#7d2b2b',
      'plant-floor': '#8c3b1a',
      poster: '#7d2b2b',
      rug: '#8c3b1a',
    },
  },
  {
    key: 'winter',
    name: 'Winter Holidays',
    icon: '❄️',
    note: 'Pine, holly and a lot of small warm lights.',
    palette: ['#1f5c33', '#b02a2a', '#d4a437', '#c8ced6', '#cfe3f0', '#f4f8fb'],
    pieces: ['tree-festive', 'wreath', 'garland', 'string-lights', 'cutout', 'plant-floor', 'banner'],
    paints: {
      garland: '#1f5c33',
      bunting: '#b02a2a',
      streamers: '#c8ced6',
      wreath: '#1f5c33',
      cutout: '#f4f8fb',
      banner: '#b02a2a',
      'tree-festive': '#1f5c33',
      // A potted plant in holly red is a poinsettia, and this is the whole
      // argument for the phase in one line of table.
      'plant-floor': '#b02a2a',
      poster: '#1f5c33',
      rug: '#b02a2a',
    },
  },
  {
    key: 'spring',
    name: 'Spring',
    icon: '🌷',
    note: 'Pastels for the long stretch between the winter break and the end of term.',
    palette: ['#7fb069', '#f2a6c2', '#f6d365', '#a8d8ea', '#c3aed6', '#fdf6e3'],
    pieces: ['streamers', 'bunting', 'cutout', 'plant-floor', 'garland', 'banner'],
    paints: {
      garland: '#7fb069',
      bunting: '#a8d8ea',
      streamers: '#f2a6c2',
      wreath: '#7fb069',
      cutout: '#f6d365',
      banner: '#7fb069',
      'plant-floor': '#f2a6c2',
      poster: '#a8d8ea',
      rug: '#f6d365',
    },
  },
  {
    key: 'lightsout',
    name: 'Lights Out',
    icon: '🕯️',
    note: 'For the version of the building you hand somebody after dark. Phase 24 dresses itself; this is for setting a scene by hand.',
    palette: ['#1c2126', '#3d4650', '#6e2b2b', '#8a8f96', '#2c3b34', '#d8d4c8'],
    pieces: ['poster', 'banner', 'cutout', 'rug', 'string-lights', 'streamers'],
    paints: {
      garland: '#2c3b34',
      bunting: '#3d4650',
      streamers: '#8a8f96',
      wreath: '#2c3b34',
      cutout: '#1c2126',
      banner: '#6e2b2b',
      'plant-floor': '#2c3b34',
      poster: '#3d4650',
      rug: '#1c2126',
      'string-lights': '#6e2b2b',
    },
  },
  {
    key: 'spirit',
    name: 'Spirit Week',
    icon: '📣',
    note: 'Loud school colours — repaint the row to your own two and it is your school.',
    palette: ['#1f3b73', '#c8102e', '#f2c200', '#2e7d32', '#6a1b9a', '#f5f5f5'],
    pieces: ['banner', 'bunting', 'streamers', 'cutout', 'poster', 'garland'],
    paints: {
      garland: '#1f3b73',
      bunting: '#1f3b73',
      streamers: '#f2c200',
      cutout: '#f2c200',
      banner: '#c8102e',
      poster: '#c8102e',
      rug: '#1f3b73',
    },
  },
];

const BY_KEY = new Map(DECOR_PACKS.map((p) => [p.key, p]));

export const packByKey = (key) => BY_KEY.get(key) || null;

// The paint a pack wants on a given type, '' meaning "leave the catalog row
// alone". Same return convention as `variantKey` in catalog.js, so the two can
// be handed to the same setter without either side testing for null.
export function packPaint(pack, type) {
  const p = typeof pack === 'string' ? packByKey(pack) : pack;
  if (!p || !p.paints) return '';
  const c = p.paints[type];
  return typeof c === 'string' ? c : '';
}

// The pack's own pieces first, then the rest of the kit. A pack is a shortcut,
// not a restriction — everything stays reachable in the full palette below it,
// so a Halloween skeleton in the winter pack is two extra clicks rather than
// impossible.
export function packTypes(pack) {
  const p = typeof pack === 'string' ? packByKey(pack) : pack;
  if (!p) return [];
  const lead = (p.pieces || []).filter((t) => DECOR_TYPES.includes(t));
  return lead.concat(DECOR_TYPES.filter((t) => !lead.includes(t)));
}
