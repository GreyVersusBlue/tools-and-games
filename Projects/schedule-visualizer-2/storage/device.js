// Small choices this device remembers, in localStorage under `sv2:device`:
// { theme, lastSection, playback, paper, movement, schedule, grid }. The name
// is permanent.
//
// Every write reads what is stored first and changes only the keys it was
// given, so two parts of the page never undo each other's choices.
// index.html reads `theme` from the same key before anything is drawn.

export const DEVICE_KEY = 'sv2:device';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// What is remembered, or {} when nothing is, or when this browser keeps
// nothing (private browsing, storage switched off).
export function readDevice(storage) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(DEVICE_KEY));
    return isObject(value) ? value : {};
  } catch (error) {
    return {};
  }
}

// Remember `patch` (top-level keys). Returns what is now stored. Throws when
// the browser refuses, so the caller can say so once.
export function writeDevice(patch, storage) {
  const store = storage || globalThis.localStorage;
  const next = { ...readDevice(store), ...patch };
  store.setItem(DEVICE_KEY, JSON.stringify(next));
  return next;
}

// `playback`: what the playback bar of the movement view was last set to
// (spec 8.1), every key always there once written:
//
//   { speed: 0.5 | 1 | 2 | 4,
//     loop:  'once' | 'transition' | 'day',
//     pace:  'fixed' | 'real',         a fixed length a transition, or real walking pace
//     style: 'tail' | 'route',         a fading tail, or the whole route left behind
//     size:  'small' | 'large',        the marker
//     order: 'together' | 'turns' }    everyone at once, or one group after another
export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4]);
export const PLAYBACK_CHOICES = Object.freeze({
  loop: Object.freeze(['once', 'transition', 'day']),
  pace: Object.freeze(['fixed', 'real']),
  style: Object.freeze(['tail', 'route']),
  size: Object.freeze(['small', 'large']),
  order: Object.freeze(['together', 'turns']),
});
export const PLAYBACK_DEFAULTS = Object.freeze({ speed: 1, loop: 'once', pace: 'fixed', style: 'tail', size: 'small', order: 'together' });

// The playback settings in what readDevice() gave, with anything missing or
// not one of the choices put back to its default.
export function playbackOf(device) {
  const kept = isObject(device) && isObject(device.playback) ? device.playback : {};
  const next = { ...PLAYBACK_DEFAULTS };
  if (PLAYBACK_SPEEDS.includes(kept.speed)) next.speed = kept.speed;
  for (const [key, values] of Object.entries(PLAYBACK_CHOICES)) if (values.includes(kept[key])) next[key] = kept[key];
  return next;
}

// The settings with a change made to them. A key of the patch that is not one
// of the choices (a speed of 3, a loop nobody offers) changes nothing: what
// was there is kept, not the default.
export function playbackWith(current, patch) {
  const next = playbackOf({ playback: current });
  const asked = isObject(patch) ? patch : {};
  if (PLAYBACK_SPEEDS.includes(asked.speed)) next.speed = asked.speed;
  for (const [key, values] of Object.entries(PLAYBACK_CHOICES)) if (values.includes(asked[key])) next[key] = asked[key];
  return next;
}

export function readPlayback(storage) {
  return playbackOf(readDevice(storage));
}

// Remember a change to the playback settings. Returns all of them. Throws
// when the browser refuses, as writeDevice does.
export function writePlayback(patch, storage) {
  const store = storage || globalThis.localStorage;
  const next = playbackWith(readPlayback(store), patch);
  writeDevice({ playback: next }, store);
  return next;
}

// `movement`: what the movement view was last left as, on this device
// (DESIGN 5.3):
//
//   { controls: 'open' | 'folded',   the who, day type and transition controls
//                                     under the first line: shown, or folded
//                                     away behind "Change". Missing until the
//                                     reader chooses: the window's width
//                                     decides until then.
//     played: true }                  playback has been started here once, so
//                                     the bar's hint is not shown again
//
// A stored value without the field, or with something else in it, reads as
// nothing chosen and nothing played.
export const MOVEMENT_CONTROLS = Object.freeze(['open', 'folded']);

export function movementOf(device) {
  const kept = isObject(device) && isObject(device.movement) ? device.movement : {};
  return { controls: MOVEMENT_CONTROLS.includes(kept.controls) ? kept.controls : null, played: kept.played === true };
}

export function readMovement(storage) {
  return movementOf(readDevice(storage));
}

// Remember a change to it: only the keys given, and only what is one of the
// choices. A field of `movement` this file does not know (one a later version
// writes) is kept as it was; a known one that is not one of the choices goes.
// Returns what is now kept. Throws when the browser refuses.
export function writeMovement(patch, storage) {
  const store = storage || globalThis.localStorage;
  const device = readDevice(store);
  const asked = isObject(patch) ? patch : {};
  const next = isObject(device.movement) ? { ...device.movement } : {};
  const now = movementOf(device);
  delete next.controls;
  delete next.played;
  if (now.controls !== null) next.controls = now.controls;
  if (now.played) next.played = true;
  if (MOVEMENT_CONTROLS.includes(asked.controls)) next.controls = asked.controls;
  if (asked.played === true) next.played = true;
  writeDevice({ movement: next }, store);
  return movementOf({ movement: next });
}

// `schedule`: { shownDays: [dayTypeId…] }, the day types the group editor
// shows when there are more than two of their own (DESIGN 11.6), the one
// chosen last first. `grid`: { day: dayTypeId | 'all' }, the grid's Day type
// choice. Ids are kept as they are; whether one is still a day type of the
// project is for the screen to ask. A value that is not of that shape reads
// as nothing chosen (ARCHITECTURE 17.9), and a write keeps the other fields
// of the same key.
export const SHOWN_DAYS_MOST = 3;

function idList(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const id of value) if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id);
  return ids.slice(0, SHOWN_DAYS_MOST);
}

export function shownDaysOf(device) {
  const kept = isObject(device) && isObject(device.schedule) ? device.schedule : {};
  return idList(kept.shownDays);
}

export function readShownDays(storage) {
  return shownDaysOf(readDevice(storage));
}

// Remember the day types shown, chosen last first. Returns what is kept.
// Throws when the browser refuses.
export function writeShownDays(ids, storage) {
  const store = storage || globalThis.localStorage;
  const device = readDevice(store);
  const next = { ...(isObject(device.schedule) ? device.schedule : {}), shownDays: idList(ids) };
  writeDevice({ schedule: next }, store);
  return next.shownDays;
}

export function gridDayOf(device) {
  const kept = isObject(device) && isObject(device.grid) ? device.grid : {};
  return typeof kept.day === 'string' && kept.day !== '' ? kept.day : null;
}

export function readGridDay(storage) {
  return gridDayOf(readDevice(storage));
}

// Remember the grid's Day type: an id or 'all'. Throws when the browser
// refuses.
export function writeGridDay(day, storage) {
  const store = storage || globalThis.localStorage;
  const device = readDevice(store);
  writeDevice({ grid: { ...(isObject(device.grid) ? device.grid : {}), day: String(day) } }, store);
  return String(day);
}
