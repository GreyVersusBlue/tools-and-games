// events.js — the night's moments. Pure: no DOM, no three.js, no engine
// import. The table, the picker and the resolver; effects come out as data
// and somebody else spends them (engine.js's applyEffects(), campaign.js's
// settleNight()).
//
// Ported from the 2D build (`Projects/The-Fourth-Quarter.html`, its "events"
// section), not copied. The shape is the 2D build's — `id`, `cd` (nights
// before it can fire again), `weight`, `when(view)`, `choices[]` — and so are
// the numbers. What is different:
//
// - **A choice returns effects as data**, never touches anything. The 2D
//   build's `act()` wrote straight into the save and the night; here
//   `choices[i].resolve(view, rand)` returns `{ fx, line, cls }`, and `fx` is a
//   list of small records the engine understands (see EFFECT_KINDS). A test
//   can read what a choice would do without a night running.
// - **Two of the 21 cards are not here.** "Warehouse Walkout" and "The Good
//   Stuff Ran Out" are about the 2D build's three distributors, which this
//   build does not have. A card whose `when` names a system that does not
//   exist would be a card that never fires, and a table is not the place to
//   keep a promise (#215). They come back with the distributor arc.
// - **A card knows where it happens.** `where` names a stand-point in the
//   room (layout.js's stations), `who` names the person who walks in for it
//   or is null for a lit prop. The floor layer (moments.js) reads both; this
//   file never does.
// - **Who is in tonight is the engine's list**, `view.regularsIn` — the
//   day's coin (#207), so a card about a regular is about one who is in the
//   room.
//
// The view is one plain object, built by campaign.js's eventView() for the
// books' half and merged with the engine's live numbers for the floor's half.
// `when` and `resolve` read it and nothing else. Its fields:
//
//   day, hour, gameNight, gameDone, playoff (null|"semi"|"final"),
//   phase ("regular"|"playoffs"|"offseason"), rivalGame (the Mules play the
//   End Zone's team tonight), crowd (bodies in the room now), crowdTarget,
//   mood, stock ({itemId: servings}), tier (0-3), rep, buzz, upgrades ([ids]),
//   staff ([{name, role, skill, wage}]), regulars (the roster), regularsIn
//   ([ids in tonight]), flags ({tapBroken, tvBroken, soundBroken}), wager,
//   fired ([ids fired tonight]), budget (how many may fire tonight).

export const RIVAL = { name: "The End Zone", owner: "Vic Marlowe" }; // regulars.js's, spelled again: this file imports nothing

/** Every kind of effect a choice may return, and what the engine does with
 *  it. Anything a card wants that is not here is a new engine field with its
 *  own assertions, not a special case in a handler. */
export const EFFECT_KINDS = Object.freeze({
  cash:      "signed dollars, into the night's take (engine.eventNet)",
  mood:      "signed, onto the room's mood, clamped 0-1",
  crowd:     "negative: that many bodies leave now (a clearOut event the floor acts on)",
  crowdPct:  "negative fraction of the room leaves now",
  stock:     "{itemId: signed servings}, onto the shelf, floored at 0",
  rep:       "signed, onto reputation at settlement",
  loyalty:   "{n, who: [ids]}: signed, onto those regulars at settlement",
  buzz:      "signed, onto the End Zone's buzz at settlement",
  flag:      "a night flag the engine reads: tapBroken, tvBroken, soundBroken",
  staff:     "{name, wage}: a staffer's wage from tomorrow",
  staffQuit: "a staffer walks now: off the floor tonight, off the payroll at settlement",
  wager:     "dollars riding on the Mules tonight, settled at the final",
});
export const FLAGS = ["tapBroken", "tvBroken", "soundBroken"];
export const ANCHORS = ["door", "bar", "tap", "tv", "kitchen"];

export const EVENT_HOURS = [1, 6];   // inclusive: never the doors opening, never last call's hour
export const EVENT_CHANCE = 0.4;     // per hour, once the hour is in range and the budget has room

