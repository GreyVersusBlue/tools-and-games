// smoke-engine.mjs — node test/smoke-engine.mjs
// Exercises the pure night engine: arrivals, tickets, boss deliveries,
// impatience, game beats, summary math. No DOM, no three.js.

import { NightEngine, MENU, seed, HOUR_W, PATIENCE, BOSS_TIP, fin, REGULAR_HOURS, SNUB_MOOD } from "../js/engine.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

seed(42);

// --- full-night run with an instant-service bot ---
const e = new NightEngine({ crowdTarget: 40, gameNight: true, hourLenSec: 45, seats: 30 });
ok(Math.abs(HOUR_W.reduce((a, b) => a + b, 0) - 1) < 1e-9, "hour weights sum to 1");

const live = new Map(); // patronId → rounds left
let nextPatron = 0, spawns = 0, kicked = false, finaled = false, bossDone = false;

for (let t = 0; t < 45 * 8 + 5 && !e.done; t += 0.5) {
  const evts = e.update(0.5);
  for (const ev of evts) {
    if (ev.type === "spawn") { spawns++; live.set(++nextPatron, 2); e2Place(nextPatron); }
    if (ev.type === "kickoff") kicked = true;
    if (ev.type === "final") { finaled = true; ok(typeof ev.win === "boolean", "final carries a result"); }
    if (ev.type === "ready") {
      const tk = ev.ticket;
      const claimed = e.claim(tk.id, bossDone ? "server" : "boss");
      ok(claimed && claimed.state === "carried", "claim marks ticket carried");
      const res = e.deliver(tk.id, !bossDone);
      ok(res && res.item.id === tk.itemId, "deliver returns the right item");
      if (!bossDone) { ok(res.byBoss && res.tip >= BOSS_TIP, "boss delivery includes flat bonus tip"); bossDone = true; }
      const rounds = live.get(tk.patronId) - 1;
      if (rounds > 0) { live.set(tk.patronId, rounds); e2Place(tk.patronId); }
      else { live.delete(tk.patronId); e.depart(); }
    }
    if (ev.type === "impatient") ok(false, "instant service should never let a ticket die");
  }
}
function e2Place(pid) { e.placeTicket(pid, e.chooseOrder(0)); }

ok(e.done, "night reaches last call");
ok(kicked && finaled, "kickoff and final both fired");
ok(spawns >= 25 && spawns <= 60, `arrivals in a sane band (got ${spawns})`);
ok(e.served > 0 && e.walkouts === 0, "served counted, zero walkouts under instant service");
ok(e.bossServes === 1, "exactly one boss serve recorded");
const s = e.summary();
ok(s.serviceRate === 100, "service rate 100 with no walkouts");
// `arrivals` is a headcount, counted at the spawn. It exists because
// served + walkouts is not one: `served` counts orders and `walkouts` counts
// people, so a night where everyone had three rounds inflates the sum. The
// regular-minting gate in campaign.js reads this number.
ok(s.arrivals === spawns, `summary().arrivals is the spawn count (${s.arrivals} vs ${spawns})`);
ok(e.served > s.arrivals, "and it is not served + walkouts: this night served more orders than it saw people");
ok(s.total === Math.round(e.revenue + e.tips), "total = revenue + tips");
ok(Math.abs(s.revenue - e.served * avgCheck()) < s.revenue, "revenue tracks orders");
function avgCheck() { return Object.values(MENU).reduce((a, m) => a + m.price, 0) / 6; }

// --- impatience path ---
seed(7);
const e2 = new NightEngine({ crowdTarget: 10, hourLenSec: 45 });
const tk = e2.placeTicket(1, "burger");
let died = false;
for (let t = 0; t < PATIENCE + 30 && !died; t += 1) {
  for (const ev of e2.update(1)) if (ev.type === "impatient" && ev.ticket.id === tk.id) died = true;
}
ok(died, "unserved ticket goes impatient after PATIENCE");
const m0 = e2.mood;
e2.walkout(1);
ok(e2.walkouts === 1 && e2.mood < m0, "walkout counts and dents mood");
ok(e2.claim(tk.id, "x") === null, "dead ticket can't be claimed");

// --- seat cap gates spawns ---
seed(3);
const e3 = new NightEngine({ crowdTarget: 500, hourLenSec: 10, seats: 5 });
let sp3 = 0;
for (let t = 0; t < 40; t += 0.25) for (const ev of e3.update(0.25)) if (ev.type === "spawn") sp3++;
ok(sp3 === 5 && e3.inBar === 5, `seat cap holds spawns at 5 (got ${sp3})`);

