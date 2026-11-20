// The engine's public surface (ARCHITECTURE 2.1). The UI calls nothing else.
import { freshState } from './state.js';
import { newGameFrom, openSeason, choose, canEndSeason, endSeason, recall, view, paperChoices } from './turn.js';

/** A fresh state at the first season of the calendar, with its first papers on the desk. */
export function newGame(content, { seed, length, house }) {
  return newGameFrom(freshState(content, { seed, length, house }), content);
}

export { score } from './score.js';
export { validateContent } from './content.js';
export { outfit, suggestPlan, checkPlan, routeFor, destinations, prepayCost, proposePlan, estimate, bestTrades } from './routes.js';
export { openSeason, choose, canEndSeason, endSeason, recall, view, paperChoices };