// ---------- helpers the cards share ----------
const has = (view, id) => Array.isArray(view.upgrades) && view.upgrades.includes(id);
const tapRepairCost = view => (has(view, "crafttaps") ? 260 : 120);
const tvRepairCost = view => (has(view, "broadcast") ? 450 : 250);
const first = s => String(s || "").split(" ")[0];
const inTonight = view => {
  const ids = new Set(view.regularsIn || []);
  return (view.regulars || []).filter(r => ids.has(r.id));
};
/** The shakiest regular in the room tonight, or on the roster when nobody is in. */
const shakiest = view => {
  const pool = inTonight(view).length ? inTonight(view) : (view.regulars || []);
  return pool.length ? pool.reduce((a, b) => (b.loyalty < a.loyalty ? b : a)) : null;
};
const bestStaff = view => {
  const s = view.staff || [];
  return s.length ? s.reduce((a, b) => (b.skill > a.skill || (b.skill === a.skill && b.wage > a.wage) ? b : a)) : null;
};
const raisedWage = s => Math.round(s.wage * 1.2 / 5) * 5;
const FOOD = ["wings", "burger", "nachos", "fries"];
const foodOnShelf = view => FOOD.reduce((n, id) => n + Math.max(0, (view.stock && view.stock[id]) || 0), 0);
/** The inspector's nose. The 2D build checks lot dates; this build rots a
 *  flat 15% of whatever is left, so "near-spoiled" is a walk-in holding more
 *  food than this crowd will eat in two and a half nights — the part that
 *  will rot before it sells. */
export const INSPECT_OVERSTOCK = 2.5;
export const inspectorRisky = view => foodOnShelf(view) > INSPECT_OVERSTOCK * Math.max(1, view.crowdTarget || 0);

const say = (fx, line, cls = "hl") => ({ fx, line, cls });

