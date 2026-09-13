// smoke-sim.mjs — Corner & Kettle's shop under plain Node, with a seed.
//
//   node Projects/corner-and-kettle/test/smoke-sim.mjs
//
// Exits non-zero on any failure (locked decision #13). No dependencies, no
// DOM, no waiting: the sim takes its time from advance(dtMs) and its chance
// from makeRng(seed), so a 136-second shift runs in a few milliseconds and
// runs the same way twice. Same harness shape as smoke-save.mjs next door.

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// Windows is the dev machine (v7 §7). A bare C:\... import is read as URL
// scheme `c:` and refused, so route the path through pathToFileURL.
const here = dirname(fileURLToPath(import.meta.url));
const mod = p => import(pathToFileURL(join(here, p)).href);

const CONTENT = await mod("../js/content.js");
const { makeRng, createSim, freshState, freshDayStats, newCup, STEP_MS, SERVE_CLEAR_MS } = await mod("../js/sim.js");
const { SHIFT_MS, PHASES, RECIPES, FOODS, BARISTA_TIERS,
  REGULAR_FRIEND_CHANCE, WORD_OF_MOUTH_MIN, WORD_OF_MOUTH_MAX } = CONTENT;

/* ---------- harness ---------- */

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; return true; }
  failures.push(label);
  return false;
}
function eq(actual, expected, label) {
  return ok(Object.is(actual, expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function section(name) { process.stdout.write(`\n${name}\n`); }

/* ---------- fixtures ---------- */

/** A sim on a seed, recording every notify() event. */
function shop(seed, mutate) {
  const state = freshState(CONTENT);
  if (mutate) mutate(state);
  const events = [];
  const sim = createSim({ content: CONTENT, rng: makeRng(seed), state, notify: e => events.push(e) });
  return { sim, state, events };
}

/** The parts of the state a run should reproduce exactly, as one string. */
function fingerprint(state) {
  return JSON.stringify({
    day: state.day, money: state.money, shiftElapsed: state.shiftElapsed,
    shiftRunning: state.shiftRunning, next: state.nextCustomerId,
    combo: state.combo, best: state.bestCombo, rep: state.reputation,
    queue: state.queue.map(c => [c.id, c.isFood ? c.foodId : c.recipeId, c.patience, c.regularName]),
    slots: state.slots.map(s => s && [s.customer.id, s.cup, s.foodPlated, !!s.serving]),
    regulars: state.regulars, stats: state.dayStats, event: state.activeEvent,
    fired: state.eventFiredThisShift, modifier: state.dailyModifierId,
  });
}

/** A hand-built order with no randomness in it. */
function order(recipeId, custom, extra) {
  const r = RECIPES.find(x => x.id === recipeId);
  return { id: 1, isFood: false, recipeId, price: r.price,
    custom: { milk: undefined, syrup: undefined, toppings: [], ice: false, ...custom },
    patienceMax: 40, patience: 40, isRegular: false, regularName: null, ...extra };
}
function foodOrder(foodId, extra) {
  const f = FOODS.find(x => x.id === foodId);
  return { id: 1, isFood: true, foodId, price: f.price, patienceMax: 30, patience: 30,
    isRegular: false, regularName: null, ...extra };
}
function slotFor(o) { return { customer: o, cup: newCup(), food: !!o.isFood, foodPlated: null }; }

// The simplest player there is: take the first customer whenever a station is
// free, work one ticket line per frame on every station, serve any cup the
// ticket says is finished. Phase 2's harness is this with policies; here it
// only has to be deterministic.
function autopilot(sim, state) {
  state.slots.forEach(slot => {
    if (!slot || slot.serving) return;
    if (sim.orderIsComplete(slot)) sim.scoreServe(slot);
    else sim.autoAssistStep(slot);
  });
  while (state.queue.length && state.slots.includes(null)) sim.acceptCustomer(state.queue[0].id);
}
function runShift(sim, state, stepMs = STEP_MS, work = autopilot) {
  let steps = 0;
  while (state.shiftRunning) { work(sim, state); sim.advance(stepMs); steps++; if (steps > 1e6) throw new Error("shift never ended"); }
  return steps;
}

/* ================================================================== */

section("1. makeRng — the shape from absalom-inheritance");
{
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = Array.from({ length: 5 }, () => a()), sb = Array.from({ length: 5 }, () => b()), sc = Array.from({ length: 5 }, () => c());
  eq(JSON.stringify(sa), JSON.stringify(sb), "the same seed gives the same sequence");
  ok(JSON.stringify(sa) !== JSON.stringify(sc), "a different seed gives a different one");
  ok(sa.every(v => v >= 0 && v < 1), "every value is in [0, 1)");
  const rng = makeRng(1); let lo = 1, hi = 0;
  for (let i = 0; i < 10000; i++) { const v = rng(); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(lo < 0.01 && hi > 0.99, `ten thousand draws span the interval (${lo.toFixed(4)}..${hi.toFixed(4)})`);
}

section("2. a fixed seed gives a fixed order sequence");
{
  const A = shop(7), B = shop(7), C = shop(8);
  const seq = s => JSON.stringify(Array.from({ length: 40 }, () => s.sim.generateOrder()));
  const a = seq(A), b = seq(B), c = seq(C);
  eq(a, b, "forty orders on seed 7, twice, are identical");
  ok(a !== c, "seed 8 gives a different forty");
  eq(A.state.nextCustomerId, 41, "ids were handed out 1..40");
  ok(JSON.stringify(A.state.regulars) === JSON.stringify(B.state.regulars), "so are the regulars minted along the way");
  const o = A.sim.generateOrder();
  ok(o.sprite && [o.sprite.hair, o.sprite.skin, o.sprite.shirt, o.sprite.pants].every(v => /^#/.test(v)),
    "an order carries its customer's colours, picked off the same rng, not markup");
  ok(!("spriteHtml" in o), "and no spriteHtml — drawing is the page's job");
}

section("3. one requirement list: ticket, barista and scorer agree");
{
  // Every recipe, with every optional field the generator can add. The barista
  // works the ticket top to bottom; each step must satisfy at least one more
  // line and never undo one, and the scorer must see the same lines.
  let orders = 0, steps = 0;
  const { sim } = shop(3);
  for (const r of RECIPES) {
    for (const custom of [
      {}, { milk: "oat" }, { milk: "oat", syrup: "vanilla" }, { milk: "skim", syrup: "caramel", toppings: ["whip", "cinnamon"] },
      { milk: "whole", ice: true }, { milk: "almond", syrup: "mocha", toppings: ["sprinkles"], ice: true },
    ]) {
      const o = order(r.id, r.needsMilk ? custom : { ...custom, milk: undefined });
      if (o.custom.milk === undefined && r.needsMilk) o.custom.milk = "whole";
      if (r.requiredSyrup) o.custom.syrup = r.requiredSyrup;
      const slot = slotFor(o);
      const reqs = sim.getOrderRequirements(o);
      const passing = () => reqs.filter(q => q.check(slot)).length;
      let before = passing(), n = 0;
      while (sim.autoAssistStep(slot)) {
        n++;
        const now = passing();
        if (!(now > before)) failures.push(`${r.id} ${JSON.stringify(o.custom)}: barista step ${n} satisfied nothing new (${before} -> ${now})`);
        before = now;
        if (n > 20) { failures.push(`${r.id}: barista never finished`); break; }
      }
      orders++; steps += n;
      if (!sim.orderIsComplete(slot)) failures.push(`${r.id} ${JSON.stringify(o.custom)}: barista stopped with the ticket incomplete`);
      if (passing() !== reqs.length) failures.push(`${r.id}: ${passing()} of ${reqs.length} lines pass after the barista`);
      const receipt = sim.scoreServe(slot);
      if (receipt.ratio !== 1 || !receipt.happy) failures.push(`${r.id}: scorer saw ${receipt.ratio} on a cup the ticket calls complete`);
    }
  }
  ok(orders === RECIPES.length * 6, `${orders} builds, ${steps} barista steps, every one satisfied a new ticket line and finished`);
  const fo = foodOrder("bagel"); const fs = slotFor(fo);
  ok(sim.autoAssistStep(fs) && fs.foodPlated === "bagel" && sim.orderIsComplete(fs) && !sim.autoAssistStep(fs),
    "food: one step plates it, the ticket is complete, and there is no second step");
  // Steamed is a ticket line, so a cold-poured latte is not complete.
  const latte = slotFor(order("latte", { milk: "oat" }));
  latte.cup.base = "espresso"; latte.cup.shots = 1; latte.cup.milk = "oat";
  ok(!sim.orderIsComplete(latte), "a latte with cold oat milk is incomplete");
  latte.cup.milkSteamed = true;
  ok(sim.orderIsComplete(latte), "steamed, it is complete");
  const iced = slotFor(order("latte", { milk: "oat", ice: true }));
  iced.cup.base = "espresso"; iced.cup.shots = 1; iced.cup.milk = "oat"; iced.cup.ice = true;
  ok(sim.orderIsComplete(iced), "an iced latte does not want steamed milk");
}

section("4. scoreServe — price * (0.35 + 0.65 * ratio)");
{
  // A latte has exactly two ticket lines: the shot and the steamed milk.
  const cases = [
    ["0%", cup => {}, 0],
    ["50%", cup => { cup.base = "espresso"; cup.shots = 1; }, 0.5],
    ["100%", cup => { cup.base = "espresso"; cup.shots = 1; cup.milk = "oat"; cup.milkSteamed = true; }, 1],
  ];
  for (const [label, build, ratio] of cases) {
    const { sim, state } = shop(1);
    const o = order("latte", { milk: "oat" }, { patience: 0 }); // no patience left: no tip, so earned is the base alone
    const slot = slotFor(o); build(slot.cup);
    const money0 = state.money;
    const r = sim.scoreServe(slot);
    eq(r.ratio, ratio, `${label}: ratio`);
    eq(r.base, Math.round(45 * (0.35 + 0.65 * ratio)), `${label}: base is 45 * (0.35 + 0.65 * ${ratio})`);
    eq(r.tip, 0, `${label}: no patience left, no tip`);
    eq(r.earned, r.base, `${label}: earned is the base alone`);
    eq(state.money - money0, r.earned, `${label}: and that is what hit the till`);
    eq(r.happy, ratio === 1, `${label}: happy only at 100%`);
    eq(state.combo, ratio === 1 ? 1 : 0, `${label}: combo`);
    eq(state.reputation, ratio === 1 ? 50.4 : 49.2, `${label}: reputation moved ${ratio === 1 ? "+0.4" : "-0.8"}`);
    ok(slot.serving === true && slot.servedAt === state.shiftElapsed, `${label}: the slot is marked serving`);
    eq(sim.scoreServe(slot), null, `${label}: a serving slot cannot be served twice`);
  }
  // Tip arithmetic, at full patience: base*0.25, plus 2% per combo step.
  {
    const { sim, state } = shop(1);
    const o = order("latte", { milk: "oat" });
    const slot = slotFor(o); slot.cup = { ...newCup(), base: "espresso", shots: 1, milk: "oat", milkSteamed: true };
    const r = sim.scoreServe(slot);
    // combo becomes 1 before the tip is computed: tipBase 11.25, comboBonus round(11.25*0.02)=0, tip round(11+0)=11
    eq(r.tip, 11, "full patience on a $45 latte tips 11");
    eq(r.earned, 56, "earned 45 + 11");
    eq(state.dayStats.totalTips, 11, "the day's tips carry it");
    eq(state.dayStats.bestTipName, "Latte", "and remember what it was for");
  }
  // Food: right plate is full price; wrong plate is 40%.
  {
    const { sim } = shop(1);
    const good = slotFor(foodOrder("bagel", { patience: 0 })); good.foodPlated = "bagel";
    const bad = slotFor(foodOrder("bagel", { patience: 0, id: 2 })); bad.foodPlated = "croissant";
    const g = sim.scoreServe(good), b = sim.scoreServe(bad);
    eq(g.base, 26, "the right bagel is $26"); eq(g.happy, true, "and happy");
    eq(b.base, Math.round(26 * 0.4), "a croissant for a bagel is 40%"); eq(b.ratio, 0.4, "at ratio 0.4"); eq(b.happy, false, "and not happy");
  }
  // A miss with a shield keeps the streak; a critic moves reputation by 8.
  {
    const { sim, state } = shop(1);
    state.combo = 5; state.comboShields = 1;
    const miss = slotFor(order("latte", { milk: "oat" }, { patience: 0 }));
    const r = sim.scoreServe(miss);
    ok(r.shieldUsed && state.combo === 5 && state.comboShields === 0, "a streak shield absorbs the miss");
    const critic = slotFor(order("drip", {}, { isCritic: true, patience: 0 })); critic.cup.base = "drip";
    const rep0 = state.reputation;
    const c = sim.scoreServe(critic);
    eq(c.eventBonus, 30, "a happy critic doubles the base");
    eq(Math.round((state.reputation - rep0) * 10) / 10, 8.4, "and reputation moves +8 for the critic, +0.4 for the serve");
    eq(c.repDelta, 8.4, "which is what the receipt says");
  }
}

section("5. one clock: advance(136000) once is 8,160 steps of one frame");
{
  const A = shop(11), B = shop(11);
  const stepsA = A.sim.advance(SHIFT_MS);
  let stepsB = 0;
  for (let i = 0; i < 8160; i++) stepsB += B.sim.advance(STEP_MS);
  eq(stepsA, 8160, "one call took 8,160 steps");
  eq(stepsB, 8160, "so did 8,160 calls");
  ok(!A.state.shiftRunning && !B.state.shiftRunning, "both shifts ended");
  eq(fingerprint(A.state), fingerprint(B.state), "and the two shops are indistinguishable");
  eq(A.sim.rand([1, 2, 3, 4, 5, 6, 7]), B.sim.rand([1, 2, 3, 4, 5, 6, 7]), "down to the next number the rng will give");
  ok(A.state.queue.length >= 1 && A.state.queue.length <= A.sim.queueMax(), `customers arrived and the queue stayed capped (${A.state.queue.length})`);
  ok(A.state.eventFiredThisShift && A.state.dayStats.events.length === 1, `the day's one random event fired (${A.state.dayStats.events[0]})`);
  const end = A.events.filter(e => e.type === "shiftEnd");
  eq(end.length, 1, "endShift notified exactly once");
  eq(end[0]?.summary.wages, 0, "with no wages, nobody being hired");
  eq(A.sim.advance(5000), 0, "a shop that has closed takes no more steps");
  // Ragged deltas — what requestAnimationFrame actually hands over — still land on the same steps.
  const C = shop(11);
  const ragged = makeRng(99);
  let stepsC = 0, given = 0;
  while (given < SHIFT_MS) { const dt = 8 + ragged() * 30; given += dt; stepsC += C.sim.advance(dt); }
  eq(stepsC, 8160, "uneven frame deltas summing past the shift still make 8,160 steps");
  eq(fingerprint(C.state), fingerprint(A.state), "and the same shop");
}

section("6. the parts of the clock that used to be separate timers");
{
  const { sim, state } = shop(5);
  state.queue.push(sim.generateOrder(), sim.generateOrder());
  const p0 = state.queue.map(c => c.patience);
  sim.advance(999);
  ok(state.queue.every((c, i) => c.patience === p0[i]), "patience holds for 999 ms");
  sim.advance(STEP_MS * 2);
  ok(state.queue.every((c, i) => c.patience === p0[i] - 0.5), "and drops 0.5 at the second");
  // The served cup clears itself off the counter.
  const slot = slotFor(order("drip", {}, { id: 900 })); slot.cup.base = "drip";
  state.slots[0] = slot;
  sim.scoreServe(slot);
  sim.advance(SERVE_CLEAR_MS - STEP_MS);
  ok(state.slots[0] === slot, "a served cup sits on the counter for half a second");
  sim.advance(STEP_MS * 2);
  eq(state.slots[0], null, "then the station clears");
  // The bank is dropped while the shop is closed.
  const closed = shop(5);
  closed.state.shiftRunning = false;
  closed.sim.advance(600000);
  closed.state.shiftRunning = true;
  eq(closed.sim.advance(0), 0, "ten minutes of modal do not replay the instant the next day opens");
  // Spawn cadence: Dawn at day 1 spawns every 6.5 s.
  const dawn = shop(5);
  dawn.sim.advance(6500 - STEP_MS);
  eq(dawn.state.queue.length, 0, "nobody before 6.5 s at Dawn");
  dawn.sim.advance(STEP_MS * 2);
  eq(dawn.state.queue.length, 1, "the first customer at 6.5 s");
  eq(dawn.events.filter(e => e.type === "render" && e.scope === "queue").length > 0, true, "and the page was told to redraw the queue");
}

section("7. baristas take steps on the clock and hand the cup back");
{
  const { sim, state, events } = shop(21);
  state.baristas.push({ id: "b1", name: "Pip", level: 2, targetSlot: null, acc: 0, spec: null, trained: false, working: true });
  const o = order("latte", { milk: "oat" }, { id: 50 });
  state.queue.push(o);
  eq(sim.acceptCustomer(50), 0, "the order goes to station 1");
  const iv = BARISTA_TIERS[2].intervalMs;
  sim.advance(iv);
  ok(state.slots[0].cup.base === null, "nothing happens until the interval has passed (acc must exceed it)");
  sim.advance(STEP_MS * 2);
  eq(state.slots[0].cup.base, "espresso", "the senior pulled the shot on the first step");
  // Fatigue stretches the next one; the fumble roll is on the rng. Run out the rest.
  sim.advance(iv * 2);
  ok(sim.orderIsComplete(state.slots[0]) || events.some(e => e.type === "toast" && /rushed/.test(e.text)),
    "the cup is finished or was fumbled, and either way the barista said so");
  ok(events.some(e => e.type === "toast" && /Pip/.test(e.text)), "the toast names the barista");
  eq(state.baristas[0].targetSlot, null, "and let go of the station");
  eq(state.money, 60, "nothing was served: the money is the player's to earn");
  // A day off is also a wage holiday now (Phase 5, #348).
  const off = shop(21);
  off.state.baristas.push({ id: "b1", name: "Pip", level: 1, targetSlot: null, acc: 0, working: false });
  off.state.queue.push(order("drip", {}, { id: 51 })); off.sim.acceptCustomer(51);
  off.sim.advance(20000);
  eq(off.state.slots[0].cup.base, null, "a barista with the day off does no work");
}

section("8. a whole day, played by the autopilot, twice");
{
  const A = shop(2026), B = shop(2026);
  const stepsA = runShift(A.sim, A.state), stepsB = runShift(B.sim, B.state);
  eq(stepsA, stepsB, "the same number of steps");
  eq(fingerprint(A.state), fingerprint(B.state), "the same shop at close");
  const ds = A.state.dayStats;
  ok(ds.drinksServed + ds.foodServed > 10, `the autopilot served ${ds.drinksServed} drinks and ${ds.foodServed} food`);
  ok(A.state.money > 60, `and made money: $60 -> $${A.state.money}`);
  ok(ds.accuracyCount === ds.drinksServed + ds.foodServed && ds.accuracySum === ds.accuracyCount,
    "serving only complete cups, every serve scored 100%");
  const C = shop(2027); runShift(C.sim, C.state);
  ok(fingerprint(C.state) !== fingerprint(A.state), "a different seed is a different day");
  // Day two.
  A.sim.startNextDay();
  ok(A.state.day === 2 && A.state.shiftRunning && A.state.shiftElapsed === 0 && A.state.queue.length === 0
    && A.state.slots.every(s => s === null) && A.state.eventFiredThisShift === false,
    "startNextDay opens day 2 on an empty counter");
  ok(A.state.eventTriggerAt >= SHIFT_MS * 0.2 && A.state.eventTriggerAt <= SHIFT_MS * 0.7, "with the event scheduled inside the shift");
  const money1 = A.state.money;
  runShift(A.sim, A.state);
  ok(A.state.money > money1, `day 2 also paid: $${money1} -> $${A.state.money}`);
  eq(A.state.day, 2, "and the day number is the sim's to advance, not endShift's");
  // Wages come out at close.
  const W = shop(3);
  W.state.baristas.push({ id: "b1", name: "Juno", level: 1, targetSlot: null, acc: 0, working: true });
  W.state.money = 1000;
  const before = W.state.money;
  runShift(W.sim, W.state, STEP_MS, () => {});
  const summary = W.events.find(e => e.type === "shiftEnd").summary;
  eq(summary.wages, 35, "a junior's wage is $35");
  eq(W.state.money, before - 35, "and it came out of the till");
  eq(W.state.dayStats.wagesPaid, 35, "and into the day's stats");

  // A barista given the day off draws no wage (#348). Before the fix,
  // endShift() and the chalkboard's preview both summed every barista with
  // no `working` filter at all, so Pip could be given the day off and still
  // cost her full wage — sim.wagesDue() is the one rule both read now.
  const P = shop(3);
  P.state.baristas.push(
    { id: "b1", name: "Pip", level: 1, targetSlot: null, acc: 0, working: true },
    { id: "b2", name: "Juno", level: 2, targetSlot: null, acc: 0, working: false },
  );
  eq(P.sim.wagesDue(), 35, "wagesDue() charges only the working barista's wage, not both");
  const pSummary = P.sim.endShift();
  eq(pSummary.wages, 35, "and so does endShift() — the same $35, not $35+$70");
}

section("9. prestige and the day-one reset");
{
  const { sim, state, events } = shop(4);
  state.day = 7; state.money = 3000; state.upgrades.add("music"); state.unlockedSyrups.add("mocha");
  state.baristas.push({ id: "b1", name: "Pip", level: 2, targetSlot: null, acc: 0 });
  state.regulars.Nora = { order: { isFood: true, foodId: "bagel", price: 26 }, visits: 4, lastDay: 6, satisfaction: 40, tolerance: 1.2, stopped: false };
  state.regulars.Gideon = { order: { isFood: false, recipeId: "mocha", custom: { milk: "oat", syrup: "mocha", toppings: [], ice: false }, price: 55 },
    visits: 5, lastDay: 6, satisfaction: 10, tolerance: 0.8, stopped: true };
  sim.prestige();
  ok(state.prestigeLevel === 1 && state.day === 1 && state.money === 80, "level 1: day 1, $80");
  ok(state.upgrades.size === 0 && !state.unlockedSyrups.has("mocha") && state.baristas.length === 0, "upgrades, syrups and staff gone");
  // Regulars survive a reopen; their standing orders and satisfaction don't,
  // and someone who had already stopped coming was not coming back (#349).
  eq(Object.keys(state.regulars).join(","), "Nora", "Nora survives the reopen; Gideon, who'd already stopped, does not");
  eq(state.regulars.Nora.visits, 4, "her visit count survives");
  eq(state.regulars.Nora.tolerance, 1.2, "so does her tolerance");
  eq(state.regulars.Nora.satisfaction, 60, "satisfaction resets to the neutral start");
  ok(state.unlockedRecipes.has(state.regulars.Nora.order.recipeId) || state.regulars.Nora.order.isFood, "her re-rolled favourite is off the day-one menu");
  ok(events.some(e => e.type === "toast" && /prestige level 1/.test(e.text)), "and the page was told");
  ok(Math.abs(sim.shopTipMult() - 1.05) < 1e-9, "tips carry +5% per level");
  state.day = 20;
  ok(Math.abs(sim.spawnFactor() - 0.54) < 1e-9, `and the day-20 spawn floor is 0.54, not 0.6 (${sim.spawnFactor()})`);
  ok(Math.abs(sim.patienceFactor() - 0.69) < 1e-9, `and the patience floor 0.69, not 0.75 (${sim.patienceFactor()})`);
}

section("10. the page has no clock and no dice of its own, and owns no rule");
{
  // Phase 4: the page is index.html, which loads js/ui.js and nothing else,
  // plus the view modules ui.js imports. Every check below reads all of them.
  // Windows is the dev machine (v7 §7): a checkout with autocrlf on hands
  // back CRLF, and the `\n}\n` search below never matches `\r\n}\r\n` —
  // it fell through to the next bare `\n}\n` near the end of the file and
  // swept mountBar/init/the debug hook into "renderAll's body" with them.
  // Normalizing here is what makes this suite give the same verdict on any
  // checkout, not just a Linux CI runner's LF one.
  const read = (...p) => readFileSync(join(here, "..", ...p), "utf8").replace(/\r\n/g, "\n");
  const uncommented = src => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const VIEW = ["ui.js", "stations.js", "chalkboard.js", "draw.js", "sound.js"];
  const html = read("index.html");
  eq((html.match(/<script\b/g) || []).length, 1, "index.html has exactly one script tag");
  ok(/<script type="module" src="\.\/js\/ui\.js"><\/script>/.test(html), "and it is the module js/ui.js");
  const script = VIEW.map(f => uncommented(read("js", f))).join("\n");
  eq((script.match(/Math\.random\s*\(/g) || []).length, 0, "no Math.random() in the view — every roll goes through the sim's rng");
  eq((script.match(/setInterval\s*\(/g) || []).length, 0, "no setInterval — patience ticks on sim.advance()");
  ok(/sim\.advance\(dt\)/.test(script), "the page's frame loop calls sim.advance with the frame delta");
  ok(/rng:\s*Math\.random/.test(script), "and hands the sim Math.random as its rng");
  const simSrc = uncommented(read("js", "sim.js"));
  eq((simSrc.match(/Math\.random/g) || []).length, 1, "sim.js names Math.random once, as the default rng");
  ok(!/document\.|window\.|requestAnimationFrame|setTimeout|setInterval|performance\.now|Date\.now/.test(simSrc), "and touches no DOM, no timer, no wall clock");
  const content = uncommented(read("js", "content.js"));
  ok(!/\bstate\b/.test(content), "content.js reads no state");
  ok(!/spawnReplacementIfNeeded|spawnTimer|_blendIce/.test(script), "spawnTimer, spawnReplacementIfNeeded and the dead blend-ice button are gone");
  ok(!/needsWork|cupMatchesEnough/.test(script), "the page decides neither the tab dots nor the Serve gate — both come from the sim (#342)");
  // None owns a rule (#344, #345): the view never moves money, and never
  // writes the cup, a slot's plate, an unlock set, an upgrade or a barista's
  // level. applyPreset replacing slot.cup wholesale is the one cup write, and
  // it is the player's own saved build, not a rule.
  ok(!/state\.money\s*(?:[-+*]?=(?!=)|\+\+|--)/.test(script), "no view module writes state.money");
  ok(!/\bcup\.\w+\s*(?:=(?!=)|\+\+|--)|cup\.toppings\.(?:push|splice)/.test(script), "no view module writes a cup's fields — station buttons go through sim.cupAction");
  ok(!/unlocked\w+\.add\(|upgrades\.add\(|\.level\s*=(?!=)|\.trained\s*=(?!=)|foodPlated\s*=(?!=)/.test(script), "no view module grants an unlock, an upgrade, a promotion, training or a plate");
  ok(!/doUnlock\s*\(/.test(script), "and doUnlock() is gone; the chalkboard calls sim.purchase through buy()");
  // The save is throttled (#346): renderAll() marks it dirty and never writes.
  const ui = uncommented(read("js", "ui.js"));
  const renderAllBody = ui.slice(ui.indexOf("function renderAll(){"), ui.indexOf("\n}\n", ui.indexOf("function renderAll(){")));
  ok(renderAllBody.length > 100 && /markDirty\(\)/.test(renderAllBody), "renderAll() marks the save dirty");
  ok(!/saveNow\(|saveSlot\.save\(|setItem/.test(renderAllBody), "and does not write it — a redraw is not a save");

  // The old URL is a stub on #46's pattern, like Projects/daredevil_r4.html.
  const stub = readFileSync(join(here, "..", "..", "coffee_shop_sim.html"), "utf8");
  ok(stub.split("\n").length < 60, `coffee_shop_sim.html is a stub, not a game (${stub.split("\n").length} lines)`);
  ok(/<meta name="robots" content="noindex">/.test(stub), "the stub is noindex");
  ok(/<meta http-equiv="refresh" content="0; url=corner-and-kettle\/">/.test(stub), "and refreshes to corner-and-kettle/");
  ok(/<link rel="canonical" href="https:\/\/greyversusblue\.com\/Projects\/corner-and-kettle\/">/.test(stub), "with the new page as canonical");
  ok(!/<script/.test(stub), "and runs no script");
}

section("11. the Serve gate and its cue (#341, #342)");
{
  const { sim } = shop(11);
  const TABS = ["base", "milk", "blend", "syrup", "toppings", "food"];
  // Every line names a real station tab, and its own apply() satisfies its own
  // check on an empty cup — so the dot, the barista and the ticket cannot
  // disagree about where a line is made or what making it means.
  let lines = 0, badStation = [], badApply = [];
  for (const r of RECIPES) {
    const o = order(r.id, { milk: r.needsMilk ? "almond" : undefined, syrup: r.requiredSyrup || "hazelnut", toppings: ["whip", "sprinkles"], ice: !!r.ice });
    for (const req of sim.getOrderRequirements(o)) {
      lines++;
      if (!TABS.includes(req.station)) badStation.push(`${r.id}: "${req.label}" -> ${req.station}`);
      const slot = slotFor(o); req.apply(slot);
      if (!req.check(slot)) badApply.push(`${r.id}: "${req.label}"`);
    }
  }
  for (const f of FOODS) {
    const [req] = sim.getOrderRequirements(foodOrder(f.id));
    lines++;
    if (req.station !== "food") badStation.push(`${f.id} -> ${req.station}`);
    const slot = slotFor(foodOrder(f.id)); req.apply(slot);
    if (!req.check(slot)) badApply.push(f.id);
  }
  ok(badStation.length === 0, `all ${lines} ticket lines name one of the six working tabs${badStation.length ? " — " + badStation.join("; ") : ""}`);
  ok(badApply.length === 0, `and each line's apply() satisfies its own check${badApply.length ? " — " + badApply.join("; ") : ""}`);

  // A latte, line by line: the button's count is the ticket's count.
  const latte = slotFor(order("latte", { milk: "oat" }));
  let r = sim.serveReadiness(latte);
  ok(!r.canServe && r.done === 0 && r.total === 2, "an empty latte cannot be served, 0 of 2");
  eq(r.missing.join(" | "), "1 espresso shot | Oat Milk, steamed", "and says what it still needs");
  latte.cup.base = "espresso"; latte.cup.shots = 1;
  ok(!sim.serveReadiness(latte).canServe, "a shot and no milk is still not a latte attempt (cupMatchesEnough)");
  latte.cup.milk = "oat";
  r = sim.serveReadiness(latte);
  ok(r.canServe && !r.complete && r.done === 1 && r.total === 2, "cold oat milk: servable, short, 1 of 2");
  eq(r.missing.join(" | "), "Oat Milk, steamed", "missing exactly the steaming");
  eq([...sim.stationsNeedingWork(latte)].join(","), "milk", "and only the milk tab carries a dot");
  latte.cup.milkSteamed = true;
  r = sim.serveReadiness(latte);
  ok(r.canServe && r.complete && r.missing.length === 0 && r.done === 2, "steamed: complete, nothing missing");
  eq(sim.stationsNeedingWork(latte).size, 0, "and no tab carries a dot");

  // What the button promises is what the scorer pays: done/total is the ratio.
  const short = slotFor(order("caramelmac", { milk: "whole", syrup: "caramel", toppings: ["whip", "cinnamon"] }, { patience: 0 }));
  short.cup.base = "espresso"; short.cup.shots = 1; short.cup.milk = "whole"; short.cup.toppings = ["cinnamon"];
  const promise = sim.serveReadiness(short);
  ok(promise.canServe && promise.done === 2 && promise.total === 5, `a macchiato with a shot, cold milk and cinnamon is 2 of 5 (${promise.done}/${promise.total})`);
  eq(sim.scoreServe(short).ratio, promise.done / promise.total, "and the scorer pays exactly that ratio");

  // The ice line is made at the milk station, where the ice button is. Before
  // #342 the tabs' own predicates had no line for it, so an unfinished iced
  // latte showed no dot anywhere.
  const iced = slotFor(order("latte", { milk: "oat", ice: true }));
  iced.cup.base = "espresso"; iced.cup.shots = 1; iced.cup.milk = "oat";
  eq([...sim.stationsNeedingWork(iced)].join(","), "milk", "an iced latte short only its ice shows a dot on Milk");
  const frappe = slotFor(order("frappe", { milk: "skim" }));
  eq([...sim.stationsNeedingWork(frappe)].sort().join(","), "base,blend,milk", "an empty frappe needs base, milk and blend");

  // Food: an empty plate is not an attempt (#342). It used to be servable for
  // 40% of the price the instant the order reached a station.
  const plate = slotFor(foodOrder("muffin"));
  r = sim.serveReadiness(plate);
  ok(!r.canServe && r.total === 1 && r.missing[0] === "Muffin", "an empty plate cannot be served, and says it needs the muffin");
  plate.foodPlated = "cookie";
  r = sim.serveReadiness(plate);
  ok(r.canServe && !r.complete && r.done === 0, "the wrong pastry is servable and short, 0 of 1");
  plate.foodPlated = "muffin";
  ok(sim.serveReadiness(plate).complete, "the right one is complete");
}

section("12. the chalkboard is one purchase table, and the stations are one action table (#344, #345)");
{
  const snapshot = st => JSON.stringify({ ...st, unlockedRecipes: [...st.unlockedRecipes], unlockedSyrups: [...st.unlockedSyrups],
    unlockedToppings: [...st.unlockedToppings], unlockedFoods: [...st.unlockedFoods], upgrades: [...st.upgrades] });
  // One of everything a chalkboard button can name, on a shop with a barista
  // to promote and a day late enough to reopen.
  const ITEMS = [
    ["recipe", "mocha"], ["food", "muffin"], ["syrup", "hazelnut"], ["topping", "sprinkles"], ["station", 3],
    ["hireBarista"], ["promoteBarista", "b1"], ["raiseBarista", "b1"], ["loyalty", 1], ["shield"],
    ["equipment", "grinder"], ["ambiance", "music"], ["business", "franchise"], ["marketing"],
  ];
  const withStaff = st => { st.day = 7; st.reputation = 90; st.baristas.push({ id: "b1", name: "Pip", level: 1, targetSlot: null, acc: 0,
    skill: { bar:0, kitchen:0, register:0 }, morale: 70, training: null, working: true }); };
  {
    const { sim } = shop(12);
    // train and scheduleBarista and prestige cost no money — their day is
    // spent below, not in the $0/$100,000 loop, which is only for purchases
    // priced in dollars.
    const covered = new Set([...ITEMS.map(i => i[0]), "train", "scheduleBarista", "prestige"]);
    eq([...sim.PURCHASE_TYPES].sort().join(","), [...covered].sort().join(","), "every purchase type in the table is exercised here");
  }
  // Broke: every priced purchase is refused, says why, and changes nothing at all.
  {
    const { sim, state } = shop(12, st => { withStaff(st); st.money = 0; });
    const bad = [];
    for (const [type, id] of ITEMS) {
      const before = snapshot(state);
      const c = sim.canBuy(type, id);
      const r = sim.purchase(type, id);
      if (c.ok || r.ok) bad.push(`${type} allowed at $0`);
      if (!r.reason || /^Unlocked!$/.test(r.reason) || !/\$\d+ needed/.test(r.reason)) bad.push(`${type}: reason "${r.reason}"`);
      if (snapshot(state) !== before) bad.push(`${type} changed the shop while refusing`);
    }
    ok(bad.length === 0, `at $0 all ${ITEMS.length} priced purchases are refused with "$N needed" and change nothing${bad.length ? " — " + bad.join("; ") : ""}`);
  }
  // Rich: each one goes through, and takes exactly what canBuy said it would.
  {
    const { sim, state } = shop(12, st => { withStaff(st); st.money = 100000; });
    const bad = [];
    for (const [type, id] of ITEMS) {
      const quoted = sim.canBuy(type, id);
      const before = state.money;
      const r = sim.purchase(type, id);
      if (!r.ok) bad.push(`${type} refused: ${r.reason}`);
      else if (before - state.money !== quoted.cost || quoted.cost <= 0) bad.push(`${type} took $${before - state.money}, quoted $${quoted.cost}`);
      if (sim.purchase(type, id).ok && !["hireBarista", "shield", "raiseBarista"].includes(type)) bad.push(`${type} bought twice`);
    }
    ok(bad.length === 0, `with $100,000 each goes through once, for exactly the quoted price${bad.length ? " — " + bad.join("; ") : ""}`);
  }
  // The rules the old doUnlock() carried in its branches.
  {
    const { sim, state } = shop(12, st => { st.money = 100000; });
    eq(sim.purchase("recipe", "nitrocoldbrew").reason, "Unlock Cold Brew first.", "a recipe chain refuses out of order");
    eq(sim.purchase("recipe", "ristretto").reason, "This recipe unlocks automatically with the matching equipment.", "an equipment-gated recipe cannot be bought");
    eq(sim.purchase("equipment", "espresso3").reason, "Install Dual-Boiler Espresso Machine first.", "equipment refuses without its predecessor");
    ok(sim.purchase("equipment", "espresso2").ok && state.unlockedRecipes.has("ristretto"), "espresso2 puts the ristretto on the menu");
    eq(sim.purchase("business", "franchise").reason, "Second Location needs 80 reputation.", "the franchise waits on reputation");
    eq([1, 2, 3].map(() => (sim.purchase("hireBarista"), state.baristas.at(-1).id)).join(","), "b1,b2,b3", "hires are b1, b2, b3, the same on every run");
    ok(!sim.purchase("hireBarista").ok && state.baristas.length === 3, "and a fourth is refused");
    eq([0, 1, 2].map(() => { const c = sim.canBuy("shield").cost; sim.purchase("shield"); return c; }).join(","), "150,200,250", "shields cost 150, 200, 250");
    ok(!sim.purchase("shield").ok && state.comboShields === 3, "and a fourth held is refused");
    ok(sim.purchase("station", "3").ok && state.slots.length === 3, "a station id read off a data attribute as a string still buys");
    // Training (#348): free, takes the barista's day rather than the till,
    // and cannot be started twice at once or on a name that doesn't exist.
    eq(sim.purchase("train", "b1", "bar").text, "Pip starts bar training today — slower, but trained by close.", "training starts for free");
    eq(state.baristas[0].training, "bar", "and marks the barista as training that group");
    eq(sim.purchase("train", "b1", "kitchen").reason, "Pip is already training today.", "only one group in flight at a time");
    eq(sim.purchase("train", "nope", "bar").reason, "No such barista.", "and a bad id is refused, not a crash");
    ok(sim.purchase("scheduleBarista", "b1").ok && state.baristas[0].working === false, "scheduling gives the day off");
    eq(sim.purchase("train", "b1", "kitchen").reason, "Pip has the day off.", "and a barista off duty cannot start training");
    eq(sim.purchase("prestige").reason, "Reopening is available from day 6.", "no reopening on day 1");
    state.shiftRunning = false;
    eq(sim.purchase("marketing").reason, "The shop is closed.", "no marketing between shifts");
    state.day = 6; state.shiftRunning = true;
    ok(sim.purchase("prestige").ok && state.prestigeLevel === 1 && state.baristas.length === 0, "day 6 reopens the shop");
  }
  // The station buttons: a Frappe by hand in either order (#343), and the rest.
  {
    const { sim } = shop(12);
    const build = (steps) => { const sl = slotFor(order("frappe", { milk: "oat" })); for (const [a, v] of steps) sim.cupAction(sl, a, v); return sl; };
    ok(sim.orderIsComplete(build([["pullShot"], ["pickMilk", "oat"], ["blend"]])), "shot, milk, blend: a complete Frappe");
    ok(sim.orderIsComplete(build([["blend"], ["pullShot"], ["pickMilk", "oat"]])), "blend, shot, milk: a complete Frappe too");
    const latte = slotFor(order("latte", { milk: "whole", toppings: ["cinnamon"] }));
    for (const [a, v] of [["pullShot"], ["pickMilk", "whole"], ["steamMilk"], ["toggleTopping", "cinnamon"]]) sim.cupAction(latte, a, v);
    ok(sim.orderIsComplete(latte), "a latte with cinnamon, by its four buttons");
    eq(sim.cupAction(latte, "toggleTopping", "cinnamon"), "Removed topping", "the topping button toggles off");
    ok(!sim.orderIsComplete(latte), "and the ticket notices");
    sim.cupAction(latte, "pickMilk", "whole");
    eq(latte.cup.milkSteamed, false, "picking the milk again un-steams it, as the button always has");
    const dumped = latte.cup; latte.cup = newCup();
    sim.cupAction(latte, "pullShot", undefined, dumped);
    ok(latte.cup.shots === 0 && dumped.shots === 2, "a bar that finishes after a dump lands in the dumped cup");
    const plate = slotFor(foodOrder("bagel"));
    sim.cupAction(plate, "plateFood", "bagel");
    ok(sim.orderIsComplete(plate), "plating the bagel completes the bagel");
  }
  {
    const { sim, state } = shop(12);
    eq(sim.cupActionMs("pullShot"), 500, "a shot takes 500 ms on the day-one machine");
    state.upgrades.add("espresso2");
    eq(sim.cupActionMs("pullShot"), 320, "320 on tier 2");
    state.activeEvent = { id: "outage", until: 1e9 };
    eq(sim.cupActionMs("steamMilk"), 900 * 1.8, "an outage stretches steaming by 1.8x");
    eq(sim.cupActionMs("pickMilk"), 0, "picking a milk is instant");
  }
}

section("13. staff: skill, training and morale (#348)");
{
  const junior = () => ({ id: "b", name: "B", level: 1, skill: { bar:0, kitchen:0, register:0 }, morale: 70, training: null, working: true });
  const { sim } = shop(30);

  // effectiveSpec is a reading of skill now, not a switch the player sets.
  eq(sim.effectiveSpec({ ...junior(), skill: { bar:1, kitchen:0, register:0 } }), "bar", "bar-only skill reads as a bar specialist");
  eq(sim.effectiveSpec({ ...junior(), skill: { bar:0, kitchen:1, register:0 } }), "kitchen", "kitchen-only skill reads as a kitchen specialist");
  eq(sim.effectiveSpec({ ...junior(), skill: { bar:1, kitchen:1, register:0 } }), null, "trained in both is a generalist");
  eq(sim.effectiveSpec(junior()), null, "untrained is a generalist too, gated only by level");

  const barOnly = { ...junior(), skill: { bar:1, kitchen:0, register:0 } };
  ok(!sim.baristaCanHandle(barOnly, { isFood: true }), "a bar specialist will not touch food");
  ok(sim.baristaCanHandle(barOnly, { isFood: false, recipeId: "drip" }), "but still makes drinks");
  const kitchenOnly = { ...junior(), skill: { bar:0, kitchen:1, register:0 } };
  ok(!sim.baristaCanHandle(kitchenOnly, { isFood: false, recipeId: "drip" }), "a kitchen specialist will not touch a drink");

  // Speed and mistakes: neutral at rest, faster and cleaner trained.
  const plain = junior();
  const trainedBar = { ...junior(), skill: { bar:1, kitchen:0, register:0 } };
  const trainedRegister = { ...junior(), skill: { bar:0, kitchen:0, register:1 } };
  ok(sim.baristaIntervalMs(trainedBar, "bar") < sim.baristaIntervalMs(plain, "bar"), "bar training speeds up a bar step");
  eq(sim.baristaIntervalMs(trainedBar, "kitchen"), sim.baristaIntervalMs(plain, "kitchen"), "but not a kitchen one");
  ok(sim.baristaIntervalMs(trainedRegister, "bar") < sim.baristaIntervalMs(plain, "bar"), "register training speeds up either group");
  ok(sim.baristaIntervalMs(trainedRegister, "kitchen") < sim.baristaIntervalMs(plain, "kitchen"), "...both of them");
  const inTraining = { ...junior(), training: "bar" };
  ok(sim.baristaIntervalMs(inTraining, "bar") > sim.baristaIntervalMs(plain, "bar"), "training itself is slower, not faster, until it lands");

  ok(sim.mistakeReduceFactor(trainedBar, false) < sim.mistakeReduceFactor(plain, false), "bar training also cuts mistakes on a drink");
  eq(sim.mistakeReduceFactor(trainedBar, true), sim.mistakeReduceFactor(plain, true), "but not on food");
  ok(sim.mistakeReduceFactor(inTraining, false) > sim.mistakeReduceFactor(plain, false), "and training itself is clumsier");

  // Morale: neutral at MORALE_START, so a fresh hire moves exactly like the
  // old, morale-less barista did.
  eq(sim.moraleSpeedMult(plain), 1, "neutral morale is speed-neutral");
  eq(sim.moraleMistakeMult(plain), 1, "and mistake-neutral");
  const tired = { ...junior(), morale: 10 };
  const chuffed = { ...junior(), morale: 100 };
  ok(sim.moraleSpeedMult(tired) > 1 && sim.moraleSpeedMult(chuffed) < 1, "low morale is slower, high morale faster");
  ok(sim.moraleMistakeMult(tired) > 1 && sim.moraleMistakeMult(chuffed) < 1, "low morale is clumsier, high morale cleaner");

  // Training resolves and morale moves at endShift(), for whoever worked
  // today; a day off rests instead.
  const { sim: sim2, state: s2 } = shop(31);
  s2.baristas.push({ id: "b1", name: "Pip", level: 1, skill: { bar:0, kitchen:0, register:0 }, morale: 70, training: "bar", working: true });
  s2.baristas.push({ id: "b2", name: "Juno", level: 1, skill: { bar:0, kitchen:0, register:0 }, morale: 70, training: null, working: false });
  sim2.endShift();
  eq(s2.baristas[0].skill.bar, 1, "Pip's bar training landed at close");
  eq(s2.baristas[0].training, null, "and is no longer in progress");
  eq(s2.baristas[0].morale, 64, "working today cost her 6 morale");
  eq(s2.baristas[1].morale, 80, "Juno's day off gained her 10");
}

section("14. regulars are a record now, and word of mouth is bounded (#349)");
{
  const { sim, state } = shop(40);
  // A regular is minted with a full record on the first visit, and a second
  // visit reuses the record rather than re-rolling a new favourite.
  let firstVisit = null;
  for (let i = 0; i < 400 && !firstVisit; i++) { const o = sim.generateOrder(); if (o.isRegular) firstVisit = o; }
  ok(firstVisit, "some regular walked in within 400 tries");
  const name = firstVisit.regularName;
  const rec = state.regulars[name];
  ok(rec && rec.visits >= 1 && Number.isFinite(rec.satisfaction) && Number.isFinite(rec.tolerance) && rec.stopped === false,
    "the record carries visits, satisfaction and tolerance from the first visit");
  const visits0 = rec.visits;
  let secondVisit = null;
  for (let i = 0; i < 400 && !secondVisit; i++) { const o = sim.generateOrder(); if (o.regularName === name) secondVisit = o; }
  ok(secondVisit, "the same regular walked in again");
  eq(state.regulars[name].visits, visits0 + 1, "and the visit count went up, not a fresh record");

  // Served badly enough, often enough, a regular stops coming — a
  // deterministic threshold, not a dice roll.
  state.regulars.Nora = { order: { isFood: true, foodId: "bagel", price: 26 }, visits: 3, lastDay: 1, satisfaction: 30, tolerance: 1, stopped: false };
  const missSlot = slotFor(foodOrder("bagel", { patience: 0, isRegular: true, regularName: "Nora" }));
  missSlot.foodPlated = "croissant"; // wrong plate: not happy
  sim.scoreServe(missSlot);
  ok(state.regulars.Nora.stopped, "three visits in, served badly at low satisfaction, and Nora stops coming");
  ok(!sim.activeRegularNames().includes("Nora"), "so she is no longer in the rotation");
  eq(state.dayStats.lostRegularNames.join(","), "Nora", "and the day-end modal can say who");

  // Served well at high satisfaction, a regular sometimes brings a friend —
  // probabilistic, so measured over many trials rather than one call.
  let friends = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const { sim: s2, state: st2 } = shop(1000 + i);
    st2.regulars.Gideon = { order: { isFood: true, foodId: "bagel", price: 26 }, visits: 5, lastDay: 1, satisfaction: 90, tolerance: 1, stopped: false };
    const slot = slotFor(foodOrder("bagel", { patience: 40, patienceMax: 40, isRegular: true, regularName: "Gideon" }));
    slot.foodPlated = "bagel";
    s2.scoreServe(slot);
    if (st2.dayStats.newRegularNames.length) friends++;
  }
  const rate = friends / trials;
  ok(Math.abs(rate - REGULAR_FRIEND_CHANCE) < 0.08, `bring-a-friend fires near REGULAR_FRIEND_CHANCE (${REGULAR_FRIEND_CHANCE}), measured ${rate.toFixed(3)}`);

  // Word of mouth is bounded (#349, #34): a maximally good shop's raw signal
  // would push the regular-chance multiplier to 1.5, past WORD_OF_MOUTH_MAX —
  // this is exactly what removing the clamp in wordOfMouthGoodness() breaks.
  const good = shop(41); good.state.reputation = 100;
  for (let i = 0; i < 8; i++) {
    good.state.regulars["r" + i] = { order: { isFood: true, foodId: "bagel", price: 26 }, visits: 1, lastDay: 1, satisfaction: 100, tolerance: 1, stopped: false };
  }
  const bad = shop(42); bad.state.reputation = 0;
  eq(good.sim.wordOfMouthRegularMult(), WORD_OF_MOUTH_MAX, "a maximally good shop's regular-chance multiplier is clamped at the ceiling");
  ok(bad.sim.wordOfMouthRegularMult() < 1 && bad.sim.wordOfMouthRegularMult() >= WORD_OF_MOUTH_MIN, "a maximally bad one sits below 1, inside the floor");
  ok(good.sim.wordOfMouthSpawnMult() < 1, "a good shop's door opens faster (a smaller spawn-interval multiplier)");
  ok(bad.sim.wordOfMouthSpawnMult() > 1, "a bad one opens slower");
}

/* ---------- report ---------- */

const total = passed + failures.length;
process.stdout.write(`\n${passed} passed, ${failures.length} failed (${total} assertions)\n`);
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.exit(1);
}
