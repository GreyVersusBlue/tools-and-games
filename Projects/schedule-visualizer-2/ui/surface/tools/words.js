// The sentences the drawing tools say when a gesture is complete (DESIGN 6:
// each completed action in its own sentence). One place, so every tool words
// a replacement, a count and a place the same way.

import { lossText, isLoss } from '../../../engine/building.js';
import { roomName } from '../../../engine/findings.js';

export function count(n, one, many) {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

// ", replaced 3 corridor cells" or nothing.
export function replaced(outcome) {
  return outcome.loss && isLoss(outcome.loss) ? ', replaced ' + lossText(outcome.loss) : '';
}

// "column 6, row 4", counting from 1 as a person does.
export function cellWords(ev) {
  return 'column ' + (ev.x + 1) + ', row ' + (ev.y + 1);
}

// "2 right and 1 down"
export function shiftWords(dx, dy) {
  const parts = [];
  if (dx !== 0) parts.push(Math.abs(dx) + (dx > 0 ? ' right' : ' left'));
  if (dy !== 0) parts.push(Math.abs(dy) + (dy > 0 ? ' down' : ' up'));
  return parts.join(' and ');
}

export function capital(text) {
  return text === '' ? text : text[0].toUpperCase() + text.slice(1);
}

// A room or other space as a sentence names it: "Room 204", "Gym", "a room
// with no number", an other space by its label.
export function nameOf(space) {
  if (!space) return 'a space';
  if (space.kind === 'room') return roomName(space);
  return space.label.trim() === '' ? 'an other space' : space.label;
}