export const EVENTS = [
  { id: "tap", cd: 4, weight: 2, where: "tap", who: null,
    title: "Keg Tap Blows",
    body: "The main tap line just burst — beer's spraying the backbar and the line to the kegs is dead.",
    when: v => !v.flags.tapBroken && (v.stock.beer || 0) > 0,
    choices: [
      { label: v => `Emergency repair — $${tapRepairCost(v)}`, sub: "Beer keeps flowing.",
        resolve: v => say([{ cash: -tapRepairCost(v) }], "Repair guy patches the line. Beer's back.", "g") },
      { label: "Leave it for tonight", sub: "No draft beer the rest of the night.",
        resolve: () => say([{ flag: "tapBroken" }, { mood: -0.08 }], "Taps are dead. Soda only from here.", "b") },
    ] },
  { id: "tv", cd: 3, weight: 2, where: "tv", who: null,
    title: "Screen Goes Dark",
    body: "Your biggest TV just died with the game on. The room groans in unison.",
    when: v => v.gameNight && !v.flags.tvBroken,
    choices: [
      { label: v => `Rush replacement — $${tvRepairCost(v)}`, sub: "Back on before the next snap.",
        resolve: v => say([{ cash: -tvRepairCost(v) }], "New screen up in minutes. Crisis averted.", "g") },
      { label: "Crowd around the small ones", sub: "Fewer folks stick around, mood dips.",
        resolve: () => say([{ flag: "tvBroken" }, { mood: -0.1 }], "Half the room can't see the game. Some head home.", "b") },
    ] },
  { id: "rowdy", cd: 2, weight: 2, where: "door", who: "Away fans",
    title: "Rival Fans Get Loud",
    body: "A table of away-team fans is talking trash and it's escalating fast.",
    when: v => v.gameNight && v.crowd > 12,
    choices: [
      { label: "Show them the door", sub: "Lose a few tabs, keep the peace. Rep up.",
        resolve: () => say([{ crowd: -6 }, { rep: 2 }], "You walk the loudmouths out. Regulars nod approvingly.", "g") },
      { label: "Let it ride", sub: "60% it simmers down. 40% chairs fly.",
        resolve: (v, rand) => rand() < 0.4
          ? say([{ cash: -180 }, { rep: -4 }, { mood: -0.15 }], "Chairs fly. $180 in damages and everyone's rattled.", "b")
          : say([], "They talk themselves out. Crisis averted, barely.", "g") },
    ] },
  { id: "inspect", cd: 7, weight: 1, where: "kitchen", who: "Inspector",
    title: "Health Inspector",
    body: "A clipboard walks in during the rush. Everything in your walk-in is about to be examined.",
    when: () => true,
    choices: [
      { label: "Open the kitchen", sub: "Pass if the walk-in isn't holding food that'll rot before it sells.",
        resolve: v => inspectorRisky(v)
          ? say([{ cash: -200 }, { rep: -5 }], "Inspector flags aging stock. $200 fine, word gets around.", "b")
          : say([{ rep: 3 }], "Spotless. Inspector leaves impressed. Rep up.", "g") },
    ] },
  { id: "regbday", cd: 6, weight: 1, where: "bar", who: v => first((inTonight(v)[0] || {}).name) || "A regular",
    title: "A Regular's Big Night",
    body: "One of your regulars is celebrating a birthday at the corner stool, and half the bar knows it.",
    when: v => inTonight(v).length > 0,
    choices: [
      { label: "Round on the house — $35", sub: "The whole crew of regulars remembers this.",
        resolve: v => say([{ cash: -35 }, { mood: 0.08 }, { loyalty: 12, who: inTonight(v).map(r => r.id) }], "Glasses up. That's how you keep a stool warm for years.", "g") },
      { label: "Just drop the check with a candle in the nachos", sub: "Cheap, a little deflating.",
        resolve: v => say([{ loyalty: -3, who: inTonight(v).map(r => r.id) }], "A lone candle gutters in the nacho cheese. The moment passes.", "b") },
    ] },
  { id: "poachstaff", cd: 8, weight: 1, where: "bar", who: v => first((bestStaff(v) || {}).name) || "The crew",
    title: "Poaching Call",
    body: v => `${RIVAL.owner} from ${RIVAL.name} just offered ${(bestStaff(v) || {}).name} a fat raise to jump ship. They're standing by the phone, waiting on your answer.`,
    when: v => v.buzz >= 50 && (v.staff || []).some(s => s.skill >= 3),
    choices: [
      { label: v => { const s = bestStaff(v); return `Match it — ${s.name} up to $${raisedWage(s)}/night`; }, sub: "They stay. The raise is permanent.",
        resolve: v => { const s = bestStaff(v); return say([{ staff: { name: s.name, wage: raisedWage(s) } }], `${s.name} hangs up on ${RIVAL.owner} mid-pitch. Their next check is heavier.`, "g"); } },
      { label: "Shake hands, wish them luck", sub: "Lose them mid-shift. The End Zone gets stronger.",
        resolve: v => { const s = bestStaff(v); return say([{ staffQuit: s.name }, { buzz: 5 }, { mood: -0.05 }], `${s.name} unties the apron and walks. ${RIVAL.name} just got better.`, "b"); } },
    ] },
  { id: "poachregular", cd: 7, weight: 1, where: "door", who: "A runner",
    title: "Free Tab Across Town",
    body: v => `Word is ${RIVAL.name} is comping ${(shakiest(v) || {}).name}'s whole crew tonight. That corner stool is looking awful empty.`,
    when: v => v.buzz >= 45 && (v.regulars || []).length > 0,
    choices: [
      { label: v => `Comp ${(shakiest(v) || {}).name}'s next night — $25`, sub: "Loyalty up. Vic's play fizzles.",
        resolve: v => { const r = shakiest(v); return say([{ cash: -25 }, { loyalty: 10, who: [r.id] }, { buzz: -2 }], `${r.name} hears about the comp. "${RIVAL.name}? Never heard of it."`, "g"); } },
      { label: "Your bar speaks for itself", sub: "Maybe. Or maybe they like free beer.",
        resolve: v => { const r = shakiest(v); return say([{ loyalty: -15, who: [r.id] }, { buzz: 3 }], `${r.name}'s stool sits empty. Across town, ${RIVAL.owner} pours them another.`, "b"); } },
    ] },
  { id: "rivalbet", cd: 10, weight: 2, where: "bar", who: "Vic",
    title: "Vic's Wager",
    body: `${RIVAL.owner} strolls in wearing Sharks teal, slaps $300 on the bar, and says the Mules don't have it tonight.`,
    when: v => v.gameNight && v.rivalGame && !v.gameDone && !v.wager,
    choices: [
      { label: "Shake on it — $300 on the Mules", sub: "Win: his cash, his pride. Lose: $300 and the story.",
        resolve: () => say([{ wager: 300 }], "Handshake. $600 sits under the register until the final whistle.", "hl") },
      { label: "Keep it friendly", sub: "No stakes tonight.",
        resolve: () => say([], `You slide the cash back across the bar. ${RIVAL.owner} smirks and orders a well whiskey.`, "hl") },
    ] },
  { id: "hero", cd: 5, weight: 1, where: "bar", who: "The Legend",
    title: "A Legend Walks In",
    body: "A retired Mules linebacker just sat down at the bar. Phones are already out.",
    when: v => v.gameNight,
    choices: [
      { label: "First round's on the house", sub: "Costs a little, the story spreads.",
        resolve: () => say([{ cash: -40 }, { rep: 4 }, { mood: 0.1 }], "He raises a glass to the room. This story will be told for years.", "g") },
      { label: "Treat him like anyone else", sub: "He appreciates the quiet. Small rep bump.",
        resolve: () => say([{ rep: 1 }], "He drinks in peace and tips well.", "g") },
    ] },
  { id: "soundcrash", cd: 6, weight: 1, where: "tv", who: null,
    title: "Sound System Meltdown",
    body: "The flagship's premium AV rig cuts out mid-broadcast — no commentary, no crowd mic, just dead air over a packed room.",
    when: v => v.tier >= 3 && v.gameNight && !v.flags.soundBroken,
    choices: [
      { label: "Rush the AV tech — $650", sub: "Back up before the buzz fades.",
        resolve: () => say([{ cash: -650 }], "The tech reboots the rack. Sound's back, crowd barely notices.", "g") },
      { label: "Run the house PA", sub: "Flat and tinny. The room feels it.",
        resolve: () => say([{ flag: "soundBroken" }, { mood: -0.12 }], "Dead air replaced by a tinny house speaker. Energy drains out of the room.", "b") },
    ] },
  { id: "vipdouble", cd: 7, weight: 1, where: "door", who: "Two parties",
    title: "VIP Suite Double-Booked",
    body: "Two parties both swear they reserved the suite for tonight's game, and neither one's backing down.",
    when: v => v.tier >= 3 && v.gameNight,
    choices: [
      { label: "Comp both — squeeze them in ($60)", sub: "Tight fit, but everybody's happy.",
        resolve: () => say([{ cash: -60 }, { rep: 1 }], "You wedge in an extra table and comp a round. Both parties leave grinning.", "g") },
      { label: "Turn the smaller party away", sub: "Save the seats, make an enemy.",
        resolve: () => say([{ crowd: -5 }, { rep: -2 }], "One party storms out muttering about Yelp. The suite holds, barely.", "b") },
    ] },
  { id: "shortdelivery", cd: 6, weight: 2, where: "kitchen", who: "The driver",
    title: "Truck Breaks Down",
    body: "The distributor's driver calls — the truck threw a belt on the highway and tonight's top-up is coming up short.",
    when: v => Object.values(v.stock || {}).some(n => n > 0),
    choices: [
      { label: "Pay for a rush courier — $90", sub: "Full delivery makes it in before the rush.",
        resolve: () => say([{ cash: -90 }], "A rented van pulls up twenty minutes later, order intact.", "g") },
      { label: "Work with what's on the shelf", sub: "Something's going to run thin tonight.",
        resolve: (v, rand) => {
          const ids = Object.keys(v.stock || {}).filter(id => v.stock[id] > 0);
          if (!ids.length) return say([], "You make do without the rest of the order.", "b");
          const id = ids[Math.floor(rand() * ids.length)];
          const cut = Math.max(1, Math.ceil(v.stock[id] * 0.3));
          return say([{ stock: { [id]: -cut } }], `You make do. ${id === "beer" ? "Beer" : id === "soda" ? "Soda" : "The " + id} runs thinner than planned tonight.`, "b");
        } },
    ] },
  { id: "ticketholders", cd: 5, weight: 1, where: "door", who: "Ticket holders",
    title: "Ticket Holders Pregame Here",
    body: "A pack of fans with tickets to tonight's game are pregaming hard — big tabs, loud energy, gone the second the game gets close.",
    when: v => v.gameNight && !!v.playoff,
    choices: [
      { label: "Pour heavy, cash in now", sub: "Big tabs now, some of the room clears out early.",
        resolve: () => say([{ cash: 150 }, { crowdPct: -0.12 }], "Tabs run high and fast. Then a wave of them heads for the arena, right on cue.", "g") },
      { label: "Pace them, keep them till tip-off", sub: "Slower tabs, but they stick around.",
        resolve: () => say([{ mood: 0.05 }], "You slow-walk the rounds. They stay through the pregame and into the broadcast.", "g") },
    ] },
  { id: "vicbuyout", cd: 20, weight: 1, where: "bar", who: "Vic",
    title: "Vic's Last Play",
    body: `${RIVAL.owner} corners you at the bar with a check, offering to buy tonight's broadcast rights so ${RIVAL.name} gets the exclusive championship feed instead.`,
    when: v => v.gameNight && v.playoff === "final",
    choices: [
      { label: "Laugh him out the door", sub: "Your screens keep the game. Rep up.",
        resolve: () => say([{ buzz: -3 }, { rep: 1 }], `${RIVAL.owner} pockets the check and slinks out. Your marquee keeps the title fight.`, "g") },
      { label: "Take the money — $500", sub: "Easy cash. Word gets around you sold the big night.",
        resolve: () => say([{ cash: 500 }, { buzz: 10 }, { rep: -6 }], "You pocket the check. By last call, everyone knows whose name is on that feed now.", "b") },
    ] },
  { id: "offreno", cd: 10, weight: 1, where: "bar", who: null,
    title: "Doors Are Quiet — Crew's Got Downtime",
    body: "With no games on, the floor crew's antsy. Someone floats fixing the place up while the room's empty.",
    when: v => v.phase === "offseason",
    choices: [
      { label: "Deep clean & touch-ups — $300", sub: "The place shines. Word travels before the new season starts.",
        resolve: () => say([{ cash: -300 }, { rep: 3 }], "Grout, brass, and a fresh coat later, the place looks like new money. Rep up.", "g") },
      { label: "Let the downtime ride", sub: "Save the cash, skip the shine.",
        resolve: () => say([], "The mop closet waits for another day. Nobody seems to mind.", "hl") },
    ] },
  { id: "regreferral", cd: 6, weight: 1, where: "bar", who: "A new face",
    title: "New Face at the Bar",
    body: v => `${(inTonight(v)[0] || {}).name} brought a friend along tonight, talking you up the whole way in. The friend's sizing up the room.`,
    when: v => inTonight(v).length > 0,
    choices: [
      { label: "Comp the friend's first round — $20", sub: "A good first impression, and the regular remembers the gesture.",
        resolve: v => say([{ cash: -20 }, { mood: 0.04 }, { loyalty: 6, who: [inTonight(v)[0].id] }], "The newcomer's first round is on the house. Their friend beams — that's how you earn a second visit.", "g") },
      { label: "Let them run their own tab", sub: "No cost, no fuss.",
        resolve: () => say([], "The friend settles up like anyone else. A perfectly fine first night.", "hl") },
    ] },
  { id: "regfavor", cd: 8, weight: 1, where: "bar", who: v => first((shakiest(v) || {}).name) || "A regular",
    title: "Can It Wait Till Payday?",
    body: v => `${(shakiest(v) || {}).name} is short tonight and asks if the tab can carry till payday.`,
    when: v => inTonight(v).length > 0,
    choices: [
      { label: "Sure, I'll run a tab", sub: "Loyalty jumps — but there's a real chance it never gets squared.",
        resolve: (v, rand) => { const r = shakiest(v); return rand() < 0.3
          ? say([{ loyalty: 10, who: [r.id] }], `${r.name} never quite settles that tab. You let it go.`, "b")
          : say([{ loyalty: 10, who: [r.id] }, { cash: 15 }], `${r.name} squares up next visit, embarrassed it took so long. Good faith, repaid.`, "g"); } },
      { label: "Cash only, like always", sub: "No risk, but it stings a little.",
        resolve: v => { const r = shakiest(v); return say([{ loyalty: -4, who: [r.id] }], "You hold the line on the house rule. Fair, but not warm.", "hl"); } },
    ] },
  { id: "proposal", cd: 6, weight: 1, where: "bar", who: "A nervous patron",
    title: "A Ring at the Bar",
    body: "A regular-looking patron just leaned over and asked, very quietly, if you'd help them propose tonight.",
    when: v => v.crowd >= 8,
    choices: [
      { label: "Comp the champagne, hype the room — $30", sub: "The whole bar gets in on it. Great story, small cost.",
        resolve: () => say([{ cash: -30 }, { rep: 2 }, { mood: 0.1 }], "The room erupts when she says yes. Somebody's already posting the video.", "g") },
      { label: "Keep it low-key, respect their privacy", sub: "Quieter, but still a nice moment.",
        resolve: () => say([{ rep: 1 }], "A quiet toast at the end of the bar. They slip out before last call, grinning.", "g") },
    ] },
  { id: "newsspot", cd: 8, weight: 1, where: "door", who: "News crew",
    title: "Local News Wants a Clip",
    body: "A local news van is parked out front — they want thirty seconds of game-night atmosphere for the evening broadcast.",
    when: v => v.gameNight,
    choices: [
      { label: "Let them film — free publicity", sub: "Rep bump, but the crew and cameras slow service for a few minutes.",
        resolve: () => say([{ rep: 3 }, { mood: -0.03 }], "Cameras weave through the crowd for a minute of B-roll. Free advertising, if a little disruptive.", "g") },
      { label: "Politely decline", sub: "No fuss, no footage.",
        resolve: () => say([], "You wave the crew off. They shrug and try the sports bar across town.", "hl") },
    ] },
];

