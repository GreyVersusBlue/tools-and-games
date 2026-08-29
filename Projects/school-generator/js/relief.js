// relief.js — the shape of a surface, as a height field and the tangent-space
// normals that fall out of it.
//
// Phase 20 gave every finish family its own albedo and its own roughness, and
// stopped one map short. A wall is flatter than the floor it stands on: brick
// and CMU had raked joints as a *bump* map, wood and vinyl had their seams,
// and carpet, terrazzo, stucco, shingle and painted drywall had nothing at
// all — five surfaces lit as though they were sheets of paper. Under a low
// sun that is the difference between a school and a diagram of one.
//
// So this module answers one question per grain family: **what shape is it?**
// A height field, 0 = the bottom of the deepest joint and 1 = the face of the
// material, on a square that tiles — and then the normals, encoded the way a
// GPU wants them. Nothing here draws: there is no canvas in this file and no
// three.js either, which is the whole reason the sign conventions below can be
// pinned by a suite instead of by squinting at a wall.
//
// **Why a normal map rather than more bump maps.** three.js's `bumpMap`
// differentiates a greyscale map in the fragment shader, which costs two extra
// texture fetches per pixel and gives no control over *direction*: a mortar
// joint and a standing seam come out with the same profile because the shader
// only ever sees a slope. A normal map carries the direction the surface
// faces, so a rib can catch the sun on one flank and shade the other — which
// is the thing metal panel does and brick does not.
//
// **The two conventions, stated once.** Row `y` of the field is texture `v`
// (a `DataTexture` is not flipped, so `data[0]` is v=0), and the normals are
// OpenGL-style — green points toward +v — which is what three.js expects. Get
// either of those backwards and every wall in the building lights from the
// wrong side, silently. `test/relief.test.mjs` holds both.
//
// Pure module: no three.js, no DOM, no canvas. Exercised by
// test/relief.test.mjs.

// One field is 128 x 128. Big enough that a course of brick is a dozen texels
// tall — small enough that eleven of them cost under a megabyte of float and
// build in a few milliseconds at boot.
export const RELIEF_SIZE = 128;

// mulberry32, the same four lines agents.js seeds a population with. Copied
// rather than imported: agents.js is 66 KB of crowd behaviour and this module
// is on the boot path, so importing it to borrow a generator would pin the
// whole population system eager for four lines of arithmetic. The suite pins
// the two sequences equal, so the copy cannot drift into a second generator.
export function reliefRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Modulo that stays positive for negative inputs, which is the whole of what
// makes every field below tile: a texel one step off the left edge is a texel
// one step in from the right.
const wrapi = (v, n) => ((v % n) + n) % n;

// How far a point is from the nearest of `n` evenly spaced lines across a unit
// span, in units of that span. Every coursed material — brick, block, tile,
// plank, shingle — is a pair of these, and the joint is where the answer is
// small.
const toLine = (u, n) => {
  const s = u * n;
  const f = s - Math.floor(s);
  return Math.min(f, 1 - f) / n;
};

// A joint's profile: 0 in the middle of the joint, 1 once clear of it, eased.
// `d` is the distance to the joint line and `w` its half-width, both in the
// same units.
const jointFall = (d, w) => (w <= 0 ? 1 : smoothstep(clamp01(d / w)));

