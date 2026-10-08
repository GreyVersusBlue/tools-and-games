// Stairs (S): click or drag to place stairs cells. A stairs cell does nothing
// until it is connected to another, which is the inspector's job.

import { placeStairs } from '../../../engine/actions.js';
import { paintTool } from './paint.js';
import { count, replaced } from './words.js';

export const tool = paintTool({
  id: 'stairs',
  key: 's',
  label: 'Stairs',
  name: 'Stairs',
  group: 'more',
  icon: 'M3 17h4v-4h4V9h4V5h2',
  hint: 'Stairs: click or drag to place stairs. They join two floors once they are connected.',
  as: 'stairs',
  action: placeStairs,
  done: (outcome) => 'Placed ' + count(outcome.cells.length, 'stairs cell') + replaced(outcome) + '. Not connected yet.',
  same: 'Those are stairs already.',
});
