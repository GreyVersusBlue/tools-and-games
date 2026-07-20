// smoke-engine.mjs — node test/smoke-engine.mjs
// Exercises the pure night engine: arrivals, tickets, boss deliveries,
// impatience, game beats, summary math. No DOM, no three.js.

import { NightEngine, MENU, seed, HOUR_W, PATIENCE, BOSS_TIP } from "../js/engine.js";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
