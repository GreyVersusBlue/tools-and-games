// The engine's public surface (ARCHITECTURE 2.1). The UI calls nothing else.
// Not here yet, by later units: outfit, suggestPlan, score.
import { freshState } from './state.js';
import { newGameFrom, openSeason, choose, canEndSeason, endSeason, recall, view, paperChoices } from './turn.js';

/** A fresh state at the first season of the calendar, with its first papers on the desk. */
export function newGame(content, { seed, length, house }) {
  return newGameFrom(freshState(content, { seed, length, house }), content);
}

export { validateContent } from './content.js';
export { openSeason, choose, canEndSeason, endSeason, recall, view, paperChoices };
