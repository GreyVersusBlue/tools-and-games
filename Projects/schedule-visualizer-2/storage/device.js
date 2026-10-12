// Small choices this device remembers, in localStorage under `sv2:device`:
// { theme, lastSection, playback, paper }. The name is permanent.
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

export function readPlayback(storage) {
  return playbackOf(readDevice(storage));
}

// Remember a change to the playback settings. Returns all of them. Throws
// when the browser refuses, as writeDevice does.
export function writePlayback(patch, storage) {
  const store = storage || globalThis.localStorage;
  const next = playbackOf({ playback: { ...readPlayback(store), ...patch } });
  writeDevice({ playback: next }, store);
  return next;
}
