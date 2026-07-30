// save.js — Daredevil's persistence, on top of the shared gvb-save module.
//
// Daredevil shipped with zero localStorage calls. For a story this long that is
// the defining limitation: a full run is over 250 decisions and something like
// an hour of reading, and nothing survived closing the tab.
//
// WHAT THE SAVE HOLDS, AND WHY
//
// A scene id, the five stats, the six relationships, and the flag bag. That is
// all. It deliberately does NOT hold:
//
//   - the current line index inside a scene. Resume lands at the top of the
//     scene you were in, so re-reading three paragraphs is the worst case and
//     rewriting a scene's prose can never strand a save mid-sentence.
//   - anything from SCENES. The save names a node; it does not embed the story.
//     That is what lets the writing keep changing after players have saves.
//   - minigame state. A stunt run is two seconds of physics; there is nothing
//     to resume. Persistence is suppressed while the minigame screen is up, so
//     a reload during a jump puts you back at the pre-stunt scene with the
//     choice still in front of you.
//
// The key is `daredevil-save-v1` and it does not change (locked decision #36).
//
// Fill-ins live in `repair`, not `migrate` (locked decision #37). There are no
// legacy saves for this game yet, which makes this the one chance to get the
// split right before there are: `migrate` runs only on version drift, `repair`
// runs on every accepted load from every door.
//
// The import is relative so `node Projects/daredevil/test/smoke-save.mjs` can
// resolve it. Node cannot resolve a leading slash.

import { createSaveSlot, mountSaveBar } from '../../../assets/js/gvb-save.js';

export { mountSaveBar };

export const KEY = 'daredevil-save-v1';
export const VERSION = 1;
export const STAT_MAX = 5;
export const STAT_NAMES = ['nerve', 'precision', 'showmanship', 'condition', 'hustle'];

/** Where a resumed save puts the player back. Anything else is repaired to 'panel'. */
export const SCREENS = ['panel', 'hub', 'end'];

/** Flags whose value is a list of ids. If one of these is not an array, the hub
 *  that reads it throws on `.includes`, so `repair` forces them back. */
const LIST_FLAGS = [
  'hubDayScenesDone', 'hubEveningsDone',
  'fr2DayScenesDone', 'fr2EveningsDone',
  'fr3DayScenesDone', 'fr3EveningsDone',
  'fr4DayScenesDone', 'fr4EveningsDone',
];

/**
 * A brand-new run.
 *
 * Passed to `createSaveSlot` as a factory rather than a literal. Nothing here
 * is random today, so a literal would work — but `slot.reset()` handing back a
 * shared, mutable template is a trap the Fourth Quarter already fell into from
 * the other direction, and a factory costs nothing.
 */
export function freshState() {
  return {
    name: 'Duke Harlan',
    town: 'Buford County',
    stats: { nerve: 3, precision: 3, showmanship: 3, condition: 3, hustle: 2 },
    rels: { cal: 'neutral', ruthie: 'unknown', tommy: 'hanger_on', earl: 'unknown', danny: 'unknown' },
    flags: {
      originTrait: null,
      familyOrigin: null,
      ruthieEstablished: false,
      calWarmed: false,
      calStrained: false,
      dannySchemed: false,
      dannyMet: false,
      stuntOutcome: null,
      earlApproached: false,
      earlResponse: null,
      pressAtFair: false,
      rickySigned: false,
      rickyLegacy: false,
      fairOrganizerDone: false,
      wannabeMet: false,
      hubEvenings: 5,
      hubEveningsUsed: 0,
      hubDayScenesDone: [],
      hubEveningsDone: [],
    },
    scene: null,
    screen: 'panel',
  };
}

/**
 * Is this a Daredevil save at all?
 *
 * Deliberately structural and nothing more. Anything a hand-edited or
 * truncated save can be missing is `repair`'s problem; this only has to refuse
 * a blob that was never one of ours — another game's export, a JSON array, a
 * config file someone picked by mistake.
 */
export function validateState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (typeof s.name !== 'string') return false;
  if (!s.stats || typeof s.stats !== 'object' || Array.isArray(s.stats)) return false;
  if (!s.flags || typeof s.flags !== 'object' || Array.isArray(s.flags)) return false;
  if (s.scene != null && typeof s.scene !== 'string') return false;
  return true;
}

/**
 * Every accepted load, from every door. Idempotent and cheap.
 *
 * The two things this exists for: a stat outside 0..5 drives the bar renderer
 * off the end of its track, and a list flag that is not a list throws on
 * `.includes()` the first time a hub renders.
 */
export function repairState(s) {
  const base = freshState();

  s.name = String(s.name || '').trim() || base.name;
  s.town = String(s.town || '').trim() || base.town;

  s.stats = s.stats || {};
  for (const k of STAT_NAMES) {
    const v = Number(s.stats[k]);
    s.stats[k] = Number.isFinite(v) ? Math.max(0, Math.min(STAT_MAX, Math.round(v))) : base.stats[k];
  }

  s.rels = (s.rels && typeof s.rels === 'object' && !Array.isArray(s.rels)) ? s.rels : {};
  for (const [k, v] of Object.entries(base.rels)) if (typeof s.rels[k] !== 'string') s.rels[k] = v;

  s.flags = (s.flags && typeof s.flags === 'object' && !Array.isArray(s.flags)) ? s.flags : {};
  for (const [k, v] of Object.entries(base.flags)) {
    if (s.flags[k] === undefined) s.flags[k] = Array.isArray(v) ? v.slice() : v;
  }
  for (const k of LIST_FLAGS) {
    if (s.flags[k] !== undefined && !Array.isArray(s.flags[k])) s.flags[k] = [];
  }

  if (!SCREENS.includes(s.screen)) s.screen = 'panel';
  if (s.scene === undefined) s.scene = null;
  // A save that names no scene and claims to be mid-story has nowhere to land.
  if (s.screen === 'panel' && !s.scene) s.screen = 'hub';

  return s;
}

/** Version drift only. Nothing to do at v1; the hook is here so the next
 *  shape change has an obvious home that is not `repair`. */
export function migrateState(state, _from) {
  return state;
}

export function createDaredevilSlot({ storage = null } = {}) {
  return createSaveSlot({
    game: 'daredevil',
    key: KEY,
    version: VERSION,
    validate: validateState,
    migrate: migrateState,
    repair: repairState,
    defaults: freshState,
    storage,
  });
}

export default { createDaredevilSlot, freshState, validateState, repairState, KEY, VERSION };
