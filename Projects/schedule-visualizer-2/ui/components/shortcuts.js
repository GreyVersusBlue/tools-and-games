// Keyboard shortcuts: one list, one guard, one listener. The Help dialog reads
// the same list, so a shortcut cannot exist without being listed.
//
// The guard (DESIGN 4): no single-key shortcut fires while focus is in an
// input, select, textarea, contenteditable or a grid cell being edited
// (`data-editing`), or while Ctrl, Alt or Meta is held. Every single-key
// shortcut in the tool goes through singleKeyAllowed, here and in the drawing
// surface.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

// Is the user typing into something?
export function isEditing(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  return target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"], [data-editing]') !== null;
}

// A field with an undo history of its own, which Ctrl/Cmd+Z belongs to.
export function isTextField(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
}

export function singleKeyAllowed(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return !isEditing(event.target);
}

// The words for a key combination on this device: "Ctrl+Z" or "⌘Z".
export function chordText(chord) {
  const key = chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
  const shift = chord.shift === true;
  if (IS_MAC) return (shift ? '⇧' : '') + (chord.mod ? '⌘' : '') + key;
  return (chord.mod ? 'Ctrl+' : '') + (shift ? 'Shift+' : '') + key;
}

// createShortcuts({ blocked }) -> { add, list, handle }
//
// add({ id, group, does, key })     a single key: '1', '?', '/'. Guarded.
// add({ id, group, does, chord })   { key, mod, shift }; mod is Ctrl, or Cmd on
//                                   a Mac. `textFields: false` leaves it to a
//                                   text field's own history when one has focus.
// add({ ..., only: 'mac' | 'other' })   a shortcut one kind of device has.
// add({ id, group, does, shown })   listed in Help only; something else (a
//                                   dialog, a menu) answers the key itself.
// `blocked()` true (a dialog is open) stops every shortcut.
export function createShortcuts(options) {
  const blocked = (options && options.blocked) || (() => false);
  const entries = [];

  function matches(entry, event) {
    if (entry.key === undefined && !entry.chord) return false;
    if (entry.key !== undefined) return event.key === entry.key && singleKeyAllowed(event);
    const chord = entry.chord;
    const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (Boolean(chord.mod) !== mod || event.altKey) return false;
    if (Boolean(chord.shift) !== event.shiftKey && chord.shift !== 'any') return false;
    if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
    return entry.textFields !== false || !isTextField(event.target);
  }

  return {
    add(entry) {
      if (entry.only === 'mac' && !IS_MAC) return;
      if (entry.only === 'other' && IS_MAC) return;
      entries.push(entry);
    },
    // [{ id, group, does, keys }] for the Help dialog, in the order added.
    list() {
      return entries.map((entry) => ({
        id: entry.id,
        group: entry.group,
        does: entry.does,
        keys: entry.shown || (entry.key !== undefined ? entry.key : chordText(entry.chord)),
      }));
    },
    handle(event) {
      if (event.defaultPrevented || blocked()) return false;
      for (const entry of entries) {
        if (!matches(entry, event)) continue;
        event.preventDefault();
        entry.run(event);
        return true;
      }
      return false;
    },
  };
}
