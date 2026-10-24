// Tracing a real floor plan (spec 4.7): a photo or scan of one floor, lying
// faintly under the grid to draw over.
//
// The image's bytes are stored once on the device (ctx.storage.putImage) and
// the floor names them by id; what the project holds is the TraceImage of
// ARCHITECTURE 4, and this file is the one place that says what its numbers
// mean:
//
//   width, height   the stored image, in pixels
//   scale           cells per image pixel: the image is drawn scale × width
//                   cells wide and scale × height cells high
//   x, y            the top left corner of the image before it is turned, in
//                   cells from the floor's top left corner
//   rotation        degrees clockwise, about the middle of the image
//   opacity         0 to 1
//
// tracePlacement(image) turns those into a box in cells; the plan on screen
// draws from it (the renderer's underlay hook), and a plan on paper can too.
//
// The first part of this file is pure and has no DOM in it: the arithmetic.
// The action that sets a floor's TraceImage is setTraceImage in
// engine/actions.js, with the other building actions; it is handed on from
// here so what imported it from this file still finds it.

import { setTraceImage, placeTraceImage, fitFloorToImage, floorForImage, DEFAULT_TRACE_OPACITY } from '../../engine/actions.js';
import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { singleKeyAllowed } from '../components/shortcuts.js';
import { checkField, decimal, heading } from './inspector/controls.js';
import { createScaleTool, floorPoint, MOST_CELLS } from './scale-tool.js';

export { setTraceImage };

// ---------------------------------------------------------------- pure

// A larger image is reduced on import until its longer side is this many
// pixels. A 200-cell floor drawn at 100% is 4,800 pixels across, and an
// underlay at 40% opacity needs a third of that at most.
export const MAX_SIDE = 1600;
export const DEFAULT_OPACITY = DEFAULT_TRACE_OPACITY;
// What shows through the clear parts of a transparent image.
export const BACKING = '#ffffff';

// The size an image is stored at: { width, height, reduced }. The shape is
// kept; neither side goes under one pixel.
export function reducedSize(width, height, max) {
  const limit = max === undefined ? MAX_SIDE : max;
  const longer = Math.max(width, height);
  if (longer <= limit) return { width, height, reduced: false };
  const factor = limit / longer;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), reduced: true };
}

