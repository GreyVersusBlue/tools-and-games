// Undo and redo over immutable project states. A history is
// { past: Entry[], future: Entry[] } and an entry is
//
//   { label, before, after, focus, bumps, outcome }
//
//   label     what the action was, for "Undid: …".
//   before,   the project before and after one user action. States share
//   after     every branch the action left alone, so an entry costs only
//             what changed.
//   focus     where the change was, so the page can offer to show it.
//   bumps     which of the store's counters the action moved (geometry,
//             building, schedule). Undo and redo move the same ones.
//   outcome   what the action reported about its own run (what a placement
//             replaced, what an import did), kept so the page reads it here
//             and never runs an action a second time to find out. Undefined
//             for an action that reports nothing.
//
// The store (store.js) builds the entries; this module only keeps them, and
// never looks inside one. These functions never change what they are given.

export const HISTORY_LIMIT = 200;

export function createHistory() {
  return { past: [], future: [] };
}

// Add an entry. The oldest entries fall off past the limit, and anything that
// had been undone can no longer be redone.
export function record(history, entry, limit) {
  const cap = limit === undefined ? HISTORY_LIMIT : limit;
  const past = history.past.concat([entry]);
  return { past: past.length > cap ? past.slice(past.length - cap) : past, future: [] };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}

// The entry undo would take back, or null.
export function peekUndo(history) {
  return history.past.length > 0 ? history.past[history.past.length - 1] : null;
}

// The entry redo would bring back, or null.
export function peekRedo(history) {
  return history.future.length > 0 ? history.future[history.future.length - 1] : null;
}

// { history, entry }: the history with its newest entry moved to the redo
// side, and that entry (go back to entry.before). Null when there is nothing
// to undo.
export function undo(history) {
  const entry = peekUndo(history);
  if (!entry) return null;
  return { history: { past: history.past.slice(0, -1), future: history.future.concat([entry]) }, entry };
}

// The reverse: go forward to entry.after. Null when there is nothing to redo.
export function redo(history) {
  const entry = peekRedo(history);
  if (!entry) return null;
  return { history: { past: history.past.concat([entry]), future: history.future.slice(0, -1) }, entry };
}
