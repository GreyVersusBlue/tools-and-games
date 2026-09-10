// engine.js — pure functions only. Nothing here touches the DOM or mutates
// its inputs; state.js owns the actual game-state object and calls into
// this module for the math. That split is what makes the smoke tests able
// to run simulateDay() hundreds of times in plain Node with no jsdom.

import { CONFIG, TIME_BLOCKS, PERFORMERS, VENDORS, EVENT_POOL, GRID, TERRAIN_ROWS, TERRAIN_LEGEND, TERRAIN_BASE, STRUCTURE_TYPES, TERRAIN_BUILD_MODIFIERS, TERRAIN_NAME, KIND_NOUN, AD_CAMPAIGNS, CONTRACT_OPTIONS, GRID_EXPANSIONS, PLACEMENT_RULES, ENTRANCE, GROUNDS_DRAW, WEEKEND_DAY_ATTENDANCE, WEATHER, WEATHER_SEASON_SPAN, WEATHER_SHADE_CEILING, DEFAULT_WEATHER_ID, RELATIONSHIP, NEGOTIATION, ARCS, RENOWN, CREW, CREW_RULES } from './data.js';
// Phase 1 (guests who walk): guests.js imports this module's path and plot
// helpers and this module calls its walk from simulateDay. The cycle is
// safe because neither file reads the other at load time — only inside
// functions — and it keeps the walk in the file the wishlist named rather
// than folding it into simulateDay's 250 lines.
import { spawnGuests, walkGuests } from './guests.js';

// ---------- seeded RNG (mulberry32) ----------
// Deterministic given a numeric seed so tests can assert exact outputs.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- lookups ----------
// No plotById: plots are no longer a static catalog (Stage 3) — a built
// plot IS its own record, living in state.builtPlots, so anything that
// needs one just reads it straight from that array.
export function performerById(id) { return PERFORMERS.find(p => p.id === id); }
export function vendorById(id) { return VENDORS.find(v => v.id === id); }
export function campaignById(id) { return AD_CAMPAIGNS.find(c => c.id === id); }
export function crewById(id) { return CREW.find(c => c.id === id); }

// Stage 10: a VENDORS entry's `type` ('food'/'craft') and a built plot's
// `kind` ('food'/'vendor') use different vocabularies for the same two
// stall categories — this is the one place that translates between them,
// so hireVendor's cap check and the assignment/vacancy-tracker logic never
// have to spell the mapping out inline.
export const STALL_KIND_BY_VENDOR_TYPE = { food: 'food', craft: 'vendor' };

// Vacancy tracker (Stage 10): for each stall kind, how many committed plots
// exist and how many currently have a vendor seated. Pure read of
// state.builtPlots — used by both the Backstage "N/M filled" display and
// hireVendor's per-kind hiring cap.
export function stallSummary(state) {
  const summarize = (kind) => {
    const plots = state.builtPlots.filter(p => p.kind === kind && p.status === 'built');
    return { total: plots.length, filled: plots.filter(p => p.assignedVendorId).length };
  };
  return { food: summarize('food'), vendor: summarize('vendor') };
}

// What somebody under contract actually costs per day. The rate depends on
// which contract they were signed under (Stage 5) — a Weekend Package pays
// less per day than the listed cost, an open day-rate pays the listed cost
// exactly — so the record is the answer and the catalog is the fallback.
// Falls back to the listed cost for somebody with no contract record
// (shouldn't normally happen if they're on the roster, but keeps this safe
// to call defensively), and to 0 for an id no catalog knows.
//
// Phase 7: this used to be written out twice, once for performers and once
// for vendors, and the phase needed a third. One shape, three callers —
// crew ride the same CONTRACT_OPTIONS deals performers and vendors already
// do, so they are a caller here, not a third cost path.
function contractedCost(act, contract) {
  if (!act) return 0;
  return contract ? contract.dailyCost : act.cost;
}
export function effectivePerformerCost(state, performerId) {
  return contractedCost(performerById(performerId), state.contracts && state.contracts[performerId]);
}
// Stage 7: vendors can now be signed under the same CONTRACT_OPTIONS deals
// as performers (see state.js's hireVendor).
export function effectiveVendorCost(state, vendorId) {
  return contractedCost(vendorById(vendorId), state.vendorContracts && state.vendorContracts[vendorId]);
}
// Phase 7: and so is the crew (see state.js's contractCrew).
export function effectiveCrewCost(state, crewId) {
  return contractedCost(crewById(crewId), state.crewContracts && state.crewContracts[crewId]);
}

// ---------- a third crew (Phase 7) ----------
// Everything the three crew roles do, as pure reads of the state. Each one
// is a number of heads against a number of heads: a crew is worth what the
// crowd it covers is worth, and a crew whose role is already covered twice
// over is worth nothing at all. Nobody here gets a bonus for being on the
// payroll.

/** The crew records currently on the payroll, catalog order. */
export function crewOf(state) {
  return (state && state.crew ? state.crew : []).map(crewById).filter(Boolean);
}
/** Total `covers` across every hired crew member in one role. */
export function crewCovers(state, role) {
  return crewOf(state).reduce((sum, c) => sum + (c.role === role ? c.covers : 0), 0);
}

// How many guests the gate can get through the fence today. An unstaffed
// gate is CREW_RULES.baseCapacity and nothing else; every gate hire adds
// its own `covers` on top.
export function gateCapacity(state) {
  return CREW_RULES.baseCapacity + crewCovers(state, 'gate');
}
// The crowd that turned up against the crowd that got in. Anybody past the
// capacity is turned away at the fence: they pay no ticket, they buy
// nothing, they cost nothing to host, and the people who did get in spend
// the day in a queue that never cleared.
export function admitAtGate(raw, capacity) {
  const admitted = Math.max(0, Math.min(raw, capacity));
  return { raw, admitted, turnedAway: Math.max(0, raw - admitted), capacity };
}
// What being turned away does to the mood of the crowd that got in, in the
// same satisfaction points priceSatisfactionDelta returns. Zero when
// nobody was turned away, which is every day a faire is under its ceiling.
export function turnedAwaySatisfactionDelta(gate) {
  if (!gate || !gate.raw || gate.turnedAway <= 0) return 0;
  return CREW_RULES.turnedAwayPenalty * (gate.turnedAway / gate.raw);
}

// How exposed today's crowd is, 0 to 1 — the security read. `crowd` is the
// crowd the player *staffed for*, not the one the sky delivered: see
// expectedCrowd in simulateDay and locked decision #257. Below
// CREW_RULES.calmCrowd a faire polices itself and this is 0, which is what
// makes an unguarded early-game day roll exactly the events and pay exactly
// the bills it did before this phase existed.
export function crowdExposure(state, crowd) {
  const exposed = Math.max(0, (crowd || 0) - crewCovers(state, 'security') - CREW_RULES.calmCrowd);
  return Math.min(1, exposed / CREW_RULES.exposureScale);
}
/** What an exposed crowd does to an incident's weight in the pool. */
export function incidentWeightMult(exposure) {
  return 1 + CREW_RULES.weightPressure * (exposure || 0);
}
/** And to its bill when it lands. */
export function incidentCostMult(exposure) {
  return 1 + CREW_RULES.costPressure * (exposure || 0);
}

// How far the herald can pull the day's shape, 0 to CREW_RULES.blockPull.
// An announcer covers so many heads and no more, so a crowd that outgrows
// them is a crowd that stops hearing them.
export function announcerPull(state, attendance) {
  if (!attendance || attendance <= 0) return 0;
  const heard = Math.min(1, crewCovers(state, 'announcer') / attendance);
  return CREW_RULES.blockPull * heard;
}
// The day's shape, with the herald's thumb on it. `counts` is heads per
// block and `caps` is how many each block can COMFORTABLY take — the
// crowding line, not the capacity — and the herald moves `pull` of every
// block's excess into the blocks with room, in proportion to how much room
// each one has.
//
// Two wrong drafts are worth recording, because the suite caught both and
// neither was obvious. The first pulled every block toward an even quarter
// of the day, which on a bill already spread across four blocks moved the
// crowd OUT of the blocks with the best acts in them: a point and a half of
// satisfaction lost for $480 a day. A herald is not a man who flattens a
// schedule; he is the man who tells the four hundred people who cannot see
// the joust that the falconer is on at the Grove in ten minutes. The second
// moved the overflow correctly and then filled the receiving blocks to the
// rail, where simulateDay's crowding penalty lives — it took three empty
// stages from 116 to exactly 143 heads, tripped CROWDING_PENALTY on all
// 429 of them, and cost five points of mood to save 81 people from standing
// at the back. Hence CROWDING_FILL here rather than capacity: the herald
// fills a block to comfortable and stops.
//
// On a faire with no overflow he has nothing to say, and this hands back
// the counts it was given, to the head.
export function relieveOverflow(counts, caps, pull) {
  const out = counts.slice();
  if (!pull) return out;
  const excess = out.map((n, i) => Math.max(0, n - (caps[i] || 0)));
  const room = out.map((n, i) => Math.max(0, (caps[i] || 0) - n));
  const totalExcess = excess.reduce((a, b) => a + b, 0);
  const totalRoom = room.reduce((a, b) => a + b, 0);
  const moved = Math.min(pull * totalExcess, totalRoom);
  if (moved <= 0) return out;
  for (let i = 0; i < out.length; i++) {
    if (excess[i] > 0) out[i] -= moved * (excess[i] / totalExcess);
    if (room[i] > 0) out[i] += moved * (room[i] / totalRoom);
  }
  return out;
}

// ---------- acts with a story (Phase 3) ----------
// A performer or vendor record with the save's own changes laid over it.
// An arc beat can move an act's popularity or quality, hand them a quirk or
// take one away, and re-price them; all of that lives in state.actTraits[id]
// rather than on the catalog, so data.js stays content and two saves can
// know two different Ysoldes. Everything that used to read performerById /
// vendorById for a number that can now move reads these instead. A state
// with no traits (every fixture written before this phase) gets the catalog
// record back untouched, so nothing that passed before moved.
export function performerFor(state, id) {
  const perf = performerById(id);
  if (!perf) return perf;
  const t = state && state.actTraits && state.actTraits[id];
  if (!t) return perf;
  const out = { ...perf };
  if (typeof t.popularity === 'number') out.popularity = clamp(perf.popularity + t.popularity, 1, 10);
  if ('quirk' in t) out.quirk = t.quirk;
  return out;
}
export function vendorFor(state, id) {
  const vendor = vendorById(id);
  if (!vendor) return vendor;
  const t = state && state.actTraits && state.actTraits[id];
  if (!t) return vendor;
  const out = { ...vendor };
  if (typeof t.quality === 'number') out.quality = clamp(vendor.quality + t.quality, 1, 10);
  return out;
}
// The one multiplier an arc can put on an act's price. Read by
// quoteContract below and nowhere else, so it is not a fourth cost path:
// it is folded into the contract's dailyCost at signing (or re-priced
// onto a standing contract by applyBeatChoice), and effectivePerformerCost
// still reads the contract.
export function traitRateMult(state, id) {
  const t = state && state.actTraits && state.actTraits[id];
  return t && typeof t.rateMult === 'number' ? t.rateMult : 1;
}

// The number itself. An act nobody has a record for reads as neutral: a
// save from before this phase, a fixture built from a plain literal, an act
// released and re-signed. That is what lets `repair` fill the map lazily and
// what the pre-arc save test asserts.
export function relationshipOf(state, id) {
  const r = state && state.relationships && state.relationships[id];
  return typeof r === 'number' ? r : RELATIONSHIP.neutral;
}
export function relationshipTier(value) {
  return RELATIONSHIP.tiers.find(t => value >= t.min) || RELATIONSHIP.tiers[RELATIONSHIP.tiers.length - 1];
}
export function contractedActIds(state) {
  return [...(state.roster || []), ...(state.hiredVendors || [])];
}

// The block a performer draws best in: the block their quirk favours (the
// highest per-block multiplier effectivePopularity applies), ties broken by
// the block's crowd weight. So a night owl's best block is Golden Hour and
// everyone else's is the Afternoon. Compared as a multiplier rather than as
// raw draw x crowd, because Golden Hour's crowd is small enough that the
// Afternoon would win that contest even for a night owl — and "your best
// block is the one everyone's is" is not a relationship anyone can tend.
// Derived from data already authored rather than a new field per act, so
// a quirk gained through an arc moves it.
export function bestBlockFor(perf) {
  let best = null;
  const base = perf.popularity || 1;
  for (const block of TIME_BLOCKS) {
    const mult = effectivePopularity(perf, block.id) / base;
    if (!best || mult > best.mult + 1e-9 || (Math.abs(mult - best.mult) < 1e-9 && block.weight > best.block.weight)) best = { block, mult };
  }
  return best ? best.block : TIME_BLOCKS[0];
}

