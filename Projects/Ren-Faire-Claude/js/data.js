// data.js — all tunable content. No logic lives here; engine.js reads this.
// Keeping content JSON-shaped (plain object/array literals) so it can later be
// swapped for real .json files + fetch() without touching engine/state code.

export const CONFIG = {
  startingCash: 5200,
  startingReputation: 50, // 0-100
  ticketPrice: { min: 8, max: 28, start: 16 },
  // Stage 19: 0.65 -> 0.28. The house taking nearly two-thirds of every
  // vendor sale made stall revenue dwarf the gate at scale (a large faire
  // was earning more from other people's merchandise than from its own
  // tickets, at an ~88% margin, which is not a thing a faire operator
  // gets to do). A quarter-ish cut keeps stalls clearly worth running --
  // especially now that a staffed stall also feeds GROUNDS_DRAW -- without
  // letting them become the whole business model.
  //
  // Phase 1 increment 2: 0.28 -> 0.12, and the number this multiplies is
  // what changed, not the intent (#228). Through Stage 22 a stall's gross
  // was `attendance x 0.12 x quality/7 x siting`, which came to about $4 a
  // head across a whole grounds -- a coefficient, not money anybody was
  // modelled as carrying. The walk hands the till real purses: about $26 a
  // head after the gate takes its share, which is what a day at a faire
  // actually costs a family. Keeping 0.28 of THAT paid the house roughly
  // $7 a head on top of an $11 gate margin, tripled a developed faire's
  // daily net, and put the $25,000 win condition inside two weekends. So
  // the percentage came down to a plausible concession fee on real gross.
  // The band this is tuned to is pinned in tests/smoke.mjs Section 1g
  // (SIGNIFICANCE 8): raise it back toward a quarter and a built-out faire
  // stops having to earn anything.
  wristbandCut: 0.12, // fraction of a food/craft sale that goes to the house
  blocksPerDay: 4,
  seasonLength: 3, // days per weekend/season (Fri/Sat/Sun) — see Stage 6
  // Stage 10: planning → commit construction flow. Placing a plot is free
  // and non-final ("planning"); commitPlot charges the cost and makes it
  // real. Once real, tearing it down or moving it costs money instead.
  demolishFeeMult: 0.3, // tearing down a committed plot costs this fraction of what it cost to build
  relocateDiscountMult: 0.85, // relocating a committed plot pays the demolish fee above PLUS this fraction of the new site's build cost
  maxPlotNameLength: 40, // cap on a custom name via renamePlot
  // Stage 13: daily upkeep. Every *built* (not planning) plot costs this
  // fraction of its own stored `cost` every day, staffed or not — see
  // engine.js's plotUpkeep/totalUpkeep. Deriving upkeep from a plot's own
  // cost (already set once at build/relocate time) means it automatically
  // reflects kind, terrain, and footprint with no new authored table to
  // keep in sync — a 2x2 stage costs more to build than a food stall, so
  // it costs more to maintain, same as a hilltop build already costs more
  // than a clearing build via TERRAIN_BUILD_MODIFIERS above.
  // Stage 19: raised 0.025 -> 0.07. At the old rate a fully built-out
  // grounds cost about $72/day to maintain against $8,000/day of revenue —
  // correctly implemented and economically invisible. See the cost-rescale
  // note on baseOverhead below.
  upkeepRate: 0.07,
  // Flat daily cost of running the grounds at all, independent of what's
  // built on them (gate staff, general insurance, etc). Stage 13 split
  // this out from the old `150 + stages*20` overhead formula — the
  // per-stage scaling term is now real per-plot upkeep instead.
  // Stage 19 cost rescale. This was 150 through Stage 18, against daily
  // revenue that routinely ran past $8,000 — which meant every cost
  // mechanic in the game (upkeep, escalating build cost, contract rates,
  // cancellation fees, the bankruptcy floor) was arithmetically real and
  // strategically irrelevant. A whole faire paid for itself in about one
  // day. Raising the flat nut is the single biggest lever on that, because
  // it is the one cost that lands whether or not the day goes well: it is
  // what makes a bad weekend actually hurt, and what makes "open the gates
  // on a thin lineup" a decision instead of free money.
  baseOverhead: 2200,
  // Stage 19: the cost of every guest who walks through the gate —
  // sanitation, water, waste haulage, gate and grounds staffing, the
  // insurance rider that's priced per head. This is the structural half of
  // the cost-rescale problem: baseOverhead alone is a fixed nut that a
  // growing faire simply outruns, so margin widened forever as attendance
  // climbed. A per-guest cost makes the ticket price a *margin* decision
  // instead of a pure revenue one — at the bottom of the slider the gate
  // barely clears what each guest costs to host, which is why cheap tickets
  // are a reputation play rather than a free lunch.
  perGuestCost: 5,
  // Stage 15: escalating build cost. Each additional *built* structure of
  // the same kind compounds the next one's price by this fraction — the
  // 1st stage prices at the terrain-adjusted base, the 2nd built stage
  // prices at base*(1+rate), the 3rd at base*(1+rate)^2, etc. Complements
  // Stage 13's upkeep (ongoing cost of what you already have) with
  // pressure at construction time (cost of getting more of the same
  // kind) — see engine.js's quoteBuild. Only *built* plots count, same
  // "not real until committed" rule upkeep already follows — laying out
  // several planning-status stalls doesn't escalate each other's price.
  escalatingBuildCostRate: 0.15,
  // Stage 16: win/loss conditions. If cash falls at or below this after a
  // day resolves, the faire is bankrupt and the run ends (see engine.js's
  // checkBankruptcy / state.js's runDay+nextDay). Deliberately well below
  // zero rather than exactly 0 — a single bad day dipping slightly
  // negative shouldn't end the run; sustained, serious insolvency should.
  bankruptcyFloor: -6000,
  // Reach the END of this weekend (i.e. season has advanced to at least
  // seasonTarget) with reputation and cash at least these values, and the
  // faire earns a one-time "Legendary Faire" milestone (see engine.js's
  // checkWinCondition) — celebratory, not a hard stop; the player
  // acknowledges it and keeps playing the same save afterward.
  winCondition: { seasonTarget: 6, minReputation: 70, minCash: 25000 },

  // Stage 19: ticket price elasticity. attendance scales by
  // clamp(1 - (price - anchor) / elasticityDivisor, floor, ceiling).
  // Through Stage 18 the divisor was a hardcoded 40, which made ticket
  // revenue `attendance x price` monotonically increasing all the way to
  // the top of the slider: the revenue curve peaked at exactly $28, the
  // max. "Set it to max on day one and never look at it again" was
  // strictly optimal, so the control wasn't a decision. A divisor of 22
  // moves the revenue peak to about $19 — mid-slider, so both directions
  // off the optimum cost you something.
  priceAnchor: 16,
  priceElasticityDivisor: 22,
  priceFactorFloor: 0.3,
  priceFactorCeiling: 1.5,
  // ...and gouging is separately unpopular. Every dollar above the anchor
  // costs this much crowd satisfaction (and so, downstream, reputation),
  // which is what turns pricing into a real cash-now-vs-standing-later
  // trade rather than a solvable arithmetic problem. Pricing BELOW the
  // anchor earns a smaller goodwill bonus back (see engine.js's
  // priceSatisfactionDelta) — a bargain faire is a beloved one.
  priceSatisfactionPenaltyPerDollar: 0.9,
  priceSatisfactionBonusPerDollar: 0.45,
};