// Tileable value noise: a small lattice of seeded values, wrapped, with a
// smoothstep between them. The lattice can be finer in one axis than the
// other, which is the whole of what makes wood grain a streak along the board
// rather than a blob on it — the alternative, sampling an isotropic field at a
// squashed coordinate, stops tiling the moment the squash isn't a whole
// number of cells.
function valueNoise(size, cellsX, rand, cellsY = cellsX) {
  const nx = Math.max(1, Math.round(cellsX)), ny = Math.max(1, Math.round(cellsY));
  const grid = new Float32Array(nx * ny);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = (y * ny) / size;
    const y0 = Math.floor(gy), fy = smoothstep(gy - y0);
    const ya = wrapi(y0, ny) * nx, yb = wrapi(y0 + 1, ny) * nx;
    for (let x = 0; x < size; x++) {
      const gx = (x * nx) / size;
      const x0 = Math.floor(gx), fx = smoothstep(gx - x0);
      const xa = wrapi(x0, nx), xb = wrapi(x0 + 1, nx);
      const top = grid[ya + xa] + (grid[ya + xb] - grid[ya + xa]) * fx;
      const bot = grid[yb + xa] + (grid[yb + xb] - grid[yb + xa]) * fx;
      out[y * size + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

// ---------- the families ----------
//
// `depth` is the one number that says how deep the relief is: the field's full
// 0..1 range, expressed in texel widths. A brick joint at 2.2 is a real raked
// joint; painted drywall at 0.35 is orange peel you can only see when the sun
// is nearly along the wall. It rides in the table rather than at the call site
// so that "how rough is CMU" is a fact about CMU.
//
// Every `grain` string used by finish.js's three tables and site.js's surfaces
// appears here, plus `paint` for the drywall the wall material wears. The
// suite fails if a table ever grows a grain this file has not met.
export const RELIEF_GRAINS = {
  tile: { depth: 0.9, seed: 0x51ce },
  plank: { depth: 1.2, seed: 0x7104 },
  fiber: { depth: 0.7, seed: 0x2ca7 },
  chip: { depth: 1.1, seed: 0x33cb },
  speck: { depth: 0.5, seed: 0x5eec },
  brick: { depth: 2.2, seed: 0xb21c },
  block: { depth: 2.6, seed: 0xb10c },
  rib: { depth: 3.0, seed: 0x21bb },
  shingle: { depth: 1.8, seed: 0x5417 },
  mow: { depth: 0.6, seed: 0x30ff },
  paint: { depth: 0.35, seed: 0x7a17 },
};

export const GRAIN_KEYS = Object.keys(RELIEF_GRAINS);
export const hasRelief = (grain) =>
  typeof grain === 'string' && Object.prototype.hasOwnProperty.call(RELIEF_GRAINS, grain);

// ---------- height fields ----------

// A coursed material — anything laid in rows of units with a joint between
// them. `across` units per row, `courses` rows, every other row offset by half
// a unit (running bond), each unit sitting a hair proud or shy of its
// neighbours so a wall is not a grid of identical bricks.
function coursedField(size, { courses, across, joint, bond = 0.5, vary = 0.12, seed }) {
  const rand = reliefRng(seed);
  const faces = new Float32Array(courses * across);
  for (let i = 0; i < faces.length; i++) faces[i] = 1 - rand() * vary;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const row = Math.floor(v * courses);
    const dv = toLine(v, courses);
    const off = (row % 2) * bond;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      // The vertical joints of a course are offset with the course, so the
      // distance is measured in the shifted frame.
      const du = toLine(u - off / across, across);
      const col = wrapi(Math.floor((u - off / across) * across), across);
      const face = faces[wrapi(row, courses) * across + col];
      out[y * size + x] = face * jointFall(dv, joint) * jointFall(du, joint);
    }
  }
  return out;
}

// A material laid in long boards or strips: courses with no vertical joint at
// all, which is what separates plank flooring from tile.
function strippedField(size, { rows, joint, vary, seed, grainAmp = 0 }) {
  const rand = reliefRng(seed);
  const faces = new Float32Array(rows);
  for (let i = 0; i < rows; i++) faces[i] = 1 - rand() * vary;
  // The grain runs *along* the board — two cells across the whole texture in
  // u, forty in v — so it comes out as streaks down the length of a plank.
  const streak = grainAmp > 0
    ? valueNoise(size, 2, reliefRng(seed ^ 0x9e37), 40)
    : null;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const row = wrapi(Math.floor(v * rows), rows);
    const fall = jointFall(toLine(v, rows), joint);
    for (let x = 0; x < size; x++) {
      const g = streak ? (streak[y * size + x] - 0.5) * grainAmp : 0;
      out[y * size + x] = clamp01(faces[row] * fall + g);
    }
  }
  return out;
}

