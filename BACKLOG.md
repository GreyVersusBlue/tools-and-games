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

**3. Size the batch by the Size column, not by a count.**

| Size | Take | Why |
|---|---|---|
| ¼ | up to **4**, and they may share one PR when they are the same kind of work | CI is the bottleneck, not the model, so rows-per-PR is nearly free while PRs-per-session is not |
| ½ | **2**, occasionally 3 | |
| -1 | **one** | |
| 2+ | **that row is the whole batch** | never pair it with anything |

**A 2+ row will not finish in one session, and that is expected.** Do one increment, ship it,
and **leave the row in place** with its Item text rewritten to say what is done and what is
left. Do not delete a 2+ row until it is actually finished. Stalling on one and swallowing one
whole are both worse than an honest increment. Do not mix sizes to fill a quota: a 2+ row will
absorb whatever time the others leave and finish neither well.

**Respect the Model column when you batch.** It is carried from each item's own source and is
not re-decided here; rows naming different models are still one batch if the sizes allow, but
say in the PR body which rows you took and under which model you actually worked.

**Whatever the batch size, step 6 of the definition of done happens after each merge — never
saved for the end.** This is the rule most likely to be dropped as batches grow. Its casualty
is on record in the sibling repo (`GreyVersusBlue/AI_Tools`): a session batched two phases,
saved both backlog rewrites for the end, and its first PR merged with the row still in the
ranked table — the next session spent about an hour rebuilding something that already existed.

The two things that are still not a session's call, because they change what the work *is*
rather than how it is built: **re-ranking the list wholesale**, and **overruling the Ownership
table** in Tier 2.

## Where things stand — start here