// Stage 19: how much the *grounds themselves* pull a crowd.
//
// Through Stage 18 the attendance formula read reputation, ticket price,
// scheduled-performer popularity, and the active ad campaign — and never
// once looked at state.builtPlots. An empty field drew 386 guests at
// reputation 100; a two-stage faire with six headliners drew 703, and that
// entire difference was the performers. Everything shipped in Stages 12,
// 14, and 17 — footprints, path frontage, foot traffic, gate reachability —
// only ever re-sliced a crowd whose size the map had no vote in.
//
// This is the fix: built structures generate "draw points", diminishing via
// a square root so the tenth stall is worth much less than the second, and
// those points become a multiplier on attendance itself. It is what makes
// the site plan a growth engine rather than a seating chart, and it's the
// term that gives all the earlier siting work something to compound into.
export const GROUNDS_DRAW = {
  // Draw points per built structure, by kind. A stage is the reason people
  // come; stalls and demo camps are why they stay and tell a friend. Only
  // *built* plots count (planning ones aren't on the grounds yet), and a
  // stall only counts if a vendor is actually seated at it — an empty
  // shell draws nobody, which is the same rule simulateDay already uses
  // for stall revenue.
  points: { stage: 1.0, food: 0.5, vendor: 0.5, demo: 0.35 },
  // multiplier = clamp(floor + coefficient * sqrt(points), floor, ceiling).
  // Empty grounds sit at the floor: a field with a fence around it draws a
  // quarter of what its reputation alone would suggest, which is roughly
  // the "curious locals wandered by" number and nowhere near enough to
  // cover baseOverhead. The ceiling stops a sprawling grounds from
  // running away with the attendance formula.
  floor: 0.25,
  coefficient: 0.42,
  ceiling: 1.65,
};

// `heat` (Stage 19) is how much the sun is beating down during this block,
// 0-1. It weights how much a stage's *shade* matters to the crowd's comfort
// — see engine.js's blockQualityWeights. Before Stage 19, shade counted a
// flat 25% of a stage's quality in every block, which quietly capped
// satisfaction: TERRAIN_BASE makes sightline and shade anti-correlated (a
// hill is 0.92/0.15, woods is 0.50/0.88), so no terrain could ever score
// well on both terms at once and the top of the satisfaction range was
// unreachable. Making shade matter only when the sun is actually out turns
// that dead tradeoff into a live scheduling decision: a hilltop stage is
// magnificent at Morning Procession and Golden Hour and punishing at
// Afternoon, and a shaded grove stage is the reverse.
export const TIME_BLOCKS = [
  { id: 'morning', label: 'Morning Procession', weight: 0.9, heat: 0.15 },
  { id: 'midday', label: 'Midday', weight: 1.15, heat: 0.85 },
  { id: 'afternoon', label: 'Afternoon', weight: 1.2, heat: 1.0 },
  { id: 'golden', label: 'Golden Hour', weight: 0.85, heat: 0.25 },
];

// Stage 22: a per-weekendDay attendance multiplier, keyed by state.weekendDay
// (1=Fri, 2=Sat, 3=Sun — see state.js's createInitialState/nextDay). Through
// Stage 21, weekendDay was set, incremented, and shown in the HUD, and
// nothing else ever read it: simulateDay() stamped it on the result and
// stopped there, so Friday, Saturday, and Sunday were mechanically the same
// day three times despite the game being named for the shape a weekend has.
// This is that shape: a real faire's Saturday is the day whole families turn
// out, Friday is a workday for most of the shire, and Sunday eases off as
// the weekend winds down. It's also what gives the Weekend Package contract
// (data.js's CONTRACT_OPTIONS.weekend) a reason to exist beyond its flat 15%
// discount — a single day-rate hire is now a choice of WHICH day, not just
// whether to hire at all.
export const WEEKEND_DAY_ATTENDANCE = {
  1: 0.85, // Friday
  2: 1.2,  // Saturday — the big day
  3: 0.95, // Sunday
};

// ---------- weather (Phase 2: weather worth checking) ----------
// Through Phase 1 every day of the season had the same sun over it.
// TIME_BLOCKS authors a `heat` per block and nothing ever moved it, so
// Saturday of weekend 1 and Saturday of weekend 6 lit the grounds
// identically and the only reason to look at the sky was flavour text
// nobody had written. That is most of a weather system already built:
// blockQualityWeights spends `heat` properly (shade's weight is 0.25 x heat
// and whatever shade gives up rolls into sightline), so the missing piece
// is a table, one multiplier on that heat, and two multipliers on the day.
//
// Each row is four numbers and a name:
//   heatMult          scales the block's authored heat. Above 1 it pushes
//                     past what any block authors, which is the point --
//                     see WEATHER_SHADE_CEILING below.
//   attendanceMult    how many people turn out at all.
//   satisfactionDelta what the sky does to the crowd's mood before anything
//                     on the grounds gets a vote, in the same satisfaction
//                     points priceSatisfactionDelta returns.
//   early / late      the row's draw weight at weekend 1 and at weekend
//                     WEATHER_SEASON_SPAN, interpolated linearly in between
//                     by engine.js's weatherWeightAt.
//
// The early/late ramp is the season's shape, and it is the answer to "why
// is weekend 6 a different game from weekend 1". A Maryland-style faire
// opens in late August and closes in October: the season starts with
// scorchers and warm clear days and ends with overcast, drizzle, and the
// crisp blue October afternoon that is the best day of the year to be on a
// faire ground. Every row keeps a non-zero weight at both ends -- a
// downpour in weekend 1 is unlucky, not impossible -- so no row is ever
// unreachable and the ramp changes odds rather than gating content.
//
// Nothing here is logic: engine.js's rollWeather does the drawing and
// state.js stamps the result on the day. See CONFIG's habit of carrying the
// paragraph that explains the number next to the number.
export const WEATHER = [
  {
    id: 'scorcher',
    name: 'Scorching',
    note: 'The sun is merciless. Anything without a tree over it bakes, and plenty of folk stay home.',
    heatMult: 2.6, attendanceMult: 0.86, satisfactionDelta: -5,
    early: 5, late: 0.5,
  },
  {
    id: 'warm',
    name: 'Warm and clear',
    note: 'A proper faire day. Hot in the open at midday, but nobody is complaining.',
    heatMult: 1.4, attendanceMult: 1.06, satisfactionDelta: 2,
    early: 7, late: 2,
  },
  {
    id: 'fair',
    name: 'Fair',
    note: 'Ordinary weather doing nothing in particular. The blocks light the grounds exactly as authored.',
    heatMult: 1, attendanceMult: 1, satisfactionDelta: 0,
    early: 6, late: 5,
  },
  {
    id: 'overcast',
    name: 'Overcast',
    note: 'Flat grey light all day. Nobody wants shade; the long views carry every block.',
    heatMult: 0.55, attendanceMult: 0.97, satisfactionDelta: 0,
    early: 3, late: 6,
  },
  {
    id: 'crisp',
    name: 'Crisp and cool',
    note: 'The blue October afternoon everyone remembers. Cool enough to walk all day, and they do.',
    heatMult: 0.5, attendanceMult: 1.1, satisfactionDelta: 4,
    early: 1, late: 5,
  },
  {
    id: 'drizzle',
    name: 'Drizzle',
    note: 'Steady grey wet. The people who came are committed; the people who did not, are not.',
    heatMult: 0.35, attendanceMult: 0.8, satisfactionDelta: -4,
    early: 2, late: 5,
  },
  {
    id: 'downpour',
    name: 'Downpour',
    note: 'Rain off the tent edges in sheets. A day to get through rather than a day to earn on.',
    heatMult: 0.2, attendanceMult: 0.5, satisfactionDelta: -11,
    early: 0.5, late: 2.5,
  },
];

