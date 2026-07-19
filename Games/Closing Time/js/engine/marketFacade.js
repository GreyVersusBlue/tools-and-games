// marketFacade.js — thin re-export so the UI has one import for valuation helpers.
export { marketHeat, trueValue, bumpKnowledge, knowledgeEdge, playerListingValue } from "./market.js";
export { suggestedPrice as suggested } from "./seller.js";
