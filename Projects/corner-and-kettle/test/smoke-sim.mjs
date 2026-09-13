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
const { SHIFT_MS, PHASES, RECIPES, FOODS, BARISTA_TIERS } = CONTENT;

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
  // A day off is not a wage holiday yet (that is Phase 5's row), but it is a day off.
  const off = shop(21);
  off.state.baristas.push({ id: "b1", name: "Pip", level: 1, targetSlot: null, acc: 0, spec: null, trained: false, working: false });
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
  W.state.baristas.push({ id: "b1", name: "Juno", level: 1, targetSlot: null, acc: 0, spec: null, trained: false, working: true });
  W.state.money = 1000;
  const before = W.state.money;
  runShift(W.sim, W.state, STEP_MS, () => {});
  const summary = W.events.find(e => e.type === "shiftEnd").summary;
  eq(summary.wages, 35, "a junior's wage is $35");
  eq(W.state.money, before - 35, "and it came out of the till");
  eq(W.state.dayStats.wagesPaid, 35, "and into the day's stats");
}

section("9. prestige and the day-one reset");
{
  const { sim, state, events } = shop(4);
  state.day = 7; state.money = 3000; state.upgrades.add("music"); state.unlockedSyrups.add("mocha");
  state.baristas.push({ id: "b1", name: "Pip", level: 2, targetSlot: null, acc: 0 });
  state.regulars.Nora = { isFood: true, foodId: "bagel", price: 26 };
  sim.prestige();
  ok(state.prestigeLevel === 1 && state.day === 1 && state.money === 80, "level 1: day 1, $80");
  ok(state.upgrades.size === 0 && !state.unlockedSyrups.has("mocha") && state.baristas.length === 0, "upgrades, syrups and staff gone");
  eq(Object.keys(state.regulars).length, 0, "regulars cleared (their favourites name syrups the shop no longer stocks)");
  ok(events.some(e => e.type === "toast" && /prestige level 1/.test(e.text)), "and the page was told");
  ok(Math.abs(sim.shopTipMult() - 1.05) < 1e-9, "tips carry +5% per level");
  state.day = 20;
  ok(Math.abs(sim.spawnFactor() - 0.54) < 1e-9, `and the day-20 spawn floor is 0.54, not 0.6 (${sim.spawnFactor()})`);
  ok(Math.abs(sim.patienceFactor() - 0.69) < 1e-9, `and the patience floor 0.69, not 0.75 (${sim.patienceFactor()})`);
}

section("10. the page has no clock and no dice of its own");
{
  const page = readFileSync(join(here, "..", "..", "coffee_shop_sim.html"), "utf8");
  const script = page.slice(page.indexOf('<script type="module">'), page.lastIndexOf("</script>"));
  eq((script.match(/Math\.random\s*\(/g) || []).length, 0, "no Math.random() in the page — every roll goes through the sim's rng");
  eq((script.match(/setInterval\s*\(/g) || []).length, 0, "no setInterval — patience ticks on sim.advance()");
  ok(/sim\.advance\(dt\)/.test(script), "the page's frame loop calls sim.advance with the frame delta");
  ok(/rng:\s*Math\.random/.test(script), "and hands the sim Math.random as its rng");
  const uncommented = src => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const simSrc = uncommented(readFileSync(join(here, "..", "js", "sim.js"), "utf8"));
  eq((simSrc.match(/Math\.random/g) || []).length, 1, "sim.js names Math.random once, as the default rng");
  ok(!/document\.|window\.|requestAnimationFrame|setTimeout|setInterval|performance\.now|Date\.now/.test(simSrc), "and touches no DOM, no timer, no wall clock");
  const content = uncommented(readFileSync(join(here, "..", "js", "content.js"), "utf8"));
  ok(!/\bstate\b/.test(content), "content.js reads no state");
  ok(!/spawnReplacementIfNeeded|spawnTimer|_blendIce/.test(script), "spawnTimer, spawnReplacementIfNeeded and the dead blend-ice button are gone");
}

/* ---------- report ---------- */

const total = passed + failures.length;
process.stdout.write(`\n${passed} passed, ${failures.length} failed (${total} assertions)\n`);
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.exit(1);
}
