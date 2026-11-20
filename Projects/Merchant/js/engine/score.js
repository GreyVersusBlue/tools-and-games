// The score (ARCHITECTURE 4.10): pure, reads the state and the content, changes nothing.
// Four parts, each with its points and one line of reason in words, then the house's
// multiplier on their sum, then a rank word from the city's `ranks`. The wealth scale and
// the ranks are the city's (city.json `score`); the other rates are the game's, below.
import { REP_GROUPS, cityOf, find } from './state.js';

export const REP_POINTS = 3;        // points per step of reputation, summed over the four groups (floor 0)
export const HOME_POINTS = 6;       // per agent alive and home
export const HOME_TRUST_BONUS = 4;  // more for one whose trust is 2 or 3
export const TRUST_BONUS_AT = 2;
export const NOTEBOOK_POINTS = 0.5; // per entry found

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Points for `net` along a scale of [value, points] pairs: straight between two steps, the
    first step's points at or under its value, the last step's at or over it. */
export function scaled(scale, net) {
  if (!scale.length || net <= scale[0][0]) return scale.length ? scale[0][1] : 0;
  for (let i = 1; i < scale.length; i++) {
    const [x0, y0] = scale[i - 1], [x1, y1] = scale[i];
    if (net <= x1) return y0 + (y1 - y0) * (net - x0) / (x1 - x0);
  }
  return scale[scale.length - 1][1];
}

/** What the house holds at the end, in the city's money: money, plus stock at the last known
    price at home (a good with no known price counts for nothing), less what is owed. */
export function netWealth(state, content) {
  const home = cityOf(content, 'score').home;
  let stock = 0;
  for (const [g, n] of Object.entries(state.stock ?? {})) stock += n * (state.known?.[home]?.[g]?.p ?? 0);
  const owed = (state.loans ?? []).reduce((a, l) => a + l.principal, 0);
  return { money: state.money, stock, owed, net: state.money + stock - owed };
}

export function score(state, content) {
  const city = cityOf(content, 'score');
  const cfg = city.score ?? {};
  const money = city.currency ?? 'coins';
  const parts = [];

  const w = netWealth(state, content);
  parts.push({
    id: 'wealth', points: Math.round(scaled(cfg.wealthScale ?? [], w.net)),
    reason: `The house holds ${w.net} ${money} after its stock is counted at the last prices known at home and ${w.owed ? `${w.owed} owed is paid` : 'nothing is owed'}.`,
  });

  const repSum = REP_GROUPS.reduce((a, g) => a + (state.rep?.[g] ?? 0), 0);
  parts.push({
    id: 'reputation', points: Math.max(0, repSum * REP_POINTS),
    reason: repSum > 0 ? `Standing with partners, agents, the court and foreign merchants adds up to ${repSum}.`
      : 'Standing with partners, agents, the court and foreign merchants adds up to nothing.',
  });

  const home = cityOf(content, 'score').home;
  const here = (content.agents ?? []).map(a => state.agents?.[a.id]).filter(r => r?.hired && r.where === home);
  const trusted = here.filter(r => r.trust >= TRUST_BONUS_AT).length;
  parts.push({
    id: 'people', points: here.length * HOME_POINTS + trusted * HOME_TRUST_BONUS,
    reason: here.length
      ? `${plural(here.length, 'agent', 'agents')} alive and home${trusted ? `, ${trusted} of them trusted` : ''}.`
      : 'No agent of the house is alive and at home.',
  });

  const pages = (state.notebook ?? []).length;
  parts.push({
    id: 'notebook', points: pages * NOTEBOOK_POINTS,
    reason: pages ? `${plural(pages, 'page', 'pages')} in the notebook.` : 'The notebook is empty.',
  });

  const sum = parts.reduce((a, p) => a + p.points, 0);
  const multiplier = find(content.houses, state.house, 'house').multiplier ?? 1;
  const total = Math.round(sum * multiplier);
  const ranks = [...(cfg.ranks ?? [])].sort((a, b) => a.from - b.from);
  const rank = ranks.reduce((r, k) => (total >= k.from ? k.name : r), ranks[0]?.name ?? '');
  return { parts, sum, multiplier, total, rank };
}
