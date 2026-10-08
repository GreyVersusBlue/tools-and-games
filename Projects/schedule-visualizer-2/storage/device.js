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
