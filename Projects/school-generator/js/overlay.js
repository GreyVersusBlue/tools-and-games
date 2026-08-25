// overlay.js — the tracing paper: an image under the plan, scaled by measuring
// something on it.
//
// This is the part of Phase 8 that isn't generation at all. It is the other
// way somebody arrives with a school already in mind — a scan of a real
// building's floor plan, a photo of a hand sketch, a screenshot of a site map
// — and wants to draw *on* it rather than describe it. A generator says "give
// me a brief"; an overlay says "here is the plan, put the walls where the
// lines are".
//
// ## Scaling by measurement
//
// An image arrives with no idea how big it is. A PNG of a floor plan is 2400
// pixels wide and that is all anybody knows; the drawing on it might be a
// classroom or a campus. Every automatic answer to this is a guess, so there
// isn't one: **you measure something you know the length of, and then you say
// what that length is.** Click the two ends of a door, type 3 feet, and the
// image is scaled — one division, no fitting, no ambiguity, and the number
// that comes out is checkable by measuring something else.
//
//   scale = feet ÷ pixels-between-the-two-points        (ft per pixel)
//
// The calibration points are kept, in *image* pixel coordinates, so they
// survive a save, a re-scale and a move: the measurement is a fact about the
// picture, not about where the picture currently sits.
//
// ## Coordinates
//
// An overlay is positioned by its centre, in world feet, with a rotation. The
// image's own axes are (u, v) in pixels from its top-left, and v increases the
// way world +z does — the edit view looks straight down with +z toward the
// bottom of the screen, so an image dropped in unrotated reads the same way up
// as it does in a picture viewer. Everything else is one rotation and one
// scale, which is why `imageToWorld` and `worldToImage` are exact inverses and
// are tested as such.
//
// ## What it costs
//
// The image lives in the design, as a data URL, so a saved file carries its
// own tracing paper and a design mailed to somebody else still has it. That is
// the right call and it is not free: it is the first thing this format has
// ever stored that is measured in megabytes rather than in kilobytes, which is
// why the tool re-encodes on import, why `MAX_BYTES` exists, and why
// `serialize` can be asked to leave the overlay out when localStorage refuses
// the whole design.
//
// Pure module: no three.js, no DOM, no image decoding — the tool hands it a
// data URL and the pixel dimensions. Exercised by test/overlay.test.mjs.

