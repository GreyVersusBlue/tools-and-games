// Medal-based progression: the second mission of each aircraft unlocks once the first earns any medal.
// ?unlock=1 (or localStorage 'skywings64.unlockAll' = '1') opens everything, e.g. for testing.
import { MEDAL_ORDER } from './scoring.js';

// mission id -> id of the mission that must be medalled first
export const REQUIRES = { hg2: 'hg1', gc2: 'gc1', rb2: 'rb1' };

function unlockAll() {
  try {
    if (new URLSearchParams(location.search).get('unlock') === '1') return true;
    return localStorage.getItem('skywings64.unlockAll') === '1';
  } catch (e) { return false; }
}

const hasMedal = (b) => !!b && (MEDAL_ORDER[b.medal] || 0) > 0;

export function isUnlocked(mission, bests) {
  const req = REQUIRES[mission.id];
  return !req || unlockAll() || hasMedal(bests[req]);
}

// Set of locked mission ids for the current bests.
export function lockedSet(missions, bests) {
  const s = new Set();
  for (const m of missions) if (!isUnlocked(m, bests)) s.add(m.id);
  return s;
}

// Missions newly opened by going from bestsBefore to bestsAfter (for the results-screen callout).
export function newlyUnlocked(missions, bestsBefore, bestsAfter) {
  return missions.filter((m) => REQUIRES[m.id] && !isUnlocked(m, bestsBefore) && isUnlocked(m, bestsAfter));
}

export function requirementText(mission, missions) {
  const req = missions.find((m) => m.id === REQUIRES[mission.id]);
  return req ? 'EARN A MEDAL IN ' + req.name.toUpperCase() + ' TO UNLOCK' : '';
}
