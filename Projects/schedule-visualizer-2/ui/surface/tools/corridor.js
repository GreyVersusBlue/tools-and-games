// Corridor (C): click or drag to paint walkable hallway cells.

import { paintCorridor } from '../../../engine/actions.js';
import { paintTool } from './paint.js';
import { count, replaced } from './words.js';

export const tool = paintTool({
  id: 'corridor',
  key: 'c',
  label: 'Corridor',
  name: 'Corridor',
  group: 'main',
  icon: 'M3 7h14 M3 13h14',
  hint: 'Corridor: click or drag to paint corridor. Hold Space or use two fingers to move the map.',
  as: 'corridor',
  action: paintCorridor,
  done: (outcome) => 'Painted ' + count(outcome.cells.length, 'corridor cell') + replaced(outcome) + '.',
  same: 'That is corridor already.',
});