// How many weekends the early -> late weight ramp takes to run its full
// course. Six, because CONFIG.winCondition.seasonTarget is 6 and the ramp
// exists so that a run to the win condition is a run through a season
// rather than six copies of one weekend. Authored separately rather than
// read off winCondition so that retuning the win target does not silently
// restretch the weather; if they should move together, move them together.
export const WEATHER_SEASON_SPAN = 6;

// The most weight `shade` can ever take in blockQualityWeights, and so the
// one thing keeping that function's three weights non-negative and summing
// to 1 no matter what a WEATHER row multiplies the heat by. Past 0.5 the
// shade term outweighs sightline, which is exactly what a scorching
// afternoon is supposed to do to an open hilltop stage; the ceiling is what
// stops a future heatMult typo from driving the sightline weight negative
// and paying a stage for having no view at all. TIME_BLOCKS caps heat at
// 1.0 and the hottest authored row multiplies by 2.6, so the live maximum
// is 0.65 -- deliberately under this, so the ceiling is a guard rail rather
// than a number the balance is quietly leaning on. Move it if a hotter row
// is ever authored; do not move it to change the balance.
export const WEATHER_SHADE_CEILING = 0.7;

// The row anything unstamped falls back to: a state that predates this
// phase, an ad-hoc test fixture built from an object literal, or a save
// repaired on load. `fair` is neutral on all three multipliers, so falling
// back to it is exactly as invisible as WEEKEND_DAY_ATTENDANCE falling
// back to 1 for a state that never set weekendDay.
export const DEFAULT_WEATHER_ID = 'fair';

// ---------- guests (Phase 1: guests who walk) ----------
// Through Stage 22 the crowd was one number and every siting mechanic was a
// coefficient on averages of it. This table is the crowd as people: four
// archetypes, each a share of the gate, a needs vector and a purse, plus the
// tunables for the walk js/guests.js runs across the path network every
// block. Content only — the walk itself lives in guests.js.
//
// `sampleCap`: a Saturday with a full bill and a built-out grounds can put
// 3,000+ through the gate, and simulateDay is called 120 times per average
// in the SIGNIFICANCE checks alone. So the walk simulates at most this many
// agents and each stands for attendance / sampled people (`represents` on
// the report). 400 is enough that a single stall's arrival count is a real
// statistic (a 5% share is 20 agents, not 2) and small enough that a day
// costs milliseconds.
// `stepsPerBlock`: path-tile hops a guest can walk in one time block.
// Increment 1 set this to 12 and claimed it made the East Meadow an
// afternoon's commitment. Increment 2 measured it and it did not: at 12 a
// guest crosses the whole season-1 grounds inside one block, so walking is
// free, and a stall seven hops further out took the same money as one
// beside the show ($442 either way over 40 seeds). Every hop above 12 is
// East Meadow only, which is territory a player cannot build on until
// weekend 4. At 6 — half the grid's width, so crossing the grounds costs a
// block and crossing back costs another — the far stall drops to $351 and
// gate distance decides money again. Anything from 5 to 8 measures the
// same; the day's economy does not move at all between them, because the
// repeat penalty and not the clock is what caps a guest's arrivals. This
// is pinned by SIGNIFICANCE 9 in tests/smoke.mjs: put it back to 12 and
// that check fails (#230).
// `walkTolerance`: hops at which an attraction's pull is halved. Lower makes
// the crowd cling to the gate; higher makes distance irrelevant again.
// `satisfyRate`: the fraction of a need one arrival serves. 0.65 means a
// family that ate wants a second meal a third as much, so it heads for a
// show next instead of queueing at the same stall all day.
// `restThreshold`: below this pull a guest stays where it is for the block
// (sits on the grass). It is what an empty field does to a crowd.
// `shadeWeight`: how much a hot block bends a guest toward a shaded
// destination.
// `repeatPenalty`: the pull of a plot a guest has already been to, per
// visit. The same jouster twice is half the show, which is what sends the
// crowd on to the second stage and the far stall instead of parking it at
// whatever it reached first.
// `demoPull`: a demo camp's draw against a stage's. A stage with a
// popularity-8 act on it draws about 0.8; a falconer's camp is a smaller
// thing for most people and the thing a history buff came for (see the
// buff's `affinity`).
export const GUESTS = {
  sampleCap: 400,
  stepsPerBlock: 6,
  walkTolerance: 8,
  satisfyRate: 0.65,
  restThreshold: 0.04,
  shadeWeight: 0.6,
  repeatPenalty: 0.5,
  demoPull: 0.55,
  // `share` weights the spawn; the four sum to 1. `needs` are 0-1 pulls
  // toward food stalls, shows (stages and demo camps), shade and craft
  // stalls. `budget` is a purse in dollars, drawn uniformly. `affinity`
  // scales the pull of a specific attraction kind: history buffs cross the
  // grounds for a demo camp a family walks past, revellers for a stage.
  archetypes: [
    { id: 'family', label: 'Families', share: 0.35, needs: { food: 0.9, spectacle: 0.7, shade: 0.8, spend: 0.4 }, budget: [40, 70], affinity: { stage: 1.0, demo: 1.0, food: 1.2, vendor: 1.0 } },
    { id: 'reveller', label: 'Revellers', share: 0.25, needs: { food: 0.6, spectacle: 0.9, shade: 0.2, spend: 0.7 }, budget: [50, 90], affinity: { stage: 1.3, demo: 0.8, food: 1.0, vendor: 1.0 } },
    { id: 'buff', label: 'History buffs', share: 0.15, needs: { food: 0.4, spectacle: 0.8, shade: 0.4, spend: 0.5 }, budget: [30, 60], affinity: { stage: 0.9, demo: 2.0, food: 0.8, vendor: 1.3 } },
    { id: 'tripper', label: 'Day-trippers', share: 0.25, needs: { food: 0.7, spectacle: 0.5, shade: 0.5, spend: 0.3 }, budget: [20, 40], affinity: { stage: 1.0, demo: 0.7, food: 1.0, vendor: 0.8 } },
  ],
};