export const eventDef = id => EVENTS.find(e => e.id === id) || null;
/** A card's text, which may be a function of the view. */
export const text = (t, view) => (typeof t === "function" ? t(view) : t);

// ---------- the picker ----------
/** How many moments tonight can hold: the 2D build's chaos roll. Some nights
 *  are chill (40%: none), most have one, a few are disasters (8%: three). */
export function nightBudget(rand = Math.random) {
  const chaos = rand();
  return chaos < 0.40 ? 0 : chaos < 0.74 ? 1 : chaos < 0.92 ? 2 : 3;
}

/** Every card that could fire right now: its `when` holds, it has not fired
 *  tonight, and its cooldown has run out. `cds` is the save's `eventCd`
 *  record, {id: the first day it may fire again}. Read only. */
export function eligible(table, view, cds = {}) {
  const fired = new Set(view.fired || []);
  const day = Number.isFinite(view.day) ? view.day : 1;
  return table.filter(e => !fired.has(e.id) && day >= (Number.isFinite(cds[e.id]) ? cds[e.id] : 0) && (typeof e.when !== "function" || !!e.when(view)));
}

/** One draw off the pool, by weight. A weight of 2 fires twice as often as 1. */
export function pickWeighted(list, rand = Math.random) {
  if (!list.length) return null;
  const total = list.reduce((s, e) => s + Math.max(0, e.weight || 1), 0);
  let r = rand() * total;
  for (const e of list) { r -= Math.max(0, e.weight || 1); if (r < 0) return e; }
  return list[list.length - 1];
}

