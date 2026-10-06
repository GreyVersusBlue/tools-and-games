// smoke-settle.mjs — node test/smoke-settle.mjs
//
// The one settlement. settleNight() and settleDarkNight() were two functions
// that shared billsFor() and repeated everything after it; they are one
// closeNight() now (#898), and this file is what holds it to the numbers the
// two gave.
//
// The proof was run once, old code against new, over the chain below: every
// record and every campaign after it, byte for byte. That comparison cannot
// live here because the old code does not, so what stays is its fingerprint —
// PIN is the SHA-256 of the same chain, taken from the two-function build
// before the change and unchanged by it. A deliberate change to the economy
// (a rent, SPOILAGE_RATE, a loyalty drift) moves it and is meant to: re-pin
// it in the commit that makes the change, and say which number moved.
//
// The supply house (#905) added four things to what the chain writes and
// moved none of what was there: `account` in every record (the weekly fee, 0
// at County Line), `account` in an open night's `moments` (what a card took
// off the house account's standing) and `dist` and `pars` in every campaign. Every campaign in
// the chain is at County Line, which is the old rule, so `old()` takes the
// four out and the digest of the rest is still PIN, unchanged. A second
// digest could pin the four; they are all the same value 2,400 times, and
// the lines under the pin say so instead.
//
// The rota (#908) did the same thing once more: `crew` in every record (who
// worked, who was off, who levelled, who left) and `crew` in every campaign.
// No campaign in the chain posts a rota, which is the old rule, so `old()`
// takes those two out as well and the digest is still PIN. test/smoke-staff.mjs
// is where a posted rota is settled.
//
// And the dated shelf (#909), a third time: `walkin` in every record (the
// compressor's power, 0 with no walk-in) and `shelf` in every campaign. No
// campaign in the chain dates its shelf, so every close in it is the flat
// SPOILAGE_RATE, which is the old rule; `old()` takes the two out and the
// digest is still PIN. test/smoke-shelf.mjs is where a dated shelf is closed.
//
// And season terms (#911), a fourth: `terms` in every campaign and nothing in
// a record, whose `rent` and `wages` are the numbers they always were. No
// campaign in the chain signs, so every night in it is month to month, which
// is the old rule; `old()` takes the one field out and the digest is still
// PIN. test/smoke-season.mjs is where a night on terms is settled.

import { createHash } from "node:crypto";
import * as C from "../js/campaign.js";
import { mulberry32, MENU } from "../js/engine.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = x => JSON.parse(JSON.stringify(x));

function seeded(seed) {
  let s = seed >>> 0;
  return () => { const r = mulberry32(s); s = r.state; return r.value; };
}

const PROMO_IDS = Object.keys(C.PROMOS);
const UPGRADE_IDS = Object.keys(C.UPGRADES);
const ITEMS = Object.keys(MENU);

/** Knock a campaign somewhere a real run could reach, and a few places only a
 *  bad save could: a till below zero or with cents in it, any rung, any set
 *  of upgrades, a crew of nought to three on any wage, a bare shelf. */
function scramble(c, r) {
  const pick = a => a[Math.floor(r() * a.length)];
  if (r() < 0.5) c.cash = Math.round((r() * 9000 - 2500) * 100) / 100;
  if (r() < 0.2) c.venue = pick(C.VENUE_ORDER);
  if (r() < 0.2) c.upgrades = UPGRADE_IDS.filter(() => r() < 0.4);
  if (r() < 0.3) c.promoTonight = pick(PROMO_IDS);
  if (r() < 0.2) c.staff = c.staff.concat(c.applicants).slice(0, Math.floor(r() * 4)).map(s => ({ ...s, wage: Math.round(40 + r() * 160) }));
  if (r() < 0.4) for (const id of ITEMS) c.stock[id] = Math.floor(r() * r() * 60);
  if (r() < 0.1) c.rep = Math.floor(r() * 101);
  if (r() < 0.1) c.darkNightsLeft = Math.floor(r() * 4);
  if (r() < 0.05) c.day += Math.floor(r() * 40);
}

