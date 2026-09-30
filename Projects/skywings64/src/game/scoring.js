// Scoring, medals, grades and persistent bests (localStorage).
export const RING_PTS = 100;
export const TARGET_PTS = 150;
export const LANDING_MAX = 500;
export const COMPLETE_PTS = 500;
export const TIME_MAX = 600;

const KEY = 'skywings64.bests.v1';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function maxPoints(mission, ringsTotal, targetsTotal, hasLanding) {
  let m = ringsTotal * RING_PTS + targetsTotal * TARGET_PTS;
  if (hasLanding) m += LANDING_MAX;
  m += COMPLETE_PTS;
  if (mission.timeLimit > 0) m += TIME_MAX;
  return m;
}

export function livePoints(ringsHit, targetsHit) {
  return ringsHit * RING_PTS + targetsHit * TARGET_PTS;
}

const MEDAL_NAMES = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
export function medalName(m) { return MEDAL_NAMES[m] || '-'; }
export const MEDAL_ORDER = { none: 0, bronze: 1, silver: 2, gold: 3 };

// run: {outcome:'landed'|'missed'|'crashed'|'splashed'|'timeup'|'quit', time, ringsHit, ringsTotal,
//       targetsHit, targetsTotal, hasLanding, landing:{distance, radius, quality}}
export function scoreRun(mission, run) {
  const completed = run.outcome === 'landed';
  const rings = run.ringsHit * RING_PTS;
  const targets = run.targetsHit * TARGET_PTS;
  let landing = 0;
  if (completed && run.landing) {
    const acc = clamp(1 - run.landing.distance / Math.max(1, run.landing.radius), 0, 1);
    const q = run.landing.quality || {};
    const vs = Math.abs(q.verticalSpeed || 0);
    const soft = clamp(1 - vs / 8, 0.25, 1);
    landing = Math.round(LANDING_MAX * (0.15 + 0.5 * acc + 0.35 * soft));
  } else if (completed) {
    landing = LANDING_MAX;
  }
  const complete = completed ? COMPLETE_PTS : 0;
  let timeBonus = 0;
  if (completed && mission.timeLimit > 0) {
    const f = clamp((mission.timeLimit - run.time) / (mission.timeLimit * 0.6), 0, 1);
    timeBonus = Math.round(TIME_MAX * f);
  }
  const total = rings + targets + landing + complete + timeBonus;
  const max = maxPoints(mission, run.ringsTotal, run.targetsTotal, run.hasLanding);
  const ratio = clamp(total / max, 0, 1);
  let medal = 'none';
  if (completed) {
    if (ratio >= 0.82) medal = 'gold';
    else if (ratio >= 0.62) medal = 'silver';
    else if (ratio >= 0.4) medal = 'bronze';
  }
  let grade = ratio >= 0.9 ? 'S' : ratio >= 0.78 ? 'A' : ratio >= 0.62 ? 'B' : ratio >= 0.46 ? 'C' : ratio >= 0.3 ? 'D' : 'F';
  if (!completed && (grade === 'S' || grade === 'A' || grade === 'B' || grade === 'C')) grade = 'D';
  return { completed, rings, targets, landing, complete, timeBonus, total, max, ratio, medal, grade };
}

export function loadBests() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) || {} : {};
  } catch (e) { return {}; }
}

// Returns {newBest:boolean, best}
export function saveBest(id, result, time) {
  const bests = loadBests();
  const old = bests[id];
  const better = !old || result.total > old.points;
  const medalBetter = old && (MEDAL_ORDER[result.medal] || 0) > (MEDAL_ORDER[old.medal] || 0);
  if (better || medalBetter) {
    bests[id] = {
      points: Math.max(result.total, old ? old.points : 0),
      medal: (MEDAL_ORDER[result.medal] || 0) >= (old ? MEDAL_ORDER[old.medal] || 0 : 0) ? result.medal : old.medal,
      grade: better ? result.grade : old.grade,
      time: better ? time : old.time,
    };
    try { localStorage.setItem(KEY, JSON.stringify(bests)); } catch (e) { /* ignore */ }
  }
  return { newBest: !!better, best: bests[id] };
}

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

// ---- presentation helpers (used by ui.js / hud.js)
const RATING_TITLES = { S: 'ACE PILOT', A: 'SKY CAPTAIN', B: 'FLIGHT LEADER', C: 'CADET', D: 'ROOKIE', F: 'GROUNDED' };
export function ratingTitle(grade) { return RATING_TITLES[grade] || ''; }
export function fmtNum(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
