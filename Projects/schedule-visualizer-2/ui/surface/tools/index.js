// The drawing tools of the building editor, in the order the tool strip shows
// them (DESIGN 5.1): the five used most above the divider, the rest below.
// Each is { id, key, label, name, group, icon, hint, cursor, onDown, onMove,
// onUp, onCancel } and makes exactly one store action for a completed gesture.
// A unit that adds a tool adds its module and its line here.

import { tool as select } from './select.js';
import { tool as corridor } from './corridor.js';
import { tool as room } from './room.js';
import { tool as eraser } from './eraser.js';
import { tool as pan } from './pan.js';
import { tool as line } from './line.js';
import { tool as stairs } from './stairs.js';
import { tool as other } from './other.js';

export const TOOLS = [select, corridor, room, eraser, pan, line, stairs, other];

export function toolById(id) {
  return TOOLS.find((tool) => tool.id === id) || null;
}

// The tool whose single key this is, or null. The caller has already asked
// singleKeyAllowed (ui/components/shortcuts.js).
export function toolForKey(key) {
  const wanted = String(key).toLowerCase();
  return TOOLS.find((tool) => tool.key === wanted) || null;
}
