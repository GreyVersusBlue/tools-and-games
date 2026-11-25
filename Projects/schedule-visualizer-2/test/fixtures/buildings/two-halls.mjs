// A building made to show crowd-aware routes at work (ARCHITECTURE 23.12):
// a west hall and an east hall of four rooms each, one cell wide and side by
// side, on a corridor with a second corridor running along beside it that is
// two cells longer to use (down, along, and up again).
//
//   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8
//   . A B C D . . . . . . . . . E F G H .      rooms 1A to 1D, 1E to 1H
//   # # # # # # # # # # # # # # # # # # #      the usual corridor
//   # # # # # # # # # # # # # # # # # # #      the spare one (left out by { spare: false })
//
// Eight groups, four from each hall, cross to the other hall in each of two
// transitions, in the same moment: the four from the west hall start in
// adjacent cells and follow one another along the usual corridor's eastbound
// lane, so the ones behind wait; the four from the east hall do the same
// westbound. Opposite flows do not block each other, so the spare corridor is
// where the building has room that habit ignores.
//
//   twoHalls({ spare: true, periods: 3, pattern })   a valid project, A Day only. Groups
//   are in their own hall in a period whose letter in `pattern` is h and in the
//   other hall where it is a (default 'hah' for 3 periods, then alternating):
//   a period whose letter is the previous one's is a transition nobody walks.
//   Groups are West 1 to West 4 (gplan00001 to 4) and East 1 to East 4 (gplan00005 to 8),
//   each of 25 (the default head count).
//   HALLS                                   the numbers asserted against

import { planProject, roomId } from './plans.mjs';
import { emptySlot, emptyBells, GROUP_COLOUR_PRESETS } from '../../../engine/schema.js';

export const HALLS = { groups: 8, rooms: 8, westRooms: ['1A', '1B', '1C', '1D'], eastRooms: ['1E', '1F', '1G', '1H'], extraCells: 2 };

export function twoHalls(options) {
  const opts = options || {};
  const spare = opts.spare !== false;
  const periods = typeof opts.pattern === 'string' ? opts.pattern.length : Number.isInteger(opts.periods) ? opts.periods : 3;
  const width = 19;
  const rows = ['.ABCD.........EFGH.', '#'.repeat(width)];
  if (spare) rows.push('#'.repeat(width));
  const project = planProject([rows]);
  project.settings.periods = periods;
  for (const dayType of project.dayTypes) dayType.bells = emptyBells(periods);
  const letters = typeof opts.pattern === 'string' ? opts.pattern : Array.from({ length: periods }, (unused, p) => (p % 2 === 0 ? 'h' : 'a')).join('');
  const names = [...HALLS.westRooms.map((room, i) => ['West ' + (i + 1), room, HALLS.eastRooms[i]]), ...HALLS.eastRooms.map((room, i) => ['East ' + (i + 1), room, HALLS.westRooms[i]])];
  project.groups = names.map(([name, home, away], index) => ({
    id: 'gplan' + String(index + 1).padStart(5, '0'),
    name,
    grade: '',
    headCount: null,
    colour: GROUP_COLOUR_PRESETS[index],
    days: { [project.dayTypes[0].id]: Array.from({ length: periods }, (unused, p) => ({ ...emptySlot(), room: roomId(letters[p] === 'h' ? home : away) })) },
  }));
  return project;
}
