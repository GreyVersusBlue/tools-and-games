# Closing Time

A browser-based real estate agent career sim. You start as a Rookie Agent in Alder Falls with a fresh license and no reputation, and build a career across two intertwined modes: representing buyers and representing sellers. Grounded, a little wry, systems-rich.

## Run it

No build step. Static files only.

- **GitHub Pages:** push the repo, enable Pages, done.
- **Locally:** `python3 -m http.server` in the repo root, then open http://localhost:8000. (Opening `index.html` directly from disk won't work — the engine loads `/data` via `fetch`.)

Saves persist in `localStorage` (`closingTime.save.v1`). "New career" in the footer wipes the save.

## How to play (short version)

- Each day has **4 action slots** (●). Showings, intakes, schmoozing, offer paperwork each cost one; an **open house consumes the whole day** and can only run on weekends. Bank-side milestones (appraisal, financing) only land on weekdays.
- **Buyer mode:** meet a client → browse the MLS Board with their "client lens" on (live fit score) → show houses → ask the listing agent pointed questions (2 per showing) or order a $450 inspection → disclose what you know (or don't — see reputation) → write an offer → negotiate with a named rival agent → survive inspection/appraisal/financing contingencies → close.
- **Seller mode:** take the listing → walkthrough, recommend repairs and disclosures, pick staging/photos, set a price against the modeled value → go live → interest accrues daily → NPC agents submit offers with deadlines → advise your seller (who has their own hidden psychology) → host open houses → close from the other side of the table.
- **Hidden information is the game.** Clients have hidden preferences/dealbreakers that surface through viewings, the right questions, and schmoozing. Listings have hidden issues in three severity tiers (cosmetic / moderate / dealbreaker), discovered visibly, by question topic, or only via inspection. Sitting on a disclosure-required issue you knew about will eventually detonate.
- **Reputation** (word of mouth) is separate from **XP** (career ladder). Satisfied closings generate **referrals** — new clients who name the past client that sent them. Rivals poach, brokerages recruit, rates drift, neighborhoods trend, and your **local market knowledge** per neighborhood sharpens your valuations and negotiating odds.

## Architecture

```
index.html
css/style.css
js/
  main.js            bootstrap: load content, resume or start
  data.js            content loader (manifest-driven)
  state.js           game state, save/load, career ladder, RNG
  ui.js              all rendering + interaction flows
  engine/
    calendar.js      day advancement, milestones, deadlines, weekly ticks
    market.js        rates, seasons, neighborhood drift, valuation
    clients.js       intake, fit scoring, hidden-pref reveals, patience, referrals
    deals.js         buyer-side: viewings, offers, NPC negotiation, contingencies, closing
    seller.js        listing-side: prep, marketing, NPC offers, open houses, closing
    events.js        data-driven event system (weighted draws + effect handlers)
    marketFacade.js  re-exports for the UI
data/                ALL game content — see schemas below
tools/
  seed_data.py       regenerates the initial content set (optional; JSON is hand-editable)
  smoke.mjs          headless engine test: node tools/smoke.mjs
```

**The contract:** adding content never requires touching engine code. Add a JSON file under the right `/data` subfolder, list its path in `data/manifest.json`, reload. (GitHub Pages can't list directories, hence the manifest.)

---

## Content schemas

Every file has a unique `id` matching its filename.

### `data/neighborhoods/*.json`

| field | meaning |
|---|---|
| `name`, `vibe`, `identity` | display; identity is flavor (starter / established / up-and-coming / luxury / urban / waterfront-mixed) |
| `basePriceIndex` | relative price level (unused directly; documentation of intent) |
| `priceTrend` | mean weekly drift of the neighborhood price multiplier (e.g. `0.011` ≈ +1.1%/wk) |
| `trendVolatility` | weekly noise around the trend |
| `schoolQuality` | 1–5, flavor + future hooks |
| `buyerDemand` | base demand multiplier feeding `marketHeat` |
| `amenities` | display tags |
| `knowledgeNotes` | strings surfaced one-by-one as the player's local knowledge in this neighborhood levels up (index = knowledge level − 1) |

### `data/listings/*.json`

| field | meaning |
|---|---|
| `address`, `beds`, `baths`, `sqft`, `blurb`, `features[]` | display + matching. `features` strings are matched verbatim by client `mustFeatures` and hidden-pref triggers — reuse existing wording where possible |
| `neighborhood` | neighborhood id |
| `tier` | `starter` / `mid` / `luxury` — gated by career level |
| `price` | ask price at game start |
| `daysOnMarket` | starting DOM; high DOM makes listing agents flexible and triggers price cuts |
| `condition` | 0–1; feeds true-value model (ask ≠ value; the gap is where deals live) |
| `listingAgentId` | NPC agent id — determines negotiation style and dialogue |
| `hiddenIssues[]` | see below |

**hiddenIssues entries:**

| field | meaning |
|---|---|
| `desc` | shown when discovered |
| `discovery` | `visible` (revealed on any tour) / `question` (revealed only by asking the matching `topic` during a showing) / `inspection` (revealed by paid pre-inspection or the under-contract inspection milestone) |
| `topic` | question category: `roof`, `water`, `electrical`, `hvac`, `foundation`, `pests`, `permits`, `sewer`, `hoa`, `neighbors` |
| `severity` | `cosmetic` / `moderate` / `dealbreaker` |
| `repairCost` | drives credits, repair pricing, and client reactions |
| `disclosureRequired` | if the player knows it and doesn't tell the client before it surfaces, reputation and satisfaction take a hit |

### `data/clients/*.json`

| field | meaning |
|---|---|
| `name`, `archetype`, `intro` | display; `intro` is the intake vignette |
| `type` | `buyer` or `seller` |
| `tier` | gates when they can appear (career level) |
| `budget` | buyers only; may be raised by a `stretchBudget` reveal |
| `patience` | starting patience; decays every other idle day, −1 per mismatched showing; at 0 they walk |
| `statedReqs` | buyers: `minBeds`, `mustFeatures[]` (verbatim listing-feature strings), `neighborhoods[]`, `notes`. Sellers: just `notes` |
| `referredBy` | usually `null`; the engine fills it at runtime for referral chains |
| `hiddenPrefs[]` | see below |
| `sellerListing` | sellers only: the home they're selling — `address`, `neighborhood`, `tier`, `baseValue`, `condition`, `beds/baths/sqft`, `features[]`, `issues[]` (same shape as listing `hiddenIssues`) |

**hiddenPrefs entries** — the hidden-information dialogue system:

| field | meaning |
|---|---|
| `desc` | shown when revealed |
| `type` | `stretchBudget` / `secretMustHave` / `secretDealbreaker` / `realMotive` |
| `revealOn` | `{trigger, value}` — `feature` (a viewed listing has this feature string), `topic` (player asked this question topic), `issueSeverity` (an issue of this severity was uncovered with them), `schmooze` (revealed at Nth schmooze) |
| `data` | type-specific payload. Recognized keys: `newBudget` (stretchBudget); `fitBonus`, `targetListing`, `quirkBonus`, `ignoresIssues` (secretMustHave); `topic` (secretDealbreaker: −40 fit for listings with issues on that topic); `honestyWeight` (multiplies satisfaction from disclosure), `patienceBonus`, `deadlineDay`; seller psychology: `floorPct`, `familyFloor`, `sentimentDiscount`, `teardownAversion`, `carryingCostPerWeek`, `disclosureConflict` |

### `data/agents/*.json`

| field | meaning |
|---|---|
| `name`, `bio`, `brokerageId`, `rivalryFlag` | display/flavor |
| `negotiationStyle` | flavor label; also keyed by seller-mode offer generation (`lowballer`, `by-the-book`, `charmer`, `stonewall`, `shark`, `mentor`) |
| `tolerance` | how far under ask they'll accept (0.02 = tough, 0.06 = soft) |
| `counterAggression` | 0–1; how close to ask their counters land, and how hard they resist credits |
| `dirtyTricks` | enables escalation-clause fine print and poaching flavor |
| `dialogueHooks` | `{greeting[], counter[], accept[], reject[]}` — quoted verbatim in negotiations |

### `data/brokerages/*.json`

| field | meaning |
|---|---|
| `name`, `pitch`, `personality` | display |
| `commissionSplit` | your share of the 3% side commission |
| `reputationRequirement` | minimum rep to switch in via the Office screen |
| `recruits`, `recruitRepThreshold`, `signingBonus` | recruitment-event behavior |
| `perks[]` | strings pattern-matched by the engine: `"free lead"` → Monday lead; `"reputation floor"` → rep floor of 10; `"photo tier"` → +1 free photo tier on listings |

### `data/events/*.json`

| field | meaning |
|---|---|
| `name`, `text` | display |
| `mode` | `buyer` / `seller` / `either` |
| `phase` | when it's rolled: `any` (daily), `weekly` (Mondays), `underContract`, `offerPending`, `openHouse` |
| `weight` | relative draw weight among eligible events |
| `minDay`, `maxDay`, `minRep`, `minLevel` | eligibility gates (all optional) |
| `effect` | `{handler, ...params}` — reusable handlers implemented once in `engine/events.js`: `appraisalGap`, `financingWobble`, `inspectionSurprise`, `competingOffer`, `coldFeet`, `poachAttempt`, `brokerageRecruit`, `rateShift`, `neighborhoodBuzz`, `deadlineSqueeze`, `patienceShift`, `openHouseLowball`, `bonusReferral` |

New events are pure JSON composed from these handlers. New handler = one function added to the `HANDLERS` map.

---

## Design notes for future expansion

- **Feature strings are an implicit vocabulary.** Client `mustFeatures` and `revealOn: feature` triggers match listing `features` verbatim. Check existing listings before inventing new wording.
- **The value model:** a listing's *ask* is the seller's opinion; `trueValue` = ask × condition adjustment × neighborhood drift. Appraisals anchor between contract price and modeled value. Player-side seller listings use `baseValue` instead of ask.
- **Priority-tested slice:** the buyer loop, seller loop, open houses, events, brokerages, market drift, referrals, and career ladder are all live. Natural next layers: commercial tier at Broker-Track, per-client financing types on the buyer side, and multi-offer escalation wars as a dedicated flow.
- `tools/smoke.mjs` is a fast regression check: `node tools/smoke.mjs` should end with `SMOKE OK`.