function summaryOf(c, r) {
  const total = Math.round(r() * 2400 * 100) / 100;
  const tips = Math.round(total * 0.1 * 100) / 100;
  const served = Math.floor(r() * 60), walkouts = Math.floor(r() * 12);
  const s = { total, revenue: total - tips, tips, served, walkouts, mood: r(), serviceRate: Math.floor(r() * 101) };
  if (r() < 0.5) s.arrivals = served + walkouts;
  if (C.isGameNight(c) && r() < 0.8) s.game = { started: true, finished: r() < 0.9, win: r() < 0.5 };
  if (c.regulars.length && r() < 0.3) s.comped = [c.regulars[Math.floor(r() * c.regulars.length)].id];
  return s;
}

/** `campaigns` runs of `nights` nights each, a quarter of them dark. Returns
 *  every record and every campaign as it stood after it. */
export function chain(campaigns, nights, seed) {
  const out = [];
  const real = Math.random;
  const r = seeded(seed);
  // newCampaign() and the league roll off Math.random, so it is seeded too
  Math.random = seeded(seed ^ 0x9e3779b9);
  try {
    for (let k = 0; k < campaigns; k++) {
      const c = C.newCampaign();
      for (let n = 0; n < nights; n++) {
        scramble(c, r);
        const dark = r() < 0.25;
        const rand = seeded(Math.floor(r() * 4294967296));
        const books = dark ? C.settleDarkNight(c, rand) : C.settleNight(c, summaryOf(c, r), rand);
        out.push({ dark, books: clone(books), after: clone(c) });
      }
    }
  } finally { Math.random = real; }
  return out;
}

const PIN = "40adf11e76e63af8e9ea1126d097d54f198651737786976fa0b1fd6bb2f45631";
const runs = chain(40, 60, 20261006);
/** A run as the build before the supply house wrote it. */
function old(x) {
  const { account, walkin, crew: shift, ...books } = x.books;
  if (books.moments) { const { account: standing, ...moments } = books.moments; books.moments = moments; }
  const { dist, pars, crew, shelf, terms, ...after } = x.after;
  return { dark: x.dark, books, after };
}
const digest = createHash("sha256").update(JSON.stringify(runs.map(old))).digest("hex");
if (process.argv.includes("--digest")) { console.log(digest); process.exit(0); }
ok(runs.length === 2400, "the chain is 40 campaigns of 60 nights");
ok(digest === PIN, `2,400 settled nights give the records and campaigns the two-function build gave (sha256 ${digest.slice(0, 12)}, pinned ${PIN.slice(0, 12)})`);
ok(runs.every(x => x.books.account === 0 && (x.dark || x.books.moments.account === 0) && JSON.stringify(x.after.dist) === '{"id":"county","spend":0}' && JSON.stringify(x.after.pars) === "{}"),
  "and the four fields the pin leaves out are the same in all 2,400: no fee, no standing moved, County Line with nothing spent, an empty par sheet");
ok(runs.every(x => JSON.stringify(x.after.crew) === '{"rota":false,"book":{}}' && x.books.crew.rota === false
  && x.books.crew.off.length + x.books.crew.out.length + x.books.crew.call.length + x.books.crew.leveled.length + x.books.crew.quit.length + x.books.crew.poached.length === 0),
  "nor the rota's two: nobody posted one, so nobody was off, called out, levelled or walked in 2,400 nights");
ok(runs.every(x => JSON.stringify(x.after.shelf) === '{"dated":false,"walkin":false,"lots":{}}' && x.books.walkin === 0 && !("dated" in x.books.spoilage)),
  "nor the shelf's two: nobody dated one, so no walk-in was billed and all 2,400 closes were the flat rate's");
