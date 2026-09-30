import { TEAM } from '../core/constants.js';

// Strategic lookout-ward spots for bots, listed for Sunward (Duskward = point mirror). Lower prio = placed first.
// `from` = earliest game time (s) the spot is worth warding.
const SUNWARD_OBS = [
  { pos: [-30, -14], prio: 0, from: 0, name: 'top rune river' },
  { pos: [14, 30], prio: 0, from: 0, name: 'bottom rune river' },
  { pos: [-10, 4], prio: 1, from: 0, name: 'mid river' },
  { pos: [-34, -28], prio: 1, from: 900, name: 'grimmaw lair' },
  { pos: [-46, 18], prio: 2, from: 0, name: 'sunward top jungle' },
  { pos: [2, 52], prio: 2, from: 0, name: 'sunward bottom jungle' },
  { pos: [40, -8], prio: 3, from: 600, name: 'duskward jungle entrance' },
  { pos: [-6, -40], prio: 3, from: 600, name: 'duskward top jungle' },
];

const mirror = (s) => ({ ...s, pos: [-s.pos[0], -s.pos[1]] });
export const WARD_SPOTS = {
  [TEAM.SUNWARD]: SUNWARD_OBS,
  [TEAM.DUSKWARD]: SUNWARD_OBS.map(mirror),
};
// Sentries go where the enemy likes to put observers on our side of the map.
export const SENTRY_SPOTS = {
  [TEAM.SUNWARD]: WARD_SPOTS[TEAM.DUSKWARD].filter((s) => s.prio >= 3).map((s) => ({ ...s, prio: 0 })).concat(WARD_SPOTS[TEAM.SUNWARD].filter((s) => s.prio <= 1)),
  [TEAM.DUSKWARD]: WARD_SPOTS[TEAM.SUNWARD].filter((s) => s.prio >= 3).map((s) => ({ ...s, prio: 0 })).concat(WARD_SPOTS[TEAM.DUSKWARD].filter((s) => s.prio <= 1)),
};
