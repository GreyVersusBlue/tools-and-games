// What an agent's traits do (ARCHITECTURE 5.5). Tables only: a number multiplies the thing it
// names, and an absent number is 1. Letters from the road come in a later unit and will live
// in this file beside the tables.
//
//   risk    the chance a leg's season goes wrong (routes.js rolls it)
//   sell    what the agent gets for a load sold at a stop (1.05 is five percent more)
//   buy     what a load costs the agent at a stop (0.95 is five percent less)
//   slow    seasons added to a leg of SLOW_FROM seasons or more (a careful agent takes the safer,
//           slower way on a long leg, ARCHITECTURE 4.3 step 2)
//
// `knows-<stop>` helps only at that stop and on legs that start or end there.
// `speaks-<language>` does nothing to the numbers yet; letters will read it.
//
// Below the trait tables: trust and reputation (ARCHITECTURE 4.11). Trust is per agent and
// reputation per group, both -3 to 3, and the rules that move them or read them are here, each a
// small function with a named case in test/agents.mjs.
import { seasonIndex } from './calendar.js';
import { addPaper, cityOf, REP_GROUPS } from './state.js';

export const TRAIT_TABLE = {
  careful: { risk: 0.5, slow: 1 },
  bold: { risk: 1.25 },
  honest: {},
  sharp: { sell: 1.05, buy: 0.95 },
};
export const SLOW_FROM = 2;   // a leg this many seasons long or longer is the one a careful agent slows
export const KNOWS = { risk: 0.85, sell: 1.03, buy: 0.97 };

const num = (t, k) => t?.[k] ?? 1;

/** The traits of an agent record from agents.json (a list of strings), or none. */
const traitsOf = agent => agent?.traits ?? [];

/** Multiplier on a leg's risk for this agent. */
export function riskFactor(agent, leg) {
  let f = 1;
  for (const t of traitsOf(agent)) {
    if (t.startsWith('knows-')) { const stop = t.slice(6); if (leg.from === stop || leg.to === stop) f *= KNOWS.risk; }
    else f *= num(TRAIT_TABLE[t], 'risk');
  }
  return f;
}

/** Multiplier on a price this agent gets at `stopId`; side is "sell" or "buy". */
export function bargain(agent, stopId, side) {
  let f = 1;
  for (const t of traitsOf(agent)) {
    if (t.startsWith('knows-')) { if (t.slice(6) === stopId) f *= KNOWS[side]; }
    else f *= num(TRAIT_TABLE[t], side);
  }
  return f;
}

/** Seasons this agent takes to ride `leg`: its own length, plus one for a careful agent on a leg
    of two seasons or more. A one-season leg is the same for everyone. */
export function legSeasons(agent, leg) {
  if (leg.seasons < SLOW_FROM) return leg.seasons;
  let extra = 0;
  for (const t of traitsOf(agent)) extra += TRAIT_TABLE[t]?.slow ?? 0;
  return leg.seasons + extra;
}

// ---------------------------------------------------------------------------------------------
// Trust and reputation (ARCHITECTURE 4.11, DESIGN 4.9)

export const LEAVES_AT = -2;      // an agent at home with trust this low or lower leaves at the next opening
export const WARY_AT = -1;        // trust this low or lower acts as careful whatever the traits
export const STEP_AT = 2;         // a season's net trust change among hired agents must be this large either way to move rep.agents
export const UNFAIR_LIMIT = 2;    // this many `unfair` memories and the agent wants a share, not a wage
export const UNFAIR = 'unfair';   // the memory an unpaid wage leaves
export const BLAMED = 'blamed';   // the memory a report answered "You should have waited" leaves (data: a letter choice's `memory` effect)

// The trust of every agent at the last opening, kept as the one log entry of this kind (a new one
// replaces it, so the log grows by one entry, not one a season).
const NOTED = 'trust';
const clamp3 = n => Math.max(-3, Math.min(3, n));