// The one contract quote. `terms` is { priceMult?, commitDays, cancelFeeMult }:
// a CONTRACT_OPTIONS row passes its own priceMult and the negotiation form
// passes a commitment and a fee, which are priced off NEGOTIATION's two
// lists. On top of that base: the act's arc rate multiplier and the
// relationship swing, then a floor. Returns the whole priced record so
// contractPerformer / hireVendor store exactly what was quoted.
export function offerDiscount(commitDays, cancelFeeMult) {
  const commitment = NEGOTIATION.commitments.find(c => c.days === commitDays);
  const fee = NEGOTIATION.cancelFees.find(f => f.mult === cancelFeeMult);
  if (!commitment || !fee) return null;
  // A fee on a day rate is a fee on nothing owed, so it buys nothing.
  const feeDiscount = commitDays > 0 ? fee.discount : 0;
  return { commitment, fee, priceMult: 1 - commitment.discount - feeDiscount };
}
export function relationshipRateMult(state, id) {
  const rel = relationshipOf(state, id);
  return 1 - NEGOTIATION.relationshipSwing * ((rel - RELATIONSHIP.neutral) / RELATIONSHIP.neutral);
}
export function quoteContract(state, kind, id, terms) {
  const act = kind === 'vendor' ? vendorById(id) : kind === 'crew' ? crewById(id) : performerById(id);
  if (!act) return null;
  let base, commitDays, cancelFeeMult, label, contractId;
  if (terms && typeof terms.priceMult === 'number') {
    base = terms.priceMult; commitDays = terms.commitDays; cancelFeeMult = terms.cancelFeeMult;
    label = terms.label; contractId = terms.id || 'offer';
  } else {
    const d = offerDiscount(terms ? terms.commitDays : 0, terms ? terms.cancelFeeMult : 0);
    if (!d) return null;
    base = d.priceMult; commitDays = d.commitment.days; cancelFeeMult = d.fee.mult;
    label = commitDays > 0 ? `${d.commitment.label}, ${d.fee.label.toLowerCase()}` : d.commitment.label;
    contractId = 'offer';
  }
  const mult = Math.max(NEGOTIATION.floorMult, base * traitRateMult(state, id) * relationshipRateMult(state, id));
  return {
    contractId, label, commitDays, cancelFeeMult,
    dailyCost: Math.round(act.cost * mult),
    listed: act.cost,
    mult,
  };
}

// Arc beats. A beat is pending when its subject is contracted, its `when`
// tier is the subject's current tier, and it has not been resolved on this
// save. Pure read; the UI renders every pending beat as a card and
// state.js's resolveBeat is the only writer of state.arcBeats.
export function beatById(beatId) {
  for (const arc of ARCS) {
    const beat = arc.beats.find(b => b.id === beatId);
    if (beat) return { arc, beat };
  }
  return null;
}
export function actNameOf(id) {
  const act = performerById(id) || vendorById(id);
  return act ? act.name : id;
}
export function pendingBeats(state) {
  const contracted = new Set(contractedActIds(state));
  const resolved = (state && state.arcBeats) || {};
  const out = [];
  for (const arc of ARCS) {
    if (!contracted.has(arc.subject)) continue;
    const tier = relationshipTier(relationshipOf(state, arc.subject)).id;
    for (const beat of arc.beats) {
      if (resolved[beat.id]) continue;
      if (beat.when === tier) out.push({ arc, beat, subjectId: arc.subject, subjectName: actNameOf(arc.subject) });
    }
  }
  return out;
}

// ---------- grounds draw (Stage 19) ----------
// How much of a crowd the built grounds themselves pull, independent of
// reputation, price, and who's on the bill. See GROUNDS_DRAW in data.js for
// why this exists at all — in short, before Stage 19 the attendance formula
// never read state.builtPlots, so building a faire had no effect on how
// many people came to it.
//
// Pure and state-independent (takes the plots array, not the state), same
// shape as computeFootTraffic/computeReachability, so it's independently
// testable and callable from the UI for a live readout.
//
// Returns { points, mult, byKind } — `points` and `byKind` are surfaced so
// the UI can explain the multiplier rather than just asserting it.
export function computeGroundsDraw(builtPlots = []) {
  const byKind = { stage: 0, food: 0, vendor: 0, demo: 0 };
  for (const p of builtPlots) {
    if (p.status !== 'built') continue; // planning plots aren't on the grounds yet
    if (!(p.kind in byKind)) continue;
    // A stall with nobody seated in it is a shed, not an attraction — same
    // rule simulateDay already applies to stall revenue.
    if ((p.kind === 'food' || p.kind === 'vendor') && !p.assignedVendorId) continue;
    byKind[p.kind] += 1;
  }
  let points = 0;
  for (const kind of Object.keys(byKind)) {
    points += byKind[kind] * (GROUNDS_DRAW.points[kind] || 0);
  }
  const raw = GROUNDS_DRAW.floor + GROUNDS_DRAW.coefficient * Math.sqrt(points);
  return {
    points: Math.round(points * 100) / 100,
    byKind,
    mult: clamp(raw, GROUNDS_DRAW.floor, GROUNDS_DRAW.ceiling),
  };
}

// ---------- ticket pricing (Stage 19) ----------
// How much a given ticket price suppresses (or, below the anchor, boosts)
// attendance. Split out of simulateDay's inline expression so the Office
// panel can chart the actual curve the simulation uses instead of a
// hand-copied approximation of it.
export function priceFactor(price) {
  const raw = 1 - (price - CONFIG.priceAnchor) / CONFIG.priceElasticityDivisor;
  return clamp(raw, CONFIG.priceFactorFloor, CONFIG.priceFactorCeiling);
}

// Ticket revenue per guest-day at a given price, before every other factor.
// Exported mostly so the UI (and the tests) can find the peak of the curve
// without duplicating the formula: with Stage 19's elasticity this peaks
// mid-slider rather than at the maximum price.
export function ticketRevenueIndex(price) {
  return priceFactor(price) * price;
}

// Crowd reaction to the price on the gate, in satisfaction points. Charging
// above the anchor annoys people; charging below it buys goodwill, at a
// shallower rate so undercutting isn't a free reputation engine.
export function priceSatisfactionDelta(price) {
  const diff = price - CONFIG.priceAnchor;
  return diff >= 0
    ? -diff * CONFIG.priceSatisfactionPenaltyPerDollar
    : -diff * CONFIG.priceSatisfactionBonusPerDollar;
}

// ---------- stage quality weighting (Stage 19, weather in Phase 2) ----------
// How much sightline / shade / act popularity each count toward a stage's
// crowd-quality score during a given time block, on a given day.
//
// The fixed 0.55/0.25/0.20 split only applies at an authored heat of 1 under
// a neutral sky. As heat drops the shade term's weight drops with it and the
// slack rolls into sightline, because shade nobody needs is not a feature.
// This is what unlocks the top of the satisfaction range (see TIME_BLOCKS'
// comment in data.js) and, more importantly, gives terrain a
// schedule-dependent personality: a hilltop stage is the best seat on the
// grounds at Morning Procession and the worst place to stand at Afternoon.
//
// Phase 2 made that personality day-dependent as well. A WEATHER row's
// heatMult scales the block's authored heat, and it can exceed 1 — on a
// scorching afternoon shade takes 0.65 of the weight against sightline's
// 0.15, so the hilltop is not merely a worse seat than usual, it is the
// wrong ground to have built on. On a downpour the shade term all but
// vanishes and the long view carries every block.
export function blockQualityWeights(block, weather) {
  const authored = typeof block?.heat === 'number' ? clamp(block.heat, 0, 1) : 1;
  // Phase 2: the day's sky scales the block's authored heat. A missing or
  // malformed weather argument multiplies by 1, so every caller written
  // before this phase — and every ad-hoc test state built from an object
  // literal — gets exactly the weights it got before.
  const mult = typeof weather?.heatMult === 'number' && weather.heatMult >= 0 ? weather.heatMult : 1;
  const heat = Math.max(0, authored * mult);
  // The shade ceiling, not the heat, is what keeps these three weights
  // non-negative and summing to 1: sightline is 0.80 - shade, so shade can
  // run to WEATHER_SHADE_CEILING and sightline still has 0.20 left. At
  // heat <= 1 this is arithmetically identical to the pre-Phase-2 line
  // (0.55 + (0.25 - shade)); above it, shade overtakes sightline, which is
  // what a scorcher is supposed to do to an open hilltop.
  const shade = Math.min(0.25 * heat, WEATHER_SHADE_CEILING);
  return { sightline: 0.80 - shade, shade, pop: 0.20 };
}

// ---------- weather (Phase 2) ----------
// The whole system is deterministic in the calendar rather than in the
// day's own rng, and that is decision #231. simulateDay's seed is
// `Date.now() ^ (day * 7919)` — generated the instant the player opens the
// gates — so a forecast drawn from it could not exist a day early without
// being a lie, and the wishlist's own reasoning for the forecast is that
// weather you learn about after committing to a day rate is a tax rather
// than a decision. So the roll reads one number stored per save
// (`weatherSeed`) plus the calendar position, which means tomorrow's
// weather is computable today, a reload shows the day the weather it
// showed the first time, and no draw is taken from the day's rng — every
// seed rolls the events it rolled before this phase.

// The WEATHER row an id names, or the neutral fallback. Anything unknown,
// missing, or from a save that predates the table lands on `fair`.
export function weatherById(id) {
  return WEATHER.find(w => w.id === id) || WEATHER.find(w => w.id === DEFAULT_WEATHER_ID) || WEATHER[0];
}

// Today's weather for a state — the row `state.weather` names. Same
// fallback, so a fixture that never set the field is `fair` and therefore
// neutral rather than absent.
export function weatherFor(state) {
  return weatherById(state && state.weather);
}

// A row's draw weight at a given weekend: its `early` weight at weekend 1,
// its `late` weight at weekend WEATHER_SEASON_SPAN, straight-line between,
// and flat outside that range in both directions (a weekend 9 sandbox run
// keeps late-season weather rather than extrapolating into nonsense).
export function weatherWeightAt(row, season) {
  const span = Math.max(1, WEATHER_SEASON_SPAN - 1);
  const t = clamp(((season || 1) - 1) / span, 0, 1);
  return Math.max(0, row.early + (row.late - row.early) * t);
}