// --- delivery economics ---
seed(11);
const e4 = new NightEngine({});
const t4 = e4.placeTicket(9, "beer");
e4.update(30); // past prep, still inside the patience window
e4.claim(t4.id, "boss");
const r4 = e4.deliver(t4.id, true);
ok(r4 && e4.revenue === MENU.beer.price, "revenue books item price exactly");
ok(e4.tips >= BOSS_TIP, "tips include boss bonus");
ok(e4.deliver(t4.id, true) === null, "double delivery rejected");

// --- role prep-speed multipliers (foodMult/drinkMult) ---
seed(17);
const eNoCook = new NightEngine({ foodMult: 0, drinkMult: 1 });
ok(eNoCook.inStock("wings") === false, "foodMult 0 (no cook) takes food off the menu entirely");
ok(eNoCook.placeTicket(1, "wings") === null, "can't place a ticket for an unstaffed kitchen");
ok(eNoCook.inStock("beer") === true, "drinks unaffected by foodMult");
ok(eNoCook.chooseOrder(0) === null || MENU[eNoCook.chooseOrder(0)].kind === "drink",
  "chooseOrder never offers food with no cook on shift");

const eFast = new NightEngine({ foodMult: 2 });
const eSlow = new NightEngine({ foodMult: 0.5 });
seed(1); const tFast = eFast.placeTicket(1, "wings");
seed(1); const tSlow = eSlow.placeTicket(1, "wings");
ok((tFast.readyAt - tFast.placedAt) < (tSlow.readyAt - tSlow.placedAt),
  "higher foodMult means shorter prep time for the same roll");

const eNoBartender = new NightEngine({ drinkMult: 0.55 });
ok(eNoBartender.inStock("beer") === true, "no bartender still sells drinks (servers cover it)");
const tSlowDrink = eNoBartender.placeTicket(1, "beer");
const eFullBar = new NightEngine({ drinkMult: 1 });
seed(1); const tSlowD2 = eNoBartender.placeTicket(2, "beer");
seed(1); const tFullD = eFullBar.placeTicket(2, "beer");
ok((tSlowD2.readyAt - tSlowD2.placedAt) > (tFullD.readyAt - tFullD.placedAt),
  "servers covering the taps without a bartender pour slower than a staffed bar");

// --- the engine's half of the legacy-save audit -------------------------------
//
// Every number in this constructor is campaign arithmetic, and `?? default` only
// catches null and undefined. A NaN got through, and the shape of that bug is the
// nastiest one in the project: `spawnDebt += NaN` makes `while (spawnDebt >= 1)`
// permanently false, so the night runs its full eight hours with nobody in it and
// nothing logged. campaign.js's repairCampaign() now stops the NaN at the door;
// this is the second line of defence, because the engine should never quietly
// play an empty night. See the note above repairCampaign() for how it got there.
ok(fin(1.5, 9) === 1.5 && fin(NaN, 9) === 9 && fin(undefined, 9) === 9 &&
   fin(null, 9) === 9 && fin("7", 9) === 9 && fin(Infinity, 9) === 9,
  "fin() takes only finite numbers — NaN, Infinity, null and strings all fall back");

const emptyRoom = target => {
  seed(31);
  const e = new NightEngine({ crowdTarget: target, hourLenSec: 45, seats: 30 });
  let spawns = 0;
  for (let t = 0; t < 45 * 8 && !e.done; t += 0.5)
    for (const ev of e.update(0.5)) if (ev.type === "spawn") spawns++;
  return { spawns, done: e.done };
};
const nanNight = emptyRoom(NaN);
ok(nanNight.done && nanNight.spawns > 0,
  `a NaN crowdTarget still fills the room (got ${nanNight.spawns} arrivals, not a silent empty night)`);
ok(emptyRoom(undefined).spawns > 0, "and so does an undefined one");
ok(Number.isFinite(new NightEngine({ crowdTarget: NaN }).crowdTarget), "crowdTarget lands finite");

const junk = new NightEngine({
  crowdTarget: NaN, hourLenSec: NaN, seats: NaN,
  foodMult: NaN, drinkMult: undefined, beerMult: "1.2",
});
ok(junk.hourLenSec >= 1 && Number.isFinite(junk.hourLenSec), "hourLenSec can't be NaN (it divides the clock)");
ok(junk.seats >= 1 && Number.isInteger(junk.seats), "seats can't be NaN (it caps arrivals)");
ok([junk.foodMult, junk.drinkMult, junk.beerMult].every(Number.isFinite),
  "the three prep/price multipliers all land finite");
ok(Number.isFinite(junk.price("beer")) && junk.price("beer") > 0,
  "so pricing is a number rather than NaN on the box score");
