# Daredevil — Feature Wishlist

**Status: three rounds are shipped and the game is stable — 53/53 on
`smoke-save.mjs`, 44/44 on `smoke-page.mjs`, four transcript baselines diffed
line-for-line clean — and the first open phase is Phase 1, the backer-less
middle game, on Claude Fable 5.1, which is blocked on Devon answering the one
question in this file.**
Round 1 made the game finishable for the first time and gave it a save and a
suite; round 2 split the 356 KB monolith into modules and placed a minigame
that had never had a call site; round 3 measured what two rounds had deferred
and found the thing this wishlist is mostly about: a fully reachable choice at
the county fair that the next three chapters do not look at. The per-round
history lives in the repo root's `HISTORY.md`, under the prompt rounds.

## What it is

A 1970s American stunt-rider story that runs entirely in a page at
`Projects/daredevil/index.html`. No build step, no dependency, no server
beyond a static one — but it does need to be *served*, because it is ES
modules and a browser refuses those over `file://`. `Projects/daredevil_r4.html`
is a redirect stub pointing here and should stay one.

You play Duke Harlan, whose name and hometown you set on the setup screen and
which the text then uses throughout. Five milestones separated by four
free-roam evening hubs: the county fair, the investor offer, the big break, the
defining moment, and the question of when a man in this line of work is
supposed to stop. 207 scenes, 23,295 words inside the scene database's template
literals, 126 choices, eight endings, three canvas minigames. A clean run reads
89 of the 207 scenes in about 45 minutes. The whole thing — scenes, engine,
save — is 359 KB raw and 101 KB gzipped, measured, which is why nobody is
splitting `scenes.js` into fetched chunks.

The writing is finished: consistent voice, no placeholder prose, and Duke's
interiority rendered as "He thought:", which reads like a tic written down and
works in play. The branches reconverge and the divergence is carried in state
rather than in the graph, so two runs with different relationships see most of
the database between them.

The *systems* are not finished. The evening pips are almost always decoration,
the thirteen-bus jump is mechanically the three-cow jump, the recovery minigame
computes an outcome nothing reads, and turning down the man with the money
removes three optional evening cards and changes nothing else about the next
three chapters. Round 3 called that last one "technically non-broken but
narratively hollow" and was being generous.

## The architecture that is there

Four ES modules under `js/`, no bundler. `index.html` loads exactly one of
them (`<script type="module" src="./js/engine.js">`); the rest are imported.

- **`js/save.js`** (167 lines) — the save format, on top of the shared
  `assets/js/gvb-save.js`. The save holds a scene id, five stats, five
  relationships and the flag bag, and deliberately holds no line index and
  nothing out of `SCENES`, so rewriting a scene can never strand a save
  mid-sentence. Key `daredevil-save-v1`, locked.
- **`js/state.js`** (42 lines) — the leaf: `GS`, `STAT_LABELS`, and the
  line-builders `N()`/`D()`/`C()`/`NF()`. Its own file for one reason, in its
  header: `SCENES` calls `N()` and reads `GS.town` at module-evaluation time,
  so if those bindings lived in `engine.js` the two modules would import each
  other and the second to evaluate would read the first out of the temporal
  dead zone.
- **`js/scenes.js`** (4,318 lines, 213 KB) — the story, as data. One `SCENES`
  object, 207 keys, each with `lines[]`, optional `choices[]`, an optional
  `statUpdate` and `next`. Branch logic lives in three optional closures:
  `_requires` (hide a choice, 4 uses), `_gateCheck`/`_gateReason` (show it
  locked, 3 uses), `_gateRoute` (redirect on entry, 3 uses).
- **`js/engine.js`** (2,113 lines, 107 KB, 60 top-level `function`
  declarations) — everything else: screens, `goToScene`'s 26 procedural
  `_`-prefixed routes, `buildLines`/`showSceneEnd`, four hand-written hub
  renderers, `launchMinigame` and the three games, the epilogue in
  `showGameEnd`, and the boot block that publishes `window.__dd`.