// ---------- faire grounds map ----------
// Stage 2: plots now sit on a real coordinate grid instead of carrying
// authored sightline/shade/traffic numbers. Those are *derived* in
// engine.js from (a) the terrain the plot sits on and (b) which other
// plots are built nearby — see engine.js computePlotAttributes(). This
// file stays data-only: the grid, a terrain legend, and per-terrain base
// modifiers are all just content.
//
// Stage 8: GRID is now the full authored terrain extent (the biggest the
// grounds ever get). The grounds a player can actually build on grow over
// time — see GRID_EXPANSIONS below and engine.js's currentGridSize(state).
// Keeping the whole terrain map authored up front (rather than generating
// new rows/cols on the fly) means terrainAt()/TERRAIN_ROWS stay simple,
// pure, and state-independent, same as every stage before this one — only
// the *bounds a build is allowed within* become state-aware.
export const GRID = { cols: 14, rows: 10 };

// One character per cell, legend below. The grounds are threaded by a real
// path *network*, not one line: the row-2 artery runs the full width, a
// north-south spur at col 3 drops off it ("Market Crossing" sits where
// they cross, at (3,2)), and a second north-south spur at col 10 (Stage 12)
// carries that same artery out east — with a short eastward connector
// along row 7 (cols 10-13) so the Stage 8 expansion territory (cols 10-13,
// rows 7-9) actually has path frontage to build against, instead of being
// stranded once unlocked. Columns 10-13 and rows 7-9 are that expansion
// territory — not buildable until unlocked (see GRID_EXPANSIONS), but
// authored now so the map never needs new terrain content generated later.
export const TERRAIN_ROWS = [
  'CCHHHHCCWWWWCC',
  'CCHHHHCCWWWWCC',
  'PPPPPPPPPPPPPP',
  'CCCCCCCCWWPHCC',
  'CWWPWWCCWWPHCC',
  'CWWPWWCCCCPWCC',
  'CCCPCCCCCCPWCC',
  'CCCPCCCCCCPPPP',
  'HHHPHHCCWWPWCC',
  'CCCPCCCCCCPCCC',
];

export const TERRAIN_LEGEND = { C: 'clearing', H: 'hill', W: 'woods', P: 'path' };

// Stage 17: the front gate — where every guest's walk across the grounds
// starts. Sits on the row-2 artery's western end, the only edge of the path
// network that has been on the map since Stage 1 (the row-2 artery has
// always run the full authored width). Authored here as data, read by
// engine.js's path-distance BFS — never moves on its own, but living as a
// named constant (not a magic literal in engine.js) means a future stage
// could relocate it, or add a second gate, without touching the BFS logic.
export const ENTRANCE = { x: 0, y: 2 };

// How much of the authored TERRAIN_ROWS grid is actually buildable right
// now. Each entry is a hard fence line at (cols, rows) — everything inside
// it is fair game, everything outside is "past the fence" until the
// player reaches `unlockSeason` (a weekend number, same field/meaning as
// AD_CAMPAIGNS/CONTRACT_OPTIONS use it). Must be sorted ascending by
// unlockSeason, and the first entry MUST be { unlockSeason: 1, cols: 10,
// rows: 7 } — that's the exact Stage 1-7 footprint, so an existing save
// (or a fresh one) at Weekend 1 sees precisely the grounds it always has.
export const GRID_EXPANSIONS = [
  { unlockSeason: 1, cols: 10, rows: 7, label: 'Home Grounds' },
  { unlockSeason: 2, cols: 12, rows: 8, label: 'East Meadow' },
  { unlockSeason: 4, cols: 14, rows: 10, label: 'Deep Woods Trail' },
];

// Base sightline/shade/traffic for a plot sitting on each terrain type,
// before any adjacency effects from nearby built plots are applied.
export const TERRAIN_BASE = {
  clearing: { sightline: 0.7, shade: 0.3, traffic: 0.55 },
  hill: { sightline: 0.92, shade: 0.15, traffic: 0.4 },
  woods: { sightline: 0.5, shade: 0.88, traffic: 0.3 },
  path: { sightline: 0.55, shade: 0.12, traffic: 0.92 },
};

// Buildable structure kinds. Stage 1/2 offered 9 pre-surveyed named plots;
// Stage 3 lets the player build any of these four kinds on any open grid
// cell, so this is now a small catalog of *kinds*, not specific sites.
// `baseCapacity` only applies to stage (the only kind with an attendance cap).
// `footprint` (Stage 12): how many grid cells a built structure actually
// occupies, anchored at its (x,y). A stage is a real show site — trussing,
// backstage curtain, a crowd apron — so it spans 2x2 instead of the single
// cell every other kind still uses; that size difference is now load-
// bearing (it eats more of the grounds, is harder to fit a path-frontage
// requirement against, and collides with more neighbors for the stage-
// spacing rule below). Any kind without an explicit `footprint` defaults to
// 1x1 via engine.js's footprintFor().
export const STRUCTURE_TYPES = {
  stage: { label: 'Stage', icon: '\u{1F3AD}', baseCost: 1700, baseCapacity: 150, footprint: { w: 2, h: 2 } },
  food: { label: 'Food Stall', icon: '\u{1F357}', baseCost: 950 },
  vendor: { label: 'Craft Stall', icon: '\u{1F6D2}', baseCost: 950 },
  demo: { label: 'Demo Camp', icon: '\u{1F985}', baseCost: 700 },
};

// Per-terrain multipliers applied when a structure is actually built there.
// Clearing is the baseline (1.0x): hills cost more to grade, woods cost more
// to clear, and a path build disrupts foot traffic while it's underway —
// but a finished stage on a hill or path also seats more people than one
// squeezed into the woods, hence capacityMult.
export const TERRAIN_BUILD_MODIFIERS = {
  clearing: { costMult: 1.0, capacityMult: 1.0 },
  hill: { costMult: 1.25, capacityMult: 0.95 },
  woods: { costMult: 1.2, capacityMult: 0.85 },
  path: { costMult: 1.1, capacityMult: 1.15 },
};

// Auto-naming for a plot at build time: `${TERRAIN_NAME[terrain]}
// ${KIND_NOUN[kind]}`, e.g. a stage built on a hill becomes "Hilltop Stage".
export const TERRAIN_NAME = { clearing: 'Green', hill: 'Hilltop', woods: 'Grove', path: 'Crossing' };
export const KIND_NOUN = { stage: 'Stage', food: 'Stall', vendor: 'Bazaar', demo: 'Camp' };

