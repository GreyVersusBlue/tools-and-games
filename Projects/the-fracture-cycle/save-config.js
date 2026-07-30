// save-config.js — the schema for The Fracture Cycle's save slot.
//
// This is a completionist ending tracker, not a mid-story save: the state
// held is just which of the five endings a player has already seen. See the
// session notes for why a CYOA this short doesn't need to save your place
// mid-run. Kept in its own module (rather than inlined in the page) so the
// smoke test can exercise the exact schema the page uses, not a duplicate of
// it that could drift.

export const SAVE_KEY = "fracture-cycle-v1";
export const SAVE_VERSION = 1;
export const ENDING_IDS = ["end_radiant", "end_dire", "end_convergence", "end_ascension", "end_corruption"];

export function freshProgress() {
  return { seenEndings: [] };
}

export function validateProgress(p) {
  return !!p && Array.isArray(p.seenEndings);
}

/** Drop anything that isn't a real ending id and dedupe. Runs on every accepted load. */
export function repairProgress(p) {
  p.seenEndings = [...new Set(p.seenEndings.filter(id => ENDING_IDS.includes(id)))];
  return p;
}