The load-bearing habit is **story-as-data, engine-as-code**, and it is real for
prose and false for structure. A line can be a function
(`N(()=> GS.rels.ruthie === 'solid' ? 'a' : 'b')`) that `buildLines()` calls at
render time, and 26 lines already do this. Where it breaks down:

- **The four hubs are four near-identical hand-written renderers**
  (`renderHubFR1`/`FR2`/`FR3`/`FR4`, ~100 lines each) with their card lists as
  inline array literals; a new evening card is an edit to `engine.js`. Three
  scenes likewise carry their dynamic content there, keyed on
  `currentScene === '...'` inside `buildLines()`, though `N(fn)` exists to do
  it in the data.
- **Relationship requirements are ad-hoc `if` chains.** `_m4_prestunt_route`
  and `_m5_question_route` hard-code a priority ladder each; the hubs spell out
  their own `!== 'absent'` tests; `applyEffects` writes any key with any value
  into `GS.rels` with no schema and no complaint.
- **The relationship label tables exist twice and disagree.** `engine.js:610`
  (the mid-run stat screen) has no `pete` and no `hanger_on` and calls `backer`
  "Business Deal"; `engine.js:891` (the epilogue) has both and calls it
  "Business Partner". `fr1_wannabe_intro`'s statUpdate has therefore rendered a
  row reading literally `pete` / `hanger_on` since round 1.

The suite is the other load-bearing thing:

- **`test/drive-daredevil.mjs`** (221 lines) — how to boot, snapshot, click a
  labelled control and drive a minigame. Written once, imported by the rest.
- **`test/smoke-save.mjs`** (176 lines, 53 assertions) — plain Node, fast.
- **`test/smoke-page.mjs`** (293 lines, 44 assertions) — the regression suite:
  real Chromium, checks every `goto`/`next` target against `SCENES` and the
  source of `goToScene`, then plays two full runs to endings. ~15 minutes.
- **`test/transcript.mjs`** (224 lines) — plays a planned run and writes down
  every line, every choice offered and every scene id. Four committed
  baselines: `clean` (1,534 lines), `no_earl` (1,515), `no_pete` (1,399),
  `rough` (1,311).
- **`test/verify-touch-375.mjs`** (142 lines) — a one-off, kept as a tool.

`.github/workflows/` carries a job for the School Generator and one for Numina.
Nothing runs Daredevil's suite on a pull request.

## Conventions a new builder must know

- **A plain template literal in `N()`/`D()`/`C()` is evaluated once, at import
  time**, with the fresh-state defaults, before the player has typed a name.
  Four scenes get away with referencing `GS.town` only because
  `patchDynamicScenes()` overwrites those five lines by hand after setup.
  **New content must never join that patch list** — pass a function,
  `N(()=> ...)`, which `buildLines()` calls every render.
- **A `goto`/`next` target starting with `_` needs a matching
  `if(id === '_your_id')` block in `goToScene()`.** `smoke-page.mjs` fails on a
  missing route — but not on a route nothing names, which is how
  `_chapter_fr2`, `_chapter_fr2_end` and `_fr3_ruthie_route` came to be handled
  and unreachable. A new hub card also needs an entry in the relevant
  `renderHubFRn()`; the hubs do not read a list out of `SCENES`.
- **Before any story-logic edit, take fresh transcripts; after it, diff them
  line for line.** A narrative game that quietly loses a branch throws nothing.
  Every real bug in rounds 2 and 3 was found by grepping a transcript for a
  character's name, not by re-deriving from code.
- **The transcript captures prose, not the stat-update screen's rows** — a stat
  update logs as `> **title** — reason` only, which is why the raw `pete` /
  `hanger_on` row has been visible to players for three rounds and invisible to
  the tool.
- **A hub is done when the player is out of evenings OR out of anything to
  spend one on.** `hubExhausted()` exists because every hub used to gate its
  milestone button on `eveRemaining <= 0` alone, and FR3 hands out seven
  evenings against at most four cards — so the counter could not reach zero and
  nobody had ever seen Milestone 4.