// Scattered discs on a flat matrix: terrazzo aggregate, playground mulch,
// gravel. Each chip is a dome, so the polish catches its curve.
function chipField(size, { chips, rMin, rMax, seed }) {
  const rand = reliefRng(seed);
  const out = new Float32Array(size * size).fill(0.34);
  for (let i = 0; i < chips; i++) {
    const cx = rand() * size, cz = rand() * size;
    const r = rMin + rand() * (rMax - rMin);
    const h = 0.5 + rand() * 0.5;
    const r0 = Math.ceil(r);
    for (let dy = -r0; dy <= r0; dy++) {
      for (let dx = -r0; dx <= r0; dx++) {
        const d = Math.hypot(dx + 0.5, dy + 0.5);
        if (d > r) continue;
        // A dome rather than a disc: the edge of a chip is where it meets the
        // matrix, and a cylinder there reads as a hole punched in the floor.
        // The 0.6 is what keeps the tallest chip inside the field's 0..1.
        const rise = 0.34 + h * 0.6 * Math.sqrt(1 - (d / r) ** 2);
        const idx = wrapi(Math.round(cz) + dy, size) * size + wrapi(Math.round(cx) + dx, size);
        if (rise > out[idx]) out[idx] = rise;
      }
    }
  }
  return out;
}

// Vertical ribs with a shadow groove beside each: standing-seam metal, and the
// one family here that is deliberately asymmetric. The seam is a step, not a
// bump, which is why it reads as folded sheet.
function ribbedField(size, { ribs, seed }) {
  const noise = valueNoise(size, 16, reliefRng(seed));
  const out = new Float32Array(size * size);
  for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size;
    const s = u * ribs;
    const f = s - Math.floor(s);
    // 0..0.16 the standing seam, 0.16..0.30 the shadow beside it, the rest
    // flat pan with the faintest oil-canning across it.
    let h;
    if (f < 0.16) h = 1;
    else if (f < 0.30) h = 0.12;
    else h = 0.52;
    for (let y = 0; y < size; y++) {
      out[y * size + x] = clamp01(h + (noise[y * size + x] - 0.5) * 0.04);
    }
  }
  return out;
}

// Rows of tabs with a butt shadow under each course: asphalt shingle.
function shingleField(size, { courses, tabs, seed }) {
  const rand = reliefRng(seed);
  const lift = new Float32Array(courses * tabs);
  for (let i = 0; i < lift.length; i++) lift[i] = 0.72 + rand() * 0.28;
  const grit = valueNoise(size, 48, reliefRng(seed ^ 0x1d3f));
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const s = v * courses;
    const row = Math.floor(s);
    const f = s - row;
    const off = (row % 2) * 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const tab = wrapi(Math.floor((u - off / tabs) * tabs), tabs);
      // The butt edge of the course above throws a hard line; the tab slots
      // are a softer notch. A shingle roof is mostly those two shadows.
      const butt = smoothstep(clamp01(f / 0.14));
      const slot = jointFall(toLine(u - off / tabs, tabs), 0.006);
      const base = lift[wrapi(row, courses) * tabs + tab];
      out[y * size + x] = clamp01(base * butt * (0.55 + 0.45 * slot)
        + (grit[y * size + x] - 0.5) * 0.12);
    }
  }
  return out;
}