// Stage 11: build-time legality rules. Terrain/kind combos and structure
// spacing that are refused outright at place/move/relocate time, on top of
// (not instead of) the cost/capacity terrain modifiers above and the
// adjacency sightline/traffic math in engine.js's computePlotAttributes.
// Deliberately small and data-only, same pattern as TERRAIN_BUILD_MODIFIERS,
// so a future stage can extend either list without touching engine logic.
//
// Stage 18 extends this same data-only pattern three ways (all three were
// standing "not yet requested" options since Stage 11/12): a terrain ban for
// stalls (not just stage/demo), same-kind stall spacing, and a demo camp
// cap. None of the three needed a single new field on a saved plot, and
// engine.js's isLegalPlacement reads all of it generically — see the
// comments there.
export const PLACEMENT_RULES = {
  // Kinds that refuse to be built on a given terrain outright.
  // - A stage or demo camp squarely blocking the one thoroughfare through
  //   the grounds isn't a cost tradeoff, it's just not allowed; a food/craft
  //   stall is still fine on the path (roadside stalls are exactly what a
  //   real faire's path is lined with).
  // - Stage 18: a food or craft stall also can't be built on a hill — a
  //   cart-based stall needs level ground to wheel in and set up on, unlike
  //   a stage (which already treats hill as its BEST terrain, highest
  //   sightline and a capacityMult bonus) or a demo camp (a fixed
  //   living-history/falconer site, not a cart). This is the first terrain
  //   ban that isn't about the path, and the first time hill and path
  //   aren't just "cost more/less" — a hill is now stage/demo-only ground,
  //   the path is stage/demo-*excluded* ground, and clearing/woods stay
  //   open to everything.
  terrainBans: {
    stage: ['path'],
    demo: ['path'],
    food: ['hill'],
    vendor: ['hill'],
  },
  // Minimum Chebyshev (king-move) distance required between two stages,
  // built or still-planning — 1 means two stages can't sit directly
  // touching (including diagonally). Checked cell-to-cell across each
  // stage's full 2x2 footprint (Stage 12), not just anchor-to-anchor. This
  // is a hard floor underneath the existing soft sightline penalty
  // (ADJACENCY_RADIUS=2 in engine.js), which still applies on top of it for
  // anything farther than this.
  minStageSpacing: 1,
  // Stage 18: which kinds get a same-kind spacing floor, and how much. Only
  // between two stalls of the SAME kind (two food stalls, or two craft
  // stalls) — a food stall right beside a craft stall is still fine and
  // even desirable (that's a real food-court/market-row layout); the point
  // is to stop five identical carts from walling off one corner of the
  // grounds, not to break up variety. Same 1-cell-touching floor as
  // minStageSpacing, checked the same footprint-cell-to-footprint-cell way
  // (stalls are 1x1, so today this is just cell-to-cell, but it stays
  // footprint-correct if a stall footprint ever grows).
  stallSpacingKinds: ['food', 'vendor'],
  minStallSpacing: 1,
  // Stage 18: a hard cap on how many of a kind can be built (or still
  // planned) at once. A demo camp is a living-history reenactor or a
  // falconer's mews — a real person/animal on site, not a purchased
  // structure — so the faire only has so many to field regardless of how
  // much room is left on the grounds. Keyed by kind so a future stage can
  // cap something else the same way without a new code path.
  maxBuiltByKind: { demo: 3 },
  // Stage 12: "build along the paths" — every buildable kind needs at
  // least one cell of its footprint sitting ON a path (food/craft/demo can
  // straddle one) or directly beside one (orthogonal neighbor only, not
  // diagonal). A stage/demo can never sit ON the path (see terrainBans
  // above), so for those two this only ever resolves via the "beside"
  // half of the check. Kept as an explicit kind list rather than a bare
  // boolean so a future stage could exempt one kind without touching
  // engine.js's hasPathFrontage().
  requiresPathFrontage: ['stage', 'food', 'vendor', 'demo'],
};

// Marketing/advertising campaigns (Stage 4). Only one campaign can be
// running at a time — launching one costs cash up front, its
// `attendanceMult` applies to attendance for `durationDays`, and once it
// ends that specific campaign can't be relaunched until `cooldownDays` have
// passed. Deliberately non-stacking: there is no way to have two campaigns'
// multipliers apply on the same day, which keeps the attendance formula in
// engine.js simple (one multiplier, or none).
// `unlockSeason` (Stage 6) gates a campaign behind reaching that weekend
// number (state.season) — 1 means available from the very first weekend.
export const AD_CAMPAIGNS = [
  { id: 'ad_flyers', name: 'Flyer Run', desc: 'A few riders post bills in the nearest towns. Cheap, quick, modest.', cost: 300, attendanceMult: 1.08, durationDays: 1, cooldownDays: 1, unlockSeason: 1 },
  { id: 'ad_crier', name: 'Town Crier', desc: 'A hired crier works the market squares for days on end.', cost: 700, attendanceMult: 1.16, durationDays: 2, cooldownDays: 2, unlockSeason: 1 },
  { id: 'ad_broadside', name: 'Regional Broadside', desc: 'Printed notices carried by wagon to every shire nearby.', cost: 1380, attendanceMult: 1.28, durationDays: 3, cooldownDays: 4, unlockSeason: 1 },
  { id: 'ad_proclamation', name: 'Kingdom Proclamation', desc: 'A royal proclamation read at every market cross in the shire. Slow to arrange, hard to beat.', cost: 2250, attendanceMult: 1.4, durationDays: 3, cooldownDays: 6, unlockSeason: 2 },
];

// Contract types for performers (Stage 5) — and, as of Stage 7, vendors
// too (see engine.js's effectiveVendorCost / state.js's hireVendor). `open`
// is the no-commitment day rate — pay the listed cost, release anytime for
// free (this was the only option through Stage 4). `weekend` locks the
// contractee in for `commitDays` at a discount off the listed rate;
// releasing early, before the commitment runs out, costs a cancellation fee
// (cancelFeeMult \u00d7 dailyCost \u00d7 days still owed on the commitment).
// `season` (Stage 6) is a longer, deeper-discount commitment spanning two
// full weekends, gated behind `unlockSeason` the same way AD_CAMPAIGNS are.
// Kept as one shared catalog rather than a duplicated vendor-only copy —
// performers and vendors are contracted via the exact same deal shapes.
export const CONTRACT_OPTIONS = {
  open: { id: 'open', label: 'Day Rate', priceMult: 1.0, commitDays: 0, cancelFeeMult: 0, unlockSeason: 1 },
  weekend: { id: 'weekend', label: 'Weekend Package', priceMult: 0.85, commitDays: 3, cancelFeeMult: 0.5, unlockSeason: 1 },
  season: { id: 'season', label: 'Season Contract', priceMult: 0.72, commitDays: 6, cancelFeeMult: 0.6, unlockSeason: 3 },
};

