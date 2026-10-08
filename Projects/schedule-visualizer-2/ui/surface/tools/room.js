// Room (R): click for a one-cell room, drag for a rectangle. The new room is
// selected, and for anything but a finger its number field takes the focus so
// the number can be typed at once.

import { placeRoom } from '../../../engine/actions.js';
import { rectTool } from './rect.js';
import { replaced } from './words.js';

export const tool = rectTool({
  id: 'room',
  key: 'r',
  label: 'Room',
  name: 'Room',
  group: 'main',
  icon: 'M4 4h12v12H4z M4 9h4',
  hint: 'Room: click for one cell, drag for a rectangle. Hold Space or use two fingers to move the map.',
  as: 'room',
  action: placeRoom,
  done: (outcome, rect) => 'Placed a room, ' + rect.w + ' by ' + rect.h + replaced(outcome) + '. Type its number.',
  placed: (ed, outcome, ev) => ed.placedRoom(outcome.spaceId, ev),
});