- **Save-format changes stay additive, and `daredevil-save-v1` never changes**
  (locked decision #36). Fill-ins go in `repair`, which runs on every accepted
  load; `migrate` is for version drift only (#37). A flag whose value is a list
  must join `LIST_FLAGS` or the first hub render throws on `.includes`.
- **`freshState()` declares 19 flags and the game writes 74.** The other 55 are
  `undefined` until something sets them — fine for a boolean read with
  truthiness, not fine for anything `repair` should normalise. Adding a flag
  means deciding whether it belongs in `freshState`.
- **`window.__dd` is the one deliberate door** — `GS`, `SCENES`, the slot,
  `goToScene`, and getters for the live scene and minigame. The stunt run's
  `tele` carries `w` (angular velocity) and Work the Crowd carries
  `mg.correctCall` for the same reason: without them `autopilot()` cannot land
  a stunt or answer a choice round, and the suite times out into FAIL.
- **Zero offsite requests.** Seven fonts vendored in `fonts/` (100.3 KB), paths
  relative. `grep -c fonts.googleapis.com index.html` returns 1 and that one is
  a historical comment; trust `check-integrity.mjs`'s static sweep (locked
  decision #44). Do not hand-edit between `<!-- gvb:social:start -->` and
  `<!-- gvb:social:end -->` (#31) — `npm run social` overwrites it silently.
- **Everything outside `Projects/daredevil/` is read-only to this project.**
  Twenty-two Claude sessions run against this repo in parallel and the boundary
  is the only thing keeping that from becoming a merge fight. A needed change
  to a shared file goes into the notes' "Shared-file requests" section, written
  so somebody can apply it blind.
- **For every guard-rail you add, break the thing on purpose and watch it
  fail** (#34). A check that only prints is a check that gets ignored (#13).
- **Only run one browser suite at a time.** Chrome throttles a window that
  loses focus (v7 §6) and other threads run their own headed suites.

The invocations that work, from the repo root:

```
node Projects/daredevil/test/smoke-save.mjs          # 53 passed, 0 failed
node Projects/daredevil/test/smoke-page.mjs          # 44 passed, 0 failed, ~15 min
node Projects/daredevil/test/transcript.mjs clean    # also: rough, no_earl, no_pete
node Projects/daredevil/test/verify-touch-375.mjs    # one-off, 375px, touch-emulated
cd Tools/board-check && npm run check
```

## Questions for Devon

**What should "Not interested" to Earl actually do?** Choosing it at
`m1_player_response` sets `GS.rels.earl = 'absent'` and
`GS.flags.earlResponse = 'not_interested'`, and that removes exactly three
optional evening cards: the FR1 contract reading, the FR3 renegotiation, the
FR4 Vegas call. Milestones 2, 3 and 4 read neither value. `_chapter_m2` picks
its entry scene from `stuntOutcome`/`hubEveningsUsed` only, and `showChapter`'s
subtitles are fixed strings ("Earl Maddox is waiting. The contract is on the
table."). Earl comes back, negotiates across three rounds, and `m2_sign` sets
`rels.earl = 'backer'` again. Two shapes, both carried by Phase 1: **(A)** keep
"Earl doesn't take no for an answer" and pay it off with acknowledgment beats
at M2, M3 and M4, or **(B)** write a genuinely smaller, self-financed middle
game. **This wishlist recommends B, scoped to Milestone 2 and threaded through
3 and 4** — the FR2 debt scene, the four `debtSource` answers and the Sandra
press thread are already the raw material, and A leaves a six-way choice with
one cosmetic arm.

**Is the six-way Earl response at the fair the shape it should be?** Open since
round 1. Only option 5, "I need to talk to someone first," reaches `m1_ruthie`
and sets `rels.ruthie = 'solid'`, so five of six answers lock Ruthie out of all
four hubs and the epilogue for the whole game. Option 5 is also the only one
that never sets `rels.earl`, so a Ruthie run carries Earl as `'unknown'` to the
ending screen, where the epilogue prints "Earl Maddox. The relationship is
still being decided." after a run in which he backed every show.

## The standing backlog

Everything below is open and unclaimed. Pull from here; add to it rather than
starting a new list.

**Story and state**
- The Earl rejection changes three evening cards and nothing else. See above.
- Ruthie is reachable through one of six answers to one question, in one scene.
- `GS.rels.tommy` is never assigned anywhere in `scenes.js` — `'hanger_on'`
  from `freshState()` to the ending screen, while `engine.js` tests it against
  `'absent'` twice and `'unknown'` once. Danny is only ever `'frenemy'` or
  `'nemesis'`, only in Free Roam 2. Neither has a true never-met state.
- 31 flags are written and never read, including `familyOrigin` (the cold
  open's "what he came from" fork, whose only lasting effect is +1 Hustle on
  one arm), `debtSource`, `peteMistakeResponse` and `m5Decision`.
- `GS.flags.pressAtFair` is read in `buildLines()` and set by nothing, so five
  lines of Earl noticing the press man are dead.
- The stat-update screen's relationship table lacks `pete` and `hanger_on` and
  renders both raw.

**Reachable content**
- `fr4_close` — a finished scene in which Duke calls Earl and takes the Vegas
  date — is not named by any `goto`, `next`, hub card or route. It is the only
  scene id in the file that appears nowhere else as a string.
- `fr2_close` is reachable only through `_chapter_fr2_end`, which nothing
  names; `_chapter_fr2` is handled and never named either, so its "You signed."
  stat update never fires.
- `m5Outcome` never takes the value `'last_stunt_earl'` — `m5_last_stunt_earl`
  routes through the stunt run, which reports `last_stunt_win`/`_loss` — so
  four pieces of epilogue keyed to it cannot render.
- The mentor ending's headline and coda credit "Danny 'Diamondback' Reeves",
  Duke's rival, for a thread whose apprentice is Pete Garland, both gated on
  `GS.rels.pete` (`engine.js:916`, `:1006`).
- 41 of 207 scene ids are never named by a `goto` or `next`; forty are reached
  through a card id or an outcome variable in `engine.js`, and nothing static
  tells those apart from the one that is not.

**Minigames**
- `SCALES` in `createStuntRun` changes `n`, `unit` and `label` and nothing
  else: gravity, ramp angle, green band, landing tolerance and drift are
  identical for three cows, nine cars and thirteen buses.
- The stunt-run screen still shows the test bed's Scale pill row (Cows ×3 /
  Cars ×9 / Buses ×13), so a player at the county fair can pick the bus stack.
- "Try Again" on the result overlay restarts the run at no cost and no limit,
  so every story-consequential stunt outcome is freely re-rollable.
- `RecoveryCore.result()` computes SUCCESS/PARTIAL/FAIL and a score; both call
  sites discard the argument and route to a fixed scene.
- Work the Crowd's PARTIAL and FAIL are identical in effect — only SUCCESS pays
  (+1 Showmanship) and the story graph is the same either way.

**The hubs**
- FR3 hands out seven evenings against at most four cards; FR4 six against six;
  FR1 five against five, two of which can be disabled. Only FR2 (six against up
  to seven) can make the budget bind.
- Nothing costs money, health or reputation. `fr2_debt_01`'s twelve hundred
  dollars is a scene, not a number the game holds.
- Milestone 4's stunt gates read stats only (`showmanship>=4 && precision>=3`
  for buses, `nerve>=4` for the inferno); no relationship or flag matters.

**Verification and tooling**
- No GitHub Actions workflow runs this project's suite.
- `smoke-page.mjs` plays two runs, both with Earl as a backer; no committed
  assertion plays the rejection branch to an ending.
- Nothing checks reachability, orphan scenes, or read-but-never-written flags.
- A physical touch-device pass is outstanding; `verify-touch-375.mjs` is real
  evidence and is still emulation.
- Daredevil's social tags report DRIFT under `npm run social:check` — not this
  project's file, and six pages are affected repo-wide.

## Arc one — the branch that answers back

Three rounds made the game work, made it modular, and made its prose agree with
its own state. Arc one builds for the player who declines something. The phases
are **ranked by impact and the order is the recommendation**, with one caveat:
Phase 1 is blocked on Devon answering the question above, and Phase 2 is what
to run while waiting.

The model convention here: most phases run on **Claude Opus 5**. **Claude Fable
5.1** is named only where a wrong answer would be silent — authoring that must
stay coherent across 4,318 lines of prose and eight endings, a state layer
everything downstream inherits, or reachability logic whose failure mode is a
green suite over content nobody can reach. Each phase names its model and says
why. A phase is *finished* only when its branch has become a pull request, the
pull request has merged to main with the suite green, and the closing report
names the **next open phase's number and its named model**.

## Phase 1 — The backer-less middle game

**A player can turn down the man with the money, and the next three chapters
do not notice.**

The highest-value work on the project by a wide margin, and the one thing here
that is not a builder's call. Under shape B, Milestone 2 stops being the
investor negotiation on a rejected-Earl run and becomes the self-financed
version of the same beat: smaller venues, Lloyd Perkins' August booking instead
of Earl's calendar, the FR2 debt as a real constraint rather than a scene, and
a different pressure — nobody takes a percentage and nobody makes calls for you
either. M3 and M4 keep their spines and change their framing. Under A the same
money buys three acknowledgment beats and one arm of the choice stays
cosmetic.

- [ ] **Branch the chapter entries on relationship state, not just flags.**
  `_chapter_m2`/`m3`/`m4` read `stuntOutcome`/`hubEveningsUsed` and hand
  `showChapter` a fixed subtitle; add the `rels.earl === 'absent'` arm and make
  the subtitle a function of state.
- [ ] **Write `m2_solo_*`** — the self-financed Milestone 2, ending where
  `m2_sign` ends so FR2 opens unchanged. Reuse the negotiation's three-round
  structure against a bank, a promoter and Duke's own arithmetic.
- [ ] **Give FR2 a backer-less card set.** `renderHubFR2`'s array literal holds
  the Earl-shaped cards; `fr2_debt_01` becomes mandatory on this branch, and
  `debtSource` finally gets read by something.
- [ ] **Thread it through M3, M4 and the epilogue.** `m3_entry`'s TV crew
  arrives differently; `m4_entry`'s "Earl has proposals" needs a source;
  `showGameEnd`'s eight endings need reading against a run with no backer.
- [ ] **A fifth transcript plan, `no_earl_solo`**, played to an ending, plus a
  committed `smoke-page.mjs` run that answers "Not interested" and asserts it
  lands in the new content and not in `m2_entry`. Diff all five before and
  after; every hunk intended, nothing else moved.

*Leans on:* `js/scenes.js`, `goToScene`/`showChapter`/`renderHubFR2` in
`engine.js`, `transcript.mjs`'s `RUNS` table. *Save:* none — `rels.earl` and
`earlResponse` already persist. *Model:* **Claude Fable 5.1** — authoring a new
chapter that has to stay coherent with 4,318 lines of existing prose and land
correctly in all eight endings.

## Phase 2 — Everything the game already wrote and cannot show

**There is a finished scene in this file that no player has ever read, and the
suite is green.**

Round 1's five wiring bugs were all this shape: content that exists, routing
that does not, and nothing that throws. The same class is still here in smaller
pieces, and every item below was found by reading rather than by playing, which
is the argument for Phase 5. Cheap, needs no decision, and the thing to run
while Phase 1 waits on an answer.

- [ ] **Route `fr4_close`.** A written Vegas-decision beat — Duke folds the
  paper and calls Earl — reachable from nothing. It belongs between the FR4 hub
  emptying and `_chapter_m5`, and it needs a no-Earl variant.
- [ ] **Route `fr2_close`, or delete `_chapter_fr2_end` and `_chapter_fr2`.**
  Both are handled and named by nothing; `m2_sign` goes straight to
  `fr2_hub_open`.
- [ ] **Give the Earl-picked-the-canyon ending its own outcome.** Carry
  `m5Decision` into the win/loss handler so the four epilogue pieces keyed to
  `m5Outcome === 'last_stunt_earl'` can render.
- [ ] **Fix the mentor ending's attribution** (`engine.js:916`, `:1006`), and
  **set `pressAtFair` or cut the branch it guards** — five lines in
  `buildLines()` no run can reach.
- [ ] **One relationship label table, not two.** Move `engine.js:610` and
  `:891` into `state.js` and have both screens read it.
- [ ] **Teach `transcript.mjs` to log the stat-update relationship rows.** That
  bug survived three rounds of diffing because the tool never wrote them down.

*Leans on:* `goToScene`, `showGameEnd`, `buildLines`, `transcript.mjs`.
*Save:* none. *Model:* **Claude Opus 5** — routing repairs and one table move,
all pinned by transcripts.

## Phase 3 — Relationships as a declared thing

**Six characters, five stored keys, no schema, and `applyEffects` will happily
write `rels.peet = 'aly'` and tell nobody.**

Every relationship rule is an `if` somewhere in `engine.js`: two priority
ladders in `goToScene`, a `!== 'absent'` test per hub card, two disagreeing
label tables, and the epilogue's own idea of who exists. `GS.rels.pete` is not
in `freshState()` at all, so it is `undefined` until Free Roam 1 writes it and
`repairState` cannot normalise a key it does not know. This phase makes the
cast a declared table and a scene's relationship requirement a piece of data
readable without running the game — which is what Phase 5 needs to exist.

- [ ] **`CAST` in `state.js`.** One record per character: id, display name,
  ordered legal states, a display label for each, which state means "never
  met", and the default. `pete` joins `freshState().rels`.
- [ ] **`repairState` validates against it** — a relationship holding an
  illegal state repairs to the default instead of rendering raw — and
  **`applyEffects` refuses an unknown key or value, loudly** (#13).
- [ ] **`_requires` gets a data form.** A choice or card may declare
  `_needs: { earl: ['backer','mentor'] }`; the closure form stays for anything
  genuinely computed. Convert the seven closures and the hubs' inline tests.
- [ ] **The two priority ladders read the table.** `_m4_prestunt_route` and
  `_m5_question_route` become a scan over `CAST` in declared order.
- [ ] **A suite in `smoke-save.mjs`**: every state named anywhere is legal for
  that character and has a label. Break one on purpose and watch it fail.

*Leans on:* `state.js`, `save.js`'s `repairState`, `applyEffects`,
`showSceneEnd`, the four hub renderers. *Save:* additive — `pete` joins the
stored `rels`, repaired in on load; the key does not change. *Model:*
**Claude Fable 5.1** — a new state layer with invariants that every hub, both
route ladders, the epilogue and the save all inherit.

## Phase 4 — Danny and Tommy get a way out

**Tommy is assigned once, in `freshState()`, and the engine tests him against
two states he can never hold.**

Rounds 2 and 3 ran the absent-relationship prose sweep for Ruthie, then Earl
and Pete, and found a real bug each time. Danny and Tommy were skipped on the
honest grounds that neither has a true absent state — which is the thing to
fix. `GS.rels.tommy` is `'hanger_on'` for the whole game while `renderHubFR3`
and `renderHubFR4` both gate his card on him not being `'absent'`; Danny is
only ever `'frenemy'` or `'nemesis'`, and only in Free Roam 2, so
`dannyMet`/`dannySchemed` are the real switches.

- [ ] **Give Tommy a real track.** `fr4_eve_tommy` reads
  `GS.rels.tommy === 'ally'` for a line nothing can make true. Wire the FR1/FR2
  bar evenings to move him, and give the debt scene's "Borrow from Tommy" arm a
  lasting cost.
- [ ] **Give Danny a `'poached'` and an `'absent'`.** Both labels already exist
  in the epilogue's table; neither is reachable.
- [ ] **Two transcript plans, `no_tommy` and `no_danny`**, on round 3's method
  exactly: play them, grep the output for the name, read every unconditional
  mention, then fix what the grep finds as `N(fn)` prose swaps.
- [ ] **Extend the epilogue roster** so a character who was never in the story
  is omitted rather than printed as "—".

*Leans on:* Phase 3's `CAST`, `scenes.js`, `transcript.mjs`'s `RUNS`.
*Save:* none beyond Phase 3's. *Model:* **Claude Opus 5** — prose and card
wiring against an established method.

## Arc two — the machine under the story

Arc one builds for the player who says no. Arc two builds for the builder: a
tool that answers "what did this change make unreachable", a hub economy where
the pips mean something, three stunts that are three different stunts, and a
workflow that runs the suite. Same ranking rule, same model convention, same
definition of finished.

## Phase 5 — A walker that knows what it did not reach

**Four transcripts prove four paths exist. Nothing in this project can tell
you about the other 118 scenes.**

`smoke-page.mjs` checks that every `goto`/`next` target is *routable* — that
`goToScene` will answer it. It does not check that anything *names* it, which
is why three procedural routes and two finished scenes are unreachable under a
green suite, and why the one orphaned scene in the file took three rounds and a
static grep to find. This phase turns `transcript.mjs`'s knowledge of how to
walk the game into a graph tool that walks it with no browser.

- [ ] **`test/graph.mjs`, pure, with its suite.** Import `SCENES` under Node
  and build the directed graph over `next`, `choices[].goto`, `_gateRoute`
  targets, the hub card ids and `goToScene`'s `_` routes. Card ids and outcome
  scenes are `engine.js` string literals today; Phase 3's data forms make them
  readable, and anything still hand-written gets one table the tool reads.
- [ ] **Report orphans and unreachables** — a scene named by nothing, a route
  handled and never named, a `_needs` no path can satisfy. Fail, do not print
  (#13).
- [ ] **Walk relationship permutations** over the `CAST` states rather than
  every flag combination (earl × ruthie × pete × danny × tommy is small), and
  report which scenes are reachable under none of them.
- [ ] **The read/write flag audit.** Read but never written (three today:
  `pressAtFair`, `hubEvenings`, `fr2Pete01Done`) must be empty; written but
  never read (31 today) is a report with an allowlist.
- [ ] **Wire it into `smoke-save.mjs`** so it costs nothing, then **verify by
  reintroducing the bug** (#34): delete the route to `fr4_close` and watch the
  tool name it.

*Leans on:* `scenes.js` under a plain Node import, Phase 3's declared
requirements. *Save:* none. *Model:* **Claude Fable 5.1** — reachability over a
207-node graph with five state dimensions, where a wrong answer is a green
suite over content nobody can reach.

## Phase 6 — Evenings that cost something

**The hub hands out seven evenings and builds four cards, and the pips are
decoration.**

Free roam is most of the choice the player gets, and in three hubs out of four
the choice is "read all of these in some order". `hubExhausted()` fires because
the cards ran out, not because the evenings did — correct behaviour for a
broken economy, and the reason Milestone 4 was unreachable before round 1.

- [ ] **Budget against the card count, per hub** — fewer evenings than cards,
  so an evening spent is a card not read. FR2 is the only hub where that is
  true today.
- [ ] **Money as a held number.** `fr2_debt_01`'s twelve hundred dollars, the
  four `debtSource` answers and Earl's percentage describe an economy the game
  does not hold. One integer in `GS`, spent by the debt scene and the bigger
  stunts, read by the epilogue.
- [ ] **Condition as a cost.** The bar evening already says "Condition down";
  make a hub's worth of evenings something a body notices, feeding the stunt
  physics that already read `SKILLS.condition`.
- [ ] **A milestone consequence.** M4's stunt availability reads two stats; it
  should also read whether the act could afford the buses.
- [ ] **Show the trade on the card** — `buildHubCard`'s tag slot says what an
  evening costs, not just that it costs one.
- [ ] **Assert the budget binds** in `smoke-page.mjs`: a run that spends every
  evening reaches the milestone with cards still unread.

*Leans on:* the four `renderHubFRn` functions, `buildHubCard`, `freshState`.
*Save:* additive — a money integer and per-hub budgets, defaulted in
`freshState` and filled by `repair`. *Model:* **Claude Opus 5** — card wiring
around an existing pattern, with the suite already pinning hub exhaustion.

## Phase 7 — Three stunts that are three stunts

**Thirteen buses is three cows with ten more silhouettes drawn.**

`SCALES` in `createStuntRun` carries `{n, unit, label}` and nothing else: ramp
angle, gravity, green speed band, landing tolerance and drift are identical at
Milestone 1 and Milestone 4. Meanwhile "Try Again" restarts any run for free,
so the outcome that decides `GS.flags.stuntOutcome` and three chapters of
framing is re-rollable until the player likes it.

- [ ] **Make scale mean something** — longer gap, tighter landing window,
  higher required launch speed per tier, derived from `S.n` rather than a third
  table, so a fourth scale is one row.
- [ ] **Retire the Scale pill row** from `launchMinigame`'s `extraControls`, or
  gate it behind the same debug door `window.__dd` is. `drive-daredevil.mjs`
  does not use it.
- [ ] **Decide what "Try Again" means.** Either it costs something or the game
  stops pretending the outcome was earned; one retry at a Condition cost is the
  smallest version that keeps both.
- [ ] **Read the Recovery's result.** `RecoveryCore.result()` returns
  SUCCESS/PARTIAL/FAIL, `roundsCleared` and a score, and both call sites throw
  the argument away. Route `m1_stunt_crash_bad` and `m3_failure_bad_after` on
  it, and let a good recovery cost less Condition.
- [ ] **Give Work the Crowd a PARTIAL.** Upside-only was right for placing it
  in round 2 and is wrong now that it is load-bearing.
- [ ] **Extend the autopilot and re-pin the suite.** "Every stunt the autopilot
  was asked to land, it landed" has to keep holding at the new tolerances —
  that is the check that a difficulty change did not make the game unwinnable.

*Leans on:* `createStuntRun`, `createRecovery`, the four `handleStuntRun*`
handlers, `handleCrowdM1Result`, `autopilot()`. *Save:* none. *Model:*
**Claude Opus 5** — physics constants and result plumbing, with the autopilot
as a live check on every change.

## Phase 8 — A workflow that runs the suite, and a real thumb

**Every check this project has runs only when somebody remembers to run it.**

The School Generator has `.github/workflows/school-generator-ci.yml`, which
installs a pinned Playwright without introducing a `package.json` the project
does not want. Daredevil has 97 assertions, a 15-minute browser suite and no
workflow. Last in the arc because it protects everything above it.

- [ ] **`daredevil-ci.yml`**, on the School Generator's pattern: paths-filtered
  to `Projects/daredevil/**`, `smoke-save.mjs` first because it is seconds,
  then `smoke-page.mjs` behind the pinned Chromium install. The workflow file
  is outside this project's boundary — write it as a shared-file request,
  applicable blind, unless the boundary is widened first.
- [ ] **Transcript baselines as a check.** Regenerate every committed run in CI
  and fail on a diff, which turns a convention into an assertion.
- [ ] **Phase 5's graph tool in the same job**, since it needs no browser.
- [ ] **A physical touch-device pass.** `verify-touch-375.mjs` proves the
  pointer-event path under emulation; it cannot prove OS-level scroll-gesture
  suppression, which is what `touch-action:none` exists for. Hold the pedal
  through a page-scroll gesture on real hardware and write down what happened,
  then retire or promote the one-off against that result.

*Leans on:* `.github/workflows/`, `test/`. *Save:* none. *Model:* **Claude
Opus 5** — test wiring around an existing pattern in this repo.

## What this leaves for a later arc

- **Audio.** The game has none: no engine note, no crowd, no fork seal.
- **A second protagonist axis.** `familyOrigin` is a fork the game forgot; a
  version where it matters is a different game, not a phase.
- **Scene-level authoring tooling.** Nothing renders a scene outside the game,
  so a writer editing prose runs the whole page to see it.
- **A shorter route through.** 89 scenes and 45 minutes is the only length the
  game has, and a highlights run might not deserve to exist.
- **The social-tag drift.** Not this project's file; six pages are affected and
  it is one investigation, not six.