// Performer pool. `quirk` is a small effect tag the engine looks up by id —
// see engine.js QUIRKS for what each one actually does.
export const PERFORMERS = [
  { id: 'perf_jouster_1', name: 'Sir Corwin the Unhorsed', role: 'jouster', cost: 650, popularity: 8, quirk: 'crowd_pleaser' },
  { id: 'perf_jouster_2', name: "Dame Ysolde Ironback", role: 'jouster', cost: 750, popularity: 9, quirk: 'prima_donna' },
  { id: 'perf_musician_1', name: 'The Tumbledown Consort', role: 'musician', cost: 375, popularity: 5, quirk: null },
  { id: 'perf_musician_2', name: 'Fenwick Loudlyre', role: 'musician', cost: 475, popularity: 6, quirk: 'crowd_pleaser' },
  { id: 'perf_jester_1', name: 'Piccolo the Contrary', role: 'jester', cost: 350, popularity: 6, quirk: 'chaos_prone' },
  { id: 'perf_jester_2', name: 'Old Nettle', role: 'jester', cost: 275, popularity: 4, quirk: null },
  { id: 'perf_magician_1', name: 'Master Aldric of the Hollow', role: 'magician', cost: 550, popularity: 7, quirk: 'prima_donna' },
  { id: 'perf_livinghist_1', name: 'The Cooper\u2019s Guild Camp', role: 'livingHistory', cost: 225, popularity: 3, quirk: null },
  { id: 'perf_livinghist_2', name: "The Physick's Tent", role: 'livingHistory', cost: 250, popularity: 3, quirk: 'crowd_pleaser' },
  { id: 'perf_falconer_1', name: 'Wren of the Mews', role: 'falconer', cost: 425, popularity: 6, quirk: null },
  // Stage 9 additions — content-pool filler, plus two `night_owl` holders
  // (see engine.js QUIRKS.night_owl / effectivePopularity) so a Golden
  // Hour-favoring lineup is an actual choice a player can build toward.
  { id: 'perf_musician_3', name: 'Rosalind Quicksilver', role: 'musician', cost: 440, popularity: 6, quirk: 'night_owl' },
  { id: 'perf_magician_2', name: 'Vesper Nightshade', role: 'magician', cost: 600, popularity: 7, quirk: 'night_owl' },
  { id: 'perf_jester_3', name: 'Bramblewit', role: 'jester', cost: 300, popularity: 5, quirk: null },
  { id: 'perf_falconer_2', name: 'Talon of the Greenwood', role: 'falconer', cost: 475, popularity: 6, quirk: 'crowd_pleaser' },
  { id: 'perf_livinghist_3', name: "The Chandler\u2019s Row", role: 'livingHistory', cost: 210, popularity: 3, quirk: null },
];

// Vendor pool (food + craft). The house keeps CONFIG.wristbandCut of a
// stall's gross and the vendor keeps the rest; `cost` is what the house
// pays to have them on the grounds for the weekend. (This comment used to
// describe a `takeRate` field and a quality modulation, neither of which
// has ever existed on a vendor record or been read anywhere.)
export const VENDORS = [
  { id: 'vend_turkeyleg', name: 'Giant Turkey Legs', type: 'food', cost: 300, quality: 7, avgTicket: 11 },
  { id: 'vend_piepeddler', name: 'The Pie Peddler', type: 'food', cost: 225, quality: 6, avgTicket: 8 },
  { id: 'vend_cider', name: "Hollow Barrel Cider", type: 'food', cost: 250, quality: 8, avgTicket: 9 },
  { id: 'vend_stew', name: 'Widow\u2019s Kettle Stew', type: 'food', cost: 200, quality: 5, avgTicket: 7 },
  { id: 'vend_leather', name: 'Blackthorn Leatherworks', type: 'craft', cost: 150, quality: 7, avgTicket: 22 },
  { id: 'vend_glass', name: "Gaffer's Glass", type: 'craft', cost: 175, quality: 8, avgTicket: 30 },
  { id: 'vend_blades', name: 'Ravensmoor Blades', type: 'craft', cost: 225, quality: 6, avgTicket: 40 },
  { id: 'vend_trinkets', name: 'Pixie & Pauper Trinkets', type: 'craft', cost: 100, quality: 5, avgTicket: 12 },
  // Stage 9 additions — content-pool filler, same shape as the original 8.
  { id: 'vend_mead', name: "Meadow\u2019s Gold Mead", type: 'food', cost: 240, quality: 7, avgTicket: 10 },
  { id: 'vend_pretzel', name: 'Twisted Bread Cart', type: 'food', cost: 175, quality: 6, avgTicket: 6 },
  { id: 'vend_woodcarve', name: 'Oakenshield Woodcarving', type: 'craft', cost: 140, quality: 6, avgTicket: 18 },
  { id: 'vend_herbalist', name: "The Herbwife\u2019s Basket", type: 'craft', cost: 110, quality: 7, avgTicket: 15 },
];

// Random event pool. Each entry has a `weight` (relative chance per day),
// an optional `requires` predicate (state) => bool, and an `effect`
// (state, rng) => { cashDelta, repDelta, satisfactionDelta, message }.
// Kept data-only where possible; engine.js interprets the string effect ids.
export const EVENT_POOL = [
  { id: 'evt_perfect_weather', weight: 3, effectId: 'perfect_weather' },
  { id: 'evt_dropped_prop', weight: 2, effectId: 'dropped_prop_recovery' },
  { id: 'evt_wagon_wheel', weight: 2, effectId: 'broken_wagon_wheel' },
  { id: 'evt_noble_visit', weight: 1, effectId: 'noble_visit' },
  { id: 'evt_rowdy_crowd', weight: 2, effectId: 'rowdy_crowd', requires: 'hasChaosProne' },
  { id: 'evt_sellout_stall', weight: 2, effectId: 'sellout_stall', requires: 'hasVendor' },
  // Stage 9 additions — "backstage drama" events, gated on roster
  // composition rather than a single quirk/vendor flag. See engine.js's
  // EVENT_REQUIREMENTS for what each `requires` string actually checks.
  { id: 'evt_diva_standoff', weight: 2, effectId: 'diva_standoff', requires: 'hasMultiplePrimaDonnas' },
  { id: 'evt_musicians_jam', weight: 2, effectId: 'musicians_jam', requires: 'hasTwoMusicians' },
  { id: 'evt_falconer_show', weight: 2, effectId: 'falconer_show', requires: 'hasFalconerScheduled' },
  { id: 'evt_gossip_wagon', weight: 1, effectId: 'gossip_wagon', requires: 'bigRoster' },
  // Phase 3 additions — gated on how the acts feel about the house rather
  // than on who is on the bill. `hasDevotedAct` is any contracted performer
  // or vendor at or above RELATIONSHIP.devotedAt; `hasSourAct` is any one at
  // or below RELATIONSHIP.sourAt. Both go through EVENT_REQUIREMENTS, which
  // fails closed on a key it does not know, so a typo here makes the event
  // ineligible rather than always-eligible.
  { id: 'evt_encore', weight: 2, effectId: 'encore', requires: 'hasDevotedAct' },
  { id: 'evt_late_call', weight: 2, effectId: 'late_call', requires: 'hasSourAct' },
];

