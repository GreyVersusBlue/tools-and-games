// The fresh state (ARCHITECTURE 3) and the small lookups every module shares.
import { playedSeasons } from './calendar.js';

export const REP_GROUPS = ['partners', 'agents', 'court', 'foreign'];
export const SAVE_VERSION = 1;
export const MAX_PAPERS = 5; // DESIGN 2, ARCHITECTURE 4.2

/** True when no paper more fits on the desk. */
export const deskFull = (state, extra = 1) => state.desk.length + extra > MAX_PAPERS;

/** The one place a paper goes onto the desk (ARCHITECTURE 4.2), so the cap of MAX_PAPERS holds
    on every path: notices, follow-ups, a {card} effect, drawn cards. Returns false and leaves
    the desk alone when it is full. `first` puts a follow-up after the papers already
    waiting to be numbered, which is firing order, and ahead of any paper numbered. */
export function addPaper(state, paper, { first = false } = {}) {
  if (deskFull(state)) return false;
  const p = { id: null, state: 'open', ...paper };
  if (first) {
    let k = 0;
    while (k < state.desk.length && state.desk[k].id === null) k++;
    state.desk.splice(k, 0, p);
  } else state.desk.push(p);
  return true;
}

/** content.city, or a clear error when the content has none (a city.json that never loaded). */
export function cityOf(content, who) {
  const c = content?.city;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !c.id) {
    throw new Error(`${who}: content.city is missing, so the city's id, home and opening papers are unknown`);
  }
  return c;
}

export function find(list, id, what) {
  const hit = (list ?? []).find(x => x.id === id);
  if (!hit) throw new Error(`unknown ${what} "${id}"`);
  return hit;
}

export function freshState(content, { seed, length, house }) {
  if (!Number.isInteger(seed)) throw new Error('freshState: seed must be an integer');
  const city = cityOf(content, 'freshState');
  playedSeasons(content.calendar, length); // throws on a length the calendar lacks
  const h = find(content.houses, house, 'house');

  const market = {};
  for (const stop of content.stops ?? []) {
    market[stop.id] = {};
    for (const g of Object.keys(stop.sells ?? {})) market[stop.id][g] = { f: 1.0, glut: 0 };
  }
  const agents = {};
  for (const a of content.agents ?? []) {
    agents[a.id] = { hired: (h.agents ?? []).includes(a.id), where: a.home ?? city.home, trust: 0, memory: [] };
  }
  const rep = Object.fromEntries(REP_GROUPS.map(g => [g, 0]));
  Object.assign(rep, h.rep ?? {});

  return {
    v: SAVE_VERSION,
    city: city.id,
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
