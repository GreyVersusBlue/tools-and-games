// Elevator (U): click or drag to place elevator stops (spec 4.2, 4.3). A stop
// is a stairs cell listed in the floor's `lifts`; it does nothing until it is
// connected to a stop on another floor (connect mode, ui/building/connect.js).

import { placeLift } from '../../../engine/actions.js';
import { paintTool } from './paint.js';
import { count, replaced } from './words.js';

export const tool = paintTool({
  id: 'elevator',
  key: 'u',
  label: 'Elevator',
  name: 'Elevator',
  group: 'more',
  // two triangles, up over down, as the plan draws a stop
  icon: 'M10 2.5L14.5 8h-9zM10 17.5L5.5 12h9z',
  hint: 'Elevator: click to place a stop. Then Connect… it to a stop on another floor.',
  as: 'stairs',
  action: placeLift,
  done: (outcome) => 'Placed ' + count(outcome.cells.length, 'elevator stop') + replaced(outcome) + '. Not connected yet.',
  same: 'Those are elevator stops already.',
});
