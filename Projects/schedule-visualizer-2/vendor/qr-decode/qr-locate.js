// Finds a QR code in a luminance frame and samples its modules. Written for
// Schedule Visualizer 2; no code was copied from another QR library.
//
//   locate(luminance, width, height, { blur }) → [{ topLeft, topRight, bottomLeft, module, sizes, bits, width, height }]
//   sampleGrid(candidate, size)      → [{ size, modules }], the ways the grid could be read
//
// The steps: a light blur against sensor noise; a threshold from each 8 × 8
// block's neighbourhood, so uneven light does not matter; the finder
// patterns found as runs of 1:1:3:1:1 across rows, checked down the column
// and across again; the three that make a right angle with two equal sides;
// the module size measured along the code's own axes; then for version 2 and
// up the bottom-right alignment pattern, which gives the fourth corner of a
// perspective transform. Candidates come best first.

import { functionPatterns, formatPositions, versionPositions } from '../qr-encode/qr-core.js';

const BLOCK = 8;

// ---------------------------------------------------------------- threshold

function blurred(luminance, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < height - 1 ? y + 1 : y;
    for (let x = 0; x < width; x += 1) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < width - 1 ? x + 1 : x;
      let sum = 0;
      for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) sum += luminance[yy * width + xx];
      out[y * width + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

// 1 for a dark pixel. Each block's level is its mean, or, where the block is
// flat, something below its darkest pixel (all light) unless its neighbours
// say it sits in a dark area; a pixel is dark at or under the mean level of
// the 5 × 5 blocks round its own.
export function binarise(luminance, width, height) {
  // A block is flat when its range is small beside the frame's own contrast
  // (the 5th to the 95th percentile), so sensor noise on a light background
  // is not read as detail.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < width * height; i += 1) histogram[luminance[i]] += 1;
  const percentile = (share) => {
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v];
      if (seen >= share * width * height) return v;
    }
    return 255;
  };
  const flat = Math.max(24, (percentile(0.95) - percentile(0.05)) * 0.35);
  const across = Math.ceil(width / BLOCK);
  const down = Math.ceil(height / BLOCK);
  const level = new Float64Array(across * down);
  for (let by = 0; by < down; by += 1) {
    for (let bx = 0; bx < across; bx += 1) {
      let min = 255;
      let max = 0;
      let sum = 0;
      let count = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) {
          const v = luminance[y * width + x];
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
          count += 1;
        }
      }
      let value = sum / count;
      if (max - min <= flat) {
        value = min / 2;
        if (by > 0 && bx > 0) {
          const near = (level[(by - 1) * across + bx] + 2 * level[by * across + bx - 1] + level[(by - 1) * across + bx - 1]) / 4;
          if (min < near) value = near;
        }
      }
      level[by * across + bx] = value;
    }
  }
  const bits = new Uint8Array(width * height);
  for (let by = 0; by < down; by += 1) {
    for (let bx = 0; bx < across; bx += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ny = Math.min(down - 1, Math.max(0, by + dy));
          const nx = Math.min(across - 1, Math.max(0, bx + dx));
          sum += level[ny * across + nx];
          count += 1;
        }
      }
      const threshold = sum / count;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) bits[y * width + x] = luminance[y * width + x] <= threshold ? 1 : 0;
      }
    }
  }
  return bits;
}

// ---------------------------------------------------------------- finder patterns

function looksLikeFinder(counts) {
  let total = 0;
  for (const c of counts) {
    if (c === 0) return false;
    total += c;
  }
  if (total < 7) return false;
  const module = total / 7;
  const slack = module * 0.6;
  return Math.abs(module - counts[0]) < slack && Math.abs(module - counts[1]) < slack && Math.abs(3 * module - counts[2]) < 3 * slack && Math.abs(module - counts[3]) < slack && Math.abs(module - counts[4]) < slack;
}

