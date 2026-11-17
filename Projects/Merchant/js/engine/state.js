// The fresh state (ARCHITECTURE 3) and the small lookups every module shares.
import { playedSeasons } from './calendar.js';

export const REP_GROUPS = ['partners', 'agents', 'court', 'foreign'];
export const SAVE_VERSION = 1;

export function find(list, id, what) {
  const hit = (list ?? []).find(x => x.id === id);
  if (!hit) throw new Error(`unknown ${what} "${id}"`);
  return hit;
}

export function freshState(content, { seed, length, house }) {
  if (!Number.isInteger(seed)) throw new Error('freshState: seed must be an integer');
  playedSeasons(content.calendar, length); // throws on a length the calendar lacks
  const h = find(content.houses, house, 'house');

  const market = {};
  for (const stop of content.stops ?? []) {
    market[stop.id] = {};
    for (const g of Object.keys(stop.sells ?? {})) market[stop.id][g] = { f: 1.0, glut: 0 };
  }
  const agents = {};
  for (const a of content.agents ?? []) {
    agents[a.id] = { hired: (h.agents ?? []).includes(a.id), where: a.home ?? content.city.home, trust: 0, memory: [] };
  }
  const rep = Object.fromEntries(REP_GROUPS.map(g => [g, 0]));
  Object.assign(rep, h.rep ?? {});

  return {
    v: SAVE_VERSION,
    city: content.city.id,
    length,
    house,
    seed,
    rng: seed >>> 0,
    t: 0,
    phase: 'desk',
    money: h.money ?? 0,
    loans: [],
    stock: { ...(h.stock ?? {}) },
    market,
    known: {},
    expeditions: [],
    agents,
    rep,
    desk: [],
    done: [],
    queue: [],
    flags: {},
    seen: {},
    notebook: [],
    log: [],
    score: null,
  };
}
