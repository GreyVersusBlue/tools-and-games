// The floor plan saved as a PNG (spec 17), from the Building inspector's
// Rooms tab. The picture is the floor plan's own SVG (planImage in
// ui/prints/floor-plan.js): labelled and cropped as the print is, one floor
// or every floor one under the other. It is drawn onto a canvas in the page
// and the canvas is saved; no library, and nothing is fetched but the
// tool's own font files, which go into the picture as data so it reads no
// file of its own.
//
// The size: PNG_SCALE image pixels for each pixel of the picture (48 a cell),
// brought inside the movement picture's caps first (MAX_SIDE 12000 pixels a
// side, MAX_AREA 60 million pixels: fitScale), then stepped down by halves
// while the browser will not give a canvas that large (canvasHolds; WebKit
// stops near 16.7 million pixels), and never under LOWEST_SCALE.
//
//   planPng(project, options) → Promise of
//     { ok: true, blob, fileName, width, height, asked, fell }
//     | { ok: false, text }
//   options.floorId   a floor's id, or 'all'
//   options.now       a Date: the heading's date and the file's name
//   options.holds     (width, height) → boolean, standing for canvasHolds (tests)

import { planImage, IMAGE_FALLBACK_FONT } from '../prints/floor-plan.js';
import { exportFileName } from '../../engine/exports.js';
import { canvasHolds, fitScale, heldScale } from '../movement/export.js';

export const PNG_SCALE = 2;

const FACES = [
  { family: 'Barlow Semi Condensed', weight: 500, file: 'barlow-semi-condensed-latin-500-normal.woff2' },
  { family: 'Barlow Semi Condensed', weight: 600, file: 'barlow-semi-condensed-latin-600-normal.woff2' },
  { family: 'Public Sans', weight: 400, file: 'public-sans-latin-400-normal.woff2' },
  { family: 'Public Sans', weight: 600, file: 'public-sans-latin-600-normal.woff2' },
  { family: 'Public Sans', weight: 700, file: 'public-sans-latin-700-normal.woff2' },
];

let faces = null;

function asDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : null));
    reader.addEventListener('error', () => resolve(null));
    reader.readAsDataURL(blob);
  });
}

// The faces as data URLs, read once they have all been read. A face that
// cannot be read is left out and the picture uses what the browser has
// instead; and then nothing is kept, so the next picture fetches them again
// (SV2-32k: one failed fetch is not the page's answer for the session).
export function planFaces() {
  if (!faces) {
    const asked = Promise.all(FACES.map(async (face) => {
      try {
        const response = await fetch(new URL('../../fonts/' + face.file, import.meta.url).href);
        if (!response.ok) return null;
        const url = await asDataUrl(new Blob([await response.arrayBuffer()], { type: 'font/woff2' }));
        return url ? { family: face.family, weight: face.weight, url } : null;
      } catch (error) {
        return null;
      }
    })).then((list) => {
      if (list.some((face) => face === null) && faces === asked) faces = null;
      return list.filter(Boolean);
    });
    faces = asked;
  }
  return faces;
}

// A heading line's width in ems in the face the picture falls back to, at
// that weight, for a line whose own face could not be read (planImage's
// options.measure). NaN when the page has no canvas to measure with, and
// planImage sizes the line wide instead.
let measurer = null;
function measureFallback(value, weight) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return NaN;
  measurer.font = weight + ' 100px ' + IMAGE_FALLBACK_FONT;
  return measurer.measureText(value).width / 100;
}

// Characters a file system refuses, out of a floor's name in the file's name.
function fileWords(value) {
  return String(value).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60).trim();
}

export async function planPng(project, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : opts.now ? new Date(opts.now) : null;
  const image = planImage(project, { floorId: opts.floorId, now, fonts: await planFaces(), measure: measureFallback });
  if (!image.drawn) {
    const names = image.floors.map((floor) => floor.name);
    return { ok: false, text: 'Nothing is drawn on ' + (names.length === 1 ? names[0] : 'any floor') + ' yet, so there is no plan to save.' };
  }
  const asked = fitScale(image.width, image.height, PNG_SCALE);
  const holds = typeof opts.holds === 'function' ? (w, h) => opts.holds(w, h) === true : (w, h) => canvasHolds(w, h);
  const held = heldScale(image.width, image.height, asked, holds);
  if (held.scale === 0) return { ok: false, text: 'This browser could not make an image of this plan at any size. Print it instead, or save it as a PDF from the print dialog.' };
  const width = Math.round(image.width * held.scale);
  const height = Math.round(image.height * held.scale);

  const source = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml' }));
  let blob = null;
  let drawn = false;
  try {
    const picture = new Image();
    picture.src = source;
    await picture.decode();
    drawn = true;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(picture, 0, 0, width, height);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
  } catch (error) {
    blob = null;
  } finally {
    URL.revokeObjectURL(source);
  }
  // the picture would not decode: the fault is in the picture made from the
  // plan, not the browser's; past that, the canvas would not give a file
  if (!blob && !drawn) return { ok: false, text: 'The picture could not be drawn from this plan. Print the plan instead, or save it as a PDF from the print dialog.' };
  if (!blob) return { ok: false, text: 'The browser could not make the image. Print the plan instead, or save it as a PDF from the print dialog.' };
  const single = image.floors.length === 1 && opts.floorId && opts.floorId !== 'all';
  const what = single ? 'floor plan - ' + (fileWords(image.floors[0].name) || 'floor') : 'floor plan';
  return { ok: true, blob, fileName: exportFileName(project, what, 'png', now), width, height, asked, fell: held.fell };
}
