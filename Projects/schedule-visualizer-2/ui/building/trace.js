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
// The first part of this file is pure and has no DOM in it: the action that
// sets a floor's TraceImage, and the arithmetic. It is here, and not in
// engine/actions.js with every other action, only because the engine had no
// action for the image when the inspector was built; it belongs there.

import { action, ActionError, BUILDING, patch, mapShared } from '../../engine/actions.js';
import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { checkField, decimal, heading } from './inspector/controls.js';

// ---------------------------------------------------------------- pure

// A larger image is reduced on import until its longer side is this many
// pixels. A 200-cell floor drawn at 100% is 4,800 pixels across, and an
// underlay at 40% opacity needs a third of that at most.
export const MAX_SIDE = 1600;
export const DEFAULT_OPACITY = 0.4;
// What shows through the clear parts of a transparent image.
export const BACKING = '#ffffff';

const NUMBERS = ['opacity', 'scale', 'rotation', 'x', 'y'];
const FLAGS = ['visible', 'locked', 'missing'];
const SIZES = ['width', 'height'];

function refuse(message, code) {
  throw new ActionError(message, code || 'bad-value');
}

function floorNamed(project, floorId) {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId);
  return floor ? floor.name : 'the floor';
}

// The size an image is stored at: { width, height, reduced }. The shape is
// kept; neither side goes under one pixel.
export function reducedSize(width, height, max) {
  const limit = max === undefined ? MAX_SIDE : max;
  const longer = Math.max(width, height);
  if (longer <= limit) return { width, height, reduced: false };
  const factor = limit / longer;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), reduced: true };
}

// Where a new image goes: as large as fits on the floor, in its middle.
export function fitPlacement(floor, width, height) {
  const scale = Math.min(floor.width / width, floor.height / height);
  return { scale, x: (floor.width - width * scale) / 2, y: (floor.height - height * scale) / 2, rotation: 0 };
}

// The box a traced image is drawn in, in cells: its top left corner, its
// size, its middle (the point it is turned about), the turn in degrees and
// the opacity. Null when there is no image.
export function tracePlacement(image) {
  if (!image) return null;
  const w = image.width * image.scale;
  const hgt = image.height * image.scale;
  return { x: image.x, y: image.y, w, h: hgt, cx: image.x + w / 2, cy: image.y + hgt / 2, rotation: image.rotation, opacity: image.opacity };
}