// One stable 32-bit seed per (save, weekend, day-of-weekend). Mixed rather
// than added so that adjacent days do not walk adjacent mulberry32 states
// and produce visibly correlated skies.
function weatherDaySeed(weatherSeed, season, weekendDay) {
  let h = ((weatherSeed >>> 0) ^ 0x5F3759DF) >>> 0;
  h = Math.imul(h ^ ((season || 0) >>> 0), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ ((weekendDay || 0) >>> 0), 0xC2B2AE35) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

// The weather a given save has on a given calendar day. Pure, and a
// function of nothing but its three arguments — call it twice and it
// answers twice the same, which is what makes both the forecast and a
// reloaded report honest.
export function rollWeather(weatherSeed, season, weekendDay) {
  const rng = makeRng(weatherDaySeed(weatherSeed, season, weekendDay));
  const weights = WEATHER.map(row => weatherWeightAt(row, season));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return weatherById(DEFAULT_WEATHER_ID);
  let roll = rng() * total;
  for (let i = 0; i < WEATHER.length; i++) {
    roll -= weights[i];
    if (roll < 0) return WEATHER[i];
  }
  return WEATHER[WEATHER.length - 1];
}

// Where the calendar goes next. This is the one place that knows the shape
// state.js's nextDay/startNextWeekend pair walks — a weekend's last day
// rolls into (season + 1, day 1), any other day is the next day of the
// same weekend — so the forecast and the day that actually arrives cannot
// disagree without a test noticing.
export function nextCalendarDay(state) {
  const season = state.season || 1;
  const weekendDay = state.weekendDay || 1;
  return weekendDay >= CONFIG.seasonLength
    ? { season: season + 1, weekendDay: 1 }
    : { season, weekendDay: weekendDay + 1 };
}

// Tomorrow's weather, exactly — not a band and not a probability. A
// forecast a player cannot act on is decoration, and the acts, contracts
// and ticket price it is meant to inform are all committed a day ahead.
export function forecastWeather(state) {
  const next = nextCalendarDay(state);
  return rollWeather(state.weatherSeed, next.season, next.weekendDay);
}

// ---------- season/progression (Stage 6) ----------
// Whether an item gated by `unlockSeason` (an AD_CAMPAIGNS entry or a
// CONTRACT_OPTIONS entry) is available yet at the given state's current
// weekend (state.season). Missing/undefined unlockSeason defaults to 1
// (available from the very first weekend) so old content never needs the
// field retrofitted.
export function isSeasonUnlocked(state, unlockSeason) {
  return state.season >= (unlockSeason || 1);
}

// ---------- grounds expansion (Stage 8) ----------
// The largest GRID_EXPANSIONS entry the player's current weekend
// (state.season) has reached — i.e. how much of the authored TERRAIN_ROWS
// grid is actually buildable/visible right now. GRID_EXPANSIONS[0] is
// always the Weekend-1 baseline, so this never returns undefined even for
// a save at season 1 (or a pre-Stage-8 save with no migration needed,
// since season already defaults to 1).
// Phase 4: a tier can carry a second gate, `unlockRenown`, on top of its
// weekend. Both have to hold. A tier without the field reads as 0, so the
// three original tiers unlock exactly as they did.
export function isExpansionUnlocked(state, tier) {
  return isSeasonUnlocked(state, tier.unlockSeason) && renownOf(state) >= (tier.unlockRenown || 0);
}
export function currentGridSize(state) {
  const unlocked = GRID_EXPANSIONS.filter(g => isExpansionUnlocked(state, g));
  return unlocked[unlocked.length - 1] || GRID_EXPANSIONS[0];
}

// The next fence line still ahead of the player, or null once every
// GRID_EXPANSIONS entry has been reached. Used to show "next expansion"
// hints in the UI the same way AD_CAMPAIGNS/CONTRACT_OPTIONS show locked
// tiers.
export function nextGridExpansion(state) {
  return GRID_EXPANSIONS.find(g => !isExpansionUnlocked(state, g)) || null;
}

// Whether (x,y) sits within the currently-unlocked grounds — distinct from
// terrainAt() returning non-null, since TERRAIN_ROWS is authored at full
// size but a cell can be past the current fence line before its
// GRID_EXPANSIONS tier unlocks.
export function isWithinCurrentGrid(state, x, y) {
  const size = currentGridSize(state);
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size.cols && y < size.rows;
}

// Aggregates the most recent `count` simulateDay() results (a completed
// weekend's worth of history) into the totals shown on the weekend-end
// summary screen. Pure — takes the plain history array, never touches
// state directly. Returns a zeroed shape if history is empty so callers
// never have to null-check before rendering.
export function summarizeWeekend(history, count) {
  const days = (history || []).slice(-count);
  if (days.length === 0) {
    return { days: [], totalAttendance: 0, totalNet: 0, avgSatisfaction: 0, repDelta: 0, bestDay: null, worstDay: null };
  }
  const totalAttendance = days.reduce((s, d) => s + d.attendance, 0);
  const totalNet = days.reduce((s, d) => s + d.cashDelta, 0);
  const avgSatisfaction = Math.round(days.reduce((s, d) => s + d.satisfaction, 0) / days.length);
  const repDelta = days.reduce((s, d) => s + d.reputationDelta, 0);
  const bestDay = days.reduce((a, b) => (b.cashDelta > a.cashDelta ? b : a));
  const worstDay = days.reduce((a, b) => (b.cashDelta < a.cashDelta ? b : a));
  return { days, totalAttendance, totalNet, avgSatisfaction, repDelta, bestDay, worstDay };
}

// Stage 16: loss condition. Pure so tests can assert on plain numbers
// without needing a whole state object.
export function checkBankruptcy(cash) {
  return cash <= CONFIG.bankruptcyFloor;
}

// Stage 16: win condition. True once the faire has reached (or passed) the
// target weekend with reputation and cash both at or above the configured
// minimums. Reads `state.season`/`reputation`/`cash` only — deliberately
// ignorant of `victoryAchieved`, so callers decide when/whether to act on a
// true result (state.js only fires it once, via the victoryAchieved flag).
export function checkWinCondition(state) {
  const w = CONFIG.winCondition;
  return state.season >= w.seasonTarget && state.reputation >= w.minReputation && state.cash >= w.minCash;
}

// ---------- renown, the second track (Phase 4) ----------
// The number itself. A state with no record — a fixture, a save from
// before this phase on its way through migrate — reads as 0, the same way
// relationshipOf reads neutral.
export function renownOf(state) {
  return state && typeof state.renown === 'number' ? state.renown : 0;
}

// The mood line on its own, off a summarizeWeekend() result: the one part
// of a weekend's renown that a completed weekend's history still carries,
// which is why the save's migrate can tally it for weekends played before
// this phase existed. The other two lines need tenure and the demolition
// count, neither of which an old save recorded, so migrate does not guess
// at them.
export function moodRenown(summary) {
  if (!summary || !summary.days || summary.days.length === 0) return null;
  const avg = summary.avgSatisfaction;
  if (avg >= RENOWN.moodHighBar) return { id: 'mood', label: `A weekend the crowd loved (mood ${avg}/100)`, points: RENOWN.moodHighPoints };
  if (avg >= RENOWN.moodBar) return { id: 'mood', label: `A weekend the crowd enjoyed (mood ${avg}/100)`, points: RENOWN.moodPoints };
  return null;
}

// Everything a weekend earned, as lines with reasons and a total. Pure:
// reads the state as it stands at the boundary — after state.js has
// ticked tenure for the weekend just closed — and the weekend's summary.
// Applied once per weekend by nextDay, and printed by the weekend-end
// screen from state.lastRenown.
export function weekendRenown(state, summary) {
  const lines = [];
  const mood = moodRenown(summary);
  if (mood) lines.push(mood);
  const tenure = (state && state.tenure) || {};
  const kept = contractedActIds(state).filter(id => (tenure[id] || 0) >= RENOWN.keptWeekends);
  if (kept.length > 0) {
    const points = Math.min(kept.length, RENOWN.keptCap);
    lines.push({ id: 'kept', label: `${kept.length} act${kept.length === 1 ? '' : 's'} kept a ${ordinal(RENOWN.keptWeekends)} weekend or longer`, points });
  }
  const built = ((state && state.builtPlots) || []).filter(p => p.status === 'built').length;
  if (built >= RENOWN.intactMinBuilt && !((state && state.demolished) > 0)) {
    lines.push({ id: 'intact', label: `${built} plots built and nothing torn down`, points: RENOWN.intactPoints });
  }
  return { lines, total: lines.reduce((s, l) => s + l.points, 0) };
}
function ordinal(n) { return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`; }

// The headliner's bar. A performer with `unlockRenown` will not sign, at
// any price, until the faire has that much renown; everyone else returns
// null. Read by contractPerformer before any quote is made, and by
// Backstage so the row says what it is waiting on rather than hiding.
export function signingBar(state, perf) {
  if (!perf || typeof perf.unlockRenown !== 'number') return null;
  const have = renownOf(state);
  if (have >= perf.unlockRenown) return null;
  return { need: perf.unlockRenown, have, short: perf.unlockRenown - have };
}

// The next run's weather seed, derived from this one's rather than drawn
// off the clock: closing a season is a pure action like every other in
// state.js, and a run's whole calendar is still a function of the seed
// newGame() drew once (#232). Mixed with the run number so two closings
// of the same run (a save exported before and after) get the same second
// season, and a third season differs from the second.
export function nextRunSeed(weatherSeed, run) {
  let h = ((weatherSeed >>> 0) ^ Math.imul(run >>> 0, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------- faire grounds map ----------
// Terrain lookup by grid cell. Returns null for out-of-bounds/unknown cells.
export function terrainAt(x, y) {
  const row = TERRAIN_ROWS[y];
  const ch = row ? row[x] : undefined;
  return ch ? TERRAIN_LEGEND[ch] || null : null;
}

// Chebyshev (king-move) distance — a stage two cells away in any direction,
// including diagonally, counts as "nearby" for crowd/sightline purposes.
export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---------- structure footprints (Stage 12) ----------
// How many cells a structure kind occupies, anchored at (x,y). Falls back
// to 1x1 for any kind without an explicit STRUCTURE_TYPES[kind].footprint
// (every kind except stage, today) so old content/saves never need a
// retrofit. `footprintCells` is the pure enumerator both quoteBuild and
// isLegalPlacement build on; a plot's OWN footprint should be read off its
// stored `w`/`h` (set at build time) rather than re-derived from
// STRUCTURE_TYPES, since a later stage changing a kind's footprint must
// never reshape plots that already exist on the grounds.
export function footprintFor(kind) {
  const type = STRUCTURE_TYPES[kind];
  return (type && type.footprint) || { w: 1, h: 1 };
}

export function footprintCells(x, y, w, h) {
  const cells = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy });
  }
  return cells;
}

// A built plot's actual footprint, honoring its stored w/h when present
// (falls back to the kind's current footprint for a pre-Stage-12 save,
// which loadState migrates to explicit 1x1 anyway).
export function plotFootprintCells(plot) {
  const w = plot.w || footprintFor(plot.kind).w;
  const h = plot.h || footprintFor(plot.kind).h;
  return footprintCells(plot.x, plot.y, w, h);
}

// Whether every cell of `kind`'s footprint at (x,y) sits within the
// currently-unlocked grounds (state-aware — see isWithinCurrentGrid/
// currentGridSize above). A footprint that would poke past the fence line
// on ANY cell, not just its anchor, is refused.
export function isFootprintWithinCurrentGrid(state, kind, x, y) {
  const { w, h } = footprintFor(kind);
  return footprintCells(x, y, w, h).every(c => isWithinCurrentGrid(state, c.x, c.y));
}

export function orthogonalNeighbors(cell) {
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
}

// Whether any cell of a footprint sits ON a path tile, or directly beside
// one (orthogonal neighbor only — a diagonal touch doesn't count as
// frontage). A neighbor that's itself part of the same footprint is
// skipped (it's interior to the structure, not a street it fronts onto).
export function hasPathFrontage(cells) {
  const key = (c) => `${c.x},${c.y}`;
  const own = new Set(cells.map(key));
  for (const c of cells) {
    if (terrainAt(c.x, c.y) === 'path') return true;
    for (const n of orthogonalNeighbors(c)) {
      if (own.has(key(n))) continue;
      if (terrainAt(n.x, n.y) === 'path') return true;
    }
  }
  return false;
}

const ADJACENCY_RADIUS = 2;
const NEARBY_STAGE_SIGHTLINE_PENALTY = 0.1; // per nearby built stage, stages only
const NEARBY_STAGE_TRAFFIC_BONUS = 0.05; // per nearby built stage, food/vendor/demo only
// Stage 14: a demo camp draws its own lingering crowd (a falconer, a living-
// history camp) that spills over onto nearby stalls the same way a stage's
// crowd does — a slightly bigger per-camp bonus than a stage's, since
// drawing foot traffic to nearby stalls is a demo camp's whole mechanical
// purpose today (it has no capacity/revenue of its own). Food/vendor stalls
// only — a demo doesn't boost another demo, and a stage's sightline math is
// untouched by nearby demo camps.
const NEARBY_DEMO_TRAFFIC_BONUS = 0.07;

// Derives a built (or hypothetical) plot's real sightline/shade/traffic from
// its terrain plus which OTHER plots are currently built nearby:
//  - a stage within ADJACENCY_RADIUS of another built stage loses sightline
//    (overlapping crowds/noise/tree cover between two show sites)
//  - a food/vendor/demo plot within ADJACENCY_RADIUS of a built stage gains
//    traffic (people spilling out of a show walk past it)
//  - a food/vendor plot within ADJACENCY_RADIUS of a built demo camp also
//    gains traffic (Stage 14 — see NEARBY_DEMO_TRAFFIC_BONUS above)
// `builtPlots` is the array of full plot objects (state.builtPlots) — not
// ids, since Stage 3 plots are player-built records with no catalog to
// look them up in. Pure function; never mutates its arguments.
export function computePlotAttributes(plot, builtPlots) {
  const base = TERRAIN_BASE[terrainAt(plot.x, plot.y)] || TERRAIN_BASE.clearing;
  // Stage 10: a plot still sitting in "planning" (placed but not yet
  // committed/paid for) doesn't functionally exist on the grounds yet, so
  // it neither steals sightline from a nearby stage nor sends it traffic.
  const others = (builtPlots || []).filter(p => p && p.id !== plot.id && p.status !== 'planning');
  const nearbyStages = others.filter(o => o.kind === 'stage' && chebyshevDistance(plot, o) <= ADJACENCY_RADIUS).length;
  const nearbyDemos = others.filter(o => o.kind === 'demo' && chebyshevDistance(plot, o) <= ADJACENCY_RADIUS).length;

  let sightline = base.sightline;
  let traffic = base.traffic;
  if (plot.kind === 'stage') {
    sightline = clamp(sightline - nearbyStages * NEARBY_STAGE_SIGHTLINE_PENALTY, 0.15, 1);
  } else if (nearbyStages > 0) {
    traffic = clamp(traffic + nearbyStages * NEARBY_STAGE_TRAFFIC_BONUS, 0, 1);
  }
  if ((plot.kind === 'food' || plot.kind === 'vendor') && nearbyDemos > 0) {
    traffic = clamp(traffic + nearbyDemos * NEARBY_DEMO_TRAFFIC_BONUS, 0, 1);
  }

  return {
    sightline: Math.round(sightline * 100) / 100,
    shade: Math.round(base.shade * 100) / 100,
    traffic: Math.round(traffic * 100) / 100,
    nearbyStages,
    nearbyDemos,
  };
}

// ---------- foot traffic (Stage 14: crowd-flow-as-a-system, phase 1) ----------
// Every built food/vendor stall already carries a `traffic` attribute
// (terrain + nearby-stage/demo adjacency, above) — through Stage 13 that
// number was purely cosmetic for a stall: only a STAGE's traffic fed into
// anything (its draw-weight share of a time block). This is what actually
// wires stall placement into the economy: each stall's traffic, relative to
// the day's average across every built stall, becomes a sales multiplier —
// a corner stall on a busy path next to a packed stage sells better than
// one tucked alone in the deep woods, and that's now a real number instead
// of just a stat on a tooltip.
//
// Deliberately relative (mult ~1.0 = "an average day's stall"), not
// absolute, so a lone stall's economics are completely unaffected (mean ==
// its own traffic == mult of exactly 1) and the overall economy doesn't
// swing just because the player built more or fewer stalls — only *where*
// they sit relative to each other moves the needle. Clamped to a fairly
// narrow band: this is meant to reward good siting, not let a pathological
// layout zero out or multiply a stall's sales many times over.
//
// Phase 1 increment 2: this function no longer scales anybody's sales. It
// is the *estimate* — the number the build palette and the plot cards show
// before the gates open, computed from terrain and adjacency alone because
// that is all a player has to go on while planning. What a stall actually
// took is measureFootTraffic() below, counted off the walk. The two are
// meant to broadly agree, and tests/smoke.mjs pins that they do: an
// estimate that stopped predicting the walk would be a tooltip that lies.

// Phase 7: what a day is worth to somebody who came for the show and stood
// too far back to see it. The quality scale the block loop works on runs 0
// to about 1 and an ordinary stage scores about 0.5, so this says a day at
// the faire where you never got near a show is worth half a day where you
// did. Not zero: they were still at a faire, with stalls and a demo camp
// and a crowd around them. This is the number that makes stage capacity a
// real ceiling rather than a warning string, and it is what gives an
// announcer something to sell; see the block loop in simulateDay.
const OVERFLOW_QUALITY = 0.25;

// The crowding line, lifted out of simulateDay's block loop as a pair of
// names because Phase 7 gave a second reader a reason to know where it is.
// A stage filled past CROWDING_FILL of its capacity is uncomfortable and
// every head in it scores CROWDING_PENALTY less; the herald's job is to
// move people to a block with room, and a herald who fills that block to
// the rail has moved them into the penalty. He stops at the line.
const CROWDING_FILL = 0.95;
const CROWDING_PENALTY = 0.15;

const FOOT_TRAFFIC_MIN_MULT = 0.6;
const FOOT_TRAFFIC_MAX_MULT = 1.6;

export function computeFootTraffic(builtPlots) {
  const stalls = (builtPlots || []).filter(p => p && p.status === 'built' && (p.kind === 'food' || p.kind === 'vendor'));
  const result = {};
  if (stalls.length === 0) return result;
  const withTraffic = stalls.map(p => ({ id: p.id, traffic: computePlotAttributes(p, builtPlots).traffic }));
  const mean = withTraffic.reduce((s, p) => s + p.traffic, 0) / withTraffic.length;
  for (const p of withTraffic) {
    const raw = mean > 0 ? p.traffic / mean : 1;
    result[p.id] = { traffic: p.traffic, mult: clamp(raw, FOOT_TRAFFIC_MIN_MULT, FOOT_TRAFFIC_MAX_MULT) };
  }
  return result;
}

// ---------- reachability (Stage 17: crowd-flow-as-a-system, phase 2 —
// reachability-gated draw) ----------
// Stage 14 taught every built stall its own *relative siting* (terrain +
// nearby-stage/demo adjacency) as a foot-traffic multiplier — but that math
// is blind to one very real fairgoer behavior: distance from the gate. A
// stage or stall tucked in the far back corner of the grounds draws fewer
// casual passersby than an identically-sited one near the entrance, even
// when their local terrain/adjacency numbers match exactly.
//
// computePathDistances() is a plain 4-directional BFS, along 'path' tiles
// only, out from the authored ENTRANCE. TERRAIN_ROWS/GRID/ENTRANCE are all
// static authored content (never state-dependent), so this result never
// changes across a save or a render and is safe to compute once and cache
// at module scope — the same "state-independent, computed once" spirit as
// terrainAt()/quoteBuild() before it. Returns a Map keyed by "x,y" -> hop
// count from the gate.
// Phase 1 (guests who walk): the BFS keeps its parent pointers now, so the
// same tree that answers "how far" answers "which way". computePathRoutes()
// returns a Map keyed "x,y" -> { x, y, dist, prev } where `prev` is the key
// of the cell one hop closer to the gate (null at the gate itself);
// computePathDistances() is that Map flattened to hop counts, exactly the
// shape it has had since Stage 17, so nothing that read it moves.
let _pathRouteCache = null;
// Phase 1 increment 2: the measured twin of computeFootTraffic. Same
// shape — each stall against the day's mean, clamped to the same band —
// but the input is the arrivals guests.js actually counted rather than a
// terrain-and-adjacency estimate. This is what the day report carries and
// what the best/worst-sited-stall log line reads, because "barely anyone
// drifted past" is now a fact about the crowd rather than a claim about
// the map. `arrivals` is the walk's raw per-plot count; scaling it by
// `represents` would divide out of every ratio, so it is left raw.
//
// A stall with no arrivals at all is pinned to the floor rather than
// dropped: it is on the grounds, it paid its upkeep, and its day was the
// worst one available. It earns nothing regardless — sales come off
// `spentAt`, not off this number.
export function measureFootTraffic(arrivals, builtPlots) {
  const stalls = (builtPlots || []).filter(p => p && p.status === 'built' && (p.kind === 'food' || p.kind === 'vendor') && p.assignedVendorId);
  const result = {};
  if (stalls.length === 0) return result;
  const counts = stalls.map(p => ({ id: p.id, arrivals: (arrivals || {})[p.id] || 0 }));
  const mean = counts.reduce((s, p) => s + p.arrivals, 0) / counts.length;
  for (const p of counts) {
    const raw = mean > 0 ? p.arrivals / mean : 1;
    result[p.id] = { arrivals: p.arrivals, mult: clamp(raw, FOOT_TRAFFIC_MIN_MULT, FOOT_TRAFFIC_MAX_MULT) };
  }
  return result;
}

export function computePathRoutes() {
  if (_pathRouteCache) return _pathRouteCache;
  const routes = new Map();
  const key = (x, y) => `${x},${y}`;
  if (terrainAt(ENTRANCE.x, ENTRANCE.y) === 'path') {
    routes.set(key(ENTRANCE.x, ENTRANCE.y), { x: ENTRANCE.x, y: ENTRANCE.y, dist: 0, prev: null });
    const queue = [[ENTRANCE.x, ENTRANCE.y]];
    while (queue.length) {
      const [x, y] = queue.shift();
      const here = routes.get(key(x, y));
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (terrainAt(nx, ny) !== 'path') continue;
        const nk = key(nx, ny);
        if (routes.has(nk)) continue;
        routes.set(nk, { x: nx, y: ny, dist: here.dist + 1, prev: key(x, y) });
        queue.push([nx, ny]);
      }
    }
  }
  _pathRouteCache = routes;
  return routes;
}

let _pathDistanceCache = null;
export function computePathDistances() {
  if (_pathDistanceCache) return _pathDistanceCache;
  const dist = new Map();
  for (const [k, node] of computePathRoutes()) dist.set(k, node.dist);
  _pathDistanceCache = dist;
  return dist;
}

// The gate-to-cell walk as an ordered list of cells, gate first, the asked
// cell last. Null for a cell that is not path, or is path the gate cannot
// reach (the col-3 spur below row 3, today) — a route that does not exist
// is a null, never a partial list, so a caller cannot walk half of one.
export function pathRouteTo(x, y) {
  const routes = computePathRoutes();
  let node = routes.get(`${x},${y}`);
  if (!node) return null;
  const out = [];
  while (node) {
    out.push({ x: node.x, y: node.y });
    node = node.prev ? routes.get(node.prev) : null;
  }
  return out.reverse();
}

// Shortest gate-to-plot walk, in path-tile hops, along whichever of a
// plot's own footprint cells has path frontage (mirrors hasPathFrontage's
// neighbor logic exactly — every kind that can legally be built at all is
// required to have frontage, so this always resolves to a finite number for
// a real built plot). Returns Infinity only if the grounds' path network
// were ever authored disconnected from ENTRANCE — a content bug, not a
// player-reachable state, so callers don't need to special-case it further
// than computeReachability's mean/clamp math already handles gracefully.
export function reachabilityDistance(plot) {
  const dist = computePathDistances();
  let best = Infinity;
  for (const c of plotFootprintCells(plot)) {
    if (dist.has(`${c.x},${c.y}`)) best = Math.min(best, dist.get(`${c.x},${c.y}`));
    for (const n of orthogonalNeighbors(c)) {
      const d = dist.get(`${n.x},${n.y}`);
      if (d !== undefined && d < best) best = d;
    }
  }
  return best;
}

// Deliberately narrower than foot traffic's 0.6x-1.6x band: this is a
// second, independent siting signal layered on top of foot traffic (not a
// replacement for it), so it nudges rather than dominates. Same relative-
// to-the-day's-average shape as computeFootTraffic: a single built plot of
// a kind always resolves to exactly 1x (mean == its own distance), so a
// fresh save's first stage/stall is completely unaffected — only relative
// gate-distance among *multiple* built plots ever moves this number.
const REACHABILITY_MIN_MULT = 0.8;
const REACHABILITY_MAX_MULT = 1.2;

// Grouped by audience type — stages compared only to other built stages,
// food/vendor stalls compared only to other built stalls (the exact same
// grouping computeFootTraffic already uses for its own mean) — rather than
// one pooled mean across every built plot on the grounds. Two reasons:
// (1) it's the more meaningful comparison anyway ("central among stages"
// and "central among stalls" are each their own real question a player
// asks); (2) it preserves the same backward-compatible guarantee every
// stage since 14 has kept — a single built plot of a kind is unaffected by
// what's built elsewhere, since mean == its own distance == mult of exactly
// 1 within its own group, regardless of how far away a plot of the OTHER
// group happens to sit.
function reachabilityGroup(plots) {
  const result = {};
  if (plots.length === 0) return result;
  const withDist = plots.map(p => ({ id: p.id, distance: reachabilityDistance(p) }));
  // The authored path network isn't fully connected everywhere (see
  // HANDOFF's Stage 17 retro — the col-3 spur has a gap at row 3 that
  // leaves it unreachable from ENTRANCE by any path-tile walk, even though
  // hasPathFrontage's own terrain-only check has always let a plot build
  // against it). A plot with no finite walk to the gate at all can't be
  // meaningfully averaged in with ones that do — one Infinity would blow
  // up the mean and distort every other plot's score — so it's excluded
  // from the mean and pinned straight to the worst multiplier instead:
  // genuinely cut off from the gate is, definitionally, as bad as siting
  // gets.
  const reachable = withDist.filter(p => Number.isFinite(p.distance));
  const unreachable = withDist.filter(p => !Number.isFinite(p.distance));
  for (const p of unreachable) result[p.id] = { distance: Infinity, mult: REACHABILITY_MIN_MULT };
  if (reachable.length === 0) return result;
  const mean = reachable.reduce((s, p) => s + p.distance, 0) / reachable.length;
  for (const p of reachable) {
    // Closer than the group's average gate-walk -> above 1x; farther -> below.
    const raw = mean > 0 ? 1 + (mean - p.distance) / (mean * 2) : 1;
    result[p.id] = { distance: p.distance, mult: clamp(raw, REACHABILITY_MIN_MULT, REACHABILITY_MAX_MULT) };
  }
  return result;
}

export function computeReachability(builtPlots) {
  const built = (builtPlots || []).filter(p => p && p.status === 'built');
  const stages = built.filter(p => p.kind === 'stage');
  const stalls = built.filter(p => p.kind === 'food' || p.kind === 'vendor');
  return { ...reachabilityGroup(stages), ...reachabilityGroup(stalls) };
}

// Quotes what building a given structure kind at (x,y) would cost/seat,
// before anything is actually built — the single source of truth for that
// math, used both by state.js's buildPlot action and ui.js's build-preview
// Stage 13: daily upkeep. A single built plot's daily cost is just
// CONFIG.upkeepRate of its own stored `cost` — that field is set once at
// build/commit/relocate time (see state.js) and already bakes in kind,
// terrain, and footprint, so upkeep needs no separate authored table.
// Deliberately returns 0 for a still-"planning" plot — same rule every
// other gameplay effect (crowd draw, adjacency, seating) already follows:
// a plan isn't real until it's committed.
export function plotUpkeep(plot) {
  if (!plot || plot.status !== 'built') return 0;
  return Math.round(plot.cost * CONFIG.upkeepRate);
}

export function totalUpkeep(builtPlots) {
  return (builtPlots || []).reduce((sum, p) => sum + plotUpkeep(p), 0);
}

// Stage 15: how many already-*built* plots of a given kind exist, optionally
// excluding one plot id (used by relocatePlot/movePlanningPlot so a plot
// being repositioned never counts against its own price). Pure; a
// still-'planning' plot never counts, same rule plotUpkeep already follows.
export function countBuiltOfKind(builtPlots, kind, excludeId) {
  return (builtPlots || []).filter(p => p.status === 'built' && p.kind === kind && p.id !== excludeId).length;
}

// tooltips so the number a player sees matches what they're charged.
// Returns null for an unknown kind or an off-grid/unrecognized cell.
// Stage 15: builtPlots/excludeId are optional (default: no escalation) so
// every pre-Stage-15 call site and test that doesn't pass them keeps
// pricing exactly as before. Passing state.builtPlots is what makes the
// Nth built structure of a kind cost more than the first.
export function quoteBuild(kind, x, y, builtPlots = [], excludeId = null) {
  const type = STRUCTURE_TYPES[kind];
  const terrain = terrainAt(x, y);
  if (!type || !terrain) return null;
  // Stage 12: a multi-cell footprint (currently just stage's 2x2) must sit
  // entirely on the authored map — a cell hanging off TERRAIN_ROWS' edge
  // isn't buildable even if the anchor cell itself is fine. Cost/capacity
  // still price off the anchor cell's terrain only (a stage straddling two
  // terrain types doesn't get split pricing) — deliberately simple.
  const { w, h } = footprintFor(kind);
  if (footprintCells(x, y, w, h).some(c => !terrainAt(c.x, c.y))) return null;
  const mod = TERRAIN_BUILD_MODIFIERS[terrain];
  const builtCount = countBuiltOfKind(builtPlots, kind, excludeId);
  const escalationMult = Math.pow(1 + CONFIG.escalatingBuildCostRate, builtCount);
  const cost = Math.round((type.baseCost * mod.costMult * escalationMult) / 10) * 10;
  const capacity = kind === 'stage' ? Math.round(type.baseCapacity * mod.capacityMult) : undefined;
  const name = `${TERRAIN_NAME[terrain]} ${KIND_NOUN[kind]}`;
  return { kind, x, y, w, h, terrain, cost, capacity, name, builtCount, escalationMult };
}

// Stage 15: prices out committing every 'planning' plot in `builtPlots`
// together, one at a time in list order, against a scratch copy — so
// several same-kind plans committed as a batch escalate against each
// other exactly like committing them one by one would (see state.js's
// commitAllPlots). Pure and read-only; used both by commitAllPlots itself
// and by ui.js's "Commit All" total, so the number a player sees always
// matches what they'll actually be charged. Returns { total, costs } where
// costs maps plotId -> the price that plot would be charged in this batch.
export function previewCommitAll(builtPlots) {
  const planningIds = (builtPlots || []).filter(p => p.status === 'planning').map(p => p.id);
  const scratch = (builtPlots || []).map(p => ({ ...p }));
  const costs = {};
  let total = 0;
  for (const id of planningIds) {
    const p = scratch.find(pp => pp.id === id);
    const quote = quoteBuild(p.kind, p.x, p.y, scratch);
    const cost = quote ? quote.cost : p.cost;
    costs[id] = cost;
    total += cost;
    p.status = 'built';
  }
  return { total, costs };
}

// Stage 11: build-time legality — on top of (not instead of) whatever
// quoteBuild() charges. Checked wherever a plot's kind/position is set or
// changed (placePlot/buildPlot/movePlanningPlot/relocatePlot in state.js),
// so an illegal siting is refused before any money moves. Pure function;
// `builtPlots` is state.builtPlots (any status — a planning stage still
// "claims" its spot for spacing purposes, same as it claims its cell for
// the occupancy check state.js already does). `excludeId` lets a plot being
// moved/relocated ignore its own current position when checking distance to
// itself. Returns { ok, reason } rather than throwing — callers surface
// `reason` as the same kind of error string quoteBuild-adjacent checks use.
export function isLegalPlacement(kind, x, y, builtPlots, excludeId) {
  const { w, h } = footprintFor(kind);
  const cells = footprintCells(x, y, w, h);
  if (cells.some(c => !terrainAt(c.x, c.y))) {
    return { ok: false, reason: 'That doesn\u2019t fit within the surveyed grounds.' };
  }
  // Stage 18: message is now built from whichever terrain actually hit and
  // what's still allowed, rather than a hardcoded "try clearing/hill/woods"
  // string — that fixed suggestion would be wrong (and self-contradicting)
  // now that hill is banned for stalls but the ideal terrain for a stage.
  const banned = PLACEMENT_RULES.terrainBans[kind];
  if (banned) {
    const hitTerrain = cells.map(c => terrainAt(c.x, c.y)).find(t => banned.includes(t));
    if (hitTerrain) {
      const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
      const allowed = Object.values(TERRAIN_LEGEND).filter(t => !banned.includes(t));
      return { ok: false, reason: `A ${label} can't be built on ${hitTerrain} \u2014 try ${allowed.join(', ')} instead.` };
    }
  }
  // Stage 12: occupancy is now a footprint-vs-footprint overlap check (any
  // status counts, same as before — a still-"planning" plot claims its
  // cells too), not a single (x,y) match.
  const others = (builtPlots || []).filter(p => p && p.id !== excludeId);
  const overlaps = others.some(p => {
    const oCells = plotFootprintCells(p);
    return cells.some(c => oCells.some(o => o.x === c.x && o.y === c.y));
  });
  if (overlaps) return { ok: false, reason: 'Something is already built there.' };
  if (kind === 'stage') {
    const tooClose = others.some(p => {
      if (p.kind !== 'stage') return false;
      const oCells = plotFootprintCells(p);
      return cells.some(c => oCells.some(o => chebyshevDistance(c, o) <= PLACEMENT_RULES.minStageSpacing));
    });
    if (tooClose) {
      return { ok: false, reason: 'Too close to another stage \u2014 give show sites more room to breathe.' };
    }
  }
  // Stage 18: same-kind stall spacing — mirrors the stage-spacing check
  // above, but only between two stalls of the SAME kind (see PLACEMENT_RULES
  // comment for why). Any status counts toward this, same reasoning as the
  // stage check: a still-planning stall claims its spacing too.
  if ((PLACEMENT_RULES.stallSpacingKinds || []).includes(kind) && PLACEMENT_RULES.minStallSpacing != null) {
    const tooClose = others.some(p => {
      if (p.kind !== kind) return false;
      const oCells = plotFootprintCells(p);
      return cells.some(c => oCells.some(o => chebyshevDistance(c, o) <= PLACEMENT_RULES.minStallSpacing));
    });
    if (tooClose) {
      const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
      return { ok: false, reason: `Two ${label}s can't crowd the same corner \u2014 spread them out a little.` };
    }
  }
  // Stage 18: a hard cap on how many of a kind can be built or still
  // planned at once (see PLACEMENT_RULES.maxBuiltByKind). Counts any
  // status — otherwise a player could lay out several planning-status
  // plots past the cap and bulk-commit them past it in one shot via
  // commitAllPlots, the same bypass the stage-spacing check already guards
  // against.
  const maxByKind = PLACEMENT_RULES.maxBuiltByKind || {};
  if (maxByKind[kind] != null) {
    const existingCount = others.filter(p => p.kind === kind).length;
    if (existingCount >= maxByKind[kind]) {
      const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
      return { ok: false, reason: `The grounds can only support ${maxByKind[kind]} ${label}s at once.` };
    }
  }
  const requiresFrontage = (PLACEMENT_RULES.requiresPathFrontage || []).includes(kind);
  if (requiresFrontage && !hasPathFrontage(cells)) {
    const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
    return { ok: false, reason: `A ${label} needs to sit on or beside a path \u2014 nothing gets built away from the thoroughfare.` };
  }
  // Phase 1 increment 2: the col-3 spur, ruled (#227). hasPathFrontage is a
  // terrain check — it asks whether a path tile touches the footprint, not
  // whether anybody can walk down it. The authored network has a gap at
  // (3,3), so the whole col-3 spur below it is path nobody can reach from
  // ENTRANCE, and through Stage 22 a stall built against it sold at the
  // 0.8x reachability floor to a crowd that was never modelled arriving.
  // Increment 2 made sales the walk's, so that stall now takes $0 a day
  // while paying full upkeep. A silent trap is not this game's habit — a
  // refusal is a sentence, and it comes before money moves — so the
  // placement is refused outright. Already-built plots are grandfathered:
  // this gate is only ever asked about a new placement, and simulateDay
  // names an existing one in `unreachable` instead.
  if (requiresFrontage && !Number.isFinite(reachabilityDistance({ kind, x, y, w, h }))) {
    const label = STRUCTURE_TYPES[kind] ? STRUCTURE_TYPES[kind].label : kind;
    return { ok: false, reason: `That stretch of path doesn\u2019t connect to the front gate \u2014 a ${label} there would never see a guest.` };
  }
  return { ok: true, reason: null };
}

