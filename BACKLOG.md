# BACKLOG

The single entry point for open work on greyversusblue.com. Two tiers: a
ranked index you scan, and the ideas underneath it that have no other home.

**`ARCHIVE.md` is the third file.** `HISTORY.md` records what shipped; this
file ranks what is open; `ARCHIVE.md` holds work that will not be done. The
five teaching tools went there on 2026-09-08 (#206). Do not move anything back
without Devon saying so.

## How this repo is worked

**The standing instruction is: "work the next batch of ranked items in `BACKLOG.md`, open a
PR, merge to `main`."** It runs unattended — Devon is not reviewing these rounds (2026-09-05)
— so three rules follow, and they override any older wording in this file.

**The prompt a session is started with** (#382, kept here so it and these rules cannot drift
apart; edit both together):

```
Work the next batch of ranked items in BACKLOG.md. Claim your rows on main first
(#283). Size the batch by the table in "How this repo is worked" — it has two axes
now, Size and how many areas the batch spans.

Prefer rows whose Model column matches the model this session is running. Take a
mismatched row anyway rather than skipping down the list, and say in the PR body
which rows you took and which model you actually worked under.

If a row needs hardware this machine does not have — a real GPU, a phone, a pair of
ears — move it to Parked with its context and take the next row, so the batch still
lands real work. Do not write a report about it instead.

One PR for the whole batch. Merge to main when CI is green, then update BACKLOG.md's
header, ranks and Claimed column, and write your decisions into HISTORY.md, before
you finish. A merged PR is not the end of the session.

Break any guard-rail you added on purpose once, from a green baseline, and say which
assertion failed and what it said (#34).
```

**1. Never stop to ask.** If a row needs a judgement call, make it: decide, ship, and record
the call and its reasoning in `HISTORY.md` as a locked decision, so it can be reversed
cheaply. That is what the "Questions for Devon" section below already says to do with an
*answered* question; the change is that a session may answer one itself rather than wait. A
question there **no longer blocks its work.** Devon still intends to work through that list
himself, so do not pre-answer questions you did not need — only the one actually standing in
front of the row you are on, and then write down what you decided and why.

**2. Do not park work on a person.** A row only a human at a real device or a live deployment
can do does not belong in the ranked table. Move it to a parked list with its context intact
and renumber; parking is not the same as verifying, and the note should say which it is.

**3. Size the batch by the Size column and by how many areas it spans** (#382,
2026-09-13). The second axis is the new one. Four ¼ rows across four projects is four
contexts, four suites and four closeouts; two ½ rows inside one project is one of each. The
cost that scales with a batch is the closeout, not the code.

| Size | Same area | Spanning areas |
|---|---|---|
| ¼ | up to **6** | **4** |
| ½ | **3** | **2** |
| 1 | **one**, plus up to two ¼ from the same area | **one** |
| 2+ | **that row is the whole batch** | never pair it with anything |

**Why the same-area column is bigger.** CI is the bottleneck, not the model: Site CI runs in
about 60 s and only Daredevil's suite is slow at 11.5 min, so rows-per-PR is nearly free. The
measured work in a nominal one-session batch is about 800 lines — PR #284 took four ¼ rows and
inserted 839, PR #282 took two ½ rows and inserted 771 — against single PRs in this repo that
merged green at 1,264 (#278), 1,570 (#280) and 4,608 (#236, nine hand-written files). Capacity
is not what the old caps were protecting. What the record actually shows going wrong is
closeout: two line-of-sight checks that passed while doing nothing, Absalom's stride sweep
passing against a deliberately inverted planner, two sessions building Daredevil Phase 4 in
full, and PR #284 itself merging with three of its own shipped rows still in the ranked table
(#381). So the cap rises where the closeout is shared and holds where it is not.

**Whatever the batch, it merges to `main` as one PR** — every row in the batch, in a single
pull request, never one PR per row (changed 2026-09-12; before that a session sometimes opened
a separate PR per row in the same batch).

**A 2+ row will not finish in one session, and that is expected.** Do one increment, ship it,
and **leave the row in place** with its Item text rewritten to say what is done and what is
left. Do not delete a 2+ row until it is actually finished. Stalling on one and swallowing one
whole are both worse than an honest increment. Do not mix sizes to fill a quota: a 2+ row will
absorb whatever time the others leave and finish neither well.

**Respect the Model column when you batch.** Where an item's own source names a model it is
carried across unchanged; every ranked row's model was assigned in Tier 1 on 2026-09-13
(#380), because no ranked row's source named one. Rows naming different models are still one
batch if the sizes allow, but say in the PR body which rows you took and under which model you
actually worked.

**Update `BACKLOG.md` as soon as your one PR merges — never leave it for a later session.**
This is the rule most likely to be dropped as batches grow. Its casualty is on record in the
sibling repo (`GreyVersusBlue/AI_Tools`): a session batched two phases, saved both backlog
rewrites for the end, and its first PR merged with the row still in the ranked table — the
next session spent about an hour rebuilding something that already existed.

The two things that are still not a session's call, because they change what the work *is*
rather than how it is built: **re-ranking the list wholesale**, and **overruling the Ownership
table** in Tier 2.

## Where things stand — start here

**The site is at version 15** (`index.html:575`, and `landing.html:840,861`).
**The last batch of ranked work that shipped** is **Orbital's sector editor
(PR #296)**, the old rank 1 alone — a 1 in one area whose only ¼ row wants a
real device, which is a batch on its own under the size table. The row named
Claude Opus 5 and was worked under Opus 5. That is the line to update when
your batch merges; a PR that only changes these files is not a batch and does
not belong in it. **34 ranked items remain**, and **every one of them names a
model.**

The row is deleted and everything below renumbered, so the ranks in this
header are the new ones. What shipped, and what it means for the next session:

**Orbital has an editor, and a level is a link** (#396 to #400). `#e=<code>` is
a level being built, `#l=<code>` is one to play, and the draft lives in the
address bar rather than in a second save key — the only storage Orbital has is
still `orbital_progress_v2`, so #36 is untouched. `js/levelcode.js` is the
codec: `o1$name$sub$start$goal$bodies`, one letter per body type, 73 to 151
characters for the 22 shipped levels. **The four delimiters `$ ; , @` are
frozen, and they were picked against RFC 3986's fragment grammar rather than by
eye** — `|` was the first choice, Chrome keeps it verbatim, and the grammar
does not allow it, so a client that linkifies the URL is entitled to
percent-encode it and hand the next reader a different string.
`test/levelcode.mjs` holds every level to that character set, so the next
delimiter cannot be chosen by looking at it. **The solvability search lives in
`physics.js` now**, not in a test file, so the editor's Check button and CI run
one implementation at one budget. **A shared level carries no `key`** — it
records no stars and unlocks nothing, so somebody else's level cannot write
into this browser's campaign. What no Node suite could see, and what one pass
in a real browser found: Escape reaching two key handlers at once, the rail
hiding the launch point of every draft, and a link pasted into an already-open
tab doing nothing at all.

The batch before it, kept because it is one session old:
**the quest in `Projects/Castle Conundrum/` is data now** (#393 to #395).
`data/quest.json` is a graph of three stages; `src/quest-graph.js` validates it
before it runs and knows nothing about the DOM, three or timers; the manager
holds no state and no NPC ids. `test/quest.mjs` walks the whole quest in Node
against stand-ins and is the third command in that project's CI matrix entry.
**A dialogue state a stage names has to exist on every NPC, and the riddle has
to open after exactly the conversations that pose it**, both checked against
`npcs.json`. What it still cannot see is `ui.js`'s wiring and the walk; `npm
run play` is that, and it reads the stage off `window.__quest` at the gate.

The batch before it was **Castle Conundrum's asset diet plus its
cabinet/commode clearance (PR #292)**: **`Projects/Castle Conundrum/` is 29
MB, from 165 MB** (#389 to #392). Thirty-six of its forty-eight Poly Haven
folders were referenced by nothing, twenty were texture packs whose `.gltf`
and `.bin` are a 2.3 MB preview ball, and the Kenney kit shipped every model
three times in three formats. What stops it growing back is a reachability
check in `test/assets.mjs` (#390), not a denylist: a file under `assets/Poly
Haven` or `assets/NPCs` has to be named by `data/`, or declared as a buffer or
an image by a `.gltf` that `data/` names. **If you add an asset to that
project, add the reference in the same commit or CI goes red.** `test/layout.mjs`
is beside it and also in CI (#392) — nine interior props against thirty-nine
wall, tower and column pieces, in Node.

**Rank 1 is `Projects/orbital` again — turn the solvability search into a
level generator.** A **1** on **Claude Fable 5.1**, so under the size table it
is either the whole batch or it plus up to two ¼ rows from the same area — and
Orbital's only ¼ row (33) wants a real device, so it goes alone a second time.
It is a better row than it was this morning: the search it would build on is
`OrbitalPhysics.makeSearch`/`findWinningShot` rather than a copy inside a test
file, `OrbitalCode.validate` already says what counts as a buildable level, and
anything generated encodes to a link the moment it exists.
The next half is rank 9. Eleven of the thirty-four are ¼ — ranks 10, 12, 17, 18,
19, 22, 23, 24, 25, 30 and 33. **Five of those eleven want hardware nothing
here has** (17, 19, 24, 25, 33), as do three of the halves (9, 16, 26); the
Parked section below the table says why they were left ranked anyway.

**The model split is 11 Opus 5, 14 Fable 5.1, 9 Sonnet 5.** The rubric is in
Tier 1's preamble, and it is a reading of each row, not a quota — take the
model the row names and say in the PR body which one you actually worked
under.

**Castle Conundrum's board preview and og card are stale** (#374, #379). Both
show the archway wide open, from before the gate became a gate. Recapturing
them is the parked row, and it needs a machine with real GPU compositing.

**`Projects/corner-and-kettle` has no open phase.** Arc one (Phases 1 to 4) and
arc two (5 to 9) have both shipped. What is left is its wishlist's "What this
leaves for a later arc" list — candidates, not a ranked arc, and the largest of
them (reshaping the five recipes that are another recipe's requirement list,
#365) is a balance change with a sweep behind it. Nothing from it is in the
ranked table, and putting one there is a judgement call a session may make.

**`npm run check` and `npm run social:check` now run on every pull request**,
in `.github/workflows/site-ci.yml`, graded by `Tools/board-check/ci-check.mjs`
against `Tools/board-check/known-failures.json` (#351, #352). **Both are green
on their own as of 2026-09-13, and that list is now empty in all three
sections** (#354 to #358): prompt-builder's fonts are vendored and all six
social-tag entries are cleared. **A PR that adds a failure goes red. So does a
PR that fixes one and leaves its line in the list.** Delete the line in the
same PR as the fix. An empty list is the goal state — the next entry to land
there should have to argue for itself.

**Every `.html` in the repo now has a named owner** (#355).
`Tools/board-check/ownership.json` is the machine-readable half of the
Ownership table at the bottom of this file, and `check-integrity.mjs` fails any
page no area claims. A new page needs a line there before it can ship. The two
files are meant to agree; change both.

**Twelve areas that had no workflow now run in CI**, as a matrix in
`site-ci.yml`; a new project's suite goes there, or in its own workflow calling
`.github/workflows/suite.yml`. Not in CI, on purpose (#353): Blue Hour's
`browser.mjs` (real-time movement, #53); Absalom's `browser.mjs` (its own fixed
Chromium path); two browser suites that only speak Playwright while the
harness is Puppeteer on Linux, both belonging to archived tools; and anything
under `npm run games`/`play`/`previews`. Integer Foundry's was the third of
those and is in the matrix now — its failure was a click race, not a missing
method, and every click in it retries a re-query. **It had a second failure mode
nobody had seen, and it was not a race** (#387): the fill-the-order beat put its
sink one column off the board on an order of exactly 8, which the game rolls
about one run in eleven and weighted low, so it had never come up. Fixed
2026-09-14, and then the geometry behind it was moved out of the browser suite
entirely (#388): it is `Projects/integer-foundry/test/order-line.mjs` now, and
`test/smoke-targets.mjs` checks it against every order the opening board can
roll, read out of `rollTarget`'s injectable RNG rather than written down. A
browser run still tests one order size; the arithmetic no longer depends on
which. If that beat goes red again it is the clicking or the timing, not the
plan. **A different beat in that file flaked on 2026-09-14, and it is worth
knowing before you spend an hour on it**: `and the far column takes a tap —
cell empty`, in the `Mobile, 375x812` section, went red on a pull request whose
whole diff was three markdown files, and passed on one re-run with nothing
changed. Same class as #387 and the same answer, the clicking rather than the
plan, but it is the mobile beat and not the fill-the-order one, and it has now
been seen once.

**`Pathfinder/data/` is a published interface** (#350, Devon). Any project may
read it; `Pathfinder/data/README.md` is the contract.

**What Phase 7 built**, kept here because the shop's arc is the repo's longest
and the next person to open it will not have read it. The full record is
`Projects/corner-and-kettle/WISHLIST.md` and `HISTORY.md` ("Phase 7 — A
reopening worth doing", #360 to #366). In short: a reopening is a trade now.
Beans (`state.meta.beans`) are earned at every reopening from
days survived and reputation at close and spent on `META_UPGRADES`, a permanent
tree; `SHOP_LAYOUTS` is the starting configuration, picked at the reopening;
four recipes are gated on prestige level rather than money, and
`sim.recipeAvailable(id)` derives the whole menu rather than storing it (#361);
every price the chalkboard prints is `sim.canBuy().cost`, discount included
(#363); and `sim.reopenPreview()` plus `#reopenOverlay` replaced the
`window.confirm`. `smoke-sim.mjs` 220 → 318, `smoke-save.mjs` 183 → 230, and
`balance.mjs` has a third banded batch (`BAND.loop`, both edges floored at 1.0)
that costs it 63 s → 88 s.

**What Phases 8 and 9 built** (#367 to #373). The station panel is playable on
the keyboard: ten letters `q` to `p`, **read off the buttons after they render**
rather than written down anywhere, printed as a legend under the station tabs
on the same pass, so an unlock cannot leave the legend stale. `[` and `]` move
the focused station with a wrap. `drive-save.mjs` 135 → 156. And
`Tools/board-check/play-games.mjs` has a `corner-and-kettle` section at last —
the registry entry in `games.mjs` had existed since Phase 4 with nothing
reading it. **A full `npm run games` reports 9 failures that are not this
work's** (#373): seven in Golden Hour, one aborted Integer Foundry run, one in
The Fourth Quarter, all reproducing on `main`. Golden Hour's are the class #53
calls inconclusive under a software-rendered Chromium, and `npm run games` is
outside CI on purpose (#353) — so nothing there went red, and none of it is
fixed.

Two findings **Phase 7** left behind, both in the wishlist's later-arc list:
**five recipes were already another recipe's requirement list** (Cappuccino is
Latte's; Affogato and Doppio are Americano's — #365, named in an assertion
rather than reshaped), and **the Legacy tree is measurably indistinguishable
from wasting the beans** at one pair of hands, because a shopper's income is
the door and the door is the prestige level's spawn floor.

---

# Tier 1 — the ranked index

One line per item, for scanning. `Area` is the folder the work lands in.
`Size` is ¼, ½, 1 or 2+ sessions. `Model` is what the item's own source names,
and where the source names nothing it is **assigned here** (#380, 2026-09-13) —
every row carried `—` before that, because none of the forty came from a
wishlist. A row whose source does name a model still carries that name
unchanged; a wishlist phase is not re-decided in this table. The three
readings, in the same terms the project wishlists already use:

- **Claude Sonnet 5** — the work is bounded and an oracle already exists: a
  code block written out below, an assertion body already drafted, a documented
  expected value, a second view to diff against. A mistake is loud and
  immediate.
- **Claude Opus 5** — the default. Real design or engineering judgement against
  a live codebase, with a suite or a visible result underneath it to catch a
  wrong answer.
- **Claude Fable 5.1** — a wrong answer is silent. A pure model layer with
  invariants nothing on screen reveals, a save schema every later adopter
  inherits, authored content whose coherence no assertion can hold, or a change
  with no safety net under it at all.

Fifteen rows read Fable, which is a heavier share than any single project's
wishlist carries, and the reason is what this list is: the leftovers of ten
projects are disproportionately save layers, pure models, and atmosphere
nothing in CI can look at.

`Claimed` is blank until a session writes its branch name in, and is cleared
after that branch merges. **A claim counts only once it is on `main`** (#283):
write it, open a one-line PR, merge it, then start. On 2026-09-11 two
sessions each wrote their branch into this row on their own branch, neither
could see the other's, and both built Daredevil Phase 4 in full — #220 merged
and #222 was closed unmerged an hour of suites later.

| Rank | Item | Area | Size | Model | Claimed | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Turn `physics.js`'s solvability search into a level generator | `Projects/orbital` | 1 | Fable 5.1 | `claude/sweet-babbage-00jhzv` | [Orbital](#orbital) |
| 2 | Multi-offer escalation wars as a dedicated flow | `Projects/Closing Time` | 1 | Opus 5 |  | [Closing Time](#closing-time) |
| 3 | A commercial tier at Broker-Track | `Projects/Closing Time` | 1 | Opus 5 |  | [Closing Time](#closing-time) |
| 4 | Tides as a real axis | `Projects/golden-hour-beach` | 1 | Fable 5.1 |  | [Golden Hour](#golden-hour) |
| 5 | The causeway: the top half of the trail rides up to 10.9 m above the hillside | `Projects/blue-hour-trail` | 1 | Opus 5 |  | [Blue Hour](#blue-hour) |
| 6 | The mountain has no peak — `mountainH` is a ramp in `z` | `Projects/blue-hour-trail` | 1 | Opus 5 |  | [Blue Hour](#blue-hour) |
| 7 | One shared asset pipeline (prune, resize, draco/meshopt) for the ~380 MB across three games | `assets` | 2+ | Fable 5.1 |  | [The site itself](#the-site-itself) |
| 8 | `gvb-save.js` v2: quota accounting, multi-key namespaces, an IndexedDB tier | `assets` | 1 | Fable 5.1 |  | [The site itself](#the-site-itself) |
| 9 | A real-hardware pass: every atmospheric piece's numbers are software rasterization, and touch has never had a thumb on it | `site` | ½ | Opus 5 |  | [The site itself](#the-site-itself) |
| 10 | Extend `Pathfinder/tests/anathema.test.mjs` rather than starting a second suite, if the page gains interaction logic | `Pathfinder` | ¼ | Sonnet 5 |  | [Anathema Archive](#anathema-archive) |
| 11 | Build the generator's Chronological merge/sort step, if the two chronicle views ever drift | `Pathfinder` | ½ | Sonnet 5 |  | [Pathfinder Campaigns](#pathfinder-campaigns) |
| 12 | A commented-out `<template>` dossier block | `Pathfinder` | ¼ | Sonnet 5 |  | [Pathfinder Characters](#pathfinder-characters) |
| 13 | In-browser editing via `gvb-save.js`, if the page's role shifts from showcase to living sheet | `Pathfinder` | ½ | Fable 5.1 |  | [Pathfinder Characters](#pathfinder-characters) |
| 14 | Touch/gamepad input — a full second input scheme, not a HUD addition | `Projects/aphelion` | 1 | Opus 5 |  | [Aphelion](#aphelion) |
| 15 | Multi-career history — a hall of past scorecards | `Projects/Closing Time` | 1 | Fable 5.1 |  | [Closing Time](#closing-time) |
| 16 | A real hour on the beach with ears on: event pacing, sanderling flush distance, cricket density, night palette banding | `Projects/golden-hour-beach` | ½ | Fable 5.1 |  | [Golden Hour](#golden-hour) |
| 17 | A real low-end-GPU run — the world is 10x bigger and every number is software rasterization | `Projects/golden-hour-beach` | ¼ | Sonnet 5 |  | [Golden Hour](#golden-hour) |
| 18 | Preview recapture and a board-card description refresh — it undersells the piece by about six features | `Tools/board-check` | ¼ | Opus 5 |  | [Golden Hour](#golden-hour) |
| 19 | A touch playtest on a real phone — the pill-as-throw-control needs a thumb on glass | `Projects/golden-hour-beach` | ¼ | Opus 5 |  | [Golden Hour](#golden-hour) |
| 20 | `play-games.mjs` beats off the new `?debug` `__gh` hook | `Tools/board-check` | ½ | Sonnet 5 |  | [Golden Hour](#golden-hour) |
| 21 | If night proves popular: the owl hunts, and the fireflies drift toward the fire | `Projects/golden-hour-beach` | ½ | Fable 5.1 |  | [Golden Hour](#golden-hour) |
| 22 | Register Blue Hour in `Tools/board-check/games.mjs` | `Tools/board-check` | ¼ | Sonnet 5 |  | [Blue Hour](#blue-hour) |
| 23 | A `capture-previews.mjs` recipe, then `npm run previews blue-hour` and `npm run promote` | `Tools/board-check` | ¼ | Sonnet 5 |  | [Blue Hour](#blue-hour) |
| 24 | A real GPU run: the mist banks' fill cost, the headlamp at decay 1, the lamp's feet-pool at real pixel density | `Projects/blue-hour-trail` | ¼ | Sonnet 5 |  | [Blue Hour](#blue-hour) |
| 25 | A touch playtest on real glass — hold-the-bottom-third-to-walk has never had a thumb on it | `Projects/blue-hour-trail` | ¼ | Opus 5 |  | [Blue Hour](#blue-hour) |
| 26 | An hour on the trail with ears on: dread cooldowns, fog periods, drone gains, the new stingers | `Projects/blue-hour-trail` | ½ | Fable 5.1 |  | [Blue Hour](#blue-hour) |
| 27 | The phantom's downhill pan is exactly 0.000 — decide whether to mean it | `Projects/blue-hour-trail` | ½ | Fable 5.1 |  | [Blue Hour](#blue-hour) |
| 28 | Beats that change in kind above the fog line, not just in rate | `Projects/blue-hour-trail` | 1 | Fable 5.1 |  | [Blue Hour](#blue-hour) |
| 29 | The two conservative model gaps, as one coupled piece of work | `Projects/integer-foundry` | 1 | Fable 5.1 |  | [Integer Foundry](#integer-foundry) |
| 30 | Whether the tile-cost hint should be more prominent once targets run past two digits | `Projects/integer-foundry` | ¼ | Opus 5 |  | [Integer Foundry](#integer-foundry) |
| 31 | A 4th prong or deeper side content, only if Devon expands scope | `Projects/the-fracture-cycle` | 2+ | Fable 5.1 |  | [The Fracture Cycle](#the-fracture-cycle) |
| 32 | A committed browser-driven test layer: grid render/unlock, save/reset/wipe, star display | `Projects/orbital` | ½ | Opus 5 |  | [Orbital](#orbital) |
| 33 | Verify the rotate-to-play gate on a real device or real touch emulation | `Projects/orbital` | ¼ | Sonnet 5 |  | [Orbital](#orbital) |
| 34 | Revisit `gvb-save.js` adoption for save-bar UI consistency | `Projects/orbital` | ½ | Fable 5.1 |  | [Orbital](#orbital) |

## Parked — needs a person at a real device

Rule 2 above: a row only a human at a real device or a live deployment can do
does not belong in the ranked table. **Parked is not verified**, and each note
says which it is. Nothing here is done; it is waiting on hardware, not on a
decision.

**Castle Conundrum's board preview: recapture, look, promote** (`Tools/board-check`,
¼, **Claude Sonnet 5** under #380 — a written recipe and a promote step, at a
keyboard that can run them). Parked 2026-09-13 by the session that took it as rank 1,
after establishing three things.

1. **There is no candidate to review on a fresh clone.** `candidates/` holds
   `chosen.json` and nothing else — the PNGs it names have never been in git.
   The frame the row asks somebody to look at exists only on the machine that
   captured it, so "review the captured candidate" is not a thing an unattended
   session can do at all.
2. **A recapture here is not a recapture.** `node capture-previews.mjs
   castle-conundrum` under a software-rendered Chromium fails at
   `never got 6.4m clear of the gatehouse`: the walk never happens. That is the
   class locked decision #53 calls inconclusive, and `npm run previews` is
   outside CI on purpose (#353).
3. **The shipped frame is now wrong in a new way** (#374). `assets/previews/
   castle-conundrum.jpg` and `assets/og/castle-conundrum.jpg` show the archway
   standing wide open, ground and sky visible through it, with the quest box in
   the corner reading "Find someone who knows how to open the gate". No door of
   any kind is in the frame, which dates it to before round 3's hinge fix — the
   leaf then sat at world x -5.4 to -1.8, behind the wall and out of shot. Since
   #374 there is a gate to photograph, so a candidate captured before
   2026-09-13 is out of date whatever else is right about it.

So: `npm run previews castle-conundrum` on a machine with real GPU
compositing, look at what lands in `candidates/`, and `npm run promote`.
Fifteen minutes at the right keyboard, and not doable at any other.

Eight rows still in the ranked table ask for hardware or a pair of ears in as
many words, and belong here by the same rule: 9, 16, 17, 19, 24, 25, 26 and
33 as they are numbered now (they were 10, 17, 18, 20, 25, 26, 27 and 34 before
the fourth 2026-09-14 batch removed one more row above them, 11, 18, 19, 21,
26, 27, 28 and 35 before the third, 12, 20, 21, 23, 28, 29, 30 and 37 before
the second, and 14, 22, 23, 25, 30, 31, 32 and 39 before the first). They were left ranked on
purpose — moving eight more rows is closer to re-ranking the list wholesale,
which is not a session's call, than to parking the row in front of you, which
is. A session that takes one of them should move it here rather than write a
report about it.


---

# Tier 2 — the ideas with no wishlist home

Twelve projects and areas have no `WISHLIST.md`. Everything they had lives
here, carried across from their prompt file's "Your task", their notes file's
"Next session", "Deliberately not done" and "Shared-file requests", and any
README roadmap — in the wording those files used, not summarised. The
per-project files themselves are deleted; git history has them.

## Anathema Archive

`Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json
data.py`, `Pathfinder/tests/`.

Round 1 did the open-ended audit (data loading, manifest integrity,
search/filter/keyboard access, mobile layout — all in good shape). Round 2
built the test suite, swept `renderNpc`, and fixed the stale comment. **Nothing
is currently outstanding for this project's own feature work.**

If a future round finds something real:

1. **Extend `Pathfinder/tests/anathema.test.mjs`** rather than starting a
   second suite, if this page gets more interaction logic. The
   `waitFor`/`clickCat`/`clickLevelChip` helpers and the `freshPage()` pattern
   (fresh headless page per scenario, cheap since boot only fetches
   `manifest.json` until a category is picked) should cover new
   state-machine-shaped features without much new plumbing. Two things worth
   knowing if you do: (a) `page.evaluate(fn, arg)` re-parses `fn`'s source in
   the browser, so it can't close over this file's Node-side variables — pass
   anything from here through the single `arg` parameter, or bake a literal
   directly into the function source; (b) the page's top-level `const`/`let`
   bindings (`S`, `openDetail`, etc.) ARE reachable from `page.evaluate` by
   bare name, since Puppeteer/Playwright's `evaluate` shares the page's global
   lexical environment (same mechanism that lets DevTools console see them) —
   just don't route through `window.S`, since top-level `const` never becomes a
   `window` property.
2. **`Pathfinder/data/` is published** (#350, Devon, 2026-09-13; Q1 struck).
   Other projects may read it. Before a change that renames, moves or drops a
   file or field, search the repo for `Pathfinder/data` and run each
   reader's suite. `Pathfinder/data/README.md` is the contract.

Deliberately not done, and still the right call:

- **The `renderNpc` data-sweep script isn't committed.** It was a one-off
  read-only analysis (load every npc shard, check for AC/HP/Speed/Perception
  duplication in prose) to answer a specific question, not a reusable check —
  there's no ongoing invariant here to guard, since the answer was "this bug
  class doesn't structurally apply to this renderer." If a future session wants
  to re-run something like it, the approach was: for each creature with
  non-empty `system.details.publicNotes`, regex the structured field's value
  against the prose with a word boundary (`\bac\s*48\b` etc.) and hand-check
  any hit — the false-positive rate is real, so hand-checking hits matters more
  than the regex itself.
- **Not adding a `package.json` under `Pathfinder/tests/`.** The suite imports
  `playwright-core`/`puppeteer-core`/`@sparticuz/chromium` indirectly through
  `Tools/board-check/harness.mjs`; Node resolves those bare specifiers relative
  to `harness.mjs`'s own location, not relative to the importing file. No
  dependency of its own to declare, so no manifest to add.
- **Not re-litigating the `gvb-save.js` decision or the file-split question**
  from round 1's notes. Both are still current per that session's reasoning and
  nothing found since changes either call.

## Pathfinder Campaigns

`Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/`.

**Nothing urgent stands out on this page's own rendering or content.** Round
1's pass (card chrome, ember animation, foil-sweep title, contrast) plus round
2's `[shared]` markers still stand as the page's last real content/rendering
review. Round 3 made zero edits and found zero findings.

1. **If the generator gets used and the Chronological tab drifts out of sync
   with the By-Character view**, build the merge/sort step the generator's own
   README documents as a known gap: the Chronological tab is the same
   per-character scenarios, re-sorted by scenario number across each org. The
   generator already reads the same per-character JSON that could derive this
   automatically — not worth building ahead of an actual sync problem. Checked
   again in round 3; still in sync. Building it speculatively is exactly the
   scope creep the "keep it a small script, not a live editor" reasoning was
   written to avoid.
2. **The merge with `characters.html` is answered and closed** — "harmonize,
   don't share", round 2, locked decision #17 stays in force for this pair.
   Don't re-litigate it.

## Pathfinder Characters

`Pathfinder/characters.html`, `Pathfinder/characters-assets/`.

**Nothing urgent on this page itself.** Fonts vendored, heading order fixed,
contrast fixed, now cross-checked against its twin and confirmed to still
match. The merge question — this project's own headline item across two rounds
— is answered; don't re-litigate it.

1. **A commented-out `<template>` dossier block**, if Devon specifically asks
   for it (documentation convenience, not a bug — still not built, still
   Devon's call on style).
2. **In-browser editing via `gvb-save.js`**, only if Devon decides this page's
   role should shift from showcase to living character sheet. Still not
   requested, still not built.
3. **Drift between this file and `campaigns.html` is a test now**, not a pass
   somebody has to remember to do: `tests/shared-chrome.test.mjs`, in CI
   (2026-09-13, #378, PR #284). There was none to find. If you add a `[shared]`
   block to the pair, add it to that file's `BLOCKS` list — it counts the
   markers and fails on one it has not been told about.

Still not touching the font-file-naming mismatch between this page's fontsource
convention and `campaigns.html`'s short form. Same bytes, cosmetic only, not
worth the churn.

## Aphelion

`Projects/aphelion/`.

Round 1 vendored the fonts, adopted `gvb-save.js`, and ran a full
fun/performance/audio/accessibility audit. Round 2 built the EVA distance
readout that audit flagged as optional. Round 3 (2026-09-14, #383 and #384)
built the airlock-entry beat and landed the `#signal` assertion round 2 had
drafted and could not place. **`npm run games aphelion` is 11 checks → 21, all
green**, and no game code changed — the beat drives `setEVA` through the inner
hatch the way a player does, asserts the readout is silent inside first, then
`SALVAGE 13m · 25m · 38m` outside, nearest-first, then quiet again on the way
back in. The blocker that had carried this across three rounds was not Aphelion
at all: `camState` could not read a heading of ±π, so the walk aft was
unsteerable (#383).

**Nothing urgent is left on the core game.** What remains is one low-urgency
item the notes have carried across four rounds now, still with no forcing
signal:

1. **Touch/gamepad input, if this ever needs to run somewhere pointer lock
   isn't an option** (a tablet, say). A full second input scheme, not a HUD
   addition. Round 1's arrow-key look closed the specific gap the original
   audit found (pointer lock denied leaves a player able to walk in a straight
   line and nothing else); this would be a genuine mobile-support feature. Not
   attempted in any round. **Only worth it if there's an actual reason this
   needs to run on a touch device** — still no such reason. Third round
   carrying this with the same conclusion. If a future session wants to settle
   it rather than carry it a fourth time, the honest move is to ask Devon
   directly whether Aphelion ever needs to run on a tablet or phone, rather
   than each round re-deriving "no evidence yet" from scratch.

Two full audit rounds (fun, data-driven extension points, audio, performance,
accessibility) plus a re-check found nothing else worth touching. Inventing a
change to have something to report would be worse than reporting none.

## Castle Conundrum

`Projects/Castle Conundrum/`, `Tools/board-check/play-castle.mjs`.

**As of round 3 the project has no known open bugs.** Round 3 closed all four
of its own tasks (the four objects sealed in the back wall, the preview
recapture and promotion, `play-castle.mjs`'s own engine-mismatch bug, the gate
door's hinge/pivot math) — confirmed independently, not just trusted from
notes: `npm run play` reports 34/34 beats passing, real movement, real GPU
compositing.

**The gate door is a gate now** (2026-09-13, #374 to #376, PR #284). The mesh
question below was answered by finding that the "mesh" was a Poly Haven
material-preview ball, and the leaf is built geometry shaped to the archway's
own opening. **The preview candidate row is parked**, above the Tier 2 list —
and the frames on the board are stale in a new way, because they were shot
before the gate existed.

**The asset diet shipped and so did the clearance margins** (2026-09-14, #389 to
#392, PR #292). 165 MB is 29 MB: thirty-six of forty-eight Poly Haven folders
were referenced by nothing, twenty were texture packs carrying a 2.3 MB
preview ball, and the Kenney kit shipped every model in three formats where
`loadModel` reads one. `GothicCabinet_01` and `GothicCommode_01` stood 1.143 m
and 1.311 m off their side walls and now stand 0.103 m and 0.111 m off them;
the hall columns turned out to constrain only in `z`, so 0.6 m south dissolved
the choice the round-3 note called forced.

**There are two suites now, both in CI, and both matter to anything you add
here.** `test/assets.mjs` fails any file under `assets/Poly Haven` or
`assets/NPCs` that `data/` does not name, directly or through a `.gltf`'s
buffers and images — **add an asset and its reference in the same commit.**
`test/layout.mjs` fails any interior prop that overlaps a wall, tower or column
in plan, and holds the two cabinet margins to a 0.02–0.30 m band. Neither can
catch a change to `castle-builder.js`'s placement math, because `layout.mjs`
re-implements it; `npm run play` is still the thing that holds those two
together, and it needs real GPU compositing.

**The quest is a graph now** (2026-09-14, #393 to #395, PR #294). The 74-line
manager and its two booleans are `data/quest.json` — three stages, each with an
objective, the dialogue state every NPC switches to, the transitions out and
the actions on entry — read by `src/quest-graph.js`, which validates the graph
before it runs and imports nothing that needs a browser. `src/quest-manager.js`
is the adapter: it lists the three actions the data may name (`openRiddle`,
`openGate`, `showVictory`) and runs them, and it knows no NPC by id. There are
three suites now: **`test/quest.mjs`** drives the real manager through stand-in
UI, NPCs and castle and walks the quest both ways, and it is in the CI matrix
beside the other two. `play-castle.mjs` reads the stage off `window.__quest`
at the gate. To add a stage, add it to the data; the suite says what is missing.

**Nothing ranked is left for this project.** The parked preview recapture
(above the Tier 2 list) is the only open thing, and it needs a GPU.

**Two things are decided, not open work, and don't need re-deriving:**

- **Leave the walls stylised.** Five 1k Poly Haven stone sets already sit on
  disk unused. Round 1's before/after pairs settled it.
- **No save.** The quest is one stage id (`quest.stage`) and about fifteen
  minutes long. If a future session still wants it: there is no existing key to
  preserve, so locked decision #36 doesn't bind, and the stage id is the thing
  to write.

## Closing Time

`Projects/Closing Time/`.

**Round 3 closed both items round 2 left open** (the name-substring Ledger
filter, the career-ending dead end). **`npm run games closing-time` runs clean
now** — 27 checks, 0 failed, four consecutive runs (2026-09-13, #377, PR #284),
and still 27/0 after round 4.

**Round 4 (2026-09-14, #385 and #386) shipped per-client financing**, in a new
`js/engine/financing.js`. A buyer is `cash`, `conventional`, `fha` or `va`, and
it moves the NPC listing agent's accept floor, the soonest the deal can close,
whether an appraisal and a financing milestone are scheduled at all, the
fall-through roll, and whether the appraiser reviews condition as well as value.
Measured on `ls_0001`, ask $168,000: cash is taken to $144,750, conventional to
$150,000, FHA stops at $155,000. `tools/smoke.mjs` 127 → 150. The type derives
from a hash of the client id rather than `rand()`, because `repairCareer`
backfills it and repair runs on every load (#386). What's left:

1. **Multi-career history.** The scorecard's button answers "how do I start the
   next career," not "does this career leave a record anywhere." A save that
   remembers more than the one career currently in progress — a hall of past
   scorecards, say — is a genuinely bigger feature and still out of scope for
   what round 3 asked. Worth raising with Devon if the ending sticks as
   something players actually hit repeatedly, same as the last three rounds'
   notes said.

From the README's own "Design notes for future expansion", which was this
project's only plan and is being retired from that file:

- **The priority-tested slice** — the buyer loop, seller loop, open houses,
  events, brokerages, market drift, referrals, and career ladder — is all live.
  Per-client financing shipped in round 4. **The two next layers still open:
  a commercial tier at Broker-Track, and multi-offer escalation wars as a
  dedicated flow.** A 150-assertion suite would hold them.
- **The unhandled edge case.** `repairCareer()` makes adding and removing
  content from a live career safe — it backfills and drops `listingsState`,
  `market.nb` and `knowledge` entries against what's actually in `data/`. But
  **a deal or listing still actively under contract on deleted content is a
  separate, unhandled edge case: don't delete a listing a save might be
  mid-contract on.**

Two conventions that stay in the README rather than moving here: anything new
added to `S` belongs in `repairCareer()` the same day it's added, especially if
arithmetic touches it; and `log(text, cls, kind, recId)`'s fourth argument tags
a line as belonging to one client, which is what the Ledger's per-client filter
matches on. A handful of `log()` calls are deliberately left without a `recId`
— the weekly rate announcement, the Monday-begins line, brokerage
recruitment/decline — because they aren't about one specific client, and no
per-client filter should ever match them.

## Golden Hour

`Projects/golden-hour-beach/`.

The last big session grew the world 10x on one decision — the shoreline is a
curve, `shorelineZ(x)`, and everything works in shore distance `s = z -
shorelineZ(x)` — and Devon overrode two locked decisions to allow it: the sun
sets now (six keyframes, not two), and there is a save, narrowly (`journal.js`
persists discoveries only; sun position and player position are pointedly
absent from the schema). Source grew from about 1,900 to about 5,600
hand-written lines across 27 modules, with zero new asset bytes and zero
offsite requests.

What's left:

1. **A real hour on the beach, ears on, tuning pass:** event pacing (bait ball
   every 10 to 18 min, whale about 20, both guesses until someone sits through
   them), sanderling flush distance, cricket density, night palette banding on
   a real monitor.
2. **The still-open real low-end-GPU run from the last backlog, now genuinely
   urgent:** the world is 10x bigger and the proxy numbers are software
   rasterization, not a weak real GPU. Confirmed the qualitative direction
   (water stays the dominant relative cost); the actual absolute numbers on a
   weak integrated GPU are still unmeasured. `renderer.info` at the widest home
   view reads 157 draw calls and 316k triangles, against a 300-call budget.
3. **Preview recapture (`npm run previews`) and a board card refresh for the
   description: it undersells the piece by about six features now.**
4. **Touch playtest on a real phone:** the pill-as-throw-control needs a thumb
   on glass, not a mouse pretending.
5. **If night proves popular:** the owl could hunt (one swoop over the dunes,
   no kill shown), and the fireflies could drift toward the fire when it burns.
6. **`Tools/board-check/play-games.mjs` can lean on the new debug hook**
   (`?debug` exposes `window.__gh`: `setSunT` which also syncs the moon,
   `teleport`, `face`, `pos`, `journal`, `events`, `info`). Suggested beats:
   scrub to 1560 and assert star opacity plus a journal DOM entry; teleport to
   the headland and assert the place card; throw a stone and assert the hint
   cycle; reload and assert the journal survived while `sunT` reset. All
   assertions can go against the DOM or `__gh.journal()`, per locked decision
   #39's split.
7. **`assets/js/gvb-save.js` line 32, the "Adopted by" comment: add Golden
   Hour.** Still not done — the comment currently lists eleven adopters and
   Golden Hour is not among them.
8. **Tides as a real axis.** Named as this project's real upgrade path, blocked
   first on the same thing as the real-GPU run above.

Deliberately not done, and still the right call:

- The original quartet (dolphin, gulls, boat, jet) was not migrated into
  `js/creatures/`. It is tuned, tested, and lives fine where it is; a mechanical
  move risks regressions for zero player-visible gain. The registry pattern is
  established for everything new.
- The curlew is not a journal species. Not everything should be collectable.
- No chunk LOD swapping. Measured first: 157 calls and 316k triangles at the
  worst view is nothing, and frustum culling already drops distant chunks.
- No estuary-specific soundscape bus beyond the curlew timer. The reeds and
  distance already quiet the surf; a dedicated layer can wait for ears-on
  tuning.
- The whale has no fluke. Two sprites and restraint.
- **Wildlife retuning is closed**, not carried forward: round 3 watched it for
  real and found no case for changing anything.

## Blue Hour

`Projects/blue-hour-trail/`. Six sessions, no prompt in the numbered system, no
`WISHLIST.md`.

1. **The direction question — settled, session 4.** One reading verb, one
   memory, one findable tool, granted by Devon explicitly and narrowly.
   Anything further in the verbs/persistence/collection direction needs a new
   grant, and Golden Hour parity remains the odd one out. The live choice now
   is: keep pushing into `dread.js`, or write "no save, no verbs, no
   collection" into the record as a locked decision.
2. **Beats in kind above the fog line.** The beats are still the same five
   everywhere on the mountain — only their *rate* changes with altitude.
   Something should change in kind up there. The figure in the lookout is one
   answer and currently the only one. Session 4 filled the slot the original
   task was holding open; more are welcome if they obey the doctrine.
3. **A real GPU run.** Every number on this project is still swiftshader —
   1.0–1.8 fps — now including the headlamp's SpotLight cost and the newly-alive
   mist/breath fill rate, which makes this MORE urgent than before, not less:
   two full-screen-capable transparent systems that had never actually drawn
   are drawing now. Nobody has measured the actual frame rate of this piece
   anywhere. Three specific things to look at now that the session-5 retunes
   landed: the mist banks' fill cost (30 large transparent quads, more of them
   near the camera than before), the headlamp at decay 1 (cheaper than it looks
   — one SpotLight either way), and whether the lamp's feet-pool and 12 m reach
   still read right at a real frame rate and real pixel density. The geometry
   numbers are honest and comfortable — 35 draw calls, 280k triangles against a
   budget of 300 — but this piece leans hard on large transparent billboards in
   fog, which is fill-rate cost software rasterization reports very differently.
4. **A touch playtest on real glass.** The hold-the-bottom-third-to-walk scheme
   has never had a thumb on it — and the logbook's hold-the-chip-to-read and
   the headlamp button have joined it untested.
5. **An hour on the trail with ears on.** The dread cooldowns (55–100 s, first
   beat at 70 s) and the fog periods (211 s and 337 s) are unheard guesses; the
   drone gains, the new radio/transmission stingers, the headlamp partial and
   the descending phantom curve are too. They want a real walk, not a scrub. If
   Devon plays a build and leaves listening notes, tune the constants from
   them; session 4 left every level as authored.
6. **The causeway — Devon's call (session 6).** The top half of the trail rides
   up to 10.9 m above the hillside on both sides and the descent is the view
   that shows it. Three ways out, none of them a cleanup: give `mountainH` a
   term that follows the trail's arc-length height instead of `z` alone; or
   re-anchor `trailYof` to the hillside it actually crosses; or decide a ridge
   trail is what this is and widen the bench so it reads as ground rather than
   a levee. All three move the heightfield and rebaseline `smoke.mjs`, and the
   third also has to answer why the blaze posts stand at the lip of a 10 m
   drop. **Whoever takes it: walk down afterwards, not up.** `smoke.mjs` holds
   10.9 m as a ceiling.
7. **The mountain still has no peak.** `mountainH` is a ramp in `z`, and the
   last stretch of trail still rides a ~5 m berm. Both are invisible under the
   weather session 2 added, and both become real again the instant anyone lifts
   the fog at the summit.
8. **The phantom's downhill pan does nothing — decide whether to mean it**
   (session 6). `downhillAt` returns the reverse of the trail tangent, so for a
   walker facing along the trail the pan is exactly 0.000 in both directions of
   travel; the beat's descent is carried entirely by the falling pitch. Either
   accept that (the honest reading: those steps are behind you or ahead of you,
   and stereo cannot say which) and reword the ladder, or point `downhillAt` at
   the terrain's fall line, which IS lateral on every switchback leg and would
   make the sentence true. The second changes the eyes' drift and the shape's
   head-flip too, since all three read the same function — which is an argument
   for doing it deliberately or not at all. A browser check fails the moment
   anyone changes it, on purpose.
9. **`Tools/board-check/games.mjs` — register the piece** so the integrity,
   collision and preview passes stop skipping it. It boots exactly like Golden
   Hour (click `#overlay`, never the canvas — while the overlay is up it covers
   `#scene` and a canvas click never lands):

   ```js
     'blue-hour': {
       title: 'Blue Hour',
       url: '/Projects/blue-hour-trail/',
       vw: 1320, vh: 800, dsf: 1,
       three: '/Projects/blue-hour-trail/libs/three.module.js',
       intro: ['#overlay'],
       async open(p, { probe } = {}) {
         await p.waitForSelector('#scene');
         if (probe) await probe();
         await p.click('#overlay');
         await p.waitForSelector('#overlay.hidden', attached);
         await wait(1200);
       },
     },
   ```

   There is no `saveKey`: the piece has no save, on purpose, and adding one
   would imply a save it does not have.
10. **`Tools/board-check/capture-previews.mjs` — a recipe, then `npm run
    previews blue-hour` and `npm run promote`** to produce
    `assets/previews/blue-hour.jpg`. The board card at `index.html:460` exists
    but carries no `data-preview`, so this is the half of the original request
    that never landed.

    ```js
      // ---- Blue Hour: stay in the woods. The trail corridor with the footbridge
      // ahead is the piece's best single frame.
      'blue-hour': {
        async play(p, { shot }) {
          await p.keyboard.down('KeyW'); await wait(4000); await p.keyboard.up('KeyW');
          await wait(1500);                 // let the mist layer drift
          await shot('trail');
          const c = await camState(p);
          return `walking at ${c.pos.join(', ')}, yaw ${c.yaw}`;
        },
      },
    ```

    The summit reads at 24.3/255 now and the fire lookout in fog is the
    strongest single frame in the piece, so either shot is defensible; the trail
    recipe is the safer capture (no teleport, no debug hook), and a summit shot
    would give away the figure on the board card, which is an argument against
    it. The `?debug` hook is available to any of these if a deterministic frame
    is wanted. The full set of doors, from session 1:
    `setWeatherT`/`getWeatherT`/`fogT`/`altT` (the fog cycle is this piece's
    sun, and scrubbing it is how you see both phases in one run),
    `teleport`/`face`/`pos`/`surface`, `cairns`/`layout`,
    `trail`/`yawAlongTrail`, `fireDread`, `dread`, and `info`. Nothing in the
    piece itself opens any of them.

    **`yawAlongTrail` exists because of a bug somebody wrote and then had to
    diagnose**: the trailhead sits at z 145 with `BOUNDS.maxZ` at 150, so a
    test that guesses "face +z and hold W" walks into the edge of the world 5 m
    later and reports a movement bug that isn't there. Handing tests the
    centerline is cheaper than every future session rediscovering it.

    **Absolute timing under software GL is worthless here.** The browser suite
    measures its own frame rate and scales its one timing assertion by it
    rather than hard-coding a distance. Under swiftshader it sees **1.7 fps**,
    and `main.js` clamps `dt` to 0.1 s, so the world genuinely runs in slow
    motion at roughly a tenth speed. That clamp is correct — it stops a stalled
    tab from teleporting the walker — but any future session reading a walk
    distance from this piece must scale it.

Deliberately not done, and still the right call:

- **The summit was not rebuilt.** Documented with numbers instead. Every fix
  moves the heightfield or the world layout, and `smoke.mjs` pins expectations
  that would move with it.
- **The `dread.js` split is the only change to a piece file.** A refactor of
  dread's scheduler into a registry (Golden Hour's creature pattern) was
  considered and dropped — it is tuned, it is tested, and a mechanical move
  risks regressions for zero player-visible gain.
- **No LOD or culling work.** Measured first: 35 draw calls and 280k triangles
  against a budget of 300. There is nothing to optimise, and the instancing is
  already doing it.
- **The chip timing is real seconds now** (session 5) — it ticked 1/60 per
  frame, which meant minutes on a slow tab and 2.4 s at 144 Hz. If any future
  UI element grows a timer, tick it by `dt`, not by frame.
- **The logbook proofread is done** (session 5). All ten pages read through the
  overlay in trail order. If the texts ever change again, walk them again — the
  source order is not the mountain's order.

## Integer Foundry

`Projects/integer-foundry.html`, `Projects/integer-foundry/`.

**`test/browser.mjs` passes on Linux now and is in CI** (2026-09-13, PR #278).
It was a race, not a missing method: Puppeteer's `page.click` resolves the
element, then scrolls and measures it before pressing, and the factory line
re-renders `#grid` in that gap. Every click goes through the same
re-query-and-retry helper `Pathfinder/tests/anathema.test.mjs` uses. Five
consecutive runs 56/0 fixed, against three runs aborting at 38, 50 and 17
checks reverted. In `site-ci.yml` with `install: Tools/board-check`.

**`test/browser.mjs` still has one racy assertion** (2026-09-13, seen on PR
#284, whose diff does not touch this project). "and the far column takes a tap"
failed in CI with `cell empty`: `place()` clicked the sink tool and then the
cell, neither click threw, and no sink landed. The `click()` helper at the top
of the file retries a click that THROWS — detached node, not-an-Element — and
that is the race #278 fixed. This is the other one: the click lands, on a node
the grid re-rendered under it, and places nothing. Six local runs, three with
the harness change that PR made and three without, were 56/0 either way, so it
is not that change; the same job passed on the two commits before it. The fix
is the same shape as the last one — assert the placement and retry `place()`,
rather than trusting one that did not throw — and it belongs to whoever next
opens this project rather than to a PR that only shares a CI file with it.

The other item still on the table is deliberately parked, not forgotten:

1. **The two conservative model gaps, if Devon or a future session wants them
   despite the coupling argument.** Both are safe-direction (make orders easier
   than they need to be, never harder), so neither is urgent: mergers/splitters
   are left out of the BFS entirely (a board with `Merge x` but not `x2` gets
   orders capped at 47 on a floor that could reach roughly 529); `opBudget`
   divides the floor evenly across sinks placed, ignoring shared prefixes
   through a splitter.

   Round 3 looked at these longer than "not urgent" alone would justify,
   because the prompt flagged `opBudget`'s fix as the smaller, lower-risk one
   of the two, worth picking up on its own. That isn't true, and it is worth
   writing down why so nobody picks it up in isolation expecting a small
   change: `targets.js`'s whole design commits to one invariant on purpose —
   "the answer does not depend on the layout currently on the floor... so an
   order stays fillable after the player tears their line down." `opBudget`
   currently assumes zero sharing between sinks specifically *because* assuming
   sharing would mean reasoning about whether a splitter is actually placed and
   where, which is layout information the rest of the model is built to ignore.
   You cannot correctly credit a sink for "a splitter could share this prefix"
   without first knowing how much a splitter actually saves, and that number
   does not exist anywhere in this codebase yet — mergers and splitters are
   outside `buildCosts` entirely. So `opBudget`'s fix and the BFS-tree fix
   aren't two independent gaps of different sizes; they're one gap. Any
   standalone `opBudget` change would have to guess at a sharing bonus without
   proving it, which is exactly the kind of guess that turns "conservative" into
   "wrong" in the one system here that has to never over-promise. **If this
   gets picked up, it should be picked up as one piece of work, not the smaller
   half of two** — model mergers/splitters as a tree in `buildCosts` first,
   then `opBudget` can credit actual proven sharing instead of guessing at it.
2. **A cosmetic, non-urgent UX observation, Devon's call, not a task**: once
   `×2` is in play, the sink can ask for a three-digit number (`NEEDS 231`) for
   an order that only takes a short line to fill. The tooltip already explains
   the cheap recipe; whether the tile-cost hint should be more prominent than
   the raw number is a design question, not a bug.

## The Fracture Cycle

`Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/`.

**Two rounds running with nothing outstanding.** The one real bug (the
unreachable ending) is fixed, the save question is answered and implemented,
the fonts are vendored, the accessibility issues are fixed, and the test suite
passes. Don't invent busywork for a 799-line game with every ending reachable,
a working save, no offsite requests, and no known accessibility or mobile
issues.

The list below is only for if Devon deliberately decides to expand scope —
none of it is an obvious next step:

1. **A 4th prong, or deeper side content.** The three existing prongs and the
   side-hub detour are each a complete beginning/middle/payoff shape, not
   truncated. Adding more would be new content Devon chooses to commission, not
   a gap being filled. If you do this, replay every existing path afterward —
   a narrative game that silently loses a branch gives no error, the choice
   just isn't there.
2. **Re-verify the branch map after any future edit.** If a later round touches
   the story logic at all, rerun `node Projects/the-fracture-cycle/test/smoke.mjs`
   and replay by hand.

Deliberately not done, twice, and still valid: no restructuring (still one
file, still small enough to hold in one read); no mid-story save (the
ending-tracker design was the actual answer to what this game's replay loop
wants, not a placeholder for a "real" save); no `reset` button on the save bar
(still avoiding two adjacent erase-like controls with different scopes —
"Begin the Cycle Anew" already exists).

## Orbital

`Projects/orbital/`. Merged directly to `main` outside the normal process
(PR #6); one round of real work since.

1. **A committed browser-driven test layer** — level-grid render/unlock,
   save/reset/wipe buttons, star display — now that the physics layer
   underneath is proven solid. Round 1 deliberately left this uncommitted and
   instead hand-drove a live session to get real answers on the
   reset-confirmation and mobile-aim math, which covers the two things a
   browser test would most have been wanted for. What's missing is a
   *committed, repeatable* version. Use `Tools/board-check/harness.mjs`,
   run-only, and `drive.mjs`'s engine-aware `waitFor`/`textContent` helpers
   rather than a bare `page.waitForFunction(fn, null, opts)`, or you'll add a
   new instance of a bug class that has already bitten several other
   project-owned test files this way.
2. **Verify the rotate-to-play gate on a real device or real touch emulation.**
   Round 1 could only prove the surrounding logic is sound (the gate is
   correctly keyed to pointer type, not viewport width) — this environment's
   browser reports a fine pointer even at a 375×812 viewport, so
   `matchMedia("(pointer:coarse)")` never flips true here regardless of window
   size. Needs different hardware to actually see it trigger.
3. **Revisit `gvb-save.js` adoption**, only if Devon wants save-bar UI
   consistency with the other adopters. Round 1 looked at it seriously and
   decided against: the current hand-rolled save (`orbital_progress_v2`, one
   key, already migrating its own `v1` predecessor) has no bug `repair` would
   fix, and the migration was proved to round-trip clean. Adopting would mainly
   buy the shared save-bar UI and export/import-to-file — a real but different
   kind of value.
4. **A level editor with URL sharing. Shipped 2026-09-14, PR #296** (#396 to
   #400). `js/editor.js` is the rail, `js/levelcode.js` is the codec, and the
   draft lives in the address bar rather than in a save key. Nothing is open
   against it; what a session would want next is the committed browser layer,
   which is item 1 above and already ranked.
5. **A level generator off the solver.** The solver is
   `OrbitalPhysics.makeSearch`/`findWinningShot` now — it moved out of
   `test/physics.mjs` into `physics.js` when the editor's Check button needed
   the budget CI uses, so a generator can call it without a second copy.
   `OrbitalCode.validate` is the other half: it already says what counts as a
   buildable level (a launch point outside every solid body, a marker the probe
   is not already inside, wormhole links with exactly two mouths), so a
   generator proposes and those two judge. Anything it produces encodes to a
   shareable link for free.

One correction worth carrying, since the file that carried it is deleted:
**the live level count is 22, not the 21 an earlier survey recorded**, and
pack-02 holds 12 levels, not the "11 levels" its own description claimed. All
22 are the fixture `test/levelcode.mjs` runs its round trips against.

If a fresh preview/OG pass happens and the promoted "Deep Field" frame doesn't
look right in practice, `js/game.js`'s `computePlan()` and the `aim`/`plan`
globals are the fastest way to try another vector interactively from the
console before committing a `games.mjs` recipe. The candidate that shipped:
`deepspace#11`, an aim drag of world-space vector `(dx: 200, dy: -350)` from
`start` (120, 540), which grazes the blackhole at ~75px and the first wormhole
at ~42px and resolves `plan.outcome === "WIN"`.

## Tools/board-check

The site-wide check and regression suite. Owns `check-integrity.mjs`,
`check-collisions.mjs`, `play-games.mjs`, `tools.mjs`, `capture-previews.mjs`,
`promote-previews.mjs`, `sync-social-tags.mjs`, `games.mjs`, `drive.mjs`,
`harness.mjs`; `play-castle.mjs` belongs to Castle Conundrum, and each project
owns its own test folder even where it imports `harness.mjs`/`drive.mjs`
read-only.

Everything open against this folder is filed under the project that needs it:
Golden Hour's preview recapture and debug-hook beats (ranks 24 and 26) and Blue
Hour's `games.mjs` entry and preview recipe (28 and 29). Castle Conundrum's
preview promotion was rank 1 and is parked, above the Tier 2 list.
**Corner & Kettle's Phase 9 shipped on 2026-09-13 and is no longer open** —
`play-games.mjs` has a `corner-and-kettle` section now (#371, #372), and the note that used to stand here, that the file held no reference to
it, is out of date. The ownership manifest shipped the same day and is
`Tools/board-check/ownership.json` (#355).

Two things about this folder that are decided, not open:

- **`play-castle.mjs` belongs to Castle Conundrum, not here.** Castle
  Conundrum is its only consumer, so no other work can conflict with it, and
  Castle work is unverifiable without being able to add beats to it.
- **`npm run games`, `npm run play` and `npm run previews` open real, visible
  browser windows, and only one may run at a time.** Two will steal focus from
  each other and produce frame-motion and walk failures that look exactly like
  bugs. Prefer a project's own Node suite for iteration and save the browser
  suites for the end.

## The site itself

`index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/`, `CNAME`,
`.github/`.

Five things came up in more than one survey and belong to no single project.
Two of them are closed.

1. **CI ran almost nothing, and the failures it inherited are cleared. Closed
   by PR #276 then PR #278** (#351 to #358): `site-ci.yml` runs board-check and
   twelve uncovered suites on every PR, `suite.yml` is the template the simple
   per-project workflows call, and `known-failures.json` is now empty in all
   three sections. The social-tag cleanup went four ways: Blue Hour and School
   Generator gave up their hand-written icon/og tags (and their bespoke
   favicons, which is the generator's stated design, #358); Bell to Bell and
   Hearth got the block they never had, both on the `guild-board.png` fallback;
   the offsite `aspermylessonplan.com` notice was a bug in the script, not a
   page (#357); and Numina keeps its own tags, exempt but verified, because it
   is an Eleventy site whose committed build output would drop any block
   injected into it (#357).
2. **Asset weight.** Bell to Bell, Castle Conundrum and The Fourth Quarter
   together carry ~380 MB: unreferenced props and texture variants, duplicate
   model formats, uncompressed glTF buffers and 2k textures with no smaller
   tier. One shared pipeline (prune, resize, draco/meshopt) pays off three
   times.
3. **`gvb-save.js` v2.** Quota accounting, multi-key namespaces and an
   IndexedDB tier are what the Schedule Visualizer needs and what Hearth's and
   Bell to Bell's growing saves will want.
4. **Real hardware.** The atmospheric pieces' performance numbers are all
   software rasterization (The Fourth Quarter is the exception: its round-1
   frame times were real Chrome). Touch input has "never had a thumb on it" in
   three separate notes files.
5. **Ownership. Closed by PR #278** (#354, #355). `Tools/prompt-builder.html`
   was owned by no prompt and hotlinked Google Fonts, and the second was
   downstream of the first: no area owned the page, so no area's round ever
   looked at it. The fonts are vendored into `Tools/prompt-builder/fonts/`, and
   `Tools/board-check/ownership.json` now names an owner for every `.html` in
   the repo, with `check-integrity.mjs` failing any page that has none. On its
   first run it caught one nobody knew about: `Projects/The-Fourth-Quarter.html`,
   the original flat build, linked from the board at `index.html:508`.
   (`Tools/prompt-builder.html` used to have company in the sweep:
   `Projects/school-generator/tools/walk-shell.html` carried an HTML comment
   inside its module script, `SyntaxError: HTML comments are not allowed in
   modules`, at line 290, from Phase 27 until September 2026. Decision #261
   made the marker a JavaScript comment.)

One more, from Hearth's own wishlist rather than a site survey, recorded here
because it is a board question: **Hearth is on the homepage (`index.html:492`,
tagged Sim, `data-new`) with no `assets/previews/hearth.jpg`.** Phase 8
decided against a `Tools/board-check/games.mjs` entry (#84, Q14 answered): the
board's suite runs headed on a desk and would be a shallower copy of the
harness's `save` mode, which `hearth-ci.yml` now runs on every PR. The
330×200 capture is still wanted and is not a desk job (Hearth is a 2D canvas).
The social block is no longer waiting on it: Hearth has one as of PR #278,
pointing at the board's own `guild-board.png`. Promoting a real capture would
write `assets/og/hearth.jpg` and the block would pick it up on the next
`npm run social`.

---

## Questions for Devon

Every open decision from every source, deduplicated by question, with how many
times and where it was raised. Six of these are cross-project and have been
asked repeatedly; the rest belong to one project each. A question here **no
longer blocks its work** (see rule 1 at the top of this file); a question
answered — by Devon, or by the session standing in front of it — should be
recorded as a locked decision in `HISTORY.md` and struck from this list.

**Struck so far: Q18**, "should Torchbearer be the site's PF2e rules engine, or
only its own?", answered by locked #133 while shipping Absalom Phase 1. The
answer is #17's: read the other engine and write your own, share the vocabulary
and not the code. Torchbearer has no open questions left.

**Struck: Q22**, "should the ladder be physically bigger?", answered yes by
locked #185 while shipping Fourth Quarter Phase 2's first increment: 30, 44,
58 and 76 seats up the ladder, one rectangle each until NPCs can path.

**Struck: Q28**, "should winning end the run?", answered by locked #241 and
#242 while shipping Faire Weekend Phase 4: no. The second track is renown,
and closing the season is the player's call, from the victory screen or the
weekend-end desk at Weekend 6 or later, with or without the win. Q27 gained
its other edge in the same phase, below, and is still Devon's.

**Struck: Q23**, "should there be a way to lose?", answered by locked #219 and
#220 while shipping Fourth Quarter Phase 9. Of the three options that question
listed, the losable lease is the one the rest of the game already supports: a
bankruptcy threshold is *how* the lease is lost, and a bank that stops lending
is a screen nothing else in this build has. Three consecutive nights closing
below $0 takes the room; losing it drops you a rung rather than ending the
run, and only an eviction from the Corner Tap — where there is no rung below —
ends one. The Fourth Quarter has three open questions left, none of them
blocking anything ranked.

**Struck: Q36**, "is a character builder welcome?", answered yes by locked
#304 while shipping Numina Phase 3's first increment, on the one condition
that the builder refuses to invent a number (#305). The full answer is in the
answered list at the foot of this section. **Q32, the attribute cost curve, is
not answered by it and was deliberately not pre-answered** — the module leaves
those purchases unpriced instead, so the question is still Devon's and still
open. **Q33, whether the Excellencies chapter should be ported at all, was
answered by Phases 5 and 6 and is struck** — locked #318, and the full answer is
in the answered list at the foot of this section. Numina has three open
questions left (Q32, Q34 and Q35), none of them blocking anything ranked.

**Struck: Q1**, "is `Pathfinder/data/**` a published interface other projects
may read?", answered **yes** by Devon on 2026-09-13, locked #350: it is public
reference data copied into the site, and any project may read it.

**The `Where` column names files that no longer exist.** The prompts, the
notes files and the ten handoffs were deleted in this consolidation; they are
cited by name so a raise count can be checked, and `git log` is where they
live. Nothing in that column is a link to follow.

### Asked more than once, across layers

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| ~~Q1~~ | ~~**Is `Pathfinder/data/**` a published interface other projects may read, or private to the Pathfinder pages?**~~ Struck — answered by Devon, #350: published; any project may read it, `Pathfinder/data/README.md` is the contract. 24 JSON files of PF2e rules data sit there. The Absalom Inheritance reads none of it and hand-writes three stat blocks and seven commands into `content/vault.json` instead; Torchbearer would build its own monster and treasure tables if the answer is private. Both considered depending on it and both correctly stopped rather than assume. `UPGRADE-PATHS.md` calls it the highest-leverage *decision* on the site. | **6** | prompt 01's block (the central tracker), prompts 10 and 11 raising it into that block, `Projects/torchbearer/WISHLIST.md`, `Projects/absalom-inheritance/WISHLIST.md`, `UPGRADE-PATHS.md` "Close behind", `gvb-site-handoff-v10.md` "Three things" and §11.4 |

### Bell to Bell

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q7 | **Should the authored three become seeds too?** Phase 2 answered "authoring or generation" by shipping both: 4th, 5th and 6th are authored and the 7th is drawn from a seed. Converting an authored period is one JSON edit each, and its kids' names and notes would go. Nothing depends on the answer. | 2, reframed after PR #106 | `Projects/bell-to-bell/WISHLIST.md` |
| Q8 | **Does the period need a fail state?** Answered "still no" three times. Confirming it lets Phase 3 stop designing around the possibility. | 2 | wishlist, `docs/HANDOFF.md` |
| Q9 | **Is suppression too strong?** Measured: in every 4th-period balance run exactly one scheduled tell never happens (Priya in front of June); splitting the pairs makes that "2 never happened, 2 found another way" and drops restless from 72 to 44. The handoff's own fix, if it is too strong, is a per-period cap on how much one kid absorbs, not a nerf to the effect — and now watch it across *two* rosters (Priya and Anh both), not just one. | 2 | wishlist, `docs/HANDOFF.md` |
| Q10 | **Is the Observation's ambient Mastery cost calibrated?** `CFG.observation.masteryDrainPerSec` is 0.008 — ~5 points over the window, by design math and not by playtest. In the table it costs the good teacher nothing visible (79 either way) and buys 10 Fidelity if performed. | 2 | wishlist, `docs/HANDOFF.md` |
| Q11 | **Mobile.** Undecided, and the answer determines whether Phase 8 exists. `input.js` has `touchstart`/`touchmove` look and no way to walk or to press E, Q, R, T, O, H, G or F. | 2 | wishlist, `docs/HANDOFF.md` |
| Q12 | **An announced Observation variant?** Treatment §6.1 has both announced and surprise; only unannounced is built. The handoff calls the surprise one funnier and rates this low; Phase 4 assumes yes. | 2 | wishlist, `docs/HANDOFF.md` |
| Q13 | **Should Room Temp reveal direction at all?** "Still unchanged." Room Temp names bands and quadrants only; naming is what the Withitness mode is for. | 1 | `docs/HANDOFF.md` only |

### Hearth

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q16 | **Does the name-recycling quirk stay a feature?** Songs live on names (`songs[].kn` is a list of strings) and the ancestor-naming rule can hand a newborn a dead knower's name, so that child "knows" every song the ancestor knew and can resurrect a lost one. Rare; reads as poetry; fixing it means packing knower identity beyond names. Keep, or pay for identity? | 2 | wishlist, sprint 16 handoff |

### The Absalom Inheritance

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q20 | **Is the split between builds the design, or a tuning debt?** Round 3 called the asymmetry deliberate at 53.6% / 79.8%. Phase 1 narrowed it to **64.5% / 79.8%** without meaning to — Shield Block is worth about eleven points to the Wizard and Reactive Strike is worth nothing measurable to the Fighter — and Phase 2's two condition sources moved it again, to **65.3% / 79.3%**, so the gap is 14 points rather than 26 and the question is live rather than settled. Neither phase was aimed at it; both narrowed it, which is itself an argument that the 26 points were tuning debt. If the two builds are meant to be comparable challenges, `balance.mjs` needs a band per build rather than one shared 45–90% window; if they are an easy mode and a hard mode, the picker should say so, since a player choosing Kessa Vane cannot tell. **Measured again after Phase 6 (PR #164): 79.5% / 69.3%, a gap of 10.2 points**, and the thing that moved it was content rather than a build — the undercroft's boon pays Vesper 5.2 points and Kessa 1.4, against a fight that costs them 4.5 and 6.3. That is the first evidence in this question's history that the gap is content-shaped rather than kit-shaped, and it argues for the per-build band. **Measured again after Phase 7 (PR #166), and the question changed shape: there are four builds now — 79.1% / 74.4% / 69.3% / 68.0% — so "the split between builds" is a spread of 11.1 points across four rather than a gap between two, and the two new ones landed in the middle of it on their second tuning pass.** A per-build band is a bigger ask at four than it was at two; a single 45–90% window that all four sit comfortably inside is also now evidence that the window is doing less work than it looks like. Still unanswered, and still Devon's. | 2 | `Projects/absalom-inheritance/WISHLIST.md`, PRs #151, #153, #164 and #166 |
| Q21 | **Does the adventure grow, or does the engine deepen?** Twelve to sixteen minutes, two rooms, four fights. Arc one deepens the engine on the rooms that exist; arc two spends the same effort on more rooms. A taste question, not a technical one. | 1 | wishlist |

### The Fourth Quarter

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q24 | **How much of the 2D campaign is actually wanted?** 21 event cards, a 14-week season with a 4-team bracket, regulars, a rival, three distributors. All of it ports; none of it is small; a 3D floor game with a full back office is a different game. Phases 6–9 assumed "most of it, in that order" and all four have now shipped — the league, the regulars and the rival, the event cards, and a losable lease. What is left unported is the distributors (and the two event cards about them), staff as a simulated system, and per-lot shelf life; none of it is ranked. | 2 | wishlist, README roadmap |
| Q25 | **Is 66 MB of texture on first paint acceptable?** 27 JPEGs, 69,218,191 bytes, all 27 loaded by the first room. Uncompressed in GPU memory that is roughly 600 MB with mipmaps (2048² × 4 × 27 × 1.33 — arithmetic, not a measurement). Phase 4 cuts it by an order of magnitude at some visible cost. | 1 | wishlist |
| Q26 | **Has `SPOILAGE_RATE = 0.15` actually been played yet?** One number in `campaign.js`, tune by feel; no assertion depends on the exact value except one asserting 15% of 20 rounds to 3. | 3 | wishlist, prompt 07, README roadmap |

### Faire Weekend

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q27 | **Are the four economy numbers right?** `perGuestCost: 5`, `upkeepRate: 0.07`, `bankruptcyFloor: -6000` and `winCondition`'s three thresholds have been flagged "most likely to need adjusting after real play" for four rounds running, and no round could answer it because nobody has played a full season. The `SIGNIFICANCE:` tests prove they are not degenerate, not that weekend 6 is a satisfying place to arrive. **Partly answered by Phase 1 increment 2:** `perGuestCost` stays at 5, ruled rather than assumed — it was tried as the counterweight for the walk-based stall economy and SIGNIFICANCE 3 refused it, because a per-head cost scales with the crowd whether or not anything is being sold and at $11 a head "charge the maximum" becomes correct again on a faire with no stalls (#228). `wristbandCut` moved instead, 0.28 → 0.12. `upkeepRate`, `bankruptcyFloor` and the three `winCondition` thresholds are still unanswered, and increment 2 added a check that pins one edge of the last one: a built-out faire cannot bank $25,000 in two weekends. **Phase 4 pinned the other edge, and it is the one that matters:** a scripted manager playing from a real start banked $28,000 to $104,000 by Weekend 6 across six seeds and a dozen builds and never took reputation past 63 from 50, because satisfaction sits in the 60s once the crowd outgrows the stages and attendance grows with the reputation the bar wants. The cash bar is trivial; the reputation bar is out of reach for any manager the suite could write. `minCash` and `minReputation` are the two to look at together. **Phase 7 moved the reputation half, and this is evidence rather than an answer:** the same scripted manager, staffing the grounds the morning after the first day anybody was turned away, finishes season one at reputation 74 — up from the 69-72 the same script reached before the crew existed, on a fixture that seeds reputation at 70. The bar may be reachable now. Nobody has played it. | **5** | `Projects/Ren-Faire-Claude/WISHLIST.md`, prompt 09, the project's notes, `HANDOFF.md` backlog |
| ~~Q28~~ | ~~**Should winning end the run?**~~ Struck — answered by #241 and #242 (Faire Weekend Phase 4): no; renown is the second track and closing the season is the player's call. | 1 | wishlist |
| ~~Q29~~ | ~~**Is the 1080px breakpoint a touch device?**~~ Struck — answered by #249 (Faire Weekend Phase 5): a width is not a pointer. The 38px cell is gone at every width and the touch sizes (48px cell, 44px buttons, slider and `<select>`s) hang off `(pointer: coarse)`. Measured on a fine pointer and left there: slider 275×16, `<select>`s 175×31, 190×32 and 134×32. | 2 | wishlist, the project's notes |
| ~~Q30~~ | ~~**Does the fixed `fit-content(710px)` board column bother you?**~~ Struck — answered by #246 and #247 (Faire Weekend Phase 5): `main.js` sets `--cols` on `#board` and the column is a `calc()` off it, 710 → 525px on the Home Grounds. The "~54px of empty mat" was 187px of the map's brown gap colour, not mat. | 3 | wishlist, prompt 09, the project's notes |

### Daredevil

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q31 | **Is the six-way Earl response at the fair the shape it should be?** Open since round 1. Only option 5, "I need to talk to someone first," reaches `m1_ruthie` and sets `rels.ruthie = 'solid'`, so five of six answers lock Ruthie out of all four hubs and the epilogue for the whole game. Option 5 is also the only one that never sets `rels.earl`, so a Ruthie run carries Earl as `'unknown'` to the ending screen, where the epilogue prints "Earl Maddox. The relationship is still being decided." after a run in which he backed every show. | 3 | `Projects/daredevil/WISHLIST.md`, the project's notes (twice, rounds 2 and 3) |

### Numina

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q32 | **What is the attribute cost curve?** `skills/attributes-vitality.md` gives "Cost to Increase: *Cost of next attribute*" for Prowess, Insight, Fortitude and Vitality — circular, and the escalating numbers appear nowhere in `src/` or `source-material/markdown/`. Are they in the PDF's chart and the conversion dropped it, or genuinely unpublished? **This no longer blocks the builder:** `build-rules.js` leaves those purchases in `cp.unpriced` and flips `cp.exact` false (#305), so a build that raises an attribute comes back with a floor rather than a total. An answer here turns that floor into a number. | 1 | `Numina/WISHLIST.md` |
| Q34 | **Do the eight nations with a blank `capital` have one?** Kindaria, Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach, Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are `demonym: ""` (the Five Duchies' entry says outright that it has none). If the book does not name them, the infobox should collapse rather than render a flag chip over one "See also" row. | 2 | wishlist, audit A4 |
| Q35 | **Is the custom-domain move happening, and when — and does `numinalarp.com` serve HTTPS?** The README calls it a one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every absolute URL, but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`, and `test/a11y/packet.mjs` hardcodes the prefix too (Phase 7). **The HTTPS half now needs one person and one page load, and nothing else.** Batch 1 could not verify it from its sandbox, and neither could Phase 5, which was refused at the environment's network egress before a request left the box — that says nothing about the host. The links stay `http://` until somebody can load it, because an `http://` link to a host that redirects still works and a `https://` link to a host that does not serve it fails outright (locked #319); the reasoning is a `websiteSchemeNote` key in `site.json` now rather than a checklist line. | 3 | wishlist, audit D4, Numina Phase 5 |

### The projects with no wishlist

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q38 | **Does `characters.html` get a commented-out `<template>` dossier block?** Documentation convenience, not a bug. Devon's call on style; not requested in three rounds. | 3 | prompt 03, and its notes in rounds 2 and 3 |
| Q39 | **Should `characters.html` adopt `gvb-save.js` for in-browser editing?** Only if the page's role should shift from showcase to living character sheet. Not requested in three rounds. | 3 | prompt 03, and its notes in rounds 2 and 3 |
| Q40 | **Does Aphelion ever need to run on a tablet or phone?** Three rounds have each re-derived "no evidence yet" from scratch rather than asking. The answer decides whether the touch/gamepad input scheme is worth building. | 3 | prompt 04, and its notes in rounds 2 and 3 |
| Q41 | **Is Castle Conundrum's captured preview candidate the right frame?** It sits in `candidates/`, chosen, dated a fair-environment refresh, deliberately not promoted so this project's own session could look first. | 2 | `gvb-site-handoff-v10.md` §9 and §11.3, prompt 22's notes |
| Q42 | **Is Closing Time's multi-career history worth the save-shape work?** Whether the career ending is more than a one-time wall, and whether players actually hit it repeatedly. Three rounds of notes have said the same. | 3 | prompt 06's notes across three rounds |
| Q43 | **If Golden Hour's night proves popular, should the owl hunt?** One swoop over the dunes, no kill shown; and the fireflies drifting toward the fire when it burns. | 1 | the project's notes |
| Q44 | **Blue Hour's causeway: which of the three ways out?** A `mountainH` term following the trail's arc-length height; re-anchoring `trailYof` to the hillside; or accepting a ridge trail and widening the bench. All three move the heightfield and rebaseline `smoke.mjs`; the third also has to answer why the blaze posts stand at the lip of a 10 m drop. | 1 | prompt 24, session 6 |
| Q45 | **Blue Hour's direction: keep pushing into `dread.js`, or lock "no save, no verbs, no collection" as a decision?** The ending pass committed hard to dread over collection, so Golden Hour parity is now the odd option out and shouldn't be adopted without asking. | 2 | prompt 24, the notes' sessions 2 and 4 |
| Q46 | **Blue Hour's phantom pan: accept 0.000, or point `downhillAt` at the fall line?** The second changes the eyes' drift and the shape's head-flip too, since all three read the same function — an argument for doing it deliberately or not at all. | 1 | prompt 24, session 6 |
| Q47 | **Should Integer Foundry's tile-cost hint be more prominent once `×2` lets a sink ask for a three-digit number?** The tooltip already explains the cheap recipe. A design question, not a bug. | 2 | prompt 14, the project's notes |
| Q48 | **Do Integer Foundry's two model gaps get built despite the coupling argument?** Two rounds have looked hard and declined; the third added a real argument for why they are one piece of work, not two. This is the one thing that would pull the project back off the shelf. | 2 | prompt 14, the project's notes |
| Q49 | **Does The Fracture Cycle get a 4th prong or deeper side content?** Not a gap being filled — new content Devon chooses to commission. Two rounds have said the same. | 2 | prompt 15, the project's notes |
| Q52 | **Does Orbital adopt `gvb-save.js` for save-bar UI consistency?** Not needed for correctness — round 1 proved the existing migration round-trips clean. Purely a question of whether UI consistency with the other eleven adopters is wanted. | 2 | prompt 21, the project's notes |

### Answered, kept here so they are not re-asked

- **Should the Serve button require full order completion?** (was Q2)
  Answered by the session that shipped Corner & Kettle Phase 3, 2026-09-12:
  **no — it stays loose and says what the click costs**, locked decision #341.
  A short cup reads `Serve 3/5` in a warning style and names what is missing;
  an empty cup is disabled and names what it needs. Partial credit is priced on
  purpose (`price * (0.35 + 0.65 * ratio)`), and on the same seeds the hard
  gate's numbers are exactly the patient player's ($1,927 a day, 1.000) against
  $1,457 and 0.719 for a player who ignores the cue, so the difference is now
  printed on the button. Reversible in one line: `serveReadiness()`'s
  `canServe` becomes "nothing missing".

- **Should the Excellencies chapter be ported at all?** (was Q33) Answered by
  the session that shipped Numina Phases 5 and 6, 2026-09-12: **it was never
  withheld, it was never converted, and it is ported now** — locked decision
  #318. The chapter runs pages 60 to 75 of `rules-2026-v3.51.pdf`, printed in
  full, 30 Excellencies and 239 skills in exactly the five-column tables the
  rest of the rulebook uses. Nothing about it reads as held back; what was
  missing was a `source-material/markdown/` file, which is a gap in the
  conversion rather than a decision by staff. `skills.json` went 189 skills to
  428. The hidden Excellencies table is a separate and still-hidden thing and
  was not touched. Reversible: delete one markdown file and re-run the
  extractor.

- **Is a character builder welcome?** (was Q36) Answered by the session that
  shipped Numina Phase 3's first increment, 2026-09-12: **yes, on the
  condition that it refuses to invent a number** — locked decision #304.
  Every verdict `build-rules.js` returns carries `unofficial: true`, and the
  in-game unlocks, the hidden-Excellency approvals and the third Expression's
  email come back in `verdict.provisional` beside the bill rather than as fine
  print under it. A cost the book does not publish goes in `cp.unpriced` with
  the book's own words, never a guess (#305). Reversible cheaply: the caveats
  are data, and removing the page leaves `skills.json` where it was. **Q32 is
  a different question and is still open** — it was not pre-answered, because
  the module does not need it to be.
- **What should "Not interested" to Earl actually do?** Answered by the
  session that shipped Daredevil Phase 1's first increment, 2026-09-10:
  **(B), the self-financed middle game** — locked decision #265. `_chapter_m2`
  routes `rels.earl === 'absent'` to `m2_solo_entry`, nothing sets Earl back,
  and Free Roam 2 opens on the debt. Reversible by rerouting one arm. Was Q3.
- **Does the engine (Torchbearer) grow past level 3?** Answered by the
  session that opened Phase 6, 2026-09-06: **yes, to 10** — locked decision
  #111. The level is a field on the build, `MAX_LEVEL` is 10, and guide §13's
  "correct-feeling PF2e at level 3" is rewritten when the level-up flow
  ships, not before. Was Q19.
- **Should `campaigns.html` and `characters.html`'s shared CSS and fonts be
  merged?** Answered round 2: **harmonize, don't share.** `[shared]` drift-guard
  comments mark every byte-identical rule; locked decision #17 stays in force
  for this pair. Raised independently three times before it was settled.
- **Is one clean verification round enough to call a project done?** Answered by
  Devon, 2026-08-03: **yes**, matching the precedent already set.
- **Should The Fourth Quarter's night loop have a day-based difficulty curve?**
  Answered: **spoilage**, built in round 3. Rent already scaled with venue tier.
- **Should Hearth join the board's regression suite?** (was Q14) Answered by
  Hearth Phase 8, locked decision #84: **no.** `npm run games` is a headed
  desk run and an entry there would be a shallower copy of the harness's
  `save` mode, which CI now runs on every PR. The preview is parked with the
  social-tag cleanup.
- **Does Hearth get a CI workflow, and in what shape?** (was Q15) Answered by
  Hearth Phase 8, locked decision #83: **`hearth-ci.yml`, two jobs.** A PR
  gate of `determinism` + `save` + a twelve-day `soak` + `pinned`, and a
  nightly matrix of the other fifteen modes that never runs on a PR.
- **Does the population cap overshoot actually grate?** (was Q17) Answered by
  Hearth Phase 7, locked decision #82: **kept, and named.** The cap counts
  beds and a boat has to find one; a baby is born into its parents' house. The
  one is `BIRTH_OVER` in `Projects/hearth/js/core.js` with the reason beside it.

---

## Ownership

Which paths each area owns, and which shared paths it may not change alone.
Lifted from the retired prompt system's boundary table, which is the only place
this was ever written down. **The "shared, do not touch alone" column is now a
"say so in your PR" column, not a queue**: make the edit in your own branch, in
the same commit as the project change, and call it out in the PR body.

**`Tools/board-check/ownership.json` is the machine-readable half of this
table** (#355), and `check-integrity.mjs` fails any `.html` no area claims. The
two are meant to agree: change both, or the next page to arrive is owned by
whichever one you updated. The manifest carries two areas this table did not —
**Prompt Builder** and **Archived teaching tools** — and both are in the table
now.

| Area | Owns | Shared paths it must not change silently |
| --- | --- | --- |
| Anathema Archive | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py`, `Pathfinder/tests/` | `index.html`, `assets/js/gvb-save.js`, `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Pathfinder Campaigns | `Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/` | as above |
| Pathfinder Characters | `Pathfinder/characters.html`, `Pathfinder/characters-assets/` | as above |
| Aphelion | `Projects/aphelion/` | as above |
| Castle Conundrum | `Projects/Castle Conundrum/`, **and `Tools/board-check/play-castle.mjs`**, which is its own | `index.html`, `assets/js/gvb-save.js`, the rest of `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Closing Time | `Projects/Closing Time/` | the four shared |
| The Fourth Quarter | `Projects/fourth-quarter/`, **`Projects/The-Fourth-Quarter.html`** (the original flat build, board-linked at `index.html:508`, owned by nobody until #355 caught it), `.github/workflows/fourth-quarter-ci.yml` | the four shared |
| Golden Hour | `Projects/golden-hour-beach/` | the four shared |
| Faire Weekend | `Projects/Ren-Faire-Claude/` | the four shared |
| Torchbearer | `Projects/torchbearer.html`, `Projects/torchbearer/`, `.github/workflows/torchbearer-ci.yml` | the four shared |
| The Absalom Inheritance | `Projects/absalom_inheritance.html` (shell, URL unchanged), `Projects/absalom-inheritance/`, `.github/workflows/absalom-ci.yml` | the four shared |
| Corner & Kettle | `Projects/coffee_shop_sim.html`, `Projects/corner-and-kettle/` | the four shared |
| Daredevil | `Projects/daredevil/` (`Projects/daredevil_r4.html` is a redirect stub) | the four shared |
| Integer Foundry | `Projects/integer-foundry.html`, `Projects/integer-foundry/` | the four shared |
| The Fracture Cycle | `Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/` | the four shared |
| Orbital | `Projects/orbital/` | the four shared |
| Blue Hour | `Projects/blue-hour-trail/` | the four shared |
| Hearth | `Projects/hearth/`, `.github/workflows/hearth-ci.yml` | the four shared |
| Bell to Bell | `Projects/bell-to-bell/` — and its own `CLAUDE.md` governs inside it | the four shared |
| School Generator | `Projects/school-generator/`, `.github/workflows/school-generator-ci.yml` | the four shared |
| Numina | `Numina/` — **but see the constraint below** | the four shared |
| Prompt Builder | `Tools/prompt-builder.html`, `Tools/prompt-builder/` | the four shared |
| Archived teaching tools | the five #206 closed and their folders: `Tools/Name Picker.html` + `name-picker/`, `Tools/Seating Chart Generator.html` + `seating-chart/`, `Tools/final_grade_checker.html` + `final-grade-checker/`, `Tools/image-to-pdf.html` + `image-to-pdf/`, `Tools/schedule-visualizer.html` / `schedule-browser.html` / `schedule/` and the two dated Schedule pages | **no work opens against these** (#206) |
| The site | `index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/` (including `assets/fonts/`), `Tools/board-check/` (except `play-castle.mjs` and any project's own test folder), `CNAME` | — |

**A project owns its own test suite**, including a browser-driven one that
imports `Tools/board-check/harness.mjs`/`drive.mjs` read-only —
`Projects/fourth-quarter/test/`, `Projects/integer-foundry/test/browser.mjs`
and others. Those are per-project
files even though they drive a browser the same way the shared tooling does.

**`Numina/test/smoke.mjs:180` enumerates Numina's allowed top-level files.**
`README.md`, `CONTENT-GUIDE.md`, `WISHLIST.md`, `package.json`,
`package-lock.json`, `.gitignore`, `eleventy.config.mjs`, `src`, `test`,
`tools`, `source-material`, `node_modules`, `.cache`, `discord-logs` and the
generated set — and nothing else. **Do not add a new top-level file under
`Numina/`**; `npm test` there fails if you do.
