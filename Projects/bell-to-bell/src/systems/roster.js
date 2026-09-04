import { createRng } from './rng.js';

// Phase 2 — KIDS NOBODY AUTHORED.
//
// Twelve students out of one integer. Three rosters were typed by hand and
// every one of them made the same four promises without saying so: somebody
// in the room settles the desks around them, somebody is at the edge, the
// aptitudes are spread wide enough that reteaching the bottom third means
// something, and no two names read alike on a paper chart. This module makes
// the same promises out loud — rosterProblems() is the list of them — and
// draws until it can keep all four, which with stratified draws is almost
// always the first try. The reroll is a backstop, not the mechanism.
//
// Pure: same seed, same twelve kids, on any machine, on any day. The tell
// schedule (systems/scheduler.js) is the seed plus the day; the roster is the
// seed alone, because the class has to be the same class on Tuesday.

const round2 = v => Math.round(v * 100) / 100;
const clamp01 = v => Math.max(0, Math.min(1, v));
const prefix = name => name.slice(0, 2).toLocaleLowerCase();

// Twelve temperaments, one per twelfth of the range, shuffled — so the room
// always has a calm end and a loud end, and the draw decides who is at each.
function stratified(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((i + rng.next()) / n);
  return rng.shuffle(out);
}

function draw(rng, gen) {
  const R = gen.roster, dist = gen.distributions, n = R.size;

  // Names: walk a shuffled pool and refuse anything that shares its first two
  // letters with a name already taken. That is the "reads alike" rule.
  const names = [];
  const taken = new Set();
  for (const name of rng.shuffle(gen.names)) {
    if (names.length >= n) break;
    const p = prefix(name);
    if (taken.has(p)) continue;
    taken.add(p);
    names.push(name);
  }

  const temper = stratified(rng, n);
  const apt = stratified(rng, n);
  const lerp = (d, t) => d.min + (d.max - d.min) * t;
  const jitter = d => (rng.next() - 0.5) * 2 * (d.noise || 0);

  const roster = names.map((name, i) => ({
    name,
    aptitude: round2(lerp(dist.aptitude, apt[i])),
    shirt: gen.shirts[i % gen.shirts.length],
    // Loud kids are rarely the steady ones and steady kids are rarely loud;
    // the noise is what keeps that from being a rule.
    tension: round2(clamp01(lerp(dist.tension, temper[i]) + jitter(dist.tension))),
    steady: round2(clamp01(lerp(dist.steady, 1 - temper[i]) + jitter(dist.steady)))
  }));

  // Notes. The steadiest kid gets a stabiliser line and the loudest an edge
  // line, because those are the two the chart screen is quietly about; the
  // rest go to whoever, and most kids get none, same as the authored rosters.
  const count = rng.int(R.notes.min, R.notes.max);
  const bySteady = roster.map((s, i) => i).sort((a, b) => roster[b].steady - roster[a].steady);
  const byTension = roster.map((s, i) => i).sort((a, b) => roster[b].tension - roster[a].tension);
  const noted = new Set();
  const give = (i, pool) => {
    if (noted.has(i) || !pool.length) return;
    roster[i].note = rng.pick(pool);
    noted.add(i);
  };
  give(bySteady[0], gen.notes.stabiliser);
  give(byTension[0], gen.notes.edge);
  const anyPool = rng.shuffle(gen.notes.any);
  for (const i of rng.shuffle(roster.map((s, k) => k))) {
    if (noted.size >= count || !anyPool.length) break;
    if (noted.has(i)) continue;
    roster[i].note = anyPool.pop();
    noted.add(i);
  }
  return roster;
}

// Everything a roster promises the rest of the game. Empty means it keeps
// every promise. The suite and the soak both read this rather than re-deriving
// the rules, so a rule changed here is changed everywhere.
export function rosterProblems(roster, gen) {
  const R = gen.roster, dist = gen.distributions, out = [];
  if (!Array.isArray(roster) || roster.length !== R.size) {
    return [`${roster?.length ?? 'no'} students, not ${R.size}`];
  }
  const seen = new Map();
  for (const s of roster) {
    if (typeof s.name !== 'string' || !s.name) { out.push('a student with no name'); continue; }
    const p = prefix(s.name);
    if (seen.has(p)) out.push(`${seen.get(p)} and ${s.name} read alike on the chart`);
    seen.set(p, s.name);
    if (!gen.names.includes(s.name)) out.push(`${s.name} is not in the name pool`);
    if (!gen.shirts.includes(s.shirt)) out.push(`${s.name} has no shirt`);
    for (const k of ['aptitude', 'tension', 'steady']) {
      if (!Number.isFinite(s[k])) out.push(`${s.name} has no ${k}`);
    }
    if (s.aptitude < dist.aptitude.min - 1e-9 || s.aptitude > dist.aptitude.max + 1e-9) {
      out.push(`${s.name}'s aptitude ${s.aptitude} is outside the distribution`);
    }
    if (s.tension < 0 || s.tension > 1 || s.steady < 0 || s.steady > 1) {
      out.push(`${s.name}'s temperament is outside 0..1`);
    }
  }
  const stab = roster.filter(s => s.steady >= R.stabiliserSteady).length;
  if (stab < R.stabilisers.min || stab > R.stabilisers.max) {
    out.push(`${stab} genuine stabilisers (steady >= ${R.stabiliserSteady}); wanted ${R.stabilisers.min}..${R.stabilisers.max}`);
  }
  const edge = roster.filter(s => s.tension >= R.edgeTension).length;
  if (edge < R.edges.min || edge > R.edges.max) {
    out.push(`${edge} kids at the edge (tension >= ${R.edgeTension}); wanted ${R.edges.min}..${R.edges.max}`);
  }
  const apts = roster.map(s => s.aptitude);
  const spread = Math.max(...apts) - Math.min(...apts);
  if (spread < R.aptitudeSpread - 1e-9) {
    out.push(`aptitude spread ${round2(spread)} is narrower than ${R.aptitudeSpread}; reteach would mean nothing`);
  }
  const notes = roster.filter(s => s.note).map(s => s.note);
  if (new Set(notes).size !== notes.length) out.push('two kids have the same note');
  if (notes.length < R.notes.min || notes.length > R.notes.max) {
    out.push(`${notes.length} notes; wanted ${R.notes.min}..${R.notes.max}`);
  }
  return out;
}

// The roster for a seed. Throws, loudly, if the pool and the distributions in
// data/generation.json cannot produce a roster that keeps its promises inside
// the reroll cap — that is a data bug, not a bad day, and it should not be
// papered over with whatever the last draw happened to be.
export function generateRoster(seed, gen) {
  const rng = createRng(seed);
  let last = null;
  for (let attempt = 0; attempt < gen.roster.rerollCap; attempt++) {
    const roster = draw(rng, gen);
    last = rosterProblems(roster, gen);
    if (!last.length) return roster;
  }
  throw new Error(`Roster seed ${seed}: no roster kept its promises in ` +
    `${gen.roster.rerollCap} draws. Last problems: ${last.join('; ')}`);
}
