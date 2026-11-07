// guide.js — the first-shift guide (#1042): five one-sentence cues, shown one
// at a time, each finished by the player doing the thing.
//
// A view module like stations.js and chalkboard.js: it reads the shop and owns
// no rule, writes no field the sim reads, and takes no time. Every cue is
// finished by something the shop's own state shows (a customer in a station,
// a base in the cup, the ticket's lines met, the day's served count moving),
// plus the one thing only the page knows, whether the Menu Board is open. No
// clock, no random, no change to what the sim does, so the guide on or off
// leaves every seeded run reading the same. The only thing it saves is
// `guideSeen`, and ui.js does that.
//
// DOM-free on purpose, so test/smoke-sim.mjs can drive it with a seeded sim.

export const CUES = [
  { id:'take',  text:'Tap a customer in the queue to take their order to a station.' },
  { id:'base',  text:'Start the order: pick the base on the Base tab, or a plate on the Food tab.' },
  { id:'add',   text:'Add what the ticket names, milk, syrup or toppings. A dot on a tab marks what is missing.' },
  { id:'serve', text:'Press Serve, or S, to hand it over.' },
  { id:'board', text:'The Menu Board (📋, top right) is where your money buys recipes, upgrades and staff. Open it.' },
];

/**
 * @param {object} ctx
 *   state, sim    the shop; read only
 *   onChange()    the page redraws the strip (ui.js)
 *   onDone()      the guide ended, by finishing or by Skip (ui.js saves)
 */
export function createGuide({ state, sim, onChange = () => {}, onDone = () => {} }){
  let step = 0;
  let servedAtEntry = 0;
  let boardOpen = false;

  const served = () => state.dayStats.drinksServed + state.dayStats.foodServed;
  const held = () => state.slots.filter(Boolean);

  // Whether the cue at `i` is finished, read off the state as it stands.
  function done(i){
    const slots = held();
    if(i === 0) return slots.length > 0;
    if(i === 1) return slots.some(s => s.food ? s.foodPlated != null : s.cup.base != null);
    if(i === 2) return slots.some(s => sim.serveReadiness(s).complete && (s.food ? s.foodPlated != null : s.cup.base != null));
    // Compared with !==, not >: the day rolling over resets the count.
    if(i === 3) return served() !== servedAtEntry;
    if(i === 4) return boardOpen;
    return true;
  }

  function active(){ return state.guideSeen === false; }

  /** Advance as far as the shop already shows, and report whether anything moved. */
  function update(view = {}){
    if(!active()) return false;
    if(typeof view.boardOpen === 'boolean') boardOpen = view.boardOpen;
    const before = step;
    // A customer who left before the cup was started puts the guide back at
    // the first cue rather than leaving it talking about a cup that is gone.
    if(step >= 1 && step <= 3 && held().length === 0) step = 0;
    while(step < CUES.length && done(step)){
      step++;
      if(step === 3) servedAtEntry = served();
    }
    if(step >= CUES.length){ finish(); return true; }
    if(step !== before) onChange();
    return step !== before;
  }

  function finish(){
    state.guideSeen = true;
    onDone();
    onChange();
  }

  return {
    active,
    get step(){ return step; },
    cue(){ return active() && step < CUES.length ? CUES[step] : null; },
    update,
    skip(){ if(active()) finish(); },
    /** A different shop was adopted (import, New Game): forget where the last one was. */
    rewind(){ step = 0; boardOpen = false; },
    /** From the Menu Board: start again at the first cue. */
    restart(){
      state.guideSeen = false;
      step = 0;
      boardOpen = false;
      onChange();
      update();
    },
  };
}