// ---------- Phase 3: acts with a story ----------
// A relationship number per contracted performer and vendor, 0-100, starting
// at `neutral` the day they sign and moved by what the day did to them. The
// deltas are small on purpose: a run of good days is what earns a Devoted
// act, not one good Saturday. The number itself lives in
// state.relationships[id]; nothing here is read for an act that is not
// contracted, and releasing one forgets it (#235).
//
// What moves it, per day:
//   performers — `onBill` for playing at all, `bestBlock` on top when the
//   block is the one they draw best in (engine.js's bestBlockFor), `offBill`
//   for a contracted act nobody scheduled, `sulked` for a prima donna who
//   shared a bill with an equal, `packedHouse` when their stage overflowed
//   (the crowd hated it, the act loved it — that tension is the point).
//   vendors — `soldWell` for a seated stall that took money, `soldNothing`
//   for a seated one nobody bought from, `unseated` for a hired vendor
//   standing about earning nothing.
// The tiers are what Backstage shows and what the arcs and the two gated
// events read; `devotedAt`/`sourAt` are the two edges that mean something.
export const RELATIONSHIP = {
  neutral: 50, min: 0, max: 100,
  onBill: 1, bestBlock: 3, offBill: -3, sulked: -4, packedHouse: 2,
  soldWell: 2, soldNothing: -3, unseated: -4,
  devotedAt: 80, sourAt: 20,
  tiers: [
    { id: 'devoted', label: 'Devoted', min: 80, note: 'Would follow you to another shire. Asks less, gives more.' },
    { id: 'warm', label: 'Warm', min: 65, note: 'Glad to be here.' },
    { id: 'settled', label: 'Settled', min: 36, note: 'A working arrangement, nothing more.' },
    { id: 'cool', label: 'Cool', min: 21, note: 'Counting the days on the contract.' },
    { id: 'sour', label: 'Sour', min: 0, note: 'One more bad day from walking. Asks more, gives less.' },
  ],
};

// Negotiation. CONTRACT_OPTIONS stays as the three quick picks, but every
// contract in the game is now priced through one quote (engine.js's
// quoteContract): listed rate x an arc's rate multiplier x the terms'
// discount x the relationship's swing. A counter-offer picks a commitment
// length and a cancellation fee off these two lists and the act names its
// price for that pair. The discounts are tuned so a neutral act's asking
// rate for "the weekend, half the days owed" lands within a dollar or two
// of the Weekend Package (0.84 against 0.85) and "two weekends, every day
// owed" near the Season Contract (0.70 against 0.72): the quick picks are
// honest points on the same grid, not a second price list.
//
// `relationshipSwing` is how far the act's ask moves at either end: a
// Devoted act (100) asks 15% under what a stranger would, a Sour one (0)
// asks 15% over. A cancellation fee only earns a discount when there are
// days to owe it on — a fee on a day rate is nothing, and is priced as such.
export const NEGOTIATION = {
  commitments: [
    { days: 0, label: 'Day to day', discount: 0, unlockSeason: 1 },
    { days: 3, label: 'The weekend', discount: 0.12, unlockSeason: 1 },
    { days: 6, label: 'Two weekends', discount: 0.22, unlockSeason: 3 },
  ],
  cancelFees: [
    { mult: 0, label: 'No fee', discount: 0 },
    { mult: 0.5, label: 'Half the days owed', discount: 0.04 },
    { mult: 1, label: 'Every day owed', discount: 0.08 },
  ],
  relationshipSwing: 0.15,
  floorMult: 0.5, // no ask ever goes below half the listed rate, whatever stacks
};