// The five runs through (x, y) along a direction, the centre run holding
// (x, y); null when they do not fit, or are much longer than `most`. Every
// run is walked only as far as it could still fit: the centre to three times
// `most`, the others to `most`. Unbounded, the centre walked a long dark
// line end to end on every row that crossed it, and a frame of stripes cost
// width × height² (SV2-29c: 25 s for one 4K frame).
function runsThrough(bits, width, height, x, y, dx, dy, most) {
  const at = (px, py) => bits[py * width + px];
  const inside = (px, py) => px >= 0 && py >= 0 && px < width && py < height;
  if (!inside(x, y) || !at(x, y)) return null;
  const counts = [0, 0, 0, 0, 0];
  // Backwards: the centre's first half, the light ring, the dark ring.
  let px = x;
  let py = y;
  const centreMost = 3 * most;
  while (inside(px, py) && at(px, py)) {
    counts[2] += 1;
    if (counts[2] > centreMost) return null;
    px -= dx;
    py -= dy;
  }
  while (inside(px, py) && !at(px, py) && counts[1] <= most) { counts[1] += 1; px -= dx; py -= dy; }
  while (inside(px, py) && at(px, py) && counts[0] <= most) { counts[0] += 1; px -= dx; py -= dy; }
  const startX = px + dx;
  const startY = py + dy;
  px = x + dx;
  py = y + dy;
  while (inside(px, py) && at(px, py)) {
    counts[2] += 1;
    if (counts[2] > centreMost) return null;
    px += dx;
    py += dy;
  }
  while (inside(px, py) && !at(px, py) && counts[3] <= most) { counts[3] += 1; px += dx; py += dy; }
  while (inside(px, py) && at(px, py) && counts[4] <= most) { counts[4] += 1; px += dx; py += dy; }
  if (!looksLikeFinder(counts)) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  // The centre run's middle along the line, where pixel i spans [i, i + 1).
  const centre = counts[0] + counts[1] + counts[2] / 2;
  return { counts, total, centre: (dx !== 0 ? startX : startY) + centre };
}

// At most this many places are kept: consider() looks through them all for
// each row that crosses a finder, and a real code has three.
export const FINDERS_MOST = 300;