// Set, adjust or remove a floor's traced image.
// payload: { floorId, image }
//   image: null             take the image off the floor
//   image: { … }            these fields over the ones the floor has. A floor
//                           with no image needs imageId, width and height;
//                           the rest take their defaults
// The bytes are not this action's business: they are stored before it runs.
export const setTraceImage = action(
  {
    label: (before, payload) => {
      const floor = before.building.floors.find((candidate) => candidate.id === payload.floorId);
      const name = floorNamed(before, payload.floorId);
      if (payload.image === null) return 'Remove the traced image from ' + name;
      if (!floor || !floor.image || (payload.image.imageId !== undefined && payload.image.imageId !== floor.image.imageId)) return 'Trace over an image on ' + name;
      return 'Adjust the traced image on ' + name;
    },
    bumps: [BUILDING],
    focus: (before, payload) => ({ section: 'building', floorId: payload.floorId }),
  },
  (project, payload) => {
    const floors = project.building.floors;
    const floor = floors.find((candidate) => candidate.id === payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    let next;
    if (payload.image === null) {
      next = null;
    } else {
      const given = payload.image;
      if (!given || typeof given !== 'object') refuse('A traced image is null or an object.');
      const base = floor.image || { imageId: '', opacity: DEFAULT_OPACITY, scale: 1, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 0, height: 0, missing: false };
      next = base;
      for (const key of ['imageId', ...NUMBERS, ...FLAGS, ...SIZES]) {
        if (given[key] !== undefined && given[key] !== next[key]) next = { ...next, [key]: given[key] };
      }
      if (typeof next.imageId !== 'string' || next.imageId === '') refuse('A traced image names its stored image.');
      if (typeof next.opacity !== 'number' || !(next.opacity >= 0 && next.opacity <= 1)) refuse('Opacity is from 0% to 100%.');
      if (typeof next.scale !== 'number' || !Number.isFinite(next.scale) || !(next.scale > 0)) refuse('The image needs a width above 0 squares.');
      for (const key of ['rotation', 'x', 'y']) if (!Number.isFinite(next[key])) refuse('The ' + key + ' of a traced image is a number.');
      for (const key of FLAGS) if (typeof next[key] !== 'boolean') refuse('The ' + key + ' flag of a traced image is on or off.');
      for (const key of SIZES) if (!Number.isInteger(next[key]) || next[key] < 1) refuse('The ' + key + ' of a traced image is a whole number of pixels.');
    }
    if (next === floor.image) return project;
    return patch(project, ['building', 'floors'], (list) => mapShared(list, (candidate) => (candidate === floor ? { ...floor, image: next } : candidate)));
  },
);

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
    moving = on;
    drag = null;
    live = null;
    if (on) {
      canvas.dataset.tracing = 'true';
      ed.setHint('Drag the image to where it belongs. Escape, or Done, when it is in place.');
      say('Drag the image to where it belongs. Escape when it is in place.');
    } else {
      delete canvas.dataset.tracing;
      ed.setHint(ed.tool.hint);
    }
    if (shown) update(ed.floor);
    ed.schedule();
  }

  function onDown(event) {
    if (!moving || event.button !== 0) return;
    const floor = ed.floor;
    if (!floor.image || floor.image.locked) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) { /* a synthetic pointer has nothing to capture */ }
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: floor.image.x, y: floor.image.y, floorId: floor.id };
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopImmediatePropagation();
    const size = ed.view.size;
    live = { floorId: drag.floorId, image: { x: round(drag.x + (event.clientX - drag.sx) / size, 2), y: round(drag.y + (event.clientY - drag.sy) / size, 2) } };
    ed.schedule();
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopImmediatePropagation();
    const kept = live;
    drag = null;
    live = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) { /* already let go */ }
    if (kept && event.type === 'pointerup') apply(kept.image, 'Moved the image.');
    ed.schedule();
  }

  function onKey(event) {
    if (moving && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMoving(false);
    }
  }

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  // on the window, ahead of everything in the page: Escape here is this mode's
  window.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------- the controls

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
    const wide = number('trace-width', 'Width, in squares', image.scale * image.width, 'The width', (value) => {
      if (!(value > 0)) throw new Error('The image needs a width above 0 squares.');
      patchWith({ scale: value / ed.floor.image.width }, 'The image is ' + round(value, 2) + ' squares wide.');
    });
    const turn = number('trace-rotation', 'Turned, in degrees', image.rotation, 'The turn', (value) => patchWith({ rotation: value }, 'The image is turned ' + round(value, 2) + ' degrees.'));
    const left = number('trace-x', 'Left edge, in squares', image.x, 'The left edge', (value) => patchWith({ x: value }, 'Moved the image.'));
    const top = number('trace-y', 'Top edge, in squares', image.y, 'The top edge', (value) => patchWith({ y: value }, 'Moved the image.'));
    const move = h('button', { type: 'button', class: 'btn', id: 'trace-move', 'aria-pressed': 'false', data: { key: 'trace-move' }, on: { click: () => setMoving(!moving) } }, 'Move it by dragging');
    const fit = h('button', { type: 'button', class: 'btn', id: 'trace-fit', data: { key: 'trace-fit' }, on: { click: () => {
      const now = ed.floor;
      patchWith(fitPlacement(now, now.image.width, now.image.height), 'The image fits ' + now.name + '.');
    } } }, 'Fit it to the floor');
    const replace = h('button', { type: 'button', class: 'btn', id: 'trace-replace', data: { key: 'trace-replace' }, on: { click: () => {
      // another image: this one's place is not the next one's
      choose(true);
    } } }, 'Use another image…');
    const remove = h('button', { type: 'button', class: 'btn btn--danger', id: 'trace-remove', data: { key: 'trace-remove' }, on: { click: () => {
      setMoving(false);
      const name = ed.floor.name;
      const outcome = ed.commit(setTraceImage, { floorId: ed.floor.id, image: null }, { done: () => 'Removed the image from under ' + name + '.', toast: () => 'Removed the image from under ' + name + '.' });
      if (outcome) ed.schedule();
    } } }, 'Remove the image');
    controls = { missing, facts, visible, locked, opacity, opacityValue, wide, turn, left, top, move, fit, replace };
    element.replaceChildren(
      title,
      missing,
      facts,
      visible.element,
      locked.element,
      h('div', { class: 'bi-range' }, h('label', { class: 'field__label', for: 'trace-opacity' }, 'Opacity'), opacity, opacityValue),
      h('div', { class: 'bi-pair' }, wide.element, turn.element),
      h('div', { class: 'bi-pair' }, left.element, top.element),
      h('div', { class: 'bi-buttons' }, move, fit),
      h('div', { class: 'bi-buttons' }, replace, remove),
      fileInput,
    );
  }

  function sync(floor) {
    if (!controls || !floor.image) return;
    const image = floor.image;
    const gone = isMissing(image);
    controls.missing.hidden = !gone;
    controls.facts.textContent = 'The image is ' + image.width + ' × ' + image.height + ' pixels, drawn ' + round(image.scale * image.width, 1) + ' × ' + round(image.scale * image.height, 1) + ' squares.';
    controls.visible.set(image.visible);
    controls.locked.set(image.locked);
    if (document.activeElement !== controls.opacity) controls.opacity.value = String(Math.round(image.opacity * 100));
    controls.opacityValue.textContent = Math.round(image.opacity * 100) + '%';
    controls.wide.set(image.scale * image.width);
    controls.turn.set(image.rotation);
    controls.left.set(image.x);
    controls.top.set(image.y);
    for (const made of [controls.wide, controls.turn, controls.left, controls.top]) made.input.disabled = image.locked;
    for (const button of [controls.move, controls.fit]) button.disabled = image.locked;
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
    detach() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}