// The image formats a browser will decode into a texture, and deliberately not
// PDF: a PDF is a document with pages and a page size, and turning one into a
// bitmap is a dependency this project doesn't have.
export const TYPES = ['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif', 'bmp'];
const DATA_URL = /^data:image\/([a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+$/i;

// Three megabytes of base64 is about two of image, which is a 2048px WebP with
// room to spare. Past that a design stops fitting in localStorage and the
// autosave starts failing silently, which is a worse problem than a picture
// that had to be resampled.
export const MAX_BYTES = 3 * 1024 * 1024;
// What the tool resamples an import down to before encoding it.
export const MAX_PIXELS = 2048;

export const MIN_SCALE = 0.0005;   // ft per pixel — a 2000px image at 1ft wide
export const MAX_SCALE = 20;       // ...and one at 40,000ft
export const MIN_CAL_PX = 4;       // a measurement shorter than this is a mis-click
export const MIN_CAL_FT = 0.05;
export const MAX_CAL_FT = 20000;

// Every storey, rather than one of them. A site plan is not a fact about
// Level 1, and it is the common case.
export const ALL_FLOORS = -1;

export const DEFAULT_OPACITY = 0.55;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export function imageTypeOf(src) {
  const m = DATA_URL.exec(String(src || ''));
  return m ? m[1].toLowerCase() : null;
}

export const isSupportedImage = (src) => {
  const t = imageTypeOf(src);
  return !!t && TYPES.includes(t === 'jpg' ? 'jpeg' : t);
};

// ---------- the record ----------

// A fresh overlay for an image that has just been decoded. It arrives
// uncalibrated: `scale` starts at one foot per pixel divided by nothing in
// particular — a hundred feet across, which is a building — and says so, so
// nothing pretends the picture came with a scale on it.
export function makeOverlay(src, w, h, opts = {}) {
  if (!isSupportedImage(src)) return null;
  const pw = Math.max(1, Math.round(num(w, 0)));
  const ph = Math.max(1, Math.round(num(h, 0)));
  if (!pw || !ph) return null;
  const scale = num(opts.scale, clamp(100 / pw, MIN_SCALE, MAX_SCALE));
  return normalizeOverlay({
    src,
    w: pw,
    h: ph,
    x: num(opts.x, 0),
    z: num(opts.z, 0),
    scale,
    rot: num(opts.rot, 0),
    opacity: num(opts.opacity, DEFAULT_OPACITY),
    floor: opts.floor === undefined ? ALL_FLOORS : opts.floor,
    locked: !!opts.locked,
    // No `cal` — an uncalibrated overlay is one nobody has measured, and the
    // panel says so rather than showing a scale it invented.
  });
}

// Never throws, never half-reads: an overlay that isn't usable comes back as
// null and the design simply has no tracing paper in it. Same promise
// `normalizeEnv` and `normalizeTerrain` make about their own records.
export function normalizeOverlay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = typeof raw.src === 'string' ? raw.src.trim() : '';
  if (!isSupportedImage(src)) return null;
  if (src.length > MAX_BYTES) return null;
  const w = Math.round(num(raw.w, 0));
  const h = Math.round(num(raw.h, 0));
  if (!(w > 0) || !(h > 0)) return null;
  const out = {
    src,
    w: Math.min(16384, w),
    h: Math.min(16384, h),
    x: clamp(num(raw.x, 0), -100000, 100000),
    z: clamp(num(raw.z, 0), -100000, 100000),
    scale: clamp(num(raw.scale, 0.1), MIN_SCALE, MAX_SCALE),
    // A rotation wraps rather than clamps, the way sky.js's bearing does.
    rot: ((num(raw.rot, 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    opacity: clamp(num(raw.opacity, DEFAULT_OPACITY), 0.05, 1),
    floor: Number.isInteger(raw.floor) && raw.floor >= 0 ? raw.floor : ALL_FLOORS,
    locked: !!raw.locked,
  };
  const cal = normalizeCalibration(raw.cal, out);
  if (cal) out.cal = cal;
  return out;
}

// The measurement: two points on the picture and how far apart they really
// are. Kept in image pixels so it stays true through a move or a rescale.
function normalizeCalibration(raw, o) {
  if (!raw || typeof raw !== 'object') return null;
  const a = normalizePoint(raw.a, o);
  const b = normalizePoint(raw.b, o);
  const ft = num(raw.ft, 0);
  if (!a || !b || !(ft >= MIN_CAL_FT) || ft > MAX_CAL_FT) return null;
  if (Math.hypot(b.u - a.u, b.v - a.v) < MIN_CAL_PX) return null;
  return { a, b, ft };
}

function normalizePoint(p, o) {
  if (!p || typeof p !== 'object') return null;
  const u = num(p.u, NaN), v = num(p.v, NaN);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  // Allowed a little way outside the image: somebody measuring the full width
  // of a scan will click its edges, and rounding shouldn't reject that.
  return { u: clamp(u, -o.w, o.w * 2), v: clamp(v, -o.h, o.h * 2) };
}

export const hasOverlay = (state) => !!(state && state.overlay && state.overlay.src);

// ---------- geometry ----------

export const overlaySize = (o) => (o
  ? { w: o.w * o.scale, d: o.h * o.scale }
  : { w: 0, d: 0 });

// Image pixels to world feet. The centre of the image sits at (x, z); (u, v)
// is measured from the top-left corner, and v runs the way world +z does.
export function imageToWorld(o, u, v) {
  const du = (u - o.w / 2) * o.scale;
  const dv = (v - o.h / 2) * o.scale;
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return { x: o.x + du * c - dv * s, z: o.z + du * s + dv * c };
}

// ...and back. The exact inverse of `imageToWorld`, which is the property the
// tool depends on when it turns a click on the canvas into a point on the
// picture.
export function worldToImage(o, x, z) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = x - o.x, dz = z - o.z;
  const du = dx * c + dz * s;
  const dv = -dx * s + dz * c;
  return { u: du / o.scale + o.w / 2, v: dv / o.scale + o.h / 2 };
}

// The four corners in world feet, clockwise from the image's top-left — what
// the renderer's plane and the tool's outline are both drawn from.
export function overlayCorners(o) {
  if (!o) return [];
  return [
    imageToWorld(o, 0, 0),
    imageToWorld(o, o.w, 0),
    imageToWorld(o, o.w, o.h),
    imageToWorld(o, 0, o.h),
  ];
}

// ---------- calibration ----------

// The one division this whole file exists for. `a` and `b` are image pixel
// coordinates; `feet` is what the person says that distance is. The image is
// rescaled about its own centre, so the picture stays where it was on screen
// and grows or shrinks around it rather than sliding away from the cursor.
export function calibrate(o, a, b, feet) {
  if (!o) return { overlay: o, ok: false, reason: 'No overlay to scale.' };
  const px = Math.hypot(b.u - a.u, b.v - a.v);
  if (!(px >= MIN_CAL_PX)) {
    return { overlay: o, ok: false, reason: 'Those two points are on top of each other.' };
  }
  const ft = num(feet, NaN);
  if (!(ft >= MIN_CAL_FT) || ft > MAX_CAL_FT) {
    return { overlay: o, ok: false, reason: 'Give the measured distance in feet.' };
  }
  const scale = clamp(ft / px, MIN_SCALE, MAX_SCALE);
  const clamped = Math.abs(scale - ft / px) > 1e-9;
  const overlay = normalizeOverlay({
    ...o,
    scale,
    cal: { a: { u: a.u, v: a.v }, b: { u: b.u, v: b.v }, ft },
  });
  return {
    overlay: overlay || o,
    ok: !!overlay,
    clamped,
    scale,
    // What the picture turns out to be, which is the sanity check a person
    // actually reads: "that scan is 312ft across".
    size: overlaySize(overlay || o),
    reason: clamped ? 'That scale is outside what an overlay can hold; it was clipped.' : null,
  };
}

// The measurement as it stands, for the panel: how long the line is on the
// picture, what it was called, and what one foot is worth in pixels.
export function calibrationOf(o) {
  if (!o || !o.cal) return null;
  const px = Math.hypot(o.cal.b.u - o.cal.a.u, o.cal.b.v - o.cal.a.v);
  return {
    px,
    ft: o.cal.ft,
    pxPerFt: o.cal.ft > 0 ? px / o.cal.ft : 0,
    a: imageToWorld(o, o.cal.a.u, o.cal.a.v),
    b: imageToWorld(o, o.cal.b.u, o.cal.b.v),
  };
}

// ---------- placement ----------

export function moveOverlay(o, dx, dz) {
  if (!o || o.locked) return o;
  return normalizeOverlay({ ...o, x: o.x + dx, z: o.z + dz }) || o;
}

export function rotateOverlay(o, delta) {
  if (!o || o.locked) return o;
  return normalizeOverlay({ ...o, rot: o.rot + delta }) || o;
}

export const setOverlay = (o, patch) => (o ? normalizeOverlay({ ...o, ...patch }) || o : o);

// Drop the picture over a rectangle of world feet — used when an image is
// first loaded, so it lands on the building rather than at the origin.
export function centreOn(o, bounds) {
  if (!o || !bounds) return o;
  return setOverlay(o, {
    x: (bounds.x0 + bounds.x1) / 2,
    z: (bounds.z0 + bounds.z1) / 2,
  });
}

// Whether the overlay shows on a given storey.
export const showsOn = (o, floorIndex) => !!o && (o.floor === ALL_FLOORS || o.floor === floorIndex);

// A short line for the panel and the status bar: what the picture is, how big
// it turned out, and whether anybody has measured it.
export function describeOverlay(o) {
  if (!o) return 'No overlay loaded.';
  const size = overlaySize(o);
  const type = (imageTypeOf(o.src) || 'image').toUpperCase();
  const dims = `${Math.round(size.w).toLocaleString()} × ${Math.round(size.d).toLocaleString()} ft`;
  if (!o.cal) return `${type} ${o.w}×${o.h}px — ${dims}, not measured yet`;
  const cal = calibrationOf(o);
  return `${type} ${o.w}×${o.h}px — ${dims}, ${cal.ft.toLocaleString()} ft measured over ` +
    `${Math.round(cal.px)} px`;
}