export function findFinders(bits, width, height) {
  const found = [];
  // A finder is 7 of a symbol's 21 or more modules across, so one wider than
  // half the frame's shorter side belongs to no code the frame holds whole.
  const widest = Math.max(7, Math.min(width, height) / 2);
  const consider = (x, y, horizontal) => {
    if (horizontal.total > widest) return;
    const column = Math.floor(x);
    const vertical = runsThrough(bits, width, height, column, y, 0, 1, horizontal.total);
    if (!vertical || 5 * Math.abs(vertical.total - horizontal.total) >= 3 * horizontal.total) return;
    const cy = vertical.centre;
    const again = runsThrough(bits, width, height, column, Math.floor(cy), 1, 0, horizontal.total * 2);
    if (!again) return;
    const cx = again.centre;
    // One diagonal too, which a stray square of dark rarely passes.
    const diagonal = runsThrough(bits, width, height, Math.floor(cx), Math.floor(cy), 1, 1, again.total * 2);
    if (!diagonal) return;
    const module = (again.total + vertical.total) / 14;
    for (const f of found) {
      if (Math.abs(f.x - cx) <= module * 2 && Math.abs(f.y - cy) <= module * 2 && Math.abs(f.module - module) <= Math.max(1, f.module * 0.5)) {
        f.x = (f.x * f.count + cx) / (f.count + 1);
        f.y = (f.y * f.count + cy) / (f.count + 1);
        f.module = (f.module * f.count + module) / (f.count + 1);
        f.count += 1;
        return;
      }
    }
    if (found.length < FINDERS_MOST) found.push({ x: cx, y: cy, module, count: 1 });
  };
  for (let y = 0; y < height; y += 1) {
    const counts = [0, 0, 0, 0, 0];
    let state = 0;
    const row = y * width;
    for (let x = 0; x <= width; x += 1) {
      const dark = x < width && bits[row + x] === 1;
      if (dark) {
        if (state % 2 === 1) state += 1;
        counts[state] += 1;
      } else if (state % 2 === 0) {
        if (state === 4) {
          if (looksLikeFinder(counts)) {
            const total = counts.reduce((a, b) => a + b, 0);
            consider(x - counts[4] - counts[3] - counts[2] / 2, y, { total });
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        } else {
          state += 1;
          counts[state] += 1;
        }
      } else {
        counts[state] += 1;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------- geometry

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// From a finder's centre along a direction to the outer edge of its dark
// ring: three and a half modules. A change of colour counts once the next
// sample agrees, so a single noisy pixel does not end a run.
function halfWidth(bits, width, height, from, toward) {
  const length = distance(from, toward);
  if (length === 0) return NaN;
  const ux = (toward.x - from.x) / length;
  const uy = (toward.y - from.y) / length;
  const sample = (t) => {
    const x = Math.floor(from.x + ux * t);
    const y = Math.floor(from.y + uy * t);
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return bits[y * width + x];
  };
  let state = 0;
  const wanted = [0, 1, 0];
  for (let t = 0; t < length; t += 0.5) {
    const now = sample(t);
    if (now === -1) return NaN;
    if (state < 3 && now === wanted[state] && sample(t + 0.5) === now) {
      state += 1;
      if (state === 3) return t;
    }
  }
  return NaN;
}

function moduleAlong(bits, width, height, a, b) {
  const away = (p, q) => ({ x: p.x * 2 - q.x, y: p.y * 2 - q.y });
  const parts = [halfWidth(bits, width, height, a, b), halfWidth(bits, width, height, a, away(a, b)), halfWidth(bits, width, height, b, a), halfWidth(bits, width, height, b, away(b, a))].filter((v) => Number.isFinite(v));
  if (parts.length === 0) return NaN;
  return parts.reduce((s, v) => s + v, 0) / parts.length / 3.5;
}

function triples(finders) {
  const out = [];
  for (let i = 0; i < finders.length; i += 1) {
    for (let j = i + 1; j < finders.length; j += 1) {
      for (let k = j + 1; k < finders.length; k += 1) {
        const set = [finders[i], finders[j], finders[k]];
        const modules = set.map((f) => f.module);
        const mean = (modules[0] + modules[1] + modules[2]) / 3;
        if (Math.max(...modules) > mean * 1.6 || Math.min(...modules) < mean / 1.6) continue;
        // The corner is the finder opposite the longest side.
        const sides = [distance(set[1], set[2]), distance(set[0], set[2]), distance(set[0], set[1])];
        const corner = sides.indexOf(Math.max(...sides));
        const legs = sides.filter((_, n) => n !== corner);
        const leg = (legs[0] + legs[1]) / 2;
        if (leg < mean * 7) continue;
        const score = Math.abs(legs[0] - legs[1]) / leg + Math.abs(sides[corner] - leg * Math.SQRT2) / leg + (Math.max(...modules) - Math.min(...modules)) / mean;
        if (score > 0.5) continue;
        const topLeft = set[corner];
        let [topRight, bottomLeft] = set.filter((_, n) => n !== corner);
        const cross = (topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) - (topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x);
        if (cross < 0) [topRight, bottomLeft] = [bottomLeft, topRight];
        out.push({ topLeft, topRight, bottomLeft, score });
      }
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

// options.blur: false skips the blur, for modules of only two or three pixels.
export function locate(luminance, width, height, options) {
  const blur = !(options && options.blur === false);
  const bits = binarise(blur ? blurred(luminance, width, height) : luminance, width, height);
  let finders = findFinders(bits, width, height);
  // A real finder is crossed by many rows; keep the best seen when there are many.
  finders.sort((a, b) => b.count - a.count);
  if (finders.length > 3) finders = finders.filter((f) => f.count >= 2);
  finders = finders.slice(0, 12);
  const out = [];
  for (const t of triples(finders).slice(0, 6)) {
    const across = moduleAlong(bits, width, height, t.topLeft, t.topRight);
    const down = moduleAlong(bits, width, height, t.topLeft, t.bottomLeft);
    const measured = [across, down].filter((v) => Number.isFinite(v));
    const module = measured.length > 0 ? measured.reduce((s, v) => s + v, 0) / measured.length : (t.topLeft.module + t.topRight.module + t.bottomLeft.module) / 3;
    const span = (distance(t.topLeft, t.topRight) + distance(t.topLeft, t.bottomLeft)) / 2;
    let size = Math.round(span / module) + 7;
    if (size % 4 === 0) size += 1;
    else if (size % 4 === 2) size -= 1;
    else if (size % 4 === 3) size -= 2;
    const sizes = [size, size + 4, size - 4, size + 8, size - 8].filter((s) => s >= 21 && s <= 177);
    out.push({ topLeft: t.topLeft, topRight: t.topRight, bottomLeft: t.bottomLeft, module, sizes, bits, width, height });
  }
  return out;
}

// ---------------------------------------------------------------- transforms

// The projective map taking the unit square's corners (0,0), (1,0), (1,1),
// (0,1) to four points, as a 3 × 3 matrix used on row vectors [u, v, 1].
function squareTo(p) {
  const [p0, p1, p2, p3] = p;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [p1.x - p0.x, p1.y - p0.y, 0, p2.x - p1.x, p2.y - p1.y, 0, p0.x, p0.y, 1];
  }
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / det;
  const a23 = (dx1 * dy3 - dx3 * dy1) / det;
  return [p1.x - p0.x + a13 * p1.x, p1.y - p0.y + a13 * p1.y, a13, p3.x - p0.x + a23 * p3.x, p3.y - p0.y + a23 * p3.y, a23, p0.x, p0.y, 1];
}

function adjugate(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}

function multiply(m, n) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) out[r * 3 + c] = m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c];
  return out;
}

// The map taking four points in module space to four in the image.
function quadToQuad(from, to) {
  return multiply(adjugate(squareTo(from)), squareTo(to));
}

function apply(m, u, v) {
  const w = m[2] * u + m[5] * v + m[8];
  return { x: (m[0] * u + m[3] * v + m[6]) / w, y: (m[1] * u + m[4] * v + m[7]) / w };
}

function affine(candidate, size) {
  const { topLeft, topRight, bottomLeft } = candidate;
  const far = size - 3.5;
  const corner = { x: topRight.x + bottomLeft.x - topLeft.x, y: topRight.y + bottomLeft.y - topLeft.y };
  return quadToQuad([{ x: 3.5, y: 3.5 }, { x: far, y: 3.5 }, { x: far, y: far }, { x: 3.5, y: far }], [topLeft, topRight, corner, bottomLeft]);
}

// Places that look like the bottom-right alignment pattern (dark ring,
// light ring, dark centre, 5 × 5 modules), searched for round where the
// three finders put it. Strong tilt can move it many modules from there, as
// far as a neighbouring alignment pattern, so every place that matches is
// kept and the caller tells them apart by how well each fits the symbol.
function alignmentPlaces(candidate, size, guess) {
  const { bits, width, height } = candidate;
  const target = size - 6.5;
  const predicted = apply(guess, target, target);
  const right = apply(guess, target + 1, target);
  const below = apply(guess, target, target + 1);
  const ux = { x: right.x - predicted.x, y: right.y - predicted.y };
  const uy = { x: below.x - predicted.x, y: below.y - predicted.y };
  const module = Math.hypot(ux.x, ux.y);
  if (!(module > 0)) return [];
  const reach = Math.max(4, size / 5) * module;
  const step = Math.max(1, module / 3);
  const hits = [];
  for (let oy = -reach; oy <= reach; oy += step) {
    for (let ox = -reach; ox <= reach; ox += step) {
      const cx = predicted.x + ox;
      const cy = predicted.y + oy;
      let score = 0;
      for (let j = -2; j <= 2 && score >= (j + 2) * 5 - 2; j += 1) {
        for (let i = -2; i <= 2; i += 1) {
          const x = Math.floor(cx + ux.x * i + uy.x * j);
          const y = Math.floor(cy + ux.y * i + uy.y * j);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const dark = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          if (bits[y * width + x] === (dark ? 1 : 0)) score += 1;
        }
      }
      if (score >= 24) hits.push({ x: cx, y: cy, score });
    }
  }
  // One place per pattern: the middle of the hits within a module of each other.
  hits.sort((a, b) => b.score - a.score || distance(a, predicted) - distance(b, predicted));
  const places = [];
  for (const hit of hits) {
    const place = places.find((p) => distance(p.first, hit) <= module * 1.5);
    if (place) {
      if (hit.score === place.first.score) place.members.push(hit);
    } else {
      places.push({ first: hit, members: [hit] });
    }
  }
  return places.slice(0, 8).map((p) => ({ x: p.members.reduce((t, h) => t + h.x, 0) / p.members.length, y: p.members.reduce((t, h) => t + h.y, 0) / p.members.length }));
}

// The share of the symbol's fixed modules (finders, timing lines, alignment
// patterns, the dark module) a transform reads as they must be.
function fit(candidate, size, m) {
  const version = (size - 17) / 4;
  const { modules, reserved } = functionPatterns(version);
  const { bits, width, height } = candidate;
  const skip = new Set();
  for (const copy of formatPositions(size)) for (const [x, y] of copy) skip.add(y * size + x);
  if (version >= 7) for (const copy of versionPositions(size)) for (const [x, y] of copy) skip.add(y * size + x);
  let right = 0;
  let total = 0;
  for (let i = 0; i < size * size; i += 1) {
    if (!reserved[i] || skip.has(i)) continue;
    const x = i % size;
    const p = apply(m, x + 0.5, (i - x) / size + 0.5);
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    total += 1;
    if (px >= 0 && py >= 0 && px < width && py < height && bits[py * width + px] === modules[i]) right += 1;
  }
  return total === 0 ? 0 : right / total;
}

function sampleWith(candidate, size, m) {
  const { bits, width, height } = candidate;
  const modules = new Uint8Array(size * size);
  const offsets = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let dark = 0;
      for (const [ox, oy] of offsets) {
        const p = apply(m, x + ox, y + oy);
        const px = Math.floor(p.x);
        const py = Math.floor(p.y);
        if (px < 0 || py < 0 || px >= width || py >= height) return null;
        dark += bits[py * width + px];
      }
      modules[y * size + x] = dark >= 3 ? 1 : 0;
    }
  }
  return { size, modules };
}

export function sampleGrid(candidate, size) {
  const guess = affine(candidate, size);
  const ways = [{ m: guess, fit: fit(candidate, size, guess) }];
  if (size > 21) {
    const far = size - 3.5;
    const target = size - 6.5;
    for (const place of alignmentPlaces(candidate, size, guess)) {
      const m = quadToQuad([{ x: 3.5, y: 3.5 }, { x: far, y: 3.5 }, { x: target, y: target }, { x: 3.5, y: far }], [candidate.topLeft, candidate.topRight, place, candidate.bottomLeft]);
      ways.push({ m, fit: fit(candidate, size, m) });
    }
  }
  ways.sort((a, b) => b.fit - a.fit);
  const out = [];
  for (const way of ways.slice(0, 3)) {
    if (way.fit < 0.7) break;
    const grid = sampleWith(candidate, size, way.m);
    if (grid) out.push(grid);
  }
  return out;
}