**The site is at version 15** (`index.html:575`, and `landing.html:840,861`).
The last thing that shipped is **Numina Phase 3, increment 2 — the picker,
and the build kept and shared (PR #245)**. It is a **2+ row, so it was the
whole batch and it did not close**: the row stays at **rank 1** with its Item
text rewritten, and nothing below it moved. **64 ranked items remain**, and
**rank 1 is still `Numina` Phase 3 — The character builder**, on **Claude
Fable 5.1**. The next increment is **the printable character card**, the last
bullet of the wishlist's Phase 3 and the feature that justifies the phase: one
sheet on `print.css`'s `cardsheet` treatment carrying `verdict.granted` and
`verdict.purchases` with verbals, attributes, Vitality and the CP total. Read
`Numina/CONTENT-GUIDE.md`'s "The character builder" first — it says which of
the four modules touch the browser (one) and why the suite can read the page's
markup without one — then `print.css`, whose `cardsheet` rules hide `.skill-
filter` and the like and will need the builder's form controls hidden the same
way. **Q32, the attribute cost curve, is still open and was not pre-answered**
— the page shows a raised attribute as a floor ("at least 50 CP") with the
chart's own words beside it, and the card has to print the same floor rather
than a total. **`npm run check` is still down to one broken unit**,
`Tools/prompt-builder.html`, which is rank 33's now.

**What increment 2 built.** `/mechanics/character-builder/`, in `nav.json`
after Building a Character. Three modules beside `build-rules.js`:
`build-view.js` renders each step and the verdict as HTML strings,
`build-state.js` packs the build for `localStorage` (`numina.build`,
versioned, every load through `repair`, #36 and #37) and the URL fragment
(`a=arcane&f=military&x=Deadeye&at=purpose:6`), and `builder.js` is the only
file that touches the browser. The form is the state, and a step re-renders
only when what it offers changes, so a typed Excellency keeps its focus
(#310). A pasted fragment wins over the save; "Start over" clears both (#311).
Tongue of Aspect is one box per chosen Aspect (#312). `skills.json` and the
anchor map are inlined as two JSON islands from the same `skillAnchors()` map
the chapter rows use, so the page cannot link to a fragment a chapter lacks
(#313). 253 assertions to 341; `test/builder.test.mjs` is 88 of them and is
fourth in `npm test`. Ten guard-rails broken on purpose, nine caught by name;
the tenth stayed green because the branch it broke was dead (Void is never
offered) and the branch is deleted rather than asserted over (#147). The page
was also driven in a headless Chromium, but that check is not in the suite:
Numina's CI installs no browser, so `builder.js` is the one file it cannot
see. Decisions #310 to #313.

**What increment 1 built.** `Numina/src/js/build-rules.js`: a build in, a
verdict out, pure, no DOM, the same module under Node and in the page. Ten
steps, six caps, two escalating ladders (5, 6, 7 for Excellencies and for
Expressions), and the two refusals that are the reason the phase is worth
doing at all. A raised Prowess, Insight, Fortitude or Vitality does not add to
`cp.spent`; it adds to `cp.unpriced` carrying the chart's own circular words
and flips `cp.exact` false, so the total is a floor and a build over 50 only
on an unpriced purchase is not called over budget (#305). The two "See
Description" skills get the same treatment. The Excellencies chapter is a stub
with no list to pick from, so an Excellency is a name the player types, priced
by tier and matched against the 18 hidden ones for the Staff-approval flag
(#306). The Aspect and Foundation lists are new `skills.json` data — nine and
twenty, read from `###` headings between the headings that fence each list,
with a Foundation's Type naming the skill table its two purchasable skills
come from and a Type with no table stopping the run (#307). Included is
granted, not purchased, and does not spend a "purchase up to N" allowance
(#308). A third Expression is modelled as the Excellency cap dropping to two,
one state rather than two that can disagree (#309). 130 assertions to 253
across three suites; `test/build-rules.test.mjs` is 113 of them and is third
in `npm test`. Eighteen guard-rails broken on purpose, and **two went green
the first time** — an assertion that guessed the curve killed the suite
instead of failing it, and three "absence of this problem code" assertions
passed for free because a renamed id never reaches the check it guards. Both
are rewritten and both fail now (#147). Decisions #304 to #309.

**Still open in the row**: the printable character card on `print.css`'s
`cardsheet` treatment, and nothing else.

**Shared things touched by increments 1 and 2**: none of the four.
`CLAUDE.md`'s locked-decision count, 303 → 313. `check-integrity.mjs` is
1,531 units with the same one broken, `social:check` reports the same six
pages out of sync, `check-collisions.mjs` passes at 0 collisions — all three
unchanged by that work. This file's `Claimed` column is cleared.

**What Phase 2 built.** Two Eleventy transforms over Phase 1's data, both
scoped to each page's `<main>`. `Numina/tools/skill-anchors.mjs` gives all 189
skills an address — `/mechanics/skills/domains/#airs-last-stand` — with a
CSS-drawn `§` permalink in the first cell, the table-row twin of the heading
permalink. Rows are matched by heading id plus first-cell text, never by
position, so a record with no row **stops the build** by name, and two anchors
colliding on one page stops it too (#300). `Numina/tools/autolink.mjs` links
the first mention of each glossary term, nation and skill name in a chapter to
its canonical page: 122 links on 43 pages, never in a heading, a table header,
an existing link or a code span, never self-linking, and idempotent because an
existing link to the target is what spends the term (#301). The term list
derives from `skills.json`, the nation pages and the glossary's `##` headings;
one-word skill names (41 of 189) and terms two records claim are dropped by
rule, and `src/_data/autolink.json` holds the 12 that need a human reason, each
with its collision — **and each has to change the outcome or the suite fails**
(#302). `/mechanics/skills/all-skills/` lists all 189 by name, group, kind and
cost, filterable client-side, indexed, in `nav.json`; the filter form ships
`hidden` so no-JS, print and Pagefind see the whole list. `nation.njk` now
renders no infobox where it would carry only the "See also" row — three
nations, not the eight the wishlist expected, and nothing was left to fill
(#303). 118 assertions to 130, and the build prints a summary because the diff
is every ported chapter's HTML.

**Shared things touched**: none of the four. `CLAUDE.md`'s locked-decision
count, 299 → 303. This file's `Claimed` column is cleared. `check-integrity.mjs`
still fails on `Tools/prompt-builder.html` alone (1,508 units, 1 broken),
`social:check` reports the same six pages out of sync, `check-collisions.mjs`
passes — all three unchanged by this work.

Before that: **Numina Phase 1 — The skill table becomes a record (PR #236)**,
which built `src/_data/skills.json` — 189 skills in 29 tables, every
non-numeric cell a named shape that keeps its `raw`, a cell or header the
extractor does not know throwing with file, line and cell (#297), the hidden
table's count settled at 22 against the wishlist's 21 (#298), and the attribute
chart's cost curve modelled as `unpublished` rather than guessed (#299).
Phase 2 is the first thing to read it.

Before that: **Daredevil Phase 8 — A workflow that runs the suite (PR #233)**,
which closed arc two of that project: `daredevil-ci.yml` in three jobs
(`suite`, `browser`, a nine-way `transcripts` matrix, eleven and a half minutes
on a runner) over eight phases and 433 assertions that nothing in
`.github/workflows/` had been running. The nine committed transcripts became an
assertion — `transcript.mjs <run> --check` replays and compares instead of
overwriting, with the stunt score normalised to its verdict first because it
falls out of a real-time physics run (#295, #53). The half of the row that
needed a thumb on real glass was parked with a note saying parked is not
verified (#294); no browser pin, because what this suite compares is scene ids,
DOM text and save JSON (#296). Decisions #294 to #296.

Before that: **Daredevil Phase 7 — Three stunts that are three stunts (PR
#230)**, which made a scale mean something: `js/stunt.js`, one number per scale
and everything derived from it, a launch speed solved out of the geometry
rather than chosen, a retry that costs a point of Condition, and the Recovery's
result finally read at both call sites. Decisions #290 to #293.

Before that: **Daredevil Phase 6 — Evenings that cost something (PR #227)**,
which built the hub economy: `js/money.js`, four budgets, 23 priced evenings,
`GS.flags.money` and a "The Books" verdict on the ending screen. Decisions
#286 to #289.

Before that: **Daredevil Phase 5 — A walker that knows what it did not reach
(PR #224)**.

**What Phase 5 built.** `test/graph.mjs`: the story as a graph, no browser.
Every edge the game has — `next`, `goto`, `_gateRoute` literals, goToScene()'s
24 procedural blocks brace-matched out of `engine.js` with the minigame
handlers they name and the route tables they call, and the four hub
renderers' cards and buttons — 232 scenes, 412 edges, 0.4 seconds. Walked
plain for orphans, dead routes and edges to nothing, and over (scene,
relationship bag) pairs with `_needs` and the route tables exact and every
flag gate open, for scenes no relationship state reaches. Its first run
found `_fr3_ruthie_route`, handled since round 1 and named by nothing
(deleted, #284), and `m5_question_earl`, a written scene under no bag because
Earl's only road to mentor makes Cal loyal and Cal's row is above his in the
Milestone 5 table (frozen from both ends, #285, and in the standing backlog).
Wired into `smoke-save.mjs`, 127 → 134; seven guard-rails broken on purpose;
`smoke-page.mjs` 136 green; no transcript moved. **Phase 4 was also built
twice that day** — #220 merged, #222 closed — because both sessions' claims
lived on their own branches; a claim now goes to `main` first (#283).

**What Phase 4 built.** The cast table declares 26 states and seven of them
were written by nothing. Tommy was `'hanger_on'` at the first line of the game
and `'hanger_on'` at the ending screen on every run ever played, while two hub
cards gated on him not being `'absent'` and a Free Roam 4 paragraph read
`=== 'ally'`. He has a track now: Free Roam 1's bar night forks on whether Duke
asks him a question about himself, that answer is the only thing that puts the
car-show warm-up slot on Free Roam 2's bar night, and that slot is the one
writer of `tommy: 'ally'` (#279). "Borrow from Tommy" writes `'hanger_on'`
flat, which is the lasting cost (#280). Free Roam 3's evening either lets the
twelve people stand or measures them against a career, which is how he leaves.
Danny's `'poached'` and `'absent'` come from one new Free Roam 3 day card —
Earl signed him on the backer branch, a Fort Worth syndicate on the solo one —
and Duke's answer, not the signing, picks between them (#281). The ending
roster is `rosterFor()` off the cast table, in the table's order, minus anyone
the run never met; it was `Object.entries(GS.rels)` filtered on a literal, in
the save's key order, which `repairState` does not preserve (#282).

**The guard-rails, and the two numbers they froze.** `smoke-save.mjs` now fails
on a legal state nothing writes. Three are still dead — `ruthie: 'strained'`,
`ruthie: 'absent'`, `earl: 'antagonist'`, read in seven places, written in none
— and are frozen in a list checked from both ends. The second number is new:
a scene reached by a choice and carrying a `statUpdate` fires it twice and
applies its deltas twice, which the standing backlog has carried without a
number since Phase 1. Measured in a real browser, `fr2_danny_01` option B takes
showmanship from 0 to 3. Thirty-three scenes do it, `m2_sign` and six of the
eight endings among them, and that list is frozen too. Fixing the engine
rebalances the game and moves every transcript, so it stays its own row; new
content puts its numbers on the choice and its relationship writes on the
`statUpdate`.

**Counts.** `smoke-save.mjs` 110 → 127, `smoke-page.mjs` 93 → 136, `flags.mjs`
7 and green with `tommyKnowsWhatHeWants` off its write-only list (28 → 27).
Nine transcripts rather than six — `no_tommy`, `no_danny` and `danny_gone` are
new — all taken against the finished code, and five prose swaps came out of
them: a retirement retrospective that called Ruthie on runs that never
established her, two Free Roam 2 scenes claiming a history with Danny on runs
that declined him at the fair, and a "Tommy was either in his corner or not"
that the car-show slot made false. Five guard-rails broken on purpose, and one
break that left the suite green and is written down rather than papered over
(#147).

**One shared thing was touched**, the `Claimed` column of this file, and it is
cleared. `check-integrity.mjs` fails on `Tools/prompt-builder.html` alone
(1,485 units, 1 broken), `social:check` reports the same six pages out of sync,
`check-collisions.mjs` passes.

Before that: **Daredevil Phase 3 — Relationships as a declared thing (PR
#218)**. Six characters, five stored keys, no schema, and
`applyEffects` wrote `rels.peet = 'aly'` and told nobody. Now `js/cast.js` is
one table — legal states in order, a label per state, the never-met state and
the start state — re-exported by `state.js` and a leaf below it, because
`save.js` needs it to seed and repair a run (#276). `pete` is seeded as
`'unknown'`; every guard that read `undefined` as "thread never opened" reads
`'unknown'` the same way, and the two mentor-ending tests that did not read
`isPresent('pete')` now (#275). `repairState` puts an illegal state back to
the start state and drops a key the cast does not know; the game's two
writers go through `setRel()`, which throws by name (#278). A relationship
gate is data: `_needs: { earl: [...] }` on choices and on hub cards, the three
relationship `_requires` closures converted and the hubs' eight inline tests
moved onto cards. The two priority ladders and `_m3_prestunt` are tables in
`scenes.js` scanned by `routeByCast()`; the Milestone 5 ladder had tested
Ruthie for `'warm'`, a state she has never held, and a route row on such a
state throws now. Milestone 5 keeps Ruthie before Cal (#277).

**The suite** is a section of `smoke-save.mjs`, 53 → 110: the table's own
contract, then a sweep that imports `scenes.js` under Node and reads both
sources as text — 135 (character, state) mentions — and asserts each is legal
and labelled, plus no `_requires` that reads `rels`. Nine guard-rails broken
on purpose; one suite rewrite because the `'warm'` break killed the suite
instead of failing it (#147). `smoke-page.mjs` 93, unchanged and green; six
transcripts re-taken, moved by stunt scores and the ending roster's order.

Before that: **Daredevil Phase 2 — Everything the game already wrote and
cannot show (PR #216)**. Four finished pieces of writing no run could reach
and two flags that could not be true: `fr2_close` and `fr4_close` routed on
both branches (#270), `m2_sign` sets `rels.earl` and `m2Complete` (#271), the
Earl-picked canyon ending is its own `m5Outcome` (#272), one relationship
label table (#273), `pressAtFair` and `earlApproached` cut. A new suite,
`test/flags.mjs`, 7 assertions, no browser, freezes the twenty-eight
write-only flags and checks the list from both ends (#274);
`transcript.mjs` logs the stat-update relationship rows, which is what found
`m2_sign`. `smoke-page.mjs` 70 → 93.

Before that: **Daredevil Phase 1, increment 2 — the backer-less branch
through Milestones 3 and 4 and the endings (PR #214)**, which finished the 2+
row at rank 1 in two increments.

**What increment 2 built.** After increment 1 a "Not interested" run played
its own Milestone 2 and a Free Roam 2 that knew, then read a backer run from
`m3_entry` to the ending screen: 31 lines naming Earl. Now a `solo()` helper
at the top of `scenes.js` is read first by every one of them. Dot Kessler
meets Duke off the ramp at the Speedway and brings the fee envelope after the
bad crash; Roy Petersen is the feature-race crew's cameraman (#268); the
Sandra thread has no page seven; `m4_entry` is Duke's own folder and his own
Friday; the man from California calls for himself in Free Roam 4
(`fr4_eve_california`, where `fr4_eve_earl` would be) and the solo Milestone
5 button reads `fr4_close` (#267); "One last stunt — Earl picks" is hidden and
the option count counts (#269); the epilogue's absent line names who booked
him and who paid for the cars. `smoke-page.mjs` 61 → 70: `playToEnd` keeps
every piece of text the run was shown and the solo run asserts none of it
from `m3_entry` on names Earl. A sixth transcript, `no_earl_crash`. One
guard-rail broken on purpose. Decisions #267 to #269; the account is under
"Daredevil, arc one" in `HISTORY.md`. Left for later phases, not this row:
the Legend track still requires Earl. (The backer branch's `fr4_close` was
Phase 2's first bullet, and Phase 2 routed it.)

Before that: **Daredevil Phase 1, increment 1 — the backer-less Milestone 2
(PR #212)**.

**What increment 1 built.** Answering "Not interested" to Earl at the fair
used to remove three optional evening cards and change nothing else; Earl
negotiated at M2 regardless and `m2_sign` set him back to `'backer'`. Now
`_chapter_m2` routes `rels.earl === 'absent'` to `m2_solo_entry` (chapter
"The Other Way"), fourteen `m2_solo_*` scenes run the negotiation's
three-round shape against a promoter, a bank and Duke's own arithmetic, and
`m2_solo_close` ends where `m2_sign` ends. Free Roam 2 knows it happened:
`fr2_debt_01` is the only card until it is played and the Milestone 3 button
waits (#266), "Borrow from Earl" is hidden, `debtSource` is read by
`fr2_close`'s solo arm, and the solo branch's Milestone 3 button routes
through `_chapter_fr2_end` so `fr2_close` is reached by a run for the first
time. **Q3 was answered by the session** — shape B, decision #265 — and moved
to the answered list. `smoke-page.mjs` 44 → 61 with a third full run that
answers "Not interested"; a fifth transcript plan, `no_earl_solo`; two
guard-rails broken on purpose. The full account is under "Daredevil, arc one"
in `HISTORY.md`.

Before that: **Faire Weekend Phase 8, "The wiring audit,
automatic" (PR #210)**, which **closed the rank 1 of its day** — a ½ row,
closed in one session, so it came out of the ranked table and everything
below it moved up one.

**Faire Weekend has no ranked row any more.** Phase 8 was the last phase in
that project's `WISHLIST.md`; what is left there is the standing backlog at
the bottom of the file (sound, a downloadable postcard at poster size, the
`.json` content swap `data.js` promises, difficulty settings, decomposing
`simulateDay`), and a new arc needs a row here first. The School Generator is
in the same position, for the same reason.

**What Phase 8 built.** `tests/wiring.mjs`, 136 checks, `npm test` running it
after the other three suites. It reads `js/ui.js` and `js/main.js` as text —
thirty `data-action` names off the markup, thirty-three `case` labels off
`handleAction`, three `dataset.action` branches and one id-matched input off
the delegated change listener — and asserts the sets agree in both directions
and that every one of them is reached by `tests/smoke.mjs` or
`Tools/board-check/play-games.mjs`. Three rounds of review had run that grep
by hand; round 2 found ten never-clicked actions, round 3 found `cancelMove`
after round 2 called the audit closed.

**It found two on its first run.** `contractCrew` and `releaseCrew`, shipped
by Phase 7 the round before, had never been clicked by anything — the engine
calls were covered, the buttons were not. Section 22 now contracts a gate
crew through its Day Rate button, lets a day-rate crew go for nothing, and
breaks a crew's Weekend Package for the fee. `tests/smoke.mjs` 2,108 → 2,118.

**Three decisions, all about how an audit stays honest.** #262: a text scan
that lives inside a file it scans reads its own inventory back as coverage,
so the audit is its own file and not a Section of `smoke.mjs`. #263: `ui.js`'s
three contract buttons interpolate their action name, so the audit resolves
them off `contractButtons`'s call sites rather than carrying a hardcoded
list, and a second interpolation site anywhere fails until it is resolved
too. #264: every allowlist entry is checked from both ends, including whether
it is still *needed*, so the list can only shrink.

**Guard-rails broken on purpose (#34), fifteen**, including both the ones the
row mandated. Two assertion wordings turned out to be wrong under a break and
were rewritten: a coverage loop over emitted-plus-handled claimed the page
emitted a `data-action` it did not (#147), and the resolver's spot-check named
a cause that was false the moment a fourth call site made it fail the other
way.

**No game code changed.** `Projects/Ren-Faire-Claude/js/` is byte-identical to
what Phase 7 shipped; the edits are the two suites, `package.json`'s test
script and the documentation.

**None of the four shared things was touched.** `play-games.mjs` is read as
text by the new suite and was not edited. The two site-wide checks are exactly
as they were on `main`: `check-integrity.mjs` fails on
`Tools/prompt-builder.html` (1,481 units, 1 broken), `social:check` reports the
same six pages out of sync, `check-collisions.mjs` passes.

Before that: **the School Generator walk shell's bundle marker (PR #208)**,
which closed no ranked row — it was the standing `check-integrity.mjs`
failure recorded under "The site itself" below, an HTML comment inside
`tools/walk-shell.html`'s module script, there since Phase 27. The marker is
`/*SG-BUNDLE*/` now (decision #261), the committed `walk-template.html`
rebuilt byte-identical, and `test/export-walk.test.mjs` refuses the next one.
That is what took `npm run check` from two broken units to one.

Before that: **Faire Weekend Phase 7, "A third crew" (PR #207)**, which
closed the rank 1 of its day — a 1-session row, closed in one session.

**What Phase 7 built.** `CREW`, six rows across three roles, two tiers
each, `unlockSeason`-gated like every other catalog and signed through
the same `CONTRACT_OPTIONS` deals and negotiation form an act signs.
`covers`, in heads, is the one field they add, and it is the whole
design: a crew is worth what the crowd it covers is worth and nothing to
a faire that already covers it. The gate is a ceiling (#255) — 550 a day
unstaffed, everybody past it turned away with no ticket, no purse,
nothing to host, and mood off the crowd that got in; both gate crews add
1,300, and `baseOverhead` came down 2,200 → 1,900, the gate's share of a
stand-in that is now a line the player signs. The watch reads the crowd
it did *not* cover above `calmCrowd` and scales both the weight and the
bill of the two `incident:`-flagged `EVENT_POOL` rows, priced off an
`expectedCrowd` that leaves the sky out (#257). The herald moves a
block's overflow into the blocks with room, stopping at the crowding
line (#259). One `contractedCost(act, contract)` with three callers
replaced two copies of the same six lines (#258), and crew take no
relationship, no arc and no tenure toward renown (#256).

**Two things it found in code that was already there.** `tests/
smoke.mjs` Section 1g had built its fixtures with `schedule: {}` since
Stage 19, which `assignSchedule` refuses outright — so SIGNIFICANCE 9
and 10 had never once put an act on a stage, and both passed anyway
because both sides of each comparison shared the defect (#260). And
`simulateDay` dropped the over-capacity crowd out of the satisfaction
average entirely, so a stage that turned five hundred people away from
the view scored what a full-but-seated one did; they count now at
`OVERFLOW_QUALITY` 0.25, which is also what gives a herald anything to
sell.

**One threshold re-derived rather than nudged.** The full-run test's
season-one headliner signing was riding on a Weekend 4 mood line that
came in at exactly 70/100, the bar to the point. The run diverges under
crew wages, that weekend now averages 68, and renown closes Weekend 5 at
19 — one short, with no weekend left to spend it in. The headliner signs
in season two instead, which was already asserted; the season-one line
now guards the bar rather than the luck.

**A number for Q27.** The scripted full-run manager, which now staffs the
grounds the morning after the first day anybody was turned away, wins
season one on $106,556 at **reputation 74**. Phase 4 recorded that no
manager the suite could write took reputation past 63 from 50, and the
fixture seeds it at 70 and says so. Staffing the grounds moves it up
rather than sideways. On the deliberately maximal fixture an unstaffed
gate turns away 1,567 of 2,117 and nets $364 a day against $17,808 for
$930 of wages — and that same fixture's mood goes 53.6 → 46.2, because
eighteen hundred people against three stages is what that looks like.
The gate buys money and owes stages.

**Guard-rails broken on purpose (#34), thirty-four.** Twenty-eight in
the first pass. Three arrived as stack traces rather than sentences — a
null quote inside `contractCrew`, a `.error.includes` on a refusal that
had stopped refusing, and a `repair` written as a default plus a separate
prune where deleting the default made the prune throw — and all three
were restructured until the break fails by name, then re-broken. **One
was not caught at all:** multiplying the weather back into
`expectedCrowd` left the suite green, because the Phase 2 determinism
check runs on a faire too small to have an exposure. Section 1l now
asserts it on a faire big enough.

**Counts.** `tests/smoke.mjs` 1,951 → 2,108 (new Section 1l, SIGNIFICANCE
14-16, a crew-catalog block in Section 1); `tests/guests.mjs` 168 and
`tests/mapview.mjs` 172 unchanged; `play-games.mjs faire-weekend` 18
checks and `tools/touch-readout.mjs` 24 checks, 0 failed, no page or
console errors, no offsite requests.

**None of the four shared things was touched.** The two site-wide checks
are still red on `main` and were red before this branch: `check-
integrity.mjs` fails on `Projects/school-generator/tools/walk-shell.html`
and `Tools/prompt-builder.html` (1,486 units, 2 broken), and
`social:check` reports the same six pages out of sync. `check-
collisions.mjs` passes. Outside the project: `HISTORY.md`'s decisions 255
through 260 and a Phase 7 entry, and `CLAUDE.md`'s locked-decision count
(254 to 260).

Before that: **Faire Weekend Phase 6, increment 2, "The build preview and
a readout a phone can read" (PR #205)**, which finished the 2+ row at the
old rank 1: `previewPlacement` as a pure read that splices a candidate
into a copy of the plots and runs the three functions the day itself runs
(#253), and `.plat-readout`, a `role="status"` live region written on
`pointerover` and `focusin` so a phone can finally read what a `title`
has never shown it (#254), guarded by `tools/touch-readout.mjs` on a real
coarse-pointer Chromium at 375 and 820.

Before that: **Faire Weekend Phase 6, increment 1, "A map you can pan,
zoom and preview into" (PR #203)**, which made the ground a canvas and
the map a view. `js/mapview.js` (pure, 172 checks in
`tests/mapview.mjs`) is the plat's geometry: the tracks and the paper
frame as content, a view as that content under one scale-then-translate
transform into a `.plat-stage`, cell ↔ screen (the 1px gap is nobody's),
the pan clamp, a zoom that keeps the point under the cursor still,
pinch, the arrow keys, and the rest rules — never above scale 1, never
under the coarse pointer's floor (44px markers at any stage width, which
at a 48px cell is exactly scale 1, so a phone pans rather than shrinks),
the stage's height fixed at rest. `js/plat.js` paints the double rule,
the tracks' rule exactly `trackSize()` big, every unlocked cell's
terrain, a cartouche, a compass and a shade on any edge the map runs
past. Drag, pinch, Ctrl+wheel, the keys and three buttons are ruled in
#252; the sheet no longer scrolls sideways at any width. Shot with Phase
5's camera at four viewports, which caught that a block-level grid is
its container's width whatever its tracks add up to (the same trap as
#247), so `.grounds-map` kept `width: max-content`.

Before that: **Faire Weekend Phase 5, "The review that has been owed
four rounds" (PR #201)**, which closed the previous rank 1.

**What Phase 5 built.** A camera, and the fixes it measured.
`Projects/Ren-Faire-Claude/tools/shoot-states.mjs` plays a scripted
season under Node, writes seventeen states into the save slot and boots
the real page in Chromium at 1280, 1080, 820 (touch) and 375 (touch), one
full-page PNG per state per viewport into
`Tools/board-check/shots/games/faire-weekend/` with a `measurements.json`
of live rectangles beside them. The before set measured: the Fair Floor
1,820px wide at a 1280 viewport (five 175px schedule `<select>`s in a
514px desk), Backstage 1,310 on a fresh game, the plat column 710px on
the 10-wide Home Grounds with 187px of the map's brown gap colour painted
east of the last column (445px at 1080), a 191px sticky HUD on a 375×812
phone, 34px plot markers on every tablet, a 16px slider and 31px
`<select>`s on touch. Five rulings, #246 through #250: the plat column is
a `calc()` off `--cols`, which `main.js` sets on `#board` (710 → 525px,
desk 517 → 702); the map is `max-content` wide; every roster and schedule
table sits in a `.table-scroll` box and no state at any width scrolls the
page sideways; the 1080 breakpoint's 38px cell is gone and the touch
sizes hang off `(pointer: coarse)` rather than a width; the phone HUD is
137px. **Q29 and Q30 are struck** (a width is not a pointer; the column
is threaded). Left in the wishlist's standing backlog: thirteen plot
cards in one column on a 1280 desktop, and the 820px HUD at two rows.

**Guard-rails broken on purpose (#34), twenty-seven, every one caught by
the assertion whose text claims it.** One was the bug the first draft
actually had: the column's calc said 32px where the sheet's rules add up
to 34, and Section 24 now adds them up from the rules themselves.

**Counts.** `tests/smoke.mjs` 1,825 → 1,859 (Section 28 new, 23 and 24
rewritten); `tests/guests.mjs` 168 unchanged; `play-games.mjs
faire-weekend` 18 checks, 0 failed headless.

**None of the four shared things was touched.** The two site-wide checks
are still red on `main` and were red before this branch: `check-
integrity.mjs` fails on `Projects/school-generator/tools/walk-shell.html`
and `Tools/prompt-builder.html` (1,474 units, 2 broken), and
`social:check` reports the same six pages out of sync. `check-
collisions.mjs` passes. Outside the project: `HISTORY.md`'s decisions 246
through 250 and a Phase 5 entry, and `CLAUDE.md`'s locked-decision count
(245 to 250).

Before that: **Faire Weekend Phase 4, "A faire that outlives its season"
(PR #199)**, which closed the previous rank 1 and arc one of that project.

**What it built.** Renown, a second track earned once per weekend at the
boundary from three lines (#241): the crowd's mood held across the weekend
(2 at 70, 4 at 85), every act kept a third weekend or longer (1 each, up to
5), and a weekend closed on four or more built plots with nothing torn down
this run (1). A run boundary: `closeSeason`, from the victory screen or the
weekend-end desk at Weekend 6 or later, with or without the win (#242),
banks a `seasonRecord` and opens the next season on renown whole,
reputation as the start plus half of what stood above it, and the acts'
stories kept (#244), with the next season's weather seed derived rather
than drawn off the clock. The carryover schema — `{ schema, run, seasons,
startedWith }` — is the first thing in that game's history to reach a save
through `migrate` rather than `repair`: the slot went 1 → 2, key unchanged
(#36), and a pre-Phase-4 save enters as run 1 with an empty record and the
mood renown its completed weekends earned, tallied once (#243). Two unlocks
hang off the track: the South Meadow, a fourth grounds tier of two authored
rows at Weekend 5 with 30 renown (#245), and a headliner, draw 10 at $980,
who will not sign for money alone until the faire has 20. The win screen is
a ledger, shared with the weekend-end desk once the season can close.

**A finding for Q27, recorded rather than acted on.** A scripted manager
playing from a real start banked $28,000 to $104,000 by Weekend 6 across
six seeds and a dozen builds and never took reputation past 63 from 50:
satisfaction sits in the 60s once the crowd outgrows the stages, and
attendance grows with the reputation the bar wants. The cash bar is trivial
and the reputation bar is out of reach for any manager the suite could
write. The win numbers were left alone — that is Devon's question — and the
full-run test seeds reputation at 70 and says why. **Q28 is struck**
(winning does not end the run; closing the season is the player's call).

**Guard-rails broken on purpose (#34), twenty-four, every one caught by the
assertion whose text claims it.** One break was first written wrong rather
than caught wrong: a `hidden` attribute on the HUD slot left its text in the
DOM and the suite green; deleting the slot fails four. The guest suite
caught the first draft of the meadow's path connector on its own: 25 hops
from the gate against a day's 24 steps.

**Counts.** `tests/smoke.mjs` 1,652 → 1,825 in two new sections (1k pure,
27 in jsdom); `tests/guests.mjs` 168 unchanged; `play-games.mjs
faire-weekend` 18 checks, 0 failed under Xvfb, no page or console errors.

**None of the four shared things was touched.** The two site-wide checks are
still red on `main` and were red before this branch: `check-integrity.mjs`
fails on `Projects/school-generator/tools/walk-shell.html` and
`Tools/prompt-builder.html` (1,469 units, 2 broken), and `social:check`
reports the same six pages out of sync. `check-collisions.mjs` passes.
Outside the project: `HISTORY.md`'s decisions 241 through 245 and a Phase 4
entry, and `CLAUDE.md`'s locked-decision count (240 to 245).

Before that: **Faire Weekend Phase 3, "Acts with a story" (PR #197)**, which
closed the previous rank 1: a relationship number per contracted performer
and vendor, 0-100 from a neutral 50, moved by what the day did; five tiers,
Sour to 20 and Devoted from 80; `ARCS` in `data.js`, eight acts with a beat
at each edge, thirty-six choices applied by `resolveBeat` into `actTraits`
and read back through `performerFor`/`vendorFor` (#240); and a contract as
a negotiation, `quoteContract` the one quote with the quick picks as points
on its grid (#237), a Devoted act asking 15% under a stranger and a Sour one
15% over. Six rulings, #235 through #240; SIGNIFICANCE 12 and 13; twenty-
three guard-rails broken, twenty-one caught by the assertion whose text
claims it and the two that were not the test's fault. `tests/smoke.mjs`
1,118 → 1,652.

Before that: **Faire Weekend Phase 2, "Weather worth checking" (PR #195)**,
which closed the previous rank 1: seven skies in a `WEATHER` table, each a
heat multiplier on every block's sun, an attendance multiplier and a
satisfaction delta, with early/late draw weights ramping across six weekends
(weekend 1 is 48% hot days, weekend 6 is 30% wet). Weather is a pure function
of a per-save `weatherSeed` and the calendar rather than the day's rng (#231),
which is what lets the Office desk print an exact one-day forecast (#234);
`createInitialState()` stays deterministic and `newGame()` is the one function
that reads the clock (#232); the shade *weight* gets the ceiling (#233).
SIGNIFICANCE 11: on the hottest day a grove stage has the happier crowd and on
the coolest the hilltop takes it back. `tests/smoke.mjs` 857 → 1,118.

Before that: **Faire Weekend Phase 1, increment 2, "The economy" (PR #193)**,
which **closed the previous rank 1** — a 2+ row, finished in two increments.
The walk became the only answer to "how did that stall do today": a stall's
gross is `spentAt`, money guests physically handed over out of purses
`walkGuests` tracks, scaled by `represents` with the house taking
`wristbandCut` off the top (#226). `computeFootTraffic` survives as the
*estimate* the build palette shows before the gates open; `measureFootTraffic`
is its measured twin and is what the report carries. The col-3 spur is ruled
(#227). Three numbers moved: `wristbandCut` 0.28 → 0.12 (#228), the gate
taking its share of the purse before a guest reaches a stall (#229), and
`stepsPerBlock` 12 → 6 (#230). The ledger landed at: empty field −$1,177 a day
(unchanged), day-one build +$248, mid faire +$3,626, built-out +$8,980. Its
`SIGNIFICANCE:` rewrite found that all seven original checks passed untouched
under a rewritten economy, because every state they use is a bare stage with
nobody selling anything — **check what state a passing significance test runs
on before trusting the pass.**

Before that: **Faire Weekend Phase 1, increment 1, "Guests who walk" (PR
#191)**, which built the crowd as people and walked it with the money left
where it was: `GUESTS` in `data.js`, `js/guests.js` (pure), `tests/
guests.mjs` new, at most 400 agents each standing for `attendance / 400`
(#223), the walk on its own rng stream so forty seeds still roll the events
they rolled before (#224), a stall a guest cannot afford pulling nothing as
the one purse rule (#225), and a "Where the crowd went" line on the ticket
stub.


Before that: **The Fourth Quarter Phase 9, "A night you can lose" (PR
#189)**, which **closed rank 1**: a 1-session row, closed in one session.
**The Fourth Quarter has no ranked phases left** — all nine have shipped, and
its `WISHLIST.md` now opens by saying so.

**What it built.** A way to lose, and a way back. A night whose books close
below $0 is a missed night; three in a row and the landlord takes the lease
(#219). One night back in the black clears the count outright, and dark
nights count, which is the one way a venue move can bankrupt you mid-move.
Eviction drops a rung rather than ending the run (#220): `evictLease()`
walks `VENUE_ORDER` backward through the list `moveVenue()` walks forward,
the smaller room's move-in nights come due, gear it has no wall for comes
off with its upkeep, the regulars over its cap stop coming, and the debt is
written off against the seized deposit. Only an eviction from the Corner Tap
sets `failed`. One `billsFor(c)` replaced two hand-written copies of wages +
rent + upkeep (#221), because the lease check reads that number on both
paths. On the page: a standing notice on the Tonight panel, a Lease section
on the box score, a Run section once the run is over, and a
"Start a New Campaign" button that is the one campaign-eraser in the game.
`strikes`, `failed`, `stats.bestTier` and `stats.evictions` are additive
(#222) — no key change, no version bump.

**It answered Questions for Devon Q23**, "should there be a way to lose?",
raised three times and blocking four rounds of that project. That question is
struck below.

**Guard-rails broken on purpose (#34)**, seventeen in Node, each caught by
the assertion whose text claims it. Three first left the suite green and the
assertions were rewritten until they did not: a threshold raised above
starting cash was caught only by a check on the constant; `Math.max(1,
to.darkNights)` was invisible on a rung whose own count is already 1; and a
dropped upkeep line was invisible on a campaign with no gear installed,
which is the exact shape of the bug #221 exists to prevent.

**Counts.** `test/smoke-campaign.mjs` 241 → 293, Node total 1,274 → 1,326;
`tools/browser-check.mjs` 224 → 261, run by hand. Two earlier browser runs
failed and both were CPU contention from a second Chromium running
alongside, which is what the root `CLAUDE.md` warns about; the clean run is
green.

**None of the four shared things was touched.** The two site-wide checks are
still red on `main` and were red before this branch: `check-integrity.mjs`
fails on `Projects/school-generator/tools/walk-shell.html` and
`Tools/prompt-builder.html` (1,465 units, 2 broken), and `social:check`
reports the same six pages out of sync. `check-collisions.mjs` passes.
Outside the project: `HISTORY.md`'s decisions 219 through 222 and a Phase 9
entry, and `CLAUDE.md`'s locked-decision count (218 to 222).

Before that: **The Fourth Quarter Phase 8, "The night has moments"
(PR #187)**, which put the 2D build's event cards on the floor as people who
walk in and props that sit there: `js/events.js` with nineteen of the 21
cards, twelve effect kinds the engine spends, a card that keeps waiting
until the boss answers it or last call resolves it to its first option
(#216), `settleNight()` reading the floor's record (#217) and the
inspector's nose as overstock (#218).

Before that: **The Fourth Quarter Phase 7, increment 2, "A regular is a
person on the floor" (PR #185)**, which closed the 2+ row's second
increment and the phase's last bullet: a regular comes through the door as
a spawn from the engine's own arrival stream (#212), wears a nameplate,
takes a stool at the bar and orders the usual, and the boss can put the
first round on the house (#214); the floor reports three id lists at close
and the books read the comp (#213). `smoke-engine.mjs` 196 → 223,
`smoke-regulars.mjs` 89 → 98, `tools/browser-check.mjs` 178 → 193.

Before that: **The Fourth Quarter Phase 7, increment 1, "The books remember
you" (PR #183)**: `js/regulars.js` (251, pure), a named person with a usual,
a MAFA team and a loyalty number; reputation as one number 0-100; The End
Zone across town as a buzz 10-95 drifting against it. Who is in tonight is
one generator step off a hash of the id and the day (#207), a day-one
campaign forecasts what it forecast before (#208), the rival gets no panel
and a floored drag (#209), a regular at zero is remembered for six names
(#210), and a dark night costs standing (#211). `test/smoke-regulars.mjs`
new (89), Node total 1,026 → 1,117, `tools/browser-check.mjs` 162 → 178.

Before that: **the teaching-tools archive (PR #181)**, which
is not a ranked row: Devon's direct instruction, worked while another session
ran a game's rows. It took 21 rows out of the table and put them in
`ARCHIVE.md`. The paragraph below says what it did and what it deliberately
left ranked.

Before that: **The Fourth Quarter Phase 6, "The league
has a season" (PR #179)**, which **closed that row**: sized 2+, every bullet
closed in one session, so it was marked shipped rather than left open for an
increment with nothing to do. `js/league.js` (319, pure) holds a MAFA season:
eight named teams, a 14-week double round-robin dealt off a seed, a four-team
bracket, a champion, two dark weeks, the next season. The calendar is the
schedule (#203), there is one result and the TV, the box score and the
standings cannot disagree about it (#204), and `forecast()` reads a crowd
table rather than a flat game-night 1.5 (#205). `test/smoke-league.mjs` is new
(84), Node total 924 → 1,026, `tools/browser-check.mjs` 145 → 162; nineteen
guard-rails broken on purpose.

Before that: **The Fourth Quarter Phase 4, "The texture diet" (PR #178)**,
which closed arc one: `js/textures.js` as the registry and `pickTier()`
choosing 1k for everyone but a Retina-class screen on a GPU with an 8192
texture limit (#201), the 1k set generated offline by
`tools/make-textures.mjs` at 5,076,840 bytes against 69,218,191 (#202), one
`LoadingManager` behind a counted loading line, and `tools/measure-load.mjs`
measuring 4.85 MB and 5.02 s to fully textured at 20 Mbps against 66.02 MB
and 30.86 s.

Before that: **The Fourth Quarter Phase 2, increment 3, "The flagship's
mezzanine" (PR #176)**, which closed a three-increment 2+ row: `mezzanines`
on a description, raised rectangles with a deck height and a stair, kept
apart from `annexes` (#198); `floorYAt(desc, x, z)` as the one place the
floor stops being 0, with seats, colliders, stand-points and the crew's homes
carrying the floor under them; one step rule (`STEP_H` 0.18 m or `MAX_SLOPE`
0.75 per metre) deciding the grid's neighbours, the sweep, the string-pull
and `nearestCell()` alike (#199); every walker and the player's eye reading
y off the floor after every step (#200). The flagship's deck is 1.6 m over
the hall's south-east corner, and the ladder stayed 30 / 44 / 58 / 76.

Before that: **The Fourth Quarter Phase 2, increment 2, "A room that is more
than one rectangle" (PR #174)**, which gave a description `annexes` — further
floor rectangles with their own ceiling height and the hall wall they open
through, read by `areasOf()` everywhere the hall and the kitchen used to be
named by hand (#194), the shared edge one wall thickness outside the hall and
the doorway band derived (#195), the north wall the kitchen's (#196) — and
Midtown its 6×8 m back room, furnished by moving three four-tops (#197).

Before that: **The Fourth Quarter Phase 3, "Feet that find the door"
(PR #172)**, which gave everything that walks a nav grid and a planner — A*
over the sweep's 0.25 m lattice with every collider inflated by `WALKER_R`
(#189), a route that says whether it got there rather than failing (#190),
both ends allowed inside inflated geometry (#191), `freeSeat()` refusing a
stool with no route (#192), and `validate()` carrying `navProblems()` (#193).

Before that: **The Fourth Quarter Phase 2, increment 1, "Four rooms, one
ladder" (PR #170)**, which made `js/layout.js` hold four descriptions instead
of one — the Fieldhouse, Midtown and the flagship at 44, 58 and 76 seats, each
the Corner Tap's plan bigger (#185) — gave `validate()` a flood fill from the
door (#186), gated two upgrades on buying rather than owning (#187), and had
`world.js` derive its neon, corkboard, shelf and shadow cameras from the room
and scale surface UVs by room size (#188).

Before that: **The Fourth Quarter Phase 1, "The room is a description" (PR
#168)**, which made `js/layout.js` the room — seats, colliders, `inBounds()`
and the walkability invariant derived from one description per tier, held
to a Chromium dump of the old `world.js` (#182), and `tools/browser-check.mjs`
catching the `ring` key clash every Node test missed (#184).

Before that: **Absalom Phase 7, "Two more heirs, with their own satchels"
(PR #166)**, which closed arc two: `buff` replacing `self-buff` and `debuff`
as the first command whose whole effect is a condition (#177, #178),
`inflicts` gaining `on: "fail"` (#179), precision damage as a rider on
`attack` (#180), `startingInventory` per build (#181), Mother Isbeth Sarr and
Nim Corvale as the third and fourth builds, and a browser suite that caught a
satchel resolved on the wrong side of `selectPc` and a reloaded save that sat
frozen on a creature's turn.

Before that: **Absalom Phase 6, "An area should be a file, not a diff" (PR
#164)**, which made a third area cost one content file and nothing else — one
tile-kind table read by three modules, per-area `tuning` layered on the pack's,
`content/packs.json` as a manifest with `?pack=<id>` opening either adventure
off the same HTML, `packId` with teeth and a storage key per pack, and a reward
that is a field on content rather than a new kind of square (#175). It also
found that a stairway you land on is a stairway you immediately take again
(#176), and that a room in the middle moves the dice under every room after it.

Before that: **Absalom Phase 8, "The debts on the surface" (PR #162)**, which
made the hint bar follow the room across a stairway, made a build's three prism
faces required content (#168), gave reactions and conditions their own log
colours off a table (#170), made a refusing number key say which of six reasons
it refused for (#171), and built `test/browser.mjs`.

Before that: **Absalom Phase 5, "A harness that says which fight killed you"
(PR #160)**, which gave `balance.mjs` a row per encounter and per area, an
exactly-compared `test/baseline.json` (#164), deaths per encounter as the number
that does not truncate (#165), and `--variant` as a flag rather than a
throwaway script (#166).

Before that: **Absalom Phase 4, "Creatures that know what they are standing
in" (PR #158)**, which made a creature's turn a decision — `js/ai.js` as a
pure `chooseAction(view)`, three policies off a per-creature `ai` field, a
skirmisher that reads the reaction bus and a caster with a cone of its own.

Before that: **Absalom Phase 3, "Templates and line of effect" (PR #157)**,
which built `js/templates.js` — the cone, the burst and the emanation as grid
squares — and split line of sight from line of effect so a shut gate stops a
spell it does not stop an eye.

Before that: **Absalom Phase 2, "Conditions that expire"**, in two increments
(PRs #153 and #155), which deleted `turn.shielded`, built the pure condition
layer and the one-`check(` funnel, and then gave it a catalogue of eight and a
nine-kind modifier funnel.

Before that: **Absalom Phase 1, "The interrupt point" (PR #151)**, which built
the reaction bus those turn boundaries hang off — three named trigger points,
one reaction per actor per round, and a creature turn that is a generator the
caller drains so a Stride can be interrupted between two squares.

Before that: **Torchbearer Phase 8, "The contract, and its first new author"
(PR #149)**, **Torchbearer Phase 7, increment 3 (PR #147)**, **increment 2 (PR #145)**, **increment 1 (PR #143)**, **Phase 6, increment 2 (PR #141)**, **increment 1 (PR #139)**, **Phase 5 (PR #137)**, **Phase 4 (PR #135)**, **Phase 3 (PR #133)**, **Phase 2, increment 2 (PR #131)**, **increment 1 (PR #129)**, **Torchbearer Phase 1 (PR #127)**, **Hearth Phase 8 and Fourth Quarter Phase 5 (PR #125)**, **Hearth Phase 7 (PR #123)**, **the three increments of Hearth Phase 6, "Scarcity that bites"
(PRs #117, #119 and #121)**,
**Hearth Phase 5 (PR #115)**, **Hearth Phase 4 (PR #114)**, **Hearth Phases 2 and 3 (PR
#112)**, **Bell to Bell Phase 8 and Hearth Phase 1 (PR #111)**, **Bell to
Bell Phases 6 and 7 (PR #109)**, **Phases 4 and 5 (PR #108)**, **Phases 2 and 3 (PR #106)**,
**Phase 1, the slot scheme and the 6th period (PR #104)**, **this backlog's own
consolidation (PR #102 and #103)**, **The Seal (PR #101)**, and **the upgrade
paths and ten phased wishlists (PR #100)**, which is where most of the ranking
below comes from. No site version was bumped — none of these phases shipped a
board, tool or page change.

**The teaching tools are archived (PR #181).** Devon's call, 2026-09-08,
locked decision #206: the five classroom tools are no longer maintained or improved
on this repo, so their open work came out of this file and went into
`ARCHIVE.md` whole. Twenty-one ranked rows, four Tier 2 sections, six
questions, five Ownership rows and two "sources disagree" entries. Nothing was
deleted and no tool changed: every page still serves, the four Node suites
that need no `puppeteer-core` pass (139, 213, 153 and 31 assertions), and
`Tools/schedule/WISHLIST.md` stayed where it is with an archived banner on it. **`Tools/board-check/` is not archived** — it is the site's own check and
regression suite, not a teaching tool, and its six ranked rows are game and
site work that happens to land in that folder. Neither is
`Tools/prompt-builder.html`, which is red on `npm run check` today and is a
site problem.

**69 ranked items**: PR #224 closed the 1-session row at the old rank 1 and it
came out of the table. 20 of them are phases in a live project `WISHLIST.md`;
the other 49 are standalone, and live in Tier 2 below.
Beyond the ranked list there are 241 open bullets in the projects' standing
backlogs (Daredevil gained one: `m5_question_earl`, a written scene no
relationship state reaches) and 37 open questions for Devon (Q3 answered,
#265) — 347 open items in all. **Q27 is partly answered**
(`perGuestCost` stays at 5, ruled rather than assumed; its other three
numbers are still open) and is kept in the list rather than struck, because
the part that needs a real season played is the part still standing.

**Pick up rank 1: `Projects/daredevil` Phase 6, "Evenings that cost
something" (Claude Opus 5, size 1).** Merge your claim first (#283). The hub
hands out seven evenings and builds four cards, so `hubExhausted()` fires
because the cards ran out, not the evenings; the row budgets evenings below
the card count per hub, holds money as one integer in `GS`, makes Condition a
cost the stunt physics already read, lets Milestone 4's stunt choice read
whether the act could afford the buses, and prints the trade on the card.
The save change is additive — a money integer and per-hub budgets, defaulted
in `freshState` and filled by `repair` (#36, #37) — and `smoke-page.mjs`
should assert the budget binds: a run that spends every evening reaches the
milestone with cards unread.

What is there to lean on: the four `renderHubFRn` functions and
`buildHubCard` in `engine.js`, `hubExhausted()`, and since Phase 5
`test/graph.mjs`, which reads the renderers as text for their cards — a card
you add or gate appears in its walk, and a card nothing can reach fails
`smoke-save.mjs`. Phase 4's rule for new content still holds: numbers go on
a choice's `effects`, only relationship and flag writes on a `statUpdate`,
because a choice-reached scene's update fires twice.

Run `node Projects/daredevil/test/smoke-save.mjs`, `flags.mjs` and
`graph.mjs` first; together they are under ten seconds. `smoke-page.mjs` is
about twenty-five minutes of real browser, so run it once, at the end, and
re-take the nine transcripts if a hub's card list moved. A 1-session row is
the whole batch; do not pair it with rank 2.

**Phases 1 to 5 are finished** — PRs #212, #214, #216, #218, #220 and #224,
decisions #265 to #285. Q3 was answered by a session as **(B)**; Q31, the
six-way shape of the fair response, is still open and is not in front of any
row.

**Read this before trusting the order.** Two sources rank the same work
differently, and the table follows `UPGRADE-PATHS.md`'s order because it is
the newest:

- **Daredevil holds rank 1, which is where three other sources always put
  it.** `gvb-site-handoff-v10.md` §11, the round-3 refresh notes and prompt
  22's notes all call the Earl decision "the single biggest open item on the
  site." It used to sit at rank 8 partly because it was blocked on Devon (Q3);
  a question there no longer blocks its row, so that argument is gone.
- Bell to Bell's own `docs/HANDOFF.md` said the next ticket was T8, whisper
  audio. It shipped in Phase 7, directional, in this backlog's own last round.
- Four more disagreements of the same kind are listed at the end of Tier 2,
  under **Where the sources disagree**.

**The round system is retired.** For three rounds this repo ran a 22-prompt
parallel split: one prompt per project, each declaring the paths it owned and
the rest of the repo read-only, with the four shared things (`index.html`,
`assets/js/gvb-save.js`, `Tools/board-check/**`, and the generated
`assets/previews` + `assets/og`) belonging to one prompt alone, and every other
session queueing written "Shared-file requests" for it to apply at the end of
the round. It worked, and it is gone: `Claude Prompts/`, the ten
`gvb-site-handoff-v*.md` files and `UPGRADE-PATHS.md` have all been deleted,
their open ideas folded into this file and their record into `HISTORY.md`.
What replaces the concurrency mechanism is three things: the **Ownership**
table in Tier 2, the **Claimed** column below, and the rule in the root
`CLAUDE.md` that shared-file edits now go in the same PR as the project change
rather than into a request queue.

---

# Tier 1 — the ranked index

One line per item, for scanning. `Area` is the folder the work lands in.
`Size` is ¼, ½, 1 or 2+ sessions. `Model` is what the item's own source names
— the wishlists name Claude Opus 5 or Claude Fable 5.1 per phase, and that is
carried here unchanged, not re-decided; `—` means no source named one.
`Claimed` is blank until a session writes its branch name in, and is cleared
after that branch merges. **A claim counts only once it is on `main`** (#283):
write it, open a one-line PR, merge it, then start. On 2026-09-11 two
sessions each wrote their branch into this row on their own branch, neither
could see the other's, and both built Daredevil Phase 4 in full — #220 merged
and #222 was closed unmerged an hour of suites later.

| Rank | Item | Area | Size | Model | Claimed | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 3 — The character builder. **Increments 1 and 2 shipped (PRs #242, #245): `src/js/build-rules.js` prices a build and refuses to price the unpublished attribute curve; `/mechanics/character-builder/` is the picker over `offered()`, kept in `localStorage` and the URL fragment.** Left: the printable character card on `print.css`'s `cardsheet` treatment | `Numina` | 2+ | Fable 5.1 | `claude/backlog-ranked-batch-e0a4dz` | [WISHLIST.md Phase 3](Numina/WISHLIST.md#phase-3--the-character-builder) |
| 2 | Phase 4 — The accessibility and mobile pass | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Numina/WISHLIST.md#phase-4--the-accessibility-and-mobile-pass) |
| 3 | Phase 5 — Come play | `Numina` | ½ | Opus 5 |  | [WISHLIST.md Phase 5](Numina/WISHLIST.md#phase-5--come-play) |
| 4 | Phase 6 — Excellencies, history, and the timeline | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 6](Numina/WISHLIST.md#phase-6--excellencies-history-and-the-timeline) |
| 5 | Phase 7 — The print packet and the offline kit | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Numina/WISHLIST.md#phase-7--the-print-packet-and-the-offline-kit) |
| 6 | Phase 8 — Search and navigation, upgraded | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Numina/WISHLIST.md#phase-8--search-and-navigation-upgraded) |
| 7 | Phase 1 — The sim without the page | `Projects/corner-and-kettle` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/corner-and-kettle/WISHLIST.md#phase-1--the-sim-without-the-page) |
| 8 | Phase 2 — `test/balance.mjs` | `Projects/corner-and-kettle` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/corner-and-kettle/WISHLIST.md#phase-2--testbalancemjs) |
| 9 | Phase 3 — The Serve gate, decided | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 3](Projects/corner-and-kettle/WISHLIST.md#phase-3--the-serve-gate-decided) |
| 10 | Phase 4 — The page becomes a view | `Projects/corner-and-kettle` | 2+ | Opus 5 |  | [WISHLIST.md Phase 4](Projects/corner-and-kettle/WISHLIST.md#phase-4--the-page-becomes-a-view) |
| 11 | Phase 5 — Staff who have a week | `Projects/corner-and-kettle` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/corner-and-kettle/WISHLIST.md#phase-5--staff-who-have-a-week) |
| 12 | Phase 6 — Customers who remember | `Projects/corner-and-kettle` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/corner-and-kettle/WISHLIST.md#phase-6--customers-who-remember) |
| 13 | Phase 7 — A reopening worth doing | `Projects/corner-and-kettle` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/corner-and-kettle/WISHLIST.md#phase-7--a-reopening-worth-doing) |
| 14 | Phase 8 — Both hands on the keys | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/corner-and-kettle/WISHLIST.md#phase-8--both-hands-on-the-keys) |
| 15 | Phase 9 — Join `npm run games` | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 9](Projects/corner-and-kettle/WISHLIST.md#phase-9--join-npm-run-games) |
| 16 | Review the captured preview candidate and promote it, or recapture | `Tools/board-check` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 17 | Decide whether `Pathfinder/data/` is a published interface or private | `Pathfinder` | ¼ | — |  | [Questions for Devon](#questions-for-devon) |
| 18 | Build Aphelion's airlock-entry beat, then land the ready-made `#signal` assertion | `Projects/aphelion` | ½ | — |  | [Aphelion](#aphelion) |
| 19 | Asset diet: 165 MB for 1,525 lines, two thirds of the Poly Haven packs unreferenced | `Projects/Castle Conundrum` | 1 | — |  | [Castle Conundrum](#castle-conundrum) |
| 20 | A data-driven quest graph to replace the 74-line "two booleans" quest manager | `Projects/Castle Conundrum` | 1 | — |  | [Castle Conundrum](#castle-conundrum) |
| 21 | A level editor with URL sharing, on the pattern Hearth already proves | `Projects/orbital` | 1 | — |  | [Orbital](#orbital) |
| 22 | Turn the physics suite's solver into a level generator | `Projects/orbital` | 1 | — |  | [Orbital](#orbital) |
| 23 | Multi-offer escalation wars as a dedicated flow | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 24 | Per-client financing types on the buyer side | `Projects/Closing Time` | ½ | — |  | [Closing Time](#closing-time) |
| 25 | A commercial tier at Broker-Track | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 26 | Tides as a real axis | `Projects/golden-hour-beach` | 1 | — |  | [Golden Hour](#golden-hour) |
| 27 | The causeway: the top half of the trail rides up to 10.9 m above the hillside | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 28 | The mountain has no peak — `mountainH` is a ramp in `z` | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 29 | CI runs almost nothing: no workflow runs `Tools/board-check`, `gvb-save.test.mjs`, or the ~16 project suites no phase has added one for | `site` | 1 | — |  | [The site itself](#the-site-itself) |
| 30 | One shared asset pipeline (prune, resize, draco/meshopt) for the ~380 MB across three games | `assets` | 2+ | — |  | [The site itself](#the-site-itself) |
| 31 | `gvb-save.js` v2: quota accounting, multi-key namespaces, an IndexedDB tier | `assets` | 1 | — |  | [The site itself](#the-site-itself) |
| 32 | A real-hardware pass: every atmospheric piece's numbers are software rasterization, and touch has never had a thumb on it | `site` | ½ | — |  | [The site itself](#the-site-itself) |
| 33 | An ownership manifest `check-integrity.mjs` enforces; `Tools/prompt-builder.html` is owned by nothing and fails the sweep today | `Tools/board-check` | ½ | — |  | [The site itself](#the-site-itself) |
| 34 | Extend `Pathfinder/tests/anathema.test.mjs` rather than starting a second suite, if the page gains interaction logic | `Pathfinder` | ¼ | — |  | [Anathema Archive](#anathema-archive) |
| 35 | Build the generator's Chronological merge/sort step, if the two chronicle views ever drift | `Pathfinder` | ½ | — |  | [Pathfinder Campaigns](#pathfinder-campaigns) |
| 36 | A commented-out `<template>` dossier block | `Pathfinder` | ¼ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 37 | In-browser editing via `gvb-save.js`, if the page's role shifts from showcase to living sheet | `Pathfinder` | ½ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 38 | Re-check the `[shared]` chrome against `campaigns.html` for drift | `Pathfinder` | ¼ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 39 | Touch/gamepad input — a full second input scheme, not a HUD addition | `Projects/aphelion` | 1 | — |  | [Aphelion](#aphelion) |
| 40 | Tune the cabinet and commode clearance margins tighter against their walls | `Projects/Castle Conundrum` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 41 | Confirm the gate door's own mesh is symmetric within its bounding box | `Projects/Castle Conundrum` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 42 | Get a real `npm run games closing-time` pass through the shared suite | `Projects/Closing Time` | ¼ | — |  | [Closing Time](#closing-time) |
| 43 | Multi-career history — a hall of past scorecards | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 44 | The unhandled edge case: a deal or listing still under contract on deleted content | `Projects/Closing Time` | ½ | — |  | [Closing Time](#closing-time) |
| 45 | A real hour on the beach with ears on: event pacing, sanderling flush distance, cricket density, night palette banding | `Projects/golden-hour-beach` | ½ | — |  | [Golden Hour](#golden-hour) |
| 46 | A real low-end-GPU run — the world is 10x bigger and every number is software rasterization | `Projects/golden-hour-beach` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 47 | Preview recapture and a board-card description refresh — it undersells the piece by about six features | `Tools/board-check` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 48 | A touch playtest on a real phone — the pill-as-throw-control needs a thumb on glass | `Projects/golden-hour-beach` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 49 | `play-games.mjs` beats off the new `?debug` `__gh` hook | `Tools/board-check` | ½ | — |  | [Golden Hour](#golden-hour) |
| 50 | Add Golden Hour to `assets/js/gvb-save.js`'s "Adopted by" comment | `assets` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 51 | If night proves popular: the owl hunts, and the fireflies drift toward the fire | `Projects/golden-hour-beach` | ½ | — |  | [Golden Hour](#golden-hour) |
| 52 | Register Blue Hour in `Tools/board-check/games.mjs` | `Tools/board-check` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 53 | A `capture-previews.mjs` recipe, then `npm run previews blue-hour` and `npm run promote` | `Tools/board-check` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 54 | A real GPU run: the mist banks' fill cost, the headlamp at decay 1, the lamp's feet-pool at real pixel density | `Projects/blue-hour-trail` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 55 | A touch playtest on real glass — hold-the-bottom-third-to-walk has never had a thumb on it | `Projects/blue-hour-trail` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 56 | An hour on the trail with ears on: dread cooldowns, fog periods, drone gains, the new stingers | `Projects/blue-hour-trail` | ½ | — |  | [Blue Hour](#blue-hour) |
| 57 | The phantom's downhill pan is exactly 0.000 — decide whether to mean it | `Projects/blue-hour-trail` | ½ | — |  | [Blue Hour](#blue-hour) |
| 58 | Beats that change in kind above the fog line, not just in rate | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 59 | The two conservative model gaps, as one coupled piece of work | `Projects/integer-foundry` | 1 | — |  | [Integer Foundry](#integer-foundry) |
| 60 | Whether the tile-cost hint should be more prominent once targets run past two digits | `Projects/integer-foundry` | ¼ | — |  | [Integer Foundry](#integer-foundry) |
| 61 | A 4th prong or deeper side content, only if Devon expands scope | `Projects/the-fracture-cycle` | 2+ | — |  | [The Fracture Cycle](#the-fracture-cycle) |
| 62 | A committed browser-driven test layer: grid render/unlock, save/reset/wipe, star display | `Projects/orbital` | ½ | — |  | [Orbital](#orbital) |
| 63 | Verify the rotate-to-play gate on a real device or real touch emulation | `Projects/orbital` | ¼ | — |  | [Orbital](#orbital) |
| 64 | Revisit `gvb-save.js` adoption for save-bar UI consistency | `Projects/orbital` | ½ | — |  | [Orbital](#orbital) |

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
2. **The `Pathfinder/data/` question** needs Devon's answer before any
   cross-project work depends on it. See Q1.

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
3. **If your own pass finds a `[shared]`-marked rule that's drifted** between
   this file and `campaigns.html`, flag it — that's real, separate work from
   the merge question above.

Still not touching the font-file-naming mismatch between this page's fontsource
convention and `campaigns.html`'s short form. Same bytes, cosmetic only, not
worth the churn.

## Aphelion

`Projects/aphelion/`.

Round 1 vendored the fonts, adopted `gvb-save.js`, and ran a full
fun/performance/audio/accessibility audit. Round 2 built the EVA distance
readout that audit flagged as optional. **Nothing urgent is left on the core
game.** What remains is one low-urgency item the notes have carried across
three rounds now, still with no forcing signal:

1. **The `#signal` regression beat**, if `play-games.mjs` ever gets an
   airlock-entry beat for Aphelion. The assertion body is unchanged since
   round 2:

   ```js
   // after cycling into EVA (main.js's setEVA(true) has run)
   const signal = await p.$eval('#signal', el => el.textContent);
   t.ok(/^SALVAGE \d+m/.test(signal), 'the EVA distance readout shows unscanned sites', signal);
   ```

   The blocker is that the airlock-entry beat doesn't exist yet in Aphelion's
   own game code, and building it blind from outside the project risks getting
   the actual gameplay wrong. Aphelion's own next session builds the
   prerequisite; the assertion is then a five-minute add.
2. **Touch/gamepad input, if this ever needs to run somewhere pointer lock
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
compositing. What's left, in order of value per effort:

1. **The chosen preview candidate needs a look-and-decide.** The candidate is
   sitting in `candidates/`, chosen, dated a fair-environment refresh — but
   whether it's the *right* frame is a call this project's own session should
   make, having asked for the recapture across two rounds. `npm run promote`
   was deliberately scoped to exclude it rather than decide for them.
2. **Cosmetic: the cabinet/commode clearance margins are generous (1.1–1.3 m
   from their side walls), not flush against them** — a future session could
   tune these tighter if the hall reads as too open with them pulled this far
   in. The column positions (world `x -6..-5.2` and `5.2..6`, right where a
   tighter shift would have put them) forced a choice between flush-to-wall and
   clear-of-column; clear-of-column won because it's the one that couldn't be
   skipped. Low value, low effort, purely a judgment call on how the room reads.
3. **Speculative: confirm the gate door's own mesh is symmetric within its own
   bounding box.** Round 3 fixed the sign/rotation error that put the whole
   leaf off-frame; it did not separately verify whether the Poly Haven model's
   authored geometry is centered within that box. No evidence it's actually
   off — worth a look only if someone notices it up close in play.
4. **The asset diet.** 165 MB of assets for 1,525 lines of code, roughly two
   thirds of the Poly Haven packs unreferenced.
5. **A data-driven quest graph.** The quest manager is 74 lines and "two
   booleans." An asset diet plus a data-driven quest graph is a real path; it
   ranked below the top ten because the notes say the piece is finished as
   designed and there is no in-project suite to build behind.

**Two things are decided, not open work, and don't need re-deriving:**

- **Leave the walls stylised.** Five 1k Poly Haven stone sets already sit on
  disk unused. Round 1's before/after pairs settled it.
- **No save.** The quest is one boolean (`hasKeystone`) plus one more
  (`victory`) and about fifteen minutes long. If a future session still wants
  it: there is no existing key to preserve, so locked decision #36 doesn't bind.

## Closing Time

`Projects/Closing Time/`.

**Round 3 closed both items round 2 left open** (the name-substring Ledger
filter, the career-ending dead end). What's left:

1. **Get a real `npm run games closing-time` run in** once `Tools/board-check`
   isn't in use by another thread. Round 3's two changes were verified by hand
   in a real browser and by the Node smoke suite, but not by the project's own
   end-to-end suite.
2. **Multi-career history.** The scorecard's button answers "how do I start the
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
  **Natural next layers: commercial tier at Broker-Track, per-client financing
  types on the buyer side, and multi-offer escalation wars as a dedicated
  flow.** A 97-assertion suite would hold them.
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

**Nothing is outstanding as things stand.** The one item still on the table is
deliberately parked, not forgotten:

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
4. **A level editor with URL sharing.** 961 lines, 22 provably-winnable levels.
   Hearth already proves the URL-hash pattern. The obvious upgrade; small, and
   only one round old.
5. **A level generator off the solver** already in the test suite.

One correction worth carrying, since the file that carried it is deleted:
**the live level count is 22, not the 21 an earlier survey recorded**, and
pack-02 holds 12 levels, not the "11 levels" its own description claimed.

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
Castle Conundrum's preview promotion (rank 16), Aphelion's airlock beat (18),
Golden Hour's preview recapture and debug-hook beats (47, 49), Blue Hour's
`games.mjs` entry and preview recipe (52, 53), the ownership manifest (33),
and Corner & Kettle joining `npm run games` (rank 15, its own Phase 9 —
`play-games.mjs` still has no reference to `coffee_shop_sim` or
`corner-and-kettle`, unchanged since round 1).

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

1. **CI runs almost nothing.** Seven workflows exist now — the Firebase deploy
   plus Numina, School Generator, Hearth, Fourth Quarter, Torchbearer and The
   Absalom Inheritance, the last four added by the phases that needed them.
   Still no workflow runs `Tools/board-check`, `gvb-save.test.mjs`, or the
   remaining ~16 project suites, and each of the six per-project files was
   written from scratch rather than from a template the next one could reuse —
   `absalom-ci.yml` was copied from `torchbearer-ci.yml` and arrived carrying
   its stale reference to this row's rank number, which is the argument for
   the template. That is what is left of this row: the suites nobody's phase
   happened to touch, and the six near-identical files.
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
5. **Ownership.** `Tools/prompt-builder.html` is owned by no prompt and
   hotlinks Google Fonts. The survey that raised this said it was "swept by no
   check", and that half is now out of date: locked decision #58 extended
   `check-integrity.mjs`'s sweep, and the page is one of the two standing
   `npm run check` failures today —

   ```
   FAIL Tools/prompt-builder.html
        references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
   ```

   so the fonts are a real, currently-red, one-session fix, and the ownership
   manifest is the separate thing that would catch the next unowned page before
   it gets that far. (It used to have company:
   `Projects/school-generator/tools/walk-shell.html` carried an HTML comment
   inside its module script, `SyntaxError: HTML comments are not allowed in
   modules`, at line 290, from Phase 27 until September 2026. Decision #261
   made the marker a JavaScript comment, and the sweep is down to this one.)

One more, from Hearth's own wishlist rather than a site survey, recorded here
because it is a board question: **Hearth is on the homepage (`index.html:492`,
tagged Sim, `data-new`) with no `assets/previews/hearth.jpg`.** Phase 8
decided against a `Tools/board-check/games.mjs` entry (#84, Q14 answered): the
board's suite runs headed on a desk and would be a shallower copy of the
harness's `save` mode, which `hearth-ci.yml` now runs on every PR. The
330×200 capture is still wanted and is not a desk job (Hearth is a 2D canvas),
but promoting one also writes `assets/og/hearth.jpg` and a social block the
page does not yet have, so it goes with the social-tag cleanup above.

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
open. Numina has four open questions left (Q32 to Q35), none of them blocking
anything ranked.

**The `Where` column names files that no longer exist.** The prompts, the
notes files and the ten handoffs were deleted in this consolidation; they are
cited by name so a raise count can be checked, and `git log` is where they
live. Nothing in that column is a link to follow.

### Asked more than once, across layers

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q1 | **Is `Pathfinder/data/**` a published interface other projects may read, or private to the Pathfinder pages?** 24 JSON files of PF2e rules data sit there. The Absalom Inheritance reads none of it and hand-writes three stat blocks and seven commands into `content/vault.json` instead; Torchbearer would build its own monster and treasure tables if the answer is private. Both considered depending on it and both correctly stopped rather than assume. `UPGRADE-PATHS.md` calls it the highest-leverage *decision* on the site. | **6** | prompt 01's block (the central tracker), prompts 10 and 11 raising it into that block, `Projects/torchbearer/WISHLIST.md`, `Projects/absalom-inheritance/WISHLIST.md`, `UPGRADE-PATHS.md` "Close behind", `gvb-site-handoff-v10.md` "Three things" and §11.4 |
| Q2 | **Should the Serve button require full order completion, now that baristas — not the player — are the main path to a finished cup?** The gate is `cupMatchesEnough()` at line 1392: four lines, checking that a base exists and, if the recipe needs milk, that some milk is poured. Not the right milk, not the syrup, not the toppings, not the shot count. Measured on otherwise identical days: patient serving (waits for `orderIsComplete()`) 41 offered, 41 served, $309 net, 100% accuracy, reputation 50 → 66.4; eager serving (clicks the instant `disabled` comes off) 43/43, $77, 46%, reputation 50 → 19.2. Three answers are all real: tighten the gate to `orderIsComplete()`; keep it loose and put a cue on the button ("still missing: syrup, whip"); or leave it exactly as it is, because the accuracy and reputation hits already are the consequence. **The recommendation is the cue** — `serveSlot()` already prices partial credit deliberately (`earned = recipe.price * (0.35 + 0.65 * ratio)`), so serving a wrong cup for 35% of the price is a designed mechanic, not an oversight, and a hard gate would delete the one lever a player has when four customers are about to walk. What is broken is that the tradeoff is invisible at the moment of the click. | **4** | prompt 12's block, `Projects/corner-and-kettle/WISHLIST.md`, the round-3 refresh notes, `gvb-site-handoff-v10.md` §8 |

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
| Q33 | **Should the Excellencies chapter be ported at all?** `skills/excellencies.md` is 34 words of developer-facing stub and there is no `source-material/markdown/skills/excellencies.md` — the one skills chapter with no conversion behind it. Meanwhile `hidden-excellencies-expressions.md` names 21 hidden ones openly. Withheld deliberately, or just unconverted? | 2 | wishlist, `numina-audit-2026-08.md` A3 |
| Q34 | **Do the eight nations with a blank `capital` have one?** Kindaria, Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach, Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are `demonym: ""` (the Five Duchies' entry says outright that it has none). If the book does not name them, the infobox should collapse rather than render a flag chip over one "See also" row. | 2 | wishlist, audit A4 |
| Q35 | **Is the custom-domain move happening, and when — and does `numinalarp.com` serve HTTPS?** The README calls it a one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every absolute URL, but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`. `site.json` and `quick-reference.md` both link `http://`; batch 1 asked and could not verify from its sandbox either. | 2 | wishlist, audit D4 |

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

| Area | Owns | Shared paths it must not change silently |
| --- | --- | --- |
| Anathema Archive | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py`, `Pathfinder/tests/` | `index.html`, `assets/js/gvb-save.js`, `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Pathfinder Campaigns | `Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/` | as above |
| Pathfinder Characters | `Pathfinder/characters.html`, `Pathfinder/characters-assets/` | as above |
| Aphelion | `Projects/aphelion/` | as above |
| Castle Conundrum | `Projects/Castle Conundrum/`, **and `Tools/board-check/play-castle.mjs`**, which is its own | `index.html`, `assets/js/gvb-save.js`, the rest of `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Closing Time | `Projects/Closing Time/` | the four shared |
| The Fourth Quarter | `Projects/fourth-quarter/`, `.github/workflows/fourth-quarter-ci.yml` | the four shared |
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

---

## Where the sources disagree

Six places two sources rank the same work differently. The table follows
`UPGRADE-PATHS.md`, as the newest, in every case. As above, the files named
here were deleted in this consolidation and survive only in git history.

**Every rank below was recomputed against its row when the tools were archived
and the table renumbered to 85 rows (2026-09-08), and shifted down one when
Faire Weekend's Phase 1 closed and left the table the same day.** That is the
fourth recompute in seven rounds, and each one has found the same thing: prose
written against rows nobody re-derived. Before that pass Daredevil's Phase 1
was quoted at 14 and is 8, Faire Weekend's review at 11 and is 4, Castle
Conundrum's preview promotion at 49 and is 33, and item 6's pair at 80 and 89
pointed at the touch playtest and the phantom's pan rather than at the two
real-GPU runs they describe. That correction was itself wrong and is fixed
here: it moved the pair to 67 and 75, which under that numbering were the
`?debug` hook beat and the phantom's pan again. The two real-GPU runs are the
Golden Hour low-end-GPU row and the Blue Hour mist-and-headlamp row. Three
passes in a row mis-derived that one pair, which is the argument for the rule:
ranks quoted in prose are a maintenance cost this file keeps paying, so check
one against its row before trusting it. **PR #216 closed the old rank 1, so
everything below it moved up one again** — every number in the five items
below was re-derived against its row, not decremented.

1. **Daredevil.** `UPGRADE-PATHS.md` ranks the project 7 of 10, so its Phase 1
   sits at rank 8. `gvb-site-handoff-v10.md` §11, the round-3 refresh notes
   and prompt 22's notes all rank the Earl decision **#1 on the site**. It is
   also blocked on Devon (Q3), which is the argument for not opening with it.
2. **Bell to Bell's own next ticket.** Settled. The wishlist opened with the
   save-slot architecture (rank 1 at the time, shipped as PR #104) while
   `docs/HANDOFF.md` said the next ticket was **T8, whisper audio**. Both have
   shipped: T8 landed in Phase 7, directional, panned and occlusion-attenuated.
3. **`Pathfinder/data/`.** `UPGRADE-PATHS.md` calls it "the highest-leverage
   *decision* on the site" and then files it unphased under "Close behind";
   v10 §11 ranks it #4. Ranked here at 24.
4. **Castle Conundrum.** `UPGRADE-PATHS.md` says the piece "is finished as
   designed" and ranks nothing; v10 §11 ranks its preview promotion **#3
   site-wide**. Ranked here at 23.
5. **Faire Weekend's layout and density review.** Prompt 09 and the project's
   notes call it "the headline item now", owed four rounds running; the
   wishlist puts it at Phase 5 (rank 4), behind guest agents.
6. **Golden Hour and Blue Hour.** `UPGRADE-PATHS.md` says both are "blocked
   first" on a real-GPU run; each project's own next-session list ranks that
   #2 and #3 respectively. Ranked here at 53 and 61.