// The five-step scale of DESIGN 4.9, one table for trust and for reputation. Seven numbers go into
// five steps with the middle three wider at the ends: -3, then -2 and -1, 0, 1 and 2, then 3.
export const SCALE = {
  group: ['They will not deal with you', 'They deal with you warily', 'They deal with you as with anyone',
    'They speak well of you', 'They come to you first'],
  agent: ['has lost faith in the house', 'is uneasy with the house', 'has no strong feeling about the house',
    'trusts the house', 'would follow the house anywhere'],
};

/** Which of the five steps a number from -3 to 3 falls in. */
export const stepOf = n => (n <= -3 ? 0 : n < 0 ? 1 : n === 0 ? 2 : n < 3 ? 3 : 4);

/** The words for a number: who is "agent" (for an agent's trust) or "group" (for a reputation). */
export const scaleWords = (n, who = 'group') => SCALE[who][stepOf(n)];

/** An agent's step on the scale. Trust at LEAVES_AT or lower is the bottom step, so the words on the
    page at -2 are the ones the refusal says ("has lost faith in the house"): one story, MER-61c. The
    reputation table keeps `stepOf`. */
export const agentStep = n => (n <= LEAVES_AT ? 0 : stepOf(n));

/** For view(): trust in words for every agent and standing in words for every group, each with its number. */
export function standing(s, content) {
  const trust = {}, rep = {};
  for (const a of content.agents ?? []) {
    const n = s.agents[a.id]?.trust ?? 0;
    const step = agentStep(n);
    trust[a.id] = { n, step, words: SCALE.agent[step] };
  }
  for (const g of REP_GROUPS) rep[g] = { n: s.rep[g], step: stepOf(s.rep[g]), words: scaleWords(s.rep[g], 'group') };
  return { trust, rep };
}

const unfairCount = rec => (rec?.memory ?? []).filter(m => m.kind === UNFAIR).length;

/** The trust an agent loses or gains on coming home (the return's one line in routes.js), applied to
    the record and returned. `r` is { qirad, agentShare, agentShort, wage, wageShort, lost, since }:
    a qirad share paid in full is +1 (a share of nothing is not a payment); an own contract's wage the
    house could not pay is -1 and an `unfair` memory; a loss on the road the house blamed on the agent
    (a `blamed` memory written since the expedition left, by a report answered "You should have
    waited") is -1. */
export function returnTrust(s, content, x, r, idx) {
  const rec = s.agents[x.agent];
  let by = 0;
  if (r.qirad && r.agentShare > 0 && r.agentShort === 0) by += 1;
  if (!r.qirad && r.wage > 0 && r.wageShort > 0) { by -= 1; rec.memory.push({ at: idx, kind: UNFAIR }); }
  // the way back: a trip whose wage was paid up front and came home paid in full clears one `unfair` memory
  if (r.prepaid && !r.qirad && r.wageShort === 0 && r.agentShort === 0) {
    const i = rec.memory.findIndex(m => m.kind === UNFAIR);
    if (i >= 0) rec.memory.splice(i, 1);
  }
  if (r.lost && rec.memory.some(m => m.kind === BLAMED && m.at >= r.since && m.at <= idx)) by -= 1;
  rec.trust = clamp3(rec.trust + by);
  return by;
}

/** Trust of -1 or lower: the agent acts as careful on every trait default, whatever the traits
    (RM 3.3). Read by letters.js where a trait would decide the agent's answer. */
export const wary = (s, agentId) => (s.agents[agentId]?.trust ?? 0) <= WARY_AT;

/** Two or more `unfair` memories: the agent will not go on a wage again and asks for a qirad share.
    The words `outfit` gives, or null when the agent will go. */
export function refusesOwn(s, agent, qirad = true) {
  if (unfairCount(s.agents[agent.id]) < UNFAIR_LIMIT) return null;
  const why = `${agent.name} will not go for a wage again, because the house did not pay what it promised before.`;
  return qirad ? `${why} ${agent.name} asks for a qirad share.` : why;
}