const jt = junk.placeTicket(1, "wings");
ok(jt && Number.isFinite(jt.readyAt) && jt.readyAt > jt.placedAt,
  "and a ticket gets a real ready time instead of never being ready");

// foodMult 0 is meaningful — no cook on shift — so the floor is 0, not 1.
ok(new NightEngine({ foodMult: 0 }).foodMult === 0, "foodMult 0 survives the guard: no cook still closes the kitchen");
ok(new NightEngine({ foodMult: -3 }).foodMult === 0, "a negative multiplier clamps to closed rather than going backwards");

// --- the league's odds and home flag reach the game (Phase 6) ---
{
  const run = opts => {
    const e = new NightEngine({ crowdTarget: 1, gameNight: true, hourLenSec: 1, seats: 1, ...opts });
    let win = null;
    for (let t = 0; t < 9 && !e.done; t += 0.5) for (const ev of e.update(0.5)) if (ev.type === "final") win = ev.win;
    return { e, win };
  };
  seed(5); const sure = run({ winProb: 1 });
  seed(5); const never = run({ winProb: 0 });
  ok(sure.win === true && never.win === false, "winProb 1 always wins the final and winProb 0 always loses it");
  ok(run({ home: true }).e.game.home === true && run({ home: false }).e.game.home === false, "home is the caller's when given");
  seed(9); const a = run({}); seed(9); const b = run({ home: true });
  ok(a.e.spawnDebt === b.e.spawnDebt && a.win === b.win, "giving home does not shift the seeded draw sequence");
  ok(new NightEngine({}).winProb === 0.55 && new NightEngine({ winProb: NaN }).winProb === 0.55, "no odds, or NaN odds, is the old 0.55 coin");
}