// ---------- build preview (Phase 6, increment 2) ----------
// What building a kind at (x,y) would actually do to the grounds, worked
// out the only honest way there is: splice the candidate into a copy of
// `builtPlots` and run the same three pure functions the day itself runs.
// Nothing below re-derives a draw, a traffic mult or a gate reach — a
// preview that re-implements the numbers it is previewing is a second
// implementation to keep in step with the first, and it goes out of step
// silently. (#34's lesson, pointed at a feature rather than a test.)
//
// The candidate is spliced as `status: 'built'`, and a stall is spliced
// with a vendor seated, because all three functions skip a planning plot
// and computeGroundsDraw skips an unstaffed stall. A preview off a
// planning splice would read "no change" on every cell of the map and be
// worse than no preview at all, so the readout says "once built and
// staffed" and means it.
//
// A cell isLegalPlacement refuses comes back { ok: false, reason } with
// that same sentence, so one call answers both "why not" and "what would
// it do" and a caller never has to ask twice.
export const PREVIEW_PLOT_ID = '__preview__';

// Below this, a mult has moved by less than a cent on the dollar and
// saying so is noise.
const PREVIEW_DROP_EPSILON = 0.005;

export function previewPlacement(kind, x, y, builtPlots = [], excludeId = null) {
  const quote = quoteBuild(kind, x, y, builtPlots, excludeId);
  const legal = isLegalPlacement(kind, x, y, builtPlots, excludeId);
  if (!legal.ok) {
    return { ok: false, reason: legal.reason, kind, x, y, name: quote ? quote.name : null, cost: quote ? quote.cost : null };
  }
  // quoteBuild returns null for an unknown kind or an off-grid footprint;
  // isLegalPlacement refuses both first, so reaching here with no quote
  // would mean the two disagree. Say so rather than reading fields off null.
  if (!quote) {
    return { ok: false, reason: 'That doesn\u2019t fit within the surveyed grounds.', kind, x, y, name: null, cost: null };
  }

  const before = (builtPlots || []).filter(p => p && p.id !== excludeId);
  const isStall = kind === 'food' || kind === 'vendor';
  const candidate = {
    id: PREVIEW_PLOT_ID,
    kind, x, y, w: quote.w, h: quote.h,
    name: quote.name,
    cost: quote.cost,
    status: 'built',
    assignedVendorId: isStall ? PREVIEW_PLOT_ID : undefined,
  };
  const after = [...before, candidate];

  const drawBefore = computeGroundsDraw(before).mult;
  const drawAfter = computeGroundsDraw(after).mult;
  const trafficBefore = computeFootTraffic(before);
  const trafficAfter = computeFootTraffic(after);
  const reachBefore = computeReachability(before);
  const reachAfter = computeReachability(after);

  // Both foot traffic and gate reach are scored against their group's own
  // mean (see computeFootTraffic and reachabilityGroup), so a new plot
  // moves every plot already in its group. That is the half of the trade a
  // cost quote can never show, and it is the half a player is most likely
  // to regret, so it gets counted instead of left implicit.
  const drops = [];
  for (const p of before) {
    if (p.status !== 'built') continue;
    let drop = 0;
    const t0 = trafficBefore[p.id], t1 = trafficAfter[p.id];
    if (t0 && t1) drop += t0.mult - t1.mult;
    const r0 = reachBefore[p.id], r1 = reachAfter[p.id];
    if (r0 && r1) drop += r0.mult - r1.mult;
    if (drop > PREVIEW_DROP_EPSILON) drops.push({ id: p.id, name: p.name, drop: round2(drop) });
  }
  drops.sort((a, b) => b.drop - a.drop || (a.name < b.name ? -1 : 1));

  const ownTraffic = trafficAfter[PREVIEW_PLOT_ID] || null;
  const ownReach = reachAfter[PREVIEW_PLOT_ID] || null;
  return {
    ok: true,
    reason: null,
    kind, x, y,
    name: quote.name,
    cost: quote.cost,
    capacity: quote.capacity,
    draw: { before: round2(drawBefore), after: round2(drawAfter), delta: round2(drawAfter - drawBefore) },
    traffic: ownTraffic ? { mult: round2(ownTraffic.mult), score: ownTraffic.traffic } : null,
    reach: ownReach ? { hops: ownReach.distance, mult: round2(ownReach.mult) } : null,
    drops,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Quirk effects are looked up by id rather than storing functions in data.js,
// keeping data.js pure content. Each quirk fn: (performer, ctx) => modifier info.
export const QUIRKS = {
  crowd_pleaser: {
    label: 'Crowd Pleaser',
    desc: '+15% draw in whatever block they play.',
    popularityMult: 1.15,
  },
  prima_donna: {
    label: 'Prima Donna',
    desc: 'Sulks (\u22123 satisfaction that block) if sharing a block with an equally or more popular act.',
    popularityMult: 1.0,
  },
  chaos_prone: {
    label: 'Chaos-Prone',
    desc: 'Raises the odds of a "Rowdy Crowd" event on days they perform.',
    popularityMult: 1.0,
  },
  // Stage 9: the first quirk whose effect actually depends on WHICH block
  // they're playing, not just whether they're playing at all — see
  // effectivePopularity() below, which is the only place blockId matters.
  night_owl: {
    label: 'Night Owl',
    desc: '+20% draw in Golden Hour; \u221210% draw in Morning Procession; no change midday/afternoon.',
    goldenMult: 1.2,
    morningMult: 0.9,
  },
};

// Effective popularity for a performer in a given time block, quirks
// applied. Exported (and pulled out of simulateDay's old inline closure)
// so it's independently testable — night_owl is the first quirk whose
// effect depends on WHICH block is passed in, so this needed to stop being
// a private nested function.
export function effectivePopularity(perf, blockId) {
  let mult = 1;
  if (perf.quirk === 'crowd_pleaser') mult *= QUIRKS.crowd_pleaser.popularityMult;
  if (perf.quirk === 'night_owl') {
    if (blockId === 'golden') mult *= QUIRKS.night_owl.goldenMult;
    else if (blockId === 'morning') mult *= QUIRKS.night_owl.morningMult;
  }
  return perf.popularity * mult;
}

// ---------- scheduling ----------
// schedule shape: { [blockId]: { [stageId]: performerId } }
// Returns a list of human-readable conflict strings (a performer scheduled
// into more than one block-stage slot within the SAME block is impossible
// by construction since a block only holds one performer per stage — the
// real conflict is the same performer in two different STAGES within the
// same time block, which we do need to catch).
export function validateSchedule(schedule) {
  const conflicts = [];
  for (const block of TIME_BLOCKS) {
    const stagesInBlock = schedule[block.id] || {};
    const seen = new Map();
    for (const [stageId, performerId] of Object.entries(stagesInBlock)) {
      if (!performerId) continue;
      if (seen.has(performerId)) {
        conflicts.push(`${performerById(performerId)?.name || performerId} is double-booked in ${block.label} (${seen.get(performerId)} and ${stageId})`);
      } else {
        seen.set(performerId, stageId);
      }
    }
  }
  return conflicts;
}

// ---------- day simulation ----------
// state fields used (read-only): cash, reputation, day, builtPlots[],
// roster[] (performer ids), hiredVendors[] (vendor ids), schedule, ticketPrice
export function simulateDay(state, seed) {
  const rng = makeRng(seed);
  const log = [];
  const warnings = [];

  // Stage 10: a plot still in "planning" hasn't been paid for or committed
  // yet, so it doesn't draw a crowd, seat a vendor, or affect anything else
  // gameplay-side until it's actually built.
  const builtStages = state.builtPlots.filter(p => p.kind === 'stage' && p.status === 'built');
  const builtFoodVendorPlots = state.builtPlots.filter(p => (p.kind === 'food' || p.kind === 'vendor') && p.status === 'built');
  // Phase 3: the save's own version of each act, not the catalog's — an arc
  // may have moved their popularity, quality or quirk.
  const rosterPerformers = state.roster.map(id => performerFor(state, id)).filter(Boolean);
  const hiredVendorObjs = state.hiredVendors.map(id => vendorFor(state, id)).filter(Boolean);
  // Stage 10: hiring a vendor and seating them at a specific stall are now
  // two different things — a hired-but-unseated vendor still draws wages
  // (see vendorCosts below) but sells nothing, so only vendors actually
  // assigned to a built stall count toward revenue/satisfaction.
  const seatedVendorIds = new Set(builtFoodVendorPlots.filter(p => p.assignedVendorId).map(p => p.assignedVendorId));
  const activeVendorObjs = hiredVendorObjs.filter(v => seatedVendorIds.has(v.id));

  if (builtStages.length === 0) warnings.push('No stages built — the grounds have nothing to draw a crowd.');
  if (builtFoodVendorPlots.length > 0 && hiredVendorObjs.length === 0) {
    warnings.push('Stall plots are built but no vendors are hired to run them.');
  }
  const unseated = hiredVendorObjs.length - activeVendorObjs.length;
  if (unseated > 0) {
    warnings.push(`${unseated} hired vendor${unseated === 1 ? ' is' : 's are'} not assigned to a stall and earning nothing today.`);
  }

  // --- per-block, per-stage draw weight ---
  // Stage 17: computed once here (rather than inside computeVendorRevenue's
  // own footTraffic call below) so a stage's draw weight and a stall's
  // sales both read the exact same day's reachability numbers.
  const reachability = computeReachability(state.builtPlots);
  let scheduledCount = 0;
  const blockBreakdown = TIME_BLOCKS.map(block => {
    const stagesInBlock = state.schedule[block.id] || {};
    const stageEntries = builtStages.map(stage => {
      const performerId = stagesInBlock[stage.id];
      const perf = performerId ? performerFor(state, performerId) : null;
      if (perf) scheduledCount++;
      const drawPop = perf ? effectivePopularity(perf, block.id) : 1.2; // ambient draw, empty stage
      const attrs = computePlotAttributes(stage, state.builtPlots);
      const reachMult = reachability[stage.id] ? reachability[stage.id].mult : 1;
      const weight = (attrs.traffic * 0.45 + (drawPop / 10) * 0.55) * reachMult;
      return { stage, attrs, perf, drawPop, weight, reachMult };
    });
    return { block, stageEntries };
  });

  // Only worth remarking on when two built stages' gate-walk actually
  // differs noticeably today — mirrors the vendor-stall spread log below.
  if (builtStages.length > 1) {
    const byReach = builtStages.map(s => ({ stage: s, mult: reachability[s.id] ? reachability[s.id].mult : 1 }));
    const nearest = byReach.reduce((a, b) => (b.mult > a.mult ? b : a));
    const farthest = byReach.reduce((a, b) => (b.mult < a.mult ? b : a));
    if (nearest.stage.id !== farthest.stage.id && nearest.mult / farthest.mult >= 1.3) {
      log.push(`${nearest.stage.name} pulled a bigger walk-up crowd being close to the gate, while ${farthest.stage.name} sat too far back to catch as many passersby.`);
    }
  }

  // --- prima donna satisfaction penalty check ---
  for (const { block, stageEntries } of blockBreakdown) {
    const withPerf = stageEntries.filter(e => e.perf);
    for (const e of withPerf) {
      if (e.perf.quirk === 'prima_donna') {
        const rival = withPerf.find(o => o !== e && o.perf.popularity >= e.perf.popularity);
        if (rival) {
          log.push(`${e.perf.name} sulked through ${block.label} sharing the bill with ${rival.perf.name}.`);
          e._sulking = true;
        }
      }
    }
  }

  // --- attendance ---
  const totalScheduledPopularity = rosterPerformers.reduce((sum, p) => sum + (state.schedule && isScheduledAnywhere(state.schedule, p.id) ? effectivePopularity(p) : 0), 0);
  const baseAttendance = 150 + state.reputation * 4;
  const priceMult = priceFactor(state.ticketPrice);
  const popularityFactor = 1 + Math.min(1.2, totalScheduledPopularity / 55);
  const adFactor = state.activeCampaign ? state.activeCampaign.attendanceMult : 1;
  // Stage 19: the grounds themselves are now a term in this formula. An
  // empty field multiplies out to GROUNDS_DRAW.floor no matter how famous
  // the faire is or who's on the bill, which is what makes construction —
  // and all the siting math from Stages 12/14/17 that feeds off it — worth
  // paying for.
  const groundsDraw = computeGroundsDraw(state.builtPlots);
  // Stage 22: Friday/Saturday/Sunday finally draw differently. Falls back to
  // neutral (1) for a state that never set weekendDay — every ad-hoc test
  // state built with a plain object literal, mainly — rather than NaN-ing
  // the whole attendance formula.
  const weekendDayFactor = WEEKEND_DAY_ATTENDANCE[state.weekendDay] || 1;
  // Phase 7: the crowd the player is *running a faire for* — everything in
  // the formula they decided, with the sky and the day's jitter left out.
  // This is what security is priced against (#257): a watch is hired days
  // ahead, against the size of faire this is, and the fact that it rained
  // on Saturday is not something anybody staffed for. Keeping the sky out
  // of it is also what keeps the weather-determinism check honest — the
  // same seed still rolls the same events under any sky, because nothing
  // downstream of `weather` reaches the event pool.
  const expectedCrowd = Math.max(0, Math.round(baseAttendance * priceMult * popularityFactor * adFactor * groundsDraw.mult * weekendDayFactor));
  const exposure = crowdExposure(state, expectedCrowd);
  // Phase 2: the sky gets a vote in how many people turn out. Read off the
  // state rather than rolled here (#231) — state.js stamps the day's
  // weather when the day begins, so this is a lookup, not a draw, and no
  // seed's event rolls moved when the phase landed.
  const weather = weatherFor(state);
  const jitter = 0.9 + rng() * 0.2;
  const turnout = Math.max(0, Math.round(baseAttendance * priceMult * popularityFactor * adFactor * groundsDraw.mult * weekendDayFactor * weather.attendanceMult * jitter));
  // Phase 7: and the gate can only get so many of them through the fence.
  // Everything downstream of this line — the walk, the till, the guest
  // costs, the ticket revenue — reads `attendance`, which is the crowd that
  // got IN. The ones turned away are counted, and they are the whole reason
  // to hire a gate crew.
  const gate = admitAtGate(turnout, gateCapacity(state));
  const attendance = gate.admitted;

  // --- satisfaction (attendance-weighted across block/stage slots) ---
  let satWeightSum = 0;
  let satTotal = 0;
  let overCapacityHit = false;
  const totalWeightAllBlocks = blockBreakdown.reduce((s, b) => s + b.stageEntries.reduce((s2, e) => s2 + e.weight, 0), 0) || 1;

  // Phase 7: the herald moves the crowd that cannot get near a stage to a
  // block that has room for them. `blockCaps` is the seating each block
  // has — every built stage, in every block, since a stage stands in all
  // four — and the pull is 0 with no announcer on the payroll, which makes
  // these three lines hand back exactly the head counts this loop has
  // always used.
  const rawCounts = blockBreakdown.map(b => Math.round(attendance * ((b.stageEntries.reduce((s, e) => s + e.weight, 0) || 1) / totalWeightAllBlocks)));
  const blockCaps = blockBreakdown.map(b => b.stageEntries.reduce((s, e) => s + Math.floor((e.stage.capacity || 0) * CROWDING_FILL), 0));
  const blockCounts = relieveOverflow(rawCounts, blockCaps, announcerPull(state, attendance));
  let blockIndex = -1;
  for (const { block, stageEntries } of blockBreakdown) {
    blockIndex++;
    const blockWeightSum = stageEntries.reduce((s, e) => s + e.weight, 0) || 1;
    const blockAttendance = Math.round(blockCounts[blockIndex]);
    // Stage 19: sightline/shade/popularity weights are per-block now, not
    // constant — shade only counts while the sun is actually on the crowd.
    // Phase 2: and how much sun that is now depends on the day as well as
    // the block, so a scorcher punishes an open hilltop in every block and
    // a grey day flattens the tradeoff to nearly nothing.
    const qw = blockQualityWeights(block, weather);
    for (const e of stageEntries) {
      const share = e.weight / blockWeightSum;
      const stageAttendance = Math.round(blockAttendance * share);
      const capped = Math.min(stageAttendance, e.stage.capacity);
      const overflow = Math.max(0, stageAttendance - e.stage.capacity);
      if (overflow > 0) { overCapacityHit = true; e._overflowed = true; }
      let quality = e.attrs.sightline * qw.sightline + e.attrs.shade * qw.shade + (e.drawPop / 10) * qw.pop;
      if (e._sulking) quality -= 0.3;
      if (capped > e.stage.capacity * CROWDING_FILL) quality -= CROWDING_PENALTY; // crowding discomfort near cap
      // Phase 7: and the people who could not get near it at all count too,
      // at OVERFLOW_QUALITY. Through Phase 6 they were dropped from the
      // average outright, which meant a stage that turned five hundred
      // people away from the view scored exactly what a stage that seated
      // its whole crowd did, less the 0.15 above — the warning said "some
      // folks were turned away from the best view" and not one number in
      // the day agreed with it. It is also what gives an announcer anything
      // to sell: relieving an overflow is worth something now.
      satWeightSum += capped + overflow;
      satTotal += quality * capped + OVERFLOW_QUALITY * overflow;
    }
  }
  let satisfaction = satWeightSum > 0 ? clamp((satTotal / satWeightSum) * 100, 0, 100) : 45;
  if (overCapacityHit) warnings.push('At least one stage overflowed its capacity — some folks were turned away from the best view.');

  // Stage 19: what the crowd thinks of what they paid at the gate. Together
  // with the steeper elasticity in priceFactor, this is what makes the
  // ticket slider a real decision — a high price is still the better cash
  // day, but it costs standing, and standing is what grows attendance
  // every day after this one.
  const priceSatDelta = priceSatisfactionDelta(state.ticketPrice);
  satisfaction = clamp(satisfaction + priceSatDelta, 0, 100);
  // Phase 2: and what the sky did to the mood, on top of what the day's
  // siting and scheduling earned. Applied after the block loop rather than
  // inside it because it is the same for every block — the per-block half
  // of weather is the heat that already moved qw above.
  const weatherSatDelta = weather.satisfactionDelta || 0;
  satisfaction = clamp(satisfaction + weatherSatDelta, 0, 100);
  if (weatherSatDelta <= -4) {
    warnings.push(`${weather.name} all day \u2014 ${weather.note}`);
  } else if (weatherSatDelta >= 2) {
    log.push(`${weather.name}, and the crowd was in no hurry to leave.`);
  }
  // Phase 7: and what the queue at the fence did to it. Zero on every day
  // the gate kept up, which is every day a small faire has.
  const gateSatDelta = turnedAwaySatisfactionDelta(gate);
  satisfaction = clamp(satisfaction + gateSatDelta, 0, 100);
  if (gate.turnedAway > 0) {
    warnings.push(`The gate could only get ${gate.admitted.toLocaleString()} people through \u2014 ${gate.turnedAway.toLocaleString()} were turned away at the fence, and the queue soured the ones who made it in.`);
  }
  if (priceSatDelta <= -6) {
    warnings.push(`At ${'$' + state.ticketPrice} a head, plenty of folk grumbled about the price on the way in.`);
  } else if (priceSatDelta >= 2) {
    log.push('Word got round that the gate was a bargain, and the crowd arrived in a generous mood.');
  }

  // --- the crowd walks (Phase 1) ---
  // A second rng stream, derived from the seed rather than drawn from the
  // day's own, so every event roll a seed produced before this phase is the
  // roll it produces after it. Only aggregates leave here: the guests die
  // with the report and `history` never carries a person.
  //
  // Increment 2 moved this above vendor revenue, because vendor revenue is
  // now read off it.
  const guestRng = makeRng((seed ^ 0x9E3779B9) >>> 0);
  const { guests: population, represents } = spawnGuests(attendance, guestRng, state.ticketPrice);
  const walk = walkGuests(state, population, guestRng);
  const scale = (n) => Math.round(n * represents);

  // --- vendor revenue ---
  // Stage 14 gave a seated vendor's buyer count a foot-traffic multiplier
  // and Stage 17 layered gate-distance on top, but both were coefficients
  // on `attendance`: every stall converted a fixed 12% of the whole crowd,
  // nudged up or down by two clamped siting bands. Nobody had walked
  // anywhere, so the crowd at a stall was an assumption.
  //
  // Phase 1 increment 2: a stall's gross is the money guests handed over at
  // it — `spentAt`, one arrival at a time, out of purses the walk actually
  // tracks — scaled from the sample to the crowd by `represents`. The house
  // still keeps CONFIG.wristbandCut of that and nothing else, exactly as
  // before. Three things fall out of the change rather than being coded:
  // a stall nobody can walk to earns $0 instead of the old 0.8x floor
  // (#227), a stall whose crowd already spent its purse stops selling, and
  // the siting bands stop being a cap on how much better a good spot can be
  // than a bad one.
  //
  // Nothing here is scaled to hit a number. The walk's per-head gross came
  // out about five times Stage 22's coefficient, and the crowd is the part
  // that is right — 1.4 meals and 0.9 craft buys off a $20-90 purse is what
  // a day at a faire costs. The percentage moved instead: CONFIG.wristbandCut
  // went 0.28 -> 0.12 because it is now a slice of real money rather than of
  // a coefficient (#228). perGuestCost was tried first and is the wrong
  // knob — it scales with the crowd whether or not anything is being sold,
  // and at $11 a head SIGNIFICANCE 3 fails: on a faire with no stalls the
  // crowd becomes pure cost and charging the maximum is correct again.
  const footTraffic = measureFootTraffic(walk.arrivals, state.builtPlots);
  const footTrafficEstimate = computeFootTraffic(state.builtPlots);
  const plotByVendorId = new Map(builtFoodVendorPlots.filter(p => p.assignedVendorId).map(p => [p.assignedVendorId, p]));
  let vendorGrossTotal = 0;
  let houseVendorRevenue = 0;
  let bestStall = null, worstStall = null;
  const stallSales = {};
  for (const vendor of activeVendorObjs) {
    const plot = plotByVendorId.get(vendor.id);
    // Scale the buyer count once and price off that, rather than scaling
    // the raw till separately: rounding both independently lets the report
    // print N sales next to a gross that is not N times the ticket, and a
    // ledger a player can't add up is worse than a dollar of precision.
    const buyers = plot ? scale(walk.buyers[plot.id] || 0) : 0;
    const gross = buyers * vendor.avgTicket;
    vendorGrossTotal += gross;
    houseVendorRevenue += gross * CONFIG.wristbandCut;
    satisfaction = clamp(satisfaction + (vendor.quality - 6) * 0.4, 0, 100);
    if (plot) {
      stallSales[plot.id] = { vendorId: vendor.id, buyers, gross, house: Math.round(gross * CONFIG.wristbandCut) };
      const mult = footTraffic[plot.id] ? footTraffic[plot.id].mult : 1;
      const entry = { vendor, plot, mult };
      if (!bestStall || mult > bestStall.mult) bestStall = entry;
      if (!worstStall || mult < worstStall.mult) worstStall = entry;
    }
  }
  // Only worth remarking on when the spread between the best- and
  // worst-visited stalls today is actually noticeable. Measured now, so
  // "barely anyone drifted past" means barely anyone did.
  if (bestStall && worstStall && bestStall.vendor.id !== worstStall.vendor.id && bestStall.mult / worstStall.mult >= 1.3) {
    log.push(`${bestStall.vendor.name} pulled a lively crowd from its ${bestStall.plot.name} spot, while ${worstStall.vendor.name} saw barely anyone drift past its ${worstStall.plot.name}.`);
  }

  const guests = {
    sampled: walk.sampled,
    represents: Math.round(represents * 100) / 100,
    byArchetype: walk.byArchetype,
    ate: scale(walk.served.food),
    watched: scale(walk.served.spectacle),
    bought: scale(walk.served.spend),
    shaded: scale(walk.served.shade),
    hungry: scale(walk.hungry),
    unspent: scale(walk.unspent),
    // The same money as the stall lines below, so "left the purses" and the
    // stall revenue row on the ticket stub agree to the dollar.
    spent: vendorGrossTotal,
    steps: walk.steps,
    idle: walk.idle,
    offGrid: walk.offGrid,
    arrivals: walk.arrivals,
    buyers: walk.buyers,
    unreachable: walk.unreachable,
  };
  if (attendance > 0 && walk.sampled > 0) {
    if (guests.hungry > 0 && guests.hungry >= attendance * 0.25) {
      warnings.push(`${guests.hungry.toLocaleString()} guests went home hungry — not enough food within a walk of where the crowd was.`);
    }
    if (guests.unspent > 0 && guests.unspent >= attendance * 0.25 && builtFoodVendorPlots.length > 0) {
      log.push(`${guests.unspent.toLocaleString()} guests left with their purse untouched.`);
    }
    if (walk.unreachable.length > 0) {
      const names = walk.unreachable.map(id => (state.builtPlots.find(p => p.id === id) || {}).name || id);
      const staffed = walk.unreachable.some(id => (state.builtPlots.find(p => p.id === id) || {}).assignedVendorId);
      warnings.push(`Nobody could find a way from the gate to ${names.join(', ')} — ${walk.unreachable.length === 1 ? 'it fronts' : 'they front'} a stretch of path that does not connect${staffed ? ', and it took nothing all day' : ''}.`);
    }
  }

  // --- ticket revenue & costs ---
  const ticketRevenue = attendance * state.ticketPrice;
  const performerCosts = rosterPerformers.reduce((s, p) => s + effectivePerformerCost(state, p.id), 0);
  const vendorCosts = hiredVendorObjs.reduce((s, v) => s + effectiveVendorCost(state, v.id), 0);
  // Phase 7: the people who work the gate, the grounds and the crossings.
  // CONFIG.baseOverhead came down 300 when this line went in — see the
  // paragraph on it in data.js.
  const crewCosts = crewOf(state).reduce((s, c) => s + effectiveCrewCost(state, c.id), 0);
  // Stage 13: real per-plot upkeep (any built kind, not just stages)
  // replaces the old flat "+20/stage" stand-in; overhead is now just the
  // flat cost of running the grounds at all, independent of what's built.
  const overhead = CONFIG.baseOverhead;
  const upkeep = totalUpkeep(state.builtPlots);
  // Stage 19: the cost of hosting the crowd itself, which scales with the
  // crowd — see CONFIG.perGuestCost.
  const guestCosts = Math.round(attendance * CONFIG.perGuestCost);
  const costs = performerCosts + vendorCosts + crewCosts + upkeep + overhead + guestCosts;

  // --- what the day did to the acts (Phase 3) ---
  // Pure arithmetic on what already happened above: who played, in which
  // block, who sulked, whose stage overflowed, which stall took money. The
  // deltas ride out on the result and state.js's runDay is what applies
  // them, so a report can print them and a replayed seed moves them the
  // same way twice.
  const relationships = {};
  const moodLines = [];
  const note = (id, delta, why) => {
    if (!relationships[id]) relationships[id] = { delta: 0, notes: [] };
    relationships[id].delta += delta;
    relationships[id].notes.push(why);
  };
  for (const perf of rosterPerformers) {
    const played = blockBreakdown.flatMap(b => b.stageEntries.filter(e => e.perf && e.perf.id === perf.id).map(e => ({ block: b.block, entry: e })));
    if (played.length === 0) { note(perf.id, RELATIONSHIP.offBill, 'left off the bill'); continue; }
    note(perf.id, RELATIONSHIP.onBill, 'played');
    const best = bestBlockFor(perf);
    if (played.some(p => p.block.id === best.id)) note(perf.id, RELATIONSHIP.bestBlock, `played ${best.label}, their best block`);
    if (played.some(p => p.entry._sulking)) note(perf.id, RELATIONSHIP.sulked, 'sulked through a shared bill');
    if (played.some(p => p.entry._overflowed)) note(perf.id, RELATIONSHIP.packedHouse, 'played to a packed house');
  }
  for (const vendor of hiredVendorObjs) {
    const plot = plotByVendorId.get(vendor.id);
    if (!plot) { note(vendor.id, RELATIONSHIP.unseated, 'hired and left standing'); continue; }
    const sale = stallSales[plot.id];
    if (sale && sale.buyers > 0) note(vendor.id, RELATIONSHIP.soldWell, 'sold well');
    else note(vendor.id, RELATIONSHIP.soldNothing, 'sold nothing all day');
  }
  for (const [id, r] of Object.entries(relationships)) {
    if (r.delta <= -4 || r.delta >= 4) {
      moodLines.push(`${actNameOf(id)} ${r.delta > 0 ? 'went home pleased' : 'went home sore'}: ${r.notes.join(', ')}.`);
    }
  }
  const actRelationship = (id) => relationshipOf(state, id);
  const contractedIds = contractedActIds(state);

  // --- random events ---
  const ctx = {
    hasChaosProne: rosterPerformers.some(p => p.quirk === 'chaos_prone' && isScheduledAnywhere(state.schedule, p.id)),
    hasVendor: activeVendorObjs.length > 0,
    // Stage 9: "backstage drama" events gated on roster composition rather
    // than a single quirk/vendor flag.
    hasMultiplePrimaDonnas: rosterPerformers.filter(p => p.quirk === 'prima_donna').length >= 2,
    hasTwoMusicians: rosterPerformers.filter(p => p.role === 'musician' && isScheduledAnywhere(state.schedule, p.id)).length >= 2,
    hasFalconerScheduled: rosterPerformers.some(p => p.role === 'falconer' && isScheduledAnywhere(state.schedule, p.id)),
    bigRoster: rosterPerformers.length >= 5,
    // Phase 3: gated on how the acts feel, not on who they are.
    hasDevotedAct: contractedIds.some(id => actRelationship(id) >= RELATIONSHIP.devotedAt),
    hasSourAct: contractedIds.some(id => actRelationship(id) <= RELATIONSHIP.sourAt),
  };
  // Phase 7: an exposed crowd is a crowd trouble finds more often, and a
  // crowd that costs more to put right when it does. Both multipliers are
  // exactly 1 at exposure 0, so an unwatched small faire draws from the
  // pool it always drew from.
  const events = rollEvents(rng, ctx, exposure);
  let eventCashDelta = 0, eventRepDelta = 0, eventSatDelta = 0;
  for (const evt of events) {
    const eff = EVENT_EFFECTS[evt.effectId];
    if (!eff) continue;
    const result = eff(rng, state, evt.incident ? incidentCostMult(exposure) : 1);
    eventCashDelta += result.cashDelta || 0;
    eventRepDelta += result.repDelta || 0;
    eventSatDelta += result.satisfactionDelta || 0;
    log.push(result.message);
  }
  satisfaction = clamp(satisfaction + eventSatDelta, 0, 100);
  for (const line of moodLines) log.push(line);

  const cashDelta = Math.round(ticketRevenue + houseVendorRevenue - costs + eventCashDelta);
  const reputationDelta = clamp(Math.round((satisfaction - 60) / 8), -6, 6) + eventRepDelta;

  return {
    day: state.day,
    attendance,
    // Phase 7: the crowd that turned up, the crowd that got in, and the
    // ceiling that decided which. `attendance` above is gate.admitted, so a
    // report reads the number it has always read.
    turnout: gate.raw,
    turnedAway: gate.turnedAway,
    gateCapacity: gate.capacity,
    gateSatDelta: Math.round(gateSatDelta * 10) / 10,
    // What the watch was and was not covering, so the report can say why an
    // incident cost what it did.
    expectedCrowd,
    exposure: Math.round(exposure * 100) / 100,
    ticketRevenue: Math.round(ticketRevenue),
    vendorRevenue: Math.round(houseVendorRevenue),
    performerCosts, vendorCosts, crewCosts, upkeep, overhead, guestCosts,
    costs: Math.round(costs),
    cashDelta,
    satisfaction: Math.round(satisfaction),
    reputationDelta,
    scheduledCount,
    adFactor,
    // Stage 19: surfaced so the day report can show *why* the crowd was the
    // size it was, rather than presenting attendance as an oracle.
    groundsDraw,
    priceMult,
    priceSatDelta: Math.round(priceSatDelta * 10) / 10,
    // Phase 2: the whole WEATHER row, so a report written today still reads
    // correctly if the table is retuned tomorrow — history carries what the
    // day actually ran under rather than an id to look up later.
    weather,
    weatherSatDelta,
    campaignActive: state.activeCampaign ? state.activeCampaign.name : null,
    // Phase 1 increment 2: `footTraffic` is measured off the walk;
    // `footTrafficEstimate` is the terrain-and-adjacency forecast the build
    // palette shows before the gates open. The report carries both so a
    // player can see where the estimate was wrong.
    footTraffic,
    footTrafficEstimate,
    stallSales,
    vendorGross: vendorGrossTotal,
    reachability,
    // Phase 1: what the crowd did on foot. Aggregates only — see guests.js.
    guests,
    // Phase 3: what the day did to each contracted act, by id — a delta and
    // the reasons for it. runDay applies it; the ticket stub prints it.
    relationships,
    events,
    log,
    warnings,
  };
}

function isScheduledAnywhere(schedule, performerId) {
  for (const stages of Object.values(schedule || {})) {
    if (Object.values(stages).includes(performerId)) return true;
  }
  return false;
}

// Every `requires` string any EVENT_POOL entry uses must have an entry
// here — see the EVENT_POOL integrity test in tests/smoke.mjs, which
// walks EVENT_POOL and asserts exactly that. Exported so a future stage
// adding a new gated event can't silently typo a requires string: an
// unrecognized one now makes that event ineligible (fails closed) instead
// of the old inline if/else chain's fallback of treating it as always
// eligible (fails open) — a bug that happened to be harmless while only
// two requires strings existed, but wouldn't have stayed harmless forever.
export const EVENT_REQUIREMENTS = {
  hasChaosProne: (ctx) => ctx.hasChaosProne,
  hasVendor: (ctx) => ctx.hasVendor,
  hasMultiplePrimaDonnas: (ctx) => ctx.hasMultiplePrimaDonnas,
  hasTwoMusicians: (ctx) => ctx.hasTwoMusicians,
  hasFalconerScheduled: (ctx) => ctx.hasFalconerScheduled,
  bigRoster: (ctx) => ctx.bigRoster,
  // Phase 3
  hasDevotedAct: (ctx) => ctx.hasDevotedAct,
  hasSourAct: (ctx) => ctx.hasSourAct,
};

// Phase 7: `exposure` (0..1, from crowdExposure) is how much of today's
// crowd the watch is not covering. It scales the weight of every row flagged
// `incident` in EVENT_POOL and nothing else, so trouble finds a big
// unguarded faire more often than a small one or a well-watched one. At
// exposure 0 the multiplier is exactly 1 and every weight, every total and
// every roll is what it was before the phase landed.
function rollEvents(rng, ctx, exposure = 0) {
  const mult = incidentWeightMult(exposure);
  const eligible = EVENT_POOL.filter(e => {
    if (!e.requires) return true;
    const check = EVENT_REQUIREMENTS[e.requires];
    return check ? check(ctx) : false;
  }).map(e => (e.incident && mult !== 1 ? { ...e, weight: e.weight * mult } : e));
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);
  const events = [];
  // At most one event per day for stage 1 — keeps the report readable and
  // the sim easy to reason about. See WISHLIST.md Phase 1 for scaling this up.
  if (rng() < 0.6 && eligible.length > 0) {
    let roll = rng() * totalWeight;
    for (const e of eligible) {
      roll -= e.weight;
      if (roll <= 0) { events.push(e); break; }
    }
  }
  return events;
}

export const EVENT_EFFECTS = {
  perfect_weather: (rng) => ({
    cashDelta: 0, repDelta: 0, satisfactionDelta: 6,
    message: 'Clear skies and a cool breeze all day — the crowd lingered longer than usual.',
  }),
  dropped_prop_recovery: (rng) => ({
    cashDelta: 0, repDelta: 1, satisfactionDelta: 4,
    message: 'A performer fumbled a prop and turned it into a bit — the crowd loved the save.',
  }),
  // Phase 7: the two rows EVENT_POOL flags `incident` take a third
  // argument, the bill multiplier an exposed crowd earns them (see
  // CREW_RULES.costPressure). It defaults to 1, which is both what every
  // other effect gets handed and what these two get on any day the watch
  // has the crowd covered — and the rng draw is taken before the multiplier
  // is applied, so a seed's roll is the roll it always was.
  broken_wagon_wheel: (rng, state, mult = 1) => {
    const cost = Math.round((60 + Math.floor(rng() * 60)) * mult);
    return {
      cashDelta: -cost, repDelta: 0, satisfactionDelta: -3,
      message: `A supply wagon threw a wheel on the dirt path — $${cost} to get it moving again.`,
    };
  },
  noble_visit: (rng) => ({
    cashDelta: 120, repDelta: 3, satisfactionDelta: 5,
    message: 'A minor noble made a surprise visit and was delighted — word will spread.',
  }),
  rowdy_crowd: (rng, state, mult = 1) => {
    const roll = rng();
    if (roll < 0.5) {
      return { cashDelta: 0, repDelta: 0, satisfactionDelta: 5, message: 'The jester whipped the crowd into a roar of laughter.' };
    }
    const cost = Math.round((40 + Math.floor(rng() * 40)) * mult);
    return { cashDelta: -cost, repDelta: -1, satisfactionDelta: -2, message: `The rowdy crowd knocked over a stall rail — $${cost} in repairs.` };
  },
  sellout_stall: (rng) => ({
    cashDelta: 45, repDelta: 0, satisfactionDelta: 2,
    message: 'One of the stalls sold clean out by mid-afternoon — brisk business.',
  }),
  // Stage 9 additions — "backstage drama" events (see EVENT_REQUIREMENTS
  // above for what gates each one).
  diva_standoff: (rng) => ({
    cashDelta: 0, repDelta: -1, satisfactionDelta: -4,
    message: 'Two prima donnas traded icy words backstage \u2014 word of the standoff spread through the crowd.',
  }),
  musicians_jam: (rng) => ({
    cashDelta: 0, repDelta: 1, satisfactionDelta: 6,
    message: 'Two musicians struck up an unplanned duet between sets \u2014 the crowd lingered to listen.',
  }),
  falconer_show: (rng) => ({
    cashDelta: 30, repDelta: 1, satisfactionDelta: 5,
    message: 'A hawk swooped low over the crowd mid-show \u2014 gasps, then applause, then a few coins tossed.',
  }),
  gossip_wagon: (rng) => ({
    cashDelta: 0, repDelta: 0, satisfactionDelta: 3,
    message: 'With so many acts camped together, the tiring house buzzed with shared stories \u2014 morale stayed high all day.',
  }),
  // Phase 3 additions — gated on relationship tiers (see data.js's
  // RELATIONSHIP and the two ctx flags in simulateDay).
  encore: (rng) => ({
    cashDelta: 60, repDelta: 1, satisfactionDelta: 5,
    message: 'An act that loves this house stayed on past their set for an unpaid encore \u2014 the crowd threw coins, and stayed.',
  }),
  late_call: (rng) => {
    const cost = 30 + Math.floor(rng() * 50);
    return {
      cashDelta: -cost, repDelta: -1, satisfactionDelta: -4,
      message: `An act with one foot out the door missed their call \u2014 a crier was sent to find them, $${cost} and a restless crowd later.`,
    };
  },
};
