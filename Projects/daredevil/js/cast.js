// cast.js — the six characters Duke has a relationship with, as one table.
//
// Phase 3 (see WISHLIST.md). Before this file, every relationship rule was an
// `if` somewhere in engine.js: two priority ladders in goToScene, a
// `!== 'absent'` test per hub card, and `applyEffects` would write
// `rels.peet = 'aly'` and tell nobody. `rels.pete` was not seeded at all, so it
// was `undefined` until Free Roam 1 wrote it and `repairState` could not
// normalise a key it did not know. This table is the schema: which characters
// exist, which states each may hold, in what priority order, what each state
// is called on screen, and which state means "never met".
//
// A leaf on purpose. save.js reads it to seed and repair a run, state.js
// re-exports it, and scenes.js reads it to build `_needs` lists. It imports
// nothing, so nothing here can be read out of the temporal dead zone (see
// state.js's header for the cycle that rule exists to prevent).
//
// The array order is the order the two screens that list relationships print
// them in, and the order the pre-stunt routes ask in: Cal before Ruthie before
// Pete before Earl. Tommy and Danny have no route of their own, so they come
// last. Milestone 5's question is the one route that departs from it (Ruthie
// before Cal), and its table says so.

export const CAST = [
  {
    id: 'cal', name: 'Cal',
    states: ['neutral', 'warm', 'strained', 'loyal'],
    labels: { neutral: 'Neutral', warm: 'Warming Up', strained: 'Strained', loyal: 'Loyal Partner' },
    unmet: null, start: 'neutral',
  },
  {
    id: 'ruthie', name: 'Ruthie',
    states: ['unknown', 'solid', 'strained', 'absent'],
    labels: { unknown: '—', solid: 'Solid', strained: 'Strained', absent: 'Absent' },
    unmet: 'unknown', start: 'unknown',
  },
  {
    id: 'pete', name: 'Pete',
    states: ['unknown', 'hanger_on', 'ally', 'absent'],
    labels: { unknown: '—', hanger_on: 'Hanger-On', ally: 'Ally', absent: 'Absent' },
    unmet: 'unknown', start: 'unknown',
  },
  {
    id: 'earl', name: 'Earl Maddox',
    states: ['unknown', 'backer', 'mentor', 'antagonist', 'absent'],
    labels: { unknown: '—', backer: 'Business Partner', mentor: 'Mentor', antagonist: 'Antagonist', absent: 'Absent' },
    unmet: 'unknown', start: 'unknown',
  },
  {
    // No never-met state: Tommy dared Duke up the water tower as a boy and
    // finds him before nine on the morning of the fair. He starts as the guy
    // at the bar, can be given a job (Phase 4), and can be sent away by the
    // twelve hundred dollars.
    id: 'tommy', name: 'Tommy',
    states: ['hanger_on', 'ally', 'absent'],
    labels: { hanger_on: 'Hanger-On', ally: 'Ally', absent: 'Absent' },
    unmet: null, start: 'hanger_on',
  },
  {
    id: 'danny', name: 'Danny',
    states: ['unknown', 'frenemy', 'nemesis', 'poached', 'absent'],
    labels: { unknown: '—', frenemy: 'Frenemy', nemesis: 'Nemesis', poached: 'Poached', absent: 'Absent' },
    unmet: 'unknown', start: 'unknown',
  },
];

const BY_ID = Object.fromEntries(CAST.map(c => [c.id, c]));

/** The record for a character id, or undefined. */
export function castFor(id) { return BY_ID[id]; }

/** A fresh run's relationship bag: every character at its start state. */
export function startingRels() {
  return Object.fromEntries(CAST.map(c => [c.id, c.start]));
}

export function isLegalRel(id, state) {
  const c = BY_ID[id];
  return !!c && c.states.includes(state);
}

/** What a screen prints for a character, and for a state of that character.
 *  Unknown ids and states print raw, so a screen never blanks — the suite is
 *  what refuses them, not the renderer. */