/** An agent at home with trust -2 or lower is about to leave and takes no new trip, on any contract,
    so the house cannot keep them on the road to dodge the leaving. The words `outfit` gives, or null. */
export function refusesAny(s, agent) {
  if ((s.agents[agent.id]?.trust ?? 0) > LEAVES_AT) return null;
  return `${agent.name} has lost faith in the house and will not go out again.`;
}

/** How an agent who is `gone` went: 'retired' (the jump's retirement) or 'house' (they left for another
    house, at an opening or at a jump with trust -2 or lower, or an older record that says nothing). Read
    from the jump entries in the log, which name each agent who left and why; null when the agent is here. */
export function leftHow(s, agentId) {
  if (s.agents[agentId]?.where !== 'gone') return null;
  for (const e of s.log) if (e.kind === 'jump' && (e.agents ?? []).some(a => a.id === agentId && a.left === 'retired')) return 'retired';
  return 'house';
}

// Invented houses an agent may go to work for; chosen from the agent's place in the book, not drawn,
// so leaving never moves the seeded stream.
export const RIVALS = ['Karimi', 'Mansur', 'Qasim', 'Hadid'];

/** The one sentence of why: from the agent's last memory, since a number alone says nothing. */
function reason(rec, name) {
  const last = [...(rec.memory ?? [])].reverse().find(m => m.kind === UNFAIR || m.kind === BLAMED);
  if (last?.kind === UNFAIR) return `${name} says the house did not pay what it promised.`;
  if (last?.kind === BLAMED) return `${name} says the house blamed them for a loss that was not their fault.`;
  return `${name} says the house did not keep faith.`;
}

/** What `rep.agents` is owed for a season: the net trust change among agents the house has hired,
    against the note taken at the opening. Only a net change of 2 or more either way moves it, and by
    one step. A card's direct `rep: agents` effect already moved it, so a step the same way as that
    direct move is not taken again. */
function owed(s, was) {
  let net = 0;
  for (const [id, r] of Object.entries(s.agents)) if (r.hired && id in was.trust) net += r.trust - was.trust[id];
  if (Math.abs(net) < STEP_AT) return 0;
  const step = Math.sign(net);
  return Math.sign(s.rep.agents - (was.rep ?? s.rep.agents)) === step ? 0 : step;
}

/** Closing step "settle": after the season's answers and its closing, before the calendar moves, so
    a season before an act jump and the last season count too (the jump halves trust and is not the
    house's doing, and nothing is read after it). Moves `rep.agents` by `owed`. */
export function settle(s) {
  const was = s.log.find(e => e.kind === NOTED);
  if (was) s.rep.agents = clamp3(s.rep.agents + owed(s, was));
}

/** Opening step "agents": the first thing that runs when a season opens, before the returns.
    1. An agent at home with trust -2 or lower leaves: hired false, where "gone", a notice paper that
       names them and says why.
    2. The trust of every agent and `rep.agents` are noted, in the log, for the closing's `settle`. */
export function opening(s, content) {
  const idx = seasonIndex(s, content);
  (content.agents ?? []).forEach((a, i) => {
    const rec = s.agents[a.id];
    if (!rec?.hired || rec.trust > LEAVES_AT || rec.where !== cityOf(content, 'agents').home || s.expeditions.some(x => x.agent === a.id)) return;
    rec.hired = false;
    rec.where = 'gone';
    const house = RIVALS[i % RIVALS.length];
    const headline = `${a.name} has gone to work for the ${house} house. ${reason(rec, a.name)}`;
    const shown = addPaper(s, { kind: 'notice', ref: 'agent-left', agent: a.id, data: { headline, title: `${a.name} has left`, body: headline } });
    s.log.push({ at: idx, kind: 'left', ref: a.id, choice: 'trust', ...(shown ? {} : { dropped: 'notice' }) });
  });
  s.log = s.log.filter(e => e.kind !== NOTED);
  s.log.push({ at: idx, kind: NOTED, trust: Object.fromEntries(Object.entries(s.agents).map(([id, r]) => [id, r.trust])), rep: s.rep.agents });
}
