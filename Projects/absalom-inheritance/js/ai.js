/**
 * ai.js — what a creature does with its turn, as a decision rather than a loop.
 *
 * Every creature in this game used to play one line: if adjacent, Strike; else
 * Stride at the PC. That was correct while a creature had nothing else to do.
 * After the interrupt point, the condition layer and the templates it has three
 * things to do instead, and the decision needed somewhere to live that was not
 * halfway down a `while` loop in game.js.
 *
 * This module is pure the way templates.js is pure: a view in, a choice out. No
 * world, no RNG, no game state, nothing it can mutate. Everything it decides
 * from has already been *measured* by game.js — whether the foe is in reach,
 * whether a retreat exists, how many squares a template would catch — because a
 * policy that measured its own geometry would be a second copy of the engine's,
 * and this repo has shipped that mistake twice (locked #34). The engine measures
 * once, this ranks what it measured, and the engine executes exactly the option
 * it was handed back.
 */

/** The three policies a pack may name. `brawler` is the old one-line strategy. */
export const AI_KINDS = Object.freeze(["brawler", "skirmisher", "caster"]);

/**
 * One creature's turn, decided.
 *
 * `view` is what the creature is allowed to know:
 *
 *   ai        one of AI_KINDS
 *   actions   actions left in this turn
 *   struck    Strikes it has already made this turn
 *   adjacent  is the foe inside this creature's reach
 *   approach  can it Stride toward the foe (a leg exists)
 *   retreat   { stride, step, strideProvokes } — which ways out exist, and
 *             whether the Stride would hand the foe a reaction
 *   abilities [{ id, cost, caught, allies }] — the area kit it has not spent,
 *             each already resolved against the board
 *
 * Returns one of:
 *   { do: "strike" }            swing at the foe
 *   { do: "cast", id }          fire that ability at the foe
 *   { do: "stride" }            walk the approach leg the engine planned
 *   { do: "retreat" }           walk the retreat leg the engine planned
 *   { do: "step" }              one square out of reach, triggering nothing
 *   { do: "end" }               nothing worth doing: end the turn
 */
export function chooseAction(view) {
  if (!AI_KINDS.includes(view.ai)) {
    throw new Error(`ai: unknown policy "${view.ai}" (want ${AI_KINDS.join(", ")})`);
  }
  if (!(view.actions > 0)) return { do: "end" };

  // A caster leads with its area, and only with one it can afford, that
  // actually catches the foe, and that no ally is standing in. That last
  // clause is the whole phase name: the Keeper's chamber is four squares
  // wide, and a boss that opened with a cone through its own escort would be
  // a boss that helped. Best coverage first, cheapest to break the tie.
  if (view.ai === "caster") {
    const usable = (view.abilities || [])
      .filter(a => a.cost <= view.actions && a.caught > 0 && !a.allies)
      .sort((a, b) => b.caught - a.caught || a.cost - b.cost);
    if (usable.length) return { do: "cast", id: usable[0].id };
  }

  // Hit and run. A skirmisher swings once and gets back out, and which way out
  // it takes is the only place in this engine where a creature reads the
  // player's sheet: a Stride out of reach is a free Strike for anyone holding
  // Reactive Strike, and a Step is five feet that triggers nothing at all
  // (Player Core p.418). So it Strides away from Vesper, who has no such
  // reaction, and Steps away from Kessa, who does. There is no expected-damage
  // arithmetic here on purpose — when a Step is available it is strictly
  // cheaper than eating the swing, and a policy that computed a number it
  // never acted on would be a comment pretending to be code.
  const r = view.retreat || {};
  if (view.ai === "skirmisher" && view.adjacent && view.struck > 0) {
    if (r.stride && !r.strideProvokes) return { do: "retreat" };
    if (r.step) return { do: "step" };
    // Nothing left but a Stride that hands her the swing: stand and fight. It
    // only ever leaves when leaving is free, which is the same sentence as the
    // paragraph above and the reason there is no arithmetic in either.
  }

  if (view.adjacent) return { do: "strike" };

  // A skirmisher that has already swung this turn does not close again — the
  // whole point of the retreat above is that the foe has to spend an action
  // coming back, and a creature that immediately walked back in would have
  // spent its own turn undoing it.
  if (view.ai === "skirmisher" && view.struck > 0) return { do: "end" };

  if (view.approach) return { do: "stride" };
  return { do: "end" };
}