// Where a new image goes, and "Fit the image to the floor": as large as fits
// whole on the floor, in its middle, turned as it is (`rotation` degrees,
// none for a new image).
export function fitPlacement(floor, width, height, rotation) {
  const turn = ((rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const scale = Math.min(floor.width / (width * cos + height * sin), floor.height / (width * sin + height * cos));
  return { scale, x: (floor.width - width * scale) / 2, y: (floor.height - height * scale) / 2, rotation: rotation || 0 };
}

// The image's four corners, in its own pixels, clockwise from its top left
// as stored: what a corner handle is named by (0 to 3).
export function cornerPixels(image) {
  return [{ u: 0, v: 0 }, { u: image.width, v: 0 }, { u: image.width, v: image.height }, { u: 0, v: image.height }];
}

// The image's corners on the floor, in cells, in cornerPixels' order.
export function cornersOf(image) {
  return cornerPixels(image).map((corner) => floorPoint(image, corner));
}

// A resized image's scale kept between one cell across and MOST_CELLS.
function heldScale(image, scale) {
  const longer = Math.max(image.width, image.height);
  return Math.min(MOST_CELLS / longer, Math.max(1 / longer, scale));
}

// The image resized about one place on it (`about`, in its pixels), which
// stays where it is on the floor: { scale, x, y }, the turn kept.
export function scaledAbout(image, about, scale) {
  const kept = floorPoint(image, about);
  const landed = floorPoint({ ...image, scale, x: 0, y: 0 }, about);
  return { scale, x: kept.x - landed.x, y: kept.y - landed.y };
}

// A corner handle (0 to 3, cornerPixels' order) dragged to `at` (cells): the
// image resized with its shape kept, about the opposite corner, or about its
// middle with `centre` (Shift held). The corner follows the pointer along the
// image's diagonal. { scale, x, y }, the turn kept.
export function cornerPlacement(image, corner, at, centre) {
  const corners = cornerPixels(image);
  const grabbed = corners[corner];
  const about = centre ? { u: image.width / 2, v: image.height / 2 } : corners[(corner + 2) % 4];
  const fixed = floorPoint(image, about);
  // the pointer from the fixed place, turned back into the image's own frame
  const turn = (image.rotation * Math.PI) / 180;
  const dx = at.x - fixed.x;
  const dy = at.y - fixed.y;
  const along = { u: dx * Math.cos(turn) + dy * Math.sin(turn), v: -dx * Math.sin(turn) + dy * Math.cos(turn) };
  const diagonal = { u: grabbed.u - about.u, v: grabbed.v - about.v };
  const scale = heldScale(image, (along.u * diagonal.u + along.v * diagonal.v) / (diagonal.u * diagonal.u + diagonal.v * diagonal.v));
  return scaledAbout(image, about, scale);
}

// + and - while moving: the image `factor` times as large, about its middle.
export function steppedPlacement(image, factor) {
  return scaledAbout(image, { u: image.width / 2, v: image.height / 2 }, heldScale(image, image.scale * factor));
}

// How much + and - resize the image by.
export const STEP = 1.05;

// The corner handles: drawn this many CSS pixels square, and caught this far
// from a corner by a mouse or pen, and by a finger (DESIGN 6's 40 px margin
// round a selection, near enough).
const HANDLE_DRAWN = 10;
const HANDLE_MOUSE = 10;
const HANDLE_TOUCH = 22;

const MOVING_HINT = 'Drag the image to where it belongs, or a corner to resize it (with Shift, about its middle); + and - resize it too. Escape, or Done, when it is in place.';

// The box a traced image is drawn in, in cells: its top left corner, its
// size, its middle (the point it is turned about), the turn in degrees and
// the opacity. Null when there is no image.
export function tracePlacement(image) {
  if (!image) return null;
  const w = image.width * image.scale;
  const hgt = image.height * image.scale;
  return { x: image.x, y: image.y, w, h: hgt, cx: image.x + w / 2, cy: image.y + hgt / 2, rotation: image.rotation, opacity: image.opacity };
}

// ---------------------------------------------------------------- on the page

// Read a chosen file as an image and reduce it for keeping:
// { blob, type, width, height, reduced, from: { width, height } }.
// A file that is already small enough and already a JPEG is kept byte for
// byte. Anything else is drawn on a light backing (so a transparent scan is
// not dark on a dark theme) and stored as a JPEG.
export async function reduceImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error('That file could not be read as an image. Choose a photo or a scan of the plan: a PNG or a JPEG.');
  }
  const from = { width: bitmap.width, height: bitmap.height };
  const size = reducedSize(from.width, from.height, MAX_SIDE);
  if (!size.reduced && file.type === 'image/jpeg') {
    bitmap.close();
    return { blob: file.slice(0, file.size, file.type), type: file.type, width: from.width, height: from.height, reduced: false, from };
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  g.fillStyle = BACKING;
  g.fillRect(0, 0, size.width, size.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('This browser could not reduce that image. Try a smaller one.');
  return { blob, type: 'image/jpeg', width: size.width, height: size.height, reduced: size.reduced, from };
}

const round = (value, places) => {
  const unit = 10 ** places;
  return Math.round(value * unit) / unit;
};

// createTrace(ed, ctx) -> { underlay, controls: { element, update(floor) }, importFile(file), choose(), detach() }
//   underlay(g, view, floor)   for the renderer's hook
//   controls                   the part of the inspector's Floor tab
//   choose()                   open the file chooser
export function createTrace(ed, ctx) {
  // imageId -> an ImageBitmap, 'loading', or 'missing'
  const bitmaps = new Map();
  // what a drag or a slider is showing before it is kept: { floorId, … }
  let live = null;
  let moving = false;
  let drag = null;
  let shown = null;
  // "Use another image" was pressed: the next file is a new image, fitted afresh
  let replacing = false;

  function imageOf(floor) {
    if (!floor.image) return null;
    return live && live.floorId === floor.id ? { ...floor.image, ...live.image } : floor.image;
  }

  function load(imageId) {
    if (bitmaps.has(imageId)) return;
    bitmaps.set(imageId, 'loading');
    Promise.resolve()
      .then(() => ctx.storage.getImage(imageId))
      .then((value) => (value && value.blob ? createImageBitmap(value.blob) : null))
      .then((bitmap) => {
        bitmaps.set(imageId, bitmap || 'missing');
      }, () => {
        bitmaps.set(imageId, 'missing');
      })
      .then(() => {
        ed.schedule();
        if (shown) update(ed.floor);
      });
  }

  function isMissing(image) {
    return image.missing === true || bitmaps.get(image.imageId) === 'missing';
  }

  function underlay(g, view, floor) {
    const image = imageOf(floor);
    if (!image || !image.visible) return;
    const bitmap = bitmaps.get(image.imageId);
    if (!bitmap) {
      load(image.imageId);
      return;
    }
    if (typeof bitmap === 'string') return;
    const place = tracePlacement(image);
    const size = view.size;
    g.globalAlpha = place.opacity;
    g.translate(view.x + place.cx * size, view.y + place.cy * size);
    g.rotate((place.rotation * Math.PI) / 180);
    g.drawImage(bitmap, (-place.w * size) / 2, (-place.h * size) / 2, place.w * size, place.h * size);
  }

  function say(text) {
    ctx.announce(text);
  }

  function apply(image, done) {
    return ed.commit(setTraceImage, { floorId: ed.floor.id, image }, { done: () => done, toast: null });
  }

  // ---------------------------------------------------------- import

  const fileInput = h('input', { type: 'file', id: 'trace-file', class: 'vh', accept: 'image/*', tabindex: '-1', 'aria-label': 'An image of this floor\'s plan' });

  async function importFile(file) {
    const another = replacing;
    replacing = false;
    let reduced;
    try {
      reduced = await reduceImage(file);
    } catch (error) {
      ctx.toast({ kind: 'problem', text: error.message });
      say(error.message);
      return null;
    }
    const floor = ed.floor;
    // the same file again for an image this device has lost: it goes back
    // where it was, under the id the floor already names
    const again = !another && floor.image && isMissing(floor.image) ? floor.image : null;
    const imageId = again ? again.imageId : ctx.ids('i');
    try {
      await ctx.storage.putImage(imageId, { blob: reduced.blob, type: reduced.type, width: reduced.width, height: reduced.height });
    } catch (error) {
      const message = 'The image could not be kept on this device: ' + (error && error.message ? error.message : 'the browser refused it') + '. Free some space, or try a smaller image.';
      ctx.toast({ kind: 'problem', text: message });
      say(message);
      return null;
    }
    bitmaps.set(imageId, await createImageBitmap(reduced.blob));
    const how = reduced.reduced ? ', reduced from ' + reduced.from.width + ' × ' + reduced.from.height + ' to ' + reduced.width + ' × ' + reduced.height + ' pixels' : '';
    let sentence;
    if (again) {
      // at the width it had, whatever size the file is this time
      ed.store.apply(setTraceImage, { floorId: floor.id, image: { width: reduced.width, height: reduced.height, scale: (again.scale * again.width) / reduced.width, missing: false } });
      sentence = 'The image of ' + floor.name + ' is back where it was' + how + '.';
    } else {
      const image = { imageId, width: reduced.width, height: reduced.height, opacity: floor.image ? floor.image.opacity : DEFAULT_OPACITY, visible: true, locked: false, missing: false, ...fitPlacement(floor, reduced.width, reduced.height) };
      ed.store.apply(setTraceImage, { floorId: floor.id, image });
      sentence = (another ? 'Another image lies under ' + floor.name + ' now' : 'The image lies under ' + floor.name) + how + '. Draw over it.';
    }
    ctx.toast({ text: sentence, action: { label: 'Undo', run: ctx.undo } });
    say(sentence);
    ed.schedule();
    update(ed.floor);
    return imageId;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) importFile(file);
  });

  // choose(true): the file is another image for a floor that has one
  function choose(another) {
    replacing = another === true;
    fileInput.click();
  }

  // ---------------------------------------------------------- moving by a drag

  const canvas = ed.canvas;

  function setMoving(on) {
    if (moving === on) return;
    if (on) scaling.cancel(false);
    moving = on;
    drag = null;
    live = null;
    if (on) {
      canvas.dataset.tracing = 'true';
      ed.setHint(MOVING_HINT);
      say('Drag the image to where it belongs, or a corner to resize it. + and - resize it too. Escape when it is in place.');
    } else {
      delete canvas.dataset.tracing;
      ed.setHint(ed.tool.hint);
    }
    if (shown) update(ed.floor);
    ed.schedule();
    modeChanged();
  }

  // Scaling, placing or moving began or ended: the empty floor's note steps
  // aside while any of them lasts (ui/building/index.js).
  function modeChanged() {
    if (typeof ed.placeCard === 'function') ed.placeCard();
  }

  // Which corner handle, if any, is under a press at (sx, sy) on the canvas:
  // 0 to 3 (cornerPixels' order), or -1. A finger gets a larger reach.
  function handleAt(image, sx, sy, type) {
    const reach = type === 'touch' ? HANDLE_TOUCH : HANDLE_MOUSE;
    const size = ed.view.size;
    let best = -1;
    let nearest = Infinity;
    cornersOf(image).forEach((corner, i) => {
      const apart = Math.hypot(ed.view.x + corner.x * size - sx, ed.view.y + corner.y * size - sy);
      if (apart <= reach && apart < nearest) {
        best = i;
        nearest = apart;
      }
    });
    return best;
  }

  // Where the pointer is, in cells on the floor.
  function cellOf(event) {
    const rect = canvas.getBoundingClientRect();
    return ed.view.toCell(event.clientX - rect.left, event.clientY - rect.top);
  }

  function widthWords(image) {
    return 'The image is ' + round(image.scale * image.width, 1) + ' cells wide.';
  }

  // One step of the image's scale, turn or place, refused while locked.
  function place(image, how, words) {
    return ed.commit(placeTraceImage, { floorId: ed.floor.id, image, how }, { done: () => words, toast: null });
  }

  function onDown(event) {
    if (!moving || event.button !== 0) return;
    const floor = ed.floor;
    if (!floor.image || floor.image.locked) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (drag) {
      // a second finger: the drag is called off, nothing kept
      drag.off = true;
      live = null;
      ed.schedule();
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) { /* a synthetic pointer has nothing to capture */ }
    const rect = canvas.getBoundingClientRect();
    const corner = handleAt(floor.image, event.clientX - rect.left, event.clientY - rect.top, event.pointerType);
    // a handle caught a little off its corner keeps that offset, so the corner does not jump to the pointer
    const pressed = cellOf(event);
    const grabbed = corner === -1 ? pressed : cornersOf(floor.image)[corner];
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: floor.image.x, y: floor.image.y, floorId: floor.id, corner, image: floor.image, off: false, dx: grabbed.x - pressed.x, dy: grabbed.y - pressed.y };
    canvas.dataset.dragging = corner === -1 ? 'image' : 'corner';
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopImmediatePropagation();
    if (drag.off) return;
    if (drag.corner !== -1) {
      const at = cellOf(event);
      live = { floorId: drag.floorId, image: cornerPlacement(drag.image, drag.corner, { x: at.x + drag.dx, y: at.y + drag.dy }, event.shiftKey) };
    } else {
      const size = ed.view.size;
      live = { floorId: drag.floorId, image: { x: round(drag.x + (event.clientX - drag.sx) / size, 2), y: round(drag.y + (event.clientY - drag.sy) / size, 2) } };
    }
    ed.schedule();
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopImmediatePropagation();
    const kept = drag.off ? null : live;
    const corner = drag.corner;
    drag = null;
    live = null;
    delete canvas.dataset.dragging;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) { /* already let go */ }
    if (kept && event.type === 'pointerup') {
      if (corner === -1) apply(kept.image, 'Moved the image.');
      else place(kept.image, 'corner', 'Resized the image. ' + widthWords({ ...ed.floor.image, ...kept.image }));
    }
    ed.schedule();
  }

  function onKey(event) {
    if (!moving) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMoving(false);
    } else if ((event.key === '+' || event.key === '-') && singleKeyAllowed(event) && !drag) {
      // + and - resize the image about its middle, 5 % a press
      const image = ed.floor.image;
      if (!image || image.locked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = steppedPlacement(image, event.key === '+' ? STEP : 1 / STEP);
      const words = widthWords({ ...image, ...next });
      if (next.scale === image.scale) {
        say((event.key === '+' ? 'The image is as large as it can be. ' : 'The image is as small as it can be. ') + words);
        return;
      }
      place(next, 'keys', words);
    }
  }

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  // on the window, ahead of everything in the page: Escape here is this mode's
  window.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------- the corner handles

  // While moving, the image's edge as a thin line and a square handle at each
  // corner, over the plan; a finger reaches HANDLE_TOUCH pixels round each.
  function handles(g, view, floor, theme) {
    if (!moving || floor.id !== ed.floor.id) return;
    const image = imageOf(floor);
    if (!image || image.locked || !image.visible) return;
    const size = view.size;
    const corners = cornersOf(image).map((at) => ({ sx: view.x + at.x * size, sy: view.y + at.y * size }));
    g.setLineDash([]);
    for (const [width, colour] of [[4, theme.paper], [1.5, theme.accent]]) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      corners.forEach((at, i) => (i === 0 ? g.moveTo(at.sx, at.sy) : g.lineTo(at.sx, at.sy)));
      g.closePath();
      g.stroke();
    }
    for (const at of corners) {
      g.fillStyle = theme.paper;
      g.fillRect(at.sx - HANDLE_DRAWN / 2 - 2, at.sy - HANDLE_DRAWN / 2 - 2, HANDLE_DRAWN + 4, HANDLE_DRAWN + 4);
      g.fillStyle = theme.accent;
      g.fillRect(at.sx - HANDLE_DRAWN / 2, at.sy - HANDLE_DRAWN / 2, HANDLE_DRAWN, HANDLE_DRAWN);
    }
  }
  ed.overlays.push(handles);

  // ---------------------------------------------------------- scaling from a length, placing by two points (./scale-tool.js)

  const scaling = createScaleTool(ed, ctx, { stopMoving: () => setMoving(false), isMissing, changed: modeChanged });
  ed.overlays.push(scaling.overlay);

  // ---------------------------------------------------------- the controls

  // "Fit the floor to the image": the floor's edges move to the image's box,
  // rounded out to whole cells, after asking; refused, with the reason, when
  // that would cut anything drawn (engine/actions.js fitFloorToImage).
  async function fitFloor(opener) {
    const floor = ed.floor;
    if (!floor.image) return;
    const tried = ed.attempt(() => fitFloorToImage(ed.project, { floorId: floor.id }, { ids: ctx.ids, clock: ctx.clock }));
    if (!tried) return;
    if (tried === ed.project) {
      say(floor.name + ' is already the size of its image, ' + floor.width + ' × ' + floor.height + ' cells.');
      ctx.toast({ text: floor.name + ' is already the size of its image.' });
      return;
    }
    const size = floorForImage(floor, floor.image);
    const ok = await ctx.confirm({
      title: 'Make ' + floor.name + ' ' + size.width + ' × ' + size.height + ' cells, the size of its image?',
      body: 'Its edges move to the edges of the image, rounded out to whole cells. Nothing drawn is cut, and the drawing stays where it is on the image.',
      action: 'Make it ' + size.width + ' × ' + size.height,
      keep: 'Keep ' + floor.width + ' × ' + floor.height,
      opener,
    });
    if (!ok || ed.floor.id !== floor.id) return;
    const done = ed.commit(fitFloorToImage, { floorId: floor.id }, { done: (outcome) => floor.name + ' is ' + outcome.width + ' × ' + outcome.height + ' cells now, the size of its image.', toast: (outcome) => floor.name + ' is ' + outcome.width + ' × ' + outcome.height + ' cells now, the size of its image.' });
    if (done) ed.schedule();
  }

  const element = h('section', { class: 'bi-part', id: 'trace', 'aria-labelledby': 'trace-heading' });
  let controls = null;

  function build(floor) {
    const title = heading('Trace over a floor plan', 'trace-heading');
    if (!floor.image) {
      controls = null;
      element.replaceChildren(
        title,
        h('p', null, 'Choose a photo or a scan of this floor\'s plan, and it lies faintly under the grid for you to draw over.'),
        h('p', { class: 'bld-inspector__small' }, 'A large image is made smaller first. The image is saved with the project and goes into a project file. It is never in a published staff file.'),
        h('div', { class: 'bi-buttons' }, h('button', { type: 'button', class: 'btn', id: 'trace-choose', data: { key: 'trace-choose' }, on: { click: choose } }, 'Choose an image…')),
        fileInput,
      );
      return;
    }
    const image = floor.image;
    const patchWith = (image2, done) => {
      ed.store.apply(setTraceImage, { floorId: ed.floor.id, image: image2 });
      say(done);
    };
    const missing = h('div', { class: 'bi-notice bi-notice--problem', id: 'trace-missing', hidden: true },
      h('p', null, 'The image for this floor is not on this device. Where it goes is kept. Choose the file again to see it.'),
      h('button', { type: 'button', class: 'btn', id: 'trace-again', data: { key: 'trace-again' }, on: { click: choose } }, 'Choose the file again…'));
    const facts = h('p', { class: 'bld-inspector__small', id: 'trace-facts' });
    const visible = checkField({ id: 'trace-visible', label: 'Show the image', key: 'trace-visible', checked: image.visible, commit: (on) => patchWith({ visible: on }, on ? 'The image is shown.' : 'The image is hidden.') });
    const locked = checkField({ id: 'trace-locked', label: 'Lock the image', hint: 'A locked image cannot be moved, turned or resized by accident.', key: 'trace-locked', checked: image.locked, commit: (on) => {
      if (on) setMoving(false);
      patchWith({ locked: on }, on ? 'The image is locked.' : 'The image is unlocked.');
    } });
    const opacityValue = h('output', { class: 'bi-range__value', id: 'trace-opacity-value', for: 'trace-opacity' });
    const opacity = h('input', { type: 'range', class: 'bi-range__input', id: 'trace-opacity', min: '5', max: '100', step: '5', data: { key: 'trace-opacity' } });
    opacity.addEventListener('input', () => {
      opacityValue.textContent = opacity.value + '%';
      live = { floorId: ed.floor.id, image: { opacity: Number(opacity.value) / 100 } };
      ed.schedule();
    });
    opacity.addEventListener('change', () => {
      live = null;
      patchWith({ opacity: Number(opacity.value) / 100 }, 'The image is at ' + opacity.value + '% opacity.');
    });
    const number = (id, label, value, what, commit) => {
      const made = field({ id, label, name: id, value, inputMode: 'decimal', parse: decimal(what), format: (n) => String(round(n, 2)), commit });
      made.input.dataset.key = id;
      return made;
    };
    const wide = number('trace-width', 'Width, in cells', image.scale * image.width, 'The width', (value) => {
      if (!(value > 0)) throw new Error('The image needs a width above 0 cells.');
      patchWith({ scale: value / ed.floor.image.width }, 'The image is ' + round(value, 2) + ' cells wide.');
    });
    const turn = number('trace-rotation', 'Turned, in degrees', image.rotation, 'The turn', (value) => patchWith({ rotation: value }, 'The image is turned ' + round(value, 2) + ' degrees.'));
    const left = number('trace-x', 'Left edge, in cells', image.x, 'The left edge', (value) => patchWith({ x: value }, 'Moved the image.'));
    const top = number('trace-y', 'Top edge, in cells', image.y, 'The top edge', (value) => patchWith({ y: value }, 'Moved the image.'));
    const move = h('button', { type: 'button', class: 'btn', id: 'trace-move', 'aria-pressed': 'false', data: { key: 'trace-move' }, on: { click: () => setMoving(!moving) } }, 'Move it by dragging');
    const scale = h('button', { type: 'button', class: 'btn', id: 'trace-scale', data: { key: 'trace-scale' }, 'aria-describedby': 'trace-scale-hint', on: { click: (event) => scaling.start(event) } }, 'Scale the image from a length');
    const scaleHint = h('p', { class: 'bld-inspector__small', id: 'trace-scale-hint' }, 'Place two points on the image, then say how long the line between them is, in feet, metres or cells.');
    const byPoints = h('button', { type: 'button', class: 'btn', id: 'trace-place', data: { key: 'trace-place' }, 'aria-describedby': 'trace-place-hint', on: { click: (event) => scaling.start(event, 'place') } }, 'Place the image by two points');
    const placeHint = h('p', { class: 'bld-inspector__small', id: 'trace-place-hint' }, 'Place two points on the image, then the two places on the floor they belong at. The image is scaled, turned and moved so both land there.');
    const fit = h('button', { type: 'button', class: 'btn', id: 'trace-fit', data: { key: 'trace-fit' }, on: { click: () => {
      const now = ed.floor;
      place(fitPlacement(now, now.image.width, now.image.height, now.image.rotation), 'fit', 'The whole image fits ' + now.name + ', in its middle. ' + widthWords(now.image));
    } } }, 'Fit the image to the floor');
    const floorFit = h('button', { type: 'button', class: 'btn', id: 'trace-floor-fit', data: { key: 'trace-floor-fit' }, on: { click: () => fitFloor(floorFit) } }, 'Fit the floor to the image');
    const replace = h('button', { type: 'button', class: 'btn', id: 'trace-replace', data: { key: 'trace-replace' }, on: { click: () => {
      // another image: this one's place is not the next one's
      choose(true);
    } } }, 'Use another image…');
    const remove = h('button', { type: 'button', class: 'btn btn--danger', id: 'trace-remove', data: { key: 'trace-remove' }, on: { click: () => {
      setMoving(false);
      scaling.cancel(false);
      const name = ed.floor.name;
      const outcome = ed.commit(setTraceImage, { floorId: ed.floor.id, image: null }, { done: () => 'Removed the image from under ' + name + '.', toast: () => 'Removed the image from under ' + name + '.' });
      if (outcome) ed.schedule();
    } } }, 'Remove the image');
    controls = { missing, facts, visible, locked, opacity, opacityValue, wide, turn, left, top, move, fit, floorFit, byPoints, replace };
    element.replaceChildren(
      title,
      missing,
      facts,
      visible.element,
      locked.element,
      h('div', { class: 'bi-range' }, h('label', { class: 'field__label', for: 'trace-opacity' }, 'Opacity'), opacity, opacityValue),
      h('div', { class: 'bi-pair' }, wide.element, turn.element),
      h('div', { class: 'bi-pair' }, left.element, top.element),
      h('div', { class: 'bi-buttons' }, scale),
      scaleHint,
      h('div', { class: 'bi-buttons' }, byPoints),
      placeHint,
      h('div', { class: 'bi-buttons' }, move),
      h('div', { class: 'bi-buttons' }, fit, floorFit),
      h('div', { class: 'bi-buttons' }, replace, remove),
      fileInput,
    );
  }

  function sync(floor) {
    if (!controls || !floor.image) return;
    const image = floor.image;
    const gone = isMissing(image);
    controls.missing.hidden = !gone;
    controls.facts.textContent = 'The image is ' + image.width + ' × ' + image.height + ' pixels, drawn ' + round(image.scale * image.width, 1) + ' × ' + round(image.scale * image.height, 1) + ' cells.';
    controls.visible.set(image.visible);
    controls.locked.set(image.locked);
    if (document.activeElement !== controls.opacity) controls.opacity.value = String(Math.round(image.opacity * 100));
    controls.opacityValue.textContent = Math.round(image.opacity * 100) + '%';
    controls.wide.set(image.scale * image.width);
    controls.turn.set(image.rotation);
    controls.left.set(image.x);
    controls.top.set(image.y);
    for (const made of [controls.wide, controls.turn, controls.left, controls.top]) made.input.disabled = image.locked;
    for (const button of [controls.move, controls.fit, controls.floorFit]) button.disabled = image.locked;
    controls.move.setAttribute('aria-pressed', String(moving));
    controls.move.textContent = moving ? 'Done moving' : 'Move it by dragging';
  }

  let built = null;

  function update(floor) {
    shown = floor.id;
    const key = floor.id + ':' + (floor.image ? 'image' : 'none');
    if (key !== built) {
      built = key;
      if (moving && !floor.image) setMoving(false);
      build(floor);
    }
    if (floor.image && !bitmaps.has(floor.image.imageId)) load(floor.image.imageId);
    sync(floor);
  }

  return {
    underlay,
    controls: { element, update },
    importFile,
    choose,
    get moving() {
      return moving;
    },
    stopMoving: () => setMoving(false),
    scaling,
    detach() {
      scaling.detach();
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}