ok(runs.every(x => JSON.stringify(x.after.terms) === '{"signed":false,"since":0}' && Object.values(C.VENUES).some(v => v.rent === x.books.rent)),
  "nor the terms' one: nobody signed, so all 2,400 nights paid a room's own rent");
ok(runs.some(x => C.weekday({ day: x.after.day - 1 }) === "Mon"), "the chain settled Mondays, the night an account would have been billed");

// The sweep has to have gone where the two functions differed, or its
// agreement says nothing.
{
  const dark = runs.filter(x => x.dark), open = runs.filter(x => !x.dark);
  ok(dark.length > 400 && open.length > 1400, `both paths are in it (${dark.length} dark, ${open.length} open)`);
  ok(open.some(x => x.books.promoCost > 0), "an open night paid for a promo");
  ok(runs.some(x => x.books.lease.evicted) && runs.some(x => x.books.lease.warned) && runs.some(x => x.books.lease.cleared), "the landlord warned, cleared and evicted");
  ok(dark.some(x => x.books.spoilage.value > 0) && open.some(x => x.books.spoilage.value > 0), "the shelf rotted on both");
  ok(runs.some(x => x.books.social.lost.length) && open.some(x => x.books.social.gained), "regulars were lost and minted");
  ok(open.some(x => x.books.social.snubbed.length), "a usual was 86'd");
  ok(runs.some(x => x.books.games.some(g => g.playoff === "final")), "a final was played");
  ok(runs.some(x => x.after.failed), "a run ended at the Corner Tap");
}

// What a dark night is, stated on its own so a red PIN has a second opinion
// that names the line: an open night that took nothing, with three exceptions.
{
  const base = runs[900].after;
  base.failed = false; base.promoTonight = "watchparty"; base.darkNightsLeft = 2; base.cash = 5000.25;
  ok(C.PROMOS.watchparty.cost > 0, "the promo this fixture leaves standing costs money");
  const d = clone(base), o = clone(base);
  const bill = C.billsFor(base);
  const db = C.settleDarkNight(d, seeded(7));
  const ob = C.settleNight(o, { total: 0, revenue: 0, tips: 0, served: 0, walkouts: 0, mood: 0.6, serviceRate: 100 }, seeded(7));
  ok(Object.keys(db).join() === "wages,rent,upgFees,account,walkin,net,spoilage,games,social,crew,lease", "a dark night's record has its eleven fields, in order");
  ok(Object.keys(ob).join() === "wages,rent,promoCost,upgFees,account,walkin,take,net,spoilage,games,social,moments,crew,lease", "an open night's has its fourteen");
  ok(db.net === -bill.total && d.cash === base.cash - bill.total, `a dark night costs the bill and nothing else (${db.net})`);
  ok(ob.net === -bill.total - C.PROMOS.watchparty.cost && o.cash === base.cash - bill.total - C.PROMOS.watchparty.cost, "an open night that took nothing costs the bill and the promo");
  ok(d.promoTonight === "watchparty" && o.promoTonight === "none", "a dark night leaves tomorrow's promo standing; an open one spends it");
  ok(d.darkNightsLeft === 1 && o.darkNightsLeft === 2, "only a dark night counts the move down");
  ok(d.stats.nights === base.stats.nights && o.stats.nights === base.stats.nights + 1, "only an open night is a night on the record");
  ok(d.stats.lifetimeNet === base.stats.lifetimeNet && o.stats.lifetimeNet === base.stats.lifetimeNet + ob.net, "and only an open night moves the lifetime net");
  ok(d.day === base.day + 1 && o.day === base.day + 1, "both turn the calendar");
  ok(db.social.dRep === 0 && db.social.gained === null, "nobody saw a dark night: no reputation moved, nobody was minted");
  ok(JSON.stringify(db.spoilage) === JSON.stringify(ob.spoilage), "the shelf rots the same with the doors shut");
  let threw = false;
  try { C.settleNight(clone(base), undefined, seeded(7)); } catch { threw = true; }
  ok(threw, "settleNight() with no summary still throws rather than settling a dark night");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
