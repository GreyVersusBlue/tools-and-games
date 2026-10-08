// Other (O): an other space, which nobody is scheduled into: a bathroom, an
// office, storage, a courtyard. Click for one cell, drag for a rectangle.

import { placeOtherSpace } from '../../../engine/actions.js';
import { rectTool } from './rect.js';
import { replaced } from './words.js';

export const tool = rectTool({
  id: 'other',
  key: 'o',
  label: 'Other',
  name: 'Other space',
  group: 'more',
  icon: 'M4 4h12v12H4z M4 16 16 4 M4 10l6-6 M10 16l6-6',
  hint: 'Other space: click for one cell, drag for a rectangle. For a bathroom, an office, storage or a courtyard.',
  as: 'other',
  action: placeOtherSpace,
  done: (outcome, rect) => 'Placed an other space, ' + rect.w + ' by ' + rect.h + replaced(outcome) + '.',
  placed: (ed, outcome) => ed.select([outcome.spaceId]),
});
