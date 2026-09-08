// smoke-events.mjs — node test/smoke-events.mjs
// Phase 8: the night's moments. The table and the picker in js/events.js,
// the engine spending a choice's effects, and the books settling what the
// floor reports — rep, buzz, loyalty, the crew, and the cooldowns.

import * as EV from "../js/events.js";
import * as C from "../js/campaign.js";
import * as R from "../js/regulars.js";
import { NightEngine, EVENT_HOURS, TV_BROKEN_DRAW, SOUND_BROKEN_DRAW, MENU, seed } from "../js/engine.js";
import { TEAMS, MULES } from "../js/league.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

/** A seeded generator, so a failure is the same failure twice. */
function seeded(n) { let s = n >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
const always = () => 0;   // every coin lands heads: the 40% roll passes, a weighted pick takes the first
const never = () => 0.999;

const REGS = [
  { id: "r-a", name: "Ada Quill", usual: "wings", team: "FVM", loyalty: 70 },
  { id: "r-b", name: "Bo Tran", usual: "nachos", team: "HCS", loyalty: 30 },
  { id: "r-c", name: "Cy Marsh", usual: "fries", team: "FVM", loyalty: 55 },
];
const STAFF = [
  { name: "Marge Kowalski", role: "cook", skill: 2, wage: 70 },
  { name: "Tino Vega", role: "server", skill: 4, wage: 130 },
];
/** A view in which every card's `when` holds: a packed flagship rivalry
 *  final in the regular season's... no — a final, a rival, a full crew, a
 *  roster, a high buzz. `phase` is the one card that cannot share it
 *  (offreno wants the off-season), so it is asserted on its own. */
const richView = (o = {}) => ({
  day: 40, hour: 3, gameNight: true, gameDone: false, playoff: "final", phase: "playoffs", rivalGame: true,
  crowd: 20, crowdTarget: 46, mood: 0.7, stock: { wings: 20, burger: 10, nachos: 10, fries: 20, beer: 60, soda: 30 },
  tier: 3, rep: 50, buzz: 60, upgrades: [], staff: STAFF, regulars: REGS, regularsIn: ["r-a", "r-b"],
  flags: { tapBroken: false, tvBroken: false, soundBroken: false }, wager: 0, fired: [], budget: 3, ...o,
});
const poorView = (o = {}) => richView({
  gameNight: false, gameDone: true, playoff: null, phase: "regular", rivalGame: false, crowd: 0,
  stock: { wings: 0, burger: 0, nachos: 0, fries: 0, beer: 0, soda: 0 }, tier: 0, buzz: 10,
  staff: [], regulars: [], regularsIn: [], flags: { tapBroken: true, tvBroken: true, soundBroken: true }, ...o,
});

// ---- the table's shape ----
{
  const ids = EV.EVENTS.map(e => e.id);
  ok(EV.EVENTS.length === 19, `nineteen cards (${EV.EVENTS.length})`);
  ok(new Set(ids).size === ids.length, "every id is unique");
  ok(!ids.includes("caskstrike") && !ids.includes("goldshortage"), "the two distributor cards are not on the table (#215)");
  ok(EV.EVENTS.every(e => Number.isInteger(e.cd) && e.cd > 0 && e.weight > 0), "every card has a whole cooldown and a positive weight");
  ok(EV.EVENTS.every(e => typeof e.when === "function" && e.choices.length >= 1 && e.choices.length <= 2), "every card has a when and one or two choices");
  ok(EV.EVENTS.every(e => e.choices.every(ch => typeof ch.resolve === "function" && (typeof ch.label === "string" || typeof ch.label === "function"))), "every choice has a label and a resolver");
  ok(EV.EVENTS.every(e => EV.ANCHORS.includes(e.where)), "every card names a stand-point the floor knows");
  ok(EV.EVENTS.every(e => e.who === null || typeof e.who === "string" || typeof e.who === "function"), "who is a name, a namer, or null for a prop");
  ok(EV.EVENTS.every(e => typeof e.title === "string" && (typeof e.body === "string" || typeof e.body === "function")), "every card has a title and a body");
  ok(EV.RIVAL.name === R.RIVAL.name && EV.RIVAL.owner === R.RIVAL.owner, "the table's rival is regulars.js's rival");
  ok(EVENT_HOURS.join() === EV.EVENT_HOURS.join() && EVENT_HOURS.join() === "1,6", "the engine and the table agree on the hours a card can fire");
  // every text function answers on the rich view, and every choice's effects
  // are records of kinds the engine understands
  const kinds = new Set(Object.keys(EV.EFFECT_KINDS).concat(["who"]));
  let textOk = true, kindsOk = true;
  for (const e of EV.EVENTS) {
    const v = richView({ phase: e.id === "offreno" ? "offseason" : "playoffs" });
    if (typeof EV.text(e.title, v) !== "string" || typeof EV.text(e.body, v) !== "string") textOk = false;
    if (e.who !== null && typeof EV.text(e.who, v) !== "string") textOk = false;
    e.choices.forEach((ch, i) => {
      if (typeof EV.text(ch.label, v) !== "string") textOk = false;
      for (const r of [always, never]) for (const f of EV.effectsOf(e, i, v, r)) if (!Object.keys(f).every(k => kinds.has(k))) kindsOk = false;
    });
  }
  ok(textOk, "every title, body, name and label is a string on a view where the card fires");
  ok(kindsOk, "every effect any choice returns is a kind the engine understands");
}

// ---- `when` holds and fails where the 2D build's did ----
{
  const rich = richView();
  const on = EV.eligible(EV.EVENTS, rich).map(e => e.id);
  ok(on.length === 18 && !on.includes("offreno"), `eighteen cards fire on the rich view, the off-season one alone does not (${on.length})`);
  ok(EV.eligible(EV.EVENTS, richView({ phase: "offseason", playoff: null })).some(e => e.id === "offreno"), "and it fires in the off-season");
  ok(EV.eligible(EV.EVENTS, poorView()).map(e => e.id).join() === "inspect", "on the poor view only the inspector fires: every other when is false");
  ok(!EV.eligible(EV.EVENTS, richView({ crowd: 12 })).some(e => e.id === "rowdy"), "rowdy needs more than twelve in the room");
  ok(!EV.eligible(EV.EVENTS, richView({ wager: 300 })).some(e => e.id === "rivalbet") && !EV.eligible(EV.EVENTS, richView({ gameDone: true })).some(e => e.id === "rivalbet"), "Vic bets once, and never after the final");
  ok(!EV.eligible(EV.EVENTS, richView({ tier: 2 })).some(e => e.id === "soundcrash" || e.id === "vipdouble"), "the two flagship cards need the flagship");
  ok(!EV.eligible(EV.EVENTS, richView({ buzz: 44 })).some(e => e.id === "poachregular" || e.id === "poachstaff"), "Vic poaches only when the End Zone is drawing");
  ok(!EV.eligible(EV.EVENTS, richView({ regularsIn: [] })).some(e => ["regbday", "regreferral", "regfavor"].includes(e.id)), "the three regular cards need a regular in the room, not just on the roster");
}

// ---- nothing fires on cooldown, or fired twice, or off the hours ----
{
  const rich = richView();
  const cds = {}; for (const e of EV.EVENTS) cds[e.id] = 41;
  ok(EV.eligible(EV.EVENTS, rich, cds).length === 0, "every card on cooldown until tomorrow: nothing is eligible");
  cds.hero = 40;
  ok(EV.eligible(EV.EVENTS, rich, cds).map(e => e.id).join() === "hero", "a cooldown that ends today lets the card back");
  let none = true;
  const r = seeded(3);
  for (let i = 0; i < 10000; i++) if (EV.rollMoment(EV.EVENTS, rich, cds, r) && EV.rollMoment(EV.EVENTS, richView({ fired: ["hero"] }), cds, r)) none = false;
  ok(none, "ten thousand rolls with everything on cooldown, or the one open card already fired, draw nothing");
  ok(EV.eligible(EV.EVENTS, richView({ fired: EV.EVENTS.map(e => e.id) })).length === 0, "a card that fired tonight is off the table for the night");
  ok(EV.rollMoment(EV.EVENTS, richView({ hour: 0 }), {}, always) === null && EV.rollMoment(EV.EVENTS, richView({ hour: 7 }), {}, always) === null, "hour 0 and hour 7 never fire");
  ok(EV.rollMoment(EV.EVENTS, richView({ hour: 1 }), {}, always) !== null && EV.rollMoment(EV.EVENTS, richView({ hour: 6 }), {}, always) !== null, "hours 1 and 6 do");
  ok(EV.rollMoment(EV.EVENTS, richView({ budget: 0 }), {}, always) === null, "a budget of zero is a quiet night");
  ok(EV.rollMoment(EV.EVENTS, richView({ budget: 2, fired: ["hero", "tap"] }), {}, always) === null, "and a budget spent is a quiet rest of the night");
  ok(EV.rollMoment(EV.EVENTS, rich, {}, never) === null, "the 40% coin can say no");
  // the budget is the 2D build's chaos roll
  const b = [0.1, 0.5, 0.8, 0.95].map(x => EV.nightBudget(() => x));
  ok(b.join() === "0,1,2,3", `the budget is 0 / 1 / 2 / 3 at chaos 0.1 / 0.5 / 0.8 / 0.95 (${b.join()})`);
}

// ---- weights hold over 10,000 seeded draws ----
{
  const two = EV.EVENTS.filter(e => e.weight === 2), one = EV.EVENTS.filter(e => e.weight === 1);
  const pool = [two[0], one[0], one[1]]; // weight 2, 1, 1: the first should take half
  const r = seeded(99);
  const n = {};
  for (let i = 0; i < 10000; i++) { const e = EV.pickWeighted(pool, r); n[e.id] = (n[e.id] || 0) + 1; }
  const share = n[two[0].id] / 10000;
  ok(share > 0.47 && share < 0.53, `a weight-2 card against two weight-1 cards takes half the draws (${share.toFixed(3)})`);
  ok(Math.abs(n[one[0].id] - n[one[1].id]) < 400, `and the two weight-1 cards split the rest (${n[one[0].id]} / ${n[one[1].id]})`);
  ok(EV.pickWeighted([], r) === null, "an empty pool picks nothing");
  // through the whole picker, on the rich view: the share of every card is
  // its weight over the pool's, within a point and a half
  const cnt = {}; let fired = 0;
  const rr = seeded(7);
  for (let i = 0; i < 10000; i++) { const e = EV.rollMoment(EV.EVENTS, richView(), {}, rr); if (e) { fired++; cnt[e.id] = (cnt[e.id] || 0) + 1; } }
  const elig = EV.eligible(EV.EVENTS, richView());
  const total = elig.reduce((s, e) => s + e.weight, 0);
  const off = elig.map(e => Math.abs(cnt[e.id] / fired - e.weight / total)).sort((a, b) => b - a)[0];
  ok(fired > 3800 && fired < 4200, `the 40% coin fires about four thousand of ten thousand hours (${fired})`);
  ok(off < 0.015, `and every card's share is its weight's share within 1.5 points (worst off by ${off.toFixed(4)})`);
}

// ---- resolution returns effects as data, and never touches the view ----
{
  const v = richView();
  const before = JSON.stringify(v);
  for (const e of EV.EVENTS) for (let i = 0; i < e.choices.length; i++) EV.resolveChoice(e, i, v, always);
  ok(JSON.stringify(v) === before, "resolving every choice of every card writes nothing to the view");
  const tap = EV.eventDef("tap");
  ok(JSON.stringify(EV.effectsOf(tap, 0, v)) === JSON.stringify([{ cash: -120 }]), "the tap repair is $120 without the craft wall");
  ok(JSON.stringify(EV.effectsOf(tap, 0, richView({ upgrades: ["crafttaps"] }))) === JSON.stringify([{ cash: -260 }]), "and $260 with it");
  ok(JSON.stringify(EV.effectsOf(tap, 1, v)) === JSON.stringify([{ flag: "tapBroken" }, { mood: -0.08 }]), "leaving it is the flag and the mood");
  ok(EV.resolveChoice(tap, 7, v).idx === 0 && EV.resolveChoice(tap, -1, v).idx === 0 && EV.resolveChoice(tap, "x", v).idx === 0, "an index off the table is the first option");
  const rowdy = EV.eventDef("rowdy");
  ok(EV.effectsOf(rowdy, 1, v, () => 0.1).length === 3 && EV.effectsOf(rowdy, 1, v, () => 0.9).length === 0, "let it ride: chairs fly under 0.4 and not over it");
  const bday = EV.effectsOf(EV.eventDef("regbday"), 0, v);
  ok(bday.some(f => f.loyalty === 12 && f.who.join() === "r-a,r-b"), "the birthday round is 12 to everyone in the room, and only them");
  const poach = EV.effectsOf(EV.eventDef("poachregular"), 1, v);
  ok(poach.some(f => f.loyalty === -15 && f.who.join() === "r-b"), "Vic's free tab goes after the shakiest regular in the room");
  const staff = EV.effectsOf(EV.eventDef("poachstaff"), 0, v);
  ok(staff.length === 1 && staff[0].staff.name === "Tino Vega" && staff[0].staff.wage === 155, `matching the offer raises the best staffer 20%, to the nearest $5 (${JSON.stringify(staff)})`);
  ok(EV.effectsOf(EV.eventDef("poachstaff"), 1, v).some(f => f.staffQuit === "Tino Vega"), "and shaking hands is them walking");
  const insp = EV.eventDef("inspect");
  ok(EV.effectsOf(insp, 0, v).some(f => f.rep === 3), "a shelf this crowd will eat passes the inspector");
  ok(EV.effectsOf(insp, 0, richView({ stock: { wings: 200, burger: 0, nachos: 0, fries: 0, beer: 5, soda: 5 } })).some(f => f.cash === -200), "a walk-in holding more than 2.5 nights of food fails it (#218)");
  const short = EV.effectsOf(EV.eventDef("shortdelivery"), 1, v, always);
  ok(short.length === 1 && short[0].stock && Object.values(short[0].stock)[0] < 0, `the truck cuts 30% off one thing on the shelf (${JSON.stringify(short)})`);
  ok(EV.effectsOf(EV.eventDef("shortdelivery"), 1, richView({ stock: {} }), always).length === 0, "and nothing off an empty one");
  ok(EV.effectsOf(EV.eventDef("rivalbet"), 0, v).some(f => f.wager === 300), "Vic's wager is $300 riding on the Mules");
}

// ---- the engine spends a choice's effects, once ----
{
  const mk = (o = {}) => new NightEngine({ crowdTarget: 0, hourLenSec: 10, seats: 30, stock: { wings: 20, burger: 10, nachos: 10, fries: 20, beer: 60, soda: 30 }, ...o });
  const e = mk();
  e.inBar = 20;
  ok(e.moment === null && e.moments.length === 0 && e.momentBudget === 0 && e.eventNet === 0, "a night with no moments option has none, and a budget of zero");
  const fx = [{ cash: -180 }, { mood: -0.15 }, { crowd: -6 }, { stock: { beer: -10, nope: -5 } }, { rep: 2 }, { buzz: -3 }, { loyalty: 12, who: ["r-a", "r-b"] }, { loyalty: -15, who: ["r-b"] }, { flag: "tapBroken" }, { flag: "bogus" }, { staff: { name: "Tino Vega", wage: 155 } }, { staffQuit: "Marge Kowalski" }, { wager: 300 }, null, 4, { cash: NaN }];
  const mood0 = e.mood;
  const ev = e.applyEffects(fx);
  ok(e.eventNet === -180 && Math.abs(mood0 - 0.15 - e.mood) < 1e-9, "cash goes into the night's ledger and mood onto the room");
  ok(ev.some(x => x.type === "clearOut" && x.n === 6), "a crowd effect is a clearOut event the floor acts on");
  ok(e.stock.beer === 50 && !("nope" in e.stock), "stock moves on the shelf, and an item that is not on the menu is ignored");
  ok(e.eventRep === 2 && e.eventBuzz === -3, "rep and buzz are carried for the books, not spent here");
  ok(e.eventLoyalty["r-a"] === 12 && e.eventLoyalty["r-b"] === -3, "loyalty is summed per regular");
  ok(e.flags.tapBroken === true && !("bogus" in e.flags), "a flag the engine knows is set; one it does not is dropped");
  ok(e.staffChanges.length === 2 && e.staffChanges[0].wage === 155 && e.staffChanges[1].quit === true && ev.some(x => x.type === "staffQuits" && x.name === "Marge Kowalski"), "a raise and a walkout are recorded, and the walkout is an event");
  ok(e.wager === 300, "the wager is held for the final");
  ok(Number.isFinite(e.eventNet) && Number.isFinite(e.mood), "garbage in the list is skipped, not summed");
  ok(e.summary().total === -180 && e.summary().moments.net === -180, "the take carries the night's moments, and the summary says how much");
  // clearOut never asks for more bodies than are in the room
  const e0 = mk(); e0.inBar = 2;
  ok(e0.applyEffects([{ crowd: -6 }]).some(x => x.n === 2) && e0.applyEffects([{ crowdPct: -0.5 }]).some(x => x.n === 1) && e0.applyEffects([{ crowdPct: -0.1 }]).length === 0, "clearOut is capped at the room, a fraction is rounded, and a rounding to nobody is no event");

  // the flags the engine reads when pricing and prepping
  ok(!e.inStock("beer") && e.chooseOrder(1) !== "beer" && mk().inStock("beer"), "tapBroken 86s the beer: the line to the kegs is dead");
  const tv = mk({ gameNight: true }); tv.flags.tvBroken = true;
  ok(tv.drawMult() === TV_BROKEN_DRAW && mk({ gameNight: false, }).drawMult() === 1, "a dead screen thins the draw on a game night");
  const tvq = mk({ gameNight: false }); tvq.flags.tvBroken = true;
  ok(tvq.drawMult() === 1, "and not on a night with no game to watch");
  const snd = mk({ gameNight: false }); snd.flags.soundBroken = true;
  ok(snd.drawMult() === SOUND_BROKEN_DRAW, "dead sound thins it any night");
  ok(Math.abs(tv.roundChance() - 0.72 * TV_BROKEN_DRAW) < 1e-9 && Math.abs(mk({ gameNight: true }).roundChance() - 0.72) < 1e-9 && Math.abs(mk({ gameNight: false }).roundChance() - 0.45) < 1e-9, "the next-round chance is the floor's 0.72 / 0.45, thinned the same way");
  // arrivals: the same seeded night draws fewer with a dead screen
  const spawnsOf = flag => { seed(31); const x = new NightEngine({ crowdTarget: 40, hourLenSec: 45, seats: 500, gameNight: true }); if (flag) x.flags[flag] = true; let n = 0;
    for (let t = 0; t < 45 * 8 + 5 && !x.done; t += 0.5) for (const q of x.update(0.5)) if (q.type === "spawn") n++; return n; };
  const plain = spawnsOf(null), dark = spawnsOf("tvBroken");
  ok(dark < plain * 0.8 && dark > plain * 0.6, `a dead screen all night draws about 70% of the walk-ins (${dark} vs ${plain})`);

  // the wager settles at the final
  const bet = (winProb) => { seed(5); const x = new NightEngine({ crowdTarget: 0, hourLenSec: 1, gameNight: true, winProb }); x.applyEffects([{ wager: 300 }]);
    for (let t = 0; t < 7 && !x.done; t += 0.5) x.update(0.5); return x; };
  ok(bet(1).eventNet === 300 && bet(0).eventNet === -300, "a win pays the wager and a loss costs it");
  ok(bet(1).summary().total === 300 && /Vic pays up/.test(bet(1).log.map(l => l.txt).join()), "into the take, with a line");
  ok(bet(1).summary().moments.wager === 300, "and the summary remembers the bet");
}

// ---- a moment opens, waits, resolves — once ----
{
  const card = { id: "t", cd: 2, weight: 1, title: "Test", choices: [
    { label: "a", resolve: () => ({ fx: [{ cash: -50 }, { rep: 1 }], line: "chose a", cls: "g" }) },
    { label: "b", resolve: () => ({ fx: [{ cash: 20 }], line: "chose b" }) },
  ] };
  let asked = [];
  const mk = (budget, roll) => new NightEngine({ crowdTarget: 0, hourLenSec: 10, seats: 30, moments: { budget, view: () => ({ rep: 50, day: 9 }), roll } });
  // the roll is asked at every hour in range, with the merged view, and only while nothing waits
  const e = mk(3, v => { asked.push(v.hour); return v.hour === 2 ? card : null; });
  const evs = [];
  for (let t = 0; t < 45 && !e.done; t += 0.5) evs.push(...e.update(0.5));
  ok(asked.join() === "1,2", `the engine asks at hour 1, then at hour 2, then not again while the card waits (${asked.join()})`);
  ok(e.moment && e.moment.event.id === "t" && e.moment.hour === 2, "the card that fired is the pending moment, stamped with its hour");
  ok(evs.some(x => x.type === "moment" && x.event.id === "t") && e.log.some(l => /⚠ Test!/.test(l.txt) && l.cls === "ev"), "the floor gets a moment event and the ticker its line");
  const v = e.view();
  ok(v.rep === 50 && v.day === 9 && v.hour === 4 && v.crowd === 0 && v.fired.join() === "t" && v.budget === 3 && v.flags.tapBroken === false, "the view is the books' half plus the floor's, and counts the pending card as fired");
  ok(e.openMoment(card).length === 0 && e.openMoment({ id: "z", choices: [] }).length === 0, "a second card while one waits is refused, and so is a card with no choices");
  const out = e.resolveMoment(1);
  ok(e.moment === null && e.moments.length === 1 && e.moments[0].id === "t" && e.moments[0].choice === 1 && e.moments[0].auto === false, "the boss answers: the moment is closed and the record says which option");
  ok(e.eventNet === 20 && e.eventRep === 0, "and exactly that option's effects applied");
  ok(out[0].type === "momentClosed" && out.some(x => x.type === "log" && x.txt === "chose b"), "the floor gets a momentClosed event and the choice's line");
  ok(e.resolveMoment(0).length === 0 && e.eventNet === 20, "answering again applies nothing: a moment resolves once");
  // then the roll is asked again, and the budget caps it
  asked = [];
  for (let t = 45; t < 70 && !e.done; t += 0.5) e.update(0.5);
  ok(asked.join() === "5,6", `once answered, the engine asks again at the next hours (${asked.join()})`);
  // the budget is the picker's to enforce, off the view the engine hands it:
  // the same roll over the real picker opens nothing at 0 and one card at 1
  const e2 = mk(0, v => EV.rollMoment([card], v, {}, always));
  for (let t = 0; t < 70 && !e2.done; t += 0.5) e2.update(0.5);
  const e2b = mk(1, v => EV.rollMoment([card], v, {}, always));
  for (let t = 0; t < 70 && !e2b.done; t += 0.5) e2b.update(0.5);
  ok(e2.moment === null && e2.moments.length === 0 && e2b.moment !== null && e2b.moments.length === 0 && e2b.view().fired.join() === "t",
    "the engine hands the budget to the picker in the view: a budget of 0 opens nothing, a budget of 1 opens one card and counts it");
  // an unresolved moment at last call resolves to the first option, marked auto
  const e3 = mk(1, v => (v.hour === 3 ? card : null));
  for (let t = 0; t < 30 && !e3.done; t += 0.5) e3.update(0.5);
  ok(e3.moment !== null, "a card waits at hour 3");
  e3.t = 79.9;
  const close = e3.update(0.2);
  // `length === 1` first: with the auto-resolve removed this line crashed on
  // `moments[0]` rather than failing, and #34 wants the failure to name itself
  ok(e3.done && e3.moment === null && e3.moments.length === 1 && e3.moments[0].choice === 0 && e3.moments[0].auto === true, "last call resolves it to the first option and says nobody chose");
  ok(e3.eventNet === -50 && e3.eventRep === 1 && close.some(x => x.type === "momentClosed" && x.auto) && close.some(x => x.type === "lastCall"), "with the first option's effects, before the lastCall event");
  ok(e3.summary().moments.resolved.length === 1 && e3.summary().moments.resolved[0].auto === true && e3.summary().moments.rep === 1, "and the summary carries it to the books");
  // a warped clock still asks for the hours it passed, once each, one card at a time
  const e4 = mk(3, () => card);
  e4.t = 39; e4.update(0.1);
  ok(e4.moment && e4.moment.event.id === "t" && e4.moments.length === 0, "a clock jumped to hour 3 opens one card, not three");
  ok(e4.view(2).hour === 2, "view(hour) reads a boundary the clock jumped over");
  ok(new NightEngine({ moments: { budget: "3", view: null, roll: 7 } }).momentBudget === 0 && new NightEngine({ moments: { budget: 2.7 } }).momentBudget === 2, "a garbage moments option is a quiet night; a fractional budget is floored");
}

// ---- the books settle what the floor reports ----
{
  const withRegs = () => { const c = C.newCampaign(); C.devWarpVenue(c, "flagship"); const r = seeded(7); for (let i = 0; i < 3; i++) C.devAddRegular(c, r); return c; };
  const night = (o = {}) => ({ total: 400, serviceRate: 95, mood: 0.8, arrivals: 30, served: 40, walkouts: 2, game: { finished: false, win: null }, ...o });
  const c = withRegs();
  c.staff.push(C.mkStaff("server", 4, 130, "Tino Vega"));
  const ids = c.regulars.map(r => r.id);
  const rep0 = c.rep, buzz0 = c.rival.buzz, loy0 = c.regulars.map(r => r.loyalty), day0 = c.day;
  const wages = C.wageBill(c);
  const mo = { net: -180, rep: 4, buzz: -3, loyalty: { [ids[0]]: 12, [ids[1]]: -15 }, staff: [{ name: "Tino Vega", wage: 155 }, { name: "Marge Kowalski", quit: true }],
    flags: { tapBroken: true }, wager: 0, resolved: [{ id: "tap", choice: 1, auto: false, hour: 2 }, { id: "inspect", choice: 0, auto: true, hour: 6 }] };
  const b = C.settleNight(c, night({ moments: mo }), seeded(1));
  ok(b.moments.net === -180 && b.moments.rep === 4 && b.moments.buzz === -3, "the books report what the moments moved");
  ok(b.wages === wages, "tonight's wages are the crew's at the top of the night, the one who walked included");
  ok(!c.staff.some(s => s.name === "Marge Kowalski") && b.moments.quit.join() === "Marge Kowalski", "and they are off the payroll from tomorrow");
  ok(c.staff.find(s => s.name === "Tino Vega").wage === 155 && b.moments.raised.join() === "Tino Vega", "the raise is on the books");
  ok(c.rep - rep0 === 4 + b.social.dRep, `reputation moved the card's 4 and then the night's drift (${rep0} → ${c.rep}, drift ${b.social.dRep})`);
  ok(c.rival.buzz - buzz0 === -3 + b.social.dBuzz, `the End Zone moved the card's -3 and then its own drift (${buzz0} → ${c.rival.buzz}, drift ${b.social.dBuzz})`);
  ok(b.moments.loyalty[ids[0]] === 12 && b.moments.loyalty[ids[1]] === -15 && !(ids[2] in b.moments.loyalty), "loyalty moved for the two the cards named");
  const r0 = c.regulars.find(r => r.id === ids[0]), r1 = c.regulars.find(r => r.id === ids[1]);
  const showing = new Set(b.social.showing);
  ok(r0 && r0.loyalty - loy0[0] === 12 + (showing.has(r0.name) ? 3 : -1), `the first is up 12 plus the night's own drift (${loy0[0]} → ${r0 && r0.loyalty})`);
  ok(r1 && r1.loyalty - loy0[1] === -15 + (showing.has(r1.name) ? 3 : -1), `the second is down 15 plus the drift (${loy0[1]} → ${r1 && r1.loyalty})`);
  ok(c.eventCd.tap === day0 + 4 && c.eventCd.inspect === day0 + 7 && Object.keys(c.eventCd).length === 2, `every card that fired is on cooldown from the day it fired (${JSON.stringify(c.eventCd)})`);
  ok(b.moments.resolved.join() === "tap,inspect" && b.moments.auto.join() === "inspect", "and the box score can say which, and which nobody answered");
  // the cooldown reaches the next night's picker
  const view = { ...C.eventView(c), ...{ hour: 3, crowd: 20, crowdTarget: 40, mood: 0.7, stock: c.stock, gameNight: true, gameDone: false, flags: { tapBroken: false, tvBroken: false, soundBroken: false }, wager: 0, fired: [], budget: 3 } };
  const elig = EV.eligible(EV.EVENTS, view, c.eventCd).map(e => e.id);
  ok(!elig.includes("tap") && !elig.includes("inspect") && elig.includes("hero"), "tomorrow's picker refuses both and offers the rest");
  C.devSetDay(c, day0 + 4);
  ok(EV.eligible(EV.EVENTS, { ...view, day: c.day }, c.eventCd).map(e => e.id).includes("tap"), "and the tap is back four nights on");
  // a night with no moments settles as it did
  const c2 = withRegs();
  const before = { rep: c2.rep, buzz: c2.rival.buzz, staff: c2.staff.length };
  const b2 = C.settleNight(c2, night(), seeded(1));
  ok(b2.moments.net === 0 && b2.moments.resolved.length === 0 && c2.staff.length === before.staff && Object.keys(c2.eventCd).length === 0, "a summary without a moments record is a night nothing happened on");
  // a regular a card took to zero is gone at close
  const c3 = withRegs();
  const shaky = c3.regulars[0];
  // an ugly night, so the night's own drift cannot lift them off zero
  C.settleNight(c3, night({ serviceRate: 50, mood: 0.3, moments: { loyalty: { [shaky.id]: -100 }, resolved: [] } }), seeded(1));
  ok(!c3.regulars.some(r => r.id === shaky.id) && c3.regularsLost.some(l => l.name === shaky.name), "a card that takes a regular to zero is the night they stopped coming");
  // the view the books hand the picker
  const c4 = withRegs();
  const v4 = C.eventView(c4);
  ok(v4.tier === 3 && v4.rep === c4.rep && v4.buzz === c4.rival.buzz && v4.regulars.length === 3 && v4.staff.length === 2 && Array.isArray(v4.regularsIn) && v4.day === c4.day, "eventView carries the tier, your name, the End Zone, the crew, the roster and who is in");
  ok(typeof v4.playoff !== "undefined" && ["regular", "playoffs", "offseason"].includes(v4.phase) && typeof v4.rivalGame === "boolean", "and the season's three facts");
  const s4 = JSON.stringify(c4); C.eventView(c4); C.nightMoments(c4, seeded(2));
  ok(JSON.stringify(c4) === s4, "asking writes nothing to the save");
  // rivalGame is true on the one night the Mules play the Sharks
  const rivalTeam = TEAMS.find(t => t.rival).id;
  const c5 = C.newCampaign();
  let found = null;
  for (let d = 1; d < 120 && !found; d++) { const g = C.tonight({ ...c5, day: d }).mules; if (g && (g.home === rivalTeam || g.away === rivalTeam)) found = d; }
  ok(found && C.eventView({ ...c5, day: found }).rivalGame === true && C.eventView({ ...c5, day: found + 1 }).rivalGame === false, `rivalGame is true on day ${found} and not the day after`);
  // nightMoments hands the engine the three things it takes, over the save's own cooldowns
  const nm = C.nightMoments(c4, () => 0.5);
  ok(nm.budget === 1 && typeof nm.view === "function" && typeof nm.roll === "function", "nightMoments: a budget off the chaos roll, a view, a roll");
  c4.eventCd = {}; for (const e of EV.EVENTS) c4.eventCd[e.id] = c4.day + 1;
  ok(nm.roll({ ...C.eventView(c4), hour: 3, crowd: 20, crowdTarget: 40, mood: 0.7, stock: c4.stock, gameNight: true, gameDone: false, flags: {}, wager: 0, fired: [], budget: 3 }) === null, "and the roll reads the save's cooldowns, not a copy");
  ok(new NightEngine({ crowdTarget: 0, moments: C.nightMoments(c4, () => 0.5) }).momentBudget === 1, "the engine takes what nightMoments hands it");
}

// ---- the save ----
{
  ok(JSON.stringify(EV.repairEventCd(undefined)) === "{}" && JSON.stringify(EV.repairEventCd(null)) === "{}" && JSON.stringify(EV.repairEventCd("x")) === "{}", "no cooldowns, or garbage where they go, is an empty record");
  const rep = EV.repairEventCd({ tap: 12, tv: "9", hero: NaN, nope: 40, rowdy: -2, inspect: 3.4, poachstaff: null });
  ok(JSON.stringify(rep) === JSON.stringify({ tap: 12, tv: 9, inspect: 3 }), `a finite, positive, whole day under a known id survives; the rest is dropped (${JSON.stringify(rep)})`);
  ok(JSON.stringify(EV.repairEventCd(rep)) === JSON.stringify(rep), "and repair is idempotent");
  const old = C.repairCampaign({ day: 40, cash: 900, stock: {}, staff: [] });
  ok(old.eventCd && Object.keys(old.eventCd).length === 0, "a save from before this phase loads with every card ready");
  const c = C.newCampaign();
  ok(c.eventCd && Object.keys(c.eventCd).length === 0, "and so does a fresh campaign");
  const stub = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } };
  c.eventCd = { tap: 44, hero: 45 };
  C.saveCampaign(c, stub);
  const back = C.loadCampaign(stub);
  ok(back.eventCd.tap === 44 && back.eventCd.hero === 45, "cooldowns survive a save and a load");
  ok(JSON.stringify(EV.cooldownsAfter({ tap: 44, junk: 1 }, ["hero", "bogus"], 40)) === JSON.stringify({ tap: 44, hero: 45 }), "cooldownsAfter keeps the old, adds the fired at day + cd, drops what it does not know");
  ok(EV.eventDef("bogus") === null && EV.eventDef("tap").id === "tap", "eventDef finds a card or says null");
  ok(MENU.beer && FOOD_IN_TABLE(), "the table's food ids are the menu's");
}
function FOOD_IN_TABLE() { return ["wings", "burger", "nachos", "fries"].every(id => MENU[id] && MENU[id].kind === "food"); }
void MULES;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
