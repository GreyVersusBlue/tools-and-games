// financing.js — what a buyer is actually buying with, and what that costs them.
//
// The README's "natural next layers" list asked for per-client financing types
// on the buyer side. Before this, every buyer was the same buyer to a listing
// agent: offer strength came only from waived contingencies and a fast close,
// and resolveFinancing() rolled one flat 4% fall-through chance for everybody.
// The seller side already knew the vocabulary — spawnNPCOffer() has been
// stamping "conventional"/"FHA"/"cash" onto NPC offers since it was written,
// and resolveSellerMilestone() has been charging FHA a 12% fall-through against
// everyone else's 5%. This is the same axis, pointed the other way, so the two
// sides finally agree about what the words mean.
//
// Five levers, all of them things a real agent would tell you:
//
//   strength        moves the NPC listing agent's accept floor, on the same
//                   0.015-per-term scale agentRespond() already uses for a
//                   waived inspection and a waived appraisal. Cash is worth
//                   both of those together, because it IS both of those
//                   together — there is no lender to inspect or appraise for.
//   minCloseDays    the fastest this loan can physically close. FHA cannot
//                   reach the <=21-day bonus agentRespond() pays; cash can beat
//                   it. The offer form offers no shorter date than this.
//   needsAppraisal  false only for cash. No lender, no appraisal contingency,
//                   no appraisal milestone, no appraisal-gap choice.
//   needsFinancing  likewise: cash schedules no financing milestone at all, so
//                   the one branch that can kill a deal three days out never
//                   fires for it.
//   failBase /      the financing milestone's own roll. rateSensitivity scales
//   rateSensitivity how much a market rate above 6.5 hurts: a VA rate moves
//                   less than the headline, an FHA borrower feels it harder.
//   lenderCondition FHA and VA appraisers review condition as well as value.
//                   resolveAppraisal() writes dealbreaker-severity repair costs
//                   down against the loan for these two, which is why an FHA
//                   buyer and a cash buyer can look at the same house and get
//                   two different answers from the same appraiser.
//
// Nothing here is authored per client in the sense of a balance dial. A client
// file may name its own `financing`; the rest derive from tier, deterministically
// and without touching rand(). See financingFor().

export const FINANCING = {
  cash: {
    id: "cash", label: "cash",
    blurb: "No lender, no appraisal, no financing contingency. The strongest paper on the table.",
    strength: 0.03, minCloseDays: 14,
    needsAppraisal: false, needsFinancing: false,
    failBase: 0, rateSensitivity: 0, lenderCondition: false,
  },
  conventional: {
    id: "conventional", label: "conventional",
    blurb: "The ordinary loan. Nobody is impressed and nobody is worried.",
    strength: 0, minCloseDays: 21,
    needsAppraisal: true, needsFinancing: true,
    failBase: 0.04, rateSensitivity: 1, lenderCondition: false,
  },
  va: {
    id: "va", label: "VA",
    blurb: "Nothing down, and an appraiser who looks at the house as well as the price. Slower to close.",
    strength: -0.01, minCloseDays: 35,
    needsAppraisal: true, needsFinancing: true,
    failBase: 0.07, rateSensitivity: 0.6, lenderCondition: true,
  },
  fha: {
    id: "fha", label: "FHA",
    blurb: "Low down payment, strict appraisal, and a listing agent who has been burned before.",
    strength: -0.02, minCloseDays: 30,
    needsAppraisal: true, needsFinancing: true,
    failBase: 0.1, rateSensitivity: 1.4, lenderCondition: true,
  },
  // The fifth type, and the only one that is not a residential loan program.
  // FHA and VA are not options on a building at all — they are programs for
  // somebody's house — so a commercial buyer has exactly two ways to pay, this
  // and cash, and financingFor()'s commercial pool holds only those two.
  //
  // `failBase` is low on purpose and does almost nothing. A commercial loan
  // does not mostly die of a bad roll: it dies of a debt service coverage
  // ratio under 1.20, which deals.js resolves as arithmetic before it ever
  // reaches this number. See commercial.js:dscrAt().
  commercial: {
    id: "commercial", label: "commercial",
    blurb: "A bank underwriting the building rather than the buyer: 70% loan-to-value, 25-year amortization, and a debt-service test at the end of it.",
    strength: -0.005, minCloseDays: 45,
    needsAppraisal: true, needsFinancing: true,
    failBase: 0.03, rateSensitivity: 1.2, lenderCondition: false,
  },
};

export const DEFAULT_FINANCING = "conventional";

/** The type record, for anything holding an id. Never returns undefined. */
export const financingType = id => FINANCING[id] || FINANCING[DEFAULT_FINANCING];

/**
 * Close-day options an offer of this type may actually pick. 60 is here for
 * the commercial loan, whose 45-day floor would otherwise leave it a select
 * with one entry in it; every other type gains a slow option it had no reason
 * to want, which costs it the <=21-day strength bonus agentRespond() pays.
 */
export const CLOSE_DAY_CHOICES = [14, 21, 28, 35, 45, 60];
export const closeDaysFor = id =>
  CLOSE_DAY_CHOICES.filter(d => d >= financingType(id).minCloseDays);

/**
 * What a given content client buys with.
 *
 * A client file may name its own `financing` and that wins — authored content
 * beats a derivation, same as everywhere else in this game. Everything else
 * derives from tier, weighted the way the market is: starters are mostly FHA,
 * luxury buyers are half cash.
 *
 * The derivation is a string hash of the client id, NOT rand(). Two reasons,
 * and the second is the one that bites. First, a buyer's financing is a fact
 * about them, not a roll — it should be the same on every career. Second,
 * repairCareer() backfills this field and repairCareer() runs on every accepted
 * load through every door (#37). A rand() call in that path would advance
 * S.seed once per load, so a career would take a different branch on every
 * event roll for the rest of its life depending on how many times it had been
 * reopened. Sellers get null: they are not the ones borrowing.
 */
const POOLS = {
  starter: ["fha", "fha", "conventional", "va"],
  mid: ["conventional", "conventional", "fha", "va"],
  luxury: ["conventional", "cash", "cash", "conventional"],
  // No FHA and no VA in this pool, and that is not a balance choice: those two
  // are residential loan programs and a buyer of a six-bay strip cannot use
  // either one. A commercial buyer borrows commercially or pays cash.
  commercial: ["commercial", "commercial", "cash", "commercial"],
};

export function financingFor(c) {
  if (!c || c.type !== "buyer") return null;
  if (typeof c.financing === "string" && c.financing in FINANCING) return c.financing;
  const pool = POOLS[c.tier] || POOLS.mid;
  return pool[hash(c.id) % pool.length];
}

/** djb2, positive. Small, stable, and dependency-free — this must not drift. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
