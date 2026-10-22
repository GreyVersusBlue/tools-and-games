# Closing Time: the listing side of the commercial tier

**A design. Nothing in it is built.** Written 2026-10-11 on Devon's answer of
2026-10-07 ("let's write the design"), decision #954. It waits for his read. The
twelve questions that are his are in section 10, each with the options and the
one this design assumes.

*Section 10 is answered (Devon, 2026-10-21, #1008). The seller-side build is
buildable on this design with two answers changed: CT-4 (an unverified rent roll
is required before listing, no 6% penalty) and CT-5 (fixing a defect before the
sale is a trade that costs days, not left out). Where the body below still says
penalty or left out, the answer replaces it and the build follows the answer.*

*Session 1 of 3 is built (2026-10-21, #1009): section 5.1's arithmetic in
`engine/commercial.js`, the `playerListingValue` branch, `repairCareer`'s
building fields, the content rule and the ladder gate, with CT-4 and CT-5
carried as the amendments under 2.1 and 2.7 say. The seller is a suite fixture
(`tools/fixtures/cl_0302.json`, 330 Courthouse Row), not on the manifest, so no
career can be handed a building to list until session 2 builds the flows and
moves the file into `data/`.*

*Session 2 of 3 is built (2026-10-21, #1010), and the tier is playable:
section 5.2 in `engine/offering.js`, 5.3's changes, the listing file, the offer
row and the two modals, with the CT-4 gate and the CT-5 cure in the flow. The
seller is `data/clients/cl_0302.json`, on the manifest. Where the build differs
from the body: the counter and highest-and-best ceiling of 5.2 is
`offerCeiling()` in `commercial.js` (the name `investorCeiling` was taken); a
seller refuses a counter under the floor as well as an acceptance; test 18
reads "an offer written before an item went into the packet keeps its terms
after", since under CT-4 no offer is written before the roll; the bank date
(group E) is built, not moved; and the browser checks of section 7 are the
project's own `tools/browser.mjs`, not `play-games.mjs`. Session 3 is the other
two sellers, the autopilot and group H, the investor tour and the README.*

*Session 3 of 3 is built (2026-10-22, #1011), and the design is built whole:
14 Tannery Row (`cl_0301`) and 58 Mill Race Rd (`cl_0303`) are on the
manifest with the 4.2 numbers, the investor tour of 2.6 is in `offering.js`
and on a live building's card (the "spin costs 3 on the second one" is the
second spin on a listing, counted in `tourSpins`), `tools/autopilot.mjs` plays
whole careers (CT-11) and `tools/sweep.mjs` re-runs section 6's table on the
shipped tick. Built against the scratch figures, 1,000 listings a row:
memorandum at packet value 16 / 20 / 25 days (scratch 18 / 23 / 29), data room
12 / 16 / 20 (14 / 17 / 21), data room 5% under 11 / 14 / 17 (13 / 15 / 18),
memorandum 8% over 34 / 48 / 77 with 30 none (38 / 57 / 97, 45), data room 15%
over 55 / 91 / 133 with 72 none (66 / 106 / 152, 89); a house 9 / 11 / 14 (9 /
12 / 16). Gross a slot-day against a house: 0.90 on a memorandum (scratch
0.99), 1.06 on a data room (1.13). A tour every week: 9 / 12 / 16. The flyer
row is the one that moved: with the roll required (CT-4) the flyer has no 6%
haircut, and it waits 64 / 104 / 187 with 168 of 1,000 finding nothing (the
scratch figure, no roll, was 192 / 250 / 250 and 553), so test 45 is now "at
least four times the memorandum's median, and nothing on at least a tenth".
No engine number changed: every other row is inside the band section 7 set.
The autopilot, 20 careers: Broker-Track on a median day 215 (171 to 289), all
three buildings taken in every career (they arrive together), and 17 of 20
careers close at least one; the three that reach the rung after day 260 close
none, which is section 6's "after day 263 cannot close any".*

It reads top to bottom for someone who knows the game and is not a broker. Every
figure was computed by a scratch script against the shipped `data/` and the
shipped `js/engine/` modules; section 11 says what was run and what was not.

Contents: 1 the walk-through, 2 the prep steps, 3 what is reused and what is new,
4 data shapes, 5 module surface, 6 balance, 7 tests, 8 left out, 9 size and
order, 10 questions for Devon, 11 how the numbers were checked.

## The idea in four sentences

On the buying side of the tier the arithmetic is public and the argument is
about the inputs. The listing side keeps that and turns it round: **offers are
written on the packet, and closings happen on the building.** The packet is what
the agent has put on paper about the building (its income, its capital list),
and prep is the work of making the packet and the building the same number.
Where they differ, the buyer finds the difference ten days into the contract and
takes it off the price, with a premium for having been surprised.

Three terms, used throughout:

- **Packet value**: what the paper supports. Net income on the packet, divided
  by the market cap rate, less the capital items the packet lists.
- **True value**: `commercialValue()` as shipped. Real net income over the cap
  rate, less every capital item the building has.
- **The owner's number**: what the seller walked in wanting. On a house the
  game has no such thing; on a building it is the first thing they say.

## 1. What the player does

One listing, start to finish. The building is 212 Ferry St, used here as if a
seller had brought it in, because its numbers are already in the game and in the
suite. Day 1 market: rate 6.4%, Downtown index 1.00.

**The pitch (intake).** At Broker-Track the intake queue can hand you a seller
whose card reads "Wants to sell: 212 Ferry St, Downtown Alder Falls · retail
strip, 6 doors". The intro is the owner talking: what they think it is worth
and why they are selling. "Take the listing" costs one action, pays 15 XP and
opens the listing file, as a house does.

**The listing file (prep).** Where a house shows a walkthrough with staging and
photo menus, a building shows the setup sheet and four pieces of work:

```
212 Ferry St · retail strip · 6 doors              IN PREP
Owner's number            $1,095,000
Income on the packet      $73,681   (owner's figures, unverified: buyers take 6% off)
Market cap rate today     7.62%
Capital on the packet     $3,200    (1 item)
Packet value              $963,742
Seller expects            $1,095,000   signs nothing under $985,500

[ Build the rent roll ]        2 actions, lands in 5 days
[ Order the condition report ] $1,800
[ Present your opinion of value ] 1 action
Offering memorandum: ( ) one-page flyer $0  ( ) memorandum $900  ( ) memorandum + data room $2,800
Asking price [ 964000 ]                              [ Go live ]  [ Save for later ]
```

Under it, the capital list: every problem the agent knows about, each with its
cost and a **Put it in the packet** button (the house flow's "Disclose"). On day
one that list holds what a walk of the building shows: the two non-conforming
bay signs ($3,200) and the lapsing parking easement ($9,000). The roof is not on
it, because nobody has been on the roof.

The player builds the rent roll (two actions today, it lands in five days),
orders the condition report ($1,800, which finds the $46,000 roof), puts all
three items in the packet, and presents an opinion of value. Five days later the
sheet reads:

```
Income on the packet      $78,384   (verified against the leases)
Capital on the packet     $58,200   (3 items)
Packet value              $970,461
Seller expects            $1,007,823   signs nothing under $907,040
```

The packet is now the building: $970,461 is the true value. The seller, shown
the arithmetic by an agent who knows Downtown a little (knowledge 2), has come
most of the way from $1,095,000.

**Going live.** The player picks the full memorandum ($900), asks $975,000 and
goes live. The Ledger says so. Nothing happens on a weekend that matters; there
is no open house.

**On the market.** Interest builds daily at half a house's pace. Measured: with
the rent roll in and a memorandum out, an asking price at packet value draws an
offer worth taking in a median 23 days (quartiles 18 and 29).

**Offers.** Each offer is from a named rival agent, as now, and for one of
three kinds of investor. The review screen is the one houses use, with a
building's row:

```
$957,000  LEADING  Priya Natesan (by-the-book) · 1031 exchange buyer · commercial loan · close 45d
  Yield at this price 8.19% · coverage 1.36x against 1.20x, sizes with $128,489 to spare
  · spare equity $115,000 · written on a packet with 3 capital items
  Seller's read: under what they expect, over what they will sign.
  [Advise accept]  [ 975000 ] [Counter]  [Reject]
```

Every number the bank and the buyer will use later is on that row. The player
counters at $975,000; Priya comes back at $966,000, the midpoint, and the
player advises the seller to take it.

**Under contract.** Three dates go on the calendar: due diligence in 10 days,
the bank in 20 (weekdays only), closing in 45.

- *Due diligence.* The buyer's people go through the building and the leases
  and find everything. Here everything was in the packet, so the Ledger line is
  "Due diligence closes on 212 Ferry St with no change. The packet was the
  building." Had the roof been left out, the same day would have opened a modal:
  the buyer wants $57,500 off (the $46,000 roof plus a quarter for the
  surprise), concede it or refuse and see whether they walk.
- *The bank.* Arithmetic, the same as the buying side (#511). At $966,000 the
  income covers the debt 1.35 times against a test of 1.20, so the line is "The
  bank sizes the buyer's loan. Funded." No roll.
- *Closing.* $966,000 at 2% is $19,320 before the brokerage's split, 215 XP,
  and the seller's satisfaction is scored against what they expected:
  966,000 / 1,007,823 is 95.9%, one point over the 95% line, so +1, on top of
  the +8 a signed contract already paid.

**What the same listing looks like done badly.** Flyer only, no rent roll, no
report, nothing put in the packet, asked at the owner's $1,095,000: the price is
14% over a packet value of $963,742, the only buyers a flyer reaches are
value-add investors who pay $814,000 to $893,000, and the seller will sign
nothing under $985,500. It sits. Every 21 days the seller's number comes a
quarter of the way down and they are unhappy about it (−6). If a deal is
finally struck, the buyer finds $55,000 of roof and easement in due diligence.

## 2. The prep steps

Devon named three. This design keeps all three, keeps the house flow's
inspection under a new name and price, adds one small step in place of the open
house, and argues against four others.

### 2.1 The rent roll

*In the trade:* a rent roll is the table of who rents what: each tenant, their
space, their rent, when their lease started and when it ends. A buyer and a bank
both price the building off it, so one that has been checked against the actual
leases (and confirmed by the tenants in writing, a letter called an estoppel) is
worth more than one the owner typed up.

*Cost in the game:* 2 actions on the day it is started, then 5 days before it
lands. No money. The listing may go live while it is out.

*What it does, from the day it lands:*

1. **The income buyers will pay for.** Until it lands, every offer is written on
   94% of the building's net income (`unverifiedHaircut` 0.06). After, on all of
   it.
2. **It shows the agent the lease problems.** Any capital item whose topic is
   `leases` is hidden from the agent until the roll lands (the owner did not
   mention it). Once seen it can go in the packet, and if it is
   disclosure-required and stays out, the reputation cost in 2.5 applies.
3. **Time on market.** +0.2 a day to the interest a listing builds (the same
   size as one tier of staging on a house, before the building's pace factor).
4. **The seller believes the opinion of value more** (2.3).

*Skipping it:* allowed. Offers come 6% of gross value lower and a lease problem
stays hidden from the agent until the buyer finds it.

*Changed by Devon's answer of 2026-10-21 (CT-4, #1008):* the roll is required
before the listing goes live, so it cannot be skipped and the 6% penalty
(`unverifiedHaircut`) is not built. The "Skipping it" paragraph above and the
"Unverified" arithmetic below describe the old assumption; the build follows the
answer.

*Amendment, 2026-10-21 (#1009), how CT-4 was carried.* `PACKET` has no
`unverifiedHaircut` and `packetNoi()` is the whole net income: an offer is
written only on a live building and a building is live only with its roll in,
so there is no unverified figure for an offer to be written on. The gate is
`goLiveBlockers(pl, day)`, the sentences that say why a building cannot go live
today (roll not started, roll not landed, a cure under way); empty means it can.
The roll's other effects stand: it shows the agent the lease items, it adds
0.2 to the opinion of value's `w`, and the interest formula's `verifiedGain`
term is kept and is simply always paid on a live building, so the measured
pace in 2.2 still describes what session 3 should find. **Session 2:** `goLive`
refuses a building while `goLiveBlockers` is not empty, and the listing file
shows the sentences beside a disabled Go live; the walk-through's "the listing
may go live while it is out" no longer holds. **Session 3:** the "flyer, no rent
roll" row of 2.2's table and test 45 describe a listing that cannot exist; test
45 becomes "a flyer finds no offer worth taking in 250 days on at least a third
of listings", with the roll in.

*Arithmetic, 212 Ferry St.* Net income $78,384 (128,400 × 0.91 − 38,460). Market
cap 7.62% (7.40% + 0.22 × 1.00%).

- Verified: 78,384 / 0.0762 = **$1,028,661** before capital.
- Unverified: 78,384 × 0.94 = 73,681; 73,681 / 0.0762 = **$966,942**. The roll
  is worth **$61,720** to every offer on this building.
- No lease item on this building, so nothing new appears on the capital list.

*Arithmetic, 401 Clocktower Sq.* Net income $54,560, market cap 10.05%.

- Verified 54,560 / 0.1005 = **$542,886**; unverified 51,286 / 0.1005 =
  **$510,312**. Worth **$32,574**.
- The roll also turns up "both upstairs office suites gave notice", $41,000,
  disclosure-required. Before the roll the agent cannot put it in the packet,
  and a buyer finds it. After the roll the agent knows it, and leaving it out
  is a choice.

### 2.2 The offering memorandum

*In the trade:* the sale brochure for a building, usually called the OM: the
photographs, the rent roll, the income and expenses, the capital list and the
asking terms, sent to the investors a broker thinks might buy. A data room is
the folder of the actual documents behind it (leases, tax bills, service
contracts) that serious buyers are let into.

*Cost in the game:* fronted by the agent at go-live, as staging and photos are.

| Tier | Cost | Interest a day | Who it reaches |
|---|---|---|---|
| 0, one-page flyer | $0 | +0 | value-add buyers |
| 1, memorandum | $900 | +0.25 | value-add and 1031 exchange buyers |
| 2, memorandum and data room | $2,800 | +0.50 | all three, the cash syndicates included |

It is stored in the field the house flow already has (`marketingTier`), and a
brokerage's "photo tier" perk gives one tier free, as on a house.

*What it does:* it sets **the buyer pool**. The three kinds of investor are the
three the buying side already ships as clients (Simone Vardy, Nadia Brost,
Emmett Rusk's dentists), here as the people on the other side of the table:

| Investor | Yield they need | Pays with | Spare equity | A surprise costs | Reached at |
|---|---|---|---|---|---|
| value-add | market cap + 0.60 to + 1.40 points | commercial loan | 2% to 6% of price | its cost | tier 0 |
| 1031 exchange | market cap − 0.20 to + 0.40 | commercial loan | 10% to 18% | its cost × 1.25 | tier 1 |
| syndicate | market cap − 0.60 to + 0.00 | cash | (none needed) | its cost × 1.50 | tier 2 |

An offer is `packet income ÷ the yield they need − packet capital`, never more
than 3% over the asking price, rounded to $1,000. A lower yield is a higher
price, so a wider memorandum reaches the buyers who pay more, and the ones who
pay most are the ones most put off by a surprise.

*Arithmetic, 212 Ferry St, packet complete* (income $78,384, capital $58,200,
true value $970,461):

- value-add at 8.22% to 9.02%: **$810,802 to $895,377** (84% to 92% of value)
- exchange at 7.42% to 8.02%: **$919,157 to $998,188** (95% to 103%)
- syndicate at 7.02% to 7.62%: **$970,461 to $1,058,381** (100% to 109%)

*Arithmetic, 9 Ironworks Way, packet complete* (income $96,500, cap 8.90%,
capital $31,500, true value $1,052,770):

- value-add **$905,393 to $984,289**; exchange **$1,006,134 to $1,077,695**;
  syndicate **$1,052,770 to $1,131,151**.

*Time on market, measured* (five buildings, four seasons, 50 seeds each, 1,000
listings a row; "an offer worth taking" is one at 95% of the asking price or
better):

| Packet | Asking | Days to an offer worth taking, q1 / median / q3 | None in 250 days |
|---|---|---|---|
| flyer, no rent roll | packet value | 192 / 250 / 250 | 553 of 1,000 |
| memorandum, rent roll | packet value | 18 / 23 / 29 | 0 |
| data room, rent roll | packet value | 14 / 17 / 21 | 0 |
| data room, rent roll | 5% under | 13 / 15 / 18 | 0 |
| memorandum, rent roll | 8% over | 38 / 57 / 97 | 45 |
| data room, rent roll | 15% over | 66 / 106 / 152 | 89 |

A house under the shipped engine, same test: 9 / 12 / 16 days.

*Skipping it (the flyer):* the building sells only to a value-add buyer, at 84%
to 92% of value, which is under the 90% of expectation most sellers will sign
unless the opinion of value has moved them.

### 2.3 The broker's opinion of value

*In the trade:* a broker's written estimate of what a building will sell for,
called a BOV: the income, the cap rate comparable buildings sold at, and the
arithmetic. It is not an appraisal and nobody lends on it. Its job is the
conversation with the owner about price before the building goes out.

*Cost in the game:* 1 action. It can be presented again later, for another
action, when the agent knows more.

*What it does:* it moves **what the seller expects**, and through that the
price they will sign and how they feel at closing. It does not change what the
building is worth or what buyers pay.

```
expectation = packet value + (owner's number − packet value) × (1 − w) × 0.75^stale
w     = 0 with no opinion presented
      = min(1, 0.5 + 0.1 × neighborhood knowledge (whole levels, 0 to 5)
                   + 0.2 if the rent roll had landed), fixed the day it is presented
stale = the number of 21-day stretches the listing has sat live with nothing accepted
```

- **The seller signs nothing under 90% of expectation.** "Advise accept" below
  that is refused, costs 2 satisfaction and leaves the offer open. A seller's
  hidden `floorPct` (an existing content key) replaces the 90% for that seller,
  whether or not the player has revealed it.
- **Closing satisfaction** is `(price ÷ expectation − 0.95) × 100`, rounded, kept
  between −25 and +12. A house scores the same shape against its suggested
  price; a building scores against the expectation because the owner's number is
  the thing a building's seller actually holds.
- **Asking under 97% of expectation** at go-live costs 4 satisfaction. A later
  price cut costs 3, as on a house.
- **Sitting:** each 21 days live with nothing accepted, the seller comes a
  quarter of the way down on their own and loses 6 satisfaction. The house flow
  has the same −6 once, at day 21.

Expectation is computed, not stored, so it follows the packet: a roof put in the
packet lowers it the same day by `w` times the roof.

*Arithmetic, 212 Ferry St* (owner's number $1,095,000, packet complete at
$970,461):

- No opinion: expectation $1,095,000, floor **$985,500**. Most of a syndicate's
  range clears it and only the top sixth of an exchange buyer's does. A sale at
  true value scores (0.886 − 0.95) × 100 = **−6**.
- Opinion at knowledge 2 with the roll in, w = 0.9: 970,461 + 124,539 × 0.1 =
  **$982,915**, floor **$884,624**. A sale at value scores **+4**.
- Opinion at knowledge 2 before the roll, w = 0.7 (the walk-through's case):
  970,461 + 124,539 × 0.3 = **$1,007,823** on the finished packet.

*Arithmetic, 330 Courthouse Row* (a proposed seller building, section 4.2:
owner's number $1,250,000 against a true value of $983,793, 27% over):

| | Expectation | Signs nothing under | Sale at true value scores |
|---|---|---|---|
| No opinion | $1,250,000 | $1,125,000 | −16 |
| No opinion, sat 21 days | $1,183,448 | $1,065,103 | −12 |
| No opinion, sat 42 days | $1,133,534 | $1,020,181 | −8 |
| No opinion, sat 63 days | $1,096,099 | $986,489 | −5 |
| Opinion at w 0.5 (knowledge 0, before the roll) | $1,116,897 | $1,005,207 | −7 |
| Opinion at w 0.7 (knowledge 0, roll in) | $1,063,655 | $957,290 | −3 |
| Opinion at w 0.9 (knowledge 2, roll in) | $1,010,414 | $909,372 | +2 |
| Opinion at w 1.0 (knowledge 5) | $983,793 | $885,414 | +5 |

Every row is on the finished packet. The best buyer in the game, a syndicate at
the top of its range, pays $1,068,763 for this building and an exchange buyer
at most $1,010,700. So with no opinion nothing clears the floor for three
weeks, only that one syndicate does for the six weeks after, and an exchange
buyer cannot until day 63.

*Skipping it:* costs nothing on a building whose owner is realistic (14 Tannery
Row, 4.8% over: a sale at value scores 0 without and +5 with). On an owner 27%
over it is the difference between a listing that sells and one that sits.

### 2.4 The condition report (the house flow's inspection, renamed)

*In the trade:* a property condition assessment: an engineer's walk of the
roof, structure and mechanical systems, with a dollar figure against each
defect. Sellers order one so they hear it before the buyer does.

*In the game:* $1,800, immediate, the `preInspected` flag the house flow already
has ($450 there). It shows the agent every capital item whose discovery is
`inspection`. On 212 Ferry St that is the $46,000 roof.

*Skipping it:* the agent does not know, cannot put it in the packet, and is not
blamed for it; the buyer finds it and it costs the surprise premium.

### 2.5 Putting things in the packet (the house flow's disclosure)

Not a prep step with a price, but it is where the steps above pay or do not.
A capital item in the packet comes off every offer at its cost. One left out
comes off in due diligence at its cost times the buyer's surprise factor.

*Arithmetic, 212 Ferry St, exchange buyer at the middle of their range, rent
roll in and report done:*

- Everything in the packet: offer **$958,672**, no change in due diligence.
  Seller nets $958,672.
- Roof and easement known and left out ($55,000): offer **$1,013,672**, then
  −$69,000 (55,000 × 1.25, rounded to $500). Seller nets **$944,672**, $14,000
  worse, and the agent loses 6 reputation because both items are
  disclosure-required and the agent knew.
- Value-add buyer, same choice: $908,089 − $55,000 = **$853,089**, exactly the
  disclosed figure. Hiding gains nothing from the one buyer it does not cost.

Hiding never nets more than disclosing against any of the three. That is on
purpose and section 7 has a test for it.

### 2.6 The investor tour (in place of the open house)

*In the trade:* a scheduled walk of the building for the buyers who asked for
the memorandum.

*In the game:* live listings with a memorandum (tier 1 or 2) only; a weekday; 2
actions; once in any 7 days. Interest +2.0, +0.5 per memorandum tier, 10 XP and
+0.5 neighborhood knowledge as an open house pays, and one question from the
room, the open house's "so what is wrong with it?": a straight answer pays +2
reputation, a spin costs 3 on the second one, as now.

This is the one step not simulated. It is sized against the daily gain (about
0.5 a day for a well-prepared listing), so one tour is four to six days of
waiting. It is last in the build order and the tier works without it.

### 2.7 Steps argued against

- **Staging, photo tiers, weekend open houses.** #515 already says why: none of
  them means anything on a six-bay strip. Photographs are inside the memorandum.
- **Curing a defect before the sale** (the house flow's "Repair"). On a house a
  repair raises `condition` and value moves by a percentage. On a building the
  defect is a dollar line: curing a $46,000 roof costs the seller $46,000 and
  raises every offer $46,000, a wash that takes weeks. What matters is whether
  it is on paper, which 2.5 covers. Question 5.
  *Changed by Devon's answer of 2026-10-21 (CT-5, #1008):* this is not left
  out. Fixing a defect before the sale is built as a trade that costs days, and
  the build follows the answer. The "argued against" reasoning above is the old
  assumption.

  *Amendment, 2026-10-21 (#1009), how CT-5 was carried.* Option (b) is "a wash
  that costs days", and the arithmetic is that and no more. A cure is
  `{ idx, startedDay, readyDay }` in `pl.cures`; it may be started in prep on an
  item the agent knows (`canCure`), takes `cureDays(cost)` = the longer of 5
  days and a day per $4,000 (the signs 5, the roof 12, Courthouse Row's lease
  item 13), and blocks going live until it is done. The seller pays; the agent
  fronts nothing. On `readyDay` the item is off the building (`buildingOf`, so
  true value and due diligence lose it) and out of the packet, so packet value
  and every offer rise by its cost. The seller's side reads it as an item put in
  the packet: `sellerBasis` is packet value less `curedCost`, so expectation and
  floor do not move, and `sellerNet(price)` is the price less what they paid.
  On 212 Ferry St's roof, in the packet at w 0.7: offers $46,000 higher, net to
  the seller the same to the dollar, twelve days later. A cure of an item the
  packet left out reads to the seller exactly as disclosing it would have. What
  it buys is a building with nothing for due diligence to find, at the price of
  days in prep. **Session 2:** `startCure(pl, i)` in `offering.js` (one
  action, a Ledger line, a calendar item at `readyDay`), a Cure button beside
  "Put it in the packet" on items `canCure` allows, `sellerReaction` and the
  closing score read `sellerNet` against expectation, and `takeListing` sets
  `cures: []`. **Session 3:** the autopilot's sweep plays a cure policy against a
  disclose policy and says how many days a cure costs a listing on average.
- **Leasing up the vacancy first.** Real, and the largest lever an owner has,
  but it is managing the building for a season, not selling it.
- **Seller financing, an auction, a sealed-bid date.** The existing
  highest-and-best call is already the game's bid date and works unchanged.

## 3. What is reused and what is new

**Reused as it stands:**

- Intake, the client record, "Take the listing", the My Listings screen and its
  three stamps (IN PREP, LIVE, UNDER CONTRACT).
- The rival agents: all six, their styles, their dialogue, their tolerance.
  An investor's kind sets the price; the agent's style sets how they bargain.
- `respondToOffer()`: accept, counter, reject, the midpoint re-counter, the walk.
- Escalation clauses and the highest-and-best call (`escalation.js`), including
  the emptied room and its −12 satisfaction and −2 reputation.
- The calendar: `scheduleItem`, milestones on a player listing, weekday-only
  bank dates, the two-day offer deadline and its −3 for letting one lapse.
- `commercial.js` in full: `noi`, `marketCap`, `loanConstant`, `dscrAt`,
  `sizingPrice`, `loanShortfall`, `DEBT`, `sideRate` (2%).
- `failSellerDeal()`, the `coldFeetSeller` event, the seller-side void on
  deleted content (#861), `rollReferral()`, the Ledger's per-client tag.
- Hidden seller psychology keys: `floorPct`, `familyFloor`,
  `carryingCostPerWeek`, `teardownAversion`, `sentimentDiscount`. No new key.

**New:**

- The packet: two values where a house has one, and the rule that offers read
  one and due diligence reads the other.
- Three investor kinds on incoming offers, and the buyer pool gated by the
  memorandum.
- The seller's expectation, and a seller who can say no.
- Two milestones: due diligence (in place of the buyer's inspection) and a bank
  date that is arithmetic (in place of the 5% and 12% financing rolls).
- A waiting step in prep (the rent roll's five days).
- One screen (the listing file) and a building's row on two others.
- The ladder gate on seller clients (5.6), which no seller has needed until now.

**Dice.** The buying side's rule is that the bank is arithmetic (#511). This
side keeps it: the bank date and due diligence both resolve with no call to
`rand()`. The dice that remain are the ones the house flow already rolls: when
an offer arrives and from whom, the counter, the highest-and-best answers, and
whether a buyer walks when a price cut is refused.

## 4. Data shapes

### 4.1 Content: a seller of a building

A client file, as every seller is. `tier: "commercial"` on the client is the
ladder gate; `sellerListing` carries the same `commercial` block a listing file
does, and the same issue entries a house seller's `issues` already use.

```json
{
  "id": "cl_0302",
  "name": "...", "type": "seller", "archetype": "...", "tier": "commercial",
  "budget": 0, "patience": 8,
  "statedReqs": { "notes": "..." },
  "hiddenPrefs": [ { "desc": "...", "type": "realMotive",
                     "revealOn": { "trigger": "schmooze", "value": 1 },
                     "data": { "floorPct": 0.93 } } ],
  "intro": "...", "referredBy": null,
  "sellerListing": {
    "address": "330 Courthouse Row", "neighborhood": "nb_downtown",
    "tier": "commercial",
    "price": 1250000,
    "beds": 0, "baths": 4, "sqft": 12800, "features": ["second-floor offices"],
    "commercial": { "assetType": "mixed-use", "units": 7, "grossRent": 151200,
                    "vacancy": 0.12, "opex": 44800, "marketCap": 0.078,
                    "rollPct": 0.40, "rentRoll": "..." },
    "issues": [ { "desc": "...", "discovery": "question", "topic": "leases",
                  "severity": "dealbreaker", "repairCost": 52000,
                  "disclosureRequired": true } ]
  }
}
```

- `sellerListing.price` is new on a seller and is **the owner's number**. A
  house seller has `baseValue` and no price; a building has a price and no
  `baseValue` or `condition` (the income model reads neither, #508).
- A seller with `sellerListing.tier === "commercial"` and no valid `commercial`
  block (five numbers, all finite, `vacancy` and `rollPct` in 0 to 1) or no
  finite `price` is a content error: `dropBrokenContent()` leaves the seller out
  and says so, and the suite's content check exits 1 on it (#879's rule).
- What the agent knows, by `discovery` and `topic`: `visible` always; `question`
  on the walk, except topic `leases`, which waits for the rent roll;
  `inspection` after the condition report. A `leases` item is known once the
  roll lands whatever its discovery says.

### 4.2 The three seller buildings proposed

Names and prose are the builder's to write in the game's voice; the numbers are
checked (day 1, rate 6.4%, index 1.00).

| | 14 Tannery Row | 330 Courthouse Row | 58 Mill Race Rd |
|---|---|---|---|
| Kind, doors | light industrial, 4 | mixed-use, 7 | apartment building, 12 |
| Neighborhood | Old Foundry | Downtown | Carver Mill |
| Gross rent, vacancy, expenses | 96,000 · 6% · 24,500 | 151,200 · 12% · 44,800 | 158,400 · 7% · 49,300 |
| Net income | $65,740 | $88,256 | $98,012 |
| `marketCap`, `rollPct` | 0.086, 0.15 | 0.078, 0.40 | 0.072, 0.30 |
| Cap rate today | 8.75% | 8.20% | 7.50% |
| Capital: visible | $2,800 | $4,500 | $6,000 |
| Capital: needs the report | $14,000 | $36,000 | $19,000 |
| Capital: needs a question or the roll | $9,000 (leases) | $52,000 (leases) | $15,000 (environmental) |
| True value | $725,514 | $983,793 | $1,266,827 |
| Owner's number | $760,000 (4.8% over) | $1,250,000 (27.1% over) | $1,330,000 (5.0% over) |
| What it teaches | the steps, on an honest owner | the opinion of value | a lower cap rate, so the bank's margin is thinnest |

Three sellers against the three commercial buyers already shipped. Question 9.

### 4.3 The save

**No key changes and `SAVE_VERSION` stays 1** (#36). The career's shape gains
optional fields, which is what `repairCareer()` is for (#37); the financing
round and the escalation round added fields the same way without a bump.

On a player listing (`S.playerListings[]`), for a building only:

| Field | Type | Fresh | Meaning |
|---|---|---|---|
| `rollStartedDay` | day or null | null | the day the rent roll was begun |
| `rollReadyDay` | day or null | null | the day it lands (`rollStartedDay + 5`) |
| `bovWeight` | 0 to 1 | 0 | `w` from 2.3, fixed when presented |
| `bovDay` | day or null | null | when it was last presented |
| `staleSteps` | integer | 0 | 21-day stretches sat, for the expectation |
| `tourDay` | day or null | null | the last investor tour |

Reused with a building's meaning: `marketingTier` (memorandum tier),
`preInspected` (report done), `disclosed` (indexes in the packet). `staged`
stays 0 and `repairsDone` stays empty. Expectation and both values are computed
on read and never stored.

On an offer on a building:

| Field | Meaning |
|---|---|
| `investor` | `"value-add"`, `"exchange"` or `"syndicate"` |
| `financing` | `"commercial"` or `"cash"` (the ids `financing.js` has) |
| `spareEquity` | dollars the buyer can add if the bank cuts the loan |
| `uw` | what the offer was written on: `{ noi, reqCap, capexIdx: [...], yieldPrice }` |

`uw` is fixed the day the offer is written, as `writeOffer()` fixes a buyer's
financing on the deal: a packet improved afterwards does not reprice an offer
already on the table, and due diligence compares the building with `uw.capexIdx`,
not with the packet as it stands that day.

Milestone types on a building under contract: `sellerDueDiligence`,
`sellerFinancing` (the existing name, a new branch), `sellerClosing`. Choice
kinds: `sellerRetrade` and `sellerLoanShortfall`, both carrying `plId`, which the
queue filter in `repairCareer()` already checks.

**What `repairCareer()` adds** (all without `rand()`, because repair runs on
every load and must not advance the seed, #386):

- The six fields above, clamped: days finite or null, `rollReadyDay` null when
  `rollStartedDay` is, `bovWeight` in 0 to 1, `staleSteps` a non-negative
  integer.
- On an offer on a building: an unknown `investor` becomes `"value-add"`, a
  non-finite `spareEquity` becomes 0, a missing `uw` is rebuilt from the packet
  as it stands with `reqCap` equal to the market cap.
- **Clients added to `data/` since the career began are appended to
  `clientQueue`.** Fixed on 2026-10-12 (#956), ahead of the build: reproduced
  on a career saved without the three commercial buyers, which reached
  Broker-Track and day 301 without meeting one. They go on the end, lowest rung
  first and by id inside a rung, not in plain id order as this note first said.
  An id is appended only if it is in none of `clientQueue`, `usedClients` and
  `clients[].clientId`. The build adds nothing here but its sellers' files.

**What an old save loads as:** itself. It holds no building under a listing
agreement, so nothing in it changes but the queue, which gains the new sellers
at the end; they arrive when the ladder allows.

## 5. Module surface

### 5.1 `engine/commercial.js`: the arithmetic (pure, no `rand()`, no log)

Constants:

```js
export const PACKET = { unverifiedHaircut: 0.06, rollActions: 2, rollDays: 5,
  reportCost: 1800, omCost: [0, 900, 2800], omGain: 0.25, verifiedGain: 0.2, pace: 0.5 };
export const INVESTORS = {
  "value-add": { spread: [0.006, 0.014],  financing: "commercial", equity: [0.02, 0.06], surprise: 1.0,  minOm: 0, weight: 3 },
  exchange:    { spread: [-0.002, 0.004], financing: "commercial", equity: [0.10, 0.18], surprise: 1.25, minOm: 1, weight: 2 },
  syndicate:   { spread: [-0.006, 0.0],   financing: "cash",       equity: [0, 0],       surprise: 1.5,  minOm: 2, weight: 1 },
};
export const SELLER_SIDE = { floorPct: 0.90, underAskPct: 0.97, staleDays: 21, staleKeep: 0.75,
  bovBase: 0.5, bovPerKnowledge: 0.1, bovVerified: 0.2, ddDay: 10, bankDay: 20,
  closeDays: { commercial: [45, 60], cash: [21, 30] }, refuseWalkBonus: 0.15,
  satisfaction: [-25, 12], fastDom: 45, xp: 215 };
```

Functions, each taking the player listing `pl`:

| Function | Returns |
|---|---|
| `isBuilding(pl)` | `isCommercial(pl.listing)` |
| `buildingOf(pl)` | `pl.listing` with `hiddenIssues` pointing at `issues`, so every shipped function reads it |
| `rollVerified(pl, day = S.day)` | boolean |
| `agentKnows(pl, i)` | boolean, the rule in 4.1 |
| `inPacket(pl, i)` | `visible` or in `pl.disclosed` |
| `packetNoi(pl)` | `noi × (rollVerified ? 1 : 0.94)`, unrounded |
| `packetCapex(pl)` / `packetIdx(pl)` | dollars / indexes in the packet |
| `packetValue(pl)` | `packetNoi ÷ marketCap − packetCapex`, rounded |
| `buildingTrueValue(pl)` | `commercialValue(buildingOf(pl))` |
| `bovWeightNow(pl)` | the `w` an opinion presented today would carry |
| `sellerExpectation(pl)` | the formula in 2.3; uses `pl.listing.price`, `pl.bovWeight`, `pl.staleSteps` |
| `sellerFloor(pl, rec)` | expectation × the seller's `floorPct` or 0.90 |
| `investorPrice(pl, reqCap)` | `{ yieldPrice, price }`, price capped at 1.03 × asking and rounded to $1,000 |
| `dueDiligence(pl, offer)` | `{ surprises: [i], cost, retrade, knewRequired }`; retrade is cost × the investor's `surprise`, rounded to $500 |
| `sellerLoanTest(pl, offer)` | `{ dscr, sizes, shortfall, spare, covered, financeablePrice }` |

`financeablePrice` is `sized loan + 0.30 × price + spare equity`, capped at the
price: the most the buyer can pay keeping the equity they planned and adding
what they have spare. `sized loan` is `noi ÷ 1.20 ÷ loanConstant()`.

### 5.2 `engine/offering.js`: new, the flows (state, log, `rand()`)

| Function | Does |
|---|---|
| `startRentRoll(pl)` | sets the two days, schedules "Rent roll due", one Ledger line; the UI spends the 2 actions |
| `orderConditionReport(pl)` | `addCash(−1800)`, `preInspected = true` |
| `presentOpinion(pl)` | `bovWeight = bovWeightNow(pl)`, `bovDay`, a Ledger line with the seller's old and new expectation |
| `dailyBuildingTick(pl)` | prep and live: the day the roll lands, one Ledger line naming any lease item it turned up. Live: the highest-and-best deadline, `dom`, interest, the offer roll, the 21-day step |
| `spawnInvestorOffer(pl)` | picks a kind by weight among those the memorandum reaches, a rival agent as now, draws `reqCap` and `spareEquity`, builds the offer with `uw`, schedules its deadline |
| `investorCeiling(pl, offer)` | `offer.uw.yieldPrice × (1 + agent.tolerance ÷ 2)`, what a counter can reach |
| `resolveDueDiligence(pl, m)` | no surprises: a line. Otherwise queues `sellerRetrade` |
| `retradeDecision(pl, decision, amount)` | `concede`: price − amount, satisfaction −(3 + the cut as a whole percent), at most −15. `refuse`: the house flow's walk odds by style + 0.15; walk is `failSellerDeal()`, stay is +5. Either way −6 reputation if `knewRequired` |
| `resolveSellerLoan(pl, m)` | cash: nothing scheduled. Sizes: a line. Short and covered by spare equity: a line naming the dollars. Otherwise queues `sellerLoanShortfall` |
| `sellerLoanDecision(pl, decision, price)` | `reprice`: price becomes `financeablePrice`, satisfaction as a conceded retrade. `hold`: `failSellerDeal()`, with no roll, and the modal says so |
| `runInvestorTour(pl, straight)` | 2.6 |

Daily interest on a live building:

```
gain = 0.5 × ( 1.2 × heat × (1.25 − asking ÷ packet value) + 0.25 × memorandum tier + (roll verified ? 0.2 : 0) )
```

The offer chance from interest is the house formula unchanged
(`(interest − 3) × 0.06`, at most 0.5, × 0.6 on a weekend).

### 5.3 Existing functions that change

| Where | Change |
|---|---|
| `market.js` `playerListingValue(pl)` | a building returns `packetValue(pl)`. `suggestedPrice`, `priceRatio`, `clauseFor` and the reprice screen then need no change |
| `seller.js` `takeListing` | sets the six fields; XP and the knowledge bump as now |
| `seller.js` `goLive` | on a building logs the memorandum by name and takes no staging |
| `seller.js` `dailySellerTick`, `spawnNPCOffer` | first line: a building goes to `dailyBuildingTick` / `spawnInvestorOffer` |
| `seller.js` `sellerReaction` | on a building the base is `price ÷ expectation`, not `price ÷ asking`; the hidden-preference notes are unchanged |
| `seller.js` `respondToOffer` | accept on a building under `sellerFloor` returns `{ refused: true }` and changes nothing but 2 satisfaction; the counter's ceiling is `investorCeiling` |
| `seller.js` `acceptSellerOffer` | a building's milestones: due diligence at +10, the bank on the first weekday from +20 unless cash, closing at the offer's days |
| `seller.js` `resolveSellerMilestone` | the two new types; closing on a building pays `sideRate` (2%), 215 XP, satisfaction against expectation, +6 at 45 days on market or fewer |
| `escalation.js` `agentHighestAndBest` | on an offer with `uw`, the raise stops at `investorCeiling`, not at value × 1.05 |
| `clients.js` `nextIntakeCandidate`, `rollReferral`; `calendar.js` `brokerageMondayPerks` | see 5.6 |
| `state.js` `repairCareer` | 4.3 |
| `data.js` `dropBrokenContent` | 4.1 |
| `ui.js` | `flowPrepListing` opens the listing file for a building; `playerListingCard` shows kind, doors, income, the three values and the stamps; `flowOfferReview` adds the building's row and reports a refusal; the investor tour button; two modals in the choice queue |

Nothing under `assets/js/`, no storage key, no change to the hall or the
scorecard (a building's sale counts in `closed` and `volume` as any sale does).

### 5.4 The two modals

*Due diligence, with a surprise:*

> The buyer's people at 212 Ferry St found what the packet did not list: flat
> roof at the end of its second patch job ($46,000). They want $57,500 off:
> the cost, and a quarter again for finding it themselves.
> **[Concede $57,500]** **[Refuse, and see if they walk]**

*The bank, short:*

> The bank sizes the loan on 212 Ferry St at 1.10x against a 1.20x test and
> cuts it by $59,225. The buyer has $40,000 spare. At $980,775 the deal
> finances; at $1,000,000 it does not.
> **[Come down to $980,775]** **[Hold the price: the deal ends]**

### 5.5 Reputation and the things the agent knew

House rule kept (`ui.js`, the −6 on "an undisclosed required issue surfaced
under contract"), with one narrowing for a building: the −6 applies only when
the item was disclosure-required **and the agent knew it** (`agentKnows`). An
agent who skipped the report is not punished for a roof nobody had seen; the
seller's price is.

### 5.6 The ladder gate on sellers

Three doors hand out clients: intake, the Monday lead and a referral. All three
let **any seller** through whatever their tier (`|| type === "seller"`), which
has not mattered because no seller was ever commercial. Each becomes "the tier
is on the ladder, or it is a seller who is not commercial". Whether a Rookie
should be meeting a luxury seller at all is question 12.

**A fourth door was found and is gated now** (#956, 2026-10-12): the
`bonusReferral` event handler (`events.js`, `ev_ruth_referral`, from day 12 at
20 reputation) picked from the whole queue with no ladder check, buyers
included. Reproduced: ten of a Rookie Agent's nineteen on day one are buyers
above the rung. The rule is one function, `inReach()` in `engine/clients.js`,
and all four doors call it, so "the tier is on the ladder, or it is a seller
who is not commercial" is one edit when the build makes it.

## 6. Balance

**Where it sits.** Broker-Track, 700 XP, the same rung as the buying side. A
building listed on the day the rung is reached closes about 73 days later (5 for
the rent roll, a median 23 to an offer worth taking, 45 under contract), so a
career that reaches the rung by day 190 can close two in sequence and one that
reaches it after day 263 cannot close any. **Not measured: the day a typical
career reaches Broker-Track.** The project has no career autopilot; question 11
is about that.

**What a deal pays** (gross, before the brokerage's split; medians of the
measured runs):

| | Price | Rate | Gross | Days from signing the client to closing | Gross a day | XP |
|---|---|---|---|---|---|---|
| House listing (the six shipped sellers) | about $400,000 | 3% | $12,120 | 44 | $275 | 45 to 130 |
| Building, buying side (the four shipped) | $447,000 to $1,053,000 at value | 2% | $8,900 to $21,100 | not measured | | 200 |
| Building listing, memorandum and rent roll | about $990,000 | 2% | $19,825 | 73 | $272 | 215 |
| Building listing, data room | about $1,000,000 | 2% | $19,992 | 64 | $312 | 215 |
| Best case: Mill Race Rd to a syndicate at its top | $1,380,000 | 2% | $27,600 | about 60 | $460 | 215 |

Prep money the agent fronts: a house up to $2,850 (full staging, drone photos,
inspection) and $1,250 as the measured runs prepared it (light staging,
professional photos, inspection); a building $2,700 (memorandum and report) or
$4,600 (data room and report). Net of $1,250 and $2,700 at an independent's
full split, a building listing is about $235 a day against a house's $247; at
Hearthstone's 55% split, $112 against $123.

So a building listing is **about a house listing's money per day a client slot
is held, a little under after costs, for about 1.6 times the XP per day (2.9
against 1.8) and far fewer actions** (no open-house days). It is worth doing and not the only
thing worth doing, because it fills one of five client slots for ten weeks and
asks for almost none of the four daily actions while it does.

**215 XP** follows the house pattern, where a listing closes for a little more
than a purchase of the same tier (45 against 40, 75 against 70, 130 against
120). Question 8.

**The bank rarely bites on this side, and that is a finding, not a goal.** At
the opening rate every building finances well above its value: 212 Ferry St
sizes to $1,085,489 against $970,461, Mill Race Rd to $1,357,304 against
$1,266,827 (7.1% of room), the other five 24% to 69%. Of five rates tried (6.4, 7.0, 7.4, 7.9, 8.4), an exchange buyer at
$1,000,000 on Ferry St is first short at 7.4% ($3,725), still covered by 4%
spare equity at 7.9% ($32,402), and needs a price cut at 8.4% ($59,225 short,
repriced to $980,775). The weekly drift is 0.15 a week at most from 6.4%. So the
bank date is a line in the Ledger on most careers and a decision in a
high-rate one, as on the buying side, where the player who did the arithmetic
never meets it. The offer row prints the coverage and the room so the one time
it matters the player was told.

**Checks that would hold the balance** (section 7, group H): the median days to
an offer, the flyer's dead end, hiding never beating disclosing, and gross per
slot-day against a house inside a band.

## 7. Tests

All in `tools/smoke.mjs` (501 assertions today), a new section "the listing side
of the commercial tier", pure Node, seeded. Every one is broken on purpose once
before it counts (#34), from a green baseline, in a scratch copy that includes
`assets/js/gvb-save.js`. Names are the assertion text.

**A. The packet**

1. "a building's packet income is 94% of its net income until the rent roll lands": 212 Ferry St, $73,681 then $78,384.
2. "and it lands five days after it is started, not four": day by day.
3. "packet value on a complete packet is the true value": $970,461, all three proposed buildings and Ferry St.
4. "an item in the packet comes off at its cost": packet value falls by exactly `repairCost`.
5. "a lease item is not known to the agent before the roll and is after": Clocktower's $41,000.
6. "a report item is not known before the report": Ferry St's roof.
7. "the house flow is untouched": `playerListingValue` on `cl_0101` is the same number before and after the change.

**B. The seller**

8. "expectation is the owner's number with no opinion presented".
9. "an opinion moves it by w, and w is 0.5, 0.7, 0.9, 1.0 at the four cases": the Courthouse Row table.
10. "expectation follows the packet without a second opinion": put the roof in, expectation falls by `w × 46,000`.
11. "a seller refuses under 90% of expectation, and the offer stays open".
12. "a seller's own `floorPct` replaces the 90%, revealed or not".
13. "21 days live with nothing accepted is one step, 42 is two, and an accepted offer stops the count".
14. "closing satisfaction is scored against expectation and held between −25 and +12".

**C. Offers**

15. "a flyer draws only value-add buyers; a memorandum adds exchange; a data room adds the syndicate": 400 seeded offers a tier.
16. "an offer is packet income over the yield they need, less packet capital": recomputed by hand for one seed of each kind, as literals.
17. "an offer never exceeds 3% over the asking price".
18. "an offer written before the roll landed keeps its terms after": `uw` unchanged.
19. "a counter above the investor's ceiling is not taken at once".
20. "a highest-and-best call on a building field raises no offer past its ceiling", and "a call that empties the room costs what it costs on a house" (#865: seeded, with the control that does not empty, counted by the Ledger line's own text).

**D. Due diligence**

21. "a complete packet passes with no modal and no change".
22. "an item left out costs its cost × 1.0, 1.25, 1.5 by investor": $55,000 becomes $55,000, $69,000, $82,500.
23. "due diligence reads the packet the offer was written on, not today's": disclose after acceptance, the retrade is unchanged.
24. "hiding never nets the seller more than disclosing": every building, every investor kind, every subset of known items.
25. "−6 reputation only when the agent knew and it was required": the report skipped, then not.
26. "due diligence consumes no randomness": `S.seed` equal before and after, both branches.

**E. The bank**

27. "a cash offer schedules no bank date".
28. "a loan that sizes is a line, and consumes no randomness".
29. "a short loan covered by spare equity funds and says the dollars": Ferry St at 7.4%.
30. "a short loan not covered asks for the financeable price to the dollar": Ferry St at 8.4%, $980,775.
31. "holding the price ends the deal with no roll": seed unchanged, listing back to live.

**F. Closing and the ladder**

32. "a building's listing pays 2% a side and 215 XP".
33. "a Senior Agent is not handed a building's seller by intake, by the Monday lead, by a referral or by Ruth": the four doors, one assertion each (#514's shape).
34. "and a Broker-Track agent is, by each".

**G. Saves and content**

35. "a career saved before this loads with every new field at its default and plays a day".
36. "a client added to `data/` after a career began is appended to the queue once, and not again on the next load".
37. "repair on a building mid-prep, live with offers, and under contract advances the seed by zero".
38. "a building whose seller's file is deleted ends the agreement with one line" (#861's rule, on a building in each of the three states).
39. "a building under contract to a deleted agent's buyer goes back to live with its packet, its rent roll and its expectation intact, and pays nothing".
40. "a queued `sellerRetrade` or `sellerLoanShortfall` naming a listing that is gone is dropped".
41. "a seller whose building has no `commercial` block, or no price, is left out and named": two doctored copies of `data/`, and the content check exits 1 on each (#879).
42. "a seller of a building in a deleted neighborhood is left out": the existing rule, on the new kind.
43. "export and import carry a building mid-contract byte for byte".

**H. Balance rails** (seeded sweeps, each a band that fails the build)

44. "memorandum and rent roll at packet value: median days to an offer worth taking is between 15 and 35" (measured 23).
45. "a flyer with no roll finds no offer worth taking in 250 days on at least a third of listings" (measured 55.3%).
46. "gross per slot-day is between 0.7 and 1.4 of a house listing's" (measured 0.99 and 1.13).
47. "8% over packet value at least doubles the median wait" (measured 23 to 57).

**In the browser** (`Tools/board-check/play-games.mjs`, the `closing-time` entry,
53 checks today; a shared file, edited in the same PR): the listing file opens
on a building and shows no staging or photo menu; the three buttons spend what
they say; a building's offer row shows yield, coverage and spare equity; a
refusal leaves the modal open with the offer still in it; both new modals open
from a seeded save and each button leaves the Ledger line it should. Asserted
against the DOM for what just happened and against the save for what a reload
must keep (#39).

## 8. Left out on purpose

- **Both sides of one deal.** The player's own commercial buyer client cannot
  buy the player's own listing. Real, and worth 4%, and a conflict-of-interest
  design of its own. Question 7.
- **Leasing up, seller financing, auctions** (2.7).
  *Curing defects is no longer on this list:* Devon's answer of 2026-10-21
  (CT-5, #1008) puts it in the build as a trade that costs days. Leasing up,
  seller financing and auctions stay out.
- **Tenants as people.** No tenant has a name, a lease record or an event. The
  rent roll is one number and one line of flavor, as on the buying side.
- **An appraisal on this side.** The bank's test is the one lender milestone; a
  second would be a roll, and this side has none of its own.
- **The buyer walking in due diligence on their own.** They ask for money; they
  leave only if refused. A buyer who simply vanishes is a die the tier does not
  roll.
- **New hidden-preference keys, new event handlers, new agents.**
- **Phone layout work.** The listing file is one more modal in a game whose
  desk already is what it is.
- **Any change to the buying side**, the four shipped listings, the three
  shipped buyers, the hall or the scorecard.

## 9. Size and order

Three sessions on Opus 5.5, in this order. In the backlog's terms a 2: it is its
own batch, and each session ships an increment that leaves the game playable.

1. **The arithmetic and the save, no screen.** `commercial.js`'s constants and
   functions (5.1), the `playerListingValue` branch, `repairCareer` and the queue
   backfill, `dropBrokenContent`, the four ladder gates, one seller file so the
   suite has a subject. Test groups A, B (8 to 10), F (33, 34), G. Nothing a
   player can reach changes except the queue backfill and the fourth gate.
2. **The flows and the screens.** `offering.js`, the changes in `seller.js` and
   `escalation.js`, the listing file, the offer row, the two modals. Groups B
   (11 to 14), C, D, E, F (32), and the browser checks. The tier is playable at
   the end of this session.
3. **Content, balance and the tour.** The other two sellers, group H with the
   sweeps re-run on the built code (the figures in this document are from a
   scratch reimplementation of the tick, so they are the target, not the
   proof), the investor tour, the README and `HISTORY.md`.

Session 2 is the large one. If it will not fit, the bank date (group E) moves
to session 3: until then a financed offer closes as if it sized, which at the
opening rate it does.

## 10. Questions for Devon

Each has the options and the one this design assumes. **All twelve answered by
Devon, 2026-10-21 (#1008):** ten as the design assumed, CT-4 and CT-5 changed.
The answer is in bold under each question; a different answer changes the
section named.

1. **May a seller refuse?** No seller in the game says no today: "Advise accept"
   always signs. (a) Yes, a building's seller signs nothing under 90% of what
   they expect. (b) No, keep it advisory and let satisfaction carry it.
   *Assumed: (a).* Without it the opinion of value moves a feeling and nothing
   else. Section 2.3.
   **CT-1, answered 2026-10-21: seller can refuse, as the design assumed.**
2. **Should the agent see the true value before doing the work?** (a) No: the
   file shows packet value only, and the truth arrives in due diligence. (b)
   Yes: show both from day one, as the buying side shows a building's value on
   the flyer. *Assumed: (a).* On the buying side the hidden things are the
   capital items; here they are too, and (b) would print their total.
   **CT-2, answered 2026-10-21: at due diligence, as the design assumed.**
3. **Who pays for prep?** (a) The agent fronts the memorandum and the report, as
   staging and photos are fronted on a house. (b) The seller pays at closing, so
   it costs the agent nothing unless the deal dies. *Assumed: (a).*
   **CT-3, answered 2026-10-21: the agent, up front, as the design assumed.**
4. **Is 6% the right penalty for an unverified rent roll, and may it be skipped
   at all?** (a) 6%, skippable. (b) A larger penalty. (c) Required before going
   live. *Assumed: (a).* On Ferry St 6% is $61,720, about the size of its whole
   capital list.
   **CT-4, answered 2026-10-21: required before listing (c), CHANGED from the
   assumed (a), the 6% penalty that could be skipped.** The 6% haircut is not
   built; section 2.1 carries the note.
5. **Curing a defect before the sale:** (a) left out, (b) built as a wash that
   costs days. *Assumed: (a).* Section 2.7.
   **CT-5, answered 2026-10-21: a trade that costs days (b), CHANGED from the
   assumed (a), left out.** Section 2.7 carries the note.
6. **The investor tour:** (a) build it last, (b) leave it out. *Assumed: (a).*
   **CT-6, answered 2026-10-21: build it last, as the design assumed.**
7. **Both sides of one deal** (the player's buyer on the player's listing): (a)
   not possible, (b) allowed and paid on both sides, with a reputation rule to
   be designed. *Assumed: (a).*
   **CT-7, answered 2026-10-21: not allowed, as the design assumed.**
8. **XP for a building's listing:** (a) 215, following the house pattern, (b)
   200, the same as the buying side. *Assumed: (a).*
   **CT-8, answered 2026-10-21: 215, as the design assumed.**
9. **How many sellers, and which buildings?** (a) Three new buildings (4.2). (b)
   Fewer. (c) Let the four buildings on the MLS board also arrive as listings to
   take. *Assumed: (a).* Under (c) a building could be on the board and in the
   player's book at once.
   **CT-9, answered 2026-10-21: three new buildings, as the design assumed.**
10. **Should a refused price cut still be a roll?** The buying side's rule is no
    dice at the bank. Here the bank and due diligence are arithmetic, and the
    one roll left is the house flow's: refuse a cut and the buyer walks 45% to
    70% of the time by their agent's style. (a) Keep that roll. (b) Make it a
    rule (for instance: they walk if the cut refused is over 3% of the price).
    *Assumed: (a).*
    **CT-10, answered 2026-10-21: keep the 45% to 70% chance the seller walks
    away, as the design assumed.**
11. **Is a seeded career autopilot wanted before session 3?** Nothing in the
    project plays a whole year, so nobody knows the day a typical career reaches
    Broker-Track, and with it how many buildings a year can hold. (a) Build a
    small one as part of session 3's balance work. (b) Tune by the per-deal
    figures alone. *Assumed: (a).*
    **CT-11, answered 2026-10-21: build an autopilot that plays a whole career,
    as the design assumed.**
12. **Should sellers be on the ladder at all?** Today a Rookie can be handed any
    seller, the $705,000 Brackenridge one included, because all three doors
    wave sellers through. This design gates only a building's seller. (a) Leave
    house sellers as they are. (b) Gate every seller by tier. *Assumed: (a)*, as
    it is the shipped behaviour and (b) changes every career's first season.
    **CT-12, answered 2026-10-21: only building sellers are gated (house
    sellers open to all), as the design assumed.**

## 11. How the numbers were checked

Two scratch scripts, run under Node on 2026-10-11 against the shipped `data/`
and importing the shipped `js/data.js`, `js/state.js` and the `commercial`,
`market`, `seller` and `clients` engine modules; they are not in the repo.

- **From the shipped functions directly:** every net income, cap rate, value,
  loan constant, sizing price, coverage ratio and shortfall (`noi`, `marketCap`,
  `commercialValue`, `loanConstant`, `sizingPrice`, `dscrAt`, `loanShortfall`).
  212 Ferry St's $970,461 and $1,085,489 match the figures the suite and the
  README already hold.
- **From the proposed formulas, over the shipped functions:** packet values,
  investor offers, retrades, expectations, floors and satisfaction scores.
- **House listings:** the shipped `takeListing`, `goLive` and `dailySellerTick`,
  6 sellers by 4 start days by 50 seeds, professional photos, light staging,
  asked at the suggested price, taking the first offer at 95% of asking or
  better.
- **Building listings:** a reimplementation of the proposed daily tick in the
  script, calling the shipped `marketHeat`, `weeklyMarketTick`, `marketCap` and
  `rand`, 5 buildings (212 Ferry St, 9 Ironworks Way and the three proposed) by
  4 start days by 50 seeds for each row.

**Not checked:** the investor tour (not simulated); counters, escalation
clauses and highest-and-best calls on a building field (the sweep takes the
first offer worth taking); how often a seller's floor blocks a sale across a
career; the day a career reaches Broker-Track; anything in a browser. Nobody has
played any of it, because none of it exists.