// Arcs. Each is a subject (a performer or vendor id) and its beats. A beat
// unlocks when the subject is contracted and its relationship tier is the
// one `when` names ('devoted' or 'sour'), fires once per save (resolved
// beats are remembered in state.arcBeats by choice), and offers two or
// three choices. A choice is a set of numbers: `cash` moves the ledger,
// `relationship` moves the number that unlocked it, `popularity` (performer)
// or `quality` (vendor) moves the act's own record for the rest of the
// save, `rateMult` re-prices their standing contract and every future one,
// and `quirk` sets a quirk id or, as null, sheds whatever they had. A key
// that is absent leaves that number alone; engine.js's applyBeatChoice is
// the one place these are read.
export const ARCS = [
  { id: 'arc_ysolde', subject: 'perf_jouster_2', beats: [
    { id: 'ysolde_sour', when: 'sour', title: 'Dame Ysolde has her armour packed',
      text: 'She has spent too many afternoons sharing a bill with someone the crowd liked as well, and the Ironback does not share. Her squire says she has a standing offer from the faire two shires over.',
      choices: [
        { id: 'purse', label: 'A purse and a public apology ($400)', cash: -400, relationship: 25, note: 'Costly, but she stays and her pride is mended.' },
        { id: 'headline', label: 'Promise her the afternoon, alone', relationship: 15, quirk: null, popularity: -1, note: 'She sheds the sulking, and some of the fire that came with it.' },
        { id: 'let_go', label: 'Let her pack', relationship: -10, note: 'Nothing changes but the mood. She will not forget.' },
      ] },
    { id: 'ysolde_devoted', when: 'devoted', title: 'The Ironback rides for the house',
      text: 'Ysolde has taken to riding the length of the grounds before the gates open, saluting the stalls. The vendors love it. She wants to know if the house does.',
      choices: [
        { id: 'champion', label: 'Name her Champion of the Faire', popularity: 1, rateMult: 1.15, relationship: 5, note: 'A bigger draw, at a bigger rate.' },
        { id: 'thanks', label: 'Thank her, and leave the contract alone', relationship: 2, note: 'She shrugs. The ride continues.' },
      ] },
  ] },
  { id: 'arc_corwin', subject: 'perf_jouster_1', beats: [
    { id: 'corwin_sour', when: 'sour', title: 'Sir Corwin has stopped falling off',
      text: 'The Unhorsed is unhorsed for a living, and a man left off the bill for days on end starts to wonder what the joke is. He asks, politely, whether he is wanted.',
      choices: [
        { id: 'bill', label: 'Swear he rides tomorrow, and pay a day in advance', cash: -650, relationship: 20, note: 'The advance is his usual rate, and it lands.' },
        { id: 'shrug', label: 'Tell him rides are earned', relationship: -5, quirk: null, note: 'He stops playing to the crowd. The crowd notices.' },
      ] },
    { id: 'corwin_devoted', when: 'devoted', title: 'Sir Corwin teaches the children to fall',
      text: 'He has started a half-hour before his tilts where the small ones learn to tumble off a barrel. It costs him nothing and the parents stay for the joust.',
      choices: [
        { id: 'bless', label: 'Bless it, and pay for the barrels ($150)', cash: -150, popularity: 1, relationship: 5, note: 'A bigger draw for the price of some barrels.' },
        { id: 'quiet', label: 'Let it be, unofficially', relationship: 1, note: 'It goes on. Nobody writes it down.' },
      ] },
  ] },
  { id: 'arc_aldric', subject: 'perf_magician_1', beats: [
    { id: 'aldric_sour', when: 'sour', title: 'Master Aldric will not share a stage with a lute',
      text: 'He has been sulking through his own sets. He names his terms: the Golden Hour to himself, or a rate that makes the sharing worth it.',
      choices: [
        { id: 'raise', label: 'Raise his rate a fifth', rateMult: 1.2, relationship: 20, note: 'He is mollified. Expensively.' },
        { id: 'humble', label: 'Tell him the crowd is the judge', relationship: 5, quirk: null, popularity: -1, note: 'He sheds the sulk, and a little of the mystique.' },
      ] },
    { id: 'aldric_devoted', when: 'devoted', title: 'Master Aldric offers the Hollow\u2019s trick',
      text: 'There is an illusion he has never done outside the Hollow. He would do it here, once a day, at dusk, if the house will let him keep the evening.',
      choices: [
        { id: 'dusk', label: 'Give him dusk', popularity: 2, quirk: 'night_owl', relationship: 5, note: 'He becomes a Golden Hour act, and a bigger one.' },
        { id: 'decline', label: 'The schedule is the schedule', relationship: -3, note: 'The trick stays in the Hollow.' },
      ] },
  ] },
  { id: 'arc_piccolo', subject: 'perf_jester_1', beats: [
    { id: 'piccolo_sour', when: 'sour', title: 'Piccolo is being contrary on purpose now',
      text: 'The rowdiness was always half the act. Left idle, he has been starting it in the crowd instead of on the stage, and a stall rail is down.',
      choices: [
        { id: 'leash', label: 'Put him on the bill and pay for the rail ($120)', cash: -120, relationship: 15, note: 'He is happier working.' },
        { id: 'tame', label: 'Tell him one more rail and he walks', quirk: null, relationship: 5, note: 'He stops the chaos. It was most of the fun.' },
      ] },
    { id: 'piccolo_devoted', when: 'devoted', title: 'Piccolo has written a play about the house',
      text: 'It is unkind, extremely funny, and the crowd will love it. He would like to stage it.',
      choices: [
        { id: 'stage', label: 'Stage it', popularity: 2, relationship: 5, note: 'He becomes the act people come back for.' },
        { id: 'forbid', label: 'Forbid it', relationship: -15, note: 'He performs it anyway, elsewhere, about you.' },
      ] },
  ] },
  { id: 'arc_wren', subject: 'perf_falconer_1', beats: [
    { id: 'wren_sour', when: 'sour', title: 'The mews are going hungry',
      text: 'Wren keeps the birds on her own coin, and a falconer left off the bill is a falconer buying meat with nothing coming in. She asks for a lodging allowance.',
      choices: [
        { id: 'allowance', label: 'Grant it ($250)', cash: -250, relationship: 20, note: 'The birds eat. She stays.' },
        { id: 'refuse', label: 'Refuse', relationship: -10, popularity: -1, note: 'One of the hawks is sold.' },
      ] },
    { id: 'wren_devoted', when: 'devoted', title: 'Wren offers a second flight',
      text: 'She has trained a young goshawk to work the crowd rather than the lure. Two birds, one show, if the house will underwrite the hood and jesses.',
      choices: [
        { id: 'fund', label: 'Fund the second bird ($300)', cash: -300, popularity: 2, quirk: 'crowd_pleaser', relationship: 5, note: 'A bigger show, and one that plays to the crowd.' },
        { id: 'one_bird', label: 'One bird is plenty', relationship: 0, note: 'The goshawk goes back to the lure.' },
      ] },
  ] },
  { id: 'arc_fenwick', subject: 'perf_musician_2', beats: [
    { id: 'fenwick_sour', when: 'sour', title: 'Fenwick has gone quiet',
      text: 'Loudlyre is not loud. He plays the morning to nobody and packs up early. He asks, once, whether the house wants a musician or a name on a bill.',
      choices: [
        { id: 'afternoon', label: 'Swear him a real slot and stand him a round ($80)', cash: -80, relationship: 20, note: 'He tunes up.' },
        { id: 'ignore', label: 'Leave him to it', relationship: -5, note: 'The lyre stays quiet.' },
      ] },
    { id: 'fenwick_devoted', when: 'devoted', title: 'Fenwick wants the whole consort',
      text: 'He has been drilling three players from the shire on his own time. Four instruments, one rate and a half.',
      choices: [
        { id: 'consort', label: 'Hire the consort', popularity: 2, rateMult: 1.5, relationship: 5, note: 'A much bigger act at a much bigger rate.' },
        { id: 'solo', label: 'Keep him solo', relationship: 0, note: 'The players go home. He does not mind.' },
      ] },
  ] },
  { id: 'arc_turkeyleg', subject: 'vend_turkeyleg', beats: [
    { id: 'turkeyleg_sour', when: 'sour', title: 'The turkey legs are going cold',
      text: 'Nobody is walking past the stall, and a legful of meat unsold at close is money burned. The cook wants a better pitch or a lower cut.',
      choices: [
        { id: 'cut', label: 'Take a smaller cut for a while ($200 back to them)', cash: -200, relationship: 20, note: 'They stay on, and the pit fires up.' },
        { id: 'no', label: 'A pitch is a pitch', relationship: -10, quality: -1, note: 'The legs get smaller.' },
      ] },
    { id: 'turkeyleg_devoted', when: 'devoted', title: 'The cook wants a second pit',
      text: 'The stall sells out most days. A second pit means double the legs and a line that moves.',
      choices: [
        { id: 'pit', label: 'Pay for the pit ($350)', cash: -350, quality: 2, relationship: 5, note: 'A better stall, for good.' },
        { id: 'one_pit', label: 'One pit is fine', relationship: 0, note: 'The line stays long.' },
      ] },
  ] },
  { id: 'arc_glass', subject: 'vend_glass', beats: [
    { id: 'glass_sour', when: 'sour', title: 'Gaffer\u2019s Glass is packing the kiln',
      text: 'Glass is slow to make and slow to sell, and a gaffer who has stood a whole weekend without a sale is a gaffer with a wagon half-loaded already.',
      choices: [
        { id: 'buy', label: 'Buy a set for the house ($300)', cash: -300, relationship: 20, note: 'The wagon is unloaded.' },
        { id: 'let', label: 'Wish them luck', relationship: -10, quality: -1, note: 'The best pieces go with them.' },
      ] },
    { id: 'glass_devoted', when: 'devoted', title: 'The gaffer offers to blow glass in the open',
      text: 'A demonstration at the stall itself, molten and dangerous and very hard to walk past. It needs a rail and a bucket.',
      choices: [
        { id: 'rail', label: 'Build the rail ($180)', cash: -180, quality: 2, relationship: 5, note: 'The stall becomes a show.' },
        { id: 'no_fire', label: 'Not near the thatch', relationship: -3, note: 'The kiln stays shut.' },
      ] },
  ] },
];
