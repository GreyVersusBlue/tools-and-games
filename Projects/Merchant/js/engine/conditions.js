// Conditions (ARCHITECTURE 5.6): { all }, { any } and the leaves below. A card's `when`
// and a choice's `requires` use the same ones. An unknown key throws, so a typo in
// content is an error and not a condition that quietly never holds.
import { seasonIndex, seasonName, year, actOf, SEASONS } from './calendar.js';
import { REP_GROUPS } from './state.js';

const LEAVES = {
  season: [], year: [], act: [], length: [], notebook: [], out: [], money: [],
  stock: ['gte'],
  flag: ['not', 'gte'],
  rep: ['gte', 'lte'],
  agent: ['hired', 'where'],
};

function only(cond, allowed, where) {
  for (const k of Object.keys(cond)) if (!allowed.includes(k)) throw new Error(`condition ${where}: unknown key "${k}"`);
}

function bounds(v, spec, where) {
  if (v === undefined || v === null || typeof v !== 'object') throw new Error(`condition ${where}: needs { gte } or { lte }`);
  only(v, ['gte', 'lte'], where);
  for (const k of ['gte', 'lte']) if (v[k] !== undefined && !isNum(v[k])) bad(`${where} ${k}`, 'a number', v[k]);
  return (v.gte === undefined || spec >= v.gte) && (v.lte === undefined || spec <= v.lte);
}

const isNum = n => typeof n === 'number' && Number.isFinite(n);
const isStr = s => typeof s === 'string' && s !== '';
const bad = (head, want, v) => { throw new Error(`condition ${head}: needs ${want}, got ${JSON.stringify(v)}`); };

/** Throws when a leaf's value has the wrong type, so a typo in content is an error and not a
    condition that quietly never (or always) holds. */
function typed(cond, head) {
  const v = cond[head];
  switch (head) {
    case 'season': if (!Array.isArray(v) || !v.length || !v.every(x => SEASONS.includes(x))) bad(head, `a list of season names (${SEASONS.join(', ')})`, v); break;
    case 'year': if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) bad(head, 'a [from, to] pair of numbers', v); break;
    case 'act': if (!Number.isInteger(v)) bad(head, 'a whole number', v); break;
    case 'length': case 'notebook': case 'stock': case 'flag': case 'rep': case 'agent': if (!isStr(v)) bad(head, 'a name', v); break;
  }
  for (const k of ['gte', 'lte']) if (head !== 'money' && head !== 'out' && cond[k] !== undefined && !isNum(cond[k])) bad(`${head} ${k}`, 'a number', cond[k]);
  if (cond.not !== undefined && typeof cond.not !== 'boolean') bad(`${head} not`, 'true or false', cond.not);
  if (cond.hired !== undefined && typeof cond.hired !== 'boolean') bad(`${head} hired`, 'true or false', cond.hired);
  if (cond.where !== undefined && !isStr(cond.where)) bad(`${head} where`, 'a name', cond.where);
}

/** True or false for one condition. `cond` may be undefined (no condition: true). */
export function holds(cond, state, content) {
  if (cond === undefined || cond === null) return true;
  if (typeof cond !== 'object' || Array.isArray(cond)) throw new Error('condition must be an object');
  if ('all' in cond) { only(cond, ['all'], 'all'); return cond.all.every(c => holds(c, state, content)); }
  if ('any' in cond) { only(cond, ['any'], 'any'); return cond.any.some(c => holds(c, state, content)); }

  const heads = Object.keys(cond).filter(k => k in LEAVES);
  if (heads.length !== 1) throw new Error(`condition ${JSON.stringify(cond)}: needs exactly one of ${Object.keys(LEAVES).join(', ')}`);
  const head = heads[0];
  only(cond, [head, ...LEAVES[head]], head);
  typed(cond, head);
  const v = cond[head];
  const idx = seasonIndex(state, content);

  switch (head) {
    case 'season': return v.includes(seasonName(idx));
    case 'year': { const y = year(content.calendar, idx); return y >= v[0] && y <= v[1]; }
    case 'act': return actOf(state, content) === v;
    case 'length': return state.length === v;
    case 'notebook': return state.notebook.includes(v);
    case 'out': return bounds(v, state.expeditions.length, 'out');
    case 'money': return bounds(v, state.money, 'money');
    case 'stock': {
      if (cond.gte === undefined) throw new Error('condition stock: needs gte');
      return (state.stock[v] ?? 0) >= cond.gte;
    }
    case 'flag': {
      let r = v in state.flags;
      if (cond.gte !== undefined) r = typeof state.flags[v] === 'number' && state.flags[v] >= cond.gte;
      return cond.not ? !r : r;
    }
    case 'rep': {
      if (!REP_GROUPS.includes(v)) throw new Error(`condition rep: unknown group "${v}"`);
      const n = state.rep[v];
      return (cond.gte === undefined || n >= cond.gte) && (cond.lte === undefined || n <= cond.lte);
    }
    case 'agent': {
      const a = state.agents[v];
      if (!a) throw new Error(`condition agent: unknown agent "${v}"`);
      return (cond.hired === undefined || a.hired === cond.hired) && (cond.where === undefined || a.where === cond.where);
    }
  }
}