// --- a regular is a person on the floor (Phase 7, increment 2) ---
// Three regulars, a room of one stool, and an instant-service bot. The
// engine brings each in as a spawn of its own during hours 1-3, through the
// same seat gate as the walk-ins; the books read the floor's word at close.
{
  const REGS = [
    { id: "r-a", name: "Ada Quill", usual: "wings", team: "FVM" },
    { id: "r-b", name: "Bo Tran", usual: "nachos", team: "HCS" },
    { id: "r-c", name: "Cy Marsh", usual: "fries", team: "FVM" },
  ];
  ok(REGULAR_HOURS.join() === "1,2,3", "the regulars are due in hours 1-3");
  ok(new NightEngine({ regulars: [null, 3, { name: "no id" }, REGS[0]] }).regulars.length === 1, "a regular without an id is not a regular the engine will seat");

  // a full night, big room: each regular arrives in their hour, counted at the door
  seed(11);
  const e = new NightEngine({ crowdTarget: 40, hourLenSec: 45, seats: 60, regulars: REGS, stock: { wings: 5, nachos: 0, fries: 5, burger: 5, beer: 50, soda: 50 } });
  const arrivedAt = {}; let spawns = 0, walkIns = 0;
  for (let t = 0; t < 45 * 8 + 5 && !e.done; t += 0.5) {
    for (const ev of e.update(0.5)) {
      if (ev.type !== "spawn") continue;
      spawns++;
      if (ev.regular) arrivedAt[ev.regular.id] = e.hour; else walkIns++;
    }
  }
  ok(arrivedAt["r-a"] === 1 && arrivedAt["r-b"] === 2 && arrivedAt["r-c"] === 3, `the i-th regular comes in at hour i+1 (${JSON.stringify(arrivedAt)})`);
  ok(e.regularsSeated.join() === "r-a,r-b,r-c", "and the floor's record lists them in door order");
  ok(e.arrivals === spawns && e.arrivals === walkIns + 3, "a regular is counted at the door like anyone else: arrivals is spawns, walk-ins plus three");
  ok(e.summary().regularsSeated.join() === "r-a,r-b,r-c" && Array.isArray(e.summary().snubbed) && Array.isArray(e.summary().comped),
    "summary() carries the floor's three lists");

  // the usual, pre-filled — and the shelf's say on it
  ok(e.usualFor(REGS[0], 0) === "wings", "a regular's first order is the usual when the shelf has it");
  const moodBefore = e.mood;
  const other = e.usualFor(REGS[1], 0);
  ok(other !== "nachos" && other !== null, "and something else when it is 86'd");
  ok(e.snubbed.has("r-b") && Math.abs(moodBefore - e.mood - SNUB_MOOD) < 1e-9, "the snub is recorded and the room's mood takes it");
  e.usualFor(REGS[1], 0);
  ok(Math.abs(moodBefore - e.mood - SNUB_MOOD) < 1e-9 && e.snubbed.size === 1, "asked again, the snub is charged once");
  ok(typeof e.usualFor(REGS[0], 1) === "string" && e.snubbed.size === 1, "a second round is whatever anyone would have, and is never a snub");
  const said = e.queued.map(q => q.txt).join(" | ");
  ok(/Bo came in for the Loaded Nachos and you're out/.test(said), `the snub queues one ticker line (${said})`);
  ok(e.usualFor(null, 0) !== undefined, "no regular at all falls through to chooseOrder");

  // the first round on the house: $0 on the ticket, the tip on the shelf price
  const e2 = new NightEngine({ crowdTarget: 0, hourLenSec: 45, seats: 10, regulars: REGS });
  e2.update(0.1);
  const paid = e2.placeTicket(1, "wings", { regularId: "r-a" });
  ok(paid.regularId === "r-a" && paid.comped === false && paid.price === 9, "a regular's ticket carries their id and opens at the shelf price");
  ok(e2.comp(paid.id) === paid && paid.price === 0 && paid.comped === true && e2.comped.has("r-a"), "comp() rings it at $0 and records who");
  ok(e2.comp(paid.id) === null, "and a second E on the same ticket is a no-op");
  const again = e2.placeTicket(1, "beer", { regularId: "r-a" });
  ok(e2.comp(again.id) === null && again.price > 0, "one round per regular per night: their next ticket cannot be comped");
  const stranger = e2.placeTicket(2, "wings");
  ok(e2.comp(stranger.id) === null && stranger.price === 9, "a walk-in's ticket cannot be comped at all");
  const early = e2.placeTicket(3, "fries", { regularId: "r-c", comped: true });
  ok(early.comped && early.price === 0 && e2.comped.has("r-c"), "a comp given before the order is in opens the ticket at $0");
  paid.state = "ready"; e2.claim(paid.id, "boss");
  const rev0 = e2.revenue;
  const res = e2.deliver(paid.id, true);
  ok(e2.revenue === rev0 && res.price === 0 && res.tip > BOSS_TIP, "delivering a comped round adds nothing to revenue and still tips on what it would have cost");
  const done = e2.placeTicket(4, "wings", { regularId: "r-b" });
  done.state = "done";
  ok(e2.comp(done.id) === null, "a round already paid for cannot be comped");
  ok(e2.summary().comped.join() === "r-a,r-c", "summary().comped is the ids, in order");

  // a full room holds a regular at the door, and seats them when a stool frees
  const e3 = new NightEngine({ crowdTarget: 0, hourLenSec: 10, seats: 1, regulars: [REGS[0]] });
  e3.inBar = 1; // a walk-in on the only stool
  const at1 = []; for (let t = 0; t < 12; t += 1) for (const ev of e3.update(1)) if (ev.type === "spawn") at1.push(ev);
  ok(e3.hour === 1 && e3.regularQueue.length === 1 && at1.length === 0 && e3.inBar === 1, "a regular due in a full room waits at the door rather than standing beside the seat cap");
  e3.depart();
  const later = []; for (const ev of e3.update(1)) if (ev.type === "spawn") later.push(ev);
  ok(later.length === 1 && later[0].regular.id === "r-a" && e3.inBar === 1 && e3.regularQueue.length === 0, "and takes the first stool that frees");
  ok(later.length === 1 && later[0].mulesFan === true, "a Mules regular walks in as a Mules fan");

  // a clock that jumps still brings in everyone it passed
  const e4 = new NightEngine({ crowdTarget: 0, hourLenSec: 10, seats: 10, regulars: REGS });
  e4.t = 35; // hour 3, straight from hour 0
  const jumped = e4.update(0.1).filter(ev => ev.type === "spawn").map(ev => ev.regular.id);
  ok(jumped.join() === "r-a,r-b,r-c", `warping the clock over hours 1-3 seats all three (${jumped.join()})`);

  // no regulars: the seeded night is the night it was
  const spawnsOf = opts => { seed(21); const x = new NightEngine({ crowdTarget: 30, hourLenSec: 45, seats: 200, ...opts }); let n = 0;
    for (let t = 0; t < 45 * 8 + 5 && !x.done; t += 0.5) for (const ev of x.update(0.5)) if (ev.type === "spawn") n++; return { n, debt: x.spawnDebt }; };
  const plain = spawnsOf({}), withRegs = spawnsOf({ regulars: REGS });
  ok(plain.n + 3 === withRegs.n && plain.debt === withRegs.debt, "three regulars are three more bodies, and the walk-ins' draw sequence does not move");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
