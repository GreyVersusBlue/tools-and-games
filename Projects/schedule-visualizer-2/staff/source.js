// Where the schedule comes from (ARCHITECTURE 8), tried in this order:
//
// 1. a script element in the page itself: a published file, locked or not;
// 2. the planner's preview: when this page is in a frame it tells its parent
//    it is ready, every half second until an answer comes, and goes on
//    listening so the preview follows the planner;
// 3. a file beside the page, for a hosted link. Not built: it answers "none".
//
// And what a piece of data is: readPublished() sorts anything it is given
// into open, locked, newer or damaged, with the sentence to show.

import { PUBLISHED_FORMAT, CURRENT_VERSION } from '../engine/schema.js';
import { LOCKED_FORMAT, LOCKED_VERSION, lockedProblem } from '../engine/publish-crypto.js';

export const DATA_ELEMENT_ID = 'sv2-published';
export const PREVIEW_READY = 'sv2-preview-ready';
export const PREVIEW_DATA = 'sv2-published';
export const PREVIEW_EVERY_MS = 500;

export const NEWER_SENTENCE = 'This schedule was made for a newer staff browser than the one in this file. Ask the office for a new copy.';
export const DAMAGED_SENTENCE = 'This file is damaged: part of it is missing or was changed. Ask the office for a new copy.';
export const NOT_OURS_SENTENCE = 'This is not a staff schedule. Ask the office for the file again.';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function whole(value) {
  return Number.isInteger(value) && value >= 0;
}

// Enough of a look at an open model that the pages can trust its shape. It is
// not validate(): a published file was valid when it was made, and the staff
// browser does not carry the planner's checks.
function shapeProblem(model) {
  const lists = [model.subjects, model.teachers, model.groups, model.dayTypes];
  if (typeof model.id !== 'string' || typeof model.publishedAt !== 'string' || typeof model.staleAfter !== 'string') return DAMAGED_SENTENCE;
  if (!isObject(model.settings) || !Number.isInteger(model.settings.periods) || model.settings.periods < 1) return DAMAGED_SENTENCE;
  if (!isObject(model.building) || !Array.isArray(model.building.floors) || !Array.isArray(model.building.connections)) return DAMAGED_SENTENCE;
  if (!lists.every(Array.isArray) || model.dayTypes.length === 0) return DAMAGED_SENTENCE;
  if (!model.building.floors.every((floor) => isObject(floor) && typeof floor.cells === 'string' && Array.isArray(floor.spaces))) return DAMAGED_SENTENCE;
  if (!lists.every((list) => list.every((item) => isObject(item) && typeof item.id === 'string'))) return DAMAGED_SENTENCE;
  if (!model.groups.every((group) => isObject(group.days))) return DAMAGED_SENTENCE;
  if (!isObject(model.publish) || !isObject(model.publish.views)) return DAMAGED_SENTENCE;
  return null;
}

// What is this? One of
//   { kind: 'open', model }       a published schedule, readable
//   { kind: 'locked', envelope }  a published schedule behind the passcode
//   { kind: 'newer', message }    a format this staff browser does not know yet
//   { kind: 'damaged', message }  anything else
export function readPublished(value) {
  if (!isObject(value)) return { kind: 'damaged', message: NOT_OURS_SENTENCE };
  if (value.format !== PUBLISHED_FORMAT && value.format !== LOCKED_FORMAT) return { kind: 'damaged', message: NOT_OURS_SENTENCE };
  const current = value.format === LOCKED_FORMAT ? LOCKED_VERSION : CURRENT_VERSION;
  if (!whole(value.version)) return { kind: 'damaged', message: DAMAGED_SENTENCE };
  if (value.version > current) return { kind: 'newer', message: NEWER_SENTENCE };
  if (value.version !== current) return { kind: 'damaged', message: DAMAGED_SENTENCE };
  if (value.format === LOCKED_FORMAT) {
    const problem = lockedProblem(value);
    return problem ? { kind: 'damaged', message: problem } : { kind: 'locked', envelope: value };
  }
  const problem = shapeProblem(value);
  return problem ? { kind: 'damaged', message: problem } : { kind: 'open', model: value };
}

// Step 1. The data inside the page: { found: false }, or { found: true, value },
// or { found: true, broken: true } when the element is there and cannot be
// read (a file cut short on its way).
export function inlineData(doc) {
  const element = doc.getElementById(DATA_ELEMENT_ID);
  if (!element) return { found: false };
  try {
    return { found: true, value: JSON.parse(element.textContent) };
  } catch (error) {
    return { found: true, broken: true };
  }
}

// Is this page inside another page's frame?
export function isFramed(win) {
  try {
    return Boolean(win.parent) && win.parent !== win;
  } catch (error) {
    return true;
  }
}

// Step 2. Tell the parent this page is ready until it answers, and hand every
// answer to onData. Only the parent is listened to, and only from this page's
// own origin: a preview frame is made by the planner from the planner's own
// address, so the two always match. Returns a function that stops it.
export function watchPreview(win, onData) {
  const own = win.location.origin;
  const target = own === 'null' ? '*' : own;
  let answered = false;
  const listen = (event) => {
    if (event.source !== win.parent || event.origin !== own) return;
    if (!event.data || event.data.type !== PREVIEW_DATA) return;
    answered = true;
    onData(event.data.data);
  };
  const knock = () => {
    if (!answered) win.parent.postMessage({ type: PREVIEW_READY }, target);
  };
  win.addEventListener('message', listen);
  knock();
  const timer = win.setInterval(() => {
    if (answered) win.clearInterval(timer);
    else knock();
  }, PREVIEW_EVERY_MS);
  return () => {
    win.clearInterval(timer);
    win.removeEventListener('message', listen);
  };
}

// Step 3. A published.json beside the page, for a hosted staff browser.
// Nothing asks for one yet, and this makes no request.
export async function siblingData() {
  return { found: false };
}