// The height field for one grain family, 0..1, tileable, deterministic.
// `opts.size` is for the suite; nothing in the app passes it.
export function heightField(grain, opts = {}) {
  const size = Math.max(8, Math.round(opts.size || RELIEF_SIZE));
  const fam = RELIEF_GRAINS[grain];
  const seed = (opts.seed ?? (fam ? fam.seed : 1)) >>> 0;
  let data;
  switch (grain) {
    case 'tile':
      // Four one-foot tiles across a 4ft cell, a thin hard joint between them.
      data = coursedField(size, { courses: 4, across: 4, joint: 0.012, bond: 0, vary: 0.10, seed });
      break;
    case 'brick':
      // Running bond at eighteen courses to the 4ft tile, which is a brick.
      data = coursedField(size, { courses: 18, across: 6, joint: 0.010, vary: 0.16, seed });
      break;
    case 'block':
      // 8 x 16 CMU: four times a brick, split face, and a joint you can get a
      // finger into.
      data = coursedField(size, { courses: 6, across: 3, joint: 0.014, vary: 0.10, seed });
      break;
    case 'plank':
      data = strippedField(size, { rows: 8, joint: 0.010, vary: 0.14, seed, grainAmp: 0.18 });
      break;
    case 'rib':
      data = ribbedField(size, { ribs: 12, seed });
      break;
    case 'shingle':
      data = shingleField(size, { courses: 16, tabs: 8, seed });
      break;
    case 'chip':
      data = chipField(size, { chips: Math.round(size * 2.2), rMin: size / 64, rMax: size / 18, seed });
      break;
    case 'fiber': {
      // Carpet pile: high-frequency tufting with a slower unevenness under it,
      // and no seams — see the note on the carpet albedo for why not.
      const fine = valueNoise(size, Math.round(size / 2), reliefRng(seed));
      const slow = valueNoise(size, 8, reliefRng(seed ^ 0x5bd1));
      data = new Float32Array(size * size);
      for (let i = 0; i < data.length; i++) data[i] = clamp01(0.35 + fine[i] * 0.5 + slow[i] * 0.15);
      break;
    }
    case 'mow': {
      // Mown turf: the same tufting at a coarser scale, plus the mower's own
      // bands, which lie the grass one way and then the other.
      const fine = valueNoise(size, Math.round(size / 3), reliefRng(seed));
      data = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        const band = Math.floor(((y + 0.5) / size) * 6) % 2 ? 0.06 : -0.06;
        for (let x = 0; x < size; x++) {
          data[y * size + x] = clamp01(0.5 + (fine[y * size + x] - 0.5) * 0.7 + band);
        }
      }
      break;
    }
    case 'paint': {
      // Painted drywall: orange peel, and the ridge a roller leaves where two
      // passes overlap. Shallow on purpose — see `depth` in the table.
      const peel = valueNoise(size, Math.round(size / 3), reliefRng(seed));
      const passes = valueNoise(size, 5, reliefRng(seed ^ 0x4d09));
      data = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          // The roller runs up the wall, so its unevenness varies across the
          // wall and not along it: one row of the noise, held down the column.
          data[i] = clamp01(0.45 + (peel[i] - 0.5) * 0.55 + (passes[x] - 0.5) * 0.3);
        }
      }
      break;
    }
    case 'speck':
    default: {
      // Sealed concrete, stucco, precast, asphalt: a fine even tooth and
      // nothing more. Also the answer for a grain this file has never met,
      // which is a surface with a texture rather than a surface with a hole.
      const fine = valueNoise(size, Math.round(size / 4), reliefRng(seed));
      const slow = valueNoise(size, 6, reliefRng(seed ^ 0x77a3));
      data = new Float32Array(size * size);
      for (let i = 0; i < data.length; i++) data[i] = clamp01(0.4 + fine[i] * 0.45 + slow[i] * 0.15);
      break;
    }
  }
  return { size, data, grain: hasRelief(grain) ? grain : 'speck' };
}

// ---------- normals ----------

// A height field as tangent-space normals, RGBA bytes, ready for a
// `DataTexture`. Central differences with wrapped neighbours, so the map tiles
// exactly as the field does; `depth` turns the field's 0..1 range into a
// height in texel widths, which is what makes the slope a real slope rather
// than an arbitrary one.
//
// The encoding is the ordinary one: a component of -1..1 becomes a byte of
// 0..255, and a flat surface is (128, 128, 255) — near enough that the suite
// checks the exact value, because "the wall came out slightly blue" is not a
// bug anybody finds by looking.
export function normalTexels(field, opts = {}) {
  const { size, data } = field;
  const depth = Number.isFinite(opts.depth)
    ? opts.depth
    : (RELIEF_GRAINS[field.grain]?.depth ?? 1);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const rowUp = wrapi(y + 1, size) * size;
    const rowDn = wrapi(y - 1, size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xr = wrapi(x + 1, size), xl = wrapi(x - 1, size);
      // Slope per texel, halved because a central difference spans two.
      const du = (data[row + xr] - data[row + xl]) * 0.5 * depth;
      const dv = (data[rowUp + x] - data[rowDn + x]) * 0.5 * depth;
      // The surface normal of a height field is (-dh/du, -dh/dv, 1): where the
      // ground climbs to the right, the face you can see tips to the left.
      const inv = 1 / Math.hypot(du, dv, 1);
      const i = (row + x) * 4;
      out[i] = Math.round((-du * inv * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((-dv * inv * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

// The one call render.js makes: a grain family in, the bytes of its normal map
// out. Never null — every surface has a shape, even if that shape is a tooth
// too fine to see — so the caller has no branch to get wrong.
export function reliefFor(grain, opts = {}) {
  const field = heightField(grain, opts);
  return {
    grain: field.grain,
    size: field.size,
    depth: RELIEF_GRAINS[field.grain].depth,
    texels: normalTexels(field, opts),
  };
}