/** The hour's roll: null, or the card that fires. Hours 1-6 only, never
 *  while one is pending (the caller's job — the engine only asks when none
 *  is), never past the night's budget, and then a 40% coin before the pool
 *  is even looked at. The draw sequence is the 2D build's: coin, then pick. */
export function rollMoment(table, view, cds = {}, rand = Math.random) {
  const h = view.hour;
  if (!(h >= EVENT_HOURS[0] && h <= EVENT_HOURS[1])) return null;
  if ((view.fired || []).length >= (Number.isFinite(view.budget) ? view.budget : 0)) return null;
  if (rand() >= EVENT_CHANCE) return null;
  return pickWeighted(eligible(table, view, cds), rand);
}

// ---------- the resolver ----------
/** What choosing `idx` does: `{ fx, line, cls }`, effects as data. An index
 *  off the end is the first option — the engine resolves an unanswered
 *  moment that way at last call, and a garbage index from a click is the
 *  same case. */
export function resolveChoice(ev, idx, view, rand = Math.random) {
  const i = Number.isInteger(idx) && idx >= 0 && idx < ev.choices.length ? idx : 0;
  const out = ev.choices[i].resolve(view, rand);
  return { idx: i, fx: Array.isArray(out.fx) ? out.fx : [], line: out.line || "", cls: out.cls || "hl" };
}

/** Effects only, for a test that wants to read the table without a night. */
export function effectsOf(ev, idx, view, rand = Math.random) { return resolveChoice(ev, idx, view, rand).fx; }

// ---------- the save ----------
/** `eventCd` is additive: a save from before this phase has none, and a
 *  hand-edited one can hold anything. Keep the finite, whole, positive days
 *  under ids the table still has; drop the rest. Idempotent. */
export function repairEventCd(cds) {
  const out = {};
  if (!cds || typeof cds !== "object") return out;
  for (const id in cds) {
    if (!eventDef(id)) continue;
    const d = Math.round(Number(cds[id]));
    if (Number.isFinite(d) && d > 0) out[id] = d;
  }
  return out;
}
/** The cooldowns after tonight: every card that fired is off the table for
 *  its `cd` nights from tomorrow. Returns a new record. */
export function cooldownsAfter(cds, firedIds, day) {
  const out = repairEventCd(cds);
  for (const id of firedIds || []) { const e = eventDef(id); if (e) out[id] = day + e.cd; }
  return out;
}