export function castName(id) { const c = BY_ID[id]; return c ? c.name : id; }
export function relLabel(id, state) {
  const c = BY_ID[id];
  return (c && c.labels[state]) || state;
}

/**
 * The legal states of a character, minus any listed. This is how a scene or a
 * hub card declares a requirement as data: `_needs: { earl: statesOf('earl',
 * { not: ['absent'] }) }` is an array of names, readable without running the
 * game, which is what Phase 5's walker needs. An unknown id or an excluded
 * state that is not legal throws — a requirement built on a typo would
 * otherwise be a list that is quietly one name short.
 */
export function statesOf(id, { not = [] } = {}) {
  const c = BY_ID[id];
  if (!c) throw new Error(`cast: no character '${id}'`);
  for (const s of not) if (!c.states.includes(s)) throw new Error(`cast: '${id}' has no state '${s}'`);
  return c.states.filter(s => !not.includes(s));
}

/** The states in which a character is in the story: met, and not gone. */
export function presentStates(id) {
  const c = BY_ID[id];
  if (!c) throw new Error(`cast: no character '${id}'`);
  return c.states.filter(s => s !== c.unmet && s !== 'absent');
}

/** Is the character in the story right now — met, and not gone? */
export function isPresent(id, rels) { return presentStates(id).includes(rels[id]); }

/**
 * What the ending screen lists: every character who was ever in the story,
 * in the cast's order, with the label for where things stand. A character
 * still at the never-met state is left out rather than printed as "—"; one
 * who was met and then went is kept, as "Absent", because that is a thing
 * that happened. A state the table does not know prints raw, as elsewhere.
 */
export function rosterOf(rels) {
  return CAST
    .filter(c => rels[c.id] !== undefined && rels[c.id] !== c.unmet)
    .map(c => ({ id: c.id, name: c.name, label: relLabel(c.id, rels[c.id]) }));
}

/**
 * Does a relationship bag satisfy a `_needs` declaration? `needs` is
 * `{ id: [state, ...] }`, every entry must hold, and a missing or empty
 * declaration is always met. A value that is not an array is a mistake in the
 * data and throws rather than passing as "no requirement".
 */
export function meetsNeeds(needs, rels) {
  if (!needs) return true;
  for (const [id, states] of Object.entries(needs)) {
    if (!Array.isArray(states)) throw new Error(`_needs.${id} must be an array of states`);
    if (!states.includes(rels[id])) return false;
  }
  return true;
}

/**
 * The one door through which the game writes a relationship (#13: a guard
 * that only warns is a guard that gets ignored). An unknown character or a
 * state that character cannot hold throws, with the name in the message.
 */
export function setRel(rels, id, state) {
  if (!BY_ID[id]) throw new Error(`rels: no character '${id}' (writing '${state}')`);
  if (!isLegalRel(id, state)) throw new Error(`rels: '${id}' cannot be '${state}' (legal: ${BY_ID[id].states.join(', ')})`);
  rels[id] = state;
}

/**
 * Walk a route table and answer the first scene whose character is in one of
 * its listed states, or `fallback` when nobody is. A route is `{ who, states,
 * scene }`; the table's own order is the priority, and a state the character
 * cannot hold throws, so a route written against a state nothing can reach
 * fails the first time it is scanned rather than silently never matching —
 * which is what Milestone 5's `ruthie === 'warm'` did for three rounds.
 */
export function routeByCast(routes, rels, fallback) {
  for (const r of routes) {
    const c = BY_ID[r.who];
    if (!c) throw new Error(`route to ${r.scene}: no character '${r.who}'`);
    const bad = r.states.filter(s => !c.states.includes(s));
    if (bad.length) throw new Error(`route to ${r.scene}: '${r.who}' has no state ${bad.join('/')}`);
    if (r.states.includes(rels[c.id])) return r.scene;
  }
  return fallback;
}
